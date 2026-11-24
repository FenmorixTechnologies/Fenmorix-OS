import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";

fs.writeFileSync("/tmp/invoice.pdf", "%PDF-1.4\n% test invoice\n");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async (p = page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(250); };

async function login(email, password = PW, p = page) {
  await p.context().clearCookies();
  await p.goto(BASE); await settle(p);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(password);
  await p.getByRole("button", { name: "Sign in" }).click(); await settle(p);
}
async function openModule(label, p = page) { await p.getByText(label, { exact: true }).first().click(); await settle(p); }
async function api(path, opts = {}, p = page) {
  return p.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [path, opts]);
}
const write = (key, payload, p = page) => api(`/api/collections/${key}`, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(payload) }, p);
const read = async (key, p = page) => (await api(`/api/collections/${key}`, {}, p)).body?.value;
async function openReq(title) {
  if (await page.getByText(/^Requested by .+ on /).count() === 0) { await page.getByText(title).first().click(); await settle(); }
}


fs.writeFileSync("/tmp/quote.pdf", "%PDF-1.4\n% test quote\n");
const ld = v => v ? new Date(v).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) : null;
const post = (path, body, p = page) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) }, p);

// setup accounts
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [["Pat Purchaser","pat@sgfd.org","Suppression","approver1"],["Quinn Preapprover","quinn@sgfd.org","Suppression","approver2"],
  ["Chief Jones","chief@sgfd.org","Administration","fire_chief"],["Alex Accounting","alex@sgfd.org","Administration","accounting"],["Riley Requester","riley@sgfd.org","Suppression","user"]];
for (const [n, e, d] of people) await post("/api/auth/signup", { name: n, email: e, division: d, password: PW }, reg);
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const [, , d, role] = people.find(p => p[0] === a.name);
  await post("/api/auth/approve", { id: a.id, role, division: d });
}


const reqByTitle = async t => (await read("requisitions")).find(r => r.title === t);
async function openCard(title) {
  await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
  await page.getByText(title, { exact: true }).first().click(); await settle();
}

// Riley creates a pending requisition; Mike enters a paid historical one
await login("riley@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("Hose nozzles");
await page.getByPlaceholder("Vendor or company name").fill("Fire Supply Co");
await page.getByPlaceholder("0.00").first().fill("640");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();

// ---- Requester edits own pending requisition
await openCard("Hose nozzles");
await page.getByRole("button", { name: "Edit", exact: true }).click(); await settle();
check("edit opens the form with current values", await page.getByText("Edit requisition").count() > 0 &&
  await page.getByPlaceholder("0.00").first().inputValue() === "640");
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("Hose nozzles (6)");
await page.getByPlaceholder("0.00").first().fill("720");
await page.getByPlaceholder("INV-0000").fill("FS-118");
await page.getByRole("button", { name: "Save changes" }).click(); await settle();
let r = await reqByTitle("Hose nozzles (6)");
check("requester's edit saved", r && r.amount === 720 && r.invoiceNumber === "FS-118" && r.status === "pending_auth1", JSON.stringify({ a: r?.amount, i: r?.invoiceNumber }));
const auditR = async () => (await (async () => { await login("mike@sgfd.org"); return read("audit-log"); })());

// ---- Someone else can't edit or delete it
await login("pat@sgfd.org");
const patEdit = await post("/api/collections/requisitions", { upserts: [{ ...r, amount: 1 }], deletes: [] });
check("another user can't edit someone's requisition", patEdit.status === 403, `${patEdit.status} ${patEdit.body?.error}`);
const patDel = await post("/api/collections/requisitions", { upserts: [], deletes: [r.id] });
check("another user can't delete it", patDel.status === 403);

// ---- Historical paid requisition by Mike
await login("mike@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.locator("label:has-text('Requisition date') + input").fill("2026-02-01");
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("End User Tech Support Technician");
await page.getByPlaceholder("Vendor or company name").fill("Avexon");
await page.getByPlaceholder("0.00").first().fill("5270");
await page.getByPlaceholder("INV-0000").fill("AVX-0201");
await page.locator("label:has-text('Division') + select").selectOption("Suppression");
await page.locator("#onPaper").check();
await page.getByLabel("Purchaser's signature signer").selectOption("Pat Purchaser");
await page.getByLabel("Purchaser's signature date").fill("2026-02-02");
await page.getByLabel("Pre-approval signer").selectOption("Quinn Preapprover");
await page.getByLabel("Pre-approval date").fill("2026-02-03");
await page.getByLabel("Final approval signer").selectOption("Chief Jones");
await page.getByLabel("Final approval date").fill("2026-02-05");
await page.getByLabel("Paid on").fill("2026-02-09");
await page.getByRole("button", { name: "Record requisition" }).click(); await settle();
let paid = await reqByTitle("End User Tech Support Technician");
check("historical paid requisition recorded", paid?.status === "paid");

// ---- Master fixes a typo on the paid one (5270 should be 5720)
await openCard("End User Tech Support Technician");
await page.getByRole("button", { name: "Edit", exact: true }).click(); await settle();
check("warning shown when editing a finalized requisition", await page.getByText(/You can change it as a master admin/).count() > 0);
await page.getByPlaceholder("0.00").first().fill("5720");
await page.getByRole("button", { name: "Save changes" }).click(); await settle();
paid = await reqByTitle("End User Tech Support Technician");
check("master corrects the amount on a paid requisition; status and signatures intact",
  paid.amount === 5720 && paid.status === "paid" && paid.chief?.name === "Chief Jones" && ld(paid.paidDate) === "2026-02-09",
  JSON.stringify({ a: paid.amount, s: paid.status }));
let audit = await read("audit-log");
const edit = audit.find(a => a.action === "Edited paid requisition");
check("edit logged with old → new", !!edit && edit.detail.includes("$5,270.00 → $5,720.00"), edit?.detail);

// ---- Non-master can't edit or delete a finalized one
await login("alex@sgfd.org");
const alexEdit = await post("/api/collections/requisitions", { upserts: [{ ...paid, invoiceNumber: "X" }], deletes: [] });
check("accounting can't edit a paid requisition", alexEdit.status === 403, alexEdit.body?.error);
await login("riley@sgfd.org");
await openModule("Procurement / Requisitions");
await openCard("End User Tech Support Technician");
check("requester sees no Edit/Delete on a paid requisition", await page.getByRole("button", { name: "Edit", exact: true }).count() === 0 &&
  await page.getByRole("button", { name: "Delete requisition" }).count() === 0);

// ---- Requester deletes own pending requisition
await page.getByText("End User Tech Support Technician", { exact: true }).first().click(); await settle();
await page.getByText("Hose nozzles (6)", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "Delete requisition" }).click(); await settle();   // dialog auto-accepted
check("requester deletes own pending requisition", !(await reqByTitle("Hose nozzles (6)")));

// ---- Master deletes the paid one; snapshot kept
await login("mike@sgfd.org");
await openModule("Procurement / Requisitions");
await openCard("End User Tech Support Technician");
await page.getByRole("button", { name: "Delete requisition" }).click(); await settle();
check("master deletes a paid requisition", !(await reqByTitle("End User Tech Support Technician")));
audit = await read("audit-log");
const del = audit.find(a => a.action === "Deleted paid requisition");
check("deletion snapshot in audit log", !!del && del.detail.includes("Avexon") && del.detail.includes("$5720.00") && del.detail.includes("Final approval: Chief Jones Feb 5, 2026") && del.detail.includes("paid Feb 9, 2026"), del?.detail);
check("requester's delete also logged", audit.some(a => a.action === "Deleted requisition" && a.actor === "Riley Requester"));

// ---- Quotes: edit, delete, linked protection
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "New quote" }).click();
await page.getByLabel("Quote vendor").fill("Overhead Door Co");
await page.getByLabel("Quote title").fill("Bay door opener");
await page.getByLabel("Quote cost").fill("3200");
await page.locator("#quote-files").setInputFiles("/tmp/quote.pdf");
await page.getByRole("button", { name: "Save quote" }).click(); await settle(); await page.waitForTimeout(300);
await page.getByText("Bay door opener").first().click(); await settle();
await page.getByRole("button", { name: "Edit quote" }).click();
await page.getByLabel("Quote cost").last().fill("2950");
await page.getByLabel("Quote number").last().fill("Q-1");
await page.getByRole("button", { name: "Save changes" }).click(); await settle();
let qs = await read("quotes");
check("quote edited", qs[0].amount === 2950 && qs[0].quoteNumber === "Q-1");
check("quote edit logged", (await read("audit-log")).some(a => a.action === "Edited quote" && a.detail.includes("$3200.00 → $2950.00")));

await page.getByRole("button", { name: "Accept quote" }).click(); await settle();
await page.getByRole("button", { name: "Create requisition from this quote" }).click(); await settle();
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByText("Bay door opener").first().click(); await settle();
check("quote with a requisition can't be deleted (button replaced with note)", await page.getByRole("button", { name: "Delete quote" }).count() === 0 &&
  await page.getByText(/delete its requisition first/).count() > 0);
const forced = await post("/api/collections/quotes", { upserts: [], deletes: [qs[0].id] });
check("server also refuses deleting a linked quote", forced.status === 403, forced.body?.error);

// delete the linked requisition, then the quote
const fromQ = await reqByTitle("Bay door opener");
await post("/api/collections/requisitions", { upserts: [], deletes: [fromQ.id] });
await page.reload(); await settle();
await openModule("Procurement / Requisitions");
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByText("Bay door opener").first().click(); await settle();
const qfile = qs[0].attachments[0].id;
await page.getByRole("button", { name: "Delete quote" }).click(); await settle(); await page.waitForTimeout(500);
check("quote deleted once its requisition is gone", (await read("quotes")).length === 0);
check("quote's document removed from disk", !fs.existsSync(`/home/claude/testrun/app/uploads/${qfile}`));

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
