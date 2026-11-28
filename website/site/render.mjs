// Renders every page except the home page. Runs at build time (checks) and inside the Cloudflare Worker (serving), so it has no
// imports: everything comes in through D = { site, demo, groups, sectors, presets, modules: [{key, slug, label, group, desc, feats, use,
// sectors}], notes, industries, pages }. build.mjs copies this file into worker.js without the "export" words.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600;700&display=swap";

function shell(D, { path, title, desc, crumbs, h1, lead, kicker, body, cta = true, active }) {
  const url = D.site + path;
  const trail = [["Home", "/"], ...crumbs];
  const ld = { "@context": "https://schema.org", "@graph": [
    { "@type": "WebPage", "@id": url + "#page", url, name: title, description: desc, isPartOf: { "@id": D.site + "/#site" }, publisher: { "@id": D.site + "/#org" }, inLanguage: "en-US" },
    { "@type": "BreadcrumbList", itemListElement: trail.map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, item: D.site + href })) } ] };
  const nav = [["/modules", "Modules"], ["/solutions/public-safety", "Public safety"], ["/solutions/government", "Government"],
    ["/solutions/business", "Business"], ["/solutions/education", "Education"], ["/security", "Security"]];
  const ind = D.industries.map(i => `<li><a href="/solutions/${i.slug}">${esc(i.nav)}</a></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fenmorix Technologies">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${D.site}/assets/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#08131D">
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="${FONTS}" rel="stylesheet"></noscript>
<link rel="stylesheet" href="/assets/site.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
<a class="skip" href="#main">Skip to the page</a>
<div class="band">
<header class="top"><div class="wrap">
<a href="/"><img src="/assets/logo.png" width="450" height="102" alt="Fenmorix Technologies home"></a>
<nav aria-label="Main">${nav.map(([h, t]) => `<a class="hide-sm" href="${h}"${active === h ? ' aria-current="page"' : ""}>${t}</a>`).join("")}<a class="btn btn-fire" href="${D.demo}">Request a demo</a></nav>
</div></header>
<div class="title"><div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb">${trail.map(([n, h], i) => i === trail.length - 1 ? `<span aria-current="page">${esc(n)}</span>` : `<a href="${h}">${esc(n)}</a> › `).join("")}</nav>
${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ""}<h1>${esc(h1)}</h1>
${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
</div></div>
</div>
<main id="main">
${body}
</main>
${cta ? `<section class="cta"><div class="wrap"><h2>See it with your own organization in it</h2><div class="acts"><a class="btn btn-dark" href="${D.demo}">Request a demo</a><a class="btn btn-ghost" href="/#build">Build your system</a></div></div></section>` : ""}
<footer><div class="wrap">
<div class="cols">
<div><h2>Solutions</h2><ul>${ind}</ul></div>
<div><h2>Product</h2><ul><li><a href="/modules">All modules</a></li><li><a href="/#build">Build your system</a></li><li><a href="/security">Security</a></li><li><a href="/integrations">Integrations</a></li><li><a href="/hosting">Hosting</a></li></ul></div>
<div><h2>Company</h2><ul><li><a href="/partners/avexon">Avexon partnership</a></li><li><a href="mailto:michael@fenmorix.com">michael@fenmorix.com</a></li><li><a href="https://portal.fenmorix.com">Client login</a></li></ul></div>
</div>
<div class="base"><img src="/assets/logo.png" width="450" height="102" alt="Fenmorix Technologies"><span>© Fenmorix Technologies, LLC. Baton Rouge, Louisiana.</span></div>
</div></footer>
</body>
</html>`;
}

const modBy = (D, key) => D.modules.find(m => m.key === key);
const card = (m, text) => `<a class="card" href="/modules/${m.slug}"><h3>${esc(m.label)}</h3><p>${esc(text || m.desc)}</p><span class="more">More about ${esc(m.label)}</span></a>`;
const sectorsOf = m => m.sectors && m.sectors.length ? m.sectors : ["ps", "gov", "biz", "edu"];
const short = (s, n = 158) => s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)) + "…";

function modulePage(D, m) {
  const uses = sectorsOf(m).filter(k => m.use && m.use[k]).map(k => `<div><h3>${esc(D.sectors[k].in)}</h3><p>${esc(m.use[k])}</p></div>`).join("");
  const peers = D.modules.filter(x => x.group === m.group && x.key !== m.key);
  const note = D.notes[m.key];
  const fits = D.industries.filter(i => (i.modules || []).includes(m.key) || (!i.modules && sectorsOf(m).includes(i.sector) && ((D.presets[i.sector] || []).includes(m.key) || (i.extra || []).includes(m.key))));
  const body = `<section><div class="wrap">
<h2>What it does</h2>
<ul class="checks">${m.feats.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
${note ? `<div class="note" style="margin-top:24px"><p>${esc(note)}</p></div>` : ""}
</div></section>
${uses ? `<section><div class="wrap"><h2>How organizations use it</h2><div class="uses">${uses}</div></div></section>` : ""}
${peers.length ? `<section><div class="wrap"><h2>Works well with</h2><div class="cards">${peers.map(p => card(p)).join("")}</div></div></section>` : ""}
${fits.length ? `<section><div class="wrap"><h2>Used by</h2><ul class="pills">${fits.map(i => `<li><a href="/solutions/${i.slug}">${esc(i.nav)}</a></li>`).join("")}</ul></div></section>` : ""}`;
  return shell(D, { path: `/modules/${m.slug}`, title: `${m.label} | Fenmorix OS`, desc: short(`${m.desc} ${m.feats.join(". ")}.`),
    crumbs: [["Modules", "/modules"], [m.label, `/modules/${m.slug}`]], kicker: m.group, h1: m.label, lead: m.desc, body, active: "/modules" });
}

function modulesIndex(D) {
  const body = D.groups.map(g => { const list = D.modules.filter(m => m.group === g); return list.length ? `<div class="group"><h2>${esc(g)}</h2><div class="cards">${list.map(m => card(m)).join("")}</div></div>` : ""; }).join("");
  return shell(D, { path: "/modules", title: "Modules | Fenmorix OS", desc: "Every Fenmorix OS module: messaging, recall, time clock, purchasing, forms, help desk, training, command boards, dispatch analytics, ISO tracking, gradebook and more.",
    crumbs: [["Modules", "/modules"]], h1: "Every module, one system", lead: "Switch on only what your organization needs. Every module shares the same accounts, phones, permissions and audit log.",
    body: `<section><div class="wrap">${body}</div></section>`, active: "/modules" });
}

function industryPage(D, ind) {
  const keys = ind.modules || [...(D.presets[ind.sector] || []), ...(ind.extra || [])];
  const list = keys.map(k => modBy(D, k)).filter(Boolean).filter(m => sectorsOf(m).includes(ind.sector));
  const related = (ind.related || []).map(s => D.industries.find(i => i.slug === s)).filter(Boolean);
  const rest = ind.intro.slice(1);
  const body = `${rest.length ? `<section><div class="wrap"><div class="prose">${rest.map(p => `<p>${esc(p)}</p>`).join("")}</div></div></section>` : ""}
<section><div class="wrap"><h2>Modules that fit</h2><div class="cards">${list.map(m => card(m, m.use && m.use[ind.sector])).join("")}</div>
<p style="margin-top:24px"><a href="/modules">See every module</a></p></div></section>
${related.length ? `<section><div class="wrap"><h2>Related</h2><ul class="pills">${related.map(i => `<li><a href="/solutions/${i.slug}">${esc(i.nav)}</a></li>`).join("")}</ul></div></section>` : ""}`;
  return shell(D, { path: `/solutions/${ind.slug}`, title: ind.title, desc: ind.desc, crumbs: [[ind.nav, `/solutions/${ind.slug}`]],
    h1: ind.h1, lead: ind.intro[0], body, active: ["ps"].includes(ind.sector) ? "/solutions/public-safety" : `/solutions/${ind.slug}` });
}

function factPage(D, key) {
  const p = D.pages[key], path = p.path || "/" + key;
  const body = `<section><div class="wrap"><div class="facts">${p.sections.map(([h, items]) => `<div><h2>${esc(h)}</h2><ul class="checks">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>`).join("")}</div>
${p.outro ? `<div class="note" style="margin-top:32px"><p>${esc(p.outro)}</p></div>` : ""}
${p.cta ? `<p style="margin-top:28px"><a class="btn btn-fire" href="${p.cta.href}">${esc(p.cta.label)}</a></p>` : ""}</div></section>`;
  return shell(D, { path, title: p.title, desc: p.desc, crumbs: [[p.nav, path]],
    h1: p.h1, lead: p.intro, body, active: path });
}

export function siteRoutes(D) {
  return ["/modules", ...D.modules.map(m => `/modules/${m.slug}`), ...D.industries.map(i => `/solutions/${i.slug}`),
    ...Object.entries(D.pages).map(([k, p]) => p.path || "/" + k)];
}

export function renderRoute(path, D) {
  if (path === "/modules") return modulesIndex(D);
  let m = path.match(/^\/modules\/([a-z0-9-]+)$/);
  if (m) { const mod = D.modules.find(x => x.slug === m[1]); return mod ? modulePage(D, mod) : null; }
  m = path.match(/^\/solutions\/([a-z0-9-]+)$/);
  if (m) { const ind = D.industries.find(i => i.slug === m[1]); return ind ? industryPage(D, ind) : null; }
  const key = Object.keys(D.pages).find(k => (D.pages[k].path || "/" + k) === path);
  return key ? factPage(D, key) : null;
}
