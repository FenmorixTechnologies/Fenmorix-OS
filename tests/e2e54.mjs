// Sandbox: demo department, sandbox banner and branding (no St. George anywhere), sign-up asks for the department,
// Investigations off, made-up active calls, demo Comms statistics, generic forms/evaluations only. Fictional data only.
// Run with: SANDBOX=on CAD_STATS_TEST_FILE=/home/claude/testrun/demo-calls.json CAD_STATS_UNITS_TEST_FILE=/home/claude/testrun/demo-units.json
//           CAD_STATS_START=<first day> CAD_STATS_START_DELAY_SECONDS=1  (then this test runs seed-demo.mjs itself)
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3077", PW = "Correct horse battery", APP = "/home/claude/testrun/app";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const STGEORGE = /St\.? George|SGFD|stgeorgefire/i;

// Seed (and the safety check: refuses without SANDBOX)
let out = "";
try { out = execSync(`cd ${APP} && SANDBOX= node scripts/sandbox/seed-demo.mjs 2>&1`).toString(); } catch (e) { out = String(e.stdout || ""); }
check("seed refuses on a non-sandbox", /only runs on a sandbox/.test(out), out);
out = execSync(`cd ${APP} && SANDBOX=on node scripts/sandbox/seed-demo.mjs 2>&1`).toString();
check("seed adds the demo department", /Demo department added: \d+ people/.test(out), out);
out = execSync(`cd ${APP} && SANDBOX=on node scripts/sandbox/seed-demo.mjs 2>&1`).toString();
check("seed runs only once", /already there/.test(out), out);
check("St. George's PIAL grading isn't in the sandbox", psql("SELECT (data ? 'baseline')::text FROM pial_settings") === "false");
check("only generic forms and programs", psql("SELECT string_agg(key, ',' ORDER BY key) FROM form_definitions") === "demo_damage,demo_ridealong,demo_supply"
  && psql("SELECT string_agg(key, ',') FROM eval_programs") === "demo-officer" && !/co-|bc-/.test(psql("SELECT string_agg(key, ',') FROM sim_scenarios")));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const body = () => page.locator("body").innerText();

// ---- First admin (first-run works from this computer only), then look at the signed-out page ----
await page.goto(BASE); await page.waitForTimeout(800);
let r = await api("/api/auth/first-run", { name: "Sandy Admin", email: "sandy@sandbox.example", password: PW });
check("first admin made", r.status === 200, JSON.stringify(r.body));
await ctx.clearCookies();
await page.goto(BASE); await page.waitForTimeout(2500);
let b = await body();
check("sign-in page: sandbox banner and demo department name", await page.getByRole("note", { name: "Sandbox notice" }).count() === 1 && /Demo Fire District/.test(b) && /made up/.test(b), b.slice(0, 300));
check("tab title is the sandbox app name", (await page.title()) === "Fenmorix OS");
check("no St. George on the sign-in page", !STGEORGE.test(b) && !STGEORGE.test(await page.content()), (b.match(STGEORGE) || [])[0]);
const logo = await page.evaluate(async () => new Uint8Array(await (await fetch("/logo-large.png")).arrayBuffer()).length);
check("logo comes from the sandbox set", logo === fs.statSync(`${APP}/public/brand-fenmorix/logo-large.png`).size, logo);
const manifest = await page.evaluate(async () => (await fetch("/manifest.webmanifest")).json().catch(() => ({})));
check("app manifest carries the sandbox name", manifest.name === "Fenmorix OS" && !STGEORGE.test(JSON.stringify(manifest)), JSON.stringify(manifest).slice(0, 120));

// ---- Request an account: department required ----
await page.getByRole("button", { name: "Request an account" }).click(); await page.waitForTimeout(500);
check("sign-up asks for their department", await page.getByLabel("Your department or agency").count() === 1);
r = await api("/api/auth/signup", { firstName: "Tess", lastName: "Tester", email: "tess@lakeview.example", division: "Suppression", password: PW });
check("department is required on a sandbox", r.status === 400 && /department or agency/.test(r.body?.error || ""), JSON.stringify(r.body));
await page.getByLabel("First name").fill("Tess"); await page.getByLabel("Last name").fill("Tester");
await page.getByLabel("Work email").fill("tess@lakeview.example"); await page.getByLabel("Your department or agency").fill("Lakeview Fire Department");
await page.locator("select").first().selectOption("Suppression");
await page.getByLabel("Password", { exact: true }).fill(PW); await page.getByLabel("Confirm password").fill(PW);
await page.getByRole("button", { name: "Request account" }).click(); await page.waitForTimeout(1200);
check("request sent", /your request is in/i.test(await body()));
check("department saved with the request", psql("SELECT signup_org FROM users WHERE email = 'tess@lakeview.example'") === "Lakeview Fire Department");

// ---- Sign in as the admin ----
await page.goto(BASE); await page.waitForTimeout(1200);
await page.getByLabel(/^Email/).fill("sandy@sandbox.example"); await page.getByLabel(/^Password/).fill(PW);
await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(2500);
b = await body();
check("signed in: banner on the page", await page.getByRole("note", { name: "Sandbox notice" }).count() === 1);
check("no Investigations tile", !/Investigations/.test(await page.getByRole("navigation").first().innerText()));
check("Investigations API is off", (await api("/api/inv/cases")).status === 404);
const acc = (await api("/api/auth/accounts")).body.accounts;
check("accounts list shows where Tess is from", acc.find(a => a.email === "tess@lakeview.example")?.organization === "Lakeview Fire Department");
await page.waitForTimeout(16000);    // first CAD check
r = await api("/api/cad/active");
check("made-up active calls", r.status === 200 && (r.body.calls || []).length > 0 && r.body.calls.every(c => /Demo/.test(c.city || "Demo")), JSON.stringify(r.body).slice(0, 300));
await page.goto(BASE); await page.waitForTimeout(2500);
check("Your Day shows the demo calls", /EG1\d1|MD1\d1|LD1\d1/.test(await body()));
await page.screenshot({ path: "shot-sandbox-home.png" });

// ---- Every section: opens without errors, never says St. George ----
const tiles = await page.locator("nav button").allInnerTexts();
const names = [...new Set(tiles.map(t => t.split("\n")[0].trim()).filter(t => t && !/^(Home|Main menu|Change password|Sign out|Signed-in devices)$/.test(t)))];
const leaks = [];
for (const n of names) {
  await page.goto(BASE); await page.waitForTimeout(1200);
  await page.locator("nav button", { hasText: n }).first().click().catch(() => {});
  await page.waitForTimeout(1600);
  const t = await body();
  const m = t.match(STGEORGE) || t.match(/\bNexus\b/);
  if (m) leaks.push(`${n}: …${t.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, " ")}…`);
}
check(`${names.length} sections open with no St. George / SGFD / Nexus text`, names.length >= 15 && !leaks.length, leaks.join(" | ") || names.join(", "));

// ---- Comms statistics have demo data ----
for (let i = 0; i < 40 && !(Number(psql("SELECT count(*) FROM cad_incidents")) > 20000); i++) await page.waitForTimeout(3000);
check("demo calls loaded into Comms statistics", Number(psql("SELECT count(*) FROM cad_incidents")) > 20000 && Number(psql("SELECT count(*) FROM cad_unit_responses")) > 1000,
  psql("SELECT count(*) FROM cad_incidents"));
const board = (await api(`/api/board/data?from=2026-10-01&to=2026-10-31`));
check("Board Report finds the demo department's calls", board.status === 200 && JSON.stringify(board.body).includes("DEMO FD"), JSON.stringify(board.body).slice(0, 200));

// ---- Sick leave has a demo history; requisitions in every stage ----
check("sick leave history for the demo crews", Number(psql("SELECT count(*) FROM sick_entries")) > 40);
check("requisitions in every stage", psql("SELECT count(DISTINCT status) FROM requisitions") === "6");

// ---- Reset: export keeps real sign-ups, not demo people ----
const f = "/home/claude/testrun/sandbox-accounts.json";
execSync(`cd ${APP} && SANDBOX=on node scripts/sandbox/seed-demo.mjs --export-accounts ${f}`);
const saved = JSON.parse(fs.readFileSync(f, "utf8"));
check("reset keeps real sign-ups only", saved.length === 2 && saved.some(a => a.email === "tess@lakeview.example") && !saved.some(a => /demo\.example\.org/.test(a.email)), saved.map(a => a.email).join(","));
fs.rmSync(f);

check("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
await browser.close();
done();
process.exit(0);
