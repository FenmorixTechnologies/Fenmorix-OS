import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", m => m.type() === "error" && errors.push(m.text()));
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(500); };
await page.goto(BASE); await settle();
await page.evaluate(b => fetch("/api/auth/first-run", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await ctx.clearCookies(); await page.reload(); await settle();
await page.getByLabel(/^Email( \*)?$/).fill("mike@sgfd.org"); await page.getByLabel(/^Password( \*)?$/).fill(PW);
await page.getByRole("button", { name: "Sign in" }).click(); await settle();
await page.getByText("Comms Statistics", { exact: true }).first().click(); await settle();
for (const [nav, file] of [["Overview", "ov"], ["Volume & Trends", "vol"], ["Call-taking", "ct"], ["Call takers & dispatchers", "ppl"], [/^Data & settings/, "admin"], ["Reports", "rep"]]) {
  await page.getByRole("button", { name: nav, exact: typeof nav === "string" }).first().click(); await settle(); await page.waitForTimeout(800);
  await page.screenshot({ path: `stats-${file}.png`, fullPage: true });
}
await page.getByRole("button", { name: "Open Weekly Command Briefing" }).click(); await settle(); await page.waitForTimeout(1200);
await page.screenshot({ path: "stats-builder.png", fullPage: true });
await page.emulateMedia({ media: "print" }); await page.pdf({ path: "stats-report.pdf", format: "Letter" }); await page.emulateMedia({ media: "screen" });
console.log("errors:", errors.join(" | ") || "none");
await browser.close();
