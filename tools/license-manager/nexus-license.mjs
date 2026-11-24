#!/usr/bin/env node
// Fenmorix License Manager (Fenmorix OS and SGFD Nexus): makes the license files that turn modules on for a customer. Runs on YOUR computer only.
// Your private signing key never goes on a customer server, in a release, or in an email.
//
//   node nexus-license.mjs keygen                 make your signing key pair (once). Keep private-key.pem safe and backed up.
//   node nexus-license.mjs modules                list the modules a license can include
//   node nexus-license.mjs issue                  answer the questions; writes <customer>-<date>.lic
//   node nexus-license.mjs issue --customer "Acme Logistics" --modules messaging,procurement,timeclock,sick,helpdesk \
//        --hosts ops.acmelogistics.com,test.acmelogistics.com --env production,test --seats 150 --expires 2027-12-31
//   node nexus-license.mjs new-customer           a new customer's kit for Avexon: license + name/colors + logo + install steps
//   node nexus-license.mjs show <file.lic>        what a license says (and whether the signature checks out)
//
// Options for issue: --key <private-key.pem> (default ./private-key.pem)  --kid <key name> (default from key-info.json)
//   --product "<product name>"  --grace <days, default 30>  --notes "..."  --out <file>   Modules: "all" = every module.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { MODULES, MODULE_KEYS, moduleByKey, withNeeds } from "./modules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), cmd = args[0];
const opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const b64u = b => Buffer.from(b).toString("base64url");
const die = m => { console.error(`\n${m}\n`); process.exit(1); };

if (cmd === "keygen") {
  const priv = path.join(HERE, "private-key.pem");
  if (fs.existsSync(priv)) die(`${priv} already exists. Don't replace it: licenses you've issued are tied to it.`);
  const kid = (opt("kid") || `key-${new Date().toISOString().slice(0, 7)}`).replace(/[^\w-]/g, "");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(priv, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  fs.writeFileSync(path.join(HERE, "key-info.json"), JSON.stringify({ kid, publicKey: pub, created: new Date().toISOString() }, null, 2));
  console.log(`\nMade your signing key "${kid}".
  private-key.pem  SECRET. Back it up (password manager / encrypted USB). Anyone with it can make licenses.
  key-info.json    your PUBLIC key (safe to share). Send this line to be built into the app:\n\n  ${kid}: "${pub}"\n`);
  process.exit(0);
}

if (cmd === "modules") {
  let g = "";
  const groups = [...new Set(MODULES.map(m => m.group))];
  for (const m of [...MODULES].sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group))) { if (m.group !== g) console.log(`\n${(g = m.group)}`); console.log(`  ${m.key.padEnd(15)} ${m.name}${m.needs ? `  (needs ${m.needs.join(", ")})` : ""}${m.optIn ? "  [opt-in: name it; not in all]" : ""}`); }
  console.log("\nAlways included (core): sign-in, accounts & permissions, Your Day dashboard, Notifications, Announcements, Directory, Personnel File, User Management, Audit Log, System.\n");
  process.exit(0);
}

if (cmd === "show") {
  const text = fs.readFileSync(args[1] || die("Which file?"), "utf8");
  const m = /-----BEGIN NEXUS LICENSE-----\s*([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(text) || die("Not a license file.");
  const body = Buffer.from(m[1], "base64url").toString("utf8"), p = JSON.parse(body);
  let check = "can't check (no key-info.json here)";
  try {
    const info = JSON.parse(fs.readFileSync(path.join(HERE, "key-info.json"), "utf8"));
    if (info.kid === p.kid) check = crypto.verify(null, Buffer.from(body), crypto.createPublicKey({ key: Buffer.from(info.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(m[2], "base64url")) ? "GOOD" : "BAD (changed after signing)";
    else check = `signed with key "${p.kid}", not yours ("${info.kid}")`;
  } catch { /* no key info */ }
  console.log(JSON.stringify(p, null, 2)); console.log(`\nSignature: ${check}\n`);
  process.exit(0);
}

// ---- Making a signed license (issue and new-customer) ----
function signingKey() {
  const keyFile = opt("key") || path.join(HERE, "private-key.pem");
  if (!fs.existsSync(keyFile)) die(`No signing key at ${keyFile}. Run: node nexus-license.mjs keygen`);
  let kid = opt("kid");
  if (!kid) { try { kid = JSON.parse(fs.readFileSync(path.join(HERE, "key-info.json"), "utf8")).kid; } catch { die("Give --kid (the key's name)."); } }
  return { keyFile, kid };
}
async function licenseQuestions(ask, { customer, hosts: defHosts = "" } = {}) {
  customer = customer || await ask({ key: "customer", text: "Customer (as it should appear)" });
  if (!customer) die("A customer name is needed.");
  if (!opt("modules")) { console.log(`\nModules: ${MODULE_KEYS.join(", ")}  (or "all" for every standard module; add opt-in ones by name, e.g. all,spot,links)`); }
  const modsRaw = await ask({ key: "modules", text: "Modules (comma-separated)" }, "all");
  // "all" = every standard module; opt-in modules (retail) are named: "all,spot,links"
  const wanted = modsRaw.split(/[\s,]+/).filter(Boolean).map(k => (k.toLowerCase() === "all" ? "*" : k));
  const unknown = wanted.filter(k => k !== "*" && !MODULE_KEYS.includes(k));
  if (unknown.length) die(`Unknown module(s): ${unknown.join(", ")}. See: node nexus-license.mjs modules`);
  const all = wanted.includes("*");
  const modules = all ? ["*", ...withNeeds(wanted.filter(k => k !== "*")).filter(k => moduleByKey[k].optIn)] : withNeeds(wanted);
  const added = all ? [] : modules.filter(k => !wanted.includes(k));
  const hosts = (await ask({ key: "hosts", text: "Web addresses it works on (comma-separated, *.example.gov ok; blank = any)" }, defHosts)).split(/[\s,]+/).filter(Boolean).map(h => h.toLowerCase());
  const environments = (await ask({ key: "env", text: "Environments (production,test,training)" }, "production")).split(/[\s,]+/).filter(Boolean);
  const seats = Number(await ask({ key: "seats", text: "User limit (0 = none)" }, "0")) || 0;
  const expires = await ask({ key: "expires", text: "Expires (YYYY-MM-DD, blank = never)" });
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) die("Expires must look like 2027-12-31.");
  return { customer, modules, added, hosts, environments, seats, expires };
}
function signLicense({ keyFile, kid }, q) {
  const issued = new Date().toISOString().slice(0, 10);
  const id = `L-${issued.replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const payload = { v: 1, kid, id, customer: q.customer, product: opt("product") || "Fenmorix OS", modules: q.modules, environments: q.environments, hosts: q.hosts,
    seats: q.seats, issued, expires: q.expires || null, graceDays: Number(opt("grace") ?? 30), notes: opt("notes") || "" };
  const body = JSON.stringify(payload);
  const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(fs.readFileSync(keyFile)));
  return { payload, text: `-----BEGIN NEXUS LICENSE-----\n${b64u(body)}.${b64u(sig)}\n-----END NEXUS LICENSE-----\n` };
}
const modulesText = (q, p) => `${p.modules[0] === "*" ? `every standard module${p.modules.length > 1 ? ` + ${p.modules.slice(1).join(", ")}` : ""}` : p.modules.join(", ")}${q.added.length ? `\n  (added because they're needed: ${q.added.join(", ")})` : ""}`;
// Questions one line at a time (queued, so answers piped in or pasted quickly aren't lost)
function lineReader(rl) {
  const lines = [], waiting = []; let closed = false;
  rl.on("line", l => (waiting.length ? waiting.shift()(l) : lines.push(l)));
  rl.on("close", () => { closed = true; while (waiting.length) waiting.shift()(""); });
  return prompt => { process.stdout.write(prompt); return lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve("") : new Promise(r => waiting.push(r)); };
}
const asker = rl => { const next = lineReader(rl); return async (q, def = "") => (opt(q.key) ?? ((await next(`${q.text}${def ? ` [${def}]` : ""}: `)).trim() || def)); };

if (cmd === "issue") {
  const key = signingKey();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const q = await licenseQuestions(asker(rl));
  rl.close();
  const { payload, text } = signLicense(key, q);
  const out = opt("out") || path.join(HERE, `${q.customer.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${payload.issued}.lic`);
  fs.writeFileSync(out, text);
  console.log(`\nWrote ${out}\n  ${payload.id} for ${q.customer}: ${modulesText(q, payload)}`);
  console.log("Install it in the app: User Management > System > License > Install a license file, then restart.\n");
  process.exit(0);
}

// ---- A new customer: license + branding + logo + install steps for Avexon, in customers/<name>/ ----
if (cmd === "new-customer") {
  const key = signingKey();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const ask = asker(rl);
  console.log("\nNew customer kit. Press Enter to take the [suggestion].\n");
  const org = await ask({ key: "org", text: "Organization's full name (e.g. Acme County Government)" });
  if (!org) die("The organization's name is needed.");
  const words = org.split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(of|the|and|for)$/i.test(w));
  const short = (await ask({ key: "short", text: "Short name for the side bar (up to 20 letters)" }, words.map(w => w[0]).join("").toUpperCase().slice(0, 6))).slice(0, 20);
  const place = await ask({ key: "place", text: "Place (city or county, used in text)" }, words[0] || "");
  const domain = (await ask({ key: "domain", text: "Web address (e.g. ops.acmecounty.gov, or localhost to try it on this computer)" })).toLowerCase();
  const local = domain === "localhost";
  if (!local && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) die("The web address should look like ops.acmecounty.gov (no https://), or localhost.");
  const other = local ? "" : (await ask({ key: "other-hosts", text: "Other web addresses for test/training (comma-separated, blank = none)" })).toLowerCase();
  // A localhost trial: suggest "any server" so the same license still works when the system moves to its real computer
  if (local) console.log("  (Trying it on this computer: leave the next web-address question blank so the license also works where it's installed for real.)");
  const q = await licenseQuestions(ask, { customer: org, hosts: local ? "" : [domain, ...other.split(/[\s,]+/).filter(Boolean)].join(",") });
  const timezone = await ask({ key: "timezone", text: "Time zone" }, "America/Chicago");
  const where = await ask({ key: "location", text: "Location for weather (lat,lon, blank = skip)" });
  const ll = where ? where.split(/[\s,]+/).map(Number) : [];
  if (where && (ll.length !== 2 || ll.some(n => !Number.isFinite(n)))) die("Location should look like 30.45,-91.15");
  const hex = v => { if (v && !/^#[0-9a-f]{6}$/i.test(v)) die(`${v} isn't a color like #1E6BD6.`); return v.toUpperCase(); };
  const accent = hex(await ask({ key: "color", text: "Main color (#RRGGBB, blank = Fenmorix orange)" }));
  const navy = hex(await ask({ key: "sidebar", text: "Side bar color (#RRGGBB, blank = Fenmorix navy)" }));
  const logo = (await ask({ key: "logo", text: "Logo file (square PNG is best; drag the file here, blank = later)" })).replace(/^["']|["']$/g, "");
  rl.close();
  if (logo && !fs.existsSync(logo)) die(`Can't find the logo file: ${logo}`);
  if (logo && !/\.(png|jpe?g|svg|webp)$/i.test(logo)) die("The logo should be a PNG, JPG, SVG or WebP file.");
  if (logo && fs.statSync(logo).size > 10 * 1024 * 1024) die("The logo file is over 10 MB.");

  const slug = org.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const dir = opt("out") || path.join(HERE, "customers", slug);
  if (fs.existsSync(dir) && !args.includes("--force")) die(`${dir} already exists (add --force to replace it).`);
  fs.mkdirSync(dir, { recursive: true });
  const { payload, text } = signLicense(key, q);
  fs.writeFileSync(path.join(dir, "license.lic"), text);
  const colors = {}; if (accent) colors.accent = accent; if (navy) colors.navy = navy;
  fs.writeFileSync(path.join(dir, "branding.json"), JSON.stringify({ org, short, place, app: "", colors, terms: {}, setup: "pending" }, null, 1));
  const customer = { org, short, place, domain, timezone, lat: ll[0] ?? null, lon: ll[1] ?? null, license: payload.id, made: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "customer.json"), JSON.stringify(customer, null, 1));
  let logoName = "";
  if (logo) { logoName = `logo${path.extname(logo).toLowerCase().replace(".jpeg", ".jpg")}`; fs.copyFileSync(logo, path.join(dir, logoName)); }
  const cmdLine = `sudo bash /opt/nexus/app/scripts/linux/install-ubuntu.sh --kit /root/${slug} --email <certificate email>`;
  fs.writeFileSync(path.join(dir, "INSTALL.txt"), local ? [
    `Fenmorix OS trial install for ${org} (this computer)`, `Made ${customer.made.slice(0, 10)} · license ${payload.id} · ${modulesText(q, payload).replace(/\n\s*/g, " ")}`,
    "", "On Windows with Ubuntu (WSL) installed, in the Ubuntu window:",
    "1. Put the release zip and this folder in your Windows Downloads folder, then:",
    "     sudo mkdir -p /opt/nexus && sudo unzip /mnt/c/Users/<you>/Downloads/<the release zip> -d /opt/nexus",
    `     sudo cp -r /mnt/c/Users/<you>/Downloads/${slug} /root/${slug}`,
    `2. sudo bash /opt/nexus/app/scripts/linux/install-ubuntu.sh --kit /root/${slug} --local`,
    "3. Open https://localhost in your browser (accept the certificate warning once: it's your own computer).",
    "   Make the first admin account, set up the authenticator, and the setup wizard walks through the name, logo, colors and menu names.",
    "", "Never put private-key.pem on a server.", "",
  ].join("\n") : [
    `Fenmorix OS install for ${org}`, `Made ${customer.made.slice(0, 10)} · license ${payload.id} · ${modulesText(q, payload).replace(/\n\s*/g, " ")}`,
    "", "For Avexon (Ubuntu 22.04 / 24.04 server):",
    `1. DNS: an A record for ${domain} pointing at the server's public IP. Allow TCP 22, 80 and 443.`,
    "2. Copy the Fenmorix OS release zip and this whole folder to the server, then:",
    "     sudo mkdir -p /opt/nexus && sudo unzip <the release zip> -d /opt/nexus",
    `     sudo cp -r ${slug} /root/${slug}`,
    `3. ${cmdLine}`,
    "4. First admin account (first-run works only from the server itself):",
    "     ssh -L 8443:127.0.0.1:443 <you>@<server>    then open https://localhost:8443",
    "   Sign in, set up the authenticator, and the setup wizard walks through the name, logo, colors and menu names.",
    "", "The license here only works on the web addresses it lists. Never put private-key.pem on a server.", "",
  ].join("\n"));
  console.log(`\nCustomer kit: ${dir}\n  license.lic   ${payload.id}: ${modulesText(q, payload)}\n  branding.json name${accent || navy ? ", colors" : ""}\n  customer.json web address, time zone, location${logoName ? `\n  ${logoName}      the logo (the setup wizard makes the icons from it)` : ""}\n  INSTALL.txt   ${local ? "how to install it on this computer" : "the steps for Avexon"}\n`);
  console.log(local ? `To try it: see INSTALL.txt in that folder (Ubuntu on Windows, --local).\n` : `Send Avexon the whole folder (zip it), with the release zip.\n`);
  process.exit(0);
}

console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 17).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
