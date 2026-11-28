// Words for the pages beyond the home page. Module facts (names, descriptions, features, uses) come from parts/modules.js,
// the same list the configurator uses, so the two can't disagree. Everything here must describe what the product does today:
// build.mjs refuses wording from the "claims the product doesn't support" list (SEO plan, section 3).

export const SITE_URL = "https://fenmorix.com";
export const DEMO = "/demo";
// Cloudflare Web Analytics (cookieless; site "fenmorix.com"). The token is public: it only lets a page send visit counts.
export const ANALYTICS_TOKEN = "fd2be27b31e64c70b9571bffdd414730";
// Cloudflare Turnstile site key (public; widget "fenmorix.com feature ideas"). The secret lives only in the Worker's bindings.
export const TURNSTILE_SITEKEY = "0x4AAAAAAGWMktYnw7EvzJNP";

// Catalog key -> page address. Keys are the license keys in src/modules.js; never rename a slug once live.
export const SLUGS = {
  messaging: "messaging", recall: "emergency-recall", callalerts: "dispatch-alerts",
  timeclock: "time-clock", offwork: "whos-out", callout: "on-call-schedule", sick: "absence-analytics",
  leave: "leave-bidding", forceback: "overtime-rotation",
  procurement: "purchasing", reimbursements: "expense-reimbursements", forms: "forms", helpdesk: "help-desk",
  gear: "equipment-tracking", meetings: "meetings", links: "shared-logins",
  training: "training", evals: "evaluations", board: "board-reports", gradebook: "gradebook",
  activecalls: "live-dispatch", command: "incident-command", imt: "incident-action-plans",
  recordings: "radio-recordings", investigations: "investigations", stats: "dispatch-analytics",
  pial: "iso-rating-tracker", fireprev: "inspections",
};
// Modules left off the site: spot (one retail customer).
export const HIDDEN = ["spot"];

// A sentence or two added to a module page where the catalog text needs a fact to be accurate.
export const MODULE_NOTES = {
  investigations: "Built with CJIS requirements in mind. Compliance also depends on your hosting and your agency's own policies.",
  activecalls: "Works today with CentralSquare Enterprise CAD through a read-only database view. Other CAD systems can be connected the same way and are quoted per system.",
  stats: "Reads closed calls from your CAD through a read-only database view, or from report spreadsheets you upload.",
  gradebook: "Students and parents or guardians sign in separately from staff and see only their own grades.",
  recordings: "Imports recordings exported from NICE Inform.",
  training: "Imports training records and certification progress from FireWorks reports.",
};

export const INDUSTRIES = [
  { slug: "public-safety", sector: "ps", nav: "Public safety",
    title: "Software for fire, EMS and 911 agencies | Fenmorix OS",
    h1: "One system for public safety agencies",
    desc: "Recall, command boards, dispatch feeds, purchasing, training and ISO tracking for fire departments, EMS and 911 centers, on one set of accounts.",
    intro: ["Many agencies run on a scheduling site, a purchasing spreadsheet, a group text for recalls and a binder for the ISO grader. Fenmorix OS puts that work in one system, on the same accounts, phones and audit log.",
      "Switch on the modules your agency needs. The rest stay off and out of the way."],
    modules: ["recall", "messaging", "callalerts", "activecalls", "command", "imt", "recordings", "stats", "pial", "fireprev", "training", "evals", "timeclock", "offwork", "callout", "leave", "forceback", "procurement", "forms", "gear", "investigations"],
    related: ["fire-departments", "911-dispatch", "ems"] },
  { slug: "fire-departments", sector: "ps", nav: "Fire departments",
    title: "Fire department management software | Fenmorix OS",
    h1: "Built inside a fire department",
    desc: "Emergency recall, incident command boards, training records, ISO / PIAL tracking, inspections and purchasing for fire departments.",
    intro: ["Fenmorix OS started inside a working fire district. A chief can start a recall from a phone, the command board pulls units from CAD and times PAR checks, and training hours, hydrant tests and inspections feed a live ISO / PIAL estimate.",
      "Leave bidding, overtime rotation and equipment tracking follow the way shifts and stations actually work."],
    modules: ["recall", "command", "activecalls", "imt", "pial", "fireprev", "training", "evals", "leave", "forceback", "gear", "procurement", "recordings", "investigations"],
    related: ["public-safety", "911-dispatch", "ems"] },
  { slug: "911-dispatch", sector: "ps", nav: "911 centers",
    title: "Software for 911 and dispatch centers | Fenmorix OS",
    h1: "For 911 and dispatch centers",
    desc: "A live dispatch feed, dispatch alerts, call-processing analytics, radio recordings and crew scheduling tools for 911 centers.",
    intro: ["Fenmorix OS reads your CAD through a read-only database view, so open calls show in the system and dispatch alerts reach the right people's phones.",
      "Closed calls feed analytics for call taking and dispatch times, and the scheduling tools handle overtime rotation, leave bidding and who's out on every crew."],
    modules: ["activecalls", "callalerts", "stats", "recordings", "forceback", "leave", "timeclock", "offwork", "messaging", "training"],
    related: ["public-safety", "fire-departments"] },
  { slug: "ems", sector: "ps", nav: "EMS",
    title: "Workforce and training software for EMS agencies | Fenmorix OS",
    h1: "For EMS agencies",
    desc: "Messaging, emergency recall, scheduling, training records, evaluations and equipment tracking for EMS agencies.",
    intro: ["EMS agencies use Fenmorix OS for the work around the calls: reaching crews, recalling staff, keeping training and certifications current, and tracking equipment.",
      "There are no patient-care records in Fenmorix OS; it works alongside the systems you already use for those."],
    modules: ["messaging", "recall", "timeclock", "offwork", "callout", "leave", "forceback", "training", "evals", "gear", "forms"],
    related: ["public-safety", "fire-departments"] },
  { slug: "government", sector: "gov", nav: "Government",
    title: "Software for cities, parishes and counties | Fenmorix OS",
    h1: "For cities, parishes, counties and utilities",
    desc: "Requisitions with signatures, staff time and schedules, who's out, help desk, equipment, emergency notifications and council reports for local government.",
    intro: ["Requisitions with the signatures auditors expect, staff schedules and time, who's out, help desk and equipment across buildings, emergency notifications for storms and outages, and reports for the council or commission.",
      "Menus, job roles, pay periods and wording change to fit your office, without a custom build."],
    modules: null, related: ["public-safety", "business"] },
  { slug: "business", sector: "biz", nav: "Business",
    title: "Time clock, purchasing and help desk for businesses | Fenmorix OS",
    h1: "For shops, offices and service companies",
    desc: "Time clock and schedules, who's in today, purchase requests, expense claims with receipts, a help desk and shared logins for businesses.",
    intro: ["Time clock and schedules, who's in today, purchase requests and expense claims with receipts, a help desk, shared logins only the right people can reveal, and screens for the front counter.",
      "Businesses pay per user and switch on only the modules they use."],
    modules: null, related: ["government", "education"] },
  { slug: "education", sector: "edu", nav: "Education",
    title: "Software for schools and districts | Fenmorix OS",
    h1: "For schools and districts",
    desc: "Campus alerts and staff roll call, staff forms and approvals, who's out, classroom purchasing, certifications, board reports and a gradebook.",
    intro: ["Campus alerts and roll call for faculty and staff, staff forms and approvals, who's out before the first bell, classroom purchasing, teacher certifications, board reports, and a gradebook students and parents sign in to.",
      "Staff use the whole system. Students and families sign in only to the Gradebook, to see their own grades."],
    modules: null, extra: ["gradebook"], related: ["government", "business"] },
];

export const PAGES = {
  security: {
    title: "Security | Fenmorix OS", nav: "Security",
    h1: "Security your IT department can sign off on",
    desc: "Two-step sign-in, an audit log that can't be edited, encryption for sensitive data, signed updates and per-customer builds in Fenmorix OS.",
    intro: "Public safety, government and school records have rules. These controls are built into the system, not added later. Each one below describes how the software works today.",
    sections: [
      ["Signing in", ["Administrators confirm every sign-in with an authenticator app, with one-time recovery codes.",
        "Passwords need at least 10 characters with upper and lower case and a symbol, and expire after 90 days.",
        "Sessions end after 60 minutes without use, and people can see and end their other sessions.",
        "Repeated failed sign-ins from one address are slowed down, and every failed attempt is logged."]],
      ["Records and logging", ["Who saw, signed, changed or exported what, and when, goes into an audit log that can't be edited.",
        "Signed requisitions and finished records lock; later corrections are logged with the old and new values.",
        "Access is set by section and level, for people, groups or job roles, and can be limited to divisions."]],
      ["Encryption", ["Sensitive form answers, shared logins and investigation case files are encrypted in the database (AES-256-GCM), not just on the wire.",
        "Every page is served over HTTPS with strict transport security and a content security policy."]],
      ["Investigations", ["Investigations keep need-to-know access, an access log, encrypted case files and a dissemination record.",
        "Built with CJIS requirements in mind. Compliance also depends on your hosting and your agency's own policies."]],
      ["Updates and your copy", ["Each update is signed by Fenmorix Technologies and checked by your server before it installs, with a backup first and automatic rollback if anything fails.",
        "Your download contains the modules you bought and nothing from any other customer."]],
    ],
    outro: "Fenmorix OS does not currently hold third-party security certifications. Ask us for details on any control above." },
  integrations: {
    title: "Integrations | Fenmorix OS", nav: "Integrations",
    h1: "Works with the systems you already have",
    desc: "Fenmorix OS connects to CentralSquare CAD, Aladtec, NICE Inform, FireWorks, spreadsheets, National Weather Service, USGS imagery and email.",
    intro: "Fenmorix OS reads from the systems your organization already runs rather than replacing them. These are the connections that exist today.",
    sections: [
      ["CentralSquare Enterprise CAD", ["Open calls, closed-call statistics and unit responses through read-only database views. Other CAD systems can be connected the same way and are quoted per system."]],
      ["Aladtec", ["Who is on duty, today's schedule and time off, read from Aladtec. Fenmorix OS never writes to it."]],
      ["NICE Inform", ["Radio recordings exported from NICE Inform are imported and split into clips that can be played and transcribed."]],
      ["FireWorks", ["Training records, certification progress, fire responses and alarm processing reports imported from FireWorks spreadsheets."]],
      ["Spreadsheets", ["Rosters, inspections, class lists and other records come in from Excel or CSV files, with a preview before anything is saved."]],
      ["National Weather Service", ["Current conditions, the next 12 hours and active alerts on everyone's home screen."]],
      ["USGS imagery and U.S. Census geocoding", ["Aerial pictures of an address for command boards and training scenarios."]],
      ["Phone and desktop notifications", ["Web push notifications to phones and computers, with no app store app to install."]],
      ["Email", ["Password resets and notices through your organization's mail server."]],
    ] },
  hosting: {
    title: "Hosting and on-premises installs | Fenmorix OS", nav: "Hosting",
    h1: "Hosted for you, or on your servers",
    desc: "Fenmorix OS is hosted and supported by Avexon, or installed on your own Ubuntu or Windows servers, with signed updates and automatic backups.",
    intro: "Most organizations have Fenmorix OS run for them. Some need it on their own servers. Both get the same software and the same updates.",
    sections: [
      ["Hosted by Avexon", ["Our hosting partner Avexon sets up, hosts and supports Fenmorix OS: servers, backups and the recovery level you need.",
        "Hosting is quoted by Avexon, separately from the software, sized to your users and data."]],
      ["On your servers", ["Install kits for Ubuntu Server 22.04 and 24.04 and for Windows Server, with PostgreSQL, HTTPS and a service that restarts itself.",
        "On Ubuntu, backups run every 6 hours and can be copied to a second location; on Windows, nightly or as often as you set.",
        "On-premises licenses are available for organizations that require them."]],
      ["Updates", ["Updates are signed and checked before they install. Your administrators install them from the System page, or let them install at night.",
        "A backup is taken first, and a failed update rolls back on its own."]],
      ["Test and training copies", ["A separate test or training copy can be set up to practice on without touching live records."]],
    ] },
  avexon: {
    path: "/partners/avexon",
    title: "Avexon, hosting partner | Fenmorix OS", nav: "Avexon",
    h1: "Built by Fenmorix. Delivered with Avexon.",
    desc: "Fenmorix Technologies builds Fenmorix OS. Avexon sets up, hosts and supports it for organizations that want it run for them.",
    intro: "Fenmorix Technologies builds the software. Avexon sets up, hosts and supports Fenmorix OS for organizations that want it run for them: servers, backups and the recovery level you need, quoted separately from the software.",
    sections: [["Talk to Avexon", ["Email solutions@avexon.com about hosting, backups and recovery for Fenmorix OS."]]],
    cta: { label: "Email Avexon", href: "mailto:solutions@avexon.com?subject=" + encodeURIComponent("Hosting Fenmorix OS") } },
};
