// Sandbox demo modules: a master admin switches modules on/off (add-ons included) on a sandbox with no license file.
// Run with run-demo.sh (SANDBOX=on SYSTEM_DIR=sysroot-demo). Fictional data only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3077", PW = "Correct horse battery", T = "/home/claude/testrun";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const meta = () => page.evaluate(() => JSON.parse(document.querySelector('meta[name="nexus-brand"]').content));
const navText = async () => (await page.locator("nav").first().innerText());

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Robin Admin", email: "robin@demo.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(2500);

let l = await api("/api/system/license");
check("sandbox with no license: demo switches offered", l.status === 200 && l.body.demo === true && l.body.demoSaved === false, JSON.stringify(l.body).slice(0, 200));
check("add-ons start off (standard modules on)", !l.body.modules.find(m => m.key === "spot").on && l.body.modules.find(m => m.key === "procurement").on
  && l.body.modules.find(m => m.key === "spot").optIn === true);

// Gold & coin shop through the API
let r = await api("/api/system/demo-modules", { modules: ["timeclock", "offwork", "sick", "messaging", "spot", "links"] });
check("save the shop set", r.status === 200 && r.body.saved && r.body.demoSaved, JSON.stringify(r.body).slice(0, 200));
check("saved on the server", JSON.parse(fs.readFileSync(`${T}/sysroot-demo/sandbox/modules.json`, "utf8")).modules.join(",") === "messaging,timeclock,offwork,sick,spot,links");
await page.goto(BASE); await page.waitForTimeout(2500);
let m = await meta(), nav = await navText();
check("page shows only the shop's modules", m.modules.includes("spot") && m.modules.includes("links") && !m.modules.includes("procurement"), m.modules.join(","));
check("side bar: Spot Prices and Quick Links, no Procurement", /Spot Prices/.test(nav) && /Quick Links/.test(nav) && !/Procurement/.test(nav), nav.replace(/\n/g, " | ").slice(0, 300));
check("spot prices answer (demo provider)", (await api("/api/spot")).status === 200);
check("a module that's off is locked", (await api("/api/leave")).status === 404);

// Turning one on brings what it needs; bogus keys are dropped
r = await api("/api/system/demo-modules", { modules: ["callalerts", "nope"] });
check("needs added, unknown dropped", r.status === 200 && r.body.modules.filter(x => x.on).map(x => x.key).join(",") === "activecalls,callalerts", r.body.modules.filter(x => x.on).map(x => x.key).join(","));

// The card on the System page
await page.goto(BASE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
const card = page.getByRole("region", { name: "Demo modules" });
check("Demo modules card on the System page", await card.count() === 1, (await page.locator("main").innerText()).slice(0, 200));
await card.getByRole("button", { name: "Everything" }).click();
await card.getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(1200);
l = await api("/api/system/license");
check("Everything = every module incl. add-ons", l.body.modules.every(x => x.on), l.body.modules.filter(x => !x.on).map(x => x.key).join(","));
check("reload button after saving", await card.getByRole("button", { name: "Reload to see it" }).count() === 1);
await card.getByRole("checkbox", { name: /Live Dispatch Feed/i }).uncheck();
const cb = card.getByRole("checkbox", { name: /Dispatch Alerts/i });
check("turning a module off also turns off what needs it", !(await cb.isChecked()));
await card.getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(1200);
l = await api("/api/system/license");
check("saved without them", !l.body.modules.find(x => x.key === "activecalls").on && !l.body.modules.find(x => x.key === "callalerts").on && l.body.modules.find(x => x.key === "spot").on);
await page.screenshot({ path: "shot-demo-modules.png", fullPage: false });

const audit = await api("/api/audit?module=System");
check("audited", JSON.stringify(audit.body).includes("Changed the demo modules"), JSON.stringify(audit.body).slice(0, 200));
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
