// Evaluations & Simulations: evaluation programs at every rank, working test periods, evaluator results,
// written submissions, periodic reviews, and voice simulations graded with the program's rubric.
//
//   GET  /api/evals                                 overview: access, programs, my enrolments/results, people I evaluate
//   GET  /api/evals/people                          roster (evaluators/managers)
//   GET  /api/evals/programs/:id                    full program (modules with guides)
//   POST /api/evals/programs                        {id?, name, rank, kind, description, data, active, evaluators}      (manage)
//   POST /api/evals/candidates                      {id?, programId, userId, startDate, evaluators, status}               (manage)
//   GET  /api/evals/candidates/:id                  candidate, program, results, submissions, reviews, standing
//   POST /api/evals/candidates/:id/outcome          {outcome, note, signature}                                              (manage)
//   POST /api/evals/candidates/:id/submissions      {moduleKey, title, body, fileName, data}   candidate or evaluator
//   GET  /api/evals/submissions/:id/file  · POST /api/evals/submissions/:id/remove
//   POST /api/evals/candidates/:id/reviews          {month, summary, achievements, deficiencies, goals, improvementPlan, sign, signature}
//   POST /api/evals/reviews/:id/ack                 {signature, comment}   the candidate
//   GET  /api/evals/results?user=&program=          results I may see
//   GET  /api/evals/results/:id
//   POST /api/evals/results                         {id?, programId, userId, candidateId?, kind, modules, scores, comments, observations,
//                                                    feedback, flags, date, final, signature}
//   POST /api/evals/results/:id/reopen (manage) · /remove (draft) · /ack {comment} (the person evaluated)
//   POST /api/evals/ai/draft                        {programId, modules, observations, userId?, candidateId?}  rubric -> draft scores
//   GET  /api/evals/scenarios · POST /api/evals/scenarios {id?, kind, title, summary, programKey, moduleKey, data, active} (manage)
//   GET  /api/evals/transcriber                     is Whisper set up on the server?
//   POST /api/evals/sessions                        {scenarioId, mode: practice|formal|retest, candidateId?}
//   GET  /api/evals/sessions?scope=mine|all · GET /api/evals/sessions/:id
//   POST /api/evals/sessions/:id/turn               {clock, text? | audio (base64 16-bit mono WAV)}
//   POST /api/evals/sessions/:id/tick               {clock}   timeline injects that are due
//   POST /api/evals/sessions/:id/end                {clock}   ends the run and grades it
//   POST /api/evals/sessions/:id/result             makes a draft evaluation from a formal/retest run (evaluator)
//   POST /api/evals/sessions/:id/place              {unit, x, y, angle, clock}  position an arrived unit on the scene picture
//   GET  /api/evals/images/:id                      a scene picture (any signed-in user)
//   POST /api/evals/images                          {name, mime, data (base64), width, height}  upload a scene picture (manage)
//   POST /api/evals/aerial                          {address | lat+lon, feet}  USGS aerial imagery for an address (manage)
//
// Access section "evals": view = everyone's records (read-only); edit = evaluator for every program (score, sign, run
// formal simulations, quarterly reviews); manage = programs, scenarios, enrolments, final outcomes. People named as
// evaluators on a program or a candidate can evaluate those without section access. Everyone sees their own record and
// can practice; practice runs are private to the person who ran them and never count.
import crypto from "node:crypto";
import { brand, brandText, brandDeep } from "./brand.js";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { PROGRAM_SEEDS } from "./evalSeeds.js";
import { MORE_PROGRAM_SEEDS } from "./evalSeeds2.js";
import { AC_PROGRAM_SEEDS } from "./evalSeedsAC.js";
import { SCENARIO_SEEDS, RUBRICS } from "./simSeeds.js";
import { departmentContent, DEMO_PROGRAM_SEEDS } from "./demoSeeds.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ["practice", "formal", "retest"];
const day = d => (d instanceof Date ? d.toISOString() : String(d || "")).slice(0, 10);
const ids = v => [...new Set((Array.isArray(v) ? v : []).filter(isUuid))];
function signature(v) {
  if (typeof v !== "string" || !v) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 280000) throw err(400, "That signature picture isn't valid. Clear it and sign again.");
  return v;
}

// ---- Seeds ---------------------------------------------------------------------------------------
export async function seedEvals() {
  const dept = departmentContent();
  for (const p0 of dept ? [...MORE_PROGRAM_SEEDS, ...PROGRAM_SEEDS, ...AC_PROGRAM_SEEDS] : DEMO_PROGRAM_SEEDS) {
    const p = brandDeep(p0);
    await pool.query(`INSERT INTO eval_programs (id, key, name, rank, kind, description, data, sort, updated_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (key) DO NOTHING`,
      [crypto.randomUUID(), p.key, p.name, p.rank, p.kind, p.description, JSON.stringify(p.data), p.sort, `${brand().short} documents`]);
  }
  for (const s0 of SCENARIO_SEEDS) {
    // Scenarios linked to a program came from St. George's evaluation documents: department installs only
    if (!dept && s0.program_key) continue;
    const s = brandDeep(s0);
    await pool.query(`INSERT INTO sim_scenarios (id, key, kind, title, summary, program_key, module_key, data, sort, updated_by_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (key) DO NOTHING`,
      [crypto.randomUUID(), s.key, s.kind, s.title, s.summary, s.program_key || "", s.module_key || "", JSON.stringify(s.data), s.sort, brand().app]);
  }
}

// ---- Scoring ---------------------------------------------------------------------------------------
const scaleOf = p => {
  const sc = { min: Number(p.data?.scale?.min ?? 0), max: Number(p.data?.scale?.max ?? 5) };
  const lb = p.data?.scale?.labels;
  return Array.isArray(lb) && lb.length === sc.max - sc.min + 1 ? { ...sc, labels: lb.map(String) } : sc;
};
// How to score, in words, for the AI prompts
const scaleWords = (scale, what) => scale.labels
  ? `Score each ${what} ${scale.labels.map((l, i) => `${scale.min + i} = ${l}`).join(" or ")} (${scale.max} only when the critical criterion was clearly met, ${scale.min} when it was not met)`
  : `Score each ${what} from ${scale.min} to ${scale.max} (${scale.max} = exceptional, 3 = meets expectations, 1 = ineffective or unacceptable${scale.min === 0 ? ", 0 = not demonstrated" : ""})`;
// % for one module from its element scores: sum(score x mult) / sum(max x mult) over the scored elements
export function modulePct(mod, scores, scale) {
  let got = 0, max = 0, n = 0;
  (mod.elements || []).forEach((e, i) => {
    const s = scores?.[i];
    if (s === null || s === undefined || s === "" || !Number.isFinite(Number(s))) return;
    const m = Number(e.mult) || 1;
    got += Number(s) * m; max += scale.max * m; n++;
  });
  return { pct: max ? Math.round((got / max) * 1000) / 10 : null, points: got, maxPoints: (mod.elements || []).reduce((s, e) => s + scale.max * (Number(e.mult) || 1), 0),
    complete: n === (mod.elements || []).length && n > 0 };
}
const weightOf = m => Number(m.weight) > 0 ? Number(m.weight) : 1;
export function resultPct(program, r) {
  const scale = scaleOf(program);
  let w = 0, s = 0;
  const per = {};
  for (const key of r.modules || []) {
    const mod = (program.data.modules || []).find(m => m.key === key);
    if (!mod) continue;
    const x = modulePct(mod, r.scores?.[key], scale);
    per[key] = x;
    if (x.pct === null) continue;
    w += weightOf(mod); s += weightOf(mod) * x.pct;
  }
  return { pct: w ? Math.round((s / w) * 10) / 10 : null, modules: per };
}
// Where a candidate stands: each module from final formal results (averaged); a final retest replaces them (latest wins)
export function standing(program, results, startDate) {
  const finals = results.filter(r => r.status === "final" && r.kind !== "practice");
  const mods = [];
  let w = 0, s = 0, all = true;
  const now = new Date();
  const monthIn = startDate ? Math.max(0, (now.getFullYear() - startDate.getFullYear()) * 12 + now.getMonth() - startDate.getMonth()) : 0;
  for (const m of program.data.modules || []) {
    const on = finals.filter(r => (r.modules || []).includes(m.key));
    const retests = on.filter(r => r.kind === "retest").sort((a, b) => String(b.eval_date).localeCompare(String(a.eval_date)) || new Date(b.signed_at) - new Date(a.signed_at));
    const scale = scaleOf(program);
    let pct = null, source = "";
    const latest = program.data.standing === "latest"
      ? on.slice().sort((a, b) => String(b.eval_date).localeCompare(String(a.eval_date)) || new Date(b.signed_at) - new Date(a.signed_at))[0] : null;
    if (latest) { pct = modulePct(m, latest.scores?.[m.key], scale).pct; source = `latest ${latest.kind === "retest" ? "retest" : "formal"} (${String(latest.eval_date).slice(0, 10)})`; }
    else if (retests.length) { pct = modulePct(m, retests[0].scores?.[m.key], scale).pct; source = "retest"; }
    else if (on.length) {
      const ps = on.map(r => modulePct(m, r.scores?.[m.key], scale).pct).filter(x => x !== null);
      if (ps.length) { pct = Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10; source = ps.length > 1 ? `average of ${ps.length}` : "formal"; }
    }
    const dueBy = m.quarter ? m.quarter * 3 : null;
    mods.push({ key: m.key, title: m.title, weight: m.weight ?? null, quarter: m.quarter ?? null, pct, source, count: on.length,
      overdue: pct === null && dueBy !== null && monthIn >= dueBy, below: pct !== null && pct < Number(program.data.passModule || 0) });
    if (pct === null) { all = false; continue; }
    w += weightOf(m); s += weightOf(m) * pct;
  }
  const composite = w ? Math.round((s / w) * 10) / 10 : null;
  const passComposite = Number(program.data.passComposite ?? 80), passModule = Number(program.data.passModule ?? 0);
  return { modules: mods, composite, complete: all, monthIn,
    meetsComposite: composite !== null && composite >= passComposite,
    belowMin: mods.filter(m => m.below).map(m => m.key),
    passing: all && composite !== null && composite >= passComposite && !mods.some(m => m.pct !== null && m.pct < passModule),
    passComposite, passModule };
}

// ---- Access ----------------------------------------------------------------------------------------
async function access(user) {
  if (user.role === "master") return { view: true, edit: true, manage: true };
  return { view: await hasAccess(pool, user, "evals", "view"), edit: await hasAccess(pool, user, "evals", "edit"), manage: await hasAccess(pool, user, "evals", "manage") };
}
const arr = v => Array.isArray(v) ? v : [];
const evaluatesProgram = (user, acc, p) => acc.edit || arr(p?.evaluators).includes(user.id);
const evaluatesCandidate = (user, acc, p, c) => evaluatesProgram(user, acc, p) || arr(c?.evaluators).includes(user.id);
async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query("INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Evaluations', $4, $5)",
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail).slice(0, 1000)]);
}
async function notify(user, users, subject, body) {
  const to = ids(users).filter(id => id !== user.id);
  if (!to.length) return;
  try { const { send } = await import("./messages.js"); await send(user, { users: to, subject, body }); }
  catch (e) { console.warn(`[Evaluations] notice not sent: ${e.message}`); }
}
const getProgram = async (id, c = pool) => isUuid(id) ? (await c.query("SELECT * FROM eval_programs WHERE id = $1", [id])).rows[0] : null;
const getCandidate = async (id, c = pool) => isUuid(id) ? (await c.query("SELECT * FROM eval_candidates WHERE id = $1", [id])).rows[0] : null;
const userName = async id => (await pool.query("SELECT full_name FROM users WHERE id = $1", [id])).rows[0]?.full_name || "";

const progSummary = p => ({ id: p.id, key: p.key, name: p.name, rank: p.rank, kind: p.kind, description: p.description, active: p.active, sort: p.sort,
  evaluators: arr(p.evaluators), scale: scaleOf(p), passComposite: p.data?.passComposite ?? 80, passModule: p.data?.passModule ?? 0,
  modules: (p.data?.modules || []).map(m => ({ key: m.key, title: m.title, weight: m.weight ?? null, quarter: m.quarter ?? null, competency: m.competency || "", sim: !!m.sim, elements: m.elements.length })) });
const candJson = (c, names = {}) => ({ id: c.id, programId: c.program_id, userId: c.user_id, name: names[c.user_id] || "", startDate: day(c.start_date), endDate: day(c.end_date),
  status: c.status, evaluators: arr(c.evaluators), outcome: c.outcome, outcomeNote: c.outcome_note, outcomeBy: c.outcome_by_name, outcomeAt: c.outcome_at,
  outcomeSigned: !!c.outcome_signature, outcomeSignature: c.outcome_signature || null, createdBy: c.created_by_name });
const resJson = (r, program, names = {}) => {
  const calc = program ? resultPct(program, r) : { pct: null, modules: {} };
  return { id: r.id, programId: r.program_id, userId: r.user_id, name: names[r.user_id] || "", candidateId: r.candidate_id, kind: r.kind, modules: arr(r.modules),
    scores: r.scores || {}, comments: r.comments || {}, observations: r.observations, feedback: r.feedback, ai: r.ai, flags: arr(r.flags), date: day(r.eval_date),
    status: r.status, evaluatorId: r.evaluator_id, evaluator: r.evaluator_name, signature: r.signature || null, signedAt: r.signed_at, ackAt: r.ack_at,
    ackComment: r.ack_comment, sessionId: r.session_id, pct: calc.pct, modulePct: calc.modules, createdAt: r.created_at, updatedAt: r.updated_at,
    passFail: program ? passFailTally(program, r) : null };
};
// For pass/fail programs: how many criteria failed / weren't scored on this result (null for points programs)
function passFailTally(program, r) {
  const sc = scaleOf(program);
  if (!sc.labels) return null;
  let failed = 0, missing = 0, total = 0;
  for (const k of arr(r.modules)) {
    const m = (program.data?.modules || []).find(x => x.key === k); if (!m) continue;
    (m.elements || []).forEach((e, i) => { total++; const v = r.scores?.[k]?.[i]; if (v === null || v === undefined || v === "") missing++; else if (Number(v) < sc.max) failed++; });
  }
  return { failed, missing, total };
}
const reviewJson = r => ({ id: r.id, candidateId: r.candidate_id, month: r.month, summary: r.summary, achievements: r.achievements, deficiencies: r.deficiencies,
  goals: r.goals, improvementPlan: r.improvement_plan, status: r.status, evaluator: r.evaluator_name, evaluatorId: r.evaluator_id,
  evaluatorSignature: r.evaluator_signature || null, signedAt: r.signed_at, ackSignature: r.ack_signature || null, ackComment: r.ack_comment, ackAt: r.ack_at, updatedAt: r.updated_at });
async function names() {
  const out = {};
  for (const r of (await pool.query("SELECT id, full_name FROM users")).rows) out[r.id] = r.full_name;
  return out;
}

// ---- Cleaning program / scenario data from the editor ------------------------------------------------
function cleanProgramData(d, old = {}) {
  const x = d && typeof d === "object" ? d : {};
  const num = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
  const scale = { min: num(x.scale?.min, 0, 0, 1), max: num(x.scale?.max, 5, 1, 10) };
  if (scale.max <= scale.min) scale.max = scale.min + 1;
  const lb = arr(x.scale?.labels).map(l => clean(l, 20)).filter(Boolean);
  if (lb.length && lb.length === scale.max - scale.min + 1) scale.labels = lb;
  const seen = new Set();
  const modules = arr(x.modules).slice(0, 40).map((m, i) => {
    let key = clean(m.key, 12) || String.fromCharCode(65 + i);
    while (seen.has(key)) key += "'";
    seen.add(key);
    const elements = arr(m.elements).slice(0, 30).map(e => ({ label: clean(e.label, 300), mult: num(e.mult, 1, 0.1, 10) })).filter(e => e.label);
    return { key, title: clean(m.title, 200) || `Module ${key}`, weight: m.weight === null || m.weight === "" || m.weight === undefined ? null : num(m.weight, 0, 0, 100),
      quarter: [1, 2, 3, 4].includes(Number(m.quarter)) ? Number(m.quarter) : null, competency: clean(m.competency, 120), sim: m.sim === true,
      elements: elements.length ? elements : [{ label: "Overall", mult: 1 }], guide: clean(m.guide, 60000), ...(m.note ? { note: clean(m.note, 500) } : {}) };
  });
  if (!modules.length) throw err(400, "A program needs at least one module.");
  return { ...old, scale, passComposite: num(x.passComposite, 80, 0, 100), passModule: num(x.passModule, 0, 0, 100), months: num(x.months, 12, 1, 36),
    reviews: arr(x.reviews).map(Number).filter(n => n >= 1 && n <= 36).slice(0, 12),
    outcomes: arr(x.outcomes).map(o => clean(o, 120)).filter(Boolean).slice(0, 6), signatures: arr(x.signatures).map(o => clean(o, 120)).filter(Boolean).slice(0, 8),
    evaluators: clean(x.evaluators ?? old.evaluators, 500), overview: clean(x.overview ?? old.overview, 60000),
    standing: x.standing === "latest" ? "latest" : "average", bands: x.bands ?? old.bands, points: x.points ?? old.points, requirements: x.requirements ?? old.requirements, modules };
}
function cleanScenarioData(kind, d) {
  const x = d && typeof d === "object" ? d : {};
  const minutes = Math.min(60, Math.max(2, Number(x.minutes) || 10));
  const rubric = arr(x.rubric).map(e => ({ label: clean(e.label, 300), mult: Math.min(10, Math.max(0.1, Number(e.mult) || 1)) })).filter(e => e.label).slice(0, 20);
  if (kind === "conversation") {
    const p = x.persona || {};
    return { minutes, situation: clean(x.situation, 4000), goal: clean(x.goal, 2000), rubric,
      persona: { name: clean(p.name, 80) || "Member", role: clean(p.role, 160), opening: clean(p.opening, 1000), background: clean(p.background, 4000), mood: clean(p.mood, 40) } };
  }
  return { minutes, scene: cleanScene(x.scene), you: clean(x.you, 40) || "Engine", dispatch: clean(x.dispatch, 2000), arrival: clean(x.arrival, 4000), setting: clean(x.setting, 6000), rubric,
    units: arr(x.units).slice(0, 30).map(u => ({ name: clean(u.name, 40), eta: Math.max(0, Math.min(3600, Number(u.eta) || 0)) })).filter(u => u.name),
    injects: arr(x.injects).slice(0, 40).map(j => ({ t: Math.max(0, Math.min(3600, Number(j.t) || 0)), from: clean(j.from, 60) || "Scene", text: clean(j.text, 1000),
      cue: j.cue === true, expect: clean(j.expect, 1000) })).filter(j => j.text).sort((a, b) => a.t - b.t) };
}
// ---- Strategies & Tactics: the scene picture and apparatus positions ---------------------------------------
// Coordinates are pixels of the picture (x right, y down; north up). ftPerPx sets real distances.
function cleanScene(sc) {
  if (!sc || !isUuid(sc.imageId)) return null;
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; };
  const W = n(sc.width, 1, 20000) || 1000, Hh = n(sc.height, 1, 20000) || 1000;
  const pt = p => ({ x: n(p?.x, 0, W) ?? 0, y: n(p?.y, 0, Hh) ?? 0 });
  return { imageId: sc.imageId, width: W, height: Hh, ftPerPx: n(sc.ftPerPx, 0.01, 50), address: clean(sc.address, 200), attribution: clean(sc.attribution, 200),
    wind: { from: n(sc.wind?.from, 0, 359) ?? 90, mph: n(sc.wind?.mph, 0, 80) ?? 0 },
    hydrants: arr(sc.hydrants).slice(0, 40).map((h, i) => ({ ...pt(h), label: clean(h.label, 30) || `H${i + 1}` })),
    building: arr(sc.building).slice(0, 60).map(pt),
    fire: arr(sc.fire).slice(0, 20).map(f => ({ ...pt(f), t: n(f.t, 0, 3600) ?? 0, r: n(f.r, 2, 2000) ?? 20 })),
    hazards: arr(sc.hazards).slice(0, 30).map(h => ({ ...pt(h), r: n(h.r, 1, 5000) ?? 30, kind: ["power", "collapse", "other"].includes(h.kind) ? h.kind : "other", label: clean(h.label, 60) })),
    blocked: arr(sc.blocked).slice(0, 30).map(b => ({ x: n(b.x, 0, W) ?? 0, y: n(b.y, 0, Hh) ?? 0, w: n(b.w, 1, W) ?? 10, h: n(b.h, 1, Hh) ?? 10, label: clean(b.label, 60) })) };
}
export function unitKind(name) {
  const s = String(name || "").trim();
  if (/^(engine|eg|e|pumper)[ -]?\d/i.test(s)) return "engine";
  if (/^(ladder|ar|truck|t|tower|quint|aerial)[ -]?\d/i.test(s)) return "ladder";
  if (/^(squad|sq|rescue|r)[ -]?\d/i.test(s)) return "squad";
  if (/^(medic|md|m|ambulance|ems)[ -]?\d/i.test(s)) return "medic";
  if (/^(tanker|tk|tender)[ -]?\d/i.test(s)) return "tanker";
  if (/^(sg|bc|battalion|chief|car|command)/i.test(s)) return "command";
  return "unit";
}
// Feet: length x width, plus reach (aerial) and preconnect length (engine)
export const APPARATUS = { engine: { l: 34, w: 9, hose: 200 }, ladder: { l: 45, w: 9, reach: 100 }, squad: { l: 32, w: 9 }, medic: { l: 24, w: 8 },
  tanker: { l: 34, w: 9 }, command: { l: 18, w: 7 }, unit: { l: 28, w: 8 } };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function inPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
// What a position means: refused (blocked / inside the building) or notes the simulation and the grader use
export function placementEffects(scene, unit, p) {
  const kind = unitKind(unit), spec = APPARATUS[kind], fpp = scene?.ftPerPx || null;
  const ft = px => fpp ? Math.round(px * fpp) : null;
  for (const b of scene?.blocked || []) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return { ok: false, reason: `${unit} can't get there: ${b.label || "no access (blocked)"}.` };
  }
  const bld = scene?.building || [];
  if (bld.length >= 3 && inPoly(p, bld)) return { ok: false, reason: "That's inside the building." };
  const notes = [];
  let toBuilding = null;
  if (bld.length >= 3) toBuilding = Math.min(...bld.map((a, i) => segDist(p, a, bld[(i + 1) % bld.length])));
  else if ((scene?.fire || []).length) toBuilding = Math.min(...scene.fire.map(f => dist(p, f)));
  const bFt = toBuilding === null ? null : ft(toBuilding);
  if (bFt !== null) notes.push(`${bFt} ft from the fire building`);
  if (kind === "ladder" && bFt !== null) notes.push(bFt <= spec.reach ? `aerial (about ${spec.reach} ft) reaches the building` : `the building is OUT of aerial reach (about ${spec.reach} ft)`);
  let hFt = null;
  if ((scene?.hydrants || []).length && fpp) {
    const near = scene.hydrants.map(h => ({ h, d: dist(p, h) })).sort((a, b) => a.d - b.d)[0];
    hFt = ft(near.d);
    if (kind === "engine" || kind === "tanker") notes.push(`nearest hydrant ${near.h.label} is ${hFt} ft away${hFt <= 20 ? " (on the hydrant)" : ""}`);
  }
  if (kind === "engine" && bFt !== null) notes.push(bFt + 20 <= spec.hose ? "preconnects (200 ft) reach the building" : `preconnects (200 ft) WON'T reach the building`);
  for (const h of scene?.hazards || []) {
    if (dist(p, h) <= h.r) notes.push(h.kind === "collapse" ? `INSIDE the collapse zone${h.label ? ` (${h.label})` : ""}` : h.kind === "power" ? `under / near power lines${h.label ? ` (${h.label})` : ""}` : `in a hazard area: ${h.label || "hazard"}`);
  }
  if (!fpp) notes.push("(no scale set on the picture: distances unknown)");
  return { ok: true, kind, notes, buildingFt: bFt, hydrantFt: hFt };
}
const currentPlacements = st => { const m = new Map(); for (const p of arr(st?.placements)) m.set(p.unit, p); return [...m.values()]; };
function placementText(s) {
  const cur = currentPlacements(s.state);
  return cur.length ? cur.map(p => `- ${p.unit} (${p.kind}): ${p.notes.join("; ")}`).join("\n") : "none yet";
}
export async function fetchAerial({ lat, lon, feet, size = 1280 }) {
  const base = process.env.USGS_BASE || "https://basemap.nationalmap.gov";
  const R = 6378137;
  const mx = R * lon * Math.PI / 180, my = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  const half = (feet * 0.3048 / 2) / Math.cos(lat * Math.PI / 180);   // Web Mercator stretches by 1/cos(lat)
  const bbox = [mx - half, my - half, mx + half, my + half].map(v => v.toFixed(2)).join(",");
  let r;
  try {
    r = await fetch(`${base}/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size},${size}&format=jpg&f=image`, { signal: AbortSignal.timeout(30_000) });
  } catch (e) { throw err(502, `Couldn't reach the USGS imagery service (${e.message}). Upload a picture instead.`); }
  const buf = Buffer.from(await r.arrayBuffer());
  if (!r.ok || buf.length < 1000 || !(buf[0] === 0xff && buf[1] === 0xd8)) throw err(502, "The USGS imagery service didn't send a picture. Upload one instead.");
  return { buf, width: size, height: size, ftPerPx: feet / size };
}

const scnJson = (s, full) => ({ id: s.id, key: s.key, kind: s.kind, title: s.title, summary: s.summary, programKey: s.program_key, moduleKey: s.module_key,
  active: s.active, sort: s.sort, minutes: s.data?.minutes || 10, you: s.data?.you || "", hasMap: !!s.data?.scene, ...(full ? { data: s.data } : {}) });

// The rubric a run is graded against: the linked program module's elements, else the scenario's own, else the default
async function rubricFor(s) {
  if (s.program_key && s.module_key) {
    const p = (await pool.query("SELECT * FROM eval_programs WHERE key = $1", [s.program_key])).rows[0];
    const m = p?.data?.modules?.find(x => x.key === s.module_key);
    if (m) return { elements: m.elements, scale: scaleOf(p), program: { id: p.id, name: p.name, key: p.key }, module: { key: m.key, title: m.title },
      expected: (m.guide || "").slice(0, 7000) };
  }
  const els = arr(s.data?.rubric).length ? s.data.rubric : RUBRICS[s.kind] || RUBRICS.radio;
  return { elements: els, scale: { min: 0, max: 5 }, program: null, module: null, expected: "" };
}

// ---- Simulation engine ---------------------------------------------------------------------------------
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const transcriptText = tr => tr.map(e => e.who === "place" ? `[${mmss(e.t)}] POSITIONED ${e.from}: ${e.text}` : `[${mmss(e.t)}] ${e.who === "officer" ? `OFFICER${e.from ? ` (${e.from})` : ""}` : e.who === "scene" ? "SCENE CHANGE" : e.who === "system" ? "NOTE" : e.from}: ${e.text}`).join("\n");
// Timeline events due by `clock`: scenario injects plus "on scene" reports for arriving units
function timeline(sc) {
  if (sc.kind === "conversation") return [];
  const d = sc.data || {};
  const ev = arr(d.injects).map((j, i) => ({ id: `i${i}`, t: j.t, from: j.from, text: j.text, cue: !!j.cue, expect: j.expect || "" }));
  for (const u of arr(d.units)) {
    if (!(u.eta > 0)) continue;
    if (ev.some(e => e.from === u.name && Math.abs(e.t - u.eta) <= 20)) continue;
    ev.push({ id: `u:${u.name}`, t: u.eta, from: u.name, text: `${u.name} on scene, awaiting assignment.`, arrival: true });
  }
  return ev.sort((a, b) => a.t - b.t);
}
function deliverDue(s, clock) {
  const st = s.state || {};
  const done = new Set(arr(st.delivered));
  const out = [];
  for (const e of timeline(s.scenario)) {
    if (e.t > clock || done.has(e.id)) continue;
    done.add(e.id);
    const entry = { t: e.t, who: e.from === "Scene" ? "scene" : "ai", from: e.from, text: e.text, inject: e.id, ...(e.cue ? { cue: true } : {}) };
    s.transcript.push(entry); out.push(entry);
  }
  s.state = { ...st, delivered: [...done] };
  return out;
}
const AI_OPTS = { what: "The simulation", noKey: "AI replies and grading need the assistant (the server needs an ANTHROPIC_API_KEY in .env)." };
async function simReplies(s, said, clock) {
  const { askClaude } = await import("./documents.js");
  const sc = s.scenario, d = sc.data || {};
  if (sc.kind === "conversation") {
    const p = d.persona || {};
    const prompt = `You are role-playing a fire department member in a leadership practice conversation with an officer. Stay fully in character as ${p.name} (${p.role}). ` +
      `Speak naturally, the way a firefighter talks at the station: short (1-4 sentences), no stage directions, no narration, never mention that this is a simulation or give coaching. ` +
      `React to what the officer actually says: become calmer and more open when they listen, ask questions and treat you fairly; become more defensive or escalate when they accuse, lecture, threaten, pull rank or dismiss you. ` +
      `Reveal your hidden background only when the officer earns it.\n\nSITUATION (the officer knows this): ${d.situation}\n\nYOUR HIDDEN BACKGROUND: ${p.background}\nStarting mood: ${p.mood}. Current mood: ${s.state?.mood || p.mood}.\n\n` +
      `CONVERSATION SO FAR:\n${transcriptText(s.transcript)}\n\nThe officer just said: "${said}"\n\n` +
      `Reply with JSON only: {"replies":[{"from":"${p.name}","text":"..."}],"mood":"one or two words for your mood now"}`;
    const out = await askClaude([{ type: "text", text: prompt }], { ...AI_OPTS, maxTokens: 500, timeoutMs: 45_000 });
    return { replies: arr(out.replies).slice(0, 2).map(r => ({ from: p.name, text: clean(r.text, 1200) })).filter(r => r.text), mood: clean(out.mood, 40) };
  }
  const arrived = arr(d.units).filter(u => u.eta <= clock).map(u => u.name), coming = arr(d.units).filter(u => u.eta > clock).map(u => `${u.name} (arrives at ${mmss(u.eta)})`);
  const prompt = `You run a voice fireground radio simulation for ${brand().org} officer training (Blue Card command practices). ` +
    `The officer being trained is ${d.you}. You play Dispatch and every other unit and person on the radio. Speak in short, realistic radio transmissions ` +
    `("Engine 653 copies, ..."), using the units' real call signs. Units can only act once they are on scene; units not yet on scene answer as en route. ` +
    `Acknowledge orders by repeating the key task, report progress and conditions consistent with the scenario facts and with what the officer has ordered, ` +
    `and ask for clarification when an order is unclear or impossible. Never coach, hint at the right answer, or evaluate the officer. Do not invent a Mayday ` +
    `or a new emergency; those come from the scenario timeline only. If nothing needs answering, reply with no transmissions.\n\n` +
    `DISPATCH: ${d.dispatch}\nWHAT THE OFFICER SEES ON ARRIVAL: ${d.arrival}\nHIDDEN SCENARIO FACTS: ${d.setting}\n` +
    `ON SCENE NOW: ${[d.you, ...arrived].join(", ")}. STILL COMING: ${coming.join(", ") || "none"}. Simulation clock: ${mmss(clock)}.\n` +
    (d.scene ? `APPARATUS POSITIONS the officer has set on the scene picture (units must work from these; a unit that hasn't been positioned is staged or ` +
      `just arriving; an aerial can't reach what's out of its reach; preconnects that won't reach mean a longer stretch or repositioning; ` +
      `a unit in a collapse zone or under power lines should say so when it matters):\n${placementText(s)}\nWind from ${d.scene.wind?.from ?? "?"}° at ${d.scene.wind?.mph ?? "?"} mph.\n` : "") + `\n` +
    `RADIO TRAFFIC SO FAR:\n${transcriptText(s.transcript)}\n\nThe officer just transmitted: "${said}"\n\n` +
    `Reply with JSON only: {"replies":[{"from":"call sign or Dispatch","text":"transmission"}]} with 0 to 3 transmissions.`;
  const out = await askClaude([{ type: "text", text: prompt }], { ...AI_OPTS, maxTokens: 600, timeoutMs: 45_000 });
  return { replies: arr(out.replies).slice(0, 3).map(r => ({ from: clean(r.from, 60) || "Dispatch", text: clean(r.text, 1000) })).filter(r => r.text) };
}
async function gradeSession(s) {
  const { askClaude } = await import("./documents.js");
  const sc = s.scenario, d = sc.data || {}, rub = s.state.rubric;
  const cues = timeline(sc).filter(e => e.cue).map(e => `- at ${mmss(e.t)} ${e.from}: "${e.text}" Expected: ${e.expect}`).join("\n");
  const els = rub.elements.map((e, i) => `${i + 1}. ${e.label} (weight x${e.mult})`).join("\n");
  const conv = sc.kind === "conversation";
  const prompt = `You grade a ${brand().org} ${conv ? "leadership conversation practice" : "voice incident command simulation (Blue Card practices, NFPA 1561 / 1021)"}. ` +
    `${scaleWords(rub.scale, "rubric element")} using only what is in the transcript. Quote or cite the moment (time) that supports each score. If the transcript doesn't show enough to score an element, ` +
    `give your best score and add a flag saying what an evaluator should verify. Be specific and fair; reward sound reasoning over one "correct" answer.\n\n` +
    `SCENARIO: ${sc.title}\n${conv ? `SITUATION: ${d.situation}\nTHE MEMBER'S HIDDEN BACKGROUND: ${d.persona?.background}\nWHAT A GOOD OUTCOME LOOKS LIKE: ${d.goal}`
      : `OFFICER: ${d.you}\nDISPATCH: ${d.dispatch}\nARRIVAL: ${d.arrival}\nSCENARIO FACTS: ${d.setting}\nSAFETY / MAYDAY CUES IN THE TIMELINE:\n${cues || "none"}` +
        (d.scene ? `\nAPPARATUS PLACEMENT (POSITIONED lines in the transcript; final positions below). Judge placement: water supply, aerial reach, ` +
          `leaving room for the ladder, staying out of collapse zones and from under power lines, access for later units:\n${placementText(s)}` : "")}\n` +
    `${rub.expected ? `\nTHE PROGRAM'S GUIDE FOR THIS MODULE (expected behaviors):\n${rub.expected}\n` : ""}\nRUBRIC:\n${els}\n\nTRANSCRIPT (times are simulation clock):\n${transcriptText(s.transcript)}\n\n` +
    `Reply with JSON only: {"scores":[{"score":n,"why":"..."}] (one per rubric element, in order), "summary":"2-3 sentences", "strengths":["..."], "improvements":["..."], ` +
    `"keyMoments":[{"t":"m:ss","text":"what happened","note":"why it mattered"}], ` +
    (conv ? `"helped":["what the officer said or did that helped"], "escalated":["what made it worse"], "listening":"how well they listened", "expectations":"how clearly they set expectations", "followUp":"their follow-up plan", `
      : `"cues":[{"t":"m:ss","cue":"...","recognized":true|false,"responseSeconds":n|null,"note":"..."}], "assignments":[{"t":"m:ss","unit":"...","task":"..."}], ` + (d.scene ? `"placement":"1-3 sentences on apparatus positioning", ` : "")) +
    `"flags":["things an evaluator should verify"]}`;
  const out = await askClaude([{ type: "text", text: prompt }], { ...AI_OPTS, maxTokens: 3000, timeoutMs: 120_000 });
  const scores = rub.elements.map((e, i) => {
    const x = arr(out.scores)[i] || {};
    const n = Number(x.score);
    return { label: e.label, mult: e.mult, score: Number.isFinite(n) ? Math.min(rub.scale.max, Math.max(rub.scale.min, Math.round(n))) : null, why: clean(x.why, 1500) };
  });
  const list = (v, n = 12) => arr(v).map(t => clean(typeof t === "string" ? t : JSON.stringify(t), 600)).filter(Boolean).slice(0, n);
  const pct = modulePct({ elements: rub.elements }, scores.map(x => x.score), rub.scale).pct;
  return { scores, pct, summary: clean(out.summary, 2000), strengths: list(out.strengths), improvements: list(out.improvements), flags: list(out.flags),
    keyMoments: arr(out.keyMoments).slice(0, 20).map(k => ({ t: clean(k.t, 8), text: clean(k.text, 500), note: clean(k.note, 500) })),
    ...(conv ? { helped: list(out.helped), escalated: list(out.escalated), listening: clean(out.listening, 1000), expectations: clean(out.expectations, 1000), followUp: clean(out.followUp, 1000) }
      : { cues: arr(out.cues).slice(0, 12).map(c => ({ t: clean(c.t, 8), cue: clean(c.cue, 300), recognized: c.recognized === true, responseSeconds: Number.isFinite(Number(c.responseSeconds)) && c.responseSeconds !== null ? Number(c.responseSeconds) : null, note: clean(c.note, 500) })),
          assignments: arr(out.assignments).slice(0, 40).map(a => ({ t: clean(a.t, 8), unit: clean(a.unit, 60), task: clean(a.task, 300) })), placement: clean(out.placement, 1500) }),
    gradedAt: new Date().toISOString() };
}
const sessJson = (s, names = {}) => ({ id: s.id, scenarioId: s.scenario_id, userId: s.user_id, name: names[s.user_id] || "", mode: s.mode, evaluator: s.evaluator_name,
  candidateId: s.candidate_id, status: s.status, scenario: s.scenario, transcript: s.transcript, grade: s.grade, resultId: s.result_id,
  mood: s.state?.mood || "", rubric: s.state?.rubric || null, placements: currentPlacements(s.state), placementLog: arr(s.state?.placements), startedAt: s.started_at, endedAt: s.ended_at, aiError: s.state?.aiError || "" });

// ---- Routes ------------------------------------------------------------------------------------------
export async function handleEvals(req, res, parts, user, send, jsonBody, url) {
  const [, , a, b, c] = parts;
  const acc = await access(user);
  const need = lvl => { if (!acc[lvl]) throw err(403, lvl === "manage" ? "Only people who manage Evaluations can do that." : "You need Evaluations access for that."); };

  if (req.method === "GET" && !a) {
    const progs = (await pool.query("SELECT * FROM eval_programs ORDER BY sort, name")).rows;
    const nm = await names();
    const myCands = (await pool.query("SELECT * FROM eval_candidates WHERE user_id = $1 ORDER BY start_date DESC", [user.id])).rows;
    const allCands = (await pool.query("SELECT * FROM eval_candidates ORDER BY start_date DESC")).rows;
    const evaluating = allCands.filter(cd => acc.view || evaluatesCandidate(user, acc, progs.find(p => p.id === cd.program_id), cd));
    const res2 = (await pool.query("SELECT * FROM eval_results WHERE candidate_id = ANY(string_to_array($1, ',')::uuid[]) OR user_id = $2",
      [[...new Set([...evaluating, ...myCands].map(x => x.id))].join(",") || "00000000-0000-0000-0000-000000000000", user.id])).rows;
    const stand = cd => { const p = progs.find(x => x.id === cd.program_id); return p ? standing(p, res2.filter(r => r.candidate_id === cd.id), new Date(cd.start_date)) : null; };
    const pending = (await pool.query(`SELECT r.id, r.month, r.candidate_id FROM eval_reviews r JOIN eval_candidates c ON c.id = r.candidate_id
      WHERE c.user_id = $1 AND r.status = 'signed' AND r.ack_at IS NULL`, [user.id])).rows;
    const toAck = res2.filter(r => r.user_id === user.id && r.status === "final" && r.kind !== "practice" && !r.ack_at).map(r => r.id);
    const drafts = res2.filter(r => r.status === "draft" && r.evaluator_id === user.id && r.kind !== "practice").length;
    return send(res, 200, { access: acc, me: user.id,
      programs: progs.filter(p => p.active || acc.manage).map(progSummary),
      evaluatesAny: acc.edit || progs.some(p => arr(p.evaluators).includes(user.id)) || allCands.some(cd => arr(cd.evaluators).includes(user.id)),
      mine: myCands.map(cd => ({ ...candJson(cd, nm), standing: stand(cd) })),
      candidates: evaluating.map(cd => ({ ...candJson(cd, nm), standing: stand(cd) })),
      myResults: res2.filter(r => r.user_id === user.id && (r.status === "final" || r.kind === "practice")).map(r => resJson(r, progs.find(p => p.id === r.program_id), nm)),
      reviewsToAck: pending.map(r => ({ id: r.id, month: r.month, candidateId: r.candidate_id })), resultsToAck: toAck, myDrafts: drafts });
  }
  if (req.method === "GET" && a === "people") {
    if (!acc.view && !acc.edit && !(await anyEvaluator(user))) throw err(403, "You need Evaluations access for that.");
    const rows = (await pool.query(`SELECT u.id, u.full_name AS name, u.job_title AS title, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
      WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows;
    return send(res, 200, { people: rows });
  }
  if (a === "transcriber" && req.method === "GET") {
    const { transcriberStatus } = await import("./transcribe.js");
    return send(res, 200, { ...transcriberStatus(), ai: !!process.env.ANTHROPIC_API_KEY });
  }

  // ---- Programs ----
  if (a === "programs") {
    if (req.method === "GET" && isUuid(b)) {
      const p = await getProgram(b);
      if (!p) throw err(404, "That program wasn't found.");
      return send(res, 200, { program: { ...progSummary(p), data: p.data, updatedBy: p.updated_by_name, updatedAt: p.updated_at } });
    }
    if (req.method === "POST" && !b) {
      need("manage");
      const x = await jsonBody(req);
      const name = clean(x.name, 160);
      if (!name) throw err(400, "Give the program a name.");
      const old = isUuid(x.id) ? await getProgram(x.id) : null;
      if (x.id && !old) throw err(404, "That program wasn't found.");
      const data = cleanProgramData(x.data, old?.data || {});
      const vals = [name, clean(x.rank, 80), x.kind === "wtp" ? "wtp" : "form", clean(x.description, 2000), JSON.stringify(data), x.active !== false,
        Number.isFinite(Number(x.sort)) ? Number(x.sort) : (old?.sort ?? 100), JSON.stringify(ids(x.evaluators)), user.name];
      let id = old?.id;
      await tx(async c2 => {
        if (old) await c2.query(`UPDATE eval_programs SET name=$2, rank=$3, kind=$4, description=$5, data=$6, active=$7, sort=$8, evaluators=$9, updated_by_name=$10, updated_at=now() WHERE id=$1`, [id, ...vals]);
        else { id = crypto.randomUUID(); await c2.query(`INSERT INTO eval_programs (id, name, rank, kind, description, data, active, sort, evaluators, updated_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, ...vals]); }
        await audit(c2, user, old ? "Edited evaluation program" : "Created evaluation program", name);
      });
      return send(res, 200, { id });
    }
  }

  // ---- Candidates (working test periods) ----
  if (a === "candidates" && !b && req.method === "POST") {
    need("manage");
    const x = await jsonBody(req);
    const p = await getProgram(x.programId);
    if (!p || p.kind !== "wtp") throw err(400, "Pick a working test period program.");
    if (!isUuid(x.userId) || !(await userName(x.userId))) throw err(400, "Pick the person.");
    if (!DAY.test(x.startDate || "")) throw err(400, "Enter the start date (the promotion or appointment date).");
    const months = Number(p.data?.months) || 12;
    const end = new Date(`${x.startDate}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + months);
    const status = ["active", "completed", "extended", "withdrawn"].includes(x.status) ? x.status : "active";
    let id = x.id;
    const evaluators = JSON.stringify(ids(x.evaluators));
    const who = await userName(x.userId);
    await tx(async c2 => {
      if (isUuid(id)) {
        const old = await getCandidate(id, c2);
        if (!old) throw err(404, "That enrolment wasn't found.");
        const endDate = DAY.test(x.endDate || "") ? x.endDate : day(end);
        await c2.query("UPDATE eval_candidates SET start_date=$2, end_date=$3, status=$4, evaluators=$5 WHERE id=$1", [id, x.startDate, endDate, status, evaluators]);
        await audit(c2, user, "Edited working test period", `${who}: ${p.name} (${status}${endDate !== day(old.end_date) ? `, ends ${endDate}` : ""})`);
      } else {
        const dup = (await c2.query("SELECT 1 FROM eval_candidates WHERE program_id = $1 AND user_id = $2 AND status IN ('active','extended')", [p.id, x.userId])).rows[0];
        if (dup) throw err(409, `${who} already has an open ${p.name}.`);
        id = crypto.randomUUID();
        await c2.query(`INSERT INTO eval_candidates (id, program_id, user_id, start_date, end_date, status, evaluators, created_by_name) VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`,
          [id, p.id, x.userId, x.startDate, day(end), evaluators, user.name]);
        await audit(c2, user, "Started working test period", `${who}: ${p.name} from ${x.startDate}`);
      }
    });
    if (!isUuid(x.id)) await notify(user, [x.userId, ...ids(x.evaluators)], `Working test period: ${p.name}`,
      `${who}'s ${p.name} starts ${x.startDate} and runs ${months} months.\n\nThe modules, rubrics, deliverables and reviews are in ${brand().productName}: Main menu › Evaluations.`);
    return send(res, 200, { id });
  }
  if (a === "candidates" && isUuid(b)) {
    const cd = await getCandidate(b);
    if (!cd) throw err(404, "That working test period wasn't found.");
    const p = await getProgram(cd.program_id);
    const evaluator = evaluatesCandidate(user, acc, p, cd);
    const self = cd.user_id === user.id;
    if (!self && !evaluator && !acc.view) throw err(403, "You can't see that record.");
    if (req.method === "GET" && !c) {
      const nm = await names();
      const results = (await pool.query("SELECT * FROM eval_results WHERE candidate_id = $1 ORDER BY eval_date DESC, created_at DESC", [cd.id])).rows
        .filter(r => r.kind !== "practice" && (r.status === "final" || evaluator || acc.view));
      const subs = (await pool.query(`SELECT id, module_key, title, body, file_name, file_mime, octet_length(file_data) AS size, submitted_by, submitted_by_name, submitted_at
        FROM eval_submissions WHERE candidate_id = $1 ORDER BY submitted_at DESC`, [cd.id])).rows;
      const reviews = (await pool.query("SELECT * FROM eval_reviews WHERE candidate_id = $1 ORDER BY month", [cd.id])).rows
        .filter(r => r.status === "signed" || evaluator || acc.view);
      return send(res, 200, { candidate: candJson(cd, nm), program: { ...progSummary(p), data: p.data }, canEvaluate: evaluator, canManage: acc.manage, self,
        results: results.map(r => resJson(r, p, nm)), standing: standing(p, results, new Date(cd.start_date)),
        submissions: subs.map(s => ({ id: s.id, moduleKey: s.module_key, title: s.title, body: s.body, fileName: s.file_name, size: s.size, by: s.submitted_by_name, byId: s.submitted_by, at: s.submitted_at })),
        reviews: reviews.map(reviewJson) });
    }
    if (req.method === "POST" && c === "outcome") {
      need("manage");
      const x = await jsonBody(req);
      const outcome = clean(x.outcome, 120);
      if (outcome && !arr(p.data?.outcomes).includes(outcome)) throw err(400, "Pick one of the program's recommendations.");
      const sig = signature(x.signature);
      if (outcome && !sig) throw err(400, "Sign the final recommendation.");
      const status = !outcome ? (cd.status === "completed" ? "active" : cd.status) : /extend/i.test(outcome) ? "extended" : "completed";
      await tx(async c2 => {
        await c2.query(`UPDATE eval_candidates SET outcome=$2, outcome_note=$3, outcome_by_name=$4, outcome_at=$5, outcome_signature=$6, status=$7 WHERE id=$1`,
          [cd.id, outcome, clean(x.note, 6000), outcome ? user.name : "", outcome ? new Date() : null, sig, status]);
        await audit(c2, user, outcome ? "Signed final recommendation" : "Cleared final recommendation", `${await userName(cd.user_id)}: ${p.name}${outcome ? ` – ${outcome}` : ""}`);
      });
      if (outcome) await notify(user, [cd.user_id], `${p.name}: final recommendation`, `The final recommendation for your ${p.name} was signed: ${outcome}.\n\nSee it in ${brand().productName}: Main menu › Evaluations.`);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && c === "submissions") {
      if (!self && !evaluator) throw err(403, "Only the candidate or an evaluator can add a submission.");
      const x = await jsonBody(req);
      const mod = arr(p.data?.modules).find(m => m.key === x.moduleKey);
      if (!mod) throw err(400, "Pick the module this is for.");
      let file = null;
      if (x.data) {
        file = Buffer.from(String(x.data).replace(/^data:[^,]*,/, ""), "base64");
        if (file.length > 15 * 1024 * 1024) throw err(413, "Files can be up to 15 MB.");
      }
      const body = clean(x.body, 60000);
      if (!body && !file) throw err(400, "Write the submission or attach a file.");
      const id = crypto.randomUUID();
      await tx(async c2 => {
        await c2.query(`INSERT INTO eval_submissions (id, candidate_id, module_key, title, body, file_name, file_mime, file_data, submitted_by, submitted_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, cd.id, mod.key, clean(x.title, 200) || `Module ${mod.key} submission`, body, file ? clean(x.fileName, 200) : "",
          file ? clean(x.mime, 100) || "application/octet-stream" : "", file, user.id, user.name]);
        await audit(c2, user, "Added submission", `${p.name} ${mod.key}: ${clean(x.title, 200)}`);
      });
      if (self) await notify(user, arr(cd.evaluators), `Submission: ${p.name} module ${mod.key}`, `${user.name} turned in "${clean(x.title, 200) || mod.title}" for ${mod.key} – ${mod.title}.\n\nOpen it in ${brand().productName}: Main menu › Evaluations.`);
      return send(res, 200, { id });
    }
    if (req.method === "POST" && c === "reviews") {
      if (!evaluator) throw err(403, "Only an evaluator can write reviews.");
      const x = await jsonBody(req);
      const month = Number(x.month);
      if (!(month >= 1 && month <= 36)) throw err(400, "Pick the review month.");
      const old = (await pool.query("SELECT * FROM eval_reviews WHERE candidate_id = $1 AND month = $2", [cd.id, month])).rows[0];
      if (old?.status === "signed") throw err(409, "That review is already signed.");
      const sign = x.sign === true;
      const sig = signature(x.signature);
      const v = [clean(x.summary, 8000), clean(x.achievements, 8000), clean(x.deficiencies, 8000), clean(x.goals, 8000), x.improvementPlan === true];
      if (sign && (!sig || !v[0])) throw err(400, "Write the summary and sign before finalizing the review.");
      await tx(async c2 => {
        if (old) await c2.query(`UPDATE eval_reviews SET summary=$2, achievements=$3, deficiencies=$4, goals=$5, improvement_plan=$6, status=$7, evaluator_id=$8, evaluator_name=$9,
          evaluator_signature=$10, signed_at=$11, updated_at=now() WHERE id=$1`, [old.id, ...v, sign ? "signed" : "draft", user.id, user.name, sign ? sig : null, sign ? new Date() : null]);
        else await c2.query(`INSERT INTO eval_reviews (id, candidate_id, month, summary, achievements, deficiencies, goals, improvement_plan, status, evaluator_id, evaluator_name, evaluator_signature, signed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [crypto.randomUUID(), cd.id, month, ...v, sign ? "signed" : "draft", user.id, user.name, sign ? sig : null, sign ? new Date() : null]);
        if (sign) await audit(c2, user, "Signed review", `${await userName(cd.user_id)}: ${p.name} month ${month}${v[4] ? " (improvement plan)" : ""}`);
      });
      if (sign) await notify(user, [cd.user_id], `${p.name}: ${month}-month review`, `Your ${month}-month review was signed by ${user.name}. Please read it and sign that you've seen it.\n\n${brand().productName}: Main menu › Evaluations.`);
      return send(res, 200, { ok: true });
    }
  }
  if (a === "reviews" && isUuid(b) && c === "ack" && req.method === "POST") {
    const r = (await pool.query("SELECT r.*, c.user_id FROM eval_reviews r JOIN eval_candidates c ON c.id = r.candidate_id WHERE r.id = $1", [b])).rows[0];
    if (!r || r.user_id !== user.id) throw err(404, "That review wasn't found.");
    if (r.status !== "signed") throw err(409, "That review isn't signed yet.");
    if (r.ack_at) throw err(409, "You already signed this review.");
    const x = await jsonBody(req);
    const sig = signature(x.signature);
    if (!sig) throw err(400, "Sign to show you've seen the review.");
    await tx(async c2 => {
      await c2.query("UPDATE eval_reviews SET ack_signature=$2, ack_comment=$3, ack_at=now() WHERE id=$1", [b, sig, clean(x.comment, 4000)]);
      await audit(c2, user, "Acknowledged review", `month ${r.month}`);
    });
    if (r.evaluator_id) await notify(user, [r.evaluator_id], `Review acknowledged`, `${user.name} signed their ${r.month}-month review${x.comment ? ` and commented:\n\n${clean(x.comment, 4000)}` : "."}`);
    return send(res, 200, { ok: true });
  }
  if (a === "submissions" && isUuid(b)) {
    const s = (await pool.query("SELECT s.*, c.user_id, c.program_id, c.evaluators FROM eval_submissions s JOIN eval_candidates c ON c.id = s.candidate_id WHERE s.id = $1", [b])).rows[0];
    if (!s) throw err(404, "That submission wasn't found.");
    const p = await getProgram(s.program_id);
    const ok = s.user_id === user.id || acc.view || evaluatesCandidate(user, acc, p, s);
    if (!ok) throw err(404, "That submission wasn't found.");
    if (req.method === "GET" && c === "file") {
      if (!s.file_data) throw err(404, "No file on that submission.");
      res.writeHead(200, { "Content-Type": s.file_mime || "application/octet-stream", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${(s.file_name || "file").replace(/[^\w.\- ]+/g, "_")}"` });
      return res.end(s.file_data);
    }
    if (req.method === "POST" && c === "remove") {
      if (s.submitted_by !== user.id && !acc.manage) throw err(403, "Only the person who added it can remove it.");
      await tx(async c2 => { await c2.query("DELETE FROM eval_submissions WHERE id = $1", [b]); await audit(c2, user, "Removed submission", s.title); });
      return send(res, 200, { ok: true });
    }
  }

  // ---- Results ----
  if (a === "results") {
    if (req.method === "GET" && !b) {
      const who = isUuid(url.searchParams.get("user")) ? url.searchParams.get("user") : null;
      const prog = isUuid(url.searchParams.get("program")) ? url.searchParams.get("program") : null;
      const rows = (await pool.query(`SELECT * FROM eval_results WHERE ($1::uuid IS NULL OR user_id = $1) AND ($2::uuid IS NULL OR program_id = $2)
        ORDER BY eval_date DESC, created_at DESC LIMIT 500`, [who, prog])).rows;
      const progs = (await pool.query("SELECT * FROM eval_programs")).rows;
      const cands = (await pool.query("SELECT * FROM eval_candidates")).rows;
      const nm = await names();
      const visible = rows.filter(r => r.kind === "practice" ? r.user_id === user.id || r.evaluator_id === user.id
        : r.user_id === user.id && r.status === "final" || r.evaluator_id === user.id || acc.view
          || evaluatesCandidate(user, acc, progs.find(p => p.id === r.program_id), cands.find(cd => cd.id === r.candidate_id)));
      return send(res, 200, { results: visible.map(r => resJson(r, progs.find(p => p.id === r.program_id), nm)) });
    }
    if (isUuid(b)) {
      const r = (await pool.query("SELECT * FROM eval_results WHERE id = $1", [b])).rows[0];
      if (!r) throw err(404, "That evaluation wasn't found.");
      const p = await getProgram(r.program_id), cd = await getCandidate(r.candidate_id);
      const evaluator = evaluatesCandidate(user, acc, p, cd);
      const mine = r.user_id === user.id;
      const canSee = r.kind === "practice" ? mine || r.evaluator_id === user.id : (mine && r.status === "final") || r.evaluator_id === user.id || evaluator || acc.view;
      if (!canSee) throw err(404, "That evaluation wasn't found.");
      if (req.method === "GET" && !c) return send(res, 200, { result: resJson(r, p, await names()), program: { ...progSummary(p), data: p.data },
        mine, canEdit: r.status === "draft" && (r.evaluator_id === user.id || evaluator), canReopen: acc.manage && r.status === "final" });
      if (req.method === "POST" && c === "reopen") {
        need("manage");
        if (r.status !== "final") throw err(409, "That evaluation isn't final.");
        await tx(async c2 => {
          await c2.query("UPDATE eval_results SET status='draft', signature=NULL, signed_at=NULL, ack_at=NULL, updated_at=now() WHERE id=$1", [b]);
          await audit(c2, user, "Reopened evaluation", `${await userName(r.user_id)}: ${p.name} (${arr(r.modules).join(", ")}) signed by ${r.evaluator_name}`);
        });
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && c === "remove") {
        if (r.status !== "draft") throw err(409, "A signed evaluation can't be deleted (a manager can reopen it).");
        if (r.evaluator_id !== user.id && !acc.manage) throw err(403, "Only the evaluator who started it can delete this draft.");
        await tx(async c2 => { await c2.query("DELETE FROM eval_results WHERE id = $1", [b]); if (r.kind !== "practice") await audit(c2, user, "Deleted draft evaluation", `${await userName(r.user_id)}: ${p.name}`); });
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && c === "ack") {
        if (!mine || r.status !== "final") throw err(403, "Only the person evaluated can acknowledge it.");
        const x = await jsonBody(req);
        await pool.query("UPDATE eval_results SET ack_at = COALESCE(ack_at, now()), ack_comment = $2 WHERE id = $1", [b, clean(x.comment, 4000)]);
        if (x.comment && r.evaluator_id) await notify(user, [r.evaluator_id], "Comment on an evaluation", `${user.name} commented on the ${p.name} evaluation you signed:\n\n${clean(x.comment, 4000)}`);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === "POST" && !b) return send(res, 200, await saveResult(user, acc, await jsonBody(req)));
  }

  // ---- AI draft from the evaluator's observations ----
  if (a === "ai" && b === "draft" && req.method === "POST") {
    const x = await jsonBody(req);
    const p = await getProgram(x.programId);
    if (!p) throw err(400, "Pick the program.");
    const cd = await getCandidate(x.candidateId);
    if (!evaluatesCandidate(user, acc, p, cd) && x.userId !== user.id) throw err(403, "Only an evaluator for this program can do that.");
    const mods = arr(p.data.modules).filter(m => arr(x.modules).includes(m.key));
    if (!mods.length) throw err(400, "Pick at least one module.");
    const obs = clean(x.observations, 20000);
    if (obs.length < 20) throw err(400, "Write what you observed first (a few sentences at least), then ask for a draft.");
    let subs = "";
    if (cd) {
      const rows = (await pool.query("SELECT module_key, title, body FROM eval_submissions WHERE candidate_id = $1 AND module_key = ANY(string_to_array($2, ',')) AND body <> '' ORDER BY submitted_at DESC",
        [cd.id, mods.map(m => m.key).join(",")])).rows;
      subs = rows.slice(0, 4).map(s => `--- Candidate's written submission for ${s.module_key} ("${s.title}"):\n${s.body.slice(0, 6000)}`).join("\n\n");
    }
    const scale = scaleOf(p);
    const rubric = mods.map(m => `MODULE ${m.key} – ${m.title}\nElements:\n${m.elements.map((e, i) => `  ${i + 1}. ${e.label} (x${e.mult})`).join("\n")}\nGuide (from the program):\n${(m.guide || "").slice(0, Math.floor(16000 / mods.length))}`).join("\n\n");
    const { askClaude } = await import("./documents.js");
    const out = await askClaude([{ type: "text", text:
      `You help a ${brand().org} evaluator apply an approved rubric. Program: ${p.name}. ${scaleWords(scale, "element")} using ONLY the evaluator's observations` +
      `${subs ? " and the candidate's written submissions" : ""}. Never invent facts. When the observations don't show enough to score an element, set "score" to null and add a flag ` +
      `telling the evaluator what to verify. Also flag anything that conflicts, sounds like opinion rather than observed behavior, or touches policy/Civil Service compliance that should be checked. ` +
      `The evaluator reviews and signs the official result; you only draft.\n\n${rubric}\n\nEVALUATOR'S OBSERVATIONS:\n${obs}\n\n${subs}\n\n` +
      `Reply with JSON only: {"modules":{"<module key>":{"scores":[{"score":n|null,"why":"..."}],"comment":"..."}},"feedback":"feedback to the person, specific, 1-2 short paragraphs","flags":["..."]}` }],
      { what: "The assistant", maxTokens: 3000, timeoutMs: 120_000 });
    const draft = { modules: {}, feedback: clean(out.feedback, 6000), flags: arr(out.flags).map(f => clean(f, 600)).filter(Boolean).slice(0, 20), at: new Date().toISOString() };
    for (const m of mods) {
      const got = out.modules?.[m.key] || {};
      draft.modules[m.key] = { comment: clean(got.comment, 3000), scores: m.elements.map((e, i) => {
        const s = arr(got.scores)[i] || {};
        const n = s.score === null || s.score === undefined ? null : Number(s.score);
        return { score: Number.isFinite(n) ? Math.min(scale.max, Math.max(scale.min, Math.round(n))) : null, why: clean(s.why, 1500) };
      }) };
    }
    return send(res, 200, { draft });
  }

  // ---- Scene pictures ----
  if (a === "images" && isUuid(b) && req.method === "GET") {
    const im = (await pool.query("SELECT mime, data FROM sim_images WHERE id = $1", [b])).rows[0];
    if (!im) throw err(404, "That picture wasn't found.");
    res.writeHead(200, { "Content-Type": im.mime, "Cache-Control": "private, max-age=86400" });
    return res.end(im.data);
  }
  if (a === "images" && !b && req.method === "POST") {
    need("manage");
    const x = await jsonBody(req);
    const mime = ["image/jpeg", "image/png", "image/webp"].includes(x.mime) ? x.mime : null;
    if (!mime) throw err(415, "Upload a JPG, PNG or WebP picture.");
    const buf = Buffer.from(String(x.data || "").replace(/^data:[^,]*,/, ""), "base64");
    if (buf.length < 100) throw err(400, "That picture is empty.");
    if (buf.length > 15 * 1024 * 1024) throw err(413, "Pictures can be up to 15 MB.");
    const w = Math.round(Number(x.width)), h = Math.round(Number(x.height));
    if (!(w > 0 && w <= 20000 && h > 0 && h <= 20000)) throw err(400, "Couldn't read the picture's size.");
    const id = crypto.randomUUID();
    await pool.query("INSERT INTO sim_images (id, name, mime, data, width, height, source, created_by_name) VALUES ($1,$2,$3,$4,$5,$6,'upload',$7)",
      [id, clean(x.name, 200), mime, buf, w, h, user.name]);
    return send(res, 200, { id, width: w, height: h, ftPerPx: null, attribution: "" });
  }
  if (a === "aerial" && req.method === "POST") {
    need("manage");
    const x = await jsonBody(req);
    let lat = Number(x.lat), lon = Number(x.lon), matched = "";
    if (!(Number.isFinite(lat) && Number.isFinite(lon)) || x.address) {
      const q = clean(x.address, 200);
      if (!q) throw err(400, "Enter the address.");
      const base = process.env.GEOCODER_BASE || "https://geocoding.geo.census.gov";
      let j;
      try {
        const r = await fetch(`${base}/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(15_000) });
        j = await r.json();
      } catch (e) { throw err(502, `The address lookup didn't answer (${e.message}). Upload a picture instead.`); }
      const m = j?.result?.addressMatches?.[0];
      if (!m) throw err(404, "That address wasn't found. Try the full street address with city and state.");
      lat = m.coordinates.y; lon = m.coordinates.x; matched = m.matchedAddress;
    }
    if (!(lat > 15 && lat < 72 && lon > -180 && lon < -60)) throw err(400, "USGS imagery covers the United States only.");
    const feet = Math.min(3000, Math.max(200, Number(x.feet) || 600));
    const img = await fetchAerial({ lat, lon, feet });
    const id = crypto.randomUUID(), attribution = "Imagery: USGS The National Map (NAIP)";
    await pool.query(`INSERT INTO sim_images (id, name, mime, data, width, height, ft_per_px, source, attribution, lat, lon, created_by_name)
      VALUES ($1,$2,'image/jpeg',$3,$4,$5,$6,'usgs',$7,$8,$9,$10)`, [id, matched || clean(x.address, 200) || `${lat},${lon}`, img.buf, img.width, img.height, img.ftPerPx, attribution, lat, lon, user.name]);
    return send(res, 200, { id, width: img.width, height: img.height, ftPerPx: img.ftPerPx, attribution, matched, lat, lon });
  }

  // ---- Scenarios ----
  if (a === "scenarios") {
    if (req.method === "GET" && !b) {
      const rows = (await pool.query("SELECT * FROM sim_scenarios ORDER BY sort, title")).rows.filter(s => s.active || acc.manage);
      return send(res, 200, { scenarios: rows.map(s => scnJson(s, acc.manage)), canManage: acc.manage });
    }
    if (req.method === "POST" && !b) {
      need("manage");
      const x = await jsonBody(req);
      const kind = x.kind === "conversation" ? "conversation" : "radio";
      const title = clean(x.title, 200);
      if (!title) throw err(400, "Give the scenario a title.");
      const data = cleanScenarioData(kind, x.data);
      const old = isUuid(x.id) ? (await pool.query("SELECT * FROM sim_scenarios WHERE id = $1", [x.id])).rows[0] : null;
      if (x.id && !old) throw err(404, "That scenario wasn't found.");
      const vals = [kind, title, clean(x.summary, 1000), clean(x.programKey, 40), clean(x.moduleKey, 12), JSON.stringify(data), x.active !== false, user.name];
      let id = old?.id;
      await tx(async c2 => {
        if (old) await c2.query("UPDATE sim_scenarios SET kind=$2, title=$3, summary=$4, program_key=$5, module_key=$6, data=$7, active=$8, updated_by_name=$9, updated_at=now() WHERE id=$1", [id, ...vals]);
        else { id = crypto.randomUUID(); await c2.query("INSERT INTO sim_scenarios (id, kind, title, summary, program_key, module_key, data, active, updated_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, ...vals]); }
        await audit(c2, user, old ? "Edited simulation scenario" : "Created simulation scenario", title);
      });
      return send(res, 200, { id });
    }
  }

  // ---- Simulation sessions ----
  if (a === "sessions") {
    if (req.method === "POST" && !b) {
      const x = await jsonBody(req);
      const s = isUuid(x.scenarioId) ? (await pool.query("SELECT * FROM sim_scenarios WHERE id = $1", [x.scenarioId])).rows[0] : null;
      if (!s || (!s.active && !acc.manage)) throw err(404, "That scenario wasn't found.");
      const mode = KINDS.includes(x.mode) ? x.mode : "practice";
      let runner = user.id, cand = null;
      if (mode !== "practice") {
        cand = await getCandidate(x.candidateId);
        const linked = s.program_key ? (await pool.query("SELECT * FROM eval_programs WHERE key = $1", [s.program_key])).rows[0] : null;
        if (cand) {
          const p = await getProgram(cand.program_id);
          if (!evaluatesCandidate(user, acc, p, cand)) throw err(403, "Only an evaluator for this candidate can start an evaluated run.");
          runner = cand.user_id;
        } else {
          if (!isUuid(x.userId) || !(await userName(x.userId))) throw err(400, "Pick who is being evaluated.");
          if (!(linked ? evaluatesProgram(user, acc, linked) : acc.edit)) throw err(403, "Only an evaluator can start an evaluated run.");
          runner = x.userId;
        }
      }
      const rubric = await rubricFor(s);
      const sess = { id: crypto.randomUUID(), transcript: [], state: { delivered: [], rubric, mood: s.kind === "conversation" ? s.data?.persona?.mood || "" : "" },
        scenario: { id: s.id, kind: s.kind, title: s.title, summary: s.summary, programKey: s.program_key, moduleKey: s.module_key, data: s.data } };
      // Opening: dispatch (radio) or the member's first line (conversation)
      if (s.kind === "conversation") sess.transcript.push({ t: 0, who: "ai", from: s.data?.persona?.name || "Member", text: s.data?.persona?.opening || "You wanted to see me?" });
      else {
        if (s.data?.dispatch) sess.transcript.push({ t: 0, who: "ai", from: "Dispatch", text: s.data.dispatch });
        if (s.data?.arrival) sess.transcript.push({ t: 0, who: "scene", from: "Scene", text: s.data.arrival });
        deliverDue(sess, 0);
      }
      await pool.query(`INSERT INTO sim_sessions (id, scenario_id, user_id, mode, evaluator_id, evaluator_name, candidate_id, scenario, transcript, state)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [sess.id, s.id, runner, mode, mode === "practice" ? null : user.id, mode === "practice" ? "" : user.name,
        cand?.id || null, JSON.stringify(sess.scenario), JSON.stringify(sess.transcript), JSON.stringify(sess.state)]);
      if (mode !== "practice") await audit(pool, user, "Started evaluated simulation", `${await userName(runner)}: ${s.title} (${mode})`);
      const row = (await pool.query("SELECT * FROM sim_sessions WHERE id = $1", [sess.id])).rows[0];
      return send(res, 200, { session: sessJson(row, await names()) });
    }
    if (req.method === "GET" && !b) {
      const all = url.searchParams.get("scope") === "all";
      const rows = (await pool.query(`SELECT id, scenario_id, user_id, mode, evaluator_id, evaluator_name, candidate_id, status, scenario->>'title' AS title, scenario->>'kind' AS kind,
          grade->>'pct' AS pct, result_id, started_at, ended_at FROM sim_sessions WHERE user_id = $1 OR evaluator_id = $1 OR ($2 AND mode <> 'practice')
          ORDER BY started_at DESC LIMIT 200`, [user.id, all && acc.view])).rows;
      const nm = await names();
      return send(res, 200, { sessions: rows.map(r => ({ id: r.id, scenarioId: r.scenario_id, userId: r.user_id, name: nm[r.user_id] || "", mode: r.mode, evaluator: r.evaluator_name,
        status: r.status, title: r.title, kind: r.kind, pct: r.pct === null ? null : Number(r.pct), resultId: r.result_id, startedAt: r.started_at, endedAt: r.ended_at })) });
    }
    if (isUuid(b)) {
      const s = (await pool.query("SELECT * FROM sim_sessions WHERE id = $1", [b])).rows[0];
      if (!s) throw err(404, "That run wasn't found.");
      const runner = s.user_id === user.id, evalr = s.evaluator_id === user.id;
      const seeIt = runner || evalr || (s.mode !== "practice" && acc.view);
      if (!seeIt) throw err(404, "That run wasn't found.");
      if (req.method === "GET" && !c) return send(res, 200, { session: sessJson(s, await names()) });
      if (req.method !== "POST") throw err(404, "Not found");
      if (!runner && !evalr) throw err(403, "Only the person running it (or the evaluator) can do that.");
      const x = await jsonBody(req);
      const limit = ((s.scenario?.data?.minutes || 10) + 10) * 60;
      const last = s.transcript.length ? Math.max(...s.transcript.map(e => e.t || 0)) : 0;
      const clock = Math.min(limit, Math.max(last, Number(x.clock) || 0));
      if (c === "place") {
        if (s.status !== "running") throw err(409, "This run has ended.");
        const scene = s.scenario?.data?.scene;
        if (!scene) throw err(400, "This scenario has no scene picture.");
        const unit = clean(x.unit, 40);
        const d = s.scenario.data;
        const all = [{ name: d.you, eta: 0 }, ...arr(d.units)];
        const u = all.find(z => z.name === unit);
        if (!u) throw err(400, "That unit isn't on this assignment.");
        if (u.eta > clock) return send(res, 200, { ok: false, reason: `${unit} isn't on scene yet.` });
        const p = { x: Number(x.x), y: Number(x.y) };
        if (!(p.x >= 0 && p.x <= scene.width && p.y >= 0 && p.y <= scene.height)) throw err(400, "That's off the picture.");
        const eff = placementEffects(scene, unit, p);
        if (!eff.ok) return send(res, 200, { ok: false, reason: eff.reason });
        const pl = { unit, kind: eff.kind, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, angle: ((Math.round(Number(x.angle) || 0) % 360) + 360) % 360, t: clock, notes: eff.notes };
        s.state = { ...s.state, placements: [...arr(s.state?.placements), pl].slice(-200) };
        const entry = { t: clock, who: "place", from: unit, text: eff.notes.join("; ") || "positioned" };
        s.transcript.push(entry);
        await pool.query("UPDATE sim_sessions SET transcript=$2, state=$3 WHERE id=$1", [b, JSON.stringify(s.transcript), JSON.stringify(s.state)]);
        return send(res, 200, { ok: true, placement: pl, entry });
      }
      if (c === "tick") {
        if (s.status !== "running") return send(res, 200, { events: [] });
        const events = deliverDue(s, clock);
        if (events.length) await pool.query("UPDATE sim_sessions SET transcript=$2, state=$3 WHERE id=$1", [b, JSON.stringify(s.transcript), JSON.stringify(s.state)]);
        return send(res, 200, { events });
      }
      if (c === "turn") {
        if (s.status !== "running") throw err(409, "This run has ended.");
        let said = clean(x.text, 2000), heard = "";
        if (!said && x.audio) {
          const buf = Buffer.from(String(x.audio).replace(/^data:[^,]*,/, ""), "base64");
          if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw err(400, "That recording isn't a WAV file.");
          if (buf.length > 6 * 1024 * 1024) throw err(413, "That transmission is too long (keep it under about a minute).");
          const { transcribeWav } = await import("./transcribe.js");
          const units = [s.scenario?.data?.you, ...arr(s.scenario?.data?.units).map(u => u.name)].filter(Boolean).join(", ");
          heard = await transcribeWav(buf, units);
          said = heard;
          if (!said) return send(res, 200, { heard: "", said: "", events: [], replies: [], note: "Nothing came through. Hold the button the whole time you talk, then try again." });
        }
        if (!said) throw err(400, "Say or type something.");
        const before = s.transcript.length;
        deliverDue(s, clock);
        const events = s.transcript.slice(before);
        s.transcript.push({ t: clock, who: "officer", from: s.scenario?.kind === "radio" ? s.scenario?.data?.you || "" : "", text: said });
        let replies = [], note = "";
        try {
          const out = await simReplies(s, said, clock);
          replies = out.replies;
          if (out.mood) s.state = { ...s.state, mood: out.mood };
          for (const r of replies) s.transcript.push({ t: clock, who: "ai", from: r.from, text: r.text });
          if (s.state.aiError) s.state = { ...s.state, aiError: "" };
        } catch (e) {
          note = e.message;
          s.state = { ...s.state, aiError: e.message };
        }
        await pool.query("UPDATE sim_sessions SET transcript=$2, state=$3 WHERE id=$1", [b, JSON.stringify(s.transcript), JSON.stringify(s.state)]);
        return send(res, 200, { heard, said, events, replies, note, mood: s.state.mood || "" });
      }
      if (c === "end") {
        if (s.status === "running") {
          deliverDue(s, clock);
          s.transcript.push({ t: clock, who: "system", from: "", text: "Simulation ended." });
          await pool.query("UPDATE sim_sessions SET status='ended', ended_at=now(), transcript=$2, state=$3 WHERE id=$1", [b, JSON.stringify(s.transcript), JSON.stringify(s.state)]);
        }
        if (!s.transcript.some(e => e.who === "officer")) return send(res, 200, { session: sessJson((await pool.query("SELECT * FROM sim_sessions WHERE id = $1", [b])).rows[0], await names()), note: "Nothing was said, so there's nothing to grade." });
        let note = "";
        try {
          const grade = await gradeSession(s);
          await pool.query("UPDATE sim_sessions SET status='graded', grade=$2 WHERE id=$1", [b, JSON.stringify(grade)]);
        } catch (e) { note = e.message; }
        return send(res, 200, { session: sessJson((await pool.query("SELECT * FROM sim_sessions WHERE id = $1", [b])).rows[0], await names()), note });
      }
      if (c === "result") {
        if (s.mode === "practice") throw err(400, "Practice runs don't go on anyone's record.");
        if (!evalr && !acc.edit) throw err(403, "Only the evaluator can do that.");
        if (s.result_id) return send(res, 200, { id: s.result_id });
        const rub = s.state?.rubric;
        if (!rub?.program || !rub?.module) throw err(400, "This scenario isn't linked to a program module, so it can't become an evaluation. Use the debrief instead.");
        if (!s.grade) throw err(409, "Grade the run first.");
        const out = await saveResult(user, acc, { programId: rub.program.id, userId: s.user_id, candidateId: s.candidate_id, kind: s.mode, modules: [rub.module.key],
          scores: { [rub.module.key]: s.grade.scores.map(x => x.score) }, comments: { [rub.module.key]: s.grade.summary },
          observations: `Voice simulation: ${s.scenario.title} (${day(s.started_at)}).\n\n${transcriptText(s.transcript)}`.slice(0, 20000),
          feedback: [s.grade.summary, s.grade.strengths.length ? `Strengths:\n- ${s.grade.strengths.join("\n- ")}` : "", s.grade.improvements.length ? `To improve:\n- ${s.grade.improvements.join("\n- ")}` : ""].filter(Boolean).join("\n\n"),
          flags: s.grade.flags.map(f => ({ text: f, done: false })), ai: { source: "simulation", grade: s.grade }, sessionId: s.id });
        await pool.query("UPDATE sim_sessions SET result_id = $2 WHERE id = $1", [b, out.id]);
        return send(res, 200, { id: out.id });
      }
    }
  }
  throw err(404, "Not found");
}
async function anyEvaluator(user) {
  return (await pool.query(`SELECT 1 FROM eval_programs WHERE evaluators ? $1 UNION SELECT 1 FROM eval_candidates WHERE evaluators ? $1 LIMIT 1`, [user.id])).rows.length > 0;
}

// Save (create or update) an evaluation result; final = signed and locked
async function saveResult(user, acc, x) {
  const p = await getProgram(x.programId);
  if (!p) throw err(400, "Pick the evaluation program.");
  const kind = KINDS.includes(x.kind) ? x.kind : "formal";
  let cd = await getCandidate(x.candidateId);
  if (x.candidateId && !cd) throw err(400, "That working test period wasn't found.");
  if (cd && cd.program_id !== p.id) throw err(400, "That candidate is in a different program.");
  const userId = cd ? cd.user_id : x.userId;
  if (!isUuid(userId) || !(await userName(userId))) throw err(400, "Pick who is being evaluated.");
  if (kind === "practice") { if (userId !== user.id && !evaluatesCandidate(user, acc, p, cd)) throw err(403, "You can only record practice for yourself."); }
  else if (!evaluatesCandidate(user, acc, p, cd)) throw err(403, "Only an evaluator authorized for this program can record an official evaluation.");
  if (kind !== "practice" && userId === user.id && user.role !== "master") throw err(403, "You can't evaluate yourself.");
  if (!cd && kind !== "practice" && p.kind === "wtp") {
    cd = (await pool.query("SELECT * FROM eval_candidates WHERE program_id = $1 AND user_id = $2 AND status IN ('active','extended') ORDER BY start_date DESC LIMIT 1", [p.id, userId])).rows[0] || null;
  }
  const mods = arr(p.data.modules);
  const keys = [...new Set(arr(x.modules))].filter(k => mods.some(m => m.key === k));
  if (!keys.length) throw err(400, "Pick at least one module to score.");
  const scale = scaleOf(p);
  const scores = {}, comments = {};
  for (const k of keys) {
    const m = mods.find(mm => mm.key === k);
    scores[k] = m.elements.map((e, i) => {
      const v = arr(x.scores?.[k])[i];
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < scale.min || n > scale.max) throw err(400, `Scores go from ${scale.min} to ${scale.max}.`);
      return n;
    });
    comments[k] = clean(x.comments?.[k], 4000);
  }
  const final = x.final === true;
  const sig = signature(x.signature);
  const flags = arr(x.flags).slice(0, 30).map(f => ({ text: clean(f.text ?? f, 600), done: f.done === true })).filter(f => f.text);
  if (final) {
    for (const k of keys) if (scores[k].some(v => v === null)) throw err(400, `Score every element in ${k} before signing.`);
    if (kind !== "practice" && !sig) throw err(400, "Sign the evaluation to make it official.");
    if (flags.some(f => !f.done)) throw err(400, "Check off (or remove) the items flagged for verification before signing.");
  }
  const date = DAY.test(x.date || "") ? x.date : day(new Date());
  const pct = final ? resultPct(p, { modules: keys, scores }).pct : null;
  let id = x.id;
  await tx(async c2 => {
    if (isUuid(id)) {
      const old = (await c2.query("SELECT * FROM eval_results WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!old) throw err(404, "That evaluation wasn't found.");
      if (old.status === "final") throw err(409, "This evaluation is signed and locked.");
      if (old.evaluator_id !== user.id && !evaluatesCandidate(user, acc, p, cd)) throw err(403, "Only the evaluator can change this draft.");
      await c2.query(`UPDATE eval_results SET kind=$2, modules=$3, scores=$4, comments=$5, observations=$6, feedback=$7, flags=$8, eval_date=$9, status=$10,
        evaluator_id=$11, evaluator_name=$12, signature=$13, signed_at=$14, pct=$15, ai=COALESCE($16, ai), candidate_id=$17, updated_at=now() WHERE id=$1`,
        [id, kind, JSON.stringify(keys), JSON.stringify(scores), JSON.stringify(comments), clean(x.observations, 20000), clean(x.feedback, 8000), JSON.stringify(flags), date,
          final ? "final" : "draft", user.id, user.name, final ? sig : null, final ? new Date() : null, pct, x.ai ? JSON.stringify(x.ai) : null, cd?.id || null]);
    } else {
      id = crypto.randomUUID();
      await c2.query(`INSERT INTO eval_results (id, program_id, user_id, candidate_id, kind, modules, scores, comments, observations, feedback, flags, eval_date, status,
        evaluator_id, evaluator_name, signature, signed_at, pct, ai, session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [id, p.id, userId, cd?.id || null, kind, JSON.stringify(keys), JSON.stringify(scores), JSON.stringify(comments), clean(x.observations, 20000), clean(x.feedback, 8000),
          JSON.stringify(flags), date, final ? "final" : "draft", user.id, user.name, final ? sig : null, final ? new Date() : null, pct, x.ai ? JSON.stringify(x.ai) : null,
          isUuid(x.sessionId) ? x.sessionId : null]);
    }
    if (final && kind !== "practice") await audit(c2, user, "Signed evaluation", `${await userName(userId)}: ${p.name} ${keys.join(", ")} (${kind}) ${pct}%`);
  });
  if (final && kind !== "practice") await notify(user, [userId], `Evaluation signed: ${p.name}`,
    `${user.name} signed your ${kind === "retest" ? "retest" : "evaluation"} for ${p.name} (${keys.map(k => `${k} – ${mods.find(m => m.key === k).title}`).join("; ")}): ${pct}%.\n\nRead the scores and feedback in ${brand().productName}: Main menu › Evaluations.`);
  return { id, pct };
}
