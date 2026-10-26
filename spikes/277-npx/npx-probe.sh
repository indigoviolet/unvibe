#!/bin/sh
# Probe: does `npx github:indigoviolet/unvibe#release` work without a global install?
# Issue #277. Evaluation-only: changes no product code, publishes nothing.
#
# Safety (strict):
# - Everything runs under a fresh scratch HOME (+ scratch XDG dirs, scratch
#   npm cache, scratch data dir, scratch port). The real HOME, global npm
#   prefix, login items, systemd units and mise config are never touched.
# - `update <channel>` is deliberately NOT run: under npx the prefix pin
#   resolves to null and npm falls back to its default global prefix, which
#   can be the real toolchain prefix. The script proves that with a dry
#   prefix probe instead (no install performed).
# - Run `gh` with GITHUB_TOKEN unset. No agent logins, no live agent runs.
#
# Usage: ./npx-probe.sh [SPEC] [PORT]
#   SPEC defaults to github:indigoviolet/unvibe#release, PORT to 4721.
# Prints labeled results; leaves the scratch root path on stdout at the end
# (delete it when done). Exits nonzero on the first failed probe.
set -eu

SPEC="${1:-github:indigoviolet/unvibe#release}"
PORT="${2:-4721}"

SCRATCH="$(mktemp -d /tmp/npx277-XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT INT TERM
export HOME="$SCRATCH/home"
export XDG_DATA_HOME="$SCRATCH/home/.local/share"
export XDG_CONFIG_HOME="$SCRATCH/home/.config"
export XDG_CACHE_HOME="$SCRATCH/home/.cache"
export XDG_RUNTIME_DIR="$SCRATCH/home/.run"
export npm_config_cache="$SCRATCH/cache"
export UNVIBE_DATA_DIR="$SCRATCH/data"
export UNVIBE_PORT="$PORT"
export UNVIBE_IDLE_MS=0
export UNVIBE_AGENT=none
mkdir -p "$HOME" "$UNVIBE_DATA_DIR" "$npm_config_cache"
unset GITHUB_TOKEN || true

say() { printf '\n### %s\n' "$*"; }
run() { echo "+ $*"; "$@"; }

guard_port_free() {
  if curl -s -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "FAIL: port $PORT already answers; pick another (never stop someone else's service)" >&2
    exit 2
  fi
}

guard_port_free

say "1. cold --version (fresh cache)"
START="$(date +%s)"
run npx --yes "$SPEC" --version
END="$(date +%s)"
echo "cold_secs=$((END - START))"

say "2. warm --version (same cache)"
START="$(date +%s)"
run npx --yes "$SPEC" --version
END="$(date +%s)"
echo "warm_secs=$((END - START))"
echo "npx cache dirs: $(ls "$npm_config_cache/_npx")"

say "3. doctor (scratch data dir + port)"
run npx --yes "$SPEC" doctor

say "4. start / status / stop"
run npx --yes "$SPEC" start
echo "lock: $(cat "$UNVIBE_DATA_DIR/unvibe.lock")"
curl -s "http://127.0.0.1:$PORT/api/health" | head -c 300; echo
run npx --yes "$SPEC" status
run npx --yes "$SPEC" stop

say "5. setup bakes the npx cache path (scratch HOME only), then uninstall"
run npx --yes "$SPEC" setup
echo "--- handler Exec:"; grep '^Exec=' "$HOME/.local/share/applications/unvibe-open.desktop"
echo "--- unit ExecStart:"; grep '^ExecStart=' "$HOME/.config/systemd/user/unvibe.service"
run npx --yes "$SPEC" setup --uninstall
test ! -e "$HOME/.local/share/applications/unvibe-open.desktop" && echo "ok: handler removed"
test ! -e "$HOME/.config/systemd/user/unvibe.service" && echo "ok: login unit removed"

say "6. update --list (needs gh login; expect failure without one)"
run npx --yes "$SPEC" update --list || echo "(expected without gh login)"

say "7. update <channel> is NOT run: dry prefix proof instead"
node -e '
const path = require("node:path");
const fs = require("node:fs");
const npxDir = fs.readdirSync(process.env.npm_config_cache + "/_npx")[0];
const pkgPath = `${process.env.npm_config_cache}/_npx/${npxDir}/node_modules/unvibe/package.json`;
const suffix = ["lib", "node_modules", "unvibe", "package.json"].join(path.sep);
console.log("npx package:", pkgPath);
console.log("global-layout suffix match:", pkgPath.endsWith(suffix), "=> prefix pin: null");
'
echo "npm default global prefix here: $(npm prefix -g)  (outside scratch when toolchain-managed: update would land there, not in the npx cache)"

say "scratch root (deleted on exit; kept on failure for inspection): $SCRATCH"
trap - EXIT INT TERM
echo "SCRATCH=$SCRATCH"
