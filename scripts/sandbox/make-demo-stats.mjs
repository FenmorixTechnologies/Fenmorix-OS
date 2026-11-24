// Made-up closed calls for a sandbox's Communications Statistics, Board Report and apparatus pages.
//   node scripts/sandbox/make-demo-stats.mjs <calls.json> <units.json>
// Covers the last 540 days up to yesterday. Each day's calls come from that day's own seed, so running it again
// (the nightly timer does) adds the new day and leaves every earlier day exactly as it was.
// .env on the sandbox: CAD_STATS_TEST_FILE=<calls.json>  CAD_STATS_UNITS_TEST_FILE=<units.json>  CAD_STATS_START=<first day>
import fs from "node:fs";

const [callsFile = "demo-calls.json", unitsFile = "demo-units.json"] = process.argv.slice(2);
const rngFor = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pickW = (rnd, list) => { const t = list.reduce((s, x) => s + x[1], 0); let r = rnd() * t; for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
const AGENCIES = [["DEMO FD|11", 22], ["DEMO FD|12", 18], ["DEMO FD|13", 12], ["DEMO FD|14", 8], ["Northside FD|N1", 18], ["Lakeview FD|L1", 14], ["Lakeview FD|L2", 8]];
const NATURES = [["MEDICAL EMS", 58], ["MOTOR VEHICLE ACCIDENT", 9], ["PUBLIC SERVICE", 8], ["COMMERCIAL ALARM", 7], ["RESIDENTIAL ALARM", 3], ["INVESTIGATION", 2],
  ["HAZ MAT", 2], ["ELECTRICAL", 1], ["STRUCTURE FIRE", 1], ["GRASS FIRE", 1], ["VEHICLE FIRE", 1]];
const HOUR_W = [3, 2.6, 2.3, 2, 1.8, 2, 3, 4.5, 6, 7, 7.5, 8, 8.2, 8, 7.8, 7.6, 7.4, 7, 6.5, 6, 5.5, 5, 4.4, 3.6];
const TAKERS = [["C101", "Avery Collins"], ["C102", "Jordan Pike"], ["C103", "Morgan Reyes"], ["C104", "Casey Lund"], ["C105", "Riley Shaw"], ["C106", "Taylor Brooks"]];
const DISPATCHERS = [["D201", "Quinn Harper"], ["D202", "Skyler Dunn"], ["D203", "Rowan Ellis"], ["D204", "Blake Moreno"]];
const pad = n => String(n).padStart(2, "0");
const fmt = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };

const now = new Date();
const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const first = today - 540 * 86400000;
const calls = [], units = [];
for (let day = first; day < today; day += 86400000) {
  const rnd = rngFor(Math.floor(day / 86400000) * 7 + 1);
  const d = new Date(day), month = d.getUTCMonth(), dow = d.getUTCDay();
  const base = 48 * (1 + 0.08 * Math.sin((month - 2) / 12 * 2 * Math.PI)) * (dow === 6 ? 1.05 : 1);
  const count = Math.round(base * (0.85 + rnd() * 0.3));
  const ymd = `${d.getUTCFullYear()}${pad(month + 1)}${pad(d.getUTCDate())}`;
  for (let i = 0; i < count; i++) {
    const hour = pickW(rnd, HOUR_W.map((w, h) => [h, w]));
    const received = day + hour * 3600000 + Math.floor(rnd() * 3600) * 1000;
    const self = rnd() < 0.03;
    const proc = Math.round(35 + rnd() * 80);
    let hold = Math.round(Math.exp(Math.log(48) + (rnd() + rnd() + rnd() - 1.5) * 0.9));
    if (hour < 6) hold += 20;
    if (rnd() < 0.004) hold = 900 + Math.round(rnd() * 1800);
    const dispatched = rnd() > 0.04;
    const queued = received + proc * 1000, assigned = dispatched ? (self ? received : queued + hold * 1000) : null;
    const [agency, zone] = pickW(rnd, AGENCIES).split("|");
    const nature = pickW(rnd, NATURES);
    const ct = TAKERS[Math.floor(rnd() * TAKERS.length)], dp = DISPATCHERS[Math.floor(rnd() * DISPATCHERS.length)];
    const id = `D${ymd}-${i}`, number = `${d.getUTCFullYear()}-${ymd.slice(4)}${String(i).padStart(3, "0")}`;
    calls.push({ INCIDENT_ID: id, incident_number: number, agency, zone, received_at: fmt(received), queued_at: self ? null : fmt(queued),
      assigned_at: assigned ? fmt(assigned) : null, closed_at: fmt(received + 3600000), nature, priority: String(pickW(rnd, [["1", 30], ["2", 50], ["3", 20]])),
      call_taker: self ? "" : ct[0], call_taker_name: self ? "" : ct[1], dispatcher: dp[0], dispatcher_name: dp[1], self_initiated: self ? 1 : 0, dispatched: dispatched ? 1 : 0 });
    // Our units on our dispatched calls (apparatus pages, Board Report response times)
    if (agency === "DEMO FD" && assigned) {
      const st = zone;
      const kinds = /MEDICAL/.test(nature) ? ["MD", ...(rnd() < 0.5 ? ["EG"] : [])] : /STRUCTURE/.test(nature) ? ["EG", "EG", "LD", "MD", "BC"]
        : /ALARM|FIRE|HAZ|ELECTRICAL|INVESTIGATION/.test(nature) ? ["EG", ...(rnd() < 0.3 ? ["LD"] : [])] : ["EG"];
      kinds.forEach((k, j) => {
        const unit = k === "BC" ? "BC1" : `${k}${j > 0 && k === "EG" ? String(11 + ((Number(st) - 11 + j) % 4)) : st}1`;
        const a = assigned + j * 20000, en = a + (40 + Math.floor(rnd() * 70)) * 1000;
        const ar = en + (180 + Math.floor(rnd() * 360) + (j ? 120 : 0)) * 1000, cl = ar + (10 + Math.floor(rnd() * 50)) * 60000;
        units.push({ incident_id: id, incident_number: number, agency, nature, unit, assigned_at: fmt(a), enroute_at: fmt(en),
          arrived_at: rnd() < 0.06 ? null : fmt(ar), cleared_at: fmt(cl) });
      });
    }
  }
}
fs.writeFileSync(callsFile, JSON.stringify(calls));
fs.writeFileSync(unitsFile, JSON.stringify(units));
console.log(`${calls.length} calls, ${units.length} unit responses, ${fmt(first).slice(0, 10)} to yesterday`);
console.log(`CAD_STATS_START=${fmt(first).slice(0, 10)}`);
