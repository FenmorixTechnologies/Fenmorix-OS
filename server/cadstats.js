// Communications Statistics (/api/stats/*): closed CAD incidents for every agency SGFD Communications
// handles, pulled from a second read-only SQL Server view (scripts/cad-stats-view-template.sql) and
// summarized here. See db/migrations/018_comms_stats.sql.
//
// The view (column names are case-insensitive; extra columns are ignored, missing optional ones are fine):
//   incident_id (required, unique)   incident_number    agency
//   received_at (required)  queued_at  assigned_at  enroute_at  arrived_at  closed_at
//   nature   priority   (disposition columns, if the view still has them, are ignored)
//   call_taker   call_taker_name   dispatcher   dispatcher_name   first_unit
//   self_initiated (bit)   dispatched (bit; if missing, "has assigned_at" counts as dispatched)
// No addresses, callers, narratives or patient details: the template leaves them out on purpose.
//
// .env (the connection is the same CAD_SQL_* login as Active calls; the view is separate):
//   CAD_STATS_VIEW=dbo.vw_nexus_call_stats   (required: stats stay off until this is set)
//   CAD_STATS_START=2024-01-01        first day to load on the first run (default: Jan 1 of last year)
//   CAD_STATS_SYNC_TIME=02:15         nightly sync (server local time)
//   CAD_STATS_LOOKBACK_DAYS=7         each night re-reads this many days (late closes)
//   CAD_STATS_DISABLED=true           turn the sync off
//   CAD_STATS_TEST_FILE=              testing: JSON rows instead of SQL
//
// Times are kept as CAD wall-clock time (no time zones); a "day" is a calendar day in that time.
import { risky } from "./saferegex.js";
import { brand, brandText, brandDeep } from "./brand.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));

// ---- Dates (plain calendar days, done in UTC so nothing shifts) ----------------------------------
const toDay = d => d.toISOString().slice(0, 10);
const day = s => new Date(s + "T00:00:00Z");
export const addDays = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return toDay(d); };
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 86400000);        // b - a
export function addYears(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();                                // Feb 29 -> Feb 28
  return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

// ---- Settings / config ----------------------------------------------------------------------------
function config() {
  const e = process.env;
  const start = isDay(String(e.CAD_STATS_START || "")) ? e.CAD_STATS_START : `${new Date().getFullYear() - 1}-01-01`;
  const [hh, mm] = String(e.CAD_STATS_SYNC_TIME || "02:15").split(":").map(Number);
  return {
    server: String(e.CAD_SQL_SERVER || "").trim(), port: Number(e.CAD_SQL_PORT) || 1433,
    database: String(e.CAD_SQL_DATABASE || "").trim(), user: String(e.CAD_SQL_USER || "").trim(), password: String(e.CAD_SQL_PASSWORD || ""),
    encrypt: String(e.CAD_SQL_ENCRYPT || "true").toLowerCase() !== "false",
    trustCert: String(e.CAD_SQL_TRUST_CERT || "false").toLowerCase() === "true",
    view: String(e.CAD_STATS_VIEW || "").trim(),
    start, syncH: Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 2, syncM: Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 15,
    lookback: Math.min(60, Math.max(1, Number(e.CAD_STATS_LOOKBACK_DAYS) || 7)),
    disabled: String(e.CAD_STATS_DISABLED || "").toLowerCase() === "true",
    testFile: String(e.CAD_STATS_TEST_FILE || "").trim(),
    startDelay: Math.max(0, Number(e.CAD_STATS_START_DELAY_SECONDS ?? 30)),
    unitsView: String(e.CAD_STATS_UNITS_VIEW || "").trim(),            // one row per unit assigned (Apparatus report)
    unitsTestFile: String(e.CAD_STATS_UNITS_TEST_FILE || "").trim(),
    shiftStart: /^\d{1,2}:\d{2}$/.test(String(e.ALADTEC_SHIFT_START || "")) ? e.ALADTEC_SHIFT_START : "07:00",
  };
}
export const statsConfigured = () => { const c = config(); return !c.disabled && !!(c.testFile || (c.view && c.server && c.database && c.user)); };
async function settings() {
  const r = (await pool.query("SELECT hold_goal_seconds, tail_minutes, include, drop_blank FROM cad_stats_settings")).rows[0]
    || { hold_goal_seconds: 60, tail_minutes: 15, include: [], drop_blank: true };
  return { holdGoalSeconds: r.hold_goal_seconds, tailMinutes: r.tail_minutes, include: Array.isArray(r.include) ? r.include : [], dropBlank: r.drop_blank !== false };
}
// Which calls count (Data & settings > Which calls count): appended to every statistics WHERE.
// Plain column names on purpose: callers that join prefix agency with "i." by text replacement.
export function scopeSql(set, params) {
  const parts = [];
  if (set.dropBlank) parts.push("agency <> '' AND nature <> ''");
  const inc = set.include || [];
  if (inc.length) {
    const whole = inc.filter(x => x.zone === "*").map(x => x.agency), pairs = inc.filter(x => x.zone !== "*").map(x => `${x.agency}\x1e${x.zone}`);
    params.push(whole.join("\x1f")); const a = params.length;
    params.push(pairs.join("\x1f")); const z = params.length;
    parts.push(`(agency = ANY(string_to_array($${a}, chr(31))) OR (agency || chr(30) || zone) = ANY(string_to_array($${z}, chr(31))))`);
  }
  return parts.join(" AND ");
}

// ---- Reading the view -----------------------------------------------------------------------------
const state = { sqlPool: null, running: null, timer: null, lastManual: 0 };
const pick = (row, ...names) => { for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n]; return null; };
const pad = n => String(n).padStart(2, "0");
// CAD wall-clock time as "YYYY-MM-DD HH:MM:SS" (mssql with useUTC:false hands back local Dates)
export function wall(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(+v) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/);
  return m ? `${m[1]} ${m[2]}${m[3] || ":00"}` : null;
}
const secs = (a, b) => (a && b ? Math.round((Date.parse(b.replace(" ", "T") + "Z") - Date.parse(a.replace(" ", "T") + "Z")) / 1000) : null);
const truthy = v => v === true || v === 1 || /^(1|y|yes|t|true)$/i.test(String(v ?? "").trim());
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

export function normalizeIncident(raw) {
  const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  const id = pick(row, "incident_id", "id");
  const received = wall(pick(row, "received_at", "received", "created_at"));
  if (id === null || !received) return null;
  const queued = wall(pick(row, "queued_at", "pending_at", "queued"));
  const assigned = wall(pick(row, "assigned_at", "dispatched_at", "first_assigned_at"));
  const self = truthy(pick(row, "self_initiated", "is_self_initiated", "officer_initiated"));
  const dispatchedRaw = pick(row, "dispatched", "is_dispatched");
  const dispatched = dispatchedRaw !== null ? truthy(dispatchedRaw) : !!assigned;
  const hold = self ? null : secs(queued || received, assigned);
  const proc = secs(received, queued);
  return {
    id: txt(id, 60), number: txt(pick(row, "incident_number", "number"), 40), agency: txt(pick(row, "agency", "agency_code"), 60),
    zone: txt(pick(row, "zone", "response_area", "area"), 40),
    received, queued, assigned,
    enroute: wall(pick(row, "enroute_at", "enroute")), arrived: wall(pick(row, "arrived_at", "onscene_at", "arrived")),
    closed: wall(pick(row, "closed_at", "closed")),
    nature: txt(pick(row, "nature", "call_type", "problem"), 80), priority: txt(pick(row, "priority"), 20),
    disposition: "", dispositionDescription: "",              // dispositions aren't used (Comms, 11/2026)
    callTaker: txt(pick(row, "call_taker", "call_taker_id"), 40), callTakerName: txt(pick(row, "call_taker_name"), 80),
    dispatcher: txt(pick(row, "dispatcher", "dispatcher_id"), 40), dispatcherName: txt(pick(row, "dispatcher_name"), 80),
    firstUnit: txt(pick(row, "first_unit", "unit"), 20),
    self, dispatched,
    hold: hold !== null && hold >= 0 && hold <= 86400 ? hold : null,
    process: proc !== null && proc >= 0 && proc <= 86400 ? proc : null,
  };
}

async function readRows(c, from, to) {          // received_at in [from, to)
  if (c.testFile) {
    const mtime = (await fs.stat(c.testFile)).mtimeMs;
    if (state.testRows?.mtime !== mtime) state.testRows = { mtime, rows: JSON.parse(await fs.readFile(c.testFile, "utf8")) };
    const rows = state.testRows.rows;
    return rows.filter(r => { const w = wall(r.received_at ?? r.RECEIVED_AT); return w && w >= from && w < to; });
  }
  if (!/^[\w\[\]]+(\.[\w\[\]]+){0,2}$/.test(c.view)) throw new Error("CAD_STATS_VIEW must be a view name like dbo.vw_nexus_call_stats");
  let sql;
  try { sql = (await import("mssql")).default; }
  catch { throw new Error("The SQL Server driver isn't installed yet. Run update.ps1 (it runs npm install)."); }
  if (!state.sqlPool) {
    state.sqlPool = await new sql.ConnectionPool({
      server: c.server, port: c.port, database: c.database, user: c.user, password: c.password,
      options: { encrypt: c.encrypt, trustServerCertificate: c.trustCert, useUTC: false, readOnlyIntent: true, appName: `${brand().app} stats` },
      pool: { max: 1, min: 0, idleTimeoutMillis: 60_000 }, connectionTimeout: 15_000, requestTimeout: 180_000,
    }).connect();
  }
  const r = await state.sqlPool.request().input("from", sql.VarChar(19), from).input("to", sql.VarChar(19), to)
    .query(`SELECT * FROM ${c.view} WHERE received_at >= CAST(@from AS datetime2) AND received_at < CAST(@to AS datetime2)`);
  return r.recordset;
}

// ---- Units on each incident (Apparatus report) -------------------------------------------------------
const unitsConfigured = c => !!(c.unitsTestFile || (c.unitsView && !c.testFile));
async function readUnitRows(c, from, to) {     // assigned_at in [from, to)
  if (c.unitsTestFile) {
    const rows = JSON.parse(await fs.readFile(c.unitsTestFile, "utf8"));
    return rows.filter(r => { const w = wall(r.assigned_at ?? r.ASSIGNED_AT); return w && w >= from && w < to; });
  }
  if (!/^[\w\[\]]+(\.[\w\[\]]+){0,2}$/.test(c.unitsView)) throw new Error("CAD_STATS_UNITS_VIEW must be a view name like dbo.vw_nexus_unit_responses");
  const sql = (await import("mssql")).default;
  const r = await state.sqlPool.request().input("from", sql.VarChar(19), from).input("to", sql.VarChar(19), to)
    .query(`SELECT * FROM ${c.unitsView} WHERE assigned_at >= CAST(@from AS datetime2) AND assigned_at < CAST(@to AS datetime2)`);
  return r.recordset;
}
function normalizeUnit(raw) {
  const r = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  const unit = String(pick(r, "unit", "radio_name", "unit_id") ?? "").trim().toUpperCase().slice(0, 30);
  const id = pick(r, "incident_id"), assigned = wall(pick(r, "assigned_at"));
  if (!unit || id === null || !assigned) return null;
  return { incident_id: String(id).slice(0, 60), unit, assigned_at: assigned, enroute_at: wall(pick(r, "enroute_at")), arrived_at: wall(pick(r, "arrived_at")),
    cleared_at: wall(pick(r, "cleared_at")), incident_number: String(pick(r, "incident_number") ?? "").slice(0, 40), agency: String(pick(r, "agency") ?? "").slice(0, 60),
    nature: String(pick(r, "nature") ?? "").slice(0, 120) };
}
async function storeUnits(rows, from, to) {
  const list = [...new Map(rows.map(normalizeUnit).filter(Boolean).map(x => [`${x.incident_id}|${x.unit}|${x.assigned_at}`, x])).values()];
  if (!list.length) return 0;                    // an empty answer never wipes what's stored
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("DELETE FROM cad_unit_responses WHERE assigned_at >= $1::timestamp AND assigned_at < $2::timestamp", [from, to]);
    for (let i = 0; i < list.length; i += 500) {
      await c.query(`INSERT INTO cad_unit_responses (incident_id, unit, assigned_at, enroute_at, arrived_at, cleared_at, incident_number, agency, nature)
        SELECT x->>'incident_id', x->>'unit', (x->>'assigned_at')::timestamp, (x->>'enroute_at')::timestamp, (x->>'arrived_at')::timestamp, (x->>'cleared_at')::timestamp,
               x->>'incident_number', x->>'agency', x->>'nature' FROM jsonb_array_elements($1::jsonb) x ON CONFLICT DO NOTHING`, [JSON.stringify(list.slice(i, i + 500))]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  return list.length;
}

const COLS = ["incident_id", "incident_number", "agency", "zone", "received_at", "queued_at", "assigned_at", "enroute_at", "arrived_at", "closed_at",
  "nature", "priority", "disposition", "call_taker", "dispatcher", "first_unit", "self_initiated", "dispatched", "hold_seconds", "process_seconds", "source"];
// source: "cad" (the CAD view) or "upload" (a CAD / FireWorks report someone uploaded)
async function store(list, source = "cad") {
  const byId = new Map(list.map(x => [x.id, x]));
  const rows = [...byId.values()];
  // The CAD view is the record: an uploaded copy of the same incident (same incident number) gives way to it
  if (source === "cad") {
    const nums = [...new Set(rows.map(x => x.number).filter(Boolean))];
    for (let i = 0; i < nums.length; i += 1000) {
      await pool.query(`DELETE FROM cad_incidents WHERE source = 'upload' AND incident_number = ANY(string_to_array($1, chr(31)))`, [nums.slice(i, i + 1000).join("\x1f")]);
    }
  }
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400), params = [];
    const values = chunk.map(x => {
      const v = [x.id, x.number, x.agency, x.zone || "", x.received, x.queued, x.assigned, x.enroute, x.arrived, x.closed, x.nature, x.priority, x.disposition,
        x.callTaker, x.dispatcher, x.firstUnit, x.self, x.dispatched, x.hold, x.process, source];
      const start = params.length; params.push(...v);
      return `(${v.map((_, j) => `$${start + j + 1}`).join(", ")}, now())`;
    });
    await pool.query(`INSERT INTO cad_incidents (${COLS.join(", ")}, synced_at) VALUES ${values.join(", ")}
      ON CONFLICT (incident_id) DO UPDATE SET ${COLS.slice(1).map(k => `${k} = EXCLUDED.${k}`).join(", ")}, synced_at = now()`, params);
  }
  // Codes and operator ids seen: descriptions/names from the view fill in blanks only
  const codes = new Map(), ops = new Map();
  for (const x of rows) {
    if (x.disposition && (!codes.has(x.disposition) || (!codes.get(x.disposition) && x.dispositionDescription))) codes.set(x.disposition, x.dispositionDescription);
    for (const [idv, name] of [[x.callTaker, x.callTakerName], [x.dispatcher, x.dispatcherName]]) if (idv && (!ops.has(idv) || (!ops.get(idv) && name))) ops.set(idv, name);
  }
  for (const [code, d] of codes) await pool.query(`INSERT INTO cad_dispositions (code, description) VALUES ($1, $2)
    ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description WHERE cad_dispositions.description = '' AND EXCLUDED.description <> ''`, [code, d]);
  for (const [idv, name] of ops) await pool.query(`INSERT INTO cad_operators (cad_id, name) VALUES ($1, $2)
    ON CONFLICT (cad_id) DO UPDATE SET name = EXCLUDED.name WHERE cad_operators.name = '' AND EXCLUDED.name <> ''`, [idv, name]);
  return rows.length;
}

// ---- Uploaded reports (CSV or Excel exported from CAD or FireWorks) ------------------------------
// Column names are matched loosely; FireWorks' Alarm Processing report (CADNumber, PSAPTime, Entered Queue, AlarmTime) works as is.
export const UPLOAD_FIELDS = {
  number: ["cadnumber", "cad number", "cad no", "cad", "incident number", "incident no", "incident", "incident id", "call number", "event number", "run number"],
  agency: ["agency", "agency code", "department", "dept", "jurisdiction"],
  zone: ["zone", "response area", "response zone", "area"],
  date: ["incidentdate", "incident date", "date", "call date", "alarm date"],
  received: ["psaptime", "psap time", "psap", "call received", "received", "received time", "call time", "created", "create time", "time received"],
  queued: ["entered queue", "enteredqueue", "queue time", "queued", "pending", "pending time"],
  assigned: ["alarmtime", "alarm time", "alarm", "dispatch time", "dispatched time", "first assigned", "assigned", "dispatched at", "first dispatch"],
  enroute: ["enroute", "en route", "enroute time", "responding", "first enroute"], arrived: ["arrived", "on scene", "onscene", "arrival time", "first arrival", "arrived time"],
  closed: ["closed", "close time", "cleared", "clear time", "closed time"],
  nature: ["nature", "call type", "incident type", "type", "problem", "nature code"], priority: ["priority"],
  disposition: ["disposition", "disposition code", "dispo"], callTaker: ["call taker", "calltaker", "call taker id"], dispatcher: ["dispatcher", "dispatcher id"],
  firstUnit: ["first unit", "unit", "first due"],
};
const normH = h => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function mapUpload(header) {
  const h = header.map(normH), idx = {};
  for (const [f, al] of Object.entries(UPLOAD_FIELDS)) { const i = h.findIndex(x => al.includes(x)); if (i >= 0) idx[f] = i; }
  return idx;
}
const usDT = v => {                    // "1/1/2026 12:24:19 AM" / "2026-01-01 00:24:19" -> wall time
  const s = String(v ?? "").trim();
  const w = wall(s); if (w) return w;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000; let hh = +m[4]; const ap = (m[7] || "").toLowerCase();
  if (ap === "pm" && hh < 12) hh += 12; if (ap === "am" && hh === 12) hh = 0;
  return `${y}-${pad(+m[1])}-${pad(+m[2])} ${pad(hh)}:${m[5]}:${m[6] || "00"}`;
};
const asDay = v => { const s = String(v ?? "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return !m ? null : m[0].includes("-") && m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`; };
// A time-of-day column next to a date column ("00:24:19" + 2026-01-01)
const timeOn = (v, d) => { const w = usDT(v); if (w) return w; const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); return m && d ? `${d} ${pad(+m[1])}:${m[2]}:${m[3] || "00"}` : null; };

export function parseUpload(sheets, defaultAgency) {
  for (const sh of sheets) {
    const rows = sh.rows.map(r => Array.from(r, v => (v === null || v === undefined ? "" : v)));
    for (let h = 0; h < Math.min(25, rows.length); h++) {
      const idx = mapUpload(rows[h]);
      if (idx.number === undefined || (idx.received === undefined && idx.assigned === undefined)) continue;
      const out = [], errors = [];
      const get = (r, f) => (idx[f] === undefined ? "" : r[idx[f]]);
      rows.slice(h + 1).forEach((r, i) => {
        if (!r.some(v => String(v).trim())) return;
        const number = String(get(r, "number")).trim().replace(/\.0$/, "");
        const d = asDay(get(r, "date"));
        const t = f => timeOn(get(r, f), d);
        const received = t("received") || t("queued") || t("assigned");
        if (!number || !received) { errors.push(`Row ${h + i + 2}: ${!number ? "no incident number" : "no call time"}`); return; }
        const assigned = t("assigned");
        out.push(normalizeIncident({ incident_id: number, incident_number: number, agency: String(get(r, "agency")).trim() || defaultAgency || "", zone: get(r, "zone"),
          received_at: received, queued_at: t("queued"), assigned_at: assigned, enroute_at: t("enroute"), arrived_at: t("arrived"), closed_at: t("closed"),
          nature: get(r, "nature"), priority: get(r, "priority"), disposition: "", call_taker: get(r, "callTaker"), dispatcher: get(r, "dispatcher"),
          first_unit: get(r, "firstUnit"), dispatched: idx.assigned !== undefined ? !!assigned : true }));
      });
      return { sheet: sh.name, columns: Object.keys(idx), header: rows[h], rows: out.filter(Boolean), errors, hasAgency: idx.agency !== undefined };
    }
  }
  throw err(400, "No header row with an incident (CAD) number and a call or alarm time was found. Expected columns like CADNumber, PSAPTime, Entered Queue, AlarmTime.");
}

// Store uploaded incidents. Incidents the CAD view already has (same incident number) are left alone.
export async function importIncidents(user, fileName, list) {
  list = list.map(x => (x.hold === undefined ? normalizeIncident({ incident_id: x.id, incident_number: x.number, agency: x.agency, zone: x.zone, received_at: x.received,
    queued_at: x.queued, assigned_at: x.assigned, dispatched: x.dispatched, self_initiated: x.self }) : x)).filter(Boolean);
  const nums = [...new Set(list.map(x => x.number).filter(Boolean))];
  const have = new Map();
  for (let i = 0; i < nums.length; i += 1000) {
    for (const r of (await pool.query(`SELECT incident_id, incident_number, source FROM cad_incidents WHERE incident_number = ANY(string_to_array($1, chr(31)))`,
      [nums.slice(i, i + 1000).join("\x1f")])).rows) have.set(r.incident_number, r);
  }
  let fromCad = 0;
  const keep = [];
  for (const x of list) {
    const h = have.get(x.number);
    if (h?.source === "cad") { fromCad++; continue; }
    keep.push(h ? { ...x, id: h.incident_id } : x);
  }
  const days = keep.map(x => x.received.slice(0, 10)).sort();
  const run = (await pool.query(`INSERT INTO cad_stats_sync (kind, range_from, range_to, file_name, by_name) VALUES ('upload', $1, $2, $3, $4) RETURNING id`,
    [days[0] || null, days[days.length - 1] || null, txt(fileName, 200), user.name])).rows[0].id;
  const n = keep.length ? await store(keep, "upload") : 0;
  await pool.query("UPDATE cad_stats_sync SET finished_at = now(), rows = $2 WHERE id = $1", [run, n]);
  await audit(user, "Uploaded a CAD / FireWorks report", `${txt(fileName, 120)}: ${n} incidents${fromCad ? `, ${fromCad} already from CAD` : ""}`);
  return { stored: n, fromCad, from: days[0] || null, to: days[days.length - 1] || null };
}

// One sync run over [from, to] (days, inclusive), a month at a time
async function syncRange(kind, from, to) {
  const c = config();
  const run = (await pool.query("INSERT INTO cad_stats_sync (kind, range_from, range_to) VALUES ($1, $2, $3) RETURNING id", [kind, from, to])).rows[0].id;
  let total = 0;
  try {
    for (let a = from; a <= to;) {
      let b = toDay(new Date(Date.UTC(+a.slice(0, 4), +a.slice(5, 7), 1)));       // first of next month
      if (b > addDays(to, 1)) b = addDays(to, 1);
      const raw = await readRows(c, `${a} 00:00:00`, `${b} 00:00:00`);
      total += await store(raw.map(normalizeIncident).filter(Boolean));
      // Days the CAD view now covers: uploaded report rows for them give way to CAD, even when the report numbers calls
      // differently (uploads have no call taker or dispatcher). Only when CAD returned calls, so a broken view can't wipe them.
      if (raw.length) await pool.query("DELETE FROM cad_incidents WHERE source = 'upload' AND received_at >= $1::timestamp AND received_at < $2::timestamp", [`${a} 00:00:00`, `${b} 00:00:00`]);
      if (unitsConfigured(c)) await storeUnits(await readUnitRows(c, `${a} 00:00:00`, `${b} 00:00:00`), `${a} 00:00:00`, `${b} 00:00:00`);
      await pool.query("UPDATE cad_stats_sync SET rows = $2, range_to = $3 WHERE id = $1", [run, total, addDays(b, -1)]);
      a = b;
    }
    await pool.query("UPDATE cad_stats_sync SET finished_at = now(), rows = $2, range_to = $3 WHERE id = $1", [run, total, to]);
    state.testRows = null;
    console.log(`Comms statistics: ${kind} sync ${from} to ${to}: ${total} incidents`);
  } catch (e) {
    console.warn(`[Comms statistics] ${e.message}`);
    if (state.sqlPool) { try { await state.sqlPool.close(); } catch {} state.sqlPool = null; }
    await pool.query("UPDATE cad_stats_sync SET finished_at = now(), rows = $2, error = $3 WHERE id = $1", [run, total, String(e.message).slice(0, 500)]);
    throw e;
  }
  return total;
}

// Backfill until done once, then a lookback window
export function syncNow(kind = "nightly", { full = false } = {}) {
  if (state.running) return state.running;
  state.running = (async () => {
    const c = config();
    const today = localToday();
    // Reload everything since CAD_STATS_START (after the CAD admin changes the view, e.g. adds the dispatcher)
    if (full) return syncRange("manual", c.start, today);
    const backfilled = (await pool.query("SELECT 1 FROM cad_stats_sync WHERE kind = 'backfill' AND finished_at IS NOT NULL AND error = '' LIMIT 1")).rowCount > 0;
    if (!backfilled) {
      const last = (await pool.query("SELECT max(received_at)::date::text AS d FROM cad_incidents WHERE source = 'cad'")).rows[0].d;
      const from = last ? addDays(last, -1) : c.start;
      return syncRange("backfill", from < c.start ? c.start : from, today);
    }
    return syncRange(kind, addDays(today, -c.lookback), today);
  })().finally(() => { state.running = null; });
  return state.running;
}
function scheduleNightly() {
  const c = config();
  const now = new Date(), next = new Date(now);
  next.setHours(c.syncH, c.syncM, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  state.timer = setTimeout(() => { syncNow("nightly").catch(() => {}).finally(scheduleNightly); }, next - now);
  state.timer.unref?.();
}
export async function startCadStats() {
  if (!statsConfigured() || state.timer) return;
  const c = config();
  console.log(`Comms statistics: nightly CAD sync at ${pad(c.syncH)}:${pad(c.syncM)}${c.testFile ? " (test file)" : ""}`);
  scheduleNightly();
  // Catch up at startup when the last good sync is more than a day old (or never ran)
  const last = (await pool.query("SELECT max(finished_at) AS t FROM cad_stats_sync WHERE error = '' AND kind <> 'upload'")).rows[0].t;
  if (!last || Date.now() - last.getTime() > 26 * 3600_000) {
    const t = setTimeout(() => syncNow("nightly").catch(() => {}), c.startDelay * 1000); t.unref?.();
  }
}

// ---- Filters --------------------------------------------------------------------------------------
async function bounds() {
  const r = (await pool.query("SELECT min(received_at)::date::text AS first, max(received_at)::date::text AS last, count(*)::int AS n FROM cad_incidents")).rows[0];
  return { firstDay: r.first, lastDay: r.last, total: r.n };
}
async function readFilters(url) {
  const b = await bounds();
  const lastDay = b.lastDay || localToday();
  let to = url.searchParams.get("to"), from = url.searchParams.get("from");
  if (!isDay(to)) to = lastDay;
  if (!isDay(from)) from = addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 3660) from = addDays(to, -3660);
  const agency = txt(url.searchParams.get("agency"), 60);
  const calls = url.searchParams.get("calls") === "all" ? "all" : "dispatched";
  const set = await settings();
  return { from, to, agency, calls, days: daysBetween(from, to) + 1, lastDay, firstDay: b.firstDay, scope: { include: set.include, dropBlank: set.dropBlank } };
}
// WHERE for a window; ly = the same dates last year
function where(f, { ly = false, from, to, extra = "" } = {}) {
  const a = from || (ly ? addYears(f.from, -1) : f.from), b = to || (ly ? addYears(f.to, -1) : f.to);
  const params = [a, addDays(b, 1)];
  let sql = "received_at >= $1::date AND received_at < $2::date";
  if (f.agency) { params.push(f.agency); sql += ` AND agency = $${params.length}`; }
  if (f.calls === "dispatched") sql += " AND dispatched";
  if (f.scope) { const s = scopeSql(f.scope, params); if (s) sql += ` AND ${s}`; }
  if (extra) sql += ` AND ${extra}`;
  return { sql, params, from: a, to: b };
}
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const num = v => (v === null || v === undefined ? null : Number(v));
const round1 = v => (v === null ? null : Math.round(v * 10) / 10);

function grainFor(days) { return days <= 92 ? "day" : days <= 731 ? "week" : "month"; }
function buckets(from, to, grain) {
  const out = [];
  if (grain === "day") for (let d = from; d <= to; d = addDays(d, 1)) out.push({ key: d, start: d, end: d });
  else if (grain === "week") {
    const dow = (day(from).getUTCDay() + 6) % 7;                    // Monday-start weeks, like date_trunc('week')
    for (let d = addDays(from, -dow); d <= to; d = addDays(d, 7)) out.push({ key: d, start: d < from ? from : d, end: addDays(d, 6) > to ? to : addDays(d, 6), partial: d < from || addDays(d, 6) > to });
  } else {
    for (let d = `${from.slice(0, 7)}-01`; d <= to; d = toDay(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1)))) {
      const end = addDays(toDay(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1))), -1);
      out.push({ key: d, start: d < from ? from : d, end: end > to ? to : end, partial: d < from || end > to });
    }
  }
  return out;
}
async function series(f, ly, tailSecs) {
  const grain = grainFor(f.days);
  const w = where(f, { ly });
  const rows = await q(`SELECT date_trunc('${grain}', received_at)::date::text AS k, count(*)::int AS n,
      avg(hold_seconds)::float AS hold, count(hold_seconds)::int AS measured, count(*) FILTER (WHERE hold_seconds > ${Number(tailSecs)})::int AS tail
    FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, w.params);
  const by = new Map(rows.map(r => [r.k, r]));
  return { grain, points: buckets(w.from, w.to, grain).map(b => {
    const r = by.get(b.key) || { n: 0, hold: null, measured: 0, tail: 0 };
    return { key: b.key, start: b.start, end: b.end, partial: !!b.partial, n: r.n, hold: round1(num(r.hold)), tailPct: r.measured ? round1(100 * r.tail / r.measured) : null };
  }) };
}

// ---- Statistics -----------------------------------------------------------------------------------
// Exact percentiles as separate columns (p50, p90, ...)
const P = (col, ps = [50, 90, 95, 99]) => ps.map(x => `percentile_cont(${x / 100}) WITHIN GROUP (ORDER BY ${col})::float AS p${x}`).join(", ");
const EDGES = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 450, 600, 900, 1800, 3600];
async function holdStats(f, extra = "") {
  const w = where(f, { extra: extra ? `hold_seconds IS NOT NULL AND ${extra}` : "hold_seconds IS NOT NULL" });
  const [p] = await q(`SELECT count(*)::int AS n, avg(hold_seconds)::float AS avg, ${P("hold_seconds")} FROM cad_incidents WHERE ${w.sql}`, w.params);
  return { n: p.n, avg: round1(num(p.avg)), p50: round1(num(p.p50)), p90: round1(num(p.p90)), p95: round1(num(p.p95)), p99: round1(num(p.p99)) };
}
async function histogram(f) {
  const w = where(f, { extra: "hold_seconds IS NOT NULL" });
  const rows = await q(`SELECT width_bucket(hold_seconds, ARRAY[${EDGES.join(",")}]) AS b, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, w.params);
  const by = new Map(rows.map(r => [r.b, r.n]));
  return [0, ...EDGES].map((lo, i) => ({ from: lo, to: EDGES[i] ?? null, n: by.get(i) || 0 }));
}
async function heatmap(f) {
  const w = where(f);
  const rows = await q(`SELECT extract(isodow FROM received_at)::int AS d, extract(hour FROM received_at)::int AS h, count(*)::int AS n,
      avg(hold_seconds)::float AS hold, count(hold_seconds)::int AS measured FROM cad_incidents WHERE ${w.sql} GROUP BY 1, 2`, w.params);
  return rows.map(r => ({ dow: r.d, hour: r.h, n: r.n, hold: round1(num(r.hold)), measured: r.measured }));
}
function weekdayCounts(from, to) {               // how many Mondays..Sundays are in the window
  const c = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let d = from; d <= to; d = addDays(d, 1)) c[((day(d).getUTCDay() + 6) % 7) + 1]++;
  return c;
}
async function counts(f, opts) {
  const w = where(f, opts);
  const [r] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE dispatched)::int AS dispatched, count(*) FILTER (WHERE self_initiated)::int AS self,
      count(hold_seconds)::int AS measured, avg(hold_seconds)::float AS hold FROM cad_incidents WHERE ${w.sql}`, w.params);
  return { n: r.n, dispatched: r.dispatched, self: r.self, measured: r.measured, hold: round1(num(r.hold)) };
}
const pct = (a, b) => (b ? round1(100 * (a - b) / b) : null);
const clock = s => (s === null ? "-" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

async function overview(f, set) {
  const goal = set.holdGoalSeconds;
  const [cur, ly, hold, holdLy, within, withinLy] = await Promise.all([
    counts(f), counts(f, { ly: true }), holdStats(f), holdStats({ ...f, from: addYears(f.from, -1), to: addYears(f.to, -1) }),
    counts(f, { extra: `hold_seconds <= ${goal}` }), counts(f, { ly: true, extra: `hold_seconds <= ${goal}` }),
  ]);
  const w = where(f), wl = where(f, { ly: true });
  const natures = await q(`WITH c AS (SELECT nature, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1),
      l AS (SELECT nature, count(*)::int AS n FROM cad_incidents WHERE ${wl.sql.replace(/\$(\d+)/g, (_, i) => `$${Number(i) + w.params.length}`)} GROUP BY 1)
    SELECT c.nature, c.n, coalesce(l.n, 0) AS ly FROM c LEFT JOIN l USING (nature) ORDER BY c.n DESC, c.nature LIMIT 10`, [...w.params, ...wl.params]);
  const agencies = await q(`WITH c AS (SELECT agency, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1),
      l AS (SELECT agency, count(*)::int AS n FROM cad_incidents WHERE ${wl.sql.replace(/\$(\d+)/g, (_, i) => `$${Number(i) + w.params.length}`)} GROUP BY 1)
    SELECT c.agency, c.n, coalesce(l.n, 0) AS ly FROM c LEFT JOIN l USING (agency) ORDER BY c.n DESC`, [...w.params, ...wl.params]);
  const heat = await heatmap(f);
  const [quality] = await q(`SELECT count(*)::int AS n,
      count(*) FILTER (WHERE i.nature <> '' AND left(i.nature, 1) <> '.')::int AS named,
      count(*) FILTER (WHERE i.dispatched AND NOT i.self_initiated)::int AS holdable,
      count(*) FILTER (WHERE i.dispatched AND NOT i.self_initiated AND i.hold_seconds IS NOT NULL)::int AS measured,
      count(*) FILTER (WHERE i.call_taker <> '' OR i.self_initiated)::int AS taker
    FROM cad_incidents i WHERE ${w.sql.replace(/received_at|agency|dispatched/g, m => `i.${m}`)}`, w.params);

  // Observations: short, plain statements with the numbers behind them
  const obs = [];
  const change = pct(cur.n, ly.n);
  if (ly.n) obs.push({ kind: change > 2 ? "up" : change < -2 ? "down" : "level",
    title: change > 2 ? `Incidents up ${change}% on the same period last year` : change < -2 ? `Incidents down ${Math.abs(change)}% on the same period last year` : "Incidents level with the same period last year",
    detail: `${cur.n.toLocaleString()} in this window vs ${ly.n.toLocaleString()} last year, same dates.` });
  const byHour = new Map();
  for (const c of heat) { const h = byHour.get(c.hour) || { sum: 0, n: 0 }; if (c.hold !== null) { h.sum += c.hold * c.measured; h.n += c.measured; } byHour.set(c.hour, h); }
  const worst = [...byHour].filter(([, v]) => v.n >= 20).map(([h, v]) => ({ h, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg)[0];
  if (worst && hold.avg !== null) obs.push({ kind: "hold", title: `Longest average hold: ${pad(worst.h)}:00–${pad((worst.h + 1) % 24)}:00 at ${clock(worst.avg)}`,
    detail: `Against ${clock(hold.avg)} across all hours, from ${worst.n} measured holds in that hour.` });
  if (cur.measured) obs.push({ kind: "goal", title: `${round1(100 * within.n / cur.measured)}% assigned within ${clock(goal)}`,
    detail: cur.measured && withinLy.n !== undefined && ly.measured ? `Same dates last year: ${round1(100 * withinLy.n / ly.measured)}%. Goal set in Data & settings.` : "Goal set in Data & settings." });
  if (natures[0] && cur.n) {
    const top10 = natures.reduce((s, r) => s + r.n, 0);
    obs.push({ kind: "natures", title: `Top ${natures.length} problem natures are ${round1(100 * top10 / cur.n)}% of calls`,
      detail: `Largest: ${natures[0].nature || "(blank)"} with ${natures[0].n.toLocaleString()} calls (${round1(100 * natures[0].n / cur.n)}%).` });
    const mover = natures.filter(r => r.ly >= 10).map(r => ({ ...r, d: r.n - r.ly })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    if (mover && mover.d) obs.push({ kind: mover.d > 0 ? "up" : "down", title: `Biggest mover in the top ${natures.length}: ${mover.nature}`,
      detail: `${mover.d > 0 ? "+" : ""}${mover.d} calls (${pct(mover.n, mover.ly) > 0 ? "+" : ""}${pct(mover.n, mover.ly)}%) against the same period last year.` });
  }
  void holdLy;
  return {
    kpis: {
      incidents: { value: cur.n, ly: ly.n }, dailyAvg: { value: round1(cur.n / f.days), ly: round1(ly.n / f.days) },
      measured: { value: cur.measured, ly: ly.measured }, avgHold: { value: hold.avg, ly: holdLy.avg },
      p90Hold: { value: hold.p90, ly: holdLy.p90 },
      withinGoal: { value: cur.measured ? round1(100 * within.n / cur.measured) : null, ly: ly.measured ? round1(100 * withinLy.n / ly.measured) : null },
    },
    hold, observations: obs,
    natures: natures.map(r => ({ nature: r.nature, n: r.n, ly: r.ly, share: cur.n ? round1(100 * r.n / cur.n) : 0 })),
    agencies: agencies.map(r => ({ agency: r.agency || "(none)", n: r.n, ly: r.ly })),
    heatmap: heat, histogram: await histogram(f),
    series: await series(f, false, set.tailMinutes * 60), seriesLy: await series(f, true, set.tailMinutes * 60),
    quality: {
      n: quality.n, natureNamed: quality.named,
      holdable: quality.holdable, holdMeasured: quality.measured, callTaker: quality.taker,
      placeholderNatures: quality.n - quality.named,
    },
  };
}

async function volume(f, set) {
  const tail = set.tailMinutes * 60;
  const [s, sl] = await Promise.all([series(f, false, tail), series(f, true, tail)]);
  const w = where(f);
  const dowRows = await q(`SELECT extract(isodow FROM received_at)::int AS d, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, w.params);
  const wd = weekdayCounts(f.from, f.to);
  const dow = [1, 2, 3, 4, 5, 6, 7].map(d => ({ dow: d, avg: wd[d] ? round1((dowRows.find(r => r.d === d)?.n || 0) / wd[d]) : null, days: wd[d] }));
  const hourRows = await q(`SELECT extract(hour FROM received_at)::int AS h, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1`, w.params);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, n: hourRows.find(r => r.h === h)?.n || 0, avg: round1((hourRows.find(r => r.h === h)?.n || 0) / f.days) }));
  const days = await q(`SELECT received_at::date::text AS d, count(*)::int AS n FROM cad_incidents WHERE ${w.sql} GROUP BY 1 ORDER BY 2 DESC, 1`, w.params);
  const total = days.reduce((a, r) => a + r.n, 0);
  // Trend summary, anchored on the last loaded day (not today: a sync that hasn't run would look like a collapse)
  const anchor = f.lastDay, periods = [["Last 7 days", addDays(anchor, -6)], ["Last 30 days", addDays(anchor, -29)], ["Last 90 days", addDays(anchor, -89)], ["Year to date", `${anchor.slice(0, 4)}-01-01`]];
  const allCalls = { ...f, calls: "all" };
  const trend = [];
  for (const [label, start] of periods) {
    const len = daysBetween(start, anchor) + 1;
    const [c, prior, lyc, call, callLy] = await Promise.all([
      counts(f, { from: start, to: anchor }), counts(f, { from: addDays(start, -len), to: addDays(start, -1) }),
      counts(f, { from: addYears(start, -1), to: addYears(anchor, -1) }),
      counts(allCalls, { from: start, to: anchor }), counts(allCalls, { from: addYears(start, -1), to: addYears(anchor, -1) }),
    ]);
    trend.push({ label, from: start, to: anchor, days: len, n: c.n, prior: prior.n, vsPrior: pct(c.n, prior.n), ly: lyc.n, vsLy: pct(c.n, lyc.n),
      dispatched: call.dispatched, dispatchedLy: callLy.dispatched, dispatchedVsLy: pct(call.dispatched, callLy.dispatched),
      dailyAvg: round1(c.n / len), selfPct: call.n ? round1(100 * call.self / call.n) : null, selfPctLy: callLy.n ? round1(100 * callLy.self / callLy.n) : null });
  }
  return {
    series: s, seriesLy: sl, dow, hours, trend, anchor,
    busiest: days[0] ? { day: days[0].d, n: days[0].n } : null,
    quietest: days.length ? (() => { const all = new Map(days.map(r => [r.d, r.n])); let best = null; for (let d = f.from; d <= f.to; d = addDays(d, 1)) { const n = all.get(d) || 0; if (!best || n < best.n) best = { day: d, n }; } return best; })() : null,
    total, last7: await (async () => { const a = await counts(f, { from: addDays(f.to, -6), to: f.to }), b = await counts(f, { from: addDays(f.to, -13), to: addDays(f.to, -7) }); return { n: a.n, prior: b.n, change: pct(a.n, b.n) }; })(),
  };
}

async function callTaking(f, set) {
  const tail = set.tailMinutes * 60, goal = set.holdGoalSeconds;
  const w = where(f);
  const byHour = await q(`SELECT extract(hour FROM received_at)::int AS h, count(hold_seconds)::int AS n, avg(hold_seconds)::float AS avg,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY hold_seconds)::float AS p90 FROM cad_incidents WHERE ${w.sql} AND hold_seconds IS NOT NULL GROUP BY 1`, w.params);
  const byPriority = await q(`SELECT priority, count(*)::int AS calls, count(hold_seconds)::int AS n, avg(hold_seconds)::float AS avg,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY hold_seconds)::float AS p90, count(*) FILTER (WHERE hold_seconds <= ${goal})::int AS within
    FROM cad_incidents WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  const [proc] = await q(`SELECT count(process_seconds)::int AS n, avg(process_seconds)::float AS avg,
      ${P("process_seconds", [50, 90])} FROM cad_incidents WHERE ${w.sql} AND process_seconds IS NOT NULL`, w.params);
  const longest = await q(`SELECT incident_number, agency, received_at::text AS received, nature, priority, hold_seconds AS hold FROM cad_incidents
    WHERE ${w.sql} AND hold_seconds IS NOT NULL ORDER BY hold_seconds DESC, received_at LIMIT 15`, w.params);
  const [t] = await q(`SELECT count(hold_seconds)::int AS n, count(*) FILTER (WHERE hold_seconds > ${tail})::int AS tail, count(*) FILTER (WHERE hold_seconds <= ${goal})::int AS within
    FROM cad_incidents WHERE ${w.sql}`, w.params);
  return {
    hold: await holdStats(f), histogram: await histogram(f), heatmap: await heatmap(f), series: await series(f, false, tail),
    byHour: Array.from({ length: 24 }, (_, h) => { const r = byHour.find(x => x.h === h); return { hour: h, n: r?.n || 0, avg: r ? round1(r.avg) : null, p90: r ? round1(r.p90) : null }; }),
    byPriority: byPriority.map(r => ({ priority: r.priority || "(none)", calls: r.calls, n: r.n, avg: round1(num(r.avg)), p90: round1(num(r.p90)), withinPct: r.n ? round1(100 * r.within / r.n) : null })),
    processing: { n: proc.n, avg: round1(num(proc.avg)), p50: round1(num(proc.p50)), p90: round1(num(proc.p90)) },
    tail: { n: t.n, over: t.tail, pct: t.n ? round1(100 * t.tail / t.n) : null, minutes: set.tailMinutes },
    withinGoal: { n: t.within, pct: t.n ? round1(100 * t.within / t.n) : null, seconds: goal },
    longest: longest.map(r => ({ ...r, received: r.received.slice(0, 16) })),
  };
}

// CAD ids that are a CAD-to-CAD interface, not a person (.env CAD_TRANSFER_IDS, comma-separated)
const TRANSFER_IDS = String(process.env.CAD_TRANSFER_IDS || "C2CI").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
const TRANSFER_LABEL = String(process.env.CAD_TRANSFER_LABEL || "Transfer from EBR CAD (C2C)");
async function people(f, set, role) {
  const goal = set.holdGoalSeconds;
  const col = role === "dispatchers" ? "dispatcher" : "call_taker";
  const metric = role === "dispatchers" ? "hold_seconds" : "process_seconds";
  const w = where(f, { extra: role === "takers" ? "NOT self_initiated" : "" });
  const rows = await q(`SELECT i.${col} AS cad_id, coalesce(nullif(o.name, ''), u.full_name, '') AS name, count(*)::int AS calls,
      count(i.${metric})::int AS n, avg(i.${metric})::float AS avg,
      ${P(`i.${metric}`, [50, 90])},
      count(*) FILTER (WHERE i.${metric} <= ${goal})::int AS within,
      count(*) FILTER (WHERE extract(hour FROM i.received_at) >= 19 OR extract(hour FROM i.received_at) < 7)::int AS nights
    FROM cad_incidents i LEFT JOIN cad_operators o ON o.cad_id = i.${col} LEFT JOIN users u ON u.id = o.user_id
    WHERE ${w.sql.replace(/received_at|agency|dispatched|self_initiated/g, m => `i.${m}`)} GROUP BY 1, 2 ORDER BY calls DESC`, w.params);
  // Calls with no call taker / dispatcher recorded aren't a person: left out of the table (and the shares), counted in `unrecorded`
  const blank = rows.filter(r => !String(r.cad_id || "").trim());
  const unrecorded = blank.reduce((s, r) => s + r.calls, 0);
  rows.splice(0, rows.length, ...rows.filter(r => String(r.cad_id || "").trim()));
  const total = rows.reduce((s, r) => s + r.calls, 0);
  // Calls handed over from another center's CAD (CAD2CAD) aren't a person: their own line, at the bottom
  const transfer = r => TRANSFER_IDS.includes(String(r.cad_id || "").trim().toUpperCase()) || /^cad ?2 ?cad$/i.test(String(r.name || "").trim());
  rows.sort((a, b) => transfer(a) - transfer(b));
  return {
    role, metric: role === "dispatchers" ? "hold" : "processing", goal, total, unrecorded,
    people: rows.map(r => ({ cadId: r.cad_id || "", transfer: transfer(r), name: transfer(r) ? TRANSFER_LABEL : r.name, calls: r.calls, share: total ? round1(100 * r.calls / total) : 0,
      measured: r.n, avg: round1(num(r.avg)), p50: round1(num(r.p50)), p90: round1(num(r.p90)),
      withinPct: r.n && role === "dispatchers" ? round1(100 * r.within / r.n) : null, nightsPct: r.calls ? round1(100 * r.nights / r.calls) : 0 })),
  };
}

// ---- Admin (manage level) -------------------------------------------------------------------------
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Comms statistics', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, detail]);
}
async function admin() {
  const c = config();
  return {
    configured: statsConfigured(), testFile: !!c.testFile, view: c.view, start: c.start, syncTime: `${pad(c.syncH)}:${pad(c.syncM)}`, lookback: c.lookback,
    running: !!state.running, settings: await settings(),
    syncs: await q("SELECT id, kind, started_at, finished_at, range_from::text, range_to::text, rows, error, file_name, by_name FROM cad_stats_sync ORDER BY id DESC LIMIT 15"),
    agencies: await q("SELECT agency, count(*)::int AS n FROM cad_incidents WHERE agency <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 30"),
    // every agency + zone with its call count, for "Which calls count" (blank = the duplicate / linked / test records)
    areas: await q(`SELECT agency, zone, count(*)::int AS n, count(*) FILTER (WHERE nature = '')::int AS untyped,
        count(*) FILTER (WHERE dispatched)::int AS dispatched FROM cad_incidents GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 1000`),
    sources: await q("SELECT source, count(*)::int AS n, min(received_at)::date::text AS first, max(received_at)::date::text AS last FROM cad_incidents GROUP BY 1"),
    operators: await q(`WITH t AS (SELECT call_taker AS id, count(*)::int AS n FROM cad_incidents GROUP BY 1),
        d AS (SELECT dispatcher AS id, count(*)::int AS n FROM cad_incidents GROUP BY 1)
      SELECT o.cad_id, o.name, o.user_id, coalesce(u.full_name, '') AS user_name, coalesce(t.n, 0) AS taken, coalesce(d.n, 0) AS dispatched
      FROM cad_operators o LEFT JOIN users u ON u.id = o.user_id LEFT JOIN t ON t.id = o.cad_id LEFT JOIN d ON d.id = o.cad_id
      ORDER BY (o.name = '' AND o.user_id IS NULL) DESC, o.cad_id`),
    users: await q("SELECT id, full_name AS name FROM users WHERE active AND account_status = 'approved' ORDER BY full_name"),
  };
}
const CATEGORIES = ["", "completed", "canceled", "false_alarm", "duplicate", "unfounded", "other"];

// ---- Reports --------------------------------------------------------------------------------------
const BLOCKS = new Set(["heading", "text", "kpis", "observations", "volume", "dow", "hours", "trend", "agencies", "natures", "dispositions", "heatmap", "percentiles", "priority", "longest", "takers", "dispatchers"]);
function cleanBlocks(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).filter(b => b && BLOCKS.has(b.type))
    .map(b => ({ id: isUuid(b.id) ? b.id : crypto.randomUUID(), type: b.type, title: txt(b.title, 120), text: txt(b.text, 4000) }));
}
async function reports(user) {
  return (await q(`SELECT r.id, r.owner_id, u.full_name AS owner, r.title, r.report_type, r.prepared_by, r.notes, r.window_kind, r.window_from::text, r.window_to::text,
      r.agency, r.blocks, r.shared, r.updated_at FROM comms_reports r JOIN users u ON u.id = r.owner_id
    WHERE r.owner_id = $1 OR r.shared ORDER BY (r.owner_id = $1) DESC, r.updated_at DESC`, [user.id])).map(r => ({
    id: r.id, mine: r.owner_id === user.id, owner: r.owner, title: r.title, reportType: r.report_type, preparedBy: r.prepared_by, notes: r.notes,
    windowKind: r.window_kind, from: r.window_from, to: r.window_to, agency: r.agency, blocks: r.blocks, shared: r.shared, updatedAt: r.updated_at }));
}

// Which units the Apparatus report shows by default: SGFD units are <type><station><digit> (EG613, LD618, MD687) plus chiefs (SG…)
const DEFAULT_UNIT_PATTERN = "^([A-Z]{1,3}6\\d{1,2}|SG\\d+)$";
export async function unitSettings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'stats_units'")).rows[0]?.value;
  const d = (typeof v === "string" ? JSON.parse(v) : v) || {};
  return { pattern: typeof d.pattern === "string" ? d.pattern : DEFAULT_UNIT_PATTERN };
}

// ---- Routes ---------------------------------------------------------------------------------------
export async function handleStats(req, res, parts, user, send, jsonBody, url) {
  if (!(await hasAccess(pool, user, "stats", "view"))) throw err(403, "Communications statistics need permission (User Management > Permissions > Comms statistics).");
  const canPeople = await hasAccess(pool, user, "stats", "edit");
  const canManage = await hasAccess(pool, user, "stats", "manage");
  const what = parts[2];

  if (what === "meta" && req.method === "GET") {
    const b = await bounds();
    const sp = [], sc = scopeSql(await settings(), sp);
    const ag = await q(`SELECT agency, count(*)::int AS n FROM cad_incidents ${sc ? `WHERE ${sc}` : ""} GROUP BY 1 ORDER BY 2 DESC`, sp);
    const last = (await q("SELECT finished_at, rows, error, kind FROM cad_stats_sync WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1"))[0] || null;
    const lastGood = (await q("SELECT max(finished_at) AS t FROM cad_stats_sync WHERE error = ''"))[0].t;
    return send(res, 200, { configured: statsConfigured(), ...b, agencies: ag.map(r => ({ agency: r.agency, n: r.n })), settings: await settings(),
      lastSync: last ? { at: last.finished_at, rows: last.rows, kind: last.kind, error: last.error ? (canManage ? last.error : "The last CAD sync didn't finish.") : "" } : null,
      lastGoodSync: lastGood, running: !!state.running, canPeople, canManage,
      unnamedOperators: (await q("SELECT count(*)::int AS n FROM cad_operators WHERE name = '' AND user_id IS NULL"))[0].n });
  }
  if (req.method === "GET" && ["overview", "volume", "calltaking", "people"].includes(what)) {
    const f = await readFilters(url), set = await settings();
    const filters = { from: f.from, to: f.to, agency: f.agency, calls: f.calls, days: f.days, lastDay: f.lastDay };
    if (what === "overview") return send(res, 200, { filters, ...(await overview(f, set)) });
    if (what === "volume") return send(res, 200, { filters, ...(await volume(f, set)) });
    if (what === "calltaking") return send(res, 200, { filters, ...(await callTaking(f, set)) });
    if (!canPeople) throw err(403, "Call taker and dispatcher statistics need the Comms statistics \"edit\" permission.");
    return send(res, 200, { filters, ...(await people(f, set, url.searchParams.get("role") === "dispatchers" ? "dispatchers" : "takers")) });
  }

  // Apparatus: calls per unit per shift (shift days start at ALADTEC_SHIFT_START, 07:00)
  if (what === "apparatus" && req.method === "GET") {
    const c = config();
    const from = isDay(url.searchParams.get("from") || "") ? url.searchParams.get("from") : null, to = isDay(url.searchParams.get("to") || "") ? url.searchParams.get("to") : from;
    const stored = (await q("SELECT min(assigned_at)::text AS first, max(assigned_at)::text AS last, count(*)::int AS n FROM cad_unit_responses"))[0];
    const saved = await unitSettings();
    if (!from || to < from) return send(res, 200, { configured: unitsConfigured(c), stored, pattern: saved.pattern, canManage, days: [], units: [] });
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86400000) > 366) throw err(400, "Pick a range of a year or less.");
    const [h, m] = c.shiftStart.split(":").map(Number), off = `${h} hours ${m} minutes`;
    const rows = await q(`SELECT unit, ((assigned_at - interval '${off}')::date)::text AS day, count(DISTINCT incident_id)::int AS calls,
        count(DISTINCT incident_id) FILTER (WHERE arrived_at IS NOT NULL)::int AS arrived,
        coalesce(sum(LEAST(extract(epoch FROM cleared_at - assigned_at), 86400)) FILTER (WHERE cleared_at > assigned_at), 0)::float AS busy
      FROM cad_unit_responses WHERE assigned_at >= ($1::date + interval '${off}') AND assigned_at < ($2::date + 1 + interval '${off}') GROUP BY 1, 2`, [from, to]);
    let rx = null;
    const pattern = url.searchParams.has("pattern") ? String(url.searchParams.get("pattern") || "").slice(0, 200) : saved.pattern;
    if (pattern) { try { rx = new RegExp(pattern, "i"); } catch { throw err(400, "That unit filter isn't a valid pattern."); } if (risky(pattern)) throw err(400, "That unit filter is too complicated. Use unit names separated by |."); }
    const { fireShift } = await import("../src/shifts.js");
    const days = []; for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, shift: fireShift(d) });
    const byUnit = new Map();
    for (const r of rows) {
      if (rx && !rx.test(r.unit)) continue;
      const u = byUnit.get(r.unit) || { unit: r.unit, calls: 0, arrived: 0, busySeconds: 0, byDay: {} };
      u.calls += r.calls; u.arrived += r.arrived; u.busySeconds += r.busy; u.byDay[r.day] = r.calls; byUnit.set(r.unit, u);
    }
    const units = [...byUnit.values()].map(u => ({ ...u, busySeconds: Math.round(u.busySeconds), perShift: Math.round(10 * u.calls / days.length) / 10,
      busiest: Object.entries(u.byDay).sort((a, b) => b[1] - a[1])[0] || null })).sort((a, b) => b.calls - a.calls || a.unit.localeCompare(b.unit));
    return send(res, 200, { configured: unitsConfigured(c), stored, pattern, savedPattern: saved.pattern, canManage, shiftStart: c.shiftStart, from, to, days, units,
      totals: { calls: units.reduce((a, u) => a + u.calls, 0), units: units.length } });
  }
  if (what === "apparatus" && req.method === "POST") {
    if (!canManage) throw err(403, "Only Comms statistics managers can change the default unit filter.");
    const b = await jsonBody(req);
    const pattern = String(b.pattern ?? "").slice(0, 200);
    if (pattern) { try { new RegExp(pattern); } catch { throw err(400, "That unit filter isn't a valid pattern."); } if (risky(pattern)) throw err(400, "That unit filter is too complicated. Use unit names separated by |."); }
    await pool.query("INSERT INTO settings (key, value) VALUES ('stats_units', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify({ pattern })]);
    await audit(user, "Changed the apparatus unit filter", pattern || "(all units)");
    return send(res, 200, { ok: true });
  }

  if (what === "reports") {
    if (req.method === "GET" && !parts[3]) return send(res, 200, { reports: await reports(user) });
    if (req.method === "POST" && parts[3] && parts[4] === "remove") {
      if (!isUuid(parts[3])) throw err(404, "That report wasn't found.");
      const r = await pool.query("DELETE FROM comms_reports WHERE id = $1 AND (owner_id = $2 OR $3)", [parts[3], user.id, user.role === "master"]);
      if (!r.rowCount) throw err(404, "Only the person who saved a report can delete it.");
      return send(res, 200, { ok: true, reports: await reports(user) });
    }
    if (req.method === "POST" && !parts[3]) {
      const b = await jsonBody(req);
      const title = txt(b.title, 120);
      if (!title) throw err(400, "Give the report a title.");
      const kind = ["last7", "last30", "lastMonth", "custom"].includes(b.windowKind) ? b.windowKind : "last7";
      const vals = [title, txt(b.reportType, 60), txt(b.preparedBy, 120), txt(b.notes, 2000), kind, kind === "custom" && isDay(b.from) ? b.from : null,
        kind === "custom" && isDay(b.to) ? b.to : null, txt(b.agency, 60), JSON.stringify(cleanBlocks(b.blocks)), b.shared === true];
      let id = isUuid(b.id) ? b.id : null;
      if (id) {
        const r = await pool.query(`UPDATE comms_reports SET title = $3, report_type = $4, prepared_by = $5, notes = $6, window_kind = $7, window_from = $8, window_to = $9,
          agency = $10, blocks = $11, shared = $12, updated_at = now() WHERE id = $1 AND owner_id = $2`, [id, user.id, ...vals]);
        if (!r.rowCount) id = null;                                    // someone else's shared report: save a copy
      }
      if (!id) {
        id = crypto.randomUUID();
        await pool.query(`INSERT INTO comms_reports (id, owner_id, title, report_type, prepared_by, notes, window_kind, window_from, window_to, agency, blocks, shared)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [id, user.id, ...vals]);
      }
      return send(res, 200, { ok: true, id, reports: await reports(user) });
    }
  }

  if (what === "admin") {
    if (!canManage) throw err(403, "Only Comms statistics managers can do that.");
    if (req.method === "GET" && !parts[3]) return send(res, 200, await admin());
    if (req.method === "POST" && parts[3] === "sync") {
      if (!statsConfigured()) throw err(400, "The CAD statistics view isn't set up yet (CAD_STATS_VIEW and the CAD_SQL_* settings in .env).");
      if (state.running) return send(res, 200, { ok: true, running: true });
      const full = (await jsonBody(req).catch(() => ({}))).full === true;
      // A full reload has its own 5-minute limit, so a quick Sync now doesn't hold it up
      const lastKey = full ? "lastFull" : "lastManual";
      if (Date.now() - (state[lastKey] || 0) < 5 * 60_000) throw err(429, full ? "A full reload started in the last 5 minutes. Try again shortly." : "A sync ran in the last 5 minutes. Try again shortly.");
      state[lastKey] = Date.now();
      syncNow("manual", { full }).catch(() => {});
      await audit(user, full ? "Started a full CAD reload" : "Started a CAD sync", "");
      return send(res, 200, { ok: true, running: true });
    }
    const b = req.method === "POST" ? await jsonBody(req) : {};
    if (req.method === "POST" && parts[3] === "upload") {
      const data = Buffer.from(String(b.data || ""), "base64");
      if (!data.length) throw err(400, "Choose a CSV or Excel file.");
      if (data.length > 25 * 1024 * 1024) throw err(400, "That file is over 25 MB.");
      const { readSheets } = await import("./documents.js");
      const parsed = parseUpload(readSheets(b.fileName, data, 400000), txt(b.agency, 60));
      if (!parsed.rows.length) throw err(400, `No incidents found. ${parsed.errors.slice(0, 3).join(" ")}`);
      if (b.preview === true) {
        const days = parsed.rows.map(x => x.received.slice(0, 10)).sort();
        const hold = parsed.rows.map(x => x.hold).filter(v => v !== null), proc = parsed.rows.map(x => x.process).filter(v => v !== null);
        const pc = (l, n) => (l.length ? Math.round(1000 * l.filter(v => v <= n).length / l.length) / 10 : null);
        return send(res, 200, { preview: true, rows: parsed.rows.length, errors: parsed.errors.slice(0, 10), skipped: parsed.errors.length, columns: parsed.columns,
          hasAgency: parsed.hasAgency, from: days[0], to: days[days.length - 1], agencies: [...new Set(parsed.rows.map(x => x.agency))].slice(0, 10),
          holdWithin60: pc(hold, 60), processMedian: proc.length ? proc.sort((a, z) => a - z)[Math.floor(proc.length / 2)] : null,
          sample: parsed.rows.slice(0, 6).map(x => ({ number: x.number, agency: x.agency, received: x.received, queued: x.queued, assigned: x.assigned, hold: x.hold, process: x.process })) });
      }
      if (!parsed.hasAgency && !txt(b.agency, 60)) throw err(400, `This file has no Agency column: enter the agency these calls belong to (e.g. ${brand().short}).`);
      const r = await importIncidents(user, b.fileName, parsed.rows);
      return send(res, 200, { ok: true, ...r, skipped: parsed.errors.length, admin: await admin() });
    }
    if (req.method === "POST" && parts[3] === "dispositions") {
      const code = txt(b.code, 60);
      if (!code) throw err(400, "Which code?");
      const category = CATEGORIES.includes(b.category) ? b.category : "";
      await pool.query(`INSERT INTO cad_dispositions (code, description, category) VALUES ($1, $2, $3)
        ON CONFLICT (code) DO UPDATE SET description = $2, category = $3`, [code, txt(b.description, 120), category]);
      await audit(user, "Described a disposition code", `${code}: ${txt(b.description, 120)}${category ? ` (${category})` : ""}`);
      return send(res, 200, await admin());
    }
    if (req.method === "POST" && parts[3] === "operators") {
      const cadId = txt(b.cadId, 40);
      if (!cadId) throw err(400, "Which CAD id?");
      const userId = isUuid(b.userId) ? b.userId : null;
      await pool.query(`INSERT INTO cad_operators (cad_id, name, user_id) VALUES ($1, $2, $3)
        ON CONFLICT (cad_id) DO UPDATE SET name = $2, user_id = $3`, [cadId, txt(b.name, 80), userId]);
      await audit(user, "Named a CAD operator id", `${cadId}: ${txt(b.name, 80)}`);
      return send(res, 200, await admin());
    }
    if (req.method === "POST" && parts[3] === "scope") {
      const seen = new Set(), include = [];
      for (const x of Array.isArray(b.include) ? b.include.slice(0, 1000) : []) {
        const agency = txt(x?.agency, 60), zone = x?.zone === "*" ? "*" : txt(x?.zone, 40);
        const k = agency + "\x1e" + zone;
        if (!seen.has(k)) { seen.add(k); include.push({ agency, zone }); }
      }
      const dropBlank = b.dropBlank !== false;
      await pool.query("UPDATE cad_stats_settings SET include = $1::jsonb, drop_blank = $2", [JSON.stringify(include), dropBlank]);
      await audit(user, "Changed which calls count", include.length
        ? `${include.map(x => `${x.agency || "(no agency)"}${x.zone === "*" ? "" : ` zone ${x.zone || "(none)"}`}`).join(", ").slice(0, 900)}${dropBlank ? "; blanks left out" : ""}`
        : `every call${dropBlank ? "; blanks left out" : ""}`);
      return send(res, 200, await admin());
    }
    if (req.method === "POST" && parts[3] === "settings") {
      const goal = Math.round(Number(b.holdGoalSeconds)), tail = Math.round(Number(b.tailMinutes));
      if (!(goal >= 5 && goal <= 3600) || !(tail >= 1 && tail <= 240)) throw err(400, "Goal: 5 to 3600 seconds. Tail: 1 to 240 minutes.");
      await pool.query("UPDATE cad_stats_settings SET hold_goal_seconds = $1, tail_minutes = $2", [goal, tail]);
      await audit(user, "Changed statistics settings", `hold goal ${goal} s, tail over ${tail} min`);
      return send(res, 200, await admin());
    }
  }
  throw err(404, "Not found.");
}
