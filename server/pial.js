// PIAL tracker (/api/pial/*): where the district stands against the 2012 ISO Fire Suppression Rating
// Schedule as applied by PIAL (Louisiana Addendum, 6/16/2016), with the records behind each item.
// See db/migrations/019_pial.sql.
//
// Sources for the numbers below (documents Michael provided):
//   - 2012 FSRS Points of Credit (section maximums: 10 / 50+ / 40 / 5.5 = 105.5)
//   - PIAL "FSRS Relative Point Value Guide" (item weights, equipment relative points)
//   - Louisiana Addendum, updated January 1, 2021 (testing-interval credit tables, 12-hr personnel training cap, 320 s / 560 s
//     deployment criteria, NFPA 1221 answer criteria, 10 required SOPs, IMS within 5 years ...)
//   - PPC Questionnaire (worksheets: roster, on-duty strength, working / non-working fires, stations &
//     equipment, training summary, pump / aerial tests)
// Formulas checked against the 2012 ISO FSRS itself (sections 410-1101). Training targets are the FSRS figures
// (editable in settings). Everything here is an ESTIMATE to steer the work; PIAL's field visit decides the grade.
import { risky } from "./saferegex.js";
import { brand, brandText, brandDeep } from "./brand.js";
import crypto from "node:crypto";
import { pool } from "./db.js";
import { hasAccess, accessScope } from "./access.js";
import { parseCsv } from "./csv.js";
import { guessCategory } from "./isoKinds.js";
export { parseCsv, guessCategory };

const err = (status, message) => Object.assign(new Error(message), { status });
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const txt = (v, n) => String(v ?? "").trim().slice(0, n);
const r2 = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 100) / 100);
const r3 = v => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 1000) / 1000);
const clamp01 = v => Math.max(0, Math.min(1, v));
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z"));
const D = s => new Date(s + "T00:00:00Z");
const S = d => d.toISOString().slice(0, 10);
const addMonths = (s, n) => { const d = D(s); d.setUTCMonth(d.getUTCMonth() + n); return S(d); };
const monthsBetween = (a, b) => (D(b).getUTCFullYear() - D(a).getUTCFullYear()) * 12 + (D(b).getUTCMonth() - D(a).getUTCMonth()) + (D(b).getUTCDate() - D(a).getUTCDate()) / 31;
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

// ---- Catalog ----------------------------------------------------------------------------------------
export const SECTION_LIST = [
  { key: "comms", title: "Emergency Communications", max: 10 },
  { key: "fd", title: "Fire Department", max: 50 },
  { key: "water", title: "Water Supply", max: 40 },
  { key: "crr", title: "Community Risk Reduction", max: 5.5 },
];
const I = (key, section, group, code, title, max, owner, kind, extra = {}) => ({ key, section, group, code, title, max, owner, kind, ...extra });
export const CATALOG = [
  // Emergency Communications (10)
  I("c414", "comms", "414 Emergency Reporting", "410", "911, wireless, VoIP, CAD and GIS/AVL features", 3, "Communications", "features",
    { help: "Checklist from the PIAL guide: Enhanced 911 plus wireless Phase I/II, static/nomadic VoIP, CAD (basic, MIS, interoperability) and GIS/AVL add up to 3.0." }),
  I("c420a1", "comms", "422 Telecommunicators", "420-A-1", "Alarm receipt (answer times)", 0.8, "Communications", "answer",
    { help: "NFPA 1221: 95% of emergency calls answered within 15 s and 99% within 40 s. Half the credit each, prorated (Addendum 420A1). From the phone system's Call Detail Report." }),
  I("c420a2", "comms", "422 Telecommunicators", "420-A-2", "Alarm processing (dispatch times)", 0.8, "Communications", "processing",
    { help: "2021 Addendum: fire, EMS and rescue calls (not law enforcement) - 90% processed within 64 s and 95% within 106 s, from receipt to the start of dispatch. Calls transferred to another PSAP: transfer within 30 s on 95%. Calculated from CAD when connected." }),
  I("c420b", "comms", "422 Telecommunicators", "420-B", "Emergency dispatch protocols", 0.8, "Communications", "manual"),
  I("c420c", "comms", "422 Telecommunicators", "420-C", "Telecommunicator training and certification", 0.8, "Communications", "manual",
    { help: "APCO ANS 3.103.1-2010 baseline training, plus certification for each telecommunicator." }),
  I("c420d", "comms", "422 Telecommunicators", "420-D", "Continuing education and quality assurance", 0.8, "Communications", "manual",
    { help: "Program run all year, attendance and records kept, QA outcomes evaluated with remedial training. Incomplete documentation = 25% deduction; none = no credit." }),
  I("c431", "comms", "432 Dispatch Circuits", "431", "Dispatch circuits", 1.2, "Communications", "manual",
    { help: "More than 730 alarms a year needs two independent dispatch circuits. Third-party paging as a secondary circuit earns 50%." }),
  I("c431b", "comms", "432 Dispatch Circuits", "431-B", "Monitoring for integrity", 0.9, "Communications", "manual"),
  I("c431c", "comms", "432 Dispatch Circuits", "431-C", "Emergency power supply systems", 0.9, "Communications", "epss",
    { help: "Generators (UPS alone doesn't count) at the PSAP, repeater sites and stations with dispatch equipment. Weekly inspections and 30 min/month under load from a cold start (NFPA 110). Partial records = 25% reduction; none = no credit." }),
  // Fire Department (50)
  I("f513", "fd", "Companies and equipment", "513", "Engine companies, response and equipment", 6, "Suppression", "apparatus", { types: ["engine"] }),
  I("f523", "fd", "Companies and equipment", "523", "Reserve pumpers and equipment", 0.5, "Suppression", "reserve", { types: ["reserve_engine"], of: ["engine"] }),
  I("f532", "fd", "Companies and equipment", "532", "Pump capacity", 3, "Suppression", "manual",
    { help: "In-service, reserve and automatic-aid pump capacity against the Basic Fire Flow. Totals from the apparatus list are shown for reference." }),
  I("f549", "fd", "Companies and equipment", "549", "Ladder / service companies and equipment", 4, "Suppression", "apparatus", { types: ["ladder", "service"] }),
  I("f553", "fd", "Companies and equipment", "553", "Reserve ladder / service companies", 0.5, "Suppression", "reserve", { types: ["reserve_ladder", "reserve_service"], of: ["ladder", "service"] }),
  I("f561", "fd", "Deployment", "561", "Deployment analysis", 10, "Suppression", "deployment",
    { help: "Road-mile study (1.5 mi engines 60%, 2.5 mi ladder/service 40%) or CAD data: first engine on scene within 320 s of dispatch and full complement within 560 s, on 90% of structure fires. PIAL uses whichever is higher." }),
  I("f571", "fd", "Personnel", "571", "Personnel (on-duty and responding)", 15, "Administration", "personnel",
    { help: "Average on-duty strength plus off-duty/volunteer response to working structure fires; each on-call or off-duty firefighter counts as half an on-duty firefighter (2021 Addendum 570C). Scheduled trainings, meetings and workdays in the district with apparatus and gear at hand count as on-duty time (570A). Extra storm staffing isn't credited. Members credited are capped at those with 12+ hours of training and at available PPE ensembles." }),
  I("t580a", "fd", "581 Training (max 9)", "580-A", "Training facilities and their use", 3.15, "Training", "t_facility",
    { help: "Fire building with smoke room 1.53, drill tower 0.90, 2-acre area 0.72, prorated by use: 18 hrs per member per year at the facility (FSRS 580A). The ground must be owned or leased by the department/AHJ and used only for fire training (2021 Addendum: a lease must state length, acreage and exclusive use). NFPA-compliant mobile props count regardless of ownership." }),
  I("t580b", "fd", "581 Training (max 9)", "580-B", "Company training", 2.25, "Training", "t_company",
    { help: "16 hrs per member per month, capped each month (FSRS 580B). Computer-based training counts up to 8 of the 16 each month; interactive virtual training (Zoom/Teams, 2021 Addendum) counts fully; training from outside the department counts half." }),
  I("t580c1", "fd", "581 Training (max 9)", "580-C-1", "Officer certification", 0.54, "Training", "t_officer_cert",
    { help: "Officers who respond on first alarm, certified to NFPA 1021 (Fire Officer I or higher)." }),
  I("t580c2", "fd", "581 Training (max 9)", "580-C-2", "Officer continuing education", 0.54, "Training", "t_officer_ce", { help: "12 hrs per officer per year (FSRS)." }),
  I("t580e", "fd", "581 Training (max 9)", "580-E", "Existing driver / operator training", 0.45, "Training", "t_driver",
    { help: "12 hrs per driver per year (FSRS), on the graded area's own apparatus." }),
  I("t580d", "fd", "581 Training (max 9)", "580-D", "New driver / operator training", 0.45, "Training", "t_new_driver", { help: "60 hrs for each new driver/operator (FSRS)." }),
  I("t580f", "fd", "581 Training (max 9)", "580-F", "Hazardous materials training", 0.09, "Training", "t_hazmat", { help: "6 hrs per member per year (FSRS), NFPA 472 levels." }),
  I("t580g", "fd", "581 Training (max 9)", "580-G", "Recruit training", 0.45, "Training", "t_recruit",
    { help: "240 hrs for each recruit (FSRS), leading to FF I/II within the first year of membership." }),
  I("t580h", "fd", "581 Training (max 9)", "580-H", "Pre-incident planning", 1.08, "Training", "t_preplan",
    { help: "Commercial, industrial, institutional and 4+ unit buildings pre-planned. Frequency factor from the average interval of the 3 most recent inspections (1 yr = 1.00 ... 5 yrs = 0.42)." }),
  I("t580i", "fd", "581 Training (max 9)", "IFSAC", "IFSAC certification bonus", 3, "Training", "t_ifsac",
    { help: "Up to 3 bonus points: members with an IFSAC or equivalent certification (FF I/II, Instructor I-III, Driver/Operator, Pumper, Aerial, Fire Officer I-III, HazMat Awareness/Operations/Technician) who also have 45+ hrs of company training in the district, divided by all members. Certificates must be dated by the end of the graded year. Training total is capped at 9." }),
  I("o710", "fd", "730 Operational Considerations", "710", "Standard operating procedures", 1, "Administration", "sops",
    { help: "Ten SOPs, 0.1 each, dated and reviewed within the graded year and the 4 years before it." }),
  I("o720", "fd", "730 Operational Considerations", "720", "Incident management system training", 1, "Training", "ims",
    { help: "Every member trained to their level (NIMS 100, an acceptable college-level Incident Command class, or a locally developed equivalent), dated within 5 years. An SOP doesn't replace training." }),
  // Water Supply (40)
  I("w616", "water", "Water supply", "616", "Supply system (supply works, mains, hydrant distribution)", 30, "Administration", "manual",
    { help: "Calculated by PIAL from the water system: storage, pumping, main capacity at target buildings and hydrants within 1,000 ft. Enter the estimate from the water utility or the last grading." }),
  I("w621", "water", "Water supply", "621", "Hydrant size, type and installation", 3, "Administration", "manual"),
  I("w630a", "water", "631 Inspection and fire flow testing", "630-A", "Hydrant inspection frequency", 4, "Administration", "hydrant_inspect",
    { help: "FSRS 630A: average interval of the 3 most recent inspections (1 yr 30 pts, 2 yrs 20, 3 yrs 10, 4 yrs 5), +10 if inspections include flushing, +10 for a pressure test, +20 for drafting/back-flushing dry hydrants, out of 50. Partial records lose 25%." }),
  I("w630b", "water", "631 Inspection and fire flow testing", "630-B", "Hydrant fire flow testing", 3, "Administration", "hydrant_flow",
    { help: "FSRS 630B: average interval of the 3 most recent flow-test cycles (5 yrs or less 40 pts, 6 yrs 30, 7 yrs 20, 8 yrs 10, 9 yrs 5), +25% with a hydrant marking program (NFPA 291 / AWWA M17), out of 50. Partial records lose 25%. PIAL flows at least two hydrants on the main (NFPA 291 2019, ch. 4)." }),
  I("w2400", "water", "Louisiana hydrant data bonus", "2400", "Hydrant location data submitted (+0.50 to the final score)", 0.5, "Administration", "hydrant_bonus",
    { bonus: true, help: "2021 Addendum 2400-2403: 0.50 added to the final score when every in-service hydrant (or draft site) is submitted with the rating packet: department, hydrant number, location, graded area, longitude and latitude (5+ decimal places) and type." }),
  // Community Risk Reduction (5.5) - only for a fire prevention bureau authorized by the OSFM
  ...[["1021", "Fire prevention code adoption dates", 0.55], ["1022", "Fire prevention staffing (inspections by OSFM-certified inspectors)", 0.44],
    ["1023-A", "Fire inspector certification and training", 0.165], ["1023-B", "Fire inspector continuing education (24 hrs/yr max)", 0.165],
    ["1024-A", "Plan review", 0.33], ["1024-B", "Certificate of occupancy inspections", 0.22], ["1024-C", "Quality assurance for inspections", 0.055],
    ["1024-D", "Code compliance follow-up", 0.055], ["1024-E", "Private fire protection equipment inspections", 0.055],
    ["1024-F", "Fire prevention ordinances", 0.11], ["1024-G", "Coordination with training and pre-incident planning", 0.055]]
    .map(([code, title, max]) => I(`p${code.replace("-", "").toLowerCase()}`, "crr", "1020 Fire Prevention Code and Enforcement", code, title, max, "Fire Prevention", code === "1022" ? "inspections" : "manual",
      code === "1022" ? { help: "FSRS 1022 + 2021 Addendum: PS = 8 × nonresidential properties inspected in the graded year ÷ nonresidential properties, inspections by OSFM-certified inspectors only, partial records −25%. PIAL checks a sample (10 or more) of the records. Calculated from Fire Prevention's FireWorks inspection report." } : undefined)),
  ...[["1031-A", "Public fire safety educator qualifications", 0.275], ["1031-B", "Educator continuing training (10 hrs/yr max)", 0.275],
    ["1032-A", "Residential fire safety program", 0.55], ["1032-B1", "Population reached by certified educators", 0.275],
    ["1032-B2", "Fire safety in schools and fire drills (Pre-K to 12)", 0.275], ["1032-C", "Juvenile firesetter intervention", 0.275],
    ["1032-D", "Education for large-loss or hazardous occupancies", 0.275]]
    .map(([code, title, max]) => I(`e${code.replace("-", "").toLowerCase()}`, "crr", "1030 Public Safety Education", code, title, max, "Community Relations", "manual")),
  ...[["1041-A", "Fire investigation organization", 0.22], ["1041-B", "Fire investigation staffing", 0.22],
    ["1042-A", "Fire investigator certification", 0.165], ["1042-B", "Investigator continuing education (40 hrs / 8 hrs)", 0.165],
    ["1043", "Use of the Louisiana Fire Incident Reporting System", 0.33]]
    .map(([code, title, max]) => I(`i${code.replace("-", "").toLowerCase()}`, "crr", "1040 Fire Investigation", code, title, max, "Fire Prevention", "manual")),
];
const ITEM = Object.fromEntries(CATALOG.map(i => [i.key, i]));
// Which item a record type belongs to (decides who can edit it)
export const TEST_KINDS = {
  pump: { label: "Pump service test", item: "f513", every: 12 }, hose: { label: "Hose service test", item: "f513", every: 12 },
  aerial: { label: "Aerial ladder / platform test", item: "f549", every: 12 }, hydrant_inspection: { label: "Hydrant inspection", item: "w630a", every: 12 },
  hydrant_flow: { label: "Hydrant fire flow test", item: "w630b", every: 60 }, preplan: { label: "Pre-incident planning inspection", item: "t580h", every: 12 },
  epss: { label: "Emergency power (generator) test", item: "c431c", every: 1 }, sop: { label: "SOP review", item: "o710", every: 60 },
};
export const SOPS = ["Response of Apparatus", "Operation of Emergency Vehicles", "Safety at Emergency Incidents", "Communications",
  "Apparatus Inspection and Maintenance", "Fire Suppression", "Company Operations", "Automatic/Mutual Aid Operations", "Training", "Personnel Response"];
const FEATURES = [["basic911", "Basic 911 (no Enhanced 911)", 0.3], ["enhanced911", "Enhanced 911", 0.6], ["wireless1", "Wireless Phase I (static ALI)", 0.3],
  ["wireless2", "Wireless Phase II (dynamic ALI)", 0.45], ["voipStatic", "Static VoIP (static ALI)", 0.3], ["voipNomadic", "Nomadic VoIP (dynamic ALI)", 0.45],
  ["cadBasic", "Basic CAD", 0.15], ["cadMis", "CAD with management information system", 0.15], ["cadInterop", "CAD with interoperability", 0.15], ["gisAvl", "GIS / AVL", 0.45]];
export const TRAINING_CATEGORIES = [["company", "Company training"], ["officer", "Officer training / continuing education"], ["driver", "Driver / operator (existing)"],
  ["new_driver", "New driver / operator"], ["hazmat", "Hazardous materials"], ["recruit", "Recruit (FF I / II)"], ["ims", "Incident management (NIMS / ICS)"],
  ["other", "Not creditable (EMS, admin ...)"]];

// Equipment and their relative points (PIAL guide, pages 6-7). req = quantity needed for full points.
export const EQUIPMENT = {
  engine: { total: 600, items: [
    ["tank", "Water tank (gallons; 1 pt per 10 gal, 300 gal+)", 30, 300, "gal"], ["suction", "15' soft suction (or 15' of 3\"+ hose) or 20' hard suction", 12, 1],
    ["preconnect", "Pre-connected 1½\"–2\" attack hose (feet)", 24, 400, "ft"], ["master", "Master stream appliance, 1,000 gpm", 100, 1],
    ["playpipe", "2½\" playpipe w/ shutoff and 1\", 1⅛\", 1¼\" tips", 20, 1], ["nozzle15", "1½\" or 1¾\" combination nozzle w/ shutoff", 20, 2],
    ["nozzle25", "2½\" combination nozzle w/ shutoff", 30, 1], ["scba", "SCBA (30-minute minimum)", 96, 4], ["cylinders", "Spare SCBA cylinders carried", 24, 4],
    ["salvage", "Salvage covers (12'×14' min)", 4, 2], ["handlights", "Hand lights", 4, 2], ["clamp", "Hose clamp", 4, 1], ["gate", "Hydrant hose gate (2½\")", 4, 1],
    ["wye", "Gated wye (2½\"×1½\"×1½\")", 4, 1], ["radioMounted", "Mounted radio", 32, 1], ["radioPortable", "Portable radio", 16, 1],
    ["ext24", "24' or longer extension ladder", 16, 1], ["roof12", "12'–16' roof ladder (or Little Giant with roof hooks, 12'+)", 10, 1],
    ["hoseTest", "Hose test interval (from hose test records)", 50, null, "test:hose"], ["pumpTest", "Pump test interval (from this unit's pump tests)", 100, null, "test:pump"]] },
  service: { total: 356, items: [
    ["scba", "SCBA (30-minute minimum)", 96, 4], ["cylinders", "Spare SCBA cylinders carried", 24, 4], ["salvage", "Salvage covers (12'×14' min)", 12, 6],
    ["generator", "Electric generator (kW, 3 kW min)", 25, 3, "kW"], ["flood", "Portable floodlights (500 W or 10,000-lumen LED)", 12, 3],
    ["ejector", "Smoke ejector 5,000 cfm, not stacked (or PPV fan / NFPA hand-held TIC)", 20, 1], ["cutting", "Cutting unit (thermal, hydraulic, air chisel or fire-rated battery tool)", 20, 1], ["saw", "Power saw (incl. fire-rated battery saw)", 20, 1],
    ["handlights", "Hand lights", 8, 4], ["pike3", "Pike poles 3'–4'", 4, 2], ["pike6", "Pike poles 6' or longer", 8, 4], ["radioMounted", "Mounted radio", 32, 1],
    ["radioPortable", "Portable radio", 16, 1], ["ext24", "24' or longer extension ladder", 25, 1], ["combo14", "14' or longer combination ladder (or Little Giant 14'+)", 5, 1],
    ["roof16", "16' or longer roof ladder (or Little Giant with roof hooks, 16'+)", 25, 1], ["attic10", "10' or longer attic / folding ladder", 4, 1]] },
};
EQUIPMENT.ladder = { total: 772, items: [...EQUIPMENT.service.items,
  ["ext35", "35' or longer extension ladder", 25, 1], ["roof16b", "Second 16' or longer roof ladder", 25, 1], ["elevStream", "Elevated stream device", 100, 1],
  ["bigNozzle", "Large spray nozzle (1,000 gpm)", 16, 1], ["aerial", "Aerial ladder / platform reach (feet; 50' min)", 200, null, "aerial"],
  ["aerialTest", "Aerial test interval (from this unit's aerial tests)", 50, null, "test:aerial"]] };
EQUIPMENT.reserve_engine = EQUIPMENT.engine; EQUIPMENT.reserve_service = EQUIPMENT.service; EQUIPMENT.reserve_ladder = EQUIPMENT.ladder;
export const APPARATUS_TYPES = [["engine", "Engine"], ["ladder", "Ladder (aerial)"], ["service", "Service / rescue"], ["reserve_engine", "Reserve engine"],
  ["reserve_ladder", "Reserve ladder"], ["reserve_service", "Reserve service"], ["tanker", "Tanker"], ["other", "Other"]];

// Interval credit tables (Addendum, "Credit for Testing Programs")
const TABLES = {
  pump: [[1, 100], [2, 75], [3, 50], [4, 25]], hose: [[1, 50], [2, 37], [3, 25], [4, 12]], aerial: [[1, 50], [2, 37], [3, 25], [4, 12]],
  hydrant_inspection: [[1, 30], [2, 20], [3, 10], [4, 5]], hydrant_flow: [[5, 40], [6, 30], [7, 20], [8, 10], [9, 5]],
  preplan: [[1, 1], [2, 0.83], [3, 0.67], [4, 0.58], [5, 0.42]],
};
const TABLE_MAX = { pump: 100, hose: 50, aerial: 50, hydrant_inspection: 30, hydrant_flow: 40, preplan: 1 };
export function tablePoints(kind, interval) {
  if (interval === null || interval === undefined) return 0;
  for (const [yrs, pts] of TABLES[kind]) if (interval <= yrs) return pts;
  return 0;
}
// Average interval between the 3 most recent passed tests (on or before `end`), rounded up to whole years.
// PIAL: 2013/2012/2011 -> 1 yr, 2013/2011/2010 -> 2 yrs (1.5 rounded up), 2013/2010/2006 -> 4 yrs (3.5).
export function testInterval(dates, end) {
  const list = [...new Set(dates.filter(d => d && d <= end))].sort().reverse().slice(0, 3);
  if (!list.length) return { interval: null, used: [] };
  if (list.length === 1) return { interval: Math.max(1, Math.ceil(monthsBetween(list[0], end) / 12 - 0.04)), used: list, short: true };
  const gaps = list.slice(1).map((d, i) => monthsBetween(d, list[i]));
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length / 12;
  return { interval: Math.max(1, Math.ceil(avg - 0.04)), avgYears: r2(avg), used: list, short: list.length < 3 };
}

// ---- Settings ---------------------------------------------------------------------------------------
const DEFAULT_TARGETS = { facility: 18, company: 192, officerCe: 12, driver: 12, newDriver: 60, hazmat: 6, recruit: 240, minimum: 12, ifsacCompany: 45, t64: 90, t106: 95 };
export async function getSettings() {
  const d = (await pool.query("SELECT data FROM pial_settings")).rows[0]?.data || {};
  return {
    year: Number.isInteger(d.year) ? d.year : new Date().getFullYear(),
    scoreMode: d.scoreMode === "actual" ? "actual" : "projected",
    cadAgency: txt(d.cadAgency, 60), fireNatures: txt(d.fireNatures, 300) || ".",
    structureNatures: txt(d.structureNatures, 300) || "STRUCTURE|BUILDING FIRE|RESIDENTIAL FIRE|COMMERCIAL FIRE|HOUSE FIRE",
    targets: (({ t60, ...rest }) => ({ ...DEFAULT_TARGETS, ...rest }))(d.targets || {}), aerialRequiredFt: Number(d.aerialRequiredFt) || 100,
    baseline: d.baseline || {}, minimum: d.minimum || {}, ppe: d.ppe ?? null,
    // Which interval counts for alarm processing: "queue" = entered the dispatch queue -> alarm (FireWorks "SG Processing"),
    // "total" = received at the PSAP -> alarm. PIAL's 2025 grading (19.57 of 20) matches "queue".
    alarmMeasure: d.alarmMeasure === "total" ? "total" : "queue",
    // Where the training items get their roster and hours: "pial" = this tracker's roster/training imports,
    // "nexus" = the Training section (FireWorks imports + verified drills) and its grading-year roster history
    trainingSource: d.trainingSource === "nexus" ? "nexus" : "pial",
    // Structure fires from CAD (units on each call, Comms Statistics): which call signs are engines / ladder-service companies, and
    // what makes the full complement for FSRS 561 (default 2 engines + 1 ladder or service company)
    engineUnits: txt(d.engineUnits, 120) || "^(EG|E|EN|PE|QT|Q)\\d", ladderUnits: txt(d.ladderUnits, 120) || "^(LD|L|TK|TR|AT|QT|SQ|RS|RE|RC)\\d",
    fullEngines: Math.max(1, Math.min(6, Number(d.fullEngines) || 2)), fullLadders: Math.max(0, Math.min(4, Number(d.fullLadders ?? 1))),
  };
}
function yearInfo(s, today = localToday()) {
  const start = `${s.year}-01-01`, end = `${s.year}-12-31`;
  const days = Math.round((D(end) - D(start)) / 86400000) + 1;
  const done = today < start ? 0 : today > end ? days : Math.round((D(today) - D(start)) / 86400000) + 1;
  return { year: s.year, start, end, elapsed: r3(done / days), today, inProgress: done < days, asOf: today > end ? end : today };
}

// ---- Data loaders -----------------------------------------------------------------------------------
async function loadAll(s, y) {
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const [items, members, certs, training, catmap, tests, apparatus, fires] = await Promise.all([
    q("SELECT key, owner_division, manual_pct::float AS manual_pct, inputs, notes, updated_at FROM pial_items"),
    q(`SELECT key, employee_id, name, rank, position, rank_date::text, hire_date::text, end_date::text, shift, officer, driver, driver_since::text, suppression
       FROM pial_members ORDER BY name`),
    q("SELECT member_key, title, cert_date::text, ifsac FROM pial_certs"),
    q(`SELECT member_key, member_name, train_date::text AS d, hours::float AS h, source_category AS src, at_facility, delivery FROM pial_training
       WHERE train_date BETWEEN $1 AND $2`, [y.start, y.end]),
    q("SELECT source, category FROM pial_category_map"),
    q("SELECT id, kind, subject, test_date::text AS d, passed, notes FROM pial_tests ORDER BY test_date DESC"),
    q("SELECT * FROM pial_apparatus ORDER BY lower(unit)"),
    q(`SELECT incident, alarm_date::text AS d, alarm_time, prop_type, working, responders::float, first_engine_s, full_s FROM pial_fires
       WHERE alarm_date BETWEEN $1 AND $2 ORDER BY alarm_date DESC, alarm_time DESC`, [y.start, y.end]),
  ]);
  const imsDocs = await q(`SELECT member_key, train_date::text AS d FROM pial_training WHERE train_date BETWEEN $1 AND $2`, [`${y.year - 4}-01-01`, y.end]);
  return { items: new Map(items.map(i => [i.key, i])), members, certs, training, catmap: new Map(catmap.map(c => [c.source, c.category])), tests, apparatus, fires, imsDocs };
}

const int0 = n => Number(n).toLocaleString("en-US");
// The FireWorks Alarm Processing report (PIAL > FireWorks reports), for the graded year
async function alarmReport(s, y) {
  const col = s.alarmMeasure === "total" ? "total_s" : "process_s";
  const r = (await pool.query(`SELECT count(*)::int AS rows, min(alarm_date)::text AS first, max(alarm_date)::text AS last,
      count(${col})::int AS n, count(*) FILTER (WHERE ${col} <= 64)::int AS w64, count(*) FILTER (WHERE ${col} <= 106)::int AS w106,
      count(process_s)::int AS qn, count(*) FILTER (WHERE process_s <= 64)::int AS q64, count(*) FILTER (WHERE process_s <= 106)::int AS q106,
      count(total_s)::int AS tn, count(*) FILTER (WHERE total_s <= 64)::int AS t64, count(*) FILTER (WHERE total_s <= 106)::int AS t106,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY ${col})::float AS p90
    FROM pial_alarms WHERE alarm_date BETWEEN $1 AND $2`, [y.start, y.end])).rows[0];
  if (!r.rows) return null;
  const pc = (a, n) => (n ? r2(100 * a / n) : null);
  return { rows: r.rows, first: r.first, last: r.last, alarms: r.n, p64: pc(r.w64, r.n), p106: pc(r.w106, r.n), p90s: r.p90 === null ? null : Math.round(r.p90),
    measure: s.alarmMeasure, queue: { n: r.qn, p64: pc(r.q64, r.qn), p106: pc(r.q106, r.qn) }, total: { n: r.tn, p64: pc(r.t64, r.tn), p106: pc(r.t106, r.tn) } };
}

// CAD-derived metrics (closed incidents synced for Comms Statistics), when a PIAL agency is set
async function cadMetrics(s, y) {
  if (!s.cadAgency) return null;
  try {
    const p = [y.start, y.end, s.cadAgency];
    const from = s.alarmMeasure === "total" ? "received_at" : "COALESCE(queued_at, received_at)";
    const [a] = (await pool.query(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE assigned_at - ${from} <= interval '64 seconds')::int AS w64,
        count(*) FILTER (WHERE assigned_at - ${from} <= interval '106 seconds')::int AS w106
      FROM cad_incidents WHERE received_at >= $1::date AND received_at < $2::date + 1 AND agency = $3 AND dispatched AND NOT self_initiated
        AND assigned_at IS NOT NULL AND nature ~* $4`, [...p, s.fireNatures])).rows;
    const [b] = (await pool.query(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE arrived_at - assigned_at <= interval '320 seconds')::int AS w320
      FROM cad_incidents WHERE received_at >= $1::date AND received_at < $2::date + 1 AND agency = $3 AND assigned_at IS NOT NULL AND arrived_at IS NOT NULL
        AND arrived_at >= assigned_at AND nature ~* $4`, [...p, s.structureNatures])).rows;
    const [c] = (await pool.query(`SELECT count(*)::int AS n FROM cad_incidents WHERE received_at >= $1::date AND received_at < $2::date + 1 AND agency = $3`, p)).rows;
    return { alarms: a.n, p64: a.n ? r2(100 * a.w64 / a.n) : null, p106: a.n ? r2(100 * a.w106 / a.n) : null,
      structure: b.n, p320: b.n ? r2(100 * b.w320 / b.n) : null, incidents: c.n };
  } catch (e) { return { error: e.message }; }
}

// Structure fires from CAD with every unit's arrival (cad_unit_responses): first engine and full complement, measured from the
// incident's first unit assigned (dispatch). Only our units (the Apparatus report's unit filter) count.
async function cadFires(s, y) {
  if (!s.cadAgency) return null;
  try {
    const inc = (await pool.query(`SELECT incident_id, incident_number, received_at, assigned_at, nature FROM cad_incidents
      WHERE source = 'cad' AND received_at >= $1::date AND received_at < $2::date + 1 AND agency = $3 AND nature ~* $4 AND assigned_at IS NOT NULL
      ORDER BY received_at DESC`, [y.start, y.end, s.cadAgency, s.structureNatures])).rows;
    const units = inc.length ? (await pool.query(`SELECT incident_id, unit, arrived_at FROM cad_unit_responses WHERE incident_id = ANY(string_to_array($1, chr(31)))`,
      [inc.map(i => i.incident_id).join("\x1f")])).rows : [];
    const { unitSettings } = await import("./cadstats.js");
    const ours = (await unitSettings()).pattern;
    const rx = v => { try { return v ? new RegExp(v, "i") : null; } catch { return null; } };
    const oursRx = rx(ours), engRx = rx(s.engineUnits), ladRx = rx(s.ladderUnits);
    const by = new Map();
    for (const u of units) { if (oursRx && !oursRx.test(u.unit)) continue; (by.get(u.incident_id) || by.set(u.incident_id, []).get(u.incident_id)).push(u); }
    const secs = (a, b) => Math.round((new Date(a) - new Date(b)) / 1000);
    const list = inc.map(i => {
      const us = by.get(i.incident_id) || [];
      const arr = us.filter(u => u.arrived_at && new Date(u.arrived_at) >= new Date(i.assigned_at)).sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at));
      const eng = arr.filter(u => engRx?.test(u.unit)), lad = arr.filter(u => ladRx?.test(u.unit));
      const first = eng[0] || null;
      const done = eng.length >= s.fullEngines && lad.length >= s.fullLadders
        ? [eng[s.fullEngines - 1], s.fullLadders ? lad[s.fullLadders - 1] : null].filter(Boolean).reduce((m, u) => (new Date(u.arrived_at) > new Date(m.arrived_at) ? u : m)) : null;
      return { incident: i.incident_number || i.incident_id, received: i.received_at, nature: i.nature, units: [...new Set(us.map(u => u.unit))],
        firstEngineUnit: first?.unit || "", first_engine_s: first ? secs(first.arrived_at, i.assigned_at) : null, full_s: done ? secs(done.arrived_at, i.assigned_at) : null };
    });
    const fe = list.filter(x => x.first_engine_s !== null), fu = list.filter(x => x.full_s !== null);
    return { agency: s.cadAgency, incidents: list.length, withUnits: list.filter(x => x.units.length).length, list,
      firstEngine: fe.length, p320: fe.length ? r2(100 * fe.filter(x => x.first_engine_s <= 320).length / fe.length) : null,
      full: fu.length, p560: fu.length ? r2(100 * fu.filter(x => x.full_s <= 560).length / fu.length) : null,
      fullRule: `${s.fullEngines} engine${s.fullEngines === 1 ? "" : "s"}${s.fullLadders ? ` + ${s.fullLadders} ladder/service` : ""}` };
  } catch (e) { return { error: e.message }; }
}

// ---- Scoring ----------------------------------------------------------------------------------------
const IFSAC_RE = /fire ?fighter|\bff ?(i|ii|1|2)\b|instructor|driver|operator|aerial|officer|haz ?mat|hazardous/i;
// Communications certificates (Communications Officer, PST 1 Instructor, CTO...) aren't IFSAC fire certifications
const NOT_IFSAC_RE = /communicat|telecommunicat|dispatch|\b911\b|apco|\bcto\b/i;
const OFFICER_CERT_RE = /officer\s*(i{1,3}|[123])\b|fire officer/i;
const IMS_RE = /nims|\bics\b|ics-?\d|incident command|incident management/i;

function trainingModel(data, s, y, project) {
  const t = s.targets;
  const f = project && y.elapsed > 0 && y.elapsed < 1 ? 1 / y.elapsed : 1;      // projection factor for hour totals
  const active = data.members.filter(m => m.suppression && (!m.end_date || m.end_date >= y.start) && (!m.hire_date || m.hire_date <= y.end));
  const byName = new Map(data.members.map(m => [m.name.toLowerCase(), m.key]));
  const per = new Map(active.map(m => [m.key, { m, company: 0, cbt: 0, outside: 0, facility: 0, officer: 0, driver: 0, new_driver: 0, hazmat: 0, recruit: 0, ims: 0, other: 0, total: 0, inhouseCompany: 0, months: {} }]));
  const unknownMembers = new Set();
  for (const r of data.training) {
    const k = per.has(r.member_key) ? r.member_key : byName.get(String(r.member_name).toLowerCase());
    const p = per.get(k);
    if (!p) { unknownMembers.add(r.member_name || r.member_key); continue; }
    const cat = data.catmap.get(String(r.src || "").toLowerCase()) || guessCategory(r.src);
    if (r.at_facility) p.facility += r.h;
    if (cat === "other") { p.other += r.h; continue; }
    p.total += r.h;
    if (cat === "company") {
      const mo = (p.months[r.d.slice(0, 7)] = p.months[r.d.slice(0, 7)] || { inhouse: 0, cbt: 0, outside: 0 });
      if (r.delivery === "cbt") { p.cbt += r.h; mo.cbt += r.h; } else if (r.delivery === "outside") { p.outside += r.h; mo.outside += r.h; }
      else { p.company += r.h; p.inhouseCompany += r.h; mo.inhouse += r.h; }
    } else p[cat] += r.h;
  }
  const rows = [...per.values()].map(p => {
    // FSRS 580B: capped at the monthly target (16 hrs); CBT up to half of it each month; outside training at half (Addendum)
    const monthly = t.company / 12;
    const companyCredited = Object.values(p.months).reduce((a, mo) => a + Math.min(monthly, mo.inhouse + Math.min(mo.cbt, monthly / 2) + 0.5 * mo.outside), 0);
    return { key: p.m.key, name: p.m.name, rank: p.m.rank, shift: p.m.shift, officer: p.m.officer, driver: p.m.driver,
      newDriver: !!(p.m.driver_since && p.m.driver_since >= y.start && p.m.driver_since <= y.end),
      recruit: !!(p.m.hire_date && p.m.hire_date >= y.start && p.m.hire_date <= y.end),
      company: r2(p.company), cbt: r2(p.cbt), outside: r2(p.outside), companyCredited: r2(companyCredited), facility: r2(p.facility),
      officerHrs: r2(p.officer), driverHrs: r2(p.driver), newDriverHrs: r2(p.new_driver), hazmat: r2(p.hazmat), recruitHrs: r2(p.recruit), ims: r2(p.ims),
      total: r2(p.total), inhouseCompany: r2(p.inhouseCompany) };
  });
  const avg = (list, fn) => (list.length ? list.reduce((a, r) => a + fn(r), 0) / list.length : null);
  const certsBy = new Map();
  for (const c of data.certs) { if (!certsBy.has(c.member_key)) certsBy.set(c.member_key, []); certsBy.get(c.member_key).push(c); }
  for (const r of rows) {
    const cs = certsBy.get(r.key) || [];
    r.certs = cs.map(c => c.title);
    r.ifsac = cs.some(c => (c.ifsac || (IFSAC_RE.test(c.title) && !NOT_IFSAC_RE.test(c.title))) && (!c.cert_date || c.cert_date <= y.end));
    r.officerCert = cs.some(c => OFFICER_CERT_RE.test(c.title));
    r.meetsMinimum = r.total * f >= t.minimum;
    r.onPaceCompany = r.companyCredited >= t.company * y.elapsed;
  }
  const officers = rows.filter(r => r.officer), drivers = rows.filter(r => r.driver && !r.newDriver), newDrivers = rows.filter(r => r.newDriver), recruits = rows.filter(r => r.recruit);
  return {
    rows, f, members: rows.length, unknownMembers: [...unknownMembers].slice(0, 30), unknownCount: unknownMembers.size,
    use: avg(rows, r => clamp01(r.facility * f / t.facility)),
    company: avg(rows, r => clamp01(r.companyCredited * f / t.company)),
    officerCert: officers.length ? officers.filter(r => r.officerCert).length / officers.length : null,
    officerCe: avg(officers, r => clamp01(r.officerHrs * f / t.officerCe)),
    driver: avg(drivers, r => clamp01(r.driverHrs * f / t.driver)),
    newDriver: avg(newDrivers, r => clamp01((r.newDriverHrs + r.driverHrs) / t.newDriver)),     // a program total, not projected
    hazmat: avg(rows, r => clamp01(r.hazmat * f / t.hazmat)),
    recruit: avg(recruits, r => clamp01(r.recruitHrs / t.recruit)),
    ifsac: rows.length ? rows.filter(r => r.ifsac && r.inhouseCompany * f >= t.ifsacCompany).length / rows.length : null,
    belowMinimum: rows.filter(r => !r.meetsMinimum).length,
    counts: { officers: officers.length, drivers: drivers.length, newDrivers: newDrivers.length, recruits: recruits.length },
  };
}

function equipmentScore(unit, type, testsBy, hoseInterval, s, end) {
  const def = EQUIPMENT[type];
  if (!def) return null;
  const inv = unit.inventory || {};
  const lines = def.items.map(([key, label, pts, req, how]) => {
    let frac = 0, have = inv[key] ?? null, note = "";
    if (key === "tank") { have = unit.tank_gal ?? null; frac = have ? Math.min(30, have / 10) / 30 : 0; }
    else if (how === "aerial") { have = unit.aerial_ft ?? null; frac = have && have >= 50 ? Math.min(1, have / Math.min(100, s.aerialRequiredFt)) : 0; if (have && have < 50) note = "under 50' earns nothing"; }
    else if (how === "test:hose") { const iv = hoseInterval; frac = tablePoints("hose", iv.interval) / 50; have = iv.interval; note = iv.interval ? `${iv.interval}-yr interval` : "no hose tests on record"; }
    else if (how?.startsWith("test:")) {
      const kind = how.slice(5);
      const iv = testInterval((testsBy.get(`${kind}|${unit.unit.toLowerCase()}`) || []).map(t => t.d), end);
      frac = tablePoints(kind, iv.interval) / TABLE_MAX[kind]; have = iv.interval;
      note = iv.interval ? `${iv.interval}-yr interval${iv.short ? " (fewer than 3 tests on record)" : ""}` : `no ${kind} tests on record`;
    } else frac = req ? Math.min(1, (Number(have) || 0) / req) : 0;
    return { key, label, pts, req, unit: how && !how.startsWith("test") && how !== "aerial" ? how : how === "aerial" ? "ft" : "", have, frac: r3(frac), earned: r2(pts * frac), note };
  });
  const earned = lines.reduce((a, l) => a + l.pts * l.frac, 0);
  return { pct: earned / def.total, earned: r2(earned), total: def.total, lines };
}

export async function compute(opts = {}) {
  const s0 = await getSettings();
  const s = { ...s0, year: Number.isInteger(opts.year) ? opts.year : s0.year, trainingSource: opts.trainingSource || s0.trainingSource };
  const y = yearInfo(s, opts.today);
  const data = await loadAll(s, y);
  if (s.trainingSource === "nexus") {
    const { pialTrainingData } = await import("./trainingPlus.js");
    const nx = await pialTrainingData(y.year);
    data.members = nx.members; data.training = nx.training; data.certs = nx.certs;
    for (const [k, v] of nx.catmap) data.catmap.set(k, v);
  }
  const project = s.scoreMode === "projected" && y.inProgress;
  const tm = trainingModel(data, s, y, project);
  const tmNow = project ? trainingModel(data, s, y, false) : tm;
  // CAD agency not picked yet: use the St. George agency CAD sends, so CAD-based items work without a setup step
  if (!s.cadAgency) {
    const a = (await pool.query(`SELECT agency FROM cad_incidents WHERE source = 'cad' AND agency ~* '(st\\.? ?george|^sgfd$|^sg ?fd$)' GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`).catch(() => ({ rows: [] }))).rows[0]?.agency;
    if (a) { s.cadAgency = a; s.cadAgencyAuto = true; }
  }
  const cad = await cadMetrics(s, y);
  const cadFire = await cadFires(s, y);
  const alarmRpt = await alarmReport(s, y);
  const testsBy = new Map();
  for (const t of data.tests) if (t.passed) { const k = `${t.kind}|${t.subject.toLowerCase()}`; if (!testsBy.has(k)) testsBy.set(k, []); testsBy.get(k).push(t); }
  const kindDates = kind => data.tests.filter(t => t.kind === kind && t.passed).map(t => t.d);
  const hoseIv = testInterval(kindDates("hose"), y.end);
  const apparatus = data.apparatus.map(a => ({ ...a, equipment: equipmentScore(a, a.type, testsBy, hoseIv, s, y.end) }));
  const inService = type => apparatus.filter(a => a.in_service && a.type === type);
  const avgEquip = list => (list.length ? list.reduce((x, a) => x + (a.equipment?.pct || 0), 0) / list.length : null);
  const fires = data.fires, working = fires.filter(f => f.working);
  const pctOf = (list, fn) => (list.length ? 100 * list.filter(fn).length / list.length : null);
  const fireStats = {
    alarms: fires.length, working: working.length, nonWorking: fires.length - working.length,
    avgResponders: working.filter(f => f.responders !== null).length ? r2(working.filter(f => f.responders !== null).reduce((a, f) => a + f.responders, 0) / working.filter(f => f.responders !== null).length) : null,
    firstEngine: fires.filter(f => f.first_engine_s !== null).length, p320: r2(pctOf(fires.filter(f => f.first_engine_s !== null), f => f.first_engine_s <= 320)),
    full: fires.filter(f => f.full_s !== null).length, p560: r2(pctOf(fires.filter(f => f.full_s !== null), f => f.full_s <= 560)),
  };

  const fpCov = await (async () => { try { return await (await import("./fireprev.js")).coverage(y.start, y.end); } catch { return null; } })();
  const results = CATALOG.map(def => {
    const st = data.items.get(def.key) || {};
    const inputs = st.inputs || {};
    const manual = st.manual_pct === null || st.manual_pct === undefined ? null : st.manual_pct / 100;
    const last = s.baseline?.items?.[def.key];
    const lastPct = last && last.earned !== null && last.earned !== undefined ? clamp01(last.earned / def.max) : null;
    let pct = null, method = "manual", detail = [], warn = [];
    // No data and no estimate: carry the last PIAL grading forward (clearly labeled)
    const useManual = why => {
      if (manual !== null) { pct = manual; method = "manual"; if (why) detail.push(why); return; }
      if (lastPct !== null) { pct = lastPct; method = "last grading"; detail.push(`Using the ${s.baseline.date ? s.baseline.date.slice(0, 4) : "last"} PIAL grading until records or an estimate are entered.`); if (why) detail.push(why); return; }
      pct = null; method = "manual"; if (why) detail.push(why); warn.push("No estimate entered yet.");
    };
    switch (def.kind) {
      case "features": {
        const ft = inputs.features || {};
        let pts = 0;
        for (const [k, , w] of FEATURES) if (ft[k] && !(k === "basic911" && ft.enhanced911)) pts += w;
        if (Object.keys(ft).some(k => ft[k])) { pct = Math.min(3, pts) / 3; method = "checklist"; }
        else useManual("Tick the PSAP's features to calculate this.");
        break;
      }
      case "answer": {
        const p15 = Number(inputs.p15), p40 = Number(inputs.p40);
        if (inputs.p15 !== undefined && inputs.p15 !== "" && inputs.p40 !== undefined && inputs.p40 !== "") {
          pct = 0.5 * clamp01(p15 / 95) + 0.5 * clamp01(p40 / 99); method = "calculated";
          detail.push(`${p15}% answered within 15 s (needs 95%), ${p40}% within 40 s (needs 99%).`);
        } else useManual("Enter answer-time percentages from the phone system's Call Detail Report.");
        break;
      }
      case "processing": {
        const what = s.alarmMeasure === "total" ? "received to alarm" : "entered queue to alarm";
        if (alarmRpt && alarmRpt.alarms) {
          pct = 0.5 * clamp01(alarmRpt.p64 / s.targets.t64) + 0.5 * clamp01(alarmRpt.p106 / s.targets.t106); method = "FireWorks report";
          detail.push(`FireWorks Alarm Processing report, ${alarmRpt.first} to ${alarmRpt.last}: ${int0(alarmRpt.alarms)} calls, ${alarmRpt.p64}% within 64 s (goal ${s.targets.t64}%), ${alarmRpt.p106}% within 106 s (goal ${s.targets.t106}%), measured ${what}.`);
          const o = s.alarmMeasure === "total" ? alarmRpt.queue : alarmRpt.total;
          if (o.n) detail.push(`Measured ${s.alarmMeasure === "total" ? "entered queue to alarm" : "received at the PSAP to alarm"} instead: ${o.p64}% within 64 s, ${o.p106}% within 106 s (change in Settings).`);
        } else if (cad && !cad.error && cad.alarms) {
          pct = 0.5 * clamp01(cad.p64 / s.targets.t64) + 0.5 * clamp01(cad.p106 / s.targets.t106); method = "CAD";
          detail.push(`${cad.alarms} calls in CAD: ${cad.p64}% dispatched within 64 s (goal ${s.targets.t64}%), ${cad.p106}% within 106 s (goal ${s.targets.t106}%), measured ${what}.`);
        } else if (inputs.p64 !== undefined && inputs.p64 !== "" && inputs.p106 !== undefined && inputs.p106 !== "") {
          pct = 0.5 * clamp01(Number(inputs.p64) / s.targets.t64) + 0.5 * clamp01(Number(inputs.p106) / s.targets.t106); method = "calculated";
          detail.push(`${inputs.p64}% within 64 s, ${inputs.p106}% within 106 s (entered).`);
        } else useManual(s.cadAgency ? "No CAD fire alarms for the graded year yet. Import the FireWorks Alarm Processing report, or enter the percentages." : "Import the FireWorks Alarm Processing report (FireWorks reports), set the CAD agency in Settings, or enter the percentages.");
        break;
      }
      case "epss": {
        const sites = new Map();
        for (const t of data.tests.filter(t => t.kind === "epss" && t.passed && t.d >= y.start && t.d <= y.end)) {
          const k = t.subject.toLowerCase() || "(site)"; if (!sites.has(k)) sites.set(k, new Set()); sites.get(k).add(t.d.slice(0, 7));
        }
        const monthsDue = Math.max(1, Math.min(12, Number(y.asOf.slice(5, 7)) - (y.inProgress ? 1 : 0)));
        const due = []; for (let m = 1; m <= monthsDue; m++) due.push(`${y.year}-${String(m).padStart(2, "0")}`);
        const complete = sites.size > 0 && [...sites.values()].every(set => due.every(m => set.has(m)));
        const records = !sites.size ? 0 : complete ? 1 : 0.75;
        const coverage = inputs.coverage === undefined || inputs.coverage === "" ? null : clamp01(Number(inputs.coverage) / 100);
        if (coverage === null) useManual("Enter the share of required sites that have a generator.");
        else { pct = coverage * records; method = "calculated";
          detail.push(`${Math.round(coverage * 100)}% of required sites have generators; test records ${!sites.size ? "missing (no credit)" : complete ? "complete" : "partial (25% reduction)"} for ${sites.size} site(s), ${monthsDue} month(s) due.`); }
        break;
      }
      case "apparatus": case "reserve": {
        const units = def.types.flatMap(inService);
        if (def.kind === "apparatus") {
          if (!units.length) { useManual("Add apparatus and their equipment to calculate this."); break; }
          const eq = avgEquip(units), adequacy = inputs.adequacy === undefined || inputs.adequacy === "" ? 1 : clamp01(Number(inputs.adequacy) / 100);
          pct = eq * adequacy; method = "calculated";
          detail.push(`${units.length} in-service unit(s), equipment ${Math.round(eq * 1000) / 10}% of relative points; companies/response adequacy ${Math.round(adequacy * 100)}% (set below).`);
        } else {
          const base = def.of.flatMap(inService).length, needed = Math.ceil(base / 8);
          if (!needed) { useManual("No in-service companies of this type on the apparatus list yet."); break; }
          const have = units.length;
          pct = clamp01(have / needed) * (have ? avgEquip(units) : 0); method = "calculated";
          detail.push(`${base} in-service companies need ${needed} reserve(s) (1 per 8); ${have} on the list${have ? `, equipped ${Math.round(avgEquip(units) * 1000) / 10}%` : ""}.`);
        }
        break;
      }
      case "deployment": {
        const road = manual;
        let ae = null, src = "";
        if (fireStats.firstEngine >= 5) { ae = fireStats.p320; src = `fire reports (${fireStats.firstEngine} fires)`; }
        else if (cadFire && !cadFire.error && cadFire.firstEngine >= 5) { ae = cadFire.p320; src = `CAD unit arrivals, first engine (${cadFire.firstEngine} structure fires)`; }
        else if (cad && !cad.error && cad.structure) { ae = cad.p320; src = `CAD first unit on scene (${cad.structure} structure fire calls)`; }
        let al = fireStats.full >= 5 ? fireStats.p560 : null;
        if (al === null && cadFire && !cadFire.error && cadFire.full >= 5) { al = cadFire.p560; detail.push(`Full complement (${cadFire.fullRule}) from CAD unit arrivals on ${cadFire.full} structure fires.`); }
        if (ae !== null) {
          // FSRS 561: each part is weighted by the equipment of the companies providing it
          const eEq = avgEquip(inService("engine")) ?? 1, lEq = avgEquip([...inService("ladder"), ...inService("service")]) ?? 1;
          const cadCredit = 6 * clamp01(ae / 90) * eEq + 4 * (al !== null ? clamp01(al / 90) : (road ?? 0)) * lEq;

          detail.push(`First engine within 320 s of dispatch on ${ae}% (from ${src}; standard 90%).` + (al !== null ? ` Full complement within 560 s on ${al}%.` : " Full complement: no data (road-mile estimate used for that part)."));
          if (eEq < 1 || lEq < 1) detail.push(`Weighted by equipment: engines ${Math.round(eEq * 1000) / 10}%, ladder/service ${Math.round(lEq * 1000) / 10}% (FSRS 561).`);
          const roadCredit = road === null ? 0 : road * 10;
          pct = Math.max(cadCredit, roadCredit) / 10; method = cadCredit >= roadCredit ? "CAD / fire reports" : "manual";
          if (road !== null) detail.push(`Road-mile estimate ${Math.round(road * 100)}% (${r2(roadCredit)} pts). PIAL uses the higher.`);
        } else useManual("Enter the road-mile distribution estimate, or import fire reports with arrival times / connect CAD.");
        break;
      }
      case "hydrant_bonus": {
        const f = ["submitted", "allFields", "coords", "count"].filter(k => inputs[k]).length;
        if (!f) { useManual("Tick the requirements to confirm it for the next grading."); break; }
        pct = f === 4 ? 1 : 0; method = "checklist";
        detail.push(f === 4 ? "All requirements met." : `${f} of 4 requirements ticked. It's all or nothing.`);
        break;
      }
      case "personnel": {
        useManual();
        detail.push(`Members with ${s.targets.minimum}+ training hours (the cap on members credited): ${tm.members - tm.belowMinimum} of ${tm.members}${project ? " at current pace" : ""}.`);
        if (fireStats.working) detail.push(`Working structure fires this graded year: ${fireStats.working}; average responders ${fireStats.avgResponders ?? "not recorded"}.`);
        if (s.ppe !== null && s.ppe !== "") detail.push(`PPE ensembles available: ${s.ppe}.`);
        break;
      }
      case "t_facility": {
        const av = inputs.facilities || {};
        const avail = (av.fireBuilding ? 1.53 : 0) + (av.tower ? 0.9 : 0) + (av.acres2 ? 0.72 : 0);
        if (tm.use === null) { useManual("Import the roster and training hours to calculate this."); break; }
        pct = (avail / 3.15) * tm.use; method = "training data";
        detail.push(`Facilities available: ${avail ? [av.fireBuilding && "fire building", av.tower && "drill tower", av.acres2 && "2-acre area"].filter(Boolean).join(", ") : "none ticked"}; use ${Math.round(tm.use * 100)}% of ${s.targets.facility} hrs/member.`);
        break;
      }
      case "t_company": case "t_officer_cert": case "t_officer_ce": case "t_driver": case "t_new_driver": case "t_hazmat": case "t_recruit": case "t_ifsac": {
        const map = { t_company: ["company", `${s.targets.company} hrs/member (CBT max 50%, outside training at half)`], t_officer_cert: ["officerCert", "officers with Fire Officer I+"],
          t_officer_ce: ["officerCe", `${s.targets.officerCe} hrs/officer`], t_driver: ["driver", `${s.targets.driver} hrs/driver`], t_new_driver: ["newDriver", `${s.targets.newDriver} hrs per new driver`],
          t_hazmat: ["hazmat", `${s.targets.hazmat} hrs/member`], t_recruit: ["recruit", `${s.targets.recruit} hrs per recruit`], t_ifsac: ["ifsac", `IFSAC-certified members with ${s.targets.ifsacCompany}+ in-house company hrs`] };
        const [k, what] = map[def.kind];
        const v = tm[k];
        if (!tm.members) { useManual("Import the roster and training hours to calculate this."); break; }
        if (v === null) {
          const who = { t_officer_cert: "officers", t_officer_ce: "officers", t_driver: "drivers", t_new_driver: "new drivers", t_recruit: "recruits" }[def.kind];
          useManual(`No ${who} on the roster for the graded year. Enter an estimate (PIAL reviews the program).`);
          break;
        }
        pct = v; method = "training data";
        detail.push(`${Math.round(v * 1000) / 10}% of ${what}${project && !["t_officer_cert", "t_new_driver", "t_recruit"].includes(def.kind) ? ", projected for the full year at the current pace" : ""}.`);
        if (def.kind === "t_ifsac") detail.push(`${Math.round(v * tm.members)} of ${tm.members} members qualify.`);
        break;
      }
      case "t_preplan": {
        const iv = testInterval(kindDates("preplan"), y.end);
        const factor = tablePoints("preplan", iv.interval);
        const total = Number(inputs.commercial), planned = Number(inputs.planned);
        if (!iv.used.length || !(total > 0)) { useManual("Record pre-plan inspection dates and enter commercial buildings / pre-planned counts."); break; }
        const cov = clamp01(planned / total);
        pct = factor * cov; method = "calculated";
        detail.push(`Interval ${iv.interval} yr (factor ${factor}) × ${planned} of ${total} commercial buildings pre-planned (${Math.round(cov * 100)}%).`);
        if (iv.short) warn.push("Fewer than 3 pre-plan inspection cycles on record.");
        break;
      }
      case "sops": {
        const since = `${y.year - 4}-01-01`;
        if (!data.tests.some(t => t.kind === "sop")) { useManual("Record SOP review dates under Testing & reviews to calculate this."); break; }
        const ok = SOPS.map(name => { const d = data.tests.filter(t => t.kind === "sop" && t.subject.toLowerCase() === name.toLowerCase()).map(t => t.d).filter(d => d <= y.end).sort().pop() || null; return { name, last: d, ok: !!d && d >= since }; });
        pct = ok.filter(x => x.ok).length / SOPS.length; method = "calculated";
        detail.push(`${ok.filter(x => x.ok).length} of ${SOPS.length} SOPs reviewed since ${since}.`);
        const missing = ok.filter(x => !x.ok).map(x => x.name);
        if (missing.length) warn.push(`Not reviewed within 5 years: ${missing.join(", ")}.`);
        break;
      }
      case "ims": {
        if (!tm.members) { useManual("Import the roster with certifications or training to calculate this."); break; }
        const since = `${y.year - 4}-01-01`;
        const certOk = new Set(data.certs.filter(c => IMS_RE.test(c.title) && (!c.cert_date || c.cert_date >= since)).map(c => c.member_key));
        const imsCats = new Set([...data.catmap].filter(([, c]) => c === "ims").map(([src]) => src));
        const trained = new Set(certOk);
        for (const r of data.training) { const c = String(r.src || "").toLowerCase(); if (imsCats.has(c) || (!data.catmap.has(c) && guessCategory(c) === "ims")) trained.add(r.member_key); }
        const n = tm.rows.filter(r => trained.has(r.key)).length;
        pct = n / tm.members; method = "training data";
        detail.push(`${n} of ${tm.members} members with NIMS/ICS training or certification dated ${since} or later.`);
        break;
      }
      case "hydrant_inspect": case "hydrant_flow": {
        const kind = def.kind === "hydrant_inspect" ? "hydrant_inspection" : "hydrant_flow";
        const iv = testInterval(kindDates(kind), y.end);
        if (!iv.used.length) { useManual(`Record ${kind === "hydrant_flow" ? "fire flow test" : "inspection"} cycle dates to calculate this.`); break; }
        const base = tablePoints(kind, iv.interval);
        let pts;
        if (kind === "hydrant_inspection") {
          pts = Math.min(50, base + (inputs.flushing ? 10 : 0) + (inputs.pressureTest ? 10 : 0) + (inputs.dryHydrants ? 20 : 0));
          detail.push(`Frequency ${base} pts${inputs.flushing ? " + flushing 10" : ""}${inputs.pressureTest ? " + pressure test 10" : ""}${inputs.dryHydrants ? " + dry hydrant drafting 20" : ""} = ${pts} of 50.`);
        } else {
          pts = Math.min(50, base * (inputs.marking ? 1.25 : 1));
          detail.push(`Frequency ${base} pts${inputs.marking ? " × 1.25 for hydrant marking" : " (no marking program: up to 40 of 50)"} = ${pts} of 50.`);
        }
        if (inputs.complete === false) { pts *= 0.75; warn.push("Partial records: 25% reduction."); }
        pct = pts / 50; method = "calculated";
        detail.push(`Average interval ${iv.interval} yr${iv.avgYears ? ` (${iv.avgYears} before rounding)` : ""} from ${iv.used.join(", ")}.`);
        if (iv.short) warn.push("Fewer than 3 cycles on record.");
        break;
      }
      case "inspections": {
        if (!fpCov || !fpCov.total) { useManual("Import the FireWorks inspection report in Fire Prevention to calculate this."); break; }
        const pts = 8 * fpCov.pct * fpCov.factor;
        pct = pts / 8; method = "calculated";
        detail.push(`${fpCov.inspected} of ${fpCov.total} properties inspected in ${y.year} (${Math.round(fpCov.pct * 1000) / 10}%) = ${Math.round(pts * 100) / 100} of 8 points.`);
        if (fpCov.excluded || fpCov.other || fpCov.vacant) detail.push(`Not counted: ${[fpCov.excluded && `${fpCov.excluded} left out by Fire Prevention`, fpCov.other && `${fpCov.other} in other fire districts`, fpCov.vacant && `${fpCov.vacant} vacant`].filter(Boolean).join(", ")}.`);
        if (fpCov.partialRecords) warn.push("Partial records: 25% reduction (Fire Prevention settings).");
        if (!fpCov.certified) warn.push("Inspectors not OSFM-certified: no credit (Fire Prevention settings).");
        if (y.inProgress) detail.push(`Year in progress: properties not inspected yet still count against the total until ${y.end}.`);
        break;
      }
      default: useManual();
    }
    const credit = pct === null ? 0 : pct * def.max;
    return { ...def, owner: st.owner_division || def.owner, manualPct: st.manual_pct ?? null, inputs, notes: st.notes || "", updatedAt: st.updated_at || null,
      pct: pct === null ? null : r3(pct), credit: r3(credit), method, detail, warn,
      last: last ? { earned: last.earned === null || last.earned === undefined ? null : r3(last.earned), raw: last.raw || "", rec: last.rec || "" } : null };
  });

  // Section totals: training capped at 9, divergence between FD and water
  const sum = sec => results.filter(r => r.section === sec).reduce((a, r) => a + r.credit, 0);
  const trainingRaw = results.filter(r => r.group.startsWith("581")).reduce((a, r) => a + r.credit, 0);
  const training = Math.min(9, trainingRaw);
  const bonus = results.filter(r => r.bonus).reduce((a, r) => a + r.credit, 0);
  const totals = { comms: sum("comms"), fd: sum("fd") - trainingRaw + training, water: sum("water") - bonus, crr: sum("crr") };
  const divergence = 0.5 * Math.abs(0.8 * totals.fd - totals.water);       // FSRS 1101: 0.5 |CWS - 0.8 (CFD + COC)|
  const score = totals.comms + totals.fd + totals.water + totals.crr - divergence + bonus;
  const cls = score >= 90 ? 1 : score >= 10 ? 10 - Math.floor(score / 10) : 10;
  // What one more point is worth to the total while the divergence stays on the same side (FSRS 1101)
  const waterAhead = totals.water > 0.8 * totals.fd;
  const pointValue = { comms: 1, crr: 1, fd: waterAhead ? 1.4 : 0.6, water: waterAhead ? 0.5 : 1.5 };

  // Minimum criteria (FSRS 107 + Addendum)
  const mc = s.minimum || {};
  const minimum = [
    { key: "organization", label: "Organized permanently under state/local law, one person in charge, definite boundaries (legal description)", ok: mc.organization ?? null },
    { key: "membership", label: "Average of 4 firefighters from the graded area on the initial alarm to working structure fires",
      ok: fireStats.avgResponders !== null ? fireStats.avgResponders >= 4 : (mc.membership ?? null),
      detail: fireStats.avgResponders !== null ? `Average ${fireStats.avgResponders} on ${fireStats.working} working fire(s) from fire reports.` : "" },
    { key: "training", label: `Training at least 3 hrs every 3 months (12 hrs/yr) for every active member`, ok: tm.members ? tm.belowMinimum === 0 : (mc.training ?? null),
      detail: tm.members ? `${tm.belowMinimum} of ${tm.members} member(s) below ${s.targets.minimum} hrs${project ? " at the current pace" : ""}.` : "" },
    { key: "alarm", label: "No delay in receipt of alarms and dispatch of firefighters and apparatus", ok: mc.alarm ?? null },
    { key: "apparatus", label: "At least one apparatus meeting NFPA 1901", ok: apparatus.some(a => a.in_service && a.type === "engine") ? true : (mc.apparatus ?? null) },
    { key: "housing", label: "Engine, service and ladder companies housed against weather, including freezing", ok: mc.housing ?? null },
  ];

  // Due and overdue records
  const due = [];
  const subjects = new Map();
  for (const t of data.tests.filter(t => t.passed)) { const k = `${t.kind}|${t.subject.toLowerCase()}`; if (!subjects.has(k)) subjects.set(k, t); }
  for (const a of apparatus.filter(a => a.in_service)) {
    const kinds = ["engine", "reserve_engine"].includes(a.type) ? ["pump"] : ["ladder", "reserve_ladder"].includes(a.type) ? ["aerial"] : [];
    for (const k of kinds) if (!subjects.has(`${k}|${a.unit.toLowerCase()}`)) due.push({ kind: k, label: TEST_KINDS[k].label, subject: a.unit, last: null, due: null, overdue: true });
  }
  for (const [k, t] of subjects) {
    const kind = k.split("|")[0], every = TEST_KINDS[kind]?.every || 12;
    if (kind === "sop" || kind === "epss") continue;
    const next = addMonths(t.d, every);
    due.push({ kind, label: TEST_KINDS[kind]?.label || kind, subject: t.subject, last: t.d, due: next, overdue: next < y.today });
  }
  for (const name of SOPS) {
    const t = subjects.get(`sop|${name.toLowerCase()}`);
    const next = t ? addMonths(t.d, 60) : null;
    due.push({ kind: "sop", label: "SOP review", subject: name, last: t?.d || null, due: next, overdue: !t || next < y.today });
  }
  if (!data.tests.some(t => t.kind === "hose")) due.push({ kind: "hose", label: TEST_KINDS.hose.label, subject: "All hose", last: null, due: null, overdue: true });
  due.sort((a, b) => (a.overdue === b.overdue ? String(a.due || "").localeCompare(String(b.due || "")) : a.overdue ? -1 : 1));

  return {
    sources: [
      { key: "alarmReport", label: "FireWorks Alarm Processing report (PIAL imports)", feeds: "420-A-2 alarm processing (used first when it covers the graded year)",
        on: !!alarmRpt, status: alarmRpt ? `${alarmRpt.rows.toLocaleString()} alarms, ${alarmRpt.first} to ${alarmRpt.last}` : "not imported for this graded year" },
      { key: "cad", label: "CAD calls (Comms Statistics sync)", feeds: "420-A-2 alarm processing when no report covers the year; first unit on scene for 561",
        on: !!(cad && !cad.error && cad.incidents), status: !s.cadAgency ? `no ${brand().place} agency found in CAD data yet` : cad?.error ? cad.error
          : `${s.cadAgency}${s.cadAgencyAuto ? " (found automatically)" : ""}: ${(cad?.incidents || 0).toLocaleString()} calls, ${(cad?.alarms || 0).toLocaleString()} fire/EMS/rescue alarms in ${y.year}` },
      { key: "units", label: "CAD units on each call (Apparatus)", feeds: "561 deployment: first engine ≤ 320 s and full complement ≤ 560 s on structure fires",
        on: !!(cadFire && !cadFire.error && cadFire.withUnits), status: !cadFire ? "needs the CAD agency" : cadFire.error ? cadFire.error
          : `${cadFire.incidents} structure fires in ${y.year}; ${cadFire.withUnits} with unit times, first engine on ${cadFire.firstEngine}, full complement (${cadFire.fullRule}) on ${cadFire.full}` },
      { key: "fires", label: "Fire reports (PIAL imports)", feeds: "561 deployment (used first, 5+ fires); the 4-responder average on working fires",
        on: fireStats.alarms > 0, status: fireStats.alarms ? `${fireStats.alarms} structure fires, ${fireStats.working} working` : "not imported for this graded year" },
      { key: "fireprev", label: "Fire Prevention inspections", feeds: "1022 fire prevention staffing",
        on: !!fpCov?.total, status: fpCov?.total ? `${fpCov.inspected} of ${fpCov.total} properties inspected (${Math.round(fpCov.pct * 1000) / 10}%)` : "no inspection report imported" },
      { key: "training", label: s.trainingSource === "nexus" ? "Training section (FireWorks imports + verified drills)" : "Training imports on this tracker", feeds: "581 training items and the 12-hour training minimum",
        on: tm.members > 0, status: `${tm.members} members on the graded-year roster${s.trainingSource === "nexus" ? "" : " (switch to the Training section in Settings to use " + brand().productName + " training)"}` },
    ],
    settings: s, year: y, project, cad, cadFire, alarmReport: alarmRpt, fireStats, apparatus, tm, tmNow,
    items: results,
    sections: SECTION_LIST.map(sec => ({ ...sec, credit: r3(totals[sec.key]) })),
    trainingRaw: r3(trainingRaw), training: r3(training), divergence: r3(divergence), bonus: r3(bonus), score: r3(score), cls, minimum, due, pointValue, waterAhead,
    unmappedCategories: [...new Set(data.training.map(r => String(r.src || "").toLowerCase()).filter(c => c && !data.catmap.has(c)))].slice(0, 50),
  };
}

const norm = h => String(h || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normCamel = h => norm(String(h || "").replace(/([a-z])([A-Z])/g, "$1 $2"));
export function parseDate(v) {
  const s = String(v || "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900; return valid(y, +m[1], +m[2]); }
  return null;
  function valid(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)); return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? S(dt) : null; }
}
// "2026-01-01 00:24:19", "2026-01-01T00:24:19", "1/1/2026 12:24:19 AM", "1/1/2026 0:24" -> "YYYY-MM-DD HH:MM:SS"
export function parseDateTime(v) {
  const s = String(v ?? "").trim();
  const day = parseDate(s); if (!day) return null;
  const m = s.match(/[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?/);
  if (!m) return null;
  let h = +m[1]; const ap = (m[4] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
  if (h > 23 || +m[2] > 59) return null;
  return `${day} ${String(h).padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
}
const dtSecs = (a, b) => (a && b ? Math.round((Date.parse(b.replace(" ", "T") + "Z") - Date.parse(a.replace(" ", "T") + "Z")) / 1000) : null);
const okSecs = n => (n !== null && n !== undefined && Number.isFinite(n) && n >= 0 && n <= 86400 ? n : null);
const parseBool = v => /^(y|yes|true|t|1|x|pass|passed|ok)$/i.test(String(v ?? "").trim());
const hasBool = v => String(v ?? "").trim() !== "";
function parseHours(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d+):(\d{2})$/);
  if (m) return +m[1] + +m[2] / 60;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
const parseSecs = v => { const s = String(v ?? "").trim(); if (!s) return null; const m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/); if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; const n = Number(s); return Number.isFinite(n) ? Math.round(n) : null; };

export const IMPORTS = {
  roster: { label: "Membership roster", fields: {
    employee_id: ["employee id", "emp id", "employee number", "employee no", "id", "member id", "personnel id"], name: ["name", "member", "member name", "full name", "personnel", "staffname", "staff name"],
    first: ["first", "first name"], last: ["last", "last name"], rank: ["rank"], position: ["position", "title", "job title", "assignment"],
    rank_date: ["rank date", "date entered rank", "rank effective date", "promotion date", "date in rank"], hire_date: ["hire date", "hired", "start date", "date hired"],
    end_date: ["end date", "end of service", "separation date", "termination date", "inactive date"], shift: ["shift"],
    officer: ["officer", "is officer"], driver: ["driver", "is driver", "driver operator"], driver_since: ["driver since", "driver date", "driver operator date"],
    suppression: ["suppression", "fire suppression", "responds to fires"] }, need: [["name", "first"]],
    help: "Everyone who was a member during the graded year (include people who left). Officers and drivers are flagged from Officer/Driver columns, or guessed from rank (Captain, Lieutenant, Chief / Driver, Engineer, Operator)." },
  certs: { label: "Certifications", fields: {
    employee_id: ["employee id", "emp id", "employee number", "id", "member id"], name: ["name", "member", "member name", "full name", "staffname", "staff name", "staff"],
    title: ["certification", "cert", "certificate", "title", "course", "certification name", "certificatename", "certificate name"],
    cert_date: ["date", "issued", "certification date", "issue date", "date certified", "startday", "start day", "start date"],
    expires: ["expirationday", "expiration day", "expiration", "expiration date", "expires"], hours_needed: ["hoursneeded", "hours needed"],
    ifsac: ["ifsac", "ifsac accredited", "accredited"] }, need: [["title"], ["employee_id", "name"]],
    help: "One row per certification (FireWorks' Training Certification Progress report works as is: its \"PIAL -\" hour-requirement lines are skipped). IFSAC is detected from the title (FF I/II, Instructor, Driver/Operator, Aerial, Officer, HazMat) unless an IFSAC column says otherwise. Include NIMS / ICS-100 certificates (used for IMS credit)." },
  training: { label: "Training hours", fields: {
    employee_id: ["employee id", "emp id", "employee number", "id", "member id"], name: ["name", "member", "member name", "full name", "attendee", "staffname", "staff name"],
    date: ["date", "training date", "class date", "start date"], hours: ["hours", "hrs", "credit hours", "duration", "training hours"],
    category: ["category", "type", "training type", "training code", "class type", "code", "topic"], course: ["course", "class", "title", "subject", "description", "course title"],
    facility: ["at facility", "training ground", "facility", "location", "site"], delivery: ["delivery", "method", "source", "provider", "delivery method"] },
    need: [["date"], ["hours"], ["employee_id", "name"]],
    help: "One row per member per class. Re-importing replaces everything between the first and last date in the file. \"At facility\" = Y (or a location naming the training ground); Delivery = In-house / Virtual (interactive Zoom/Teams, full credit) / Online (self-paced CBT, max half of the monthly company target) / Outside (half credit)." },
  fires: { label: "Structure fire incidents", fields: {
    incident: ["incident", "incident number", "incident no", "incident id", "run number"], date: ["date", "alarm date", "incident date"], time: ["time", "alarm time"],
    type: ["type", "property type", "occupancy", "comm or res", "property use"], working: ["working", "working fire", "hose used", "water used"],
    responders: ["responders", "personnel", "members responding", "firefighters", "off duty responders"],
    first_engine: ["first engine seconds", "first engine", "first arrival seconds", "first arrival"], full: ["full complement seconds", "full complement", "full alarm seconds"] },
    need: [["incident"], ["date"]],
    help: "Every structure fire alarm in the graded area (working and non-working). Working = hose pulled and water used. Arrival times in seconds from dispatch (or m:ss). Re-importing updates by incident number." },
  alarms: { label: "Alarm processing (FireWorks)", fields: {
    incident: ["cadnumber", "cad number", "cad no", "cad", "incident number", "incident no", "incident", "incident id", "run number"],
    date: ["incidentdate", "incident date", "date", "alarm date"], psap: ["psaptime", "psap time", "psap", "call received", "received", "received time", "call time"],
    queued: ["entered queue", "enteredqueue", "queue time", "queued", "queued time", "pending"], alarm: ["alarmtime", "alarm time", "alarm", "dispatch time", "dispatched", "dispatch"],
    talk: ["call talking", "calltalking", "talk time", "call processing"], process: ["sg processing", "sgprocessing", "processing", "alarm processing", "dispatch processing"],
    total: ["total processing", "totalprocessing", "total", "total time"] },
    need: [["incident"], ["alarm", "process", "total"]],
    help: "FireWorks Alarm Processing Custom Report (Excel or CSV): CADNumber, IncidentDate, PSAPTime, Entered Queue, AlarmTime, Call Talking, SG Processing, Total Processing. Used for 420-A-2 alarm processing (64 s / 106 s). Addresses in the report are ignored. Re-importing replaces the calls between the first and last date in the file." },
  tests: { label: "Test and review records", fields: {
    type: ["type", "test type", "kind", "record type"], subject: ["unit", "subject", "apparatus", "hydrant", "site", "sop", "item"],
    date: ["date", "test date", "review date", "inspection date"], result: ["result", "passed", "pass fail", "status"], notes: ["notes", "comments"] },
    need: [["type"], ["date"]],
    help: "Type: pump, hose, aerial, hydrant inspection, hydrant flow, preplan, epss, sop. Subject: the unit (E61), the SOP name, the generator site, or a label for department-wide programs. Duplicates (same type, subject and date) are skipped." },
};
function mapHeaders(kind, header) {
  const spec = IMPORTS[kind].fields, idx = {};
  const h = header.map(norm), hc = header.map(normCamel);       // "StaffName" also matches "staff name"
  for (const [field, aliases] of Object.entries(spec)) { let i = h.findIndex(x => aliases.includes(x)); if (i < 0) i = hc.findIndex(x => aliases.includes(x)); if (i >= 0) idx[field] = i; }
  const missing = IMPORTS[kind].need.filter(alts => !alts.some(a => idx[a] !== undefined)).map(alts => alts.join(" or "));
  return { idx, missing };
}
const KIND_RE = [[/pump/i, "pump"], [/hose/i, "hose"], [/aerial|ladder|platform/i, "aerial"], [/flow/i, "hydrant_flow"], [/hydrant/i, "hydrant_inspection"],
  [/pre ?plan|pre-?incident/i, "preplan"], [/epss|generator|emergency power/i, "epss"], [/sop|procedure|guideline/i, "sop"]];

// The rows of a CSV (text) or an Excel / CSV file (base64): the first sheet with a header row this import understands.
// FireWorks reports often have title lines above the header, so the first 25 rows are searched.
async function importRows(kind, fileName, input) {
  let sheets;
  if (input.data) {
    const { readSheets } = await import("./documents.js");
    sheets = readSheets(fileName, Buffer.from(String(input.data), "base64"), 250000);
  } else sheets = [{ name: "CSV", rows: parseCsv(input.text) }];
  let firstHeader = null;
  for (const sh of sheets) {
    const rows = sh.rows.map(r => Array.from(r, v => (v === null || v === undefined ? "" : v)));
    for (let h = 0; h < Math.min(25, rows.length); h++) {
      if (rows[h].filter(v => String(v).trim()).length < 2) continue;
      firstHeader = firstHeader || rows[h];
      const m = mapHeaders(kind, rows[h]);
      if (!m.missing.length) return { rows: rows.slice(h + 1).filter(r => r.some(v => String(v).trim())), header: rows[h], ...m };
    }
  }
  const m = firstHeader ? mapHeaders(kind, firstHeader) : { missing: ["a header row"] };
  throw err(400, `Missing column(s): ${m.missing.join("; ")}.${firstHeader ? ` Found: ${firstHeader.join(", ")}` : ""}`);
}

async function runImport(user, kind, fileName, input, preview, opts = {}) {
  if (!IMPORTS[kind]) throw err(404, "Unknown import.");
  const { rows: body, idx } = await importRows(kind, fileName, input);
  if (!body.length) throw err(400, "That file has no data rows.");
  const rows = [null, ...body];
  const get = (r, f) => (idx[f] === undefined ? "" : String(r[idx[f]] ?? "").trim());
  const errors = [], out = [];
  let progressRows = 0;
  const members = (await pool.query("SELECT key, name, employee_id FROM pial_members")).rows;
  const byEmp = new Map(members.filter(m => m.employee_id).map(m => [m.employee_id.toLowerCase(), m.key]));
  const byName = new Map(members.map(m => [m.name.toLowerCase(), m.key]));
  const memberKey = (emp, name) => (emp && byEmp.get(emp.toLowerCase())) || (name && byName.get(name.toLowerCase())) || (emp ? emp : name.toLowerCase());
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    try {
      if (kind === "roster") {
        const name = get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" ");
        if (!name) throw new Error("no name");
        const rank = get(r, "rank"), position = get(r, "position"), emp = get(r, "employee_id");
        out.push({ key: (emp || name.toLowerCase()).slice(0, 80), employee_id: emp.slice(0, 40), name: name.slice(0, 120), rank: rank.slice(0, 60), position: position.slice(0, 80),
          rank_date: parseDate(get(r, "rank_date")), hire_date: parseDate(get(r, "hire_date")), end_date: parseDate(get(r, "end_date")), shift: get(r, "shift").slice(0, 20),
          officer: hasBool(get(r, "officer")) ? parseBool(get(r, "officer")) : /captain|capt\b|lieutenant|\blt\b|chief|officer/i.test(`${rank} ${position}`),
          driver: hasBool(get(r, "driver")) ? parseBool(get(r, "driver")) : /driver|engineer|operator/i.test(`${rank} ${position}`),
          driver_since: parseDate(get(r, "driver_since")), suppression: hasBool(get(r, "suppression")) ? parseBool(get(r, "suppression")) : true });
      } else if (kind === "certs") {
        const title = get(r, "title"); if (!title) throw new Error("no certification");
        // FireWorks' Certification Progress report tracks yearly hour requirements as "certificates" ("01 PIAL - Firefighter/Operator"):
        // those lines are training progress, not certifications held
        if (/\bPIAL\b/i.test(title)) { progressRows++; return; }
        // ...and so do other yearly hour requirements (Jan 1 – Dec 31 of one year, with hours needed), e.g. "Communications Officer"
        const st = parseDate(get(r, "cert_date")), ex = parseDate(get(r, "expires"));
        if (st && ex && st.slice(5) === "01-01" && ex.slice(5) === "12-31" && st.slice(0, 4) === ex.slice(0, 4) && Number(get(r, "hours_needed")) > 0) { progressRows++; return; }
        const emp = get(r, "employee_id"), name = get(r, "name");
        if (!emp && !name) throw new Error("no member");
        out.push({ member_key: memberKey(emp, name).slice(0, 80), title: title.slice(0, 160), cert_date: parseDate(get(r, "cert_date")),
          ifsac: hasBool(get(r, "ifsac")) ? parseBool(get(r, "ifsac")) : IFSAC_RE.test(title) && !NOT_IFSAC_RE.test(title) });
      } else if (kind === "training") {
        const date = parseDate(get(r, "date")); if (!date) throw new Error("bad date");
        const hours = parseHours(get(r, "hours")); if (hours === null || hours < 0 || hours > 24) throw new Error("bad hours");
        const emp = get(r, "employee_id"), name = get(r, "name"); if (!emp && !name) throw new Error("no member");
        const fac = get(r, "facility"), del = get(r, "delivery");
        out.push({ member_key: memberKey(emp, name).slice(0, 80), member_name: name.slice(0, 120), train_date: date, hours, source_category: (get(r, "category") || get(r, "course")).slice(0, 120),
          course: get(r, "course").slice(0, 200), at_facility: parseBool(fac) || /training (ground|center|facility|tower)|burn (building|tower)|drill (ground|tower)/i.test(fac),
          delivery: /zoom|teams|google meet|webex|virtual|video ?conf|interactive/i.test(del) ? "inhouse" : /online|cbt|computer|web|target ?solutions|vector|self.?paced/i.test(del) ? "cbt" : /outside|external|lsu|state|other dept|other department/i.test(del) ? "outside" : "inhouse" });
      } else if (kind === "alarms") {
        const inc = String(get(r, "incident")).replace(/\.0$/, "");
        if (!inc) throw new Error("no CAD number");
        const psap = parseDateTime(get(r, "psap")), queued = parseDateTime(get(r, "queued")), alarm = parseDateTime(get(r, "alarm"));
        const date = parseDate(get(r, "date")) || (alarm || psap || "").slice(0, 10) || null;
        if (!date) throw new Error("no date");
        const talk = okSecs(dtSecs(psap, queued) ?? parseSecs(get(r, "talk")));
        const proc = okSecs(dtSecs(queued, alarm) ?? parseSecs(get(r, "process")));
        const total = okSecs(dtSecs(psap, alarm) ?? parseSecs(get(r, "total")));
        if (proc === null && total === null) throw new Error("no processing time");
        out.push({ incident: inc.slice(0, 60), alarm_date: date, psap_at: psap, queued_at: queued, alarm_at: alarm, talk_s: talk, process_s: proc, total_s: total });
      } else if (kind === "fires") {
        const inc = get(r, "incident"), date = parseDate(get(r, "date"));
        if (!inc || !date) throw new Error("needs incident and date");
        const t = get(r, "type");
        out.push({ incident: inc.slice(0, 60), alarm_date: date, alarm_time: get(r, "time").slice(0, 8), prop_type: /^c|comm/i.test(t) ? "C" : /^r|res|dwell|house/i.test(t) ? "R" : t.slice(0, 2).toUpperCase(),
          working: parseBool(get(r, "working")), responders: parseHours(get(r, "responders")), first_engine_s: parseSecs(get(r, "first_engine")), full_s: parseSecs(get(r, "full")) });
      } else {
        const kraw = get(r, "type"), k = (KIND_RE.find(([re]) => re.test(kraw)) || [])[1];
        if (!k) throw new Error(`unknown type "${kraw}"`);
        const date = parseDate(get(r, "date")); if (!date) throw new Error("bad date");
        const res = get(r, "result");
        let subject = get(r, "subject").slice(0, 120);
        if (k === "sop") subject = SOPS.find(n => n.toLowerCase() === subject.toLowerCase() || n.toLowerCase().startsWith(subject.toLowerCase().slice(0, 12))) || subject;
        out.push({ kind: k, subject, test_date: date, passed: res ? !/fail|no\b|false/i.test(res) : true, notes: get(r, "notes").slice(0, 300) });
      }
    } catch (e) { errors.push(`Row ${line}: ${e.message}`); }
  });
  let info = "";
  if (kind === "certs") {
    // one line per person and certificate (the progress report repeats a certificate once per requirement): keep the latest date
    const best = new Map();
    for (const x of out) { const k = `${x.member_key}|${x.title.toLowerCase().trim()}`; const h = best.get(k); if (!h || (x.cert_date || "") > (h.cert_date || "")) best.set(k, x); }
    const dupes = out.length - best.size; out.splice(0, out.length, ...best.values());
    info = [progressRows ? `${progressRows} "PIAL -" or yearly hour-requirement line(s) skipped (training progress, not certifications)` : "",
      dupes ? `${dupes} repeated line(s) for the same person and certificate combined` : ""].filter(Boolean).join("; ");
  }
  if (preview) {
    const p = { preview: true, rows: out.length, skipped: errors.length, errors: errors.slice(0, 10), sample: out.slice(0, 8), columns: Object.keys(idx), info };
    if (kind === "alarms" && out.length) {
      const ds = out.map(x => x.alarm_date).sort(), pc = (list, n) => (list.length ? r2(100 * list.filter(v => v <= n).length / list.length) : null);
      const q = out.map(x => x.process_s).filter(v => v !== null), t = out.map(x => x.total_s).filter(v => v !== null);
      p.summary = { from: ds[0], to: ds[ds.length - 1], queue: { n: q.length, p64: pc(q, 64), p106: pc(q, 106) }, total: { n: t.length, p64: pc(t, 64), p106: pc(t, 106) } };
      p.sample = out.slice(0, 8).map(({ psap_at, queued_at, alarm_at, ...x }) => x);
    }
    return p;
  }
  if (!out.length) throw err(400, `Nothing to import. ${errors.slice(0, 3).join(" ")}`);
  const c = await pool.connect();
  let skipped = errors.length, notes = "";
  try {
    await c.query("BEGIN");
    const imp = (await c.query("INSERT INTO pial_imports (kind, file_name, rows, skipped, by_name) VALUES ($1, $2, 0, 0, $3) RETURNING id", [kind, txt(fileName, 200), user.name])).rows[0].id;
    if (kind === "roster") {
      await c.query("DELETE FROM pial_members");
      const seen = new Set();
      for (const m of out) { if (seen.has(m.key)) { skipped++; continue; } seen.add(m.key);
        await c.query(`INSERT INTO pial_members (key, employee_id, name, rank, position, rank_date, hire_date, end_date, shift, officer, driver, driver_since, suppression)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [m.key, m.employee_id, m.name, m.rank, m.position, m.rank_date, m.hire_date, m.end_date, m.shift, m.officer, m.driver, m.driver_since, m.suppression]); }
    } else if (kind === "certs") {
      await c.query("DELETE FROM pial_certs");
      for (const x of out) await c.query("INSERT INTO pial_certs (member_key, title, cert_date, ifsac) VALUES ($1,$2,$3,$4)", [x.member_key, x.title, x.cert_date, x.ifsac]);
    } else if (kind === "training") {
      const dates = out.map(x => x.train_date).sort(), from = dates[0], to = dates[dates.length - 1];
      const del = await c.query("DELETE FROM pial_training WHERE train_date BETWEEN $1 AND $2", [from, to]);
      notes = `${from} to ${to}${del.rowCount ? `; replaced ${del.rowCount} earlier row(s)` : ""}`;
      for (let i = 0; i < out.length; i += 300) {
        const chunk = out.slice(i, i + 300), p = [];
        const v = chunk.map(x => { const b = p.length; p.push(x.member_key, x.member_name, x.train_date, x.hours, x.source_category, x.course, x.at_facility, x.delivery, imp); return `(${Array.from({ length: 9 }, (_, j) => `$${b + j + 1}`).join(",")})`; });
        await c.query(`INSERT INTO pial_training (member_key, member_name, train_date, hours, source_category, course, at_facility, delivery, import_id) VALUES ${v.join(",")}`, p);
      }
      for (const src of new Set(out.map(x => x.source_category.toLowerCase()).filter(Boolean)))
        await c.query("INSERT INTO pial_category_map (source, category) VALUES ($1, $2) ON CONFLICT (source) DO NOTHING", [src, guessCategory(src)]);
    } else if (kind === "alarms") {
      const seen = new Map(); for (const x of out) seen.set(x.incident, x);
      const list = [...seen.values()]; skipped += out.length - list.length;
      const dates = list.map(x => x.alarm_date).sort(), from = dates[0], to = dates[dates.length - 1];
      const del = await c.query("DELETE FROM pial_alarms WHERE alarm_date BETWEEN $1 AND $2", [from, to]);
      notes = `${from} to ${to}${del.rowCount ? `; replaced ${del.rowCount} earlier row(s)` : ""}`;
      for (let i = 0; i < list.length; i += 500) {
        const chunk = list.slice(i, i + 500), p = [];
        const v = chunk.map(x => { const b = p.length; p.push(x.incident, x.alarm_date, x.psap_at, x.queued_at, x.alarm_at, x.talk_s, x.process_s, x.total_s, imp); return `(${Array.from({ length: 9 }, (_, j) => `$${b + j + 1}`).join(",")})`; });
        await c.query(`INSERT INTO pial_alarms (incident, alarm_date, psap_at, queued_at, alarm_at, talk_s, process_s, total_s, import_id) VALUES ${v.join(",")}
          ON CONFLICT (incident) DO UPDATE SET alarm_date = EXCLUDED.alarm_date, psap_at = EXCLUDED.psap_at, queued_at = EXCLUDED.queued_at, alarm_at = EXCLUDED.alarm_at,
            talk_s = EXCLUDED.talk_s, process_s = EXCLUDED.process_s, total_s = EXCLUDED.total_s, import_id = EXCLUDED.import_id`, p);
      }
    } else if (kind === "fires") {
      for (const x of out) await c.query(`INSERT INTO pial_fires (incident, alarm_date, alarm_time, prop_type, working, responders, first_engine_s, full_s) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (incident) DO UPDATE SET alarm_date = $2, alarm_time = $3, prop_type = $4, working = $5, responders = $6, first_engine_s = $7, full_s = $8`,
        [x.incident, x.alarm_date, x.alarm_time, x.prop_type, x.working, x.responders, x.first_engine_s, x.full_s]);
    } else {
      for (const x of out) {
        const dup = await c.query("SELECT 1 FROM pial_tests WHERE kind = $1 AND lower(subject) = lower($2) AND test_date = $3", [x.kind, x.subject, x.test_date]);
        if (dup.rowCount) { skipped++; continue; }
        await c.query("INSERT INTO pial_tests (id, kind, subject, test_date, passed, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), x.kind, x.subject, x.test_date, x.passed, x.notes, user.id]);
      }
    }
    await c.query("UPDATE pial_imports SET rows = $2, skipped = $3, notes = $4 WHERE id = $1", [imp, out.length - (skipped - errors.length), skipped, notes]);
    await audit(c, user, `Imported ${IMPORTS[kind].label.toLowerCase()}`, `${txt(fileName, 100)}: ${out.length - (skipped - errors.length)} rows${skipped ? `, ${skipped} skipped` : ""}`);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  const result = { ok: true, rows: out.length - (skipped - errors.length), skipped, errors: errors.slice(0, 10), notes };
  // Also put the calls in Comms Statistics (queue and processing times), if asked
  if (kind === "alarms" && opts.toStats) {
    const { importIncidents } = await import("./cadstats.js");
    result.stats = await importIncidents(user, fileName, out.filter(x => x.psap_at || x.alarm_at).map(x => ({
      id: x.incident, number: x.incident, agency: opts.agency || "", received: x.psap_at || x.queued_at || x.alarm_at, queued: x.queued_at, assigned: x.alarm_at,
      dispatched: !!x.alarm_at, self: false })));
  }
  return result;
}

// ---- Permissions and audit --------------------------------------------------------------------------
async function audit(c, user, action, detail) {
  const { ROLE_LABEL } = await import("./collections.js");
  await c.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'PIAL', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, txt(detail, 500)]);
}
async function rights(user) {
  if (user.role === "master") return { view: true, manage: true, edit: { all: true, divisions: new Set() } };
  const view = await hasAccess(pool, user, "pial", "view");
  const manage = await hasAccess(pool, user, "pial", "manage");
  const edit = await accessScope(pool, user.id, "pial", "edit");
  return { view, manage, edit };
}
const canEditDivision = (r, division) => r.manage || r.edit.all || r.edit.divisions.has(division);
async function ownerOf(itemKey) {
  const st = (await pool.query("SELECT owner_division FROM pial_items WHERE key = $1", [itemKey])).rows[0];
  return st?.owner_division || ITEM[itemKey]?.owner;
}
async function requireItemEdit(r, itemKey) {
  if (!ITEM[itemKey]) throw err(404, "Unknown item.");
  const owner = await ownerOf(itemKey);
  if (!canEditDivision(r, owner)) throw err(403, `Only ${owner} (or a PIAL manager) can change this item.`);
  return owner;
}

// ---- Routes -----------------------------------------------------------------------------------------
const FILE_MAX = 15 * 1024 * 1024;
export async function handlePial(req, res, parts, user, send, jsonBody, url) {
  const r = await rights(user);
  if (!r.view && !r.edit.all && !r.edit.divisions.size) throw err(403, "The PIAL tracker needs permission (User Management > Permissions > PIAL tracker).");
  const what = parts[2], id = parts[3];
  const me = { manage: r.manage, editAll: r.manage || r.edit.all, editDivisions: [...r.edit.divisions] };

  if (!what && req.method === "GET") {
    const x = await compute();
    const imports = (await pool.query("SELECT kind, max(at) AS at FROM pial_imports GROUP BY kind")).rows;
    const evidence = (await pool.query("SELECT item_key, count(*)::int AS n FROM pial_evidence GROUP BY item_key")).rows;
    const ev = Object.fromEntries(evidence.map(e => [e.item_key, e.n]));
    const divisions = (await pool.query("SELECT name FROM divisions ORDER BY name")).rows.map(d => d.name);
    const agencies = await pool.query("SELECT agency, count(*)::int AS n FROM cad_incidents GROUP BY 1 ORDER BY 2 DESC").then(q => q.rows).catch(() => []);
    return send(res, 200, {
      me, settings: x.settings, year: x.year, project: x.project, cad: x.cad, sources: x.sources, alarmReport: x.alarmReport, fireStats: x.fireStats, score: x.score, cls: x.cls, divergence: x.divergence, bonus: x.bonus, pointValue: x.pointValue, waterAhead: x.waterAhead,
      training: x.training, trainingRaw: x.trainingRaw, sections: x.sections, minimum: x.minimum, due: x.due, unmappedCategories: x.unmappedCategories,
      items: x.items.map(i => ({ ...i, evidence: ev[i.key] || 0, canEdit: canEditDivision(r, i.owner) })),
      imports: Object.fromEntries(imports.map(i => [i.kind, i.at])), divisions, agencies,
      counts: { members: x.tm.members, unknownMembers: x.tm.unknownCount, apparatus: x.apparatus.length },
      features: FEATURES, sops: SOPS, testKinds: TEST_KINDS, categories: TRAINING_CATEGORIES, apparatusTypes: APPARATUS_TYPES,
    });
  }
  if (what === "training" && req.method === "GET") {
    const x = await compute();
    const cats = (await pool.query(`SELECT m.source, m.category, coalesce(sum(t.hours), 0)::float AS hours, count(t.id)::int AS n FROM pial_category_map m
      LEFT JOIN pial_training t ON lower(t.source_category) = m.source AND t.train_date BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY hours DESC`, [x.year.start, x.year.end])).rows;
    return send(res, 200, { year: x.year, project: x.project, targets: x.settings.targets, rows: x.tmNow.rows, projected: x.tm, now: x.tmNow, categories: cats,
      unknownMembers: x.tm.unknownMembers, unknownCount: x.tm.unknownCount, canMap: r.manage || canEditDivision(r, ITEM.t580b.owner) });
  }
  if (what === "apparatus" && req.method === "GET") {
    const x = await compute();
    return send(res, 200, { apparatus: x.apparatus, equipment: EQUIPMENT, types: APPARATUS_TYPES, canEdit: canEditDivision(r, await ownerOf("f513")) });
  }
  if (what === "tests" && req.method === "GET") {
    const tests = (await pool.query(`SELECT t.id, t.kind, t.subject, t.test_date::text AS date, t.passed, t.notes, u.full_name AS by, t.created_at FROM pial_tests t
      LEFT JOIN users u ON u.id = t.created_by ORDER BY t.test_date DESC, t.created_at DESC`)).rows;
    const edit = {}; for (const [k, v] of Object.entries(TEST_KINDS)) edit[k] = canEditDivision(r, await ownerOf(v.item));
    return send(res, 200, { tests, kinds: TEST_KINDS, canEdit: edit, sops: SOPS });
  }
  if (what === "fires" && req.method === "GET") {
    const x = await compute();
    const fires = (await pool.query(`SELECT incident, alarm_date::text AS date, alarm_time AS time, prop_type AS type, working, responders::float, first_engine_s, full_s FROM pial_fires
      WHERE alarm_date BETWEEN $1 AND $2 ORDER BY alarm_date DESC, alarm_time DESC`, [x.year.start, x.year.end])).rows;
    const cf = x.cadFire && !x.cadFire.error ? x.cadFire : null;
    const reported = new Set(fires.map(f => String(f.incident)));
    return send(res, 200, { fires, stats: x.fireStats, cad: x.cad, cadFire: cf ? { ...cf, list: cf.list.map(f => ({ ...f, inReports: reported.has(String(f.incident)) })) } : x.cadFire,
      fullRule: `${x.settings.fullEngines} engines${x.settings.fullLadders ? ` + ${x.settings.fullLadders} ladder/service` : ""}` });
  }
  if (what === "roster" && req.method === "GET") {
    const members = (await pool.query(`SELECT key, employee_id, name, rank, position, rank_date::text, hire_date::text, end_date::text, shift, officer, driver, driver_since::text, suppression FROM pial_members ORDER BY name`)).rows;
    const certs = (await pool.query("SELECT member_key, title, cert_date::text, ifsac FROM pial_certs ORDER BY cert_date")).rows;
    return send(res, 200, { members, certs });
  }
  if (what === "evidence" && req.method === "GET") {
    if (isUuid(id)) {
      const f = (await pool.query("SELECT * FROM pial_evidence WHERE id = $1", [id])).rows[0];
      if (!f) throw err(404, "That file wasn't found.");
      const bytes = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data).replace(/^\\x/, ""), "hex");
      const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(f.mime);
      res.writeHead(200, { "Content-Type": inline ? f.mime : "application/octet-stream", "Content-Length": bytes.length,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w. -]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
      return res.end(bytes);
    }
    const item = url.searchParams.get("item");
    const rows = (await pool.query(`SELECT e.id, e.item_key, e.title, e.doc_date::text, e.name, e.mime, e.size, e.uploaded_at, u.full_name AS by FROM pial_evidence e
      LEFT JOIN users u ON u.id = e.uploaded_by ${item ? "WHERE e.item_key = $1" : ""} ORDER BY e.item_key, e.doc_date DESC NULLS LAST, e.uploaded_at DESC`, item ? [item] : [])).rows;
    return send(res, 200, { evidence: rows });
  }
  if (what === "imports" && req.method === "GET") {
    const history = (await pool.query("SELECT kind, file_name, rows, skipped, notes, by_name, at FROM pial_imports ORDER BY id DESC LIMIT 30")).rows;
    return send(res, 200, { specs: Object.fromEntries(Object.entries(IMPORTS).map(([k, v]) => [k, { label: v.label, help: v.help, columns: Object.fromEntries(Object.entries(v.fields).map(([f, a]) => [f, a[0]])), need: v.need }])), history, canImport: r.manage, canStats: await hasAccess(pool, user, "stats", "manage"),
      agencies: await pool.query("SELECT agency, count(*)::int AS n FROM cad_incidents WHERE agency <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 20").then(q => q.rows).catch(() => []) });
  }

  if (req.method !== "POST") throw err(404, "Not found.");
  const b = await jsonBody(req);

  if (what === "items" && id) {
    const owner = await requireItemEdit(r, id);
    const def = ITEM[id];
    const manual = b.manualPct === null || b.manualPct === "" || b.manualPct === undefined ? null : Math.max(0, Math.min(100, Number(b.manualPct)));
    if (manual !== null && Number.isNaN(manual)) throw err(400, "The estimate must be a percentage.");
    const inputs = b.inputs && typeof b.inputs === "object" ? JSON.parse(JSON.stringify(b.inputs).slice(0, 4000)) : {};
    let newOwner = owner;
    if (b.owner !== undefined && b.owner !== owner) { if (!r.manage) throw err(403, "Only PIAL managers can change who owns an item."); newOwner = txt(b.owner, 80) || def.owner; }
    await pool.query(`INSERT INTO pial_items (key, owner_division, manual_pct, inputs, notes, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
      ON CONFLICT (key) DO UPDATE SET owner_division = $2, manual_pct = $3, inputs = $4, notes = $5, updated_by = $6, updated_at = now()`,
      [id, newOwner, manual, JSON.stringify(inputs), txt(b.notes, 4000), user.id]);
    await audit(pool, user, "Updated an item", `${def.code} ${def.title}${manual !== null ? `: estimate ${manual}%` : ""}${newOwner !== owner ? `; owner ${newOwner}` : ""}`);
    return send(res, 200, { ok: true });
  }
  if (what === "evidence" && !id) {
    await requireItemEdit(r, b.itemKey);
    const name = txt(b.name, 200).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_") || "file";
    const m = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ""));
    if (!m) throw err(400, "That file couldn't be read.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > FILE_MAX) throw err(400, "Files can be up to 15 MB.");
    const eid = crypto.randomUUID();
    await pool.query("INSERT INTO pial_evidence (id, item_key, title, doc_date, name, mime, size, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [eid, b.itemKey, txt(b.title, 200) || name, isDay(b.docDate) ? b.docDate : null, name, m[1].toLowerCase(), buf.length, "\\x" + buf.toString("hex"), user.id]);
    await audit(pool, user, "Added evidence", `${ITEM[b.itemKey].code}: ${txt(b.title, 100) || name}`);
    return send(res, 200, { ok: true, id: eid });
  }
  if (what === "evidence" && isUuid(id) && parts[4] === "remove") {
    const f = (await pool.query("SELECT item_key, name FROM pial_evidence WHERE id = $1", [id])).rows[0];
    if (!f) throw err(404, "That file wasn't found.");
    await requireItemEdit(r, f.item_key);
    await pool.query("DELETE FROM pial_evidence WHERE id = $1", [id]);
    await audit(pool, user, "Removed evidence", `${ITEM[f.item_key]?.code}: ${f.name}`);
    return send(res, 200, { ok: true });
  }
  if (what === "tests" && !id) {
    const k = TEST_KINDS[b.kind];
    if (!k) throw err(400, "Choose a record type.");
    await requireItemEdit(r, k.item);
    if (!isDay(b.date)) throw err(400, "Enter the date.");
    let subject = txt(b.subject, 120);
    if (b.kind === "sop" && !SOPS.includes(subject)) throw err(400, "Choose one of the 10 SOPs.");
    const tid = isUuid(b.id) ? b.id : crypto.randomUUID();
    await pool.query(`INSERT INTO pial_tests (id, kind, subject, test_date, passed, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET subject = $3, test_date = $4, passed = $5, notes = $6`, [tid, b.kind, subject, b.date, b.passed !== false, txt(b.notes, 300), user.id]);
    await audit(pool, user, "Recorded a test / review", `${k.label}${subject ? ` (${subject})` : ""} ${b.date}${b.passed === false ? " FAILED" : ""}`);
    return send(res, 200, { ok: true, id: tid });
  }
  if (what === "tests" && isUuid(id) && parts[4] === "remove") {
    const t = (await pool.query("SELECT kind, subject, test_date::text AS d FROM pial_tests WHERE id = $1", [id])).rows[0];
    if (!t) throw err(404, "That record wasn't found.");
    await requireItemEdit(r, TEST_KINDS[t.kind]?.item || "f513");
    await pool.query("DELETE FROM pial_tests WHERE id = $1", [id]);
    await audit(pool, user, "Deleted a test / review", `${t.kind} ${t.subject} ${t.d}`);
    return send(res, 200, { ok: true });
  }
  if (what === "apparatus" && !id) {
    await requireItemEdit(r, "f513");
    const unit = txt(b.unit, 20);
    if (!unit) throw err(400, "Enter the unit designation.");
    if (!APPARATUS_TYPES.some(([k]) => k === b.type)) throw err(400, "Choose the apparatus type.");
    const num = v => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
    const inv = {};
    for (const [k, v] of Object.entries(b.inventory || {})) if (/^\w{1,20}$/.test(k) && v !== "" && v !== null && !Number.isNaN(Number(v))) inv[k] = Math.max(0, Math.min(100000, Number(v)));
    const aid = isUuid(b.id) ? b.id : crypto.randomUUID();
    try {
      await pool.query(`INSERT INTO pial_apparatus (id, unit, type, station, make, year, pump_gpm, tank_gal, aerial_ft, in_service, inventory, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
        ON CONFLICT (id) DO UPDATE SET unit = $2, type = $3, station = $4, make = $5, year = $6, pump_gpm = $7, tank_gal = $8, aerial_ft = $9, in_service = $10, inventory = $11, updated_at = now()`,
        [aid, unit, b.type, txt(b.station, 40), txt(b.make, 60), num(b.year), num(b.pumpGpm), num(b.tankGal), num(b.aerialFt), b.inService !== false, JSON.stringify(inv)]);
    } catch (e) { if (e.code === "23505") throw err(409, `There's already a unit called ${unit}.`); throw e; }
    await audit(pool, user, "Saved apparatus", `${unit} (${b.type})`);
    return send(res, 200, { ok: true, id: aid });
  }
  if (what === "apparatus" && isUuid(id) && parts[4] === "remove") {
    await requireItemEdit(r, "f513");
    const a = (await pool.query("DELETE FROM pial_apparatus WHERE id = $1 RETURNING unit", [id])).rows[0];
    if (a) await audit(pool, user, "Removed apparatus", a.unit);
    return send(res, 200, { ok: true });
  }
  if (what === "categories") {
    if (!(r.manage || canEditDivision(r, await ownerOf("t580b")))) throw err(403, "Only Training (or a PIAL manager) can change category mapping.");
    const cat = TRAINING_CATEGORIES.find(([k]) => k === b.category);
    if (!cat || !txt(b.source, 120)) throw err(400, "Choose a category.");
    await pool.query("INSERT INTO pial_category_map (source, category) VALUES (lower($1), $2) ON CONFLICT (source) DO UPDATE SET category = $2", [txt(b.source, 120), b.category]);
    await audit(pool, user, "Mapped a training category", `${txt(b.source, 120)} -> ${cat[1]}`);
    return send(res, 200, { ok: true });
  }
  if (what === "import" && IMPORTS[id]) {
    if (!r.manage) throw err(403, "Only PIAL managers can import records.");
    if (String(b.text || b.data || "").length > 28 * 1024 * 1024) throw err(400, "That file is too large (20 MB max).");
    let toStats = false;
    if (id === "alarms" && b.toStats === true) {
      if (!(await hasAccess(pool, user, "stats", "manage"))) throw err(403, "Adding calls to Comms Statistics needs the Comms statistics: Manage permission.");
      toStats = true;
    }
    return send(res, 200, await runImport(user, id, b.fileName, b.data ? { data: b.data } : { text: b.text }, b.preview === true, { toStats, agency: txt(b.agency, 60) }));
  }
  if (what === "settings") {
    if (!r.manage) throw err(403, "Only PIAL managers can change settings.");
    const cur = (await pool.query("SELECT data FROM pial_settings")).rows[0].data || {};
    const next = { ...cur };
    if (b.year !== undefined) { const yv = Number(b.year); if (!(yv >= 2000 && yv <= 2100)) throw err(400, "Pick a graded year."); next.year = yv; }
    if (b.scoreMode) next.scoreMode = b.scoreMode === "actual" ? "actual" : "projected";
    if (b.fullEngines !== undefined) next.fullEngines = Math.max(1, Math.min(6, Math.round(Number(b.fullEngines)) || 2));
    if (b.fullLadders !== undefined) next.fullLadders = Math.max(0, Math.min(4, Math.round(Number(b.fullLadders)) || 0));
    for (const k of ["cadAgency", "fireNatures", "structureNatures", "engineUnits", "ladderUnits"]) if (b[k] !== undefined) {
      const v = txt(b[k], 300);
      if (k !== "cadAgency" && v) { try { new RegExp(v, "i"); } catch { throw err(400, `"${v}" isn't a valid pattern.`); } if (risky(v)) throw err(400, `"${v}" is too complicated. Use plain words separated by |.`); }
      next[k] = v;
    }
    if (b.targets) { next.targets = { ...(cur.targets || {}) }; for (const [k, v] of Object.entries(b.targets)) if (k in DEFAULT_TARGETS && Number(v) > 0 && Number(v) <= 10000) next.targets[k] = Number(v); }
    if (b.alarmMeasure !== undefined) next.alarmMeasure = b.alarmMeasure === "total" ? "total" : "queue";
    if (b.trainingSource !== undefined) next.trainingSource = b.trainingSource === "nexus" ? "nexus" : "pial";
    if (b.aerialRequiredFt !== undefined) next.aerialRequiredFt = Math.max(50, Math.min(100, Number(b.aerialRequiredFt) || 100));
    if (b.ppe !== undefined) next.ppe = b.ppe === "" || b.ppe === null ? null : Math.max(0, Math.round(Number(b.ppe)) || 0);
    if (b.minimum) { next.minimum = { ...(cur.minimum || {}) }; for (const k of ["organization", "membership", "training", "alarm", "apparatus", "housing"]) if (k in b.minimum) next.minimum[k] = b.minimum[k] === null ? null : !!b.minimum[k]; }
    if (b.baseline) {
      const bl = b.baseline, n = v => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
      next.baseline = { ...(cur.baseline || {}), date: isDay(bl.date) ? bl.date : null, cls: n(bl.cls), score: n(bl.score), comms: n(bl.comms), fd: n(bl.fd), water: n(bl.water), crr: n(bl.crr), divergence: n(bl.divergence), notes: txt(bl.notes, 1000) };
    }
    await pool.query("UPDATE pial_settings SET data = $1, updated_at = now()", [JSON.stringify(next)]);
    await audit(pool, user, "Changed PIAL settings", Object.keys(b).join(", "));
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found.");
}
