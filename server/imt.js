// IMT: incidents run under NIMS/ICS. Each operational period is its own IAP: a set of ICS forms
// (cover, 202, 203, 204s, 205, 205A, 206, 207, 208, 211, 213, 214, 220, weather, attachments).
//
//   GET  /api/imt                               incidents I can see + my access
//   POST /api/imt/incidents                     {id?, name, number, kind, location, lat, lon, description, shareAll, status}   (manage)
//   POST /api/imt/incidents/:id/remove                                                                         (manage)
//   GET  /api/imt/incidents/:id                 incident, periods, files
//   POST /api/imt/incidents/:id/periods         {starts, ends, copyFrom ("" | "previous" | periodId)}          (edit)
//   GET  /api/imt/periods/:id                   the period with its forms (+ incident)
//   POST /api/imt/periods/:id                   {starts, ends}                                                  (edit, draft)
//   POST /api/imt/periods/:id/forms             {kind, after?}  add a form                                       (edit, draft)
//   POST /api/imt/periods/:id/approve           {signature?}    IC (in the 203) or manage
//   POST /api/imt/periods/:id/reopen                                                                            (manage / IC)
//   POST /api/imt/periods/:id/notify            message everyone assigned in the 203 / 204 / 214                 (edit)
//   POST /api/imt/periods/:id/remove                                                                            (manage, draft)
//   POST /api/imt/forms/:id                     {data, version}  save                                           (edit, draft)
//   POST /api/imt/forms/:id/remove | move {dir}                                                                 (edit, draft)
//   POST /api/imt/files                         {incidentId, name, mime, data (base64), pages: [base64 png]}     (edit)
//   GET  /api/imt/files/:id                     (anyone who can see the incident)
//   POST /api/imt/files/:id/remove                                                                              (edit)
//   GET  /api/imt/library  · POST /api/imt/library {kind, items}   channels | hospitals | stations | transport   (edit)
//   GET  /api/imt/people                        roster with phones (edit)
//   GET  /api/imt/weather?lat&lon               NWS forecast (weather.js forecastAt)
//   GET  /api/imt/geocode?q=                    address -> lat/lon (US Census geocoder)
//   POST /api/imt/ai                            {periodId, task: objectives | safety | work, formId?}  draft text   (edit)
//   POST /api/imt/import                        {incidentId?, fileName, data, preview?}  read an IAP PDF into a new period (manage)
//
// Access section "imt": view = every incident's IAPs; edit = fill in forms, add periods, files; manage = create / close /
// delete incidents and periods, approve. Anyone named in a period's 203 / 204 / 214 can read that period; with
// "share with everyone" on, every signed-in person can read approved IAPs. The IC named in the 203 can approve.
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { brand } from "./brand.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const wall = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const MAX_FILE = 15 * 1024 * 1024;

export const KINDS = {
  cover: "Cover", "202": "ICS 202 Incident Objectives", "203": "ICS 203 Organization Assignment List", "204": "ICS 204 Assignment List",
  "205": "ICS 205 Incident Radio Communications Plan", "205a": "ICS 205A Communications List", "206": "ICS 206 Medical Plan",
  "207": "ICS 207 Incident Organization Chart", "208": "ICS 208 Safety Message/Plan", "211": "ICS 211 Incident Check-In List",
  "213": "ICS 213 General Message", "214": "ICS 214 Activity Log", "220": "ICS 220 Air Operations Summary", weather: "Weather forecast",
  attachment: "Attachment (map, picture, PDF)",
};
// Where each kind goes in the IAP (the order of the example IAP: cover, 202, 203, 204s, 205, 205A, 206, 207, 208, 220, maps, weather)
const ORDER = { cover: 0, "202": 10, "203": 20, "207": 25, "204": 30, "205": 40, "205a": 45, "206": 50, "208": 60, "220": 70, attachment: 80, weather: 90, "211": 100, "213": 110, "214": 120 };
const PER_PERIOD = new Set(["211", "213", "214"]);       // logs: not copied into the next period

const prep = () => ({ name: "", position: "", at: "" });
export const ROLES_203 = {
  command: ["IC/UCs", "Deputy", "Safety Officer", "Public Information Officer", "Liaison Officer"],
  planning: ["Chief", "Deputy", "Resources Unit", "Situation Unit", "Documentation Unit", "Demobilization Unit", "Technical Specialist"],
  logistics: ["Chief", "Deputy", "Support Branch Director", "Supply Unit", "Facilities Unit", "Ground Support Unit", "Service Branch Director", "Communications Unit", "Medical Unit", "Food Unit"],
  operations: ["Chief", "Deputy", "Staging Area"],
  air: ["Air Operations Branch Director", "Air Tactical Group Supervisor", "Air Support Group Supervisor", "Helibase Manager"],
  finance: ["Chief", "Deputy", "Time Unit", "Procurement Unit", "Comp/Claims Unit", "Cost Unit"],
};
export function blank(kind, ctx = {}) {
  const lib = ctx.library || {};
  switch (kind) {
    case "cover": return { title: "Incident Action Plan", subtitle: ctx.incident?.location || "", photo: null, note: "" };
    case "202": return { objectives: [""], emphasis: "", awareness: "", siteSafety: { required: false, location: "" }, other: [], prepared: prep(), approved: { name: "" } };
    case "203": return { rows: Object.entries(ROLES_203).flatMap(([section, roles]) => roles.map(role => ({ section, role, label: "", name: "", userId: null, agency: "", contact: "" }))), prepared: prep() };
    case "204": return { branch: "", division: "", group: "", staging: "", branchDirector: { name: "", contact: "" }, supervisor: { name: "", contact: "", userId: null },
      resources: [{ ident: "", leader: "", persons: "", contact: "", notes: "" }], work: "", special: "", comms: [{ name: "", contact: "" }], prepared: prep() };
    case "205": return { channels: (lib.channels || []).length ? lib.channels : [{ zone: "", ch: "", func: "COMMAND", name: "", assignment: "", rxFreq: "", rxTone: "", txFreq: "", txTone: "", mode: "D", remarks: "" }], special: "", prepared: prep() };
    case "205a": return { rows: [], prepared: prep() };
    case "206": return { stations: lib.stations || [], transport: lib.transport || [], hospitals: lib.hospitals || [], procedures: "", aviation: false, prepared: prep(), approved: { name: "" } };
    case "207": return { note: "" };
    case "208": return { message: "", siteSafety: { required: false, location: "" }, prepared: prep() };
    case "211": return { location: "", rows: [], prepared: prep() };
    case "213": return { to: { name: "", position: "" }, from: { name: "", position: "" }, subject: "", at: "", message: "", approved: { name: "", position: "" }, reply: "", replyBy: { name: "", position: "", at: "" } };
    case "214": return { name: "", userId: null, position: "", agency: "", resources: [], log: [], prepared: prep() };
    case "220": return { sunrise: "", sunset: "", remarks: "", tfr: "", frequencies: [], personnel: [], aircraft: [], prepared: prep() };
    case "weather": return { snapshot: null, notes: "" };
    case "attachment": return { title: "", fileId: null, landscape: false };
    default: throw err(400, "Unknown form.");
  }
}

async function access(user) {
  if (user.role === "master") return { view: true, edit: true, manage: true };
  return { view: await hasAccess(pool, user, "imt", "view"), edit: await hasAccess(pool, user, "imt", "edit"), manage: await hasAccess(pool, user, "imt", "manage") };
}
// People named in a period: 203 rows, 204 supervisors/leaders, 214 owners
function assigned(forms) {
  const ids = new Set();
  for (const f of forms) {
    const d = f.data || {};
    if (f.kind === "203") for (const r of d.rows || []) if (isUuid(r.userId)) ids.add(r.userId);
    if (f.kind === "204") { if (isUuid(d.supervisor?.userId)) ids.add(d.supervisor.userId); for (const r of d.resources || []) if (isUuid(r.userId)) ids.add(r.userId); }
    if (f.kind === "214" && isUuid(d.userId)) ids.add(d.userId);
  }
  return ids;
}
const icIds = forms => new Set(forms.filter(f => f.kind === "203").flatMap(f => (f.data.rows || []).filter(r => r.section === "command" && /^IC/i.test(r.role) && isUuid(r.userId)).map(r => r.userId)));

async function formsOf(c, periodId) {
  return (await c.query("SELECT * FROM imt_forms WHERE period_id = $1 ORDER BY sort, updated_at", [periodId])).rows;
}
async function canSeePeriod(user, acc, inc, p, forms) {
  if (acc.view) return true;
  if (assigned(forms).has(user.id)) return true;
  return inc.share_all && p.status === "approved";
}
async function visibleIncidents(user, acc) {
  const all = (await pool.query("SELECT * FROM imt_incidents ORDER BY status, created_at DESC")).rows;
  if (acc.view) return all;
  // Assigned in any period, or shared
  const mine = new Set((await pool.query(
    `SELECT DISTINCT p.incident_id FROM imt_forms f JOIN imt_periods p ON p.id = f.period_id
      WHERE f.kind IN ('203','204','214') AND f.data::text LIKE '%' || $1 || '%'`, [user.id])).rows.map(r => r.incident_id));
  return all.filter(i => mine.has(i.id) || i.share_all);
}
const incJson = i => ({ id: i.id, name: i.name, number: i.number, kind: i.kind, location: i.location, lat: i.lat, lon: i.lon, description: i.description,
  status: i.status, shareAll: i.share_all, coverFile: i.cover_file, createdBy: i.created_by_name, createdAt: i.created_at, closedAt: i.closed_at });
const perJson = p => ({ id: p.id, incidentId: p.incident_id, seq: p.seq, starts: wall(p.starts_at), ends: wall(p.ends_at), status: p.status,
  approvedBy: p.approved_name, approvedAt: p.approved_at, signed: !!p.approved_signature, signature: p.approved_signature || null });
const formJson = f => ({ id: f.id, kind: f.kind, sort: f.sort, data: f.data, version: f.version, updatedBy: f.updated_name, updatedAt: f.updated_at });

async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query("INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'IMT', $4, $5)",
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 1000)]);
}
async function library(c = pool) {
  const out = {};
  for (const r of (await c.query("SELECT kind, items FROM imt_library")).rows) out[r.kind] = r.items;
  return out;
}
async function periodCtx(c, periodId, forUpdate = false) {
  const p = (await c.query(`SELECT * FROM imt_periods WHERE id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [periodId])).rows[0];
  if (!p) throw err(404, "That operational period wasn't found.");
  const inc = (await c.query("SELECT * FROM imt_incidents WHERE id = $1", [p.incident_id])).rows[0];
  return { p, inc };
}
const draftOnly = p => { if (p.status === "approved") throw err(409, "This IAP is approved and locked. Reopen it to make changes."); };

// ---- Sanitizing form data: keep it JSON, bounded --------------------------------------------------------
function cleanData(v, depth = 0) {
  if (depth > 6) return null;
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.slice(0, 20000);
  if (Array.isArray(v)) return v.slice(0, 400).map(x => cleanData(x, depth + 1));
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 80)) if (/^[A-Za-z0-9_]{1,40}$/.test(k)) o[k] = cleanData(x, depth + 1);
    return o;
  }
  return null;
}

// ---- New period ---------------------------------------------------------------------------------------
async function newPeriod(c, user, inc, starts, ends, copyFrom) {
  if (!WALL.test(starts || "") || !WALL.test(ends || "")) throw err(400, "Enter the operational period's start and end (date and time).");
  if (ends <= starts) throw err(400, "The period has to end after it starts.");
  if (Date.parse(ends) - Date.parse(starts) > 7 * 86400_000) throw err(400, "An operational period can be up to 7 days.");
  const seq = (await c.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM imt_periods WHERE incident_id = $1", [inc.id])).rows[0].n;
  const id = crypto.randomUUID();
  await c.query("INSERT INTO imt_periods (id, incident_id, seq, starts_at, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, inc.id, seq, starts, ends, user.id]);
  let src = null;
  if (copyFrom === "previous") src = (await c.query("SELECT id FROM imt_periods WHERE incident_id = $1 AND id <> $2 ORDER BY seq DESC LIMIT 1", [inc.id, id])).rows[0]?.id || null;
  else if (isUuid(copyFrom)) src = (await c.query("SELECT id FROM imt_periods WHERE incident_id = $1 AND id = $2", [inc.id, copyFrom])).rows[0]?.id || null;
  if (src) {
    for (const f of await formsOf(c, src)) {
      if (PER_PERIOD.has(f.kind)) continue;
      const data = { ...f.data };
      if (f.kind === "weather") data.snapshot = null;           // a new forecast for the new period
      for (const k of ["prepared"]) if (data[k]) data[k] = { ...data[k], at: "" };
      await c.query("INSERT INTO imt_forms (id, period_id, kind, sort, data, updated_by, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [crypto.randomUUID(), id, f.kind, f.sort, JSON.stringify(data), user.id, user.name]);
    }
  } else {
    const lib = await library(c);
    let n = 0;
    for (const k of ["cover", "202", "203", "204", "205", "206", "208", "weather"]) {
      await c.query("INSERT INTO imt_forms (id, period_id, kind, sort, data, updated_by, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [crypto.randomUUID(), id, k, ORDER[k] * 10 + n++, JSON.stringify(blank(k, { incident: inc, library: lib })), user.id, user.name]);
    }
  }
  await audit(c, user, "Started operational period", `${inc.name}: period ${seq}, ${starts.replace("T", " ")} to ${ends.replace("T", " ")}${src ? " (copied from the previous period)" : ""}`);
  return id;
}

// ---- Reading an existing IAP PDF -------------------------------------------------------------------------
const IMPORT_PROMPT = `This PDF is an Incident Action Plan (IAP) made of ICS forms. Read it and return JSON only (no markdown), in exactly this shape. Use "" / [] / false for anything that isn't there; never invent anything.
{
 "incident": {"name": "", "number": "", "kind": "", "location": ""},
 "period": {"starts": "YYYY-MM-DDTHH:MM", "ends": "YYYY-MM-DDTHH:MM"},
 "f202": {"objectives": [""], "emphasis": "", "awareness": "", "siteSafetyRequired": false, "prepared": {"name": "", "position": ""}, "approvedBy": ""},
 "f203": [{"section": "command|agency|planning|logistics|operations|air|finance", "role": "", "label": "", "name": "", "agency": ""}],
 "f204": [{"branch": "", "division": "", "group": "", "staging": "", "supervisor": "", "resources": [{"ident": "", "leader": "", "persons": "", "contact": "", "notes": ""}], "work": "", "special": "", "comms": [{"name": "", "contact": ""}], "prepared": {"name": "", "position": ""}}],
 "f205": {"channels": [{"zone": "", "ch": "", "func": "", "name": "", "assignment": "", "rxFreq": "", "rxTone": "", "txFreq": "", "txTone": "", "mode": "", "remarks": ""}], "special": "", "prepared": {"name": "", "position": ""}},
 "f206": {"stations": [{"name": "", "location": "", "contact": "", "als": false}], "transport": [{"name": "", "location": "", "contact": "", "als": false}],
          "hospitals": [{"name": "", "address": "", "contact": "", "air": "", "ground": "", "trauma": "", "burn": false, "helipad": false}], "procedures": "", "aviation": false, "prepared": {"name": "", "position": ""}, "approvedBy": ""},
 "f208": {"message": "", "siteSafetyRequired": false, "prepared": {"name": "", "position": ""}},
 "f220": {"sunrise": "", "sunset": "", "remarks": "", "tfr": "", "frequencies": [{"function": "", "rx": "", "tx": "", "tone": ""}], "personnel": [{"position": "", "name": "", "phone": ""}],
          "aircraft": [{"tail": "", "callSign": "", "type": "", "makeModel": "", "base": "", "avail": "", "stop": "", "remarks": ""}]}
}
For f203: one entry per filled-in position. "role" is the position on the form (IC/UCs, Deputy, Safety Officer, Chief, Resources Unit, Division/Group, Branch, ...); "label" is what a Division/Group or Branch is (e.g. "AIR SAR"). Agency representatives go in section "agency" with the agency in "agency".`;

function fromImport(j, inc, lib) {
  const forms = [];
  const add = (kind, data) => forms.push({ kind, data });
  add("cover", { ...blank("cover", { incident: inc }) });
  const t = (v, n = 4000) => clean(v, n);
  const p202 = j.f202 || {};
  add("202", { ...blank("202"), objectives: (p202.objectives || []).map(x => t(x)).filter(Boolean).slice(0, 40), emphasis: t(p202.emphasis, 8000), awareness: t(p202.awareness, 8000),
    siteSafety: { required: !!p202.siteSafetyRequired, location: "" }, prepared: { name: t(p202.prepared?.name, 120), position: t(p202.prepared?.position, 60), at: "" }, approved: { name: t(p202.approvedBy, 120) } });
  const rows = blank("203").rows;
  for (const r of Array.isArray(j.f203) ? j.f203.slice(0, 200) : []) {
    const section = ROLES_203[r.section] || r.section === "agency" ? r.section : "operations";
    const slot = rows.find(x => x.section === section && x.role.toLowerCase() === t(r.role, 80).toLowerCase() && !x.name);
    if (slot) Object.assign(slot, { name: t(r.name, 120), agency: t(r.agency, 120), label: t(r.label, 120) });
    else rows.push({ section, role: t(r.role, 80) || (section === "agency" ? "Agency Representative" : "Division/Group"), label: t(r.label, 120), name: t(r.name, 120), userId: null, agency: t(r.agency, 120), contact: "" });
  }
  add("203", { rows, prepared: prep() });
  for (const a of Array.isArray(j.f204) ? j.f204.slice(0, 40) : []) {
    add("204", { ...blank("204"), branch: t(a.branch, 80), division: t(a.division, 80), group: t(a.group, 80), staging: t(a.staging, 120),
      supervisor: { name: t(a.supervisor, 120), contact: "", userId: null },
      resources: (a.resources || []).slice(0, 60).map(r => ({ ident: t(r.ident, 120), leader: t(r.leader, 120), persons: t(r.persons, 10), contact: t(r.contact, 120), notes: t(r.notes, 300) })),
      work: t(a.work, 8000), special: t(a.special, 8000), comms: (a.comms || []).slice(0, 20).map(c => ({ name: t(c.name, 120), contact: t(c.contact, 200) })),
      prepared: { name: t(a.prepared?.name, 120), position: t(a.prepared?.position, 60), at: "" } });
  }
  if (j.f205) add("205", { channels: (j.f205.channels || []).slice(0, 60).map(c => Object.fromEntries(["zone", "ch", "func", "name", "assignment", "rxFreq", "rxTone", "txFreq", "txTone", "mode", "remarks"].map(k => [k, t(c[k], 200)]))),
    special: t(j.f205.special, 4000), prepared: { name: t(j.f205.prepared?.name, 120), position: t(j.f205.prepared?.position, 60), at: "" } });
  else add("205", blank("205", { library: lib }));
  if (j.f206) {
    const s = j.f206;
    add("206", { stations: (s.stations || []).slice(0, 30).map(x => ({ name: t(x.name, 120), location: t(x.location, 200), contact: t(x.contact, 120), als: !!x.als })),
      transport: (s.transport || []).slice(0, 30).map(x => ({ name: t(x.name, 120), location: t(x.location, 200), contact: t(x.contact, 120), als: !!x.als })),
      hospitals: (s.hospitals || []).slice(0, 30).map(x => ({ name: t(x.name, 120), address: t(x.address, 200), contact: t(x.contact, 120), air: t(x.air, 30), ground: t(x.ground, 30), trauma: t(x.trauma, 30), burn: !!x.burn, helipad: !!x.helipad })),
      procedures: t(s.procedures, 8000), aviation: !!s.aviation, prepared: { name: t(s.prepared?.name, 120), position: t(s.prepared?.position, 60), at: "" }, approved: { name: t(s.approvedBy, 120) } });
  }
  if (j.f208) add("208", { message: t(j.f208.message, 20000), siteSafety: { required: !!j.f208.siteSafetyRequired, location: "" }, prepared: { name: t(j.f208.prepared?.name, 120), position: t(j.f208.prepared?.position, 60), at: "" } });
  if (j.f220 && ((j.f220.aircraft || []).length || (j.f220.frequencies || []).length)) {
    const a = j.f220;
    add("220", { sunrise: t(a.sunrise, 20), sunset: t(a.sunset, 20), remarks: t(a.remarks, 4000), tfr: t(a.tfr, 1000),
      frequencies: (a.frequencies || []).slice(0, 30).map(x => ({ function: t(x.function, 80), rx: t(x.rx, 40), tx: t(x.tx, 40), tone: t(x.tone, 40) })),
      personnel: (a.personnel || []).slice(0, 30).map(x => ({ position: t(x.position, 80), name: t(x.name, 120), phone: t(x.phone, 40) })),
      aircraft: (a.aircraft || []).slice(0, 30).map(x => Object.fromEntries(["tail", "callSign", "type", "makeModel", "base", "avail", "stop", "remarks"].map(k => [k, t(x[k], 120)]))), prepared: prep() });
  }
  add("weather", blank("weather"));
  return forms;
}

// ---- Routes ---------------------------------------------------------------------------------------------
export async function handleImt(req, res, parts, user, send, jsonBody, url) {
  const [, , a, b, c] = parts;
  const acc = await access(user);
  const need = lvl => { if (!acc[lvl]) throw err(403, lvl === "manage" ? "Only people who manage IMT can do that." : "You need IMT edit access for that."); };

  if (req.method === "GET" && !a) {
    const list = await visibleIncidents(user, acc);
    const per = list.length ? (await pool.query(
      `SELECT incident_id, count(*)::int AS n, max(seq) AS last FROM imt_periods WHERE incident_id = ANY(string_to_array($1, ',')::uuid[]) GROUP BY incident_id`, [list.map(i => i.id).join(",")])).rows : [];
    const latest = list.length ? (await pool.query(
      `SELECT DISTINCT ON (incident_id) * FROM imt_periods WHERE incident_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY incident_id, seq DESC`, [list.map(i => i.id).join(",")])).rows : [];
    return send(res, 200, { access: acc, kinds: KINDS, incidents: list.map(i => ({ ...incJson(i), periods: per.find(x => x.incident_id === i.id)?.n || 0,
      latest: (p => p ? perJson(p) : null)(latest.find(x => x.incident_id === i.id)) })) });
  }

  // ---- Incidents ----
  if (a === "incidents" && !b && req.method === "POST") {
    need("manage");
    const x = await jsonBody(req);
    const name = clean(x.name, 160);
    if (!name) throw err(400, "Enter the incident name.");
    const lat = x.lat === "" || x.lat === null || x.lat === undefined ? null : Number(x.lat), lon = x.lon === "" || x.lon === null || x.lon === undefined ? null : Number(x.lon);
    if ((lat !== null && !(lat >= -90 && lat <= 90)) || (lon !== null && !(lon >= -180 && lon <= 180))) throw err(400, "Latitude/longitude don't look right.");
    const vals = [name, clean(x.number, 60), clean(x.kind, 60), clean(x.location, 200), lat, lon, clean(x.description, 4000), x.shareAll === true];
    let id = x.id;
    await tx(async c2 => {
      if (isUuid(id)) {
        const old = (await c2.query("SELECT * FROM imt_incidents WHERE id = $1", [id])).rows[0];
        if (!old) throw err(404, "That incident wasn't found.");
        const status = x.status === "closed" ? "closed" : "active";
        await c2.query(`UPDATE imt_incidents SET name=$2, number=$3, kind=$4, location=$5, lat=$6, lon=$7, description=$8, share_all=$9, status=$10,
          closed_at = CASE WHEN $10 = 'closed' AND status <> 'closed' THEN now() WHEN $10 = 'active' THEN NULL ELSE closed_at END,
          cover_file = COALESCE($11, cover_file) WHERE id = $1`, [id, ...vals, status, isUuid(x.coverFile) ? x.coverFile : null]);
        await audit(c2, user, status !== old.status ? (status === "closed" ? "Closed incident" : "Reopened incident") : "Edited incident", name);
      } else {
        id = crypto.randomUUID();
        await c2.query(`INSERT INTO imt_incidents (id, name, number, kind, location, lat, lon, description, share_all, created_by, created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, ...vals, user.id, user.name]);
        await audit(c2, user, "Created incident", `${name}${x.number ? ` (${clean(x.number, 60)})` : ""}`);
      }
    });
    return send(res, 200, { id });
  }
  if (a === "incidents" && isUuid(b)) {
    const inc = (await pool.query("SELECT * FROM imt_incidents WHERE id = $1", [b])).rows[0];
    if (!inc) throw err(404, "That incident wasn't found.");
    if (c === "remove" && req.method === "POST") {
      need("manage");
      await tx(async c2 => { await c2.query("DELETE FROM imt_incidents WHERE id = $1", [b]); await audit(c2, user, "Deleted incident", inc.name); });
      return send(res, 200, { ok: true });
    }
    if (c === "periods" && req.method === "POST") {
      need("edit");
      const x = await jsonBody(req);
      const id = await tx(c2 => newPeriod(c2, user, inc, x.starts, x.ends, x.copyFrom || ""));
      return send(res, 200, { id });
    }
    if (!c && req.method === "GET") {
      const periods = (await pool.query("SELECT * FROM imt_periods WHERE incident_id = $1 ORDER BY seq", [b])).rows;
      const visible = [];
      for (const p of periods) if (await canSeePeriod(user, acc, inc, p, await formsOf(pool, p.id))) visible.push(perJson(p));
      if (!acc.view && !visible.length) throw err(403, "You don't have access to this incident.");
      const files = (await pool.query("SELECT id, name, mime, size, page, parent_id, created_at FROM imt_files WHERE incident_id = $1 AND parent_id IS NULL ORDER BY created_at", [b])).rows;
      const pageCounts = new Map((await pool.query("SELECT parent_id, count(*)::int AS n FROM imt_files WHERE incident_id = $1 AND parent_id IS NOT NULL GROUP BY parent_id", [b])).rows.map(r => [r.parent_id, r.n]));
      return send(res, 200, { access: acc, incident: incJson(inc), periods: visible,
        files: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, pages: pageCounts.get(f.id) || 0, at: f.created_at })) });
    }
  }

  // ---- Periods ----
  if (a === "periods" && isUuid(b)) {
    if (!c && req.method === "GET") {
      const { p, inc } = await periodCtx(pool, b);
      const forms = await formsOf(pool, b);
      if (!(await canSeePeriod(user, acc, inc, p, forms))) throw err(403, "You don't have access to this IAP.");
      const siblings = (await pool.query("SELECT id, seq, starts_at, ends_at, status FROM imt_periods WHERE incident_id = $1 ORDER BY seq", [inc.id])).rows.map(perJson);
      const pageImages = (await pool.query("SELECT parent_id, id, page FROM imt_files WHERE incident_id = $1 AND parent_id IS NOT NULL ORDER BY parent_id, page", [inc.id])).rows;
      const pages = {};
      for (const r of pageImages) (pages[r.parent_id] = pages[r.parent_id] || []).push(r.id);
      const files = (await pool.query("SELECT id, name, mime FROM imt_files WHERE incident_id = $1 AND parent_id IS NULL ORDER BY created_at", [inc.id])).rows;
      return send(res, 200, { access: acc, canApprove: acc.manage || icIds(forms).has(user.id), incident: incJson(inc), period: perJson(p), periods: siblings,
        forms: forms.map(formJson), kinds: KINDS, files: files.map(f => ({ ...f, pages: pages[f.id] || [] })) });
    }
    if (req.method !== "POST") throw err(404, "Not found");
    const x = await jsonBody(req);
    if (!c) {
      need("edit");
      await tx(async c2 => {
        const { p, inc } = await periodCtx(c2, b, true);
        draftOnly(p);
        if (!WALL.test(x.starts || "") || !WALL.test(x.ends || "") || x.ends <= x.starts) throw err(400, "Enter a start and an end after it.");
        await c2.query("UPDATE imt_periods SET starts_at = $2, ends_at = $3 WHERE id = $1", [b, x.starts, x.ends]);
        await audit(c2, user, "Changed period times", `${inc.name} period ${p.seq}: ${x.starts.replace("T", " ")} to ${x.ends.replace("T", " ")}`);
      });
      return send(res, 200, { ok: true });
    }
    if (c === "forms") {
      need("edit");
      if (!KINDS[x.kind]) throw err(400, "Unknown form.");
      const id = crypto.randomUUID();
      await tx(async c2 => {
        const { p, inc } = await periodCtx(c2, b, true);
        draftOnly(p);
        const forms = await formsOf(c2, b);
        if (["cover", "202", "203", "205", "205a", "206", "207", "208", "220", "weather"].includes(x.kind) && forms.some(f => f.kind === x.kind)) throw err(400, `This IAP already has ${KINDS[x.kind]}.`);
        const after = forms.find(f => f.id === x.after);
        const same = forms.filter(f => f.kind === x.kind);
        const sort = after ? after.sort + 1 : same.length ? Math.max(...same.map(f => f.sort)) + 1 : ORDER[x.kind] * 10 + 5;
        if (after) await c2.query("UPDATE imt_forms SET sort = sort + 1 WHERE period_id = $1 AND sort > $2", [b, after.sort]);
        const data = blank(x.kind, { incident: inc, library: await library(c2) });
        // An activity log is usually yours; a 205A starts from the 203 and the Directory
        if (x.kind === "214") Object.assign(data, { name: user.name, userId: user.id });
        if (x.kind === "205a") data.rows = await commsFrom203(c2, forms);
        await c2.query("INSERT INTO imt_forms (id, period_id, kind, sort, data, updated_by, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, b, x.kind, sort, JSON.stringify(data), user.id, user.name]);
        await audit(c2, user, "Added form", `${inc.name} period ${p.seq}: ${KINDS[x.kind]}`);
      });
      return send(res, 200, { id });
    }
    if (c === "approve" || c === "reopen") {
      await tx(async c2 => {
        const { p, inc } = await periodCtx(c2, b, true);
        const forms = await formsOf(c2, b);
        if (!(acc.manage || icIds(forms).has(user.id))) throw err(403, "Only the Incident Commander named on the 203, or IMT managers, can approve or reopen the IAP.");
        if (c === "approve") {
          if (p.status === "approved") throw err(409, "It's already approved.");
          let sig = null;
          if (x.signature) {
            if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(x.signature) || x.signature.length > 300_000) throw err(400, "That signature isn't a picture " + brand().productName + " can use.");
            sig = x.signature;
          }
          await c2.query("UPDATE imt_periods SET status = 'approved', approved_by = $2, approved_name = $3, approved_at = now(), approved_signature = $4 WHERE id = $1", [b, user.id, user.name, sig]);
          await audit(c2, user, "Approved IAP", `${inc.name} period ${p.seq}${sig ? " (signed)" : ""}`);
        } else {
          if (p.status !== "approved") throw err(409, "It isn't approved.");
          await c2.query("UPDATE imt_periods SET status = 'draft', approved_by = NULL, approved_name = '', approved_at = NULL, approved_signature = NULL WHERE id = $1", [b]);
          await audit(c2, user, "Reopened IAP", `${inc.name} period ${p.seq}${x.reason ? `: ${clean(x.reason, 300)}` : ""}`);
        }
      });
      return send(res, 200, { ok: true });
    }
    if (c === "notify") {
      need("edit");
      const { p, inc } = await periodCtx(pool, b);
      const forms = await formsOf(pool, b);
      const ids = [...assigned(forms)].filter(id => id !== user.id);
      if (!ids.length) throw err(400, "Nobody in this IAP has a " + brand().productName + " account linked yet (pick people from the roster on the 203 / 204).");
      const { send: sendMsg } = await import("./messages.js");
      const when = `${wall(p.starts_at).replace("T", " ")} to ${wall(p.ends_at).replace("T", " ")}`;
      const r = await sendMsg(user, { users: ids, important: x.important === true,
        subject: `IAP ${p.status === "approved" ? "ready" : "draft"}: ${inc.name}, operational period ${p.seq}`,
        body: `The Incident Action Plan for ${inc.name}${inc.number ? ` (${inc.number})` : ""}, operational period ${p.seq} (${when}), is ${p.status === "approved" ? "approved and ready" : "available as a draft"}.\n\nOpen it in ${brand().productName}: Main menu › IMT › ${inc.name}.${x.note ? `\n\n${clean(x.note, 2000)}` : ""}` });
      await audit(pool, user, "Sent IAP notice", `${inc.name} period ${p.seq} to ${ids.length} people`);
      return send(res, 200, { ok: true, sent: r.recipients });
    }
    if (c === "remove") {
      need("manage");
      await tx(async c2 => {
        const { p, inc } = await periodCtx(c2, b, true);
        draftOnly(p);
        await c2.query("DELETE FROM imt_periods WHERE id = $1", [b]);
        await audit(c2, user, "Deleted operational period", `${inc.name} period ${p.seq}`);
      });
      return send(res, 200, { ok: true });
    }
  }

  // ---- Forms ----
  if (a === "forms" && isUuid(b) && req.method === "POST") {
    need("edit");
    const x = await jsonBody(req);
    const out = await tx(async c2 => {
      const f = (await c2.query("SELECT * FROM imt_forms WHERE id = $1 FOR UPDATE", [b])).rows[0];
      if (!f) throw err(404, "That form wasn't found.");
      const { p, inc } = await periodCtx(c2, f.period_id, true);
      draftOnly(p);
      if (c === "remove") {
        await c2.query("DELETE FROM imt_forms WHERE id = $1", [b]);
        await audit(c2, user, "Removed form", `${inc.name} period ${p.seq}: ${KINDS[f.kind]}`);
        return { ok: true };
      }
      if (c === "move") {
        const forms = await formsOf(c2, f.period_id);
        const i = forms.findIndex(y => y.id === b), j = i + (x.dir === "up" ? -1 : 1);
        if (j < 0 || j >= forms.length) return { ok: true };
        const order = forms.map(y => y.id); [order[i], order[j]] = [order[j], order[i]];
        for (let k = 0; k < order.length; k++) await c2.query("UPDATE imt_forms SET sort = $2 WHERE id = $1", [order[k], k * 10]);
        return { ok: true };
      }
      if (c) throw err(404, "Not found");
      if (Number.isInteger(x.version) && x.version !== f.version) throw err(409, `${f.updated_name || "Someone"} changed this form while you were editing. Reload it to see their changes, then make yours again.`);
      const data = cleanData(x.data || {});
      if (JSON.stringify(data).length > 400_000) throw err(413, "That form is too big to save.");
      const r = (await c2.query("UPDATE imt_forms SET data = $2, version = version + 1, updated_by = $3, updated_name = $4, updated_at = now() WHERE id = $1 RETURNING version, updated_at",
        [b, JSON.stringify(data), user.id, user.name])).rows[0];
      return { ok: true, version: r.version, updatedAt: r.updated_at };
    });
    return send(res, 200, out);
  }

  // ---- Files ----
  if (a === "files") {
    if (req.method === "GET" && isUuid(b)) {
      const f = (await pool.query("SELECT f.*, i.share_all FROM imt_files f JOIN imt_incidents i ON i.id = f.incident_id WHERE f.id = $1", [b])).rows[0];
      if (!f) throw err(404, "File not found");
      if (!acc.view) {
        const vis = await visibleIncidents(user, acc);
        if (!vis.some(i => i.id === f.incident_id)) throw err(403, "No access");
      }
      res.writeHead(200, { "Content-Type": f.mime, "Content-Length": f.data.length, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff",
        ...(url.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="${f.name.replace(/[^\w .()-]/g, "_")}"` } : {}) });
      return res.end(f.data);
    }
    need("edit");
    const x = await jsonBody(req);
    if (isUuid(b) && c === "remove") {
      await tx(async c2 => {
        const f = (await c2.query("DELETE FROM imt_files WHERE id = $1 RETURNING name, incident_id", [b])).rows[0];
        if (f) await audit(c2, user, "Removed file", f.name);
      });
      return send(res, 200, { ok: true });
    }
    if (!isUuid(x.incidentId)) throw err(400, "Which incident?");
    const mime = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(x.mime || "") ? x.mime : null;
    if (!mime) throw err(415, "Attach a picture (PNG, JPG) or a PDF.");
    const data = Buffer.from(String(x.data || "").replace(/^data:[^,]*,/, ""), "base64");
    if (!data.length) throw err(400, "That file is empty.");
    if (data.length > MAX_FILE) throw err(413, "That file is over 15 MB.");
    const pages = (Array.isArray(x.pages) ? x.pages : []).slice(0, 40).map(pg => Buffer.from(String(pg).replace(/^data:[^,]*,/, ""), "base64")).filter(bf => bf.length && bf.length <= MAX_FILE);
    const id = crypto.randomUUID();
    await tx(async c2 => {
      const inc = (await c2.query("SELECT name FROM imt_incidents WHERE id = $1", [x.incidentId])).rows[0];
      if (!inc) throw err(404, "That incident wasn't found.");
      await c2.query("INSERT INTO imt_files (id, incident_id, name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, x.incidentId, clean(x.name, 200) || "file", mime, data.length, data, user.id]);
      for (let i = 0; i < pages.length; i++) {
        await c2.query("INSERT INTO imt_files (id, incident_id, parent_id, page, name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,'image/jpeg',$6,$7,$8)",
          [crypto.randomUUID(), x.incidentId, id, i + 1, `${clean(x.name, 180)} p${i + 1}.jpg`, pages[i].length, pages[i], user.id]);
      }
      await audit(c2, user, "Added file", `${inc.name}: ${clean(x.name, 200)}${pages.length ? ` (${pages.length} pages)` : ""}`);
    });
    const pageIds = (await pool.query("SELECT id FROM imt_files WHERE parent_id = $1 ORDER BY page", [id])).rows.map(r => r.id);
    return send(res, 200, { id, pages: pageIds });
  }

  // ---- Library, people, weather, geocoding ----
  if (a === "library") {
    if (req.method === "GET") return send(res, 200, { library: await library() });
    need("edit");
    const x = await jsonBody(req);
    if (!["channels", "hospitals", "stations", "transport"].includes(x.kind)) throw err(400, "Unknown list.");
    const items = cleanData(Array.isArray(x.items) ? x.items.slice(0, 100) : []);
    await pool.query("INSERT INTO imt_library (kind, items) VALUES ($1, $2) ON CONFLICT (kind) DO UPDATE SET items = EXCLUDED.items, updated_at = now()", [x.kind, JSON.stringify(items)]);
    await audit(pool, user, "Saved list for next time", `${x.kind}: ${items.length}`);
    return send(res, 200, { ok: true });
  }
  if (a === "people" && req.method === "GET") {
    need("edit");
    const rows = (await pool.query(`SELECT u.id, u.full_name AS name, u.job_title AS title, u.phone, u.extension, u.station, d.name AS division
      FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.active ORDER BY u.full_name`)).rows;
    return send(res, 200, { people: rows.map(r => ({ id: r.id, name: r.name, title: r.title || "", phone: r.phone || "", division: r.division || "" })) });
  }
  if (a === "weather" && req.method === "GET") {
    const { forecastAt } = await import("./weather.js");
    return send(res, 200, await forecastAt(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon"))));
  }
  if (a === "geocode" && req.method === "GET") {
    const q = clean(url.searchParams.get("q"), 200);
    if (!q) throw err(400, "Enter an address.");
    const base = process.env.GEOCODER_BASE || "https://geocoding.geo.census.gov";
    let j;
    try {
      const r = await fetch(`${base}/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(15_000) });
      j = await r.json();
    } catch (e) { throw err(502, `The address lookup didn't answer (${e.message}). Enter the latitude and longitude by hand.`); }
    const m = j?.result?.addressMatches?.[0];
    if (!m) throw err(404, "That address wasn't found. Try a full street address, or enter the latitude and longitude.");
    return send(res, 200, { lat: m.coordinates.y, lon: m.coordinates.x, matched: m.matchedAddress });
  }

  // ---- Drafting help ----
  if (a === "ai" && req.method === "POST") {
    need("edit");
    const x = await jsonBody(req);
    const { p, inc } = await periodCtx(pool, x.periodId);
    const forms = await formsOf(pool, p.id);
    const prev = (await pool.query("SELECT id FROM imt_periods WHERE incident_id = $1 AND seq < $2 ORDER BY seq DESC LIMIT 1", [inc.id, p.seq])).rows[0];
    const prevForms = prev ? await formsOf(pool, prev.id) : [];
    const f202 = (forms.find(f => f.kind === "202") || prevForms.find(f => f.kind === "202"))?.data || {};
    const groups = forms.filter(f => f.kind === "204").map(f => [f.data.division, f.data.group].filter(Boolean).join(" / ") + (f.data.work ? `: ${f.data.work.slice(0, 300)}` : "")).filter(Boolean);
    const wx = forms.find(f => f.kind === "weather")?.data?.snapshot;
    const ctx = [`Incident: ${inc.name}${inc.number ? ` (${inc.number})` : ""}. Type: ${inc.kind || "not given"}. Location: ${inc.location || "not given"}.`,
      inc.description ? `Situation: ${inc.description.slice(0, 1500)}` : "",
      `Operational period ${p.seq}: ${wall(p.starts_at).replace("T", " ")} to ${wall(p.ends_at).replace("T", " ")}.`,
      (f202.objectives || []).filter(Boolean).length ? `Current/previous objectives:\n- ${(f202.objectives || []).filter(Boolean).join("\n- ")}` : "",
      groups.length ? `Divisions/groups:\n- ${groups.join("\n- ")}` : "",
      wx?.periods?.length ? `Forecast: ${wx.periods.slice(0, 4).map(q => `${q.name}: ${q.short}, ${q.tempF}°F, wind ${q.wind}, ${q.pop}% precip`).join("; ")}` : ""].filter(Boolean).join("\n\n");
    let ask;
    if (x.task === "objectives") ask = `Draft the ICS 202 for the next operational period. Return JSON {"objectives": ["..."], "emphasis": "...", "awareness": "..."}. Objectives must be SMART (specific, measurable, action-oriented, realistic, time-bound), 4-8 of them, ordered by priority (life safety, incident stabilization, property/environment), building on the current ones. Command emphasis: 3-5 short bullet sentences. Situational awareness: hazards specific to this incident type and the forecast. Plain text, no markdown.`;
    else if (x.task === "safety") ask = `Draft the ICS 208 safety message for this operational period. Return JSON {"message": "..."}: short headed sections (e.g. "Vehicle & Ground Safety") with "- " bullet lines, specific to the incident type, the work being done and the forecast, ending with one "Key message:" line. Plain text, no markdown.`;
    else if (x.task === "work") {
      const f = forms.find(y => y.id === x.formId && y.kind === "204");
      if (!f) throw err(400, "Which 204?");
      ask = `Draft the work assignments and special instructions for this ICS 204: ${[f.data.branch && `Branch ${f.data.branch}`, f.data.division && `Division ${f.data.division}`, f.data.group && `Group ${f.data.group}`].filter(Boolean).join(", ") || "(unnamed)"}; resources: ${(f.data.resources || []).map(r => r.ident).filter(Boolean).join(", ") || "not listed"}; current text: ${(f.data.work || "").slice(0, 800)}. Return JSON {"work": "1. ...\\n2. ...", "special": "1. ...\\n2. ..."}, numbered, specific and measurable, plain text.`;
    } else throw err(400, "Unknown request.");
    const { askClaude } = await import("./documents.js");
    const out = await askClaude([{ type: "text", text: `You help a fire department Incident Management Team write ICS forms (NIMS, FEMA ICS forms). Be concrete and brief; never invent names, phone numbers or frequencies.\n\n${ctx}\n\n${ask}` }],
      { maxTokens: 1800, what: "Drafting help", noKey: "Drafting help isn't turned on (the server needs an ANTHROPIC_API_KEY in .env). Fill the form in by hand." });
    await audit(pool, user, "Asked for a draft", `${inc.name} period ${p.seq}: ${x.task}`);
    return send(res, 200, { draft: out });
  }

  // ---- Start a period from an IAP PDF ----
  if (a === "import" && req.method === "POST") {
    need("manage");
    const x = await jsonBody(req);
    const data = Buffer.from(String(x.data || "").replace(/^data:[^,]*,/, ""), "base64");
    if (!data.length) throw err(400, "Choose the IAP (PDF).");
    if (data.length > 30 * 1024 * 1024) throw err(413, "That PDF is over 30 MB.");
    if (!/\.pdf$/i.test(x.fileName || "")) throw err(415, "Choose a PDF of the IAP.");
    const { askClaude } = await import("./documents.js");
    const j = await askClaude([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } }, { type: "text", text: IMPORT_PROMPT }],
      { maxTokens: 12000, what: "Reading the IAP", timeoutMs: 240_000, noKey: "Reading an IAP needs an ANTHROPIC_API_KEY in .env (the same key requisition autofill uses).",
        notFound: "Couldn't find ICS forms in that PDF." });
    const summary = { incident: j.incident || {}, period: j.period || {}, counts: {
      objectives: (j.f202?.objectives || []).filter(Boolean).length, positions: (j.f203 || []).length, assignments: (j.f204 || []).length,
      channels: (j.f205?.channels || []).length, hospitals: (j.f206?.hospitals || []).length, safety: !!j.f208?.message, aircraft: (j.f220?.aircraft || []).length } };
    if (x.preview) return send(res, 200, { preview: summary, parsed: j });
    const out = await tx(async c2 => {
      let inc;
      if (isUuid(x.incidentId)) {
        inc = (await c2.query("SELECT * FROM imt_incidents WHERE id = $1", [x.incidentId])).rows[0];
        if (!inc) throw err(404, "That incident wasn't found.");
      } else {
        const id = crypto.randomUUID();
        const i = j.incident || {};
        await c2.query("INSERT INTO imt_incidents (id, name, number, kind, location, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, clean(i.name, 160) || clean(x.fileName, 160), clean(i.number, 60), clean(i.kind, 60), clean(i.location, 200), user.id, user.name]);
        inc = (await c2.query("SELECT * FROM imt_incidents WHERE id = $1", [id])).rows[0];
      }
      const starts = WALL.test(x.starts || "") ? x.starts : WALL.test(j.period?.starts || "") ? j.period.starts : null;
      const ends = WALL.test(x.ends || "") ? x.ends : WALL.test(j.period?.ends || "") ? j.period.ends : null;
      if (!starts || !ends || ends <= starts) throw err(400, "Enter the operational period's start and end (the PDF didn't say clearly).");
      const seq = (await c2.query("SELECT COALESCE(max(seq), 0) + 1 AS n FROM imt_periods WHERE incident_id = $1", [inc.id])).rows[0].n;
      const pid = crypto.randomUUID();
      await c2.query("INSERT INTO imt_periods (id, incident_id, seq, starts_at, ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)", [pid, inc.id, seq, starts, ends, user.id]);
      const forms = fromImport(j, inc, await library(c2));
      let n = 0;
      for (const f of forms) {
        await c2.query("INSERT INTO imt_forms (id, period_id, kind, sort, data, updated_by, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [crypto.randomUUID(), pid, f.kind, ORDER[f.kind] * 10 + n++, JSON.stringify(cleanData(f.data)), user.id, user.name]);
      }
      await audit(c2, user, "Started period from an IAP PDF", `${inc.name} period ${seq}: ${clean(x.fileName, 200)} (${forms.length} forms)`);
      return { incidentId: inc.id, periodId: pid };
    });
    return send(res, 200, out);
  }
  throw err(404, "Not found");
}

// 205A rows from the 203 (people with accounts get their Directory cell / extension)
async function commsFrom203(c, forms) {
  const f = forms.find(x => x.kind === "203");
  if (!f) return [];
  const rows = (f.data.rows || []).filter(r => r.name);
  const ids = rows.map(r => r.userId).filter(isUuid);
  const phones = ids.length ? new Map((await c.query("SELECT id, phone, extension FROM users WHERE id = ANY(string_to_array($1, ',')::uuid[])", [ids.join(",")])).rows
    .map(u => [u.id, [u.phone, u.extension ? `ext ${u.extension}` : ""].filter(Boolean).join(" · ")])) : new Map();
  const SECTION = { command: "", agency: "Agency Rep", planning: "Planning", logistics: "Logistics", operations: "Operations", air: "Air Ops", finance: "Finance/Admin" };
  return rows.map(r => ({ position: [SECTION[r.section], r.section === "agency" ? r.agency : r.role, r.label].filter(Boolean).join(" · "), name: r.name,
    contact: r.contact || phones.get(r.userId) || "" }));
}
