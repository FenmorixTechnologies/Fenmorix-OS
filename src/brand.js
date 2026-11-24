// Whose Nexus this is (server/brand.js puts it in the page as <meta name="nexus-brand">). St. George by default,
// so the dev server and older builds look exactly as before. Never import App.jsx from here (the sign-in page uses it).
function read() {
  try {
    const m = typeof document !== "undefined" && document.querySelector('meta[name="nexus-brand"]');
    return m ? JSON.parse(m.getAttribute("content") || "{}") : {};
  } catch { return {}; }
}
const b = read();
export const BRAND = {
  org: b.org || "St. George Fire Protection District",
  short: b.short || "SGFD",
  place: b.place || "St. George",
  app: b.app || "SGFD Nexus",
  host: b.host || "nexus.stgeorgefire.com",
  sandbox: !!b.sandbox,
  sandboxNote: b.sandboxNote || "",
  // Licensed modules (server/license.js); null = every module (dev server, older builds)
  modules: Array.isArray(b.modules) ? b.modules : null,
  // Product: "nexus" (St. George) or "fenmorix" (Fenmorix OS)
  product: b.product || "nexus",
  productName: b.productName || "Nexus",
  word: b.word || "NEXUS", wordAccent: b.wordAccent || "", tagline: b.tagline || "MANAGEMENT SYSTEM",
  vendor: b.vendor || "", copyright: b.copyright || "",
  wordmark: !!b.wordmark,
  orgLogo: !!b.orgLogo,
  // The customer's own menu names {tileKey: name} (Branding page; Fenmorix OS only)
  terms: b.terms && typeof b.terms === "object" ? b.terms : {},
  setupPending: !!b.setupPending,
};

// Colors for the frame (side bar, sign-in page, active item, rules). Nexus = St. George's exact colors; Fenmorix OS = the Fenmorix
// palette (Fenmorix Orange #FF7900, Burnt Orange #C94D00, Titanium Silver #C5CAD0, Arctic Blue #55CFFF, Midnight Navy #08131D,
// Carbon Black #050709), which a customer's own colors (THEME_* in .env) can replace.
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const mix = (hex, to, t) => { const p = h => [0, 8, 16].map(k => (parseInt(h.slice(1), 16) >> (16 - k)) & 255); const a = p(hex), c = p(to);
  return "#" + a.map((v, i) => Math.round(v + (c[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
const NEXUS_THEME = {
  sideBg: "radial-gradient(120% 220px at 0% 0%, rgba(200,16,46,0.28), transparent 70%), linear-gradient(180deg, #172A4B 0%, #13233F 45%, #0F1D35 100%)",
  rule: "linear-gradient(90deg, rgba(200,16,46,0) 0%, #E0233F 25%, #C8102E 75%, rgba(200,16,46,0) 100%)",
  pillBg: "linear-gradient(180deg, #D7153A 0%, #C8102E 55%, #A30C24 100%)", pillShadow: "0 3px 10px rgba(200,16,46,0.35), inset 0 1px 0 rgba(255,255,255,0.18)",
  border: "#C8102E", accent: "#C8102E", sectionLabel: "#F2A0AE", emblemGlow: "drop-shadow(0 0 6px rgba(255,90,20,0.35))",
  loginBase: "#0E1626",
  loginBg: "radial-gradient(42% 55% at 30% 46%, rgba(200,16,46,0.30), transparent 70%), radial-gradient(70% 80% at 30% 46%, rgba(255,90,31,0.10), transparent 75%), linear-gradient(160deg, #1A2C4E 0%, #101A2E 55%, #0B111D 100%)",
  loginDots: "rgba(255,140,60,0.12)", loginSub: "#E8D9C8", cardTop: "#C8102E",
  heroGlow: "0 0 46px 16px rgba(255,96,20,0.40), 0 0 110px 40px rgba(200,16,46,0.22)",
  heroRule: "linear-gradient(90deg, rgba(200,16,46,0) 0%, #FF5A1F 25%, #E0233F 60%, rgba(200,16,46,0) 100%)",
};
export function makeTheme(c = {}) {
  const accent = c.accent || "#FF7900", dark = c.accentDark || "#C94D00", glow = c.glow || "#55CFFF";
  const navy = c.navy || "#08131D", black = c.black || "#050709", silver = c.silver || "#C5CAD0";
  return {
    sideBg: `radial-gradient(120% 240px at 0% 0%, ${rgba(accent, 0.20)}, transparent 70%), radial-gradient(90% 200px at 100% 100%, ${rgba(glow, 0.08)}, transparent 70%), linear-gradient(180deg, ${navy} 0%, ${navy} 55%, ${black} 100%)`,
    rule: `linear-gradient(90deg, ${rgba(accent, 0)} 0%, ${accent} 25%, ${dark} 75%, ${rgba(accent, 0)} 100%)`,
    pillBg: `linear-gradient(90deg, ${rgba(accent, 0.34)} 0%, ${rgba(accent, 0.12)} 100%)`, pillShadow: `inset 3px 0 0 ${accent}`,
    border: accent, accent, sectionLabel: mix(accent, "#FFFFFF", 0.45), emblemGlow: `drop-shadow(0 0 8px ${rgba(accent, 0.35)})`,
    loginBase: black,
    loginBg: `radial-gradient(42% 55% at 30% 46%, ${rgba(accent, 0.22)}, transparent 70%), radial-gradient(70% 80% at 30% 46%, ${rgba(glow, 0.10)}, transparent 75%), linear-gradient(160deg, ${navy} 0%, ${navy} 50%, ${black} 100%)`,
    loginDots: rgba(glow, 0.14), loginSub: silver, cardTop: accent,
    heroGlow: "none", heroInset: "-28%",
    heroFill: `radial-gradient(circle closest-side, ${rgba(accent, 0.26)} 0%, ${rgba(accent, 0.12)} 35%, ${rgba(glow, 0.05)} 65%, transparent 100%)`,
    heroRule: `linear-gradient(90deg, ${rgba(accent, 0)} 0%, ${accent} 30%, ${glow} 70%, ${rgba(glow, 0)} 100%)`,
  };
}
export const THEME = BRAND.product === "nexus" && !Object.keys(b.colors || {}).length ? NEXUS_THEME : makeTheme(b.colors || {});
// The product name for page text ("Nexus" for St. George, "Fenmorix OS" for everyone else)
export const PN = BRAND.productName;
// Which modules are on: src/licensing.js (kept out of the sign-in page, which must not carry the module catalog)
