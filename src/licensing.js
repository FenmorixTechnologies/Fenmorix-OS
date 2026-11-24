// Is this module (src/modules.js key) part of this install? Signed-in app only: never import this from SignIn.jsx / brand.js,
// so the public sign-in page doesn't carry the module catalog.
import { BRAND } from "./brand.js";
import { moduleOfTile } from "./modules.js";
export const moduleOn = key => !BRAND.modules || !key || BRAND.modules.includes(key);
export const tileOn = tile => moduleOn(moduleOfTile(tile));

// Menu names: the customer's own (Branding page) or the built-in one. sectionName() maps the name a section passes to AppShell.
import { TILE_LABELS } from "./modules.js";
export const tileName = (key, fallback) => (BRAND.terms && BRAND.terms[key]) || fallback;
const BY_SECTION = new Map(TILE_LABELS.flatMap(t => [[t.label, t.key], [t.section || t.label, t.key]]));
export const sectionName = s => { const k = BY_SECTION.get(s); return (k && BRAND.terms && BRAND.terms[k]) || s; };
