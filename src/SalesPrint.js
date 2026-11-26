// Printable documents for Clients & Quotes (module "sales"): the customer quote (cover, what's included, pricing, payment schedule,
// terms, acceptance) and the spec sheet for an edition. Plain HTML printed through a hidden iframe ("Save as PDF" in the print dialog).
// Seller identity is always Fenmorix Technologies, LLC, whatever install this runs on.
import { MODULES } from "./modules.js";
import { DEFAULT_BOOK } from "./pricing.js";
import { money } from "./pricing.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = s => esc(s).replace(/\n/g, "<br>");
const pct = n => `${Math.round((Number(n) || 0) * 100)}%`;
const longDate = d => { const x = d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d) : new Date(); return x.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); };
const MOD = Object.fromEntries(MODULES.map(m => [m.key, m]));
let SELLER = DEFAULT_BOOK.seller;
const useSeller = book => { SELLER = { ...DEFAULT_BOOK.seller, ...(book?.seller || {}) }; };

const CSS = `
  @page { size: Letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: "Segoe UI", Inter, Arial, sans-serif; color: #18212d; font-size: 11.5px; line-height: 1.45; margin: 0; }
  .band { background: linear-gradient(120deg, #050709, #0b1b2a 60%, #08131D); color: #fff; padding: 18px 22px; border-radius: 10px; display: flex;
    align-items: center; justify-content: space-between; gap: 16px; border-bottom: 3px solid #FF7900; }
  .band img { height: 46px; } .band .doc { text-align: right; } .band .doc b { display: block; font-size: 20px; letter-spacing: .14em; color: #FF7900; }
  .band .doc span { color: #C5CAD0; font-size: 11px; }
  h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: #C94D00; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e3e6ea; break-after: avoid; }
  h3 { font-size: 12.5px; margin: 10px 0 4px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .box { border: 1px solid #e3e6ea; border-radius: 8px; padding: 10px 12px; }
  .lab { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; color: #6b7480; font-weight: 700; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
  .kpi { border-radius: 8px; padding: 10px; background: #f5f6f8; border-left: 3px solid #FF7900; }
  .kpi b { display: block; font-size: 17px; margin-top: 2px; } .kpi.save { border-left-color: #1f8a4c; background: #eef8f1; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; break-inside: auto; font-size: 11px; }
  th, td { text-align: left; padding: 5px 7px; border-bottom: 1px solid #e8eaee; vertical-align: top; }
  th { font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #6b7480; border-bottom: 1.5px solid #18212d; }
  td.n, th.n { text-align: right; white-space: nowrap; } tr.tot td { font-weight: 700; border-top: 1.5px solid #18212d; border-bottom: none; }
  tr.disc td { color: #1f8a4c; } tr { break-inside: avoid; }
  .mods { columns: 2; column-gap: 18px; } .mod { break-inside: avoid; margin: 0 0 7px; } .mod b { display: block; font-size: 11.5px; } .mod span { color: #4b5565; font-size: 10.5px; }
  .grp { font-size: 10px; font-weight: 800; color: #C94D00; text-transform: uppercase; letter-spacing: .08em; margin: 6px 0 3px; break-after: avoid; }
  .terms p { margin: 0 0 6px; } .terms b { color: #08131D; }
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px; break-inside: avoid; }
  .sig div { border-top: 1px solid #18212d; padding-top: 4px; margin-top: 34px; font-size: 10.5px; color: #4b5565; }
  .note { background: #fff7ef; border: 1px solid #ffd9b8; border-radius: 8px; padding: 8px 10px; margin: 8px 0; }
  .muted { color: #6b7480; } .foot { margin-top: 18px; font-size: 9.5px; color: #8a929c; text-align: center; border-top: 1px solid #e3e6ea; padding-top: 6px; }
  .pb { break-before: page; }
  .d { display: block; color: #6b7480; font-size: 10px; font-weight: 400; margin-top: 1px; }
`;
// The Fenmorix logo, embedded so a saved PDF or HTML copy carries it (loadLogo() fills it before the first print)
let LOGO = "/api/sales/logo";
export function setLogo(dataUrl) { LOGO = dataUrl; }   // the server (client portal) embeds the logo itself
export async function loadLogo() {
  if (LOGO.startsWith("data:")) return;
  try {
    const b = await (await fetch("/api/sales/logo", { credentials: "same-origin" })).blob();
    if (!/^image\//.test(b.type)) return;
    LOGO = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
  } catch {}
}
const header = (title, sub) => `<div class="band"><img src="${LOGO}" alt="Fenmorix Technologies"><div class="doc"><b>${esc(title)}</b><span>${sub}</span></div></div>`;
const footer = extra => `<div class="foot">${esc(SELLER.name)} · ${esc(SELLER.web)} · ${esc(SELLER.email)}${SELLER.phone ? " · " + esc(SELLER.phone) : ""}${extra ? " · " + esc(extra) : ""}</div>`;

// Modules grouped the way the catalog groups them, with the always-included core first
function modulesHtml(keys) {
  const groups = {};
  for (const k of keys) { const m = MOD[k]; if (!m || m.vendor) continue; (groups[m.group] ||= []).push(m); }
  const core = `<div class="grp">Included in every system</div><div class="mod"><b>Fenmorix OS core</b><span>Sign-in with two-step verification for administrators, `
    + `Your Day home page, announcements, directory, personnel file, user management, permissions and groups, audit log, notifications, TV display screens, branding.</span></div>`;
  return `<div class="mods">${core}${Object.entries(groups).map(([g, ms]) => `<div class="grp">${esc(g)}</div>` + ms.map(m => `<div class="mod"><b>${esc(m.name)}</b><span>${esc(m.desc || "")}</span></div>`).join("")).join("")}</div>`;
}
// Avexon's part: never in Fenmorix's totals. Their figures when entered, else a note that they quote it.
function hostingHtml(h, dr) {
  const p = esc(h.partner);
  if (!h.known) return `<div class="note"><b>Hosting and compute are not included above.</b> ${p} quotes them separately, sized to the number of users, the data kept and the recovery tier chosen (${esc(dr.label)}: back within ${esc(dr.rto)}, at most ${esc(dr.rpo)} of data lost). Higher recovery tiers need more infrastructure and cost more to host.</div>`;
  return `<h3>Hosting and compute (${p})</h3><table><tbody>
    ${h.annual ? `<tr><td>Hosting, compute, storage and ${esc(dr.label.toLowerCase())} recovery, per year</td><td class="n">${money(h.annual)}</td></tr>` : ""}
    ${h.oneTime ? `<tr><td>Hosting setup, one time</td><td class="n">${money(h.oneTime)}</td></tr>` : ""}
  </tbody></table><p class="muted" style="margin:0 0 8px">From ${p}'s quote${h.note ? `: ${esc(h.note)}` : ""}. Billed by ${p} under its own terms; not part of the Fenmorix totals.</p>`;
}
function serviceHtml(r, book) {
  const hosted = r.delivery !== "onprem";
  return `<table><tbody>
    <tr><td class="lab" style="width:30%">Delivery</td><td>${hosted ? `Hosted by our partner ${esc(SELLER.partner)}; Fenmorix maintains the software. <b>Hosting and compute are quoted separately by ${esc(SELLER.partner)}</b>, sized to your users and data.` : "On your own servers (on-premises license with yearly maintenance)"}</td></tr>
    <tr><td class="lab">Users</td><td>${r.members > 1 ? `${r.members} ${r.segment === "ps" ? "agencies" : "companies"} × ${r.users} users (${r.totalUsers} in all)` : `${r.users} users`}</td></tr>
    <tr><td class="lab">Environments</td><td>${esc(r.env.label)}${r.env.note ? ` <span class="muted">— ${esc(r.env.note)}</span>` : ""}${r.edition.includesTraining ? ` <span class="muted">(a training environment comes with ${esc(r.edition.label)})</span>` : ""}</td></tr>
    ${hosted ? `<tr><td class="lab">Backups &amp; recovery</td><td><b>${esc(r.dr.label)}</b>: ${esc(r.dr.backups)}. Target: back in service within ${esc(r.dr.rto)}; at most ${esc(r.dr.rpo)} of data lost. <span class="muted">The backup and standby servers for this tier are part of ${esc(SELLER.partner)}'s hosting quote.</span></td></tr>` : ""}
    <tr><td class="lab">Support</td><td><b>${esc(r.support.label)}</b>: ${esc(r.support.hours)}. Critical issues: response within ${esc(r.support.critical)}. Everything else: ${esc(r.support.normal)}.</td></tr>
    <tr><td class="lab">Updates</td><td>${hosted ? "New versions and security updates installed for you, with a rollback point before each one." : "New versions and security updates while maintenance is current."}</td></tr>
    <tr><td class="lab">Term</td><td>${esc(r.term.label)}; prices locked for ${r.term.lockYears} year${r.term.lockYears === 1 ? "" : "s"}, then ${pct(r.term.escalator)} a year.</td></tr>
  </tbody></table>`;
}
const rows = (lines, cls = "") => lines.map(l => `<tr class="${l.amount < 0 ? "disc" : cls}"><td>${esc(l.label)}</td><td class="n">${money(l.amount)}</td></tr>`).join("");

export function quoteHtml(q, client, opts = {}) {
  const r = q.result, book = q.book || {}, inp = q.inputs || {};
  useSeller(book);
  const primary = (client.contacts || []).find(c => c.primary) || (client.contacts || [])[0];
  const addr = [client.address, [client.city, client.state].filter(Boolean).join(", ") + (client.zip ? " " + client.zip : "")].filter(s => s && s.trim()).map(esc).join("<br>");
  const onPrem = r.onPremQuote;
  const sv = r.savings;
  const kpis = onPrem
    ? [["One-time license", money(onPrem.license)], ["Maintenance & support / year", money(onPrem.yearly)], ["One-time services", money(r.oneTimeTotal - onPrem.license)], [`${r.term.label} total`, money(r.contractValue)]]
    : [["Year-one subscription", money(r.year1Recurring)], ["One-time setup", money(r.oneTimeTotal)], [`${r.term.label} total`, money(r.contractValue)], ["Per user, per month", money(r.perUserMonth, true)]];
  const body = `
  ${header("QUOTE", `${esc(q.number)} · ${longDate(q.createdAt)}<br>Valid until ${longDate(q.validUntil)}`)}
  <div class="two">
    <div class="box"><div class="lab">Prepared for</div><b style="font-size:14px">${esc(client.name)}</b><br>${addr}${primary ? `<br><br>${esc(primary.name)}${primary.title ? `, ${esc(primary.title)}` : ""}<br>${[primary.email, primary.phone].filter(Boolean).map(esc).join(" · ")}` : ""}</div>
    <div class="box"><div class="lab">Prepared by</div><b style="font-size:14px">${esc(SELLER.name)}</b><br>${esc(SELLER.contact || q.createdBy || "")}<br>${[SELLER.email, SELLER.phone, SELLER.web].filter(Boolean).map(esc).join(" · ")}<br><br><span class="lab">Hosting &amp; support partner</span><br>${esc(SELLER.partner)} · ${esc(SELLER.partnerEmail)}</div>
  </div>
  <h2 style="margin-top:18px">${esc(q.title || `Fenmorix OS ${r.edition.label}`)}</h2>
  <p style="margin:0">${esc(r.edition.blurb || "")}</p>
  <div class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><span class="lab">${l}</span><b>${v}</b></div>`).join("")}</div>
  ${sv && sv.replaced ? `<div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div class="kpi save"><span class="lab">Software it replaces / year</span><b>${money(sv.replaced)}</b></div>
    <div class="kpi save"><span class="lab">Yearly difference${sv.hostingUnknown ? " (before hosting)" : sv.withHosting ? " (with hosting)" : ""}</span><b>${money(sv.yearly)}${sv.pct > 0 ? ` (${pct(sv.pct)})` : ""}</b></div><div class="kpi save"><span class="lab">First three years</span><b>${money(sv.threeYears)}</b></div></div>` : ""}
  ${q.notes ? `<div class="note">${nl(q.notes)}</div>` : ""}

  <h2>What's included</h2>
  ${modulesHtml(r.modules)}
  <h3>Service</h3>
  ${serviceHtml(r, book)}

  <h2 class="pb">Pricing</h2>
  ${onPrem ? `<h3>On-premises license</h3><table><tbody>
      <tr><td>Perpetual license (one time)</td><td class="n">${money(onPrem.license)}</td></tr>
      <tr><td>Yearly maintenance: updates and standard support (${pct(book.onPrem?.maintenancePct)} of the license)</td><td class="n">${money(onPrem.maintenance)}</td></tr>
      ${onPrem.supportUplift ? `<tr><td>${esc(r.support.label)} support</td><td class="n">${money(onPrem.supportUplift)}</td></tr>` : ""}
      ${(r.lines.customAnnual || []).length ? rows(r.lines.customAnnual) : ""}
      <tr class="tot"><td>Yearly, starting year one</td><td class="n">${money(onPrem.yearly)}</td></tr></tbody></table>`
    : `<h3>Yearly subscription</h3><table><thead><tr><th>Item</th><th class="n">Per year</th></tr></thead><tbody>
      ${rows(r.lines.recurring)}
      <tr class="tot"><td>List price per year</td><td class="n">${money(r.listAnnual)}</td></tr>
      ${rows(r.lines.yearly)}${rows(r.lines.customAnnual || [])}
      <tr class="tot"><td>Year one</td><td class="n">${money(r.year1Recurring)}</td></tr></tbody></table>`}
  ${r.lines.once.length ? `<h3>One-time</h3><table><thead><tr><th>Item</th><th class="n">Amount</th></tr></thead><tbody>${rows(r.lines.once)}
      <tr class="tot"><td>One-time total</td><td class="n">${money(r.lines.once.reduce((s, l) => s + l.amount, 0))}</td></tr></tbody></table>` : ""}
  ${r.hosting ? hostingHtml(r.hosting, r.dr) : ""}
  <h3>Year by year</h3>
  <table><thead><tr><th>Contract year</th><th class="n">${onPrem ? "Maintenance" : "Subscription"}</th><th class="n">One-time</th><th class="n">Total</th></tr></thead><tbody>
    ${r.schedule.map(s => `<tr${s.inTerm ? "" : ' class="muted"'}><td>Year ${s.year}${s.inTerm ? "" : " (renewal, for planning)"}</td><td class="n">${money(s.recurring)}</td><td class="n">${s.oneTime ? money(s.oneTime) : "—"}</td><td class="n">${money(s.total)}</td></tr>`).join("")}
    <tr class="tot"><td>${esc(r.term.label)} contract total</td><td></td><td></td><td class="n">${money(r.contractValue)}</td></tr></tbody></table>
  ${(r.notes || []).filter(n => !/quote by hand/i.test(n)).map(n => `<p class="muted" style="margin:3px 0">${esc(n)}</p>`).join("")}
  <p class="muted" style="margin:6px 0 0">Custom work beyond this quote: ${money(book.hourly?.custom)}/hour, or prepaid blocks of ${book.hourly?.prepaidHours} hours at ${money(book.hourly?.prepaidRate)}/hour. Prices in U.S. dollars; sales tax added where it applies.</p>

  <h2 class="pb">Terms and conditions</h2>
  <div class="terms">
    <p><b>Payment.</b> ${esc(book.paymentTerms || "")}</p>
    <p><b>This quote.</b> Valid until ${longDate(q.validUntil)}. Signing below accepts this quote and these terms, which together form the agreement between ${esc(SELLER.name)} and ${esc(client.name)}${inp.founding ? `, including the ${esc(book.founding?.label || "founding customer")} pricing shown` : ""}.</p>
    ${(book.termsSections || []).map(t => `<p><b>${esc(t.title)}.</b> ${nl(t.body)}</p>`).join("")}
  </div>
  <h2>Acceptance</h2>
  <div class="sig">
    <section><div class="lab">For ${esc(client.name)}</div><div>Signature</div><div>Printed name and title</div><div>Date</div></section>
    <section><div class="lab">For ${esc(SELLER.name)}</div><div>Signature</div><div>Printed name and title</div><div>Date</div></section>
  </div>
  ${footer(q.number)}`;
  return doc(`${q.number} ${client.name}`, body, opts.draft);
}

// The spec sheet's price table (also shown on the Spec sheets page)
export function specPrices(book, segKey, edKey) {
  const seg = book.segments[segKey], ed = seg.editions.find(e => e.key === edKey) || seg.editions[0];
  const partner = book.seller?.partner || "Avexon";
  if (segKey === "biz") return {
    head: ["", "Price"],
    rows: [["Per user, per month (billed yearly)", money(ed.perUserMonth)], ["Yearly minimum", money(ed.minYear)],
      ...seg.sizes.map(z => [`One-time implementation, ${z.label} (up to ${z.upTo} users)`, money(seg.implementation[z.key])])],
    note: `Hosting and compute are quoted separately by ${partner}. Multi-year terms are discounted.` };
  return {
    head: ["", ...seg.sizes.map(z => `${z.label} (up to ${z.upTo} users)`)],
    rows: [[`${ed.label}, per year`, ...seg.sizes.map(z => money(ed.prices[z.key]))], ["One-time implementation", ...seg.sizes.map(z => money(seg.implementation[z.key]))]],
    note: `One price per agency, by size. Above ${seg.quoteAbove} users, quoted. Hosting and compute are quoted separately by ${partner}. Multi-year terms are discounted.` };
}

// Spec sheet: what an edition includes and the service options (no prices unless asked)
export function specHtml(book, segKey, edKey, { prices = false } = {}) {
  useSeller(book);
  const seg = book.segments[segKey], ed = seg.editions.find(e => e.key === edKey) || seg.editions[0];
  const biz = segKey === "biz";
  const addons = book.addons.filter(a => a.segments.includes(segKey) && !(a.module && ed.modules.includes(a.module)));
  const sizes = seg.sizes;
  const round = n => Math.round(n);
  // Yearly software price at each size: public safety = the size's price; business = per user at the size's top, or the minimum
  const base = z => biz ? Math.max(ed.perUserMonth * 12 * z.upTo, ed.minYear) : ed.prices[z.key];
  const sizeHead = sizes.map(z => biz ? `${z.label} (${z.upTo} users)` : `${z.label} (up to ${z.upTo} users)`);
  const th = (cols, extra = []) => `<thead><tr>${cols.map((h, i) => `<th${i >= cols.length - extra.length ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>`;
  const n = v => `<td class="n">${v}</td>`;
  const pctCells = pct => sizes.map(z => n(pct ? `${money(round(base(z) * pct))}<span class="muted">/yr</span>` : "Included")).join("");
  const envPct = e => { const tr = (book.environments.find(x => x.key === "training") || {}).pct || 0;
    return ed.includesTraining ? (e.key === "training" ? 0 : e.key === "both" ? Math.max(0, e.pct - tr) : e.pct) : e.pct; };
  const partner = esc(SELLER.partner);

  const pricing = !prices ? "" : `<h2>Pricing</h2>
    <table>${th(["", ...sizeHead], sizeHead)}<tbody>
      <tr><td><b>${esc(ed.label)} software, per year</b>${biz ? `<span class="d">${money(ed.perUserMonth)} per user per month, billed yearly; yearly minimum ${money(ed.minYear)}</span>` : `<span class="d">One price per agency at each size</span>`}</td>${sizes.map(z => n(`<b>${money(base(z))}</b>`)).join("")}</tr>
      <tr><td>Per user, per month${biz ? "" : " (at the size's top)"}</td>${sizes.map(z => n(money(base(z) / z.upTo / 12, true))).join("")}</tr>
      <tr><td>One-time implementation<span class="d">Setup, branding, roles and permissions, staff training</span></td>${sizes.map(z => n(money(seg.implementation[z.key]))).join("")}</tr>
      <tr><td>Hosting and compute<span class="d">Sized to your users, data and recovery tier</span></td>${sizes.map(() => n(`Quoted by ${partner}`)).join("")}</tr>
    </tbody></table>
    <p class="muted" style="margin:0">${biz ? "" : `Above ${seg.quoteAbove} users, quoted. `}Prices in U.S. dollars, before term discounts. Hosting is billed by ${partner}.</p>`;

  const addonRows = addons.map(a => `<tr><td><b>${esc(a.label)}</b><span class="d">${esc(a.note || "")}</span></td>${prices
    ? sizes.map(z => n(`${money(a.prices[z.key])}<span class="muted">/yr${a.perUnit ? " each" : ""}</span>`)).join("") : ""}</tr>`).join("");
  const drRows = book.dr.map(d => `<tr><td><b>${esc(d.label)}</b><span class="d">${esc(d.backups)}. Back within ${esc(d.rto)}; at most ${esc(d.rpo)} of data lost.</span></td>${prices ? (d.pct || d.key === book.dr[0].key ? pctCells(d.pct) : sizes.map(() => n(`Hosting cost:<br><span class="muted">${partner} quote</span>`)).join("")) : ""}</tr>`).join("");
  const supRows = book.support.map(d => `<tr><td><b>${esc(d.label)}</b><span class="d">${esc(d.hours)}. Critical issues: ${esc(d.critical)}. Everything else: ${esc(d.normal)}.</span></td>${prices ? pctCells(d.pct) : ""}</tr>`).join("");
  const envRows = book.environments.map(e => `<tr><td><b>${esc(e.label)}</b><span class="d">${esc(e.note || (e.key === "none" ? "Your live system." : "Separate copies for training and for trying updates before they reach production."))}${ed.includesTraining && e.key === "training" ? ` Included with ${esc(ed.label)}.` : ""}</span></td>${prices ? pctCells(envPct(e)) : ""}</tr>`).join("");
  const cols = prices ? th(["", ...sizeHead], sizeHead) : "";
  const c = { existing: 2500, new: book.oneTime.cadIntegration ?? 7500, includedViews: 2, extraView: 1500, ...(book.oneTime.cad || {}) };
  const oneTime = !prices ? "" : `<h2>One-time services</h2><table>${th(["Service", "Price"], ["Price"])}<tbody>
    ${[["Implementation", sizes.map(z => `${z.label} ${money(seg.implementation[z.key])}`).join(" · ")],
      ["CAD connection, views already exist", `${money(c.existing)} per CAD`], ["CAD connection, new CAD vendor", `${money(c.new)} per CAD`],
      [`More standard CAD views (beyond the ${c.includedViews} included)`, `${money(c.extraView)} each`], ["Custom CAD views and queries", `${money(book.hourly.custom)}/hour`],
      ["Data migration from current systems", `${money(book.oneTime.migrationHourly)}/hour`], ["On-site training (plus travel)", `${money(book.oneTime.trainingDay)}/day`],
      ["Custom work: forms, workflows, reports, integrations", `${money(book.hourly.custom)}/hour`],
      [`Prepaid block of ${book.hourly.prepaidHours} hours`, `${money(book.hourly.prepaidHours * book.hourly.prepaidRate)} (${money(book.hourly.prepaidRate)}/hour)`],
    ].map(([a, b]) => `<tr><td>${esc(a)}</td>${n(b)}</tr>`).join("")}</tbody></table>
    <h2>Terms</h2><table>${th(["Term", "Discount", "Price lock", "Yearly increase after"], ["Discount", "Price lock", "Yearly increase after"])}<tbody>
    ${book.terms.map(t => `<tr><td><b>${esc(t.label)}</b></td>${n(t.discount ? `${Math.round(t.discount * 100)}%` : "—")}${n(`${t.lockYears} year${t.lockYears === 1 ? "" : "s"}`)}${n(`${Math.round(t.escalator * 100)}%`)}</tr>`).join("")}</tbody></table>
    <p class="muted" style="margin:0">${esc(book.founding.label)}: ${Math.round(book.founding.pct * 100)}% off for the first ${book.founding.years} years. ${esc(book.paymentTerms)}</p>`;

  const body = `
  ${header("SPEC SHEET", `Fenmorix OS ${esc(ed.label)} · ${esc(seg.label)}<br>${longDate()}`)}
  <h2 style="margin-top:18px">Fenmorix OS ${esc(ed.label)}</h2>
  <p style="margin:0 0 6px;font-size:13px">${esc(ed.blurb || "")}</p>${pricing}
  <h2>Modules included</h2>${modulesHtml(ed.modules)}
  ${addons.length ? `<h2>Add-ons</h2><table>${cols}<tbody>${addonRows}</tbody></table>` : ""}
  <h2>Backup and disaster recovery</h2><table>${cols}<tbody>${drRows}</tbody></table>
  ${prices ? `<p class="muted" style="margin:-4px 0 8px">The servers, second region and standby behind each tier are part of ${partner}'s hosting quote; higher tiers cost more to host.</p>` : ""}
  <h2>Support</h2><table>${cols}<tbody>${supRows}</tbody></table>
  <h2>Environments</h2><table>${cols}<tbody>${envRows}</tbody></table>
  ${oneTime}
  <h2>Platform</h2>
  <table><tbody>
    <tr><td class="lab" style="width:30%">Hosting</td><td>Hosted by our partner ${partner}, or on your own servers (Linux or Windows). Hosting and compute are quoted separately by ${partner}, sized to your users, data and recovery tier.</td></tr>
    <tr><td class="lab">Security</td><td>Encrypted connections, sensitive fields encrypted at rest, two-step sign-in for administrators, role- and group-based permissions, an audit log that can't be edited.</td></tr>
    <tr><td class="lab">Your brand</td><td>Your name, logo, colors and menu names; your own web address.</td></tr>
    <tr><td class="lab">Works on</td><td>Any current browser on desktops, tablets and phones; installs as an app; push notifications; TV display screens.</td></tr>
    <tr><td class="lab">Made to fit</td><td>Modules can be added at any time; custom forms, workflows, reports and integrations are built for you.</td></tr>
    ${book.group ? `<tr><td class="lab">Groups</td><td>Several ${biz ? "companies" : "agencies"} on one system: each keeps its own data, with shared sign-in, messaging and combined reports.</td></tr>` : ""}
  </tbody></table>
  ${footer(prices ? "Prices good for " + book.quoteValidDays + " days" : "Contact us for a quote")}`;
  return doc(`Fenmorix OS ${ed.label} spec sheet`, body);
}

function doc(title, body, draft) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${draft ? `body::before { content: "DRAFT"; position: fixed; top: 40%; left: 18%; font-size: 120px; color: rgba(200,77,0,.08); transform: rotate(-24deg); font-weight: 900; }` : ""}</style></head><body>${body}</body></html>`;
}

// Print through a hidden iframe once the logo has loaded
export async function printHtml(build) {
  await loadLogo();
  const html = typeof build === "function" ? build() : build;
  let f = document.getElementById("sales-print-frame");
  if (!f) { f = document.createElement("iframe"); f.id = "sales-print-frame"; Object.assign(f.style, { position: "fixed", right: 0, bottom: 0, width: 0, height: 0, border: 0 }); document.body.appendChild(f); }
  const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  const go = () => { f.contentWindow.focus(); f.contentWindow.print(); };
  const imgs = [...d.images].filter(i => !i.complete);
  if (!imgs.length) return setTimeout(go, 150);
  let left = imgs.length; const one = () => { if (--left === 0) setTimeout(go, 100); };
  imgs.forEach(i => { i.onload = one; i.onerror = one; });
  setTimeout(() => { if (left > 0) { left = 0; go(); } }, 4000);
}
