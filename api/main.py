# =============================================================================
# main.py — thrive_core API
# Platform shell: auth gate + module loader.
# Modules register their own routers via modules.py bootstrap.
# =============================================================================
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers.auth import router as auth_router, current_user_from_request, PUBLIC_PATHS
import modules as mod_registry

app = FastAPI(title="thrive_core", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── auth gate ────────────────────────────────────────────────────────────────
@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in PUBLIC_PATHS:
        return await call_next(request)
    user = current_user_from_request(request)
    if not user:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    request.state.user = user
    return await call_next(request)

# ── core routers ──────────────────────────────────────────────────────────────
app.include_router(auth_router)

# ── modules api ───────────────────────────────────────────────────────────────
@app.get("/modules")
def get_modules():
    """List all installed modules with enabled state."""
    return mod_registry.list_modules()

@app.patch("/modules/{module_id}")
def update_module(module_id: str, request: Request, body: dict):
    """Enable or disable a module (admin only)."""
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if "enabled" not in body:
        raise HTTPException(status_code=400, detail="Missing 'enabled' field")
    if not bool(body["enabled"]) and mod_registry.is_core_module(module_id):
        raise HTTPException(status_code=400, detail="Cannot disable a core module")
    ok = mod_registry.set_module_enabled(module_id, bool(body["enabled"]))
    if not ok:
        raise HTTPException(status_code=404, detail="Module not found")
    return {"ok": True, "note": "Restart API to apply changes"}

# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "platform": "thrive_core"}

# ── bootstrap modules on startup ──────────────────────────────────────────────
@app.on_event("startup")
def startup():
    mod_registry.bootstrap(app)