// Fills a SANDBOX with a made-up fire department so every screen has something in it.
//
//   node scripts/sandbox/seed-demo.mjs                 add the demo department (once; does nothing if it's already there)
//   node scripts/sandbox/seed-demo.mjs --export-accounts <file>   save the real sign-ups (used by reset-sandbox.sh)
//   node scripts/sandbox/seed-demo.mjs --import-accounts <file>   put them back after a reset
//
// Run from the app folder after Nexus has started once (so the database is set up). It refuses to run unless .env has
// SANDBOX=on, so it can never touch a real department's server. Every name, address, phone and call is invented.
// Demo people can't sign in (no password); their email addresses end in @demo.example.org.
try { process.loadEnvFile(".env"); } catch { /* environment only */ }
import crypto from "node:crypto";
import fs from "node:fs";

if (!/^(1|on|true|yes)$/i.test(String(process.env.SANDBOX || ""))) {
  console.error("This only runs on a sandbox (SANDBOX=on in .env). Nothing was changed.");
  process.exit(1);
}
const { pool, tx } = await import("../../server/db.js");
const DEMO_DOMAIN = "@demo.example.org";
const arg = process.argv[2];

// ---- Keep / restore the real sign-ups across a reset ----------------------------------------------------------
const ACCOUNT_COLS = ["full_name", "email", "role", "password_hash", "account_status", "signed_up_at", "approved_at", "signup_org", "job_title", "station",
  "work_pattern", "phone", "password_changed_at", "must_change_password", "must_change_reason", "totp_secret", "totp_enabled_at", "mfa_recovery"];
if (arg === "--export-accounts") {
  const rows = (await pool.query(`SELECT ${ACCOUNT_COLS.map(c => `u.${c}`).join(", ")}, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
    WHERE u.active AND u.password_hash IS NOT NULL AND lower(coalesce(u.email, '')) NOT LIKE '%${DEMO_DOMAIN}'`)).rows;
  fs.writeFileSync(process.argv[3], JSON.stringify(rows), { mode: 0o600 });
  console.log(`Saved ${rows.length} accounts.`);
  await pool.end?.(); process.exit(0);
}
if (arg === "--import-accounts") {
  const rows = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  let n = 0;
  for (const r of rows) {
    const div = (await pool.query("SELECT id FROM divisions WHERE name = $1", [r.division])).rows[0]?.id
      || (await pool.query("SELECT id FROM divisions ORDER BY id LIMIT 1")).rows[0].id;
    const vals = ACCOUNT_COLS.map(c => (c === "mfa_recovery" ? JSON.stringify(r[c] || []) : r[c]));
    await pool.query(`INSERT INTO users (${ACCOUNT_COLS.join(", ")}, division_id) VALUES (${ACCOUNT_COLS.map((_, i) => `$${i + 1}`).join(", ")}, $${ACCOUNT_COLS.length + 1})
      ON CONFLICT DO NOTHING`, [...vals, div]);
    n++;
  }
  console.log(`Put back ${n} accounts.`);
  await pool.end?.(); process.exit(0);
}

// ---- The demo department -----------------------------------------------------------------------------------------
const done = (await pool.query("SELECT value FROM settings WHERE key = 'sandbox_seed'")).rows[0];
if (done) { console.log("The demo department is already there. (reset-sandbox.sh starts over.)"); await pool.end?.(); process.exit(0); }

let seed = 20261120;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = new Date(); today.setHours(12, 0, 0, 0);
const uuid = () => crypto.randomUUID();

const FIRST = ["Avery", "Jordan", "Morgan", "Casey", "Riley", "Taylor", "Quinn", "Skyler", "Rowan", "Blake", "Cameron", "Drew", "Emerson", "Finley", "Hayden",
  "Jamie", "Kendall", "Logan", "Micah", "Noel", "Parker", "Reese", "Sawyer", "Shawn", "Tatum", "Wren", "Ellis", "Harper", "Lane", "Marlow", "Sage", "Toby",
  "Corey", "Dale", "Jesse", "Kerry", "Lee", "Robin", "Terry", "Val", "Alex", "Brook", "Devon", "Frankie", "Gale", "Jody"];
const LAST = ["Abbott", "Barlow", "Calloway", "Dempsey", "Easton", "Fairbanks", "Garrison", "Holloway", "Ingram", "Jennings", "Kessler", "Langford", "Mercer",
  "Norwood", "Oakley", "Prescott", "Quimby", "Ramsey", "Sterling", "Thatcher", "Underwood", "Vance", "Whitaker", "Yardley", "Ashford", "Bramwell", "Carver",
  "Dunmore", "Ellery", "Fenwick", "Gatling", "Hartwell", "Kingsley", "Lockhart", "Marston", "Pembroke", "Radcliffe", "Selby", "Talbot", "Winslow", "Avalon", "Birch"];
const used = new Set();
const name = () => { for (;;) { const n = `${pick(FIRST)} ${pick(LAST)}`; if (!used.has(n)) { used.add(n); return n; } } };

const divId = new Map((await pool.query("SELECT id, name FROM divisions")).rows.map(r => [r.name, r.id]));
const D = n => divId.get(n) || divId.values().next().value;
const catId = new Map((await pool.query("SELECT id, name FROM categories")).rows.map(r => [r.name, r.id]));
const C = n => catId.get(n) || catId.values().next().value;

await tx(async c => {
  await c.query("SET LOCAL sgfd.importing = 'on'");
  // Stations and facilities
  const places = [["station", "Station 11", "11", "1100 Riverside Pkwy"], ["station", "Station 12", "12", "2450 Magnolia Bend Rd"],
    ["station", "Station 13", "13", "780 Cypress Point Ave"], ["station", "Station 14", "14", "5120 Old Mill Rd"],
    ["facility", "Headquarters", null, "100 Main St"], ["facility", "Training Center", null, "4800 Willow Creek Blvd"]];
  let i = 0;
  for (const [kind, nm, num, addr] of places) {
    await c.query(`INSERT INTO directory_places (id, kind, name, number, address, phone, sort_order, aladtec_match) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [uuid(), kind, nm, num, `${addr}, Demo`, `(555) 010-${pad(10 + i)}00`, ++i * 10, num ? `??${num}*` : null]);
  }

  // People: chiefs and staff (weekdays), three shifts of suppression, four comms crews
  const people = [];
  const add = (p) => { people.push({ id: uuid(), ...p }); return people[people.length - 1]; };
  const chief = add({ name: name(), div: "Administration", title: "Fire Chief", role: "fire_chief", pattern: "weekdays", station: "" });
  add({ name: name(), div: "Administration", title: "Assistant Chief", role: "approver2", pattern: "weekdays", station: "" });
  const acct = add({ name: name(), div: "Administration", title: "Finance Manager", role: "accounting", pattern: "weekdays", station: "" });
  add({ name: name(), div: "Training", title: "Training Chief", role: "approver1", pattern: "weekdays", station: "" });
  add({ name: name(), div: "Fire Prevention", title: "Fire Marshal", role: "approver1", pattern: "weekdays", station: "" });
  add({ name: name(), div: "Fire Prevention", title: "Fire Inspector", role: "user", pattern: "weekdays", station: "" });
  const tech = add({ name: name(), div: "Technology", title: "IT Coordinator", role: "user", pattern: "weekdays", station: "" });
  add({ name: name(), div: "Communications", title: "Communications Manager", role: "approver1", pattern: "weekdays", station: "" });
  for (const sh of ["A", "B", "C"]) {
    add({ name: name(), div: "Suppression", title: "Battalion Chief", role: "approver1", pattern: `fire:${sh}`, station: "11" });
    for (const st of ["11", "12", "13", "14"]) {
      add({ name: name(), div: "Suppression", title: "Captain", role: "user", pattern: `fire:${sh}`, station: st });
      add({ name: name(), div: "Suppression", title: "Driver/Operator", role: "user", pattern: `fire:${sh}`, station: st });
      add({ name: name(), div: "Suppression", title: "Firefighter", role: "user", pattern: `fire:${sh}`, station: st });
    }
  }
  for (const crew of ["A", "B", "C", "D"]) {
    add({ name: name(), div: "Communications", title: "Shift Supervisor", role: "user", pattern: `comms:${crew}`, station: "" });
    add({ name: name(), div: "Communications", title: "Telecommunicator", role: "user", pattern: `comms:${crew}`, station: "" });
    add({ name: name(), div: "Communications", title: "Telecommunicator", role: "user", pattern: `comms:${crew}`, station: "" });
  }
  let emp = 1000;
  for (const p of people) {
    const [f, l] = p.name.toLowerCase().split(" ");
    p.email = `${f}.${l}${DEMO_DOMAIN}`;
    await c.query(`INSERT INTO users (id, full_name, division_id, role, email, phone, account_status, active, employee_number, job_title, hire_date, station, work_pattern, extension)
      VALUES ($1,$2,$3,$4,$5,$6,'approved',true,$7,$8,$9,$10,$11,$12)`,
      [p.id, p.name, D(p.div), p.role, p.email, `(555) 01${pad(Math.floor(rnd() * 100))}-${String(1000 + Math.floor(rnd() * 9000))}`, `D${++emp}`, p.title,
        iso(addDays(today, -Math.floor(365 * (1 + rnd() * 20)))), p.station || null, p.pattern, String(200 + emp % 100)]);
  }

  // Vendors and requisitions in every stage
  const vendors = [];
  for (const [nm, city] of [["Bayou Fire Apparatus Supply", "Demo"], ["Gulfline Safety Equipment", "Northside"], ["Riverbend Office Products", "Demo"],
    ["Pinecrest Fleet Service", "Lakeview"], ["Cypress Radio & Electronics", "Demo"], ["Lakeside Uniform Co.", "Northside"], ["Delta Hose & Nozzle", "Lakeview"],
    ["Magnolia IT Services", "Demo"]]) {
    const id = uuid(); vendors.push({ id, nm });
    await c.query(`INSERT INTO vendors (id, name, phone, address, city, state, zip, rep_name) VALUES ($1,$2,$3,$4,$5,'LA','70000',$6)`,
      [id, nm, `(555) 02${pad(vendors.length)}-${3000 + vendors.length * 7}`, `${100 + vendors.length * 37} Commerce Dr`, city, name()]);
  }
  const requesters = people.filter(p => /Captain|Battalion|Coordinator|Marshal|Training Chief|Manager/.test(p.title));
  const REQS = [["SCBA cylinder hydro testing", "PPE & Safety Gear", 1, 2840, "approved"], ["Replacement nozzles (Engine 121)", "Equipment", 6, 1265.5, "paid"],
    ["Station 13 kitchen range", "Facilities", 0, 1890, "pending_auth1"], ["Tablet mounts for apparatus", "Software & IT", 7, 2275, "pending_auth2"],
    ["Turnout gear cleaning contract", "Contracted Services", 5, 9600, "pending_chief"], ["Portable radio batteries (40)", "Equipment", 4, 3180, "approved"],
    ["Office supplies Q4", "Supplies", 2, 412.37, "paid"], ["Ladder 141 annual aerial test", "Vehicles & Fleet", 3, 1450, "pending_auth1"],
    ["Fire inspector code books", "Training & Certification", 2, 689, "rejected"], ["Hose replacement 1¾\" (10 lengths)", "Equipment", 6, 2350, "pending_auth2"],
    ["Network switch for Station 12", "Software & IT", 7, 1149.99, "approved"], ["Class A uniforms (new hires)", "PPE & Safety Gear", 5, 3720, "pending_chief"]];
  const stageOrder = ["auth1", "auth2", "chief"];
  const signedStages = { pending_auth1: 0, pending_auth2: 1, pending_chief: 2, approved: 3, paid: 3, rejected: 1 };
  const signerFor = { auth1: people.find(p => p.role === "approver1" && p.div === "Suppression"), auth2: people.find(p => p.role === "approver2"), chief };
  let n = 0;
  for (const [title, cat, v, amount, status] of REQS) {
    const id = uuid(), who = requesters[n % requesters.length], day = addDays(today, -(4 + n * 6));
    await c.query(`INSERT INTO requisitions (id, division_id, category_id, title, vendor_id, description, amount, payment_method, requested_by, requested_by_name, status,
      rejected_reason, paid_at, req_date, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, D(who.div), C(cat), title, vendors[v].id, `Demo requisition: ${title.toLowerCase()}.`, amount, n % 3 ? "Check" : "Purchase order", who.id, who.name, status,
        status === "rejected" ? "Use the training budget line instead; resubmit next quarter." : null, status === "paid" ? addDays(day, 12) : null, iso(day), day]);
    for (let s = 0; s < signedStages[status]; s++) {
      const stage = stageOrder[s], signer = signerFor[stage];
      const rejected = status === "rejected" && s === signedStages[status] - 1;
      await c.query(`INSERT INTO requisition_signatures (requisition_id, stage, signer_id, signer_name, decision, signed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, stage, signer.id, signer.name, rejected ? "rejected" : "approved", addDays(day, 1 + s * 2)]);
    }
    n++;
  }

  // Help Desk and gear tickets
  const TICKETS = [["Station 12 printer jams on every job", "Printer", "helpdesk", "in_progress"], ["MDT in Engine 131 won't log in", "Account & Access", "helpdesk", "open"],
    ["Wi-Fi drops in the Training Center classroom", "Network", "helpdesk", "acknowledged"], ["Need the scheduling app on my phone", "Software", "helpdesk", "resolved"],
    ["Portable radio speaker mic crackles", "Phone / Radio", "helpdesk", "open"], ["Monitor flickers at the HQ front desk", "Hardware", "helpdesk", "closed"]];
  for (const [subject, cat, desk, status] of TICKETS) {
    const id = uuid(), who = pick(people.filter(p => p.div === "Suppression" || p.div === "Communications")), at = addDays(today, -Math.floor(rnd() * 20));
    await c.query(`INSERT INTO tickets (id, subject, category, priority, division_id, location, description, requester_id, requester_name, assignee_id, status, desk, created_at, updated_at,
      resolved_at, closed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15)`,
      [id, subject, cat, pick(["Low", "Medium", "High"]), D(who.div), who.station ? `Station ${who.station}` : "Headquarters", `${subject}. (Demo ticket.)`, who.id, who.name,
        status === "open" ? null : tech.id, status, desk, at, ["resolved", "closed"].includes(status) ? addDays(at, 2) : null, status === "closed" ? addDays(at, 3) : null]);
    if (status !== "open") await c.query(`INSERT INTO ticket_comments (ticket_id, author_id, author_name, body, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, tech.id, tech.name, "Looking at it today. I'll stop by the station after lunch.", addDays(at, 1)]);
  }

  // Announcements
  for (const [t, b, pri, pin] of [["Welcome to the Fenmorix OS sandbox", "Everything here is made up. Click around, try every section, and break things: the demo department can be reset.", "Important", true],
    ["Hose testing next week", "All engine companies: hose testing at the Training Center Tuesday through Thursday. Bring every length off the apparatus.", "Normal", false],
    ["Open enrollment ends Friday", "Benefits open enrollment closes this Friday at 5 PM.", "Normal", false]]) {
    await c.query("INSERT INTO announcements (title, body, priority, pinned, author_id) VALUES ($1,$2,$3,$4,$5)", [t, b, pri, pin, chief.id]);
  }

  // Sick call-outs over the last 18 months (two people with a holiday-shaped habit), and days off coming up
  const { worksOn } = await import("../../src/shifts.js");
  const shiftDays = (pat, from, to) => { const out = []; for (let d = new Date(from); d <= to; d = addDays(d, 1)) if (worksOn(pat, iso(d))) out.push(iso(d)); return out; };
  const floor = people.filter(p => /^fire:|^comms:/.test(p.pattern));
  for (const p of floor) {
    const hours = p.pattern.startsWith("fire") ? 24 : 12;
    const days = shiftDays(p.pattern, addDays(today, -540), addDays(today, -1));
    const habit = p === floor[3] || p === floor[17];
    const k = habit ? 9 : Math.floor(rnd() * 4);
    for (let j = 0; j < k; j++) {
      const day = habit ? days.find(d => /-(12-2[4-6]|01-0[1-2]|07-0[3-5]|11-2[6-9])$/.test(d) && !used.has(`${p.id}${d}`)) || pick(days) : pick(days);
      used.add(`${p.id}${day}`);
      await c.query(`INSERT INTO sick_entries (id, user_id, division, day, hours, kind, entered_by_name) VALUES ($1,$2,$3,$4,$5,$6,'Demo data') ON CONFLICT DO NOTHING`,
        [uuid(), p.id, p.div, day, hours, rnd() < 0.15 ? "family" : "sick"]);
    }
  }
  for (let j = 0; j < 8; j++) {
    const p = pick(people), start = addDays(today, Math.floor(rnd() * 10)), len = Math.floor(rnd() * 4);
    await c.query(`INSERT INTO off_work (user_id, start_day, end_day, kind, note, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5,$1,$6)`,
      [p.id, iso(start), iso(addDays(start, len)), pick(["vacation", "training", "off", "ooo"]), pick(["", "Conference", "Family trip", "State fire academy class"]), p.name]);
  }

  // Comms force-back list
  const list = uuid();
  await c.query(`INSERT INTO fb_lists (id, name, division, steps) VALUES ($1, 'Communications Force Back', 'Communications', $2)`,
    [list, "1. Ask for volunteers first.\n2. Force back the person at the top of the list.\n3. Log it here; they move to the bottom."]);
  for (const p of people.filter(x => x.div === "Communications" && x.pattern.startsWith("comms"))) {
    const last = rnd() < 0.2 ? null : iso(addDays(today, -Math.floor(rnd() * 120)));
    await c.query(`INSERT INTO fb_members (list_id, user_id, name, shift, last_fb, last_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [list, p.id, p.name, `${p.pattern.slice(-1)} crew`, last, last ? "QH" : ""]);
  }

  // Technology on-call weeks
  for (let w = -1; w < 6; w++) {
    const start = addDays(today, w * 7 - today.getDay() + 4);
    const p = w % 2 ? tech : people.find(x => x.title === "Communications Manager");
    await c.query(`INSERT INTO callout_entries (id, division_id, start_date, end_date, position, user_id, person_name, phone) VALUES ($1,$2,$3,$4,1,$5,$6,'(555) 010-9911')`,
      [uuid(), D("Technology"), iso(start), iso(addDays(start, 6)), p.id, p.name]);
  }

  // Settings that point at the demo data; St. George's own PIAL grading and Aladtec link are not shown here
  const setting = (k, v) => c.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)]);
  await setting("stats_units", { pattern: "^([A-Z]{2}1[1-4]1|BC\\d+)$" });
  await setting("board", { agency: "DEMO FD" });
  await setting("recall", { portalUrl: "" });
  await c.query("UPDATE pial_settings SET data = (data - 'baseline') || '{\"cadAgency\": \"DEMO FD\"}'::jsonb").catch(() => {});
  await c.query("UPDATE fire_departments SET name = $1 WHERE name = 'St. George Fire Protection District'", [process.env.ORG_NAME || "Demo Fire District"]).catch(() => {});

  // Everyone who signs up gets to look at everything (Fire Chief profile = view in every section); edit rights come from their role
  const group = uuid();
  await c.query(`INSERT INTO access_groups (id, name, description, rules) VALUES ($1, 'Sandbox testers', 'Every approved account: sees every section (sandbox)', $2)`,
    [group, JSON.stringify({ roles: ["user", "approver1", "approver2", "fire_chief", "accounting", "master"] })]);
  await c.query(`INSERT INTO access_profile_members (id, profile_key, group_id, added_by) VALUES ($1, 'firechief', $2, 'Sandbox setup')`, [uuid(), group]);

  await setting("sandbox_seed", { at: new Date().toISOString(), people: people.length });
  console.log(`Demo department added: ${people.length} people, ${vendors.length} vendors, ${REQS.length} requisitions, ${TICKETS.length} tickets.`);
});
await pool.end?.();
