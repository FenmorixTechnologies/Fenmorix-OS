// Strategies & Tactics: scene map for simulation scenarios. USGS aerial by address (geocoder + USGS stand-ins), picture upload,
// editor tools (scale, hydrant, building outline, fire, hazard, no-access box), apparatus positioning during a run (arrival
// gating, blocked areas, inside the building, hydrant / preconnect / aerial reach / collapse zone notes), positions given to the
// simulated units and the grader, debrief placement replay. Fictional people and addresses only.
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
const AERIAL = fs.readFileSync("/home/claude/testrun/aerial-mock.jpg");

const ai = [], usgs = [];
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/geocoder/locations/onelineaddress") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ result: { addressMatches: /Example/.test(u.searchParams.get("address")) ? [{ matchedAddress: "6843 EXAMPLE DR, ST GEORGE, LA, 70000", coordinates: { x: -91.02, y: 30.36 } }] : [] } }));
    }
    if (u.pathname === "/arcgis/rest/services/USGSImageryOnly/MapServer/export") { usgs.push(Object.fromEntries(u.searchParams)); res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(AERIAL); }
    const j = JSON.parse(body || "{}");
    const text = (j.messages?.[0]?.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    let reply = {};
    if (/voice fireground radio simulation/.test(text)) { ai.push({ kind: "radio", text }); reply = { replies: [{ from: "Ladder 618", text: "Ladder 618 copies." }] }; }
    else if (/You grade a/.test(text)) {
      ai.push({ kind: "grade", text });
      const n = (text.match(/^\d+\. /gm) || []).length;
      reply = { scores: Array.from({ length: n }, () => ({ score: 4, why: "ok" })), summary: "Good placement overall.", strengths: ["Engine on the hydrant side"], improvements: ["Keep the ladder out of the collapse zone"],
        keyMoments: [], cues: [], assignments: [], flags: [], placement: "Engine 623 left the front for the ladder, but Ladder 618 was set up inside the collapse zone." };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }));
  });
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", ANTHROPIC_API_KEY: "test", AI_API_BASE: "http://127.0.0.1:3099", GEOCODER_BASE: "http://127.0.0.1:3099", USGS_BASE: "http://127.0.0.1:3099",
    WHISPER_BIN: "/home/claude/testrun/fake-whisper.mjs", WHISPER_MODEL: "/home/claude/testrun/fake-model.bin" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
async function person(viewport = { width: 1440, height: 1000 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "America/Chicago", permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept());
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
  const scr = async (x, y) => page.evaluate(([x, y]) => { const s = document.querySelector('svg[aria-label="Scene map"]'); const r0 = s.getBoundingClientRect(); if (r0.top < 0 || r0.bottom > innerHeight) s.scrollIntoView({ block: "center" }); const p = s.createSVGPoint(); p.x = x; p.y = y; const q = p.matrixTransform(s.getScreenCTM()); return { x: q.x, y: q.y }; }, [x, y]);
  const clickAt = async (x, y) => { const p = await scr(x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); };
  return { ctx, page, api, post, settle, login, nav, scr, clickAt, body: () => page.locator("body").innerText() };
}
const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Cal Candidate", "cal"], ["Eve Evaluator", "eve"]]) {
  await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
await M.post("/api/access/grants", { section: "evals", level: "edit", userId: uid("Eve Evaluator"), scope: "all" });

// ======= Build the scene (Mike, scenario editor) =======
await M.nav("Evaluations"); await M.nav("Scenarios");
await M.page.getByRole("button", { name: "Edit Size-Up & Initial Command: 6843 Brookshire Drive" }).click(); await M.settle(400);
await M.page.getByLabel("Scene address").fill("6843 Example Dr, St. George, LA");
await M.page.getByRole("button", { name: "Load USGS aerial" }).click(); await M.settle(1200);
const q = usgs[0] || {};
const bb = (q.bbox || "").split(",").map(Number);
// 600 ft = 182.88 m on the ground; Web Mercator width = 182.88 / cos(30.36°) = 211.9 m
check("USGS export asked for a 1280 px picture of ~600 ft around the geocoded point", q.size === "1280,1280" && q.bboxSR === "3857" && Math.abs((bb[2] - bb[0]) - 211.9) < 0.5, JSON.stringify(q));
check("map shows with the USGS credit and the scale", await M.page.locator('svg[aria-label="Scene map"]').count() === 1 && /Imagery: USGS The National Map/.test(await M.body()) && /Scale: 600 ft across/.test(await M.body()));
check("the picture is served", (await M.page.evaluate(async () => { const s = document.querySelector('svg[aria-label="Scene map"] image').getAttribute("href"); const r = await fetch(s); return r.status + " " + r.headers.get("content-type"); })) === "200 image/jpeg");
await M.page.getByRole("button", { name: "Tool: Hydrant" }).click(); await M.clickAt(200, 880);
await M.page.getByRole("button", { name: "Tool: Building outline" }).click();
for (const [x, y] of [[520, 520], [760, 520], [760, 700], [520, 700]]) await M.clickAt(x, y);
await M.page.getByRole("button", { name: "Tool: Fire" }).click(); await M.clickAt(700, 560);
await M.page.getByRole("button", { name: "Tool: Hazard" }).click();
await M.page.getByLabel("Hazard kind").selectOption("collapse"); await M.page.getByLabel("Hazard label").fill("Alpha wall"); await M.page.getByLabel("Hazard radius (ft)").fill("40");
await M.clickAt(640, 760);
await M.page.getByRole("button", { name: "Tool: No access" }).click();
{ const a = await M.scr(900, 830), b = await M.scr(1100, 890); await M.page.mouse.move(a.x, a.y); await M.page.mouse.down(); await M.page.mouse.move(b.x, b.y, { steps: 6 }); await M.page.mouse.up(); await M.page.waitForTimeout(300); }
await M.page.getByLabel("Wind from (degrees)").fill("135"); await M.page.getByLabel("Wind mph").fill("10");
await M.page.screenshot({ path: `${SCR}/shot-scene-editor.png`, fullPage: true });
await M.page.getByRole("button", { name: "Save scenario" }).click(); await M.settle(700);
const sc = JSON.parse(psql("SELECT data->'scene' FROM sim_scenarios WHERE key='co-a-brookshire'"));
check("scene saved: 1 hydrant, 4-corner building, fire, collapse zone (40 ft), no-access box, wind", sc.hydrants.length === 1 && sc.building.length === 4 && sc.fire.length === 1 && sc.fire[0].t === 0
  && sc.hazards[0].kind === "collapse" && Math.abs(sc.hazards[0].r * sc.ftPerPx - 40) < 0.5 && sc.blocked.length === 1 && sc.blocked[0].label === "Parked cars" && sc.wind.from === 135, JSON.stringify(sc).slice(0, 300));
check("clicks land where intended (hydrant within 2 px)", Math.abs(sc.hydrants[0].x - 200) < 2 && Math.abs(sc.hydrants[0].y - 880) < 2, JSON.stringify(sc.hydrants[0]));
check("scale is 600 ft / 1280 px", Math.abs(sc.ftPerPx - 600 / 1280) < 1e-9);
// clean the shapes to round numbers so the distance checks below are exact
execSync("psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -At", { input: `UPDATE sim_scenarios SET data = jsonb_set(data, '{scene}', data->'scene' || '{"hydrants":[{"x":200,"y":880,"label":"H1"}],"building":[{"x":520,"y":520},{"x":760,"y":520},{"x":760,"y":700},{"x":520,"y":700}],"hazards":[{"x":640,"y":760,"r":85.33,"kind":"collapse","label":"Alpha wall"}],"blocked":[{"x":900,"y":830,"w":200,"h":60,"label":"Parked cars"}]}'::jsonb) WHERE key='co-a-brookshire'` });

// uploads
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
check("picture upload works (manage)", (await M.post("/api/evals/images", { name: "preplan.png", mime: "image/png", data: Buffer.alloc(600, 7).toString("base64"), width: 800, height: 600 })).status === 200);
check("non-picture refused", (await M.post("/api/evals/images", { name: "x.pdf", mime: "application/pdf", data: png, width: 1, height: 1 })).status === 415);
check("unknown address refused with advice", /wasn't found/.test((await M.post("/api/evals/aerial", { address: "1 Nowhere Rd" })).body?.error || ""));
const E = await person(); await E.login("eve@sgfd.org");
check("evaluators can't upload scene pictures", (await E.post("/api/evals/images", { name: "a.png", mime: "image/png", data: png.repeat(3), width: 10, height: 10 })).status === 403);

// ======= Run it (Cal, practice) =======
const C = await person(); await C.login("cal@sgfd.org");
await C.nav("Evaluations"); await C.nav("Simulator");
check("scenario list marks the scene map", /scene map/.test(await C.body()));
await C.page.getByRole("button", { name: /Scenario Size-Up & Initial Command/ }).click(); await C.settle(300);
await C.page.getByRole("button", { name: "Start" }).click(); await C.settle(1500);
check("run shows the map with unit chips; Ladder 618 not on scene yet", await C.page.locator('svg[aria-label="Scene map"]').count() === 1
  && await C.page.getByRole("button", { name: "Position Engine 623" }).isEnabled() && !(await C.page.getByRole("button", { name: "Position Ladder 618" }).isEnabled()));
check("collapse zone hidden from the officer, no-access box shown", !/Collapse zone/.test(await C.page.locator('svg[aria-label="Scene map"]').innerHTML()) && /Parked cars/.test(await C.page.locator('svg[aria-label="Scene map"]').innerHTML()));
await C.page.getByRole("button", { name: "Position Engine 623" }).click();
await C.clickAt(1000, 860); await C.settle(500);
check("can't park in the no-access area", /Engine 623 can't get there: Parked cars/.test(await C.body()));
await C.clickAt(640, 600); await C.settle(500);
check("can't park inside the building", /That's inside the building/.test(await C.body()));
await C.clickAt(620, 860); await C.settle(700);
const sess = psql("SELECT id FROM sim_sessions");
let st = JSON.parse(psql(`SELECT state FROM sim_sessions WHERE id='${sess}'`));
// distance to building bottom edge: 160 px × 0.46875 = 75 ft; hydrant: hypot(420, 20) = 420.5 px = 197 ft
check("engine placed: 75 ft from the building, hydrant H1 197 ft, preconnects reach", st.placements.length === 1 && st.placements[0].notes.join("|") === "75 ft from the fire building|nearest hydrant H1 is 197 ft away|preconnects (200 ft) reach the building", st.placements[0]?.notes.join("|"));
check("placement shows on the map and in the radio log", /Engine 623 positioned:/.test(await C.body()) && /75 ft from the fire building/.test(await C.body()) && /197 ft/.test(await C.page.locator('svg[aria-label="Scene map"]').innerHTML()));
const early = await C.post(`/api/evals/sessions/${sess}/place`, { unit: "Ladder 618", x: 640, y: 790, angle: 0, clock: 60 });
check("a unit that hasn't arrived can't be positioned", early.body.ok === false && /isn't on scene yet/.test(early.body.reason));
check("units not on the assignment refused", (await C.post(`/api/evals/sessions/${sess}/place`, { unit: "Engine 999", x: 10, y: 10, clock: 300 })).status === 400);
const lad = await C.post(`/api/evals/sessions/${sess}/place`, { unit: "Ladder 618", x: 640, y: 790, angle: 90, clock: 200 });
check("ladder in the collapse zone: aerial reaches (42 ft) but flagged", lad.body.ok && lad.body.placement.notes.join("|") === "42 ft from the fire building|aerial (about 100 ft) reaches the building|INSIDE the collapse zone (Alpha wall)", lad.body.placement?.notes.join("|"));
const far = await C.post(`/api/evals/sessions/${sess}/place`, { unit: "Ladder 618", x: 1200, y: 300, angle: 0, clock: 205 });
check("moving the ladder far away: out of aerial reach", far.body.ok && /OUT of aerial reach/.test(far.body.placement.notes.join("|")));
await C.post(`/api/evals/sessions/${sess}/place`, { unit: "Ladder 618", x: 640, y: 790, angle: 90, clock: 210 });
await C.page.getByLabel("Type a transmission").fill("Ladder 618, set up on the Alpha side for the roof.");
await C.page.keyboard.press("Enter"); await C.page.waitForTimeout(1500);
const rp = (ai.filter(a => a.kind === "radio").pop()?.text || "").split("APPARATUS POSITIONS")[1]?.split("RADIO TRAFFIC SO FAR")[0] || "";
check("simulated units are told the current positions (latest per unit)", rp.length > 0 && /Engine 623 \(engine\): 75 ft from the fire building/.test(rp) && /Ladder 618 \(ladder\): 42 ft.*INSIDE the collapse zone/.test(rp) && !/OUT of aerial reach/.test(rp) && /Wind from 135/.test(rp));
await C.page.screenshot({ path: `${SCR}/shot-scene-run.png` });
await C.page.getByRole("button", { name: "End and grade" }).click(); await C.settle(2000);
const gp = ai.filter(a => a.kind === "grade").pop()?.text || "";
check("grader gets the placement log and judges positioning", /APPARATUS PLACEMENT/.test(gp) && /POSITIONED Ladder 618/.test(gp) && /collapse zone/.test(gp));
const cb = await C.body();
check("debrief: Apparatus placement card with the AI's note, map and replay slider", /Apparatus placement/.test(cb) && /set up inside the collapse zone/.test(cb) && await C.page.getByLabel("Replay time").count() === 1);
check("debrief map shows the collapse zone and both units", /Collapse zone/.test(await C.page.locator('svg[aria-label="Scene map"]').innerHTML()) && /Ladder 618/.test(await C.page.locator('svg[aria-label="Scene map"]').innerHTML()));
await C.page.getByLabel("Replay time").fill("100"); await C.page.waitForTimeout(300);
const svg100 = await C.page.locator('svg[aria-label="Scene map"]').innerHTML();
check("replay at 1:40 shows only the engine", /Engine 623/.test(svg100) && !/>Ladder 618</.test(svg100));
await C.page.screenshot({ path: `${SCR}/shot-scene-debrief.png`, fullPage: true });

// phone: map + log stack
const P = await person({ width: 390, height: 844 }); await P.login("cal@sgfd.org");
const r2 = await P.post("/api/evals/sessions", { scenarioId: psql("SELECT id FROM sim_scenarios WHERE key='co-a-brookshire'"), mode: "practice" });
await P.page.goto(BASE); await P.settle(); await P.nav("Evaluations").catch(() => {});
check("phone run starts", r2.status === 200);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
done();
await browser.close(); mock.close(); process.exit(0);
