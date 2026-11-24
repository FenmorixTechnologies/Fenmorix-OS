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


// PIAL tracker
const num = s => Number(psql(s));
const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
const fsx = await import("node:fs/promises");
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e, d] of [["Tara Training", "tara", "Training"], ["Sam Suppression", "sam", "Suppression"], ["Vic Viewer", "vic", "Administration"], ["Nobody Else", "nobody", "Technology"]]) {
  const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: d, password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: a.division || "Training" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
check("grant: Training edit, own division", (await post("/api/access/grants", { section: "pial", level: "edit", userId: uid("Tara Training"), scope: ["Training"] })).status === 200);
await post("/api/access/grants", { section: "pial", level: "edit", userId: uid("Sam Suppression"), scope: ["Suppression"] });
await post("/api/access/grants", { section: "pial", level: "view", userId: uid("Vic Viewer"), scope: "all" });

// Empty tracker
let d = (await api("/api/pial")).body;
check("empty tracker = 2025 PIAL grading (91.18, Class 1)", d.items.length === 56 && Math.abs(d.score - 91.18) < 0.006 && d.cls === 1 && Math.abs(d.divergence - 2.37) < 0.006 && d.items.every(i => i.method === "last grading"), `${d.items.length} items, score ${d.score}`);
check("2025 section totals", ["9.76", "41.48", "37.93", "3.88"].join() === d.sections.map(s => s.credit.toFixed(2)).join() && d.training === 9, d.sections.map(s => s.credit).join());
check("divergence makes FD points worth 1.4, water 0.5", d.pointValue.fd === 1.4 && d.pointValue.water === 0.5 && d.waterAhead);
check("benchmark + recommendation on items", /Station 65/.test(d.items.find(i => i.key === "f549").last.rec) && d.items.find(i => i.key === "w630b").last.raw === "2.40 of 3");
check("section maxima", d.sections.map(s => s.max).join() === "10,50,40,5.5");

// Roster import through the UI (preview, then import)
await page.reload(); await settle();
await tile("PIAL Tracker");
await page.getByText("Minimum criteria").first().waitFor({ timeout: 10000 });
check("scorecard renders", /Estimated score/i.test(await body()) && /Class 1\b/.test(await body()) && /Where the last grading lost points/.test(await body()) && /Improvement window closes Dec 1, 2026/.test(await body()));
await page.getByRole("button", { name: "FireWorks imports" }).click(); await settle();
await page.getByLabel("Membership roster file").setInputFiles("pial/roster.csv"); await settle();
await page.getByText(/row\(s\) ready/).first().waitFor({ timeout: 8000 });
check("roster preview", /41 row\(s\) ready/.test(await body()) && /Matched columns: employee_id, first, last/.test(await body()), (await body()).match(/\d+ row\(s\) ready[^.]*\./)?.[0]);
await page.getByRole("button", { name: /Import 41 rows/ }).click(); await settle();
check("roster imported", num("SELECT count(*) FROM pial_members") === 41 && num("SELECT count(*) FROM pial_members WHERE officer") === 12 && num("SELECT count(*) FROM pial_members WHERE driver") === 8);
const imp = async (kind, file) => post(`/api/pial/import/${kind}`, { fileName: file, text: await fsx.readFile(`pial/${file}`, "utf8") });
let r = await imp("certs", "certs.csv"); check("certs imported", r.status === 200 && r.body.rows === 96, JSON.stringify(r.body).slice(0, 120));
r = await imp("training", "training.csv"); check("training imported", r.status === 200 && r.body.rows === 1354, JSON.stringify(r.body).slice(0, 160));
r = await imp("training", "training.csv"); check("re-import replaces, no duplicates", num("SELECT count(*) FROM pial_training") === 1354 && /replaced 1354/.test(r.body.notes));
r = await imp("fires", "fires.csv"); check("fires imported", r.body.rows === 26 && num("SELECT count(*) FROM pial_fires WHERE working") === 18);
r = await post("/api/pial/import/tests", { fileName: "tests.csv", text: await fsx.readFile("pial/tests.csv", "utf8"), preview: true });
check("tests preview flags bad row", r.body.rows === 25 && r.body.errors.some(e => /Row 27: unknown type "Widget"/.test(e)), JSON.stringify(r.body.errors));
r = await imp("tests", "tests.csv"); check("tests imported, duplicate skipped", num("SELECT count(*) FROM pial_tests") === 24 && r.body.skipped === 2, JSON.stringify(r.body).slice(0, 160));
check("bad header refused", (await post("/api/pial/import/training", { fileName: "x.csv", text: "foo,bar\n1,2" })).status === 400);

// Apparatus
const fullEngine = { suction: 1, preconnect: 400, master: 1, playpipe: 1, nozzle15: 2, nozzle25: 1, scba: 4, cylinders: 4, salvage: 2, handlights: 2, clamp: 1, gate: 1, wye: 1, radioMounted: 1, radioPortable: 1, ext24: 1, roof12: 1 };
for (const u of ["E61", "E62", "E63"]) await post("/api/pial/apparatus", { unit: u, type: "engine", station: u.slice(1, 3), pumpGpm: 1500, tankGal: u === "E62" ? 500 : 750, inventory: u === "E62" ? { ...fullEngine, scba: 2 } : fullEngine });
await post("/api/pial/apparatus", { unit: "L61", type: "ladder", station: "61", aerialFt: 75, inventory: { scba: 4, cylinders: 4, salvage: 6, generator: 6, flood: 3, ejector: 1, cutting: 1, saw: 1, handlights: 4, pike3: 2, pike6: 4, radioMounted: 1, radioPortable: 1, ext24: 1, combo14: 1, roof16: 1, attic10: 1, ext35: 1, roof16b: 1, elevStream: 1, bigNozzle: 1 } });
check("duplicate unit refused", (await post("/api/pial/apparatus", { unit: "e61", type: "engine" })).status === 409);
const ap = (await api("/api/pial/apparatus")).body.apparatus;
const eq = u => ap.find(a => a.unit === u).equipment;
check("E61 fully equipped = 100%", near(eq("E61").pct, 1, 1e-9), eq("E61").pct);
// E62: tank 500 -> 30 pts (capped), SCBA 2/4 -> 48 of 96 -> 552/600
check("E62 short SCBA = 552/600", near(eq("E62").earned, 552, 0.01), eq("E62").earned);
// E63: pumps 2026/2025/2022 -> gaps 12, 36 months -> 2 yrs -> 75 of 100
check("E63 pump interval 2 yrs = 575/600", near(eq("E63").earned, 575, 0.01) && eq("E63").lines.find(l => l.key === "pumpTest").have === 2, eq("E63").earned);
// L61: aerial 75' of 100' needed -> 150 of 200
check("L61 aerial reach prorated", near(eq("L61").lines.find(l => l.key === "aerial").earned, 150) && near(eq("L61").earned, 722, 0.01), eq("L61").earned);

d = (await api("/api/pial")).body;
const it = k => d.items.find(i => i.key === k);
check("engines 513 = 6 × avg equipment", near(it("f513").credit, 6 * (600 + 552 + 575) / 1800, 0.002), it("f513").credit);
check("reserve pumpers: 3 engines need 1, none -> 0", it("f523").credit === 0 && /need 1 reserve/.test(it("f523").detail[0]));
check("hydrant inspection 2026/2025/2023 -> 2 yrs -> 20 of 50 × 4 (FSRS 630A)", near(it("w630a").credit, 4 * 20 / 50, 0.002), it("w630a").credit);
check("flow tests every 5 yrs, no marking -> 40 of 50 × 3 (FSRS 630B)", near(it("w630b").credit, 3 * 40 / 50), it("w630b").credit);
check("SOPs: 2 of 10 within 5 yrs", near(it("o710").credit, 0.2) && /Fire Suppression/.test(it("o710").warn[0]), it("o710").detail[0]);
check("officer cert 9 of 12 officers", near(it("t580c1").credit, 0.54 * 0.75, 0.001), it("t580c1").detail[0]);
const mcount = num("SELECT count(*) FROM pial_members WHERE end_date IS NULL OR end_date >= '2026-01-01'");
const ims = num("SELECT count(DISTINCT member_key) FROM pial_certs WHERE title ILIKE '%ICS-100%' AND member_key IN (SELECT key FROM pial_members WHERE end_date IS NULL OR end_date >= '2026-01-01')");
check("IMS from ICS-100 certs", near(it("o720").credit, ims / mcount, 0.001), `${it("o720").credit} vs ${ims}/${mcount}`);
check("fire stats", d.fireStats.alarms === 26 && d.fireStats.working === 18 && near(d.fireStats.p320, 100 * 14 / 26, 0.01), JSON.stringify(d.fireStats));
check("minimum: 4 responders met, training not met", d.minimum.find(m => m.key === "membership").ok === true && d.minimum.find(m => m.key === "training").ok === false);
check("deployment from fire reports", it("f561").method.startsWith("CAD") && /320 s of dispatch on 53.85%/.test(it("f561").detail[0]), it("f561").detail.join(" | "));
// Company training for one member, recomputed from the CSV
const csv = (await fsx.readFile("pial/training.csv", "utf8")).trim().split(/\r?\n/).slice(1).map(l => l.split(","));
const tr = (await api("/api/pial/training")).body;
const row1 = tr.rows.filter(x => x.outside > 0 && x.cbt > 0).sort((a, b) => b.companyCredited - a.companyCredited)[0];
const mine = csv.filter(c => c[0] === row1.key);
const hrs = h => (/:/.test(h) ? +h.split(":")[0] + +h.split(":")[1] / 60 : +h);
const comp = c => /Company Drill|Online CE|LSU FETI/.test(c[4]);
const months = {};
for (const c of mine.filter(comp)) { const m = (months[c[2].slice(0, 7)] = months[c[2].slice(0, 7)] || { inh: 0, cbt: 0, out: 0 }); m[c[7] === "In-House" ? "inh" : c[7] === "Online" ? "cbt" : "out"] += hrs(c[3]); }
const expected = Object.values(months).reduce((a, m) => a + Math.min(16, m.inh + Math.min(m.cbt, 8) + m.out / 2), 0);
const inh = mine.filter(c => comp(c) && c[7] === "In-House").length, cbt = mine.filter(c => comp(c) && c[7] === "Online").length, out = mine.filter(c => comp(c) && c[7] === "Outside").length;
check("company credited: per month min(16, in-house + min(CBT, 8) + outside/2)", inh > 0 && cbt > 0 && out > 0 && near(row1.companyCredited, expected, 0.011), `${row1.key}: ${row1.companyCredited} vs ${expected}`);
check("unknown member flagged", tr.unknownCount === 1 && tr.unknownMembers[0] === "Visiting Person");
check("retired member left out", !tr.rows.some(x => x.name === "Retired Person") && tr.rows.length === 40);
check("recruit hours counted", near(tr.rows.find(x => x.key === "SG1039").recruitHrs, 240));
const totals = d.sections.reduce((a, s) => a + s.credit, 0) - d.divergence + d.bonus;
check("total = sections − divergence", near(totals, d.score, 0.002) && near(d.divergence, 0.5 * Math.abs(0.8 * d.sections[1].credit - d.sections[2].credit), 0.002));
check("class from score", d.cls === (d.score >= 90 ? 1 : 10 - Math.floor(d.score / 10)));
check("unmapped categories auto-mapped", num("SELECT count(*) FROM pial_category_map") >= 7 && psql("SELECT category FROM pial_category_map WHERE source = 'ems ce'") === "other");

// Hydrant program extras and the Louisiana hydrant data bonus
await post("/api/pial/items/w630a", { manualPct: null, inputs: { flushing: true, pressureTest: true }, notes: "" });
await post("/api/pial/items/w630b", { manualPct: null, inputs: { marking: true }, notes: "" });
const before = (await api("/api/pial")).body;
check("flushing + pressure test -> 40 of 50", near(before.items.find(i => i.key === "w630a").credit, 3.2, 0.002));
check("marking program -> full 3", near(before.items.find(i => i.key === "w630b").credit, 3, 0.002));
await post("/api/pial/items/w2400", { manualPct: null, inputs: { submitted: true, allFields: true, coords: true }, notes: "" });
const three = (await api("/api/pial")).body;
check("hydrant bonus is all or nothing", three.bonus === 0);
await post("/api/pial/items/w2400", { manualPct: null, inputs: { submitted: true, allFields: true, coords: true, count: true }, notes: "" });
const after = (await api("/api/pial")).body;
check("hydrant bonus adds 0.50 outside water and divergence", after.bonus === 0.5 && near(after.score - three.score, 0.5, 0.002) && near(after.sections[2].credit, three.sections[2].credit, 0.001), `${three.score} -> ${after.score}`);

// Manual items, evidence, records in the UI (master)
await page.reload(); await settle(); await tile("PIAL Tracker");
await page.getByRole("button", { name: /^Water Supply/ }).first().click(); await settle();
await page.getByRole("button", { name: /^616 Supply system/ }).click();
await page.getByLabel("Estimate for 616").fill("85");
await page.getByLabel("Notes for 616").fill("Per water utility 2025 study.");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
check("manual estimate saved", near((await api("/api/pial")).body.items.find(i => i.key === "w616").credit, 25.5));
await page.getByLabel("Evidence title").fill("Water study 2025");
await page.getByLabel("Evidence file").setInputFiles({ name: "study.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") }); await settle();
await page.getByRole("link", { name: "Water study 2025" }).waitFor({ timeout: 8000 });
const evId = psql("SELECT id FROM pial_evidence LIMIT 1");
const evGet = await api(`/api/pial/evidence/${evId}`);
check("evidence stored and downloadable", evGet.status === 200 && evGet.ct === "application/pdf" && evGet.body.size === 13);
await page.getByRole("button", { name: /^Testing & reviews/ }).click(); await settle();
await page.getByLabel("Record type").selectOption("sop"); await page.getByLabel("SOP", { exact: true }).selectOption("Fire Suppression");
await page.getByLabel("Record date").fill("2026-10-01");
await page.getByRole("button", { name: "Record", exact: true }).click(); await settle();
check("SOP review recorded -> 3 of 10", near((await api("/api/pial")).body.items.find(i => i.key === "o710").credit, 0.3));
// Settings: baseline
await page.getByRole("button", { name: "PIAL settings" }).click(); await settle();
await page.getByLabel("Last grading Total score").fill("91.47"); await page.getByLabel("Last grading Class").fill("1");
await page.getByRole("button", { name: "Save settings" }).click(); await settle();
await page.getByRole("button", { name: "Scorecard" }).click(); await settle();
check("baseline edit keeps item benchmarks", /Last PIAL grading.*91\.47, Class 1/.test(await body()) && (await api("/api/pial")).body.items.find(i => i.key === "f549").last.earned === 3.46);
await page.screenshot({ path: "pial-scorecard.png", fullPage: true });

// Division permissions
await login("tara@sgfd.org");
await page.getByText("PIAL Tracker", { exact: true }).first().waitFor({ timeout: 8000 }).catch(() => {});
check("Training head sees the tile", /PIAL Tracker/.test(await body()));
check("Training can edit company training", (await post("/api/pial/items/t580b", { manualPct: null, inputs: {}, notes: "On pace" })).status === 200);
check("Training can't edit engines", (await post("/api/pial/items/f513", { manualPct: 50, inputs: {}, notes: "" })).status === 403);
check("Training can't import", (await post("/api/pial/import/training", { fileName: "x", text: "a" })).status === 403);
check("Training can record a pre-plan cycle", (await post("/api/pial/tests", { kind: "preplan", subject: "Annual", date: "2026-02-01" })).status === 200);
check("Training can't record a pump test", (await post("/api/pial/tests", { kind: "pump", subject: "E61", date: "2026-02-01" })).status === 403);
check("Training can map categories", (await post("/api/pial/categories", { source: "online ce", category: "company" })).status === 200);
check("Training can't change owners", (await post("/api/pial/items/t580b", { manualPct: null, inputs: {}, notes: "", owner: "Suppression" })).status === 403);
await tile("PIAL Tracker");
await page.getByRole("button", { name: /^Fire Department/ }).first().click(); await settle();
await page.getByRole("button", { name: /^513 Engine companies/ }).click();
check("read-only card for other division", /Owned by Suppression\. You can view it/.test(await body()));
check("no admin pages for edit level", !(await page.getByRole("button", { name: "FireWorks imports" }).count()));
await login("sam@sgfd.org");
check("Suppression can edit engines", (await post("/api/pial/items/f513", { manualPct: null, inputs: { adequacy: 90 }, notes: "" })).status === 200);
check("adequacy applied", near((await api("/api/pial")).body.items.find(i => i.key === "f513").credit, 0.9 * 6 * (600 + 552 + 575) / 1800, 0.002));
await login("vic@sgfd.org");
check("viewer reads", (await api("/api/pial")).status === 200);
check("viewer can't edit", (await post("/api/pial/items/w621", { manualPct: 50, inputs: {}, notes: "" })).status === 403);
await login("nobody@sgfd.org");
check("no permission: no tile, API 403", !/PIAL Tracker/.test(await body()) && (await api("/api/pial")).status === 403);

// Binder
await login("mike@sgfd.org"); await tile("PIAL Tracker");
await page.getByRole("button", { name: "Grader binder" }).click(); await settle();
await page.getByText("PIAL Grading Binder").first().waitFor({ timeout: 10000 });
await page.emulateMedia({ media: "print" }); await page.pdf({ path: "pial-binder.pdf", format: "Letter" }); await page.emulateMedia({ media: "screen" });
const pdf = execSync("pdftotext -layout pial-binder.pdf -").toString();
check("binder: cover, summary, items, worksheets", /PIAL Grading Binder/.test(pdf) && /Score summary/.test(pdf) && /616 Supply system/.test(pdf) && /Water study 2025/.test(pdf)
  && /Membership roster/.test(pdf) && /Working fires/.test(pdf) && /E63/.test(pdf) && !/Main menu/.test(pdf) && !/Binder options|Items for/.test(pdf), pdf.slice(0, 200));
const pages = Number(execSync("pdfinfo pial-binder.pdf | grep Pages | awk '{print $2}'").toString());
check("binder has several pages", pages >= 6, pages);
await page.getByLabel("Binder division").selectOption("Training");
await page.emulateMedia({ media: "print" }); await page.pdf({ path: "pial-binder-training.pdf", format: "Letter" }); await page.emulateMedia({ media: "screen" });
const pdf2 = execSync("pdftotext -layout pial-binder-training.pdf -").toString();
check("division binder only has its items", /Items owned by Training/.test(pdf2) && /580-B/.test(pdf2) && !/616 Supply system/.test(pdf2));
check("audit trail", num("SELECT count(*) FROM audit_log WHERE module = 'PIAL'") >= 12);

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
await browser.close();
