// Time Tracker, Call-Out Schedule, User Management + permissions
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
fs.copyFileSync("/home/claude/sgfd-app/src/shifts.js", "/home/claude/testrun/shifts.mjs");
const S = await import("/home/claude/testrun/shifts.mjs");

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 950 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const write = (key, payload) => post(`/api/collections/${key}`, payload);
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const period = S.payPeriod(today);
const dayLabel = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// ---- Accounts
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [
  ["Fred Floor", "fred@sgfd.org", "Suppression", "user"],
  ["Sara Supervisor", "sara@sgfd.org", "Suppression", "user"],
  ["Carl Comms", "carl@sgfd.org", "Communications", "user"],
  ["Ivy IT", "ivy@sgfd.org", "Technology", "user"],
];
for (const [n, e, d] of people) {
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: e, division: d, password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const [, , d, role] = people.find(p => p[0] === a.name);
  await post("/api/auth/approve", { id: a.id, role, division: d });
}
let roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;

// ---- Main menu tiles
check("main menu has Time Tracker and Call-Out Schedule", await page.getByText("Time Tracker", { exact: true }).count() === 1 && await page.getByText("Call-Out Schedule", { exact: true }).count() === 1);
check("master sees User Management tile", await page.getByText("User Management", { exact: true }).count() === 1);

// ---- User Management: give Sara "view time punches" for Suppression
await tile("User Management");
check("user management shows account approvals", await page.getByText("Waiting for approval").count() === 1);
await page.getByRole("button", { name: "People & roles", exact: true }).click(); await settle();
await page.getByLabel("Edit Sara Supervisor").click(); await settle();
const saraPerm = page.locator("fieldset", { hasText: "View time punches" });
await saraPerm.getByLabel("Only these divisions").check();
await saraPerm.locator("label", { hasText: /^Suppression$/ }).click();
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
roster = await read("roster");
check("Sara can view Suppression time punches", JSON.stringify(roster.find(u => u.name === "Sara Supervisor").permissions.timeView) === '["Suppression"]',
  JSON.stringify(roster.find(u => u.name === "Sara Supervisor").permissions));
check("summary line shows the permission", await page.getByText("views time: Suppression").count() === 1);
await page.getByLabel("Filter by Permission").selectOption("timeView"); await settle();
const filt = await page.getByText(/^Showing \d|^No people/).allInnerTexts();
check("filter people by permission", filt.some(t => /of 1 people/.test(t)), filt.join(" | "));
let log = await read("audit-log");
check("permission change is audited", log.some(e => e.action === "Changed permissions" && /Sara Supervisor/.test(e.detail)));

// ---- Carl enters a punch (to test privacy later)
await login("carl@sgfd.org");
check("non-master has no User Management tile", await page.getByText("User Management", { exact: true }).count() === 0);
const carlEntry = { id: crypto.randomUUID(), date: period.start, start: "05:30", end: "17:30", kind: "regular", note: "" };
check("Carl saves a punch", (await write("time-entries", { upserts: [carlEntry], deletes: [] })).status === 200);

// ---- Fred uses the Time Tracker
await login("fred@sgfd.org");
await tile("Time Tracker");
const hdr = `${S.pretty(period.start)} – ${S.pretty(period.end, { month: "short", day: "numeric", year: "numeric" })}`;
check("shows the current pay period (Thu–Wed) and pay day", await page.getByText(hdr).count() === 1 &&
  await page.getByText(`pay day ${S.pretty(period.payday, { weekday: "short", month: "short", day: "numeric" })}`).count() === 1, hdr);
check("calendar starts on Thursday", (await page.locator("div", { hasText: /^Thu$/ }).count()) >= 1);
// 24-hour shift on the first day
await page.getByRole("button", { name: new RegExp(`^${dayLabel(period.start)},`) }).click(); await settle();
await page.getByRole("button", { name: "+ Add punch" }).click();
await page.getByLabel("Time in").fill("0700"); await page.getByLabel("Time out").fill("0700");
check("0700–0700 previews 24 h and 'ends the next day'", await page.getByText("24 h", { exact: true }).count() >= 1 && await page.getByText("Ends the next day.").count() === 1);
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
// Two punches on day 3 (left for an appointment and came back)
const d3 = S.addDays(period.start, 2);
await page.getByRole("button", { name: new RegExp(`^${dayLabel(d3)},`) }).click(); await settle();
for (const [i, o] of [["08:00", "11:30"], ["1300", "1730"]]) {
  await page.getByRole("button", { name: "+ Add punch" }).click();
  await page.getByLabel("Time in").fill(i); await page.getByLabel("Time out").fill(o);
  await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
}
check("two punches on one day, day total 8", await page.getByText("Day total: 8 h").count() === 1);
// Vacation as hours only
const d5 = S.addDays(period.start, 4);
await page.getByRole("button", { name: new RegExp(`^${dayLabel(d5)},`) }).click(); await settle();
await page.getByRole("button", { name: "+ Add punch" }).click();
await page.getByLabel("Enter hours instead of in/out (leave)").check();
await page.getByLabel("Hours", { exact: true }).fill("8");
await page.getByLabel("Hour type").selectOption("vacation");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
let entries = await read("time-entries");
check("Fred only gets his own punches", entries.length === 4 && entries.every(e => e.userName === "Fred Floor"), String(entries.length));
check("hours computed (24 + 3.5 + 4.5 + 8)", JSON.stringify(entries.map(e => e.hours).sort((a, b) => a - b)) === "[3.5,4.5,8,24]");
const statText = await page.locator("body").innerText();
check("total 40 and 40 remaining", /HOURS THIS PERIOD\s*40/i.test(statText) && /REMAINING TO 80\s*40/i.test(statText));
const tracked = (await read("time-entries")).filter(e => e.date === today && e.hours > 0).length > 0;
const need = S.neededPerShift({ pattern: "", period, today, remaining: 40, workedToday: tracked });
const perDay = need.perShift === null ? "—" : (Math.round(need.perShift * 100) / 100).toFixed(2).replace(/\.00$/, "");
check("needed per day (no schedule set)", new RegExp(`NEEDED PER DAY\\s*${perDay.replace(".", "\\.")}`, "i").test(statText) && (need.left === 0 || statText.includes(`${need.left} day`)), `${perDay} over ${need.left} days`);
check("breakdown shows vacation 8", /Vacation:\s*8/.test(statText));
check("day shows Fire and Comms shifts", await page.getByText(`Fire ${S.fireShift(period.start)}`).count() >= 1);
// Edit and validation
const bad = await write("time-entries", { upserts: [{ ...entries[0], start: "25:00", end: "07:00" }], deletes: [] });
check("server rejects a bad time", bad.status === 400, String(bad.status));
const steal = await write("time-entries", { upserts: [{ ...carlEntry, note: "hacked" }], deletes: [] });
check("can't change someone else's punch", steal.status === 403, String(steal.status));
await page.getByRole("button", { name: "Next pay period" }).click(); await settle();
check("next period starts 14 days later", await page.getByText(S.pretty(S.addDays(period.start, 14))).count() >= 1);
await page.getByRole("button", { name: "Current period" }).click(); await settle();

// ---- Sara (supervisor for Suppression)
await login("sara@sgfd.org");
entries = await read("time-entries");
check("Sara sees Suppression punches, not Communications", entries.some(e => e.userName === "Fred Floor") && !entries.some(e => e.userName === "Carl Comms"));
await tile("Time Tracker");
const opts = await page.getByLabel("Whose time").locator("option").allInnerTexts();
check("Sara can pick Fred, not Carl", opts.some(o => o.startsWith("Fred Floor")) && !opts.some(o => o.startsWith("Carl")), opts.join(" | "));
await page.getByLabel("Whose time").selectOption({ label: "Fred Floor — Suppression" }); await settle();
check("viewing Fred is read-only", await page.getByText("time (read-only)").count() === 1 && await page.getByRole("button", { name: "+ Add punch" }).count() === 0);
check("Sara sees Fred's 40 hours", /HOURS THIS PERIOD\s*40/i.test(await page.locator("body").innerText()));
const saraEdit = await write("time-entries", { upserts: [{ ...entries.find(e => e.userName === "Fred Floor"), note: "x" }], deletes: [] });
check("supervisor can't change Fred's punches", saraEdit.status === 403);

// ---- Mike sees everyone's
await login("mike@sgfd.org");
entries = await read("time-entries");
check("master sees all punches", entries.some(e => e.userName === "Carl Comms") && entries.some(e => e.userName === "Fred Floor"));

// ---- Call-Out Schedule
await login("ivy@sgfd.org");
await tile("Call-Out Schedule");
check("today panel shows shifts on duty", await page.getByText(`${S.fireShift(today)} shift`).count() >= 1);
await page.getByRole("button", { name: "+ Add on-call person" }).click();
check("Ivy can only pick Technology", JSON.stringify(await page.getByLabel("Call-out division").locator("option").allInnerTexts()) === '["Technology"]');
await page.getByLabel("On call through").fill(S.addDays(today, 6));
await page.getByLabel("On-call person").selectOption({ label: "Ivy IT — Technology" });
await page.getByLabel("Contact number").fill("314-555-0101");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
check("Ivy on call today for Technology", await page.locator("a[href='tel:3145550101']").count() >= 1);
let co = await read("callouts");
check("saved a week-long on-call entry", co.length === 1 && co[0].endDate === S.addDays(today, 6) && co[0].division === "Technology");
const carlTry = { id: crypto.randomUUID(), division: "Technology", startDate: today, endDate: today, position: 1, userId: null, personName: "Someone", phone: "", notes: "" };

await login("fred@sgfd.org");
for (const [who, pos] of [["Fred Floor", 1], ["Sara Supervisor", 2]]) {
  await write("callouts", { upserts: [{ id: crypto.randomUUID(), division: "Suppression", startDate: today, endDate: today, position: pos, userId: id(who), personName: who, phone: "", notes: "" }], deletes: [] });
}
await tile("Call-Out Schedule");
check("floor call-back order shown", await page.getByText("Suppression · call-back order").count() === 1);
const techEdit = await write("callouts", { upserts: [{ ...co[0], phone: "000" }], deletes: [] });
check("Fred can't change Technology's schedule", techEdit.status === 403, String(techEdit.status));

await login("carl@sgfd.org");
check("Carl can't add to Technology", (await write("callouts", { upserts: [carlTry], deletes: [] })).status === 403);
await login("mike@sgfd.org");
roster = await read("roster");
const carl = roster.find(u => u.name === "Carl Comms");
await write("roster", { upserts: [{ ...carl, permissions: { timeView: [], calloutEdit: ["Technology"] } }], deletes: [] });
await login("carl@sgfd.org");
check("after permission, Carl can add to Technology", (await write("callouts", { upserts: [carlTry], deletes: [] })).status === 200);
await tile("Call-Out Schedule");
const divs = await page.getByRole("button", { name: "+ Add on-call person" }).count();
check("Carl's form offers Communications and Technology", divs === 1 && await (async () => {
  await page.getByRole("button", { name: "+ Add on-call person" }).click();
  return JSON.stringify(await page.getByLabel("Call-out division").locator("option").allInnerTexts()) === '["Communications","Technology"]';
})());
await page.screenshot({ path: "/home/claude/testrun/shot-callout.png" });
await login("mike@sgfd.org");
log = await read("audit-log");
check("call-out changes are audited", log.some(e => e.action === "Added to call-out schedule" && /Technology: Ivy IT/.test(e.detail)));

await login("fred@sgfd.org");
await tile("Time Tracker");
await page.screenshot({ path: "/home/claude/testrun/shot-time.png" });

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
