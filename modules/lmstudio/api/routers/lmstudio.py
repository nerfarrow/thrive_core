# =============================================================================
# routers/lmstudio.py — LM Studio module: local vision/LLM host
# thrive module `lmstudio`
#
# A headless infrastructure module: it ships no page, only a Settings panel and
# an API that other modules consume. Owns everything LLM/vision — model
# discovery, image enhancement, the chat/vision call, the per-model scoreboard,
# and the host config. Today it serves the Vehicles MPG tracker (odometer /
# fuel-pump digit OCR); any future module that needs a local vision model calls
# the same `/lmstudio/vision` endpoint with its own prompt.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrive.db)
#   • owns `lmstudio_config` (key/value) and `lmstudio_model_stats` tables
#   • config is served under this router (/lmstudio/config)
# =============================================================================
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os, re, json, base64, io
import httpx
from PIL import Image, ImageEnhance, ImageOps

from routers.auth import get_db

router = APIRouter(prefix="/lmstudio", tags=["lmstudio"])

# Default host; overridable per-install via the Settings panel (config base_url).
LMSTUDIO_BASE = os.environ.get("LMSTUDIO_BASE", "http://192.168.0.50:1234")

CONFIG_DEFAULTS = {
    "base_url":     LMSTUDIO_BASE,
    "vision_model": "",
}


# ── db init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lmstudio_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # per-model extraction scoreboard: how often each vision model produced
        # a usable read vs. failed (error / non-JSON / unreadable)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lmstudio_model_stats (
                model     TEXT PRIMARY KEY,
                success   INTEGER NOT NULL DEFAULT 0,
                fail      INTEGER NOT NULL DEFAULT 0,
                last_used TEXT
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── config helpers (module-owned key/value store) ────────────────────────────
def get_cfg(key: str, default=None):
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM lmstudio_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    if row is not None and row["value"] is not None:
        return row["value"]
    return default if default is not None else CONFIG_DEFAULTS.get(key)

def set_cfg(key: str, value: str):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO lmstudio_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
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
            f"""INSERT INTO lmstudio_model_stats (model, {col}, last_used)
                VALUES (?, 1, datetime('now'))
                ON CONFLICT(model) DO UPDATE SET {col}={col}+1, last_used=datetime('now')""",
            (model,)
        )
        conn.commit()
    finally:
        conn.close()


# ── schemas ──────────────────────────────────────────────────────────────────
class ConfigSet(BaseModel):
    key:   str
    value: str

class ModelResult(BaseModel):
    model: str
    ok:    bool

class VisionRequest(BaseModel):
    b64:    str
    prompt: str
    mime:   str           = "image/jpeg"
    model:  Optional[str] = None   # override the configured default for one call


# ── config routes ────────────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    out = dict(CONFIG_DEFAULTS)
    conn = get_db()
    try:
        for r in conn.execute("SELECT key, value FROM lmstudio_config").fetchall():
            if r["value"] is not None:
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
    credited a success once the user keeps it (e.g. logs the fill-up); retrying,
    re-cropping, or hand-editing the value reports a fail for that model."""
    record_model_result(item.model, item.ok)
    return {"ok": True}


@router.get("/model-stats")
def model_stats():
    """Per-model extraction scoreboard (success/fail/last_used + success rate)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT model, success, fail, last_used FROM lmstudio_model_stats ORDER BY model"
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


# ── model discovery ──────────────────────────────────────────────────────────
async def probe(base: str):
    """List models the host advertises. LM Studio tags vision models type=='vlm'."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(f"{base}/api/v0/models")
        r.raise_for_status()
        data = r.json().get("data", [])
    # LM Studio's enhanced /api/v0/models record carries more than we filter for —
    # surface quantization + context lengths too (no GPU-offload data is exposed
    # over the REST API; that only lives in the SDK / `lms ps`).
    return [{
        "id":         m["id"],
        "vision":     m.get("type") == "vlm",
        "type":       m.get("type"),
        "state":      m.get("state", ""),
        "arch":       m.get("arch"),
        "publisher":  m.get("publisher"),
        "quant":      m.get("quantization"),
        "max_ctx":    m.get("max_context_length"),
        "loaded_ctx": m.get("loaded_context_length"),
    } for m in data]


@router.get("/status")
async def status():
    """Host reachability + the models it exposes. The frontend filters for
    `vision: true` when it needs a VLM."""
    base = get_cfg("base_url", LMSTUDIO_BASE)
    out = {"base": base, "online": False, "models": [], "vision_model": get_cfg("vision_model", "")}
    try:
        out["models"]  = await probe(base)
        out["online"]  = True
    except Exception:
        pass
    return out


# ── image enhancement ────────────────────────────────────────────────────────
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


# ── vision call ──────────────────────────────────────────────────────────────
async def call_vision(b64: str, prompt: str, model: str, base: str) -> dict:
    url = f"{base}/v1/chat/completions"
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
            last_err = f"LM Studio HTTP {e.response.status_code}: {body}"
        except httpx.HTTPError as e:
            last_err = f"LM Studio error: {str(e)}"
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


@router.post("/vision")
async def vision(req: VisionRequest):
    """Domain-agnostic vision extraction. The caller supplies a `prompt` that
    instructs the model to return a JSON object; we enhance the image, run it
    through the configured (or overridden) vision model, and return the parsed
    JSON plus the enhanced crop so the caller can keep it as a record.

    Failure bookkeeping: a hard error (host down / non-JSON) is failed here
    against the model. A successful call that returns a "couldn't read" value
    (e.g. null) is the caller's to judge — it reports the outcome via
    /lmstudio/model-result once the user keeps or discards the read."""
    base  = get_cfg("base_url", LMSTUDIO_BASE)
    model = req.model or get_cfg("vision_model", "")
    if not model:
        raise HTTPException(status_code=400, detail="No vision model selected — pick one in Settings → LM Studio")

    enhanced = enhance(req.b64, req.mime)
    try:
        result = await call_vision(enhanced, req.prompt, model, base)
    except HTTPException:
        record_model_result(model, False)
        raise
    return {"result": result, "enhanced_b64": enhanced, "model": model}
