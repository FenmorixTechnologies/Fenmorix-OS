// Sample "FireWorks Ad-Hoc" exports for PIAL tests (deterministic)
import fs from "node:fs";
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const out = (f, rows) => fs.writeFileSync(`/home/claude/testrun/pial/${f}`, rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(",")).join("\r\n"));
const first = ["James", "Mary", "Robert", "Linda", "Michael", "Sarah", "David", "Karen", "Chris", "Nancy", "Daniel", "Lisa", "Paul", "Amy", "Mark", "Donna", "Steven", "Carol", "Kevin", "Laura"];
const last = ["Landry", "Hebert", "Guidry", "Broussard", "Thibodeaux", "Fontenot", "LeBlanc", "Richard", "Boudreaux", "Breaux", "Comeaux", "Arceneaux"];
const ranks = [["Captain", 6], ["Lieutenant", 6], ["Driver/Operator", 8], ["Firefighter", 20]];
const members = []; let n = 1000;
for (const [rank, count] of ranks) for (let i = 0; i < count; i++) {
  const name = `${first[(members.length * 7) % 20]} ${last[(members.length * 5) % 12]}${members.length > 11 ? " " + String.fromCharCode(65 + (members.length % 26)) : ""}`;
  members.push({ id: `SG${++n}`, name, rank, shift: "ABC"[members.length % 3], hire: members.length === 38 ? "2026-03-02" : `20${10 + (members.length % 12)}-0${1 + (members.length % 8)}-15` });
}
members.push({ id: "SG2001", name: "Retired Person", rank: "Firefighter", shift: "A", hire: "2001-05-01", end: "2025-12-31" });
out("roster.csv", [["Emp ID", "Last Name", "First Name", "Rank", "Position", "Date Entered Rank", "Hire Date", "Separation Date", "Shift", "Driver Since"],
  ...members.map((m, i) => [m.id, m.name.split(" ").slice(1).join(" "), m.name.split(" ")[0], m.rank, m.rank === "Firefighter" ? "Suppression" : m.rank, "2020-01-01", m.hire, m.end || "", m.shift, m.rank === "Driver/Operator" ? (i === 12 ? "2026-02-01" : "2018-06-01") : ""])]);
out("certs.csv", [["Employee Number", "Name", "Certification", "Issue Date"], ...members.flatMap((m, i) => [
  [m.id, m.name, "Firefighter I (IFSAC)", "2015-05-01"], ...(i % 3 === 0 ? [[m.id, m.name, "Hazardous Materials Operations", "2016-01-01"]] : []),
  ...(m.rank === "Captain" || (m.rank === "Lieutenant" && i % 2) ? [[m.id, m.name, "Fire Officer I", "2019-03-01"]] : []),
  ...(i % 4 !== 3 ? [[m.id, m.name, "ICS-100 Introduction to ICS", "2023-04-01"]] : []), ...(i === 5 ? [[m.id, m.name, "Pro Board Firefighter II", "2020-01-01"]] : [])])]);
const train = [["Emp ID", "Member Name", "Training Date", "Hrs", "Training Type", "Course Title", "Location", "Delivery Method"]];
for (let d = Date.UTC(2026, 0, 2); d <= Date.UTC(2026, 9, 31); d += 86400000 * 3) {
  const date = new Date(d).toISOString().slice(0, 10);
  for (const [i, m] of members.entries()) {
    if (m.end || (i + d / 86400000) % 3 > 0.5) continue;           // each member about every 9 days
    if (i === 30) continue;                                          // one member never trains
    const r = rnd();
    const [type, title, hrs, loc, del] = r < 0.55 ? ["Company Drill", "Hose operations", 3 + (i % 3), i % 4 === 0 ? "Training Ground - Burn Building" : "Station", "In-House"]
      : r < 0.65 ? ["Online CE", "Target Solutions module", 2, "Online", "Online"]
      : r < 0.72 ? ["Driver/Operator Pump Ops", "Pump operations", 2, "Station", "In-House"]
      : r < 0.80 ? ["Officer Development", "Fireground leadership", 2, "HQ", "In-House"]
      : r < 0.84 ? ["HazMat Ops Refresher", "Product ID", 1.5, "HQ", "In-House"]
      : r < 0.88 ? ["LSU FETI", "Structural fire tactics", 8, "LSU", "Outside"]
      : r < 0.93 ? ["EMS CE", "Airway", 2, "HQ", "In-House"] : ["Company Drill", "Ventilation", "2:30", "Training Ground", "In-House"];
    train.push([m.id, m.name, date, hrs, type, title, loc, del]);
  }
}
for (let k = 0; k < 40; k++) train.push([members[38].id, members[38].name, `2026-0${3 + Math.floor(k / 10)}-${String(1 + (k % 10) * 2).padStart(2, "0")}`, 6, "Recruit Academy", "FF I", "Training Ground", "In-House"]);
train.push(["SG9999", "Visiting Person", "2026-04-04", 3, "Company Drill", "Joint drill", "Station", "In-House"]);
out("training.csv", train);
const fires = [["Incident Number", "Alarm Date", "Alarm Time", "Property Type", "Hose Used", "Personnel", "First Engine Seconds", "Full Complement Seconds"]];
for (let i = 0; i < 26; i++) { const w = i % 3 !== 2; fires.push([`26-${String(1000 + i * 37)}`, `${1 + (i % 10)}/${1 + i}/2026`, `${String(i % 24).padStart(2, "0")}:15`, i % 4 ? "Residential" : "Commercial", w ? "Y" : "N", w ? 6 + (i % 5) : 4, 200 + i * 9, w ? 400 + i * 12 : ""]); }
out("fires.csv", fires);
out("tests.csv", [["Test Type", "Unit", "Test Date", "Result"],
  ...["E61", "E62", "E63"].flatMap(u => [["Pump", u, "2026-05-10", "Pass"], ["Pump", u, "2025-05-12", "Pass"], ["Pump", u, u === "E63" ? "2022-05-01" : "2024-05-15", "Pass"]]),
  ["Pump", "E61", "2026-05-10", "Pass"], ["Aerial", "L61", "2026-06-01", "Pass"], ["Aerial", "L61", "2025-06-01", "Pass"], ["Aerial", "L61", "2024-06-01", "Pass"],
  ["Hose", "All hose", "2026-04-01", "Pass"], ["Hose", "All hose", "2025-04-01", "Pass"], ["Hose", "All hose", "2024-04-01", "Pass"],
  ["Hydrant inspection", "District", "2026-03-01", "Pass"], ["Hydrant inspection", "District", "2025-03-01", "Pass"], ["Hydrant inspection", "District", "2023-03-01", "Pass"],
  ["Hydrant flow test", "District", "2024-09-01", "Pass"], ["Hydrant flow test", "District", "2019-09-01", "Pass"], ["Hydrant flow test", "District", "2014-09-01", "Pass"],
  ["SOP", "Response of Apparatus", "2023-01-10", "Pass"], ["SOP", "Fire Suppression", "2019-01-10", "Pass"], ["Sop", "Training", "2025-07-01", "Pass"], ["Widget", "X", "2026-01-01", "Pass"]]);
console.log(members.length, "members,", train.length - 1, "training rows");
