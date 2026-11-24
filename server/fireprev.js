// Fire Prevention: annual periodic inspections and PIAL 1022 (Fire Prevention Staffing).
//
// The FireWorks "PIAL Annual/Periodic Inspection History" report lists every property in the inspection program (Property #,
// Address, Unit/Suite, Property Description, Neighborhood, Box, Zone, Fire District) with up to three inspection dates and
// inspectors per row (Date1/Inspector1 … DateN/InspectorN). The export repeats a property on several rows when it has
// several inspections, so rows are merged by Property # and the dates are unioned. Properties missing from a later import
// are marked inactive (kept with their history), not deleted.
//
// FSRS 1022 (2012 FSRS + Louisiana Addendum 2021): PS = 8 × (nonresidential properties inspected in the graded year ÷
// nonresidential properties), only inspections by OSFM-certified inspectors, partial records −25%, no records = no credit.
// PIAL asks for records on a sample (at least 10) and gives credit for the share that is on file and meets the annual
// criterion, so the department-wide coverage % is the best estimate. pial.js uses `coverage()` for item p1022.
//
//   GET  /api/fireprev?year=                    overview: totals, by area / station / inspector / month, PIAL estimate, imports
//   GET  /api/fireprev/properties?year&status=not|done|excluded|all&q&area&box&district&page&size
//   GET  /api/fireprev/properties/:no            one property with every inspection
//   GET  /api/fireprev/export.csv?year&status    the list above as CSV (for assigning inspections)
//   POST /api/fireprev/import                   {fileName, data (base64), preview}           (edit)
//   POST /api/fireprev/properties/:no/exclude    {excluded, reason}                           (edit)
//   POST /api/fireprev/properties/:no/inspections {day, inspector}                            (edit)  manual entry
//   POST /api/fireprev/inspections/:id/remove                                                 (edit)  manual entries only
//   GET/POST /api/fireprev/settings              {districts: {value: true|false}, excludeVacant, partialRecords, certified}  (manage)
//
// Access: section "fireprev" (view / edit / manage). Members of a division whose name has "prevention", "arson" or
// "marshal" get edit without a grant (access.js FIREPREV_DIVISION). Audit module "Fire Prevention".
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess, FIREPREV_DIVISION } from "./access.js";
import { readSheets } from "./documents.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const r1 = n => Math.round(n * 10) / 10;
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ---- Rights ---------------------------------------------------------------------------------------
async function rights(user) {
  const div = (await pool.query("SELECT d.name FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.id = $1", [user.id])).rows[0]?.name || "";
  const auto = FIREPREV_DIVISION.test(div);
  const manage = await hasAccess(pool, user, "fireprev", "manage");
  const edit = manage || auto || await hasAccess(pool, user, "fireprev", "edit");
  const view = edit || await hasAccess(pool, user, "fireprev", "view");
  return { view, edit, manage };
}

// ---- Settings ---------------------------------------------------------------------------------------
// Which Fire District values count toward PIAL: St. George and the SG sub-districts by default (and blanks, flagged);
// other departments' properties that FireWorks lists (Baton Rouge, Prairieville …) don't.
const DEFAULT_DISTRICT = /st\.?\s*george|^sg\s*-?\s*\d+$|^$/i;
export async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'fireprev'")).rows[0]?.value;
  const d = (typeof v === "string" ? JSON.parse(v) : v) || {};
  return { districts: d.districts && typeof d.districts === "object" ? d.districts : {}, excludeVacant: !!d.excludeVacant,
    partialRecords: !!d.partialRecords, certified: d.certified !== false };
}
const counts = (st, district) => (Object.prototype.hasOwnProperty.call(st.districts, district) ? !!st.districts[district] : DEFAULT_DISTRICT.test(String(district || "").trim()));
const isVacant = desc => /\bvacant\b/i.test(desc || "");

// ---- Coverage ---------------------------------------------------------------------------------------
// Every active property with its inspections in [from, to] and its latest inspection ever
async function propertyRows(from, to) {
  return (await pool.query(
    `SELECT p.property_no AS no, p.address, p.unit, p.description, p.neighborhood AS area, p.box, p.zone, p.district, p.active, p.excluded, p.exclude_reason AS "excludeReason",
            (SELECT max(day)::text FROM fp_inspections i WHERE i.property_no = p.property_no AND i.day BETWEEN $1 AND $2) AS "inYear",
            (SELECT count(*)::int FROM fp_inspections i WHERE i.property_no = p.property_no AND i.day BETWEEN $1 AND $2) AS "yearCount",
            (SELECT max(day)::text FROM fp_inspections i WHERE i.property_no = p.property_no) AS "last"
       FROM fp_properties p WHERE p.active ORDER BY p.neighborhood, p.address`, [from, to])).rows;
}
function classify(st, p) {
  if (p.excluded) return "excluded";
  if (!counts(st, p.district)) return "other";
  if (st.excludeVacant && isVacant(p.description)) return "vacant";
  return p.inYear ? "done" : "not";
}
// For pial.js (item 1022) and the overview
export async function coverage(from, to) {
  const st = await settings();
  const rows = await propertyRows(from, to);
  if (!rows.length) return null;
  const counted = rows.filter(p => ["done", "not"].includes(classify(st, p)));
  const done = counted.filter(p => p.inYear).length;
  const pct = counted.length ? done / counted.length : 0;
  const factor = !st.certified ? 0 : st.partialRecords ? 0.75 : 1;
  return { total: counted.length, inspected: done, pct, points: Math.round(8 * pct * factor * 100) / 100, factor, partialRecords: st.partialRecords, certified: st.certified,
    excluded: rows.filter(p => p.excluded).length, other: rows.filter(p => classify(st, p) === "other").length, vacant: rows.filter(p => classify(st, p) === "vacant").length };
}

const yearRange = (url) => {
  const y = Number(url.searchParams.get("year")) || Number(localToday().slice(0, 4));
  if (y < 2000 || y > 2100) throw err(400, "Pick a year.");
  return { year: y, from: `${y}-01-01`, to: `${y}-12-31` };
};

async function overview(url, r) {
  const { year, from, to } = yearRange(url);
  const st = await settings();
  const rows = await propertyRows(from, to);
  const today = localToday();
  const counted = rows.filter(p => ["done", "not"].includes(classify(st, p)));
  const done = counted.filter(p => p.inYear).length;
  const group = key => {
    const m = new Map();
    for (const p of counted) { const k = p[key] || "(none)"; const g = m.get(k) || { name: k, total: 0, done: 0 }; g.total++; if (p.inYear) g.done++; m.set(k, g); }
    return [...m.values()].map(g => ({ ...g, pct: g.total ? g.done / g.total : 0 })).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  };
  const insp = (await pool.query(
    `SELECT i.inspector, i.day::text AS day, i.property_no FROM fp_inspections i JOIN fp_properties p ON p.property_no = i.property_no
      WHERE p.active AND i.day BETWEEN $1 AND $2`, [from, to])).rows;
  const countedNos = new Set(counted.map(p => p.no));
  const byInspector = new Map(), byMonth = new Map();
  for (const i of insp) {
    if (!countedNos.has(i.property_no)) continue;
    const k = i.inspector || "(not listed)";
    const g = byInspector.get(k) || { name: k, inspections: 0, properties: new Set() };
    g.inspections++; g.properties.add(i.property_no); byInspector.set(k, g);
    const mo = i.day.slice(0, 7); byMonth.set(mo, (byMonth.get(mo) || 0) + 1);
  }
  // First inspection of the year per property, by month: how coverage built up
  const firstBy = new Map();
  for (const i of insp) if (countedNos.has(i.property_no) && (!firstBy.has(i.property_no) || i.day < firstBy.get(i.property_no))) firstBy.set(i.property_no, i.day);
  const months = Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`);
  let run = 0;
  const pace = months.map(mo => { run += [...firstBy.values()].filter(d => d.slice(0, 7) === mo).length; return { month: mo, inspections: byMonth.get(mo) || 0, covered: run }; });
  const districts = new Map();
  for (const p of rows) { const k = p.district || ""; const g = districts.get(k) || { value: k, properties: 0, counts: counts(st, k), setByHand: Object.prototype.hasOwnProperty.call(st.districts, k) }; g.properties++; districts.set(k, g); }
  const pct = counted.length ? done / counted.length : 0;
  const factor = !st.certified ? 0 : st.partialRecords ? 0.75 : 1;
  const inProgress = today >= from && today <= to;
  const elapsed = today < from ? 0 : today > to ? 1 : (Date.parse(today) - Date.parse(from) + 86400000) / (Date.parse(to) - Date.parse(from) + 86400000);
  const imports = (await pool.query(`SELECT id, file_name AS "fileName", rows, properties, added, new_properties AS "newProperties", dropped, date_from::text AS "from", date_to::text AS "to", by_name AS "by", at
                                       FROM fp_imports ORDER BY at DESC LIMIT 10`)).rows;
  return {
    year, from, to, today, inProgress, elapsed, rights: r, settings: st,
    totals: { properties: rows.length, counted: counted.length, inspected: done, notInspected: counted.length - done, pct,
      excluded: rows.filter(p => p.excluded).length, other: rows.filter(p => classify(st, p) === "other").length, vacant: rows.filter(p => classify(st, p) === "vacant").length,
      inspections: insp.filter(i => countedNos.has(i.property_no)).length },
    pial: { points: Math.round(8 * pct * factor * 100) / 100, max: 8, pct, factor, credit: Math.round(0.44 * pct * factor * 1000) / 1000, maxCredit: 0.44,
      // What it takes to finish: properties left and the pace needed per remaining week
      left: counted.length - done, weeksLeft: inProgress ? Math.max(1, Math.ceil((Date.parse(to) - Date.parse(today)) / (7 * 86400000))) : 0 },
    byArea: group("area"), byBox: group("box"),
    byInspector: [...byInspector.values()].map(g => ({ name: g.name, inspections: g.inspections, properties: g.properties.size })).sort((a, b) => b.properties - a.properties),
    pace, districts: [...districts.values()].sort((a, b) => b.properties - a.properties), imports,
  };
}

async function listProperties(url) {
  const { from, to } = yearRange(url);
  const st = await settings();
  const status = url.searchParams.get("status") || "not";
  const q = clean(url.searchParams.get("q")).toLowerCase(), area = url.searchParams.get("area") || "", box = url.searchParams.get("box") || "";
  let rows = (await propertyRows(from, to)).map(p => ({ ...p, status: classify(st, p) }));
  if (status !== "all") rows = rows.filter(p => p.status === status || (status === "excluded" && ["excluded", "other", "vacant"].includes(p.status)));
  if (area) rows = rows.filter(p => (p.area || "(none)") === area);
  if (box) rows = rows.filter(p => (p.box || "(none)") === box);
  if (q) rows = rows.filter(p => `${p.no} ${p.address} ${p.unit} ${p.description}`.toLowerCase().includes(q));
  return rows;
}

// ---- Import -----------------------------------------------------------------------------------------
const H = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const h = (rows[i] || []).map(H);
    const no = h.findIndex(x => x === "property #" || x === "property" || x === "property number" || x === "property no" || x === "property id");
    if (no >= 0 && h.some(x => /^(inspection )?date ?\d*$|^date of inspection$/.test(x))) return { i, h, no };
  }
  return null;
}
export function parseInspectionReport(rows) {
  const hdr = findHeader(rows);
  if (!hdr) throw err(400, "That doesn't look like the FireWorks inspection report: no header row with Property # and Date columns in the first 25 rows.");
  const col = (...names) => hdr.h.findIndex(x => names.includes(x));
  const c = { address: col("address", "property address", "street address"), unit: col("unit suite", "unit", "suite"), description: col("property description", "description", "occupant", "business name", "name"),
    area: col("neighborhood", "inspection area", "area"), box: col("box", "station", "first due"), zone: col("zone"), district: col("fire district", "district") };
  // Date/inspector pairs: "Date1"+"Inspector1", or a single "Date"/"Inspection Date" + "Inspector"
  const pairs = [];
  hdr.h.forEach((x, k) => {
    const m = /^(?:inspection )?date ?(\d*)$|^date of inspection$/.exec(x);
    if (!m) return;
    const n = m[1] || "";
    let ins = hdr.h.findIndex(y => y === `inspector${n}` || y === `inspector ${n}`.trim() || (!n && /^inspector( name)?$/.test(y)));
    if (ins < 0 && /^inspector/.test(hdr.h[k + 1] || "")) ins = k + 1;
    pairs.push([k, ins]);
  });
  const props = new Map();
  let dataRows = 0, bad = 0;
  const cell = (r, k) => (k >= 0 ? String(r[k] ?? "").trim() : "");
  for (const r of rows.slice(hdr.i + 1)) {
    if (!r || !r.some(v => String(v ?? "").trim())) continue;
    const no = cell(r, hdr.no).replace(/\.0+$/, "");
    if (!no) continue;
    dataRows++;
    const p = props.get(no) || { no, address: "", unit: "", description: "", area: "", box: "", zone: "", district: "", inspections: new Map() };
    for (const k of ["address", "unit", "description", "area", "box", "zone", "district"]) if (!p[k]) p[k] = clean(cell(r, c[k]), 300);
    for (const [dk, ik] of pairs) {
      let d = cell(r, dk);
      if (!d) continue;
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d);
      if (us) d = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      d = d.slice(0, 10);
      if (!DAY.test(d)) { bad++; continue; }
      const who = clean(cell(r, ik), 120);
      p.inspections.set(`${d}|${who.toLowerCase()}`, { day: d, inspector: who });
    }
    props.set(no, p);
  }
  const list = [...props.values()].map(p => ({ ...p, inspections: [...p.inspections.values()].sort((a, b) => b.day.localeCompare(a.day)) }));
  const days = list.flatMap(p => p.inspections.map(i => i.day)).sort();
  return { rows: dataRows, properties: list, from: days[0] || null, to: days[days.length - 1] || null, inspections: days.length, badDates: bad };
}

async function importReport(b, user) {
  const fileName = clean(b.fileName, 200) || "report.xlsx";
  const data = Buffer.from(String(b.data || ""), "base64");
  if (!data.length) throw err(400, "Choose the FireWorks report file.");
  if (data.length > 25 * 1024 * 1024) throw err(413, "That file is over 25 MB.");
  const sheets = readSheets(fileName, data, 100000);
  let parsed = null, lastErr = null;
  for (const sh of sheets) { try { parsed = parseInspectionReport(sh.rows); break; } catch (e) { lastErr = e; } }
  if (!parsed) throw lastErr || err(400, "No sheet in that file has the inspection report columns.");
  const existing = new Map((await pool.query("SELECT property_no, active FROM fp_properties")).rows.map(r => [r.property_no, r.active]));
  const known = new Set((await pool.query("SELECT property_no || '|' || day::text || '|' || lower(inspector) AS k FROM fp_inspections")).rows.map(r => r.k));
  const seen = new Set(parsed.properties.map(p => p.no));
  const newProps = parsed.properties.filter(p => !existing.has(p.no)).length;
  const newInsp = parsed.properties.reduce((a, p) => a + p.inspections.filter(i => !known.has(`${p.no}|${i.day}|${i.inspector.toLowerCase()}`)).length, 0);
  const dropped = [...existing].filter(([no, active]) => active && !seen.has(no)).length;
  const summary = { fileName, rows: parsed.rows, properties: parsed.properties.length, inspections: parsed.inspections, newInspections: newInsp,
    newProperties: newProps, dropped, from: parsed.from, to: parsed.to, badDates: parsed.badDates,
    districts: Object.entries(parsed.properties.reduce((m, p) => ({ ...m, [p.district]: (m[p.district] || 0) + 1 }), {})).map(([value, n]) => ({ value, properties: n })).sort((a, b) => b.properties - a.properties) };
  if (b.preview) return summary;
  if (!parsed.properties.length) throw err(400, "No properties found in that report.");
  const importId = crypto.randomUUID();
  await tx(async c => {
    for (let k = 0; k < parsed.properties.length; k += 500) {
      const chunk = parsed.properties.slice(k, k + 500);
      await c.query(
        `INSERT INTO fp_properties (property_no, address, unit, description, neighborhood, box, zone, district, active, last_seen)
         SELECT x->>'no', x->>'address', x->>'unit', x->>'description', x->>'area', x->>'box', x->>'zone', x->>'district', true, now() FROM jsonb_array_elements($1::jsonb) x
         ON CONFLICT (property_no) DO UPDATE SET address = EXCLUDED.address, unit = EXCLUDED.unit, description = EXCLUDED.description, neighborhood = EXCLUDED.neighborhood,
           box = EXCLUDED.box, zone = EXCLUDED.zone, district = EXCLUDED.district, active = true, last_seen = now()`,
        [JSON.stringify(chunk.map(({ inspections, ...p }) => p))]);
      const ins = chunk.flatMap(p => p.inspections.map(i => ({ id: crypto.randomUUID(), no: p.no, day: i.day, inspector: i.inspector })));
      if (ins.length) await c.query(
        `INSERT INTO fp_inspections (id, property_no, day, inspector, source, import_id, created_by)
         SELECT (x->>'id')::uuid, x->>'no', (x->>'day')::date, x->>'inspector', 'import', $2, $3 FROM jsonb_array_elements($1::jsonb) x
         ON CONFLICT (property_no, day, inspector) DO NOTHING`, [JSON.stringify(ins), importId, user.name]);
    }
    if (dropped) await c.query("UPDATE fp_properties SET active = false WHERE active AND NOT (property_no = ANY(string_to_array($1, chr(31))))", [[...seen].join("\u001f")].flat());
    await c.query(`INSERT INTO fp_imports (id, file_name, rows, properties, added, new_properties, dropped, date_from, date_to, by_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [importId, fileName, parsed.rows, parsed.properties.length, newInsp, newProps, dropped, parsed.from, parsed.to, user.name]);
    await audit(c, user, "Imported inspections", `${fileName}: ${parsed.properties.length} properties, ${newInsp} new inspections, ${newProps} new properties, ${dropped} no longer listed`);
  });
  return { ...summary, ok: true };
}

async function audit(c, actor, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Fire Prevention', $4, $5)`,
    [actor.id, actor.name, ROLE_LABEL[actor.role] || actor.role, action, String(detail).slice(0, 2000)]);
}

const csvCell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// ---- Routes ---------------------------------------------------------------------------------------
export async function handleFireprev(req, res, parts, user, send, jsonBody, url) {
  const r = await rights(user);
  if (!r.view) throw err(403, "Fire Prevention is open to the Fire Prevention division and people given access in User Management.");
  const what = parts[2];
  if (!what && req.method === "GET") return send(res, 200, await overview(url, r));
  if (what === "properties" && !parts[3] && req.method === "GET") {
    const rows = await listProperties(url);
    const size = Math.min(200, Math.max(10, Number(url.searchParams.get("size")) || 50)), page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    return send(res, 200, { total: rows.length, page, size, rows: rows.slice((page - 1) * size, page * size) });
  }
  if (what === "export.csv" && req.method === "GET") {
    const rows = await listProperties(url);
    const head = ["Property #", "Address", "Unit/Suite", "Property Description", "Neighborhood", "Box", "Zone", "Fire District", "Inspected this year", "Last inspection", "Status"];
    const label = { done: "Inspected", not: "Not inspected", excluded: "Left out", other: "Other district", vacant: "Vacant (not counted)" };
    const body = [head, ...rows.map(p => [p.no, p.address, p.unit, p.description, p.area, p.box, p.zone, p.district, p.inYear || "", p.last || "", label[p.status] || p.status])].map(l => l.map(csvCell).join(",")).join("\r\n");
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="inspections-${String(url.searchParams.get("status") || "not").replace(/[^a-z]/gi, "").slice(0, 20)}.csv"`, "Cache-Control": "no-store" });
    return res.end("﻿" + body);
  }
  if (what === "properties" && parts[3] && !parts[4] && req.method === "GET") {
    const no = decodeURIComponent(parts[3]);
    const p = (await pool.query(`SELECT property_no AS no, address, unit, description, neighborhood AS area, box, zone, district, active, excluded, exclude_reason AS "excludeReason",
                                        excluded_by AS "excludedBy", first_seen AS "firstSeen", last_seen AS "lastSeen" FROM fp_properties WHERE property_no = $1`, [no])).rows[0];
    if (!p) throw err(404, "That property isn't in the inspection list.");
    p.inspections = (await pool.query(`SELECT id, day::text, inspector, source, created_by AS "by" FROM fp_inspections WHERE property_no = $1 ORDER BY day DESC`, [no])).rows;
    const st = await settings();
    p.counts = counts(st, p.district); p.vacant = isVacant(p.description);
    return send(res, 200, p);
  }
  if (what === "settings" && req.method === "GET") return send(res, 200, await settings());
  if (req.method !== "POST") throw err(404, "Not found");
  if (!r.edit) throw err(403, "You can see Fire Prevention but not change it.");
  const b = await jsonBody(req);

  if (what === "import") return send(res, 200, await importReport(b, user));
  if (what === "properties" && parts[3] && parts[4] === "exclude") {
    const no = decodeURIComponent(parts[3]);
    const reason = clean(b.reason, 300);
    if (b.excluded && !reason) throw err(400, "Say why this property is left out of the count (for the grader).");
    const p = (await pool.query(`UPDATE fp_properties SET excluded = $2, exclude_reason = $3, excluded_by = $4 WHERE property_no = $1 RETURNING address`,
      [no, !!b.excluded, b.excluded ? reason : "", b.excluded ? user.name : ""])).rows[0];
    if (!p) throw err(404, "That property isn't in the inspection list.");
    await audit(pool, user, b.excluded ? "Left property out" : "Counted property again", `${no} ${p.address}${b.excluded ? `: ${reason}` : ""}`);
    return send(res, 200, { ok: true });
  }
  if (what === "properties" && parts[3] && parts[4] === "inspections") {
    const no = decodeURIComponent(parts[3]);
    const day = clean(b.day, 10), inspector = clean(b.inspector, 120);
    if (!DAY.test(day) || day > localToday()) throw err(400, "Enter the inspection date (not in the future).");
    if (!inspector) throw err(400, "Enter the inspector.");
    const p = (await pool.query("SELECT address FROM fp_properties WHERE property_no = $1", [no])).rows[0];
    if (!p) throw err(404, "That property isn't in the inspection list.");
    const ins = await pool.query(`INSERT INTO fp_inspections (id, property_no, day, inspector, source, created_by) VALUES ($1, $2, $3, $4, 'manual', $5) ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), no, day, inspector, user.name]);
    if (!ins.rowCount) throw err(409, "That inspection is already on file.");
    await audit(pool, user, "Recorded inspection", `${no} ${p.address}: ${day} by ${inspector}`);
    return send(res, 200, { ok: true });
  }
  if (what === "inspections" && isUuid(parts[3]) && parts[4] === "remove") {
    const i = (await pool.query("DELETE FROM fp_inspections WHERE id = $1 AND source = 'manual' RETURNING property_no, day::text, inspector", [parts[3]])).rows[0];
    if (!i) throw err(400, "Only inspections entered here can be removed; imported ones come from FireWorks.");
    await audit(pool, user, "Removed inspection", `${i.property_no}: ${i.day} by ${i.inspector}`);
    return send(res, 200, { ok: true });
  }
  if (what === "settings") {
    if (!r.manage) throw err(403, "Only Fire Prevention managers can change these settings.");
    const cur = await settings();
    const districts = {};
    for (const [k, v] of Object.entries(b.districts && typeof b.districts === "object" ? b.districts : cur.districts)) districts[clean(k, 120)] = !!v;
    const next = { districts, excludeVacant: b.excludeVacant ?? cur.excludeVacant, partialRecords: b.partialRecords ?? cur.partialRecords, certified: b.certified ?? cur.certified };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('fireprev', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(next)]);
    await audit(pool, user, "Changed settings", `Counted districts: ${Object.entries(districts).filter(([, v]) => v).map(([k]) => k || "(blank)").join(", ") || "defaults"}; vacant ${next.excludeVacant ? "left out" : "counted"}; partial records ${next.partialRecords ? "yes (−25%)" : "no"}; certified inspectors ${next.certified ? "yes" : "no"}`);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}
