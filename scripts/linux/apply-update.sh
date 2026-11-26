#!/usr/bin/env bash
# Linux twin of scripts/apply-update.ps1: does what Nexus > User Management > System asked for (updates/pending.json):
# install | restart | rollback | backup. Started by systemd (nexus-update.path sees pending.json) as root; the copy that
# runs lives in /opt/nexus/tools/updater and is refreshed after each good install.
#
# install:  backup -> keep a copy of the current app (updates/previous/app) -> copy the new files over (never .env, secrets,
#           node_modules, uploads) -> update.sh. If that fails, the previous app is put back and started.
# Result: updates/last-result.json (Nexus shows it) and logs/update-<time>-<action>.log. Progress: updates/progress.json.
set -uo pipefail
# The copy that runs lives in <root>/tools/updater; SYSTEM_DIR (tests) wins
HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
if [ -n "${SYSTEM_DIR:-}" ]; then ROOT="$SYSTEM_DIR"; elif [ -f "$HERE/../../app/package.json" ]; then ROOT="$(cd "$HERE/../.." && pwd)"; else ROOT=/opt/nexus; fi
SVC="${NEXUS_SERVICE:-$(basename "$ROOT")}"; [ -n "${SYSTEM_DIR:-}" ] && [ -z "${NEXUS_SERVICE:-}" ] && SVC=nexus
APP="$ROOT/app"; UPD="$ROOT/updates"; LOGS="$ROOT/logs"; PREV="$UPD/previous/app"
PENDING="$UPD/pending.json"
[ -f "$PENDING" ] || exit 0
mkdir -p "$UPD" "$LOGS"

field() { node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));const v=j[process.argv[2]];process.stdout.write(v==null?"":String(v))' "$PENDING" "$1"; }
ACTION="$(field action)"; JOB_ID="$(field id)"; BY="$(field by)"; VERSION="$(field version)"; ZIP="$(field zip)"; SHA="$(field sha256)"
STAMP="$(date +%Y%m%d-%H%M%S)"; LOGNAME="update-$STAMP-$ACTION.log"; LOG="$LOGS/$LOGNAME"
exec > >(tee -a "$LOG") 2>&1
echo "Updater: $ACTION, asked for by $BY at $(field at)"
STARTED="$(date -Iseconds)"

json() { node -e 'const o={};for(let i=1;i<process.argv.length;i+=2){let v=process.argv[i+1];if(v==="true"||v==="false")v=v==="true";else if(/^\d+$/.test(v))v=Number(v);o[process.argv[i]]=v}process.stdout.write(JSON.stringify(o,null,1))' "$@"; }
progress() { echo; echo "== $3"; json id "$JOB_ID" action "$ACTION" step "$1" total "$2" label "$3" at "$(date -Iseconds)" started "$STARTED" > "$UPD/progress.json"; chown nexus:nexus "$UPD/progress.json"; }
ensure_running() {
  [ "$ACTION" = backup ] && return
  systemctl is-active --quiet "$SVC" && return
  echo "The service isn't running; starting it again."; systemctl start "$SVC"; sleep 8
  systemctl is-active --quiet "$SVC" && MSG="$MSG The app was started again." || MSG="$MSG The app is NOT running: sign in to the server and run scripts/linux/update.sh."
}
finish() {
  local ok="$1"; MSG="$2"
  ensure_running
  json id "$JOB_ID" action "$ACTION" ok "$ok" message "$MSG" at "$(date -Iseconds)" by "$BY" version "$VERSION" log "$LOGNAME" > "$UPD/last-result.json"
  chown nexus:nexus "$UPD/last-result.json"
  rm -f "$PENDING" "$UPD/progress.json"
  echo; echo "$MSG"
  [ "$ok" = true ] && exit 0 || exit 1
}
KEEP=(--exclude node_modules --exclude .git --exclude secrets --exclude uploads --exclude tmp --exclude logs --exclude .env --exclude '*.log')
save_snapshot() { mkdir -p "$PREV"; rsync -a --delete "${KEEP[@]}" --exclude dist "$APP/" "$PREV/"; }
copy_over() { rsync -a "${KEEP[@]}" "$1/" "$APP/"; }
restore_snapshot() {
  rsync -a "${KEEP[@]}" --exclude src --exclude server --exclude db --exclude scripts --exclude public --exclude docs "$PREV/" "$APP/"
  for d in src server db scripts public docs; do [ -d "$PREV/$d" ] && rsync -a --delete "$PREV/$d/" "$APP/$d/"; done
  chown -R nexus:nexus "$APP"
}
run_update() { bash "$APP/scripts/linux/update.sh"; }
run_backup() { bash "$APP/scripts/linux/backup.sh"; }

case "$ACTION" in
  restart)
    progress 1 1 "Restarting the service"
    systemctl restart "$SVC"; sleep 8
    systemctl is-active --quiet "$SVC" || finish false "The service didn't come back after the restart. Check logs/sgfd-app.log."
    finish true "Restarted." ;;
  backup)
    progress 1 1 "Backing up the database and uploads"
    run_backup || finish false "The backup didn't finish (see the log)."
    finish true "Backup finished." ;;
  rollback)
    [ -f "$PREV/package.json" ] || finish false "There's no earlier version kept."
    progress 1 2 "Putting the previous version back"
    restore_snapshot
    progress 2 2 "Building and starting (the app is down for about a minute)"
    run_update || finish false "The previous version was copied back but didn't start. Sign in to the server and run scripts/linux/update.sh."
    finish true "Rolled back to the previous version." ;;
  install)
    progress 1 6 "Checking the uploaded zip"
    [ -f "$ZIP" ] || finish false "The uploaded zip is gone. Upload it again."
    [ "$(sha256sum "$ZIP" | cut -d' ' -f1)" = "${SHA,,}" ] || finish false "The uploaded zip doesn't match what was checked. Upload it again."
    progress 2 6 "Backing up the database first"
    run_backup || finish false "The backup didn't finish, so nothing was changed."
    progress 3 6 "Unpacking the new version"
    STAGING="$UPD/staging"; rm -rf "$STAGING"; mkdir -p "$STAGING"
    unzip -q "$ZIP" -d "$STAGING" || finish false "The zip couldn't be unpacked; nothing was changed."
    [ -f "$STAGING/app/package.json" ] || finish false "The zip has no app folder; nothing was changed."
    progress 4 6 "Keeping a copy of the current version (for rollback)"
    save_snapshot
    progress 5 6 "Copying the new version over"
    copy_over "$STAGING/app"; chown -R nexus:nexus "$APP"
    progress 6 6 "Building and starting (the app is down for about a minute)"
    if ! run_update; then
      progress 6 6 "The new version didn't start. Putting the previous version back"
      restore_snapshot
      run_update || finish false "The update failed AND the previous version didn't start again. Sign in to the server and run scripts/linux/update.sh (log: $LOGNAME)."
      finish false "The update failed, so the previous version was put back and is running. The log says why."
    fi
    # Keep this updater current
    [ -f "$APP/scripts/linux/apply-update.sh" ] && mkdir -p "$ROOT/tools/updater" && install -m 750 "$APP/scripts/linux/apply-update.sh" "$ROOT/tools/updater/apply-update.sh"
    mkdir -p "$UPD/installed"; mv -f "$ZIP" "$UPD/installed/release-$STAMP.zip"
    rm -rf "$UPD/incoming" "$STAGING"
    ls -1t "$UPD/installed"/release-*.zip 2>/dev/null | tail -n +6 | xargs -r rm -f
    finish true "Installed $VERSION and running." ;;
  *) finish false "Unknown action: $ACTION" ;;
esac
