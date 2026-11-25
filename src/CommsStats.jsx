// Communications Statistics (server/cadstats.js): closed CAD incidents for every agency SGFD
// Communications handles. Pages: Overview, Volume & Trends, Call-taking, Call takers & dispatchers
// (stats "edit"), Reports (builder + print/PDF), Data & settings (stats "manage").
import React, { useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand.js";
import { createPortal } from "react-dom";
import { Upload, LayoutDashboard, TrendingUp, Timer, Users, FileText, SlidersHorizontal, Printer, Download, RefreshCw, AlertTriangle,
  CheckCircle2, Info, Plus, Trash2, ChevronUp, ChevronDown, Save, Copy, Phone, Clock, Activity, ArrowLeft, Truck } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { C, TimeChart, BarChart, Heatmap, Histogram, DataTable, downloadCsv, Delta, mmss, int, dec, pctTxt, change, shortDay, longDay, DOW, hh } from "./StatCharts.jsx";
import { PN } from "./brand.js";

async function api(path, body) {
  const r = await fetch(`/api/stats${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const qs = f => `from=${f.from}&to=${f.to}&agency=${encodeURIComponent(f.agency || "")}&calls=${f.calls}`;

// ---- dates (calendar days as YYYY-MM-DD) --------------------------------------------------------
const D = s => new Date(s + "T00:00:00Z");
const S = d => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const daysIn = (a, b) => Math.round((D(b) - D(a)) / 86400000) + 1;
export const PRESETS = [["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"], ["thisMonth", "This month"], ["lastMonth", "Last month"],
  ["ytd", "Year to date"], ["lastYear", "Last year"], ["custom", "Custom range"]];
export function presetRange(key, last) {
  const y = +last.slice(0, 4), m = +last.slice(5, 7);
  switch (key) {
    case "last7": return { from: plus(last, -6), to: last };
    case "last90": return { from: plus(last, -89), to: last };
    case "thisMonth": return { from: `${last.slice(0, 7)}-01`, to: last };
    case "lastMonth": { const first = S(new Date(Date.UTC(y, m - 2, 1))); return { from: first, to: plus(`${last.slice(0, 7)}-01`, -1) }; }
    case "ytd": return { from: `${y}-01-01`, to: last };
    case "lastYear": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: plus(last, -29), to: last };
  }
}
const pointLabel = (p, grain) => grain === "day" ? shortDay(p.key) : grain === "week" ? shortDay(p.start) : D(p.key).toLocaleDateString([], { month: "short", year: "2-digit", timeZone: "UTC" });
const pointTip = (p, grain) => grain === "day" ? D(p.key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  : grain === "week" ? `Week of ${longDay(p.start)}` : D(p.key).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
const grainWord = g => (g === "day" ? "daily" : g === "week" ? "weekly (Monday to Sunday)" : "monthly");
function seriesPoints(s, ly, key = "n") {
  return s.points.map((p, i) => ({ label: pointLabel(p, s.grain), tip: pointTip(p, s.grain), v: p[key], ly: ly ? ly.points[i]?.[key] ?? null : null, partial: p.partial }));
}

// ---- small pieces ----------------------------------------------------------------------------------
const H2 = ({ children, sub }) => <div style={{ margin: "4px 0 10px" }}><div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{children}</div>{sub && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 2 }}>{sub}</div>}</div>;
function Tile({ icon: Icon, label, value, sub, tone }) {
  return (
    <div style={{ ...cardStyle, padding: "14px 16px", margin: 0, minWidth: 0 }} role="group" aria-label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.soft, fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}>
        {Icon && <Icon size={15} color={tone || C.series} aria-hidden="true" />}{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: C.ink, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: C.soft }}>{sub}</div>
    </div>
  );
}
const tiles = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 };
const grid2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 14, alignItems: "start" };

// A chart with a Chart / Table switch and a CSV download
function Card({ title, sub, note, table, csvName, children, style }) {
  const [view, setView] = useState("chart");
  const seg = on => ({ border: "none", background: on ? "#fff" : "transparent", boxShadow: on ? "0 1px 3px rgba(19,35,63,0.14)" : "none", borderRadius: 6, padding: "4px 10px", fontSize: 12.5, fontWeight: 600, color: C.ink, cursor: "pointer" });
  return (
    <section style={{ ...cardStyle, margin: 0, minWidth: 0, ...style }} aria-label={title}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <div style={{ fontSize: 15.5, fontWeight: 800, color: C.ink }}>{title}</div>
          {sub && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 2 }}>{sub}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }} className="no-print">
          {table && children && <div role="group" aria-label={`${title} view`} style={{ display: "flex", background: "#EEF1F5", borderRadius: 8, padding: 2 }}>
            <button type="button" aria-pressed={view === "chart"} style={seg(view === "chart")} onClick={() => setView("chart")}>Chart</button>
            <button type="button" aria-pressed={view === "table"} style={seg(view === "table")} onClick={() => setView("table")}>Table</button></div>}
          {table && <button type="button" style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} aria-label={`Download ${title} as CSV`}
            onClick={() => downloadCsv(csvName || title, table.columns, table.rows)}><Download size={13} /> CSV</button>}
        </div>
      </div>
      {note && <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 8 }}>{note}</div>}
      {view === "table" || !children ? <DataTable columns={table.columns} rows={table.rows} maxHeight={children ? 340 : 420} label={title} /> : children}
    </section>
  );
}

function useData(path, deps) {
  const [state, setState] = useState({ data: null, error: "", loading: true, path: null });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setState(s => ({ ...s, loading: true, error: "" }));
    api(path).then(d => live && setState({ data: d, error: "", loading: false, path }), e => live && setState({ data: null, error: e.message, loading: false, path }));
    return () => { live = false; };
  }, deps);    // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
const Loading = ({ error }) => <div style={{ ...cardStyle, color: error ? C.bad : C.soft }} role={error ? "alert" : "status"}>{error || "Loading…"}</div>;

// ---- Filters ---------------------------------------------------------------------------------------
function FilterBar({ meta, applied, onApply }) {
  const [d, setD] = useState(applied);
  useEffect(() => setD(applied), [applied]);
  const setPreset = p => setD(x => (p === "custom" ? { ...x, preset: p } : { ...x, preset: p, ...presetRange(p, meta.lastDay) }));
  const label = { fontSize: 11.5, fontWeight: 700, color: C.soft, display: "flex", flexDirection: "column", gap: 3 };
  const inp = { ...inputStyle, margin: 0, padding: "7px 9px", minWidth: 0 };
  const changed = JSON.stringify(d) !== JSON.stringify(applied);
  return (
    <div style={{ ...cardStyle, margin: "0 0 6px", padding: "12px 14px" }} className="no-print" role="search" aria-label="Statistics filters">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={label}>Period
          <select aria-label="Period" style={inp} value={d.preset} onChange={e => setPreset(e.target.value)}>{PRESETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label style={label}>From<input aria-label="From" type="date" style={inp} value={d.from} max={d.to} onChange={e => setD(x => ({ ...x, preset: "custom", from: e.target.value }))} /></label>
        <label style={label}>To<input aria-label="To" type="date" style={inp} value={d.to} min={d.from} onChange={e => setD(x => ({ ...x, preset: "custom", to: e.target.value }))} /></label>
        <label style={label}>Agency
          <select aria-label="Agency" style={inp} value={d.agency} onChange={e => setD(x => ({ ...x, agency: e.target.value }))}>
            <option value="">All agencies</option>{meta.agencies.map(a => <option key={a.agency} value={a.agency}>{a.agency || "(none)"}</option>)}</select></label>
        <label style={label}>Calls
          <select aria-label="Calls" style={inp} value={d.calls} onChange={e => setD(x => ({ ...x, calls: e.target.value }))}>
            <option value="dispatched">Dispatched only</option><option value="all">All calls</option></select></label>
        <button type="button" style={{ ...btn(changed ? "primary" : "outline"), marginLeft: "auto" }} disabled={!d.from || !d.to} onClick={() => onApply(d)}>Apply</button>
      </div>
    </div>
  );
}
function Caption({ f, meta }) {
  return <div style={{ fontSize: 12.5, color: C.soft, margin: "0 2px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
    <b style={{ color: C.ink }}>{longDay(f.from)} – {longDay(f.to)}</b><span>· {daysIn(f.from, f.to)} days</span>
    <span>· {f.agency || "all agencies"}</span><span>· {f.calls === "all" ? "all calls" : "dispatched calls only"}</span>
    {meta.lastDay && f.to > meta.lastDay && <span style={{ color: C.warn }}>· CAD data only goes through {longDay(meta.lastDay)}</span>}
  </div>;
}
function Freshness({ meta }) {
  const age = meta.lastGoodSync ? (Date.now() - new Date(meta.lastGoodSync).getTime()) / 3600000 : null;
  const bad = meta.lastSync?.error, stale = age === null || age > 36;
  const tone = bad ? C.bad : stale ? C.warn : C.good, Icon = bad || stale ? AlertTriangle : CheckCircle2;
  const text = !meta.total ? "No CAD data loaded yet" : `CAD data through ${longDay(meta.lastDay)}`;
  if (!meta.configured) return <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: C.ink, background: "#fff",
    border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}><Upload size={14} color={C.series} aria-hidden="true" />{meta.total ? `${text} · from uploaded reports` : "No data yet: upload a CAD or FireWorks report"}</span>;
  const when = meta.lastGoodSync ? new Date(meta.lastGoodSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never";
  return <span role="status" title={bad || ""} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: C.ink, background: "#fff",
    border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>
    <Icon size={14} color={tone} aria-hidden="true" />{text} · {meta.running ? "syncing now" : `last sync ${when}`}{bad ? " · last sync failed" : stale && meta.total ? " · sync overdue" : ""}</span>;
}

// ---- Overview --------------------------------------------------------------------------------------
const holdTiles = (k, goal) => [
  { icon: Clock, label: "Average hold", value: mmss(k.avgHold.value), sub: <Delta now={k.avgHold.value} then={k.avgHold.ly} better="down" fmtAbs={mmss} />, tone: C.series },
  { icon: Timer, label: "9 in 10 calls held under", value: mmss(k.p90Hold.value), sub: <Delta now={k.p90Hold.value} then={k.p90Hold.ly} better="down" fmtAbs={mmss} />, tone: C.series },
  { icon: CheckCircle2, label: `Calls with a unit assigned within ${mmss(goal)}`, value: pctTxt(k.withinGoal.value), sub: <Delta now={k.withinGoal.value} then={k.withinGoal.ly} better="up" fmtAbs={v => `${dec(v)} pts`} />, tone: C.good },
];
function KpiTiles({ d, goal }) {
  const k = d.kpis;
  return <div style={tiles}>
    <Tile icon={Phone} label="Incidents" value={int(k.incidents.value)} sub={<Delta now={k.incidents.value} then={k.incidents.ly} />} />
    <Tile icon={Activity} label="Daily average" value={dec(k.dailyAvg.value)} sub={<Delta now={k.dailyAvg.value} then={k.dailyAvg.ly} />} />
    {holdTiles(k, goal).map(t => <Tile key={t.label} {...t} />)}
  </div>;
}
function Observations({ list }) {
  if (!list.length) return null;
  const icon = k => (k === "up" ? TrendingUp : k === "down" ? TrendingUp : k === "hold" ? Clock : k === "goal" ? CheckCircle2 : Info);
  return <div style={{ ...tiles, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>{list.map((o, i) => { const I = icon(o.kind); return (
    <div key={i} style={{ ...cardStyle, margin: 0, padding: "12px 14px", display: "flex", gap: 10 }}>
      <I size={18} color={C.series} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2, transform: o.kind === "down" ? "scaleY(-1)" : undefined }} />
      <div><div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{o.title}</div><div style={{ fontSize: 12.5, color: C.soft, marginTop: 2 }}>{o.detail}</div></div>
    </div>); })}</div>;
}
const natureCols = [
  { key: "nature", label: "Problem nature", fmt: v => v || "(blank)" }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int },
  { key: "share", label: "Share", align: "right", fmt: pctTxt }, { key: "ly", label: "Last year", align: "right", fmt: int },
  { key: "chg", label: "Change", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "+" : ""}${dec(v)}%`) },
];
const withChg = rows => rows.map(r => ({ ...r, chg: change(r.n, r.ly) }));
const agencyCols = [{ key: "agency", label: "Agency" }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int }, { key: "ly", label: "Same dates last year", align: "right", fmt: int },
  { key: "chg", label: "Change", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "+" : ""}${dec(v)}%`) }];
function HoldDistribution({ d, fixedWidth }) {
  const h = d.hold;
  return <>
    <Histogram bins={d.histogram} marks={[{ label: "Typical", value: h.p50 }, { label: "9 in 10", value: h.p90 }, { label: "19 in 20", value: h.p95 }, { label: "99 in 100", value: h.p99 }]} fixedWidth={fixedWidth} />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
      {[["Typical (P50)", h.p50, "half of calls waited less"], ["9 in 10 under (P90)", h.p90, "only 1 in 10 waited longer"], ["19 in 20 under (P95)", h.p95, "only 1 in 20 waited longer"], ["99 in 100 under (P99)", h.p99, "only the worst 1 in 100 waited longer"]].map(([l, v, t]) => (
        <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.soft }}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: C.ink }}>{mmss(v)}</div>
          <div style={{ fontSize: 11, color: C.soft }}>{t}</div></div>))}
    </div>
  </>;
}
const histTable = d => ({ columns: [{ key: "range", label: "Hold" }, { key: "n", label: "Calls", align: "right", bar: true, fmt: int }],
  rows: d.histogram.map(b => ({ range: b.to === null ? `${mmss(b.from)} and longer` : `${mmss(b.from)} – ${mmss(b.to)}`, n: b.n })) });
const heatTable = (cells, what = "Avg hold") => ({ columns: [{ key: "day", label: "Day" }, { key: "hour", label: "Hour" }, { key: "v", label: what, align: "right", fmt: mmss, csv: v => v },
  { key: "n", label: "Calls", align: "right", fmt: int }],
  rows: [...cells].sort((a, b) => a.dow - b.dow || a.hour - b.hour).map(c => ({ day: DOW[c.dow], hour: hh(c.hour), v: c.hold, n: c.n })) });
function Quality({ q }) {
  const rows = [
    ["Nature named (not blank or a placeholder like \".Fire Default\")", q.natureNamed, q.n], ["Hold measurable (dispatched calls)", q.holdMeasured, q.holdable],
    ["Call taker recorded (or self-initiated)", q.callTaker, q.n],
  ];
  return <section style={{ ...cardStyle, margin: 0 }} aria-label="Data quality">
    <H2 sub="What was actually counted in this window. Low numbers here mean the figures above should be read with care.">Data quality</H2>
    {rows.map(([l, a, b]) => { const p = b ? 100 * a / b : null; const ok = p === null || p >= 95, mid = p !== null && p >= 85;
      const Icon = ok ? CheckCircle2 : AlertTriangle; return (
      <div key={l} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.grid}`, fontSize: 13.5 }}>
        <Icon size={16} color={ok ? C.good : mid ? C.warn : C.bad} aria-hidden="true" />
        <span style={{ flex: 1 }}>{l} <span style={{ color: C.muted, fontSize: 12 }}>{int(a)} / {int(b)}</span></span>
        <b style={{ fontVariantNumeric: "tabular-nums" }}>{p === null ? "–" : `${dec(p)}%`}</b>
        <span style={{ fontSize: 11.5, color: C.soft, width: 52 }}>{p === null ? "" : ok ? "good" : mid ? "fair" : "check"}</span>
      </div>); })}
  </section>;
}
function Overview({ d, meta }) {
  const goal = meta.settings.holdGoalSeconds;
  const pts = seriesPoints(d.series, d.seriesLy);
  return <>
    <KpiTiles d={d} goal={goal} />
    <Observations list={d.observations} />
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Incidents over time" sub={`${grainWord(d.series.grain)}, against the same dates last year`} csvName="Incidents over time"
        table={{ columns: [{ key: "tip", label: "Period" }, { key: "v", label: "Incidents", align: "right", fmt: int }, { key: "ly", label: "Last year", align: "right", fmt: int }], rows: pts }}>
        <TimeChart points={pts} name="This period" /></Card>
      <Card title="Calls by agency" sub="Every agency in the window, against the same dates last year" table={{ columns: agencyCols, rows: withChg(d.agencies) }} />
    </div>
    <div style={{ marginBottom: 14 }}>
      <Card title="Top 10 problem natures" sub="Share is of all calls in the window, not of the ten" table={{ columns: natureCols, rows: withChg(d.natures) }} />
    </div>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Average hold by weekday and hour" sub="Queue to first unit assigned, by when the call came in" table={heatTable(d.heatmap)}><Heatmap cells={d.heatmap.map(c => ({ ...c, v: c.hold, n: c.measured }))} /></Card>
      <Card title="Hold time distribution" sub="Exact percentiles from every measured call, not estimates" table={histTable(d)}><HoldDistribution d={d} /></Card>
    </div>
    <Quality q={d.quality} />
  </>;
}

// ---- Volume & Trends -------------------------------------------------------------------------------
const trendCols = [
  { key: "label", label: "Period" }, { key: "n", label: "Incidents", align: "right", bar: true, fmt: int },
  { key: "prior", label: "Prior period", align: "right", fmt: int }, { key: "vsPrior", label: "vs prior", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "↑ +" : v < 0 ? "↓ " : ""}${dec(v)}%`) },
  { key: "ly", label: "Same period last year", align: "right", fmt: int }, { key: "vsLy", label: "vs last year", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "↑ +" : v < 0 ? "↓ " : ""}${dec(v)}%`) },
  { key: "dispatchedVsLy", label: "Dispatched vs LY", align: "right", fmt: v => (v === null ? "–" : `${v > 0 ? "+" : ""}${dec(v)}%`) },
  { key: "dailyAvg", label: "Daily avg", align: "right", fmt: dec },
  { key: "selfPct", label: "Self-initiated", align: "right", fmt: (v, r) => `${pctTxt(v)} (was ${pctTxt(r.selfPctLy)})`, csv: v => v },
];
function Volume({ d, meta }) {
  const pts = seriesPoints(d.series, d.seriesLy);
  const holdPts = seriesPoints(d.series, d.seriesLy, "hold"), tailPts = seriesPoints(d.series, d.seriesLy, "tailPct");
  const tail = meta.settings.tailMinutes;
  return <>
    <div style={tiles}>
      <Tile icon={Phone} label="Total incidents" value={int(d.total)} sub={`${daysIn(d.filters.from, d.filters.to)} days in range`} />
      <Tile icon={Activity} label="Daily average" value={dec(d.total / daysIn(d.filters.from, d.filters.to))} sub="across the range" />
      <Tile icon={TrendingUp} label="Busiest day" value={d.busiest ? int(d.busiest.n) : "–"} sub={d.busiest ? longDay(d.busiest.day) : ""} />
      <Tile icon={TrendingUp} label="Quietest day" value={d.quietest ? int(d.quietest.n) : "–"} sub={d.quietest ? longDay(d.quietest.day) : ""} />
      <Tile icon={Activity} label="Last 7 days" value={d.last7.change === null ? "–" : `${d.last7.change > 0 ? "+" : ""}${dec(d.last7.change)}%`} sub={`${int(d.last7.n)} vs ${int(d.last7.prior)} the 7 before`} />
    </div>
    <Card title="Incidents over time" sub={`${grainWord(d.series.grain)} · against the same dates last year`} style={{ marginBottom: 14 }}
      table={{ columns: [{ key: "tip", label: "Period" }, { key: "v", label: "Incidents", align: "right", fmt: int }, { key: "ly", label: "Last year", align: "right", fmt: int }], rows: pts }}>
      <TimeChart points={pts} height={250} /></Card>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Incidents by day of week" sub="Average per day, so an extra Monday in the range can't tilt it"
        table={{ columns: [{ key: "label", label: "Day" }, { key: "v", label: "Avg per day", align: "right", fmt: dec }, { key: "days", label: "Days in range", align: "right" }], rows: d.dow.map(x => ({ label: DOW[x.dow], v: x.avg, days: x.days })) }}>
        <BarChart items={d.dow.map(x => ({ label: DOW[x.dow], v: x.avg, sub: `average over ${x.days} ${DOW[x.dow]}s` }))} fmt={dec} name="Incidents by day of week" /></Card>
      <Card title="Incidents by hour of day" sub="Average per day, by the hour the call came in"
        table={{ columns: [{ key: "label", label: "Hour" }, { key: "v", label: "Avg per day", align: "right", fmt: dec }, { key: "n", label: "Total", align: "right", fmt: int }], rows: d.hours.map(x => ({ label: hh(x.hour), v: x.avg, n: x.n })) }}>
        <BarChart items={d.hours.map(x => ({ label: String(x.hour).padStart(2, "0"), tip: `${hh(x.hour)}–${hh((x.hour + 1) % 24)}`, v: x.avg, sub: `${int(x.n)} calls in range` }))} fmt={dec} name="Incidents by hour" /></Card>
    </div>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Average hold" sub="Queue to first unit assigned"
        table={{ columns: [{ key: "tip", label: "Period" }, { key: "v", label: "Avg hold", align: "right", fmt: mmss, csv: v => v }, { key: "ly", label: "Last year", align: "right", fmt: mmss, csv: v => v }], rows: holdPts }}>
        <TimeChart points={holdPts} fmt={mmss} area={false} name="Average hold" /></Card>
      <Card title="The tail" sub={`Share of calls holding over ${tail} minutes. An average can stay flat while the tail doubles.`}
        table={{ columns: [{ key: "tip", label: "Period" }, { key: "v", label: `% over ${tail} min`, align: "right", fmt: pctTxt }, { key: "ly", label: "Last year", align: "right", fmt: pctTxt }], rows: tailPts }}>
        <TimeChart points={tailPts} fmt={v => `${dec(v)}%`} area={false} name={`% over ${tail} min`} /></Card>
    </div>
    <Card title="Trend summary" csvName="Trend summary" table={{ columns: trendCols, rows: d.trend }}
      note={<>Counted back from the last loaded day ({longDay(d.anchor)}), not today, so a sync that hasn't run yet doesn't look like a drop in calls.{" "}
        <b>Read the last-year columns first.</b> "Prior period" compares against the days just before, which crosses seasons (90 days back from summer is spring).</>} />
  </>;
}

// ---- Call-taking -----------------------------------------------------------------------------------
const prioCols = goal => [{ key: "priority", label: "Priority" }, { key: "calls", label: "Calls", align: "right", bar: true, fmt: int },
  { key: "avg", label: "Avg hold", align: "right", fmt: mmss, csv: v => v }, { key: "p90", label: "9 in 10 held under", align: "right", fmt: mmss, csv: v => v },
  { key: "withinPct", label: `Unit assigned within ${mmss(goal)}`, align: "right", fmt: pctTxt }];
const longCols = [{ key: "incident_number", label: "Incident" }, { key: "received", label: "Received" }, { key: "agency", label: "Agency" },
  { key: "nature", label: "Nature" }, { key: "priority", label: "Priority" }, { key: "hold", label: "Hold", align: "right", fmt: mmss, csv: v => v }];
function CallTaking({ d, meta }) {
  const goal = meta.settings.holdGoalSeconds;
  const byHour = d.byHour.map(x => ({ label: String(x.hour).padStart(2, "0"), tip: `${hh(x.hour)}–${hh((x.hour + 1) % 24)}`, v: x.avg, ly: x.p90, n: x.n }));
  const tailPts = seriesPoints(d.series, null, "tailPct");
  return <>
    <div style={tiles}>
      <Tile icon={Clock} label="Average hold" value={mmss(d.hold.avg)} sub={`${int(d.hold.n)} measured calls`} />
      <Tile icon={Timer} label="Typical hold" value={mmss(d.hold.p50)} sub="half of calls waited less (P50)" />
      <Tile icon={Timer} label="9 in 10 calls held under" value={mmss(d.hold.p90)} sub="only 1 in 10 waited longer (P90)" />
      <Tile icon={CheckCircle2} tone={C.good} label={`Unit assigned within ${mmss(goal)}`} value={pctTxt(d.withinGoal.pct)} sub={`${int(d.withinGoal.n)} calls`} />
      <Tile icon={AlertTriangle} tone={C.warn} label={`Over ${d.tail.minutes} min`} value={pctTxt(d.tail.pct)} sub={`${int(d.tail.over)} calls`} />
    </div>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Hold time distribution" sub="Queue to first unit assigned. Percentiles are exact." table={histTable(d)}>
        <HoldDistribution d={d} />
        <details style={{ marginTop: 10, fontSize: 12.5, color: C.soft }}><summary style={{ cursor: "pointer", fontWeight: 700, color: C.ink }}>How to read this</summary>
          <p style={{ margin: "6px 0 0" }}><b>Hold</b> = how long a call sat in the queue, from the call taker sending it to dispatch until the first unit was assigned.
            Line up every call in the range from shortest wait to longest. <b>Typical</b> (P50) is the call in the middle: half waited less. <b>9 in 10 under</b> (P90) is nine tenths of the way down the line: only 1 call in 10 waited longer.
            <b>Unit assigned within {mmss(goal)}</b> is the share of calls that got a unit within your goal (set in Data &amp; settings).
            An average hides the tail: a handful of very long waits pulls it up and says nothing about the ordinary call, while P50 and P90 together show what usual looks like and what bad looks like.</p></details>
      </Card>
      <Card title="Average hold by weekday and hour" sub="Darker cells waited longer" table={heatTable(d.heatmap)}><Heatmap cells={d.heatmap.map(c => ({ ...c, v: c.hold, n: c.measured }))} /></Card>
    </div>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <Card title="Hold by hour of day" sub="Average (solid) and the 9-in-10 mark (dashed) for calls received in each hour"
        table={{ columns: [{ key: "tip", label: "Hour" }, { key: "v", label: "Average", align: "right", fmt: mmss, csv: v => v }, { key: "ly", label: "9 in 10 under", align: "right", fmt: mmss, csv: v => v }, { key: "n", label: "Calls", align: "right", fmt: int }], rows: byHour }}>
        <TimeChart points={byHour} fmt={mmss} area={false} name="Average" lyName="9 in 10 under" compare={false} /></Card>
      <Card title="By priority" table={{ columns: prioCols(goal), rows: d.byPriority }} />
    </div>
    <div style={{ ...grid2, marginBottom: 14 }}>
      <section style={{ ...cardStyle, margin: 0 }} aria-label="Call processing">
        <H2 sub="Call received to sent for dispatch (needs queued_at in the CAD view)">Call processing time</H2>
        {d.processing.n ? <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          {[["Average", d.processing.avg], ["Typical", d.processing.p50], ["9 in 10 under", d.processing.p90]].map(([l, v]) => <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: C.soft }}>{l}</div><div style={{ fontSize: 22, fontWeight: 800 }}>{mmss(v)}</div></div>)}
        </div> : <div style={{ fontSize: 13, color: C.soft }}>Not available: the CAD view doesn't include when calls entered the dispatch queue.</div>}
      </section>
      <Card title="The tail over time" sub={`Share of calls holding over ${d.tail.minutes} minutes`}
        table={{ columns: [{ key: "tip", label: "Period" }, { key: "v", label: "% over", align: "right", fmt: pctTxt }], rows: tailPts }}>
        <TimeChart points={tailPts} fmt={v => `${dec(v)}%`} area={false} name={`% over ${d.tail.minutes} min`} /></Card>
    </div>
    <Card title="Longest holds" sub="The 15 longest waits in the window" table={{ columns: longCols, rows: d.longest }} />
  </>;
}

// ---- Call takers & dispatchers ---------------------------------------------------------------------
// ---- Apparatus: calls per unit per shift ------------------------------------------------------------
const hhmm = sec => { const m = Math.round((sec || 0) / 60); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function currentShiftDay(start = "07:00") {
  const [h, m] = start.split(":").map(Number), d = new Date();
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + m) d.setDate(d.getDate() - 1);
  return localDay(d);
}
const plusDays = (day, n) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const prettyShift = (day, shift) => `${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${shift ? ` (${shift} shift)` : ""}`;
function Apparatus({ meta, toast }) {
  const today = currentShiftDay();
  const [mode, setMode] = useState("shift");
  const [day, setDay] = useState(plusDays(today, -1));
  const [range, setRange] = useState({ from: plusDays(today, -7), to: plusDays(today, -1) });
  const [pattern, setPattern] = useState(null);
  const from = mode === "shift" ? day : range.from, to = mode === "shift" ? day : range.to;
  const path = `/apparatus?from=${from}&to=${to}${pattern !== null ? `&pattern=${encodeURIComponent(pattern)}` : ""}`;
  const { data: d, error } = useData(path, [path]);
  useEffect(() => { if (d && pattern === null) setPattern(d.pattern); }, [d]);   // eslint-disable-line react-hooks/exhaustive-deps
  const seg = on => ({ ...btn(on ? "primary" : "outline"), padding: "6px 14px" });
  const savePattern = async () => { try { await api("/apparatus", { pattern: pattern || "" }); toast("Saved as the default unit filter"); } catch (e) { toast(e.message); } };
  const controls = (
    <section style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }} className="no-print" aria-label="Apparatus filters">
      <div role="group" aria-label="Period" style={{ display: "flex", gap: 6 }}>
        <button type="button" aria-pressed={mode === "shift"} style={seg(mode === "shift")} onClick={() => setMode("shift")}>One shift</button>
        <button type="button" aria-pressed={mode === "range"} style={seg(mode === "range")} onClick={() => setMode("range")}>Date range</button>
      </div>
      {mode === "shift" ? <>
        <label style={{ fontSize: 12.5, color: C.soft, fontWeight: 600 }}>Shift starting (07:00)<br />
          <input aria-label="Shift day" type="date" style={{ ...inputStyle, width: 170 }} value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} /></label>
        <button type="button" style={btn("ghost")} onClick={() => setDay(plusDays(day, -1))}>‹ Previous</button>
        <button type="button" style={btn("ghost")} disabled={day >= today} onClick={() => setDay(plusDays(day, 1))}>Next ›</button>
        <button type="button" style={btn("ghost")} onClick={() => setDay(today)}>Current shift</button>
      </> : <>
        <label style={{ fontSize: 12.5, color: C.soft, fontWeight: 600 }}>From shift<br />
          <input aria-label="From shift" type="date" style={{ ...inputStyle, width: 170 }} value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} /></label>
        <label style={{ fontSize: 12.5, color: C.soft, fontWeight: 600 }}>To shift<br />
          <input aria-label="To shift" type="date" style={{ ...inputStyle, width: 170 }} value={range.to} min={range.from} max={today} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} /></label>
        {[["Last 7", 7], ["Last 30", 30]].map(([l, n]) => <button key={l} type="button" style={btn("ghost")} onClick={() => setRange({ from: plusDays(today, -n), to: plusDays(today, -1) })}>{l}</button>)}
      </>}
      <label style={{ fontSize: 12.5, color: C.soft, fontWeight: 600, flex: "1 1 220px" }}>Units (pattern; empty = every unit)<br />
        <input aria-label="Unit filter" style={inputStyle} value={pattern ?? ""} onChange={e => setPattern(e.target.value)} /></label>
      {d?.canManage && pattern !== null && pattern !== d.savedPattern && <button type="button" style={btn("outline")} onClick={savePattern}>Save as default</button>}
    </section>);
  if (error) return <>{controls}<Loading error={error} /></>;
  if (!d) return <>{controls}<Loading /></>;
  if (!d.configured && !d.stored?.n) return <>{controls}<section style={cardStyle} role="status">
    <H2>Units aren't coming from CAD yet</H2>
    <div style={{ fontSize: 13.5, color: C.soft }}>This report needs one more read-only view on the CAD server (every unit assigned to every call, with its times),
      then <code>CAD_STATS_UNITS_VIEW=dbo.vw_nexus_unit_responses</code> in the {PN} .env and a full reload in Data & settings. The script is <code>scripts/cad-units-view-sgfd.sql</code>.</div></section></>;
  const multi = d.days.length > 1;
  const cols = [
    { key: "unit", label: "Unit" },
    { key: "calls", label: "Calls", align: "right", bar: true, fmt: int },
    ...(multi ? [{ key: "perShift", label: "Per shift", align: "right", fmt: v => dec(v) }, { key: "busiest", label: "Busiest shift", fmt: v => v ? `${v[1]} · ${new Date(`${v[0]}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "", csv: v => v ? `${v[0]} (${v[1]})` : "" }] : []),
    { key: "arrived", label: "Arrived on scene", align: "right", fmt: int },
    { key: "busySeconds", label: "Time committed", align: "right", fmt: hhmm, csv: v => hhmm(v) },
  ];
  const title = multi ? `${prettyShift(d.from)} – ${prettyShift(d.to)}` : prettyShift(d.from, d.days[0]?.shift);
  const matrixCols = [{ key: "unit", label: "Unit" }, ...d.days.map(x => ({ key: x.day, label: `${new Date(`${x.day}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })} ${x.shift}`, align: "right", fmt: v => (v ? int(v) : "") })), { key: "calls", label: "Total", align: "right", fmt: int }];
  return <>
    {controls}
    <div style={{ display: "grid", gap: 14 }}>
      <Card title={`Calls by unit, ${title}`} csvName={`Apparatus ${d.from}${multi ? ` to ${d.to}` : ""}`}
        sub={`Shifts run ${d.shiftStart} to ${d.shiftStart}. A call counts once per unit, however many times it was assigned. Time committed = assigned to cleared.`}
        note={`${int(d.totals.calls)} unit responses by ${d.totals.units} unit${d.totals.units === 1 ? "" : "s"}${d.stored?.last ? ` · units loaded through ${d.stored.last.slice(0, 16).replace("T", " ")}` : ""}`}
        table={{ columns: cols, rows: d.units.map(u => ({ ...u, _key: u.unit })) }}>
        {d.units.length ? <BarChart name="Calls by unit" items={d.units.slice(0, 40).map(u => ({ label: u.unit, v: u.calls }))} /> : <div style={{ fontSize: 13.5, color: C.soft }}>No unit responses for this period{pattern ? " and unit filter" : ""}.</div>}
      </Card>
      {multi && d.days.length <= 62 && d.units.length > 0 && <Card title="Calls per shift" csvName={`Apparatus per shift ${d.from} to ${d.to}`}
        table={{ columns: matrixCols, rows: d.units.map(u => ({ unit: u.unit, ...u.byDay, calls: u.calls, _key: u.unit })) }} />}
    </div>
  </>;
}

function People({ filters, meta }) {
  const [role, setRole] = useState("dispatchers");
  const { data: d, error } = useData(`/people?role=${role}&${qs(filters)}`, [role, qs(filters)]);
  const goal = meta.settings.holdGoalSeconds;
  const seg = on => ({ ...btn(on ? "primary" : "outline"), padding: "6px 14px" });
  const cols = d ? [
    { key: "name", label: "Name", render: r => r.transfer ? <i style={{ color: C.soft }}>{r.name}</i> : r.name || <span style={{ color: C.muted }}>not named yet</span>, csv: v => v },
    { key: "cadId", label: "CAD id" }, { key: "calls", label: role === "dispatchers" ? "Calls dispatched" : "Calls taken", align: "right", bar: true, fmt: int },
    { key: "share", label: "Share", align: "right", fmt: pctTxt },
    { key: "avg", label: role === "dispatchers" ? "Avg hold" : "Avg processing", align: "right", fmt: mmss, csv: v => v },
    { key: "p50", label: "Typical", align: "right", fmt: mmss, csv: v => v }, { key: "p90", label: "9 in 10 under", align: "right", fmt: mmss, csv: v => v },
    ...(role === "dispatchers" ? [{ key: "withinPct", label: `Unit assigned within ${mmss(goal)}`, align: "right", fmt: pctTxt }] : []),
    { key: "nightsPct", label: "Nights (19-07)", align: "right", fmt: pctTxt },
  ] : [];
  return <>
    <div style={{ display: "flex", gap: 8, marginBottom: 10 }} role="group" aria-label="Who">
      <button type="button" aria-pressed={role === "dispatchers"} style={seg(role === "dispatchers")} onClick={() => setRole("dispatchers")}>Dispatchers</button>
      <button type="button" aria-pressed={role === "takers"} style={seg(role === "takers")} onClick={() => setRole("takers")}>Call takers</button>
    </div>
    {!d ? <Loading error={error} /> : <Card title={role === "dispatchers" ? "Dispatchers" : "Call takers"} csvName={role === "dispatchers" ? "Dispatchers" : "Call takers"}
      sub={role === "dispatchers" ? "Hold = queue to first unit assigned, for calls each person dispatched" : "Processing = call received to sent for dispatch, for calls each person took (self-initiated left out)"}
      note={<>Context matters: night shifts, priority mix and how busy the floor was all move these numbers. Use them to start a conversation, not to rank people.
        {meta.canManage && " CAD ids without names can be named in Data & settings."}
        {d.unrecorded > 0 && ` ${d.unrecorded.toLocaleString()} call${d.unrecorded === 1 ? "" : "s"} with no ${role === "dispatchers" ? "dispatcher" : "call taker"} recorded in CAD ${d.unrecorded === 1 ? "is" : "are"} left out.`}</>}
      table={{ columns: cols, rows: d.people.map(p => ({ ...p, _key: p.cadId })) }} />}
  </>;
}

// ---- Reports ---------------------------------------------------------------------------------------
export const BLOCK_TYPES = [
  ["heading", "Heading"], ["text", "Text / commentary"], ["kpis", "Headline numbers"], ["observations", "Observations"],
  ["volume", "Incidents over time"], ["dow", "By day of week"], ["hours", "By hour of day"], ["trend", "Trend summary"],
  ["agencies", "Calls by agency"], ["natures", "Top problem natures"],
  ["heatmap", "Hold heatmap (weekday × hour)"], ["percentiles", "Hold distribution & percentiles"], ["priority", "Hold by priority"],
  ["longest", "Longest holds"], ["takers", "Call takers (per person)"], ["dispatchers", "Dispatchers (per person)"],
];
const PEOPLE_BLOCKS = new Set(["takers", "dispatchers"]);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const blk = (type, title = "", text = "") => ({ id: newId(), type, title, text });
function templates(canPeople) {
  return [
    { key: "weekly", title: "Weekly Command Briefing", reportType: "Command briefing", windowKind: "last7",
      blocks: [blk("heading", "Demand this week"), blk("kpis"), blk("observations"), blk("volume"), blk("agencies"), blk("natures"), blk("heading", "Call handling"), blk("percentiles"), blk("heatmap"), blk("priority")] },
    { key: "monthly", title: "Monthly Communications Report", reportType: "Monthly report", windowKind: "lastMonth",
      blocks: [blk("kpis"), blk("observations"), blk("heading", "Volume"), blk("volume"), blk("dow"), blk("hours"), blk("trend"), blk("agencies"), blk("natures"),
        blk("heading", "Call handling"), blk("percentiles"), blk("heatmap"), blk("priority"), blk("longest"), ...(canPeople ? [blk("heading", "Staff"), blk("dispatchers"), blk("takers")] : [])] },
    { key: "calltaking", title: "Call Handling Review", reportType: "Call handling review", windowKind: "last30",
      blocks: [blk("kpis"), blk("percentiles"), blk("heatmap"), blk("priority"), blk("longest"), blk("text", "", "Notes and follow-up:")] },
  ];
}
function reportWindow(r, lastDay) {
  if (r.windowKind === "custom" && r.from && r.to) return { from: r.from, to: r.to };
  return presetRange(r.windowKind === "last30" ? "last30" : r.windowKind === "lastMonth" ? "lastMonth" : "last7", lastDay);
}

// Renders a report's blocks on "paper" (used on screen and in the print copy)
function Paper({ r, w, data, canPeople, print }) {
  const fw = print ? 690 : undefined;
  const generated = new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const block = b => {
    const ov = data.overview, vol = data.volume, ct = data.calltaking;
    const t = (title, el) => <div className="sgfd-block" key={b.id} style={{ margin: "14px 0", breakInside: "avoid" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 6 }}>{b.title || title}</div>{el}</div>;
    switch (b.type) {
      case "heading": return <h2 key={b.id} className="sgfd-block" style={{ fontFamily: "Georgia, serif", fontSize: 19, color: C.ink, borderBottom: `2px solid ${C.brick}`, padding: "0 0 4px", margin: "22px 0 8px", breakAfter: "avoid" }}>{b.title || "Section"}</h2>;
      case "text": return <p key={b.id} className="sgfd-block" style={{ fontSize: 13.5, color: C.ink, whiteSpace: "pre-wrap", margin: "10px 0" }}>{b.text}</p>;
      case "kpis": return t("Headline numbers", <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8 }}>
        {[["Incidents", int(ov.kpis.incidents.value), <Delta now={ov.kpis.incidents.value} then={ov.kpis.incidents.ly} suffix="vs LY" />],
          ["Daily average", dec(ov.kpis.dailyAvg.value), <Delta now={ov.kpis.dailyAvg.value} then={ov.kpis.dailyAvg.ly} suffix="vs LY" />],
          ["Average hold", mmss(ov.kpis.avgHold.value), <Delta now={ov.kpis.avgHold.value} then={ov.kpis.avgHold.ly} better="down" fmtAbs={mmss} suffix="vs LY" />],
          ["9 in 10 calls held under", mmss(ov.kpis.p90Hold.value), <Delta now={ov.kpis.p90Hold.value} then={ov.kpis.p90Hold.ly} better="down" fmtAbs={mmss} suffix="vs LY" />],
          [`Unit assigned within ${mmss(data.goal)}`, pctTxt(ov.kpis.withinGoal.value), <Delta now={ov.kpis.withinGoal.value} then={ov.kpis.withinGoal.ly} better="up" fmtAbs={v => `${dec(v)} pts`} suffix="vs LY" />]].map(([l, v, s]) => (
          <div key={l} style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: "8px 10px" }}><div style={{ fontSize: 10.5, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: C.ink }}>{v}</div><div style={{ fontSize: 11 }}>{s}</div></div>))}
      </div>);
      case "observations": return t("Observations", <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{ov.observations.map((o, i) => <li key={i} style={{ marginBottom: 4 }}><b>{o.title}.</b> {o.detail}</li>)}</ul>);
      case "volume": return t(`Incidents over time (${grainWord(vol.series.grain)})`, <TimeChart points={seriesPoints(vol.series, vol.seriesLy)} fixedWidth={fw} height={200} />);
      case "dow": return t("Incidents by day of week (average per day)", <BarChart items={vol.dow.map(x => ({ label: DOW[x.dow], v: x.avg }))} fmt={dec} fixedWidth={fw} height={170} />);
      case "hours": return t("Incidents by hour of day (average per day)", <BarChart items={vol.hours.map(x => ({ label: String(x.hour).padStart(2, "0"), v: x.avg }))} fmt={dec} fixedWidth={fw} height={170} />);
      case "trend": return t(`Trend summary (through ${longDay(vol.anchor)})`, <DataTable columns={trendCols} rows={vol.trend} sortable={false} compact />);
      case "agencies": return t("Calls by agency", <DataTable columns={agencyCols} rows={withChg(ov.agencies)} sortable={false} compact />);
      case "natures": return t("Top 10 problem natures", <DataTable columns={natureCols} rows={withChg(ov.natures)} sortable={false} compact />);
      case "dispositions": return null;                      // dispositions are no longer pulled; older saved reports skip the block
      case "heatmap": return t("Average hold by weekday and hour", <Heatmap cells={ov.heatmap.map(c => ({ ...c, v: c.hold, n: c.measured }))} fixedWidth={fw} />);
      case "percentiles": return t("Hold time distribution", <HoldDistribution d={ct} fixedWidth={fw} />);
      case "priority": return t("Hold by priority", <DataTable columns={prioCols(data.goal)} rows={ct.byPriority} sortable={false} compact />);
      case "longest": return t("Longest holds", <DataTable columns={longCols} rows={ct.longest} sortable={false} compact />);
      case "takers": case "dispatchers": {
        const p = data[b.type];
        if (!canPeople || !p) return t(b.type === "takers" ? "Call takers" : "Dispatchers", <div style={{ fontSize: 12.5, color: C.soft }}>Needs per-person statistics permission.</div>);
        return t(b.type === "takers" ? "Call takers (processing time)" : "Dispatchers (hold time)", <DataTable sortable={false} compact rows={p.people.map(x => ({ ...x, _key: x.cadId }))} columns={[
          { key: "name", label: "Name", fmt: (v, r) => v || r.cadId }, { key: "calls", label: "Calls", align: "right", fmt: int }, { key: "share", label: "Share", align: "right", fmt: pctTxt },
          { key: "avg", label: "Avg", align: "right", fmt: mmss }, { key: "p90", label: "9 in 10 under", align: "right", fmt: mmss },
          ...(b.type === "dispatchers" ? [{ key: "withinPct", label: `Unit assigned within ${mmss(data.goal)}`, align: "right", fmt: pctTxt }] : [])]} />);
      }
      default: return null;
    }
  };
  return (
    <div className={print ? "sgfd-print-paper" : "sgfd-paper"} style={{ background: "#fff", color: C.ink, padding: print ? 0 : "28px 32px", boxShadow: print ? "none" : "0 2px 14px rgba(19,35,63,0.14)", borderRadius: print ? 0 : 4, maxWidth: print ? "none" : 816, margin: "0 auto", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", borderBottom: `3px solid ${C.brick}`, paddingBottom: 10 }}>
        <img src="/logo-large.png" alt={BRAND.org} style={{ width: 62, height: 62 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: C.soft }}>{BRAND.org.toUpperCase()} · COMMUNICATIONS</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 25, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>{r.title || "Untitled report"}</div>
          {r.preparedBy && <div style={{ fontSize: 12, color: C.soft }}>Prepared by {r.preparedBy}</div>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", background: "#F7F3E8", border: `1px solid #E6DDC4`, borderTop: "none", fontSize: 12 }}>
        {[["Report type", r.reportType || "Report"], ["Window", `${longDay(w.from)} – ${longDay(w.to)}`], ["Agencies", r.agency || "All"], ["Generated", generated]].map(([l, v]) => (
          <div key={l} style={{ padding: "7px 10px", borderRight: "1px solid #E6DDC4" }}><div style={{ fontSize: 10, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>{l}</div><b>{v}</b></div>))}
      </div>
      {r.notes && <p style={{ fontSize: 13, margin: "12px 0 0", whiteSpace: "pre-wrap" }}>{r.notes}</p>}
      {data.loading ? <div style={{ padding: 20, color: C.soft }}>Loading the numbers…</div> : data.error ? <div role="alert" style={{ padding: 20, color: C.bad }}>{data.error}</div> : r.blocks.map(block)}
      <div style={{ marginTop: 18, paddingTop: 8, borderTop: `1px solid ${C.line}`, fontSize: 10.5, color: C.muted }}>
        Source: CAD incidents for {r.agency || "all agencies"} ({data.calls === "all" ? "all calls" : "dispatched calls"}), times from CAD. Hold = queue to first unit assigned. {BRAND.app}.</div>
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

function ReportBuilder({ start, meta, onClose, onSaved, toast }) {
  const [r, setR] = useState(start);
  const [add, setAdd] = useState("kpis");
  const w = reportWindow(r, meta.lastDay);
  const f = { from: w.from, to: w.to, agency: r.agency || "", calls: "dispatched" };
  const needs = useMemo(() => new Set(r.blocks.map(b => b.type)), [r.blocks]);
  const [data, setData] = useState({ loading: true });
  useEffect(() => {
    let live = true; setData(d => ({ ...d, loading: true, error: "" }));
    const get = (need, path) => (need ? api(path) : Promise.resolve(null));
    const any = (...t) => t.some(x => needs.has(x));
    Promise.all([
      get(any("kpis", "observations", "agencies", "natures", "dispositions", "heatmap"), `/overview?${qs(f)}`),
      get(any("volume", "dow", "hours", "trend"), `/volume?${qs(f)}`),
      get(any("percentiles", "priority", "longest"), `/calltaking?${qs(f)}`),
      get(needs.has("takers") && meta.canPeople, `/people?role=takers&${qs(f)}`),
      get(needs.has("dispatchers") && meta.canPeople, `/people?role=dispatchers&${qs(f)}`),
    ]).then(([overview, volume, calltaking, takers, dispatchers]) => live && setData({ loading: false, overview, volume, calltaking, takers, dispatchers, goal: meta.settings.holdGoalSeconds, calls: "dispatched" }),
      e => live && setData({ loading: false, error: e.message }));
    return () => { live = false; };
  }, [qs(f), [...needs].sort().join()]);    // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i, d) => setR(x => { const b = [...x.blocks]; const j = i + d; if (j < 0 || j >= b.length) return x; [b[i], b[j]] = [b[j], b[i]]; return { ...x, blocks: b }; });
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
  const types = BLOCK_TYPES.filter(([k]) => meta.canPeople || !PEOPLE_BLOCKS.has(k));
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }} className="no-print">
        <button type="button" style={btn("ghost")} onClick={onClose}><ArrowLeft size={14} /> All reports</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btn("primary")} onClick={() => window.print()} disabled={data.loading}><Printer size={14} /> Print / save as PDF</button>
          <button type="button" style={btn("outline")} onClick={() => save(false)}><Save size={14} /> {r.id && r.mine !== false ? "Save" : "Save as my report"}</button>
          {r.id && <button type="button" style={btn("outline")} onClick={() => save(true)}><Copy size={14} /> Save a copy</button>}
          {r.id && r.mine !== false && <button type="button" style={{ ...btn("ghost"), color: C.bad }} onClick={remove}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 14, alignItems: "start" }}>
        <section style={{ ...cardStyle, margin: 0, gridColumn: "span 1" }} aria-label="Report settings" className="no-print">
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Report settings</div>
          <label style={label}>Title<input aria-label="Report title" style={inputStyle} value={r.title} onChange={e => setR(x => ({ ...x, title: e.target.value }))} /></label>
          <label style={label}>Report type<input aria-label="Report type" style={inputStyle} value={r.reportType} onChange={e => setR(x => ({ ...x, reportType: e.target.value }))} placeholder="e.g. Command briefing" /></label>
          <label style={label}>Prepared by<input aria-label="Prepared by" style={inputStyle} value={r.preparedBy} onChange={e => setR(x => ({ ...x, preparedBy: e.target.value }))} placeholder="Name, unit" /></label>
          <label style={label}>Window
            <select aria-label="Report window" style={inputStyle} value={r.windowKind} onChange={e => setR(x => ({ ...x, windowKind: e.target.value, from: x.from || w.from, to: x.to || w.to }))}>
              <option value="last7">Last 7 days</option><option value="last30">Last 30 days</option><option value="lastMonth">Last full month</option><option value="custom">Fixed dates</option></select></label>
          {r.windowKind === "custom" && <div style={{ display: "flex", gap: 6 }}>
            <input aria-label="Report from" type="date" style={inputStyle} value={r.from || w.from} onChange={e => setR(x => ({ ...x, from: e.target.value }))} />
            <input aria-label="Report to" type="date" style={inputStyle} value={r.to || w.to} onChange={e => setR(x => ({ ...x, to: e.target.value }))} /></div>}
          <div style={{ fontSize: 12, color: C.soft, margin: "-4px 0 10px" }}>{r.windowKind === "custom" ? "Always these dates." : `Moves with the data: now ${longDay(w.from)} – ${longDay(w.to)}.`}</div>
          <label style={label}>Agency
            <select aria-label="Report agency" style={inputStyle} value={r.agency} onChange={e => setR(x => ({ ...x, agency: e.target.value }))}>
              <option value="">All agencies</option>{meta.agencies.map(a => <option key={a.agency} value={a.agency}>{a.agency}</option>)}</select></label>
          <label style={label}>Notes printed under the title<textarea aria-label="Report notes" style={{ ...inputStyle, minHeight: 64 }} value={r.notes} onChange={e => setR(x => ({ ...x, notes: e.target.value }))} /></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={!!r.shared} onChange={e => setR(x => ({ ...x, shared: e.target.checked }))} /> Share as a template with everyone who can see statistics</label>
        </section>
        <section style={{ ...cardStyle, margin: 0 }} aria-label="Report contents" className="no-print">
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
              {b.type === "text" && <textarea aria-label={`Text ${i + 1}`} style={{ ...inputStyle, marginTop: 5, minHeight: 60 }} value={b.text} onChange={e => setB(i, { text: e.target.value })} placeholder="Commentary, context, follow-up…" />}
            </div>))}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <select aria-label="Section to add" style={{ ...inputStyle, margin: 0 }} value={add} onChange={e => setAdd(e.target.value)}>{types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button type="button" style={btn("outline")} onClick={() => setR(x => ({ ...x, blocks: [...x.blocks, blk(add, add === "heading" ? "New section" : "")] }))}><Plus size={14} /> Add</button>
          </div>
        </section>
      </div>
      <div style={{ marginTop: 16, overflowX: "auto" }}><Paper r={r} w={w} data={data} canPeople={meta.canPeople} /></div>
      {typeof document !== "undefined" && createPortal(<div className="sgfd-print-portal"><Paper r={r} w={w} data={data} canPeople={meta.canPeople} print /></div>, document.body)}
    </>
  );
}
function Reports({ meta, toast }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => { api("/reports").then(r => setList(r.reports), e => toast(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return <ReportBuilder key={open.id || open.key} start={open} meta={meta} onClose={() => setOpen(null)} onSaved={setList} toast={toast} />;
  const fresh = t => ({ id: null, title: t.title, reportType: t.reportType, preparedBy: "", notes: "", windowKind: t.windowKind, from: null, to: null, agency: "", blocks: t.blocks.map(b => ({ ...b, id: newId() })), shared: false, key: t.key + Date.now() });
  const row = (r, act) => <div key={r.id || r.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.grid}`, flexWrap: "wrap" }}>
    <FileText size={18} color={C.series} aria-hidden="true" />
    <div style={{ flex: "1 1 240px" }}><b>{r.title}</b><div style={{ fontSize: 12.5, color: C.soft }}>{act}</div></div>
    <button type="button" style={btn("primary")} aria-label={`Open ${r.title}`} onClick={() => setOpen(r.id ? r : fresh(r))}>Open</button></div>;
  const mine = (list || []).filter(r => r.mine), shared = (list || []).filter(r => !r.mine);
  const win = r => (r.windowKind === "custom" ? `${r.from} to ${r.to}` : r.windowKind === "last30" ? "last 30 days" : r.windowKind === "lastMonth" ? "last full month" : "last 7 days");
  return <>
    <section style={{ ...cardStyle }} aria-label="Start a report">
      <H2 sub="Pick a starting point, change what's in it, then print or save as PDF. Charts re-run for the report's window every time it's opened.">Start a report</H2>
      {templates(meta.canPeople).map(t => row(t, `${t.blocks.length} sections · ${win(t)}`))}
    </section>
    <section style={{ ...cardStyle }} aria-label="My reports">
      <H2>My reports</H2>
      {!list ? <div style={{ color: C.soft }}>Loading…</div> : mine.length ? mine.map(r => row(r, `${r.blocks.length} sections · ${win(r)}${r.shared ? " · shared" : ""}`))
        : <div style={{ fontSize: 13, color: C.soft }}>Nothing saved yet. Open a starting point above and press Save.</div>}
    </section>
    {shared.length > 0 && <section style={{ ...cardStyle }} aria-label="Shared reports"><H2 sub="Saved by others for everyone to use. Saving one makes your own copy.">Shared reports</H2>
      {shared.map(r => row(r, `by ${r.owner} · ${r.blocks.length} sections · ${win(r)}`))}</section>}
  </>;
}

// ---- Data & settings (managers) --------------------------------------------------------------------
function OperatorRow({ o, users, onSave }) {
  const [name, setName] = useState(o.name), [uid, setUid] = useState(o.user_id || "");
  const dirty = name !== o.name || uid !== (o.user_id || "");
  return <tr style={{ borderBottom: `1px solid ${C.grid}` }}>
    <td style={{ padding: "5px 8px", fontWeight: 700 }}>{o.cad_id}</td><td style={{ padding: "5px 8px", textAlign: "right" }}>{int(o.taken)}</td><td style={{ padding: "5px 8px", textAlign: "right" }}>{int(o.dispatched)}</td>
    <td style={{ padding: "5px 8px" }}><input aria-label={`Name for ${o.cad_id}`} style={{ ...inputStyle, margin: 0, padding: "5px 8px" }} value={name} onChange={e => setName(e.target.value)} placeholder="Name shown in statistics" /></td>
    <td style={{ padding: "5px 8px" }}><select aria-label={`${PN} account for ${o.cad_id}`} style={{ ...inputStyle, margin: 0, padding: "5px 8px" }} value={uid} onChange={e => { setUid(e.target.value); const u = users.find(x => x.id === e.target.value); if (u && !name) setName(u.name); }}>
      <option value="">—</option>{users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></td>
    <td style={{ padding: "5px 8px" }}><button type="button" style={btn(dirty ? "primary" : "outline")} disabled={!dirty} onClick={() => onSave({ cadId: o.cad_id, name, userId: uid || null })}>Save</button></td>
  </tr>;
}
// Upload a CAD or FireWorks report (CSV or Excel): works with or without the CAD view
const readB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("Couldn't open that file.")); r.readAsDataURL(f); });
function UploadCard({ toast, onDone, agencies }) {
  const [file, setFile] = useState(null), [data, setData] = useState(""), [prev, setPrev] = useState(null), [agency, setAgency] = useState(""), [busy, setBusy] = useState(false);
  const pick = async f => {
    if (!f) return;
    setBusy(true); setPrev(null);
    try { const d = await readB64(f); setFile(f); setData(d); setPrev(await api("/admin/upload", { fileName: f.name, data: d, preview: true, agency })); }
    catch (e) { toast(e.message); setFile(null); }
    setBusy(false);
  };
  const run = async () => {
    setBusy(true);
    try { const r = await api("/admin/upload", { fileName: file.name, data, agency }); toast(`Added ${int(r.stored)} incident${r.stored === 1 ? "" : "s"}${r.fromCad ? ` (${int(r.fromCad)} were already in CAD)` : ""}`); setPrev(null); setFile(null); onDone(); }
    catch (e) { toast(e.message); }
    setBusy(false);
  };
  return <section style={cardStyle} aria-label="Upload a report">
    <H2 sub="A CSV or Excel export from CAD or FireWorks, one row per incident: an incident (CAD) number and the call times. FireWorks' Alarm Processing report (CADNumber, PSAPTime, Entered Queue, AlarmTime) works as is; Nature, Agency, Call taker, Dispatcher, En route, On scene and Closed columns are used when present. Addresses and other columns are ignored. Uploading the same incidents again updates them; incidents the CAD view already has are left alone.">Upload a CAD or FireWorks report</H2>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: C.soft }}>Agency for calls without an Agency column
        <input aria-label="Agency for uploaded calls" list="stats-agencies" style={{ ...inputStyle, width: 200 }} value={agency} onChange={e => setAgency(e.target.value)} placeholder={`e.g. ${BRAND.short}`} />
        <datalist id="stats-agencies">{(agencies || []).map(a => <option key={a.agency} value={a.agency} />)}</datalist></label>
      <label style={{ ...btn("outline"), cursor: "pointer" }}><Upload size={14} /> {busy && !prev ? "Reading…" : "Choose file"}
        <input type="file" aria-label="CAD report file" accept=".csv,.xlsx,.xlsm" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; pick(f); }} /></label>
      {file && <span style={{ fontSize: 12.5, color: C.soft }}>{file.name}</span>}
    </div>
    {prev && <div style={{ marginTop: 12, fontSize: 13.5 }}>
      <div><b>{int(prev.rows)}</b> incidents, {prev.from} to {prev.to}{prev.skipped ? `; ${prev.skipped} rows skipped` : ""}. Columns used: {prev.columns.join(", ")}.</div>
      <div style={{ color: C.soft, marginTop: 2 }}>{prev.holdWithin60 !== null ? `${pctTxt(prev.holdWithin60)} dispatched within 60 s of entering the queue` : ""}{prev.processMedian !== null ? ` · median call-taking ${mmss(prev.processMedian)}` : ""}</div>
      {!prev.hasAgency && !agency && <div style={{ color: C.warn, marginTop: 4 }}>This file has no Agency column: enter the agency above before adding it.</div>}
      {prev.errors.length > 0 && <div style={{ color: C.warn, fontSize: 12.5, marginTop: 4 }}>{prev.errors.join(" · ")}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" style={btn("primary")} disabled={busy || (!prev.hasAgency && !agency.trim())} onClick={run}><Upload size={14} /> Add {int(prev.rows)} incident{prev.rows === 1 ? "" : "s"}</button>
        <button type="button" style={btn("ghost")} onClick={() => { setPrev(null); setFile(null); }}>Cancel</button>
      </div>
    </div>}
  </section>;
}

// Which calls count: every agency + zone CAD sends, with checkboxes. Saved list = what every page, chart and report counts.
const SEP = "\x1e";
function ScopeCard({ a, post }) {
  const init = () => { const m = new Map(); for (const x of a.settings.include || []) m.set(x.agency + SEP + x.zone, true); return m; };
  const [only, setOnly] = useState((a.settings.include || []).length > 0);
  const [sel, setSel] = useState(init), [dropBlank, setDropBlank] = useState(a.settings.dropBlank !== false), [zones, setZones] = useState("");
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of a.areas || []) { if (!g.has(r.agency)) g.set(r.agency, { agency: r.agency, n: 0, zones: [] }); const x = g.get(r.agency); x.n += r.n; x.zones.push(r); }
    return [...g.values()].sort((p, q) => q.n - p.n);
  }, [a.areas]);
  const has = (agency, zone) => sel.has(agency + SEP + "*") || sel.has(agency + SEP + zone);
  const toggle = (k, on) => setSel(m => { const n = new Map(m); if (on) n.set(k, true); else n.delete(k); return n; });
  const pickZones = () => {
    const want = zones.split(/[\s,;]+/).map(z => z.trim().toUpperCase()).filter(Boolean);
    if (!want.length) return;
    setSel(m => { const n = new Map(m); for (const r of a.areas || []) if (want.includes(String(r.zone).toUpperCase())) n.set(r.agency + SEP + r.zone, true); return n; });
    setOnly(true);
  };
  const counted = (a.areas || []).filter(r => (!only || has(r.agency, r.zone)) && !(dropBlank && (!r.agency))).reduce((s, r) => s + r.n - (dropBlank && r.agency ? r.untyped : 0), 0);
  const total = (a.areas || []).reduce((s, r) => s + r.n, 0);
  const noZones = (a.areas || []).every(r => !r.zone);
  const save = () => {
    const include = only ? [...sel.keys()].map(k => { const [agency, zone] = k.split(SEP); return { agency, zone }; }) : [];
    if (only && !include.length) return post(null, null, "Check at least one agency or zone, or choose Every call.");
    post("/admin/scope", { include, dropBlank }, "Saved: statistics now count only these calls");
  };
  const lab = { display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, color: C.ink };
  return <section style={cardStyle} aria-label="Which calls count">
    <H2 sub="Every page, chart and report counts only these calls. Nothing is deleted: change this any time.">Which calls count</H2>
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
      <label style={lab}><input type="checkbox" checked={dropBlank} onChange={e => setDropBlank(e.target.checked)} /> Leave out calls with no agency or no call type (duplicate, linked, appended and test records)</label>
      <label style={lab}><input type="radio" name="stats-scope" checked={!only} onChange={() => setOnly(false)} /> Every agency and zone</label>
      <label style={lab}><input type="radio" name="stats-scope" checked={only} onChange={() => setOnly(true)} /> Only the agencies and zones checked below</label>
    </div>
    {only && <>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: C.soft }}>Check zones by number
          <input aria-label="Zones to check" style={{ ...inputStyle, width: 240 }} value={zones} onChange={e => setZones(e.target.value)} placeholder="e.g. 1213, 1389L, 1389I" onKeyDown={e => { if (e.key === "Enter") pickZones(); }} /></label>
        <button type="button" style={btn("outline")} onClick={pickZones}>Check these zones</button>
        <button type="button" style={btn("ghost")} onClick={() => setSel(new Map())}>Clear all</button>
      </div>
      {noZones && <div style={{ fontSize: 13, color: C.soft, background: "#FFF7E6", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
        No zones have come from CAD yet. Update the stats view (<code>scripts\cad-stats-view-sgfd.sql</code>), then use <b>Reload all</b> above; until then you can pick whole agencies.</div>}
      <div style={{ maxHeight: 420, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
        {groups.map(g => <div key={g.agency || "(none)"} style={{ padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
          <label style={{ ...lab, fontWeight: 700 }}><input type="checkbox" aria-label={`All of ${g.agency || "no agency"}`} checked={sel.has(g.agency + SEP + "*")} onChange={e => toggle(g.agency + SEP + "*", e.target.checked)} />
            {g.agency || "(no agency)"} <span style={{ fontWeight: 400, color: C.soft }}>· {int(g.n)} calls{g.zones.length > 1 || g.zones[0]?.zone ? " · all zones" : ""}</span></label>
          {(g.zones.length > 1 || g.zones[0]?.zone) && <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", paddingLeft: 24, marginTop: 4 }}>
            {g.zones.map(z => <label key={z.zone} style={{ ...lab, fontSize: 13 }}><input type="checkbox" aria-label={`${g.agency || "no agency"} zone ${z.zone || "none"}`} disabled={sel.has(g.agency + SEP + "*")}
              checked={has(g.agency, z.zone)} onChange={e => toggle(g.agency + SEP + z.zone, e.target.checked)} />{z.zone || "(no zone)"} <span style={{ color: C.soft }}>{int(z.n)}</span></label>)}
          </div>}
        </div>)}
      </div>
    </>}
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
      <button type="button" style={btn("primary")} onClick={save}>Save</button>
      <span style={{ fontSize: 13, color: C.soft }}>About {int(counted)} of {int(total)} stored calls would count.</span>
    </div>
  </section>;
}

function Admin({ toast, onMeta }) {
  const [a, setA] = useState(null);
  const [goal, setGoal] = useState(""), [tail, setTail] = useState(""), [askFull, setAskFull] = useState(false);
  const load = () => api("/admin").then(x => { setA(x); setGoal(String(x.settings.holdGoalSeconds)); setTail(String(x.settings.tailMinutes)); }, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!a?.running) return; const t = setInterval(() => { load(); onMeta(); }, 5000); return () => clearInterval(t); }, [a?.running]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <Loading />;
  const post = async (path, body, msg) => { if (!path) return toast(msg); try { const x = await api(path, body); if (x.operators) { setA(x); } else load(); onMeta(); toast(msg); } catch (e) { toast(e.message); } };
  const th = { textAlign: "left", padding: "6px 8px", fontSize: 11.5, color: C.soft, textTransform: "uppercase", borderBottom: `1px solid ${C.line}`, background: "#F3F5F8", position: "sticky", top: 0 };
  const unnamed = a.operators.filter(o => !o.name && !o.user_id).length;
  return <>
    <section style={cardStyle} aria-label="CAD sync">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <H2 sub={a.configured ? `Reads ${a.view} every night at ${a.syncTime} (the last ${a.lookback} days again, for calls closed late). First load started from ${a.start}.${a.testFile ? " Test file in use." : ""}` : "The direct CAD connection isn't set up. You can still upload CAD or FireWorks reports below; to connect CAD:"}>CAD sync and uploads</H2>
        {a.configured && <button type="button" style={btn("primary")} disabled={a.running} onClick={() => post("/admin/sync", {}, "Sync started")}><RefreshCw size={14} /> {a.running ? "Syncing…" : "Sync now"}</button>}
        {a.configured && !askFull && <button type="button" style={{ ...btn("outline"), color: C.ink, borderColor: C.ink }} disabled={a.running} title="Read every call again from the first-load date, e.g. after the CAD view changes"
          onClick={() => setAskFull(true)}>Reload all since {a.start}</button>}
        {a.configured && askFull && <span role="group" aria-label="Confirm full reload" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, background: "#FFF7E6", border: `1px solid ${C.line}`, borderRadius: 8, padding: "4px 8px" }}>
          Read every call since {a.start} again? It can take a few minutes.
          <button type="button" style={btn("primary")} disabled={a.running} onClick={() => { setAskFull(false); post("/admin/sync", { full: true }, "Full reload started"); }}>Yes, reload</button>
          <button type="button" style={btn("ghost")} onClick={() => setAskFull(false)}>Cancel</button></span>}
      </div>
      {!a.configured && <ol style={{ fontSize: 13.5, color: C.ink, paddingLeft: 20, margin: "4px 0 0" }}>
        <li>Give the CAD administrator <code>scripts\cad-stats-view-template.sql</code>. It makes one more read-only view (times and codes only: no addresses, callers or narratives) for the same <code>nexus_reader</code> login as Active calls.</li>
        <li>Add <code>CAD_STATS_VIEW=dbo.vw_nexus_call_stats</code> and <code>CAD_STATS_START=</code> (first day to load) to the <code>.env</code> file on the server. The <code>CAD_SQL_*</code> settings are shared with Active calls.</li>
        <li>Run <code>update.ps1</code>. The first load runs a month at a time in the background; after that it syncs every night.</li></ol>}
      {a.syncs.length > 0 && <div style={{ marginTop: 10 }}><DataTable compact sortable={false} label="Sync history" rows={a.syncs.map(s => ({ ...s, _key: s.id }))} columns={[
        { key: "kind", label: "Kind", render: s => s.kind === "upload" ? <span title={s.file_name}>upload: {s.file_name}{s.by_name ? ` (${s.by_name})` : ""}</span> : s.kind }, { key: "started_at", label: "Started", fmt: v => new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) },
        { key: "range_from", label: "From" }, { key: "range_to", label: "To" }, { key: "rows", label: "Incidents", align: "right", fmt: int },
        { key: "error", label: "Result", wrap: true, render: s => (!s.finished_at ? "running…" : s.error ? <span style={{ color: C.bad }}>{s.error}</span> : <span style={{ color: C.good }}>OK</span>) }]} /></div>}
    </section>
    <ScopeCard key={JSON.stringify(a.settings.include) + a.settings.dropBlank + (a.areas || []).length} a={a} post={post} />
    <UploadCard toast={toast} agencies={a.agencies} onDone={() => { load(); onMeta(); }} />
    <section style={cardStyle} aria-label="Goals">
      <H2 sub="Used on every page and in reports">Goals</H2>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: C.soft }}>Hold goal (seconds)<input aria-label="Hold goal seconds" type="number" min="5" max="3600" style={{ ...inputStyle, width: 130 }} value={goal} onChange={e => setGoal(e.target.value)} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: C.soft }}>"The tail" = holds over (minutes)<input aria-label="Tail minutes" type="number" min="1" max="240" style={{ ...inputStyle, width: 130 }} value={tail} onChange={e => setTail(e.target.value)} /></label>
        <button type="button" style={btn("primary")} onClick={() => post("/admin/settings", { holdGoalSeconds: Number(goal), tailMinutes: Number(tail) }, "Goals saved")}>Save goals</button>
      </div>
    </section>
    <section style={cardStyle} aria-label="CAD operator ids">
      <H2 sub={`Call taker and dispatcher ids seen in CAD. Name them (or link a ${PN} account) so statistics show names. ${unnamed ? `${unnamed} not named yet.` : ""}`}>CAD operator ids</H2>
      <div style={{ overflow: "auto", maxHeight: 420, border: `1px solid ${C.line}`, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><thead><tr><th style={th}>CAD id</th><th style={{ ...th, textAlign: "right" }}>Taken</th><th style={{ ...th, textAlign: "right" }}>Dispatched</th><th style={th}>Name</th><th style={th}>{PN} account</th><th style={th} /></tr></thead>
          <tbody>{a.operators.map(o => <OperatorRow key={o.cad_id} o={o} users={a.users} onSave={b => post("/admin/operators", b, `${b.cadId} saved`)} />)}</tbody></table></div>
    </section>
  </>;
}

// ---- Module ----------------------------------------------------------------------------------------
const PAGES = { overview: ["Overview", "How demand and call handling look for the window", "How is CAD demand and call handling performing?"],
  volume: ["Volume & Trends", "Call volume and hold over time, against the same dates last year", "Is call demand rising, falling or shifting?"],
  calltaking: ["Call-taking", "How long calls wait for a unit, and where the long waits are", "Where and when do calls wait longest?"],
  people: ["Call takers & dispatchers", "Workload and handling times by person", "Who is carrying the load, and how long do their calls take?"],
  apparatus: ["Apparatus", "Calls each unit ran, per shift or over a date range", "Which units are running the most calls, and when?"],
  reports: ["Reports", `Build, print and save reports on ${BRAND.short} letterhead`, ""], admin: ["Data & settings", "CAD sync, which calls count, goals and operator names", ""] };

export default function CommsStatsModule({ onBack }) {
  const [page, setPage] = useState("overview");
  const [meta, setMeta] = useState(null);
  const [metaErr, setMetaErr] = useState("");
  const [filters, setFilters] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const loadMeta = () => api("/meta").then(m => { setMeta(m); setFilters(f => f || { preset: "last30", calls: "dispatched", agency: "", ...presetRange("last30", m.lastDay || new Date().toISOString().slice(0, 10)) }); }, e => setMetaErr(e.message));
  useEffect(() => { loadMeta(); }, []);
  const ep = ["overview", "volume", "calltaking"].includes(page) && meta?.total ? `/${page}?${filters ? qs(filters) : ""}` : null;
  const { data: got, error, path: gotPath } = useData(ep, [ep]);
  const data = got && gotPath === ep ? got : null;

  const nav = [
    { key: "overview", label: "Overview", icon: LayoutDashboard, group: "Statistics" },
    { key: "volume", label: "Volume & Trends", icon: TrendingUp, group: "Statistics" },
    { key: "calltaking", label: "Call-taking", icon: Timer, group: "Statistics" },
    ...(meta?.canPeople ? [{ key: "people", label: "Call takers & dispatchers", icon: Users, group: "Statistics" }] : []),
    { key: "apparatus", label: "Apparatus", icon: Truck, group: "Statistics" },
    { key: "reports", label: "Reports", icon: FileText, group: "Reports" },
    ...(meta?.canManage ? [{ key: "admin", label: "Data & settings", icon: SlidersHorizontal, group: "Admin", badge: meta.unnamedOperators || 0 }] : []),
  ];
  const [title, sub, answers] = PAGES[page];
  let body;
  if (metaErr) body = <Loading error={metaErr} />;
  else if (!meta || !filters) body = <Loading />;
  else if (page === "reports") body = meta.total ? <Reports meta={meta} toast={showToast} /> : null;
  else if (page === "admin") body = <Admin toast={showToast} onMeta={loadMeta} />;
  else if (page === "apparatus") body = <Apparatus meta={meta} toast={showToast} />;
  if (meta && !meta.total && !["admin", "apparatus"].includes(page)) body = <section style={cardStyle} role="status">
    <H2>No CAD statistics yet</H2>
    <div style={{ fontSize: 13.5, color: C.soft }}>{meta.configured ? (meta.running ? "The first load from CAD is running now. This page fills in as it goes." : "Waiting for the first sync from CAD.")
      : meta.canManage ? <>Upload a CAD or FireWorks report (CSV or Excel), or connect the CAD view: see <button type="button" style={{ ...btn("ghost"), padding: 0, textDecoration: "underline" }} onClick={() => setPage("admin")}>Data & settings</button>.</>
      : "No CAD data has been loaded yet. Ask a Comms statistics manager to connect CAD or upload a report."}</div></section>;
  else if (meta && filters && !body) {
    const filt = <><FilterBar meta={meta} applied={filters} onApply={setFilters} /><Caption f={filters} meta={meta} /></>;
    if (page === "people") body = <>{filt}<People filters={filters} meta={meta} /></>;
    else body = <>{filt}{!data ? <Loading error={gotPath === ep ? error : ""} />
      : page === "overview" ? <Overview d={data} meta={meta} /> : page === "volume" ? <Volume d={data} meta={meta} /> : <CallTaking d={data} meta={meta} />}</>;
  }
  return (
    <AppShell section="Comms Statistics" nav={nav} active={page} onNav={k => setPage(k)} onHome={onBack} wide>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }} className="no-print">
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: 0 }}>{title}</h1>
          <div style={{ fontSize: 13.5, color: C.soft, marginTop: 2 }}>{sub}</div>
          {answers && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 4 }}><b style={{ color: C.brick, letterSpacing: 0.6, fontSize: 11 }}>ANSWERS</b> {answers}</div>}
        </div>
        {meta && <Freshness meta={meta} />}
      </div>
      {body}
      {toast && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{toast}</div>}
    </AppShell>
  );
}
