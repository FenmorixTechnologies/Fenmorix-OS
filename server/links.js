// Quick Links (module "links", opt-in): the websites the team uses every day, one click away. A link can carry a shared login
// (user name, password, note), encrypted with the forms key (forms.js encrypt/decrypt). Only master admins and the people or groups in
// login_to can reveal it, and every reveal is audited (the link's name only, never the login). visible_to [] = everyone sees the link.
//
//   GET  /api/links                    {links, canEdit, people?, groups?}   (people/groups and each link's lists only for editors)
//   POST /api/links                    {id?, title, url, category, note, personal, visibleTo, loginTo, login?: {user, password, note} | {clear: true}}
//   POST /api/links/:id/remove
//   POST /api/links/:id/reveal         {user, password, note}   (shared: master or login_to; personal: your own; 30 an hour per person)
//   POST /api/links/:id/my-login       {user, password, note} | {clear: true}   (personal links: your own login, only you can see it)
//   POST /api/links/order              {ids}                    (editors: the order within each category)
// Rights: everyone opens the links shared with them; access section "links" edit = add/change/remove links and logins.
import { pool } from "./db.js";
import { hasAccess, allGroupMembers } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { encrypt, decrypt } from "./forms.js";
import { allow } from "./ratelimit.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Quick Links', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, clean(detail, 500)]);
}
// Only web addresses: http(s), nothing that runs script
export function cleanUrl(v) {
  let s = clean(v, 2000);
  if (s && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u; try { u = new URL(s); } catch { throw err(400, "That web address doesn't look right."); }
  if (!/^https?:$/.test(u.protocol)) throw err(400, "Links must be web addresses (http or https).");
  return u.toString();
}
const cleanList = v => (Array.isArray(v) ? v : []).filter(x => x && ["user", "group"].includes(x.kind) && isUuid(x.id)).slice(0, 100)
  .map(x => ({ kind: x.kind, id: x.id, name: clean(x.name, 120) }));
// Is this person in a [{kind, id}] list (people or live group membership)?
function inList(list, userId, groups) {
  return (list || []).some(x => (x.kind === "user" ? x.id === userId : groups.get(x.id)?.has(userId)));
}

export async function handleLinks(req, res, parts, user, send, jsonBody) {
  const master = user.role === "master";
  const canEdit = master || (await hasAccess(pool, user, "links", "edit"));
  const groupSets = async () => new Map((await allGroupMembers(pool)).map(g => [g.id, new Set(g.ids)]));
  const mine = new Set((await pool.query("SELECT link_id FROM quick_link_logins WHERE user_id = $1", [user.id])).rows.map(r => r.link_id));
  const rowJson = (r, groups) => ({
    id: r.id, title: r.title, url: r.url, category: r.category, note: r.note, sort: r.sort_order, personal: r.personal,
    hasLogin: r.personal ? mine.has(r.id) : r.has_login, myLogin: r.personal && mine.has(r.id),
    canReveal: r.personal ? mine.has(r.id) : r.has_login && (master || inList(r.login_to, user.id, groups)),
    ...(canEdit ? { visibleTo: r.visible_to, loginTo: r.login_to, updatedAt: r.updated_at, updatedBy: r.updated_by_name } : {}),
  });

  if (req.method === "GET" && !parts[2]) {
    const groups = await groupSets();
    const rows = (await pool.query("SELECT * FROM quick_links ORDER BY lower(category), sort_order, lower(title)")).rows
      .filter(r => canEdit || !r.visible_to?.length || inList(r.visible_to, user.id, groups));
    const out = { links: rows.map(r => rowJson(r, groups)), canEdit };
    if (canEdit) {
      out.people = (await pool.query(`SELECT id, full_name AS name FROM users WHERE active AND account_status = 'approved' ORDER BY full_name`)).rows;
      out.groups = (await allGroupMembers(pool)).map(g => ({ id: g.id, name: g.name, size: g.ids.length }));
    }
    return send(res, 200, out);
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  // Personal links: save / clear / see your own login (nobody else's, not even a master admin's view)
  if (isUuid(parts[2]) && parts[3] === "my-login") {
    const r = (await pool.query("SELECT * FROM quick_links WHERE id = $1 AND personal", [parts[2]])).rows[0];
    if (!r || (!canEdit && r.visible_to?.length && !inList(r.visible_to, user.id, await groupSets()))) throw err(404, "That link isn't here.");
    if (b.clear) { await pool.query("DELETE FROM quick_link_logins WHERE link_id = $1 AND user_id = $2", [r.id, user.id]); return send(res, 200, { ok: true }); }
    if (!b.user && !b.password) throw err(400, "Enter your user name or password.");
    await pool.query(`INSERT INTO quick_link_logins (link_id, user_id, secret) VALUES ($1, $2, $3)
      ON CONFLICT (link_id, user_id) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()`,
      [r.id, user.id, encrypt({ user: clean(b.user, 200), password: String(b.password ?? "").slice(0, 500), note: clean(b.note, 500) })]);
    return send(res, 200, { ok: true });
  }
  // Reveal a login: a personal link's is your own; a shared one needs master or login_to (audited)
  if (isUuid(parts[2]) && parts[3] === "reveal") {
    const r = (await pool.query("SELECT * FROM quick_links WHERE id = $1", [parts[2]])).rows[0];
    if (r?.personal) {
      const own = (await pool.query("SELECT secret FROM quick_link_logins WHERE link_id = $1 AND user_id = $2", [r.id, user.id])).rows[0];
      if (!own) throw err(404, "You haven't saved your login for this link yet.");
      const s = decrypt(own.secret);
      return send(res, 200, { user: s.user || "", password: s.password || "", note: s.note || "", personal: true });
    }
    if (!r || !r.has_login || !r.secret) throw err(404, "That link has no login.");
    if (!master && !inList(r.login_to, user.id, await groupSets())) throw err(403, "This login isn't shared with you.");
    if (!allow(`links-reveal:${user.id}`, 30, 3600e3)) throw err(429, "That's a lot of logins in an hour. Try again later.");
    const s = decrypt(r.secret);
    await audit(user, "Revealed a shared login", r.title);
    return send(res, 200, { user: s.user || "", password: s.password || "", note: s.note || "" });
  }
  if (!canEdit) throw err(403, "Only people who manage Quick Links can change them.");

  if (parts[2] === "order") {
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isUuid).slice(0, 500);
    for (let i = 0; i < ids.length; i++) await pool.query("UPDATE quick_links SET sort_order = $2 WHERE id = $1", [ids[i], i]);
    return send(res, 200, { ok: true });
  }
  if (isUuid(parts[2]) && parts[3] === "remove") {
    const r = (await pool.query("DELETE FROM quick_links WHERE id = $1 RETURNING title", [parts[2]])).rows[0];
    if (!r) throw err(404, "That link is gone.");
    await audit(user, "Removed a link", r.title);
    return send(res, 200, { ok: true });
  }
  if (!parts[2]) {
    const title = clean(b.title, 120);
    if (!title) throw err(400, "Give the link a name.");
    const url = cleanUrl(b.url);
    const personal = !!b.personal;
    const vals = [title, url, clean(b.category, 60), clean(b.note, 500), JSON.stringify(cleanList(b.visibleTo)), JSON.stringify(personal ? [] : cleanList(b.loginTo)), user.name];
    // Login: {user, password, note} sets it; {clear: true} removes it; missing = keep what's there
    let secretSql = "", loginNote = "";
    if (personal) { secretSql = ", secret = NULL, has_login = false"; loginNote = " (personal logins)"; }
    else if (b.login && b.login.clear) { secretSql = ", secret = NULL, has_login = false"; loginNote = " (login removed)"; }
    else if (b.login && (b.login.user || b.login.password)) {
      vals.push(encrypt({ user: clean(b.login.user, 200), password: String(b.login.password ?? "").slice(0, 500), note: clean(b.login.note, 500) }));
      secretSql = `, secret = $${vals.length}, has_login = true`; loginNote = " (login set)";
    }
    let id = b.id;
    if (id) {
      if (!isUuid(id)) throw err(400, "Which link?");
      const r = await pool.query(`UPDATE quick_links SET title = $1, url = $2, category = $3, note = $4, visible_to = $5, login_to = $6, updated_by_name = $7,
        updated_at = now(), personal = ${personal}${secretSql} WHERE id = $${vals.length + 1} RETURNING id`, [...vals, id]);
      if (!personal) await pool.query("DELETE FROM quick_link_logins WHERE link_id = $1", [id]);
      if (!r.rowCount) throw err(404, "That link is gone.");
      await audit(user, "Changed a link", title + loginNote);
    } else {
      const sort = Number((await pool.query("SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM quick_links WHERE lower(category) = lower($1)", [vals[2]])).rows[0].n);
      const hasSecret = vals.length === 8;
      id = (await pool.query(`INSERT INTO quick_links (title, url, category, note, visible_to, login_to, updated_by_name, created_by, sort_order, personal${hasSecret ? ", secret, has_login" : ""})
        VALUES ($1, $2, $3, $4, $5, $6, $7, $${vals.length + 1}, $${vals.length + 2}, ${personal}${hasSecret ? ", $8, true" : ""}) RETURNING id`, [...vals, user.id, sort])).rows[0].id;
      await audit(user, "Added a link", title + loginNote);
    }
    return send(res, 200, { ok: true, id });
  }
  throw err(404, "Not found");
}
