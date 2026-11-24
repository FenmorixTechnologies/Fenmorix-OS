#!/usr/bin/env node
// Makes one customer's download from this source tree:  node packaging/build-package.mjs <customer id | all> [--out <folder>]
// Customers are listed in packaging/customers.json. For each one:
//   - modules the customer didn't buy: their files (packaging/owners.json) are replaced by stand-ins that export the same names and
//     do nothing, so the code isn't in their download and nothing that imports it breaks
//   - sgfdContent false: St. George's forms, evaluation programs, PIAL grading (migration 020 emptied), seal, knight/dragon art, CAD views,
//     form PDF templates and the developer notes are left out
//   - server/buildFlags.js: REQUIRE_LICENSE, SGFD_CONTENT, PACKAGE; VERSION.json gets the package id so a server only accepts its own
// This folder (packaging/) is never part of a download.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODULES, STANDARD_KEYS, withNeeds } from "../src/modules.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const OUT = path.resolve(opt("out") || path.join(SRC, "..", "dist"));
const STAGE = path.resolve(opt("stage") || path.join(SRC, "..", args.includes("--test") ? ".package-stage-test" : ".package-stage"));
const die = m => { console.error(m); process.exit(1); };
// --test: a build for the test suite only (accepts development licenses); its file name says TEST and it's never sent to a customer
const TEST = args.includes("--test");
const customers = JSON.parse(fs.readFileSync(path.join(SRC, "packaging/customers.json"), "utf8"));
const owners = JSON.parse(fs.readFileSync(path.join(SRC, "packaging/owners.json"), "utf8"));
delete customers._note; delete owners._note;
const which = args[0] || die("Which customer? " + Object.keys(customers).join(", ") + ", or all");
const ids = which === "all" ? Object.keys(customers) : [which];
for (const id of ids) if (!customers[id]) die(`No customer "${id}" in packaging/customers.json`);

const SHIP = [".env.example", ".gitignore", "VERSION.json", "db", "index.html", "package.json", "package-lock.json", "public", "scripts",
  "server", "signin.html", "src", "vite.config.js"];
const NOTES = ["CLAUDE.md", "docs"];

// ---- A stand-in that exports the same names as the real file and does nothing ------------------------------------------------------
export function exportNames(code) {
  const names = new Set(); let def = false;
  if (/^\s*export\s+default\b/m.test(code)) def = true;
  for (const m of code.matchAll(/^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*export\s*\{([^}]*)\}/gm))
    for (const part of m[1].split(",")) { const n = part.trim().split(/\s+as\s+/).pop()?.trim(); if (n && n !== "default") names.add(n); else if (n === "default") def = true; }
  return { def, names: [...names] };
}
function standIn(file, code, why) {
  const { def, names } = exportNames(code);
  const server = file.startsWith("server/");
  const head = `// ${why}\n// (This download doesn't include it. Fenmorix Technologies, LLC.)\n`;
  const lines = [];
  for (const n of names) {
    if (/^handle[A-Z]/.test(n)) lines.push(`export async function ${n}() { throw Object.assign(new Error("That isn't part of this installation."), { status: 404 }); }`);
    else if (/^[A-Z][A-Z0-9_]+$/.test(n)) lines.push(`export const ${n} = [];`);
    else if (/^[A-Z]/.test(n)) lines.push(server ? `export const ${n} = [];` : `export const ${n} = () => null;`);
    // Client helpers are mostly API calls (.then / await): a rejected promise lands in the caller's error path instead of crashing the page
    else lines.push(server ? `export async function ${n}() { return null; }` : `export function ${n}() { return Promise.reject(Object.assign(new Error("That isn't part of this installation."), { status: 404 })); }`);
  }
  if (def) lines.push(server ? "export default async function () { return null; }" : "export default function NotIncluded() { return null; }");
  return head + lines.join("\n") + "\n";
}

function copyTree(from, to) {
  const st = fs.statSync(from);
  if (st.isDirectory()) { fs.mkdirSync(to, { recursive: true }); for (const n of fs.readdirSync(from)) { if (n === "node_modules" || n === ".git") continue; copyTree(path.join(from, n), path.join(to, n)); } }
  else fs.copyFileSync(from, to);
}
const rm = p => fs.rmSync(p, { recursive: true, force: true });

function build(id) {
  const c = customers[id];
  const on = new Set(c.modules === "standard" ? STANDARD_KEYS : c.modules === "all" ? MODULES.map(m => m.key) : withNeeds(c.modules));
  const off = MODULES.map(m => m.key).filter(k => !on.has(k));
  const version = JSON.parse(fs.readFileSync(path.join(SRC, "VERSION.json"), "utf8"));
  const root = path.join(STAGE, id), app = path.join(root, "app");
  rm(root); fs.mkdirSync(app, { recursive: true });
  for (const f of [...SHIP, ...(c.keepNotes ? NOTES : [])]) if (fs.existsSync(path.join(SRC, f))) copyTree(path.join(SRC, f), path.join(app, f));
  rm(path.join(app, ".env")); rm(path.join(app, "secrets"));
  // The install guide: St. George's Windows server guide in its download; a short Fenmorix OS one elsewhere
  if (c.sgfdContent) fs.copyFileSync(path.join(SRC, "docs/INSTALL-WINDOWS.md"), path.join(app, "README.md"));
  else fs.writeFileSync(path.join(app, "README.md"), `# Fenmorix OS\n\nFenmorix OS for ${c.customer}, by Fenmorix Technologies, LLC. Proprietary software, licensed, not sold.\n\n` +
    "Linux (Ubuntu 22.04 / 24.04): `sudo bash scripts/linux/install-ubuntu.sh --kit <customer kit folder> --email <certificate email>` (see INSTALL.txt in the kit).\n" +
    "Windows: `scripts/install-prereqs.ps1`, then `scripts/install-service.ps1`.\n\nUpdates: User Management > System > upload this organization's download and install it.\n");
  // The License Manager keeps its own copy of the module list
  fs.copyFileSync(path.join(SRC, "src/modules.js"), path.join(SRC, "tools/license-manager/modules.js"));
  const report = { stubbed: [], removed: [] };
  const write = (rel, text) => fs.writeFileSync(path.join(app, rel), text);
  const read = rel => fs.readFileSync(path.join(app, rel), "utf8");

  // Modules this customer didn't buy
  for (const [rel, mods] of Object.entries(owners)) {
    if (!fs.existsSync(path.join(app, rel)) || !mods.every(m => off.includes(m))) continue;
    if (rel.startsWith("scripts/")) { rm(path.join(app, rel)); report.removed.push(rel); continue; }
    write(rel, standIn(rel, read(rel), `Part of a module this installation doesn't have (${mods.join(", ")}).`));
    report.stubbed.push(rel);
  }
  if (off.includes("forms")) { rm(path.join(app, "server/pdf-templates")); report.removed.push("server/pdf-templates"); }

  // St. George's own content
  if (!c.sgfdContent) {
    for (const rel of ["server/formSeeds.js", "server/formSeeds2.js", "server/evalSeeds.js", "server/evalSeeds2.js", "server/evalSeedsAC.js"])
      if (!report.stubbed.includes(rel)) { write(rel, standIn(rel, read(rel), "St. George Fire Protection District's own documents: not part of this download.")); report.stubbed.push(rel); }
    for (const n of fs.readdirSync(path.join(app, "db/migrations")).filter(n => /^020_/.test(n)))
      write(`db/migrations/${n}`, "-- St. George's grading benchmark: not part of this download.\nSELECT 1;\n");
    const swap = (rel, pairs) => { let t = read(rel); for (const [x, y] of pairs) { if (!t.includes(x)) die(`${rel}: "${x}" not found (packaging needs an update)`); t = t.split(x).join(y); } write(rel, t); };
    swap("src/brand.js", [['b.org || "St. George Fire Protection District"', 'b.org || "Your organization"'], ['b.short || "SGFD"', 'b.short || "ORG"'],
      ['b.place || "St. George"', 'b.place || ""'], ['b.app || "SGFD Nexus"', 'b.app || "Fenmorix OS"'], ['b.host || "nexus.stgeorgefire.com"', 'b.host || ""']]);
    swap("server/brand.js", [['{ org: "St. George Fire Protection District", short: "SGFD", place: "St. George" }', '{ org: "Your organization", short: "ORG", place: "" }'],
      ['"https://nexus.stgeorgefire.com"', '""']]);
    const pkg = JSON.parse(read("package.json")); pkg.name = "fenmorix-os"; pkg.description = "Fenmorix OS (Fenmorix Technologies, LLC)"; write("package.json", JSON.stringify(pkg, null, 2) + "\n");
    for (const n of fs.readdirSync(path.join(app, "db/migrations")).filter(n => /^007_/.test(n)))
      write(`db/migrations/${n}`, read(`db/migrations/${n}`).split("'St. George Fire Protection District'").join("'Our organization'"));
    // St. George's divisions -> a plain starting pair (each organization edits them in User Management › Organization)
    const SGFD_DIVS = `('Administration'), ('Communications'), ('Community Relations'), ('Fire Prevention'),
  ('Medical'), ('Safety'), ('Special Events (FEMA)'), ('Special Events (Non-FEMA)'),
  ('Special Operations'), ('Special Services'), ('Suppression'), ('Technology'),
  ('Training'), ('Wellness');`;
    for (const rel of ["db/schema.sql", ...fs.readdirSync(path.join(app, "db/migrations")).filter(n => /^001_/.test(n)).map(n => `db/migrations/${n}`)])
      swap(rel, [[SGFD_DIVS, "('Administration'), ('Operations');"]]);
    const appJsx = read("src/App.jsx").replace(/const SGFD_LOGO = "data:image\/png;base64,[A-Za-z0-9+/=]+";/, 'const SGFD_LOGO = "";');
    write("src/App.jsx", appJsx);
    // St. George's seal and knight/dragon art -> the Fenmorix set
    const fx = path.join(app, "public/brand-fenmorix");
    for (const n of ["logo-large.png", "nexus-emblem.png", "nexus-hero-art.png", "nexus-hero-bolts.png", "nexus-hero-ring.png", "nexus-watermark.jpg",
      "favicon.ico", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"])
      if (fs.existsSync(path.join(fx, n))) fs.copyFileSync(path.join(fx, n), path.join(app, "public", n));
    for (const rel of ["server/pdf-templates", "scripts/dev", "scripts/cad-active-view-sgfd.sql", "scripts/cad-stats-view-sgfd.sql", "scripts/cad-units-view-sgfd.sql", ...NOTES])
      if (fs.existsSync(path.join(app, rel))) { rm(path.join(app, rel)); report.removed.push(rel); }
  }
  if (!c.sandboxScripts) { rm(path.join(app, "scripts/sandbox")); rm(path.join(app, "scripts/linux/reset-sandbox.sh")); report.removed.push("scripts/sandbox"); }

  write("server/buildFlags.js", `// Set by the packaging tool for ${c.customer}'s download.\nexport const REQUIRE_LICENSE = ${!!c.requireLicense};\nexport const SGFD_CONTENT = ${!!c.sgfdContent};\nexport const PACKAGE = ${JSON.stringify(id)};\nexport const ALLOW_DEV_LICENSE = ${TEST};\n`);
  // Release notes that talk about St. George only go in St. George's download
  if (!c.sgfdContent) version.notes = (version.notes || []).filter(n => !/St\.? George|SGFD/.test(n));
  write("VERSION.json", JSON.stringify({ ...version, package: id, customer: c.customer, product: c.product, modules: [...on] }, null, 2));

  // Nothing left behind that names St. George, in a package that shouldn't carry it (code comments are counted, not failed on)
  let mentions = 0;
  if (!c.sgfdContent) {
    const walk = d => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(m?jsx?|json|html|sql|md|ps1|sh)$/.test(n)) mentions += (fs.readFileSync(p, "utf8").match(/St\.? George|stgeorgefire/g) || []).length; } };
    walk(app);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const zip = path.join(OUT, `${c.name}-${version.version}${TEST ? "-TEST" : ""}.zip`);
  rm(zip);
  execFileSync("zip", ["-qr", zip, "app"], { cwd: root });
  const size = fs.statSync(zip).size;
  console.log(`${c.name}-${version.version}.zip  ${(size / 1048576).toFixed(1)} MB  (${c.customer}; modules: ${[...on].join(", ") || "core only"})`);
  console.log(`  left out: ${report.stubbed.length} module files replaced by stand-ins, removed: ${report.removed.join(", ") || "nothing"}${!c.sgfdContent ? `; "St. George" still named ${mentions} times (code comments)` : ""}`);
  return { zip, root: app, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) for (const id of ids) build(id);
export { build };
