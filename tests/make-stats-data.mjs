// Fake closed incidents for Comms statistics tests (deterministic)
import fs from "node:fs";
let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pickW = list => { const t = list.reduce((s, x) => s + x[1], 0); let r = rnd() * t; for (const [v, w] of list) if ((r -= w) <= 0) return v; return list[0][0]; };
const agencies = [["SGFD", 55], ["ZFD", 20], ["BFD", 15], ["EFD", 10]];
const natures = [["MEDICAL EMS", 58], ["MOTOR VEHICLE ACCIDENT", 9], ["PUBLIC SERVICE", 8], ["COMMERCIAL ALARM", 7], ["RESIDENTIAL ALARM", 3], ["INVESTIGATION", 2], ["HAZ MAT", 2], [".FIRE DEFAULT", 1.5], ["ELECTRICAL", 1], ["STRUCTURE FIRE", 1], ["GRASS FIRE", 1], ["", 0.5]];
const disps = [["CCF", 80, "Call Completed"], ["CBE", 5, "Canceled by EMS"], ["CEF", 3, "Canceled Enroute"], ["DUPF", 3, "Duplicate Call"], ["FAF", 2.5, "False Alarm"], ["UFF", 1.5, "Unfounded"], ["XQZ", 1, ""], ["", 3, ""]];
const hourW = [3,2.6,2.3,2,1.8,2,3,4.5,6,7,7.5,8,8.2,8,7.8,7.6,7.4,7,6.5,6,5.5,5,4.4,3.6];
const pad = n => String(n).padStart(2, "0");
const fmt = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; };
const rows = []; let n = 0;
for (let day = Date.UTC(2025, 0, 1); day <= Date.UTC(2026, 9, 29); day += 86400000) {
  const d = new Date(day), month = d.getUTCMonth(), dow = d.getUTCDay();
  const year = d.getUTCFullYear();
  const base = 62 * (1 + 0.08 * Math.sin((month - 2) / 12 * 2 * Math.PI)) * (dow === 6 ? 1.05 : 1) * (year === 2026 ? 1.03 : 1);
  const count = Math.round(base * (0.85 + rnd() * 0.3));
  for (let i = 0; i < count; i++) {
    const hour = pickW(hourW.map((w, h) => [h, w]));
    const received = day + hour * 3600000 + Math.floor(rnd() * 3600) * 1000;
    const self = rnd() < 0.03;
    const proc = Math.round(35 + rnd() * 80);
    let hold = Math.round(Math.exp(Math.log(50) + (rnd() + rnd() + rnd() - 1.5) * 0.9));
    if (hour < 6) hold += 20;
    if (rnd() < 0.004) hold = 900 + Math.round(rnd() * 1800);
    const dispatched = rnd() > 0.04;
    const queued = received + proc * 1000, assigned = dispatched ? (self ? received : queued + hold * 1000) : null;
    const code = pickW(disps.map(x => [x[0], x[1]])), desc = disps.find(x => x[0] === code)[2];
    const ct = `C${101 + Math.floor(rnd() * 8)}`, dp = `D${201 + Math.floor(rnd() * 6)}`;
    rows.push({ INCIDENT_ID: `I${++n}`, incident_number: `${year}-${String(n).padStart(6, "0")}`, agency: pickW(agencies), received_at: fmt(received),
      queued_at: self ? null : fmt(queued), assigned_at: assigned ? fmt(assigned) : null, closed_at: fmt(received + 3600000),
      nature: pickW(natures), priority: String(pickW([["1", 30], ["2", 50], ["3", 20]])), disposition: code, disposition_description: desc,
      call_taker: self ? "" : ct, call_taker_name: ct === "C101" ? "Dana Day" : "", dispatcher: dp, dispatcher_name: "", self_initiated: self ? 1 : 0, dispatched: dispatched ? 1 : 0 });
  }
}
fs.writeFileSync(process.argv[2] || "stats-mock.json", JSON.stringify(rows));
console.log(rows.length, "incidents");
