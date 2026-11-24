# Setting up a Nexus sandbox on a cloud server

A sandbox is a separate copy of Nexus with a made-up fire department, for other departments to try out. It never shares a server, database or data with a real department's Nexus.

## What you need
- A small Ubuntu 24.04 (or 22.04) cloud server: 2 vCPU, 4 GB RAM and 40 GB disk is plenty (Azure B2s, AWS t3.medium, DigitalOcean 4 GB).
- A web address for it, for example `sandbox.yourdomain.com`, with a DNS **A record** pointing at the server's public IP.
- The cloud firewall / security group open for TCP **22** (SSH), **80** and **443**.
- The Nexus release zip.

## Install (about 10 minutes)
1. Copy the zip to the server (WinSCP, or `scp nexus-app.zip you@server:`) and unzip it:
   `sudo mkdir -p /opt/nexus && sudo unzip nexus-app.zip -d /opt/nexus`
2. Run the installer:
   `sudo bash /opt/nexus/app/scripts/linux/install-ubuntu.sh --domain sandbox.yourdomain.com --email you@yourdomain.com --sandbox`
   Optional: `--org "Demo Fire District" --short DEMO --app-name "Nexus Sandbox" --timezone America/Chicago --lat 30.37 --lon -91.01`
3. Make yourself the first admin. First-run setup only works from the server itself, so open an SSH tunnel from your PC:
   `ssh -L 8443:127.0.0.1:443 you@server`, then browse to `https://localhost:8443` (accept the certificate-name warning once) and create your account.
4. Sign in at `https://sandbox.yourdomain.com` and set up your authenticator when asked.

## Running it
- **People from other departments** use "Request an account". They must say which department they're with; you approve them in User Management. Everyone approved can view every section (group "Sandbox testers"). Give a role (approver, fire chief…) for signing and editing.
- **Updates** install from User Management › System exactly like the district server.
- **Backups** run every night at 2:15 into `/opt/nexus/backups` (14 days kept).
- **Start over:** `sudo bash /opt/nexus/app/scripts/linux/reset-sandbox.sh` erases everything people entered and reloads the demo department. Accounts are kept unless you add `--wipe-accounts`.
- **Logs:** User Management › System, or `/opt/nexus/logs/sgfd-app.log`.

## What's different from a department's Nexus
- A "Sandbox" banner on every page.
- Investigations (CJIS) is turned off.
- Active calls, Comms statistics and the Board Report use made-up calls. A new day of calls is added every night.
- Only generic forms and a sample evaluation program are included, with none of any real department's documents.
- AI features stay off until you put an API key in Server settings, and every use is billed to that key.
