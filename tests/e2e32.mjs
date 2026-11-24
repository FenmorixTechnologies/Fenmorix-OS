// Round 1 of the training ideas: Working Fire transcripts (fake whisper), apparatus list, classroom bookings
// from the Facility & Resource Request form (no double booking), apparatus rotations, Your Day widget,
// Training section (FireWorks content list + training import, requirements, today's crew from Aladtec).
// Run: ./reset-db.sh (this test restarts the server with Aladtec + whisper settings)
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
SCHED.push(["EG613", [P("Fred Floor"), P("Gina Gray")]], ["LD618", [P("Hank Hill")]], ["SG005", [P("Cole Chief")]], ["EG623", [P("Ryan Off")]]);
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
  const nav = async name => { await page.getByRole("button", { name, exact: true }).first().click(); await settle(700); };
  return { ctx, page, api, post, settle, login, nav, body: () => page.locator("body").innerText() };
}

const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e, dv] of [["Fred Floor", "fred", "Suppression"], ["Gina Gray", "gina", "Suppression"], ["Tara Trainer", "tara", "Training"], ["Cole Chief", "cole", "Suppression"]]) {
  await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: dv, password: PW });
}
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: a.division || "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
psql(`UPDATE users SET job_title = 'Engineer', employee_number = 'E101' WHERE full_name = 'Fred Floor'`);
psql(`UPDATE users SET job_title = 'Captain', employee_number = 'E102' WHERE full_name = 'Gina Gray'`);
psql(`UPDATE users SET division_id = (SELECT id FROM divisions WHERE name = 'Training') WHERE full_name = 'Tara Trainer'`);
for (const s of ["training", "bookings"]) await M.post("/api/access/grants", { section: s, level: "edit", userId: uid("Tara Trainer"), scope: "all" });
await M.post("/api/access/grants", { section: "training", level: "view", userId: uid("Cole Chief"), scope: "all" });

// ======================= Transcripts =======================
check("transcriber ready (configured)", (await M.api("/api/recordings/transcriber")).body.ready === true);
const sample = fs.readFileSync(`${SCR}/nice/sample.distribution`);
const cookie = (await M.ctx.cookies()).map(c => `${c.name}=${c.value}`).join("; ");
const imp = await (await fetch(`${BASE}/api/recordings/import?name=sample.distribution&department=`, { method: "POST", headers: { cookie, "X-SGFD": "1", "Content-Type": "application/octet-stream" }, body: sample })).json();
const recId = imp.recording.id;
psql(`UPDATE fire_recordings SET address = '100 Example Ave', incident_number = 'F00-0001' WHERE id = '${recId}'`);
await M.nav("Working Fire Recordings").catch(async () => { await M.page.getByText("Working Fire Recordings").first().click(); await M.settle(); });
await M.page.getByRole("button", { name: /Open 100 Example Ave/ }).click(); await M.settle(800);
check("transcribe button shown", await M.page.getByRole("button", { name: "Transcribe Working Fire Audio" }).count() === 1);
await M.page.getByRole("button", { name: "Transcribe Working Fire Audio" }).click();
for (let i = 0; i < 40; i++) { await wait(500); if (/Transcribed /.test(await M.body())) break; }
let mb = await M.body();
const clipCount = imp.recording.clipCount;
check("transcript finishes and shows on the timeline", /Transcribed /.test(mb) && /establishing command/.test(mb), mb.slice(0, 300));
let rec = (await M.api(`/api/recordings/${recId}`)).body.recording;
check("every transmission has text (blank/noise cleaned)", rec.clips.every(c => c.text !== null) && rec.clips.some(c => c.text === "") && !rec.clips.some(c => /BLANK_AUDIO|^Thank you/.test(c.text)) && rec.transcript.status === "done" && rec.transcript.done === clipCount);
const batches = fs.readFileSync("/home/claude/testrun/fake-whisper.log", "utf8").trim().split("\n");
check("clips sent in batches of 40", batches.length === Math.ceil(clipCount / 40) && parseInt(batches[0]) === Math.min(40, clipCount), batches.join(","));
// Correct a line
const first = rec.clips[0];
await M.page.getByRole("button", { name: /^Correct the text at/ }).first().click();
await M.page.getByLabel("Transmission text").fill("Engine 61 on scene, two-story residential, heavy smoke Alpha side, Engine 61 has command.");
await M.page.getByRole("button", { name: "Save", exact: true }).click(); await M.settle(600);
rec = (await M.api(`/api/recordings/${recId}`)).body.recording;
check("correction saved and marked", rec.clips[0].text.includes("Engine 61 has command") && rec.clips[0].edited && /corrected/.test(await M.body()));
check("correction audited", psql("SELECT count(*) FROM audit_log WHERE module = 'Fire Recordings' AND action = 'Corrected transcript'") === "1");
// Run again: the corrected line stays
await M.post(`/api/recordings/${recId}/transcribe`, { redo: true });
for (let i = 0; i < 40; i++) { await wait(400); if ((await M.api(`/api/recordings/${recId}`)).body.recording.transcript.status === "done") break; }
rec = (await M.api(`/api/recordings/${recId}`)).body.recording;
check("re-run keeps hand corrections", rec.clips[0].text.includes("Engine 61 has command") && rec.clips[1].text !== null);
// Print
await M.page.reload(); await M.settle(800);
await M.page.getByText("Working Fire Recordings").first().click(); await M.settle(800);
await M.page.getByRole("button", { name: /Open 100 Example Ave/ }).click(); await M.settle(800);
await M.page.getByRole("button", { name: /^Print transcript/ }).click(); await M.settle(600);
const printed = await M.page.evaluate(() => document.getElementById("print-frame")?.contentDocument?.body?.innerText || "");
fs.writeFileSync(`${SCR}/printed.txt`, printed);
check("printable radio log", /Working fire radio transcript/.test(printed) && /Radio log/.test(printed) && /100 Example Ave/.test(printed) && /Engine 61 has command\. \*/.test(printed) && /Machine transcription/.test(printed), printed.slice(0, 300));
await M.page.screenshot({ path: "/home/claude/testrun/shot-transcript.png" });
// Queue protection
check("transcript of a missing recording → 404", (await M.post(`/api/recordings/00000000-0000-4000-8000-000000000000/transcribe`, {})).status === 404);

// ======================= Apparatus =======================
const F = await person(); await F.login("fred@sgfd.org");
check("Fred can't edit the apparatus list", (await F.post("/api/apparatus", { unit: "EG999" })).status === 403);
await M.post("/api/access/grants", { section: "training", level: "manage", userId: uid("Tara Trainer"), scope: "all" });
const T = await person(); await T.login("tara@sgfd.org");
await T.nav("Training"); await T.nav("Apparatus");
await T.page.getByLabel("Apparatus list").fill("EG613, LD618, SQ605\nMD687, EG623");
await T.page.getByRole("button", { name: "Add these" }).click(); await T.settle(700);
let app = (await T.api("/api/apparatus")).body.apparatus;
check("bulk add guesses types and stations", app.length === 5 && app.find(a => a.unit === "LD618").kind === "Ladder" && app.find(a => a.unit === "MD687").kind === "Medic" && app.find(a => a.unit === "EG613").station === "61", JSON.stringify(app.map(a => [a.unit, a.kind, a.station])));
check("duplicate unit refused", (await T.post("/api/apparatus", { unit: "eg613", kind: "Engine" })).status === 400);
const eg623 = app.find(a => a.unit === "EG623");
await T.post("/api/apparatus", { ...eg623, status: "out_of_service", notes: "In the shop" });
const A = id => app.find(a => a.unit === id).id;

// ======================= Bookings from the form =======================
const fac = (await F.api("/api/forms/definitions")).body;
const defs = fac?.definitions || fac?.forms || [];
const def = (Array.isArray(defs) ? defs : []).find(d => d.key === "facility_request");
check("facility form upgraded to start/end times + booking", def && def.fields.some(f => f.key === "start_time" && f.type === "time") && !def.fields.some(f => f.key === "times") && def.settings.booking?.rooms === "facilities", JSON.stringify(Object.keys(fac || {})));
const formData = (o = {}) => ({ name: "Fred Floor", email: "fred@sgfd.org", division: "Suppression", phone: "225-555-0100", start_date: TOM, end_date: D2, start_time: "08:00", end_time: "12:00",
  after_hours: "No", purpose: "EMT refresher", attendees: 20, facilities: ["Classroom 1 Training Center", "Drill Field"], second_choice: "Classroom 2 Training Center",
  classroom_needs: ["Projector"], affects_staff: "No", overtime: "No", truck_rotation: "Yes", ...o });
// The form shows availability as you fill it in
await F.nav("Forms"); await F.page.getByText("Facility & Resource Request").first().click(); await F.settle(800);
await F.page.getByLabel(/^Start date/).fill(TOM); await F.page.getByLabel(/^End date/).fill(TOM);
await F.page.getByLabel(/^Start time/).fill("08:00"); await F.page.getByLabel(/^End time/).fill("12:00");
await F.page.getByRole("checkbox", { name: "Classroom 1 Training Center" }).check(); await F.settle(900);
check("form shows the room is free", /Classroom 1 Training Center is free then/.test(await F.body()));
let r = await F.post("/api/forms/submit", { formKey: "facility_request", data: formData() });
check("submitting the form books the rooms", r.status === 200 && psql(`SELECT count(*) FROM bookings WHERE submission_id = '${r.body.id}' AND status = 'requested'`) === "4", JSON.stringify(r.body));
const sub1 = r.body.id;
// The open form now shows it's taken
await F.page.getByLabel(/^Start time/).fill("09:00"); await F.settle(900);
let fb = await F.body();
check("form shows a conflict", /Already booked:/.test(fb) && /EMT refresher/.test(fb), fb.slice(fb.indexOf("Room availability"), fb.indexOf("Room availability") + 300));
const G = await person(); await G.login("gina@sgfd.org");
r = await G.post("/api/forms/submit", { formKey: "facility_request", data: formData({ name: "Gina Gray", email: "gina@sgfd.org", start_date: TOM, end_date: TOM, start_time: "11:00", end_time: "13:00", purpose: "Officer meeting", facilities: ["Classroom 1 Training Center"] }) });
check("double booking refused with the second choice suggested", r.status === 409 && /Classroom 1 Training Center/.test(r.body.error) && /second choice, Classroom 2 Training Center, is free/.test(r.body.error), r.body?.error);
check("refused form isn't saved", psql("SELECT count(*) FROM form_submissions WHERE form_key = 'facility_request'") === "1");
r = await G.post("/api/forms/submit", { formKey: "facility_request", data: formData({ name: "Gina Gray", email: "gina@sgfd.org", start_date: TOM, end_date: TOM, start_time: "12:00", end_time: "13:00", purpose: "Officer meeting", facilities: ["Classroom 1 Training Center"], truck_rotation: "No" }) });
check("back-to-back booking (12:00 after 08-12) is fine", r.status === 200);
const sub2 = r.body.id;
r = await G.post("/api/forms/submit", { formKey: "facility_request", data: formData({ facilities: ["Apparatus"], apparatus_explain: "E61 for a demo", truck_rotation: "No", start_date: TOM, end_date: TOM }) });
check("equipment-only request doesn't book a room", r.status === 200 && psql(`SELECT count(*) FROM bookings WHERE submission_id = '${r.body.id}'`) === "0");
check("end before start refused", (await G.post("/api/forms/submit", { formKey: "facility_request", data: formData({ start_time: "13:00", end_time: "09:00", facilities: ["Pavilion"] }) })).status === 400);

// Form handlers approve / mark not available -> bookings follow
await M.post(`/api/forms/submissions/${sub1}/stage`, { stage: "Approved" });
check("form Approved -> bookings approved", psql(`SELECT string_agg(DISTINCT status, ',') FROM bookings WHERE submission_id = '${sub1}'`) === "approved");
await M.post(`/api/forms/submissions/${sub2}/stage`, { stage: "Not available" });
check("form Not available -> room released", psql(`SELECT status FROM bookings WHERE submission_id = '${sub2}'`) === "cancelled"
  && (await F.api(`/api/bookings/check?rooms=Classroom 1 Training Center&from=${TOM}&to=${TOM}&start=12:00&end=13:00`)).body.conflicts.length === 0);

// ======================= Rotations (Fred: his own booking) =======================
await F.nav("Main menu").catch(() => {});
await F.page.goto(BASE); await F.settle(800);
await F.nav("Training"); await F.nav("Classroom bookings");
check("bookings page lists the class", /EMT refresher/.test(await F.body()) && /Truck rotation needed, not assigned yet/.test(await F.body()));
check("Fred can't approve (no Approve button / 403)", await F.page.getByRole("button", { name: "Approve" }).count() === 0
  && (await F.post(`/api/bookings/requests/${psql(`SELECT request_id FROM bookings WHERE submission_id = '${sub1}' LIMIT 1`)}/cancel`, {})).status === 403);
await F.page.getByRole("button", { name: "Rotations" }).first().click(); await F.settle(500);
await F.page.getByLabel("Rotation 1 end").fill("10:00");
for (const u of ["EG613", "LD618"]) await F.page.getByRole("group", { name: "Rotation 1 apparatus" }).getByText(u, { exact: true }).click();
check("out-of-service unit isn't offered", await F.page.getByRole("group", { name: "Rotation 1 apparatus" }).getByText("EG623").count() === 0);
await F.page.getByRole("button", { name: "Next rotation" }).click();
for (const u of ["SQ605"]) await F.page.getByRole("group", { name: "Rotation 2 apparatus" }).getByText(u, { exact: true }).click();
await F.page.getByRole("button", { name: "Save rotations" }).click(); await F.settle(700);
const req1 = psql(`SELECT request_id FROM bookings WHERE submission_id = '${sub1}' LIMIT 1`);
check("rotations saved (times follow on)", psql(`SELECT string_agg(seq || ':' || to_char(start_time,'HH24MI') || '-' || to_char(end_time,'HH24MI') || ':' || jsonb_array_length(apparatus), ',' ORDER BY seq) FROM booking_rotations WHERE request_id = '${req1}'`) === "1:0800-1000:2,2:1000-1200:1");
fb = await F.body();
check("bookings page shows the rotations", /Rotation 1 0800–1000: EG613, LD618/.test(fb) && /Rotation 2 1000–1200: SQ605/.test(fb), fb.slice(0, 200));
// Tara books directly at an overlapping time on another room and puts EG613 in a rotation: warned
await T.nav("Classroom bookings");
await T.page.getByRole("button", { name: "Book a room" }).click();
await T.page.getByLabel("Class or event").fill("Pump ops drill");
await T.page.getByLabel("First day", { exact: true }).fill(TOM); await T.page.getByLabel("Start", { exact: true }).fill("09:00"); await T.page.getByLabel("End", { exact: true }).fill("11:00");
await T.page.getByRole("group", { name: "Rooms" }).getByText("Pump Pit", { exact: true }).click();
await T.page.getByRole("button", { name: "Book", exact: true }).click(); await T.settle(700);
const req2 = psql("SELECT request_id FROM bookings WHERE title = 'Pump ops drill'");
check("direct booking is approved right away", psql(`SELECT status FROM bookings WHERE request_id = '${req2}'`) === "approved");
r = await T.post(`/api/bookings/requests/${req2}/rotations`, { rotations: [{ start: "09:00", end: "11:00", apparatus: [A("EG613")] }] });
check("unit already in another class's rotation: warning", r.status === 200 && r.body.warnings.length === 1 && /EG613 also in "EMT refresher"/.test(r.body.warnings[0]), JSON.stringify(r.body));
check("direct booking can't overlap", (await T.post("/api/bookings", { rooms: ["Pump Pit"], from: TOM, start: "10:30", end: "12:00", title: "x" })).status === 409);
check("rotation with no apparatus refused", (await T.post(`/api/bookings/requests/${req2}/rotations`, { rotations: [{ start: "09:00", end: "10:00", apparatus: [] }] })).status === 400);
// Cancel + restore
await T.post(`/api/bookings/requests/${req2}/cancel`, { reason: "Weather" });
check("cancel tells the contact (if someone else) and frees the room", psql(`SELECT string_agg(DISTINCT status, ',') FROM bookings WHERE request_id = '${req2}'`) === "cancelled");
await T.post(`/api/bookings/requests/${req2}/approve`, {});
check("restore re-checks and approves", psql(`SELECT string_agg(DISTINCT status, ',') FROM bookings WHERE request_id = '${req2}'`) === "approved");
check("bookings audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Bookings'")) >= 4);

// Your Day widget (move the class to today)
psql(`UPDATE bookings SET day = day - 1 WHERE request_id = '${req1}'`);
await F.page.goto(BASE); await F.settle(1200);
fb = await F.body();
check("Your Day: Classroom bookings widget with rotations", /Classroom bookings/i.test(fb) && /EMT refresher/.test(fb) && /R1 0800: EG613, LD618/.test(fb) && /Classroom 1 Training Center/.test(fb), fb.slice(fb.search(/Classroom bookings/i), fb.search(/Classroom bookings/i) + 300));
await F.page.screenshot({ path: "/home/claude/testrun/shot-bookings-widget.png" });
await F.page.getByRole("button", { name: /^EMT refresher|^0800/ }).first().click().catch(async () => { await F.page.getByText("EMT refresher").first().click(); });
await F.settle(800);
check("widget opens Classroom bookings", /Rooms are requested with the/.test(await F.body()));
await F.page.screenshot({ path: "/home/claude/testrun/shot-bookings.png" });

// ======================= Training =======================
await T.nav("Requirements & settings");
await T.page.getByLabel("Content list file").setInputFiles(`${SCR}/cert/cert.xlsx`); await T.settle(1500);
check("content list loaded", Number(psql("SELECT count(*) FROM training_content")) > 1300 && /content titles/.test(await T.body()), psql("SELECT count(*) FROM training_content"));
await T.nav("Import from FireWorks");
await T.page.getByLabel("FireWorks training file").setInputFiles("/home/claude/testrun/training-export.xlsx");
await T.page.getByRole("button", { name: "Check the file" }).click(); await T.settle(900);
let tb = await T.body();
check("import preview", /13 rows for 4 people/.test(tb) && /12 new/.test(tb) && /Categories: .*Officer Training/.test(tb) && /1 rows skipped/.test(tb) && /Hank Hill/.test(tb) && /matched to the content list/.test(tb), tb.slice(tb.indexOf("What's in the file"), tb.indexOf("What's in the file") + 600));
await T.page.getByRole("button", { name: /^Import 12 rows/ }).click(); await T.settle(900);
check("imported", psql("SELECT count(*) FROM training_records") === "12" && psql("SELECT count(*) FROM training_records WHERE user_id IS NULL") === "1");
check("content list fills in certification/subject", psql("SELECT certification || '|' || category FROM training_records WHERE topic = 'Aircraft Familiarization'") === "01 PIAL - Firefighter/Operator|Company");
check("'Last, First' + employee number matched", psql(`SELECT count(*) FROM training_records WHERE user_id = '${uid("Fred Floor")}'`) === "8");
r = await T.post("/api/training/import", { fileName: "training-export.xlsx", data: fs.readFileSync("/home/claude/testrun/training-export.xlsx").toString("base64"), preview: true });
check("re-import adds nothing", r.body.preview.newRows === 0 && r.body.preview.duplicates === 13);

// Fred's own training
await F.page.goto(BASE); await F.settle(800); await F.nav("Training");
const me = (await F.api("/api/training")).body.me;
const rq = id => me.requirements.find(x => x.id === id);
check("company: Jan 20 capped to 16, + Feb drill 4, + Mar 2, + Apr 3 (subject wins over category) + Apr 2 (category Rescue)", rq("iso-company").done === 27 && rq("iso-company").required === 192, JSON.stringify(rq("iso-company")));
check("facility drill counts as facility (and company)", rq("iso-facility").done === 4);
check("driver requirement applies to Engineer; officer doesn't", !!rq("iso-driver") && !rq("iso-officer"));
check("state ethics met", rq("la-ethics").missing === 0 && rq("la-harassment").missing === 1);
check("EMS requirements only for people with that certification", !me.requirements.some(x => x.group === "EMS"));
fb = await F.body();
check("My training page", /Company training/.test(fb) && /27 of 192 h/.test(fb) && /Advance Fire Suppression/.test(fb) && !/Today's crew/.test(fb));
await F.page.screenshot({ path: "/home/claude/testrun/shot-training-mine.png", fullPage: true });
check("Fred can't see the crew or import", (await F.api("/api/training/crew")).status === 403 && (await F.post("/api/training/import", { fileName: "x.csv", data: "" })).status === 403
  && (await F.api(`/api/training/person?user=${uid("Gina Gray")}`)).status === 403);
const gina = (await G.api("/api/training")).body.me;
check("Gina (Captain): officer + EMT (holder) requirements", gina.requirements.find(x => x.id === "iso-officer")?.done === 10 && gina.requirements.find(x => x.id === "ems-emt")?.done === 10 && !gina.requirements.find(x => x.id === "iso-driver"));

// Chief: today's crew from Aladtec
const C = await person(); await C.login("cole@sgfd.org");
await C.nav("Training"); await C.nav("Today's crew"); await C.settle(800);
const crew = (await C.api("/api/training/crew")).body;
check("crew: today's shift A-Z by last name, time off left out", crew.configured && crew.crew.map(p => p.name).join(",") === "Cole Chief,Fred Floor,Gina Gray,Hank Hill", crew.crew.map(p => p.name).join(","));
check("crew member without an account shows FireWorks hours by name", crew.crew.find(p => p.name === "Hank Hill").totalHours === 5 && crew.crew.find(p => p.name === "Hank Hill").userId === null);
let cb = await C.body();
check("crew page shows what's missing", /Company training −165/.test(cb) && /Hank Hill/.test(cb) && /no Nexus account/.test(cb) && !/Ryan Off/.test(cb), cb.slice(0, 600));
await C.page.screenshot({ path: "/home/claude/testrun/shot-training-crew.png", fullPage: true });
await C.page.getByText("Gina Gray").first().click(); await C.settle(700);
check("click a person: their requirements and classes", /Officer development/.test(await C.body()) && /Application of Leadership/.test(await C.body()));
check("chief can't enter hours", (await C.post("/api/training/records", { userIds: [uid("Fred Floor")], day: TODAY, hours: 2, topic: "x" })).status === 403);

// Enter hours by hand (Tara)
await T.nav("Enter hours");
await T.page.getByLabel("Find a class").fill("hazmat ops");
await T.settle(600);
const pick = T.page.getByRole("button", { name: /Hazmat/ }).first();
const hasPick = await pick.count();
if (hasPick) await pick.click();
await T.page.getByLabel("Attendees").selectOption(uid("Fred Floor"));
await T.page.getByLabel("Attendees").selectOption(uid("Gina Gray"));
await T.page.getByLabel("Hours", { exact: true }).fill("3");
if (!hasPick) { await T.page.getByLabel("Class", { exact: true }).fill("Hazmat ops refresher"); await T.page.getByLabel("Subject", { exact: true }).fill("Hazmat"); }
await T.page.getByRole("button", { name: "Save hours" }).click(); await T.settle(700);
check("hand entry for several people", /Saved for 2 people/.test(await T.body()) && psql("SELECT count(*) FROM training_records WHERE source = 'manual'") === "2", await T.body().then(b => b.slice(0, 200)));
const fh = (await F.api("/api/training")).body.me.requirements.find(x => x.id === "iso-hazmat");
check("hazmat hours count (3 imported + 3 entered)", fh.done === 6, JSON.stringify(fh));

// FireWorks category list + changing a category's credit
await T.nav("Requirements & settings");
await T.page.getByLabel("Category list file").setInputFiles(`${SCR}/cert/cats.xlsx`); await T.settle(1200);
let sb = await T.body();
check("category list loaded (archived hidden unless used)", /Loaded 25 categories/.test(sb) || /Rescue\(Non-Fire\)/.test(sb));
const cats = (await T.api("/api/training")).body.categories;
check("category defaults", cats.find(c => c.name === "Officer Training")?.kind === "officer" && cats.find(c => c.name === "Medical Training")?.kind === "other"
  && cats.find(c => c.name === "Fire-Fighting Evolutions (Practicals)")?.kind === "facility" && cats.find(c => c.name === "Hazardous Materials")?.kind === "hazmat", JSON.stringify(cats.slice(0, 6)));
await T.page.getByLabel("Credit for Rescue(Non-Fire)").selectOption("other");
await T.page.getByRole("button", { name: "Save category credit" }).click(); await T.settle(700);
check("changing a category's credit changes the count", (await F.api("/api/training")).body.me.requirements.find(x => x.id === "iso-company").done === 25);
await T.page.screenshot({ path: "/home/claude/testrun/shot-training-settings.png", fullPage: true });

// Settings validation + saving a department requirement
const st = (await T.api("/api/training")).body;
check("bad pattern refused", (await T.post("/api/training/settings", { requirements: [...st.requirements, { label: "X", hours: 2, titles: "([" }] })).status === 400);
r = await T.post("/api/training/settings", { requirements: [...st.requirements, { label: "SCBA confidence", group: "Department", hours: 4, period: "year", counts: "scba, air pack" }] });
check("department requirement saved and applied", r.status === 200 && (await F.api("/api/training")).body.me.requirements.some(x => x.label === "SCBA confidence" && x.missing === 4));
check("training audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Training'")) >= 4);

// Section shows for everyone
check("Training tile for everyone", /Training/.test(await G.body()));
check("no page errors", errors.length === 0, errors.join(" | "));
done();
mock.close();
await browser.close();
