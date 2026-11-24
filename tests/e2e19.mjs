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
psql("DELETE FROM access_groups WHERE is_default"); // these suites build their own groups (pre-017)
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [["Fred Floor", "fred@sgfd.org", "Technology"], ["Tina Tech", "tina@sgfd.org", "Technology"], ["Sam Supp", "sam@sgfd.org", "Suppression"], ["Pat Purchaser", "pat@sgfd.org", "Suppression"]];
for (const [n, e, d] of people) await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: e, division: d, password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const p = people.find(x => x[0] === a.name);
  await post("/api/auth/approve", { id: a.id, role: "user", division: p[2] });
}
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
const [fred, tina, sam, pat] = ["Fred Floor", "Tina Tech", "Sam Supp", "Pat Purchaser"].map(id);

// Everyone puts in some time
for (const [email, who] of [["tina@sgfd.org", "Tina"], ["sam@sgfd.org", "Sam"]]) {
  await login(email);
  const me = (await read("roster")).find(u => u.email === email);
  await post("/api/collections/time-entries", { upserts: [{ id: crypto.randomUUID(), userId: me.id, date: "2026-11-03", start: "07:00", end: "15:00", kind: "regular", note: who }], deletes: [] });
}
// Fred is on Fire A shift
await login("fred@sgfd.org");
await post("/api/time/pattern", { pattern: "fire:A" });
check("Fred can't open permissions", (await api("/api/access")).status === 403);
check("Fred sees only his own time", (await read("time-entries")).length === 0);

// ---- Master: group from a rule, access through the group
await login("mike@sgfd.org");
const g = await post("/api/access/groups", { name: "A-Shift", description: "Fire A shift", rules: { patterns: ["fire:A"] }, includes: [], excludes: [] });
check("group created", g.status === 200 && g.body.id);
let A = (await api("/api/access")).body;
check("rule puts Fred in A-Shift", A.groups.find(x => x.name === "A-Shift").members.join() === fred);
check("duplicate group name refused", (await post("/api/access/groups", { name: "a-shift", rules: {} })).status === 409);
await post("/api/access/grants", { section: "time", level: "view", groupId: g.body.id, scope: "own" });
await login("fred@sgfd.org");
const seen = (await read("time-entries")).map(e => e.note).sort().join();
check("group grant (own division): Fred sees Tina (Technology) but not Sam (Suppression)", seen === "Tina", seen);
check("roster shows it in the old shape", JSON.stringify((await read("roster")).find(u => u.id === fred).permissions.timeView) === '["Technology"]');

// A master roster save must not turn group access into personal access
await login("mike@sgfd.org");
const roster = await read("roster");
const fr = roster.find(u => u.id === fred);
await post("/api/collections/roster", { upserts: [{ ...fr, jobTitle: "Firefighter" }], deletes: [] });
check("roster save didn't copy group access to Fred", psql(`SELECT count(*) FROM access_grants WHERE user_id = '${fred}'`) === "0");

// Leave Fred out by hand -> loses it
await post("/api/access/groups", { id: g.body.id, name: "A-Shift", rules: { patterns: ["fire:A"] }, includes: [tina], excludes: [fred] });
A = (await api("/api/access")).body;
check("include/exclude by hand", A.groups[0].members.join() === tina);
await login("fred@sgfd.org");
check("left out: Fred sees no one else's time", (await read("time-entries")).length === 0);

// ---- Section manager: Pat manages Call-Out for Suppression only
await login("mike@sgfd.org");
await post("/api/access/grants", { section: "callout", level: "manage", userId: pat, scope: ["Suppression"] });
await login("pat@sgfd.org");
await page.getByRole("navigation").getByRole("button", { name: /^User Management/ }).waitFor({ timeout: 8000 }).catch(() => {});
check("manager sees User Management", await page.getByRole("navigation").getByRole("button", { name: /^User Management/ }).count() === 1);
const P = (await api("/api/access")).body;
check("manager sees only their section's grants", P.grants.every(x => x.section === "callout") && !P.isMaster, JSON.stringify(P.canGrant));
check("manager can give edit in their division", (await post("/api/access/grants", { section: "callout", level: "edit", userId: sam, scope: ["Suppression"] })).status === 200);
const bad1 = await post("/api/access/grants", { section: "callout", level: "edit", userId: sam, scope: ["Technology"] });
check("but not in other divisions", bad1.status === 403, bad1.body.error);
check("or all divisions", (await post("/api/access/grants", { section: "callout", level: "edit", userId: sam, scope: "all" })).status === 403);
check("or manage level", (await post("/api/access/grants", { section: "callout", level: "manage", userId: sam, scope: ["Suppression"] })).status === 403);
check("or other sections", (await post("/api/access/grants", { section: "time", level: "view", userId: sam, scope: ["Suppression"] })).status === 403);
check("or groups", (await post("/api/access/groups", { name: "Mine", rules: {} })).status === 403);
const samGrant = (await api("/api/access")).body.grants.find(x => x.userId === sam);
const myGrant = (await api("/api/access")).body.grants.find(x => x.userId === pat);
check("manager can't remove their own manage grant", (await post(`/api/access/grants/${myGrant.id}/remove`, {})).status === 403);
await login("sam@sgfd.org");
check("Sam got call-out edit", JSON.stringify((await read("roster")).find(u => u.id === sam).permissions.calloutEdit) === '["Suppression"]');
await login("pat@sgfd.org");
check("manager can remove it", (await post(`/api/access/grants/${samGrant.id}/remove`, {})).status === 200);
check("audit log records changes", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Permissions'")) >= 4);

// ---- Screens (master)
await login("mike@sgfd.org");
await page.getByRole("navigation").getByRole("button", { name: /^User Management/ }).click(); await settle();
await page.getByRole("navigation").getByRole("button", { name: "Groups" }).click(); await settle();
await page.getByRole("button", { name: "+ New group" }).click(); await settle();
await page.getByLabel("Group name").fill("Technology Team");
await page.getByRole("checkbox", { name: "Technology" }).first().check();
await page.waitForTimeout(200);
const preview = await page.getByRole("region", { name: "Group members" }).innerText();
check("live member preview", /Members right now: 2/.test(preview) && /Fred Floor/.test(preview) && /Tina Tech/.test(preview), preview.slice(0, 120));
await page.screenshot({ path: "/home/claude/testrun/shot-group-editor.png", fullPage: true });
await page.getByRole("button", { name: "Save group" }).click(); await settle();
check("group listed", /Technology Team/.test(await body()));
await page.getByRole("navigation").getByRole("button", { name: "By person" }).click(); await settle();
await page.getByRole("button", { name: /Tina Tech/ }).first().click(); await settle();
check("by person explains where access comes from", /group (Technology Team|A-Shift)/.test(await body()) && /A-Shift/.test(await body()), (await body()).slice(0, 400));
await page.screenshot({ path: "/home/claude/testrun/shot-perm-person.png", fullPage: true });
await page.getByRole("navigation").getByRole("button", { name: "By section" }).click(); await settle();
check("by section lists Pat as call-out manager", /Pat Purchaser/.test(await page.getByRole("region", { name: "Call-Out Schedule access" }).innerText()));
await page.screenshot({ path: "/home/claude/testrun/shot-perm-section.png", fullPage: true });
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
