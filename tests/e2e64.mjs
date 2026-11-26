// Client portal: the office (localhost:3077) gives a client contact portal access; the contact signs in on the portal's own address
// (127.0.0.1:3077 = PORTAL_HOST in this test), sees servers/quotes/support/updates/documents, accepts a quote, opens a request; the office
// answers. The portal address must not reach anything of the office app. Fictional data only. Run with run-portal.sh.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";

const OFFICE = "http://localhost:3077", PORTAL = "http://127.0.0.1:3077", PW = "Correct horse battery", CPW = "Client pass 2026!";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errors = []; page.on("pageerror", e => errors.push("office: " + e.message));
page.on("dialog", d => d.accept());
const mkApi = p => (path, body) => p.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const api = mkApi(page);
const main = p => p.locator("main").innerText();

await page.goto(OFFICE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Michael Owner", email: "owner@fenmorix.example", password: PW });
await page.goto(OFFICE); await page.waitForTimeout(2500);

// A client with a contact, a sent quote and a server on the update service
const cl = await api("/api/sales/clients", { name: "Riverbend Fire District", kind: "ps", status: "prospect", city: "Riverbend", state: "LA",
  contacts: [{ name: "Dana Chief", title: "Fire Chief", email: "dana@riverbend.example", primary: true }] });
const cid = cl.body.id;
const q = await api("/api/sales/quotes", { clientId: cid, title: "Fenmorix OS for Riverbend", inputs: { segment: "ps", users: 45, termYears: 3 } });
await api(`/api/sales/quotes/${q.body.id}/status`, { status: "sent" });
const q2 = await api("/api/sales/quotes", { clientId: cid, title: "Draft only", inputs: { segment: "ps", users: 45 } });
const hk = await api("/api/hub/installs", { name: "Riverbend server", package: "riverbend", clientId: cid });
psql(`UPDATE hub_installs SET version = '2026.11.26.5', last_seen = now(), info = '{\\"users\\": 38, \\"auto\\": true, \\"url\\": \\"https://ops.riverbend.example\\"}' WHERE name = 'Riverbend server'`);
psql(`INSERT INTO hub_releases (package, version, notes, file_name, size, sha256, kid, sig) VALUES ('riverbend', '2026.12.01.1', '[\\"Faster reports\\", \\"New schedule view\\"]', 'x.zip', 1, 'x', 'dev2', 'x')`);
check("setup", cid && q.body.number && hk.body.key, JSON.stringify([cl.body, q.body]));

// ---- Office: give Dana portal access from the client page ----
await page.locator("nav button", { hasText: "Clients & Quotes" }).first().click(); await page.waitForTimeout(1200);
await page.locator("nav button", { hasText: /^Clients$/ }).first().click(); await page.waitForTimeout(800);
await page.getByText("Riverbend Fire District").first().click(); await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Give portal access" }).click(); await page.waitForTimeout(300);
check("contact picked from the client's contacts", (await page.getByLabel("Portal email").inputValue()) === "dana@riverbend.example");
await page.getByRole("button", { name: "Make the sign-in link" }).click(); await page.waitForTimeout(1200);
const link = (await page.getByRole("alert").innerText()).match(/https?:\/\/\S+invite=[\w-]+/)?.[0];
check("one-time sign-in link made", !!link && link.startsWith(PORTAL), link);
check("invite stored hashed", psql("SELECT invite_hash FROM portal_users").length === 64 && !psql("SELECT invite_hash FROM portal_users").includes(link.split("=").pop()));

// ---- Doc shared ----
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const share = await api(`/api/clientportal/${cid}/docs`, { name: "Signed agreement.pdf", note: "Countersigned", dataUrl: "data:application/pdf;base64," + pdf.toString("base64") });
check("document shared", share.status === 200);
check("a script file can't be shared", (await api(`/api/clientportal/${cid}/docs`, { name: "x.html", dataUrl: "data:text/html;base64," + Buffer.from("<script>alert(1)</script>").toString("base64") })).status === 415);

// ---- The portal address: nothing of the office app ----
const pctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pp = await pctx.newPage(); pp.on("pageerror", e => errors.push("portal: " + e.message)); pp.on("dialog", d => d.accept());
const papi = mkApi(pp);
await pp.goto(PORTAL); await pp.waitForTimeout(1500);
const raw = async path => pp.evaluate(async p => { const r = await fetch(p); return { s: r.status, t: (await r.text()).slice(0, 200) }; }, path);
check("portal page served on the portal address", /Sign in/.test(await pp.locator("body").innerText()), (await pp.locator("body").innerText()).slice(0, 200));
check("office app script not served there", (await raw("/app.js")).s === 404);
check("office API not reachable there", (await raw("/api/auth/me")).s === 404 && (await raw("/api/sales")).s === 404 && (await raw("/api/clientportal")).s === 404);
check("office pages give the portal page", /portal\.js/.test(await pp.evaluate(async () => (await fetch("/procurement")).text())));
check("portal API not on the office address", (await page.evaluate(async () => (await fetch("/api/portal/me")).status)) !== 200);
check("wrong password refused", (await papi("/api/portal/login", { email: "dana@riverbend.example", password: "nope" })).status === 401);

// ---- Dana sets her password from the link ----
await pp.goto(link); await pp.waitForTimeout(1500);
check("link greets her", /Welcome, Dana Chief/.test(await pp.locator("body").innerText()));
await pp.getByLabel("New password").fill("short"); await pp.getByLabel("Type it again").fill("short");
await pp.getByRole("button", { name: "Save and sign in" }).click(); await pp.waitForTimeout(800);
check("weak password refused", /10 characters/.test(await pp.getByRole("alert").innerText().catch(() => "")));
await pp.getByLabel("New password").fill(CPW); await pp.getByLabel("Type it again").fill(CPW);
await pp.getByRole("button", { name: "Save and sign in" }).click(); await pp.waitForTimeout(2000);
let t = await main(pp);
check("signed in: home shows the client, servers, quotes waiting", /Riverbend Fire District/.test(t) && /Quote waiting for your answer/.test(t) && /New schedule view/.test(t), t.slice(0, 500));
check("link works once", (await papi(`/api/portal/invite?token=${link.split("=").pop()}`)).status === 410);
const ov = (await papi("/api/portal/overview")).body;
check("drafts and internal notes not shown", ov.quotes.length === 1 && !JSON.stringify(ov).includes("Draft only") && !JSON.stringify(ov).includes("internal"), JSON.stringify(ov.quotes));
check("price book not sent to the client", !JSON.stringify(ov).includes("marketRates") && !JSON.stringify(ov).includes("editions"));
check("server version vs latest", ov.servers[0].version === "2026.11.26.5" && ov.servers[0].latest === "2026.12.01.1" && !ov.servers[0].upToDate && ov.servers[0].users === 38);
check("no update key or vault in the portal data", !JSON.stringify(ov).includes("fxu_") && !JSON.stringify(ov).includes("key_hash"));

// ---- Servers page ----
await pp.locator("nav button", { hasText: "Servers" }).click(); await pp.waitForTimeout(500);
check("servers page", /2026\.12\.01\.1 available/.test(await main(pp)) && /38 users/.test(await main(pp)));

// ---- Accept the quote ----
await pp.locator("nav button", { hasText: "Quotes" }).click(); await pp.waitForTimeout(500);
await pp.getByRole("button", { name: "Review" }).click(); await pp.waitForTimeout(2000);
const frameText = await pp.frameLocator(`iframe[title^="Quote"]`).locator("body").innerText();
check("quote shows in the portal", new RegExp(q.body.number).test(frameText) && /Riverbend/.test(frameText), frameText.slice(0, 200));
check("accept needs name and the box", await pp.getByRole("button", { name: "Accept quote" }).isDisabled());
await pp.getByLabel("Your full name").fill("Dana Chief"); await pp.getByLabel("Your title").fill("Fire Chief");
await pp.getByText(/I'm authorized to accept/).click();
await pp.getByRole("button", { name: "Accept quote" }).click(); await pp.waitForTimeout(1500);
check("accepted", /Accepted/.test(await main(pp)) && psql(`SELECT status || '|' || decided_by || '|' || decided_title FROM sales_quotes WHERE id = '${q.body.id}'`) === "accepted|Dana Chief|Fire Chief");
check("client became a customer", psql(`SELECT status FROM sales_clients WHERE id = '${cid}'`) === "active");
check("noted in the work log", /ACCEPTED in the client portal by Dana Chief/.test(psql(`SELECT string_agg(body, ';') FROM sales_activity WHERE client_id = '${cid}'`)));
check("can't accept twice", (await papi(`/api/portal/quotes/${q.body.id}/accept`, { name: "x", agree: true })).status === 409);
check("can't open another client's or a draft quote", (await raw(`/api/portal/quotes/${q2.body.id}/html`)).s === 404);

// ---- Support request ----
await pp.locator("nav button", { hasText: "Support" }).click(); await pp.waitForTimeout(500);
await pp.getByRole("button", { name: "New request" }).click();
await pp.getByLabel("Subject").fill("Schedule shows wrong shift"); await pp.getByLabel("What do you need?").fill("B shift shows on A shift days since Monday.");
await pp.getByLabel("Priority").selectOption("high");
await pp.getByRole("button", { name: "Send request" }).click(); await pp.waitForTimeout(1500);
check("request opened", /Schedule shows wrong shift/.test(await main(pp)) && psql("SELECT priority FROM portal_tickets") === "high");

// ---- Office sees it on the Overview, answers ----
await page.goto(OFFICE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "Clients & Quotes" }).first().click(); await page.waitForTimeout(1500);
t = await main(page);
check("office overview lists the request", /Client portal: 1 request/.test(t) && /Schedule shows wrong shift/.test(t), t.slice(0, 400));
await page.getByRole("button", { name: /#\d+ Schedule shows wrong shift/ }).first().click(); await page.waitForTimeout(1500);
await page.getByLabel("Reply to the client").fill("Fixed: the rotation start date was off by one day. Please check again.");
await page.getByRole("button", { name: "Send reply" }).click(); await page.waitForTimeout(1200);
check("answered", psql("SELECT status FROM portal_tickets") === "answered");

// ---- Dana sees the reply, documents, updates ----
await pp.reload(); await pp.waitForTimeout(2000);
check("new reply badge", /NEW REPLY|Support\s*1/.test(await pp.locator("body").innerText()));
await pp.locator("nav button", { hasText: "Support" }).click(); await pp.waitForTimeout(500);
await pp.getByRole("button", { name: /Schedule shows wrong shift/ }).click(); await pp.waitForTimeout(1000);
check("reply visible", /rotation start date was off by one day/.test(await main(pp)) && /\(Fenmorix\)/.test(await main(pp)));
await pp.locator("nav button", { hasText: "Documents" }).click(); await pp.waitForTimeout(500);
check("document listed", /Signed agreement\.pdf/.test(await main(pp)));
const dl = await pp.evaluate(async () => { const r = await fetch(document.querySelector('a[href^="/api/portal/docs/"]').href); return { s: r.status, t: r.headers.get("content-type"), d: r.headers.get("content-disposition") }; });
check("document downloads (attachment)", dl.s === 200 && dl.t === "application/pdf" && /attachment/.test(dl.d), JSON.stringify(dl));
await pp.locator("nav button", { hasText: "Updates" }).click(); await pp.waitForTimeout(500);
check("release notes", /Faster reports/.test(await main(pp)));
await pp.screenshot({ path: "shot-portal.png" });

// ---- Access turned off ends the session ----
const uid = psql("SELECT id FROM portal_users");
await api(`/api/clientportal/users/${uid}/disable`, {});
check("turned off: signed out", (await papi("/api/portal/overview")).status === 401);
check("turned off: can't sign in", (await papi("/api/portal/login", { email: "dana@riverbend.example", password: CPW })).status === 401);
check("portal actions audited", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Client portal'")) >= 5);
check("no page errors", !errors.length, errors.join(" | "));
await browser.close(); done();
