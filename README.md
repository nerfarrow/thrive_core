# thrive

A modular self-hosted household/lifestyle app.

- `core/` — the platform shell: auth, settings, and the module loader/registry.
- `modules/` — pluggable features (budget, vehicles, vault, home, users, blackhole),
  bind-mounted into the API container at runtime.

## Run

```bash
cd core
docker compose up -d --build
```

Access at http://<host>:9500. See [CLAUDE.md](CLAUDE.md) for architecture details.
