// Call alerts: personal + department rules (people, groups), matching on type / exclude / units / agency / priority, once per call,
// mute, push delivery (stand-in push service on :3112), the red pop-up. Fictional data only.
// Run with: CAD_TEST_FILE=/home/claude/testrun/calls-alerts.json PUSH_ALLOW_HTTP=1 LIVE_EVENTS=on
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", FILE = "/home/claude/testrun/calls-alerts.json";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const local = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
const calls = [];
const write = () => fs.writeFileSync(FILE, JSON.stringify(calls, null, 1));
write();

// Stand-in push service: counts deliveries per device path
const pushes = [];
http.createServer((req, res) => { let n = 0; req.on("data", c => (n += c.length)); req.on("end", () => { pushes.push({ path: req.url, urgency: req.headers.urgency, bytes: n }); res.writeHead(201); res.end(); }); }).listen(3112);
const keys = () => { const e = crypto.createECDH("prime256v1"); e.generateKeys(); return { p256dh: e.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") }; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
async function person(email) {
  const ctx = await browser.newContext({ viewport: { width: 1350, height: 950 }, timezoneId: "America/Chicago" });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const api = (path, body) => page.evaluate(async ([path, body]) => {
    const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, body]);
  await page.goto(BASE); await page.waitForTimeout(800);
  if (email && await page.getByLabel(/^Email/).count()) { await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW); await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1800); }
  return { ctx, page, api, errors };
}
const M = await person(null);
await M.api("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await M.page.goto(BASE); await M.page.waitForTimeout(1000);
psql("INSERT INTO divisions (name) VALUES ('Suppression'), ('Communications') ON CONFLICT DO NOTHING");
const PEOPLE = [["Ann", "Ridley", "ann", "Suppression", "fire:A"], ["Ben", "Bravo", "ben", "Suppression", "fire:A"], ["Cora", "Coyle", "cora", "Communications", "comms:A"], ["Dan", "Delta", "dan", "Suppression", "fire:B"]];
for (const [f, l, e, d] of PEOPLE) await M.api("/api/auth/signup", { firstName: f, lastName: l, email: `${e}@sgfd.org`, division: d, password: PW });
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending"))
  await M.api("/api/auth/approve", { id: a.id, role: "user", division: PEOPLE.find(p => `${p[2]}@sgfd.org` === a.email)[3] });
for (const [, , e, , pat] of PEOPLE) psql(`UPDATE users SET work_pattern = '${pat}' WHERE email = '${e}@sgfd.org'`);
const uid = e => psql(`SELECT id FROM users WHERE email = '${e}@sgfd.org'`);
const A = await person("ann@sgfd.org"), B = await person("ben@sgfd.org"), C = await person("cora@sgfd.org"), D = await person("dan@sgfd.org");
for (const [P, n] of [[A, "ann"], [B, "ben"], [C, "cora"], [D, "dan"]]) {
  const r = await P.api("/api/push/subscribe", { subscription: { endpoint: `http://127.0.0.1:3112/dev-${n}`, keys: keys() } });
  if (r.status !== 200) check(`push subscribe ${n}`, false, JSON.stringify(r.body));
}
const shiftA = psql("SELECT id FROM access_groups WHERE name = 'A-Shift'");
check("A-Shift default group exists", !!shiftA);

// ---- Rules ----
let r = await A.api("/api/callalerts/rules", { name: "Fires for me", match: { types: ["fire"], exclude: ["brush"] } });
check("anyone makes their own alert", r.status === 200);
r = await A.api("/api/callalerts/rules", { name: "x", match: {}, recipients: [] });
check("a rule must say which calls", r.status === 400);
r = await A.api("/api/callalerts/rules", { personal: false, name: "Sneaky", match: { types: ["fire"] }, recipients: [{ kind: "user", id: uid("dan"), name: "Dan" }] });
check("…and without permission it stays personal (can't send to others)", r.status === 200 && psql(`SELECT owner_id FROM call_alert_rules WHERE name = 'Sneaky'`) === uid("ann"));
await A.api(`/api/callalerts/rules/${psql("SELECT id FROM call_alert_rules WHERE name = 'Sneaky'")}/remove`, {});
check("department rules list needs permission", (await A.api("/api/callalerts/rules")).status === 403);
r = await M.api("/api/callalerts/rules", { name: "A-Shift: our units", match: { units: ["EG61*", "LD61?"] }, recipients: [{ kind: "group", id: shiftA, name: "A-Shift" }], important: true });
check("master makes a department rule for a group", r.status === 200, JSON.stringify(r.body));
const unitRule = r.body.id;
r = await M.api("/api/callalerts/rules", { name: "Comms: Zachary P1", match: { agencies: ["Zachary FD"], priorities: ["1"] }, recipients: [{ kind: "user", id: uid("cora"), name: "Cora Coyle" }] });
check("…and one for a person", r.status === 200);
const rules = (await M.api("/api/callalerts/rules")).body;
check("department list shows reach", rules.rules.find(x => x.name === "A-Shift: our units")?.reaches === 2, JSON.stringify(rules.rules.map(x => [x.name, x.reaches])));

// ---- Calls arrive ----
const refresh = async () => { await M.api("/api/cad/refresh", {}); await wait(1500); };
const now = Date.now();
calls.push({ incident_id: "c1", incident_number: "2026-1001", call_type: "STRUCTURE FIRE", priority: 1, address: "100 Sample St", city: "Sampleville", agency: "St George FD", units: "", received_at: local(now - 60e3) });
calls.push({ incident_id: "c2", incident_number: "2026-1002", call_type: "BRUSH FIRE", priority: 3, address: "200 Example Rd", agency: "St George FD", units: "EG633", received_at: local(now - 60e3) });
calls.push({ incident_id: "c3", incident_number: "2026-1003", call_type: "MEDICAL", priority: 1, address: "300 Test Ave", agency: "Zachary FD", units: "MD687", received_at: local(now - 30e3) });
calls.push({ incident_id: "old", incident_number: "2026-0900", call_type: "STRUCTURE FIRE", priority: 1, address: "9 Old Rd", agency: "St George FD", units: "EG613", received_at: local(now - 3 * 3600e3) });
write();
await A.page.goto(BASE); await A.page.waitForTimeout(1500);   // Ann has Nexus open: the pop-up
await refresh();
const sent = () => psql("SELECT string_agg(r.name || ':' || s.incident_id || ':' || s.people, ',' ORDER BY r.name, s.incident_id) FROM call_alert_sent s JOIN call_alert_rules r ON r.id = s.rule_id");
check("structure fire → Ann's own alert; brush fire left out; Zachary P1 → Cora; old call ignored", sent() === "Comms: Zachary P1:c3:1,Fires for me:c1:1", sent());
check("pushed to Ann's and Cora's devices", pushes.filter(p => p.path === "/dev-ann").length === 1 && pushes.filter(p => p.path === "/dev-cora").length === 1, JSON.stringify(pushes));
check("Ann sees the red pop-up", await A.page.getByRole("alert", { name: "Call alert" }).count() >= 1 && /STRUCTURE FIRE/.test(await A.page.getByRole("alert", { name: "Call alert" }).first().innerText()));
check("no address in it (rule didn't ask)", !/100 Sample St/.test(await A.page.getByRole("alert", { name: "Call alert" }).first().innerText()));
// A-Shift unit rule: fires when EG613 is assigned to c1
calls[0].units = "EG613:Enroute"; write();
await refresh();
check("unit rule fires when the unit is assigned, to the whole group", /A-Shift: our units:c1:2/.test(sent()), sent());
check("important push (high urgency) to Ann and Ben", pushes.filter(p => p.urgency === "high").map(p => p.path).sort().join(",") === "/dev-ann,/dev-ben", JSON.stringify(pushes));
const before = pushes.length;
calls[0].units = "EG613:On scene, LD618:Enroute"; write();
await refresh();
check("only once per call, however it changes", pushes.length === before && psql("SELECT count(*) FROM call_alert_sent WHERE people >= 0") === "3");
// Ben turns the group alert off for himself
let mine = (await B.api("/api/callalerts")).body;
check("Ben sees the department alert he gets", mine.rules.some(x => x.name === "A-Shift: our units" && !x.personal) && mine.recent.length === 1, JSON.stringify(mine.rules));
await B.api(`/api/callalerts/rules/${unitRule}/mute`, { muted: true });
calls.push({ incident_id: "c4", incident_number: "2026-1004", call_type: "MVA", priority: 2, address: "400 Road", agency: "St George FD", units: "LD611", received_at: local(Date.now() - 20e3) });
write(); await refresh();
check("muted: Ben left out, Ann still gets it", /A-Shift: our units:c4:1/.test(sent()) && pushes.filter(p => p.path === "/dev-ben").length === 1, sent());
check("Dan (B-Shift) never got the A-Shift alerts", pushes.filter(p => p.path === "/dev-dan").length === 0);
// Test button
r = await M.api("/api/callalerts/test", { match: { types: ["fire"] } });
check("check against open calls (any open call, old ones too)", r.body.count === 3, JSON.stringify(r.body));

// ---- UI ----
await A.page.goto(BASE); await A.page.waitForTimeout(1200);
await A.page.locator("nav button", { hasText: "Call Alerts" }).first().click(); await A.page.waitForTimeout(800);
let main = await A.page.locator("main").innerText();
check("My call alerts: own + department rule, device count, recent", /Fires for me/.test(main) && /A-Shift: our units/.test(main) && /1 device/.test(main) && /STRUCTURE FIRE/.test(main), main.slice(0, 500));
await A.page.getByRole("button", { name: "New alert for me" }).click();
await A.page.getByLabel("Alert name").fill("My engine"); await A.page.getByLabel("Units").fill("EG613");
await A.page.getByRole("button", { name: "Check against calls open now" }).click(); await A.page.waitForTimeout(500);
check("editor check shows matching calls", /2 open call\(s\) match/.test(await A.page.locator("main").innerText()));
await A.page.getByRole("button", { name: "Save" }).click(); await A.page.waitForTimeout(800);
check("saved own alert", /My engine/.test(await A.page.locator("main").innerText()));
await M.page.goto(BASE); await M.page.waitForTimeout(1200);
await M.page.locator("nav button", { hasText: "Call Alerts" }).first().click(); await M.page.waitForTimeout(600);
await M.page.locator("nav button", { hasText: "Alerts for people & groups" }).first().click(); await M.page.waitForTimeout(800);
main = await M.page.locator("main").innerText();
check("department page lists rules and what was sent", /A-Shift: our units/.test(main) && /1 turned it off/.test(main) && /people, \d devices/.test(main), main.slice(0, 600));
await M.page.getByRole("button", { name: "New alert" }).click();
await M.page.getByLabel("Alert name").fill("Comms: all fires"); await M.page.getByLabel("Call type words").fill("FIRE");
await M.page.getByLabel("Add people or groups").selectOption({ label: "Communications Division (1)" }).catch(async () => {
  const opts = await M.page.getByLabel("Add people or groups").locator("option").allInnerTexts(); check("group option", false, opts.join("|")); });
await M.page.getByLabel("Put the address in the notification").check();
check("address warning shown", /lock screens/.test(await M.page.locator("main").innerText()));
await M.page.getByRole("button", { name: "Save" }).click(); await M.page.waitForTimeout(800);
check("department rule saved from the page", psql("SELECT show_address FROM call_alert_rules WHERE name = 'Comms: all fires'") === "t");
calls.push({ incident_id: "c5", incident_number: "2026-1005", call_type: "VEHICLE FIRE", priority: 2, address: "500 Lane", agency: "Zachary FD", units: "", received_at: local(Date.now() - 10e3) });
write(); await refresh();
check("Comms division alert went to Cora", /Comms: all fires:c5:1/.test(sent()), sent());
check("calls already open when a rule is made don't alert", /Comms: all fires:c1:-1/.test(sent()) && /My engine:c1:-1/.test(sent()), sent());
check("audited", psql("SELECT count(*) FROM audit_log WHERE module = 'Call alerts'") >= "3");
check("no page errors", ![...M.errors, ...A.errors, ...B.errors].length, [...M.errors, ...A.errors].join(" | "));
await browser.close();
done();
process.exit(0);
