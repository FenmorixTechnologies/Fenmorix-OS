// Off Work: who's out and when. People post their own days off (vacation, training, out of office, ...) and choose who sees
// them: everyone, their division, or certain people / groups. Sick leave call-outs (server/sick.js) show up here on their own
// as "Out sick" (protected leave just as "Out", no reason), so nobody has to post them twice; nothing medical is shown.
//
//   GET  /api/offwork?from&to&division        entries the viewer may see in the range (posted + sick), people, rights
//   GET  /api/offwork/widget                  Your Day: out today and the next 7 days
//   POST /api/offwork                         {id?, userId?, from, to, kind, note, visibility, people}   own, or others (edit)
//   POST /api/offwork/:id/remove
//   POST /api/offwork/settings                {sickVisibility: everyone|division|off}                    (manage)
//
// Access: section "offwork" (divisions). Everyone posts their own and sees what's shared with them; view = every entry;
// edit = post/change for people in those divisions; manage = settings. Audit module "Off Work".
import { pool } from "./db.js";
import { hasAccess, accessScope, allGroupMembers } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const pad = n => String(n).padStart(2, "0");
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

export const KINDS = {
  off: "Off", vacation: "Vacation / leave", meeting: "Off-site meeting", training: "Training / conference", ooo: "Out of office", remote: "Working remotely", other: "Other",
};
const SICK_LABEL = { sick: "Out sick", leave: "Out" };
const VIS = ["everyone", "division", "people"];
const isTime = v => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const nowHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };

async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'offwork'")).rows[0]?.value;
  const d = (typeof v === "string" ? JSON.parse(v) : v) || {};
  return { sickVisibility: ["everyone", "division", "off"].includes(d.sickVisibility) ? d.sickVisibility : "everyone" };
}
async function rights(user) {
  const master = user.role === "master";
  const viewAll = master || (await hasAccess(pool, user, "offwork", "view"));
  const edit = master ? { all: true, divisions: new Set() } : await accessScope(pool, user.id, "offwork", "edit");
  const manage = master || (await hasAccess(pool, user, "offwork", "manage"));
  return { master, viewAll, edit, manage, canEditFor: div => edit.all || edit.divisions.has(div) };
}
async function people() {
  return (await pool.query(`SELECT u.id, u.full_name AS name, d.name AS division, COALESCE(u.job_title, '') AS title FROM users u JOIN divisions d ON d.id = u.division_id
    WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows;
}
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Off Work', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}

// Everything in [from, to] the viewer may see: posted entries + runs of sick call-outs
async function entriesFor(user, r, from, to) {
  const ppl = await people();
  const byId = new Map(ppl.map(p => [p.id, p]));
  const me = byId.get(user.id);
  const groups = new Map((await allGroupMembers(pool)).map(g => [g.id, new Set(g.ids)]));
  const sees = (e, owner) => {
    if (r.viewAll || e.user_id === user.id || e.created_by === user.id) return true;
    if (e.visibility === "everyone") return true;
    if (e.visibility === "division") return !!me && owner?.division === me.division;
    return (e.people || []).some(x => (x.kind === "group" ? groups.get(x.id)?.has(user.id) : x.id === user.id));
  };
  const out = [];
  for (const e of (await pool.query(`SELECT *, start_day::text AS s, end_day::text AS e, to_char(start_time, 'HH24:MI') AS st, to_char(end_time, 'HH24:MI') AS et FROM off_work WHERE end_day >= $1 AND start_day <= $2 ORDER BY start_day`, [from, to])).rows) {
    const owner = byId.get(e.user_id);
    if (!owner || !sees(e, owner)) continue;
    const mine = e.user_id === user.id;
    const canEdit = mine || r.canEditFor(owner.division);
    out.push({ id: e.id, userId: e.user_id, name: owner.name, division: owner.division, title: owner.title, from: e.s, to: e.e, kind: e.kind,
      label: KINDS[e.kind] || "Off", note: e.note, startTime: e.st || "", endTime: e.et || "", location: e.location || "", source: "posted", mine, canEdit,
      ...(canEdit ? { visibility: e.visibility, people: e.people || [] } : {}), postedBy: e.created_by !== e.user_id ? e.created_by_name : "" });
  }
  // Sick leave: consecutive call-out days become one entry. Everyone (or the division) sees "Out sick"; no hours, notes or kinds.
  const s = await settings();
  if (s.sickVisibility !== "off") {
    let rows = [];
    try {
      rows = (await pool.query(`SELECT user_id, day::text AS day, protected FROM sick_entries WHERE day BETWEEN $1 AND $2 ORDER BY user_id, day`,
        [addDays(from, -30), to])).rows;
    } catch { rows = []; }
    let run = null;
    const flush = () => {
      if (!run || run.to < from) return;
      const owner = byId.get(run.userId);
      if (!owner) return;
      if (!(r.viewAll || run.userId === user.id || s.sickVisibility === "everyone" || owner.division === me?.division)) return;
      out.push({ id: `sick:${run.userId}:${run.from}`, userId: run.userId, name: owner.name, division: owner.division, title: owner.title,
        from: run.from, to: run.to, kind: run.kind, label: SICK_LABEL[run.kind], note: "", source: "sick", mine: run.userId === user.id, canEdit: false });
    };
    for (const x of rows) {
      const kind = x.protected ? "leave" : "sick";
      if (run && run.userId === x.user_id && run.kind === kind && dayDiff(run.to, x.day) <= 1) { run.to = x.day; continue; }
      flush();
      run = { userId: x.user_id, from: x.day, to: x.day, kind };
    }
    flush();
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
}

// Who's out in [from, to], for the work schedule: what this person may see, or (user null: a TV screen) only what's shared with everyone
export async function offFor(user, from, to) {
  if (user) return entriesFor(user, await rights(user), from, to);
  return entriesFor({ id: "" }, { viewAll: false, canEditFor: () => false }, from, to);
}

export async function handleOffwork(req, res, parts, user, send, jsonBody, url) {
  const what = parts[2];
  const r = await rights(user);
  if (req.method === "GET" && !what) {
    const q = url.searchParams, today = localToday();
    const from = isDay(q.get("from")) ? q.get("from") : today;
    let to = isDay(q.get("to")) && q.get("to") >= from ? q.get("to") : addDays(from, 13);
    if (dayDiff(from, to) > 400) to = addDays(from, 400);
    let entries = await entriesFor(user, r, from, to);
    if (q.get("division")) entries = entries.filter(e => e.division === q.get("division"));
    const ppl = await people();
    return send(res, 200, {
      from, to, today, meId: user.id, entries, kinds: KINDS, settings: r.manage ? await settings() : undefined,
      rights: { viewAll: r.viewAll, manage: r.manage, editAll: r.edit.all, editDivisions: [...r.edit.divisions] },
      people: ppl.map(p => ({ id: p.id, name: p.name, division: p.division, canEdit: p.id === user.id || r.canEditFor(p.division) })),
      divisions: [...new Set(ppl.map(p => p.division))].sort(),
      groups: (await allGroupMembers(pool)).map(g => ({ id: g.id, name: g.name, count: g.ids.length })).sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  if (req.method === "GET" && what === "widget") {
    const today = localToday();
    const entries = await entriesFor(user, r, today, addDays(today, 7));
    // Part of a day: drop it from "out today" once they're back
    const now = nowHM();
    const backAlready = e => e.to === today && e.endTime && e.endTime <= now;
    return send(res, 200, { today, now, out: entries.filter(e => e.from <= today && !backAlready(e)), soon: entries.filter(e => e.from > today) });
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  if (what === "settings") {
    if (!r.manage) throw err(403, "Only Off Work managers can change its settings.");
    const value = { sickVisibility: ["everyone", "division", "off"].includes(b.sickVisibility) ? b.sickVisibility : "everyone" };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('offwork', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(value)]);
    await audit(user, "Changed settings", `Sick call-outs shown to: ${value.sickVisibility}`);
    return send(res, 200, { ok: true, settings: value });
  }
  if (isUuid(what) && parts[3] === "remove") {
    const e = (await pool.query("SELECT o.*, d.name AS division, u.full_name AS name FROM off_work o JOIN users u ON u.id = o.user_id JOIN divisions d ON d.id = u.division_id WHERE o.id = $1", [what])).rows[0];
    if (!e) return send(res, 200, { ok: true });
    if (e.user_id !== user.id && !r.canEditFor(e.division)) throw err(403, "You can only remove your own days off (or those of people in divisions you post for).");
    await pool.query("DELETE FROM off_work WHERE id = $1", [what]);
    await audit(user, "Removed days off", `${e.name}: ${String(e.start_day).slice(0, 10)}`);
    return send(res, 200, { ok: true });
  }
  if (!what) {
    const ppl = await people();
    const forId = isUuid(b.userId) ? b.userId : user.id;
    const owner = ppl.find(p => p.id === forId);
    if (!owner) throw err(400, "Choose a person.");
    if (forId !== user.id && !r.canEditFor(owner.division)) throw err(403, "You can only post days off for yourself (or people in divisions you post for).");
    if (!isDay(b.from)) throw err(400, "Enter the first day off.");
    const to = isDay(b.to) ? b.to : b.from;
    if (to < b.from) throw err(400, "The last day can't be before the first day.");
    if (dayDiff(b.from, to) > 366) throw err(400, "Post up to a year at a time.");
    const kind = KINDS[b.kind] ? b.kind : "off";
    const visibility = VIS.includes(b.visibility) ? b.visibility : "everyone";
    const list = [];
    if (visibility === "people") {
      const groups = new Map((await allGroupMembers(pool)).map(g => [g.id, g.name]));
      for (const x of (Array.isArray(b.people) ? b.people : []).slice(0, 60)) {
        if (!x || !isUuid(x.id)) continue;
        if (x.kind === "group" && groups.has(x.id)) list.push({ kind: "group", id: x.id, name: groups.get(x.id) });
        else if (x.kind !== "group") { const p = ppl.find(y => y.id === x.id); if (p) list.push({ kind: "user", id: p.id, name: p.name }); }
      }
      if (!list.length) throw err(400, "Pick the people or groups who should see it.");
    }
    const note = clean(b.note, 300);
    const location = clean(b.location, 200);
    const startTime = isTime(b.startTime) ? b.startTime : null, endTime = isTime(b.endTime) ? b.endTime : null;
    if ((b.startTime && !startTime) || (b.endTime && !endTime)) throw err(400, "Times look like 13:30.");
    if (startTime && endTime && b.from === to && endTime <= startTime) throw err(400, "The time back has to be after the time leaving.");
    if (isUuid(b.id)) {
      const prev = (await pool.query("SELECT o.user_id, d.name AS division FROM off_work o JOIN users u ON u.id = o.user_id JOIN divisions d ON d.id = u.division_id WHERE o.id = $1", [b.id])).rows[0];
      if (!prev) throw err(404, "That entry is gone.");
      if (prev.user_id !== user.id && !r.canEditFor(prev.division)) throw err(403, "You can only change your own days off.");
      await pool.query(`UPDATE off_work SET user_id = $2, start_day = $3, end_day = $4, kind = $5, note = $6, visibility = $7, people = $8,
        start_time = $9, end_time = $10, location = $11, updated_at = now() WHERE id = $1`,
        [b.id, forId, b.from, to, kind, note, visibility, JSON.stringify(list), startTime, endTime, location]);
      await audit(user, "Changed days off", `${owner.name}: ${b.from} to ${to} (${KINDS[kind]})`);
      return send(res, 200, { ok: true, id: b.id });
    }
    const id = (await pool.query(`INSERT INTO off_work (user_id, start_day, end_day, kind, note, visibility, people, created_by, created_by_name, start_time, end_time, location)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [forId, b.from, to, kind, note, visibility, JSON.stringify(list), user.id, user.name, startTime, endTime, location])).rows[0].id;
    await audit(user, "Posted days off", `${owner.name}: ${b.from}${startTime ? ` ${startTime}` : ""} to ${to}${endTime ? ` ${endTime}` : ""} (${KINDS[kind]}), seen by ${visibility}`);
    return send(res, 200, { ok: true, id });
  }
  throw err(404, "Not found");
}
