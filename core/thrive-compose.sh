#!/usr/bin/env bash
# thrive-compose — bring up the thrive stack: core + every module that ships its
# own container. A module's services run iff the module is present in modules/
# (its modules/<name>/compose.yml is merged in) — "physically there = installed".
# Core itself never names a module; this is how opt-in module infrastructure
# (e.g. vault's Vaultwarden) attaches without core hardcoding it.
#
# Usage (from anywhere): core/thrive-compose.sh <docker-compose args>
#   core/thrive-compose.sh up -d --build
#   core/thrive-compose.sh down
#   core/thrive-compose.sh ps
#
# The first -f is core/docker-compose.yml, so the compose PROJECT DIRECTORY is
# core/ — module fragments' relative paths (e.g. ./data/vault) resolve there too.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

files=(-f "$here/docker-compose.yml")
for c in "$here"/../modules/*/compose.yml; do
    [ -f "$c" ] && files+=(-f "$c")
done

exec docker compose "${files[@]}" "$@"
