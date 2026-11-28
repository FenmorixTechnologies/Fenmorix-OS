// Renders every page except the home page. Runs at build time (checks) and inside the Cloudflare Worker (serving), so it has no
// imports: everything comes in through D = { site, demo, groups, sectors, presets, modules: [{key, slug, label, group, desc, feats, use,
// sectors}], notes, industries, pages }. build.mjs copies this file into worker.js without the "export" words.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600;700&display=swap";

function shell(D, { path, title, desc, crumbs, h1, lead, kicker, body, cta = true, active, head = "" }) {
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
${head}${D.beacon || ""}
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

// Demo request: the form posts to /api/idea with kind "demo"; the Worker checks Turnstile and forwards it to Fenmorix's office.
function demoPage(D) {
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const body = `<section><div class="wrap demo-grid">
<div class="prose">
<h2>What happens next</h2>
<p>We'll get back to you to find a time that works. The demo walks through the modules you pick, on a copy of Fenmorix OS that can carry your organization's name and colors.</p>
<p>If you built your system on the <a href="/#build">home page</a>, the modules you switched on are filled in below.</p>
<p>Prefer email? Write to <a href="mailto:michael@fenmorix.com?subject=${encodeURIComponent("Fenmorix OS demo")}">michael@fenmorix.com</a>.</p>
</div>
<form id="demo-form" novalidate>
<div class="f2"><label>Your name<input name="name" autocomplete="name" required></label><label><span>Your title <span class="opt">(optional)</span></span><input name="title" autocomplete="organization-title"></label></div>
<label>Organization<input name="org" autocomplete="organization" required></label>
<div class="f2"><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" required></label></div>
<div class="f2"><label>Type of organization<select name="sector" required>${opt("", "Choose one")}${Object.entries(D.sectors).map(([k, s]) => opt(k, s.label)).join("")}</select></label>
<label><span>Number of people <span class="opt">(optional)</span></span><select name="size">${opt("", "Choose one")}${["Under 25", "25 to 100", "100 to 500", "More than 500"].map(x => opt(x, x)).join("")}</select></label></div>
<label><span>Modules you'd like to see <span class="opt">(optional)</span></span><textarea name="modules" rows="4"></textarea></label>
<label><span>Best time to talk <span class="opt">(optional)</span></span><input name="when"></label>
<label><span>Anything else we should know <span class="opt">(optional)</span></span><textarea name="notes" rows="4"></textarea></label>
<label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<div class="cf-turnstile" data-sitekey="${esc(D.sitekey)}" data-theme="light"></div>
<div class="send"><button class="btn btn-fire" type="submit">Request a demo</button><p id="demo-status" role="status" aria-live="polite"></p></div>
</form>
</div></section>
<script>
(() => {
  const f = document.getElementById("demo-form"), st = document.getElementById("demo-status");
  const say = (t, c) => { st.textContent = t; st.className = c || ""; };
  try { const b = JSON.parse(sessionStorage.getItem("fx-build") || "null");
    if (b) { if (b.sector) f.elements.sector.value = b.sector; if (b.modules && b.modules.length) f.elements.modules.value = b.modules.join(", "); if (b.own && b.name) f.elements.org.value = b.name; } } catch (e) {}
  f.addEventListener("submit", async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f)), bad = [];
    for (const [k, label] of [["name", "your name"], ["org", "your organization"], ["email", "your email"], ["phone", "your phone number"], ["sector", "the type of organization"]]) {
      const val = String(v[k] || "").trim();
      const wrong = !val || (k === "email" && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)) || (k === "phone" && val.replace(/\\D/g, "").length < 7);
      f.elements[k].setAttribute("aria-invalid", wrong ? "true" : "false"); if (wrong) bad.push(label);
    }
    if (bad.length) { say("Please fill in " + bad.join(", ").replace(/, ([^,]*)$/, " and $1") + ".", "bad"); f.querySelector('[aria-invalid="true"]').focus(); return; }
    const token = (f.querySelector('[name="cf-turnstile-response"]') || {}).value || "";
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; say("Sending…");
    try {
      const r = await fetch("/api/idea", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...v, kind: "demo", token }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "It didn't go through.");
      f.reset(); f.querySelectorAll("[aria-invalid]").forEach(x => x.removeAttribute("aria-invalid"));
      try { sessionStorage.removeItem("fx-build"); } catch (e) {}
      say("Thank you. Your request reached our team, and we'll contact you at the email you gave.", "ok");
    } catch (err) { say(err.message + " You can also email michael@fenmorix.com.", "bad"); }
    finally { btn.disabled = false; if (window.turnstile) try { window.turnstile.reset(); } catch (e) {} }
  });
})();
</script>`;
  return shell(D, { path: "/demo", title: "Request a demo | Fenmorix OS", desc: "Ask for a demo of Fenmorix OS for your agency, office, company or school, with the modules you want to see.",
    crumbs: [["Request a demo", "/demo"]], h1: "Request a demo", lead: "Tell us about your organization and what you'd like to see. We'll set up a time to show you Fenmorix OS.",
    body, cta: false, active: "/demo", head: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n` });
}

export function siteRoutes(D) {
  return ["/modules", "/demo", ...D.modules.map(m => `/modules/${m.slug}`), ...D.industries.map(i => `/solutions/${i.slug}`),
    ...Object.entries(D.pages).map(([k, p]) => p.path || "/" + k)];
}

export function renderRoute(path, D) {
  if (path === "/modules") return modulesIndex(D);
  if (path === "/demo") return demoPage(D);
  let m = path.match(/^\/modules\/([a-z0-9-]+)$/);
  if (m) { const mod = D.modules.find(x => x.slug === m[1]); return mod ? modulePage(D, mod) : null; }
  m = path.match(/^\/solutions\/([a-z0-9-]+)$/);
  if (m) { const ind = D.industries.find(i => i.slug === m[1]); return ind ? industryPage(D, ind) : null; }
  const key = Object.keys(D.pages).find(k => (D.pages[k].path || "/" + k) === path);
  return key ? factPage(D, key) : null;
}
