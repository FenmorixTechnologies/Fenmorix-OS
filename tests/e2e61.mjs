// Clients & Quotes (vendor tool, module "sales"): clients with contacts, encrypted vault (reveal audited), work log, quote builder with
// the live calculator, saved quote = server recomputes, sent quotes locked, copy, accepted -> client active; printed quote + spec sheet;
// price book save/reset. Fictional data only. Run with run-office.sh (license keys/office.lic = all,sales).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
page.on("dialog", d => d.accept());
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Michael Owner", email: "owner@fenmorix.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(3000);
const nav = await page.getByRole("navigation").first().innerText();
check("Clients & Quotes in the side bar", nav.includes("Clients & Quotes"), nav.replace(/\n/g, " | "));

// ---- Clients through the screens ----
await page.locator("nav button", { hasText: "Clients & Quotes" }).first().click(); await page.waitForTimeout(1500);
check("overview", /Open quotes/i.test(await page.locator("main").innerText()));
await page.locator("nav button", { hasText: /^Clients$/ }).first().click(); await page.waitForTimeout(600);
await page.getByRole("button", { name: "Add a client" }).click(); await page.waitForTimeout(400);
await page.getByLabel("Client name").fill("Riverbend Fire District");
await page.getByLabel("City").fill("Riverbend");
await page.getByLabel("Contact 1 name").fill("Dana Chief"); await page.getByLabel("Contact 1 title").fill("Fire Chief");
await page.getByLabel("Contact 1 email").fill("dana@riverbend.example");
await page.getByRole("button", { name: "Add software they use" }).click();
await page.getByLabel("Current software 1", { exact: true }).fill("Scheduling"); await page.getByLabel("Current software 1 per year").fill("18000");
await page.getByRole("button", { name: "Add software they use" }).click();
await page.getByLabel("Current software 2", { exact: true }).fill("Records management"); await page.getByLabel("Current software 2 per year").fill("42000");
await page.getByRole("button", { name: "Save client" }).click(); await page.waitForTimeout(1500);
const main = () => page.locator("main").innerText();
check("client page", /Riverbend Fire District/.test(await main()) && /Dana Chief/.test(await main()) && /\$60,000 a year/.test(await main()), (await main()).slice(0, 300));
const cid = psql("SELECT id FROM sales_clients WHERE name = 'Riverbend Fire District'");

// ---- Vault ----
await page.getByRole("button", { name: "Add to vault" }).click(); await page.waitForTimeout(300);
await page.getByLabel("Vault label").fill("Production server (SSH)");
await page.getByLabel("Vault address").fill("ssh ubuntu@203.0.113.7");
await page.getByLabel("Vault user").fill("ubuntu"); await page.getByLabel("Vault password").fill("s3cret-Passphrase!");
await page.getByLabel("Vault note").fill("Key file: riverbend.pem");
await page.getByRole("button", { name: "Save to vault" }).click(); await page.waitForTimeout(1200);
const raw = psql("SELECT secret FROM sales_vault LIMIT 1");
check("vault secret encrypted at rest", raw && !raw.includes("s3cret") && !raw.includes("ubuntu"), raw.slice(0, 60));
check("password not in the client page data", !JSON.stringify((await api(`/api/sales/clients/${cid}`)).body).includes("s3cret"));
await page.getByRole("button", { name: "Show Production server (SSH)" }).click(); await page.waitForTimeout(800);
check("reveal shows the login", /s3cret-Passphrase!/.test(await main()) && /riverbend\.pem/.test(await main()));
check("reveal audited (name only)", psql("SELECT count(*) FROM audit_log WHERE module = 'Clients & Quotes' AND action = 'Revealed a vault login' AND detail LIKE '%Production server%' AND detail NOT LIKE '%s3cret%'") === "1");
// editing without a new password keeps it
const vid = psql("SELECT id FROM sales_vault LIMIT 1");
await api(`/api/sales/clients/${cid}/vault`, { id: vid, label: "Production server (SSH)", kind: "server", host: "ssh ubuntu@203.0.113.8" });
check("edit keeps the stored secret", (await api(`/api/sales/vault/${vid}/reveal`, {})).body?.password === "s3cret-Passphrase!");

// ---- Work log ----
await page.getByLabel("What happened").fill("Demo of Command Board for the chief and two captains");
await page.getByLabel("Kind of entry").selectOption("meeting");
await page.getByLabel("Hours", { exact: true }).fill("1.5");
await page.getByRole("button", { name: "Log" }).click(); await page.waitForTimeout(1000);
check("work log entry", /Demo of Command Board/.test(await main()) && /1\.5 hours logged/.test(await main()));
await page.screenshot({ path: "shot-sales-client.png", fullPage: true });

// ---- Quote builder ----
await page.locator("main").getByRole("button", { name: "New quote" }).click(); await page.waitForTimeout(1200);
check("builder starts with the client and its current software", await page.getByLabel("Client", { exact: true }).inputValue() === cid && await page.getByLabel("Replaces 1", { exact: true }).inputValue() === "Scheduling");
await page.getByLabel("Users per agency").fill("85");
await page.getByRole("button", { name: /^Command/ }).click();
await page.getByLabel("Term", { exact: true }).selectOption("3");
await page.getByLabel("Disaster recovery").selectOption("enhanced");
await page.getByRole("radio", { name: /New CAD vendor/ }).click();
await page.getByLabel("CAD system", { exact: true }).fill("CentralSquare Enterprise");
await page.waitForTimeout(400);
const sum = await page.getByRole("region", { name: "Price summary" }).innerText();
check("live summary", /Command · Mid-size/i.test(sum) && /CAD integration/.test(sum) && /Hosting and compute are not included/.test(sum) && /before hosting/i.test(sum), sum.slice(0, 400));
check("recovery tier adds no Fenmorix fee by default", !/Disaster recovery: Enhanced/.test(sum));
await page.getByLabel("Their yearly price").fill("9000");
await page.getByLabel("Hosting note").fill("Avexon quote AV-1042");
await page.waitForTimeout(300);
const sum2 = await page.getByRole("region", { name: "Price summary" }).innerText();
check("Avexon hosting shown apart", /Avexon hosting \(separate\)/i.test(sum2) && /\$9,000/.test(sum2) && /\$10,500/.test(sum2) && !/not included/.test(sum2), sum2.slice(0, 500));
await page.getByLabel("Add a typical cost").selectOption("aladtec");
await page.waitForTimeout(300);
check("typical cost added from the price book", await page.getByLabel("Replaces 3", { exact: true }).inputValue() === "Aladtec (staff scheduling): 85 users × $81/yr (typical)"
  && await page.getByLabel("Replaces 3 per year", { exact: true }).inputValue() === "6885");
await page.getByRole("button", { name: "Remove" }).nth(2).click();
await page.screenshot({ path: "shot-sales-builder.png", fullPage: true });
await page.getByRole("button", { name: "Save quote" }).click(); await page.waitForTimeout(1500);
let q = psql("SELECT number || '|' || status || '|' || (result->>'year1Recurring') || '|' || (result->>'contractValue') FROM sales_quotes").split("|");
// Command mid 45000 list (recovery tier = Avexon's hosting, no Fenmorix fee); 3-year 10% -> 40500; contract = 40500 * 3 + one-time (7500 + 7500 CAD); hosting never in it
check("saved and numbered", q[0] === `Q-${new Date().getFullYear()}-0001` && q[1] === "draft", q.join(" "));
check("server priced it", Number(q[2]) === 40500 && Number(q[3]) === 40500 * 3 + 15000, q.join(" "));
const qid = psql("SELECT id FROM sales_quotes LIMIT 1");
// tampered result ignored: the server recomputes from inputs
const r0 = (await api(`/api/sales/quotes/${qid}`)).body.quote;
await api("/api/sales/quotes", { id: qid, clientId: cid, title: r0.title, inputs: r0.inputs, result: { year1Recurring: 1 }, notes: "Pricing includes the founding offer discussed." });
// CAD choices priced by the server
const cadQ = async inputs => (await api("/api/sales/calc", { inputs: { segment: "ps", edition: "command", users: 85, termYears: 3, ...inputs } })).body.result;
let cq = await cadQ({ cadKind: "existing", cadVendor: "CentralSquare Enterprise" });
check("CAD with existing views = discounted", cq.lines.once.find(l => l.key === "cad")?.amount === 2500 && cq.notes.some(n => /\$5,000 less than a new integration/.test(n)), JSON.stringify(cq.lines.once));
cq = await cadQ({ cadKind: "new", cadSystems: 2, cadExtraViews: 2, cadCustomHours: 6 });
check("new CAD vendors, extra and custom views billed", cq.lines.once.find(l => l.key === "cad")?.amount === 15000 && cq.lines.once.find(l => l.key === "cadViews")?.amount === 3000
  && cq.lines.once.find(l => l.key === "cadCustom")?.amount === 990, JSON.stringify(cq.lines.once));
check("older quotes' CAD count still priced", (await cadQ({ cadIntegrations: 1 })).lines.once.find(l => l.key === "cad")?.amount === 7500);
check("client-sent result ignored", Number(psql(`SELECT result->>'year1Recurring' FROM sales_quotes WHERE id = '${qid}'`)) === 40500);

// ---- Print the quote ----
await page.waitForTimeout(500);
await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
await page.locator("nav button", { hasText: /^Quotes$/ }).first().click(); await page.waitForTimeout(800);
await page.locator("main table").getByText(q[0]).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Mark sent" }).click(); await page.waitForTimeout(1500);
check("marked sent", psql(`SELECT status FROM sales_quotes WHERE id = '${qid}'`) === "sent");
check("sent quote locked", (await api("/api/sales/quotes", { id: qid, clientId: cid, inputs: r0.inputs })).status === 409);
check("builder read-only when sent", await page.getByLabel("Users per agency").isDisabled() && /prices are fixed as quoted/.test(await main()));
await page.getByRole("button", { name: "Print quote" }).click(); await page.waitForTimeout(1500);
const html = await page.evaluate(() => document.getElementById("sales-print-frame")?.contentDocument?.documentElement?.outerHTML || "");
check("quote document", html.includes(q[0]) && html.includes("Riverbend Fire District") && html.includes("Command Board") && html.includes("Terms and conditions")
  && html.includes("Acceptance") && html.includes("$40,500") && html.includes("founding offer discussed") && !html.includes("DRAFT\"; position"), html.length);
check("savings on the quote", /Software it replaces/.test(html) && /\$60,000/.test(html) && /with hosting/.test(html));
check("Avexon hosting section on the quote", /Hosting and compute \(Avexon\)/.test(html) && /\$9,000/.test(html) && /AV-1042/.test(html) && /not part of the Fenmorix totals/.test(html));
check("terms say hosting is Avexon's", /are not included in Fenmorix(&#39;|')s fees/.test(html));
check("no SGFD / Nexus text in the quote", !/SGFD|Nexus|St\. George/i.test(html.replace(/<[^>]+>/g, " ")));
const pdfPage = await ctx.newPage();
await pdfPage.setContent(html, { waitUntil: "load" }); await pdfPage.waitForTimeout(600);
await pdfPage.pdf({ path: "sales-quote.pdf", format: "Letter", printBackground: true, preferCSSPageSize: true });
const pages = Number(execSync("python3 -c \"import re;print(len(re.findall(rb'/Type\\s*/Page[^s]', open('sales-quote.pdf','rb').read())))\"").toString().trim());
check("quote prints to a few pages", pages >= 3 && pages <= 6, pages);
await pdfPage.close();

// ---- Decisions and copies ----
await page.getByRole("button", { name: "Copy" }).click(); await page.waitForTimeout(1500);
check("copy = new draft", psql("SELECT count(*) FROM sales_quotes WHERE status = 'draft'") === "1" && /Q-\d{4}-0002/.test(await main()));
await api(`/api/sales/quotes/${qid}/status`, { status: "accepted" });
check("accepted -> client active with the modules", psql(`SELECT status || ' ' || (modules ? 'command') FROM sales_clients WHERE id = '${cid}'`) === "active true");
const ov = (await api("/api/sales")).body;
check("totals", ov.totals.won === 1 && ov.totals.wonYearly === 40500, JSON.stringify(ov.totals));
check("client with quotes can't be removed", (await api(`/api/sales/clients/${cid}/remove`, {})).status === 409);
const qid2 = psql("SELECT id FROM sales_quotes WHERE status = 'draft'");
check("draft can be deleted", (await api(`/api/sales/quotes/${qid2}/remove`, {})).status === 200);

// ---- Business quote, on-premises ----
const biz = (await api("/api/sales/clients", { name: "Bayou Supply Co", kind: "biz", contacts: [{ name: "Pat Owner", email: "pat@bayou.example", primary: true }] })).body.id;
const bq = (await api("/api/sales/quotes", { clientId: biz, inputs: { segment: "biz", edition: "business", users: 8, termYears: 1 } })).body;
check("business minimum applies", Number(psql(`SELECT result->>'year1Recurring' FROM sales_quotes WHERE id = '${bq.id}'`)) === 4000);
const oq = (await api("/api/sales/quotes", { clientId: biz, inputs: { segment: "biz", edition: "business", users: 40, delivery: "onprem", termYears: 1 } })).body;
check("on-premises license", Number(psql(`SELECT result->'onPremQuote'->>'license' FROM sales_quotes WHERE id = '${oq.id}'`)) === 40 * 20 * 12 * 2.75);

// ---- Price book ----
await page.locator("nav button", { hasText: "Price book" }).first().click(); await page.waitForTimeout(800);
await page.getByLabel("Command Mid-size").fill("47000");
await page.getByRole("button", { name: "Save price book" }).click(); await page.waitForTimeout(1200);
check("price book saved", (await api("/api/sales/book")).body.book.segments.ps.editions[2].prices.m === 47000);
check("sent quote keeps its book", (await api(`/api/sales/quotes/${qid}`)).body.quote.book.segments.ps.editions[2].prices.m === 45000);
check("preview uses the new book", (await api("/api/sales/calc", { inputs: { segment: "ps", edition: "command", users: 85, termYears: 1 } })).body.result.listAnnual === 47000);
await page.screenshot({ path: "shot-sales-book.png" });
await api("/api/sales/book/reset", {});
check("reset", (await api("/api/sales/book")).body.book.segments.ps.editions[2].prices.m === 45000);

// ---- Spec sheet ----
await page.locator("nav button", { hasText: "Spec sheets" }).first().click(); await page.waitForTimeout(800);
await page.evaluate(() => { window.print = () => {}; });
await page.getByLabel("Edition", { exact: true }).selectOption("command");
await page.getByRole("button", { name: "Print spec sheet" }).click(); await page.waitForTimeout(1200);
const spec = await page.evaluate(() => document.getElementById("sales-print-frame")?.contentDocument?.documentElement?.outerHTML || "");
check("spec sheet", /SPEC SHEET/.test(spec) && /Command Board/.test(spec) && /High availability/.test(spec) && !/\$45,000/.test(spec), spec.length);
await page.getByLabel("Show prices").check(); await page.waitForTimeout(300);
const onScreen = await page.getByRole("region", { name: "Spec sheet prices" }).innerText();
check("prices on screen (public safety)", /\$20,000/.test(onScreen) && /\$4[57],000/.test(onScreen) && /\$85,000/.test(onScreen) && /\$7,500/.test(onScreen), onScreen);
await page.getByRole("button", { name: "Print spec sheet" }).click(); await page.waitForTimeout(1200);
const specP = await page.evaluate(() => document.getElementById("sales-print-frame")?.contentDocument?.documentElement?.outerHTML || "");
const rowOf = (html, name) => (html.split(name)[1] || "").split("</tr>")[0];
check("support, environments and add-ons priced at each size", /Avexon quote/.test(rowOf(specP, "High availability")) && /(\$6,750|\$7,050)[\s\S]*\$12,750|\$12,750/.test(rowOf(specP, "Priority")) && /\$11,250|\$11,750/.test(rowOf(specP, "24/7 Critical"))
  && /Included/.test(rowOf(specP, "Production + training<")) && /\$5,000/.test(rowOf(specP, "Investigations (CJIS)")) && /CAD connection, new CAD vendor/.test(specP) && /Per user, per month/.test(specP),
  [rowOf(specP, "Priority"), rowOf(specP, "Production + training<")].join(" | ").replace(/<[^>]+>/g, " ").slice(0, 300));
check("preview on the page", /Backup and disaster recovery/i.test(await page.frameLocator("iframe[title='Spec sheet preview']").locator("body").innerText()));
check("printed spec sheet has the price table", /<h2>Pricing<\/h2>/.test(specP) && /\$4[57],000/.test(specP) && /Mid-size \(up to 100 users\)/.test(specP));
await page.getByLabel("Market", { exact: true }).selectOption("biz"); await page.waitForTimeout(300);
check("prices on screen (business)", /\$12/.test(await page.getByRole("region", { name: "Spec sheet prices" }).innerText()));
const sp = await ctx.newPage(); await sp.setContent(specP, { waitUntil: "load" }); await sp.waitForTimeout(500);
await sp.pdf({ path: "sales-spec.pdf", format: "Letter", printBackground: true, preferCSSPageSize: true }); await sp.close();

// ---- Overview + quotes list shots ----
await page.locator("nav button", { hasText: "Overview" }).first().click(); await page.waitForTimeout(1000);
await page.screenshot({ path: "shot-sales-overview.png" });
check("no page errors", !errors.length, errors.join(" | "));
done(); await browser.close();
