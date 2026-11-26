// Permissions and groups (/api/access/*). See db/migrations/014_access.sql.
//
// A grant says a person or a group can <level> a <section>, optionally only for some divisions
// (or each member's own division). Levels rank view < edit < manage; a higher level includes
// the lower ones. Master admins can do everything. A section's managers (manage level) can give
// and take away view/edit in that section, within the divisions they manage.
//
// Older code asks with the original permission names (hasPerm(c, user, "directory_admin"), the
// roster's permissions.timeView ...); legacy() maps those onto sections and levels, so nothing
// else had to change.
import crypto from "node:crypto";
import { pool } from "./db.js";
import { brand } from "./brand.js";

// Each section: levels (what each grant level adds), `everyone` (what anyone gets without a grant), `tile` (whether the
// main-menu tile / side-bar entry shows for everyone, or only with some access), `auto` (access some people get without a
// grant, shown on By person), and `profiles` = this section's level in each built-in permission profile. When a new section
// is added in an update, its `profiles` entry is what puts it into the profiles people already have (the Fire Chief profile
// takes the view level of every section on its own).
export const SECTIONS = [
  { key: "time", label: "Time Tracker", divisions: true, tile: "everyone", everyone: "Punch in and out; see their own hours",
    levels: { view: "See other people's time punches (read-only)", manage: "Also decide who else can see time punches" },
    profiles: { chief: "view", division: "view" } },
  { key: "callout", label: "Call-Out Schedule", divisions: true, tile: "everyone", everyone: "See every call-out schedule; edit their own division's",
    levels: { edit: "Edit the call-out schedule", manage: "Also decide who else can edit it" } },
  { key: "recordings", label: "Working Fire Recordings", tile: "access", everyone: "",
    levels: { view: "Listen to working fire recordings", manage: "Also decide who else can listen" }, profiles: { chief: "view", division: "view" } },
  { key: "directory", label: "Directory", tile: "everyone", everyone: "See the directory and on-duty board; edit their own card",
    levels: { manage: "Directory admin: edit anyone's card, stations and contacts; run directory checks; Aladtec setup" } },
  { key: "forms", label: "Forms", tile: "everyone", everyone: "Fill out forms; follow their own submissions; handle forms sent to them",
    levels: { manage: "Forms admin: build and edit forms" } },
  { key: "accounts", label: "User accounts", tile: "users", everyone: "",
    levels: { manage: "Accounts admin: approve accounts and reset passwords (not master admins)" } },
  { key: "messages", label: "Messages", tile: "everyone", everyone: "Message and chat with people; their own lists",
    levels: { edit: "Send messages to groups and to everyone (anyone can message people directly)", manage: "Also decide who else can send to groups" } },
  { key: "pial", label: "PIAL tracker", divisions: true, tile: "access", everyone: "",
    levels: { view: "See the PIAL tracker and print the grader binder", edit: "Update items, records and evidence owned by these divisions",
      manage: "Also import FireWorks reports, change settings and item owners, and decide who else can see or edit it" }, profiles: { chief: "view", division: "view" } },
  { key: "leave", label: "Leave picks", divisions: true, tile: "everyone", everyone: "Make their own picks when it's their turn; see their unit",
    levels: { view: "See every unit's leave picks and download the reports (forms, leave spreadsheet, Aladtec list)",
      edit: "Also make or skip picks for people in these divisions", manage: "Also set up pick years, rules, blocked dates and the roster; move or rescind picks; decide who else can see it" },
    profiles: { chief: "view", division: "view" } },
  { key: "helpdesk", label: "Help Desk", tile: "everyone", everyone: "Open tickets and follow their own; work tickets sent to them",
    levels: { view: "See every ticket (read-only)", edit: "Work tickets like the Technology division: assign, change status, set due dates (everyone in Technology already can)",
      manage: "Also decide who else can work tickets" }, profiles: { division: "view" } },
  { key: "gear", label: "Gear tickets", tile: "everyone", everyone: "Open gear tickets and follow their own; work tickets sent to them",
    levels: { view: "See every gear ticket (read-only)", edit: "Work every gear ticket: post status updates, assign, set due dates; gets gear tickets nobody was picked for",
      manage: "Also decide who else can work gear tickets" }, profiles: { division: "view" } },
  { key: "board", label: "Board report", tile: "access", everyone: "",
    levels: { view: "Build, save and print operational reports for Fire Board meetings (calls, response times, apparatus, fires, training, prevention)",
      manage: "Also settings (CAD agency, call types) and decide who else can" } },
  { key: "schedule", label: "Work schedule", divisions: true, tile: "everyone", everyone: "See the work schedule (who's working when)",
    levels: { edit: "Set the schedule for people in these divisions (days ahead, leaving early); everyone can see it",
      manage: "Also decide who else can set the schedule" } },
  { key: "offwork", label: "Off Work", divisions: true, tile: "everyone", everyone: "Post their own days off; see who's out (what each person shares with them)",
    levels: { view: "See every Off Work entry, whoever it was shared with", edit: "Also post and change days off for people in these divisions",
      manage: "Also settings (who sees sick call-outs) and decide who else can post for others" }, profiles: { chief: "view", division: "view" } },
  // Opt-in module (src/modules.js): listed only when that module is licensed (`module`)
  { key: "sales", label: "Clients & Quotes", module: "sales", tile: "access", everyone: "",
    levels: { view: "See clients, contacts, quotes and the work log", edit: "Add and change clients and quotes, log work",
      manage: "Also reveal and change vault logins, edit the price book, and decide who else can" } },
  { key: "books", label: "Expenses & Deductions", module: "sales", tile: "access", everyone: "",
    levels: { view: "See the business's expenses, mileage and receipts, and export the accountant's packet", edit: "Add and change expenses, trips, vehicles and receipts",
      manage: "Also the settings (mileage rates, home office, business details) and decide who else can" } },
  { key: "links", label: "Quick Links", module: "links", tile: "everyone", everyone: "Open the links shared with them, and reveal the logins they're allowed",
    levels: { edit: "Add and change links and shared logins, and choose who sees each one", manage: "Also decide who else can" } },
  { key: "callalerts", label: "Call alerts", tile: "everyone", everyone: "Set up their own call alerts and turn off department alerts sent to them",
    levels: { edit: "Make call alerts for people and groups (which calls: agency, call type, units, priority)", manage: "Also decide who else can" } },
  { key: "forceback", label: "Force Back", divisions: true, tile: "everyone", everyone: "See the force back list they are on and its log",
    levels: { view: "See the force back lists for these divisions", edit: "Also log force backs, no answers, excusals and notes",
      manage: "Also add and remove people, change shifts and dates, import the spreadsheet, and create lists" }, profiles: { chief: "view", division: "view" } },
  { key: "command", label: "Command board", tile: "everyone", everyone: "Watch command boards on fire calls (officers by job title can run them; see Command Board settings)",
    levels: { edit: "Open and run command boards (accountability, PAR, strategy, MAYDAY, notes, scene view)", manage: "Also settings (which job titles count as officers) and decide who else can run boards" } },
  { key: "audit", label: "Audit log", tile: "access", everyone: "", levels: { view: "See the system audit log (every section, every person)", manage: "Also decide who else can see it" } },
  { key: "sick", label: "Sick leave", divisions: true, tile: "access", everyone: "",
    levels: { view: "See sick leave call-outs, hours and pattern alerts for these divisions", edit: "Also log and correct call-outs for these divisions",
      manage: "Also change sick leave settings (holidays, pattern rules) and decide who else can see it" }, profiles: { chief: "view", division: "view" } },
  { key: "training", label: "Training", tile: "everyone", everyone: "Their own hours and what they're missing; classroom bookings",
    levels: { view: "See everyone's training hours, today's crews and what they're missing", edit: "Also import FireWorks training reports and enter training hours",
      manage: "Also set training requirements, the category mapping and the apparatus list; decide who else can see it" }, profiles: { chief: "view", division: "view" } },
  { key: "imt", label: "IMT (incident action plans)", tile: "everyone", everyone: "See the IAPs they're named in",
    levels: { view: "See every incident and its IAPs (people named in an IAP can always see that one)", edit: "Also fill in ICS forms, start operational periods and add maps and files",
      manage: "Also create, close and delete incidents, approve IAPs, read IAP PDFs into a new period, and decide who else can use IMT" },
    profiles: { basic: "view", chief: "view", division: "view" } },
  { key: "evals", label: "Evaluations & simulations", tile: "everyone", everyone: "Their own development, practice evaluations and simulations",
    levels: { view: "See everyone's evaluations, working test periods and evaluated simulation runs (read-only)",
      edit: "Evaluator for every program: score and sign evaluations, run evaluated simulations, write and sign reviews",
      manage: "Also edit evaluation programs and simulation scenarios, enrol people in working test periods, sign final recommendations, and decide who else can evaluate" },
    profiles: { chief: "view", division: "view" } },
  { key: "recall", label: "Emergency recall", tile: "everyone", everyone: "Answer a recall they're on",
    levels: { view: "See recall boards (who's coming, units, roll call)", edit: "Also operate a recall board: record phoned-in answers, roll call, staffing board, checklist (e.g. Communications)",
      manage: "Also start and close recalls (Assistant Chiefs and above can already), change recall settings and the Special Operations list, and decide who else can use it" },
    profiles: { chief: "view", division: "view" } },
  { key: "bookings", label: "Classroom bookings", tile: "everyone", everyone: "See bookings; request a room with the Facility form",
    levels: { edit: "Book rooms directly, approve or cancel bookings, and assign apparatus rotations (anyone can see bookings)",
      manage: "Also change the list of rooms and decide who else can book" } },
  { key: "stats", label: "Comms statistics", tile: "access", everyone: "",
    levels: { view: "See communications statistics (volume, hold times, reports)", edit: "Also see call taker and dispatcher statistics (per person)",
      manage: "Also manage the CAD statistics data (codes, operator names, goals, sync) and decide who else can see it" }, profiles: { division: "view" } },
  { key: "fireprev", label: "Fire Prevention", tile: "access", everyone: "",
    levels: { view: "See inspection coverage, properties not inspected yet and the PIAL inspection estimate",
      edit: "Also import the FireWorks inspection report, record inspections, and mark properties left out of the count (with a reason)",
      manage: "Also change Fire Prevention settings (which fire districts count) and decide who else can see it" },
    profiles: { chief: "view", division: "view" } },
  { key: "investigations", label: "Investigations (arson)", tile: "access", everyone: "",
    levels: { edit: "Fire investigator: open cases and work the cases they're on, including criminal history. Also needs the CJIS list (background check + training) and an authenticator app",
      manage: "Chief of Fire Prevention: every case, assign investigators, keep the CJIS list, release authenticator locks, review the access log, purge criminal history" } },
];
// Built-in permission profiles. Levels come from each section's `profiles` entry (plus `all: "view"` = the view level, or the
// lowest level, of every section that has one); local changes are kept in access_profiles as {add, remove}.
export const BUILTIN_PROFILES = [
  { key: "basic", name: "Basic", description: "Every member: what everyone gets, plus the incident action plans during an incident." },
  { key: "chief", name: "Chief Officer", description: "Battalion and Assistant Chiefs: view training, evaluations, leave, sick leave, recall boards, IAPs, PIAL, recordings, time and Fire Prevention." },
  { key: "division", name: "Division Head / Deputy Chief", description: "Chief Officer views plus Help Desk and gear tickets and Comms statistics." },
  { key: "firechief", name: "Fire Chief", description: "Sees everything in every section, manages nothing.", all: "view" },
];
// Which module each section belongs to (src/modules.js keys); core sections have none
const SECTION_MODULE = { time: "timeclock", schedule: "timeclock", callout: "callout", recordings: "recordings", forms: "forms", messages: "messaging", pial: "pial",
  leave: "leave", helpdesk: "helpdesk", gear: "gear", board: "board", offwork: "offwork", links: "links", callalerts: "callalerts", forceback: "forceback",
  command: "command", sick: "sick", training: "training", imt: "imt", evals: "evals", recall: "recall", bookings: "training", stats: "stats",
  fireprev: "fireprev", investigations: "investigations" };
for (const s of SECTIONS) if (!s.module && SECTION_MODULE[s.key]) s.module = SECTION_MODULE[s.key];
const SECTION = Object.fromEntries(SECTIONS.map(s => [s.key, s]));
// Only the sections of modules this install has (license) show on the Permissions pages
async function shownSections() {
  const { moduleOn } = await import("./license.js");
  return SECTIONS.filter(s => !s.module || moduleOn(s.module));
}
// Built-in profile names: fire-service ones for a fire/EMS department, plain ones for a business (User Management › Organization)
const BUSINESS_PROFILES = {
  basic: { name: "Basic", description: "Every employee: what everyone gets." },
  chief: { name: "Supervisor", description: "Supervisors: view time, sick leave, days off and the other sections their people use." },
  division: { name: "Manager", description: "Supervisor views plus tickets and statistics, where this system has them." },
  firechief: { name: "Owner / Director", description: "Sees everything in every section, manages nothing." },
};
async function builtinText(p) {
  const { orgSettings } = await import("./brand.js");
  return orgSettings().fire ? { name: p.name, description: p.description } : BUSINESS_PROFILES[p.key] || { name: p.name, description: p.description };
}
export const RANK = { view: 1, edit: 2, manage: 3 };

// The original permission names, as [section, lowest level that counts]
export const LEGACY = {
  time_view: ["time", "view"], callout_edit: ["callout", "edit"], recordings: ["recordings", "view"],
  directory_admin: ["directory", "manage"], forms_admin: ["forms", "manage"], accounts_admin: ["accounts", "manage"],
};
const LEGACY_KEY = { timeView: "time_view", calloutEdit: "callout_edit", recordings: "recordings",
  directoryAdmin: "directory_admin", formsAdmin: "forms_admin", accountsAdmin: "accounts_admin" };
const WHOLE = new Set(["recordings", "directoryAdmin", "formsAdmin", "accountsAdmin"]);
export const noPerms = () => ({ timeView: [], calloutEdit: [], recordings: [], directoryAdmin: [], formsAdmin: [], accountsAdmin: [] });

const err = (status, message) => Object.assign(new Error(message), { status });
const inList = (n, start = 1) => Array.from({ length: n }, (_, i) => `$${i + start}`).join(", ");

// ---- Who's in which group ----------------------------------------------------------------
async function loadUsers(c) {
  return (await c.query(
    `SELECT u.id, u.full_name AS name, u.role, u.work_pattern AS pattern, u.job_title AS title, u.station, d.name AS division
       FROM users u JOIN divisions d ON d.id = u.division_id
      WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows;
}
async function loadGroups(c) {
  const groups = (await c.query("SELECT id, name, description, rules, is_default FROM access_groups ORDER BY is_default, lower(name)")).rows;
  const over = (await c.query("SELECT group_id, user_id, mode FROM access_group_members")).rows;
  for (const g of groups) {
    g.rules = g.rules || {};
    g.includes = over.filter(o => o.group_id === g.id && o.mode === "include").map(o => o.user_id);
    g.excludes = over.filter(o => o.group_id === g.id && o.mode === "exclude").map(o => o.user_id);
  }
  return groups;
}
// Home station from the directory card: "61", "Station 61", "Sta. 61", "St 61" -> "61"; "HQ" stays "hq"
export const stationKey = v => { const s = String(v || "").trim().toLowerCase(); const n = s.match(/\d+/); return n ? String(Number(n[0])) : s; };
// Within one kind of rule any value matches; every kind that's set must match. No rules = nobody automatically.
export function matchesRules(rules, u) {
  const r = rules || {};
  const checks = [];
  if (r.stations?.length) checks.push(r.stations.map(stationKey).includes(stationKey(u.station)) && !!String(u.station || "").trim());
  if (r.divisions?.length) checks.push(r.divisions.includes(u.division));
  if (r.patterns?.length) checks.push(r.patterns.includes(u.pattern || ""));
  if (r.roles?.length) checks.push(r.roles.includes(u.role));
  if (r.titles?.length) checks.push(r.titles.some(t => t && String(u.title || "").toLowerCase().includes(String(t).toLowerCase())));
  return checks.length > 0 && checks.every(Boolean);
}
// For messages: everyone active, and a group's members right now
export async function activePeople(c) { return loadUsers(c); }
export async function allGroupMembers(c) {
  const users = await loadUsers(c);
  return (await loadGroups(c)).map(g => ({ id: g.id, name: g.name, isDefault: g.is_default, ids: membersOf(g, users) }));
}
export async function groupMembers(c, groupId) {
  const users = await loadUsers(c);
  const g = (await loadGroups(c)).find(x => x.id === groupId);
  return g ? { name: g.name, ids: membersOf(g, users) } : null;
}
function membersOf(g, users) {
  const ex = new Set(g.excludes), inc = new Set(g.includes);
  return users.filter(u => !ex.has(u.id) && (inc.has(u.id) || matchesRules(g.rules, u))).map(u => u.id);
}

// ---- Permission profiles -------------------------------------------------------------------
const PROFILE = Object.fromEntries(BUILTIN_PROFILES.map(p => [p.key, p]));
// The built-in levels as shipped in this version (before local changes)
export function builtinLevels(key) {
  const p = PROFILE[key], out = {};
  if (!p) return out;
  for (const s of SECTIONS) {
    if (p.all && s.levels[p.all]) out[s.key] = p.all;
    const lv = s.profiles?.[key];
    if (lv && s.levels[lv] && (!out[s.key] || RANK[lv] > RANK[out[s.key]])) out[s.key] = lv;
  }
  return out;
}
const cleanLevels = v => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([k, l]) => SECTION[k]?.levels[l]));
// Every profile with its levels now: built-ins (with local changes) first, then custom ones
export async function loadProfiles(c) {
  const rows = (await c.query("SELECT key, name, description, builtin, levels, updated_by, updated_at FROM access_profiles")).rows;
  const byKey = new Map(rows.map(r => [r.key, r]));
  const out = [];
  for (const p0 of BUILTIN_PROFILES) {
    const p = { ...p0, ...(await builtinText(p0)) };
    const r = byKey.get(p.key), base = builtinLevels(p.key), levels = { ...base };
    const ch = r?.levels || {};
    for (const k of Array.isArray(ch.remove) ? ch.remove : []) delete levels[k];
    Object.assign(levels, cleanLevels(ch.add));
    out.push({ key: p.key, name: r?.name || p.name, description: r?.description || p.description, builtin: true, all: p.all || null,
      levels, base, changed: !!r, updatedBy: r?.updated_by || "", updatedAt: r?.updated_at || null });
  }
  for (const r of rows.filter(r => !PROFILE[r.key]).sort((a, b) => a.name.localeCompare(b.name)))
    out.push({ key: r.key, name: r.name, description: r.description, builtin: false, levels: cleanLevels(r.levels), base: {}, changed: false, updatedBy: r.updated_by, updatedAt: r.updated_at });
  const members = (await c.query("SELECT id, profile_key, user_id, group_id FROM access_profile_members")).rows;
  for (const p of out) p.assigned = members.filter(m => m.profile_key === p.key).map(m => ({ id: m.id, userId: m.user_id, groupId: m.group_id }));
  return out;
}

// ---- Effective grants -----------------------------------------------------------------------
// For every active person: [{ section, level, division (name or null = all), via, grantId }]
// Cached for a few seconds outside transactions (a page load asks several times); any change to
// grants, groups or people clears it.
let cache = null;
export function clearAccessCache() { cache = null; }
async function effectiveAll(c) {
  if (c === pool && cache && Date.now() - cache.at < 5000) return cache.value;
  const value = await computeEffective(c);
  if (c === pool) cache = { at: Date.now(), value };
  return value;
}
async function computeEffective(c) {
  const users = await loadUsers(c), groups = await loadGroups(c);
  const grants = (await c.query(
    `SELECT g.id, g.section, g.level, g.user_id, g.group_id, g.own_division, d.name AS division
       FROM access_grants g LEFT JOIN divisions d ON d.id = g.division_id`)).rows;
  const byUser = new Map(users.map(u => [u.id, []]));
  const userById = new Map(users.map(u => [u.id, u]));
  const add = (uid, g, via) => {
    const u = userById.get(uid); if (!u) return;
    byUser.get(uid).push({ section: g.section, level: g.level, division: g.own_division ? u.division : g.division ?? null, own: g.own_division, via, grantId: g.id });
  };
  for (const g of grants) if (g.user_id) add(g.user_id, g, "Direct");
  for (const grp of groups) {
    const gg = grants.filter(g => g.group_id === grp.id);
    if (!gg.length) continue;
    for (const uid of membersOf(grp, users)) for (const g of gg) add(uid, g, grp.name);
  }
  // Profiles: every section level of the profile, all divisions, to each person given it (directly or through a group)
  const profiles = await loadProfiles(c);
  for (const p of profiles) {
    const ids = new Set();
    for (const m of p.assigned) {
      if (m.userId) ids.add(m.userId);
      else { const grp = groups.find(g => g.id === m.groupId); if (grp) for (const uid of membersOf(grp, users)) ids.add(uid); }
    }
    for (const uid of ids) {
      const via = `Profile: ${p.name}`;
      for (const [section, level] of Object.entries(p.levels)) byUser.get(uid)?.push({ section, level, division: null, own: false, via, grantId: null, profile: p.key });
    }
  }
  return { byUser, users, groups, grants, profiles };
}
export async function effectiveFor(c, userId) {
  return (await effectiveAll(c)).byUser.get(userId) || [];
}

export async function hasAccess(c, user, section, level, division = null) {
  if (!user) return false;
  if (user.role === "master") return true;
  return (await effectiveFor(c, user.id)).some(g => g.section === section && RANK[g.level] >= RANK[level] &&
    (division == null || g.division == null || g.division === division));
}
// { all, divisions: Set } for a person's access to a section at (at least) a level
export async function accessScope(c, userId, section, level) {
  const list = (await effectiveFor(c, userId)).filter(g => g.section === section && RANK[g.level] >= RANK[level]);
  return { all: list.some(g => g.division == null), divisions: new Set(list.map(g => g.division).filter(Boolean)) };
}

// ---- The original permission names -----------------------------------------------------------
export async function hasLegacy(c, user, permission) {
  const [section, level] = LEGACY[permission] || [];
  return section ? hasAccess(c, user, section, level) : false;
}
export async function legacyScope(c, userId, permission) {
  const [section, level] = LEGACY[permission];
  return accessScope(c, userId, section, level);
}
function legacyShape(list) {
  const out = noPerms();
  for (const [key, perm] of Object.entries(LEGACY_KEY)) {
    const [section, level] = LEGACY[perm];
    const hits = list.filter(g => g.section === section && RANK[g.level] >= RANK[level]);
    if (!hits.length) continue;
    out[key] = WHOLE.has(key) || hits.some(g => g.division == null) ? ["*"] : [...new Set(hits.map(g => g.division))].sort();
  }
  return out;
}
// Map userId -> { timeView: [...], ... } (what the roster has always returned), plus who manages what
export async function legacyAll(c) {
  const { byUser } = await effectiveAll(c);
  const out = new Map();
  for (const [uid, list] of byUser) {
    const sections = {};                       // section -> highest level, e.g. { stats: "edit" }
    for (const g of list) if (!sections[g.section] || RANK[g.level] > RANK[sections[g.section]]) sections[g.section] = g.level;
    out.set(uid, { perms: legacyShape(list), manages: [...new Set(list.filter(g => g.level === "manage").map(g => g.section))], sections });
  }
  return out;
}

// The roster's permission checkboxes (master admins). They show effective access, so only the
// part that isn't already coming from a group is saved as the person's own grants.
export async function setLegacyPermissions(c, actor, userId, perms) {
  clearAccessCache();
  const eff = await effectiveFor(c, userId);
  const changes = [];
  for (const [key, perm] of Object.entries(LEGACY_KEY)) {
    if (!Array.isArray(perms[key])) continue;
    const [section, level] = LEGACY[perm];
    const counts = g => g.section === section && RANK[g.level] >= RANK[level];
    const direct = eff.filter(g => counts(g) && g.via === "Direct" && g.level === level);
    const shape = l => (WHOLE.has(key) ? (l.length ? ["*"] : []) : l.some(g => g.division == null) ? ["*"] : [...new Set(l.map(g => g.division))]);
    const fromElsewhere = shape(eff.filter(g => counts(g) && !(g.via === "Direct" && g.level === level)));
    let want = [...new Set(perms[key].map(String))];
    if (WHOLE.has(key) && want.length) want = ["*"];
    if (want.includes("*")) want = ["*"];
    // Leave out what groups (or a higher level) already give
    want = want.filter(x => !(fromElsewhere.includes("*") || fromElsewhere.includes(x)));
    const have = shape(direct);
    if (JSON.stringify([...have].sort()) === JSON.stringify([...want].sort())) continue;
    await c.query("DELETE FROM access_grants WHERE user_id = $1 AND section = $2 AND level = $3", [userId, section, level]);
    for (const w of want) {
      const divId = w === "*" ? null : (await c.query("SELECT id FROM divisions WHERE name = $1", [w])).rows[0]?.id;
      if (w !== "*" && !divId) continue;
      await c.query(`INSERT INTO access_grants (id, section, level, user_id, division_id, granted_by) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), section, level, userId, divId, actor.id]);
    }
    changes.push(`${SECTION[section].label} ${level}: ${want.length ? (want.includes("*") ? "all divisions" : want.join(", ")) : "none"}`);
  }
  return changes;
}

// ---- Admin API ------------------------------------------------------------------------------
async function audit(c, actor, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Permissions', $4, $5)`,
    [actor.id, actor.name, ROLE_LABEL[actor.role] || actor.role, action, String(detail).slice(0, 2000)]);
}
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const cleanList = v => (Array.isArray(v) ? [...new Set(v.map(x => String(x).trim()).filter(Boolean))].slice(0, 100) : []);

// What a person may grant: masters anything; managers view/edit in their sections, within the
// divisions their manage grant covers ({ all, divisions }).
async function grantRights(c, user) {
  if (user.role === "master") return { master: true, sections: new Map(SECTIONS.map(s => [s.key, { all: true, divisions: new Set() }])) };
  const eff = await effectiveFor(c, user.id);
  const sections = new Map();
  for (const g of eff.filter(g => g.level === "manage" && SECTION[g.section])) {
    const s = sections.get(g.section) || { all: false, divisions: new Set() };
    if (g.division == null) s.all = true; else s.divisions.add(g.division);
    sections.set(g.section, s);
  }
  return { master: false, sections };
}
// Access some people get without a grant (shown on By person so nothing is hidden). Mirrors the rules in collections.js
// (Technology works Help Desk), recall.js (starters by job title), trainingPlus.js (company officers / BCs by job title)
// and fireprev.js (the Fire Prevention division).
export const FIREPREV_DIVISION = /prevent|arson|marshal/i;
async function autoRules() {
  const rx = (pat, s) => { try { return !!pat && new RegExp(pat, "i").test(String(s || "")); } catch { return false; } };
  const rec = (await pool.query("SELECT value FROM settings WHERE key = 'recall'").catch(() => ({ rows: [] }))).rows[0]?.value;
  const recall = (typeof rec === "string" ? JSON.parse(rec) : rec) || {};
  const starters = recall.starters || "assistant chief|asst\\.? chief|deputy chief|fire chief|^chief$";
  const tr = (await pool.query("SELECT data FROM training_settings WHERE id = 1").catch(() => ({ rows: [] }))).rows[0]?.data || {};
  const { DEFAULT_ROLES } = await import("./trainingPlus.js");
  const roles = { ...DEFAULT_ROLES, ...(tr.roles || {}) };
  return u => {
    const out = [];
    if (u.division === "Technology") out.push({ section: "helpdesk", level: "edit", note: "Technology division: works every ticket" });
    if (FIREPREV_DIVISION.test(u.division || "")) out.push({ section: "fireprev", level: "edit", note: `${u.division} division` });
    if (rx(starters, u.title)) out.push({ section: "recall", level: "manage", note: "Job title: can start, run and close recalls (settings stay with Recall managers)" });
    if (rx(roles.bc, u.title)) out.push({ section: "training", level: null, note: "Job title (battalion chief): sees their whole shift's training, logs drills" });
    else if (rx(roles.officer, u.title)) out.push({ section: "training", level: null, note: "Job title (company officer): sees their company's training, logs drills" });
    return out;
  };
}

function describeScope(g) { return g.own_division ? "own division" : g.division ? g.division : "all divisions"; }

export async function handleAccess(req, res, parts, user, send, jsonBody) {
  const what = parts[2];
  // Anyone: what can I do?
  if (what === "me" && req.method === "GET") {
    const eff = user.role === "master" ? [] : await effectiveFor(pool, user.id);
    return send(res, 200, { isMaster: user.role === "master", grants: eff, manages: [...new Set(eff.filter(g => g.level === "manage").map(g => g.section))] });
  }
  if (req.method === "POST") clearAccessCache();
  const rights = await grantRights(pool, user);
  if (!rights.master && !rights.sections.size) throw err(403, "Only master admins and section managers can manage permissions.");

  if (!what && req.method === "GET") {
    const { users, groups, grants, byUser, profiles } = await effectiveAll(pool);
    const auto = await autoRules();
    const divs = (await pool.query("SELECT name FROM divisions ORDER BY name")).rows.map(r => r.name);
    const stations = (await pool.query("SELECT number, name FROM directory_places WHERE kind = 'station' AND number IS NOT NULL ORDER BY sort_order, name")).rows.map(r => ({ key: stationKey(r.number), name: r.name }));
    const names = new Map((await pool.query("SELECT id, full_name FROM users")).rows.map(r => [r.id, r.full_name]));
    const g2 = (await pool.query("SELECT id, granted_by, granted_at FROM access_grants")).rows;
    const meta = new Map(g2.map(r => [r.id, r]));
    const shownKeys = new Set((await shownSections()).map(x => x.key));
    const onlyShown = lv => Object.fromEntries(Object.entries(lv || {}).filter(([k]) => shownKeys.has(k)));
    const visible = grants.filter(g => rights.master || rights.sections.has(g.section));
    return send(res, 200, {
      isMaster: rights.master, canGroups: rights.master || rights.sections.has("accounts"),
      canGrant: Object.fromEntries([...rights.sections].map(([k, v]) => [k, { all: v.all, divisions: [...v.divisions] }])),
      sections: await shownSections(), divisions: divs, stations,
      people: users.map(u => ({ id: u.id, name: u.name, division: u.division, role: u.role, pattern: u.pattern || "", title: u.title || "", station: u.station || "" })),
      groups: groups.map(g => ({ id: g.id, name: g.name, description: g.description, rules: g.rules, includes: g.includes, excludes: g.excludes, members: membersOf(g, users), isDefault: g.is_default })),
      grants: visible.map(g => ({ id: g.id, section: g.section, level: g.level, userId: g.user_id, groupId: g.group_id, division: g.division, ownDivision: g.own_division,
        grantedBy: names.get(meta.get(g.id)?.granted_by) || "", grantedAt: meta.get(g.id)?.granted_at || null })),
      effective: Object.fromEntries([...byUser].map(([uid, list]) => [uid, list.filter(g => rights.master || rights.sections.has(g.section))])),
      auto: Object.fromEntries(users.map(u => [u.id, auto(u).filter(a => rights.master || rights.sections.has(a.section))])),
      // levels only for the sections this install has
      profiles: (rights.master ? profiles : profiles.map(p => ({ ...p, assigned: [] }))).map(p => ({ ...p, levels: onlyShown(p.levels), base: onlyShown(p.base) })),
      profileOf: Object.fromEntries(users.map(u => [u.id, [...new Set((byUser.get(u.id) || []).filter(g => g.profile).map(g => g.profile))]])),
    });
  }

  if (what === "grants" && req.method === "POST" && !parts[3]) {
    const b = await jsonBody(req);
    const sec = SECTION[b.section];
    if (!sec || !sec.levels[b.level]) throw err(400, "Choose a section and a level.");
    if ((b.userId ? 1 : 0) + (b.groupId ? 1 : 0) !== 1 || !isUuid(b.userId || b.groupId)) throw err(400, "Choose one person or one group.");
    const mine = rights.sections.get(b.section);
    if (!rights.master && (!mine || b.level === "manage")) throw err(403, "You can only give view or edit access in sections you manage.");
    // Scope: "all", "own", or a list of division names
    let scope = b.scope === "own" ? "own" : Array.isArray(b.scope) && b.scope.length ? cleanList(b.scope) : "all";
    if (!sec.divisions) scope = "all";
    if (!rights.master && !mine.all) {
      if (scope === "all" || scope === "own") throw err(403, `You manage ${sec.label} only for ${[...mine.divisions].join(", ")}; pick those divisions.`);
      if (scope.some(d => !mine.divisions.has(d))) throw err(403, `You manage ${sec.label} only for ${[...mine.divisions].join(", ")}.`);
    }
    const target = b.userId
      ? (await pool.query("SELECT full_name AS name, role FROM users WHERE id = $1 AND active", [b.userId])).rows[0]
      : (await pool.query("SELECT name FROM access_groups WHERE id = $1", [b.groupId])).rows[0];
    if (!target) throw err(404, "That person or group wasn't found.");
    const rows = scope === "all" ? [[null, false]] : scope === "own" ? [[null, true]] : [];
    if (Array.isArray(scope)) for (const d of scope) {
      const id = (await pool.query("SELECT id FROM divisions WHERE name = $1", [d])).rows[0]?.id;
      if (!id) throw err(400, `There's no division called ${d}.`);
      rows.push([id, false]);
    }
    for (const [divId, own] of rows) {
      await pool.query(`INSERT INTO access_grants (id, section, level, user_id, group_id, division_id, own_division, granted_by)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
        [crypto.randomUUID(), b.section, b.level, b.userId || null, b.groupId || null, divId, own, user.id]);
    }
    clearAccessCache();
    await audit(pool, user, "Gave access", `${b.groupId ? `Group "${target.name}"` : target.name}: ${sec.label} – ${b.level} (${scope === "all" ? "all divisions" : scope === "own" ? "own division" : scope.join(", ")})`);
    return send(res, 200, { ok: true });
  }

  if (what === "grants" && parts[3] && parts[4] === "remove" && req.method === "POST") {
    if (!isUuid(parts[3])) throw err(400, "Bad grant id");
    const g = (await pool.query(
      `SELECT g.*, d.name AS division, u.full_name AS user_name, gr.name AS group_name FROM access_grants g
         LEFT JOIN divisions d ON d.id = g.division_id LEFT JOIN users u ON u.id = g.user_id LEFT JOIN access_groups gr ON gr.id = g.group_id
        WHERE g.id = $1`, [parts[3]])).rows[0];
    if (!g) return send(res, 200, { ok: true });
    const mine = rights.sections.get(g.section);
    if (!rights.master) {
      if (!mine || g.level === "manage") throw err(403, "You can only remove view or edit access in sections you manage.");
      if (!mine.all && (!g.division || !mine.divisions.has(g.division))) throw err(403, "That access covers divisions you don't manage.");
    }
    await pool.query("DELETE FROM access_grants WHERE id = $1", [g.id]);
    clearAccessCache();
    await audit(pool, user, "Removed access", `${g.group_name ? `Group "${g.group_name}"` : g.user_name}: ${SECTION[g.section]?.label || g.section} – ${g.level} (${describeScope(g)})`);
    return send(res, 200, { ok: true });
  }

  // Profiles: master admins only
  if (what === "profiles" && req.method === "POST") {
    if (!rights.master) throw err(403, "Only master admins can change or assign permission profiles.");
    const b = await jsonBody(req);
    const key = parts[3], act = parts[4];
    const label = async k => (await loadProfiles(pool)).find(p => p.key === k);
    if (key && act === "assign") {
      const p = await label(key);
      if (!p) throw err(404, "That profile wasn't found.");
      const ids = { u: cleanList(b.userIds).filter(isUuid), g: cleanList(b.groupIds).filter(isUuid) };
      if (!ids.u.length && !ids.g.length) throw err(400, "Choose people or groups.");
      for (const uid of ids.u) await pool.query(`INSERT INTO access_profile_members (id, profile_key, user_id, added_by) SELECT $1, $2, id, $4 FROM users WHERE id = $3 ON CONFLICT DO NOTHING`, [crypto.randomUUID(), key, uid, user.name]);
      for (const gid of ids.g) await pool.query(`INSERT INTO access_profile_members (id, profile_key, group_id, added_by) SELECT $1, $2, id, $4 FROM access_groups WHERE id = $3 ON CONFLICT DO NOTHING`, [crypto.randomUUID(), key, gid, user.name]);
      clearAccessCache();
      const names = [...(await pool.query("SELECT full_name AS n FROM users WHERE id::text = ANY(string_to_array($1, ','))", [ids.u.join(",")])).rows,
        ...(await pool.query("SELECT 'Group ' || name AS n FROM access_groups WHERE id::text = ANY(string_to_array($1, ','))", [ids.g.join(",")])).rows].map(r => r.n);
      await audit(pool, user, "Gave profile", `${p.name}: ${names.join(", ")}`);
      return send(res, 200, { ok: true });
    }
    if (key && act === "unassign") {
      if (!isUuid(b.id)) throw err(400, "Bad id");
      const m = (await pool.query(`SELECT m.profile_key, u.full_name, g.name AS gname FROM access_profile_members m LEFT JOIN users u ON u.id = m.user_id
                                     LEFT JOIN access_groups g ON g.id = m.group_id WHERE m.id = $1 AND m.profile_key = $2`, [b.id, key])).rows[0];
      if (!m) return send(res, 200, { ok: true });
      await pool.query("DELETE FROM access_profile_members WHERE id = $1", [b.id]);
      clearAccessCache();
      await audit(pool, user, "Removed profile", `${(await label(key))?.name || key}: ${m.full_name || `Group ${m.gname}`}`);
      return send(res, 200, { ok: true });
    }
    if (key && act === "reset") {
      if (!PROFILE[key]) throw err(400, "Only built-in profiles can be reset.");
      await pool.query("DELETE FROM access_profiles WHERE key = $1", [key]);
      clearAccessCache();
      await audit(pool, user, "Reset profile", (await builtinText(PROFILE[key])).name);
      return send(res, 200, { ok: true });
    }
    if (key && act === "remove") {
      if (PROFILE[key]) throw err(400, "Built-in profiles can't be deleted (Reset puts one back to how it ships).");
      const r = (await pool.query("DELETE FROM access_profiles WHERE key = $1 RETURNING name", [key])).rows[0];
      await pool.query("DELETE FROM access_profile_members WHERE profile_key = $1", [key]);
      clearAccessCache();
      if (r) await audit(pool, user, "Deleted profile", r.name);
      return send(res, 200, { ok: true });
    }
    if (key) throw err(404, "Not found");
    // Create or change: {key?, name, description, levels: {section: level}}
    const name = String(b.name || "").trim().slice(0, 80);
    if (!name) throw err(400, "Give the profile a name.");
    const levels = cleanLevels(b.levels);
    const k = b.key && /^[a-z0-9-]{2,40}$/.test(b.key) ? b.key : null;
    const all = await loadProfiles(pool);
    if (all.some(p => p.name.toLowerCase() === name.toLowerCase() && p.key !== k)) throw err(409, `There's already a profile called ${name}.`);
    let saveKey = k, stored;
    if (k && PROFILE[k]) {
      // Built-in: keep only the differences from how it ships, so later updates still reach it
      const base = builtinLevels(k);
      stored = { add: Object.fromEntries(Object.entries(levels).filter(([s2, l]) => base[s2] !== l)), remove: Object.keys(base).filter(s2 => !levels[s2]) };
      const shipped = await builtinText(PROFILE[k]);
      const same = !Object.keys(stored.add).length && !stored.remove.length && name === shipped.name && String(b.description ?? shipped.description) === shipped.description;
      if (same) await pool.query("DELETE FROM access_profiles WHERE key = $1", [k]);
      else await pool.query(`INSERT INTO access_profiles (key, name, description, builtin, levels, updated_by) VALUES ($1, $2, $3, true, $4, $5)
                              ON CONFLICT (key) DO UPDATE SET name = $2, description = $3, levels = $4, updated_by = $5, updated_at = now()`,
        [k, name, String(b.description ?? "").slice(0, 500), JSON.stringify(stored), user.name]);
    } else {
      if (k && !all.some(p => p.key === k)) throw err(404, "That profile wasn't found.");
      saveKey = k || `p-${crypto.randomUUID().slice(0, 8)}`;
      await pool.query(`INSERT INTO access_profiles (key, name, description, builtin, levels, updated_by) VALUES ($1, $2, $3, false, $4, $5)
                          ON CONFLICT (key) DO UPDATE SET name = $2, description = $3, levels = $4, updated_by = $5, updated_at = now()`,
        [saveKey, name, String(b.description || "").slice(0, 500), JSON.stringify(levels), user.name]);
    }
    clearAccessCache();
    await audit(pool, user, k ? "Changed profile" : "Created profile", `${name}: ${Object.entries(levels).map(([s2, l]) => `${SECTION[s2].label} ${l}`).join(", ") || "nothing"}`);
    return send(res, 200, { ok: true, key: saveKey });
  }

  // Groups: master admins and accounts admins (Accounts manage). An accounts admin can't put themselves into a group
  // that carries access (grants or a profile), and can't delete such a group: that stays with master admins.
  if (what === "groups" && req.method === "POST") {
    if (!rights.master && !rights.sections.has("accounts")) throw err(403, "Only master admins and accounts admins can create or change groups.");
    const b = await jsonBody(req);
    const carriesAccess = async gid => isUuid(gid) && ((await pool.query("SELECT 1 FROM access_grants WHERE group_id = $1 LIMIT 1", [gid])).rowCount > 0
      || (await pool.query("SELECT 1 FROM access_profile_members WHERE group_id = $1 LIMIT 1", [gid])).rowCount > 0);
    if (parts[3] && parts[4] === "remove") {
      const g = (await pool.query("SELECT name FROM access_groups WHERE id = $1", [parts[3]])).rows[0];
      if (!g) return send(res, 200, { ok: true });
      if (!rights.master && await carriesAccess(parts[3])) throw err(403, `${g.name} gives people access to parts of ${brand().productName}, so only a master admin can delete it. Remove its access first, or ask a master admin.`);
      await pool.query("DELETE FROM access_groups WHERE id = $1", [parts[3]]);
      clearAccessCache();
      await audit(pool, user, "Deleted group", g.name);
      return send(res, 200, { ok: true });
    }
    const name = String(b.name || "").trim().slice(0, 80);
    if (!name) throw err(400, "Give the group a name.");
    const r = b.rules || {};
    const rules = { divisions: cleanList(r.divisions), patterns: cleanList(r.patterns).filter(p => /^(weekdays|fire:[ABC]|comms:[ABCD])$/.test(p)), roles: cleanList(r.roles), titles: cleanList(r.titles), stations: cleanList(r.stations).map(stationKey) };
    const id = isUuid(b.id) ? b.id : crypto.randomUUID();
    const exists = isUuid(b.id) && (await pool.query("SELECT 1 FROM access_groups WHERE id = $1", [b.id])).rowCount > 0;
    if (!rights.master && exists && await carriesAccess(id)) {
      const { users, groups } = await effectiveAll(pool);
      const before = groups.find(g => g.id === id);
      const inc = cleanList(b.includes).filter(isUuid), exc = cleanList(b.excludes).filter(isUuid).filter(x => !inc.includes(x));
      const after = membersOf({ rules, includes: inc, excludes: exc }, users);
      if (after.includes(user.id) && !(before && membersOf(before, users).includes(user.id)))
        throw err(403, "This group gives people access to parts of " + brand().productName + ", so you can't add yourself to it. Ask a master admin.");
    }
    try {
      if (exists) await pool.query("UPDATE access_groups SET name = $2, description = $3, rules = $4, updated_at = now() WHERE id = $1", [id, name, String(b.description || "").slice(0, 500), JSON.stringify(rules)]);
      else await pool.query("INSERT INTO access_groups (id, name, description, rules, created_by) VALUES ($1, $2, $3, $4, $5)", [id, name, String(b.description || "").slice(0, 500), JSON.stringify(rules), user.id]);
    } catch (e) {
      if (e.code === "23505") throw err(409, `There's already a group called ${name}.`);
      throw e;
    }
    await pool.query("DELETE FROM access_group_members WHERE group_id = $1", [id]);
    const inc = cleanList(b.includes).filter(isUuid), exc = cleanList(b.excludes).filter(isUuid).filter(x => !inc.includes(x));
    for (const [list, mode] of [[inc, "include"], [exc, "exclude"]]) for (const uid of list) {
      await pool.query("INSERT INTO access_group_members (group_id, user_id, mode, added_by) SELECT $1, id, $3, $4 FROM users WHERE id = $2 ON CONFLICT DO NOTHING", [id, uid, mode, user.id]);
    }
    clearAccessCache();
    await audit(pool, user, exists ? "Changed group" : "Created group", name);
    return send(res, 200, { ok: true, id });
  }
  throw err(404, "Not found");
}
