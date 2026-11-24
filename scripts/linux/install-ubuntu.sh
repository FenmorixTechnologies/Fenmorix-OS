#!/usr/bin/env bash
# Sets up Nexus on a fresh Ubuntu 22.04 / 24.04 cloud server (sandbox or a department's own install).
#
#   1. Make a DNS "A" record for your name (e.g. sandbox.example.com) pointing at the server's public IP.
#   2. Copy the release zip to the server and unzip it so the app is at /opt/nexus/app:
#        sudo mkdir -p /opt/nexus && sudo unzip nexus-app.zip -d /opt/nexus
#   3. Run:
#        sudo bash /opt/nexus/app/scripts/linux/install-ubuntu.sh --domain sandbox.example.com --email you@example.com --sandbox
#      Options: --org "Demo Fire District" --short DEMO --place Demo --app-name "Nexus Sandbox" --timezone America/Chicago
#               --lat 30.37 --lon -91.01 (weather and demo call locations)   --no-sandbox (a real install: no demo data, no banner)
#      A customer kit (License Manager: node nexus-license.mjs new-customer) sets it all up for that customer instead:
#        sudo bash .../install-ubuntu.sh --kit /root/acme-county-government --email you@example.com
#      (its license, name, colors, logo, web address, time zone and location; a real install, not a sandbox)
#      --local: try it on this computer (Ubuntu on Windows / WSL, or a desktop): https://localhost with a self-signed certificate,
#        no domain, email or Let's Encrypt. First-run setup then works straight from the browser on this computer.
#   4. Make the first admin account through an SSH tunnel (first-run setup only works from the server itself):
#        ssh -L 8443:127.0.0.1:443 <you>@<server>     then open https://localhost:8443 (accept the name warning once)
#
# It's safe to run again: it keeps .env, the database and the certificate, and only fills in what's missing.
# Layout: /opt/nexus/{app, updates, logs, backups, certs, tools, data}. Service: nexus (systemd), runs as user "nexus".
set -euo pipefail

ROOT=/opt/nexus
APP="$ROOT/app"
DOMAIN="" EMAIL="" SANDBOX=1 ORG="" SHORT="" PLACE="" APPNAME="" TZONE="America/Chicago" LAT="30.37" LON="-91.01" KIT="" PRODUCT="" LOCAL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift ;; --email) EMAIL="$2"; shift ;;
    --sandbox) SANDBOX=1 ;; --no-sandbox) SANDBOX=0 ;;
    --org) ORG="$2"; shift ;; --short) SHORT="$2"; shift ;; --place) PLACE="$2"; shift ;; --app-name) APPNAME="$2"; shift ;;
    --timezone) TZONE="$2"; shift ;; --lat) LAT="$2"; shift ;; --lon) LON="$2"; shift ;;
    --kit) KIT="$2"; shift ;;
    --local) LOCAL=1 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
  shift
done
say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*"; exit 1; }
[ "$(id -u)" = 0 ] || die "Run this with sudo."
[ -f "$APP/package.json" ] || die "The app isn't at $APP. Unzip the release so $APP/package.json exists, then run this again."
# A customer kit: its values unless given on the command line
if [ -n "$KIT" ]; then
  [ -f "$KIT/customer.json" ] && [ -f "$KIT/license.lic" ] && [ -f "$KIT/branding.json" ] || die "$KIT isn't a customer kit (customer.json, license.lic, branding.json)."
  kv() { python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print("" if v is None else v)' "$KIT/customer.json" "$1"; }
  [ -n "$DOMAIN" ] || DOMAIN="$(kv domain)"
  [ -n "$ORG" ] || ORG="$(kv org)"; [ -n "$SHORT" ] || SHORT="$(kv short)"; [ -n "$PLACE" ] || PLACE="$(kv place)"
  T="$(kv timezone)"; [ -n "$T" ] && TZONE="$T"
  T="$(kv lat)"; [ -n "$T" ] && LAT="$T"; T="$(kv lon)"; [ -n "$T" ] && LON="$T"
  SANDBOX=0; PRODUCT=fenmorix
fi
if [ "$LOCAL" = 1 ]; then
  DOMAIN=localhost
  # Services need systemd; Ubuntu on WSL has it on by default, older setups need it switched on
  if [ "$(ps -p 1 -o comm= 2>/dev/null)" != systemd ]; then
    if grep -qi microsoft /proc/version 2>/dev/null; then
      grep -q '^systemd *= *true' /etc/wsl.conf 2>/dev/null || printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf
      die "Ubuntu needs systemd switched on (done now). In Windows PowerShell run:  wsl --shutdown   then open Ubuntu again and run this same command."
    fi
    die "This computer isn't running systemd, which the install needs."
  fi
fi
[ -n "$DOMAIN" ] || die "Give the web address: --domain sandbox.example.com"
[ "$LOCAL" = 1 ] || [ -n "$EMAIL" ] || die "Give an email for the free certificate (renewal notices): --email you@example.com"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "That domain doesn't look right: $DOMAIN"

say "Packages (Node 22, PostgreSQL$([ "$LOCAL" = 1 ] || echo ", certbot"))"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg unzip rsync postgresql openssl $([ "$LOCAL" = 1 ] || echo certbot)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q && apt-get install -y -q nodejs
fi
echo "node $(node -v), npm $(npm -v)"
timedatectl set-timezone "$TZONE" || true
# Small servers (2 GB): a swap file so building the app doesn't run out of memory
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 3500 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo "/swapfile none swap sw 0 0" >> /etc/fstab
  echo "Added a 2 GB swap file."
fi

say "Service account and folders"
id nexus >/dev/null 2>&1 || useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin nexus
mkdir -p "$ROOT"/{updates,logs,backups,certs,tools/updater,data,acme} "$APP/secrets"
chown -R nexus:nexus "$ROOT"
chmod 750 "$ROOT/certs" "$APP/secrets" "$ROOT/backups"

say "Database"
systemctl enable --now postgresql >/dev/null 2>&1 || true
if [ ! -f "$APP/.env" ]; then
  DBPASS="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 28)"
  sudo -u postgres psql -qtc "SELECT 1 FROM pg_roles WHERE rolname = 'nexus_app'" | grep -q 1 \
    && sudo -u postgres psql -qc "ALTER ROLE nexus_app WITH LOGIN PASSWORD '$DBPASS'" \
    || sudo -u postgres psql -qc "CREATE ROLE nexus_app WITH LOGIN PASSWORD '$DBPASS'"
  sudo -u postgres psql -qtc "SELECT 1 FROM pg_database WHERE datname = 'nexus'" | grep -q 1 || sudo -u postgres createdb -O nexus_app nexus
  q() { printf '"%s"' "${1//\"/}"; }
  {
    echo "# Written by install-ubuntu.sh on $(date -I). Change settings in Nexus: User Management > System > Server settings."
    echo "PGHOST=127.0.0.1"; echo "PGPORT=5432"; echo "PGDATABASE=nexus"; echo "PGUSER=nexus_app"; echo "PGPASSWORD=$DBPASS"
    echo "PORT=443"; echo "HOST=0.0.0.0"; echo "HTTP_REDIRECT_PORT=80"; echo "PUBLIC_URL=https://$DOMAIN"
    echo "HTTPS_CERT_FILE=$ROOT/certs/fullchain.pem"; echo "HTTPS_KEY_FILE=$ROOT/certs/privkey.pem"
    echo "SYSTEM_DIR=$ROOT"; echo "UPDATER_COMMAND=/bin/true"; echo "APP_TIMEZONE=$TZONE"
    echo "WEATHER_LAT=$LAT"; echo "WEATHER_LON=$LON"
    [ -n "$ORG" ] && echo "ORG_NAME=$(q "$ORG")"
    [ -n "$SHORT" ] && echo "ORG_SHORT=$(q "$SHORT")"
    [ -n "$PLACE" ] && echo "ORG_PLACE=$(q "$PLACE")"
    [ -n "$APPNAME" ] && echo "APP_NAME=$(q "$APPNAME")"
    [ -n "$PRODUCT" ] && echo "PRODUCT=$PRODUCT"
    # A trial on this computer: made-up spot prices (clearly labeled) until a real price feed's token is set
    [ "$LOCAL" = 1 ] && echo "SPOT_PROVIDER=demo"
    if [ "$SANDBOX" = 1 ]; then
      echo "SANDBOX=on"
      echo "CAD_STATS_TEST_FILE=$ROOT/data/demo-calls.json"; echo "CAD_STATS_UNITS_TEST_FILE=$ROOT/data/demo-units.json"
      echo "CAD_STATS_START=$(date -d '-540 days' +%F)"; echo "CAD_STATS_SYNC_TIME=03:00"
    fi
  } > "$APP/.env"
  chown nexus:nexus "$APP/.env"; chmod 600 "$APP/.env"
  echo "Wrote $APP/.env"
else
  echo ".env is already there; keeping it."
fi

if [ -n "$KIT" ]; then
  say "Customer kit: license, branding, logo"
  mkdir -p "$ROOT/license" "$ROOT/branding/setup"
  install -o nexus -g nexus -m 640 "$KIT/license.lic" "$ROOT/license/nexus.lic"
  # Branding: only the first time (after that the Branding page owns it)
  [ -f "$ROOT/branding/branding.json" ] || install -o nexus -g nexus -m 640 "$KIT/branding.json" "$ROOT/branding/branding.json"
  for L in "$KIT"/logo.png "$KIT"/logo.jpg "$KIT"/logo.svg "$KIT"/logo.webp; do
    [ -f "$L" ] && { rm -f "$ROOT/branding/setup"/logo.*; install -o nexus -g nexus -m 640 "$L" "$ROOT/branding/setup/$(basename "$L")"; }
  done
  chown -R nexus:nexus "$ROOT/license" "$ROOT/branding"
  echo "License $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("license",""))' "$KIT/customer.json") installed for $ORG."
fi

if [ "$LOCAL" = 1 ]; then
say "Certificate (self-signed, for this computer)"
if [ ! -f "$ROOT/certs/fullchain.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -keyout "$ROOT/certs/privkey.pem" -out "$ROOT/certs/fullchain.pem" 2>/dev/null
  chown nexus:nexus "$ROOT/certs/"*.pem; chmod 640 "$ROOT/certs/"*.pem
  echo "Made a certificate for localhost (good for 10 years). The browser warns about it once; that's expected here."
else
  echo "Keeping the certificate in $ROOT/certs."
fi
else
say "Certificate (Let's Encrypt)"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/nexus-copy.sh <<HOOK
#!/bin/sh
# Copy the renewed certificate where Nexus reads it (the post-hook starts Nexus again)
install -o nexus -g nexus -m 640 /etc/letsencrypt/live/$DOMAIN/fullchain.pem $ROOT/certs/fullchain.pem
install -o nexus -g nexus -m 640 /etc/letsencrypt/live/$DOMAIN/privkey.pem $ROOT/certs/privkey.pem
HOOK
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/nexus-copy.sh
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  systemctl stop nexus 2>/dev/null || true
  # Port 80 must be open to the internet for this (cloud firewall / security group: allow TCP 80 and 443)
  certbot certonly --standalone --non-interactive --agree-tos -m "$EMAIL" -d "$DOMAIN" \
    --pre-hook "systemctl stop nexus || true" --post-hook "systemctl start nexus || true" \
    || die "Couldn't get a certificate. Check that $DOMAIN points at this server and that ports 80 and 443 are open, then run this again."
fi
/etc/letsencrypt/renewal-hooks/deploy/nexus-copy.sh

say "Firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; fi
echo "Also allow TCP 22, 80 and 443 in the cloud provider's firewall / security group."
fi

say "Building the app (a few minutes the first time)"
cd "$APP"
sudo -u nexus env HOME="$ROOT" npm_config_cache="$ROOT/tools/npm-cache" npm install --no-audit --no-fund
sudo -u nexus env HOME="$ROOT" npm_config_cache="$ROOT/tools/npm-cache" npm run build

if [ "$SANDBOX" = 1 ] && [ ! -f "$ROOT/data/demo-calls.json" ]; then
  say "Demo calls for Comms Statistics"
  sudo -u nexus node scripts/sandbox/make-demo-stats.mjs "$ROOT/data/demo-calls.json" "$ROOT/data/demo-units.json"
fi

say "Services"
install -m 644 scripts/linux/nexus.service /etc/systemd/system/nexus.service
install -m 644 scripts/linux/nexus-update.path /etc/systemd/system/nexus-update.path
install -m 644 scripts/linux/nexus-update.service /etc/systemd/system/nexus-update.service
install -m 644 scripts/linux/nexus-nightly.service /etc/systemd/system/nexus-nightly.service
install -m 644 scripts/linux/nexus-nightly.timer /etc/systemd/system/nexus-nightly.timer
install -m 750 scripts/linux/apply-update.sh "$ROOT/tools/updater/apply-update.sh"
systemctl daemon-reload
systemctl enable --now nexus-update.path nexus-nightly.timer
systemctl enable nexus
systemctl restart nexus
for i in $(seq 1 40); do curl -fsk -o /dev/null "https://127.0.0.1/" && break; sleep 2; done
curl -fsk -o /dev/null "https://127.0.0.1/" || die "Nexus didn't answer. See $ROOT/logs/sgfd-app.log"

if [ "$SANDBOX" = 1 ]; then
  say "Demo department"
  sudo -u nexus node scripts/sandbox/seed-demo.mjs
fi

say "Done"
NAME="Nexus"; [ "$PRODUCT" = fenmorix ] || [ "$SANDBOX" = 1 ] && NAME="Fenmorix OS"
echo "$NAME is running at https://$DOMAIN"
if [ "$LOCAL" = 1 ]; then
  echo "Open https://localhost in your browser on this computer (accept the certificate warning once) and make the first admin account."
else
  echo "Make the first admin through an SSH tunnel:  ssh -L 8443:127.0.0.1:443 <you>@<this server>  then open https://localhost:8443"
fi
[ -n "$KIT" ] && echo "Sign in, set up the authenticator, and the setup wizard walks through the name, logo, colors and menu names."
echo "After that, updates install from User Management > System."
