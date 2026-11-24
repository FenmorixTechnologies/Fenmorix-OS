// Comms statistics "Which calls count" (agency + zone, blanks left out) and Active calls pending cleanup. Run with
// CAD_STATS_TEST_FILE=stats-scope.json CAD_STATS_START=2026-11-01 CAD_STATS_START_DELAY_SECONDS=1. Fictional data only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });

// ---- Active calls: pending calls (pure function) ----
const { mergeCalls } = await import("/home/claude/testrun/app/server/cad.js");
const ago = m => new Date(Date.now() - m * 60e3).toISOString();
const row = (id, mins, extra = {}) => ({ incident_id: id, incident_number: id, call_type: "MEDICAL", address: "100 Sample St", received_at: ago(mins), ...extra });
let m = mergeCalls([row("A", 4), row("B", 12, { address: "200 Other Rd" }), row("C", 3, { call_type: "", address: "300 Third Ave" }),
  row("D", 180, { units: "EG613:On scene", address: "400 Fourth St" })]);
const ids = m.calls.map(c => c.number).sort().join(",");
check("pending 4 min is shown, pending 12 min is left off (10-minute default)", ids.includes("A") && !ids.includes("B"), ids);
check("a pending call with no call type is left off (duplicate / linked / test)", !ids.includes("C") && m.stats.untypedPending === 1, JSON.stringify(m.stats));
check("a call with units stays however long it has been", ids.includes("D"));
m = mergeCalls([row("B", 12, { address: "200 Other Rd" })], 24, 0.5);
check("a longer setting keeps it", m.calls.length === 1);

// ---- Comms statistics ----
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message));
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(350); };
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => { const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, opts]);
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await page.goto(BASE); await settle();
for (let i = 0; i < 40; i++) { const r = await api("/api/stats/meta"); if (r.body?.total >= 14 && !r.body.running) break; await page.waitForTimeout(500); }
const q = "from=2026-11-01&to=2026-11-10";
const count = async () => (await api(`/api/stats/overview?${q}`)).body?.kpis?.incidents?.value;
let meta = (await api("/api/stats/meta")).body;
check("all 14 sample calls stored", meta.total === 14, meta.total);
check("blanks left out by default (no agency, no call type): 11 count", await count() === 11, await count());
let ad = (await api("/api/stats/admin")).body;
check("admin lists every agency and zone", ad.areas.length === 7 && ad.areas.some(a => a.agency === "Zachary FD" && a.zone === "1389I"), JSON.stringify(ad.areas.map(a => a.agency + "/" + a.zone)));
check("zone stored on the calls", execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "SELECT count(*) FROM cad_incidents WHERE zone = '1213'"`).toString().trim() === "4");

// UI: Data & settings > Which calls count
await page.getByRole("button", { name: /Comms Statistics|Communications Statistics/ }).first().click().catch(() => {}); await settle();
await page.goto(BASE); await settle();
await page.locator("nav button", { hasText: /Statistics/ }).first().click(); await settle();
await page.locator("nav button", { hasText: "Data & settings" }).first().click(); await settle();
const card = page.getByRole("region", { name: "Which calls count" });
check("Which calls count card shows", await card.count() === 1);
await card.getByLabel("Only the agencies and zones checked below").check();
await card.getByLabel("Zones to check").fill("1213, 1389l 1389I");
await card.getByRole("button", { name: "Check these zones" }).click();
check("zones checked by number", await card.getByLabel("Baton Rouge FD zone 1213").isChecked() && await card.getByLabel("Zachary FD zone 1389L").isChecked()
  && await card.getByLabel("Zachary FD zone 1389I").isChecked() && !(await card.getByLabel("Baton Rouge FD zone 1101").isChecked()) && !(await card.getByLabel("Pride FD zone 1400").isChecked()));
check("estimate shown", /About 6 of 14/.test(await card.innerText()), (await card.innerText()).match(/About.*/)?.[0]);
await card.getByRole("button", { name: "Save" }).click(); await settle();
check("only BR 1213 + Zachary 1389L/1389I count now (blank-type 1213 call left out): 6", await count() === 6, await count());
meta = (await api("/api/stats/meta")).body;
check("agency picker lists only the counted agencies", meta.agencies.map(a => a.agency).sort().join("|") === "Baton Rouge FD|Zachary FD", meta.agencies.map(a => a.agency).join("|"));
const ov = (await api(`/api/stats/overview?${q}`)).body;
check("no blank agency or nature in the report tables", !ov.agencies.some(a => a.agency === "(none)") && !ov.natures.some(n => !n.nature));
check("last-year comparison runs with the filter", ov.kpis.incidents.ly === 0);
check("people and volume pages work with the filter", (await api(`/api/stats/volume?${q}`)).status === 200 && (await api(`/api/stats/people?${q}&role=takers`)).status === 200 && (await api(`/api/stats/calltaking?${q}`)).status === 200);
// whole agency
await post("/api/stats/admin/scope", { include: [{ agency: "Pride FD", zone: "*" }], dropBlank: true });
check("a whole agency can be picked", await count() === 2, await count());
await post("/api/stats/admin/scope", { include: [], dropBlank: false });
check("back to every call (blanks too): 14", await count() === 14, await count());
await post("/api/stats/admin/scope", { include: [{ agency: "Baton Rouge FD", zone: "1213" }, { agency: "Zachary FD", zone: "1389L" }, { agency: "Zachary FD", zone: "1389I" }], dropBlank: true });
const pd = (await api(`/api/stats/people?${q}&role=dispatchers`)).body;
check("calls with no dispatcher recorded are left out of the table, and counted", !pd.people.some(x => !x.cadId || /not recorded/i.test(x.name)) && pd.unrecorded === 1, JSON.stringify({ unrecorded: pd.unrecorded, people: pd.people.map(x => x.cadId) }));
check("audited", /Changed which calls count/.test(execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "SELECT action FROM audit_log WHERE module = 'Comms statistics' ORDER BY id DESC LIMIT 1"`).toString()));
await page.goto(BASE); await settle();
await page.locator("nav button", { hasText: /Statistics/ }).first().click(); await settle();
await page.locator("nav button", { hasText: "Data & settings" }).first().click(); await settle();
check("saved choice shows after reload", await page.getByRole("region", { name: "Which calls count" }).getByLabel("Zachary FD zone 1389I").isChecked());
check("no page errors", !errors.length, errors.join(" | "));
await browser.close();
done();
process.exit(0);
