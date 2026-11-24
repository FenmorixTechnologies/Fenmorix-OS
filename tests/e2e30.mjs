// Requisitions: vendor history and budget report open a quick view, drawn signatures (stored, shown, printed, scoped);
// Personnel File requisitions & reimbursements; system Audit Log; Sick Leave tracker (logging, scope, protected leave,
// patterns, risk score, outlook). Fictional people only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
const { fireShift, addDays } = await import("/home/claude/testrun/app/src/shifts.js");
const { defaultHolidays } = await import("/home/claude/testrun/app/server/sick.js").catch(() => ({}));
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1" } });
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, ct, body: ct.includes("json") ? await r.json() : ct.includes("csv") ? await r.text() : null };
}, [path, opts]);
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
const getC = async key => (await api(`/api/collections/${key}`)).body.value;
const saveC = (key, upserts) => api(`/api/collections/${key}`, { method: "POST", body: JSON.stringify({ upserts, deletes: [] }) });
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE).catch(() => page.waitForTimeout(500).then(() => page.goto(BASE))); await page.waitForTimeout(700);
  await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1600);
}
const body = () => page.locator("body").innerText();
const open = async name => { await page.goto(BASE); await page.waitForTimeout(1200); await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(1500); };
const nav = async label => { await page.getByRole("button", { name: new RegExp("^" + label.replace(/[()]/g, "\\$&") + "( \\d+)?$") }).first().click(); await page.waitForTimeout(1200); };

await page.goto(BASE); await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const P = [["Ray Requester", "ray", "Suppression", "user"], ["Dana Purchaser", "dana", "Suppression", "approver1"], ["Alice Accounts", "alice", "Administration", "accounting"],
  ["Wes Wellness", "wes", "Wellness", "user"], ["Sam Shift", "sam", "Suppression", "user"], ["Tia Steady", "tia", "Suppression", "user"],
  ["Bea Dispatch", "bea", "Communications", "user"], ["Sue Super", "sue", "Suppression", "user"], ["Cal Comms", "cal", "Communications", "user"]];
for (const [n, e, d] of P) { const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE); await p2.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: d, password: PW }); await p2.context().close(); }
await login("mike@sgfd.org");
const acc = (await api("/api/auth/accounts")).body.accounts;
for (const [n, , d, role] of P) await post("/api/auth/approve", { id: acc.find(x => x.name === n).id, role, division: d });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
psql(`UPDATE users SET work_pattern = 'fire:A' WHERE full_name = 'Sam Shift'`); psql(`UPDATE users SET work_pattern = 'fire:B' WHERE full_name = 'Tia Steady'`);
psql(`UPDATE users SET work_pattern = 'comms:C' WHERE full_name = 'Bea Dispatch'`);

// ---- Requisition with a drawn signature ----------------------------------------------------------------------
await login("ray@sgfd.org");
const req = { id: crypto.randomUUID(), division: "Suppression", category: "Equipment", title: "Thermal imaging camera batteries", vendor: "Gulf Safety Supply", vendorId: null, description: "Spare batteries for TICs",
  contractual: false, frequency: "one_time", amount: 640, lineItems: [], invoiceNumber: "GS-9001", paymentMethod: "Check", cardLast4: "", cardholderName: "", requestedBy: "Ray Requester",
  createdAt: "2026-11-03T12:00:00", status: "pending_auth1", auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [] };
check("Ray submits a requisition", (await saveC("requisitions", [req])).status === 200);
const reimb = { id: crypto.randomUUID(), type: "non_travel", requesterId: "", requesterName: "", division: "Suppression", staffId: "", position: "", supervisor: "", reason: "Station 61 supplies run", payPeriodFrom: "", payPeriodTo: "", advances: 0,
  lineItems: [{ id: crypto.randomUUID(), date: "2026-11-01", description: "Paper towels", qty: 2, unitPrice: 12.5 }], status: "pending_approval", approval: null, rejectedReason: null, paidDate: null, attachments: [], createdAt: new Date().toISOString() };
check("Ray submits a reimbursement", (await saveC("reimbursements", [reimb])).status === 200);
await login("dana@sgfd.org");
await open("Procurement / Requisitions"); await nav("Requisitions");
await page.getByRole("button", { name: /^Thermal imaging camera batteries,/ }).first().click(); await page.waitForTimeout(600);
const pad = page.getByRole("img", { name: "Signature box" });
check("signature box shown when signing", await pad.count() === 1);
const bx = await pad.boundingBox();
await page.mouse.move(bx.x + 20, bx.y + 70); await page.mouse.down();
for (let i = 1; i <= 30; i++) await page.mouse.move(bx.x + 20 + i * 9, bx.y + 70 + Math.sin(i / 3) * 30);
await page.mouse.up(); await page.waitForTimeout(300);
check("button says it signs with the drawing", await page.getByRole("button", { name: /with drawn signature/ }).count() === 1);
await page.screenshot({ path: "shot-req-sign.png" });
await page.getByRole("button", { name: /with drawn signature/ }).click(); await page.waitForTimeout(1500);
check("drawn signature stored", psql(`SELECT length(signature_image) > 500 FROM requisition_signatures WHERE requisition_id = '${req.id}' AND stage = 'auth1'`) === "t");
let r = await api(`/api/req-signature/${req.id}/auth1`);
check("signature picture served", r.status === 200 && r.ct === "image/png");
check("signature shown on the requisition", await page.getByRole("img", { name: "Dana Purchaser's signature" }).count() >= 1);
await login("wes@sgfd.org");
check("other divisions can't fetch the signature", (await api(`/api/req-signature/${req.id}/auth1`)).status === 404);
r = await saveC("requisitions", [{ ...req, auth1: { name: "Dana Purchaser", date: new Date().toISOString(), decision: "approved" }, auth2: { name: "x", date: new Date().toISOString(), decision: "approved", signature: "data:image/png;base64,AAAA" }, status: "pending_chief" }]);
check("can't sign without being a signer", r.status === 403);

// ---- Vendors history + Budget report quick view ------------------------------------------------------------------
await login("ray@sgfd.org");
await open("Procurement / Requisitions"); await nav("Vendors");
await page.getByText("Gulf Safety Supply").first().click(); await page.waitForTimeout(800);
await page.getByRole("button", { name: "View Thermal imaging camera batteries" }).click(); await page.waitForTimeout(600);
let b = await body();
check("vendor history opens the requisition", await page.getByRole("dialog", { name: /Thermal imaging camera batteries/ }).count() === 1 && /GS-9001/.test(b) && /Dana Purchaser/.test(b));
await page.screenshot({ path: "shot-req-quick.png" });
await page.getByRole("button", { name: "Open in Requisitions" }).click(); await page.waitForTimeout(1200);
check("Open in Requisitions shows it open", (await page.locator(`#req-${req.id} [aria-expanded="true"]`).count()) === 1);
await nav("Budget report");
await page.getByRole("button", { name: "View Thermal imaging camera batteries" }).click(); await page.waitForTimeout(600);
check("budget report row opens the quick view", await page.getByRole("dialog", { name: /Thermal imaging camera batteries/ }).count() === 1);
await page.getByRole("button", { name: "Close" }).first().click();

// ---- Personnel File ----------------------------------------------------------------------------------------------
await open("Personnel File");
await page.getByRole("button", { name: /Requisitions & reimbursements/ }).click(); await page.waitForTimeout(1200);
b = await body();
check("Personnel File lists my requisitions and reimbursements", /Thermal imaging camera batteries/.test(b) && /Station 61 supplies run/.test(b) && /\$25\.00/.test(b), b.slice(0, 400));
await page.screenshot({ path: "shot-pfile-purchases.png" });
await login("alice@sgfd.org");
check("accounting can see Ray's", (await api(`/api/personnel/purchases?user=${uid("Ray Requester")}`)).body.requisitions?.length === 1);
await login("wes@sgfd.org");
check("others can't", (await api(`/api/personnel/purchases?user=${uid("Ray Requester")}`)).status === 403);

// ---- System Audit Log ----------------------------------------------------------------------------------------------
check("audit log needs permission", (await api("/api/audit")).status === 403);
await login("mike@sgfd.org");
r = await api("/api/audit?module=Procurement");
check("audit log filters by section", r.status === 200 && r.body.total > 0 && r.body.rows.every(x => x.module === "Procurement"), JSON.stringify(r.body).slice(0, 200));
r = await api("/api/audit/export.csv?q=approved%20account");
check("audit CSV", r.status === 200 && /Approved account/.test(r.body));
await post("/api/access/grants", { section: "audit", level: "view", userId: uid("Wes Wellness"), scope: "all" });
await open("Audit Log");
b = await body();
check("Audit Log page", /System audit log/.test(b) && /Approved account/.test(b));
await page.getByLabel("Section").selectOption({ label: /^Procurement/ }).catch(async () => { const o = await page.getByLabel("Section").locator("option").allTextContents(); await page.getByLabel("Section").selectOption({ label: o.find(x => x.startsWith("Procurement")) }); });
await page.getByRole("button", { name: "Show" }).click(); await page.waitForTimeout(1200);
check("Audit Log filtered to Procurement", (await page.locator('table[aria-label="Audit log"] tbody tr').allInnerTexts()).every(t => /Procurement|No entries/.test(t)));
await page.screenshot({ path: "shot-audit.png" });
await login("wes@sgfd.org");
check("Audit log: View lets Wes in", (await api("/api/audit")).status === 200);

// ---- Sick Leave ------------------------------------------------------------------------------------------------
await login("mike@sgfd.org");
await post("/api/access/grants", { section: "sick", level: "edit", userId: uid("Sue Super"), scope: ["Suppression"] });
await post("/api/access/grants", { section: "sick", level: "view", userId: uid("Cal Comms"), scope: ["Communications"] });
const today = new Date().toLocaleDateString("en-CA");
await login("sue@sgfd.org");
let meta = (await api("/api/sick")).body;
check("Sue sees Suppression people only", meta.people.length > 0 && meta.people.every(p => p.division === "Suppression"), meta.people.map(p => p.name).join());
// Sam: calls out on (most of) his A-shift holidays for two years, plus a few other days
const hol = [];
for (const y of [2024, 2025, 2026]) for (const h of defaultHolidays(y)) hol.push(h.day);
let samDays = new Set();
hol.filter(d => d >= addDays(today, -700) && d < today).forEach((h, i) => { if (i % 5 === 4) return; for (const k of [0, -1, 1]) { const d = addDays(h, k); if (fireShift(d) === "A") { samDays.add(d); break; } } });
for (let i = 30; i < 700; i += 97) { let d = addDays(today, -i); while (fireShift(d) !== "A") d = addDays(d, 1); samDays.add(d); }
for (const d of samDays) await post("/api/sick/entries", { userId: uid("Sam Shift"), from: d, hours: 24, kind: "sick" });
// Tia: a few scattered call-outs, and FMLA that must not count
for (const back of [200, 420]) { let d = addDays(today, -back); while (fireShift(d) !== "B") d = addDays(d, 1); await post("/api/sick/entries", { userId: uid("Tia Steady"), from: d, kind: "sick", noteOnFile: true }); }
let fm = addDays(today, -60); while (fireShift(fm) !== "B") fm = addDays(fm, 1);
r = await post("/api/sick/entries", { userId: uid("Tia Steady"), from: fm, to: addDays(fm, 12), kind: "fmla", notes: "approved FMLA" });
check("a range logs one entry per scheduled shift", r.status === 200 && r.body.days.length === 5 && r.body.days.every(d => fireShift(d) === "B"), JSON.stringify(r.body));
check("hours default to the shift (24 h)", psql(`SELECT DISTINCT hours FROM sick_entries WHERE user_id = '${uid("Tia Steady")}'`) === "24.00");
check("Sue can't log for Communications", (await post("/api/sick/entries", { userId: uid("Bea Dispatch"), from: today })).status === 403);
const a = (await api("/api/sick/analysis")).body;
const sam = a.people.find(p => p.name === "Sam Shift"), tia = a.people.find(p => p.name === "Tia Steady");
check("Sam: holiday pattern found", sam.patterns.some(p => p.key === "holiday" && /on or next to a holiday/.test(p.text)), JSON.stringify(sam.patterns));
check("Sam: same holiday in more than one year", sam.patterns.some(p => p.key.startsWith("rep")));
check("Sam: high risk on a coming holiday shift", sam.peak && sam.peak.score >= 8, JSON.stringify(sam.peak));
check("Tia: FMLA not counted (2 call-outs, low risk)", tia.S === 2 && tia.protectedHours === 120 && tia.peak.score < 4 && !tia.patterns.length, JSON.stringify([tia.S, tia.protectedHours, tia.peak, tia.patterns]));
check("Bradford factor", sam.bradford === sam.S * sam.S * sam.D);
const o = (await api("/api/sick/outlook?days=60&min=7")).body;
const samDay = o.outlook.find(d => d.people.some(p => p.name === "Sam Shift"));
check("Outlook: Sam flagged on a holiday-window shift", samDay && /holiday|Thanksgiving|Christmas|Eve|Day/i.test(samDay.people.find(p => p.name === "Sam Shift").why.join(" ")), JSON.stringify(samDay));
check("Outlook lists the holidays", o.outlook.some(d => d.holiday === "Thanksgiving"));
await login("cal@sgfd.org");
const calMeta = (await api("/api/sick")).body;
check("Cal (view, Communications) sees only Communications", calMeta.people.every(p => p.division === "Communications") && !calMeta.people.some(p => p.canEdit));
check("Cal can't see Sam", !(await api("/api/sick/analysis")).body.people.some(p => p.name === "Sam Shift"));
check("Cal can't log", (await post("/api/sick/entries", { userId: uid("Bea Dispatch"), from: today })).status === 403);
check("audit has the sick leave entries", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Sick leave'")) >= samDays.size);

// ---- Sick Leave UI ---------------------------------------------------------------------------------------------
await login("sue@sgfd.org");
await open("Sick Leave");
b = await body();
check("Sick Leave opens on the Outlook with Sam", /Outlook/.test(b) && /Sam Shift/.test(b) && /not proof/.test(b), b.slice(0, 300));
await page.screenshot({ path: "shot-sick-outlook.png" });
await page.getByRole("button", { name: "Open Sam Shift" }).first().click(); await page.waitForTimeout(1500);
b = await body();
check("person page: patterns, risky shifts, call-outs", /on or next to a holiday/.test(b) && /Highest-risk scheduled shifts/.test(b) && /bradford/i.test(b));
await page.screenshot({ path: "shot-sick-person.png", fullPage: true });
await nav("People");
check("People page", /Sam Shift/.test(await body()) && /Tia Steady/.test(await body()));
await nav("Log a call-out");
await page.getByLabel("Person").selectOption({ label: "Tia Steady · Suppression" });
let nd = today; while (fireShift(nd) !== "B") nd = addDays(nd, 1);
await page.getByLabel("First day").fill(nd);
await page.getByLabel("Notes").fill("called the BC");
await page.getByRole("button", { name: "Log call-out" }).click(); await page.waitForTimeout(1500);
check("UI log", psql(`SELECT count(*) FROM sick_entries WHERE user_id = '${uid("Tia Steady")}' AND day = '${nd}'`) === "1");
check("lands on Call-outs with the entry", /called the BC/.test(await body()));
await page.getByRole("button", { name: `Change call-out ${nd}` }).click(); await page.waitForTimeout(400);
await page.getByRole("dialog").getByLabel("Hours").fill("12");
await page.getByRole("dialog").getByRole("button", { name: "Save" }).click(); await page.waitForTimeout(1200);
check("edit an entry", psql(`SELECT hours FROM sick_entries WHERE user_id = '${uid("Tia Steady")}' AND day = '${nd}'`) === "12.00");
await login("mike@sgfd.org");
await open("Sick Leave"); await nav("Settings");
await page.getByLabel("Alert score").fill("8"); await page.getByRole("button", { name: "Save settings" }).click(); await page.waitForTimeout(1000);
check("settings saved", (await api("/api/sick")).body.settings.alertScore === 8);

// ---- Setting shifts from Sick Leave (people whose shift isn't set up yet) ----------------------------------------
await login("cal@sgfd.org");
check("view-only can't set shifts", (await post("/api/sick/shifts", { shifts: [{ userId: uid("Bea Dispatch"), pattern: "comms:A" }] })).status === 403);
await login("sue@sgfd.org");
check("editor can't set shifts outside their divisions", (await post("/api/sick/shifts", { shifts: [{ userId: uid("Bea Dispatch"), pattern: "comms:A" }] })).status === 403);
check("only shifts from the list", (await post("/api/sick/shifts", { shifts: [{ userId: uid("Ray Requester"), pattern: "fire:Z" }] })).status === 400);
await open("Sick Leave"); await nav("People");
b = await body();
check("People page lists who has no shift, with a button", /no shift set/.test(b) && /Ray Requester/.test(b) && await page.getByRole("button", { name: "Set their shifts" }).count() === 1);
await page.getByRole("button", { name: "Set their shifts" }).click(); await page.waitForTimeout(500);
const dlg = page.getByRole("dialog", { name: "Set shifts" });
check("dialog lists the people without a shift (not Sam, who has one)", await dlg.getByLabel("Shift for Ray Requester").count() === 1 && await dlg.getByLabel("Shift for Sam Shift").count() === 0);
await dlg.getByLabel("Shift for Ray Requester").selectOption("fire:C");
await page.screenshot({ path: "shot-sick-setshifts.png" });
await dlg.getByRole("button", { name: /^Save 1 shift$/ }).click(); await page.waitForTimeout(1500);
check("Ray's shift saved on his account", psql(`SELECT work_pattern FROM users WHERE full_name = 'Ray Requester'`) === "fire:C");
let ra = (await api("/api/sick/analysis")).body.people.find(p => p.name === "Ray Requester");
check("Ray now gets a schedule (C shift)", ra && !ra.schedule.missing && /C shift/.test(ra.schedule.label), JSON.stringify(ra?.schedule));
check("page refreshed: Ray no longer flagged", !(await page.getByRole("dialog").count()) && /C shift, 24 hours/.test(await page.getByRole("button", { name: "Open Ray Requester" }).innerText()));
await page.getByRole("button", { name: "Open Dana Purchaser" }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Set shift" }).click();
await page.getByLabel("Shift for Dana Purchaser").selectOption("fire:A");
await page.getByRole("button", { name: "Save shift" }).click(); await page.waitForTimeout(1500);
check("set from the person page", psql(`SELECT work_pattern FROM users WHERE full_name = 'Dana Purchaser'`) === "fire:A" && /A shift, 24 hours/.test(await body()) && await page.getByRole("button", { name: "Change shift" }).count() === 1);
await nav("Shifts");
check("Shifts page lists everyone the editor covers", await page.getByRole("table", { name: "Shifts" }).count() === 1 && await page.getByLabel("Shift for Tia Steady").count() === 1 && await page.getByLabel("Shift for Bea Dispatch").count() === 0);
await page.getByLabel("Shift for Tia Steady").selectOption("fire:C");
await page.getByRole("button", { name: "Save 1 change" }).click(); await page.waitForTimeout(1500);
check("changed a shift from the Shifts page", psql(`SELECT work_pattern FROM users WHERE full_name = 'Tia Steady'`) === "fire:C" && await page.getByRole("button", { name: "No changes" }).count() === 1);
await page.getByLabel("Only people with no shift").check();
check("filter: only people with no shift", await page.getByLabel("Shift for Tia Steady").count() === 0 && await page.getByLabel("Shift for Sue Super").count() === 1);
await page.screenshot({ path: "shot-sick-shifts.png" });
check("audited with old and new", /Ray Requester: C shift/.test(psql(`SELECT string_agg(detail, ' | ') FROM audit_log WHERE module = 'Sick leave' AND action LIKE 'Set %shift%'`)));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(x => x.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
