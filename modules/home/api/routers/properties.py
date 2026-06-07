# =============================================================================
# routers/properties.py — Home module: properties (primary home + future
# vacation/travel places)
# thrive module `home`
#
# A "property" is a place — your primary home base today, with room for
# vacation/travel/other later. Holds address, an optional geocoded pin for the
# map, size (beds/baths/sqft) and rental/landlord details.
#
# Self-contained per the module loader: reuses the platform DB helper so it
# shares the one thrive.db, creates its own table in an idempotent
# init_db() at import time, and gates writes to admins.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import Optional
import json, urllib.parse, urllib.request

from routers.auth import get_db, current_user_from_request

router = APIRouter(prefix="/properties", tags=["properties"])

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


# ── db ─────────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS properties (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                kind            TEXT    DEFAULT 'home',   -- 'home' | 'vacation' | 'travel' | 'other'
                label           TEXT,
                address         TEXT,
                lat             REAL,
                lng             REAL,
                sqft            REAL,
                beds            REAL,
                baths           REAL,
                is_rental       INTEGER DEFAULT 0,
                landlord        TEXT,
                landlord_notes  TEXT,
                notes           TEXT,
                created_at      TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── auth helpers ─────────────────────────────────────────────────────────────
def _require_user(request: Request) -> dict:
    user = current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

def _require_admin(request: Request) -> dict:
    user = _require_user(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── schemas ────────────────────────────────────────────────────────────────
class PropertyCreate(BaseModel):
    kind:           Optional[str]   = "home"
    label:          Optional[str]   = None
    address:        Optional[str]   = None
    lat:            Optional[float] = None
    lng:            Optional[float] = None
    sqft:           Optional[float] = None
    beds:           Optional[float] = None
    baths:          Optional[float] = None
    is_rental:      Optional[bool]  = False
    landlord:       Optional[str]   = None
    landlord_notes: Optional[str]   = None
    notes:          Optional[str]   = None

class PropertyUpdate(PropertyCreate):
    pass


_COLS = ("kind", "label", "address", "lat", "lng", "sqft", "beds", "baths",
         "is_rental", "landlord", "landlord_notes", "notes")

def _vals(p: PropertyCreate):
    return (
        p.kind or "home", p.label, p.address, p.lat, p.lng, p.sqft, p.beds, p.baths,
        1 if p.is_rental else 0, p.landlord, p.landlord_notes, p.notes,
    )


# ── geocode (typed address → lat/lng via OpenStreetMap Nominatim) ───────────
@router.get("/geocode")
def geocode(request: Request, q: str = Query(..., min_length=3)):
    """Forward-geocode a typed address. No API key; Nominatim fair-use applies.

    Uses stdlib urllib (no extra deps); FastAPI runs this sync def in a
    threadpool so the blocking call doesn't stall the event loop.
    """
    _require_user(request)
    params = urllib.parse.urlencode({
        "q": q, "format": "json", "limit": 1, "addressdetails": 1,
    })
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": "thrive-home/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # urllib raises a grab-bag of errors
        raise HTTPException(status_code=502, detail=f"Geocode failed: {str(e)[:120]}")
    if not data:
        return {"found": False}
    top = data[0]
    try:
        return {
            "found": True,
            "lat": float(top["lat"]),
            "lng": float(top["lon"]),
            "display_name": top.get("display_name"),
        }
    except (KeyError, ValueError):
        return {"found": False}


# ── home convenience (the primary place you live) ───────────────────────────
@router.get("/home")
def get_home(request: Request):
    _require_user(request)
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT * FROM properties WHERE kind='home' ORDER BY id ASC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── crud ────────────────────────────────────────────────────────────────────
@router.get("")
def list_properties(request: Request):
    _require_user(request)
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM properties ORDER BY (kind!='home'), id ASC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@router.post("", status_code=201)
def create_property(request: Request, p: PropertyCreate):
    _require_admin(request)
    conn = get_db()
    try:
        placeholders = ",".join(["?"] * len(_COLS))
        cur = conn.execute(
            f"INSERT INTO properties ({','.join(_COLS)}) VALUES ({placeholders})",
            _vals(p)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM properties WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.patch("/{property_id}")
def update_property(request: Request, property_id: int, p: PropertyUpdate):
    _require_admin(request)
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM properties WHERE id=?", (property_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Property not found")
        sets = ",".join(f"{c}=?" for c in _COLS)
        conn.execute(f"UPDATE properties SET {sets} WHERE id=?", (*_vals(p), property_id))
        conn.commit()
        return dict(conn.execute("SELECT * FROM properties WHERE id=?", (property_id,)).fetchone())
    finally:
        conn.close()

@router.delete("/{property_id}", status_code=204)
def delete_property(request: Request, property_id: int):
    _require_admin(request)
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM properties WHERE id=?", (property_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Property not found")
        conn.execute("DELETE FROM properties WHERE id=?", (property_id,))
        conn.commit()
    finally:
        conn.close()
