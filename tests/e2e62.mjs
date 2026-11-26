// Expenses & Deductions (tile "books", vendor module "sales"): expenses with receipts, mileage log (round trip, repeat), vehicles with
// odometer + method, home office (simplified vs actual), monthly bills, the Schedule C summary math, CSV + PDF packet (receipts attached),
// receipt files, access. Fictional data only. Run with run-office.sh (license keys/office.lic = all,sales).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { PDFDocument } from "/opt/npm-tools/node_modules/pdf-lib/cjs/index.js";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
page.on("dialog", d => d.accept());
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const main = () => page.locator("main").innerText();
const Y = new Date().getFullYear();
// After changes made by API: open the module again so it loads fresh
const reopen = async () => { await page.goto(BASE); await page.waitForTimeout(2000); await page.locator("nav button", { hasText: "Expenses & Deductions" }).first().click(); await page.waitForTimeout(1500); };

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Michael Owner", email: "owner@fenmorix.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(3000);
const nav = await page.getByRole("navigation").first().innerText();
check("Expenses & Deductions in the side bar", nav.includes("Expenses & Deductions"), nav.replace(/\n/g, " | "));

// A receipt photo (a screenshot of a fake receipt)
const rp = await ctx.newPage();
await rp.setContent(`<div style="font:16px monospace;padding:20px;width:300px">SAMPLE OFFICE SUPPLY<br>2 x printer paper<br>TOTAL $20.00<br>VISA ****</div>`);
const jpg = await rp.screenshot({ type: "jpeg", quality: 80 }); await rp.close();
const fs = await import("node:fs"); fs.writeFileSync("/tmp/receipt-test.jpg", jpg);

await page.locator("nav button", { hasText: "Expenses & Deductions" }).first().click(); await page.waitForTimeout(1500);
check("overview opens", /Deductions/.test(await main()) && /Nothing recorded/.test(await main()), (await main()).slice(0, 200));

// ---- An expense with a receipt, through the screens ----
await page.locator("nav button", { hasText: /^Expenses$/ }).first().click(); await page.waitForTimeout(500);
await page.getByRole("button", { name: "Add an expense" }).first().click(); await page.waitForTimeout(300);
await page.getByLabel("Category", { exact: true }).selectOption("software");
await page.getByLabel("Amount").fill("20");
await page.getByLabel("Paid to").fill("Sample Office Supply");
await page.getByLabel("What it was for").fill("Printer paper");
await page.getByLabel("Attach receipts").setInputFiles("/tmp/receipt-test.jpg"); await page.waitForTimeout(800);
await page.getByRole("button", { name: "Add expense" }).click(); await page.waitForTimeout(1500);
check("expense listed", /Sample Office Supply/.test(await main()) && /\$20\.00/.test(await main()), (await main()).slice(0, 400));
const eid = psql("SELECT id FROM biz_expenses WHERE vendor = 'Sample Office Supply'");
const rid = psql(`SELECT id FROM biz_receipts WHERE expense_id = '${eid}'`);
check("receipt stored as JPEG", psql(`SELECT mime FROM biz_receipts WHERE id = '${rid}'`) === "image/jpeg");
const rr = await page.evaluate(async id => { const r = await fetch(`/api/books/receipts/${id}`); return { s: r.status, t: r.headers.get("content-type"), csp: r.headers.get("content-security-policy"), n: (await r.arrayBuffer()).byteLength }; }, rid);
check("receipt opens (sandboxed)", rr.s === 200 && rr.t === "image/jpeg" && /sandbox/.test(rr.csp) && rr.n > 1000, JSON.stringify(rr));
const bad = await api("/api/books/receipts", { expenseId: eid, name: "x.exe", dataUrl: "data:application/octet-stream;base64," + Buffer.from("MZ not a receipt").toString("base64") });
check("non-receipt file refused", bad.status === 415, JSON.stringify(bad));

// ---- More expenses by API ----
const add = b => api("/api/books/expenses", { day: `${Y}-03-10`, ...b });
const meals = await add({ category: "meals", vendor: "Diner", description: "Lunch with a client", amount: 80 });
const phone = await add({ category: "phone_internet", vendor: "Phone Co", amount: 100 });
check("phone defaults to 50% business", psql(`SELECT business_pct FROM biz_expenses WHERE id = '${phone.body.id}'`) === "50.00");
check("expense needs a category", (await add({ category: "nope", amount: 5 })).status === 400);

// ---- Vehicle + trips ----
await page.locator("nav button", { hasText: "Mileage & vehicles" }).first().click(); await page.waitForTimeout(600);
await page.getByRole("button", { name: "Add a vehicle" }).click();
await page.getByLabel("Vehicle name").fill("Work Truck"); await page.getByRole("button", { name: "Save vehicle" }).click(); await page.waitForTimeout(1200);
const vid = psql("SELECT id FROM biz_vehicles WHERE name = 'Work Truck'");
await page.getByLabel("Work Truck odometer start").fill("10000"); await page.getByLabel("Work Truck odometer end").fill("20000");
await page.getByRole("button", { name: "Save Work Truck" }).click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Log a trip" }).first().click(); await page.waitForTimeout(300);
await page.getByLabel("Business purpose").fill("Install at Riverbend"); await page.getByLabel("From").fill("Office"); await page.getByLabel("To").fill("Riverbend station 1");
await page.getByLabel("Miles", { exact: true }).fill("15"); await page.getByText("Round trip (doubles the miles)").click();
await page.getByRole("button", { name: "Log trip" }).click(); await page.waitForTimeout(1500);
check("round trip stored as 30 miles", psql("SELECT miles FROM biz_trips WHERE purpose = 'Install at Riverbend'") === "30.0");
check("trip uses the vehicle", psql("SELECT vehicle_id FROM biz_trips WHERE purpose = 'Install at Riverbend'") === vid);
await page.getByRole("button", { name: "Repeat Install at Riverbend" }).click(); await page.waitForTimeout(300);
check("repeat fills the trip", (await page.getByLabel("Business purpose").inputValue()) === "Install at Riverbend" && (await page.getByLabel("Miles", { exact: true }).inputValue()) === "30");
await page.getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(300);
await api("/api/books/trips", { day: `${Y}-04-02`, purpose: "Supply run", odoStart: 12000, odoEnd: 12070, vehicleId: vid });
check("miles from the odometer", psql("SELECT miles FROM biz_trips WHERE purpose = 'Supply run'") === "70.0");
check("trip needs a purpose", (await api("/api/books/trips", { day: `${Y}-04-02`, miles: 5 })).status === 400);
await add({ category: "car_parking", vendor: "Garage", amount: 10, vehicleId: vid });
await add({ category: "car_fuel", vendor: "Gas station", amount: 50, vehicleId: vid });

// ---- Home office ----
await api("/api/books/expenses", { day: `${Y}-02-01`, category: "home_utilities", vendor: "Power Co", amount: 1200 });
await reopen(); await page.locator("nav button", { hasText: "Home office" }).first().click(); await page.waitForTimeout(600);
await page.getByLabel("Office square feet").fill("200"); await page.getByLabel("Home square feet").fill("2000");
await page.waitForTimeout(300);
const hm = await main();
await page.screenshot({ path: "shot-books-home.png" });
check("home office compares both methods", /\$1,000\.00/.test(hm) && /\$120\.00/.test(hm) && /10% of \$1,200\.00/.test(hm), hm.slice(0, 500));
await page.getByRole("button", { name: "Save home office" }).click(); await page.waitForTimeout(1200);

// ---- Summary math ----
let s = (await api(`/api/books?year=${Y}`)).body.summary;
const line = l => s.lines.find(x => x.line === l)?.deductible;
check("meals at 50%", line("24b") === 40, JSON.stringify(s.lines));
check("other expenses = software + 50% phone", line("27a") === 70);
check("line 9 = 100 mi × 72.5¢ + parking (fuel covered by the rate)", line("9") === 82.5, line("9"));
check("vehicle business use 1%", s.vehicles[0]?.pct === 1 && s.vehicles[0]?.totalMiles === 10000, JSON.stringify(s.vehicles[0]));
check("home office simplified on line 30", line("30") === 1000);
check("total", s.total === 1192.5, s.total);
check("missing receipts counted (meals $80 + phone $100 + utilities $1,200)", s.missingReceipts === 3, s.missingReceipts);
await api(`/api/books/vehicles/${vid}/year`, { year: Y, odoStart: 10000, odoEnd: 20000, method: "actual" });
s = (await api(`/api/books?year=${Y}`)).body.summary;
check("actual costs: fuel × 1% + parking", s.lines.find(x => x.line === "9")?.deductible === 10.5, JSON.stringify(s.lines.find(x => x.line === "9")));
await api(`/api/books/vehicles/${vid}/year`, { year: Y, odoStart: 10000, odoEnd: 20000, method: "standard" });
check("odometer end below start refused", (await api(`/api/books/vehicles/${vid}/year`, { year: Y, odoStart: 5, odoEnd: 1 })).status === 400);
check("vehicle with trips can't be removed", (await api(`/api/books/vehicles/${vid}/remove`, {})).status === 409);

// ---- Monthly bills ----
await api("/api/books/recurring", { category: "hosting", vendor: "Cloud Host", amount: 12, dayOfMonth: 5 });
const p1 = await api("/api/books/recurring/post", { month: `${Y}-05` }), p2 = await api("/api/books/recurring/post", { month: `${Y}-05` });
check("monthly bill added once per month", p1.body?.added === 1 && p2.body?.added === 0, JSON.stringify([p1.body, p2.body]));
check("bill dated on its day", psql(`SELECT day FROM biz_expenses WHERE vendor = 'Cloud Host'`) === `${Y}-05-05`);

// ---- Overview shows it ----
await reopen(); await page.screenshot({ path: "shot-books-overview.png" });
const ov = await main();
check("overview totals", /\$1,204\.50/.test(ov) && /Deductible meals/.test(ov) && /Business use of home/.test(ov), ov.slice(0, 600));

// ---- Exports ----
const csv = await page.evaluate(async y => (await fetch(`/api/books/export.csv?year=${y}`)).text(), Y);
check("CSV has expenses, trips and the summary", /Sample Office Supply/.test(csv) && /Install at Riverbend/.test(csv) && /Summary,,,24b,Deductible meals/.test(csv) && /Total,,,,1204\.50/.test(csv), csv.slice(-400));
await page.locator("nav button", { hasText: "Accountant's packet" }).first().click(); await page.waitForTimeout(600);
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "PDF with receipts" }).click()]);
const pdfPath = await dl.path(); const pdfBuf = fs.readFileSync(pdfPath);
const pdf = await PDFDocument.load(pdfBuf);
check("PDF packet made", pdfBuf.slice(0, 5).toString() === "%PDF-" && pdf.getPageCount() >= 3, pdf.getPageCount());
const noR = await page.evaluate(async y => (await fetch(`/api/books/export.pdf?year=${y}&receipts=0`)).arrayBuffer().then(b => b.byteLength), Y);
check("packet without receipts is smaller", noR < pdfBuf.length, `${noR} vs ${pdfBuf.length}`);
fs.copyFileSync(pdfPath, "/home/claude/testrun/tax-packet-test.pdf");
check("export audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Expenses & Deductions' AND action LIKE 'Exported%'")) >= 2);

// ---- Reading a receipt without a key: plain message ----
const rd = await api("/api/books/read-receipt", { name: "r.jpg", dataUrl: "data:image/jpeg;base64," + jpg.toString("base64") });
check("receipt reading explains it's off", rd.status === 503 && /by hand/.test(rd.body?.error || ""), JSON.stringify(rd));

// ---- Settings ----
const st = await api("/api/books/settings", { rates: { [Y]: 0.7 }, business: { owner: "Michael Owner", accountantEmail: "cpa@example.org" } });
check("settings saved", st.status === 200 && st.body.settings.rates[Y] === 0.7 && st.body.settings.business.city === "Baton Rouge");
s = (await api(`/api/books?year=${Y}`)).body.summary;
check("new rate used", s.rate === 0.7 && s.lines.find(x => x.line === "9")?.deductible === 80, JSON.stringify(s.lines.find(x => x.line === "9")));

// ---- Cloudflare Access session ended: plain message + banner instead of "Failed to fetch" ----
await reopen();
await page.route("**/api/**", r => r.fulfill({ status: 302, headers: { Location: "https://fenmorix.cloudflareaccess.example/cdn-cgi/access/login" } }));
await page.locator("nav button", { hasText: "Monthly bills" }).first().click(); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Add a monthly bill" }).click();
await page.getByLabel("Bill paid to").fill("Test"); await page.getByRole("button", { name: "Save bill" }).click(); await page.waitForTimeout(1500);
const alertTxt = await page.getByRole("alert").innerText().catch(() => "");
const toastTxt = await page.getByRole("status").innerText().catch(() => "");
check("sign-in ended: banner with reload", /secure sign-in has ended/.test(alertTxt) && /Reload and sign in/.test(alertTxt), alertTxt);
check("sign-in ended: the screen's message is plain too", /secure sign-in has ended/.test(toastTxt) && !/Failed to fetch/.test(toastTxt), toastTxt);
await page.unroute("**/api/**");

// ---- Someone without access ----
const ctx2 = await browser.newContext(); const p2page = await ctx2.newPage();
await p2page.goto(BASE); await p2page.waitForTimeout(500);
const api2 = (path, body) => p2page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const div = psql("SELECT name FROM divisions ORDER BY name LIMIT 1");
await api2("/api/auth/signup", { firstName: "Pat", lastName: "Staff", email: "pat@fenmorix.example", division: div, password: PW });
const pat = psql("SELECT id FROM users WHERE email = 'pat@fenmorix.example'");
const ap = await api("/api/auth/approve", { id: pat, role: "user", division: div });
const li = await api2("/api/auth/login", { email: "pat@fenmorix.example", password: PW });
check("second account signed in", ap.status === 200 && li.status === 200, JSON.stringify([ap, li]));
check("others can't open the books", (await api2("/api/books")).status === 403);
check("others can't open receipts", (await api2(`/api/books/receipts/${rid}`)).status === 403);
check("others can't add expenses", (await api2("/api/books/expenses", { day: `${Y}-01-01`, category: "office", amount: 5 })).status === 403);
// ---- Module switches (System page): off without a new license, back on as it was ----
const lic0 = (await api("/api/system/license")).body;
check("license lists modules as licensed", lic0.modules.find(m => m.key === "forms")?.licensed && lic0.modules.find(m => m.key === "forms")?.on, JSON.stringify(lic0.modules.find(m => m.key === "forms")));
const off1 = await api("/api/system/modules-off", { off: ["forms"] });
const fm = off1.body.modules.find(m => m.key === "forms");
check("forms switched off", off1.status === 200 && !fm.on && fm.switchedOff && fm.licensed, JSON.stringify(fm));
check("its API is locked", (await api("/api/forms")).status === 404);
check("dependents go off too", off1.body.modules.filter(m => m.needs.includes("forms") && m.licensed).every(m => !m.on));
await page.goto(BASE); await page.waitForTimeout(2000);
check("tile hidden", !(await page.getByRole("navigation").first().innerText()).includes("Forms"));
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(800);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(1500);
await page.getByLabel("Forms & Case Management: off").check(); await page.getByRole("button", { name: "Save module switches" }).click(); await page.waitForTimeout(1200);
check("switched back on from the page", (await api("/api/system/license")).body.modules.find(m => m.key === "forms")?.on === true);
check("unlicensed modules can't be switched", (await api("/api/system/modules-off", { off: [] })).body.modules.every(m => m.licensed || !m.on));
check("switches audited", Number(psql("SELECT count(*) FROM audit_log WHERE action = 'Switched modules on or off'")) === 3, psql("SELECT count(*) FROM audit_log WHERE action = 'Switched modules on or off'"));

check("no page errors", !errors.length, errors.join(" | "));
await browser.close(); done();
