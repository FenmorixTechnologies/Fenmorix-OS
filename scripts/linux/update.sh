#!/usr/bin/env bash
# Installs packages, builds and restarts Nexus after new files were copied over /opt/nexus/app. Run as root
# (the updater does this for installs from the System page). Exit code 0 = running again.
set -uo pipefail
# Which install this is: the folder above app/ (scripts/linux -> app -> root). /opt/nexus = the main install, service "nexus";
# /opt/nexus-<name> = a second install made with --instance <name>, service "nexus-<name>".
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"; [ -f "$ROOT/app/package.json" ] || ROOT=/opt/nexus
SVC="$(basename "$ROOT")"; APP="$ROOT/app"
# Where this install answers on this machine (https on 443 for a normal install, http on its own port behind a tunnel)
appurl() { local p; p="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"')"
  if grep -qE '^HTTPS_(CERT|PFX)_FILE=' "$APP/.env" 2>/dev/null; then echo "https://127.0.0.1:${p:-443}/"; else echo "http://127.0.0.1:${p:-3000}/"; fi; }
LOG="$ROOT/logs/sgfd-app.log"
cd "$APP" || exit 1
chown -R nexus:nexus "$APP"
NPM=(sudo -u nexus env HOME="$ROOT" npm_config_cache="$ROOT/tools/npm-cache" npm)
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "== Installing packages"
  "${NPM[@]}" install --no-audit --no-fund || { echo "npm install failed."; exit 1; }
  touch node_modules
fi
echo "== Building"
"${NPM[@]}" run build || { echo "The build failed."; exit 1; }
echo "== Restarting"
MARK=$(stat -c %s "$LOG" 2>/dev/null || echo 0)
systemctl restart "$SVC"
for i in $(seq 1 45); do
  if curl -fsk -o /dev/null --max-time 3 "$(appurl)"; then
    tail -c +$((MARK + 1)) "$LOG" 2>/dev/null | grep -E "Database updated|running at|Error|error|Can't" | tail -15
    echo "Updated and running."; exit 0
  fi
  sleep 2
done
tail -c +$((MARK + 1)) "$LOG" 2>/dev/null | tail -30
echo "The app didn't answer after the restart."; exit 1
