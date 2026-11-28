// Builds the website. Edit shell.html and parts/*, then run: node website/build.mjs
//  - index.html = shell.html with each <!--part:NAME--> replaced by parts/NAME and <!--schema--> by the JSON-LD below
//  - worker.js  = the deployed Cloudflare Worker; the inlined constants (HTML, NOTFOUND, OG) are rewritten in place,
//                 and the region between "generated site start/end" holds the other pages (site/*). Routing code is hand-edited.
// Checks: every part placeholder filled, page has one <h1>, canonical, description and og:image; claims that the
// product doesn't support (see the SEO plan, section 3) fail the build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const rd = f => fs.readFileSync(path.join(dir, f), "utf8");

const SITE = "https://fenmorix.com";
const schema = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "Fenmorix Technologies, LLC", alternateName: "Fenmorix", url: SITE + "/",
      logo: SITE + "/assets/logo.png", email: "michael@fenmorix.com",
      address: { "@type": "PostalAddress", addressLocality: "Baton Rouge", addressRegion: "LA", addressCountry: "US" } },
    { "@type": "WebSite", "@id": SITE + "/#site", name: "Fenmorix Technologies", url: SITE + "/", publisher: { "@id": SITE + "/#org" }, inLanguage: "en-US" },
    { "@type": "SoftwareApplication", "@id": SITE + "/#os", name: "Fenmorix OS", applicationCategory: "BusinessApplication", operatingSystem: "Web browser",
      description: "One system for messaging, schedules, purchasing, forms, training, emergency notification and reporting, for public safety agencies, governments, businesses and schools. Organizations switch on only the modules they need.",
      url: SITE + "/", publisher: { "@id": SITE + "/#org" } },
  ],
};

let html = rd("shell.html");
html = html.replace(/<!--part:([\w.-]+)-->/g, (_, f) => rd("parts/" + f).trim());
const C = await import(path.join(dir, "site/content.mjs"));
const BEACON = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${C.ANALYTICS_TOKEN}"}'></script>`;
html = html.replaceAll("__TURNSTILE_SITEKEY__", C.TURNSTILE_SITEKEY).replace("<!--beacon-->", BEACON);
html = html.replace("<!--schema-->", `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`);
// Same light minifying the live page has always had: no indentation, no whole-line comments, no blank lines.
html = html.split("\n").map(l => l.trimStart()).filter(l => l && !/^\/\/( |$)/.test(l) && !/^\/\*.*\*\/$/.test(l)).join("\n");
const notFound = rd("404.html");

const problems = [];
if (/<!--part:/.test(html)) problems.push("a part placeholder was not filled");
if (/__[A-Z_]+__/.test(html)) problems.push("a __PLACEHOLDER__ was not filled: " + html.match(/__[A-Z_]+__/)[0]);
if ((html.match(/<h1[\s>]/g) || []).length !== 1) problems.push("index.html needs exactly one <h1>");
if (!html.includes("cloudflareinsights")) problems.push("index.html is missing the analytics beacon");
for (const need of ['rel="canonical"', 'name="description"', 'property="og:image"', "application/ld+json"])
  if (!html.includes(need)) problems.push("index.html is missing " + need);
// Wording the product doesn't support (SEO plan section 3). Lower-case match on the visible copy and scripts.
const BANNED = ["permission slip", "parent conference", "parent-teacher", "built for cjis", "cjis-certified", "cjis certified",
  "students are out", "one family", "class schedules for students", "sports physicals"];
for (const [name, text] of [["index.html", html], ["404.html", notFound]])
  for (const b of BANNED) if (text.toLowerCase().includes(b)) problems.push(`${name} says "${b}", which the product doesn't support`);
// ---- Pages beyond the home page (site/content.mjs words + parts/modules.js catalog, drawn by site/render.mjs)
const { renderRoute, siteRoutes, topNav } = await import(path.join(dir, "site/render.mjs"));
const cat = new Function(rd("parts/modules.js") + "\nreturn { SECTORS, GROUPS, MODULES, PRESETS };")();
const D = {
  site: C.SITE_URL, demo: C.DEMO, beacon: BEACON, sitekey: C.TURNSTILE_SITEKEY, groups: cat.GROUPS, sectors: Object.fromEntries(Object.entries(cat.SECTORS).map(([k, v]) => [k, { label: v.label, in: v.in }])),
  presets: cat.PRESETS, notes: C.MODULE_NOTES, industries: C.INDUSTRIES, pages: C.PAGES,
  modules: cat.MODULES.filter(m => !C.HIDDEN.includes(m.key)).map(m => {
    if (!C.SLUGS[m.key]) problems.push(`module ${m.key} has no page address in site/content.mjs SLUGS`);
    return { key: m.key, slug: C.SLUGS[m.key], label: m.label, group: m.group, desc: m.desc, feats: m.feats, use: m.use || {}, sectors: m.sectors || null };
  }),
};
const NAV_JS = rd("site/nav.js").trim();
D.navjs = NAV_JS;
html = html.replace("<!--topnav-->", () => topNav(D, "")).replace("<!--navcss-->", () => rd("site/nav.css")).replace("<!--navjs-->", () => NAV_JS);
html = html.split("\n").map(l => l.trimStart()).filter(l => l && !/^\/\/( |$)/.test(l) && !/^\/\*.*\*\/$/.test(l)).join("\n");
for (const k of ["topnav", "navcss", "navjs"]) if (html.includes(`<!--${k}-->`)) problems.push(`index.html: <!--${k}--> was not filled`);
if (!html.includes('class="mainnav"')) problems.push("index.html is missing the top menu");
const routes = ["/", ...siteRoutes(D)];
const seen = { title: new Map(), desc: new Map() };
for (const r of routes.slice(1)) {
  const page = renderRoute(r, D);
  if (!page) { problems.push(`${r} renders nothing`); continue; }
  const title = (page.match(/<title>(.*?)<\/title>/) || [])[1], desc = (page.match(/name="description" content="(.*?)"/) || [])[1] || "";
  if ((page.match(/<h1[\s>]/g) || []).length !== 1) problems.push(`${r} needs exactly one <h1>`);
  if (desc.length < 50 || desc.length > 170) problems.push(`${r} description is ${desc.length} characters (50-170)`);
  for (const [k, v] of [["title", title], ["desc", desc]]) { if (seen[k].has(v)) problems.push(`${r} repeats the ${k} of ${seen[k].get(v)}`); seen[k].set(v, r); }
  for (const b of BANNED) if (page.toLowerCase().includes(b)) problems.push(`${r} says "${b}", which the product doesn't support`);
  for (const [, href] of page.matchAll(/href="(\/[^"#?]*)/g)) if (!routes.includes(href) && !href.startsWith("/assets/")) problems.push(`${r} links to ${href}, which doesn't exist`);
}
if (problems.length) { console.error("Build stopped:\n - " + problems.join("\n - ")); process.exit(1); }
console.log(`${routes.length} pages`);

fs.writeFileSync(path.join(dir, "index.html"), html);

let worker = rd("worker.js");
const setConst = (name, value) => {
  const line = `const ${name} = ${JSON.stringify(value)};`;
  const re = new RegExp(`^const ${name} = ".*";$`, "m");
  if (re.test(worker)) worker = worker.replace(re, () => line);
  else worker = worker.replace(/^const HTML = ".*";$/m, m => m + "\n" + line);
};
setConst("HTML", html);
setConst("NOTFOUND", notFound);
setConst("LASTMOD", new Date().toISOString().slice(0, 10));
setConst("OG", fs.readFileSync(path.join(dir, "assets/og.jpg")).toString("base64"));
const sitemap = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  routes.map(r => `<url><loc>${C.SITE_URL}${r}</loc><lastmod>' + LASTMOD + '</lastmod></url>`).join("") + "</urlset>";
const renderCode = rd("site/render.mjs").replace(/^export /gm, "");
const region = `// ---- generated site start (website/build.mjs; edit site/*.mjs, site/site.css, parts/modules.js)
const SITE = ${JSON.stringify(D)};
const CSS = ${JSON.stringify(rd("site/site.css") + "\n" + rd("site/nav.css"))};
const SITEMAP = '${sitemap}';
${renderCode}
// ---- generated site end`;
const R = /\/\/ ---- generated site start[\s\S]*?\/\/ ---- generated site end/;
if (!R.test(worker)) { console.error("worker.js has no generated site region"); process.exit(1); }
worker = worker.replace(R, () => region);
fs.writeFileSync(path.join(dir, "worker.js"), worker);
console.log(`index.html ${html.length} bytes, worker.js ${worker.length} bytes`);
