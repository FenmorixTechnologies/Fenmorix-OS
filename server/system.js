// System (/api/system): keep the server up to date from the app instead of remote desktop. Master admins only.
//
//   GET  /api/system                 status: version, uptime, disk, database, updater, last update result, backups, recent updates
//   GET  /api/system/log?lines=300   the end of the service log (logs/sgfd-app.log)
//   GET  /api/system/update-log/:n   one update's log (logs/update-*.log)
//   POST /api/system/upload          {fileName, data base64}  a release zip -> checked and kept in updates/incoming (one at a time)
//   POST /api/system/discard         drop the uploaded zip
//   POST /api/system/run             {action: install | restart | rollback | backup}   needs a two-step code in the last 5 minutes
//   GET  /api/system/env             the settings in .env: secrets only as "set / not set", never their values; descriptions from
//                                    .env.example; locked ones (database, port, HTTPS, forms key...) can't be changed here
//   POST /api/system/env             {changes: [{key, value} | {key, remove: true}]}   (code) -> backup to updates/env-history, then
//                                    written in place (keeps the file's permissions); takes effect after a restart
//   POST /api/system/env/restore     {name}   put an earlier .env back (code)
//
// The service can't replace or restart itself, so actions go through a Windows scheduled task ("SGFD Nexus Update", runs as
// SYSTEM, made once by scripts/install-updater.ps1): Nexus writes updates/pending.json and starts the task;
// scripts/apply-update.ps1 backs up the database, keeps a copy of the current app for rollback, copies the new files over
// (never .env, secrets, node_modules), runs update.ps1, and rolls back by itself if that fails. Results: updates/last-result.json
// + logs/update-<time>.log. Audit module "System".
//
// .env: UPDATER_TASK (task name), SYSTEM_DIR (folder above app, default ..), UPDATER_COMMAND (tests: a command instead of schtasks).
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { pool } from "./db.js";
import { unzip } from "./xlsx.js";
import { orgSettings, saveOrgSettings, brand, product, savedBranding, brandingDir, uploadedAssetsDir, setupLogoFile, BRAND_FILES, COLOR_KEYS, HEX } from "./brand.js";
import { TILE_LABELS } from "../src/modules.js";
import { PACKAGE, PACKAGE_NAME } from "./buildFlags.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const APP_DIR = path.resolve(import.meta.dirname, "..");
const ROOT = () => path.resolve(process.env.SYSTEM_DIR || path.join(APP_DIR, ".."));
const UPD = () => path.join(ROOT(), "updates");
const LOGS = () => path.join(ROOT(), "logs");
const TASK = () => process.env.UPDATER_TASK || "SGFD Nexus Update";
const MAX_ZIP = 60 * 1024 * 1024;
const started = Date.now();
const readJson = async (p, d = null) => { try { return JSON.parse((await fs.readFile(p, "utf8")).replace(/^\uFEFF/, "")); } catch { return d; } };
const run = (cmd, args, timeout = 15000) => new Promise(ok => execFile(cmd, args, { timeout, windowsHide: true }, (e, stdout, stderr) => ok({ code: e ? (e.code ?? 1) : 0, out: String(stdout || "") + String(stderr || "") })));

async function audit(user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'System', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, String(detail || "").slice(0, 500)]);
}
async function updaterReady() {
  if (process.env.UPDATER_COMMAND) return { ready: true };
  if (process.platform !== "win32") return { ready: false, why: "Updates from the app work on the Windows server only." };
  const r = await run("schtasks.exe", ["/Query", "/TN", TASK()]);
  return r.code === 0 ? { ready: true } : { ready: false, why: `The updater isn't set up yet. On the server, run once as administrator: powershell -ExecutionPolicy Bypass -File .\\scripts\\install-updater.ps1` };
}
async function startUpdater() {
  if (process.env.UPDATER_COMMAND) {
    const [cmd, ...args] = process.env.UPDATER_COMMAND.split(" ");
    const { spawn } = await import("node:child_process");
    spawn(cmd, args, { detached: true, stdio: "ignore", env: { ...process.env, SYSTEM_DIR: ROOT() } }).unref();
    return;
  }
  const r = await run("schtasks.exe", ["/Run", "/TN", TASK()]);
  if (r.code !== 0) throw err(500, `Couldn't start the updater task: ${r.out.trim().slice(0, 200)}`);
}

// A release zip: everything under app/, safe paths only, no secrets. Returns what's in it.
export function checkRelease(buf) {
  let files;
  try { files = unzip(buf); } catch { throw err(400, "That isn't a zip file."); }
  const names = [...files.keys()].filter(n => !n.endsWith("/"));
  if (!names.length) throw err(400, "The zip is empty.");
  const bad = names.find(n => n.includes("\\") || n.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(n) || /^[a-z]:/i.test(n) || !n.startsWith("app/"));
  if (bad) throw err(400, `The zip has a file outside the app folder (${bad.slice(0, 80)}). Use the zip exactly as it was sent.`);
  const secret = names.find(n => /^app\/(\.env$|secrets\/|node_modules\/|\.git\/)/.test(n));
  if (secret) throw err(400, `The zip contains ${secret.slice(4)}: releases never include that. Use the zip exactly as it was sent.`);
  for (const need of ["app/package.json", "app/server/index.js", "app/src/main.jsx", "app/scripts/update.ps1"]) if (!files.has(need)) throw err(400, `This doesn't look like a ${brand().productName} release (${need.slice(4)} is missing).`);
  let pkg = {};
  try { pkg = JSON.parse(files.get("app/package.json").toString("utf8")); } catch { throw err(400, "package.json in the zip can't be read."); }
  if (pkg.name && !/sgfd|fenmorix/i.test(pkg.name)) throw err(400, "This zip is a different app.");
  let ver = null;
  try { ver = files.has("app/VERSION.json") ? JSON.parse(files.get("app/VERSION.json").toString("utf8")) : null; } catch { ver = null; }
  // Each customer installs only their own download (packaging/build-package.mjs stamps it). A server still running the source tree
  // (St. George's, before its first packaged update) takes St. George's download or an unstamped one.
  const want = PACKAGE || "sgfd", got = ver?.package || "";
  if (got ? got !== want : !!PACKAGE)
    throw err(400, got ? `This download is for ${ver.customer || got}, not this server. Use the download made for this organization.` : "This download isn't stamped for this server. Use the download made for this organization.");
  const migrations = names.filter(n => /^app\/db\/migrations\/[^/]+\.sql$/.test(n)).map(n => path.basename(n, ".sql")).sort();
  const total = [...files.values()].reduce((s, b) => s + b.length, 0);
  return { files: names.length, bytes: total, version: ver?.version || "", notes: Array.isArray(ver?.notes) ? ver.notes.slice(0, 40).map(x => String(x).slice(0, 300)) : [],
    migrations, packageChanged: null, pkg };
}

// Keep a checked release zip in updates/incoming (one at a time). Used by the upload button and by broadcast updates (updates.js).
export async function stageRelease(buf, fileName, actor, extra = {}) {
  const byName = actor.name;
  if (buf.length > MAX_ZIP) throw err(413, "That zip is too big for a release.");
  const info = checkRelease(buf);
  const dir = path.join(UPD(), "incoming");
  await fs.mkdir(dir, { recursive: true });
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  await fs.writeFile(path.join(dir, "release.zip"), buf);
  const meta = { fileName: String(fileName || "release.zip").slice(0, 120), sha256: sha, size: buf.length, files: info.files, version: info.version, notes: info.notes,
    migrations: info.migrations, uploadedAt: new Date().toISOString(), uploadedBy: byName, ...extra };
  await fs.writeFile(path.join(dir, "release.json"), JSON.stringify(meta, null, 1));
  const { ROLE_LABEL } = await import("./collections.js");
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'System', $4, $5)`,
    [actor.id || null, byName, ROLE_LABEL[actor.role] || actor.role || "", extra.signed ? "Downloaded an update" : "Uploaded an update", `${meta.fileName} ${info.version || ""} sha256 ${sha.slice(0, 12)}`]);
  return meta;
}
// Hand an action to the updater (install / restart / rollback / backup). user = the person, or { name: "Automatic update" }.
export async function queueAction(action, user) {
  const ready = await updaterReady();
  if (!ready.ready) throw err(409, ready.why);
  const pending = await readJson(path.join(UPD(), "pending.json"));
  if (pending && Date.now() - new Date(pending.at) < 15 * 60e3) throw err(409, `The updater is already working on: ${pending.action} (started ${new Date(pending.at).toLocaleTimeString()}).`);
  const job = { action, at: new Date().toISOString(), by: user.name, id: crypto.randomUUID() };
  if (action === "install") {
    const meta = await readJson(path.join(UPD(), "incoming", "release.json"));
    if (!meta) throw err(400, "Upload the release zip first.");
    const buf = await fs.readFile(path.join(UPD(), "incoming", "release.zip")).catch(() => null);
    if (!buf || crypto.createHash("sha256").update(buf).digest("hex") !== meta.sha256) throw err(409, "The uploaded zip changed or is missing. Upload it again.");
    Object.assign(job, { zip: path.join(UPD(), "incoming", "release.zip"), sha256: meta.sha256, version: meta.version, fileName: meta.fileName });
  }
  if (action === "rollback" && !fss.existsSync(path.join(UPD(), "previous", "app", "package.json"))) throw err(409, "There's no earlier version kept to go back to.");
  await fs.mkdir(UPD(), { recursive: true });
  await fs.writeFile(path.join(UPD(), "pending.json"), JSON.stringify(job, null, 1));
  const label = { install: "Installed an update", restart: "Restarted the service", rollback: "Rolled back to the previous version", backup: "Started a backup" }[action];
  if (user.id) await audit(user, label, action === "install" ? `${job.fileName} ${job.version || ""}` : "");
  else await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES (NULL, $1, '', 'System', $2, $3)`,
    [user.name, label, action === "install" ? `${job.fileName} ${job.version || ""}` : ""]);
  await startUpdater();
  return job;
}
export const currentVersion = async () => (await readJson(path.join(APP_DIR, "VERSION.json"), {})).version || "";

async function status() {
  const cur = await readJson(path.join(APP_DIR, "VERSION.json"), {});
  const applied = new Set((await pool.query("SELECT version FROM schema_migrations")).rows.map(r => r.version));
  const incoming = await readJson(path.join(UPD(), "incoming", "release.json"));
  if (incoming) incoming.newMigrations = (incoming.migrations || []).filter(m => !applied.has(m));
  let disk = null;
  try { const s = await fs.statfs(ROOT()); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { disk = null; }
  const db = (await pool.query("SELECT pg_database_size(current_database())::bigint AS size")).rows[0];
  const backups = [];
  try {
    const dir = path.join(ROOT(), "backups");
    for (const n of await fs.readdir(dir)) { const st = await fs.stat(path.join(dir, n)); if (st.isFile()) backups.push({ name: n, size: st.size, at: st.mtime }); }
  } catch { /* no backups folder */ }
  backups.sort((a, b) => b.at - a.at);
  const updateLogs = [];
  try { for (const n of await fs.readdir(LOGS())) if (/^update-[\w-]+\.log$/.test(n)) { const st = await fs.stat(path.join(LOGS(), n)); updateLogs.push({ name: n, at: st.mtime, size: st.size }); } } catch { /* none */ }
  updateLogs.sort((a, b) => b.at - a.at);
  return {
    version: cur.version || "", notes: cur.notes || [], node: process.version, platform: `${os.type()} ${os.release()}`, host: os.hostname(),
    startedAt: new Date(started).toISOString(), uptimeSeconds: Math.round((Date.now() - started) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    disk, dbBytes: Number(db.size), migrations: applied.size, updater: await updaterReady(), task: TASK(),
    pending: await readJson(path.join(UPD(), "pending.json")), progress: await readJson(path.join(UPD(), "progress.json")), last: await readJson(path.join(UPD(), "last-result.json")),
packageName: PACKAGE_NAME || (PACKAGE ? PACKAGE : "sgfd-nexus"),
    incoming, rollbackReady: fss.existsSync(path.join(UPD(), "previous", "app", "package.json")),
    backups: backups.slice(0, 8), updateLogs: updateLogs.slice(0, 15),
  };
}
async function freshCode(user) {
  const u = (await pool.query("SELECT totp_enabled_at FROM users WHERE id = $1", [user.id])).rows[0];
  if (!u?.totp_enabled_at) throw err(403, "Set up two-step sign-in (an authenticator) first: system changes need a code.");
  const s = (await pool.query("SELECT mfa_at FROM sessions WHERE token_hash = $1", [user.sessionHash])).rows[0];
  if (!s?.mfa_at || Date.now() - new Date(s.mfa_at) > 5 * 60e3) throw Object.assign(err(401, "Enter a code from your authenticator."), { need: "code" });
}
async function tail(file, lines) {
  let fh;
  try {
    fh = await fs.open(file, "r");
    const { size } = await fh.stat();
    const len = Math.min(size, 512 * 1024), buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    return buf.toString("utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch { return ""; } finally { await fh?.close(); }
}

// ---- .env --------------------------------------------------------------------------------------------
const ENV_FILE = () => process.env.ENV_FILE || path.join(APP_DIR, ".env");
const ENV_HIST = () => path.join(UPD(), "env-history");
export const SECRET_KEY = /(PASS|SECRET|TOKEN|PRIVATE|API_KEY|_KEY$|PASSPHRASE|CREDENTIAL)/;
// Wrong values here can stop Nexus from starting, and then this page can't fix it: change these on the server
export const LOCKED_KEY = /^(PG[A-Z]*|DATABASE_URL|PORT|HOST|HTTP_REDIRECT_PORT|HTTPS_[A-Z_]+|FORMS_KEY[A-Z_]*|UPLOAD_DIR|SYSTEM_DIR|UPDATER_[A-Z_]+|ENV_FILE|NODE_ENV|SANDBOX|LICENSE_FILE|BACKUP_COPY_TO)$/;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const LINE_RE = /^\s*(#\s*)?(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/;
function unquote(raw) {
  const v = String(raw).trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) return v.slice(1, -1);
  const i = v.search(/\s#/);
  return (i >= 0 ? v.slice(0, i) : v).trim();
}
function quote(v) {
  if (v === "" || /^[^\s#"'\\]([^#"'\\]*[^\s#"'\\])?$/.test(v)) return v;
  if (!v.includes('"') && !v.includes("\\")) return `"${v}"`;
  if (!v.includes("'")) return `'${v}'`;
  throw err(400, "A value can't contain both kinds of quote marks.");
}
export function parseEnv(text) {
  const values = new Map();
  for (const line of String(text).split(/\r?\n/)) { const m = LINE_RE.exec(line); if (m && !m[1]) values.set(m[2], unquote(m[3])); }
  return values;
}
// .env.example: each key with its section ("# --- Email ---") and the comment lines just above it
function describeExample(text) {
  const out = new Map(); let section = "Other", notes = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t) { notes = []; continue; }
    const sec = /^#\s*-{2,}\s*(.+?)\s*-{2,}\s*$/.exec(t);
    if (sec) { section = sec[1].replace(/\(.*?\)/g, "").trim(); notes = []; continue; }
    const m = LINE_RE.exec(t);
    if (m) { if (!out.has(m[2])) out.set(m[2], { section, desc: notes.join(" ").slice(0, 400), example: unquote(m[3]) }); continue; }
    if (t.startsWith("#")) notes.push(t.replace(/^#\s?/, ""));
  }
  return out;
}
async function envState() {
  const text = await fs.readFile(ENV_FILE(), "utf8").catch(() => "");
  const values = parseEnv(text);
  const ex = describeExample(await fs.readFile(path.join(APP_DIR, ".env.example"), "utf8").catch(() => ""));
  const keys = [...new Set([...ex.keys(), ...values.keys()])];
  const entries = keys.map(key => {
    const e = ex.get(key) || { section: "Added here", desc: "", example: "" }, secret = SECRET_KEY.test(key), has = values.has(key);
    return { key, section: e.section, desc: e.desc, secret, locked: LOCKED_KEY.test(key), inFile: has, set: has && values.get(key) !== "",
      value: secret ? undefined : has ? values.get(key) : "", example: secret ? "" : e.example };
  });
  let history = [];
  try { history = (await fs.readdir(ENV_HIST())).filter(n => /^env-[\w-]+\.txt$/.test(n)).sort().reverse().slice(0, 20); } catch { history = []; }
  return { entries, history, file: fss.existsSync(ENV_FILE()) };
}
async function backupEnv(tag) {
  await fs.mkdir(ENV_HIST(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const name = `env-${stamp}-${tag}.txt`;
  await fs.copyFile(ENV_FILE(), path.join(ENV_HIST(), name)).catch(() => {});
  const old = (await fs.readdir(ENV_HIST())).filter(n => n.startsWith("env-")).sort().reverse().slice(30);
  for (const n of old) await fs.rm(path.join(ENV_HIST(), n), { force: true });
  return name;
}
async function changeEnv(user, changes) {
  if (!Array.isArray(changes) || !changes.length) throw err(400, "Nothing to change.");
  if (changes.length > 60) throw err(400, "Too many changes at once.");
  const clean = changes.map(c => {
    const key = String(c?.key || "").trim();
    if (!KEY_RE.test(key)) throw err(400, `"${key.slice(0, 40)}" isn't a setting name (capital letters, digits and _).`);
    if (LOCKED_KEY.test(key)) throw err(400, `${key} can only be changed on the server (a wrong value would stop ${brand().productName} from starting).`);
    if (c.remove) return { key, remove: true };
    const value = String(c.value ?? "");
    if (value.length > 2000 || /[\r\n\0]/.test(value)) throw err(400, `${key}: one line, under 2,000 characters.`);
    return { key, value, line: `${key}=${quote(value)}` };
  });
  const text = await fs.readFile(ENV_FILE(), "utf8").catch(() => "");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const added = [];
  for (const c of clean) {
    const at = lines.findIndex(l => { const m = LINE_RE.exec(l); return m && !m[1] && m[2] === c.key; });
    if (c.remove) { if (at >= 0) lines.splice(at, 1); continue; }
    if (at >= 0) lines[at] = c.line; else added.push(c.line);
  }
  if (added.length) { if (!lines.some(l => /^# --- Set in (Nexus|the app)/.test(l))) lines.push("", "# --- Set in the app (User Management > System) ---"); lines.push(...added); }
  const backup = await backupEnv("before");
  await fs.writeFile(ENV_FILE(), lines.join(eol) + eol, "utf8");      // in place: the file keeps its permissions
  await audit(user, "Changed server settings", `${clean.map(c => `${c.key}${c.remove ? " (removed)" : ""}`).join(", ")} · backup ${backup}`.slice(0, 500));
}

async function withSeats(sum) {
  const used = (await pool.query("SELECT count(*)::int AS n FROM users WHERE active AND account_status = 'approved' AND password_hash IS NOT NULL")).rows[0].n;
  return { ...sum, seatsUsed: used };
}

// ---- Organization page ----------------------------------------------------------------------------------------------------
async function orgState() {
  const divisions = (await pool.query(`SELECT d.name, count(u.id) FILTER (WHERE u.active)::int AS people FROM divisions d
    LEFT JOIN users u ON u.division_id = d.id GROUP BY d.id, d.name ORDER BY d.name`)).rows;
  const { roleCounts } = await import("./jobroles.js");
  const { loadProfiles } = await import("./access.js");
  const profiles = (await loadProfiles(pool)).map(p => ({ key: p.key, name: p.name, description: p.description }));
  return { ...orgSettings(), divisions, roles: await roleCounts(), profiles };
}
const divName = v => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 60);
async function changeDivision(user, b) {
  const name = divName(b.name);
  const row = async n => (await pool.query("SELECT id FROM divisions WHERE lower(name) = lower($1)", [n])).rows[0];
  if (b.action === "add") {
    if (!name) throw err(400, "Give the division a name.");
    if (await row(name)) throw err(409, `There's already a division called ${name}.`);
    await pool.query("INSERT INTO divisions (name) VALUES ($1)", [name]);
    return audit(user, "Added a division", name);
  }
  const cur = await row(name);
  if (!cur) throw err(404, "That division isn't there any more.");
  if (b.action === "rename") {
    const to = divName(b.to);
    if (!to) throw err(400, "Give the new name.");
    const other = await row(to);
    if (other && other.id !== cur.id) throw err(409, `There's already a division called ${to}.`);
    await pool.query("UPDATE divisions SET name = $2 WHERE id = $1", [cur.id, to]);
    const { clearAccessCache } = await import("./access.js"); clearAccessCache();
    return audit(user, "Renamed a division", `${name} → ${to}`);
  }
  if (b.action === "remove") {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      let moved = 0;
      if (b.moveTo) {
        const dest = await row(divName(b.moveTo));
        if (!dest || dest.id === cur.id) throw err(400, "Pick another division to move its people to.");
        moved = (await c.query("UPDATE users SET division_id = $2 WHERE division_id = $1", [cur.id, dest.id])).rowCount;
      }
      const left = Number((await c.query("SELECT count(*) FROM users WHERE division_id = $1", [cur.id])).rows[0].count);
      if (left) throw err(409, `${left} ${left === 1 ? "person is" : "people are"} still in ${name}. Pick a division to move them to.`);
      await c.query("DELETE FROM user_sign_divisions WHERE division_id = $1", [cur.id]);
      try { await c.query("DELETE FROM divisions WHERE id = $1", [cur.id]); }
      catch (e) { if (e.code === "23503") throw err(409, `${name} is still on older records (purchases, schedules or permissions), so it can't be removed. Rename it instead.`); throw e; }
      await c.query("COMMIT");
      const { clearAccessCache } = await import("./access.js"); clearAccessCache();
      return audit(user, "Removed a division", `${name}${moved ? ` (${moved} moved to ${divName(b.moveTo)})` : ""}`);
    } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  }
  throw err(400, "Add, rename or remove?");
}

export async function handleSystem(req, res, parts, user, send, jsonBody, url) {
  if (user.role !== "master") throw err(403, "System is for master admins.");
  const what = parts[2] || "";
  if (req.method === "GET" && !what) return send(res, 200, await status());
  if (req.method === "GET" && what === "env") return send(res, 200, await envState());
  if (req.method === "GET" && what === "branding" && parts[3] === "setup-logo") {
    const f = product() === "fenmorix" ? setupLogoFile() : "";
    if (!f) throw err(404, "No logo came with this install.");
    const type = { ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp" }[path.extname(f)];
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    return res.end(await fs.readFile(f));
  }
  if (req.method === "GET" && what === "org") return send(res, 200, await orgState());
  if (req.method === "GET" && what === "branding") return send(res, 200, await brandingState());
  if (req.method === "GET" && what === "license") { const { licenseSummary } = await import("./license.js"); return send(res, 200, await withSeats(licenseSummary())); }
  if (req.method === "GET" && what === "log") {
    const n = Math.min(2000, Math.max(20, Number(url.searchParams.get("lines")) || 300));
    return send(res, 200, { text: await tail(path.join(LOGS(), "sgfd-app.log"), n) });
  }
  if (req.method === "GET" && what === "update-log") {
    const name = String(parts[3] || "");
    if (!/^update-[\w-]+\.log$/.test(name)) throw err(404, "Not found.");
    return send(res, 200, { text: await tail(path.join(LOGS(), name), 2000) });
  }
  if (req.method === "GET" && what === "updates") {
    const { handleUpdatesAdmin } = await import("./updates.js");
    return send(res, 200, await handleUpdatesAdmin(user, "", {}, {}));
  }
  if (req.method !== "POST") throw err(404, "Not found.");
  const b = await jsonBody(req);

  if (what === "upload") {
    const buf = Buffer.from(String(b.data || ""), "base64");
    if (!buf.length) throw err(400, "Choose the zip.");
    await stageRelease(buf, b.fileName, user);
    return send(res, 200, await status());
  }
  if (what === "updates") {
    const { handleUpdatesAdmin } = await import("./updates.js");
    return send(res, 200, await handleUpdatesAdmin(user, parts[3] || "", b, { freshCode: () => freshCode(user), audit: (a, d) => audit(user, a, d) }));
  }
  // A new license file from the vendor: checked (signature, host) before it replaces the current one
  if (what === "license") {
    await freshCode(user);
    const { checkLicense, installLicense, licenseSummary } = await import("./license.js");
    const text = String(b.text || "").slice(0, 20000);
    const r = checkLicense(text);
    if (!r.ok) throw err(400, r.error);
    installLicense(text);
    await audit(user, "Installed a license", `${r.payload.customer} · ${r.payload.id} · ${r.payload.modules.length} modules · expires ${r.payload.expires || "never"}`);
    return send(res, 200, { ...(await withSeats(licenseSummary())), installed: true, restart: true });
  }
  // Organization: fire/EMS or business, wording, work schedules and pay periods, divisions (masters; no code needed)
  if (what === "org") {
    const before = orgSettings();
    const after = saveOrgSettings(b);
    const changed = [before.industry !== after.industry && `type: ${after.industry === "fire" ? "fire/EMS" : "business"}`,
      JSON.stringify(before.words) !== JSON.stringify(after.words) && "wording", JSON.stringify(before.work) !== JSON.stringify(after.work) && "work schedules / pay periods"].filter(Boolean);
    if (changed.length) await audit(user, "Changed organization settings", changed.join(", "));
    return send(res, 200, { ...(await orgState()), saved: true });
  }
  if (what === "roles") {
    await (await import("./jobroles.js")).changeRoles(user, b);
    return send(res, 200, { ...(await orgState()), saved: true });
  }
  if (what === "divisions") {
    await changeDivision(user, b);
    return send(res, 200, { ...(await orgState()), saved: true });
  }
  // Switch licensed modules off (and back on) for this server. Nothing is deleted: the data stays and comes back when it's switched on.
  if (what === "modules-off") {
    const { setOffModules, licenseSummary, licenseState, offModules } = await import("./license.js");
    const before = new Set(offModules());
    const off = setOffModules(b.off);
    const added = off.filter(k => !before.has(k)), back = [...before].filter(k => !off.includes(k));
    await audit(user, "Switched modules on or off", `${added.length ? `off: ${added.join(", ")}` : ""}${added.length && back.length ? " · " : ""}${back.length ? `back on: ${back.join(", ")}` : ""}` || "no change");
    if (licenseState().modules.has("spot")) (await import("./spot.js")).startSpot();
    return send(res, 200, { ...(await withSeats(licenseSummary())), saved: true });
  }
  // Sandbox only: which modules the demo shows (no license file on a sandbox; see license.js demoModules)
  if (what === "demo-modules") {
    const { setDemoModules, licenseSummary, licenseState } = await import("./license.js");
    const { isSandbox } = await import("./brand.js");
    if (!isSandbox()) throw err(404, "Demo modules are only on a sandbox.");
    if (licenseState().license) throw err(409, "A license file is installed, so it decides the modules. Remove it to use the demo switches.");
    const before = new Set(licenseState().modules);
    const list = setDemoModules(b.modules);
    const added = list.filter(k => !before.has(k)), removed = [...before].filter(k => !list.includes(k));
    await audit(user, "Changed the demo modules", `${list.length} on${added.length ? ` · added ${added.join(", ")}` : ""}${removed.length ? ` · removed ${removed.join(", ")}` : ""}`);
    if (list.includes("spot")) (await import("./spot.js")).startSpot();
    return send(res, 200, { ...(await withSeats(licenseSummary())), saved: true });
  }
  if (what === "branding") {
    await freshCode(user);
    await saveBranding(user, parts[3] || "", b);
    return send(res, 200, { ...(await brandingState()), saved: true });
  }
  if (what === "env" && !parts[3]) {
    await freshCode(user);
    await changeEnv(user, b.changes);
    return send(res, 200, { ...(await envState()), saved: true });
  }
  if (what === "env" && parts[3] === "restore") {
    await freshCode(user);
    const name = String(b.name || "");
    if (!/^env-[\w-]+\.txt$/.test(name)) throw err(400, "Which one?");
    const from = path.join(ENV_HIST(), name);
    if (!fss.existsSync(from)) throw err(404, "That copy is gone.");
    const before = await backupEnv("before-restore");
    await fs.writeFile(ENV_FILE(), await fs.readFile(from));
    await audit(user, "Put back earlier server settings", `${name} (current kept as ${before})`);
    return send(res, 200, { ...(await envState()), saved: true });
  }
  if (what === "discard") {
    await fs.rm(path.join(UPD(), "incoming"), { recursive: true, force: true });
    return send(res, 200, await status());
  }
  if (what === "run") {
    const action = String(b.action || "");
    if (!["install", "restart", "rollback", "backup"].includes(action)) throw err(400, "Which action?");
    await freshCode(user);
    const ready = await updaterReady();
    if (!ready.ready) throw err(409, ready.why);
    const job = await queueAction(action, user);
    return send(res, 200, { ok: true, job, down: action !== "backup" });
  }
  throw err(404, "Not found.");
}


// ---- Branding (Fenmorix OS installs): names, colors, menu names, logo files ---------------------------------------
// Saved in <SYSTEM_DIR>/branding (branding.json + assets/), outside the app folder, so updates keep it. St. George's Nexus can't change it.
const LOGO_MAX = 3 * 1024 * 1024;
const kindOf = buf => buf.length > 8 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG" ? "png"
  : buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? "jpg"
  : buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 ? "ico" : "";
const EXT_KIND = { ".png": "png", ".jpg": "jpg", ".ico": "ico" };
async function brandingState() {
  const editable = product() === "fenmorix", up = uploadedAssetsDir();
  return {
    editable, product: product(), saved: savedBranding(), brand: brand(),
    files: [...BRAND_FILES].map(name => ({ name, uploaded: editable && fss.existsSync(path.join(up, name)) })),
    setupLogo: editable && !!setupLogoFile(),
    tiles: TILE_LABELS,
  };
}
async function writeBrandingJson(data) {
  await fs.mkdir(brandingDir(), { recursive: true });
  const f = path.join(brandingDir(), "branding.json"), tmp = f + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 1));
  await fs.rename(tmp, f);
}
async function saveBranding(user, action, b) {
  if (product() !== "fenmorix") throw err(409, "This server is SGFD Nexus: its name, colors and logo stay as they are.");
  const cur = { ...savedBranding() };
  if (!action) {
    const txt = (v, n) => String(v ?? "").replace(/[\r\n<>]/g, " ").trim().slice(0, n);
    const next = { ...cur, org: txt(b.org, 120), short: txt(b.short, 20), place: txt(b.place, 60), app: txt(b.app, 60), colors: {}, terms: {} };
    for (const k of COLOR_KEYS) { const v = String(b.colors?.[k] || "").trim(); if (v && !HEX.test(v)) throw err(400, `That color isn't #RRGGBB (${k}).`); if (v) next.colors[k] = v.toUpperCase(); }
    const known = new Set(TILE_LABELS.map(t => t.key));
    for (const [k, v] of Object.entries(b.terms || {})) {
      if (!known.has(k)) continue;
      const name = txt(v, 40);
      if (name && name !== TILE_LABELS.find(t => t.key === k).label) next.terms[k] = name;
    }
    if (b.setup === "done") next.setup = "done";
    next.updatedAt = new Date().toISOString(); next.updatedBy = user.name;
    await writeBrandingJson(next);
    if (b.setup === "done" && cur.setup === "pending") await audit(user, "Finished the setup wizard", next.org || "");
    const changed = ["org", "short", "place", "app"].filter(k => (cur[k] || "") !== next[k]);
    if (JSON.stringify(cur.colors || {}) !== JSON.stringify(next.colors)) changed.push("colors");
    if (JSON.stringify(cur.terms || {}) !== JSON.stringify(next.terms)) changed.push("menu names");
    await audit(user, "Changed the branding", changed.join(", ") || "no changes");
    return;
  }
  if (action === "logo") {
    const files = b.files && typeof b.files === "object" ? Object.entries(b.files) : [];
    if (!files.length) throw err(400, "Choose a logo.");
    const ready = [];
    for (const [name, dataUrl] of files) {
      if (!BRAND_FILES.has(name)) throw err(400, `${name} isn't a logo file this app uses.`);
      const m = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
      if (!m) throw err(400, `${name} isn't a picture.`);
      const buf = Buffer.from(m[1], "base64");
      if (!buf.length || buf.length > LOGO_MAX) throw err(413, `${name} is too big (3 MB at most).`);
      if (kindOf(buf) !== EXT_KIND[path.extname(name)]) throw err(400, `${name} isn't a ${path.extname(name).slice(1).toUpperCase()} picture.`);
      ready.push([name, buf]);
    }
    await fs.mkdir(uploadedAssetsDir(), { recursive: true });
    for (const [name, buf] of ready) { const f = path.join(uploadedAssetsDir(), name); await fs.writeFile(f + ".tmp", buf); await fs.rename(f + ".tmp", f); }
    await writeBrandingJson({ ...cur, updatedAt: new Date().toISOString(), updatedBy: user.name });
    await audit(user, "Changed the logo", ready.map(r => r[0]).join(", "));
    return;
  }
  if (action === "remove") {
    const names = b.all ? [...BRAND_FILES] : (Array.isArray(b.files) ? b.files : []).filter(n => BRAND_FILES.has(n));
    if (!names.length) throw err(400, "Which files?");
    for (const n of names) await fs.rm(path.join(uploadedAssetsDir(), n), { force: true });
    await writeBrandingJson({ ...cur, updatedAt: new Date().toISOString(), updatedBy: user.name });
    await audit(user, "Removed logo files", b.all ? "all (back to the Fenmorix OS logo)" : names.join(", "));
    return;
  }
  throw err(404, "Not found.");
}
