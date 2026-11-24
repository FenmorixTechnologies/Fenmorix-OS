// Tickets: Help Desk and Gear desks, Send to groups/people (notified + can follow), status updates posted only by the desk team. Fictional people only.
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
psql("INSERT INTO divisions (name) VALUES ('Technology'), ('Administration') ON CONFLICT DO NOTHING");
const PEOPLE = [["Tess Tech", "tess", "IT Specialist", "Technology", "weekdays"], ["Gail Gear", "gail", "Logistics Officer", "Administration", "weekdays"],
  ["Ray Requester", "ray", "Firefighter", "Suppression", "fire:A"], ["Wanda Watch", "wanda", "Captain", "Suppression", "fire:A"], ["Owen Other", "owen", "Firefighter", "Suppression", "fire:B"]];
for (const [n, e, , div] of PEOPLE) await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: div, password: PW });
await M.login("mike@sgfd.org");
psql("INSERT INTO divisions (name) VALUES ('Administration') ON CONFLICT DO NOTHING");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const p = PEOPLE.find(x => `${x[1]}@sgfd.org` === a.email);
  await M.post("/api/auth/approve", { id: a.id, role: "user", division: p[3] });
}
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t, , wp] of PEOPLE) psql(`UPDATE users SET job_title = '${t}', work_pattern = '${wp}' WHERE full_name = '${n}'`);




const inbox = (who, like) => Number(psql(`SELECT count(*) FROM message_threads t JOIN message_recipients r ON r.thread_id = t.id JOIN users u ON u.id = r.user_id WHERE u.full_name = '${who}' AND r.via <> 'Sender' AND t.subject LIKE '${like}'`));
const lastBody = (who, like) => psql(`SELECT p.body FROM message_threads t JOIN message_recipients r ON r.thread_id = t.id JOIN users u ON u.id = r.user_id JOIN message_posts p ON p.thread_id = t.id WHERE u.full_name = '${who}' AND r.via <> 'Sender' AND t.subject LIKE '${like}' ORDER BY p.created_at DESC LIMIT 1`);
await M.post("/api/access/grants", { section: "gear", level: "edit", userId: uid("Gail Gear"), scope: "all" });
let r = await M.post("/api/access/groups", { name: "Station 61 Officers", description: "", rules: {}, includes: [uid("Wanda Watch")], excludes: [] });
const grp = r.body.id;
const getC = async (P, key) => (await P.api(`/api/collections/${key}`)).body.value;
const saveC = (P, key, upserts) => P.api(`/api/collections/${key}`, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ upserts, deletes: [] }) });
const base = (o = {}) => ({ id: crypto.randomUUID(), subject: "Monitor flickers", category: "Hardware", priority: "Medium", division: "Suppression", location: "Station 61",
  description: "Flickers all shift", assigneeId: null, assigneeName: null, status: "open", dueDate: "", comments: [], attachments: [], updates: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...o });

const R = await person(); await R.login("ray@sgfd.org");
check("anyone can list groups to send to", (await R.api("/api/tickets/routing")).body.groups.some(g => g.name === "Station 61 Officers"));
const tk = base({ sentTo: [{ kind: "group", id: grp }, { kind: "user", id: uid("Owen Other") }], status: "in_progress", assigneeId: uid("Ray Requester") });
r = await saveC(R, "tickets", [tk]);
check("Ray opens a ticket sent to a group and a person", r.status === 200, JSON.stringify(r.body));
check("Ray can't assign or set a status when opening", psql(`SELECT status || '|' || coalesce(assignee_id::text, '') FROM tickets WHERE id = '${tk.id}'`) === "open|");
check("sent to is kept with names", psql(`SELECT sent_to::text FROM tickets WHERE id = '${tk.id}'`).includes("Station 61 Officers") && psql(`SELECT count(*) FROM ticket_watchers WHERE ticket_id = '${tk.id}'`) === "2");
check("Help Desk team told (always)", inbox("Tess Tech", "New Help Desk ticket: Monitor%") === 1);
check("the group member and the person picked are told", inbox("Wanda Watch", "New Help Desk ticket: Monitor%") === 1 && inbox("Owen Other", "New Help Desk ticket: Monitor%") === 1);
check("gear team isn't told about a Help Desk ticket", inbox("Gail Gear", "New Help Desk ticket%") === 0);

// A person it was sent to can follow and comment, not work it
const W = await person(); await W.login("wanda@sgfd.org");
let t = (await getC(W, "tickets")).find(x => x.id === tk.id);
check("Wanda sees the ticket sent to her (not a worker)", !!t && t.watching === true && t.canWork === false);
r = await saveC(W, "tickets", [{ ...t, status: "resolved", assigneeId: uid("Wanda Watch"), updates: [{ id: crypto.randomUUID(), status: "resolved", note: "done" }],
  comments: [{ id: crypto.randomUUID(), author: "x", body: "Same monitor at 61 flickered last week too.", createdAt: new Date().toISOString() }] }]);
check("Wanda's comment saves, her status/assignee don't", r.status === 200 && psql(`SELECT status || '|' || coalesce(assignee_id::text, '') FROM tickets WHERE id = '${tk.id}'`) === "open|"
  && psql(`SELECT count(*) FROM ticket_updates WHERE ticket_id = '${tk.id}'`) === "0" && psql(`SELECT author_name FROM ticket_comments WHERE ticket_id = '${tk.id}'`) === "Wanda Watch", JSON.stringify(r.body));

// Tess (team) posts status updates
const T = await person(); await T.login("tess@sgfd.org");
t = (await getC(T, "tickets")).find(x => x.id === tk.id);
r = await saveC(T, "tickets", [{ ...t, status: "acknowledged", assigneeId: uid("Tess Tech"), updates: [...t.updates, { id: crypto.randomUUID(), status: "acknowledged", note: "Got it, coming by after lunch." }] }]);
check("Tess acknowledges with a note", r.status === 200 && psql(`SELECT status || '|' || note || '|' || author_name FROM ticket_updates WHERE ticket_id = '${tk.id}'`) === "acknowledged|Got it, coming by after lunch.|Tess Tech", JSON.stringify(r.body));
check("Ray is told with the note", inbox("Ray Requester", "Your Help Desk ticket: Monitor%") === 1 && /Acknowledged\nGot it, coming by after lunch\./.test(lastBody("Ray Requester", "Your Help Desk ticket: Monitor%")));
check("people it was sent to are told too", inbox("Wanda Watch", "Ticket update: Monitor%") >= 1);
t = (await getC(T, "tickets")).find(x => x.id === tk.id);
r = await saveC(T, "tickets", [{ ...t, status: "awaiting_delivery" }]);
check("a status change without a note still records an update", psql(`SELECT string_agg(status, ',' ORDER BY created_at) FROM ticket_updates WHERE ticket_id = '${tk.id}'`) === "acknowledged,awaiting_delivery");

// Gear desk
const g = base({ desk: "gear", subject: "Turnout coat torn", category: "Hardware", description: "Left sleeve torn at the cuff" });
r = await saveC(R, "tickets", [g]);
check("Ray opens a gear ticket", r.status === 200 && psql(`SELECT desk || '|' || category FROM tickets WHERE id = '${g.id}'`) === "gear|Other", psql(`SELECT desk || '|' || category FROM tickets WHERE id = '${g.id}'`));
check("gear team told", inbox("Gail Gear", "New gear ticket: Turnout%") === 1 && inbox("Tess Tech", "New gear ticket%") === 0);
check("Tess (Help Desk) doesn't see gear tickets", !(await getC(T, "tickets")).some(x => x.id === g.id));
const G = await person(); await G.login("gail@sgfd.org");
t = (await getC(G, "tickets")).find(x => x.id === g.id);
check("Gail works gear tickets", t?.canWork === true && (await getC(G, "roster")).find(u => u.name === "Gail Gear").gearTech === true);
r = await saveC(G, "tickets", [{ ...t, status: "on_hold", updates: [{ id: crypto.randomUUID(), status: "on_hold", note: "Waiting on a size" }] }]);
check("Gail puts it on hold", r.status === 200 && psql(`SELECT status FROM tickets WHERE id = '${g.id}'`) === "on_hold" && inbox("Ray Requester", "Your gear ticket: Turnout%") === 1);
r = await saveC(T, "tickets", [{ ...t, status: "closed" }]);
check("Tess can't work a gear ticket", r.status === 403);

// UI
await G.page.goto(BASE); await G.settle(1200);
check("Your Day: Gail sees nothing new (already on hold)", !/gear tickets? needs? to be acknowledged/i.test(await G.body()));
const g2 = base({ desk: "gear", subject: "Helmet shield cracked", category: "Helmet" });
await saveC(R, "tickets", [g2]);
await G.page.goto(BASE); await G.settle(1500);
check("Your Day: new gear ticket to acknowledge", /1 new gear ticket needs to be acknowledged/.test(await G.body()), (await G.body()).slice(0, 300));
await G.nav("PPE & Gear"); await G.nav("Gear tickets"); await G.settle(1200);
let b = await G.body();
check("PPE & Gear > Gear tickets lists them", /Helmet shield cracked/.test(b) && /Turnout coat torn/.test(b) && /On hold/.test(b) && !/Monitor flickers/.test(b), b.slice(300, 1500));
await G.page.getByText("Helmet shield cracked").click(); await G.settle();
const region = G.page.getByRole("region", { name: "Status updates" });
await region.getByLabel("New status").selectOption("acknowledged");
await region.getByLabel("Status note").fill("New shield ordered");
await region.getByRole("button", { name: "Post status update" }).click(); await G.settle(900);
check("UI status update posted", psql(`SELECT status || '|' || note FROM ticket_updates WHERE ticket_id = '${g2.id}'`) === "acknowledged|New shield ordered" && /New shield ordered/.test(await region.innerText()));
await G.page.screenshot({ path: "/home/claude/testrun/shot-ticket-status.png" });

// Ray: New ticket form with Send to
await R.page.goto(BASE); await R.settle();
await R.nav("Help Desk"); await R.nav("New ticket");
await R.page.getByPlaceholder("Short summary of the issue").fill("Printer jams at 62");
await R.page.getByPlaceholder("What's happening, what you've tried, error messages…").fill("Every third page");
await R.page.getByLabel("Send to").selectOption({ label: "Station 61 Officers (1)" });
await R.page.getByLabel("Send to").selectOption({ label: "Owen Other — Suppression" });
b = await R.body();
check("picked groups and people show as chips", /Station 61 Officers/.test(await R.page.getByLabel("Sending to").innerText()) && /Owen Other/.test(await R.page.getByLabel("Sending to").innerText()));
await R.page.getByRole("button", { name: "Remove Owen Other" }).click();
await R.page.getByRole("button", { name: "Submit ticket" }).click(); await R.settle(1000);
check("UI ticket sent to the group only", /Station 61 Officers/.test(psql("SELECT sent_to::text FROM tickets WHERE subject = 'Printer jams at 62'")) && !/Owen/.test(psql("SELECT sent_to::text FROM tickets WHERE subject = 'Printer jams at 62'"))
  && inbox("Wanda Watch", "New Help Desk ticket: Printer%") === 1);
await R.page.getByText("Monitor flickers").click(); await R.settle();
check("Ray sees the status timeline, no status controls", /Awaiting delivery/.test(await R.page.getByRole("region", { name: "Status updates" }).innerText()) && !(await R.page.getByLabel("New status").count()));
await R.page.screenshot({ path: "/home/claude/testrun/shot-ticket-requester.png" });
check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close();
try { process.kill(srv.pid); } catch {}
mock.close();
process.exit(0);
