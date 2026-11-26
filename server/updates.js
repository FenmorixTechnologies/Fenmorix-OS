// Broadcast updates, this server's side: it checks in with the vendor's update service (the office portal, server/hub.js) every 6 hours,
// reports its version, and learns about a newer release for its own package. A release is downloaded only from that service, then
// checked twice: the sha256 and the vendor's signature (license.js verifyRelease: made on the vendor's own computer with the License
// Manager, so a break-in at the update service can't push code), then the usual release checks (system.js checkRelease: right package,
// safe paths, no secrets). Installing still goes through the updater like an uploaded zip: with a code from the System page, or at night
// by itself when a master turned on automatic updates (with a code).
//
// Settings: <SYSTEM_DIR>/hub/hub.json {url, key (enrollment key from the vendor), auto, autoAt "HH:MM"} (0600), state in hub/state.json.
// UPDATE_HUB_URL in .env = default service address. UPDATE_CHECK_HOURS (6).
//   GET  /api/system/updates             {configured, url, auto, autoAt, lastCheck, lastError, available, current}
//   POST /api/system/updates/settings    {url, key?, auto, autoAt}   (5-minute code)
//   POST /api/system/updates/check       ask the service now
//   POST /api/system/updates/download    fetch the available release into updates/incoming (then Install as usual, with a code)
//   POST /api/system/updates/forget      stop checking in (removes the key)
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { verifyRelease, licenseState } from "./license.js";
import { PACKAGE, PACKAGE_NAME } from "./buildFlags.js";
import { brand } from "./brand.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const ROOT = () => path.resolve(process.env.SYSTEM_DIR || path.join(import.meta.dirname, "..", ".."));
const DIR = () => path.join(ROOT(), "hub");
const CONF = () => path.join(DIR(), "hub.json"), STATE = () => path.join(DIR(), "state.json");
const myPackage = () => PACKAGE || "sgfd";
const readJson = async (p, d = {}) => { try { return JSON.parse((await fs.readFile(p, "utf8")).replace(/^﻿/, "")); } catch { return d; } };
async function writeJson(p, v, mode = 0o600) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(v, null, 1), { mode }); }
const cleanUrl = u => { const s = String(u || "").trim().replace(/\/+$/, ""); if (!s) return ""; if (!/^https:\/\/[\w.-]+(:\d+)?$/i.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(s)) throw err(400, "The update service address must be https://name (no path)."); return s; };
// "2026.11.26.4" > "2026.11.26.3"
export function newer(a, b) {
  const x = String(a || "").split(/[.-]/).map(Number), y = String(b || "").split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
async function conf() {
  const c = await readJson(CONF());
  return { url: c.url || process.env.UPDATE_HUB_URL || "", key: c.key || "", auto: !!c.auto, autoAt: /^\d{2}:\d{2}$/.test(c.autoAt || "") ? c.autoAt : "03:00" };
}
async function call(c, p, init = {}) {
  const r = await fetch(`${c.url}/api/hub/client/${p}`, { ...init, redirect: "manual", signal: AbortSignal.timeout(init.timeout || 30000),
    headers: { authorization: `Bearer ${c.key}`, "x-sgfd": "1", "content-type": "application/json", ...(init.headers || {}) } });
  if (r.status >= 300 && r.status < 400) throw err(502, "The update service sent a sign-in page instead of answering (its address may be behind a sign-in).");
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw err(r.status === 401 ? 401 : 502, j.error || `The update service answered ${r.status}.`); }
  return r;
}

// Ask the service: report this server, learn the newest release for this package
export async function checkNow() {
  const c = await conf(), st = await readJson(STATE());
  if (!c.url || !c.key) return { skipped: true };
  const { currentVersion } = await import("./system.js");
  const version = await currentVersion();
  const users = Number((await pool.query("SELECT count(*) AS n FROM users WHERE active AND password_hash IS NOT NULL")).rows[0]?.n || 0);
  const last = await readJson(path.join(ROOT(), "updates", "last-result.json"), null);
  const b = brand();
  const info = { org: b.org, product: b.productName, host: os.hostname(), url: process.env.PUBLIC_URL || "", users, modules: [...licenseState().modules],
    node: process.version, platform: `${os.type()} ${os.release()}`, auto: c.auto, uptimeHours: Math.round(process.uptime() / 360) / 10,
    lastUpdate: last ? { ok: !!last.ok, action: last.action, at: last.at, message: String(last.message || "").slice(0, 200) } : null };
  try {
    const r = await call(c, "checkin", { method: "POST", body: JSON.stringify({ package: myPackage(), version, info }) });
    const j = await r.json();
    let available = null;
    if (j.latest && j.latest.package === myPackage() && newer(j.latest.version, version)) {
      const v = verifyRelease(j.latest);
      available = v.ok ? { ...j.latest, notes: (j.latest.notes || []).slice(0, 40) } : { ...j.latest, bad: v.error };
    }
    await writeJson(STATE(), { ...st, lastCheck: new Date().toISOString(), lastError: "", available, hold: !!j.hold });
    return { ok: true, available };
  } catch (e) {
    await writeJson(STATE(), { ...st, lastCheck: new Date().toISOString(), lastError: e.message });
    return { ok: false, error: e.message };
  }
}
// Fetch the available release, check sha256 + signature, then stage it like an uploaded zip
export async function downloadAvailable(actor) {
  const c = await conf(), st = await readJson(STATE());
  const a = st.available;
  if (!a) throw err(409, "No newer version is waiting. Check for updates first.");
  if (a.bad) throw err(409, `The newest release didn't pass the signature check (${a.bad}). It won't be installed.`);
  const r = await call(c, `download/${encodeURIComponent(a.id)}`, { timeout: 300000 });
  const buf = Buffer.from(await r.arrayBuffer());
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== a.sha256) throw err(409, "The downloaded file doesn't match the release (sha256). Nothing was changed; try again.");
  const v = verifyRelease({ ...a, sha256: sha });
  if (!v.ok) throw err(409, `The download didn't pass the signature check (${v.error}). Nothing was changed.`);
  const { stageRelease } = await import("./system.js");
  const meta = await stageRelease(buf, `${PACKAGE_NAME || "sgfd-nexus"}-${a.version}.zip`, actor, { signed: true, kid: a.kid, from: c.url });
  if (meta.version !== a.version) throw err(409, "The zip's version doesn't match the release. Nothing was installed.");
  await writeJson(STATE(), { ...(await readJson(STATE())), downloaded: a.version });
  return meta;
}

// Every 6 hours (first one 90 s after start); every 10 minutes: the night install when automatic updates are on
let started = false;
export function startUpdateChecks() {
  if (started) return; started = true;
  const hours = Math.max(1, Math.min(48, Number(process.env.UPDATE_CHECK_HOURS) || 6));
  const tick = () => checkNow().catch(e => console.warn("[updates]", e.message));
  setTimeout(() => { tick(); setInterval(tick, hours * 3600e3).unref(); }, Number(process.env.UPDATE_FIRST_CHECK_SECONDS || 90) * 1000).unref();
  setInterval(() => autoInstall().catch(e => console.warn("[updates] automatic install:", e.message)), Number(process.env.UPDATE_AUTO_TICK_SECONDS || 600) * 1000).unref();
}
export async function autoInstall(now = new Date()) {
  const c = await conf(), st = await readJson(STATE());
  if (!c.auto || !st.available || st.available.bad || st.hold) return { skipped: "nothing to do" };
  const [h, m] = c.autoAt.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes(), at = h * 60 + m;
  const day = now.toISOString().slice(0, 10);
  if (mins < at || mins >= at + 60 || st.autoTried === `${day}:${st.available.version}`) return { skipped: "not the time" };
  await writeJson(STATE(), { ...st, autoTried: `${day}:${st.available.version}` });
  const actor = { name: "Automatic update" };
  await downloadAvailable(actor);
  const { queueAction } = await import("./system.js");
  return queueAction("install", actor);
}

// System page (masters)
export async function handleUpdatesAdmin(user, what, b, { freshCode, audit }) {
  const view = async () => {
    const c = await conf(), st = await readJson(STATE());
    const { currentVersion } = await import("./system.js");
    return { configured: !!(c.url && c.key), url: c.url, auto: c.auto, autoAt: c.autoAt, lastCheck: st.lastCheck || null, lastError: st.lastError || "",
      available: st.available || null, downloaded: st.downloaded || "", hold: !!st.hold, current: await currentVersion(), package: myPackage() };
  };
  if (!what) return view();
  if (what === "settings") {
    await freshCode();
    const cur = await readJson(CONF());
    const url = b.url !== undefined ? cleanUrl(b.url) : cur.url || "";
    const key = b.key ? String(b.key).trim() : cur.key || "";
    if (b.key && !/^fxu_[A-Za-z0-9_-]{30,80}$/.test(key)) throw err(400, "That doesn't look like an update key (it starts with fxu_).");
    const autoAt = /^\d{2}:\d{2}$/.test(b.autoAt || "") ? b.autoAt : cur.autoAt || "03:00";
    await writeJson(CONF(), { url, key, auto: !!b.auto, autoAt });
    await audit("Changed update settings", `service ${url || "(none)"}${b.key ? ", new key" : ""}, automatic ${b.auto ? `on at ${autoAt}` : "off"}`);
    if (url && key) await checkNow();
    return view();
  }
  if (what === "check") { const r = await checkNow(); if (r.error) throw err(502, r.error); return view(); }
  if (what === "download") { await downloadAvailable(user); return view(); }
  if (what === "forget") {
    await freshCode();
    await fs.rm(CONF(), { force: true }); await fs.rm(STATE(), { force: true });
    await audit("Stopped checking for updates", "");
    return view();
  }
  throw err(404, "Not found.");
}
