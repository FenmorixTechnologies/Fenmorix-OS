// Call alerts (/api/callalerts): push notifications for Active calls that match a rule. After each CAD check (cad.js
// refreshCalls -> checkCallAlerts) every active rule is tested against calls received in the last CALL_ALERT_MAX_AGE_MINUTES (30);
// a rule fires once per call (call_alert_sent), as soon as the call matches: e.g. a rule on unit "EG61*" fires when that unit is
// assigned. Delivery = Web Push (push.js sendToUser; skipped while someone runs a Command Board) + live event "callalert" (toast).
// The notification shows call type, units, agency, priority; the address only when the rule says so (lock screens).
//
//   GET  /api/callalerts                 my alerts (rules that reach me, my own rules), recent alerts to me, rights, agencies seen
//   GET  /api/callalerts/rules           every department rule + recent sends                                     (callalerts edit)
//   POST /api/callalerts/rules           {id?, name, active, match, recipients, important, onDutyOnly, showAddress, personal}
//   POST /api/callalerts/rules/:id/remove
//   POST /api/callalerts/rules/:id/mute  {muted}        stop / start one department rule for me
//   POST /api/callalerts/test            {match}        which active calls a rule would match right now (no sending)
//
// Rights: everyone makes personal rules (owner = them, recipients = them). Department rules (people / groups): access section
// "callalerts" edit. Audit module "Call alerts".
import { pool } from "./db.js";
import { hasAccess, allGroupMembers } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const list = (v, n = 40, len = 60) => (Array.isArray(v) ? v : String(v || "").split(",")).map(x => clean(x, len)).filter(Boolean).slice(0, n);
const maxAge = () => Math.min(24 * 60, Math.max(5, Number(process.env.CALL_ALERT_MAX_AGE_MINUTES) || 30));

// EG61* / ??613 / MD687: whole call signs, ? = one letter or digit, * = any run
const unitRe = p => new RegExp(`^${p.toLowerCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, "[a-z0-9]").replace(/\*/g, "[a-z0-9]*")}$`);
export function cleanMatch(m = {}) {
  return { agencies: list(m.agencies, 30), types: list(m.types, 40), exclude: list(m.exclude, 40), units: list(m.units, 40, 20).map(u => u.toUpperCase()),
    priorities: list(m.priorities, 10, 10) };
}
// Does this call match? Returns the matching units (or [] when the rule has no unit filter), or null.
export function callMatches(m, call) {
  const type = String(call.type || "").toLowerCase();
  if (m.agencies.length && !m.agencies.some(a => a.toLowerCase() === String(call.agency || "").toLowerCase())) return null;
  if (m.types.length && !m.types.some(t => type.includes(t.toLowerCase()))) return null;
  if (m.exclude.some(t => type.includes(t.toLowerCase()))) return null;
  if (m.priorities.length && !m.priorities.includes(String(call.priority || ""))) return null;
  if (!m.types.length && !m.units.length && !m.agencies.length && !m.priorities.length) return null;     // a rule must say something
  if (m.units.length) {
    const res = m.units.map(unitRe), hit = (call.units || []).filter(u => res.some(r => r.test(String(u).toLowerCase())));
    return hit.length ? hit : null;
  }
  if (!type.trim() && !(call.units || []).length) return null;   // CAD placeholders
  return [];
}
const ruleJson = (r, extra = {}) => ({ id: r.id, name: r.name, active: r.active, personal: !!r.owner_id, ownerId: r.owner_id, match: { ...cleanMatch(), ...(r.match || {}) },
  recipients: r.recipients || [], important: r.important, onDutyOnly: r.on_duty_only, showAddress: r.show_address, updatedAt: r.updated_at, ...extra });

async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Call alerts', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}

// Who a rule reaches right now (minus people who muted it)
const nameKey = n => String(n || "").toLowerCase().replace(/[^a-z ,]/g, " ").split(/[\s,]+/).filter(Boolean).sort().join(" ");
async function recipientsOf(rule, groups, users, mutes, onDutyKeys) {
  const ids = new Set();
  if (rule.owner_id) ids.add(rule.owner_id);
  else for (const x of rule.recipients || []) {
    if (x.kind === "group") for (const id of groups.get(x.id) || []) ids.add(id);
    else if (isUuid(x.id)) ids.add(x.id);
  }
  return [...ids].filter(id => users.has(id) && !mutes.has(`${rule.id}|${id}`)
    && (!rule.on_duty_only || !onDutyKeys || onDutyKeys.has(nameKey(users.get(id)))));
}

let running = false;
export async function checkCallAlerts(calls) {
  if (running) return;
  running = true;
  try {
    const cutoff = Date.now() - maxAge() * 60e3;
    const fresh = (calls || []).filter(c => c.id && (!c.receivedAt || Date.parse(c.receivedAt) >= cutoff));
    if (!fresh.length) return;
    const rules = (await pool.query("SELECT * FROM call_alert_rules WHERE active")).rows;
    if (!rules.length) return;
    let ctx = null;
    const context = async () => {
      if (ctx) return ctx;
      const users = new Map((await pool.query("SELECT id, full_name FROM users WHERE active AND account_status = 'approved'")).rows.map(u => [u.id, u.full_name]));
      const groups = new Map((await allGroupMembers(pool)).map(g => [g.id, g.ids]));
      const mutes = new Set((await pool.query("SELECT rule_id, user_id FROM call_alert_mutes")).rows.map(r => `${r.rule_id}|${r.user_id}`));
      let onDutyKeys = null;
      try { const { onDuty } = await import("./aladtec.js"); const d = onDuty(); if (Array.isArray(d?.assignments) && d.assignments.length) onDutyKeys = new Set(d.assignments.map(a => nameKey(a.name))); } catch { onDutyKeys = null; }
      return (ctx = { users, groups, mutes, onDutyKeys });
    };
    const { sendToUser } = await import("./push.js");
    const { publish } = await import("./events.js");
    for (const call of fresh) {
      for (const rule of rules) {
        const m = { ...cleanMatch(), ...(rule.match || {}) };
        const hit = callMatches(m, call);
        if (!hit) continue;
        // Claim it first: one alert per rule and call, even across restarts
        const claimed = (await pool.query(`INSERT INTO call_alert_sent (rule_id, incident_id, call_number, call_type, units, agency) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING RETURNING rule_id`, [rule.id, call.id, clean(call.number, 40), clean(call.type, 80), (call.units || []).join(", ").slice(0, 300), clean(call.agency, 60)])).rows[0];
        if (!claimed) continue;
        const c = await context();
        const ids = await recipientsOf(rule, c.groups, c.users, c.mutes, c.onDutyKeys);
        const units = (call.units || []).join(", ");
        const title = `${call.type || "Call"}${call.priority ? ` · P${call.priority}` : ""}`;
        const body = [units ? `Units: ${units}` : "Waiting for units", call.agency, rule.show_address ? [call.address, call.city].filter(Boolean).join(", ") : ""].filter(Boolean).join("\n");
        let devices = 0;
        for (const id of ids) devices += await sendToUser(id, { title, body, url: "/?calls=1", tag: `call-${call.id}`, important: rule.important });
        publish(ids, "callalert", { incidentId: call.id, number: call.number, type: call.type, priority: call.priority, units: call.units || [], agency: call.agency,
          address: rule.show_address ? [call.address, call.city].filter(Boolean).join(", ") : "", rule: rule.name, important: rule.important });
        await pool.query("UPDATE call_alert_sent SET people = $3, devices = $4 WHERE rule_id = $1 AND incident_id = $2", [rule.id, call.id, ids.length, devices]);
      }
    }
    await pool.query("DELETE FROM call_alert_sent WHERE sent_at < now() - interval '30 days'");
  } catch (e) { console.warn(`[Call alerts] ${e.message}`); } finally { running = false; }
}

export async function handleCallAlerts(req, res, parts, user, send, jsonBody) {
  const canDept = user.role === "master" || (await hasAccess(pool, user, "callalerts", "edit"));
  const what = parts[2] || "";
  const groupsOf = async () => (await allGroupMembers(pool)).map(g => ({ id: g.id, name: g.name, ids: g.ids }));

  if (req.method === "GET" && !what) {
    const groups = await groupsOf();
    const mine = new Set(groups.filter(g => g.ids.includes(user.id)).map(g => g.id));
    const mutes = new Set((await pool.query("SELECT rule_id FROM call_alert_mutes WHERE user_id = $1", [user.id])).rows.map(r => r.rule_id));
    const rules = (await pool.query("SELECT * FROM call_alert_rules WHERE owner_id = $1 OR owner_id IS NULL ORDER BY owner_id NULLS LAST, name", [user.id])).rows
      .filter(r => r.owner_id === user.id || (r.recipients || []).some(x => (x.kind === "group" ? mine.has(x.id) : x.id === user.id)))
      .map(r => ruleJson(r, { muted: mutes.has(r.id) }));
    const recent = (await pool.query(`SELECT s.incident_id, s.call_number, s.call_type, s.units, s.agency, s.sent_at, r.name FROM call_alert_sent s JOIN call_alert_rules r ON r.id = s.rule_id
      WHERE s.people >= 0 AND s.rule_id = ANY(string_to_array($1, ',')::uuid[]) ORDER BY s.sent_at DESC LIMIT 30`, [rules.filter(r => !r.muted).map(r => r.id).join(",") || "00000000-0000-0000-0000-000000000000"])).rows;
    const { activeCalls } = await import("./cad.js");
    const snap = activeCalls() || {};
    const pushOn = (await pool.query("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1", [user.id])).rows[0].n;
    return send(res, 200, { rules, recent, canDept, pushDevices: pushOn, cadConfigured: !!snap.configured,
      agencies: [...new Set((snap.calls || []).map(c => c.agency).filter(Boolean))].sort(),
      types: [...new Set((snap.calls || []).map(c => c.type).filter(Boolean))].sort().slice(0, 60) });
  }
  if (req.method === "GET" && what === "rules") {
    if (!canDept) throw err(403, "Department call alerts need permission (User Management › Permissions › Call alerts).");
    const rules = (await pool.query("SELECT * FROM call_alert_rules WHERE owner_id IS NULL ORDER BY name")).rows;
    const groups = await groupsOf();
    const users = new Map((await pool.query("SELECT id, full_name FROM users WHERE active AND account_status = 'approved'")).rows.map(u => [u.id, u.full_name]));
    const mutes = new Set((await pool.query("SELECT rule_id, user_id FROM call_alert_mutes")).rows.map(r => `${r.rule_id}|${r.user_id}`));
    const gmap = new Map(groups.map(g => [g.id, g.ids]));
    const out = [];
    for (const r of rules) out.push(ruleJson(r, { reaches: (await recipientsOf({ ...r, on_duty_only: false }, gmap, users, mutes, null)).length,
      mutedBy: [...mutes].filter(k => k.startsWith(`${r.id}|`)).length }));
    const sent = (await pool.query(`SELECT s.*, r.name FROM call_alert_sent s JOIN call_alert_rules r ON r.id = s.rule_id WHERE r.owner_id IS NULL AND s.people >= 0 ORDER BY s.sent_at DESC LIMIT 50`)).rows
      .map(s => ({ rule: s.name, number: s.call_number, type: s.call_type, units: s.units, agency: s.agency, at: s.sent_at, people: s.people, devices: s.devices }));
    return send(res, 200, { rules: out, sent, groups: groups.map(g => ({ id: g.id, name: g.name, size: g.ids.length })),
      people: [...users].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) });
  }
  if (req.method !== "POST") throw err(404, "Not found.");
  const b = await jsonBody(req);

  if (what === "test") {
    const m = cleanMatch(b.match);
    const { activeCalls } = await import("./cad.js");
    const calls = (activeCalls()?.calls || []).filter(c => callMatches(m, c));
    return send(res, 200, { calls: calls.slice(0, 20).map(c => ({ number: c.number, type: c.type, units: c.units, agency: c.agency, priority: c.priority })), count: calls.length });
  }
  if (what === "rules" && !parts[3]) {
    const personal = b.personal === true || !canDept;
    const match = cleanMatch(b.match);
    if (!match.types.length && !match.units.length && !match.agencies.length && !match.priorities.length) throw err(400, "Say which calls: an agency, call type words, units or priority.");
    const name = clean(b.name, 80) || [match.types.join("/"), match.units.join("/")].filter(Boolean).join(" · ").slice(0, 80) || "Call alert";
    let recipients = [];
    if (!personal) {
      recipients = (Array.isArray(b.recipients) ? b.recipients : []).filter(x => (x?.kind === "group" || x?.kind === "user") && isUuid(x.id)).slice(0, 60)
        .map(x => ({ kind: x.kind, id: x.id, name: clean(x.name, 80) }));
      if (!recipients.length) throw err(400, "Choose who gets it: people or groups.");
    }
    const vals = [name, b.active !== false, JSON.stringify(match), JSON.stringify(recipients), b.important === true, b.onDutyOnly === true, !personal && b.showAddress === true];
    let id = b.id;
    if (isUuid(id)) {
      const r = (await pool.query("SELECT * FROM call_alert_rules WHERE id = $1", [id])).rows[0];
      if (!r) throw err(404, "That alert wasn't found.");
      if (r.owner_id ? r.owner_id !== user.id : !canDept) throw err(403, "You can only change your own alerts.");
      await pool.query(`UPDATE call_alert_rules SET name = $2, active = $3, match = $4, recipients = $5, important = $6, on_duty_only = $7, show_address = $8, updated_at = now()
        WHERE id = $1`, [id, ...vals.slice(0, 3), r.owner_id ? "[]" : vals[3], ...vals.slice(4)]);
      if (!r.owner_id) await audit(user, "Changed a call alert", name);
    } else {
      id = (await pool.query(`INSERT INTO call_alert_rules (name, active, match, recipients, important, on_duty_only, show_address, owner_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [...vals, personal ? user.id : null, user.id])).rows[0].id;
      if (!personal) await audit(user, "Made a call alert", `${name} → ${recipients.map(x => x.name).join(", ")}`.slice(0, 400));
    }
    // Calls already open that match aren't news: mark them handled (people = -1) so only new activity alerts
    const { activeCalls } = await import("./cad.js");
    for (const c of (activeCalls()?.calls || []).filter(c => c.id && callMatches(match, c)))
      await pool.query(`INSERT INTO call_alert_sent (rule_id, incident_id, call_number, call_type, people) VALUES ($1, $2, $3, $4, -1) ON CONFLICT DO NOTHING`,
        [id, c.id, clean(c.number, 40), clean(c.type, 80)]);
    return send(res, 200, { ok: true, id });
  }
  if (what === "rules" && isUuid(parts[3]) && parts[4] === "remove") {
    const r = (await pool.query("SELECT * FROM call_alert_rules WHERE id = $1", [parts[3]])).rows[0];
    if (!r) throw err(404, "That alert wasn't found.");
    if (r.owner_id ? r.owner_id !== user.id : !canDept) throw err(403, "You can only remove your own alerts.");
    await pool.query("DELETE FROM call_alert_rules WHERE id = $1", [r.id]);
    if (!r.owner_id) await audit(user, "Removed a call alert", r.name);
    return send(res, 200, { ok: true });
  }
  if (what === "rules" && isUuid(parts[3]) && parts[4] === "mute") {
    const r = (await pool.query("SELECT id, owner_id FROM call_alert_rules WHERE id = $1", [parts[3]])).rows[0];
    if (!r || r.owner_id) throw err(404, "That alert wasn't found.");
    if (b.muted === false) await pool.query("DELETE FROM call_alert_mutes WHERE rule_id = $1 AND user_id = $2", [r.id, user.id]);
    else await pool.query("INSERT INTO call_alert_mutes (rule_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [r.id, user.id]);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found.");
}
