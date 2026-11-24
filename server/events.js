// Live updates (/api/events): one Server-Sent Events stream per open browser tab.
// The server pushes a small notice when something arrives (a message, a reply); the page then
// fetches what it needs through the normal API. Also tells who is online (has Nexus open).
//
// The stream re-checks the sign-in every minute and closes when the session has ended.
// LIVE_EVENTS=off turns it off (pages then fall back to checking every 30 seconds).
import { pool } from "./db.js";

export const LIVE = String(process.env.LIVE_EVENTS || "on").toLowerCase() !== "off";
const IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 60);
const subs = new Map();            // user id -> Set of { res, hash }

export function isOnline(userId) { return subs.has(userId); }
export function onlineIds() { return [...subs.keys()]; }

export function publish(userIds, type, data = {}) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(userIds)) {
    for (const s of subs.get(id) || []) { try { s.res.write(line); } catch { /* closed */ } }
  }
}

function drop(userId, s) {
  const set = subs.get(userId);
  if (!set) return;
  set.delete(s);
  if (!set.size) subs.delete(userId);
}

export function handleEvents(req, res, user) {
  if (!LIVE) { res.writeHead(204); return res.end(); }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`retry: 5000\nevent: hello\ndata: {}\n\n`);
  const s = { res, hash: user.sessionHash };
  if (!subs.has(user.id)) subs.set(user.id, new Set());
  subs.get(user.id).add(s);
  let ticks = 0;
  const beat = setInterval(async () => {
    try { res.write(": ping\n\n"); } catch { return close(); }
    if (++ticks % 3) return;                          // every ~75 s: is the session still good?
    try {
      const ok = (await pool.query(
        `SELECT 1 FROM sessions WHERE token_hash = $1 AND expires_at > now()
            AND ($2 <= 0 OR now() - last_seen_at <= make_interval(mins => $2))`, [s.hash, IDLE_MINUTES])).rowCount;
      if (!ok) { res.write("event: signedout\ndata: {}\n\n"); close(); }
    } catch { /* database blip: try again next time */ }
  }, 25_000);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true; clearInterval(beat); drop(user.id, s);
    try { res.end(); } catch { /* already gone */ }
  }
  req.on("close", close);
  res.on("error", close);
}
