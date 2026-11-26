// Module licensing: a signed license turns on only the purchased modules (tiles, Your Day, API, collections), the System page
// shows it and installs a new one (with a code), the user limit stops approvals. Fictional data only.
// Run with: LICENSE_FILE=/home/claude/testrun/keys/active.lic (a copy of lakeview.lic: messaging, procurement, sick, leave, pial; 3 users)
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077", PW = "Correct horse battery", K = "/home/claude/testrun/keys";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const navText = async () => page.getByRole("navigation").first().innerText();

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Lee Admin", email: "lee@lakeview.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(2500);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });

// ---- What's on ----
let nav = await navText();
check("licensed sections show", ["Messages", "Procurement", "Sick Leave", "Leave Picks", "PIAL Tracker"].every(t => nav.includes(t)), nav.replace(/\n/g, " | "));
check("core sections show", ["Announcements", "Directory", "Personnel File", "User Management", "Audit Log"].every(t => nav.includes(t)));
check("unlicensed sections hidden", !["Help Desk", "Command Board", "Training", "Evaluations", "Forms", "Comms Statistics", "Force Back", "Off Work", "Time Tracker", "Call Alerts"].some(t => nav.includes(t)));
check("Your Day: no widgets for locked modules", await page.locator("[data-widget=tickets], [data-widget=time], [data-widget=offwork], [data-widget=meetings]").count() === 0);
check("no Notifications tile when Messaging is licensed (notices are in Messages)", !nav.includes("Notifications"));
check("chat button there (messaging licensed)", await page.getByRole("button", { name: /^Chat/ }).count() === 1);
check("locked API answers 404", (await api("/api/command")).status === 404 && (await api("/api/training/todo")).status === 404 && (await api("/api/command")).body?.locked);
check("licensed API works", (await api("/api/pial")).status === 200 && (await api("/api/sick")).status === 200);
check("locked collection reads empty, writes refused", (await api("/api/collections/tickets")).body?.value === null
  && (await api("/api/collections/tickets", { upserts: [], deletes: [] })).status === 403);
check("licensed collection works", Array.isArray((await api("/api/collections/requisitions")).body?.value));
await page.screenshot({ path: "shot-license-home.png" });

// ---- System page: license card ----
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(700);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1200);
const card = page.getByRole("region", { name: "License" });
let t = await card.innerText();
check("license card: customer, expiry, users", /Lakeview Fire Department/.test(t) && /2030-01-01/.test(t) && /1 of 3/.test(t), t.slice(0, 300));
check("modules listed on/off", await card.getByLabel("ISO / PIAL Rating Tracker: on").count() === 1 && await card.getByLabel("Incident Command Board: not licensed").count() === 1);
await card.screenshot({ path: "shot-license-card.png" });
// Install a tampered file: refused; the real one stays
const lic = fs.readFileSync(`${K}/hosted.lic`, "utf8");
await api("/api/auth/mfa-verify", { code: await code(secret) });
let r = await api("/api/system/license", { text: lic.replace(/\.([A-Za-z0-9_-]{10})/, ".AAAAAAAAAA") });
check("tampered license refused", r.status === 400 && /signature|read/.test(r.body?.error || ""), JSON.stringify(r.body));
// Install a different license through the page
fs.writeFileSync("/tmp/claude-0/hosted.lic", lic);
await card.getByLabel("License file").setInputFiles("/tmp/claude-0/hosted.lic");
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog").getByRole("button", { name: "Install the license" }).click(); await page.waitForTimeout(1200);
t = await card.innerText();
check("new license installed from the page", /Hosted Customer/.test(t) && await card.getByLabel("Incident Command Board: on").count() === 1 && await card.getByLabel("ISO / PIAL Rating Tracker: not licensed").count() === 1, t.slice(0, 200));
check("restart offered", await card.getByRole("button", { name: "Restart now to apply it" }).count() === 1);
check("previous license kept as a copy", fs.existsSync(`${process.env.LICENSE_FILE || `${K}/active.lic`}.previous`));
await page.goto(BASE); await page.waitForTimeout(2000);
nav = await navText();
check("menu follows the new license after reload", nav.includes("Command Board") && nav.includes("Help Desk") && !nav.includes("PIAL Tracker"), nav.replace(/\n/g, " | "));
// ---- Core Notifications inbox (this license has no Messaging) ----
check("Notifications in the menu instead of Messages", nav.includes("Notifications") && !/\bMessages\b/.test(nav));
check("no chat button without Messaging", await page.getByRole("button", { name: /^Chat/ }).count() === 0);
check("person-to-person messaging API locked, people list still there", (await api("/api/messages")).status === 404 && (await api("/api/messages/people")).status === 200);
const me = psql("SELECT id FROM users WHERE email = 'lee@lakeview.example'");
psql(`INSERT INTO message_threads (id, subject, created_by, kind, to_label) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'Your requisition was approved', '${me}', 'notice', 'Lee')`);
psql(`INSERT INTO message_posts (id, thread_id, author_id, body) VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', '${me}', 'Hose order for Station 1 was approved by the chief.')`);
psql(`INSERT INTO message_recipients (thread_id, user_id, deliver_at, via) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '${me}', now(), 'Direct')`);
psql(`INSERT INTO users (id, full_name, division_id, role, email) VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'Pat Approver', (SELECT id FROM divisions LIMIT 1), 'user', 'pat@lakeview.example')`);
psql(`UPDATE message_threads SET created_by = 'bbbbbbbb-0000-4000-8000-000000000001' WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001'`);
psql(`UPDATE message_posts SET author_id = 'bbbbbbbb-0000-4000-8000-000000000001' WHERE thread_id = 'aaaaaaaa-0000-4000-8000-000000000001'`);
let sum = (await api("/api/notices/summary")).body;
check("notice counted in the core summary", sum?.unread === 1, JSON.stringify(sum));
await page.goto(BASE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "Notifications" }).first().click(); await page.waitForTimeout(1200);
check("notice listed unread", await page.getByRole("button", { name: "Unread: Your requisition was approved" }).count() === 1);
await page.getByRole("button", { name: "Unread: Your requisition was approved" }).click(); await page.waitForTimeout(800);
check("notice opens, read-only", /approved by the chief/.test(await page.getByRole("article").innerText()) && await page.getByLabel("Reply").count() === 0);
check("now read", (await api("/api/notices/summary")).body.unread === 0);
check("page badge cleared", !/Notifications\s*1/.test(await page.getByRole("navigation").first().innerText()));
await page.screenshot({ path: "shot-notifications.png" });
check("a person-to-person message can't be opened as a notice", (await api("/api/notices/00000000-0000-4000-8000-000000000000")).status === 404);
check("audited", /Installed a license/.test(JSON.stringify((await api("/api/audit?q=license")).body || {})));

// ---- User limit (back to the 3-user license) ----
fs.copyFileSync(`${K}/lakeview.lic`, process.env.LICENSE_FILE || `${K}/active.lic`);
await page.waitForTimeout(31000);     // license cache
for (const [f, l] of [["Ana", "One"], ["Ben", "Two"], ["Cam", "Three"]]) {
  const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE);
  await p2.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }),
    { firstName: f, lastName: l, email: `${f.toLowerCase()}@lakeview.example`, division: "Suppression", password: PW });
  await p2.context().close();
}
const acc = (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending");
const res = [];
for (const a of acc) res.push((await api("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" })).status);
check("user limit: 2 more approved, the 4th refused", JSON.stringify(res) === "[200,200,409]", JSON.stringify(res));

check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
