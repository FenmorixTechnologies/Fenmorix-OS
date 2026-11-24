// Training: hours by person against requirements (ISO + department / state), today's crew from
// Aladtec, FireWorks training imports.
//
//   GET  /api/training              ?year            my access, settings, my summary (+ everyone with view)
//   GET  /api/training/crew         ?day             today's Aladtec shift A-Z with each person's hours (view)
//   GET  /api/training/person       ?user|name&year  one person's records (self or view)
//   POST /api/training/import       {fileName, data, preview}           (edit)
//   POST /api/training/records      {userId|name, day, hours, category, topic, instructor}   (edit)
//   POST /api/training/records/:id/remove                               (edit)
//   POST /api/training/settings     {requirements, catmap}              (manage)
//   POST /api/training/content      {fileName, data}  FireWorks "Certification Subjects and Relevant Content Master List" (manage)
//   GET  /api/training/content      ?q              content titles for hand entry (edit)
//
// FireWorks training is organised Certification > Subject > Content title (e.g. "01 PIAL - Firefighter/Operator" >
// "Company" > "Aerial Company Operations"). ISO credit comes from the subject (Company, Facility (Drills), Driver,
// Hazmat, Officer); department, state and EMS requirements match words in the certification, subject or title.
//
// A requirement: { id, label, group (ISO | Department | State | EMS), hours, period (month | quarter | year |
// 2years), counts: "iso:<company|facility|officer|driver|hazmat|ims|other>" or keywords matched in the record's
// certification, subject or title, titles (regex on job title; empty = everyone), holders (only people with a record
// whose certification contains this, e.g. "Paramedic Training Hours"), monthlyCap }.
// ISO's company training is 192 hours a year with at most 16 a month counted (FSRS / PIAL).
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { onDuty } from "./aladtec.js";
import { guessCategory } from "./isoKinds.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r1 = n => Math.round(n * 10) / 10;
export const normName = s => {
  let t = String(s || "").trim();
  const m = /^([^,]+),\s*(.+)$/.exec(t);              // "Last, First"
  if (m) t = `${m[2]} ${m[1]}`;
  return t.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
};

export const ISO_KINDS = { company: "Company training", facility: "Facility (training ground) training", officer: "Officer development",
  driver: "Driver / operator", hazmat: "Hazardous materials", ims: "Incident management (NIMS/ICS)", other: "EMS / other (not ISO fire training)" };
export const DEFAULT_REQUIREMENTS = [
  { id: "iso-company", label: "Company training", group: "ISO", hours: 192, period: "year", counts: "iso:company", titles: "", divisions: "suppression|operations", monthlyCap: 16,
    note: "ISO / PIAL: 16 hours a month, 192 a year. At most 16 hours in any month count." },
  { id: "iso-facility", label: "Facility training", group: "ISO", hours: 18, period: "year", counts: "iso:facility", titles: "", divisions: "suppression|operations",
    note: "ISO / PIAL: 18 hours a year at the training ground (live fire, drill tower, props)." },
  { id: "iso-officer", label: "Officer development", group: "ISO", hours: 12, period: "year", counts: "iso:officer", divisions: "suppression|operations", titles: "captain|lieutenant|chief|officer|lt\\b|capt",
    note: "ISO / PIAL: 12 hours a year for officers." },
  { id: "iso-driver", label: "Driver / operator", group: "ISO", hours: 12, period: "year", counts: "iso:driver", divisions: "suppression|operations", titles: "operator|engineer|driver|d/o",
    note: "ISO / PIAL: 12 hours a year for driver/operators (new drivers 60)." },
  { id: "iso-hazmat", label: "Hazmat", group: "ISO", hours: 6, period: "year", counts: "iso:hazmat", titles: "", divisions: "suppression|operations",
    note: "ISO / PIAL: 6 hours a year of hazardous materials training." },
  // Louisiana: every public employee, every calendar year (FireWorks "10- State Mandated Training")
  { id: "la-ethics", label: "Ethics", group: "State", hours: 1, period: "year", counts: "ethics", titles: "",
    note: "Louisiana Code of Governmental Ethics: 1 hour each calendar year (R.S. 42:1170)." },
  { id: "la-harassment", label: "Sexual harassment prevention", group: "State", hours: 1, period: "year", counts: "sexual harass", titles: "",
    note: "Louisiana: 1 hour each calendar year (R.S. 42:343)." },
  { id: "la-cyber", label: "Cybersecurity awareness", group: "State", hours: 1, period: "year", counts: "cybersecurity, cyber security", titles: "",
    note: "Louisiana: annual cybersecurity training for public employees who use a computer (R.S. 42:1267). Set the hours to what FireWorks credits." },
  // National Registry recertification, every 2 years: only for people who log hours under that certification
  { id: "ems-emt", label: "EMT continuing education", group: "EMS", hours: 40, period: "2years", counts: "emt training hours", holders: "EMT Training Hours", titles: "",
    note: "NREMT EMT: 40 hours every 2 years. Counts for people with hours under \"EMT Training Hours\". Line the 2-year window up with your registry cycle." },
  { id: "ems-aemt", label: "AEMT continuing education", group: "EMS", hours: 50, period: "2years", counts: "aemt training hours", holders: "AEMT Training Hours", titles: "",
    note: "NREMT AEMT: 50 hours every 2 years." },
  { id: "ems-paramedic", label: "Paramedic continuing education", group: "EMS", hours: 60, period: "2years", counts: "paramedic training hours", holders: "Paramedic Training Hours", titles: "",
    note: "NREMT Paramedic: 60 hours every 2 years." },
];
// FireWorks "Training Category List" -> ISO kinds (defaults; Settings can change each one).
// Used when a record has no subject that decides it.
export function categoryKind(category) {
  const c = String(category || "").toLowerCase().trim();
  if (!c) return null;
  if (/new driver|driver|operator/.test(c)) return "driver";
  if (/officer/.test(c)) return "officer";
  if (/haz/.test(c)) return "hazmat";
  if (/practical|evolution|drill|live fire/.test(c)) return "facility";
  if (/blue card|incident command|nims|ics\b/.test(c)) return "ims";
  if (/daily company|company|^fire$|operations|rescue|safety|iso/.test(c)) return "company";
  return "other";       // medical, communications, CRR, investigator, educator, recruit/academy, administration, certifications, other
}

// FireWorks subjects -> ISO kinds
export function subjectKind(subject, certification = "") {
  const s = String(subject || "").toLowerCase().trim(), c = String(certification || "").toLowerCase();
  if (/^facility|drills?\)?$|training ground/.test(s)) return "facility";
  if (/^company/.test(s)) return "company";
  if (/^driver|pumper|apparatus op/.test(s)) return /new driver|task book/.test(c) ? "driver" : "driver";
  if (/haz ?mat/.test(s)) return "hazmat";
  if (/^officer/.test(s)) return "officer";
  if (/nims|^ics|incident management|imt/.test(s)) return "ims";
  return null;
}
const FACILITY_RE = /facility|training (ground|center|centre)|drill (ground|field|tower)|burn (building|tower)|live fire|tower|prop|pump pit|sea can/i;

export async function settings() {
  const d = (await pool.query("SELECT data FROM training_settings WHERE id = 1")).rows[0]?.data || {};
  return { requirements: Array.isArray(d.requirements) && d.requirements.length ? d.requirements : DEFAULT_REQUIREMENTS,
    catmap: d.catmap && typeof d.catmap === "object" ? d.catmap : {},
    fwmap: d.fwmap && typeof d.fwmap === "object" ? d.fwmap : {},
    fwCategories: Array.isArray(d.fwCategories) ? d.fwCategories : [] };
}
// The ISO kinds a record counts toward (a record can count as company AND facility)
// Order: the subject (with the content list behind it) decides; then the FireWorks category (as mapped in
// Settings); then a guess from the words.
export function isoKinds(r, catmap, fwmap = {}) {
  const fc = String(r.fw_category || "").toLowerCase().trim();
  const k = (r.category && (catmap[String(r.category).toLowerCase()] || subjectKind(r.category, r.certification)))
    || (fc && (fwmap[fc] || categoryKind(fc)))
    || catmap[String(r.topic || "").toLowerCase()]
    || (/pial|firefighter|officer|operator/i.test(r.certification || "") || !r.certification ? mapGuess(r.category, r.topic) : "other");
  const out = new Set([k]);
  if (k === "company" && FACILITY_RE.test(`${r.category} ${r.fw_category || ""} ${r.topic}`)) out.add("facility");
  if (k === "facility") out.add("company");
  return out;
}
function mapGuess(category, topic) {
  const g = guessCategory(`${category || ""} ${topic || ""}`);
  return ({ recruit: "company", new_driver: "driver" })[g] || g;
}
function counts(req, r, catmap, fwmap) {
  const c = String(req.counts || "");
  if (c.startsWith("iso:")) return isoKinds(r, catmap, fwmap).has(c.slice(4));
  const words = c.split(/[,;|]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length || words.includes("*")) return true;
  const hay = `${r.certification || ""} ${r.category} ${r.fw_category || ""} ${r.topic}`.toLowerCase();
  return words.some(w => hay.includes(w));
}
// Who a requirement is for: job title and division patterns (empty = everyone). People without an
// account (names only in FireWorks) have no division, so division rules don't leave them out.
function appliesTo(req, person) {
  try {
    if (req.titles && !new RegExp(req.titles, "i").test(String(person.title || ""))) return false;
    if (req.divisions && person.division && !new RegExp(req.divisions, "i").test(String(person.division))) return false;
    return true;
  } catch { return false; }
}
// The window a requirement is measured over, ending at `asOf` (in the chosen year)
function windowFor(period, year, asOf) {
  const end = asOf;
  if (period === "month") return { from: `${end.slice(0, 7)}-01`, to: end, label: new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }) };
  if (period === "quarter") {
    const q = Math.floor((Number(end.slice(5, 7)) - 1) / 3);
    return { from: `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`, to: end, label: `Q${q + 1}` };
  }
  if (period === "2years") return { from: `${year - 1}-01-01`, to: end, label: `${year - 1}-${year}` };
  return { from: `${year}-01-01`, to: end, label: String(year) };
}

// Each person's standing against each requirement
export function summarize(person, records, reqs, st, year, asOf) {
  const catmap = st.catmap || {}, fwmap = st.fwmap || {};
  const yearEnd = `${year}-12-31`;
  const until = asOf < yearEnd ? asOf : yearEnd;
  const out = [];
  for (const req of reqs) {
    if (!appliesTo(req, person)) continue;
    if (req.holders && !records.some(r => String(r.certification || "").toLowerCase().includes(String(req.holders).toLowerCase()))) continue;
    const w = windowFor(req.period || "year", year, until);
    const rows = records.filter(r => r.day >= w.from && r.day <= w.to && counts(req, r, catmap, fwmap));
    let done;
    if (req.monthlyCap > 0) {
      const byMonth = new Map();
      for (const r of rows) byMonth.set(r.day.slice(0, 7), (byMonth.get(r.day.slice(0, 7)) || 0) + Number(r.hours));
      done = [...byMonth.values()].reduce((s, h) => s + Math.min(h, req.monthlyCap), 0);
    } else done = rows.reduce((s, r) => s + Number(r.hours), 0);
    // On pace: the share of the period gone by (whole-year requirements only)
    let pace = null;
    if ((req.period || "year") === "year" && asOf.slice(0, 4) === String(year)) {
      const start = Date.parse(`${year}-01-01`), now = Date.parse(asOf);
      pace = Math.min(1, Math.max(0, (now - start) / (365 * 86400000))) * req.hours;
    }
    out.push({ id: req.id, label: req.label, group: req.group, required: req.hours, done: r1(done), missing: r1(Math.max(0, req.hours - done)),
      pct: req.hours ? Math.min(100, Math.round(100 * done / req.hours)) : 100, window: w.label, pace: pace === null ? null : r1(pace),
      behind: pace !== null && done + 0.05 < pace });
  }
  const total = records.filter(r => r.day.slice(0, 4) === String(year)).reduce((s, r) => s + Number(r.hours), 0);
  return { totalHours: r1(total), requirements: out, missingCount: out.filter(x => x.missing > 0).length, behindCount: out.filter(x => x.behind).length };
}

export async function access(user) {
  if (user.role === "master") return { view: true, edit: true, manage: true };
  return { view: await hasAccess(pool, user, "training", "view"), edit: await hasAccess(pool, user, "training", "edit"), manage: await hasAccess(pool, user, "training", "manage") };
}
const today = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };

async function people() {
  return (await pool.query(`SELECT u.id, u.full_name AS name, u.job_title AS title, u.station, u.employee_number AS emp, d.name AS division
    FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.active ORDER BY u.full_name`)).rows;
}
export async function recordsFor(year, { userIds = null, names = null } = {}) {
  const rows = (await pool.query(
    `SELECT id, user_id, person_name, to_char(day, 'YYYY-MM-DD') AS day, hours::float AS hours, certification, category, fw_category, topic, instructor, source, drill_id, delivery
       FROM training_records WHERE day BETWEEN $1 AND $2 AND superseded_by IS NULL ORDER BY day`, [`${year - 2}-01-01`, `${year}-12-31`])).rows;
  return rows.filter(r => (!userIds || userIds.has(r.user_id)) || (names && names.has(normName(r.person_name))));
}

// Group records by person: account id, else the name as written
export function byPerson(records) {
  const m = new Map();
  for (const r of records) {
    const k = r.user_id || `name:${normName(r.person_name)}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

// Link imported rows to accounts by employee number, then by unique name
async function linkRecords(c = pool) {
  const ppl = await people();
  const byEmp = new Map(ppl.filter(p => p.emp).map(p => [String(p.emp).trim().toLowerCase(), p.id]));
  const byName = new Map();
  for (const p of ppl) { const k = normName(p.name); byName.set(k, byName.has(k) ? null : p.id); }
  const loose = (await c.query("SELECT id, person_name, emp_no FROM training_records WHERE user_id IS NULL")).rows;
  let linked = 0;
  for (const r of loose) {
    const id = (r.emp_no && byEmp.get(r.emp_no.trim().toLowerCase())) || byName.get(normName(r.person_name));
    if (id) { await c.query("UPDATE training_records SET user_id = $2 WHERE id = $1", [r.id, id]); linked++; }
  }
  return linked;
}

// ---- FireWorks import ------------------------------------------------------------------------
const FIELDS = {
  name: ["name", "member", "member name", "personnel", "personnel name", "staff", "staff name", "employee", "employee name", "full name", "attendee", "student", "student name", "participant"],
  first: ["first name", "first", "firstname"], last: ["last name", "last", "lastname", "surname"],
  emp: ["employee id", "emp id", "emp", "emp no", "employee number", "employee no", "personnel id", "staff id", "member id", "badge", "id number"],
  date: ["date", "training date", "class date", "start date", "session date", "completed", "completion date", "date completed", "start"],
  hours: ["hours", "hrs", "credit hours", "training hours", "total hours", "duration", "duration hours", "hours credited", "credit", "time"],
  certification: ["certification", "certification name", "certification title", "cert", "program"],
  category: ["subject", "subject name"],
  fwCategory: ["category", "training category", "category name", "class category", "course category", "type", "training type", "class type", "iso category", "code", "training code"],
  topic: ["content title", "content", "content name", "class", "class name", "course", "course name", "course title", "topic", "title", "description", "training", "session", "session name", "class description", "activity"],
  instructor: ["instructor", "instructors", "lead instructor", "taught by"],
  classId: ["class id", "course id", "session id", "record id", "training id", "class number", "event id"],
};
const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normCamel = h => norm(String(h || "").replace(/([a-z])([A-Z])/g, "$1 $2"));
function findHeader(rows) {
  for (let h = 0; h < Math.min(25, rows.length); h++) {
    const hdr = rows[h].map(norm), hc = rows[h].map(normCamel);   // "StaffName" also matches "staff name"
    const idx = {};
    for (const [f, al] of Object.entries(FIELDS)) { let i = hdr.findIndex(x => al.includes(x)); if (i < 0) i = hc.findIndex(x => al.includes(x)); if (i >= 0) idx[f] = i; }
    if (idx.date !== undefined && idx.hours !== undefined && (idx.name !== undefined || idx.last !== undefined || idx.emp !== undefined)) return { h, idx, header: rows[h] };
  }
  return null;
}
function parseDay(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return d.toISOString().slice(0, 10); }
  return null;
}
function parseHours(v) {
  const s = String(v ?? "").trim();
  let m = /^(\d+):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  m = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours)?$/i.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)$/i.exec(s);
  if (m) return Number(m[1]) / 60;
  return NaN;
}
async function parseImport(fileName, data) {
  const { readSheets } = await import("./documents.js");
  const sheets = readSheets(fileName, Buffer.from(String(data || ""), "base64"), 200000);
  for (const sh of sheets) {
    const rows = sh.rows.map(r => Array.from(r, v => (v === null || v === undefined ? "" : v)));
    const f = findHeader(rows);
    if (!f) continue;
    const out = [], bad = [];
    rows.slice(f.h + 1).forEach((r, i) => {
      if (!r.some(v => String(v).trim())) return;
      const g = k => (f.idx[k] === undefined ? "" : String(r[f.idx[k]] ?? "").trim());
      const name = g("name") || [g("first"), g("last")].filter(Boolean).join(" ");
      const day = parseDay(g("date")), hours = parseHours(g("hours"));
      if (!name && !g("emp")) return bad.push({ row: f.h + i + 2, why: "no name" });
      if (!day) return bad.push({ row: f.h + i + 2, why: `date "${g("date")}"` });
      if (!Number.isFinite(hours) || hours < 0 || hours > 48) return bad.push({ row: f.h + i + 2, why: `hours "${g("hours")}"` });
      if (/^total|^grand total/i.test(name)) return;
      out.push({ name: clean(name, 120), emp: clean(g("emp"), 40), day, hours: Math.round(hours * 100) / 100, certification: clean(g("certification"), 160), category: clean(g("category"), 120), fwCategory: clean(g("fwCategory"), 120),
        topic: clean(g("topic"), 300), instructor: clean(g("instructor"), 200), classId: clean(g("classId"), 80) });
    });
    return { sheet: sh.name, header: f.header, columns: Object.keys(f.idx), rows: out, bad };
  }
  throw err(400, "Couldn't find the columns in that file. It needs a header row with the person (Name, or First/Last name, or Employee ID), Date and Hours; Category and Class/Course are used when they're there.");
}
const sourceKey = r => crypto.createHash("sha1").update([r.emp || normName(r.name), r.day, r.classId || r.topic.toLowerCase(), r.category.toLowerCase(), r.hours].join("|")).digest("hex");

// Fill in certification / subject from the content list when the export only has the title
async function fillFromContent(rows) {
  const need = [...new Set(rows.filter(r => r.topic && (!r.certification || !r.category)).map(r => r.topic.toLowerCase()))];
  if (!need.length) return 0;
  const found = new Map();
  for (const x of (await pool.query("SELECT certification, subject, lower(title) AS t FROM training_content WHERE lower(title) = ANY(string_to_array($1, $2))", [need.join("\n"), "\n"])).rows) {
    if (!found.has(x.t)) found.set(x.t, []);
    found.get(x.t).push(x);
  }
  let n = 0;
  for (const r of rows) {
    const opts = found.get(r.topic.toLowerCase());
    if (!opts) continue;
    // A title can be listed under several certifications (firefighter and officer): prefer the one matching what's known
    const pick = opts.find(o => r.certification && o.certification.toLowerCase() === r.certification.toLowerCase()) || opts[0];
    if (!r.certification) r.certification = pick.certification;
    if (!r.category) r.category = pick.subject;
    n++;
  }
  return n;
}

async function importContent(fileName, data) {
  const { readSheets } = await import("./documents.js");
  const sheets = readSheets(fileName, Buffer.from(String(data || ""), "base64"), 50000);
  for (const sh of sheets) {
    const rows = sh.rows;
    for (let h = 0; h < Math.min(20, rows.length); h++) {
      const hdr = rows[h].map(norm);
      const ix = n => hdr.findIndex(x => n.includes(x));
      const ci = ix(["certification"]), si = ix(["subject"]), ti = ix(["content title", "title", "content"]);
      if (ci < 0 || ti < 0) continue;
      const mi = ix(["how is time credited", "credited", "credit"]), ai = ix(["auto assign hours"]), xi = ix(["time spent max hours", "max hours"]), ni = ix(["max times can be counted"]);
      const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
      const out = new Map();
      for (const r of rows.slice(h + 1)) {
        const cert = clean(r[ci], 160), title = clean(r[ti], 300), subj = si >= 0 ? clean(r[si], 120) : "";
        if (!cert || !title) continue;
        out.set(`${cert}|${subj}|${title}`.toLowerCase(), { cert, subj, title, credit: mi >= 0 ? clean(r[mi], 40) : "", auto: ai >= 0 ? num(r[ai]) : null,
          max: xi >= 0 ? num(r[xi]) : null, times: ni >= 0 ? num(r[ni]) : null });
      }
      if (!out.size) continue;
      return [...out.values()];
    }
  }
  throw err(400, "That doesn't look like the FireWorks content list: it needs Certification, Subject and Content Title columns.");
}

// ---- Routes -------------------------------------------------------------------------------------
// Drills, proficiency, company / shift views, roster history, PIAL estimate: server/trainingPlus.js
const PLUS = new Set(["drills", "todo", "proficiency", "company", "shift", "views", "roster", "pial"]);
export async function handleTraining(req, res, parts, user, send, jsonBody, url) {
  const a = parts[2];
  if (PLUS.has(a)) { const { handleTrainingPlus } = await import("./trainingPlus.js"); return handleTrainingPlus(req, res, parts, user, send, jsonBody, url); }
  const acc = await access(user);
  const q = url.searchParams;
  const year = /^\d{4}$/.test(q.get("year") || "") ? Number(q.get("year")) : new Date().getFullYear();
  const asOf = DAY.test(q.get("asOf") || "") ? q.get("asOf") : today();

  if (req.method === "GET" && !a) {
    if (acc.view) await linkRecords();
    const s = await settings();
    const ppl = await people();
    const recs = await recordsFor(year, acc.view ? {} : { userIds: new Set([user.id]) });
    const grouped = byPerson(recs);
    const me = ppl.find(p => p.id === user.id) || { id: user.id, name: user.name, title: "" };
    const list = acc.view ? ppl.map(p => ({ id: p.id, name: p.name, title: p.title || "", division: p.division || "", station: p.station || "",
      ...summarize(p, grouped.get(p.id) || [], s.requirements, s, year, asOf) })) : [];
    const unlinked = acc.view ? [...grouped.entries()].filter(([k]) => k.startsWith("name:")).map(([k, rs]) => ({ name: rs[0].person_name, records: rs.length })) : [];
    const seen = (await pool.query("SELECT fw_category AS name, count(*)::int AS n FROM training_records WHERE fw_category <> '' GROUP BY fw_category ORDER BY n DESC LIMIT 200")).rows;
    const catList = new Map();
    for (const c of s.fwCategories) catList.set(c.name.toLowerCase(), { name: c.name, archived: !!c.archived, n: 0 });
    for (const c of seen) { const k = c.name.toLowerCase(); catList.set(k, { ...(catList.get(k) || { name: c.name, archived: false }), n: c.n }); }
    const contentCount = (await pool.query("SELECT count(*)::int AS n FROM training_content")).rows[0].n;
    const imports = acc.edit ? (await pool.query("SELECT id, file_name, rows_added, rows_skipped, date_from::text, date_to::text, by_name, at FROM training_imports ORDER BY at DESC LIMIT 10")).rows : [];
    return send(res, 200, { access: acc, year, asOf, requirements: s.requirements, catmap: s.catmap, isoKinds: ISO_KINDS, defaults: DEFAULT_REQUIREMENTS,
      me: { id: me.id, name: me.name, title: me.title || "", ...summarize(me, grouped.get(user.id) || [], s.requirements, s, year, asOf) },
      people: list, unlinked, categories: [...catList.values()].map(c => ({ ...c, kind: s.fwmap[c.name.toLowerCase()] || categoryKind(c.name), mapped: !!s.fwmap[c.name.toLowerCase()] })),
      fwmap: s.fwmap, imports, contentCount });
  }

  if (req.method === "GET" && a === "crew") {
    if (!acc.view) throw err(403, "Seeing crews' training needs Training view access.");
    const duty = onDuty();
    const s = await settings();
    const ppl = await people();
    const byName = new Map(ppl.map(p => [normName(p.name), p]));
    const off = new Set((duty.timeOff || []).map(t => normName(t.name)));
    const seen = new Map();
    for (const t of duty.today || []) {
      const k = normName(t.name);
      if (!k || off.has(k)) continue;
      const e = seen.get(k) || { name: t.name, onNow: false, schedules: new Set(), trade: false, start: t.start, stop: t.stop };
      e.onNow = e.onNow || !!t.onNow; e.trade = e.trade || !!t.trade; e.schedules.add(t.scheduleName);
      seen.set(k, e);
    }
    const names = new Set(seen.keys());
    const recs = await recordsFor(year, { userIds: new Set(ppl.filter(p => names.has(normName(p.name))).map(p => p.id)), names });
    const grouped = byPerson(recs);
    const crew = [...seen.entries()].map(([k, e]) => {
      const p = byName.get(k);
      const rs = p ? [...(grouped.get(p.id) || []), ...(grouped.get(`name:${k}`) || [])] : (grouped.get(`name:${k}`) || []);
      return { name: p?.name || e.name, userId: p?.id || null, title: p?.title || "", onNow: e.onNow, trade: e.trade, schedules: [...e.schedules],
        ...summarize(p || { title: "" }, rs, s.requirements, s, year, asOf) };
    }).sort((x, y) => x.name.split(" ").slice(-1)[0].localeCompare(y.name.split(" ").slice(-1)[0]) || x.name.localeCompare(y.name));
    return send(res, 200, { configured: !!duty.configured, updatedAt: duty.updatedAt || null, error: user.role === "master" ? duty.error || "" : "",
      shiftDay: duty.shiftDay || null, crew, year, asOf });
  }

  if (req.method === "GET" && a === "person") {
    const uid = q.get("user"), name = q.get("name");
    if (!(acc.view || uid === user.id || (isUuid(uid) && await (await import("./trainingPlus.js")).inScope(user, uid)))) throw err(403, "You can only see your own training.");
    const s = await settings();
    const p = isUuid(uid) ? (await people()).find(x => x.id === uid) : null;
    const recs = await recordsFor(year, p ? { userIds: new Set([p.id]), names: new Set([normName(p.name)]) } : { userIds: new Set(), names: new Set([normName(name)]) });
    return send(res, 200, {
      person: { id: p?.id || null, name: p?.name || name, title: p?.title || "" },
      ...summarize(p || { title: "" }, recs, s.requirements, s, year, asOf),
      records: recs.filter(r => r.day.slice(0, 4) === String(year)).reverse()
        .map(r => ({ ...r, iso: [...isoKinds(r, s.catmap, s.fwmap)].map(k => ISO_KINDS[k] ? k : "other") })),
    });
  }

  if (req.method === "GET" && a === "content") {
    const needle = clean(q.get("q"), 80).toLowerCase();
    const rows = (await pool.query(
      `SELECT certification, subject, title, credit, auto_hours::float AS auto, max_hours::float AS max FROM training_content
        WHERE $1 = '' OR lower(title) LIKE '%' || $1 || '%' OR lower(subject) LIKE '%' || $1 || '%' OR lower(certification) LIKE '%' || $1 || '%'
        ORDER BY certification, subject, title LIMIT 60`, [needle])).rows;
    const total = (await pool.query("SELECT count(*)::int AS n FROM training_content")).rows[0].n;
    return send(res, 200, { content: rows, total });
  }

  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  if (a === "content") {
    if (!acc.manage) throw err(403, "Only people who manage Training can load the content list.");
    const list = await importContent(clean(b.fileName, 200), b.data);
    await tx(async c => {
      await c.query("DELETE FROM training_content");
      for (const x of list) {
        await c.query(`INSERT INTO training_content (certification, subject, title, credit, auto_hours, max_hours, max_times) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [x.cert, x.subj, x.title, x.credit, x.auto, x.max !== null && x.max < 99999 ? x.max : null, x.times !== null && x.times < 99999 ? x.times : null]);
      }
      // Rows imported earlier without certification / subject get them now
      await c.query(`UPDATE training_records r SET certification = COALESCE(NULLIF(r.certification, ''), t.certification), category = COALESCE(NULLIF(r.category, ''), t.subject)
        FROM (SELECT DISTINCT ON (lower(title)) lower(title) AS lt, certification, subject FROM training_content ORDER BY lower(title), certification) t
        WHERE lower(r.topic) = t.lt AND (r.certification = '' OR r.category = '')`);
      await audit(c, user, "Loaded FireWorks content list", `${clean(b.fileName, 200)}: ${list.length} content titles in ${new Set(list.map(x => x.cert)).size} certifications`);
    });
    return send(res, 200, { loaded: list.length, certifications: new Set(list.map(x => x.cert)).size });
  }

  // FireWorks "Training Category List" (ID, Category, Archived): the categories and whether they're archived
  if (a === "categories") {
    if (!acc.manage) throw err(403, "Only people who manage Training can load the category list.");
    const { readSheets } = await import("./documents.js");
    const sheets = readSheets(clean(b.fileName, 200), Buffer.from(String(b.data || ""), "base64"), 5000);
    let list = null;
    for (const sh of sheets) {
      for (let h = 0; h < Math.min(10, sh.rows.length) && !list; h++) {
        const hdr = sh.rows[h].map(norm);
        const ci = hdr.findIndex(x => ["category", "category name", "training category", "name"].includes(x));
        if (ci < 0) continue;
        const ai = hdr.findIndex(x => ["archived", "inactive"].includes(x));
        list = sh.rows.slice(h + 1).map(r => ({ name: clean(r[ci], 120), archived: ai >= 0 && ["-1", "1", "true", "yes", "y"].includes(String(r[ai] ?? "").trim().toLowerCase()) }))
          .filter(x => x.name);
      }
      if (list) break;
    }
    if (!list || !list.length) throw err(400, "That doesn't look like the FireWorks Training Category List (it needs a Category column).");
    const cur = (await pool.query("SELECT data FROM training_settings WHERE id = 1")).rows[0]?.data || {};
    await tx(async c => {
      await c.query("UPDATE training_settings SET data = $1 WHERE id = 1", [JSON.stringify({ ...cur, fwCategories: list })]);
      await audit(c, user, "Loaded FireWorks categories", `${clean(b.fileName, 200)}: ${list.length} categories (${list.filter(x => !x.archived).length} active)`);
    });
    return send(res, 200, { loaded: list.length, active: list.filter(x => !x.archived).length });
  }

  if (a === "settings") {
    if (!acc.manage) throw err(403, "Only people who manage Training can change requirements.");
    const cur = (await pool.query("SELECT data FROM training_settings WHERE id = 1")).rows[0]?.data || {};
    const next = { ...cur };
    if (Array.isArray(b.requirements)) {
      next.requirements = b.requirements.slice(0, 60).map((r, i) => {
        const hours = Number(r.hours);
        if (!clean(r.label)) throw err(400, `Requirement ${i + 1} needs a name.`);
        if (!(hours > 0 && hours <= 2000)) throw err(400, `"${r.label}": enter the hours required.`);
        for (const k of ["titles", "divisions"]) if (r[k]) { try { new RegExp(r[k], "i"); } catch { throw err(400, `"${r.label}": the ${k === "titles" ? "job titles" : "divisions"} pattern isn't valid.`); } }
        return { id: clean(r.id, 40) || crypto.randomUUID().slice(0, 8), label: clean(r.label, 80), group: clean(r.group, 30) || "Department", hours,
          period: ["month", "quarter", "year", "2years"].includes(r.period) ? r.period : "year", counts: clean(r.counts, 400), titles: clean(r.titles, 200),
          divisions: clean(r.divisions, 200), monthlyCap: Number(r.monthlyCap) > 0 ? Number(r.monthlyCap) : 0, holders: clean(r.holders, 160), note: clean(r.note, 300) };
      });
    }
    if (b.fwmap && typeof b.fwmap === "object") {
      next.fwmap = {};
      for (const [k, v] of Object.entries(b.fwmap).slice(0, 500)) if (ISO_KINDS[v]) next.fwmap[String(k).toLowerCase().trim().slice(0, 120)] = v;
    }
    if (b.catmap && typeof b.catmap === "object") {
      next.catmap = {};
      for (const [k, v] of Object.entries(b.catmap).slice(0, 500)) if (ISO_KINDS[v]) next.catmap[String(k).toLowerCase().slice(0, 120)] = v;
    }
    await tx(async c => {
      await c.query("UPDATE training_settings SET data = $1 WHERE id = 1", [JSON.stringify(next)]);
      await audit(c, user, "Changed training settings", `${(next.requirements || []).length} requirements, ${Object.keys(next.fwmap || {}).length} FireWorks category mappings`);
    });
    return send(res, 200, { ok: true });
  }

  if (!acc.edit) throw err(403, "Only people with Training edit access can enter or import training hours.");

  if (a === "import") {
    const p = await parseImport(clean(b.fileName, 200), b.data);
    const filled = await fillFromContent(p.rows);
    if (!p.rows.length) throw err(400, `No training rows found${p.bad.length ? ` (${p.bad.length} rows couldn't be read: ${p.bad.slice(0, 3).map(x => `row ${x.row} ${x.why}`).join(", ")})` : ""}.`);
    const keys = p.rows.map(sourceKey);
    const existing = new Set((await pool.query("SELECT source_key FROM training_records WHERE source_key = ANY(string_to_array($1, ','))", [keys.join(",")])).rows.map(r => r.source_key));
    // Not already imported, and not repeated within the file
    const take = new Set();
    p.rows.forEach((r, i) => { if (!existing.has(keys[i]) && ![...take].some(j => keys[j] === keys[i])) take.add(i); });
    const fresh = p.rows.filter((r, i) => take.has(i));
    const ppl = await people();
    const byName = new Map(ppl.map(x => [normName(x.name), x]));
    const byEmp = new Map(ppl.filter(x => x.emp).map(x => [String(x.emp).toLowerCase(), x]));
    const names = [...new Set(p.rows.map(r => r.name))];
    const unmatched = names.filter(n => !byName.has(normName(n)) && !p.rows.some(r => r.name === n && r.emp && byEmp.has(r.emp.toLowerCase())));
    const days = p.rows.map(r => r.day).sort();
    const summary = { sheet: p.sheet, columns: p.columns, filledFromContent: filled, rows: p.rows.length, newRows: fresh.length, duplicates: p.rows.length - fresh.length, bad: p.bad.slice(0, 20), badCount: p.bad.length,
      people: names.length, unmatched: unmatched.slice(0, 40), unmatchedCount: unmatched.length, from: days[0], to: days[days.length - 1],
      hours: r1(fresh.reduce((s, r) => s + r.hours, 0)), sample: p.rows.slice(0, 8),
      categories: [...new Set(p.rows.map(r => r.fwCategory).filter(Boolean))].slice(0, 30) };
    if (b.preview) return send(res, 200, { preview: summary });
    const importId = crypto.randomUUID();
    await tx(async c => {
      for (let i = 0; i < p.rows.length; i++) {
        if (!take.has(i)) continue;
        const r = p.rows[i];
        const u = (r.emp && byEmp.get(r.emp.toLowerCase())) || byName.get(normName(r.name));
        await c.query(`INSERT INTO training_records (id, user_id, person_name, emp_no, day, hours, certification, category, fw_category, topic, instructor, source, source_key, import_id, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'fireworks',$12,$13,$14) ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), u?.id || null, r.name, r.emp, r.day, r.hours, r.certification, r.category, r.fwCategory, r.topic, r.instructor, keys[i], importId, user.id]);
      }
      await c.query(`INSERT INTO training_imports (id, file_name, rows_added, rows_skipped, date_from, date_to, by_id, by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [importId, clean(b.fileName, 200), fresh.length, p.rows.length - fresh.length, summary.from, summary.to, user.id, user.name]);
      await audit(c, user, "Imported FireWorks training", `${clean(b.fileName, 200)}: ${fresh.length} new rows (${summary.hours} h, ${summary.from} to ${summary.to}), ${p.rows.length - fresh.length} already there`);
    });
    summary.drillsMatched = await (await import("./trainingPlus.js")).supersedeDrills();
    return send(res, 200, { imported: summary });
  }

  if (a === "records" && !parts[3]) {
    const day = String(b.day || "");
    if (!DAY.test(day)) throw err(400, "Choose the date.");
    const hours = Number(b.hours);
    if (!(hours > 0 && hours <= 48)) throw err(400, "Enter the hours (up to 48).");
    if (!clean(b.topic) && !clean(b.category) && !clean(b.fwCategory)) throw err(400, "Enter the class or category.");
    const ids = (Array.isArray(b.userIds) ? b.userIds : [b.userId]).filter(isUuid).slice(0, 200);
    const ppl = new Map((await people()).map(p => [p.id, p]));
    const who = ids.map(id => ppl.get(id)).filter(Boolean);
    if (!who.length && !clean(b.name)) throw err(400, "Choose who attended.");
    await tx(async c => {
      for (const p of who.length ? who : [{ id: null, name: clean(b.name, 120) }]) {
        await c.query(`INSERT INTO training_records (id, user_id, person_name, day, hours, certification, category, fw_category, topic, instructor, source, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11)`, [crypto.randomUUID(), p.id, p.name, day, hours, clean(b.certification, 160), clean(b.category, 120), clean(b.fwCategory, 120), clean(b.topic, 300), clean(b.instructor, 200), user.id]);
      }
      await audit(c, user, "Entered training hours", `${clean(b.topic || b.category, 120)} ${day}, ${hours} h: ${(who.length ? who.map(p => p.name) : [clean(b.name)]).join(", ").slice(0, 600)}`);
    });
    return send(res, 200, { ok: true, added: Math.max(1, who.length) });
  }
  if (a === "records" && isUuid(parts[3]) && parts[4] === "remove") {
    await tx(async c => {
      const r = (await c.query("DELETE FROM training_records WHERE id = $1 RETURNING person_name, day::text, hours::float, topic, category", [parts[3]])).rows[0];
      if (!r) throw err(404, "That record wasn't found.");
      await audit(c, user, "Removed training hours", `${r.person_name}: ${r.topic || r.category} ${r.day}, ${r.hours} h`);
    });
    return send(res, 200, { ok: true });
  }
  if (a === "link") return send(res, 200, { linked: await linkRecords() });
  throw err(404, "Not found");
}

export async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query("INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Training', $4, $5)",
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 1000)]);
}
