// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(350); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) body = await res.json(); else { const b = new Uint8Array(await res.arrayBuffer()); body = { size: b.length }; }
    return { status: res.status, body, ct };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const L = label => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await L("Email").fill(email); await L("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };
const body = async () => page.locator("body").innerText();
import http from "node:http";
import fs from "node:fs";
const require_text = p => fs.readFileSync(p, "utf8");
import { execSync, spawn } from "node:child_process";


// Realistic shift (made-up names)
let MID = 500; const P = (name, from = "07:00", to = "07:00", trade = false) => { MID++; MEMBERS.push({ member_id: MID, first_name: name.split(" ")[0], last_name: name.split(" ")[1] || "" }); return { id: MID, from, to, trade }; };
const MEMBERS = [{ member_id: 901, first_name: "Ryan", last_name: "Off" }, { member_id: 902, first_name: "Kyle", last_name: "Leave" }];
const SCHED = [
  ["SG005", [P("Wade Chief")]], ["SG006", [P("Randy Chief")]],
  ["SQ605", [P("Blake A"), P("Caleb B"), P("Jamie C")]], ["MD607", [P("George F", "19:00", "07:00")]],
  ["EG613", [P("Jon D"), P("Barrett E")]], ["LD618", [P("Jeff G")]],
  ["EG633", [P("David H", "07:00", "07:00", true), P("James F", "07:00", "12:00"), P("Jason H", "12:00", "16:00"), P("James F2", "16:00", "07:00")]],
  ["MD687", [P("George F2", "07:00", "19:00"), P("Stephen G", "19:00", "07:00")]],
  ["Communications", [P("Dusty Day", "07:00", "19:00"), P("Lauren Day", "07:00", "19:00"), P("Randall Night", "19:00", "07:00"), P("Ralph Night", "19:00", "07:00")]],
  ["Special Detail/Training (Comms)", [P("Corey Mounce", "07:00", "19:00")]],
  ["SWOF", [P("Michael Ricks")]],
];
const dt = (day, hm, next = false) => { const d = new Date(day + "T00:00"); const [h] = hm.split(":").map(Number); if (next && h <= 7) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${hm}`; };
const onNow = p => { const h = new Date().getHours() + new Date().getMinutes() / 60; const f = +p.from.slice(0, 2), t = +p.to.slice(0, 2); return f < t ? h >= f && h < t : (h >= f || h < t); };
// ---- A stand-in for Aladtec's API
let tokenCalls = 0;
const mock = http.createServer((req, res) => {
  const out = j => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.url === "/oauth/token" && req.method === "POST") { tokenCalls++; return out({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }); }
  if (req.headers.authorization !== "Bearer tok") { res.writeHead(401); return res.end("{}"); }
  if (req.url.startsWith("/schedules")) return out(SCHED.map((u, k) => ({ schedule_id: k + 1, name: u[0], order: k, positions: u[1].map((p, n) => ({ position_id: (k + 1) * 10 + n, label: "", order: n })) })));
  if (req.url.startsWith("/members")) return out(MEMBERS);
  if (req.url.startsWith("/scheduled-time/members-scheduled-now")) return out(SCHED.map((u, k) => ({ schedule_id: String(k + 1), positions: u[1].map((p, n) => ({ p, n })).filter(x => onNow(x.p)).map(x => ({ position_id: String((k + 1) * 10 + x.n), member_id: String(x.p.id) })) })).filter(b => b.positions.length));
  if (req.url.startsWith("/scheduled-time?")) {
    const u = new URL(req.url, "http://x"); const day = u.searchParams.get("range_start").slice(0, 10);
    const recs = []; SCHED.forEach((s, k) => s[1].forEach((p, n) => recs.push({ member_id: p.id, schedule_id: k + 1, position_id: (k + 1) * 10 + n, time_type: p.trade ? "Trade" : "Regular",
      start_datetime: dt(day, p.from), stop_datetime: dt(day, p.to, true), extends_before: false, extends_after: false })));
    return out({ [day]: recs });
  }
  if (req.url.startsWith("/time-off?")) {
    const u = new URL(req.url, "http://x"); const day = u.searchParams.get("range_start").slice(0, 10);
    return out({ [day]: [ { time_off_id: 1, member_id: 901, time_off_type: "OV - Vacation", status: "Approved", start_datetime: dt(day, "07:00"), stop_datetime: dt(day, "07:00", true) },
      { time_off_id: 2, member_id: 902, time_off_type: "TL - Training Leave", status: "Approved", start_datetime: dt(day, "07:00"), stop_datetime: dt(day, "19:00", true) } ] });
  }
  res.writeHead(404); res.end("{}");
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
// Restart the app server with Aladtec settings
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) {   // wait until the old server has let go of the port
  const up = await fetch(BASE + "/api/health").then(() => true, () => false);
  if (!up) break;
  await new Promise(r => setTimeout(r, 200));
}
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")], detached: true,
  env: { ...process.env, ALADTEC_BASE_URL: "http://127.0.0.1:3099", ALADTEC_CLIENT_ID: "id", ALADTEC_CLIENT_SECRET: "secret" } });
srv.unref();
execSync(`echo ${srv.pid} > /home/claude/testrun/app/server.pid`);
await new Promise(r => setTimeout(r, 5000));

// ---- People
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const signup = async (n, e) => reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
for (const [n, e] of [["Fred Floor", "fred"], ["Dana Dir", "dana"], ["Alex Accounts", "alex"], ["Fiona Forms", "fiona"]]) await signup(n, e);
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
await signup("Pat Pending", "pat");
let roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;

// ---- Mike gives out admin duties in User Management
await tile("User Management");
await page.getByRole("button", { name: "People & roles", exact: true }).click(); await settle();
for (const [who, duty] of [["Dana Dir", "Directory admin"], ["Alex Accounts", "Accounts admin"], ["Fiona Forms", "Forms admin"]]) {
  await page.getByLabel(`Edit ${who}`).click(); await settle();
  await page.getByLabel(`${duty} for ${who}`).check();
  await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
}
roster = await read("roster");
check("admin duties saved", roster.find(u => u.name === "Dana Dir").permissions.directoryAdmin.length === 1 &&
  roster.find(u => u.name === "Alex Accounts").permissions.accountsAdmin.length === 1 && roster.find(u => u.name === "Fiona Forms").permissions.formsAdmin.length === 1);
check("user list shows the duties", /directory admin/.test(await body()) && /accounts admin/.test(await body()) && /forms admin/.test(await body()));
await page.getByRole("button", { name: "Main menu" }).first().click(); await settle();

// ---- Fred fills in his card
await login("fred@sgfd.org");
await tile("Directory");
check("directory opens on Everyone, grouped by division", /Everyone/.test(await body()) && /SUPPRESSION/i.test(await body()) && /Mike Admin/.test(await body()));
check("starter stations are there", (await api("/api/directory")).body.places.filter(p => p.kind === "station").length === 8);
await page.getByRole("navigation").getByRole("button", { name: /^My card/ }).click(); await settle();
await page.getByRole("button", { name: "Edit Fred Floor's card" }).click(); await settle();
await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill("Firefighter");
await page.getByRole("dialog").getByLabel("Home station", { exact: true }).fill("61");
await page.getByRole("dialog").getByLabel("Cell phone", { exact: true }).fill("225-555-1111");
await page.getByRole("dialog").getByLabel("Home phone", { exact: true }).fill("225-555-2222");
await page.getByRole("dialog").getByLabel("Extension", { exact: true }).fill("4101");
await page.getByRole("dialog").getByLabel("Emergency contact name", { exact: true }).fill("Fran Floor");
await page.getByRole("dialog").getByLabel("Emergency contact relationship", { exact: true }).fill("Spouse");
await page.getByRole("dialog").getByLabel("Emergency contact phone", { exact: true }).fill("225-555-3333");
await page.getByRole("button", { name: "Save card" }).click(); await settle();
let d = (await api("/api/directory")).body;
const fred = d.people.find(p => p.name === "Fred Floor");
check("Fred's card saved", fred.jobTitle === "Firefighter" && fred.station === "61" && fred.homePhone === "225-555-2222" && fred.extension === "4101" && fred.emergency.relationship === "Spouse", JSON.stringify(fred));
check("card shows tap-to-call and private fields to Fred", /225-555-2222/.test(await body()) && /Fran Floor \(Spouse\)/.test(await body()));
check("Fred doesn't get Mike's home phone or emergency contact", !("homePhone" in d.people.find(p => p.name === "Mike Admin")) && !("emergency" in d.people.find(p => p.name === "Mike Admin")));
let r = await post(`/api/directory/people/${id("Mike Admin")}`, { cellPhone: "1" });
check("Fred can't edit Mike's card", r.status === 403);
r = await post("/api/directory/places", { kind: "outside", name: "Hack" });
check("Fred can't add places", r.status === 403);
r = await post("/api/directory/verification/start", {});
check("Fred can't start a directory check", r.status === 403);
check("Fred has no admin pages", await page.getByRole("button", { name: "Directory check", exact: true }).count() === 0);

// ---- Dana (directory admin) sets up Station 61 and an outside contact
await login("dana@sgfd.org");
d = (await api("/api/directory")).body;
check("directory admin sees Fred's private details", d.people.find(p => p.name === "Fred Floor").homePhone === "225-555-2222" && d.canAdmin === true);
await tile("Directory");
await page.getByRole("navigation").getByRole("button", { name: /^Fire stations/ }).click(); await settle();
await page.getByRole("button", { name: "Edit Station 61" }).click(); await settle();
await page.getByRole("dialog").getByLabel("Address", { exact: true }).fill("1234 Station Rd");
await page.getByRole("dialog").getByLabel("Phone", { exact: true }).fill("225-555-6100");
await page.getByRole("dialog").getByLabel("Fax", { exact: true }).fill("225-555-6101");
await page.getByRole("dialog").getByLabel("Short code", { exact: true }).fill("4461");
await page.getByRole("dialog").getByLabel("Aladtec match", { exact: true }).fill("61, M61");
await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await settle();
check("station card shows address, phone, fax, short code", /1234 Station Rd/.test(await body()) && /225-555-6100/.test(await body()) && /225-555-6101/.test(await body()) && /4461/.test(await body()));
await page.getByRole("navigation").getByRole("button", { name: /^Outside contacts/ }).click(); await settle();
await page.getByRole("button", { name: "+ Add contact" }).click(); await settle();
await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Ochsner Medical Center");
await page.getByRole("dialog").getByLabel("Category", { exact: true }).fill("Hospital");
await page.getByRole("dialog").getByLabel("Phone", { exact: true }).fill("225-555-7000");
await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click(); await settle();
check("outside contact listed under its category", /HOSPITAL/i.test(await body()) && /Ochsner Medical Center/.test(await body()));

// ---- Aladtec on duty
execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -qc "UPDATE directory_places SET aladtec_match = '??' || number || '*' WHERE kind = 'station'"`);
await home(); await tile("Directory");
await page.getByRole("navigation").getByRole("button", { name: "Aladtec setup", exact: true }).click(); await settle();
check("Aladtec shows connected", /connected/.test(await body()), (await body()).slice(0, 300));
await page.getByRole("button", { name: /Check now/ }).click(); await settle();
await page.setViewportSize({ width: 1300, height: 1400 });
await page.screenshot({ path: "/home/claude/testrun/shot-dutyboard.png", fullPage: true });
console.log((await body()).slice(0, 4000));
// Your Day widget, as Fred (regular user: no leave types)
await login("fred@sgfd.org");
await page.setViewportSize({ width: 1350, height: 1100 });
const w = page.getByRole("region", { name: "On duty today roster" });
await w.waitFor({ timeout: 8000 });
console.log("WIDGET-TEXT:" + (await w.innerText()).replace(/\n/g, " | "));
console.log("WIDGET-SCROLLS:" + await w.evaluate(e => e.scrollHeight > e.clientHeight));
await w.scrollIntoViewIfNeeded();
await page.screenshot({ path: "/home/claude/testrun/shot-widget.png" });
const fredDuty = await api("/api/directory/duty");
console.log("FRED-TIMEOFF:" + JSON.stringify(fredDuty.body.timeOff) + " ERR:" + JSON.stringify(fredDuty.body.todayError));
await browser.close(); process.exit(0);
