// Clients & Quotes (module "sales", opt-in, vendor tool): Fenmorix Technologies' client book, secure vault, price book and quotes.
// Lives only on the vendor's office install; packaging/owners.json keeps it (and src/Sales.jsx, src/pricing.js) out of customer packages.
// Prices are always computed by src/pricing.js calculate(): the client sends inputs, the server recomputes and stores the result with a
// snapshot of the price book, so a sent quote never changes when the book does. Sent / accepted / declined quotes are locked (copy to revise).
//
//   GET  /api/sales                         {clients, quotes (recent), totals, rights}
//   GET  /api/sales/logo                    the vendor logo (png) for printed documents
//   GET  /api/sales/book                    {book, defaults, saved}          POST /api/sales/book {book} (manage)   POST /api/sales/book/reset (manage)
//   GET  /api/sales/clients/:id             {client, vault (no secrets), quotes, activity}
//   POST /api/sales/clients                 {id?, name, kind, status, website, address, city, state, zip, instanceUrl, licenseId, modules,
//                                            renewalDate, notes, contacts, currentSpend}   (edit)
//   POST /api/sales/clients/:id/remove      (manage; only with no quotes)
//   POST /api/sales/clients/:id/vault       {id?, label, kind, host, secret?: {user, password, note} | {clear}}   (manage)
//   POST /api/sales/vault/:id/reveal        (manage; 30 an hour; audited)   POST /api/sales/vault/:id/remove (manage)
//   POST /api/sales/clients/:id/activity    {day, kind, body, hours, billable}   (edit)   POST /api/sales/activity/:id/remove (edit)
//   GET  /api/sales/quotes/:id              {quote, client}
//   POST /api/sales/quotes                  {id?, clientId, title, inputs, notes, internalNotes, validDays?}   (edit; drafts only)
//   POST /api/sales/quotes/:id/status       {status: draft|sent|accepted|declined|expired}
//   POST /api/sales/quotes/:id/copy         -> new draft priced with today's book       POST /api/sales/quotes/:id/remove (drafts)
//   POST /api/sales/calc                    {inputs} -> result (preview with the current book; nothing saved)
import fs from "node:fs";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { encrypt, decrypt } from "./forms.js";
import { allow } from "./ratelimit.js";
import { DEFAULT_BOOK, DEFAULT_INPUTS, calculate, mergeBook } from "../src/pricing.js";
import { MODULE_KEYS } from "../src/modules.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, n);
const line = (v, n) => clean(v, n).replace(/[\r\n\t]+/g, " ");
const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const KINDS = ["ps", "biz", "gov"], STATUSES = ["prospect", "active", "former", "lost"];
const VAULT_KINDS = ["server", "login", "database", "key", "note", "other"];
const ACT_KINDS = ["note", "call", "email", "meeting", "work", "support"];
const Q_STATUSES = ["draft", "sent", "accepted", "declined", "expired"];

async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Clients & Quotes', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, line(detail, 500)]);
}
export async function currentBook() {
  const r = (await pool.query("SELECT value FROM settings WHERE key = 'sales_pricebook'")).rows[0];
  return mergeBook(r?.value);
}
function cleanContacts(v) {
  return (Array.isArray(v) ? v : []).slice(0, 30).map(c => ({ name: line(c?.name, 120), title: line(c?.title, 120), email: line(c?.email, 200),
    phone: line(c?.phone, 60), primary: !!c?.primary, note: line(c?.note, 300) })).filter(c => c.name || c.email || c.phone);
}
function cleanSpend(v) {
  return (Array.isArray(v) ? v : []).slice(0, 30).map(s => ({ label: line(s?.label, 120), annual: num(s?.annual, 0, 1e8) })).filter(s => s.label || s.annual);
}
// Inputs kept to what calculate() reads, bounded
function cleanInputs(v) {
  const i = { ...DEFAULT_INPUTS, ...(v && typeof v === "object" ? v : {}) };
  return {
    segment: ["ps", "biz"].includes(i.segment) ? i.segment : "ps", users: Math.round(num(i.users, 1, 100000)), edition: line(i.edition, 40),
    addons: (Array.isArray(i.addons) ? i.addons : []).map(a => line(a, 40)).slice(0, 20), screens: Math.round(num(i.screens, 0, 100)),
    environments: line(i.environments, 20) || "none", dr: line(i.dr, 20) || "standard", support: line(i.support, 20) || "standard",
    termYears: Math.round(num(i.termYears, 1, 10)) || 1, founding: !!i.founding, delivery: i.delivery === "onprem" ? "onprem" : "hosted",
    members: Math.round(num(i.members, 1, 50)) || 1, implementation: i.implementation !== false, cadIntegrations: Math.round(num(i.cadIntegrations, 0, 20)),
    cadKind: ["existing", "new"].includes(i.cadKind) ? i.cadKind : "none", cadSystems: Math.round(num(i.cadSystems, 1, 10)) || 1, cadVendor: line(i.cadVendor, 80),
    cadExtraViews: Math.round(num(i.cadExtraViews, 0, 50)), cadCustomHours: num(i.cadCustomHours, 0, 1000),
    migrationHours: num(i.migrationHours, 0, 2000), trainingDays: num(i.trainingDays, 0, 60), prepaidBlocks: Math.round(num(i.prepaidBlocks, 0, 20)),
    manualDiscount: num(i.manualDiscount, 0, 50),
    customLines: (Array.isArray(i.customLines) ? i.customLines : []).slice(0, 20).map(c => ({ label: line(c?.label, 200), amount: num(c?.amount, -1e7, 1e7), kind: c?.kind === "annual" ? "annual" : "once" })).filter(c => c.label),
    currentSpend: cleanSpend(i.currentSpend),
    hostingAnnual: num(i.hostingAnnual, 0, 1e8), hostingOneTime: num(i.hostingOneTime, 0, 1e8), hostingNote: line(i.hostingNote, 300),
  };
}
const clientJson = r => ({
  id: r.id, name: r.name, kind: r.kind, status: r.status, website: r.website, address: r.address, city: r.city, state: r.state, zip: r.zip,
  instanceUrl: r.instance_url, licenseId: r.license_id, modules: r.modules || [], renewalDate: r.renewal_date ? String(r.renewal_date).slice(0, 10) : null,
  notes: r.notes, contacts: r.contacts || [], currentSpend: r.current_spend || [], createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.quotes !== undefined ? { quotes: Number(r.quotes), openValue: Number(r.open_value || 0), wonValue: Number(r.won_value || 0), lastActivity: r.last_activity } : {}),
});
const quoteJson = (r, full) => ({
  id: r.id, number: r.number, clientId: r.client_id, clientName: r.client_name, title: r.title, status: r.status, validUntil: r.valid_until ? String(r.valid_until).slice(0, 10) : null,
  year1: Number(r.result?.year1Recurring || 0), oneTime: Number(r.result?.oneTimeTotal || 0), contractValue: Number(r.result?.contractValue || 0),
  edition: r.result?.edition?.label || "", decidedBy: r.decided_by || "", decidedNote: r.decided_note || "", createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, decidedAt: r.decided_at, createdBy: r.created_by_name,
  ...(full ? { inputs: r.inputs, result: r.result, book: r.book, notes: r.notes, internalNotes: r.internal_notes } : {}),
});
async function nextNumber(c) {
  const y = new Date().getFullYear();
  await c.query("SELECT pg_advisory_xact_lock(hashtext('sales-quote-number'))");
  const r = (await c.query("SELECT number FROM sales_quotes WHERE number LIKE $1 ORDER BY number DESC LIMIT 1", [`Q-${y}-%`])).rows[0];
  const n = r ? Number(r.number.split("-")[2]) + 1 : 1;
  return `Q-${y}-${String(n).padStart(4, "0")}`;
}
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const out = await fn(c); await c.query("COMMIT"); return out; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

export async function handleSales(req, res, parts, user, send, jsonBody) {
  const master = user.role === "master";
  const canView = master || (await hasAccess(pool, user, "sales", "view"));
  if (!canView) throw err(403, "Clients & Quotes is only for the people who sell and support Fenmorix OS.");
  const canEdit = master || (await hasAccess(pool, user, "sales", "edit"));
  const canManage = master || (await hasAccess(pool, user, "sales", "manage"));
  const rights = { canEdit, canManage };
  const needEdit = () => { if (!canEdit) throw err(403, "You can look, but not change clients or quotes."); };
  const needManage = () => { if (!canManage) throw err(403, "Only a manager of Clients & Quotes can do that."); };
  const [, , a, id, b2] = parts;

  if (req.method === "GET") {
    // The Fenmorix Technologies logo for printed quotes (always the vendor's, whatever this install is branded as)
    if (a === "logo") {
      const f = new URL("../public/brand-fenmorix/vendor-logo.png", import.meta.url);
      if (!fs.existsSync(f)) throw err(404, "No logo.");
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
      return res.end(fs.readFileSync(f));
    }
    if (!a) {
      // Expire sent quotes past their date
      await pool.query("UPDATE sales_quotes SET status = 'expired', decided_at = now() WHERE status = 'sent' AND valid_until < CURRENT_DATE");
      const clients = (await pool.query(`SELECT c.*,
          (SELECT count(*) FROM sales_quotes q WHERE q.client_id = c.id) AS quotes,
          (SELECT COALESCE(sum((q.result->>'contractValue')::numeric), 0) FROM sales_quotes q WHERE q.client_id = c.id AND q.status = 'sent') AS open_value,
          (SELECT COALESCE(sum((q.result->>'contractValue')::numeric), 0) FROM sales_quotes q WHERE q.client_id = c.id AND q.status = 'accepted') AS won_value,
          (SELECT max(day) FROM sales_activity s WHERE s.client_id = c.id) AS last_activity
        FROM sales_clients c ORDER BY lower(c.name)`)).rows.map(clientJson);
      const quotes = (await pool.query(`SELECT q.*, c.name AS client_name FROM sales_quotes q JOIN sales_clients c ON c.id = q.client_id
        ORDER BY q.updated_at DESC LIMIT 100`)).rows.map(r => quoteJson(r));
      const t = (await pool.query(`SELECT
          COALESCE(sum((result->>'contractValue')::numeric) FILTER (WHERE status = 'sent'), 0) AS pipeline,
          count(*) FILTER (WHERE status = 'sent') AS open,
          COALESCE(sum((result->>'year1Recurring')::numeric) FILTER (WHERE status = 'accepted'), 0) AS won_yearly,
          count(*) FILTER (WHERE status = 'accepted') AS won
        FROM sales_quotes`)).rows[0];
      const hours = (await pool.query(`SELECT COALESCE(sum(hours), 0) AS h, COALESCE(sum(hours) FILTER (WHERE billable), 0) AS b FROM sales_activity
        WHERE day >= date_trunc('month', CURRENT_DATE)`)).rows[0];
      const renewals = clients.filter(c => c.renewalDate && c.status === "active" && new Date(c.renewalDate) - Date.now() < 90 * 864e5).length;
      return send(res, 200, { clients, quotes, totals: { pipeline: Number(t.pipeline), open: Number(t.open), wonYearly: Number(t.won_yearly), won: Number(t.won),
        hoursThisMonth: Number(hours.h), billableThisMonth: Number(hours.b), renewalsSoon: renewals }, rights, moduleKeys: MODULE_KEYS });
    }
    if (a === "book") {
      const r = (await pool.query("SELECT value, updated_at FROM settings WHERE key = 'sales_pricebook'")).rows[0];
      return send(res, 200, { book: mergeBook(r?.value), defaults: DEFAULT_BOOK, saved: r ? r.updated_at : null, rights });
    }
    if (a === "clients" && isUuid(id)) {
      const c = (await pool.query("SELECT * FROM sales_clients WHERE id = $1", [id])).rows[0];
      if (!c) throw err(404, "That client isn't here.");
      const vault = canManage ? (await pool.query(`SELECT id, label, kind, host, secret IS NOT NULL AS has_secret, updated_by_name, updated_at
        FROM sales_vault WHERE client_id = $1 ORDER BY kind, lower(label)`, [id])).rows.map(v => ({ id: v.id, label: v.label, kind: v.kind, host: v.host,
        hasSecret: v.has_secret, updatedBy: v.updated_by_name, updatedAt: v.updated_at })) : null;
      const quotes = (await pool.query("SELECT q.*, $2::text AS client_name FROM sales_quotes q WHERE client_id = $1 ORDER BY created_at DESC", [id, c.name])).rows.map(r => quoteJson(r));
      const activity = (await pool.query("SELECT * FROM sales_activity WHERE client_id = $1 ORDER BY day DESC, created_at DESC LIMIT 300", [id])).rows
        .map(r => ({ id: r.id, day: String(r.day).slice(0, 10), kind: r.kind, body: r.body, hours: Number(r.hours), billable: r.billable, by: r.by_name }));
      return send(res, 200, { client: clientJson(c), vault, quotes, activity, rights });
    }
    if (a === "quotes" && isUuid(id)) {
      const q = (await pool.query("SELECT q.*, c.name AS client_name FROM sales_quotes q JOIN sales_clients c ON c.id = q.client_id WHERE q.id = $1", [id])).rows[0];
      if (!q) throw err(404, "That quote isn't here.");
      const c = (await pool.query("SELECT * FROM sales_clients WHERE id = $1", [q.client_id])).rows[0];
      return send(res, 200, { quote: quoteJson(q, true), client: clientJson(c), rights });
    }
    throw err(404, "Not found");
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  if (a === "calc") return send(res, 200, { result: calculate(cleanInputs(b.inputs), await currentBook()) });

  if (a === "book") {
    needManage();
    if (id === "reset") {
      await pool.query("DELETE FROM settings WHERE key = 'sales_pricebook'");
      await audit(user, "Reset the price book", "Back to the defaults");
      return send(res, 200, { book: mergeBook(null) });
    }
    const book = mergeBook(b.book);
    const text = JSON.stringify(book);
    if (text.length > 200_000) throw err(400, "That price book is too large.");
    // Prove it still prices: a quote with the defaults must calculate
    try { calculate(DEFAULT_INPUTS, book); calculate({ ...DEFAULT_INPUTS, segment: "biz", edition: book.segments.biz.editions[0]?.key }, book); }
    catch { throw err(400, "That price book can't price a quote. Check the editions and sizes."); }
    await pool.query(`INSERT INTO settings (key, value, updated_at) VALUES ('sales_pricebook', $1, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [text]);
    await audit(user, "Changed the price book", "");
    return send(res, 200, { book });
  }

  if (a === "clients" && !id) {
    needEdit();
    const name = line(b.name, 160);
    if (!name) throw err(400, "Give the client a name.");
    const vals = [name, KINDS.includes(b.kind) ? b.kind : "ps", STATUSES.includes(b.status) ? b.status : "prospect", line(b.website, 300), line(b.address, 200),
      line(b.city, 80), line(b.state, 40), line(b.zip, 20), line(b.instanceUrl, 300), line(b.licenseId, 80),
      JSON.stringify((Array.isArray(b.modules) ? b.modules : []).filter(k => MODULE_KEYS.includes(k))), day(b.renewalDate), clean(b.notes, 8000),
      JSON.stringify(cleanContacts(b.contacts)), JSON.stringify(cleanSpend(b.currentSpend))];
    let cid = b.id;
    if (cid) {
      if (!isUuid(cid)) throw err(400, "Which client?");
      const r = await pool.query(`UPDATE sales_clients SET name=$1, kind=$2, status=$3, website=$4, address=$5, city=$6, state=$7, zip=$8, instance_url=$9,
        license_id=$10, modules=$11, renewal_date=$12, notes=$13, contacts=$14, current_spend=$15, updated_at=now() WHERE id=$16`, [...vals, cid]);
      if (!r.rowCount) throw err(404, "That client is gone.");
      await audit(user, "Changed a client", name);
    } else {
      cid = (await pool.query(`INSERT INTO sales_clients (name, kind, status, website, address, city, state, zip, instance_url, license_id, modules, renewal_date,
        notes, contacts, current_spend, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [...vals, user.id])).rows[0].id;
      await audit(user, "Added a client", name);
    }
    return send(res, 200, { ok: true, id: cid });
  }
  if (a === "clients" && isUuid(id) && b2 === "remove") {
    needManage();
    const n = Number((await pool.query("SELECT count(*) FROM sales_quotes WHERE client_id = $1", [id])).rows[0].count);
    if (n) throw err(409, "This client has quotes. Mark the client Former or Lost instead.");
    const r = (await pool.query("DELETE FROM sales_clients WHERE id = $1 RETURNING name", [id])).rows[0];
    if (!r) throw err(404, "That client is gone.");
    await audit(user, "Removed a client", r.name);
    return send(res, 200, { ok: true });
  }
  if (a === "clients" && isUuid(id) && b2 === "vault") {
    needManage();
    const c = (await pool.query("SELECT name FROM sales_clients WHERE id = $1", [id])).rows[0];
    if (!c) throw err(404, "That client isn't here.");
    const label = line(b.label, 160);
    if (!label) throw err(400, "Name this entry (for example: Production server SSH).");
    const kind = VAULT_KINDS.includes(b.kind) ? b.kind : "login";
    const host = line(b.host, 300);
    const s = b.secret;
    const secret = s && !s.clear && (s.user || s.password || s.note)
      ? encrypt({ user: line(s.user, 300), password: String(s.password ?? "").slice(0, 8000), note: clean(s.note, 4000) }) : undefined;
    let vid = b.id;
    if (vid) {
      if (!isUuid(vid)) throw err(400, "Which entry?");
      const set = secret !== undefined ? ", secret = $7" : s?.clear ? ", secret = NULL" : "";
      const args = [label, kind, host, user.name, vid, id, ...(secret !== undefined ? [secret] : [])];
      const r = await pool.query(`UPDATE sales_vault SET label=$1, kind=$2, host=$3, updated_by_name=$4, updated_at=now()${set} WHERE id=$5 AND client_id=$6`, args);
      if (!r.rowCount) throw err(404, "That entry is gone.");
      await audit(user, secret !== undefined ? "Changed a vault login" : "Changed a vault entry", `${c.name}: ${label}`);
    } else {
      vid = (await pool.query(`INSERT INTO sales_vault (client_id, label, kind, host, secret, updated_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [id, label, kind, host, secret ?? null, user.name])).rows[0].id;
      await audit(user, "Added a vault entry", `${c.name}: ${label}`);
    }
    return send(res, 200, { ok: true, id: vid });
  }
  if (a === "vault" && isUuid(id)) {
    needManage();
    const v = (await pool.query("SELECT v.*, c.name AS client FROM sales_vault v JOIN sales_clients c ON c.id = v.client_id WHERE v.id = $1", [id])).rows[0];
    if (!v) throw err(404, "That entry is gone.");
    if (b2 === "reveal") {
      if (!v.secret) throw err(404, "Nothing is stored for this entry.");
      if (!allow(`sales-reveal:${user.id}`, 30, 3600e3)) throw err(429, "That's a lot of logins in an hour. Try again later.");
      const s = decrypt(v.secret);
      await audit(user, "Revealed a vault login", `${v.client}: ${v.label}`);
      return send(res, 200, { user: s.user || "", password: s.password || "", note: s.note || "" });
    }
    if (b2 === "remove") {
      await pool.query("DELETE FROM sales_vault WHERE id = $1", [id]);
      await audit(user, "Removed a vault entry", `${v.client}: ${v.label}`);
      return send(res, 200, { ok: true });
    }
  }
  if (a === "clients" && isUuid(id) && b2 === "activity") {
    needEdit();
    const body = clean(b.body, 8000);
    if (!body) throw err(400, "Write what happened.");
    const r = await pool.query(`INSERT INTO sales_activity (client_id, day, kind, body, hours, billable, by_name)
      SELECT $1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7 WHERE EXISTS (SELECT 1 FROM sales_clients WHERE id = $1) RETURNING id`,
      [id, day(b.day), ACT_KINDS.includes(b.kind) ? b.kind : "note", body, Math.round(num(b.hours, 0, 24) * 4) / 4, !!b.billable, user.name]);
    if (!r.rowCount) throw err(404, "That client isn't here.");
    return send(res, 200, { ok: true, id: r.rows[0].id });
  }
  if (a === "activity" && isUuid(id) && b2 === "remove") {
    needEdit();
    await pool.query("DELETE FROM sales_activity WHERE id = $1", [id]);
    return send(res, 200, { ok: true });
  }

  if (a === "quotes" && !id) {
    needEdit();
    if (!isUuid(b.clientId)) throw err(400, "Pick the client this quote is for.");
    const book = await currentBook();
    const inputs = cleanInputs(b.inputs);
    const result = calculate(inputs, book);
    const valid = new Date(Date.now() + num(b.validDays || book.quoteValidDays, 1, 365) * 864e5).toISOString().slice(0, 10);
    const out = await tx(async c => {
      const cl = (await c.query("SELECT name FROM sales_clients WHERE id = $1", [b.clientId])).rows[0];
      if (!cl) throw err(404, "That client isn't here.");
      const title = line(b.title, 200) || `${result.edition.label} for ${cl.name}`;
      if (b.id) {
        if (!isUuid(b.id)) throw err(400, "Which quote?");
        const q = (await c.query("SELECT status FROM sales_quotes WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
        if (!q) throw err(404, "That quote is gone.");
        if (q.status !== "draft") throw err(409, "This quote has been sent, so it can't change. Make a copy to revise it.");
        await c.query(`UPDATE sales_quotes SET client_id=$2, title=$3, inputs=$4, result=$5, book=$6, valid_until=$7, notes=$8, internal_notes=$9, updated_at=now() WHERE id=$1`,
          [b.id, b.clientId, title, JSON.stringify(inputs), JSON.stringify(result), JSON.stringify(book), valid, clean(b.notes, 8000), clean(b.internalNotes, 8000)]);
        return { id: b.id, title };
      }
      const number = await nextNumber(c);
      const qid = (await c.query(`INSERT INTO sales_quotes (number, client_id, title, inputs, result, book, valid_until, notes, internal_notes, created_by, created_by_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [number, b.clientId, title, JSON.stringify(inputs), JSON.stringify(result), JSON.stringify(book), valid,
        clean(b.notes, 8000), clean(b.internalNotes, 8000), user.id, user.name])).rows[0].id;
      return { id: qid, number, title, client: cl.name };
    });
    if (out.number) await audit(user, "Started a quote", `${out.number} · ${out.client}`);
    return send(res, 200, { ok: true, id: out.id, number: out.number });
  }
  if (a === "quotes" && isUuid(id)) {
    const q = (await pool.query("SELECT q.*, c.name AS client_name FROM sales_quotes q JOIN sales_clients c ON c.id = q.client_id WHERE q.id = $1", [id])).rows[0];
    if (!q) throw err(404, "That quote is gone.");
    needEdit();
    if (b2 === "status") {
      const st = Q_STATUSES.includes(b.status) ? b.status : null;
      if (!st) throw err(400, "Which status?");
      if (st === "draft" && q.status !== "sent") throw err(409, "Only a sent quote can go back to draft.");
      await pool.query(`UPDATE sales_quotes SET status = $2, updated_at = now(),
          sent_at = CASE WHEN $2 = 'sent' THEN now() WHEN $2 = 'draft' THEN NULL ELSE sent_at END,
          decided_at = CASE WHEN $2 IN ('accepted', 'declined', 'expired') THEN now() ELSE NULL END,
          valid_until = CASE WHEN $2 = 'sent' AND (valid_until IS NULL OR valid_until < CURRENT_DATE) THEN CURRENT_DATE + 30 ELSE valid_until END
        WHERE id = $1`, [id, st]);
      if (st === "accepted") await pool.query("UPDATE sales_clients SET status = 'active', modules = $2, updated_at = now() WHERE id = $1",
        [q.client_id, JSON.stringify(q.result?.modules || [])]);
      await audit(user, `Marked a quote ${st}`, `${q.number} · ${q.client_name}`);
      return send(res, 200, { ok: true });
    }
    if (b2 === "copy") {
      const book = await currentBook();
      const result = calculate(q.inputs, book);
      const valid = new Date(Date.now() + book.quoteValidDays * 864e5).toISOString().slice(0, 10);
      const out = await tx(async c => {
        const number = await nextNumber(c);
        const nid = (await c.query(`INSERT INTO sales_quotes (number, client_id, title, inputs, result, book, valid_until, notes, internal_notes, created_by, created_by_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [number, q.client_id, q.title, JSON.stringify(q.inputs), JSON.stringify(result), JSON.stringify(book),
          valid, q.notes, `Copied from ${q.number}. ${q.internal_notes || ""}`.trim(), user.id, user.name])).rows[0].id;
        return { id: nid, number };
      });
      await audit(user, "Copied a quote", `${q.number} -> ${out.number}`);
      return send(res, 200, { ok: true, ...out });
    }
    if (b2 === "remove") {
      if (q.status !== "draft") throw err(409, "Only drafts can be deleted. Mark it declined or expired instead.");
      await pool.query("DELETE FROM sales_quotes WHERE id = $1", [id]);
      await audit(user, "Deleted a draft quote", `${q.number} · ${q.client_name}`);
      return send(res, 200, { ok: true });
    }
  }
  throw err(404, "Not found");
}
