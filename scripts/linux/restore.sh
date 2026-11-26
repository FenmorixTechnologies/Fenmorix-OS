#!/usr/bin/env bash
# Puts a backup (from backup.sh, on this server or another one) into this install. Used to move an install to a new server.
#   sudo bash /opt/nexus/app/scripts/linux/restore.sh --from /root/move
# The folder holds the files backup.sh makes (the newest of each is used):
#   nexus-*.dump          the database (required)
#   uploads-*.tar.gz      uploaded files + secrets/ (the forms key: without it, encrypted answers and saved logins can't be read)
#   settings-*.tar.gz     branding + license
#   old.env               optional: the old server's .env; its settings are copied over, except the ones that belong to this
#                         machine (database login, port, certificates, folders, web address)
# Everything in this install's database is replaced. A backup of it is taken first.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"; [ -f "$ROOT/app/package.json" ] || ROOT=/opt/nexus
SVC="$(basename "$ROOT")"; APP="$ROOT/app"
appurl() { local p; p="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"')"
  if grep -qE '^HTTPS_(CERT|PFX)_FILE=' "$APP/.env" 2>/dev/null; then echo "https://127.0.0.1:${p:-443}/"; else echo "http://127.0.0.1:${p:-3000}/"; fi; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*"; exit 1; }
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
FROM="" YES=0
while [ $# -gt 0 ]; do case "$1" in --from) FROM="$2"; shift ;; --yes) YES=1 ;; *) die "Unknown option: $1" ;; esac; shift; done
[ "$(id -u)" = 0 ] || die "Run this with sudo."
[ -n "$FROM" ] && [ -d "$FROM" ] || die "Give the folder with the backup files: --from /root/move"
newest() { ls -1t "$FROM"/$1 2>/dev/null | head -1; }
DUMP="$(newest 'nexus-*.dump')"; UPL="$(newest 'uploads-*.tar.gz')"; SET="$(newest 'settings-*.tar.gz')"
[ -n "$DUMP" ] || die "No nexus-*.dump in $FROM."
echo "Database:  $DUMP"; echo "Uploads:   ${UPL:-(none)}"; echo "Settings:  ${SET:-(none)}"; echo "Old .env:  $([ -f "$FROM/old.env" ] && echo "$FROM/old.env" || echo '(none)')"
[ -n "$UPL" ] || echo "WARNING: no uploads file. Uploaded files are missing and anything encrypted (saved logins, sensitive form answers) can't be read."
if [ $YES = 0 ]; then read -r -p "Replace everything in this install with that backup? Type RESTORE: " ok; [ "$ok" = RESTORE ] || die "Nothing was changed."; fi

say "Backing up what's here now"
bash "$APP/scripts/linux/backup.sh" || echo "(backup of the current install didn't finish; carrying on)"
set -a; . <(grep -E '^PG[A-Z]+=' "$APP/.env"); set +a
systemctl stop "$SVC" || true

say "Database"
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS $PGDATABASE WITH (FORCE)"
sudo -u postgres createdb -O "$PGUSER" "$PGDATABASE"
cp "$DUMP" /tmp/nexus-restore.dump; chown postgres /tmp/nexus-restore.dump
sudo -u postgres pg_restore --no-owner --role="$PGUSER" --single-transaction -d "$PGDATABASE" /tmp/nexus-restore.dump
rm -f /tmp/nexus-restore.dump

if [ -n "$UPL" ]; then say "Uploads and the forms key"; rm -rf "$APP/uploads"; tar -xzf "$UPL" -C "$APP"; fi
if [ -n "$SET" ]; then say "Branding and license"; tar -xzf "$SET" -C "$ROOT"; fi

if [ -f "$FROM/old.env" ]; then
  say "Settings from the old .env"
  KEEP_HERE='^(PG[A-Z]*|PORT|HOST|HTTPS_[A-Z_]*|HTTP_REDIRECT_PORT|PUBLIC_URL|UPLOAD_DIR|SYSTEM_DIR|UPDATER_[A-Z_]*|FORMS_KEY_FILE|LICENSE_FILE|ENV_FILE|BACKUP_COPY_TO|BACKUP_COPY_DAYS|BRAND_ASSETS_DIR|WHISPER_[A-Z_]*|PDFJS_DIR)$'
  python3 - "$FROM/old.env" "$APP/.env" "$KEEP_HERE" <<'PY'
import re, sys
old, cur, skip = sys.argv[1], sys.argv[2], re.compile(sys.argv[3])
def parse(p):
    out = {}
    for line in open(p, encoding="utf-8-sig"):
        m = re.match(r'^\s*([A-Z][A-Z0-9_]*)=(.*)$', line.rstrip("\r\n"))
        if m: out[m.group(1)] = m.group(2)
    return out
o, c = parse(old), parse(cur)
lines = open(cur, encoding="utf-8").read().splitlines()
changed, added = [], []
for k, v in o.items():
    if skip.match(k) or c.get(k) == v: continue
    if k in c:
        lines = [f"{k}={v}" if re.match(rf'^\s*{k}=', l) else l for l in lines]; changed.append(k)
    else: added.append(k)
if added: lines += ["", "# --- From the old server"] + [f"{k}={o[k]}" for k in added]
open(cur, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("Changed: " + (", ".join(changed) or "none")); print("Added:   " + (", ".join(added) or "none"))
PY
fi

chown -R nexus:nexus "$APP/uploads" "$APP/secrets" 2>/dev/null || true
for d in branding license; do [ -d "$ROOT/$d" ] && chown -R nexus:nexus "$ROOT/$d"; done
chmod 700 "$APP/secrets" 2>/dev/null || true
chown nexus:nexus "$APP/.env"; chmod 600 "$APP/.env"

say "Starting"
systemctl start "$SVC"
for i in $(seq 1 60); do curl -fsk -o /dev/null "$(appurl)" && break; sleep 2; done
curl -fsk -o /dev/null "$(appurl)" && echo "Restored and running. Everyone signs in with the same accounts as before." \
  || echo "It didn't answer yet. Check: journalctl -u $SVC -n 50   and   $ROOT/logs/sgfd-app.log"
