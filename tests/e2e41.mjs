// Comms statistics: CAD sync replaces uploaded report rows for the days it covers; full reload. Run with
// CAD_STATS_TEST_FILE=stats-mini.json CAD_STATS_START=2026-11-01 CAD_STATS_START_DELAY_SECONDS=1
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(350); };
async function api(path, opts = {}) {
  for (let i = 0; i < 3; i++) { try { return await api1(path, opts); } catch (e) { if (!/context was destroyed|navigat/.test(e.message) || i === 2) throw e; await settle(); } }
}
async function api1(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) body = await res.json(); else { const b = new Uint8Array(await res.arrayBuffer()); body = { size: b.length }; }
    return { status: res.status, body, ct };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const L = label => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await L("Email").fill(email); await L("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
const body = async () => page.locator("body").innerText();
import { execSync } from "node:child_process";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();


const num = s => Number(psql(s));
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await login("mike@sgfd.org");
for (let i = 0; i < 30 && num("SELECT count(*) FROM cad_stats_sync WHERE finished_at IS NOT NULL") === 0; i++) await page.waitForTimeout(1000);
check("backfill from CAD", num("SELECT count(*) FROM cad_incidents WHERE source = 'cad'") === 3);
// Report rows the way an upload stores them (different numbering, no people), inside and outside the CAD days
psql("INSERT INTO cad_incidents (incident_id, incident_number, agency, received_at, source) VALUES ('U1', '260000001', 'SGFD', '2026-11-04 09:00:00', 'upload'), ('U2', '260000002', 'SGFD', '2026-10-20 09:00:00', 'upload')");
check("a quick Sync now first", (await post("/api/stats/admin/sync", {})).status === 200);
for (let i = 0; i < 30 && num("SELECT count(*) FROM cad_stats_sync WHERE kind = 'manual' AND finished_at IS NOT NULL") === 0; i++) await page.waitForTimeout(500);
psql("DELETE FROM cad_stats_sync WHERE kind = 'manual'");
// The confirm is on the page now (no browser pop-up): Data & settings > Reload all > Yes, reload
await tile("Comms Statistics");
await page.getByRole("button", { name: /^Data & settings/ }).first().click(); await settle();
await page.getByRole("button", { name: "Reload all since 2026-11-01" }).click();
await page.getByRole("group", { name: "Confirm full reload" }).getByRole("button", { name: "Yes, reload" }).click(); await settle();
check("full reload starts right after a Sync now", num("SELECT count(*) FROM audit_log WHERE action = 'Started a full CAD reload'") === 1);
for (let i = 0; i < 30 && num("SELECT count(*) FROM cad_stats_sync WHERE kind = 'manual' AND finished_at IS NOT NULL") === 0; i++) await page.waitForTimeout(1000);
check("full reload covers the whole start range", psql("SELECT range_from FROM cad_stats_sync WHERE kind = 'manual'") === "2026-11-01");
check("uploaded rows on CAD days replaced; older ones kept", psql("SELECT string_agg(incident_id, ',' ORDER BY incident_id) FROM cad_incidents WHERE source = 'upload'") === "U2");
const p = await api("/api/stats/people?role=dispatchers&from=2026-11-01&to=2026-11-13");
check("dispatchers named, nothing unrecorded", p.status === 200 && p.body.people.length === 1 && p.body.people[0].cadId === "ABC", JSON.stringify(p.body).slice(0, 200));
// ---- Apparatus report (units file: CAD_STATS_UNITS_TEST_FILE) ----
const ap = async qs => (await api(`/api/stats/apparatus?${qs}`)).body;
let a1 = await ap("from=2026-11-03&to=2026-11-03");
check("units loaded by the sync", num("SELECT count(*) FROM cad_unit_responses") === 5);
check("06:30 belongs to the shift that started the day before; two assignments to one call count once",
  a1.units.length === 1 && a1.units[0].unit === "EG613" && a1.units[0].calls === 1 && a1.units[0].arrived === 1 && a1.units[0].busySeconds === 3600 + 300, JSON.stringify(a1.units));
let a2 = await ap("from=2026-11-03&to=2026-11-06");
check("range: per unit, per shift, other agencies' units left out by default", a2.units.map(u => `${u.unit}:${u.calls}`).join(",") === "EG613:2,LD618:1" && a2.days.length === 4
  && a2.units[0].byDay["2026-11-05"] === 1 && a2.units[0].perShift === 0.5, JSON.stringify(a2.units));
let a3 = await ap("from=2026-11-03&to=2026-11-06&pattern=");
check("empty filter shows every unit", a3.units.length === 3);
check("bad pattern refused", (await api("/api/stats/apparatus?from=2026-11-03&to=2026-11-03&pattern=%5B")).status === 400);
await page.getByRole("button", { name: /^Apparatus/ }).first().click(); await settle();
await page.getByLabel("Shift day").fill("2026-11-05"); await settle(); await page.waitForTimeout(600);
const apText = await page.getByRole("region", { name: /^Calls by unit/ }).innerText();
check("Apparatus page: one shift", /Thu, Nov 5/.test(apText) && /2 unit responses by 2 units/.test(apText), apText.slice(0, 300));
await page.getByRole("button", { name: "Date range" }).click(); await page.getByLabel("From shift").fill("2026-11-03"); await page.getByLabel("To shift").fill("2026-11-06"); await settle(); await page.waitForTimeout(600);
await page.screenshot({ path: "/home/claude/testrun/shot-ap.png", fullPage: true });
check("Apparatus page: date range with the per-shift table", /Calls per shift/.test(await body()) && /3 unit responses by 2 units/.test(await body()));
check("audit: full reload", num("SELECT count(*) FROM audit_log WHERE action = 'Started a full CAD reload'") === 1);
check("no page errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close(); process.exit(0);
