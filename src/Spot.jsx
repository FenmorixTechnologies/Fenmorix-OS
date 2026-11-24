// Live spot prices (module "spot"): the ticker on every page (AppShell), the Spot Prices page, the Your Day card and the TV view.
// One shared poll of /api/spot for the whole page (useSpot), at the server's own pace. Server: server/spot.js.
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", UP = "#1E7B45", DOWN = "#B3261E", AMBER = "#8A5A00";
export const METAL_COLOR = { gold: "#C9A227", silver: "#8C96A3", platinum: "#5F7C8A", palladium: "#9A6B4F" };
export const money = n => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signed = n => (n == null ? "" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const when = t => (t ? new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

// ---- One poll for the whole page ----------------------------------------------------------------------------------------
let state = { data: null, error: "" }, subs = new Set(), timer = null, inFlight = false;
async function load() {
  if (inFlight) return; inFlight = true;
  try {
    const r = await fetch("/api/spot", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } });
    const j = await r.json().catch(() => ({}));
    state = r.ok ? { data: j, error: "" } : { ...state, error: j.error || "Spot prices aren't available." };
  } catch { state = { ...state, error: "Spot prices can't be reached." }; }
  inFlight = false;
  subs.forEach(f => f());
  clearTimeout(timer);
  const secs = Math.min(120, Math.max(15, state.data?.refreshSeconds || 60));
  if (subs.size) timer = setTimeout(load, secs * 1000);
}
function subscribe(f) { subs.add(f); if (subs.size === 1) load(); return () => { subs.delete(f); if (!subs.size) clearTimeout(timer); }; }
export function useSpot() { return useSyncExternalStore(subscribe, () => state); }
export const refreshSpot = load;

export function Change({ m, big }) {
  if (m.change == null) return <span style={{ color: INK_SOFT, fontSize: big ? 15 : 12 }}>—</span>;
  const c = m.change > 0 ? UP : m.change < 0 ? DOWN : INK_SOFT, Icon = m.change > 0 ? TrendingUp : m.change < 0 ? TrendingDown : Minus;
  return <span style={{ color: c, fontWeight: 700, fontSize: big ? 16 : 12.5, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
    <Icon size={big ? 18 : 13} aria-hidden="true" />{signed(m.change)}{m.changePct != null ? ` (${signed(m.changePct)}%)` : ""}</span>;
}

// ---- The ticker across the top of every page ----------------------------------------------------------------------------
export function SpotTicker({ style, onOpen }) {
  const { data } = useSpot();
  if (!data?.configured || !data.metals?.length) return null;
  return <div role="region" aria-label="Spot prices" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", background: "#0E1A29", color: "#fff",
    padding: "7px 18px", fontSize: 13, cursor: onOpen ? "pointer" : "default", ...style }}>
    <span style={{ fontWeight: 800, letterSpacing: 0.8, fontSize: 11, color: "#C9D2DE" }}>SPOT</span>
    {data.metals.map(m => <span key={m.metal} aria-label={`${m.name} ${money(m.price)}`} style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <b style={{ color: METAL_COLOR[m.metal] === "#8C96A3" ? "#C3CBD5" : METAL_COLOR[m.metal] }}>{m.name}</b>
      <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{money(m.price)}</span>
      <span style={{ filter: "brightness(1.6)" }}><Change m={m} /></span></span>)}
    <span style={{ flex: 1 }} />
    <span style={{ fontSize: 11.5, color: "#9FB0C4" }}>{data.demo ? "DEMO PRICES · " : ""}{data.marketClosed ? "Market closed · " : ""}{data.stale ? "Not updating · " : ""}{when(data.at)}</span>
  </div>;
}

// ---- A day / week / month chart (SVG) -----------------------------------------------------------------------------------
export function SpotChart({ metal, range = "day", height = 120, points: given, dark }) {
  const [pts, setPts] = useState(given || null);
  useEffect(() => {
    if (given) { setPts(given); return; }
    let alive = true;
    const go = () => fetch(`/api/spot/history?metal=${metal}&range=${range}`, { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setPts(j.points); }, () => {});
    go();
    const t = setInterval(go, range === "day" ? 120_000 : 900_000);
    return () => { alive = false; clearInterval(t); };
  }, [metal, range, given]);
  if (!pts) return <div style={{ height, color: INK_SOFT, fontSize: 12 }}>Loading…</div>;
  if (pts.length < 2) return <div style={{ height, display: "flex", alignItems: "center", color: dark ? "#9FB0C4" : INK_SOFT, fontSize: 12.5 }}>The chart fills in as prices come in today.</div>;
  const W = 600, H = height, pad = 4;
  const ps = pts.map(p => p.p), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || hi * 0.001 || 1;
  const t0 = Date.parse(pts[0].t), t1 = Date.parse(pts[pts.length - 1].t) || t0 + 1;
  const x = t => pad + ((Date.parse(t) - t0) / (t1 - t0 || 1)) * (W - 2 * pad), y = p => pad + (1 - (p - lo) / span) * (H - 2 * pad);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
  const up = ps[ps.length - 1] >= ps[0], c = up ? UP : DOWN;
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${metal} ${range} chart: ${money(lo)} to ${money(hi)}`} style={{ width: "100%", height, display: "block" }}>
    <defs><linearGradient id={`sg-${metal}-${range}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity="0.22" /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
    <path d={`${line}L${x(pts[pts.length - 1].t).toFixed(1)},${H}L${x(pts[0].t).toFixed(1)},${H}Z`} fill={`url(#sg-${metal}-${range})`} />
    <path d={line} fill="none" stroke={c} strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

// ---- The Spot Prices page -----------------------------------------------------------------------------------------------
export function SpotPrices({ isMaster }) {
  const { data, error } = useSpot();
  const [range, setRange] = useState("day"), [busy, setBusy] = useState(false), [msg, setMsg] = useState("");
  const checkNow = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/spot/refresh", { method: "POST", credentials: "same-origin", headers: { "X-SGFD": "1" } });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.error ? j.error : "Checked.") : j.error || "That didn't work."); setBusy(false); refreshSpot();
  };
  if (!data) return <div style={{ color: INK_SOFT }}>{error || "Loading…"}</div>;
  if (!data.configured) return <div style={{ color: INK_SOFT, fontSize: 14 }}>Spot prices aren't set up yet. A master admin sets SPOT_PROVIDER and SPOT_API_KEY in User Management › System › Server settings, then restarts.</div>;
  return <div>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14, fontSize: 13, color: INK_SOFT }}>
      <span>Per troy ounce, US dollars · {data.label}{data.at ? ` · updated ${when(data.at)}` : ""}{data.marketClosed ? " · markets are closed (weekend)" : ""}</span>
      {data.demo && <span style={{ background: "#FFF4DE", color: AMBER, fontWeight: 800, borderRadius: 6, padding: "2px 8px", fontSize: 12 }}>DEMO PRICES: made up for testing</span>}
      {data.stale && <span role="status" style={{ color: DOWN, fontWeight: 700 }}>Not updating{data.error ? `: ${data.error}` : ""}</span>}
      <span style={{ flex: 1 }} />
      <div role="tablist" aria-label="Chart range" style={{ display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden" }}>
        {[["day", "Today"], ["week", "Week"], ["month", "Month"]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={range === k} onClick={() => setRange(k)}
          style={{ border: "none", padding: "6px 12px", background: range === k ? INK : "#fff", color: range === k ? "#fff" : INK, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>)}</div>
      {isMaster && <button type="button" onClick={checkNow} disabled={busy} style={{ border: `1px solid ${LINE}`, background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer", display: "inline-flex", gap: 5, alignItems: "center", fontFamily: "inherit" }}><RefreshCw size={14} /> Check now</button>}
      {msg && <span role="status">{msg}</span>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
      {data.metals.map(m => <section key={m.metal} aria-label={m.name} style={{ background: "#fff", border: `1px solid ${LINE}`, borderTop: `4px solid ${METAL_COLOR[m.metal]}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}><div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{m.name}</div><span style={{ flex: 1 }} /><Change m={m} /></div>
        <div style={{ fontSize: 30, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums", margin: "4px 0 6px" }}>{money(m.price)}</div>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: INK_SOFT, flexWrap: "wrap", marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
          {m.bid != null && <span>Bid <b style={{ color: INK }}>{money(m.bid)}</b></span>}{m.ask != null && <span>Ask <b style={{ color: INK }}>{money(m.ask)}</b></span>}
          {m.high != null && <span>High {money(m.high)}</span>}{m.low != null && <span>Low {money(m.low)}</span>}</div>
        <SpotChart metal={m.metal} range={range} height={110} /></section>)}
    </div>
  </div>;
}

// ---- TV view (Display.jsx) ----------------------------------------------------------------------------------------------
export function SpotTv({ d }) {
  if (!d?.configured) return <div style={{ fontSize: 24, color: INK_SOFT }}>Spot prices aren't set up.</div>;
  if (!d.metals?.length) return <div style={{ fontSize: 24, color: INK_SOFT }}>Waiting for prices…</div>;
  return <div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 22 }}>
      {d.metals.map(m => <div key={m.metal} style={{ background: "#fff", borderRadius: 16, borderLeft: `10px solid ${METAL_COLOR[m.metal]}`, padding: "18px 24px", boxShadow: "0 2px 10px rgba(0,0,0,.06)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}><div style={{ fontSize: 30, fontWeight: 800, color: INK }}>{m.name}</div><span style={{ flex: 1 }} /><Change m={m} big /></div>
        <div style={{ fontSize: 58, fontWeight: 900, color: INK, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{money(m.price)}</div>
        <SpotChart metal={m.metal} points={d.day?.[m.metal] || []} height={90} /></div>)}
    </div>
    <div style={{ marginTop: 14, fontSize: 18, color: INK_SOFT }}>Per troy ounce · {d.demo ? "DEMO PRICES (made up) · " : ""}{d.marketClosed ? "Markets closed · " : ""}updated {when(d.at)}</div>
  </div>;
}
