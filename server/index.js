// SGFD Management System — server.
//
//   npm run dev     development: live-reloading app at http://localhost:3000
//   npm run build   then
//   npm start       production: serves the built app from dist/
//
// Settings are read from .env (see .env.example).
try { process.loadEnvFile(".env"); } catch { /* no .env: rely on real environment */ }

const http = await import("node:http");
const https = await import("node:https");
const fs = await import("node:fs/promises");
const path = await import("node:path");
const { pool } = await import("./db.js");
const { brandHtml, brandManifest, brandFilePath, BRAND_FILES, isSandbox, brand } = await import("./brand.js");
const { apiAllowed, collectionAllowed, moduleOn, licenseState } = await import("./license.js");
const { CORE } = await import("../src/modules.js");
const { migrate } = await import("./migrate.js");
const { readCollection, saveCollection, friendlyError } = await import("./collections.js");
const { putFile, getFile, deleteFile } = await import("./files.js");
const { handleAuth, getSessionUser } = await import("./auth.js");
const { handleRecordings } = await import("./recordings.js");
const { handleForms, seedForms } = await import("./forms.js");
const { handleDirectory } = await import("./directory.js");
const { startAladtec } = await import("./aladtec.js");
const { startCad, activeCalls, refreshCalls, cadDiagnostics } = await import("./cad.js");
const { handleTimeClock } = await import("./timeclock.js");
const { getWeather } = await import("./weather.js");
const { handleAccess } = await import("./access.js");
const { handleMessages, startDeliveries } = await import("./messages.js");
const { handleEvents } = await import("./events.js");
const { handleLeave } = await import("./leave.js");
const { handleDocuments } = await import("./documents.js");
const { handleAudit } = await import("./audit.js");
const { handleSick } = await import("./sick.js");
const { handlePrefs } = await import("./prefs.js");
const { handleStats, startCadStats } = await import("./cadstats.js");
const { handlePial } = await import("./pial.js");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const MAX_BODY = 40 * 1024 * 1024;   // files arrive as data: URLs (about 1.4x their size)

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
};

function send(res, status, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...SECURITY_HEADERS });
  res.end(data);
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error("Upload is too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function jsonBody(req, max = MAX_BODY) {
  const text = await readBody(req, max);
  try { return JSON.parse(text || "{}"); }
  catch { throw Object.assign(new Error("Bad request"), { status: 400 }); }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);   // ["api", ...]

  // Changes must come from this app's own pages (blocks forged cross-site requests)
  if (req.method !== "GET" && req.headers["x-sgfd"] !== "1") {
    return send(res, 403, { error: "Request blocked" });
  }

  if (parts[1] === "health") {
    await pool.query("SELECT 1");
    return send(res, 200, { ok: true });
  }

  const user = await getSessionUser(req);

  // Anyone can reach these without signing in: small bodies only, and a cap per address
  const SMALL = 256 * 1024;
  if (!user && req.method !== "GET" && !(await import("./ratelimit.js")).allow(`anon:${(await import("./ratelimit.js")).ipOf(req)}`, 120, 60_000)) {
    return send(res, 429, { error: "Too many requests from this address. Wait a minute and try again." });
  }
  if (parts[1] === "auth" && parts[2]) {
    const body = req.method === "GET" ? {} : await jsonBody(req, user ? MAX_BODY : SMALL);
    // Sign-in steps also see a session that still owes its authenticator code
    const pending = user ? null : await getSessionUser(req, { allowPending: true });
    return handleAuth(req, res, parts[2], body, user, send, pending?.mfaPending ? pending : null);
  }

  // TV display screens sign in with their own cookie (no user session); admin routes there check the user themselves
  if (parts[1] === "display") { const { handleDisplay } = await import("./display.js"); return handleDisplay(req, res, parts, user, send, r => jsonBody(r, user ? MAX_BODY : SMALL)); }

  // Everything else requires a signed-in, approved person
  if (!user) return send(res, 401, { error: "Please sign in again." });

  // Modules this install isn't licensed for answer as if they weren't there (core routes always work)
  // (the people list under Messages is used by other sections too, e.g. Emergency Recall)
  const peopleList = parts[1] === "messages" && parts[2] === "people" && req.method === "GET";
  if (!CORE.api.includes(parts[1]) && parts[1] !== "collections" && !peopleList && !apiAllowed(parts[1])) {
    return send(res, 404, { error: "That section isn't part of this subscription.", locked: true });
  }

  if (parts[1] === "recordings") return handleRecordings(req, res, parts, user, send, jsonBody);
  if (parts[1] === "forms") return handleForms(req, res, parts, user, send, jsonBody);
  if (parts[1] === "directory") return handleDirectory(req, res, parts, user, send, jsonBody);
  if (parts[1] === "time") return handleTimeClock(req, res, parts, user, send, jsonBody);
  if (parts[1] === "weather" && req.method === "GET") return send(res, 200, await getWeather());
  if (parts[1] === "access") return handleAccess(req, res, parts, user, send, jsonBody);
  if (parts[1] === "events" && req.method === "GET") return handleEvents(req, res, user);
  if (parts[1] === "leave") return handleLeave(req, res, parts, user, send, jsonBody, url);
  if (parts[1] === "documents") return handleDocuments(req, res, parts, user, send, jsonBody);
  if (parts[1] === "audit") return handleAudit(req, res, parts, user, send, url);
  if (parts[1] === "sick") return handleSick(req, res, parts, user, send, jsonBody, url);
  if (parts[1] === "personnel" && parts[2] === "purchases" && req.method === "GET") {
    const { purchasesFor } = await import("./collections.js");
    return send(res, 200, await purchasesFor(user, url.searchParams.get("user")));
  }
  if (parts[1] === "tickets" && parts[2] === "routing" && req.method === "GET") {
    const { ticketRouting } = await import("./collections.js");
    return send(res, 200, await ticketRouting());
  }
  if (parts[1] === "req-signature" && req.method === "GET") {
    const { requisitionSignature } = await import("./collections.js");
    const img = await requisitionSignature(user, parts[2], parts[3]);
    if (!img) return send(res, 404, { error: "No signature" });
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
    return res.end(Buffer.from(img.split(",")[1], "base64"));
  }
  if (parts[1] === "notices") { const { handleNotices } = await import("./messages.js"); return handleNotices(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "messages") return handleMessages(req, res, parts, user, send, jsonBody);
  if (parts[1] === "apparatus") { const { handleApparatus } = await import("./bookings.js"); return handleApparatus(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "bookings") { const { handleBookings } = await import("./bookings.js"); return handleBookings(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "recall") { const { handleRecall } = await import("./recall.js"); return handleRecall(req, res, parts, user, send, jsonBody, url); }
  // No real case or criminal-history data on a sandbox: Investigations is off there
  if (parts[1] === "inv" && isSandbox()) return send(res, 404, { error: "Investigations isn't available in the sandbox (no CJIS data on a demo server)." });
  if (parts[1] === "inv") { const { handleInvestigations } = await import("./investigations.js"); return handleInvestigations(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "board") { const { handleBoard } = await import("./board.js"); return handleBoard(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "command") { const { handleCommand } = await import("./command.js"); return handleCommand(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "callalerts") { const { handleCallAlerts } = await import("./callalerts.js"); return handleCallAlerts(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "system") { const { handleSystem } = await import("./system.js"); return handleSystem(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "forceback") { const { handleForceback } = await import("./forceback.js"); return handleForceback(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "schedule") { const { handleSchedule } = await import("./schedule.js"); return handleSchedule(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "offwork") { const { handleOffwork } = await import("./offwork.js"); return handleOffwork(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "spot") { const { handleSpot } = await import("./spot.js"); return handleSpot(req, res, parts, user, send, url); }
  if (parts[1] === "links") { const { handleLinks } = await import("./links.js"); return handleLinks(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "fireprev") { const { handleFireprev } = await import("./fireprev.js"); return handleFireprev(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "imt") { const { handleImt } = await import("./imt.js"); return handleImt(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "evals") { const { handleEvals } = await import("./evals.js"); return handleEvals(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "training") { const { handleTraining } = await import("./training.js"); return handleTraining(req, res, parts, user, send, jsonBody, url); }
  if (parts[1] === "push") { const { handlePush } = await import("./push.js"); return handlePush(req, res, parts, user, send, jsonBody); }
  if (parts[1] === "prefs") return handlePrefs(req, res, parts, user, send, jsonBody);
  if (parts[1] === "stats") return handleStats(req, res, parts, user, send, jsonBody, url);
  if (parts[1] === "pial") return handlePial(req, res, parts, user, send, jsonBody, url);
  if (parts[1] === "cad" && parts[2] === "active" && req.method === "GET") {
    const snap = activeCalls();
    // Connection errors can name servers/logins: only masters see the text
    return send(res, 200, { ...snap, error: snap.error ? (user.role === "master" ? snap.error : "Active calls can't be reached right now.") : "" });
  }
  if (parts[1] === "cad" && parts[2] === "diagnostics" && req.method === "GET") {
    if (user.role !== "master") return send(res, 403, { error: "Only master admins can do that." });
    return send(res, 200, cadDiagnostics());
  }
  if (parts[1] === "cad" && parts[2] === "refresh" && req.method === "POST") {
    if (user.role !== "master") return send(res, 403, { error: "Only master admins can do that." });
    return send(res, 200, await refreshCalls());
  }

  if (parts[1] === "collections" && parts[2]) {
    const key = decodeURIComponent(parts[2]);
    if (!collectionAllowed(key)) {
      if (req.method === "GET") return send(res, 200, { value: null, locked: true });
      return send(res, 403, { error: "That section isn't part of this subscription.", locked: true });
    }
    if (req.method === "GET") return send(res, 200, { value: await readCollection(key, user) });
    if (req.method === "POST") {
      await saveCollection(key, await jsonBody(req), user);
      return send(res, 200, { ok: true });
    }
  }

  if (parts[1] === "files" && parts[2]) {
    const id = parts[2];
    const { canReadFile } = await import("./files.js");
    if (req.method === "GET") {
      const value = (await canReadFile(id, user)) ? await getFile(id) : null;
      return value ? send(res, 200, { value }) : send(res, 404, { error: "File not found" });
    }
    if (req.method === "PUT") {
      const body = await jsonBody(req);
      await putFile(id, body.dataUrl, user);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") {
      if (await canReadFile(id, user)) await deleteFile(id);
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: "Not found" });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

// Extra protection for the app's pages: only load scripts/styles/images from this server,
// never be framed by another site, and (with HTTPS) always use HTTPS.
const PAGE_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=()",
};

// pdf.js (IMT: PDF attachments turned into page pictures in the browser), straight from node_modules so the
// app build never has to process it. PDFJS_DIR overrides where it's found.
const PDFJS_FILES = new Set(["pdf.min.mjs", "pdf.worker.min.mjs"]);
async function servePdfjs(req, res, url) {
  const name = url.pathname.slice("/vendor/pdfjs/".length);
  if (!PDFJS_FILES.has(name)) return send(res, 404, "Not found", "text/plain");
  const dir = process.env.PDFJS_DIR || path.join(ROOT, "node_modules", "pdfjs-dist", "build");
  try {
    const data = await fs.readFile(path.join(dir, name));
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=86400", ...SECURITY_HEADERS });
    res.end(data);
  } catch { send(res, 404, "pdf.js isn't installed (run npm install).", "text/plain"); }
}

// The app's code goes only to signed-in people and paired TV screens. Everyone else gets signin.html and the scripts it
// loads (worked out once from the built page: its <script>/<link> files and what they import), plus pictures and icons.
let publicFiles = null;
async function publicScripts() {
  if (publicFiles) return publicFiles;
  const set = new Set(["sw.js"]);
  try {
    const html = await fs.readFile(path.join(DIST, "signin.html"), "utf8");
    const queue = [...html.matchAll(/(?:src|href)="\/([^"]+\.(?:js|mjs|css))"/g)].map(m => m[1]);
    while (queue.length) {
      const f = path.posix.normalize(queue.shift());
      if (set.has(f) || f.startsWith("..")) continue;
      set.add(f);
      if (!/\.m?js$/.test(f)) continue;
      const code = await fs.readFile(path.join(DIST, f), "utf8").catch(() => "");
      for (const m of code.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+\.(?:js|mjs|css))["']/g)) queue.push(path.posix.join(path.posix.dirname(f), m[1]));
    }
  } catch { /* no signin.html: an older build; everything stays as it was */ }
  publicFiles = set;
  return set;
}
async function mayLoadApp(req) {
  if (await getSessionUser(req)) return true;
  const { displayScreenFor } = await import("./display.js");
  return !!(await displayScreenFor(req));
}

async function serveBuilt(req, res, url) {
  // Logo / icon files: the customer's folder, else the Fenmorix set (Fenmorix OS installs), else the built-in (St. George) ones
  const want = url.pathname.replace(/^\/+/, "");
  if (BRAND_FILES.has(want)) {
    const alt = brandFilePath(want);
    if (alt) { res.writeHead(200, { "Content-Type": MIME[path.extname(want)] || "application/octet-stream", "Cache-Control": "no-cache", ...SECURITY_HEADERS }); return res.end(await fs.readFile(alt)); }
    if (want === "brand-wordmark.png") return send(res, 404, "Not found", "text/plain");
  }
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ""));
  if (!file.startsWith(DIST + path.sep) && file !== DIST) return send(res, 403, { error: "Forbidden" });
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    file = path.join(DIST, "index.html");   // single-page app
  }
  const hasSignin = await fs.stat(path.join(DIST, "signin.html")).then(() => true, () => false);
  if (hasSignin) {
    const ext = path.extname(file), rel = path.relative(DIST, file).split(path.sep).join("/");
    if (ext === ".html") {
      if (rel !== "signin.html" && !(await mayLoadApp(req))) file = path.join(DIST, "signin.html");
    } else if ([".js", ".mjs", ".css", ".map"].includes(ext) && !(await publicScripts()).has(rel) && !(await mayLoadApp(req))) {
      return send(res, 404, "Not found", "text/plain");
    }
  }
  const base = path.basename(file);
  try {
    let data = await fs.readFile(file);
    const html = path.extname(file) === ".html";
    if (html) data = brandHtml(data.toString("utf8"), path.basename(file) === "signin.html" ? {} : { modules: [...licenseState().modules] });
    else if (base === "manifest.webmanifest") data = brandManifest(data.toString("utf8"));
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream", ...SECURITY_HEADERS,
      ...(html ? { ...PAGE_HEADERS, "Cache-Control": "no-store" } : {}),
      // The service worker (push notifications) is always checked for a newer copy
      ...(path.basename(file) === "sw.js" ? { "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" } : {}),
      ...(req.secure ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
    });
    res.end(data);
  } catch {
    send(res, 404, "Run `npm run build` first.", "text/plain");
  }
}

// ---------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------

try {
  await pool.query("SELECT 1");
} catch (err) {
  console.error("\nCan't connect to Postgres:", err.message);
  console.error("Check the PG* settings in .env and that the PostgreSQL service is running.\n");
  process.exit(1);
}
await migrate();
brand();   // reads the organization settings (pay periods, rotations) into the shared schedule code
{ const ls = licenseState(); console.log(`License: ${ls.mode}${ls.license ? ` (${ls.license.customer}, ${ls.modules.size} modules)` : ""}${ls.error ? ` - ${ls.error}` : ""}`); }
// A sandbox ships every module and switches them in System › Demo modules: start everything so turning one on needs no restart
const startOn = k => moduleOn(k) || isSandbox();
if (startOn("forms")) await seedForms();
if (startOn("evals")) await (await import("./evals.js")).seedEvals().catch(e => console.warn(`[Evaluations] seeding: ${e.message}`));
startAladtec();
if (startOn("activecalls") || startOn("callalerts") || startOn("command")) startCad();
if (startOn("stats") || startOn("board") || startOn("pial")) startCadStats().catch(e => console.warn(`[Comms statistics] ${e.message}`));
startDeliveries();   // next-shift delivery also carries other modules' notices
if (startOn("recordings") || startOn("evals")) import("./transcribe.js").then(m => m.startTranscripts());
if (startOn("spot")) import("./spot.js").then(m => m.startSpot());

let vite = null;
if (!PROD) {
  const { createServer } = await import("vite");
  vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "spa" });
}

// HTTPS if a certificate is configured (required once other computers use it).
// Either a .pfx file (what Windows / IT usually hands out) or a .crt + .key pair.
let tls = null;
try {
  if (process.env.HTTPS_PFX_FILE) {
    tls = { pfx: await fs.readFile(process.env.HTTPS_PFX_FILE), passphrase: process.env.HTTPS_PFX_PASSPHRASE || undefined };
  } else if (process.env.HTTPS_CERT_FILE && process.env.HTTPS_KEY_FILE) {
    tls = { cert: await fs.readFile(process.env.HTTPS_CERT_FILE), key: await fs.readFile(process.env.HTTPS_KEY_FILE) };
  }
} catch (err) {
  console.error(`\nCan't read the HTTPS certificate: ${err.message}`);
  console.error("Check HTTPS_PFX_FILE / HTTPS_CERT_FILE / HTTPS_KEY_FILE in .env.\n");
  process.exit(1);
}
if (!tls && PORT === 443) console.warn("PORT is 443 but no HTTPS certificate is set in .env: the app will answer plain http on 443.");

async function handler(req, res) {
  req.secure = !!tls;
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (url.pathname.startsWith("/vendor/pdfjs/")) return await servePdfjs(req, res, url);
    if (vite) return vite.middlewares(req, res, () => send(res, 404, "Not found", "text/plain"));
    return await serveBuilt(req, res, url);
  } catch (err) {
    if (err.status && !err.code) return send(res, err.status, { error: err.message, ...(err.need ? { need: err.need } : {}) });
    const { status, message } = friendlyError(err);
    if (status >= 500) console.error(err);
    else console.warn(`[${req.method} ${url.pathname}] ${err.message}`);
    send(res, status, { error: message });
  }
}

let server;
try {
  server = tls ? https.createServer(tls, handler) : http.createServer(handler);
} catch (err) {
  console.error(`\nThe HTTPS certificate couldn't be used: ${err.message}`);
  console.error("If it's a .pfx, check HTTPS_PFX_PASSPHRASE in .env.\n");
  process.exit(1);
}
const portProblem = (port, err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${port} is already in use by another program. On Windows Server this is usually IIS ` +
      `(World Wide Web Publishing Service) or another web app. Find it with:\n` +
      `  Get-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess\n`);
  } else if (err.code === "EACCES") {
    console.error(`\nNot allowed to use port ${port}. Run the app as the Windows service (it runs as SYSTEM).\n`);
  } else console.error(`\nCan't listen on port ${port}: ${err.message}\n`);
};
server.on("error", err => { portProblem(PORT, err); process.exit(1); });

// With HTTPS on, answer plain http (normally port 80) with a redirect to https,
// so typing just the server name in a browser still works.
const REDIRECT_PORT = Number(process.env.HTTP_REDIRECT_PORT || 0);
if (tls && REDIRECT_PORT && REDIRECT_PORT !== PORT) {
  const redirector = http.createServer((req, res) => {
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!/^[a-z0-9.-]{1,253}$/i.test(host) && !/^\[[0-9a-f:.]+\]$/i.test(host)) { res.writeHead(400); return res.end("Bad request"); }
    res.writeHead(301, { Location: `https://${host}${PORT === 443 ? "" : `:${PORT}`}${req.url}`, "Cache-Control": "no-store" });
    res.end();
  });
  redirector.on("error", err => { portProblem(REDIRECT_PORT, err); console.warn("Continuing without the http -> https redirect."); });
  redirector.listen(REDIRECT_PORT, HOST, () => console.log(`Redirecting http on port ${REDIRECT_PORT} to https.`));
}

server.listen(PORT, HOST, () => {
  const where = HOST === "127.0.0.1" || HOST === "localhost" ? "this computer only" : "other computers can connect";
  console.log(`\n${brand().app}${isSandbox() ? " (SANDBOX)" : ""} running at ${tls ? "https" : "http"}://localhost${(tls && PORT === 443) ? "" : `:${PORT}`}` +
    `  (${PROD ? "production" : "development"}, ${where})\n`);
});

// Shut down promptly when the Windows service (NSSM) or Ctrl+C asks us to stop.
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${sig})…`);
    setTimeout(() => process.exit(0), 3000).unref();
    server.close();
    server.closeAllConnections?.();
    Promise.resolve().then(() => pool.end?.()).catch(() => {}).finally(() => process.exit(0));
  });
}
