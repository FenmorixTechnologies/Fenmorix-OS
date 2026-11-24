// A branded preview of Louisiana Gold & Coins on Fenmorix OS (demo prices; fictional people): screenshots for Michael and LaurAnn.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";
const BASE = "http://localhost:3077", PW = "Correct horse battery", T = "/home/claude/testrun";
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
await page.goto(BASE); await wait(800);
await api("/api/auth/first-run", { name: "LaurAnn Demo", email: "owner@shop.example", password: PW });
await page.goto(BASE); await wait(2500);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });
await api("/api/auth/mfa-verify", { code: await code(secret) });
console.log((await api("/api/system/branding", { org: "Louisiana Gold & Coins", short: "LGC", place: "Baton Rouge", app: "", setup: "done",
  colors: { accent: "#C9A227", accentDark: "#9C7A16", glow: "#7FA6D6", navy: "#06234A", black: "#03142B", silver: "#C9D3E0" }, terms: {} })).status);
for (const [t, u, c] of [["PCGS Cert Verification", "https://www.pcgs.com/cert", "Grading"], ["NGC Verify", "https://www.ngccoin.com/certlookup/", "Grading"],
  ["Greysheet", "https://www.greysheet.com", "Pricing"], ["UPS", "https://www.ups.com", "Shipping"], ["USPS", "https://www.usps.com", "Shipping"]])
  await api("/api/links", { title: t, url: u, category: c });
await api("/api/links", { title: "Supplier portal", url: "https://supplier.example.com", category: "Suppliers", login: { user: "demo", password: "demo" } });
// Logo + name logo through the Branding page (the browser makes the icon set)
await page.goto(BASE); await wait(2000);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await wait(700);
await page.locator("nav button", { hasText: "System" }).first().click(); await wait(1500);
const card = page.getByRole("region", { name: "Branding" });
await card.getByLabel("Logo file", { exact: true }).setInputFiles(`${T}/lgc/coin.png`); await wait(1200);
await card.getByRole("button", { name: "Use this logo" }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Use this logo" }).click(); await wait(1500);
await card.getByLabel("Name logo file").setInputFiles(`${T}/lgc/logo_light.png`); await wait(800);
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Use this name logo" }).click(); await wait(1500);
await page.goto(BASE); await wait(3500);
await page.screenshot({ path: `${T}/lgc-home.png` });
await page.locator("nav button", { hasText: "Spot Prices" }).first().click(); await wait(2500);
await page.screenshot({ path: `${T}/lgc-spot.png` });
await page.goto(BASE); await wait(1500);
await page.locator("nav button", { hasText: "Quick Links" }).first().click(); await wait(1500);
await page.screenshot({ path: `${T}/lgc-links.png` });
const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await p2.goto(BASE); await wait(2500);
await p2.screenshot({ path: `${T}/lgc-signin.png` });
await browser.close();
