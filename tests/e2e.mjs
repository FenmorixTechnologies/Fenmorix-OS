import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

fs.writeFileSync("/tmp/invoice.pdf", "%PDF-1.4\n% test invoice\n");
fs.writeFileSync("/tmp/cert.png", Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082", "hex"));
fs.writeFileSync("/tmp/contract.pdf", "%PDF-1.4\n% test contract\n");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("dialog", d => d.accept());

const wait = ms => page.waitForTimeout(ms);
async function settle() { await page.waitForLoadState("networkidle"); await wait(250); }
async function mainMenu() { await page.getByText("Main menu").first().click(); await settle(); }
async function openModule(label) { await page.getByText(label, { exact: true }).first().click(); await settle(); }
async function switchUser() {
  const sw = page.getByText("Switch user");
  if (await sw.count()) { await sw.first().click(); await settle(); }
}
async function signIn(name) {
  await switchUser();
  await page.getByRole("button", { name: new RegExp("^" + name) }).first().click();
  await settle();
}
async function banner() {
  const b = page.locator("#sgfd-save-error");
  return (await b.count()) ? await b.innerText() : null;
}

async function openReq(title) {
  if (await page.getByText(/^Requested by .+ on /).count() === 0) {
    await page.getByText(title).first().click(); await settle();
  }
}

// ---------- Procurement: first-time setup ----------
await page.goto(BASE); await settle();
await openModule("Procurement / Requisitions");
await page.getByPlaceholder("Full name").fill("Mike Admin");
await page.getByRole("button", { name: "Create master account" }).click(); await settle();
check("first-time setup creates master and signs in", await page.getByText("Mike Admin").count() > 0);

// ---------- Admin: roster ----------
await page.getByText("Admin", { exact: true }).click(); await settle();
const people = [
  ["Pat Purchaser", "Suppression", "approver1"], ["Quinn Preapprover", "Suppression", "approver2"],
  ["Chief Jones", "Administration", "fire_chief"], ["Alex Accounting", "Administration", "accounting"],
  ["Riley Requester", "Suppression", "user"], ["Tina Tech", "Technology", "user"],
];
for (const [name, div, role] of people) {
  const nameBox = page.getByPlaceholder("Name", { exact: true });
  await nameBox.fill(name);
  const row = nameBox.locator("xpath=..");
  const selects = row.locator("select");
  await selects.nth(0).selectOption(div);
  await selects.nth(1).selectOption(role);
  await row.getByRole("button", { name: "Add" }).click(); await settle();
}
const roster = await (await fetch(BASE + "/api/collections/roster")).json();
check("6 people added to roster (7 total)", roster.value.length === 7, `got ${roster.value.length}`);

// add a category
const catInput = page.getByPlaceholder("New category");
await catInput.fill("Radios"); await catInput.press("Enter"); await settle();
const cats = await (await fetch(BASE + "/api/collections/categories")).json();
check("new category saved", cats.value.includes("Radios"));

// ---------- Requisition: create as requester ----------
await signIn("Riley Requester");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("Portable radios for Engine 31");
await page.getByPlaceholder("Vendor or company name").fill("Motorola Solutions");
await page.locator("label:has-text('Phone') + input").first().fill("800-555-0100");
await page.getByPlaceholder("Why this purchase is needed").fill("Replace failing radios");
await page.locator("#itemize").check();
const descs = page.getByPlaceholder("What this covers");
await descs.nth(0).fill("APX radios x4");
await page.locator("input[placeholder='0.00']").nth(0).fill("4800");
await page.getByRole("button", { name: "Add line item" }).click();
await descs.nth(1).fill("Annual service plan");
await page.locator("input[placeholder='0.00']").nth(1).fill("50");
const freqSelects = descs.nth(1).locator("xpath=..").locator("select");
await freqSelects.selectOption("monthly");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
let reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
check("requisition submitted", reqs.length === 1 && reqs[0].lineItems.length === 2, JSON.stringify(reqs.map(r => [r.title, r.status, r.lineItems.length])));
const reqId = reqs[0]?.id;
const vendors = (await (await fetch(BASE + "/api/collections/vendors")).json()).value;
check("new vendor saved with phone", vendors.length === 1 && vendors[0].phone === "800-555-0100");

// attach invoice while pending
await page.getByText("Portable radios for Engine 31").first().click(); await settle();
await page.locator(`#invoice-upload-${reqId}`).setInputFiles("/tmp/invoice.pdf"); await settle(); await wait(500);
reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
check("invoice attached with real filename", reqs[0].attachments.length === 1 && reqs[0].attachments[0].name === "invoice.pdf",
  JSON.stringify(reqs[0].attachments));

// ---------- Signature chain ----------
for (const [who, label, expect] of [
  ["Pat Purchaser", "Purchaser's signature", "pending_auth2"],
  ["Quinn Preapprover", "Pre-approval", "pending_chief"],
  ["Chief Jones", "Final approval", "approved"],
]) {
  await signIn(who);
  await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
  await openReq("Portable radios for Engine 31");
  await page.getByRole("button", { name: label }).click(); await settle();
  reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
  check(`${label} by ${who} -> ${expect}`, reqs[0].status === expect, reqs[0].status);
}
await signIn("Alex Accounting");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await openReq("Portable radios for Engine 31");
await page.getByRole("button", { name: "Mark as paid" }).click(); await settle();
reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
check("accounting marks paid", reqs[0].status === "paid" && !!reqs[0].paidDate);
check("signatures recorded with names", reqs[0].auth1?.name === "Pat Purchaser" && reqs[0].chief?.name === "Chief Jones");
check("finalized record shows lock in UI", await page.getByText("Finalized — no further changes").count() > 0);

// server-side lock: a direct attempt to edit a paid record is refused
const tamper = await fetch(BASE + "/api/collections/requisitions", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ upserts: [{ ...reqs[0], title: "Changed after payment" }], deletes: [] }),
});
check("database refuses edit to paid requisition", tamper.status === 409, `${tamper.status} ${(await tamper.json()).error}`);

// ---------- Contracts ----------
await signIn("Mike Admin");
await page.getByText("Contracts", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Records-management software agreement").fill("Motorola service agreement");
await page.locator("#contract-file-input").setInputFiles("/tmp/contract.pdf");
await page.getByRole("button", { name: "Upload contract" }).click(); await settle(); await wait(400);
const contracts = (await (await fetch(BASE + "/api/collections/contracts")).json()).value;
check("contract uploaded", contracts.length === 1 && contracts[0].file.name === "contract.pdf");

// ---------- Division rename on a division used by a paid record ----------
await page.getByText("Admin", { exact: true }).click(); await settle();
const supRow = page.locator("span", { hasText: /^Suppression$/ }).first().locator("xpath=..");
await supRow.locator("[data-icon=Pencil]").click();
const editBox = page.locator("input:focus");
await editBox.fill("Fire Suppression"); await editBox.press("Enter"); await settle(); await wait(500);
reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
const ros2 = (await (await fetch(BASE + "/api/collections/roster")).json()).value;
check("division rename carries to paid requisition and people",
  reqs[0].division === "Fire Suppression" && ros2.filter(u => u.division === "Fire Suppression").length === 3,
  `${reqs[0].division}; banner=${await banner()}`);

// ---------- Reimbursements ----------
await mainMenu();
await openModule("Reimbursements");
await signIn("Riley Requester");
await page.getByRole("button", { name: "New request" }).first().click(); await settle();
await page.getByPlaceholder("e.g. Regional training conference, Baton Rouge").fill("State fire school, Baton Rouge");
const firstRow = page.locator("table tbody tr").first();
await firstRow.locator("input[type=date]").fill("2026-10-20");
await firstRow.getByPlaceholder("What / where").fill("Hotel + drive");
const nums = firstRow.locator("input[type=number]");
await nums.nth(0).fill("120"); await nums.nth(1).fill("100"); await nums.nth(2).fill("40");
await page.getByPlaceholder("0.00").last().fill("20");
await page.getByRole("button", { name: "Submit", exact: true }).click(); await settle();
let reimb = (await (await fetch(BASE + "/api/collections/reimbursements")).json()).value;
check("travel reimbursement submitted", reimb.length === 1 && reimb[0].lineItems[0].lodging === 120 && reimb[0].advances === 20);

await signIn("Pat Purchaser");
await page.getByText("State fire school, Baton Rouge").first().click(); await settle();
await page.getByRole("button", { name: "Approve" }).click(); await settle();
await signIn("Alex Accounting");
if (await page.getByRole("button", { name: "Mark as paid" }).count() === 0) { await page.getByText("State fire school, Baton Rouge").first().click(); await settle(); }
await page.getByRole("button", { name: "Mark as paid" }).click(); await settle();
reimb = (await (await fetch(BASE + "/api/collections/reimbursements")).json()).value;
check("reimbursement approved by Pat, paid by Alex", reimb[0].status === "paid" && reimb[0].approval?.name === "Pat Purchaser");

// ---------- Certifications (with file, then remove -> file cleaned up) ----------
await mainMenu();
await openModule("Certifications");
await page.getByRole("button", { name: "Add certification" }).first().click(); await settle();
await page.locator("select").first().selectOption({ label: "Riley Requester" });
await page.getByPlaceholder("e.g. EMT-Basic").fill("EMT-Basic");
const dates = page.locator("input[type=date]");
await dates.nth(0).fill("2025-01-15"); await dates.nth(1).fill("2026-12-01");
await page.locator("#cert-file-input").setInputFiles("/tmp/cert.png");
await page.getByRole("button", { name: "Save certification" }).click(); await settle(); await wait(400);
let certs = (await (await fetch(BASE + "/api/collections/certifications")).json()).value;
check("certification saved with file", certs.length === 1 && certs[0].file?.name === "cert.png" && certs[0].expirationDate === "2026-12-01");
const certFileId = certs[0]?.file?.id;
check("cert file stored on disk", fs.existsSync(`/home/claude/testrun/app/uploads/${certFileId}`));
await page.locator("[data-icon=X]").first().click(); await settle(); await wait(500);
certs = (await (await fetch(BASE + "/api/collections/certifications")).json()).value;
check("certification removed and its file cleaned up", certs.length === 0 && !fs.existsSync(`/home/claude/testrun/app/uploads/${certFileId}`));

// ---------- PPE ----------
await mainMenu();
await openModule("PPE & Gear");
await page.getByRole("button", { name: "Add gear item" }).first().click(); await settle();
await page.locator("select").first().selectOption({ label: "Riley Requester" });
await page.getByPlaceholder("e.g. Structural turnout coat").fill("Structural turnout coat");
await page.locator("input[type=date]").nth(0).fill("2026-01-10");
await page.locator("#gearNeverExpires").check();
await page.getByRole("button", { name: "Save gear item" }).click(); await settle();
const gear = (await (await fetch(BASE + "/api/collections/gear")).json()).value;
check("gear item saved", gear.length === 1 && gear[0].itemName === "Structural turnout coat");

// ---------- Help desk ----------
await mainMenu();
await openModule("Help Desk");
await signIn("Riley Requester");
await page.getByRole("button", { name: "New ticket" }).first().click(); await settle();
await page.getByPlaceholder("Short summary of the issue").fill("Station printer jammed");
await page.getByPlaceholder("What's happening, what you've tried, error messages…").fill("Paper jam on tray 2");
await page.getByRole("button", { name: "Submit ticket" }).click(); await settle();
await signIn("Tina Tech");
await page.getByText("Station printer jammed").first().click(); await settle();
await page.getByPlaceholder("Add a comment…").fill("Cleared the jam");
await page.getByRole("button", { name: "Post comment" }).click(); await settle();
await page.locator("select").filter({ has: page.locator("option[value=closed]") }).nth(1).selectOption("closed"); await settle(); await wait(400);
const tickets = (await (await fetch(BASE + "/api/collections/tickets")).json()).value;
check("ticket opened, commented, closed", tickets.length === 1 && tickets[0].comments.length === 1 && tickets[0].status === "closed" && !!tickets[0].closedAt,
  JSON.stringify(tickets.map(t => [t.status, t.comments.length])));

// ---------- Meetings ----------
await mainMenu();
await openModule("Meetings");
await signIn("Riley Requester");
await page.getByRole("button", { name: "New meeting request" }).click(); await settle();
await page.getByPlaceholder("What's this meeting about").fill("Radio rollout plan");
await page.getByText("Chief Jones", { exact: true }).click();
await page.locator("input[type=date]").fill("2026-11-05");
await page.locator("input[type=time]").fill("14:30");
await page.getByRole("button", { name: "Send meeting request" }).click(); await settle();
await signIn("Chief Jones");
await page.getByText("Radio rollout plan").first().click(); await settle();
await page.getByRole("button", { name: "Accept" }).click(); await settle();
const meetings = (await (await fetch(BASE + "/api/collections/meetings")).json()).value;
check("meeting requested and accepted; local time kept", meetings.length === 1 && meetings[0].time === "14:30" && meetings[0].date === "2026-11-05" && meetings[0].responses[0].status === "accepted",
  JSON.stringify(meetings.map(m => [m.date, m.time, m.responses.map(r => r.status)])));

// ---------- Announcements ----------
await mainMenu();
await openModule("Announcements");
await page.getByRole("button", { name: "Post announcement" }).first().click(); await settle();
const annFields = page.locator("input").filter({ hasNot: page.locator("[type=checkbox]") });
await page.locator("label:has-text('Title') + input").fill("New radios arriving");
await page.locator("label:has-text('Message') + textarea").fill("Training next week.");
await page.locator("#pin-announcement").check();
await page.getByRole("button", { name: "Post announcement" }).last().click(); await settle();
const anns = (await (await fetch(BASE + "/api/collections/announcements")).json()).value;
check("announcement posted by chief", anns.length === 1 && anns[0].author === "Chief Jones" && anns[0].pinned);
await mainMenu();
check("ticker shows pinned announcement on main menu", await page.getByText("New radios arriving").count() > 0);

// ---------- Directory ----------
await openModule("Directory");
await signIn("Riley Requester");
await page.getByText("(you)").locator("xpath=../../..").locator("[data-icon=Pencil]").click(); await settle();
await page.locator("label:has-text('Phone') + input").first().fill("225-555-0199");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
const ros3 = (await (await fetch(BASE + "/api/collections/roster")).json()).value;
check("directory contact info saved", ros3.find(u => u.name === "Riley Requester")?.phone === "225-555-0199");

// ---------- Persistence after reload + audit log ----------
await page.reload(); await settle();
await openModule("Procurement / Requisitions");
await signIn("Mike Admin");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
check("data survives a full reload", await page.getByText("Portable radios for Engine 31").count() > 0);
await page.getByText("Audit Log", { exact: true }).click(); await settle();
const audit = (await (await fetch(BASE + "/api/collections/audit-log")).json()).value;
check("audit log captured activity across modules", audit.length > 20 && new Set(audit.map(a => a.module)).size >= 6,
  `${audit.length} entries; modules: ${[...new Set(audit.map(a => a.module))].join(", ")}`);
check("audit log page lists entries", await page.getByText("Signed in").count() > 3);

// ---------- Two people working at once ----------
const page2 = await (await browser.newContext()).newPage();
await page2.goto(BASE); await page2.waitForLoadState("networkidle");
await page2.getByText("Procurement / Requisitions", { exact: true }).click(); await page2.waitForLoadState("networkidle");
await page2.getByRole("button", { name: /^Riley Requester/ }).click(); await page2.waitForLoadState("networkidle");
await page2.getByText("Switch user").waitFor();
await page2.screenshot({ path: "/home/claude/testrun/page2-signed-in.png" });
// page (Mike) has an older copy loaded; Riley adds a new requisition in the other browser
try {
  await page2.getByText("New requisition", { exact: true }).first().click({ timeout: 8000 });
  await page2.getByPlaceholder("e.g. Annual records-management software renewal").waitFor({ timeout: 8000 });
} catch (e) { await page2.screenshot({ path: "/home/claude/testrun/page2-fail.png" }); throw e; }
await page2.getByPlaceholder("e.g. Annual records-management software renewal").fill("Hose replacement");
await page2.getByPlaceholder("Vendor or company name").fill("Motorola Solutions");
await page2.getByPlaceholder("0.00").first().fill("900");
await page2.getByRole("button", { name: "Submit requisition" }).click(); await page2.waitForLoadState("networkidle"); await page2.waitForTimeout(400);
// Mike, with the stale list, adds a new requisition too
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("Office chairs");
await page.getByPlaceholder("Vendor or company name").fill("Office Depot");
await page.getByPlaceholder("0.00").first().fill("300");
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle(); await wait(400);
reqs = (await (await fetch(BASE + "/api/collections/requisitions")).json()).value;
check("simultaneous users don't overwrite each other", reqs.length === 3, reqs.map(r => r.title).join(" | "));

check("no save-error banners during normal use", (await banner()) === null, await banner() || "");
check("no browser errors", errors.length === 0, errors.slice(0, 5).join(" || "));

await page.screenshot({ path: "/home/claude/testrun/final.png" });
await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
