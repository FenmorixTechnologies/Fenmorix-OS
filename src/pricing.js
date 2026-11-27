// Fenmorix pricing engine (module "sales"): the price book's defaults and calculate(), shared by the quote builder (src/Sales.jsx)
// and the server (server/sales.js), so a saved quote's numbers are always recomputed the same way. Every number in DEFAULT_BOOK is
// a starting point Michael edits on the Price book page; the book in use is stored in settings key 'sales_pricebook'.
//
// Model: an annual subscription (hosting, updates and standard support included) per organization, by segment (public safety =
// flat price by size tier; business = per user per month with a yearly minimum) and edition; add-ons; percentage options for extra
// environments, disaster recovery and support; one-time fees; group (multi-agency / family of companies) pricing; term discounts,
// price lock and yearly increases; an on-premises perpetual license with yearly maintenance as the alternative.

// ---- What each module costs on its own (idea 11/2026: price modules individually; build-your-own bundles cost more).
// flat {s, m, l} = yearly at public-safety size tiers (government and schools multiply by their segment's factor);
// user = business per user per month; impl = implementation weight (how much setup and training the module takes).
// Every ready-made edition costs exactly the sum of its modules here, so a bundle's price can be broken down module by module;
// a build-your-own set costs that sum plus book.custom.premiumPct.
import { MODULES } from "./modules.js";
const moduleName = k => MODULES.find(m => m.key === k)?.name || k;
export const MODULE_PRICES = {
  messaging:      { flat: { s: 1500, m: 3000, l: 6000 }, user: 4,   impl: 1 },
  timeclock:      { flat: { s: 1200, m: 2400, l: 4800 }, user: 4,   impl: 1.5 },
  offwork:        { flat: { s: 600,  m: 1200, l: 2400 }, user: 2,   impl: 0.5 },
  callout:        { flat: { s: 600,  m: 1200, l: 2400 }, user: 3,   impl: 0.5 },
  forms:          { flat: { s: 1500, m: 3000, l: 6000 }, user: 2,   impl: 2 },
  meetings:       { flat: { s: 600,  m: 1200, l: 2400 }, user: 0.5, impl: 0.5 },
  leave:          { flat: { s: 800,  m: 1800, l: 3400 }, user: 1.5, impl: 1.5 },
  forceback:      { flat: { s: 400,  m: 900,  l: 1700 }, user: 1,   impl: 0.5 },
  sick:           { flat: { s: 600,  m: 1400, l: 2600 }, user: 2,   impl: 1 },
  training:       { flat: { s: 1200, m: 2900, l: 5300 }, user: 7,   impl: 2 },
  procurement:    { flat: { s: 1400, m: 3300, l: 6100 }, user: 2,   impl: 2 },
  reimbursements: { flat: { s: 600,  m: 1400, l: 2600 }, user: 1,   impl: 1 },
  helpdesk:       { flat: { s: 500,  m: 1200, l: 2200 }, user: 1,   impl: 0.5 },
  gear:           { flat: { s: 500,  m: 1100, l: 2100 }, user: 1,   impl: 1 },
  links:          { flat: { s: 300,  m: 600,  l: 1200 }, user: 0.5, impl: 0.5 },
  activecalls:    { flat: { s: 1000, m: 2400, l: 4400 }, user: 2,   impl: 1.5, segments: ["ps", "gov"] },
  callalerts:     { flat: { s: 500,  m: 1200, l: 2200 }, user: 1,   impl: 0.5, segments: ["ps", "gov"] },
  command:        { flat: { s: 1200, m: 2800, l: 5200 }, user: 3,   impl: 1.5 },
  imt:            { flat: { s: 800,  m: 1900, l: 3500 }, user: 2,   impl: 1 },
  recall:         { flat: { s: 900,  m: 2100, l: 3900 }, user: 2,   impl: 1 },
  recordings:     { flat: { s: 600,  m: 1400, l: 2600 }, user: 2,   impl: 1, segments: ["ps", "gov"] },
  stats:          { flat: { s: 1000, m: 2400, l: 4400 }, user: 3,   impl: 2, segments: ["ps", "gov"] },
  board:          { flat: { s: 600,  m: 1400, l: 2600 }, user: 2,   impl: 1 },
  pial:           { flat: { s: 800,  m: 1900, l: 3500 }, user: 2,   impl: 2, segments: ["ps"] },
  fireprev:       { flat: { s: 600,  m: 1500, l: 2700 }, user: 2,   impl: 1, segments: ["ps", "gov"] },
  evals:          { flat: { s: 3000, m: 5000, l: 8000 }, user: 3,   impl: 1.5 },
  investigations: { flat: { s: 5000, m: 7500, l: 10000 }, user: 5,  impl: 2, segments: ["ps", "gov"] },
  spot:           { flat: { s: 1200, m: 1200, l: 1800 }, user: 1,   impl: 0.5, segments: ["biz"] },
};
const sumFlat = (mods, factor = 1) => Object.fromEntries(["s", "m", "l"].map(z => [z, Math.round(mods.reduce((t, k) => t + (MODULE_PRICES[k]?.flat[z] || 0), 0) * factor / 100) * 100]));
const GOV_ESS = ["messaging", "timeclock", "offwork", "callout", "forms", "meetings"];
const GOV_OPS = [...GOV_ESS, "sick", "leave", "forceback", "training", "procurement", "reimbursements", "helpdesk", "gear", "board"];
const GOV_ALL = [...GOV_OPS, "recall", "imt", "command", "callalerts", "activecalls", "fireprev", "links"];
const EDU_ESS = ["messaging", "recall", "timeclock", "offwork", "forms", "meetings"];
const EDU_CAMPUS = [...EDU_ESS, "sick", "procurement", "reimbursements", "helpdesk", "gear", "training", "board"];
const EDU_ALL = [...EDU_CAMPUS, "callout", "imt", "command", "evals", "links"];

export const DEFAULT_BOOK = {
  version: 1,
  segments: {
    ps: {
      label: "Public safety", unit: "agency", units: "agencies",
      sizes: [{ key: "s", label: "Small", upTo: 25 }, { key: "m", label: "Mid-size", upTo: 100 }, { key: "l", label: "Large", upTo: 300 }],
      quoteAbove: 300,
      editions: [
        { key: "essentials", label: "Essentials", blurb: "The daily basics for every member: messages, time, who's out, forms.",
          modules: ["messaging", "timeclock", "offwork", "callout", "forms", "meetings"], prices: { s: 6000, m: 12000, l: 24000 } },
        { key: "operations", label: "Operations", blurb: "Everything to run staffing, training, purchasing and equipment.",
          modules: ["messaging", "timeclock", "offwork", "callout", "forms", "meetings", "leave", "forceback", "sick", "training",
            "procurement", "reimbursements", "helpdesk", "gear"], prices: { s: 12000, m: 26000, l: 50000 } },
        { key: "command", label: "Command", blurb: "Operations plus live calls, incident command, ICS plans, recall and analytics.",
          modules: ["messaging", "timeclock", "offwork", "callout", "forms", "meetings", "leave", "forceback", "sick", "training",
            "procurement", "reimbursements", "helpdesk", "gear", "activecalls", "callalerts", "command", "imt", "recall", "recordings",
            "stats", "board", "pial", "fireprev"], prices: { s: 20000, m: 45000, l: 85000 }, includesTraining: true },
      ],
      implementation: { s: 3000, m: 7500, l: 15000 },
    },
    biz: {
      label: "Business", unit: "company", units: "companies",
      sizes: [{ key: "s", label: "Small", upTo: 10 }, { key: "m", label: "Mid-size", upTo: 50 }, { key: "l", label: "Large", upTo: 250 }],
      quoteAbove: 250,
      editions: [
        { key: "team", label: "Team", blurb: "Time clock, schedules, who's out and team messaging.",
          modules: ["messaging", "timeclock", "offwork", "sick"], perUserMonth: 12, minYear: 1800 },
        { key: "business", label: "Business", blurb: "Team plus forms and approvals, purchasing, help desk, equipment and shared logins.",
          modules: ["messaging", "timeclock", "offwork", "sick", "forms", "procurement", "reimbursements", "helpdesk", "gear", "meetings", "links"],
          perUserMonth: 20, minYear: 4000 },
        { key: "complete", label: "Complete", blurb: "Every business module, training records and on-call lists.",
          modules: ["messaging", "timeclock", "offwork", "sick", "forms", "procurement", "reimbursements", "helpdesk", "gear", "meetings", "links",
            "training", "callout"], perUserMonth: 30, minYear: 7500, includesTraining: true },
      ],
      implementation: { s: 1500, m: 3500, l: 7500 },
    },
    // Government and schools: a flat price by staff size, or per staff user (pricing "perUser": users × perUserYear, at least the
    // Small price). Extra people who only need a little of the system (students; volunteers and part-timers) are added either per
    // person at a fraction of the staff rate, or as a flat price by how many there are (audience).
    gov: {
      label: "Government", unit: "organization", units: "organizations", factor: 1.4, perUser: true,
      sizes: [{ key: "s", label: "Small", upTo: 50 }, { key: "m", label: "Mid-size", upTo: 250 }, { key: "l", label: "Large", upTo: 1000 }],
      quoteAbove: 1000,
      editions: [
        { key: "essentials", label: "Essentials", blurb: "Messages, time and schedules, who's out, on-call lists, forms and meetings.", modules: GOV_ESS, prices: sumFlat(GOV_ESS, 1.4) },
        { key: "operations", label: "Operations", blurb: "Essentials plus attendance, leave, overtime rotation, training, purchasing, reimbursements, help desk, equipment and council reports.", modules: GOV_OPS, prices: sumFlat(GOV_OPS, 1.4) },
        { key: "complete", label: "Complete", blurb: "Operations plus emergency notification, incident plans and command, dispatch alerts and inspections.", modules: GOV_ALL, prices: sumFlat(GOV_ALL, 1.4), includesTraining: true },
      ],
      implementation: { s: 4000, m: 9000, l: 18000 },
      audience: { key: "public", label: "Volunteers and part-time users", perUserYear: 8, tiers: [{ upTo: 100, price: 600 }, { upTo: 500, price: 2400 }, { upTo: 2000, price: 6000 }],
        note: "People who only need messages, forms and their own schedule (volunteers, seasonal and part-time staff)." },
    },
    edu: {
      label: "Education", unit: "school", units: "schools", factor: 1.2, perUser: true,
      sizes: [{ key: "s", label: "Small", upTo: 75 }, { key: "m", label: "Mid-size", upTo: 300 }, { key: "l", label: "Large", upTo: 1500 }],
      quoteAbove: 1500,
      editions: [
        { key: "essentials", label: "Essentials", blurb: "Campus alerts and safety check-in, messages, schedules, who's out, forms and parent conferences.", modules: EDU_ESS, prices: sumFlat(EDU_ESS, 1.2) },
        { key: "campus", label: "Campus", blurb: "Essentials plus absence patterns, purchasing, reimbursements, help desk, equipment, teacher certifications and board reports.", modules: EDU_CAMPUS, prices: sumFlat(EDU_CAMPUS, 1.2) },
        { key: "complete", label: "Complete", blurb: "Campus plus on-call lists, emergency plans and crisis command, evaluations and shared logins.", modules: EDU_ALL, prices: sumFlat(EDU_ALL, 1.2), includesTraining: true },
      ],
      implementation: { s: 3000, m: 7000, l: 14000 },
      audience: { key: "students", label: "Students", perUserYear: 3, tiers: [{ upTo: 500, price: 1200 }, { upTo: 2000, price: 3600 }, { upTo: 6000, price: 8000 }],
        note: "Students get alerts, their schedule, forms to fill in and (soon) their grades." },
    },
  },
  modulePrices: MODULE_PRICES,
  custom: { label: "Build your own", premiumPct: 0.20, minImplementationPct: 0.3,
    note: "Any modules, priced one by one at the bundle rate plus a premium; a ready-made edition with the same modules costs less." },
  addons: [
    { key: "investigations", label: "Investigations (CJIS)", module: "investigations", segments: ["ps", "gov"], prices: { s: 5000, m: 7500, l: 10000 },
      note: "Case files under CJIS controls: authenticator sign-in, need-to-know access, access log." },
    { key: "evals", label: "Evaluations & Simulations", module: "evals", segments: ["ps", "biz", "gov", "edu"], prices: { s: 3000, m: 5000, l: 8000 },
      note: "Scored evaluations, task books and AI role-play simulations." },
    { key: "spot", label: "Live Spot Prices", module: "spot", segments: ["biz"], prices: { s: 1200, m: 1200, l: 1800 },
      note: "Precious-metals prices on every page and a showroom TV view (price feed subscription billed by its provider)." },
    { key: "screens", label: "Extra display screens (per 5)", module: "", segments: ["ps", "biz", "gov", "edu"], prices: { s: 600, m: 600, l: 600 }, perUnit: true,
      note: "Two TV display screens are included; each block of five more." },
  ],
  environments: [
    { key: "none", label: "Production only", pct: 0 },
    { key: "training", label: "Production + training", pct: 0.15, note: "A copy with practice data so new people can't change real records." },
    { key: "test", label: "Production + test", pct: 0.15, note: "Try updates and settings before they reach production." },
    { key: "both", label: "Production + training + test", pct: 0.25 },
  ],
  dr: [
    // The recovery tier sets the target; the servers, second region and standby behind it are Avexon's hosting, priced by Avexon.
    // pct = Fenmorix's own fee for the tier (0 = none), on top of the software.
    { key: "standard", label: "Standard", pct: 0, backups: "Every 6 hours, plus nightly server snapshots, kept 14–30 days", rto: "24 hours", rpo: "6 hours" },
    { key: "enhanced", label: "Enhanced", pct: 0, backups: "Hourly, plus a copy in a second region", rto: "4 hours", rpo: "1 hour" },
    { key: "ha", label: "High availability", pct: 0, backups: "Standby server in a second region, kept in sync", rto: "1 hour", rpo: "Minutes" },
  ],
  support: [
    { key: "standard", label: "Standard", pct: 0, hours: "Monday–Friday, 8 a.m.–5 p.m. Central", critical: "4 business hours", normal: "Next business day" },
    { key: "priority", label: "Priority", pct: 0.15, hours: "Monday–Friday, 8 a.m.–5 p.m. Central", critical: "1 hour", normal: "4 business hours" },
    { key: "247", label: "24/7 Critical", pct: 0.25, hours: "Around the clock for outages; business hours for everything else", critical: "1 hour, any time", normal: "4 business hours" },
  ],
  oneTime: { cadIntegration: 7500, migrationHourly: 150, trainingDay: 1500, groupSetup: 5000, additionalMemberImplementation: 0.4,
    // CAD: "existing" = a CAD we already have SQL views for (same vendor/version, or a shared regional CAD already connected): install our
    // views, map and test. "new" = a CAD vendor not integrated before: learn its database, build and test the views. Each includes
    // `includedViews` standard views (active calls + call statistics); more standard views (apparatus/unit times, a master incident list
    // for reports...) are `extraView` each; custom views / queries are billed by the hour at hourly.custom.
    cad: { existing: 2500, new: 7500, includedViews: 2, extraView: 1500 } },
  group: {
    discounts: [{ min: 2, pct: 0.10 }, { min: 4, pct: 0.15 }, { min: 7, pct: 0.20 }],
    platformFees: [{ min: 2, fee: 8000 }, { min: 6, fee: 15000 }],
    quoteAbove: 10,
    familyPerCompanyMonth: 150,
    familyDiscounts: [{ min: 3, pct: 0.10 }, { min: 6, pct: 0.15 }],
  },
  terms: [
    { years: 1, label: "1 year", discount: 0, lockYears: 1, escalator: 0.05 },
    { years: 3, label: "3 years", discount: 0.10, lockYears: 3, escalator: 0.05 },
    { years: 5, label: "5 years", discount: 0.15, lockYears: 3, escalator: 0.04 },
  ],
  founding: { pct: 0.25, years: 3, label: "Founding customer" },
  onPrem: { licenseMultiple: 2.75, maintenancePct: 0.2 },
  hourly: { custom: 165, prepaidHours: 20, prepaidRate: 135 },
  // What departments pay today for software Fenmorix OS can replace, from public contracts and published prices (11/2026).
  // basis "user" = per user per year (× the quote's users); "flat" = per year by size {s, m, l}. setup = their one-time fee, if known.
  // Starting points for the "Software it replaces" lines; always confirm the customer's real invoice.
  marketRates: [
    { key: "aladtec", label: "Aladtec (staff scheduling)", replaces: "Time Clock, Work Schedule, Who's Out", basis: "user", annual: 81,
      source: "Willowick, OH quote 2026: 71 users, $5,759.55/yr ($81.12/user)" },
    { key: "vector-lms", label: "Vector Solutions LMS (training records)", replaces: "Training", basis: "user", annual: 115,
      source: "Santa Fe County, NM order 2026: $113–$118 per member/yr, +3%/yr" },
    { key: "vector-checkit", label: "Vector Check It (equipment & PPE checks)", replaces: "Equipment & Asset Tracking", basis: "user", annual: 62,
      source: "Santa Fe County, NM order 2026: $61.74 per person/yr" },
    { key: "pstrax", label: "PSTrax (apparatus checks, SCBA, PPE, assets)", replaces: "Equipment & Asset Tracking", basis: "flat", annual: { s: 6000, m: 9950, l: 15900 }, setup: { s: 5000, m: 8000, l: 15900 },
      source: "Troy, MI 2021: $9,950/yr (7 stations); Berkeley, CA 2022: $15,900/yr + $15,900 implementation" },
    { key: "firstdue", label: "First Due (suite, not counting its RMS)", replaces: "Inspections, preplans, training, assets, personnel", basis: "flat", annual: { s: 8750, m: 15000, l: 120000 },
      source: "Olivette, MO 2024: $8,750/yr; Truckee Meadows FPD, NV 2021: $15,000/yr; Baton Rouge FD 2022: $120,000/yr (15 modules), up to 5%/yr" },
    { key: "fireworks", label: "FireWorks modules (not NFIRS reporting)", replaces: "Inspections, investigations, preplans, inventory, analytics, CAD interface", basis: "flat", annual: { s: 18440, m: 18440, l: 18440 },
      source: "Apex, NC quote: $18,440/yr for inspections, investigations, preplan, inventory, analytics, CAD interface, cloud; +5%/yr" },
    { key: "jotform", label: "Jotform (forms)", replaces: "Forms & Case Management", basis: "flat", annual: { s: 1188, m: 1188, l: 1188 },
      source: "jotform.com: Gold $99/mo billed yearly, one user (HIPAA needs Gold or Enterprise)" },
    { key: "active911", label: "Active911 (alerting)", replaces: "Dispatch Alerts, Emergency Recall", basis: "user", annual: 16.65,
      source: "active911.com: $16.65 per device/yr (1–50 devices)" },
    { key: "iamresponding", label: "IamResponding (response & recall)", replaces: "Dispatch Alerts, Emergency Recall", basis: "flat", annual: { s: 349, m: 700, l: 1500 },
      source: "iamresponding.com: from $349/yr; larger departments quoted" },
    { key: "everbridge", label: "Everbridge (mass notification / recall)", replaces: "Emergency Recall, Messaging", basis: "flat", annual: { s: 6250, m: 15000, l: 30000 },
      source: "Big Horn Co., MT $6,250/yr; Fillmore Co., MN $6,257/yr; Allegany Co., MD $28,792/yr" },
    { key: "tabletcommand", label: "Tablet Command (incident command)", replaces: "Incident Command Board", basis: "flat", annual: { s: 31000, m: 31000, l: 31000 }, setup: { s: 15500, m: 15500, l: 15500 },
      source: "Placentia, CA: $31,000/yr + $15,500 one-time (6 apparatus)" },
    { key: "firstwatch", label: "FirstWatch (CAD analytics dashboards)", replaces: "Dispatch Center Analytics, Board Reports", basis: "flat", annual: { s: 42700, m: 42700, l: 42700 }, setup: { s: 86644, m: 86644, l: 86644 },
      source: "2025 resolution (ecode360 BL4015): $3,559.07/month + $86,644.29 project initiation" },
    { key: "cleargov", label: "ClearGov (budgeting)", replaces: "Purchasing & Requisitions, Board Reports", basis: "flat", annual: { s: 13000, m: 15000, l: 48000 }, setup: { s: 6000, m: 8500, l: 8500 },
      source: "Johnstown, OH ~$13,000/yr + $6,000 setup; Freetown, MA ~$15,000/yr + $8,500; Mercer Co., PA $48,305" },
    { key: "procurify", label: "Procurify (requisitions & purchasing)", replaces: "Purchasing & Requisitions, Expense Reimbursements", basis: "flat", annual: { s: 4210, m: 15000, l: 40000 },
      source: "Vendr buyer data: median $15,000/yr, range $4,210–$40,000" },
    { key: "otter", label: "Otter.ai Business (transcription)", replaces: "Radio Recordings & Transcripts", basis: "user", annual: 240,
      source: "otter.ai: Business $19.99/user/month billed yearly (count only the people who'd use it)" },
    { key: "slack", label: "Slack Pro (team messaging)", replaces: "Messaging & Chat", basis: "user", annual: 96,
      source: "Vendr: companies pay about $7.25–$8.70/user/month" },
    { key: "deputy", label: "Deputy (business time clock & scheduling)", replaces: "Time Clock, Work Schedule", basis: "user", annual: 78,
      source: "deputy.com: Core $6.50/user/month" },
    { key: "powerbi", label: "Power BI Pro (dashboards)", replaces: "Dispatch Center Analytics, Board Reports", basis: "user", annual: 168,
      source: "Microsoft list price $14/user/month since April 2025 (count only report builders/viewers)" },
  ],
  quoteValidDays: 30,
  seller: { name: "Fenmorix Technologies, LLC", email: "michael@fenmorix.com", phone: "", web: "fenmorix.com",
    place: "Baton Rouge, Louisiana", partner: "Avexon", partnerEmail: "solutions@avexon.com" },
  paymentTerms: "Annual fees are invoiced in advance at the start of each contract year; one-time fees are invoiced 50% at signing and 50% at go-live. Payment is due within 30 days of invoice.",
  // Starting language only. Have an attorney review before any customer signs.
  termsSections: [
    { title: "Subscription", body: "Fenmorix Technologies, LLC (\"Fenmorix\") grants the Customer a non-exclusive, non-transferable right to use Fenmorix OS and the modules listed in this quote for the Customer's internal operations during the subscription term, for the number of users shown." },
    { title: "Hosting, updates and support", body: "The subscription includes security updates, new versions of the licensed modules, and support at the tier shown. Hosting, compute, storage and the backup and recovery infrastructure for the tier shown are not included in Fenmorix's fees: they are provided and quoted by Fenmorix's hosting partner, Avexon, based on the number of users, the amount of data kept and the recovery tier chosen, under Avexon's own quote and terms, unless the Customer runs the software on its own servers." },
    { title: "Customer data", body: "The Customer owns its data. Fenmorix accesses Customer data only to provide, support and secure the service. On request at the end of the term, Fenmorix provides a full export of the Customer's data in a standard format within 30 days, after which it is deleted from Fenmorix's systems." },
    { title: "Security", body: "Fenmorix OS encrypts data in transit, encrypts sensitive fields at rest, requires two-step sign-in for administrators, and keeps an audit log that cannot be edited. Fenmorix notifies the Customer without undue delay of any security incident affecting Customer data." },
    { title: "Price changes", body: "Prices are fixed for the price-lock period shown. After it, subscription fees increase each contract year by the percentage shown in this quote." },
    { title: "Feature requests and custom work", body: "Feature requests that benefit all customers may be added to the product at Fenmorix's discretion at no charge. Custom work for the Customer is quoted separately or billed at the hourly rate shown. Fenmorix retains ownership of all software it develops, including custom work, and grants the Customer the same rights to it as to the rest of the software." },
    { title: "Term and renewal", body: "The subscription runs for the term shown and renews for successive one-year periods unless either party gives written notice at least 60 days before the end of the current term. Public agencies whose funding is appropriated yearly may end the subscription at the end of any fiscal year for which funds are not appropriated, with written notice." },
    { title: "Limitation of liability", body: "Each party's total liability under this agreement is limited to the fees paid by the Customer in the twelve months before the claim, except for a party's obligations regarding confidentiality and data security. Neither party is liable for indirect or consequential damages." },
    { title: "Governing law", body: "This agreement is governed by the laws of the State of Louisiana." },
  ],
};

const round = n => Math.round(n * 100) / 100;
const pctOf = (list, key) => (list.find(x => x.key === key) || list[0]);
const bracket = (rows, n, field) => rows.filter(r => n >= r.min).sort((a, b) => b.min - a.min)[0]?.[field] || 0;

// The size tier for a user count in a segment
export function sizeFor(seg, users) {
  const s = seg.sizes.find(z => users <= z.upTo);
  return s || seg.sizes[seg.sizes.length - 1];
}

export const DEFAULT_INPUTS = {
  segment: "ps", users: 40, edition: "operations", addons: [], screens: 0, environments: "none", dr: "standard", support: "standard",
  termYears: 3, founding: false, delivery: "hosted", members: 1, implementation: true, cadIntegrations: 0, cadKind: "none", cadSystems: 1, cadVendor: "", cadExtraViews: 0, cadCustomHours: 0, migrationHours: 0,
  trainingDays: 0, prepaidBlocks: 0, manualDiscount: 0, customLines: [], currentSpend: [],
  hostingAnnual: 0, hostingOneTime: 0, hostingNote: "",   // Avexon's figures when known (shown apart; never in Fenmorix's totals)
  modules: [],                       // edition "custom": the modules picked one by one
  pricing: "flat",                   // government / schools: "flat" by size or "perUser" (staff users)
  audienceMode: "none", audienceCount: 0,   // students (schools) / volunteers and part-timers (government): "perUser" | "flat"
};
// Which modules can be picked one by one in a segment
export const modulesFor = (segment, book = DEFAULT_BOOK) => {
  const MP = { ...MODULE_PRICES, ...(book.modulePrices || {}) };
  return Object.keys(MP).filter(k => !MP[k].segments || MP[k].segments.includes(segment)).map(k => ({ key: k, label: moduleName(k), ...MP[k] }));
};

// inputs -> { size, lines, annual, oneTime, schedule, totals, notes }. Never throws on missing values; uses the book's first options.
export function calculate(inputs, book = DEFAULT_BOOK) {
  const i = { ...DEFAULT_INPUTS, ...(inputs || {}) };
  const seg = book.segments[i.segment] || book.segments.ps;
  const MP = { ...MODULE_PRICES, ...(book.modulePrices || {}) };
  const custom = i.edition === "custom";
  const offeredMod = k => MP[k] && (!MP[k].segments || MP[k].segments.includes(i.segment));
  const ed = custom ? { key: "custom", label: book.custom?.label || "Build your own", modules: [...new Set((i.modules || []).filter(offeredMod))], custom: true }
    : seg.editions.find(e => e.key === i.edition) || seg.editions[0];
  const members = Math.max(1, Math.min(50, Math.round(Number(i.members) || 1)));
  const users = Math.max(1, Math.round(Number(i.users) || 1));
  const size = sizeFor(seg, users);
  const onPrem = i.delivery === "onprem";
  const isBiz = i.segment === "biz";
  const notes = [];
  if (users > seg.quoteAbove) notes.push(`Over ${seg.quoteAbove} users per ${seg.unit}: priced at the ${size.label} rate here; quote by hand.`);
  if (members > book.group.quoteAbove) notes.push(`More than ${book.group.quoteAbove} members: regional pricing is quoted by hand.`);

  // ---- Recurring software (per member), then the group
  const annual = [];
  let perMember;
  const prem = 1 + (Number(book.custom?.premiumPct) || 0);
  const factor = Number(seg.factor) || 1;
  const perUserMode = !isBiz && !!seg.perUser && i.pricing === "perUser";
  const edName = custom ? `${ed.label} (${ed.modules.length} module${ed.modules.length === 1 ? "" : "s"}, priced one by one)` : `${ed.label} edition`;
  if (custom && !ed.modules.length) notes.push("Build your own: pick the modules.");
  if (isBiz) {
    const rate = custom ? round(ed.modules.reduce((t, k) => t + MP[k].user, 0) * prem) : ed.perUserMonth;
    const min = custom ? (ed.modules.length ? seg.editions[0]?.minYear || 0 : 0) : ed.minYear;
    perMember = Math.max(round(users * rate * 12), min);
    annual.push({ key: "edition", label: `${edName}: ${users} users × ${money(rate, rate % 1 !== 0)}/user/month${users * rate * 12 < min ? " (yearly minimum)" : ""}`, amount: perMember, each: members > 1 });
  } else {
    const prices = custom ? Object.fromEntries(["s", "m", "l"].map(z => [z, Math.round(ed.modules.reduce((t, k) => t + MP[k].flat[z], 0) * factor * prem / 100) * 100])) : ed.prices;
    if (perUserMode) {
      const mid = seg.sizes[1] || seg.sizes[0];
      const rate = Number(ed.perUserYear) || Math.round(prices[mid.key] / mid.upTo * 100) / 100;
      perMember = Math.max(round(users * rate), prices.s);
      annual.push({ key: "edition", label: `${edName}: ${users} staff users × ${money(rate, rate % 1 !== 0)}/user/year${users * rate < prices.s ? " (at least the Small price)" : ""}`, amount: perMember, each: members > 1 });
    } else {
      perMember = prices[size.key];
      annual.push({ key: "edition", label: `${edName}, ${size.label} (${users} ${seg.audience ? "staff " : ""}users)`, amount: perMember, each: members > 1 });
    }
  }
  const editionSoftware = perMember;
  // Students / volunteers: per person at a fraction of the staff rate, or a flat price by how many
  const aud = seg.audience, ac = Math.max(0, Math.round(Number(i.audienceCount) || 0));
  if (aud && ac && ["perUser", "flat"].includes(i.audienceMode)) {
    if (i.audienceMode === "flat") {
      const last = aud.tiers[aud.tiers.length - 1], t = aud.tiers.find(x => ac <= x.upTo) || last;
      if (ac > last.upTo) notes.push(`More than ${last.upTo} ${aud.label.toLowerCase()}: priced at the top flat rate here; quote by hand.`);
      annual.push({ key: "audience", label: `${aud.label}: ${ac.toLocaleString("en-US")} (flat price, up to ${t.upTo.toLocaleString("en-US")})`, amount: t.price, each: members > 1 });
    } else annual.push({ key: "audience", label: `${aud.label}: ${ac.toLocaleString("en-US")} × ${money(aud.perUserYear, aud.perUserYear % 1 !== 0)}/year`, amount: round(ac * aud.perUserYear), each: members > 1 });
  }
  for (const k of i.addons || []) {
    const a = book.addons.find(x => x.key === k);
    if (!a || !a.segments.includes(i.segment)) continue;
    if (a.module && ed.modules.includes(a.module)) continue;
    if (a.perUnit) {
      const n = Math.max(0, Math.round(Number(i.screens) || 0));
      if (!n) continue;
      annual.push({ key: a.key, label: `${a.label} × ${n}`, amount: a.prices[size.key] * n, each: members > 1 });
    } else annual.push({ key: a.key, label: a.label, amount: a.prices[size.key], each: members > 1 });
  }
  const softwareEach = annual.reduce((s, l) => s + l.amount, 0);
  let software = softwareEach * members;
  const discounts = [];
  if (members > 1) {
    const gp = isBiz ? bracket(book.group.familyDiscounts, members, "pct") : bracket(book.group.discounts, members, "pct");
    if (gp) discounts.push({ key: "group", label: `${isBiz ? "Family of companies" : i.segment === "ps" ? "Multi-agency group" : "Group"} discount (${members} ${seg.units || seg.unit + "s"}, ${Math.round(gp * 100)}%)`, pct: gp, on: "software" });
  }
  const groupPct = discounts.find(d => d.key === "group")?.pct || 0;
  const softwareNet = software * (1 - groupPct);
  const recurring = [];
  recurring.push({ key: "software", label: members > 1 ? `Software for ${members} ${seg.units || seg.unit + "s"} (each: ${money(softwareEach)})` : "Software subscription", amount: round(software) });
  if (groupPct) recurring.push({ key: "group", label: discounts[0].label, amount: round(-software * groupPct) });
  if (members > 1) {
    const fee = isBiz ? book.group.familyPerCompanyMonth * 12 * (members - 1) : bracket(book.group.platformFees, members, "fee");
    if (fee) recurring.push({ key: "platform", label: isBiz ? `Family of companies: switching, shared directory and messaging (${members - 1} × $${book.group.familyPerCompanyMonth}/month)` : "Group platform: agency switcher, group admin, cross-agency messaging and combined dashboards", amount: fee });
  }
  // Percentage options on the (group-discounted) software
  const env = pctOf(book.environments, i.environments);
  const envPct = env.pct && !(ed.includesTraining && i.environments === "training") ? (ed.includesTraining && i.environments === "both" ? Math.max(0, env.pct - pctOf(book.environments, "training").pct) : env.pct) : 0;
  if (i.environments !== "none") recurring.push({ key: "environments", label: `Environments: ${env.label}${ed.includesTraining && ["training", "both"].includes(i.environments) ? ` (training included with ${ed.label})` : ""}`, amount: round(softwareNet * envPct) });
  const dr = pctOf(book.dr, i.dr);
  if (!onPrem && dr.pct) recurring.push({ key: "dr", label: `Disaster recovery: ${dr.label} setup and management (back within ${dr.rto}, at most ${dr.rpo} of data lost)`, amount: round(softwareNet * dr.pct) });
  if (onPrem && i.dr !== "standard") notes.push("Disaster recovery tiers apply to hosted systems; on-premises recovery depends on the customer's own servers.");
  const sup = pctOf(book.support, i.support);
  if (sup.pct) recurring.push({ key: "support", label: `${sup.label} support (critical response ${sup.critical})`, amount: round(softwareNet * sup.pct) });
  const listAnnual = round(recurring.reduce((s, l) => s + l.amount, 0));

  // ---- Term, founding and manual discounts on the whole yearly amount
  const term = book.terms.find(t => t.years === Number(i.termYears)) || book.terms[0];
  let year1 = listAnnual;
  const yearly = [];
  if (term.discount) { yearly.push({ key: "term", label: `${term.label} term discount (${Math.round(term.discount * 100)}%)`, amount: round(-year1 * term.discount) }); year1 *= 1 - term.discount; }
  if (i.founding) { yearly.push({ key: "founding", label: `${book.founding.label} discount (${Math.round(book.founding.pct * 100)}% for ${book.founding.years} years)`, amount: round(-year1 * book.founding.pct), years: book.founding.years }); }
  const manual = Math.max(0, Math.min(50, Number(i.manualDiscount) || 0)) / 100;
  if (manual) yearly.push({ key: "manual", label: `Additional discount (${Math.round(manual * 100)}%)`, amount: round(-year1 * manual) });

  // ---- One-time
  const once = [];
  const top = seg.editions[seg.editions.length - 1]?.modules || [];
  const implW = k => Number(MP[k]?.impl) || 1;
  const implBase = custom
    ? round(seg.implementation[size.key] * (ed.modules.length ? Math.max(Number(book.custom?.minImplementationPct) || 0.3, ed.modules.reduce((t, k) => t + implW(k), 0) / Math.max(1, top.reduce((t, k) => t + implW(k), 0))) : 0))
    : seg.implementation[size.key];
  if (i.implementation) {
    const base = implBase;
    once.push({ key: "implementation", label: `Implementation: setup, branding, roles and permissions, staff training (${size.label}${custom ? `, ${ed.modules.length} modules` : ""})`, amount: base });
    if (members > 1) {
      once.push({ key: "members", label: `Implementation for ${members - 1} more ${members - 1 === 1 ? seg.unit : seg.units || seg.unit + "s"} (${Math.round(book.oneTime.additionalMemberImplementation * 100)}% each)`, amount: round(base * book.oneTime.additionalMemberImplementation * (members - 1)) });
      once.push({ key: "groupSetup", label: "Group setup: shared dashboards, sharing rules, group admin training", amount: book.oneTime.groupSetup });
    }
  }
  // CAD (older quotes only carry cadIntegrations = a count of new integrations)
  const cadP = { existing: 2500, new: book.oneTime.cadIntegration ?? 7500, includedViews: 2, extraView: 1500, ...(book.oneTime.cad || {}) };
  let cadKind = ["existing", "new"].includes(i.cadKind) ? i.cadKind : "none";
  let systems = Math.max(1, Math.min(10, Math.round(Number(i.cadSystems) || 1)));
  if (cadKind === "none" && Number(i.cadIntegrations) > 0) { cadKind = "new"; systems = Math.min(10, Math.round(Number(i.cadIntegrations))); }
  const vendor = String(i.cadVendor || "").trim().slice(0, 80);
  const forWhat = `${vendor ? vendor : "the CAD"}${systems > 1 ? ` × ${systems}` : ""}`;
  if (cadKind === "existing") {
    once.push({ key: "cad", label: `CAD connection for ${forWhat}: our ready-made SQL views (${cadP.includedViews} standard views: active calls and call statistics), installed, mapped and tested`, amount: cadP.existing * systems });
    if (cadP.new > cadP.existing) notes.push(`CAD views already exist for this system, so the CAD connection is ${money((cadP.new - cadP.existing) * systems)} less than a new integration.`);
  } else if (cadKind === "new") {
    once.push({ key: "cad", label: `CAD integration for ${forWhat} (a CAD not connected before): map its database, build and test ${cadP.includedViews} standard views (active calls and call statistics)`, amount: cadP.new * systems });
  }
  const extraViews = Math.max(0, Math.round(Number(i.cadExtraViews) || 0));
  if (extraViews) once.push({ key: "cadViews", label: `Additional standard CAD views × ${extraViews} (e.g. apparatus/unit times, master incident list for reports)`, amount: cadP.extraView * extraViews });
  const cadHours = Math.max(0, Number(i.cadCustomHours) || 0);
  if (cadHours) once.push({ key: "cadCustom", label: `Custom CAD views and queries, ${cadHours} hours × $${book.hourly.custom}`, amount: round(cadHours * book.hourly.custom) });
  const mig = Math.max(0, Number(i.migrationHours) || 0);
  if (mig) once.push({ key: "migration", label: `Data migration, ${mig} hours × $${book.oneTime.migrationHourly}`, amount: round(mig * book.oneTime.migrationHourly) });
  const days = Math.max(0, Number(i.trainingDays) || 0);
  if (days) once.push({ key: "training", label: `On-site training, ${days} day${days === 1 ? "" : "s"} (plus travel)`, amount: round(days * book.oneTime.trainingDay) });
  const blocks = Math.max(0, Math.round(Number(i.prepaidBlocks) || 0));
  if (blocks) once.push({ key: "prepaid", label: `Prepaid custom-work hours: ${blocks} × ${book.hourly.prepaidHours} hours at $${book.hourly.prepaidRate}/hour (use within 12 months)`, amount: blocks * book.hourly.prepaidHours * book.hourly.prepaidRate });
  const customAnnual = [];
  for (const c of i.customLines || []) {
    const amt = Number(c.amount) || 0;
    if (!c.label || !amt) continue;
    (c.kind === "annual" ? customAnnual : once).push({ key: "custom", label: String(c.label).slice(0, 200), amount: round(amt) });
  }

  // ---- Year by year: term + 2 renewal years
  const lockYears = term.lockYears;
  const discountedBase = round(listAnnual * (1 - term.discount));
  const customYear = customAnnual.reduce((s, l) => s + l.amount, 0);
  const schedule = [];
  const horizon = term.years + 2;
  for (let y = 1; y <= horizon; y++) {
    let amt = discountedBase * Math.pow(1 + term.escalator, Math.max(0, y - lockYears));
    if (i.founding && y <= book.founding.years) amt *= 1 - book.founding.pct;
    if (manual) amt *= 1 - manual;
    amt += customYear;
    const oneTimeAmt = y === 1 ? once.reduce((s, l) => s + l.amount, 0) : 0;
    schedule.push({ year: y, inTerm: y <= term.years, recurring: round(amt), oneTime: round(oneTimeAmt), total: round(amt + oneTimeAmt) });
  }
  const year1Recurring = schedule[0].recurring;
  const oneTimeTotal = round(once.reduce((s, l) => s + l.amount, 0));
  const contractValue = round(schedule.filter(s => s.inTerm).reduce((s, r) => s + r.total, 0));

  // ---- On-premises alternative: perpetual license + yearly maintenance (replaces the subscription)
  let onPremQuote = null;
  if (onPrem) {
    const licenseBase = softwareNet + (recurring.find(l => l.key === "platform")?.amount || 0) + (recurring.find(l => l.key === "environments")?.amount || 0);
    const license = round(licenseBase * book.onPrem.licenseMultiple * (1 - manual) * (i.founding ? 1 - book.founding.pct : 1));
    const maintenance = round(license * book.onPrem.maintenancePct);
    const supportUplift = round(softwareNet * sup.pct);
    const yearlyOn = round(maintenance + supportUplift + customYear);
    onPremQuote = { license, maintenance, supportUplift, yearly: yearlyOn, firstYear: round(license + yearlyOn + oneTimeTotal) };
    notes.push(`On-premises: one-time license of ${money(license)} (${book.onPrem.licenseMultiple}× the yearly software price), then maintenance of ${money(maintenance)} a year (${Math.round(book.onPrem.maintenancePct * 100)}% of the license) for updates and standard support. Without maintenance the customer keeps the version they have.`);
    // The schedule becomes license + maintenance (maintenance rises by the term's increase after the price lock)
    schedule.length = 0;
    for (let y = 1; y <= horizon; y++) {
      const rec = round(yearlyOn * Math.pow(1 + term.escalator, Math.max(0, y - lockYears)));
      const ot = y === 1 ? round(license + oneTimeTotal) : 0;
      schedule.push({ year: y, inTerm: y <= term.years, recurring: rec, oneTime: ot, total: round(rec + ot) });
    }
  }
  const finalYear1 = schedule[0].recurring;
  const finalTcv = round(schedule.filter(s => s.inTerm).reduce((s, r) => s + r.total, 0));

  // ---- What it replaces
  const spend = (i.currentSpend || []).map(s => ({ label: String(s.label || "").slice(0, 120), annual: Number(s.annual) || 0 })).filter(s => s.label || s.annual);
  const replaced = round(spend.reduce((s, x) => s + x.annual, 0));
  // Hosting (Avexon): shown apart, never in Fenmorix's totals; when Avexon's figure is known it counts in the comparison with today's software
  const hosting = onPrem ? null : { annual: round(Math.max(0, Number(i.hostingAnnual) || 0)), oneTime: round(Math.max(0, Number(i.hostingOneTime) || 0)),
    note: String(i.hostingNote || "").slice(0, 300), partner: book.seller?.partner || "Avexon" };
  if (hosting) hosting.known = hosting.annual > 0 || hosting.oneTime > 0;
  if (hosting && !hosting.known) notes.push(`Hosting and compute are not included: ${hosting.partner} quotes them separately from the number of users, the data kept and the recovery tier (${dr.label}).`);
  const comparable = finalYear1 + (hosting?.annual || 0);
  const firstThree = schedule.slice(0, 3).reduce((s, r) => s + r.total, 0);
  const savings = replaced ? { replaced, yearly: round(replaced - comparable), pct: replaced ? (replaced - comparable) / replaced : 0, threeYears: round(replaced * 3 - firstThree - (hosting ? hosting.annual * 3 + hosting.oneTime : 0)), withHosting: !!hosting?.known, hostingUnknown: !!hosting && !hosting.known } : null;

  // ---- Module by module: what each module of this edition costs (its share of the edition price, by its bundle rate), its share of
  // implementation, and what the same modules would cost built one by one
  const listOf = k => (isBiz ? MP[k].user * users * 12 : MP[k].flat[size.key] * factor);
  const listSum = ed.modules.reduce((t, k) => t + listOf(k), 0);
  const implSum = ed.modules.reduce((t, k) => t + implW(k), 0);
  const breakdown = {
    rows: ed.modules.filter(k => MP[k]).map(k => ({ key: k, label: moduleName(k), list: round(listOf(k)), price: listSum ? round(editionSoftware * listOf(k) / listSum) : 0,
      implementation: i.implementation && implSum ? round(implBase * implW(k) / implSum) : 0 })),
    software: round(editionSoftware), implementation: i.implementation ? implBase : 0,
    custom, premiumPct: Number(book.custom?.premiumPct) || 0,
    // built one by one: custom = what it costs; an edition = its price × (its modules' bundle rates + the premium) / its list price
    aLaCarte: custom ? round(editionSoftware) : (() => { const edList = isBiz ? ed.perUserMonth * users * 12 : ed.prices?.[size.key]; return edList > 0 ? Math.round(editionSoftware * prem * listSum / edList) : 0; })(),
    atBundleRate: custom ? Math.round(editionSoftware / prem) : round(editionSoftware),
  };
  breakdown.bundleSaves = custom ? 0 : round(Math.max(0, breakdown.aLaCarte - breakdown.software));

  const totalUsers = users * members;
  return {
    breakdown, pricing: perUserMode ? "perUser" : "flat",
    segment: i.segment, segmentLabel: seg.label, edition: ed, size, users, members, totalUsers, term, delivery: onPrem ? "onprem" : "hosted",
    env, dr, support: sup, lines: { recurring, yearly, once, customAnnual },
    listAnnual, year1Recurring: finalYear1, oneTimeTotal: onPremQuote ? round(oneTimeTotal + onPremQuote.license) : oneTimeTotal,
    contractValue: finalTcv, schedule, onPremQuote, year1Total: schedule[0].total,
    perUserMonth: round(finalYear1 / totalUsers / 12), savings, spend, notes, hosting, cad: { kind: cadKind, systems, vendor, extraViews, hours: cadHours },
    modules: [...new Set([...ed.modules, ...(i.addons || []).map(k => book.addons.find(a => a.key === k)?.module).filter(Boolean)])],
  };
}

// One "Software it replaces" line from a market rate, for this many users at this size
export function marketLine(rate, users, sizeKey) {
  if (!rate) return null;
  const n = Math.max(1, Math.round(Number(users) || 1));
  const annual = rate.basis === "user" ? Math.round(rate.annual * n) : Number(rate.annual?.[sizeKey] ?? rate.annual?.m ?? 0);
  const label = rate.basis === "user" ? `${rate.label}: ${n} users × ${money(rate.annual, rate.annual % 1 !== 0)}/yr` : rate.label;
  return { label, annual, setup: rate.setup ? Number(rate.setup[sizeKey] ?? 0) : 0, source: rate.source };
}

export function money(n, cents = false) {
  const v = Number(n) || 0;
  return (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

// A saved book merged over the defaults, so new fields added in a release still have values
export function mergeBook(saved) {
  if (!saved || typeof saved !== "object") return structuredClone(DEFAULT_BOOK);
  const out = structuredClone(DEFAULT_BOOK);
  for (const [k, v] of Object.entries(saved)) if (v !== undefined && v !== null && k in out) out[k] = v;
  // Segments, module prices and the build-your-own settings merge one level down, so a book saved before government, schools or
  // module prices existed still gets them
  out.segments = { ...structuredClone(DEFAULT_BOOK.segments), ...(saved.segments && typeof saved.segments === "object" ? saved.segments : {}) };
  out.modulePrices = { ...structuredClone(MODULE_PRICES), ...(saved.modulePrices && typeof saved.modulePrices === "object" ? saved.modulePrices : {}) };
  out.custom = { ...DEFAULT_BOOK.custom, ...(saved.custom && typeof saved.custom === "object" ? saved.custom : {}) };
  return out;
}
