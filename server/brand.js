// Whose install this is: product (Nexus for St. George, Fenmorix OS for everyone else), organization name, app name, logo
// files, colors and sandbox mode. Everything defaults to St. George, so the district's server needs nothing set. Others set:
//   ORG_NAME="Acme County"  ORG_SHORT=ACME  ORG_PLACE="Acme"  APP_NAME="Fenmorix OS"  PRODUCT=fenmorix|nexus
//   BRAND_ASSETS_DIR=<folder with the customer's logo files>  (default for Fenmorix OS: public/brand-fenmorix)
//   THEME_ACCENT / THEME_ACCENT_DARK / THEME_GLOW / THEME_NAVY / THEME_BLACK / THEME_SILVER = #RRGGBB overrides
//   (Fenmorix OS: the Branding page's saved names, colors, menu names and logo files win over all of these)
//   SANDBOX=on  SANDBOX_NOTE="..."   (banner on every page; Investigations off; sign-up asks for their department)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureWork } from "../src/shifts.js";
import { menuLayout } from "../src/modules.js";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const on = v => /^(1|on|true|yes)$/i.test(String(v || "").trim());
const clean = (v, n) => String(v || "").replace(/[\r\n<>]/g, " ").trim().slice(0, n);

export const isSandbox = () => on(process.env.SANDBOX);
// Which product this server presents. "nexus" = St. George's own install (its name, logo, colors: nothing set in .env);
// "fenmorix" = Fenmorix OS (Fenmorix Technologies, LLC): every other install, sandboxes included. PRODUCT=nexus|fenmorix overrides.
import { SGFD_CONTENT } from "./buildFlags.js";
export function product() {
  if (!SGFD_CONTENT) return "fenmorix";         // a customer package: always Fenmorix OS
  const p = String(process.env.PRODUCT || "").trim().toLowerCase();
  if (p === "nexus" || p === "fenmorix") return p;
  return !isSandbox() && !process.env.ORG_NAME && !process.env.ORG_SHORT ? "nexus" : "fenmorix";
}
export const PRODUCTS = {
  nexus: { name: "Nexus", word: "NEXUS", wordAccent: "", tagline: "MANAGEMENT SYSTEM", vendor: "", copyright: "" },
  fenmorix: { name: "Fenmorix OS", word: "FENMORIX", wordAccent: "OS", tagline: "UNIFIED OPERATIONS PLATFORM", vendor: "Fenmorix Technologies, LLC",
    copyright: `© ${new Date().getFullYear()} Fenmorix Technologies, LLC. All rights reserved.` },
};
// Saved branding (User Management › System › Branding): <SYSTEM_DIR>/branding/branding.json + branding/assets/, outside the app folder so
// updates never touch it. Fenmorix OS installs only: St. George's Nexus ignores it (its look is fixed).
export const COLOR_KEYS = ["accent", "accentDark", "glow", "navy", "black", "silver"];
export const HEX = /^#[0-9a-f]{6}$/i;
export const brandingDir = () => path.join(path.resolve(process.env.SYSTEM_DIR || path.join(APP_DIR, "..")), "branding");
let savedCache = { mtime: -1, data: {} };
export function savedBranding() {
  if (product() !== "fenmorix") return {};
  const f = path.join(brandingDir(), "branding.json");
  let st; try { st = fs.statSync(f); } catch { return {}; }
  if (st.mtimeMs !== savedCache.mtime) {
    let data = {}; try { data = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")) || {}; } catch { data = {}; }
    savedCache = { mtime: st.mtimeMs, data };
  }
  return savedCache.data;
}
// Colors: the Branding page, else THEME_ACCENT=#FF7900 ... in .env
function themeOverrides() {
  const out = {};
  for (const k of ["ACCENT", "ACCENT_DARK", "GLOW", "NAVY", "BLACK", "SILVER"]) { const v = String(process.env[`THEME_${k}`] || "").trim(); if (HEX.test(v)) out[k.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase())] = v; }
  const saved = savedBranding().colors || {};
  for (const k of COLOR_KEYS) if (HEX.test(String(saved[k] || ""))) out[k] = saved[k];
  return out;
}
function savedTerms() {
  const t = savedBranding().terms || {}, out = {};
  for (const [k, v] of Object.entries(t)) if (/^[a-z]{2,20}$/.test(k) && typeof v === "string" && v.trim()) out[k] = clean(v, 40);
  return out;
}
// ---- Organization settings (User Management › Organization; every product, St. George included) -----------------------------
// <SYSTEM_DIR>/settings/org.json {industry: fire|business, words: {station, homeStation, callSign}, work: {...}}: kept outside the app
// folder so updates never touch it. Fire/EMS installs (St. George, the demo sandbox) default to the fire-service wording and rotations;
// every other install defaults to a business (locations, no call signs, Mon–Fri days).
export const settingsDir = () => path.join(path.resolve(process.env.SYSTEM_DIR || path.join(APP_DIR, "..")), "settings");
let orgCache = { mtime: -1, data: {} };
function savedOrg() {
  const f = path.join(settingsDir(), "org.json");
  let st; try { st = fs.statSync(f); } catch { orgCache = { mtime: -1, data: {} }; return {}; }
  if (st.mtimeMs !== orgCache.mtime) {
    let data = {}; try { data = JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")) || {}; } catch { data = {}; }
    orgCache = { mtime: st.mtimeMs, data };
  }
  return orgCache.data;
}
const DAY = /^\d{4}-\d{2}-\d{2}$/, HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const PAY_KINDS = ["weekly", "biweekly", "semimonthly", "monthly"];
export function orgSettings() {
  const sv = savedOrg();
  const defIndustry = product() === "nexus" || isSandbox() ? "fire" : "business";
  const industry = INDUSTRIES.includes(sv.industry) ? sv.industry : defIndustry;
  const fire = industry === "fire";
  const W = sv.words || {};
  const word = (k, d) => (typeof W[k] === "string" ? clean(W[k], 40) : d);
  const place = { education: "Campus / building", government: "Office / location" }[industry] || "Location";
  const words = {
    station: word("station", fire ? "Station / assignment" : place),
    homeStation: word("homeStation", fire ? "Home station" : place),
    callSign: word("callSign", fire ? "Radio call sign" : ""),          // "" = not used (hidden)
  };
  const w = sv.work || {}, pay = w.pay || {};
  const work = {
    rotations: { fire: typeof w.rotations?.fire === "boolean" ? w.rotations.fire : fire, comms: typeof w.rotations?.comms === "boolean" ? w.rotations.comms : fire },
    pay: {
      kind: PAY_KINDS.includes(pay.kind) ? pay.kind : "biweekly",
      start: DAY.test(String(pay.start || "")) ? pay.start : (fire ? "2026-10-22" : "2026-11-02"),
      payDays: Number.isFinite(Number(pay.payDays)) ? Math.min(31, Math.max(0, Math.round(Number(pay.payDays)))) : 7,
    },
    periodHours: Number(w.periodHours) > 0 ? Math.min(400, Number(w.periodHours)) : (fire ? 80 : null),   // null = workdays × dayHours
    dayHours: Number(w.dayHours) > 0 ? Math.min(24, Number(w.dayHours)) : 8,
    dayStart: HHMM.test(String(w.dayStart || "")) ? w.dayStart : "08:00",
  };
  configureWork(work);   // server-side copy of the shared schedule code follows the saved settings
  // Job roles (User Management › Organization): names people are given (their job title), each optionally carrying a permission
  // profile. Businesses start with three; fire departments use free-text job titles and start with none.
  const roles = Array.isArray(sv.roles) ? cleanRoles(sv.roles) : (fire ? [] : (DEFAULT_ROLES[industry] || DEFAULT_BUSINESS_ROLES).map(r => ({ ...r })));
  // Main menu groups: null = the built-in grouping (src/modules.js MENU_GROUPS); else [{name, keys}] in the saved order
  const menu = sv.menu && (Array.isArray(sv.menu.groups) || sv.menu.startClosed) ? { groups: Array.isArray(sv.menu.groups) ? sv.menu.groups : null, startClosed: !!sv.menu.startClosed } : null;
  return { industry, fire, words, work, roles, menu };
}
export const DEFAULT_BUSINESS_ROLES = [{ name: "Owner", profile: "firechief" }, { name: "Manager", profile: "division" }, { name: "Employee", profile: "" }];
// fire = fire/EMS department; business; government (cities, parishes, utilities); education (schools, districts). Only "fire" turns on
// the fire-service wording and rotations; the others differ in their starting wording and job roles.
export const INDUSTRIES = ["fire", "business", "government", "education"];
const DEFAULT_ROLES = {
  business: DEFAULT_BUSINESS_ROLES,
  government: [{ name: "Director", profile: "firechief" }, { name: "Supervisor", profile: "division" }, { name: "Employee", profile: "" }],
  education: [{ name: "Principal", profile: "firechief" }, { name: "Assistant principal", profile: "division" }, { name: "Department head", profile: "division" },
    { name: "Teacher", profile: "" }, { name: "Staff", profile: "" }, { name: "Student", profile: "" }],
};
const PROFILE_KEY = /^[a-z0-9_-]{1,40}$/;
export function cleanRoles(list) {
  const out = [], seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    const name = clean(r?.name, 60), key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, profile: PROFILE_KEY.test(String(r?.profile || "")) ? r.profile : "" });
    if (out.length >= 60) break;
  }
  return out;
}
export function saveOrgSettings(next) {
  const cur = savedOrg(), out = { ...cur };
  if (next.industry !== undefined) out.industry = INDUSTRIES.includes(next.industry) ? next.industry : undefined;
  if (next.words && typeof next.words === "object") {
    out.words = { ...(cur.words || {}) };
    for (const k of ["station", "homeStation", "callSign"]) if (typeof next.words[k] === "string") out.words[k] = clean(next.words[k], 40);
  }
  if (next.work && typeof next.work === "object") {
    const w = next.work, o = { ...(cur.work || {}) };
    if (w.rotations) o.rotations = { fire: !!w.rotations.fire, comms: !!w.rotations.comms };
    if (w.pay) {
      if (!PAY_KINDS.includes(w.pay.kind)) throw Object.assign(new Error("Pick how often people are paid."), { status: 400 });
      if ((w.pay.kind === "weekly" || w.pay.kind === "biweekly") && !DAY.test(String(w.pay.start || ""))) throw Object.assign(new Error("Give the first day of any one pay period."), { status: 400 });
      o.pay = { kind: w.pay.kind, start: DAY.test(String(w.pay.start || "")) ? w.pay.start : undefined, payDays: Math.min(31, Math.max(0, Math.round(Number(w.pay.payDays) || 0))) };
    }
    if (w.periodHours !== undefined) o.periodHours = Number(w.periodHours) > 0 ? Math.min(400, Number(w.periodHours)) : null;
    if (w.dayHours !== undefined) { const h = Number(w.dayHours); if (!(h > 0 && h <= 24)) throw Object.assign(new Error("Hours in a workday should be between 1 and 24."), { status: 400 }); o.dayHours = h; }
    if (w.dayStart !== undefined) { if (!HHMM.test(String(w.dayStart))) throw Object.assign(new Error("The workday start should look like 08:00."), { status: 400 }); o.dayStart = w.dayStart; }
    out.work = o;
  }
  if (Array.isArray(next.roles)) out.roles = cleanRoles(next.roles);
  if (next.menu !== undefined) out.menu = next.menu && typeof next.menu === "object"
    ? { groups: Array.isArray(next.menu.groups) ? menuLayout(next.menu).map(g => ({ name: g.name, keys: g.keys })) : null, startClosed: !!next.menu.startClosed } : undefined;
  fs.mkdirSync(settingsDir(), { recursive: true });
  fs.writeFileSync(path.join(settingsDir(), "org.json"), JSON.stringify(out, null, 1) + "\n");
  orgCache = { mtime: -1, data: {} };
  return orgSettings();
}

export function brand() {
  const e = process.env;
  const prod = product(), P = PRODUCTS[prod], sv = savedBranding();
  // Defaults: a sandbox's demo department; St. George's own install (this source tree); a customer package's placeholder
  const D = isSandbox() ? { org: "Demo Fire District", short: "DEMO", place: "Demo" }
    : SGFD_CONTENT ? { org: "St. George Fire Protection District", short: "SGFD", place: "St. George" } : { org: "Your organization", short: "ORG", place: "" };
  const org = clean(sv.org, 120) || clean(e.ORG_NAME, 120) || D.org;
  const short = clean(sv.short, 20) || clean(e.ORG_SHORT, 20) || D.short;
  const place = clean(sv.place, 60) || clean(e.ORG_PLACE, 60) || D.place;
  const app = clean(sv.app, 60) || clean(e.APP_NAME, 60) || (prod === "nexus" ? `${short} Nexus` : P.name);
  const url = String(e.PUBLIC_URL || (isSandbox() || !SGFD_CONTENT ? "" : "https://nexus.stgeorgefire.com")).replace(/\/+$/, "");
  return {
    org, short, place, app, url, host: url.replace(/^https?:\/\//, ""),
    sandbox: isSandbox(),
    product: prod, productName: P.name, word: P.word, wordAccent: P.wordAccent, tagline: P.tagline, vendor: P.vendor, copyright: P.copyright,
    theme: prod, colors: themeOverrides(), terms: savedTerms(), wordmark: !!brandFile("brand-wordmark.png"), orgLogo: !!brandFile("org-logo.png"),
    // A new customer's install (kit from the License Manager): the first master admin gets the setup wizard
    setupPending: prod === "fenmorix" && !isSandbox() && sv.setup === "pending",
    ...(() => { const o = orgSettings(); return { industry: o.industry, fire: o.fire, words: o.words, work: o.work, menu: o.menu }; })(),
    sandboxNote: isSandbox() ? clean(e.SANDBOX_NOTE, 300) || "Sandbox: every person, call and record here is made up. Don't enter real names, patient, case or personnel information." : "",
  };
}

// Logo / icon files a brand can replace (same names as in public/)
export const BRAND_FILES = new Set(["org-logo.png", "brand-wordmark.png", "logo-large.png", "nexus-emblem.png", "nexus-hero-art.png", "nexus-hero-bolts.png", "nexus-hero-ring.png",
  "nexus-watermark.jpg", "favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]);
export function brandAssetsDir() {
  const d = process.env.BRAND_ASSETS_DIR || (product() === "fenmorix" ? path.join(APP_DIR, "public", "brand-fenmorix") : "");
  return d && fs.existsSync(d) ? d : "";
}
// A brand file this server would serve (Branding page uploads, then the customer folder, then the Fenmorix set), or ""
export const uploadedAssetsDir = () => path.join(brandingDir(), "assets");
// The logo that came in the customer kit (install-ubuntu.sh --kit), for the setup wizard to make the icon set from
export function setupLogoFile() {
  const d = path.join(brandingDir(), "setup");
  for (const n of ["logo.png", "logo.jpg", "logo.svg", "logo.webp"]) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return "";
}
function brandFile(name) {
  if (product() === "fenmorix") { const u = path.join(uploadedAssetsDir(), name); if (fs.existsSync(u)) return u; }
  const d = brandAssetsDir();
  if (d && fs.existsSync(path.join(d, name))) return path.join(d, name);
  // The organization's own logo, kept in its real shape (side bar). Until one is uploaded, the logo that came in the customer kit.
  // (only while a customer logo is in use: "Go back to the Fenmorix OS logo" removes the uploaded files and this goes with them)
  if (name === "org-logo.png") {
    const k = product() === "fenmorix" && fs.existsSync(path.join(uploadedAssetsDir(), "nexus-emblem.png")) ? setupLogoFile() : "";
    return /\.(png|jpg|webp)$/.test(k) ? k : "";
  }
  const f = path.join(APP_DIR, "public", "brand-fenmorix", name);
  return product() === "fenmorix" && fs.existsSync(f) ? f : "";
}
export const brandFilePath = brandFile;

// Text from St. George's own documents (seeded forms, evaluation programs, AI prompts) with this department's names
export function brandText(s) {
  if (typeof s !== "string") return s;
  const b = brand();
  if (b.short === "SGFD" && !b.sandbox) return s;
  return s.replace(/St\.? George Fire Protection District/g, b.org).replace(/St\.? George Fire/g, `${b.place} Fire`)
    .replace(/14100 Airline Hwy\.?/g, "the training center").replace(/\bSGFD\b/g, b.short).replace(/St\.? George/g, b.place);
}
export const brandDeep = v => Array.isArray(v) ? v.map(brandDeep) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, brandDeep(x)])) : brandText(v);

// The page header the client reads (src/brand.js): <meta name="nexus-brand" content="{json}">
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function brandHtml(html, extra = {}) {
  const b = { ...brand(), ...extra };
  const meta = `<meta name="nexus-brand" content="${esc(JSON.stringify(b))}" />`;
  return html.replace(/<title>[^<]*<\/title>/, `<title>${esc(b.app)}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, `$1${esc(b.app)}"`)
    .replace("</head>", `    ${meta}\n  </head>`);
}
export function brandManifest(text) {
  try { const m = JSON.parse(text); const b = brand(); m.name = b.app; m.short_name = b.app.length > 12 ? (b.product === "nexus" ? "Nexus" : "Fenmorix") : b.app; if (b.product !== "nexus") { m.theme_color = b.colors.navy || "#08131D"; m.background_color = b.colors.black || "#050709"; } m.description = `${b.org} management system`; return JSON.stringify(m); }
  catch { return text; }
}
