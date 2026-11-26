// Expenses & Deductions (tile "books"; part of the vendor module "sales", so only on Fenmorix Technologies' office install): business
// expenses by Schedule C line, mileage log, vehicles (standard rate or actual costs), home office, monthly bills, receipts, and the
// accountant's packet (PDF with receipts attached, CSV). Categories and the yearly math: src/booksShared.js. Record keeping, not tax advice.
//
//   GET  /api/books?year=2026               {year, years, expenses, trips, vehicles, vehicleYears, recurring, settings, summary, clients, rights}
//   POST /api/books/expenses                {id?, day, category, vendor, description, amount, businessPct, vehicleId, clientId, paidWith, note}
//   POST /api/books/expenses/:id/remove
//   POST /api/books/trips                   {id?, day, purpose, fromPlace, toPlace, miles, roundTrip, odoStart, odoEnd, vehicleId, clientId}
//   POST /api/books/trips/:id/remove
//   POST /api/books/vehicles                {id?, name, details, inService, active}     POST /api/books/vehicles/:id/remove (no trips/expenses)
//   POST /api/books/vehicles/:id/year       {year, odoStart, odoEnd, method standard|actual, commuteMiles}
//   POST /api/books/recurring               {id?, category, vendor, description, amount, businessPct, dayOfMonth, active}
//   POST /api/books/recurring/:id/remove    POST /api/books/recurring/post {month: "YYYY-MM"} -> adds that month's bills not added yet
//   POST /api/books/receipts                {expenseId | tripId, name, dataUrl}  (jpeg, png or pdf; 10 MB)
//   GET  /api/books/receipts/:id            POST /api/books/receipts/:id/remove
//   POST /api/books/read-receipt            {name, dataUrl} -> {fields} (Claude reads a receipt; needs ANTHROPIC_API_KEY)
//   POST /api/books/settings                {rates, home, business}   (manage)
//   GET  /api/books/export.csv?year=        GET /api/books/export.pdf?year=&receipts=1
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { pool } from "./db.js";
import { hasAccess } from "./access.js";
import { isUuid, ROLE_LABEL } from "./collections.js";
import { askClaude, pdfOrImageContent } from "./documents.js";
import { CATEGORIES, CATEGORY, DEFAULT_RATES, LINES, money, summarize } from "../src/booksShared.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, n);
const line = (v, n) => clean(v, n).replace(/[\r\n\t]+/g, " ");
const dayOf = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const optNum = (v, lo, hi) => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : num(v, lo, hi));
const uuidOrNull = v => (isUuid(v) ? v : null);
const d10 = v => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const MAX_RECEIPT = 10 * 1024 * 1024;
const RECEIPT_TYPES = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

export const DEFAULT_SETTINGS = {
  rates: DEFAULT_RATES,
  home: {},
  business: { name: "Fenmorix Technologies, LLC", owner: "", address: "", city: "Baton Rouge", state: "LA", zip: "70817",
    entity: "Single-member LLC (Schedule C)", accountant: "", accountantEmail: "" },
};
async function settings() {
  const v = (await pool.query("SELECT value FROM settings WHERE key = 'biz_books'")).rows[0]?.value || {};
  return { rates: { ...DEFAULT_SETTINGS.rates, ...(v.rates || {}) }, home: v.home || {}, business: { ...DEFAULT_SETTINGS.business, ...(v.business || {}) } };
}
async function audit(user, action, detail) {
  await pool.query(`INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Expenses & Deductions', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, line(detail, 500)]);
}
const expJson = r => ({ id: r.id, day: d10(r.day), category: r.category, vendor: r.vendor, description: r.description, amount: Number(r.amount),
  businessPct: Number(r.business_pct), vehicleId: r.vehicle_id, clientId: r.client_id, paidWith: r.paid_with, note: r.note, recurringId: r.recurring_id,
  receipts: Number(r.receipts || 0), receiptList: r.receipt_list || [] });
const tripJson = r => ({ id: r.id, day: d10(r.day), purpose: r.purpose, fromPlace: r.from_place, toPlace: r.to_place, miles: Number(r.miles),
  roundTrip: r.round_trip, odoStart: r.odo_start == null ? null : Number(r.odo_start), odoEnd: r.odo_end == null ? null : Number(r.odo_end),
  vehicleId: r.vehicle_id, clientId: r.client_id, receipts: Number(r.receipts || 0), receiptList: r.receipt_list || [] });
const RECEIPT_LIST = k => `(SELECT COALESCE(json_agg(json_build_object('id', x.id, 'name', x.name, 'mime', x.mime, 'size', x.size) ORDER BY x.created_at), '[]')
  FROM biz_receipts x WHERE x.${k} = t.id) AS receipt_list, (SELECT count(*) FROM biz_receipts x WHERE x.${k} = t.id) AS receipts`;

async function yearData(year) {
  const y0 = `${year}-01-01`, y1 = `${Number(year) + 1}-01-01`;
  const expenses = (await pool.query(`SELECT t.*, ${RECEIPT_LIST("expense_id")} FROM biz_expenses t WHERE day >= $1 AND day < $2 ORDER BY day DESC, created_at DESC`, [y0, y1])).rows.map(expJson);
  const trips = (await pool.query(`SELECT t.*, ${RECEIPT_LIST("trip_id")} FROM biz_trips t WHERE day >= $1 AND day < $2 ORDER BY day DESC, created_at DESC`, [y0, y1])).rows.map(tripJson);
  const vehicles = (await pool.query("SELECT * FROM biz_vehicles ORDER BY active DESC, name")).rows.map(r => ({ id: r.id, name: r.name, details: r.details, inService: d10(r.in_service), active: r.active }));
  const vehicleYears = {};
  for (const r of (await pool.query("SELECT * FROM biz_vehicle_years WHERE year = $1", [year])).rows)
    vehicleYears[r.vehicle_id] = { odoStart: r.odo_start == null ? null : Number(r.odo_start), odoEnd: r.odo_end == null ? null : Number(r.odo_end), method: r.method, commuteMiles: Number(r.commute_miles) };
  const st = await settings();
  return { expenses, trips, vehicles, vehicleYears, settings: st, summary: summarize({ year, expenses, trips, vehicles, vehicleYears, settings: st }) };
}
function decodeDataUrl(s) {
  const m = /^data:([\w.+/-]+);base64,(.*)$/s.exec(String(s || ""));
  if (!m) throw err(400, "That file didn't come through.");
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], "base64") };
}
function sniff(buf) {
  if (buf.slice(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.slice(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return "";
}
const csvCell = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };

export async function handleBooks(req, res, parts, user, send, jsonBody) {
  const master = user.role === "master";
  const canView = master || (await hasAccess(pool, user, "books", "view"));
  if (!canView) throw err(403, "Expenses & Deductions is only for the business owner and the people they choose.");
  const canEdit = master || (await hasAccess(pool, user, "books", "edit"));
  const canManage = master || (await hasAccess(pool, user, "books", "manage"));
  const needEdit = () => { if (!canEdit) throw err(403, "You can look, but not change expenses."); };
  const [, , a, id, b2] = parts;
  const url = new URL(req.url, "http://x");
  const year = Math.round(num(url.searchParams.get("year") || new Date().getFullYear(), 2000, 2100));

  if (req.method === "GET") {
    if (!a) {
      const d = await yearData(year);
      const years = (await pool.query(`SELECT DISTINCT y FROM (SELECT extract(year FROM day)::int AS y FROM biz_expenses UNION SELECT extract(year FROM day)::int FROM biz_trips) q ORDER BY y DESC`)).rows.map(r => r.y);
      const recurring = (await pool.query("SELECT * FROM biz_recurring ORDER BY active DESC, vendor")).rows.map(r => ({ id: r.id, category: r.category, vendor: r.vendor,
        description: r.description, amount: Number(r.amount), businessPct: Number(r.business_pct), dayOfMonth: r.day_of_month, active: r.active }));
      let clients = [];
      try { clients = (await pool.query("SELECT id, name FROM sales_clients ORDER BY lower(name)")).rows; } catch { /* no client book */ }
      const places = (await pool.query(`SELECT p, count(*) AS n FROM (SELECT from_place AS p FROM biz_trips UNION ALL SELECT to_place FROM biz_trips) q
        WHERE p <> '' GROUP BY p ORDER BY n DESC LIMIT 40`)).rows.map(r => r.p);
      return send(res, 200, { year, years: [...new Set([new Date().getFullYear(), year, ...years])].sort((x, y) => y - x), ...d, recurring, clients, places,
        categories: CATEGORIES, rights: { canEdit, canManage } });
    }
    if (a === "receipts" && isUuid(id)) {
      const r = (await pool.query("SELECT name, mime, data FROM biz_receipts WHERE id = $1", [id])).rows[0];
      if (!r) throw err(404, "That receipt isn't here.");
      res.writeHead(200, { "Content-Type": r.mime, "Content-Disposition": `inline; filename="${r.name.replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", "X-Content-Type-Options": "nosniff" });
      return res.end(r.data);
    }
    if (a === "export.csv") {
      const d = await yearData(year);
      const veh = Object.fromEntries(d.vehicles.map(v => [v.id, v.name]));
      const rows = [["Type", "Date", "Category", "Schedule C line", "Vendor / purpose", "Description / route", "Amount", "Business %", "Deductible here", "Miles", "Vehicle", "Paid with", "Receipts", "Note"]];
      for (const e of [...d.expenses].reverse()) {
        const c = CATEGORY[e.category] || { label: e.category, line: "" };
        const ded = c.group === "business" ? e.amount * e.businessPct / 100 * (c.half ? 0.5 : 1) : "";
        rows.push(["Expense", e.day, c.label, c.line, e.vendor, e.description, e.amount.toFixed(2), e.businessPct, ded === "" ? "(see summary)" : ded.toFixed(2), "", veh[e.vehicleId] || "", e.paidWith, e.receipts, e.note]);
      }
      for (const t of [...d.trips].reverse()) rows.push(["Trip", t.day, "Business mileage", "9", t.purpose, [t.fromPlace, t.toPlace].filter(Boolean).join(" -> ") + (t.roundTrip ? " (round trip)" : ""),
        "", "", (t.miles * d.summary.rate).toFixed(2), t.miles, veh[t.vehicleId] || "", "", t.receipts, ""]);
      rows.push([]); rows.push(["Summary", String(year), "", "Line", "Schedule C", "", "Amount", "", "Deductible"]);
      for (const l of d.summary.lines) rows.push(["Summary", "", "", l.line, l.label, "", l.amount.toFixed(2), "", l.deductible.toFixed(2)]);
      rows.push(["Summary", "", "", "", "Total", "", "", "", d.summary.total.toFixed(2)]);
      const body = "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="expenses-${year}.csv"`, "Cache-Control": "no-store" });
      await audit(user, "Exported expenses (CSV)", String(year));
      return res.end(body);
    }
    if (a === "export.pdf") {
      const pdf = await packet(year, url.searchParams.get("receipts") !== "0");
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="tax-packet-${year}.pdf"`, "Cache-Control": "no-store" });
      await audit(user, "Exported the accountant's packet (PDF)", String(year));
      return res.end(Buffer.from(pdf));
    }
    throw err(404, "Not found");
  }

  if (req.method !== "POST") throw err(404, "Not found");
  const b = await jsonBody(req);

  if (a === "expenses" && !id) {
    needEdit();
    const day = dayOf(b.day); if (!day) throw err(400, "Pick the date.");
    const c = CATEGORY[b.category]; if (!c) throw err(400, "Pick a category.");
    const amount = Math.round(num(b.amount, 0, 1e8) * 100) / 100; if (!amount) throw err(400, "Enter the amount.");
    const vals = [day, c.key, line(b.vendor, 160), clean(b.description, 1000), amount, num(b.businessPct ?? (c.pct ?? 100), 0, 100),
      c.vehicle ? uuidOrNull(b.vehicleId) : null, uuidOrNull(b.clientId), line(b.paidWith, 60).replace(/\d{12,19}/g, "****"), clean(b.note, 1000)];
    let row;
    if (isUuid(b.id)) row = (await pool.query(`UPDATE biz_expenses SET day=$2, category=$3, vendor=$4, description=$5, amount=$6, business_pct=$7, vehicle_id=$8, client_id=$9,
        paid_with=$10, note=$11, updated_at=now() WHERE id=$1 RETURNING id`, [b.id, ...vals])).rows[0];
    else row = (await pool.query(`INSERT INTO biz_expenses (day, category, vendor, description, amount, business_pct, vehicle_id, client_id, paid_with, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals)).rows[0];
    if (!row) throw err(404, "That expense isn't here any more.");
    return send(res, 200, { ok: true, id: row.id });
  }
  if (a === "expenses" && isUuid(id) && b2 === "remove") {
    needEdit();
    const r = (await pool.query("DELETE FROM biz_expenses WHERE id = $1 RETURNING day, vendor, amount", [id])).rows[0];
    if (r) await audit(user, "Removed an expense", `${d10(r.day)} ${r.vendor} ${money(r.amount)}`);
    return send(res, 200, { ok: true });
  }
  if (a === "trips" && !id) {
    needEdit();
    const day = dayOf(b.day); if (!day) throw err(400, "Pick the date.");
    const purpose = line(b.purpose, 300); if (!purpose) throw err(400, "Say what the trip was for (the IRS asks for the business purpose).");
    const odoStart = optNum(b.odoStart, 0, 1e7), odoEnd = optNum(b.odoEnd, 0, 1e7);
    let miles = num(b.miles, 0, 5000);
    if (!miles && odoStart != null && odoEnd != null && odoEnd > odoStart) miles = odoEnd - odoStart;
    if (!miles) throw err(400, "Enter the miles (or the odometer at the start and end).");
    miles = Math.round(miles * 10) / 10;
    const vals = [day, purpose, line(b.fromPlace, 200), line(b.toPlace, 200), miles, !!b.roundTrip, odoStart, odoEnd, uuidOrNull(b.vehicleId), uuidOrNull(b.clientId)];
    let row;
    if (isUuid(b.id)) row = (await pool.query(`UPDATE biz_trips SET day=$2, purpose=$3, from_place=$4, to_place=$5, miles=$6, round_trip=$7, odo_start=$8, odo_end=$9,
        vehicle_id=$10, client_id=$11 WHERE id=$1 RETURNING id`, [b.id, ...vals])).rows[0];
    else row = (await pool.query(`INSERT INTO biz_trips (day, purpose, from_place, to_place, miles, round_trip, odo_start, odo_end, vehicle_id, client_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals)).rows[0];
    if (!row) throw err(404, "That trip isn't here any more.");
    return send(res, 200, { ok: true, id: row.id, miles });
  }
  if (a === "trips" && isUuid(id) && b2 === "remove") {
    needEdit();
    const r = (await pool.query("DELETE FROM biz_trips WHERE id = $1 RETURNING day, purpose, miles", [id])).rows[0];
    if (r) await audit(user, "Removed a trip", `${d10(r.day)} ${r.purpose} ${r.miles} mi`);
    return send(res, 200, { ok: true });
  }
  if (a === "vehicles" && !id) {
    needEdit();
    const name = line(b.name, 80); if (!name) throw err(400, "Name the vehicle (for example \"2022 F-150\").");
    const vals = [name, line(b.details, 200), dayOf(b.inService), b.active !== false];
    const row = isUuid(b.id) ? (await pool.query("UPDATE biz_vehicles SET name=$2, details=$3, in_service=$4, active=$5 WHERE id=$1 RETURNING id", [b.id, ...vals])).rows[0]
      : (await pool.query("INSERT INTO biz_vehicles (name, details, in_service, active) VALUES ($1,$2,$3,$4) RETURNING id", vals)).rows[0];
    if (!row) throw err(404, "That vehicle isn't here any more.");
    return send(res, 200, { ok: true, id: row.id });
  }
  if (a === "vehicles" && isUuid(id) && b2 === "remove") {
    needEdit();
    const used = (await pool.query("SELECT (SELECT count(*) FROM biz_trips WHERE vehicle_id = $1) + (SELECT count(*) FROM biz_expenses WHERE vehicle_id = $1) AS n", [id])).rows[0];
    if (Number(used.n)) throw err(409, "Trips or expenses use this vehicle. Mark it not in use instead.");
    await pool.query("DELETE FROM biz_vehicles WHERE id = $1", [id]);
    return send(res, 200, { ok: true });
  }
  if (a === "vehicles" && isUuid(id) && b2 === "year") {
    needEdit();
    const y = Math.round(num(b.year, 2000, 2100));
    const odoStart = optNum(b.odoStart, 0, 1e7), odoEnd = optNum(b.odoEnd, 0, 1e7);
    if (odoStart != null && odoEnd != null && odoEnd < odoStart) throw err(400, "The year-end odometer is lower than the start.");
    await pool.query(`INSERT INTO biz_vehicle_years (vehicle_id, year, odo_start, odo_end, method, commute_miles) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (vehicle_id, year) DO UPDATE SET odo_start=$3, odo_end=$4, method=$5, commute_miles=$6`,
      [id, y, odoStart, odoEnd, b.method === "actual" ? "actual" : "standard", num(b.commuteMiles, 0, 1e6)]);
    return send(res, 200, { ok: true });
  }
  if (a === "recurring" && !id) {
    needEdit();
    const c = CATEGORY[b.category]; if (!c) throw err(400, "Pick a category.");
    const vals = [c.key, line(b.vendor, 160), line(b.description, 300), Math.round(num(b.amount, 0, 1e7) * 100) / 100, num(b.businessPct ?? (c.pct ?? 100), 0, 100),
      Math.round(num(b.dayOfMonth || 1, 1, 28)), b.active !== false];
    const row = isUuid(b.id) ? (await pool.query(`UPDATE biz_recurring SET category=$2, vendor=$3, description=$4, amount=$5, business_pct=$6, day_of_month=$7, active=$8 WHERE id=$1 RETURNING id`, [b.id, ...vals])).rows[0]
      : (await pool.query(`INSERT INTO biz_recurring (category, vendor, description, amount, business_pct, day_of_month, active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, vals)).rows[0];
    return send(res, 200, { ok: true, id: row?.id });
  }
  if (a === "recurring" && isUuid(id) && b2 === "remove") {
    needEdit(); await pool.query("DELETE FROM biz_recurring WHERE id = $1", [id]); return send(res, 200, { ok: true });
  }
  if (a === "recurring" && id === "post") {
    needEdit();
    const m = /^(\d{4})-(\d{2})$/.exec(String(b.month || "")); if (!m) throw err(400, "Pick the month.");
    const start = `${m[1]}-${m[2]}-01`;
    const r = await pool.query(`INSERT INTO biz_expenses (day, category, vendor, description, amount, business_pct, recurring_id)
      SELECT ($1::date + (day_of_month - 1)), category, vendor, description, amount, business_pct, id FROM biz_recurring rc
      WHERE active AND NOT EXISTS (SELECT 1 FROM biz_expenses e WHERE e.recurring_id = rc.id AND e.day >= $1::date AND e.day < ($1::date + interval '1 month'))
      RETURNING id`, [start]);
    return send(res, 200, { ok: true, added: r.rowCount });
  }
  if (a === "receipts" && !id) {
    needEdit();
    const { buf } = decodeDataUrl(b.dataUrl);
    if (buf.length > MAX_RECEIPT) throw err(413, "Receipts can be up to 10 MB.");
    const mime = sniff(buf); if (!mime) throw err(415, "Receipts can be a photo (JPEG or PNG) or a PDF.");
    const expenseId = uuidOrNull(b.expenseId), tripId = expenseId ? null : uuidOrNull(b.tripId);
    if (!expenseId && !tripId) throw err(400, "Save the expense first, then attach the receipt.");
    const ext = RECEIPT_TYPES[mime];
    const name = (line(b.name, 120).replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]*$/, "") || "receipt") + "." + ext;
    const r = (await pool.query("INSERT INTO biz_receipts (expense_id, trip_id, name, mime, size, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [expenseId, tripId, name, mime, buf.length, buf])).rows[0];
    return send(res, 200, { ok: true, id: r.id, name, mime, size: buf.length });
  }
  if (a === "receipts" && isUuid(id) && b2 === "remove") {
    needEdit(); await pool.query("DELETE FROM biz_receipts WHERE id = $1", [id]); return send(res, 200, { ok: true });
  }
  if (a === "read-receipt") {
    needEdit();
    const { buf } = decodeDataUrl(b.dataUrl);
    if (buf.length > MAX_RECEIPT) throw err(413, "Receipts can be up to 10 MB.");
    const mime = sniff(buf); if (!mime) throw err(415, "Receipts can be a photo (JPEG or PNG) or a PDF.");
    const cats = CATEGORIES.map(c => `${c.key} = ${c.label}`).join("\n");
    const f = await askClaude([pdfOrImageContent(`receipt.${RECEIPT_TYPES[mime]}`, buf), { type: "text", text:
      `This is a receipt or bill for a small business. Return only JSON: {"day": "YYYY-MM-DD", "vendor": "...", "amount": number (the total paid), ` +
      `"description": "what was bought, short", "category": one key from the list, "paidWith": "card type and last 4 if shown, else cash/check/blank"}. ` +
      `Use null for anything you can't read. Categories:\n${cats}` }], { maxTokens: 600, what: "Receipt reading",
      noKey: "Reading receipts isn't turned on (the server needs an ANTHROPIC_API_KEY). Fill it in by hand.", notFound: "Couldn't read that receipt. Fill it in by hand.",
      fail: "Couldn't read that receipt" });
    const out = { day: dayOf(f?.day), vendor: line(f?.vendor, 160), amount: Number(f?.amount) > 0 ? Math.round(Number(f.amount) * 100) / 100 : null,
      description: line(f?.description, 300), category: CATEGORY[f?.category] ? f.category : null, paidWith: line(f?.paidWith, 60).replace(/\d{5,}/g, "") };
    return send(res, 200, { fields: out });
  }
  if (a === "settings") {
    if (!canManage) throw err(403, "Only a manager of Expenses & Deductions can change the settings.");
    const cur = await settings();
    const rates = { ...cur.rates };
    for (const [y, v] of Object.entries(b.rates || {})) if (/^\d{4}$/.test(y) && Number(v) > 0 && Number(v) < 5) rates[y] = Math.round(Number(v) * 10000) / 10000;
    const home = { ...cur.home };
    for (const [y, h] of Object.entries(b.home || {})) if (/^\d{4}$/.test(y) && h && typeof h === "object")
      home[y] = { method: ["simplified", "actual", "none"].includes(h.method) ? h.method : "simplified", officeSqft: num(h.officeSqft, 0, 100000),
        homeSqft: num(h.homeSqft, 0, 100000), months: Math.round(num(h.months ?? 12, 0, 12)), note: line(h.note, 300) };
    const business = { ...cur.business };
    for (const k of Object.keys(DEFAULT_SETTINGS.business)) if (b.business && k in b.business) business[k] = line(b.business[k], 200);
    const value = { rates, home, business };
    await pool.query(`INSERT INTO settings (key, value) VALUES ('biz_books', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
    await audit(user, "Changed expense settings", Object.keys(b).join(", "));
    return send(res, 200, { ok: true, settings: value });
  }
  throw err(404, "Not found");
}

// ---------------------------------------------------------------- The accountant's packet (PDF, receipts attached)
async function packet(year, withReceipts) {
  const d = await yearData(year), s = d.summary, biz = d.settings.business;
  const veh = Object.fromEntries(d.vehicles.map(v => [v.id, v.name]));
  const doc = await PDFDocument.create();
  doc.setTitle(`${biz.name} — business expenses ${year}`); doc.setAuthor(biz.name); doc.setCreator("Fenmorix OS");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 48, INK = rgb(0.07, 0.14, 0.25), SOFT = rgb(0.35, 0.38, 0.43), ORANGE = rgb(0.79, 0.3, 0), RULE = rgb(0.85, 0.87, 0.9);
  // WinAnsi only: replace anything the standard fonts can't draw
  const safe = t => String(t ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...")
    .replace(/→/g, "->").replace(/ /g, " ").replace(/[^\x20-\x7e¡-ÿ•€]/g, "?");
  let page, y, pageNo = 0;
  const footer = () => page.drawText(safe(`${biz.name} · ${year} business expenses · prepared from Fenmorix OS records · page ${pageNo}`), { x: M, y: 26, size: 8, font, color: SOFT });
  const newPage = () => { page = doc.addPage([W, H]); pageNo++; y = H - M; footer(); };
  const need = h => { if (y - h < 48) newPage(); };
  const text = (t, { x = M, size = 10, f = font, color = INK } = {}) => page.drawText(safe(t), { x, y, size, font: f, color });
  const wrap = (t, width, size, f = font) => {
    const out = []; for (const para of safe(t).split("\n")) {
      let cur = ""; for (const w of para.split(" ")) { const tryLine = cur ? cur + " " + w : w; if (f.widthOfTextAtSize(tryLine, size) > width && cur) { out.push(cur); cur = w; } else cur = tryLine; }
      out.push(cur);
    } return out;
  };
  const para = (t, { size = 10, color = INK, f = font, gap = 4 } = {}) => { for (const l of wrap(t, W - 2 * M, size, f)) { need(size + 3); text(l, { size, color, f }); y -= size + 3; } y -= gap; };
  const heading = t => { need(90); y -= 6; text(t, { size: 14, f: bold }); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: ORANGE }); y -= 16; };
  // cols [{label, w, right}], rows [[...]]
  const table = (cols, rows, { size = 9, totals } = {}) => {
    const head = () => { if (cols.every(c => !c.label)) return; need(18); let x = M; for (const c of cols) { const t = safe(c.label); text(t, { x: c.right ? x + c.w - bold.widthOfTextAtSize(t, size) - 4 : x, size, f: bold, color: SOFT }); x += c.w; }
      y -= 5; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: RULE }); y -= size + 4; };
    head();
    const all = totals ? [...rows, totals] : rows;
    all.forEach((r, ri) => {
      const isTotal = totals && ri === all.length - 1;
      const cells = cols.map((c, i) => wrap(r[i] ?? "", c.w - 6, size, isTotal ? bold : font));
      const hgt = Math.max(...cells.map(c => c.length)) * (size + 2) + 3;
      if (y - hgt < 48) { newPage(); head(); }
      let x = M;
      cols.forEach((c, i) => { cells[i].forEach((l, li) => { const f = isTotal ? bold : font; page.drawText(l, { x: c.right ? x + c.w - f.widthOfTextAtSize(l, size) - 4 : x, y: y - li * (size + 2), size, font: f, color: INK }); }); x += c.w; });
      y -= hgt; page.drawLine({ start: { x: M, y: y + size - 1 }, end: { x: W - M, y: y + size - 1 }, thickness: 0.3, color: RULE });
    });
    y -= 8;
  };

  // Cover + summary
  newPage();
  text(biz.name, { size: 20, f: bold }); y -= 22;
  text(`Business expenses and deductions · tax year ${year}`, { size: 13, color: ORANGE, f: bold }); y -= 20;
  for (const l of [biz.owner && `Owner: ${biz.owner}`, [biz.address, [biz.city, biz.state].filter(Boolean).join(", "), biz.zip].filter(Boolean).join(" "), biz.entity,
    biz.accountant && `Prepared for: ${biz.accountant}${biz.accountantEmail ? ` (${biz.accountantEmail})` : ""}`, `Printed ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`].filter(Boolean)) { text(l, { color: SOFT }); y -= 14; }
  y -= 6;
  para("These are the owner's records, grouped the way IRS Schedule C (Form 1040) lists expenses. They are records for the accountant, not tax advice: the accountant decides what is deductible, depreciation, and any limits.", { size: 9, color: SOFT });
  heading("Summary by Schedule C line");
  table([{ label: "Line", w: 44 }, { label: "Schedule C", w: 270 }, { label: "Spent", w: 100, right: true }, { label: "Deductible here", w: 102, right: true }],
    s.lines.map(l => [l.line, l.label, money(l.amount), money(l.deductible)]), { totals: ["", "Total", money(s.lines.reduce((t, l) => t + l.amount, 0)), money(s.total)] });
  para(`${s.expenses} expenses · ${s.trips} trips (${s.miles.toLocaleString()} business miles at ${(s.rate * 100).toFixed(1)}¢ a mile) · ${s.missingReceipts} expenses of $75 or more (or travel) without a receipt attached.`, { size: 9, color: SOFT });
  if (s.notes.length) { heading("Notes for the accountant"); for (const n of s.notes) para("• " + n, { size: 9.5 }); }

  // Vehicles
  if (s.vehicles.length) {
    heading("Vehicles (Schedule C line 9, Part IV)");
    table([{ label: "Vehicle", w: 120 }, { label: "Method", w: 62 }, { label: "Odometer", w: 92 }, { label: "Total mi", w: 52, right: true }, { label: "Business mi", w: 60, right: true },
      { label: "Bus. %", w: 42, right: true }, { label: "Deduction", w: 88, right: true }],
      s.vehicles.map(v => [v.name, v.method === "actual" ? "Actual costs" : "Standard rate", v.odoStart != null ? `${v.odoStart.toLocaleString()} - ${(v.odoEnd ?? 0).toLocaleString()}` : "not entered",
        v.totalMiles == null ? "" : v.totalMiles.toLocaleString(), v.businessMiles.toLocaleString(), v.pct == null ? "" : v.pct + "%", money(v.deduction)]));
    for (const v of s.vehicles) para(`${v.name}: ${v.method === "standard" ? `${v.businessMiles.toLocaleString()} mi × $${v.rate} = ${money(v.mileage)}; parking & tolls ${money(v.parking)}; loan interest ${money(v.interest)} (business share counted). Fuel, repairs and insurance are covered by the standard rate (${money(v.costs)} recorded, not added).` : `actual costs ${money(v.costs)} + interest ${money(v.interest)} × business use, + parking & tolls ${money(v.parking)}. Depreciation not included.`}${v.commuteMiles ? ` Commuting miles (not deductible): ${v.commuteMiles.toLocaleString()}.` : ""}`, { size: 9 });
  }
  // Home office
  if (s.home.officeSqft || s.home.items) {
    heading("Business use of home (Schedule C line 30 / Form 8829)");
    const h = s.home;
    table([{ label: "", w: 300 }, { label: "", w: 216, right: true }], [
      ["Method", h.method === "actual" ? "Actual expenses (Form 8829)" : h.method === "none" ? "Not claimed" : "Simplified ($5 / sq ft, up to 300)"],
      ["Office area / whole home", `${h.officeSqft} sq ft / ${h.homeSqft || "?"} sq ft (${h.officePct}%)`],
      ["Months used this year", String(h.months)],
      ["Home bills recorded (whole house)", money(h.homeTotal)], ["Office-only costs", money(h.direct)],
      ["Simplified method would be", money(h.simplified)], ["Actual-expense method would be", money(h.actual)], ["Deduction used here", money(h.deduction)]]);
    const homeEx = d.expenses.filter(e => CATEGORY[e.category]?.group === "home").reverse();
    if (homeEx.length) table([{ label: "Date", w: 62 }, { label: "Type", w: 170 }, { label: "Paid to", w: 184 }, { label: "Amount", w: 100, right: true }],
      homeEx.map(e => [e.day, CATEGORY[e.category].label, e.vendor, money(e.amount)]));
  }
  // Every expense
  const listed = [...d.expenses].reverse();
  if (listed.length) {
    heading("Every expense");
    table([{ label: "Date", w: 58 }, { label: "Line", w: 30 }, { label: "Category", w: 120 }, { label: "Paid to / what", w: 170 }, { label: "Amount", w: 62, right: true },
      { label: "Bus.", w: 34, right: true }, { label: "Rcpt", w: 42, right: true }],
      listed.map(e => { const c = CATEGORY[e.category] || {}; return [e.day, c.line || "", c.label || e.category,
        [e.vendor, e.description, veh[e.vehicleId]].filter(Boolean).join(" · "), money(e.amount), e.businessPct + "%", e.receipts ? `#${e.receipts}` : "-"]; }), { size: 8 });
  }
  // Mileage log
  const tl = [...d.trips].reverse();
  if (tl.length) {
    heading(`Mileage log · ${year}`);
    table([{ label: "Date", w: 58 }, { label: "Vehicle", w: 80 }, { label: "Business purpose", w: 170 }, { label: "From -> to", w: 150 }, { label: "Miles", w: 58, right: true }],
      tl.map(t => [t.day, veh[t.vehicleId] || "", t.purpose, [t.fromPlace, t.toPlace].filter(Boolean).join(" -> ") + (t.roundTrip ? " (round trip)" : ""), t.miles.toFixed(1)]),
      { size: 8, totals: ["", "", "", "Total business miles", s.miles.toFixed(1)] });
  }
  // Receipts: each on its own page (images scaled to fit; PDFs' pages copied in)
  if (withReceipts) {
    const all = (await pool.query(`SELECT r.id, r.name, r.mime, r.data, COALESCE(e.day, t.day) AS day, COALESCE(e.vendor, t.purpose) AS who, e.amount
      FROM biz_receipts r LEFT JOIN biz_expenses e ON e.id = r.expense_id LEFT JOIN biz_trips t ON t.id = r.trip_id
      WHERE COALESCE(e.day, t.day) >= $1 AND COALESCE(e.day, t.day) < $2 ORDER BY COALESCE(e.day, t.day), r.created_at`, [`${year}-01-01`, `${year + 1}-01-01`])).rows;
    for (const r of all) {
      const label = `Receipt · ${d10(r.day)} · ${r.who}${r.amount != null ? ` · ${money(r.amount)}` : ""} · ${r.name}`;
      try {
        if (r.mime === "application/pdf") {
          const src = await PDFDocument.load(r.data, { ignoreEncryption: true });
          const pages = await doc.copyPages(src, src.getPageIndices().slice(0, 20));
          pages.forEach(p => { doc.addPage(p); pageNo++; const ph = p.getHeight(); p.drawText(safe(label), { x: 18, y: ph - 14, size: 8, font: bold, color: ORANGE }); });
        } else {
          newPage(); text(label, { size: 10, f: bold, color: ORANGE }); y -= 12;
          const img = r.mime === "image/png" ? await doc.embedPng(r.data) : await doc.embedJpg(r.data);
          const maxW = W - 2 * M, maxH = y - 50, sc = Math.min(maxW / img.width, maxH / img.height, 1);
          page.drawImage(img, { x: M, y: y - img.height * sc, width: img.width * sc, height: img.height * sc });
        }
      } catch { newPage(); text(label, { size: 10, f: bold, color: ORANGE }); y -= 16; para("This file couldn't be added to the PDF. Open it in Fenmorix OS to see it.", { color: SOFT }); }
    }
  }
  return doc.save();
}
