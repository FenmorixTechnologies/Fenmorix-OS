// Training upgrades: drills (log, confirm, dispute, verify, send back), proficiency, company / shift views and scope,
// FireWorks supersede, grading-year roster history, PIAL estimate from Nexus training. Fictional people only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 400) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const SCR = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad";
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const TODAY = day(0), TOM = day(1), D2 = day(2);

// ---- Aladtec stand-in: today's shift (made-up names) ----
const MEMBERS = [], SCHED = [];
let MID = 700;
const P = (name, from = "07:00", to = "07:00") => { MID++; MEMBERS.push({ member_id: MID, first_name: name.split(" ")[0], last_name: name.split(" ")[1] }); return { id: MID, from, to }; };
SCHED.push(["EG613", [P("Cap Carl"), P("Fred Floor"), P("Gina Gray")]], ["EG623", [P("Ned Neighbor")]], ["SG005", [P("Bob Battalion")]], ["EG633", [P("Ryan Off")]]);
const dt = (d, hm, next = false) => { const x = new Date(d + "T00:00"); const [h] = hm.split(":").map(Number); if (next && h <= 7) x.setDate(x.getDate() + 1); return `${x.toLocaleDateString("en-CA")}T${hm}`; };
const mock = http.createServer((req, res) => {
  const out = j => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.url === "/oauth/token") return out({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });
  if (req.url.startsWith("/schedules")) return out(SCHED.map((u, k) => ({ schedule_id: k + 1, name: u[0], order: k, positions: u[1].map((p, n) => ({ position_id: (k + 1) * 10 + n, label: "", order: n })) })));
  if (req.url.startsWith("/members")) return out(MEMBERS);
  if (req.url.startsWith("/scheduled-time/members-scheduled-now")) return out([]);
  if (req.url.startsWith("/scheduled-time?")) {
    const d = new URL(req.url, "http://x").searchParams.get("range_start").slice(0, 10);
    const recs = []; SCHED.forEach((s, k) => s[1].forEach((p, n) => recs.push({ member_id: p.id, schedule_id: k + 1, position_id: (k + 1) * 10 + n, time_type: "Regular", start_datetime: dt(d, p.from), stop_datetime: dt(d, p.to, true) })));
    return out({ [d]: recs });
  }
  if (req.url.startsWith("/time-off?")) {
    const d = new URL(req.url, "http://x").searchParams.get("range_start").slice(0, 10);
    return out({ [d]: [{ time_off_id: 1, member_id: MEMBERS.find(m => m.first_name === "Ryan").member_id, time_off_type: "OV - Vacation", start_datetime: dt(d, "07:00"), stop_datetime: dt(d, "07:00", true) }] });
  }
  res.writeHead(404); res.end("{}");
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
fs.writeFileSync("/home/claude/testrun/fake-whisper.log", "");
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", ALADTEC_BASE_URL: "http://127.0.0.1:3099", ALADTEC_CLIENT_ID: "id", ALADTEC_CLIENT_SECRET: "s",
    WHISPER_BIN: "/home/claude/testrun/fake-whisper.mjs", WHISPER_MODEL: "/home/claude/testrun/fake-model.bin" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

// ---- end Aladtec stand-in
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
async function person(viewport = { width: 1350, height: 950 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "America/Chicago" });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "Room needed for a drill" : undefined));
  const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [path, opts]);
  const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
  const settle = async (ms = 500) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  async function login(email) {
    await ctx.clearCookies(); await page.goto(BASE); await settle();
    await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click(); await settle(900);
  }
  const nav = async name => { await page.getByRole("button", typeof name === "string" ? { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?$`) } : { name }).first().click(); await settle(700); };
  return { ctx, page, api, post, settle, login, nav, body: () => page.locator("body").innerText() };
}


const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const PEOPLE = [["Cap Carl", "cap", "Captain", "61", "fire:A"], ["Fred Floor", "fred", "Firefighter", "61", "fire:A"], ["Gina Gray", "gina", "Firefighter", "61", "fire:A"],
  ["Ned Neighbor", "ned", "Firefighter", "62", "fire:A"], ["Zed Bshift", "zed", "Firefighter", "61", "fire:B"], ["Bob Battalion", "bob", "Battalion Chief", "", "fire:A"], ["Tara Trainer", "tara", "Training Officer", "", "weekdays"]];
for (const [n, e] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t, st, wp] of PEOPLE) psql(`UPDATE users SET job_title = '${t}', station = '${st}', work_pattern = '${wp}' WHERE full_name = '${n}'`);
psql(`UPDATE users SET division_id = (SELECT id FROM divisions WHERE name = 'Training') WHERE full_name = 'Tara Trainer'`);
await M.post("/api/access/grants", { section: "training", level: "edit", userId: uid("Tara Trainer"), scope: "all" });
for (let i = 0; i < 40; i++) { const dd = await M.api("/api/directory/duty"); if (JSON.stringify(dd.body || {}).includes("Fred")) break; await wait(500); }

// ======= Views / scope =======
const C = await person(); await C.login("cap@sgfd.org");
let v = (await C.api("/api/training/views")).body;
check("captain: officer of Station 61 A, can log, sees only his company", v.role === "officer" && v.canLog && JSON.stringify(v.companies) === '[{"station":"61","shift":"A"}]' && !v.shifts.length, JSON.stringify(v).slice(0, 300));
const B = await person(); await B.login("bob@sgfd.org");
v = (await B.api("/api/training/views")).body;
check("battalion chief: his shift, every company on it", v.role === "bc" && JSON.stringify(v.shifts) === '["A"]' && v.companies.map(c => c.station + c.shift).join() === "61A,62A", JSON.stringify(v.companies));
const F = await person(); await F.login("fred@sgfd.org");
v = (await F.api("/api/training/views")).body;
check("firefighter: member, can't log", v.role === "member" && !v.canLog && !v.companies.length);
check("captain can't open Station 62's company or the shift view", (await C.api("/api/training/company?station=62&shift=A")).status === 403 && (await C.api("/api/training/shift?shift=A")).status === 403);
check("captain can open his own crew member's training, not B shift's", (await C.api(`/api/training/person?user=${uid("Fred Floor")}`)).status === 200 && (await C.api(`/api/training/person?user=${uid("Zed Bshift")}`)).status === 403);

// ======= Captain logs a drill (UI) =======
await C.nav("Training");
await C.nav("Log a drill"); await C.settle(800);
let b = await C.body();
check("crew list from the company with on-duty members checked", await C.page.getByLabel("Attended: Fred Floor").isChecked() && await C.page.getByLabel("Attended: Gina Gray").isChecked() && /ON DUTY/.test(b), b.slice(0, 400));
await C.page.getByLabel("Drill topic").fill("Hydrant connections and supply line");
await C.page.getByLabel("Start time").fill("09:00"); await C.page.getByLabel("End time").fill("11:30");
await C.page.getByLabel("Units").fill("EG613");
await C.page.getByLabel("Hours for Gina Gray").fill("1.5");
await C.page.getByLabel("Skill: Water supply from a hydrant").check(); await C.settle(200);
await C.page.getByRole("radio", { name: "Fred Floor Water supply from a hydrant: Met" }).click();
await C.page.getByRole("radio", { name: "Gina Gray Water supply from a hydrant: Not met" }).click();
const canvas = C.page.locator("canvas").last(); await canvas.scrollIntoViewIfNeeded();
const bb = await canvas.boundingBox();
await C.page.mouse.move(bb.x + 20, bb.y + 40); await C.page.mouse.down(); await C.page.mouse.move(bb.x + 140, bb.y + 70, { steps: 8 }); await C.page.mouse.move(bb.x + 220, bb.y + 30, { steps: 8 }); await C.page.mouse.up();
await C.page.getByRole("button", { name: "Sign and submit" }).click(); await C.settle(1000);
const drillId = psql("SELECT id FROM training_drills");
check("drill saved: submitted, 2.5 h from the times, Station 61 A", psql("SELECT status || ' ' || hours || ' ' || station || shift FROM training_drills") === "submitted 2.50 61A");
check("crew of 3 with Gina at 1.5 h", psql(`SELECT string_agg(name || ':' || hours, ',' ORDER BY name) FROM training_drill_people`) === "Cap Carl:2.50,Fred Floor:2.50,Gina Gray:1.50");
check("proficiency results waiting for verification", psql("SELECT string_agg(name || ':' || result || ':' || status, ',' ORDER BY name) FROM training_skill_checks") === "Fred Floor:met:pending,Gina Gray:not_met:pending");
check("crew asked to confirm (message to Fred and Gina)", psql(`SELECT string_agg(u.full_name, ',' ORDER BY u.full_name) FROM message_recipients r JOIN message_threads t ON t.id = r.thread_id JOIN users u ON u.id = r.user_id WHERE t.subject LIKE 'Confirm your training: Hydrant%' AND u.full_name <> 'Cap Carl'`) === "Fred Floor,Gina Gray");
check("drill page opens with the signature", /Hydrant connections and supply line/.test(await C.body()) && await C.page.getByAltText("Officer signature").count() === 1);
check("captain can't log for Station 62", (await C.post("/api/training/drills", { day: day(0), hours: 1, station: "62", shift: "A", topic: "x", people: [] })).status === 403);
check("firefighter can't log a drill", (await F.post("/api/training/drills", { day: day(0), hours: 1, station: "61", shift: "A", topic: "x" })).status === 403);
check("future date refused", (await C.post("/api/training/drills", { day: day(2), hours: 1, station: "61", shift: "A", topic: "x" })).status === 400);
check("captain can't verify his own drill (no Training access)", (await C.post(`/api/training/drills/${drillId}/verify`, {})).status === 403);
check("submitted drill can't be edited", (await C.post("/api/training/drills", { id: drillId, day: day(0), hours: 3, station: "61", shift: "A", topic: "x" })).status === 409);

// ======= Fred confirms (UI), Gina questions =======
await F.page.goto(BASE); await F.settle(1500);
check("Your Day: confirm your training", /Confirm your training: 1 drill was logged/.test(await F.body()));
check("todo count for Fred", (await F.api("/api/training/todo")).body.confirm === 1);
await F.page.getByRole("button", { name: "Confirm", exact: true }).first().click(); await F.settle(900);
await F.page.getByRole("button", { name: /Open drill Hydrant/ }).click(); await F.settle(700);
await F.page.getByRole("button", { name: "Yes, confirm" }).click(); await F.settle(600);
check("Fred confirmed", psql(`SELECT confirmed_at IS NOT NULL FROM training_drill_people WHERE name = 'Fred Floor'`) === "t" && /You confirmed you attended/.test(await F.body()));
const G = await person(); await G.login("gina@sgfd.org");
const gq = await G.post(`/api/training/drills/${drillId}/confirm`, { dispute: "I left at 10:00 for the medical call" });
check("Gina questions it; the captain is told", gq.status === 200 && psql(`SELECT disputed FROM training_drill_people WHERE name = 'Gina Gray'`) === "I left at 10:00 for the medical call"
  && psql(`SELECT count(*) FROM message_threads WHERE subject LIKE 'Question about your drill log%'`) === "1");
check("someone not on the list can't confirm", (await B.post(`/api/training/drills/${drillId}/confirm`, {})).status === 403);

// ======= Tara verifies (UI) =======
const T = await person(); await T.login("tara@sgfd.org");
check("Training sees 1 to verify", (await T.api("/api/training/todo")).body.verify === 1);
await T.nav("Training"); await T.nav("Drills");
await T.page.getByLabel("Show drills").selectOption("submitted"); await T.settle(300);
await T.page.getByRole("button", { name: /Open drill Hydrant/ }).click(); await T.settle(700);
b = await T.body();
check("Training sees confirmations (officer auto-confirmed) and the question", /Questioned: I left at 10:00/.test(b) && /✓/.test(b) && psql(`SELECT confirmed_at IS NOT NULL FROM training_drill_people WHERE name = 'Cap Carl'`) === "t");
await T.page.getByRole("button", { name: "Verify", exact: true }).click(); await T.settle(900);
check("verified: records for all three, Gina 1.5 h", psql("SELECT status FROM training_drills") === "verified" &&
  psql("SELECT string_agg(person_name || ':' || hours || ':' || source, ',' ORDER BY person_name) FROM training_records") === "Cap Carl:2.50:drill,Fred Floor:2.50:drill,Gina Gray:1.50:drill");
check("proficiency results now final", psql("SELECT count(*) FROM training_skill_checks WHERE status = 'final'") === "2");
let fp = (await F.api(`/api/training/person?user=${uid("Fred Floor")}`)).body;
check("Fred's hours count the drill (company)", fp.totalHours === 2.5 && fp.requirements.find(r => r.id === "iso-company").done === 2.5, JSON.stringify(fp.requirements.find(r => r.id === "iso-company")));

// ======= Proficiency =======
let pr = (await C.api("/api/training/proficiency?station=61&shift=A")).body;
const st = (n, k) => pr.people.find(p => p.name === n).skills.find(s => s.id === k)?.status;
check("Fred current on water supply, Gina needs retraining, SCBA not on record", st("Fred Floor", "water-supply") === "current" && st("Gina Gray", "water-supply") === "retrain" && st("Fred Floor", "scba") === "never");
check("pump skill only for driver titles", st("Fred Floor", "pump") === undefined && pr.people.find(p => p.name === "Cap Carl").skills.some(s => s.id === "size-up"));
check("captain records SCBA for his crew", (await C.post("/api/training/proficiency/check", { skillId: "scba", day: day(0), result: "met", userIds: [uid("Fred Floor"), uid("Gina Gray")] })).body.added === 2);
check("…but not for B shift, or himself", (await C.post("/api/training/proficiency/check", { skillId: "scba", day: day(0), result: "met", userIds: [uid("Zed Bshift")] })).status === 403
  && (await C.post("/api/training/proficiency/check", { skillId: "scba", day: day(0), result: "met", userIds: [uid("Cap Carl")] })).status === 403);
psql(`INSERT INTO training_skill_checks (id, user_id, name, skill_id, day, result, status) VALUES (gen_random_uuid(), '${uid("Gina Gray")}', 'Gina Gray', 'mayday', current_date - 200, 'met', 'final')`);
pr = (await C.api("/api/training/proficiency?station=61&shift=A")).body;
check("a 6-month skill checked 200 days ago is overdue", st("Gina Gray", "mayday") === "overdue" && st("Fred Floor", "scba") === "current");
await C.nav("Proficiency"); await C.settle(600);
check("proficiency matrix renders", await C.page.getByLabel("Gina Gray Water supply from a hydrant: Retrain").count() === 1 && await C.page.getByLabel("Gina Gray Mayday and self-rescue: Overdue").count() === 1);

// ======= Company and shift views =======
await C.nav("My company"); await C.settle(800);
b = await C.body();
check("company view: crew, verified drill hours", await C.page.getByLabel("Company").inputValue() === "61|A" && /Gina Gray/.test(b) && !/Ned Neighbor/.test(b) && /2\.5 h verified/.test(b), b.slice(0, 500));
const cv = (await C.api("/api/training/company?station=61&shift=A")).body;
check("company summary numbers", cv.summary.members === 3 && cv.drillCount === 1 && cv.drillHours === 2.5 && cv.summary.onDuty === 3, JSON.stringify(cv.summary));
const sv = (await B.api("/api/training/shift?shift=A")).body;
check("shift view: stations 61 and 62 (+ the BC, no home station)", sv.companies.map(c => `${c.station}:${c.members}:${c.drills}`).join() === "61:3:1,62:1:0,:1:0", JSON.stringify(sv.companies.map(c => [c.station, c.members, c.drills])));
check("BC can't see B shift", (await B.api("/api/training/shift?shift=B")).status === 403);
await B.nav("Training"); await B.nav("My shift"); await B.settle(800);
await B.page.getByRole("button", { name: "People at Station 61" }).click(); await B.settle(200);
check("shift view UI lists the stations and people", /Station 62/.test(await B.body()) && /Fred Floor/.test(await B.body()));
await B.page.screenshot({ path: SCR + "/e37-shift.png" });

// ======= FireWorks import supersedes the drill record =======
const csv = `Name,Employee ID,Date,Hours,Subject,Content Title\nFred Floor,,${day(0)},2.5,Company,Hydrant connections\nFred Floor,,${day(0)},1,Hazmat,Hazmat refresher\n`;
const imp = await T.post("/api/training/import", { fileName: "fw.csv", data: Buffer.from(csv).toString("base64") });
check("import: the drill's matching record is replaced, not doubled", imp.body?.imported?.drillsMatched === 1 && psql(`SELECT count(*) FROM training_records WHERE person_name = 'Fred Floor' AND superseded_by IS NOT NULL`) === "1", JSON.stringify(imp.body).slice(0, 300));
fp = (await F.api(`/api/training/person?user=${uid("Fred Floor")}`)).body;
check("Fred's total: 2.5 (FireWorks) + 1 hazmat = 3.5", fp.totalHours === 3.5, fp.totalHours);
check("drill shows it's in FireWorks", (await T.api(`/api/training/drills/${drillId}`)).body.drill.people.find(p => p.name === "Fred Floor").inFireWorks === true);
const exp = await T.page.evaluate(async () => (await fetch("/api/training/drills/export.csv")).text());
check("FireWorks entry CSV lists the verified drill", /Gina Gray/.test(exp) && /Hydrant connections and supply line/.test(exp) && /"1\.5"/.test(exp), exp.slice(0, 300));
check("export needs Training edit", (await C.api("/api/training/drills/export.csv")).status === 403);

// ======= Send back and fix =======
const d2 = await C.post("/api/training/drills", { day: day(0), hours: 1, station: "61", shift: "A", topic: "Ladders", people: [{ userId: uid("Fred Floor") }], submit: true, signature: "data:image/png;base64,iVBORw0KGgo=" });
check("second drill submitted", d2.status === 200 && d2.body.status === "submitted");
check("send back needs a note", (await T.post(`/api/training/drills/${d2.body.id}/return`, {})).status === 400);
await T.post(`/api/training/drills/${d2.body.id}/return`, { note: "Add the ladder sizes to the notes." });
check("captain's todo: 1 sent back", (await C.api("/api/training/todo")).body.returned === 1);
const fix = await C.post("/api/training/drills", { id: d2.body.id, day: day(0), hours: 1, station: "61", shift: "A", topic: "Ladders", objectives: "24' and 35'", people: [{ userId: uid("Fred Floor") }], submit: true, signature: "data:image/png;base64,iVBORw0KGgo=" });
check("fixed and resubmitted", fix.status === 200 && psql(`SELECT status || ':' || return_note FROM training_drills WHERE id = '${d2.body.id}'`) === "submitted:");
const d3 = await C.post("/api/training/drills", { day: day(0), hours: 1, station: "61", shift: "A", topic: "Draft only", people: [] });
check("draft hidden from the crew, deletable by the officer", !(await F.api("/api/training/drills")).body.drills.some(x => x.id === d3.body.id) && (await C.post(`/api/training/drills/${d3.body.id}/remove`, {})).status === 200);

// ======= Roster history =======
let ro = (await T.api("/api/training/roster")).body;
const row = n => ro.rows.find(r => r.name === n);
check("this year's roster follows the accounts (suppression only)", ro.rows.length === 6 && !row("Tara Trainer") && row("Cap Carl").officer && row("Bob Battalion").officer, ro.rows.map(r => r.name).join());
psql(`UPDATE users SET active = false WHERE full_name = 'Ned Neighbor'`);
psql(`UPDATE users SET job_title = 'Engineer' WHERE full_name = 'Gina Gray'`);
ro = (await T.api("/api/training/roster")).body;
check("deactivated member gets an end date; title change noted, now a driver", row("Ned Neighbor").left === day(0) && row("Gina Gray").driver && row("Gina Gray").driverSince === day(0)
  && row("Gina Gray").changes.some(c => /now a driver/.test(c.what)), JSON.stringify(row("Gina Gray")));
check("roster edits need manage", (await T.post("/api/training/roster", { year: Number(day(0).slice(0, 4)), name: "X" })).status === 403);
const yr = Number(day(0).slice(0, 4));
const add = await M.post("/api/training/roster", { year: yr, name: "Lee Left", title: "Firefighter", joined: `${yr}-01-01`, left: `${yr}-03-31`, shift: "C" });
check("manager adds someone who left in March (no account)", add.status === 200 && psql(`SELECT left_on || ':' || source || ':' || locked FROM training_roster WHERE name = 'Lee Left'`) === `${yr}-03-31:manual:true`);
await M.post("/api/training/roster", { ...row("Cap Carl"), id: row("Cap Carl").id, year: yr, note: "Acting BC in June", officer: true });
psql(`UPDATE users SET job_title = 'Battalion Chief' WHERE full_name = 'Cap Carl'`);
ro = (await M.api("/api/training/roster")).body;
check("hand-edited rows are left alone by the sync", row("Cap Carl").locked && row("Cap Carl").title === "Captain" && row("Cap Carl").note === "Acting BC in June");
psql(`UPDATE users SET job_title = 'Captain' WHERE full_name = 'Cap Carl'`);
await M.page.goto(BASE); await M.settle(1000); await M.nav("Training"); await M.nav("Roster history"); await M.settle(700);
check("roster page shows people who left", /Lee Left/.test(await M.body()) && /left Mar 31/.test(await M.body()));

// ======= PIAL estimate =======
const pe = (await T.api(`/api/training/pial?year=${yr}`)).body;
const it = k => pe.estimate.items.find(i => i.key === k);
check("PIAL estimate: members = the roster, company training from the drill + FireWorks", pe.estimate.members === 7 && it("t580b").method === "training data" && it("t580b").credit > 0, JSON.stringify({ m: pe.estimate.members, b: it("t580b") }).slice(0, 300));
check("estimate member rows carry hours", pe.estimate.rows.find(r => r.name === "Fred Floor").companyCredited > 0 && pe.estimate.rows.find(r => r.name === "Fred Floor").hazmat === 1);
check("PIAL tracker still on its own imports by default", pe.trainingSource === "pial");
await M.post("/api/pial/settings", { trainingSource: "nexus" });
const pe2 = (await T.api(`/api/training/pial?year=${yr}`)).body;
check("switching PIAL to Nexus training: tracker = estimate", pe2.trainingSource === "nexus" && pe2.current.training === pe2.estimate.training && pe2.current.members === 7);
check("firefighter can't see the estimate", (await F.api("/api/training/pial")).status === 403);
await T.page.goto(BASE); await T.settle(1000); await T.nav("Training"); await T.nav("PIAL estimate"); await T.settle(1200);
check("PIAL estimate page renders", /Training credit \(Nexus\)/i.test(await T.body()) && /580-B/.test(await T.body()));
await T.page.screenshot({ path: SCR + "/e37-pial.png", fullPage: true });

// ======= Skills settings =======
await M.nav("Skills & roles"); await M.settle(600);
await M.page.getByRole("button", { name: "Skill", exact: true }).click();
await M.page.getByLabel("Skill 11 name").fill("Vehicle extrication"); await M.page.getByLabel("Skill 11 interval").selectOption("12");
await M.page.getByRole("button", { name: "Save", exact: true }).click(); await M.settle(500);
check("skill added in settings", (await M.api("/api/training/views")).body.skills.some(k => k.id === "vehicle-extrication"));
check("bad role pattern refused", (await M.post("/api/training/proficiency/settings", { roles: { officer: "(" } })).status === 400);

// ======= Drill list and Your Day for Training =======
await T.page.goto(BASE); await T.settle(1500);
check("Your Day: drill logs waiting for Training", /drill log is waiting for Training to verify/.test(await T.body()));

check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close(); mock.close();
try { process.kill(srv.pid); } catch {}
process.exit(0);
