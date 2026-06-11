# thrive — Claude Context

## What this is
`thrive` is a modular self-hosted household/lifestyle app. This repo is an
**umbrella** with three parts:
- `core/` — the platform shell: auth, a module loader, settings, landing page.
  Everything else is a module. `core/` is self-contained and runnable on its own.
- `modules/` — the pluggable features (budget, vehicles, vault, home, users,
  lmstudio, blackhole, grovekeeper). Each is **self-contained**: its own `ui/`
  (React, discovered at build time), `api/` routers (bind-mounted, runtime-loaded),
  and `requirements.txt` (backend deps). Core names no module at compile time, so
  `core/` builds and runs with `modules/` empty.
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
│   ├── grovekeeper/            ← shared tree-renderer lib (Vite alias)
│   ├── api/
│   │   ├── Dockerfile          ← builds from REPO ROOT; installs core +
│   │   │                          every modules/<name>/requirements.txt
│   │   ├── main.py             ← auth gate + module bootstrap + /modules + /settings
│   │   ├── modules.py          ← module discovery, loader, registry
│   │   ├── requirements.txt    ← CORE deps only (fastapi/uvicorn/python-multipart)
│   │   └── routers/
│   │       ├── auth.py         ← login/session/me/first-run + schema & migration
│   │       └── accounts.py     ← admin account mgmt (creds, roles, link→profile)
│   └── ui/
│       ├── Dockerfile  index.html  nginx.conf  package.json  vite.config.js
│       │                          (Dockerfile builds from the REPO ROOT so the
│       │                           Vite glob can see modules/<name>/ui; @core
│       │                           alias = core/ui/src)
│       └── src/
│           ├── App.jsx          ← auth gate (Gate), Shell (TopNav + routes)
│           ├── moduleRegistry.js← build-time glob over modules/*/ui/index.jsx
│           ├── api.js           ← fetch wrapper + 401 handling
│           ├── index.css  main.jsx
│           ├── context/  components/  pages/ (= LandingPage + SettingsPage only)
├── modules/                    pluggable features (monorepo — all tracked here)
│   └── <name>/
│       ├── module.json          ← manifest (id, nav_path, api_routers, …)
│       ├── requirements.txt     ← module's own backend deps (baked at API build)
│       ├── api/routers/*.py      ← runtime-loaded routers
│       └── ui/index.jsx          ← exports { id, path, Page, Ambient?, settings? };
│                                    co-locates its pages/components/utils/css,
│                                    which import core via the @core alias
│   (modules: users home budget vehicles vault lmstudio blackhole grovekeeper)
└── os/                         thriveOS appliance image (mkosi; builds in Docker)
    ├── Makefile    ← make image / vm / vmdk / vdi  (host needs only Docker)
    ├── mkosi.conf  mkosi.extra/  mkosi.postinst   ← image definition + overlay
    ├── build/      ← the privileged build-container (Debian + mkosi + qemu)
    └── .gitignore  ← keeps build artifacts (*.raw/.vmdk/.initrd/…) out of git
```

> **Note on module distribution (decided 2026-06): the monorepo STAYS.** Modules are
> NOT split into separate git repos — they're all tracked here for neatness, and modules
> always depend on core (core never on a module). A module is already a self-contained,
> packageable unit (ui + api + requirements + manifest). The *future* installer is
> additive: build per-module **tarballs from this monorepo** + a catalog; "install
> module X" on the host = download → unpack into `modules/` → install deps → rebuild UI
> + restart API (the recompile runs on the thrive host). Nothing about that requires
> splitting repos or rebuilding the module system — see the Module System section below.

## Architecture

### Backend
- FastAPI, Python 3.12
- Plain `sqlite3` with `conn.row_factory = sqlite3.Row`
- One shared DB: `/data/thrive.db`
- Auth: PBKDF2-HMAC-SHA256 (stdlib, no deps), httpOnly session cookie
- Cookie name: `thrive_session`
- `COOKIE_SECURE=false` for local http dev, `true` for HTTPS production
- Module loader: `core/api/modules.py` scans `/app/modules/` on startup
- `core/api/requirements.txt` is **core deps only**; each module declares its own
  `modules/<name>/requirements.txt`, installed into the API image at build (the API
  Dockerfile builds from the repo root). Module ROUTER code is bind-mounted live, but
  module DEPS are baked → adding a dep needs an API `--build`

### Frontend
- React + Vite, no component library — inline styles using CSS vars
- **Module UIs are build-time discovered**, not imported by core. `core/ui/src/
  moduleRegistry.js` runs a Vite glob over `modules/*/ui/index.jsx`; each
  default-exports `{ id, path, Page, Ambient?, settings? }`. `App.jsx` reads it for
  routes + ambient, `SettingsPage` for module settings panels. Empty `modules/` →
  empty registry → core runs alone. Module UI imports core via the **`@core`** alias
  (`@core/api`, `@core/context/*`, `@core/components/*`, `@core/utils/vault`).
- Dark mono aesthetic (Space Mono + DM Sans fonts)
- CSS vars: `--bg-primary #0f0f0f`, `--bg-secondary #181818`, `--bg-tertiary #222`
- `--text-primary #e8e6e0`, `--text-secondary #aaa`, `--text-tertiary #666`
- `--color-success #22c55e`, `--color-danger #ef4444`, `--border-color #2a2a2a`
- `--ui-alpha` drives surface translucency (Settings → UI opacity)
- API calls via `src/api.js` — `credentials: 'include'`, fires `thrive:unauthorized` on 401
- Custom in-app events/localStorage keys are namespaced `thrive:*`

### Deploy
- Docker Compose, port 9500, project name `thrive`. Core = `thrive_api` + `thrive_ui`
  only; module containers (e.g. `thrive_vault`) attach via `modules/*/compose.yml`
  (see `core/thrive-compose.sh` + Module anatomy). Launch the full stack with that wrapper.
- UI container: nginx serving the Vite build, proxies `/api/` to `thrive_api:8000`
- **Both `ui` and `api` build with `context: ..` (repo root)** so the build can see
  `modules/` (UI glob; API per-module deps). UI Dockerfile mirrors the repo layout
  and hoists `node_modules` via a repo-root symlink so out-of-tree module imports
  resolve; there's a repo-root `.dockerignore`.
- `../modules` is still bind-mounted into the API container — editing a router needs
  only `docker compose restart api`; UI changes or a new module dep need `--build`

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
7. **Frontend pieces are build-time discovered** (`core/ui/src/moduleRegistry.js`),
   then gated on the active set: a module's page/route, ambient renderer, and Settings
   panel render only when it's `installed && enabled`. Core imports no module.

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

### Module anatomy (each module is self-contained)
- `module.json` — the manifest above (backend identity + router list)
- `api/routers/*.py` — runtime-loaded routers (no `__init__.py` needed)
- `ui/index.jsx` — default-exports `{ id, path, Page, Ambient?, settings? }`
  (`settings = { title, Panel, defaultOpen?, padded? }`), co-locating the module's
  own `pages/ components/ utils/` + CSS; all import core via the `@core` alias
- `requirements.txt` — the module's backend Python deps (baked into the API image)
- `compose.yml` *(optional)* — a module may ship its **own sidecar container(s)**.
  `core/thrive-compose.sh` merges every `modules/*/compose.yml` that's present into
  the core stack, so a module's services run iff the module is physically in
  `modules/` ("there = installed"). Core never names a module's container. Join the
  shared `internal` network; resolve relative paths against `core/` (the project
  dir). Example: **vault** ships `modules/vault/compose.yml` (Vaultwarden) — core's
  compose + nginx tolerate its absence (nginx uses a runtime resolver for `/vault/`).

**Cross-module ties feature-detect, never hard-`requires`.** e.g. vehicles/MPG uses
the lmstudio module's `/lmstudio/vision` when present and falls back to manual entry
when it isn't; budget's Accounts shows vault linking only when a vault session exists.
`requires` is reserved for true hard deps (none today).

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
./thrive-compose.sh up -d --build   # full stack: core + any module that ships a compose.yml
./thrive-compose.sh restart api     # restart API only — enough for a ROUTER code edit
./thrive-compose.sh logs api        # check module discovery output
```
`thrive-compose.sh` = `docker compose` with core's file + every `modules/*/compose.yml`
merged in (that's how vault's Vaultwarden container attaches). Plain
`docker compose up` still works but runs **core only** (no module containers). Use a
full rebuild for UI changes / new modules / new deps; a bare `restart api` is enough
for a router code edit.

Add a module: drop it in `~/thrive/modules/<name>/` then `./thrive-compose.sh up -d --build`
(its UI is build-time discovered, deps baked, and any `compose.yml` it ships is merged
in — a bare `restart api` won't pick those up). Access at http://<nerfBase-ip>:9500.
NOTE: nerfBase has no staging — a rebuild here deploys live to thrive.nerfarrow.com.
⚠️ Since vault moved out of core, deploy nerfBase with `./thrive-compose.sh up -d`
(plain `docker compose up` would stop Vaultwarden and break the live vault).

## What's next
- [ ] **Installer / catalog** — UI to install modules from a catalog. Needs a
      host-orchestration decision first (the containerized app can't rebuild its own
      image): mounted docker socket vs a host-side agent vs "write to `modules/` +
      prompt the user to rebuild". Then: download tarball → unpack → install deps →
      rebuild UI + restart API. (Activation flags + `GET /modules` already exist.)
- [ ] **Per-module tarball packaging** — CI builds a tarball per module from this
      monorepo + a catalog manifest (the source the installer pulls from).
- [ ] **Theming** — swappable look via CSS-var palettes; current look becomes
      "Thrive Classic"; total coverage (charts/accents too). A **live theme dropdown
      in Settings → UI** (next to opacity), applied instantly — a **per-device**
      preference (`thrive:theme` in localStorage, exactly like `--ui-alpha`, ambient,
      nav order), NOT a server-side/per-install global. Purely frontend (no
      `app_config`). Designed + scoped, not yet built.
- [ ] Profile-picker (kiosk) login

**Recently done (2026-06-09):** module-UI build-time discovery + settings-panel
discovery (modules fully own their UI; core names none), and per-module backend
`requirements.txt` (core deps slimmed to core-only).

## Owner
nerfarrow — home server: nerfBase (Ubuntu)
GitHub: github.com/nerfarrow/thrive
