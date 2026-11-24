// Annual leave picks (/api/leave/*). See db/migrations/022_leave_picks.sql.
//
// Rules come from the 2025 Suppression leave memo and the 2026 Communications Annual Leave Procedure:
//  - People pick inside a unit (one off per unit per shift), in turn order, round after round.
//    Suppression: by rank, then seniority; first 3 picks = up to 3 consecutive shifts, then up to 3 shifts anywhere.
//    Communications (per crew): by seniority only (no Shift Leads); every pick up to 7 consecutive shifts,
//    then a 1, 2 or 3 shift block. Blocked dates can't be picked.
//  - Suppression: after picks, only the 6 most senior (years of service) per shift-day are offered that day.
//    Picks past the cap are allowed but flagged "bumped" for the Assistant Chief.
//  - Leave is charged in date order: holidays (OH), then vacation (OV), then banked vacation / comp time (OC).
//  - Under one year of service on January 1: only holiday leave before the one-year anniversary.
//  - Suppression: all holidays must be scheduled before someone is done.
//  - Moving or rescinding a pick after it's made: managers only (Fire Chief or designee).
import crypto from "node:crypto";
import { brand, brandText, brandDeep } from "./brand.js";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { fireShift, commsShifts, addDays } from "../src/shifts.js";
import { publish } from "./events.js";
import { workbook, readWorkbook } from "./xlsx.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const iso = d => d ? (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : String(d).slice(0, 10)) : null;
const num = v => (v === null || v === undefined || v === "" ? 0 : Number(v));

export const DEFAULT_RULES = {
  fire: {
    label: "Suppression", shiftHours: 24, start: "0700",
    firstPicks: 3, firstMax: 3, firstConsecutive: true, laterMax: 3, laterConsecutive: false,
    holidaysAll: true, caps: { Suppression: 6 }, blocked: [], note: "",
  },
  comms: {
    label: "Communications", shiftHours: 12,
    firstPicks: 2, firstMax: 7, firstConsecutive: true, laterMax: 7, laterConsecutive: true,
    holidaysAll: false, caps: {}, blocked: [], note: "",
  },
};
export const CODES = { holiday: "OH", vacation: "OV", banked: "OC" };

function rulesOf(season) {
  const r = season.rules || {};
  const out = {};
  for (const k of ["fire", "comms"]) {
    out[k] = { ...DEFAULT_RULES[k], ...(r[k] || {}) };
    out[k].caps = { ...(r[k]?.caps || DEFAULT_RULES[k].caps) };
    out[k].blocked = Array.isArray(r[k]?.blocked) ? r[k].blocked : [];
  }
  // Each Suppression shift's Assistant Chief and Battalion Chiefs: told as picks complete, and see their shift's units and reports
  const o = r.fire?.officers || {};
  out.fire.officers = Object.fromEntries(["A", "B", "C"].map(x => [x, Array.isArray(o[x]) ? o[x].filter(isUuid) : []]));
  return out;
}

// ---- Shifts a unit works in a year ------------------------------------------------------------
export function shiftDays(ruleset, shift, year, rules) {
  const out = [];
  for (let d = `${year}-01-01`; d <= `${year}-12-31`; d = addDays(d, 1)) {
    if (ruleset === "fire") { if (fireShift(d) === shift) out.push({ day: d, start: rules.fire.start || "0700" }); }
    else { const c = commsShifts(d); if (c.day === shift) out.push({ day: d, start: "0700" }); else if (c.night === shift) out.push({ day: d, start: "1900" }); }
  }
  return out;
}
const blockedLabel = (rs, day) => (rs.blocked || []).find(b => isDay(b.from) && day >= b.from && day <= (isDay(b.to) ? b.to : b.from));

// Under one year of service on Jan 1 of the season: the one-year anniversary inside the season
function anniversary(member, year) {
  const s = iso(member.seniority_date || member.hire_date);
  if (!s || s <= `${year - 1}-01-01`) return null;
  const [y, m, d] = s.split("-").map(Number);
  const a = `${y + 1}-${String(m).padStart(2, "0")}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, "0")}`;
  return a;
}

// Charge picked shifts in date order: holidays, then vacation, then banked/comp
export function charge(member, days) {
  const left = { OH: num(member.holiday_hours), OV: num(member.vacation_hours), OC: num(member.banked_hours) };
  const out = new Map();
  for (const d of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
    let need = num(d.hours); const parts = [];
    for (const code of ["OH", "OV", "OC"]) {
      if (need <= 0) break;
      const take = Math.min(need, left[code]);
      if (take > 0) { parts.push({ code, hours: take }); left[code] -= take; need -= take; }
    }
    if (need > 0) parts.push({ code: "OVER", hours: need });
    out.set(d.day, parts);
  }
  return out;
}

// ---- Loading a season --------------------------------------------------------------------------
async function loadSeason(c, sid) {
  const s = (await c.query("SELECT * FROM leave_seasons WHERE id = $1", [sid])).rows[0];
  if (!s) throw err(404, "That pick year wasn't found.");
  return s;
}
async function loadAll(c, sid) {
  const season = await loadSeason(c, sid);
  const rules = rulesOf(season);
  const units = (await c.query("SELECT * FROM leave_units WHERE season_id = $1 ORDER BY ruleset DESC, shift, sort, name", [sid])).rows;
  const members = (await c.query(
    `SELECT m.*, COALESCE(u.full_name, m.name) AS name, m.name AS roster_name, u.full_name AS account_name, u.job_title AS title,
            u.work_pattern, COALESCE(d.name, NULLIF(m.division, ''), 'Suppression') AS division, (m.user_id IS NULL OR u.password_hash IS NULL OR NOT u.active) AS locked
       FROM leave_members m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN divisions d ON d.id = u.division_id
      WHERE m.season_id = $1 ORDER BY m.pick_order, COALESCE(u.full_name, m.name)`, [sid])).rows;
  const picks = (await c.query("SELECT * FROM leave_picks WHERE season_id = $1 ORDER BY created_at", [sid])).rows;
  const days = (await c.query("SELECT pick_id, member_id, user_id, unit_id, day::text AS day, start_time, hours FROM leave_pick_days WHERE season_id = $1 ORDER BY day", [sid])).rows;
  return { season, rules, units, members, picks, days };
}

// Everything worked out: used hours, turns, codes, the 6-a-day standing
function compute(all) {
  const { season, rules, units, members, picks, days } = all;
  const byUnit = new Map(units.map(u => [u.id, { ...u, members: [] }]));
  const pickById = new Map(picks.map(p => [p.id, { ...p, days: [] }]));
  for (const d of days) pickById.get(d.pick_id)?.days.push({ day: d.day, start: d.start_time, hours: num(d.hours) });
  const mem = new Map(), byUser = new Map();     // member id -> member; Nexus account -> member
  for (const m of members) {
    const unit = byUnit.get(m.unit_id);
    const rs = unit ? rules[unit.ruleset] : rules.fire;
    const myPicks = picks.filter(p => p.member_id === m.id).map(p => pickById.get(p.id)).sort((a, b) => a.round - b.round);
    const myDays = myPicks.flatMap(p => p.days);
    const used = myDays.reduce((s, d) => s + d.hours, 0);
    const total = num(m.holiday_hours) + num(m.vacation_hours) + num(m.banked_hours);
    const usedHoliday = Math.min(used, num(m.holiday_hours));
    const o = {
      ...m, unit, rs, picks: myPicks, used, total, remaining: Math.max(0, total - used),
      holidaysLeft: Math.max(0, num(m.holiday_hours) - usedHoliday),
      autoDone: unit ? total - used < rs.shiftHours : false,
      codes: charge(m, myDays), anniversary: anniversary(m, season.year),
    };
    mem.set(m.id, o);
    if (m.user_id) byUser.set(m.user_id, o);
    if (unit) unit.members.push(o);
  }
  for (const u of byUnit.values()) {
    u.members.sort((a, b) => a.pick_order - b.pick_order || a.name.localeCompare(b.name));
    u.turn = null;
    if (season.status === "open") {
      outer: for (let r = 1; r <= 200; r++) {
        let any = false;
        for (const m of u.members) {
          if (m.done || m.autoDone) continue;
          any = true;
          if (!m.picks.some(p => p.round === r)) { u.turn = { memberId: m.id, userId: m.user_id, round: r, locked: m.locked }; break outer; }
        }
        if (!any) break;
      }
    }
    u.complete = u.members.length > 0 && u.members.every(m => m.done || m.autoDone);
  }
  // Daily cap standing (e.g. Suppression: first 6 by years of service)
  const standing = new Map();     // `${memberId}|${day}` -> { rank, of, cap, bumped }
  const poolDays = new Map();     // `${ruleset}|${pool}|${shift}` -> Map(day -> [entries])
  for (const d of days) {
    const u = byUnit.get(d.unit_id); if (!u) continue;
    const cap = rules[u.ruleset].caps?.[u.pool];
    if (!cap) continue;
    const key = `${u.ruleset}|${u.pool}|${u.shift}`;
    if (!poolDays.has(key)) poolDays.set(key, new Map());
    const m = mem.get(d.member_id);
    const p = pickById.get(d.pick_id);
    const list = poolDays.get(key).get(d.day) || [];
    list.push({ memberId: d.member_id, userId: d.user_id, name: m?.name || "", unit: u.name, yos: m?.yos ?? -1, seniority: iso(m?.seniority_date) || "9999", at: p?.created_at, cap });
    poolDays.get(key).set(d.day, list);
  }
  for (const map of poolDays.values()) {
    for (const [day, list] of map) {
      list.sort((a, b) => (b.yos - a.yos) || a.seniority.localeCompare(b.seniority) || (new Date(a.at) - new Date(b.at)));
      list.forEach((e, i) => { e.rank = i + 1; e.bumped = i + 1 > e.cap; standing.set(`${e.memberId}|${day}`, { rank: i + 1, of: list.length, cap: e.cap, bumped: e.bumped }); });
    }
  }
  return { season, rules, units: [...byUnit.values()], mem, byUser, standing, poolDays };
}

// ---- Who may do what ----------------------------------------------------------------------------
// The Suppression shifts this person is a shift officer for
const officerShifts = (rules, user) => ["A", "B", "C"].filter(x => (rules.fire.officers?.[x] || []).includes(user.id));
async function accessOf(user) {
  return {
    view: await hasAccess(pool, user, "leave", "view"),
    edit: await hasAccess(pool, user, "leave", "edit"),
    manage: await hasAccess(pool, user, "leave", "manage"),
  };
}
async function canActFor(user, acc, st, target) {
  if (target.user_id && target.user_id === user.id) return true;
  if (acc.manage) return true;
  if (await hasAccess(pool, user, "leave", "edit", target.division)) return true;
  const me = st.byUser.get(user.id);
  return !!(me?.leader && me.unit_id && me.unit_id === target.unit_id);
}

// ---- Checking a pick -----------------------------------------------------------------------------
// manual: entered out of turn (phoned in / backfilled) by a leader or Leave picks Edit/Manage.
// waive: also set aside the pick-size and in-a-row rules (conflicts, blocked dates and hours still apply).
function checkPick(st, member, dayList, { manual = false, waive = false, canClosed = false } = {}) {
  const errors = [], warnings = [];
  const unit = member.unit;
  if (!unit) return { errors: ["This person isn't in a unit yet."], warnings, days: [] };
  const rs = st.rules[unit.ruleset];
  const year = st.season.year;
  if (st.season.status !== "open" && !(manual && canClosed && st.season.status === "closed")) errors.push("Picking isn't open.");
  if (member.done && !manual) errors.push(`${member.name} has finished picking.`);
  if (member.done && manual) warnings.push(`${member.name} was marked done; this adds another pick.`);
  let round = 0;
  if (manual) round = Math.max(0, ...member.picks.map(p => p.round)) + 1;
  else if (!unit.turn || unit.turn.memberId !== member.id) errors.push(`It isn't ${member.name.split(" ")[0]}'s turn in ${unitLabel(unit, st.rules)}.`);
  else round = unit.turn.round;
  const rule = (msg) => (waive ? warnings : errors).push(waive ? `${msg} (rule set aside for this entry)` : msg);
  const want = [...new Set((dayList || []).filter(isDay))].sort();
  if (!want.length) errors.push("Choose at least one shift.");
  const first = round > 0 && round <= rs.firstPicks;
  const max = first ? rs.firstMax : rs.laterMax;
  const consecutive = first ? rs.firstConsecutive : rs.laterConsecutive;
  if (want.length > max) rule(`Pick ${round || ""} can be up to ${max} shift${max === 1 ? "" : "s"}${consecutive ? " in a row" : ""}.`.replace("Pick  ", "This pick "));
  const shifts = shiftDays(unit.ruleset, unit.shift, year, st.rules);
  const index = new Map(shifts.map((s, i) => [s.day, i]));
  const taken = new Map();
  for (const m of unit.members) for (const p of m.picks) for (const d of p.days) taken.set(d.day, m);
  const days = [];
  for (const d of want) {
    if (!d.startsWith(`${year}-`)) { errors.push(`${d} isn't in ${year}.`); continue; }
    if (!index.has(d)) { errors.push(`${unitLabel(unit, st.rules)} doesn't work ${prettyDay(d)}.`); continue; }
    const b = blockedLabel(rs, d);
    if (b) errors.push(`${prettyDay(d)} is blocked (${b.label || "no leave"}).`);
    const t = taken.get(d);
    if (t) errors.push(`${prettyDay(d)} is already taken by ${t.id === member.id ? "you" : t.name}.`);
    days.push({ day: d, start: shifts[index.get(d)].start, hours: rs.shiftHours });
  }
  if (consecutive && days.length > 1) {
    const idx = days.map(d => index.get(d.day)).filter(i => i !== undefined).sort((a, b) => a - b);
    if (idx.some((v, i) => i && v !== idx[i - 1] + 1)) rule(`These shifts have to be in a row (back-to-back shifts for ${unitLabel(unit, st.rules)}).`);
  }
  const hours = days.reduce((s, d) => s + d.hours, 0);
  if (hours > member.remaining + 1e-6) errors.push(`That's ${hours} hours; ${member.name.split(" ")[0]} has ${fmtH(member.remaining)} left.`);
  // Anniversary: before it, only holiday hours
  if (member.anniversary) {
    const all = [...member.picks.flatMap(p => p.days), ...days];
    const before = all.filter(d => d.day < member.anniversary).reduce((s, d) => s + d.hours, 0);
    if (before > num(member.holiday_hours) + 1e-6) {
      errors.push(`Before ${prettyDay(member.anniversary)} (one-year anniversary) only holiday leave can be used: ${fmtH(num(member.holiday_hours))} of holidays, and these picks need ${fmtH(before)}.`);
    }
  }
  // Charge codes with this pick added, and the daily cap standing it would get
  const codes = charge(member, [...member.picks.flatMap(p => p.days), ...days]);
  const cap = rs.caps?.[unit.pool];
  for (const d of days) {
    d.codes = codes.get(d.day) || [];
    if (cap) {
      const list = (st.poolDays.get(`${unit.ruleset}|${unit.pool}|${unit.shift}`)?.get(d.day) || []).filter(e => e.memberId !== member.id);
      const ahead = list.filter(e => (e.yos > (member.yos ?? -1)) || (e.yos === (member.yos ?? -1) && e.seniority <= (iso(member.seniority_date) || "9999"))).length;
      d.rank = ahead + 1; d.of = list.length + 1; d.cap = cap;
      if (d.rank > cap) warnings.push(`${prettyDay(d.day)}: ${ahead} more senior ${ahead === 1 ? "person is" : "people are"} already off on ${unit.shift} shift. Only the first ${cap} by years of service are offered that day, so this one would be flagged.`);
      else if (d.of > cap) warnings.push(`${prettyDay(d.day)}: this makes ${d.of} off on ${unit.shift} shift. You'd be #${d.rank} by years of service, so someone less senior gets flagged.`);
    }
    if (d.codes.some(x => x.code === "OVER")) errors.push(`${prettyDay(d.day)} is more leave than ${member.name.split(" ")[0]} has.`);
  }
  return { errors, warnings, days, round, max, consecutive };
}
const fmtH = h => `${Math.round(h * 100) / 100} h`;
const prettyDay = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const unitLabel = (u, rules) => u.ruleset === "comms" ? `Comms ${u.shift} Crew` : u.name === "Chiefs" ? `Chiefs · ${u.shift} Shift` : `${u.name} · ${u.shift} Shift`;

// ---- Turn messages and live refresh --------------------------------------------------------------
async function afterChange(sid, unitIds, actor) {
  const st = compute(await loadAll(pool, sid));
  try { await fileRecords(st, actor); await completionNotices(st, actor); }
  catch (e) { console.warn(`[Leave picks] records/notices: ${e.message}`); }
  for (const u of st.units.filter(x => !unitIds || unitIds.includes(x.id))) {
    publish(u.members.map(m => m.user_id).filter(Boolean), "leave", { seasonId: sid, unitId: u.id });
    const t = u.turn;
    if (!t) continue;
    if (u.notified_user === t.memberId && u.notified_round === t.round) continue;
    await pool.query("UPDATE leave_units SET notified_user = $2, notified_round = $3 WHERE id = $1", [u.id, t.memberId, t.round]);
    const m = st.mem.get(t.memberId);
    const rs = st.rules[u.ruleset];
    const first = t.round <= rs.firstPicks;
    const size = `up to ${first ? rs.firstMax : rs.laterMax} shift${(first ? rs.firstMax : rs.laterMax) === 1 ? "" : "s"}${(first ? rs.firstConsecutive : rs.laterConsecutive) ? " in a row" : ""}`;
    // Who gets told: the person; or, while they can't sign in, the unit's leaders, else the coordinators,
    // else (nobody else to tell) whoever opened the pick, as a note to themselves
    if (!m.locked) {
      await sendAs(st, actor, [m.user_id], `Your turn to pick leave (${st.season.year}, pick ${t.round})`,
        `It's your turn to make pick ${t.round} for ${unitLabel(u, st.rules)}.\n\nThis pick: ${size}. ` +
        `You have ${fmtH(m.remaining)} of leave left to schedule${m.holidaysLeft ? `, including ${fmtH(m.holidaysLeft)} of holidays` : ""}.\n\nOpen Leave Picks in ${brand().productName} to make your pick.`);
      continue;
    }
    let to = u.members.filter(x => x.leader && !x.locked).map(x => x.user_id);
    if (!to.length) to = await coordinators(m.division);
    const self = !to.length;
    if (self) to = [st.season.opened_by || actor?.id].filter(Boolean);
    await sendAs(st, actor, to, `Leave pick: ${m.name} is up (no ${brand().productName} account yet)`,
      `${m.name} is up for pick ${t.round} in ${unitLabel(u, st.rules)}, but ${m.user_id ? "hasn't set up their " + brand().productName + " sign-in" : "doesn't have a " + brand().productName + " account"} yet, so they can't pick themselves.\n\n` +
      `Get their pick by phone and enter it (Leave Picks > All units or My unit > ${m.name} > Pick for), or skip their turn. This pick: ${size}; ` +
      `${fmtH(m.remaining)} left to schedule${m.holidaysLeft ? `, including ${fmtH(m.holidaysLeft)} of holidays` : ""}.` +
      (self ? `\n\n(Nobody leads this unit and nobody has Leave picks: Edit for ${m.division}, so this came to you.)` : ""), self);
  }
}
// Who messages come from: whoever opened the pick, else whoever made the change (never to themselves, unless toSelf)
async function sendAs(st, actor, to, subject, body, toSelf = false) {
  const { send } = await import("./messages.js");
  to = [...new Set(to)].filter(Boolean);
  let senderId = st.season.opened_by || actor?.id;
  if (!toSelf && to.includes(senderId)) {
    const alt = [actor?.id].find(x => x && !to.includes(x));
    if (alt) senderId = alt; else toSelf = true;
  }
  if (!senderId || !to.length) return;
  const from = (await pool.query("SELECT id, full_name AS name, role FROM users WHERE id = $1", [senderId])).rows[0];
  if (!from) return;
  try { await send(from, { users: to, important: false, timing: "now", subject, body, toSelf }); }
  catch (e) { console.warn(`[Leave picks] message: ${e.message}`); }
}
// Completed picks are filed in the person's Personnel File (kept current if they change afterwards)
const lineKey = lines => lines.map(l => `${l.day}|${l.start}|${l.hours}|${l.code}|${l.bumped ? 1 : 0}`).join(",");
async function fileRecords(st, actor) {
  const have = new Map((await pool.query("SELECT * FROM leave_records WHERE season_id = $1", [st.season.id])).rows.map(r => [r.member_id, r]));
  for (const u of st.units) for (const m of u.members) {
    const rec = have.get(m.id);
    const complete = m.done || m.autoDone;
    if (!complete) {
      if (rec && rec.status === "complete") await pool.query("UPDATE leave_records SET status = 'reopened', updated_at = now() WHERE id = $1", [rec.id]);
      continue;
    }
    const lines = formLines(st, m).map(l => ({ day: l.day, start: l.start, hours: l.hours, code: l.code, round: l.round, bumped: l.bumped }));
    if (!lines.length && !m.done) continue;
    const totals = { total: 0 };
    for (const l of lines) { totals[l.code] = (totals[l.code] || 0) + l.hours; totals.total += l.hours; }
    const args = [m.user_id, m.name, unitLabel(u, st.rules), u.shift, u.ruleset, JSON.stringify(lines), totals];
    if (!rec) {
      await pool.query(`INSERT INTO leave_records (id, season_id, member_id, user_id, year, name, unit, shift, ruleset, lines, totals)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (member_id) DO NOTHING`, [crypto.randomUUID(), st.season.id, m.id, args[0], st.season.year, ...args.slice(1)]);
      if (m.user_id) await sendAs(st, actor, [m.user_id], `Your ${st.season.year} leave picks are complete`,
        `Your ${st.season.year} leave picks are complete and a copy (dates and leave types) has been filed in your Personnel File.\n\n` +
        lines.map(l => `${prettyDay(l.day)}: ${l.code}${l.hours !== st.rules[u.ruleset].shiftHours ? ` (${l.hours} h)` : ""}${l.bumped ? " (flagged: over the daily limit)" : ""}`).join("\n"));
    } else if (rec.status !== "complete" || lineKey(rec.lines || []) !== lineKey(lines) || rec.user_id !== m.user_id || rec.unit !== args[2]) {
      const changed = lineKey(rec.lines || []) !== lineKey(lines);
      await pool.query(`UPDATE leave_records SET user_id = $2, name = $3, unit = $4, shift = $5, ruleset = $6, lines = $7, totals = $8, status = 'complete',
          updated_at = now(), revisions = revisions + $9 WHERE id = $1`, [rec.id, ...args, changed ? 1 : 0]);
    }
  }
}

// Each Suppression shift's officers hear when a unit finishes and when the whole shift is done
async function completionNotices(st, actor) {
  if (st.season.status !== "open") return;
  const officers = st.rules.fire.officers || {};
  const sum = m => { const t = {}; for (const p of m.picks) for (const d of p.days) for (const c of (m.codes.get(d.day) || [])) t[c.code] = (t[c.code] || 0) + c.hours; return Object.entries(t).map(([k, v]) => `${k} ${fmtH(v)}`).join(", ") || "no leave"; };
  for (const u of st.units.filter(x => x.ruleset === "fire")) {
    if (u.complete && !u.complete_notified) {
      await pool.query("UPDATE leave_units SET complete_notified = true WHERE id = $1", [u.id]);
      await sendAs(st, actor, officers[u.shift] || [], `Leave picks complete: ${unitLabel(u, st.rules)}`,
        `${unitLabel(u, st.rules)} has finished its ${st.season.year} leave picks.\n\n` + u.members.map(m => `${m.name}: ${sum(m)}`).join("\n") +
        `\n\nOpen Leave Picks > Reports in ${brand().productName} for the forms and the shift spreadsheet.`);
    } else if (!u.complete && u.complete_notified) await pool.query("UPDATE leave_units SET complete_notified = false WHERE id = $1", [u.id]);
  }
  const flags = { ...(st.season.shifts_notified || {}) };
  let dirty = false;
  for (const x of ["A", "B", "C"]) {
    const list = st.units.filter(u => u.ruleset === "fire" && u.shift === x);
    const done = list.length > 0 && list.every(u => u.complete);
    if (done && !flags[x]) {
      flags[x] = true; dirty = true;
      const people = list.reduce((n, u) => n + u.members.length, 0);
      await sendAs(st, actor, officers[x] || [], `${x} Shift leave picks are complete (${st.season.year})`,
        `Every unit on ${x} Shift has finished its ${st.season.year} leave picks: ${list.length} units, ${people} people.\n\n` +
        `Open Leave Picks > Reports in ${brand().productName} to download ${x} Shift's forms, spreadsheet, or the list for Aladtec.`);
    } else if (!done && flags[x]) { delete flags[x]; dirty = true; }
  }
  if (dirty) await pool.query("UPDATE leave_seasons SET shifts_notified = $2 WHERE id = $1", [st.season.id, flags]);
}

// People (not master admins) with Leave picks: Edit for a division: the coordinators
async function coordinators(division) {
  const { activePeople } = await import("./access.js");
  const out = [];
  for (const p of await activePeople(pool)) {
    if (p.role === "master") continue;
    if (await hasAccess(pool, { id: p.id, role: p.role, division: p.division }, "leave", "edit", division)) out.push(p.id);
  }
  return out;
}

// ---- What a viewer sees ---------------------------------------------------------------------------
function memberOut(st, m, full) {
  return {
    id: m.id, userId: m.user_id, locked: m.locked, rosterName: m.roster_name, name: m.name, title: m.title || "", division: m.division, order: m.pick_order, leader: m.leader, rank: m.rank,
    yos: m.yos, seniorityDate: iso(m.seniority_date), anniversary: m.anniversary,
    ...(full ? { empNo: m.emp_no, hireDate: iso(m.hire_date), holiday: num(m.holiday_hours), vacation: num(m.vacation_hours), banked: num(m.banked_hours),
      used: m.used, remaining: m.remaining, holidaysLeft: m.holidaysLeft, note: m.note } : {}),
    done: m.done, autoDone: m.autoDone,
    picks: m.picks.map(p => ({
      id: p.id, round: p.round, skipped: p.skipped, enteredBy: p.entered_by_name, enteredById: p.entered_by, at: p.created_at, manual: p.manual, waived: p.rules_waived,
      days: p.days.map(d => ({ ...d, codes: full ? m.codes.get(d.day) || [] : undefined, standing: st.standing.get(`${m.id}|${d.day}`) || null })),
    })),
  };
}
async function stateFor(user, sid) {
  const st = compute(await loadAll(pool, sid));
  const acc = await accessOf(user);
  const me = st.byUser.get(user.id);
  const seeAll = acc.view || acc.edit || acc.manage;
  const officer = officerShifts(st.rules, user);
  const units = [];
  for (const u of st.units) {
    const mine = me?.unit_id === u.id;
    const shiftOfficer = u.ruleset === "fire" && officer.includes(u.shift);
    if (!seeAll && !mine && !shiftOfficer) continue;
    const leader = mine && me.leader;
    const out = [];
    for (const m of u.members) {
      const full = (m.user_id && m.user_id === user.id) || leader || shiftOfficer || acc.manage || (await hasAccess(pool, user, "leave", "view", m.division));
      out.push({ ...memberOut(st, m, full), canAct: await canActFor(user, acc, st, m) });
    }
    units.push({ id: u.id, name: u.name, label: unitLabel(u, st.rules), ruleset: u.ruleset, shift: u.shift, pool: u.pool, turn: u.turn, complete: u.complete, members: out });
  }
  // The daily standing for this viewer's pool (or every pool for people who see everything)
  const pools = {};
  for (const [key, map] of st.poolDays) {
    const [ruleset, poolName, shift] = key.split("|");
    if (!seeAll && !(ruleset === "fire" && officer.includes(shift)) && !(me?.unit && me.unit.ruleset === ruleset && me.unit.pool === poolName && me.unit.shift === shift)) continue;
    pools[key] = Object.fromEntries([...map].map(([day, list]) => [day, list.map(e => ({ memberId: e.memberId, userId: e.userId, name: e.name, unit: e.unit, yos: e.yos, rank: e.rank, bumped: e.bumped }))]));
  }
  return {
    season: { id: st.season.id, year: st.season.year, status: st.season.status, rules: st.rules, openedAt: st.season.opened_at },
    access: { ...acc, officer, reports: acc.view || acc.manage || officer.length > 0 },
    me: me ? { memberId: me.id, userId: user.id, unitId: me.unit_id, leader: me.leader } : null, units, pools,
    // For Setup: linking roster entries to accounts, and choosing shift officers
    people: acc.manage ? (await pool.query("SELECT id, full_name AS name, COALESCE(employee_number, '') AS emp FROM users WHERE active AND account_status = 'approved' ORDER BY full_name")).rows : undefined,
  };
}

// ---- Making picks ----------------------------------------------------------------------------------
// Who a request is about: { memberId } (roster entry, works without an account) or { userId }, else the caller
function targetOf(st, b, user) {
  if (isUuid(b.memberId)) return st.mem.get(b.memberId);
  return st.byUser.get(isUuid(b.userId) ? b.userId : user.id);
}
async function makePick(user, sid, b, { check = false } = {}) {
  const st = compute(await loadAll(pool, sid));
  const acc = await accessOf(user);
  const target = targetOf(st, b, user);
  if (!target) throw err(404, "That person isn't in this year's pick.");
  if (!(await canActFor(user, acc, st, target))) throw err(403, "You can only pick for yourself (or your unit, as its leader).");
  const manual = b.manual === true;
  // Out-of-turn entries are for someone else's picks (a leader, or Leave picks Edit/Manage); managers may also enter yours
  if (manual && target.user_id === user.id && !acc.manage) throw err(403, "Your own picks go in your turn. A leader or Leave picks: Edit can enter one for you out of turn.");
  const r = checkPick(st, target, b.days, { manual, waive: manual && b.waive === true, canClosed: acc.manage });
  if (check || r.errors.length) return { ok: !r.errors.length, ...r };
  const id = crypto.randomUUID();
  try {
    await tx(async c => {
      await c.query(`INSERT INTO leave_picks (id, season_id, member_id, user_id, unit_id, round, entered_by, entered_by_name, manual, rules_waived) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, sid, target.id, target.user_id, target.unit_id, r.round, user.id, user.name, manual, manual && b.waive === true]);
      for (const d of r.days) {
        await c.query(`INSERT INTO leave_pick_days (pick_id, season_id, member_id, user_id, unit_id, day, start_time, hours) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, sid, target.id, target.user_id, target.unit_id, d.day, d.start, d.hours]);
      }
      if (target.user_id !== user.id || manual) await audit(c, user, manual ? `Entered leave for ${target.name} out of turn` : `Picked leave for ${target.name}`,
        `${st.season.year} pick ${r.round}${manual && b.waive === true ? " (pick-size rules set aside)" : ""}: ${r.days.map(d => d.day).join(", ")}`);
    });
  } catch (e) {
    if (e.code === "23505") throw err(409, "Someone just took one of those shifts. Look again and choose another.");
    throw e;
  }
  await afterChange(sid, [target.unit_id], user);
  return { ok: true, id, round: r.round, warnings: r.warnings };
}

async function skipTurn(user, sid, b) {
  const st = compute(await loadAll(pool, sid));
  const acc = await accessOf(user);
  const target = (isUuid(b.memberId) || isUuid(b.userId)) ? targetOf(st, b, user) : null;
  if (!target?.unit) throw err(404, "That person isn't in a unit.");
  if ((target.user_id && target.user_id === user.id) || !(await canActFor(user, acc, st, target))) throw err(403, "A unit leader or an administrator can skip someone's turn.");
  if (target.unit.turn?.memberId !== target.id) throw err(400, `It isn't ${target.name}'s turn.`);
  await tx(async c => {
    await c.query(`INSERT INTO leave_picks (id, season_id, member_id, user_id, unit_id, round, skipped, entered_by, entered_by_name) VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)`,
      [crypto.randomUUID(), sid, target.id, target.user_id, target.unit_id, target.unit.turn.round, user.id, user.name]);
    await audit(c, user, `Skipped a leave pick turn`, `${target.name}, ${st.season.year} pick ${target.unit.turn.round}`);
  });
  await afterChange(sid, [target.unit_id], user);
  return { ok: true };
}

async function setDone(user, sid, b) {
  const st = compute(await loadAll(pool, sid));
  const acc = await accessOf(user);
  const target = targetOf(st, b, user);
  if (!target) throw err(404, "That person isn't in this year's pick.");
  if (!(await canActFor(user, acc, st, target))) throw err(403, "Not allowed.");
  const done = b.done !== false;
  if (!done && target.done && !acc.manage && target.user_id !== user.id) throw err(403, "Only an administrator can reopen someone else's picks.");
  if (done && target.unit && st.rules[target.unit.ruleset].holidaysAll && target.holidaysLeft > 0) {
    throw err(400, `All holidays have to be scheduled first: ${fmtH(target.holidaysLeft)} of holidays left.`);
  }
  await pool.query("UPDATE leave_members SET done = $2, done_at = CASE WHEN $2 THEN now() END WHERE id = $1", [target.id, done]);
  await afterChange(sid, target.unit_id ? [target.unit_id] : null, user);
  return { ok: true };
}

// Undo: the person or their leader can take back the unit's most recent pick if it's theirs;
// managers (Fire Chief or designee) can remove any pick or any single day.
async function undoPick(user, sid, b) {
  const st = compute(await loadAll(pool, sid));
  const acc = await accessOf(user);
  const p = (await pool.query("SELECT * FROM leave_picks WHERE id = $1 AND season_id = $2", [b.pickId, sid])).rows[0];
  if (!p) throw err(404, "That pick wasn't found.");
  const target = st.mem.get(p.member_id);
  const latest = (await pool.query("SELECT id FROM leave_picks WHERE unit_id = $1 ORDER BY created_at DESC LIMIT 1", [p.unit_id])).rows[0]?.id;
  if (!acc.manage) {
    if (!(await canActFor(user, acc, st, target))) throw err(403, "Not allowed.");
    if (latest !== p.id) throw err(403, "Only the unit's most recent pick can be taken back. After that, changes need the Fire Chief or his designee.");
  }
  const day = isDay(b.day) ? b.day : null;
  await tx(async c => {
    if (day) {
      await c.query("DELETE FROM leave_pick_days WHERE pick_id = $1 AND day = $2", [p.id, day]);
      const left = (await c.query("SELECT count(*)::int AS n FROM leave_pick_days WHERE pick_id = $1", [p.id])).rows[0].n;
      if (!left) await c.query("DELETE FROM leave_picks WHERE id = $1", [p.id]);
    } else await c.query("DELETE FROM leave_picks WHERE id = $1", [p.id]);
    await audit(c, user, day ? "Rescinded a day of leave" : "Took back a leave pick", `${target?.name || ""}, ${st.season.year} pick ${p.round}${day ? `: ${day}` : ""}`);
  });
  await afterChange(sid, [p.unit_id], user);
  return { ok: true };
}

async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Leave picks', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 2000)]);
}

// ---- Setup (manage) ------------------------------------------------------------------------------
const RANKS = [[/chief/i, 0], [/captain|capt\b/i, 1], [/lieutenant|\blt\b/i, 2], [/senior|sr\.?\s*f|engineer|driver|operator/i, 3], [/firefighter|f\/?o\b|ff\b/i, 4]];
const rankOf = t => (RANKS.find(([re]) => re.test(t || "")) || [null, 5])[1];

// Default turn order for a unit: Suppression by rank then seniority (Captain leads); Communications by seniority only, no leader
async function reorderUnit(c, unitId) {
  const u = (await c.query("SELECT * FROM leave_units WHERE id = $1", [unitId])).rows[0];
  if (!u) return;
  const ms = (await c.query(`SELECT m.id, m.rank, m.yos, m.seniority_date, m.hire_date, u.job_title FROM leave_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.unit_id = $1`, [unitId])).rows;
  const sen = m => iso(m.seniority_date || m.hire_date) || "9999";
  ms.sort((a, b) => {
    const ra = u.ruleset === "comms" ? 0 : (u.name === "Chiefs" ? 0 : rankOf(a.rank || a.job_title));
    const rb = u.ruleset === "comms" ? 0 : (u.name === "Chiefs" ? 0 : rankOf(b.rank || b.job_title));
    return ra - rb || (num(b.yos) - num(a.yos)) || sen(a).localeCompare(sen(b));
  });
  for (let i = 0; i < ms.length; i++) {
    await c.query("UPDATE leave_members SET pick_order = $2, leader = $3 WHERE id = $1", [ms[i].id, i + 1, i === 0 && u.ruleset === "fire" && u.name !== "Chiefs"]);
  }
}

async function upsertUnit(c, sid, { name, ruleset, shift, pool: poolName }) {
  if (!["fire", "comms"].includes(ruleset)) throw err(400, "Unit type must be Suppression or Communications.");
  if (!/^[A-D]$/.test(shift || "") || (ruleset === "fire" && shift === "D")) throw err(400, "Choose the unit's shift.");
  name = ruleset === "comms" ? `Comms ${shift} Crew` : String(name || "").trim().slice(0, 40);
  if (!name) throw err(400, "Give the unit a name (e.g. 613).");
  const ex = (await c.query("SELECT id FROM leave_units WHERE season_id = $1 AND ruleset = $2 AND shift = $3 AND name = $4", [sid, ruleset, shift, name])).rows[0];
  if (ex) { if (poolName !== undefined) await c.query("UPDATE leave_units SET pool = $2 WHERE id = $1", [ex.id, poolName]); return ex.id; }
  const id = crypto.randomUUID();
  const defPool = ruleset === "comms" ? "Communications" : name === "Chiefs" ? "Chiefs" : "Suppression";
  await c.query("INSERT INTO leave_units (id, season_id, name, ruleset, shift, pool) VALUES ($1, $2, $3, $4, $5, $6)", [id, sid, name, ruleset, shift, poolName ?? defPool]);
  return id;
}

// Import: Excel (the MASTER DEPT LEAVE workbook or any sheet with Employee / Shift / accrual columns) or CSV
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(v => { const t = v.trim(); return t !== "" && !isNaN(Number(t)) ? Number(t) : t || null; }));
}
const usDate = v => {
  if (isDay(v)) return v;
  const m = String(v || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = (rows[i] || []).map(v => String(v ?? ""));
    if (r.some(v => /employee|^name$/i.test(v)) && r.some(v => /^shift$/i.test(v.trim()))) return i;
  }
  return -1;
}
function columns(header) {
  const h = header.map(v => String(v ?? "").trim());
  const find = (re, last = false) => { let k = -1; h.forEach((v, i) => { if (re.test(v) && (last || k < 0)) k = i; }); return k; };
  return {
    position: find(/^(position|unit)$/i), employee: find(/^(employee|name|employee name)$/i), shift: find(/^shift$/i),
    hire: find(/^hire date$/i), adjusted: find(/adjusted|seniority/i),
    yos: (() => { const a = find(/actual yos/i, true); return a >= 0 ? a : find(/^yos$|years of service/i, true); })(),
    vacation: find(/ov accrual|vacation/i, true), holiday: find(/holiday/i, true), banked: find(/banked|comp/i, true),
    emp: find(/^emp\s*#|emp(loyee)?\s*(no\.?|number|#)$/i), rank: find(/^rank$|^title$/i),
  };
}
const SECTION = [[/suppression/i, "Suppression"], [/special/i, "Special Operations"], [/medical|ems/i, "EMS"]];
// "Barnes, Garian J." -> "Garian J. Barnes"
export const displayName = s => { const t = String(s || "").trim(); if (!t.includes(",")) return t; const [last, ...rest] = t.split(","); return `${rest.join(",").trim()} ${last.trim()}`.trim(); };
const normName = s => String(s || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z, ]/g, " ").replace(/\s+/g, " ").trim();
function splitName(s) {
  const n = normName(s);
  if (n.includes(",")) { const [last, rest] = n.split(","); return { last: last.trim().split(" ").pop(), first: (rest || "").trim().split(" ")[0] || "" }; }
  const parts = n.split(" "); return { first: parts[0] || "", last: parts[parts.length - 1] || "" };
}

export function parseImport(sheets, year, users) {
  const pick = sheets.map(s => ({ s, h: findHeader(s.rows) })).filter(x => x.h >= 0);
  if (!pick.length) throw err(400, "No sheet with an Employee and a Shift column was found.");
  return pick.map(({ s, h }) => {
    const col = columns(s.rows[h]);
    const out = [], skipped = [], seen = new Set();
    let section = "Suppression";
    for (let i = h + 1; i < s.rows.length; i++) {
      const r = s.rows[i] || [];
      const get = k => (col[k] >= 0 ? r[col[k]] : null);
      const name = get("employee");
      const pos = get("position");
      if (!name) {
        const label = String(pos ?? r.find(v => typeof v === "string") ?? "");
        const sec = SECTION.find(([re]) => re.test(label));
        if (sec) section = sec[1];
        continue;
      }
      const shiftRaw = String(get("shift") || "").trim().toUpperCase();
      if (seen.has(normName(name))) continue;
      seen.add(normName(name));
      let ruleset = null, shift = null;
      if (/^[ABC]$/.test(shiftRaw)) { ruleset = "fire"; shift = shiftRaw; }
      else if (/^COM/.test(shiftRaw)) ruleset = "comms";
      else { skipped.push({ name: String(name), shift: shiftRaw || "(none)" }); continue; }
      let unit = null, poolName = section;
      const p = String(pos ?? "").trim();
      if (ruleset === "fire") {
        if (/^SG-?(5|6|7|91)$/i.test(p)) { unit = "Chiefs"; poolName = "Chiefs"; }
        else if (/^SG-?\d+$/i.test(p)) unit = p.toUpperCase().replace(/^SG-?/, "SG-");
        else if (p) unit = String(p).replace(/\.0$/, "");
        else unit = "";
      }
      const sp = splitName(name);
      const cands = users.filter(u => { const x = splitName(u.name); return x.last === sp.last; });
      let match = cands.filter(u => splitName(u.name).first === sp.first);
      if (!match.length) match = cands.filter(u => splitName(u.name).first[0] === sp.first[0]);
      const user = match.length === 1 ? match[0] : null;
      if (ruleset === "comms" && user && /^comms:[A-D]$/.test(user.pattern || "")) shift = user.pattern.slice(-1);
      const adjusted = usDate(get("adjusted")) || usDate(get("hire"));
      let yos = get("yos");
      yos = typeof yos === "number" ? Math.floor(yos) : null;
      if (yos === null && adjusted) yos = Math.max(0, Math.floor((Date.parse(`${year}-01-01`) - Date.parse(adjusted)) / (365.25 * 864e5)));
      const hours = v => (typeof v === "number" ? v : null);
      const vac = hours(get("vacation")), hol = hours(get("holiday"));
      out.push({
        name: String(name).trim(), displayName: displayName(name), ruleset, shift, unit, pool: ruleset === "comms" ? "Communications" : poolName, position: p,
        empNo: get("emp") != null ? String(get("emp")) : "", hireDate: usDate(get("hire")), seniorityDate: adjusted, yos,
        vacation: vac ?? 0, holiday: hol ?? 0, banked: hours(get("banked")) ?? 0, rank: get("rank") ? String(get("rank")) : "",
        userId: user?.id || null, matchName: user?.name || null, choices: user ? [] : cands.slice(0, 5).map(u => ({ id: u.id, name: u.name })),
        problems: [vac === null ? `vacation "${get("vacation") ?? ""}"` : "", hol === null ? `holidays "${get("holiday") ?? ""}"` : "", !shift ? "crew" : "", ruleset === "fire" && !unit ? "unit" : ""].filter(Boolean),
      });
    }
    return { sheet: s.name, rows: out, skipped };
  });
}

// Which roster entry an imported row is: same Nexus account, else same Emp #, else same name
async function existingFor(c, sid, r) {
  if (isUuid(r.memberId)) { const x = (await c.query("SELECT * FROM leave_members WHERE id = $1 AND season_id = $2", [r.memberId, sid])).rows[0]; if (x) return x; }
  const all = (await c.query("SELECT m.*, u.full_name FROM leave_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.season_id = $1", [sid])).rows;
  if (isUuid(r.userId)) { const x = all.find(m => m.user_id === r.userId); if (x) return x; }
  if (r.empNo) { const x = all.filter(m => m.emp_no && m.emp_no === String(r.empNo)); if (x.length === 1) return x[0]; }
  const sp = splitName(r.name);
  const byName = all.filter(m => { const x = splitName(m.full_name || m.name); return x.last === sp.last && x.first === sp.first; });
  return byName.length === 1 ? byName[0] : null;
}

async function applyImport(user, sid, rows) {
  if (!Array.isArray(rows) || !rows.length) throw err(400, "Nothing to import.");
  const touched = new Set();
  let added = 0, updated = 0, locked = 0;
  await tx(async c => {
    for (const r of rows.slice(0, 2000)) {
      if (!["fire", "comms"].includes(r.ruleset) || !/^[A-D]$/.test(r.shift || "") || (r.ruleset === "fire" && r.shift === "D")) continue;
      if (r.ruleset === "fire" && !String(r.unit || "").trim()) continue;
      const userId = isUuid(r.userId) ? r.userId : null;
      const unitId = await upsertUnit(c, sid, { name: r.unit, ruleset: r.ruleset, shift: r.shift, pool: r.pool || undefined });
      touched.add(unitId);
      const ex = await existingFor(c, sid, r);
      // Someone else in this year already has that account: leave this row locked rather than fail
      const clash = userId && (await c.query("SELECT id FROM leave_members WHERE season_id = $1 AND user_id = $2 AND id <> $3", [sid, userId, ex?.id || crypto.randomUUID()])).rows[0];
      const uid = clash ? (ex?.user_id || null) : (userId || ex?.user_id || null);
      const vals = [String(r.rank || "").slice(0, 60), String(r.empNo || "").slice(0, 30), isDay(r.hireDate) ? r.hireDate : null,
        isDay(r.seniorityDate) ? r.seniorityDate : null, r.yos !== null && r.yos !== "" && Number.isFinite(Number(r.yos)) ? Math.floor(Number(r.yos)) : null,
        num(r.holiday), num(r.vacation), num(r.banked), displayName(r.displayName || r.name).slice(0, 120), r.ruleset === "comms" ? "Communications" : "Suppression"];
      if (ex) {
        if (ex.unit_id) touched.add(ex.unit_id);
        await c.query(
          `UPDATE leave_members SET user_id = $2, unit_id = $3, rank = COALESCE(NULLIF($4, ''), rank), emp_no = COALESCE(NULLIF($5, ''), emp_no),
             hire_date = COALESCE($6, hire_date), seniority_date = COALESCE($7, seniority_date), yos = COALESCE($8, yos),
             holiday_hours = $9, vacation_hours = $10, banked_hours = $11, name = $12, division = $13 WHERE id = $1`,
          [ex.id, uid, unitId, ...vals]);
        if (uid && !ex.user_id) await linkPicks(c, ex.id, uid);
        updated++;
      } else {
        await c.query(
          `INSERT INTO leave_members (id, season_id, user_id, unit_id, rank, emp_no, hire_date, seniority_date, yos, holiday_hours, vacation_hours, banked_hours, name, division)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`, [crypto.randomUUID(), sid, uid, unitId, ...vals]);
        added++;
      }
      if (!uid) locked++;
      // Fill in what Nexus didn't know yet
      if (uid && r.empNo) await c.query("UPDATE users SET employee_number = COALESCE(NULLIF(employee_number, ''), $2) WHERE id = $1", [uid, String(r.empNo)]);
      if (uid && isDay(r.hireDate)) await c.query("UPDATE users SET hire_date = COALESCE(hire_date, $2) WHERE id = $1", [uid, r.hireDate]);
    }
    for (const id of touched) {
      const picked = (await c.query("SELECT 1 FROM leave_picks WHERE unit_id = $1 LIMIT 1", [id])).rowCount;
      if (!picked) await reorderUnit(c, id);
    }
    await c.query("DELETE FROM leave_units u WHERE season_id = $1 AND NOT EXISTS (SELECT 1 FROM leave_members m WHERE m.unit_id = u.id)", [sid]);
    await audit(c, user, "Imported the leave pick roster", `${added} added, ${updated} updated, ${locked} without a ${brand().productName} account yet`);
  });
  return { ok: true, imported: added + updated, added, updated, locked };
}
// A roster entry got its Nexus account: its picks and filed records are now that person's
async function linkPicks(c, memberId, userId) {
  await c.query("UPDATE leave_picks SET user_id = $2 WHERE member_id = $1", [memberId, userId]);
  await c.query("UPDATE leave_pick_days SET user_id = $2 WHERE member_id = $1", [memberId, userId]);
  await c.query("UPDATE leave_records SET user_id = $2 WHERE member_id = $1", [memberId, userId]);
}

// Unlock: link locked roster entries to Nexus accounts made since (same Emp #, else the same first and last name).
// Runs when an account is approved and whenever Leave Picks loads. Returns the seasons that changed.
export async function autoLink() {
  const locked = (await pool.query(
    `SELECT m.id, m.season_id, m.name, m.emp_no, m.unit_id FROM leave_members m JOIN leave_seasons s ON s.id = m.season_id
      WHERE m.user_id IS NULL AND s.status <> 'closed'`)).rows;
  if (!locked.length) return [];
  const users = (await pool.query(
    `SELECT id, full_name, COALESCE(employee_number, '') AS emp FROM users WHERE active AND account_status = 'approved'`)).rows;
  const changed = new Set();
  for (const m of locked) {
    let match = m.emp_no ? users.filter(u => u.emp && u.emp === m.emp_no) : [];
    if (!match.length) { const sp = splitName(m.name); match = users.filter(u => { const x = splitName(u.full_name); return x.last === sp.last && x.first === sp.first; }); }
    if (match.length !== 1) continue;
    const taken = (await pool.query("SELECT 1 FROM leave_members WHERE season_id = $1 AND user_id = $2", [m.season_id, match[0].id])).rowCount;
    if (taken) continue;
    await tx(async c => {
      await c.query("UPDATE leave_members SET user_id = $2 WHERE id = $1 AND user_id IS NULL", [m.id, match[0].id]);
      await linkPicks(c, m.id, match[0].id);
      // So the person gets their own "your turn" message if they're up
      await c.query("UPDATE leave_units SET notified_user = NULL WHERE id = $1 AND notified_user = $2", [m.unit_id, m.id]);
    });
    changed.add(m.season_id);
  }
  for (const sid of changed) {
    const s = (await pool.query("SELECT status FROM leave_seasons WHERE id = $1", [sid])).rows[0];
    if (s?.status === "open") await afterChange(sid, null, null);
  }
  return [...changed];
}
// An account was approved (new, or someone on the Nexus roster set up their sign-in): link it and, if it's
// their turn, tell them now instead of their leader.
export async function accountReady(userId) {
  await autoLink();
  const rows = (await pool.query(
    `UPDATE leave_units l SET notified_user = NULL FROM leave_members m JOIN leave_seasons s ON s.id = m.season_id
      WHERE m.user_id = $1 AND l.id = m.unit_id AND l.notified_user = m.id AND s.status = 'open' RETURNING l.season_id`, [userId])).rows;
  for (const sid of new Set(rows.map(r => r.season_id))) await afterChange(sid, null, null);
}

// ---- Reports ------------------------------------------------------------------------------------
// Reports: by shift (ruleset + shift), by unit, by person (member), or everything; `limit` keeps shift officers to their shifts
function reportScope(st, q, limit) {
  return st.units
    .filter(u => (!q.ruleset || u.ruleset === q.ruleset) && (!q.shift || u.shift === q.shift) && (!q.unit || u.id === q.unit))
    .filter(u => !limit || (u.ruleset === "fire" && limit.includes(u.shift)))
    .map(u => (q.member ? { ...u, members: u.members.filter(m => m.id === q.member) } : u))
    .filter(u => u.members.length);
}
const usShort = d => { const [y, m, dd] = d.split("-"); return `${Number(m)}/${Number(dd)}/${y}`; };
function formLines(st, m) {
  const lines = [];
  for (const p of m.picks) for (const d of p.days) for (const part of (m.codes.get(d.day) || [])) {
    const s = st.standing.get(`${m.id}|${d.day}`);
    lines.push({ day: d.day, start: d.start, hours: part.hours, code: part.code === "OVER" ? "??" : part.code, bumped: !!s?.bumped, rank: s?.rank, round: p.round });
  }
  return lines.sort((a, b) => a.day.localeCompare(b.day));
}

// One "Annual Leave Request Form" sheet per person, laid out like the paper/Excel form
function formsWorkbook(st, units) {
  const sheets = [];
  for (const u of units) for (const m of u.members) {
    const rs = st.rules[u.ruleset];
    const lines = formLines(st, m);
    const shifts = h => Math.round((h / rs.shiftHours) * 100) / 100;
    const rows = [
      [{ v: "Name:", s: "cellBold" }, { v: m.name, s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "EMP#", s: "cellBold" }, { v: m.emp_no || "", s: "cell" }, { v: "", s: "cell" }],
      [{ v: "Annual Vacation:", s: "cellBold" }, { v: "", s: "cell" }, { v: shifts(num(m.vacation_hours)), s: "center" }, { v: "", s: "cell" }, { v: "Holidays:", s: "cellBold" }, { v: shifts(num(m.holiday_hours)), s: "center" }, { v: "P/A Day(s):", s: "cellBold" }, { v: "", s: "cell" }],
      [{ v: "Date Requested", s: "head" }, { v: "", s: "head" }, { v: "Start Time (Comm. Only)", s: "head" }, { v: "", s: "head" }, { v: "Type of Leave (See Below)", s: "head" }, { v: "", s: "head" }, { v: "Supervisors Approval (Initials)", s: "head" }, { v: "", s: "head" }],
    ];
    const merges = ["B1:E1", "G1:H1", "A2:B2", "C2:D2", "A3:B3", "C3:D3", "E3:F3", "G3:H3"];
    const n = Math.max(25, lines.length);
    for (let i = 0; i < n; i++) {
      const l = lines[i];
      const r = rows.length + 1;
      rows.push([
        l ? { v: l.day, date: true, s: "date" } : { v: "", s: "cell" }, { v: "", s: "cell" },
        { v: l && u.ruleset === "comms" ? Number(l.start) : "", s: "center" }, { v: "", s: "cell" },
        { v: l ? l.code + (l.hours !== rs.shiftHours ? ` (${l.hours} h)` : "") : "", s: l?.bumped ? "bumped" : "center" }, { v: "", s: l?.bumped ? "bumped" : "cell" },
        { v: l?.bumped ? `Flagged: #${l.rank} by YOS` : "", s: "cell" }, { v: "", s: "cell" },
      ]);
      merges.push(`A${r}:B${r}`, `C${r}:D${r}`, `E${r}:F${r}`, `G${r}:H${r}`);
    }
    const lr = rows.length + 1;
    rows.push([{ v: "Vacation-OV", s: "cellBold" }, { v: "", s: "cell" }, { v: "Holiday-OH", s: "cellBold" }, { v: "", s: "cell" }, { v: "Perf. Attend Day-PA", s: "cellBold" }, { v: "", s: "cell" }, { v: "Comptime-OC", s: "cellBold" }, { v: "", s: "cell" }]);
    merges.push(`A${lr}:B${lr}`, `C${lr}:D${lr}`, `E${lr}:F${lr}`, `G${lr}:H${lr}`);
    for (const label of ["Employee Signature:", "Asst. Chief Signature:", "Fire Chief Signature:"]) {
      const r = rows.length + 1;
      rows.push([{ v: label, s: "cellBold" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "Date:", s: "cellBold" }, { v: "", s: "cell" }, { v: "", s: "cell" }]);
      merges.push(`A${r}:B${r}`, `C${r}:E${r}`, `G${r}:H${r}`);
    }
    rows.push([], [{ v: `${unitLabel(u, st.rules)} · ${st.season.year} picks from ${brand().app}. Codes are charged in date order: holidays, then vacation, then banked/comp.`, s: "note" }]);
    sheets.push({ name: m.name, rows, merges, cols: [12, 10, 10, 8, 11, 9, 14, 10], fitWidth: true });
  }
  if (!sheets.length) sheets.push({ name: "No one", rows: [["Nobody in this selection."]] });
  return workbook({ sheets });
}

// The department leave spreadsheet: one row per person, one column per day (hours off), a count row per unit group
function masterWorkbook(st, units) {
  const year = st.season.year;
  const daysOfYear = []; for (let d = `${year}-01-01`; d <= `${year}-12-31`; d = addDays(d, 1)) daysOfYear.push(d);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const sheets = [];
  const groups = new Map();
  for (const u of units) { const k = `${u.ruleset}|${u.shift}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
  for (const [k, list] of groups) {
    const [ruleset, shift] = k.split("|");
    const fixed = ["Total Accrued", "Total Scheduled", "Unit", "Employee", "Shift", "YOS", "OV Accrual", "Holidays", "Banked/Comp"];
    const head1 = fixed.map(() => ({ v: "", s: "head" })), head2 = fixed.map(v => ({ v, s: "head" }));
    const merges = [];
    daysOfYear.forEach((d, i) => {
      const [, m, dd] = d.split("-").map(Number);
      head2.push({ v: dd, s: "head" });
      head1.push({ v: dd === 1 ? MONTHS[m - 1] : "", s: "navy" });
      if (dd === 1) { const end = daysOfYear.findIndex(x => x > d && x.endsWith("-01")) - 1; merges.push(`${col(fixed.length + i)}1:${col(fixed.length + (end < 0 ? daysOfYear.length - 1 : end))}1`); }
    });
    const rows = [head1, head2];
    // which days the shift works (shaded)
    const works = new Set(shiftDays(ruleset, shift, year, st.rules).map(s => s.day));
    for (const u of list) {
      rows.push([{ v: unitLabel(u, st.rules) + (u.pool ? ` (${u.pool})` : ""), s: "headLeft" }]);
      for (const m of u.members) {
        const off = new Map(); for (const p of m.picks) for (const d of p.days) off.set(d.day, d);
        const r = [
          { v: num(m.holiday_hours) + num(m.vacation_hours) + num(m.banked_hours), s: "center" }, { v: m.used, s: "center" },
          { v: u.name, s: "center" }, { v: m.name, s: "cell" }, { v: ruleset === "comms" ? "COM" : shift, s: "center" },
          { v: m.yos ?? "", s: "center" }, { v: num(m.vacation_hours), s: "center" }, { v: num(m.holiday_hours), s: "center" }, { v: num(m.banked_hours) || "", s: "center" },
        ];
        for (const d of daysOfYear) {
          const x = off.get(d);
          const s = st.standing.get(`${m.id}|${d}`);
          r.push(x ? { v: x.hours, s: s?.bumped ? "bumped" : "blue" } : { v: "", s: works.has(d) ? "amber" : "cell" });
        }
        rows.push(r);
      }
      const count = [{ v: "Number off per day", s: "countBold" }, ...Array(fixed.length - 1).fill({ v: "", s: "countBold" })];
      for (const d of daysOfYear) { const n = u.members.filter(m => m.picks.some(p => p.days.some(x => x.day === d))).length; count.push({ v: n || "", s: "countBold" }); }
      rows.push(count);
      merges.push(`A${rows.length}:${col(fixed.length - 1)}${rows.length}`);
    }
    // Shift total (all units in the cap pool) for Suppression
    const total = [{ v: `All ${ruleset === "comms" ? "Communications" : `${shift} Shift`}: number off per day`, s: "countBold" }, ...Array(fixed.length - 1).fill({ v: "", s: "countBold" })];
    for (const d of daysOfYear) { const n = list.reduce((s, u) => s + u.members.filter(m => m.picks.some(p => p.days.some(x => x.day === d))).length, 0); total.push({ v: n || "", s: "countBold" }); }
    rows.push([], total); merges.push(`A${rows.length}:${col(fixed.length - 1)}${rows.length}`);
    sheets.push({ name: ruleset === "comms" ? `Comms ${shift} Crew` : `${shift} Shift`, rows, merges, cols: [8, 8, 8, 24, 6, 5, 7, 7, 7, ...daysOfYear.map(() => 4)], freeze: [4, 2], landscape: true });
  }
  if (!sheets.length) sheets.push({ name: "No one", rows: [["Nobody in this selection."]] });
  return workbook({ sheets });
}
const col = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

// A flat list for entering leave in Aladtec
function aladtecCsv(st, units) {
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [["Employee", "Emp #", "Unit", "Shift", "Date", "Start time", "Hours", "Leave type", "Code", "Pick", "Flagged (over daily limit)"]];
  const label = { OH: "Holiday", OV: "Vacation", OC: "Banked vacation / comp time", "??": "MORE THAN AVAILABLE" };
  for (const u of units) for (const m of u.members) for (const l of formLines(st, m)) {
    out.push([m.name, m.emp_no, u.name, u.ruleset === "comms" ? `Comms ${u.shift}` : u.shift, usShort(l.day), l.start, l.hours, label[l.code] || l.code, l.code, l.round, l.bumped ? `Yes (#${l.rank} by YOS)` : ""]);
  }
  return "﻿" + out.map(r => r.map(q).join(",")).join("\r\n") + "\r\n";
}

// ---- Routes -----------------------------------------------------------------------------------
export async function myLeaveTurn(user) {
  const s = (await pool.query("SELECT id FROM leave_seasons WHERE status = 'open' ORDER BY year DESC LIMIT 1")).rows[0];
  if (!s) return null;
  const st = compute(await loadAll(pool, s.id));
  const me = st.byUser.get(user.id);
  const myTurn = me && me.unit?.turn?.memberId === me.id ? me.unit.turn.round : null;
  // Leaders: someone in the unit is up (and whether they still need it entered for them)
  const up = me?.leader && me.unit?.turn && me.unit.turn.memberId !== me.id ? st.mem.get(me.unit.turn.memberId) : null;
  const unitUp = up ? `${up.name}${up.locked ? " (no " + brand().productName + " account yet, enter it for them)" : ""}` : null;
  return { seasonId: s.id, year: st.season.year, myTurn, unitUp, inPick: !!me, done: !!(me?.done || me?.autoDone) };
}

// Personnel File: a person's filed leave picks. They see their own; Leave picks: View (for their division),
// administrators, and the shift's officers see others'.
async function recordsFor(user, target) {
  const id = isUuid(target) ? target : user.id;
  const rows = (await pool.query(
    `SELECT r.*, s.rules, COALESCE(d.name, 'Suppression') AS division FROM leave_records r JOIN leave_seasons s ON s.id = r.season_id
       LEFT JOIN users u ON u.id = r.user_id LEFT JOIN divisions d ON d.id = u.division_id
      WHERE r.user_id = $1 ORDER BY r.year DESC`, [id])).rows;
  const out = [];
  for (const r of rows) {
    const ok = id === user.id || user.role === "master" || (await hasAccess(pool, user, "leave", "view", r.division))
      || (r.ruleset === "fire" && officerShifts(rulesOf({ rules: r.rules }), user).includes(r.shift));
    if (!ok) continue;
    out.push({ id: r.id, seasonId: r.season_id, year: r.year, name: r.name, unit: r.unit, shift: r.shift, ruleset: r.ruleset, lines: r.lines, totals: r.totals,
      status: r.status, filedAt: r.filed_at, updatedAt: r.updated_at, revisions: r.revisions });
  }
  return { records: out };
}

export async function handleLeave(req, res, parts, user, send, jsonBody, url) {
  const a = parts[2];
  if (req.method === "GET" && !a) {
    await autoLink().catch(e => console.warn(`[Leave picks] link accounts: ${e.message}`));
    const acc = await accessOf(user);
    const seasons = (await pool.query(
      `SELECT s.id, s.year, s.status, s.rules, EXISTS (SELECT 1 FROM leave_members m WHERE m.season_id = s.id AND m.user_id = $1) AS mine
         FROM leave_seasons s ORDER BY s.year DESC`, [user.id])).rows;
    const visible = seasons.filter(s => s.mine || acc.view || acc.edit || acc.manage || officerShifts(rulesOf(s), user).length).map(({ rules, ...s }) => s);
    return send(res, 200, { seasons: visible, access: acc, turn: await myLeaveTurn(user) });
  }
  if (req.method === "GET" && a === "turn") return send(res, 200, (await myLeaveTurn(user)) || {});
  if (req.method === "GET" && a === "records") return send(res, 200, await recordsFor(user, url.searchParams.get("user")));
  if (req.method === "POST" && a === "seasons") {
    if (!(await hasAccess(pool, user, "leave", "manage"))) throw err(403, "Setting up leave picks needs the Leave picks: Manage permission.");
    const b = await jsonBody(req);
    const year = Number(b.year);
    if (!Number.isInteger(year) || year < 2020 || year > 2100) throw err(400, "Enter a year.");
    const id = crypto.randomUUID();
    // Start from last year's rules (blocked dates cleared)
    const prev = (await pool.query("SELECT rules FROM leave_seasons ORDER BY year DESC LIMIT 1")).rows[0]?.rules || {};
    const rules = JSON.parse(JSON.stringify({ fire: { ...DEFAULT_RULES.fire, ...(prev.fire || {}), blocked: [] }, comms: { ...DEFAULT_RULES.comms, ...(prev.comms || {}), blocked: [] } }));
    try { await pool.query("INSERT INTO leave_seasons (id, year, rules) VALUES ($1, $2, $3)", [id, year, rules]); }
    catch (e) { if (e.code === "23505") throw err(409, `There's already a ${year} pick.`); throw e; }
    return send(res, 200, { id });
  }
  if (!isUuid(a)) throw err(404, "Not found");
  const sid = a, b2 = parts[3];
  const acc = await accessOf(user);
  const mustManage = () => { if (!acc.manage) throw err(403, "That needs the Leave picks: Manage permission."); };

  if (req.method === "GET" && !b2) {
    const isMember = (await pool.query("SELECT 1 FROM leave_members WHERE season_id = $1 AND user_id = $2", [sid, user.id])).rowCount;
    if (!isMember && !acc.view && !acc.edit && !acc.manage && !officerShifts(rulesOf(await loadSeason(pool, sid)), user).length) throw err(403, "You're not in this pick.");
    return send(res, 200, await stateFor(user, sid));
  }
  if (req.method === "GET" && b2 === "report") {
    const st = compute(await loadAll(pool, sid));
    const officer = officerShifts(st.rules, user);
    if (!acc.view && !acc.manage && !officer.length) throw err(403, "Reports need the Leave picks: View permission.");
    const q = Object.fromEntries(url.searchParams);
    const units = reportScope(st, q, acc.view || acc.manage ? null : officer);
    const kind = parts[4];
    const who = q.member ? st.mem.get(q.member)?.name : null;
    const tag = `${st.season.year}${q.ruleset ? `-${q.ruleset === "comms" ? "Comms" : "Suppression"}` : ""}${q.shift ? `-${q.shift}` : ""}${who ? `-${who.replace(/[^A-Za-z0-9]+/g, "-")}` : ""}`;
    if (kind === "forms.xlsx" || kind === "master.xlsx") {
      const buf = kind === "forms.xlsx" ? formsWorkbook(st, units) : masterWorkbook(st, units);
      res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${kind === "forms.xlsx" ? "Annual-Leave-Forms" : "Leave-Spreadsheet"}-${tag}.xlsx"` });
      return res.end(buf);
    }
    if (kind === "aladtec.csv") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="Leave-for-Aladtec-${tag}.csv"` });
      return res.end(aladtecCsv(st, units));
    }
    throw err(404, "Not found");
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const body = await jsonBody(req);
  if (b2 === "check") return send(res, 200, await makePick(user, sid, body, { check: true }));
  if (b2 === "pick") return send(res, 200, await makePick(user, sid, body));
  if (b2 === "skip") return send(res, 200, await skipTurn(user, sid, body));
  if (b2 === "done") return send(res, 200, await setDone(user, sid, body));
  if (b2 === "undo") return send(res, 200, await undoPick(user, sid, body));

  // ---- manage
  mustManage();
  const season = await loadSeason(pool, sid);
  if (b2 === "settings") {
    const rules = rulesOf(season);
    for (const k of ["fire", "comms"]) {
      const r = body.rules?.[k];
      if (!r) continue;
      const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
      rules[k] = {
        ...rules[k],
        shiftHours: int(r.shiftHours, 1, 24, rules[k].shiftHours), firstPicks: int(r.firstPicks, 0, 20, rules[k].firstPicks),
        firstMax: int(r.firstMax, 1, 30, rules[k].firstMax), laterMax: int(r.laterMax, 1, 30, rules[k].laterMax),
        firstConsecutive: r.firstConsecutive !== undefined ? !!r.firstConsecutive : rules[k].firstConsecutive,
        laterConsecutive: r.laterConsecutive !== undefined ? !!r.laterConsecutive : rules[k].laterConsecutive,
        holidaysAll: r.holidaysAll !== undefined ? !!r.holidaysAll : rules[k].holidaysAll,
        note: r.note !== undefined ? String(r.note).slice(0, 2000) : rules[k].note,
        caps: r.caps && typeof r.caps === "object" ? Object.fromEntries(Object.entries(r.caps).filter(([p, v]) => p && Number(v) > 0).map(([p, v]) => [String(p).slice(0, 40), int(v, 1, 99, 6)])) : rules[k].caps,
        blocked: Array.isArray(r.blocked) ? r.blocked.filter(x => isDay(x.from)).slice(0, 60).map(x => ({ from: x.from, to: isDay(x.to) && x.to >= x.from ? x.to : x.from, label: String(x.label || "").slice(0, 80) })) : rules[k].blocked,
      };
    }
    if (body.rules?.fire?.officers && typeof body.rules.fire.officers === "object") {
      rules.fire.officers = Object.fromEntries(["A", "B", "C"].map(x => [x, [...new Set((body.rules.fire.officers[x] || []).filter(isUuid))].slice(0, 12)]));
    }
    let status = season.status;
    if (["setup", "open", "closed"].includes(body.status) && body.status !== season.status) status = body.status;
    await pool.query(`UPDATE leave_seasons SET rules = $2, status = $3,
        opened_by = CASE WHEN $3 = 'open' AND status <> 'open' THEN $4 ELSE opened_by END,
        opened_at = CASE WHEN $3 = 'open' AND status <> 'open' THEN now() ELSE opened_at END,
        closed_at = CASE WHEN $3 = 'closed' THEN now() ELSE closed_at END WHERE id = $1`, [sid, rules, status, user.id]);
    if (status !== season.status) {
      await tx(c => audit(c, user, status === "open" ? "Opened leave picks" : status === "closed" ? "Closed leave picks" : "Set leave picks back to setup", String(season.year)));
      if (status === "open") await afterChange(sid, null, user);
      else { const ids = (await pool.query("SELECT user_id FROM leave_members WHERE season_id = $1 AND user_id IS NOT NULL", [sid])).rows.map(r => r.user_id); publish(ids, "leave", { seasonId: sid }); }
    }
    return send(res, 200, { ok: true });
  }
  if (b2 === "import" && parts[4] === "preview") {
    const data = Buffer.from(String(body.data || ""), "base64");
    if (!data.length || data.length > 15 * 1024 * 1024) throw err(400, "Choose an Excel (.xlsx) or CSV file under 15 MB.");
    const sheets = /\.csv$/i.test(body.filename || "") ? [{ name: "CSV", rows: parseCsv(data.toString("utf8").replace(/^﻿/, "")) }] : readWorkbook(data);
    const users = (await pool.query("SELECT u.id, u.full_name AS name, u.work_pattern AS pattern FROM users u WHERE u.active AND u.account_status = 'approved'")).rows;
    const parsed = parseImport(sheets, season.year, users);
    // Already on this year's roster? (a newer roster updates those entries; people not in it are listed, not removed)
    const seen = new Set();
    for (const p of parsed) for (const r of p.rows) {
      const ex = await existingFor(pool, sid, r);
      r.memberId = ex?.id || null; r.status = ex ? "update" : "new";
      if (ex) { seen.add(ex.id); if (!r.userId && ex.user_id) { r.userId = ex.user_id; r.matchName = ex.full_name; } }
    }
    const missing = (await pool.query(
      `SELECT m.id, COALESCE(u.full_name, m.name) AS name, l.ruleset, l.shift, l.name AS unit, (m.user_id IS NULL) AS locked,
              EXISTS (SELECT 1 FROM leave_picks p WHERE p.member_id = m.id) AS picked
         FROM leave_members m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN leave_units l ON l.id = m.unit_id WHERE m.season_id = $1`, [sid])).rows.filter(m => !seen.has(m.id));
    return send(res, 200, { sheets: parsed.map(p => ({ sheet: p.sheet, count: p.rows.length, matched: p.rows.filter(r => r.userId).length })), parsed, missing,
      people: users.map(u => ({ id: u.id, name: u.name })).sort((x, y) => x.name.localeCompare(y.name)) });
  }
  if (b2 === "import" && parts[4] === "apply") {
    const r = await applyImport(user, sid, body.rows);
    if (season.status === "open") await afterChange(sid, null, user);
    return send(res, 200, r);
  }
  if (b2 === "member") {
    // { memberId? , userId? (Nexus account, or null = no account yet), name (needed without an account), unit, ... }
    const cur = isUuid(body.memberId) ? (await pool.query("SELECT * FROM leave_members WHERE id = $1 AND season_id = $2", [body.memberId, sid])).rows[0] : null;
    if (isUuid(body.memberId) && !cur) throw err(404, "That person isn't in this year's pick.");
    if (body.remove) {
      if (!cur) throw err(400, "Choose a person.");
      const picked = (await pool.query("SELECT 1 FROM leave_picks WHERE member_id = $1 LIMIT 1", [cur.id])).rowCount;
      if (picked) throw err(400, "They've already picked. Take back their picks first.");
      await tx(async c => {
        await c.query("DELETE FROM leave_members WHERE id = $1", [cur.id]);
        await c.query("DELETE FROM leave_units u WHERE season_id = $1 AND NOT EXISTS (SELECT 1 FROM leave_members m WHERE m.unit_id = u.id)", [sid]);
        await audit(c, user, "Removed someone from the leave pick roster", cur.name);
      });
      if (season.status === "open") await afterChange(sid, null, user);
      return send(res, 200, { ok: true });
    }
    const f = body;
    const userId = "userId" in f ? (isUuid(f.userId) ? f.userId : null) : (cur?.user_id || null);
    const account = userId ? (await pool.query("SELECT u.full_name, d.name AS division FROM users u LEFT JOIN divisions d ON d.id = u.division_id WHERE u.id = $1", [userId])).rows[0] : null;
    if (userId && !account) throw err(400, "That " + brand().productName + " account wasn't found.");
    const name = String(f.name || "").trim() || account?.full_name || cur?.name || "";
    if (!name) throw err(400, "Enter their name, or choose their " + brand().productName + " account.");
    if (userId) {
      const other = (await pool.query("SELECT name FROM leave_members WHERE season_id = $1 AND user_id = $2 AND id <> $3", [sid, userId, cur?.id || crypto.randomUUID()])).rows[0];
      if (other) throw err(409, `That account is already on the roster (${other.name}).`);
    }
    let id = cur?.id;
    await tx(async c => {
      const unitId = f.unit ? await upsertUnit(c, sid, f.unit) : null;
      if (!cur && !unitId) throw err(400, "Choose their shift and unit.");
      const division = unitId ? ((await c.query("SELECT ruleset FROM leave_units WHERE id = $1", [unitId])).rows[0].ruleset === "comms" ? "Communications" : "Suppression") : cur.division;
      const vals = [userId, unitId, String(f.rank || "").slice(0, 60), String(f.empNo || "").slice(0, 30), isDay(f.hireDate) ? f.hireDate : null,
        isDay(f.seniorityDate) ? f.seniorityDate : null, f.yos === "" || f.yos === null || f.yos === undefined ? null : Math.floor(Number(f.yos)),
        num(f.holiday), num(f.vacation), num(f.banked), String(f.note || "").slice(0, 500), name.slice(0, 120), division];
      if (cur) {
        await c.query(`UPDATE leave_members SET user_id = $2, unit_id = COALESCE($3, unit_id), rank = $4, emp_no = $5, hire_date = $6, seniority_date = $7, yos = $8,
            holiday_hours = $9, vacation_hours = $10, banked_hours = $11, note = $12, name = $13, division = $14 WHERE id = $1`, [cur.id, ...vals]);
        if (userId !== cur.user_id) {
          await linkPicks(c, cur.id, userId);
          await c.query("UPDATE leave_units SET notified_user = NULL WHERE id = $1 AND notified_user = $2", [cur.unit_id, cur.id]);
          await audit(c, user, userId ? "Linked a leave pick roster entry to a " + brand().productName + " account" : "Unlinked a leave pick roster entry from its " + brand().productName + " account", `${name}${account ? ` → ${account.full_name}` : ""}`);
        }
      } else {
        id = crypto.randomUUID();
        await c.query(`INSERT INTO leave_members (id, season_id, user_id, unit_id, pick_order, leader, rank, emp_no, hire_date, seniority_date, yos, holiday_hours, vacation_hours, banked_hours, note, name, division)
            VALUES ($1, $2, $3, $4, 999, false, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`, [id, sid, ...vals]);
        await audit(c, user, "Added someone to the leave pick roster", `${name}${userId ? "" : " (no " + brand().productName + " account yet)"}`);
      }
      if (unitId && cur?.unit_id !== unitId) {
        const n = (await c.query("SELECT coalesce(max(pick_order), 0) + 1 AS n FROM leave_members WHERE unit_id = $1 AND id <> $2", [unitId, id])).rows[0].n;
        await c.query("UPDATE leave_members SET pick_order = $2 WHERE id = $1", [id, n]);
        await c.query("UPDATE leave_picks SET unit_id = $2 WHERE member_id = $1", [id, unitId]);
        await c.query("UPDATE leave_pick_days SET unit_id = $2 WHERE member_id = $1", [id, unitId]);
      }
      await c.query("DELETE FROM leave_units u WHERE season_id = $1 AND NOT EXISTS (SELECT 1 FROM leave_members m WHERE m.unit_id = u.id)", [sid]);
    });
    if (season.status === "open") await afterChange(sid, null, user);
    return send(res, 200, { ok: true, id });
  }
  if (b2 === "order") {
    // { unitId, memberIds: [in turn order], leaders: [memberIds], pool }
    if (!isUuid(body.unitId)) throw err(400, "Choose a unit.");
    const ids = (Array.isArray(body.memberIds) ? body.memberIds : []).filter(isUuid);
    await tx(async c => {
      for (let i = 0; i < ids.length; i++) {
        await c.query("UPDATE leave_members SET pick_order = $4, leader = $5 WHERE season_id = $1 AND id = $2 AND unit_id = $3",
          [sid, ids[i], body.unitId, i + 1, (body.leaders || []).includes(ids[i])]);
      }
      if (typeof body.pool === "string") await c.query("UPDATE leave_units SET pool = $2 WHERE id = $1", [body.unitId, body.pool.slice(0, 40)]);
      await audit(c, user, "Changed a unit's pick order", body.unitId);
    });
    if (season.status === "open") await afterChange(sid, [body.unitId], user);
    return send(res, 200, { ok: true });
  }
  if (b2 === "remove") {
    if (season.status !== "setup") throw err(400, "Only a pick year that hasn't opened can be deleted.");
    await pool.query("DELETE FROM leave_seasons WHERE id = $1", [sid]);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}
