#!/usr/bin/env bash
# Every 6 hours (nexus-nightly.timer): back up; on a sandbox also add yesterday's made-up calls (adds only days not there yet)
set -euo pipefail
ROOT=/opt/nexus; APP="$ROOT/app"
bash "$APP/scripts/linux/backup.sh"
if grep -qiE '^SANDBOX=(on|1|true|yes)' "$APP/.env"; then
  cd "$APP" && sudo -u nexus node scripts/sandbox/make-demo-stats.mjs "$ROOT/data/demo-calls.json" "$ROOT/data/demo-units.json"
fi
