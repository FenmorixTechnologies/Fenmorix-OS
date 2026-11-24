// Fire Prevention: annual periodic inspections from the FireWorks "PIAL Annual/Periodic Inspection History" report.
// Overview (coverage, PIAL 1022 estimate, pace, by area / station / inspector), properties not inspected yet, every
// property, one property's history (leave out with a reason, record an inspection by hand), import, settings.
// Server: server/fireprev.js.
import React, { useEffect, useState } from "react";
import { BRAND } from "./brand.js";
import { Flame, ClipboardList, Building2, Upload, Settings, Download, X, AlertTriangle } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/fireprev${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pctText = p => `${Math.round((p || 0) * 1000) / 10}%`;
const prettyDay = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", whiteSpace: "nowrap", borderBottom: `1px solid ${LINE}` };
const td = { padding: "7px 9px", verticalAlign: "top", borderBottom: `1px solid ${LINE}` };
const Err = ({ e }) => e ? <div role="alert" style={{ color: BRICK, fontSize: 13.5, margin: "6px 0" }}>{e}</div> : null;
const Stat = ({ k, v, tone, sub }) => (
  <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", minWidth: 130, flex: "1 1 130px" }}>
    <div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: tone || INK }}>{v}</div>{sub && <div style={{ fontSize: 12, color: INK_SOFT }}>{sub}</div>}
  </div>
);
const tone = p => (p >= 0.95 ? SAGE : p >= 0.8 ? AMBER : BRICK);
const Bar = ({ p }) => (
  <div style={{ background: PAPER, borderRadius: 4, height: 10, minWidth: 90, position: "relative" }} aria-hidden>
    <div style={{ width: `${Math.min(100, (p || 0) * 100)}%`, height: "100%", borderRadius: 4, background: tone(p) }} />
  </div>
);
const STATUS = { done: ["Inspected", SAGE], not: ["Not inspected", BRICK], excluded: ["Left out", INK_SOFT], other: ["Other district", INK_SOFT], vacant: ["Vacant (not counted)", INK_SOFT] };
const Pill = ({ s }) => { const [t, c] = STATUS[s] || [s, INK_SOFT]; return <span style={{ fontSize: 11.5, fontWeight: 700, color: c, border: `1px solid ${c}`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>{t}</span>; };

// ---- Overview ---------------------------------------------------------------------------------------
function Overview({ d, openList }) {
  const t = d.totals, p = d.pial;
  if (!t.properties) return <div style={cardStyle}>No inspection report imported yet. {d.rights.edit ? "Use Import to load the FireWorks \"PIAL Annual Periodic Inspection History\" report." : "Fire Prevention will import it."}</div>;
  const perWeek = d.inProgress && p.left ? Math.ceil(p.left / p.weeksLeft) : 0;
  const group = (title, rows, key) => (
    <div style={{ ...cardStyle, overflowX: "auto" }} role="region" aria-label={title}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead><tr><th style={th}>{key === "box" ? "Station" : "Area"}</th><th style={th}>Inspected</th><th style={th}>Left</th><th style={{ ...th, width: "40%" }}>Coverage</th></tr></thead>
        <tbody>{rows.map(g => (
          <tr key={g.name}>
            <td style={td}><button type="button" style={{ ...btn("ghost"), padding: "0 4px", fontWeight: 700 }} onClick={() => openList({ [key]: g.name })}>{key === "box" && /^\d+$/.test(g.name) ? `Station ${g.name}` : g.name}</button></td>
            <td style={td}>{g.done} of {g.total}</td><td style={{ ...td, color: g.total - g.done ? BRICK : SAGE, fontWeight: 700 }}>{g.total - g.done}</td>
            <td style={td}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Bar p={g.pct} /><span style={{ fontSize: 12.5, minWidth: 44 }}>{pctText(g.pct)}</span></div></td>
          </tr>))}</tbody>
      </table>
    </div>);
  const maxMonth = Math.max(1, ...d.pace.map(m => m.inspections));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat k="Properties counted" v={t.counted} sub={`${t.properties} in the report`} />
        <Stat k={`Inspected in ${d.year}`} v={t.inspected} tone={SAGE} sub={pctText(t.pct)} />
        <Stat k="Not inspected yet" v={t.notInspected} tone={t.notInspected ? BRICK : SAGE} sub={perWeek ? `${perWeek} a week to finish by Dec 31` : ""} />
        <Stat k="PIAL 1022" v={`${p.points} / 8`} tone={tone(p.pct * p.factor)} sub={`${p.credit} of ${p.maxCredit} score points`} />
      </div>
      <div style={{ ...cardStyle, borderLeft: `6px solid ${tone(p.pct * p.factor)}` }}>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>PIAL: Fire Prevention Staffing (FSRS 1022)</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          8 × {t.inspected} inspected ÷ {t.counted} properties{p.factor !== 1 ? ` × ${p.factor}` : ""} = <b>{p.points} of 8 points</b> ({p.credit} of {p.maxCredit} on the score).
          {" "}Only inspections by OSFM-certified inspectors count, and PIAL asks for the records of a sample of properties (10 or more): every property not inspected this year is a record that can come up missing.
          {d.inProgress && p.left > 0 && <> With {p.weeksLeft} week{p.weeksLeft === 1 ? "" : "s"} left in {d.year}, {p.left} properties still need an inspection.</>}
          {d.settings.partialRecords && <div style={{ color: AMBER, marginTop: 4 }}><AlertTriangle size={13} /> Partial records are set: 25% reduction.</div>}
          {!d.settings.certified && <div style={{ color: BRICK, marginTop: 4 }}><AlertTriangle size={13} /> Inspectors are set as not OSFM-certified: no credit.</div>}
          {(t.excluded + t.other + t.vacant) > 0 && <div style={{ color: INK_SOFT, marginTop: 4 }}>Not counted: {[t.excluded && `${t.excluded} left out by hand`, t.other && `${t.other} in other fire districts`, t.vacant && `${t.vacant} vacant`].filter(Boolean).join(", ")}.</div>}
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btn("primary")} onClick={() => openList({})}>Properties not inspected ({t.notInspected})</button>
          <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/fireprev/export.csv?year=${d.year}&status=not`}><Download size={14} /> CSV for assigning</a>
        </div>
      </div>
      <div style={cardStyle} role="region" aria-label="Pace">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Pace in {d.year}</div>
        <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 120 }}>
          {d.pace.map(m => (
            <div key={m.month} title={`${m.inspections} inspections; ${m.covered} properties covered by month end`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div style={{ fontSize: 10.5, color: INK_SOFT }}>{m.inspections || ""}</div>
              <div style={{ width: "70%", height: `${(m.inspections / maxMonth) * 80}px`, background: BLUE, borderRadius: "3px 3px 0 0" }} />
              <div style={{ fontSize: 10.5, color: INK_SOFT }}>{new Date(`${m.month}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" })}</div>
            </div>))}
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 4 }}>Inspections per month. Covered by month end: {d.pace.filter(m => m.month <= d.today.slice(0, 7)).map(m => `${new Date(`${m.month}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" })} ${pctText(t.counted ? m.covered / t.counted : 0)}`).join(" · ")}</div>
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        {group("By inspection area", d.byArea, "area")}
        {group("By first-due station", d.byBox, "box")}
      </div>
      <div style={cardStyle} role="region" aria-label="By inspector">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>By inspector ({d.year})</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Inspector</th><th style={th}>Properties</th><th style={th}>Inspections</th></tr></thead>
          <tbody>{d.byInspector.map(i => <tr key={i.name}><td style={td}>{i.name}</td><td style={td}>{i.properties}</td><td style={td}>{i.inspections}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Property list ------------------------------------------------------------------------------------
function PropertyList({ d, initial, openProperty }) {
  const [f, setF] = useState({ status: "not", q: "", area: "", box: "", ...initial });
  const [page, setPage] = useState(1), [res, setRes] = useState(null), [error, setError] = useState("");
  const qs = new URLSearchParams({ year: d.year, status: f.status, q: f.q, area: f.area, box: f.box }).toString();
  useEffect(() => { setPage(1); }, [qs]);
  useEffect(() => { const h = setTimeout(() => call(`/properties?${qs}&page=${page}&size=50`).then(r => { setRes(r); setError(""); }, e => setError(e.message)), 250); return () => clearTimeout(h); }, [qs, page]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const pages = res ? Math.max(1, Math.ceil(res.total / res.size)) : 1;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label><span style={label}>Show</span><select aria-label="Status" style={{ ...inputStyle, width: "auto" }} value={f.status} onChange={e => set("status", e.target.value)}>
          <option value="not">Not inspected in {d.year}</option><option value="done">Inspected in {d.year}</option><option value="excluded">Not counted</option><option value="all">Every property</option></select></label>
        <label><span style={label}>Area</span><select aria-label="Area" style={{ ...inputStyle, width: "auto" }} value={f.area} onChange={e => set("area", e.target.value)}>
          <option value="">All areas</option>{d.byArea.map(a => <option key={a.name}>{a.name}</option>)}</select></label>
        <label><span style={label}>Station</span><select aria-label="Station" style={{ ...inputStyle, width: "auto" }} value={f.box} onChange={e => set("box", e.target.value)}>
          <option value="">All stations</option>{d.byBox.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}</select></label>
        <label style={{ flex: 1, minWidth: 200 }}><span style={label}>Search</span><input aria-label="Search properties" style={inputStyle} placeholder="Address, business, Property #" value={f.q} onChange={e => set("q", e.target.value)} /></label>
        <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/fireprev/export.csv?${qs}`}><Download size={14} /> CSV</a>
      </div>
      <Err e={error} />
      {res && <div style={{ ...cardStyle, overflowX: "auto" }}>
        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 6 }}>{res.total} propert{res.total === 1 ? "y" : "ies"}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Property</th><th style={th}>Business / description</th><th style={th}>Area</th><th style={th}>Sta.</th><th style={th}>Last inspection</th><th style={th}>Status</th></tr></thead>
          <tbody>{res.rows.map(p => (
            <tr key={p.no} onClick={() => openProperty(p.no)} style={{ cursor: "pointer" }}>
              <td style={td}><button type="button" style={{ ...btn("ghost"), padding: 0, fontWeight: 700, textAlign: "left" }} aria-label={`Open property ${p.no}`}>{p.address}{p.unit ? `, ${p.unit}` : ""}</button><div style={{ fontSize: 11.5, color: INK_SOFT }}>#{p.no}{p.district && !/st\.?\s*george/i.test(p.district) ? ` · ${p.district}` : ""}</div></td>
              <td style={td}>{p.description}</td><td style={td}>{p.area}</td><td style={td}>{p.box}</td>
              <td style={td}>{p.inYear ? prettyDay(p.inYear) : p.last ? <span style={{ color: BRICK }}>{prettyDay(p.last)}</span> : <span style={{ color: BRICK }}>never</span>}</td>
              <td style={td}><Pill s={p.status} />{p.excludeReason && <div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.excludeReason}</div>}</td>
            </tr>))}</tbody>
        </table>
        {pages > 1 && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
          <button style={btn("outline")} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>Page {page} of {pages}
          <button style={btn("outline")} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
      </div>}
    </div>
  );
}

// ---- One property -------------------------------------------------------------------------------------
function PropertyDialog({ no, rights, onClose, onChanged, toast }) {
  const [p, setP] = useState(null), [error, setError] = useState(""), [reason, setReason] = useState(""), [day, setDay] = useState(""), [who, setWho] = useState("");
  const load = () => call(`/properties/${encodeURIComponent(no)}`).then(x => { setP(x); setReason(x.excludeReason || ""); }, e => setError(e.message));
  useEffect(() => { load(); }, [no]);
  const act = async (path, body, msg) => { setError(""); try { await call(path, body); toast(msg); load(); onChanged(); } catch (e) { setError(e.message); } };
  return (
    <div role="dialog" aria-modal="true" aria-label="Property" style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ ...cardStyle, width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "start", gap: 8 }}>
          <div style={{ flex: 1 }}>{p && <><div style={{ fontSize: 17, fontWeight: 800 }}>{p.address}{p.unit ? `, ${p.unit}` : ""}</div>
            <div style={{ fontSize: 13, color: INK_SOFT }}>{p.description} · #{p.no} · {p.area} · Station {p.box} · Zone {p.zone} · {p.district || "no fire district"}</div></>}</div>
          <button aria-label="Close" style={btn("ghost")} onClick={onClose}><X size={16} /></button>
        </div>
        <Err e={error} />
        {p && <>
          {!p.active && <div style={{ color: AMBER, fontSize: 13, marginTop: 6 }}>Not in the latest FireWorks report (kept for its history).</div>}
          {!p.counts && <div style={{ color: INK_SOFT, fontSize: 13, marginTop: 6 }}>Its fire district isn't counted for PIAL (Settings).</div>}
          <div style={{ fontWeight: 800, margin: "12px 0 4px" }}>Inspections</div>
          {p.inspections.length ? <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}><tbody>{p.inspections.map(i => (
            <tr key={i.id}><td style={td}>{prettyDay(i.day)}</td><td style={td}>{i.inspector || "(not listed)"}</td><td style={{ ...td, color: INK_SOFT, fontSize: 12 }}>{i.source === "manual" ? `entered by ${i.by}` : "FireWorks"}</td>
              <td style={td}>{rights.edit && i.source === "manual" && <button style={{ ...btn("ghost"), color: BRICK, padding: "2px 6px" }} onClick={() => act(`/inspections/${i.id}/remove`, {}, "Inspection removed")}>Remove</button>}</td></tr>))}</tbody></table>
            : <div style={{ fontSize: 13.5, color: BRICK }}>No inspection on file.</div>}
          {rights.edit && <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 10, background: PAPER, padding: 10, borderRadius: 8 }}>
              <label><span style={label}>Inspection date</span><input aria-label="Inspection date" type="date" style={{ ...inputStyle, width: 160 }} value={day} onChange={e => setDay(e.target.value)} /></label>
              <label style={{ flex: 1, minWidth: 160 }}><span style={label}>Inspector</span><input aria-label="Inspector" style={inputStyle} value={who} onChange={e => setWho(e.target.value)} /></label>
              <button style={btn("outline")} onClick={() => act(`/properties/${encodeURIComponent(no)}/inspections`, { day, inspector: who }, "Inspection recorded")}>Record inspection</button>
            </div>
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4 }}>For an inspection FireWorks doesn't have yet; the next import keeps both.</div>
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Count for PIAL</div>
              {p.excluded ? <div style={{ fontSize: 13.5 }}>Left out by {p.excludedBy}: {p.excludeReason}. <button style={btn("outline")} onClick={() => act(`/properties/${encodeURIComponent(no)}/exclude`, { excluded: false }, "Counted again")}>Count it again</button></div>
                : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                  <label style={{ flex: 1, minWidth: 220 }}><span style={label}>Leave it out of the count because…</span><input aria-label="Reason to leave out" style={inputStyle} placeholder="e.g. demolished, residential, duplicate of #…" value={reason} onChange={e => setReason(e.target.value)} /></label>
                  <button style={btn("outline")} onClick={() => act(`/properties/${encodeURIComponent(no)}/exclude`, { excluded: true, reason }, "Left out of the count")}>Leave out</button></div>}
            </div>
          </>}
        </>}
      </div>
    </div>
  );
}

// ---- Import -------------------------------------------------------------------------------------------
function ImportPage({ onDone, toast }) {
  const [file, setFile] = useState(null), [prev, setPrev] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const read = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => no(new Error("Couldn't read the file.")); r.readAsDataURL(f); });
  const run = async preview => {
    setError(""); setBusy(true);
    try { const data = await read(file); const r = await call("/import", { fileName: file.name, data, preview }); if (preview) setPrev(r); else { toast(`Imported: ${r.newInspections} new inspections, ${r.newProperties} new properties.`); setPrev(null); setFile(null); onDone(); } }
    catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 8 }}>In FireWorks, run <b>PIAL Annual Periodic Inspection History</b> and export it to Excel (.xlsx) or CSV. Each import adds new inspections and updates the property list; properties no longer in the report are set aside (their history stays). Rows FireWorks repeats for the same Property # are merged.</div>
        <input aria-label="Inspection report file" type="file" accept=".xlsx,.csv" onChange={e => { setFile(e.target.files[0] || null); setPrev(null); }} />
        <div style={{ marginTop: 8 }}><button style={btn("primary")} disabled={!file || busy} onClick={() => run(true)}><Upload size={14} /> {busy && !prev ? "Reading…" : "Check the file"}</button></div>
        <Err e={error} />
      </div>
      {prev && <div style={cardStyle} role="region" aria-label="Import preview">
        <div style={{ fontWeight: 800, marginBottom: 6 }}>{prev.fileName}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
          {prev.rows} rows → <b>{prev.properties} properties</b> with {prev.inspections} inspection dates ({prettyDay(prev.from)} – {prettyDay(prev.to)}).<br />
          New: <b>{prev.newInspections}</b> inspections, <b>{prev.newProperties}</b> properties. {prev.dropped ? <span style={{ color: AMBER }}>{prev.dropped} properties are no longer in the report and will be set aside.</span> : ""}
          {prev.badDates > 0 && <div style={{ color: AMBER }}>{prev.badDates} date cells couldn't be read and were skipped.</div>}
          <div style={{ color: INK_SOFT }}>Fire districts: {prev.districts.map(x => `${x.value || "(blank)"} ${x.properties}`).join(" · ")}</div>
        </div>
        <button style={{ ...btn("primary"), marginTop: 8 }} disabled={busy} onClick={() => run(false)}>{busy ? "Importing…" : "Import"}</button>
      </div>}
    </div>
  );
}

// ---- Settings -----------------------------------------------------------------------------------------
function SettingsPage({ d, onDone, toast }) {
  const [s, setS] = useState({ districts: Object.fromEntries(d.districts.map(x => [x.value, x.counts])), excludeVacant: d.settings.excludeVacant, partialRecords: d.settings.partialRecords, certified: d.settings.certified });
  const [error, setError] = useState("");
  const save = async () => { setError(""); try { await call("/settings", s); toast("Settings saved"); onDone(); } catch (e) { setError(e.message); } };
  const flag = (k, text) => <label style={{ display: "flex", gap: 8, alignItems: "start", fontSize: 13.5 }}><input type="checkbox" checked={!!s[k]} onChange={e => setS({ ...s, [k]: e.target.checked })} /> {text}</label>;
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 760 }}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Which fire districts count for PIAL</div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>The report also lists properties FireWorks has under other departments. Only {BRAND.place}'s graded area counts.</div>
        {d.districts.map(x => (
          <label key={x.value} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, padding: "3px 0" }}>
            <input type="checkbox" aria-label={`Count ${x.value || "blank district"}`} checked={!!s.districts[x.value]} onChange={e => setS({ ...s, districts: { ...s.districts, [x.value]: e.target.checked } })} />
            <span style={{ flex: 1 }}>{x.value || "(no fire district)"}</span><span style={{ color: INK_SOFT }}>{x.properties}</span>
          </label>))}
      </div>
      <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
        {flag("certified", "Inspections are done by OSFM-certified fire inspectors (2021 Addendum: other inspections get no credit)")}
        {flag("partialRecords", "Records are partial (FSRS: 25% reduction)")}
        {flag("excludeVacant", "Leave out properties described as vacant")}
      </div>
      <Err e={error} />
      <div><button style={btn("primary")} onClick={save}>Save settings</button></div>
    </div>
  );
}

export default function FirePreventionModule({ onBack }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null), [error, setError] = useState(""), [view, setView] = useState("overview"), [listInit, setListInit] = useState({}), [prop, setProp] = useState(null), [msg, setMsg] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? "" : x)), 6000); };
  const load = () => call(`?year=${year}`).then(x => { setD(x); setError(""); }, e => setError(e.message));
  useEffect(() => { load(); }, [year]);
  const nav = [
    { key: "overview", label: "Overview", icon: Flame, group: "Inspections" },
    { key: "list", label: "Not inspected", icon: ClipboardList, badge: d?.totals?.notInspected || 0, group: "Inspections" },
    { key: "all", label: "Every property", icon: Building2, group: "Inspections" },
    ...(d?.rights?.edit ? [{ key: "import", label: "Import report", icon: Upload, group: "Admin" }] : []),
    ...(d?.rights?.manage ? [{ key: "settings", label: "Settings", icon: Settings, group: "Admin" }] : []),
  ];
  const openList = init => { setListInit({ status: "not", ...init }); setView("list"); };
  let page;
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) page = <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  else if (view === "list") page = <PropertyList key={JSON.stringify(listInit) + year} d={d} initial={listInit} openProperty={setProp} />;
  else if (view === "all") page = <PropertyList key={`all${year}`} d={d} initial={{ status: "all" }} openProperty={setProp} />;
  else if (view === "import") page = <ImportPage onDone={() => { load(); setView("overview"); }} toast={toast} />;
  else if (view === "settings") page = <SettingsPage d={d} onDone={load} toast={toast} />;
  else page = <Overview d={d} openList={openList} />;
  const titles = { overview: "Annual inspections", list: "Properties not inspected", all: "Every property", import: "Import the inspection report", settings: "Fire Prevention settings" };
  return (
    <AppShell section="Fire Prevention" nav={nav} active={view} onNav={k => { if (k === "list") setListInit({ status: "not" }); setView(k); }} onHome={onBack}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0, color: INK, flex: 1 }}>{titles[view]}</h1>
        {["overview", "list", "all"].includes(view) && <label style={{ fontSize: 13, color: INK_SOFT }}>Year{" "}
          <select aria-label="Year" style={{ ...inputStyle, width: "auto", display: "inline-block" }} value={year} onChange={e => setYear(Number(e.target.value))}>
            {Array.from({ length: 4 }, (_, k) => new Date().getFullYear() - k).map(y => <option key={y}>{y}</option>)}</select></label>}
      </div>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
      {prop && d && <PropertyDialog no={prop} rights={d.rights} onClose={() => setProp(null)} onChanged={load} toast={toast} />}
    </AppShell>
  );
}
