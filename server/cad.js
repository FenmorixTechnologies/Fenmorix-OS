// Active calls from CentralSquare Enterprise CAD, read from one read-only SQL Server view.
//
// The CAD admin creates a view (see scripts/cad-view-template.sql) with these columns
// (names are case-insensitive; extra columns are ignored):
//   incident_id      unique id of the incident (required)
//   incident_number  e.g. 2026-012345
//   call_type        e.g. "STRUCTURE FIRE", "MEDICAL"
//   priority         e.g. 1, "E", "HIGH"
//   address          street address / location
//   city             optional
//   cross_streets    optional
//   latitude, longitude   optional (map link)
//   status           e.g. DISPATCHED, ENROUTE, ON SCENE
//   units            assigned units, comma-separated, e.g. "E61, M61, BC1"
//   received_at      when the call came in (datetime)
//   dispatched_at    optional
//   closed_at        NULL while the call is active (rows with a value are skipped)
//
// .env:
//   CAD_SQL_SERVER=cad-sql.cad.local      (name or IP of the CAD SQL Server)
//   CAD_SQL_PORT=1433
//   CAD_SQL_DATABASE=...
//   CAD_SQL_USER=nexus_reader              (SQL login that can only SELECT the view)
//   CAD_SQL_PASSWORD=...
//   CAD_SQL_VIEW=dbo.vw_nexus_active_calls
//   CAD_SQL_ENCRYPT=true                   (encrypt the connection)
//   CAD_SQL_TRUST_CERT=false               (true only if the SQL Server uses a self-signed certificate)
//   CAD_REFRESH_SECONDS=15                 (10 at the least; the page checks Nexus just as often)
//   CAD_MAX_AGE_HOURS=24                   (calls with no units received longer ago than this are treated as stale)
//   CAD_PENDING_MAX_MINUTES=10             (a call with no units on it this long is left off: units are normally assigned in 2-3 minutes,
//                                           and CAD keeps records like that open for hours; CAD_PENDING_MAX_HOURS still works;
//                                           a call with no units AND no call type is left off right away: duplicate / linked / test record)
//   CAD_WORKING_MAX_DAYS=7                 (a call that still has units on it stays past CAD_MAX_AGE_HOURS, up to this many days)
// Two CAD records at the same address within 5 minutes are shown as one call (CAD sometimes opens a second record).
// Calls with no address and no map point are left off too (CAD's placeholder / unfinished records).
//   CAD_TEST_FILE=                         (testing: read calls from a JSON file instead of SQL)
//
// The query asks for open calls (closed column empty) from the last CAD_MAX_AGE_HOURS, newest first. A view that has one
// row per unit (a unit / unit_id column) is fine: rows are merged by incident_id and the units collected.
//
// Only what crews see on the station alert is shown: no caller, narrative or patient details.
import fs from "node:fs/promises";
import { brand } from "./brand.js";

const state = { pool: null, timer: null, snapshot: { configured: false, updatedAt: null, error: "", calls: [] } };

function config() {
  const e = process.env;
  return {
    server: String(e.CAD_SQL_SERVER || "").trim(), port: Number(e.CAD_SQL_PORT) || 1433,
    database: String(e.CAD_SQL_DATABASE || "").trim(), user: String(e.CAD_SQL_USER || "").trim(), password: String(e.CAD_SQL_PASSWORD || ""),
    view: String(e.CAD_SQL_VIEW || "dbo.vw_nexus_active_calls").trim(),
    encrypt: String(e.CAD_SQL_ENCRYPT || "true").toLowerCase() !== "false",
    trustCert: String(e.CAD_SQL_TRUST_CERT || "false").toLowerCase() === "true",
    seconds: Math.max(10, Number(e.CAD_REFRESH_SECONDS) || 15),
    testFile: String(e.CAD_TEST_FILE || "").trim(),
    // Made-up calls (server/cadDemo.js): CAD_DEMO=on, or a sandbox with no CAD set up
    demo: /^(1|on|true|yes)$/i.test(String(e.CAD_DEMO || "")) || (/^(1|on|true|yes)$/i.test(String(e.SANDBOX || "")) && !e.CAD_TEST_FILE && !e.CAD_SQL_SERVER && !/^(0|off|false|no)$/i.test(String(e.CAD_DEMO || ""))),
    maxAgeHours: Math.min(168, Math.max(1, Number(e.CAD_MAX_AGE_HOURS) || 24)),
    pendingHours: Number(e.CAD_PENDING_MAX_MINUTES) > 0 ? Math.min(2880, Math.max(2, Number(e.CAD_PENDING_MAX_MINUTES))) / 60
      : Number(e.CAD_PENDING_MAX_HOURS) > 0 ? Math.min(48, Math.max(2 / 60, Number(e.CAD_PENDING_MAX_HOURS))) : 10 / 60,
    workingDays: Math.min(30, Math.max(1, Number(e.CAD_WORKING_MAX_DAYS) || 7)),
  };
}
export const cadConfigured = () => { const c = config(); return !!(c.demo || c.testFile || (c.server && c.database && c.user)); };

// CentralSquare stores coordinates as whole numbers in millionths of a degree with no sign (30383119, 91021720 =
// 30.383119, -91.021720). Scale anything outside the valid range back down, and put longitudes in the western
// hemisphere (CAD_WEST_LONGITUDE=off for a CAD that already sends signed values east of Greenwich).
export function fixCoord(v, kind) {
  let n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n === 0) return null;
  const limit = kind === "lat" ? 90 : 180;
  for (let i = 0; i < 9 && Math.abs(n) > limit; i++) n /= 10;
  if (Math.abs(n) > limit) return null;
  if (kind === "lon" && n > 0 && process.env.CAD_WEST_LONGITUDE !== "off") n = -n;
  return Math.round(n * 1e6) / 1e6;
}
// Unit columns: a comma-separated list per call, or one unit per row (a view joined to unit assignments)
const UNIT_COLUMNS = ["units", "assigned_units", "unit", "unit_id", "unitid", "unit_number", "unit_name", "assigned_unit", "apparatus", "unitcode", "unit_code"];
const RECEIVED_COLUMNS = ["received_at", "received", "created_at", "call_received", "time_received", "create_time"];
const CLOSED_COLUMNS = ["closed_at", "closedat", "closed", "close_time", "time_closed"];
// Unit status words, in order: the call shows the furthest along of its units
export const STATUS_ORDER = ["Dispatched", "Enroute", "On scene", "Patient contact"];
function unitWord(v) {
  const t = String(v || "").trim();
  if (/patient|contact/i.test(t)) return "Patient contact";
  if (/scene|arriv|on ?loc/i.test(t)) return "On scene";
  if (/en ?route|respond/i.test(t)) return "Enroute";
  if (/disp|assign/i.test(t)) return "Dispatched";
  return t.slice(0, 30);
}
export function callStatus(c) {
  const ranks = c.unitStatus.map(u => STATUS_ORDER.indexOf(u.status)).filter(i => i >= 0);
  if (ranks.length) return STATUS_ORDER[Math.max(...ranks)];
  if (c.status) return c.status;
  return c.units.length ? "" : "Pending";
}
// One row from the view -> what the app shows
const pick = (row, ...names) => { for (const n of names) if (row[n] !== undefined && row[n] !== null && row[n] !== "") return row[n]; return null; };
const when = v => (v ? (v instanceof Date ? v : new Date(v)).toISOString() : null);
export function normalize(raw) {
  const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  if (pick(row, ...CLOSED_COLUMNS)) return null;
  const id = pick(row, "incident_id", "id");
  if (id === null) return null;
  const lat = fixCoord(pick(row, "latitude", "lat"), "lat"), lon = fixCoord(pick(row, "longitude", "lon", "lng"), "lon");
  // Units: "EG613, MD687" or with each unit's status "EG613:On scene, MD687:Patient contact"
  const unitStatus = String(pick(row, ...UNIT_COLUMNS) || "").split(/[,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 30).map(s => {
    const i = s.indexOf(":");
    return i > 0 ? { unit: s.slice(0, i).trim().slice(0, 20), status: unitWord(s.slice(i + 1)) } : { unit: s.slice(0, 20), status: "" };
  });
  const units = unitStatus.map(u => u.unit);
  return {
    id: String(id).slice(0, 60),
    number: String(pick(row, "incident_number", "number") || "").slice(0, 40),
    type: String(pick(row, "call_type", "type", "nature") || "").slice(0, 80),
    priority: String(pick(row, "priority") ?? "").slice(0, 20),
    address: String(pick(row, "address", "location") || "").slice(0, 200),
    city: String(pick(row, "city") || "").slice(0, 60),
    crossStreets: String(pick(row, "cross_streets", "cross_street") || "").slice(0, 120),
    lat, lon,
    agency: String(pick(row, "agency", "jurisdiction") || "").slice(0, 60),
    status: String(pick(row, "status") || "").slice(0, 40),
    units, unitStatus,
    receivedAt: when(pick(row, ...RECEIVED_COLUMNS)),
    dispatchedAt: when(pick(row, "dispatched_at", "dispatched")),
  };
}

async function readSql(c) {
  if (!/^[\w\[\]]+(\.[\w\[\]]+){0,2}$/.test(c.view)) throw new Error("CAD_SQL_VIEW must be a view name like dbo.vw_nexus_active_calls");
  let sql;
  try { sql = (await import("mssql")).default; }
  catch { throw new Error("The SQL Server driver isn't installed yet. Run update.ps1 (it runs npm install)."); }
  if (!state.pool) {
    state.pool = await new sql.ConnectionPool({
      server: c.server, port: c.port, database: c.database, user: c.user, password: c.password,
      options: { encrypt: c.encrypt, trustServerCertificate: c.trustCert, useUTC: false, readOnlyIntent: true, appName: brand().app },
      pool: { max: 2, min: 0, idleTimeoutMillis: 60_000 }, connectionTimeout: 15_000, requestTimeout: 15_000,
    }).connect();
  }
  // Learn the view's columns once, then ask for the newest active calls first. A plain "TOP 200" with no ORDER BY returns
  // whichever rows SQL Server finds first, so a view that also holds closed or old calls showed a random handful.
  if (!state.columns || Date.now() - (state.columnsAt || 0) > 5 * 60_000) {   // re-learned now and then, so a changed view is picked up
    const r0 = await state.pool.request().query(`SELECT TOP 0 * FROM ${c.view}`);
    state.columns = Object.keys(r0.recordset.columns || {}); state.columnsAt = Date.now();
  }
  const col = names => state.columns.find(k => names.includes(k.toLowerCase()));
  const recv = col(RECEIVED_COLUMNS), closed = col(CLOSED_COLUMNS), units = col(UNIT_COLUMNS);
  // Recent calls, plus older ones that still have units on them (a long incident), up to CAD_WORKING_MAX_DAYS
  const recent = recv && `[${recv}] > DATEADD(hour, -${c.maxAgeHours}, GETDATE())`;
  const working = recv && units && `([${units}] IS NOT NULL AND [${units}] <> '' AND [${recv}] > DATEADD(day, -${c.workingDays}, GETDATE()))`;
  const where = [closed && `[${closed}] IS NULL`, recent && (working ? `(${recent} OR ${working})` : recent)].filter(Boolean);
  const sqlText = `SELECT TOP 2000 * FROM ${c.view}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${recv ? ` ORDER BY [${recv}] DESC` : ""}`;
  state.lastSql = sqlText;
  const r = await state.pool.request().query(sqlText);
  return r.recordset;
}

// Several rows for one call (one per unit, or per status change) become one call with every unit on it
export function mergeCalls(rows, maxAgeHours = 24, pendingHours = 10 / 60, workingDays = 7) {
  const byId = new Map(), stats = { rows: rows.length, closed: 0, noId: 0, stale: 0, merged: 0, noAddress: 0, oldPending: 0, untypedPending: 0, sameCall: 0 };
  const cutoff = Date.now() - workingDays * 86400e3, idleCut = Date.now() - maxAgeHours * 3600e3;
  for (const raw of rows) {
    const n = normalize(raw);
    if (!n) { const lower = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v])); if (pick(lower, ...CLOSED_COLUMNS)) stats.closed++; else stats.noId++; continue; }
    if (n.receivedAt && Date.parse(n.receivedAt) < cutoff) { stats.stale++; continue; }
    const have = byId.get(n.id);
    if (!have) { byId.set(n.id, n); continue; }
    stats.merged++;
    for (const u of n.unitStatus) {
      const had = have.unitStatus.find(x => x.unit === u.unit);
      if (!had) { have.unitStatus.push(u); have.units.push(u.unit); }
      else if (STATUS_ORDER.indexOf(u.status) > STATUS_ORDER.indexOf(had.status)) had.status = u.status;
    }
    for (const k of ["number", "type", "priority", "address", "city", "crossStreets", "agency", "status", "dispatchedAt"]) if (!have[k] && n[k]) have[k] = n[k];
    if (have.lat == null && n.lat != null) { have.lat = n.lat; have.lon = n.lon; }
    if (n.receivedAt && (!have.receivedAt || n.receivedAt < have.receivedAt)) have.receivedAt = n.receivedAt;
  }
  for (const c of byId.values()) c.status = callStatus(c);
  const pendingCut = Date.now() - pendingHours * 3600e3;
  const kept = [...byId.values()].filter(c => {
    if (!c.units.length && c.receivedAt && Date.parse(c.receivedAt) < idleCut) { stats.stale++; return false; }
    if (!c.address.trim() && c.lat == null) { stats.noAddress++; return false; }
    if (!c.units.length && c.receivedAt && Date.parse(c.receivedAt) < pendingCut) { stats.oldPending++; return false; }
    if (!c.units.length && (!c.type || c.type === "Call")) { stats.untypedPending++; return false; }
    return true;
  });
  // Same address within 5 minutes = the same call (CAD opened a second record): one card, both numbers, every unit
  kept.sort((a, b) => String(a.receivedAt || "").localeCompare(String(b.receivedAt || "")));
  const calls = [], addrKey = c => c.address.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  for (const c of kept) {
    const t = Date.parse(c.receivedAt || "") || 0;
    const twin = addrKey(c) && calls.find(x => addrKey(x) === addrKey(c) && Math.abs((Date.parse(x.receivedAt || "") || 0) - t) <= 5 * 60e3);
    if (!twin) { calls.push(c); continue; }
    stats.sameCall++;
    if (c.number) twin.otherNumbers = [...(twin.otherNumbers || []), c.number];
    for (const u of c.unitStatus) if (!twin.units.includes(u.unit)) { twin.unitStatus.push(u); twin.units.push(u.unit); }
    for (const k of ["type", "priority", "city", "crossStreets", "dispatchedAt"]) if (!twin[k] && c[k]) twin[k] = c[k];
    if (twin.lat == null && c.lat != null) { twin.lat = c.lat; twin.lon = c.lon; }
    if (!twin.type || twin.type === "Call") twin.type = c.type || twin.type;
    twin.status = callStatus(twin);
  }
  calls.sort((a, b) => String(b.receivedAt || "").localeCompare(String(a.receivedAt || "")));
  return { calls, stats: { ...stats, calls: calls.length, withUnits: calls.filter(x => x.units.length).length } };
}

export async function refreshCalls() {
  const c = config();
  if (!cadConfigured()) { state.snapshot = { configured: false, updatedAt: null, error: "", calls: [] }; return state.snapshot; }
  try {
    const rows = c.demo ? (await import("./cadDemo.js")).demoCalls(new Date(), Number(process.env.WEATHER_LAT) || 30.37, Number(process.env.WEATHER_LON) || -91.01)
      : c.testFile ? JSON.parse(await fs.readFile(c.testFile, "utf8")) : await readSql(c);
    const { calls, stats } = mergeCalls(rows, c.maxAgeHours, c.pendingHours, c.workingDays);
    state.snapshot = { configured: true, updatedAt: new Date().toISOString(), error: "", calls, refreshSeconds: c.seconds };
    import("./callalerts.js").then(m => m.checkCallAlerts(calls)).catch(e => console.warn(`[Call alerts] ${e.message}`));
    const cols = rows[0] ? Object.keys(rows[0]) : state.columns || [];
    const has = names => cols.find(k => names.includes(k.toLowerCase())) || null;
    state.diag = { at: state.snapshot.updatedAt, sql: c.demo ? "(demo calls)" : c.testFile ? "(test file)" : state.lastSql, columns: cols, stats,
      found: { id: has(["incident_id", "id"]), units: has(UNIT_COLUMNS), received: has(RECEIVED_COLUMNS), closed: has(CLOSED_COLUMNS), status: has(["status"]),
        latitude: has(["latitude", "lat"]) },
      unitColumnsEmpty: has(UNIT_COLUMNS) ? rows.filter(r => { const v = r[has(UNIT_COLUMNS)]; return v === null || v === undefined || String(v).trim() === ""; }).length : null,
      calls: calls.map(x => ({ number: x.number, type: x.type, status: x.status, units: x.units.length, receivedAt: x.receivedAt })) };
  } catch (e) {
    console.warn(`[CAD] ${e.message}`);
    if (state.pool) { try { await state.pool.close(); } catch {} state.pool = null; }
    state.snapshot = { ...state.snapshot, configured: true, error: e.message };
    state.columns = null;
    state.diag = { ...(state.diag || {}), at: new Date().toISOString(), error: e.message, sql: state.lastSql };
  }
  return state.snapshot;
}

export const activeCalls = () => state.snapshot;
// For master admins: what the feed looks like (column names, counts, call types and unit counts; no addresses)
export const cadDiagnostics = () => state.diag || { error: "No check has run yet." };

export function startCad() {
  if (!cadConfigured() || state.timer) return;
  const c = config();
  console.log(`CAD: checking active calls every ${c.seconds} seconds${c.demo ? " (made-up demo calls)" : c.testFile ? " (test file)" : ""}`);
  refreshCalls();
  state.timer = setInterval(refreshCalls, c.seconds * 1000);
  state.timer.unref?.();
}
