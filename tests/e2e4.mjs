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
async function openModule(label, p = page) {
  if (label === "Certifications") {   // reached through Personnel File now
    await openModule("Personnel File", p);
    await p.getByRole("button", { name: /^Certifications/ }).click(); await settle(p);
    await p.getByRole("button", { name: "Open Certifications" }).click(); await settle(p);
    return;
  }
 await p.getByText(label, { exact: true }).first().click(); await settle(p); }
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

// ---------- Main menu navigation ----------
await login("mike@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Main menu", { exact: true }).first().click(); await settle();
check("sidebar Main menu button returns home", await page.getByRole("button", { name: "Home", exact: true }).count() > 0);
await openModule("Procurement / Requisitions");
await page.getByText("Procurement", { exact: false }).first().click(); await settle();
check("clicking the St. George Fire Procurement title returns home", await page.getByRole("button", { name: "Home", exact: true }).count() > 0);
await openModule("Certifications");
await page.getByRole("button", { name: "Main menu" }).click(); await settle();
check("module Main menu button returns home", await page.getByRole("button", { name: "Home", exact: true }).count() > 0);

// ---------- Historical entry with paper signatures (master) ----------
await openModule("Procurement / Requisitions");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.locator("label:has-text('Requisition date') + input").fill("2026-03-01");
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("End User Tech Support Technician");
await page.getByPlaceholder("Vendor or company name").fill("Avexon");
await page.locator("label:has-text('Frequency') + select").selectOption("monthly");
await page.getByPlaceholder("0.00").first().fill("5720");
await page.getByPlaceholder("INV-0000").fill("AVX-0301");
await page.locator("label:has-text('Division') + select").selectOption("Suppression");
await page.locator("#onPaper").check();
await page.getByLabel("Purchaser's signature signer").selectOption("Pat Purchaser");
await page.getByLabel("Purchaser's signature date").fill("2026-03-02");
await page.getByLabel("Pre-approval signer").selectOption("Quinn Preapprover");
await page.getByLabel("Pre-approval date").fill("2026-03-04");
await page.getByLabel("Final approval signer").selectOption("Chief Jones");
await page.getByLabel("Final approval date").fill("2026-03-06");
await page.getByLabel("Paid on").fill("2026-03-10");
await page.getByRole("button", { name: "Record requisition" }).click(); await settle();
let reqs = await read("requisitions");
let march = reqs.find(r => r.invoiceNumber === "AVX-0301");
check("historical requisition recorded as paid with real dates",
  march?.status === "paid" && march.createdAt.startsWith("2026-03-01") && ld(march.paidDate) === "2026-03-10",
  JSON.stringify({ s: march?.status, c: march?.createdAt, p: ld(march?.paidDate) }));
check("paper signatures keep real signers and dates, marked recorded by Mike",
  march?.auth1?.name === "Pat Purchaser" && ld(march.auth1.date) === "2026-03-02" && march.auth1.recordedBy === "Mike Admin" &&
  march.chief?.name === "Chief Jones" && ld(march.chief.date) === "2026-03-06",
  JSON.stringify([march?.auth1, march?.chief]));
await page.getByText("End User Tech Support Technician").first().click(); await settle();
check("detail shows 'signed on paper · recorded by'", await page.getByText("recorded by Mike Admin").count() >= 3);

// ---------- Repeat from the vendor's history (Avexon monthly bill) ----------
await page.getByText("Vendors", { exact: true }).first().click(); await settle();
await page.getByText("Avexon", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "Repeat" }).first().click(); await settle();
check("repeat opens a pre-filled requisition", await page.getByText(/Repeating/).count() > 0 &&
  await page.getByPlaceholder("e.g. Annual records-management software renewal").inputValue() === "End User Tech Support Technician" &&
  await page.getByPlaceholder("Vendor or company name").inputValue() === "Avexon" &&
  await page.getByPlaceholder("0.00").first().inputValue() === "5720" &&
  await page.getByPlaceholder("INV-0000").inputValue() === "");
await page.locator("label:has-text('Requisition date') + input").fill("2026-04-01");
await page.getByPlaceholder("INV-0000").fill("AVX-0401");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
reqs = await read("requisitions");
let april = reqs.find(r => r.invoiceNumber === "AVX-0401");
check("April copy saved: same details, new invoice and date, linked to March",
  april && april.title === march.title && april.amount === 5720 && april.frequency === "monthly" && april.division === "Suppression" &&
  april.createdAt.startsWith("2026-04-01") && april.status === "pending_auth1" && april.repeatedFrom === march.id,
  JSON.stringify({ t: april?.title, a: april?.amount, c: april?.createdAt, s: april?.status, r: april?.repeatedFrom === march?.id }));

// Repeat button on the requisition itself
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await page.getByText("End User Tech Support Technician").first().click(); await settle();
await page.getByRole("button", { name: "Repeat this requisition" }).click(); await settle();
check("Repeat this requisition button pre-fills too", await page.getByText(/Repeating/).count() > 0);
await page.getByRole("button", { name: "Start blank instead" }).click(); await settle();
check("Start blank clears the copy", await page.getByPlaceholder("e.g. Annual records-management software renewal").inputValue() === "");

// ---------- Accounting records a paper signature on a pending requisition ----------
await login("alex@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await page.locator("div", { hasText: /^End User Tech Support Technician$/ }).filter({ has: page.locator("xpath=..") }).first();
const aprilRow = page.getByText("AVX-0401");
// open April's card
const cards = page.getByText("End User Tech Support Technician");
for (let i = 0; i < await cards.count(); i++) {
  await cards.nth(i).click(); await settle();
  if (await page.getByText("Invoice AVX-0401").count() || await page.getByText("AVX-0401").count()) break;
  await cards.nth(i).click(); await settle();
}
await page.getByRole("button", { name: "Record paper signature" }).click();
await page.getByLabel("Paper signer").selectOption("Pat Purchaser");
await page.getByLabel("Paper signature date").fill("2026-04-02");
await page.getByRole("button", { name: "Record", exact: true }).click(); await settle();
april = (await read("requisitions")).find(r => r.invoiceNumber === "AVX-0401");
check("accounting records Pat's paper signature dated Apr 2",
  april.status === "pending_auth2" && april.auth1?.name === "Pat Purchaser" && ld(april.auth1.date) === "2026-04-02" && april.auth1.recordedBy === "Alex Accounting",
  JSON.stringify(april.auth1));

// Requester can't record paper signatures
await login("riley@sgfd.org");
const rileyForge = await post("/api/collections/requisitions", { upserts: [{ ...april, status: "pending_chief", auth2: { name: "Quinn Preapprover", date: "2026-04-03T12:00:00", decision: "approved", recorded: true } }], deletes: [] });
check("requester can't record a paper signature", rileyForge.status === 403, `${rileyForge.status} ${rileyForge.body?.error}`);

// ---------- Date corrections ----------
await login("alex@sgfd.org");
const alexFix = await post("/api/collections/requisitions", { upserts: [{ ...march, createdAt: "2026-02-27T12:00:00" }], deletes: [] });
check("accounting can't change dates on a finalized requisition", alexFix.status === 403, `${alexFix.status} ${alexFix.body?.error}`);

await login("mike@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
// open March's card
for (let i = 0; i < await cards.count(); i++) {
  await cards.nth(i).click(); await settle();
  if (await page.getByText("Paid Mar 10, 2026").count()) break;
  await cards.nth(i).click(); await settle();
}
await page.getByRole("button", { name: "Edit dates" }).click();
await page.locator("label:has-text('Requisition date') input").fill("2026-02-28");
await page.locator("label:has-text('Pre-approval') input").fill("2026-03-05");
await page.getByRole("button", { name: "Save dates" }).click(); await settle(); await page.waitForTimeout(400);
march = (await read("requisitions")).find(r => r.invoiceNumber === "AVX-0301");
check("master corrects dates on a paid requisition", march.createdAt.startsWith("2026-02-28") && ld(march.auth2.date) === "2026-03-05" && march.status === "paid",
  JSON.stringify({ c: march.createdAt, a2: ld(march.auth2.date) }));
const audit = await read("audit-log");
const fix = audit.find(a => a.action === "Corrected dates");
check("date correction written to audit log with old and new dates", !!fix && fix.detail.includes("Mar 1, 2026 → Feb 28, 2026") && fix.detail.includes("Mar 4, 2026 → Mar 5, 2026"), fix?.detail);
const tamper = await post("/api/collections/requisitions", { upserts: [{ ...march, title: "Changed after payment" }], deletes: [] });
march = (await read("requisitions")).find(r => r.invoiceNumber === "AVX-0301");
const editLog = (await read("audit-log")).find(a => a.action === "Edited paid requisition");
check("a master's edit to a paid requisition is saved and logged", tamper.status === 200 && march.title === "Changed after payment" && march.status === "paid" &&
  !!editLog && editLog.detail.includes('"End User Tech Support Technician" → "Changed after payment"'), editLog?.detail);
const statusJump = await post("/api/collections/requisitions", { upserts: [{ ...march, status: "approved" }], deletes: [] });
check("even a master can't change a paid requisition's status", statusJump.status !== 200, `${statusJump.status} ${statusJump.body?.error}`);
check("paper signatures appear in the audit log", audit.some(a => a.action.startsWith("Recorded paper signature") && a.actor === "Alex Accounting"));

// ---------- Quotes ----------
await login("riley@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "New quote" }).click();
await page.getByLabel("Quote vendor").fill("Overhead Door Co");
await page.getByLabel("Quote title").fill("Station 2 bay door opener");
await page.getByLabel("Quote cost").fill("3200");
await page.getByLabel("Quote number").fill("Q-7781");
await page.getByLabel("Quote date").fill("2026-04-10");
await page.locator("#quote-files").setInputFiles("/tmp/quote.pdf");
await page.getByRole("button", { name: "Save quote" }).click(); await settle(); await page.waitForTimeout(400);
let qs = await read("quotes");
check("Riley logs a quote with its document", qs.length === 1 && qs[0].status === "pending" && qs[0].quoteDate === "2026-04-10" && qs[0].attachments[0]?.name === "quote.pdf" && qs[0].createdBy === "Riley Requester",
  JSON.stringify(qs[0]));
const vendorsNow = await read("vendors");
check("new quote vendor added to vendor list", vendorsNow.some(v => v.name === "Overhead Door Co"));
await page.getByText("Station 2 bay door opener").click(); await settle();
check("requester sees no Accept button", await page.getByRole("button", { name: "Accept quote" }).count() === 0);
const rileyAccept = await post("/api/collections/quotes", { upserts: [{ ...qs[0], status: "accepted" }], deletes: [] });
check("requester can't accept a quote", rileyAccept.status === 403);

await login("pat@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByText("Station 2 bay door opener").click(); await settle();
await page.getByRole("button", { name: "Accept quote" }).click(); await settle();
qs = await read("quotes");
check("Pat accepts the quote", qs[0].status === "accepted" && qs[0].decidedBy === "Pat Purchaser");
await page.getByRole("button", { name: "Create requisition from this quote" }).click(); await settle();
check("requisition form filled from the quote", await page.getByText(/From quote:/).count() > 0 &&
  await page.getByPlaceholder("Vendor or company name").inputValue() === "Overhead Door Co" &&
  await page.getByPlaceholder("0.00").first().inputValue() === "3200");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
reqs = await read("requisitions");
const fromQuote = reqs.find(r => r.title === "Station 2 bay door opener");
check("requisition saved and linked to the quote", fromQuote?.quoteId === qs[0].id && fromQuote.amount === 3200 && fromQuote.description.includes("Q-7781"));
await page.getByText("Station 2 bay door opener").first().click(); await settle();
check("requisition shows which quote it came from", await page.getByText("From quote").count() > 0);
await page.getByText("Quotes", { exact: true }).first().click(); await settle();
await page.getByText("Station 2 bay door opener").first().click(); await settle();
check("quote lists its requisition", await page.getByText("Requisitions from this quote").count() > 0);

check("no save-error banners", await page.locator("#sgfd-save-error").count() === 0, await page.locator("#sgfd-save-error").count() ? await page.locator("#sgfd-save-error").innerText() : "");
check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
await page.screenshot({ path: "/home/claude/testrun/quotes.png" });
await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
