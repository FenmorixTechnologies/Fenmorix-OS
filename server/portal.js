// Client portal (vendor module "sales"; only on Fenmorix Technologies' office install). Customers' contacts sign in on the portal's own
// web address (PORTAL_HOST, e.g. portal.fenmorix.com): on that host index.js answers ONLY the portal page, its scripts and /api/portal/*,
// so nothing of the office app is reachable there. Portal accounts are separate from app accounts (portal_users, own session cookie).
//
// Customer (portal host, cookie fx_portal):
//   GET  /api/portal/me                    {user, client} | 401
//   POST /api/portal/login {email, password}       POST /api/portal/logout
//   GET  /api/portal/invite?token=         {name, email}         POST /api/portal/invite {token, password}  (set password, signed in)
//   GET  /api/portal/overview              client, servers (versions vs latest), quotes, tickets, releases, docs
//   GET  /api/portal/quotes/:id/html       the printable quote      POST /api/portal/quotes/:id/accept {name, title, agree} | decline {note}
//   GET  /api/portal/tickets/:id           POST /api/portal/tickets {subject, body, priority}   POST /api/portal/tickets/:id/reply {body} | close
//   GET  /api/portal/docs/:id              a shared document         GET /api/portal/logo
// Vendor (signed in to the office app; Clients & Quotes edit, manage for accounts):
//   GET  /api/clientportal                 open requests across clients (Overview)
//   GET  /api/clientportal/:clientId       {users, tickets, docs, portalUrl}
//   POST /api/clientportal/:clientId/users {name, email} -> {link}     POST /api/clientportal/users/:id/link -> {link}   .../disable | enable
//   GET  /api/clientportal/tickets/:id     POST /api/clientportal/tickets/:id/reply {body, status}   .../status {status}
//   POST /api/clientportal/:clientId/docs  {name, note, dataUrl}        POST /api/clientportal/docs/:id/remove
import fs from "node:fs";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { hashPassword, verifyPassword, passwordProblem, readCookie } from "./auth.js";
import { allow } from "./ratelimit.js";
import { clientIp } from "./clientip.js";
import { newer } from "./updates.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const line = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
const text = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, n);
const sha = v => crypto.createHash("sha256").update(String(v)).digest("hex");
const COOKIE = "fx_portal", IDLE_MIN = 60, MAX_HOURS = 12, INVITE_DAYS = 7;
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
export const portalHosts = () => String(process.env.PORTAL_HOST || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
export const portalUrl = () => String(process.env.PORTAL_URL || (portalHosts()[0] ? `https://${portalHosts()[0]}` : "")).replace(/\/+$/, "");
export function isPortalRequest(req) {
  const hosts = portalHosts(); if (!hosts.length) return false;
  const h = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hosts.includes(h);
}
const DOC_TYPES = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx" };
function sniffDoc(buf, claimed) {
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && DOC_TYPES[claimed] && /officedocument/.test(claimed)) return claimed;
  return "";
}
async function vendorAudit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Client portal', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, line(detail, 500)]);
}
async function clientAudit(pu, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES (NULL, $1, 'Client portal', 'Client portal', $2, $3)`,
    [`${pu.name} (${pu.client_name})`, action, line(detail, 500)]);
}
// Note in the client's work log, so it shows on the client page in Clients & Quotes
const logActivity = (clientId, kind, body, by) => pool.query("INSERT INTO sales_activity (client_id, kind, body, by_name) VALUES ($1, $2, $3, $4)", [clientId, kind, line(body, 2000), by]);

// ---- Sessions ----
function setCookie(req, res, value, maxAge) {
  const secure = req.secure || String(req.headers["x-forwarded-proto"] || "") === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO portal_sessions (token_hash, user_id, ip) VALUES ($1, $2, $3)", [sha(token), userId, clientIp(req)]);
  await pool.query("UPDATE portal_users SET last_login = now() WHERE id = $1", [userId]);
  setCookie(req, res, token, MAX_HOURS * 3600);
}
async function portalUser(req) {
  const t = readCookie(req, COOKIE); if (!t) return null;
  const r = (await pool.query(`SELECT u.*, s.token_hash, s.created_at AS session_started, s.last_seen AS session_seen, c.name AS client_name, c.status AS client_status FROM portal_sessions s
    JOIN portal_users u ON u.id = s.user_id JOIN sales_clients c ON c.id = u.client_id WHERE s.token_hash = $1`, [sha(t)])).rows[0];
  if (!r) return null;
  if (!r.active || Date.now() - new Date(r.session_seen) > IDLE_MIN * 60e3 || Date.now() - new Date(r.session_started) > MAX_HOURS * 3600e3) {
    await pool.query("DELETE FROM portal_sessions WHERE token_hash = $1", [r.token_hash]); return null;
  }
  if (Date.now() - new Date(r.session_seen) > 30e3) await pool.query("UPDATE portal_sessions SET last_seen = now() WHERE token_hash = $1", [r.token_hash]);
  return r;
}
const userJson = u => ({ id: u.id, name: u.name, email: u.email, client: u.client_name });

// ---- What the customer sees ----
async function overview(pu) {
  const c = (await pool.query("SELECT * FROM sales_clients WHERE id = $1", [pu.client_id])).rows[0];
  const { MODULES } = await import("../src/modules.js");
  const names = Object.fromEntries(MODULES.map(m => [m.key, m.name]));
  const installs = (await pool.query("SELECT * FROM hub_installs WHERE client_id = $1 ORDER BY name", [c.id]).catch(() => ({ rows: [] }))).rows;
  const pkgs = [...new Set(installs.map(i => i.package))];
  const rel = pkgs.length ? (await pool.query("SELECT package, version, notes, created_at FROM hub_releases WHERE published AND package = ANY(string_to_array($1, ','))", [pkgs.join(",")])).rows : [];
  const latest = {};
  for (const r of rel) if (!latest[r.package] || newer(r.version, latest[r.package].version)) latest[r.package] = r;
  const servers = installs.map(i => ({ name: i.name, version: i.version, latest: latest[i.package]?.version || "", upToDate: !latest[i.package] || !newer(latest[i.package].version, i.version),
    lastSeen: i.last_seen, online: !!i.last_seen && Date.now() - new Date(i.last_seen) < 26 * 3600e3, auto: !!i.info?.auto, url: i.info?.url || "",
    users: i.info?.users ?? null, lastUpdate: i.info?.lastUpdate || null }));
  const releases = rel.sort((a, b) => (newer(a.version, b.version) ? -1 : 1)).slice(0, 12).map(r => ({ version: r.version, date: r.created_at, notes: r.notes || [] }));
  const quotes = (await pool.query(`SELECT id, number, title, status, valid_until, sent_at, decided_at, decided_by, result FROM sales_quotes WHERE client_id = $1 AND status <> 'draft' ORDER BY created_at DESC`, [c.id])).rows
    .map(q => ({ id: q.id, number: q.number, title: q.title, status: q.status === "sent" && q.valid_until && String(q.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10) ? "expired" : q.status,
      validUntil: q.valid_until ? String(q.valid_until).slice(0, 10) : null, sentAt: q.sent_at, decidedAt: q.decided_at, decidedBy: q.decided_by,
      year1: Number(q.result?.year1Recurring || 0), oneTime: Number(q.result?.oneTimeTotal || 0), total: Number(q.result?.contractValue || 0), term: q.result?.term?.label || "" }));
  const tickets = (await pool.query(`SELECT t.*, (SELECT count(*) FROM portal_posts p WHERE p.ticket_id = t.id) AS posts FROM portal_tickets t WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 100`, [c.id])).rows
    .map(t => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, unread: !t.client_seen, openedBy: t.opened_by_name, updatedAt: t.updated_at, posts: Number(t.posts) }));
  const docs = (await pool.query("SELECT id, name, note, mime, size, created_at FROM portal_docs WHERE client_id = $1 ORDER BY created_at DESC", [c.id])).rows
    .map(d => ({ id: d.id, name: d.name, note: d.note, mime: d.mime, size: d.size, date: d.created_at }));
  const primary = (c.contacts || []).find(x => x.primary) || null;
  return { client: { name: c.name, status: c.status, modules: (c.modules || []).map(k => names[k] || k), renewalDate: c.renewal_date ? String(c.renewal_date).slice(0, 10) : null,
    licenseId: c.license_id, instanceUrl: c.instance_url, primary: primary ? { name: primary.name, email: primary.email } : null }, servers, releases, quotes, tickets, docs,
    vendor: { name: "Fenmorix Technologies, LLC", email: process.env.PORTAL_SUPPORT_EMAIL || "michael@fenmorix.com" } };
}
let logoData = null;
async function quoteDoc(q, c) {
  const { quoteHtml, setLogo } = await import("../src/SalesPrint.js");
  if (!logoData) { const f = new URL("../public/brand-fenmorix/vendor-logo.png", import.meta.url); logoData = fs.existsSync(f) ? `data:image/png;base64,${fs.readFileSync(f).toString("base64")}` : ""; }
  if (logoData) setLogo(logoData);
  const client = { name: c.name, address: c.address, city: c.city, state: c.state, zip: c.zip, contacts: c.contacts || [] };
  return quoteHtml({ ...q, validUntil: q.valid_until ? String(q.valid_until).slice(0, 10) : null, createdAt: q.created_at, internalNotes: "" }, client, {});
}

export async function handlePortal(req, res, url, send, jsonBody) {
  const ip = clientIp(req);
  const parts = url.pathname.split("/").filter(Boolean);   // api portal ...
  const [, , a, id, b2] = parts;
  if (req.method !== "GET" && !allow(`portal:${ip}`, 90, 60e3)) throw err(429, "Too many requests. Wait a minute and try again.");
  if (req.method === "GET" && a === "logo") {
    const f = new URL("../public/brand-fenmorix/vendor-logo.png", import.meta.url);
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }); return res.end(fs.readFileSync(f));
  }
  // Signed out
  if (a === "login" && req.method === "POST") {
    const b = await jsonBody(req);
    const email = line(b.email, 200).toLowerCase();
    if (!allow(`portal-login:${ip}`, 20, 15 * 60e3) || !allow(`portal-login:${email}`, 10, 60 * 60e3)) throw err(429, "Too many tries. Wait 15 minutes, or ask Fenmorix Technologies for a new sign-in link.");
    const u = (await pool.query("SELECT * FROM portal_users WHERE lower(email) = $1", [email])).rows[0];
    const ok = await verifyPassword(String(b.password || ""), u?.password_hash || DUMMY);
    if (!u || !ok || !u.active || !u.password_hash) throw err(401, "That email and password don't match.");
    await startSession(req, res, u.id);
    const full = await portalUser({ headers: { cookie: String(res.getHeader("Set-Cookie")).split(";")[0] } });
    if (!full) throw err(500, "Signed in, but the new session couldn't be read back. Try again; if it keeps happening, tell Fenmorix Technologies.");
    await clientAudit(full, "Signed in to the client portal", ip);
    return send(res, 200, { user: userJson(full) });
  }
  if (a === "invite") {
    const b = req.method === "GET" ? {} : await jsonBody(req);
    const token = req.method === "GET" ? url.searchParams.get("token") : b.token;
    const u = token && (await pool.query("SELECT u.*, c.name AS client_name FROM portal_users u JOIN sales_clients c ON c.id = u.client_id WHERE invite_hash = $1", [sha(token)])).rows[0];
    if (!u || !u.active || !u.invite_expires || new Date(u.invite_expires) < new Date()) throw err(410, "This link has expired or was already used. Ask Fenmorix Technologies for a new one.");
    if (req.method === "GET") return send(res, 200, { name: u.name, email: u.email, client: u.client_name, hasPassword: !!u.password_hash });
    const p = passwordProblem(String(b.password || "")); if (p) throw err(400, p);
    await pool.query("UPDATE portal_users SET password_hash = $2, invite_hash = NULL, invite_expires = NULL WHERE id = $1", [u.id, await hashPassword(String(b.password))]);
    await pool.query("DELETE FROM portal_sessions WHERE user_id = $1", [u.id]);
    await startSession(req, res, u.id);
    await clientAudit(u, "Set a client portal password", u.email);
    return send(res, 200, { user: userJson(u) });
  }
  const pu = await portalUser(req);
  if (a === "logout") { if (pu) await pool.query("DELETE FROM portal_sessions WHERE token_hash = $1", [pu.token_hash]); setCookie(req, res, "", 0); return send(res, 200, { ok: true }); }
  if (!pu) throw err(401, "Please sign in.");
  if (a === "me") return send(res, 200, { user: userJson(pu) });
  if (req.method === "GET" && a === "overview") return send(res, 200, await overview(pu));

  if (a === "quotes" && isUuid(id)) {
    const q = (await pool.query("SELECT * FROM sales_quotes WHERE id = $1 AND client_id = $2 AND status <> 'draft'", [id, pu.client_id])).rows[0];
    if (!q) throw err(404, "That quote isn't here.");
    if (req.method === "GET" && b2 === "html") {
      const c = (await pool.query("SELECT * FROM sales_clients WHERE id = $1", [pu.client_id])).rows[0];
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:" });
      return res.end(await quoteDoc(q, c));
    }
    if (req.method === "POST" && (b2 === "accept" || b2 === "decline")) {
      const b = await jsonBody(req);
      const expired = q.valid_until && String(q.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10);
      if (q.status !== "sent" || expired) throw err(409, expired ? "This quote has expired. Ask Fenmorix Technologies for an updated one." : "This quote has already been answered.");
      if (b2 === "accept") {
        const name = line(b.name, 120), title = line(b.title, 120);
        if (!name || !b.agree) throw err(400, "Type your name and tick the box to accept.");
        await pool.query(`UPDATE sales_quotes SET status = 'accepted', decided_at = now(), updated_at = now(), decided_by = $2, decided_title = $3, decided_ip = $4,
          decided_note = $5 WHERE id = $1 AND status = 'sent'`, [q.id, name, title, ip, `Accepted in the client portal by ${name}${title ? `, ${title}` : ""} (signed in as ${pu.email})`]);
        await pool.query("UPDATE sales_clients SET status = 'active', modules = $2, updated_at = now() WHERE id = $1", [q.client_id, JSON.stringify(q.result?.modules || [])]);
        await logActivity(q.client_id, "note", `Quote ${q.number} ACCEPTED in the client portal by ${name}${title ? `, ${title}` : ""} (${pu.email}).`, "Client portal");
        await clientAudit(pu, "Accepted a quote", `${q.number} by ${name}`);
      } else {
        const note = text(b.note, 1000);
        await pool.query(`UPDATE sales_quotes SET status = 'declined', decided_at = now(), updated_at = now(), decided_by = $2, decided_ip = $3, decided_note = $4 WHERE id = $1 AND status = 'sent'`,
          [q.id, pu.name, ip, note]);
        await logActivity(q.client_id, "note", `Quote ${q.number} declined in the client portal by ${pu.name}${note ? `: ${note}` : ""}.`, "Client portal");
        await clientAudit(pu, "Declined a quote", q.number);
      }
      return send(res, 200, await overview(pu));
    }
  }
  if (a === "tickets") {
    if (req.method === "POST" && !id) {
      const b = await jsonBody(req);
      const subject = line(b.subject, 200), body = text(b.body, 10000);
      if (!subject || !body) throw err(400, "Give it a subject and say what you need.");
      if (!allow(`portal-ticket:${pu.client_id}`, 20, 3600e3)) throw err(429, "That's a lot of new requests at once. Add to an open one, or call us.");
      const t = (await pool.query(`INSERT INTO portal_tickets (client_id, subject, priority, opened_by, opened_by_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, number`,
        [pu.client_id, subject, ["low", "normal", "high", "urgent"].includes(b.priority) ? b.priority : "normal", pu.id, pu.name])).rows[0];
      await pool.query("INSERT INTO portal_posts (ticket_id, author, author_name, body) VALUES ($1, 'client', $2, $3)", [t.id, pu.name, body]);
      await logActivity(pu.client_id, "support", `Support request #${t.number} opened in the portal: ${subject}`, pu.name);
      return send(res, 200, { id: t.id, number: t.number });
    }
    if (!isUuid(id)) throw err(404, "Not found");
    const t = (await pool.query("SELECT * FROM portal_tickets WHERE id = $1 AND client_id = $2", [id, pu.client_id])).rows[0];
    if (!t) throw err(404, "That request isn't here.");
    if (req.method === "GET") {
      await pool.query("UPDATE portal_tickets SET client_seen = true WHERE id = $1", [t.id]);
      const posts = (await pool.query("SELECT author, author_name, body, created_at FROM portal_posts WHERE ticket_id = $1 ORDER BY created_at", [t.id])).rows;
      return send(res, 200, { ticket: { id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at },
        posts: posts.map(p => ({ from: p.author, name: p.author_name, body: p.body, at: p.created_at })) });
    }
    if (b2 === "reply") {
      const body = text((await jsonBody(req)).body, 10000); if (!body) throw err(400, "Write a reply.");
      await pool.query("INSERT INTO portal_posts (ticket_id, author, author_name, body) VALUES ($1, 'client', $2, $3)", [t.id, pu.name, body]);
      await pool.query("UPDATE portal_tickets SET status = 'open', vendor_seen = false, updated_at = now() WHERE id = $1", [t.id]);
      return send(res, 200, { ok: true });
    }
    if (b2 === "close") {
      await pool.query("UPDATE portal_tickets SET status = 'closed', updated_at = now() WHERE id = $1", [t.id]);
      await pool.query("INSERT INTO portal_posts (ticket_id, author, author_name, body) VALUES ($1, 'client', $2, 'Closed this request.')", [t.id, pu.name]);
      return send(res, 200, { ok: true });
    }
  }
  if (req.method === "GET" && a === "docs" && isUuid(id)) {
    const d = (await pool.query("SELECT name, mime, data FROM portal_docs WHERE id = $1 AND client_id = $2", [id, pu.client_id])).rows[0];
    if (!d) throw err(404, "That document isn't here.");
    res.writeHead(200, { "Content-Type": d.mime, "Content-Disposition": `attachment; filename="${d.name.replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" });
    return res.end(d.data);
  }
  throw err(404, "Not found");
}

// ---- Vendor side (office app) ----
export async function handlePortalAdmin(req, res, parts, user, send, jsonBody) {
  const master = user.role === "master";
  const canEdit = master || (await hasAccess(pool, user, "sales", "edit"));
  const canManage = master || (await hasAccess(pool, user, "sales", "manage"));
  if (!canEdit) throw err(403, "The client portal is for the people who sell and support Fenmorix OS.");
  const [, , a, b, c2] = parts;
  const link = token => `${portalUrl() || ""}/?invite=${token}`;
  const newInvite = async uid => {
    const token = crypto.randomBytes(24).toString("base64url");
    await pool.query("UPDATE portal_users SET invite_hash = $2, invite_expires = now() + interval '7 days' WHERE id = $1", [uid, sha(token)]);
    return token;
  };
  if (req.method === "GET" && !a) {
    const open = (await pool.query(`SELECT t.id, t.number, t.subject, t.status, t.priority, t.updated_at, t.vendor_seen, c.id AS client_id, c.name AS client_name FROM portal_tickets t
      JOIN sales_clients c ON c.id = t.client_id WHERE t.status IN ('open', 'waiting') OR NOT t.vendor_seen ORDER BY t.updated_at DESC LIMIT 50`)).rows;
    return send(res, 200, { open: open.map(t => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, updatedAt: t.updated_at, unread: !t.vendor_seen, clientId: t.client_id, clientName: t.client_name })),
      portalUrl: portalUrl() });
  }
  if (a === "tickets" && isUuid(b)) {
    const t = (await pool.query("SELECT t.*, c.name AS client_name FROM portal_tickets t JOIN sales_clients c ON c.id = t.client_id WHERE t.id = $1", [b])).rows[0];
    if (!t) throw err(404, "That request is gone.");
    if (req.method === "GET") {
      await pool.query("UPDATE portal_tickets SET vendor_seen = true WHERE id = $1", [t.id]);
      const posts = (await pool.query("SELECT author, author_name, body, created_at FROM portal_posts WHERE ticket_id = $1 ORDER BY created_at", [t.id])).rows;
      return send(res, 200, { ticket: { id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, openedBy: t.opened_by_name, createdAt: t.created_at, clientName: t.client_name },
        posts: posts.map(p => ({ from: p.author, name: p.author_name, body: p.body, at: p.created_at })) });
    }
    const body = await jsonBody(req);
    const status = ["open", "answered", "waiting", "closed"].includes(body.status) ? body.status : null;
    if (c2 === "reply") {
      const msg = text(body.body, 10000); if (!msg) throw err(400, "Write a reply.");
      await pool.query("INSERT INTO portal_posts (ticket_id, author, author_name, body) VALUES ($1, 'vendor', $2, $3)", [t.id, `${user.name} (Fenmorix)`, msg]);
      await pool.query("UPDATE portal_tickets SET status = $2, client_seen = false, vendor_seen = true, updated_at = now() WHERE id = $1", [t.id, status || "answered"]);
      await pool.query("INSERT INTO sales_activity (client_id, kind, body, by_name) VALUES ($1, 'support', $2, $3)", [t.client_id, `Answered support request #${t.number}: ${line(t.subject, 200)}`, user.name]);
      return send(res, 200, { ok: true });
    }
    if (c2 === "status" && status) { await pool.query("UPDATE portal_tickets SET status = $2, updated_at = now() WHERE id = $1", [t.id, status]); return send(res, 200, { ok: true }); }
  }
  if (a === "users" && isUuid(b) && req.method === "POST") {
    if (!canManage) throw err(403, "Only a manager of Clients & Quotes can change portal access.");
    const u = (await pool.query("SELECT u.*, c.name AS client_name FROM portal_users u JOIN sales_clients c ON c.id = u.client_id WHERE u.id = $1", [b])).rows[0];
    if (!u) throw err(404, "That portal account is gone.");
    if (c2 === "link") { const token = await newInvite(u.id); await vendorAudit(user, "Made a client portal sign-in link", `${u.email} (${u.client_name})`); return send(res, 200, { link: link(token), expires: INVITE_DAYS }); }
    if (c2 === "disable" || c2 === "enable") {
      await pool.query("UPDATE portal_users SET active = $2 WHERE id = $1", [u.id, c2 === "enable"]);
      if (c2 === "disable") await pool.query("DELETE FROM portal_sessions WHERE user_id = $1", [u.id]);
      await vendorAudit(user, c2 === "disable" ? "Turned off client portal access" : "Turned on client portal access", `${u.email} (${u.client_name})`);
      return send(res, 200, { ok: true });
    }
  }
  if (a === "docs" && isUuid(b) && c2 === "remove" && req.method === "POST") {
    const d = (await pool.query("DELETE FROM portal_docs WHERE id = $1 RETURNING name", [b])).rows[0];
    if (d) await vendorAudit(user, "Removed a shared document", d.name);
    return send(res, 200, { ok: true });
  }
  if (isUuid(a)) {
    const client = (await pool.query("SELECT id, name, contacts FROM sales_clients WHERE id = $1", [a])).rows[0];
    if (!client) throw err(404, "That client is gone.");
    if (req.method === "GET" && !b) {
      const users = (await pool.query("SELECT id, name, email, active, last_login, (password_hash IS NOT NULL) AS ready, invite_expires FROM portal_users WHERE client_id = $1 ORDER BY name", [a])).rows
        .map(u => ({ id: u.id, name: u.name, email: u.email, active: u.active, lastLogin: u.last_login, ready: u.ready, inviteOpen: !!u.invite_expires && new Date(u.invite_expires) > new Date() }));
      const tickets = (await pool.query("SELECT id, number, subject, status, priority, updated_at, vendor_seen, opened_by_name FROM portal_tickets WHERE client_id = $1 ORDER BY updated_at DESC LIMIT 100", [a])).rows
        .map(t => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, updatedAt: t.updated_at, unread: !t.vendor_seen, openedBy: t.opened_by_name }));
      const docs = (await pool.query("SELECT id, name, note, size, created_at, uploaded_by FROM portal_docs WHERE client_id = $1 ORDER BY created_at DESC", [a])).rows
        .map(d => ({ id: d.id, name: d.name, note: d.note, size: d.size, date: d.created_at, by: d.uploaded_by }));
      return send(res, 200, { users, tickets, docs, portalUrl: portalUrl(), canManage });
    }
    if (req.method === "POST" && b === "users") {
      if (!canManage) throw err(403, "Only a manager of Clients & Quotes can give portal access.");
      const body = await jsonBody(req);
      const name = line(body.name, 120), email = line(body.email, 200).toLowerCase();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err(400, "Give their name and email address.");
      const other = (await pool.query("SELECT u.client_id, c.name FROM portal_users u JOIN sales_clients c ON c.id = u.client_id WHERE lower(u.email) = $1", [email])).rows[0];
      if (other) throw err(409, other.client_id === a ? "That person already has portal access. Make a new sign-in link for them instead." : `That email already has portal access for ${other.name}.`);
      const u = (await pool.query("INSERT INTO portal_users (client_id, name, email, created_by_name) VALUES ($1, $2, $3, $4) RETURNING id", [a, name, email, user.name])).rows[0];
      const token = await newInvite(u.id);
      await vendorAudit(user, "Gave client portal access", `${email} (${client.name})`);
      let emailed = false;
      try {
        const { mailConfigured, sendMail } = await import("./mail.js");
        if (body.email !== false && mailConfigured()) {
          await sendMail({ to: email, subject: "Your Fenmorix client portal", text: `Hello ${name},\n\nFenmorix Technologies set up a client portal account for ${client.name}. Choose your password here (the link works for ${INVITE_DAYS} days):\n\n${link(token)}\n\nAfter that, sign in at ${portalUrl()} to see your servers and versions, quotes, support requests and documents.\n\nFenmorix Technologies, LLC` });
          emailed = true;
        }
      } catch (e) { console.warn("[portal] invite email:", e.message); }
      return send(res, 200, { id: u.id, link: link(token), emailed, expires: INVITE_DAYS });
    }
    if (req.method === "POST" && b === "docs") {
      const body = await jsonBody(req);
      const m = /^data:([\w.+/-]+);base64,(.*)$/s.exec(String(body.dataUrl || ""));
      if (!m) throw err(400, "Choose the file.");
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > 20 * 1024 * 1024) throw err(413, "Documents can be up to 20 MB.");
      const mime = sniffDoc(buf, m[1].toLowerCase());
      if (!mime) throw err(415, "Share a PDF, a picture (PNG or JPEG), or a Word / Excel file.");
      const name = (line(body.name, 140).replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]*$/, "") || "document") + "." + DOC_TYPES[mime];
      const d = (await pool.query("INSERT INTO portal_docs (client_id, name, note, mime, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [a, name, line(body.note, 300), mime, buf.length, buf, user.name])).rows[0];
      await vendorAudit(user, "Shared a document", `${name} with ${client.name}`);
      return send(res, 200, { id: d.id });
    }
  }
  throw err(404, "Not found");
}
