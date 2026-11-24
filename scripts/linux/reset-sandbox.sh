#!/usr/bin/env bash
# Starts a SANDBOX over with a fresh demo department.
#   sudo bash /opt/nexus/app/scripts/linux/reset-sandbox.sh                 keeps everyone who signed up (their accounts only)
#   sudo bash /opt/nexus/app/scripts/linux/reset-sandbox.sh --wipe-accounts  removes them too (then make the first admin again)
# Everything people entered (requisitions, messages, boards, uploads ...) is erased. A backup is taken first.
set -euo pipefail
ROOT=/opt/nexus; APP="$ROOT/app"
[ "$(id -u)" = 0 ] || { echo "Run this with sudo."; exit 1; }
grep -qiE '^SANDBOX=(on|1|true|yes)' "$APP/.env" || { echo "This server isn't a sandbox (SANDBOX=on in .env). Nothing was changed."; exit 1; }
KEEP=1; [ "${1:-}" = "--wipe-accounts" ] && KEEP=0
read -r -p "Erase everything in this sandbox and start over? Type RESET: " ok; [ "$ok" = RESET ] || { echo "Nothing was changed."; exit 1; }
cd "$APP"
bash scripts/linux/backup.sh
SAVED="$ROOT/data/accounts-$(date +%Y%m%d-%H%M%S).json"
[ $KEEP = 1 ] && sudo -u nexus node scripts/sandbox/seed-demo.mjs --export-accounts "$SAVED"
set -a; . <(grep -E '^PG[A-Z]+=' .env); set +a
systemctl stop nexus
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS $PGDATABASE WITH (FORCE)"
sudo -u postgres createdb -O "$PGUSER" "$PGDATABASE"
rm -rf "$APP/uploads"
systemctl start nexus
for i in $(seq 1 40); do curl -fsk -o /dev/null "https://127.0.0.1/" && break; sleep 2; done
sudo -u nexus node scripts/sandbox/seed-demo.mjs
if [ $KEEP = 1 ]; then sudo -u nexus node scripts/sandbox/seed-demo.mjs --import-accounts "$SAVED"; shred -u "$SAVED" 2>/dev/null || rm -f "$SAVED"; fi
systemctl restart nexus
echo "The sandbox starts over. $([ $KEEP = 1 ] && echo 'Everyone who had an account can still sign in.' || echo 'Make the first admin again through the SSH tunnel.')"
