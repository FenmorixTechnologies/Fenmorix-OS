// "Your Day" panel on the main menu
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import crypto from "node:crypto";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const write = (key, upserts) => post(`/api/collections/${key}`, { upserts, deletes: [] });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const uid = () => crypto.randomUUID();

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }),
  { name: "Riley Requester", email: "riley@sgfd.org", division: "Technology", password: PW });
await login("mike@sgfd.org");
const pend = (await api("/api/auth/accounts")).body.accounts.find(a => a.status === "pending");
await post("/api/auth/approve", { id: pend.id, role: "user", division: "Technology" });
const roster = await read("roster");
const mike = roster.find(u => u.name === "Mike Admin"), riley = roster.find(u => u.name === "Riley Requester");

const first = await page.locator("[role=status]").innerText();
check("before anything is assigned, only the seeded approved req is listed", /1 approved requisition is ready to mark paid\.\s*Ready to pay$/i.test(first.trim()) && !/ticket|meeting|reimbursement/i.test(first), first.replace(/\n/g, " | "));

// Mike's own data
await write("time-entries", [{ id: uid(), date: today, start: "07:00", end: "17:00", kind: "regular", note: "" }]);
await write("callouts", [{ id: uid(), division: "Technology", startDate: today, endDate: today, position: 1, userId: mike.id, personName: "Mike Admin", phone: "314-555-0199", notes: "" }]);
const myReq = { id: uid(), division: "Administration", category: "Equipment", title: "Laptop dock", vendor: "Dell", vendorId: null, description: "", contractual: false,
  frequency: "one_time", amount: 189.99, lineItems: [], invoiceNumber: "", paymentMethod: "Check", cardLast4: "", cardholderName: "", requestedBy: "Mike Admin",
  createdAt: `${today}T12:00:00`, status: "pending_auth1", auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [] };
await write("requisitions", [myReq]);

// Riley: a ticket assigned to Mike, a meeting request to Mike, a reimbursement to approve
await login("riley@sgfd.org");
await write("tickets", [{ id: uid(), subject: "Printer offline in Station 1", category: "Printer", priority: "High", division: "Technology", location: "", description: "",
  requesterId: riley.id, requesterName: riley.name, assigneeId: null, status: "open", dueDate: "", comments: [], attachments: [] }]);
await write("meetings", [
  { id: uid(), subject: "Radio budget review", date: today, time: "14:00", duration: 30, location: "Admin", agenda: "", cancelled: false,
    responses: [{ inviteeId: mike.id, inviteeName: mike.name, status: "pending" }] },
]);
await write("reimbursements", [{ id: uid(), type: "travel", division: "Technology", reason: "Conference mileage", lineItems: [], status: "pending_approval", attachments: [], advances: 0 }]);

await login("mike@sgfd.org");
// assign the ticket to Mike (techs/master can)
const t = (await read("tickets"))[0];
await write("tickets", [{ ...t, assigneeId: mike.id, dueDate: "2020-01-01" }]);
await page.reload(); await settle();

const status = await page.locator("[role=status]").innerText();
check("help desk ticket listed (past due)", /1 help desk ticket is assigned to you\.\s*1 past due/.test(status), status.replace(/\n/g, " | "));
check("meeting request listed", /1 meeting request is waiting for your answer/.test(status));
check("reimbursement to approve listed", /1 reimbursement is waiting for approval/.test(status));
check("requisition sent to nobody isn't counted for a master", !/to sign/.test(status));
const body = await page.locator("section[aria-label='Your day']").innerText();
check("shows today's shifts", /[ABC] shift\s*Fire\s*[ABCD]\s*Comms days\s*[ABCD]\s*Comms nights/.test(body));
check("time card: 10 worked, 70 left", /10\s*of 80 hrs\s*Left to 80\s*70 h/.test(body), body.slice(0, 300).replace(/\n/g, " | "));
check("meetings today shows the 14:00 meeting", /14:00\s*Radio budget review/.test(body));
check("on call today with phone", /Technology\s*Mike Admin\s*314-555-0199/i.test(body));
check("your tickets card", /Printer offline in Station 1\s*High · Open · past due/.test(body));
check("your requisitions with amount and status", /Laptop dock\s*\$189\.99\s*Awaiting purchaser.s signature/.test(body), "");
check("tile badges: help desk 1, meetings 1, reimbursements 1",
  await page.getByRole("navigation").getByRole("button", { name: /^Help Desk/ }).locator("[title='1 waiting for you']").count() === 1 &&
  await page.getByRole("navigation").getByRole("button", { name: /^Meetings/ }).locator("[title='1 waiting for you']").count() === 1 &&
  await page.getByRole("navigation").getByRole("button", { name: /^Reimbursements/ }).locator("[title='1 waiting for you']").count() === 1);
await page.screenshot({ path: "/home/claude/testrun/shot-yourday.png", fullPage: true });

// Buttons open the right place, filtered
await page.getByRole("button", { name: "Open tickets" }).click(); await settle();
check("Open tickets shows Help Desk filtered to me", (await page.getByLabel("Filter by Assigned to").inputValue()) === "Mike Admin" &&
  await page.getByText("Printer offline in Station 1").count() >= 1);
await page.getByText("Main menu", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "Review", exact: true }).click(); await settle();
check("Review opens reimbursements awaiting approval", (await page.getByLabel("Filter by Status").inputValue()) === "pending_approval");
await page.getByText("Main menu", { exact: true }).first().click(); await settle();
await page.getByRole("button", { name: "Help Desk", exact: false }).first();
await page.getByText("Help Desk", { exact: true }).first().click(); await settle();
check("opening the tile normally isn't filtered", (await page.getByLabel("Filter by Assigned to").inputValue()) === "");
await page.getByText("Main menu", { exact: true }).first().click(); await settle();

// Hide keeps the action list, hides the cards, and is remembered
await page.getByRole("button", { name: "Hide" }).click(); await settle();
check("hide keeps action items, hides cards", await page.locator("[role=status]").count() === 1 && await page.getByText("Meetings today").count() === 0);
await page.reload(); await settle();
check("hidden stays hidden after reload", await page.getByText("Meetings today").count() === 0 && await page.getByRole("button", { name: "Show" }).count() === 1);
await page.getByRole("button", { name: "Show" }).click(); await settle();

// Riley's day: her requisition-free view and nothing assigned
await login("riley@sgfd.org");
const rb = await page.locator("section[aria-label='Your day']").innerText();
check("Riley's day: nothing needs attention, no tickets", /You're all caught up/.test(rb) && /Nothing assigned to you/.test(rb));
check("Riley sees who's on call", /Technology\s*Mike Admin/i.test(rb));

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
