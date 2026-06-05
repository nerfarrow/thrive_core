# =============================================================================
# routers/users.py — Users module: admin user management
# thrive_base module `users`
#
# The base platform (routers/auth.py) owns the `users`/`sessions` tables and
# already exposes account + auth flows under /auth. This module surfaces the
# admin management surface under /users, reusing the platform's DB + password
# helpers so hashing and session handling stay identical to the base.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

# Reuse the platform's helpers — routers.auth is on sys.path (base api dir) and
# already imported by main.py, so this keeps the password hash format and the
# session table in lockstep with the rest of thrive_base.
from routers.auth import get_db, hash_password, current_user_from_request

router = APIRouter(prefix="/users", tags=["users"])


# ── schemas ──────────────────────────────────────────────────────────────────
class CreateBody(BaseModel):
    username: str
    password: str
    email:    Optional[str] = None
    role:     Optional[str] = None

class RoleBody(BaseModel):
    role: str

class PasswordBody(BaseModel):
    password: str

class DisabledBody(BaseModel):
    disabled: bool


# ── helpers ───────────────────────────────────────────────────────────────────
def _require_admin(request: Request) -> dict:
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin": raise HTTPException(status_code=403, detail="Admin only")
    return user

def _active_admin_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").fetchone()["n"]


# ── admin user management ─────────────────────────────────────────────────────
@router.get("")
def list_users(request: Request):
    _require_admin(request)
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT id, username, email, role, disabled, created_at FROM users ORDER BY id"
        ).fetchall()]
    finally:
        conn.close()

@router.post("", status_code=201)
def create_user(body: CreateBody, request: Request):
    _require_admin(request)
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    role = body.role if body.role in ("admin", "member") else "member"
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM users WHERE username=?", (body.username,)).fetchone():
            raise HTTPException(status_code=409, detail="Username already taken")
        cur = conn.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)",
            (body.username, body.email, hash_password(body.password), role)
        )
        conn.commit()
        return dict(conn.execute("SELECT id, username, email, role FROM users WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.patch("/{user_id}/role")
def set_role(user_id: int, body: RoleBody, request: Request):
    _require_admin(request)
    if body.role not in ("admin", "member"): raise HTTPException(status_code=400, detail="Invalid role")
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if t["role"] == "admin" and body.role == "member" and _active_admin_count(conn) <= 1:
            raise HTTPException(status_code=400, detail="Can't remove the last admin")
        conn.execute("UPDATE users SET role=? WHERE id=?", (body.role, user_id)); conn.commit()
        return dict(conn.execute("SELECT id, username, email, role, disabled FROM users WHERE id=?", (user_id,)).fetchone())
    finally:
        conn.close()

@router.patch("/{user_id}/disabled")
def set_disabled(user_id: int, body: DisabledBody, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if body.disabled and t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't disable yourself")
        if body.disabled and t["role"] == "admin" and _active_admin_count(conn) <= 1:
            raise HTTPException(status_code=400, detail="Can't disable the last admin")
        conn.execute("UPDATE users SET disabled=? WHERE id=?", (1 if body.disabled else 0, user_id))
        if body.disabled: conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()
        return dict(conn.execute("SELECT id, username, email, role, disabled FROM users WHERE id=?", (user_id,)).fetchone())
    finally:
        conn.close()

@router.patch("/{user_id}/password")
def reset_password(user_id: int, body: PasswordBody, request: Request):
    _require_admin(request)
    if len(body.password) < 8: raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(body.password), user_id))
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't delete yourself")
        if t["role"] == "admin" and conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin'").fetchone()["n"] <= 1:
            raise HTTPException(status_code=400, detail="Can't delete the last admin")
        conn.execute("DELETE FROM users WHERE id=?", (user_id,)); conn.commit()
    finally:
        conn.close()
