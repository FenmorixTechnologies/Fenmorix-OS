// Who's on duty, from Aladtec (staffing/scheduling).
//
// Set in .env (credentials come from Aladtec Support: 888-749-5550, support@aladtec.com):
//   ALADTEC_BASE_URL=https://secure#.aladtec.com/<your-system>/api/v2
//   ALADTEC_CLIENT_ID=...
//   ALADTEC_CLIENT_SECRET=...
//   ALADTEC_REFRESH_MINUTES=10        (optional; how often to check)
//
// Every few minutes the server asks Aladtec who is scheduled right now
// (GET /scheduled-time/members-scheduled-now), joins schedule and position
// names (GET /schedules) and member names (GET /members), and keeps the result
// in memory. Station cards in the Directory show the people whose schedule or
// position name matches the station's "Aladtec match" text (e.g. "61").
// Aladtec allows 50 requests a minute and 2,500 a day; this uses about 150 a day.

const state = {
  token: null, tokenExpires: 0,
  schedules: [], schedulesAt: 0,
  members: new Map(), membersAt: 0,
  snapshot: { configured: false, updatedAt: null, error: "", assignments: [], schedules: [] },
};

function config() {
  const base = String(process.env.ALADTEC_BASE_URL || "").trim().replace(/\/+$/, "");
  const id = String(process.env.ALADTEC_CLIENT_ID || "").trim();
  const secret = String(process.env.ALADTEC_CLIENT_SECRET || "").trim();
  return { base, id, secret, configured: !!(base && id && secret), minutes: Math.max(30, Number(process.env.ALADTEC_REFRESH_MINUTES) || 180) };
}

// Lists come back as [ ... ] (v2) or { data: [ ... ] } (v3); accept any one array inside an object too
const listOf = j => {
  if (Array.isArray(j)) return j;
  if (Array.isArray(j?.data)) return j.data;
  const arrays = j && typeof j === "object" ? Object.values(j).filter(Array.isArray) : [];
  return arrays.length === 1 ? arrays[0] : [];
};
// IDs can arrive as numbers in one list and text in another: always compare as text
const key = v => (v === undefined || v === null ? "" : String(v));

// Every request to Aladtec is counted per day (server time). Aladtec allows 2,500 a day; this app
// stops itself well before that (ALADTEC_DAILY_CAP, default 500) so a bug can never run up a bill.
const DAILY_LIMIT = 2500;
const dayKey = () => new Date().toLocaleDateString("en-CA");
const calls = { day: dayKey(), count: 0 };
function countCall() {
  if (calls.day !== dayKey()) { calls.day = dayKey(); calls.count = 0; }
  const cap = Math.min(Math.max(10, Number(process.env.ALADTEC_DAILY_CAP) || 500), DAILY_LIMIT - 100);
  if (calls.count >= cap) throw new Error(`Paused: ${calls.count} Aladtec requests today reached this app's safety limit of ${cap}. It starts again tomorrow.`);
  calls.count++;
}
export function requestsToday() {
  if (calls.day !== dayKey()) { calls.day = dayKey(); calls.count = 0; }
  return { count: calls.count, cap: Math.min(Math.max(10, Number(process.env.ALADTEC_DAILY_CAP) || 500), DAILY_LIMIT - 100), limit: DAILY_LIMIT };
}

async function getToken(cfg) {
  if (state.token && Date.now() < state.tokenExpires - 60_000) return state.token;
  countCall();
  const res = await fetch(`${cfg.base}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: cfg.id, client_secret: cfg.secret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Aladtec sign-in failed (${res.status}). Check ALADTEC_CLIENT_ID and ALADTEC_CLIENT_SECRET.`);
  const j = await res.json();
  // API v3 answers { access_token, expires_in (seconds) }; v2 answers { token, expires (UNIX time) }
  const token = j.access_token || j.token || j.data?.access_token || j.data?.token;
  if (!token) throw new Error("Aladtec sign-in answered without a token. Check that ALADTEC_BASE_URL ends in /api/v2 or /api/v3.");
  let expires = Date.now() + 3600_000;
  if (Number(j.expires_in) > 0) expires = Date.now() + Number(j.expires_in) * 1000;
  else if (Number(j.expires) > 0) expires = Number(j.expires) > 1e12 ? Number(j.expires) : Number(j.expires) * 1000;
  state.token = token;
  state.tokenExpires = Math.min(expires, Date.now() + 24 * 3600_000);   // get a fresh one at least daily
  return state.token;
}

async function get(cfg, path, retry = true) {
  const token = await getToken(cfg);
  countCall();
  const res = await fetch(`${cfg.base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 && retry) { state.token = null; return get(cfg, path, false); }
  if (res.status === 401) throw new Error(`Aladtec ${path} answered 401 (token not accepted). Check that ALADTEC_BASE_URL is exactly what Aladtec gave you, including /api/v2 or /api/v3.`);
  if (res.status === 403) throw new Error(`Aladtec ${path} answered 403: the API profile isn't allowed to read this. Ask Aladtec Support to give the profile read access to schedules, scheduled time and members.`);
  if (res.status === 429) throw new Error("Aladtec says too many requests; it will try again later.");
  if (!res.ok) throw new Error(`Aladtec ${path} answered ${res.status}.`);
  return res.json();
}

export async function refreshOnDuty() {
  const cfg = config();
  if (!cfg.configured) { state.snapshot = { configured: false, updatedAt: null, error: "", assignments: [], schedules: [] }; return state.snapshot; }
  try {
    // Schedule and position names: once an hour
    if (!state.schedules.length || Date.now() - state.schedulesAt > 3600_000) {
      // Kept in Aladtec's own order (its "order" fields), so lists read the way Aladtec shows them
      const num = (v, i) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 1e6 + i);
      state.schedules = listOf(await get(cfg, "/schedules")).map((s, i) => ({
        id: key(s.schedule_id), name: String(s.name || ""), order: num(s.order, i),
        positions: (s.positions || []).map((p, j) => ({ id: key(p.position_id), label: String(p.label || p.name || ""), order: num(p.order, j) })),
      })).sort((a, b) => a.order - b.order);
      state.schedulesAt = Date.now();
    }
    // Member names and phones: every 6 hours (paged, 100 at a time)
    if (!state.members.size || Date.now() - state.membersAt > 6 * 3600_000) {
      const all = new Map();
      for (let offset = 0; offset < 5000; offset += 100) {
        const page = listOf(await get(cfg, `/members?limit=100&offset=${offset}`));
        // If the API ignores paging it sends everyone (or the same page) every time: stop
        const repeat = page.length > 0 && all.has(key(page[0].member_id));
        for (const m of page) all.set(key(m.member_id), { name: (`${m.first_name || ""} ${m.last_name || ""}`.trim() || String(m.formatted_name || "")).trim(), phone: m.mobile_phone || "" });
        if (page.length !== 100 || repeat) break;
      }
      state.members = all; state.membersAt = Date.now();
    }
    const now = listOf(await get(cfg, "/scheduled-time/members-scheduled-now"));
    const sched = new Map(state.schedules.map(s => [s.id, s]));
    const assignments = [];
    for (const block of now) {
      const s = sched.get(key(block.schedule_id));
      for (const p of block.positions || []) {
        const m = state.members.get(key(p.member_id));
        assignments.push({
          scheduleId: block.schedule_id, scheduleName: s?.name || `Schedule ${block.schedule_id}`,
          positionId: p.position_id, positionLabel: s?.positions.find(x => x.id === key(p.position_id))?.label || "",
          memberId: p.member_id, name: m?.name || `Member ${p.member_id}`, phone: m?.phone || "",
        });
      }
    }
    // Aladtec's order: schedule, then position, then as listed
    const rank = a => {
      const s = sched.get(key(a.scheduleId));
      const si = s ? state.schedules.indexOf(s) : 1e6;
      const p = s?.positions.find(x => x.id === key(a.positionId));
      return [si, p ? p.order : 1e6];
    };
    const ranked = assignments.map((a, i) => ({ a, r: [...rank(a), i] }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.r[2] - y.r[2]).map(x => x.a);
    assignments.splice(0, assignments.length, ...ranked);
    // The whole shift (days AND nights, partial shifts, trades) and time off: for the admin duty board.
    // Separate so a profile without time-off access still shows everything else.
    const shift = await todaysShift(cfg, sched, rank);
    state.snapshot = {
      configured: true, updatedAt: new Date().toISOString(), error: "", assignments, membersLoaded: state.members.size,
      schedules: state.schedules.map(s => ({ name: s.name, positions: s.positions.map(p => p.label) })),
      ...shift,
    };
  } catch (e) {
    console.warn(`[Aladtec] ${e.message}`);
    state.snapshot = { ...state.snapshot, configured: true, error: e.message };
  }
  return state.snapshot;
}

// Who's on "right now" is worked out from today's schedule each time someone looks, so a
// 12:00-16:00 partial shift shows at the right times even though Aladtec is only checked every few hours.
function live(s) {
  if (!Array.isArray(s.today) || !s.today.length) return s;
  const now = Date.now();
  const today = s.today.map(a => ({ ...a, onNow: a.startMs <= now && now < a.stopMs }));
  const assignments = today.filter(a => a.onNow).map(a => ({
    scheduleId: a.scheduleId, scheduleName: a.scheduleName, positionId: a.positionId, positionLabel: a.positionLabel,
    memberId: a.memberId, name: a.name, phone: state.members.get(key(a.memberId))?.phone || "",
  }));
  return { ...s, today, assignments };
}
export const onDuty = () => live(state.snapshot);

// ---- Today's shift -----------------------------------------------------------------------
// Shifts run from ALADTEC_SHIFT_START (07:00) to the same time the next day. Before 07:00
// it's still yesterday's shift. Times are in Aladtec's own time zone, written YYYY-MM-DDTHH:MM.
const pad = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
function shiftWindow(now = new Date()) {
  const [h, m] = String(process.env.ALADTEC_SHIFT_START || "07:00").split(":").map(Number);
  const start = new Date(now); start.setHours(h || 0, m || 0, 0, 0);
  if (now < start) start.setDate(start.getDate() - 1);
  const stop = new Date(start); stop.setDate(stop.getDate() + 1);
  return { start, stop, splitTime: `${pad(h || 0)}:${pad(m || 0)}` };
}
// Records come keyed by date ({ "2026-11-03": [ ... ] }), wrapped in data (v3), or as
// [{ daily_split_date, time_records: [ ... ] }]; flatten any of those to one list.
function recordsOf(j) {
  const x = j && typeof j === "object" && !Array.isArray(j) && j.data !== undefined ? j.data : j;
  if (Array.isArray(x)) return x.flatMap(r => Array.isArray(r?.time_records) ? r.time_records : Array.isArray(r?.records) ? r.records : [r]);
  if (x && typeof x === "object") return Object.values(x).flatMap(v => (Array.isArray(v) ? v : []));
  return [];
}
const hhmm = v => (typeof v === "string" && v.length >= 16 ? v.slice(11, 16) : "");
const msOf = (ts, dt) => (Number(ts) > 0 ? Number(ts) * 1000 : dt ? new Date(dt).getTime() : NaN);

async function todaysShift(cfg, sched, rank) {
  const w = shiftWindow();
  const range = `range_start=${encodeURIComponent(stamp(w.start))}&range_stop=${encodeURIComponent(stamp(w.stop))}&daily_split_time=${encodeURIComponent(w.splitTime)}`;
  const out = { shiftStart: stamp(w.start), shiftStartTime: w.splitTime, today: [], timeOff: [], todayError: "", timeOffError: "" };
  const nowMs = Date.now();
  const nameOf = id => state.members.get(key(id))?.name || `Member ${id}`;
  try {
    const seen = new Set();
    for (const r of recordsOf(await get(cfg, `/scheduled-time?${range}&include_time_types=true`))) {
      const id = [key(r.member_id), key(r.schedule_id), key(r.position_id), r.start_datetime, r.stop_datetime].join("|");
      if (seen.has(id)) continue; seen.add(id);
      const s = sched.get(key(r.schedule_id));
      const startMs = msOf(r.start_timestamp, r.start_datetime), stopMs = msOf(r.stop_timestamp, r.stop_datetime);
      const timeType = String(r.time_type_name || r.time_type || "");
      out.today.push({
        scheduleId: key(r.schedule_id), scheduleName: s?.name || `Schedule ${r.schedule_id}`,
        positionId: key(r.position_id), positionLabel: s?.positions.find(x => x.id === key(r.position_id))?.label || "",
        memberId: key(r.member_id), name: nameOf(r.member_id),
        start: hhmm(r.start_datetime), stop: hhmm(r.stop_datetime), startMs, stopMs,
        onNow: startMs <= nowMs && nowMs < stopMs, timeType, trade: /trade/i.test(timeType),
      });
    }
    const ranked = out.today.map((a, i) => ({ a, r: [...rank(a), a.startMs || 0, i] }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.r[2] - y.r[2] || x.r[3] - y.r[3]).map(x => x.a);
    out.today = ranked;
  } catch (e) { out.todayError = e.message; console.warn(`[Aladtec] today's shift: ${e.message}`); }
  try {
    const seen = new Set();
    for (const r of recordsOf(await get(cfg, `/time-off?${range}`))) {
      const id = key(r.time_off_id) || [key(r.member_id), r.start_datetime].join("|");
      if (seen.has(id)) continue; seen.add(id);
      out.timeOff.push({ memberId: key(r.member_id), name: nameOf(r.member_id), type: String(r.time_off_type || r.type || ""),
        start: hhmm(r.start_datetime), stop: hhmm(r.stop_datetime), startMs: msOf(r.start_timestamp, r.start_datetime) });
    }
    out.timeOff.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
  } catch (e) { out.timeOffError = e.message; console.warn(`[Aladtec] time off: ${e.message}`); }
  return out;
}

// Does an assignment belong to a station? The station's match text is a comma-separated
// list of whole words looked for in the schedule or position name: "61, E61, M61" matches
// "Station 61", "E61 Captain" and "M61 Medic" (but "61" alone doesn't match "E61").
// In a word, ? stands for any one letter or digit and * for any number of them:
// "??61*" matches unit codes like EG613, LD618 and SQ615.
export function matchWordRegex(x) {
  const body = x.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, "[a-z0-9]").replace(/\*/g, "[a-z0-9]*");
  return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`);
}
export function matches(a, match) {
  const m = String(match || "").trim().toLowerCase();
  if (!m) return false;
  const words = `${a.scheduleName} ${a.positionLabel}`.toLowerCase();
  return m.split(",").map(x => x.trim()).filter(Boolean).some(x => matchWordRegex(x).test(words));
}

// When to check Aladtec: right after each shift change (ALADTEC_REFRESH_TIMES, default 07:00 and 19:00),
// and every ALADTEC_REFRESH_HOURS (3) counted from the first of those:
// 07:00, 10:00, 13:00, 16:00, 19:00, 22:00, 01:00, 04:00 (each one minute after, so 07:01 ...).
// Each check runs ALADTEC_REFRESH_DELAY_SECONDS (60) after the hour so Aladtec has rolled over to the new shift.
// Setting ALADTEC_REFRESH_MINUTES instead checks on a fixed interval (the old behavior).
function refreshTimes() {
  const fixed = String(process.env.ALADTEC_REFRESH_TIMES || "07:00,19:00").split(",").map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t))
    .map(t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; });
  const every = Math.max(1, Number(process.env.ALADTEC_REFRESH_HOURS) || 3) * 60;
  const anchor = fixed.length ? fixed[0] : 7 * 60;
  const all = new Set(fixed);
  for (let t = anchor % every; t < 24 * 60; t += every) all.add(t);
  return [...all].sort((a, b) => a - b);    // minutes after midnight
}
export function nextRefresh(now = new Date()) {
  const delay = Math.max(0, Number(process.env.ALADTEC_REFRESH_DELAY_SECONDS ?? 60)) * 1000;
  for (let day = 0; day < 2; day++) {
    for (const t of refreshTimes()) {
      const d = new Date(now); d.setDate(d.getDate() + day); d.setHours(Math.floor(t / 60), t % 60, 0, 0);
      const at = new Date(d.getTime() + delay);
      if (at > now) return at;
    }
  }
  return new Date(now.getTime() + 4 * 3600_000);
}

let timer = null;
export function startAladtec() {
  const cfg = config();
  if (!cfg.configured || timer) return;
  if (process.env.ALADTEC_REFRESH_MINUTES) {
    console.log(`Aladtec: checking who's on duty every ${cfg.minutes} minutes`);
    setTimeout(refreshOnDuty, 3000);
    timer = setInterval(refreshOnDuty, cfg.minutes * 60_000);
    timer.unref?.();
    return;
  }
  const label = refreshTimes().map(t => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`).join(", ");
  console.log(`Aladtec: checking at ${label} (and on "Check now")`);
  const plan = () => {
    const at = nextRefresh();
    state.nextCheckAt = at.toISOString();
    timer = setTimeout(async () => { await refreshOnDuty(); plan(); }, Math.min(at - Date.now(), 2 ** 31 - 1));
    timer.unref?.();
  };
  setTimeout(refreshOnDuty, 3000);   // once at startup
  plan();
}
export const nextCheckAt = () => state.nextCheckAt || null;
export const checkTimes = () => refreshTimes().map(t => { const m = t + Math.round(Math.max(0, Number(process.env.ALADTEC_REFRESH_DELAY_SECONDS ?? 60)) / 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
// The "Check now" button: at most once every 2 minutes, however often it's clicked
let lastManual = 0;
export async function refreshNow() {
  if (Date.now() - lastManual < 120_000) return { ...onDuty(), throttled: true };
  lastManual = Date.now();
  await refreshOnDuty();
  return onDuty();
}

// ---- One shift day's schedule (read-only), for the emergency recall board ----------------------------------
// GET /scheduled-time for the 24-hour shift starting ALADTEC_SHIFT_START on `day` (YYYY-MM-DD). Cached 5 minutes per
// day so a busy recall board costs about one request per day shown every 5 minutes. Recall sign-ups are approved in
// Aladtec; once approved they show here with their schedule and position.
const dayCache = new Map();
export async function scheduleForDay(day, { fresh = false } = {}) {
  const cfg = config();
  if (!cfg.configured) return { configured: false, records: [], error: "" };
  const hit = dayCache.get(day);
  if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.value;
  if (hit && fresh && Date.now() - hit.at < 60_000) return hit.value;     // "Check Aladtec" at most once a minute
  const [h, m] = String(process.env.ALADTEC_SHIFT_START || "07:00").split(":").map(Number);
  const start = new Date(`${day}T00:00:00`); start.setHours(h || 0, m || 0, 0, 0);
  const stop = new Date(start); stop.setDate(stop.getDate() + 1);
  const range = `range_start=${encodeURIComponent(stamp(start))}&range_stop=${encodeURIComponent(stamp(stop))}&daily_split_time=${encodeURIComponent(`${pad(h || 0)}:${pad(m || 0)}`)}`;
  let value;
  try {
    const sched = new Map(state.schedules.map(s => [s.id, s]));
    const seen = new Set(), records = [];
    for (const r of recordsOf(await get(cfg, `/scheduled-time?${range}&include_time_types=true`))) {
      const id = [key(r.member_id), key(r.schedule_id), key(r.position_id), r.start_datetime, r.stop_datetime].join("|");
      if (seen.has(id)) continue; seen.add(id);
      const s = sched.get(key(r.schedule_id));
      records.push({ memberId: key(r.member_id), name: state.members.get(key(r.member_id))?.name || `Member ${r.member_id}`,
        scheduleName: s?.name || `Schedule ${r.schedule_id}`, positionLabel: s?.positions.find(x => x.id === key(r.position_id))?.label || "",
        start: hhmm(r.start_datetime), stop: hhmm(r.stop_datetime), timeType: String(r.time_type_name || r.time_type || "") });
    }
    value = { configured: true, day, records, error: "", checkedAt: new Date().toISOString() };
  } catch (e) {
    value = { configured: true, day, records: hit?.value.records || [], error: e.message, checkedAt: new Date().toISOString() };
  }
  dayCache.set(day, { at: Date.now(), value });
  if (dayCache.size > 20) dayCache.delete(dayCache.keys().next().value);
  return value;
}
