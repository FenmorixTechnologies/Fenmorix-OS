// Strategies & Tactics: the overhead scene picture with fire/smoke, hydrants, hazards, blocked areas and apparatus.
//   mode "edit": scenario builder tools (scale, hydrants, fire, hazards, blocked areas, building outline, erase)
//   mode "run":  the officer positions arrived units (pick a unit, click the picture; drag to move; rotate)
//   mode "view": debrief replay (positions and fire as of `clock`)
// Coordinates are picture pixels (north up). ftPerPx turns them into feet; apparatus are drawn to scale.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize, RotateCcw, RotateCw, Move, Ruler, Flame, AlertTriangle, Ban, Home, Eraser, Droplet } from "lucide-react";
import { btn, inputStyle } from "./App.jsx";
import { INK, INK_SOFT, LINE, BRICK, AMBER, BLUE, unitKind, APPARATUS } from "./evalsShared.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TOOLS = [["move", "Move", Move], ["scale", "Set scale", Ruler], ["hydrant", "Hydrant", Droplet], ["fire", "Fire", Flame], ["hazard", "Hazard", AlertTriangle],
  ["blocked", "No access", Ban], ["building", "Building outline", Home], ["erase", "Erase", Eraser]];

export default function SceneMap({ scene, mode = "view", onChange, units = [], placements = [], onPlace, clock = 0, height = "62vh" }) {
  const svg = useRef(null);
  const W = scene.width, H = scene.height;
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  useEffect(() => { setVb({ x: 0, y: 0, w: W, h: H }); }, [scene.imageId, W, H]);
  const fpp = scene.ftPerPx || W / 600;                       // without a scale, assume ~600 ft across (display only)
  const px = ft => ft / fpp;
  const [tool, setTool] = useState("move"), [hz, setHz] = useState({ kind: "power", label: "", r: 40 }), [blockLabel, setBlockLabel] = useState("Parked cars");
  const [sel, setSel] = useState(null), [angle, setAngle] = useState(0), [msg, setMsg] = useState(""), [drag, setDrag] = useState(null), [pending, setPending] = useState(null);
  const pan = useRef(null);
  const toImg = e => {
    const p = svg.current.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.current.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(W, q.x)), y: Math.max(0, Math.min(H, q.y)) };
  };
  const zoom = (f, c) => setVb(v => {
    const w = Math.max(W / 12, Math.min(W * 1.2, v.w * f)), h = w * (v.h / v.w);
    const cx = c ? c.x : v.x + v.w / 2, cy = c ? c.y : v.y + v.h / 2;
    return { x: cx - (cx - v.x) * (w / v.w), y: cy - (cy - v.y) * (h / v.h), w, h };
  });
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wheel = e => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, toImg(e)); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const set = (k, v) => onChange({ ...scene, [k]: v });

  // ---- pointer handling ----
  function down(e) {
    const p = toImg(e);
    if (mode === "edit") {
      if (tool === "move") { pan.current = { cx: e.clientX, cy: e.clientY, vb }; return; }
      if (tool === "scale") {
        if (!pending) { setPending({ a: p }); setMsg("Now click the other end of something you know the length of."); return; }
        const d = dist(pending.a, p); setPending(null);
        const ft = Number(window.prompt("How many feet between the two points?", "100"));
        if (ft > 0 && d > 2) { onChange({ ...scene, ftPerPx: ft / d }); setMsg(`Scale set: ${Math.round(d)} px = ${ft} ft.`); }
        return;
      }
      if (tool === "hydrant") return set("hydrants", [...(scene.hydrants || []), { ...p, label: `H${(scene.hydrants || []).length + 1}` }]);
      if (tool === "fire") {
        const t = Number(window.prompt("Seconds after the start when this fire shows (0 = on arrival)", "0"));
        return set("fire", [...(scene.fire || []), { ...p, t: Number.isFinite(t) ? t : 0, r: px(20) }]);
      }
      if (tool === "hazard") return set("hazards", [...(scene.hazards || []), { ...p, kind: hz.kind, label: hz.label, r: px(Number(hz.r) || 40) }]);
      if (tool === "blocked") { setDrag({ start: p, cur: p }); return; }
      if (tool === "building") return set("building", [...(scene.building || []), p]);
      if (tool === "erase") {
        const near = (list, r = px(15)) => (list || []).findIndex(i => dist(i, p) <= Math.max(r, i.r || 0));
        let i;
        if ((i = near(scene.hydrants)) >= 0) return set("hydrants", scene.hydrants.filter((_, j) => j !== i));
        if ((i = near(scene.fire)) >= 0) return set("fire", scene.fire.filter((_, j) => j !== i));
        if ((i = (scene.blocked || []).findIndex(b => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)) >= 0) return set("blocked", scene.blocked.filter((_, j) => j !== i));
        if ((i = near(scene.hazards)) >= 0) return set("hazards", scene.hazards.filter((_, j) => j !== i));
      }
      return;
    }
    if (mode === "run" && sel) { place(sel, p, angle); return; }
    pan.current = { cx: e.clientX, cy: e.clientY, vb };
  }
  function move(e) {
    if (drag) { setDrag({ ...drag, cur: toImg(e) }); return; }
    if (pan.current) {
      const r = svg.current.getBoundingClientRect(), f = Math.max(pan.current.vb.w / r.width, pan.current.vb.h / r.height);
      setVb({ ...pan.current.vb, x: pan.current.vb.x - (e.clientX - pan.current.cx) * f, y: pan.current.vb.y - (e.clientY - pan.current.cy) * f });
    }
  }
  function up(e) {
    if (drag && drag.unit) { const p = toImg(e); const u = drag.unit; setDrag(null); if (dist(p, drag.from) > 2) place(u, p, drag.angle); return; }
    if (drag) {
      const a = drag.start, b = drag.cur; setDrag(null);
      if (Math.abs(a.x - b.x) > 3 && Math.abs(a.y - b.y) > 3) set("blocked", [...(scene.blocked || []), { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y), label: blockLabel }]);
      return;
    }
    pan.current = null;
  }
  async function place(unit, p, ang) {
    setMsg("");
    const r = await onPlace(unit, p.x, p.y, ang);
    setMsg(r?.ok ? `${unit}: ${r.placement.notes.join("; ")}` : r?.reason || "");
  }

  // ---- drawing ----
  const fires = (scene.fire || []).filter(f => mode === "edit" || f.t <= clock);
  const windTo = ((scene.wind?.from ?? 90) + 180) * Math.PI / 180;            // compass: 0 = north (up)
  const wdx = Math.sin(windTo), wdy = -Math.cos(windTo);
  const showHaz = h => mode !== "run" || h.kind !== "collapse";
  const bar = scene.ftPerPx ? (W * fpp > 400 ? 100 : 50) : null;
  const unitShapes = (mode === "run" && drag?.unit ? placements.map(p => p.unit === drag.unit ? { ...p, x: drag.cur?.x ?? p.x, y: drag.cur?.y ?? p.y } : p) : placements);
  return (
    <div>
      {mode === "edit" && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
        {TOOLS.map(([k, l, I]) => <button key={k} type="button" aria-pressed={tool === k} aria-label={`Tool: ${l}`} onClick={() => { setTool(k); setPending(null); setMsg(""); }}
          style={{ ...btn(tool === k ? "primary" : "outline"), padding: "5px 9px", fontSize: 12.5 }}><I size={13} /> {l}</button>)}
        {tool === "hazard" && <>
          <select aria-label="Hazard kind" style={{ ...inputStyle, width: "auto", padding: "4px 6px" }} value={hz.kind} onChange={e => setHz({ ...hz, kind: e.target.value })}>
            <option value="power">Power lines (officer sees it)</option><option value="collapse">Collapse zone (hidden; graded)</option><option value="other">Other hazard</option></select>
          <input aria-label="Hazard label" style={{ ...inputStyle, width: 140, padding: "4px 6px" }} placeholder="Label" value={hz.label} onChange={e => setHz({ ...hz, label: e.target.value })} />
          <input aria-label="Hazard radius (ft)" style={{ ...inputStyle, width: 80, padding: "4px 6px" }} value={hz.r} onChange={e => setHz({ ...hz, r: e.target.value })} title="Radius in feet" /></>}
        {tool === "blocked" && <input aria-label="No-access label" style={{ ...inputStyle, width: 160, padding: "4px 6px" }} value={blockLabel} onChange={e => setBlockLabel(e.target.value)} />}
        {tool === "building" && <button type="button" style={{ ...btn("ghost"), fontSize: 12.5 }} onClick={() => set("building", [])}>Clear outline</button>}
      </div>}
      {mode === "run" && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
        {units.map(u => { const placed = placements.some(p => p.unit === u.name); return (
          <button key={u.name} type="button" aria-pressed={sel === u.name} aria-label={`Position ${u.name}`} disabled={!u.arrived} onClick={() => setSel(sel === u.name ? null : u.name)}
            title={u.arrived ? (placed ? "Placed: pick it and click the picture to move it, or drag it" : "Pick, then click the picture where it goes") : "Not on scene yet"}
            style={{ border: `1px solid ${sel === u.name ? INK : LINE}`, background: sel === u.name ? INK : "#fff", color: sel === u.name ? "#fff" : u.arrived ? INK : "#AAB", borderRadius: 14, padding: "3px 9px", fontSize: 12.5, fontWeight: 700, cursor: u.arrived ? "pointer" : "default" }}>
            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: APPARATUS[unitKind(u.name)].color, border: "1px solid #333", marginRight: 4 }} />{u.name}{placed ? " ✓" : ""}</button>); })}
        {sel && <>
          <button type="button" aria-label="Rotate left" style={{ ...btn("ghost"), padding: "3px 6px" }} onClick={() => { const a = (angle + 330) % 360; setAngle(a); const p = placements.find(x => x.unit === sel); if (p) place(sel, p, a); }}><RotateCcw size={14} /></button>
          <button type="button" aria-label="Rotate right" style={{ ...btn("ghost"), padding: "3px 6px" }} onClick={() => { const a = (angle + 30) % 360; setAngle(a); const p = placements.find(x => x.unit === sel); if (p) place(sel, p, a); }}><RotateCw size={14} /></button>
          <span style={{ fontSize: 12, color: INK_SOFT }}>Click the picture to put {sel} there</span></>}
      </div>}
      <div style={{ position: "relative", border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden", background: "#1b2230" }}>
        <svg ref={svg} role="img" aria-label="Scene map" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height, display: "block", touchAction: "none", cursor: mode === "run" && sel ? "crosshair" : mode === "edit" && tool !== "move" ? "crosshair" : "grab" }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { pan.current = null; }}>
          <defs>
            <radialGradient id="sm-fire"><stop offset="0" stopColor="#FFF2A8" /><stop offset=".35" stopColor="#FFB22E" /><stop offset=".7" stopColor="#F0461E" stopOpacity=".85" /><stop offset="1" stopColor="#B4140A" stopOpacity="0" /></radialGradient>
            <filter id="sm-blur"><feGaussianBlur stdDeviation={px(6)} /></filter>
            <pattern id="sm-hatch" width={px(6)} height={px(6)} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width={px(2.5)} height={px(6)} fill="#C8102E" fillOpacity=".55" /></pattern>
            <style>{`@keyframes sm-flick { 0%,100% { opacity: .95 } 50% { opacity: .7 } } .sm-flame { animation: sm-flick .9s ease-in-out infinite } @media (prefers-reduced-motion: reduce) { .sm-flame { animation: none } }`}</style>
          </defs>
          <image href={`/api/evals/images/${scene.imageId}`} x="0" y="0" width={W} height={H} preserveAspectRatio="none" />
          {(scene.blocked || []).map((b, i) => <g key={`b${i}`}><rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#sm-hatch)" stroke="#C8102E" strokeWidth={px(1)} />
            {b.label && <text x={b.x + b.w / 2} y={b.y + b.h / 2} fontSize={px(9)} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={px(.6)} paintOrder="stroke">{b.label}</text>}</g>)}
          {(mode !== "run") && (scene.building || []).length > 0 && <polygon points={scene.building.map(p => `${p.x},${p.y}`).join(" ")} fill={mode === "edit" ? "#00E5FF22" : "none"} stroke="#00E5FF" strokeWidth={px(1.5)} strokeDasharray={mode === "edit" ? "" : `${px(4)} ${px(3)}`} />}
          {(scene.hazards || []).filter(showHaz).map((h, i) => <g key={`h${i}`}><circle cx={h.x} cy={h.y} r={h.r} fill={h.kind === "collapse" ? "#C8102E22" : "#FFD60022"} stroke={h.kind === "collapse" ? "#C8102E" : h.kind === "power" ? "#FFD600" : "#FF9F1C"} strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(3)}`} />
            <text x={h.x} y={h.y - h.r - px(2)} fontSize={px(9)} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={px(.6)} paintOrder="stroke">{h.kind === "power" ? "⚡ " : h.kind === "collapse" ? "Collapse zone " : "⚠ "}{h.label}</text></g>)}
          {fires.map((f, i) => { const g = mode === "edit" ? 1 : Math.min(1.35, 0.55 + (clock - f.t) / 300); const r = f.r * g; return (
            <g key={`f${i}`} pointerEvents="none">
              {[1, 2, 3, 4, 5].map(k => <circle key={k} cx={f.x + wdx * r * k * 1.25} cy={f.y + wdy * r * k * 1.25} r={r * (0.8 + k * 0.35)} fill="#5f6168" fillOpacity={0.5 - k * 0.07} filter="url(#sm-blur)" />)}
              <circle className="sm-flame" cx={f.x} cy={f.y} r={r} fill="url(#sm-fire)" />
              {mode === "edit" && <text x={f.x} y={f.y + r + px(9)} fontSize={px(9)} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={px(.6)} paintOrder="stroke">fire {f.t ? `at ${f.t}s` : "on arrival"}</text>}
            </g>); })}
          {(scene.hydrants || []).map((h, i) => <g key={`y${i}`}><circle cx={h.x} cy={h.y} r={px(4)} fill="#E01B1B" stroke="#fff" strokeWidth={px(1.2)} />
            <text x={h.x + px(6)} y={h.y + px(3)} fontSize={px(9)} fill="#fff" stroke="#000" strokeWidth={px(.6)} paintOrder="stroke">{h.label}</text></g>)}
          {unitShapes.map(p => {
            const k = unitKind(p.unit), a = APPARATUS[k], L = px(a.l), Wd = px(a.w);
            const hyd = (k === "engine" || k === "tanker") && (scene.hydrants || []).length ? scene.hydrants.slice().sort((m, n) => dist(m, p) - dist(n, p))[0] : null;
            return (
              <g key={p.unit} onPointerDown={mode === "run" ? e => { e.stopPropagation(); setSel(p.unit); setAngle(p.angle || 0); setDrag({ unit: p.unit, from: { x: p.x, y: p.y }, cur: { x: p.x, y: p.y }, angle: p.angle || 0 }); } : undefined}
                style={{ cursor: mode === "run" ? "move" : "default" }}>
                {hyd && dist(hyd, p) * fpp < 1500 && <><line x1={p.x} y1={p.y} x2={hyd.x} y2={hyd.y} stroke="#4FC3F7" strokeWidth={px(1.2)} strokeDasharray={`${px(4)} ${px(3)}`} />
                  <text x={(p.x + hyd.x) / 2} y={(p.y + hyd.y) / 2 - px(2)} fontSize={px(8)} textAnchor="middle" fill="#B3E5FC" stroke="#000" strokeWidth={px(.5)} paintOrder="stroke">{Math.round(dist(hyd, p) * fpp)} ft</text></>}
                {k === "ladder" && (sel === p.unit || mode === "view") && <circle cx={p.x} cy={p.y} r={px(a.reach)} fill="none" stroke="#FFB74D" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} />}
                <g transform={`translate(${p.x} ${p.y}) rotate(${p.angle || 0})`}>
                  <rect x={-L / 2} y={-Wd / 2} width={L} height={Wd} rx={px(1.2)} fill={a.color} stroke={sel === p.unit ? "#00E5FF" : "#111"} strokeWidth={px(sel === p.unit ? 2 : 1)} />
                  <rect x={L / 2 - px(7)} y={-Wd / 2} width={px(7)} height={Wd} fill="#000" fillOpacity=".35" />
                </g>
                <text x={p.x} y={p.y - Math.max(L, Wd) / 2 - px(3)} fontSize={px(9)} textAnchor="middle" fontWeight="700" fill="#fff" stroke="#000" strokeWidth={px(.7)} paintOrder="stroke">{p.unit}</text>
              </g>);
          })}
          {mode === "edit" && pending && <circle cx={pending.a.x} cy={pending.a.y} r={px(3)} fill="#00E5FF" />}
          {drag && !drag.unit && <rect x={Math.min(drag.start.x, drag.cur.x)} y={Math.min(drag.start.y, drag.cur.y)} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill="url(#sm-hatch)" stroke="#C8102E" />}
          {bar && <g transform={`translate(${vb.x + vb.w * 0.03} ${vb.y + vb.h * 0.95})`} pointerEvents="none">
            <rect x={-px(3)} y={-px(12)} width={px(bar) + px(6)} height={px(16)} fill="#000" fillOpacity=".45" />
            <line x1="0" y1="0" x2={px(bar)} y2="0" stroke="#fff" strokeWidth={px(2)} /><text x={px(bar) / 2} y={-px(3)} fontSize={px(8)} textAnchor="middle" fill="#fff">{bar} ft</text></g>}
          <g transform={`translate(${vb.x + vb.w * 0.95} ${vb.y + vb.h * 0.07})`} pointerEvents="none"><polygon points={`0,${-vb.w * 0.025} ${vb.w * 0.012},${vb.w * 0.012} 0,${vb.w * 0.004} ${-vb.w * 0.012},${vb.w * 0.012}`} fill="#fff" stroke="#000" strokeWidth={vb.w * 0.002} />
            <text y={vb.w * 0.035} fontSize={vb.w * 0.022} textAnchor="middle" fill="#fff" stroke="#000" strokeWidth={vb.w * 0.002} paintOrder="stroke">N</text></g>
        </svg>
        <div style={{ position: "absolute", right: 6, top: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" aria-label="Zoom in" style={{ ...btn("outline"), padding: 5, background: "#fff" }} onClick={() => zoom(1 / 1.4)}><ZoomIn size={15} /></button>
          <button type="button" aria-label="Zoom out" style={{ ...btn("outline"), padding: 5, background: "#fff" }} onClick={() => zoom(1.4)}><ZoomOut size={15} /></button>
          <button type="button" aria-label="Fit" style={{ ...btn("outline"), padding: 5, background: "#fff" }} onClick={() => setVb({ x: 0, y: 0, w: W, h: H })}><Maximize size={15} /></button>
        </div>
        {scene.wind?.mph > 0 && <div style={{ position: "absolute", left: 8, top: 8, background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 12, padding: "2px 7px", borderRadius: 4 }}>Wind from {scene.wind.from}° · {scene.wind.mph} mph</div>}
        {scene.attribution && <div style={{ position: "absolute", right: 6, bottom: 4, color: "#fff", fontSize: 10.5, textShadow: "0 0 3px #000" }}>{scene.attribution}</div>}
      </div>
      {msg && <div role="status" style={{ fontSize: 12.5, marginTop: 5, color: /can't|inside|OUT|WON'T|collapse|power/i.test(msg) ? AMBER : INK_SOFT }}>{msg}</div>}
      {mode === "edit" && !scene.ftPerPx && <div style={{ fontSize: 12.5, color: BRICK, marginTop: 4 }}>Set the scale (click both ends of something you know the length of) so distances, hose reach and aerial reach are right.</div>}
    </div>
  );
}
