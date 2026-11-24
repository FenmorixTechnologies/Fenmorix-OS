// Shift rotations and pay periods. All dates are "YYYY-MM-DD" calendar days.
//
// Fire (the floor): A, B and C work 24 hours in a 9-day cycle
//   (on, off, on, off, on, then 4 off for each shift). Oct 28, 2026 = A.
// Communications: 12-hour shifts, days 0700–1900 and nights 1900–0700.
//   Each shift works a 14-day pattern; its partner works the same pattern a
//   week later, so between them every day is covered. Every 2 weeks the pairs
//   swap days and nights. Week of Mon Nov 16, 2026: A and D on days, B and C on
//   nights (Tue 11/17 A days / B nights, Wed 11/18 D days / C nights).
// Pay periods: set per organization (User Management › Organization); St. George's are 14 days, Thursday
//   through Wednesday; pay day is the following Wednesday. Thu Oct 22, 2026 started a period.

const DAY_MS = 86400000;
export const dayNum = iso => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};
export const fromDayNum = n => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso, n) => fromDayNum(dayNum(iso) + n);
const mod = (a, n) => ((a % n) + n) % n;

export function todayISO() {
  return new Date().toLocaleDateString("en-CA");   // local YYYY-MM-DD
}
export const weekday = iso => new Date(dayNum(iso) * DAY_MS).getUTCDay();   // 0 = Sunday

// ---- Fire
const FIRE_ANCHOR = dayNum("2026-10-28");
const FIRE_CYCLE = "ABABCBCAC";
export function fireShift(iso) {
  return FIRE_CYCLE[mod(dayNum(iso) - FIRE_ANCHOR, 9)];
}

// ---- Communications
// Anchor: Monday 2026-11-09, so Tue 2026-11-17 = A days / B nights and Wed-Thu 11/18-19 = D days / C nights (Michael, 11/17/2026).
const COMMS_ANCHOR = dayNum("2026-11-09");
// Mon Tue Wed Thu Fri Sat Sun | Mon Tue Wed Thu Fri Sat Sun
const COMMS_PATTERN = [1, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0];
export function commsShifts(iso) {
  const d = dayNum(iso) - COMMS_ANCHOR;
  const firstHalf = mod(d, 28) < 14;                    // D/A on days, C/B on nights; they trade every two weeks
  const dayPair = firstHalf ? ["D", "A"] : ["C", "B"];
  const nightPair = firstHalf ? ["C", "B"] : ["D", "A"];
  const on = COMMS_PATTERN[mod(d, 14)];
  return { day: on ? dayPair[0] : dayPair[1], night: on ? nightPair[0] : nightPair[1] };
}

// ---- Organization work settings (User Management › Organization): pay periods, rotations offered, workday hours.
// The page gets them in the nexus-brand meta (this file configures itself on load); the server calls configureWork().
// Defaults = St. George: 14-day periods from Thu Oct 22, 2026, paid 7 days after the period ends, 80 hours.
let WORK = { rotations: { fire: true, comms: true }, pay: { kind: "biweekly", start: "2026-10-22", payDays: 7 }, periodHours: 80, dayHours: 8, dayStart: "08:00" };
export const workSettings = () => WORK;

// ---- Pay periods
export function payPeriod(iso) {
  const { kind, start: anchorIso, payDays } = WORK.pay;
  let start, end;
  if (kind === "weekly" || kind === "biweekly") {
    const len = kind === "weekly" ? 7 : 14, anchor = dayNum(anchorIso || "2026-10-22");
    start = anchor + Math.floor((dayNum(iso) - anchor) / len) * len; end = start + len - 1;
  } else {
    const [y, m, d] = iso.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), mm = String(m).padStart(2, "0");
    if (kind === "semimonthly") { start = dayNum(`${y}-${mm}-${d <= 15 ? "01" : "16"}`); end = dayNum(`${y}-${mm}-${d <= 15 ? "15" : String(last)}`); }
    else { start = dayNum(`${y}-${mm}-01`); end = dayNum(`${y}-${mm}-${String(last)}`); }
  }
  return { start: fromDayNum(start), end: fromDayNum(end), payday: fromDayNum(end + (payDays ?? 7)) };
}
export const previousPeriod = p => payPeriod(addDays(p.start, -1));
export const nextPeriod = p => payPeriod(addDays(p.end, 1));
// Hours expected in a pay period: the set number, or workdays (Mon–Fri) × hours in a workday
export function periodHours(period) {
  if (WORK.periodHours) return WORK.periodHours;
  return workDaysBetween("weekdays", period.start, period.end) * (WORK.dayHours || 8);
}
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "14 days, Thursday through Wednesday; paid 7 days after it ends" etc.
export function describePay() {
  const { kind, start, payDays } = WORK.pay;
  const paid = payDays ? `paid ${payDays} day${payDays === 1 ? "" : "s"} after it ends` : "paid the day it ends";
  if (kind === "weekly" || kind === "biweekly") {
    const w = weekday(start || "2026-10-22");
    return `${kind === "weekly" ? "one week" : "two weeks"}, ${WEEKDAY_NAMES[w]} through ${WEEKDAY_NAMES[(w + 6) % 7]}; ${paid}`;
  }
  return kind === "semimonthly" ? `the 1st–15th and 16th–end of each month; ${paid}` : `each calendar month; ${paid}`;
}

export const pretty = (iso, opts = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);

// ---- Work patterns ("hours needed per shift")
// '' = not set (count every day), 'weekdays' = Mon–Fri, 'fire:A' = A shift (24 h),
// 'comms:C' = Communications C crew (12 h, days or nights as the rotation goes).
// Every pattern there is (names for stored values); WORK_PATTERNS = the ones this organization offers (changed in place by configureWork)
export const ALL_PATTERNS = [
  ["", "Not set (every day)"],
  ["weekdays", "Weekdays (Mon–Fri)"],
  ["fire:A", "Fire A shift"], ["fire:B", "Fire B shift"], ["fire:C", "Fire C shift"],
  ["comms:A", "Communications A crew"], ["comms:B", "Communications B crew"],
  ["comms:C", "Communications C crew"], ["comms:D", "Communications D crew"],
];
export const WORK_PATTERNS = [...ALL_PATTERNS];
export function configureWork(w) {
  if (!w || typeof w !== "object") return;
  WORK = { ...WORK, ...w, rotations: { ...WORK.rotations, ...(w.rotations || {}) }, pay: { ...WORK.pay, ...(w.pay || {}) } };
  const offered = ALL_PATTERNS.filter(([k]) => !k.startsWith("fire:") && !k.startsWith("comms:")
    || (k.startsWith("fire:") && WORK.rotations.fire) || (k.startsWith("comms:") && WORK.rotations.comms));
  WORK_PATTERNS.splice(0, WORK_PATTERNS.length, ...offered);
}
// In the browser, the page's nexus-brand meta carries this organization's settings
if (typeof document !== "undefined") {
  try { const m = document.querySelector('meta[name="nexus-brand"]'); if (m) configureWork(JSON.parse(m.content).work); } catch { /* defaults */ }
}
export function worksOn(pattern, iso) {
  if (!pattern) return true;
  if (pattern === "weekdays") { const w = weekday(iso); return w >= 1 && w <= 5; }
  const [kind, letter] = pattern.split(":");
  if (kind === "fire") return fireShift(iso) === letter;
  if (kind === "comms") { const c = commsShifts(iso); return c.day === letter || c.night === letter; }
  return true;
}
// Work days from `fromIso` through `toIso` (inclusive)
export function workDaysBetween(pattern, fromIso, toIso) {
  let n = 0;
  for (let d = dayNum(fromIso); d <= dayNum(toIso); d++) if (worksOn(pattern, fromDayNum(d))) n++;
  return n;
}
export const unitWord = (pattern, n) => {
  const w = !pattern ? "day" : pattern === "weekdays" ? "workday" : "shift";
  return n === 1 ? w : `${w}s`;
};
// Hours still needed per remaining work day/shift this period. Today counts unless the person
// already has finished time on it (so a morning check before work includes today).
export function neededPerShift({ pattern, period, today, remaining, workedToday }) {
  if (today > period.end) return { left: 0, perShift: null };
  const from = today < period.start ? period.start : (workedToday ? addDays(today, 1) : today);
  const left = from > period.end ? 0 : workDaysBetween(pattern, from, period.end);
  return { left, perShift: left > 0 ? remaining / left : null };
}
