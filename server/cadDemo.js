// Made-up active calls for a sandbox (CAD_DEMO=on, the default on a sandbox with no CAD set up). The same minute always
// gives the same calls, so every viewer sees one consistent "CAD": calls come in every few minutes, units go dispatched ->
// enroute -> on scene -> clear, and each call drops off after 20–70 minutes. Streets and call numbers are invented.
const TYPES = [
  ["MEDICAL", 2, ["M"]], ["MEDICAL", 2, ["M", "E"]], ["FALL / LIFT ASSIST", 3, ["E"]], ["FIRE ALARM", 2, ["E", "L"]],
  ["STRUCTURE FIRE", 1, ["E", "E", "L", "M", "BC"]], ["VEHICLE CRASH", 2, ["E", "M"]], ["GAS LEAK", 2, ["E"]],
  ["GRASS FIRE", 2, ["E", "B"]], ["SMOKE INVESTIGATION", 2, ["E"]], ["CARDIAC ARREST", 1, ["M", "E"]], ["ELEVATOR RESCUE", 3, ["L"]],
  ["WIRES DOWN", 3, ["E"]], ["VEHICLE FIRE", 2, ["E"]], ["BREATHING PROBLEMS", 2, ["M", "E"]],
];
const STREETS = ["Oak Hollow Dr", "Magnolia Bend Rd", "Cypress Point Ave", "Riverside Pkwy", "Pecan Grove Ln", "Willow Creek Blvd", "Bayou Trace Ct",
  "Live Oak St", "Sycamore Ridge Rd", "Heron Landing Dr", "Old Mill Rd", "Cedar Crest Ave", "Fairway View Dr", "Meadowlark Ln", "Timber Ridge Rd"];
const STATIONS = [11, 12, 13, 14];
const KIND = { E: "EG", L: "LD", M: "MD", B: "BR" };   // unit = kind + station + 1 (EG111, MD131), like the demo stats
const pad = n => String(n).padStart(2, "0");
const wall = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// Small seeded random numbers (mulberry32)
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export function demoCalls(now = new Date(), lat = 30.37, lon = -91.01) {
  const SLOT = 7 * 60_000;                                  // one possible call every 7 minutes
  const nowSlot = Math.floor(now.getTime() / SLOT);
  const rows = [];
  for (let s = nowSlot - 12; s <= nowSlot; s++) {           // calls from the last ~84 minutes
    const r = rng(s * 7919);
    if (r() < 0.25) continue;                                // some slots are quiet
    const received = new Date(s * SLOT + Math.floor(r() * SLOT));
    if (received > now) continue;
    const life = (20 + Math.floor(r() * 50)) * 60_000;
    const age = now - received;
    if (age > life) continue;
    const [type, priority, kinds] = TYPES[Math.floor(r() * TYPES.length)];
    const st = STATIONS[Math.floor(r() * STATIONS.length)];
    const units = [...new Set(kinds.map((k, i) => k === "BC" ? "BC1" : `${KIND[k]}${k === "E" && i > 0 ? STATIONS[(STATIONS.indexOf(st) + i) % STATIONS.length] : st}1`))];
    const mins = age / 60_000;
    const status = u => mins < 1 ? "Dispatched" : mins < 2 + (u.length % 3) ? "Enroute" : /^MD/.test(u) && mins > 8 ? "Patient contact" : "On scene";
    const pending = mins < 0.75 && r() < 0.5;               // a few sit unassigned for the first moments
    const num = 100000 + (s % 900000);
    rows.push({
      incident_id: `demo-${s}`, incident_number: `${received.getFullYear()}-${String(num).slice(-6)}`,
      call_type: type, priority, agency: "DEMO FD",
      address: `${100 + Math.floor(r() * 9800)} ${STREETS[Math.floor(r() * STREETS.length)]}`, city: "Demo",
      cross_streets: `${STREETS[Math.floor(r() * STREETS.length)]} / ${STREETS[Math.floor(r() * STREETS.length)]}`,
      latitude: +(lat + (r() - 0.5) * 0.12).toFixed(5), longitude: +(lon + (r() - 0.5) * 0.14).toFixed(5),
      units: pending ? "" : units.map(u => `${u}:${status(u)}`).join(", "),
      received_at: wall(received), closed_at: null,
    });
  }
  return rows.sort((a, b) => b.received_at.localeCompare(a.received_at));
}
