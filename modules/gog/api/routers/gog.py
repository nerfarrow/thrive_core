# =============================================================================
# routers/gog.py — GOG module: household DRM-free game libraries
# thrive module `gog`
#
# GOG has no official public API; this uses the same unofficial-but-stable
# OAuth flow every GOG client (Heroic, Lutris, gogdl) uses: the public Galaxy
# client id/secret, a browser login that lands on on_login_success with a
# one-time ?code=, exchanged here for an access + refresh token pair. Each
# household profile links its own GOG account (the refresh token is stored
# per profile in thrive.db). The web API exposes the owned library (titles,
# artwork, store URLs, platforms) but NOT playtime — that only exists inside
# GOG Galaxy — so the dashboard is a collection view, not an hours view.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrive.db)
#   • owns `gog_links` (user_id → gog account + refresh token)
#   • reads the core `users` table (profiles) for the link roster
# =============================================================================
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import re, time, urllib.parse
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/gog", tags=["gog"])

# The public GOG Galaxy OAuth client — shared by every third-party GOG client.
CLIENT_ID     = "46899977096215655"
CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9"
REDIRECT_URI  = "https://embed.gog.com/on_login_success?origin=client"

AUTH_BASE  = "https://auth.gog.com"
EMBED_BASE = "https://embed.gog.com"

LOGIN_URL = (
    f"{AUTH_BASE}/auth?client_id={CLIENT_ID}"
    f"&redirect_uri={urllib.parse.quote(REDIRECT_URI, safe='')}"
    "&response_type=code&layout=client2"
)


# ── db init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        # one GOG account per household profile; username/avatar are a snapshot
        # taken at link time. The refresh token is long-lived — library calls
        # mint short-lived access tokens from it on demand.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS gog_links (
                user_id       INTEGER PRIMARY KEY,
                gog_user_id   TEXT,
                username      TEXT,
                avatar        TEXT,
                refresh_token TEXT NOT NULL,
                linked_at     TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── token + API helpers ──────────────────────────────────────────────────────
# access tokens last ~1h; cache them per linked profile and re-mint from the
# refresh token when stale
_access: dict = {}   # user_id → (expires_at_epoch, access_token)
_cache:  dict = {}   # (path, params) → (fetched_at_epoch, json)

async def _token_request(params: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{AUTH_BASE}/token", params={
                "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, **params,
            })
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"GOG auth unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GOG auth failed (HTTP {r.status_code}) — the code may be expired, try logging in again")
    return r.json()

def _store_refresh(user_id: int, refresh_token: str):
    conn = get_db()
    try:
        conn.execute("UPDATE gog_links SET refresh_token=? WHERE user_id=?", (refresh_token, user_id))
        conn.commit()
    finally:
        conn.close()

async def access_token_for(user_id: int) -> str:
    now = time.time()
    hit = _access.get(user_id)
    if hit and now < hit[0]:
        return hit[1]
    conn = get_db()
    try:
        row = conn.execute("SELECT refresh_token FROM gog_links WHERE user_id=?", (user_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Profile has no GOG account linked")
    tok = await _token_request({"grant_type": "refresh_token", "refresh_token": row["refresh_token"]})
    # GOG rotates the refresh token on every refresh — persist the new one
    if tok.get("refresh_token"):
        _store_refresh(user_id, tok["refresh_token"])
    _access[user_id] = (now + int(tok.get("expires_in", 3600)) - 60, tok["access_token"])
    return tok["access_token"]

async def gog_get(path: str, token: str, params: dict = None, ttl: int = 600):
    ck = (path, tuple(sorted((params or {}).items())), token[:16])
    now = time.time()
    if ttl > 0 and ck in _cache and now - _cache[ck][0] < ttl:
        return _cache[ck][1]
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{EMBED_BASE}{path}", params=params or {},
                                 headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"GOG unreachable: {e}")
    if r.status_code == 401:
        raise HTTPException(status_code=502, detail="GOG session expired — re-link the account in Settings → GOG")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"GOG HTTP {r.status_code}")
    data = r.json()
    if ttl > 0:
        _cache[ck] = (now, data)
    return data

def _img(url):
    """GOG image fields are protocol-relative and extension-less."""
    if not url:
        return None
    return f"https:{url}" if url.startswith("//") else url


# ── schemas ──────────────────────────────────────────────────────────────────
class LinkBody(BaseModel):
    user_id: int
    code:    str   # the ?code= value (or the whole on_login_success URL)


# ── auth / links ─────────────────────────────────────────────────────────────
@router.get("/auth-url")
def auth_url():
    """The browser login URL. After signing in, GOG lands on a blank
    on_login_success page — the one-time code is in that page's address bar."""
    return {"url": LOGIN_URL}


@router.get("/links")
def list_links():
    """Every household profile, with its GOG link if any."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT u.id AS user_id, u.name, u.avatar AS profile_avatar, u.color,
                      l.gog_user_id, l.username, l.avatar AS gog_avatar, l.linked_at
               FROM users u LEFT JOIN gog_links l ON l.user_id = u.id
               ORDER BY u.id"""
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.post("/links")
async def link_profile(body: LinkBody):
    # accept the bare code or the full pasted URL
    m = re.search(r"[?&]code=([^&\s]+)", body.code)
    code = m.group(1) if m else body.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="No login code supplied")

    tok = await _token_request({"grant_type": "authorization_code", "code": code,
                                "redirect_uri": REDIRECT_URI})
    refresh = tok.get("refresh_token")
    access  = tok.get("access_token")
    if not (refresh and access):
        raise HTTPException(status_code=502, detail="GOG returned no tokens — try logging in again")

    user = await gog_get("/userData.json", access, ttl=0)

    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id=?", (body.user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="No such profile")
        conn.execute(
            """INSERT INTO gog_links (user_id, gog_user_id, username, avatar, refresh_token, linked_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(user_id) DO UPDATE SET gog_user_id=excluded.gog_user_id,
                   username=excluded.username, avatar=excluded.avatar,
                   refresh_token=excluded.refresh_token, linked_at=datetime('now')""",
            (body.user_id, str(user.get("userId") or user.get("galaxyUserId") or ""),
             user.get("username"), _img(user.get("avatar")), refresh)
        )
        conn.commit()
    finally:
        conn.close()
    _access.pop(body.user_id, None)
    _access[body.user_id] = (time.time() + int(tok.get("expires_in", 3600)) - 60, access)
    return {"ok": True, "username": user.get("username")}


@router.delete("/links/{user_id}")
def unlink_profile(user_id: int):
    conn = get_db()
    try:
        conn.execute("DELETE FROM gog_links WHERE user_id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    _access.pop(user_id, None)
    return {"ok": True}


# ── library ──────────────────────────────────────────────────────────────────
@router.get("/library/{user_id}")
async def library(user_id: int):
    """The linked profile's owned games (mediaType=1), paged through GOG's
    account endpoint and trimmed to what the grid shows."""
    token = await access_token_for(user_id)

    games, page, total_pages = [], 1, 1
    while page <= total_pages and page <= 50:   # 100 products/page; cap = sanity
        data = await gog_get("/account/getFilteredProducts", token,
                             {"mediaType": 1, "hiddenFlag": 0, "sortBy": "title", "page": page})
        total_pages = data.get("totalPages", 1)
        for p in data.get("products", []):
            games.append({
                "id":     p["id"],
                "title":  p.get("title") or str(p["id"]),
                "image":  _img(p.get("image")),
                "url":    f"https://www.gog.com{p['url']}" if p.get("url") else None,
                "works_on": [os for os, ok in (p.get("worksOn") or {}).items() if ok],
            })
        page += 1

    conn = get_db()
    try:
        link = conn.execute("SELECT username, avatar FROM gog_links WHERE user_id=?", (user_id,)).fetchone()
    finally:
        conn.close()
    return {
        "profile": {"username": link["username"], "avatar": link["avatar"]} if link else None,
        "game_count": len(games),
        "games": games,
    }
