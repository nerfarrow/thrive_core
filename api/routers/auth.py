# =============================================================================
# routers/auth.py — Platform auth (users, sessions, roles)
# thrive_base
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional
import sqlite3, os, hashlib, secrets, hmac
from datetime import datetime, timedelta

router = APIRouter(prefix="/auth", tags=["auth"])

DB_PATH       = os.environ.get("DB_FILE", "/data/thrivebase.db")
COOKIE_NAME   = "thrivebase_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"
SESSION_DAYS  = int(os.environ.get("SESSION_DAYS", "30"))
PBKDF2_ITERS  = 200_000

PUBLIC_PATHS = {"/health", "/auth/status", "/auth/login", "/auth/logout", "/auth/register"}


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                email         TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT DEFAULT 'member',
                totp_secret   TEXT,
                disabled      INTEGER DEFAULT 0,
                created_at    TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── password + session ───────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk   = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERS)
    return f"pbkdf2_sha256${PBKDF2_ITERS}${salt.hex()}${dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False

def create_session(conn, user_id: int) -> str:
    token   = secrets.token_urlsafe(32)
    expires = (datetime.utcnow() + timedelta(days=SESSION_DAYS)).isoformat()
    conn.execute("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)", (token, user_id, expires))
    return token

def user_from_token(token: Optional[str]) -> Optional[dict]:
    if not token: return None
    conn = get_db()
    try:
        row = conn.execute(
            """SELECT s.expires_at, u.id, u.username, u.email, u.role, u.disabled
               FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?""",
            (token,)
        ).fetchone()
        if not row or row["disabled"]: return None
        if row["expires_at"] < datetime.utcnow().isoformat():
            conn.execute("DELETE FROM sessions WHERE token=?", (token,)); conn.commit(); return None
        return {"id": row["id"], "username": row["username"], "email": row["email"], "role": row["role"]}
    finally:
        conn.close()

def current_user_from_request(request: Request) -> Optional[dict]:
    return user_from_token(request.cookies.get(COOKIE_NAME))

def _set_cookie(response: Response, token: str):
    response.set_cookie(key=COOKIE_NAME, value=token, max_age=SESSION_DAYS * 86400,
                        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/")


# ── schemas ──────────────────────────────────────────────────────────────────
class RegisterBody(BaseModel):
    username: str
    password: str
    email:    Optional[str] = None
    role:     Optional[str] = None

class LoginBody(BaseModel):
    username: str
    password: str

class RoleBody(BaseModel):
    role: str

class PasswordBody(BaseModel):
    password: str

class DisabledBody(BaseModel):
    disabled: bool


# ── helpers ───────────────────────────────────────────────────────────────────
def _count_users(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]

def _require_admin(request: Request) -> dict:
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin": raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── public routes ─────────────────────────────────────────────────────────────
@router.get("/status")
def status():
    conn = get_db()
    try: return {"setup_needed": _count_users(conn) == 0}
    finally: conn.close()

@router.post("/register", status_code=201)
def register(body: RegisterBody, request: Request, response: Response):
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    conn = get_db()
    try:
        first = _count_users(conn) == 0
        if first:
            role = "admin"
        else:
            actor = current_user_from_request(request)
            if not actor or actor["role"] != "admin":
                raise HTTPException(status_code=403, detail="Only an admin can create users")
            role = body.role if body.role in ("admin", "member") else "member"
        if conn.execute("SELECT id FROM users WHERE username=?", (body.username,)).fetchone():
            raise HTTPException(status_code=409, detail="Username already taken")
        cur = conn.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)",
            (body.username, body.email, hash_password(body.password), role)
        )
        conn.commit()
        if first:
            token = create_session(conn, cur.lastrowid); conn.commit()
            _set_cookie(response, token)
        return dict(conn.execute("SELECT id, username, email, role FROM users WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.post("/login")
def login(body: LoginBody, response: Response):
    conn = get_db()
    try:
        row    = conn.execute("SELECT * FROM users WHERE username=?", (body.username,)).fetchone()
        stored = row["password_hash"] if row else "pbkdf2_sha256$1$00$00"
        ok     = verify_password(body.password, stored)
        if not row or not ok or row["disabled"]:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_session(conn, row["id"]); conn.commit()
        _set_cookie(response, token)
        return {"id": row["id"], "username": row["username"], "email": row["email"], "role": row["role"]}
    finally:
        conn.close()

@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        conn = get_db()
        try: conn.execute("DELETE FROM sessions WHERE token=?", (token,)); conn.commit()
        finally: conn.close()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}

@router.get("/me")
def me(request: Request):
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ── admin user management ─────────────────────────────────────────────────────
@router.get("/users")
def list_users(request: Request):
    _require_admin(request)
    conn = get_db()
    try: return [dict(r) for r in conn.execute("SELECT id, username, email, role, disabled, created_at FROM users ORDER BY id").fetchall()]
    finally: conn.close()

@router.patch("/users/{user_id}/role")
def set_role(user_id: int, body: RoleBody, request: Request):
    actor = _require_admin(request)
    if body.role not in ("admin", "member"): raise HTTPException(status_code=400, detail="Invalid role")
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if t["role"] == "admin" and body.role == "member":
            if conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").fetchone()["n"] <= 1:
                raise HTTPException(status_code=400, detail="Can't remove the last admin")
        conn.execute("UPDATE users SET role=? WHERE id=?", (body.role, user_id)); conn.commit()
        return dict(conn.execute("SELECT id, username, email, role, disabled FROM users WHERE id=?", (user_id,)).fetchone())
    finally: conn.close()

@router.patch("/users/{user_id}/disabled")
def set_disabled(user_id: int, body: DisabledBody, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if body.disabled and t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't disable yourself")
        if body.disabled and t["role"] == "admin":
            if conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").fetchone()["n"] <= 1:
                raise HTTPException(status_code=400, detail="Can't disable the last admin")
        conn.execute("UPDATE users SET disabled=? WHERE id=?", (1 if body.disabled else 0, user_id))
        if body.disabled: conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.commit()
        return dict(conn.execute("SELECT id, username, email, role, disabled FROM users WHERE id=?", (user_id,)).fetchone())
    finally: conn.close()

@router.patch("/users/{user_id}/password")
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
    finally: conn.close()

@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="User not found")
        if t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't delete yourself")
        if t["role"] == "admin":
            if conn.execute("SELECT COUNT(*) AS n FROM users WHERE role='admin'").fetchone()["n"] <= 1:
                raise HTTPException(status_code=400, detail="Can't delete the last admin")
        conn.execute("DELETE FROM users WHERE id=?", (user_id,)); conn.commit()
    finally: conn.close()