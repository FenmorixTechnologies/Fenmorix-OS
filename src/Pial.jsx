// PIAL tracker (server/pial.js): live estimate of the district's FSRS score with the records behind it,
// owned item by item by division, plus a printable binder for graders.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { createPortal } from "react-dom";
import { Gauge, Radio, Flame, Droplets, ShieldCheck, GraduationCap, Truck, ClipboardCheck, Upload, Printer, SlidersHorizontal, FileText,
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Paperclip, Trash2, Plus, Save, HelpCircle, Download, Eye } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { C, DataTable, downloadCsv, int, dec, pctTxt } from "./StatCharts.jsx";
import { PN } from "./brand.js";

async function api(path, body) {
  const r = await fetch(`/api/pial${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pts = v => (v === null || v === undefined ? "–" : (Math.round(v * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDay = d => { if (!d) return "–"; const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }); };
const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(f); });
const SEC_ICON = { comms: Radio, fd: Flame, water: Droplets, crr: ShieldCheck };
const tone = p => (p === null ? C.muted : p >= 0.9 ? C.good : p >= 0.7 ? C.warn : C.bad);
const label = { display: "block", fontSize: 12, fontWeight: 700, color: C.soft, marginBottom: 10 };
const H = ({ children, sub, right }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 10 }}>
  <div><div style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{children}</div>{sub && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 2 }}>{sub}</div>}</div>{right}</div>;

function Bar({ value, max, color, height = 8 }) {
  const p = max ? Math.max(0, Math.min(1, value / max)) : 0;
  return <span aria-hidden="true" style={{ display: "block", height, background: C.grid, borderRadius: height / 2, overflow: "hidden" }}>
    <span style={{ display: "block", height: "100%", width: `${p * 100}%`, background: color || C.series, borderRadius: height / 2 }} /></span>;
}
function Badge({ children, color = C.soft, bg = "#EEF1F5" }) {
  return <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{children}</span>;
}

// ---- Item card --------------------------------------------------------------------------------------
function ItemCard({ item, data, onSaved, toast, open, onToggle }) {
  const [manual, setManual] = useState(item.manualPct ?? "");
  const [inputs, setInputs] = useState(item.inputs || {});
  const [notes, setNotes] = useState(item.notes || "");
  const [owner, setOwner] = useState(item.owner);
  const [ev, setEv] = useState(null);
  const [upTitle, setUpTitle] = useState(""), [upDate, setUpDate] = useState("");
  const fileRef = useRef(null);
  useEffect(() => { setManual(item.manualPct ?? ""); setInputs(item.inputs || {}); setNotes(item.notes || ""); setOwner(item.owner); }, [item.updatedAt, item.owner]);   // eslint-disable-line react-hooks/exhaustive-deps
  const loadEv = () => api(`/evidence?item=${item.key}`).then(r => setEv(r.evidence), e => toast(e.message));
  useEffect(() => { if (open && ev === null) loadEv(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = String(manual) !== String(item.manualPct ?? "") || JSON.stringify(inputs) !== JSON.stringify(item.inputs || {}) || notes !== (item.notes || "") || owner !== item.owner;
  const ro = !item.canEdit;
  const setIn = (k, v) => setInputs(x => ({ ...x, [k]: v }));
  async function save() {
    try { await api(`/items/${item.key}`, { manualPct: manual === "" ? null : Number(manual), inputs, notes, owner }); toast("Saved"); onSaved(); } catch (e) { toast(e.message); }
  }
  async function upload(f) {
    if (!f) return;
    try { await api("/evidence", { itemKey: item.key, title: upTitle || f.name, docDate: upDate || null, name: f.name, dataUrl: await readFile(f) });
      setUpTitle(""); setUpDate(""); if (fileRef.current) fileRef.current.value = ""; toast("Evidence added"); loadEv(); onSaved(); } catch (e) { toast(e.message); }
  }
  async function removeEv(e) {
    if (!window.confirm(`Remove "${e.title}"?`)) return;
    try { await api(`/evidence/${e.id}/remove`, {}); loadEv(); onSaved(); } catch (x) { toast(x.message); }
  }
  const num = (k, lbl, suffix = "%") => <label style={{ ...label, display: "inline-block", marginRight: 12 }}>{lbl}
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><input aria-label={lbl} type="number" min="0" max="100" step="0.1" disabled={ro} style={{ ...inputStyle, width: 110, margin: 0 }}
      value={inputs[k] ?? ""} onChange={e => setIn(k, e.target.value)} />{suffix}</span></label>;
  const flag = (k, lbl) => <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, margin: "4px 0" }}>
    <input type="checkbox" disabled={ro} checked={!!inputs[k]} onChange={e => setIn(k, e.target.checked)} />{lbl}</label>;
  const check = (obj, k, lbl) => <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, margin: "4px 0" }}>
    <input type="checkbox" disabled={ro} checked={!!(inputs[obj] || {})[k]} onChange={e => setIn(obj, { ...(inputs[obj] || {}), [k]: e.target.checked })} />{lbl}</label>;
  const p = item.pct;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 8, background: "#fff" }} data-item={item.key}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${item.code} ${item.title}`}
        style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) minmax(110px, 180px)", gap: 10, alignItems: "center", width: "100%", textAlign: "left",
          background: "none", border: "none", padding: "10px 12px", cursor: "pointer", font: "inherit", color: C.ink }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700, marginRight: 6 }}>{item.code}</span><b style={{ fontSize: 14 }}>{item.title}</b>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <Badge>{item.owner}</Badge><Badge color={item.method === "manual" || item.method === "last grading" ? C.soft : C.series} bg={item.method === "manual" ? "#EEF1F5" : item.method === "last grading" ? "#F3EEDF" : "#E3EEFB"}>{item.method === "manual" ? "estimate" : item.method}</Badge>
            {item.evidence > 0 && <Badge><Paperclip size={10} /> {item.evidence}</Badge>}
            {item.warn.length > 0 && <Badge color={C.warn} bg="#FFF4E0">needs attention</Badge>}
            {item.last && item.last.earned !== null && <Badge color={C.soft}>{`2025: ${pts(item.last.earned)}`}</Badge>}
          </span>
        </span>
        <span>
          <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontVariantNumeric: "tabular-nums" }}><b>{pts(item.credit)}</b><span style={{ color: C.muted }}>of {pts(item.max)}</span></span>
          <Bar value={item.credit} max={item.max} color={tone(p)} />
          <span style={{ fontSize: 11.5, color: C.soft }}>{p === null ? "not estimated" : `${dec(p * 100)}%`}</span>
        </span>
      </button>
      {open && <div style={{ padding: "0 14px 14px 40px", fontSize: 13.5 }}>
        {item.help && <p style={{ margin: "0 0 8px", color: C.soft, fontSize: 13 }}><HelpCircle size={13} style={{ verticalAlign: -2 }} /> {item.help}</p>}
        {item.last && <div style={{ background: "#FAF7EE", border: "1px solid #E6DDC4", borderRadius: 8, padding: "8px 10px", margin: "0 0 10px", fontSize: 13 }} role="note" aria-label="Last PIAL grading">
          <b>PIAL grading, {fmtDay(data.settings.baseline?.date)}:</b> {item.last.earned !== null ? `${pts(item.last.earned)} of ${pts(item.max)} points` : ""}{item.last.raw ? ` (PIAL's figures: ${item.last.raw})` : ""}
          {item.last.rec && <div style={{ marginTop: 4 }}><i>PIAL:</i> {item.last.rec}</div>}</div>}
        {item.detail.map((d, i) => <div key={i} style={{ color: C.ink, margin: "2px 0" }}>• {d}</div>)}
        {item.warn.map((w, i) => <div key={i} style={{ color: C.warn, margin: "2px 0" }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {w}</div>)}
        <div style={{ marginTop: 10 }}>
          {item.kind === "features" && <fieldset style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}><legend style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>PSAP features</legend>
            {data.features.map(([k, l, w]) => check("features", k, `${l} (${w})`))}</fieldset>}
          {item.kind === "answer" && <div>{num("p15", "Answered within 15 s")}{num("p40", "Answered within 40 s")}</div>}
          {item.kind === "processing" && item.method !== "CAD" && <div>{num("p64", "Processed within 64 s")}{num("p106", "Processed within 106 s")}</div>}
          {item.kind === "epss" && <div>{num("coverage", "Required sites with a generator")}</div>}
          {item.kind === "apparatus" && <div>{num("adequacy", "Companies and response vs. what PIAL says is needed")}</div>}
          {item.kind === "t_facility" && <fieldset style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}><legend style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>Facilities used during the graded year (NFPA 1402)</legend>
            {check("facilities", "fireBuilding", "Fire building with smoke room (1.53)")}{check("facilities", "tower", "Drill tower, 3+ stories (0.90)")}{check("facilities", "acres2", "Training area, 2+ acres (0.72)")}</fieldset>}
          {item.kind === "t_preplan" && <div>{num("commercial", "Commercial buildings in the district", "")}{num("planned", "Pre-planned", "")}</div>}
          {(item.kind === "hydrant_inspect" || item.kind === "hydrant_flow") && <fieldset style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>Program</legend>
            {item.kind === "hydrant_inspect" ? <>{flag("flushing", "Inspections include flushing (+10)")}{flag("pressureTest", "Inspections include a pressure test (+10)")}{flag("dryHydrants", "Dry hydrants / suction points drafted and back-flushed (+20)")}</>
              : flag("marking", "Hydrant marking program, NFPA 291 / AWWA M17 (+25%)")}
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, margin: "4px 0" }}><input type="checkbox" disabled={ro} checked={inputs.complete !== false} onChange={e => setIn("complete", e.target.checked)} /> Complete records for every hydrant (otherwise −25%)</label>
          </fieldset>}
          {item.kind === "inspections" && <div style={{ fontSize: 13, marginBottom: 10 }}>Calculated from the inspection report in Fire Prevention.{" "}
            <button type="button" style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: "fireprev" } }))}>Open Fire Prevention</button></div>}
          {item.kind === "hydrant_bonus" && <fieldset style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", marginBottom: 10 }}>
            <legend style={{ fontSize: 12, fontWeight: 700, color: C.soft }}>Requirements (all needed)</legend>
            {flag("submitted", "Hydrant data submitted with (or before) the rating packet")}{flag("allFields", "All 7 fields: department, hydrant number, location, graded area, longitude, latitude, type")}
            {flag("coords", "Coordinates in decimal degrees with at least 5 decimal places")}{flag("count", "Hydrant count matches the packet (or the difference is documented)")}
          </fieldset>}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={label}>{item.method === "manual" ? "Estimate (% of the item's points)" : "Fallback estimate (used when there's no data)"}
              <input aria-label={`Estimate for ${item.code}`} type="number" min="0" max="100" disabled={ro} style={{ ...inputStyle, width: 120, margin: 0 }} value={manual} onChange={e => setManual(e.target.value)} placeholder="%" /></label>
            {data.me.manage && <label style={label}>Owner
              <select aria-label={`Owner of ${item.code}`} style={{ ...inputStyle, margin: 0 }} value={owner} onChange={e => setOwner(e.target.value)}>{data.divisions.map(d => <option key={d}>{d}</option>)}</select></label>}
          </div>
          <label style={label}>Notes (what's done, what's left, where the records are)
            <textarea aria-label={`Notes for ${item.code}`} disabled={ro} style={{ ...inputStyle, minHeight: 56 }} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {!ro && <button type="button" style={btn(dirty ? "primary" : "outline")} disabled={!dirty} onClick={save}><Save size={14} /> Save</button>}
          {ro && <div style={{ fontSize: 12.5, color: C.muted }}>Owned by {item.owner}. You can view it but not change it.</div>}
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Evidence on file</div>
          {ev === null ? <div style={{ color: C.soft }}>Loading…</div> : !ev.length ? <div style={{ color: C.soft, fontSize: 13 }}>Nothing attached yet.</div>
            : ev.map(e => <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${C.grid}` }}>
              <Paperclip size={13} color={C.soft} /><a href={`/api/pial/evidence/${e.id}`} target="_blank" rel="noreferrer" style={{ color: C.series, flex: 1 }}>{e.title}</a>
              <span style={{ fontSize: 12, color: C.soft }}>{e.doc_date ? fmtDay(e.doc_date) : ""} · {Math.ceil(e.size / 1024)} KB · {e.by || ""}</span>
              {!ro && <button type="button" aria-label={`Remove ${e.title}`} style={{ ...btn("ghost"), padding: "2px 6px", color: C.bad }} onClick={() => removeEv(e)}><Trash2 size={13} /></button>}</div>)}
          {!ro && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <input aria-label="Evidence title" style={{ ...inputStyle, margin: 0, flex: "1 1 200px" }} placeholder="Title (e.g. 2026 pump test E61)" value={upTitle} onChange={e => setUpTitle(e.target.value)} />
            <input aria-label="Evidence date" type="date" style={{ ...inputStyle, margin: 0, width: 160 }} value={upDate} onChange={e => setUpDate(e.target.value)} />
            <input ref={fileRef} aria-label="Evidence file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" onChange={e => upload(e.target.files[0])} style={{ fontSize: 12.5 }} />
          </div>}
        </div>
      </div>}
    </div>
  );
}
function SectionPage({ data, sec, reload, toast }) {
  const [open, setOpen] = useState(null);
  const items = data.items.filter(i => i.section === sec);
  const groups = [...new Set(items.map(i => i.group))];
  const s = data.sections.find(x => x.key === sec);
  return <>
    <div style={{ ...cardStyle, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <div><div style={{ fontSize: 12, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>Estimated credit</div>
        <div style={{ fontSize: 30, fontWeight: 800 }}>{pts(s.credit)} <span style={{ fontSize: 15, color: C.muted }}>of {s.max}</span></div></div>
      <div style={{ flex: "1 1 240px" }}><Bar value={s.credit} max={s.max} height={12} color={tone(s.credit / s.max)} /></div>
      {sec === "fd" && <div style={{ fontSize: 12.5, color: C.soft }}>Training counted: {pts(data.training)} of 9 {data.trainingRaw > 9 ? `(${pts(data.trainingRaw)} earned, capped)` : ""}</div>}
      {sec === "crr" && <div style={{ fontSize: 12.5, color: C.soft, maxWidth: 420 }}>Only for a fire prevention bureau authorized by the State Fire Marshal. Documentation goes to PIAL with the questionnaire; it can't be added at the field visit.</div>}
    </div>
    {groups.map(g => {
      const list = items.filter(i => i.group === g);
      return <section key={g} style={{ marginBottom: 16 }} aria-label={g}>
        <div style={{ display: "flex", justifyContent: "space-between", margin: "6px 2px 6px" }}><b style={{ fontSize: 14.5 }}>{g}</b>
          <span style={{ fontSize: 12.5, color: C.soft }}>{pts(list.reduce((a, i) => a + i.credit, 0))} of {pts(list.reduce((a, i) => a + i.max, 0))}</span></div>
        {list.map(i => <ItemCard key={i.key} item={i} data={data} onSaved={reload} toast={toast} open={open === i.key} onToggle={() => setOpen(o => (o === i.key ? null : i.key))} />)}
      </section>;
    })}
  </>;
}

// ---- Scorecard --------------------------------------------------------------------------------------
function Scorecard({ data, go }) {
  const [all, setAll] = useState({});
  const bl = data.settings.baseline || {};
  const attention = data.items.filter(i => i.pct === null || i.pct < 0.7 || i.warn.length).sort((a, b) => (b.max - b.credit) - (a.max - a.credit));
  const byOwner = {};
  for (const i of attention) (byOwner[i.owner] = byOwner[i.owner] || []).push(i);
  const gap = data.items.reduce((a, i) => a + (i.max - i.credit), 0);
  const nextClass = data.cls > 1 ? (11 - data.cls) * 10 : null;
  const lost = data.items.filter(i => i.last && i.last.earned !== null && i.max - i.last.earned > 0.004 && !i.group.startsWith("581"))
    .map(i => ({ ...i, lostPts: i.max - i.last.earned, worth: (i.max - i.last.earned) * (data.pointValue[i.section] || 1) }))
    .sort((a, b) => b.worth - a.worth);
  const deadline = bl.improvementDeadline;
  const daysLeft = deadline ? Math.ceil((new Date(deadline + "T23:59:59") - new Date()) / 86400000) : null;
  return <>
    {deadline && daysLeft >= 0 && <div role="note" style={{ ...cardStyle, borderLeft: `4px solid ${C.warn}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
      <AlertTriangle size={18} color={C.warn} style={{ flex: "0 0 auto", marginTop: 2 }} />
      <div style={{ fontSize: 13.5 }}><b>Improvement window closes {fmtDay(deadline)} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left).</b> PIAL's letter of {fmtDay(bl.letterDate)}: within 6 months, only tangible improvements
        (equipment purchases, more water shuttle capacity…) can change the class without a new survey. Gaps in record-based areas (response, testing, training) wait for the next grading.</div>
    </div>}
    {data.sources && <details style={{ ...cardStyle, padding: "10px 14px" }} aria-label="Where the numbers come from">
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 14 }}>Where the numbers come from: {data.sources.filter(x => x.on).length} of {data.sources.length} {PN} sources feeding the score</summary>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>{data.sources.map(x => (
        <div key={x.key} style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "baseline" }}>
          <span style={{ color: x.on ? C.good : C.soft, fontWeight: 800 }}>{x.on ? "●" : "○"}</span>
          <div><b>{x.label}</b> → {x.feeds}<div style={{ color: C.soft, fontSize: 12.5 }}>{x.status}</div></div></div>))}</div>
    </details>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 14, marginBottom: 14 }}>
      <section style={{ ...cardStyle, margin: 0 }} aria-label="Estimated score">
        <div style={{ fontSize: 12, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>Estimated score · graded year {data.year.year}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, margin: "6px 0" }}>
          <span style={{ fontSize: 46, fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{pts(data.score)}</span>
          <span style={{ fontSize: 22, fontWeight: 800, color: data.cls <= 1 ? C.good : data.cls <= 3 ? C.warn : C.bad }}>Class {data.cls}</span>
        </div>
        <div style={{ fontSize: 12.5, color: C.soft }}>{data.project ? `Training projected for the full year at the current pace (${Math.round(data.year.elapsed * 100)}% of the year gone).` : "Actual records for the graded year."}
          {nextClass !== null ? ` ${pts(nextClass - data.score)} more points for Class ${data.cls - 1}.` : " Class 1 needs 90+."}</div>
        {bl.score !== null && bl.score !== undefined && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 6 }}>Last PIAL grading{bl.date ? ` (${fmtDay(bl.date)})` : ""}: <b>{pts(bl.score)}</b>{bl.cls ? `, Class ${bl.cls}` : ""}.</div>}
        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>An estimate to steer the work: PIAL's field visit decides the grade.</div>
      </section>
      <section style={{ ...cardStyle, margin: 0 }} aria-label="Sections">
        {data.sections.map(s => { const Icon = SEC_ICON[s.key]; const b = bl[s.key]; return (
          <button key={s.key} type="button" onClick={() => go(s.key)} style={{ display: "block", width: "100%", background: "none", border: "none", padding: "6px 0", textAlign: "left", cursor: "pointer", font: "inherit", color: C.ink }}>
            <span style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span><Icon size={14} style={{ verticalAlign: -2 }} /> <b>{s.title}</b></span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}><b>{pts(s.credit)}</b> / {s.max}{b !== null && b !== undefined ? <span style={{ color: C.muted }}> (last {pts(b)})</span> : ""}</span></span>
            <Bar value={s.credit} max={s.max} color={tone(s.credit / s.max)} />
          </button>); })}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, paddingTop: 6, borderTop: `1px solid ${C.grid}`, marginTop: 4 }}>
          <span title="Half the gap between 80% of the Fire Department score and the Water Supply score">Divergence (FD vs water)</span><b>−{pts(data.divergence)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, paddingTop: 4 }}><span>Hydrant data bonus (Louisiana)</span><b>+{pts(data.bonus)}{bl.bonus !== undefined ? <span style={{ color: C.muted, fontWeight: 400 }}> (last {pts(bl.bonus)})</span> : null}</b></div>
        <div style={{ fontSize: 12.5, color: C.soft, marginTop: 8, borderTop: `1px solid ${C.grid}`, paddingTop: 6 }}>
          <b>What one more point is worth:</b> Fire Department ×{data.pointValue.fd}, Water Supply ×{data.pointValue.water}, Communications and Risk Reduction ×1.
          {data.waterAhead ? " Water supply is ahead of the fire department, so divergence shrinks as the fire department improves." : " The fire department is ahead of water supply, so divergence shrinks as water supply improves."}</div>
      </section>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 14, marginBottom: 14, alignItems: "start" }}>
      <section style={{ ...cardStyle, margin: 0 }} aria-label="Minimum criteria">
        <H sub="All of these are needed for any class better than 10 (FSRS 107 + Louisiana Addendum)">Minimum criteria</H>
        {data.minimum.map(m => { const Icon = m.ok === true ? CheckCircle2 : AlertTriangle; return (
          <div key={m.key} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.grid}`, fontSize: 13.5 }}>
            <Icon size={16} color={m.ok === true ? C.good : m.ok === false ? C.bad : C.warn} style={{ flex: "0 0 auto", marginTop: 1 }} aria-label={m.ok === true ? "met" : m.ok === false ? "not met" : "not confirmed"} />
            <span>{m.label}{m.detail && <span style={{ display: "block", color: C.soft, fontSize: 12.5 }}>{m.detail}</span>}
              {m.ok === null && <span style={{ display: "block", color: C.muted, fontSize: 12 }}>Not confirmed yet (Settings).</span>}</span></div>); })}
      </section>
      <section style={{ ...cardStyle, margin: 0 }} aria-label="Records due">
        <H sub="Tests and reviews by due date" right={<button type="button" style={btn("ghost")} onClick={() => go("records")}>All records</button>}>Due and overdue</H>
        {data.due.slice(0, 12).map((d, i) => <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.grid}`, fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, flex: "0 0 auto", background: d.overdue ? C.bad : C.good }} aria-hidden="true" />
          <span style={{ flex: 1 }}><b>{d.label}</b>{d.subject ? ` · ${d.subject}` : ""}</span>
          <span style={{ color: d.overdue ? C.bad : C.soft, whiteSpace: "nowrap" }}>{d.due ? `${d.overdue ? "overdue since" : "due"} ${fmtDay(d.due)}` : "no record"}</span></div>)}
        {!data.due.length && <div style={{ color: C.soft, fontSize: 13 }}>Nothing recorded yet.</div>}
      </section>
    </div>
    {lost.length > 0 && <section style={{ ...cardStyle }} aria-label="Where the last grading lost points">
      <H sub={`From PIAL's ${fmtDay(bl.date)} grading, ranked by what the missing points are worth to the total today (point values above). Training isn't listed: the IFSAC bonus already fills its 9 points.`}>Where the last grading lost points</H>
      {lost.slice(0, 10).map(i => <button key={i.key} type="button" onClick={() => go(i.section, i.key)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px", gap: 10, width: "100%", textAlign: "left",
        background: "none", border: "none", borderBottom: `1px solid ${C.grid}`, padding: "7px 0", cursor: "pointer", font: "inherit", color: C.ink }}>
        <span><span style={{ color: C.muted, fontSize: 12 }}>{i.code}</span> <b>{i.title}</b> <span style={{ color: C.soft, fontSize: 12.5 }}>· {i.owner}</span>
          {i.last.rec && <span style={{ display: "block", fontSize: 12.5, color: C.soft }}>{i.last.rec.length > 220 ? i.last.rec.slice(0, 220) + "…" : i.last.rec}</span>}</span>
        <span style={{ textAlign: "right", fontSize: 12.5 }}><b>+{pts(i.worth)}</b> to total<span style={{ display: "block", color: C.muted }}>{pts(i.lostPts)} pts missed</span></span>
      </button>)}
    </section>}
    <section style={{ ...cardStyle }} aria-label="Needs attention">
      <H sub={`Items under 70%, not estimated yet, or with a warning, by owner. ${pts(gap)} points are on the table across all items.`}>Needs attention</H>
      {Object.entries(byOwner).sort().map(([o, list]) => <div key={o} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.soft, textTransform: "uppercase", margin: "6px 0" }}>{o}</div>
        {(all[o] ? list : list.slice(0, 5)).map(i => <button key={i.key} type="button" onClick={() => go(i.section, i.key)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 140px", gap: 10, width: "100%", textAlign: "left",
          background: "none", border: "none", borderBottom: `1px solid ${C.grid}`, padding: "6px 0", cursor: "pointer", font: "inherit", color: C.ink }}>
          <span><span style={{ color: C.muted, fontSize: 12 }}>{i.code}</span> {i.title}{i.warn[0] && <span style={{ display: "block", fontSize: 12, color: C.warn }}>{i.warn[0]}</span>}</span>
          <span style={{ fontSize: 12.5, textAlign: "right" }}>{i.pct === null ? "not estimated" : `${pts(i.credit)} / ${pts(i.max)}`}<Bar value={i.credit} max={i.max} color={tone(i.pct)} height={5} /></span>
        </button>)}
        {list.length > 5 && <button type="button" style={{ ...btn("ghost"), padding: "4px 0", fontSize: 12.5 }} onClick={() => setAll(x => ({ ...x, [o]: !x[o] }))}>{all[o] ? "Show fewer" : `Show all ${list.length}`}</button>}
      </div>)}
      {!attention.length && <div style={{ color: C.good }}>Everything is at 70% or better.</div>}
    </section>
  </>;
}

// ---- Training ---------------------------------------------------------------------------------------
function Training({ data, toast, reload }) {
  const [t, setT] = useState(null);
  const load = () => api("/training").then(setT, e => toast(e.message));
  useEffect(() => { load(); }, [data.items]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <div style={cardStyle}>Loading…</div>;
  const tg = t.targets, e = t.year.elapsed;
  const due = h => (t.project ? h * e : h);
  const flag = (v, target) => <span style={{ color: v >= due(target) ? C.ink : C.bad }}>{dec(v)}</span>;
  const cols = [
    { key: "name", label: "Member" }, { key: "rank", label: "Rank" },
    { key: "companyCredited", label: `Company (${tg.company})`, align: "right", fmt: (v, r) => <span title={`in-house ${r.company}, CBT ${r.cbt}, outside ${r.outside}`}>{flag(v, tg.company)}</span>, csv: v => v },
    { key: "facility", label: `At facility (${tg.facility})`, align: "right", fmt: v => flag(v, tg.facility), csv: v => v },
    { key: "officerHrs", label: `Officer (${tg.officerCe})`, align: "right", fmt: (v, r) => (r.officer ? flag(v, tg.officerCe) : <span style={{ color: C.muted }}>{dec(v)}</span>), csv: v => v },
    { key: "driverHrs", label: `Driver (${tg.driver})`, align: "right", fmt: (v, r) => (r.driver ? flag(v, tg.driver) : <span style={{ color: C.muted }}>{dec(v)}</span>), csv: v => v },
    { key: "hazmat", label: `HazMat (${tg.hazmat})`, align: "right", fmt: v => flag(v, tg.hazmat), csv: v => v },
    { key: "total", label: "Total creditable", align: "right", fmt: (v, r) => <b style={{ color: r.meetsMinimum ? C.ink : C.bad }}>{dec(v)}</b>, csv: v => v },
    { key: "ifsac", label: "IFSAC", fmt: v => (v ? "yes" : ""), csv: v => (v ? "yes" : "") },
  ];
  async function map(source, category) { try { await api("/categories", { source, category }); toast("Category saved"); load(); reload(); } catch (x) { toast(x.message); } }
  return <>
    <section style={cardStyle} aria-label="Training summary">
      <H sub={`${t.rows.length} members on the roster for ${t.year.year}. ${t.project ? `${Math.round(e * 100)}% of the year gone: red means behind pace (target × ${Math.round(e * 100)}%).` : "Red means under the yearly target."} Targets are the 2012 FSRS defaults (Settings).`}
        right={<button type="button" style={btn("outline")} onClick={() => downloadCsv(`PIAL training summary ${t.year.year}`, cols, t.rows)}><Download size={14} /> CSV</button>}>Training summary worksheet</H>
      {t.unknownCount > 0 && <div style={{ color: C.warn, fontSize: 13, marginBottom: 8 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {t.unknownCount} name(s) in the training records aren't on the roster: {t.unknownMembers.slice(0, 8).join(", ")}{t.unknownCount > 8 ? "…" : ""}</div>}
      <DataTable columns={cols} rows={t.rows.map(r => ({ ...r, _key: r.key }))} maxHeight={520} label="Training by member" initialSort={{ key: "name", dir: 1 }} />
    </section>
    <section style={cardStyle} aria-label="Training categories">
      <H sub="How each category or course type in the FireWorks report counts toward PIAL. New ones are guessed when imported; correct any that are wrong.">Training categories</H>
      <DataTable sortable={false} rows={t.categories.map(c => ({ ...c, _key: c.source }))} label="Category mapping" columns={[
        { key: "source", label: "From FireWorks" }, { key: "n", label: "Rows", align: "right", fmt: int }, { key: "hours", label: "Hours", align: "right", fmt: dec },
        { key: "category", label: "Counts as", render: c => t.canMap ? <select aria-label={`Category for ${c.source}`} style={{ ...inputStyle, margin: 0, padding: "4px 8px" }} value={c.category} onChange={e => map(c.source, e.target.value)}>
          {data.categories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : data.categories.find(([k]) => k === c.category)?.[1], csv: v => v }]} />
    </section>
  </>;
}

// ---- Apparatus --------------------------------------------------------------------------------------
function Apparatus({ data, toast, reload }) {
  const [a, setA] = useState(null), [edit, setEdit] = useState(null);
  const load = () => api("/apparatus").then(setA, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <div style={cardStyle}>Loading…</div>;
  const typeName = k => a.types.find(([t]) => t === k)?.[1] || k;
  async function save() {
    try { await api("/apparatus", edit); toast("Saved"); setEdit(null); load(); reload(); } catch (e) { toast(e.message); }
  }
  async function remove(u) { if (!window.confirm(`Remove ${u.unit}?`)) return; try { await api(`/apparatus/${u.id}/remove`, {}); setEdit(null); load(); reload(); } catch (e) { toast(e.message); } }
  if (edit) {
    const eq = a.equipment[edit.type];
    const f = (k, l, type = "text", w = 140) => <label style={{ ...label, display: "inline-block", marginRight: 10 }}>{l}<input aria-label={l} type={type} style={{ ...inputStyle, width: w, margin: 0 }} value={edit[k] ?? ""} onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} /></label>;
    return <section style={cardStyle} aria-label="Edit apparatus">
      <H>{edit.id ? `Edit ${edit.unit}` : "Add apparatus"}</H>
      {f("unit", "Unit (e.g. E61)", "text", 120)}
      <label style={{ ...label, display: "inline-block", marginRight: 10 }}>Type<select aria-label="Type" style={{ ...inputStyle, margin: 0 }} value={edit.type} onChange={e => setEdit(x => ({ ...x, type: e.target.value }))}>{a.types.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {f("station", "Station", "text", 100)}{f("make", "Make")}{f("year", "Year", "number", 90)}
      {["engine", "reserve_engine", "tanker", "ladder", "reserve_ladder"].includes(edit.type) && <>{f("pumpGpm", "Pump (gpm)", "number", 110)}{f("tankGal", "Tank (gal)", "number", 110)}</>}
      {["ladder", "reserve_ladder"].includes(edit.type) && f("aerialFt", "Aerial reach (ft)", "number", 110)}
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginBottom: 10 }}><input type="checkbox" checked={edit.inService !== false} onChange={e => setEdit(x => ({ ...x, inService: e.target.checked }))} /> In service</label>
      {eq && <><div style={{ fontSize: 13.5, fontWeight: 800, margin: "8px 0" }}>Equipment carried (PIAL apparatus inventory)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 330px), 1fr))", gap: "4px 18px" }}>
          {eq.items.filter(([k, , , req, how]) => req !== null && k !== "tank").map(([k, l, p, req, unit]) => <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0", borderBottom: `1px solid ${C.grid}` }}>
            <input aria-label={l} type="number" min="0" style={{ ...inputStyle, width: 74, margin: 0, padding: "4px 6px" }} value={edit.inventory?.[k] ?? ""} onChange={e => setEdit(x => ({ ...x, inventory: { ...(x.inventory || {}), [k]: e.target.value } }))} />
            <span style={{ flex: 1 }}>{l} <span style={{ color: C.muted }}>need {req}{unit ? ` ${unit}` : ""} · {p} pts</span></span></label>)}
        </div><div style={{ fontSize: 12, color: C.soft, marginTop: 6 }}>Tank, pump test, hose test and aerial test credit come from the fields above and Testing & reviews.</div></>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" style={btn("primary")} onClick={save}><Save size={14} /> Save</button>
        <button type="button" style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
        {edit.id && <button type="button" style={{ ...btn("ghost"), color: C.bad, marginLeft: "auto" }} onClick={() => remove(edit)}><Trash2 size={14} /> Remove</button>}
      </div>
    </section>;
  }
  return <section style={cardStyle} aria-label="Apparatus">
    <H sub="Every engine, ladder and service company (and reserves). Equipment % uses PIAL's relative points (engine 600, service 356, ladder 772)."
      right={a.canEdit && <button type="button" style={btn("primary")} onClick={() => setEdit({ unit: "", type: "engine", inService: true, inventory: {} })}><Plus size={14} /> Add apparatus</button>}>Stations & equipment</H>
    {!a.apparatus.length ? <div style={{ color: C.soft }}>No apparatus yet.</div> : a.apparatus.map(u => <div key={u.id} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Truck size={18} color={C.series} /><b style={{ fontSize: 15 }}>{u.unit}</b><span style={{ color: C.soft, fontSize: 13 }}>{typeName(u.type)}{u.station ? ` · Station ${u.station}` : ""}{u.year ? ` · ${u.year}` : ""}{u.pump_gpm ? ` · ${u.pump_gpm} gpm` : ""}{u.tank_gal ? ` · ${u.tank_gal} gal` : ""}{u.aerial_ft ? ` · ${u.aerial_ft}'` : ""}</span>
        {!u.in_service && <Badge>not in service</Badge>}
        <span style={{ marginLeft: "auto", minWidth: 160 }}>{u.equipment ? <><span style={{ fontSize: 12.5 }}><b>{dec(u.equipment.pct * 100)}%</b> equipment</span><Bar value={u.equipment.pct} max={1} color={tone(u.equipment.pct)} /></> : <span style={{ fontSize: 12.5, color: C.muted }}>not graded</span>}</span>
        {a.canEdit && <button type="button" style={btn("outline")} aria-label={`Edit ${u.unit}`} onClick={() => setEdit({ id: u.id, unit: u.unit, type: u.type, station: u.station, make: u.make, year: u.year ?? "", pumpGpm: u.pump_gpm ?? "", tankGal: u.tank_gal ?? "", aerialFt: u.aerial_ft ?? "", inService: u.in_service, inventory: u.inventory || {} })}>Edit</button>}
      </div>
      {u.equipment && u.equipment.lines.some(l => l.frac < 1) && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 6 }}>Short: {u.equipment.lines.filter(l => l.frac < 1).map(l => `${l.label.split(" (")[0]}${l.note ? ` (${l.note})` : ""}`).join("; ")}</div>}
    </div>)}
  </section>;
}

// ---- Testing & reviews ------------------------------------------------------------------------------
function Records({ data, toast, reload }) {
  const [t, setT] = useState(null);
  const [f, setF] = useState({ kind: "pump", subject: "", date: "", passed: true, notes: "" });
  const [kindFilter, setKindFilter] = useState("");
  const load = () => api("/tests").then(setT, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <div style={cardStyle}>Loading…</div>;
  const kinds = Object.entries(t.kinds);
  async function add() {
    try { await api("/tests", f); toast("Recorded"); setF(x => ({ ...x, subject: x.kind === "sop" ? x.subject : "", date: "", notes: "", passed: true })); load(); reload(); } catch (e) { toast(e.message); }
  }
  async function remove(x) { if (!window.confirm("Delete this record?")) return; try { await api(`/tests/${x.id}/remove`, {}); load(); reload(); } catch (e) { toast(e.message); } }
  const subjHint = { pump: "Unit, e.g. E61", aerial: "Unit, e.g. L61", hose: "e.g. All hose", hydrant_inspection: "e.g. Annual inspection cycle", hydrant_flow: "e.g. Flow test cycle", preplan: "e.g. Annual pre-plan cycle", epss: "Site, e.g. Station 61 generator" };
  const shown = t.tests.filter(x => !kindFilter || x.kind === kindFilter);
  return <>
    {t.canEdit[f.kind] !== undefined && Object.values(t.canEdit).some(Boolean) && <section style={cardStyle} aria-label="Record a test or review">
      <H sub="PIAL credits the average interval between the 3 most recent passed tests, rounded up to whole years.">Record a test or review</H>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={label}>Type<select aria-label="Record type" style={{ ...inputStyle, margin: 0 }} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value, subject: e.target.value === "sop" ? t.sops[0] : "" }))}>
          {kinds.filter(([k]) => t.canEdit[k]).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label style={label}>{f.kind === "sop" ? "SOP" : "Subject"}{f.kind === "sop" ? <select aria-label="SOP" style={{ ...inputStyle, margin: 0 }} value={f.subject} onChange={e => setF(x => ({ ...x, subject: e.target.value }))}>{t.sops.map(s => <option key={s}>{s}</option>)}</select>
          : <input aria-label="Subject" style={{ ...inputStyle, margin: 0, width: 200 }} placeholder={subjHint[f.kind]} value={f.subject} onChange={e => setF(x => ({ ...x, subject: e.target.value }))} />}</label>
        <label style={label}>Date<input aria-label="Record date" type="date" style={{ ...inputStyle, margin: 0 }} value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></label>
        <label style={{ ...label, display: "flex", gap: 6, alignItems: "center", marginBottom: 18 }}><input type="checkbox" checked={f.passed} onChange={e => setF(x => ({ ...x, passed: e.target.checked }))} /> Passed / complete</label>
        <label style={{ ...label, flex: "1 1 180px" }}>Notes<input aria-label="Record notes" style={{ ...inputStyle, margin: 0 }} value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} /></label>
        <button type="button" style={{ ...btn("primary"), marginBottom: 10 }} disabled={!f.date} onClick={add}><Plus size={14} /> Record</button>
      </div>
    </section>}
    <section style={cardStyle} aria-label="SOP reviews">
      <H sub="Each SOP is worth 0.1 when dated within the graded year and the 4 years before it.">Standard operating procedures</H>
      <DataTable sortable={false} label="SOP reviews" rows={t.sops.map(s => { const last = t.tests.filter(x => x.kind === "sop" && x.subject === s).map(x => x.date).sort().pop(); return { _key: s, sop: s, last: last || null, ok: !!last && last >= `${data.year.year - 4}-01-01` }; })}
        columns={[{ key: "sop", label: "SOP" }, { key: "last", label: "Last reviewed", fmt: fmtDay }, { key: "ok", label: "Counts", render: r => (r.ok ? <span style={{ color: C.good }}>yes</span> : <span style={{ color: C.bad }}>needs review</span>), csv: v => (v ? "yes" : "no") }]} />
    </section>
    <section style={cardStyle} aria-label="All records">
      <H right={<select aria-label="Filter records" style={{ ...inputStyle, margin: 0, width: 220 }} value={kindFilter} onChange={e => setKindFilter(e.target.value)}><option value="">All types</option>{kinds.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}>Test and review history</H>
      <DataTable label="Records" rows={shown.map(x => ({ ...x, _key: x.id }))} maxHeight={480} columns={[
        { key: "date", label: "Date", fmt: fmtDay, csv: v => v }, { key: "kind", label: "Type", fmt: v => t.kinds[v]?.label || v }, { key: "subject", label: "Subject" },
        { key: "passed", label: "Result", fmt: v => (v ? "passed" : <span style={{ color: C.bad }}>failed</span>), csv: v => (v ? "passed" : "failed") }, { key: "notes", label: "Notes", wrap: true },
        { key: "id", label: "", render: x => (t.canEdit[x.kind] ? <button type="button" aria-label={`Delete record ${x.date}`} style={{ ...btn("ghost"), padding: "2px 6px", color: C.bad }} onClick={() => remove(x)}><Trash2 size={13} /></button> : null), csv: () => "" }]} />
    </section>
  </>;
}

// ---- Fires ------------------------------------------------------------------------------------------
function Fires({ toast }) {
  const [f, setF] = useState(null);
  useEffect(() => { api("/fires").then(setF, e => toast(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <div style={cardStyle}>Loading…</div>;
  const s = f.stats;
  const cols = [{ key: "date", label: "Date", fmt: fmtDay, csv: v => v }, { key: "time", label: "Time" }, { key: "incident", label: "Incident" }, { key: "type", label: "Comm/Res" },
    { key: "responders", label: "Responders", align: "right", fmt: v => (v === null ? "–" : dec(v)) }, { key: "first_engine_s", label: "First engine (s)", align: "right", fmt: v => (v === null ? "–" : <span style={{ color: v <= 320 ? C.ink : C.bad }}>{v}</span>), csv: v => v },
    { key: "full_s", label: "Full complement (s)", align: "right", fmt: v => (v === null ? "–" : <span style={{ color: v <= 560 ? C.ink : C.bad }}>{v}</span>), csv: v => v }];
  const secCell = lim => v => (v === null ? "–" : <span style={{ color: v <= lim ? C.ink : C.bad }}>{v}</span>);
  const cadCols = [{ key: "received", label: "Received", fmt: v => new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }), csv: v => v },
    { key: "incident", label: "Incident" }, { key: "nature", label: "Nature" }, { key: "units", label: "Units", fmt: v => v.join(" "), csv: v => v.join(" ") },
    { key: "firstEngineUnit", label: "First engine" }, { key: "first_engine_s", label: "First engine (s)", align: "right", fmt: secCell(320), csv: v => v },
    { key: "full_s", label: "Full complement (s)", align: "right", fmt: secCell(560), csv: v => v }, { key: "inReports", label: "In fire reports", fmt: v => (v ? "yes" : ""), csv: v => (v ? "yes" : "") }];
  const tile = (l, v, sub) => <div style={{ ...cardStyle, margin: 0, padding: "12px 14px" }}><div style={{ fontSize: 11.5, fontWeight: 800, color: C.soft, textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 26, fontWeight: 800 }}>{v}</div><div style={{ fontSize: 12.5, color: C.soft }}>{sub}</div></div>;
  return <>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
      {tile("Structure fire alarms", int(s.alarms), `${s.working} working · ${s.nonWorking} non-working`)}
      {tile("Avg responders, working fires", s.avgResponders === null ? "–" : dec(s.avgResponders), "minimum criteria: 4")}
      {tile("First engine ≤ 320 s", s.p320 === null ? "–" : pctTxt(s.p320), `${s.firstEngine} with times · standard 90%`)}
      {tile("Full complement ≤ 560 s", s.p560 === null ? "–" : pctTxt(s.p560), `${s.full} with times · standard 90%`)}
      {f.cad && !f.cad.error && tile("CAD: first unit ≤ 320 s", f.cad.p320 === null ? "–" : pctTxt(f.cad.p320), `${f.cad.structure} structure fire calls`)}
      {f.cadFire && !f.cadFire.error && tile("CAD: first engine ≤ 320 s", f.cadFire.p320 === null ? "–" : pctTxt(f.cadFire.p320), `${f.cadFire.firstEngine} of ${f.cadFire.incidents} structure fires with engine arrivals`)}
      {f.cadFire && !f.cadFire.error && tile("CAD: full complement ≤ 560 s", f.cadFire.p560 === null ? "–" : pctTxt(f.cadFire.p560), `${f.cadFire.full} fires · ${f.cadFire.fullRule}`)}
    </div>
    {f.cadFire && !f.cadFire.error && <section style={cardStyle} aria-label="Structure fires from CAD">
      <H sub={`Every ${f.cadFire.agency} call whose nature is a structure fire (Settings), with our units' arrivals from CAD. Seconds are from the first unit assigned. Fire reports, when imported, still decide working/non-working and responders, and are used first for 561.`}
        right={<button type="button" style={btn("outline")} onClick={() => downloadCsv("Structure fires from CAD", cadCols, f.cadFire.list)}><Download size={14} /> CSV</button>}>Structure fires from CAD ({f.cadFire.incidents})</H>
      <DataTable label="Structure fires from CAD" rows={f.cadFire.list.map(x => ({ ...x, _key: x.incident }))} columns={cadCols} maxHeight={420} />
    </section>}
    {f.cadFire?.error && <div style={{ ...cardStyle, color: C.bad }}>CAD structure fires: {f.cadFire.error}</div>}
    {[["Working fires worksheet", true], ["Non-working fires worksheet", false]].map(([title, w]) => { const rows = f.fires.filter(x => x.working === w); return (
      <section key={title} style={cardStyle} aria-label={title}>
        <H sub={w ? "Hose pulled and water used. PIAL asks for the 20 most recent in the graded year." : "Alarm activations, smells of smoke, out on arrival… PIAL asks for the 20 most recent."}
          right={<button type="button" style={btn("outline")} onClick={() => downloadCsv(title, cols, rows)}><Download size={14} /> CSV</button>}>{title}</H>
        <DataTable label={title} rows={rows.map(x => ({ ...x, _key: x.incident }))} columns={cols} maxHeight={420} />
      </section>); })}
  </>;
}

// ---- Imports ----------------------------------------------------------------------------------------
const readB64 = f => readFile(f).then(u => String(u).split(",")[1] || "");
function Imports({ toast, reload }) {
  const [d, setD] = useState(null), [prev, setPrev] = useState({});
  const [toStats, setToStats] = useState(false), [agency, setAgency] = useState("");
  const load = () => api("/imports").then(setD, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div style={cardStyle}>Loading…</div>;
  async function pick(kind, file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setPrev(x => ({ ...x, [kind]: { error: "That file is over 20 MB." } })); return; }
    setPrev(x => ({ ...x, [kind]: { reading: true } }));
    try { const data = await readB64(file); const p = await api(`/import/${kind}`, { fileName: file.name, data, preview: true }); setPrev(x => ({ ...x, [kind]: { ...p, file, data } })); }
    catch (e) { setPrev(x => ({ ...x, [kind]: { error: e.message } })); }
  }
  async function run(kind) {
    const p = prev[kind];
    try {
      const r = await api(`/import/${kind}`, { fileName: p.file.name, data: p.data, ...(kind === "alarms" && toStats ? { toStats: true, agency } : {}) });
      toast(`Imported ${r.rows} rows${r.skipped ? `, ${r.skipped} skipped` : ""}${r.stats ? `; ${r.stats.stored} calls added to Comms Statistics` : ""}`); setPrev(x => ({ ...x, [kind]: null })); load(); reload();
    }
    catch (e) { toast(e.message); }
  }
  return <>
    <section style={cardStyle}>
      <H sub="Export these from FireWorks (Ad-Hoc or custom reports) as Excel (.xlsx) or CSV and import them here; title lines above the column headings are fine. Column names are matched loosely (several common names work); extra columns are ignored. Leave out SSNs, home addresses and phone numbers.">FireWorks reports</H>
      {!d.canImport && <div style={{ color: C.warn, fontSize: 13 }}>Only PIAL managers can import.</div>}
    </section>
    {Object.entries(d.specs).map(([kind, s]) => { const p = prev[kind]; return (
      <section key={kind} style={cardStyle} aria-label={s.label}>
        <H sub={s.help} right={<button type="button" style={btn("ghost")} onClick={() => { const blob = new Blob([Object.values(s.columns).join(",") + "\r\n"], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `PIAL ${s.label} template.csv`; a.click(); }}><Download size={14} /> Template</button>}>{s.label}</H>
        <div style={{ fontSize: 12.5, color: C.soft, marginBottom: 8 }}>Columns: {Object.entries(s.columns).map(([f, c]) => <code key={f} style={{ marginRight: 8, color: s.need.flat().includes(f) ? C.ink : C.soft, fontWeight: s.need.flat().includes(f) ? 700 : 400 }}>{c}</code>)}<span style={{ color: C.muted }}>(bold = required)</span></div>
        {d.canImport && <input type="file" accept=".csv,.xlsx,.xlsm,text/csv" aria-label={`${s.label} file`} onChange={e => { const f = e.target.files[0]; e.target.value = ""; pick(kind, f); }} />}
        {p?.reading && <div style={{ fontSize: 13, color: C.soft, marginTop: 8 }}>Reading…</div>}
        {p?.error && <div role="alert" style={{ color: C.bad, fontSize: 13, marginTop: 8 }}>{p.error}</div>}
        {p && !p.error && !p.reading && <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 13.5 }}><b>{p.rows}</b> row(s) ready{p.skipped ? <>, <span style={{ color: C.warn }}>{p.skipped} with problems</span></> : ""}. Matched columns: {p.columns.join(", ")}.</div>
          {p.info && <div style={{ fontSize: 12.5, color: C.soft }}>{p.info}.</div>}
          {p.errors.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: C.warn }}>{e}</div>)}
          {kind === "training" && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 4 }}>Training rows between the first and last date in this file will be replaced.</div>}
          {kind === "roster" && <div style={{ fontSize: 12.5, color: C.soft, marginTop: 4 }}>The whole roster will be replaced.</div>}
          {kind === "alarms" && p.summary && <div style={{ fontSize: 13, marginTop: 6 }}>
            <div>{p.summary.from} to {p.summary.to}. Calls replaced between those dates.</div>
            <table style={{ borderCollapse: "collapse", fontSize: 13, marginTop: 6 }}><thead><tr style={{ color: C.soft, textAlign: "left" }}><th style={{ padding: "2px 10px 2px 0" }}>Measured</th><th style={{ padding: "2px 10px" }}>Calls</th><th style={{ padding: "2px 10px" }}>≤ 64 s</th><th style={{ padding: "2px 10px" }}>≤ 106 s</th></tr></thead>
              <tbody><tr><td style={{ padding: "2px 10px 2px 0" }}>Entered queue → alarm ("SG Processing")</td><td style={{ padding: "2px 10px" }}>{int(p.summary.queue.n)}</td><td style={{ padding: "2px 10px" }}>{pctTxt(p.summary.queue.p64)}</td><td style={{ padding: "2px 10px" }}>{pctTxt(p.summary.queue.p106)}</td></tr>
                <tr><td style={{ padding: "2px 10px 2px 0" }}>PSAP → alarm ("Total Processing")</td><td style={{ padding: "2px 10px" }}>{int(p.summary.total.n)}</td><td style={{ padding: "2px 10px" }}>{pctTxt(p.summary.total.p64)}</td><td style={{ padding: "2px 10px" }}>{pctTxt(p.summary.total.p106)}</td></tr></tbody></table>
            <div style={{ fontSize: 12.5, color: C.soft, marginTop: 4 }}>Which one counts for 420-A-2 is set in Settings (default: entered queue → alarm, which matches PIAL's last grading).</div>
            {d.canStats && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={toStats} onChange={e => setToStats(e.target.checked)} /> Also add these calls to Comms Statistics</label>
              {toStats && <input aria-label="Agency for Comms Statistics" list="pial-agencies" placeholder={`Agency (e.g. ${BRAND.short})`} style={{ ...inputStyle, width: 170, margin: 0 }} value={agency} onChange={e => setAgency(e.target.value)} />}
              <datalist id="pial-agencies">{(d.agencies || []).map(a => <option key={a.agency} value={a.agency} />)}</datalist>
            </div>}
          </div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button type="button" style={btn("primary")} disabled={!p.rows} onClick={() => run(kind)}><Upload size={14} /> Import {p.rows} rows</button>
            <button type="button" style={btn("ghost")} onClick={() => setPrev(x => ({ ...x, [kind]: null }))}>Cancel</button></div>
        </div>}
      </section>); })}
    <section style={cardStyle} aria-label="Import history">
      <H>Import history</H>
      <DataTable label="Import history" rows={d.history.map((h, i) => ({ ...h, _key: i }))} columns={[{ key: "at", label: "When", fmt: v => new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) },
        { key: "kind", label: "Report", fmt: v => d.specs[v]?.label || v }, { key: "file_name", label: "File" }, { key: "rows", label: "Rows", align: "right" }, { key: "skipped", label: "Skipped", align: "right" },
        { key: "notes", label: "Notes", wrap: true }, { key: "by_name", label: "By" }]} />
    </section>
  </>;
}

// ---- Settings ---------------------------------------------------------------------------------------
function Settings({ data, toast, reload }) {
  const s = data.settings;
  const [f, setF] = useState(() => ({ year: s.year, scoreMode: s.scoreMode, alarmMeasure: s.alarmMeasure, trainingSource: s.trainingSource || "pial", cadAgency: s.cadAgency, fireNatures: s.fireNatures, structureNatures: s.structureNatures,
    engineUnits: s.engineUnits, ladderUnits: s.ladderUnits, fullEngines: s.fullEngines, fullLadders: s.fullLadders,
    targets: { ...s.targets }, aerialRequiredFt: s.aerialRequiredFt, ppe: s.ppe ?? "", minimum: { ...s.minimum }, baseline: { ...s.baseline } }));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() { try { await api("/settings", f); toast("Settings saved"); reload(); } catch (e) { toast(e.message); } }
  const tgt = [["company", "Company training, hrs/member/yr"], ["facility", "At the training facility, hrs/member/yr"], ["officerCe", "Officer continuing ed, hrs/officer/yr"],
    ["driver", "Existing driver, hrs/driver/yr"], ["newDriver", "New driver program, hrs"], ["hazmat", "HazMat, hrs/member/yr"], ["recruit", "Recruit program, hrs"],
    ["minimum", "Minimum per member (personnel credit), hrs/yr"], ["ifsacCompany", "IFSAC bonus: in-house company hrs"], ["t64", "Alarm processing goal, % within 64 s"], ["t106", "Alarm processing goal, % within 106 s"]];
  const tri = (k, l) => <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, padding: "4px 0" }}>
    <select aria-label={l} style={{ ...inputStyle, margin: 0, width: 140 }} value={f.minimum[k] === true ? "yes" : f.minimum[k] === false ? "no" : ""} onChange={e => set("minimum", { ...f.minimum, [k]: e.target.value === "" ? null : e.target.value === "yes" })}>
      <option value="">not confirmed</option><option value="yes">met</option><option value="no">not met</option></select>{l}</label>;
  const bl = (k, l, type = "number", w = 110) => <label style={{ ...label, display: "inline-block", marginRight: 10 }}>{l}<input aria-label={`Last grading ${l}`} type={type} step="0.01" style={{ ...inputStyle, width: w, margin: 0 }} value={f.baseline[k] ?? ""} onChange={e => set("baseline", { ...f.baseline, [k]: e.target.value })} /></label>;
  return <>
    <section style={cardStyle} aria-label="Graded year">
      <H sub="PIAL grades a 12-month period, normally the prior calendar year.">Graded year</H>
      <label style={{ ...label, display: "inline-block", marginRight: 12 }}>Year<input aria-label="Graded year" type="number" style={{ ...inputStyle, width: 110, margin: 0 }} value={f.year} onChange={e => set("year", e.target.value)} /></label>
      <label style={{ ...label, display: "inline-block" }}>While the year is in progress<select aria-label="Score mode" style={{ ...inputStyle, margin: 0 }} value={f.scoreMode} onChange={e => set("scoreMode", e.target.value)}>
        <option value="projected">Project training hours to the full year at the current pace</option><option value="actual">Count hours so far against full-year targets</option></select></label>
      <label style={{ ...label, display: "block", marginTop: 8 }}>Training items (580) use<select aria-label="Training data source" style={{ ...inputStyle, margin: 0, maxWidth: 560 }} value={f.trainingSource} onChange={e => set("trainingSource", e.target.value)}>
        <option value="pial">This tracker's roster and training imports (FireWorks imports on this page)</option>
        <option value="nexus">The Training section: FireWorks imports + verified drills, and its grading-year roster</option></select></label>
    </section>
    <section style={cardStyle} aria-label="Last grading">
      <H sub="From the most recent PIAL grading report. Shown next to the estimates.">Last PIAL grading</H>
      {bl("date", "Date", "date", 160)}{bl("cls", "Class")}{bl("score", "Total score")}{bl("comms", "Communications")}{bl("fd", "Fire department")}{bl("water", "Water supply")}{bl("crr", "Risk reduction")}{bl("divergence", "Divergence")}
    </section>
    <section style={cardStyle} aria-label="CAD">
      <H sub="Alarm processing (64 s / 106 s) comes from the FireWorks Alarm Processing report when one covers the graded year, otherwise from CAD (Comms Statistics data). CAD also gives first-unit arrival for deployment until fire reports are imported.">Alarm processing and CAD</H>
      <label style={label}>Alarm processing is measured from<select aria-label="Alarm processing measured from" style={{ ...inputStyle, margin: 0, maxWidth: 520 }} value={f.alarmMeasure} onChange={e => set("alarmMeasure", e.target.value)}>
        <option value="queue">Entered the dispatch queue → alarm (FireWorks "SG Processing"; matches PIAL's 2025 grading)</option>
        <option value="total">Received at the PSAP → alarm (FireWorks "Total Processing")</option></select></label>
      <label style={label}>{BRAND.place}'s agency code in CAD<select aria-label="CAD agency" style={{ ...inputStyle, margin: 0, maxWidth: 300 }} value={f.cadAgency} onChange={e => set("cadAgency", e.target.value)}>
        <option value="">(not set)</option>{data.agencies.map(a => <option key={a.agency} value={a.agency}>{a.agency} ({int(a.n)})</option>)}</select></label>
      <label style={label}>Calls counted for alarm processing: fire, EMS and rescue (pattern, | between words; "." = every call for the agency)<input aria-label="Fire natures" style={inputStyle} value={f.fireNatures} onChange={e => set("fireNatures", e.target.value)} /></label>
      <label style={label}>Natures that are structure fires<input aria-label="Structure fire natures" style={inputStyle} value={f.structureNatures} onChange={e => set("structureNatures", e.target.value)} /></label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ ...label, flex: "1 1 220px" }}>Engine call signs (pattern)<input aria-label="Engine units" style={inputStyle} value={f.engineUnits} onChange={e => set("engineUnits", e.target.value)} /></label>
        <label style={{ ...label, flex: "1 1 220px" }}>Ladder / service call signs (pattern)<input aria-label="Ladder units" style={inputStyle} value={f.ladderUnits} onChange={e => set("ladderUnits", e.target.value)} /></label>
        <label style={label}>Full complement: engines<input aria-label="Full complement engines" type="number" min="1" max="6" style={{ ...inputStyle, width: 90 }} value={f.fullEngines} onChange={e => set("fullEngines", e.target.value)} /></label>
        <label style={label}>+ ladder / service<input aria-label="Full complement ladders" type="number" min="0" max="4" style={{ ...inputStyle, width: 90 }} value={f.fullLadders} onChange={e => set("fullLadders", e.target.value)} /></label>
      </div>
    </section>
    <section style={cardStyle} aria-label="Targets">
      <H sub="Defaults are the 2012 FSRS figures. Check them against the chief's copy of the FSRS (PIAL sends it to the chief on request).">Training and dispatch targets</H>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "0 16px" }}>
        {tgt.map(([k, l]) => <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, padding: "3px 0" }}><input aria-label={l} type="number" style={{ ...inputStyle, width: 90, margin: 0 }} value={f.targets[k]} onChange={e => set("targets", { ...f.targets, [k]: e.target.value })} />{l}</label>)}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <label style={label}>Aerial height needed (ft, 10' per story of tallest building, max 100)<input aria-label="Aerial height needed" type="number" style={{ ...inputStyle, width: 110, margin: 0 }} value={f.aerialRequiredFt} onChange={e => set("aerialRequiredFt", e.target.value)} /></label>
        <label style={label}>PPE ensembles available (blank = all members issued)<input aria-label="PPE ensembles" type="number" style={{ ...inputStyle, width: 110, margin: 0 }} value={f.ppe} onChange={e => set("ppe", e.target.value)} /></label>
      </div>
    </section>
    <section style={cardStyle} aria-label="Minimum criteria confirmations">
      <H sub={"Items " + PN + " can't check from data. Membership and training are checked from the records when they're imported."}>Minimum criteria</H>
      {tri("organization", "Organization (permanent, one person in charge, legal boundaries)")}{tri("alarm", "Alarm receipt and dispatch without delay")}
      {tri("housing", "Apparatus housed against weather and freezing")}{tri("apparatus", "At least one NFPA 1901 apparatus")}{tri("membership", "4 firefighters on working fires (if no fire reports)")}{tri("training", "12 hrs/yr training for all (if no training records)")}
    </section>
    <button type="button" style={btn("primary")} onClick={save}><Save size={14} /> Save settings</button>
  </>;
}

// ---- Binder (print) ---------------------------------------------------------------------------------
const PRINT_CSS = `
.pial-print { display: none; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #13233F; }
@media print {
  #root { display: none !important; }
  .pial-print { display: block !important; }
  html, body { background: #fff !important; padding: 0 !important; }
  .pial-print * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pb { break-before: page; }
  .nb { break-inside: avoid; }
  @page { size: letter; margin: 12mm; }
}`;
function Binder({ data, toast }) {
  const [opt, setOpt] = useState({ division: "", worksheets: true });
  const [x, setX] = useState(null);
  useEffect(() => {
    Promise.all([api("/evidence"), api("/training"), api("/apparatus"), api("/tests"), api("/fires"), api("/roster")])
      .then(([ev, tr, ap, ts, fi, ro]) => setX({ ev: ev.evidence, tr, ap, ts, fi, ro }), e => toast(e.message));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const items = data.items.filter(i => !opt.division || i.owner === opt.division);
  const owners = [...new Set(data.items.map(i => i.owner))].sort();
  const paper = x && <BinderPaper data={data} items={items} x={x} opt={opt} />;
  return <>
    <style>{PRINT_CSS}</style>
    <section style={cardStyle} className="no-print" aria-label="Binder options">
      <H sub="Everything PIAL's field representative asks to see, in questionnaire order: score summary, minimum criteria, each item with notes and the evidence on file, and the worksheets."
        right={<button type="button" style={btn("primary")} disabled={!x} onClick={() => window.print()}><Printer size={14} /> Print / save as PDF</button>}>Grader binder</H>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ ...label, marginBottom: 0 }}>Items for<select aria-label="Binder division" style={{ ...inputStyle, margin: 0 }} value={opt.division} onChange={e => setOpt(o => ({ ...o, division: e.target.value }))}>
          <option value="">Everyone (full binder)</option>{owners.map(o => <option key={o}>{o}</option>)}</select></label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={opt.worksheets} onChange={e => setOpt(o => ({ ...o, worksheets: e.target.checked }))} /> Include worksheets (roster, training, apparatus & tests, fires)</label>
      </div>
    </section>
    {!x ? <div style={cardStyle}>Loading…</div> : <div style={{ background: "#fff", boxShadow: "0 2px 14px rgba(19,35,63,0.14)", padding: "28px 32px", maxWidth: 816, margin: "0 auto", overflowX: "auto" }}>{paper}</div>}
    {x && typeof document !== "undefined" && createPortal(<div className="pial-print">{paper}</div>, document.body)}
  </>;
}
function BinderPaper({ data, items, x, opt }) {
  const generated = new Date().toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const evBy = {}; for (const e of x.ev) (evBy[e.item_key] = evBy[e.item_key] || []).push(e);
  const th = { textAlign: "left", fontSize: 10.5, textTransform: "uppercase", color: C.soft, borderBottom: `1.5px solid ${C.ink}`, padding: "4px 6px" };
  const td = { fontSize: 11.5, padding: "3px 6px", borderBottom: `1px solid ${C.line}`, verticalAlign: "top" };
  const Table = ({ head, rows }) => <table style={{ width: "100%", borderCollapse: "collapse", margin: "6px 0 12px" }}><thead><tr>{head.map((h, i) => <th key={i} style={{ ...th, textAlign: typeof h === "object" ? "right" : "left" }}>{typeof h === "object" ? h.r : h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="nb">{r.map((c, j) => <td key={j} style={{ ...td, textAlign: typeof head[j] === "object" ? "right" : "left" }}>{c}</td>)}</tr>)}{!rows.length && <tr><td colSpan={head.length} style={{ ...td, color: C.muted }}>None on record.</td></tr>}</tbody></table>;
  const h2 = (t, pb) => <h2 className={pb ? "pb" : ""} style={{ fontFamily: "Georgia, serif", fontSize: 19, borderBottom: `2px solid ${C.brick}`, padding: "0 0 3px", margin: "18px 0 8px" }}>{t}</h2>;
  const testsOf = (kind, subject) => x.ts.tests.filter(t => t.kind === kind && t.passed && (!subject || t.subject.toLowerCase() === subject.toLowerCase())).map(t => t.date).sort().reverse();
  const fireCols = ["Date", "Time", "Incident", "C/R", { r: "Responders" }, { r: "1st engine (s)" }, { r: "Full (s)" }];
  const fireRow = f => [fmtDay(f.date), f.time, f.incident, f.type, f.responders ?? "", f.first_engine_s ?? "", f.full_s ?? ""];
  return <div style={{ fontSize: 12, color: C.ink }}>
    <div style={{ display: "flex", gap: 14, alignItems: "center", borderBottom: `3px solid ${C.brick}`, paddingBottom: 10 }}>
      <img src="/logo-large.png" alt={BRAND.org} style={{ width: 70, height: 70 }} />
      <div><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: C.soft }}>ST. GEORGE FIRE PROTECTION DISTRICT</div>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 700 }}>PIAL Grading Binder</div>
        <div style={{ fontSize: 12.5, color: C.soft }}>Graded year {data.year.year} ({fmtDay(data.year.start)} – {fmtDay(data.year.end)}){opt.division ? ` · Items owned by ${opt.division}` : ""} · Prepared {generated}</div></div>
    </div>
    {h2("Score summary")}
    <p style={{ margin: "0 0 6px", fontSize: 12 }}>Estimated by {BRAND.app} from department records against the 2012 FSRS and the Louisiana Addendum (January 1, 2021). This is the department's own estimate, not a PIAL grade.</p>
    <Table head={["Section", { r: "Max" }, { r: "Estimate" }, { r: "Last grading" }]} rows={[...data.sections.map(s => [s.title, s.max, pts(s.credit), data.settings.baseline?.[s.key] ?? "–"]),
      ["Divergence", "", `−${pts(data.divergence)}`, data.settings.baseline?.divergence ?? "–"], ["Hydrant data bonus (Louisiana)", 0.5, `+${pts(data.bonus)}`, data.settings.baseline?.bonus ?? "–"], [<b>Total</b>, 105.5, <b>{pts(data.score)} (Class {data.cls})</b>, data.settings.baseline?.score ? `${data.settings.baseline.score}${data.settings.baseline.cls ? ` (Class ${data.settings.baseline.cls})` : ""}` : "–"]]} />
    <Table head={["Minimum criteria", "Status"]} rows={data.minimum.map(m => [<>{m.label}{m.detail ? <div style={{ color: C.soft }}>{m.detail}</div> : null}</>, m.ok === true ? "Met" : m.ok === false ? "NOT MET" : "Not confirmed"])} />
    {data.sections.map((s, si) => { const list = items.filter(i => i.section === s.key); if (!list.length) return null; return <div key={s.key}>
      {h2(`${s.title} (${pts(s.credit)} of ${s.max})`, si > 0 || true)}
      {list.map(i => <div key={i.key} className="nb" style={{ borderBottom: `1px solid ${C.line}`, padding: "6px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{i.code} {i.title}</b><span style={{ whiteSpace: "nowrap" }}>{pts(i.credit)} / {pts(i.max)}{i.last && i.last.earned !== null ? ` (2025: ${pts(i.last.earned)})` : ""} · {i.owner}</span></div>
        {i.last?.rec && <div style={{ fontSize: 11 }}><i>PIAL 2025:</i> {i.last.rec}</div>}
        {i.detail.map((d, k) => <div key={k} style={{ color: C.soft }}>{d}</div>)}
        {i.warn.map((w, k) => <div key={k} style={{ color: C.warn }}>⚠ {w}</div>)}
        {i.notes && <div style={{ whiteSpace: "pre-wrap", marginTop: 2 }}>{i.notes}</div>}
        <div style={{ marginTop: 2 }}><i>Evidence on file:</i> {(evBy[i.key] || []).length ? (evBy[i.key] || []).map(e => `${e.title}${e.doc_date ? ` (${fmtDay(e.doc_date)})` : ""}`).join("; ") : <span style={{ color: C.muted }}>none attached</span>}</div>
      </div>)}
    </div>; })}
    {opt.worksheets && <>
      {h2("Membership roster", true)}
      <Table head={["Name", "Rank", "Position", "Rank date", "Hire date", "End", "Shift", "Officer", "Driver"]} rows={x.ro.members.map(m => [m.name, m.rank, m.position, fmtDay(m.rank_date), fmtDay(m.hire_date), m.end_date ? fmtDay(m.end_date) : "", m.shift, m.officer ? "Y" : "", m.driver ? "Y" : ""])} />
      {h2("Training summary", true)}
      <p style={{ margin: 0 }}>Hours in the graded year{x.tr.project ? " so far" : ""}. Company = in-house and interactive virtual + CBT (max half of each month's 16) + half of outside training, capped at 16 per month. Targets: company {x.tr.targets.company}, facility {x.tr.targets.facility}, officer {x.tr.targets.officerCe}, driver {x.tr.targets.driver}, hazmat {x.tr.targets.hazmat}.</p>
      <Table head={["Member", "Rank", { r: "Company" }, { r: "Facility" }, { r: "Officer" }, { r: "Driver" }, { r: "HazMat" }, { r: "Total" }, "IFSAC"]}
        rows={x.tr.rows.map(r => [r.name, r.rank, dec(r.companyCredited), dec(r.facility), dec(r.officerHrs), dec(r.driverHrs), dec(r.hazmat), dec(r.total), r.ifsac ? "Y" : ""])} />
      {h2("Fire stations & equipment", true)}
      <Table head={["Unit", "Type", "Station", "Year", { r: "Pump" }, { r: "Tank" }, { r: "Equip %" }, "3 most recent pump tests", "5 most recent aerial tests"]}
        rows={x.ap.apparatus.map(u => [u.unit, u.type.replace("_", " "), u.station, u.year ?? "", u.pump_gpm ?? "", u.tank_gal ?? "", u.equipment ? dec(u.equipment.pct * 100) : "",
          testsOf("pump", u.unit).slice(0, 3).map(fmtDay).join(", "), testsOf("aerial", u.unit).slice(0, 5).map(fmtDay).join(", ")])} />
      <Table head={["Program", "Most recent (3)"]} rows={[["Hose service tests", testsOf("hose").slice(0, 3).map(fmtDay).join(", ")], ["Hydrant inspections", testsOf("hydrant_inspection").slice(0, 3).map(fmtDay).join(", ")],
        ["Hydrant fire flow tests", testsOf("hydrant_flow").slice(0, 3).map(fmtDay).join(", ")], ["Pre-incident planning inspections", testsOf("preplan").slice(0, 3).map(fmtDay).join(", ")]]} />
      <Table head={["SOP", "Last reviewed"]} rows={x.ts.sops.map(s => [s, fmtDay(testsOf("sop", s)[0])])} />
      {h2("Working fires (20 most recent)", true)}
      <Table head={fireCols} rows={x.fi.fires.filter(f => f.working).slice(0, 20).map(fireRow)} />
      {h2("Non-working fires (20 most recent)")}
      <Table head={fireCols} rows={x.fi.fires.filter(f => !f.working).slice(0, 20).map(fireRow)} />
    </>}
    <div style={{ marginTop: 14, fontSize: 10, color: C.muted }}>{BRAND.app} · PIAL tracker · {generated}</div>
  </div>;
}

// ---- Module -----------------------------------------------------------------------------------------
const PAGES = {
  score: ["Scorecard", "Where the district stands against the 2012 FSRS and the Louisiana Addendum, 2021 (105.5 points + 0.5 hydrant data bonus)"],
  comms: ["Emergency Communications", "10 points: 911 features, telecommunicators, dispatch circuits"],
  fd: ["Fire Department", "50 points: companies and equipment, deployment, personnel, training, operations"],
  water: ["Water Supply", "40 points: supply system, hydrants, inspection and flow testing"],
  crr: ["Community Risk Reduction", "5.5 points: fire prevention, public education, fire investigation"],
  training: ["Training", "Hours by member and category against the FSRS targets"],
  apparatus: ["Apparatus & equipment", "Every company's equipment against PIAL's inventory list"],
  records: ["Testing & reviews", "Pump, hose, aerial, hydrant, pre-plan, generator and SOP records"],
  fires: ["Fire responses", "Working and non-working structure fires, responders and arrival times"],
  imports: ["FireWorks imports", "Roster, certifications, training, fire incidents, alarm processing and test records"],
  binder: ["Grader binder", "Print everything PIAL asks to see"],
  settings: ["PIAL settings", "Graded year, last grading, CAD, targets, minimum criteria"],
};
export default function PialModule({ onBack }) {
  const [page, setPage] = useState("score");
  const [data, setData] = useState(null), [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [focus, setFocus] = useState(null);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const load = () => api("").then(d => { setData(d); setError(""); }, e => setError(e.message));
  useEffect(() => { load(); }, []);
  const go = (p, item) => { setPage(p); setFocus(item || null); };
  useEffect(() => { if (focus) setTimeout(() => { const el = document.querySelector(`[data-item="${focus}"] button`); if (el) { el.click(); el.scrollIntoView({ block: "center" }); } setFocus(null); }, 50); }, [focus, page]);
  const nav = [
    { key: "score", label: "Scorecard", icon: Gauge, group: "Score" },
    ...["comms", "fd", "water", "crr"].map(k => ({ key: k, label: PAGES[k][0], icon: SEC_ICON[k], group: "Score",
      badge: data ? data.items.filter(i => i.section === k && (i.pct === null || i.warn.length)).length : 0 })),
    { key: "training", label: "Training", icon: GraduationCap, group: "Records" },
    { key: "apparatus", label: "Apparatus & equipment", icon: Truck, group: "Records" },
    { key: "records", label: "Testing & reviews", icon: ClipboardCheck, group: "Records", badge: data ? data.due.filter(d => d.overdue).length : 0 },
    { key: "fires", label: "Fire responses", icon: Flame, group: "Records" },
    { key: "binder", label: "Grader binder", icon: Printer, group: "Print" },
    ...(data?.me.manage ? [{ key: "imports", label: "FireWorks imports", icon: Upload, group: "Admin" }, { key: "settings", label: "PIAL settings", icon: SlidersHorizontal, group: "Admin" }] : []),
  ];
  const [title, sub] = PAGES[page];
  let body;
  if (error) body = <div style={{ ...cardStyle, color: C.bad }} role="alert">{error}</div>;
  else if (!data) body = <div style={cardStyle} role="status">Loading…</div>;
  else if (page === "score") body = <Scorecard data={data} go={go} />;
  else if (["comms", "fd", "water", "crr"].includes(page)) body = <SectionPage key={page} data={data} sec={page} reload={load} toast={showToast} />;
  else if (page === "training") body = <Training data={data} toast={showToast} reload={load} />;
  else if (page === "apparatus") body = <Apparatus data={data} toast={showToast} reload={load} />;
  else if (page === "records") body = <Records data={data} toast={showToast} reload={load} />;
  else if (page === "fires") body = <Fires toast={showToast} />;
  else if (page === "imports") body = <Imports toast={showToast} reload={load} />;
  else if (page === "settings") body = <Settings key={JSON.stringify(data.settings)} data={data} toast={showToast} reload={load} />;
  else if (page === "binder") body = <Binder data={data} toast={showToast} />;
  return (
    <AppShell section="PIAL Tracker" nav={nav} active={page} onNav={k => go(k)} onHome={onBack}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }}>
        <div><h1 style={{ fontSize: 26, fontWeight: 800, color: C.ink, margin: 0 }}>{title}</h1><div style={{ fontSize: 13.5, color: C.soft, marginTop: 2 }}>{sub}</div></div>
        {data && page !== "score" && <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 700 }}>
          Estimate {pts(data.score)} · Class {data.cls} · {data.year.year}</div>}
      </div>
      {body}
      {toast && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.ink, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{toast}</div>}
    </AppShell>
  );
}
