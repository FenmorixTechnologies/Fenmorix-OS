# Fenmorix License Manager

This is your private tool for making the license files that switch modules on for each customer. Keep this folder on your own computer, never on a customer's server, Avexon's servers, or in a shared drive.

## One-time setup
1. Install Node.js 20 or newer (it's already on the servers, but run this on **your** computer).
2. Unzip this folder somewhere private, open a terminal in it, and run:
   `node nexus-license.mjs keygen`
3. That makes two files:
   - **private-key.pem**: your signing key. Anyone who has it can make licenses for your software. Back it up in two safe places, such as a password manager and an encrypted USB drive. If you lose it, you can't renew licenses you've already issued.
   - **key-info.json**: your **public** key. It's safe to share. Send the line it prints, `key-…: "MCow…"`, so it can be built into Fenmorix OS. Until it is, the app only accepts development licenses on test machines.

## A new customer (kit for Avexon)
`node nexus-license.mjs new-customer` asks for:
- the organization's name, short name and place,
- its web address (and any test/training addresses),
- the modules, user limit, environments and expiry date (these go into the license),
- the time zone and location (for weather),
- a main color and side bar color (optional), and the logo file (optional; you can drag the file into the window).

It makes a folder `customers/<name>/` with:
- `license.lic`: their signed license (it only works on the web addresses you gave),
- `branding.json`: name and colors,
- `customer.json`: web address, time zone and location,
- `logo.png` (if you gave one),
- `INSTALL.txt`: the exact steps for Avexon.

Zip that folder and send it to Avexon along with the release zip. Their installer (`install-ubuntu.sh --kit <folder>`) sets the server up for that customer. The first time the customer's admin signs in, a short setup wizard walks through the name, logo, colors and menu names, already filled in from the kit. Everything can be changed later under User Management › System › Branding.

## Making a license
`node nexus-license.mjs issue` asks for each setting:
- **Customer:** the name as it should appear.
- **Modules:** comma-separated keys, or `all`. Run `node nexus-license.mjs modules` to see the keys. Modules that need another module get it added automatically; for example, Incident Command Board adds Live Dispatch Feed.
- **Web addresses:** the customer's web addresses, such as `nexus.acmecounty.gov,test.acmecounty.gov`. `*.acmecounty.gov` covers every address under that domain. Leave it blank to allow any address (not recommended).
- **Environments:** production, test or training.
- **User limit:** 0 means no limit.
- **Expires:** `YYYY-MM-DD`, or blank for never. After it expires, everything keeps working for 30 days (change this with `--grace N`), then only the core sections remain.

You can skip the questions by passing the settings directly:
`node nexus-license.mjs issue --customer "Acme Logistics" --modules messaging,procurement,timeclock,sick,helpdesk --hosts ops.acmelogistics.com --env production --seats 150 --expires 2027-12-31`

This writes a `.lic` file. The customer's admin, or Avexon, installs it in Fenmorix OS (or SGFD Nexus) under **User Management › System › License › Install a license file** and then restarts. To add a module later, issue a new license with the larger list. There's nothing to reinstall.

`node nexus-license.mjs show acme.lic` prints what a license contains and confirms that its signature is valid.

## What a license can't be used for
- Changing any character, such as adding a module or moving the date, breaks the signature, and the app refuses the file.
- A license only works at the web addresses listed in it.
- Without your private key, nobody can make a new license.
