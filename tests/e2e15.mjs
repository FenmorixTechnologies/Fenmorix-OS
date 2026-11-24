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
const roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;

// ---- Security headers on the app page
const head = await page.evaluate(async () => { const r = await fetch("/"); return { csp: r.headers.get("content-security-policy") || "", frame: r.headers.get("x-frame-options"), pp: r.headers.get("permissions-policy") || "" }; });
check("page has a content security policy", /default-src 'self'/.test(head.csp) && /frame-ancestors 'none'/.test(head.csp) && /script-src 'self'/.test(head.csp), head.csp);
check("page can't be framed; camera/mic off", head.frame === "DENY" && /camera=\(\)/.test(head.pp));

// ---- Sound toggle, tab title, and a ding when something new arrives
await page.goto(BASE); await settle();
await page.mouse.click(5, 5);   // a click lets the browser play sound
check("sound toggle shown (on by default)", await page.getByRole("button", { name: /Sound on/ }).count() === 1);
const t0 = await page.title();
await page.evaluate(() => { window.__dings = 0; window.addEventListener("sgfd-chime", () => window.__dings++); });
// Fred files a ticket and it gets assigned to Mike
const ticket = { id: crypto.randomUUID(), subject: "Printer jam", category: "Hardware", priority: "High", division: "Technology", location: "", description: "jam",
  requesterId: id("Fred Floor"), requesterName: "Fred Floor", assigneeId: id("Mike Admin"), status: "open", dueDate: "", comments: [], attachments: [], createdAt: new Date().toISOString() };
const w = await post("/api/collections/tickets", { upserts: [ticket], deletes: [] });
check("ticket saved", w.status === 200, JSON.stringify(w.body).slice(0, 200));
await page.waitForFunction(() => window.__dings > 0, null, { timeout: 75000 }).catch(() => {});
check("new item dings within a minute (no reload)", await page.evaluate(() => window.__dings) === 1);
check("page shows it without reload", /help desk ticket is assigned to you/.test(await body()));
check("tab title shows the count", /^\(\d+\) SGFD Nexus$/.test(await page.title()), `${t0} -> ${await page.title()}`);
await page.getByRole("button", { name: /Sound on/ }).click();
check("sound can be turned off and is remembered", await page.getByRole("button", { name: /Sound off/ }).count() === 1 && await page.evaluate(() => localStorage.getItem("sgfd-sound")) === "off");

// ---- Background refreshes don't keep a session alive
const lastSeenBefore = psql(`SELECT max(last_seen_at) FROM sessions`);
check("sessions record last activity", !!lastSeenBefore);

// ---- Signed-in devices
const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
await p2.goto(BASE); await p2.waitForLoadState("networkidle");
await p2.getByLabel("Email").fill("fred@sgfd.org"); await p2.getByLabel("Password").fill(PW);
await p2.getByRole("button", { name: "Sign in" }).click(); await p2.getByRole("button", { name: "Home", exact: true }).waitFor();
await page.getByRole("button", { name: /Signed-in devices/ }).click(); await settle();
check("master sees everyone's devices", /Signed-in devices \(everyone\)/.test(await body()) && /Fred Floor/.test(await body()) && /this device/.test(await body()), (await page.getByRole("dialog").innerText().catch(() => "no dialog")).replace(/\n/g, " | "));
const fredRow = page.getByRole("dialog").locator("div", { hasText: /^Fred Floor/ }).last();
await page.getByRole("dialog").getByRole("button", { name: "Sign out", exact: true }).first().click(); await settle();
const fredMe = await p2.evaluate(() => fetch("/api/auth/me").then(r => r.json()));
check("master signs Fred's device out", fredMe.user === null);
await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

// Fred can only see/end his own
await p2.goto(BASE); await p2.waitForLoadState("networkidle");
await p2.getByLabel("Email").fill("fred@sgfd.org"); await p2.getByLabel("Password").fill(PW);
await p2.getByRole("button", { name: "Sign in" }).click(); await p2.getByRole("button", { name: "Home", exact: true }).waitFor();
const fredSessions = await p2.evaluate(() => fetch("/api/auth/sessions").then(r => r.json()));
check("a user sees only their own devices", fredSessions.sessions.every(s => s.name === "Fred Floor") && fredSessions.idleMinutes === 60);
const mikeSession = (await api("/api/auth/sessions")).body.sessions.find(s => s.name === "Mike Admin");
const tryEnd = await p2.evaluate(id => fetch("/api/auth/end-session", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ id }) }).then(r => r.status), mikeSession.id);
check("a user can't sign out someone else", tryEnd === 403);

// ---- Idle sign-out: pretend Fred hasn't done anything for 2 hours
psql(`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = '${id("Fred Floor")}'`);
const idleMe = await p2.evaluate(() => fetch("/api/auth/me").then(r => r.json()));
check("idle session is signed out", idleMe.user === null);
check("idle session removed from the database", psql(`SELECT count(*) FROM sessions WHERE user_id = '${id("Fred Floor")}'`) === "0");
// a background request doesn't refresh activity
await p2.goto(BASE); await p2.waitForLoadState("networkidle");
await p2.getByLabel("Email").fill("fred@sgfd.org"); await p2.getByLabel("Password").fill(PW);
await p2.getByRole("button", { name: "Sign in" }).click(); await p2.getByRole("button", { name: "Home", exact: true }).waitFor();
await p2.waitForLoadState("networkidle"); await p2.waitForTimeout(800);   // let the page's own first-load requests finish
psql(`UPDATE sessions SET last_seen_at = now() - interval '10 minutes' WHERE user_id = '${id("Fred Floor")}'`);
await p2.evaluate(() => fetch("/api/forms/inbox", { headers: { "X-SGFD": "1", "X-SGFD-Background": "1" } }));
check("background refresh doesn't count as activity", Number(psql(`SELECT extract(epoch from now() - last_seen_at)::int FROM sessions WHERE user_id = '${id("Fred Floor")}'`)) >= 590);
await p2.evaluate(() => fetch("/api/forms/inbox", { headers: { "X-SGFD": "1" } }));
check("normal use counts as activity", Number(psql(`SELECT extract(epoch from now() - last_seen_at)::int FROM sessions WHERE user_id = '${id("Fred Floor")}'`)) < 30);

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
