# thrive_core — Claude Context

## What this is
thrive_core is the platform shell for a modular self-hosted household/lifestyle app.
It provides auth, a module loader, and a landing page. Everything else is a module.

The broader vision is "thriveOS" — a custom Linux distro where thrive_core is the 
entire point of the machine. But thrive_core itself runs on any Linux box via Docker.

## Related projects
- `thrive` (nerfarrow/thrive) — the original monolithic app at thrive.nerfarrow.com. 
  DO NOT touch this. It's live and working. thrive_core is the clean rewrite.
- `thriveOS` — future custom distro, not started yet
- Module repos live under thrive_core/modules/ (cloned separately)

## Architecture

### Backend
- FastAPI, Python 3.12
- Plain `sqlite3` with `conn.row_factory = sqlite3.Row`
- One shared DB: `/data/thrivecore.db`
- Auth: PBKDF2-HMAC-SHA256 (stdlib, no deps), httpOnly session cookie
- Cookie name: `thrivecore_session`
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
- API calls via `src/api.js` — uses `credentials: 'include'`, fires `thrivecore:unauthorized` event on 401

### Deploy
- Docker Compose, port 9500
- UI container: nginx serving Vite build, proxies `/api/` to `thrivecore_api:8000`
- `modules/` folder mounted as volume into API container — no rebuild needed to install modules

## Module System

### How it works
1. On API startup, `modules.py` scans `/app/modules/` for folders with `module.json`
2. Discovered modules are synced to the `modules` DB table. **Discovery ≠ install:**
   a newly discovered module registers as `installed=0, enabled=0` — install is
   opt-in via Settings → Modules (Available → Install). A module is **active**
   (routers load, landing tile, nav icon) only when `installed=1 AND enabled=1`.
3. Active modules have each `api_routers` entry loaded **from its file** under a
   unique synthetic module name (see note below) and registered on the app
4. Frontend fetches `GET /modules` to know what's discovered/installed/enabled
5. Landing page shows active module cards; top bar shows active module nav icons

**Router loading note:** every module declares routers under the same dotted path
(`api.routers.<name>`), so the loader does NOT use `importlib.import_module` — that
would make the first-loaded module's `api` package shadow all the others. Instead
`load_module_routers()` maps the dotted path to `<module>/api/routers/<name>.py`
and loads it via `spec_from_file_location` under a unique name. Consequences:
- modules **do not need `__init__.py`** anywhere
- each router file must be self-contained: import platform helpers with
  `from routers.auth import get_db, current_user_from_request`, define `router`,
  and create its own tables in an idempotent `init_db()` called at module top level

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
Optional `"core": true` marks a module as required by the platform — the API
refuses to disable it and the Settings UI shows a 🔒 lock instead of a toggle.
No module is currently core. The mechanism exists for any future module the
platform genuinely can't run without.

### Installing a module
```bash
cd ~/thrive_core/modules
git clone git@github.com:nerfarrow/thrive_vehicles.git vehicles
docker compose restart api   # no rebuild needed
```

### Bundled module
thrive_core bundles one module: `users`. It's the only module tracked in this
repo (`.gitignore` ignores `modules/*` except `modules/users/`). Everything
else — vehicles, budget, vault — is a separate repo you install into `modules/`.
- `modules/users/` — **household profiles** (the people in the home): add/edit/
  delete profiles with name + avatar + color. A profile is a *person*, not a login.

**Account vs user/profile** — the platform deliberately separates the two:
- An **account** (`accounts` table) is a login credential (username/password/role).
  Accounts are core/auth-level and managed in **Settings → Accounts** (admin only).
- A **user** (`users` table) is a household profile/person. Managed by the `users`
  module under `/users`. A profile can exist with **no account** (shared/kiosk).
- An account links to one profile via `accounts.user_id`; signing in drops you into
  that profile. `/auth/me` returns the account fields plus `profile: {…} | null`.

`users` is a normal, optional module (not core) — toggled in Settings → Modules,
shown as a landing tile. **Auth** (login/session/`/me`/first-run bootstrap +
`accounts` management via `routers/accounts.py`) lives in core; the **users
module** owns only profiles. It's bundled today only because modules can't yet
ship their own React pages — once they can, it can move to its own `thrive_users` repo.

### DB table ownership
- `thrive_core` owns: `accounts` (login creds), `users` (profiles), `sessions`, `modules`
- `users` module: reads/writes the core `users` (profiles) table
- installed modules own their own tables (e.g. a vehicles module would own
  `vehicles`, `oil_changes`, `tires`, `mpg_entries`)

## Auth Flow
- `GET /auth/status` — public, returns `{setup_needed: bool}`
- `POST /auth/register` is first-run owner bootstrap only — creates the first
  admin **account** plus a matching **profile** and links them; returns 403 after
- Additional accounts are created in Settings → Accounts: `POST /accounts` (admin)
- Profiles (people) are created via the users module: `POST /users` (admin only)
- Session cookie set on login, cleared on logout
- Auth gate middleware in `main.py` blocks all routes except PUBLIC_PATHS
- PUBLIC_PATHS: `/health`, `/auth/status`, `/auth/login`, `/auth/logout`, `/auth/register`

## File Structure
```
thrive_core/
├── CLAUDE.md               ← you are here
├── docker-compose.yml
├── data/                   ← gitignored, holds thrivecore.db
├── modules/                ← only users/ is tracked; other modules cloned here
│   └── users/              ← bundled default module
│       ├── module.json
│       └── api/routers/users.py   ← household profile CRUD (people, not logins)
├── api/
│   ├── Dockerfile
│   ├── main.py             ← auth gate + module bootstrap + /modules API
│   ├── modules.py          ← module discovery, loader, registry
│   ├── requirements.txt
│   └── routers/
│       ├── auth.py         ← auth: login/session/me/first-run + schema & migration
│       └── accounts.py     ← admin account mgmt (creds, roles, link account→profile)
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
            ├── SettingsPage.jsx ← signed-in profile, Accounts (admin), modules
            └── UsersPage.jsx    ← users module page: household profiles (calls /users*)
```

## What's been built
- [x] Auth (login, sessions, roles, first-run setup)
- [x] Module loader (filesystem scan, DB registry, dynamic router import)
- [x] Landing page (dynamic module cards)
- [x] Settings page (account, user management, module enable/disable)
- [x] Show/hide password on login screen
- [x] Bundled `users` module with admin user management API (modules/users/api/routers/users.py)
- [x] Split auth (core) from user management (users module); `users` is no longer core
- [x] UsersPage + dynamic module nav icons in top bar (from GET /modules)
- [x] COOKIE_SECURE=false for local http dev
- [x] Modules: discovered ≠ installed — auto-discovery, but install is opt-in in Settings
- [x] Split **account** (login cred, core/Settings) from **user/profile** (people, users
      module); `accounts.user_id` links an account to a profile; `users` module = profiles

## What's next
- [ ] UI "install module" flow (currently install = clone into modules/ + restart api)
- [ ] Module UI pages (each module brings its own React pages) — prereq for
      splitting `users` out into its own `thrive_users` repo
- [ ] Install-time module selection (choose which modules enabled on setup)
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
cd ~/thrive_core
docker compose up -d --build   # full rebuild
docker compose restart api     # restart API only (e.g. after adding a module)
docker compose logs api        # check module discovery output
```
Access at http://nerfBase-ip:9500

## Owner
nerfarrow — home server: nerfBase (Ubuntu)
GitHub: github.com/nerfarrow/thrive_core