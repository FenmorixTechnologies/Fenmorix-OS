// Visual tour of Procurement, Reimbursements, Help Desk with sample data (fictional people)
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message)); page.on("dialog", d => d.accept());
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => { const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1" } }); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, opts]);
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
async function login(email) { await ctx.clearCookies(); await page.goto(BASE); await page.waitForTimeout(800); await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW); await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1800); }
await page.goto(BASE); await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const P = [["Ray Requester", "ray", "Suppression", "user"], ["Dana Purchaser", "dana", "Suppression", "approver1"], ["Paul Preapprove", "paul", "Suppression", "approver2"], ["Carl Chief", "carl", "Administration", "fire_chief"], ["Alice Accounts", "alice", "Administration", "accounting"], ["Tess Tech", "tess", "Technology", "user"]];
for (const [n, e, d] of P) { const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE); await p2.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: d, password: PW }); }
await login("mike@sgfd.org");
const acc = (await api("/api/auth/accounts")).body.accounts;
for (const [n, , d, role] of P) { const a = acc.find(x => x.name === n); await post("/api/auth/approve", { id: a.id, role, division: d }); }
const shot = async n => { await page.waitForTimeout(900); await page.screenshot({ path: `tour/${n}.png`, fullPage: true }); };
const open = async name => { await page.goto(BASE); await page.waitForTimeout(1200); await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(1500); };
const nav = async label => { await page.getByRole("button", { name: label, exact: true }).first().click(); await page.waitForTimeout(1200); };
// Ray creates requisitions through the app's storage
await login("ray@sgfd.org");
await open("Procurement / Requisitions");
await page.evaluate(async () => {
  const u = () => crypto.randomUUID();
  const reqs = [
    { id: u(), division: "Suppression", category: "Equipment", title: "SCBA cylinder hydro testing", vendor: "Gulf Safety Supply", vendorId: null, description: "Annual hydro test, 24 cylinders", contractual: false, frequency: "yearly", amount: 1440, lineItems: [], invoiceNumber: "GS-2231", paymentMethod: "Check", cardLast4: "", cardholderName: "", requestedBy: "Ray Requester", createdAt: "2026-11-02T12:00:00", status: "pending_auth1", auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [] },
    { id: u(), division: "Suppression", category: "Supplies", title: "Station 61 cleaning supplies", vendor: "Bayou Janitorial", vendorId: null, description: "", contractual: false, frequency: "monthly", amount: 210.5, lineItems: [], invoiceNumber: "", paymentMethod: "Credit card", cardLast4: "4421", cardholderName: "Ray Requester", requestedBy: "Ray Requester", createdAt: "2026-11-05T12:00:00", status: "pending_auth1", auth1: null, auth2: null, chief: null, paidDate: null, rejectedReason: null, attachments: [] },
  ];
  const cur = JSON.parse((await window.storage.get("requisitions", true))?.value || "[]"); const r = await window.storage.set("requisitions", JSON.stringify([...reqs, ...cur]), true); if (!r) throw new Error("save failed");
});
await open("Procurement / Requisitions");
await shot("p1-dashboard");
await nav("New requisition"); await shot("p2-new");
await nav("Requisitions"); await shot("p3-list");
await page.locator("text=SCBA cylinder hydro testing").first().click(); await shot("p3b-expanded");
await nav("Vendors"); await shot("p4-vendors");
await nav("Quotes"); await shot("p5-quotes");
await nav("Contracts"); await shot("p6-contracts");
await nav("Budget report"); await shot("p7-report");
await open("Reimbursements"); await shot("r1-list");
await nav("New request"); await shot("r2-new");
await open("Help Desk"); await shot("h1-list");
await nav("New ticket"); await shot("h2-new");
await login("mike@sgfd.org");
await open("Procurement / Requisitions"); await nav("Import"); await shot("p8-import");
await nav("Admin"); await shot("p9-admin");
await open("Help Desk"); await shot("h3-tech");
// phone
const ph = await browser.newContext({ ...(await import("/opt/npm-tools/node_modules/playwright/index.mjs")).devices["iPhone 13"] });
const pp = await ph.newPage(); await pp.goto(BASE); await pp.waitForTimeout(800);
await pp.getByLabel(/^Email/).fill("ray@sgfd.org"); await pp.getByLabel(/^Password/).fill(PW); await pp.getByRole("button", { name: "Sign in" }).click(); await pp.waitForTimeout(1800);
await pp.getByRole("button", { name: /menu/i }).first().click().catch(() => {}); await pp.waitForTimeout(400);
await pp.getByText("Procurement / Requisitions", { exact: true }).first().click(); await pp.waitForTimeout(1500);
await pp.getByRole("button", { name: /menu/i }).first().click().catch(() => {}); await pp.waitForTimeout(400);
await pp.getByRole("button", { name: "Requisitions", exact: true }).first().click(); await pp.waitForTimeout(1200);
await pp.screenshot({ path: "tour/m1-reqs.png", fullPage: true });
console.log("errors:", errs);
await browser.close();
