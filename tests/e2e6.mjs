// Signing divisions, "send to" routing, and the Waiting-for-you panel
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

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
const settle = async (p = page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(300); };

async function login(email) {
  await ctx.clearCookies();
  await page.goto(BASE); await settle();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const write = (key, payload) => post(`/api/collections/${key}`, payload);
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
const reqByTitle = async t => (await read("requisitions")).find(r => r.title === t);
const openModule = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const splashText = async () => {
  try { await page.locator("[role=status]").waitFor({ timeout: 5000 }); } catch { return ""; }
  return page.locator("[role=status]").innerText();
};

// ---- Accounts
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [
  ["Pat Special", "pat@sgfd.org", "Special Services", "approver1"],
  ["Tess Tech", "tess@sgfd.org", "Technology", "approver1"],
  ["Mo Medic", "mo@sgfd.org", "Medical", "approver1"],
  ["Todd Campbell", "todd@sgfd.org", "Technology", "approver2"],
  ["Sam Special", "sam@sgfd.org", "Special Services", "approver2", ["Technology"]],
  ["Chief Jones", "chief@sgfd.org", "Administration", "fire_chief"],
  ["Alex Accounting", "alex@sgfd.org", "Administration", "accounting"],
  ["Riley Requester", "riley@sgfd.org", "Technology", "user"],
];
for (const [n, e, d] of people) {
  await reg.evaluate(async b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }),
    { name: n, email: e, division: d, password: PW });
}
await login("mike@sgfd.org");
// Pat is approved through the screen, with "Also signs for: Technology"
await openModule("User Management");
await page.getByLabel("Role for Pat Special").selectOption("approver1");
const patRow = page.locator("div", { has: page.getByLabel("Role for Pat Special") }).last();
check("approval shows 'Also signs for' for approver roles", await page.getByText("Also signs for").count() > 0);
await page.locator("label", { hasText: /^Technology$/ }).first().click();
await patRow.locator("..").getByRole("button", { name: "Approve" }).click(); await settle();
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) {
  const [, , d, role, also] = people.find(p => p[0] === a.name);
  await post("/api/auth/approve", { id: a.id, role, division: d, signDivisions: also || [] });
}
const roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;
check("Pat signs for Technology (set at approval)", JSON.stringify(roster.find(u => u.name === "Pat Special").signDivisions) === '["Technology"]');
check("Sam signs for Technology (via API approval)", JSON.stringify(roster.find(u => u.name === "Sam Special").signDivisions) === '["Technology"]');
check("others have no extra divisions", roster.find(u => u.name === "Mo Medic").signDivisions.length === 0);

// ---- Riley creates a Technology requisition and sends it to Pat
await login("riley@sgfd.org");
await openModule("Procurement / Requisitions");
await page.getByText("New requisition", { exact: true }).first().click(); await settle();
await page.getByPlaceholder("e.g. Annual records-management software renewal").fill("End User Tech Support Technician");
await page.getByPlaceholder("Vendor or company name").fill("Avexon");
await page.getByPlaceholder("0.00").first().fill("5720");
const sendSel = page.getByLabel("Send to for purchaser's signature");
const opts = await sendSel.locator("option").allInnerTexts();
check("send-to lists Technology's purchasers incl. Pat (Special Services)", opts.includes("Pat Special") && opts.includes("Tess Tech"), opts.join(", "));
check("send-to leaves out Medical's purchaser", !opts.includes("Mo Medic"));
await sendSel.selectOption({ label: "Pat Special" });
await page.getByRole("button", { name: "Submit requisition" }).click(); await settle();
let r = await reqByTitle("End User Tech Support Technician");
check("requisition saved as sent to Pat", r?.nextSignerId === id("Pat Special") && r?.nextSignerName === "Pat Special");
check("list shows 'Sent to Pat Special'", await page.getByText("Sent to Pat Special").count() > 0);

// Server refuses routing to someone who can't sign it
const bad = await write("requisitions", { upserts: [{ ...r, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Bad route", nextSignerId: id("Mo Medic"), auth1: null, auth2: null, chief: null, status: "pending_auth1", lineItems: [], attachments: [] }], deletes: [] });
check("can't send a Technology requisition to a Medical purchaser", bad.status === 403, String(bad.status));

// ---- Mo (Medical) can't see or sign it
await login("mo@sgfd.org");
check("Mo's main menu shows nothing waiting", (await page.getByText("You're all caught up.").waitFor({ timeout: 5000 }).then(() => true, () => false)));
const moSign = await write("requisitions", { upserts: [{ ...r, status: "pending_auth2", auth1: { name: "Mo Medic", decision: "approved", note: "" } }], deletes: [] });
check("Medical purchaser can't sign a Technology requisition", moSign.status === 403, String(moSign.status));
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
check("Medical purchaser doesn't see Technology requisitions", await page.getByText("End User Tech Support Technician").count() === 0);

// ---- Tess (Technology purchaser, not chosen) isn't nagged
await login("tess@sgfd.org");
check("Tess isn't prompted (it was sent to Pat)", (await page.getByText("You're all caught up.").waitFor({ timeout: 5000 }).then(() => true, () => false)));

// ---- Pat: prompted on sign-in, signs and sends to Todd
await login("pat@sgfd.org");
let txt = await splashText();
await page.screenshot({ path: "/home/claude/testrun/shot-waiting.png" });
check("Pat's main menu: 1 purchaser's signature, sent directly", /1 purchaser's signature to sign/.test(txt) && /1 was sent to you directly/.test(txt), txt.replace(/\n/g, " | "));
await page.getByRole("button", { name: "Review now" }).click(); await settle();
check("Review now opens Waiting for me with the requisition",
  await page.getByText(/Waiting for me \(1\)/).count() > 0 && await page.getByText("End User Tech Support Technician").count() > 0);
check("sidebar badge shows 1", await page.locator("[title='1 waiting for you']").count() === 1);
check("Pat sees 'Viewing' with All my divisions", (await page.getByLabel("Viewing division").locator("option").allInnerTexts()).includes("All my divisions"));
await page.getByText("End User Tech Support Technician").first().click(); await settle();
check("card says Sent to you", await page.getByText("Sent to you").count() > 0);
await page.screenshot({ path: "/home/claude/testrun/shot-sendto.png", fullPage: true });
const next = page.getByLabel("Send to next signer");
const nextOpts = await next.locator("option").allInnerTexts();
check("next-stage list: Technology pre-approvers incl. Sam", nextOpts.includes("Todd Campbell") && nextOpts.includes("Sam Special"), nextOpts.join(", "));
await next.selectOption({ label: "Todd Campbell" });
await page.getByRole("button", { name: "Purchaser's signature" }).click(); await settle();
r = await reqByTitle("End User Tech Support Technician");
check("signed by Pat and sent to Todd", r.status === "pending_auth2" && r.auth1?.name === "Pat Special" && r.nextSignerId === id("Todd Campbell"));

// ---- Todd is prompted; Sam steps in instead
await login("todd@sgfd.org");
txt = await splashText();
check("Todd's main menu: 1 pre-approval", /1 pre-approval to sign/.test(txt), txt.replace(/\n/g, " | "));
await login("sam@sgfd.org");
check("Sam isn't prompted (sent to Todd)", (await page.getByText("You're all caught up.").waitFor({ timeout: 5000 }).then(() => true, () => false)));
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await page.getByText("End User Tech Support Technician").first().click(); await settle();
check("Sam sees it was sent to Todd", await page.getByText("Sent to Todd Campbell").count() > 0);
await page.getByLabel("Send to next signer").selectOption({ label: "Chief Jones" });
await page.getByRole("button", { name: "Pre-approval" }).last().click(); await settle();
r = await reqByTitle("End User Tech Support Technician");
check("another eligible pre-approver can step in", r.status === "pending_chief" && r.auth2?.name === "Sam Special" && r.nextSignerId === id("Chief Jones"));

// ---- Reassigning
await login("tess@sgfd.org");
const tessRoute = await write("requisitions", { upserts: [{ ...r, nextSignerId: null }], deletes: [] });
check("someone uninvolved can't change who it's sent to", tessRoute.status === 403, String(tessRoute.status));
await login("riley@sgfd.org");
const badRoute = await write("requisitions", { upserts: [{ ...r, nextSignerId: id("Pat Special") }], deletes: [] });
check("can't send final approval to a purchaser", badRoute.status === 403, String(badRoute.status));
await openModule("Procurement / Requisitions");
await page.getByText("Requisitions", { exact: true }).first().click(); await settle();
await page.getByText("End User Tech Support Technician").first().click(); await settle();
await page.getByLabel("Sent to", { exact: true }).selectOption("");
await settle();
r = await reqByTitle("End User Tech Support Technician");
check("requester can clear who it's sent to", !r.nextSignerId);
await page.getByLabel("Sent to", { exact: true }).selectOption({ label: "Chief Jones" });
await settle();
r = await reqByTitle("End User Tech Support Technician");
check("requester can send it again", r.nextSignerId === id("Chief Jones"));

// ---- Chief signs; accounting sees it ready to pay
await login("chief@sgfd.org");
txt = await splashText();
check("Chief's main menu: 1 final approval", /1 final approval to sign/.test(txt), txt.replace(/\n/g, " | "));
await page.getByRole("button", { name: "Review now" }).click(); await settle();
await page.getByText("End User Tech Support Technician").first().click(); await settle();
await page.getByRole("button", { name: "Final approval" }).last().click(); await settle();
r = await reqByTitle("End User Tech Support Technician");
check("approved and no longer sent to anyone", r.status === "approved" && !r.nextSignerId);
await login("alex@sgfd.org");
txt = await splashText();
check("accounting is told it's ready to mark paid", /2 approved requisitions are ready to mark paid/.test(txt), txt.replace(/\n/g, " | "));

// ---- Master edits signing divisions from the roster
await login("mike@sgfd.org");
await openModule("User Management");
await page.getByRole("button", { name: "People & roles", exact: true }).click(); await settle();
await page.getByLabel("Edit Mo Medic").click(); await settle();
await page.locator("label", { hasText: /^Special Services$/ }).first().click();
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
const mo = (await read("roster")).find(u => u.name === "Mo Medic");
check("roster edit saves signing divisions", JSON.stringify(mo.signDivisions) === '["Special Services"]', JSON.stringify(mo.signDivisions));
check("roster line shows 'also signs for'", /signs for Special Services/i.test(await page.locator("body").innerText()));
const log = (await read("audit-log")) || [];
check("routing is in the audit log", log.some(e => e.action === "Sent for Pre-approval" && /Todd Campbell/.test(e.detail)) &&
  log.some(e => e.action === "Sent for Purchaser's signature"));

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
