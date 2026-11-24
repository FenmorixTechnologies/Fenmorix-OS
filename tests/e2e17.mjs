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

await login("fred@sgfd.org");
const fredId = psql("SELECT id FROM users WHERE email = 'fred@sgfd.org'");
// ---- Punch in from Your Day
const clock = page.getByRole("group", { name: "Punch clock" });
await clock.waitFor({ timeout: 8000 });
check("Your Day has a Punch in button", await clock.getByRole("button", { name: "Punch in" }).isVisible());
await clock.getByRole("button", { name: "Punch in" }).click(); await settle();
check("shows on the clock", /On the clock/.test(await clock.innerText()) && /Punched in at \d\d:\d\d/.test(await clock.innerText()), await clock.innerText());
check("open punch saved", psql(`SELECT count(*) FROM time_entries WHERE user_id = '${fredId}' AND end_time IS NULL AND start_time IS NOT NULL`) === "1");
const again = await post("/api/time/clock", { action: "in" });
check("can't punch in twice", again.status === 409 && /already punched in/.test(again.body.error), JSON.stringify(again.body));
const tooSoon = await post("/api/time/clock", { action: "out" });
check("punch out within a minute is refused", tooSoon.status === 409 && /less than a minute/.test(tooSoon.body.error));

// Pretend it was 2.5 hours ago, then punch out from the Time Tracker
psql(`UPDATE time_entries SET work_date = (localtimestamp - interval '150 minutes')::date, start_time = date_trunc('minute', localtimestamp - interval '150 minutes')::time WHERE user_id = '${fredId}' AND end_time IS NULL`);
await page.getByRole("navigation").getByRole("button", { name: "Time Tracker" }).first().click(); await settle();
const tclock = page.getByRole("group", { name: "Punch clock" });
check("Time Tracker shows the open punch", /On the clock/.test(await tclock.innerText()) && /2 h 30 min|2 h 29 min/.test(await tclock.innerText()), await tclock.innerText());
check("calendar shows on the clock", /on the clock/i.test(await body()));
await tclock.getByRole("button", { name: "Punch out" }).click(); await settle();
check("punch out message with hours", /Punched out at .* 2\.5 h/.test(await tclock.innerText()), await tclock.innerText());
const hrsDb = psql(`SELECT hours FROM time_entries WHERE user_id = '${fredId}' ORDER BY updated_at DESC LIMIT 1`);
check("hours recorded", hrsDb === "2.50", hrsDb);
await page.waitForTimeout(500);
check("totals updated without reload", /2\.5/.test(await body()));

// Forgot to punch out over a day ago
psql(`INSERT INTO time_entries (id, user_id, work_date, start_time, end_time, hours, kind) VALUES (gen_random_uuid(), '${fredId}', current_date - 2, '07:00', NULL, 0, 'regular')`);
const stale = await post("/api/time/clock", { action: "out" });
check("stale punch-in explains how to fix", stale.status === 409 && /more than 24 hours old/.test(stale.body.error), JSON.stringify(stale.body));
psql(`DELETE FROM time_entries WHERE user_id = '${fredId}' AND end_time IS NULL`);

// ---- Work pattern
check("bad pattern refused", (await post("/api/time/pattern", { pattern: "fire:Z" })).status === 400);
await page.reload(); await settle();
await page.getByRole("navigation").getByRole("button", { name: "Time Tracker" }).first().click(); await settle();
check("asks to pick a schedule", /Pick your schedule/.test(await body()) && /Needed per day/i.test(await body()));
await page.getByLabel("My schedule").selectOption("weekdays"); await settle();
check("weekday schedule: needed per workday", /Needed per workday/i.test(await body()) && /workdays? left|No workdays left/i.test(await body()), (await body()).match(/Needed per[^\n]*\n[^\n]*\n[^\n]*/)?.[0]);
check("pattern saved", psql(`SELECT work_pattern FROM users WHERE id = '${fredId}'`) === "weekdays");
await page.getByLabel("My schedule").selectOption("comms:C"); await settle();
check("comms crew: needed per shift", /Needed per shift/i.test(await body()));
check("roster carries the pattern", (await read("roster")).find(u => u.id === fredId).workPattern === "comms:C");
await page.screenshot({ path: "/home/claude/testrun/shot-timeclock.png" });
await home();
check("Your Day uses the schedule", /Needed per shift/i.test(await body()));

// Others can't punch for Fred, and Fred can still edit/delete his entries via the collection
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
