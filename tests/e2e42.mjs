// PIAL from CAD: agency found automatically, structure fires with unit arrivals -> 561, data sources panel. Run with
// CAD_STATS_TEST_FILE=stats-fires.json CAD_STATS_UNITS_TEST_FILE=units-fires.json CAD_STATS_START=2026-11-01 CAD_STATS_START_DELAY_SECONDS=1
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
check("CAD calls and units synced", num("SELECT count(*) FROM cad_incidents") === 7 && num("SELECT count(*) FROM cad_unit_responses") === 24);
const pial = (await api("/api/pial")).body;
check("CAD agency found automatically", pial.settings.cadAgency === "St George FD" && pial.settings.cadAgencyAuto === true);
const src = Object.fromEntries(pial.sources.map(x => [x.key, x]));
check("sources: CAD and units on, reports off", src.cad.on && src.units.on && !src.fires.on && /6 structure fires in 2026; 6 with unit times, first engine on 6, full complement \(2 engines \+ 1 ladder\/service\) on 6/.test(src.units.status), JSON.stringify(src.units));
const dep = pial.items.find(i => i.key === "f561");
check("561 uses CAD unit arrivals: first engine 5 of 6, full complement 4 of 6", /CAD unit arrivals, first engine \(6 structure fires\)/.test(dep.detail.join(" ")) && /on 83.33%/.test(dep.detail.join(" ")) && /Full complement within 560 s on 66.67%/.test(dep.detail.join(" ")), dep.detail.join(" | "));
const fires = (await api("/api/pial/fires")).body;
check("other agencies' units don't count as our first engine", fires.cadFire.list.every(f => f.firstEngineUnit === "EG613"));
check("fire responses page data", fires.cadFire.incidents === 6 && fires.cadFire.list[0].first_engine_s === 360 && fires.cadFire.list[0].full_s === 600 && fires.cadFire.list[0].units.includes("LD618"), JSON.stringify(fires.cadFire.list[0]));
await post("/api/pial/settings", { fullEngines: 1, fullLadders: 0 });
const f2 = (await api("/api/pial/fires")).body;
check("full complement rule is a setting", f2.cadFire.fullRule === "1 engine" && f2.cadFire.list[0].full_s === 360);
await page.getByText("PIAL Tracker", { exact: true }).first().click(); await settle();
check("scorecard: where the numbers come from", /Where the numbers come from: \d of 6 Nexus sources/.test(await body()));
await page.getByRole("button", { name: /^Fire responses/ }).first().click(); await settle();
const ft = await page.getByRole("region", { name: "Structure fires from CAD" }).innerText();
check("fire responses: structure fires from CAD table", /Structure fires from CAD \(6\)/.test(ft) && /EG613/.test(ft), ft.slice(0, 200));
check("no page errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close(); process.exit(0);
