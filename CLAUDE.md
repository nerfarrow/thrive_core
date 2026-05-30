# thrive_base — Claude Context

## What this is
thrive_base is the platform shell for a modular self-hosted household/lifestyle app.
It provides auth, a module loader, and a landing page. Everything else is a module.

The broader vision is "thriveOS" — a custom Linux distro where thrive_base is the 
entire point of the machine. But thrive_base itself runs on any Linux box via Docker.

## Related projects
- `thrive` (nerfarrow/thrive) — the original monolithic app at thrive.nerfarrow.com. 
  DO NOT touch this. It's live and working. thrive_base is the clean rewrite.
- `thriveOS` — future custom distro, not started yet
- Module repos live under thrive_base/modules/ (cloned separately)

## Architecture

### Backend
- FastAPI, Python 3.12
- Plain `sqlite3` with `conn.row_factory = sqlite3.Row`
- One shared DB: `/data/thrivebase.db`
- Auth: PBKDF2-HMAC-SHA256 (stdlib, no deps), httpOnly session cookie
- Cookie name: `thrivebase_session`
- `COOKIE_SECURE=false` for local http dev, `true` for HTTPS production
- Module loader: `api/modules.py` scans `modules/` on startup

### Frontend  
- React + Vite
- No component library — inline styles using CSS vars
- Dark mono aesthetic (Space Mono + DM Sans fonts)
- CSS vars: `--bg-primary #0f0f0f`, `--bg-secondary #181818`, `--bg-tertiary #222`
- `--text-primary #e8e6e0`, `--text-secondary #aaa`, `--text-tertiary #666`
- `--color-success #22c55e`, `--color-danger #ef4444`
- `--border-color #2a2a2a`
- API calls via `src/api.js` — uses `credentials: 'include'`, fires `thrivebase:unauthorized` event on 401

### Deploy
- Docker Compose, port 9500
- UI container: nginx serving Vite build, proxies `/api/` to `thrivebase_api:8000`
- `modules/` folder mounted as volume into API container — no rebuild needed to install modules

## Module System

### How it works
1. On API startup, `modules.py` scans `/app/modules/` for folders with `module.json`
2. Discovered modules are synced to the `modules` DB table
3. Enabled modules have their API routers dynamically imported and registered
4. Frontend fetches `GET /modules` to know what's installed/enabled
5. Landing page shows enabled module cards
6. Top bar shows module nav icons

### module.json spec
```json
{
  "id": "vehicles",
  "name": "Vehicles", 
  "icon": "🚗",
  "description": "Garage, MPG tracking, oil changes and tires",
  "version": "0.1.0",
  "color": "#3b82f6",
  "nav_path": "/vehicles",
  "api_routers": ["api.routers.vehicles", "api.routers.mpg"],
  "requires": []
}
```

### Installing a module
```bash
cd ~/thrive_base/modules
git clone git@github.com:nerfarrow/thrive_vehicles.git vehicles
docker compose restart api   # no rebuild needed
```

### Installed modules
- `modules/users/` — user management (admin Users page, roles, disable/enable)
- `modules/vehicles/` — garage + MPG tracking

### DB table ownership
- `thrive_base` owns: `users`, `sessions`, `modules`
- `users` module owns: (currently uses base users table, may add user_preferences later)
- `vehicles` module owns: `vehicles`, `oil_changes`, `tires`, `mpg_entries`

## Auth Flow
- `GET /auth/status` — public, returns `{setup_needed: bool}`
- First user to register becomes admin automatically
- After first user, only admins can register new users via `POST /auth/register`
- Session cookie set on login, cleared on logout
- Auth gate middleware in `main.py` blocks all routes except PUBLIC_PATHS
- PUBLIC_PATHS: `/health`, `/auth/status`, `/auth/login`, `/auth/logout`, `/auth/register`

## File Structure
```
thrive_base/
├── CLAUDE.md               ← you are here
├── docker-compose.yml
├── data/                   ← gitignored, holds thrivebase.db
├── modules/                ← gitignored contents, modules cloned here
│   ├── users/
│   │   └── module.json
│   └── vehicles/
│       └── module.json
├── api/
│   ├── Dockerfile
│   ├── main.py             ← auth gate + module bootstrap + /modules API
│   ├── modules.py          ← module discovery, loader, registry
│   ├── requirements.txt
│   └── routers/
│       └── auth.py         ← users, sessions, admin user management
└── ui/
    ├── Dockerfile
    ├── index.html
    ├── nginx.conf
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx          ← auth gate (Gate), Shell (TopNav + routes)
        ├── api.js           ← fetch wrapper with credentials + 401 handling
        ├── index.css        ← CSS vars + base reset
        ├── main.jsx
        ├── context/
        │   └── AuthContext.jsx
        ├── components/
        │   └── LoginPage.jsx   ← login + first-run setup + show/hide password
        └── pages/
            ├── LandingPage.jsx  ← dynamic module cards from GET /modules
            └── SettingsPage.jsx ← account, users (admin), modules enable/disable
```

## What's been built
- [x] Auth (login, sessions, roles, first-run setup)
- [x] Module loader (filesystem scan, DB registry, dynamic router import)
- [x] Landing page (dynamic module cards)
- [x] Settings page (account, user management, module enable/disable)
- [x] Show/hide password on login screen
- [x] Module manifests for users and vehicles (module.json only, no routers yet)

## What's next
- [ ] Fix COOKIE_SECURE=false for local dev (currently set to true, breaks http)
- [ ] Build users module API routers (api/routers/users.py in modules/users/)
- [ ] Build vehicles module API routers (api/routers/vehicles.py, mpg.py in modules/vehicles/)
- [ ] Wire module nav icons into top bar dynamically (read from GET /modules)
- [ ] Module UI pages (each module brings its own React pages)
- [ ] thrive_budget module (port from thrive monolith)
- [ ] thrive_vault module (Vaultwarden client built in)

## Conventions
- Backend: idempotent `init_db()` with `ALTER TABLE` only for new columns
- Frontend: inline styles, no CSS classes except where existing CSS file requires
- No new npm deps without good reason — check if stdlib or existing dep covers it
- Routers use `get_db()` → per-request sqlite connection, closed in `finally`
- Amount money values stored as INTEGER cents (e.g. $12.34 = 1234)
- Dates stored as TEXT ISO format (YYYY-MM-DD)

## Running locally
```bash
cd ~/thrive_base
docker compose up -d --build   # full rebuild
docker compose restart api     # restart API only (e.g. after adding a module)
docker compose logs api        # check module discovery output
```
Access at http://nerfBase-ip:9500

## Owner
nerfarrow — home server: nerfBase (Ubuntu)
GitHub: github.com/nerfarrow/thrive_base