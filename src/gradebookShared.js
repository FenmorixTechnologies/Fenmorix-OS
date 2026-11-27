// Gradebook math, shared by the server (server/gradebook.js: reports, family pages) and the screens (src/Gradebook.jsx, family page).
// Never import App.jsx here: the family page bundles this file.
//
// A class's grade for a set of assignments (a grading period, or the whole year):
//   each category's percent = points earned / points possible over its counted assignments
//   counted = scored (points entered), or marked missing (counts as 0 when settings.missingZero); excused and blank don't count
//   overall = Σ weight × category % / Σ weight, over categories that have counted work (so an empty category doesn't pull the grade down);
//   if every weight is 0, overall = total earned / total possible (straight points)
//   letter = the first scale row (highest min first) whose min ≤ overall percent
export const DEFAULT_SCALE = [
  { letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 },
];
export const PLUS_MINUS_SCALE = [
  { letter: "A+", min: 97 }, { letter: "A", min: 93 }, { letter: "A-", min: 90 }, { letter: "B+", min: 87 }, { letter: "B", min: 83 }, { letter: "B-", min: 80 },
  { letter: "C+", min: 77 }, { letter: "C", min: 73 }, { letter: "C-", min: 70 }, { letter: "D+", min: 67 }, { letter: "D", min: 63 }, { letter: "D-", min: 60 },
  { letter: "F", min: 0 },
];
export const DEFAULT_CATEGORIES = [
  { id: "tests", name: "Tests", weight: 40 }, { id: "quizzes", name: "Quizzes", weight: 20 },
  { id: "homework", name: "Homework", weight: 20 }, { id: "projects", name: "Projects", weight: 20 },
];
export const DEFAULT_SETTINGS = { scale: DEFAULT_SCALE, categories: DEFAULT_CATEGORIES, missingZero: true, passing: 60, decimals: 1, schoolYear: "" };
export const STATUS = { "": "", missing: "Missing", excused: "Excused", late: "Late" };

export function cleanScale(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows.slice(0, 30) : []) {
    const letter = String(r?.letter ?? "").replace(/[\u0000-\u001f]+/g, "").trim().slice(0, 6);
    const min = Number(r?.min);
    if (!letter || !Number.isFinite(min) || min < 0 || min > 200 || out.some(o => o.letter === letter)) continue;
    out.push({ letter, min: Math.round(min * 100) / 100 });
  }
  out.sort((a, b) => b.min - a.min);
  if (!out.length) return DEFAULT_SCALE;
  if (out[out.length - 1].min > 0) out[out.length - 1] = { ...out[out.length - 1], min: 0 };   // every grade gets a letter
  return out;
}
export function cleanCategories(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows.slice(0, 20) : []) {
    const name = String(r?.name ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 40);
    if (!name || out.some(o => o.name.toLowerCase() === name.toLowerCase())) continue;
    let id = String(r?.id || "").trim().slice(0, 40) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `c${out.length + 1}`;
    if (out.some(o => o.id === id)) id = `${id}-${out.length + 1}`;
    const w = Number(r?.weight);
    out.push({ id, name, weight: Number.isFinite(w) && w >= 0 ? Math.min(1000, Math.round(w * 100) / 100) : 0 });
  }
  return out;
}
export function letterFor(pct, scale = DEFAULT_SCALE) {
  if (pct == null || !Number.isFinite(pct)) return "";
  const s = [...scale].sort((a, b) => b.min - a.min);
  return (s.find(r => pct + 1e-9 >= r.min) || s[s.length - 1] || { letter: "" }).letter;
}
export const round = (n, d = 1) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// assignments [{id, category, points}], scores {assignmentId: {points, status}} for ONE student
export function studentGrade(categories, assignments, scores, opts = {}) {
  const missingZero = opts.missingZero !== false;
  const cats = categories.length ? categories : [{ id: "", name: "All work", weight: 1 }];
  const catIds = new Set(cats.map(c => c.id));
  const by = Object.fromEntries(cats.map(c => [c.id, { id: c.id, name: c.name, weight: Number(c.weight) || 0, earned: 0, possible: 0, count: 0 }]));
  let earned = 0, possible = 0;
  for (const a of assignments) {
    const s = scores[a.id];
    const max = Number(a.points) || 0;
    if (!s || s.status === "excused" || max <= 0) continue;
    let got;
    if (s.points != null && s.points !== "" && Number.isFinite(Number(s.points))) got = Number(s.points);
    else if (s.status === "missing" && missingZero) got = 0;
    else continue;
    const cid = catIds.has(a.category) ? a.category : cats[0].id;
    by[cid].earned += got; by[cid].possible += max; by[cid].count++;
    earned += got; possible += max;
  }
  const list = cats.map(c => { const x = by[c.id]; return { ...x, pct: x.possible > 0 ? (100 * x.earned) / x.possible : null }; });
  const used = list.filter(x => x.pct != null);
  const wsum = used.reduce((t, x) => t + x.weight, 0);
  let pct = null;
  if (used.length) pct = wsum > 0 ? used.reduce((t, x) => t + x.weight * x.pct, 0) / wsum : (possible > 0 ? (100 * earned) / possible : null);
  return { pct, letter: letterFor(pct, opts.scale), categories: list, earned, possible, counted: used.reduce((t, x) => t + x.count, 0) };
}

// Assignments in a grading period: the period it was put in, else by due date inside the period's dates. periodId "" = whole year.
export function inPeriod(a, period) {
  if (!period) return true;
  if (a.periodId) return a.periodId === period.id;
  return !!a.due && a.due >= period.starts && a.due <= period.ends;
}
// The grading period a day falls in (for new assignments)
export function periodFor(day, periods) {
  return periods.find(p => day >= p.starts && day <= p.ends) || null;
}
export const studentName = s => `${s.lastName}, ${s.firstName}`;
