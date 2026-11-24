// Work schedule (part of the Time Clock module, so a Time Clock license covers it): who works which day and which hours, planned
// ahead by the people allowed to, for organizations without Aladtec. Everyone signed in sees it; Your Day shows "Working today";
// a TV screen can show it (display.js view "schedule"). Days off posted in Off Work (and sick call-outs, as just "Out") show on top.
//
//   GET  /api/schedule?from&to           {from, to, today, now, people, entries, off, canEdit: "all"|[divisions], dayStart, dayHours}
//   GET  /api/schedule/today             {today, now, list: [{userId, name, division, start, end, earlyAt, note, status, off?}]}
//   POST /api/schedule/save              {entries: [{userId, day, start, end, earlyAt?, backAt?, note?}], remove: [{userId, day}]}   (edit)
//   POST /api/schedule/copy              {from: first day of the week to copy, to: first day of the week to fill, userIds?}  (edit)
//
// Access: section "schedule" (divisions): everyone sees the schedule; edit = set it for people in those divisions; manage = also
// let others edit. earlyAt alone = leaving early; earlyAt + backAt = out for that stretch, then back. Times are server-local wall clock ("HH:MM"); an end before the start runs past midnight. Audit "Work schedule".
import { pool } from "./db.js";
import { accessScope } from "./access.js";
import { orgSettings } from "./brand.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isTime = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const clean = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const pad = n => String(n).padStart(2, "0");
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const nowHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const span = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Work schedule', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}
async function people() {
  return (await pool.query(`SELECT u.id, u.full_name AS name, d.name AS division, COALESCE(u.job_title, '') AS title FROM users u
    JOIN divisions d ON d.id = u.division_id WHERE u.active AND u.account_status = 'approved' ORDER BY d.name, u.full_name`)).rows;
}
async function editScope(user) {
  if (user.role === "master") return { all: true, divisions: new Set() };
  return accessScope(pool, user.id, "schedule", "edit");
}
async function entries(from, to) {
  return (await pool.query(`SELECT user_id, day::text AS day, to_char(start_time, 'HH24:MI') AS st, to_char(end_time, 'HH24:MI') AS et,
    to_char(early_at, 'HH24:MI') AS early, to_char(back_at, 'HH24:MI') AS back, note, updated_by_name FROM work_schedule WHERE day BETWEEN $1 AND $2`, [from, to])).rows
    .map(r => ({ userId: r.user_id, day: r.day, start: r.st, end: r.et, earlyAt: r.early || "", backAt: r.back || "", note: r.note, by: r.updated_by_name }));
}
// Days off from Off Work, when that module is here (its stand-in returns null in a download without it)
async function offs(user, from, to) {
  try { const { offFor } = await import("./offwork.js"); return (await offFor(user, from, to)) || []; } catch { return []; }
}
// Where someone is right now on a given day's plan
function statusOf(e, now) {
  const overnight = e.end <= e.start;
  if (now < e.start) return "later";
  if (e.earlyAt && e.backAt) { // stepping out and coming back
    if (now >= e.earlyAt && now < e.backAt) return "away";
    return !overnight && now >= e.end ? "done" : "working";
  }
  const end = e.earlyAt || e.end;
  if (!overnight && now >= end) return e.earlyAt ? "left_early" : "done";
  return "working";
}

// Today's list (Your Day, TV screens). user null = a TV: only days off shared with everyone, and no reasons
export async function scheduleToday(user) {
  const today = localToday(), now = nowHM();
  const ppl = new Map((await people()).map(p => [p.id, p]));
  const off = (await offs(user, today, today)).filter(o => o.from <= today && o.to >= today);
  const offBy = new Map(off.map(o => [o.userId, o]));
  const list = [];
  for (const e of await entries(today, today)) {
    const p = ppl.get(e.userId);
    if (!p) continue;
    const o = offBy.get(e.userId);
    const allDay = o && !o.startTime && !o.endTime;
    list.push({ userId: e.userId, name: p.name, division: p.division, title: p.title, start: e.start, end: e.end, earlyAt: e.earlyAt, backAt: e.backAt,
      note: user ? e.note : "", status: allDay ? "out" : statusOf(e, now),
      off: o ? { label: user && o.source !== "sick" ? o.label : "Out", startTime: o.startTime || "", endTime: o.endTime || "" } : null });
  }
  const order = { working: 0, away: 1, later: 2, left_early: 3, done: 4, out: 5 };
  list.sort((a, b) => order[a.status] - order[b.status] || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  return { today, now, list };
}

export async function handleSchedule(req, res, parts, user, send, jsonBody, url) {
  const what = parts[2] || "";
  if (req.method === "GET" && what === "today") return send(res, 200, await scheduleToday(user));
  if (req.method === "GET" && !what) {
    const q = url.searchParams;
    const from = isDay(q.get("from")) ? q.get("from") : localToday();
    const to = isDay(q.get("to")) && q.get("to") >= from && span(from, q.get("to")) <= 62 ? q.get("to") : addDays(from, 6);
    const sc = await editScope(user);
    const w = orgSettings().work;
    return send(res, 200, {
      from, to, today: localToday(), now: nowHM(), people: await people(), entries: await entries(from, to), off: await offs(user, from, to),
      canEdit: sc.all ? "all" : [...sc.divisions], dayStart: w.dayStart, dayHours: w.dayHours,
    });
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  const sc = await editScope(user);
  if (!sc.all && !sc.divisions.size) throw err(403, "You can see the schedule, but not change it.");
  const ppl = new Map((await people()).map(p => [p.id, p]));
  const mayEdit = id => { const p = ppl.get(id); return !!p && (sc.all || sc.divisions.has(p.division)); };

  if (what === "save") {
    const put = (Array.isArray(b.entries) ? b.entries : []).slice(0, 1000), del = (Array.isArray(b.remove) ? b.remove : []).slice(0, 1000);
    for (const e of [...put, ...del]) {
      if (!isUuid(e.userId) || !isDay(e.day)) throw err(400, "Each change needs a person and a day.");
      if (!mayEdit(e.userId)) throw err(403, `You can't set ${ppl.get(e.userId)?.name || "that person"}'s schedule.`);
    }
    for (const e of put) {
      if (!isTime(e.start) || !isTime(e.end)) throw err(400, "Times look like 08:00 and 16:30.");
      if (e.start === e.end) throw err(400, "The start and end can't be the same time.");
      if (e.earlyAt && !isTime(e.earlyAt)) throw err(400, "Leaving early: a time like 14:00.");
      if (e.backAt && (!isTime(e.backAt) || !e.earlyAt)) throw err(400, "Back at needs a leaving time, as a time like 12:00.");
      if (e.backAt && e.start < e.end && !(e.earlyAt < e.backAt && e.backAt < e.end && e.earlyAt > e.start))
        throw err(400, "The time away has to fall inside the workday: leaving after it starts, back before it ends.");
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      for (const e of put) await c.query(`INSERT INTO work_schedule (user_id, day, start_time, end_time, early_at, back_at, note, updated_by, updated_by_name)
        VALUES ($1, $2, $3, $4, $5, $9, $6, $7, $8) ON CONFLICT (user_id, day) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
        early_at = EXCLUDED.early_at, back_at = EXCLUDED.back_at, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
        [e.userId, e.day, e.start, e.end, e.earlyAt || null, clean(e.note, 200), user.id, user.name, (e.earlyAt && e.backAt) || null]);
      for (const e of del) await c.query("DELETE FROM work_schedule WHERE user_id = $1 AND day = $2", [e.userId, e.day]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    const names = [...new Set([...put, ...del].map(e => ppl.get(e.userId)?.name))];
    const days = [...new Set([...put, ...del].map(e => e.day))].sort();
    if (names.length) await audit(user, "Changed the schedule", `${names.slice(0, 6).join(", ")}${names.length > 6 ? ` +${names.length - 6}` : ""}: ${days[0]}${days.length > 1 ? ` – ${days[days.length - 1]}` : ""}${put.some(e => e.backAt) ? " (stepping out)" : put.some(e => e.earlyAt) ? " (leaving early)" : ""}`);
    return send(res, 200, { ok: true, saved: put.length, removed: del.length });
  }
  if (what === "copy") {
    if (!isDay(b.from) || !isDay(b.to)) throw err(400, "Pick the week to copy and the week to fill.");
    const len = Math.min(31, Math.max(1, Number(b.days) || 7));
    const shift = span(b.from, b.to);
    const only = Array.isArray(b.userIds) && b.userIds.length ? new Set(b.userIds.filter(isUuid)) : null;
    const src = (await entries(b.from, addDays(b.from, len - 1))).filter(e => mayEdit(e.userId) && (!only || only.has(e.userId)));
    const who = new Set(src.map(e => e.userId));
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      // The people being copied get the copied week exactly (their other days in that week are cleared)
      for (const id of who) await c.query("DELETE FROM work_schedule WHERE user_id = $1 AND day BETWEEN $2 AND $3", [id, b.to, addDays(b.to, len - 1)]);
      for (const e of src) await c.query(`INSERT INTO work_schedule (user_id, day, start_time, end_time, note, updated_by, updated_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [e.userId, addDays(e.day, shift), e.start, e.end, e.note, user.id, user.name]);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    await audit(user, "Copied a week of the schedule", `${b.from} → ${b.to}: ${who.size} ${who.size === 1 ? "person" : "people"}, ${src.length} days`);
    return send(res, 200, { ok: true, copied: src.length, people: who.size });
  }
  throw err(404, "Not found");
}
