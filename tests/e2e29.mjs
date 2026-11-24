// FireWorks / CAD report uploads: Excel reader for FireWorks-style workbooks (x: prefixed XML, absolute part paths,
// date-time cells), PIAL alarm processing from the Alarm Processing report (both measures, setting), PIAL imports from
// Excel with title lines, Comms Statistics uploads (with and without the CAD view), CAD records win over uploads.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
const { zip, readWorkbook } = await import("/home/claude/testrun/app/server/xlsx.js");
const BASE = "http://localhost:3077", PW = "Correct horse battery";
const SP = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

// ---- A FireWorks-style workbook (like the Alarm Processing Custom Report export) ----------------------
// 200 calls in 2026: queue->alarm under 64 s for 184 (92%), under 106 s for 196 (98%); PSAP->alarm adds 60-150 s of call talking.
const serial = iso => (Date.UTC(...iso.match(/\d+/g).map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(1899, 11, 30)) / 86400000;
const pad = n => String(n).padStart(2, "0"), hms = s => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
const calls = [];
for (let i = 0; i < 200; i++) {
  const day = `2026-${pad(1 + (i % 10))}-${pad(1 + (i % 27))}`, start = 3600 + i * 97;
  const talk = 60 + (i * 7) % 91, proc = i < 184 ? 20 + (i % 44) : i < 196 ? 70 + (i % 30) : 140;
  const psap = `${day}T${hms(start)}`, queued = `${day}T${hms(start + talk)}`, alarm = `${day}T${hms(start + talk + proc)}`;
  calls.push({ n: String(260000100 + i), day, psap, queued, alarm, talk, proc });
}
function fireworksXlsx(rows) {
  const strings = [], si = v => { let i = strings.indexOf(v); if (i < 0) { strings.push(v); i = strings.length - 1; } return i; };
  const head = ["IncidentDate", "CADNumber", "CAD Address", "PSAPTime", "Entered Queue", "AlarmTime", "Call Talking", "SG Processing", "Total Processing"];
  const cell = (ref, v, kind) => kind === "s" ? `<x:c r="${ref}" s="0" t="s"><x:v>${si(v)}</x:v></x:c>` : `<x:c r="${ref}" s="${kind}"><x:v>${v}</x:v></x:c>`;
  const L = "ABCDEFGHI";
  let xml = `<x:row r="1" spans="1:9">${head.map((h, i) => cell(`${L[i]}1`, h, "s")).join("")}</x:row>`;
  rows.forEach((c, k) => {
    const r = k + 2;
    xml += `<x:row r="${r}" spans="1:9">` + [cell(`A${r}`, serial(`${c.day}T00:00:00`), 1), cell(`B${r}`, c.n, "s"), cell(`C${r}`, `${100 + k} TEST ST`, "s"),
      cell(`D${r}`, serial(c.psap), 2), cell(`E${r}`, serial(c.queued), 2), cell(`F${r}`, serial(c.alarm), 2),
      cell(`G${r}`, hms(c.talk), "s"), cell(`H${r}`, hms(c.proc), "s"), cell(`I${r}`, hms(c.talk + c.proc), "s")].join("") + "</x:row>";
  });
  const B = s => Buffer.from("﻿" + s);
  return zip([
    { name: "xl/workbook.xml", data: B('<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Alarm Processing Custom Report" sheetId="2" r:id="rId2" /></x:sheets></x:workbook>') },
    { name: "xl/_rels/workbook.xml.rels", data: B('<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml" Id="rId3" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="/xl/styles.xml" Id="rId4" /><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId2" /></Relationships>') },
    { name: "xl/styles.xml", data: B('<?xml version="1.0" encoding="utf-8"?><x:styleSheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:numFmts count="1"><x:numFmt numFmtId="0" formatCode="" /></x:numFmts><x:cellXfs count="3"><x:xf numFmtId="0" fontId="0" /><x:xf numFmtId="14" fontId="0" /><x:xf numFmtId="22" fontId="0" /></x:cellXfs></x:styleSheet>') },
    { name: "xl/worksheets/sheet1.xml", data: B(`<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${xml}</x:sheetData></x:worksheet>`) },
    { name: "xl/sharedStrings.xml", data: B(`<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(s => `<x:si><x:t>${s}</x:t></x:si>`).join("")}</x:sst>`) },
  ]);
}
const fw = fireworksXlsx(calls);
fs.writeFileSync(`${SP}/fw-alarms.xlsx`, fw);
const sheets = readWorkbook(fw, 100000);
check("reader: FireWorks-style workbook (x: tags, /xl/ paths, Id after Target)", sheets.length === 1 && sheets[0].rows.length === 201, `${sheets.length} sheets, ${sheets[0]?.rows.length} rows`);
check("reader: date-time cells keep the time", sheets[0].rows[1][3] === calls[0].psap.replace("T", " ") && sheets[0].rows[1][0] === calls[0].day, JSON.stringify(sheets[0].rows[1]));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1" } });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, opts]);
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
const b64 = b => Buffer.from(b).toString("base64");
await page.goto(BASE); await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await ctx.clearCookies(); await page.goto(BASE); await page.waitForTimeout(700);
await page.getByLabel(/^Email/).fill("mike@sgfd.org"); await page.getByLabel(/^Password/).fill(PW); await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1500);
await post("/api/pial/settings", { year: 2026 });

// ---- PIAL: Alarm Processing report ----------------------------------------------------------------------
let r = await post("/api/pial/import/alarms", { fileName: "Rep_Alarm_Processing_Custom_Report.xlsx", data: b64(fw), preview: true });
check("PIAL preview reads the FireWorks report", r.status === 200 && r.body.rows === 200, JSON.stringify(r.body).slice(0, 300));
check("preview: queue->alarm 92% / 98%", r.body.summary?.queue.p64 === 92 && r.body.summary?.queue.p106 === 98, JSON.stringify(r.body.summary));
check("preview: PSAP->alarm much lower", r.body.summary?.total.p64 < 10, JSON.stringify(r.body.summary?.total));
check("addresses aren't kept", !JSON.stringify(r.body).includes("TEST ST"));
r = await post("/api/pial/import/alarms", { fileName: "Rep_Alarm_Processing_Custom_Report.xlsx", data: b64(fw) });
check("PIAL import", r.status === 200 && r.body.rows === 200 && psql("SELECT count(*) FROM pial_alarms") === "200", JSON.stringify(r.body));
const item = async () => (await api("/api/pial")).body.items.find(i => i.key === "c420a2");
let it = await item();
check("420-A-2 uses the FireWorks report (queue -> alarm)", it.method === "FireWorks report" && Math.abs(it.pct - 1) < 0.01 && /200 calls, 92% within 64 s/.test(it.detail.join(" ")), JSON.stringify([it.method, it.pct, it.detail]));
check("the other measure is shown too", /received at the PSAP to alarm instead/.test(it.detail.join(" ")));
await post("/api/pial/settings", { alarmMeasure: "total" });
it = await item();
check("setting: PSAP -> alarm lowers the credit", it.method === "FireWorks report" && it.pct < 0.5, JSON.stringify([it.pct, it.detail[0]]));
await post("/api/pial/settings", { alarmMeasure: "queue" });
// re-import replaces the date range (no duplicates)
await post("/api/pial/import/alarms", { fileName: "again.xlsx", data: b64(fw) });
check("re-import replaces, no duplicates", psql("SELECT count(*) FROM pial_alarms") === "200");
// a CSV export with title lines above the header, US date-times, durations only
const csv = ["Alarm Processing Custom Report", "St. George Fire,,", "", "IncidentDate,CADNumber,PSAPTime,Entered Queue,AlarmTime,Call Talking,SG Processing,Total Processing",
  "11/2/2026,260099001,11/2/2026 1:05:07 PM,11/2/2026 1:06:10 PM,11/2/2026 1:06:40 PM,00:01:03,00:00:30,00:01:33"].join("\r\n");
r = await post("/api/pial/import/alarms", { fileName: "alarms.csv", data: b64(csv), preview: true });
check("CSV with title lines and US times", r.status === 200 && r.body.rows === 1 && r.body.sample[0].process_s === 30 && r.body.sample[0].total_s === 93, JSON.stringify(r.body).slice(0, 300));
// Training from Excel with a report title above the header
const { workbook } = await import("/home/claude/testrun/app/server/xlsx.js");
const tx = workbook({ sheets: [{ name: "Training", rows: [["FireWorks Training Hours Report"], ["Run 11/9/2026"], [], ["Member", "Date", "Hours", "Category"], ["Pat Probie", "2026-03-01", 3, "Company Training"], ["Pat Probie", "2026-03-08", 2.5, "Hazmat"]] }] });
r = await post("/api/pial/import/training", { fileName: "training.xlsx", data: b64(tx), preview: true });
check("PIAL training import from Excel with a title", r.status === 200 && r.body.rows === 2, JSON.stringify(r.body).slice(0, 200));
r = await post("/api/pial/import/roster", { fileName: "x.xlsx", data: b64(workbook({ sheets: [{ name: "S", rows: [["Foo", "Bar"], [1, 2]] }] })), preview: true });
check("missing columns explained", r.status === 400 && /Missing column/.test(r.body.error), JSON.stringify(r.body));

// ---- Comms Statistics: uploads ----------------------------------------------------------------------------
let meta = (await api("/api/stats/meta")).body;
check("Comms Stats: no CAD view, no data yet", meta.configured === false && meta.total === 0, JSON.stringify(meta).slice(0, 120));
r = await post("/api/stats/admin/upload", { fileName: "fw-alarms.xlsx", data: b64(fw), preview: true });
check("upload preview (FireWorks report)", r.status === 200 && r.body.rows === 200 && r.body.hasAgency === false && r.body.columns.includes("queued"), JSON.stringify(r.body).slice(0, 300));
check("hold = queue -> alarm", r.body.sample[0].hold === calls[0].proc && r.body.sample[0].process === calls[0].talk, JSON.stringify(r.body.sample[0]));
r = await post("/api/stats/admin/upload", { fileName: "fw-alarms.xlsx", data: b64(fw) });
check("needs an agency when the file has none", r.status === 400 && /agency/i.test(r.body.error));
r = await post("/api/stats/admin/upload", { fileName: "fw-alarms.xlsx", data: b64(fw), agency: "SGFD" });
check("upload stores the calls", r.status === 200 && r.body.stored === 200 && psql("SELECT count(*) FROM cad_incidents WHERE source = 'upload' AND agency = 'SGFD'") === "200", JSON.stringify(r.body).slice(0, 200));
meta = (await api("/api/stats/meta")).body;
check("statistics work from uploads", meta.total === 200 && meta.lastDay === calls.map(c => c.day).sort().at(-1), JSON.stringify([meta.total, meta.lastDay]));
const ov = await api(`/api/stats/overview?from=2026-01-01&to=2026-12-31`);
check("overview from uploaded calls", ov.status === 200 && JSON.stringify(ov.body).includes("avgHold"), JSON.stringify(ov.body).slice(0, 160));
// A CAD export with more columns, Agency and Nature
const cad = [["Incident Number", "Agency", "Nature", "Call Received", "Dispatched", "On Scene", "Closed", "Disposition", "Call Taker"],
  ["260099500", "EBR", "MEDICAL", "1/5/2026 2:00:00 PM", "1/5/2026 2:01:10 PM", "1/5/2026 2:07:00 PM", "1/5/2026 3:00:00 PM", "TR", "CT12"],
  ["260099501", "EBR", "STRUCTURE FIRE", "1/5/2026 3:00:00 PM", "1/5/2026 3:00:40 PM", "", "", "", ""]];
r = await post("/api/stats/admin/upload", { fileName: "cad.xlsx", data: b64(workbook({ sheets: [{ name: "Export", rows: cad }] })) });
check("CAD export with Agency/Nature columns", r.status === 200 && r.body.stored === 2 && psql("SELECT nature || '|' || disposition || '|' || call_taker FROM cad_incidents WHERE incident_number = '260099500'") === "MEDICAL||CT12", JSON.stringify(r.body).slice(0, 200));
// The CAD view's record of an incident wins
psql(`INSERT INTO cad_incidents (incident_id, incident_number, agency, received_at, source) VALUES ('X-777', '260099777', 'SGFD', '2026-02-02 10:00:00', 'cad')`);
r = await post("/api/stats/admin/upload", { fileName: "dup.csv", data: b64("CADNumber,PSAPTime,AlarmTime\n260099777,2026-02-02 10:00:00,2026-02-02 10:01:00\n"), agency: "SGFD" });
check("incidents already from CAD are left alone", r.body.fromCad === 1 && r.body.stored === 0 && psql("SELECT count(*) FROM cad_incidents WHERE incident_number = '260099777'") === "1", JSON.stringify(r.body));
r = await post("/api/stats/admin/upload", { fileName: "fw-alarms.xlsx", data: b64(fw), agency: "SGFD" });
check("re-upload updates, no duplicates", r.body.stored === 200 && psql("SELECT count(*) FROM cad_incidents WHERE source = 'upload'") === "202");
// PIAL import can also send the calls to Comms Statistics
r = await post("/api/pial/import/alarms", { fileName: "alarms.csv", data: b64(csv), toStats: true, agency: "SGFD" });
check("PIAL import -> Comms Statistics too", r.status === 200 && r.body.stats?.stored === 1 && psql("SELECT hold_seconds FROM cad_incidents WHERE incident_number = '260099001'") === "30", JSON.stringify(r.body));
const hist = (await api("/api/stats/admin")).body.syncs;
check("upload history shows file and person", hist.some(s => s.kind === "upload" && s.file_name === "fw-alarms.xlsx" && s.by_name === "Mike Admin"));

// ---- UI ----------------------------------------------------------------------------------------------------
const open = async name => { await page.goto(BASE); await page.waitForTimeout(1200); await page.getByText(name, { exact: true }).first().click(); await page.waitForTimeout(1500); };
await open("PIAL Tracker").catch(() => open("PIAL"));
await page.getByRole("button", { name: /FireWorks/ }).first().click(); await page.waitForTimeout(1200);
let b = await page.locator("body").innerText();
check("PIAL FireWorks page lists Alarm processing", /Alarm processing \(FireWorks\)/.test(b) && /Excel/.test(b));
await page.getByLabel("Alarm processing (FireWorks) file").setInputFiles(`${SP}/fw-alarms.xlsx`); await page.waitForTimeout(2000);
b = await page.locator("body").innerText();
check("UI preview shows both measures", /SG Processing/.test(b) && /92\.0%|92%/.test(b) && /Also add these calls to Comms Statistics/.test(b), (b.match(/row\(s\) ready[\s\S]{0,400}/) || [])[0]);
await page.screenshot({ path: "shot-pial-fw.png", fullPage: false });
await open("Comms Statistics");
b = await page.locator("body").innerText();
check("Comms Stats shows data from uploads", /from uploaded reports/.test(b), b.slice(0, 300));
await page.getByRole("button", { name: "Data & settings" }).click(); await page.waitForTimeout(1500);
b = await page.locator("body").innerText();
check("Data & settings: upload card", /Upload a CAD or FireWorks report/.test(b) && /upload: fw-alarms.xlsx/.test(b));
await page.getByLabel("Agency for uploaded calls").fill("SGFD");
fs.writeFileSync(`${SP}/cad2.csv`, "CADNumber,PSAPTime,Entered Queue,AlarmTime\n260088001,2026-11-01 08:00:00,2026-11-01 08:01:00,2026-11-01 08:01:30\n");
await page.getByLabel("CAD report file").setInputFiles(`${SP}/cad2.csv`); await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Add 1 incident/ }).click(); await page.waitForTimeout(1500);
check("UI upload adds the call", psql("SELECT count(*) FROM cad_incidents WHERE incident_number = '260088001'") === "1");
await page.screenshot({ path: "shot-stats-upload.png", fullPage: false });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(x => x.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
