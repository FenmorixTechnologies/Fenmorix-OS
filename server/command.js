// Command Board: the incident commander's board for a fire call, opened from Active calls. Accountability by crew (units
// on the CAD call, names from Aladtec / the directory call sign), who's in or out of the structure and for how long, PAR
// timer (every 13 minutes, every 10 after the first hour), strategy (offensive / defensive / transitional, interior /
// exterior), benchmarks (water on fire, primary / secondary search started and all clear, under control, loss stopped, utilities), MAYDAY
// (who, where, cleared), radio notes (critical ones in red), smoke reading by side, and apparatus on a scene view
// (diagram or USGS aerial) with A/B/C/D sides and corners. Every change is an event (append-only) for the after-action log.
//
//   GET  /api/command                         open boards + the last 30 closed ones, rights
//   GET  /api/command/riders?units=EG653,SG10 who is on each unit (Aladtec on-duty positions, else directory call sign)
//   GET  /api/command/incident/:incidentId    the board for a CAD call, or null
//   POST /api/command/open                    {incidentId} (editors) -> board, crews from the call's units
//   GET  /api/command/:id?v=                  the board (+ events); {same: true} when the version hasn't changed
//   POST /api/command/:id/action              {type, ...} (editors)  -> board
//   POST /api/command/:id/aerial              {feet} (editors) USGS aerial at the call's map point
//   GET/POST /api/command/settings            {officerTitles, interiorWarnMinutes}  (manage)
//
// Rights: anyone signed in watches; editors = master, access section "command" edit, or a job title matching settings
// officerTitles (chiefs, captains, lieutenants by default). Audit module "Command board" (open / close only).
import { risky } from "./saferegex.js";
import { brand, brandText, brandDeep } from "./brand.js";
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { activeCalls } from "./cad.js";
import { onDuty } from "./aladtec.js";
import { markEmergency, clearEmergency } from "./emergency.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const unitKey = u => String(u || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const LOCATIONS = { assigned: "Assigned / en route", staged: "Staged", interior: "Interior", exterior: "Exterior", rit: "RIT", rehab: "Rehab", released: "Released" };
export const BENCHMARKS = { waterOnFire: "Water on the fire", primaryStart: "Primary search started", primary: "Primary search all clear",
  secondaryStart: "Secondary search started", secondary: "Secondary search all clear",
  underControl: "Fire under control", lossStopped: "Loss stopped", utilities: "Utilities secured" };
const SIDES = ["A", "B", "C", "D"];
// Floor the smoke is showing from: a number (1–150), or Basement / Attic / Roof.
const FLOOR_WORDS = ["Basement", "Attic", "Roof"];
function floorOf(v) {
  const t = String(v ?? "").trim();
  const w = FLOOR_WORDS.find(x => x.toLowerCase() === t.toLowerCase());
  if (w) return w;
  const n = parseInt(t.replace(/(st|nd|rd|th)$/i, ""), 10);
  return n >= 1 && n <= 150 && /^\d+(st|nd|rd|th)?$/i.test(t) ? String(n) : "";
}
const smokeWhere = x => [x.side ? `${x.side} side` : "", x.floor ? (/^\d/.test(x.floor) ? `floor ${x.floor}` : x.floor.toLowerCase()) : ""].filter(Boolean).join(", ");
const SMOKE = { volume: ["Light", "Moderate", "Heavy"], velocity: ["Lazy", "Pushing", "Turbulent"], density: ["Thin", "Thick", "Black fire"], color: ["White", "Gray", "Brown", "Black"] };

async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'command'")).rows[0]?.value;
  const d = (typeof v === "string" ? JSON.parse(v) : v) || {};
  return { officerTitles: clean(d.officerTitles, 300) || "chief|battalion|captain|lieutenant|\\bbc\\b|\\bac\\b", interiorWarnMinutes: Math.min(60, Math.max(5, Number(d.interiorWarnMinutes) || 20)) };
}
async function rights(user) {
  const master = user.role === "master";
  const s = await settings();
  const title = (await pool.query("SELECT coalesce(job_title, '') AS t FROM users WHERE id = $1", [user.id])).rows[0]?.t || "";
  let byTitle = false;
  try { byTitle = !!title && new RegExp(s.officerTitles, "i").test(title); } catch { byTitle = false; }
  const edit = master || byTitle || (await hasAccess(pool, user, "command", "edit"));
  const manage = master || (await hasAccess(pool, user, "command", "manage"));
  return { edit, manage, settings: s };
}

// ---- Who is on a unit ----------------------------------------------------------------------------
// Aladtec positions/schedules that name the unit ("EG653 Officer", "Engine 653"? no: the unit id itself), else people whose
// directory call sign is the unit (SG10 = a chief, an investigator).
export async function ridersFor(units) {
  const want = [...new Set(units.map(unitKey).filter(Boolean))].slice(0, 40);
  const out = Object.fromEntries(want.map(u => [u, []]));
  if (!want.length) return out;
  const duty = onDuty();
  const list = duty.assignments || [];
  for (const a of list) {
    const text = ` ${String(a.positionLabel || "")} ${String(a.scheduleName || "")} `.toUpperCase().replace(/([A-Z]+)[\s-]+(\d)/g, "$1$2");
    for (const u of want) {
      // "EG653 Officer" names the unit outright; "Engine 653" / "Engine653" matches EG653 (same first letter, same number)
      const [, letters, digits] = u.match(/^([A-Z]+)(\d+)$/) || [];
      const spelled = letters && new RegExp(`(^|[^A-Z0-9])${letters[0]}[A-Z]*${digits}([^A-Z0-9]|$)`).test(text);
      if ((new RegExp(`(^|[^A-Z0-9])${u}([^A-Z0-9]|$)`).test(text) || spelled) && !out[u].some(r => r.name === a.name)) {
        out[u].push({ name: a.name, position: clean(a.positionLabel, 80), source: "aladtec" });
      }
    }
  }
  const missing = want.filter(u => !out[u].length);
  if (missing.length) {
    const rows = (await pool.query(`SELECT full_name, coalesce(job_title, '') AS title, upper(call_sign) AS cs FROM users
      WHERE active AND account_status = 'approved' AND call_sign <> '' AND upper(call_sign) = ANY(string_to_array($1, ','))`, [missing.join(",")])).rows;
    for (const r of rows) out[r.cs]?.push({ name: r.full_name, position: r.title, source: "directory" });
  }
  return out;
}

// ---- Boards ---------------------------------------------------------------------------------------
const blankState = () => ({ strategy: "", attack: "", view: "diagram", aSide: "bottom", building: { x: 440, y: 510, w: 400, h: 260 }, imageId: null, imageW: null, imageH: null,
  crews: [], benchmarks: {}, mayday: null, smoke: {}, par: { lastAt: null, round: 0 } });
// Who runs a board: the incident commander (whoever opened it, or took / was handed command) and the people the IC chose to
// edit with them (an aide, a chief's tech, the safety officer). Other officers watch and can "Assume command".
export const commandOf = b => {
  const c = b.state?.command;
  return c?.icId ? { icId: c.icId, icName: c.icName || "", editors: Array.isArray(c.editors) ? c.editors : [] } : { icId: b.opened_by, icName: b.opened_by_name || "", editors: [] };
};
export function roleOn(b, user, r) {
  if (!user || !r) return "watch";
  const c = commandOf(b);
  if (c.icId === user.id) return "ic";
  if (c.editors.some(e => e.id === user.id)) return "editor";
  return r.edit ? "officer" : "watch";
}
export function boardJson(b, events, r, user = null) {
  const role = roleOn(b, user, r), cmd = commandOf(b);
  return { id: b.id, incidentId: b.incident_id, number: b.incident_number, nature: b.nature, address: b.address, lat: b.lat, lon: b.lon,
    kind: b.kind || "incident", title: b.title || "", fromCad: b.from_cad !== false,
    receivedAt: b.received_at, openedAt: b.opened_at, openedBy: b.opened_by_name, completedBy: b.completed_by_name || "", status: b.status, closedAt: b.closed_at, version: b.version,
    state: b.state, events: events?.map(e => ({ id: e.id, at: e.at, kind: e.kind, text: e.text, critical: e.critical, by: e.by_name })),
    command: cmd, role, canEdit: role === "ic" || role === "editor", isIc: role === "ic", canAssume: role === "officer" && b.status === "open", settings: r ? { interiorWarnMinutes: r.settings.interiorWarnMinutes } : undefined, now: new Date().toISOString() };
}
async function crewsFromCall(call, existing = []) {
  const have = new Set(existing.map(c => c.unit));
  const units = (call?.unitStatus || []).map(u => u.unit).filter(u => u && !have.has(u));
  if (!units.length) return [];
  const riders = await ridersFor(units);
  return units.map(u => ({ unit: u, names: (riders[unitKey(u)] || []).map(r => r.name), location: "assigned", assignment: "", inAt: null, par: false, x: null, y: null, side: "" }));
}
const findCall = incidentId => (activeCalls().calls || []).find(c => String(c.id) === String(incidentId));
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Command board', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}

// Which side or corner a point is on, given the building box and which screen edge is the A (front) side
export function sideOf(b, aSide, x, y) {
  if (!b || x == null || y == null) return "";
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // rotate so that A is at the bottom of the screen
  const rot = { bottom: 0, left: 90, top: 180, right: 270 }[aSide] ?? 0;
  let dx = x - cx, dy = y - cy, hw = b.w / 2, hh = b.h / 2;
  for (let k = 0; k < rot / 90; k++) { [dx, dy] = [dy, -dx]; [hw, hh] = [hh, hw]; }
  const out = { h: Math.abs(dx) > hw ? Math.sign(dx) : 0, v: Math.abs(dy) > hh ? Math.sign(dy) : 0 };
  if (!out.h && !out.v) return "Inside";
  // A bottom (v = +1), C top, B left (h = -1), D right
  const v = out.v > 0 ? "A" : out.v < 0 ? "C" : "", h = out.h < 0 ? "B" : out.h > 0 ? "D" : "";
  if (v && h) return { AB: "A/B corner", AD: "A/D corner", CB: "B/C corner", CD: "C/D corner" }[v + h];
  return `${v || h} side`;
}

// One change to a board. Returns [new state, event text, critical]
function apply(st, a, by) {
  const now = new Date().toISOString();
  const crew = u => { const c = st.crews.find(x => x.unit === u); if (!c) throw err(400, `${u} isn't on this board.`); return c; };
  switch (a.type) {
    case "crew_add": {
      const unit = clean(a.unit, 20).toUpperCase();
      if (!unit) throw err(400, "Enter the unit.");
      if (st.crews.some(c => c.unit === unit)) throw err(400, `${unit} is already on the board.`);
      st.crews.push({ unit, names: (Array.isArray(a.names) ? a.names : []).map(n => clean(n, 80)).filter(Boolean), location: "assigned", assignment: "", inAt: null, par: false, x: null, y: null, side: "" });
      return [`${unit} added to the board`];
    }
    case "crew_move": {
      const c = crew(a.unit), loc = LOCATIONS[a.location] ? a.location : null;
      if (!loc) throw err(400, "Pick where the crew is.");
      const was = c.location;
      c.location = loc;
      if (loc === "interior" && was !== "interior") c.inAt = now;
      if (loc !== "interior") c.inAt = null;
      return [`${c.unit} ${loc === "interior" ? "went INTERIOR" : was === "interior" ? `came OUT (now ${LOCATIONS[loc]})` : `is ${LOCATIONS[loc]}`}${c.assignment ? ` · ${c.assignment}` : ""}`];
    }
    case "crew_assign": { const c = crew(a.unit); c.assignment = clean(a.assignment, 80); return [`${c.unit} assigned: ${c.assignment || "(none)"}`]; }
    case "crew_names": { const c = crew(a.unit); c.names = (Array.isArray(a.names) ? a.names : []).map(n => clean(n, 80)).filter(Boolean).slice(0, 8); return [`${c.unit} crew: ${c.names.join(", ") || "(none)"}`]; }
    case "crew_place": {
      const c = crew(a.unit);
      c.x = a.x == null ? null : Number(a.x); c.y = a.y == null ? null : Number(a.y);
      c.side = c.x == null ? "" : sideOf(st.building, st.aSide, c.x, c.y);
      return [c.x == null ? `${c.unit} taken off the scene view` : `${c.unit} positioned ${c.side || "on scene"}`];
    }
    case "par_crew": { const c = crew(a.unit); c.par = !!a.ok; return [`PAR ${c.unit}: ${c.par ? "accounted for" : "NOT accounted for"}`, !c.par]; }
    case "par_complete": {
      const checked = st.crews.filter(c => !["released"].includes(c.location));
      const missing = checked.filter(c => !c.par).map(c => c.unit);
      st.par = { lastAt: now, round: (st.par?.round || 0) + 1 };
      for (const c of st.crews) c.par = false;
      return [missing.length ? `PAR ${st.par.round} done; NOT accounted for: ${missing.join(", ")}` : `PAR ${st.par.round} complete, all crews accounted for`, missing.length > 0];
    }
    case "strategy": {
      const v = ["offensive", "defensive", "transitional"].includes(a.value) ? a.value : "";
      const was = st.strategy; st.strategy = v;
      return [`Strategy: ${was ? `${was.toUpperCase()} → ` : ""}${v.toUpperCase() || "not set"}`, was === "offensive" && v === "defensive"];
    }
    case "attack": { st.attack = ["interior", "exterior"].includes(a.value) ? a.value : ""; return [`Attack: ${st.attack.toUpperCase() || "not set"}`]; }
    case "benchmark": {
      const k = BENCHMARKS[a.key] ? a.key : null;
      if (!k) throw err(400, "Unknown benchmark.");
      if (st.benchmarks[k] && !a.on) { delete st.benchmarks[k]; return [`${BENCHMARKS[k]} taken back`]; }
      st.benchmarks[k] = now;
      return [BENCHMARKS[k]];
    }
    case "mayday": {
      st.mayday = { active: true, unit: clean(a.unit, 20).toUpperCase(), who: clean(a.who, 120), location: clean(a.location, 160), at: now, by };
      return [`MAYDAY: ${[st.mayday.who, st.mayday.unit].filter(Boolean).join(", ") || "member"}${st.mayday.location ? ` at ${st.mayday.location}` : ""}`, true];
    }
    case "mayday_clear": {
      if (!st.mayday?.active) throw err(400, "There's no active MAYDAY.");
      st.mayday = { ...st.mayday, active: false, clearedAt: now, note: clean(a.note, 200) };
      return [`MAYDAY cleared${st.mayday.note ? `: ${st.mayday.note}` : ""}`, true];
    }
    case "note": {
      const text = clean(a.text, 500);
      if (!text) throw err(400, "Type the note.");
      return [text, !!a.critical];
    }
    case "smoke": {
      const side = SIDES.includes(a.side) ? a.side : "";
      const floor = floorOf(a.floor);
      const r = { side, floor, at: now, by };
      for (const k of Object.keys(SMOKE)) r[k] = SMOKE[k].includes(a[k]) ? a[k] : "";
      r.note = clean(a.note, 200);
      if (!Object.keys(SMOKE).some(k => r[k]) && !r.note) throw err(400, "Pick what the smoke is doing.");
      st.smoke[(side || "general") + (floor ? `|${floor}` : "")] = r;
      const words = Object.keys(SMOKE).map(k => r[k]).filter(Boolean).join(", ");
      const where = smokeWhere(r);
      return [`Smoke${where ? ` ${where}` : ""}: ${words}${r.note ? ` — ${r.note}` : ""}`, r.density === "Black fire" || r.velocity === "Turbulent"];
    }
    case "scene": {
      if (a.view) st.view = a.view === "aerial" && st.imageId ? "aerial" : "diagram";
      if (a.aSide && ["bottom", "top", "left", "right"].includes(a.aSide)) st.aSide = a.aSide;
      if (a.building !== undefined) {
        const b = a.building;
        st.building = b && [b.x, b.y, b.w, b.h].every(v => Number.isFinite(Number(v))) && b.w > 2 && b.h > 2 ? { x: +b.x, y: +b.y, w: +b.w, h: +b.h } : null;
      }
      for (const c of st.crews) c.side = c.x == null ? "" : sideOf(st.building, st.aSide, c.x, c.y);
      return [null];                                                                // layout only, not logged
    }
    default: throw err(400, "Unknown change.");
  }
}

async function geocode(address) {
  const base = process.env.GEOCODER_BASE || "https://geocoding.geo.census.gov";
  let j;
  try {
    const r = await fetch(`${base}/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(15_000) });
    j = await r.json();
  } catch (e) { throw err(502, `The address lookup didn't answer (${e.message}). Leave "Find it on the map" off and use the diagram.`); }
  const m = j?.result?.addressMatches?.[0];
  if (!m) throw err(404, "That address wasn't found for the aerial. Try the full street address with city and state, or leave \"Find it on the map\" off.");
  return { lat: m.coordinates.y, lon: m.coordinates.x };
}

// ---- After-action report (a self-contained HTML file: no scripts, prints on Letter) ----------------
const esc = v => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const TZ = process.env.TZ_DISPLAY || "America/Chicago";
const hm = d => d ? new Date(d).toLocaleTimeString("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "";
const dt = d => d ? new Date(d).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
const mins = (a, b) => { const m = Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
export function reportHtml(b, events) {
  const st = { ...blankState(), ...(b.state || {}) };
  const start = b.received_at || b.opened_at, end = b.closed_at || new Date();
  const since = at => `+${mins(start, at)}`;
  const bench = Object.entries(BENCHMARKS).map(([k, label]) => `<tr><td>${esc(label)}</td><td>${st.benchmarks[k] ? `${hm(st.benchmarks[k])} <span class="m">(${since(st.benchmarks[k])})</span>` : "—"}</td></tr>`).join("");
  const crews = st.crews.map(c => `<tr><td><b>${esc(c.unit)}</b></td><td>${esc(c.names.join(", "))}</td><td>${esc(c.assignment)}</td><td>${esc(LOCATIONS[c.location] || c.location)}</td><td>${esc(c.side)}</td></tr>`).join("");
  const smoke = Object.values(st.smoke || {}).map(x => `<tr><td>${esc(smokeWhere(x) || "General")}</td><td>${esc([x.volume, x.velocity, x.density, x.color].filter(Boolean).join(", "))}</td><td>${esc(x.note)}</td><td>${hm(x.at)}</td></tr>`).join("");
  const log = events.map(e => `<tr class="${e.critical ? "crit" : ""}"><td>${hm(e.at)}</td><td class="m">${since(e.at)}</td><td>${esc(e.text)}</td><td class="m">${esc(e.by_name)}</td></tr>`).join("");
  const mayday = st.mayday ? `<div class="may">MAYDAY ${esc([st.mayday.who, st.mayday.unit].filter(Boolean).join(", "))}${st.mayday.location ? ` at ${esc(st.mayday.location)}` : ""} · called ${hm(st.mayday.at)}${st.mayday.clearedAt ? ` · cleared ${hm(st.mayday.clearedAt)}` : " · not cleared on the board"}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Command board ${esc(b.incident_number)}</title>
<style>body{font:13px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#13233F;margin:24px;max-width:900px}h1{font-size:20px;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #C8102E;padding-bottom:3px;margin:20px 0 6px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #DDE2EA;padding:4px 6px;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#4B5565}.m{color:#4B5565;font-size:12px}
.crit td{color:#C8102E;font-weight:600}.may{border:2px solid #C8102E;color:#C8102E;font-weight:700;padding:8px;margin:10px 0}.grid{display:flex;gap:24px;flex-wrap:wrap}.grid>div{flex:1 1 260px}
@page{size:letter;margin:.5in}@media print{body{margin:0}}</style></head><body>
<div class="m">${esc(brand().org)} · ${b.kind === "training" ? "<b style=\"color:#C8102E\">TRAINING</b> command board" : "Command board after-action record"}${b.from_cad === false && b.kind !== "training" ? " (made by hand, not from CAD)" : ""}</div>
<h1>${esc(b.title || b.nature || "Fire call")}${b.incident_number ? ` · #${esc(b.incident_number)}` : ""}</h1>${b.title && b.nature ? `<div>${esc(b.nature)}</div>` : ""}
<div>${esc(b.address)}</div>
<div class="m">Received ${dt(b.received_at)} · board opened ${dt(b.opened_at)} by ${esc(b.opened_by_name)}${b.closed_at ? ` · closed ${dt(b.closed_at)} by ${esc(b.completed_by_name)} · ${mins(start, end)} on the board` : " · still open"}</div>
<div class="m">Incident commander: <b>${esc(commandOf(b).icName)}</b>${commandOf(b).editors.length ? ` · also on the board: ${esc(commandOf(b).editors.map(e => e.name).join(", "))}` : ""}</div>
${mayday}
<div class="grid"><div><h2>Strategy</h2><table><tr><td>Strategy</td><td><b>${esc((st.strategy || "not set").toUpperCase())}</b></td></tr><tr><td>Attack</td><td><b>${esc((st.attack || "not set").toUpperCase())}</b></td></tr><tr><td>PAR checks</td><td>${st.par?.round || 0}</td></tr></table></div>
<div><h2>Benchmarks</h2><table>${bench}</table></div></div>
<h2>Crews at the end</h2><table><tr><th>Unit</th><th>Crew</th><th>Assignment</th><th>Where</th><th>Position</th></tr>${crews || `<tr><td colspan="5">None</td></tr>`}</table>
${smoke ? `<h2>Smoke reading (last by side and floor)</h2><table><tr><th>Where</th><th>Reading</th><th>Note</th><th>At</th></tr>${smoke}</table>` : ""}
<h2>Timeline</h2><table><tr><th>Time</th><th>Since call</th><th>What happened</th><th>By</th></tr>${log}</table>
<p class="m">Critical entries are in red. Printed from ${esc(brand().app)}${b.report_at ? `, report written ${dt(b.report_at)}` : ""}.</p></body></html>`;
}

export async function handleCommand(req, res, parts, user, send, jsonBody, url) {
  const what = parts[2];
  const r = await rights(user);
  if (req.method === "GET" && !what) {
    // Open boards, incidents closed in the last 60 days, and every saved training board (unsaved ones are discarded on close)
    const boards = (await pool.query(`SELECT * FROM command_boards WHERE status = 'open' OR kind = 'training' OR closed_at > now() - interval '60 days'
      ORDER BY status DESC, opened_at DESC LIMIT 300`)).rows;
    return send(res, 200, { boards: boards.map(b => boardJson(b, null, null)), canEdit: r.edit, manage: r.manage, settings: r.manage ? r.settings : undefined });
  }
  // People the IC can add to the board or hand command to (any active account: an aide may not be an officer)
  if (req.method === "GET" && what === "people") {
    const rows = (await pool.query(`SELECT id, full_name, coalesce(job_title, '') AS title, coalesce(call_sign, '') AS call_sign FROM users
      WHERE active AND account_status = 'approved' ORDER BY full_name`)).rows;
    return send(res, 200, { people: rows.map(x => ({ id: x.id, name: x.full_name, title: x.title, callSign: x.call_sign })) });
  }
  if (req.method === "GET" && what === "person") {
    // A person's Personnel File: boards they completed (closed as the incident commander) or opened
    const pid = isUuid(parts[3]) ? parts[3] : user.id;
    // Someone else's list: master admins, Command Board managers and officers (who review boards); everyone else sees their own
    if (pid !== user.id && !(user.role === "master" || r.manage || r.edit)) throw err(403, "You can only see your own command boards.");
    const rows = (await pool.query(`SELECT * FROM command_boards WHERE completed_by = $1 OR (opened_by = $1 AND completed_by IS DISTINCT FROM $1)
      ORDER BY opened_at DESC LIMIT 200`, [pid])).rows;
    return send(res, 200, { boards: rows.map(b => ({ ...boardJson(b, null, null), role: b.completed_by === pid ? "completed" : "opened" })) });
  }
  if (req.method === "GET" && what === "riders") {
    return send(res, 200, { riders: await ridersFor(String(url.searchParams.get("units") || "").split(",")) });
  }
  if (req.method === "GET" && what === "incident") {
    const b = (await pool.query("SELECT * FROM command_boards WHERE incident_id = $1", [clean(parts[3], 60)])).rows[0];
    return send(res, 200, { board: b ? { id: b.id, status: b.status } : null, canEdit: r.edit });
  }
  if (what === "settings") {
    if (!r.manage) throw err(403, "Only Command Board managers can change its settings.");
    if (req.method === "GET") return send(res, 200, r.settings);
    const b = await jsonBody(req);
    try { new RegExp(clean(b.officerTitles, 300), "i"); } catch { throw err(400, "Those job title words aren't a valid pattern."); }
    if (risky(clean(b.officerTitles, 300))) throw err(400, "Those job title words are too complicated. Use plain words separated by |.");
    const value = { officerTitles: clean(b.officerTitles, 300), interiorWarnMinutes: Number(b.interiorWarnMinutes) || 20 };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('command', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
    await audit(user, "Changed settings", `Officer titles: ${value.officerTitles}`);
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && what === "new") {
    // A board made by hand: training (to teach the board; also a fresh copy of a saved one) or a real incident that isn't in CAD
    if (!r.edit) throw err(403, "Only chief officers and company officers (or people given Command Board: Edit) can make a command board.");
    const b = await jsonBody(req);
    let src = null;
    if (b.copyFrom) {
      if (!isUuid(b.copyFrom)) throw err(400, "Pick a board to copy.");
      src = (await pool.query("SELECT * FROM command_boards WHERE id = $1", [b.copyFrom])).rows[0];
      if (!src) throw err(404, "That board wasn't found.");
    }
    const kind = b.kind === "incident" ? "incident" : "training";
    const nature = clean(b.nature ?? src?.nature, 120) || (kind === "training" ? "Structure fire (training)" : "");
    const address = clean(b.address ?? src?.address, 200);
    if (kind === "incident" && !address) throw err(400, "Enter the address.");
    let lat = src ? src.lat : (Number.isFinite(Number(b.lat)) && b.lat !== "" && b.lat != null ? Number(b.lat) : null);
    let lon = src ? src.lon : (Number.isFinite(Number(b.lon)) && b.lon !== "" && b.lon != null ? Number(b.lon) : null);
    if (!src && b.findAddress && address) ({ lat, lon } = await geocode(address));
    const unitList = src ? (src.state.crews || []).map(c => c.unit) : String(b.units || "").split(/[,\s]+/).map(u => clean(u, 20).toUpperCase()).filter(Boolean);
    const st = blankState();
    st.command = { icId: user.id, icName: user.name, editors: [] };
    if (src) for (const k of ["building", "aSide", "imageId", "imageW", "imageH", "view"]) st[k] = src.state[k] ?? st[k];
    st.crews = await crewsFromCall({ unitStatus: [...new Set(unitList)].slice(0, 40).map(unit => ({ unit })) });
    const now = new Date().toISOString();
    st.par.lastAt = now;
    const title = clean(b.title ?? (src ? `${src.title || src.nature} (again)` : ""), 120);
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO command_boards (id, incident_id, incident_number, nature, address, lat, lon, received_at, state, opened_by, opened_by_name, kind, from_cad, title)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)`,
      [id, `manual-${id}`, kind === "incident" ? clean(b.number, 40) : "", nature, address, lat, lon, now, JSON.stringify(st), user.id, user.name, kind, title]);
    await pool.query("INSERT INTO command_events (board_id, kind, text, by_id, by_name) VALUES ($1, 'open', $2, $3, $4)",
      [id, `${kind === "training" ? "Training board" : "Command board (not from CAD)"} made by ${user.name}${src ? ` from "${src.title || src.nature}"` : ""}`, user.id, user.name]);
    await audit(user, kind === "training" ? "Made training board" : "Made command board by hand", `${title || nature} ${address}`.trim());
    return send(res, 200, { id });
  }
  if (req.method === "POST" && what === "open") {
    if (!r.edit) throw err(403, "Only chief officers and company officers (or people given Command Board: Edit) can open a command board.");
    const b = await jsonBody(req);
    const have = (await pool.query("SELECT id FROM command_boards WHERE incident_id = $1", [clean(b.incidentId, 60)])).rows[0];
    if (have) return send(res, 200, { id: have.id });
    const call = findCall(b.incidentId);
    if (!call) throw err(404, "That call isn't in Active calls anymore.");
    const st = blankState();
    st.command = { icId: user.id, icName: user.name, editors: [] };
    st.crews = await crewsFromCall(call);
    st.par.lastAt = call.receivedAt || new Date().toISOString();
    const row = (await pool.query(`INSERT INTO command_boards (incident_id, incident_number, nature, address, lat, lon, received_at, state, opened_by, opened_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (incident_id) DO NOTHING RETURNING id`,
      [String(call.id), call.number || "", call.type || "", [call.address, call.city].filter(Boolean).join(", "), call.lat, call.lon, call.receivedAt || null, JSON.stringify(st), user.id, user.name])).rows[0];
    const id = row?.id || (await pool.query("SELECT id FROM command_boards WHERE incident_id = $1", [String(call.id)])).rows[0].id;
    if (row) {
      await pool.query("INSERT INTO command_events (board_id, kind, text, by_id, by_name) VALUES ($1, 'open', $2, $3, $4)", [id, `Command board opened by ${user.name}`, user.id, user.name]);
      await audit(user, "Opened command board", `${call.number || call.id} ${call.type || ""}`);
    }
    return send(res, 200, { id });
  }
  if (!isUuid(what)) throw err(404, "Not found");
  const id = what;

  if (req.method === "GET" && !parts[3]) {
    let b = (await pool.query("SELECT * FROM command_boards WHERE id = $1", [id])).rows[0];
    if (!b) throw err(404, "That command board wasn't found.");
    // New units CAD put on the call since the last look join the board on their own
    if (b.status === "open") {
      const add = await crewsFromCall(findCall(b.incident_id), b.state.crews || []);
      if (add.length) {
        b = await tx(async c => {
          const cur = (await c.query("SELECT * FROM command_boards WHERE id = $1 FOR UPDATE", [id])).rows[0];
          const st = cur.state; const fresh = add.filter(x => !st.crews.some(y => y.unit === x.unit));
          if (!fresh.length) return cur;
          st.crews.push(...fresh);
          for (const x of fresh) await c.query("INSERT INTO command_events (board_id, kind, text, by_name) VALUES ($1, 'crew_add', $2, 'CAD')", [id, `${x.unit} assigned by CAD${x.names.length ? ` (${x.names.join(", ")})` : ""}`]);
          return (await c.query("UPDATE command_boards SET state = $2, version = version + 1 WHERE id = $1 RETURNING *", [id, JSON.stringify(st)])).rows[0];
        });
      }
    }
    // Emergency mode for the officer working the board (?em=1 from the board screen; off when the board is closed)
    const mine = ["ic", "editor"].includes(roleOn(b, user, r));
    if (url.searchParams.get("em") === "1" && mine && b.status === "open" && b.kind !== "training") markEmergency(user.id);
    else if (url.searchParams.get("em") === "0" || b.status !== "open") clearEmergency(user.id);
    if (Number(url.searchParams.get("v")) === b.version) return send(res, 200, { same: true, version: b.version, now: new Date().toISOString() });
    const events = (await pool.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [id])).rows;
    const out = boardJson(b, events, r, user);
    const { canUseRecordings } = await import("./recordings.js");
    if (await canUseRecordings(user)) out.recordings = (await pool.query("SELECT id, address, started_at FROM fire_recordings WHERE command_board_id = $1 ORDER BY started_at", [id])).rows
      .map(x => ({ id: x.id, address: x.address, startedAt: x.started_at }));
    out.completedBy = b.completed_by_name || "";
    return send(res, 200, out);
  }
  if (req.method === "GET" && parts[3] === "report") {
    const b = (await pool.query("SELECT * FROM command_boards WHERE id = $1", [id])).rows[0];
    if (!b) throw err(404, "That command board wasn't found.");
    const html = b.status === "closed" && b.report_html ? b.report_html
      : reportHtml(b, (await pool.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [id])).rows);
    const name = `${b.kind === "training" ? "Training board" : "Command board"} ${String(b.incident_number || b.title || "board").replace(/[^\w -]/g, "").slice(0, 60)} ${new Date(b.opened_at).toISOString().slice(0, 10)}.html`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'",
      "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${name}"` });
    return res.end(html);
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const body = await jsonBody(req);
  // Changes: the IC and the people the IC added. Any officer may take command (or reopen a closed board, which makes them IC).
  const NOT_YOURS = "Only the incident commander and the people they added can change this board. Use Assume command if you're taking over.";
  const gate = b => {
    const role = roleOn(b, user, r);
    if (role === "ic" || role === "editor") return role;
    if (role === "officer" && ["assume_command", "reopen"].includes(body.type) && parts[3] === "action") return role;
    throw err(403, role === "officer" ? NOT_YOURS : "Only officers running the incident can change the command board.");
  };
  if (parts[3] === "aerial" || parts[3] === "picture" || parts[3] === "discard") {
    const b0 = (await pool.query("SELECT * FROM command_boards WHERE id = $1", [id])).rows[0];
    if (!b0) throw err(404, "That command board wasn't found.");
    gate(b0);
  }

  // The scene picture: a USGS aerial (2048 px; Closer 500 ft, Normal 800 ft, Wider 1500 ft across), optionally re-centered on a point
  // tapped on the current aerial ({dx, dy} = pixels from its center), or a picture the IC uploads ({picture: {mime, data, width, height}}).
  if (parts[3] === "aerial" || parts[3] === "picture") {
    const b = (await pool.query("SELECT lat, lon, address, state FROM command_boards WHERE id = $1", [id])).rows[0];
    if (!b) throw err(404, "That command board wasn't found.");
    let img, imgLat = null, imgLon = null, source = "usgs", attribution = "Imagery: USGS The National Map (NAIP)";
    if (parts[3] === "picture") {
      const pic = body.picture || {};
      if (!/^image\/(jpeg|png|webp)$/.test(pic.mime || "")) throw err(400, "Upload a JPEG, PNG or WebP picture.");
      const buf = Buffer.from(String(pic.data || "").replace(/^data:[^,]*,/, ""), "base64");
      if (buf.length < 500 || buf.length > 15 * 1024 * 1024) throw err(400, "The picture must be under 15 MB.");
      const width = Math.round(Number(pic.width)), height = Math.round(Number(pic.height));
      if (!(width >= 200 && height >= 200 && width <= 8000 && height <= 8000)) throw err(400, "That picture's size didn't come through. Try another.");
      img = { buf, width, height, ftPerPx: null, mime: pic.mime };
      source = "upload"; attribution = clean(body.credit, 120) || "Picture uploaded to the command board";
    } else {
      const st0 = b.state || {};
      let lat = b.lat, lon = b.lon;
      // Re-center: from the current aerial's center, move by the tapped offset (north is up)
      if (Number.isFinite(Number(body.dx)) && Number.isFinite(Number(body.dy)) && st0.imgLat != null && st0.imgFtPerPx) {
        const m = st0.imgFtPerPx * 0.3048;
        lat = st0.imgLat - (Number(body.dy) * m) / 111320;
        lon = st0.imgLon + (Number(body.dx) * m) / (111320 * Math.cos(st0.imgLat * Math.PI / 180));
      }
      if (lat == null || lon == null) throw err(400, "CAD didn't send a map point for this call. Use the diagram, or upload a picture.");
      const feet = { closer: 500, normal: 800, wider: 1500 }[body.range] || Math.min(1500, Math.max(200, Number(body.feet) || 800));
      const { fetchAerial } = await import("./evals.js");
      img = { ...(await fetchAerial({ lat, lon, feet, size: 2048 })), mime: "image/jpeg" };
      imgLat = lat; imgLon = lon;
    }
    const imgId = crypto.randomUUID();
    await pool.query(`INSERT INTO sim_images (id, name, mime, data, width, height, ft_per_px, source, attribution, lat, lon, created_by_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [imgId, b.address || "Command board", img.mime, img.buf, img.width, img.height, img.ftPerPx, source, attribution, imgLat, imgLon, user.name]);
    const out = await tx(async c => {
      const cur = (await c.query("SELECT * FROM command_boards WHERE id = $1 FOR UPDATE", [id])).rows[0];
      const st = cur.state;
      st.imageId = imgId; st.imageW = img.width; st.imageH = img.height; st.view = "aerial";
      st.imgLat = imgLat; st.imgLon = imgLon; st.imgFtPerPx = img.ftPerPx; st.imgCredit = attribution;
      // a starting building box in the middle of the picture (about 60 x 40 ft; a third of an uploaded picture)
      const ft = img.ftPerPx;
      st.building = ft ? { x: img.width / 2 - 30 / ft, y: img.height / 2 - 20 / ft, w: 60 / ft, h: 40 / ft }
        : { x: img.width / 3, y: img.height / 3, w: img.width / 3, h: img.height / 4 };
      for (const cr of st.crews) { cr.x = null; cr.y = null; cr.side = ""; }
      await c.query("INSERT INTO command_events (board_id, kind, text, by_id, by_name) VALUES ($1, 'scene', $2, $3, $4)",
        [id, source === "upload" ? "Scene picture uploaded" : `Aerial loaded (${Math.round(img.ftPerPx * img.width)} ft across)`, user.id, user.name]);
      return (await c.query("UPDATE command_boards SET state = $2, version = version + 1 WHERE id = $1 RETURNING *", [id, JSON.stringify(st)])).rows[0];
    });
    const events = (await pool.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [id])).rows;
    return send(res, 200, boardJson(out, events, r, user));
  }
  if (parts[3] === "discard") {
    // Training boards only: closed without saving
    const b = (await pool.query("SELECT kind, title, nature, opened_by FROM command_boards WHERE id = $1", [id])).rows[0];
    if (!b) throw err(404, "That command board wasn't found.");
    if (b.kind !== "training") throw err(400, "Only training boards can be discarded. Incident boards are kept as records.");
    await pool.query("UPDATE fire_recordings SET command_board_id = NULL WHERE command_board_id = $1", [id]);
    await pool.query("DELETE FROM command_boards WHERE id = $1", [id]);
    await audit(user, "Discarded training board", b.title || b.nature);
    return send(res, 200, { ok: true });
  }
  if (parts[3] === "action") {
    const out = await tx(async c => {
      const cur = (await c.query("SELECT * FROM command_boards WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!cur) throw err(404, "That command board wasn't found.");
      const role = gate(cur);
      if (["assume_command", "transfer_command", "editor_add", "editor_remove"].includes(body.type) || (body.type === "reopen" && role === "officer")) {
        if (cur.status === "closed" && body.type !== "reopen") throw err(400, "This board is closed. Reopen it to make changes.");
        const st = { ...blankState(), ...cur.state };
        const cmd = commandOf(cur);
        const person = async uid => {
          if (!isUuid(uid)) throw err(400, "Pick someone.");
          const u = (await c.query("SELECT id, full_name FROM users WHERE id = $1 AND active AND account_status = 'approved'", [uid])).rows[0];
          if (!u) throw err(404, "That person wasn't found.");
          return { id: u.id, name: u.full_name };
        };
        let text = "";
        if (body.type === "assume_command" || body.type === "reopen") {
          if (role === "ic" || (body.type === "reopen" && cur.status === "open")) return cur;
          const was = cmd.icName;
          cmd.editors = [...cmd.editors.filter(e => e.id !== user.id), ...(cmd.icId && cmd.icId !== user.id ? [{ id: cmd.icId, name: cmd.icName }] : [])];
          cmd.icId = user.id; cmd.icName = user.name;
          text = body.type === "reopen" ? `Command board reopened; ${user.name} is incident commander` : `${user.name} assumed command${was ? ` from ${was}` : ""}`;
          if (body.type === "reopen") await c.query("UPDATE command_boards SET status = 'open', closed_at = NULL WHERE id = $1", [id]);
        } else {
          if (role !== "ic") throw err(403, "Only the incident commander can do that.");
          const p = await person(body.userId);
          if (body.type === "transfer_command") {
            if (p.id === user.id) return cur;
            cmd.editors = [...cmd.editors.filter(e => e.id !== p.id), { id: user.id, name: user.name }];
            cmd.icId = p.id; cmd.icName = p.name;
            text = `Command transferred from ${user.name} to ${p.name}`;
          } else if (body.type === "editor_add") {
            if (p.id === cmd.icId || cmd.editors.some(e => e.id === p.id)) return cur;
            if (cmd.editors.length >= 8) throw err(400, "Up to 8 people can edit with the IC.");
            cmd.editors.push(p);
            text = `${p.name} added to the board by ${user.name}`;
          } else {
            if (!cmd.editors.some(e => e.id === p.id)) return cur;
            cmd.editors = cmd.editors.filter(e => e.id !== p.id);
            text = `${p.name} removed from editing the board`;
          }
        }
        st.command = cmd;
        await c.query("INSERT INTO command_events (board_id, kind, text, critical, by_id, by_name) VALUES ($1, $2, $3, false, $4, $5)", [id, body.type, text, user.id, user.name]);
        return (await c.query("UPDATE command_boards SET state = $2, version = version + 1 WHERE id = $1 RETURNING *", [id, JSON.stringify(st)])).rows[0];
      }
      if (body.type === "close" || body.type === "reopen") {
        const closing = body.type === "close";
        if (closing === (cur.status === "closed")) return cur;
        if (closing && role !== "ic") throw err(403, "Only the incident commander can close the board.");
        await c.query("INSERT INTO command_events (board_id, kind, text, by_id, by_name) VALUES ($1, $2, $3, $4, $5)", [id, body.type, closing ? (cur.kind === "training" ? `Training board closed and saved by ${user.name}` : `Command board closed (incident terminated) by ${user.name}`) : "Command board reopened", user.id, user.name]);
        const row = (await c.query(`UPDATE command_boards SET status = $2, closed_at = ${closing ? "now()" : "NULL"}, version = version + 1
          ${closing ? ", completed_by = $3, completed_by_name = $4" : ""} WHERE id = $1 RETURNING *`, closing ? [id, "closed", user.id, user.name] : [id, "open"])).rows[0];
        if (closing) {
          // The record: a frozen after-action report, and the working fire recording for the same incident picks it up
          const events = (await c.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [id])).rows;
          await c.query("UPDATE command_boards SET report_html = $2, report_at = now() WHERE id = $1", [id, reportHtml({ ...row, report_at: new Date() }, events)]);
          if (row.incident_number) await c.query("UPDATE fire_recordings SET command_board_id = $1 WHERE command_board_id IS NULL AND incident_number = $2", [id, row.incident_number]);
        }
        return row;
      }
      if (cur.status === "closed") throw err(400, "This board is closed. Reopen it to make changes.");
      const st = { ...blankState(), ...cur.state };
      const [text, critical] = apply(st, body, user.name);
      if (text) await c.query("INSERT INTO command_events (board_id, kind, text, critical, by_id, by_name) VALUES ($1, $2, $3, $4, $5, $6)", [id, body.type, text, !!critical, user.id, user.name]);
      return (await c.query("UPDATE command_boards SET state = $2, version = version + 1 WHERE id = $1 RETURNING *", [id, JSON.stringify(st)])).rows[0];
    });
    if (body.type === "close") await audit(user, "Closed command board", out.incident_number || out.incident_id);
    const events = (await pool.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [id])).rows;
    return send(res, 200, boardJson(out, events, r, user));
  }
  throw err(404, "Not found");
}
