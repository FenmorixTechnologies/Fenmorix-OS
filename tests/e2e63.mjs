// Broadcast updates: the office's update service (server/hub.js, vendor module "sales") and a server checking in with it
// (server/updates.js). One test server plays both: it is the office (license keys/office.lic) and points its own update settings at itself.
// Releases signed with the second test key (tests/keys/dev2-private.pem) by the License Manager's sign-release. Run with run-hub.sh.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";
import { zip } from "/home/claude/testrun/app/server/xlsx.js";

const BASE = "http://localhost:3077", PW = "Correct horse battery", SYS = process.env.SYSTEM_DIR;
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const code = async secret => hotp(secret, stepNow());
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Release zips (just enough for the release checks) + signatures from the License Manager
const work = "/tmp/claude-0/hubtest"; fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
const makeZip = (pkg, version, name) => {
  const f = (n, t) => ({ name: n, data: Buffer.from(t) });
  const buf = zip([f("app/package.json", '{"name":"sgfd-app"}'), f("app/server/index.js", "// test"), f("app/src/main.jsx", "// test"), f("app/scripts/update.ps1", "# test"),
    f("app/VERSION.json", JSON.stringify({ package: pkg, version, notes: [`Test release ${version}`, "Second note"] }))]);
  fs.writeFileSync(`${work}/${name}`, buf); return `${work}/${name}`;
};
const LM = "/home/claude/fenmorix-os/tools/license-manager/nexus-license.mjs", KEY = "/home/claude/fenmorix-os/tests/keys/dev2-private.pem";
const sign = file => execSync(`node ${LM} sign-release ${file} --key ${KEY} --kid dev2`).toString();
const z1 = makeZip("sgfd", "2099.1.1.1", "sgfd-nexus-2099.1.1.1.zip"); sign(z1);
const z2 = makeZip("lgc", "2099.1.1.1", "fenmorix-os-lgc-2099.1.1.1.zip"); sign(z2);
const z3 = makeZip("sgfd", "2099.2.2.2", "sgfd-nexus-2099.2.2.2.zip"); sign(z3);
const zBad = makeZip("sgfd", "2099.3.3.3", "sgfd-nexus-2099.3.3.3.zip"); fs.copyFileSync(`${z3}.sig`, `${zBad}.sig`);   // someone else's signature
check("License Manager signs releases", fs.existsSync(`${z1}.sig`) && JSON.parse(fs.readFileSync(`${z1}.sig`, "utf8")).package === "sgfd");
let refusedTest = false; try { execSync(`node ${LM} sign-release ${work}/x-TEST.zip --key ${KEY} --kid dev2`, { stdio: "pipe" }); } catch (e) { refusedTest = /test build/.test(String(e.stderr)); }
check("License Manager refuses a -TEST zip", refusedTest);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
page.on("dialog", d => d.accept());
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const main = () => page.locator("main").innerText();
await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Michael Owner", email: "owner@fenmorix.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(2500);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });

// ---- The office: an installation for this server + releases uploaded through the page ----
await page.locator("nav button", { hasText: "Clients & Quotes" }).first().click(); await page.waitForTimeout(1500);
await page.locator("nav button", { hasText: "Installations" }).first().click(); await page.waitForTimeout(800);
await page.getByRole("button", { name: "Add an installation" }).click();
await page.getByLabel("Installation name").fill("St. George test server"); await page.getByLabel("Package").fill("sgfd");
await page.getByRole("button", { name: "Add and show the key" }).click(); await page.waitForTimeout(1000);
const key = (await page.getByRole("alert").innerText()).match(/fxu_[A-Za-z0-9_-]+/)?.[0];
check("installation added, key shown once", !!key && !JSON.stringify((await api("/api/hub")).body).includes(key), key);
check("key stored hashed", psql("SELECT key_hash FROM hub_installs LIMIT 1").length === 64);
const lgcKey = (await api("/api/hub/installs", { name: "Shop", package: "lgc" })).body.key;

await page.locator("nav button", { hasText: "Releases" }).first().click(); await page.waitForTimeout(800);
await page.getByLabel("Release files").setInputFiles([z1, `${z1}.sig`, z2, `${z2}.sig`]); await page.waitForTimeout(2500);
let hub = (await api("/api/hub")).body;
check("two packages published in one upload (broadcast)", hub.releases.length === 2 && hub.latest.sgfd === "2099.1.1.1" && hub.latest.lgc === "2099.1.1.1", JSON.stringify(hub.latest));
check("release kept on disk", fs.existsSync(`${SYS}/releases/sgfd/2099.1.1.1.zip`));
const b64 = f => fs.readFileSync(f).toString("base64");
const bad = await api("/api/hub/releases", { fileName: "sgfd-nexus-2099.3.3.3.zip", data: b64(zBad), sig: fs.readFileSync(`${zBad}.sig`, "utf8") });
check("a zip with someone else's signature is refused", bad.status === 400 && /different zip/.test(bad.body.error), JSON.stringify(bad.body));
const nosig = await api("/api/hub/releases", { fileName: "sgfd-nexus-2099.3.3.3.zip", data: b64(zBad), sig: "" });
check("a zip without a signature is refused", nosig.status === 400 && /sign-release/.test(nosig.body.error));
const forged = JSON.parse(fs.readFileSync(`${z3}.sig`, "utf8")); forged.sig = forged.sig.slice(0, -4) + (forged.sig.endsWith("AAAA") ? "BBBB" : "AAAA");
const fz = await api("/api/hub/releases", { fileName: "sgfd-nexus-2099.2.2.2.zip", data: b64(z3), sig: JSON.stringify(forged) });
check("a forged signature is refused", fz.status === 400 && /signature/.test(fz.body.error), JSON.stringify(fz.body));
const dup = await api("/api/hub/releases", { fileName: "sgfd-nexus-2099.1.1.1.zip", data: b64(z1), sig: fs.readFileSync(`${z1}.sig`, "utf8") });
check("same version twice refused", dup.status === 409);

// ---- Customer server side (the same test server pointing at itself) ----
const hubCall = (path, k, body) => page.evaluate(async ([path, k, body]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "omit", headers: { authorization: `Bearer ${k}`, "Content-Type": "application/json", "X-SGFD": "1" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, k, body]);
check("unknown key refused", (await hubCall("/api/hub/client/checkin", "fxu_" + "x".repeat(43), { package: "sgfd", version: "1" })).status === 401);
check("a key for another package is refused", (await hubCall("/api/hub/client/checkin", lgcKey, { package: "sgfd", version: "1" })).status === 409);
const relLgc = hub.releases.find(r => r.package === "lgc").id;
check("a server can't download another customer's release", (await hubCall(`/api/hub/client/download/${relLgc}`, key)).status === 404);
psql("UPDATE sessions SET mfa_at = now() - interval '1 hour'");
const nc = await api("/api/system/updates/settings", { url: BASE, key, auto: false });
check("update settings need a code", nc.status >= 400 && nc.body?.need === "code", JSON.stringify(nc));

await page.goto(BASE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
const card = page.getByRole("region", { name: "Automatic updates" });
check("card says not set up", /Not set up/.test(await card.innerText()), await card.innerText());
await card.getByRole("button", { name: "Set up" }).click();
await card.getByLabel("Update service address").fill(BASE); await card.getByLabel("Update key").fill(key);
await card.getByRole("button", { name: "Save" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button").filter({ hasText: /Save|Confirm|Continue|OK/i }).first().click(); await page.waitForTimeout(2500);
let t = await card.innerText();
check("check-in finds the newer version", /Version 2099\.1\.1\.1 is available/.test(t) && /Test release 2099\.1\.1\.1/.test(t), t.slice(0, 400));
check("key file kept private", (fs.statSync(`${SYS}/hub/hub.json`).mode & 0o077) === 0);
hub = (await api("/api/hub")).body;
const me = hub.installs.find(i => i.package === "sgfd");
check("the office sees this server's version", me.lastSeen && me.info.users >= 1 && me.info.modules.includes("sales"), JSON.stringify(me).slice(0, 300));

await card.getByRole("button", { name: "Download and check it" }).click(); await page.waitForTimeout(2500);
t = await card.innerText();
const inc = (await api("/api/system")).body.incoming;
check("downloaded, checked and ready to install", /Downloaded/.test(t) && inc?.version === "2099.1.1.1" && inc.signed === true, JSON.stringify(inc).slice(0, 200));
check("download counted", psql("SELECT downloads FROM hub_installs WHERE package = 'sgfd'") === "1");
check("download audited", /Downloaded an update/.test(psql("SELECT string_agg(action, ';') FROM audit_log WHERE module = 'System'")));

// A newer release, then paused: servers stop being offered it
const r3 = await api("/api/hub/releases", { fileName: "sgfd-nexus-2099.2.2.2.zip", data: b64(z3), sig: fs.readFileSync(`${z3}.sig`, "utf8") });
await api("/api/system/updates/check", {});
check("newest release offered", (await api("/api/system/updates")).body.available?.version === "2099.2.2.2");
await api(`/api/hub/releases/${r3.body.release.id}/pause`, {});
await api("/api/system/updates/check", {});
check("paused release no longer offered (falls back to the previous)", (await api("/api/system/updates")).body.available?.version === "2099.1.1.1");
// Hold this server
await api(`/api/hub/installs/${me.id}`, { name: me.name, hold: true });
await api("/api/system/updates/check", {});
let u = (await api("/api/system/updates")).body;
check("held server is offered nothing", !u.available && u.hold === true, JSON.stringify(u).slice(0, 200));
await api(`/api/hub/installs/${me.id}`, { name: me.name, hold: false });

// ---- Night install by itself (auto on, the time window now) ----
await api("/api/auth/mfa-verify", { code: await code(secret) });
const now = new Date(), hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
const s1 = await api("/api/system/updates/settings", { url: BASE, auto: true, autoAt: hhmm });
check("automatic updates turned on", s1.status === 200 && s1.body.auto === true, JSON.stringify(s1.body).slice(0, 200));
let installed = false;
for (let i = 0; i < 20 && !installed; i++) { await sleep(1000); installed = /Automatic update/.test(psql("SELECT string_agg(actor_name || ':' || action, ';') FROM audit_log WHERE action = 'Installed an update'")); }
check("installed by itself at the set time", installed, psql("SELECT string_agg(actor_name || ':' || action, ';') FROM audit_log WHERE module = 'System'"));
await sleep(2500);
const last = JSON.parse(fs.readFileSync(`${SYS}/updates/last-result.json`, "utf8").replace(/^﻿/, ""));
check("updater ran the install", last.ok && last.version === "2099.1.1.1" && last.by === "Automatic update", JSON.stringify(last));

// ---- The office's Installations page ----
await page.goto(BASE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "Clients & Quotes" }).first().click(); await page.waitForTimeout(1200);
await page.locator("nav button", { hasText: "Installations" }).first().click(); await page.waitForTimeout(1200);
const im = await main();
check("installations page shows version, check-in and behind", /St\. George test server/.test(im) && /2099\.1\.1\.1 available/.test(im) && /just now|min ago/.test(im), im.slice(0, 500));
await page.screenshot({ path: "shot-hub-installs.png" });
check("hub actions audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Updates'")) >= 5);
check("no page errors", !errors.length, errors.join(" | "));
await browser.close(); done();
