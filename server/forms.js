// Forms: definitions (editable by master admins), submissions, approvals,
// "reviewed" marks, and cases (an injury report plus its follow-up statements).
//
// Who can see a submission:
//   full access (all answers, sensitive ones shown): master admins, anyone given
//     access to that form (form_viewers, '*' = all forms), the form's required
//     recipients, and, for a case, anyone with that access to the form that opened it
//   limited (sensitive answers masked): the person it's filed under (unless the form
//     hides it from them), whoever submitted it, and its approvers
// Anonymous forms never record who submitted them.
import fs from "node:fs";
import { brand, brandText, brandDeep } from "./brand.js";
import path from "node:path";
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { HttpError, isUuid, ROLE_LABEL } from "./collections.js";
import { hasLegacy } from "./access.js";
import { FORM_SEEDS } from "./formSeeds.js";
import { MORE_FORM_SEEDS } from "./formSeeds2.js";
import { departmentContent, DEMO_FORM_SEEDS } from "./demoSeeds.js";

const bad = msg => new HttpError(400, msg);
const forbid = msg => new HttpError(403, msg);
const TYPES = new Set(["file", "heading", "paragraph", "text", "textarea", "number", "date", "time", "select", "radio",
  "checkboxes", "yesno", "phone", "email", "address", "person", "people", "ssn", "acknowledge", "signature"]);
const NO_VALUE = new Set(["heading", "paragraph"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const iso = v => (v ? new Date(v).toISOString() : null);
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max);

// ---------------------------------------------------------------------
// Encryption for sensitive answers (AES-256-GCM). The key lives outside the
// database: FORMS_KEY in .env, or a key file created on first use.
// Back the key file up with the database; without it, sensitive answers can't be read.
// ---------------------------------------------------------------------
let KEY = null;
function key() {
  if (KEY) return KEY;
  if (process.env.FORMS_KEY) {
    KEY = Buffer.from(process.env.FORMS_KEY, "base64");
  } else {
    const file = path.resolve(process.env.FORMS_KEY_FILE || "secrets/forms.key");
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
      console.log(`Created the forms encryption key at ${file}. Back this file up with the database.`);
    }
    KEY = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  }
  if (KEY.length !== 32) throw new Error("The forms encryption key must be 32 bytes (base64).");
  return KEY;
}
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
// Files and other binary data: iv (12) + tag (16) + ciphertext
export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
export function decryptBuffer(raw) {
  const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}
export function decrypt(text) {
  if (!text) return {};
  const raw = Buffer.from(String(text).replace(/^v1:/, ""), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
}
const isSensitive = f => f.type === "ssn" || !!f.sensitive;
function mask(f, v) {
  if (v === undefined || v === null || v === "") return v;
  if (f.type === "ssn") return `***-**-${String(v).slice(-4)}`;
  return "Hidden";
}

// ---------------------------------------------------------------------
// Seeds and definitions
// ---------------------------------------------------------------------
export async function seedForms() {
  // St. George's own forms only on a department install; sandboxes / other departments get generic starters
  for (const f0 of departmentContent() ? [...FORM_SEEDS, ...MORE_FORM_SEEDS] : DEMO_FORM_SEEDS) {
    const f = brandDeep(f0);   // another department / sandbox: its own names in the text
    await pool.query(
      `INSERT INTO form_definitions (id, key, title, category, description, fields, settings, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (key) DO NOTHING`,
      [crypto.randomUUID(), f.key, f.title, f.category, f.description, JSON.stringify(f.fields), JSON.stringify(f.settings), f.sort || 100]);
  }
  key();   // make sure the encryption key exists
  await upgradeFacilityForm();
}

// The Facility & Resource Request used to take "Times needed" as text; bookings need real start and
// end times. Done once, leaving any other edits to the form alone.
async function upgradeFacilityForm() {
  const { BOOKING } = await import("./formSeeds2.js");
  const d = (await pool.query("SELECT id, fields, settings FROM form_definitions WHERE key = 'facility_request'")).rows[0];
  if (!d || d.settings?.booking) return;
  const fields = [];
  for (const f of d.fields || []) {
    if (f.key === "times") {
      fields.push({ key: "start_time", type: "time", required: true, label: "Start time", help: "The room is held from this time each day" },
        { key: "end_time", type: "time", required: true, label: "End time" });
    } else fields.push(f);
  }
  if (!fields.some(f => f.key === "start_time")) return;      // someone rebuilt the form: leave it
  await pool.query("UPDATE form_definitions SET fields = $2, settings = $3, version = version + 1, updated_at = now() WHERE id = $1",
    [d.id, JSON.stringify(fields), JSON.stringify({ ...d.settings, booking: BOOKING })]);
  console.log("[Forms] Facility & Resource Request now books rooms (start/end times)");
}

const defJson = d => ({
  id: d.id, key: d.key, title: d.title, category: d.category, description: d.description,
  fields: d.fields, settings: d.settings, version: d.version, active: d.active, sort: d.sort_order,
  updatedAt: iso(d.updated_at),
});
async function allDefs(c = pool) {
  const r = await c.query("SELECT * FROM form_definitions ORDER BY category, sort_order, title");
  return new Map(r.rows.map(d => [d.key, d]));
}

// Check a field list from the form builder
function cleanFields(fields) {
  if (!Array.isArray(fields) || fields.length > 300) throw bad("A form needs a list of fields (up to 300).");
  const keys = new Set();
  return fields.map(f => {
    const key = clean(f.key, 50);
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(key)) throw bad(`Field key "${key}" must be lowercase letters, numbers and _.`);
    if (keys.has(key)) throw bad(`Two fields share the key "${key}".`);
    keys.add(key);
    if (!TYPES.has(f.type)) throw bad(`Unknown field type "${f.type}".`);
    const out = { key, type: f.type, label: clean(f.label, 1000) || key };
    if (f.help) out.help = clean(f.help, 1000);
    if (f.required && !NO_VALUE.has(f.type)) out.required = true;
    if (["select", "radio", "checkboxes"].includes(f.type)) {
      out.options = [...new Set((f.options || []).map(o => clean(o, 200)).filter(Boolean))].slice(0, 100);
      if (!out.options.length) throw bad(`"${out.label}" needs at least one option.`);
    }
    if (f.showIf && f.showIf.field) {
      out.showIf = { field: clean(f.showIf.field, 50), equals: clean(f.showIf.equals, 200) };
      if (Array.isArray(f.showIf.any) && f.showIf.any.length) out.showIf.any = f.showIf.any.map(x => clean(x, 200)).slice(0, 50);
    }
    if (f.prefill) out.prefill = clean(f.prefill, 80);
    if (f.default !== undefined && f.default !== null && f.default !== "") out.default = typeof f.default === "string" ? clean(f.default, 2000) : f.default;
    if (f.sensitive && !NO_VALUE.has(f.type)) out.sensitive = true;
    return out;
  });
}

// ---------------------------------------------------------------------
// Who can do what
// ---------------------------------------------------------------------
async function accessFor(user) {
  const r = await pool.query("SELECT form_key FROM form_viewers WHERE user_id = $1", [user.id]);
  // Forms admins (a delegated permission) build and edit forms; seeing everything filed stays with masters
  const formsAdmin = user.role === "master" || await hasLegacy(pool, user, "forms_admin");
  return { user, master: user.role === "master", formsAdmin, keys: new Set(r.rows.map(x => x.form_key)) };
}
// Full access to everything filed with this form
function fullFor(acc, def) {
  if (!def) return acc.master;
  return acc.master || acc.keys.has("*") || acc.keys.has(def.key) || (def.settings?.recipients || []).includes(acc.user.id);
}
async function caseDef(c, caseRow, defs) {
  return caseRow ? defs.get(caseRow.form_key) : null;
}
async function submissionAccess(c, acc, s, defs) {
  const def = defs.get(s.form_key);
  let full = fullFor(acc, def);
  if (!full && s.case_id) {
    const cs = (await c.query("SELECT * FROM form_cases WHERE id = $1", [s.case_id])).rows[0];
    full = fullFor(acc, await caseDef(c, cs, defs));
  }
  if (full) return "full";
  const me = acc.user.id;
  const snap = s.definition?.settings || {};
  if (s.subject_user_id === me && snap.subjectCanView !== false) return "limited";
  if (s.submitted_by === me) return "limited";
  const appr = await c.query("SELECT 1 FROM form_approvals WHERE submission_id = $1 AND user_id = $2", [s.id, me]);
  if (appr.rowCount) return "limited";
  return null;
}
async function caseAccess(c, acc, cs, defs) {
  if (fullFor(acc, defs.get(cs.form_key))) return "manage";
  if (cs.subject_user_id === acc.user.id) return "subject";
  return null;
}
// May this person complete this task?
function canDoTask(acc, task, cs, defs, canManage) {
  if (task.status !== "pending") return false;
  if (task.assigned_to === acc.user.id) return true;
  if (canManage) return true;   // e.g. record an outside witness's statement
  if (!task.assigned_to) {
    const fu = (defs.get(cs.form_key)?.settings?.case?.followUps || []).find(f => f.form === task.form_key);
    if (fu && (fu.users || []).includes(acc.user.id)) return true;
  }
  return false;
}

async function names(c, ids) {
  const list = [...new Set(ids.filter(isUuid))];
  if (!list.length) return new Map();
  const r = await c.query(`SELECT id, full_name FROM users WHERE id IN (${list.map((_, i) => `$${i + 1}`).join(",")})`, list);
  return new Map(r.rows.map(u => [u.id, u.full_name]));
}
async function audit(c, user, action, detail, anonymous = false) {
  await c.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Forms', $4, $5)`,
    anonymous ? [null, "Anonymous", "", action, detail] : [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, detail]);
}

// ---------------------------------------------------------------------
// Validation of answers against the form's fields
// ---------------------------------------------------------------------
function visible(f, data) {
  if (!f.showIf) return true;
  const v = data[f.showIf.field];
  const want = Array.isArray(f.showIf.any) && f.showIf.any.length ? f.showIf.any : [f.showIf.equals];
  return Array.isArray(v) ? v.some(x => want.includes(x)) : want.includes(String(v ?? ""));
}
async function validate(c, fields, input, user) {
  const data = {}, secret = {}, errors = [];
  const userIds = [], fileIds = [];
  // Visibility uses the accepted answers so far, so a question under a hidden question stays hidden
  for (const f of fields) {
    if (NO_VALUE.has(f.type) || !visible(f, { ...data, ...secret })) continue;
    let v = input[f.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length) ||
      (f.type === "acknowledge" && v !== true) || (f.type === "address" && !(v && (v.street || v.city)));
    if (empty) { if (f.required) errors.push(f.label); continue; }
    switch (f.type) {
      case "text": case "phone": case "email": v = clean(v, 1000); break;
      case "textarea": v = clean(v, 20000); break;
      case "number": v = Number(v); if (!isFinite(v)) { errors.push(f.label); continue; } break;
      case "date": v = clean(v, 10); if (!DAY.test(v)) { errors.push(f.label); continue; } break;
      case "time": v = clean(v, 5); if (!HHMM.test(v)) { errors.push(f.label); continue; } break;
      case "select": case "radio": v = clean(v, 200); if (!f.options.includes(v)) { errors.push(f.label); continue; } break;
      case "yesno": v = v === "Yes" ? "Yes" : v === "No" ? "No" : null; if (!v) { errors.push(f.label); continue; } break;
      case "checkboxes": v = (Array.isArray(v) ? v : [v]).map(x => clean(x, 200)).filter(x => f.options.includes(x)); if (!v.length && f.required) { errors.push(f.label); continue; } break;
      case "address": v = { street: clean(v.street, 200), city: clean(v.city, 100), state: clean(v.state, 40), zip: clean(v.zip, 20) }; break;
      case "person": if (!isUuid(v)) { errors.push(f.label); continue; } userIds.push(v); break;
      case "people": v = (Array.isArray(v) ? v : []).filter(isUuid).slice(0, 50); userIds.push(...v); if (!v.length && f.required) { errors.push(f.label); continue; } break;
      case "ssn": v = String(v).replace(/\D/g, ""); if (v.length !== 9) { errors.push(f.label); continue; } v = `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}`; break;
      case "acknowledge": v = true; break;
      case "file":
        v = (Array.isArray(v) ? v : []).filter(x => isUuid(x?.id)).slice(0, 10).map(x => x.id);
        if (!v.length) { if (f.required) errors.push(f.label); continue; }
        fileIds.push(...v);
        break;
      case "signature":
        v = String(v);
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 400000) { errors.push(f.label); continue; }
        break;
    }
    if (isSensitive(f)) secret[f.key] = v; else data[f.key] = v;
  }
  if (userIds.length) {
    const found = await names(c, userIds);
    for (const id of userIds) if (!found.has(id)) errors.push("A chosen person isn't on the roster");
  }
  // Files: must be this person's uploads not yet attached to anything
  const fileMeta = new Map();
  if (fileIds.length) {
    const ids = [...new Set(fileIds)];
    const r = await c.query(`SELECT id, name, mime, size FROM form_files WHERE id IN (${ids.map((_, i) => `$${i + 2}`).join(",")}) AND uploaded_by = $1 AND submission_id IS NULL`, [user.id, ...ids]);
    for (const x of r.rows) fileMeta.set(x.id, { id: x.id, name: x.name, type: x.mime, size: x.size });
    if (fileMeta.size !== new Set(fileIds).size) errors.push("An attached file is missing; attach it again");
  }
  for (const f of fields) {
    if (f.type !== "file") continue;
    for (const box of [data, secret]) if (Array.isArray(box[f.key])) box[f.key] = box[f.key].map(id => fileMeta.get(id)).filter(Boolean);
  }
  if (errors.length) throw bad(`Please complete: ${[...new Set(errors)].slice(0, 6).join("; ")}${errors.length > 6 ? "…" : ""}`);
  return { data, secret, fileIds: [...fileMeta.keys()] };
}

// ---------------------------------------------------------------------
// Shapes sent to the browser
// ---------------------------------------------------------------------
async function submissionJson(c, s, level, nameMap) {
  const fields = s.definition.fields || [];
  let secret = {};
  if (s.secret) secret = decrypt(s.secret);
  const data = { ...s.data };
  for (const f of fields) {
    if (!isSensitive(f) || !(f.key in secret)) continue;
    data[f.key] = level === "full" ? secret[f.key] : mask(f, secret[f.key]);
  }
  const appr = (await c.query("SELECT * FROM form_approvals WHERE submission_id = $1", [s.id])).rows;
  const revs = (await c.query("SELECT * FROM form_reviews WHERE submission_id = $1 ORDER BY reviewed_at", [s.id])).rows;
  const more = await names(c, [...appr.map(a => a.user_id), ...revs.map(r => r.user_id), s.subject_user_id]);
  return {
    id: s.id, formKey: s.form_key, formTitle: s.form_title, fields, settings: s.definition.settings || {},
    subjectId: s.subject_user_id, subjectName: s.subject_user_id ? (more.get(s.subject_user_id) || "") : "",
    submittedById: s.submitted_by, submittedByName: s.submitted_by_name, anonymous: !s.submitted_by && !s.submitted_by_name,
    data, caseId: s.case_id, status: s.status, submittedAt: iso(s.submitted_at), access: level,
    approvals: appr.map(a => ({ userId: a.user_id, name: more.get(a.user_id) || "", decision: a.decision, note: a.note, decidedAt: iso(a.decided_at) })),
    reviews: revs.map(r => ({ userId: r.user_id, name: more.get(r.user_id) || "", note: r.note, reviewedAt: iso(r.reviewed_at) })),
    hasPdf: !!s.definition.settings?.pdf,
    stage: s.stage || "", stageAt: iso(s.stage_at), stageByName: s.stage_by_name || "", stageNote: s.stage_note || "",
  };
}
// How many of a limited item a submission's answers add up to.
// Each count entry: { field, option, qty } -> the option is checked in field; qty field holds how many (default 1).
// Steps that finish a form's progress (marked done, or else the last step)
const FILE_MAX = 10 * 1024 * 1024;

export function doneStages(def) {
  const st = def?.settings?.stages || [];
  const done = st.filter(x => x.done).map(x => x.label);
  return done.length ? done : st.length ? [st[st.length - 1].label] : [];
}
export function countLimit(limit, data) {
  let n = 0;
  for (const c of limit.count || []) {
    const v = data?.[c.field];
    const on = Array.isArray(v) ? v.includes(c.option) : v === c.option;
    if (on) n += c.qty ? (Number(data[c.qty]) || 0) : 1;
  }
  return n;
}
const submissionMeta = (s, nameMap) => ({
  id: s.id, formKey: s.form_key, formTitle: s.form_title, subjectId: s.subject_user_id,
  subjectName: s.subject_user_id ? (nameMap.get(s.subject_user_id) || "") : "",
  submittedByName: s.submitted_by_name, caseId: s.case_id, status: s.status, submittedAt: iso(s.submitted_at),
  stage: s.stage || "", stageAt: iso(s.stage_at),
});
function taskJson(t, nameMap, cs) {
  return {
    id: t.id, caseId: t.case_id, formKey: t.form_key, label: t.label, assignedTo: t.assigned_to,
    assigneeName: t.assigned_to ? (nameMap.get(t.assigned_to) || t.assignee_name) : t.assignee_name,
    status: t.status, submissionId: t.submission_id, createdAt: iso(t.created_at), completedAt: iso(t.completed_at),
    caseTitle: cs ? cs.title : undefined,
  };
}

// The facts a follow-up form starts with. The opening report's answers are
// included only for people with full access (they hold sensitive details).
async function caseContext(c, cs, full) {
  const subj = cs.subject_user_id ? (await names(c, [cs.subject_user_id])).get(cs.subject_user_id) : "";
  const ctx = { subjectName: subj || "", date: cs.summary.date || "", time: cs.summary.time || "", location: cs.summary.location || "", initial: {} };
  if (full) {
    const open = (await c.query("SELECT * FROM form_submissions WHERE case_id = $1 AND form_key = $2 ORDER BY submitted_at LIMIT 1", [cs.id, cs.form_key])).rows[0];
    if (open) ctx.initial = { ...open.data, ...decrypt(open.secret) };
  }
  return ctx;
}

// ---------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------
async function submit(user, body) {
  return tx(async c => {
    const defs = await allDefs(c);
    const def = defs.get(clean(body.formKey, 60));
    if (!def || !def.active) throw bad("That form isn't available.");
    const st = def.settings || {};
    const acc = await accessFor(user);

    // Follow-up forms are filled from a case task
    let task = null, cs = null;
    if (body.taskId) {
      if (!isUuid(body.taskId)) throw bad("Bad task");
      task = (await c.query("SELECT * FROM form_tasks WHERE id = $1 FOR UPDATE", [body.taskId])).rows[0];
      if (!task || task.form_key !== def.key) throw bad("That task doesn't match this form.");
      cs = (await c.query("SELECT * FROM form_cases WHERE id = $1", [task.case_id])).rows[0];
      const manage = (await caseAccess(c, acc, cs, defs)) === "manage";
      if (!canDoTask(acc, task, cs, defs, manage)) throw forbid("This task isn't yours, or it's already done.");
    } else if (st.followUpOnly) {
      throw bad("This form is completed from a case.");
    }

    // Whose file it goes in
    let subject = null;
    if (st.anonymous) subject = null;
    else if (st.subject === "self") subject = user.id;
    else if (st.subject === "choose") subject = isUuid(body.subjectId) ? body.subjectId : user.id;
    else if (st.subject === "case") subject = cs ? cs.subject_user_id : null;
    if (subject && !(await names(c, [subject])).has(subject)) throw bad("Choose who this form is about.");

    const { data, secret, fileIds } = await validate(c, def.fields, body.data || {}, user);

    // Approvers
    let approvers = [];
    if (st.approval?.enabled) {
      approvers = [...new Set((body.approverIds || []).filter(isUuid))].filter(id => id !== user.id).slice(0, 5);
      if (!approvers.length) throw bad(`Choose the ${(st.approval.label || "approver").toLowerCase()} who needs to approve this.`);
      const found = await names(c, approvers);
      if (approvers.some(id => !found.has(id))) throw bad("A chosen approver isn't on the roster.");
    }

    const id = crypto.randomUUID();
    const snapshot = { fields: def.fields, settings: { subjectCanView: st.subjectCanView !== false, approval: st.approval || null, anonymous: !!st.anonymous, pdf: st.pdf || null }, version: def.version };
    await c.query(
      `INSERT INTO form_submissions (id, form_key, form_title, definition, subject_user_id, submitted_by, submitted_by_name, data, secret, case_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, def.key, def.title, JSON.stringify(snapshot), subject, st.anonymous ? null : user.id, st.anonymous ? "" : user.name,
        JSON.stringify(data), Object.keys(secret).length ? encrypt(secret) : null, cs ? cs.id : null,
        approvers.length ? "pending_approval" : "submitted"]);
    for (const a of approvers) await c.query("INSERT INTO form_approvals (submission_id, user_id) VALUES ($1, $2)", [id, a]);
    if (fileIds.length) await c.query(`UPDATE form_files SET submission_id = $1 WHERE id IN (${fileIds.map((_, i) => `$${i + 2}`).join(",")})`, [id, ...fileIds]);

    if (task) {
      await c.query("UPDATE form_tasks SET status = 'done', submission_id = $2, completed_at = now() WHERE id = $1", [task.id, id]);
    }
    // Room bookings (Facility & Resource Request): hold the rooms now, or refuse if they're taken
    if (st.booking) {
      const { bookFromSubmission } = await import("./bookings.js");
      await bookFromSubmission(c, def, data, id, user);
    }

    // Opening a case (e.g. an injury report) creates its follow-up tasks
    let caseId = null;
    if (st.case) {
      caseId = crypto.randomUUID();
      const sum = {};
      for (const [k, fieldKey] of Object.entries(st.case.summary || {})) sum[k] = data[fieldKey] ?? "";
      const subjName = subject ? (await names(c, [subject])).get(subject) : "";
      const when = sum.date ? new Date(`${sum.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
      await c.query(
        `INSERT INTO form_cases (id, kind, form_key, subject_user_id, title, summary, opened_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [caseId, st.case.kind || "case", def.key, subject, `${st.case.name || def.title} — ${subjName}${when ? `, ${when}` : ""}`, JSON.stringify(sum), user.id]);
      await c.query("UPDATE form_submissions SET case_id = $2 WHERE id = $1", [id, caseId]);
      for (const fu of st.case.followUps || []) {
        const fdef = defs.get(fu.form);
        if (!fdef || !fdef.active) continue;
        const add = async (assignee, nm) => c.query(
          `INSERT INTO form_tasks (id, case_id, form_key, label, assigned_to, assignee_name) VALUES ($1,$2,$3,$4,$5,$6)`,
          [crypto.randomUUID(), caseId, fu.form, fu.label || fdef.title, assignee, nm || ""]);
        if (fu.assign === "subject") { if (subject) await add(subject, subjName); }
        else if (String(fu.assign).startsWith("field:")) {
          const v = data[fu.assign.slice(6)];
          const ids = (Array.isArray(v) ? v : [v]).filter(isUuid);
          const nm = await names(c, ids);
          for (const uid of ids) await add(uid, nm.get(uid));
        } else if (fu.assign === "users") {
          const list = (fu.users || []).filter(isUuid);
          const nm = await names(c, list);
          if (list.length === 1) await add(list[0], nm.get(list[0]));
          else await add(null, list.length ? list.map(x => nm.get(x)).filter(Boolean).join(" or ") : "");
        }
      }
    }

    await audit(c, user, task ? "Completed case form" : "Submitted form",
      `${def.title}${subject && !st.anonymous ? ` — ${(await names(c, [subject])).get(subject)}` : ""}`, !!st.anonymous);
    return { id, caseId: caseId || (cs && cs.id) || null };
  });
}

// ---------------------------------------------------------------------
// HTTP: /api/forms/...
// ---------------------------------------------------------------------
export async function handleForms(req, res, parts, user, send, jsonBody) {
  const [, , a, b, c2] = parts;
  const acc = await accessFor(user);
  const body = req.method === "GET" ? {} : await jsonBody(req);
  const defs = await allDefs();

  // ---- Definitions
  if (a === "definitions") {
    if (req.method === "GET" && !b) {
      const list = [...defs.values()].filter(d => d.active || acc.formsAdmin).map(defJson);
      return send(res, 200, { definitions: list, canManage: acc.formsAdmin, canGrantAccess: acc.master, myAccess: [...acc.keys] });
    }
    if (!acc.formsAdmin) throw forbid("Only master admins and forms admins can change forms.");
    if (req.method === "POST" && !b) {
      const fields = cleanFields(body.fields);
      const title = clean(body.title, 200);
      if (!title) throw bad("Give the form a title.");
      const existing = isUuid(body.id) ? (await pool.query("SELECT * FROM form_definitions WHERE id = $1", [body.id])).rows[0] : null;
      const keyName = existing ? existing.key : clean(body.key, 60) || title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50);
      if (!/^[a-z][a-z0-9_]{1,59}$/.test(keyName)) throw bad("The form's short name must be lowercase letters, numbers and _.");
      // Settings the builder may change; case and PDF wiring is kept from the existing form
      const old = existing ? existing.settings : {};
      const s = body.settings || {};
      const settings = {
        ...old,
        subject: ["self", "choose", "none", "case"].includes(s.subject) ? s.subject : (old.subject || "self"),
        subjectLabel: clean(s.subjectLabel ?? old.subjectLabel ?? "", 200) || undefined,
        subjectCanView: s.subjectCanView !== false,
        anonymous: !!s.anonymous,
        recipients: (s.recipients || []).filter(isUuid).slice(0, 50),
        approval: s.approval?.enabled ? { enabled: true, label: clean(s.approval.label, 80) || "Approver", help: clean(s.approval.help, 300) } : null,
        stages: Array.isArray(s.stages)
          ? s.stages.map(x => ({ label: clean(x?.label, 80), notify: !!x?.notify, done: !!x?.done })).filter(x => x.label).slice(0, 10)
          : (old.stages || []),
      };
      if (settings.anonymous) settings.subject = "none";
      if (old.case && Array.isArray(s.caseUsers)) {
        settings.case = { ...old.case, followUps: old.case.followUps.map(fu => fu.assign === "users" ? { ...fu, users: (s.caseUsers.find(x => x.form === fu.form)?.users || []).filter(isUuid) } : fu) };
      }
      const changed = !existing || JSON.stringify(existing.fields) !== JSON.stringify(fields);
      const id = existing ? existing.id : crypto.randomUUID();
      await tx(async c => {
        if (existing) {
          await c.query(
            `UPDATE form_definitions SET title=$2, category=$3, description=$4, fields=$5, settings=$6, version = version + $7,
                    active=$8, sort_order=$9, updated_by=$10, updated_at=now() WHERE id=$1`,
            [id, title, clean(body.category, 100) || "Employee Forms", clean(body.description, 2000), JSON.stringify(fields), JSON.stringify(settings),
              changed ? 1 : 0, body.active !== false, Number(body.sort) || 100, user.id]);
        } else {
          if (defs.has(keyName)) throw bad("A form with that short name already exists.");
          await c.query(
            `INSERT INTO form_definitions (id, key, title, category, description, fields, settings, sort_order, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [id, keyName, title, clean(body.category, 100) || "Employee Forms", clean(body.description, 2000), JSON.stringify(fields), JSON.stringify(settings), Number(body.sort) || 100, user.id]);
        }
        await audit(c, user, existing ? "Changed form" : "Created form", title);
      });
      const d = (await pool.query("SELECT * FROM form_definitions WHERE id = $1", [id])).rows[0];
      return send(res, 200, { definition: defJson(d) });
    }
  }

  // ---- Who can see all submissions of which forms (master)
  if (a === "access") {
    if (!acc.master) throw forbid("Only master admins can change form access.");
    if (req.method === "GET") {
      const r = await pool.query("SELECT user_id, form_key FROM form_viewers ORDER BY form_key");
      return send(res, 200, { access: r.rows.map(x => ({ userId: x.user_id, formKey: x.form_key })) });
    }
    if (req.method === "POST") {
      if (!isUuid(body.userId)) throw bad("Bad user");
      const want = [...new Set((body.formKeys || []).map(String))].filter(k => k === "*" || defs.has(k));
      await tx(async c => {
        await c.query("DELETE FROM form_viewers WHERE user_id = $1", [body.userId]);
        for (const k of want) await c.query("INSERT INTO form_viewers (user_id, form_key) VALUES ($1, $2)", [body.userId, k]);
        const nm = (await names(c, [body.userId])).get(body.userId);
        await audit(c, user, "Changed form access", `${nm}: ${want.length ? want.map(k => k === "*" ? "all forms" : defs.get(k).title).join(", ") : "none"}`);
      });
      return send(res, 200, { ok: true });
    }
  }

  // ---- Attached files
  if (a === "files") {
    if (req.method === "POST" && !b) {
      const name = clean(body.name, 200).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") || "file";
      const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ""));
      if (!m) throw bad("That file couldn't be read.");
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > FILE_MAX) throw bad(`Files can be up to ${Math.round(FILE_MAX / 1048576)} MB.`);
      const id = crypto.randomUUID();
      await pool.query("DELETE FROM form_files WHERE submission_id IS NULL AND created_at < now() - interval '1 day'");
      await pool.query("INSERT INTO form_files (id, uploaded_by, name, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, user.id, name, m[1].toLowerCase(), buf.length, "\\x" + buf.toString("hex")]);
      return send(res, 200, { id, name, type: m[1].toLowerCase(), size: buf.length });
    }
    if (req.method === "GET" && isUuid(b)) {
      const f = (await pool.query("SELECT * FROM form_files WHERE id = $1", [b])).rows[0];
      if (!f) throw new HttpError(404, "That file wasn't found.");
      if (f.submission_id) {
        const s = (await pool.query("SELECT * FROM form_submissions WHERE id = $1", [f.submission_id])).rows[0];
        if (!s || !(await submissionAccess(pool, acc, s, defs))) throw forbid("You don't have access to this file.");
      } else if (f.uploaded_by !== user.id) throw forbid("You don't have access to this file.");
      const bytes = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data).replace(/^\\x/, ""), "hex");
      const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime);
      res.writeHead(200, {
        "Content-Type": inline ? f.mime : "application/octet-stream", "Content-Length": bytes.length,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w. -]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      });
      return res.end(bytes);
    }
  }

  // ---- Yearly limits (e.g. uniform items): what I've ordered this calendar year
  if (a === "limits" && req.method === "GET") {
    const def = defs.get(b);
    const limits = def?.settings?.limits || [];
    if (!limits.length) return send(res, 200, { limits: [] });
    const rows = (await pool.query(
      `SELECT data FROM form_submissions WHERE form_key = $1 AND subject_user_id = $2 AND status <> 'denied'
          AND submitted_at >= date_trunc('year', now())`, [def.key, user.id])).rows;
    return send(res, 200, {
      limits: limits.map(l => ({ label: l.label, max: l.max, used: rows.reduce((n, r) => n + countLimit(l, r.data), 0) })),
    });
  }

  // ---- Submit
  if (a === "submit" && req.method === "POST") {
    const r = await submit(user, body);
    if (r.caseId) {
      const cs = (await pool.query("SELECT * FROM form_cases WHERE id = $1", [r.caseId])).rows[0];
      r.canViewCase = !!(cs && (await caseAccess(pool, acc, cs, await allDefs())));
    }
    return send(res, 200, r);
  }

  // ---- What's waiting for me
  if (a === "inbox" && req.method === "GET") {
    const tasks = (await pool.query(
      `SELECT t.*, cs.title AS case_title, cs.form_key AS case_form FROM form_tasks t JOIN form_cases cs ON cs.id = t.case_id
        WHERE t.status = 'pending' AND cs.status = 'open' ORDER BY t.created_at`)).rows;
    const mine = [];
    for (const t of tasks) {
      if (t.assigned_to === user.id) { mine.push(t); continue; }
      if (!t.assigned_to) {
        const fu = (defs.get(t.case_form)?.settings?.case?.followUps || []).find(f => f.form === t.form_key);
        if (fu && (fu.users || []).includes(user.id)) mine.push(t);
      }
    }
    const approvals = (await pool.query(
      `SELECT s.* FROM form_approvals a JOIN form_submissions s ON s.id = a.submission_id
        WHERE a.user_id = $1 AND a.decision = 'pending' ORDER BY s.submitted_at`, [user.id])).rows;
    // Required recipients: submissions of their forms they haven't marked reviewed
    const recipientKeys = [...defs.values()].filter(d => (d.settings?.recipients || []).includes(user.id)).map(d => d.key);
    // Until someone is chosen to handle a form with progress steps, its submissions go to master admins
    const unassigned = new Set(acc.master ? [...defs.values()]
      .filter(d => d.active && !d.settings?.followUpOnly && (d.settings?.stages || []).length && !(d.settings?.recipients || []).length)
      .map(d => d.key) : []);
    for (const k of unassigned) if (!recipientKeys.includes(k)) recipientKeys.push(k);
    let toReview = [];
    // Forms with progress steps stay in the queue until they reach the last step
    const stageKeys = recipientKeys.filter(k => (defs.get(k).settings?.stages || []).length);
    const plainKeys = recipientKeys.filter(k => !stageKeys.includes(k));
    for (const k of stageKeys) {
      const done = doneStages(defs.get(k));
      toReview.push(...(await pool.query(
        `SELECT s.* FROM form_submissions s WHERE s.form_key = $1 AND s.status <> 'denied'
            AND COALESCE(s.stage, '') NOT IN (${done.map((_, i) => `$${i + 2}`).join(",")}) AND s.submitted_at > now() - interval '365 days'
          ORDER BY s.submitted_at LIMIT 200`, [k, ...done])).rows);
    }
    if (plainKeys.length) {
      toReview.push(...(await pool.query(
        `SELECT s.* FROM form_submissions s
          WHERE s.form_key IN (${plainKeys.map((_, i) => `$${i + 2}`).join(",")})
            AND NOT EXISTS (SELECT 1 FROM form_reviews r WHERE r.submission_id = s.id AND r.user_id = $1)
            AND s.submitted_at > now() - interval '180 days'
          ORDER BY s.submitted_at DESC LIMIT 200`, [user.id, ...plainKeys])).rows);
    }
    const updates = (await pool.query(
      `SELECT * FROM form_submissions WHERE stage_seen = false AND (submitted_by = $1 OR subject_user_id = $1)
        ORDER BY stage_at DESC LIMIT 50`, [user.id])).rows;
    const recent = (await pool.query(
      `SELECT * FROM form_submissions WHERE submitted_by = $1 ORDER BY submitted_at DESC LIMIT 30`, [user.id])).rows;
    const nm = await names(pool, [...approvals, ...toReview, ...recent].map(s => s.subject_user_id).concat(mine.map(t => t.assigned_to)));
    // Where each of my submissions stands
    const reviewed = new Set();
    if (recent.length) {
      const r = await pool.query(`SELECT DISTINCT submission_id FROM form_reviews WHERE submission_id IN (${recent.map((_, i) => `$${i + 1}`).join(",")})`, recent.map(x => x.id));
      for (const x of r.rows) reviewed.add(x.submission_id);
    }
    const standing = sub => {
      const def = defs.get(sub.form_key);
      const steps = def?.settings?.stages || [];
      const isReviewed = reviewed.has(sub.id);
      const open = sub.status === "pending_approval" ||
        (steps.length ? sub.status !== "denied" && !doneStages(def).includes(sub.stage || "")
          : sub.status === "submitted" && !isReviewed && Date.now() - new Date(sub.submitted_at) < 14 * 864e5);
      return { ...submissionMeta(sub, nm), open, reviewed: isReviewed, noHandler: !(def?.settings?.recipients || []).length };
    };
    return send(res, 200, {
      tasks: mine.map(t => taskJson(t, nm, { title: t.case_title })),
      approvals: approvals.map(s => submissionMeta(s, nm)),
      toReview: toReview.map(s => ({ ...submissionMeta(s, nm), unassigned: unassigned.has(s.form_key) })),
      mine: recent.map(standing),
      updates: updates.map(s => submissionMeta(s, nm)),
    });
  }

  // ---- Submissions
  if (a === "submissions") {
    if (req.method === "GET" && !b) {
      const url = new URL(req.url, "http://x");
      const subject = url.searchParams.get("subject");
      const where = [], params = [];
      if (isUuid(subject)) { params.push(subject); where.push(`subject_user_id = $${params.length}`); }
      const r = await pool.query(`SELECT * FROM form_submissions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY submitted_at DESC LIMIT 2000`, params);
      const out = [];
      for (const s of r.rows) if (await submissionAccess(pool, acc, s, defs)) out.push(s);
      const nm = await names(pool, out.map(s => s.subject_user_id));
      return send(res, 200, { submissions: out.map(s => submissionMeta(s, nm)) });
    }
    if (!isUuid(b)) throw new HttpError(404, "Not found");
    const s = (await pool.query("SELECT * FROM form_submissions WHERE id = $1", [b])).rows[0];
    if (!s) throw new HttpError(404, "That form submission wasn't found.");
    const level = await submissionAccess(pool, acc, s, defs);
    if (!level) throw forbid("You don't have access to this form.");

    if (!c2 && req.method === "GET") {
      const out = await submissionJson(pool, s, level);
      const def = defs.get(s.form_key);
      out.canReview = fullFor(acc, def) || (s.case_id && level === "full");
      out.isRecipient = (def?.settings?.recipients || []).includes(user.id);
      out.stages = (def?.settings?.stages || []).map(x => ({ label: x.label, notify: !!x.notify, done: doneStages(def).includes(x.label) }));
      out.canSetStage = out.stages.length > 0 && level === "full";
      if (!s.stage_seen && (s.submitted_by === user.id || s.subject_user_id === user.id)) {
        await pool.query("UPDATE form_submissions SET stage_seen = true WHERE id = $1", [s.id]);
      }
      return send(res, 200, { submission: out });
    }
    if (c2 === "stage" && req.method === "POST") {
      const def = defs.get(s.form_key);
      const stages = def?.settings?.stages || [];
      if (!stages.length) throw bad("This form doesn't have progress steps.");
      if (level !== "full") throw forbid("Only the people who handle this form can update its progress.");
      const want = clean(body.stage, 80);
      const note = clean(body.note, 1000);
      const step = stages.find(x => x.label === want);
      if (want && !step) throw bad("That isn't one of this form's steps.");
      const isOwner = s.submitted_by === user.id || s.subject_user_id === user.id;
      await tx(async c => {
        await c.query(
          `UPDATE form_submissions SET stage = $2, stage_at = now(), stage_by = $3, stage_by_name = $4, stage_seen = $5, stage_note = $6 WHERE id = $1`,
          [s.id, want || null, user.id, user.name,  !(step?.notify) || isOwner || !(s.submitted_by || s.subject_user_id), note || null]);
        const { bookingStage } = await import("./bookings.js");
        await bookingStage(c, def, s.id, want || null);
        await audit(c, user, "Updated form progress", `${s.form_title} (${s.submitted_by_name || "anonymous"}): ${want || "cleared"}${note ? ` — ${note}` : ""}`);
      });
      return send(res, 200, { ok: true });
    }
    if (c2 === "review" && req.method === "POST") {
      if (level !== "full") throw forbid("Only required recipients and people with access to this form mark it reviewed.");
      await tx(async c => {
        await c.query(
          `INSERT INTO form_reviews (submission_id, user_id, note) VALUES ($1, $2, $3)
           ON CONFLICT (submission_id, user_id) DO UPDATE SET note = EXCLUDED.note, reviewed_at = now()`, [b, user.id, clean(body.note, 2000)]);
        await audit(c, user, "Reviewed form", s.form_title);
      });
      return send(res, 200, { ok: true });
    }
    if (c2 === "decision" && req.method === "POST") {
      const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
      if (!decision) throw bad("Approve or deny.");
      await tx(async c => {
        const r = await c.query(
          `UPDATE form_approvals SET decision = $3, note = $4, decided_at = now() WHERE submission_id = $1 AND user_id = $2 AND decision = 'pending'`,
          [b, user.id, decision, clean(body.note, 2000)]);
        if (!r.rowCount) throw forbid("This isn't waiting for your approval.");
        const all = (await c.query("SELECT decision FROM form_approvals WHERE submission_id = $1", [b])).rows.map(x => x.decision);
        const status = all.includes("denied") ? "denied" : all.every(x => x === "approved") ? "approved" : "pending_approval";
        await c.query("UPDATE form_submissions SET status = $2 WHERE id = $1", [b, status]);
        await audit(c, user, decision === "approved" ? "Approved form" : "Denied form", `${s.form_title} — ${s.submitted_by_name}`);
      });
      return send(res, 200, { ok: true });
    }
    if (c2 === "pdf" && req.method === "GET") {
      if (level !== "full") throw forbid("Only people with full access can download the filled form.");
      const pdfCfg = s.definition.settings?.pdf;
      if (!pdfCfg) throw new HttpError(404, "This form has no PDF version.");
      const { fillPdf } = await import("./pdfFill.js");
      const full = await submissionJson(pool, s, "full");
      const bytes = await fillPdf(pdfCfg, full.data);
      const subj = (full.subjectName || "").replace(/[^\w .-]/g, "");
      res.writeHead(200, {
        "Content-Type": "application/pdf", "Content-Length": bytes.length, "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${(pdfCfg.fileName || "form").replace(/[^\w .-]/g, "")}${subj ? ` - ${subj}` : ""}.pdf"`,
        "X-Content-Type-Options": "nosniff",
      });
      await audit(pool, user, "Downloaded filled PDF", `${s.form_title}${full.subjectName ? ` — ${full.subjectName}` : ""}`);
      return res.end(Buffer.from(bytes));
    }
  }

  // ---- Cases
  if (a === "cases") {
    if (req.method === "GET" && !b) {
      const url = new URL(req.url, "http://x");
      const subject = url.searchParams.get("subject");
      const r = isUuid(subject)
        ? await pool.query("SELECT * FROM form_cases WHERE subject_user_id = $1 ORDER BY opened_at DESC", [subject])
        : await pool.query("SELECT * FROM form_cases ORDER BY opened_at DESC LIMIT 1000");
      const out = [];
      for (const cs of r.rows) if (await caseAccess(pool, acc, cs, defs)) out.push(cs);
      const counts = new Map();
      if (out.length) {
        const t = await pool.query(`SELECT case_id, status, count(*)::int AS n FROM form_tasks WHERE case_id IN (${out.map((_, i) => `$${i + 1}`).join(",")}) GROUP BY case_id, status`, out.map(x => x.id));
        for (const row of t.rows) { const m = counts.get(row.case_id) || {}; m[row.status] = row.n; counts.set(row.case_id, m); }
      }
      return send(res, 200, {
        cases: out.map(cs => ({
          id: cs.id, kind: cs.kind, title: cs.title, subjectId: cs.subject_user_id, summary: cs.summary, status: cs.status,
          openedAt: iso(cs.opened_at), pending: counts.get(cs.id)?.pending || 0, done: counts.get(cs.id)?.done || 0,
        })),
      });
    }
    if (!isUuid(b)) throw new HttpError(404, "Not found");
    const cs = (await pool.query("SELECT * FROM form_cases WHERE id = $1", [b])).rows[0];
    if (!cs) throw new HttpError(404, "That case wasn't found.");
    const level = await caseAccess(pool, acc, cs, defs);

    if (!c2 && req.method === "GET") {
      if (!level) throw forbid("You don't have access to this case.");
      const tasks = (await pool.query("SELECT * FROM form_tasks WHERE case_id = $1 ORDER BY created_at", [b])).rows;
      const subs = (await pool.query("SELECT * FROM form_submissions WHERE case_id = $1 ORDER BY submitted_at", [b])).rows;
      const visibleSubs = [];
      for (const s of subs) if (await submissionAccess(pool, acc, s, defs)) visibleSubs.push(s);
      const nm = await names(pool, [cs.subject_user_id, cs.opened_by, ...tasks.map(t => t.assigned_to), ...subs.map(s => s.subject_user_id)]);
      const fus = defs.get(cs.form_key)?.settings?.case?.followUps || [];
      return send(res, 200, {
        case: {
          id: cs.id, kind: cs.kind, title: cs.title, formKey: cs.form_key, subjectId: cs.subject_user_id,
          subjectName: nm.get(cs.subject_user_id) || "", summary: cs.summary, status: cs.status,
          openedAt: iso(cs.opened_at), openedBy: nm.get(cs.opened_by) || "", canManage: level === "manage",
          followUps: fus.map(f => ({ form: f.form, label: f.label, title: defs.get(f.form)?.title || f.form })),
        },
        tasks: (level === "manage" ? tasks : tasks.filter(t => t.assigned_to === user.id)).map(t => taskJson(t, nm)),
        submissions: visibleSubs.map(s => submissionMeta(s, nm)),
      });
    }
    if (level !== "manage") throw forbid("Only people with access to these reports can change the case.");
    if (c2 === "tasks" && req.method === "POST") {
      const fu = (defs.get(cs.form_key)?.settings?.case?.followUps || []).find(f => f.form === body.formKey);
      if (!fu) throw bad("That form isn't part of this case.");
      const assignee = isUuid(body.assigneeId) ? body.assigneeId : null;
      const nm = assignee ? (await names(pool, [assignee])).get(assignee) : clean(body.assigneeName, 120);
      if (assignee && !nm) throw bad("That person isn't on the roster.");
      await tx(async c => {
        await c.query(`INSERT INTO form_tasks (id, case_id, form_key, label, assigned_to, assignee_name) VALUES ($1,$2,$3,$4,$5,$6)`,
          [crypto.randomUUID(), b, fu.form, fu.label || fu.form, assignee, nm || ""]);
        await audit(c, user, "Requested case form", `${cs.title}: ${fu.label}${nm ? ` — ${nm}` : ""}`);
      });
      return send(res, 200, { ok: true });
    }
    if (c2 === "status" && req.method === "POST") {
      const status = body.status === "closed" ? "closed" : "open";
      await tx(async c => {
        await c.query("UPDATE form_cases SET status = $2, closed_at = $3 WHERE id = $1", [b, status, status === "closed" ? new Date().toISOString() : null]);
        await audit(c, user, status === "closed" ? "Closed case" : "Reopened case", cs.title);
      });
      return send(res, 200, { ok: true });
    }
  }

  // ---- A task: the form to fill, with the case's shared facts
  if (a === "tasks" && isUuid(b)) {
    const t = (await pool.query("SELECT * FROM form_tasks WHERE id = $1", [b])).rows[0];
    if (!t) throw new HttpError(404, "That task wasn't found.");
    const cs = (await pool.query("SELECT * FROM form_cases WHERE id = $1", [t.case_id])).rows[0];
    const manage = (await caseAccess(pool, acc, cs, defs)) === "manage";
    if (req.method === "GET") {
      if (!canDoTask(acc, t, cs, defs, manage) && !manage) throw forbid("This task isn't yours.");
      const fdef = defs.get(t.form_key);
      const nm = await names(pool, [t.assigned_to]);
      return send(res, 200, {
        task: taskJson(t, nm, cs), definition: fdef ? defJson(fdef) : null,
        context: { ...(await caseContext(pool, cs, manage || fullFor(acc, fdef))), assigneeName: t.assigned_to ? nm.get(t.assigned_to) : t.assignee_name },
        canFill: canDoTask(acc, t, cs, defs, manage),
      });
    }
    if (req.method === "POST") {
      if (!manage) throw forbid("Only people with access to these reports can change case tasks.");
      if (t.status !== "pending") throw bad("That task is already finished.");
      await tx(async c => {
        if (body.cancel) {
          await c.query("UPDATE form_tasks SET status = 'cancelled', completed_at = now() WHERE id = $1", [b]);
          await audit(c, user, "Cancelled case form", `${cs.title}: ${t.label}`);
        } else {
          const assignee = isUuid(body.assigneeId) ? body.assigneeId : null;
          const nm = assignee ? (await names(c, [assignee])).get(assignee) : clean(body.assigneeName, 120);
          if (assignee && !nm) throw bad("That person isn't on the roster.");
          await c.query("UPDATE form_tasks SET assigned_to = $2, assignee_name = $3 WHERE id = $1", [b, assignee, nm || ""]);
          await audit(c, user, "Reassigned case form", `${cs.title}: ${t.label} → ${nm || "unassigned"}`);
        }
      });
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: "Not found" });
}
