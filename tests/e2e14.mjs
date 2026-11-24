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

// ---- A stand-in for Aladtec's API
let tokenCalls = 0;
const mock = http.createServer((req, res) => {
  const out = j => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.url === "/oauth/token" && req.method === "POST") { tokenCalls++; return out({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }); }
  if (req.headers.authorization !== "Bearer tok") { res.writeHead(401); return res.end("{}"); }
  if (req.url.startsWith("/schedules")) return out([
    { schedule_id: 1, name: "Station 61", positions: [{ position_id: 11, label: "Captain" }, { position_id: 12, label: "Engineer" }] },
    { schedule_id: 2, name: "Medic Units", positions: [{ position_id: 21, label: "M61 Paramedic" }, { position_id: 22, label: "M64 Paramedic" }] },
  ]);
  if (req.url.startsWith("/members")) return out({ data: [
    { member_id: 101, first_name: "John", last_name: "Smith", mobile_phone: "225-555-0101" },
    { member_id: 102, first_name: "Ana", last_name: "Diaz", mobile_phone: "" },
    { member_id: 103, first_name: "Lee", last_name: "Park", mobile_phone: "" },
  ] });
  if (req.url.startsWith("/scheduled-time/members-scheduled-now")) return out([
    { schedule_id: 1, positions: [{ position_id: 11, member_id: 101 }, { position_id: 12, member_id: 102 }] },
    { schedule_id: 2, positions: [{ position_id: 21, member_id: 103 }] },
  ]);
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
await page.getByRole("navigation").getByRole("button", { name: "Aladtec setup", exact: true }).click(); await settle();
check("Aladtec shows connected", /connected/.test(await body()), (await body()).slice(0, 300));
await page.getByRole("button", { name: /Check now/ }).click(); await settle();
check("Aladtec lists who's on duty and their station", /John Smith/.test(await body()) && /Lee Park/.test(await body()) && /Station 61/.test(await body()));
check("token reused, not requested every call", tokenCalls <= 2, String(tokenCalls));
await page.getByRole("navigation").getByRole("button", { name: /^Fire stations/ }).click(); await settle();
const st61 = page.locator("div", { has: page.getByRole("button", { name: "Edit Station 61" }) }).filter({ hasText: /On duty/i }).last();
const st61Text = await st61.innerText();
check("Station 61 card shows today's shift and Aladtec names", /shift/.test(st61Text) && /John Smith/.test(st61Text) && /Ana Diaz/.test(st61Text) && /Lee Park/.test(st61Text), st61Text.replace(/\n/g, " | "));

// ---- Directory check
await page.getByRole("navigation").getByRole("button", { name: /^Directory check/ }).click(); await settle();
await page.getByLabel("Note").fill("Annual update");
await page.getByRole("button", { name: "Start directory check" }).click(); await settle();
check("check started with progress", /0 of \d+ confirmed/.test(await body()) && /Still to confirm/.test(await body()));
await login("fred@sgfd.org");
await page.getByText("Please confirm your directory card").first().waitFor({ timeout: 8000 }).catch(() => {});
check("Fred's Your Day asks him to confirm", /Please confirm your directory card/.test(await body()));
await page.getByRole("button", { name: "Check my card" }).click(); await settle();
check("opens his card with the confirm banner", /My card/.test(await body()) && await page.getByRole("button", { name: "Looks right" }).count() === 1);
await page.getByRole("button", { name: "Looks right" }).click(); await settle();
check("banner goes away", await page.getByRole("button", { name: "Looks right" }).count() === 0);
await page.goto(BASE); await settle();
check("Your Day no longer asks", !/Please confirm your directory card/.test(await body()));

// favorites, search, print, vcard
await tile("Directory");
await page.getByRole("navigation").getByRole("button", { name: /^Fire stations/ }).click(); await settle();
await page.getByRole("button", { name: "Add Station 61 to favorites" }).click(); await settle();
check("Favorites appears with the station", await page.getByRole("navigation").getByRole("button", { name: "Favorites", exact: true }).count() === 1);
await page.getByRole("navigation").getByRole("button", { name: "Favorites", exact: true }).click(); await settle();
check("favorites shows Station 61", /Station 61/.test(await body()) && !/Station 62/.test(await body()));
await page.getByLabel("Search the directory").fill("4461"); await settle();
check("search finds the station by short code", /Search: “4461”/.test(await body()) && /Station 61/.test(await body()));
await page.getByLabel("Search the directory").fill("ochsner"); await settle();
check("search finds outside contacts", /Ochsner Medical Center/.test(await body()));
await page.getByLabel("Search the directory").fill(""); await settle();
await page.getByRole("navigation").getByRole("button", { name: /^Everyone/ }).click(); await settle();
await page.getByRole("button", { name: /Print/ }).click(); await page.waitForTimeout(500);
const printed = await page.frameLocator("#print-frame").locator("body").innerText().catch(() => "");
check("print lists people by division", /Directory — Everyone/.test(printed) && /Fred Floor/.test(printed) && /4101/.test(printed));
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save Fred Floor to phone contacts" }).click()]);
const vcf = require_text(await dl.path());
check("save contact gives a vCard", /BEGIN:VCARD/.test(vcf) && /TEL;TYPE=CELL:225-555-1111/.test(vcf) && /FN:Fred Floor/.test(vcf), vcf.slice(0, 200));

// ---- Dana closes the check
await login("dana@sgfd.org");
await tile("Directory");
await page.getByRole("navigation").getByRole("button", { name: /^Directory check/ }).click(); await settle();
check("progress counts Fred", /1 of \d+ confirmed/.test(await body()) && /Fred Floor · looks right/.test(await body()));
await page.getByRole("button", { name: "Close check and mark verified" }).click(); await settle();
check("directory stamped verified by Dana", /Directory last verified .* by Dana Dir/.test(await body()));

// ---- Accounts admin
await login("alex@sgfd.org");
await page.getByRole("navigation").getByRole("button", { name: /^User Management/ }).waitFor({ timeout: 8000 }).catch(() => {});
check("accounts admin sees User Management", await page.getByRole("navigation").getByRole("button", { name: /^User Management/ }).count() === 1);
await tile("User Management");
check("only the accounts page", await page.getByRole("button", { name: "People & roles", exact: true }).count() === 0 && /Accounts & sign-in/.test(await body()));
const accts = (await api("/api/auth/accounts")).body.accounts;
const pat = accts.find(a => a.name === "Pat Pending");
r = await post("/api/auth/approve", { id: pat.id, role: "master", division: "Suppression" });
check("accounts admin can't make a master", r.status === 403);
r = await post("/api/auth/approve", { id: pat.id, role: "user", division: "Suppression" });
check("accounts admin approves a user", r.status === 200, JSON.stringify(r.body));
r = await post("/api/auth/reset-password", { id: id("Mike Admin") });
check("accounts admin can't reset a master's password", r.status === 403);
r = await post("/api/auth/reset-password", { id: id("Fred Floor") });
check("accounts admin resets a user's password", r.status === 200 && !!r.body.tempPassword);

// ---- Forms admin
await login("fiona@sgfd.org");
const defs = (await api("/api/forms/definitions")).body;
check("forms admin can manage forms but not grant access", defs.canManage === true && defs.canGrantAccess === false);
const ex = defs.definitions.find(x => x.key === "exec_physical");
r = await post("/api/forms/definitions", { id: ex.id, title: ex.title + " (edited)", category: ex.category, description: ex.description, fields: ex.fields, settings: ex.settings, active: true, sort: ex.sort });
check("forms admin saves a form", r.status === 200, JSON.stringify(r.body).slice(0, 120));
r = await api("/api/forms/access");
check("forms admin can't see form access grants", r.status === 403);

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
mock.close();
