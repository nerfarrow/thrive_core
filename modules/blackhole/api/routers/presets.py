# =============================================================================
# routers/presets.py — Black Hole module: saved render presets
# thrive_core module `blackhole`
#
# Stores user-saved looks ({ toggles, params, quality }) so the background and
# full view can offer a dropdown of presets alongside the library's built-ins.
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import os, sqlite3, json

from routers.auth import get_db as _connect

router = APIRouter(prefix="/blackhole/presets", tags=["blackhole"])


def get_db():
    db = sqlite3.connect(os.environ.get("DB_FILE", "/data/thrivecore.db"), check_same_thread=False)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()


def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS blackhole_presets (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                data       TEXT NOT NULL,         -- JSON { toggles, params, quality }
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


class PresetIn(BaseModel):
    name: str
    data: dict   # { toggles, params, quality }


def _row(r):
    d = dict(r)
    try:
        d["data"] = json.loads(d["data"])
    except Exception:
        d["data"] = {}
    return d


@router.get("/")
def list_presets(db=Depends(get_db)):
    rows = db.execute(
        "SELECT id, name, data, created_at FROM blackhole_presets ORDER BY name"
    ).fetchall()
    return [_row(r) for r in rows]


@router.post("/", status_code=201)
def save_preset(body: PresetIn, db=Depends(get_db)):
    """Create, or overwrite by name (so re-saving a name updates it)."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    payload = json.dumps(body.data)
    existing = db.execute("SELECT id FROM blackhole_presets WHERE name=?", (name,)).fetchone()
    if existing:
        db.execute("UPDATE blackhole_presets SET data=? WHERE id=?", (payload, existing["id"]))
        db.commit()
        return {"id": existing["id"], "name": name, "data": body.data}
    cur = db.execute("INSERT INTO blackhole_presets (name, data) VALUES (?, ?)", (name, payload))
    db.commit()
    return {"id": cur.lastrowid, "name": name, "data": body.data}


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db=Depends(get_db)):
    db.execute("DELETE FROM blackhole_presets WHERE id=?", (preset_id,))
    db.commit()
