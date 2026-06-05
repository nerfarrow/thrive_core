# =============================================================================
# modules.py — Module discovery, registration, and management
# thrive_core
# =============================================================================
import os, sys, json, sqlite3, importlib.util
from pathlib import Path
from fastapi import FastAPI

DB_PATH      = os.environ.get("DB_FILE", "/data/thrivecore.db")
MODULES_DIR  = Path(os.environ.get("MODULES_DIR", "/app/modules"))


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_modules_table():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS modules (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                icon         TEXT,
                description  TEXT,
                version      TEXT,
                color        TEXT,
                nav_path     TEXT,
                enabled      INTEGER DEFAULT 0,
                installed    INTEGER DEFAULT 0,
                core         INTEGER DEFAULT 0,
                installed_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(modules)").fetchall()]
        # migration: add `core` to pre-existing tables
        if "core" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN core INTEGER DEFAULT 0")
        # migration: add `installed` — preserve currently-live modules across the
        # upgrade so a running install isn't silently torn down.
        if "installed" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN installed INTEGER DEFAULT 0")
            conn.execute("UPDATE modules SET installed=1 WHERE enabled=1")
        conn.commit()
    finally:
        conn.close()


# ── discovery ────────────────────────────────────────────────────────────────
def discover_modules() -> list[dict]:
    """Scan MODULES_DIR for valid module.json files."""
    found = []
    if not MODULES_DIR.exists():
        return found
    for entry in sorted(MODULES_DIR.iterdir()):
        if not entry.is_dir():
            continue
        manifest = entry / "module.json"
        if not manifest.exists():
            continue
        try:
            data = json.loads(manifest.read_text())
            data["_path"] = str(entry)
            found.append(data)
        except Exception as e:
            print(f"[modules] skipping {entry.name}: {e}")
    return found


def sync_registry(discovered: list[dict]):
    """Upsert discovered modules into the DB registry. Never removes."""
    conn = get_db()
    try:
        for m in discovered:
            existing = conn.execute("SELECT id FROM modules WHERE id=?", (m["id"],)).fetchone()
            core = 1 if m.get("core") else 0
            if existing:
                conn.execute(
                    "UPDATE modules SET name=?, icon=?, description=?, version=?, color=?, nav_path=?, core=? WHERE id=?",
                    (m.get("name"), m.get("icon"), m.get("description"),
                     m.get("version"), m.get("color"), m.get("nav_path"), core, m["id"])
                )
            else:
                # newly discovered modules are registered but NOT installed —
                # the user opts in via Settings → Modules.
                conn.execute(
                    "INSERT INTO modules (id, name, icon, description, version, color, nav_path, enabled, installed, core) VALUES (?,?,?,?,?,?,?,0,0,?)",
                    (m["id"], m.get("name"), m.get("icon"), m.get("description"),
                     m.get("version"), m.get("color"), m.get("nav_path"), core)
                )
        conn.commit()
    finally:
        conn.close()


def get_active_ids() -> set[str]:
    """Modules that should actually run: installed AND enabled."""
    conn = get_db()
    try:
        rows = conn.execute("SELECT id FROM modules WHERE installed=1 AND enabled=1").fetchall()
        return {r["id"] for r in rows}
    finally:
        conn.close()


# ── router loading ────────────────────────────────────────────────────────────
def load_module_routers(app: FastAPI, discovered: list[dict], active_ids: set[str]):
    """Dynamically import and register each active module's API routers."""
    for m in discovered:
        if m["id"] not in active_ids:
            print(f"[modules] {m['id']} not active — skipping")
            continue
        module_path = Path(m["_path"])
        api_path    = module_path / "api"
        if not api_path.exists():
            continue
        # add module to sys.path so imports work
        if str(module_path) not in sys.path:
            sys.path.insert(0, str(module_path))
        # load each declared router
        for router_dotpath in m.get("api_routers", []):
            try:
                mod = importlib.import_module(router_dotpath)
                if hasattr(mod, "router"):
                    app.include_router(mod.router)
                    print(f"[modules] loaded {m['id']} → {router_dotpath}")
                else:
                    print(f"[modules] {router_dotpath} has no 'router' attribute")
            except Exception as e:
                print(f"[modules] failed to load {router_dotpath}: {e}")


# ── public api ────────────────────────────────────────────────────────────────
def list_modules() -> list[dict]:
    """Return all registered modules with enabled state — for the frontend."""
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM modules ORDER BY id").fetchall()]
    finally:
        conn.close()

def is_core_module(module_id: str) -> bool:
    """Core modules (e.g. users) are required for the platform and can't be disabled."""
    conn = get_db()
    try:
        row = conn.execute("SELECT core FROM modules WHERE id=?", (module_id,)).fetchone()
        return bool(row and row["core"])
    finally:
        conn.close()

def set_module_enabled(module_id: str, enabled: bool) -> bool:
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM modules WHERE id=?", (module_id,)).fetchone():
            return False
        conn.execute("UPDATE modules SET enabled=? WHERE id=?", (1 if enabled else 0, module_id))
        conn.commit()
        return True
    finally:
        conn.close()

def set_module_installed(module_id: str, installed: bool) -> bool:
    """Install (installed=1, enabled=1) or uninstall (installed=0, enabled=0)
    a module. Routers load/unload on the next API restart."""
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM modules WHERE id=?", (module_id,)).fetchone():
            return False
        flag = 1 if installed else 0
        conn.execute("UPDATE modules SET installed=?, enabled=? WHERE id=?", (flag, flag, module_id))
        conn.commit()
        return True
    finally:
        conn.close()


# ── bootstrap ─────────────────────────────────────────────────────────────────
def bootstrap(app: FastAPI):
    """Call this from main.py on startup."""
    init_modules_table()
    discovered = discover_modules()
    sync_registry(discovered)
    active     = get_active_ids()
    load_module_routers(app, discovered, active)
    print(f"[modules] {len(discovered)} discovered, {len(active)} active")