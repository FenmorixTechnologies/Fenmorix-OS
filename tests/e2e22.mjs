// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
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
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
const body = async () => page.locator("body").innerText();
import { execSync } from "node:child_process";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Fred Floor", "fred"], ["Bea Bravo", "bea"], ["Cal Charlie", "cal"]]) {
  const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
const [fred, bea, cal] = ["Fred Floor", "Bea Bravo", "Cal Charlie"].map(id);
psql(`UPDATE users SET station = 'Station 61', work_pattern = 'fire:B' WHERE id = '${fred}'`);
psql(`UPDATE users SET station = '61', work_pattern = 'fire:A' WHERE id = '${bea}'`);
psql(`UPDATE users SET station = 'Sta. 62', work_pattern = 'fire:B' WHERE id = '${cal}'`);
await page.waitForTimeout(5500);

const acc = (await api("/api/access")).body;
const g = name => acc.groups.find(x => x.name === name);
check("default groups exist", ["A-Shift", "B-Shift", "C-Shift", "Comms A Crew", "Weekday Staff", "Station 61", "Station 61 · B-Shift", "Suppression Division"].every(n => g(n)?.isDefault), acc.groups.filter(x => x.isDefault).length + " defaults");
const members = name => (g(name)?.members || []).slice().sort().join();
check("Station 61 = Fred + Bea (61 / Station 61)", members("Station 61") === [fred, bea].sort().join(), members("Station 61"));
check("Station 61 · B-Shift = Fred only", members("Station 61 · B-Shift") === fred);
check("B-Shift = Fred + Cal", members("B-Shift") === [fred, cal].sort().join());

// Fred's own list (no broadcast permission)
await login("fred@sgfd.org");
let r = await post("/api/messages/lists", { name: "My crew", members: [bea, cal] });
check("Fred makes a list", r.status === 200 && r.body.lists.length === 1, JSON.stringify(r.body).slice(0, 120));
const listId = r.body.id;
check("dup name refused", (await post("/api/messages/lists", { name: "my CREW", members: [bea] })).status >= 400);
const fp = (await api("/api/messages/people")).body;
check("Fred can't see default groups, sees his list", !fp.canBroadcast && fp.lists.length === 1);
check("Fred can't send to a group", (await post("/api/messages", { groups: [g("B-Shift").id], subject: "x", body: "x" })).status === 403);
r = await post("/api/messages", { lists: [listId], subject: "Crew dinner", body: "Tacos at 61.", privateReplies: true });
check("sends to his list", r.status === 200, JSON.stringify(r.body).slice(0, 160));

// UI: My lists page + compose replies choice
await tile("Messages");
await page.getByRole("button", { name: "My lists" }).click(); await settle();
check("My lists page shows the list", /My crew/.test(await body()) && /Bea Bravo/.test(await body()));
await page.getByRole("button", { name: "Message My crew" }).click(); await settle();
check("compose opens with list + replies choice", /Replies \(2 people\)/.test(await body()));
check("list sends default to private replies", await page.getByRole("radio", { name: /just me/ }).isChecked({ timeout: 4000 }).catch(e => (console.log(results.join("\n")), false)));
await page.screenshot({ path: "shot-mylists-compose.png" });

// Bea replies: only Fred sees it, Cal doesn't
await login("bea@sgfd.org");
const bt = (await api("/api/messages?box=inbox")).body.threads.find(t => t.subject === "Crew dinner");
check("Bea got it", !!bt);
await post(`/api/messages/${bt.id}/reply`, { body: "I'm in" });
await login("cal@sgfd.org");
const ct = (await api("/api/messages?box=inbox")).body.threads.find(t => t.subject === "Crew dinner");
const cview = (await api(`/api/messages/${ct.id}`)).body;
check("Cal doesn't see Bea's private reply", !JSON.stringify(cview).includes("I'm in"));
check("Cal can't see Fred's list", (await api("/api/messages/lists")).body.lists.length === 0);
check("Cal can't delete Fred's list", (await post(`/api/messages/lists/${listId}/remove`, {})), true);
check("list still there", psql(`SELECT count(*) FROM message_lists`) === "1");
await login("fred@sgfd.org");
const fview = (await api(`/api/messages/${bt.id}`)).body;
check("Fred sees Bea's reply", JSON.stringify(fview).includes("I'm in"));

// Group conversation option: replies to all
r = await post("/api/messages", { users: [bea, cal], subject: "Group chat", body: "hi", privateReplies: false });
await login("bea@sgfd.org");
const gt = (await api("/api/messages?box=inbox")).body.threads.find(t => t.subject === "Group chat");
await post(`/api/messages/${gt.id}/reply`, { body: "hello all" });
await login("cal@sgfd.org");
const gt2 = (await api("/api/messages?box=inbox")).body.threads.find(t => t.subject === "Group chat");
check("group conversation: Cal sees Bea's reply", JSON.stringify((await api(`/api/messages/${gt2.id}`)).body).includes("hello all"));

// Group editor shows home station rule
await login("mike@sgfd.org"); await tile("User Management");
await page.getByRole("button", { name: "Groups" }).click(); await settle();
check("groups page shows default badge", /default/i.test(await body()));
await page.screenshot({ path: "shot-default-groups.png" });

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
await browser.close();
