// Setup wizard for a new customer's install (License Manager kit -> install-ubuntu.sh --kit): shown to the first master admin,
// "Do this later" hides it for the session, steps come pre-filled from the kit (name, colors, logo), Finish saves it all.
// Run with run-kit.sh (PRODUCT=fenmorix, ORG_NAME, SYSTEM_DIR with branding/branding.json setup "pending" + branding/setup/logo.png,
// LICENSE_FILE = lakeview.lic). Fictional data only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077", PW = "Correct horse battery", SYS = process.env.SYSTEM_DIR;
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
let ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
let page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const wizard = () => page.getByRole("region", { name: "Setup wizard" });
const next = () => wizard().getByRole("button", { name: "Next" }).click();

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Casey Admin", email: "casey@acme.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(2500);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });
await page.goto(BASE); await page.waitForTimeout(2500);
check("setup wizard shown to the first master admin", await wizard().count() === 1);
const logoResp = await page.evaluate(async () => { const r = await fetch("/api/system/branding/setup-logo"); return r.status + " " + r.headers.get("content-type"); });
check("kit logo served to the wizard", logoResp === "200 image/png", logoResp);

// Later: gone for this session, back on the next sign-in
await wizard().getByRole("button", { name: "Do this later" }).click(); await page.waitForTimeout(1500);
check("'Do this later' opens the app", await wizard().count() === 0 && /Announcements/.test(await page.getByRole("navigation").first().innerText()));
await page.reload(); await page.waitForTimeout(2500);
check("stays hidden for this session", await wizard().count() === 0);
await ctx.close();
ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } }); page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.message));
await page.goto(BASE); await page.waitForTimeout(1200);
await page.getByLabel(/^Email/).fill("casey@acme.example"); await page.getByLabel(/^Password/).fill(PW);
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1500);
const c1 = page.getByLabel(/code/i).first(); if (await c1.count()) { await c1.fill(await code(secret)); await page.keyboard.press("Enter"); }
await page.waitForTimeout(2500);
check("back on the next sign-in", await wizard().count() === 1);

// Welcome: what's licensed
let t = await wizard().innerText();
check("welcome lists the license", /Lakeview Fire Department/.test(t) && /Messaging & Chat/.test(t) && /ISO \/ PIAL Rating Tracker/.test(t), t.slice(0, 300));
await page.screenshot({ path: "shot-wizard-welcome.png" });
await next();
check("name pre-filled from the kit", await wizard().getByLabel("Organization's full name").inputValue() === "Acme County Government");
await wizard().getByLabel("Short name (side bar)").fill("ACME");
await next(); await page.waitForTimeout(800);
check("kit logo ready to use", await wizard().getByRole("img", { name: "New logo" }).count() === 1);
await next();
check("colors pre-filled from the kit", await wizard().getByLabel("Main color", { exact: true }).inputValue() === "#1E6BD6");
await page.screenshot({ path: "shot-wizard-colors.png" });
await next();
await wizard().getByLabel("Menu name for Messages").fill("Inbox");
await next();
t = await wizard().innerText();
check("finish page sums it up", /Acme County Government/.test(t) && /ACME/.test(t) && /#1E6BD6/.test(t) && /1 menu name changed/.test(t), t.slice(0, 300));
await wizard().getByRole("button", { name: "Finish setup" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Finish setup" }).click(); await page.waitForTimeout(3000);
check("finished", await page.getByRole("region", { name: "Setup finished" }).count() === 1);
const saved = JSON.parse(fs.readFileSync(`${SYS}/branding/branding.json`, "utf8"));
check("saved: done, name, colors, menu name", saved.setup === "done" && saved.short === "ACME" && saved.colors.accent === "#1E6BD6" && saved.terms.messages === "Inbox", JSON.stringify(saved));
check("icon set made from the kit logo", ["icon-192.png", "favicon.ico", "nexus-emblem.png", "nexus-watermark.jpg"].every(n => fs.existsSync(`${SYS}/branding/assets/${n}`)));
await page.getByRole("button", { name: "Open Fenmorix OS" }).click(); await page.waitForTimeout(3000);
const nav = await page.getByRole("navigation").first().innerText();
const sideLogo = await page.getByRole("navigation").first().getByRole("img", { name: "Acme County Government" }).count();
check("app opens with the customer's logo across the top and menu names", await wizard().count() === 0 && sideLogo === 1 && nav.includes("Inbox") && !/\bMessages\b/.test(nav), nav.replace(/\n/g, " | ").slice(0, 200));
check("not pending any more", (await page.evaluate(() => JSON.parse(document.querySelector('meta[name="nexus-brand"]').content).setupPending)) === false);
await page.screenshot({ path: "shot-wizard-home.png" });
check("audited", /Finished the setup wizard/.test(JSON.stringify((await api("/api/audit?q=setup")).body || {})));
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
