// Shift rotations and pay periods. All dates are "YYYY-MM-DD" calendar days.
//
// Fire (the floor): A, B and C work 24 hours in a 9-day cycle
//   (on, off, on, off, on, then 4 off for each shift). Oct 28, 2026 = A.
// Communications: 12-hour shifts, days 0700–1900 and nights 1900–0700.
//   Each shift works a 14-day pattern; its partner works the same pattern a
//   week later, so between them every day is covered. Every 2 weeks the pairs
//   swap days and nights. Week of Mon Nov 16, 2026: A and D on days, B and C on
//   nights (Tue 11/17 A days / B nights, Wed 11/18 D days / C nights).
// Pay periods: 14 days, Thursday through Wednesday; pay day is the
//   following Wednesday. Thu Oct 22, 2026 started a period.

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

// ---- Pay periods
const PAY_ANCHOR = dayNum("2026-10-22");
export function payPeriod(iso) {
  const start = PAY_ANCHOR + Math.floor((dayNum(iso) - PAY_ANCHOR) / 14) * 14;
  return { start: fromDayNum(start), end: fromDayNum(start + 13), payday: fromDayNum(start + 20) };
}

export const pretty = (iso, opts = { month: "short", day: "numeric" }) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", opts);

// ---- Work patterns ("hours needed per shift")
// '' = not set (count every day), 'weekdays' = Mon–Fri, 'fire:A' = A shift (24 h),
// 'comms:C' = Communications C crew (12 h, days or nights as the rotation goes).
export const WORK_PATTERNS = [
  ["", "Not set (every day)"],
  ["weekdays", "Weekdays (Mon–Fri)"],
  ["fire:A", "Fire A shift"], ["fire:B", "Fire B shift"], ["fire:C", "Fire C shift"],
  ["comms:A", "Communications A crew"], ["comms:B", "Communications B crew"],
  ["comms:C", "Communications C crew"], ["comms:D", "Communications D crew"],
];
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
