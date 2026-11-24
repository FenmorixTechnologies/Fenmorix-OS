// Small SVG charts for Communications Statistics (no chart library: they print cleanly and every
// chart has a table view and CSV download). Colors are local (see CLAUDE.md, import order).
//
// Palette (validated reference palette): one blue for "this period", neutral gray dashed for
// "same dates last year", a single-hue blue ramp for heatmaps (darker = slower / more).
import React, { useEffect, useMemo, useRef, useState } from "react";

export const C = {
  ink: "#13233F", soft: "#4B5565", muted: "#7A8494", line: "#DDE2EA", grid: "#ECEFF4", paper: "#FFFFFF",
  series: "#2a78d6", seriesFill: "rgba(42,120,214,0.16)", ly: "#8a8984", brick: "#C8102E",
  good: "#0ca30c", warn: "#B26A00", bad: "#d03b3b",
};
const RAMP = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];

// ---- formatting -------------------------------------------------------------------------------
export const mmss = s => (s === null || s === undefined || Number.isNaN(s) ? "–" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`.replace(/:60$/, ":59"));
export const int = v => (v === null || v === undefined ? "–" : Math.round(v).toLocaleString());
export const dec = v => (v === null || v === undefined ? "–" : (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }));
export const pctTxt = v => (v === null || v === undefined ? "–" : `${dec(v)}%`);
export const change = (a, b) => (b ? Math.round(1000 * (a - b) / b) / 10 : null);
export const shortDay = d => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString([], { month: "short", day: "numeric" }); };
export const longDay = d => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };
export const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const hh = h => `${String(h).padStart(2, "0")}:00`;

function niceMax(max, time = false) {
  if (!(max > 0)) return { top: time ? 60 : 1, step: time ? 15 : 1 };
  if (time) {                        // seconds: steps of 5 s, 10 s, 15 s, 30 s, 1, 2, 5, 10, 15, 30 min
    const step = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find(s => s >= max / 4) || 3600;
    return { top: Math.ceil(max / step) * step, step };
  }
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  return { top: Math.ceil(max / step) * step, step };
}
function useWidth(fixed) {
  const ref = useRef(null);
  const [w, setW] = useState(fixed || 640);
  useEffect(() => {
    if (fixed || !ref.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(e => setW(Math.max(220, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [fixed]);
  return [ref, fixed || w];
}
function Tip({ x, y, w, children }) {
  if (x === null || x === undefined) return null;
  const left = Math.min(Math.max(8, x + 12), w - 200);
  return <div role="tooltip" style={{ position: "absolute", left, top: Math.max(0, y - 10), width: 190, pointerEvents: "none", background: "#fff",
    border: `1px solid ${C.line}`, boxShadow: "0 4px 14px rgba(19,35,63,0.14)", borderRadius: 7, padding: "7px 9px", fontSize: 12, color: C.ink, zIndex: 5, lineHeight: 1.45 }}>{children}</div>;
}
const axisText = { fontSize: 10.5, fill: C.muted, fontFamily: "inherit" };

// ---- Time series: this period (area or line) + same dates last year (dashed) ---------------------
// points: [{ label, tip, v, ly, partial }]
export function TimeChart({ points, fmt = int, height = 220, area = true, name = "This period", lyName = "Same dates last year", fixedWidth, unit = "", compare = true }) {
  const [ref, W] = useWidth(fixedWidth);
  const [hover, setHover] = useState(null);
  const L = 46, R = 14, T = 12, B = 26, H = height - T - B, n = points.length;
  const hasLy = points.some(p => p.ly !== null && p.ly !== undefined);
  const vals = points.flatMap(p => [p.v, hasLy ? p.ly : null]).filter(v => v !== null && v !== undefined);
  const { top, step } = niceMax(Math.max(0, ...vals), fmt === mmss);
  const x = i => (n <= 1 ? L + (W - L - R) / 2 : L + i * (W - L - R) / (n - 1));
  const y = v => T + H * (1 - v / top);
  const path = key => { let d = "", pen = false; points.forEach((p, i) => { const v = p[key]; if (v === null || v === undefined) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };
  const firstV = points.findIndex(p => p.v !== null && p.v !== undefined);
  let lastV = -1; points.forEach((p, i) => { if (p.v !== null && p.v !== undefined) lastV = i; });
  const areaD = firstV >= 0 && n > 1 ? `${path("v")}L${x(lastV)},${y(0)}L${x(firstV)},${y(0)}Z` : "";
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 78))));
  const ticks = []; for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  const range = (k) => { const v = points.map(p => p[k]).filter(v => v !== null && v !== undefined); return v.length ? `${fmt(Math.min(...v))} to ${fmt(Math.max(...v))}` : "no data"; };
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect(), px = e.clientX - r.left;
    const i = n <= 1 ? 0 : Math.round((px - L) / ((W - L - R) / (n - 1)));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={height} role="img" aria-label={`${name}: ${range("v")}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", overflow: "visible" }}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.line : C.grid} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={axisText}>{fmt(t)}</text></g>)}
        {points.map((p, i) => (i % every === 0 && (i === 0 || n - 1 - i >= every / 2 || i === n - 1)) || (i === n - 1 && (n - 1) % every >= every / 2) ? <text key={i} x={x(i)} y={height - 8} textAnchor={n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"} style={axisText}>{p.label}</text> : null)}
        {area && areaD && <path d={areaD} fill={C.seriesFill} />}
        {hasLy && <path d={path("ly")} fill="none" stroke={C.ly} strokeWidth={1.6} strokeDasharray="5 4" />}
        <path d={path("v")} fill="none" stroke={C.series} strokeWidth={2} strokeLinejoin="round" />
        {(n <= 1 || n <= 40) && points.map((p, i) => p.v !== null && p.v !== undefined && (n <= 1 || p.partial) ? <circle key={i} cx={x(i)} cy={y(p.v)} r={4} fill={p.partial ? "#fff" : C.series} stroke={C.series} strokeWidth={2} /> : null)}
        {hp && <>
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + H} stroke={C.soft} strokeDasharray="3 3" />
          {hp.v !== null && hp.v !== undefined && <circle cx={x(hover)} cy={y(hp.v)} r={4.5} fill={C.series} stroke="#fff" strokeWidth={2} />}
          {hasLy && hp.ly !== null && hp.ly !== undefined && <circle cx={x(hover)} cy={y(hp.ly)} r={4} fill={C.ly} stroke="#fff" strokeWidth={2} />}
        </>}
        <rect x={L} y={T} width={Math.max(0, W - L - R)} height={H} fill="transparent" />
      </svg>
      {hp && <Tip x={x(hover)} y={T} w={W}>
        <b>{hp.tip || hp.label}</b>{hp.partial ? " (part)" : ""}<br />
        {name}: <b>{fmt(hp.v)}{unit}</b>
        {hasLy && <><br />{lyName}: {fmt(hp.ly)}{unit}{compare && hp.v !== null && hp.ly ? ` (${change(hp.v, hp.ly) > 0 ? "+" : ""}${dec(change(hp.v, hp.ly))}%)` : ""}</>}
      </Tip>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.soft, marginTop: 4 }}>
        <span><svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" stroke={C.series} strokeWidth="2.5" /></svg> {name} <span style={{ color: C.muted }}>{range("v")}</span></span>
        {hasLy && <span><svg width="16" height="8" aria-hidden="true"><line x1="0" x2="16" y1="4" y2="4" stroke={C.ly} strokeWidth="2" strokeDasharray="4 3" /></svg> {lyName}</span>}
        {points.some(p => p.partial) && <span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="#fff" stroke={C.series} strokeWidth="1.6" /></svg> part of a {points.length > 60 ? "week" : "period"} (not full)</span>}
      </div>
    </div>
  );
}

// ---- Vertical bars ------------------------------------------------------------------------------
// items: [{ label, tip, v, sub }]
export function BarChart({ items, fmt = int, height = 200, fixedWidth, labelMax = true, name = "" }) {
  const [ref, W] = useWidth(fixedWidth);
  const [hover, setHover] = useState(null);
  const L = 40, R = 6, T = 16, B = 24, H = height - T - B, n = items.length;
  const { top, step } = niceMax(Math.max(0, ...items.map(i => i.v || 0)), fmt === mmss);
  const band = (W - L - R) / Math.max(1, n), bw = Math.max(3, Math.min(46, band * 0.68));
  const y = v => T + H * (1 - v / top);
  const maxI = items.reduce((m, it, i) => ((it.v || 0) > (items[m]?.v || 0) ? i : m), 0);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L - R) / 34))));
  const ticks = []; for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={height} role="img" aria-label={name} style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.line : C.grid} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={axisText}>{fmt(t)}</text></g>)}
        {items.map((it, i) => {
          const cx = L + band * (i + 0.5), v = it.v || 0, h = Math.max(0, y(0) - y(v)), r = Math.min(4, bw / 2, h);
          const x0 = cx - bw / 2, y0 = y(v);
          const d = h > 0 ? `M${x0},${y(0)}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${y(0)}Z` : "";
          return <g key={i} onMouseEnter={() => setHover(i)}>
            <rect x={L + band * i} y={T} width={band} height={H} fill="transparent" />
            {d && <path d={d} fill={C.series} opacity={hover === null || hover === i ? 1 : 0.55} />}
            {labelMax && i === maxI && v > 0 && <text x={cx} y={y0 - 4} textAnchor="middle" style={{ ...axisText, fill: C.ink, fontWeight: 700 }}>{fmt(v)}</text>}
            {(i % every === 0) && <text x={cx} y={height - 8} textAnchor="middle" style={axisText}>{it.label}</text>}
          </g>;
        })}
      </svg>
      {hover !== null && items[hover] && <Tip x={L + band * (hover + 0.5)} y={y(items[hover].v || 0)} w={W}><b>{items[hover].tip || items[hover].label}</b><br />{fmt(items[hover].v)}{items[hover].sub ? <><br /><span style={{ color: C.soft }}>{items[hover].sub}</span></> : null}</Tip>}
    </div>
  );
}

// ---- Weekday x hour heatmap (single-hue ramp) ----------------------------------------------------
// cells: [{ dow 1-7, hour 0-23, v, n }]
export function Heatmap({ cells, fmt = mmss, what = "average hold", fixedWidth, minCount = 3 }) {
  const [ref, W] = useWidth(fixedWidth);
  const [hover, setHover] = useState(null);
  const L = 34, T = 16, gap = 2, cw = Math.max(8, (W - L - 4) / 24), ch = Math.max(14, Math.min(22, cw * 0.8));
  const by = new Map(cells.map(c => [`${c.dow}-${c.hour}`, c]));
  // Scale on the 5th-95th percentile so one odd cell can't wash out the rest (outliers get the end colors)
  const vals = cells.filter(c => c.v !== null && c.n >= minCount).map(c => c.v).sort((a, b) => a - b);
  const q = p => (vals.length ? vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))] : 0);
  const lo = q(0.05), hi = vals.length ? q(0.95) : 1;
  const color = v => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(((v - lo) / ((hi - lo) || 1)) * (RAMP.length - 1))))];
  const h = T + 7 * ch + 4;
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={h} role="img" aria-label={`Heatmap of ${what} by weekday and hour, ${fmt(lo)} to ${fmt(hi)}`} style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {Array.from({ length: 24 }, (_, hr) => hr % 3 === 0 && <text key={hr} x={L + hr * cw + cw / 2} y={11} textAnchor="middle" style={axisText}>{String(hr).padStart(2, "0")}</text>)}
        {[1, 2, 3, 4, 5, 6, 7].map(d => <g key={d}>
          <text x={L - 6} y={T + (d - 1) * ch + ch / 2 + 3.5} textAnchor="end" style={axisText}>{DOW[d]}</text>
          {Array.from({ length: 24 }, (_, hr) => {
            const c = by.get(`${d}-${hr}`), ok = c && c.v !== null && c.n >= minCount;
            return <rect key={hr} x={L + hr * cw + gap / 2} y={T + (d - 1) * ch + gap / 2} width={cw - gap} height={ch - gap} rx={2}
              fill={ok ? color(c.v) : "#F0EFEC"} stroke={hover && hover.d === d && hover.h === hr ? C.ink : "none"} strokeWidth={1.5}
              onMouseEnter={() => setHover({ d, h: hr, c })} />;
          })}
        </g>)}
      </svg>
      {hover && <Tip x={L + hover.h * cw} y={T + hover.d * ch} w={W}><b>{DOW[hover.d]} {hh(hover.h)}–{hh((hover.h + 1) % 24)}</b><br />
        {hover.c && hover.c.v !== null ? <>{what}: <b>{fmt(hover.c.v)}</b><br />{int(hover.c.n)} calls</> : "No calls"}{hover.c && hover.c.n < minCount && hover.c.n > 0 ? " (too few to color)" : ""}</Tip>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: C.soft, marginTop: 6, paddingLeft: L }}>
        <span>{fmt(lo)} or less</span>
        <span aria-hidden="true" style={{ flex: "0 1 220px", height: 9, borderRadius: 5, background: `linear-gradient(90deg, ${RAMP.join(",")})` }} />
        <span>{fmt(hi)} or more</span><span style={{ color: C.muted }}>darker = {what === "average hold" ? "slower" : "more"}</span>
      </div>
    </div>
  );
}

// ---- Hold distribution with percentile markers ---------------------------------------------------
const binLabel = b => (b.to === null ? `${mmss(b.from)}+` : `${mmss(b.from)}`);
export function Histogram({ bins, marks = [], height = 200, fixedWidth }) {
  const [ref, W] = useWidth(fixedWidth);
  const [hover, setHover] = useState(null);
  const L = 40, R = 8, T = 30, B = 24, H = height - T - B, n = bins.length;
  const { top, step } = niceMax(Math.max(0, ...bins.map(b => b.n)));
  const band = (W - L - R) / n, bw = Math.max(3, band - 2);
  const y = v => T + H * (1 - v / top);
  // a value in seconds -> x, interpolated inside its bin
  const xOf = s => { for (let i = 0; i < n; i++) { const b = bins[i]; if (b.to === null || s < b.to) return L + band * (i + (b.to === null ? 0.5 : (s - b.from) / (b.to - b.from))); } return W - R; };
  const ticks = []; for (let t = 0; t <= top + 1e-9; t += step) ticks.push(t);
  const placed = []; const markPos = marks.filter(m => m.value !== null && m.value !== undefined).map(m => { const x = xOf(m.value); let row = 0; while (placed.some(p => p.row === row && Math.abs(p.x - x) < 34)) row++; placed.push({ x, row }); return { ...m, x, row }; });
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <svg width={W} height={height} role="img" aria-label="Hold time distribution" style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? C.line : C.grid} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={axisText}>{int(t)}</text></g>)}
        {bins.map((b, i) => <g key={i} onMouseEnter={() => setHover(i)}>
          <rect x={L + band * i} y={T} width={band} height={H} fill="transparent" />
          {b.n > 0 && <rect x={L + band * i + 1} y={y(b.n)} width={bw} height={Math.max(1, y(0) - y(b.n))} rx={2} fill={C.series} opacity={hover === null || hover === i ? 0.9 : 0.5} />}
          {(i % Math.max(1, Math.ceil(n / Math.floor((W - L - R) / 40))) === 0) && <text x={L + band * i} y={height - 8} textAnchor="start" style={axisText}>{binLabel(b)}</text>}
        </g>)}
        {markPos.map(m => <g key={m.label}>
          <line x1={m.x} x2={m.x} y1={T - 2 - m.row * 12} y2={y(0)} stroke={C.ink} strokeWidth={1.2} strokeDasharray="3 3" />
          <text x={m.x} y={T - 5 - m.row * 12} textAnchor="middle" style={{ ...axisText, fill: C.ink, fontWeight: 700 }}>{m.label}</text>
        </g>)}
      </svg>
      {hover !== null && <Tip x={L + band * hover} y={y(bins[hover].n)} w={W}><b>{mmss(bins[hover].from)}{bins[hover].to === null ? " and longer" : ` – ${mmss(bins[hover].to)}`}</b><br />{int(bins[hover].n)} calls</Tip>}
    </div>
  );
}

// ---- Table with sorting, inline bars, CSV -----------------------------------------------------------
// columns: [{ key, label, align, fmt, bar: true, csv: v => ... }]
export function toCsv(columns, rows) {
  const esc = v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(c => esc(c.label)).join(","), ...rows.map(r => columns.map(c => esc(c.csv ? c.csv(r[c.key], r) : r[c.key])).join(","))].join("\r\n");
}
export function downloadCsv(name, columns, rows) {
  const blob = new Blob(["﻿" + toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${name.replace(/[^\w -]+/g, "").trim() || "data"}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function DataTable({ columns, rows, maxHeight, sortable = true, initialSort, label, compact }) {
  const [sort, setSort] = useState(initialSort || null);
  const shown = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    return [...rows].sort((a, b) => { const x = a[key], y = b[key]; if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * dir; });
  }, [rows, sort]);
  const maxes = Object.fromEntries(columns.filter(c => c.bar).map(c => [c.key, Math.max(1, ...rows.map(r => Number(r[c.key]) || 0))]));
  const pad = compact ? "5px 8px" : "7px 10px";
  return (
    <div style={{ overflow: "auto", maxHeight, border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <table aria-label={label} style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? 12.5 : 13 }}>
        <thead><tr>{columns.map(c => (
          <th key={c.key} scope="col" style={{ position: "sticky", top: 0, background: "#F3F5F8", textAlign: c.align || "left", padding: pad, fontSize: 11.5, letterSpacing: 0.3,
            textTransform: "uppercase", color: C.soft, borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}
            aria-sort={sort?.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
            {sortable ? <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key ? -s.dir : (typeof rows[0]?.[c.key] === "number" ? -1 : 1) }))}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textTransform: "inherit", letterSpacing: "inherit" }}>
              {c.label}{sort?.key === c.key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}</button> : c.label}
          </th>))}</tr></thead>
        <tbody>{shown.map((r, i) => (
          <tr key={r._key ?? i} style={{ borderBottom: `1px solid ${C.grid}` }}>{columns.map(c => (
            <td key={c.key} style={{ padding: pad, textAlign: c.align || "left", color: C.ink, whiteSpace: c.wrap ? "normal" : "nowrap", fontVariantNumeric: "tabular-nums" }}>
              {c.bar ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "flex-end", width: "100%" }}>
                <span aria-hidden="true" style={{ width: 70, height: 6, background: C.grid, borderRadius: 3, overflow: "hidden", flex: "0 0 auto" }}>
                  <span style={{ display: "block", height: "100%", width: `${100 * (Number(r[c.key]) || 0) / maxes[c.key]}%`, background: C.series, borderRadius: 3 }} /></span>
                <span style={{ minWidth: 44, textAlign: "right" }}>{c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</span></span>
                : c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
            </td>))}</tr>))}
          {!rows.length && <tr><td colSpan={columns.length} style={{ padding: 12, color: C.soft }}>No calls in this window.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// Change vs a comparison, with an arrow and words (never color alone)
export function Delta({ now, then, better = "none", suffix = "vs last year", fmtAbs }) {
  if (now === null || now === undefined || then === null || then === undefined) return <span style={{ color: C.muted }}>no comparison</span>;
  const p = fmtAbs ? null : change(now, then);
  const diff = now - then;
  if (!fmtAbs && p === null) return <span style={{ color: C.muted }}>no comparison</span>;
  const dir = (fmtAbs ? diff : p) > 0 ? 1 : (fmtAbs ? diff : p) < 0 ? -1 : 0;
  const good = better === "none" || dir === 0 ? null : (better === "up") === (dir > 0);
  return <span style={{ color: good === null ? C.soft : good ? C.good : C.bad, fontWeight: 600 }}>
    {dir > 0 ? "↑" : dir < 0 ? "↓" : "→"} {fmtAbs ? `${dir > 0 ? "+" : dir < 0 ? "−" : ""}${fmtAbs(Math.abs(diff))}` : `${p > 0 ? "+" : ""}${dec(p)}%`}
    <span style={{ color: C.muted, fontWeight: 400 }}> {suffix}</span></span>;
}
