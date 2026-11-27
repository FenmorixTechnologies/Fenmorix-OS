// Gradebook (module "gradebook", schools). Math in src/gradebookShared.js. Grades count only assignments shown to students
// (published); unpublished ones are drafts the teacher is still building.
//
// Staff (signed in; /api/gradebook):
//   GET  ``                          rights, settings, periods, the classes the viewer can see
//   GET  classes/:id                 the grid: students, assignments, scores, files, period comments            (teacher / view)
//   POST classes/:id/assignments     {id?, title, category, points, due, periodId, published, description}      (teacher / edit)
//   POST assignments/:id/remove
//   POST classes/:id/scores          {changes: [{assignmentId, studentId, points, status, comment}]}
//   POST classes/:id/categories      {categories}
//   POST classes/:id/students        {add: [studentIds], drop: [studentIds]}
//   POST classes/:id/comment         {studentId, periodId, comment}       report-card comment for the period
//   POST files {assignmentId, studentId, name, dataUrl}   GET files/:id   POST files/:id/remove     graded work (PDF / picture)
//   GET  students?q=                 find students to add (name, number, grade only)
//   POST students                    {id?, firstName, lastName, number, gradeLevel, email, active, classId?}    (manage; teachers may add new ones to their class)
//   GET  students/:id                the student's report card (view: every class; a teacher: their classes only). Logged.
//   GET  report?periodId&grade&subject  (+ report.csv)   averages and letter grades by grade level and subject   (view)
// Manage (school setup): POST settings {scale, categories, missingZero, passing, schoolYear}, POST periods {id?, name, starts, ends,
//   schoolYear}, POST periods/:id/remove, POST classes {id?, code, name, subject, gradeLevel, section, schoolYear, teacherIds, active},
//   POST import {fileName, data base64, preview}, GET family?studentId, POST family {studentId, kind student|guardian, name, email,
//   relationship}, POST family/:id/invite, POST family/:id/active {active}, POST family/:id/unlink {studentId}, POST family/invites
//   {all: true | studentIds} (links for everyone without a password), GET log?studentId (who looked).
//
// Students and parents / guardians (family accounts, cookie fx_family; /api/family, mounted before the staff sign-in check):
//   GET me | POST login {email, password} | POST logout | GET invite?token= | POST invite {token, password}
//   GET overview (each linked student: classes, period grades, comments) | GET students/:sid/classes/:cid (published work, scores,
//   comments, graded work) | GET files/:id
//
// Access: section "gradebook": view = administrators and counselors (every student, reports), edit = change grades in any class,
// manage = setup. Teachers need no grant: they see and grade the classes they're listed on. Audit module "Gradebook".
// Every staff or family look at a student's grades is written to gb_view_log (append-only), at most once an hour per viewer and student.
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { hashPassword, verifyPassword, passwordProblem, readCookie } from "./auth.js";
import { allow } from "./ratelimit.js";
import { clientIp } from "./clientip.js";
import { brand } from "./brand.js";
import { DEFAULT_SETTINGS, cleanScale, cleanCategories, studentGrade, inPeriod, letterFor, round, STATUS } from "../src/gradebookShared.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const line = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
const text = (v, n = 4000) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, n);
const sha = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const dayText = d => (d == null ? null : typeof d === "string" ? d.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
const num = v => (v == null ? null : Number(v));
const COOKIE = "fx_family", IDLE_MIN = 60, MAX_HOURS = 12, INVITE_DAYS = 14, FILE_MAX = 10 * 1024 * 1024;
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
const nameKey = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ,]+/g, " ").split(/[\s,]+/).filter(Boolean).sort().join(" ");
const publicUrl = () => String(brand().url || process.env.PUBLIC_URL || "").replace(/\/+$/, "");

// ---------------------------------------------------------------- settings, audit, log
export async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'gradebook'")).rows[0]?.value || {};
  return { ...DEFAULT_SETTINGS, ...v, scale: cleanScale(v.scale || DEFAULT_SETTINGS.scale),
    categories: v.categories ? cleanCategories(v.categories) : DEFAULT_SETTINGS.categories, missingZero: v.missingZero !== false };
}
async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Gradebook', $4, $5)`,
    [user?.id || null, user?.name || "", user ? ROLE_LABEL[user.role] || user.role || "" : "", action, line(detail, 500)]);
}
const seen = new Map();
async function logView(kind, id, name, studentId, what) {
  const k = `${kind}:${id}:${studentId}:${what}`, now = Date.now();
  if (seen.get(k) > now - 3600e3) return;
  seen.set(k, now);
  if (seen.size > 20000) for (const [x, t] of seen) if (t < now - 3600e3) seen.delete(x);
  await pool.query("INSERT INTO gb_view_log (viewer_kind, viewer_id, viewer_name, student_id, what) VALUES ($1, $2, $3, $4, $5)", [kind, id, line(name, 120), studentId, line(what, 200)]);
}

// ---------------------------------------------------------------- rights
async function rights(user) {
  const [view, edit, manage] = await Promise.all(["view", "edit", "manage"].map(l => hasAccess(pool, user, "gradebook", l)));
  const teaching = new Set((await pool.query("SELECT class_id FROM gb_class_teachers WHERE user_id = $1", [user.id])).rows.map(r => r.class_id));
  return { view, edit, manage, teaching, teacher: teaching.size > 0,
    canSee: id => view || teaching.has(id), canGrade: id => edit || teaching.has(id) };
}
async function getClass(id) {
  if (!isUuid(id)) throw err(404, "That class wasn't found.");
  const c = (await pool.query("SELECT * FROM gb_classes WHERE id = $1", [id])).rows[0];
  if (!c) throw err(404, "That class wasn't found.");
  return c;
}
const periodJson = p => ({ id: p.id, name: p.name, schoolYear: p.school_year, starts: dayText(p.starts), ends: dayText(p.ends) });
async function periods() { return (await pool.query("SELECT * FROM gb_periods ORDER BY starts, name")).rows.map(periodJson); }
const studentJson = s => ({ id: s.id, number: s.student_number, firstName: s.first_name, lastName: s.last_name, gradeLevel: s.grade_level, email: s.email, active: s.active });
const assignmentJson = a => ({ id: a.id, classId: a.class_id, title: a.title, category: a.category, points: num(a.points), due: dayText(a.due), periodId: a.period_id,
  published: a.published, description: a.description });
async function teachersOf(ids) {
  if (!ids.length) return {};
  const rows = (await pool.query(`SELECT t.class_id, u.id, u.full_name FROM gb_class_teachers t JOIN users u ON u.id = t.user_id
    WHERE t.class_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY u.full_name`, [ids.join(",")])).rows;
  const out = {};
  for (const r of rows) (out[r.class_id] ||= []).push({ id: r.id, name: r.full_name });
  return out;
}
function classJson(c, teachers, extra = {}) {
  return { id: c.id, code: c.code, name: c.name, subject: c.subject, gradeLevel: c.grade_level, section: c.section, schoolYear: c.school_year,
    categories: Array.isArray(c.categories) ? c.categories : [], active: c.active, teachers: teachers[c.id] || [], ...extra };
}

// Grades for many (class, student) pairs at once: {classId: {studentId: {year, periods: {periodId: grade}}}}
async function gradesFor(classRows, studentIds, s, ps, { publishedOnly = true } = {}) {
  if (!classRows.length || !studentIds.length) return {};
  const ids = classRows.map(c => c.id).join(",");
  const asg = (await pool.query(`SELECT * FROM gb_assignments WHERE class_id = ANY(string_to_array($1, ',')::uuid[]) ${publishedOnly ? "AND published" : ""}`, [ids])).rows.map(assignmentJson);
  const sc = (await pool.query(`SELECT s.assignment_id, s.student_id, s.points, s.status FROM gb_scores s JOIN gb_assignments a ON a.id = s.assignment_id
    WHERE a.class_id = ANY(string_to_array($1, ',')::uuid[]) AND s.student_id = ANY(string_to_array($2, ',')::uuid[])`, [ids, studentIds.join(",")])).rows;
  const scores = {};
  for (const r of sc) (scores[r.student_id] ||= {})[r.assignment_id] = { points: num(r.points), status: r.status };
  const out = {};
  for (const c of classRows) {
    const list = asg.filter(a => a.classId === c.id);
    const cats = Array.isArray(c.categories) && c.categories.length ? c.categories : s.categories;
    out[c.id] = {};
    for (const sid of studentIds) {
      const mine = scores[sid] || {};
      const g = (subset) => { const x = studentGrade(cats, subset, mine, { missingZero: s.missingZero, scale: s.scale }); return { pct: round(x.pct, s.decimals ?? 1), letter: x.letter, categories: x.categories.map(k => ({ ...k, pct: round(k.pct, 1) })) }; };
      const per = {};
      for (const p of ps) per[p.id] = g(list.filter(a => inPeriod(a, p)));
      out[c.id][sid] = { year: g(list), periods: per };
    }
  }
  return out;
}
const currentPeriod = ps => { const t = dayText(new Date()); return ps.find(p => t >= p.starts && t <= p.ends) || [...ps].reverse().find(p => p.ends < t) || ps[0] || null; };

// ---------------------------------------------------------------- the class grid
async function classState(user, r, c) {
  const s = await settings(), ps = await periods();
  const teachers = await teachersOf([c.id]);
  const students = (await pool.query(`SELECT st.* FROM gb_enrollments e JOIN gb_students st ON st.id = e.student_id
    WHERE e.class_id = $1 AND e.dropped_at IS NULL AND st.active ORDER BY lower(st.last_name), lower(st.first_name)`, [c.id])).rows.map(studentJson);
  const assignments = (await pool.query("SELECT * FROM gb_assignments WHERE class_id = $1 ORDER BY due NULLS LAST, created_at", [c.id])).rows.map(assignmentJson);
  const scores = {};
  for (const x of (await pool.query(`SELECT s.* FROM gb_scores s JOIN gb_assignments a ON a.id = s.assignment_id WHERE a.class_id = $1`, [c.id])).rows) {
    (scores[x.assignment_id] ||= {})[x.student_id] = { points: num(x.points), status: x.status, comment: x.comment, by: x.updated_by_name, at: x.updated_at, files: [] };
  }
  for (const f of (await pool.query(`SELECT f.id, f.assignment_id, f.student_id, f.name, f.mime, f.size FROM gb_score_files f JOIN gb_assignments a ON a.id = f.assignment_id
    WHERE a.class_id = $1 ORDER BY f.created_at`, [c.id])).rows) {
    const cell = ((scores[f.assignment_id] ||= {})[f.student_id] ||= { points: null, status: "", comment: "", files: [] });
    cell.files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
  }
  const comments = {};
  for (const x of (await pool.query("SELECT * FROM gb_period_comments WHERE class_id = $1", [c.id])).rows) (comments[x.period_id] ||= {})[x.student_id] = x.comment;
  return { class: classJson(c, teachers), students, assignments, scores, comments, periods: ps, current: currentPeriod(ps)?.id || "", settings: s,
    canGrade: r.canGrade(c.id), canManage: r.manage, teaches: r.teaching.has(c.id), statusLabels: STATUS };
}
async function classForGrading(user, r, id) {
  const c = await getClass(id);
  if (!r.canGrade(c.id)) throw err(403, "Only this class's teachers (or someone with Gradebook edit) can change it.");
  return c;
}

// ---------------------------------------------------------------- report card (staff and family)
async function reportCard(studentId, { classIds = null, publishedOnly = true, family = false } = {}) {
  const st = (await pool.query("SELECT * FROM gb_students WHERE id = $1", [studentId])).rows[0];
  if (!st) throw err(404, "That student wasn't found.");
  const s = await settings(), ps = await periods();
  let classes = (await pool.query(`SELECT c.* FROM gb_enrollments e JOIN gb_classes c ON c.id = e.class_id WHERE e.student_id = $1 AND e.dropped_at IS NULL AND c.active
    ORDER BY c.section, c.name`, [studentId])).rows;
  if (classIds) classes = classes.filter(c => classIds.has(c.id));
  const teachers = await teachersOf(classes.map(c => c.id));
  const grades = await gradesFor(classes, [studentId], s, ps, { publishedOnly });
  const comments = {};
  if (classes.length) for (const x of (await pool.query(`SELECT * FROM gb_period_comments WHERE student_id = $1 AND class_id = ANY(string_to_array($2, ',')::uuid[])`, [studentId, classes.map(c => c.id).join(",")])).rows) {
    (comments[x.class_id] ||= {})[x.period_id] = x.comment;
  }
  return { student: family ? { id: st.id, firstName: st.first_name, lastName: st.last_name, gradeLevel: st.grade_level } : studentJson(st),
    periods: ps, current: currentPeriod(ps)?.id || "", scale: s.scale, passing: s.passing, missingZero: s.missingZero,
    classes: classes.map(c => classJson(c, teachers, { grade: grades[c.id]?.[studentId] || null, comments: comments[c.id] || {} })) };
}
// One class for one student: the work, scores, comments and graded work
async function studentClass(studentId, c, { publishedOnly = true } = {}) {
  const s = await settings(), ps = await periods();
  const asg = (await pool.query(`SELECT * FROM gb_assignments WHERE class_id = $1 ${publishedOnly ? "AND published" : ""} ORDER BY due NULLS LAST, created_at`, [c.id])).rows.map(assignmentJson);
  const sc = {};
  for (const x of (await pool.query(`SELECT s.* FROM gb_scores s JOIN gb_assignments a ON a.id = s.assignment_id WHERE a.class_id = $1 AND s.student_id = $2`, [c.id, studentId])).rows) {
    sc[x.assignment_id] = { points: num(x.points), status: x.status, comment: x.comment, at: x.updated_at, files: [] };
  }
  for (const f of (await pool.query(`SELECT f.id, f.assignment_id, f.name, f.mime, f.size FROM gb_score_files f JOIN gb_assignments a ON a.id = f.assignment_id
    WHERE a.class_id = $1 AND f.student_id = $2 ${publishedOnly ? "AND a.published" : ""} ORDER BY f.created_at`, [c.id, studentId])).rows) {
    (sc[f.assignment_id] ||= { points: null, status: "", comment: "", files: [] }).files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
  }
  const teachers = await teachersOf([c.id]);
  const grades = await gradesFor([c], [studentId], s, ps, { publishedOnly });
  const comments = {};
  for (const x of (await pool.query("SELECT * FROM gb_period_comments WHERE class_id = $1 AND student_id = $2", [c.id, studentId])).rows) comments[x.period_id] = x.comment;
  const cats = Array.isArray(c.categories) && c.categories.length ? c.categories : s.categories;
  return { class: classJson(c, teachers, { categories: cats }), assignments: asg.map(a => ({ ...a, score: sc[a.id] || null })), grade: grades[c.id]?.[studentId] || null,
    comments, periods: ps, current: currentPeriod(ps)?.id || "", scale: s.scale, passing: s.passing, statusLabels: STATUS };
}

// ---------------------------------------------------------------- reports (administrators, counselors)
async function report(q) {
  const s = await settings(), ps = await periods();
  const period = q.periodId ? ps.find(p => p.id === q.periodId) : null;
  let classes = (await pool.query("SELECT * FROM gb_classes WHERE active ORDER BY grade_level, subject, name, section")).rows;
  if (q.grade) classes = classes.filter(c => c.grade_level.toLowerCase() === String(q.grade).toLowerCase());
  if (q.subject) classes = classes.filter(c => c.subject.toLowerCase() === String(q.subject).toLowerCase());
  const enr = classes.length ? (await pool.query(`SELECT e.class_id, e.student_id FROM gb_enrollments e JOIN gb_students st ON st.id = e.student_id
    WHERE e.dropped_at IS NULL AND st.active AND e.class_id = ANY(string_to_array($1, ',')::uuid[])`, [classes.map(c => c.id).join(",")])).rows : [];
  const roster = {};
  for (const e of enr) (roster[e.class_id] ||= []).push(e.student_id);
  const teachers = await teachersOf(classes.map(c => c.id));
  const letters = s.scale.map(x => x.letter);
  const blank = () => ({ students: 0, graded: 0, sum: 0, failing: 0, letters: Object.fromEntries(letters.map(l => [l, 0])), pcts: [] });
  const add = (agg, pct) => { agg.students++; if (pct == null) return; agg.graded++; agg.sum += pct; agg.pcts.push(pct); if (pct < (Number(s.passing) || 0)) agg.failing++; agg.letters[letterFor(pct, s.scale)]++; };
  const done = agg => { const p = agg.pcts.sort((a, b) => a - b); const med = p.length ? (p.length % 2 ? p[(p.length - 1) / 2] : (p[p.length / 2 - 1] + p[p.length / 2]) / 2) : null;
    const { pcts, sum, ...rest } = agg; return { ...rest, average: agg.graded ? round(sum / agg.graded, 1) : null, median: round(med, 1), averageLetter: agg.graded ? letterFor(sum / agg.graded, s.scale) : "" }; };
  const groups = new Map(), classRows = [];
  for (const c of classes) {
    const ids = roster[c.id] || [];
    const g = ids.length ? (await gradesFor([c], ids, s, ps))[c.id] : {};
    const agg = blank();
    for (const sid of ids) add(agg, (period ? g[sid]?.periods[period.id] : g[sid]?.year)?.pct ?? null);
    const key = `${c.grade_level}\u0000${c.subject}`;
    if (!groups.has(key)) groups.set(key, { gradeLevel: c.grade_level, subject: c.subject, classes: 0, agg: blank() });
    const grp = groups.get(key); grp.classes++;
    for (const sid of ids) add(grp.agg, (period ? g[sid]?.periods[period.id] : g[sid]?.year)?.pct ?? null);
    classRows.push({ id: c.id, name: c.name, section: c.section, subject: c.subject, gradeLevel: c.grade_level, teachers: (teachers[c.id] || []).map(t => t.name), ...done(agg) });
  }
  const gradeLevels = [...new Set((await pool.query("SELECT DISTINCT grade_level FROM gb_classes WHERE active AND grade_level <> ''")).rows.map(r => r.grade_level))].sort(gradeSort);
  const subjects = (await pool.query("SELECT DISTINCT subject FROM gb_classes WHERE active AND subject <> '' ORDER BY subject")).rows.map(r => r.subject);
  return { period: period || null, periods: ps, letters, passing: s.passing, gradeLevels, subjects,
    groups: [...groups.values()].sort((a, b) => gradeSort(a.gradeLevel, b.gradeLevel) || a.subject.localeCompare(b.subject)).map(g => ({ gradeLevel: g.gradeLevel, subject: g.subject, classes: g.classes, ...done(g.agg) })),
    classes: classRows };
}
const GRADE_ORDER = { pk: -2, prek: -2, "pre-k": -2, k: -1, kg: -1, kindergarten: -1 };
function gradeSort(a, b) {
  const v = x => { const t = String(x || "").toLowerCase().replace(/(st|nd|rd|th)( grade)?$/, "").replace(/^grade /, "").trim(); return GRADE_ORDER[t] ?? (Number.isFinite(Number(t)) ? Number(t) : 99); };
  return v(a) - v(b) || String(a).localeCompare(String(b));
}
function csvCell(v) { const t = String(v ?? ""); return /[",\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t; }

// ---------------------------------------------------------------- roster import
const HEAD = {
  code: ["class code", "section id", "section code", "course section", "class id", "course code", "section number"],
  name: ["class", "class name", "course", "course name", "course title", "class title"],
  subject: ["subject", "department", "subject area", "content area"],
  section: ["period", "block", "class period", "section"],
  teacher: ["teacher", "teacher name", "teacher email", "instructor", "instructor name", "teacher of record"],
  number: ["student id", "student number", "student #", "student no", "id", "local id", "state id"],
  student: ["student", "student name", "name"],
  first: ["first name", "student first name", "first"],
  last: ["last name", "student last name", "last"],
  grade: ["grade", "grade level", "student grade", "gr"],
  email: ["student email", "student e mail"],
  g1name: ["guardian", "guardian name", "parent", "parent name", "guardian 1", "guardian 1 name", "parent 1 name"],
  g1email: ["guardian email", "parent email", "guardian 1 email", "parent 1 email", "guardian e mail", "parent e mail"],
  g2name: ["guardian 2", "guardian 2 name", "parent 2", "parent 2 name"],
  g2email: ["guardian 2 email", "parent 2 email"],
};
const normHead = h => String(h || "").toLowerCase().replace(/[#]/g, " # ").replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim().replace(/ # /g, " #").replace(/ #$/, " #");
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
async function parseRoster(fileName, data) {
  const { readSheets } = await import("./documents.js");
  for (const sh of readSheets(fileName, Buffer.from(String(data || ""), "base64"), 20000)) {
    const rows = sh.rows.map(r => Array.from(r, v => (v == null ? "" : String(v))));
    for (let h = 0; h < Math.min(25, rows.length); h++) {
      const hd = rows[h].map(normHead);
      const col = k => hd.findIndex(x => HEAD[k].includes(x));
      const ix = Object.fromEntries(Object.keys(HEAD).map(k => [k, col(k)]));
      const hasClass = ix.code >= 0 || ix.name >= 0, hasStudent = ix.number >= 0 || ix.student >= 0 || (ix.first >= 0 && ix.last >= 0);
      if (!hasClass || !hasStudent) continue;
      const get = (r, k, n = 120) => (ix[k] >= 0 ? line(r[ix[k]], n) : "");
      const out = [];
      rows.slice(h + 1).forEach((r, i) => {
        let first = get(r, "first", 60), last = get(r, "last", 60);
        if (!first && !last && get(r, "student")) {
          const n = get(r, "student");
          if (n.includes(",")) { [last, first] = n.split(",").map(x => x.trim()); }
          else { const p = n.split(/\s+/); first = p.slice(0, -1).join(" ") || n; last = p.length > 1 ? p[p.length - 1] : ""; }
        }
        const code = get(r, "code", 60), name = get(r, "name", 120) || code, number = get(r, "number", 40);
        if (!name && !first && !last && !number) return;
        const guardians = [[get(r, "g1name"), get(r, "g1email").toLowerCase()], [get(r, "g2name"), get(r, "g2email").toLowerCase()]]
          .filter(([, e]) => e).map(([n, e]) => ({ name: n, email: e }));
        out.push({ row: h + i + 2, code, name, subject: get(r, "subject", 60), section: get(r, "section", 40), teacher: get(r, "teacher"),
          number, first, last, grade: get(r, "grade", 20), email: get(r, "email").toLowerCase(), guardians });
      });
      return out;
    }
  }
  throw err(400, "No header row with a class (Class or Class code) and a student (Student ID or Student name) was found in the first 25 rows.");
}
async function planImport(rows) {
  const s = await settings();
  const year = s.schoolYear || "";
  const problems = [];
  const users = (await pool.query("SELECT id, full_name, lower(email) AS email FROM users WHERE active AND account_status = 'approved'")).rows;
  const byEmail = new Map(users.map(u => [u.email, u])), byName = new Map();
  for (const u of users) { const k = nameKey(u.full_name); byName.set(k, byName.has(k) ? null : u); }
  const classes = (await pool.query("SELECT * FROM gb_classes WHERE school_year = $1", [year])).rows;
  const students = (await pool.query("SELECT * FROM gb_students")).rows;
  const family = (await pool.query("SELECT id, lower(email) AS email, kind FROM gb_family")).rows;
  const famByEmail = new Map(family.map(f => [f.email, f]));
  const enrolled = new Set((await pool.query("SELECT class_id || ':' || student_id AS k FROM gb_enrollments WHERE dropped_at IS NULL")).rows.map(r => r.k));
  const links = new Set((await pool.query("SELECT family_id || ':' || student_id AS k FROM gb_family_links")).rows.map(r => r.k));
  const plan = { classes: new Map(), students: new Map(), enroll: [], guardians: new Map(), teachersMissing: new Set(), rows: [] };
  const classKey = r => (r.code ? `code:${r.code.toLowerCase()}` : `name:${r.name.toLowerCase()}|${r.section.toLowerCase()}`);
  const studentKey = r => (r.number ? `n:${r.number.toLowerCase()}` : `nm:${nameKey(`${r.first} ${r.last}`)}|${r.grade.toLowerCase()}`);
  for (const r of rows) {
    if (!r.name && !r.code) { problems.push({ row: r.row, text: "No class on this row." }); continue; }
    if (!r.first && !r.last) { problems.push({ row: r.row, text: "No student name on this row." }); continue; }
    const ck = classKey(r);
    if (!plan.classes.has(ck)) {
      const have = classes.find(c => (r.code ? c.code.toLowerCase() === r.code.toLowerCase() : !c.code && c.name.toLowerCase() === r.name.toLowerCase() && c.section.toLowerCase() === r.section.toLowerCase()));
      plan.classes.set(ck, { key: ck, id: have?.id || null, code: r.code, name: have?.name || r.name, subject: r.subject || have?.subject || "", section: r.section || have?.section || "",
        gradeLevel: have?.grade_level || "", teachers: new Map(), grades: new Map() });
    }
    const cl = plan.classes.get(ck);
    if (r.grade) cl.grades.set(r.grade, (cl.grades.get(r.grade) || 0) + 1);
    if (r.teacher) {
      const t = byEmail.get(r.teacher.toLowerCase()) || byName.get(nameKey(r.teacher)) || null;
      if (t) cl.teachers.set(t.id, t.full_name); else plan.teachersMissing.add(r.teacher);
    }
    const sk = studentKey(r);
    if (!plan.students.has(sk)) {
      const have = students.find(st => (r.number ? st.student_number.toLowerCase() === r.number.toLowerCase()
        : !st.student_number && nameKey(`${st.first_name} ${st.last_name}`) === nameKey(`${r.first} ${r.last}`) && st.grade_level.toLowerCase() === r.grade.toLowerCase()));
      plan.students.set(sk, { key: sk, id: have?.id || null, number: r.number, first: r.first || have?.first_name || "", last: r.last || have?.last_name || "",
        grade: r.grade || have?.grade_level || "", email: r.email && validEmail(r.email) ? r.email : have?.email || "", guardians: [] });
    }
    const st = plan.students.get(sk);
    const pair = `${ck}|${sk}`;
    if (!plan.enroll.includes(pair)) plan.enroll.push(pair);
    for (const g of r.guardians) {
      if (!validEmail(g.email)) { problems.push({ row: r.row, text: `Guardian email "${g.email}" doesn't look right; skipped.` }); continue; }
      const f = famByEmail.get(g.email);
      if (f && f.kind !== "guardian") { problems.push({ row: r.row, text: `${g.email} is a student account, not a guardian; skipped.` }); continue; }
      if (!plan.guardians.has(g.email)) plan.guardians.set(g.email, { email: g.email, name: g.name || g.email, id: f?.id || null });
      if (!st.guardians.includes(g.email)) st.guardians.push(g.email);
    }
    plan.rows.push(r);
  }
  for (const cl of plan.classes.values()) if (!cl.gradeLevel && cl.grades.size) cl.gradeLevel = [...cl.grades.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const newEnroll = plan.enroll.filter(p => { const [ck, sk] = p.split("|"); const c = plan.classes.get(ck), st = plan.students.get(sk); return !(c.id && st.id && enrolled.has(`${c.id}:${st.id}`)); });
  let newLinks = 0;
  for (const st of plan.students.values()) for (const e of st.guardians) { const g = plan.guardians.get(e); if (!(g.id && st.id && links.has(`${g.id}:${st.id}`))) newLinks++; }
  const summary = {
    classes: { new: [...plan.classes.values()].filter(c => !c.id).length, existing: [...plan.classes.values()].filter(c => c.id).length },
    students: { new: [...plan.students.values()].filter(x => !x.id).length, existing: [...plan.students.values()].filter(x => x.id).length },
    enrollments: newEnroll.length, guardians: { new: [...plan.guardians.values()].filter(g => !g.id).length, links: newLinks },
    teachersMissing: [...plan.teachersMissing].slice(0, 50), problems: problems.slice(0, 100), rows: plan.rows.length,
    sample: [...plan.classes.values()].slice(0, 40).map(c => ({ name: c.name, code: c.code, section: c.section, subject: c.subject, gradeLevel: c.gradeLevel,
      teachers: [...c.teachers.values()], status: c.id ? "existing" : "new", students: plan.enroll.filter(p => p.startsWith(c.key + "|")).length })),
  };
  return { plan, summary, year, defaults: s.categories };
}
async function applyImport(user, { plan, year, defaults }, fileName) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const classId = new Map(), studentId = new Map(), famId = new Map();
    for (const cl of plan.classes.values()) {
      let id = cl.id;
      if (id) await c.query("UPDATE gb_classes SET subject = COALESCE(NULLIF($2, ''), subject), section = COALESCE(NULLIF($3, ''), section), grade_level = COALESCE(NULLIF($4, ''), grade_level), active = true WHERE id = $1",
        [id, cl.subject, cl.section, cl.gradeLevel]);
      else id = (await c.query(`INSERT INTO gb_classes (code, name, subject, grade_level, section, school_year, categories) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [cl.code, cl.name || cl.code, cl.subject, cl.gradeLevel, cl.section, year, JSON.stringify(defaults)])).rows[0].id;
      for (const t of cl.teachers.keys()) await c.query("INSERT INTO gb_class_teachers (class_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, t]);
      classId.set(cl.key, id);
    }
    for (const st of plan.students.values()) {
      let id = st.id;
      if (id) await c.query("UPDATE gb_students SET grade_level = COALESCE(NULLIF($2, ''), grade_level), email = COALESCE(NULLIF($3, ''), email), active = true WHERE id = $1", [id, st.grade, st.email]);
      else id = (await c.query("INSERT INTO gb_students (student_number, first_name, last_name, grade_level, email) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [st.number, st.first || "(no first name)", st.last || "", st.grade, st.email])).rows[0].id;
      studentId.set(st.key, id);
    }
    for (const p of plan.enroll) {
      const [ck, sk] = p.split("|");
      await c.query("INSERT INTO gb_enrollments (class_id, student_id) VALUES ($1, $2) ON CONFLICT (class_id, student_id) DO UPDATE SET dropped_at = NULL", [classId.get(ck), studentId.get(sk)]);
    }
    for (const g of plan.guardians.values()) {
      const id = g.id || (await c.query("INSERT INTO gb_family (kind, name, email) VALUES ('guardian', $1, $2) ON CONFLICT (lower(email)) DO UPDATE SET name = gb_family.name RETURNING id", [line(g.name, 120), g.email])).rows[0].id;
      famId.set(g.email, id);
    }
    for (const st of plan.students.values()) for (const e of st.guardians) {
      await c.query("INSERT INTO gb_family_links (family_id, student_id, relationship) VALUES ($1, $2, 'guardian') ON CONFLICT DO NOTHING", [famId.get(e), studentId.get(st.key)]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  await audit(user, "Imported class rosters", `${line(fileName, 120) || "a spreadsheet"}: ${plan.classes.size} classes, ${plan.students.size} students, ${plan.enroll.length} enrollments, ${plan.guardians.size} guardians`);
}

// ---------------------------------------------------------------- family accounts (staff side)
async function inviteFor(f) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("UPDATE gb_family SET invite_hash = $2, invite_expires = now() + make_interval(days => $3) WHERE id = $1", [f.id, sha(token), INVITE_DAYS]);
  const path = `/grades?invite=${token}`;
  const base = publicUrl(), link = base ? base + path : "";
  let emailed = false;
  const { mailConfigured, sendMail } = await import("./mail.js");
  if (mailConfigured() && link) {
    emailed = true;
    const school = brand().org;
    sendMail({ to: f.email, subject: `Your ${school} grades sign-in`,
      text: `Hello ${f.name},\n\n${school} has set up a sign-in for you to see ${f.kind === "student" ? "your" : "your student's"} grades, assignments and teacher comments.\n\nOpen this link within ${INVITE_DAYS} days to choose a password:\n\n${link}\n\nAfter that, sign in any time at ${base}/grades\n\n${school}` })
      .catch(e => console.error(`[Gradebook] invite email failed: ${e.message}`));
  }
  return { path, link, emailed, days: INVITE_DAYS };
}
async function familyFor(studentIds) {
  if (!studentIds.length) return [];
  return (await pool.query(`SELECT f.id, f.kind, f.name, f.email, f.active, f.last_login, f.password_hash IS NOT NULL AS ready, f.invite_expires, l.student_id, l.relationship
    FROM gb_family_links l JOIN gb_family f ON f.id = l.family_id WHERE l.student_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY f.kind DESC, f.name`, [studentIds.join(",")])).rows
    .map(f => ({ id: f.id, kind: f.kind, name: f.name, email: f.email, active: f.active, lastLogin: f.last_login, ready: f.ready,
      invited: !!f.invite_expires && new Date(f.invite_expires) > new Date(), studentId: f.student_id, relationship: f.relationship }));
}

// ---------------------------------------------------------------- files
const FILE_TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
function sniff(buf) {
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  return "";
}
function sendFile(res, f, download) {
  res.writeHead(200, { "Content-Type": f.mime, "Content-Length": f.data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${String(f.name).replace(/[^\w. -]+/g, "_")}"` });
  res.end(f.data);
}

// ---------------------------------------------------------------- staff routes
export async function handleGradebook(req, res, parts, user, send, jsonBody, url) {
  const r = await rights(user);
  const [, , a, id, b2] = parts;
  const q = url ? Object.fromEntries(url.searchParams) : {};
  const s = await settings();
  if (req.method === "GET") {
    if (!a) {
      const ps = await periods();
      const rows = r.view ? (await pool.query("SELECT * FROM gb_classes ORDER BY active DESC, grade_level, subject, name, section")).rows
        : r.teaching.size ? (await pool.query("SELECT * FROM gb_classes WHERE id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY active DESC, section, name", [[...r.teaching].join(",")])).rows : [];
      const teachers = await teachersOf(rows.map(c => c.id));
      const counts = rows.length ? Object.fromEntries((await pool.query(`SELECT class_id, count(*)::int AS n FROM gb_enrollments e JOIN gb_students st ON st.id = e.student_id
        WHERE e.dropped_at IS NULL AND st.active AND class_id = ANY(string_to_array($1, ',')::uuid[]) GROUP BY class_id`, [rows.map(c => c.id).join(",")])).rows.map(x => [x.class_id, x.n])) : {};
      const staff = r.manage ? (await pool.query("SELECT id, full_name AS name, job_title FROM users WHERE active AND account_status = 'approved' ORDER BY full_name")).rows : undefined;
      return send(res, 200, { canView: r.view, canEdit: r.edit, canManage: r.manage, teacher: r.teacher, settings: s, periods: ps, current: currentPeriod(ps)?.id || "",
        classes: rows.map(c => classJson(c, teachers, { students: counts[c.id] || 0, mine: r.teaching.has(c.id) })), staff,
        stats: r.view ? (await pool.query(`SELECT (SELECT count(*)::int FROM gb_students WHERE active) AS students, (SELECT count(*)::int FROM gb_family WHERE kind = 'guardian') AS guardians,
          (SELECT count(*)::int FROM gb_family WHERE password_hash IS NOT NULL) AS signed_up`)).rows[0] : undefined });
    }
    if (a === "classes" && id) {
      const c = await getClass(id);
      if (!r.canSee(c.id)) throw err(403, "Only this class's teachers, administrators and counselors can open it.");
      return send(res, 200, await classState(user, r, c));
    }
    if (a === "files" && isUuid(id)) {
      const f = (await pool.query("SELECT f.*, a.class_id FROM gb_score_files f JOIN gb_assignments a ON a.id = f.assignment_id WHERE f.id = $1", [id])).rows[0];
      if (!f || !r.canSee(f.class_id)) throw err(404, "That file wasn't found.");
      await logView("staff", user.id, user.name, f.student_id, `Opened graded work: ${f.name}`);
      return sendFile(res, f, q.download === "1");
    }
    if (a === "students" && !id) {
      if (!r.view && !r.teacher && !r.manage) throw err(403, "Only teachers, administrators and counselors can look up students.");
      const term = line(q.q, 80).toLowerCase();
      if (term.length < 2) return send(res, 200, { students: [] });
      const rows = (await pool.query(`SELECT * FROM gb_students WHERE active AND (lower(first_name || ' ' || last_name) LIKE $1 OR lower(last_name || ', ' || first_name) LIKE $1 OR lower(student_number) = $2)
        ORDER BY lower(last_name), lower(first_name) LIMIT 25`, [`%${term.replace(/[%_\\]/g, "")}%`, term])).rows;
      return send(res, 200, { students: rows.map(x => ({ id: x.id, number: x.student_number, firstName: x.first_name, lastName: x.last_name, gradeLevel: x.grade_level })) });
    }
    if (a === "students" && isUuid(id)) {
      let only = null;
      if (!r.view) {
        const mine = (await pool.query("SELECT class_id FROM gb_enrollments WHERE student_id = $1 AND dropped_at IS NULL", [id])).rows.map(x => x.class_id).filter(x => r.teaching.has(x));
        if (!mine.length) throw err(403, "You can see a student's grades for the classes you teach.");
        only = new Set(mine);
      }
      const card = await reportCard(id, { classIds: only });
      if (b2 === "classes" && isUuid(parts[5])) {
        const c = await getClass(parts[5]);
        if (only && !only.has(c.id)) throw err(403, "You can see a student's grades for the classes you teach.");
        await logView("staff", user.id, user.name, id, `Opened ${c.name}`);
        return send(res, 200, { ...(await studentClass(id, c, { publishedOnly: false })), student: card.student });
      }
      await logView("staff", user.id, user.name, id, "Opened the report card");
      const fam = r.view || r.manage ? await familyFor([id]) : [];
      return send(res, 200, { ...card, family: fam, canManage: r.manage, limited: !!only });
    }
    if (a === "report" || a === "report.csv") {
      if (!r.view) throw err(403, "Reports are for administrators and counselors (Gradebook view).");
      const rep = await report(q);
      if (a === "report") return send(res, 200, rep);
      const head = ["Grade level", "Subject", "Class", "Section", "Teachers", "Students", "Graded", "Average %", "Median %", "Average letter", "Below passing", ...rep.letters];
      const lines = [head.map(csvCell).join(",")];
      for (const c of rep.classes) lines.push([c.gradeLevel, c.subject, c.name, c.section, c.teachers.join("; "), c.students, c.graded, c.average ?? "", c.median ?? "", c.averageLetter, c.failing, ...rep.letters.map(l => c.letters[l])].map(csvCell).join(","));
      await audit(user, "Downloaded a grade report", rep.period ? rep.period.name : "Whole year");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="grade-report.csv"`, "Cache-Control": "no-store" });
      return res.end("﻿" + lines.join("\r\n"));
    }
    if (a === "family") {
      if (!r.manage && !r.view) throw err(403, "Family accounts are for administrators.");
      if (!isUuid(q.studentId)) throw err(400, "Which student?");
      return send(res, 200, { family: await familyFor([q.studentId]) });
    }
    if (a === "log") {
      if (!r.manage) throw err(403, "The access log is for Gradebook managers.");
      if (!isUuid(q.studentId)) throw err(400, "Which student?");
      const rows = (await pool.query("SELECT viewer_kind, viewer_name, what, at FROM gb_view_log WHERE student_id = $1 ORDER BY at DESC LIMIT 300", [q.studentId])).rows;
      return send(res, 200, { log: rows.map(x => ({ kind: x.viewer_kind, name: x.viewer_name, what: x.what, at: x.at })) });
    }
    if (a === "widget") {
      if (!r.teaching.size) return send(res, 200, { classes: [] });
      const rows = (await pool.query(`SELECT c.id, c.name, c.section,
        (SELECT count(*)::int FROM gb_enrollments e WHERE e.class_id = c.id AND e.dropped_at IS NULL) AS students,
        (SELECT count(*)::int FROM gb_assignments a JOIN gb_enrollments e ON e.class_id = a.class_id AND e.dropped_at IS NULL
           LEFT JOIN gb_scores s ON s.assignment_id = a.id AND s.student_id = e.student_id
           WHERE a.class_id = c.id AND a.published AND a.due <= CURRENT_DATE AND (s.assignment_id IS NULL OR (s.points IS NULL AND s.status = ''))) AS to_grade
        FROM gb_classes c WHERE c.active AND c.id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY c.section, c.name`, [[...r.teaching].join(",")])).rows;
      return send(res, 200, { classes: rows.map(x => ({ id: x.id, name: x.name, section: x.section, students: x.students, toGrade: x.to_grade })) });
    }
    throw err(404, "Not found.");
  }

  // ---- changes
  const b = await jsonBody(req, a === "files" || a === "import" ? 16 * 1024 * 1024 : undefined);
  if (a === "classes" && id && b2 === "assignments") {
    const c = await classForGrading(user, r, id);
    const title = line(b.title, 120), points = Number(b.points);
    if (!title) throw err(400, "Give the assignment a name.");
    if (!Number.isFinite(points) || points <= 0 || points > 10000) throw err(400, "Points possible must be more than 0.");
    const cats = Array.isArray(c.categories) && c.categories.length ? c.categories : s.categories;
    const category = cats.some(x => x.id === b.category) ? b.category : cats[0]?.id || "";
    const due = isDay(b.due) ? b.due : null;
    const ps = await periods();
    const periodId = ps.some(p => p.id === b.periodId) ? b.periodId : null;
    const vals = [title, category, points, due, periodId, b.published !== false, text(b.description, 2000)];
    if (b.id) {
      if (!isUuid(b.id)) throw err(404, "That assignment wasn't found.");
      const u = await pool.query(`UPDATE gb_assignments SET title = $3, category = $4, points = $5, due = $6, period_id = $7, published = $8, description = $9 WHERE id = $1 AND class_id = $2`, [b.id, c.id, ...vals]);
      if (!u.rowCount) throw err(404, "That assignment wasn't found.");
    } else {
      await pool.query(`INSERT INTO gb_assignments (class_id, title, category, points, due, period_id, published, description, created_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [c.id, ...vals, user.name]);
    }
    await audit(user, b.id ? "Changed an assignment" : "Added an assignment", `${c.name}: ${title}`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "assignments" && isUuid(id) && b2 === "remove") {
    const x = (await pool.query("SELECT * FROM gb_assignments WHERE id = $1", [id])).rows[0];
    if (!x) throw err(404, "That assignment wasn't found.");
    const c = await classForGrading(user, r, x.class_id);
    await pool.query("DELETE FROM gb_assignments WHERE id = $1", [id]);
    await audit(user, "Removed an assignment", `${c.name}: ${x.title}`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "classes" && id && b2 === "scores") {
    const c = await classForGrading(user, r, id);
    const changes = Array.isArray(b.changes) ? b.changes.slice(0, 5000) : [];
    if (!changes.length) throw err(400, "Nothing to save.");
    const asg = new Map((await pool.query("SELECT id, title, points FROM gb_assignments WHERE class_id = $1", [c.id])).rows.map(x => [x.id, x]));
    const roster = new Set((await pool.query("SELECT student_id FROM gb_enrollments WHERE class_id = $1", [c.id])).rows.map(x => x.student_id));
    const cn = await pool.connect();
    const touched = new Set();
    try {
      await cn.query("BEGIN");
      for (const ch of changes) {
        if (!asg.has(ch.assignmentId) || !roster.has(ch.studentId)) throw err(400, "One of those grades is for an assignment or student not in this class.");
        let pts = ch.points === "" || ch.points == null ? null : Number(ch.points);
        if (pts != null && (!Number.isFinite(pts) || pts < 0 || pts > 100000)) throw err(400, `"${ch.points}" isn't a number of points.`);
        if (pts != null) pts = Math.round(pts * 100) / 100;
        const status = Object.hasOwn(STATUS, ch.status) ? ch.status : "";
        const existing = (await cn.query("SELECT comment FROM gb_scores WHERE assignment_id = $1 AND student_id = $2", [ch.assignmentId, ch.studentId])).rows[0];
        const comment = ch.comment === undefined ? existing?.comment || "" : text(ch.comment, 2000);
        await cn.query(`INSERT INTO gb_scores (assignment_id, student_id, points, status, comment, updated_by_name, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (assignment_id, student_id) DO UPDATE SET points = $3, status = $4, comment = $5, updated_by_name = $6, updated_at = now()`,
          [ch.assignmentId, ch.studentId, pts, status, comment, user.name]);
        touched.add(asg.get(ch.assignmentId).title);
      }
      await cn.query("COMMIT");
    } catch (e) { await cn.query("ROLLBACK").catch(() => {}); throw e; } finally { cn.release(); }
    await audit(user, "Entered grades", `${c.name}: ${[...touched].slice(0, 5).join(", ")}${touched.size > 5 ? ` and ${touched.size - 5} more` : ""} (${changes.length} grade${changes.length === 1 ? "" : "s"})`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "classes" && id && b2 === "categories") {
    const c = await classForGrading(user, r, id);
    const cats = cleanCategories(b.categories);
    if (!cats.length) throw err(400, "A class needs at least one category.");
    const before = Array.isArray(c.categories) ? c.categories : [];
    await pool.query("UPDATE gb_classes SET categories = $2 WHERE id = $1", [c.id, JSON.stringify(cats)]);
    // Work in a category that was removed moves to the first one
    const keep = cats.map(x => x.id);
    await pool.query("UPDATE gb_assignments SET category = $2 WHERE class_id = $1 AND NOT (category = ANY(string_to_array($3, ',')))", [c.id, keep[0], keep.join(",")]);
    await audit(user, "Changed grading categories", `${c.name}: ${cats.map(x => `${x.name} ${x.weight}`).join(", ")} (was ${before.map(x => `${x.name} ${x.weight}`).join(", ") || "school default"})`);
    return send(res, 200, await classState(user, r, { ...c, categories: cats }));
  }
  if (a === "classes" && id && b2 === "students") {
    const c = await getClass(id);
    if (!r.manage && !r.teaching.has(c.id)) throw err(403, "Only this class's teachers and Gradebook managers can change who's in it.");
    const add = (Array.isArray(b.add) ? b.add : []).filter(isUuid).slice(0, 500), drop = (Array.isArray(b.drop) ? b.drop : []).filter(isUuid).slice(0, 500);
    for (const sid of add) await pool.query("INSERT INTO gb_enrollments (class_id, student_id) SELECT $1, id FROM gb_students WHERE id = $2 ON CONFLICT (class_id, student_id) DO UPDATE SET dropped_at = NULL", [c.id, sid]);
    for (const sid of drop) await pool.query("UPDATE gb_enrollments SET dropped_at = now() WHERE class_id = $1 AND student_id = $2", [c.id, sid]);
    await audit(user, "Changed a class roster", `${c.name}: ${add.length} added, ${drop.length} dropped`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "classes" && id && b2 === "comment") {
    const c = await classForGrading(user, r, id);
    if (!isUuid(b.studentId) || !isUuid(b.periodId)) throw err(400, "Which student and grading period?");
    const ok = (await pool.query("SELECT 1 FROM gb_enrollments WHERE class_id = $1 AND student_id = $2", [c.id, b.studentId])).rows[0] && (await pool.query("SELECT 1 FROM gb_periods WHERE id = $1", [b.periodId])).rows[0];
    if (!ok) throw err(400, "That student isn't in this class, or that grading period wasn't found.");
    const comment = text(b.comment, 2000);
    if (!comment) await pool.query("DELETE FROM gb_period_comments WHERE class_id = $1 AND student_id = $2 AND period_id = $3", [c.id, b.studentId, b.periodId]);
    else await pool.query(`INSERT INTO gb_period_comments (class_id, student_id, period_id, comment, updated_by_name) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (class_id, student_id, period_id) DO UPDATE SET comment = $4, updated_by_name = $5, updated_at = now()`, [c.id, b.studentId, b.periodId, comment, user.name]);
    return send(res, 200, { ok: true });
  }
  if (a === "files" && !id) {
    const x = isUuid(b.assignmentId) ? (await pool.query("SELECT * FROM gb_assignments WHERE id = $1", [b.assignmentId])).rows[0] : null;
    if (!x) throw err(404, "That assignment wasn't found.");
    const c = await classForGrading(user, r, x.class_id);
    if (!isUuid(b.studentId) || !(await pool.query("SELECT 1 FROM gb_enrollments WHERE class_id = $1 AND student_id = $2", [c.id, b.studentId])).rows[0]) throw err(400, "That student isn't in this class.");
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ""));
    if (!m) throw err(400, "Choose a PDF or a picture.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > FILE_MAX) throw err(413, "That file is over 10 MB.");
    const mime = sniff(buf);
    if (!mime) throw err(415, "Graded work can be a PDF, a PNG or a JPEG picture.");
    const name = line(b.name, 120).replace(/\.[a-z0-9]+$/i, "") + "." + FILE_TYPES[mime];
    await pool.query("INSERT INTO gb_score_files (assignment_id, student_id, name, mime, size, data, uploaded_by_name) VALUES ($1, $2, $3, $4, $5, $6, $7)", [x.id, b.studentId, name, mime, buf.length, buf, user.name]);
    await audit(user, "Attached graded work", `${c.name}: ${x.title}`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "files" && isUuid(id) && b2 === "remove") {
    const f = (await pool.query("SELECT f.id, f.name, a.class_id, a.title FROM gb_score_files f JOIN gb_assignments a ON a.id = f.assignment_id WHERE f.id = $1", [id])).rows[0];
    if (!f) throw err(404, "That file wasn't found.");
    const c = await classForGrading(user, r, f.class_id);
    await pool.query("DELETE FROM gb_score_files WHERE id = $1", [id]);
    await audit(user, "Removed graded work", `${c.name}: ${f.title}`);
    return send(res, 200, await classState(user, r, c));
  }
  if (a === "students" && !id) {
    const classId = isUuid(b.classId) ? b.classId : null;
    if (!r.manage && !(classId && r.teaching.has(classId))) throw err(403, "Only Gradebook managers can change student records. Teachers can add a new student to their own class.");
    if (b.id && !r.manage) throw err(403, "Only Gradebook managers can change student records.");
    const first = line(b.firstName, 60), last = line(b.lastName, 60), number = line(b.number, 40), grade = line(b.gradeLevel, 20), email = line(b.email, 200).toLowerCase();
    if (!first || !last) throw err(400, "Enter the student's first and last name.");
    if (email && !validEmail(email)) throw err(400, "That email doesn't look right.");
    if (number) {
      const dup = (await pool.query("SELECT id FROM gb_students WHERE lower(student_number) = lower($1) AND id <> COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')", [number, isUuid(b.id) ? b.id : null])).rows[0];
      if (dup) throw err(409, `Student ID ${number} already belongs to another student.`);
    }
    let sid = b.id;
    if (sid) {
      if (!isUuid(sid)) throw err(404, "That student wasn't found.");
      const u = await pool.query("UPDATE gb_students SET first_name = $2, last_name = $3, student_number = $4, grade_level = $5, email = $6, active = $7 WHERE id = $1",
        [sid, first, last, number, grade, email, b.active !== false]);
      if (!u.rowCount) throw err(404, "That student wasn't found.");
    } else {
      sid = (await pool.query("INSERT INTO gb_students (first_name, last_name, student_number, grade_level, email) VALUES ($1, $2, $3, $4, $5) RETURNING id", [first, last, number, grade, email])).rows[0].id;
    }
    if (classId) await pool.query("INSERT INTO gb_enrollments (class_id, student_id) VALUES ($1, $2) ON CONFLICT (class_id, student_id) DO UPDATE SET dropped_at = NULL", [classId, sid]);
    await audit(user, b.id ? "Changed a student record" : "Added a student", `${last}, ${first}${number ? ` (${number})` : ""}`);
    return send(res, 200, { id: sid });
  }

  // ---- school setup (manage)
  if (!r.manage) throw err(403, "School setup needs Gradebook manage.");
  if (a === "settings") {
    const next = { scale: cleanScale(b.scale ?? s.scale), categories: cleanCategories(b.categories ?? s.categories), missingZero: b.missingZero !== undefined ? !!b.missingZero : s.missingZero,
      passing: Number.isFinite(Number(b.passing)) ? Math.max(0, Math.min(100, Number(b.passing))) : s.passing, decimals: [0, 1, 2].includes(Number(b.decimals)) ? Number(b.decimals) : s.decimals ?? 1,
      schoolYear: b.schoolYear !== undefined ? line(b.schoolYear, 20) : s.schoolYear };
    if (!next.categories.length) throw err(400, "Keep at least one category.");
    await pool.query("INSERT INTO settings (key, value) VALUES ('gradebook', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(next)]);
    await audit(user, "Changed gradebook settings", `Scale ${next.scale.map(x => `${x.letter} ${x.min}`).join(", ")}; categories ${next.categories.map(x => `${x.name} ${x.weight}`).join(", ")}; passing ${next.passing}`);
    return send(res, 200, { settings: await settings() });
  }
  if (a === "periods" && !id) {
    const name = line(b.name, 60);
    if (!name) throw err(400, "Name the grading period (e.g. Quarter 1).");
    if (!isDay(b.starts) || !isDay(b.ends) || b.ends < b.starts) throw err(400, "Give the period a start date and an end date on or after it.");
    const vals = [name, line(b.schoolYear ?? s.schoolYear, 20), b.starts, b.ends];
    if (b.id) {
      if (!isUuid(b.id) || !(await pool.query("UPDATE gb_periods SET name = $2, school_year = $3, starts = $4, ends = $5 WHERE id = $1", [b.id, ...vals])).rowCount) throw err(404, "That period wasn't found.");
    } else await pool.query("INSERT INTO gb_periods (name, school_year, starts, ends) VALUES ($1, $2, $3, $4)", vals);
    await audit(user, b.id ? "Changed a grading period" : "Added a grading period", `${name}: ${b.starts} to ${b.ends}`);
    return send(res, 200, { periods: await periods() });
  }
  if (a === "periods" && isUuid(id) && b2 === "remove") {
    const p = (await pool.query("DELETE FROM gb_periods WHERE id = $1 RETURNING name", [id])).rows[0];
    if (p) await audit(user, "Removed a grading period", p.name);
    return send(res, 200, { periods: await periods() });
  }
  if (a === "classes" && !id) {
    const name = line(b.name, 120);
    if (!name) throw err(400, "Name the class.");
    const teacherIds = (Array.isArray(b.teacherIds) ? b.teacherIds : []).filter(isUuid).slice(0, 10);
    const vals = [line(b.code, 60), name, line(b.subject, 60), line(b.gradeLevel, 20), line(b.section, 40), line(b.schoolYear ?? s.schoolYear, 20)];
    let cid = b.id;
    if (cid) {
      if (!isUuid(cid)) throw err(404, "That class wasn't found.");
      const u = await pool.query("UPDATE gb_classes SET code = $2, name = $3, subject = $4, grade_level = $5, section = $6, school_year = $7, active = $8 WHERE id = $1", [cid, ...vals, b.active !== false]);
      if (!u.rowCount) throw err(404, "That class wasn't found.");
    } else cid = (await pool.query("INSERT INTO gb_classes (code, name, subject, grade_level, section, school_year, categories) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id", [...vals, JSON.stringify(s.categories)])).rows[0].id;
    if (Array.isArray(b.teacherIds)) {
      await pool.query("DELETE FROM gb_class_teachers WHERE class_id = $1", [cid]);
      for (const t of teacherIds) await pool.query("INSERT INTO gb_class_teachers (class_id, user_id) SELECT $1, id FROM users WHERE id = $2 AND active ON CONFLICT DO NOTHING", [cid, t]);
    }
    await audit(user, b.id ? "Changed a class" : "Added a class", name);
    return send(res, 200, { id: cid });
  }
  if (a === "import") {
    const rows = await parseRoster(line(b.fileName, 200), b.data);
    if (!rows.length) throw err(400, "That sheet has no rows under its header.");
    const planned = await planImport(rows);
    if (b.preview) return send(res, 200, { preview: true, ...planned.summary, schoolYear: planned.year });
    await applyImport(user, planned, b.fileName);
    return send(res, 200, { ok: true, ...planned.summary });
  }
  if (a === "family" && !id) {
    if (!isUuid(b.studentId) || !(await pool.query("SELECT 1 FROM gb_students WHERE id = $1", [b.studentId])).rows[0]) throw err(404, "That student wasn't found.");
    const kind = b.kind === "student" ? "student" : "guardian";
    const email = line(b.email, 200).toLowerCase(), name = line(b.name, 120);
    if (!validEmail(email)) throw err(400, "Enter an email address for the sign-in.");
    if (!name) throw err(400, "Enter the person's name.");
    let f = (await pool.query("SELECT * FROM gb_family WHERE lower(email) = $1", [email])).rows[0];
    if (f && f.kind !== kind) throw err(409, `${email} already has a ${f.kind} sign-in.`);
    if (kind === "student") {
      const other = (await pool.query("SELECT f.email FROM gb_family_links l JOIN gb_family f ON f.id = l.family_id WHERE l.student_id = $1 AND f.kind = 'student' AND lower(f.email) <> $2", [b.studentId, email])).rows[0];
      if (other) throw err(409, `This student already signs in as ${other.email}.`);
      if (f && (await pool.query("SELECT 1 FROM gb_family_links WHERE family_id = $1 AND student_id <> $2", [f.id, b.studentId])).rows[0]) throw err(409, "That student sign-in belongs to another student.");
    }
    if (!f) f = (await pool.query("INSERT INTO gb_family (kind, name, email) VALUES ($1, $2, $3) RETURNING *", [kind, name, email])).rows[0];
    await pool.query("INSERT INTO gb_family_links (family_id, student_id, relationship) VALUES ($1, $2, $3) ON CONFLICT (family_id, student_id) DO UPDATE SET relationship = $3",
      [f.id, b.studentId, kind === "student" ? "self" : line(b.relationship, 40) || "guardian"]);
    const inv = f.password_hash ? null : await inviteFor(f);
    await audit(user, kind === "student" ? "Set up a student sign-in" : "Linked a parent / guardian", `${name} <${email}>`);
    return send(res, 200, { family: await familyFor([b.studentId]), invite: inv });
  }
  if (a === "family" && id === "invites") {
    const ids = b.all ? null : (Array.isArray(b.studentIds) ? b.studentIds.filter(isUuid) : []);
    const rows = (await pool.query(`SELECT DISTINCT f.* FROM gb_family f JOIN gb_family_links l ON l.family_id = f.id
      WHERE f.active AND f.password_hash IS NULL AND (f.invite_expires IS NULL OR f.invite_expires < now() + interval '1 day') ${ids ? "AND l.student_id = ANY(string_to_array($1, ',')::uuid[])" : ""}
      ORDER BY f.name LIMIT 3000`, ids ? [ids.join(",")] : [])).rows;
    const out = [];
    for (const f of rows) { const inv = await inviteFor(f); out.push({ name: f.name, email: f.email, kind: f.kind, ...inv }); }
    await audit(user, "Sent family sign-in links", `${out.length} ${out.length === 1 ? "person" : "people"}`);
    return send(res, 200, { invites: out });
  }
  if (a === "family" && isUuid(id)) {
    const f = (await pool.query("SELECT * FROM gb_family WHERE id = $1", [id])).rows[0];
    if (!f) throw err(404, "That sign-in wasn't found.");
    if (b2 === "invite") {
      const inv = await inviteFor(f);
      await pool.query("DELETE FROM gb_family_sessions WHERE family_id = $1", [f.id]);
      await audit(user, "Made a new family sign-in link", `${f.name} <${f.email}>`);
      return send(res, 200, { invite: inv });
    }
    if (b2 === "active") {
      await pool.query("UPDATE gb_family SET active = $2 WHERE id = $1", [f.id, !!b.active]);
      if (!b.active) await pool.query("DELETE FROM gb_family_sessions WHERE family_id = $1", [f.id]);
      await audit(user, b.active ? "Turned a family sign-in back on" : "Turned off a family sign-in", `${f.name} <${f.email}>`);
      return send(res, 200, { ok: true });
    }
    if (b2 === "unlink") {
      if (!isUuid(b.studentId)) throw err(400, "Which student?");
      await pool.query("DELETE FROM gb_family_links WHERE family_id = $1 AND student_id = $2", [f.id, b.studentId]);
      await audit(user, "Removed a family link", `${f.name} <${f.email}>`);
      return send(res, 200, { family: await familyFor([b.studentId]) });
    }
  }
  throw err(404, "Not found.");
}

// ---------------------------------------------------------------- family side (students, parents / guardians)
function setCookie(req, res, value, maxAge) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "") === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
async function startSession(req, res, fid) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO gb_family_sessions (token_hash, family_id, ip) VALUES ($1, $2, $3)", [sha(token), fid, clientIp(req)]);
  await pool.query("UPDATE gb_family SET last_login = now() WHERE id = $1", [fid]);
  setCookie(req, res, token, MAX_HOURS * 3600);
  return token;
}
async function familyUser(req, token = readCookie(req, COOKIE)) {
  if (!token) return null;
  const r = (await pool.query(`SELECT f.*, s.token_hash, s.created_at AS session_started, s.last_seen AS session_seen FROM gb_family_sessions s JOIN gb_family f ON f.id = s.family_id
    WHERE s.token_hash = $1`, [sha(token)])).rows[0];
  if (!r) return null;
  if (!r.active || Date.now() - new Date(r.session_seen) > IDLE_MIN * 60e3 || Date.now() - new Date(r.session_started) > MAX_HOURS * 3600e3) {
    await pool.query("DELETE FROM gb_family_sessions WHERE token_hash = $1", [r.token_hash]); return null;
  }
  if (Date.now() - new Date(r.session_seen) > 30e3) await pool.query("UPDATE gb_family_sessions SET last_seen = now() WHERE token_hash = $1", [r.token_hash]);
  return r;
}
async function familyStudents(fu) {
  return (await pool.query(`SELECT st.*, l.relationship FROM gb_family_links l JOIN gb_students st ON st.id = l.student_id WHERE l.family_id = $1 AND st.active
    ORDER BY st.first_name, st.last_name`, [fu.id])).rows;
}
const familyJson = (fu, students) => ({ id: fu.id, kind: fu.kind, name: fu.name, email: fu.email, school: brand().org,
  students: students.map(s => ({ id: s.id, firstName: s.first_name, lastName: s.last_name, gradeLevel: s.grade_level })) });
async function familyAudit(fu, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES (NULL, $1, $2, 'Gradebook', $3, $4)`,
    [`${fu.name} <${fu.email}>`, fu.kind === "student" ? "Student" : "Parent / guardian", action, line(detail, 500)]);
}

export async function handleFamily(req, res, url, send, jsonBody) {
  const ip = clientIp(req);
  const parts = url.pathname.split("/").filter(Boolean);   // api family ...
  const [, , a, id, b2, cid] = parts;
  if (req.method !== "GET" && !allow(`family:${ip}`, 90, 60e3)) throw err(429, "Too many requests. Wait a minute and try again.");
  if (a === "login" && req.method === "POST") {
    const b = await jsonBody(req);
    const email = line(b.email, 200).toLowerCase();
    if (!allow(`family-login:${ip}`, 30, 15 * 60e3) || !allow(`family-login:${email}`, 10, 60 * 60e3)) throw err(429, "Too many tries. Wait 15 minutes, or ask the school office for a new sign-in link.");
    const f = (await pool.query("SELECT * FROM gb_family WHERE lower(email) = $1", [email])).rows[0];
    const ok = await verifyPassword(String(b.password || ""), f?.password_hash || DUMMY);
    if (!f || !ok || !f.active || !f.password_hash) throw err(401, "That email and password don't match.");
    await startSession(req, res, f.id);
    await familyAudit(f, "Signed in", `from ${ip}`);
    return send(res, 200, { user: familyJson(f, await familyStudents(f)) });
  }
  if (a === "invite" && req.method === "POST") {
    if (!allow(`family-invite:${ip}`, 20, 15 * 60e3)) throw err(429, "Too many tries. Wait a few minutes.");
    return familyInvite(req, res, send, await jsonBody(req));
  }
  if (a === "invite") {
    const token = url.searchParams.get("token");
    if (typeof token !== "string" || token.length < 20 || token.length > 100) throw err(410, "That sign-in link isn't valid. Ask the school office for a new one.");
    const f = (await pool.query("SELECT * FROM gb_family WHERE invite_hash = $1 AND invite_expires > now() AND active", [sha(token)])).rows[0];
    if (!f) throw err(410, "That sign-in link has expired or was already used. Ask the school office for a new one.");
    return send(res, 200, { name: f.name, email: f.email, kind: f.kind, school: brand().org });
  }
  if (a === "logout" && req.method === "POST") {
    const t = readCookie(req, COOKIE);
    if (t) await pool.query("DELETE FROM gb_family_sessions WHERE token_hash = $1", [sha(t)]);
    setCookie(req, res, "", 0);
    return send(res, 200, { ok: true });
  }
  const fu = await familyUser(req);
  if (a === "me") return fu ? send(res, 200, { user: familyJson(fu, await familyStudents(fu)) }) : send(res, 200, { user: null, school: brand().org });
  if (!fu) throw err(401, "Please sign in again.");
  const mine = await familyStudents(fu);
  const canSee = sid => mine.some(s => s.id === sid);
  if (req.method === "GET" && a === "overview") {
    const out = [];
    for (const st of mine) {
      out.push(await reportCard(st.id, { family: true }));
      await logView(fu.kind, fu.id, fu.name, st.id, "Opened grades");
    }
    return send(res, 200, { user: familyJson(fu, mine), students: out });
  }
  if (req.method === "GET" && a === "students" && isUuid(id) && b2 === "classes" && isUuid(cid)) {
    if (!canSee(id)) throw err(404, "Not found.");
    if (!(await pool.query("SELECT 1 FROM gb_enrollments WHERE class_id = $1 AND student_id = $2 AND dropped_at IS NULL", [cid, id])).rows[0]) throw err(404, "Not found.");
    const c = await getClass(cid);
    await logView(fu.kind, fu.id, fu.name, id, `Opened ${c.name}`);
    return send(res, 200, await studentClass(id, c));
  }
  if (req.method === "GET" && a === "files" && isUuid(id)) {
    const f = (await pool.query(`SELECT f.* FROM gb_score_files f JOIN gb_assignments a ON a.id = f.assignment_id
      JOIN gb_enrollments e ON e.class_id = a.class_id AND e.student_id = f.student_id AND e.dropped_at IS NULL WHERE f.id = $1 AND a.published`, [id])).rows[0];
    if (!f || !canSee(f.student_id)) throw err(404, "Not found.");
    await logView(fu.kind, fu.id, fu.name, f.student_id, `Opened graded work: ${f.name}`);
    return sendFile(res, f, url.searchParams.get("download") === "1");
  }
  throw err(404, "Not found.");
}
// POST /api/family/invite {token, password}: set the password and sign in
export async function familyInvite(req, res, send, b) {
  const token = b.token;
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw err(410, "That sign-in link isn't valid. Ask the school office for a new one.");
  const f = (await pool.query("SELECT * FROM gb_family WHERE invite_hash = $1 AND invite_expires > now() AND active", [sha(token)])).rows[0];
  if (!f) throw err(410, "That sign-in link has expired or was already used. Ask the school office for a new one.");
  const problem = passwordProblem(String(b.password || ""));
  if (problem) throw err(400, problem);
  const used = await pool.query("UPDATE gb_family SET password_hash = $2, invite_hash = NULL, invite_expires = NULL WHERE id = $1 AND invite_hash = $3", [f.id, await hashPassword(String(b.password)), sha(token)]);
  if (!used.rowCount) throw err(410, "That sign-in link was already used.");
  await pool.query("DELETE FROM gb_family_sessions WHERE family_id = $1", [f.id]);
  await startSession(req, res, f.id);
  await familyAudit(f, "Chose a password with a sign-in link", "");
  return send(res, 200, { user: familyJson(f, await familyStudents(f)) });
}
