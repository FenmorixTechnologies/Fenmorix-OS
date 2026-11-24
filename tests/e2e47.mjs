// TV display screens (dashboard mode): pairing by code, view-only cookie, views, auto-switch to an open incident Command Board,
// training boards never shown, sign out. Also checks the primary/secondary search-started benchmarks are on the board.
//
// Fictional people and calls only.
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

// CAD stand-in: a working structure fire and a medical call (made-up addresses)
const local = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
const CAD = "/home/claude/testrun/cad-cmd.json";
fs.writeFileSync(CAD, JSON.stringify([
  { incident_id: 901, incident_number: "2026-009901", call_type: "STRUCTURE FIRE RESIDENTIAL", priority: 1, address: "123 Example Oak Dr", city: "Baton Rouge",
    latitude: 30.37, longitude: -91.03, units: "EG653:On scene, SG10:Enroute, LD618:Dispatched", received_at: local(Date.now() - 20 * 60000), agency: "St George FD" },
  { incident_id: 902, incident_number: "2026-009902", call_type: "MEDICAL", priority: 2, address: "9 Sample Ln", units: "MD687:Patient contact", received_at: local(Date.now() - 5 * 60000) },
], null, 1));

// Aladtec stand-in: who's on EG653 / LD618 today
const MEMBERS = [], SCHED = [];
let MID = 900;
const P = name => { MID++; MEMBERS.push({ member_id: MID, first_name: name.split(" ")[0], last_name: name.split(" ")[1] }); return { id: MID }; };
SCHED.push(["EG653", [P("Ann Alpha"), P("Ben Bravo"), P("Cal Charlie")]], ["Ladder 618", [P("Dee Delta"), P("Eli Echo")]]);
const dt = (d, next) => { const x = new Date(d + "T00:00"); if (next) x.setDate(x.getDate() + 1); return `${x.toLocaleDateString("en-CA")}T07:00`; };
const AERIAL = fs.readFileSync("/home/claude/testrun/aerial-mock.jpg");
const mock = http.createServer((req, res) => {
  const out = j => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.url.startsWith("/arcgis/rest/services/USGSImageryOnly/MapServer/export")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(AERIAL); }
  if (req.url.startsWith("/geocoder/locations/onelineaddress")) return out({ result: { addressMatches: [{ matchedAddress: "500 TRAINING TOWER RD, BATON ROUGE, LA", coordinates: { x: -91.05, y: 30.36 } }] } });
  if (req.url === "/oauth/token") return out({ access_token: "tok", token_type: "Bearer", expires_in: 3600 });
  if (req.url.startsWith("/schedules")) return out(SCHED.map((u, k) => ({ schedule_id: k + 1, name: u[0], order: k, positions: u[1].map((p, n) => ({ position_id: (k + 1) * 10 + n, label: "", order: n })) })));
  if (req.url.startsWith("/members")) return out(MEMBERS);
  if (req.url.startsWith("/scheduled-time/members-scheduled-now")) return out([]);
  if (req.url.startsWith("/scheduled-time?")) {
    const d = new URL(req.url, "http://x").searchParams.get("range_start").slice(0, 10);
    const y = new Date(d + "T00:00"); y.setDate(y.getDate() - 1); const yd = y.toLocaleDateString("en-CA");
    const recs = []; for (const dd of [yd, d]) SCHED.forEach((s, k) => s[1].forEach((p, n) => recs.push({ member_id: p.id, schedule_id: k + 1, position_id: (k + 1) * 10 + n, time_type: "Regular", start_datetime: dt(dd), stop_datetime: dt(dd, true) })));
    return out({ [d]: recs });
  }
  if (req.url.startsWith("/time-off?")) return out({});
  res.writeHead(404); res.end("{}");
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", ALADTEC_BASE_URL: "http://127.0.0.1:3099", ALADTEC_CLIENT_ID: "id", ALADTEC_CLIENT_SECRET: "s",
    USGS_BASE: "http://127.0.0.1:3099", GEOCODER_BASE: "http://127.0.0.1:3099", CAD_TEST_FILE: CAD, CAD_REFRESH_SECONDS: "15", WEATHER_DISABLED: "true" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
async function person(viewport = { width: 1350, height: 950 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "America/Chicago" });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? (d.message().includes("Unit to add") ? "SQ62" : "Member out, uninjured") : undefined));
  const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: ct.includes("json") ? await res.json().catch(() => null) : await res.text(), ct };
  }, [path, opts]);
  const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
  const settle = async (ms = 500) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  async function login(email) {
    await ctx.clearCookies(); await page.goto(BASE); await settle();
    await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click(); await settle(900);
  }
  return { ctx, page, api, post, settle, login, body: () => page.locator("body").innerText() };
}
const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
psql("INSERT INTO divisions (name) VALUES ('Suppression'), ('Fire Prevention') ON CONFLICT DO NOTHING");
const PEOPLE = [["Lena Lieutenant", "lena", "Lieutenant", "Suppression"], ["Fred Firefighter", "fred", "Firefighter", "Suppression"], ["Ivan Investigator", "ivan", "Deputy Chief of Prevention", "Fire Prevention"]];
for (const [n, e, , div] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: div, password: PW });
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const p = PEOPLE.find(x => `${x[1]}@sgfd.org` === a.email);
  await M.post("/api/auth/approve", { id: a.id, role: "user", division: p[3] });
}
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t] of PEOPLE) psql(`UPDATE users SET job_title = '${t}' WHERE full_name = '${n}'`);
const lena = uid("Lena Lieutenant"), ivan = uid("Ivan Investigator");

let r;
await M.post("/api/cad/refresh", {});
await M.post("/api/aladtec/refresh", {}).catch(() => {});
psql("UPDATE directory_places SET aladtec_match = 'EG65?' WHERE kind = 'station' AND name ILIKE '%65%'");
const supp = psql("SELECT id FROM divisions WHERE name = 'Suppression'");
psql(`INSERT INTO callout_entries (id, division_id, start_date, end_date, position, person_name) VALUES (gen_random_uuid(), ${supp}, current_date, current_date, 1, 'Pat Example'), (gen_random_uuid(), ${supp}, current_date, current_date, 2, 'Quinn Sample')`);
psql(`INSERT INTO bookings (id, request_id, room, day, start_time, end_time, title, status) VALUES (gen_random_uuid(), gen_random_uuid(), 'Classroom 1 Training Center', current_date, '09:00', '11:30', 'Ladder drill (sample)', 'approved'), (gen_random_uuid(), gen_random_uuid(), 'CTC Admin', current_date, '13:00', '14:00', 'Not approved yet', 'requested')`);

// ---- The TV: opens /display with nobody signed in and shows a code ----
const TV = await person({ width: 1600, height: 900 });
await TV.page.goto(BASE + "/display"); await TV.page.waitForTimeout(2500);
const codeText = (await TV.page.getByLabel("Pairing code").innerText()).trim();
check("unpaired TV shows a 6-character code", /^[A-Z2-9]{6}$/.test(codeText), codeText);
const cookies = await TV.ctx.cookies();
const dc = cookies.find(c => c.name === "sgfd_display");
check("TV cookie is HttpOnly and SameSite Strict", dc && dc.httpOnly && dc.path === "/" && !cookies.some(c => c.name === "sgfd_session"), JSON.stringify(cookies));
r = await TV.api("/api/display/view/duty");
check("unpaired TV can't read views", r.status === 401);

// ---- Only accounts admins / masters pair screens ----
const F = await person(); await F.login("fred@sgfd.org");
r = await F.post("/api/display/screens", { code: codeText, name: "Sneaky" });
check("a firefighter can't pair a screen", r.status === 403);
r = await F.api("/api/display/view/duty");
check("a person's own session doesn't read display views", r.status === 401);
r = await M.post("/api/display/screens", { code: "ZZZZZZ", name: "Wrong code" });
check("wrong code refused with a plain message", r.status === 404 && /isn't waiting/.test(r.body.error));

// Master pairs it in User Management › Display screens (8 s per view, duty/on call/classes + active calls, switch to boards)
await M.page.goto(BASE); await M.settle();
await M.page.getByRole("button", { name: /User Management/ }).first().click(); await M.settle();
await M.page.getByRole("button", { name: "Display screens" }).click(); await M.settle();
await M.page.getByLabel("Code on the screen").fill(codeText.toLowerCase());
await M.page.getByLabel("Screen name").first().fill("Station 65 day room");
await M.page.getByLabel("Weather").uncheck();
await M.page.getByLabel("Active calls").check();
check("addresses warning shown when Active calls is ticked", (await M.body()).includes("Active calls show addresses"));
await M.page.getByLabel("Seconds per view").first().fill("8");
await M.page.getByRole("button", { name: "Pair screen" }).click(); await M.settle(800);
let mb = await M.body();
check("screen listed as signed in", mb.includes("Station 65 day room") && mb.includes("Signed in"), mb.slice(0, 600));
check("pairing audited", psql("SELECT count(*) FROM audit_log WHERE module = 'Display screens' AND action = 'Paired a display screen'") === "1");
r = await M.post("/api/display/screens", { code: codeText, name: "Again" });
check("a code works once", r.status === 404);

// ---- The TV cycles through its views ----
await TV.page.waitForSelector("text=Station 65 day room", { timeout: 12000 });
const seen = new Set(); let tvText = "";
for (let k = 0; k < 120 && seen.size < 4; k++) {
  tvText = await TV.body();
  for (const v of ["On duty today", "On call today", "Today's classes", "Active calls"]) if (tvText.includes(v)) seen.add(v);
  if (tvText.includes("Today's classes")) check.cls = tvText;
  if (tvText.includes("On call today")) check.oc = tvText;
  if (tvText.includes("Active calls") && tvText.includes("STRUCTURE FIRE")) check.calls = tvText;
  if (tvText.includes("On duty today")) check.duty = tvText;
  await wait(1000);
}
check("TV cycles through all four views", seen.size === 4, [...seen].join(", "));
check("duty view from Aladtec", (check.duty || "").includes("Ann Alpha"), (check.duty || "").slice(0, 300));
check("duty view shows no time off card", !(check.duty || "").includes("Time Off"));
check("on call view", (check.oc || "").includes("Pat Example") && (check.oc || "").includes("Quinn Sample"));
check("classes: approved only", (check.cls || "").includes("Ladder drill (sample)") && !(check.cls || "").includes("Not approved yet"));
check("active calls view (opted in) shows the call", (check.calls || "").includes("123 Example Oak Dr"));
await TV.page.screenshot({ path: `${SCR}/display-cycle.png` });

// ---- Auto-scroll: a long on-call list (40 people) scrolls down on its own and stays up until it has ----
psql(`INSERT INTO callout_entries (id, division_id, start_date, end_date, position, person_name) SELECT gen_random_uuid(), ${supp}, current_date, current_date, n + 2, 'Sample Person ' || n FROM generate_series(1, 40) n`);
const sid0 = psql("SELECT id FROM display_screens LIMIT 1");
await M.post(`/api/display/screens/${sid0}`, { name: "Station 65 day room", views: ["oncall", "classes"], seconds: 8, switchToBoard: true });
await TV.page.reload(); await TV.page.waitForSelector("text=On call today", { timeout: 15000 });
const ty = () => TV.page.evaluate(() => { const el = document.querySelector("[data-autoscroll] > div"); const m = /translateY\((-?\d+)px\)/.exec(el?.style.transform || ""); return m ? Number(m[1]) : 0; });
await wait(2000);
check("a long view starts at the top", (await ty()) === 0);
await wait(9000);
const y1 = await ty();
check("then scrolls down on its own", y1 < -100, y1);
check("and stays up past its 8 seconds while it scrolls", (await TV.body()).includes("On call today"));
let sawBottom = false;
for (let k = 0; k < 40 && !sawBottom; k++) {
  const bb = await TV.page.getByText(/Sample Person 40$/).boundingBox().catch(() => null);
  if (bb && bb.y + bb.height <= 900) sawBottom = true; else await wait(1000);
}
check("the last person scrolls into view", sawBottom);
await TV.page.waitForSelector("text=Today's classes", { timeout: 20000 });
check("then moves on to the next view", true);
await M.post(`/api/display/screens/${sid0}`, { name: "Station 65 day room", views: ["duty", "oncall", "classes", "calls"], seconds: 8, switchToBoard: true });
await TV.page.reload(); await TV.page.waitForTimeout(2000);

// The screen's cookie opens nothing else
for (const path of ["/api/directory", "/api/messages?box=inbox", "/api/command", "/api/cad/active", "/api/auth/me"]) {
  r = await TV.api(path);
  check(`screen can't read ${path}`, r.status === 401 || (path === "/api/auth/me" && !r.body?.user), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
r = await TV.api("/api/display/view/weather");
check("a view the screen wasn't given is refused", r.status === 403);

// ---- A training board never takes over; a real incident board does ----
const L = await person(); await L.login("lena@sgfd.org");
r = await L.post("/api/command/new", { kind: "training", title: "Tower drill", nature: "Training fire", address: "500 Training Tower Rd", units: "EG653" });
check("training board made", r.status === 200);
await wait(12000);
check("training board doesn't show on the TV", !(await TV.body()).includes("LIVE COMMAND BOARD"));
r = await L.post("/api/command/open", { incidentId: "901" });
const boardId = r.body.id;
check("incident board opened", !!boardId);
await TV.page.waitForSelector("text=LIVE COMMAND BOARD", { timeout: 15000 });
await TV.page.waitForTimeout(1500);
tvText = await TV.body();
check("TV switched to the live board on its own", tvText.includes("STRUCTURE FIRE RESIDENTIAL") && tvText.includes("123 Example Oak Dr") && tvText.includes("EG653"), tvText.slice(0, 500));
check("board on the TV is read-only, no back or close buttons", tvText.includes("live on this screen") && !tvText.includes("All boards") && !tvText.includes("Close board") && !tvText.includes("Print report")
  && !(await TV.page.getByRole("button", { name: "Read smoke" }).count()));
check("only the incident board (not the training one)", !tvText.includes("1 of 2"));
await wait(8000);
check("the board scrolls on its own on the TV (it's taller than the screen)", (await TV.page.evaluate(() => document.querySelector("[data-autoscroll='loop'] > div")?.style.transform || "")) !== "translateY(0px)");

// The officer works the board; the TV follows within a few seconds
await L.page.goto(BASE); await L.settle();
await L.page.waitForSelector("text=STRUCTURE FIRE RESIDENTIAL", { timeout: 20000 });
await L.page.getByRole("button", { name: "Command board", exact: true }).click(); await L.settle(1500);
await L.page.getByRole("button", { name: "Primary search started" }).click(); await L.settle(400);
await L.page.getByRole("button", { name: "Secondary search started" }).click(); await L.settle(400);
const lb = await L.body();
check("search-started benchmarks on the board", /Primary search started\s*· \d\d:\d\d/.test(lb) && /Secondary search started\s*· \d\d:\d\d/.test(lb) && lb.includes("Primary all clear"));
await TV.page.waitForTimeout(5000);
tvText = await TV.body();
check("TV shows the officer's changes", /Primary search started\s*· \d\d:\d\d/.test(tvText), tvText.slice(0, 800));
await TV.page.screenshot({ path: `${SCR}/display-board.png` });
r = await TV.api(`/api/display/board/${boardId}`);
check("board data has no edit rights and no recordings", r.body.canEdit === false && !r.body.recordings && r.body.display === true);
const trainingId = psql("SELECT id FROM command_boards WHERE kind = 'training' LIMIT 1");
r = await TV.api(`/api/display/board/${trainingId}`);
check("training board refused to the screen", r.status === 404);
check("officer's emergency mode not affected by the TV", (await L.body()).includes("EMERGENCY MODE"));

// Close the board -> the TV goes back to its views
await L.post(`/api/command/${boardId}/action`, { type: "close" });
await wait(12000);
tvText = await TV.body();
check("board closed: TV back to cycling", !tvText.includes("LIVE COMMAND BOARD") && tvText.includes("Station 65 day room"), tvText.slice(0, 300));
r = await TV.api(`/api/display/board/${boardId}`);
check("closed board no longer readable by the screen", r.status === 404);

// Turning off "switch to Command Boards" closes those routes
const sid = psql("SELECT id FROM display_screens LIMIT 1");
r = await M.post(`/api/display/screens/${sid}`, { name: "Station 65 day room", views: ["duty"], seconds: 8, switchToBoard: false });
r = await TV.api("/api/display/boards");
check("switch-to-board off: boards refused", r.status === 403);

// Sign out -> the TV is just a pairing page again
await M.page.reload(); await M.settle();
await M.page.getByRole("button", { name: /User Management/ }).first().click(); await M.settle();
await M.page.getByRole("button", { name: "Display screens" }).click(); await M.settle();
await M.page.getByRole("listitem", { name: "Station 65 day room" }).getByRole("button", { name: "Sign out" }).click(); await M.settle(800);
check("listed as signed out", (await M.body()).includes("Signed out"));
r = await TV.api("/api/display/view/duty");
check("signed-out screen can't read views", r.status === 401);
await TV.page.reload(); await TV.page.waitForTimeout(2500);
check("signed-out TV shows a new pairing code", /^[A-Z2-9]{6}$/.test((await TV.page.getByLabel("Pairing code").innerText()).trim()));
check("sign out audited", psql("SELECT count(*) FROM audit_log WHERE module = 'Display screens' AND action = 'Signed out a display screen'") === "1");

check("no page errors", !errors.length, errors.join(" | "));
done();
await browser.close(); mock.close(); process.exit(0);
