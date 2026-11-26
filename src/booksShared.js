// Expenses & Deductions: categories (IRS Schedule C lines / Form 8829), default rates and the yearly summary. Shared by server/books.js
// (summary, PDF and CSV for the accountant) and src/Books.jsx (live totals). Record-keeping help, not tax advice: the accountant decides.

// IRS business standard mileage rate, dollars per mile (IR-2025-128: 2026 = 72.5 cents; 2025 = 70 cents). Editable in Settings.
export const DEFAULT_RATES = { 2024: 0.67, 2025: 0.70, 2026: 0.725 };
export const SIMPLIFIED_HOME_RATE = 5;      // $ per sq ft, up to 300 sq ft (Rev. Proc. 2013-13)
export const SIMPLIFIED_HOME_MAX = 300;
export const RECEIPT_AT = 75;               // IRS: keep receipts for $75 and up (and every lodging bill)

// group: what page it shows on. line: Schedule C line (8829 = home office form). vehicle: tied to a vehicle and its business-use %.
// standardOk: still deductible when the vehicle uses the standard mileage rate. pct: default business %. half: 50% limit (meals).
export const CATEGORIES = [
  { key: "advertising", label: "Advertising & marketing (website, ads, cards)", line: "8", group: "business" },
  { key: "commissions", label: "Commissions & referral fees", line: "10", group: "business" },
  { key: "contract_labor", label: "Contract labor (1099 contractors)", line: "11", group: "business" },
  { key: "equipment", label: "Computers & equipment (accountant: Section 179 / depreciation)", line: "13", group: "business" },
  { key: "insurance", label: "Business insurance (not health, not vehicle)", line: "15", group: "business" },
  { key: "interest", label: "Business loan & credit card interest", line: "16b", group: "business" },
  { key: "legal", label: "Legal & accounting", line: "17", group: "business" },
  { key: "office", label: "Office expense (supplies, printer ink, small items)", line: "18", group: "business" },
  { key: "rent_equipment", label: "Rent or lease: equipment", line: "20a", group: "business" },
  { key: "rent_property", label: "Rent: office or storage space (not your home)", line: "20b", group: "business" },
  { key: "repairs", label: "Repairs & maintenance (business equipment)", line: "21", group: "business" },
  { key: "supplies", label: "Supplies", line: "22", group: "business" },
  { key: "taxes_licenses", label: "Taxes, licenses & fees (LLC annual report, occupational license)", line: "23", group: "business" },
  { key: "travel", label: "Travel (airfare, hotel, rental car away from home)", line: "24a", group: "business" },
  { key: "meals", label: "Business meals (50% deductible)", line: "24b", group: "business", half: true },
  { key: "utilities", label: "Utilities at a business location (not your home)", line: "25", group: "business" },
  { key: "wages", label: "Wages paid to employees", line: "26", group: "business" },
  { key: "software", label: "Software & subscriptions (Claude, Microsoft, Adobe…)", line: "27a", group: "business" },
  { key: "hosting", label: "Hosting & cloud (AWS Lightsail, Cloudflare, domains)", line: "27a", group: "business" },
  { key: "phone_internet", label: "Cell phone & home internet (business share)", line: "27a", group: "business", pct: 50 },
  { key: "education", label: "Training, courses & books", line: "27a", group: "business" },
  { key: "dues", label: "Dues & memberships", line: "27a", group: "business" },
  { key: "bank_fees", label: "Bank, merchant & payment fees", line: "27a", group: "business" },
  { key: "postage", label: "Postage & shipping", line: "27a", group: "business" },
  { key: "gifts", label: "Business gifts ($25 per person per year)", line: "27a", group: "business" },
  { key: "other", label: "Other business expense", line: "27a", group: "business" },
  { key: "car_fuel", label: "Fuel", line: "9", group: "vehicle", vehicle: true },
  { key: "car_maintenance", label: "Maintenance (oil changes, tires, inspection)", line: "9", group: "vehicle", vehicle: true },
  { key: "car_repairs", label: "Repairs", line: "9", group: "vehicle", vehicle: true },
  { key: "car_insurance", label: "Vehicle insurance", line: "9", group: "vehicle", vehicle: true },
  { key: "car_registration", label: "Registration & title", line: "9", group: "vehicle", vehicle: true },
  { key: "car_wash", label: "Car washes & other vehicle costs", line: "9", group: "vehicle", vehicle: true },
  { key: "car_lease", label: "Vehicle lease payments", line: "20a", group: "vehicle", vehicle: true },
  { key: "car_interest", label: "Vehicle loan interest", line: "16b", group: "vehicle", vehicle: true, standardOk: true },
  { key: "car_parking", label: "Parking & tolls (business trips)", line: "9", group: "vehicle", vehicle: true, standardOk: true, ownPct: true },
  { key: "home_mortgage_interest", label: "Mortgage interest", line: "8829", group: "home" },
  { key: "home_rent", label: "Rent (if you rent your home)", line: "8829", group: "home" },
  { key: "home_property_tax", label: "Property taxes", line: "8829", group: "home" },
  { key: "home_insurance", label: "Homeowners / renters insurance", line: "8829", group: "home" },
  { key: "home_utilities", label: "Electric, gas, water, trash", line: "8829", group: "home" },
  { key: "home_repairs", label: "Home repairs & maintenance (whole house)", line: "8829", group: "home" },
  { key: "home_office_direct", label: "Office-only costs (paint, repairs in the office itself: 100%)", line: "8829", group: "home", direct: true },
  { key: "home_security", label: "Security system & monitoring", line: "8829", group: "home" },
  { key: "home_hoa", label: "HOA dues", line: "8829", group: "home" },
];
export const CATEGORY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
export const LINES = {
  8: "Advertising", 9: "Car and truck expenses", 10: "Commissions and fees", 11: "Contract labor", 13: "Depreciation and section 179",
  15: "Insurance (other than health)", "16b": "Interest (other)", 17: "Legal and professional services", 18: "Office expense",
  "20a": "Rent or lease: vehicles, machinery, equipment", "20b": "Rent or lease: other business property", 21: "Repairs and maintenance",
  22: "Supplies", 23: "Taxes and licenses", "24a": "Travel", "24b": "Deductible meals", 25: "Utilities", 26: "Wages", "27a": "Other expenses",
  30: "Business use of home (Form 8829 or simplified method)",
};
export const LINE_ORDER = ["8", "9", "10", "11", "13", "15", "16b", "17", "18", "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a", "30"];
export const money = n => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const inYear = (d, y) => String(d || "").slice(0, 4) === String(y);

// One tax year. expenses [{day, category, amount, businessPct, vehicleId, receipts}], trips [{day, miles, vehicleId}],
// vehicles [{id, name}], vehicleYears {vehicleId: {odoStart, odoEnd, method, commuteMiles}}, settings {rates, home: {year: {...}}}
export function summarize({ year, expenses = [], trips = [], vehicles = [], vehicleYears = {}, settings = {} }) {
  const rate = Number(settings.rates?.[year] ?? DEFAULT_RATES[year] ?? DEFAULT_RATES[2026]);
  const ex = expenses.filter(e => inYear(e.day, year)), tr = trips.filter(t => inYear(t.day, year));
  const lines = {}; const add = (line, amount, deductible, label) => {
    const l = lines[line] || (lines[line] = { line, label: LINES[line] || label, amount: 0, deductible: 0, items: 0 });
    l.amount = r2(l.amount + amount); l.deductible = r2(l.deductible + deductible); l.items++;
  };
  const notes = [];
  // Business (non-vehicle, non-home) expenses
  for (const e of ex) {
    const c = CATEGORY[e.category]; if (!c || c.group !== "business") continue;
    const share = (Number(e.businessPct ?? 100) / 100) * (c.half ? 0.5 : 1);
    add(c.line, Number(e.amount), r2(Number(e.amount) * share));
  }
  // Vehicles: business use % from the odometer, standard rate or actual costs
  const vlist = [...vehicles];
  if (tr.some(t => !t.vehicleId) || ex.some(e => CATEGORY[e.category]?.vehicle && !e.vehicleId)) vlist.push({ id: null, name: "No vehicle picked" });
  const vehicleRows = [];
  for (const v of vlist) {
    const vy = (v.id && vehicleYears[v.id]) || {};
    const method = vy.method === "actual" ? "actual" : "standard";
    const vt = tr.filter(t => (t.vehicleId || null) === v.id), ve = ex.filter(e => CATEGORY[e.category]?.vehicle && (e.vehicleId || null) === v.id);
    if (!vt.length && !ve.length && !(v.id && vehicleYears[v.id])) continue;
    const businessMiles = r2(vt.reduce((s, t) => s + Number(t.miles || 0), 0));
    const totalMiles = vy.odoStart != null && vy.odoEnd != null && vy.odoEnd > vy.odoStart ? r2(vy.odoEnd - vy.odoStart) : null;
    const pct = totalMiles ? Math.min(1, businessMiles / totalMiles) : null;
    const usePct = pct ?? 1;
    let costs = 0, parking = 0, interest = 0, counted = 0;
    for (const e of ve) {
      const amt = Number(e.amount);
      if (e.category === "car_parking") parking += amt * (Number(e.businessPct ?? 100) / 100);
      else if (e.category === "car_interest") interest += amt;
      else costs += amt;
    }
    const mileage = r2(businessMiles * rate);
    let deduction;
    if (method === "standard") { deduction = r2(mileage + parking + interest * usePct); counted = r2(parking + interest * usePct); }
    else { deduction = r2((costs + interest) * usePct + parking); counted = deduction; }
    vehicleRows.push({ id: v.id, name: v.name, method, businessMiles, totalMiles, pct: pct == null ? null : r2(pct * 100), rate, mileage,
      costs: r2(costs), parking: r2(parking), interest: r2(interest), deduction, trips: vt.length,
      commuteMiles: Number(vy.commuteMiles || 0), odoStart: vy.odoStart ?? null, odoEnd: vy.odoEnd ?? null });
    if (v.id && totalMiles == null && (businessMiles || ve.length)) notes.push(`${v.name}: enter the odometer at the start and end of ${year}. The IRS asks for total miles, and the business-use % comes from it.`);
    if (method === "actual") notes.push(`${v.name} uses actual costs: your accountant also figures its depreciation (not included here).`);
    // Line 9 = mileage or actual costs + parking; interest goes on 16b for the business share
    if (method === "standard") { add("9", r2(mileage + parking), r2(mileage + parking)); if (interest) add("16b", r2(interest), r2(interest * usePct)); }
    else { add("9", r2(costs + parking), r2(costs * usePct + parking)); if (interest) add("16b", r2(interest), r2(interest * usePct)); }
  }
  // Home office
  const h = settings.home?.[year] || {};
  const homeEx = ex.filter(e => CATEGORY[e.category]?.group === "home");
  const homeTotal = r2(homeEx.filter(e => !CATEGORY[e.category].direct).reduce((s, e) => s + Number(e.amount), 0));
  const direct = r2(homeEx.filter(e => CATEGORY[e.category].direct).reduce((s, e) => s + Number(e.amount), 0));
  const officeSqft = Number(h.officeSqft || 0), homeSqft = Number(h.homeSqft || 0), months = Math.max(0, Math.min(12, Number(h.months ?? 12)));
  const officePct = officeSqft && homeSqft ? Math.min(1, officeSqft / homeSqft) : 0;
  const simplified = r2(Math.min(officeSqft, SIMPLIFIED_HOME_MAX) * SIMPLIFIED_HOME_RATE * (months / 12));
  const actual = r2(homeTotal * officePct + direct);
  const homeMethod = h.method === "actual" ? "actual" : h.method === "none" ? "none" : "simplified";
  const homeDeduction = !officeSqft || homeMethod === "none" ? 0 : homeMethod === "actual" ? actual : simplified;
  if (homeDeduction) add("30", homeDeduction, homeDeduction);
  if (officeSqft && !homeSqft && homeMethod === "actual") notes.push("Home office: enter the whole home's square feet so the office share can be figured.");
  if (homeMethod === "simplified" && homeTotal) notes.push(`Home office uses the simplified method ($${SIMPLIFIED_HOME_RATE}/sq ft): your home bills aren't added. With your numbers the actual-expense method would be ${money(actual)}; mortgage interest and property tax still go on Schedule A.`);
  if (officeSqft) notes.push("Home office: the space has to be used regularly and only for the business. The deduction can't be more than the business's profit (your accountant checks that).");
  const missing = ex.filter(e => !Number(e.receipts) && (Number(e.amount) >= RECEIPT_AT || e.category === "travel")).length;
  const ordered = LINE_ORDER.filter(l => lines[l]).map(l => lines[l]);
  const total = r2(ordered.reduce((s, l) => s + l.deductible, 0));
  return { year: Number(year), rate, lines: ordered, total, vehicles: vehicleRows,
    miles: r2(tr.reduce((s, t) => s + Number(t.miles || 0), 0)), trips: tr.length, expenses: ex.length,
    spent: r2(ex.reduce((s, e) => s + Number(e.amount), 0)),
    home: { method: homeMethod, officeSqft, homeSqft, months, officePct: r2(officePct * 100), homeTotal, direct, simplified, actual, deduction: homeDeduction, items: homeEx.length },
    missingReceipts: missing, notes };
}
