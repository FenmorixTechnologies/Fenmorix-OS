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
 try { await p.getByText(label, { exact: true }).first().click({ timeout: 8000 }); } catch (e) { await p.screenshot({ path: "/home/claude/testrun/fail.png" }); throw e; } await settle(p); }
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


fs.writeFileSync("/tmp/cert.png", Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082", "hex"));
fs.writeFileSync("/tmp/contract.pdf", "%PDF-1.4\n% test contract\n");
// setup: master + a few approved people via API
await page.goto(BASE); await settle();
await api("/api/auth/first-run", { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ name: "Mike Admin", email: "mike@sgfd.org", password: PW }) });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
for (const [n, e, d] of [["Chief Jones","chief@sgfd.org","Administration"],["Riley Requester","riley@sgfd.org","Suppression"],["Tina Tech","tina@sgfd.org","Technology"]])
  await api("/api/auth/signup", { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ name: n, email: e, division: d, password: PW }) }, reg);
const accts = (await api("/api/auth/accounts")).body.accounts;
for (const a of accts.filter(a => a.status === "pending")) {
  const role = a.name === "Chief Jones" ? "fire_chief" : "user";
  await api("/api/auth/approve", { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify({ id: a.id, role, division: a.division }) });
}

// Contracts (master)
await login("mike@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("Contracts", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Records-management software agreement").fill("Motorola service agreement");
await page.locator("#contract-file-input").setInputFiles("/tmp/contract.pdf");
await page.getByRole("button", { name: "Upload contract" }).click(); await settle(); await page.waitForTimeout(400);
const contracts = await read("contracts");
check("contract uploaded, credited to master", contracts.length === 1 && contracts[0].file.name === "contract.pdf" && contracts[0].uploadedBy === "Mike Admin");

// Certifications add + remove (Riley adds own; Tina can't remove it)
await login("riley@sgfd.org");
await openModule("Certifications");
await page.getByRole("button", { name: "Add certification" }).first().click(); await settle();
await page.locator("select").first().selectOption({ label: "Riley Requester" });
await page.getByPlaceholder("e.g. EMT-Basic").fill("EMT-Basic");
await page.locator("input[type=date]").nth(0).fill("2025-01-15"); await page.locator("input[type=date]").nth(1).fill("2026-12-01");
await page.locator("#cert-file-input").setInputFiles("/tmp/cert.png");
await page.getByRole("button", { name: "Save certification" }).click(); await settle(); await page.waitForTimeout(400);
let certs = await read("certifications");
check("certification saved with file, added by Riley", certs.length === 1 && certs[0].file?.name === "cert.png" && certs[0].addedBy === "Riley Requester");
await login("tina@sgfd.org", PW);
const tinaDel = await write("certifications", { upserts: [], deletes: [certs[0].id] });
check("someone else can't delete Riley's certification", tinaDel.status === 403);
await login("riley@sgfd.org");
await openModule("Certifications");
const certFile = certs[0].file.id;
await page.locator("[data-icon=X]").first().click(); await settle(); await page.waitForTimeout(500);
certs = await read("certifications");
check("Riley removes it; file cleaned up", certs.length === 0 && !fs.existsSync(`/home/claude/testrun/app/uploads/${certFile}`));

// PPE
await page.getByText("Main menu").first().click(); await settle();
await openModule("PPE & Gear");
await page.getByRole("button", { name: "Add gear item" }).first().click(); await settle();
await page.locator("select").first().selectOption({ label: "Riley Requester" });
await page.getByPlaceholder("e.g. Structural turnout coat").fill("Structural turnout coat");
await page.locator("input[type=date]").nth(0).fill("2026-01-10");
await page.locator("#gearNeverExpires").check();
await page.getByRole("button", { name: "Save gear item" }).click(); await settle();
check("gear item saved", (await read("gear")).length === 1);

// Help desk: Riley opens, Tina (Technology) comments and closes
await page.getByText("Main menu").first().click(); await settle();
await openModule("Help Desk");
await page.getByRole("button", { name: "New ticket" }).first().click(); await settle();
await page.getByPlaceholder("Short summary of the issue").fill("Station printer jammed");
await page.getByPlaceholder("What's happening, what you've tried, error messages…").fill("Paper jam on tray 2");
await page.getByRole("button", { name: "Submit ticket" }).click(); await settle();
await login("tina@sgfd.org");
await openModule("Help Desk");
await page.getByText("Station printer jammed").first().click(); await settle();
await page.getByPlaceholder("Add a comment…").fill("Cleared the jam");
await page.getByRole("button", { name: "Post comment" }).click(); await settle();
await page.getByLabel("New status").selectOption("closed");
await page.getByRole("button", { name: "Post status update" }).click(); await settle(); await page.waitForTimeout(400);
const t = (await read("tickets"))[0];
check("ticket opened by Riley, closed by Tina with comment", t.requesterName === "Riley Requester" && t.status === "closed" && t.comments[0]?.author === "Tina Tech");

// Meetings
await login("riley@sgfd.org");
await openModule("Meetings");
await page.getByRole("button", { name: "New meeting request" }).click(); await settle();
await page.getByPlaceholder("What's this meeting about").fill("Radio rollout plan");
await page.getByText("Chief Jones", { exact: true }).click();
await page.locator("input[type=date]").fill("2026-11-05"); await page.locator("input[type=time]").fill("14:30");
await page.getByRole("button", { name: "Send meeting request" }).click(); await settle();
await login("chief@sgfd.org");
await openModule("Meetings");
await page.getByText("Radio rollout plan").first().click(); await settle();
await page.getByRole("button", { name: "Accept" }).click(); await settle();
const m = (await read("meetings"))[0];
check("meeting requested by Riley, accepted by Chief", m.organizerName === "Riley Requester" && m.time === "14:30" && m.responses[0].status === "accepted");

// Announcements by chief
await page.getByText("Main menu").first().click(); await settle();
await openModule("Announcements");
await page.getByRole("button", { name: "Post announcement" }).first().click(); await settle();
await page.locator("label:has-text('Title') + input").fill("New radios arriving");
await page.locator("label:has-text('Message') + textarea").fill("Training next week.");
await page.getByRole("button", { name: "Post announcement" }).last().click(); await settle();
check("chief posts announcement", (await read("announcements"))[0]?.author === "Chief Jones");

// Reimbursement mileage rate: only master can change
const rate = await write("mileage-rate", { value: 0.9 });
check("non-master can't change mileage rate", rate.status === 403);

check("no save-error banners", await page.locator("#sgfd-save-error").count() === 0);
check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" || "));
await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
