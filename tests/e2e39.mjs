// Fire Prevention inspections (import, coverage, PIAL 1022) and permission profiles + the By person matrix. Fictional people and properties only.
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
psql("INSERT INTO divisions (name) VALUES ('Fire Prevention') ON CONFLICT DO NOTHING");
const PEOPLE = [["Pat Prevention", "pat", "Fire Inspector", "Fire Prevention", "weekdays"], ["Bob Battalion", "bob", "Battalion Chief", "Suppression", "fire:A"],
  ["Carl Chief", "carl", "Fire Chief", "Administration", "weekdays"], ["Gina Gray", "gina", "Firefighter", "Suppression", "fire:A"]];
for (const [n, e, , div] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: div, password: PW });
await M.login("mike@sgfd.org");
psql("INSERT INTO divisions (name) VALUES ('Administration') ON CONFLICT DO NOTHING");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const p = PEOPLE.find(x => `${x[1]}@sgfd.org` === a.email);
  await M.post("/api/auth/approve", { id: a.id, role: "user", division: p[3] });
}
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t, , wp] of PEOPLE) psql(`UPDATE users SET job_title = '${t}', work_pattern = '${wp}' WHERE full_name = '${n}'`);
check("divisions set", psql("SELECT d.name FROM users u JOIN divisions d ON d.id = u.division_id WHERE full_name = 'Pat Prevention'") === "Fire Prevention");

// ---- A made-up FireWorks report: 12 St. George properties, 2 Baton Rouge, property 3 repeated (two inspections) ----
const Y = TODAY.slice(0, 4), LAST = String(Number(Y) - 1);
const d1 = `${Y}-02-10`, d2 = `${Y}-03-15`, old = `${LAST}-06-01`;
const HDR = ["Property #", "Address", "Unit/Suite", "Property Description", "Neighborhood", "Box", "Zone", "Fire District", "Date1", "Inspector1", "Date2", "Inspector2", "Date3", "Inspector3"];
const PROPS = [];
for (let k = 1; k <= 12; k++) PROPS.push([1000 + k, `${100 + k} Example Rd Baton Rouge LA 70800`, k === 5 ? "Ste-2" : "", `Sample Business ${k}`, k <= 6 ? "Alpha" : "Bravo", k % 2 ? "61" : "64", "1100", "St. George Fire"]);
PROPS.push([2001, "1 Other Dept St", "", "Outside Co", "Alpha", "61", "1", "Baton Rouge Fire"], [2002, "2 Other Dept St", "", "Outside Co 2", "Alpha", "61", "1", "Baton Rouge Fire"]);
const insp = { 1001: [[d1, "Ian Inspector"]], 1002: [[d1, "Ian Inspector"]], 1003: [[d1, "Ian Inspector"], [d2, "Olga Officer"]], 1004: [[d2, "Olga Officer"]], 1005: [[d2, "Olga Officer"]],
  1006: [[d2, "Ian Inspector"]], 1007: [[d1, "Ian Inspector"]], 1008: [[old, "Ian Inspector"]], 2001: [[d1, "Ian Inspector"]] };
const csvOf = props => [HDR, ...props.flatMap(p => {
  const list = insp[p[0]] || [];
  if (p[0] === 1003) return [[...p, ...list[0], "", "", "", ""], [...p, ...list[1], "", "", "", ""]];          // repeated row, like the real export
  return [[...p, ...(list[0] || ["", ""]), "", "", "", ""]];
})].map(r => r.map(v => /[,"]/.test(String(v)) ? `"${v}"` : v).join(",")).join("\n");
fs.writeFileSync(`${SCR}/insp-test.csv`, csvOf(PROPS));

const P = await person(); await P.login("pat@sgfd.org");
const G = await person(); await G.login("gina@sgfd.org");
const B = await person(); await B.login("bob@sgfd.org");
const Cc = await person(); await Cc.login("carl@sgfd.org");
check("a firefighter can't open Fire Prevention or see the tile", (await G.api("/api/fireprev")).status === 403 && !/Fire Prevention/.test(await G.body()));
check("the Fire Prevention division sees the tile without a grant", /Fire Prevention/.test(await P.body()));

// ======= Pat imports (UI) =======
await P.nav("Fire Prevention");
check("empty state asks for the report", /No inspection report imported yet/.test(await P.body()));
await P.nav("Import report");
await P.page.getByLabel("Inspection report file").setInputFiles(`${SCR}/insp-test.csv`);
await P.page.getByRole("button", { name: "Check the file" }).click(); await P.settle(800);
const pv = await P.page.getByRole("region", { name: "Import preview" }).innerText();
check("preview: 15 rows -> 14 properties, 10 dates, districts", /15 rows → 14 properties with 10 inspection dates/.test(pv) && /St\. George Fire 12 · Baton Rouge Fire 2/.test(pv), pv);
check("nothing stored by the preview", psql("SELECT count(*) FROM fp_properties") === "0");
await P.page.getByRole("button", { name: "Import", exact: true }).click(); await P.settle(1200);
check("imported: 14 properties, 10 inspections, repeated row merged", psql("SELECT count(*) FROM fp_properties") === "14" && psql("SELECT count(*) FROM fp_inspections") === "10"
  && psql("SELECT count(*) FROM fp_inspections WHERE property_no = '1003'") === "2");
check("audit row", psql("SELECT count(*) FROM audit_log WHERE module = 'Fire Prevention' AND action = 'Imported inspections'") === "1");
let ov = (await P.api(`/api/fireprev?year=${Y}`)).body;
check("coverage: 12 counted (Baton Rouge left out), 7 inspected this year", ov.totals.counted === 12 && ov.totals.inspected === 7 && ov.totals.other === 2, JSON.stringify(ov.totals));
check("PIAL 1022: 8 × 7/12 = 4.67", ov.pial.points === 4.67 && ov.pial.credit === 0.257, JSON.stringify(ov.pial));
check("by area and station", ov.byArea.find(a => a.name === "Alpha").done === 6 && ov.byArea.find(a => a.name === "Bravo").done === 1 && ov.byBox.length === 2);
check("by inspector counts properties", ov.byInspector.find(i => i.name === "Ian Inspector").properties === 5 && ov.byInspector.find(i => i.name === "Olga Officer").properties === 3, JSON.stringify(ov.byInspector));
const body1 = await P.body();
await P.page.screenshot({ path: "/home/claude/testrun/shot-fp.png", fullPage: true });
check("overview page shows the PIAL estimate and what's left", /4\.67 \/ 8/.test(body1) && /Not inspected yet\s*5/i.test(body1), body1.slice(0, 600));

// ======= Not inspected list, property dialog =======
await P.page.getByRole("button", { name: /Properties not inspected \(5\)/ }).click(); await P.settle(900);
let lst = await P.body();
check("list: the 5 not inspected (incl. one inspected only last year)", ["108 Example", "109 Example", "110 Example", "111 Example", "112 Example"].every(a => lst.includes(a)) && !lst.includes("101 Example") && /5 properties/.test(lst));
check("last year's inspection shown as the last one", lst.includes(new Date(`${old}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })));
await P.page.getByLabel("Search properties").fill("112 Example"); await P.settle(900);
await P.page.getByRole("button", { name: "Open property 1012" }).click(); await P.settle(700);
const dlg = P.page.getByRole("dialog", { name: "Property" });
check("property dialog: no inspection on file", /No inspection on file/.test(await dlg.innerText()));
await dlg.getByRole("button", { name: "Leave out" }).click(); await P.settle(500);
check("leaving out needs a reason", /Say why/.test(await dlg.innerText()));
await dlg.getByLabel("Reason to leave out").fill("Demolished in March"); await dlg.getByRole("button", { name: "Leave out" }).click(); await P.settle(700);
check("left out with the reason", psql("SELECT excluded || ':' || exclude_reason || ':' || excluded_by FROM fp_properties WHERE property_no = '1012'") === "true:Demolished in March:Pat Prevention");
await dlg.getByRole("button", { name: "Close" }).click(); await P.settle(300);
await P.page.getByLabel("Search properties").fill("111 Example"); await P.settle(900);
await P.page.getByRole("button", { name: "Open property 1011" }).click(); await P.settle(700);
await dlg.getByLabel("Inspection date").fill(TODAY); await dlg.getByLabel("Inspector").fill("Ian Inspector");
await dlg.getByRole("button", { name: "Record inspection" }).click(); await P.settle(700);
check("manual inspection recorded", psql("SELECT source || ':' || created_by FROM fp_inspections WHERE property_no = '1011'") === "manual:Pat Prevention");
check("future dates refused", (await P.post("/api/fireprev/properties/1011/inspections", { day: `${Number(Y) + 1}-01-01`, inspector: "X" })).status === 400);
await dlg.getByRole("button", { name: "Close" }).click();
ov = (await P.api(`/api/fireprev?year=${Y}`)).body;
check("now 8 of 11 = 5.82 points", ov.totals.counted === 11 && ov.totals.inspected === 8 && ov.pial.points === 5.82, JSON.stringify(ov.pial));
const csv = await P.page.evaluate(async y => (await fetch(`/api/fireprev/export.csv?year=${y}&status=not`)).text(), Y);
check("CSV of the ones left", csv.split("\r\n").length === 4 && /108 Example/.test(csv) && /Not inspected/.test(csv));

// ======= PIAL item 1022 uses it =======
const pial = (await M.api("/api/pial")).body;
const it = pial.items.find(i => i.key === "p1022");
check("PIAL 1022 calculated from Fire Prevention", it.method === "calculated" && Math.abs(it.credit - 0.44 * 8 / 11) < 0.002 && /8 of 11 properties inspected/.test(it.detail.join(" ")), JSON.stringify([it.method, it.credit, it.detail]));

// ======= Re-import without property 1010; settings =======
const fewer = PROPS.filter(p => p[0] !== 1010);
insp[1009] = [[d2, "Olga Officer"]];
fs.writeFileSync(`${SCR}/insp-test2.csv`, csvOf(fewer));
const b64 = fs.readFileSync(`${SCR}/insp-test2.csv`).toString("base64");
const re = (await P.post("/api/fireprev/import", { fileName: "insp-test2.csv", data: b64 })).body;
check("re-import: 1 new inspection, 1 dropped, manual one kept", re.newInspections === 1 && re.dropped === 1 && psql("SELECT active FROM fp_properties WHERE property_no = '1010'") === "f"
  && psql("SELECT count(*) FROM fp_inspections WHERE property_no = '1011'") === "1", JSON.stringify(re));
check("Pat (edit) can't change settings", (await P.post("/api/fireprev/settings", { partialRecords: true })).status === 403);
check("master: partial records -25%", (await M.post("/api/fireprev/settings", { partialRecords: true })).status === 200 && (await M.api(`/api/fireprev?year=${Y}`)).body.pial.factor === 0.75);
await M.post("/api/fireprev/settings", { partialRecords: false, districts: { "St. George Fire": true, "Baton Rouge Fire": true } });
check("counting another district changes the total", (await M.api(`/api/fireprev?year=${Y}`)).body.totals.counted === 12);
await M.post("/api/fireprev/settings", { districts: { "St. George Fire": true, "Baton Rouge Fire": false } });

// ======= Profiles =======
let acc = (await M.api("/api/access")).body;
check("four built-in profiles", ["Basic", "Chief Officer", "Division Head / Deputy Chief", "Fire Chief"].every(n => acc.profiles.some(p => p.name === n)));
const fc = acc.profiles.find(p => p.key === "firechief");
check("Fire Chief = view of every section that has a view level, no edit/manage", Object.values(fc.levels).every(l => l === "view") && fc.levels.fireprev === "view" && fc.levels.audit === "view" && fc.levels.stats === "view" && !fc.levels.callout && !fc.levels.forms, JSON.stringify(fc.levels));
check("Bob: no Fire Prevention yet", (await B.api("/api/fireprev")).status === 403);
// Master gives Chief Officer on Bob's By person page (UI)
await M.nav("User Management"); await M.nav("By person");
await M.page.getByRole("button", { name: /Bob Battalion/ }).click(); await M.settle(400);
let matrix = M.page.getByRole("table", { name: "Access for Bob Battalion" });
check("matrix before: Fire Prevention hidden, Training shows (Basic) with the job-title note", /Hidden/.test(await matrix.getByRole("row", { name: "Fire Prevention" }).innerText())
  && /Shows[\s\S]*Basic[\s\S]*battalion chief/i.test(await matrix.getByRole("row", { name: "Training" }).innerText()), await matrix.getByRole("row", { name: "Training" }).innerText());
await M.page.getByLabel("Give a profile").selectOption({ label: "Chief Officer" }); await M.page.getByRole("button", { name: "Give", exact: true }).click(); await M.settle(800);
matrix = M.page.getByRole("table", { name: "Access for Bob Battalion" });
const fpRow = await matrix.getByRole("row", { name: "Fire Prevention" }).innerText();
check("matrix after: Fire Prevention shows, View, from the profile, says what View allows", /Shows/.test(fpRow) && /View/.test(fpRow) && /Profile: Chief Officer/.test(fpRow) && /See inspection coverage/.test(fpRow), fpRow);
await M.page.screenshot({ path: "/home/claude/testrun/shot-matrix.png", fullPage: true });
check("matrix: audit log still hidden for Bob", /Hidden/.test(await matrix.getByRole("row", { name: "Audit log" }).innerText()));
check("Bob can now view Fire Prevention and sick leave, not import", (await B.api("/api/fireprev")).status === 200 && (await B.api("/api/sick")).status === 200
  && (await B.post("/api/fireprev/import", { fileName: "x.csv", data: b64 })).status === 403);
// Pat's matrix shows the automatic division rule
await M.page.getByRole("button", { name: /Pat Prevention/ }).click(); await M.settle(400);
check("Pat's matrix: Fire Prevention edit, automatic (division)", /Edit[\s\S]*automatic: Fire Prevention division/.test(await M.page.getByRole("table", { name: "Access for Pat Prevention" }).getByRole("row", { name: "Fire Prevention" }).innerText()));

// Profiles page: give Fire Chief to Carl, edit Chief Officer, reset
await M.nav("Profiles");
const fcCard = M.page.getByRole("region", { name: "Profile Fire Chief" });
await fcCard.getByLabel("Give Fire Chief to").selectOption({ label: "Carl Chief — Administration" }); await fcCard.getByRole("button", { name: "Give", exact: true }).click(); await M.settle(700);
const me = (await Cc.api("/api/access/me")).body;
check("Carl (Fire Chief) sees everything, manages nothing", me.manages.length === 0 && ["audit", "stats", "fireprev", "pial", "sick", "leave", "imt", "evals", "recall"].every(s => me.grants.some(g => g.section === s && g.level === "view")));
check("Carl: audit log and stats open; changing PIAL settings refused", (await Cc.api("/api/audit")).status === 200 && (await Cc.api("/api/stats/meta").then(r => r.status !== 403))
  && (await Cc.post("/api/fireprev/settings", { partialRecords: true })).status === 403);
check("nothing stored for the built-in Fire Chief profile (new sections reach it on update)", psql("SELECT count(*) FROM access_profiles") === "0");
await M.page.screenshot({ path: "/home/claude/testrun/shot-profiles.png", fullPage: true });
const coCard = M.page.getByRole("region", { name: "Profile Chief Officer" });
await coCard.getByRole("button", { name: "Edit" }).click(); await M.settle(400);
await M.page.getByLabel("Sick leave level").selectOption(""); await M.page.getByLabel("Comms statistics level").selectOption("view");
await M.page.getByRole("button", { name: "Save profile" }).click(); await M.settle(700);
check("built-in change saved as a difference only", psql("SELECT levels::text FROM access_profiles WHERE key = 'chief'") === '{"add": {"stats": "view"}, "remove": ["sick"]}', psql("SELECT levels::text FROM access_profiles"));
check("Bob lost sick leave, gained stats", (await B.api("/api/sick")).status === 403 && (await B.api("/api/access/me")).body.grants.some(g => g.section === "stats"));
check("card says CHANGED HERE", /CHANGED HERE/.test(await M.page.getByRole("region", { name: "Profile Chief Officer" }).innerText()));
await M.page.getByRole("region", { name: "Profile Chief Officer" }).getByRole("button", { name: "Reset to default" }).click(); await M.settle(700);
check("reset puts it back", psql("SELECT count(*) FROM access_profiles") === "0" && (await B.api("/api/sick")).status === 200);
// Custom profile given to a group
const cp = await M.post("/api/access/profiles", { name: "Inspectors", description: "Fire Prevention edit", levels: { fireprev: "edit", training: "view" } });
const aShift = psql("SELECT id FROM access_groups WHERE name = 'A-Shift'");
await M.post(`/api/access/profiles/${cp.body.key}/assign`, { groupIds: [aShift] });
check("custom profile through a group: Gina (A-Shift) can import", (await G.post("/api/fireprev/import", { fileName: "insp-test2.csv", data: b64, preview: true })).status === 200);
check("only masters change profiles", (await P.post("/api/access/profiles", { name: "x", levels: {} })).status === 403);
check("duplicate names refused", (await M.post("/api/access/profiles", { name: "fire chief", levels: {} })).status === 409);
await M.post(`/api/access/profiles/${cp.body.key}/remove`, {});
check("deleting the custom profile takes its access away", (await G.api("/api/fireprev")).status === 403 && psql("SELECT count(*) FROM access_profile_members WHERE profile_key LIKE 'p-%'") === "0");
check("audit trail for profiles", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Permissions' AND action LIKE '%profile%'")) >= 5);
check("Bob's main menu now has Fire Prevention", (await B.page.goto(BASE), await B.settle(1200), /Fire Prevention/.test(await B.body())));

check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close();
try { process.kill(srv.pid); } catch {}
mock.close();
process.exit(0);
