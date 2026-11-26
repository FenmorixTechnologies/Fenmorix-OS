// Expenses & Deductions (tile "books", vendor module "sales"): the business's expenses by Schedule C line, mileage log, vehicles, home
// office, monthly bills, receipts (photo or PDF; optional reading by Claude) and the accountant's packet (PDF with receipts, CSV).
// Server: server/books.js. Math: src/booksShared.js (same summary as the server's PDF). Never shipped to customers (packaging/owners.json).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LayoutDashboard, Receipt, Truck, Navigation2, Home, Repeat, FileDown, Settings, Plus, Pencil, Trash2, Paperclip, Sparkles,
  Download, Eye, X, Save, AlertTriangle, Search, Check } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, btn } from "./App.jsx";
import { CATEGORIES, CATEGORY, LINES, money, summarize, RECEIPT_AT, SIMPLIFIED_HOME_RATE, SIMPLIFIED_HOME_MAX } from "./booksShared.js";

const INK = "#13233F", SOFT = "#4B5565", LINE = "#DDE2EA", ORANGE = "#C94D00", GREEN = "#1F8A4C", RED = "#B42318";
const lbl = { fontSize: 12, fontWeight: 700, color: SOFT, display: "block", marginBottom: 3 };
const inp = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff", fontSize: 14, color: INK, boxSizing: "border-box", fontFamily: "inherit", margin: 0 };
const th = { textAlign: "left", fontSize: 11.5, color: SOFT, padding: "6px 8px", borderBottom: `2px solid ${LINE}`, whiteSpace: "nowrap" };
const td = { padding: "7px 8px", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, verticalAlign: "top" };
const tdn = { ...td, textAlign: "right", whiteSpace: "nowrap" };
const GROUP = { business: "Business expenses", vehicle: "Vehicle costs", home: "Home office bills" };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDay = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

async function api(path, body) {
  const r = await fetch(`/api/books${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
// Photos become JPEG (at most 2000 px), so WebP / iPhone HEIC (where the browser can open it) work too; PDFs go as they are
async function fileToDataUrl(file) {
  if (file.size > 25 * 1024 * 1024) throw new Error("That file is too big (25 MB at most before it's shrunk).");
  const raw = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error("Couldn't read that file.")); r.readAsDataURL(file); });
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return raw;
  const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That picture can't be opened here. On an iPhone, set Camera › Formats to Most Compatible, or upload a PDF.")); i.src = raw; });
  const sc = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}
const Card = ({ title, actions, children, style }) => <section style={{ ...cardStyle, marginBottom: 14, ...style }}>
  {(title || actions) && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 16, color: INK }}>{title}</h2><span style={{ flex: 1 }} />{actions}</div>}
  {children}</section>;
const Field = ({ label, children, style }) => <label style={{ display: "block", ...style }}><span style={lbl}>{label}</span>{children}</label>;
const Kpi = ({ label, value, sub, color = INK }) => <div style={{ ...cardStyle, padding: 14, borderLeft: `4px solid ${color === INK ? "#FF7900" : color}` }}>
  <div style={{ fontSize: 11.5, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
  <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>{sub && <div style={{ fontSize: 12, color: SOFT }}>{sub}</div>}</div>;
const grid = min => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 10 });
const Note = ({ children, color = SOFT }) => <div style={{ fontSize: 12.5, color, marginTop: 6 }}>{children}</div>;
function CategorySelect({ value, onChange, groups = ["business", "vehicle", "home"] }) {
  return <select aria-label="Category" style={inp} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">Pick a category…</option>
    {groups.map(g => <optgroup key={g} label={GROUP[g]}>{CATEGORIES.filter(c => c.group === g).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
  </select>;
}
function Receipts({ list, onRemove, canEdit }) {
  if (!list?.length) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>{list.map(r => <span key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${LINE}`, borderRadius: 999, padding: "2px 4px 2px 10px", fontSize: 12.5 }}>
    <a href={`/api/books/receipts/${r.id}`} target="_blank" rel="noreferrer" style={{ color: INK }}><Paperclip size={12} /> {r.name}</a>
    {canEdit && <button type="button" aria-label={`Remove ${r.name}`} style={{ ...btn("ghost"), padding: "0 4px", border: 0 }} onClick={() => onRemove(r)}><X size={13} /></button>}</span>)}</div>;
}

// ---------------------------------------------------------------- Overview
function Overview({ d, year, go, postBills, canEdit }) {
  const s = d.summary;
  const vehicleDed = s.vehicles.reduce((t, v) => t + v.deduction, 0);
  return <>
    <div style={{ ...grid(180), marginBottom: 14 }}>
      <Kpi label={`Deductions ${year}`} value={money(s.total)} sub={`from ${money(s.spent)} recorded`} color={GREEN} />
      <Kpi label="Business miles" value={s.miles.toLocaleString()} sub={`${s.trips} trips · ${(s.rate * 100).toFixed(1)}¢ a mile`} />
      <Kpi label="Vehicles" value={money(vehicleDed)} sub={s.vehicles.map(v => v.method === "actual" ? "actual costs" : "standard rate").join(", ") || "none yet"} />
      <Kpi label="Home office" value={money(s.home.deduction)} sub={s.home.officeSqft ? `${s.home.officeSqft} sq ft · ${s.home.method}` : "not set up"} />
      <Kpi label="Missing receipts" value={s.missingReceipts} sub={`$${RECEIPT_AT}+ or travel`} color={s.missingReceipts ? ORANGE : INK} />
    </div>
    {canEdit && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <button type="button" style={btn("primary")} onClick={() => go("expenses", { add: true })}><Plus size={14} /> Add an expense</button>
      <button type="button" style={btn()} onClick={() => go("mileage", { add: true })}><Navigation2 size={14} /> Log a trip</button>
      {d.recurring.some(r => r.active) && <button type="button" style={btn()} onClick={postBills}><Repeat size={14} /> Add this month's bills</button>}
      <button type="button" style={btn("ghost")} onClick={() => go("export")}><FileDown size={14} /> Accountant's packet</button>
    </div>}
    <Card title={`By Schedule C line · ${year}`}>
      {!s.lines.length ? <div style={{ color: SOFT }}>Nothing recorded for {year} yet. Start with an expense or a trip.</div> :
        <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Line</th><th style={th}>Schedule C</th><th style={{ ...th, textAlign: "right" }}>Spent</th><th style={{ ...th, textAlign: "right" }}>Deductible</th></tr></thead>
          <tbody>{s.lines.map(l => <tr key={l.line}><td style={td}>{l.line}</td><td style={td}>{l.label}</td><td style={tdn}>{money(l.amount)}</td><td style={{ ...tdn, fontWeight: 700 }}>{money(l.deductible)}</td></tr>)}
            <tr><td style={td} /><td style={{ ...td, fontWeight: 800 }}>Total</td><td style={tdn} /><td style={{ ...tdn, fontWeight: 800, color: GREEN }}>{money(s.total)}</td></tr></tbody></table></div>}
    </Card>
    {s.notes.length > 0 && <Card title="Worth knowing">{s.notes.map((n, i) => <div key={i} style={{ fontSize: 13.5, padding: "4px 0", display: "flex", gap: 8 }}><AlertTriangle size={15} color={ORANGE} style={{ flexShrink: 0, marginTop: 2 }} />{n}</div>)}</Card>}
    <Note>These are records for your accountant, grouped the way Schedule C lists them, not tax advice. Your accountant decides what's deductible, depreciation and limits.</Note>
  </>;
}

// ---------------------------------------------------------------- Expenses
function ExpenseEditor({ d, init, group, toast, onDone, onCancel }) {
  const blank = { day: today(), category: group === "home" ? "home_utilities" : group === "vehicle" ? "car_fuel" : "", amount: "", businessPct: 100, vendor: "", description: "",
    vehicleId: d.vehicles.find(v => v.active)?.id || "", clientId: "", paidWith: "", note: "" };
  const [f, setF] = useState(() => ({ ...blank, ...(init || {}) }));
  const [pending, setPending] = useState([]), [busy, setBusy] = useState(""), fileRef = useRef(null), readRef = useRef(null);
  const set = (k, v) => setF(o => ({ ...o, [k]: v, ...(k === "category" && !o.id ? { businessPct: CATEGORY[v]?.pct ?? 100 } : {}) }));
  const c = CATEGORY[f.category];
  const deductible = c ? (c.group === "business" ? Number(f.amount || 0) * Number(f.businessPct) / 100 * (c.half ? 0.5 : 1) : null) : null;
  const addFiles = async files => { for (const file of files) { try { setPending(p => [...p, { name: file.name, dataUrl: null }]); const dataUrl = await fileToDataUrl(file); setPending(p => p.map(x => x.name === file.name && !x.dataUrl ? { ...x, dataUrl } : x)); } catch (e) { toast(e.message); setPending(p => p.filter(x => x.name !== file.name || x.dataUrl)); } } };
  const readReceipt = async file => {
    setBusy("Reading the receipt…");
    try {
      const dataUrl = await fileToDataUrl(file);
      setPending(p => [...p, { name: file.name, dataUrl }]);
      const { fields } = await api("/read-receipt", { name: file.name, dataUrl });
      setF(o => ({ ...o, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "")) }));
      toast("Filled in from the receipt. Check it before saving.");
    } catch (e) { toast(e.message); } finally { setBusy(""); }
  };
  const save = async () => {
    setBusy("Saving…");
    try {
      const r = await api("/expenses", { ...f, vehicleId: c?.vehicle ? f.vehicleId : null });
      for (const p of pending.filter(p => p.dataUrl)) await api("/receipts", { expenseId: r.id, name: p.name, dataUrl: p.dataUrl });
      onDone(f.id ? "Saved." : "Expense added.");
    } catch (e) { toast(e.message); setBusy(""); }
  };
  const removeReceipt = async r => { if (!window.confirm(`Remove ${r.name}?`)) return; await api(`/receipts/${r.id}/remove`, {}).catch(e => toast(e.message)); setF(o => ({ ...o, receiptList: o.receiptList.filter(x => x.id !== r.id) })); };
  return <Card title={f.id ? "Change expense" : "Add an expense"} actions={!f.id && <>
    <input ref={readRef} type="file" accept="image/*,application/pdf" hidden aria-label="Receipt to read" onChange={e => { const x = e.target.files[0]; e.target.value = ""; if (x) readReceipt(x); }} />
    <button type="button" style={btn()} disabled={!!busy} onClick={() => readRef.current.click()}><Sparkles size={14} /> Start from a receipt</button></>}>
    <div style={grid(170)}>
      <Field label="Date"><input type="date" style={inp} value={f.day} onChange={e => set("day", e.target.value)} /></Field>
      <Field label="Category" style={{ gridColumn: "span 2" }}><CategorySelect value={f.category} onChange={v => set("category", v)} groups={group ? [group] : undefined} /></Field>
      <Field label="Amount ($)"><input aria-label="Amount" type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={f.amount} onChange={e => set("amount", e.target.value)} /></Field>
      <Field label="Paid to"><input aria-label="Paid to" style={inp} value={f.vendor} onChange={e => set("vendor", e.target.value)} placeholder="Store, company or person" /></Field>
      <Field label="What it was for" style={{ gridColumn: "span 2" }}><input aria-label="What it was for" style={inp} value={f.description} onChange={e => set("description", e.target.value)} /></Field>
      {c?.group === "business" && <Field label="Business use %"><input aria-label="Business use %" type="number" min="0" max="100" style={inp} value={f.businessPct} onChange={e => set("businessPct", e.target.value)} /></Field>}
      {c?.key === "car_parking" && <Field label="Business use %"><input aria-label="Business use %" type="number" min="0" max="100" style={inp} value={f.businessPct} onChange={e => set("businessPct", e.target.value)} /></Field>}
      {c?.vehicle && <Field label="Vehicle"><select aria-label="Vehicle" style={inp} value={f.vehicleId || ""} onChange={e => set("vehicleId", e.target.value)}><option value="">(none)</option>{d.vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>}
      <Field label="Client (optional)"><select aria-label="Client" style={inp} value={f.clientId || ""} onChange={e => set("clientId", e.target.value)}><option value="">(none)</option>{d.clients.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="Paid with"><input aria-label="Paid with" style={inp} value={f.paidWith} onChange={e => set("paidWith", e.target.value)} placeholder="Business card, cash…" /></Field>
      <Field label="Note" style={{ gridColumn: "1 / -1" }}><input aria-label="Note" style={inp} value={f.note} onChange={e => set("note", e.target.value)} /></Field>
    </div>
    {c && <Note>{c.half ? "Business meals: 50% of the business share counts. Note who you met and what you talked about. " : ""}
      {c.vehicle && !c.standardOk ? "If this vehicle uses the standard mileage rate, this cost is already covered by the rate (kept as a record). " : ""}
      {c.group === "home" ? "Enter the whole bill: the office share is figured on the Home office page. " : ""}
      {deductible != null && f.amount ? `Counts as ${money(deductible)}.` : ""}</Note>}
    <div style={{ marginTop: 10 }}>
      <span style={lbl}>Receipts</span>
      <Receipts list={f.receiptList} onRemove={removeReceipt} canEdit />
      {pending.map((p, i) => <span key={i} style={{ display: "inline-block", fontSize: 12.5, border: `1px dashed ${LINE}`, borderRadius: 999, padding: "2px 10px", margin: "6px 6px 0 0" }}><Paperclip size={12} /> {p.name}{p.dataUrl ? "" : " …"}</span>)}
      <div style={{ marginTop: 6 }}><input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden aria-label="Attach receipts" onChange={e => { const fs = [...e.target.files]; e.target.value = ""; addFiles(fs); }} />
        <button type="button" style={btn("ghost")} onClick={() => fileRef.current.click()}><Paperclip size={14} /> Attach a receipt (photo or PDF)</button></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
      <button type="button" style={btn("primary")} disabled={!!busy || pending.some(p => !p.dataUrl)} onClick={save}><Save size={14} /> {f.id ? "Save" : "Add expense"}</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button>{busy && <span style={{ color: SOFT, fontSize: 13 }}>{busy}</span>}</div>
  </Card>;
}
function ExpensesPage({ d, group, init, toast, reload, canEdit }) {
  const [edit, setEdit] = useState(init?.add ? {} : null), [q, setQ] = useState(""), [cat, setCat] = useState(""), [month, setMonth] = useState("");
  const veh = Object.fromEntries(d.vehicles.map(v => [v.id, v.name]));
  const list = d.expenses.filter(e => (!group || CATEGORY[e.category]?.group === group) && (!cat || e.category === cat) && (!month || e.day.slice(5, 7) === month)
    && (!q || `${e.vendor} ${e.description} ${e.note} ${CATEGORY[e.category]?.label}`.toLowerCase().includes(q.toLowerCase())));
  const total = list.reduce((s, e) => s + e.amount, 0);
  const remove = async e => { if (!window.confirm(`Remove ${e.vendor || "this expense"} (${money(e.amount)})? Its receipts go too.`)) return; try { await api(`/expenses/${e.id}/remove`, {}); toast("Removed."); reload(); } catch (x) { toast(x.message); } };
  if (edit) return <ExpenseEditor d={d} init={edit} group={group} toast={toast} onCancel={() => setEdit(null)} onDone={m => { setEdit(null); toast(m); reload(); }} />;
  return <Card title={group === "vehicle" ? "Vehicle costs" : "Expenses"} actions={canEdit && <button type="button" style={btn("primary")} onClick={() => setEdit({})}><Plus size={14} /> Add an expense</button>}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={{ position: "relative", flex: "1 1 200px" }}><Search size={14} style={{ position: "absolute", left: 9, top: 11, color: SOFT }} /><input aria-label="Search expenses" style={{ ...inp, paddingLeft: 28 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search" /></div>
      <div style={{ flex: "1 1 220px" }}><CategorySelect value={cat} onChange={setCat} groups={group ? [group] : undefined} /></div>
      <select aria-label="Month" style={{ ...inp, width: 140 }} value={month} onChange={e => setMonth(e.target.value)}><option value="">Every month</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1).padStart(2, "0")}>{new Date(2026, i, 1).toLocaleString("en-US", { month: "long" })}</option>)}</select>
    </div>
    {!list.length ? <div style={{ color: SOFT }}>No expenses here.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr><th style={th}>Date</th><th style={th}>Category</th><th style={th}>Paid to / for</th><th style={{ ...th, textAlign: "right" }}>Amount</th><th style={{ ...th, textAlign: "right" }}>Business</th><th style={th}>Receipt</th><th style={th} /></tr></thead>
      <tbody>{list.map(e => { const c = CATEGORY[e.category] || {}; const needs = !e.receipts && (e.amount >= RECEIPT_AT || e.category === "travel");
        return <tr key={e.id}><td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDay(e.day)}</td><td style={td}>{c.label}<div style={{ fontSize: 11.5, color: SOFT }}>Line {c.line}</div></td>
          <td style={td}><b>{e.vendor}</b>{e.description && <div style={{ color: SOFT, fontSize: 12.5 }}>{e.description}</div>}{e.vehicleId && <div style={{ color: SOFT, fontSize: 12 }}><Truck size={11} /> {veh[e.vehicleId]}</div>}</td>
          <td style={tdn}>{money(e.amount)}</td><td style={tdn}>{c.group === "business" ? `${e.businessPct}%` : ""}</td>
          <td style={td}>{e.receipts ? e.receiptList.map(r => <a key={r.id} href={`/api/books/receipts/${r.id}`} target="_blank" rel="noreferrer" title={r.name} style={{ marginRight: 4, color: INK }}><Paperclip size={14} /></a>) : needs ? <span style={{ color: ORANGE, fontSize: 12, fontWeight: 700 }}>Needs one</span> : <span style={{ color: SOFT }}>–</span>}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{canEdit && <><button type="button" aria-label={`Change ${e.vendor}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => setEdit(e)}><Pencil size={13} /></button>
            <button type="button" aria-label={`Remove ${e.vendor}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => remove(e)}><Trash2 size={13} /></button></>}</td></tr>; })}
        <tr><td style={td} colSpan={3}><b>{list.length} shown</b></td><td style={{ ...tdn, fontWeight: 800 }}>{money(total)}</td><td style={td} colSpan={3} /></tr></tbody></table></div>}
  </Card>;
}

// ---------------------------------------------------------------- Mileage + vehicles
function TripEditor({ d, init, toast, onDone, onCancel }) {
  const [f, setF] = useState(() => ({ day: today(), vehicleId: d.vehicles.find(v => v.active)?.id || "", purpose: "", fromPlace: "", toPlace: "", miles: "", roundTrip: false, odoStart: "", odoEnd: "", clientId: "", ...(init || {}) }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const odoMiles = f.odoStart !== "" && f.odoEnd !== "" && Number(f.odoEnd) > Number(f.odoStart) ? Number(f.odoEnd) - Number(f.odoStart) : null;
  const save = async () => {
    setBusy(true);
    try {
      const oneWay = Number(f.miles || 0);
      const miles = f.id ? oneWay : (f.roundTrip && oneWay ? oneWay * 2 : oneWay);
      await api("/trips", { ...f, miles: miles || odoMiles || 0, odoStart: f.odoStart === "" ? null : f.odoStart, odoEnd: f.odoEnd === "" ? null : f.odoEnd });
      onDone(f.id ? "Saved." : "Trip logged.");
    } catch (e) { toast(e.message); setBusy(false); }
  };
  return <Card title={f.id ? "Change trip" : "Log a trip"}>
    <datalist id="books-places">{d.places.map(p => <option key={p} value={p} />)}</datalist>
    <div style={grid(170)}>
      <Field label="Date"><input type="date" style={inp} value={f.day} onChange={e => set("day", e.target.value)} /></Field>
      <Field label="Vehicle"><select aria-label="Vehicle" style={inp} value={f.vehicleId || ""} onChange={e => set("vehicleId", e.target.value)}><option value="">(none)</option>{d.vehicles.filter(v => v.active || v.id === f.vehicleId).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label="Business purpose" style={{ gridColumn: "span 2" }}><input aria-label="Business purpose" style={inp} value={f.purpose} onChange={e => set("purpose", e.target.value)} placeholder="Install at a client, supply run, meeting…" /></Field>
      <Field label="From"><input aria-label="From" list="books-places" style={inp} value={f.fromPlace} onChange={e => set("fromPlace", e.target.value)} /></Field>
      <Field label="To"><input aria-label="To" list="books-places" style={inp} value={f.toPlace} onChange={e => set("toPlace", e.target.value)} /></Field>
      <Field label={f.roundTrip && !f.id ? "Miles one way" : "Miles"}><input aria-label="Miles" type="number" min="0" step="0.1" inputMode="decimal" style={inp} value={f.miles} onChange={e => set("miles", e.target.value)} placeholder={odoMiles ? String(odoMiles) : ""} /></Field>
      {!f.id && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: INK, marginTop: 20 }}><input type="checkbox" checked={f.roundTrip} onChange={e => set("roundTrip", e.target.checked)} /> Round trip (doubles the miles)</label>}
      <Field label="Odometer start (optional)"><input aria-label="Odometer start" type="number" style={inp} value={f.odoStart ?? ""} onChange={e => set("odoStart", e.target.value)} /></Field>
      <Field label="Odometer end (optional)"><input aria-label="Odometer end" type="number" style={inp} value={f.odoEnd ?? ""} onChange={e => set("odoEnd", e.target.value)} /></Field>
      <Field label="Client (optional)"><select aria-label="Client" style={inp} value={f.clientId || ""} onChange={e => set("clientId", e.target.value)}><option value="">(none)</option>{d.clients.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
    </div>
    <Note>The IRS asks for the date, where you went, the business purpose and the miles, written down at the time. Driving from home to a regular workplace is commuting, not business.</Note>
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button type="button" style={btn("primary")} disabled={busy} onClick={save}><Save size={14} /> {f.id ? "Save" : "Log trip"}</button><button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
  </Card>;
}
function VehicleRow({ v, vy, year, toast, reload, canEdit }) {
  const [f, setF] = useState({ odoStart: vy?.odoStart ?? "", odoEnd: vy?.odoEnd ?? "", method: vy?.method || "standard", commuteMiles: vy?.commuteMiles || "" });
  const [dirty, setDirty] = useState(false);
  const set = (k, x) => { setF(o => ({ ...o, [k]: x })); setDirty(true); };
  const save = async () => { try { await api(`/vehicles/${v.id}/year`, { year, ...f, odoStart: f.odoStart === "" ? null : f.odoStart, odoEnd: f.odoEnd === "" ? null : f.odoEnd }); setDirty(false); toast("Saved."); reload(); } catch (e) { toast(e.message); } };
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
    <div style={{ fontWeight: 800, color: INK }}><Truck size={15} /> {v.name} {!v.active && <span style={{ color: SOFT, fontWeight: 600 }}>(not in use)</span>}</div>
    {v.details && <div style={{ fontSize: 12.5, color: SOFT }}>{v.details}</div>}
    <div style={{ ...grid(140), marginTop: 8 }}>
      <Field label={`Odometer Jan 1, ${year}`}><input aria-label={`${v.name} odometer start`} type="number" style={inp} disabled={!canEdit} value={f.odoStart} onChange={e => set("odoStart", e.target.value)} /></Field>
      <Field label={`Odometer Dec 31, ${year}`}><input aria-label={`${v.name} odometer end`} type="number" style={inp} disabled={!canEdit} value={f.odoEnd} onChange={e => set("odoEnd", e.target.value)} /></Field>
      <Field label="Method"><select aria-label={`${v.name} method`} style={inp} disabled={!canEdit} value={f.method} onChange={e => set("method", e.target.value)}><option value="standard">Standard mileage rate</option><option value="actual">Actual costs</option></select></Field>
      <Field label="Commuting miles"><input aria-label={`${v.name} commuting miles`} type="number" style={inp} disabled={!canEdit} value={f.commuteMiles} onChange={e => set("commuteMiles", e.target.value)} /></Field>
    </div>
    {canEdit && dirty && <button type="button" style={{ ...btn("primary"), marginTop: 8 }} onClick={save}><Save size={14} /> Save {v.name}</button>}
  </div>;
}
function MileagePage({ d, year, init, toast, reload, canEdit }) {
  const [edit, setEdit] = useState(init?.add ? {} : null), [veh, setVeh] = useState(null);
  const vn = Object.fromEntries(d.vehicles.map(v => [v.id, v.name]));
  const s = d.summary;
  const remove = async t => { if (!window.confirm(`Remove the trip on ${fmtDay(t.day)}?`)) return; try { await api(`/trips/${t.id}/remove`, {}); toast("Removed."); reload(); } catch (e) { toast(e.message); } };
  const saveVeh = async () => { try { await api("/vehicles", veh); setVeh(null); toast("Vehicle saved."); reload(); } catch (e) { toast(e.message); } };
  if (edit) return <TripEditor d={d} init={edit} toast={toast} onCancel={() => setEdit(null)} onDone={m => { setEdit(null); toast(m); reload(); }} />;
  return <>
    <Card title={`Mileage log · ${year}`} actions={canEdit && <button type="button" style={btn("primary")} onClick={() => setEdit({})}><Plus size={14} /> Log a trip</button>}>
      <div style={{ fontSize: 13.5, color: SOFT, marginBottom: 8 }}>{s.miles.toLocaleString()} business miles · {s.trips} trips · {money(s.miles * s.rate)} at {(s.rate * 100).toFixed(1)}¢ a mile</div>
      {!d.trips.length ? <div style={{ color: SOFT }}>No trips logged for {year}.</div> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Purpose</th><th style={th}>Route</th><th style={th}>Vehicle</th><th style={{ ...th, textAlign: "right" }}>Miles</th><th style={th} /></tr></thead>
        <tbody>{d.trips.map(t => <tr key={t.id}><td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDay(t.day)}</td><td style={td}>{t.purpose}</td>
          <td style={td}>{[t.fromPlace, t.toPlace].filter(Boolean).join(" → ")}{t.roundTrip ? " (round trip)" : ""}</td><td style={td}>{vn[t.vehicleId] || ""}</td><td style={tdn}>{t.miles.toFixed(1)}</td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{canEdit && <><button type="button" title="Same trip again today" aria-label={`Repeat ${t.purpose}`} style={{ ...btn("ghost"), padding: "2px 6px" }}
            onClick={() => setEdit({ ...t, id: undefined, day: today(), roundTrip: false, odoStart: "", odoEnd: "" })}><Repeat size={13} /></button>
            <button type="button" aria-label={`Change ${t.purpose}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => setEdit(t)}><Pencil size={13} /></button>
            <button type="button" aria-label={`Remove ${t.purpose}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => remove(t)}><Trash2 size={13} /></button></>}</td></tr>)}</tbody></table></div>}
    </Card>
    <Card title="Vehicles" actions={canEdit && !veh && <button type="button" style={btn()} onClick={() => setVeh({ name: "", details: "", inService: "", active: true })}><Plus size={14} /> Add a vehicle</button>}>
      {veh && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
        <div style={grid(170)}><Field label="Name"><input aria-label="Vehicle name" style={inp} value={veh.name} onChange={e => setVeh({ ...veh, name: e.target.value })} placeholder="2022 F-150" /></Field>
          <Field label="Details"><input aria-label="Vehicle details" style={inp} value={veh.details} onChange={e => setVeh({ ...veh, details: e.target.value })} placeholder="Make, model, plate" /></Field>
          <Field label="First used for the business"><input type="date" aria-label="In service" style={inp} value={veh.inService || ""} onChange={e => setVeh({ ...veh, inService: e.target.value })} /></Field>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 20 }}><input type="checkbox" checked={veh.active} onChange={e => setVeh({ ...veh, active: e.target.checked })} /> In use</label></div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn("primary")} onClick={saveVeh}><Save size={14} /> Save vehicle</button><button type="button" style={btn("ghost")} onClick={() => setVeh(null)}>Cancel</button></div></div>}
      {!d.vehicles.length && !veh && <div style={{ color: SOFT }}>Add the vehicle you drive for the business, then record its odometer on Jan 1 and Dec 31.</div>}
      {d.vehicles.map(v => <div key={v.id}><VehicleRow key={year + v.id + JSON.stringify(d.vehicleYears[v.id] || {})} v={v} vy={d.vehicleYears[v.id]} year={year} toast={toast} reload={reload} canEdit={canEdit} />
        {canEdit && <button type="button" style={{ ...btn("ghost"), marginTop: -6, marginBottom: 10, fontSize: 12.5 }} onClick={() => setVeh(v)}><Pencil size={12} /> Rename / not in use</button>}</div>)}
      {s.vehicles.length > 0 && <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>{year}</th><th style={{ ...th, textAlign: "right" }}>Business mi</th><th style={{ ...th, textAlign: "right" }}>Total mi</th><th style={{ ...th, textAlign: "right" }}>Business %</th><th style={{ ...th, textAlign: "right" }}>Costs recorded</th><th style={{ ...th, textAlign: "right" }}>Deduction</th></tr></thead>
        <tbody>{s.vehicles.map(v => <tr key={v.id || "none"}><td style={td}>{v.name}<div style={{ fontSize: 11.5, color: SOFT }}>{v.method === "actual" ? "Actual costs" : "Standard rate"}</div></td><td style={tdn}>{v.businessMiles.toLocaleString()}</td>
          <td style={tdn}>{v.totalMiles == null ? "—" : v.totalMiles.toLocaleString()}</td><td style={tdn}>{v.pct == null ? "—" : v.pct + "%"}</td><td style={tdn}>{money(v.costs + v.parking + v.interest)}</td><td style={{ ...tdn, fontWeight: 800 }}>{money(v.deduction)}</td></tr>)}</tbody></table></div>}
      <Note>Standard rate: business miles × the IRS rate, plus parking, tolls and the business share of loan interest (fuel, repairs and insurance are built into the rate). Actual costs: everything × the business-use %, plus depreciation your accountant figures. If you use the standard rate the first year a vehicle is used, you can switch later; not the other way around.</Note>
    </Card>
    <ExpensesPage d={d} group="vehicle" toast={toast} reload={reload} canEdit={canEdit} />
  </>;
}

// ---------------------------------------------------------------- Home office
function HomePage({ d, year, toast, reload, canEdit, canManage }) {
  const cur = d.settings.home?.[year] || {};
  const [h, setH] = useState({ method: cur.method || "simplified", officeSqft: cur.officeSqft || "", homeSqft: cur.homeSqft || "", months: cur.months ?? 12, note: cur.note || "" });
  const [dirty, setDirty] = useState(false);
  const set = (k, v) => { setH(o => ({ ...o, [k]: v })); setDirty(true); };
  const preview = useMemo(() => summarize({ year, expenses: d.expenses, trips: [], vehicles: [], settings: { ...d.settings, home: { [year]: h } } }).home, [h, d, year]);
  const save = async () => { try { await api("/settings", { home: { [year]: h } }); setDirty(false); toast("Saved."); reload(); } catch (e) { toast(e.message); } };
  return <>
    <Card title={`Home office · ${year}`}>
      <div style={grid(170)}>
        <Field label="Office (sq ft)"><input aria-label="Office square feet" type="number" style={inp} disabled={!canManage} value={h.officeSqft} onChange={e => set("officeSqft", e.target.value)} /></Field>
        <Field label="Whole home (sq ft)"><input aria-label="Home square feet" type="number" style={inp} disabled={!canManage} value={h.homeSqft} onChange={e => set("homeSqft", e.target.value)} /></Field>
        <Field label="Months used in the year"><input aria-label="Months used" type="number" min="0" max="12" style={inp} disabled={!canManage} value={h.months} onChange={e => set("months", e.target.value)} /></Field>
        <Field label="Method"><select aria-label="Home office method" style={inp} disabled={!canManage} value={h.method} onChange={e => set("method", e.target.value)}>
          <option value="simplified">Simplified (${SIMPLIFIED_HOME_RATE}/sq ft, up to {SIMPLIFIED_HOME_MAX})</option><option value="actual">Actual expenses (Form 8829)</option><option value="none">Not claiming</option></select></Field>
      </div>
      <div style={{ ...grid(180), marginTop: 12 }}>
        <Kpi label="Simplified method" value={money(preview.simplified)} sub={`${Math.min(Number(h.officeSqft) || 0, SIMPLIFIED_HOME_MAX)} sq ft × $${SIMPLIFIED_HOME_RATE}${Number(h.months) < 12 ? ` × ${h.months}/12` : ""}`} color={h.method === "simplified" ? GREEN : INK} />
        <Kpi label="Actual-expense method" value={money(preview.actual)} sub={`${preview.officePct}% of ${money(preview.homeTotal)} home bills${preview.direct ? ` + ${money(preview.direct)} office-only` : ""}`} color={h.method === "actual" ? GREEN : INK} />
      </div>
      {preview.actual > preview.simplified + 50 && h.method === "simplified" && <Note color={ORANGE}>With these numbers the actual-expense method comes out {money(preview.actual - preview.simplified)} higher. Ask your accountant; with actual expenses, depreciation of the home is figured too (and taken back when you sell).</Note>}
      {canManage && dirty && <button type="button" style={{ ...btn("primary"), marginTop: 10 }} onClick={save}><Save size={14} /> Save home office</button>}
      <Note>The office has to be used regularly and only for the business (a desk in the guest room that's also the guest room doesn't count). Under the simplified method mortgage interest and property taxes still go on Schedule A.</Note>
    </Card>
    <ExpensesPage d={d} group="home" toast={toast} reload={reload} canEdit={canEdit} />
  </>;
}

// ---------------------------------------------------------------- Monthly bills
function BillsPage({ d, toast, reload, canEdit }) {
  const [edit, setEdit] = useState(null);
  const now = new Date(), [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const save = async () => { try { await api("/recurring", edit); setEdit(null); toast("Saved."); reload(); } catch (e) { toast(e.message); } };
  const post = async () => { try { const r = await api("/recurring/post", { month }); toast(r.added ? `Added ${r.added} bill${r.added === 1 ? "" : "s"} for ${month}.` : `Those bills are already in for ${month}.`); reload(); } catch (e) { toast(e.message); } };
  const remove = async r => { if (!window.confirm(`Stop tracking ${r.vendor}? Expenses already added stay.`)) return; try { await api(`/recurring/${r.id}/remove`, {}); reload(); } catch (e) { toast(e.message); } };
  return <Card title="Monthly bills" actions={canEdit && <button type="button" style={btn()} onClick={() => setEdit({ category: "software", vendor: "", description: "", amount: "", businessPct: 100, dayOfMonth: 1, active: true })}><Plus size={14} /> Add a monthly bill</button>}>
    <div style={{ fontSize: 13.5, color: SOFT, marginBottom: 10 }}>Bills that come every month (internet, phone, hosting, software). One click adds the month's expenses; change the amount afterward if a bill was different.</div>
    {edit && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={grid(170)}>
        <Field label="Category" style={{ gridColumn: "span 2" }}><CategorySelect value={edit.category} onChange={v => setEdit({ ...edit, category: v, businessPct: CATEGORY[v]?.pct ?? edit.businessPct })} /></Field>
        <Field label="Paid to"><input aria-label="Bill paid to" style={inp} value={edit.vendor} onChange={e => setEdit({ ...edit, vendor: e.target.value })} /></Field>
        <Field label="What"><input aria-label="Bill description" style={inp} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
        <Field label="Amount ($)"><input aria-label="Bill amount" type="number" step="0.01" style={inp} value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} /></Field>
        <Field label="Business use %"><input aria-label="Bill business use" type="number" min="0" max="100" style={inp} value={edit.businessPct} onChange={e => setEdit({ ...edit, businessPct: e.target.value })} /></Field>
        <Field label="Day of the month"><input aria-label="Day of the month" type="number" min="1" max="28" style={inp} value={edit.dayOfMonth} onChange={e => setEdit({ ...edit, dayOfMonth: e.target.value })} /></Field>
        <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 20 }}><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Still paying it</label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn("primary")} onClick={save}><Save size={14} /> Save bill</button><button type="button" style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button></div></div>}
    {!d.recurring.length ? <div style={{ color: SOFT }}>No monthly bills yet.</div> : <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Bill</th><th style={th}>Category</th><th style={{ ...th, textAlign: "right" }}>Amount</th><th style={{ ...th, textAlign: "right" }}>Business</th><th style={th} /></tr></thead>
      <tbody>{d.recurring.map(r => <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}><td style={td}><b>{r.vendor}</b> <span style={{ color: SOFT }}>{r.description}</span><div style={{ fontSize: 11.5, color: SOFT }}>day {r.dayOfMonth}{r.active ? "" : " · stopped"}</div></td>
        <td style={td}>{CATEGORY[r.category]?.label}</td><td style={tdn}>{money(r.amount)}</td><td style={tdn}>{r.businessPct}%</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{canEdit && <><button type="button" aria-label={`Change ${r.vendor}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => setEdit(r)}><Pencil size={13} /></button><button type="button" aria-label={`Remove ${r.vendor}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => remove(r)}><Trash2 size={13} /></button></>}</td></tr>)}</tbody></table>}
    {canEdit && d.recurring.some(r => r.active) && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
      <input type="month" aria-label="Bills month" style={{ ...inp, width: 170 }} value={month} onChange={e => setMonth(e.target.value)} />
      <button type="button" style={btn("primary")} onClick={post}><Check size={14} /> Add the bills for this month</button></div>}
  </Card>;
}

// ---------------------------------------------------------------- Export + settings
function ExportPage({ d, year }) {
  const s = d.summary, biz = d.settings.business;
  return <>
    <Card title={`Accountant's packet · ${year}`}>
      <div style={{ fontSize: 14, color: INK, marginBottom: 12 }}>One PDF with the summary by Schedule C line, notes, vehicles, home office, every expense, the mileage log, and each receipt on its own page. The CSV has the same lines for a spreadsheet.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a style={{ ...btn("primary"), textDecoration: "none" }} href={`/api/books/export.pdf?year=${year}`}><Download size={14} /> PDF with receipts</a>
        <a style={{ ...btn(), textDecoration: "none" }} href={`/api/books/export.pdf?year=${year}&receipts=0`}><Download size={14} /> PDF without receipts</a>
        <a style={{ ...btn(), textDecoration: "none" }} href={`/api/books/export.csv?year=${year}`}><Download size={14} /> Spreadsheet (CSV)</a>
      </div>
      <Note>{s.expenses} expenses, {s.trips} trips, {money(s.total)} in deductions{s.missingReceipts ? `; ${s.missingReceipts} still need a receipt` : ""}.{biz.accountantEmail ? ` Send it to ${biz.accountant || biz.accountantEmail} at ${biz.accountantEmail}.` : ""}</Note>
    </Card>
    <Card title="Also bring your accountant">
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, color: INK, lineHeight: 1.6 }}>
        <li>Income: every 1099-NEC / 1099-K, and the business bank statements for the year (clients' payments).</li>
        <li>Federal and Louisiana estimated tax payments you made (dates and amounts).</li>
        <li>Health insurance premiums you paid yourself (self-employed deduction, not Schedule C).</li>
        <li>Retirement contributions (SEP-IRA or Solo 401(k)).</li>
        <li>Big purchases (computers, equipment, a vehicle) with dates placed in service, for depreciation or Section 179.</li>
        <li>Louisiana LLC annual report fee and any local occupational license. If your address is now inside the City of St. George, say so: it changes local sales tax and licensing, not the federal return.</li>
      </ul>
    </Card>
  </>;
}
function SettingsPage({ d, year, toast, reload, canManage }) {
  const [biz, setBiz] = useState(d.settings.business), [rates, setRates] = useState(d.settings.rates);
  const save = async () => { try { await api("/settings", { business: biz, rates }); toast("Saved."); reload(); } catch (e) { toast(e.message); } };
  const years = [...new Set([...Object.keys(rates), String(year)])].sort().reverse();
  const B = (k, label, span) => <Field label={label} style={span ? { gridColumn: "span 2" } : undefined}><input aria-label={label} style={inp} disabled={!canManage} value={biz[k] || ""} onChange={e => setBiz({ ...biz, [k]: e.target.value })} /></Field>;
  return <>
    <Card title="Business details (printed on the packet)">
      <div style={grid(190)}>{B("name", "Business name")}{B("owner", "Owner")}{B("entity", "Tax setup")}{B("address", "Street address", true)}{B("city", "City")}{B("state", "State")}{B("zip", "ZIP")}{B("accountant", "Accountant")}{B("accountantEmail", "Accountant's email")}</div>
      <Note>The City of St. George is now its own city. If your address is inside its limits, use St. George as the city (it matters for local sales tax and licenses; your federal Schedule C is the same either way). Don't put tax ID or bank numbers here.</Note>
    </Card>
    <Card title="IRS standard mileage rate">
      <div style={grid(150)}>{years.map(y => <Field key={y} label={`${y} ($ per mile)`}><input aria-label={`Mileage rate ${y}`} type="number" step="0.005" style={inp} disabled={!canManage} value={rates[y] ?? ""} onChange={e => setRates({ ...rates, [y]: e.target.value })} /></Field>)}</div>
      <Note>2026: $0.725 a mile (IRS IR-2025-128); 2025: $0.70. The IRS announces the next year's rate each December.</Note>
    </Card>
    {canManage && <button type="button" style={btn("primary")} onClick={save}><Save size={14} /> Save settings</button>}
  </>;
}

export default function BooksModule({ onBack }) {
  const [year, setYear] = useState(new Date().getFullYear()), [d, setD] = useState(null), [msg, setMsg] = useState("");
  const [view, setView] = useState({ page: "overview" });
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const load = (y = year) => api(`?year=${y}`).then(setD, e => toast(e.message));
  useEffect(() => { load(year); }, [year]);
  const go = (page, init) => { setView({ page, init, t: Date.now() }); window.scrollTo?.(0, 0); };
  const postBills = async () => { const n = new Date(); try { const r = await api("/recurring/post", { month: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}` }); toast(r.added ? `Added ${r.added} bill${r.added === 1 ? "" : "s"}.` : "This month's bills are already in."); load(); } catch (e) { toast(e.message); } };
  const rights = d?.rights || {};
  const nav = [{ key: "overview", label: "Overview", icon: LayoutDashboard }, { key: "expenses", label: "Expenses", icon: Receipt, badge: d?.summary.missingReceipts || 0 },
    { key: "mileage", label: "Mileage & vehicles", icon: Navigation2 }, { key: "homeoffice", label: "Home office", icon: Home }, { key: "bills", label: "Monthly bills", icon: Repeat },
    { key: "export", label: "Accountant's packet", icon: FileDown, group: "Tax time" }, { key: "settings", label: "Settings", icon: Settings, group: "Tax time" }];
  const props = { d, year, toast, reload: () => load(), canEdit: rights.canEdit, canManage: rights.canManage, init: view.init };
  return <AppShell section="Expenses & Deductions" nav={nav} active={view.page} onNav={k => go(k)} onHome={onBack}>
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "8px 16px", borderRadius: 8, zIndex: 60 }}>{msg}</div>}
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <h1 style={{ margin: 0, fontSize: 24, color: INK }}>Expenses &amp; Deductions</h1><span style={{ flex: 1 }} />
      <label style={{ fontSize: 13, color: SOFT, display: "flex", gap: 6, alignItems: "center" }}>Tax year
        <select aria-label="Tax year" style={{ ...inp, width: 100 }} value={year} onChange={e => setYear(Number(e.target.value))}>{(d?.years || [year]).map(y => <option key={y} value={y}>{y}</option>)}</select></label>
    </div>
    {!d ? <div style={{ color: SOFT }}>Loading…</div> : <div key={view.t + "-" + year}>
      {view.page === "overview" && <Overview d={d} year={year} go={go} postBills={postBills} canEdit={rights.canEdit} />}
      {view.page === "expenses" && <ExpensesPage {...props} group="business" />}
      {view.page === "mileage" && <MileagePage {...props} />}
      {view.page === "homeoffice" && <HomePage key={year} {...props} />}
      {view.page === "bills" && <BillsPage {...props} />}
      {view.page === "export" && <ExportPage {...props} />}
      {view.page === "settings" && <SettingsPage {...props} />}
    </div>}
  </AppShell>;
}
