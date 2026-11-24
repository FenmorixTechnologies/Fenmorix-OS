// Sick leave tracker (/api/sick/*): each division logs its people's sick call-outs; Nexus totals the hours and looks
// for habitual patterns (around holidays, on certain weekdays, next to scheduled leave) and gives each person a risk
// score for coming shifts they're scheduled to work.
//
// Permission section "sick" (divisions): view = entries, hours and patterns for those divisions; edit = log and correct
// call-outs and set the shift (work pattern) of people in those divisions whose shift isn't set up yet; manage = settings. No medical details are kept. Protected leave (FMLA, on-duty injury, approved medical
// accommodation) is listed and totaled but never counted in pattern analysis or risk.
//
// Risk model (explainable on purpose):
//   occurrence = a run of call-outs on back-to-back scheduled shifts (counted once)
//   base rate  r = (occurrences + a) / (scheduled shifts + B), shrunk toward the department rate r0 with B = 30 shifts (a = r0·B)
//   lift for a context (holiday window, weekday, next to scheduled leave)
//              = (occurrences in that context + k) / (r × shifts in that context + k), k = 1.5 (small samples stay near 1)
//   chance on a coming shift p = 1 − exp(−r × product of the lifts that apply), lifts capped at 8 total, p ≤ 0.95
//   score (0–10) = 10 × (1 − exp(−p / 0.15)):  p 5% → 2.8, 10% → 4.9, 20% → 7.4, 35% → 9.0, 45% → 9.5
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess, accessScope, clearAccessCache } from "./access.js";
import { worksOn as worksOnPattern, addDays, weekday, dayNum } from "../src/shifts.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const txt = (v, n) => String(v ?? "").trim().slice(0, n);
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, "0");
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };

export const KINDS = {
  sick: { label: "Sick (self)", protected: false },
  family: { label: "Sick family member", protected: false },
  fmla: { label: "FMLA (protected)", protected: true },
  injury: { label: "On-duty injury / workers' comp (protected)", protected: true },
  accommodation: { label: "Approved medical accommodation (protected)", protected: true },
};
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Schedule by division: Suppression = 24-hour shifts (fire A/B/C rotation), Communications = 12-hour shifts (comms A–D
// rotation), everyone else = 8 hours, Monday–Friday. The shift letter comes from the person's work pattern
// (User Management). A work pattern of a different kind set on purpose (e.g. a weekday chief in Suppression) wins.
export const SCHEDULE_KINDS = {
  fire: { label: "24-hour shifts", hours: 24, perDay: 1 / 3 },
  comms: { label: "12-hour shifts", hours: 12, perDay: 1 / 2 },
  weekdays: { label: "8-hour days, Mon–Fri", hours: 8, perDay: 5 / 7 },
};
export const divisionKind = division => (/suppression/i.test(division || "") ? "fire" : /communication|dispatch/i.test(division || "") ? "comms" : "weekdays");
export function scheduleOf(p) {
  const div = divisionKind(p.division), pat = p.pattern || "";
  const patKind = /^fire:[A-C]$/.test(pat) ? "fire" : /^comms:[A-D]$/.test(pat) ? "comms" : pat === "weekdays" ? "weekdays" : "";
  const kind = patKind || div;
  const pattern = patKind ? pat : kind === "weekdays" ? "weekdays" : null;   // null = 24/12-hour person with no shift letter yet
  const letter = pattern && pattern.includes(":") ? pattern.split(":")[1] : "";
  const label = kind === "fire" ? (letter ? `${letter} shift, 24 hours` : "24-hour shifts (shift not set)")
    : kind === "comms" ? (letter ? `${letter} crew, 12 hours` : "12-hour shifts (crew not set)") : "8-hour days, Mon–Fri";
  return { kind, pattern, hours: SCHEDULE_KINDS[kind].hours, label, missing: !pattern, override: !!patKind && patKind !== div, divisionKind: div };
}
// Shifts an editor may set (same list as src/shifts.js WORK_PATTERNS)
const SHIFT_RE = /^(|weekdays|fire:[ABC]|comms:[ABCD])$/;
const SHIFT_NAMES = { "": "not set", weekdays: "Weekdays (Mon–Fri)", "fire:A": "A shift", "fire:B": "B shift", "fire:C": "C shift",
  "comms:A": "Comms A crew", "comms:B": "Comms B crew", "comms:C": "Comms C crew", "comms:D": "Comms D crew" };
// No schedule known: every day counts as possible (only used for logging ranges)
const worksOn = (pattern, d) => worksOnPattern(pattern || "", d);

// ---- Holidays -----------------------------------------------------------------------------------
function easter(y) {      // Anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
const nth = (y, month, dow, n) => { let d = `${y}-${pad(month)}-01`; while (weekday(d) !== dow) d = addDays(d, 1); return addDays(d, 7 * (n - 1)); };
const lastDow = (y, month, dow) => { let d = addDays(month === 12 ? `${y + 1}-01-01` : `${y}-${pad(month + 1)}-01`, -1); while (weekday(d) !== dow) d = addDays(d, -1); return d; };
export function defaultHolidays(y) {
  const e = easter(y), thanks = nth(y, 11, 4, 4);
  return [
    [`${y}-01-01`, "New Year's Day"], [nth(y, 1, 1, 3), "Martin Luther King Jr. Day"], [nth(y, 2, 0, 2), "Super Bowl Sunday"],
    [addDays(e, -47), "Mardi Gras"], [addDays(e, -2), "Good Friday"], [e, "Easter"], [lastDow(y, 5, 1), "Memorial Day"],
    [`${y}-07-04`, "Independence Day"], [nth(y, 9, 1, 1), "Labor Day"], [`${y}-10-31`, "Halloween"], [thanks, "Thanksgiving"],
    [addDays(thanks, 1), "Day after Thanksgiving"], [`${y}-12-24`, "Christmas Eve"], [`${y}-12-25`, "Christmas Day"], [`${y}-12-31`, "New Year's Eve"],
  ].map(([day, label]) => ({ day, label }));
}
function holidaysFor(settings, fromY, toY) {
  const off = new Set(settings.removed || []);
  const out = [];
  for (let y = fromY; y <= toY; y++) for (const h of defaultHolidays(y)) if (!off.has(h.label)) out.push(h);
  for (const h of settings.extra || []) if (isDay(h.day) && +h.day.slice(0, 4) >= fromY && +h.day.slice(0, 4) <= toY) out.push({ day: h.day, label: h.label || "Holiday", custom: true });
  return out.sort((a, b) => a.day.localeCompare(b.day));
}
// day -> label of a holiday on/next to it (the window is the holiday and the day before and after)
function holidayWindow(holidays, span) {
  const m = new Map();
  for (const h of holidays) for (let k = -span; k <= span; k++) { const d = addDays(h.day, k); if (!m.has(d) || k === 0) m.set(d, k === 0 ? h.label : `${k < 0 ? "day before" : "day after"} ${h.label}`); }
  return m;
}

// ---- Settings ----------------------------------------------------------------------------------------
const DEFAULTS = { lookbackMonths: 24, windowDays: 1, alertScore: 7, removed: [], extra: [] };
async function getSettings() {
  const d = (await pool.query("SELECT data FROM sick_settings")).rows[0]?.data || {};
  return { ...DEFAULTS, ...d, lookbackMonths: Math.min(60, Math.max(6, Number(d.lookbackMonths) || 24)), windowDays: [0, 1, 2].includes(d.windowDays) ? d.windowDays : 1,
    alertScore: Math.min(10, Math.max(1, Number(d.alertScore) || 7)) };
}

// ---- Access ------------------------------------------------------------------------------------------
async function scopeOf(user, level) {
  if (user.role === "master") return { all: true, divisions: new Set() };
  return accessScope(pool, user.id, "sick", level);
}
const inScope = (scope, division) => scope.all || scope.divisions.has(division);

async function people(scope) {
  const rows = (await pool.query(`SELECT u.id, u.full_name AS name, d.name AS division, COALESCE(u.work_pattern, '') AS pattern, COALESCE(u.job_title, '') AS title
      FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows;
  return rows.filter(p => inScope(scope, p.division));
}

// ---- Analysis ------------------------------------------------------------------------------------------
// Everything needed for a set of people: entries, scheduled leave (Leave Picks), holidays
async function loadData(ids, from, to) {
  const list = ids.join(",");
  const entries = ids.length ? (await pool.query(`SELECT id, user_id, division, day::text AS day, hours::float AS hours, kind, protected, note_on_file,
      to_char(called_at, 'YYYY-MM-DD HH24:MI') AS called_at, notes, entered_by_name, created_at FROM sick_entries
      WHERE user_id::text = ANY(string_to_array($1, ',')) AND day BETWEEN $2 AND $3 ORDER BY day`, [list, from, to])).rows : [];
  let leave = [];
  try {
    leave = ids.length ? (await pool.query(`SELECT user_id, day::text AS day FROM leave_pick_days WHERE user_id IS NOT NULL
      AND user_id::text = ANY(string_to_array($1, ',')) AND day BETWEEN $2 AND $3`, [list, from, addDays(to, 400)])).rows : [];
  } catch { leave = []; }
  return { entries, leave };
}

function analyzePerson(p, ctx) {
  const { from, today, entries, leaveDays, holWin, r0 } = ctx;
  const mine = entries.filter(e => e.user_id === p.id);
  const counted = mine.filter(e => !e.protected);
  const sc = scheduleOf(p);
  // Scheduled shifts in the window (not counting their own scheduled leave). Shift not set: patterns can't be judged,
  // so only the rate is estimated (a third of days for 24-hour people, half for 12-hour).
  const sched = [];
  if (!sc.missing) for (let d = from; d <= today; d = addDays(d, 1)) if (worksOn(sc.pattern, d) && !leaveDays.has(d)) sched.push(d);
  const shiftCount = sc.missing ? Math.round((dayNum(today) - dayNum(from) + 1) * SCHEDULE_KINDS[sc.kind].perDay) : sched.length;
  const schedIdx = new Map(sched.map((d, i) => [d, i]));
  // Occurrences: call-outs on back-to-back scheduled shifts count once
  const occ = [];
  for (const e of counted) {
    const i = schedIdx.has(e.day) ? schedIdx.get(e.day) : null, last = occ[occ.length - 1];
    const prevI = last ? last.lastIdx : null;
    const together = last && ((i !== null && prevI !== null && i - prevI === 1) || dayNum(e.day) - dayNum(last.lastDay) === 1);
    if (together) { last.days.push(e.day); last.lastDay = e.day; last.lastIdx = i ?? last.lastIdx; last.hours += e.hours; }
    else occ.push({ start: e.day, days: [e.day], lastDay: e.day, lastIdx: i, hours: e.hours });
  }
  const S = occ.length, D = counted.length;
  const B = 30, r = (S + r0 * B) / (shiftCount + B);
  const adj = sc.missing ? new Set() : leaveAdjacent(sc.pattern, leaveDays);
  const nextToLeave = d => adj.has(d);
  const k = 1.5;
  const lift = (n, shifts) => (n + k) / (r * shifts + k);
  // Holidays
  const holShifts = sched.filter(d => holWin.has(d)).length, holOcc = occ.filter(o => holWin.has(o.start));
  // Weekdays
  const dow = DOW.map((name, i) => { const sh = sched.filter(d => weekday(d) === i).length, n = occ.filter(o => weekday(o.start) === i).length; return { name, shifts: sh, n, lift: sh ? lift(n, sh) : 1 }; });
  // Next to their own scheduled leave
  const leaveShifts = sched.filter(nextToLeave).length, leaveOcc = occ.filter(o => nextToLeave(o.start));
  const lifts = { holiday: lift(holOcc.length, holShifts), leave: lift(leaveOcc.length, leaveShifts) };
  // Same holiday in more than one year
  const byHoliday = new Map();
  for (const o of holOcc) { const lab = holWin.get(o.start).replace(/^day (before|after) /, ""); if (!byHoliday.has(lab)) byHoliday.set(lab, new Set()); byHoliday.get(lab).add(o.start.slice(0, 4)); }
  const repeatHolidays = [...byHoliday].filter(([, ys]) => ys.size > 1).map(([label, ys]) => ({ label, years: [...ys].sort() }));
  // Plain-language patterns (only with enough to go on)
  const patterns = [];
  const expected = x => r * x;
  if (holOcc.length >= 2 && lifts.holiday >= 1.75) patterns.push({ key: "holiday", strength: lifts.holiday,
    text: `${holOcc.length} of ${S} call-outs were on or next to a holiday (about ${r1(expected(holShifts))} expected from their usual rate): ${r1(lifts.holiday)}× their normal rate.` });
  for (const x of dow) if (x.n >= 3 && x.lift >= 1.75 && x.n / Math.max(1, S) >= 0.3) patterns.push({ key: `dow${x.name}`, strength: x.lift,
    text: `${x.n} of ${S} call-outs started on a ${x.name} (about ${r1(expected(x.shifts))} expected): ${r1(x.lift)}× their normal rate.` });
  if (leaveOcc.length >= 2 && lifts.leave >= 1.75) patterns.push({ key: "leave", strength: lifts.leave,
    text: `${leaveOcc.length} of ${S} call-outs were right before or after their own scheduled leave (about ${r1(expected(leaveShifts))} expected): ${r1(lifts.leave)}× their normal rate.` });
  for (const h of repeatHolidays) patterns.push({ key: `rep${h.label}`, strength: 2, text: `Called out around ${h.label} in ${h.years.join(" and ")}.` });
  if (sc.missing) patterns.splice(0);                      // can't judge patterns without their shift
  const year = today.slice(0, 4);
  return {
    id: p.id, name: p.name, division: p.division, pattern: sc.pattern || "", title: p.title,
    schedule: { kind: sc.kind, label: sc.label, hours: sc.hours, missing: sc.missing, override: sc.override, divisionKind: sc.divisionKind },
    entries: mine, occurrences: occ.map(o => ({ start: o.start, days: o.days.length, hours: o.hours, context: holWin.get(o.start) || (nextToLeave(o.start) ? "next to scheduled leave" : "") })),
    shifts: shiftCount, S, D, bradford: S * S * D, rate: r,
    hoursYear: mine.filter(e => e.day.startsWith(year)).reduce((a, e) => a + e.hours, 0),
    hoursWindow: mine.reduce((a, e) => a + e.hours, 0), protectedHours: mine.filter(e => e.protected).reduce((a, e) => a + e.hours, 0),
    lifts, dow, patterns: patterns.sort((a, b) => b.strength - a.strength), nextToLeave,
  };
}
// The scheduled shifts right before and right after each block of their own scheduled leave
function leaveAdjacent(pattern, leaveDays) {
  const out = new Set();
  for (const l of leaveDays) {
    for (const dir of [-1, 1]) {
      for (let i = 1; i <= 7; i++) {
        const d = addDays(l, dir * i);
        if (leaveDays.has(d)) break;                       // still the same block
        if (worksOn(pattern, d)) { out.add(d); break; }
      }
    }
  }
  return out;
}
const scoreOf = p => r1(10 * (1 - Math.exp(-p / 0.15)));
function riskOn(a, d, holWin) {
  const why = [];
  let L = 1;
  if (holWin.has(d) && a.lifts.holiday > 1.05) { L *= a.lifts.holiday; why.push(`${holWin.get(d)} (${r1(a.lifts.holiday)}×)`); }
  const w = a.dow[weekday(d)];
  if (w.lift >= 1.3 && w.n >= 3) { L *= w.lift; why.push(`${w.name} (${r1(w.lift)}×)`); }
  if (a.nextToLeave(d) && a.lifts.leave > 1.05) { L *= a.lifts.leave; why.push(`next to their scheduled leave (${r1(a.lifts.leave)}×)`); }
  L = Math.min(8, L);
  const p = Math.min(0.95, 1 - Math.exp(-a.rate * L));
  return { day: d, p: r2(p), score: scoreOf(p), why };
}

async function analysis(user, { personId, horizon = 60 } = {}) {
  const s = await getSettings();
  const scope = await scopeOf(user, "view");
  let list = await people(scope);
  if (personId) list = list.filter(p => p.id === personId);
  const today = localToday();
  const from = addDays(today, -Math.round(s.lookbackMonths * 30.44));
  const { entries, leave } = await loadData(list.map(p => p.id), from, today);
  const holidays = holidaysFor(s, +from.slice(0, 4), +today.slice(0, 4) + 1);
  const holWin = holidayWindow(holidays, s.windowDays);
  const leaveBy = new Map();
  for (const l of leave) { if (!leaveBy.has(l.user_id)) leaveBy.set(l.user_id, new Set()); leaveBy.get(l.user_id).add(l.day); }
  // Department rate (everyone in Nexus, so a small division isn't judged on a handful of people)
  const dept = await deptRate(from, today);
  const out = list.map(p => analyzePerson(p, { from, today, entries, leaveDays: leaveBy.get(p.id) || new Set(), holWin, r0: dept.rate }));
  const future = [];
  for (let i = 1; i <= horizon; i++) future.push(addDays(today, i));
  for (const a of out) {
    const leaveDays = leaveBy.get(a.id) || new Set();
    a.forecast = a.schedule.missing ? [] : future.filter(d => worksOn(a.pattern, d) && !leaveDays.has(d)).map(d => riskOn(a, d, holWin));
    a.peak = a.forecast.reduce((m, f) => (f.score > (m?.score ?? -1) ? f : m), null);
    delete a.nextToLeave;
  }
  return { settings: s, today, from, holidays: holidays.filter(h => h.day >= addDays(today, -365)), dept, people: out, typicalScore: scoreOf(1 - Math.exp(-dept.rate)) };
}
// Department-wide occurrences per scheduled shift (protected leave left out)
let deptCache = { at: 0 };
async function deptRate(from, today) {
  if (Date.now() - deptCache.at < 60_000 && deptCache.from === from) return deptCache.value;
  const ppl = (await pool.query(`SELECT u.id, COALESCE(u.work_pattern, '') AS pattern, d.name AS division FROM users u LEFT JOIN divisions d ON d.id = u.division_id
    WHERE u.active AND u.account_status = 'approved'`)).rows.map(p => ({ ...p, sc: scheduleOf(p) }));
  const ents = (await pool.query(`SELECT user_id, day::text AS day FROM sick_entries WHERE NOT protected AND day BETWEEN $1 AND $2 ORDER BY user_id, day`, [from, today])).rows;
  let shifts = 0, occ = 0;
  for (const p of ppl) {
    if (p.sc.missing) { shifts += Math.round((dayNum(today) - dayNum(from) + 1) * SCHEDULE_KINDS[p.sc.kind].perDay); continue; }
    for (let d = from; d <= today; d = addDays(d, 1)) if (worksOn(p.sc.pattern, d)) shifts++;
  }
  let prev = null;
  for (const e of ents) { if (!prev || prev.user_id !== e.user_id || dayNum(e.day) - dayNum(prev.day) > 3) occ++; prev = e; }
  const value = { rate: shifts ? Math.max(0.002, occ / shifts) : 0.02, occurrences: occ, shifts, people: ppl.length };
  deptCache = { at: Date.now(), from, value };
  return value;
}

// ---- Routes ----------------------------------------------------------------------------------------------
async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Sick leave', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, txt(detail, 500)]);
}
const entryOut = e => ({ id: e.id, userId: e.user_id, division: e.division, day: e.day, hours: e.hours, kind: e.kind, protected: e.protected,
  noteOnFile: e.note_on_file, calledAt: e.called_at, notes: e.notes, enteredBy: e.entered_by_name });
const pretty = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export async function handleSick(req, res, parts, user, send, jsonBody, url) {
  const view = await scopeOf(user, "view");
  if (!view.all && !view.divisions.size) throw err(403, "Sick leave needs the Sick leave permission (User Management > Permissions).");
  const edit = await scopeOf(user, "edit");
  const manage = await hasAccess(pool, user, "sick", "manage");
  const what = parts[2];

  if (req.method === "GET" && !what) {
    const s = await getSettings();
    const y = +localToday().slice(0, 4);
    const ppl = await people(view);
    return send(res, 200, { settings: s, kinds: KINDS, access: { manage, edit: edit.all ? "all" : [...edit.divisions], view: view.all ? "all" : [...view.divisions] },
      people: ppl.map(p => { const sc = scheduleOf(p); return { ...p, pattern: sc.pattern || "", canEdit: inScope(edit, p.division), hours: sc.hours, schedule: { kind: sc.kind, label: sc.label, missing: sc.missing, override: sc.override, divisionKind: sc.divisionKind } }; }), holidays: holidaysFor(s, y - 1, y + 1),
      defaults: defaultHolidays(y).map(h => h.label) });
  }
  if (req.method === "GET" && what === "entries") {
    const q = url.searchParams;
    const from = isDay(q.get("from")) ? q.get("from") : addDays(localToday(), -365), to = isDay(q.get("to")) ? q.get("to") : addDays(localToday(), 30);
    const ppl = await people(view);
    const ids = ppl.filter(p => (!q.get("user") || p.id === q.get("user")) && (!q.get("division") || p.division === q.get("division"))).map(p => p.id);
    const { entries } = await loadData(ids, from, to);
    const name = new Map(ppl.map(p => [p.id, p.name]));
    const rows = entries.sort((a, b) => b.day.localeCompare(a.day)).map(e => ({ ...entryOut(e), name: name.get(e.user_id) }));
    if (parts[3] === "export.csv") {
      const qq = v => { const x = String(v ?? ""); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
      const lines = [["Date", "Name", "Division", "Hours", "Type", "Protected", "Doctor's note", "Called out", "Logged by", "Notes"].join(",")]
        .concat(rows.map(e => [e.day, e.name, e.division, e.hours, KINDS[e.kind]?.label || e.kind, e.protected ? "Yes" : "", e.noteOnFile ? "Yes" : "", e.calledAt || "", e.enteredBy, e.notes].map(qq).join(",")));
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="Sick-leave-${from}-to-${to}.csv"` });
      return res.end("﻿" + lines.join("\r\n") + "\r\n");
    }
    return send(res, 200, { from, to, entries: rows });
  }
  if (req.method === "GET" && what === "analysis") {
    const a = await analysis(user, { personId: isUuid(url.searchParams.get("person")) ? url.searchParams.get("person") : null, horizon: Math.min(120, Number(url.searchParams.get("days")) || 60) });
    const detail = !!url.searchParams.get("person");
    return send(res, 200, { ...a, people: a.people.map(p => detail ? { ...p, entries: p.entries.map(entryOut) } : { ...p, entries: undefined, occurrences: undefined, forecast: undefined, dow: undefined }) });
  }
  if (req.method === "GET" && what === "outlook") {
    const days = Math.min(120, Math.max(7, Number(url.searchParams.get("days")) || 30));
    const a = await analysis(user, { horizon: days });
    const min = Number(url.searchParams.get("min")) || a.settings.alertScore;
    const holiday = new Map(a.holidays.map(h => [h.day, h.label]));
    const byDay = new Map();
    for (const p of a.people) for (const f of p.forecast) {
      if (f.score < min) continue;
      if (!byDay.has(f.day)) byDay.set(f.day, []);
      byDay.get(f.day).push({ id: p.id, name: p.name, division: p.division, score: f.score, p: f.p, why: f.why });
    }
    const out = [];
    for (let i = 1; i <= days; i++) {
      const d = addDays(a.today, i), list = (byDay.get(d) || []).sort((x, y) => y.score - x.score);
      if (list.length || holiday.has(d)) out.push({ day: d, holiday: holiday.get(d) || "", people: list });
    }
    return send(res, 200, { today: a.today, min, days, dept: a.dept, typicalScore: a.typicalScore, outlook: out });
  }

  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  if (what === "entries" && !parts[3]) {
    // { userId, from, to?, hours, kind, noteOnFile, calledAt, notes }: one entry per scheduled day from..to
    const p = (await people(edit)).find(x => x.id === b.userId);
    if (!p) throw err(403, "You can only log call-outs for people in your divisions.");
    if (!isDay(b.from)) throw err(400, "Enter the day they called out.");
    const to = isDay(b.to) && b.to >= b.from ? b.to : b.from;
    if (dayNum(to) - dayNum(b.from) > 60) throw err(400, "Log up to 60 days at a time.");
    const kind = KINDS[b.kind] ? b.kind : "sick";
    const sc = scheduleOf(p);
    const hours = Number(b.hours) || sc.hours;
    if (!(hours > 0 && hours <= 24)) throw err(400, "Hours: more than 0, up to 24 per day.");
    const days = [];
    for (let d = b.from; d <= to; d = addDays(d, 1)) if (b.from === to || worksOn(sc.pattern, d)) days.push(d);
    if (!days.length) throw err(400, "They aren't scheduled on any of those days. Log the single day instead.");
    const called = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(b.calledAt || "") ? b.calledAt.replace("T", " ") : null;
    let added = 0, updated = 0;
    for (const d of days) {
      const r = await pool.query(`INSERT INTO sick_entries (id, user_id, division, day, hours, kind, protected, note_on_file, called_at, notes, entered_by, entered_by_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (user_id, day) DO UPDATE SET hours = EXCLUDED.hours, kind = EXCLUDED.kind, protected = EXCLUDED.protected, note_on_file = EXCLUDED.note_on_file,
          called_at = COALESCE(EXCLUDED.called_at, sick_entries.called_at), notes = EXCLUDED.notes, updated_at = now() RETURNING (xmax = 0) AS inserted`,
        [crypto.randomUUID(), p.id, p.division, d, hours, kind, KINDS[kind].protected, b.noteOnFile === true, called, txt(b.notes, 500), user.id, user.name]);
      if (r.rows[0].inserted) added++; else updated++;
    }
    await audit(user, "Logged a sick call-out", `${p.name}: ${days.length === 1 ? pretty(days[0]) : `${pretty(days[0])} – ${pretty(days[days.length - 1])} (${days.length} shifts)`}, ${hours} h each, ${KINDS[kind].label}`);
    return send(res, 200, { ok: true, added, updated, days });
  }
  if (what === "entries" && isUuid(parts[3])) {
    const e = (await pool.query("SELECT e.*, e.day::text AS d, u.full_name FROM sick_entries e JOIN users u ON u.id = e.user_id WHERE e.id = $1", [parts[3]])).rows[0];
    if (!e) throw err(404, "That entry wasn't found.");
    const p = (await people(edit)).find(x => x.id === e.user_id);
    if (!p && !inScope(edit, e.division)) throw err(403, "You can't change call-outs for that division.");
    if (parts[4] === "remove") {
      await pool.query("DELETE FROM sick_entries WHERE id = $1", [e.id]);
      await audit(user, "Deleted a sick call-out", `${e.full_name}: ${pretty(e.d)}, ${Number(e.hours)} h, ${KINDS[e.kind]?.label || e.kind}`);
      return send(res, 200, { ok: true });
    }
    const kind = KINDS[b.kind] ? b.kind : e.kind;
    const hours = b.hours !== undefined ? Number(b.hours) : Number(e.hours);
    if (!(hours > 0 && hours <= 24)) throw err(400, "Hours: more than 0, up to 24.");
    const day = isDay(b.day) ? b.day : e.d;
    try {
      await pool.query(`UPDATE sick_entries SET day = $2, hours = $3, kind = $4, protected = $5, note_on_file = $6, notes = $7, updated_at = now() WHERE id = $1`,
        [e.id, day, hours, kind, KINDS[kind].protected, b.noteOnFile !== undefined ? b.noteOnFile === true : e.note_on_file, b.notes !== undefined ? txt(b.notes, 500) : e.notes]);
    } catch (x) { if (x.code === "23505") throw err(409, "They already have a call-out on that day."); throw x; }
    await audit(user, "Changed a sick call-out", `${e.full_name}: ${pretty(e.d)}${day !== e.d ? ` → ${pretty(day)}` : ""}, ${hours} h, ${KINDS[kind].label}`);
    return send(res, 200, { ok: true });
  }
  if (what === "shifts") {
    // { shifts: [{ userId, pattern }] }: set the shift / crew (users.work_pattern) for people in the editor's divisions, so their
    // patterns and risk can be worked out. Same values as the person's own setting on the punch clock (they can still change it).
    const list = Array.isArray(b.shifts) ? b.shifts.slice(0, 300) : b.userId ? [{ userId: b.userId, pattern: b.pattern }] : [];
    if (!list.length) throw err(400, "Choose a shift for at least one person.");
    const mine = new Map((await people(edit)).map(p => [p.id, p]));
    const done = [];
    for (const x of list) {
      const p = mine.get(x.userId);
      if (!p) throw err(403, "You can only set shifts for people in your divisions.");
      const pat = String(x.pattern ?? "");
      if (!SHIFT_RE.test(pat)) throw err(400, "Choose a shift from the list.");
      if (pat === (p.pattern || "")) continue;
      await pool.query("UPDATE users SET work_pattern = $2 WHERE id = $1", [p.id, pat]);
      done.push(`${p.name}: ${SHIFT_NAMES[pat]}${p.pattern ? ` (was ${SHIFT_NAMES[p.pattern] || p.pattern})` : ""}`);
    }
    if (done.length) { clearAccessCache(); deptCache = { at: 0 }; await audit(user, done.length === 1 ? "Set a shift" : `Set ${done.length} shifts`, done.join("; ")); }
    return send(res, 200, { ok: true, changed: done.length });
  }
  if (what === "settings") {
    if (!manage) throw err(403, "Only Sick leave managers can change settings.");
    const cur = await getSettings();
    const next = { ...cur };
    if (b.lookbackMonths !== undefined) next.lookbackMonths = Math.min(60, Math.max(6, Math.round(Number(b.lookbackMonths)) || 24));
    if (b.windowDays !== undefined) next.windowDays = [0, 1, 2].includes(Number(b.windowDays)) ? Number(b.windowDays) : 1;
    if (b.alertScore !== undefined) next.alertScore = Math.min(10, Math.max(1, Number(b.alertScore) || 7));
    if (Array.isArray(b.removed)) next.removed = b.removed.map(x => txt(x, 60)).filter(Boolean).slice(0, 40);
    if (Array.isArray(b.extra)) next.extra = b.extra.filter(h => isDay(h.day)).map(h => ({ day: h.day, label: txt(h.label, 60) || "Holiday" })).slice(0, 100);
    await pool.query("UPDATE sick_settings SET data = $1", [next]);
    deptCache = { at: 0 };
    await audit(user, "Changed sick leave settings", `look back ${next.lookbackMonths} months, holiday window ±${next.windowDays} day(s), alert at ${next.alertScore}`);
    return send(res, 200, { ok: true, settings: next });
  }
  throw err(404, "Not found");
}
