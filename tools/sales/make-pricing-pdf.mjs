// Confidential pricing & cost comparison PDF, built from the same price book the quote builder uses (src/pricing.js).
// Vendor-only tool (never shipped). Usage: node tools/sales/make-pricing-pdf.mjs [out.pdf] [--for "Client name"] [--nda "date"]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { DEFAULT_BOOK as B, calculate, money, marketLine, ratesFor, modulesFor, flatFor } from "../../src/pricing.js";
import { MODULES } from "../../src/modules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "../..");
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : ""; };
const OUT = args.find(a => a.endsWith(".pdf")) || "Fenmorix-Confidential-Pricing.pdf";
const FOR = opt("for"), NDA = opt("nda");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = n => `${Math.round(n * 1000) / 10}%`;
const MOD = Object.fromEntries(MODULES.map(m => [m.key, m]));
const logo = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "public/brand-fenmorix/vendor-logo.png")).toString("base64");
const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const S = B.seller;
const ps = B.segments.ps, biz = B.segments.biz, gov = B.segments.gov, edu = B.segments.edu;
const perUserRate = (seg, e) => Number(e.perUserYear) || Math.round(e.prices[(seg.sizes[1] || seg.sizes[0]).key] / (seg.sizes[1] || seg.sizes[0]).upTo * 100) / 100;
const blank = (w = 260) => `<span class="blank" style="width:${w}px"></span>`;
const table = (head, rows, cls = "") => `<table class="${cls}"><thead><tr>${head.map(h => `<th${/^\$|^(Small|Mid|Large|Price|Per|Year|One|Contract|Fee|Discount|Lock|Increase|Uplift|Users)/.test(h) ? ' class="n"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${typeof c === "number" || /^[−$\d]/.test(String(c)) && i ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

// Module matrix for a segment
function matrix(seg) {
  const keys = [...new Set(seg.editions.flatMap(e => e.modules))];
  const groups = {};
  for (const k of keys) { const m = MOD[k]; if (m) (groups[m.group] ||= []).push(m); }
  return `<table class="matrix"><thead><tr><th>Module</th>${seg.editions.map(e => `<th class="c">${esc(e.label)}</th>`).join("")}</tr></thead><tbody>
    <tr><td><b>Core platform</b><span class="d">Sign-in with two-step for admins, home page, announcements, directory, personnel file, user management, permissions and groups, audit log, notifications, TV display screens, branding</span></td>${seg.editions.map(() => `<td class="c yes">●</td>`).join("")}</tr>
    ${Object.entries(groups).map(([g, ms]) => `<tr class="grp"><td colspan="${seg.editions.length + 1}">${esc(g)}</td></tr>` + ms.map(m => `<tr><td><b>${esc(m.name)}</b><span class="d">${esc(m.desc || "")}</span></td>${seg.editions.map(e => `<td class="c${e.modules.includes(m.key) ? " yes" : ""}">${e.modules.includes(m.key) ? "●" : "–"}</td>`).join("")}</tr>`).join("")).join("")}
    <tr><td><b>Training environment</b><span class="d">A practice copy with sample data</span></td>${seg.editions.map(e => `<td class="c${e.includesTraining ? " yes" : ""}">${e.includesTraining ? "●" : "option"}</td>`).join("")}</tr>
  </tbody></table>`;
}

// Module by module: every module's yearly price in each market (editions are the sum of their modules)
const trio = (mp, seg) => ["s", "m", "l"].map(z => money(flatFor(mp, seg, Number(B.segments[seg]?.factor) || 1, z))).join(" · ");
const modRows = Object.entries(B.modulePrices).map(([k, mp]) => {
  const has = seg => !mp.segments || mp.segments.includes(seg);
  return [`<b>${esc(MOD[k]?.name || k)}</b>`, has("ps") ? trio(mp, "ps") : "—", has("gov") ? trio(mp, "gov") : "—", has("edu") ? trio(mp, "edu") : "—", has("biz") ? `${money(mp.user, mp.user % 1 !== 0)}` : "—"];
});

// Worked examples, priced by the same calculate() as every quote
const EX = [
  { title: "Fire district, 40 users · Operations · 3-year term", i: { segment: "ps", edition: "operations", users: 40, termYears: 3 } },
  { title: "Fire district, 85 users · Command · 3-year term · new CAD connection", i: { segment: "ps", edition: "command", users: 85, termYears: 3, cadKind: "new" } },
  { title: "Same district, CAD views already in place", i: { segment: "ps", edition: "command", users: 85, termYears: 3, cadKind: "existing" } },
  { title: "Five agencies on one system · Operations · 40 users each · 3-year term", i: { segment: "ps", edition: "operations", users: 40, members: 5, termYears: 3 } },
  { title: "Business, 25 users · Business edition · 1-year term", i: { segment: "biz", edition: "business", users: 25, termYears: 1 } },
  { title: "Fire district, 85 users · Command · on-premises license", i: { segment: "ps", edition: "command", users: 85, termYears: 3, delivery: "onprem", cadKind: "new" } },
  { title: "Parish government, 180 staff · Operations · 3-year term", i: { segment: "gov", edition: "operations", users: 180, termYears: 3 } },
  { title: "Town, 60 staff priced per user + 150 volunteers · Essentials · 1-year term", i: { segment: "gov", edition: "essentials", users: 60, pricing: "perUser", audienceMode: "perUser", audienceCount: 150, termYears: 1 } },
  { title: "School, 70 staff + 600 students · Classroom · 3-year term", i: { segment: "edu", edition: "classroom", users: 70, audienceMode: "flat", audienceCount: 600, termYears: 3 } },
  { title: "School district, 250 staff + 2,500 students · Campus + Gradebook · 3-year term", i: { segment: "edu", edition: "campus", users: 250, addons: ["gradebook"], audienceMode: "perUser", audienceCount: 2500, termYears: 3 } },
  { title: "Fire district, 30 users · Build your own (5 modules) · 1-year term", i: { segment: "ps", edition: "custom", modules: ["messaging", "timeclock", "offwork", "recall", "command"], users: 30, termYears: 1 } },
].map(e => ({ ...e, r: calculate(e.i, B) }));
const exampleCard = ({ title, r }) => `<div class="ex"><h4>${esc(title)}</h4>
  ${table(["", "Amount"], [
    ...(r.onPremQuote ? [["One-time license", money(r.onPremQuote.license)], ["Yearly maintenance and support", money(r.onPremQuote.yearly)]]
      : [["Year-one subscription", money(r.year1Recurring)], ["Per user, per month", money(r.perUserMonth, true)]]),
    ["One-time services", money(r.lines.once.reduce((s, l) => s + l.amount, 0))],
    [`${esc(r.term.label)} contract total`, `<b>${money(r.contractValue)}</b>`]])}
  <div class="d">${r.lines.once.map(l => esc(l.label.split(":")[0]) + " " + money(l.amount)).join(" · ")}</div></div>`;

// Cost comparison
const sizes = [["s", "Small", 25], ["m", "Mid-size", 100], ["l", "Large", 300]];
const psRates = B.marketRates.filter(m => !m.segments || m.segments.some(x => x !== "edu"));
const eduRates = B.marketRates.filter(m => !m.segments || m.segments.includes("edu"));
const eduSizes = [["s", "Small school", 40, 400], ["m", "Mid-size", 150, 1500], ["l", "Large", 600, 6000]];
const eduRows = eduRates.map(m => [`<b>${esc(m.label)}</b><span class="d">${esc(m.replaces)}</span>`,
  m.basis === "user" ? `${money(m.annual, m.annual % 1 !== 0)} / user` : m.basis === "student" ? `${money(m.annual, m.annual % 1 !== 0)} / student` : "flat",
  ...eduSizes.map(([k, , n, st]) => money(marketLine(m, n, k, st).annual)),
  m.setup ? money(m.setup.m) : "—"]);
const EDU_STACK = ["centegix", "frontline-absence", "frontline-central", "schooldude", "frontline-analytics", "jotform"];
const eduStack = EDU_STACK.map(k => { const l = marketLine(B.marketRates.find(m => m.key === k), 150, "m", 1500); return [esc(l.label), money(l.annual)]; });
const eduStackTotal = EDU_STACK.reduce((t, k) => t + marketLine(B.marketRates.find(m => m.key === k), 150, "m", 1500).annual, 0);
const campus150 = calculate({ segment: "edu", edition: "campus", users: 150, termYears: 3 }, B);
const gb = calculate({ segment: "edu", edition: "classroom", users: 150, termYears: 3, audienceMode: "flat", audienceCount: 1500 }, B);
const compRows = psRates.map(m => [`<b>${esc(m.label)}</b><span class="d">${esc(m.replaces)}</span>`,
  m.basis === "user" ? `${money(m.annual, m.annual % 1 !== 0)} / user` : "flat",
  ...sizes.map(([k, , n]) => money(marketLine(m, n, k).annual)),
  m.setup ? money(m.setup.m) : "—"]);
const STACK = ["aladtec", "vector-lms", "pstrax", "active911", "jotform", "tabletcommand", "firstwatch", "cleargov"];
const stack = STACK.map(k => { const l = marketLine(B.marketRates.find(m => m.key === k), 85, "m"); return [esc(l.label), money(l.annual)]; });
const stackTotal = STACK.reduce((s, k) => s + marketLine(B.marketRates.find(m => m.key === k), 85, "m").annual, 0);
const cmd85 = EX[1].r;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fenmorix OS — Confidential Pricing</title><style>
@page { size: Letter; margin: 0.7in 0.6in 0.65in; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Segoe UI", Inter, "Helvetica Neue", Arial, sans-serif; color: #18212d; font-size: 10.5px; line-height: 1.45; margin: 0; }
h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -.01em; }
h2 { font-size: 15px; color: #08131D; margin: 0 0 4px; padding-bottom: 5px; border-bottom: 2px solid #FF7900; break-after: avoid; }
h2 small { font-size: 10px; color: #6b7480; font-weight: 600; margin-left: 6px; letter-spacing: .06em; text-transform: uppercase; }
h3 { font-size: 12px; margin: 14px 0 5px; color: #C94D00; text-transform: uppercase; letter-spacing: .07em; break-after: avoid; }
h4 { font-size: 11px; margin: 0 0 4px; }
p { margin: 0 0 7px; } .lead { font-size: 11.5px; color: #3a4452; max-width: 6.4in; }
section { break-before: page; } section.first { break-before: auto; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e6e8ec; vertical-align: top; }
th { font-size: 8.5px; text-transform: uppercase; letter-spacing: .07em; color: #6b7480; border-bottom: 1.5px solid #18212d; }
td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr { break-inside: avoid; }
.d { display: block; color: #6b7480; font-size: 9px; font-weight: 400; margin-top: 1px; }
.matrix td.c, .matrix th.c { text-align: center; width: 70px; } .matrix td.yes { color: #FF7900; font-size: 12px; }
.matrix tr.grp td { background: #f4f5f7; font-weight: 800; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #C94D00; }
.cover { height: 9.3in; display: flex; flex-direction: column; }
.band { background: linear-gradient(125deg, #050709, #0b1b2a 60%, #08131D); color: #fff; border-radius: 12px; padding: 34px 32px; border-bottom: 4px solid #FF7900; }
.band img { height: 64px; } .band .kicker { margin-top: 28px; color: #FF7900; font-weight: 800; letter-spacing: .2em; font-size: 11px; }
.band h1 { color: #fff; font-size: 30px; margin-top: 6px; } .band p { color: #C5CAD0; font-size: 12px; }
.stamp { align-self: flex-start; display: inline-block; border: 2px solid #b42318; color: #b42318; font-weight: 900; letter-spacing: .18em; padding: 5px 12px; border-radius: 4px; font-size: 12px; transform: rotate(-2deg); margin-top: 22px; }
.fields { margin-top: 26px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px 28px; }
.fields div { font-size: 11px; } .fields .lab { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: #6b7480; font-weight: 700; margin-bottom: 4px; }
.blank { display: inline-block; border-bottom: 1px solid #18212d; height: 16px; vertical-align: bottom; }
.filled { font-size: 12.5px; font-weight: 700; border-bottom: 1px solid #18212d; display: block; padding-bottom: 2px; min-height: 18px; }
.note { background: #fff7ef; border: 1px solid #ffd9b8; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
.box { border: 1px solid #e3e6ea; border-radius: 8px; padding: 10px 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.ex { border: 1px solid #e3e6ea; border-radius: 8px; padding: 9px 11px; break-inside: avoid; } .ex table { margin: 2px 0 4px; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0 12px; }
.kpi { background: #f5f6f8; border-left: 3px solid #FF7900; border-radius: 6px; padding: 8px 10px; } .kpi span { font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: #6b7480; font-weight: 700; } .kpi b { display: block; font-size: 17px; }
.kpi.save { border-left-color: #1f8a4c; background: #eef8f1; }
.sig { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 16px; break-inside: avoid; }
.sig div { border-top: 1px solid #18212d; margin-top: 30px; padding-top: 3px; font-size: 9px; color: #4b5565; }
ol.terms { padding-left: 16px; margin: 0; } ol.terms li { margin-bottom: 6px; }
.mods td { font-size: 9.5px; white-space: nowrap; } .mods td:first-child { white-space: normal; }
.toc td { border: none; padding: 3px 0; font-size: 11.5px; } .toc td.n { color: #6b7480; }
</style></head><body>

<div class="cover">
  <div class="band"><img src="${logo}" alt="Fenmorix Technologies">
    <div class="kicker">FENMORIX OS · PRICING &amp; COST COMPARISON</div>
    <h1>Confidential Pricing Sheet</h1>
    <p>Editions for public safety, government, schools and business; every module's own price; add-ons, service options, one-time services, terms and group pricing, with worked examples and a comparison to what organizations pay for the software Fenmorix OS replaces.</p></div>
  <div class="stamp">CONFIDENTIAL · UNDER NDA</div>
  <div class="fields">
    <div><span class="lab">Prepared for</span>${FOR ? `<span class="filled">${esc(FOR)}</span>` : blank(300)}</div>
    <div><span class="lab">Non-disclosure agreement dated</span>${NDA ? `<span class="filled">${esc(NDA)}</span>` : blank(200)}</div>
    <div><span class="lab">Prepared by</span><span class="filled">${esc(S.name)}${S.contact ? " · " + esc(S.contact) : ""}</span></div>
    <div><span class="lab">Issued</span><span class="filled">${today}</span></div>
    <div><span class="lab">Copy number</span>${blank(120)}</div>
    <div><span class="lab">Prices good through</span>${blank(200)}</div>
  </div>
  <div style="flex:1"></div>
  <table class="toc"><tbody>
    ${["Confidentiality notice and acknowledgment", "How pricing works", "Public safety editions", "Government editions", "School editions", "Business editions", "Module prices and Build your own", "Add-ons and service options", "One-time services and CAD connections", "Terms, discounts and group pricing", "On-premises option and worked examples", "Cost comparison: public safety and government", "Cost comparison: schools", "Key contract terms", "Sources and notes"].map((t, i) => `<tr><td>${i + 1}. ${t}</td></tr>`).join("")}
  </tbody></table>
  <p class="d" style="margin-top:10px">${esc(S.name)} · ${esc(S.web)} · ${esc(S.email)} · Hosting and support partner: ${esc(S.partner)} · ${esc(S.partnerEmail)}</p>
</div>

<section><h2>1. Confidentiality notice and acknowledgment</h2>
<p class="lead">This document contains ${esc(S.name)}'s confidential pricing, discount structure, cost models and competitive analysis. It is provided only for evaluating a purchase of Fenmorix OS, under the non-disclosure agreement named on the cover.</p>
<ol class="terms">
  <li><b>Confidential information.</b> Everything in this document is confidential information of ${esc(S.name)} under that agreement, including prices, discounts, formulas, examples and the cost comparison.</li>
  <li><b>Use.</b> The recipient may use it only to evaluate and negotiate a purchase of Fenmorix OS, and may share it only with its own employees, officials and advisors who need it for that purpose and are bound by the same confidentiality obligations.</li>
  <li><b>No copies to others.</b> The recipient will not share it with any other vendor, publish it, or post it, and will return or destroy it on request.</li>
  <li><b>Public records.</b> If the recipient is a public body and receives a public records request that covers this document, it will tell ${esc(S.name)} promptly, before release where the law allows, so that ${esc(S.name)} can seek to protect its pricing and trade secrets as the law permits.</li>
  <li><b>Not an offer.</b> Prices here are a starting point for discussion. A purchase is made only by a signed quote or agreement. Prices may change until then.</li>
  <li><b>The NDA controls.</b> If this page and the non-disclosure agreement differ, the agreement controls.</li>
</ol>
<h3>Acknowledgment of receipt</h3>
<p>Signed by the recipient to acknowledge that this document was received under the non-disclosure agreement named on the cover.</p>
<div class="sig">
  <section style="break-before:auto"><div class="lab"><b>Recipient organization</b></div><div>Signature</div><div>Printed name and title</div><div>Date</div></section>
  <section style="break-before:auto"><div class="lab"><b>For ${esc(S.name)}</b></div><div>Signature</div><div>Printed name and title</div><div>Date</div></section>
</div>
</section>

<section><h2>2. How pricing works</h2>
<p class="lead">Fenmorix OS is sold as a yearly subscription per organization. You choose an edition, add what you need, and choose your service level. One-time services cover setup. Hosting is quoted separately by our hosting partner.</p>
<div class="grid2">
  <div class="box"><h4>Included in every subscription</h4><p>All modules in the edition, unlimited updates and new versions of those modules, security updates, standard support, two TV display screens, your branding, and a training environment with the Command and Complete editions.</p></div>
  <div class="box"><h4>Not included: hosting and compute</h4><p>Servers, storage, backups and the infrastructure behind your recovery tier are provided and billed by <b>${esc(S.partner)}</b>, sized to your users, data and recovery tier. They are not part of the Fenmorix prices in this document.</p></div>
  <div class="box"><h4>Public safety: priced by size</h4><p>One yearly price per agency, by edition and size: Small up to ${ps.sizes[0].upTo} users, Mid-size up to ${ps.sizes[1].upTo}, Large up to ${ps.sizes[2].upTo}. Above ${ps.quoteAbove}, quoted by hand. No per-user counting within a size.</p></div>
  <div class="box"><h4>Government and schools: by size or per user</h4><p>A yearly price by staff size (government: up to ${gov.sizes[0].upTo} / ${gov.sizes[1].upTo} / ${gov.sizes[2].upTo} staff; schools: up to ${edu.sizes[0].upTo} / ${edu.sizes[1].upTo} / ${edu.sizes[2].upTo}), or a price per staff user. People who only need a little (students; volunteers and part-time staff) are added per person or at a flat price by how many.</p></div>
  <div class="box"><h4>Business: priced per user</h4><p>A price per user per month, billed yearly, with a yearly minimum per edition.</p></div>
  <div class="box"><h4>Module by module</h4><p>Every module has its own price (section 7). Each ready-made edition costs exactly the sum of its modules. <b>Build your own</b>: any modules, priced one by one plus ${pct(B.custom.premiumPct)}; a ready-made edition with the same modules always costs less.</p></div>
  <div class="box"><h4>Price protection</h4><p>Prices are locked for the term's lock period, then rise by a fixed percentage each year (see section 10). Multi-year terms are discounted.</p></div>
  <div class="box"><h4>Made to fit</h4><p>Modules can be added at any time. Custom forms, workflows, reports and integrations are quoted, or billed hourly.</p></div>
</div></section>

<section><h2>3. Public safety editions <small>per agency, per year</small></h2>
${table(["Edition", ...ps.sizes.map(z => `${z.label} (≤ ${z.upTo} users)`)], ps.editions.map(e => [`<b>${esc(e.label)}</b><span class="d">${esc(e.blurb)}</span>`, ...ps.sizes.map(z => money(e.prices[z.key]))]).concat([["One-time implementation", ...ps.sizes.map(z => money(ps.implementation[z.key]))]]))}
<h3>What each edition includes</h3>${matrix(ps)}</section>

<section><h2>4. Government editions <small>per organization, per year</small></h2>
<p class="lead">Cities, parishes and counties, special districts and state agencies.</p>
${table(["Edition", ...gov.sizes.map(z => `${z.label} (≤ ${z.upTo} staff)`), "Per staff user / yr"], gov.editions.map(e => [`<b>${esc(e.label)}</b><span class="d">${esc(e.blurb)}</span>`, ...gov.sizes.map(z => money(e.prices[z.key])), money(perUserRate(gov, e), true)]).concat([["One-time implementation", ...gov.sizes.map(z => money(gov.implementation[z.key])), ""]]))}
<p class="d">Per staff user: at least the Small price. ${esc(gov.audience.label)}: ${money(gov.audience.perUserYear)} per person a year, or a flat ${gov.audience.tiers.map(t => `${money(t.price)} up to ${t.upTo.toLocaleString("en-US")}`).join(" · ")}. ${esc(gov.audience.note)}</p>
<h3>What each edition includes</h3>${matrix(gov)}</section>

<section><h2>5. School editions <small>per school or district, per year</small></h2>
<p class="lead">Public, private and charter schools and districts. School prices are set module by module against what schools pay today (section 13).</p>
${table(["Edition", ...edu.sizes.map(z => `${z.label} (≤ ${z.upTo} staff)`), "Per staff user / yr"], edu.editions.map(e => [`<b>${esc(e.label)}</b><span class="d">${esc(e.blurb)}</span>`, ...edu.sizes.map(z => money(e.prices[z.key])), money(perUserRate(edu, e), true)]).concat([["One-time implementation", ...edu.sizes.map(z => money(edu.implementation[z.key])), ""]]))}
${table(["Students", "Per student / yr", ...edu.audience.tiers.map(t => `Flat, up to ${t.upTo.toLocaleString("en-US")}`)], [[esc(edu.audience.note), money(edu.audience.perUserYear), ...edu.audience.tiers.map(t => money(t.price))]])}
<p class="d">Students and parents sign in on their own page and see only their own grades and graded work (with the Gradebook). Per staff user: at least the Small price. The Gradebook is also sold on its own as an add-on (section 8).</p>
<h3>What each edition includes</h3>${matrix(edu)}</section>

<section><h2>6. Business editions <small>per user, billed yearly</small></h2>
${table(["Edition", "Per user / month", "Yearly minimum", "Example: 10 users / yr", "Example: 50 users / yr"], biz.editions.map(e => [`<b>${esc(e.label)}</b><span class="d">${esc(e.blurb)}</span>`, money(e.perUserMonth), money(e.minYear), money(Math.max(e.perUserMonth * 120, e.minYear)), money(Math.max(e.perUserMonth * 600, e.minYear))]))}
${table(["One-time implementation", ...biz.sizes.map(z => `${z.label} (≤ ${z.upTo} users)`)], [["Setup, branding, roles, training", ...biz.sizes.map(z => money(biz.implementation[z.key]))]])}
<h3>What each edition includes</h3>${matrix(biz)}</section>

<section><h2>7. Module prices and Build your own <small>per year</small></h2>
<p class="lead">What each module costs on its own, by size (Small · Mid-size · Large). Editions cost the sum of their modules. Build your own = the modules picked, at these prices, plus ${pct(B.custom.premiumPct)}; implementation is scaled to the modules chosen (at least ${pct(B.custom.minImplementationPct)} of the full implementation).</p>
${table(["Module", "Public safety", "Government", "Schools", "Business / user / mo"], modRows, "mods")}
<p class="d">— = not offered in that market. Business modules are priced per user per month; the business editions' yearly minimums apply.</p></section>

<section><h2>8. Add-ons and service options</h2>
<h3>Add-ons <small>per year, by size</small></h3>
${table(["Add-on", "Markets", "Small", "Mid", "Large"], B.addons.map(a => [`<b>${esc(a.label)}</b><span class="d">${esc(a.note)}</span>`, a.segments.map(s => B.segments[s].label).join(", "), money(a.prices.s), money(a.prices.m), money(a.prices.l)]))}
<p class="d">An add-on already in the chosen edition isn't charged again.</p>
<h3>Environments <small>% of the yearly software price</small></h3>
${table(["Option", "What it gives you", "Uplift"], B.environments.map(e => [`<b>${esc(e.label)}</b>`, esc(e.note || (e.key === "both" ? "Both a training copy and a test copy." : "Your live system.")), e.pct ? pct(e.pct) : "Included"]))}
<p class="d">A training environment is included with Command and Complete; choosing training + test with them adds only the difference.</p>
<h3>Backup and disaster recovery</h3>
${table(["Tier", "Backups", "Back within", "Data loss at most", "Fenmorix fee"], B.dr.map(d => [`<b>${esc(d.label)}</b>`, esc(d.backups), esc(d.rto), esc(d.rpo), d.pct ? pct(d.pct) : "None"]))}
<p class="note">The servers, second region and standby behind each tier are part of ${esc(S.partner)}'s hosting quote. Higher tiers need more infrastructure, so they cost more to host.</p>
<h3>Support <small>% of the yearly software price</small></h3>
${table(["Tier", "Hours", "Critical response", "Everything else", "Uplift"], B.support.map(s => [`<b>${esc(s.label)}</b>`, esc(s.hours), esc(s.critical), esc(s.normal), s.pct ? pct(s.pct) : "Included"]))}
</section>

<section><h2>9. One-time services and CAD connections</h2>
<h3>Implementation</h3>
<p>Setup, branding, roles and permissions, and staff training. ${[["Public safety", ps], ["Government", gov], ["Schools", edu], ["Business", biz]].map(([n, g]) => `${n}: ${g.sizes.map(z => `${z.label} ${money(g.implementation[z.key])}`).join(" · ")}`).join(". ")}. Schools: importing class rosters from a spreadsheet is part of implementation.</p>
<h3>CAD connection</h3>
${table(["Choice", "When it applies", "Price"], [
  ["<b>Views already exist</b>", `We already have SQL views for this CAD (same vendor and version), or it is a shared regional CAD already connected. Install, map and test our views.`, money(B.oneTime.cad.existing)],
  ["<b>New CAD vendor</b>", "A CAD we haven't connected before: map its database, build and test the views.", money(B.oneTime.cad.new)],
  ["<b>More standard views</b>", `Beyond the ${B.oneTime.cad.includedViews} included (active calls and call statistics): apparatus and unit times, a master incident list for reports.`, `${money(B.oneTime.cad.extraView)} each`],
  ["<b>Custom views and queries</b>", "Anything designed for you.", `${money(B.hourly.custom)} / hour`]])}
<p class="note">A CAD that is already connected saves ${money(B.oneTime.cad.new - B.oneTime.cad.existing)} per system. Each CAD system is priced separately.</p>
<h3>Other services</h3>
${table(["Service", "Price"], [
  ["Data migration from your current systems", `${money(B.oneTime.migrationHourly)} / hour`],
  ["On-site training (plus travel)", `${money(B.oneTime.trainingDay)} / day`],
  ["Custom work: forms, workflows, reports, integrations", `${money(B.hourly.custom)} / hour`],
  [`Prepaid custom-work block (${B.hourly.prepaidHours} hours, use within 12 months)`, `${money(B.hourly.prepaidHours * B.hourly.prepaidRate)} (${money(B.hourly.prepaidRate)} / hour)`],
  ["Group setup: shared dashboards, sharing rules, group admin training", money(B.oneTime.groupSetup)],
  ["Implementation for each additional agency or company in a group", `${pct(B.oneTime.additionalMemberImplementation)} of the implementation fee`]])}
</section>

<section><h2>10. Terms, discounts and group pricing</h2>
<h3>Terms</h3>
${table(["Term", "Discount", "Price lock", "Yearly increase after the lock"], B.terms.map(t => [`<b>${esc(t.label)}</b>`, t.discount ? pct(t.discount) : "—", `${t.lockYears} year${t.lockYears === 1 ? "" : "s"}`, pct(t.escalator)]))}
<div class="grid2">
  <div class="box"><h4>${esc(B.founding.label)}</h4><p>${pct(B.founding.pct)} off the subscription for the first ${B.founding.years} years, for early customers who serve as a reference.</p></div>
  <div class="box"><h4>Payment</h4><p>${esc(B.paymentTerms)}</p></div>
</div>
<h3>Several agencies on one system</h3>
<p>Each agency keeps its own data, with one sign-in, an agency switcher, cross-agency messaging and combined dashboards.</p>
${table(["Agencies", "Discount on software", "Group platform fee / yr"], [[`2–3`, pct(B.group.discounts[0].pct), money(B.group.platformFees[0].fee)], [`4–5`, pct(B.group.discounts[1].pct), money(B.group.platformFees[0].fee)], [`6`, pct(B.group.discounts[1].pct), money(B.group.platformFees[1].fee)], [`7–${B.group.quoteAbove}`, pct(B.group.discounts[2].pct), money(B.group.platformFees[1].fee)], [`More than ${B.group.quoteAbove}`, "Regional pricing, quoted", "Quoted"]])}
<h3>Family of companies</h3>
${table(["Companies", "Discount on software", "Shared directory, switching and messaging"], [["2", "—", `${money(B.group.familyPerCompanyMonth)} / month per extra company`], ...B.group.familyDiscounts.map((d, i, a) => [`${d.min}${a[i + 1] ? `–${a[i + 1].min - 1}` : "+"}`, pct(d.pct), `${money(B.group.familyPerCompanyMonth)} / month per extra company`])])}
</section>

<section><h2>11. On-premises option and worked examples</h2>
<p class="lead">For organizations that must run software on their own servers.</p>
${table(["Item", "Price"], [["Perpetual license (one time)", `${B.onPrem.licenseMultiple}× the yearly software price`], ["Yearly maintenance: updates and standard support", `${pct(B.onPrem.maintenancePct)} of the license`], ["Priority or 24/7 support", "Same uplift as hosted"], ["Without maintenance", "You keep the version you have"]])}
<p class="d">Hosting, servers and backups are the customer's own. Disaster recovery tiers apply to hosted systems.</p>
<h3 style="margin-top:18px">Worked examples <small>priced by the same calculator as every quote</small></h3>
<div class="grid2" style="margin-top:8px">${EX.map(exampleCard).join("")}</div>
<p class="d">Hosting by ${esc(S.partner)} is added separately. Prices in U.S. dollars; sales tax added where it applies.</p>
</section>

<section><h2>12. Cost comparison: public safety and government <small>what organizations pay today</small></h2>
<p class="lead">Yearly costs of software Fenmorix OS replaces, from public contracts, council records and published price lists. Per-user prices are shown at 25, 100 and 300 users.</p>
${table(["Product and what replaces it", "Basis", "Small (25)", "Mid (100)", "Large (300)", "Setup"], compRows)}
<div style="break-before: page"></div><h2>12. Cost comparison, continued <small>an 85-person department</small></h2>
<div class="grid2" style="margin-top:10px"><div>${table(["Software in use today", "Per year"], [...stack, ["<b>Total today</b>", `<b>${money(stackTotal)}</b>`]])}</div>
<div><div class="kpis" style="grid-template-columns:1fr 1fr">
  <div class="kpi"><span>Today, per year</span><b>${money(stackTotal)}</b></div>
  <div class="kpi"><span>Fenmorix OS Command, year one</span><b>${money(cmd85.year1Recurring)}</b></div>
  <div class="kpi save"><span>Difference per year, before hosting</span><b>${money(stackTotal - cmd85.year1Recurring)}</b></div>
  <div class="kpi save"><span>Over a 3-year term, before hosting</span><b>${money(stackTotal * 3 - cmd85.year1Recurring * 3)}</b></div></div>
  <p class="d">Command (Mid-size, 3-year term). One-time services and ${esc(S.partner)}'s hosting are separate; FirstWatch's ${money(86644)} start-up fee and the setup fees above are not counted on the other side either.</p></div></div>
<p class="note">One system also replaces separate logins, separate training, and the work of keeping several vendors' data in step.</p>
</section>

<section><h2>13. Cost comparison: schools <small>what schools pay today</small></h2>
<p class="lead">From school board records, state contracts and published prices. Shown for a small school (40 staff, 400 students), a mid-size school or small district (150 staff, 1,500 students) and a large district (600 staff, 6,000 students). Per-school prices are for one campus; a district pays them for each campus.</p>
${table(["Product and what replaces it", "Basis", "Small", "Mid-size", "Large", "Setup"], eduRows)}
<p class="note">Student information systems (PowerSchool, Infinite Campus, Gradelink) also run attendance, scheduling and state reporting. The Gradebook replaces their grading, report-card and family-portal part only, so they are shown for reference, not counted as savings.</p>
<div style="break-before: page"></div><h2>13. Cost comparison: schools, continued <small>150 staff, 1,500 students</small></h2>
<div class="grid2"><div>${table(["Software in use today", "Per year"], [...eduStack, ["<b>Total today</b>", `<b>${money(eduStackTotal)}</b>`]])}</div>
<div><div class="kpis" style="grid-template-columns:1fr 1fr">
  <div class="kpi"><span>Today, per year</span><b>${money(eduStackTotal)}</b></div>
  <div class="kpi"><span>Fenmorix OS Campus, year one</span><b>${money(campus150.year1Recurring)}</b></div>
  <div class="kpi save"><span>Difference per year, before hosting</span><b>${money(eduStackTotal - campus150.year1Recurring)}</b></div>
  <div class="kpi save"><span>Over a 3-year term, before hosting</span><b>${money((eduStackTotal - campus150.year1Recurring) * 3)}</b></div></div>
  <p class="d">Campus (Mid-size, 3-year term). Grades for those 1,500 students and their families (Classroom edition with students, 3-year term): ${money(gb.year1Recurring)} a year. One-time services and ${esc(S.partner)}'s hosting are separate. CENTEGIX's per-campus installation is not counted on the other side.</p></div></div>
</section>

<section><h2>14. Key contract terms <small>summary, for discussion</small></h2>
<ol class="terms">${B.termsSections.map(t => `<li><b>${esc(t.title)}.</b> ${esc(t.body)}</li>`).join("")}</ol>
<h2 style="margin-top:20px">15. Sources and notes</h2>
${table(["Product", "Source"], B.marketRates.map(m => [esc(m.label), esc(m.source)]))}
<p class="d">Competitor figures come from public contracts, council and board records and vendors' published prices, gathered November 2026. They vary by department, year and modules, and are shown as a guide; your own invoices are the best comparison. Product names are trademarks of their owners; Fenmorix is not affiliated with them.</p>
</section>
</body></html>`;

const tmp = path.join(path.dirname(path.resolve(OUT)), ".pricing-sheet.html");
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const page = await browser.newPage();
await page.goto("file://" + tmp, { waitUntil: "load" });
const foot = `<div style="width:100%;font-size:7.5px;color:#8a929c;font-family:Arial,sans-serif;padding:0 0.6in;display:flex;justify-content:space-between">
  <span><b style="color:#b42318">CONFIDENTIAL</b> · ${esc(S.name)} · Provided under NDA${FOR ? " to " + esc(FOR) : ""} · Do not distribute</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
await page.pdf({ path: OUT, format: "Letter", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: foot });
await browser.close();
fs.unlinkSync(tmp);
console.log("wrote", OUT);
