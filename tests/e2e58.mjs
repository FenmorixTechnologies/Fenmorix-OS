// Retail modules for a precious-metals shop: live spot prices (demo source: ticker on every page, page, Your Day card, TV view) and
// Quick Links (encrypted shared logins: only chosen people reveal them, every reveal logged; who sees each link). Fictional data only.
// Run with run-shop.sh (PRODUCT=fenmorix, ORG_NAME, SPOT_PROVIDER=demo, license keys/shop.lic: timeclock, offwork, sick, messaging, spot, links).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const apiOn = p => (path, body) => p.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const api = apiOn(page);

await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Laura Owner", email: "owner@shop.example", password: PW });
await page.goto(BASE); await page.waitForTimeout(3000);

// ---- What this shop has ----
const nav = await page.getByRole("navigation").first().innerText();
check("shop sections on", ["Spot Prices", "Quick Links", "Time Tracker", "Off Work", "Sick Leave", "Messages"].every(t => nav.includes(t)), nav.replace(/\n/g, " | "));
check("fire sections off", !["Procurement", "Command Board", "PIAL", "Leave Picks", "Force Back", "Training"].some(t => nav.includes(t)));
// ---- Spot prices ----
let s = (await api("/api/spot")).body;
check("demo prices for all four metals", s.configured && s.demo && s.metals.length === 4 && s.metals.every(m => m.price > 0 && m.bid < m.ask), JSON.stringify(s).slice(0, 200));
const ticker = page.getByRole("region", { name: "Spot prices" }).first();
check("ticker on the home page", await ticker.count() === 1 && /Gold\s*\$[\d,]+\.\d\d/.test(await ticker.innerText()) && /DEMO PRICES/.test(await ticker.innerText()), await ticker.innerText().catch(() => ""));
check("Your Day spot card", await page.locator("[data-widget=spot]").count() === 1 && /Platinum/.test(await page.locator("[data-widget=spot]").innerText()));
// a day of readings for the charts
psql(`INSERT INTO spot_points (at, metal, price) SELECT date_trunc('day', now()) + (i * interval '10 minutes'), 'gold', 2600 + i FROM generate_series(1, 40) i WHERE date_trunc('day', now()) + (i * interval '10 minutes') < now() ON CONFLICT DO NOTHING`);
psql(`INSERT INTO spot_points (at, metal, price) SELECT now() - (i * interval '1 hour'), 'silver', 30 + i / 100.0 FROM generate_series(30, 160) i ON CONFLICT DO NOTHING`);
const h = (await api("/api/spot/history?metal=gold&range=day")).body;
check("today's history", h.points.length >= 2, h.points.length);
const wk = (await api("/api/spot/history?metal=silver&range=week")).body;
check("week history in half-hour buckets", wk.points.length > 50 && wk.points.length < 200, wk.points.length);
check("bad metal refused", (await api("/api/spot/history?metal=copper")).status === 400);
await page.locator("nav button", { hasText: "Spot Prices" }).first().click(); await page.waitForTimeout(2000);
check("Spot Prices page: four metals with charts", await page.getByRole("region", { name: /^(Gold|Silver|Platinum|Palladium)$/ }).count() === 4 && await page.locator("svg[aria-label^='gold day chart']").count() === 1);
await page.getByRole("tab", { name: "Week" }).click(); await page.waitForTimeout(1200);
check("week chart", await page.locator("svg[aria-label^='silver week chart']").count() === 1);
await page.getByRole("button", { name: "Check now" }).click(); await page.waitForTimeout(1200);
check("master can check now", /Checked/.test(await page.locator("main").innerText()));
check("check now limited to once a minute", (await api("/api/spot/refresh", {})).status === 429);
await page.screenshot({ path: "shot-shop-spot.png" });
check("TV view offered", Object.keys((await api("/api/display/screens")).body?.views || {}).includes("spot"));

// ---- Quick Links ----
await page.goto(BASE); await page.waitForTimeout(2000);
await page.locator("nav button", { hasText: "Quick Links" }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Add a link" }).first().click(); await page.waitForTimeout(400);
await page.getByLabel("Name", { exact: true }).fill("Coin supplier portal");
await page.getByLabel("Web address").fill("dealer.example.com/login");
await page.getByLabel("Category").fill("Suppliers");
await page.getByLabel("Login user name").fill("lgc-buyer");
await page.getByLabel("Login password").fill("S3cret-Bullion!");
await page.getByRole("button", { name: "Add the link" }).click(); await page.waitForTimeout(1200);
let L = (await api("/api/links")).body;
const sup = L.links.find(l => l.title === "Coin supplier portal");
check("link added, web address cleaned", sup && sup.url === "https://dealer.example.com/login" && sup.hasLogin && sup.canReveal, JSON.stringify(sup));
check("login stored encrypted", !psql("SELECT secret FROM quick_links WHERE title = 'Coin supplier portal'").includes("S3cret") && /^v1:/.test(psql("SELECT secret FROM quick_links WHERE title = 'Coin supplier portal'")));
await page.getByRole("button", { name: "Show login for Coin supplier portal" }).click(); await page.waitForTimeout(800);
const box = page.getByRole("group", { name: "Login for Coin supplier portal" });
check("owner reveals the login", /lgc-buyer/.test(await box.innerText()) && /S3cret-Bullion!/.test(await box.innerText()));
await box.getByRole("button", { name: "Copy password", exact: true }).click(); await page.waitForTimeout(300);
check("password copied", (await page.evaluate(() => navigator.clipboard.readText())) === "S3cret-Bullion!");
check("reveal logged (name only)", /Revealed a shared login/.test(psql("SELECT string_agg(action || ' ' || detail, ';') FROM audit_log WHERE module = 'Quick Links'"))
  && !psql("SELECT string_agg(detail, ';') FROM audit_log").includes("S3cret"));
check("javascript: links refused", (await api("/api/links", { title: "x", url: "javascript:alert(1)" })).status === 400);
await page.screenshot({ path: "shot-shop-links.png" });

// A clerk: sees shared links, can't reveal the login, can't edit; a link only for the owner is hidden
const p2 = await (await browser.newContext()).newPage(); await p2.goto(BASE); await p2.waitForTimeout(800);
const api2 = apiOn(p2);
await api2("/api/auth/signup", { firstName: "Pat", lastName: "Clerk", email: "pat@shop.example", division: "Administration", password: PW });
const pat = psql("SELECT id FROM users WHERE email = 'pat@shop.example'");
const ap = await api("/api/auth/approve", { id: pat, role: "user", division: "Administration" });
const me = psql("SELECT id FROM users WHERE email = 'owner@shop.example'");
await api("/api/links", { title: "Bank", url: "https://bank.example.com", category: "Money", visibleTo: [{ kind: "user", id: me, name: "Laura Owner" }] });
await api("/api/links", { title: "Shipping", url: "https://ship.example.com", category: "Suppliers", login: { user: "ship", password: "pw1" }, loginTo: [{ kind: "user", id: pat, name: "Pat Clerk" }] });
await api2("/api/auth/login", { email: "pat@shop.example", password: PW });
L = (await api2("/api/links")).body;
check("clerk sees shared links, not the owner's bank", ap.status === 200 && L.links.some(l => l.title === "Coin supplier portal") && !L.links.some(l => l.title === "Bank") && !L.canEdit && !L.people,
  JSON.stringify(L).slice(0, 200));
const sid = L.links.find(l => l.title === "Coin supplier portal").id, shipId = L.links.find(l => l.title === "Shipping").id;
check("clerk can't reveal a login not shared with them", (await api2(`/api/links/${sid}/reveal`, {})).status === 403 && L.links.find(l => l.title === "Coin supplier portal").canReveal === false);
check("clerk reveals the login shared with them", (await api2(`/api/links/${shipId}/reveal`, {})).body?.password === "pw1");
check("clerk can't add or remove links", (await api2("/api/links", { title: "x", url: "https://x.example" })).status === 403 && (await api2(`/api/links/${sid}/remove`, {})).status === 403);
check("clerk sees the ticker too", (await api2("/api/spot")).body?.metals?.length === 4);

// Personal logins (one per person, e.g. a reporting site): only that person can see theirs, not even the owner
const lo = (await api("/api/links", { title: "Reporting site", url: "https://reporting.example.com", category: "Compliance", personal: true })).body.id;
check("clerk saves their own login", (await api2(`/api/links/${lo}/my-login`, { user: "clerk-1", password: "Clerk-pw-9" })).status === 200);
check("owner can't see the clerk's login", (await api(`/api/links/${lo}/reveal`, {})).status === 404);
check("clerk sees their own", (await api2(`/api/links/${lo}/reveal`, {})).body?.password === "Clerk-pw-9");
check("personal login stored encrypted", !psql("SELECT string_agg(secret, ';') FROM quick_link_logins").includes("Clerk-pw"));
await page.goto(BASE); await page.waitForTimeout(1500);
await page.locator("nav button", { hasText: "Quick Links" }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Save my login for Reporting site" }).click();
await page.getByLabel("Your user name").fill("owner-1"); await page.getByLabel("Your password").fill("Owner-pw-7");
await page.getByRole("button", { name: "Save my login" }).click(); await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Show my login for Reporting site" }).click(); await page.waitForTimeout(700);
check("owner saves and sees their own", /Owner-pw-7/.test(await page.getByRole("group", { name: "Login for Reporting site" }).innerText()));
check("each person's login is separate", (await api2(`/api/links/${lo}/reveal`, {})).body?.password === "Clerk-pw-9");
check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
