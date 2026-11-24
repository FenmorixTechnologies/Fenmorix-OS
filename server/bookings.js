// Classroom / facility bookings and the apparatus list.
//
//   /api/apparatus           GET (everyone) · POST {id?, unit, kind, station, status, notes, sort} · POST :id/remove
//   /api/bookings            GET ?from&to[&all]   bookings with their rotations (everyone)
//                            GET rooms            bookable rooms
//                            GET check ?rooms&from&to&start&end[&except]   what's already booked
//                            POST                 book directly {rooms, from, to, start, end, title, division, contactId, attendees, notes, needsRotation}
//                            POST requests/:id    edit {title, start, end, notes, needsRotation}
//                            POST requests/:id/approve | cancel {reason}
//                            POST requests/:id/rotations {rotations: [{day?, start, end, apparatus: [ids], notes}]}
//                            POST rooms {rooms}   (manage)
//
// A form whose settings have `booking` (the Facility & Resource Request) books its rooms when it's
// submitted: the rooms are held right away (status "requested") so nobody else can double-book them,
// approved when the form is marked Approved, released when it's marked Not available.
// Access section "bookings": edit = book, approve, cancel, assign apparatus; manage = rooms list.
// The apparatus list: masters, bookings manage or training manage.
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayStr = v => v instanceof Date ? iso(v) : String(v).slice(0, 10);
const hm = v => String(v || "").slice(0, 5);
const prettyDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const hhmm = t => hm(t).replace(":", "");

export const KINDS = ["Engine", "Ladder", "Quint", "Rescue", "Squad", "Medic", "Tanker", "Brush", "Battalion", "Command", "Hazmat", "Boat", "Utility", "Reserve", "Other"];
export const DEFAULT_ROOMS = ["Classroom A Admin", "Classroom B Admin", "CTC Admin", "Kitchen 1st Floor", "Classroom 1 Training Center", "Classroom 2 Training Center",
  "Training Center Classroom", "Admin Board Room", "Admin Conference Room 1", "Admin Conference Room 2", "Admin Kitchen 2nd Floor", "Outdoor Classroom",
  "Pavilion", "Burn Building", "Drill Field", "Sea Cans", "Maintenance Building", "Pump Pit", "Facility Grounds"];

export async function rooms(c = pool) {
  const r = (await c.query("SELECT value FROM settings WHERE key = 'booking_rooms'")).rows[0];
  return Array.isArray(r?.value) && r.value.length ? r.value : DEFAULT_ROOMS;
}
function daysBetween(from, to) {
  if (!DAY.test(from) || !DAY.test(to)) throw err(400, "Choose the start and end dates.");
  const out = [];
  for (let d = new Date(`${from}T00:00:00Z`); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(iso(d));
    if (out.length > 62) throw err(400, "A booking can cover up to 62 days. Split longer ones up.");
  }
  if (!out.length) throw err(400, "The end date is before the start date.");
  return out;
}
function times(start, end) {
  if (!TIME.test(start || "") || !TIME.test(end || "")) throw err(400, "Choose start and end times.");
  if (end <= start) throw err(400, "The end time has to be after the start time (bookings can't run past midnight; book the next day separately).");
}

// Bookings that overlap these rooms/days/times (not cancelled)
export async function conflicts(c, roomList, days, start, end, exceptRequest = null) {
  if (!roomList.length || !days.length) return [];
  return (await c.query(
    `SELECT b.*, to_char(b.day, 'YYYY-MM-DD') AS d FROM bookings b
      WHERE b.status <> 'cancelled' AND b.room = ANY(string_to_array($1, '|')) AND b.day = ANY(string_to_array($2, ',')::date[])
        AND b.start_time < $4::time AND b.end_time > $3::time AND ($5::uuid IS NULL OR b.request_id <> $5)
      ORDER BY b.day, b.start_time`, [roomList.join("|"), days.join(","), start, end, exceptRequest])).rows;
}
const conflictText = list => list.slice(0, 4).map(b => `${b.room} on ${prettyDay(b.d)} ${hhmm(b.start_time)}-${hhmm(b.end_time)} ("${b.title || "booked"}"${b.contact_name ? `, ${b.contact_name}` : ""})`).join("; ")
  + (list.length > 4 ? ` and ${list.length - 4} more` : "");

async function createBookings(c, { roomList, days, start, end, title, division, contactId, contactName, attendees, notes, needsRotation, submissionId, user, status = "requested" }) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext('sgfd-bookings'))");
  const clash = await conflicts(c, roomList, days, start, end);
  if (clash.length) throw err(409, `Already booked: ${conflictText(clash)}.`);
  const requestId = crypto.randomUUID();
  for (const room of roomList) for (const day of days) {
    await c.query(
      `INSERT INTO bookings (id, request_id, submission_id, room, day, start_time, end_time, title, division, contact_id, contact_name, attendees, status, needs_rotation, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [crypto.randomUUID(), requestId, submissionId || null, room, day, start, end, clean(title, 200), clean(division, 120), contactId || null,
        clean(contactName, 120), Number.isFinite(attendees) ? attendees : null, status, !!needsRotation, clean(notes, 2000), user?.id || null]);
  }
  return requestId;
}

// ---- From the Facility & Resource Request form ---------------------------------------------------
// settings.booking = { rooms, alt, startDate, endDate, startTime, endTime, title, attendees, division, rotation,
//                      approveStage, releaseStage }  (each a field key, except the stage labels)
export async function bookFromSubmission(c, def, data, submissionId, user) {
  const m = def.settings?.booking;
  if (!m) return null;
  const all = await rooms(c);
  const picked = (Array.isArray(data[m.rooms]) ? data[m.rooms] : [data[m.rooms]]).filter(r => all.includes(r));
  if (!picked.length) return null;              // e.g. only equipment or props: nothing to hold
  const start = hm(data[m.startTime]), end = hm(data[m.endTime]);
  times(start, end);
  const days = daysBetween(String(data[m.startDate] || ""), String(data[m.endDate] || ""));
  await c.query("SELECT pg_advisory_xact_lock(hashtext('sgfd-bookings'))");
  const clash = await conflicts(c, picked, days, start, end);
  if (clash.length) {
    let tip = "";
    const alt = data[m.alt];
    if (alt && alt !== "None" && all.includes(alt) && !picked.includes(alt)) {
      tip = (await conflicts(c, [alt], days, start, end)).length ? ` Your second choice (${alt}) is booked then too.`
        : ` Your second choice, ${alt}, is free then: pick it instead, or choose another time.`;
    }
    throw err(409, `That room is already booked: ${conflictText(clash)}.${tip || " Choose another room or time."}`);
  }
  const purpose = clean(data[m.title], 400);
  return createBookings(c, {
    roomList: picked, days, start, end, title: purpose.split("\n")[0].slice(0, 120) || def.title,
    division: data[m.division] || user.division || "", contactId: user.id, contactName: user.name,
    attendees: Number(data[m.attendees]), notes: purpose, needsRotation: m.rotation ? data[m.rotation] === "Yes" : false, submissionId, user,
  });
}
export async function bookingStage(c, def, submissionId, stage) {
  const m = def?.settings?.booking;
  if (!m) return;
  if (stage && stage === m.approveStage) await c.query("UPDATE bookings SET status = 'approved' WHERE submission_id = $1 AND status <> 'cancelled'", [submissionId]);
  else if (stage && stage === m.releaseStage) await c.query("UPDATE bookings SET status = 'cancelled', cancelled_reason = $2 WHERE submission_id = $1", [submissionId, stage]);
  else if (!stage) await c.query("UPDATE bookings SET status = 'requested' WHERE submission_id = $1 AND status = 'approved'", [submissionId]);
}

// ---- Reading ----------------------------------------------------------------------------------
async function apparatusList(all = false) {
  return (await pool.query(`SELECT * FROM apparatus ${all ? "" : "WHERE active"} ORDER BY sort, kind, unit`)).rows
    .map(a => ({ id: a.id, unit: a.unit, kind: a.kind, station: a.station, status: a.status, notes: a.notes, sort: a.sort, active: a.active }));
}
async function listBookings(from, to, includeCancelled) {
  const rows = (await pool.query(
    `SELECT b.*, to_char(b.day, 'YYYY-MM-DD') AS d FROM bookings b
      WHERE b.day BETWEEN $1 AND $2 ${includeCancelled ? "" : "AND b.status <> 'cancelled'"} ORDER BY b.day, b.start_time, b.room`, [from, to])).rows;
  const reqIds = [...new Set(rows.map(r => r.request_id))];
  const rot = reqIds.length ? (await pool.query(
    `SELECT *, to_char(day, 'YYYY-MM-DD') AS d FROM booking_rotations WHERE request_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY seq`, [reqIds.join(",")])).rows : [];
  const app = new Map((await apparatusList(true)).map(a => [a.id, a]));
  const range = new Map();
  for (const id of reqIds) {
    const all = (await pool.query("SELECT min(day)::text AS a, max(day)::text AS b, array_agg(DISTINCT room) AS rooms FROM bookings WHERE request_id = $1", [id])).rows[0];
    range.set(id, all);
  }
  return rows.map(b => ({
    id: b.id, requestId: b.request_id, submissionId: b.submission_id, room: b.room, day: b.d, start: hm(b.start_time), end: hm(b.end_time),
    title: b.title, division: b.division, contactId: b.contact_id, contact: b.contact_name, attendees: b.attendees, status: b.status,
    needsRotation: b.needs_rotation, notes: b.notes, cancelledReason: b.cancelled_reason,
    from: range.get(b.request_id)?.a, to: range.get(b.request_id)?.b,
    rotations: rot.filter(r => r.request_id === b.request_id && (!r.d || r.d === b.d)).map(r => ({
      id: r.id, seq: r.seq, day: r.d || null, start: hm(r.start_time), end: hm(r.end_time), notes: r.notes,
      apparatus: (r.apparatus || []).map(id => app.get(id)).filter(Boolean).map(a => ({ id: a.id, unit: a.unit, kind: a.kind })),
    })),
  }));
}

// ---- Rotations ----------------------------------------------------------------------------------
async function saveRotations(c, requestId, list, user) {
  const bk = (await c.query("SELECT to_char(day, 'YYYY-MM-DD') AS d, start_time, end_time FROM bookings WHERE request_id = $1 AND status <> 'cancelled'", [requestId])).rows;
  if (!bk.length) throw err(404, "That booking wasn't found (or it was cancelled).");
  const days = [...new Set(bk.map(b => b.d))];
  if (!Array.isArray(list) || list.length > 20) throw err(400, "Up to 20 rotations.");
  const valid = new Set((await c.query("SELECT id FROM apparatus WHERE active")).rows.map(r => r.id));
  const out = list.map((r, i) => {
    times(r.start, r.end);
    if (r.day && !days.includes(r.day)) throw err(400, `Rotation ${i + 1}: that day isn't part of this booking.`);
    const app = [...new Set((r.apparatus || []).filter(id => valid.has(id)))];
    if (!app.length) throw err(400, `Rotation ${i + 1}: choose at least one apparatus.`);
    return { seq: i + 1, day: r.day || null, start: r.start, end: r.end, apparatus: app, notes: clean(r.notes, 300) };
  });
  // Warn (don't block) when a unit is already in another class's rotation at the same time
  const warnings = [];
  for (const r of out) {
    const onDays = r.day ? [r.day] : days;
    const other = (await c.query(
      `SELECT rt.apparatus, b.title, b.room, to_char(b.day, 'YYYY-MM-DD') AS d, rt.start_time, rt.end_time
         FROM booking_rotations rt JOIN bookings b ON b.request_id = rt.request_id AND (rt.day IS NULL OR rt.day = b.day)
        WHERE rt.request_id <> $1 AND b.status <> 'cancelled' AND b.day = ANY(string_to_array($2, ',')::date[])
          AND rt.start_time < $4::time AND rt.end_time > $3::time`, [requestId, onDays.join(","), r.start, r.end])).rows;
    for (const o of other) {
      const both = (o.apparatus || []).filter(id => r.apparatus.includes(id));
      if (both.length) {
        const units = (await c.query("SELECT unit FROM apparatus WHERE id = ANY(string_to_array($1, ',')::uuid[])", [both.join(",")])).rows.map(x => x.unit);
        warnings.push(`Rotation ${r.seq}: ${units.join(", ")} also in "${o.title}" ${prettyDay(o.d)} ${hhmm(o.start_time)}-${hhmm(o.end_time)}.`);
      }
    }
  }
  await c.query("DELETE FROM booking_rotations WHERE request_id = $1", [requestId]);
  for (const r of out) {
    await c.query(`INSERT INTO booking_rotations (id, request_id, seq, day, start_time, end_time, apparatus, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [crypto.randomUUID(), requestId, r.seq, r.day, r.start, r.end, JSON.stringify(r.apparatus), r.notes]);
  }
  await audit(c, user, "Set apparatus rotations", `${(await describe(c, requestId))}: ${out.length} rotation${out.length === 1 ? "" : "s"}`);
  return [...new Set(warnings)];
}

async function describe(c, requestId) {
  const r = (await c.query("SELECT title, min(day)::text AS a, max(day)::text AS b, string_agg(DISTINCT room, ', ') AS rooms FROM bookings WHERE request_id = $1 GROUP BY title", [requestId])).rows[0];
  return r ? `"${r.title}" ${r.rooms}, ${prettyDay(r.a)}${r.b !== r.a ? `-${prettyDay(r.b)}` : ""}` : requestId;
}
async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query("INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Bookings', $4, $5)",
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 1000)]);
}
async function tell(user, contactId, subject, body) {
  if (!contactId || contactId === user.id) return;
  try { const { send } = await import("./messages.js"); await send(user, { users: [contactId], subject, body }); } catch (e) { console.warn(`[Bookings] message: ${e.message}`); }
}

// ---- Routes -------------------------------------------------------------------------------------
export async function canApparatus(user) {
  return user.role === "master" || await hasAccess(pool, user, "bookings", "manage") || await hasAccess(pool, user, "training", "manage");
}

export async function handleApparatus(req, res, parts, user, send, jsonBody) {
  if (req.method === "GET") {
    const all = new URL(req.url, "http://x").searchParams.get("all") === "1";
    return send(res, 200, { apparatus: await apparatusList(all), kinds: KINDS, canEdit: await canApparatus(user) });
  }
  if (!(await canApparatus(user))) throw err(403, "Only master admins, or people who manage Training or Bookings, can change the apparatus list.");
  const b = await jsonBody(req);
  if (isUuid(parts[2]) && parts[3] === "remove") {
    await tx(async c => {
      const a = (await c.query("UPDATE apparatus SET active = false WHERE id = $1 RETURNING unit", [parts[2]])).rows[0];
      if (a) await audit(c, user, "Removed apparatus", a.unit);
    });
    return send(res, 200, { apparatus: await apparatusList() });
  }
  if (parts[2] === "import") {
    // {units: "EG613, LD618, ..."} or lines "EG613 Engine 61"
    const lines = String(b.text || "").split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 200);
    let added = 0;
    await tx(async c => {
      for (const line of lines) {
        const [unit, ...rest] = line.split(/\s+/);
        const kind = KINDS.find(k => rest.join(" ").toLowerCase().includes(k.toLowerCase())) || guessKind(unit);
        const st = (unit.match(/(\d{2})\d?$/) || [])[1] || "";
        const r = await c.query(`INSERT INTO apparatus (id, unit, kind, station) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), clean(unit, 20), kind, st]);
        added += r.rowCount;
      }
      await audit(c, user, "Added apparatus", `${added} units`);
    }).catch(e => { if (e.code === "23505") return; throw e; });
    return send(res, 200, { added, apparatus: await apparatusList() });
  }
  const unit = clean(b.unit, 20).toUpperCase();
  if (!unit) throw err(400, "Enter the unit (radio name), e.g. EG613.");
  const kind = KINDS.includes(b.kind) ? b.kind : "Other";
  const status = ["in_service", "reserve", "out_of_service"].includes(b.status) ? b.status : "in_service";
  try {
    await tx(async c => {
      if (isUuid(b.id)) {
        await c.query("UPDATE apparatus SET unit = $2, kind = $3, station = $4, status = $5, notes = $6, sort = $7 WHERE id = $1",
          [b.id, unit, kind, clean(b.station, 40), status, clean(b.notes, 300), Number(b.sort) || 0]);
        await audit(c, user, "Edited apparatus", `${unit} (${kind})`);
      } else {
        await c.query("INSERT INTO apparatus (id, unit, kind, station, status, notes, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [crypto.randomUUID(), unit, kind, clean(b.station, 40), status, clean(b.notes, 300), Number(b.sort) || 0]);
        await audit(c, user, "Added apparatus", `${unit} (${kind})`);
      }
    });
  } catch (e) { if (e.code === "23505") throw err(400, `${unit} is already on the list.`); throw e; }
  return send(res, 200, { apparatus: await apparatusList() });
}
export function guessKind(unit) {
  const u = String(unit).toUpperCase();
  const map = [["EG", "Engine"], ["EN", "Engine"], ["E", "Engine"], ["LD", "Ladder"], ["TK", "Ladder"], ["L", "Ladder"], ["QT", "Quint"], ["RS", "Rescue"], ["R", "Rescue"],
    ["SQ", "Squad"], ["MD", "Medic"], ["M", "Medic"], ["TN", "Tanker"], ["T", "Tanker"], ["BR", "Brush"], ["B", "Battalion"], ["BC", "Battalion"], ["HZ", "Hazmat"], ["BT", "Boat"], ["UT", "Utility"]];
  for (const [p, k] of map.sort((a, b) => b[0].length - a[0].length)) if (u.startsWith(p) && /\d/.test(u.slice(p.length, p.length + 1))) return k;
  return "Other";
}

export async function handleBookings(req, res, parts, user, send, jsonBody, url) {
  const a = parts[2];
  const canEdit = user.role === "master" || await hasAccess(pool, user, "bookings", "edit");
  if (req.method === "GET" && a === "rooms") return send(res, 200, { rooms: await rooms(), canEdit, canManage: user.role === "master" || await hasAccess(pool, user, "bookings", "manage") });
  if (req.method === "GET" && a === "check") {
    const q = url.searchParams;
    const list = String(q.get("rooms") || "").split("|").filter(Boolean);
    const start = q.get("start"), end = q.get("end");
    if (!TIME.test(start || "") || !TIME.test(end || "") || end <= start) return send(res, 200, { conflicts: [] });
    let days; try { days = daysBetween(q.get("from") || "", q.get("to") || q.get("from") || ""); } catch { return send(res, 200, { conflicts: [] }); }
    const c = await conflicts(pool, list, days, start, end, isUuid(q.get("except")) ? q.get("except") : null);
    return send(res, 200, { conflicts: c.map(b => ({ room: b.room, day: b.d, start: hm(b.start_time), end: hm(b.end_time), title: b.title, contact: b.contact_name, status: b.status })) });
  }
  if (req.method === "GET" && !a) {
    const q = url.searchParams;
    const today = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
    const from = DAY.test(q.get("from") || "") ? q.get("from") : today;
    const to = DAY.test(q.get("to") || "") ? q.get("to") : iso(new Date(Date.parse(`${from}T00:00:00Z`) + 13 * 86400000));
    return send(res, 200, { bookings: await listBookings(from, to, q.get("all") === "1"), from, to, canEdit, rooms: await rooms() });
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  if (a === "rooms") {
    if (!(user.role === "master" || await hasAccess(pool, user, "bookings", "manage"))) throw err(403, "Only people who manage Bookings can change the rooms.");
    const list = [...new Set((Array.isArray(b.rooms) ? b.rooms : []).map(r => clean(r, 80)).filter(Boolean))].slice(0, 80);
    if (!list.length) throw err(400, "Keep at least one room.");
    await pool.query("INSERT INTO settings (key, value) VALUES ('booking_rooms', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(list)]);
    await audit(pool, user, "Changed rooms", list.join(", "));
    return send(res, 200, { rooms: list });
  }

  // Rotations: bookings editors, and the person who asked for the room
  if (a === "requests" && isUuid(parts[3]) && parts[4] === "rotations") {
    const owner = (await pool.query("SELECT 1 FROM bookings WHERE request_id = $1 AND (contact_id = $2 OR created_by = $2) LIMIT 1", [parts[3], user.id])).rowCount;
    if (!canEdit && !owner) throw err(403, "Only the person who booked it, or people who handle bookings, can set apparatus rotations.");
    const warnings = await tx(c => saveRotations(c, parts[3], b.rotations, user));
    return send(res, 200, { ok: true, warnings });
  }

  if (!canEdit) throw err(403, "You can't change bookings. Use the Facility & Resource Request form to ask for a room.");
  if (!a) {
    const all = await rooms();
    const list = [...new Set((b.rooms || []).filter(r => all.includes(r)))];
    if (!list.length) throw err(400, "Choose a room.");
    times(b.start, b.end);
    const days = daysBetween(b.from, b.to || b.from);
    if (!clean(b.title)) throw err(400, "Enter what the class or event is.");
    let contactName = user.name, contactId = user.id;
    if (isUuid(b.contactId)) {
      const p = (await pool.query("SELECT full_name FROM users WHERE id = $1 AND active", [b.contactId])).rows[0];
      if (p) { contactId = b.contactId; contactName = p.full_name; }
    }
    const requestId = await tx(async c => {
      const id = await createBookings(c, { roomList: list, days, start: b.start, end: b.end, title: b.title, division: b.division, contactId, contactName,
        attendees: Number(b.attendees), notes: b.notes, needsRotation: b.needsRotation === true, user, status: "approved" });
      await audit(c, user, "Booked", await describe(c, id));
      return id;
    });
    return send(res, 200, { requestId });
  }
  if (a === "requests" && isUuid(parts[3])) {
    const rid = parts[3];
    const first = (await pool.query("SELECT * FROM bookings WHERE request_id = $1 LIMIT 1", [rid])).rows[0];
    if (!first) throw err(404, "That booking wasn't found.");
    if (parts[4] === "approve" || parts[4] === "cancel") {
      const approve = parts[4] === "approve";
      await tx(async c => {
        if (approve) {
          // Bringing back a cancelled booking: the rooms must still be free
          const rows = (await c.query("SELECT room, to_char(day, 'YYYY-MM-DD') AS d, start_time, end_time FROM bookings WHERE request_id = $1", [rid])).rows;
          await c.query("SELECT pg_advisory_xact_lock(hashtext('sgfd-bookings'))");
          for (const r of rows) {
            const clash = await conflicts(c, [r.room], [r.d], hm(r.start_time), hm(r.end_time), rid);
            if (clash.length) throw err(409, `Can't approve: ${conflictText(clash)}.`);
          }
        }
        await c.query(`UPDATE bookings SET status = $2, cancelled_reason = $3 WHERE request_id = $1`, [rid, approve ? "approved" : "cancelled", approve ? "" : clean(b.reason, 300)]);
        await audit(c, user, approve ? "Approved booking" : "Cancelled booking", `${await describe(c, rid)}${!approve && b.reason ? ` — ${clean(b.reason, 300)}` : ""}`);
      });
      await tell(user, first.contact_id, approve ? `Room booking approved: ${first.title}` : `Room booking cancelled: ${first.title}`,
        `${await describe(pool, rid)} was ${approve ? "approved" : "cancelled"} by ${user.name}.${!approve && b.reason ? `\nReason: ${clean(b.reason, 300)}` : ""}`);
      return send(res, 200, { ok: true });
    }
    if (!parts[4]) {
      const start = b.start || hm(first.start_time), end = b.end || hm(first.end_time);
      times(start, end);
      await tx(async c => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('sgfd-bookings'))");
        const rows = (await c.query("SELECT room, to_char(day, 'YYYY-MM-DD') AS d FROM bookings WHERE request_id = $1 AND status <> 'cancelled'", [rid])).rows;
        for (const r of rows) {
          const clash = await conflicts(c, [r.room], [r.d], start, end, rid);
          if (clash.length) throw err(409, `Already booked: ${conflictText(clash)}.`);
        }
        await c.query(`UPDATE bookings SET title = $2, start_time = $3, end_time = $4, notes = $5, needs_rotation = $6 WHERE request_id = $1`,
          [rid, clean(b.title ?? first.title, 200) || first.title, start, end, clean(b.notes ?? first.notes, 2000), b.needsRotation ?? first.needs_rotation]);
        await audit(c, user, "Edited booking", await describe(c, rid));
      });
      return send(res, 200, { ok: true });
    }
  }
  throw err(404, "Not found");
}
