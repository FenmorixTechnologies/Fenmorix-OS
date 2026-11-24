// Punch clock (/api/time/*): punch in when you arrive, punch out when you leave. The server's
// clock records the time, so it's the same on a phone, a station PC or the office.
// Also each person's work pattern, which the Time Tracker uses for "hours needed per shift".
import crypto from "node:crypto";
import { pool } from "./db.js";
import { HttpError, punchHours } from "./collections.js";
import { clearAccessCache } from "./access.js";

const PATTERN = /^(|weekdays|fire:[ABC]|comms:[ABCD])$/;
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function openPunch(userId) {
  const r = await pool.query(
    `SELECT id, work_date::text AS day, to_char(start_time, 'HH24:MI') AS st FROM time_entries
      WHERE user_id = $1 AND start_time IS NOT NULL AND end_time IS NULL ORDER BY work_date DESC, start_time DESC LIMIT 1`, [userId]);
  const o = r.rows[0];
  return o ? { id: o.id, date: o.day, start: o.st, startedAt: new Date(`${o.day}T${o.st}:00`).toISOString() } : null;
}

export async function handleTimeClock(req, res, parts, user, send, jsonBody) {
  const what = parts[2];
  if (what === "clock" && req.method === "GET") {
    const p = (await pool.query("SELECT work_pattern FROM users WHERE id = $1", [user.id])).rows[0];
    return send(res, 200, { open: await openPunch(user.id), pattern: p?.work_pattern || "", now: new Date().toISOString() });
  }
  if (what === "clock" && req.method === "POST") {
    const body = await jsonBody(req);
    const now = new Date();
    const open = await openPunch(user.id);
    if (body.action === "in") {
      if (open) throw new HttpError(409, `You're already punched in (since ${open.start}${open.date !== localDay(now) ? ` on ${open.date}` : ""}). Punch out first.`);
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO time_entries (id, user_id, work_date, start_time, end_time, hours, kind, note) VALUES ($1, $2, $3, $4, NULL, 0, 'regular', '')`,
        [id, user.id, localDay(now), localTime(now)]);
      return send(res, 200, { ok: true, open: await openPunch(user.id) });
    }
    if (body.action === "out") {
      if (!open) throw new HttpError(409, "You aren't punched in.");
      const minutes = Math.floor((now - new Date(open.startedAt)) / 60000);
      if (minutes < 1) throw new HttpError(409, "You punched in less than a minute ago.");
      if (minutes > 24 * 60) {
        throw new HttpError(409, `Your punch-in from ${open.date} at ${open.start} is more than 24 hours old, so it can't be punched out automatically. Open Time Tracker and enter the out time on that day.`);
      }
      const end = localTime(now);
      await pool.query("UPDATE time_entries SET end_time = $2, hours = $3, updated_at = now() WHERE id = $1",
        [open.id, end, punchHours(open.start, end)]);
      return send(res, 200, { ok: true, open: null, punched: { date: open.date, start: open.start, end, hours: punchHours(open.start, end) } });
    }
    throw new HttpError(400, "Unknown punch action.");
  }
  if (what === "pattern" && req.method === "POST") {
    const body = await jsonBody(req);
    const p = String(body.pattern ?? "");
    if (!PATTERN.test(p)) throw new HttpError(400, "Choose a schedule from the list.");
    await pool.query("UPDATE users SET work_pattern = $2 WHERE id = $1", [user.id, p]);
    clearAccessCache();
    return send(res, 200, { ok: true, pattern: p });
  }
  throw new HttpError(404, "Not found");
}
