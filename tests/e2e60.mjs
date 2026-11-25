// A business on Fenmorix OS (the shop license): Organization settings (wording, pay periods, schedules offered), divisions,
// sick leave types, permissions/profiles for a business, display screens without fire views, the Work Schedule (week grid,
// fill the week, copy last week, leaving early, Your Day card), Quick Links copy-and-open. Fictional people only.
// Run with run-biz.sh (PRODUCT=fenmorix, SYSTEM_DIR=sysroot-biz, LICENSE = keys/shop.lic).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", PW = "Correct horse battery", T = "/home/claude/testrun";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = iso(new Date());
const addDays = (s, n) => { const x = new Date(`${s}T12:00:00`); x.setDate(x.getDate() + n); return iso(x); };
const monday = s => { const w = new Date(`${s}T12:00:00`).getDay(); return addDays(s, -((w + 6) % 7)); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const apiOn = p => (path, body) => p.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const api = apiOn(page);
const meta = () => page.evaluate(() => JSON.parse(document.querySelector('meta[name="nexus-brand"]').content));
const nav = async (...names) => { for (const n of names) { await page.locator("nav button", { hasText: n }).first().click(); await page.waitForTimeout(900); } };
const home = async () => { await page.goto(BASE); await page.waitForTimeout(2200); };

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Laura Owner", email: "owner@shop.example", password: PW });
await home();
// Two employees (signed up, approved)
const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE); await p2.waitForTimeout(800);
for (const [f, l] of [["Pat", "Clerk"], ["Sam", "Counter"]]) await apiOn(p2)("/api/auth/signup", { firstName: f, lastName: l, email: `${f.toLowerCase()}@shop.example`, division: "Administration", password: PW });
const pat = psql("SELECT id FROM users WHERE email = 'pat@shop.example'"), sam = psql("SELECT id FROM users WHERE email = 'sam@shop.example'");
for (const id of [pat, sam]) await api("/api/auth/approve", { id, role: "user", division: "Training" });

// ---- Organization: a business by default; wording; pay periods ----
let body; let o = (await api("/api/system/org")).body;
check("a Fenmorix OS install that isn't a fire department starts as a business", o.industry === "business" && o.words.station === "Location" && o.words.callSign === ""
  && !o.work.rotations.fire && !o.work.rotations.comms, JSON.stringify(o).slice(0, 200));
let m = await meta();
check("pages get the wording and work settings", m.fire === false && m.words.homeStation === "Location" && m.work?.dayHours === 8);
await nav("User Management", "Organization");
check("Organization page in User Management", await page.getByRole("region", { name: "Organization" }).count() === 1 && await page.getByRole("region", { name: "Divisions" }).count() === 1);
await page.getByLabel("Work location label").fill("Store");
await page.getByLabel("Pay period", { exact: true }).selectOption("semimonthly");
await page.getByLabel("Days until payday").fill("5");
await page.getByRole("region", { name: "Organization" }).getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(900);
o = (await api("/api/system/org")).body;
check("saved: wording and twice-a-month pay", o.words.station === "Store" && o.work.pay.kind === "semimonthly" && o.work.pay.payDays === 5, JSON.stringify(o.work));
check("kept outside the app folder", JSON.parse(fs.readFileSync(`${T}/sysroot-biz/settings/org.json`, "utf8")).work.pay.kind === "semimonthly");
check("a bad pay setting is refused", (await api("/api/system/org", { work: { pay: { kind: "weekly", start: "" } } })).status === 400);

// ---- Divisions ----
let r = await api("/api/system/divisions", { action: "add", name: "Sales" });
check("add a division", r.status === 200 && r.body.divisions.some(d => d.name === "Sales"));
r = await api("/api/system/divisions", { action: "rename", name: "Sales", to: "Front Counter" });
check("rename a division", r.body.divisions.some(d => d.name === "Front Counter") && !r.body.divisions.some(d => d.name === "Sales"));
check("a name that's taken is refused", (await api("/api/system/divisions", { action: "add", name: "front counter" })).status === 409);
check("a division still on old records can't be removed", /Rename it instead/.test((await api("/api/system/divisions", { action: "remove", name: "Administration", moveTo: "Technology" })).body.error || ""));
r = await api("/api/system/divisions", { action: "remove", name: "Training" });
check("removing a division with people needs a place to move them", r.status === 409 && /Pick a division/.test(r.body.error), JSON.stringify(r.body));
r = await api("/api/system/divisions", { action: "remove", name: "Training", moveTo: "Front Counter" });
check("remove and move its people", r.status === 200 && !r.body.divisions.some(d => d.name === "Training")
  && psql(`SELECT d.name FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.id = '${pat}'`) === "Front Counter", JSON.stringify(r.body).slice(0, 200));
check("division changes are audited", Number(psql("SELECT count(*) FROM audit_log WHERE action IN ('Added a division', 'Renamed a division', 'Removed a division')")) === 3);

// ---- Job roles (no Procurement here, so no purchasing roles) ----
o = (await api("/api/system/org")).body;
check("business starts with Owner / Manager / Employee roles", ["Owner", "Manager", "Employee"].every(n => o.roles.some(r => r.name === n)) && o.roles.find(r => r.name === "Manager").profile === "division" && o.profiles.length >= 4, JSON.stringify(o.roles));
await nav("Organization");
await page.getByLabel("New job role").fill("Sales associate");
await page.getByRole("region", { name: "Job roles" }).getByRole("button", { name: "Add role" }).click(); await page.waitForTimeout(900);
check("add a role on the Organization page", (await api("/api/system/org")).body.roles.some(r => r.name === "Sales associate" && r.profile === ""));
r = await api("/api/auth/job-role", { id: sam, role: "Manager" });
check("give someone a role: job title + the role's profile", r.status === 200 && psql(`SELECT job_title FROM users WHERE id = '${sam}'`) === "Manager"
  && psql(`SELECT string_agg(profile_key, ',') FROM access_profile_members WHERE user_id = '${sam}'`) === "division", JSON.stringify(r.body));
r = await api("/api/system/roles", { action: "profile", name: "Manager", profile: "chief" });
check("changing a role's access changes it for its people", r.status === 200 && psql(`SELECT string_agg(profile_key, ',') FROM access_profile_members WHERE user_id = '${sam}'`) === "chief");
r = await api("/api/system/roles", { action: "rename", name: "Manager", to: "Store manager" });
check("renaming a role renames its people's title", r.status === 200 && psql(`SELECT job_title FROM users WHERE id = '${sam}'`) === "Store manager");
check("an unknown role is refused", (await api("/api/auth/job-role", { id: sam, role: "Astronaut" })).status === 400);
await api("/api/auth/job-role", { id: sam, role: "Employee" });
check("moving to a role without access takes the old profile off", psql(`SELECT count(*) FROM access_profile_members WHERE user_id = '${sam}'`) === "0" && psql(`SELECT job_title FROM users WHERE id = '${sam}'`) === "Employee");
await nav("People & roles");
body = await page.locator("main").innerText();
check("People & roles: no purchasing roles or fire recordings without those modules", !/Requester|Purchaser|Fire chief|Accounting/.test(body), body.slice(0, 300));
await page.getByRole("button", { name: "Edit Pat Clerk" }).click(); await page.waitForTimeout(300);
body = await page.locator("main").innerText();
check("person editor: job role + access, nothing fire-only", await page.getByLabel("Job role of Pat Clerk").count() === 1 && /Regular user|Master admin/.test(body) && !/Fire Recordings|call-out/i.test(body));
await page.getByLabel("Job role of Pat Clerk").selectOption("Sales associate");
await page.getByRole("button", { name: "Save", exact: true }).click(); await page.waitForTimeout(1200);
check("pick a role in People & roles", psql(`SELECT job_title FROM users WHERE id = '${pat}'`) === "Sales associate");
check("role changes are audited", Number(psql("SELECT count(*) FROM audit_log WHERE action IN ('Set a job role', 'Added a job role', 'Renamed a job role', 'Changed a job role''s access')")) >= 5);
await home();

// ---- Wording in Personnel File and Directory; Time Tracker follows the pay settings ----
await home();
await nav("Personnel File"); await page.waitForTimeout(800);
body = await page.locator("main").innerText();
check("Personnel File says Store, not station", /Store/.test(body) && !/Station \/ assignment/.test(body), body.slice(0, 300));
await home(); await nav("Directory");
const dnav = await page.locator("nav").first().innerText();
check("Directory: My card, Everyone, Outside contacts only", /My card/.test(dnav) && /Everyone/.test(dnav) && /Outside contacts/.test(dnav) && !/Fire stations|Aladtec|Directory check/.test(dnav), dnav.replace(/\n/g, " | "));
await nav("My card"); await page.getByRole("button", { name: /Edit/ }).first().click().catch(() => {}); await page.waitForTimeout(800);
body = await page.locator("body").innerText();
check("card editor: Location, no call sign", /Location/.test(body) && !/call sign/i.test(body) && !/Home station/.test(body), body.slice(0, 400));
await home(); await nav("Time Tracker");
body = await page.locator("main").innerText();
check("Time Tracker: twice-a-month pay period, no fire or Comms shifts", /1st–15th and 16th–end/.test(body) && /paid 5 days after/.test(body) && !/Fire on duty|Comms [A-D]/.test(body), body.slice(0, 400));
{ // column names follow the period's real days (it was fixed Thu..Wed from SGFD's period)
  const heads = await page.evaluate(() => [...document.querySelectorAll("main div")].filter(d => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(d.textContent.trim()) && d.children.length === 0).slice(0, 7).map(d => d.textContent.trim()));
  const n = new Date(); const first = n.getDate() <= 15 ? 1 : 16;
  const want = new Date(n.getFullYear(), n.getMonth(), first, 12).toLocaleDateString("en-US", { weekday: "short" });
  check("Time Tracker: calendar columns start on the period's first weekday", heads[0] === want && new Set(heads).size === 7, heads.join(","));
}
const opts = await page.getByLabel("My schedule").locator("option").allInnerTexts().catch(() => []);
check("schedules offered: just not set / weekdays", opts.length === 2 && opts.some(x => /Weekdays/.test(x)), opts.join(", "));

// ---- Sick Leave types ----
let s = (await api("/api/sick")).body;
const kinds = Object.entries(s.kinds).map(([key, v]) => ({ key, label: v.label, off: key === "fmla" ? true : v.off, protected: v.protected }));
kinds.push({ key: "", label: "Bereavement", protected: true });
r = await api("/api/sick/settings", { kinds });
s = (await api("/api/sick")).body;
const bk = Object.entries(s.kinds).find(([, v]) => v.label === "Bereavement");
check("leave types: FMLA off, own type added", r.status === 200 && s.kinds.fmla.off === true && bk && bk[1].protected && bk[1].custom, JSON.stringify(s.kinds).slice(0, 300));
r = await api("/api/sick/entries", { userId: pat, from: today, kind: bk[0], hours: 8 });
check("log with the new type", r.status === 200 && psql(`SELECT kind || ' ' || protected FROM sick_entries WHERE user_id = '${pat}'`) === `${bk[0]} true`, JSON.stringify(r.body));
r = await api("/api/sick/entries", { userId: sam, from: today, kind: "fmla", hours: 8 });
check("a type that's turned off isn't used", r.status === 200 && psql(`SELECT kind FROM sick_entries WHERE user_id = '${sam}'`) === "sick");
psql(`DELETE FROM sick_entries`);
check("keep at least one type", (await api("/api/sick/settings", { kinds: kinds.map(k => ({ ...k, off: true })) })).status === 400);

// ---- Permissions and profiles for a business; display screens ----
const acc = (await api("/api/access")).body;
const keys = acc.sections.map(x => x.key);
check("Permissions: only this install's sections", keys.includes("schedule") && keys.includes("links") && keys.includes("sick") && !keys.includes("pial") && !keys.includes("leave") && !keys.includes("command"), keys.join(","));
check("profiles have business names", acc.profiles.some(p => p.name === "Owner / Director") && acc.profiles.some(p => p.name === "Supervisor") && !acc.profiles.some(p => /Fire Chief|Chief Officer/.test(p.name)),
  acc.profiles.map(p => p.name).join(", "));
check("profile levels only for sections here", acc.profiles.every(p => Object.keys(p.levels).every(k => keys.includes(k))));
const ds = (await api("/api/display/screens")).body;
check("display screens: no fire views, no Command Board switch", ds.views.schedule && ds.views.spot && !ds.views.duty && !ds.views.calls && !ds.views.oncall && ds.boards === false, JSON.stringify(ds.views));

// ---- Work Schedule ----
const wk = monday(today);
r = await api("/api/schedule/save", { entries: [pat, sam].flatMap(u => [0, 1, 2, 3, 4].map(i => ({ userId: u, day: addDays(wk, i), start: "09:00", end: "17:00" }))) });
check("fill a week for two people", r.status === 200 && r.body.saved === 10);
r = await api("/api/schedule/save", { entries: [{ userId: pat, day: today, start: "00:00", end: "23:59", earlyAt: "00:01", note: "dentist" }] });
const t = (await api("/api/schedule/today")).body;
const patToday = t.list.find(e => e.userId === pat);
check("today: leaving early shows", patToday && patToday.earlyAt === "00:01" && patToday.status === "left_early" && patToday.note === "dentist", JSON.stringify(t).slice(0, 300));
// Stepping out and coming back (a doctor's appointment): away during the gap, working again after
r = await api("/api/schedule/save", { entries: [{ userId: pat, day: today, start: "00:00", end: "23:59", earlyAt: "00:01", backAt: "23:58", note: "dr appt" },
  { userId: sam, day: today, start: "00:00", end: "23:59", earlyAt: "00:01", backAt: "00:02" }] });
const t2 = (await api("/api/schedule/today")).body;
const pat2 = t2.list.find(e => e.userId === pat), sam2 = t2.list.find(e => e.userId === sam);
check("stepping out: away until back, then working again", r.status === 200 && pat2?.status === "away" && pat2.backAt === "23:58" && sam2?.status === "working" && sam2.backAt === "00:02",
  JSON.stringify([pat2, sam2]).slice(0, 300));
check("back time has to fall inside the workday", (await api("/api/schedule/save", { entries: [{ userId: pat, day: today, start: "09:00", end: "17:00", earlyAt: "10:00", backAt: "18:00" }] })).status === 400
  && (await api("/api/schedule/save", { entries: [{ userId: pat, day: today, start: "09:00", end: "17:00", backAt: "12:00" }] })).status === 400);
r = await api("/api/schedule/copy", { from: wk, to: addDays(wk, 7) });
check("copy the week to next week", r.status === 200 && r.body.copied >= 10 && Number(psql(`SELECT count(*) FROM work_schedule WHERE day >= '${addDays(wk, 7)}'`)) >= 10, JSON.stringify(r.body));
check("bad times refused", (await api("/api/schedule/save", { entries: [{ userId: pat, day: today, start: "9am", end: "5pm" }] })).status === 400);
check("schedule changes audited", /Changed the schedule/.test(psql("SELECT string_agg(action, ';') FROM audit_log WHERE module = 'Work schedule'")));
// An employee sees it but can't change it
await p2.goto(BASE); await apiOn(p2)("/api/auth/login", { email: "sam@shop.example", password: PW });
const sv = await apiOn(p2)(`/api/schedule?from=${wk}&to=${addDays(wk, 6)}`);
check("employees see the schedule, can't change it", sv.status === 200 && sv.body.entries.length >= 10 && Array.isArray(sv.body.canEdit) && !sv.body.canEdit.length
  && (await apiOn(p2)("/api/schedule/save", { entries: [{ userId: sam, day: today, start: "09:00", end: "10:00" }] })).status === 403);

await home();
body = await page.locator("main").innerText();
check("Your Day: Working today card", /Working today/.test(body) && /Pat Clerk/.test(body), body.slice(0, 500));
await nav("Work Schedule");
const cellBtn = page.getByRole("button", { name: new RegExp(`Sam Counter, .*${new Date(`${addDays(wk, 5)}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}.*not scheduled`) }).first();
await cellBtn.click(); await page.waitForTimeout(400);
await page.getByLabel("Starts").fill("10:00"); await page.getByLabel("Ends").fill("14:00");
await page.getByRole("dialog").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(1200);
check("set a day by clicking it", psql(`SELECT to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') FROM work_schedule WHERE user_id = '${sam}' AND day = '${addDays(wk, 5)}'`) === "10:00-14:00");
await page.getByRole("button", { name: `Sam Counter, ${new Date(`${addDays(wk, 5)}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: 10 am – 2 pm` }).click();
await page.waitForTimeout(400);
await page.getByRole("dialog").getByLabel(/Away part of the day/).check(); await page.getByLabel("Leaving at").fill("11:00");
await page.getByRole("dialog").getByLabel("Coming back").check(); await page.getByLabel("Back at").fill("12:30");
await page.getByRole("dialog").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(1200);
check("editor: away 11:00 and back 12:30", psql(`SELECT to_char(early_at, 'HH24:MI') || '-' || to_char(back_at, 'HH24:MI') FROM work_schedule WHERE user_id = '${sam}' AND day = '${addDays(wk, 5)}'`) === "11:00-12:30");
check("the week grid shows the time away", /out 11 am–12:30 pm/.test(await page.locator("main").innerText()));
await page.screenshot({ path: "shot-schedule-week.png" });
await nav("Today");
check("Today page groups people", /Left early|Working now|Later today|Done for the day/.test(await page.locator("main").innerText()));
await page.screenshot({ path: "shot-schedule-today.png" });

// ---- Quick Links: copy and open ----
await api("/api/links", { title: "Supplier portal", url: "https://supplier.example.com", category: "Suppliers", login: { user: "demo", password: "demo-pass" } });
await home(); await nav("Quick Links");
await page.getByRole("button", { name: /Show login for Supplier portal/ }).click(); await page.waitForTimeout(700);
check("Copy password and open the site", await page.getByRole("button", { name: "Copy password and open the site" }).count() === 1
  && /Websites don't let another site sign you in/.test(await page.locator("main").innerText()));

check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
