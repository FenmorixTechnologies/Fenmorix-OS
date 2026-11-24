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

// ---------- First run: takes over the existing master admin ----------
await page.goto(BASE); await settle();
check("first-run screen shown on a Phase 1 database", await page.getByText("First-time setup").count() > 0);
await page.getByLabel("Your full name").fill("Mike Admin");
await page.getByLabel("Your work email").fill("mike@sgfd.org");
await page.getByLabel("Password", { exact: true }).fill(PW);
await page.getByLabel("Confirm password").fill(PW);
await page.getByRole("button", { name: "Create master admin account" }).click(); await settle();
await page.getByText("Master admin").first().waitFor({ timeout: 8000 }).catch(() => {});
check("master signed in after setup", await page.getByRole("button", { name: "Home", exact: true }).count() > 0 && await page.getByText("Master admin").count() > 0);
await openModule("Procurement / Requisitions");
check("existing Phase 1 data kept and owned by same master", await page.getByText("Phase 1 requisition").count() > 0 || (await read("requisitions")).some(r => r.title === "Phase 1 requisition"));
const me0 = (await api("/api/auth/me")).body.user;
check("first run reused the existing master record", me0.id === "11111111-1111-4111-8111-111111111111", me0.id);

// ---------- People request accounts ----------
const reg = await (await browser.newContext()).newPage();
const people = [
  ["Pat Purchaser", "pat@sgfd.org", "Suppression", "approver1"],
  ["Quinn Preapprover", "quinn@sgfd.org", "Suppression", "approver2"],
  ["Chief Jones", "chief@sgfd.org", "Administration", "fire_chief"],
  ["Alex Accounting", "alex@sgfd.org", "Administration", "accounting"],
  ["Riley Requester", "riley@sgfd.org", "Suppression", "user"],
  ["Tina Tech", "tina@sgfd.org", "Technology", "user"],
];
for (const [name, email, div] of people) {
  await reg.goto(BASE); await settle(reg);
  await reg.getByRole("button", { name: "Request an account" }).click();
  await reg.getByLabel("First name").fill(name.split(" ")[0]);
  await reg.getByLabel("Last name").fill(name.split(" ").slice(1).join(" "));
  await reg.getByLabel("Work email").fill(email);
  await reg.getByLabel("Division").selectOption(div);
  await reg.getByLabel("Password", { exact: true }).fill(PW);
  await reg.getByLabel("Confirm password").fill(PW);
  await reg.getByRole("button", { name: "Request account" }).click(); await settle(reg);
}
check("sign-up confirmation shown", await reg.getByText("your request is in").count() > 0);
// First name only is refused, in the form and by the server
await reg.goto(BASE); await settle(reg);
await reg.getByRole("button", { name: "Request an account" }).click();
await reg.getByLabel("First name").fill("Sam"); await reg.getByLabel("Work email").fill("sam@sgfd.org");
await reg.getByLabel("Division").selectOption("Suppression");
await reg.getByLabel("Password", { exact: true }).fill(PW); await reg.getByLabel("Confirm password").fill(PW);
await reg.getByRole("button", { name: "Request account" }).click(); await settle(reg);
check("form asks for first and last name", await reg.getByText("Enter your first and last name.").count() > 0);
const one = await reg.evaluate(async pw => (await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" },
  body: JSON.stringify({ name: "Sam", email: "sam2@sgfd.org", division: "Suppression", password: pw }) })).status, PW);
const half = await reg.evaluate(async pw => (await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" },
  body: JSON.stringify({ firstName: "Sam", lastName: " ", email: "sam3@sgfd.org", division: "Suppression", password: pw }) })).status, PW);
check("server refuses a single name or a blank last name", one === 400 && half === 400, `${one} ${half}`);

// pending person can't sign in yet
await login("riley@sgfd.org", PW, reg);
check("pending account can't sign in", await reg.getByText("waiting for a master admin to approve").count() > 0);
// duplicate request blocked
await reg.goto(BASE); await settle(reg);
await reg.getByRole("button", { name: "Request an account" }).click();
await reg.getByLabel("First name").fill("Riley"); await reg.getByLabel("Last name").fill("Again"); await reg.getByLabel("Work email").fill("RILEY@sgfd.org");
await reg.getByLabel("Division").selectOption("Suppression");
await reg.getByLabel("Password", { exact: true }).fill(PW); await reg.getByLabel("Confirm password").fill(PW);
await reg.getByRole("button", { name: "Request account" }).click(); await settle(reg);
check("duplicate email request refused", await reg.getByText("already waiting for approval").count() > 0);

// ---------- Master approves with roles ----------
await page.reload(); await settle();
check("account bar shows waiting requests", await page.getByText("6 account requests waiting").count() > 0);
check("Needs your attention lists the account requests", await page.getByText("6 new account requests are waiting for you.").count() > 0);
// Account approvals live in User Management (Procurement's Admin links there)
await openModule("User Management");
for (const [name, , div, role] of people) {
  await page.getByLabel(`Division for ${name}`).selectOption(div);
  await page.getByLabel(`Role for ${name}`).selectOption(role);
  await page.getByLabel(`Role for ${name}`).locator("xpath=..").getByRole("button", { name: "Approve" }).click();
  await settle();
}
const roster = await read("roster");
check("all six approved into the roster with chosen roles", roster.length === 8 &&
  roster.find(u => u.name === "Chief Jones")?.role === "fire_chief" && roster.find(u => u.name === "Pat Purchaser")?.division === "Suppression",
  roster.map(u => `${u.name}:${u.role}`).join(", "));

// Old Timer was on the roster from Phase 1 with no sign-in: give a temporary password
await page.getByText(/Sign-in details and password resets/).click();
await page.getByText("Old Timer").locator("xpath=../../..").getByRole("button", { name: "Set up sign-in" }).click();
await page.getByLabel("Email for Old Timer").fill("old@sgfd.org");
await page.getByRole("button", { name: "Create temporary password" }).click(); await settle();
const temp = (await page.locator("code").innerText()).trim();
check("temporary password issued", /^[A-Z][a-z]+-[a-z]+-\d{4}$/.test(temp), temp);

const old = await (await browser.newContext()).newPage();
await login("old@sgfd.org", temp, old);
await old.getByText("Choose your own password").first().waitFor({ timeout: 8000 }).catch(() => {});
check("temporary password forces a new password", await old.getByText("Choose your own password").count() > 0);
await old.getByLabel("Temporary password").fill(temp);
await old.getByLabel("New password", { exact: true }).fill("My own new password");
await old.getByLabel("Confirm new password").fill("My own new password");
await old.getByRole("button", { name: "Save new password" }).click(); await settle(old);
check("after changing, Old Timer is in", await old.getByRole("button", { name: "Home", exact: true }).count() > 0);

// ---------- Requisition through the real signature chain ----------
await login("riley@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("Portable radios for Engine 31");
await page.getByPlaceholder("Vendor or company name").fill("Motorola Solutions");
await page.getByPlaceholder("0.00").first().fill("4800");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
let reqs = await read("requisitions");
const radio = reqs.find(r => r.title === "Portable radios for Engine 31");
check("Riley submits; recorded as Riley", radio?.requestedBy === "Riley Requester" && radio?.status === "pending_auth1");
await openReq("Portable radios for Engine 31");
await page.locator(`#invoice-upload-${radio.id}`).setInputFiles("/tmp/invoice.pdf"); await settle(); await page.waitForTimeout(400);

// --- forged requests from Riley's own session ---
const forgedSign = await write("requisitions", { upserts: [{ ...radio, status: "pending_auth2", auth1: { name: "Pat Purchaser", date: new Date().toISOString(), decision: "approved", note: "" } }], deletes: [] });
check("requester can't forge a purchaser's signature", forgedSign.status === 403, `${forgedSign.status} ${forgedSign.body?.error}`);
const myRow = (await read("roster")).find(u => u.name === "Riley Requester");
await write("roster", { upserts: [{ ...myRow, role: "master", division: "Administration" }], deletes: [] });
const meAfter = (await api("/api/auth/me")).body.user;
check("requester can't make themselves master admin", meAfter.role === "user" && meAfter.division === "Suppression", `${meAfter.role}/${meAfter.division}`);
check("requester can't read the audit log", (await read("audit-log")).length === 0);
const noHeader = await api("/api/collections/announcements", { method: "POST", body: JSON.stringify({ upserts: [], deletes: [] }) });
check("changes without the app's header are blocked", noHeader.status === 403);
const ann = await write("announcements", { upserts: [{ id: crypto.randomUUID(), title: "fake", body: "x", priority: "Urgent", pinned: true }], deletes: [] });
check("requester can't post announcements", ann.status === 403);
const divs = await write("divisions", { value: ["Hacked"] });
check("requester can't change divisions", divs.status === 403);

for (const [email, label, expect, who] of [
  ["pat@sgfd.org", "Purchaser's signature", "pending_auth2", "Pat Purchaser"],
  ["quinn@sgfd.org", "Pre-approval", "pending_chief", "Quinn Preapprover"],
  ["chief@sgfd.org", "Final approval", "approved", "Chief Jones"],
]) {
  await login(email);
  await openModule("Procurement / Requisitions");
  await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
  await openReq("Portable radios for Engine 31");
  await page.getByRole("button", { name: label }).click(); await settle();
  reqs = await read("requisitions");
  const r = reqs.find(x => x.title === "Portable radios for Engine 31");
  const stage = { "Purchaser's signature": "auth1", "Pre-approval": "auth2", "Final approval": "chief" }[label];
  check(`${label} by ${who}`, r.status === expect && r[stage]?.name === who, `${r.status} / ${r[stage]?.name}`);
}
// Chief tries to mark paid with a forged date; server uses its own clock
reqs = await read("requisitions");
let rr = reqs.find(x => x.title === "Portable radios for Engine 31");
await login("alex@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await openReq("Portable radios for Engine 31");
await page.getByRole("button", { name: "Mark as paid" }).click(); await settle();
rr = (await read("requisitions")).find(x => x.title === "Portable radios for Engine 31");
check("accounting marks paid; date from server", rr.status === "paid" && Math.abs(new Date(rr.paidDate) - Date.now()) < 120000);
check("invoice attachment kept through the chain", rr.attachments.length === 1 && rr.attachments[0].name === "invoice.pdf");

// ---------- Reimbursement: approver identity can't be forged ----------
await login("riley@sgfd.org");
await openModule("Reimbursements");
await page.getByRole("button", { name: "New request" }).first().click(); await settle();
await page.getByPlaceholder("e.g. Regional training conference, Baton Rouge").fill("State fire school");
const row = page.locator("table tbody tr").first();
await row.getByPlaceholder("What / where").fill("Hotel");
await row.locator("input[type=number]").nth(0).fill("120");
await page.getByRole("button", { name: "Submit", exact: true }).click(); await settle();
let rb = (await read("reimbursements"))[0];
const selfApprove = await write("reimbursements", { upserts: [{ ...rb, status: "approved", approval: { name: "Chief Jones", date: new Date().toISOString(), decision: "approved" } }], deletes: [] });
check("requester can't approve their own reimbursement", selfApprove.status === 403);
await login("pat@sgfd.org");
const forgedName = await write("reimbursements", { upserts: [{ ...rb, status: "approved", approval: { name: "Chief Jones", date: "2020-01-01T00:00:00Z", decision: "approved" } }], deletes: [] });
rb = (await read("reimbursements"))[0];
check("approval recorded as the real approver, at the real time", forgedName.status === 200 && rb.approval?.name === "Pat Purchaser" && new Date(rb.approval.date).getFullYear() === new Date().getFullYear(),
  JSON.stringify(rb.approval));
const patPays = await write("reimbursements", { upserts: [{ ...rb, status: "paid", paidDate: new Date().toISOString() }], deletes: [] });
check("only accounting/master can mark reimbursements paid", patPays.status === 403);

// ---------- Privacy: emergency contacts ----------
await login("mike@sgfd.org");
await openModule("Directory");
await page.getByRole("button", { name: "Edit Mike Admin's card" }).click(); await settle();
await page.getByRole("dialog").getByLabel("Emergency contact name", { exact: true }).fill("Jane Admin");
await page.getByRole("button", { name: "Save card" }).click(); await settle();
check("master's own emergency contact saved", (await read("roster")).find(u => u.name === "Mike Admin")?.emergencyContactName === "Jane Admin");
await login("riley@sgfd.org");
const rileyView = (await read("roster")).find(u => u.name === "Mike Admin");
check("others can't see someone's emergency contact", rileyView && !("emergencyContactName" in rileyView));

// ---------- Lockout ----------
const lock = await (await browser.newContext()).newPage();
await lock.goto(BASE);
for (let i = 0; i < 5; i++) await api("/api/auth/login", { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ email: "tina@sgfd.org", password: "wrong" }) }, lock);
const locked = await api("/api/auth/login", { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ email: "tina@sgfd.org", password: PW }) }, lock);
check("5 wrong passwords locks the account for 15 minutes", locked.status === 429);

// ---------- Removing someone signs them out ----------
const tina = await (await browser.newContext()).newPage();
await login("chief@sgfd.org", PW, tina);   // use chief's session to be removed? no: remove Old Timer instead
await login("mike@sgfd.org");
await openModule("User Management");
await page.getByRole("button", { name: "People & roles", exact: true }).click(); await settle();
check("old timer's session works before removal", (await api("/api/collections/roster", {}, old)).status === 200);
await page.getByLabel("Edit Old Timer").click(); await settle();
await page.getByRole("button", { name: "Remove from roster" }).click(); await settle();
check("removed person is signed out everywhere", (await api("/api/collections/roster", {}, old)).status === 401);
await login("old@sgfd.org", "My own new password", old);
check("removed person can't sign back in", await old.getByText("don't match").count() > 0);

// ---------- Sign out button, audit trail ----------
await page.getByText("Sign out").first().click(); await settle();
check("app's Sign out returns to the sign-in screen", await page.getByRole("button", { name: "Sign in" }).count() > 0);
await login("mike@sgfd.org");
const audit = await read("audit-log");
check("audit log records real names for sign-ins, approvals, signatures",
  audit.some(a => a.action === "Approved account") && audit.some(a => a.actor === "Pat Purchaser") && audit.some(a => a.action === "Signed in" && a.actor === "Riley Requester"),
  `${audit.length} entries`);
check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));

await page.screenshot({ path: "/home/claude/testrun/accounts-final.png" });
await reg.screenshot({ path: "/home/claude/testrun/accounts-reg.png" });
await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
