// Paging, search, sort and filters on lists
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import crypto from "node:crypto";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const write = (key, payload) => post(`/api/collections/${key}`, payload);
const summary = () => page.getByText(/^Showing \d+–\d+ of \d+|^No /).first().innerText();
const titles = async sel => page.locator(sel).allInnerTexts();

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await page.goto(BASE); await settle();
if (await page.getByLabel("Email").count()) {
  await page.getByLabel("Email").fill("mike@sgfd.org");
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}

// Seed 60 requisitions with 60 vendors, and 30 tickets
const me = (await api("/api/auth/me")).body.user;
const reqs = [];
for (let i = 1; i <= 60; i++) {
  const n = String(i).padStart(2, "0");
  reqs.push({
    id: crypto.randomUUID(), division: i % 2 ? "Technology" : "Medical", category: "Equipment",
    title: `Bulk item ${n}`, vendor: `Vendor ${n}`, vendorId: null, description: "", contractual: false, frequency: "one_time",
    amount: i * 10, lineItems: [], invoiceNumber: `INV-${n}`, paymentMethod: "Check", cardLast4: "", cardholderName: "",
    requestedBy: me.name, createdAt: `2026-${String((i % 9) + 1).padStart(2, "0")}-15T12:00:00`, status: "pending_auth1",
    auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [],
  });
}
const vendors = reqs.map(r => ({ id: crypto.randomUUID(), name: r.vendor, createdAt: new Date().toISOString() }));
check("seed vendors", (await write("vendors", { upserts: vendors, deletes: [] })).status === 200);
reqs.forEach((r, i) => { r.vendorId = vendors[i].id; });
const seeded = await write("requisitions", { upserts: reqs, deletes: [] });
check("seed requisitions", seeded.status === 200, JSON.stringify(seeded.body).slice(0, 200));
const tickets = Array.from({ length: 30 }, (_, i) => ({
  id: crypto.randomUUID(), subject: `Ticket ${String(i + 1).padStart(2, "0")}`, category: "Hardware",
  priority: ["Low", "Medium", "High", "Urgent"][i % 4], division: "Technology", location: "", description: "printer jam",
  requesterId: me.id, requesterName: me.name, assigneeId: null, status: "open", dueDate: "", comments: [], attachments: [],
  createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
}));
check("seed tickets", (await write("tickets", { upserts: tickets, deletes: [] })).status === 200);

// ---- Requisitions
await page.goto(BASE); await settle();
await page.getByText("Procurement / Requisitions", { exact: true }).click(); await settle();
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
let s = await summary();
check("requisitions default to 25 per page", /^Showing 1–25 of 6\d requisitions/.test(s), s);
check("page buttons shown", await page.getByRole("button", { name: "Page 3" }).count() === 1 && await page.getByText("Page 1 of 3").count() === 1);
await page.getByRole("button", { name: "Next page" }).click(); await settle();
s = await summary();
check("next page shows 26–50", /^Showing 26–50 of/.test(s), s);
await page.getByLabel("Rows per page").first().selectOption("50"); await settle();
s = await summary();
check("50 per page, back to page 1", /^Showing 1–50 of/.test(s) && await page.getByText("Page 1 of 2").count() === 1, s);
await page.getByLabel("Search").fill("bulk item 07"); await settle();
s = await summary();
check("search narrows to one", /^Showing 1–1 of 1 requisitions/.test(s) && await page.getByText("Bulk item 07").count() === 1, s);
await page.getByLabel("Search").fill("INV-1"); await settle();
check("search matches invoice numbers", /of 10 requisitions/.test(await summary()), await summary());
await page.getByText("Clear search and filters").click(); await settle();
await page.getByLabel("Filter by Division").selectOption("Medical"); await settle();
check("division filter", /of 30 requisitions/.test(await summary()), await summary());
await page.getByLabel("Sort by").first().selectOption("amount"); await settle();
let first = (await page.locator("div[style*='font-weight: 700'][style*='font-size: 14.5px']").first().innerText());
check("sort by amount, highest first", first === "Bulk item 60", first);
await page.getByRole("button", { name: /Sorted descending/ }).click(); await settle();
first = (await page.locator("div[style*='font-weight: 700'][style*='font-size: 14.5px']").first().innerText());
check("toggle to lowest first", first === "Bulk item 02", first);
await page.getByLabel("Filter by Year").selectOption("2026"); await settle();
check("year filter keeps 2026", /of 30 requisitions/.test(await summary()));
await page.getByText("Awaiting final approval", { exact: true }).click(); await settle();
check("status chips still filter", /^No requisitions/.test(await summary()), await summary());

// rows per page is remembered
await page.reload(); await settle();
await page.getByText("Procurement / Requisitions", { exact: true }).click(); await settle();
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
check("rows per page remembered after reload", (await page.getByLabel("Rows per page").first().inputValue()) === "50");
await page.getByLabel("Rows per page").first().selectOption("25"); await settle();

// ---- Vendors
await page.getByText("Vendors", { exact: true }).first().click(); await settle();
s = await summary();
check("vendors paged", /^Showing 1–25 of 6\d vendors/.test(s), s);
await page.getByLabel("Sort by").selectOption("total"); await settle();
first = await page.getByText(/^Vendor \d\d$/).first().innerText();
check("vendors sort by total spent", first === "Vendor 60", first);
await page.getByLabel("Search").fill("vendor 33"); await settle();
await page.getByText("Vendor 33", { exact: true }).click(); await settle();
check("vendor history has its own controls", /^Showing 1–1 of 1 requisitions/.test(await summary()), await summary());

// ---- Quotes and contracts have controls
for (const tab of ["Quotes", "Contracts"]) {
  await page.getByText(tab, { exact: true }).first().click(); await settle();
  check(`${tab} has rows-per-page and sort`, await page.getByLabel("Rows per page").count() === 1 && await page.getByLabel("Sort by").count() === 1);
}
// Admin roster and audit log
await page.getByText("Admin", { exact: true }).first().click(); await settle();
check("Admin links to User Management for people", await page.getByRole("button", { name: "Open User Management" }).count() === 1);
await page.getByText("Audit Log", { exact: true }).first().click(); await settle();
s = await summary();
check("audit log paged", /^Showing 1–\d+ of \d+ entries/.test(s), s);
check("audit log filter by person", await page.getByLabel("Filter by Person").count() === 1);

// ---- Help desk
await page.getByText("Main menu", { exact: true }).first().click(); await settle();
await page.getByText("Help Desk", { exact: true }).click(); await settle();
s = await summary();
check("help desk paged", /^Showing 1–25 of 30 tickets/.test(s), s);
await page.getByLabel("Filter by Priority").selectOption("Urgent"); await settle();
check("help desk priority filter", /of 7 tickets/.test(await summary()), await summary());
await page.getByLabel("Filter by Status").selectOption("closed"); await settle();
check("status select still works", /^No tickets/.test(await summary()), await summary());

// ---- Other modules show the controls
for (const mod of ["Reimbursements", "Certifications", "PPE & Gear", "Meetings", "Announcements"]) {
  await page.getByText("Main menu", { exact: true }).first().click(); await settle();
  if (mod === "Certifications") {
    await page.getByText("Personnel File", { exact: true }).first().click(); await settle();
    await page.getByRole("button", { name: /^Certifications/ }).click(); await settle();
    await page.getByRole("button", { name: "Open Certifications" }).click(); await settle();
  } else { await page.getByText(mod, { exact: true }).first().click(); await settle(); }
  check(`${mod} has search, sort and rows per page`,
    await page.getByLabel("Search").count() === 1 && await page.getByLabel("Sort by").count() === 1 && await page.getByLabel("Rows per page").count() === 1);
}

await page.getByText("Main menu", { exact: true }).first().click(); await settle();
await page.getByText("Help Desk", { exact: true }).click(); await settle();
await page.screenshot({ path: "/home/claude/testrun/shot-paging.png" });

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
