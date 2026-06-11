# =============================================================================
# routers/calendar.py — Calendar module: native events + two-way provider sync
# thrive module `calendar`
#
# Three layers:
#   • native calendars/events stored in thrive.db (the household's own thing)
#   • connected provider accounts (Google Calendar, Microsoft Graph) via OAuth
#     authorization-code flow with refresh tokens — two-way: external events
#     render in thrive, and events created/edited here push to the provider
#   • a merged read API: GET /calendar/events?start&end returns every visible
#     calendar's events in one normalized shape
#
# Provider setup is per-install (Settings → Calendar): the household registers
# its own OAuth app with each provider and pastes client id + secret here. The
# OAuth callback rides the normal auth gate — the browser doing the redirect
# carries the thrive session cookie.
#
# Time convention: timed events are UTC ISO strings ("…Z") end-exclusive;
# all-day events are bare "YYYY-MM-DD" dates, end-exclusive — both directions,
# for every provider. The frontend renders local time.
#
# Self-contained per the module loader: owns calendar_config, calendar_accounts,
# calendar_calendars, calendar_events, calendar_oauth_state.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional
import time, secrets, urllib.parse
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/calendar", tags=["calendar"])

GOOGLE_AUTH   = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN  = "https://oauth2.googleapis.com/token"
GOOGLE_API    = "https://www.googleapis.com/calendar/v3"
GOOGLE_SCOPE  = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email"
MS_AUTH       = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MS_TOKEN      = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MS_API        = "https://graph.microsoft.com/v1.0"
MS_SCOPE      = "offline_access User.Read Calendars.ReadWrite"

PALETTE = ["#f97316", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#eab308", "#14b8a6", "#ec4899"]


# ── db init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_config (
                key TEXT PRIMARY KEY, value TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_accounts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                provider      TEXT NOT NULL,            -- 'google' | 'microsoft'
                label         TEXT,                      -- email of the connected account
                access_token  TEXT,
                refresh_token TEXT,
                expires_at    REAL DEFAULT 0,            -- unix epoch
                created_at    TEXT DEFAULT (datetime('now'))
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_calendars (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                kind        TEXT NOT NULL DEFAULT 'local',  -- 'local' | 'google' | 'microsoft'
                account_id  INTEGER,                        -- calendar_accounts.id for external
                external_id TEXT,                           -- provider calendar id
                name        TEXT NOT NULL,
                color       TEXT,
                writable    INTEGER NOT NULL DEFAULT 1,
                visible     INTEGER NOT NULL DEFAULT 1
            )""")
        # native events only — external events live at the provider
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                calendar_id INTEGER NOT NULL,
                title       TEXT NOT NULL,
                location    TEXT,
                notes       TEXT,
                start       TEXT NOT NULL,   -- UTC ISO, or YYYY-MM-DD when all_day
                end         TEXT NOT NULL,   -- end-exclusive
                all_day     INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT DEFAULT (datetime('now'))
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_oauth_state (
                state        TEXT PRIMARY KEY,
                provider     TEXT NOT NULL,
                redirect_uri TEXT NOT NULL,
                created_at   TEXT DEFAULT (datetime('now'))
            )""")
        # a default native calendar so the module works before any setup
        if not conn.execute("SELECT id FROM calendar_calendars LIMIT 1").fetchone():
            conn.execute("INSERT INTO calendar_calendars (kind, name, color) VALUES ('local', 'Household', '#f97316')")
        conn.commit()
    finally:
        conn.close()

init_db()


# ── config helpers ────────────────────────────────────────────────────────────
def get_cfg(key: str, default: str = "") -> str:
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM calendar_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    return row["value"] if row is not None and row["value"] is not None else default

def set_cfg(key: str, value: str):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO calendar_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, value))
        conn.commit()
    finally:
        conn.close()

CRED_KEYS = ("google_client_id", "google_client_secret", "ms_client_id", "ms_client_secret")

def provider_creds(provider: str):
    if provider == "google":
        cid, sec = get_cfg("google_client_id"), get_cfg("google_client_secret")
    else:
        cid, sec = get_cfg("ms_client_id"), get_cfg("ms_client_secret")
    if not (cid and sec):
        raise HTTPException(status_code=400, detail=f"No {provider} OAuth app configured — add client id + secret in Settings → Calendar")
    return cid, sec


# ── provider HTTP helpers ─────────────────────────────────────────────────────
async def _post_form(url: str, data: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(url, data=data)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Provider unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"OAuth token exchange failed (HTTP {r.status_code}): {r.text[:200]}")
    return r.json()

async def _api(method: str, url: str, token: str, json_body=None, params=None, headers=None):
    hd = {"Authorization": f"Bearer {token}", **(headers or {})}
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            r = await client.request(method, url, json=json_body, params=params, headers=hd)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Provider unreachable: {e}")
    if r.status_code == 401:
        raise HTTPException(status_code=502, detail="Provider session expired — reconnect the account in Settings → Calendar")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Provider HTTP {r.status_code}: {r.text[:200]}")
    return None if r.status_code == 204 or not r.content else r.json()


def _account(account_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM calendar_accounts WHERE id=?", (account_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No such connected account")
    return row

async def access_token_for(account_id: int) -> str:
    """Cached-in-DB access token, refreshed via the refresh token when stale."""
    acct = _account(account_id)
    if acct["access_token"] and time.time() < (acct["expires_at"] or 0) - 60:
        return acct["access_token"]
    cid, sec = provider_creds(acct["provider"])
    url = GOOGLE_TOKEN if acct["provider"] == "google" else MS_TOKEN
    data = {"client_id": cid, "client_secret": sec, "grant_type": "refresh_token",
            "refresh_token": acct["refresh_token"]}
    if acct["provider"] == "microsoft":
        data["scope"] = MS_SCOPE
    tok = await _post_form(url, data)
    conn = get_db()
    try:
        conn.execute(
            "UPDATE calendar_accounts SET access_token=?, expires_at=?, refresh_token=COALESCE(?, refresh_token) WHERE id=?",
            (tok["access_token"], time.time() + int(tok.get("expires_in", 3600)),
             tok.get("refresh_token"), account_id))
        conn.commit()
    finally:
        conn.close()
    return tok["access_token"]


# ── schemas ──────────────────────────────────────────────────────────────────
class ConfigSet(BaseModel):
    key:   str
    value: str

class CalendarCreate(BaseModel):
    name:  str
    color: Optional[str] = None

class CalendarPatch(BaseModel):
    name:    Optional[str] = None
    color:   Optional[str] = None
    visible: Optional[bool] = None

class EventBody(BaseModel):
    calendar_id: int
    title:    str
    start:    str           # UTC ISO, or YYYY-MM-DD when all_day
    end:      str           # end-exclusive
    all_day:  bool = False
    location: Optional[str] = None
    notes:    Optional[str] = None


# ── config + accounts ────────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    """Secrets never come back — just which creds are present."""
    return {k: bool(get_cfg(k)) for k in CRED_KEYS}

@router.post("/config")
def post_config(item: ConfigSet):
    if item.key not in CRED_KEYS:
        raise HTTPException(status_code=400, detail="Unknown config key")
    set_cfg(item.key, item.value.strip())
    return {"ok": True}


@router.get("/accounts")
def list_accounts():
    conn = get_db()
    try:
        return [{"id": r["id"], "provider": r["provider"], "label": r["label"], "created_at": r["created_at"]}
                for r in conn.execute("SELECT * FROM calendar_accounts ORDER BY id").fetchall()]
    finally:
        conn.close()

@router.delete("/accounts/{account_id}")
def delete_account(account_id: int):
    """Disconnect: drop the account and every calendar that came with it."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM calendar_calendars WHERE account_id=?", (account_id,))
        conn.execute("DELETE FROM calendar_accounts WHERE id=?", (account_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── OAuth flow ───────────────────────────────────────────────────────────────
def _callback_uri(request: Request) -> str:
    """The redirect URI as the provider must see it — derived from the browser's
    origin so it works for both LAN (http://ip:9500) and the public domain."""
    origin = request.headers.get("origin") or request.headers.get("referer", "")
    if origin:
        parts = urllib.parse.urlsplit(origin)
        return f"{parts.scheme}://{parts.netloc}/api/calendar/oauth/callback"
    return "/api/calendar/oauth/callback"

@router.get("/oauth/start")
def oauth_start(provider: str, request: Request):
    """Returns the provider consent URL for the browser to open. The exact
    redirect URI in use is included so Settings can display what to register."""
    if provider not in ("google", "microsoft"):
        raise HTTPException(status_code=400, detail="Unknown provider")
    cid, _ = provider_creds(provider)
    redirect_uri = _callback_uri(request)
    state = secrets.token_urlsafe(24)
    conn = get_db()
    try:
        conn.execute("DELETE FROM calendar_oauth_state WHERE created_at < datetime('now','-1 hour')")
        conn.execute("INSERT INTO calendar_oauth_state (state, provider, redirect_uri) VALUES (?,?,?)",
                     (state, provider, redirect_uri))
        conn.commit()
    finally:
        conn.close()
    if provider == "google":
        q = {"client_id": cid, "redirect_uri": redirect_uri, "response_type": "code",
             "scope": GOOGLE_SCOPE, "access_type": "offline", "prompt": "consent", "state": state}
        return {"url": f"{GOOGLE_AUTH}?{urllib.parse.urlencode(q)}", "redirect_uri": redirect_uri}
    q = {"client_id": cid, "redirect_uri": redirect_uri, "response_type": "code",
         "scope": MS_SCOPE, "state": state}
    return {"url": f"{MS_AUTH}?{urllib.parse.urlencode(q)}", "redirect_uri": redirect_uri}


@router.get("/oauth/callback")
async def oauth_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    """Where the provider sends the browser back. Exchanges the code, stores the
    account, imports its calendar list, then bounces to the calendar page."""
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM calendar_oauth_state WHERE state=?", (state,)).fetchone()
        if row:
            conn.execute("DELETE FROM calendar_oauth_state WHERE state=?", (state,))
            conn.commit()
    finally:
        conn.close()
    if error:
        return RedirectResponse(f"/calendar?error={urllib.parse.quote(error)}")
    if not row or not code:
        return RedirectResponse("/calendar?error=oauth_state_mismatch")

    provider, redirect_uri = row["provider"], row["redirect_uri"]
    cid, sec = provider_creds(provider)
    data = {"client_id": cid, "client_secret": sec, "grant_type": "authorization_code",
            "code": code, "redirect_uri": redirect_uri}
    if provider == "microsoft":
        data["scope"] = MS_SCOPE
    tok = await _post_form(GOOGLE_TOKEN if provider == "google" else MS_TOKEN, data)
    access, refresh = tok.get("access_token"), tok.get("refresh_token")
    if not access:
        return RedirectResponse("/calendar?error=no_token")

    # who is this? (label for the accounts list)
    if provider == "google":
        info = await _api("GET", "https://www.googleapis.com/oauth2/v2/userinfo", access)
        label = info.get("email") or "google account"
    else:
        info = await _api("GET", f"{MS_API}/me", access)
        label = info.get("mail") or info.get("userPrincipalName") or "microsoft account"

    conn = get_db()
    try:
        # reconnecting the same account replaces its tokens instead of duplicating
        old = conn.execute("SELECT id FROM calendar_accounts WHERE provider=? AND label=?", (provider, label)).fetchone()
        if old:
            conn.execute("UPDATE calendar_accounts SET access_token=?, refresh_token=COALESCE(?,refresh_token), expires_at=? WHERE id=?",
                         (access, refresh, time.time() + int(tok.get("expires_in", 3600)), old["id"]))
            account_id = old["id"]
        else:
            cur = conn.execute("INSERT INTO calendar_accounts (provider, label, access_token, refresh_token, expires_at) VALUES (?,?,?,?,?)",
                               (provider, label, access, refresh, time.time() + int(tok.get("expires_in", 3600))))
            account_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    await import_calendars(account_id, provider, access)
    return RedirectResponse("/calendar?connected=" + provider)


async def import_calendars(account_id: int, provider: str, token: str):
    """Pull the account's calendar list and register any not yet known."""
    cals = []
    if provider == "google":
        data = await _api("GET", f"{GOOGLE_API}/users/me/calendarList", token)
        for c in data.get("items", []):
            cals.append({"external_id": c["id"], "name": c.get("summary") or c["id"],
                         "color": c.get("backgroundColor"),
                         "writable": c.get("accessRole") in ("owner", "writer")})
    else:
        data = await _api("GET", f"{MS_API}/me/calendars", token)
        for c in data.get("value", []):
            cals.append({"external_id": c["id"], "name": c.get("name") or "Calendar",
                         "color": None, "writable": bool(c.get("canEdit", True))})
    conn = get_db()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM calendar_calendars").fetchone()["n"]
        for i, c in enumerate(cals):
            if conn.execute("SELECT id FROM calendar_calendars WHERE account_id=? AND external_id=?",
                            (account_id, c["external_id"])).fetchone():
                continue
            conn.execute(
                "INSERT INTO calendar_calendars (kind, account_id, external_id, name, color, writable) VALUES (?,?,?,?,?,?)",
                (provider, account_id, c["external_id"], c["name"],
                 c["color"] or PALETTE[(n + i) % len(PALETTE)], 1 if c["writable"] else 0))
        conn.commit()
    finally:
        conn.close()


# ── calendars ────────────────────────────────────────────────────────────────
@router.get("/calendars")
def list_calendars():
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute(
            """SELECT c.*, a.label AS account_label, a.provider AS account_provider
               FROM calendar_calendars c LEFT JOIN calendar_accounts a ON a.id = c.account_id
               ORDER BY c.kind = 'local' DESC, c.id""").fetchall()]
    finally:
        conn.close()

@router.post("/calendars")
def create_calendar(body: CalendarCreate):
    conn = get_db()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM calendar_calendars").fetchone()["n"]
        cur = conn.execute("INSERT INTO calendar_calendars (kind, name, color) VALUES ('local', ?, ?)",
                           (body.name.strip(), body.color or PALETTE[n % len(PALETTE)]))
        conn.commit()
        return {"ok": True, "id": cur.lastrowid}
    finally:
        conn.close()

@router.patch("/calendars/{cal_id}")
def patch_calendar(cal_id: int, body: CalendarPatch):
    sets, vals = [], []
    if body.name is not None:    sets.append("name=?");    vals.append(body.name.strip())
    if body.color is not None:   sets.append("color=?");   vals.append(body.color)
    if body.visible is not None: sets.append("visible=?"); vals.append(1 if body.visible else 0)
    if not sets:
        return {"ok": True}
    conn = get_db()
    try:
        conn.execute(f"UPDATE calendar_calendars SET {', '.join(sets)} WHERE id=?", (*vals, cal_id))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}

@router.delete("/calendars/{cal_id}")
def delete_calendar(cal_id: int):
    """Local calendars delete outright (events included). External calendars
    just leave the merged view — the provider copy is untouched."""
    conn = get_db()
    try:
        row = conn.execute("SELECT kind FROM calendar_calendars WHERE id=?", (cal_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="No such calendar")
        if row["kind"] == "local":
            conn.execute("DELETE FROM calendar_events WHERE calendar_id=?", (cal_id,))
        conn.execute("DELETE FROM calendar_calendars WHERE id=?", (cal_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── events: normalize helpers ────────────────────────────────────────────────
def _g_time(t: dict) -> str:
    return t.get("date") or t.get("dateTime") or ""

def _ms_time(t: dict) -> str:
    # Graph returns "2026-06-11T10:00:00.0000000" with timeZone UTC (we ask for
    # UTC via the Prefer header) — trim + mark it
    dt = (t.get("dateTime") or "")[:19]
    return f"{dt}Z" if dt else ""

def _g_event_body(e: EventBody) -> dict:
    if e.all_day:
        start, end = {"date": e.start[:10]}, {"date": e.end[:10]}
    else:
        start, end = {"dateTime": e.start}, {"dateTime": e.end}
    return {"summary": e.title, "location": e.location or "", "description": e.notes or "",
            "start": start, "end": end}

def _ms_event_body(e: EventBody) -> dict:
    s = f"{e.start[:10]}T00:00:00" if e.all_day else e.start[:19].replace("Z", "")
    en = f"{e.end[:10]}T00:00:00" if e.all_day else e.end[:19].replace("Z", "")
    return {"subject": e.title, "isAllDay": e.all_day,
            "start": {"dateTime": s, "timeZone": "UTC"},
            "end":   {"dateTime": en, "timeZone": "UTC"},
            "location": {"displayName": e.location or ""},
            "body": {"contentType": "text", "content": e.notes or ""}}


# ── events: merged read ──────────────────────────────────────────────────────
@router.get("/events")
async def events(start: str, end: str):
    """Every visible calendar's events between start and end (UTC ISO),
    normalized: {id, calendar_id, title, start, end, all_day, location, notes,
    readonly}. Provider recurrences arrive pre-expanded."""
    conn = get_db()
    try:
        cals = [dict(r) for r in conn.execute("SELECT * FROM calendar_calendars WHERE visible=1").fetchall()]
        local_ids = [c["id"] for c in cals if c["kind"] == "local"]
        out = []
        if local_ids:
            qmarks = ",".join("?" * len(local_ids))
            for r in conn.execute(
                f"SELECT * FROM calendar_events WHERE calendar_id IN ({qmarks}) AND start < ? AND end > ?",
                (*local_ids, end, start)).fetchall():
                out.append({"id": str(r["id"]), "calendar_id": r["calendar_id"], "title": r["title"],
                            "start": r["start"], "end": r["end"], "all_day": bool(r["all_day"]),
                            "location": r["location"], "notes": r["notes"], "readonly": False})
    finally:
        conn.close()

    for c in cals:
        if c["kind"] == "local":
            continue
        try:
            token = await access_token_for(c["account_id"])
            if c["kind"] == "google":
                data = await _api("GET", f"{GOOGLE_API}/calendars/{urllib.parse.quote(c['external_id'])}/events", token,
                                  params={"timeMin": start, "timeMax": end, "singleEvents": "true",
                                          "orderBy": "startTime", "maxResults": 2500})
                for ev in data.get("items", []):
                    if ev.get("status") == "cancelled":
                        continue
                    out.append({"id": ev["id"], "calendar_id": c["id"], "title": ev.get("summary") or "(untitled)",
                                "start": _g_time(ev.get("start", {})), "end": _g_time(ev.get("end", {})),
                                "all_day": "date" in ev.get("start", {}),
                                "location": ev.get("location"), "notes": ev.get("description"),
                                "readonly": not c["writable"]})
            else:
                data = await _api("GET", f"{MS_API}/me/calendars/{c['external_id']}/calendarView", token,
                                  params={"startDateTime": start, "endDateTime": end, "$top": 500},
                                  headers={"Prefer": 'outlook.timezone="UTC"'})
                for ev in data.get("value", []):
                    out.append({"id": ev["id"], "calendar_id": c["id"], "title": ev.get("subject") or "(untitled)",
                                "start": _ms_time(ev.get("start", {}))[:10] if ev.get("isAllDay") else _ms_time(ev.get("start", {})),
                                "end":   _ms_time(ev.get("end", {}))[:10]   if ev.get("isAllDay") else _ms_time(ev.get("end", {})),
                                "all_day": bool(ev.get("isAllDay")),
                                "location": (ev.get("location") or {}).get("displayName"),
                                "notes": None, "readonly": not c["writable"]})
        except HTTPException as e:
            # one broken account shouldn't blank the whole household calendar
            out.append({"id": f"err-{c['id']}", "calendar_id": c["id"], "title": f"⚠ {c['name']}: {e.detail}",
                        "start": start, "end": start, "all_day": True, "location": None, "notes": None,
                        "readonly": True, "error": True})
    return {"events": out}


# ── events: write (local or push to provider) ────────────────────────────────
def _cal(cal_id: int) -> dict:
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM calendar_calendars WHERE id=?", (cal_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="No such calendar")
    if not row["writable"]:
        raise HTTPException(status_code=403, detail="That calendar is read-only")
    return dict(row)


@router.post("/events")
async def create_event(body: EventBody):
    cal = _cal(body.calendar_id)
    if cal["kind"] == "local":
        conn = get_db()
        try:
            cur = conn.execute(
                "INSERT INTO calendar_events (calendar_id, title, location, notes, start, end, all_day) VALUES (?,?,?,?,?,?,?)",
                (body.calendar_id, body.title.strip(), body.location, body.notes,
                 body.start, body.end, 1 if body.all_day else 0))
            conn.commit()
            return {"ok": True, "id": str(cur.lastrowid)}
        finally:
            conn.close()
    token = await access_token_for(cal["account_id"])
    if cal["kind"] == "google":
        ev = await _api("POST", f"{GOOGLE_API}/calendars/{urllib.parse.quote(cal['external_id'])}/events",
                        token, json_body=_g_event_body(body))
    else:
        ev = await _api("POST", f"{MS_API}/me/calendars/{cal['external_id']}/events",
                        token, json_body=_ms_event_body(body))
    return {"ok": True, "id": ev.get("id")}


@router.patch("/events")
async def update_event(event_id: str, body: EventBody):
    cal = _cal(body.calendar_id)
    if cal["kind"] == "local":
        conn = get_db()
        try:
            conn.execute(
                "UPDATE calendar_events SET title=?, location=?, notes=?, start=?, end=?, all_day=? WHERE id=? AND calendar_id=?",
                (body.title.strip(), body.location, body.notes, body.start, body.end,
                 1 if body.all_day else 0, int(event_id), body.calendar_id))
            conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    token = await access_token_for(cal["account_id"])
    if cal["kind"] == "google":
        await _api("PATCH", f"{GOOGLE_API}/calendars/{urllib.parse.quote(cal['external_id'])}/events/{urllib.parse.quote(event_id)}",
                   token, json_body=_g_event_body(body))
    else:
        await _api("PATCH", f"{MS_API}/me/events/{urllib.parse.quote(event_id)}",
                   token, json_body=_ms_event_body(body))
    return {"ok": True}


@router.delete("/events")
async def delete_event(event_id: str, calendar_id: int):
    cal = _cal(calendar_id)
    if cal["kind"] == "local":
        conn = get_db()
        try:
            conn.execute("DELETE FROM calendar_events WHERE id=? AND calendar_id=?", (int(event_id), calendar_id))
            conn.commit()
        finally:
            conn.close()
        return {"ok": True}
    token = await access_token_for(cal["account_id"])
    if cal["kind"] == "google":
        await _api("DELETE", f"{GOOGLE_API}/calendars/{urllib.parse.quote(cal['external_id'])}/events/{urllib.parse.quote(event_id)}", token)
    else:
        await _api("DELETE", f"{MS_API}/me/events/{urllib.parse.quote(event_id)}", token)
    return {"ok": True}
