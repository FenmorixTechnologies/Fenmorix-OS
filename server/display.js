// TV display screens ("dashboard mode"), /api/display/*. A screen is not a person and never gets a user session.
//
// Pairing: the TV opens /display and POSTs pair -> it gets its own HttpOnly cookie (sgfd_display) and a 6-character code to
// show. An accounts admin (or master) enters the code in User Management › Display screens with a name and the views to
// show; the cookie's hash moves onto display_screens and the TV starts cycling. Sign out = token_hash cleared.
//
// Screen routes (cookie only; nothing else in Nexus accepts this cookie):
//   GET  /api/display/me               {paired:false, code?} | {paired:true, name, views, seconds, switchToBoard}
//   POST /api/display/pair             new code for this TV (keeps the cookie it has)
//   GET  /api/display/view/:view       data for one view: duty | weather | calls | oncall | classes
//   GET  /api/display/boards           open incident Command Boards (when switchToBoard) [{id, version, openedAt}]
//   GET  /api/display/board/:id        one open incident board, read-only (same shape as /api/command/:id, canEdit false)
//   GET  /api/display/image/:id        the aerial picture of an open board
// Admin routes (signed-in master / accounts admin):
//   GET  /api/display/screens          list
//   POST /api/display/screens          {code, name, views, seconds, switchToBoard} pair a waiting TV
//   POST /api/display/screens/:id      {name, views, seconds, switchToBoard} edit
//   POST /api/display/screens/:id/signout | /remove
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasPerm, isUuid, ROLE_LABEL } from "./collections.js";
import { readCookie } from "./auth.js";
import { moduleOn } from "./license.js";
import { orgSettings } from "./brand.js";

export const DISPLAY_COOKIE = "sgfd_display";
// Views a screen can cycle through. Active calls show addresses, so it is never on by default.
export const VIEWS = { schedule: "Working today", duty: "On duty today", weather: "Weather", oncall: "On call today", classes: "Today's classes", calls: "Active calls", spot: "Spot prices" };
// Views offered when pairing a screen: each only when this install has its module (Aladtec's duty board: fire/EMS departments)
const VIEW_MODULE = { schedule: "timeclock", oncall: "callout", classes: "training", calls: "activecalls", spot: "spot" };
function offeredViews() {
  const fire = orgSettings().fire;
  return Object.fromEntries(Object.entries(VIEWS).filter(([k]) => (!VIEW_MODULE[k] || moduleOn(VIEW_MODULE[k])) && (k !== "duty" || fire)));
}
const boardsOffered = () => moduleOn("command");
const defaultViews = () => { const o = offeredViews(); return (o.duty ? ["duty", "weather", "oncall", "classes"] : ["schedule", "weather", "spot", "oncall", "classes"]).filter(k => o[k]).slice(0, 4); };
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O, 1/I
const MAX_AGE = 400 * 24 * 3600;                          // a TV stays paired until signed out (cookie re-sent on every /me)

const err = (status, message) => Object.assign(new Error(message), { status });
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Path=/ so the server can also let a paired screen load the app's pages (index.js serveBuilt); only display routes read it.
// (Screens paired before this kept a Path=/api/display copy; /me re-sends it with Path=/.)
const cookie = (value, maxAge, secure) => `${DISPLAY_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
export async function displayScreenFor(req) {
  const token = readCookie(req, DISPLAY_COOKIE);
  if (!token) return null;
  return (await pool.query("SELECT id FROM display_screens WHERE token_hash = $1", [sha256(token)])).rows[0] || null;
}

export function cleanSettings(x = {}) {
  const offered = offeredViews();
  const views = Array.isArray(x.views) ? [...new Set(x.views.filter(v => offered[v]))] : defaultViews();
  return { views, seconds: Math.min(120, Math.max(8, Math.round(Number(x.seconds) || 20))), switchToBoard: boardsOffered() && x.switchToBoard !== false };
}
const screenJson = s => ({ id: s.id, name: s.name, ...cleanSettings(s.settings), paired: !!s.token_hash, pairedAt: s.paired_at, lastSeenAt: s.last_seen_at,
  createdBy: s.created_by_name, userAgent: s.user_agent });

async function screenFor(req) {
  const token = readCookie(req, DISPLAY_COOKIE);
  if (!token) return { token: null, screen: null };
  const screen = (await pool.query("SELECT * FROM display_screens WHERE token_hash = $1", [sha256(token)])).rows[0] || null;
  return { token, screen };
}

async function newCode(token, ua) {
  await pool.query("DELETE FROM display_pairings WHERE expires_at < now() OR token_hash = $1", [sha256(token)]);
  for (let i = 0; i < 20; i++) {
    const code = Array.from(crypto.randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join("");
    const r = await pool.query(`INSERT INTO display_pairings (code, token_hash, expires_at, user_agent) VALUES ($1, $2, now() + interval '15 minutes', $3)
      ON CONFLICT DO NOTHING`, [code, sha256(token), ua]);
    if (r.rowCount) return code;
  }
  throw err(503, "Couldn't make a pairing code. Try again.");
}

async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Display screens', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, detail]);
}

// ---- Data for each view (only what a room full of people may see) ----
async function viewData(view) {
  if (view === "duty") {
    const { onDuty } = await import("./aladtec.js");
    const { placeJson } = await import("./directory.js");
    const d = onDuty();
    if (!d.configured) return { configured: false };
    const places = (await pool.query("SELECT * FROM directory_places WHERE kind = 'station' ORDER BY sort_order, name")).rows.map(placeJson)
      .map(({ phone, fax, extension, email, notes, ...p }) => p);
    const strip = ({ phone, startMs, stopMs, ...rest }) => rest;
    return { configured: true, updatedAt: d.updatedAt, shiftStartTime: d.shiftStartTime || "07:00", assignments: (d.assignments || []).map(strip),
      today: (d.today || []).map(strip), timeOff: [], error: d.error ? "Aladtec can't be reached right now." : "", places };
  }
  if (view === "schedule") { const { scheduleToday } = await import("./schedule.js"); return (await scheduleToday(null)) || { list: [] }; }
  if (view === "weather") { const { getWeather } = await import("./weather.js"); return getWeather(); }
  if (view === "spot") {
    const { moduleOn } = await import("./license.js");
    if (!moduleOn("spot")) return { configured: false, metals: [] };
    const { spotState, spotHistory } = await import("./spot.js");
    const st = spotState(false);
    const day = {};
    for (const m of st.metals) day[m.metal] = (await spotHistory(m.metal, "day")).points;
    return { ...st, day };
  }
  if (view === "calls") {
    const { activeCalls } = await import("./cad.js");
    const s = activeCalls();
    return { ...s, error: s.error ? "Active calls can't be reached right now." : "" };
  }
  if (view === "oncall") {
    const today = localDay(new Date());
    const r = await pool.query(`SELECT d.name AS division, e.position, e.person_name FROM callout_entries e JOIN divisions d ON d.id = e.division_id
      WHERE $1::date BETWEEN e.start_date AND e.end_date ORDER BY d.name, e.position`, [today]);
    return { day: today, entries: r.rows.map(x => ({ division: x.division, position: x.position, name: x.person_name })) };
  }
  if (view === "classes") {
    const today = localDay(new Date());
    const r = await pool.query(`SELECT room, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end", title, division
      FROM bookings WHERE day = $1::date AND status = 'approved' ORDER BY start_time, room`, [today]);
    return { day: today, classes: r.rows };
  }
  throw err(404, "Not found");
}

export async function handleDisplay(req, res, parts, user, send, jsonBody) {
  const a = parts[2], b = parts[3];

  // ---- Admin: pair, edit, sign out, remove (signed-in people only) ----
  if (a === "screens") {
    if (!user) throw err(401, "Please sign in again.");
    if (!(await hasPerm(pool, user, "accounts_admin"))) throw err(403, "Only master admins and accounts admins can set up display screens.");
    if (req.method === "GET" && !b) {
      const rows = (await pool.query("SELECT * FROM display_screens ORDER BY name")).rows;
      return send(res, 200, { screens: rows.map(screenJson), views: offeredViews(), boards: boardsOffered() });
    }
    if (req.method !== "POST") throw err(404, "Not found");
    const body = await jsonBody(req);
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (!b) {
      const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!name) throw err(400, "Give the screen a name, like “Station 61 day room”.");
      const p = (await pool.query("DELETE FROM display_pairings WHERE code = $1 AND expires_at > now() RETURNING *", [code])).rows[0];
      if (!p) throw err(404, "That code isn't waiting. Check the code on the TV (it changes every 15 minutes).");
      const id = crypto.randomUUID();
      await pool.query(`INSERT INTO display_screens (id, name, token_hash, settings, created_by_name, paired_at, user_agent) VALUES ($1, $2, $3, $4, $5, now(), $6)`,
        [id, name, p.token_hash, JSON.stringify(cleanSettings(body)), user.name, p.user_agent]);
      await audit(user, "Paired a display screen", name);
      return send(res, 200, { id });
    }
    if (!isUuid(b)) throw err(404, "Not found");
    const s = (await pool.query("SELECT * FROM display_screens WHERE id = $1", [b])).rows[0];
    if (!s) throw err(404, "That screen wasn't found.");
    if (parts[4] === "signout") {
      await pool.query("UPDATE display_screens SET token_hash = NULL WHERE id = $1", [b]);
      await audit(user, "Signed out a display screen", s.name);
      return send(res, 200, { ok: true });
    }
    if (parts[4] === "remove") {
      await pool.query("DELETE FROM display_screens WHERE id = $1", [b]);
      await audit(user, "Removed a display screen", s.name);
      return send(res, 200, { ok: true });
    }
    if (!parts[4]) {
      await pool.query("UPDATE display_screens SET name = $2, settings = $3 WHERE id = $1", [b, name || s.name, JSON.stringify(cleanSettings(body))]);
      await audit(user, "Changed a display screen", name || s.name);
      return send(res, 200, { ok: true });
    }
    throw err(404, "Not found");
  }

  // ---- The TV itself ----
  if (a === "pair" && req.method === "POST") {
    let { token, screen } = await screenFor(req);
    if (screen) return send(res, 200, { paired: true });
    if (!token) { token = crypto.randomBytes(32).toString("base64url"); res.setHeader("Set-Cookie", cookie(token, MAX_AGE, req.secure)); }
    return send(res, 200, { paired: false, code: await newCode(token, String(req.headers["user-agent"] || "").slice(0, 300)) });
  }
  const { token, screen } = await screenFor(req);
  if (a === "me" && req.method === "GET") {
    if (!screen) {
      const p = token ? (await pool.query("SELECT code FROM display_pairings WHERE token_hash = $1 AND expires_at > now()", [sha256(token)])).rows[0] : null;
      return send(res, 200, { paired: false, code: p?.code || null });
    }
    await pool.query("UPDATE display_screens SET last_seen_at = now() WHERE id = $1", [screen.id]);
    res.setHeader("Set-Cookie", cookie(token, MAX_AGE, req.secure));
    return send(res, 200, { paired: true, name: screen.name, ...cleanSettings(screen.settings), viewNames: offeredViews(), now: new Date().toISOString() });
  }
  if (!screen) throw err(401, "This screen isn't paired.");
  const set = cleanSettings(screen.settings);
  if (req.method !== "GET") throw err(404, "Not found");

  if (a === "view" && VIEWS[b]) {
    if (!set.views.includes(b)) throw err(403, "This screen doesn't show that.");
    return send(res, 200, await viewData(b));
  }
  // Command Boards: only open incident boards (never training), only for screens set to switch to them
  if (a === "boards" || a === "board" || a === "image") {
    if (!set.switchToBoard) throw err(403, "This screen doesn't show Command Boards.");
    if (a === "boards") {
      const r = await pool.query(`SELECT id, version, opened_at FROM command_boards WHERE status = 'open' AND kind = 'incident' ORDER BY opened_at DESC LIMIT 6`);
      return send(res, 200, { boards: r.rows.map(x => ({ id: x.id, version: x.version, openedAt: x.opened_at })) });
    }
    if (a === "board" && isUuid(b)) {
      const bd = (await pool.query("SELECT * FROM command_boards WHERE id = $1 AND kind = 'incident'", [b])).rows[0];
      if (!bd || bd.status !== "open") throw err(404, "That board is closed.");
      if (Number(new URL(req.url, "http://x").searchParams.get("v")) === bd.version) return send(res, 200, { same: true, version: bd.version, now: new Date().toISOString() });
      const { boardJson } = await import("./command.js");
      const events = (await pool.query("SELECT * FROM command_events WHERE board_id = $1 ORDER BY at, id", [b])).rows;
      return send(res, 200, { ...boardJson(bd, events, null), canEdit: false, display: true });
    }
    if (a === "image" && isUuid(b)) {
      const ok = (await pool.query(`SELECT 1 FROM command_boards WHERE status = 'open' AND kind = 'incident' AND state->>'imageId' = $1`, [b])).rowCount;
      if (!ok) throw err(404, "Not found");
      const im = (await pool.query("SELECT mime, data FROM sim_images WHERE id = $1", [b])).rows[0];
      if (!im) throw err(404, "Not found");
      res.writeHead(200, { "Content-Type": im.mime, "Cache-Control": "private, max-age=3600" });
      return res.end(im.data);
    }
  }
  throw err(404, "Not found");
}
