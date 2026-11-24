// Off Work (days off with who-can-see, sick call-outs shown automatically, Your Day widget) and the Board report. Fictional people and calls only.
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

const mock = http.createServer((q, r) => { r.writeHead(404); r.end("{}"); });
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
fs.writeFileSync("/home/claude/testrun/fake-whisper.log", "");
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off",
    WHISPER_BIN: "/home/claude/testrun/fake-whisper.mjs", WHISPER_MODEL: "/home/claude/testrun/fake-model.bin" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

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
psql("INSERT INTO divisions (name) VALUES ('Administration'), ('Suppression') ON CONFLICT DO NOTHING");
const PEOPLE = [["Ray Rookie", "ray", "Firefighter", "Suppression", "fire:A"], ["Wanda Wells", "wanda", "Captain", "Suppression", "fire:A"],
  ["Owen Office", "owen", "Clerk", "Administration", "weekdays"], ["Carl Chief", "carl", "Fire Chief", "Administration", "weekdays"], ["Gina Gray", "gina", "Firefighter", "Suppression", "fire:B"]];
for (const [n, e, , div] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: div, password: PW });
await M.login("mike@sgfd.org");
psql("INSERT INTO divisions (name) VALUES ('Administration') ON CONFLICT DO NOTHING");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const p = PEOPLE.find(x => `${x[1]}@sgfd.org` === a.email);
  await M.post("/api/auth/approve", { id: a.id, role: "user", division: p[3] });
}
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t, , wp] of PEOPLE) psql(`UPDATE users SET job_title = '${t}', work_pattern = '${wp}' WHERE full_name = '${n}'`);




const ray = uid("Ray Rookie"), wanda = uid("Wanda Wells"), owen = uid("Owen Office"), carl = uid("Carl Chief"), gina = uid("Gina Gray");
const R = await person(); await R.login("ray@sgfd.org");
const O = await person(); await O.login("owen@sgfd.org");
const Wd = await person(); await Wd.login("wanda@sgfd.org");
const see = async (P, name) => (await P.api(`/api/offwork?from=${TODAY}&to=${day(20)}`)).body.entries.filter(e => e.name === name);

// ---- Off Work ----
let r = await R.post("/api/offwork", { from: TODAY, to: D2, kind: "vacation", note: "Beach trip", visibility: "division" });
check("Ray posts days off for his division", r.status === 200, JSON.stringify(r.body));
check("Wanda (same division) sees it", (await see(Wd, "Ray Rookie")).some(e => e.label === "Vacation / leave" && e.note === "Beach trip"));
check("Owen (other division) doesn't", (await see(O, "Ray Rookie")).length === 0);
r = await R.post("/api/offwork", { from: day(5), to: day(6), kind: "training", visibility: "people", people: [{ kind: "user", id: owen }] });
check("shared with certain people", r.status === 200 && (await see(O, "Ray Rookie")).length === 1 && (await see(Wd, "Ray Rookie")).length === 1);
r = await R.post("/api/offwork", { userId: wanda, from: TODAY, kind: "off" });
check("Ray can't post for Wanda", r.status === 403);
await M.post("/api/access/grants", { section: "offwork", level: "edit", userId: wanda, scope: "own" });
r = await Wd.post("/api/offwork", { userId: ray, from: day(9), kind: "ooo", visibility: "everyone" });
check("Wanda (Off Work: Edit, own division) posts for Ray", r.status === 200 && psql(`SELECT created_by_name FROM off_work WHERE start_day = '${day(9)}'`) === "Wanda Wells", JSON.stringify(r.body));
r = await Wd.post("/api/offwork", { userId: owen, from: day(9), kind: "ooo" });
check("but not for another division", r.status === 403);
// Sick leave shows up on its own
psql(`INSERT INTO sick_entries (id, user_id, division, day, hours, kind, protected) VALUES (gen_random_uuid(), '${gina}', 'Suppression', '${TODAY}', 24, 'sick', false), (gen_random_uuid(), '${gina}', 'Suppression', '${TOM}', 24, 'sick', false),
  (gen_random_uuid(), '${owen}', 'Administration', '${TODAY}', 8, 'fmla', true)`);
let g = await see(O, "Gina Gray");
check("sick call-outs show as Out sick (one run, everyone)", g.length === 1 && g[0].label === "Out sick" && g[0].from === TODAY && g[0].to === TOM && g[0].division === "Suppression" && !g[0].note, JSON.stringify(g));
const ow = await see(R, "Owen Office");
check("protected leave shows only as Out", ow.length === 1 && ow[0].label === "Out" && ow[0].kind === "leave", JSON.stringify(ow));
await M.post("/api/offwork/settings", { sickVisibility: "division" });
check("sick visibility setting: division only", (await see(O, "Gina Gray")).length === 0 && (await see(Wd, "Gina Gray")).length === 1);
await M.post("/api/offwork/settings", { sickVisibility: "everyone" });
const wid = (await Wd.api("/api/offwork/widget")).body;
check("widget: out today + next 7 days", wid.out.some(e => e.name === "Ray Rookie") && wid.out.some(e => e.name === "Gina Gray") && wid.soon.some(e => e.label === "Training / conference"), JSON.stringify(wid).slice(0, 300));
check("audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Off Work'")) >= 3);
// Part of a day
r = await Wd.post("/api/offwork", { from: TODAY, kind: "meeting", startTime: "23:00", endTime: "23:30", location: "Parish EOC", visibility: "everyone" });
check("part of a day with a place", r.status === 200 && psql(`SELECT to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') || '|' || location FROM off_work WHERE id = '${r.body.id}'`) === "23:00-23:30|Parish EOC", JSON.stringify(r.body));
r = await Wd.post("/api/offwork", { from: TODAY, kind: "meeting", startTime: "14:00", endTime: "13:00" });
check("back before leaving is refused", r.status === 400);
r = await Wd.post("/api/offwork", { from: TODAY, kind: "meeting", startTime: "00:00", endTime: "00:01", location: "Early meeting" });
const w2 = (await O.api("/api/offwork/widget")).body;
check("widget: shows the meeting until they're back, then drops it", w2.out.some(e => e.location === "Parish EOC" && e.endTime === "23:30") && !w2.out.some(e => e.location === "Early meeting"), JSON.stringify(w2.out.map(e => [e.label, e.location, e.endTime])));
// UI
await Wd.page.goto(BASE); await Wd.settle(1500);
const w = Wd.page.locator("text=Out today").first();
check("Your Day widget lists who's out", /Ray Rookie/.test(await Wd.body()) && /Vacation \/ leave · Suppression/.test(await Wd.body()) && /Out sick · Suppression/.test(await Wd.body()));
await Wd.page.screenshot({ path: "/home/claude/testrun/shot-offwork-widget.png" });
await O.page.goto(BASE); await O.settle(); await O.nav("Off Work");
await O.nav("Post days off");
await O.page.getByLabel("First day off").fill(day(3)); await O.page.getByLabel("Last day off").fill(day(4));
await O.page.getByLabel("What").selectOption("vacation");
await O.page.getByLabel("Note").fill("Out of town");
await O.page.getByText("Certain people").click();
await O.page.getByLabel("Share with").selectOption({ label: "Carl Chief — Administration" });
await O.page.getByRole("button", { name: "Post days off" }).last().click(); await O.settle(900);
check("UI post with certain people", psql(`SELECT kind || '|' || visibility || '|' || (people->0->>'name') FROM off_work WHERE user_id = '${owen}'`) === "vacation|people|Carl Chief");
await O.nav("Post days off");
await O.page.getByLabel("What").selectOption("meeting");
await O.page.getByLabel("Day", { exact: true }).fill(TOM);
await O.page.getByLabel("Leaving about").fill("09:00"); await O.page.getByLabel("Back about").fill("12:00");
await O.page.getByLabel("Where").fill("Fire Board office");
await O.page.getByRole("button", { name: "Post days off" }).last().click(); await O.settle(900);
check("UI part-day meeting", psql(`SELECT start_day::text || ' ' || to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') || '|' || location FROM off_work WHERE kind = 'meeting' AND user_id = '${owen}'`) === `${TOM} 09:00-12:00|Fire Board office`);
await O.nav("Who's out"); await O.settle();
check("Who's out page", /Out today/.test(await O.body()) && /Gina Gray/.test(await O.body()) && /about 9:00 AM – 12:00 PM/.test(await O.body()) && /At: Fire Board office/.test(await O.body()));
await O.page.screenshot({ path: "/home/claude/testrun/shot-offwork.png", fullPage: true });

// ---- Board report ----
const ins = [];
const nat = ["MEDICAL EMERGENCY", "FIRE ALARM", "MVA WITH INJURIES", "GAS LEAK", "LIFT ASSIST", "MEDICAL EMERGENCY"];
const y = Number(TODAY.slice(0, 4)), m = Number(TODAY.slice(5, 7));
const lm = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), lmLy = `${y - 1}${lm.slice(4)}`;
for (let i = 0; i < 60; i++) {
  const d = `${lm}-${String(1 + (i % 28)).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:10:00`;
  const n = i < 2 ? "STRUCTURE FIRE" : nat[i % nat.length];
  ins.push(`('b${i}', '26-${1000 + i}', 'St George FD', '${d}', timestamp '${d}' + interval '60 seconds', timestamp '${d}' + interval '420 seconds', '${n}', true, 45)`);
}
for (let i = 0; i < 40; i++) {
  const d = `${lmLy}-${String(1 + (i % 28)).padStart(2, "0")} 10:00:00`;
  ins.push(`('ly${i}', '25-${1000 + i}', 'St George FD', '${d}', timestamp '${d}' + interval '60 seconds', timestamp '${d}' + interval '480 seconds', 'MEDICAL EMERGENCY', true, 50)`);
}
ins.push(`('br1', '26-9999', 'Baton Rouge FD', '${lm}-05 12:00:00', timestamp '${lm}-05 12:01:00', timestamp '${lm}-05 12:09:00', 'STRUCTURE FIRE', true, 40)`);
psql(`INSERT INTO cad_incidents (incident_id, incident_number, agency, received_at, assigned_at, arrived_at, nature, dispatched, hold_seconds) VALUES ${ins.join(", ")}`);
psql(`INSERT INTO cad_unit_responses (incident_id, unit, assigned_at, arrived_at, cleared_at, agency, nature) VALUES
  ('b0', 'EG613', '${lm}-01 00:11:00', '${lm}-01 00:17:00', '${lm}-01 02:11:00', 'St George FD', 'STRUCTURE FIRE'),
  ('b1', 'EG613', '${lm}-02 01:11:00', '${lm}-02 01:17:00', '${lm}-02 02:11:00', 'St George FD', 'STRUCTURE FIRE'),
  ('b1', 'LD618', '${lm}-02 01:11:00', '${lm}-02 01:19:00', '${lm}-02 03:11:00', 'St George FD', 'STRUCTURE FIRE'),
  ('br1', 'EG653', '${lm}-05 12:01:00', '${lm}-05 12:09:00', '${lm}-05 13:01:00', 'Baton Rouge FD', 'STRUCTURE FIRE')`);
const C2 = await person(); await C2.login("carl@sgfd.org");
check("board report needs permission", (await C2.api("/api/board/meta")).status === 403);
await M.post("/api/access/grants", { section: "board", level: "view", userId: carl, scope: "all" });
const lmEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
const bd = (await C2.api(`/api/board/data?from=${lm}-01&to=${lmEnd}`)).body;
check("calls for service vs last year", bd.kpis.incidents === 60 && bd.kpis.ly === 40 && bd.agency === "St George FD", JSON.stringify(bd.kpis));
check("call types: alarms before fires", bd.types.find(t => t.type === "Fire alarms")?.n === 9 && bd.types.find(t => t.type === "Fires")?.n === 2 && bd.types.find(t => t.type === "Vehicle crashes / rescue")?.n === 10 && bd.types.find(t => t.type === "EMS / medical")?.n > 0, JSON.stringify(bd.types));
check("response times (received → on scene 7:00)", bd.response[0].total50 === 420 && bd.response[0].travel50 === 360, JSON.stringify(bd.response[0]));
check("structure fires listed", bd.structure.length === 2 && bd.kpis.structureFires === 2);
check("apparatus and aid given", bd.units.find(u => u.unit === "EG613")?.calls === 2 && bd.aid[0]?.agency === "Baton Rouge FD" && bd.kpis.aidGiven === 1, JSON.stringify([bd.units, bd.aid]));
check("sick totals", bd.staffing && bd.staffing.sickShifts >= 0);
await C2.page.goto(BASE); await C2.settle(); await C2.nav("Board Report");
await C2.page.getByRole("button", { name: "Open Monthly Operational Report to the Fire Board" }).click(); await C2.settle(1500);
let b = await C2.body();
check("report paper: headline numbers and sections", /REPORT TO THE FIRE BOARD/.test(b) && /Calls for service/.test(b) && /Structure fires \(2\)/.test(b) && /Apparatus responses/.test(b) && /EG613/.test(b), b.slice(0, 200));
await C2.page.getByLabel("Text 18").fill("Call volume is up with the new subdivision opening.");
await C2.page.getByLabel("Prepared by").fill("Fire Chief Carl Chief");
await C2.page.getByRole("button", { name: "Save as my report" }).click(); await C2.settle(900);
check("report saved", psql("SELECT count(*) FROM board_reports") === "1" && /new subdivision/.test(psql("SELECT blocks::text FROM board_reports")));
await C2.page.screenshot({ path: "/home/claude/testrun/shot-board.png", fullPage: true });
await C2.page.emulateMedia({ media: "print" });
await C2.page.pdf({ path: "/home/claude/testrun/board-report.pdf", format: "Letter", printBackground: true });
await C2.page.emulateMedia({ media: "screen" });
check("prints to PDF", fs.statSync("/home/claude/testrun/board-report.pdf").size > 20000);
check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close();
try { process.kill(srv.pid); } catch {}
mock.close();
process.exit(0);
