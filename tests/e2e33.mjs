// IMT: incidents, operational periods, ICS forms, completeness, approval/locking, copy to the next period,
// access (assigned people, share-all), weather (NWS stand-in), geocoding, drafting help and reading an IAP PDF (Claude stand-in),
// attachments (picture + PDF pages), printing the IAP. Fictional people and incident only.
// Run: ./reset-db.sh (this test restarts the server with mock settings)
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

// ---- Stand-ins: Claude, NWS, Census geocoder ----
const B = "http://127.0.0.1:3099";
const ai = [];
const IMPORTED = {
  incident: { name: "Hurricane Zephyr Response", number: "LA-TEST-2026-01", kind: "Hurricane", location: "Example Parish, LA" },
  period: { starts: "2026-11-12T07:00", ends: "2026-11-12T19:00" },
  f202: { objectives: ["Complete primary search of Zone 3 by 1500.", "Restore access on Main St by 1800."], emphasis: "Accountability at all times.", awareness: "Downed lines.", siteSafetyRequired: false, prepared: { name: "Pat Example", position: "PSC" }, approvedBy: "Iris Example" },
  f203: [{ section: "command", role: "IC/UCs", name: "Iris Example" }, { section: "operations", role: "Chief", name: "Otto Example" }, { section: "operations", role: "Division/Group", label: "ZONE 3", name: "Gus Example" }, { section: "agency", role: "Agency Rep", agency: "Example Sheriff", name: "Rex Example" }],
  f204: [{ group: "ZONE 3", supervisor: "Gus Example", resources: [{ ident: "Strike Team 1", leader: "Gus Example", persons: "12", contact: "TAC 2", notes: "" }], work: "Primary search Zone 3.", special: "Hi-vis required.", comms: [] },
         { group: "ROUTE CLEARANCE", resources: [{ ident: "Public Works 4", leader: "", persons: "4", contact: "", notes: "" }], work: "Clear Main St.", special: "", comms: [] }],
  f205: { channels: [{ zone: "1", ch: "1", func: "COMMAND", name: "FIRE CMD", assignment: "Command", rxFreq: "154.2800", rxTone: "", txFreq: "154.2800", txTone: "", mode: "A", remarks: "" }], special: "", prepared: { name: "", position: "" } },
  f206: { stations: [], transport: [{ name: "Example EMS", location: "Station 1", contact: "911", als: true }], hospitals: [{ name: "Example General", address: "1 Health Way", contact: "555-0100", air: "5 min", ground: "15 min", trauma: "Level 2", burn: false, helipad: true }], procedures: "Report on COMMAND.", aviation: false, prepared: { name: "", position: "" }, approvedBy: "" },
  f208: { message: "Watch for downed lines.", siteSafetyRequired: false, prepared: { name: "", position: "" } },
  f220: { aircraft: [{ tail: "N000X", callSign: "Example 1", type: "1", makeModel: "Bell 412", base: "KXXX", avail: "0800", stop: "1800", remarks: "" }], frequencies: [], personnel: [] },
};
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    const out = (j, ct = "application/json") => { res.writeHead(200, { "Content-Type": ct }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, B);
    if (u.pathname === "/v1/messages") {
      const j = JSON.parse(body);
      const content = j.messages[0].content;
      const text = content.filter(c => c.type === "text").map(c => c.text).join("\n");
      const hasDoc = content.some(c => c.type === "document");
      ai.push({ hasDoc, text, key: req.headers["x-api-key"], max: j.max_tokens });
      let reply;
      if (hasDoc) reply = IMPORTED;
      else if (/Draft the ICS 202/.test(text)) reply = { objectives: ["Search all flooded homes in Div A by 1700.", "Open one shelter by 1200."], emphasis: "Safety first.", awareness: "Rising water." };
      else if (/ICS 208/.test(text)) reply = { message: "Vehicle Safety\n- Don't drive through moving water.\nKey message: Wear PFDs near water." };
      else reply = { work: "1. Search Div A.\n2. Report hourly.", special: "1. PFDs on." };
      return out({ content: [{ type: "text", text: "```json\n" + JSON.stringify(reply) + "\n```" }] });
    }
    if (u.pathname === "/geocoder/locations/onelineaddress") {
      return out({ result: { addressMatches: /Main/.test(u.searchParams.get("address")) ? [{ matchedAddress: "100 MAIN ST, EXAMPLE, LA, 70000", coordinates: { x: -91.05, y: 30.41 } }] : [] } });
    }
    if (u.pathname === "/points/30.4100,-91.0500") return out({ properties: { forecast: `${B}/gp/fc`, observationStations: `${B}/gp/st`, relativeLocation: { properties: { city: "Example", state: "LA" } }, cwa: "LIX" } });
    if (u.pathname === "/gp/st") return out({ features: [{ properties: { stationIdentifier: "KXXX" } }] });
    if (u.pathname === "/stations/KXXX/observations/latest") return out({ properties: { timestamp: new Date().toISOString(), textDescription: "Rain", temperature: { value: 20 }, windSpeed: { value: 30, unitCode: "wmoUnit:km_h-1" }, windDirection: { value: 180 }, windGust: { value: null }, relativeHumidity: { value: 95 }, dewpoint: { value: 19 }, visibility: { value: 3218 } } });
    if (u.pathname === "/gp/fc") return out({ properties: { periods: [
      { name: "Today", startTime: new Date().toISOString(), isDaytime: true, temperature: 74, windDirection: "S", windSpeed: "20 to 30 mph", probabilityOfPrecipitation: { value: 90 }, shortForecast: "Heavy Rain", detailedForecast: "Heavy rain with tropical storm force gusts." },
      { name: "Tonight", startTime: new Date().toISOString(), isDaytime: false, temperature: 70, windDirection: "S", windSpeed: "15 mph", probabilityOfPrecipitation: { value: 70 }, shortForecast: "Showers", detailedForecast: "Showers." }] } });
    if (u.pathname === "/alerts/active") return out({ features: [{ properties: { event: "Flash Flood Warning", severity: "Severe", status: "Actual", messageType: "Alert", headline: "Flash Flood Warning for Example Parish" } }] });
    res.writeHead(404); res.end("{}");
  });
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", ANTHROPIC_API_KEY: "test", AI_API_BASE: B, WEATHER_API_BASE: B, GEOCODER_BASE: B, PDFJS_DIR: "/opt/npm-tools/node_modules/pdfjs-dist/build" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
async function person(viewport = { width: 1400, height: 950 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "America/Chicago" });
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
  return { ctx, page, api, post, settle, login, nav, body: () => page.locator("body").innerText() };
}
const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Paula Planner", "paula"], ["Ivan Incident", "ivan"], ["Olive Ops", "olive"], ["Victor Viewless", "victor"]]) {
  await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
psql(`UPDATE users SET phone = '225-555-0142' WHERE full_name = 'Olive Ops'`);
await M.post("/api/access/grants", { section: "imt", level: "edit", userId: uid("Paula Planner"), scope: "all" });

// ======= Incident (Mike) =======
await M.nav("IMT");
check("IMT in the side bar, empty list", /No incidents yet/.test(await M.body()));
await M.page.getByRole("button", { name: "New incident" }).first().click(); await M.settle();
await M.page.getByLabel("Incident name").fill("Hurricane Zephyr Response");
await M.page.getByLabel("Incident number").fill("LA-TEST-2026-01");
await M.page.getByLabel("Type").fill("Hurricane / tropical storm");
await M.page.getByLabel("Location", { exact: true }).fill("100 Main St, Example, LA");
await M.page.getByRole("button", { name: "Find on map" }).click(); await M.settle(700);
check("geocoder fills latitude/longitude", (await M.page.getByLabel("Latitude").inputValue()) === "30.41000" && /Found: 100 MAIN ST/.test(await M.body()));
await M.page.getByLabel("Situation summary").fill("Category 2 landfall overnight; flooding in Zones 3-5.");
await M.page.getByRole("button", { name: "Create incident" }).click(); await M.settle(800);
const incId = psql("SELECT id FROM imt_incidents");
check("incident created", !!incId && /Hurricane Zephyr Response/.test(await M.body()) && /No operational periods yet/.test(await M.body()));

// ======= Paula builds period 1 =======
const P = await person(); await P.login("paula@sgfd.org");
check("edit level can't create an incident", (await P.post("/api/imt/incidents", { name: "Nope" })).status === 403);
await P.nav("IMT"); await P.page.getByRole("button", { name: "Open Hurricane Zephyr Response" }).click(); await P.settle();
await P.page.getByRole("button", { name: "New operational period" }).click();
await P.page.getByLabel("Starts").fill("2026-11-11T07:00"); await P.page.getByLabel("Ends").fill("2026-11-11T19:00");
await P.page.getByRole("button", { name: "Start the period" }).click(); await P.settle(1000);
const per1 = psql("SELECT id FROM imt_periods WHERE seq = 1");
check("period 1 starts with the core forms", psql(`SELECT string_agg(kind, ',' ORDER BY sort) FROM imt_forms WHERE period_id = '${per1}'`) === "cover,202,203,204,205,206,208,weather");
let pb = await P.body();
check("checklist shows what's missing", /items? still to fill in/.test(pb) && /to fill in/.test(pb));
// 203: IC Ivan (roster), Ops chief Olive, Safety, etc.
await P.page.getByRole("button", { name: /^ICS 203/ }).click(); await P.settle(400);
const fill203 = async (aria, name) => { await P.page.getByLabel(aria, { exact: true }).fill(name); };
await fill203("Command staff IC/UCs", "Ivan Incident");
await fill203("Command staff Safety Officer", "Sally Safety (Example FD)");
await fill203("Operations Section Operations Chief".replace("Operations Chief", "Chief"), "Olive Ops");
await fill203("Planning Section Chief", "Paula Planner");
await fill203("Logistics Section Chief", "Leo Logistics");
await P.page.getByRole("button", { name: "Division/Group" }).click();
const divRows = P.page.getByPlaceholder("e.g. Div A, AIR SAR");
await divRows.last().fill("DIV A");
await P.page.getByLabel(/^Operations Section Division\/Group/).last().fill("Gina Group");
await P.settle(1500);
let f203 = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = '203'`));
const row = (s, r) => f203.rows.find(x => x.section === s && x.role === r);
check("203 saved; roster names linked to accounts", row("command", "IC/UCs").userId === uid("Ivan Incident") && row("operations", "Chief").userId === uid("Olive Ops")
  && row("command", "Safety Officer").userId === null && f203.rows.some(r => r.role === "Division/Group" && r.label === "DIV A" && r.name === "Gina Group"), JSON.stringify(f203.rows.filter(r => r.section === "operations").slice(3)));
check("linked person's Directory phone picked up", row("operations", "Chief").contact === "225-555-0142");
// 202 with drafting help
await P.page.getByRole("button", { name: /^ICS 202/ }).click(); await P.settle(400);
await P.page.getByRole("button", { name: "Suggest objectives" }).click(); await P.settle(900);
check("drafting help shows a draft", /Suggested draft/i.test(await P.body()) && /Search all flooded homes in Div A by 1700/.test(await P.body()));
check("draft request carries the incident context, key stays on the server", ai.at(-1).key === "test" && /Hurricane Zephyr Response/.test(ai.at(-1).text) && /Category 2 landfall/.test(ai.at(-1).text));
await P.page.getByRole("button", { name: "Use these" }).click(); await P.settle(1500);
let f202 = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = '202'`));
check("draft used and saved", f202.objectives.length === 2 && f202.emphasis === "Safety first.");
await P.page.getByLabel("Prepared by: name").fill("Paula Planner");
await P.page.getByLabel("Position/title").fill("PSC");
await P.page.getByLabel("Approved by Incident Commander").fill("Ivan Incident");
await P.settle(1500);
check("202 complete", !/Still to fill in/.test(await P.body()));
// 204
await P.page.getByRole("button", { name: /^ICS 204/ }).click(); await P.settle(400);
check("204 shows the Ops chief from the 203", /Operations Section Chief: Olive Ops · 225-555-0142/.test(await P.body()));
await P.page.getByLabel("Division", { exact: true }).fill("A");
await P.page.getByLabel("Division/Group Supervisor").fill("Gina Group");
await P.page.getByLabel("Resource 1 Resource identifier").fill("Strike Team 61");
await P.page.getByLabel("Resource 1 # of persons").fill("12");
await P.page.getByRole("button", { name: "Suggest" }).click(); await P.settle(800);
await P.page.getByRole("button", { name: "Use these" }).click(); await P.settle(1500);
let f204 = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = '204'`));
check("204 saved with work assignments", f204.division === "A" && f204.resources[0].ident === "Strike Team 61" && /Search Div A/.test(f204.work) && /PFDs/.test(f204.special));
// Second 204 (Olive supervises it -> she's assigned)
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("204"); await P.settle(800);
await P.page.getByLabel("Group", { exact: true }).fill("SHELTER");
await P.page.getByLabel("Division/Group Supervisor").fill("Olive Ops"); await P.settle(1500);
check("second 204 added", psql(`SELECT count(*) FROM imt_forms WHERE period_id = '${per1}' AND kind = '204'`) === "2");
// 205 + save channels for next time
await P.page.getByRole("button", { name: /^ICS 205 /, exact: false }).first().click(); await P.settle(400);
await P.page.getByLabel("Channel 1 Channel name / trunked system").fill("FIRE CMD");
await P.page.getByLabel("Channel 1 RX freq N/W").fill("154.2800");
await P.page.getByRole("button", { name: "Add a channel" }).click();
await P.page.getByLabel("Channel 2 Function").selectOption("TACTICAL");
await P.page.getByLabel("Channel 2 Channel name / trunked system").fill("TAC 2");
await P.settle(1300);
await P.page.getByRole("button", { name: "Save for next time" }).click(); await P.settle(600);
check("channels saved to the library", JSON.parse(psql("SELECT items FROM imt_library WHERE kind = 'channels'")).length === 2);
// 206 hospitals
await P.page.getByRole("button", { name: /^ICS 206/ }).click(); await P.settle(400);
await P.page.getByRole("button", { name: "Add a hospital" }).click();
await P.page.getByLabel("Hospital 1 Hospital").fill("Example General Hospital");
await P.page.getByLabel("Hospital 1 Trauma level").fill("Level 2");
await P.page.getByLabel("Hospital 1 Helipad").check();
await P.settle(1300);
// 208 drafting
await P.page.getByRole("button", { name: /^ICS 208/ }).click(); await P.settle(400);
await P.page.getByRole("button", { name: "Suggest a safety message" }).click(); await P.settle(800);
await P.page.getByRole("button", { name: "Use this" }).click(); await P.settle(1400);
check("208 safety message", /moving water/.test(psql(`SELECT data->>'message' FROM imt_forms WHERE period_id = '${per1}' AND kind = '208'`)));
// Weather
await P.page.getByRole("button", { name: /^Weather forecast/ }).click(); await P.settle(400);
await P.page.getByRole("button", { name: "Get the forecast" }).click(); await P.settle(1500);
pb = await P.body();
check("NWS forecast for the incident location", /Heavy Rain/.test(pb) && /Flash Flood Warning/.test(pb) && /Near Example, LA/.test(pb));
check("forecast saved with the IAP", JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = 'weather'`)).snapshot.periods.length === 2);
// Attachments: a picture and a PDF (pages turned into pictures in the browser)
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("attachment"); await P.settle(800);
fs.writeFileSync(`${SCR}/map.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
await P.page.getByLabel("Upload a map, picture or PDF").setInputFiles(`${SCR}/map.png`); await P.settle(1500);
let att = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = 'attachment'`));
check("picture attachment uploaded and chosen", !!att.fileId && att.title === "map");
// a PDF via the incident files card
const pdfPath = `${SCR}/division-map.pdf`;
execSync(`python3 -I -c "
import sys
from reportlab.pdfgen import canvas
c=canvas.Canvas('${pdfPath}')
for i in range(2):
  c.drawString(100,750,'Division map page %d' % (i+1)); c.showPage()
c.save()" 2>/dev/null || cp /home/claude/testrun/e2e23-report.pdf ${pdfPath}`);
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("attachment"); await P.settle(800);
await P.page.getByLabel("Upload a map, picture or PDF").setInputFiles(pdfPath);
for (let i = 0; i < 30; i++) { await wait(500); if (psql(`SELECT count(*) FROM imt_files WHERE parent_id IS NOT NULL`) !== "0") break; }
await P.settle(1200);
const pdfFile = psql("SELECT id FROM imt_files WHERE mime = 'application/pdf'");
const pageCount = Number(psql(`SELECT count(*) FROM imt_files WHERE parent_id = '${pdfFile}'`));
check("PDF pages turned into pictures in the browser (pdf.js)", pageCount >= 1 && psql(`SELECT mime FROM imt_files WHERE parent_id = '${pdfFile}' LIMIT 1`) === "image/jpeg", `pages ${pageCount}`);
// 205A from the 203 + Directory
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("205a"); await P.settle(900);
const f205a = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = '205a'`));
check("205A starts from the 203 with Directory phones", f205a.rows.some(r => r.name === "Olive Ops" && r.contact === "225-555-0142") && f205a.rows.some(r => r.name === "Ivan Incident"), JSON.stringify(f205a.rows));
// 207 org chart (drawn from the 203)
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("207"); await P.settle(800);
pb = await P.body();
check("207 org chart from the 203", /Incident Commander\(s\)/.test(pb) && /Operations Section Chief/.test(pb) && /Division\/Group: DIV A/.test(pb));
// 214 is yours
await P.page.getByRole("button", { name: "Add a form" }).click();
await P.page.getByLabel("Form to add").selectOption("214"); await P.settle(800);
await P.page.getByRole("button", { name: "Log an entry now" }).click();
await P.page.getByLabel("Activity 1 Notable activities").fill("Briefed Div A supervisor.");
await P.settle(1400);
const f214 = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per1}' AND kind = '214'`));
check("214 starts with my name; entry saved", f214.name === "Paula Planner" && f214.userId === uid("Paula Planner") && f214.log[0].text === "Briefed Div A supervisor." && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f214.log[0].at));
// one-of-a-kind forms can't be added twice
check("a second 202 refused", (await P.post(`/api/imt/periods/${per1}/forms`, { kind: "202" })).status === 400);
// Conflicting edit
const f208 = (await P.api(`/api/imt/periods/${per1}`)).body.forms.find(f => f.kind === "208");
check("stale save refused (two people editing)", (await P.post(`/api/imt/forms/${f208.id}`, { data: { message: "x" }, version: f208.version - 1 })).status === 409);
await P.page.screenshot({ path: "/home/claude/testrun/shot-imt-editor.png", fullPage: true });

// Print the IAP
await P.page.getByRole("button", { name: "Print IAP" }).click(); await P.settle(1500);
const printed = await P.page.evaluate(() => document.getElementById("imt-print-frame")?.contentDocument?.body?.innerText || "");
fs.writeFileSync(`${SCR}/iap-print.txt`, printed);
check("printed IAP: cover, forms in order, page numbers, draft mark", /INCIDENT ACTION PLAN/.test(printed) && /DRAFT - NOT APPROVED/.test(printed) && printed.indexOf("INCIDENT OBJECTIVES (ICS 202)") < printed.indexOf("ORGANIZATION ASSIGNMENT LIST (ICS 203)")
  && printed.indexOf("ORGANIZATION ASSIGNMENT LIST (ICS 203)") < printed.indexOf("ASSIGNMENT LIST (ICS 204)") && /IAP Page 1/.test(printed) && /Search all flooded homes/.test(printed)
  && /INCIDENT RADIO COMMUNICATIONS PLAN \(ICS 205\)/.test(printed) && /Example General Hospital/.test(printed) && /WEATHER FORECAST/.test(printed) && /ACTIVITY LOG \(ICS 214\)/.test(printed), printed.slice(0, 300));
const printHtml = await P.page.evaluate(() => document.getElementById("imt-print-frame").contentDocument.documentElement.outerHTML);
check("205 prints landscape; attachments as pictures", /class="page land"[^>]*>\s*<h1 class="form">INCIDENT RADIO COMMUNICATIONS PLAN/.test(printHtml) && /\/api\/imt\/files\//.test(printHtml) && /@page land/.test(printHtml));
await P.page.setViewportSize({ width: 850, height: 1100 });
fs.writeFileSync(`${SCR}/iap.html`, printHtml);

// ======= Access =======
const V = await person(); await V.login("victor@sgfd.org");
check("someone not named can't open the period", (await V.api(`/api/imt/periods/${per1}`)).status === 403 && (await V.api("/api/imt")).body.incidents.length === 0);
const O = await person(); await O.login("olive@sgfd.org");
check("someone named in the IAP (203/204) can read it", (await O.api(`/api/imt/periods/${per1}`)).status === 200 && (await O.api("/api/imt")).body.incidents.length === 1);
check("named but no edit access: can't change it", (await O.post(`/api/imt/forms/${f208.id}`, { data: { message: "hi" } })).status === 403);
check("Olive can't approve (not the IC)", (await O.post(`/api/imt/periods/${per1}/approve`, {})).status === 403);
// Notify
r0: {
  await P.page.setViewportSize({ width: 1400, height: 950 });
  await P.page.getByRole("button", { name: "Notify assigned" }).click(); await P.settle(800);
  const n = Number(psql(`SELECT count(*) FROM message_recipients r JOIN message_threads t ON t.id = r.thread_id WHERE t.subject LIKE 'IAP draft: Hurricane Zephyr Response%' AND r.via = 'Direct'`));
  check("notify messages everyone named with an account (IC, Ops, 214 author excluded as sender)", n === 2, n);
}

// ======= Approval by the IC =======
const I = await person(); await I.login("ivan@sgfd.org");
await I.nav("IMT"); await I.page.getByRole("button", { name: "Open Hurricane Zephyr Response" }).click(); await I.settle();
await I.page.getByRole("button", { name: "Open period 1" }).click(); await I.settle(900);
await I.page.getByRole("button", { name: "Approve" }).click(); await I.settle(300);
const pad = I.page.locator("canvas").first(); const bb = await pad.boundingBox();
await I.page.mouse.move(bb.x + 20, bb.y + 40); await I.page.mouse.down(); await I.page.mouse.move(bb.x + 120, bb.y + 60, { steps: 6 }); await I.page.mouse.move(bb.x + 200, bb.y + 30, { steps: 6 }); await I.page.mouse.up();
await I.page.getByRole("button", { name: /^Approve \(with signature\)/ }).click(); await I.settle(900);
check("IC (named on the 203) approves with a signature", psql(`SELECT status || '|' || approved_name || '|' || (approved_signature IS NOT NULL) FROM imt_periods WHERE id = '${per1}'`) === "approved|Ivan Incident|true");
check("approved IAP is locked", (await P.post(`/api/imt/forms/${f208.id}`, { data: { message: "late change" } })).status === 409 && /Locked/.test(await I.body()));
await I.page.getByRole("button", { name: "Print IAP" }).click(); await I.settle(1200);
const printed2 = await I.page.evaluate(() => document.getElementById("imt-print-frame")?.contentDocument?.documentElement?.outerHTML || "");
check("approved print: no draft mark, signature on the 202", !/DRAFT - NOT APPROVED/.test(printed2) && /Approved by Ivan Incident/.test(printed2) && /data:image\/png;base64/.test(printed2));
await I.page.screenshot({ path: "/home/claude/testrun/shot-imt-approved.png" });

// ======= Period 2: copy of period 1 =======
await P.page.getByRole("button", { name: /^Hurricane Zephyr Response/ }).first().click(); await P.settle(800);
await P.page.getByRole("button", { name: "New operational period" }).click();
check("next period defaults follow on", (await P.page.getByLabel("Starts").inputValue()) === "2026-11-11T19:00" && (await P.page.getByLabel("Ends").inputValue()) === "2026-11-12T07:00");
await P.page.getByRole("button", { name: "Start the period" }).click(); await P.settle(1000);
const per2 = psql("SELECT id FROM imt_periods WHERE seq = 2");
const k2 = psql(`SELECT string_agg(kind, ',' ORDER BY sort) FROM imt_forms WHERE period_id = '${per2}'`);
check("period 2 copies the forms (not the 214 log), new forecast needed", !/214/.test(k2) && /202/.test(k2) && (k2.match(/204/g) || []).length === 2 && JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per2}' AND kind = 'weather'`)).snapshot === null, k2);
check("period 2 starts as a draft, objectives carried over", psql(`SELECT status FROM imt_periods WHERE id = '${per2}'`) === "draft" && JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${per2}' AND kind = '202'`)).objectives.length === 2);
check("period 1 untouched", psql(`SELECT status FROM imt_periods WHERE id = '${per1}'`) === "approved");
check("bad period times refused", (await P.post(`/api/imt/incidents/${incId}/periods`, { starts: "2026-11-12T07:00", ends: "2026-11-12T06:00" })).status === 400);

// ======= Reopen (Mike, manage) =======
check("reopen by IMT manager", (await M.post(`/api/imt/periods/${per1}/reopen`, { reason: "Fix a frequency" })).status === 200 && psql(`SELECT status FROM imt_periods WHERE id = '${per1}'`) === "draft");

// ======= Share with everyone =======
await M.post(`/api/imt/periods/${per1}/approve`, {});
await M.post("/api/imt/incidents", { id: incId, name: "Hurricane Zephyr Response", number: "LA-TEST-2026-01", kind: "Hurricane / tropical storm", location: "100 Main St, Example, LA", lat: 30.41, lon: -91.05, description: "x", shareAll: true, status: "active" });
const vi = (await V.api(`/api/imt/incidents/${incId}`)).body;
check("share with everyone: approved periods readable, drafts not", (await V.api(`/api/imt/periods/${per1}`)).status === 200 && (await V.api(`/api/imt/periods/${per2}`)).status === 403 && vi.periods.length === 1);

// ======= Start from an IAP PDF (Claude stand-in) =======
await M.nav("Start from an IAP PDF");
await M.page.getByLabel("IAP PDF").setInputFiles(pdfPath);
await M.page.getByRole("button", { name: "Read the IAP" }).click(); await M.settle(1500);
let mb = await M.body();
check("IAP PDF read: summary of what was found", /Found 2 objectives, 4 positions, 2 assignment lists, 1 radio channels, 1 hospitals, a safety message, 1 aircraft/.test(mb) && ai.at(-1).hasDoc, mb.slice(mb.indexOf("Start from an IAP"), mb.indexOf("Start from an IAP") + 500));
check("period times read from the PDF", (await M.page.getByLabel("Period starts").inputValue()) === "2026-11-12T07:00");
await M.page.getByRole("button", { name: "Create the period" }).click(); await M.settle(1200);
const inc2 = psql("SELECT id FROM imt_incidents WHERE id <> '" + incId + "'");
const p3 = psql(`SELECT id FROM imt_periods WHERE incident_id = '${inc2}'`);
const kinds3 = psql(`SELECT string_agg(kind, ',' ORDER BY sort) FROM imt_forms WHERE period_id = '${p3}'`);
check("new incident + period built from the PDF", /^cover,202,203,204,204,205,206,208,220,weather$/.test(kinds3), kinds3);
const i203 = JSON.parse(psql(`SELECT data FROM imt_forms WHERE period_id = '${p3}' AND kind = '203'`));
check("imported 203 lands in the right slots", i203.rows.find(r => r.section === "command" && r.role === "IC/UCs").name === "Iris Example" && i203.rows.some(r => r.label === "ZONE 3" && r.name === "Gus Example") && i203.rows.some(r => r.section === "agency" && r.agency === "Example Sheriff"));
check("imported period is a draft to check", psql(`SELECT status FROM imt_periods WHERE id = '${p3}'`) === "draft" && /Hurricane Zephyr Response/.test(psql(`SELECT name FROM imt_incidents WHERE id = '${inc2}'`)));
check("edit level can't import", (await P.post("/api/imt/import", { fileName: "a.pdf", data: "AAAA" })).status === 403);
await M.page.screenshot({ path: "/home/claude/testrun/shot-imt-imported.png" });

// ======= Audit and cleanup =======
check("IMT audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'IMT'")) >= 10);
check("delete a draft period (manage)", (await M.post(`/api/imt/periods/${per2}/remove`, {})).status === 200 && psql(`SELECT count(*) FROM imt_periods WHERE id = '${per2}'`) === "0");
check("approved period can't be deleted", (await M.post(`/api/imt/periods/${per1}/remove`, {})).status === 409);
check("no page errors", errors.length === 0, errors.join(" | "));
done();
mock.close();
await browser.close();
