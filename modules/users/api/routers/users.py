# =============================================================================
# routers/users.py — Users module: household profiles
# thrive module `users`
#
# A "user" here is a person/profile in the household — name + avatar, not a
# login. Login credentials are `accounts`, owned by the core platform and
# managed in Settings; an account may link to one profile (accounts.user_id).
# A profile can exist with no account at all (shared/kiosk profile).
#
# Reuses the platform's DB helper so it shares the one thrive.db.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from routers.auth import get_db, current_user_from_request

router = APIRouter(prefix="/users", tags=["users"])


# ── schemas ──────────────────────────────────────────────────────────────────
class CreateBody(BaseModel):
    name:   str
    avatar: Optional[str] = None
    color:  Optional[str] = None

class UpdateBody(BaseModel):
    name:   Optional[str] = None
    avatar: Optional[str] = None
    color:  Optional[str] = None


# ── helpers ───────────────────────────────────────────────────────────────────
def _require_admin(request: Request) -> dict:
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin": raise HTTPException(status_code=403, detail="Admin only")
    return user

def _row(conn, user_id: int):
    """A profile plus the username of any account linked to it."""
    return conn.execute(
        """SELECT u.id, u.name, u.avatar, u.color, u.created_at, a.username AS account
           FROM users u LEFT JOIN accounts a ON a.user_id = u.id
           WHERE u.id = ?""", (user_id,)
    ).fetchone()


# ── profile management ────────────────────────────────────────────────────────
@router.get("")
def list_users(request: Request):
    # any signed-in account can see the household roster
    if not current_user_from_request(request):
        raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute(
            """SELECT u.id, u.name, u.avatar, u.color, u.created_at, a.username AS account
               FROM users u LEFT JOIN accounts a ON a.user_id = u.id ORDER BY u.id"""
        ).fetchall()]
    finally:
        conn.close()

@router.post("", status_code=201)
def create_user(body: CreateBody, request: Request):
    _require_admin(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    conn = get_db()
    try:
        cur = conn.execute(
            "INSERT INTO users (name, avatar, color) VALUES (?,?,?)",
            (name, body.avatar, body.color)
        )
        conn.commit()
        return dict(_row(conn, cur.lastrowid))
    finally:
        conn.close()

@router.patch("/{user_id}")
def update_user(user_id: int, body: UpdateBody, request: Request):
    _require_admin(request)
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        fields, vals = [], []
        if body.name is not None:
            name = body.name.strip()
            if not name: raise HTTPException(status_code=400, detail="Name can't be empty")
            fields.append("name=?");   vals.append(name)
        if body.avatar is not None: fields.append("avatar=?"); vals.append(body.avatar)
        if body.color  is not None: fields.append("color=?");  vals.append(body.color)
        if fields:
            vals.append(user_id)
            conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id=?", vals)
            conn.commit()
        return dict(_row(conn, user_id))
    finally:
        conn.close()

@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request):
    _require_admin(request)
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        # any account linked to this profile is unlinked via FK ON DELETE SET NULL
        conn.execute("DELETE FROM users WHERE id=?", (user_id,)); conn.commit()
    finally:
        conn.close()
