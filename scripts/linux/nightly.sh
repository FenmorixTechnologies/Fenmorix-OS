#!/usr/bin/env bash
# Every 6 hours (nexus-nightly.timer): back up; on a sandbox also add yesterday's made-up calls (adds only days not there yet)
set -euo pipefail
# Which install this is: the folder above app/ (scripts/linux -> app -> root). /opt/nexus = the main install, service "nexus";
# /opt/nexus-<name> = a second install made with --instance <name>, service "nexus-<name>".
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"; [ -f "$ROOT/app/package.json" ] || ROOT=/opt/nexus
SVC="$(basename "$ROOT")"; APP="$ROOT/app"
# Where this install answers on this machine (https on 443 for a normal install, http on its own port behind a tunnel)
appurl() { local p; p="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"')"
  if grep -qE '^HTTPS_(CERT|PFX)_FILE=' "$APP/.env" 2>/dev/null; then echo "https://127.0.0.1:${p:-443}/"; else echo "http://127.0.0.1:${p:-3000}/"; fi; }
bash "$APP/scripts/linux/backup.sh"
if grep -qiE '^SANDBOX=(on|1|true|yes)' "$APP/.env"; then
  cd "$APP" && sudo -u nexus node scripts/sandbox/make-demo-stats.mjs "$ROOT/data/demo-calls.json" "$ROOT/data/demo-units.json"
fi
