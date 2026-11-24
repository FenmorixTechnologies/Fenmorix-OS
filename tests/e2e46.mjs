// Command Board: ride lists on Active calls (Aladtec + directory call sign), the board (accountability, PAR, strategy,
// benchmarks, MAYDAY, smoke, notes, scene with sides, aerial), saves on every change and survives offline / reloads,
// officers edit and others watch, close -> after-action record in the Personnel File and on the working fire recording.
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
const usgsUrls = [];
const AERIAL = fs.readFileSync("/home/claude/testrun/aerial-mock.jpg");
const mock = http.createServer((req, res) => {
  const out = j => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.url.startsWith("/arcgis/rest/services/USGSImageryOnly/MapServer/export")) { usgsUrls.push(req.url); res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(AERIAL); }
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
    USGS_BASE: "http://127.0.0.1:3099", GEOCODER_BASE: "http://127.0.0.1:3099", CAD_TEST_FILE: CAD, CAD_REFRESH_SECONDS: "15" } });
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

// Call sign on the directory card (the master admin sets it like any other card field)
let r = await M.post(`/api/directory/people/${ivan}`, { jobTitle: "Deputy Chief of Prevention", callSign: "sg10 " });
check("call sign saved on the directory card (cleaned up)", psql(`SELECT call_sign FROM users WHERE id = '${ivan}'`) === "SG-10" || psql(`SELECT call_sign FROM users WHERE id = '${ivan}'`) === "SG10", JSON.stringify(r.body).slice(0, 200));
psql(`UPDATE users SET call_sign = 'SG10' WHERE id = '${ivan}'`);
const dir = (await M.api("/api/directory")).body;
check("directory shows the call sign", JSON.stringify(dir).includes('"callSign":"SG10"'));

await M.post("/api/cad/refresh", {});
await M.post("/api/aladtec/refresh", {}).catch(() => {});
await wait(1500);
r = await M.api("/api/command/riders?units=EG653,SG10,LD618,MD687");
check("ride list: Aladtec schedule named for the unit", r.body?.riders?.EG653?.map(x => x.name).join(",") === "Ann Alpha,Ben Bravo,Cal Charlie", JSON.stringify(r.body));
check("ride list: 'Ladder 618' matches LD618", r.body?.riders?.LD618?.length === 2, JSON.stringify(r.body?.riders?.LD618));
check("ride list: SG10 from the directory call sign", r.body?.riders?.SG10?.[0]?.name === "Ivan Investigator" && r.body.riders.SG10[0].source === "directory");
check("ride list: unknown unit is empty", Array.isArray(r.body?.riders?.MD687) && !r.body.riders.MD687.length);

// ---- A firefighter sees the call and the ride lists, but can't open a board ----
const F = await person(); await F.login("fred@sgfd.org");
await F.page.waitForSelector("text=STRUCTURE FIRE RESIDENTIAL", { timeout: 20000 });
await F.settle(1500);
check("SG10 shows who it is on hover", (await F.page.getByRole("button", { name: "SG10 ride list" }).getAttribute("title")) === "Ivan Investigator");
await F.page.getByRole("button", { name: "EG653 ride list" }).click();
const pop = await F.page.getByRole("dialog", { name: "Riding EG653" }).innerText();
check("click EG653: who's riding", pop.includes("Ann Alpha") && pop.includes("Cal Charlie") && pop.includes("Aladtec"), pop);
check("no board button for a firefighter before a board is open", !(await F.body()).includes("Open command board"));
check("no board button on a medical call (Lena checks below)", true);

// ---- Lena (Lieutenant by job title) opens the board from Active calls ----
const L = await person(); await L.login("lena@sgfd.org");
await L.page.waitForSelector("text=Open command board", { timeout: 20000 });
check("one board button: only on the fire call", (await L.page.getByRole("button", { name: "Open command board" }).count()) === 1);
await L.page.getByRole("button", { name: "Open command board" }).click(); await L.settle(1500);
let body = await L.body();
const clk = await L.page.getByLabel("Incident clock").innerText();
check("board opened with the call and a running clock", body.includes("STRUCTURE FIRE RESIDENTIAL") && body.includes("123 Example Oak Dr") && /2\d:\d\d/.test(clk), clk);
check("PAR every 13 minutes in the first hour", /every 13 min/i.test(body));
check("crews from CAD with names", body.includes("EG653") && body.includes("Ann Alpha, Ben Bravo, Cal Charlie") && body.includes("Ivan Investigator"));
const boardId = psql("SELECT id FROM command_boards WHERE incident_id = '901'");
check("board saved", !!boardId);

await L.page.getByRole("group", { name: "Strategy" }).getByRole("button", { name: "OFFENSIVE" }).click(); await L.settle(400);
await L.page.getByRole("group", { name: "Attack" }).getByRole("button", { name: "INTERIOR" }).click(); await L.settle(400);
await L.page.getByRole("button", { name: "EG653 crew" }).click();
await L.page.getByLabel("Assignment").fill("Fire attack, Div 1");
await L.page.getByRole("button", { name: "Save" }).click(); await L.settle(500);
await L.page.getByRole("button", { name: "EG653 crew" }).click();
await L.page.getByRole("dialog").getByRole("button", { name: "Interior" }).click(); await L.settle(600);
body = await L.body();
check("EG653 interior with a time-inside clock", (await L.page.getByLabel("Interior").innerText()).includes("EG653") && /\d:\d\d/.test(await L.page.getByLabel("Interior").innerText()), await L.page.getByLabel("Interior").innerText());
check("in-structure count", body.includes("In the structure: 3"));
await L.page.getByRole("button", { name: "Water on the fire" }).click(); await L.settle(400);
await L.page.getByLabel("Radio note").fill("Div 1: heat building, floor soft near kitchen");
await L.page.getByLabel("Critical").check();
await L.page.getByRole("button", { name: "Log" }).click(); await L.settle(500);
await L.page.getByRole("button", { name: "Read smoke" }).click();
const sm = L.page.getByRole("dialog", { name: "Read smoke" });
await sm.getByRole("group", { name: "Side" }).getByRole("button", { name: "C" }).click();
await sm.getByRole("group", { name: "Volume" }).getByRole("button", { name: "Heavy" }).click();
await sm.getByRole("group", { name: "Velocity" }).getByRole("button", { name: "Turbulent" }).click();
await sm.getByRole("group", { name: "Density" }).getByRole("button", { name: "Black fire" }).click();
await sm.getByRole("button", { name: "Save reading" }).click(); await L.settle(500);
body = await L.body();
check("smoke reading on C side", body.includes("C side: Heavy, Turbulent, Black fire"));
// Floor the smoke shows from: picked, or typed for a higher floor; side + floor are separate readings
await L.page.getByRole("button", { name: "Read smoke" }).click();
const sm2 = L.page.getByRole("dialog", { name: "Read smoke" });
await sm2.getByRole("group", { name: "Side" }).getByRole("button", { name: "C" }).click();
await sm2.getByRole("group", { name: "Floor" }).getByRole("button", { name: "2", exact: true }).click();
await sm2.getByRole("group", { name: "Color" }).getByRole("button", { name: "Gray" }).click();
await sm2.getByRole("button", { name: "Save reading" }).click(); await L.settle(500);
await L.page.getByRole("button", { name: "Read smoke" }).click();
const sm3 = L.page.getByRole("dialog", { name: "Read smoke" });
await sm3.getByRole("group", { name: "Side" }).getByRole("button", { name: "A" }).click();
await sm3.getByLabel("Floor number").fill("12");
await sm3.getByRole("group", { name: "Volume" }).getByRole("button", { name: "Light" }).click();
await sm3.getByRole("button", { name: "Save reading" }).click(); await L.settle(500);
body = await L.body();
check("smoke reading with a picked floor", body.includes("C side, floor 2: Gray") && body.includes("C side: Heavy, Turbulent, Black fire"));
check("smoke reading with a typed higher floor", body.includes("A side, floor 12: Light"));
await L.page.getByRole("button", { name: "Primary search started" }).click(); await L.settle(400);
await L.page.getByRole("button", { name: "Secondary search started" }).click(); await L.settle(400);
body = await L.body();
check("primary and secondary search started are benchmarks with times", /Primary search started\s*· \d\d:\d\d/.test(body) && /Secondary search started\s*· \d\d:\d\d/.test(body)
  && psql("SELECT count(*) FROM command_events WHERE text IN ('Primary search started', 'Secondary search started')") === "2");
const wof = await L.page.getByRole("button", { name: /Water on the fire/ }).innerText();
check("water on fire benchmark has its time", /Water on the fire\s*· \d\d:\d\d/.test(wof), wof);
// MAYDAY
await L.page.getByRole("button", { name: "MAYDAY", exact: true }).click();
await L.page.getByLabel("Mayday unit").selectOption("EG653");
await L.page.getByLabel("Mayday who").fill("Ben Bravo");
await L.page.getByLabel("Mayday location").fill("Floor 1, C/D corner, disoriented");
await L.page.getByRole("button", { name: "Log MAYDAY" }).click(); await L.settle(600);
check("MAYDAY banner with who and where", (await L.page.getByRole("alert").first().innerText()).includes("MAYDAY · Ben Bravo, EG653 · Floor 1, C/D corner"), await L.page.getByRole("alert").first().innerText());
await L.page.screenshot({ path: `${SCR}/shot-command-mayday.png`, fullPage: false });
await L.page.getByRole("button", { name: "MAYDAY cleared" }).click(); await L.settle(600);
check("MAYDAY cleared", !(await L.body()).includes("MAYDAY · Ben Bravo") && psql(`SELECT state->'mayday'->>'note' FROM command_boards WHERE id = '${boardId}'`) === "Member out, uninjured");
// PAR
await L.page.getByRole("button", { name: "Take PAR" }).click();
const parD = L.page.getByRole("dialog", { name: "PAR" });
await parD.getByRole("button", { name: /EG653/ }).click(); await L.settle(400);
await parD.getByRole("button", { name: /SG10/ }).click(); await L.settle(400);
await parD.getByRole("button", { name: "PAR complete" }).click(); await L.settle(600);
check("PAR logged, missing crew in red", psql(`SELECT text || '|' || critical FROM command_events WHERE board_id = '${boardId}' AND kind = 'par_complete'`) === "PAR 1 done; NOT accounted for: LD618|true");
check("PAR timer restarted", (await L.page.getByLabel("PAR timer").innerText()).includes("PAR 2") && /1[23]:\d\d/.test(await L.page.getByLabel("PAR timer").innerText()), await L.page.getByLabel("PAR timer").innerText());
// Offensive -> defensive is critical
await L.page.getByRole("group", { name: "Strategy" }).getByRole("button", { name: "DEFENSIVE" }).click(); await L.settle(500);
check("offensive to defensive logged as critical", psql(`SELECT critical FROM command_events WHERE board_id = '${boardId}' AND text = 'Strategy: OFFENSIVE → DEFENSIVE'`) === "t");

// Scene: place a unit, sides by where it is
await L.page.getByRole("button", { name: "Place on the scene" }).count();
await L.page.locator("button", { hasText: /^LD618$/ }).click();
await L.page.getByRole("img", { name: "Scene view" }).scrollIntoViewIfNeeded();
const box = await L.page.getByRole("img", { name: "Scene view" }).boundingBox();
// building is x 440-840, y 510-770 of 1280; below it is the A side (front faces down)
await L.page.mouse.click(box.x + box.width * (640 / 1280), box.y + box.height * (1000 / 1280)); await L.settle(700);
check("unit placed in front: A side", psql(`SELECT c->>'side' FROM command_boards, jsonb_array_elements(state->'crews') c WHERE id = '${boardId}' AND c->>'unit' = 'LD618'`) === "A side");
r = await L.post(`/api/command/${boardId}/action`, { type: "crew_place", unit: "SG10", x: 300, y: 300 });
check("top-left of the building is the B/C corner", r.body?.state?.crews?.find(c => c.unit === "SG10")?.side === "B/C corner", JSON.stringify(r.body?.state?.crews?.find(c => c.unit === "SG10")));
r = await L.post(`/api/command/${boardId}/action`, { type: "scene", aSide: "left" });
check("turn the A side to face left: same spot is now the A/B corner", r.body?.state?.crews?.find(c => c.unit === "SG10")?.side === "A/B corner" && r.body.state.crews.find(c => c.unit === "LD618").side === "D side");
await L.post(`/api/command/${boardId}/action`, { type: "scene", aSide: "bottom" });
await L.page.getByRole("button", { name: "Get aerial (USGS)" }).click(); await L.settle(1500);
check("aerial from USGS at the call's map point", !!psql(`SELECT state->>'imageId' FROM command_boards WHERE id = '${boardId}'`) && (await L.page.locator("svg[aria-label='Scene view'] image").count()) === 1);
check("aerial asked at 2048 px, 800 ft across by default", /size=2048,2048/.test(usgsUrls.at(-1) || "") && psql(`SELECT round((state->>'imgFtPerPx')::numeric * 2048)::int FROM command_boards WHERE id = '${boardId}'`) === "800", usgsUrls.at(-1));
// Zoom and move around the picture
const vbOf = () => L.page.locator("svg[aria-label='Scene view']").getAttribute("viewBox");
const vb0 = await vbOf();
const placesBefore = psql(`SELECT count(*) FROM command_events WHERE board_id = '${boardId}' AND kind = 'crew_place'`);
await L.page.getByRole("button", { name: "Zoom in" }).click(); await L.page.waitForTimeout(200);
const vb1 = await vbOf();
check("Zoom in narrows the view", Number(vb1.split(" ")[2]) < Number(vb0.split(" ")[2]) * 0.7, `${vb0} -> ${vb1}`);
const sb = await L.page.getByRole("img", { name: "Scene view" }).boundingBox();
await L.page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5); await L.page.mouse.down();
await L.page.mouse.move(sb.x + sb.width * 0.3, sb.y + sb.height * 0.35, { steps: 6 }); await L.page.mouse.up(); await L.page.waitForTimeout(200);
const vb2 = await vbOf();
check("drag moves around the picture", vb2 !== vb1 && Number(vb2.split(" ")[0]) > Number(vb1.split(" ")[0]), `${vb1} -> ${vb2}`);
await L.page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height * 0.5); await L.page.mouse.wheel(0, -300); await L.page.waitForTimeout(300);
check("scroll wheel zooms", Number((await vbOf()).split(" ")[2]) < Number(vb2.split(" ")[2]));
check("a drag doesn't place or change anything", psql(`SELECT count(*) FROM command_events WHERE board_id = '${boardId}' AND kind = 'crew_place'`) === placesBefore);
await L.page.getByRole("button", { name: "Fit" }).click(); await L.page.waitForTimeout(200);
check("Fit shows the whole picture", (await vbOf()) === vb0);
// Re-center on a point to the right of the middle -> a new aerial centered further east
const lat0 = Number(psql(`SELECT state->>'imgLon' FROM command_boards WHERE id = '${boardId}'`));
await L.page.getByRole("button", { name: "Re-center here" }).click();
await L.page.mouse.click(sb.x + sb.width * 0.75, sb.y + sb.height * 0.5); await L.settle(1500);
const lon1 = Number(psql(`SELECT state->>'imgLon' FROM command_boards WHERE id = '${boardId}'`));
// where that click lands on the picture (the square picture is letterboxed inside the box)
const disp = Math.min(sb.width, sb.height), offX = (sb.width - disp) / 2;
const wantFt = ((sb.width * 0.75 - offX) / disp * 2048 - 1024) * (800 / 2048);
const gotFt = (lon1 - lat0) * 111320 * Math.cos(30.37 * Math.PI / 180) / 0.3048;
check("Re-center loads a new aerial centered where you tapped", lon1 > lat0 && Math.abs(gotFt - wantFt) < 4, `${wantFt.toFixed(1)} ft wanted, ${gotFt.toFixed(1)} ft moved`);
await L.page.getByLabel("Aerial area").selectOption("wider");
await L.page.getByRole("button", { name: "New aerial (USGS)" }).click(); await L.settle(1500);
check("Wider asks for 1,500 ft", psql(`SELECT round((state->>'imgFtPerPx')::numeric * 2048)::int FROM command_boards WHERE id = '${boardId}'`) === "1500" && (await L.body()).includes("About 1,500 ft across"));
// Upload a picture instead (a pre-plan drawing, a drone photo)
await L.page.getByLabel("Scene picture").setInputFiles("/home/claude/testrun/aerial-mock.jpg"); await L.settle(1800);
check("uploaded picture becomes the scene", psql(`SELECT i.source || '|' || i.width FROM command_boards b JOIN sim_images i ON i.id = (b.state->>'imageId')::uuid WHERE b.id = '${boardId}'`) === "upload|1280"
  && (await L.page.getByRole("button", { name: "Picture", exact: true }).count()) === 1);
await L.page.getByRole("button", { name: "Diagram" }).click(); await L.settle(500);
check("switch back to the diagram", psql(`SELECT state->>'view' FROM command_boards WHERE id = '${boardId}'`) === "diagram");

// ---- Saves on every change: no connection, then a reload ----
await L.ctx.setOffline(true);
await L.page.getByLabel("Radio note").fill("E61 reports second floor collapse risk");
await L.page.getByRole("button", { name: "Log" }).click(); await L.page.waitForTimeout(800);
check("no connection: change waits on the device", (await L.body()).includes("1 change saved on this device"));
await L.ctx.setOffline(false); await L.page.waitForTimeout(5000);
check("sent when the connection is back", psql(`SELECT count(*) FROM command_events WHERE board_id = '${boardId}' AND text = 'E61 reports second floor collapse risk'`) === "1" && !(await L.body()).includes("saved on this device"));
await L.page.reload(); await L.settle(1500);
await L.page.waitForSelector("text=STRUCTURE FIRE RESIDENTIAL", { timeout: 20000 }); await L.settle(1000);
check("after a reload, the call shows 'Command board' (already open)", await L.page.getByRole("button", { name: "Command board", exact: true }).count() === 1);
await L.page.getByRole("button", { name: "Command board", exact: true }).click(); await L.settle(1200);
body = await L.body();
check("board reopens exactly as it was", body.includes("Fire attack, Div 1") && body.includes("PAR 2") && (await L.page.getByRole("group", { name: "Strategy" }).getByRole("button", { name: "DEFENSIVE" }).getAttribute("aria-pressed")) === "true");

// ---- Fred watches (sees changes as they happen), can't change ----
await F.page.reload(); await F.settle(1500);
await F.page.waitForSelector("text=STRUCTURE FIRE RESIDENTIAL", { timeout: 20000 }); await F.settle(800);
await F.page.getByRole("button", { name: "Command board", exact: true }).click(); await F.settle(1200);
check("firefighter watches read-only", (await F.body()).includes("you're watching (read-only)") && (await F.page.getByRole("button", { name: "Take PAR" }).count()) === 0);
r = await F.post(`/api/command/${boardId}/action`, { type: "note", text: "hi" });
check("firefighter can't change the board", r.status === 403);
await L.page.getByLabel("Radio note").fill("All crews out, defensive operations"); await L.page.getByRole("button", { name: "Log" }).click();
await F.page.waitForTimeout(4500);
check("watcher sees it within a few seconds", (await F.body()).includes("All crews out, defensive operations"));
// Emergency mode: Lena (running the board) gets no pop-ups; Fred (only watching) still does
check("emergency mode banner for the officer running the board", (await L.page.getByRole("status", { name: "Emergency mode" }).innerText()).includes("EMERGENCY MODE"));
check("no emergency mode for a watcher", (await F.page.getByRole("status", { name: "Emergency mode" }).count()) === 0);
await M.post("/api/messages", { users: [lena, uid("Fred Firefighter")], subject: "Fictional staffing question", body: "Call me when you can.", important: true });
await wait(9000);
await F.page.reload(); await F.settle(2500);
check("watcher gets the important-message banner", (await F.body()).includes("Fictional staffing question"));
check("officer on the board doesn't (silenced)", !(await L.body()).includes("Fictional staffing question"));
await L.page.evaluate(() => window.dispatchEvent(new CustomEvent("sgfd-message", { detail: { threadId: "t-test0", from: "Mike Admin", kind: "chat", preview: "Fictional chat pop-up" } })));
await L.page.waitForTimeout(800);
check("chat pop-up silenced on a real board", !(await L.body()).includes("Fictional chat pop-up"));
check("the message still reached her", Number((await L.api("/api/messages/summary")).body?.unread ?? (await L.api("/api/messages")).body?.unread ?? 1) >= 1);
r = await F.post("/api/command/open", { incidentId: "902" });
check("firefighter can't open a board", r.status === 403);
// Ivan (prevention chief by title) can run boards too
const I = await person(); await I.login("ivan@sgfd.org");
r = await I.api(`/api/command/${boardId}`);
check("another officer watches with Assume command (not an editor)", r.body?.canEdit === false && r.body?.canAssume === true && r.body?.command?.icName === "Lena Lieutenant", JSON.stringify(r.body?.command));
r = await I.post(`/api/command/${boardId}/action`, { type: "note", text: "not mine" });
check("an officer not on the board can't change it", r.status === 403 && /Assume command/.test(r.body.error));
// ---- The IC adds a second person to edit (her pick, any account) ----
const fred = uid("Fred Firefighter"), ivanId = uid("Ivan Investigator");
await L.page.getByRole("button", { name: "Add someone" }).click();
await L.page.getByLabel("Find a person").fill("fred");
await L.page.getByRole("dialog").getByRole("listitem").filter({ hasText: "Fred Firefighter" }).click(); await L.settle(800);
body = await L.body();
check("IC added Fred: shown on the board", /also editing:\s*Fred Firefighter/.test(body) && body.includes("Fred Firefighter added to the board by Lena Lieutenant"));
r = await F.api(`/api/command/${boardId}`);
check("Fred can now edit", r.body?.canEdit === true && r.body?.role === "editor");
r = await F.post(`/api/command/${boardId}/action`, { type: "note", text: "Fred: hydrant B side charged" });
check("editor's change saved under his name", r.status === 200 && psql(`SELECT by_name FROM command_events WHERE text = 'Fred: hydrant B side charged'`) === "Fred Firefighter");
r = await F.post(`/api/command/${boardId}/action`, { type: "close" });
check("an editor can't close the board", r.status === 403);
r = await F.post(`/api/command/${boardId}/action`, { type: "editor_add", userId: ivanId });
check("an editor can't add people", r.status === 403);
// ---- Ivan assumes command from the board screen ----
await I.page.goto(BASE); await I.settle(800);
await I.page.waitForSelector("text=STRUCTURE FIRE RESIDENTIAL", { timeout: 20000 });
await I.page.getByRole("button", { name: "Command board", exact: true }).click(); await I.settle(1500);
await I.page.getByRole("button", { name: "Assume command" }).click(); await I.settle(1200);
body = await I.body();
check("Ivan is IC, Lena stays on as an editor", /IC\s*Ivan Investigator \(you\)/.test(body) && body.includes("Ivan Investigator assumed command from Lena Lieutenant") && /also editing:[\s\S]*Lena Lieutenant/.test(body), body.slice(0, 900));
check("new IC gets emergency mode", (await I.page.getByRole("status", { name: "Emergency mode" }).count()) === 1);
await L.page.waitForTimeout(4000);
check("Lena's screen follows: no Close button for her now", !(await L.page.getByRole("button", { name: /^Close board/ }).count()) && (await L.body()).includes("IC Ivan Investigator"));
// Ivan hands command back; Lena takes Fred off
r = await I.post(`/api/command/${boardId}/action`, { type: "transfer_command", userId: lena });
check("transfer command", r.status === 200 && r.body.command.icId === lena && r.body.command.editors.some(e => e.id === ivanId) && psql(`SELECT count(*) FROM command_events WHERE board_id = '${boardId}' AND text = 'Command transferred from Ivan Investigator to Lena Lieutenant'`) === "1");
r = await L.post(`/api/command/${boardId}/action`, { type: "editor_remove", userId: fred });
r = await F.post(`/api/command/${boardId}/action`, { type: "note", text: "after removal" });
check("removed editor can't change it any more", r.status === 403);
await L.page.waitForTimeout(4000);
await L.page.screenshot({ path: `${SCR}/shot-command-ic.png` });

// ---- The working fire recording for the incident ----
psql(`INSERT INTO fire_recordings (id, incident_number, address, description, started_at) VALUES ('11111111-2222-3333-4444-555555555555', '2026-009901', '123 Example Oak Dr', 'Working fire', now() - interval '20 minutes')`);
// ---- Close: the after-action record ----
await L.page.getByRole("button", { name: /^Close board/ }).click(); await L.settle(1000);
check("emergency mode ends when the board is closed", (await L.page.getByRole("status", { name: "Emergency mode" }).count()) === 0);
check("closed, completed by Lena, report saved", psql(`SELECT status || '|' || completed_by_name || '|' || (report_html IS NOT NULL) FROM command_boards WHERE id = '${boardId}'`) === "closed|Lena Lieutenant|true");
check("recording for the same incident picked up the board", psql("SELECT command_board_id FROM fire_recordings WHERE id = '11111111-2222-3333-4444-555555555555'") === boardId);
r = await L.post(`/api/command/${boardId}/action`, { type: "note", text: "late" });
check("closed board can't change", r.status === 400);
r = await L.api(`/api/command/${boardId}/report`);
check("report file", r.ct.includes("text/html") && r.body.includes("MAYDAY Ben Bravo, EG653") && r.body.includes("Water on the fire") && r.body.includes("Strategy: OFFENSIVE → DEFENSIVE") && r.body.includes("closed") && r.body.includes("Lena Lieutenant") && !r.body.includes("<script"));
check("report names the IC and who else was on the board", r.body.includes("Incident commander: <b>Lena Lieutenant</b> · also on the board: Ivan Investigator"));
const rp = await L.ctx.newPage(); await rp.goto(`${BASE}/api/command/${boardId}/report`); await rp.waitForTimeout(500);
await rp.screenshot({ path: `${SCR}/shot-command-report.png`, fullPage: true }); await rp.close();
// Personnel File
await L.page.goto(BASE); await L.settle(800);
await L.page.getByRole("button", { name: /Personnel File/ }).first().click(); await L.settle(800);
await L.page.getByRole("button", { name: /^Command boards/ }).first().click(); await L.settle(800);
body = await L.body();
check("in Lena's Personnel File", body.includes("STRUCTURE FIRE RESIDENTIAL") && body.includes("Incident commander (closed the board)") && body.includes("After-action report"));
check("not in Fred's file", (await F.api(`/api/command/person/${uid("Fred Firefighter")}`)).body.boards.length === 0);
// Command Board area
await L.page.goto(BASE); await L.settle(800);
await L.page.getByRole("button", { name: /Command Board/ }).first().click(); await L.settle(800);
body = await L.body();
check("Command boards area lists it under Closed", /Closed \(last 60 days\)/i.test(body) && body.includes("2026-009901") && body.includes("by Lena Lieutenant"), body.slice(300, 1200));
// Recordings
await M.page.goto(BASE); await M.settle(800);
await M.page.getByRole("button", { name: /Working Fire Recordings/ }).first().click(); await M.settle(800);
await M.page.getByText("123 Example Oak Dr").first().click(); await M.settle(800);
body = await M.body();
check("recording shows its command board", body.includes("Command board:") && body.includes("#2026-009901") && body.includes("Open after-action report"));
await M.page.screenshot({ path: `${SCR}/shot-command-recording.png` });
await M.page.getByRole("button", { name: "Remove" }).click(); await M.settle(600);
check("removed from the recording", (await M.body()).includes("None attached."));
await M.page.getByRole("button", { name: "Attach a command board" }).click(); await M.settle(500);
await M.page.getByLabel("Command board to attach").selectOption(boardId);
await M.page.getByRole("button", { name: "Attach" }).click(); await M.settle(600);
check("attached by hand", psql("SELECT command_board_id FROM fire_recordings WHERE id = '11111111-2222-3333-4444-555555555555'") === boardId);
check("audit: open, close, recording links", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Command board'")) === 2 && Number(psql("SELECT count(*) FROM audit_log WHERE action IN ('Attached command board', 'Removed command board')")) === 2);
check("events can't be edited", (() => { try { psql(`UPDATE command_events SET text = 'x' WHERE board_id = '${boardId}'`); return false; } catch { return true; } })());
// ---- Boards made by hand: training (save or discard; run again) and a real incident not in CAD ----
await L.page.goto(BASE); await L.settle(800);
await L.page.getByRole("button", { name: /Command Board/ }).first().click(); await L.settle(800);
await L.page.getByRole("button", { name: "New board" }).click();
await L.page.getByLabel("Training name").fill("B-shift drill: two-story residential");
await L.page.getByLabel("Nature").fill("Structure fire, residential");
await L.page.getByLabel("Address").fill("500 Training Tower Rd, Baton Rouge, LA");
await L.page.getByLabel(/Find it on the map/).check();
await L.page.getByLabel("Units").fill("EG653, sg10 LD618");
await L.page.getByRole("button", { name: "Start training board" }).click(); await L.settle(1500);
body = await L.body();
check("training board made from the Command Board section", body.includes("TRAINING BOARD · not a real incident") && body.includes("B-shift drill: two-story residential") && body.includes("Ann Alpha, Ben Bravo, Cal Charlie") && body.includes("Ivan Investigator"), body.slice(0, 500));
check("no emergency mode on a training board", (await L.page.getByRole("status", { name: "Emergency mode" }).count()) === 0);
check("address found for the aerial", (await L.page.getByRole("button", { name: "Get aerial (USGS)" }).count()) === 1);
const tId = psql("SELECT id FROM command_boards WHERE kind = 'training'");
const popMsg = P => P.page.evaluate(() => window.dispatchEvent(new CustomEvent("sgfd-message", { detail: { threadId: "t-test", from: "Mike Admin", kind: "chat", preview: "Fictional drill reminder" } })));
await popMsg(L); await L.page.waitForTimeout(800);
check("notifications not silenced during training (pop-up shows)", (await L.body()).includes("Fictional drill reminder"));
await L.page.getByRole("button", { name: "Get aerial (USGS)" }).click(); await L.settle(1200);
await L.page.getByRole("group", { name: "Strategy" }).getByRole("button", { name: "OFFENSIVE" }).click(); await L.settle(400);
await L.page.getByRole("button", { name: "End training" }).click();
await L.page.getByRole("button", { name: "Save for future reference" }).click(); await L.settle(800);
check("saved: closed with its report", psql(`SELECT status || '|' || (report_html LIKE '%TRAINING%') FROM command_boards WHERE id = '${tId}'`) === "closed|true");
await L.page.getByRole("button", { name: "All boards" }).click(); await L.settle(800);
body = await L.body();
check("listed under Saved training boards", /Saved training boards \(1\)/i.test(body) && body.includes("B-shift drill: two-story residential"));
await L.page.getByRole("button", { name: "Run again" }).click(); await L.settle(1500);
const t2 = psql(`SELECT id FROM command_boards WHERE kind = 'training' AND id <> '${tId}'`);
check("run again: a fresh board with the same setup", !!t2 && psql(`SELECT title || '|' || jsonb_array_length(state->'crews') || '|' || (state->>'imageId' IS NOT NULL) || '|' || coalesce(state->>'strategy', '') FROM command_boards WHERE id = '${t2}'`) === "B-shift drill: two-story residential (again)|3|true|");
await L.page.getByRole("button", { name: "End training" }).click();
await L.page.getByRole("button", { name: "Discard it" }).click(); await L.settle(1000);
check("discard: gone", psql(`SELECT count(*) FROM command_boards WHERE id = '${t2}'`) === "0" && /Saved training boards \(1\)/i.test(await L.body()));
r = await F.post("/api/command/new", { kind: "training", title: "x" });
check("firefighter can't make a board", r.status === 403);
r = await L.post("/api/command/new", { kind: "incident", nature: "Vehicle fire" });
check("real incident by hand needs an address", r.status === 400);
r = await L.post("/api/command/new", { kind: "incident", nature: "Vehicle fire", address: "1 Sample Ramp", number: "HAND-1", units: "EG653" });
const hb = (await L.api(`/api/command/${r.body.id}`)).body;
check("real incident not in CAD: incident board, not from CAD", hb.kind === "incident" && hb.fromCad === false && hb.number === "HAND-1" && hb.state.crews.length === 1);
check("incident boards can't be discarded", (await L.post(`/api/command/${r.body.id}/discard`, {})).status === 400);
check("training in Lena's Personnel File", (await L.api(`/api/command/person/${lena}`)).body.boards.some(b => b.kind === "training" && b.title === "B-shift drill: two-story residential"));
check("audited", Number(psql("SELECT count(*) FROM audit_log WHERE action IN ('Made training board', 'Discarded training board', 'Made command board by hand')")) === 4);
await L.page.screenshot({ path: `${SCR}/shot-command-list.png` });
// Phone
const Ph = await person({ width: 390, height: 844 }); await Ph.login("lena@sgfd.org");
await Ph.post(`/api/command/${boardId}/action`, { type: "reopen" });
await Ph.page.evaluate(id => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: "command", init: { board: id } } })), boardId); await Ph.settle(1500);
await Ph.page.screenshot({ path: `${SCR}/shot-command-phone.png`, fullPage: true });
check("phone: no sideways scroll", await Ph.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check("no page errors", errors.length === 0, errors.join(" | "));
await L.page.goto(BASE); await L.settle(500);
done();
await browser.close(); mock.close();
try { process.kill(Number(fs.readFileSync("/home/claude/testrun/app/server.pid", "utf8"))); } catch {}
process.exit(0);
