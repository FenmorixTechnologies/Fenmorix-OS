#!/usr/bin/env bash
# Database backup (and the uploads folder once a day) into /opt/nexus/backups; keeps 14 days. Run as root.
# Runs every 6 hours from nexus-nightly.timer. BACKUP_COPY_TO in .env (a folder, e.g. a Windows folder under /mnt/c on WSL, or a
# mounted network drive) gets a second copy of each new file, kept for BACKUP_COPY_DAYS (default 30): a backup that sits only on the
# same disk as the system is lost with it.
set -euo pipefail
# Which install this is: the folder above app/ (scripts/linux -> app -> root). /opt/nexus = the main install, service "nexus";
# /opt/nexus-<name> = a second install made with --instance <name>, service "nexus-<name>".
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"; [ -f "$ROOT/app/package.json" ] || ROOT=/opt/nexus
SVC="$(basename "$ROOT")"; APP="$ROOT/app"
# Where this install answers on this machine (https on 443 for a normal install, http on its own port behind a tunnel)
appurl() { local p; p="$(grep -E '^PORT=' "$APP/.env" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"')"
  if grep -qE '^HTTPS_(CERT|PFX)_FILE=' "$APP/.env" 2>/dev/null; then echo "https://127.0.0.1:${p:-443}/"; else echo "http://127.0.0.1:${p:-3000}/"; fi; }
OUT="$ROOT/backups"; STAMP="$(date +%Y%m%d-%H%M%S)"
set -a; . <(grep -E '^PG[A-Z]+=' "$APP/.env"); set +a
mkdir -p "$OUT"
pg_dump -Fc -f "$OUT/nexus-$STAMP.dump"
echo "Database: $OUT/nexus-$STAMP.dump ($(du -h "$OUT/nexus-$STAMP.dump" | cut -f1))"
if [ -d "$APP/uploads" ] && ! find "$OUT" -name 'uploads-*.tar.gz' -mmin -1200 | grep -q .; then
  PARTS=(uploads); [ -d "$APP/secrets" ] && PARTS+=(secrets)
  tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$APP" "${PARTS[@]}" && echo "Uploads and the forms key: $OUT/uploads-$STAMP.tar.gz"
fi
# Branding (Branding page: names, colors, logo) and the license: small, every run
SET=(); for d in branding license; do [ -d "$ROOT/$d" ] && SET+=("$d"); done
if [ ${#SET[@]} -gt 0 ]; then tar -czf "$OUT/settings-$STAMP.tar.gz" -C "$ROOT" "${SET[@]}" && echo "Branding and license: $OUT/settings-$STAMP.tar.gz"; fi
find "$OUT" -type f \( -name 'nexus-*.dump' -o -name 'uploads-*.tar.gz' -o -name 'settings-*.tar.gz' \) -mtime +14 -delete
envval() { grep -E "^$1=" "$APP/.env" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
COPY="$(envval BACKUP_COPY_TO || true)"
if [ -n "$COPY" ]; then
  if mkdir -p "$COPY" 2>/dev/null && [ -w "$COPY" ]; then
    for f in "$OUT"/*-"$STAMP".*; do [ -e "$f" ] && cp -f "$f" "$COPY/"; done
    KEEP="$(envval BACKUP_COPY_DAYS || true)"; [[ "$KEEP" =~ ^[0-9]+$ ]] || KEEP=30
    find "$COPY" -maxdepth 1 -type f \( -name 'nexus-*.dump' -o -name 'uploads-*.tar.gz' -o -name 'settings-*.tar.gz' \) -mtime +"$KEEP" -delete
    echo "Copied to $COPY (kept $KEEP days)"
  else
    echo "WARNING: couldn't write the second copy to $COPY (is the drive there?)" >&2
  fi
fi
chown -R nexus:nexus "$OUT"; chmod 750 "$OUT"
