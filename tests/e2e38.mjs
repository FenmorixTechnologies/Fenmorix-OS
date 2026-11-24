// Emergency recall (Policy 1010): start (AC and above), notice, member answers (no refusal), phoned-in answers, roll call,
// Aladtec mirror (read-only), unit staffing with seat flags, checklist, close, settings. Fictional people only.
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
SCHED.push(["EG613", [P("Fred Floor"), P("Zed Captain")]], ["EG623", [P("Ned Neighbor")]], ["SG005", [P("Andy Assistant")]], ["EG633", [P("Ryan Off")]]);
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
const PEOPLE = [["Andy Assistant", "andy", "Assistant Chief", "", "weekdays"], ["Bob Battalion", "bob", "Battalion Chief", "", "fire:A"], ["Cora Comms", "cora", "Communications Officer", "", "comms:A"],
  ["Fred Floor", "fred", "Engineer", "61", "fire:A"], ["Gina Gray", "gina", "Firefighter", "61", "fire:A"], ["Ned Neighbor", "ned", "Firefighter", "62", "fire:A"], ["Zed Captain", "zed", "Captain", "61", "fire:B"]];
for (const [n, e] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t, st, wp] of PEOPLE) psql(`UPDATE users SET job_title = '${t}', station = '${st}', work_pattern = '${wp}', phone = '225-555-01${String(PEOPLE.findIndex(p => p[0] === n)).padStart(2, "0")}' WHERE full_name = '${n}'`);
await M.post("/api/access/grants", { section: "recall", level: "edit", userId: uid("Cora Comms"), scope: "all" });
const aShift = psql("SELECT id FROM access_groups WHERE name = 'A-Shift'");
for (let i = 0; i < 40; i++) { const dd = await M.api("/api/directory/duty"); if (JSON.stringify(dd.body || {}).includes("Fred")) break; await wait(500); }

const A = await person(); await A.login("andy@sgfd.org");
const Bc = await person(); await Bc.login("bob@sgfd.org");
const F = await person(); await F.login("fred@sgfd.org");
const C = await person(); await C.login("cora@sgfd.org");
check("Assistant Chief can start; BC, firefighter and Comms can't", (await A.api("/api/recall")).body.canStart && !(await Bc.api("/api/recall")).body.canStart
  && (await F.post("/api/recall", { title: "x", startDate: day(0), users: [uid("Gina Gray")] })).status === 403 && (await C.post("/api/recall", { title: "x", startDate: day(0), users: [uid("Gina Gray")] })).status === 403);
check("the A-Shift group exists for picking", !!aShift);

// ======= Andy starts the recall (UI) =======
await A.nav("Emergency Recall"); await A.nav("Start a recall"); await A.settle(500);
await A.page.getByLabel("Recall title").fill("Hurricane Example – pre-landfall recall");
await A.page.getByLabel("Recall reason").selectOption("hurricane");
await A.page.getByLabel("First day").fill(day(1)); await A.page.getByLabel("Last day").fill(day(2));
await A.page.getByLabel("Instructions").fill("Bring 72 hours of gear. Stations 61 and 64 generator tests first.");
await A.page.getByLabel("Group: A-Shift").check();
await A.page.getByLabel("Add to Recalled people").selectOption({ label: "Zed Captain — Suppression" });
await A.page.getByRole("button", { name: "Start recall and send the notice" }).click(); await A.settle(1200);
const ev = psql("SELECT id FROM recall_events");
const names = psql(`SELECT string_agg(name, ',' ORDER BY name) FROM recall_members WHERE event_id = '${ev}'`);
check("recall started with A-Shift + Zed", names === "Bob Battalion,Fred Floor,Gina Gray,Ned Neighbor,Zed Captain", names);
check("notice sent as an important message with the Aladtec steps", psql(`SELECT important || ':' || (SELECT count(*) FROM message_recipients r WHERE r.thread_id = t.id AND r.user_id <> '${uid("Andy Assistant")}') FROM message_threads t WHERE subject LIKE 'EMERGENCY RECALL%'`) === "true:5"
  && /Log in to Aladtec/.test(psql("SELECT body FROM message_posts p JOIN message_threads t ON t.id = p.thread_id WHERE t.subject LIKE 'EMERGENCY RECALL%' LIMIT 1")));
check("board opened after starting", /Recall board/.test(await A.body()) && /Hurricane Example/.test(await A.body()));

// ======= Fred answers from Your Day =======
await F.page.goto(BASE); await F.settle(1500);
check("Your Day: the recall is the first thing", /EMERGENCY RECALL: Hurricane Example/.test(await F.body()));
await F.page.getByRole("button", { name: "Answer" }).first().click(); await F.settle(900);
check("member sees the Aladtec steps, not the board", /Report only once the assignment shows in Upcoming Shifts/.test(await F.body()) && !/Unit staffing/.test(await F.body()));
await F.page.getByLabel("ETA").fill("30 min"); await F.page.getByRole("button", { name: "I'm coming" }).click(); await F.settle(600);
check("Fred: coming, ETA 30 min", psql(`SELECT response || ':' || eta FROM recall_members WHERE name = 'Fred Floor'`) === "coming:30 min");
const G = await person(); await G.login("gina@sgfd.org");
check("members can't refuse", (await G.post(`/api/recall/${ev}/respond`, { response: "decline" })).status === 400);
await G.post(`/api/recall/${ev}/respond`, { response: "impaired", note: "Took prescribed medication tonight" });
check("impairment goes to the Assistant Chief", psql(`SELECT count(*) FROM message_threads WHERE subject = 'Recall: Gina Gray can''t report safely'`) === "1");
check("a member only sees their own row", (await G.api(`/api/recall/${ev}`)).body.board === false && !(await G.api(`/api/recall/${ev}`)).body.members);

// ======= Comms operates the board =======
const mid = n => psql(`SELECT id FROM recall_members WHERE name = '${n}'`);
check("Comms records a phoned-in answer", (await C.post(`/api/recall/${ev}/members/${mid("Ned Neighbor")}`, { response: "coming", eta: "1 hr" })).status === 200
  && psql(`SELECT responded_via FROM recall_members WHERE name = 'Ned Neighbor'`) === "Cora Comms");
check("Comms takes roll call", (await C.post(`/api/recall/${ev}/members/${mid("Fred Floor")}`, { checkIn: true })).status === 200);
check("Comms can't close the recall", (await C.post(`/api/recall/${ev}/close`, {})).status === 403);
check("BC (no grant) can't see the board", (await Bc.api(`/api/recall/${ev}`)).body.board === false);

// ======= Aladtec mirror =======
const al = (await A.api(`/api/recall/${ev}/aladtec`)).body;
check("Aladtec: Fred on EG613, Ned on EG623, Gina not scheduled", al.configured && al.matches[mid("Fred Floor")]?.[0]?.schedule === "EG613" && al.matches[mid("Ned Neighbor")]?.[0]?.schedule === "EG623" && !al.matches[mid("Gina Gray")], JSON.stringify(al).slice(0, 400));
check("two recall days checked", al.days.length === 2);

// ======= Units =======
check("same person in two seats refused", (await A.post(`/api/recall/${ev}/units`, { units: [{ unit: "EG613", seats: [{ role: "officer", userId: uid("Fred Floor") }, { role: "driver", userId: uid("Fred Floor") }] }] })).status === 400);
const sv = await A.post(`/api/recall/${ev}/units`, { units: [{ unit: "eg613", seats: [{ role: "officer", userId: uid("Zed Captain") }, { role: "driver", userId: uid("Fred Floor") }, { role: "ff", userId: uid("Ned Neighbor") }, { role: "ff", userId: null }] },
  { unit: "EG623" }] });
const units = (await A.api(`/api/recall/${ev}`)).body.units;
check("board saved: EG613 staffed, EG623 gets default engine seats", sv.status === 200 && units[0].unit === "EG613" && units[1].seats.length === 4 && units[1].kind === "engine", JSON.stringify(units).slice(0, 300));
const q = (await A.api(`/api/recall/${ev}`)).body.quals;
check("seat qualifications: Zed officer, Fred driver, Ned neither", q[uid("Zed Captain")].officer && q[uid("Fred Floor")].driver && !q[uid("Ned Neighbor")].driver);
await A.post(`/api/recall/${ev}/units/${units[0].id}/service`, { inService: true });
await A.post(`/api/recall/${ev}/checklist`, { key: "aladtecAlert", done: true });
check("in service and checklist in the timeline", /EG613 placed in service/.test(psql(`SELECT string_agg(what, '|') FROM recall_log WHERE event_id = '${ev}'`)) && /Done: Recall alert sent/.test(psql(`SELECT string_agg(what, '|') FROM recall_log WHERE event_id = '${ev}'`)));

// ======= Board UI =======
await A.page.goto(BASE); await A.settle(1000); await A.nav("Emergency Recall");
await A.page.getByRole("button", { name: /Open recall Hurricane Example/ }).click(); await A.settle(1500);
let b = await A.body();
check("board shows counts, Aladtec assignment and staffing", /EG613/.test(b) && /not on the schedule yet/.test(b) && /In service/.test(b) && /Can't report safely/.test(b), b.slice(0, 600));
await A.page.getByLabel("Show people").selectOption("none"); await A.settle(200);
check("filter: no answer = Bob and Zed", (await A.page.locator("tbody tr").allInnerTexts()).filter(t => /Bob Battalion|Zed Captain/.test(t)).length === 2);
await A.page.getByLabel("Show people").selectOption("all"); await A.settle(200);
await A.page.screenshot({ path: SCR + "/e38-board.png", fullPage: true });

// ======= Close =======
await A.post(`/api/recall/${ev}/close`, { note: "Storm passed; all units back to normal staffing." });
check("closed: answers refused afterwards", psql(`SELECT status FROM recall_events WHERE id = '${ev}'`) === "closed" && (await F.post(`/api/recall/${ev}/respond`, { response: "coming" })).status === 409);
check("settings: Comms can't change, master can add Special Ops", (await C.post("/api/recall/settings", { specialOps: [] })).status === 403
  && (await M.post("/api/recall/settings", { specialOps: [{ unit: "SQ615", location: "Station 61", people: [uid("Ned Neighbor")] }] })).status === 200);
check("audit trail", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Emergency recall'")) >= 3);

check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close(); mock.close();
try { process.kill(srv.pid); } catch {}
process.exit(0);
