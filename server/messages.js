// Interdepartmental messages (/api/messages/*). See db/migrations/015_messages.sql.
//
// Anyone can message people directly; sending to a group or to everyone needs the "messages"
// section at edit level (User Management > Permissions). Recipients are fixed when it's sent.
// timing "next_shift": each person gets it when their next shift starts (from their Time Tracker
// schedule), or right away if they're on shift now or have no schedule set.
// Group/everyone sends are broadcasts: members' replies go only to the sender.
import crypto from "node:crypto";
import { brand, brandText, brandDeep } from "./brand.js";
import { pool, tx } from "./db.js";
import { hasAccess, activePeople, groupMembers, allGroupMembers } from "./access.js";
import { fireShift, commsShifts, weekday } from "../src/shifts.js";
import { publish, isOnline, onlineIds } from "./events.js";
import { sendToUser } from "./push.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const inList = (n, start = 1) => Array.from({ length: n }, (_, i) => `$${i + start}`).join(", ");
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// ---- Chat status: Available / Busy / Do not disturb / Out of office -------------------------------
// While someone isn't Available: chats to them go to their Messages inbox instead (the sender is
// told, with the away message), there are no pop-ups, sounds or phone notifications except for
// important messages, and anyone who messages them directly gets their away message once.
export const STATUS_LABEL = { available: "Available", busy: "Busy", dnd: "Do not disturb", away: "Out of office" };
function effective(row) {
  if (!row || !STATUS_LABEL[row.chat_status] || row.chat_status === "available" || (row.status_until && new Date(row.status_until) <= new Date())) {
    return { status: "available", label: STATUS_LABEL.available, message: "", until: null, setAt: null };
  }
  return { status: row.chat_status, label: STATUS_LABEL[row.chat_status], message: row.status_message || "", until: row.status_until, setAt: row.status_set_at };
}
export async function statusOf(ids) {
  ids = [...new Set(ids.filter(isUuid))];
  if (!ids.length) return new Map();
  const rows = (await pool.query(`SELECT id, chat_status, status_message, status_until, status_set_at FROM users WHERE id IN (${inList(ids.length)})`, ids)).rows;
  return new Map(rows.map(r => [r.id, effective(r)]));
}
async function setStatus(user, b) {
  const status = STATUS_LABEL[b.status] ? b.status : null;
  if (!status) throw err(400, "Choose a status.");
  const message = status === "available" ? "" : String(b.message || "").trim().slice(0, 400);
  let until = null;
  if (status !== "available" && b.until) {
    until = new Date(b.until);
    if (isNaN(until)) throw err(400, "That end time isn't a date.");
    if (until <= new Date()) throw err(400, "The end time has already passed.");
    if (until - new Date() > 400 * 86400_000) throw err(400, "Pick an end time within the next year.");
  }
  await pool.query("UPDATE users SET chat_status = $1, status_message = $2, status_until = $3, status_set_at = now() WHERE id = $4",
    [status, message, until ? until.toISOString() : null, user.id]);
  const now = (await statusOf([user.id])).get(user.id);
  publish(onlineIds(), "status", { userId: user.id, ...now });
  return now;
}

// Away messages: one automatic reply to each person who writes to me directly, per status change
async function autoReplies(threadId, sender, recipientIds) {
  if (!sender?.id || !recipientIds.length) return;
  try {
    const st = await statusOf(recipientIds.filter(id => id !== sender.id));
    for (const [rid, s] of st) {
      if (s.status === "available" || !s.message || !s.setAt) continue;
      const fresh = (await pool.query(
        "INSERT INTO auto_reply_log (user_id, sender_id, status_set_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [rid, sender.id, s.setAt])).rowCount;
      if (!fresh) continue;
      const back = s.until ? ` (until ${new Date(s.until).toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE || "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : "";
      await pool.query(`INSERT INTO message_posts (id, thread_id, author_id, body, private_to) VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), threadId, rid, `Automatic reply · ${s.label}${back}\n${s.message}`, sender.id]);
      await announce(threadId, rid, sender.id, [sender.id], { push: false });
    }
  } catch (e) { console.warn(`[Messages] automatic reply: ${e.message}`); }
}

// ---- Shifts: [start "HH:MM", hours] a pattern works on a calendar day ----------------------------
function shiftsOn(pattern, iso) {
  if (pattern === "weekdays") { const w = weekday(iso); return w >= 1 && w <= 5 ? [["07:00", 10]] : []; }
  const [kind, letter] = String(pattern).split(":");
  if (kind === "fire") return fireShift(iso) === letter ? [["07:00", 24]] : [];
  if (kind === "comms") {
    const c = commsShifts(iso), out = [];
    if (c.day === letter) out.push(["07:00", 12]);
    if (c.night === letter) out.push(["19:00", 12]);
    return out;
  }
  return [];
}
// When should this person get a "next shift" message? Now if they're working (or have no schedule).
export function nextShiftStart(pattern, now = new Date()) {
  if (!pattern) return now;
  for (let d = -1; d <= 21; d++) {
    const day = new Date(now); day.setDate(day.getDate() + d);
    const iso = localDay(day);
    for (const [hm, hours] of shiftsOn(pattern, iso)) {
      const start = new Date(`${iso}T${hm}:00`), end = new Date(start.getTime() + hours * 3600_000);
      if (start <= now && now < end) return now;
      if (start > now) return start;
    }
  }
  return now;
}

// ---- Reading ------------------------------------------------------------------------------------
// Posts a person can see in a thread: everything if they started it; otherwise the shared posts,
// their own, and anything sent privately to them.
const VISIBLE = `(t.created_by = $U OR p.private_to IS NULL OR p.author_id = $U OR p.private_to = $U)`;

async function myThreads(user, box, { notices = false } = {}) {
  const r = await pool.query(
    `SELECT t.*, r.deliver_at, r.read_at, r.seen_post, r.archived, r.via, r.cleared_at, u.full_name AS creator_name
       FROM message_recipients r JOIN message_threads t ON t.id = r.thread_id JOIN users u ON u.id = t.created_by
      WHERE r.user_id = $1 AND r.deliver_at <= now()
        AND ${box === "sent" ? "t.created_by = $1" : box === "archived" ? "r.archived" : box === "all" ? "true" : "NOT r.archived"}
        ${notices ? "AND t.kind = 'notice' AND t.created_by <> $1" : ""}
        AND EXISTS (SELECT 1 FROM message_posts lp WHERE lp.thread_id = t.id AND (r.cleared_at IS NULL OR lp.created_at > r.cleared_at))
      ORDER BY GREATEST(t.created_at, COALESCE((SELECT max(created_at) FROM message_posts mp WHERE mp.thread_id = t.id), t.created_at)) DESC
      LIMIT 300`, [user.id]);
  if (!r.rows.length) return [];
  const ids = r.rows.map(x => x.id);
  const posts = (await pool.query(
    `SELECT p.thread_id, p.author_id, p.body, p.created_at, a.full_name AS author
       FROM message_posts p JOIN message_threads t ON t.id = p.thread_id JOIN users a ON a.id = p.author_id
       JOIN message_recipients mr ON mr.thread_id = p.thread_id AND mr.user_id = $1
      WHERE p.thread_id IN (${inList(ids.length, 2)}) AND ${VISIBLE.replace(/\$U/g, "$1")}
        AND (mr.cleared_at IS NULL OR p.created_at > mr.cleared_at)
      ORDER BY p.created_at`, [user.id, ...ids])).rows;
  const partners = await chatPartners(user, r.rows.filter(t => t.kind === "chat").map(t => t.id));
  const counts = new Map((await pool.query(
    `SELECT thread_id, count(*)::int AS total, count(read_at)::int AS read, count(*) FILTER (WHERE deliver_at > now())::int AS waiting
       FROM message_recipients WHERE thread_id IN (${inList(ids.length)}) AND user_id <> (SELECT created_by FROM message_threads WHERE id = thread_id)
      GROUP BY thread_id`, ids)).rows.map(x => [x.thread_id, x]));
  const out = [];
  for (const t of r.rows) {
    const list = posts.filter(p => p.thread_id === t.id);
    const last = list[list.length - 1];
    // Inbox: things sent to me, and conversations I started once someone else has written
    if (!list.length) continue;
    if (box === "inbox" && t.created_by === user.id && !list.some(p => p.author_id !== user.id)) continue;
    const unread = list.some(p => p.author_id !== user.id && (!t.seen_post || p.created_at > t.seen_post));
    const c = counts.get(t.id);
    out.push({
      id: t.id, subject: t.subject, important: t.important, broadcast: t.broadcast, to: t.to_label, timing: t.timing,
      from: t.creator_name, mine: t.created_by === user.id, via: t.via, createdAt: t.created_at, unread, archived: t.archived,
      kind: t.kind, ...(t.kind === "chat" ? { with: partners.get(t.id) || null } : {}),
      last: last ? { author: last.author, mine: last.author_id === user.id, at: last.created_at, text: last.body.slice(0, 160) } : null,
      replies: Math.max(0, list.length - 1),
      ...(t.created_by === user.id && c ? { recipients: c.total, readBy: c.read, waiting: c.waiting } : {}),
    });
  }
  // Newest activity first
  return out.sort((a, b) => new Date(b.last?.at || b.createdAt) - new Date(a.last?.at || a.createdAt));
}

// The other person in each one-to-one chat: { id, name, online }
async function chatPartners(user, threadIds) {
  if (!threadIds.length) return new Map();
  const rows = (await pool.query(
    `SELECT r.thread_id, u.id, u.full_name AS name FROM message_recipients r JOIN users u ON u.id = r.user_id
      WHERE r.thread_id IN (${inList(threadIds.length, 2)}) AND r.user_id <> $1`, [user.id, ...threadIds])).rows;
  const st = await statusOf(rows.map(x => x.id));
  return new Map(rows.map(x => [x.thread_id, { id: x.id, name: x.name, online: isOnline(x.id), ...statusFields(st.get(x.id)) }]));
}

const statusFields = s => s ? { status: s.status, statusLabel: s.label, statusMessage: s.message, statusUntil: s.until } : { status: "available", statusLabel: "Available", statusMessage: "", statusUntil: null };

async function openThread(user, id) {
  const t = (await pool.query(
    `SELECT t.*, u.full_name AS creator_name, r.deliver_at, r.archived, r.cleared_at
       FROM message_threads t JOIN users u ON u.id = t.created_by
       LEFT JOIN message_recipients r ON r.thread_id = t.id AND r.user_id = $2
      WHERE t.id = $1`, [id, user.id])).rows[0];
  if (!t || (t.created_by !== user.id && (!t.deliver_at || new Date(t.deliver_at) > new Date()))) throw err(404, "That message wasn't found.");
  const posts = (await pool.query(
    `SELECT p.id, p.author_id, p.body, p.created_at, p.private_to, a.full_name AS author, pt.full_name AS private_to_name
       FROM message_posts p JOIN message_threads t ON t.id = p.thread_id JOIN users a ON a.id = p.author_id
       LEFT JOIN users pt ON pt.id = p.private_to
      WHERE p.thread_id = $1 AND ${VISIBLE.replace(/\$U/g, "$2")} AND ($3::timestamptz IS NULL OR p.created_at > $3)
      ORDER BY p.created_at`, [id, user.id, t.cleared_at])).rows;
  if (!posts.length) throw err(404, "That message wasn't found.");
  const people = (await pool.query(
    `SELECT r.user_id, u.full_name AS name, r.via, r.deliver_at, r.read_at FROM message_recipients r JOIN users u ON u.id = r.user_id
      WHERE r.thread_id = $1 ORDER BY u.full_name`, [id])).rows;
  // Mark it read
  const newest = posts.length ? posts[posts.length - 1].created_at : new Date();
  await pool.query("UPDATE message_recipients SET read_at = now(), seen_post = GREATEST(COALESCE(seen_post, $3), $3) WHERE thread_id = $1 AND user_id = $2", [id, user.id, newest]);
  const mine = t.created_by === user.id;
  return {
    id: t.id, subject: t.subject, important: t.important, broadcast: t.broadcast, timing: t.timing, to: t.to_label,
    from: t.creator_name, fromId: t.created_by, mine, createdAt: t.created_at, archived: !!t.archived, kind: t.kind,
    ...(t.kind === "chat" ? { with: (await chatPartners(user, [t.id])).get(t.id) || null } : {}),
    posts: posts.map(p => ({ id: p.id, author: p.author, authorId: p.author_id, mine: p.author_id === user.id, body: p.body, at: p.created_at,
      privateTo: p.private_to ? p.private_to_name : null })),
    // Broadcasts don't list everyone to members; conversations show who's in them
    participants: t.broadcast && !mine ? [] : people.filter(p => p.user_id !== t.created_by).map(p => ({ id: p.user_id, name: p.name })),
    receipts: mine ? people.filter(p => p.user_id !== user.id).map(p => ({ name: p.name, via: p.via, deliverAt: p.deliver_at, readAt: p.read_at, waiting: new Date(p.deliver_at) > new Date() })) : null,
    canReply: true,
    replyNote: t.broadcast && !mine ? `Replies go only to ${t.creator_name}.` : "",
  };
}

export async function messageSummary(user, opts = {}) {
  const inbox = await myThreads(user, "inbox", opts);
  const unread = inbox.filter(t => t.unread);
  return { unread: unread.length, important: unread.filter(t => t.important).length,
    latest: unread.slice(0, 5).map(t => ({ id: t.id, subject: t.subject, from: t.last?.author || t.from, important: t.important, at: t.last?.at || t.createdAt })),
    importantUnread: unread.filter(t => t.important).slice(0, 5).map(t => ({ id: t.id, subject: t.subject, from: t.from, at: t.last?.at || t.createdAt, text: t.last?.text || "" })) };
}

// ---- Sending ------------------------------------------------------------------------------------
export async function send(user, b) {
  const subject = String(b.subject || "").trim().slice(0, 200);
  const body = String(b.body || "").trim().slice(0, 10000);
  if (!body) throw err(400, "Write a message.");
  // toSelf: a system notice to the person who set something up (e.g. Leave picks with nobody else to tell); not offered in the UI
  let userIds = [...new Set((Array.isArray(b.users) ? b.users : []).filter(isUuid))].filter(id => b.toSelf === true || id !== user.id);
  // My lists: the sender's own saved lists of people (same as picking those people)
  const listIds = [...new Set((Array.isArray(b.lists) ? b.lists : []).filter(isUuid))];
  const listLabels = [], fromList = new Map();
  for (const lid of listIds) {
    const l = (await pool.query("SELECT name FROM message_lists WHERE id = $1 AND owner_id = $2", [lid, user.id])).rows[0];
    if (!l) throw err(400, "One of those lists wasn't found.");
    listLabels.push(l.name);
    for (const r of (await pool.query("SELECT user_id FROM message_list_members WHERE list_id = $1", [lid])).rows) {
      if (r.user_id !== user.id && !fromList.has(r.user_id)) fromList.set(r.user_id, l.name);
    }
  }
  const groupIds = [...new Set((Array.isArray(b.groups) ? b.groups : []).filter(isUuid))];
  const everyone = b.everyone === true;
  if (!userIds.length && !groupIds.length && !everyone && !fromList.size) throw err(400, "Choose who it's for.");
  if ((groupIds.length || everyone) && !(await hasAccess(pool, user, "messages", "edit"))) {
    throw err(403, "Sending to groups or to everyone needs permission (User Management > Permissions > Messages).");
  }
  const people = await activePeople(pool);
  const byId = new Map(people.map(p => [p.id, p]));
  const via = new Map();     // user id -> where they came from
  const labels = [];
  if (everyone) { for (const p of people) if (!via.has(p.id)) via.set(p.id, "Everyone"); labels.push("Everyone"); }
  for (const gid of groupIds) {
    const g = await groupMembers(pool, gid);
    if (!g) throw err(400, "One of those groups no longer exists.");
    for (const id of g.ids) if (!via.has(id)) via.set(id, g.name);
    labels.push(g.name);
  }
  for (const [id, name] of fromList) if (byId.has(id) && !via.has(id)) via.set(id, name);
  labels.push(...listLabels);
  for (const id of userIds) {
    if (!byId.has(id)) throw err(400, "One of those people isn't an active account.");
    via.set(id, "Direct");
    labels.push(byId.get(id).name);
  }
  if (b.toSelf !== true) via.delete(user.id);
  if (!via.size) throw err(400, "Nobody's in that group right now.");
  const timing = b.timing === "next_shift" ? "next_shift" : "now";
  // Groups / everyone always send replies back to the sender only; with people and lists the sender chooses
  const broadcast = groupIds.length > 0 || everyone || (b.privateReplies === true && via.size > 1);
  const id = crypto.randomUUID(), now = new Date();
  // Messages people write come through the Messages screens (kind "message"); everything else that calls send() is a system notice
  const kind = b.kind === "message" ? "message" : "notice";
  await tx(async c => {
    await c.query(`INSERT INTO message_threads (id, subject, created_by, broadcast, important, timing, to_label, kind) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, subject || body.split("\n")[0].slice(0, 80), user.id, broadcast, b.important === true, timing, labels.join(", ").slice(0, 500), kind]);
    await c.query(`INSERT INTO message_posts (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), id, user.id, body]);
    await c.query(`INSERT INTO message_recipients (thread_id, user_id, deliver_at, read_at, seen_post, via) VALUES ($1, $2, now(), now(), now(), 'Sender')`, [id, user.id]);
    for (const [uid, from] of via) {
      const at = timing === "next_shift" ? nextShiftStart(byId.get(uid)?.pattern || "", now) : now;
      // toSelf: the sender's own row becomes an unread delivery
      await c.query(`INSERT INTO message_recipients (thread_id, user_id, deliver_at, via) VALUES ($1, $2, $3, $4)
        ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = NULL, seen_post = NULL, via = EXCLUDED.via`, [id, uid, at.toISOString(), from]);
    }
    if (groupIds.length || everyone) {
      const { ROLE_LABEL } = await import("./collections.js");
      await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Messages', 'Sent a group message', $4)`,
        [user.id, user.name, ROLE_LABEL[user.role] || user.role, `To ${labels.join(", ")} (${via.size} people${timing === "next_shift" ? ", at their next shift" : ""}): ${subject || body.slice(0, 80)}`]);
    }
  });
  const waiting = timing === "next_shift" ? [...via.keys()].filter(uid => nextShiftStart(byId.get(uid)?.pattern || "", now) > now).length : 0;
  await announce(id, user.id);
  if (timing === "now" && kind === "message") await autoReplies(id, user, [...via].filter(([, from]) => from === "Direct").map(([uid]) => uid));
  return { id, recipients: via.size, waiting };
}

async function reply(user, id, b) {
  const body = String(b.body || "").trim().slice(0, 10000);
  if (!body) throw err(400, "Write a reply.");
  const t = (await pool.query(
    `SELECT t.*, r.deliver_at FROM message_threads t LEFT JOIN message_recipients r ON r.thread_id = t.id AND r.user_id = $2 WHERE t.id = $1`, [id, user.id])).rows[0];
  if (!t || (t.created_by !== user.id && (!t.deliver_at || new Date(t.deliver_at) > new Date()))) throw err(404, "That message wasn't found.");
  if (t.kind === "chat" && !b.noRedirect) {
    const other = (await pool.query("SELECT user_id FROM message_recipients WHERE thread_id = $1 AND user_id <> $2", [id, user.id])).rows;
    if (other.length === 1) { const r = await redirectChat(user, other[0].user_id, body); if (r) return { ...r, id }; }
  }
  const privateTo = t.broadcast && t.created_by !== user.id ? t.created_by : null;
  await pool.query(`INSERT INTO message_posts (id, thread_id, author_id, body, private_to) VALUES ($1, $2, $3, $4, $5)`, [crypto.randomUUID(), id, user.id, body, privateTo]);
  // A new reply brings the conversation back out of the archive for whoever can see it
  if (privateTo) await pool.query("UPDATE message_recipients SET archived = false WHERE thread_id = $1 AND user_id = $2", [id, privateTo]);
  else await pool.query("UPDATE message_recipients SET archived = false WHERE thread_id = $1 AND user_id <> $2", [id, user.id]);
  await pool.query("UPDATE message_recipients SET seen_post = now(), read_at = now() WHERE thread_id = $1 AND user_id = $2", [id, user.id]);
  await announce(id, user.id, privateTo);
  // Away messages go to whoever wrote, from the people this reply reaches (small conversations only)
  const reached = privateTo ? [privateTo]
    : t.broadcast ? [] : (await pool.query("SELECT user_id FROM message_recipients WHERE thread_id = $1 AND user_id <> $2 AND deliver_at <= now()", [id, user.id])).rows.map(r => r.user_id);
  if (reached.length && reached.length <= 10) await autoReplies(id, user, reached);
  return { ok: true };
}

// A chat to someone who's Busy / Do not disturb / Out of office goes to their Messages inbox instead.
// Everything sent while they're away collects in one conversation per status change.
async function redirectChat(user, otherId, body) {
  const s = (await statusOf([otherId])).get(otherId);
  if (!s || s.status === "available") return null;
  const other = (await pool.query("SELECT full_name FROM users WHERE id = $1", [otherId])).rows[0];
  const subject = `Chat from ${user.name} (while you were ${s.label === "Out of office" ? "out of office" : s.label === "Busy" ? "busy" : "on Do not disturb"})`;
  const existing = (await pool.query(
    `SELECT t.id FROM message_threads t
      WHERE t.kind = 'message' AND t.created_by = $1 AND t.subject = $2 AND t.created_at >= $4
        AND EXISTS (SELECT 1 FROM message_recipients r WHERE r.thread_id = t.id AND r.user_id = $3)
        AND (SELECT count(*) FROM message_recipients r WHERE r.thread_id = t.id) = 2
      ORDER BY t.created_at DESC LIMIT 1`, [user.id, subject, otherId, s.setAt])).rows[0]?.id;
  let messageId = existing;
  if (existing) {
    await pool.query("UPDATE message_recipients SET archived = false WHERE thread_id = $1", [existing]);
    await reply(user, existing, { body });
  } else {
    messageId = (await send(user, { users: [otherId], subject, body })).id;
  }
  return { redirected: true, messageId, to: other?.full_name || "", status: s.status, label: s.label, awayMessage: s.message, until: s.until };
}

// ---- Live notices ------------------------------------------------------------------------------
// Tell everyone who can see the newest post (and has it delivered) that it's there.
async function announce(threadId, authorId, privateTo = null, only = null, { push = true } = {}) {
  try {
    const t = (await pool.query(
      `SELECT t.id, t.subject, t.important, t.kind, t.created_by, a.full_name AS author, p.body
         FROM message_threads t JOIN message_posts p ON p.thread_id = t.id JOIN users a ON a.id = p.author_id
        WHERE t.id = $1 ORDER BY p.created_at DESC LIMIT 1`, [threadId])).rows[0];
    if (!t) return;
    let ids = (await pool.query("SELECT user_id FROM message_recipients WHERE thread_id = $1 AND deliver_at <= now()", [threadId])).rows.map(r => r.user_id);
    if (privateTo) ids = ids.filter(id => id === privateTo || id === authorId || id === t.created_by);
    if (only) ids = ids.filter(id => only.includes(id));
    const base = { threadId, subject: t.subject, from: t.author, preview: t.body.slice(0, 140), important: t.important, kind: t.kind };
    for (const id of ids) publish([id], "message", { ...base, mine: id === authorId });
    // Phones and tablets (and computers that turned on push): not to the author, and while someone
    // isn't Available only important messages come through
    const others = ids.filter(id => id !== authorId);
    if (!push || !others.length) return;
    const st = await statusOf(others);
    const payload = {
      title: `${t.important ? "IMPORTANT · " : ""}${t.author || brand().app}`,
      body: t.kind === "chat" ? t.body.slice(0, 180) : [t.subject, t.body.slice(0, 160)].filter(Boolean).join("\n"),
      url: `/?${t.kind === "chat" ? "chat" : "thread"}=${threadId}`, tag: threadId, important: !!t.important, kind: t.kind,
    };
    await Promise.all(others.filter(id => t.important || (st.get(id)?.status || "available") === "available").map(id => sendToUser(id, payload)));
  } catch (e) { console.warn(`[Messages] live notice: ${e.message}`); }
}

// "At their next shift" messages: tell each person when theirs arrives
let lastDelivery = new Date();
export function startDeliveries() {
  setInterval(async () => {
    const now = new Date();
    try {
      const due = (await pool.query(
        `SELECT thread_id, user_id FROM message_recipients WHERE deliver_at > $1 AND deliver_at <= $2 AND read_at IS NULL`,
        [lastDelivery.toISOString(), now.toISOString()])).rows;
      lastDelivery = now;
      const byThread = new Map();
      for (const d of due) { if (!byThread.has(d.thread_id)) byThread.set(d.thread_id, []); byThread.get(d.thread_id).push(d.user_id); }
      for (const [tid, users] of byThread) await announce(tid, null, null, users);
    } catch (e) { console.warn(`[Messages] deliveries: ${e.message}`); }
  }, 20_000).unref();
}

// ---- Delete, archive, mark read (one or many) ----------------------------------------------
// Delete hides the conversation for this person up to now. When everyone in it has deleted it,
// and nobody is still waiting to get it, it's removed for good.
async function act(user, ids, action) {
  ids = [...new Set((Array.isArray(ids) ? ids : []).filter(isUuid))].slice(0, 500);
  if (!ids.length) throw err(400, "Choose at least one message.");
  const list = inList(ids.length, 2);
  if (action === "archive" || action === "unarchive") {
    await pool.query(`UPDATE message_recipients SET archived = $1 WHERE user_id = $2 AND thread_id IN (${inList(ids.length, 3)})`,
      [action === "archive", user.id, ...ids]);
  } else if (action === "read") {
    await pool.query(`UPDATE message_recipients SET read_at = now(), seen_post = now() WHERE user_id = $1 AND deliver_at <= now() AND thread_id IN (${list})`, [user.id, ...ids]);
  } else if (action === "unread") {
    await pool.query(`UPDATE message_recipients SET seen_post = NULL WHERE user_id = $1 AND thread_id IN (${list})`, [user.id, ...ids]);
  } else if (action === "delete") {
    await tx(async c => {
      await c.query(`UPDATE message_recipients SET cleared_at = now(), archived = false, read_at = now(), seen_post = now()
                      WHERE user_id = $1 AND thread_id IN (${list})`, [user.id, ...ids]);
      await c.query(
        `DELETE FROM message_threads t WHERE t.id IN (${list})
           AND EXISTS (SELECT 1 FROM message_recipients r WHERE r.thread_id = t.id AND r.user_id = $1)
           AND NOT EXISTS (SELECT 1 FROM message_recipients r WHERE r.thread_id = t.id
                 AND (r.cleared_at IS NULL OR r.cleared_at < (SELECT max(created_at) FROM message_posts p WHERE p.thread_id = t.id)))`,
        [user.id, ...ids]);
    });
  } else throw err(400, "Unknown action.");
  publish([user.id], "changed", { ids, action });     // other tabs refresh
  return { ok: true, count: ids.length };
}

// ---- Chat: one conversation per pair of people -------------------------------------------------
async function findChat(user, otherId) {
  return (await pool.query(
    `SELECT t.id FROM message_threads t
      WHERE t.kind = 'chat'
        AND EXISTS (SELECT 1 FROM message_recipients r WHERE r.thread_id = t.id AND r.user_id = $1)
        AND EXISTS (SELECT 1 FROM message_recipients r WHERE r.thread_id = t.id AND r.user_id = $2)
        AND (SELECT count(*) FROM message_recipients r WHERE r.thread_id = t.id) = 2
      ORDER BY t.created_at LIMIT 1`, [user.id, otherId])).rows[0]?.id || null;
}
async function chat(user, b) {
  const otherId = b.userId;
  if (!isUuid(otherId) || otherId === user.id) throw err(400, "Choose who to chat with.");
  const other = (await activePeople(pool)).find(p => p.id === otherId);
  if (!other) throw err(400, "That person isn't an active account.");
  const body = String(b.body || "").trim().slice(0, 10000);
  if (!body) throw err(400, "Write a message.");
  const existing = await findChat(user, otherId);
  const redirected = await redirectChat(user, otherId, body);
  if (redirected) return { ...redirected, id: existing };
  if (existing) {
    // Bring it back for both if either had archived it
    await pool.query("UPDATE message_recipients SET archived = false WHERE thread_id = $1", [existing]);
    await reply(user, existing, { body });
    return { id: existing };
  }
  const id = crypto.randomUUID();
  await tx(async c => {
    await c.query(`INSERT INTO message_threads (id, subject, created_by, kind, to_label) VALUES ($1, 'Chat', $2, 'chat', $3)`, [id, user.id, other.name]);
    await c.query(`INSERT INTO message_posts (id, thread_id, author_id, body) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), id, user.id, body]);
    await c.query(`INSERT INTO message_recipients (thread_id, user_id, read_at, seen_post, via) VALUES ($1, $2, now(), now(), 'Sender')`, [id, user.id]);
    await c.query(`INSERT INTO message_recipients (thread_id, user_id, via) VALUES ($1, $2, 'Chat')`, [id, otherId]);
  });
  await announce(id, user.id);
  return { id };
}

export async function handleMessages(req, res, parts, user, send_, jsonBody) {
  const a = parts[2];
  if (req.method === "GET" && !a) {
    const box = ["inbox", "sent", "archived"].includes(new URL(req.url, "http://x").searchParams.get("box")) ? new URL(req.url, "http://x").searchParams.get("box") : "inbox";
    return send_(res, 200, { threads: await myThreads(user, box), canBroadcast: await hasAccess(pool, user, "messages", "edit") });
  }
  if (req.method === "GET" && a === "status") return send_(res, 200, (await statusOf([user.id])).get(user.id));
  if (req.method === "POST" && a === "status") return send_(res, 200, await setStatus(user, await jsonBody(req)));
  if (req.method === "GET" && a === "summary") return send_(res, 200, await messageSummary(user));
  if (req.method === "GET" && a === "recent") {
    // The chat window's list: every conversation, newest activity first (archived ones too)
    const all = await myThreads(user, "all");
    return send_(res, 200, { threads: all.slice(0, 40) });
  }
  if (req.method === "GET" && a === "chat" && isUuid(parts[3])) return send_(res, 200, { id: await findChat(user, parts[3]) });
  if (req.method === "POST" && a === "chat") return send_(res, 200, await chat(user, await jsonBody(req)));
  if (req.method === "POST" && a === "bulk") { const b = await jsonBody(req); return send_(res, 200, await act(user, b.ids, b.action)); }
  if (req.method === "GET" && a === "people") {
    const list = (await activePeople(pool)).filter(p => p.id !== user.id);
    const st = await statusOf(list.map(p => p.id));
    const people = list.map(p => ({ id: p.id, name: p.name, division: p.division, title: p.title || "", online: isOnline(p.id), ...statusFields(st.get(p.id)) }));
    const canBroadcast = await hasAccess(pool, user, "messages", "edit");
    let groups = [];
    if (canBroadcast) {
      groups = (await allGroupMembers(pool)).map(g => ({ id: g.id, name: g.name, isDefault: g.isDefault, count: g.ids.length }));
    }
    return send_(res, 200, { people, groups, canBroadcast, everyoneCount: people.length, lists: await myLists(user) });
  }
  if (a === "lists") return handleLists(req, res, parts, user, send_, jsonBody);
  if (req.method === "GET" && isUuid(a)) return send_(res, 200, await openThread(user, a));
  if (req.method === "POST" && !a) return send_(res, 200, await send(user, { ...(await jsonBody(req)), kind: "message" }));
  if (req.method === "POST" && isUuid(a) && parts[3] === "reply") return send_(res, 200, await reply(user, a, await jsonBody(req)));
  if (req.method === "POST" && isUuid(a) && parts[3] === "archive") {
    const b = await jsonBody(req);
    return send_(res, 200, await act(user, [a], b.archived === false ? "unarchive" : "archive"));
  }
  if (req.method === "POST" && isUuid(a) && parts[3] === "delete") return send_(res, 200, await act(user, [a], "delete"));
  throw err(404, "Not found");
}

// ---- My lists: each person's own lists of people (private to them) ---------------------------
async function myLists(user) {
  const lists = (await pool.query("SELECT id, name FROM message_lists WHERE owner_id = $1 ORDER BY lower(name)", [user.id])).rows;
  const members = (await pool.query(
    `SELECT m.list_id, m.user_id FROM message_list_members m JOIN message_lists l ON l.id = m.list_id
       JOIN users u ON u.id = m.user_id WHERE l.owner_id = $1 AND u.active`, [user.id])).rows;
  return lists.map(l => ({ id: l.id, name: l.name, members: members.filter(m => m.list_id === l.id).map(m => m.user_id) }));
}
async function handleLists(req, res, parts, user, send_, jsonBody) {
  if (req.method === "GET") return send_(res, 200, { lists: await myLists(user) });
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  if (isUuid(parts[3]) && parts[4] === "remove") {
    await pool.query("DELETE FROM message_lists WHERE id = $1 AND owner_id = $2", [parts[3], user.id]);
    return send_(res, 200, { ok: true });
  }
  const name = String(b.name || "").trim().slice(0, 80);
  if (!name) throw err(400, "Give the list a name.");
  const members = [...new Set((Array.isArray(b.members) ? b.members : []).filter(isUuid))].filter(id => id !== user.id).slice(0, 500);
  let id = isUuid(b.id) ? b.id : null;
  if (id && !(await pool.query("SELECT 1 FROM message_lists WHERE id = $1 AND owner_id = $2", [id, user.id])).rowCount) throw err(404, "That list wasn't found.");
  try {
    await tx(async c => {
      if (id) await c.query("UPDATE message_lists SET name = $2, updated_at = now() WHERE id = $1", [id, name]);
      else { id = crypto.randomUUID(); await c.query("INSERT INTO message_lists (id, owner_id, name) VALUES ($1, $2, $3)", [id, user.id, name]); }
      await c.query("DELETE FROM message_list_members WHERE list_id = $1", [id]);
      for (const m of members) await c.query("INSERT INTO message_list_members (list_id, user_id) SELECT $1, id FROM users WHERE id = $2 AND active ON CONFLICT DO NOTHING", [id, m]);
    });
  } catch (e) {
    if (e.code === "23505") throw err(409, `You already have a list called ${name}.`);
    throw e;
  }
  return send_(res, 200, { ok: true, id, lists: await myLists(user) });
}

// ---- Notifications (core): system notices only, read-only. Every install has these, with or without the Messaging module. ----
//   GET  /api/notices            ?box=inbox|archived   newest first
//   GET  /api/notices/summary    same shape as /api/messages/summary (Your Day, MessageCenter)
//   GET  /api/notices/:id        one notice (marks it read)
//   POST /api/notices/read-all | /api/notices/bulk {ids, action: read|unread|archive|unarchive|delete}
export async function handleNotices(req, res, parts, user, send_, jsonBody) {
  const a = parts[2];
  if (req.method === "GET" && !a) {
    const box = new URL(req.url, "http://x").searchParams.get("box") === "archived" ? "archived" : "inbox";
    return send_(res, 200, { threads: await myThreads(user, box, { notices: true }) });
  }
  if (req.method === "GET" && a === "summary") return send_(res, 200, await messageSummary(user, { notices: true }));
  if (req.method === "GET" && isUuid(a)) {
    const k = (await pool.query("SELECT kind FROM message_threads WHERE id = $1", [a])).rows[0];
    if (!k || k.kind !== "notice") throw err(404, "That notification wasn't found.");
    return send_(res, 200, { ...(await openThread(user, a)), canReply: false, replyNote: "" });
  }
  if (req.method === "POST" && a === "read-all") {
    const ids = (await myThreads(user, "inbox", { notices: true })).filter(t => t.unread).map(t => t.id);
    return send_(res, 200, ids.length ? await act(user, ids, "read") : { ok: true });
  }
  if (req.method === "POST" && a === "bulk") {
    const b = await jsonBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isUuid);
    const ok = ids.length ? (await pool.query(`SELECT id FROM message_threads WHERE kind = 'notice' AND id IN (${inList(ids.length)})`, ids)).rows.map(r => r.id) : [];
    return send_(res, 200, await act(user, ok, b.action));
  }
  throw err(404, "Not found");
}
