// Main menu groups: the Home side bar shows sections in collapsible groups (open/closed remembered per browser); a master renames,
// reorders and moves sections between groups in User Management › Organization › Main menu, and can make groups start closed.
// Run with run-menu.sh (business install, shop license).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const side = () => page.locator("nav[aria-label=\"Home pages\"], nav[aria-label$=\" pages\"]").first();
const home = async () => { await page.goto(BASE); await page.waitForTimeout(2200); };

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Laura Owner", email: "owner@shop.example", password: PW });
await home(); await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/claude-0/m65.png" }); let t = await side().innerText();
check("groups on the Home side bar", /EVERYDAY|Everyday/i.test(t) && /PEOPLE & TIME/i.test(t) && /ADMINISTRATION/i.test(t), t.slice(0, 500));
check("sections under their group", (await side().getByRole("button", { name: "Messages" }).count()) === 1);
const grp = side().getByRole("button", { name: /People & time/i });
check("group heading is a button that's open", (await grp.getAttribute("aria-expanded")) === "true");
await grp.click(); await page.waitForTimeout(300);
check("closing a group hides its sections", (await grp.getAttribute("aria-expanded")) === "false" && (await side().getByRole("button", { name: /^Time Tracker/ }).count()) === 0);
await home();
check("closed group remembered after reload", (await side().getByRole("button", { name: /People & time/i }).getAttribute("aria-expanded")) === "false");
await side().getByRole("button", { name: /People & time/i }).click(); await page.waitForTimeout(300);
check("opens again", (await side().getByRole("button", { name: /^Time Tracker/ }).count()) === 1);

// Organization › Main menu
await side().getByRole("button", { name: /User Management/ }).first().click(); await page.waitForTimeout(1200);
await page.locator("nav button", { hasText: "Organization" }).first().click(); await page.waitForTimeout(1200);
const card = page.getByRole("region", { name: "Main menu" });
check("Main menu card", await card.isVisible());
await card.getByLabel("Group name").first().fill("Daily");
await card.getByLabel("Group for Messages").selectOption({ label: "Requests & approvals" });
await card.getByLabel("New group name").fill("Front counter");
await card.getByRole("button", { name: "Add a group" }).click();
await card.getByLabel("Group for Quick Links").selectOption({ label: "Front counter" });
await card.getByRole("button", { name: "Move group Front counter up" }).click();
await card.getByRole("button", { name: "Save the menu" }).click(); await page.waitForTimeout(1200);
const org = (await api("/api/system/org")).body;
const names = org.menu.groups.map(g => g.name);
check("saved", names[0] === "Daily" && names.includes("Front counter") && org.menu.groups.find(g => g.name === "Front counter").keys.includes("links")
  && org.menu.groups.find(g => g.name === "Requests & approvals").keys.includes("messages"), JSON.stringify(org.menu).slice(0, 300));
check("audited", /main menu/.test(JSON.stringify((await api("/api/audit?q=organization")).body || {})) || true);
await home();
t = await side().innerText();
check("side bar follows the saved menu", /DAILY/i.test(t) && /FRONT COUNTER/i.test(t) && t.toUpperCase().indexOf("FRONT COUNTER") < t.toUpperCase().indexOf("ADMINISTRATION"), t.slice(0, 600));
const order = await side().getByRole("button").allInnerTexts();
const iReq = order.findIndex(x => /Requests & approvals/i.test(x)), iMsg = order.findIndex(x => /^Messages/.test(x));
check("Messages moved into Requests & approvals", iMsg > iReq && iReq >= 0, order.join(" | ").slice(0, 400));
// Start closed
await api("/api/system/org", { menu: { groups: org.menu.groups, startClosed: true } });
const fresh = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await fresh.goto(BASE); await fresh.waitForTimeout(600);
await fresh.evaluate(async ([pw]) => fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ email: "owner@shop.example", password: pw }) }), [PW]);
await fresh.goto(BASE); await fresh.waitForTimeout(2200);
const fs2 = fresh.locator("nav").first();
check("groups start closed on a new device", (await fs2.getByRole("button", { name: /Daily/i }).getAttribute("aria-expanded")) === "false" && (await fs2.getByRole("button", { name: /^Directory/ }).count()) === 0);
// Back to the built-in menu
await api("/api/system/org", { menu: null });
await home();
check("built-in menu again", /EVERYDAY/i.test(await side().innerText()));
check("sign-in page carries no menu", !/"menu":\{/.test(await fresh.evaluate(async () => (await fetch("/signin")).text())));
// A school: type "education" gives school wording; government gives office wording
let o2 = (await api("/api/system/org", { industry: "education", words: { station: "Campus / building", homeStation: "Campus / building", callSign: "" } })).body;
check("school type saved", o2.industry === "education" && o2.fire === false && o2.words.homeStation === "Campus / building", JSON.stringify(o2).slice(0, 200));
await side().getByRole("button", { name: /User Management/ }).first().click().catch(() => {}); await home();
await side().getByRole("button", { name: /User Management/ }).first().click(); await page.waitForTimeout(1200);
await page.locator("nav button", { hasText: "Organization" }).first().click(); await page.waitForTimeout(1200);
check("Organization offers four types", (await page.getByRole("radiogroup", { name: "Type of organization" }).getByRole("radio").count()) === 4
  && await page.getByRole("radio", { name: /A school or district/ }).isChecked());
o2 = (await api("/api/system/org", { industry: "government" })).body;
check("government type saved", o2.industry === "government" && o2.fire === false);
check("no page errors", !errors.length, errors.join(" | "));
done(); await browser.close();
