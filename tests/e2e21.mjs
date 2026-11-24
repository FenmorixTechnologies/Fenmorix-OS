// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(350); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) body = await res.json(); else { const b = new Uint8Array(await res.arrayBuffer()); body = { size: b.length }; }
    return { status: res.status, body, ct };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const L = label => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await L("Email").fill(email); await L("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
const body = async () => page.locator("body").innerText();
import { execSync } from "node:child_process";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: "Fred Floor", email: "fred@sgfd.org", division: "Technology", password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Technology" });
const fred = psql("SELECT id FROM users WHERE full_name = 'Fred Floor'");
await post("/api/messages", { users: [fred], subject: "Turnout gear fitting", body: "Thursday 0900 at HQ.", important: true });

await login("fred@sgfd.org");
await page.setViewportSize({ width: 1400, height: 1000 });
const visualOrder = () => page.evaluate(() => [...document.querySelectorAll("[data-widget]")].sort((a, b) => getComputedStyle(a).order - getComputedStyle(b).order).map(e => e.dataset.widget));
await page.locator("[data-widget=messages]").waitFor({ timeout: 8000 });
await page.locator("[data-widget=messages]").getByText("Turnout gear fitting").waitFor({ timeout: 8000 }).catch(() => {});
const mw = await page.locator("[data-widget=messages]").innerText();
check("Messages widget lists the message", /Mike Admin/.test(mw) && /Turnout gear fitting/.test(mw), mw.replace(/\n/g, " | "));
check("default order puts Messages second", (await visualOrder()).slice(0, 2).join() === "time,messages", (await visualOrder()).join());

// Show less
await page.getByRole("button", { name: "Show less of Time this pay period" }).click(); await page.waitForTimeout(700);
check("collapsed hides the body", !(await page.locator("[data-widget=time]").innerText()).includes("Left to 80"));
check("saved to the profile", JSON.stringify((await api("/api/prefs")).body.prefs.yourDay.collapsed) === '["time"]');
await page.reload(); await settle(); await page.locator("[data-widget=time]").waitFor(); await page.waitForTimeout(400);
check("still collapsed after reload", !(await page.locator("[data-widget=time]").innerText()).includes("Left to 80"));
await page.getByRole("button", { name: "Show more of Time this pay period" }).click(); await page.waitForTimeout(300);
check("show more brings it back", (await page.locator("[data-widget=time]").innerText()).includes("Left to 80"));

// Customize: arrows and drag
await page.getByRole("button", { name: "Customize" }).click();
check("customize mode explains itself", /Drag widgets into the order you like/.test(await body()));
await page.getByRole("button", { name: "Move Meetings today earlier" }).click(); await page.waitForTimeout(200);
let ord = await visualOrder();
check("arrow moves it earlier", ord.indexOf("meetings") < ord.indexOf("oncall"), ord.join());
check("first widget can't move earlier", await page.getByRole("button", { name: "Move Time this pay period earlier" }).isDisabled());
await page.locator("[data-widget=reqs]").dragTo(page.locator("[data-widget=time]"));
await page.waitForTimeout(700);
ord = await visualOrder();
check("drag and drop moves it", ord[0] === "reqs", ord.join());
await page.screenshot({ path: "/home/claude/testrun/shot-customize.png" });
await page.getByRole("button", { name: "Done" }).first().click();

// Another device: same layout
const other = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
await other.goto(BASE); await other.waitForLoadState("networkidle");
await other.getByLabel("Email").fill("fred@sgfd.org"); await other.getByLabel("Password").fill(PW);
await other.getByRole("button", { name: "Sign in" }).click(); await other.locator("[data-widget=reqs]").waitFor(); await other.waitForTimeout(800);
const ord2 = await other.evaluate(() => [...document.querySelectorAll("[data-widget]")].sort((a, b) => getComputedStyle(a).order - getComputedStyle(b).order).map(e => e.dataset.widget));
check("layout follows Fred to another device", ord2.join() === ord.join(), ord2.join());

// Opening a message from the widget
await page.locator("[data-widget=messages]").getByRole("button", { name: /Turnout gear fitting/ }).click(); await settle();
check("clicking it opens the conversation", await page.getByRole("article", { name: "Turnout gear fitting" }).isVisible());
await home();
await page.getByRole("button", { name: "Customize" }).click();
await page.getByRole("button", { name: /Reset layout/ }).click(); await page.waitForTimeout(700);
check("reset layout", (await visualOrder()).slice(0, 2).join() === "time,messages");
check("bad prefs key refused", (await post("/api/prefs", { key: "role", value: "master" })).status === 400);
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
