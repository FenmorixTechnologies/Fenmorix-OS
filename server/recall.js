// Emergency recall (Policy 1010 Emergency Recall). Aladtec stays the system of record: members sign up for the recall
// shifts there and the Assistant Chief approves and assigns them there (policy 1010.3.3 / 1010.4). Nexus runs beside it:
// sends the recall notice (important message + push), takes each member's response (coming with ETA, or can't report
// safely because of an impairment, 1010.3.4; members may not refuse), mirrors who Aladtec shows on the recall days
// (read-only), keeps the unit staffing board with seat qualification flags, roll call on arrival (step 16), units placed in
// service (step 17), the policy checklist and the after-action timeline.
//
//   GET  /api/recall                         active recalls I'm on or can see, recent closed ones, whether I can start one
//   GET  /api/recall/todo                    Your Day: open recalls waiting for my response
//   POST /api/recall                         {kind, title, instructions, reportTo, startDate, endDate, groups, users, imtIncidentId}
//   GET  /api/recall/:id                     the board (operators/viewers) or my own row (members)
//   GET  /api/recall/:id/aladtec?fresh=1      the recall days' Aladtec schedule matched to the members
//   POST /api/recall/:id/respond             {response: coming|impaired, eta, note}          the member
//   POST /api/recall/:id/members/:mid         {response?, eta?, note?, checkIn?, release?}    operators (phoned-in answers, roll call)
//   POST /api/recall/:id/add                  {users, groups}                                operators: recall more people
//   POST /api/recall/:id/units                {units: [{id?, unit, kind, location, seats, notes, specialOps}]}  operators
//   POST /api/recall/:id/units/:uid/service   {inService}                                    operators
//   POST /api/recall/:id/checklist            {key, done}                                    operators
//   POST /api/recall/:id/note                 {text}                                         operators
//   POST /api/recall/:id/close                {note}                                         starters
//   GET/POST /api/recall/settings             {starters, portalUrl, specialOps}              (recall manage)
//
// Who: starting and closing = master, recall manage, or a job title matching settings.starters (Assistant Chief and above,
// per Michael). Operating the board = starters + recall edit (e.g. Communications). Watching = recall view. Members see
// their own row and the instructions.
import { risky } from "./saferegex.js";
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess, groupMembers } from "./access.js";
import { brand } from "./brand.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const normName = s => { let t = String(s || "").trim(); const m = /^([^,]+),\s*(.+)$/.exec(t); if (m) t = `${m[2]} ${m[1]}`;
  return t.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim(); };

export const KINDS = { hurricane: "Hurricane / tropical storm", emac: "EMAC request (La. R.S. 29:733)", imac: "Intrastate Mutual Aid Compact request (La. R.S. 29:739)",
  major: "One major incident", multiple: "Two or more incidents with high demand", peak: "Numerous incidents: peak demand on the system", other: "Designated by the Fire Chief" };
export const CHECKLIST = [
  { key: "comms", label: "Communications notified; Blackboard phone message sent (1010.3.2)" },
  { key: "aladtecMessage", label: "Aladtec required message created with the recall instructions (1010.4 steps 1–5)" },
  { key: "aladtecAlert", label: "Recall alert sent from the Aladtec Hourly Editor to the recalled groups (steps 6–11)" },
  { key: "approvals", label: "Sign-ups approved and dragged to assignments in Aladtec (steps 12–15)" },
  { key: "rollcall", label: "Roll call on arrival through the IMT (step 16)" },
  { key: "inService", label: "Each staffed unit placed in service with Communications (step 17)" },
];
const DEFAULTS = { starters: "assistant chief|asst\\.? chief|deputy chief|fire chief|^chief$", portalUrl: "https://secure16.aladtec.com/stgeorgefire/index.php",
  officerTitles: "captain|lieutenant|\\blt\\b|capt\\b|chief", driverTitles: "operator|engineer|driver|d/o", specialOps: [] };
async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'recall'")).rows[0]?.value;
  const d = typeof v === "string" ? JSON.parse(v) : v || {};
  return { ...DEFAULTS, ...d, specialOps: Array.isArray(d.specialOps) ? d.specialOps : [] };
}
const re = (pat, s) => { try { return !!pat && new RegExp(pat, "i").test(String(s || "")); } catch { return false; } };

async function me(user) {
  return (await pool.query("SELECT id, full_name AS name, job_title AS title FROM users WHERE id = $1", [user.id])).rows[0] || { id: user.id, name: user.name, title: "" };
}
async function rights(user) {
  const st = await settings();
  const u = await me(user);
  const manage = user.role === "master" || await hasAccess(pool, user, "recall", "manage");
  const starter = manage || re(st.starters, u.title);
  const operate = starter || await hasAccess(pool, user, "recall", "edit");
  const view = operate || await hasAccess(pool, user, "recall", "view");
  return { manage, starter, operate, view, st };
}
async function log(c, eventId, who, what) { await c.query("INSERT INTO recall_log (event_id, who, what) VALUES ($1, $2, $3)", [eventId, who, String(what).slice(0, 1000)]); }
async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query("INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Emergency recall', $4, $5)",
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 1000)]);
}
async function notify(user, ids, subject, body) {
  const to = [...new Set(ids.filter(id => isUuid(id) && id !== user.id))];
  if (!to.length) return;
  try { const { send } = await import("./messages.js"); await send(user, { users: to, subject, body, important: true, privateReplies: true }); }
  catch (e) { console.error("recall notify:", e.message); }
}
const noticeText = (ev, st) => [
  `EMERGENCY RECALL: ${ev.title}`, "",
  "An emergency recall has been initiated. Log in to Aladtec for availability and assignment:", st.portalUrl, "",
  "In Aladtec: acknowledge the required message, then follow the link in the recall email (or Dashboard › Find Open Shifts), select the recall date and Sign-Up.",
  "Report only after your sign-up is approved and the assignment shows in Upcoming Shifts on your Dashboard. Report directly to your assignment; roll call is taken on arrival.",
  ev.report_to ? `\nReport to: ${ev.report_to}` : "",
  ev.instructions ? `\n${ev.instructions}` : "", "",
  "In " + brand().productName + ", open Emergency Recall and tell the Assistant Chief you're coming (with your ETA). Members may not refuse a recall. If you're under the influence of any impairment, such as medications or alcohol, say so there (or call the Assistant Chief on duty) and do not report (Policy 1010.3.4).",
].filter(x => x !== null).join("\n");

const evJson = e => ({ id: e.id, kind: e.kind, kindLabel: KINDS[e.kind] || e.kind, title: e.title, instructions: e.instructions, reportTo: e.report_to,
  startDate: e.start_date, endDate: e.end_date, status: e.status, imtIncidentId: e.imt_incident_id, checklist: e.checklist || {},
  startedBy: e.started_name, startedById: e.started_by, startedAt: e.started_at, closedBy: e.closed_by_name, closedAt: e.closed_at, closeNote: e.close_note });
const memJson = m => ({ id: m.id, userId: m.user_id, name: m.name, title: m.title || "", station: m.station || "", shift: (/^fire:([ABC])$/.exec(m.work_pattern || "") || [])[1] || "",
  phone: m.phone || "", notifiedAt: m.notified_at, response: m.response, eta: m.eta, note: m.note, respondedAt: m.responded_at, respondedVia: m.responded_via,
  checkedInAt: m.checked_in_at, checkedInBy: m.checked_in_by, releasedAt: m.released_at });
async function loadEvent(id) {
  return (await pool.query("SELECT *, start_date::text AS start_date, end_date::text AS end_date FROM recall_events WHERE id = $1", [id])).rows[0] || null;
}
async function members(eventId) {
  return (await pool.query(`SELECT m.*, u.job_title AS title, u.station, u.work_pattern, u.phone FROM recall_members m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.event_id = $1 ORDER BY m.name`, [eventId])).rows;
}
async function resolveAudience(b) {
  const ids = new Set((Array.isArray(b.users) ? b.users : []).filter(isUuid));
  const labels = [];
  for (const g of (Array.isArray(b.groups) ? b.groups : []).filter(isUuid).slice(0, 30)) {
    const gm = await groupMembers(pool, g);
    if (gm) { gm.ids.forEach(i => ids.add(i)); labels.push(gm.name); }
  }
  const people = ids.size ? (await pool.query("SELECT id, full_name AS name FROM users WHERE active AND id = ANY(string_to_array($1, ',')::uuid[])", [[...ids].join(",")])).rows : [];
  return { people, labels };
}
// Seat qualifications: officer seats need an officer title; driver seats a driver title or a passed pumper/aerial evaluation
async function qualifications(userIds, st) {
  if (!userIds.length) return {};
  const ppl = (await pool.query("SELECT id, job_title AS title FROM users WHERE id = ANY(string_to_array($1, ',')::uuid[])", [userIds.join(",")])).rows;
  const out = {};
  for (const p of ppl) out[p.id] = { officer: re(st.officerTitles, p.title), driver: re(st.driverTitles, p.title), signoffs: [] };
  try {
    const rows = (await pool.query(`SELECT r.user_id, p.key, p.name, r.scores, r.modules, p.data->'scale' AS scale FROM eval_results r JOIN eval_programs p ON p.id = r.program_id
      WHERE r.status = 'final' AND r.kind <> 'practice' AND p.key IN ('op-pumper', 'op-aerial') AND r.user_id = ANY(string_to_array($1, ',')::uuid[])`, [userIds.join(",")])).rows;
    for (const r of rows) {
      const max = Number(r.scale?.max ?? 1);
      const passed = (r.modules || []).length > 0 && (r.modules || []).every(k => Array.isArray(r.scores?.[k]) && r.scores[k].length && r.scores[k].every(v => Number(v) >= max));
      if (passed && out[r.user_id]) { out[r.user_id].driver = true; out[r.user_id].signoffs.push(r.key === "op-aerial" ? "Aerial" : "Pumper"); }
    }
  } catch { /* evaluations not set up */ }
  return out;
}
const SEATS = { engine: ["officer", "driver", "ff", "ff"], ladder: ["officer", "driver", "ff"], squad: ["officer", "driver", "ff"], tanker: ["driver"], medic: ["driver", "ff"],
  command: ["officer"], unit: ["officer", "driver", "ff"] };
async function unitKindOf(unit) { try { const { unitKind } = await import("./evals.js"); return unitKind(unit); } catch { return "unit"; } }
const unitJson = u => ({ id: u.id, unit: u.unit, kind: u.kind, location: u.location, seats: u.seats || [], notes: u.notes, specialOps: u.special_ops, sort: u.sort,
  inServiceAt: u.in_service_at, inServiceBy: u.in_service_by });

export async function handleRecall(req, res, parts, user, send, jsonBody, url) {
  const a = parts[2], b = parts[3], c3 = parts[4];
  const r = await rights(user);
  const st = r.st;

  if (req.method === "GET" && a === "todo") {
    const rows = (await pool.query(`SELECT e.id, e.title FROM recall_members m JOIN recall_events e ON e.id = m.event_id
      WHERE m.user_id = $1 AND e.status = 'open' AND m.response = '' AND m.released_at IS NULL ORDER BY e.started_at DESC`, [user.id])).rows;
    const open = r.operate ? Number((await pool.query("SELECT count(*) FROM recall_events WHERE status = 'open'")).rows[0].count) : 0;
    return send(res, 200, { waiting: rows, openBoards: open });
  }

  if (a === "settings") {
    if (req.method === "GET") { if (!r.view) throw err(403, "Not available."); return send(res, 200, { settings: st, canEdit: r.manage }); }
    if (!r.manage) throw err(403, "Only Emergency recall managers can change these settings.");
    const x = await jsonBody(req);
    const next = { ...st };
    for (const k of ["starters", "officerTitles", "driverTitles"]) if (x[k] !== undefined) {
      const v = clean(x[k], 300); try { new RegExp(v, "i"); } catch { throw err(400, `That ${k} pattern isn't valid.`); } if (risky(v)) throw err(400, `That ${k} pattern is too complicated. Use plain words separated by |.`); next[k] = v || DEFAULTS[k];
    }
    if (x.portalUrl !== undefined) { const v = clean(x.portalUrl, 300); if (v && !/^https:\/\//.test(v)) throw err(400, "The Aladtec link must start with https://"); next.portalUrl = v || DEFAULTS.portalUrl; }
    if (Array.isArray(x.specialOps)) next.specialOps = x.specialOps.slice(0, 60).map(s => ({ unit: clean(s.unit, 40), location: clean(s.location, 80), note: clean(s.note, 300),
      people: (Array.isArray(s.people) ? s.people : []).filter(isUuid).slice(0, 12) })).filter(s => s.unit);
    await pool.query("INSERT INTO settings (key, value) VALUES ('recall', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(next)]);
    await audit(pool, user, "Changed recall settings", `${next.specialOps.length} Special Operations assignments`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && !a) {
    const rows = (await pool.query(`SELECT e.*, e.start_date::text AS start_date, e.end_date::text AS end_date,
        (SELECT count(*)::int FROM recall_members m WHERE m.event_id = e.id) AS n,
        (SELECT count(*)::int FROM recall_members m WHERE m.event_id = e.id AND m.response = 'coming') AS coming,
        (SELECT count(*)::int FROM recall_members m WHERE m.event_id = e.id AND m.response = 'impaired') AS impaired,
        (SELECT count(*)::int FROM recall_members m WHERE m.event_id = e.id AND m.checked_in_at IS NOT NULL) AS arrived,
        (SELECT row_to_json(x) FROM (SELECT m.response, m.eta, m.note, m.checked_in_at, m.released_at FROM recall_members m WHERE m.event_id = e.id AND m.user_id = $1) x) AS mine
      FROM recall_events e WHERE e.status = 'open' OR e.started_at > now() - interval '365 days' ORDER BY e.status = 'open' DESC, e.started_at DESC LIMIT 100`, [user.id])).rows;
    const list = rows.filter(e => r.view || e.mine).map(e => ({ ...evJson(e), counts: { total: e.n, coming: e.coming, impaired: e.impaired, arrived: e.arrived }, mine: e.mine }));
    let groups = [], incidents = [];
    if (r.starter) {
      const { allGroupMembers } = await import("./access.js");
      groups = (await allGroupMembers(pool)).map(g => ({ id: g.id, name: g.name, count: g.ids.length }));
      incidents = (await pool.query("SELECT id, name FROM imt_incidents WHERE status <> 'closed' ORDER BY created_at DESC LIMIT 30").catch(() => ({ rows: [] }))).rows;
    }
    return send(res, 200, { recalls: list, canStart: r.starter, canOperate: r.operate, canManage: r.manage, kinds: KINDS, checklist: CHECKLIST, groups, incidents, portalUrl: st.portalUrl });
  }

  if (req.method === "POST" && !a) {
    if (!r.starter) throw err(403, "Starting an emergency recall is for the Assistant Chief on duty and above.");
    const x = await jsonBody(req);
    const title = clean(x.title, 160);
    if (!title) throw err(400, "Give the recall a title (e.g. Hurricane Example – pre-landfall recall).");
    const start = DAY.test(x.startDate || "") ? x.startDate : null, end = DAY.test(x.endDate || "") ? x.endDate : start;
    if (!start) throw err(400, "Choose the recall date.");
    if (end < start) throw err(400, "The last day is before the first.");
    if ((Date.parse(end) - Date.parse(start)) / 86400000 > 13) throw err(400, "A recall covers at most 14 days; start another one after that.");
    const aud = await resolveAudience(x);
    if (!aud.people.length) throw err(400, "Choose who is recalled (groups or people).");
    const id = crypto.randomUUID();
    const kind = KINDS[x.kind] ? x.kind : "hurricane";
    const imt = isUuid(x.imtIncidentId) ? x.imtIncidentId : null;
    const ev = { id, kind, title, instructions: clean(x.instructions, 4000), report_to: clean(x.reportTo, 300), start_date: start, end_date: end };
    await tx(async c => {
      await c.query(`INSERT INTO recall_events (id, kind, title, instructions, report_to, start_date, end_date, imt_incident_id, started_by, started_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, kind, title, ev.instructions, ev.report_to, start, end, imt, user.id, user.name]);
      for (const p of aud.people) await c.query(`INSERT INTO recall_members (id, event_id, user_id, name, notified_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), id, p.id, p.name]);
      await log(c, id, user.name, `Recall started: ${title} (${KINDS[kind]}), ${aud.people.length} people${aud.labels.length ? ` from ${aud.labels.join(", ")}` : ""}. Notice sent in ${brand().productName}.`);
      await audit(c, user, "Started an emergency recall", `${title}: ${aud.people.length} people, ${start}${end !== start ? ` to ${end}` : ""}`);
    });
    await notify(user, aud.people.map(p => p.id), `EMERGENCY RECALL: ${title}`, noticeText(ev, st));
    return send(res, 200, { id, recalled: aud.people.length });
  }

  if (!isUuid(a)) throw err(404, "Not found");
  const ev = await loadEvent(a);
  if (!ev) throw err(404, "That recall wasn't found.");
  const mine = (await pool.query("SELECT * FROM recall_members WHERE event_id = $1 AND user_id = $2", [ev.id, user.id])).rows[0] || null;
  if (!r.view && !mine) throw err(404, "That recall wasn't found.");
  const open = ev.status === "open";
  const needOperate = () => { if (!r.operate) throw err(403, "Only the recall's operators (Assistant Chief and above, or Emergency recall edit access) can do that."); if (!open) throw err(409, "This recall is closed."); };

  if (req.method === "GET" && !b) {
    if (!r.view) return send(res, 200, { recall: evJson(ev), mine: memJson(mine), board: false, portalUrl: st.portalUrl });
    const ms = await members(ev.id);
    const units = (await pool.query("SELECT * FROM recall_units WHERE event_id = $1 ORDER BY sort, unit", [ev.id])).rows;
    const logRows = (await pool.query("SELECT at, who, what FROM recall_log WHERE event_id = $1 ORDER BY at, id", [ev.id])).rows;
    const quals = await qualifications(ms.map(m => m.user_id).filter(Boolean), st);
    let imt = null;
    if (ev.imt_incident_id) imt = (await pool.query("SELECT id, name FROM imt_incidents WHERE id = $1", [ev.imt_incident_id]).catch(() => ({ rows: [] }))).rows[0] || null;
    let apparatus = [];
    try { apparatus = (await pool.query("SELECT unit, kind, station, status FROM apparatus WHERE active ORDER BY sort, unit")).rows; } catch { /* no apparatus list */ }
    return send(res, 200, { recall: evJson(ev), mine: mine ? memJson(mine) : null, board: true, canOperate: r.operate && open, canClose: r.starter && open,
      members: ms.map(memJson), units: units.map(unitJson), log: logRows, quals, imt, apparatus, specialOps: st.specialOps, checklist: CHECKLIST, portalUrl: st.portalUrl });
  }

  if (req.method === "GET" && b === "aladtec") {
    if (!r.view) throw err(403, "Not available.");
    const { scheduleForDay } = await import("./aladtec.js");
    const days = [];
    for (let d = new Date(`${ev.start_date}T12:00:00Z`); d <= new Date(`${ev.end_date}T12:00:00Z`) && days.length < 4; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
    const fresh = url.searchParams.get("fresh") === "1";
    const out = [];
    for (const d of days) out.push(await scheduleForDay(d, { fresh }));
    const ms = await members(ev.id);
    const byName = new Map(ms.map(m => [normName(m.name), m.id]));
    const matches = {};
    for (const day of out) for (const rec of day.records) {
      const mid = byName.get(normName(rec.name));
      if (mid) (matches[mid] = matches[mid] || []).push({ day: day.day, schedule: rec.scheduleName, position: rec.positionLabel, start: rec.start, stop: rec.stop });
    }
    return send(res, 200, { configured: out.some(d => d.configured), days: out.map(d => ({ day: d.day, count: d.records.length, error: d.error, checkedAt: d.checkedAt })), matches,
      notInNexus: out.flatMap(d => d.records.filter(rec => !byName.has(normName(rec.name))).map(rec => ({ day: d.day, name: rec.name, schedule: rec.scheduleName, position: rec.positionLabel }))).slice(0, 200) });
  }

  if (req.method !== "POST") throw err(404, "Not found");
  const x = await jsonBody(req);

  if (b === "respond") {
    if (!mine) throw err(403, "You're not on this recall.");
    if (!open) throw err(409, "This recall is closed.");
    if (!["coming", "impaired"].includes(x.response)) throw err(400, "Members may not refuse a recall: choose Coming, or Can't report safely (impairment).");
    const eta = clean(x.eta, 40), note = clean(x.note, 500);
    await tx(async c => {
      await c.query("UPDATE recall_members SET response = $2, eta = $3, note = $4, responded_at = now(), responded_via = 'self' WHERE id = $1", [mine.id, x.response, eta, note]);
      await log(c, ev.id, user.name, x.response === "coming" ? `Coming${eta ? `, ETA ${eta}` : ""}${note ? ` (${note})` : ""}` : `Can't report safely: impairment${note ? ` (${note})` : ""}`);
    });
    if (x.response === "impaired") await notify(user, [ev.started_by], `Recall: ${user.name} can't report safely`,
      `${user.name} answered the recall "${ev.title}": under an impairment and should not report for duty (Policy 1010.3.4).${note ? `\n\n${note}` : ""}`);
    return send(res, 200, { ok: true });
  }

  if (b === "members" && isUuid(c3)) {
    needOperate();
    const m = (await pool.query("SELECT * FROM recall_members WHERE id = $1 AND event_id = $2", [c3, ev.id])).rows[0];
    if (!m) throw err(404, "That person isn't on this recall.");
    const sets = [], vals = [], what = [];
    const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 1}`); };
    if (x.response !== undefined) {
      if (!["", "coming", "impaired"].includes(x.response)) throw err(400, "Response must be Coming or Can't report safely.");
      add("response", x.response); add("responded_at", x.response ? new Date() : null); add("responded_via", x.response ? user.name : "");
      what.push(x.response === "coming" ? "Coming (recorded by phone)" : x.response === "impaired" ? "Can't report safely: impairment (recorded by phone)" : "response cleared");
    }
    if (x.eta !== undefined) { add("eta", clean(x.eta, 40)); if (x.eta) what.push(`ETA ${clean(x.eta, 40)}`); }
    if (x.note !== undefined) add("note", clean(x.note, 500));
    if (x.checkIn === true) { add("checked_in_at", new Date()); add("checked_in_by", user.name); what.push("arrived (roll call)"); }
    if (x.checkIn === false) { add("checked_in_at", null); add("checked_in_by", ""); what.push("roll call undone"); }
    if (x.release === true) { add("released_at", new Date()); what.push("released"); }
    if (x.release === false) { add("released_at", null); what.push("release undone"); }
    if (!sets.length) throw err(400, "Nothing to change.");
    await tx(async c => {
      await c.query(`UPDATE recall_members SET ${sets.join(", ")} WHERE id = $1`, [m.id, ...vals]);
      if (what.length) await log(c, ev.id, user.name, `${m.name}: ${what.join(", ")}`);
    });
    return send(res, 200, { ok: true });
  }

  if (b === "add") {
    needOperate();
    const aud = await resolveAudience(x);
    const have = new Set((await members(ev.id)).map(m => m.user_id));
    const fresh = aud.people.filter(p => !have.has(p.id));
    if (!fresh.length) throw err(400, "Everyone chosen is already on this recall.");
    await tx(async c => {
      for (const p of fresh) await c.query(`INSERT INTO recall_members (id, event_id, user_id, name, notified_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), ev.id, p.id, p.name]);
      await log(c, ev.id, user.name, `Recalled ${fresh.length} more: ${fresh.map(p => p.name).join(", ").slice(0, 600)}`);
    });
    await notify(user, fresh.map(p => p.id), `EMERGENCY RECALL: ${ev.title}`, noticeText(ev, st));
    return send(res, 200, { added: fresh.length });
  }

  if (b === "units" && !c3) {
    needOperate();
    if (!Array.isArray(x.units)) throw err(400, "Send the units.");
    const ms = await members(ev.id);
    const onRecall = new Set(ms.map(m => m.user_id).filter(Boolean));
    const seen = new Set();
    const list = [];
    for (const [i, u] of x.units.slice(0, 80).entries()) {
      const unit = clean(u.unit, 40).toUpperCase();
      if (!unit) continue;
      if (seen.has(unit)) throw err(400, `${unit} is on the board twice.`);
      seen.add(unit);
      const kind = clean(u.kind, 20) || await unitKindOf(unit);
      const seats = (Array.isArray(u.seats) && u.seats.length ? u.seats : (SEATS[kind] || SEATS.unit).map(role => ({ role, userId: null }))).slice(0, 8)
        .map(s => ({ role: ["officer", "driver", "ff"].includes(s.role) ? s.role : "ff", userId: isUuid(s.userId) && onRecall.has(s.userId) ? s.userId : null }));
      list.push({ id: isUuid(u.id) ? u.id : crypto.randomUUID(), unit, kind, location: clean(u.location, 80), seats, notes: clean(u.notes, 500), specialOps: u.specialOps === true, sort: i });
    }
    const assigned = list.flatMap(u => u.seats.map(s => s.userId).filter(Boolean));
    const dup = assigned.find((v, i) => assigned.indexOf(v) !== i);
    if (dup) throw err(400, `${ms.find(m => m.user_id === dup)?.name || "Someone"} is in two seats.`);
    const old = new Map((await pool.query("SELECT * FROM recall_units WHERE event_id = $1", [ev.id])).rows.map(u => [u.id, u]));
    await tx(async c => {
      await c.query("DELETE FROM recall_units WHERE event_id = $1 AND NOT (id = ANY(string_to_array($2, ',')::uuid[]))", [ev.id, list.map(u => u.id).join(",") || crypto.randomUUID()]);
      for (const u of list) {
        const o = old.get(u.id);
        await c.query(`INSERT INTO recall_units (id, event_id, unit, kind, location, seats, notes, special_ops, sort, in_service_at, in_service_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (id) DO UPDATE SET unit = $3, kind = $4, location = $5, seats = $6, notes = $7, special_ops = $8, sort = $9`,
          [u.id, ev.id, u.unit, u.kind, u.location, JSON.stringify(u.seats), u.notes, u.specialOps, u.sort, o?.in_service_at || null, o?.in_service_by || ""]);
      }
      const added = list.filter(u => !old.has(u.id)).map(u => u.unit), removed = [...old.values()].filter(o => !list.some(u => u.id === o.id)).map(o => o.unit);
      await log(c, ev.id, user.name, `Staffing board saved${added.length ? `; added ${added.join(", ")}` : ""}${removed.length ? `; removed ${removed.join(", ")}` : ""}`);
    });
    return send(res, 200, { ok: true });
  }

  if (b === "units" && isUuid(c3) && parts[5] === "service") {
    needOperate();
    const u = (await pool.query("SELECT * FROM recall_units WHERE id = $1 AND event_id = $2", [c3, ev.id])).rows[0];
    if (!u) throw err(404, "That unit isn't on the board.");
    await tx(async c => {
      await c.query("UPDATE recall_units SET in_service_at = $2, in_service_by = $3 WHERE id = $1", [u.id, x.inService ? new Date() : null, x.inService ? user.name : ""]);
      await log(c, ev.id, user.name, x.inService ? `${u.unit} placed in service with Communications` : `${u.unit} in-service mark undone`);
    });
    return send(res, 200, { ok: true });
  }

  if (b === "checklist") {
    needOperate();
    const item = CHECKLIST.find(k => k.key === x.key);
    if (!item) throw err(400, "Unknown checklist item.");
    const cl = { ...(ev.checklist || {}), [item.key]: x.done ? { done: true, by: user.name, at: new Date().toISOString() } : { done: false } };
    await tx(async c => {
      await c.query("UPDATE recall_events SET checklist = $2 WHERE id = $1", [ev.id, JSON.stringify(cl)]);
      await log(c, ev.id, user.name, `${x.done ? "Done" : "Not done"}: ${item.label}`);
    });
    return send(res, 200, { ok: true });
  }

  if (b === "note") {
    needOperate();
    const text = clean(x.text, 1000);
    if (!text) throw err(400, "Write the note.");
    await log(pool, ev.id, user.name, text);
    return send(res, 200, { ok: true });
  }

  if (b === "close") {
    if (!r.starter) throw err(403, "Closing a recall is for the Assistant Chief on duty and above.");
    if (!open) throw err(409, "Already closed.");
    await tx(async c => {
      await c.query("UPDATE recall_events SET status = 'closed', closed_by_name = $2, closed_at = now(), close_note = $3 WHERE id = $1", [ev.id, user.name, clean(x.note, 1000)]);
      await log(c, ev.id, user.name, `Recall closed${x.note ? `: ${clean(x.note, 300)}` : ""}`);
      await audit(c, user, "Closed an emergency recall", ev.title);
    });
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}
