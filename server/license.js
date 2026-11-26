// Licensing: which modules this install may use. A license file is signed with the vendor's private key (kept off every
// customer server, used only by tools/license-manager) and checked here with the public keys built into the code.
// Editing even one character of the file breaks the signature.
//
// File (LICENSE_FILE, default <SYSTEM_DIR>/license/nexus.lic):
//   -----BEGIN NEXUS LICENSE-----
//   <base64url JSON payload>.<base64url Ed25519 signature of the payload text>
//   -----END NEXUS LICENSE-----
// Payload: { v: 1, kid, id, customer, product, modules: [keys], environments: [production|test|training], hosts: [names, *.wildcards],
//            seats: n|0, issued: "YYYY-MM-DD", expires: "YYYY-MM-DD"|null, graceDays: n, notes }
//
// Rules:
//  - No license file: a "required" build (server/buildFlags.js REQUIRE_LICENSE, set by the packaging tool for customer builds) runs
//    the core only; a plain build (St. George's own server, development) runs every module.
//  - A license that doesn't check out (bad signature, wrong host, unknown key, unreadable) = core only, with the reason shown to masters.
//  - Expired: modules keep working through graceDays (default 30) with a warning, then core only.
//  - The "dev" key's licenses only work when PUBLIC_URL is empty or localhost (tests and development).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_KEYS, STANDARD_KEYS, moduleByKey, moduleOfApi, moduleOfCollection, moduleOfTile, withNeeds, CORE } from "../src/modules.js";
import { REQUIRE_LICENSE, ALLOW_DEV_LICENSE } from "./buildFlags.js";

// Public keys allowed to sign licenses (SPKI DER, base64). Add the vendor's production key here; never a private key.
const KEYS = {
  dev: "MCowBQYDK2VwAyEA6GPmavsVknpZisTrLE8wfaYTGp+bTbTF85rDGfruaQU=",
  // Fenmorix Technologies, LLC production signing key (made 11/2026; the private half stays on Michael's computer)
  "key-2026-11": "MCowBQYDK2VwAyEAJzTcCqFQdHe04zOvY3mzJXdldLur3QDgzFpkqRJf9z0=",
};
const DEV_KEYS = new Set(["dev"]);

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const licenseFile = () => process.env.LICENSE_FILE || path.join(path.resolve(process.env.SYSTEM_DIR || path.join(APP_DIR, "..")), "license", "nexus.lic");
// Sandbox demo modules: on a sandbox with no license file, a master admin picks which modules show (System › Demo modules).
// Every module's code ships in the sandbox package; this only switches them on or off. Opt-in (retail) modules included.
const isSandbox = () => /^(1|on|true|yes)$/i.test(String(process.env.SANDBOX || "").trim());
export const demoModulesFile = () => path.join(path.dirname(path.dirname(licenseFile())), "sandbox", "modules.json");
export function demoModules() {
  if (!isSandbox()) return null;
  try { const j = JSON.parse(fs.readFileSync(demoModulesFile(), "utf8")); return Array.isArray(j.modules) ? j.modules.filter(k => moduleByKey[k] && !moduleByKey[k].vendor) : null; }
  catch { return null; }
}
export function setDemoModules(keys) {
  const list = withNeeds([...new Set((Array.isArray(keys) ? keys : []).filter(k => moduleByKey[k] && !moduleByKey[k].vendor))]);
  const f = demoModulesFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ modules: list, at: new Date().toISOString() }, null, 1) + "\n");
  clearLicenseCache();
  return list;
}
const b64u = s => Buffer.from(s, "base64url");
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hostOf = () => String(process.env.PUBLIC_URL || "").replace(/^https?:\/\//, "").replace(/[/:].*$/, "").toLowerCase();
const hostMatches = (want, host) => want === host || (want.startsWith("*.") && host.endsWith(want.slice(1)));

// Read and check a license text. Returns { ok, payload?, error? } (never throws).
export function checkLicense(text) {
  try {
    const m = /-----BEGIN NEXUS LICENSE-----\s*([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\s*-----END NEXUS LICENSE-----/.exec(String(text || ""));
    if (!m) return { ok: false, error: "This isn't a license file." };
    const body = b64u(m[1]).toString("utf8");
    const payload = JSON.parse(body);
    const pub = KEYS[payload.kid];
    if (!pub) return { ok: false, error: "This license was signed with a key this version doesn't know." };
    const key = crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" });
    if (!crypto.verify(null, Buffer.from(body, "utf8"), key, b64u(m[2]))) return { ok: false, error: "The license signature doesn't match (the file was changed)." };
    if (payload.v !== 1 || !Array.isArray(payload.modules)) return { ok: false, error: "The license file is in a format this version can't read." };
    const host = hostOf();
    // Development licenses: never in a customer package (an admin could blank PUBLIC_URL), and only on localhost elsewhere
    if (DEV_KEYS.has(payload.kid) && ((REQUIRE_LICENSE && !ALLOW_DEV_LICENSE) || (host && !/^(localhost|127\.0\.0\.1)$/.test(host)))) return { ok: false, error: "A development license can't be used on a real server." };
    const hosts = (payload.hosts || []).map(h => String(h).toLowerCase());
    if (hosts.length && host && !hosts.some(h => hostMatches(h, host))) return { ok: false, error: `This license is for ${hosts.join(", ")}, not ${host}.` };
    return { ok: true, payload };
  } catch (e) { return { ok: false, error: `The license file couldn't be read (${e.message}).` }; }
}

let cache = { at: 0 };
export function clearLicenseCache() { cache = { at: 0 }; }
// The current state: { mode: "full" | "licensed" | "core", modules: Set, license?, error?, warning?, expired?, graceUntil? }
export function licenseState() {
  if (Date.now() - cache.at < 30_000 && cache.state) return cache.state;
  let state;
  let text = null;
  try { text = fs.readFileSync(licenseFile(), "utf8"); } catch { /* no file */ }
  const demo = text == null ? demoModules() : null;
  if (demo) state = { mode: "full", modules: new Set(withNeeds(demo)), demo: true };
  else if (text == null) {
    state = REQUIRE_LICENSE ? { mode: "core", modules: new Set(), error: "No license is installed. Only the core sections work until one is added." }
      : { mode: "full", modules: new Set(STANDARD_KEYS) };
  } else {
    const r = checkLicense(text);
    if (!r.ok) state = { mode: "core", modules: new Set(), error: r.error };
    else {
      const p = r.payload, now = today();
      const mods = new Set(withNeeds(p.modules.includes("*") ? [...STANDARD_KEYS, ...p.modules.filter(k => k !== "*")] : p.modules));
      state = { mode: "licensed", modules: mods, license: p };
      if (p.expires && now > p.expires) {
        const graceUntil = addDays(p.expires, Number.isFinite(p.graceDays) ? p.graceDays : 30);
        state.expired = true; state.graceUntil = graceUntil;
        if (now > graceUntil) { state.mode = "core"; state.modules = new Set(); state.error = `The license ended on ${p.expires}. Only the core sections work until it's renewed.`; }
        else state.warning = `The license ended on ${p.expires}. Everything keeps working until ${graceUntil}; renew it before then.`;
      } else if (p.expires && addDays(now, 30) >= p.expires) state.warning = `The license ends on ${p.expires}.`;
    }
  }
  cache = { at: Date.now(), state };
  return state;
}

export const moduleOn = key => !key || licenseState().modules.has(key);
export const apiAllowed = part => moduleOn(moduleOfApi(part));
export const collectionAllowed = key => moduleOn(moduleOfCollection(key));
export const tileAllowed = tile => moduleOn(moduleOfTile(tile));
export const onModules = () => [...licenseState().modules];

// Seat limit: active, approved accounts (0 = no limit)
export function seatLimit() { const p = licenseState().license; return p && Number(p.seats) > 0 ? Number(p.seats) : 0; }

// What the System page shows (masters)
export function licenseSummary() {
  const s = licenseState(), p = s.license;
  return {
    mode: s.mode, demo: isSandbox() && !p, demoSaved: !!s.demo, error: s.error || "", warning: s.warning || "", requireLicense: REQUIRE_LICENSE, file: licenseFile(),
    license: p ? { id: p.id, customer: p.customer, product: p.product || "", issued: p.issued, expires: p.expires || null, seats: p.seats || 0,
      environments: p.environments || [], hosts: p.hosts || [], kid: p.kid, notes: p.notes || "" } : null,
    modules: MODULE_KEYS.filter(k => !moduleByKey[k].vendor || s.modules.has(k)).map(k => ({ key: k, name: moduleByKey[k].name, group: moduleByKey[k].group, on: s.modules.has(k), optIn: !!moduleByKey[k].optIn, desc: moduleByKey[k].desc || "", needs: moduleByKey[k].needs || [] })),
    core: CORE.tiles,
  };
}

// Put a new license in place (already checked by the caller with checkLicense)
export function installLicense(text) {
  const f = licenseFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.previous`);
  fs.writeFileSync(f, String(text).trim() + "\n");
  clearLicenseCache();
}
