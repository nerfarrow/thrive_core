# =============================================================================
# main.py — thrive_base API
# Minimal platform: auth only. Modules register their own routers.
# =============================================================================
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers.auth import router as auth_router, current_user_from_request, PUBLIC_PATHS

app = FastAPI(title="thrive_base", version="0.1.0")

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

app.include_router(auth_router)

@app.get("/health")
def health():
    return {"status": "ok", "platform": "thrive_base"}