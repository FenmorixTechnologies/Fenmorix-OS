// Force Back lists (/api/forceback): who is forced back next. Each list (Communications now, Suppression later) orders its
// people by the longest time since their last force back (never = top). Supervisors log what happened when they call down
// the list: forced back (or on-call force back) moves the person to the bottom; no answer / excused (out of town, PTO,
// covered another shift) / notes only go in the log. The log is append-only and replaces the spreadsheet's "Edit Log".
//
//   GET  /api/forceback                          lists the viewer can see (+ rights)
//   GET  /api/forceback/:id                      members in order, log (latest 300), rights, people to add
//   POST /api/forceback/:id/action               {memberId, kind forced|oncall|no_answer|excused|note, day, note, notify}   (edit)
//   POST /api/forceback/:id/member               {memberId?, userId?, name, shift, lastFb, active}                          (manage)
//   POST /api/forceback/:id/import               {fileName, data base64, preview}  the old spreadsheet (Employee, Shift, Force Back Date, Entered By)
//   POST /api/forceback/lists                    {id?, name, division, steps, active}                                        (manage)
//
// Access: section "forceback" (divisions = the list's division). Anyone on a list sees that list. view = see lists;
// edit = log calls; manage = people, dates, import, lists. Forced back (on by default) messages the person, important.
// Audit module "Force back".
import { pool } from "./db.js";
import { hasAccess, accessScope } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const pad = n => String(n).padStart(2, "0");
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
export const initialsOf = name => String(name || "").split(/[\s,.-]+/).filter(Boolean).map(w => w[0].toUpperCase()).join("").slice(0, 4);
export const KINDS = { forced: "Forced back", oncall: "Forced back (on call)", no_answer: "No answer", excused: "Excused", note: "Note",
  added: "Added to the list", removed: "Removed from the list", changed: "Changed", imported: "Imported" };
const DEFAULT_STEPS = "1. Start at the top: the longest since a force back.\n2. Contact people in this order for the coverage needed.\n3. Log every call: forced back, no answer, or excused (with the reason).";

async function rights(user) {
  const master = user.role === "master";
  const scope = async level => (master ? { all: true, divisions: new Set() } : accessScope(pool, user.id, "forceback", level));
  const [view, edit, manage] = await Promise.all([scope("view"), scope("edit"), scope("manage")]);
  const has = (s, div) => s.all || s.divisions.has(div);
  return { master, manageAll: master || manage.all, canView: d => has(view, d), canEdit: d => has(edit, d), canManage: d => has(manage, d) };
}
async function visibleLists(user, r) {
  const lists = (await pool.query("SELECT * FROM fb_lists ORDER BY active DESC, name")).rows;
  const mine = new Set((await pool.query("SELECT DISTINCT list_id FROM fb_members WHERE user_id = $1 AND active", [user.id])).rows.map(x => x.list_id));
  return lists.filter(l => (l.active || r.canManage(l.division)) && (r.canView(l.division) || mine.has(l.id)))
    .map(l => ({ id: l.id, name: l.name, division: l.division, active: l.active, onIt: mine.has(l.id), canEdit: r.canEdit(l.division), canManage: r.canManage(l.division) }));
}
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Force back', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}
const log = (c, l, m, kind, day, note, user) => c.query(`INSERT INTO fb_log (list_id, member_id, member_name, day, kind, note, by_id, by_name, initials)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [l.id, m?.id || null, m?.name || "", day, kind, clean(note, 500), user.id, user.name, initialsOf(user.name)]);

async function listState(user, r, l) {
  const today = localToday();
  const members = (await pool.query(`SELECT m.*, m.last_fb::text AS last, u.active AS acct_active FROM fb_members m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.list_id = $1 AND m.active ORDER BY m.last_fb ASC NULLS FIRST, m.name`, [l.id])).rows;
  const logRows = (await pool.query(`SELECT id, member_id, member_name, day::text AS day, kind, note, by_name, initials, created_at FROM fb_log
    WHERE list_id = $1 ORDER BY id DESC LIMIT 300`, [l.id])).rows;
  const manage = r.canManage(l.division);
  return {
    list: { id: l.id, name: l.name, division: l.division, steps: l.steps || DEFAULT_STEPS, active: l.active },
    today, kinds: KINDS, canEdit: r.canEdit(l.division), canManage: manage, meId: user.id,
    members: members.map((m, i) => ({ id: m.id, order: i + 1, userId: m.user_id, name: m.name, shift: m.shift, lastFb: m.last, lastBy: m.last_by,
      days: m.last ? dayDiff(m.last, today) : null, me: m.user_id === user.id, noAccount: !m.user_id || m.acct_active === false })),
    log: logRows.map(x => ({ id: Number(x.id), memberId: x.member_id, name: x.member_name, day: x.day, kind: x.kind, label: KINDS[x.kind] || x.kind, note: x.note,
      by: x.by_name, initials: x.initials, at: x.created_at })),
    shifts: [...new Set(members.map(m => m.shift).filter(Boolean))].sort(),
    people: manage ? (await pool.query(`SELECT u.id, u.full_name AS name, d.name AS division, u.work_pattern FROM users u LEFT JOIN divisions d ON d.id = u.division_id
      WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows.map(p => ({ id: p.id, name: p.name, division: p.division || "",
        shift: /^(fire|comms):/.test(p.work_pattern || "") ? p.work_pattern.split(":")[1] : p.work_pattern === "weekdays" ? "Days" : "" })) : undefined,
  };
}
async function getList(id) {
  if (!isUuid(id)) throw err(404, "That list wasn't found.");
  const l = (await pool.query("SELECT * FROM fb_lists WHERE id = $1", [id])).rows[0];
  if (!l) throw err(404, "That list wasn't found.");
  return l;
}
async function mayView(user, r, l) {
  if (r.canView(l.division)) return true;
  return !!(await pool.query("SELECT 1 FROM fb_members WHERE list_id = $1 AND user_id = $2 AND active", [l.id, user.id])).rows[0];
}

// "Brown, Laura" / "Laura Brown" -> account
function nameKey(n) {
  const s = String(n || "").trim();
  const [a, b] = s.includes(",") ? s.split(",").map(x => x.trim()) : [s.split(/\s+/).slice(-1)[0], s.split(/\s+/).slice(0, -1).join(" ")];
  return `${(b || "").toLowerCase().split(/\s+/)[0]}|${(a || "").toLowerCase()}`;
}
function parseDay(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${pad(m[1])}-${pad(m[2])}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  return null;
}
async function parseSheet(fileName, data) {
  const { readSheets } = await import("./documents.js");
  const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const sh of readSheets(fileName, Buffer.from(String(data || ""), "base64"), 5000)) {
    const rows = sh.rows.map(r => Array.from(r, v => (v === null || v === undefined ? "" : String(v))));
    for (let h = 0; h < Math.min(15, rows.length); h++) {
      const hd = rows[h].map(norm);
      const col = (...names) => hd.findIndex(x => names.includes(x));
      const iName = col("employee", "name", "member", "employee name"), iShift = col("shift", "crew"), iDate = col("force back date", "forceback date", "fb date", "last force back", "date");
      const iBy = col("entered by", "entered", "initials", "by");
      if (iName < 0 || iDate < 0) continue;
      const out = [];
      for (const r of rows.slice(h + 1)) {
        const name = clean(r[iName], 120); if (!name) continue;
        out.push({ name, shift: iShift >= 0 ? clean(r[iShift], 30) : "", lastFb: parseDay(r[iDate]), lastBy: iBy >= 0 ? clean(r[iBy], 8).toUpperCase() : "" });
      }
      return out;
    }
  }
  throw err(400, "No header row with Employee and Force Back Date was found.");
}

export async function handleForceback(req, res, parts, user, send, jsonBody) {
  const r = await rights(user);
  const what = parts[2];
  if (req.method === "GET" && !what) return send(res, 200, { lists: await visibleLists(user, r), canCreate: r.manageAll });

  if (req.method === "POST" && what === "lists") {
    const b = await jsonBody(req);
    const name = clean(b.name, 80), division = clean(b.division, 80);
    if (!name) throw err(400, "Name the list.");
    if (b.id) {
      const l = await getList(b.id);
      if (!r.canManage(l.division) || (division !== l.division && !r.canManage(division))) throw err(403, "Managing this list needs Force Back manage.");
      await pool.query("UPDATE fb_lists SET name = $2, division = $3, steps = $4, active = $5 WHERE id = $1", [l.id, name, division, clean(b.steps, 2000), b.active !== false]);
      await audit(user, "Changed a force back list", name);
    } else {
      if (!r.canManage(division)) throw err(403, "Creating a list needs Force Back manage for that division.");
      try { await pool.query("INSERT INTO fb_lists (name, division, steps) VALUES ($1, $2, $3)", [name, division, clean(b.steps, 2000) || DEFAULT_STEPS]); }
      catch (e) { if (e.code === "23505") throw err(409, "There's already a list with that name."); throw e; }
      await audit(user, "Created a force back list", name);
    }
    return send(res, 200, { lists: await visibleLists(user, r), canCreate: r.manageAll });
  }

  const l = await getList(what);
  if (!(await mayView(user, r, l))) throw err(403, "This force back list is for its division's supervisors and the people on it.");
  if (req.method === "GET" && !parts[3]) return send(res, 200, await listState(user, r, l));
  if (req.method !== "POST") throw err(404, "Not found.");
  const b = await jsonBody(req);

  if (parts[3] === "action") {
    if (!r.canEdit(l.division)) throw err(403, "Logging force backs needs Force Back edit for this division.");
    const kind = clean(b.kind, 20);
    if (!["forced", "oncall", "no_answer", "excused", "note"].includes(kind)) throw err(400, "What happened?");
    const day = isDay(b.day) ? b.day : localToday();
    if (dayDiff(day, localToday()) < -60 || dayDiff(day, localToday()) > 400) throw err(400, "Check the date.");
    const note = clean(b.note, 500);
    if (kind === "excused" && !note) throw err(400, "Give the reason (out of town, PTO, covered another shift...).");
    if (kind === "note" && !note) throw err(400, "Write the note.");
    const c = await pool.connect();
    let m;
    try {
      await c.query("BEGIN");
      m = (await c.query("SELECT *, last_fb::text AS last FROM fb_members WHERE id = $1 AND list_id = $2 AND active FOR UPDATE", [isUuid(b.memberId) ? b.memberId : null, l.id])).rows[0];
      if (!m && kind !== "note") throw err(400, "Pick the person.");
      if (kind === "forced" || kind === "oncall") {
        // An older date than what's on the list doesn't move anyone back up
        if (!m.last || day >= m.last) await c.query("UPDATE fb_members SET last_fb = $2, last_by = $3 WHERE id = $1", [m.id, day, initialsOf(user.name)]);
      }
      await log(c, l, m, kind, day, note, user);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    if ((kind === "forced" || kind === "oncall") && b.notify !== false && m.user_id && m.user_id !== user.id) {
      const when = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
      try {
        const { send: sendMsg } = await import("./messages.js");
        await sendMsg(user, { users: [m.user_id], important: true, subject: `Force back: ${when}`,
          body: `You were forced back${kind === "oncall" ? " (on call)" : ""} for ${when}.${note ? `\n${note}` : ""}\n\nLogged on the ${l.name} force back list by ${user.name}.` });
      } catch (e) { console.warn(`[Force back] message: ${e.message}`); }
    }
    return send(res, 200, await listState(user, r, l));
  }

  if (parts[3] === "member") {
    if (!r.canManage(l.division)) throw err(403, "Changing who's on the list needs Force Back manage.");
    const given = b.lastFb !== undefined;     // left out = keep what's there (edits) / never (new)
    let lastFb = !given || b.lastFb === "" || b.lastFb === null ? null : isDay(b.lastFb) ? b.lastFb : undefined;
    if (lastFb === undefined) throw err(400, "Check the force back date.");
    let shift = clean(b.shift, 30);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (isUuid(b.memberId)) {
        const m = (await c.query("SELECT *, last_fb::text AS last FROM fb_members WHERE id = $1 AND list_id = $2 AND active FOR UPDATE", [b.memberId, l.id])).rows[0];
        if (!m) throw err(404, "That person isn't on this list.");
        if (b.active === false) {
          await c.query("UPDATE fb_members SET active = false WHERE id = $1", [m.id]);
          await log(c, l, m, "removed", localToday(), clean(b.note, 300), user);
        } else {
          if (!given) lastFb = m.last || null;
          if (b.shift === undefined) shift = m.shift;
          const changes = [];
          if (shift !== m.shift) changes.push(`shift ${m.shift || "(none)"} → ${shift || "(none)"}`);
          if ((lastFb || null) !== (m.last || null)) changes.push(`force back date ${m.last || "(none)"} → ${lastFb || "(none)"}`);
          if (changes.length) {
            await c.query("UPDATE fb_members SET shift = $2, last_fb = $3, last_by = CASE WHEN $3::date IS DISTINCT FROM last_fb THEN $4 ELSE last_by END WHERE id = $1",
              [m.id, shift, lastFb, initialsOf(user.name)]);
            await log(c, l, m, "changed", localToday(), changes.join("; "), user);
          }
        }
      } else {
        let userId = isUuid(b.userId) ? b.userId : null, name = clean(b.name, 120);
        if (userId) {
          const u = (await c.query("SELECT full_name FROM users WHERE id = $1 AND active", [userId])).rows[0];
          if (!u) throw err(400, "That account isn't active.");
          name = name || u.full_name;
          if ((await c.query("SELECT 1 FROM fb_members WHERE list_id = $1 AND user_id = $2 AND active", [l.id, userId])).rows[0]) throw err(409, `${name} is already on this list.`);
        }
        if (!name) throw err(400, "Who's being added?");
        const m = (await c.query("INSERT INTO fb_members (list_id, user_id, name, shift, last_fb, last_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
          [l.id, userId, name, shift, lastFb, lastFb ? initialsOf(user.name) : ""])).rows[0];
        await log(c, l, m, "added", localToday(), lastFb ? `last force back ${lastFb}` : "never forced back", user);
      }
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    return send(res, 200, await listState(user, r, l));
  }

  if (parts[3] === "import") {
    if (!r.canManage(l.division)) throw err(403, "Importing needs Force Back manage.");
    const rows = await parseSheet(clean(b.fileName, 200), b.data);
    if (!rows.length) throw err(400, "That sheet has no people on it.");
    const accounts = (await pool.query("SELECT id, full_name FROM users WHERE active AND account_status = 'approved'")).rows;
    const byKey = new Map();
    for (const a of accounts) { const k = nameKey(a.full_name); byKey.set(k, byKey.has(k) ? null : a); }
    const existing = (await pool.query("SELECT * FROM fb_members WHERE list_id = $1 AND active", [l.id])).rows;
    const plan = rows.map(x => {
      const acct = byKey.get(nameKey(x.name)) || null;
      const have = existing.find(m => (acct && m.user_id === acct.id) || nameKey(m.name) === nameKey(x.name));
      return { ...x, userId: acct?.id || null, account: acct?.full_name || "", status: have ? "update" : "new", memberId: have?.id || null };
    });
    if (b.preview) return send(res, 200, { preview: true, rows: plan });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      for (const x of plan) {
        if (x.memberId) {
          await c.query("UPDATE fb_members SET shift = $2, last_fb = $3, last_by = $4, user_id = COALESCE(user_id, $5) WHERE id = $1",
            [x.memberId, x.shift, x.lastFb, x.lastBy, x.userId]);
        } else {
          await c.query("INSERT INTO fb_members (list_id, user_id, name, shift, last_fb, last_by) VALUES ($1, $2, $3, $4, $5, $6)",
            [l.id, x.userId, x.account || x.name, x.shift, x.lastFb, x.lastBy]);
        }
      }
      await log(c, l, null, "imported", localToday(), `${plan.length} people from ${clean(b.fileName, 120) || "a spreadsheet"}`, user);
      await c.query("COMMIT");
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    await audit(user, "Imported a force back list", `${l.name}: ${plan.length} people`);
    return send(res, 200, await listState(user, r, l));
  }
  throw err(404, "Not found.");
}
