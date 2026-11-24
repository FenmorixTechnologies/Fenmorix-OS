#!/usr/bin/env bash
# Database backup (and the uploads folder once a day) into /opt/nexus/backups; keeps 14 days. Run as root.
set -euo pipefail
ROOT=/opt/nexus; APP="$ROOT/app"; OUT="$ROOT/backups"; STAMP="$(date +%Y%m%d-%H%M%S)"
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
chown -R nexus:nexus "$OUT"; chmod 750 "$OUT"
