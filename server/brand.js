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
