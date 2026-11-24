// The Nexus module catalog: what a license can turn on. Shared by the server (server/license.js: which API routes and
// collections answer), the screens (App.jsx tiles, Your Day) and the License Manager (tools/license-manager).
// CORE is always on: sign-in, accounts and permissions, Your Day, Announcements, Directory, Personnel File, User Management,
// Audit Log, System. Keep keys stable: they're written into customers' license files.
//
//   key       written in licenses
//   tiles     main-menu sections it shows (App.jsx tile keys)
//   api       /api/<first path part> it owns
//   collections  /api/collections/<key> it owns (reads of a locked one come back empty; writes are refused)
//   needs     other modules it can't work without (the License Manager adds them)
//   optIn     only on when a license names it: not in "all" / "*", and off on an install with no license (St. George)
export const CORE = {
  tiles: ["announcements", "notifications", "directory", "personnel", "users", "audit"],
  api: ["auth", "notices", "health", "access", "events", "prefs", "system", "audit", "directory", "weather", "push", "documents", "files", "display", "personnel"],
  collections: ["roster", "divisions", "announcements", "audit-log"],
};

export const MODULES = [
  { key: "messaging", name: "Messaging & Chat", group: "Communication", tiles: ["messages"], api: ["messages"], collections: [],
    desc: "Messages to people, teams and groups; live chat; status and auto-replies; mobile push." },
  { key: "procurement", name: "Purchasing & Requisitions", group: "Finance & Purchasing", tiles: ["procurement"], api: ["req-signature"],
    collections: ["requisitions", "vendors", "contracts", "quotes", "categories"],
    desc: "Purchase requests with approval routing and signatures, vendors, contracts, quotes, budget reports, document autofill." },
  { key: "reimbursements", name: "Expense Reimbursements", group: "Finance & Purchasing", tiles: ["reimbursements"], api: [], collections: ["reimbursements", "mileage-rate"],
    desc: "Travel and other expense claims with receipts and approval." },
  { key: "forms", name: "Forms & Case Management", group: "Workflow", tiles: ["forms"], api: ["forms"], collections: [],
    desc: "Form builder, routed submissions, cases and follow-ups, encrypted sensitive fields, PDF output." },
  { key: "helpdesk", name: "Help Desk", group: "Workflow", tiles: ["helpdesk"], api: ["tickets"], collections: ["tickets"],
    desc: "Support tickets with assignment, status updates and send-to groups." },
  { key: "gear", name: "Equipment & Asset Tracking", group: "Workflow", tiles: ["ppe"], api: [], collections: ["gear", "certifications"], needs: ["helpdesk"],
    desc: "Issued equipment, inspections and retirement dates, equipment tickets." },
  { key: "meetings", name: "Meetings", group: "Workflow", tiles: ["meetings"], api: [], collections: ["meetings"],
    desc: "Meeting requests with accept/decline tracking." },
  { key: "timeclock", name: "Time Clock", group: "Workforce", tiles: ["timetracker"], api: ["time"], collections: ["time-entries"],
    desc: "Punch in/out, hours toward the pay period, team time by crew or department." },
  { key: "callout", name: "On-Call Schedule", group: "Workforce", tiles: ["callout"], api: [], collections: ["callouts"],
    desc: "Who's on call by department and call-back order." },
  { key: "offwork", name: "Who's Out", group: "Workforce", tiles: ["offwork"], api: ["offwork"], collections: [],
    desc: "Days off and who's out, with visibility controls." },
  { key: "sick", name: "Absence Analytics", group: "Workforce", tiles: ["sick"], api: ["sick"], collections: [],
    desc: "Sick call-outs, Bradford factor, absence patterns and risk scores for upcoming shifts." },
  { key: "leave", name: "Leave Bidding", group: "Workforce", tiles: ["leave"], api: ["leave"], collections: [],
    desc: "Seniority-based vacation and holiday bidding by team, with turn notices and reports." },
  { key: "forceback", name: "Mandatory Overtime Rotation", group: "Workforce", tiles: ["forceback"], api: ["forceback"], collections: [],
    desc: "Fair rotation lists for forced or mandatory overtime, with a permanent log." },
  { key: "training", name: "Training & Certifications", group: "Training & Development", tiles: ["training"], api: ["training", "apparatus", "bookings"], collections: [],
    desc: "Training hours against requirements, sessions with supervisor sign-off, skill proficiency, room bookings." },
  { key: "evals", name: "Evaluations & Simulations", group: "Training & Development", tiles: ["evals"], api: ["evals"], collections: [],
    desc: "Probation and promotion evaluations, scored rubrics, voice and leadership simulations." },
  { key: "recall", name: "Emergency Recall", group: "Public Safety", tiles: ["recall"], api: ["recall"], collections: [],
    desc: "Call staff back in an emergency: notices, responses, staffing and roll call." },
  { key: "imt", name: "Incident Action Plans (ICS)", group: "Public Safety", tiles: ["imt"], api: ["imt"], collections: [],
    desc: "ICS forms by operational period, plan import and print, for any NIMS incident." },
  { key: "activecalls", name: "Live Dispatch Feed (CAD)", group: "Public Safety", tiles: [], api: ["cad"], collections: [],
    desc: "Open calls from a CAD system on dashboards and TV screens." },
  { key: "command", name: "Incident Command Board", group: "Public Safety", tiles: ["command"], api: ["command"], collections: [], needs: ["activecalls"],
    desc: "On-scene accountability, PAR timers, strategy, MAYDAY and after-action records." },
  { key: "callalerts", name: "Dispatch Alerts", group: "Public Safety", tiles: ["callalerts"], api: ["callalerts"], collections: [], needs: ["activecalls"],
    desc: "Push alerts for chosen call types, units and agencies." },
  { key: "recordings", name: "Radio Recordings & Transcripts", group: "Public Safety", tiles: ["recordings"], api: ["recordings"], collections: [],
    desc: "Radio traffic imports with machine transcripts." },
  { key: "investigations", name: "Investigations (CJIS)", group: "Public Safety", tiles: ["investigations"], api: ["inv"], collections: [],
    desc: "Case files, evidence, chain of custody and criminal history under CJIS controls." },
  { key: "stats", name: "Dispatch Center Analytics", group: "Analytics & Compliance", tiles: ["stats"], api: ["stats"], collections: [],
    desc: "Call volume, answer and hold times, call-taker and dispatcher performance, reports." },
  { key: "board", name: "Board & Council Reports", group: "Analytics & Compliance", tiles: ["board"], api: ["board"], collections: [], needs: ["stats"],
    desc: "Operational reports for boards, councils and leadership." },
  { key: "pial", name: "ISO / PIAL Rating Tracker", group: "Analytics & Compliance", tiles: ["pial"], api: ["pial"], collections: [],
    desc: "Live public protection classification score, records by division, grader binder." },
  { key: "fireprev", name: "Inspections Program", group: "Analytics & Compliance", tiles: ["fireprev"], api: ["fireprev"], collections: [],
    desc: "Annual inspection coverage and rating credit." },
  // Retail & commerce (first customer: a precious-metals dealer). optIn: never on St. George's install, never in "all".
  { key: "spot", name: "Live Spot Prices", group: "Retail & Commerce", tiles: ["spot"], api: ["spot"], collections: [], optIn: true,
    desc: "Gold, silver, platinum and palladium spot prices on every page, today's chart, and a showroom TV view." },
  { key: "links", name: "Quick Links & Shared Logins", group: "Workflow", tiles: ["links"], api: ["links"], collections: [], optIn: true,
    desc: "The websites the team uses every day, one click away; shared logins encrypted, shown only to the people chosen, every view logged." },
];

export const MODULE_KEYS = MODULES.map(m => m.key);
// What "all" ("*" in a license) and an install without a license turn on: everything except opt-in modules
export const STANDARD_KEYS = MODULES.filter(m => !m.optIn).map(m => m.key);
export const moduleByKey = Object.fromEntries(MODULES.map(m => [m.key, m]));
// A module list with everything it needs added
export function withNeeds(keys) {
  const out = new Set(keys.filter(k => moduleByKey[k]));
  for (let changed = true; changed;) {
    changed = false;
    for (const k of [...out]) for (const n of moduleByKey[k].needs || []) if (!out.has(n)) { out.add(n); changed = true; }
  }
  return MODULE_KEYS.filter(k => out.has(k));
}
// Which module a main-menu tile / API path / collection belongs to (null = core)
export const moduleOfTile = t => MODULES.find(m => m.tiles.includes(t))?.key || null;
export const moduleOfApi = p => MODULES.find(m => m.api.includes(p))?.key || null;
export const moduleOfCollection = c => MODULES.find(m => m.collections.includes(c))?.key || null;

// Menu names a customer can rename (User Management › System › Branding). key = tile key; label = the built-in name;
// section = the name a section's own pages show in the side bar when it differs from the tile.
export const TILE_LABELS = [
  { key: "announcements", label: "Announcements" }, { key: "messages", label: "Messages" }, { key: "notifications", label: "Notifications" },
  { key: "procurement", label: "Procurement / Requisitions", section: "Procurement" }, { key: "reimbursements", label: "Reimbursements" },
  { key: "forms", label: "Forms" }, { key: "personnel", label: "Personnel File" }, { key: "ppe", label: "PPE & Gear" },
  { key: "helpdesk", label: "Help Desk" }, { key: "meetings", label: "Meetings" }, { key: "offwork", label: "Off Work" },
  { key: "callalerts", label: "Call Alerts" }, { key: "forceback", label: "Force Back" }, { key: "directory", label: "Directory" },
  { key: "timetracker", label: "Time Tracker" }, { key: "callout", label: "Call-Out Schedule" }, { key: "leave", label: "Leave Picks" },
  { key: "training", label: "Training" }, { key: "evals", label: "Evaluations" }, { key: "recall", label: "Emergency Recall" },
  { key: "imt", label: "IMT" }, { key: "command", label: "Command Board" }, { key: "recordings", label: "Working Fire Recordings", section: "Fire Recordings" },
  { key: "pial", label: "PIAL Tracker" }, { key: "board", label: "Board Report" }, { key: "stats", label: "Comms Statistics" },
  { key: "sick", label: "Sick Leave" }, { key: "fireprev", label: "Fire Prevention" }, { key: "investigations", label: "Investigations" },
  { key: "audit", label: "Audit Log" }, { key: "users", label: "User Management" },
  { key: "spot", label: "Spot Prices" }, { key: "links", label: "Quick Links" },
];
