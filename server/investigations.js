// Fire investigations (arson) with CJIS Security Policy controls. See db/migrations/037_investigations.sql.
//
// Every request (except /status and /todo) passes `gate()`:
//   1. access: section "investigations" edit (investigator) or manage (Chief of Fire Prevention / LASO); masters count as manage
//   2. the CJIS list: listed, not revoked, fingerprint background check on file, security awareness training within a year
//   3. second factor: authenticator set up, not locked, checked on this session within 12 hours and Investigations used within
//      the last 30 minutes (auth.js mfa-*)
// Need-to-know: a case opens for its investigators, managers and masters. Investigators see their own cases in the list;
// the deconfliction lookup shows only case #, status and lead for others.
// Every view is written to inv_access_log (append-only); if that write fails the request fails (fail closed) and managers
// are told. Case narratives, people, supplements, criminal history and files are AES-256-GCM encrypted (forms key).
// Nothing from a case goes into Messages / push (only "you were added to case 2026-004"), the audit log (case numbers only)
// or AI.
//
//   GET  /api/inv/status                    my rights, CJIS list status, authenticator status   (no gate)
//   GET  /api/inv/todo                      Your Day: weekly log review due (managers), my training expiring  (no gate)
//   GET  /api/inv/cases?status&q            my cases (managers: all)
//   POST /api/inv/cases                     {title, incidentNo, incidentDate, address, occupancy}  -> I'm the lead
//   GET  /api/inv/lookup?q=                 deconfliction: case #, status, lead for any case matching an address / incident #
//   GET  /api/inv/cases/:id                 the case (CJI entries listed without their contents)
//   POST /api/inv/cases/:id                 {fields…}  members/managers
//   POST /api/inv/cases/:id/members         {userId, role}     lead/managers;  POST …/members/:uid/remove
//   POST /api/inv/cases/:id/people          {id?, role, name, dob, phone, address, notes};  POST /api/inv/people/:pid/remove
//   POST /api/inv/cases/:id/evidence        {id?, description, foundLocation, collectedAt, collectedBy, storage, status}
//   POST /api/inv/evidence/:eid/custody     {at, releasedBy, receivedBy, purpose, note}
//   POST /api/inv/cases/:id/files           {name, dataUrl, caption};  GET /api/inv/files/:fid;  POST /api/inv/files/:fid/remove (managers)
//   POST /api/inv/cases/:id/supplements     {text}   (append-only)
//   POST /api/inv/cases/:id/print           logs a printed case file (no CJI in it)
//   POST /api/inv/cases/:id/cji             {personId, kind, runOn, purpose, subject, result, notes, file?{name, dataUrl}}
//   GET  /api/inv/cji/:cid                  the result (logged);  GET /api/inv/cji/:cid/file
//   POST /api/inv/cji/:cid/disseminate      {releasedTo, agency, purpose, method}  (logged release, e.g. printing for the DA)
//   POST /api/inv/cji/:cid/purge            {reason}  managers: destroys the contents, keeps the record that it existed
//   GET  /api/inv/cjis                      managers: the CJIS list + everyone with Investigations access
//   POST /api/inv/cjis                      {userId, backgroundDate, backgroundRef, trainingDate, note};  POST /api/inv/cjis/:uid/revoke
//   GET  /api/inv/log?from&to&user&case     managers: access log (+ export.csv)
//   POST /api/inv/reviews                   {weekStart, note}  managers: weekly log review sign-off
import crypto from "node:crypto";
import { brand, brandText, brandDeep } from "./brand.js";
import { pool, tx } from "./db.js";
import { hasAccess } from "./access.js";
import { encrypt, decrypt, encryptBuffer, decryptBuffer } from "./forms.js";
import { MFA_HOURS, MFA_IDLE_MINUTES } from "./auth.js";

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, n = 300) => String(v ?? "").trim().slice(0, n);
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const clientIp = req => String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
export const STATUSES = { open: "Open", active: "Active", referred: "Referred to DA", closed: "Closed", unfounded: "Unfounded" };
export const CLASSES = { pending: "Pending", accidental: "Accidental", natural: "Natural", incendiary: "Incendiary", undetermined: "Undetermined" };
export const PERSON_ROLES = { owner: "Owner", occupant: "Occupant", complainant: "Complainant", witness: "Witness", victim: "Victim", suspect: "Suspect", other: "Other" };
export const EVIDENCE_STATUS = { held: "Held", lab: "At the lab", returned: "Returned", released: "Released", destroyed: "Destroyed" };
export const CJI_KINDS = { ncic: "NCIC", iii: "III criminal history", llets: "LLETS", local: "Local records", other: "Other" };

// ---- Rights, CJIS list, second factor ----------------------------------------------------------------
async function rights(user) {
  const manage = await hasAccess(pool, user, "investigations", "manage");
  return { manage, edit: manage || await hasAccess(pool, user, "investigations", "edit") };
}
export async function managers() {
  const { effectiveFor } = await import("./access.js");
  const people = (await pool.query("SELECT id, role FROM users WHERE active AND account_status = 'approved'")).rows;
  const out = [];
  for (const p of people) if (p.role !== "master" && (await effectiveFor(pool, p.id)).some(g => g.section === "investigations" && g.level === "manage")) out.push(p.id);
  return out.length ? out : people.filter(p => p.role === "master").map(p => p.id);
}
export async function cjisStatus(userId) {
  const r = (await pool.query(`SELECT background_date::text AS "backgroundDate", background_ref AS "backgroundRef", training_date::text AS "trainingDate",
      (training_date + interval '1 year')::date::text AS "trainingDue", revoked_at AS "revokedAt", note FROM inv_cjis_people WHERE user_id = $1`, [userId])).rows[0];
  const missing = [];
  if (!r || r.revokedAt) missing.push("not on the CJIS list");
  else {
    if (!r.backgroundDate) missing.push("no fingerprint background check on file");
    if (!r.trainingDate) missing.push("no CJIS security awareness training on file");
    else if (r.trainingDue < localToday()) missing.push(`CJIS training expired ${r.trainingDue}`);
  }
  return { listed: !!r && !r.revokedAt, ok: missing.length === 0, missing, ...(r || {}) };
}
const fresh = s => s.mfa_at && Date.now() - new Date(s.mfa_at) < MFA_HOURS * 3600e3 && s.inv_seen_at && Date.now() - new Date(s.inv_seen_at) < MFA_IDLE_MINUTES * 60e3;
// The CJIS list itself (names and dates, no CJI) can be kept by a manager who isn't on it yet (skipList), so the first
// person can be added; everything else needs the list.
async function gate(req, user, { skipList = false } = {}) {
  const r = await rights(user);
  if (!r.edit) throw err(403, "Investigations is open only to fire investigators and the Chief of Fire Prevention.", { need: "access" });
  const u = (await pool.query("SELECT totp_enabled_at, mfa_locked_at FROM users WHERE id = $1", [user.id])).rows[0];
  if (u.mfa_locked_at) throw err(423, "Your authenticator is locked after too many wrong codes. The Chief of Fire Prevention or a master admin can release it.", { need: "locked" });
  if (!u.totp_enabled_at) throw err(401, "Set up your authenticator app to open Investigations.", { need: "mfa_setup" });
  if (!fresh(user)) throw err(401, "Enter the code from your authenticator app.", { need: "mfa" });
  if (!(skipList && r.manage)) {
    const cj = await cjisStatus(user.id);
    if (!cj.ok) throw err(403, `You can't open Investigations yet: ${cj.missing.join("; ")}. The Chief of Fire Prevention keeps the CJIS list.`, { need: "cjis", missing: cj.missing });
  }
  if (req.headers["x-sgfd-background"] !== "1") await pool.query("UPDATE sessions SET inv_seen_at = now() WHERE token_hash = $1", [user.sessionHash]);
  return r;
}

// ---- Access log (fail closed) -------------------------------------------------------------------------
let lastLogAlert = 0;
async function logView(req, user, kase, what, c = pool) {
  try {
    await c.query("INSERT INTO inv_access_log (user_id, user_name, case_id, case_no, what, ip) VALUES ($1, $2, $3, $4, $5, $6)",
      [user.id, user.name, kase?.id || null, kase?.case_no || kase?.caseNo || "", String(what).slice(0, 300), clientIp(req)]);
  } catch (e) {
    console.error("Investigations access log failed:", e.message);
    if (Date.now() - lastLogAlert > 3600e3) {
      lastLogAlert = Date.now();
      try {
        const { send } = await import("./messages.js");
        const to = await managers();
        if (to.length) await send({ id: user.id, name: brand().app, role: "master" }, { users: to, toSelf: true, important: true, subject: "Investigations access logging failed",
          body: brand().productName + " couldn't write to the Investigations access log, so Investigations is refusing requests until it can. Tell IT right away (CJIS: logging failures are reported within an hour)." });
      } catch {}
    }
    throw err(503, "Investigations can't record this view right now, so it's closed until IT fixes it.");
  }
}
async function audit(c, actor, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Investigations', $4, $5)`,
    [actor.id, actor.name, ROLE_LABEL[actor.role] || actor.role, action, String(detail).slice(0, 500)]);
}

// ---- Cases --------------------------------------------------------------------------------------------
async function loadCase(id) {
  if (!isUuid(id)) throw err(404, "Case not found.");
  const k = (await pool.query("SELECT * FROM inv_cases WHERE id = $1", [id])).rows[0];
  if (!k) throw err(404, "Case not found.");
  k.members = (await pool.query(`SELECT m.user_id AS "userId", m.role, u.full_name AS name FROM inv_members m JOIN users u ON u.id = m.user_id WHERE m.case_id = $1 ORDER BY m.role, u.full_name`, [id])).rows;
  return k;
}
function canOpen(r, user, k) { return r.manage || k.members.some(m => m.userId === user.id); }
function canLead(r, user, k) { return r.manage || k.members.some(m => m.userId === user.id && m.role === "lead"); }
async function requireCase(r, user, id) {
  const k = await loadCase(id);
  if (!canOpen(r, user, k)) throw err(403, `Case ${k.case_no} is limited to its investigators. Ask the lead or the Chief of Fire Prevention to add you.`);
  return k;
}
const touch = (c, id) => c.query("UPDATE inv_cases SET updated_at = now() WHERE id = $1", [id]);
async function nextCaseNo(c) {
  const y = localToday().slice(0, 4);
  await c.query("SELECT pg_advisory_xact_lock(hashtext('sgfd-inv-caseno'))");
  const n = (await c.query("SELECT count(*)::int AS n FROM inv_cases WHERE case_no LIKE $1", [`${y}-%`])).rows[0].n + 1;
  return `${y}-${String(n).padStart(3, "0")}`;
}
const ymd = d => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : "");
function caseRow(k) {
  return { id: k.id, caseNo: k.case_no, title: k.title, incidentNo: k.incident_no, incidentDate: ymd(k.incident_date),
    address: k.address, occupancy: k.occupancy, status: k.status, classification: k.classification, leadId: k.lead_id, updatedAt: k.updated_at, createdAt: k.created_at };
}
const dataUrlBuffer = (s, max = 15 * 1024 * 1024) => {
  const m = /^data:([\w.+/-]+);base64,(.+)$/s.exec(String(s || ""));
  if (!m) throw err(400, "Attach the file again.");
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length) throw err(400, "That file is empty.");
  if (buf.length > max) throw err(413, "Files can be up to 15 MB.");
  return { mime: m[1], buf };
};
async function notifyAdded(actor, userId, caseNo) {
  if (userId === actor.id) return;
  try {
    const { send } = await import("./messages.js");
    await send(actor, { users: [userId], subject: `Investigations: you were added to case ${caseNo}`, body: `You were added to investigation case ${caseNo}. Open Investigations in ${brand().productName} to see it.` });
  } catch (e) { console.error("inv notice:", e.message); }
}

// ---- Routes ---------------------------------------------------------------------------------------------
export async function handleInvestigations(req, res, parts, user, send, jsonBody, url) {
  try { return await route(req, res, parts, user, send, jsonBody, url); }
  catch (e) { if (e.need) return send(res, e.status, { error: e.message, need: e.need, missing: e.missing || [] }); throw e; }
}
async function route(req, res, parts, user, send, jsonBody, url) {
  const what = parts[2], id = parts[3], sub = parts[4];
  if (what === "status" && req.method === "GET") {
    const r = await rights(user);
    const u = (await pool.query("SELECT totp_enabled_at, mfa_locked_at FROM users WHERE id = $1", [user.id])).rows[0];
    return send(res, 200, { rights: r, cjis: await cjisStatus(user.id), mfa: { enabled: !!u.totp_enabled_at, verified: !!u.totp_enabled_at && fresh(user), locked: !!u.mfa_locked_at },
      lists: { statuses: STATUSES, classes: CLASSES, personRoles: PERSON_ROLES, evidenceStatus: EVIDENCE_STATUS, cjiKinds: CJI_KINDS }, idleMinutes: MFA_IDLE_MINUTES });
  }
  if (what === "todo" && req.method === "GET") {
    const r = await rights(user);
    if (!r.edit) return send(res, 200, { reviewDue: false, trainingDue: null });
    const cj = await cjisStatus(user.id);
    const soon = cj.trainingDue && cj.trainingDue <= new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10) ? cj.trainingDue : null;
    let reviewDue = false;
    if (r.manage && user.role !== "master") {
      const last = (await pool.query("SELECT max(reviewed_at) AS at FROM inv_reviews")).rows[0].at;
      const any = (await pool.query("SELECT 1 FROM inv_access_log LIMIT 1")).rowCount > 0;
      reviewDue = any && (!last || Date.now() - new Date(last) > 7 * 86400e3);
    }
    return send(res, 200, { reviewDue, trainingDue: soon });
  }

  const r = await gate(req, user, { skipList: what === "cjis" });

  if (what === "cases" && !id && req.method === "GET") {
    const st = url.searchParams.get("status") || "", q = clean(url.searchParams.get("q"), 100).toLowerCase();
    const rows = (await pool.query(
      `SELECT k.*, (SELECT full_name FROM users WHERE id = k.lead_id) AS lead_name,
              EXISTS (SELECT 1 FROM inv_members m WHERE m.case_id = k.id AND m.user_id = $1) AS mine
         FROM inv_cases k ORDER BY k.updated_at DESC`, [user.id])).rows
      .filter(k => (r.manage || k.mine) && (!st || k.status === st) && (!q || `${k.case_no} ${k.title} ${k.address} ${k.incident_no}`.toLowerCase().includes(q)));
    await logView(req, user, null, `Listed cases${st ? ` (${st})` : ""}${q ? ` matching "${q.slice(0, 40)}"` : ""}`);
    return send(res, 200, { cases: rows.map(k => ({ ...caseRow(k), lead: k.lead_name || "", mine: k.mine })), manage: r.manage });
  }
  if (what === "lookup" && req.method === "GET") {
    const q = clean(url.searchParams.get("q"), 100).toLowerCase();
    if (q.length < 3) throw err(400, "Type at least 3 characters of an address or incident number.");
    const rows = (await pool.query(`SELECT k.case_no, k.status, k.address, k.incident_no, u.full_name AS lead FROM inv_cases k LEFT JOIN users u ON u.id = k.lead_id ORDER BY k.case_no DESC`)).rows
      .filter(k => `${k.address} ${k.incident_no} ${k.case_no}`.toLowerCase().includes(q)).slice(0, 20);
    await logView(req, user, null, `Deconfliction lookup "${q.slice(0, 40)}" (${rows.length} found)`);
    return send(res, 200, { matches: rows.map(k => ({ caseNo: k.case_no, status: k.status, lead: k.lead || "" })) });
  }
  if (what === "cases" && !id && req.method === "POST") {
    const b = await jsonBody(req);
    const title = clean(b.title, 200);
    if (!title) throw err(400, "Give the case a title (e.g. the address and what burned).");
    if (b.incidentDate && !DAY.test(b.incidentDate)) throw err(400, "Incident date isn't a date.");
    const out = await tx(async c => {
      const kid = crypto.randomUUID(), no = await nextCaseNo(c);
      await c.query(`INSERT INTO inv_cases (id, case_no, title, incident_no, incident_date, address, occupancy, lead_id, created_by, secret) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [kid, no, title, clean(b.incidentNo, 40), b.incidentDate || null, clean(b.address), clean(b.occupancy, 120), user.id, user.name, encrypt({ summary: "", causeNarrative: "", notes: "" })]);
      await c.query("INSERT INTO inv_members (case_id, user_id, role, added_by) VALUES ($1, $2, 'lead', $3)", [kid, user.id, user.name]);
      await logView(req, user, { id: kid, case_no: no }, "Opened a new case", c);
      await audit(c, user, "Opened case", no);
      return { id: kid, caseNo: no };
    });
    return send(res, 200, out);
  }
  if (what === "cases" && id && !sub && req.method === "GET") {
    const k = await requireCase(r, user, id);
    const sec = decrypt(k.secret);
    const people = (await pool.query("SELECT id, role, secret, created_by FROM inv_people WHERE case_id = $1 ORDER BY created_at", [id])).rows.map(p => ({ id: p.id, role: p.role, by: p.created_by, ...decrypt(p.secret) }));
    const evidence = (await pool.query(`SELECT id, item_no AS "itemNo", description, found_location AS "foundLocation", collected_at AS "collectedAt", collected_by AS "collectedBy", storage, status FROM inv_evidence WHERE case_id = $1 ORDER BY item_no`, [id])).rows;
    const custody = evidence.length ? (await pool.query(`SELECT id, evidence_id AS "evidenceId", at, released_by AS "releasedBy", received_by AS "receivedBy", purpose, note, entered_by AS "enteredBy" FROM inv_custody WHERE evidence_id IN (SELECT id FROM inv_evidence WHERE case_id = $1) ORDER BY at`, [id])).rows : [];
    for (const e of evidence) e.custody = custody.filter(c => c.evidenceId === e.id);
    const files = (await pool.query(`SELECT id, name, mime, size, caption, uploaded_by AS "by", uploaded_at AS "at" FROM inv_files WHERE case_id = $1 ORDER BY uploaded_at`, [id])).rows;
    const supplements = (await pool.query(`SELECT id, author_name AS author, at, secret FROM inv_supplements WHERE case_id = $1 ORDER BY at`, [id])).rows.map(s => ({ id: s.id, author: s.author, at: s.at, text: decrypt(s.secret).text }));
    const cji = (await pool.query(`SELECT j.id, j.person_id AS "personId", j.kind, j.run_on::text AS "runOn", j.run_by AS "runBy", j.purpose, j.created_by AS "by", j.created_at AS "at",
        j.file_name <> '' AS "hasFile", j.purged_at AS "purgedAt", j.purged_by AS "purgedBy", j.purge_reason AS "purgeReason",
        (SELECT count(*)::int FROM inv_dissemination d WHERE d.cji_id = j.id) AS releases FROM inv_cji j WHERE j.case_id = $1 ORDER BY j.created_at`, [id])).rows;
    await logView(req, user, k, "Opened case");
    const allPeople = r.manage || canLead(r, user, k) ? (await pool.query(`SELECT u.id, u.full_name AS name FROM users u JOIN inv_cjis_people c ON c.user_id = u.id WHERE c.revoked_at IS NULL AND u.active ORDER BY u.full_name`)).rows : [];
    return send(res, 200, { ...caseRow(k), ...sec, daReferral: k.da_referral || {}, juvenileReferral: k.juvenile_referral, originArea: k.origin_area, heatSource: k.heat_source,
      firstIgnited: k.first_ignited, closedAt: k.closed_at, createdBy: k.created_by, members: k.members, people, evidence, files, supplements, cji,
      canLead: canLead(r, user, k), manage: r.manage, candidates: allPeople });
  }
  if (what === "cases" && id && !sub && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    if (b.status && !STATUSES[b.status]) throw err(400, "Pick a status.");
    if (b.classification && !CLASSES[b.classification]) throw err(400, "Pick a classification.");
    if (b.incidentDate && !DAY.test(b.incidentDate)) throw err(400, "Incident date isn't a date.");
    const sec = { ...decrypt(k.secret) };
    for (const f of ["summary", "causeNarrative", "notes"]) if (b[f] !== undefined) sec[f] = clean(b[f], 20000);
    const status = b.status || k.status;
    const da = b.daReferral ? { date: DAY.test(b.daReferral.date || "") ? b.daReferral.date : "", office: clean(b.daReferral.office, 120), number: clean(b.daReferral.number, 60) } : k.da_referral;
    await pool.query(`UPDATE inv_cases SET title = $2, incident_no = $3, incident_date = $4, address = $5, occupancy = $6, status = $7, classification = $8, origin_area = $9,
        heat_source = $10, first_ignited = $11, secret = $12, da_referral = $13, juvenile_referral = $14, updated_at = now(),
        closed_at = CASE WHEN $7 IN ('closed','unfounded') THEN COALESCE(closed_at, now()) ELSE NULL END WHERE id = $1`,
      [id, clean(b.title ?? k.title, 200) || k.title, clean(b.incidentNo ?? k.incident_no, 40), b.incidentDate === undefined ? k.incident_date : b.incidentDate || null, clean(b.address ?? k.address),
        clean(b.occupancy ?? k.occupancy, 120), status, b.classification || k.classification, clean(b.originArea ?? k.origin_area), clean(b.heatSource ?? k.heat_source),
        clean(b.firstIgnited ?? k.first_ignited), encrypt(sec), JSON.stringify(da), b.juvenileReferral ?? k.juvenile_referral]);
    await logView(req, user, k, "Updated case");
    if (status !== k.status) await audit(pool, user, "Case status", `${k.case_no}: ${STATUSES[k.status]} → ${STATUSES[status]}`);
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "members" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    if (!canLead(r, user, k)) throw err(403, "Only the lead investigator or the Chief of Fire Prevention can change who's on a case.");
    const b = await jsonBody(req);
    if (parts[5] && parts[6] === "remove") {
      if (k.members.length <= 1) throw err(400, "A case needs at least one investigator.");
      const gone = k.members.find(m => m.userId === parts[5]);
      if (!gone) return send(res, 200, { ok: true });
      await pool.query("DELETE FROM inv_members WHERE case_id = $1 AND user_id = $2", [id, parts[5]]);
      if (gone.role === "lead") await pool.query("UPDATE inv_cases SET lead_id = NULL WHERE id = $1", [id]);
      await logView(req, user, k, `Removed ${gone.name} from the case`);
      await audit(pool, user, "Removed investigator", `${k.case_no}: ${gone.name}`);
      return send(res, 200, { ok: true });
    }
    if (!isUuid(b.userId)) throw err(400, "Choose an investigator.");
    const cj = await cjisStatus(b.userId);
    const who = (await pool.query("SELECT full_name AS name, role FROM users WHERE id = $1 AND active", [b.userId])).rows[0];
    if (!who) throw err(404, "Person not found.");
    const theirRights = await rights({ id: b.userId, role: who.role });
    if (!theirRights.edit || !cj.ok) throw err(400, `${who.name} can't be added: ${!theirRights.edit ? "no Investigations access" : cj.missing.join("; ")}.`);
    const role = b.role === "lead" ? "lead" : "investigator";
    await tx(async c => {
      if (role === "lead") { await c.query("UPDATE inv_members SET role = 'investigator' WHERE case_id = $1 AND role = 'lead'", [id]); await c.query("UPDATE inv_cases SET lead_id = $2 WHERE id = $1", [id, b.userId]); }
      await c.query(`INSERT INTO inv_members (case_id, user_id, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT (case_id, user_id) DO UPDATE SET role = $3`, [id, b.userId, role, user.name]);
      await touch(c, id);
    });
    await logView(req, user, k, `Added ${who.name} as ${role}`);
    await audit(pool, user, "Added investigator", `${k.case_no}: ${who.name} (${role})`);
    await notifyAdded(user, b.userId, k.case_no);
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "people" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    const name = clean(b.name, 120);
    if (!name) throw err(400, "Enter the person's name.");
    if (b.dob && !DAY.test(b.dob)) throw err(400, "Date of birth isn't a date.");
    const role = PERSON_ROLES[b.role] ? b.role : "other";
    const secret = encrypt({ name, dob: b.dob || "", phone: clean(b.phone, 40), address: clean(b.address), notes: clean(b.notes, 4000) });
    if (isUuid(b.id)) {
      const up = await pool.query("UPDATE inv_people SET role = $3, secret = $4 WHERE id = $1 AND case_id = $2", [b.id, id, role, secret]);
      if (!up.rowCount) throw err(404, "Person not found on this case.");
    } else await pool.query("INSERT INTO inv_people (id, case_id, role, secret, created_by) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), id, role, secret, user.name]);
    await touch(pool, id);
    await logView(req, user, k, `${isUuid(b.id) ? "Changed" : "Added"} a person (${PERSON_ROLES[role]})`);
    return send(res, 200, { ok: true });
  }
  if (what === "people" && isUuid(id) && sub === "remove" && req.method === "POST") {
    const p = (await pool.query("SELECT case_id FROM inv_people WHERE id = $1", [id])).rows[0];
    if (!p) return send(res, 200, { ok: true });
    const k = await requireCase(r, user, p.case_id);
    if ((await pool.query("SELECT 1 FROM inv_cji WHERE person_id = $1 AND purged_at IS NULL", [id])).rowCount) throw err(400, "This person has criminal history entries on the case. Purge those first (Chief of Fire Prevention).");
    await pool.query("DELETE FROM inv_people WHERE id = $1", [id]);
    await logView(req, user, k, "Removed a person");
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "evidence" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    const description = clean(b.description, 1000);
    if (!description) throw err(400, "Describe the item.");
    const status = EVIDENCE_STATUS[b.status] ? b.status : "held";
    const at = b.collectedAt ? new Date(b.collectedAt) : null;
    if (at && isNaN(at)) throw err(400, "Collected date/time isn't valid.");
    if (isUuid(b.id)) {
      const up = await pool.query(`UPDATE inv_evidence SET description = $3, found_location = $4, collected_at = $5, collected_by = $6, storage = $7, status = $8 WHERE id = $1 AND case_id = $2`,
        [b.id, id, description, clean(b.foundLocation), at, clean(b.collectedBy, 120), clean(b.storage, 200), status]);
      if (!up.rowCount) throw err(404, "Item not found on this case.");
    } else await tx(async c => {
      const n = (await c.query("SELECT COALESCE(max(item_no), 0) + 1 AS n FROM inv_evidence WHERE case_id = $1", [id])).rows[0].n;
      await c.query(`INSERT INTO inv_evidence (id, case_id, item_no, description, found_location, collected_at, collected_by, storage, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [crypto.randomUUID(), id, n, description, clean(b.foundLocation), at, clean(b.collectedBy, 120), clean(b.storage, 200), status, user.name]);
    });
    await touch(pool, id);
    await logView(req, user, k, `${isUuid(b.id) ? "Changed" : "Logged"} evidence`);
    return send(res, 200, { ok: true });
  }
  if (what === "evidence" && isUuid(id) && sub === "custody" && req.method === "POST") {
    const e = (await pool.query("SELECT case_id, item_no FROM inv_evidence WHERE id = $1", [id])).rows[0];
    if (!e) throw err(404, "Item not found.");
    const k = await requireCase(r, user, e.case_id);
    const b = await jsonBody(req);
    const at = new Date(b.at || Date.now());
    if (isNaN(at) || at > new Date(Date.now() + 5 * 60e3)) throw err(400, "Enter when it changed hands (not in the future).");
    const from = clean(b.releasedBy, 120), to = clean(b.receivedBy, 120);
    if (!from || !to) throw err(400, "Enter who released it and who received it.");
    await pool.query(`INSERT INTO inv_custody (id, evidence_id, at, released_by, received_by, purpose, note, entered_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), id, at, from, to, clean(b.purpose, 200), clean(b.note, 1000), user.name]);
    await touch(pool, e.case_id);
    await logView(req, user, k, `Chain of custody entry, item ${e.item_no}`);
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "files" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    const { mime, buf } = dataUrlBuffer(b.dataUrl);
    const name = clean(b.name, 200).replace(/[\\/:*?"<>|]+/g, "_") || "file";
    await pool.query(`INSERT INTO inv_files (id, case_id, name, mime, size, data, caption, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), id, name, mime.slice(0, 100), buf.length, encryptBuffer(buf), clean(b.caption, 300), user.name]);
    await touch(pool, id);
    await logView(req, user, k, `Added file ${name}`);
    return send(res, 200, { ok: true });
  }
  if (what === "files" && isUuid(id) && !sub && req.method === "GET") {
    const f = (await pool.query("SELECT case_id, name, mime, data FROM inv_files WHERE id = $1", [id])).rows[0];
    if (!f) throw err(404, "File not found.");
    const k = await requireCase(r, user, f.case_id);
    await logView(req, user, k, `Opened file ${f.name}`);
    const data = decryptBuffer(f.data);
    const inline = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(f.mime);
    res.writeHead(200, { "Content-Type": inline ? f.mime : "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-store",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w.\- ]+/g, "_")}"`, "X-Content-Type-Options": "nosniff" });
    return res.end(data);
  }
  if (what === "files" && isUuid(id) && sub === "remove" && req.method === "POST") {
    if (!r.manage) throw err(403, "Only the Chief of Fire Prevention can remove case files.");
    const f = (await pool.query("DELETE FROM inv_files WHERE id = $1 RETURNING case_id, name", [id])).rows[0];
    if (f) { const k = await loadCase(f.case_id); await logView(req, user, k, `Removed file ${f.name}`); await audit(pool, user, "Removed case file", `${k.case_no}: ${f.name}`); }
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "supplements" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    const text = clean(b.text, 20000);
    if (!text) throw err(400, "Write the supplement.");
    await pool.query("INSERT INTO inv_supplements (id, case_id, author_id, author_name, secret) VALUES ($1, $2, $3, $4, $5)", [crypto.randomUUID(), id, user.id, user.name, encrypt({ text })]);
    await touch(pool, id);
    await logView(req, user, k, "Added a supplement");
    return send(res, 200, { ok: true });
  }
  if (what === "cases" && id && sub === "print" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    await logView(req, user, k, "Printed the case file (without criminal history)");
    return send(res, 200, { ok: true });
  }
  // ---- Criminal justice information ----
  if (what === "cases" && id && sub === "cji" && req.method === "POST") {
    const k = await requireCase(r, user, id);
    const b = await jsonBody(req);
    if (!CJI_KINDS[b.kind]) throw err(400, "Pick what kind of check this was.");
    if (!DAY.test(b.runOn || "") || b.runOn > localToday()) throw err(400, "Enter the date the check was run.");
    const result = clean(b.result, 20000), subject = clean(b.subject, 200);
    if (!result && !b.file) throw err(400, "Enter the result or attach the printout.");
    if (b.personId && !(await pool.query("SELECT 1 FROM inv_people WHERE id = $1 AND case_id = $2", [b.personId, id])).rowCount) throw err(400, "That person isn't on this case.");
    const file = b.file ? dataUrlBuffer(b.file.dataUrl) : null;
    const cid = crypto.randomUUID();
    await pool.query(`INSERT INTO inv_cji (id, case_id, person_id, kind, run_on, run_by, purpose, secret, file, file_name, file_mime, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [cid, id, isUuid(b.personId) ? b.personId : null, b.kind, b.runOn, clean(b.runBy, 120) || user.name, clean(b.purpose, 10) || "C",
        encrypt({ subject, result, notes: clean(b.notes, 4000) }), file ? encryptBuffer(file.buf) : null, file ? clean(b.file.name, 200) : "", file ? file.mime : "", user.name]);
    await touch(pool, id);
    await logView(req, user, k, `Entered criminal history (${CJI_KINDS[b.kind]})`);
    await audit(pool, user, "Entered criminal history", k.case_no);
    return send(res, 200, { ok: true, id: cid });
  }
  if (what === "cji" && isUuid(id)) {
    const j = (await pool.query("SELECT * FROM inv_cji WHERE id = $1", [id])).rows[0];
    if (!j) throw err(404, "Entry not found.");
    const k = await requireCase(r, user, j.case_id);
    if (j.purged_at && (sub || req.method === "GET")) throw err(410, `This entry was purged on ${new Date(j.purged_at).toLocaleDateString("en-US")} by ${j.purged_by}.`);
    if (!sub && req.method === "GET") {
      await logView(req, user, k, `Viewed criminal history (${CJI_KINDS[j.kind]}, ${ymd(j.run_on)})`);
      const rel = (await pool.query(`SELECT at, by_name AS "by", released_to AS "releasedTo", agency, purpose, method FROM inv_dissemination WHERE cji_id = $1 ORDER BY at`, [id])).rows;
      return send(res, 200, { id: j.id, kind: j.kind, runBy: j.run_by, purpose: j.purpose, fileName: j.file_name, ...decrypt(j.secret), releases: rel });
    }
    if (sub === "file" && req.method === "GET") {
      if (!j.file) throw err(404, "No printout attached.");
      await logView(req, user, k, `Opened criminal history printout ${j.file_name}`);
      const data = decryptBuffer(j.file);
      res.writeHead(200, { "Content-Type": /^application\/pdf$|^image\//.test(j.file_mime) ? j.file_mime : "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${j.file_name.replace(/[^\w.\- ]+/g, "_")}"`, "X-Content-Type-Options": "nosniff" });
      return res.end(data);
    }
    if (sub === "disseminate" && req.method === "POST") {
      const b = await jsonBody(req);
      const to = clean(b.releasedTo, 120), purpose = clean(b.purpose, 300);
      if (!to || !purpose) throw err(400, "Enter who it's released to and why (CJIS dissemination log).");
      const method = ["print", "in person", "secure email", "other"].includes(b.method) ? b.method : "print";
      await pool.query(`INSERT INTO inv_dissemination (id, cji_id, by_name, released_to, agency, purpose, method) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), id, user.name, to, clean(b.agency, 120), purpose, method]);
      await logView(req, user, k, `Released criminal history to ${to} (${method})`);
      await audit(pool, user, "Released criminal history", `${k.case_no} to ${to}${b.agency ? `, ${clean(b.agency, 120)}` : ""} (${method})`);
      return send(res, 200, { ok: true, ...decrypt(j.secret), kind: j.kind, runOn: ymd(j.run_on), runBy: j.run_by, caseNo: k.case_no });
    }
    if (sub === "purge" && req.method === "POST") {
      if (!r.manage) throw err(403, "Only the Chief of Fire Prevention can purge criminal history.");
      const b = await jsonBody(req);
      const reason = clean(b.reason, 300);
      if (!reason) throw err(400, "Say why it's being purged.");
      await pool.query("UPDATE inv_cji SET secret = NULL, file = NULL, purged_at = now(), purged_by = $2, purge_reason = $3 WHERE id = $1", [id, user.name, reason]);
      await logView(req, user, k, `Purged criminal history: ${reason}`);
      await audit(pool, user, "Purged criminal history", `${k.case_no}: ${reason}`);
      return send(res, 200, { ok: true });
    }
  }
  // ---- Managers: CJIS list, access log, weekly review ----
  if (what === "cjis" && req.method === "GET") {
    if (!r.manage) throw err(403, "Only the Chief of Fire Prevention keeps the CJIS list.");
    const { effectiveFor } = await import("./access.js");
    const users = (await pool.query(`SELECT u.id, u.full_name AS name, u.role, u.job_title AS title, d.name AS division, u.totp_enabled_at AS "mfaAt", u.mfa_locked_at AS "lockedAt"
       FROM users u JOIN divisions d ON d.id = u.division_id WHERE u.active AND u.account_status = 'approved' ORDER BY u.full_name`)).rows;
    const out = [];
    for (const u of users) {
      const eff = u.role === "master" ? [{ section: "investigations", level: "manage" }] : (await effectiveFor(pool, u.id)).filter(g => g.section === "investigations");
      const cj = await cjisStatus(u.id);
      if (!eff.length && !cj.listed) continue;
      out.push({ ...u, level: eff.some(g => g.level === "manage") ? "manage" : eff.length ? "edit" : "", cjis: cj });
    }
    return send(res, 200, { people: out });
  }
  if (what === "cjis" && req.method === "POST") {
    if (!r.manage) throw err(403, "Only the Chief of Fire Prevention keeps the CJIS list.");
    const b = await jsonBody(req);
    if (id && sub === "revoke") {
      if (!isUuid(id)) throw err(400, "Bad id");
      await pool.query("UPDATE inv_cjis_people SET revoked_at = now(), revoked_by = $2 WHERE user_id = $1", [id, user.name]);
      await pool.query("UPDATE sessions SET mfa_at = NULL WHERE user_id = $1", [id]);
      const n = (await pool.query("SELECT full_name FROM users WHERE id = $1", [id])).rows[0]?.full_name || id;
      await logView(req, user, null, `Removed ${n} from the CJIS list`);
      await audit(pool, user, "Removed from CJIS list", n);
      return send(res, 200, { ok: true });
    }
    if (!isUuid(b.userId)) throw err(400, "Choose a person.");
    for (const f of ["backgroundDate", "trainingDate"]) if (b[f] && (!DAY.test(b[f]) || b[f] > localToday())) throw err(400, "Dates must be real dates, not in the future.");
    const n = (await pool.query("SELECT full_name FROM users WHERE id = $1 AND active", [b.userId])).rows[0]?.full_name;
    if (!n) throw err(404, "Person not found.");
    await pool.query(`INSERT INTO inv_cjis_people (user_id, background_date, background_ref, training_date, note, authorized_by) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET background_date = $2, background_ref = $3, training_date = $4, note = $5, authorized_by = $6, authorized_at = now(), revoked_at = NULL, revoked_by = ''`,
      [b.userId, b.backgroundDate || null, clean(b.backgroundRef, 80), b.trainingDate || null, clean(b.note, 300), user.name]);
    await logView(req, user, null, `Updated ${n} on the CJIS list`);
    await audit(pool, user, "CJIS list", `${n}: background ${b.backgroundDate || "—"}, training ${b.trainingDate || "—"}`);
    return send(res, 200, { ok: true });
  }
  if (what === "log" && req.method === "GET") {
    if (!r.manage) throw err(403, "Only the Chief of Fire Prevention reviews the access log.");
    const from = DAY.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const to = DAY.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : localToday();
    const who = clean(url.searchParams.get("user"), 80).toLowerCase(), kno = clean(url.searchParams.get("case"), 20);
    const rows = (await pool.query(`SELECT at, user_name AS "user", case_no AS "caseNo", what, ip FROM inv_access_log WHERE at >= $1::date AND at < $2::date + 1 ORDER BY at DESC LIMIT 5000`, [from, to])).rows
      .filter(x => (!who || x.user.toLowerCase().includes(who)) && (!kno || x.caseNo === kno));
    const fails = (await pool.query(`SELECT occurred_at AS at, actor_name AS "user", action AS what, detail FROM audit_log WHERE module = 'Accounts' AND action IN ('Sign-in failed', 'Wrong authenticator code', 'Authenticator locked', 'Released authenticator lock', 'Reset authenticator') AND occurred_at >= $1::date AND occurred_at < $2::date + 1 ORDER BY occurred_at DESC LIMIT 500`, [from, to])).rows;
    const reviews = (await pool.query(`SELECT week_start::text AS "weekStart", reviewed_by AS "by", reviewed_at AS "at", note FROM inv_reviews ORDER BY week_start DESC LIMIT 12`)).rows;
    if (url.searchParams.get("format") === "csv") {
      const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const body = [["When", "Who", "Case", "What", "From"], ...rows.map(x => [new Date(x.at).toISOString(), x.user, x.caseNo, x.what, x.ip])].map(l => l.map(q).join(",")).join("\r\n");
      await logView(req, user, null, `Exported the access log ${from} to ${to}`);
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="investigations-access-${from}-${to}.csv"`, "Cache-Control": "no-store" });
      return res.end("﻿" + body);
    }
    await logView(req, user, null, `Reviewed the access log ${from} to ${to}`);
    return send(res, 200, { from, to, rows, fails, reviews });
  }
  if (what === "reviews" && req.method === "POST") {
    if (!r.manage) throw err(403, "Only the Chief of Fire Prevention signs off the weekly review.");
    const b = await jsonBody(req);
    if (!DAY.test(b.weekStart || "")) throw err(400, "Pick the week.");
    await pool.query(`INSERT INTO inv_reviews (id, week_start, reviewed_by, note) VALUES ($1, $2, $3, $4) ON CONFLICT (week_start) DO UPDATE SET reviewed_by = $3, reviewed_at = now(), note = $4`,
      [crypto.randomUUID(), b.weekStart, user.name, clean(b.note, 1000)]);
    await logView(req, user, null, `Signed off the access log review for the week of ${b.weekStart}`);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}
