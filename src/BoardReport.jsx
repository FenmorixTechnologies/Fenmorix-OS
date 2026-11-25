// Board report: the Fire Chief's operational report for Fire Board meetings over any date range. Same idea as the Comms
// Statistics reports: start from a template, add / remove / reorder sections, write commentary under any section, save,
// share as a template, and print (Letter) or save as PDF. Server: server/board.js.
import React, { useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand.js";
import { createPortal } from "react-dom";
import { Landmark, FileText, Printer, Save, Copy, Trash2, Plus, ChevronUp, ChevronDown, ArrowLeft, SlidersHorizontal } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { C, TimeChart, BarChart, DataTable, Delta, mmss, int, dec, pctTxt, change, shortDay, longDay, DOW, hh } from "./StatCharts.jsx";
import { PN } from "./brand.js";

async function api(path, body) {
  const r = await fetch(`/api/board${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const D = s => new Date(s + "T00:00:00Z");
const S = d => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const blk = (type, title = "", text = "") => ({ id: newId(), type, title, text });

export const BLOCK_TYPES = [
  ["heading", "Heading"], ["text", "Text / commentary"], ["kpis", "Headline numbers"], ["volume", "Calls over time"],
  ["types", "Calls by type"], ["natures", "Top call natures"], ["response", "Response times"], ["hours", "Calls by hour of day"],
  ["dow", "Calls by day of week"], ["units", "Apparatus responses"], ["aid", "Aid given to other agencies"], ["fires", "Structure fires"],
  ["prevention", "Fire prevention inspections"], ["training", "Training hours"], ["staffing", "Sick leave (totals)"], ["pial", "PIAL / ISO rating"],
];
const WINDOWS = [["lastMonth", "Last full month"], ["lastQuarter", "Last full quarter"], ["ytd", "Year to date"], ["lastYear", "Last full year"], ["last30", "Last 30 days"], ["custom", "Fixed dates"]];
export function reportWindow(r, today) {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  switch (r.windowKind) {
    case "custom": if (r.from && r.to) return { from: r.from, to: r.to }; break;
    case "lastQuarter": { const q = Math.floor((m - 1) / 3); const start = S(new Date(Date.UTC(y, q * 3 - 3, 1))); return { from: start, to: plus(S(new Date(Date.UTC(y, q * 3, 1))), -1) }; }
    case "ytd": return { from: `${y}-01-01`, to: plus(today, -1) < `${y}-01-01` ? today : plus(today, -1) };
    case "lastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "last30": return { from: plus(today, -30), to: plus(today, -1) };
    default: break;
  }
  return { from: S(new Date(Date.UTC(y, m - 2, 1))), to: plus(`${today.slice(0, 7)}-01`, -1) };
}
function templates() {
  const monthly = [blk("kpis"), blk("heading", "Calls for service"), blk("volume"), blk("types"), blk("natures"), blk("heading", "Response"), blk("response"),
    blk("heading", "Apparatus"), blk("units"), blk("aid"), blk("heading", "Fires"), blk("fires"), blk("heading", "Department"), blk("training"), blk("prevention"), blk("pial"),
    blk("heading", "Chief's comments"), blk("text", "", "")];
  return [
    { key: "monthly", title: "Monthly Operational Report to the Fire Board", reportType: "Board meeting", windowKind: "lastMonth", blocks: monthly },
    { key: "quarterly", title: "Quarterly Operational Report", reportType: "Board meeting", windowKind: "lastQuarter",
      blocks: [blk("kpis"), blk("volume"), blk("types"), blk("response"), blk("hours"), blk("dow"), blk("units"), blk("aid"), blk("fires"), blk("training"), blk("prevention"), blk("staffing"), blk("pial"), blk("text")] },
    { key: "annual", title: "Annual Operational Report", reportType: "Annual report", windowKind: "lastYear",
      blocks: [blk("kpis"), blk("volume"), blk("types"), blk("natures"), blk("response"), blk("units"), blk("aid"), blk("fires"), blk("training"), blk("prevention"), blk("staffing"), blk("pial"), blk("text")] },
  ];
}
const pointLabel = (p, grain) => grain === "day" ? shortDay(p.key) : grain === "week" ? shortDay(p.start) : D(p.key).toLocaleDateString([], { month: "short", year: "2-digit", timeZone: "UTC" });
const pointTip = (p, grain) => grain === "day" ? D(p.key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  : grain === "week" ? `Week of ${longDay(p.start)}` : D(p.key).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
const grainWord = g => (g === "day" ? "daily" : g === "week" ? "weekly" : "monthly");
const chg = rows => rows.map(r => ({ ...r, chg: change(r.n, r.ly) }));
const chgCol = { key: "chg", label: "Change", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "+" : ""}${dec(v)}%`) };

function Tiles({ items }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8 }}>
    {items.map(([l, v, s]) => (
      <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px" }}><div style={{ fontSize: 10.5, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>{l}</div>
        <div style={{ fontSize: 21, fontWeight: 800, color: C.ink }}>{v}</div>{s && <div style={{ fontSize: 11 }}>{s}</div>}</div>))}
  </div>;
}

function Paper({ r, w, data, print }) {
  const fw = print ? 690 : undefined;
  const generated = new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const d = data.d;
  const block = b => {
    const t = (title, el) => <div className="sgfd-block" key={b.id} style={{ margin: "14px 0", breakInside: "avoid" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{b.title || title}</div>{el}
      {b.text && <p style={{ fontSize: 12.5, color: C.ink, whiteSpace: "pre-wrap", margin: "6px 0 0", fontStyle: "italic" }}>{b.text}</p>}</div>;
    const k = d.kpis;
    switch (b.type) {
      case "heading": return <h2 key={b.id} className="sgfd-block" style={{ fontFamily: "Georgia, serif", fontSize: 19, color: C.ink, borderBottom: `2px solid ${C.brick}`, padding: "0 0 4px", margin: "22px 0 8px", breakAfter: "avoid" }}>{b.title || "Section"}</h2>;
      case "text": return <p key={b.id} className="sgfd-block" style={{ fontSize: 13.5, color: C.ink, whiteSpace: "pre-wrap", margin: "10px 0" }}>{b.text}</p>;
      case "kpis": return t("Headline numbers", <Tiles items={[
        ["Calls for service", int(k.incidents), <Delta now={k.incidents} then={k.ly} suffix="vs last year" />],
        ["Daily average", dec(k.dailyAvg), <Delta now={k.dailyAvg} then={k.dailyAvgLy} suffix="vs last year" />],
        ["Response (median)", mmss(k.response50), <span style={{ color: C.soft }}>call received to on scene</span>],
        ["Response (90%)", mmss(k.response90), <span style={{ color: C.soft }}>9 in 10 calls faster</span>],
        ["Structure fires", int(k.structureFires), null],
        ["Unit responses", int(k.unitResponses), null],
        ["Aid given", int(k.aidGiven), <span style={{ color: C.soft }}>calls in other agencies</span>]]} />);
      case "volume": return t(`Calls over time (${grainWord(d.series.grain)}, against the same dates last year)`,
        <TimeChart points={d.series.points.map((p, i) => ({ label: pointLabel(p, d.series.grain), tip: pointTip(p, d.series.grain), v: p.n, ly: d.seriesLy.points[i]?.n ?? null, partial: p.partial }))} fixedWidth={fw} height={200} />);
      case "types": return t("Calls by type", <DataTable sortable={false} compact rows={chg(d.types)} columns={[{ key: "type", label: "Type" }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int },
        { key: "share", label: "Share", align: "right", fmt: pctTxt }, { key: "ly", label: "Last year", align: "right", fmt: int }, chgCol]} />);
      case "natures": return t("Top call natures", <DataTable sortable={false} compact rows={chg(d.natures)} columns={[{ key: "nature", label: "Nature", wrap: true }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int },
        { key: "share", label: "Share", align: "right", fmt: pctTxt }, { key: "ly", label: "Last year", align: "right", fmt: int }, chgCol]} />);
      case "response": return t("Response times (calls with a unit on scene)", <>
        <DataTable sortable={false} compact rows={d.response} columns={[{ key: "type", label: "Calls" }, { key: "n", label: "Measured", align: "right", fmt: int },
          { key: "total50", label: "Received → on scene (median)", align: "right", fmt: mmss }, { key: "total90", label: "90%", align: "right", fmt: mmss },
          { key: "travel50", label: "Dispatched → on scene (median)", align: "right", fmt: mmss }, { key: "travel90", label: "90%", align: "right", fmt: mmss }]} />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Times are minutes:seconds from CAD. "90%" = nine in ten calls were faster.</div></>);
      case "hours": return t("Calls by hour of day (average per day)", <BarChart items={d.hours.map(x => ({ label: String(x.hour).padStart(2, "0"), v: x.avg }))} fmt={dec} fixedWidth={fw} height={170} />);
      case "dow": return t("Calls by day of week (average per day)", <BarChart items={d.dow.map(x => ({ label: DOW[x.dow], v: x.avg }))} fmt={dec} fixedWidth={fw} height={170} />);
      case "units": return t("Apparatus responses", <DataTable sortable={false} compact rows={d.units.map(u => ({ ...u, _key: u.unit }))} columns={[{ key: "unit", label: "Unit" },
        { key: "calls", label: "Calls", align: "right", bar: true, fmt: int }, { key: "arrived", label: "On scene", align: "right", fmt: int },
        { key: "hours", label: "Hours committed", align: "right", fmt: dec }, { key: "aid", label: "Aid calls", align: "right", fmt: int }]} />);
      case "aid": return t("Aid given to other agencies", d.aid.length ? <DataTable sortable={false} compact rows={d.aid} columns={[{ key: "agency", label: "Agency" }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int }]} />
        : <div style={{ fontSize: 12.5, color: C.soft }}>None in this period (or no unit data from CAD).</div>);
      case "fires": return t(`Structure fires (${d.structure.length})`, d.structure.length ? <DataTable sortable={false} compact rows={d.structure.map(f => ({ ...f, _key: f.number + f.received }))} columns={[
        { key: "received", label: "Date / time", fmt: v => `${longDay(v.slice(0, 10))} ${v.slice(11, 16)}` }, { key: "number", label: "Call #" }, { key: "nature", label: "Nature", wrap: true },
        { key: "firstOnScene", label: "First unit on scene", align: "right", fmt: mmss }]} /> : <div style={{ fontSize: 12.5, color: C.soft }}>No structure fires in this period.</div>);
      case "prevention": return t("Fire prevention inspections", d.prevention ? <Tiles items={[
        ["Inspections", int(d.prevention.inspections), <span style={{ color: C.soft }}>in this period</span>],
        ["Properties", int(d.prevention.properties), <span style={{ color: C.soft }}>inspected in this period</span>],
        ...(d.prevention.coverage ? [[`${d.prevention.year} coverage`, pctTxt(d.prevention.coverage.pct), <span style={{ color: C.soft }}>{int(d.prevention.coverage.inspected)} of {int(d.prevention.coverage.total)} properties</span>]] : [])]} />
        : <div style={{ fontSize: 12.5, color: C.soft }}>No inspection data in {PN}.</div>);
      case "training": return t("Training hours", d.training ? <>
        <Tiles items={[["Hours", dec(d.training.hours), null], ["People trained", int(d.training.people), null], ["Hours per person", dec(d.training.perPerson), null], ["Verified drills", int(d.training.drills), null]]} />
        {d.training.top.length > 0 && <div style={{ marginTop: 8 }}><DataTable sortable={false} compact rows={d.training.top.map(x => ({ ...x, _key: x.category }))} columns={[{ key: "category", label: "Subject" }, { key: "hours", label: "Hours", align: "right", bar: true, fmt: dec }]} /></div>}</>
        : <div style={{ fontSize: 12.5, color: C.soft }}>No training records in {PN}.</div>);
      case "staffing": return t("Sick leave (department totals)", d.staffing ? <Tiles items={[["Shifts called out", int(d.staffing.sickShifts), null], ["Sick hours", dec(d.staffing.sickHours), null],
        ["Protected leave hours", dec(d.staffing.protectedHours), <span style={{ color: C.soft }}>FMLA, injury, accommodation</span>], ["People", int(d.staffing.people), null]]} />
        : <div style={{ fontSize: 12.5, color: C.soft }}>No sick leave data.</div>);
      case "pial": return t("PIAL / ISO rating", d.pial ? <Tiles items={[["Projected class", d.pial.cls ?? "–", <span style={{ color: C.soft }}>{d.pial.year ? `${d.pial.year} grading year` : ""}</span>],
        ["Projected score", dec(d.pial.score), d.pial.baseline !== null ? <span style={{ color: C.soft }}>last grading {dec(d.pial.baseline)}{d.pial.baselineCls ? ` (Class ${d.pial.baselineCls})` : ""}</span> : null]]} />
        : <div style={{ fontSize: 12.5, color: C.soft }}>PIAL tracker not set up.</div>);
      default: return null;
    }
  };
  return (
    <div className={print ? "sgfd-print-paper" : "sgfd-paper"} style={{ background: "#fff", color: C.ink, padding: print ? 0 : "28px 32px", boxShadow: print ? "none" : "0 2px 14px rgba(19,35,63,0.14)", borderRadius: print ? 0 : 4, maxWidth: print ? "none" : 816, margin: "0 auto", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", borderBottom: `3px solid ${C.brick}`, paddingBottom: 10 }}>
        <img src="/logo-large.png" alt={BRAND.org} style={{ width: 62, height: 62 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: C.soft }}>{BRAND.org.toUpperCase()} · REPORT TO THE {BRAND.fire ? "FIRE BOARD" : "BOARD"}</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 25, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>{r.title || "Untitled report"}</div>
          {r.preparedBy && <div style={{ fontSize: 12, color: C.soft }}>Prepared by {r.preparedBy}</div>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", background: "#F7F3E8", border: `1px solid #E6DDC4`, borderTop: "none", fontSize: 12 }}>
        {[["Report type", r.reportType || "Report"], ["Period", `${longDay(w.from)} – ${longDay(w.to)}`], ["Compared with", d ? `${longDay(d.lyFrom)} – ${longDay(d.lyTo)}` : "–"], ["Generated", generated]].map(([l, v]) => (
          <div key={l} style={{ padding: "7px 10px", borderRight: "1px solid #E6DDC4" }}><div style={{ fontSize: 10, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>{l}</div><b>{v}</b></div>))}
      </div>
      {r.notes && <p style={{ fontSize: 13, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>{r.notes}</p>}
      {data.loading ? <div style={{ padding: 20, color: C.soft }}>Loading the numbers…</div> : data.error ? <div role="alert" style={{ padding: 20, color: C.bad }}>{data.error}</div> : r.blocks.map(block)}
      <div style={{ marginTop: 18, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.muted }}>
        Sources: CAD calls for {d?.agency || "our agency"} with units dispatched, unit responses from CAD, FireWorks training and inspection records, {PN} Sick Leave and PIAL tracker.
        {d?.lastDay && d.lastDay < w.to ? ` CAD data loaded through ${longDay(d.lastDay)}.` : ""} {BRAND.app}.</div>
    </div>
  );
}
const PRINT_CSS = `
.sgfd-print-portal { display: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #13233F; }
.sgfd-paper, .sgfd-print-portal { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  #root { display: none !important; }
  .sgfd-print-portal { display: block !important; }
  html, body { background: #fff !important; padding: 0 !important; }
  .sgfd-print-portal * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sgfd-block { break-inside: avoid; page-break-inside: avoid; }
  @page { size: letter; margin: 12mm; }
}`;

function Builder({ start, meta, onClose, onSaved, toast }) {
  const [r, setR] = useState(start);
  const [add, setAdd] = useState("kpis");
  const w = reportWindow(r, meta.today);
  const [data, setData] = useState({ loading: true });
  useEffect(() => {
    let live = true; setData(x => ({ ...x, loading: true, error: "" }));
    api(`/data?from=${w.from}&to=${w.to}`).then(d => live && setData({ loading: false, d }), e => live && setData({ loading: false, error: e.message }));
    return () => { live = false; };
  }, [w.from, w.to]);
  const move = (i, dd) => setR(x => { const b = [...x.blocks]; const j = i + dd; if (j < 0 || j >= b.length) return x; [b[i], b[j]] = [b[j], b[i]]; return { ...x, blocks: b }; });
  const setB = (i, ch) => setR(x => ({ ...x, blocks: x.blocks.map((b, k) => (k === i ? { ...b, ...ch } : b)) }));
  async function save(copy) {
    try {
      const res = await api("/reports", { ...r, id: copy ? undefined : r.id, title: copy ? `${r.title} (copy)` : r.title });
      setR(x => ({ ...x, id: res.id, mine: true, title: copy ? `${x.title} (copy)` : x.title })); onSaved(res.reports); toast(copy ? "Saved a copy" : "Report saved");
    } catch (e) { toast(e.message); }
  }
  async function remove() {
    if (!window.confirm(`Delete "${r.title}"?`)) return;
    try { const res = await api(`/reports/${r.id}/remove`, {}); onSaved(res.reports); toast("Report deleted"); onClose(); } catch (e) { toast(e.message); }
  }
  const label = { display: "block", fontSize: 12, fontWeight: 700, color: C.soft, marginBottom: 10 };
  const small = { ...btn("ghost"), padding: "2px 6px", fontSize: 12 };
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <button type="button" style={btn("ghost")} onClick={onClose}><ArrowLeft size={14} /> All reports</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btn("primary")} onClick={() => window.print()} disabled={data.loading}><Printer size={14} /> Print / save as PDF</button>
          <button type="button" style={btn("outline")} onClick={() => save(false)}><Save size={14} /> {r.id && r.mine !== false ? "Save" : "Save as my report"}</button>
          {r.id && <button type="button" style={btn("outline")} onClick={() => save(true)}><Copy size={14} /> Save a copy</button>}
          {r.id && r.mine !== false && <button type="button" style={{ ...btn("ghost"), color: C.bad }} onClick={remove}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ ...cardStyle, margin: 0 }} aria-label="Report settings">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Report settings</div>
          <label style={label}>Title<input aria-label="Report title" style={inputStyle} value={r.title} onChange={e => setR(x => ({ ...x, title: e.target.value }))} /></label>
          <label style={label}>Report type<input aria-label="Report type" style={inputStyle} value={r.reportType} onChange={e => setR(x => ({ ...x, reportType: e.target.value }))} placeholder="e.g. Board meeting" /></label>
          <label style={label}>Prepared by<input aria-label="Prepared by" style={inputStyle} value={r.preparedBy} onChange={e => setR(x => ({ ...x, preparedBy: e.target.value }))} placeholder="e.g. Fire Chief" /></label>
          <label style={label}>Period
            <select aria-label="Report period" style={inputStyle} value={r.windowKind} onChange={e => setR(x => ({ ...x, windowKind: e.target.value, from: x.from || w.from, to: x.to || w.to }))}>
              {WINDOWS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {r.windowKind === "custom" && <div style={{ display: "flex", gap: 6 }}>
            <input aria-label="Report from" type="date" style={inputStyle} value={r.from || w.from} onChange={e => setR(x => ({ ...x, from: e.target.value }))} />
            <input aria-label="Report to" type="date" style={inputStyle} value={r.to || w.to} onChange={e => setR(x => ({ ...x, to: e.target.value }))} /></div>}
          <div style={{ fontSize: 12, color: C.soft, margin: "-4px 0 10px" }}>{r.windowKind === "custom" ? "Always these dates." : `Moves with the calendar: now ${longDay(w.from)} – ${longDay(w.to)}.`}</div>
          <label style={label}>Notes printed under the title<textarea aria-label="Report notes" style={{ ...inputStyle, minHeight: 64 }} value={r.notes} onChange={e => setR(x => ({ ...x, notes: e.target.value }))} /></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={!!r.shared} onChange={e => setR(x => ({ ...x, shared: e.target.checked }))} /> Share as a template with everyone who can use board reports</label>
        </section>
        <section style={{ ...cardStyle, margin: 0 }} aria-label="Report contents">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Report contents</div>
          {r.blocks.map((b, i) => (
            <div key={b.id} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 12, color: C.muted, width: 18 }}>{i + 1}</span>
                <b style={{ fontSize: 13, flex: 1 }}>{BLOCK_TYPES.find(t => t[0] === b.type)?.[1]}</b>
                <button type="button" style={small} aria-label={`Move ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp size={14} /></button>
                <button type="button" style={small} aria-label={`Move ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === r.blocks.length - 1}><ChevronDown size={14} /></button>
                <button type="button" style={{ ...small, color: C.bad }} aria-label={`Remove ${i + 1}`} onClick={() => setR(x => ({ ...x, blocks: x.blocks.filter((_, k) => k !== i) }))}><Trash2 size={13} /></button>
              </div>
              {b.type === "heading" && <input aria-label={`Heading ${i + 1}`} style={{ ...inputStyle, marginTop: 5, padding: "5px 8px" }} value={b.title} onChange={e => setB(i, { title: e.target.value })} placeholder="Section heading" />}
              {b.type === "text" && <textarea aria-label={`Text ${i + 1}`} style={{ ...inputStyle, marginTop: 5, minHeight: 60 }} value={b.text} onChange={e => setB(i, { text: e.target.value })} placeholder="Commentary for the Board…" />}
              {b.type !== "heading" && b.type !== "text" && <details style={{ marginTop: 4 }}><summary style={{ fontSize: 12, color: C.soft, cursor: "pointer" }}>Title and comment</summary>
                <input aria-label={`Title ${i + 1}`} style={{ ...inputStyle, marginTop: 5, padding: "5px 8px" }} value={b.title} onChange={e => setB(i, { title: e.target.value })} placeholder="Use the standard title" />
                <textarea aria-label={`Comment ${i + 1}`} style={{ ...inputStyle, marginTop: 5, minHeight: 48 }} value={b.text} onChange={e => setB(i, { text: e.target.value })} placeholder="Comment printed under this section (optional)" /></details>}
            </div>))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select aria-label="Section to add" style={{ ...inputStyle, margin: 0 }} value={add} onChange={e => setAdd(e.target.value)}>{BLOCK_TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button type="button" style={btn("outline")} onClick={() => setR(x => ({ ...x, blocks: [...x.blocks, blk(add, add === "heading" ? "New section" : "")] }))}><Plus size={14} /> Add</button>
          </div>
        </section>
      </div>
      <div style={{ marginTop: 16, overflowX: "auto" }}><Paper r={r} w={w} data={data} /></div>
      {typeof document !== "undefined" && createPortal(<div className="sgfd-print-portal"><Paper r={r} w={w} data={data} print /></div>, document.body)}
    </>
  );
}

function Reports({ meta, toast }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api("/reports").then(x => setList(x.reports), e => toast(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return <Builder key={open.id || open.key} start={open} meta={meta} onClose={() => setOpen(null)} onSaved={setList} toast={toast} />;
  const fresh = t => ({ id: null, title: t.title, reportType: t.reportType, preparedBy: "", notes: "", windowKind: t.windowKind, from: null, to: null, blocks: t.blocks.map(b => ({ ...b, id: newId() })), shared: false, key: t.key + Date.now() });
  const win = r => { const w = reportWindow(r, meta.today); return `${(WINDOWS.find(x => x[0] === r.windowKind) || WINDOWS[0])[1].toLowerCase()} (${longDay(w.from)} – ${longDay(w.to)})`; };
  const row = (r, act) => <div key={r.id || r.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.grid}`, flexWrap: "wrap" }}>
    <FileText size={18} color={C.series} aria-hidden="true" />
    <div style={{ flex: "1 1 240px" }}><b>{r.title}</b><div style={{ fontSize: 12.5, color: C.soft }}>{act}</div></div>
    <button type="button" style={btn("primary")} aria-label={`Open ${r.title}`} onClick={() => setOpen(r.id ? r : fresh(r))}>Open</button></div>;
  const mine = (list || []).filter(r => r.mine), shared = (list || []).filter(r => !r.mine);
  return <>
    {!meta.agency && <div style={{ ...cardStyle, color: C.warn }}>No CAD calls for {BRAND.place} are loaded yet, so call numbers will be empty. {meta.manage ? "Pick the agency in Settings, or check Comms Statistics > Data & settings." : ""}</div>}
    <section style={cardStyle} aria-label="Start a report">
      <div style={{ fontSize: 16, fontWeight: 800 }}>Start a report</div>
      <div style={{ fontSize: 12.5, color: C.soft, margin: "2px 0 8px" }}>Pick a starting point, change the period and what's in it, add your comments, then print or save as PDF. The numbers re-run every time it's opened.</div>
      {templates().map(t => row(t, `${t.blocks.length} sections · ${win(t)}`))}
    </section>
    <section style={cardStyle} aria-label="My reports">
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>My reports</div>
      {!list ? <div style={{ color: C.soft }}>Loading…</div> : mine.length ? mine.map(r => row(r, `${r.blocks.length} sections · ${win(r)}${r.shared ? " · shared" : ""}`))
        : <div style={{ fontSize: 13, color: C.soft }}>Nothing saved yet. Open a starting point above and press Save.</div>}
    </section>
    {shared.length > 0 && <section style={cardStyle} aria-label="Shared reports"><div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Shared reports</div>
      {shared.map(r => row(r, `by ${r.owner} · ${r.blocks.length} sections · ${win(r)}`))}</section>}
  </>;
}

function SettingsPage({ meta, toast, reload }) {
  const [agency, setAgency] = useState(meta.settings.agency);
  const [cats, setCats] = useState(meta.settings.categories);
  const save = async (c = cats) => { try { await api("/settings", { agency, categories: c }); toast("Saved."); reload(); } catch (e) { toast(e.message); } };
  return <section style={cardStyle} aria-label="Board report settings">
    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.soft, marginBottom: 10 }}>CAD agency for "our" calls
      <select aria-label="CAD agency" style={inputStyle} value={agency} onChange={e => setAgency(e.target.value)}>
        <option value="">Automatic{meta.agencyAuto && meta.agency ? ` (${meta.agency})` : ""}</option>
        {meta.agencies.map(a => <option key={a.agency} value={a.agency}>{a.agency} ({int(a.n)} calls)</option>)}</select></label>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.soft, margin: "8px 0 4px" }}>Call types (the first one whose words match the CAD nature wins; words separated by |)</div>
    {cats.map((c, i) => (
      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input aria-label={`Type ${i + 1} name`} style={{ ...inputStyle, flex: "0 0 180px" }} value={c.name} onChange={e => setCats(x => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} />
        <input aria-label={`Type ${i + 1} words`} style={inputStyle} value={c.pattern} onChange={e => setCats(x => x.map((y, k) => (k === i ? { ...y, pattern: e.target.value } : y)))} />
        <button type="button" aria-label={`Remove type ${i + 1}`} style={{ ...btn("ghost"), color: C.bad }} onClick={() => setCats(x => x.filter((_, k) => k !== i))}><Trash2 size={13} /></button>
      </div>))}
    <div style={{ fontSize: 12, color: C.soft, marginBottom: 10 }}>Anything that matches none of these is counted as "Other".</div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" style={btn("outline")} onClick={() => setCats(x => [...x, { name: "", pattern: "" }])}><Plus size={14} /> Add a type</button>
      <button type="button" style={btn("ghost")} onClick={() => { setCats(meta.defaults); }}>Back to the standard types</button>
      <button type="button" style={btn("primary")} onClick={() => save()}>Save settings</button>
    </div>
  </section>;
}

export default function BoardReportModule({ onBack }) {
  const [page, setPage] = useState("reports");
  const [meta, setMeta] = useState(null), [error, setError] = useState(""), [msg, setMsg] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 2600); };
  const load = () => api("/meta").then(setMeta, e => setError(e.message));
  useEffect(() => { load(); }, []);
  const nav = [{ key: "reports", label: "Reports", icon: FileText }, ...(meta?.manage ? [{ key: "settings", label: "Settings", icon: SlidersHorizontal, group: "Admin" }] : [])];
  return (
    <AppShell section="Board Report" nav={nav} active={page} onNav={setPage} onHome={onBack}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, marginBottom: 2 }}>{page === "settings" ? "Board report settings" : "Board report"}</div>
        <div style={{ fontSize: 13, color: C.soft, marginBottom: 14 }}>{page === "settings" ? "Which CAD agency is ours and how calls are grouped into types." : "Operational reports for Fire Board meetings: calls, response times, apparatus, fires, training and prevention for any period."}</div>
        {error ? <div style={{ ...cardStyle, color: C.bad }}>{error}</div> : !meta ? <div style={cardStyle}>Loading…</div>
          : page === "settings" ? <SettingsPage meta={meta} toast={toast} reload={load} /> : <Reports meta={meta} toast={toast} />}
      </div>
      {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 50 }}>{msg}</div>}
    </AppShell>
  );
}
