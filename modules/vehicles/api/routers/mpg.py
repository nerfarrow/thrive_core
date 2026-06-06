# =============================================================================
# routers/mpg.py — Vehicles module: vision-powered MPG / fuel log
# thrive_core module `vehicles`
#
# Fill-up tracking with optional vision extraction: snap the odometer and the
# pump display, crop the numbers in the UI, and a local vision model (LM Studio
# / Ollama) reads the digits. Also: nearby-station lookup via OpenStreetMap
# Overpass, and per-vehicle stats.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrivecore.db)
#   • owns `mpg_entries` and a small `mpg_config` key/value table — the module's
#     own config store, since module routers can't import a core `routers.config`
#   • config is served under this router (/mpg/config), not a generic /config
# =============================================================================
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import os, re, json, base64, io, math
import httpx
from PIL import Image, ImageEnhance, ImageOps

from routers.auth import get_db

router = APIRouter(prefix="/mpg", tags=["mpg"])

HOSTS = {
    "lmstudio": {"label": "LM Studio", "base": os.environ.get("LMSTUDIO_BASE", "http://192.168.0.50:1234")},
    "ollama":   {"label": "Ollama",    "base": os.environ.get("OLLAMA_BASE",   "http://192.168.0.50:11434")},
}

CONFIG_DEFAULTS = {
    "active_host":  "lmstudio",
    "vision_model": "",
}


# ── db init ────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_entries (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                date      TEXT    NOT NULL,
                odometer  REAL    NOT NULL,
                gallons   REAL    NOT NULL,
                ppg       REAL,
                total     REAL,
                miles     REAL,
                mpg       REAL,
                notes     TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # per-model extraction scoreboard: how often each vision model produced
        # a usable read vs. failed (error / non-JSON / unreadable)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_model_stats (
                model     TEXT PRIMARY KEY,
                success   INTEGER NOT NULL DEFAULT 0,
                fail      INTEGER NOT NULL DEFAULT 0,
                last_used TEXT
            )
        """)
        # saved enhanced crops (what the vision model actually read) per fill-up.
        # A side table keeps the base64 out of the common list/stats queries.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_entry_images (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id   INTEGER NOT NULL,
                kind       TEXT,            -- 'odometer' | 'total' | 'gallons'
                b64        TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mpg_img_entry ON mpg_entry_images(entry_id)")
        existing = {r["name"] for r in conn.execute("PRAGMA table_info(mpg_entries)").fetchall()}
        for col, decl in (
            ("lat",        "REAL"),
            ("lng",        "REAL"),
            ("station",    "TEXT"),
            ("vehicle_id", "INTEGER REFERENCES vehicles(id) ON DELETE SET NULL"),
        ):
            if col not in existing:
                conn.execute(f"ALTER TABLE mpg_entries ADD COLUMN {col} {decl}")
        conn.commit()
    finally:
        conn.close()

init_db()


# ── config helpers (module-owned key/value store) ────────────────────────────
def get_cfg(key: str, default=None):
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM mpg_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    if row is not None:
        return row["value"]
    return default if default is not None else CONFIG_DEFAULTS.get(key)

def set_cfg(key: str, value: str):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO mpg_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, value)
        )
        conn.commit()
    finally:
        conn.close()


def record_model_result(model: Optional[str], ok: bool):
    """Tally an extraction outcome against the model that produced it."""
    if not model:
        return
    col = "success" if ok else "fail"
    conn = get_db()
    try:
        conn.execute(
            f"""INSERT INTO mpg_model_stats (model, {col}, last_used)
                VALUES (?, 1, datetime('now'))
                ON CONFLICT(model) DO UPDATE SET {col}={col}+1, last_used=datetime('now')""",
            (model,)
        )
        conn.commit()
    finally:
        conn.close()


# ── schemas ────────────────────────────────────────────────────────────────
class EntryCreate(BaseModel):
    date:       str
    odometer:   float
    gallons:    float
    ppg:        Optional[float] = None
    total:      Optional[float] = None
    notes:      Optional[str]   = None
    lat:        Optional[float] = None
    lng:        Optional[float] = None
    station:    Optional[str]   = None
    vehicle_id: Optional[int]   = None
    # enhanced crops the model read, kept on log: {'odometer'|'total'|'gallons': b64}
    images:     Optional[dict]  = None

class ZoneExtractRequest(BaseModel):
    b64:  str
    mime: str = "image/jpeg"

class NumberExtractRequest(BaseModel):
    b64:  str
    mime: str  = "image/jpeg"
    kind: str  = "number"   # "money" (sale total) | "volume" (gallons) | "number"

class ConfigSet(BaseModel):
    key:   str
    value: str

class ModelResult(BaseModel):
    model: str
    ok:    bool


# ── config routes ────────────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    out = dict(CONFIG_DEFAULTS)
    conn = get_db()
    try:
        for r in conn.execute("SELECT key, value FROM mpg_config").fetchall():
            out[r["key"]] = r["value"]
    finally:
        conn.close()
    return out

@router.post("/config")
def post_config(item: ConfigSet):
    set_cfg(item.key, item.value)
    return {"ok": True, "key": item.key, "value": item.value}


@router.post("/model-result")
def post_model_result(item: ModelResult):
    """Client-reported extraction outcome. A read that returns a value is only
    credited a success once the user keeps it (logs the fill-up); retrying,
    re-cropping, or hand-editing the value reports a fail for that model."""
    record_model_result(item.model, item.ok)
    return {"ok": True}


@router.get("/model-stats")
def model_stats():
    """Per-model extraction scoreboard (success/fail/last_used + success rate)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT model, success, fail, last_used FROM mpg_model_stats ORDER BY model"
        ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        total = r["success"] + r["fail"]
        out.append({
            "model":     r["model"],
            "success":   r["success"],
            "fail":      r["fail"],
            "total":     total,
            "rate":      round(r["success"] / total, 3) if total else None,
            "last_used": r["last_used"],
        })
    return out


# ── provider / model discovery ──────────────────────────────────────────────
async def probe_lmstudio(base: str):
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(f"{base}/api/v0/models")
        r.raise_for_status()
        data = r.json().get("data", [])
    return [{"id": m["id"], "vision": m.get("type") == "vlm", "state": m.get("state", "")} for m in data]

async def probe_ollama(base: str):
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(f"{base}/api/tags")
        r.raise_for_status()
        data = r.json().get("models", [])
    vmark = ("vl", "vision", "llava", "minicpm-v", "moondream", "internvl", "gemma3")
    return [{"id": m["name"], "vision": any(k in m["name"].lower() for k in vmark), "state": ""} for m in data]


@router.get("/providers")
async def list_providers():
    out = {}
    for key, h in HOSTS.items():
        entry = {"label": h["label"], "base": h["base"], "online": False, "models": []}
        try:
            entry["models"] = await probe_lmstudio(h["base"]) if key == "lmstudio" else await probe_ollama(h["base"])
            entry["online"] = True
        except Exception:
            pass
        out[key] = entry
    out["active"] = get_cfg("active_host", "lmstudio")
    return out


# ── image enhancement ──────────────────────────────────────────────────────
MAX_DIM = 1024  # longest side; minicpm-v chokes on larger crops (esp. square ones)

def enhance(b64: str, mime: str) -> str:
    try:
        raw = base64.b64decode(b64)
        pil = Image.open(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image")

    # honor EXIF rotation, then flatten to RGB (drops alpha that can confuse the model)
    pil = ImageOps.exif_transpose(pil).convert("RGB")

    # hard size cap — authoritative regardless of what the frontend sends.
    pil.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)

    pil = ImageEnhance.Contrast(pil).enhance(1.6)
    pil = ImageEnhance.Sharpness(pil).enhance(2.0)

    out = io.BytesIO()
    pil.save(out, format="JPEG", quality=88)  # always JPEG — smaller, model-friendly
    return base64.b64encode(out.getvalue()).decode()


# ── vision call ────────────────────────────────────────────────────────────
async def call_vision(b64: str, mime: str, prompt: str) -> dict:
    host_key = get_cfg("active_host", "lmstudio")
    model    = get_cfg("vision_model", "")
    if not model:
        raise HTTPException(status_code=400, detail="No vision model selected — pick one on the MPG page")
    host = HOSTS.get(host_key)
    if not host:
        raise HTTPException(status_code=400, detail=f"Unknown host: {host_key}")
    url = f"{host['base']}/v1/chat/completions"
    # enhance() always emits JPEG, so the data URI mime is fixed here
    payload = {
        "model": model, "max_tokens": 128, "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": prompt},
        ]}]
    }

    last_err = None
    resp = None
    for attempt in range(2):  # one retry — first multimodal call after a model load often fails
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
            break
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300]
            last_err = f"{host['label']} HTTP {e.response.status_code}: {body}"
        except httpx.HTTPError as e:
            last_err = f"{host['label']} error: {str(e)}"
    else:
        raise HTTPException(status_code=502, detail=last_err or "Vision request failed")

    try:
        raw = resp.json()["choices"][0]["message"]["content"]
    except Exception:
        raise HTTPException(status_code=502, detail=f"Unexpected response: {resp.text[:300]}")

    clean = raw.replace("```json", "").replace("```", "").strip()
    # Vision models often read an odometer like 056197 and emit it verbatim as a
    # JSON number — but leading zeros are invalid JSON, so json.loads chokes even
    # though the digits are correct. Strip leading zeros from number literals
    # (those following a ':', ',', or '[') before parsing. Leaves "0", "0.5",
    # and quoted strings untouched.
    clean = re.sub(r'([:\[,]\s*)0+(\d)', r'\1\2', clean)
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"Model returned non-JSON: {raw[:200]}")


# ── helpers ────────────────────────────────────────────────────────────────
def recalc_from(conn, vehicle_id: Optional[int] = None):
    if vehicle_id is not None:
        rows = conn.execute(
            "SELECT id, odometer, gallons FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
            (vehicle_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, odometer, gallons FROM mpg_entries WHERE vehicle_id IS NULL ORDER BY date ASC, id ASC"
        ).fetchall()
    prev_odo = None
    for row in rows:
        miles = round(row["odometer"] - prev_odo, 2) if prev_odo is not None else None
        mpg   = round(miles / row["gallons"], 2) if (miles and row["gallons"] > 0) else None
        conn.execute("UPDATE mpg_entries SET miles=?, mpg=? WHERE id=?", (miles, mpg, row["id"]))
        prev_odo = row["odometer"]


# ── routes ─────────────────────────────────────────────────────────────────
@router.get("/stats")
def get_stats(vehicle_id: Optional[int] = Query(default=None)):
    conn = get_db()
    try:
        if vehicle_id is not None:
            rows = conn.execute(
                "SELECT mpg, gallons, total FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
                (vehicle_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT mpg, gallons, total FROM mpg_entries ORDER BY date ASC, id ASC"
            ).fetchall()
    finally:
        conn.close()
    valid   = [r["mpg"]   for r in rows if r["mpg"]   is not None]
    spent   = [r["total"] for r in rows if r["total"] is not None]
    gallons = [r["gallons"] for r in rows]
    return {
        "count":       len(rows),
        "last_mpg":    round(valid[-1], 2)               if valid   else None,
        "avg_mpg":     round(sum(valid) / len(valid), 2) if valid   else None,
        "total_gal":   round(sum(gallons), 2)            if gallons else None,
        "total_spent": round(sum(spent), 2)              if spent   else None,
    }


@router.get("")
def list_entries(vehicle_id: Optional[int] = Query(default=None)):
    conn = get_db()
    try:
        if vehicle_id is not None:
            rows = conn.execute(
                "SELECT * FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
                (vehicle_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM mpg_entries ORDER BY date ASC, id ASC"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("", status_code=201)
def create_entry(entry: EntryCreate):
    conn = get_db()
    try:
        prev = conn.execute(
            """SELECT odometer FROM mpg_entries
               WHERE date <= ?
               AND (vehicle_id IS ? OR (? IS NULL AND vehicle_id IS NULL))
               ORDER BY date DESC, id DESC LIMIT 1""",
            (entry.date, entry.vehicle_id, entry.vehicle_id)
        ).fetchone()
        miles = round(entry.odometer - prev["odometer"], 2) if prev else None
        mpg   = round(miles / entry.gallons, 2) if (miles and entry.gallons > 0) else None
        total = entry.total or (round(entry.gallons * entry.ppg, 2) if entry.ppg else None)
        cur = conn.execute(
            """INSERT INTO mpg_entries
               (date, odometer, gallons, ppg, total, miles, mpg, notes, lat, lng, station, vehicle_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry.date, entry.odometer, entry.gallons, entry.ppg, total, miles, mpg,
             entry.notes, entry.lat, entry.lng, entry.station, entry.vehicle_id)
        )
        conn.commit()
        recalc_from(conn, entry.vehicle_id)
        conn.commit()
        # persist the enhanced crops the model read, if the client kept any
        if entry.images:
            for kind, b64 in entry.images.items():
                if b64:
                    conn.execute(
                        "INSERT INTO mpg_entry_images (entry_id, kind, b64) VALUES (?,?,?)",
                        (cur.lastrowid, kind, b64)
                    )
            conn.commit()
        row = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.get("/{entry_id}/images")
def entry_images(entry_id: int):
    """Saved enhanced crops for a fill-up (fetched on demand when a row expands)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT kind, b64 FROM mpg_entry_images WHERE entry_id=? ORDER BY id",
            (entry_id,)
        ).fetchall()
        return [{"kind": r["kind"], "b64": r["b64"]} for r in rows]
    finally:
        conn.close()


@router.patch("/{entry_id}")
def update_entry(entry_id: int, entry: EntryCreate):
    conn = get_db()
    try:
        existing = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Entry not found")
        total = entry.total or (round(entry.gallons * entry.ppg, 2) if entry.ppg else None)
        conn.execute(
            """UPDATE mpg_entries
               SET date=?, odometer=?, gallons=?, ppg=?, total=?, notes=?,
                   lat=?, lng=?, station=?, vehicle_id=?
               WHERE id=?""",
            (entry.date, entry.odometer, entry.gallons, entry.ppg, total,
             entry.notes, entry.lat, entry.lng, entry.station, entry.vehicle_id, entry_id)
        )
        conn.commit()
        # recompute miles/mpg for both the old and new vehicle buckets in case
        # the vehicle assignment changed
        recalc_from(conn, existing["vehicle_id"])
        if entry.vehicle_id != existing["vehicle_id"]:
            recalc_from(conn, entry.vehicle_id)
        conn.commit()
        row = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT vehicle_id FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        vehicle_id = row["vehicle_id"]
        conn.execute("DELETE FROM mpg_entry_images WHERE entry_id=?", (entry_id,))
        conn.execute("DELETE FROM mpg_entries WHERE id=?", (entry_id,))
        conn.commit()
        recalc_from(conn, vehicle_id)
        conn.commit()
    finally:
        conn.close()


@router.post("/extract/odometer")
async def extract_odometer(req: ZoneExtractRequest):
    enhanced = enhance(req.b64, req.mime)
    prompt = (
        "This image shows a car's dashboard with the odometer mileage display.\n"
        "Read the exact total mileage number shown, including any leading zeros.\n"
        "Many dashboards also show the current date and/or time — if a date is "
        "visible anywhere in the image, read it too and return it in YYYY-MM-DD format.\n"
        "Respond ONLY with a JSON object. No markdown, no explanation.\n"
        'Example: {"odometer_miles": 56197, "date": "2026-05-28", "confidence": "high"}\n'
        "confidence is high, medium, or low based on how clearly you can read the mileage.\n"
        "If no date is visible, set date to null.\n"
        'If you cannot read the mileage, return: {"odometer_miles": null, "date": null, "confidence": "low"}'
    )
    model = get_cfg("vision_model", "")
    try:
        result = await call_vision(enhanced, req.mime, prompt)
    except HTTPException:
        record_model_result(model, False)
        raise
    # a value coming back is only "pending" — the client credits the success when
    # the user keeps it. A null read couldn't be read at all → fail now.
    if result.get("odometer_miles") is None:
        record_model_result(model, False)
    result["enhanced_b64"] = enhanced
    return result


@router.post("/extract/number")
async def extract_number(req: NumberExtractRequest):
    """Read a SINGLE number from a tightly-cropped region. The frontend crops the
    sale total and the gallons separately, so each call only ever sees one number —
    far more reliable than asking the model to disambiguate fields on a full display."""
    enhanced = enhance(req.b64, req.mime)
    if req.kind == "money":
        desc, ex = ("a total fuel SALE amount in dollars (the dollars charged)",
                    '{"value": 78.14, "confidence": "high"}')
    elif req.kind == "volume":
        desc, ex = ("a fuel volume in GALLONS, usually with up to 3 decimal places",
                    '{"value": 16.015, "confidence": "high"}')
    else:
        desc, ex = ("a single number", '{"value": 123.45, "confidence": "high"}')
    prompt = (
        f"This cropped image shows {desc} on a seven-segment LCD display.\n"
        "There is only ONE number in this crop. Read every digit carefully, "
        "including any digits after the decimal point. The display may have glare.\n"
        "Respond ONLY with a JSON object. No markdown, no explanation.\n"
        f"Example: {ex}\n"
        "confidence is high, medium, or low based on how clearly you can read it.\n"
        'If you cannot read it, return: {"value": null, "confidence": "low"}'
    )
    model = get_cfg("vision_model", "")
    try:
        result = await call_vision(enhanced, req.mime, prompt)
    except HTTPException:
        record_model_result(model, False)
        raise
    # value present = pending (client credits success on keep); null = fail now.
    if result.get("value") is None:
        record_model_result(model, False)
    result["enhanced_b64"] = enhanced
    return result


# ── nearby fuel stations (OpenStreetMap / Overpass proxy) ────────────────────
OVERPASS_URLS = [
    os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
]

def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@router.get("/nearby")
async def nearby_stations(lat: float, lng: float, radius: int = 1500):
    """Return nearby fuel stations from OpenStreetMap, closest first."""
    radius = max(100, min(radius, 3000))
    query = (
        f"[out:json][timeout:15];"
        f'(node["amenity"="fuel"](around:{radius},{lat},{lng});'
        f'way["amenity"="fuel"](around:{radius},{lat},{lng}););'
        f"out center tags 40;"
    )
    last_err = None
    elements = None
    for url in OVERPASS_URLS:
        try:
            async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": "thrive-mpg/1.0"}) as client:
                # GET with urlencoded ?data= is accepted by all Overpass instances;
                # some public mirrors 406 on form-POST bodies.
                r = await client.get(url, params={"data": query})
                r.raise_for_status()
                elements = r.json().get("elements", [])
            break
        except httpx.HTTPError as e:
            last_err = f"{url.split('/')[2]}: {str(e)[:80]}"
            continue

    if elements is None:
        # every mirror failed — tell the frontend so it can say "lookup failed"
        return {"stations": [], "error": last_err or "lookup failed"}

    out = []
    for el in elements:
        tags = el.get("tags", {})
        plat = el.get("lat") or (el.get("center") or {}).get("lat")
        plon = el.get("lon") or (el.get("center") or {}).get("lon")
        if plat is None or plon is None:
            continue
        name = (tags.get("name") or tags.get("brand") or tags.get("operator")
                or "Fuel station")
        dist = _haversine_m(lat, lng, plat, plon)
        out.append({
            "name":   name,
            "brand":  tags.get("brand"),
            "street": tags.get("addr:street"),
            "lat":    plat,
            "lng":    plon,
            "dist_m": round(dist),
        })
    out.sort(key=lambda s: s["dist_m"])
    return {"stations": out[:8]}
