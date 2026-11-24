#!/usr/bin/env bash
# Nightly: back up, and on a sandbox add yesterday's made-up calls before the 03:00 statistics sync
set -euo pipefail
ROOT=/opt/nexus; APP="$ROOT/app"
bash "$APP/scripts/linux/backup.sh"
if grep -qiE '^SANDBOX=(on|1|true|yes)' "$APP/.env"; then
  cd "$APP" && sudo -u nexus node scripts/sandbox/make-demo-stats.mjs "$ROOT/data/demo-calls.json" "$ROOT/data/demo-units.json"
fi
