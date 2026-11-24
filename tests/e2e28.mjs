// Procurement / Reimbursements / Help Desk refresh: document autofill (PDF, Excel, CSV, Word) through the server,
// spreadsheet import (.xlsx), wider attachments, server-side visibility rules, Nexus messages on each step,
// Help Desk permission, Admin pointing to User Management. Fictional people only.
// Run with: ANTHROPIC_API_KEY=test AI_API_BASE=http://127.0.0.1:3099 ./reset-db.sh
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
const { workbook, zip } = await import("/home/claude/testrun/app/server/xlsx.js");
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const SP = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const inbox = (who, like) => Number(psql(`SELECT count(*) FROM message_threads t JOIN message_recipients r ON r.thread_id = t.id JOIN users u ON u.id = r.user_id WHERE u.full_name = '${who}' AND r.via <> 'Sender' AND t.subject LIKE '${like}'`));

// Mock of the Claude API: remembers what it was shown, answers with invoice fields
let seen = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", c => b += c); req.on("end", () => {
    const body = JSON.parse(b); const block = body.messages[0].content[0];
    seen.push({ type: block.type, media: block.source?.media_type, text: block.text || "", key: req.headers["x-api-key"], model: body.model });
    const fields = { division: "Suppression", category: "Equipment", vendor: "Gulf Safety Supply", title: "Hydrostatic testing of SCBA cylinders",
      description: "24 cylinders", invoiceNumber: "GS-7781", date: "2026-10-20", paymentMethod: "Check",
      lineItems: [{ description: "Hydro test", amount: 1200, frequency: "yearly" }, { description: "Shipping", amount: 85, frequency: "one_time" }] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(fields) + "\n```" }] }));
  });
}).listen(3099);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1" } });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, opts]);
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
const getC = async key => (await api(`/api/collections/${key}`)).body.value;
const saveC = (key, upserts, deletes = []) => api(`/api/collections/${key}`, { method: "POST", body: JSON.stringify({ upserts, deletes }) });
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE).catch(() => page.waitForTimeout(500).then(() => page.goto(BASE))); await page.waitForTimeout(700);
  await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1600);
}
const body = () => page.locator("body").innerText();
const open = async name => { await page.goto(BASE); await page.waitForTimeout(1200); await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(1500); };
const nav = async label => { await page.getByRole("button", { name: label, exact: true }).first().click(); await page.waitForTimeout(1200); };

await page.goto(BASE); await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const P = [["Ray Requester", "ray", "Suppression", "user"], ["Dana Purchaser", "dana", "Suppression", "approver1"], ["Paul Preapprove", "paul", "Suppression", "approver2"],
  ["Carl Chief", "carl", "Administration", "fire_chief"], ["Alice Accounts", "alice", "Administration", "accounting"], ["Tess Tech", "tess", "Technology", "user"],
  ["Ada Admin", "ada", "Administration", "user"], ["Wes Wellness", "wes", "Wellness", "user"]];
for (const [n, e, d] of P) { const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE); await p2.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: d, password: PW }); }
await login("mike@sgfd.org");
const acc = (await api("/api/auth/accounts")).body.accounts;
for (const [n, , d, role] of P) await post("/api/auth/approve", { id: acc.find(x => x.name === n).id, role, division: d });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);

// ---- Files for autofill / import -------------------------------------------------------------------
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const xl = workbook({ sheets: [{ name: "Invoice", rows: [["Gulf Safety Supply", null, "Invoice", "GS-7781"], ["Hydro test", 1200], ["Shipping", 85]] }] });
const docx = zip([{ name: "[Content_Types].xml", data: Buffer.from("<Types/>") }, { name: "word/document.xml", data: Buffer.from('<w:document><w:body><w:p><w:r><w:t>Requisition: SCBA hydro testing</w:t></w:r></w:p><w:p><w:r><w:t>Amount &amp; total 1,285.00</w:t></w:r></w:p></w:body></w:document>') }]);
const b64 = b => Buffer.from(b).toString("base64");
const D = ["Suppression", "Administration"], C = ["Equipment", "Supplies"];
let r = await post("/api/documents/autofill", { filename: "invoice.pdf", data: b64(pdf), divisions: D, categories: C });
check("autofill: PDF sent to Claude as a document", r.status === 200 && seen.at(-1).type === "document" && seen.at(-1).media === "application/pdf" && r.body.fields.vendor === "Gulf Safety Supply", JSON.stringify(r.body).slice(0, 200));
check("autofill: the API key stays on the server and goes with the request", seen.at(-1).key === "test");
r = await post("/api/documents/autofill", { filename: "invoice.xlsx", data: b64(xl), divisions: D, categories: C });
check("autofill: Excel read as text (cells)", r.status === 200 && seen.at(-1).type === "text" && /GS-7781/.test(seen.at(-1).text) && /Hydro test\t1200/.test(seen.at(-1).text), seen.at(-1).text.slice(0, 120));
r = await post("/api/documents/autofill", { filename: "invoice.csv", data: b64("Vendor,Amount\nGulf Safety Supply,1285\n"), divisions: D, categories: C });
check("autofill: CSV read as text", r.status === 200 && /Gulf Safety Supply\t1285/.test(seen.at(-1).text));
r = await post("/api/documents/autofill", { filename: "req.docx", data: b64(docx), divisions: D, categories: C });
check("autofill: Word (.docx) text", r.status === 200 && /SCBA hydro testing/.test(seen.at(-1).text) && /Amount & total/.test(seen.at(-1).text), seen.at(-1).text.slice(0, 120));
r = await post("/api/documents/autofill", { filename: "old.xls", data: b64("xx"), divisions: D, categories: C });
check("old .xls: says to save as .xlsx", r.status === 415 && /Save As/.test(r.body.error), JSON.stringify(r.body));
r = await post("/api/documents/autofill", { filename: "photo.heic", data: b64("xx"), divisions: D, categories: C });
check("HEIC: explains what to do", r.status === 415 && /screenshot/.test(r.body.error));
r = await post("/api/documents/sheet", { filename: "reqs.xlsx", data: b64(xl) });
check("spreadsheet reader for imports", r.status === 200 && r.body.sheets[0].rows[1][1] === 1200, JSON.stringify(r.body).slice(0, 150));

// ---- UI: autofill from Excel, file attached on submit ----------------------------------------------
await login("ray@sgfd.org");
await open("Procurement / Requisitions"); await nav("New requisition");
fs.writeFileSync(`${SP}/invoice.xlsx`, xl);
await page.getByLabel("Autofill file").setInputFiles(`${SP}/invoice.xlsx`);
await page.getByText(/Filled in from invoice.xlsx/).waitFor({ timeout: 8000 }).catch(() => {});
let b = await body();
check("UI: autofill filled the form from Excel", /Filled in from invoice.xlsx/.test(b) && await page.locator('input[value="Hydrostatic testing of SCBA cylinders"]').count() === 1, (b.match(/Autofill[\s\S]{0,300}/) || [])[0]);
check("UI: offers to attach the file", await page.getByText("Attach invoice.xlsx to this requisition").count() === 1);
check("UI: date from the invoice", await page.locator('input[type="date"][value="2026-10-20"]').count() === 1);
await page.screenshot({ path: "shot-req-autofill.png", fullPage: true });
await page.getByRole("button", { name: "Submit requisition" }).click(); await page.waitForTimeout(1800);
let reqs = await getC("requisitions");
const hydro = reqs.find(x => x.title === "Hydrostatic testing of SCBA cylinders");
check("submitted with the autofill file attached", hydro && hydro.attachments.length === 1 && hydro.attachments[0].name === "invoice.xlsx" && hydro.amount === 1285, JSON.stringify(hydro).slice(0, 300));
check("Dana (purchaser's signature for Suppression) messaged", inbox("Dana Purchaser", "Requisition to sign: Hydrostatic%") === 1);
check("not sent to other divisions' signers or the requester", inbox("Ray Requester", "Requisition to sign%") === 0);
// attach a CSV and an Excel file afterwards
await nav("Requisitions");
await page.getByRole("button", { name: /^Hydrostatic testing of SCBA cylinders, \$1,285/ }).first().click(); await page.waitForTimeout(600);
const acc1 = await page.locator('input[id^="invoice-upload-"]').first().getAttribute("accept");
check("attachments accept CSV, Excel, Word, PDF, pictures", [".csv", ".xlsx", ".xls", ".docx", ".pdf", ".jpg", ".heic"].every(x => acc1.includes(x)), acc1);
fs.writeFileSync(`${SP}/quote.csv`, "Item,Amount\nHydro,1200\n");
await page.locator('input[id^="invoice-upload-"]').first().setInputFiles(`${SP}/quote.csv`); await page.waitForTimeout(1500);
check("CSV attached", (await getC("requisitions")).find(x => x.id === hydro.id).attachments.some(a => a.name === "quote.csv"));

// ---- Signing chain messages --------------------------------------------------------------------------
const sign = async (email, stage, next, extra = {}) => {
  await login(email);
  const cur = (await getC("requisitions")).find(x => x.id === hydro.id);
  return saveC("requisitions", [{ ...cur, [stage]: { name: "x", date: new Date().toISOString(), decision: "approved" }, status: next, ...extra }]);
};
r = await sign("dana@sgfd.org", "auth1", "pending_auth2");
check("Dana signs", r.status === 200, JSON.stringify(r.body));
check("Paul (pre-approval) messaged", inbox("Paul Preapprove", "Requisition to sign: Hydrostatic%") === 1);
await sign("paul@sgfd.org", "auth2", "pending_chief");
check("Carl (Fire Chief) messaged", inbox("Carl Chief", "Requisition to sign: Hydrostatic%") === 1);
await sign("carl@sgfd.org", "chief", "approved");
check("Ray told it's approved", inbox("Ray Requester", "Requisition approved: Hydrostatic%") === 1);
check("Alice (accounting) told it's ready to pay", inbox("Alice Accounts", "Ready to pay: Hydrostatic%") === 1);
await login("alice@sgfd.org");
let cur = (await getC("requisitions")).find(x => x.id === hydro.id);
r = await saveC("requisitions", [{ ...cur, status: "paid", paidDate: new Date().toISOString() }]);
check("Ray told it's paid", r.status === 200 && inbox("Ray Requester", "Requisition paid: Hydrostatic%") === 1, JSON.stringify(r.body));

// ---- Who sees what (server-side) -------------------------------------------------------------------
await login("ada@sgfd.org");
const adaReq = { id: crypto.randomUUID(), division: "Administration", category: "Supplies", title: "Office paper", vendor: "Paper Co", vendorId: null, description: "", contractual: false, frequency: "one_time", amount: 50, lineItems: [], invoiceNumber: "", paymentMethod: "Check", cardLast4: "", cardholderName: "", requestedBy: "Ada Admin", createdAt: "2026-11-09T12:00:00", status: "pending_auth1", auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [] };
r = await saveC("requisitions", [adaReq]);
check("Ada submits an Administration requisition", r.status === 200, JSON.stringify(r.body));
await login("ray@sgfd.org");
reqs = await getC("requisitions");
check("Ray (Suppression) doesn't get Administration requisitions", !reqs.some(x => x.division === "Administration") && reqs.some(x => x.id === hydro.id), reqs.map(x => x.division).join());
await login("alice@sgfd.org");
check("accounting sees every division", (await getC("requisitions")).some(x => x.id === adaReq.id));

// Reimbursements
await login("ray@sgfd.org");
const reimb = { id: crypto.randomUUID(), type: "travel", requesterId: "", requesterName: "", division: "Suppression", staffId: "", position: "", supervisor: "", reason: "Fire school, Baton Rouge", payPeriodFrom: "", payPeriodTo: "", advances: 0, lineItems: [{ id: crypto.randomUUID(), date: "2026-11-01", description: "Drive", lodging: 0, miles: 120, mealsPerDiem: 0, parking: 0, other: 0 }], status: "pending_approval", approval: null, rejectedReason: null, paidDate: null, attachments: [], createdAt: new Date().toISOString() };
r = await saveC("reimbursements", [reimb]);
check("Ray submits a reimbursement", r.status === 200, JSON.stringify(r.body));
check("Suppression approvers messaged (Dana, Paul)", inbox("Dana Purchaser", "Reimbursement to approve%") === 1 && inbox("Paul Preapprove", "Reimbursement to approve%") === 1);
await login("wes@sgfd.org");
check("Wes (another division) can't see Ray's reimbursement", !(await getC("reimbursements")).some(x => x.id === reimb.id));
r = await saveC("reimbursements", [], [reimb.id]);
check("Wes can't delete it", r.status === 403, JSON.stringify(r.body));
r = await saveC("reimbursements", [{ ...reimb, requesterName: "Ray Requester", reason: "changed by Wes" }]);
check("Wes can't change it", r.status === 403);
await login("dana@sgfd.org");
cur = (await getC("reimbursements")).find(x => x.id === reimb.id);
r = await saveC("reimbursements", [{ ...cur, status: "approved", approval: { name: "Dana Purchaser", date: new Date().toISOString(), decision: "approved" } }]);
check("Dana approves; Ray and accounting told", r.status === 200 && inbox("Ray Requester", "Reimbursement approved%") === 1 && inbox("Alice Accounts", "Reimbursement ready to pay%") === 1, JSON.stringify(r.body));

// Help Desk
await login("ray@sgfd.org");
const tk = { id: crypto.randomUUID(), subject: "MDT won't boot on E61", category: "Hardware", priority: "High", division: "Suppression", location: "Station 61", description: "Black screen", requesterId: "spoofed", requesterName: "Somebody Else", assigneeId: null, assigneeName: null, status: "open", dueDate: "", comments: [], attachments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
r = await saveC("tickets", [tk]);
check("Ray opens a ticket", r.status === 200, JSON.stringify(r.body));
check("ticket is Ray's (not whoever the browser said)", psql(`SELECT requester_name FROM tickets WHERE id = '${tk.id}'`) === "Ray Requester");
check("Tess (Technology) told about the new ticket", inbox("Tess Tech", "New Help Desk ticket: MDT%") === 1);
let t1 = (await getC("tickets")).find(x => x.id === tk.id);
r = await saveC("tickets", [{ ...t1, status: "closed", assigneeId: uid("Ray Requester") }]);
t1 = (await getC("tickets")).find(x => x.id === tk.id);
check("Ray can't change status or assignee of his ticket", t1.status === "open" && !t1.assigneeId, JSON.stringify([t1.status, t1.assigneeId]));
await login("wes@sgfd.org");
check("Wes doesn't see Ray's ticket", !(await getC("tickets")).some(x => x.id === tk.id));
r = await saveC("tickets", [{ ...t1, subject: "hijacked" }]);
check("Wes can't change Ray's ticket", r.status === 403);
await login("tess@sgfd.org");
t1 = (await getC("tickets")).find(x => x.id === tk.id);
r = await saveC("tickets", [{ ...t1, assigneeId: uid("Tess Tech"), status: "in_progress", comments: [{ id: crypto.randomUUID(), author: "Someone Else", body: "Swapping the drive today.", createdAt: new Date().toISOString() }] }]);
check("Tess takes it and comments", r.status === 200, JSON.stringify(r.body));
check("comment is signed as Tess", psql(`SELECT author_name FROM ticket_comments WHERE ticket_id = '${tk.id}'`) === "Tess Tech");
check("Ray told: status + comment", inbox("Ray Requester", "Your Help Desk ticket: MDT%") === 1);
await login("ray@sgfd.org");
t1 = (await getC("tickets")).find(x => x.id === tk.id);
await saveC("tickets", [{ ...t1, comments: [...t1.comments, { id: crypto.randomUUID(), author: "Ray Requester", body: "Thanks, it's at Station 61.", createdAt: new Date().toISOString() }] }]);
check("Ray's reply goes to Tess (assigned)", inbox("Tess Tech", "Ticket update: MDT%") === 1);
// Help Desk permission
await login("mike@sgfd.org");
r = await post("/api/access/grants", { section: "helpdesk", level: "edit", userId: uid("Ada Admin"), scope: "all" });
check("give Ada Help Desk: Edit", r.status === 200, JSON.stringify(r.body));
await login("ada@sgfd.org");
check("Ada now sees every ticket", (await getC("tickets")).some(x => x.id === tk.id));
check("roster marks Ada as a tech", (await getC("roster")).find(u => u.name === "Ada Admin").helpdeskTech === true);

// ---- UI checks ---------------------------------------------------------------------------------------
await open("Help Desk");
b = await body();
check("Ada (Help Desk: Edit) gets the tech view", /Assigned to me/.test(b) && /Import from Spiceworks/.test(b) && /MDT won't boot/.test(b));
await login("ray@sgfd.org");
await open("Help Desk"); await nav("New ticket");
b = await body();
check("new ticket page: no list or 'Cancel new ticket' under the form", !/Cancel new ticket/.test(b) && !/MDT won't boot/.test(b));
await open("Reimbursements"); await nav("New request");
check("new reimbursement page: list hidden", !/Fire school, Baton Rouge/.test(await body()) && !/Cancel new request/.test(await body()));
await login("mike@sgfd.org");
await open("Procurement / Requisitions"); await nav("Admin");
b = await body();
check("Admin points to User Management (no duplicate roster)", /Open User Management/.test(b) && !/Waiting for approval/i.test(b));
await page.getByRole("button", { name: "Open User Management" }).click(); await page.waitForTimeout(1500);
await page.screenshot({ path: "shot-um.png" }); check("opens User Management", /User Management/i.test(await body()), (await body()).slice(0, 200));
// Import from Excel
await open("Procurement / Requisitions"); await nav("Import");
const imp = workbook({ sheets: [{ name: "2026", rows: [["Date", "Division", "Category", "Title", "Vendor", "Amount", "Frequency"], ["2026-03-05", "Suppression", "Supplies", "Hose testing", "Hose Co", 900, "Yearly"], ["3/9/2026", "Wellness", "Supplies", "Gym mats", "Mat Co", 400.5, ""]] }] });
fs.writeFileSync(`${SP}/import.xlsx`, imp);
await page.getByLabel("Requisitions file").setInputFiles(`${SP}/import.xlsx`); await page.waitForTimeout(1500);
b = await body();
check("Excel import preview", /2 ready to import/.test(b) && /Hose testing/.test(b) && /Gym mats/.test(b), (b.match(/\d+ ready to import[^\n]*/) || [])[0]);
await page.getByRole("button", { name: /^Import 2 requisitions/ }).click(); await page.waitForTimeout(1500);
reqs = await getC("requisitions");
check("imported with the right dates (no day shift)", reqs.find(x => x.title === "Hose testing")?.createdAt.startsWith("2026-03-05") && reqs.find(x => x.title === "Gym mats")?.createdAt.startsWith("2026-03-09"),
  JSON.stringify(reqs.filter(x => /Hose|Gym/.test(x.title)).map(x => x.createdAt)));
// phone: requisition rows
const ph = await browser.newContext({ ...(await import("/opt/npm-tools/node_modules/playwright/index.mjs")).devices["iPhone 13"] });
const pp = await ph.newPage(); pp.on("pageerror", e => errors.push("phone: " + e.message));
await pp.goto(BASE); await pp.waitForTimeout(700);
await pp.getByLabel(/^Email/).fill("ray@sgfd.org"); await pp.getByLabel(/^Password/).fill(PW); await pp.getByRole("button", { name: "Sign in" }).click(); await pp.waitForTimeout(1600);
await pp.getByRole("button", { name: /menu/i }).first().click().catch(() => {}); await pp.waitForTimeout(400);
await pp.getByText("Procurement / Requisitions", { exact: true }).first().click(); await pp.waitForTimeout(1500);
await pp.getByRole("button", { name: /menu/i }).first().click().catch(() => {}); await pp.waitForTimeout(400);
await pp.getByRole("button", { name: "Requisitions", exact: true }).first().click(); await pp.waitForTimeout(1200);
const ow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone: no sideways scrolling", ow <= 2, `${ow}px`);
await pp.screenshot({ path: "shot-req-phone.png" });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(x => x.startsWith("PASS")).length}/${results.length} passed`);
await browser.close(); mock.close();
