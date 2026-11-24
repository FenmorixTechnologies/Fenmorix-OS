// Branding page (Fenmorix OS): names, colors, menu names, logo -> icon set, reset; St. George's Nexus can't be changed. Fictional data only.
// Run with: SANDBOX=on SYSTEM_DIR=/home/claude/testrun/sysroot-brand        (or NEXUS_MODE=1 with SYSTEM_DIR only: the SGFD check)
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077", PW = "Correct horse battery", T = "/home/claude/testrun", APP = `${T}/app`;
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const bytes = path => page.evaluate(async p => Array.from(new Uint8Array(await (await fetch(p, { cache: "no-store" })).arrayBuffer())), path);
const brandMeta = () => page.evaluate(() => JSON.parse(document.querySelector('meta[name="nexus-brand"]').content));

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Robin Admin", email: "robin@acme.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(2500);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });

if (process.env.NEXUS_MODE) {
  const g = await api("/api/system/branding");
  check("SGFD Nexus: branding not editable", g.status === 200 && g.body.editable === false && g.body.product === "nexus", JSON.stringify(g.body).slice(0, 120));
  await api("/api/auth/mfa-verify", { code: await code(secret) });
  const p = await api("/api/system/branding", { org: "Someone Else", colors: { accent: "#00FF00" } });
  check("SGFD Nexus: saving refused", p.status === 409, JSON.stringify(p.body));
  await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(700);
  await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1200);
  check("SGFD Nexus: no Branding card", await page.getByRole("region", { name: "Branding" }).count() === 0);
  check("SGFD Nexus: still SGFD Nexus", (await page.title()) === "SGFD Nexus" && (await brandMeta()).product === "nexus");
  const sgNav = await page.getByRole("navigation").first().innerText();
  check("SGFD Nexus: no retail sections (opt-in modules)", !/Spot Prices|Quick Links/.test(sgNav) && (await api("/api/spot")).status === 404 && (await api("/api/links")).status === 404
    && !(await brandMeta()).modules.includes("spot"), sgNav.slice(0, 120));
  check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
  await browser.close(); done(); process.exit(0);
}

const fenmorixIcon = fs.readFileSync(`${APP}/public/brand-fenmorix/icon-192.png`);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(700);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
const card = page.getByRole("region", { name: "Branding" });
check("Branding card on the System page", await card.count() === 1, JSON.stringify((await api("/api/system/branding")).body).slice(0, 300) + " | " + (await page.locator("main").innerText()).slice(0, 200));
await card.screenshot({ path: "shot-branding-card.png" });

// ---- Names, colors, menu names ----
await card.getByLabel("Organization", { exact: true }).fill("Acme County Government");
await card.getByLabel("Short name (side bar)").fill("ACME");
await card.getByLabel("Main color", { exact: true }).fill("#1E6BD6");
await card.getByLabel("Menu name for Procurement / Requisitions").fill("Purchasing");
await card.getByLabel("Menu name for Help Desk").fill("IT Support");
check("preview follows the edits", /Purchasing/.test(await card.getByLabel("Branding preview").innerText()));
await card.getByRole("button", { name: "Save branding" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Save the branding" }).click(); await page.waitForTimeout(1200);
const saved = JSON.parse(fs.readFileSync(`${process.env.SYSTEM_DIR}/branding/branding.json`, "utf8"));
check("saved outside the app folder", saved.org === "Acme County Government" && saved.colors.accent === "#1E6BD6" && saved.terms.procurement === "Purchasing" && saved.updatedBy === "Robin Admin",
  JSON.stringify(saved).slice(0, 200));
await page.goto(BASE); await page.waitForTimeout(2500);
let m = await brandMeta();
check("page carries the new name and color", m.org === "Acme County Government" && m.short === "ACME" && m.colors.accent === "#1E6BD6" && m.terms.helpdesk === "IT Support");
let nav = await page.getByRole("navigation").first().innerText();
check("menu uses the new names", nav.includes("Purchasing") && nav.includes("IT Support") && !nav.includes("Procurement / Requisitions") && !nav.includes("Help Desk"), nav.replace(/\n/g, " | "));
const pill = await page.locator('nav button[aria-current="page"]').first().evaluate(e => getComputedStyle(e).backgroundImage + " " + getComputedStyle(e).boxShadow);
check("active menu item in the new color", /30, 107, 214/.test(pill), pill);
await page.locator("nav button", { hasText: "Purchasing" }).first().click(); await page.waitForTimeout(1500);
check("section's own side bar says Purchasing", /purchasing/i.test(await page.getByRole("navigation").first().innerText()) && await page.getByRole("navigation", { name: "Purchasing pages" }).count() === 1,
  (await page.getByRole("navigation").first().innerText()).slice(0, 200).replace(/\n/g, " | ") + " :: " + (await page.getByRole("navigation").first().getAttribute("aria-label")));
await page.screenshot({ path: "shot-branding-home.png" });
const sign = await (await browser.newContext()).newPage(); await sign.goto(BASE); await sign.waitForTimeout(1500);
check("sign-in page shows the organization", /Acme County Government/.test(await sign.locator("body").innerText()) && (await sign.title()) === "Fenmorix OS");
await sign.context().close();

// ---- Logo -> icon set ----
await page.goto(BASE); await page.waitForTimeout(1500);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(700);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
await card.getByLabel("Logo file", { exact: true }).setInputFiles(`${T}/test-logo.png`); await page.waitForTimeout(1500);
check("new icons previewed before saving", await card.getByRole("img", { name: "App icon (new)" }).count() === 1);
await card.getByRole("button", { name: "Use this logo" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Use this logo" }).click(); await page.waitForTimeout(1500);
const up = `${process.env.SYSTEM_DIR}/branding/assets`;
const made = fs.existsSync(up) ? fs.readdirSync(up).sort() : [];
check("icon set written", ["apple-touch-icon.png", "favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "logo-large.png", "nexus-emblem.png", "nexus-hero-art.png", "nexus-watermark.jpg"].every(n => made.includes(n)), made.join(","));
const icon = Buffer.from(await bytes("/icon-192.png"));
check("app icon served from the upload", icon.length > 100 && !icon.equals(fenmorixIcon) && icon.readUInt32BE(16) === 192 && icon.readUInt32BE(20) === 192, icon.length);
const ico = Buffer.from(await bytes("/favicon.ico"));
check("favicon is an ICO with 3 sizes", ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 3);
const wm = Buffer.from(await bytes("/nexus-watermark.jpg"));
check("watermark is a JPEG", wm[0] === 0xff && wm[1] === 0xd8);
// Wide name logo
await card.getByLabel("Name logo file").setInputFiles(`${T}/test-wordmark.png`); await page.waitForTimeout(800);
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Use this name logo" }).click(); await page.waitForTimeout(1200);
const wmk = Buffer.from(await bytes("/brand-wordmark.png"));
check("name logo scaled to 1200 wide", wmk.readUInt32BE(16) === 1200 && wmk.readUInt32BE(20) === 240, `${wmk.readUInt32BE(16)}x${wmk.readUInt32BE(20)}`);

// ---- Bad input refused ----
await api("/api/auth/mfa-verify", { code: await code(secret) });
let r = await api("/api/system/branding", { org: "x", colors: { accent: "orange" } });
check("bad color refused", r.status === 400 && /RRGGBB/.test(r.body?.error || ""), JSON.stringify(r.body));
const jpg = "data:image/jpeg;base64," + wm.toString("base64");
r = await api("/api/system/branding/logo", { files: { "icon-192.png": jpg } });
check("JPEG under a PNG name refused", r.status === 400, JSON.stringify(r.body));
r = await api("/api/system/branding/logo", { files: { "../../app/server/index.js": jpg } });
check("other file names refused", r.status === 400 && !fs.existsSync(`${process.env.SYSTEM_DIR}/app`), JSON.stringify(r.body));
r = await api("/api/system/branding/logo", { files: { "icon-192.png": "data:text/html;base64,PGgxPg==" } });
check("non-picture refused", r.status === 400, JSON.stringify(r.body));

// ---- Back to the Fenmorix logo ----
await page.goto(BASE); await page.waitForTimeout(1500);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(700);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
await card.getByRole("button", { name: "Back to the Fenmorix OS logo" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Go back to the Fenmorix OS logo" }).click(); await page.waitForTimeout(1200);
check("back to the Fenmorix icon", Buffer.from(await bytes("/icon-192.png")).equals(fenmorixIcon) && !fs.readdirSync(up).length);
const aud = JSON.stringify((await api("/api/audit?q=branding")).body || {}) + JSON.stringify((await api("/api/audit?q=logo")).body || {});
check("audited", /Changed the branding/.test(aud) && /Changed the logo/.test(aud) && /Removed logo files/.test(aud));
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
