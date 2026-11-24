// Force Back lists, Time Tracker team picker, System page (updates via a stand-in updater), PIAL certification-progress import.
// Fictional people only. Run with: SYSTEM_DIR=/home/claude/testrun/sysroot UPDATER_COMMAND="node /home/claude/testrun/fake-updater.mjs"
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };
const b64 = f => fs.readFileSync(f).toString("base64");
const SYS = process.env.SYSTEM_DIR || "/home/claude/testrun/sysroot";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
async function person(email) {
  const ctx = await browser.newContext({ viewport: { width: 1350, height: 950 }, timezoneId: "America/Chicago" });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const settle = async (ms = 350) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  const api = (path, body) => page.evaluate(async ([path, body]) => {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, body]);
  await page.goto(BASE); await settle();
  if (email) { await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW); await page.getByRole("button", { name: "Sign in" }).click(); await settle(1200); }
  return { ctx, page, api, settle, errors };
}
const nav = async (P, label) => { await P.page.locator("nav button", { hasText: label }).first().click(); await P.settle(500); };

// ---- Setup ----
const M = await person(null);
await M.api("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
psql("INSERT INTO divisions (name) VALUES ('Suppression'), ('Communications') ON CONFLICT DO NOTHING");
const PEOPLE = [["Ann", "Ridley", "ann", "Communications", "comms:D"], ["Ben", "Bravo", "ben", "Communications", "comms:C"], ["Cora", "Coyle", "cora", "Communications", "comms:A"],
  ["Dan", "Delta", "dan", "Suppression", "fire:A"], ["Eve", "Echo", "eve", "Suppression", "fire:B"], ["Fay", "Foxtrot", "fay", "Suppression", "fire:A"]];
for (const [f, l, e, d] of PEOPLE) await M.api("/api/auth/signup", { firstName: f, lastName: l, email: `${e}@sgfd.org`, division: d, password: PW });
await M.page.goto(BASE); await M.settle(800);
if (await M.page.getByLabel(/^Email/).count()) { await M.page.getByLabel(/^Email/).fill("mike@sgfd.org"); await M.page.getByLabel(/^Password/).fill(PW);
  await M.page.getByRole("button", { name: "Sign in" }).click(); await M.settle(1200); }
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending"))
  await M.api("/api/auth/approve", { id: a.id, role: "user", division: PEOPLE.find(p => `${p[2]}@sgfd.org` === a.email)[3] });
for (const [, , e, , pat] of PEOPLE) psql(`UPDATE users SET work_pattern = '${pat}' WHERE email = '${e}@sgfd.org'`);
const uid = e => psql(`SELECT id FROM users WHERE email = '${e}@sgfd.org'`);

// ---- Force Back ----
let r = await M.api("/api/forceback/lists", { name: "Communications", division: "Communications" });
check("master creates the Communications list", r.status === 200 && r.body.lists.length === 1, JSON.stringify(r.body).slice(0, 200));
const L = r.body.lists[0].id;
r = await M.api(`/api/forceback/${L}/import`, { fileName: "fb-sheet.xlsx", data: b64("/home/claude/testrun/sysdata/fb-sheet.xlsx"), preview: true });
check("spreadsheet preview: 4 people, accounts matched by name", r.status === 200 && r.body.rows.length === 4 && r.body.rows.find(x => x.name === "Ridley, Ann")?.account === "Ann Ridley"
  && !r.body.rows.find(x => x.name === "Nobody, Nate").account && r.body.rows.find(x => x.name === "Bravo, Ben").lastFb === "2025-09-16", JSON.stringify(r.body).slice(0, 300));
r = await M.api(`/api/forceback/${L}/import`, { fileName: "fb-sheet.xlsx", data: b64("/home/claude/testrun/sysdata/fb-sheet.xlsx") });
check("imported in order: never first, then oldest date", r.body.members.map(m => m.name).join("|") === "Ann Ridley|Ben Bravo|Cora Coyle|Nobody, Nate", r.body.members.map(m => m.name).join("|"));
check("days since and entered-by kept", r.body.members[1].days > 400 && r.body.members[1].lastBy === "CCW" && r.body.members[0].days === null);

// UI: master logs Ann as forced back
await M.page.goto(BASE); await M.settle(800);
await nav(M, "Force Back");
check("Force Back page shows the list", await M.page.getByRole("table", { name: "Force back order" }).count() === 1);
await M.page.getByRole("row", { name: "Ann Ridley" }).getByRole("button", { name: "Forced back" }).click();
await M.page.getByRole("dialog", { name: "Log a call" }).getByLabel("Note").fill("Covering C crew (sample)");
await M.page.getByRole("dialog", { name: "Log a call" }).getByRole("button", { name: "Log force back" }).click(); await M.settle(800);
const order = await M.page.getByRole("table", { name: "Force back order" }).locator("tbody tr").evaluateAll(rows => rows.map(r => r.getAttribute("aria-label")));
check("forced back person moves to the bottom", order[order.length - 1] === "Ann Ridley" && order[0] === "Ben Bravo", order.join("|"));
check("log shows it with initials", /Ann Ridley\s*Forced back\s*Covering C crew \(sample\)\s*MA/.test(await M.page.getByRole("region", { name: "Edit log" }).innerText()));
check("Ann got an important Nexus message", psql(`SELECT count(*) FROM message_recipients mr JOIN message_threads t ON t.id = mr.thread_id WHERE mr.user_id = '${uid("ann")}' AND t.subject LIKE 'Force back:%' AND t.important`) === "1");
// No answer / excused
await M.page.getByRole("row", { name: "Ben Bravo" }).getByRole("button", { name: "No answer" }).click();
await M.page.getByRole("dialog", { name: "Log a call" }).getByRole("button", { name: "Log it" }).click(); await M.settle(600);
const order2 = await M.page.getByRole("table", { name: "Force back order" }).locator("tbody tr").evaluateAll(rows => rows.map(r => r.getAttribute("aria-label")));
check("no answer doesn't move anyone", order2[0] === "Ben Bravo", order2.join("|"));
r = await M.api(`/api/forceback/${L}/action`, { memberId: (await M.api(`/api/forceback/${L}`)).body.members[0].id, kind: "excused", note: "" });
check("excused needs a reason", r.status === 400);
await M.page.getByRole("row", { name: "Cora Coyle" }).getByRole("button", { name: "Excused" }).click();
await M.page.getByRole("dialog", { name: "Log a call" }).getByRole("button", { name: "Out of town" }).click();
await M.page.getByRole("dialog", { name: "Log a call" }).getByRole("button", { name: "Log it" }).click(); await M.settle(600);
check("excused logged with the reason", /Cora Coyle\s*Excused\s*Out of town/.test(await M.page.getByRole("region", { name: "Edit log" }).innerText()));
// Shift filter
await M.page.getByRole("group", { name: "Shift" }).getByRole("button", { name: "C", exact: true }).click(); await M.settle(300);
check("shift filter", await M.page.getByRole("table", { name: "Force back order" }).locator("tbody tr").count() === 1);
// Edit a person (manage): date change is logged
let st = (await M.api(`/api/forceback/${L}`)).body;
const nate = st.members.find(m => m.name === "Nobody, Nate");
r = await M.api(`/api/forceback/${L}/member`, { memberId: nate.id, shift: "B", lastFb: "2026-01-02" });
check("date change logged", r.body.log[0].kind === "changed" && /2026-10-17 → 2026-01-02/.test(r.body.log[0].note), JSON.stringify(r.body.log[0]));
r = await M.api(`/api/forceback/${L}/member`, { memberId: nate.id, active: false });
check("removed from the list (history kept)", !r.body.members.some(m => m.id === nate.id) && r.body.log[0].kind === "removed");
check("log can't be edited", (() => { try { psql("DELETE FROM fb_log"); return false; } catch { return true; } })());

// Ben (on the list, no access) sees it but can't log; Dan (not on it) can't see it
const B = await person("ben@sgfd.org");
r = await B.api("/api/forceback");
check("person on the list sees it", r.body.lists.length === 1 && r.body.lists[0].onIt && !r.body.lists[0].canEdit);
r = await B.api(`/api/forceback/${L}`);
check("…with themselves marked, read only", r.status === 200 && r.body.members.find(m => m.me)?.name === "Ben Bravo" && !r.body.canEdit && r.body.people === undefined);
check("…and can't log a call", (await B.api(`/api/forceback/${L}/action`, { memberId: r.body.members[0].id, kind: "no_answer" })).status === 403);
const D = await person("dan@sgfd.org");
check("someone not on it and without access can't see it", (await D.api("/api/forceback")).body.lists.length === 0 && (await D.api(`/api/forceback/${L}`)).status === 403);
// Cora gets Force Back edit: can log, can't add people
await M.api("/api/access/grants", { section: "forceback", level: "edit", userId: uid("cora"), scope: "all" });
const C = await person("cora@sgfd.org");
st = (await C.api(`/api/forceback/${L}`)).body;
check("Force Back edit can log", (await C.api(`/api/forceback/${L}/action`, { memberId: st.members[0].id, kind: "oncall", day: st.today })).status === 200);
check("…but not change who's on it", (await C.api(`/api/forceback/${L}/member`, { name: "Sample Person" })).status === 403);
check("on-call force back sets the date", (await C.api(`/api/forceback/${L}`)).body.members.slice(-1)[0].lastFb === st.today);
check("audit has the import", psql("SELECT count(*) FROM audit_log WHERE module = 'Force back'") >= "2");

// ---- Time Tracker: Team time ----
await M.page.goto(BASE); await M.settle(800);
await nav(M, "Time Tracker");
await nav(M, "Team time");
const groups = await M.page.locator("main button[aria-label]").evaluateAll(b => b.map(x => x.getAttribute("aria-label")));
check("team time shows groups by division and shift/crew", groups.includes("Communications A Crew") && groups.includes("Suppression A Shift") && groups.includes("Suppression B Shift"), groups.join("|"));
await M.page.getByRole("button", { name: "Suppression A Shift" }).click(); await M.settle(300);
const inGroup = await M.page.locator("main").innerText();
check("a group lists its people", /Dan Delta/.test(inGroup) && /Fay Foxtrot/.test(inGroup) && !/Eve Echo/.test(inGroup));
await M.page.getByRole("button", { name: /Dan Delta/ }).click(); await M.settle(400);
check("picking a person opens their time", /Dan Delta's time/.test(await M.page.locator("main").innerText()));
await nav(M, "Team time");
await M.page.getByLabel("Find a person").fill("eve"); await M.settle(200);
check("find a person by name", /Eve Echo/.test(await M.page.locator("main").innerText()) && !/Dan Delta/.test(await M.page.locator("main").innerText()));
check("side bar no longer lists everyone", await M.page.locator("nav button", { hasText: "Fay Foxtrot" }).count() === 0);

// ---- PIAL: FireWorks certification progress report ----
r = await M.api("/api/pial/import/certs", { fileName: "cert-progress.xlsx", data: b64("/home/claude/testrun/sysdata/cert-progress.xlsx"), preview: true });
check("cert progress report is understood (no missing columns)", r.status === 200 && r.body.rows === 4, JSON.stringify(r.body).slice(0, 300));
check("PIAL hour-requirement lines skipped, repeats combined", /4 "PIAL -" or yearly hour-requirement/.test(r.body.info) && /1 repeated/.test(r.body.info), r.body.info);
check("certificates and dates read", r.body.sample.some(x => x.title === "Firefighter II" && x.cert_date === "2019-05-01") && r.body.sample.some(x => x.title === "Public Safety Telecommunicator 1"), JSON.stringify(r.body.sample));
r = await M.api("/api/pial/import/certs", { fileName: "cert-progress.xlsx", data: b64("/home/claude/testrun/sysdata/cert-progress.xlsx") });
check("imported", r.status === 200 && psql("SELECT count(*) FROM pial_certs") === "4" && psql("SELECT ifsac FROM pial_certs WHERE title LIKE '%Instructor'") === "f", JSON.stringify(r.body).slice(0, 200));

// ---- System ----
fs.rmSync(SYS, { recursive: true, force: true }); fs.mkdirSync(`${SYS}/logs`, { recursive: true }); fs.mkdirSync(`${SYS}/backups`, { recursive: true });
fs.writeFileSync(`${SYS}/logs/sgfd-app.log`, "line one\nSGFD App running at https://sample\n"); fs.writeFileSync(`${SYS}/backups/sgfd-db-20991231-0215.dump`, "x".repeat(2048));
check("System is masters only", (await C.api("/api/system")).status === 403);
r = await M.api("/api/system");
check("status: updater ready (stand-in), backups, disk", r.status === 200 && r.body.updater.ready && r.body.backups.length === 1 && r.body.disk && r.body.migrations > 40, JSON.stringify(r.body).slice(0, 300));
for (const [f, re] of [["env.zip", /\.env/], ["escape.zip", /outside the app folder/], ["other.zip", /outside the app folder|doesn't look like/]]) {
  r = await M.api("/api/system/upload", { fileName: f, data: b64(`/home/claude/testrun/sysdata/${f}`) });
  check(`bad zip refused: ${f}`, r.status === 400 && re.test(r.body.error), r.body.error);
}
r = await M.api("/api/system/upload", { fileName: "notzip.zip", data: Buffer.from("hello").toString("base64") });
check("not a zip refused", r.status === 400);
r = await M.api("/api/system/run", { action: "restart" });
check("actions need an authenticator first", r.status === 403 && /authenticator/.test(r.body.error), r.body.error);
const setup = (await M.api("/api/auth/mfa-setup", {})).body;
const secret = setup.secret;
check("master sets up an authenticator", (await M.api("/api/auth/mfa-confirm", { code: await code(secret) })).status === 200);
psql(`UPDATE sessions SET mfa_at = now() - interval '10 minutes' WHERE user_id = '${uid("mike")}'`);
r = await M.api("/api/system/run", { action: "restart" });
check("an old code isn't enough: asks for one", r.status === 401 && r.body.need === "code", JSON.stringify(r.body));

// UI: upload the good zip, see notes and new migration, install with a code
await M.page.goto(BASE); await M.settle(800); await nav(M, "User Management"); await nav(M, "System");
check("System page shows the server", /This server/.test(await M.page.locator("main").innerText()) && /sgfd-db-20991231-0215\.dump/.test(await M.page.locator("main").innerText()));
await M.page.getByLabel("Release zip").setInputFiles("/home/claude/testrun/sysdata/good.zip");
await M.page.getByRole("button", { name: "Upload and check" }).click(); await M.settle(800);
let main = await M.page.locator("main").innerText();
check("uploaded zip checked: version, notes, new database update", /version 2099\.01\.01/.test(main) && /Sample release note/.test(main) && /999_sample/.test(main), main.slice(0, 400));
await M.page.getByRole("button", { name: "Install the update" }).click(); await M.settle(400);
await M.page.getByLabel("Authenticator code").fill(await code(secret));
await M.page.getByRole("dialog", { name: "Confirm with your authenticator" }).getByRole("button", { name: "Install the update" }).click();
await M.page.waitForTimeout(6000); await M.settle();
main = await M.page.locator("main").innerText();
check("install ran through the updater and the result shows", /Installed 2099\.01\.01 and running/.test(main), main.slice(0, 300));
check("pending cleared, incoming gone", !fs.existsSync(`${SYS}/updates/pending.json`) && !fs.existsSync(`${SYS}/updates/incoming`));
await M.page.getByRole("button", { name: /Log/ }).first().click(); await M.settle(300);
check("the updater log opens", /fake updater: install/.test(await M.page.getByRole("dialog", { name: "Log" }).innerText()));
await M.page.getByRole("dialog", { name: "Log" }).getByRole("button", { name: "Close" }).click();
// Restart (code still fresh) via API, then the service log
r = await M.api("/api/system/run", { action: "restart" });
check("restart with a fresh code", r.status === 200 && r.body.down === true);
r = await M.api("/api/system/run", { action: "backup" });
check("a second job waits for the first", r.status === 409 && /already working/.test(r.body.error), r.body.error);
await wait(2500);
check("restart result recorded", (await M.api("/api/system")).body.last.message === "Restarted.");
r = await M.api("/api/system/run", { action: "rollback" });
check("rollback available after an install", r.status === 200);
await wait(2500);
r = await M.api("/api/system/log?lines=50");
check("service log readable", /running at/.test(r.body.text));
check("audited", psql("SELECT count(*) FROM audit_log WHERE module = 'System'") >= "4", psql("SELECT string_agg(action, ', ') FROM audit_log WHERE module = 'System'"));
check("no page errors", ![...M.errors, ...B.errors, ...C.errors, ...D.errors].length, [...M.errors, ...B.errors].join(" | "));
await browser.close();
done();
process.exit(0);
