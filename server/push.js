// Push notifications to phones, tablets and computers (Web Push: RFC 8030 / 8291 / 8292).
// No outside service account is needed: each browser gives Nexus an address at its own push
// service (Google, Apple, Mozilla, Microsoft) and Nexus signs its requests with its own key
// (VAPID), made the first time and kept in the settings table.
//
//   GET  /api/push/key           -> { key, supported }   the public key the browser subscribes with
//   POST /api/push/subscribe     { subscription, label, importantOnly }
//   POST /api/push/unsubscribe   { endpoint }
//   POST /api/push/device        { endpoint, importantOnly }
//   GET  /api/push/devices       -> { devices: [...] }   this person's devices
//   POST /api/push/test          { endpoint? }           send a test to one or all of my devices
//
// Requirements: the site must have a trusted HTTPS certificate, and the server must be allowed
// to make outbound HTTPS requests to the push services (fcm.googleapis.com, *.push.apple.com,
// *.push.services.mozilla.com, *.notify.windows.com).
import { inEmergency } from "./emergency.js";
import { brand, brandText, brandDeep } from "./brand.js";
import crypto from "node:crypto";
import { pool } from "./db.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const b64u = buf => Buffer.from(buf).toString("base64url");
const unb64u = s => Buffer.from(String(s || ""), "base64url");
const SUBJECT = () => process.env.PUSH_CONTACT || brand().url || "mailto:admin@localhost";

// ---- The server's key pair (VAPID) -----------------------------------------------------------------
let keys = null;
export async function vapidKeys() {
  if (keys) return keys;
  const row = (await pool.query("SELECT value FROM settings WHERE key = 'vapid'")).rows[0];
  let v = row?.value;
  if (!v?.privateKey) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    v = { privateKey: privateKey.export({ format: "jwk" }), publicKey: b64u(publicKey.export({ format: "der", type: "spki" }).subarray(-65)) };
    await pool.query("INSERT INTO settings (key, value) VALUES ('vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(v)]);
    v = (await pool.query("SELECT value FROM settings WHERE key = 'vapid'")).rows[0].value;   // another process may have won
  }
  keys = { publicKey: v.publicKey, privateKey: crypto.createPrivateKey({ key: v.privateKey, format: "jwk" }) };
  return keys;
}

function vapidHeader(endpoint, k) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT() }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: k.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.publicKey}`;
}

// ---- Message encryption (aes128gcm, RFC 8291) ----------------------------------------------------
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
export function encrypt(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh), authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("bad subscription keys");
  const ecdh = crypto.createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = 65;
  return Buffer.concat([header, asPublic, ct]);
}

// ---- Sending -----------------------------------------------------------------------------------
async function deliver(sub, data, k, urgency = "normal") {
  const body = encrypt(JSON.stringify(data), sub.p256dh, sub.auth);
  let r;
  try {
    r = await fetch(sub.endpoint, {
      method: "POST",
      headers: { TTL: String(data.important ? 7 * 86400 : 2 * 86400), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        Urgency: urgency, Authorization: vapidHeader(sub.endpoint, k) },
      body, signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    await pool.query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1", [sub.id]);
    return { ok: false, error: e.message };
  }
  if (r.status === 404 || r.status === 410) {           // the device unsubscribed or the app was removed
    await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
    return { ok: false, gone: true };
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    await pool.query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1", [sub.id]);
    console.warn(`[Push] ${new URL(sub.endpoint).host} ${r.status} ${text.slice(0, 200)}`);
    // A device that keeps failing (expired keys) is dropped after 20 tries in a row
    await pool.query("DELETE FROM push_subscriptions WHERE id = $1 AND failures >= 20", [sub.id]);
    return { ok: false, status: r.status };
  }
  await pool.query("UPDATE push_subscriptions SET last_used = now(), failures = 0 WHERE id = $1", [sub.id]);
  return { ok: true };
}

// Push to all of a person's devices. Returns how many got it.
export async function sendToUser(userId, data, { onlyEndpoint = null } = {}) {
  // Running a command board: emergency mode, nothing buzzes their devices (a test push they ask for still goes)
  if (!onlyEndpoint && !data?.test && inEmergency(userId)) return 0;
  try {
    const subs = (await pool.query("SELECT * FROM push_subscriptions WHERE user_id = $1", [userId])).rows
      .filter(s => (!onlyEndpoint || s.endpoint === onlyEndpoint) && (!s.important_only || data.important || data.test));
    if (!subs.length) return 0;
    const k = await vapidKeys();
    const results = await Promise.all(subs.map(s => deliver(s, data, k, data.important ? "high" : "normal")));
    return results.filter(r => r.ok).length;
  } catch (e) { console.warn(`[Push] ${e.message}`); return 0; }
}

// ---- Routes ------------------------------------------------------------------------------------
function deviceLabel(ua = "") {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
const devices = async user => (await pool.query(
  "SELECT endpoint, label, important_only, created_at, last_used FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at", [user.id])).rows
  .map(d => ({ endpoint: d.endpoint, label: d.label, importantOnly: d.important_only, added: d.created_at, lastUsed: d.last_used }));

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/,
  ...String(process.env.PUSH_EXTRA_HOSTS || "").split(",").map(x => x.trim()).filter(Boolean).map(h => new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))];
export async function handlePush(req, res, parts, user, send, jsonBody) {
  const a = parts[2];
  if (req.method === "GET" && a === "key") return send(res, 200, { key: (await vapidKeys()).publicKey });
  if (req.method === "GET" && a === "devices") return send(res, 200, { devices: await devices(user) });
  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);
  if (a === "subscribe") {
    const s = b.subscription || {};
    const endpoint = String(s.endpoint || "");
    let host;
    try { const u = new URL(endpoint); if (u.protocol !== "https:" && !process.env.PUSH_ALLOW_HTTP) throw 0; host = u.host; } catch { throw err(400, "That isn't a push address from a browser."); }
    // Only the browsers' own push services: the server posts to this address, so it must never be a computer on our network
    if (!process.env.PUSH_ALLOW_HTTP && !PUSH_HOSTS.some(rx => rx.test(host))) throw err(400, "That isn't a push address from a browser.");
    if (!s.keys?.p256dh || !s.keys?.auth || unb64u(s.keys.p256dh).length !== 65) throw err(400, "That subscription is missing its keys.");
    const label = String(b.label || deviceLabel(req.headers["user-agent"])).slice(0, 80);
    // The same device signing in as someone else takes it over
    await pool.query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, label, important_only) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         label = EXCLUDED.label, important_only = EXCLUDED.important_only, failures = 0`,
      [crypto.randomUUID(), user.id, endpoint, s.keys.p256dh, s.keys.auth, label, b.importantOnly === true]);
    console.log(`[Push] ${user.name} added ${label} (${host})`);
    return send(res, 200, { ok: true, devices: await devices(user) });
  }
  if (a === "unsubscribe") {
    await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [String(b.endpoint || ""), user.id]);
    return send(res, 200, { ok: true, devices: await devices(user) });
  }
  if (a === "device") {
    await pool.query("UPDATE push_subscriptions SET important_only = $1 WHERE endpoint = $2 AND user_id = $3", [b.importantOnly === true, String(b.endpoint || ""), user.id]);
    return send(res, 200, { ok: true, devices: await devices(user) });
  }
  if (a === "test") {
    const n = await sendToUser(user.id, { title: brand().app, body: "Test notification: push is working on this device.", url: "/", tag: "nexus-test", test: true },
      { onlyEndpoint: b.endpoint ? String(b.endpoint) : null });
    if (!n) throw err(502, "The test didn't go through. If this keeps happening, the server may not be allowed to reach the push service (ask IT), or turn notifications off and on again on this device.");
    return send(res, 200, { ok: true, sent: n });
  }
  throw err(404, "Not found");
}
