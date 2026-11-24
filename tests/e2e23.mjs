// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
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

// Comms statistics: run with CAD_STATS_TEST_FILE=stats-mock.json CAD_STATS_START=2025-01-01 CAD_STATS_START_DELAY_SECONDS=1
const num = s => Number(psql(s));
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Carla Comms", "carla"], ["Sam Nostats", "sam"]]) {
  const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Communications", password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Communications" });
const carla = psql("SELECT id FROM users WHERE full_name = 'Carla Comms'");
for (let i = 0; i < 60 && num("SELECT count(*) FROM cad_stats_sync WHERE finished_at IS NOT NULL") === 0; i++) await page.waitForTimeout(1000);
check("backfill loaded every row", num("SELECT count(*) FROM cad_incidents") === 42434 && psql("SELECT error FROM cad_stats_sync LIMIT 1") === "");

// Numbers vs the database
const F = "from=2026-09-01&to=2026-09-30";
const ov = (await api(`/api/stats/overview?${F}`)).body;
const NB = "agency <> '' AND nature <> ''";   // blanks (duplicate / linked / test records) are left out by default
const W = "received_at >= '2026-09-01' AND received_at < '2026-10-01' AND dispatched AND " + NB;
check("incidents = SQL count", ov.kpis.incidents.value === num(`SELECT count(*) FROM cad_incidents WHERE ${W}`), ov.kpis.incidents.value);
check("last year = same dates 2025", ov.kpis.incidents.ly === num(`SELECT count(*) FROM cad_incidents WHERE received_at >= '2025-09-01' AND received_at < '2025-10-01' AND dispatched AND ${NB}`));
check("P90 hold exact", Math.abs(ov.hold.p90 - num(`SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY hold_seconds)::numeric, 1) FROM cad_incidents WHERE ${W} AND hold_seconds IS NOT NULL`)) < 0.05, ov.hold.p90);
check("self-initiated calls have no hold", num("SELECT count(*) FROM cad_incidents WHERE self_initiated AND hold_seconds IS NOT NULL") === 0);
check("daily series adds up", ov.series.grain === "day" && ov.series.points.length === 30 && ov.series.points.reduce((s, p) => s + p.n, 0) === ov.kpis.incidents.value);
const sg = (await api(`/api/stats/overview?${F}&agency=SGFD&calls=all`)).body;
check("agency + all calls filter", sg.kpis.incidents.value === num(`SELECT count(*) FROM cad_incidents WHERE received_at >= '2026-09-01' AND received_at < '2026-10-01' AND agency = 'SGFD' AND ${NB}`));
check("dispositions not pulled", ov.dispositions === undefined && num("SELECT count(*) FROM cad_incidents WHERE disposition <> ''") === 0 && num("SELECT count(*) FROM cad_dispositions") === 0);
check("heatmap counts add up", ov.heatmap.reduce((s, c) => s + c.n, 0) === ov.kpis.incidents.value);
const vol = (await api(`/api/stats/volume?from=2025-01-01&to=2026-10-29`)).body;
check("long range goes weekly", vol.series.grain === "week" && vol.series.points[0].partial === true);
check("trend anchored on last loaded day", vol.anchor === "2026-10-29" && vol.trend[0].label === "Last 7 days" && vol.trend[0].n === num(`SELECT count(*) FROM cad_incidents WHERE received_at >= '2026-10-23' AND received_at < '2026-10-30' AND dispatched AND ${NB}`));
const dowSum = vol.dow.reduce((s, d) => s + d.avg * d.days, 0);
check("day-of-week averages weight by weekdays", Math.abs(dowSum - vol.total) <= 0.05 * vol.dow.reduce((s, d) => s + d.days, 0), `${dowSum} vs ${vol.total}`);
const three = (await api(`/api/stats/volume?from=2023-01-01&to=2026-10-29`)).body;
check("multi-year goes monthly", three.series.grain === "month");

// Permissions: none -> view -> edit
await login("sam@sgfd.org");
check("no permission: no tile", !/Comms Statistics/.test(await body()));
check("no permission: API refuses", (await api("/api/stats/meta")).status === 403);
await login("mike@sgfd.org");
let g = await post("/api/access/grants", { section: "stats", level: "view", userId: carla, scope: "all" });
check("grant view", g.status === 200, JSON.stringify(g.body).slice(0, 120));
await login("carla@sgfd.org");
await page.getByText("Comms Statistics", { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => {});
check("view: tile shows", /Comms Statistics/.test(await body()));
await tile("Comms Statistics");
await page.getByText("Top 10 problem natures").first().waitFor({ timeout: 10000 });
check("view: overview renders", /Incidents over time/.test(await body()) && /Hold time distribution/.test(await body()));
check("view: no people page", !(await page.getByRole("button", { name: "Call takers & dispatchers" }).count()));
check("view: people API refused", (await api(`/api/stats/people?role=dispatchers&${F}`)).status === 403);
check("view: admin refused", (await api("/api/stats/admin")).status === 403);
// filters
await page.getByLabel("Period", { exact: true }).selectOption("last7"); await page.getByLabel("Agency", { exact: true }).selectOption("ZFD");
await page.getByRole("button", { name: "Apply" }).click(); await settle();
await page.getByText("Top 10 problem natures").first().waitFor({ timeout: 10000 });
const capt = await body();
check("filter caption", /Oct 23, 2026 – Oct 29, 2026/.test(capt) && /· ZFD/.test(capt));
const zfd = num(`SELECT count(*) FROM cad_incidents WHERE received_at >= '2026-10-23' AND received_at < '2026-10-30' AND dispatched AND agency = 'ZFD' AND ${NB}`);
check("tile shows filtered count", (await page.getByRole("group", { name: "Incidents", exact: true }).innerText()).includes(zfd.toLocaleString()), zfd);
// chart/table toggle + csv
const card = page.getByRole("region", { name: "Incidents over time", exact: true });
await card.getByRole("button", { name: "Table" }).click();
check("table view", (await card.getByRole("table").count()) === 1);
const [dl] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Download .* CSV/ }).click()]);
const csv = await (await import("node:fs/promises")).readFile(await dl.path(), "utf8");
check("CSV download", dl.suggestedFilename() === "Incidents over time.csv" && csv.split("\n").length === 8 && /Period,Incidents,Last year/.test(csv), csv.slice(0, 80));
for (const nav of ["Volume & Trends", "Call-taking"]) { await page.getByRole("button", { name: nav, exact: true }).click(); await settle(); }
await page.getByText("Longest holds").first().waitFor({ timeout: 10000 });
check("call-taking renders", /By priority/.test(await body()) && /Call processing time/.test(await body()));

await login("mike@sgfd.org");
await post("/api/access/grants", { section: "stats", level: "edit", userId: carla, scope: "all" });
// Admin: describe a code, name an operator, change the goal
let ad = (await api("/api/stats/admin")).body;
check("admin has no disposition codes", ad.dispositions === undefined);
check("names from the view fill in", ad.operators.find(o => o.cad_id === "C101")?.name === "Dana Day");
await post("/api/stats/admin/operators", { cadId: "D203", name: "", userId: carla });
await post("/api/stats/admin/settings", { holdGoalSeconds: 90, tailMinutes: 10 });
check("settings validated", (await post("/api/stats/admin/settings", { holdGoalSeconds: 1, tailMinutes: 10 })).status === 400);
const ov2 = (await api(`/api/stats/overview?${F}`)).body;
check("goal change moves within-goal", ov2.kpis.withinGoal.value > ov.kpis.withinGoal.value);
check("audit logged", num("SELECT count(*) FROM audit_log WHERE module = 'Comms statistics'") >= 2);
// manual sync: no duplicates, throttled
check("sync now", (await post("/api/stats/admin/sync", {})).status === 200);
for (let i = 0; i < 60 && num("SELECT count(*) FROM cad_stats_sync WHERE kind = 'manual' AND finished_at IS NOT NULL") === 0; i++) await page.waitForTimeout(1000);
check("re-sync doesn't duplicate", num("SELECT count(*) FROM cad_incidents") === 42434 && psql("SELECT range_from FROM cad_stats_sync WHERE kind = 'manual'") > "2026-10");
check("sync throttled", (await post("/api/stats/admin/sync", {})).status === 429);

// Carla (edit): people page with the linked name
await login("carla@sgfd.org"); await tile("Comms Statistics");
await page.getByRole("button", { name: "Call takers & dispatchers" }).click(); await settle();
await page.getByRole("table", { name: "Dispatchers" }).waitFor({ timeout: 10000 });
check("people: linked account name shows", /Carla Comms/.test(await page.getByRole("table", { name: "Dispatchers" }).innerText()));
await page.getByRole("button", { name: "Call takers", exact: true }).click(); await settle();
await page.getByRole("table", { name: "Call takers" }).waitFor({ timeout: 10000 });
check("people: call takers", /Dana Day/.test(await page.getByRole("table", { name: "Call takers" }).innerText()));
check("people: no admin nav for edit", !(await page.getByRole("button", { name: /^Data & settings/ }).count()));

// Reports: build, save, print
await page.getByRole("button", { name: "Reports", exact: true }).click(); await settle();
await page.getByRole("button", { name: "Open Weekly Command Briefing" }).click(); await settle();
await page.getByLabel("Report title").fill("Carla weekly");
await page.getByLabel("Prepared by").fill("Carla Comms, Comms Supervisor");
await page.getByLabel("Section to add").selectOption("dispatchers");
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.getByRole("button", { name: "Move 1 down" }).click();
await page.getByText("Loading the numbers").first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await settle();
const paper = await page.locator(".sgfd-paper").innerText();
check("paper: letterhead + window", /ST. GEORGE FIRE PROTECTION DISTRICT/.test(paper) && /Oct 23, 2026 – Oct 29, 2026/.test(paper) && /Prepared by Carla Comms/.test(paper));
check("paper: reordered", paper.indexOf("Headline numbers") < paper.indexOf("Demand this week"));
check("paper: dispatchers block", /Dispatchers \(hold time\)/.test(paper));
await page.getByRole("button", { name: /Save as my report/ }).click(); await settle();
let reps = (await api("/api/stats/reports")).body.reports;
check("saved", reps.length === 1 && reps[0].title === "Carla weekly" && reps[0].blocks.length === 11);
await page.emulateMedia({ media: "print" });
await page.pdf({ path: "e2e23-report.pdf", format: "Letter" });
await page.emulateMedia({ media: "screen" });
const pdfText = execSync("pdftotext e2e23-report.pdf -").toString();
check("print = only the report", /Carla weekly/.test(pdfText) && /Headline numbers/.test(pdfText) && !/Report settings/.test(pdfText) && !/Main menu/.test(pdfText), pdfText.slice(0, 120));
// sharing
await login("mike@sgfd.org");
check("unshared report private", (await api("/api/stats/reports")).body.reports.length === 0);
await login("carla@sgfd.org");
const r0 = (await api("/api/stats/reports")).body.reports[0];
await post("/api/stats/reports", { ...r0, shared: true });
await login("mike@sgfd.org");
const seen = (await api("/api/stats/reports")).body.reports;
check("shared report visible to others", seen.length === 1 && seen[0].mine === false && seen[0].owner === "Carla Comms");
const copy = await post("/api/stats/reports", { ...seen[0], title: "Mike's version" });
check("saving someone else's makes a copy", copy.body.id !== r0.id && num(`SELECT count(*) FROM comms_reports WHERE id = '${r0.id}' AND title = 'Carla weekly'`) === 1);
await login("sam@sgfd.org");
check("sam still refused", (await api("/api/stats/reports")).status === 403);

psql("UPDATE cad_incidents SET call_taker = 'C2CI' WHERE incident_id IN (SELECT incident_id FROM cad_incidents WHERE received_at >= '2026-09-01' AND received_at < '2026-10-01' AND NOT self_initiated LIMIT 40)");
await login("mike@sgfd.org");
const pt = await api(`/api/stats/people?role=takers&${F}`);
const lastP = pt.body?.people?.[pt.body.people.length - 1];
check("CAD2CAD transfers on their own line at the bottom", pt.status === 200 && lastP?.transfer === true && lastP.name === "Transfer from EBR CAD (C2C)" && lastP.calls >= 30, JSON.stringify([pt.status, lastP]));
check("no page errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
await browser.close();
