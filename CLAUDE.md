# thrive — Claude Context

## What this is
`thrive` is a modular self-hosted household/lifestyle app. This repo is an
**umbrella** with three parts:
- `core/` — the platform shell: auth, a module loader, settings, landing page.
  Everything else is a module. `core/` is self-contained and runnable on its own.
- `modules/` — the pluggable features (budget, vehicles, vault, home, users,
  blackhole). Bind-mounted into the API container at runtime.
- `os/` — **thriveOS**, the appliance-image build (merged in from its own repo,
  history preserved). A reproducible amd64 Debian image, assembled declaratively
  with `mkosi`, that boots straight into thrive. Self-contained; builds in a
  privileged Docker container, host needs only Docker. See `os/README.md`.

thrive runs on any Linux box via Docker; thriveOS is the "appliance" path where
thrive is the entire point of the machine.

## Related projects
- **The old `thrive` monolith is RETIRED.** It ran at thrive.nerfarrow.com; on
  2026-06-07 it was brought down, backed up (`~/backups/thrive-*.tar.gz`, also in
  Borg), and `~/thrive` (its old dir) deleted. This repo (formerly `thrive_core`)
  is the clean rewrite and took over the `thrive` name.
- `thriveSandbox` — read-only clone of the old monolith, kept as a porting reference.
- `thriveOS` — **now lives in `os/`** (merged from its own repo, history preserved).
  v0 builds a bootable amd64 appliance image; see `os/README.md` for status.

## Repo layout
```
thrive/                         (git: nerfarrow/thrive)
├── CLAUDE.md                    ← you are here (umbrella context)
├── README.md
├── .gitignore                  ← governs the whole repo
├── core/                       the platform shell
│   ├── docker-compose.yml      ← run the stack from HERE (mounts ../modules)
│   ├── .dockerignore
│   ├── data/                   ← gitignored: thrive.db + vault/ (runtime)
│   ├── blackhole-lensing/      ← shared WebGL lib (UI imports via Vite alias)
│   ├── api/
│   │   ├── Dockerfile
│   │   ├── main.py             ← auth gate + module bootstrap + /modules API
│   │   ├── modules.py          ← module discovery, loader, registry
│   │   ├── requirements.txt
│   │   └── routers/
│   │       ├── auth.py         ← login/session/me/first-run + schema & migration
│   │       └── accounts.py     ← admin account mgmt (creds, roles, link→profile)
│   └── ui/
│       ├── Dockerfile  index.html  nginx.conf  package.json  vite.config.js
│       └── src/
│           ├── App.jsx          ← auth gate (Gate), Shell (TopNav + routes)
│           ├── api.js           ← fetch wrapper + 401 handling
│           ├── index.css  main.jsx
│           ├── context/  components/  pages/
├── modules/                    pluggable features (all tracked in this repo today)
│   ├── users/      ← household profiles (people, not logins)
│   ├── home/       ← properties/home base
│   ├── budget/     ← accounts, transactions, categories, payees, scheduled, plaid, reports
│   ├── vehicles/   ← garage, MPG, oil/tires
│   ├── vault/      ← Vaultwarden integration (served at /vault)
│   └── blackhole/  ← black-hole renderer page + DB-backed presets
└── os/                         thriveOS appliance image (mkosi; builds in Docker)
    ├── Makefile    ← make image / vm / vmdk / vdi  (host needs only Docker)
    ├── mkosi.conf  mkosi.extra/  mkosi.postinst   ← image definition + overlay
    ├── build/      ← the privileged build-container (Debian + mkosi + qemu)
    └── .gitignore  ← keeps build artifacts (*.raw/.vmdk/.initrd/…) out of git
```

> **Note on module repos:** the design intent is that each module is its own repo
> cloned into `modules/`. Today they're all **tracked in this one repo** (the
> `.gitignore` un-ignores each `modules/<name>/`) — effectively a monorepo. Splitting
> them back out waits on modules being able to ship their own React pages.

## Architecture

### Backend
- FastAPI, Python 3.12
- Plain `sqlite3` with `conn.row_factory = sqlite3.Row`
- One shared DB: `/data/thrive.db`
- Auth: PBKDF2-HMAC-SHA256 (stdlib, no deps), httpOnly session cookie
- Cookie name: `thrive_session`
- `COOKIE_SECURE=false` for local http dev, `true` for HTTPS production
- Module loader: `core/api/modules.py` scans `/app/modules/` on startup

### Frontend
- React + Vite, no component library — inline styles using CSS vars
- Dark mono aesthetic (Space Mono + DM Sans fonts)
- CSS vars: `--bg-primary #0f0f0f`, `--bg-secondary #181818`, `--bg-tertiary #222`
- `--text-primary #e8e6e0`, `--text-secondary #aaa`, `--text-tertiary #666`
- `--color-success #22c55e`, `--color-danger #ef4444`, `--border-color #2a2a2a`
- `--ui-alpha` drives surface translucency (Settings → UI opacity)
- API calls via `src/api.js` — `credentials: 'include'`, fires `thrive:unauthorized` on 401
- Custom in-app events/localStorage keys are namespaced `thrive:*`

### Deploy
- Docker Compose, port 9500, project name `thrive` (containers `thrive_api/ui/vault`)
- UI container: nginx serving the Vite build, proxies `/api/` to `thrive_api:8000`
- `../modules` bind-mounted into the API container — no rebuild to add/edit a module

## Module System

### How it works
1. On API startup, `modules.py` scans `/app/modules/` for folders with `module.json`
2. Discovered modules sync to the `modules` DB table. **Discovery ≠ install:** a new
   module registers `installed=0, enabled=0` — install is opt-in via Settings →
   Modules. A module is **active** (routers load, landing tile, nav icon) only when
   `installed=1 AND enabled=1`.
3. Active modules have each `api_routers` entry loaded **from its file** under a
   unique synthetic name and registered on the app
4. Frontend fetches `GET /modules` to know what's discovered/installed/enabled
5. Landing page shows active module cards; top bar shows active module nav icons
6. Module icon/color can be overridden in Settings (`icon_override`/`color_override`);
   sync from `module.json` never clobbers overrides; `GET /modules` returns effective values

**Router loading note:** every module declares routers under the same dotted path
(`api.routers.<name>`), so the loader does NOT use `importlib.import_module` (that
would let the first module's `api` package shadow the rest). `load_module_routers()`
maps the dotted path to `<module>/api/routers/<name>.py` and loads it via
`spec_from_file_location` under a unique name. Consequences:
- modules **do not need `__init__.py`** anywhere
- each router file is self-contained: import platform helpers with
  `from routers.auth import get_db, current_user_from_request`, define `router`,
  create its own tables in an idempotent `init_db()` called at module top level
- budget routers open sqlite with `check_same_thread=False` (FastAPI threadpool)

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
Optional `"core": true` marks a module the platform refuses to disable (Settings
shows a 🔒). No module is currently core.

### Account vs user/profile
- An **account** (`accounts` table) is a login credential (username/password/role).
  Core/auth-level; managed in **Settings → Accounts** (admin only).
- A **user** (`users` table) is a household profile/person. Managed by the `users`
  module under `/users`. A profile can exist with **no account** (shared/kiosk).
- `accounts.user_id` links an account to a profile; signing in drops you into it.
  `/auth/me` returns account fields plus `profile: {…} | null`.

Auth (login/session/`/me`/first-run + `accounts` mgmt via `routers/accounts.py`)
lives in **core**; the **users module** owns only profiles.

### DB table ownership
- **core** owns: `accounts` (login creds), `users` (profiles), `sessions`, `modules`
- `users` module: reads/writes the core `users` (profiles) table
- each module owns its own tables (e.g. budget: `accounts`, `transactions`,
  `categories`, `payees`, …; blackhole: `blackhole_presets`)

## Auth Flow
- `GET /auth/status` — public, returns `{setup_needed: bool}`
- `POST /auth/register` is first-run owner bootstrap only — creates the first admin
  **account** + matching **profile**, links them; returns 403 after
- Additional accounts: Settings → Accounts (`POST /accounts`, admin)
- Profiles (people): users module (`POST /users`, admin)
- Session cookie set on login, cleared on logout
- Auth gate middleware in `main.py` blocks all routes except PUBLIC_PATHS
  (`/health`, `/auth/status`, `/auth/login`, `/auth/logout`, `/auth/register`)

## Conventions
- Backend: idempotent `init_db()` with `ALTER TABLE` only for new columns
- Frontend: inline styles, no CSS classes except where an existing CSS file requires
- No new npm deps without good reason — check stdlib/existing dep first
- Routers use `get_db()` → per-request sqlite connection, closed in `finally`
- Money values stored as INTEGER cents ($12.34 = 1234); dates TEXT ISO (YYYY-MM-DD)

## Running locally
```bash
cd ~/thrive/core
docker compose up -d --build   # full rebuild
docker compose restart api     # restart API only (e.g. after adding a module)
docker compose logs api        # check module discovery output
```
Install a module: drop it in `~/thrive/modules/<name>/` then `docker compose restart api`.
Access at http://<nerfBase-ip>:9500

## What's next
- [ ] UI "install module" flow (currently: drop into modules/ + restart api)
- [ ] Module UI pages (each module ships its own React pages) — prereq for
      splitting modules back into their own repos
- [ ] Install-time module selection
- [ ] Profile-picker (kiosk) login

## Owner
nerfarrow — home server: nerfBase (Ubuntu)
GitHub: github.com/nerfarrow/thrive
