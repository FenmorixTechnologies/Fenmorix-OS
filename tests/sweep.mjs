// Opens every section and every page inside it; reports page errors and blank pages. Run on any build (fictional data only).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
let errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(BASE); await page.waitForTimeout(800);
await page.evaluate(async pw => fetch("/api/auth/first-run", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ name: "Robin Admin", email: "robin@shop.example", password: pw }) }), PW);
await page.goto(BASE); await page.waitForTimeout(2500);
await page.getByRole("button", { name: /later/i }).first().click().catch(() => {});
const SKIP = /^(Home|Main menu|Change password|Sign out|Signed-in devices|SECTIONS)$/;
const navNames = async () => [...new Set((await page.locator("nav button").allInnerTexts()).map(t => t.split("\n")[0].trim()).filter(t => t && !SKIP.test(t)))];
const sections = await navNames();
const bad = [];
const look = async label => {
  await page.waitForTimeout(1300);
  const main = (await page.locator("main").innerText().catch(() => "")).trim();
  if (errs.length) bad.push(`${label}: ERROR ${errs.join(" | ").slice(0, 200)}`);
  else if (main.length < 15) bad.push(`${label}: BLANK`);
  else if (/^Loading…?$/m.test(main) || main.endsWith("Loading…")) { await page.waitForTimeout(3000); const again = (await page.locator("main").innerText().catch(() => "")).trim(); if (/Loading…\s*$/.test(again)) bad.push(`${label}: STUCK LOADING`); }
  errs = [];
};
let pages = 0;
for (const s of sections) {
  await page.goto(BASE); await page.waitForTimeout(1500); errs = [];
  await page.locator("nav button", { hasText: s }).first().click().catch(() => {});
  await look(s); pages++;
  const subs = (await navNames()).filter(n => !sections.includes(n));
  for (const sub of subs) {
    await page.locator("nav button", { hasText: sub }).first().click().catch(() => {});
    await look(`${s} › ${sub}`); pages++;
  }
}
console.log(`sections: ${sections.join(", ")}\npages opened: ${pages}`);
await page.goto(BASE); await page.waitForTimeout(1500);
await page.locator("nav button", { hasText: "Directory" }).first().click(); await page.waitForTimeout(1500);
console.log("Directory nav: " + (await navNames()).filter(n => !sections.includes(n)).join(", "));
console.log(bad.length ? bad.join("\n") : "ALL CLEAN");
await browser.close();
