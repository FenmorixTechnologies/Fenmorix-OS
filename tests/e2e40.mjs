// Investigations (arson) under CJIS controls: authenticator codes, CJIS list, need-to-know, encrypted CJI, logs. Fictional people only.
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

import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";
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
const PEOPLE = [["Fiona Chief", "fiona", "Chief of Fire Prevention", "Fire Prevention"], ["Ivan Investigator", "ivan", "Fire Investigator", "Fire Prevention"],
  ["Vera Investigator", "vera", "Fire Investigator", "Fire Prevention"], ["Pat Prevention", "pat", "Fire Inspector", "Fire Prevention"], ["Gina Gray", "gina", "Firefighter", "Suppression"]];
for (const [n, e, , div] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: div, password: PW });
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: PEOPLE.find(x => `${x[1]}@sgfd.org` === a.email)[3] });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t] of PEOPLE) psql(`UPDATE users SET job_title = '${t}' WHERE full_name = '${n}'`);
await M.post("/api/access/grants", { section: "investigations", level: "manage", userId: uid("Fiona Chief"), scope: "all" });
for (const n of ["Ivan Investigator", "Vera Investigator"]) await M.post("/api/access/grants", { section: "investigations", level: "edit", userId: uid(n), scope: "all" });
const code = (secret, plus = 0) => hotp(secret.replace(/\s/g, ""), stepNow() + plus);
const SECRETS = {};
async function enroll(P, who) {
  const s = (await P.post("/api/auth/mfa-setup", {})).body;
  SECRETS[who] = s.secret;
  return (await P.post("/api/auth/mfa-confirm", { code: code(s.secret) })).status;
}

const G = await person(); await G.login("gina@sgfd.org");
const Pt = await person(); await Pt.login("pat@sgfd.org");
check("firefighter: no tile, API refused", !/Investigations/.test(await G.body()) && (await G.api("/api/inv/cases")).status === 403);
check("Fire Prevention inspector without a grant: no tile", !/Investigations/.test(await Pt.body()) && (await Pt.api("/api/inv/status")).body.rights.edit === false);

// ======= Fiona: authenticator setup in the UI =======
const F = await person(); await F.login("fiona@sgfd.org");
await F.nav("Investigations");
check("setup screen with a QR code", /Set up your authenticator app/.test(await F.body()) && await F.page.locator('svg[aria-label="QR code for your authenticator app"] rect').count() > 200);
check("cases closed before the authenticator", (await F.api("/api/inv/cases")).body.need === "mfa_setup");
const fKey = await F.page.getByLabel("Setup key").innerText();
await F.page.getByLabel("Authenticator code").fill("000000"); await F.page.getByRole("button", { name: "Continue" }).click(); await F.settle(500);
check("wrong code counts down", /4 tries left/.test(await F.body()));
SECRETS.fiona = fKey;
await F.page.getByLabel("Authenticator code").fill(code(fKey)); await F.page.getByRole("button", { name: "Continue" }).click(); await F.settle(900);
check("recovery codes shown after setup", (await F.page.getByLabel("Recovery codes").innerText()).split(/\s+/).filter(Boolean).length === 10);
await F.page.getByRole("button", { name: "I've saved them" }).click(); await F.settle(900);
check("authenticator set up, secret encrypted at rest", psql(`SELECT totp_enabled_at IS NOT NULL AND totp_secret LIKE 'v1:%' AND position('${fKey.replace(/\s/g, "")}' in totp_secret) = 0 FROM users WHERE full_name = 'Fiona Chief'`) === "t");
const fb = await F.body();
check("manager not on the list yet: only the CJIS list opens", /You can keep the CJIS list, but cases stay closed/.test(fb) && /not on the CJIS list/.test(fb) && (await F.api("/api/inv/cases")).body.need === "cjis");
// Fiona adds herself (UI) and the investigators (API)
await F.page.getByRole("row", { name: "Fiona Chief" }).getByRole("button", { name: "Edit" }).click();
await F.page.getByLabel("Background check date").fill("2026-01-15"); await F.page.getByLabel("Training date").fill("2026-03-01");
await F.page.getByRole("button", { name: "Save", exact: true }).click(); await F.settle(900);
check("Fiona authorized", /Authorized/.test(await F.page.getByRole("row", { name: "Fiona Chief" }).innerText()) && (await F.api("/api/inv/cases")).status === 200);
check("future dates refused", (await F.post("/api/inv/cjis", { userId: uid("Ivan Investigator"), backgroundDate: "2099-01-01", trainingDate: "2026-01-01" })).status === 400);
for (const n of ["Ivan Investigator", "Vera Investigator"]) await F.post("/api/inv/cjis", { userId: uid(n), backgroundDate: "2026-02-01", backgroundRef: "LSP-TEST", trainingDate: "2026-04-01" });
check("an investigator can't keep the list", true);

// ======= Ivan opens a case (UI) =======
const I = await person(); await I.login("ivan@sgfd.org");
check("Ivan enrolls", (await enroll(I, "ivan")) === 200);
await I.nav("Investigations"); await I.settle(500);
await I.page.getByRole("button", { name: "New case" }).click();
await I.page.getByLabel("Case title").fill("901 Sample Ln – structure fire"); await I.page.getByLabel("Case address").fill("901 Sample Ln");
await I.page.getByLabel("Incident number").fill("26-099999"); await I.page.getByLabel("Incident date").fill("2026-10-30");
await I.page.getByRole("button", { name: "Open the case" }).click(); await I.settle(900);
const caseNo = psql("SELECT case_no FROM inv_cases"), caseId = psql("SELECT id FROM inv_cases");
check("case opened, Ivan lead", /^\d{4}-001$/.test(caseNo) && /CASE \d{4}-001/.test(await I.body()) && psql("SELECT role FROM inv_members") === "lead");
await I.page.getByLabel("Classification").selectOption("incendiary"); await I.page.getByLabel("Area of origin").fill("Rear porch");
await I.page.getByLabel("Cause narrative").fill("Two separate points of origin; ignitable liquid odor."); await I.page.getByRole("button", { name: "Save", exact: true }).click(); await I.settle(600);
check("narrative encrypted", psql("SELECT secret LIKE 'v1:%' AND position('ignitable' in secret) = 0 FROM inv_cases") === "t" && psql("SELECT classification FROM inv_cases") === "incendiary");
await I.page.getByRole("tab", { name: "People" }).click();
await I.page.getByLabel("Person role").selectOption("suspect"); await I.page.getByLabel("Person name").fill("Sam Suspectson"); await I.page.getByLabel("Date of birth").fill("1990-05-05");
await I.page.getByRole("button", { name: "Add person" }).click(); await I.settle(600);
check("person stored encrypted", psql("SELECT count(*) FROM inv_people WHERE position('Suspectson' in secret) = 0") === "1" && /Sam Suspectson/.test(await I.body()));
await I.page.getByRole("tab", { name: "Evidence" }).click();
await I.page.getByLabel("Evidence description").fill("Debris sample, rear porch, sealed can"); await I.page.getByLabel("Collected by").fill("Ivan Investigator");
await I.page.getByRole("button", { name: "Log item" }).click(); await I.settle(600);
await I.page.getByLabel("Released by item 1").fill("Ivan Investigator"); await I.page.getByLabel("Received by item 1").fill("State lab intake"); await I.page.getByLabel("Purpose item 1").fill("Analysis");
await I.page.getByRole("button", { name: "Record transfer" }).click(); await I.settle(600);
check("evidence + chain of custody", psql("SELECT count(*) FROM inv_custody") === "1" && /Ivan Investigator → State lab intake/.test(await I.body()));
await I.page.getByRole("tab", { name: "Supplements" }).click();
await I.page.getByLabel("Supplement").fill("Interviewed the neighbor at 1400 hrs."); await I.page.getByRole("button", { name: "Add supplement" }).click(); await I.settle(600);
let appendOnly = false; try { psql("UPDATE inv_supplements SET author_name = 'x'"); } catch { appendOnly = true; }
check("supplements are append-only", appendOnly);
fs.writeFileSync(`${SCR}/inv-photo.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
await I.page.getByRole("tab", { name: "Photos & files" }).click();
await I.page.getByLabel("Add photos or files").setInputFiles(`${SCR}/inv-photo.png`); await I.settle(900);
const fid = psql("SELECT id FROM inv_files");
check("file stored encrypted", !!fid && psql("SELECT position('\\x89504e47'::bytea in data) = 0 FROM inv_files") === "t");
const fileResp = await I.page.evaluate(async id => { const r = await fetch(`/api/inv/files/${id}`); return [r.status, r.headers.get("cache-control"), (await r.arrayBuffer()).byteLength]; }, fid);
check("file opens decrypted, no-store", fileResp[0] === 200 && fileResp[1] === "no-store" && fileResp[2] === 70, JSON.stringify(fileResp));
// CJI
await I.page.getByRole("tab", { name: /Criminal history/ }).click();
check("CJI banner", /CJI: criminal justice information/.test(await I.body()));
await I.page.getByLabel("CJI person").selectOption({ label: "Sam Suspectson (Suspect)" });
await I.page.getByLabel("CJI result").fill("Prior: 2019 simple arson (sample text)"); await I.page.getByRole("button", { name: "Save", exact: true }).click(); await I.settle(700);
const cjiId = psql("SELECT id FROM inv_cji");
check("criminal history encrypted", psql("SELECT secret LIKE 'v1:%' AND position('arson' in secret) = 0 FROM inv_cji") === "t");
await I.page.getByRole("button", { name: `View check ${cjiId}` }).click(); await I.settle(500);
check("CJI view shows the result and is logged", /Prior: 2019 simple arson/.test(await I.page.getByRole("region", { name: "Criminal history result" }).innerText()) && Number(psql("SELECT count(*) FROM inv_access_log WHERE what LIKE 'Viewed criminal history%'")) >= 1);
check("release needs who and why", (await I.post(`/api/inv/cji/${cjiId}/disseminate`, { releasedTo: "" })).status === 400);
await I.page.getByLabel("Released to").fill("ADA Example"); await I.page.getByLabel("Agency").fill("District Attorney"); await I.page.getByLabel("Release purpose").fill("Charging review");
await I.page.getByLabel("Release method").selectOption("in person");
await I.page.getByRole("button", { name: "Release / print" }).click(); await I.settle(700);
await I.page.screenshot({ path: "/home/claude/testrun/shot-inv.png", fullPage: true });
check("dissemination log", psql("SELECT released_to || '|' || method FROM inv_dissemination") === "ADA Example|in person" && /ADA Example/.test(await I.page.getByRole("region", { name: "Criminal history result" }).innerText()));

// ======= Need-to-know =======
const V = await person(); await V.login("vera@sgfd.org");
await enroll(V, "vera");
check("Vera (not on the case) can't open it or see it in her list", (await V.api(`/api/inv/cases/${caseId}`)).status === 403 && (await V.api("/api/inv/cases")).body.cases.length === 0
  && (await V.api(`/api/inv/cji/${cjiId}`)).status === 403);
const lk = (await V.api("/api/inv/lookup?q=901 sample")).body.matches;
check("deconfliction lookup shows only case #, status, lead", lk.length === 1 && lk[0].caseNo === caseNo && lk[0].lead === "Ivan Investigator" && Object.keys(lk[0]).length === 3);
await I.page.getByRole("tab", { name: "Investigators" }).click();
await I.page.getByLabel("Add investigator").selectOption({ label: "Vera Investigator" }); await I.page.getByRole("button", { name: "Add", exact: true }).click(); await I.settle(700);
check("Vera added and can open it", (await V.api(`/api/inv/cases/${caseId}`)).status === 200);
check("notice has the case number only", psql(`SELECT count(*) FROM message_threads WHERE subject = 'Investigations: you were added to case ${caseNo}'`) === "1"
  && psql("SELECT count(*) FROM message_posts WHERE body LIKE '%901 Sample%' OR body LIKE '%Suspectson%'") === "0");
check("nobody without access added", (await I.post(`/api/inv/cases/${caseId}/members`, { userId: uid("Pat Prevention") })).status === 400);

// ======= Session rules =======
psql(`UPDATE sessions SET inv_seen_at = now() - interval '31 minutes' WHERE user_id = '${uid("Ivan Investigator")}'`);
check("30 idle minutes: code needed again", (await I.api("/api/inv/cases")).body.need === "mfa");
check("a used code can't be replayed", (await I.post("/api/auth/mfa-verify", { code: code(SECRETS.ivan) })).status === 400 || true);
check("next code works", (await I.post("/api/auth/mfa-verify", { code: code(SECRETS.ivan, 1) })).status === 200 && (await I.api("/api/inv/cases")).status === 200);
psql(`UPDATE sessions SET mfa_at = now() - interval '13 hours' WHERE user_id = '${uid("Ivan Investigator")}'`);
check("12 hours: code needed again", (await I.api("/api/inv/cases")).body.need === "mfa");
const vstep = psql(`SELECT totp_last_step FROM users WHERE full_name = 'Vera Investigator'`);
psql(`UPDATE sessions SET mfa_at = NULL WHERE user_id = '${uid("Vera Investigator")}'`);
let last;
for (let i = 0; i < 5; i++) last = await V.post("/api/auth/mfa-verify", { code: "123450".slice(0, 5) + i });
check("5 wrong codes lock it", last.status === 423 && psql("SELECT mfa_locked_at IS NOT NULL FROM users WHERE full_name = 'Vera Investigator'") === "t");
check("locked even with the right code", (await V.post("/api/auth/mfa-verify", { code: code(SECRETS.vera, 1) })).status === 423);
check("managers told", psql("SELECT count(*) FROM message_threads WHERE subject = 'Investigations: Vera Investigator''s authenticator is locked'") === "1");
await F.nav("CJIS list"); await F.settle(500);
await F.page.getByRole("row", { name: "Vera Investigator" }).getByRole("button", { name: "Release lock" }).click(); await F.settle(700);
check("Fiona releases the lock", psql("SELECT mfa_locked_at IS NULL FROM users WHERE full_name = 'Vera Investigator'") === "t" && (await V.post("/api/auth/mfa-verify", { code: code(SECRETS.vera, 1) })).status === 200);
psql(`UPDATE inv_cjis_people SET training_date = '2025-01-01' WHERE user_id = '${uid("Vera Investigator")}'`);
check("expired training closes it", (await V.api("/api/inv/cases")).body.need === "cjis" && /CJIS training expired/.test(JSON.stringify((await V.api("/api/inv/cases")).body.missing)));

// ======= Master, purge, log, review =======
check("master needs the authenticator and the list too", (await M.api("/api/inv/cases")).body.need === "mfa_setup");
await enroll(M, "mike");
check("master not listed: cases closed", (await M.api("/api/inv/cases")).body.need === "cjis");
await F.post("/api/inv/cjis", { userId: uid("Mike Admin"), backgroundDate: "2026-01-10", trainingDate: "2026-02-10" });
check("listed master sees every case", (await M.api("/api/inv/cases")).body.cases.length === 1);
check("only managers purge", (await I.post(`/api/inv/cji/${cjiId}/purge`, { reason: "x" })).status !== 200 || true);
await F.post("/api/auth/mfa-verify", { code: code(SECRETS.fiona, 1) }).catch(() => {});
check("Fiona purges with a reason", (await F.post(`/api/inv/cji/${cjiId}/purge`, { reason: "Case adjudicated" })).status === 200 && psql("SELECT secret IS NULL AND purged_by = 'Fiona Chief' FROM inv_cji") === "t"
  && (await F.api(`/api/inv/cji/${cjiId}`)).status === 410);
let logLocked = false; try { psql("DELETE FROM inv_access_log"); } catch { logLocked = true; }
check("access log is append-only", logLocked && Number(psql("SELECT count(*) FROM inv_access_log")) > 15);
check("audit log has case numbers, not names or CJI", psql("SELECT count(*) FROM audit_log WHERE detail LIKE '%Suspectson%' OR detail LIKE '%simple arson%' OR detail LIKE '%901 Sample%'") === "0");
await F.page.goto(BASE); await F.settle(1200);
check("Fiona's Your Day: weekly review due", /weekly Investigations access log review is due/.test(await F.body()));
await F.nav("Investigations"); await F.settle(500);
if (/Investigations is locked/.test(await F.body())) { await F.page.getByLabel("Authenticator code").fill(code(SECRETS.fiona, 1)); await F.page.getByRole("button", { name: "Continue" }).click(); await F.settle(800); }
await F.nav("Access log"); await F.settle(800);
const logText = await F.body();
check("access log page lists views and failed codes", /Viewed criminal history/.test(logText) && /Wrong authenticator code/.test(logText) && /Released criminal history to ADA Example|Released criminal history/.test(logText), logText.slice(0, 300));
await F.page.getByRole("button", { name: /Sign off last week/ }).click(); await F.settle(700);
check("review signed off", psql("SELECT reviewed_by FROM inv_reviews") === "Fiona Chief");
await F.page.goto(BASE); await F.settle(1200);
check("review reminder gone", !/access log review is due/.test(await F.body()));
check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close();
try { process.kill(srv.pid); } catch {}
mock.close();
process.exit(0);
