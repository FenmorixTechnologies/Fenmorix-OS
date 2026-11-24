// Board report: an operational report for Fire Board meetings over any date range, built from what Nexus already has:
// CAD calls for our agency (Comms Statistics data), unit responses (Apparatus), structure fires, fire prevention inspections,
// training hours, the PIAL score and sick leave totals. Report layouts are saved like Comms Statistics reports.
//
//   GET  /api/board/meta                      rights, settings, agency, first/last CAD day
//   GET  /api/board/data?from&to              every number the blocks use, for the window (and the same dates a year earlier)
//   GET  /api/board/reports                   saved reports (mine + shared)
//   POST /api/board/reports                   {id?, title, reportType, preparedBy, notes, windowKind, from, to, blocks, shared}
//   POST /api/board/reports/:id/remove
//   POST /api/board/settings                  {agency, categories}                                              (manage)
//
// Access: section "board" (view = build, save and print reports; manage = settings). Masters always. Audit module "Board report".
import { risky } from "./saferegex.js";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const txt = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const day = s => new Date(`${s}T00:00:00Z`);
const toDay = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return toDay(d); };
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);
const addYears = (s, n) => { const [y, m, d] = s.split("-").map(Number); const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate(); return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`; };
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const num = v => (v === null || v === undefined ? null : Number(v));
const r1 = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const pad = n => String(n).padStart(2, "0");
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };

// Call types: first pattern that matches the CAD nature wins (alarms before fires, so "FIRE ALARM" is an alarm)
export const DEFAULT_CATEGORIES = [
  { name: "Fire alarms", pattern: "ALARM" },
  { name: "Fires", pattern: "FIRE|SMOKE|BURN|FLAME|EXPLOS|SMOLDER" },
  { name: "Vehicle crashes / rescue", pattern: "MVA|ACCIDENT|CRASH|COLLISION|RESCUE|EXTRIC|ENTRAP|MVC" },
  { name: "Hazmat / gas / CO", pattern: "HAZ|GAS|ODOR|SPILL|LEAK|CARBON|CO DET|FUEL" },
  { name: "EMS / medical", pattern: "MEDIC|EMS|CARDIAC|CHEST|BREATH|SEIZ|STROKE|FALL|SICK|UNCONS|UNRESP|OVERDOSE|DIABET|BLEED|INJUR|LIFT|PSYCH|ALLERG|PREGN|ABDOM|CPR|ARREST|TRAUMA|HEMORR|SYNCOPE|CHOK|DROWN" },
  { name: "Service / public assist", pattern: "SERVICE|ASSIST|PUBLIC|LOCK|WIRE|TREE|FLOOD|WATER|INVEST|STANDBY|CHECK" },
];
async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'board'")).rows[0]?.value;
  const d = (typeof v === "string" ? JSON.parse(v) : v) || {};
  const cats = Array.isArray(d.categories) && d.categories.length ? d.categories : DEFAULT_CATEGORIES;
  return { agency: txt(d.agency, 60), categories: cats.map(c => ({ name: txt(c.name, 60), pattern: txt(c.pattern, 400) })).filter(c => c.name && c.pattern) };
}
async function agencyFor(s) {
  if (s.agency) return { agency: s.agency, auto: false };
  try { const { getSettings } = await import("./pial.js"); const p = await getSettings(); if (p.cadAgency) return { agency: p.cadAgency, auto: false, from: "PIAL settings" }; } catch { /* PIAL not set up */ }
  const a = (await q(`SELECT agency FROM cad_incidents WHERE agency ~* '(st\\.? ?george|^sgfd$|^sg ?fd$)' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`).catch(() => []))[0]?.agency;
  return { agency: a || "", auto: true };
}
const validRegex = p => { try { new RegExp(p, "i"); return !risky(p); } catch { return false; } };
// SQL CASE giving each incident its call type
function categorySql(cats, params) {
  const parts = cats.filter(c => validRegex(c.pattern)).map(c => { params.push(c.pattern); const i = params.length; params.push(c.name); return `WHEN nature ~* $${i} THEN $${params.length}`; });
  return parts.length ? `CASE ${parts.join(" ")} ELSE 'Other' END` : "'All calls'";
}
function grainFor(days) { return days <= 62 ? "day" : days <= 400 ? "week" : "month"; }
function buckets(from, to, grain) {
  const out = [];
  if (grain === "day") { for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, start: d, end: d }); return out; }
  let d = from;
  if (grain === "week") { const dow = (day(d).getUTCDay() + 6) % 7; d = addDays(d, -dow); while (d <= to) { const e = addDays(d, 6); out.push({ key: d, start: d < from ? from : d, end: e > to ? to : e, partial: d < from || e > to }); d = addDays(d, 7); } return out; }
  d = `${from.slice(0, 7)}-01`;
  while (d <= to) { const [y, m] = d.split("-").map(Number); const e = toDay(new Date(Date.UTC(y, m, 0))); out.push({ key: d, start: d < from ? from : d, end: e > to ? to : e, partial: d < from || e > to }); d = toDay(new Date(Date.UTC(y, m, 1))); }
  return out;
}

export async function boardData(from, to) {
  const s = await settings();
  const { agency, auto } = await agencyFor(s);
  const days = daysBetween(from, to) + 1;
  const lyFrom = addYears(from, -1), lyTo = addYears(to, -1);
  const win = (a, b, extra = "") => ({ sql: `agency = $1 AND dispatched AND received_at >= $2::date AND received_at < $3::date${extra ? ` AND ${extra}` : ""}`, params: [agency, a, addDays(b, 1)] });
  const W = win(from, to), L = win(lyFrom, lyTo);
  const count = async w => (await q(`SELECT count(*)::int AS n FROM cad_incidents WHERE ${w.sql}`, w.params))[0].n;
  const n = await count(W), nLy = await count(L);

  // Over time
  const grain = grainFor(days);
  const seriesFor = async (a, b) => {
    const w = win(a, b);
    const rows = await q(`SELECT date_trunc('${grain}', received_at)::date::text AS k, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, w.params);
    const by = new Map(rows.map(r => [r.k, r.n]));
    return buckets(a, b, grain).map(x => ({ ...x, n: by.get(x.key) || 0 }));
  };
  const series = { grain, points: await seriesFor(from, to) };
  const seriesLy = { grain, points: await seriesFor(lyFrom, lyTo) };

  // Call types and natures (this period vs the same dates last year)
  const typesFor = async w => { const p = [...w.params]; const cs = categorySql(s.categories, p); return q(`SELECT ${cs} AS t, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, p); };
  const tNow = await typesFor(W), tLy = new Map((await typesFor(L)).map(r => [r.t, r.n]));
  const order = [...s.categories.map(c => c.name), "Other"];
  const types = tNow.map(r => ({ type: r.t, n: r.n, ly: tLy.get(r.t) || 0, share: n ? r1(100 * r.n / n) : 0 })).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const nat = await q(`WITH c AS (SELECT nature, count(*)::int AS n FROM cad_incidents WHERE ${W.sql} GROUP BY 1),
      l AS (SELECT nature, count(*)::int AS n FROM cad_incidents WHERE agency = $1 AND dispatched AND received_at >= $4::date AND received_at < $5::date GROUP BY 1)
    SELECT c.nature, c.n, coalesce(l.n, 0) AS ly FROM c LEFT JOIN l USING (nature) ORDER BY c.n DESC, c.nature LIMIT 15`, [...W.params, lyFrom, addDays(lyTo, 1)]);
  const natures = nat.map(r => ({ nature: r.nature || "(blank)", n: r.n, ly: r.ly, share: n ? r1(100 * r.n / n) : 0 }));

  // Response times: call received -> first unit on scene, and first unit assigned -> on scene (turnout + travel)
  const resp = async (extraParams = [], extra = "") => {
    const p = [...W.params, ...extraParams];
    const [x] = await q(`SELECT count(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM arrived_at - received_at))::float AS total50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM arrived_at - received_at))::float AS total90,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM arrived_at - assigned_at))::float AS travel50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM arrived_at - assigned_at))::float AS travel90,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY hold_seconds)::float AS hold90
      FROM cad_incidents WHERE ${W.sql} AND arrived_at IS NOT NULL AND assigned_at IS NOT NULL AND arrived_at >= received_at
        AND arrived_at - received_at < interval '2 hours'${extra}`, p);
    return { n: x.n, total50: r1(num(x.total50)), total90: r1(num(x.total90)), travel50: r1(num(x.travel50)), travel90: r1(num(x.travel90)), hold90: r1(num(x.hold90)) };
  };
  const overall = await resp();
  const response = [{ type: "All calls", ...overall }];
  for (const c of s.categories.filter(c => validRegex(c.pattern))) {
    // first matching pattern wins, as in the call-type table
    const before = s.categories.slice(0, s.categories.indexOf(c)).filter(x => validRegex(x.pattern));
    const p = [c.pattern, ...before.map(x => x.pattern)];
    const not = before.map((_, i) => ` AND nature !~* $${W.params.length + 2 + i}`).join("");
    const r = await resp(p, ` AND nature ~* $${W.params.length + 1}${not}`);
    if (r.n) response.push({ type: c.name, ...r });
  }

  // Hours and weekdays (average per day)
  const hoursRows = await q(`SELECT extract(hour FROM received_at)::int AS h, count(*)::int AS n FROM cad_incidents WHERE ${W.sql} GROUP BY 1`, W.params);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, avg: r1((hoursRows.find(r => r.h === h)?.n || 0) / days) }));
  const dowRows = await q(`SELECT extract(isodow FROM received_at)::int AS d, count(*)::int AS n FROM cad_incidents WHERE ${W.sql} GROUP BY 1`, W.params);
  const dayCount = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let d = from; d <= to; d = addDays(d, 1)) dayCount[((day(d).getUTCDay() + 6) % 7) + 1]++;
  const dow = [1, 2, 3, 4, 5, 6, 7].map(d => ({ dow: d, avg: dayCount[d] ? r1((dowRows.find(r => r.d === d)?.n || 0) / dayCount[d]) : 0 }));
  const busiest = (await q(`SELECT received_at::date::text AS d, count(*)::int AS n FROM cad_incidents WHERE ${W.sql} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`, W.params))[0] || null;

  // Apparatus: our units' responses (any agency's calls) and aid to other agencies
  let units = [], aid = [], unitResponses = 0;
  try {
    const { unitSettings } = await import("./cadstats.js");
    const pat = (await unitSettings()).pattern;
    const rows = await q(`SELECT unit, count(DISTINCT incident_id)::int AS calls, count(*) FILTER (WHERE arrived_at IS NOT NULL)::int AS arrived,
        sum(LEAST(extract(epoch FROM coalesce(cleared_at, assigned_at) - assigned_at), 86400))::float AS busy,
        count(DISTINCT incident_id) FILTER (WHERE agency IS DISTINCT FROM $3)::int AS aid
      FROM cad_unit_responses WHERE assigned_at >= $1::date AND assigned_at < $2::date AND unit ~* $4 GROUP BY 1 ORDER BY 2 DESC, 1`,
      [from, addDays(to, 1), agency, pat]);
    units = rows.map(r => ({ unit: r.unit, calls: r.calls, arrived: r.arrived, hours: r1((num(r.busy) || 0) / 3600), aid: r.aid }));
    unitResponses = rows.reduce((a, r) => a + r.calls, 0);
    aid = (await q(`SELECT coalesce(nullif(agency, ''), '(unknown)') AS agency, count(DISTINCT incident_id)::int AS n FROM cad_unit_responses
        WHERE assigned_at >= $1::date AND assigned_at < $2::date AND unit ~* $4 AND agency IS DISTINCT FROM $3 GROUP BY 1 ORDER BY 2 DESC`,
      [from, addDays(to, 1), agency, pat])).map(r => ({ agency: r.agency, n: r.n }));
  } catch { /* no unit data */ }

  // Structure fires (PIAL's structure-fire natures)
  let structure = [], fireTypes = [];
  try {
    const { getSettings } = await import("./pial.js");
    const ps = await getSettings();
    if (validRegex(ps.structureNatures)) {
      structure = (await q(`SELECT incident_number AS number, received_at::text AS received, nature,
          extract(epoch FROM arrived_at - received_at)::float AS first_on_scene
        FROM cad_incidents WHERE ${W.sql} AND nature ~* $4 ORDER BY received_at`, [...W.params, ps.structureNatures]))
        .map(r => ({ number: r.number, received: r.received.slice(0, 16), nature: r.nature, firstOnScene: r1(num(r.first_on_scene)) }));
    }
  } catch { /* PIAL not set up */ }
  try {
    const p = [...W.params]; const cs = categorySql(s.categories, p);
    const fireName = (s.categories.find(c => /fire/i.test(c.name) && !/alarm/i.test(c.name)) || {}).name || "Fires";
    p.push(fireName);
    fireTypes = await q(`SELECT nature, count(*)::int AS n FROM cad_incidents WHERE ${W.sql} AND ${cs} = $${p.length} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, p);
  } catch { fireTypes = []; }

  // Fire prevention, training, sick leave, PIAL
  let prevention = null;
  try {
    const [x] = await q(`SELECT count(*)::int AS inspections, count(DISTINCT property_no)::int AS properties FROM fp_inspections WHERE day BETWEEN $1 AND $2`, [from, to]);
    const { coverage } = await import("./fireprev.js");
    const y = to.slice(0, 4);
    const cov = await coverage(`${y}-01-01`, `${y}-12-31`);
    prevention = { inspections: x.inspections, properties: x.properties, year: y, coverage: cov ? { total: cov.total, inspected: cov.inspected, pct: r1(100 * cov.pct) } : null };
  } catch { prevention = null; }
  let training = null;
  try {
    const [x] = await q(`SELECT coalesce(sum(hours), 0)::float AS hours, count(DISTINCT coalesce(user_id::text, lower(person_name)))::int AS people, count(*)::int AS records
      FROM training_records WHERE day BETWEEN $1 AND $2 AND superseded_by IS NULL`, [from, to]).catch(async () =>
      q(`SELECT coalesce(sum(hours), 0)::float AS hours, count(DISTINCT coalesce(user_id::text, lower(person_name)))::int AS people, count(*)::int AS records FROM training_records WHERE day BETWEEN $1 AND $2`, [from, to]));
    const top = await q(`SELECT coalesce(nullif(category, ''), 'Other') AS category, sum(hours)::float AS hours FROM training_records WHERE day BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [from, to]);
    let drills = 0;
    try { drills = (await q(`SELECT count(*)::int AS n FROM training_drills WHERE status = 'verified' AND day BETWEEN $1 AND $2`, [from, to]))[0].n; } catch { drills = 0; }
    training = { hours: r1(num(x.hours)), people: x.people, records: x.records, perPerson: x.people ? r1(num(x.hours) / x.people) : null, drills, top: top.map(r => ({ category: r.category, hours: r1(num(r.hours)) })) };
  } catch { training = null; }
  let staffing = null;
  try {
    const [x] = await q(`SELECT count(*) FILTER (WHERE NOT protected)::int AS shifts, coalesce(sum(hours) FILTER (WHERE NOT protected), 0)::float AS hours,
        coalesce(sum(hours) FILTER (WHERE protected), 0)::float AS protected_hours, count(DISTINCT user_id)::int AS people FROM sick_entries WHERE day BETWEEN $1 AND $2`, [from, to]);
    staffing = { sickShifts: x.shifts, sickHours: r1(num(x.hours)), protectedHours: r1(num(x.protected_hours)), people: x.people };
  } catch { staffing = null; }
  let pial = null;
  try {
    const { compute } = await import("./pial.js");
    const c = await compute();
    pial = { score: c.score, cls: c.cls, year: c.year?.year ?? c.year, baseline: c.settings?.baseline?.score ?? null, baselineCls: c.settings?.baseline?.cls ?? null };
  } catch { pial = null; }

  const bounds = (await q(`SELECT min(received_at)::date::text AS first, max(received_at)::date::text AS last FROM cad_incidents WHERE agency = $1`, [agency]))[0] || {};
  return {
    from, to, days, agency, agencyAuto: auto, lyFrom, lyTo, firstDay: bounds.first, lastDay: bounds.last,
    kpis: { incidents: n, ly: nLy, dailyAvg: r1(n / days), dailyAvgLy: r1(nLy / days), response50: overall.total50, response90: overall.total90,
      structureFires: structure.length, unitResponses, aidGiven: aid.reduce((a, r) => a + r.n, 0) },
    series, seriesLy, types, natures, response, hours, dow, busiest, units, aid, structure, fireTypes, prevention, training, staffing, pial,
  };
}

const outReport = (r, me) => ({ id: r.id, mine: r.owner_id === me, owner: r.owner, title: r.title, reportType: r.report_type, preparedBy: r.prepared_by, notes: r.notes,
  windowKind: r.window_kind, from: r.window_from, to: r.window_to, blocks: r.blocks, shared: r.shared, updatedAt: r.updated_at });
const BLOCKS = new Set(["heading", "text", "kpis", "volume", "types", "natures", "response", "hours", "dow", "units", "aid", "fires", "prevention", "training", "staffing", "pial"]);
const WINDOWS = ["lastMonth", "lastQuarter", "ytd", "lastYear", "last30", "custom"];
async function reports(user) {
  return (await q(`SELECT r.*, r.window_from::text AS window_from, r.window_to::text AS window_to, u.full_name AS owner FROM board_reports r JOIN users u ON u.id = r.owner_id
    WHERE r.owner_id = $1 OR r.shared ORDER BY (r.owner_id = $1) DESC, r.updated_at DESC`, [user.id])).map(r => outReport(r, user.id));
}
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Board report', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, txt(detail, 500)]);
}

export async function handleBoard(req, res, parts, user, send, jsonBody, url) {
  const master = user.role === "master";
  if (!master && !(await hasAccess(pool, user, "board", "view"))) throw err(403, "The board report needs permission (User Management > Permissions > Board report).");
  const manage = master || (await hasAccess(pool, user, "board", "manage"));
  const what = parts[2];
  if (req.method === "GET" && what === "meta") {
    const s = await settings();
    const a = await agencyFor(s);
    const b = a.agency ? (await q(`SELECT min(received_at)::date::text AS first, max(received_at)::date::text AS last FROM cad_incidents WHERE agency = $1`, [a.agency]))[0] : {};
    const agencies = await q("SELECT agency, count(*)::int AS n FROM cad_incidents WHERE agency <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 40");
    return send(res, 200, { manage, settings: s, defaults: DEFAULT_CATEGORIES, agency: a.agency, agencyAuto: a.auto, firstDay: b?.first || null, lastDay: b?.last || null, today: localToday(), agencies });
  }
  if (req.method === "GET" && what === "data") {
    const today = localToday();
    let to = isDay(url.searchParams.get("to")) ? url.searchParams.get("to") : today;
    let from = isDay(url.searchParams.get("from")) ? url.searchParams.get("from") : addDays(to, -29);
    if (from > to) [from, to] = [to, from];
    if (daysBetween(from, to) > 1100) from = addDays(to, -1100);
    return send(res, 200, await boardData(from, to));
  }
  if (req.method === "GET" && what === "reports") return send(res, 200, { reports: await reports(user) });
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  if (what === "settings") {
    if (!manage) throw err(403, "Only board report managers can change its settings.");
    const cats = (Array.isArray(b.categories) ? b.categories : []).slice(0, 20).map(c => ({ name: txt(c?.name, 60), pattern: txt(c?.pattern, 400) })).filter(c => c.name && c.pattern);
    for (const c of cats) if (!validRegex(c.pattern)) throw err(400, `The words for "${c.name}" aren't a valid pattern.`);
    const value = { agency: txt(b.agency, 60), categories: cats };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('board', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
    await audit(user, "Changed settings", `Agency: ${value.agency || "automatic"}; ${cats.length || "default"} call types`);
    return send(res, 200, { ok: true });
  }
  if (what === "reports" && isUuid(parts[3]) && parts[4] === "remove") {
    const r = (await q("SELECT owner_id, title FROM board_reports WHERE id = $1", [parts[3]]))[0];
    if (r && r.owner_id !== user.id && !manage) throw err(403, "You can only delete your own reports.");
    if (r) { await pool.query("DELETE FROM board_reports WHERE id = $1", [parts[3]]); await audit(user, "Deleted report", r.title); }
    return send(res, 200, { ok: true, reports: await reports(user) });
  }
  if (what === "reports" && !parts[3]) {
    const blocks = (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 50).filter(x => x && BLOCKS.has(x.type))
      .map(x => ({ id: isUuid(x.id) ? x.id : crypto.randomUUID(), type: x.type, title: txt(x.title, 120), text: txt(x.text, 6000) }));
    const row = [txt(b.title, 120) || "Board report", txt(b.reportType, 80), txt(b.preparedBy, 120), txt(b.notes, 3000), WINDOWS.includes(b.windowKind) ? b.windowKind : "lastMonth",
      isDay(b.from) ? b.from : null, isDay(b.to) ? b.to : null, JSON.stringify(blocks), !!b.shared];
    let id = isUuid(b.id) ? b.id : null;
    if (id) {
      const prev = (await q("SELECT owner_id FROM board_reports WHERE id = $1", [id]))[0];
      if (!prev || prev.owner_id !== user.id) id = null;            // someone else's: save a copy
    }
    if (id) await pool.query(`UPDATE board_reports SET title = $2, report_type = $3, prepared_by = $4, notes = $5, window_kind = $6, window_from = $7, window_to = $8, blocks = $9,
      shared = $10, updated_at = now() WHERE id = $1`, [id, ...row]);
    else id = (await q(`INSERT INTO board_reports (owner_id, title, report_type, prepared_by, notes, window_kind, window_from, window_to, blocks, shared)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [user.id, ...row]))[0].id;
    await audit(user, "Saved report", row[0]);
    return send(res, 200, { ok: true, id, reports: await reports(user) });
  }
  throw err(404, "Not found");
}
