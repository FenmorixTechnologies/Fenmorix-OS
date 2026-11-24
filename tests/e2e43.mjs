// Accounts admins can edit groups (add/remove people), but not put themselves into or delete groups that carry access. Fictional people only.
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
const PEOPLE = [["Ann Accounts", "ann", "Office Manager", "Administration", "weekdays"], ["Bob Battalion", "bob", "Battalion Chief", "Suppression", "fire:A"],
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



const ann = uid("Ann Accounts"), gina = uid("Gina Gray"), bob = uid("Bob Battalion");
await M.post("/api/access/grants", { section: "accounts", level: "manage", userId: ann, scope: "all" });
// A group that carries access, and a plain one
let r = await M.post("/api/access/groups", { name: "Recall Operators", description: "", rules: {}, includes: [bob], excludes: [] });
const gAccess = r.body.id;
await M.post("/api/access/grants", { section: "recall", level: "edit", groupId: gAccess, scope: "all" });
r = await M.post("/api/access/groups", { name: "Softball Team", description: "", rules: {}, includes: [bob], excludes: [] });
const gPlain = r.body.id;

const A = await person();
await A.login("ann@sgfd.org");
let d = (await A.api("/api/access")).body;
check("accounts admin can edit groups", d.canGroups === true && d.isMaster === false);
const grp = id => d.groups.find(g => g.id === id);
r = await A.post("/api/access/groups", { ...grp(gAccess), includes: [bob, gina] });
check("adds a person to a group with access", r.status === 200 && psql(`SELECT count(*) FROM access_group_members WHERE group_id = '${gAccess}'`) === "2", JSON.stringify(r.body));
r = await A.post("/api/access/groups", { ...grp(gAccess), includes: [gina] });
check("removes a person", r.status === 200 && psql(`SELECT count(*) FROM access_group_members WHERE group_id = '${gAccess}' AND user_id = '${bob}'`) === "0");
d = (await A.api("/api/access")).body;
r = await A.post("/api/access/groups", { ...grp(gAccess), includes: [gina, ann] });
check("can't add themselves to a group that carries access", r.status === 403 && /add yourself/.test(r.body.error), JSON.stringify(r.body));
r = await A.post("/api/access/groups", { ...grp(gAccess), rules: { divisions: ["Administration"] } });
check("can't pull themselves in by a rule either", r.status === 403);
r = await A.post("/api/access/groups", { ...grp(gPlain), includes: [bob, ann] });
check("can join a plain group", r.status === 200);
r = await A.post(`/api/access/groups/${gAccess}/remove`, {});
check("can't delete a group that carries access", r.status === 403 && psql(`SELECT count(*) FROM access_groups WHERE id = '${gAccess}'`) === "1", JSON.stringify(r.body));
r = await A.post("/api/access/groups", { name: "Station Cooks", description: "", rules: {}, includes: [gina], excludes: [] });
check("creates a group", r.status === 200);
r = await A.post(`/api/access/groups/${r.body.id}/remove`, {});
check("deletes a plain group", r.status === 200 && psql("SELECT count(*) FROM access_groups WHERE name = 'Station Cooks'") === "0");
check("audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Permissions' AND actor_name = 'Ann Accounts'")) >= 4);

// UI: User Management > Groups shows the editor for the accounts admin
await A.page.goto(BASE); await A.settle();
await A.nav("User Management"); await A.nav("Groups");
check("Groups page lets them edit", await A.page.getByRole("button", { name: "+ New group" }).isVisible() && await A.page.getByRole("button", { name: "Edit" }).first().isVisible());
await A.page.getByRole("button", { name: "Edit" }).last().click(); await A.settle();
await A.page.getByLabel("Add a person").selectOption({ label: "Gina Gray — Suppression" });
await A.page.getByRole("button", { name: "Add", exact: true }).click();
await A.page.getByRole("button", { name: "Save group" }).click(); await A.settle(800);
check("UI add saved", Number(psql("SELECT count(*) FROM access_group_members WHERE mode = 'include' AND user_id = '" + gina + "'")) >= 2);

// Someone without accounts admin can't
const G = await person();
await G.login("gina@sgfd.org");
r = await G.post("/api/access/groups", { name: "Mine", rules: {}, includes: [], excludes: [] });
check("others can't change groups", r.status === 403);
check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close();
try { process.kill(srv.pid); } catch {}
mock.close();
process.exit(0);
