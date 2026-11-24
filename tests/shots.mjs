import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
const api = (path, body) => page.evaluate(async ([path, body]) => (await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) })).json(), [path, body]);
await page.goto(BASE); await settle();
await api("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e, d] of [["Riley Requester","riley@sgfd.org","Suppression"],["Pat Purchaser","pat@sgfd.org","Suppression"]])
  await api("/api/auth/signup", { name: n, email: e, division: d, password: PW });
await page.context().clearCookies(); await page.goto(BASE); await settle();
await page.screenshot({ path: "shot-login.png" });
await page.getByLabel("Email").fill("mike@sgfd.org"); await page.getByLabel("Password").fill(PW);
await page.getByRole("button", { name: "Sign in" }).click(); await settle();
await page.screenshot({ path: "shot-splash.png" });
await page.getByText("Procurement / Requisitions", { exact: true }).click(); await settle();
for (const [t, amt] of [["Portable radios for Engine 31", "4800"], ["Annual SCBA flow testing", "2350"], ["Station 2 bay door repair", "980"]]) {
  await page.getByText("New requisition", { exact: true }).first().click(); await settle();
  await page.getByPlaceholder("e.g. Annual records-management software renewal").fill(t);
  await page.getByPlaceholder("Vendor or company name").fill("Motorola Solutions");
  await page.getByPlaceholder("0.00").first().fill(amt);
  await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
}
await page.waitForTimeout(2700);
await page.screenshot({ path: "shot-reqs.png" });
await page.getByText("Admin", { exact: true }).click(); await settle();
await page.screenshot({ path: "shot-admin.png" });
await page.getByText("Dashboard", { exact: true }).click(); await settle();
await page.screenshot({ path: "shot-dash.png" });
await browser.close();
