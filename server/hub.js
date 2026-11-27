// Update service (vendor module "sales"; only on Fenmorix Technologies' office install): customers' servers check in here, report their
// version, and download the newest SIGNED release for their own package. Releases are signed on the vendor's own computer (License
// Manager: sign-release), never here, and every server checks the signature itself (server/updates.js), so this service can't push
// code that wasn't signed. Release zips are kept in <SYSTEM_DIR>/releases/<package>/<version>.zip.
//
// Signed-in (Clients & Quotes manage):
//   GET  /api/hub                         {installs, releases, packages}
//   POST /api/hub/installs                {name, package, clientId}  -> {key} (shown once)     POST /api/hub/installs/:id {name, clientId, hold}
//   POST /api/hub/installs/:id/rekey      -> {key}      POST /api/hub/installs/:id/remove
//   POST /api/hub/releases                {fileName, data base64, sig (the .sig file's text)}   (one zip per call)
//   POST /api/hub/releases/:id/publish | pause | remove
// Customer servers (no session; Authorization: Bearer <enrollment key>; must be reachable past any sign-in in front of the office):
//   POST /api/hub/client/checkin          {package, version, info} -> {latest | null, hold}
//   GET  /api/hub/client/download/:id     the zip (only the server's own package, published)
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { verifyRelease } from "./license.js";
import { unzip } from "./xlsx.js";
import { allow } from "./ratelimit.js";
import { clientIp } from "./clientip.js";
import { newer } from "./updates.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const line = (v, n) => String(v ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
const ROOT = () => path.resolve(process.env.SYSTEM_DIR || path.join(import.meta.dirname, "..", ".."));
const REL = (pkg, ver) => path.join(ROOT(), "releases", pkg, `${ver}.zip`);
const PKG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/, VER_RE = /^[0-9][0-9A-Za-z.-]{0,30}$/;
const hash = k => crypto.createHash("sha256").update(String(k)).digest("hex");
const newKey = () => "fxu_" + crypto.randomBytes(32).toString("base64url");

async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Updates', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, line(detail, 500)]);
}
const installJson = r => ({ id: r.id, name: r.name, clientId: r.client_id, clientName: r.client_name || "", package: r.package, hold: r.hold, version: r.version,
  lastSeen: r.last_seen, info: r.info || {}, downloads: r.downloads, createdAt: r.created_at });
const releaseJson = r => ({ id: r.id, package: r.package, version: r.version, notes: r.notes || [], fileName: r.file_name, size: r.size, sha256: r.sha256,
  kid: r.kid, published: r.published, uploadedBy: r.uploaded_by, createdAt: r.created_at });
async function latestFor(pkg) {
  const rows = (await pool.query("SELECT * FROM hub_releases WHERE package = $1 AND published", [pkg])).rows;
  return rows.reduce((best, r) => (!best || newer(r.version, best.version) ? r : best), null);
}

// ---- Customer servers ----
export async function handleHubClient(req, res, parts, send, jsonBody) {
  const ip = clientIp(req);
  if (!allow(`hub:${ip}`, 60, 60e3)) throw err(429, "Too many requests. Try again in a minute.");
  if (req.method === "POST" && parts[3] === "request") return websiteRequest(req, res, send, jsonBody);
  const m = /^Bearer (fxu_[A-Za-z0-9_-]{30,80})$/.exec(String(req.headers.authorization || ""));
  const inst = m && (await pool.query("SELECT * FROM hub_installs WHERE key_hash = $1", [hash(m[1])])).rows[0];
  if (!inst) { throw err(401, "This update key isn't known. Ask Fenmorix Technologies for a new one."); }
  const [, , , what, id] = parts;
  if (req.method === "POST" && what === "checkin") {
    const b = await jsonBody(req, 64 * 1024);
    if (String(b.package || "") !== inst.package) throw err(409, `This key is for the ${inst.package} download, not ${line(b.package, 40)}.`);
    const info = b.info && typeof b.info === "object" ? JSON.parse(JSON.stringify(b.info, (k, v) => (typeof v === "string" ? v.slice(0, 300) : v)).slice(0, 20000)) : {};
    await pool.query("UPDATE hub_installs SET version = $2, last_seen = now(), last_ip = $3, info = $4 WHERE id = $1", [inst.id, line(b.version, 40), ip, JSON.stringify(info)]);
    const r = inst.hold ? null : await latestFor(inst.package);
    return send(res, 200, { hold: inst.hold, latest: r ? { id: r.id, package: r.package, version: r.version, notes: r.notes, size: r.size, sha256: r.sha256, kid: r.kid, sig: r.sig } : null });
  }
  if (req.method === "GET" && what === "download" && isUuid(id)) {
    const r = (await pool.query("SELECT * FROM hub_releases WHERE id = $1 AND published", [id])).rows[0];
    if (!r || r.package !== inst.package) throw err(404, "That release isn't offered to this server.");
    const f = REL(r.package, r.version);
    if (!fss.existsSync(f)) throw err(404, "The release file is missing on the update service.");
    await pool.query("UPDATE hub_installs SET downloads = downloads + 1, last_seen = now() WHERE id = $1", [inst.id]);
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": r.size, "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${r.file_name}"` });
    return fss.createReadStream(f).pipe(res);
  }
  throw err(404, "Not found");
}

// ---- Vendor (signed in) ----
export async function handleHub(req, res, parts, user, send, jsonBody) {
  const ok = user.role === "master" || (await hasAccess(pool, user, "sales", "manage"));
  if (!ok) throw err(403, "Updates are for managers of Clients & Quotes.");
  const [, , a, id, b2] = parts;
  if (req.method === "GET" && !a) {
    const installs = (await pool.query(`SELECT i.*, c.name AS client_name FROM hub_installs i LEFT JOIN sales_clients c ON c.id = i.client_id ORDER BY lower(i.name)`)).rows.map(installJson);
    const releases = (await pool.query("SELECT * FROM hub_releases ORDER BY created_at DESC LIMIT 200")).rows.map(releaseJson);
    const latest = {};
    for (const r of releases) if (r.published && (!latest[r.package] || newer(r.version, latest[r.package]))) latest[r.package] = r.version;
    return send(res, 200, { installs, releases, latest, packages: [...new Set([...installs.map(i => i.package), ...releases.map(r => r.package)])].sort() });
  }
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  if (a === "installs" && !id) {
    const name = line(b.name, 120); if (!name) throw err(400, "Name the server (for example \"Louisiana Gold & Coins\").");
    const pkg = line(b.package, 40).toLowerCase(); if (!PKG_RE.test(pkg)) throw err(400, "Pick the download it runs (sgfd, lgc, sandbox, office…).");
    const key = newKey();
    const r = (await pool.query("INSERT INTO hub_installs (name, package, client_id, key_hash) VALUES ($1, $2, $3, $4) RETURNING id", [name, pkg, isUuid(b.clientId) ? b.clientId : null, hash(key)])).rows[0];
    await audit(user, "Added an installation", `${name} (${pkg})`);
    return send(res, 200, { id: r.id, key });
  }
  if (a === "installs" && isUuid(id) && !b2) {
    const r = await pool.query("UPDATE hub_installs SET name = COALESCE(NULLIF($2, ''), name), client_id = $3, hold = $4 WHERE id = $1 RETURNING name",
      [id, line(b.name, 120), isUuid(b.clientId) ? b.clientId : null, !!b.hold]);
    if (!r.rowCount) throw err(404, "That installation isn't here.");
    await audit(user, "Changed an installation", `${r.rows[0].name}${b.hold ? " (updates held)" : ""}`);
    return send(res, 200, { ok: true });
  }
  if (a === "installs" && isUuid(id) && b2 === "rekey") {
    const key = newKey();
    const r = await pool.query("UPDATE hub_installs SET key_hash = $2 WHERE id = $1 RETURNING name", [id, hash(key)]);
    if (!r.rowCount) throw err(404, "That installation isn't here.");
    await audit(user, "Made a new update key", r.rows[0].name);
    return send(res, 200, { key });
  }
  if (a === "installs" && isUuid(id) && b2 === "remove") {
    const r = await pool.query("DELETE FROM hub_installs WHERE id = $1 RETURNING name", [id]);
    if (r.rowCount) await audit(user, "Removed an installation", r.rows[0].name);
    return send(res, 200, { ok: true });
  }
  if (a === "releases" && !id) {
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) throw err(400, "Choose the release zip.");
    if (buf.length > 60 * 1024 * 1024) throw err(413, "That zip is too big for a release.");
    let files; try { files = unzip(buf); } catch { throw err(400, "That isn't a zip file."); }
    let ver; try { ver = JSON.parse(files.get("app/VERSION.json").toString("utf8")); } catch { throw err(400, "The zip has no VERSION.json: use a zip made by the packaging tool."); }
    const pkg = String(ver.package || ""), version = String(ver.version || "");
    if (!PKG_RE.test(pkg) || !VER_RE.test(version)) throw err(400, "The zip's VERSION.json doesn't name its package and version.");
    if (/-TEST\.zip$/i.test(String(b.fileName || ""))) throw err(400, "That's a test build. Never send a -TEST zip to a customer.");
    let sig; try { sig = JSON.parse(String(b.sig || "")); } catch { throw err(400, `Add the signature file (${line(b.fileName, 80)}.sig) made with the License Manager: node nexus-license.mjs sign-release <zip>.`); }
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    if (sig.package !== pkg || sig.version !== version || sig.sha256 !== sha) throw err(400, "That signature file is for a different zip (package, version or contents don't match).");
    const v = verifyRelease({ ...sig, sha256: sha });
    if (!v.ok) throw err(400, `The signature didn't check out: ${v.error}`);
    if ((await pool.query("SELECT 1 FROM hub_releases WHERE package = $1 AND version = $2", [pkg, version])).rowCount) throw err(409, `${pkg} ${version} is already here.`);
    const f = REL(pkg, version);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, buf);
    const notes = Array.isArray(ver.notes) ? ver.notes.slice(0, 40).map(n => line(n, 300)) : [];
    const r = (await pool.query(`INSERT INTO hub_releases (package, version, notes, file_name, size, sha256, kid, sig, published, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [pkg, version, JSON.stringify(notes), line(b.fileName, 120) || `${pkg}-${version}.zip`, buf.length, sha, sig.kid, sig.sig, b.publish !== false, user.name])).rows[0];
    await audit(user, "Published a release", `${pkg} ${version} sha256 ${sha.slice(0, 12)}`);
    return send(res, 200, { release: releaseJson(r) });
  }
  if (a === "releases" && isUuid(id) && ["publish", "pause", "remove"].includes(b2)) {
    const r = (await pool.query("SELECT * FROM hub_releases WHERE id = $1", [id])).rows[0];
    if (!r) throw err(404, "That release isn't here.");
    if (b2 === "remove") { await pool.query("DELETE FROM hub_releases WHERE id = $1", [id]); await fs.rm(REL(r.package, r.version), { force: true }); }
    else await pool.query("UPDATE hub_releases SET published = $2 WHERE id = $1", [id, b2 === "publish"]);
    await audit(user, { publish: "Published a release", pause: "Paused a release", remove: "Removed a release" }[b2], `${r.package} ${r.version}`);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}

// ---- Feature ideas from fenmorix.com ----
// The website's Worker checks the visitor (Turnstile, required fields) and forwards here with the shared secret WEBSITE_FORM_SECRET
// (same value as the Worker's secret). The idea becomes a support request with no client yet (source 'website'), shown with the others.
async function websiteRequest(req, res, send, jsonBody) {
  const secret = String(process.env.WEBSITE_FORM_SECRET || "");
  const given = String(req.headers["x-fenmorix-site"] || "");
  const a = Buffer.from(crypto.createHash("sha256").update(given).digest()), b = Buffer.from(crypto.createHash("sha256").update(secret).digest());
  if (secret.length < 24 || !crypto.timingSafeEqual(a, b)) throw err(401, "Not accepted.");
  if (!allow("hub:website", 120, 60 * 60e3)) throw err(429, "Too many ideas this hour. Try again later.");
  const v = await jsonBody(req, 32 * 1024);
  const name = line(v.name, 120), org = line(v.org, 160), email = line(v.email, 200), phone = line(v.phone, 40), idea = String(v.idea || "").trim().slice(0, 4000);
  if (!name || !org || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g, "").length < 7 || !idea) throw err(400, "Name, organization, email, phone and the idea are all needed.");
  const build = v.build && typeof v.build === "object" ? { sector: line(v.build.sector, 20), modules: (Array.isArray(v.build.modules) ? v.build.modules : []).slice(0, 40).map(x => line(x, 60)) } : null;
  const contact = { name, org, email, phone, ip: line(v.ip, 60), sector: build?.sector || "", modules: build?.modules || [] };
  const subject = `Feature idea: ${line(idea.split(/\n/)[0], 90)}`;
  const t = (await pool.query("INSERT INTO portal_tickets (client_id, subject, priority, opened_by_name, source, contact) VALUES (NULL, $1, 'normal', $2, 'website', $3) RETURNING id, number",
    [subject, `${name} (${org})`, JSON.stringify(contact)])).rows[0];
  const extra = build?.modules?.length ? `\n\nBuilt on the website (${build.sector}): ${build.modules.join(", ")}` : "";
  await pool.query("INSERT INTO portal_posts (ticket_id, author, author_name, body) VALUES ($1, 'client', $2, $3)", [t.id, `${name} (${org})`, idea + extra]);
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES (NULL, $1, 'Website', 'Client portal', 'Feature idea from the website', $2)`,
    [`${name} (${org})`, `#${t.number} ${email}`]);
  return send(res, 200, { ok: true, number: t.number });
}
