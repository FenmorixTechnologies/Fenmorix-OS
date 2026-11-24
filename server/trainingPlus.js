// Training, part 2: crew drills (logged by company officers, confirmed by the crew, verified by Training), proficiency
// checks kept apart from hours, company and shift (battalion) views, the grading-year roster history, and the PIAL
// training estimate from Nexus data. Routes under /api/training (server/training.js hands these over):
//
//   GET  /api/training/views                           what this person can open: companies, shifts, role
//   GET  /api/training/todo                            Your Day: drills to confirm / verify / fix
//   GET  /api/training/drills        ?status&from&to   drills visible to this person
//   GET  /api/training/drills/:id
//   GET  /api/training/drills/export.csv ?from&to      verified drills, one row per person, for entry in FireWorks (edit)
//   POST /api/training/drills                          {id?, day, start, end, hours, station, shift, units, location, atFacility, kind,
//                                                       delivery, certification, subject, fwCategory, topic, objectives, instructor,
//                                                       people: [{userId|name, hours}], skills: [{userId, skillId, result, note}],
//                                                       submit, signature}
//   POST /api/training/drills/:id/confirm              {dispute?}        an attendee
//   POST /api/training/drills/:id/verify                                 Training edit: makes the training records
//   POST /api/training/drills/:id/return               {note}            Training edit: back to the officer
//   POST /api/training/drills/:id/remove
//   GET  /api/training/proficiency   ?station&shift    skills x people (scope as the company / shift views)
//   POST /api/training/proficiency/check               {userIds, skillId, day, result, note}
//   POST /api/training/proficiency/settings            {skills, roles}   (manage)
//   GET  /api/training/company       ?station&shift&year
//   GET  /api/training/shift         ?shift&year
//   GET  /api/training/roster        ?year             (view; keeps the current year in step with accounts)
//   POST /api/training/roster                          {id?, year, ...}  (manage)
//   POST /api/training/roster/:id/remove                                 (manage)
//   POST /api/training/roster/start                    {year}            (manage) start a year's roster from today's accounts
//   GET  /api/training/pial          ?year             PIAL training items from Nexus training + this roster
//
// Who sees what: Training view = everyone. Otherwise a company officer (job title matches roles.officer) sees their own
// company (home station + shift from the directory card / work pattern), a battalion chief (roles.bc) their whole shift.
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { access, settings, summarize, recordsFor, byPerson, isoKinds, normName, ISO_KINDS, audit } from "./training.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const r1 = n => Math.round(n * 10) / 10;
const today = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const stationKey = v => { const s = String(v || "").trim().toLowerCase(); const n = s.match(/\d+/); return n ? String(Number(n[0])) : s; };
const shiftOf = pattern => (/^fire:([ABC])$/.exec(String(pattern || "")) || [])[1] || "";

// ---- Settings: roles and the proficiency skill list --------------------------------------------------
export const DEFAULT_ROLES = { officer: "captain|lieutenant|\\blt\\b|capt\\b|company officer", bc: "battalion|\\bbc\\b|district chief|shift commander",
  driver: "operator|engineer|driver|d/o", rosterDivisions: "suppression|operations" };
// A starting list (edit in Requirements & settings). `every` = months a check stays current; `who` = job titles (regex, empty = everyone).
export const DEFAULT_SKILLS = [
  { id: "scba", label: "SCBA donning and emergency procedures", every: 6, who: "", standard: "Don SCBA and go on air within 60 seconds; low-air and entanglement procedures." },
  { id: "hoseline", label: "Advance and operate a charged 1¾\" line", every: 6, who: "", standard: "Stretch, flow and advance with proper nozzle technique and communication." },
  { id: "mayday", label: "Mayday and self-rescue", every: 6, who: "", standard: "Call a Mayday with LUNAR; self-rescue and air management." },
  { id: "ladders", label: "Ground ladders", every: 12, who: "", standard: "Carry, raise and climb 24' and 35' ladders safely." },
  { id: "search", label: "Primary search and victim removal", every: 12, who: "", standard: "Oriented search, communication and victim removal." },
  { id: "forcible", label: "Forcible entry", every: 12, who: "", standard: "Inward and outward swinging doors with irons." },
  { id: "water-supply", label: "Water supply from a hydrant", every: 12, who: "", standard: "Hydrant connection and supply line with the operator." },
  { id: "ventilation", label: "Ventilation", every: 12, who: "", standard: "Horizontal and positive-pressure ventilation, coordinated with fire attack." },
  { id: "pump", label: "Pump operations", every: 6, who: "operator|engineer|driver|d/o", standard: "Put a line in service at the right pressure and change to an external supply before the tank runs dry." },
  { id: "size-up", label: "Size-up and initial radio report", every: 6, who: "captain|lieutenant|\\blt\\b|capt\\b|battalion|chief", standard: "Complete initial report, command and assignments." },
];
async function plusSettings() {
  const st = await settings();
  const d = (await pool.query("SELECT data FROM training_settings WHERE id = 1")).rows[0]?.data || {};
  return { ...st, roles: { ...DEFAULT_ROLES, ...(d.roles || {}) }, skills: Array.isArray(d.skills) && d.skills.length ? d.skills : DEFAULT_SKILLS };
}
const re = (pat, s) => { try { return !!pat && new RegExp(pat, "i").test(String(s || "")); } catch { return false; } };

// ---- People and scope ---------------------------------------------------------------------------------
async function allPeople() {
  return (await pool.query(`SELECT u.id, u.full_name AS name, u.job_title AS title, u.station, u.work_pattern, u.employee_number AS emp, u.hire_date::text AS hire,
      d.name AS division FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.active ORDER BY u.full_name`)).rows
    .map(p => ({ ...p, title: p.title || "", stationKey: stationKey(p.station), shift: shiftOf(p.work_pattern) }));
}
async function meOf(user) {
  return (await allPeople()).find(p => p.id === user.id) || { id: user.id, name: user.name, title: "", stationKey: "", shift: "" };
}
// What a person can see beyond themselves
async function scopeFor(user, acc, st) {
  if (acc.view) return { all: true, role: "training" };
  const me = await meOf(user);
  if (re(st.roles.bc, me.title) && me.shift) return { all: false, role: "bc", shift: me.shift, me };
  if (re(st.roles.officer, me.title) && me.stationKey && me.shift) return { all: false, role: "officer", shift: me.shift, station: me.stationKey, me };
  return { all: false, role: "member", me };
}
const covers = (sc, station, shift) => sc.all || (sc.role === "bc" && shift === sc.shift) || (sc.role === "officer" && shift === sc.shift && stationKey(station) === sc.station);
// Can this person see another person's training? (used by GET /api/training/person too)
export async function inScope(user, otherId) {
  const acc = await access(user);
  if (acc.view) return true;
  const st = await plusSettings();
  const sc = await scopeFor(user, acc, st);
  if (sc.role === "member") return false;
  const p = (await allPeople()).find(x => x.id === otherId);
  return !!p && covers(sc, p.stationKey, p.shift);
}
const canLog = (acc, sc) => acc.edit || sc.role === "officer" || sc.role === "bc";

// ---- Drills -------------------------------------------------------------------------------------------
const KINDS = ["company", "facility", "officer", "driver", "hazmat", "ims", "other"];
const DELIVERY = { inhouse: "In-house (in person)", virtual: "Interactive virtual (Zoom/Teams)", cbt: "Online / computer-based", outside: "Outside the department" };
const drillJson = (d, people = [], skills = [], viewer) => ({
  id: d.id, day: d.day, start: d.start_time ? String(d.start_time).slice(0, 5) : "", end: d.end_time ? String(d.end_time).slice(0, 5) : "", hours: Number(d.hours),
  station: d.station, shift: d.shift, units: d.units, location: d.location, atFacility: d.at_facility, kind: d.kind, delivery: d.delivery,
  certification: d.certification, subject: d.subject, fwCategory: d.fw_category, topic: d.topic, objectives: d.objectives, instructor: d.instructor,
  status: d.status, officerId: d.officer_id, officer: d.officer_name, signed: !!d.officer_signature, signature: viewer ? d.officer_signature || null : null,
  submittedAt: d.submitted_at, verifiedBy: d.verified_name, verifiedAt: d.verified_at, returnNote: d.return_note, updatedAt: d.updated_at,
  people: people.map(p => ({ id: p.id, userId: p.user_id, name: p.name, hours: Number(p.hours), confirmedAt: p.confirmed_at, disputed: p.disputed, recordId: p.record_id,
    inFireWorks: !!p.superseded })),
  skills: skills.map(k => ({ id: k.id, userId: k.user_id, name: k.name, skillId: k.skill_id, result: k.result, note: k.note })),
});
async function loadDrill(id) {
  const d = (await pool.query("SELECT *, day::text AS day FROM training_drills WHERE id = $1", [id])).rows[0];
  if (!d) return null;
  const people = (await pool.query(`SELECT p.*, (r.superseded_by IS NOT NULL) AS superseded FROM training_drill_people p LEFT JOIN training_records r ON r.id = p.record_id
    WHERE p.drill_id = $1 ORDER BY p.name`, [id])).rows;
  const skills = (await pool.query("SELECT * FROM training_skill_checks WHERE drill_id = $1 ORDER BY name, skill_id", [id])).rows;
  return { d, people, skills };
}
function canSeeDrill(user, acc, sc, x) {
  return acc.view || x.d.officer_id === user.id || x.people.some(p => p.user_id === user.id) || covers(sc, x.d.station, x.d.shift);
}
function hoursFrom(start, end) {
  if (!TIME.test(start) || !TIME.test(end)) return null;
  const m = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let d = m(end) - m(start); if (d <= 0) d += 1440;
  return Math.round(d / 15) / 4;
}
function sigOk(v) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(v || "")) || String(v).length > 280000) throw err(400, "Sign the drill log to submit it.");
  return v;
}
async function notify(user, ids, subject, body) {
  const to = [...new Set(ids.filter(id => isUuid(id) && id !== user.id))];
  if (!to.length) return;
  try { const { send } = await import("./messages.js"); await send(user, { users: to, subject, body }); } catch (e) { console.error("training notify:", e.message); }
}

// A FireWorks row for the same person, day and hours (±0.5) replaces the drill's record, so it isn't counted twice
export async function supersedeDrills(c = pool) {
  const r = await c.query(`UPDATE training_records d SET superseded_by = f.id FROM training_records f
      WHERE d.drill_id IS NOT NULL AND d.superseded_by IS NULL AND f.source = 'fireworks' AND f.superseded_by IS NULL
        AND f.user_id = d.user_id AND f.day = d.day AND abs(f.hours - d.hours) <= 0.5`);
  return r.rowCount || 0;
}

// ---- Proficiency --------------------------------------------------------------------------------------
function skillsFor(person, skills) { return skills.filter(k => !k.who || re(k.who, person.title)); }
// Latest final check per person + skill -> status
function skillStatus(skill, checks, asOf) {
  const last = checks[0];
  const pending = checks.find(c => c.status === "pending");
  const fin = checks.filter(c => c.status === "final");
  const l = fin[0];
  if (!l) return { status: pending ? "pending" : "never", last: null, due: null };
  const due = addMonths(l.day, Number(skill.every) || 12);
  if (l.result === "not_met") return { status: "retrain", last: l.day, due: null, note: l.note, lastAny: last?.day };
  const soon = addMonths(asOf, 1);
  return { status: due < asOf ? "overdue" : due <= soon ? "due" : "current", last: l.day, due, pending: !!pending && pending.day > l.day };
}
async function checksFor(userIds) {
  if (!userIds.length) return new Map();
  const rows = (await pool.query(`SELECT user_id, skill_id, day::text AS day, result, status, note FROM training_skill_checks
      WHERE user_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY day DESC, created_at DESC`, [userIds.join(",")])).rows;
  const m = new Map();
  for (const r of rows) { const k = `${r.user_id}|${r.skill_id}`; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
async function proficiencyFor(people, st, asOf) {
  const checks = await checksFor(people.map(p => p.id));
  return people.map(p => {
    const list = skillsFor(p, st.skills).map(k => ({ id: k.id, ...skillStatus(k, checks.get(`${p.id}|${k.id}`) || [], asOf) }));
    const count = s => list.filter(x => x.status === s).length;
    return { userId: p.id, skills: list, current: count("current"), due: count("due"), overdue: count("overdue"), never: count("never"), retrain: count("retrain"), total: list.length };
  });
}

// ---- Roster history -----------------------------------------------------------------------------------
const rosterJson = r => ({ id: r.id, year: r.year, userId: r.user_id, name: r.name, empNo: r.emp_no, title: r.title, division: r.division, station: r.station, shift: r.shift,
  joined: r.joined, left: r.left_on, officer: r.officer, driver: r.driver, driverSince: r.driver_since, hireDate: r.hire_date, suppression: r.suppression,
  source: r.source, locked: r.locked, changes: r.changes || [], note: r.note });
async function rosterRows(year) {
  return (await pool.query(`SELECT *, joined::text AS joined, left_on::text AS left_on, driver_since::text AS driver_since, hire_date::text AS hire_date
    FROM training_roster WHERE year = $1 ORDER BY name`, [year])).rows;
}
// Keep the current year's roster in step with accounts: new suppression members join, people who leave get an end date,
// rank / station / shift changes are noted. Rows edited by hand (locked) are left alone. Past years aren't touched.
export async function syncRoster(year, { force = false } = {}) {
  const now = today();
  if (!force && Number(now.slice(0, 4)) !== year) return 0;
  const st = await plusSettings();
  const ppl = await allPeople();
  const inactive = (await pool.query("SELECT id FROM users WHERE NOT active")).rows.map(r => r.id);
  const rows = await rosterRows(year);
  const byUser = new Map(rows.filter(r => r.user_id).map(r => [r.user_id, r]));
  const start = `${year}-01-01`, first = rows.length === 0;
  let n = 0;
  await tx(async c => {
    for (const p of ppl) {
      const supp = re(st.roles.rosterDivisions, p.division);
      const officer = re(st.roles.officer, p.title) || re(st.roles.bc, p.title), driver = re(st.roles.driver, p.title);
      const r = byUser.get(p.id);
      if (!r) {
        if (!supp) continue;
        const joined = p.hire && p.hire >= start && p.hire.slice(0, 4) === String(year) ? p.hire : first || force ? start : now;
        await c.query(`INSERT INTO training_roster (id, year, user_id, name, emp_no, title, division, station, shift, joined, officer, driver, driver_since, hire_date, suppression, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,'auto')`,
          [crypto.randomUUID(), year, p.id, p.name, p.emp || "", p.title, p.division || "", p.stationKey, p.shift, joined, officer, driver, null, p.hire || null]);
        n++; continue;
      }
      if (r.locked) continue;
      const changes = [];
      if (!supp && !r.left_on) changes.push(["left_on", now, `moved out of suppression (${p.division || "no division"})`]);
      if (supp && r.left_on && r.source === "auto") changes.push(["left_on", null, "back on the roster"]);
      if (r.title !== p.title) changes.push(["title", p.title, `title ${r.title || "—"} → ${p.title || "—"}`]);
      if (r.officer !== officer) changes.push(["officer", officer, officer ? "now an officer" : "no longer an officer"]);
      if (r.driver !== driver) { changes.push(["driver", driver, driver ? "now a driver/operator" : "no longer a driver/operator"]); if (driver && !r.driver_since) changes.push(["driver_since", now, ""]); }
      if (r.station !== p.stationKey) changes.push(["station", p.stationKey, `station ${r.station || "—"} → ${p.stationKey || "—"}`]);
      if (r.shift !== p.shift) changes.push(["shift", p.shift, `shift ${r.shift || "—"} → ${p.shift || "—"}`]);
      if (r.name !== p.name) changes.push(["name", p.name, ""]);
      if (!changes.length) continue;
      const log = [...(r.changes || []), ...changes.filter(x => x[2]).map(x => ({ at: now, what: x[2] }))].slice(-40);
      const sets = changes.map((x, i) => `${x[0]} = $${i + 2}`).join(", ");
      await c.query(`UPDATE training_roster SET ${sets}, changes = $${changes.length + 2}, updated_at = now() WHERE id = $1`, [r.id, ...changes.map(x => x[1]), JSON.stringify(log)]);
      n++;
    }
    for (const id of inactive) {
      const r = byUser.get(id);
      if (r && !r.locked && !r.left_on) {
        await c.query("UPDATE training_roster SET left_on = $2, changes = $3, updated_at = now() WHERE id = $1",
          [r.id, now, JSON.stringify([...(r.changes || []), { at: now, what: "account deactivated" }].slice(-40))]);
        n++;
      }
    }
  });
  return n;
}

// ---- PIAL: the roster + Nexus training records in the shape pial.js's training model uses ------------------
const DELIVERY_GUESS = r => {
  if (["cbt", "outside", "inhouse", "virtual"].includes(r.delivery)) return r.delivery === "virtual" ? "inhouse" : r.delivery;
  const t = `${r.fw_category || ""} ${r.topic || ""} ${r.certification || ""}`.toLowerCase();
  if (/online|\bcbt\b|computer[- ]based|target ?solutions|vector|e-?learning|self-paced/.test(t)) return "cbt";
  if (/outside|conference|seminar|college|university|lsu|fire school|academy (?:at|by)|lfa/.test(t)) return "outside";
  return "inhouse";
};
export async function pialTrainingData(year) {
  const st = await settings();
  await syncRoster(year);
  const roster = (await rosterRows(year)).filter(r => r.suppression);
  const members = roster.map(r => ({ key: `r:${r.id}`, employee_id: r.emp_no, name: r.name, rank: r.title, position: r.title, rank_date: null,
    hire_date: r.hire_date && r.hire_date >= `${year}-01-01` ? r.hire_date : r.joined > `${year}-01-01` ? r.joined : r.hire_date, end_date: r.left_on,
    shift: r.shift, officer: r.officer, driver: r.driver, driver_since: r.driver_since, suppression: true }));
  const byUser = new Map(roster.filter(r => r.user_id).map(r => [r.user_id, `r:${r.id}`]));
  const byName = new Map(roster.map(r => [normName(r.name), `r:${r.id}`]));
  const recs = (await pool.query(`SELECT user_id, person_name, day::text AS d, hours::float AS h, certification, category, fw_category, topic, delivery
      FROM training_records WHERE day BETWEEN $1 AND $2 AND superseded_by IS NULL`, [`${year}-01-01`, `${year}-12-31`])).rows;
  const training = [];
  for (const r of recs) {
    const key = (r.user_id && byUser.get(r.user_id)) || byName.get(normName(r.person_name));
    if (!key) continue;
    const kinds = isoKinds(r, st.catmap, st.fwmap);
    const recruit = /recruit|academy/i.test(`${r.certification} ${r.category} ${r.topic}`);
    const cat = recruit ? "recruit" : ["officer", "driver", "hazmat", "ims", "company", "facility", "other"].find(k => kinds.has(k)) || "other";
    training.push({ member_key: key, member_name: r.person_name, d: r.d, h: r.h, src: `nexus:${cat === "facility" ? "company" : cat}`, at_facility: kinds.has("facility"), delivery: DELIVERY_GUESS(r) });
  }
  // Certifications from the PIAL tracker's certification import, matched to the roster by name
  const pm = (await pool.query("SELECT key, name FROM pial_members")).rows;
  const pmName = new Map(pm.map(m => [m.key, normName(m.name)]));
  const certs = (await pool.query("SELECT member_key, title, cert_date::text, ifsac FROM pial_certs")).rows
    .map(c => ({ ...c, member_key: byName.get(pmName.get(c.member_key)) })).filter(c => c.member_key);
  const catmap = new Map(["company", "officer", "driver", "hazmat", "ims", "recruit", "other"].map(k => [`nexus:${k}`, k]));
  return { members, training, certs, catmap, roster: roster.length };
}

// ---- Company / shift summaries ---------------------------------------------------------------------
async function summaries(people, year, asOf) {
  const st = await plusSettings();
  const recs = await recordsFor(year, { userIds: new Set(people.map(p => p.id)) });
  const g = byPerson(recs);
  const prof = await proficiencyFor(people, st, asOf);
  const onDutyNames = await dutyNames();
  return people.map((p, i) => {
    const s = summarize(p, g.get(p.id) || [], st.requirements, st, year, asOf);
    const company = s.requirements.find(r => r.id === "iso-company");
    return { id: p.id, name: p.name, title: p.title, station: p.stationKey, shift: p.shift, onDuty: onDutyNames.has(normName(p.name)),
      totalHours: s.totalHours, missingCount: s.missingCount, behindCount: s.behindCount, requirements: s.requirements,
      company: company ? { done: company.done, required: company.required, pace: company.pace, behind: company.behind } : null, proficiency: prof[i] };
  });
}
async function dutyNames() {
  try { const { onDuty } = await import("./aladtec.js"); const d = onDuty(); const off = new Set((d.timeOff || []).map(t => normName(t.name)));
    return new Set((d.today || []).map(t => normName(t.name)).filter(n => n && !off.has(n))); } catch { return new Set(); }
}
async function drillsSummary(where, params) {
  return (await pool.query(`SELECT d.station, d.shift, d.status, count(*)::int AS n, sum(d.hours)::float AS hours,
      count(*) FILTER (WHERE d.day >= date_trunc('month', current_date))::int AS this_month
    FROM training_drills d WHERE ${where} GROUP BY d.station, d.shift, d.status`, params)).rows;
}
const rollup = list => {
  const n = list.length, avg = f => (n ? r1(list.reduce((a, x) => a + f(x), 0) / n) : 0);
  return { members: n, avgCompany: avg(x => x.company?.done || 0), behind: list.filter(x => x.company?.behind).length,
    missing: list.filter(x => x.missingCount > 0).length, profOverdue: list.reduce((a, x) => a + x.proficiency.overdue + x.proficiency.retrain, 0),
    profDue: list.reduce((a, x) => a + x.proficiency.due, 0), profNever: list.reduce((a, x) => a + x.proficiency.never, 0), onDuty: list.filter(x => x.onDuty).length };
};

// ---- Routes ---------------------------------------------------------------------------------------
export async function handleTrainingPlus(req, res, parts, user, send, jsonBody, url) {
  const a = parts[2], b = parts[3], c3 = parts[4];
  const acc = await access(user);
  const st = await plusSettings();
  const sc = await scopeFor(user, acc, st);
  const q = url.searchParams;
  const year = /^\d{4}$/.test(q.get("year") || "") ? Number(q.get("year")) : new Date().getFullYear();
  const asOf = today();

  if (req.method === "GET" && a === "views") {
    const ppl = await allPeople();
    const companies = [...new Set(ppl.filter(p => p.stationKey && p.shift && re(st.roles.rosterDivisions, p.division)).map(p => `${p.stationKey}|${p.shift}`))].sort()
      .map(k => ({ station: k.split("|")[0], shift: k.split("|")[1] })).filter(x => covers(sc, x.station, x.shift));
    const shifts = sc.all ? ["A", "B", "C"] : sc.role === "bc" ? [sc.shift] : [];
    return send(res, 200, { me: user.id, role: sc.role, station: sc.station || sc.me?.stationKey || "", shift: sc.shift || sc.me?.shift || "", companies, shifts,
      canLog: canLog(acc, sc), canVerify: acc.edit, canManage: acc.manage, skills: st.skills, roles: st.roles, kinds: ISO_KINDS, delivery: DELIVERY });
  }

  if (req.method === "GET" && a === "todo") {
    const confirm = (await pool.query(`SELECT count(*)::int AS n FROM training_drill_people p JOIN training_drills d ON d.id = p.drill_id
      WHERE p.user_id = $1 AND p.confirmed_at IS NULL AND p.disputed = '' AND d.status IN ('submitted','verified') AND d.officer_id IS DISTINCT FROM $1 AND d.day >= current_date - 60`, [user.id])).rows[0].n;
    const verify = acc.edit ? (await pool.query("SELECT count(*)::int AS n FROM training_drills WHERE status = 'submitted' AND officer_id IS DISTINCT FROM $1", [user.id])).rows[0].n : 0;
    const returned = (await pool.query("SELECT count(*)::int AS n FROM training_drills WHERE status = 'returned' AND officer_id = $1", [user.id])).rows[0].n;
    return send(res, 200, { confirm, verify, returned });
  }

  // ---- drills ----
  if (a === "drills") {
    if (req.method === "GET" && b === "export.csv") {
      if (!acc.edit) throw err(403, "Exporting drills needs Training edit access.");
      const from = DAY.test(q.get("from") || "") ? q.get("from") : `${year}-01-01`, to = DAY.test(q.get("to") || "") ? q.get("to") : `${year}-12-31`;
      const rows = (await pool.query(`SELECT d.day::text AS day, d.hours::float AS dh, d.certification, d.subject, d.fw_category, d.topic, d.instructor, d.officer_name, d.location,
          p.name, p.hours::float AS hours, u.employee_number AS emp, (r.superseded_by IS NOT NULL) AS infw
        FROM training_drills d JOIN training_drill_people p ON p.drill_id = d.id LEFT JOIN users u ON u.id = p.user_id LEFT JOIN training_records r ON r.id = p.record_id
        WHERE d.status = 'verified' AND d.day BETWEEN $1 AND $2 AND p.hours > 0 ORDER BY d.day, d.topic, p.name`, [from, to])).rows;
      const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = ["Name,Employee ID,Date,Hours,Certification,Subject,Category,Content Title,Instructor,Location,Logged by,Already in FireWorks",
        ...rows.map(r => [r.name, r.emp, r.day, r.hours, r.certification, r.subject, r.fw_category, r.topic, r.instructor, r.location, r.officer_name, r.infw ? "yes" : "no"].map(esc).join(","))].join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="drills-${from}-to-${to}.csv"`, "Cache-Control": "no-store" });
      return res.end("﻿" + csv);
    }
    if (req.method === "GET" && !b) {
      const status = clean(q.get("status"), 20);
      const from = DAY.test(q.get("from") || "") ? q.get("from") : `${year}-01-01`, to = DAY.test(q.get("to") || "") ? q.get("to") : `${year}-12-31`;
      const rows = (await pool.query(`SELECT d.*, d.day::text AS day,
          (SELECT count(*)::int FROM training_drill_people p WHERE p.drill_id = d.id) AS n,
          (SELECT count(*)::int FROM training_drill_people p WHERE p.drill_id = d.id AND p.confirmed_at IS NOT NULL) AS confirmed,
          (SELECT count(*)::int FROM training_drill_people p WHERE p.drill_id = d.id AND p.disputed <> '') AS disputed,
          (SELECT count(*)::int FROM training_drill_people p JOIN training_records r ON r.id = p.record_id WHERE p.drill_id = d.id AND r.superseded_by IS NOT NULL) AS infw,
          EXISTS (SELECT 1 FROM training_drill_people p WHERE p.drill_id = d.id AND p.user_id = $3) AS attended
        FROM training_drills d WHERE d.day BETWEEN $1 AND $2 ORDER BY d.day DESC, d.created_at DESC LIMIT 1000`, [from, to, user.id])).rows;
      const list = rows.filter(d => acc.view || d.officer_id === user.id || d.attended || covers(sc, d.station, d.shift))
        .filter(d => !status || d.status === status || (status === "open" && ["draft", "submitted", "returned"].includes(d.status)))
        .filter(d => d.status !== "draft" || d.officer_id === user.id || acc.edit);
      return send(res, 200, { drills: list.map(d => ({ ...drillJson(d), people: undefined, skills: undefined, count: d.n, confirmed: d.confirmed, disputed: d.disputed, inFireWorks: d.infw, attended: d.attended })) });
    }
    if (req.method === "GET" && isUuid(b)) {
      const x = await loadDrill(b);
      if (!x || !canSeeDrill(user, acc, sc, x) || (x.d.status === "draft" && x.d.officer_id !== user.id && !acc.edit)) throw err(404, "That drill wasn't found.");
      return send(res, 200, { drill: drillJson(x.d, x.people, x.skills, true), canEdit: ["draft", "returned"].includes(x.d.status) && (x.d.officer_id === user.id || acc.edit),
        canVerify: acc.edit && x.d.status === "submitted" && (x.d.officer_id !== user.id || user.role === "master"), mine: (m => m ? { hours: Number(m.hours), confirmedAt: m.confirmed_at, disputed: m.disputed } : null)(x.people.find(p => p.user_id === user.id)) });
    }
    if (req.method !== "POST") throw err(404, "Not found");
    const body = await jsonBody(req);

    if (!b) {
      if (!canLog(acc, sc)) throw err(403, "Logging drills is for company officers, battalion chiefs and Training.");
      const old = isUuid(body.id) ? await loadDrill(body.id) : null;
      if (body.id && !old) throw err(404, "That drill wasn't found.");
      if (old && !(["draft", "returned"].includes(old.d.status) && (old.d.officer_id === user.id || acc.edit))) throw err(409, "This drill was already submitted. Training can send it back if something needs to change.");
      const day = String(body.day || "");
      if (!DAY.test(day)) throw err(400, "Choose the date.");
      if (day > asOf) throw err(400, "The drill date can't be in the future.");
      const start = TIME.test(body.start || "") ? body.start : null, end = TIME.test(body.end || "") ? body.end : null;
      const hours = Number(body.hours) > 0 ? Math.round(Number(body.hours) * 4) / 4 : hoursFrom(start, end);
      if (!(hours > 0 && hours <= 24)) throw err(400, "Enter the hours (or start and end times).");
      const topic = clean(body.topic, 300);
      if (!topic) throw err(400, "What was the drill? Enter the topic or content title.");
      const station = stationKey(body.station), shift = ["A", "B", "C"].includes(body.shift) ? body.shift : "";
      if (!acc.edit && !covers(sc, station, shift)) throw err(403, sc.role === "officer" ? `You can log drills for Station ${sc.station}, ${sc.shift} shift.` : `You can log drills for ${sc.shift} shift.`);
      const kind = KINDS.includes(body.kind) ? body.kind : "company";
      const delivery = DELIVERY[body.delivery] ? body.delivery : "inhouse";
      const ppl = new Map((await allPeople()).map(p => [p.id, p]));
      const people = [];
      for (const p of (Array.isArray(body.people) ? body.people : []).slice(0, 80)) {
        const u = isUuid(p.userId) ? ppl.get(p.userId) : null;
        const name = u?.name || clean(p.name, 120);
        if (!name) continue;
        const h = p.hours === undefined || p.hours === "" ? hours : Number(p.hours);
        if (!(h >= 0 && h <= 24)) throw err(400, `${name}: hours must be between 0 and 24.`);
        if (u && people.some(x => x.userId === u.id)) continue;
        people.push({ userId: u?.id || null, name, hours: Math.round(h * 4) / 4 });
      }
      const skillIds = new Set(st.skills.map(k => k.id));
      const skills = (Array.isArray(body.skills) ? body.skills : []).slice(0, 600)
        .filter(k => skillIds.has(k.skillId) && ["met", "not_met"].includes(k.result) && people.some(p => p.userId && p.userId === k.userId))
        .map(k => ({ userId: k.userId, name: people.find(p => p.userId === k.userId).name, skillId: k.skillId, result: k.result, note: clean(k.note, 300) }));
      const submit = body.submit === true;
      if (submit && !people.length) throw err(400, "Add who attended before submitting.");
      const sig = submit ? sigOk(body.signature) : null;
      const id = old?.d.id || crypto.randomUUID();
      const vals = [day, start, end, hours, station, shift, clean(body.units, 120), clean(body.location, 160), body.atFacility === true || kind === "facility", kind, delivery,
        clean(body.certification, 160), clean(body.subject, 120), clean(body.fwCategory, 120), topic, clean(body.objectives, 4000), clean(body.instructor, 200)];
      await tx(async c => {
        if (old) await c.query(`UPDATE training_drills SET day=$2, start_time=$3, end_time=$4, hours=$5, station=$6, shift=$7, units=$8, location=$9, at_facility=$10, kind=$11, delivery=$12,
            certification=$13, subject=$14, fw_category=$15, topic=$16, objectives=$17, instructor=$18, updated_at=now() WHERE id=$1`, [id, ...vals]);
        else await c.query(`INSERT INTO training_drills (id, day, start_time, end_time, hours, station, shift, units, location, at_facility, kind, delivery, certification, subject,
            fw_category, topic, objectives, instructor, officer_id, officer_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [id, ...vals, user.id, user.name]);
        // Keep confirmations of people who stay on the list
        const kept = old ? new Map(old.people.filter(p => p.user_id).map(p => [p.user_id, p])) : new Map();
        await c.query("DELETE FROM training_drill_people WHERE drill_id = $1", [id]);
        for (const p of people) {
          const k = p.userId && kept.get(p.userId);
          await c.query(`INSERT INTO training_drill_people (id, drill_id, user_id, name, hours, confirmed_at, disputed) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [crypto.randomUUID(), id, p.userId, p.name, p.hours, k && Number(k.hours) === p.hours ? k.confirmed_at : null, k && Number(k.hours) === p.hours ? k.disputed : ""]);
        }
        await c.query("DELETE FROM training_skill_checks WHERE drill_id = $1", [id]);
        for (const k of skills) await c.query(`INSERT INTO training_skill_checks (id, user_id, name, skill_id, day, result, drill_id, note, by_id, by_name, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`,
          [crypto.randomUUID(), k.userId, k.name, k.skillId, day, k.result, id, k.note, user.id, user.name]);
        if (submit) {
          await c.query("UPDATE training_drills SET status = 'submitted', officer_signature = $2, submitted_at = now(), return_note = '' WHERE id = $1", [id, sig]);
          // The officer who signed it doesn't need to confirm their own attendance
          await c.query("UPDATE training_drill_people SET confirmed_at = now() WHERE drill_id = $1 AND user_id = $2 AND confirmed_at IS NULL", [id, old?.d.officer_id || user.id]);
          await audit(c, user, "Submitted a drill", `${topic} ${day}, ${hours} h, Station ${station || "—"} ${shift}: ${people.length} people`);
        }
      });
      if (submit) await notify(user, people.map(p => p.userId), `Confirm your training: ${topic}`,
        `${user.name} logged a drill you attended:\n\n${topic}\n${day}, ${hours} h${station ? `, Station ${station}` : ""}\n\nOpen Training › Drills to confirm it (or say what's wrong).`);
      return send(res, 200, { id, status: submit ? "submitted" : old?.d.status || "draft" });
    }

    const x = isUuid(b) ? await loadDrill(b) : null;
    if (!x || !canSeeDrill(user, acc, sc, x)) throw err(404, "That drill wasn't found.");
    const d = x.d;

    if (c3 === "confirm") {
      const me = x.people.find(p => p.user_id === user.id);
      if (!me) throw err(403, "You're not on this drill's list.");
      if (!["submitted", "verified"].includes(d.status)) throw err(409, "This drill hasn't been submitted yet.");
      const dispute = clean(body.dispute, 500);
      await tx(async c => {
        await c.query("UPDATE training_drill_people SET confirmed_at = $2, disputed = $3 WHERE id = $1", [me.id, dispute ? null : new Date(), dispute]);
        if (dispute) await audit(c, user, "Questioned a drill", `${d.topic} ${d.day}: ${dispute}`);
      });
      if (dispute) await notify(user, [d.officer_id], `Question about your drill log: ${d.topic}`, `${user.name} says about ${d.topic} on ${d.day}:\n\n${dispute}`);
      return send(res, 200, { ok: true });
    }
    if (c3 === "verify" || c3 === "return") {
      if (!acc.edit) throw err(403, "Verifying drills needs Training edit access.");
      if (d.status !== "submitted") throw err(409, "Only submitted drills can be verified or sent back.");
      if (d.officer_id === user.id && user.role !== "master") throw err(403, "Someone else in Training has to verify your own drill.");
      if (c3 === "return") {
        const note = clean(body.note, 1000);
        if (!note) throw err(400, "Say what needs to change.");
        await tx(async c => {
          await c.query("UPDATE training_drills SET status = 'returned', return_note = $2, updated_at = now() WHERE id = $1", [d.id, note]);
          await audit(c, user, "Sent a drill back", `${d.topic} ${d.day}: ${note}`);
        });
        await notify(user, [d.officer_id], `Drill log sent back: ${d.topic}`, `${user.name} sent back your drill log for ${d.topic} on ${d.day}:\n\n${note}\n\nOpen Training › Drills to fix it and submit again.`);
        return send(res, 200, { ok: true });
      }
      await tx(async c => {
        for (const p of x.people) {
          if (!(Number(p.hours) > 0)) continue;
          const rid = crypto.randomUUID();
          await c.query(`INSERT INTO training_records (id, user_id, person_name, day, hours, certification, category, fw_category, topic, instructor, source, created_by, drill_id, delivery)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'drill',$11,$12,$13)`,
            [rid, p.user_id, p.name, d.day, p.hours, d.certification, d.subject || ({ facility: "Facility (Drills)", company: "Company", officer: "Officer", driver: "Driver", hazmat: "Hazmat", ims: "NIMS" })[d.kind] || "",
              d.fw_category, d.topic, d.instructor || d.officer_name, user.id, d.id, d.delivery]);
          await c.query("UPDATE training_drill_people SET record_id = $2 WHERE id = $1", [p.id, rid]);
        }
        await c.query("UPDATE training_skill_checks SET status = 'final' WHERE drill_id = $1", [d.id]);
        await c.query("UPDATE training_drills SET status = 'verified', verified_by = $2, verified_name = $3, verified_at = now(), updated_at = now() WHERE id = $1", [d.id, user.id, user.name]);
        await supersedeDrills(c);
        await audit(c, user, "Verified a drill", `${d.topic} ${d.day}, ${Number(d.hours)} h: ${x.people.length} people (logged by ${d.officer_name})`);
      });
      return send(res, 200, { ok: true });
    }
    if (c3 === "remove") {
      const own = d.officer_id === user.id && ["draft", "returned"].includes(d.status);
      if (!(own || acc.manage)) throw err(403, "Only the officer (before it's submitted) or a Training manager can delete a drill.");
      await tx(async c => {
        await c.query("DELETE FROM training_records WHERE drill_id = $1", [d.id]);
        await c.query("DELETE FROM training_drills WHERE id = $1", [d.id]);
        await audit(c, user, "Deleted a drill", `${d.topic} ${d.day} (${d.status}), logged by ${d.officer_name}`);
      });
      return send(res, 200, { ok: true });
    }
    throw err(404, "Not found");
  }

  // ---- proficiency ----
  if (a === "proficiency") {
    if (req.method === "GET") {
      const station = stationKey(q.get("station")), shift = clean(q.get("shift"), 1);
      let ppl = await allPeople();
      if (station || shift) ppl = ppl.filter(p => (!station || p.stationKey === station) && (!shift || p.shift === shift));
      else if (!sc.all) ppl = ppl.filter(p => covers(sc, p.stationKey, p.shift) || p.id === user.id);
      ppl = ppl.filter(p => p.id === user.id || covers(sc, p.stationKey, p.shift));
      if (!sc.all && sc.role === "member") ppl = ppl.filter(p => p.id === user.id);
      const prof = await proficiencyFor(ppl, st, asOf);
      return send(res, 200, { skills: st.skills, people: ppl.map((p, i) => ({ id: p.id, name: p.name, title: p.title, station: p.stationKey, shift: p.shift, ...prof[i] })) });
    }
    const body = await jsonBody(req);
    if (b === "settings") {
      if (!acc.manage) throw err(403, "Only people who manage Training can change the skill list.");
      const cur = (await pool.query("SELECT data FROM training_settings WHERE id = 1")).rows[0]?.data || {};
      const next = { ...cur };
      if (Array.isArray(body.skills)) {
        const seen = new Set();
        next.skills = body.skills.slice(0, 80).map((k, i) => {
          const label = clean(k.label, 120);
          if (!label) throw err(400, `Skill ${i + 1} needs a name.`);
          if (k.who) { try { new RegExp(k.who, "i"); } catch { throw err(400, `"${label}": the job titles pattern isn't valid.`); } }
          let id = clean(k.id, 40).toLowerCase().replace(/[^a-z0-9-]+/g, "-") || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
          while (seen.has(id)) id += "-2";
          seen.add(id);
          return { id, label, every: [1, 3, 6, 12, 24, 36].includes(Number(k.every)) ? Number(k.every) : 12, who: clean(k.who, 200), standard: clean(k.standard, 500) };
        });
      }
      if (body.roles && typeof body.roles === "object") {
        next.roles = {};
        for (const k of Object.keys(DEFAULT_ROLES)) {
          const v = clean(body.roles[k], 200);
          try { new RegExp(v, "i"); } catch { throw err(400, `The ${k} pattern isn't valid.`); }
          next.roles[k] = v || DEFAULT_ROLES[k];
        }
      }
      await tx(async c => {
        await c.query("UPDATE training_settings SET data = $1 WHERE id = 1", [JSON.stringify(next)]);
        await audit(c, user, "Changed proficiency settings", `${(next.skills || st.skills).length} skills`);
      });
      return send(res, 200, { ok: true });
    }
    if (b === "check") {
      const skill = st.skills.find(k => k.id === body.skillId);
      if (!skill) throw err(400, "Choose the skill.");
      const day = DAY.test(body.day || "") ? body.day : asOf;
      if (day > asOf) throw err(400, "The date can't be in the future.");
      if (!["met", "not_met"].includes(body.result)) throw err(400, "Choose Met or Not met.");
      const ppl = new Map((await allPeople()).map(p => [p.id, p]));
      const who = (Array.isArray(body.userIds) ? body.userIds : []).filter(isUuid).map(id => ppl.get(id)).filter(Boolean).slice(0, 80);
      if (!who.length) throw err(400, "Choose who.");
      if (!acc.edit && !(sc.role === "officer" || sc.role === "bc")) throw err(403, "Recording proficiency is for officers and Training.");
      for (const p of who) {
        if (p.id === user.id && !acc.edit) throw err(403, "Someone else has to sign off your own proficiency.");
        if (!acc.edit && !covers(sc, p.stationKey, p.shift)) throw err(403, `${p.name} isn't in your ${sc.role === "bc" ? "shift" : "company"}.`);
      }
      await tx(async c => {
        for (const p of who) await c.query(`INSERT INTO training_skill_checks (id, user_id, name, skill_id, day, result, note, by_id, by_name, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'final')`,
          [crypto.randomUUID(), p.id, p.name, skill.id, day, body.result, clean(body.note, 300), user.id, user.name]);
        await audit(c, user, "Recorded proficiency", `${skill.label} ${day} ${body.result === "met" ? "met" : "NOT met"}: ${who.map(p => p.name).join(", ").slice(0, 600)}`);
      });
      return send(res, 200, { ok: true, added: who.length });
    }
    throw err(404, "Not found");
  }

  // ---- company / shift views ----
  if (req.method === "GET" && a === "company") {
    const station = stationKey(q.get("station") || sc.station), shift = ["A", "B", "C"].includes(q.get("shift")) ? q.get("shift") : sc.shift || "";
    if (!station || !shift) throw err(400, "Choose the station and shift.");
    if (!covers(sc, station, shift)) throw err(403, "You can see your own company's training (or ask Training for view access).");
    const ppl = (await allPeople()).filter(p => p.stationKey === station && p.shift === shift);
    const people = await summaries(ppl, year, asOf);
    const drills = (await pool.query(`SELECT d.*, d.day::text AS day, (SELECT count(*)::int FROM training_drill_people p WHERE p.drill_id = d.id) AS n
      FROM training_drills d WHERE d.station = $1 AND d.shift = $2 AND d.day BETWEEN $3 AND $4 AND d.status <> 'draft' ORDER BY d.day DESC LIMIT 200`, [station, shift, `${year}-01-01`, `${year}-12-31`])).rows;
    const verified = drills.filter(d => d.status === "verified");
    return send(res, 200, { station, shift, year, asOf, people, summary: rollup(people), skills: st.skills,
      drills: drills.map(d => ({ ...drillJson(d), people: undefined, skills: undefined, count: d.n })),
      drillHours: r1(verified.reduce((s, d) => s + Number(d.hours), 0)), drillCount: verified.length, pending: drills.filter(d => d.status === "submitted").length });
  }
  if (req.method === "GET" && a === "shift") {
    const shift = ["A", "B", "C"].includes(q.get("shift")) ? q.get("shift") : sc.shift || "";
    if (!shift) throw err(400, "Choose the shift.");
    if (!(sc.all || (sc.role === "bc" && sc.shift === shift))) throw err(403, "The shift view is for battalion chiefs (their shift) and Training.");
    const ppl = (await allPeople()).filter(p => p.shift === shift && re(st.roles.rosterDivisions, p.division));
    const people = await summaries(ppl, year, asOf);
    const dsum = await drillsSummary("d.shift = $1 AND d.day BETWEEN $2 AND $3", [shift, `${year}-01-01`, `${year}-12-31`]);
    const stations = [...new Set(people.map(p => p.station))].sort((x, y) => (Number(x) || 999) - (Number(y) || 999) || x.localeCompare(y));
    const companies = stations.map(sk => {
      const list = people.filter(p => p.station === sk);
      const ds = dsum.filter(d => d.station === sk);
      const sum = f => ds.filter(f).reduce((a, d) => a + d.n, 0);
      return { station: sk, ...rollup(list), drills: sum(d => d.status === "verified"), drillHours: r1(ds.filter(d => d.status === "verified").reduce((a, d) => a + (d.hours || 0), 0)),
        drillsThisMonth: ds.filter(d => d.status !== "draft").reduce((a, d) => a + d.this_month, 0), pending: sum(d => d.status === "submitted"), returned: sum(d => d.status === "returned"),
        people: list.map(p => ({ id: p.id, name: p.name, title: p.title, company: p.company, behind: !!p.company?.behind, missingCount: p.missingCount, onDuty: p.onDuty,
          profOverdue: p.proficiency.overdue + p.proficiency.retrain, profDue: p.proficiency.due, profNever: p.proficiency.never })) };
    });
    return send(res, 200, { shift, year, asOf, summary: rollup(people), companies });
  }

  // ---- roster history ----
  if (a === "roster") {
    if (req.method === "GET") {
      if (!acc.view) throw err(403, "The roster history needs Training view access.");
      await syncRoster(year);
      const rows = await rosterRows(year);
      const years = (await pool.query("SELECT DISTINCT year FROM training_roster ORDER BY year DESC")).rows.map(r => r.year);
      return send(res, 200, { year, rows: rows.map(rosterJson), years, current: Number(asOf.slice(0, 4)), roles: st.roles });
    }
    if (!acc.manage) throw err(403, "Changing the roster history needs Training manage access.");
    const body = await jsonBody(req);
    if (b === "start") {
      const y = Number(body.year);
      if (!(y >= 2000 && y <= 2100)) throw err(400, "Choose the year.");
      const n = await syncRoster(y, { force: true });
      await audit(pool, user, "Started a training roster", `${y}: ${n} people from accounts`);
      return send(res, 200, { added: n });
    }
    if (isUuid(b) && c3 === "remove") {
      const r = (await pool.query("DELETE FROM training_roster WHERE id = $1 RETURNING name, year", [b])).rows[0];
      if (!r) throw err(404, "That roster entry wasn't found.");
      await audit(pool, user, "Removed from training roster", `${r.year}: ${r.name}`);
      return send(res, 200, { ok: true });
    }
    if (b) throw err(404, "Not found");
    const y = Number(body.year);
    if (!(y >= 2000 && y <= 2100)) throw err(400, "Choose the year.");
    const name = clean(body.name, 120);
    if (!name) throw err(400, "Enter the name.");
    const d = v => (DAY.test(v || "") ? v : null);
    const joined = d(body.joined) || `${y}-01-01`, left = d(body.left);
    if (left && left < joined) throw err(400, "The end date is before the start date.");
    const old = isUuid(body.id) ? (await pool.query("SELECT * FROM training_roster WHERE id = $1", [body.id])).rows[0] : null;
    if (body.id && !old) throw err(404, "That roster entry wasn't found.");
    const vals = [name, clean(body.empNo, 40), clean(body.title, 120), clean(body.station, 20), ["A", "B", "C"].includes(body.shift) ? body.shift : "", joined, left,
      body.officer === true, body.driver === true, d(body.driverSince), d(body.hireDate), body.suppression !== false, clean(body.note, 300)];
    let id = old?.id;
    await tx(async c => {
      if (old) await c.query(`UPDATE training_roster SET name=$2, emp_no=$3, title=$4, station=$5, shift=$6, joined=$7, left_on=$8, officer=$9, driver=$10, driver_since=$11, hire_date=$12,
          suppression=$13, note=$14, locked=true, changes = changes || $15::jsonb, updated_at=now() WHERE id=$1`,
          [id, ...vals, JSON.stringify([{ at: asOf, what: `edited by ${user.name}` }])]);
      else {
        id = crypto.randomUUID();
        const uid = isUuid(body.userId) ? body.userId : null;
        await c.query(`INSERT INTO training_roster (id, year, user_id, name, emp_no, title, station, shift, joined, left_on, officer, driver, driver_since, hire_date, suppression, note, source, locked)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'manual',true)`, [id, y, uid, ...vals]);
      }
      await audit(c, user, old ? "Edited training roster" : "Added to training roster", `${y}: ${name}${left ? ` (left ${left})` : ""}`);
    });
    return send(res, 200, { id });
  }

  // ---- PIAL estimate from Nexus training ----
  if (req.method === "GET" && a === "pial") {
    const { hasAccess } = await import("./access.js");
    if (!(acc.view || user.role === "master" || await hasAccess(pool, user, "pial", "view"))) throw err(403, "The PIAL estimate needs Training or PIAL view access.");
    const { compute } = await import("./pial.js");
    const est = await compute({ trainingSource: "nexus", year });
    const cur = await compute({ year });
    if (!est || !cur) throw err(404, "The PIAL tracker isn't part of this installation.");
    const pick = r => r.items.filter(i => i.group.startsWith("581") || i.key === "o720")
      .map(i => ({ key: i.key, code: i.code, label: i.label, max: i.max, pct: i.pct, credit: i.credit, method: i.method, detail: i.detail, warn: i.warn }));
    const tm = est.tm;
    return send(res, 200, { year: est.year, project: est.project, trainingSource: cur.settings.trainingSource,
      estimate: { items: pick(est), trainingRaw: est.trainingRaw, training: est.training, score: est.score, cls: est.cls, members: tm.members, counts: tm.counts,
        belowMinimum: tm.belowMinimum, unknown: tm.unknownCount,
        rows: tm.rows.map(r => ({ name: r.name, rank: r.rank, shift: r.shift, companyCredited: r.companyCredited, facility: r.facility, officerHrs: r.officerHrs, driverHrs: r.driverHrs,
          hazmat: r.hazmat, total: r.total, onPaceCompany: r.onPaceCompany, meetsMinimum: r.meetsMinimum, ifsac: r.ifsac })) },
      current: { items: pick(cur), trainingRaw: cur.trainingRaw, training: cur.training, score: cur.score, cls: cur.cls, members: cur.tm.members },
      targets: est.settings.targets });
  }

  throw err(404, "Not found");
}
