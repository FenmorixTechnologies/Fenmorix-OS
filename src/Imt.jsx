// IMT section: incidents run under NIMS/ICS, their operational periods, and each period's IAP built from ICS forms.
// Server: server/imt.js. Editors: ImtForms.jsx. Printing: ImtPrint.js.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Siren, Plus, FileText, Printer, CheckCircle2, Lock, Bell, Copy, ArrowUp, ArrowDown, Trash2, Upload, MapPin, ChevronLeft, AlertTriangle, Paperclip, Unlock } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, SignaturePad } from "./App.jsx";
import { EDITORS, missing, formLabel, Field, INK, INK_SOFT, LINE, PAPER, BRICK, SAGE, AMBER, BLUE } from "./ImtForms.jsx";
import { printIap } from "./ImtPrint.js";
import { PN } from "./brand.js";

async function call(path, body) {
  const r = await fetch(`/api/imt${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work."), { status: r.status });
  return j;
}
const fileB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const pretty = w => w ? new Date(`${w}:00`).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";
const local = (d = new Date()) => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const KIND_CHOICES = ["Hurricane / tropical storm", "Flood", "Winter storm", "Tornado", "Wildland fire", "Hazmat", "Search and rescue", "Planned event", "Other"];

// ---- Incident details form -----------------------------------------------------------------------
function IncidentForm({ inc, onSaved, onCancel }) {
  const [f, setF] = useState(inc || { name: "", number: "", kind: "", location: "", lat: "", lon: "", description: "", shareAll: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [geo, setGeo] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function find() {
    setGeo("Looking it up…");
    try { const r = await call(`/geocode?q=${encodeURIComponent(f.location)}`); setF(x => ({ ...x, lat: String(r.lat.toFixed(5)), lon: String(r.lon.toFixed(5)) })); setGeo(`Found: ${r.matched}`); }
    catch (e) { setGeo(e.message); }
  }
  async function save() {
    setBusy(true); setError("");
    try { const r = await call("/incidents", { ...f }); onSaved(r.id); } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div style={{ ...cardStyle, maxWidth: 760 }}>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>{inc ? "Incident details" : "New incident"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label style={{ gridColumn: "span 2" }}><span style={label}>Incident name</span><input aria-label="Incident name" style={inputStyle} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Hurricane Delta Response" /></label>
        <label><span style={label}>Incident number</span><input aria-label="Incident number" style={inputStyle} value={f.number} onChange={e => set("number", e.target.value)} /></label>
        <label><span style={label}>Type</span><input aria-label="Type" list="imt-kinds" style={inputStyle} value={f.kind} onChange={e => set("kind", e.target.value)} />
          <datalist id="imt-kinds">{KIND_CHOICES.map(k => <option key={k} value={k} />)}</datalist></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Location (address, city, parish/county)</span>
          <div style={{ display: "flex", gap: 6 }}><input aria-label="Location" style={inputStyle} value={f.location} onChange={e => set("location", e.target.value)} />
            <button type="button" style={btn("outline")} disabled={!f.location} onClick={find}><MapPin size={14} /> Find on map</button></div>
          {geo && <span style={{ fontSize: 12, color: INK_SOFT }}>{geo}</span>}</label>
        <label><span style={label}>Latitude</span><input aria-label="Latitude" style={inputStyle} value={f.lat ?? ""} onChange={e => set("lat", e.target.value)} placeholder="30.37" /></label>
        <label><span style={label}>Longitude</span><input aria-label="Longitude" style={inputStyle} value={f.lon ?? ""} onChange={e => set("lon", e.target.value)} placeholder="-91.01" /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Situation summary</span><textarea aria-label="Situation summary" rows={3} style={inputStyle} value={f.description} onChange={e => set("description", e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1", display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={!!f.shareAll} onChange={e => set("shareAll", e.target.checked)} /> Everyone in {PN} can read this incident's approved IAPs</label>
        {inc && <label><span style={label}>Status</span><select aria-label="Status" style={inputStyle} value={f.status} onChange={e => set("status", e.target.value)}><option value="active">Active</option><option value="closed">Closed</option></select></label>}
      </div>
      {error && <div role="alert" style={{ color: BRICK, marginTop: 8, fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button style={btn("primary")} disabled={busy || !f.name.trim()} onClick={save}>{inc ? "Save" : "Create incident"}</button><button style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

// ---- Read an IAP PDF into a new period ----------------------------------------------------------------
function ImportIap({ incidentId, onDone, onCancel }) {
  const [file, setFile] = useState(null), [prev, setPrev] = useState(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [starts, setStarts] = useState(""), [ends, setEnds] = useState("");
  async function run(preview) {
    setBusy(preview ? "Reading the IAP (this can take a minute)…" : "Building the period…"); setError("");
    try {
      const data = await fileB64(file);
      const r = await call("/import", { fileName: file.name, data, preview, incidentId: incidentId || undefined, starts: starts || undefined, ends: ends || undefined });
      if (preview) { setPrev(r.preview); setStarts(r.preview.period?.starts || ""); setEnds(r.preview.period?.ends || ""); }
      else onDone(r);
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  const c = prev?.counts || {};
  return (
    <div style={{ ...cardStyle, maxWidth: 760 }}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>Start from an IAP (PDF)</div>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "4px 0 10px" }}>{PN} reads the ICS forms in the PDF (202, 203, 204s, 205, 206, 208, 220) and builds a new operational period from them for you to check and edit.
        Maps and pictures aren't copied: add them as attachments.</div>
      <input type="file" aria-label="IAP PDF" accept="application/pdf" onChange={e => { setFile(e.target.files[0] || null); setPrev(null); }} />
      {prev && (
        <div style={{ marginTop: 10, fontSize: 13, background: PAPER, borderRadius: 8, padding: 10 }}>
          <div><b>{prev.incident?.name || "(no name)"}</b>{prev.incident?.number ? ` · ${prev.incident.number}` : ""}{prev.incident?.location ? ` · ${prev.incident.location}` : ""}</div>
          <div style={{ color: INK_SOFT, marginTop: 3 }}>Found {c.objectives} objectives, {c.positions} positions, {c.assignments} assignment lists, {c.channels} radio channels, {c.hospitals} hospitals{c.safety ? ", a safety message" : ""}{c.aircraft ? `, ${c.aircraft} aircraft` : ""}.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <label><span style={label}>Period starts</span><input aria-label="Period starts" type="datetime-local" style={inputStyle} value={starts} onChange={e => setStarts(e.target.value)} /></label>
            <label><span style={label}>Period ends</span><input aria-label="Period ends" type="datetime-local" style={inputStyle} value={ends} onChange={e => setEnds(e.target.value)} /></label>
          </div>
          {!incidentId && <div style={{ marginTop: 6, color: INK_SOFT }}>A new incident is created with this name. Fix the details after.</div>}
        </div>
      )}
      {busy && <div role="status" style={{ marginTop: 8, color: BLUE, fontSize: 13 }}>{busy}</div>}
      {error && <div role="alert" style={{ color: BRICK, marginTop: 8, fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {!prev ? <button style={btn("primary")} disabled={!file || !!busy} onClick={() => run(true)}>Read the IAP</button>
          : <button style={btn("primary")} disabled={!!busy || !starts || !ends} onClick={() => run(false)}>Create the period</button>}
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---- One incident -------------------------------------------------------------------------------------
function IncidentView({ id, onOpenPeriod, onBack, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), [importing, setImporting] = useState(false);
  const load = () => call(`/incidents/${id}`).then(setD, e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  const inc = d.incident, acc = d.access;
  if (editing) return <IncidentForm inc={{ ...inc, lat: inc.lat ?? "", lon: inc.lon ?? "" }} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />;
  if (importing) return <ImportIap incidentId={id} onCancel={() => setImporting(false)} onDone={r => { setImporting(false); onOpenPeriod(r.periodId); }} />;
  const last = d.periods[d.periods.length - 1];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button style={{ ...btn("ghost"), paddingLeft: 0, justifySelf: "start" }} onClick={onBack}><ChevronLeft size={15} /> All incidents</button>
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: INK }}>{inc.name}</div>
            <div style={{ fontSize: 13.5, color: INK_SOFT }}>{[inc.number, inc.kind, inc.location].filter(Boolean).join(" · ")}</div>
            {inc.description && <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>{inc.description}</div>}
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>{inc.status === "closed" ? "Closed" : "Active"} · created by {inc.createdBy}{inc.shareAll ? " · approved IAPs readable by everyone" : ""}</div>
          </div>
          {acc.manage && <button style={btn("outline")} onClick={() => setEditing(true)}>Edit details</button>}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Operational periods</div>
          {acc.edit && inc.status !== "closed" && <button style={btn("primary")} onClick={() => setAdding(true)}><Plus size={14} /> New operational period</button>}
          {acc.manage && inc.status !== "closed" && <button style={btn("outline")} onClick={() => setImporting(true)}><Upload size={14} /> From an IAP PDF</button>}
        </div>
        {adding && <NewPeriod last={last} incidentId={id} onCancel={() => setAdding(false)} onDone={pid => { setAdding(false); onOpenPeriod(pid); }} />}
        {d.periods.length === 0 && !adding && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No operational periods yet.</div>}
        {[...d.periods].reverse().map(p => (
          <div key={p.id} role="button" tabIndex={0} aria-label={`Open period ${p.seq}`} onClick={() => onOpenPeriod(p.id)} onKeyDown={e => e.key === "Enter" && onOpenPeriod(p.id)}
            style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 4px", borderTop: `1px solid ${LINE}`, cursor: "pointer" }}>
            <b style={{ minWidth: 72 }}>Period {p.seq}</b>
            <span style={{ flex: 1 }}>{pretty(p.starts)} – {pretty(p.ends)}</span>
            <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: p.status === "approved" ? "#EAF4EE" : "#FFF4DE", color: p.status === "approved" ? SAGE : "#8A5A00" }}>
              {p.status === "approved" ? `Approved${p.approvedBy ? ` · ${p.approvedBy}` : ""}` : "Draft"}</span>
          </div>
        ))}
      </div>
      <FilesCard d={d} incidentId={id} onChanged={load} toast={toast} />
    </div>
  );
}
function NewPeriod({ last, incidentId, onDone, onCancel }) {
  const len = last ? Date.parse(`${last.ends}:00`) - Date.parse(`${last.starts}:00`) : 12 * 3600_000;
  const start0 = last ? last.ends : local(new Date(Math.ceil(Date.now() / 3600_000) * 3600_000));
  const [starts, setStarts] = useState(start0), [ends, setEnds] = useState(local(new Date(Date.parse(`${start0}:00`) + len)));
  const [copy, setCopy] = useState(last ? "previous" : ""), [error, setError] = useState("");
  async function go() { try { onDone((await call(`/incidents/${incidentId}/periods`, { starts, ends, copyFrom: copy })).id); } catch (e) { setError(e.message); } }
  return (
    <div style={{ background: PAPER, borderRadius: 9, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
        <label><span style={label}>Starts</span><input aria-label="Starts" type="datetime-local" style={inputStyle} value={starts} onChange={e => setStarts(e.target.value)} /></label>
        <label><span style={label}>Ends</span><input aria-label="Ends" type="datetime-local" style={inputStyle} value={ends} onChange={e => setEnds(e.target.value)} /></label>
        <label><span style={label}>Start from</span><select aria-label="Start from" style={inputStyle} value={copy} onChange={e => setCopy(e.target.value)}>
          {last && <option value="previous">A copy of period {last.seq} (change what changed)</option>}<option value="">Blank forms</option></select></label>
      </div>
      {error && <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button style={btn("primary")} onClick={go}>Start the period</button><button style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
function FilesCard({ d, incidentId, onChanged, toast }) {
  const [busy, setBusy] = useState("");
  const acc = d.access;
  async function upload(file) {
    try { await uploadIncidentFile(incidentId, file, setBusy); toast("Added."); onChanged(); } catch (e) { toast(e.message); }
    setBusy("");
  }
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Maps, pictures and files</div>
        {acc.edit && <label style={{ ...btn("outline"), cursor: "pointer" }}><Paperclip size={14} /> {busy || "Add a file"}
          <input type="file" aria-label="Add a file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) upload(f); }} /></label>}
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>Use them as the cover photo or as attachments in any period's IAP. PDF pages are turned into pictures so they print inside the IAP.</div>
      {d.files.length === 0 && <div style={{ fontSize: 13, color: INK_SOFT }}>None yet.</div>}
      {d.files.map(f => (
        <div key={f.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${LINE}`, fontSize: 13 }}>
          <a href={`/api/imt/files/${f.id}?download=1`} style={{ flex: 1, color: BLUE }}>{f.name}</a>
          <span style={{ color: INK_SOFT }}>{f.mime === "application/pdf" ? `PDF${f.pages ? ` · ${f.pages} pages` : ""}` : "picture"} · {Math.round(f.size / 1024)} KB</span>
          {acc.edit && <button aria-label={`Remove ${f.name}`} style={{ ...btn("ghost"), color: BRICK, padding: "2px 6px" }} onClick={async () => { if (window.confirm(`Remove ${f.name}?`)) { await call(`/files/${f.id}/remove`, {}); onChanged(); } }}><Trash2 size={14} /></button>}
        </div>
      ))}
    </div>
  );
}
async function uploadIncidentFile(incidentId, file, setBusy = () => {}) {
  if (file.size > 15 * 1024 * 1024) throw new Error("That file is over 15 MB.");
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Attach a picture (PNG, JPG) or a PDF.");
  let pages = [];
  if (isPdf) {
    setBusy("Reading the PDF pages…");
    try { const { pdfToImages } = await import("./pdfPages.js"); pages = (await pdfToImages(file, { onPage: (i, n) => setBusy(`Reading page ${i} of ${n}…`) })).pages; }
    catch (e) { pages = []; }
  }
  setBusy("Uploading…");
  const r = await call("/files", { incidentId, name: file.name, mime: isPdf ? "application/pdf" : file.type, data: await fileB64(file), pages });
  return { ...r, name: file.name, mime: isPdf ? "application/pdf" : file.type };
}

// ---- One operational period (the IAP) ----------------------------------------------------------------
function PeriodView({ id, onBack, onOpenPeriod, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  const [sel, setSel] = useState(null);
  const [people, setPeople] = useState([]), [apparatus, setApparatus] = useState([]);
  const [saving, setSaving] = useState({}), [conflict, setConflict] = useState("");
  const [approving, setApproving] = useState(false), [sig, setSig] = useState(null), [adding, setAdding] = useState(false), [times, setTimes] = useState(null);
  const timers = useRef({});
  const load = async keep => {
    try {
      const r = await call(`/periods/${id}`);
      setD(r); setConflict("");
      if (!keep || !r.forms.some(f => f.id === keep)) setSel(r.forms[0]?.id || null);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    call("/people").then(r => setPeople(r.people), () => {});
    fetch("/api/apparatus", { credentials: "same-origin" }).then(r => r.json()).then(r => setApparatus(r.apparatus || []), () => {});
  }, []);
  // Save shortly after each change
  function change(formId, data) {
    setD(x => ({ ...x, forms: x.forms.map(f => (f.id === formId ? { ...f, data } : f)) }));
    setSaving(s => ({ ...s, [formId]: "unsaved" }));
    clearTimeout(timers.current[formId]);
    timers.current[formId] = setTimeout(() => save(formId), 900);
  }
  const dRef = useRef(d); dRef.current = d;
  async function save(formId) {
    const f = dRef.current.forms.find(x => x.id === formId);
    if (!f) return;
    setSaving(s => ({ ...s, [formId]: "saving" }));
    try {
      const r = await call(`/forms/${formId}`, { data: f.data, version: f.version });
      setD(x => ({ ...x, forms: x.forms.map(y => (y.id === formId ? { ...y, version: r.version } : y)) }));
      setSaving(s => ({ ...s, [formId]: "saved" }));
    } catch (e) { setSaving(s => ({ ...s, [formId]: "error" })); if (e.status === 409) setConflict(e.message); else toast(e.message); }
  }
  async function flush() { for (const k of Object.keys(timers.current)) { clearTimeout(timers.current[k]); if (saving[k] === "unsaved") await save(k); } }
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading the IAP…</div>;
  const { incident: inc, period: p, access: acc } = d;
  const readOnly = !acc.edit || p.status === "approved";
  const form = d.forms.find(f => f.id === sel);
  const Editor = form && EDITORS[form.kind];
  const ctx = {
    incident: inc, period: p, forms: d.forms, people, apparatus, files: d.files, readOnly,
    ai: async (task, formId) => (await call("/ai", { periodId: id, task, formId })).draft,
    uploadFile: async (file, setBusy) => { const r = await uploadIncidentFile(inc.id, file, setBusy); await load(sel); return r; },
    library: async kind => (await call("/library")).library[kind] || [],
    saveLibrary: async (kind, items) => { await call("/library", { kind, items }); toast("Saved for next time."); },
    weather: async () => { if (inc.lat == null) throw new Error("Set the incident's location first (Incident details)."); return call(`/weather?lat=${inc.lat}&lon=${inc.lon}`); },
    from203: async () => {
      const rows = (d.forms.find(f => f.kind === "203")?.data.rows || []).filter(r => r.name);
      const byId = new Map(people.map(x => [x.id, x]));
      return rows.map(r => ({ position: [r.section === "agency" ? r.agency : r.role, r.label].filter(Boolean).join(": "), name: r.name, contact: r.contact || byId.get(r.userId)?.phone || "" }));
    },
  };
  const issues = d.forms.map(f => ({ f, m: missing(f.kind, f.data || {}, ctx) }));
  const totalMissing = issues.reduce((s, x) => s + x.m.length, 0);
  async function act(path, body, msg) { try { await flush(); await call(`/periods/${id}${path}`, body || {}); if (msg) toast(msg); await load(sel); } catch (e) { toast(e.message); } }
  async function addForm(kind) { setAdding(false); try { const r = await call(`/periods/${id}/forms`, { kind, after: ["204", "214", "213", "attachment"].includes(kind) ? undefined : undefined }); await load(r.id); setSel(r.id); } catch (e) { toast(e.message); } }
  async function moveForm(fid, dir) { try { await call(`/forms/${fid}/move`, { dir }); await load(fid); } catch (e) { toast(e.message); } }
  async function removeForm(f) { if (!window.confirm(`Remove ${formLabel(f, d.kinds)} from this IAP?`)) return; try { await call(`/forms/${f.id}/remove`, {}); await load(); } catch (e) { toast(e.message); } }
  const idx = d.periods.findIndex(x => x.id === id);
  const status = saving[sel];
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}><ChevronLeft size={15} /> {inc.name}</button>
        <span style={{ flex: 1 }} />
        {idx > 0 && <button style={btn("outline")} onClick={() => onOpenPeriod(d.periods[idx - 1].id)}>‹ Period {d.periods[idx - 1].seq}</button>}
        {idx < d.periods.length - 1 && <button style={btn("outline")} onClick={() => onOpenPeriod(d.periods[idx + 1].id)}>Period {d.periods[idx + 1].seq} ›</button>}
      </div>
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: INK }}>Operational period {p.seq}</div>
            {times ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                <input aria-label="Period starts" type="datetime-local" style={{ ...inputStyle, width: "auto" }} value={times.starts} onChange={e => setTimes({ ...times, starts: e.target.value })} /> to
                <input aria-label="Period ends" type="datetime-local" style={{ ...inputStyle, width: "auto" }} value={times.ends} onChange={e => setTimes({ ...times, ends: e.target.value })} />
                <button style={btn("primary")} onClick={() => act("", times, "Times saved.").then(() => setTimes(null))}>Save</button><button style={btn("ghost")} onClick={() => setTimes(null)}>Cancel</button>
              </div>
            ) : <div style={{ fontSize: 13.5, color: INK_SOFT }}>{pretty(p.starts)} – {pretty(p.ends)} {!readOnly && <button style={{ ...btn("ghost"), padding: "0 4px", fontSize: 12.5 }} onClick={() => setTimes({ starts: p.starts, ends: p.ends })}>change</button>}</div>}
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              {p.status === "approved" ? <span style={{ color: SAGE, fontWeight: 700 }}><Lock size={12} style={{ verticalAlign: -1 }} /> Approved by {p.approvedBy}{p.approvedAt ? `, ${new Date(p.approvedAt).toLocaleString()}` : ""}. Locked.</span>
                : totalMissing ? <span style={{ color: AMBER, fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> Draft · {totalMissing} item{totalMissing === 1 ? "" : "s"} still to fill in</span>
                : <span style={{ color: SAGE, fontWeight: 700 }}><CheckCircle2 size={12} style={{ verticalAlign: -1 }} /> Draft · everything's filled in</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={btn("primary")} onClick={async () => { await flush(); printIap({ incident: inc, period: p, forms: d.forms, files: d.files }); }}><Printer size={14} /> Print IAP</button>
            {acc.edit && <button style={btn("outline")} onClick={() => act("/notify", {}, "Sent to everyone named in this IAP.")}><Bell size={14} /> Notify assigned</button>}
            {d.canApprove && p.status !== "approved" && <button style={btn("outline")} onClick={() => setApproving(true)}><CheckCircle2 size={14} /> Approve</button>}
            {d.canApprove && p.status === "approved" && <button style={btn("outline")} onClick={() => window.confirm("Reopen this IAP for changes? The approval is removed until it's approved again.") && act("/reopen", {}, "Reopened.")}><Unlock size={14} /> Reopen</button>}
            {acc.manage && p.status !== "approved" && <button style={{ ...btn("ghost"), color: BRICK }} onClick={async () => { if (window.confirm(`Delete operational period ${p.seq} and its forms?`)) { await call(`/periods/${id}/remove`, {}); onBack(); } }}>Delete</button>}
          </div>
        </div>
        {approving && (
          <div style={{ marginTop: 12, padding: 12, background: PAPER, borderRadius: 9 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Approve this IAP</div>
            {totalMissing > 0 && <div style={{ color: AMBER, fontSize: 13, marginBottom: 6 }}>{totalMissing} items are still blank (see the list). You can approve anyway.</div>}
            <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 6 }}>Sign below (optional): it prints on the ICS 202. Approving locks the IAP.</div>
            <SignaturePad onChange={setSig} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button style={btn("primary")} onClick={() => act("/approve", { signature: sig || undefined }, "Approved.").then(() => setApproving(false))}>Approve{sig ? " (with signature)" : ""}</button>
              <button style={btn("ghost")} onClick={() => setApproving(false)}>Cancel</button></div>
          </div>
        )}
        {conflict && <div role="alert" style={{ marginTop: 10, color: BRICK, fontSize: 13 }}>{conflict} <button style={btn("outline")} onClick={() => load(sel)}>Reload</button></div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)", gap: 12, alignItems: "start" }} className="imt-grid">
        <style>{"@media (max-width: 900px) { .imt-grid { grid-template-columns: 1fr !important; } }"}</style>
        <div style={{ ...cardStyle, padding: 6 }}>
          {issues.map(({ f, m }, i) => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 4, borderRadius: 7, background: f.id === sel ? "#E8F0FA" : "transparent" }}>
              <button type="button" onClick={() => setSel(f.id)} aria-current={f.id === sel ? "page" : undefined}
                style={{ flex: 1, textAlign: "left", border: "none", background: "none", padding: "7px 8px", cursor: "pointer", fontSize: 13, color: INK, fontWeight: f.id === sel ? 800 : 600 }}>
                {formLabel(f, d.kinds)}
                <div style={{ fontSize: 11, fontWeight: 600, color: m.length ? AMBER : SAGE }}>{m.length ? `${m.length} to fill in` : "✓ complete"}</div>
              </button>
              {!readOnly && f.id === sel && <>
                <button aria-label="Move up" style={{ ...btn("ghost"), padding: 3 }} disabled={i === 0} onClick={() => moveForm(f.id, "up")}><ArrowUp size={13} /></button>
                <button aria-label="Move down" style={{ ...btn("ghost"), padding: 3 }} disabled={i === issues.length - 1} onClick={() => moveForm(f.id, "down")}><ArrowDown size={13} /></button>
                <button aria-label={`Remove ${formLabel(f, d.kinds)}`} style={{ ...btn("ghost"), padding: 3, color: BRICK }} onClick={() => removeForm(f)}><Trash2 size={13} /></button></>}
            </div>
          ))}
          {!readOnly && (adding ? (
            <div style={{ padding: 6 }}>
              <select aria-label="Form to add" autoFocus style={inputStyle} defaultValue="" onChange={e => e.target.value && addForm(e.target.value)}>
                <option value="">Choose a form…</option>
                {Object.entries(d.kinds).filter(([k]) => ["204", "211", "213", "214", "attachment"].includes(k) || !d.forms.some(f => f.kind === k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          ) : <button style={{ ...btn("outline"), margin: 6 }} onClick={() => setAdding(true)}><Plus size={14} /> Add a form</button>)}
        </div>
        <div>
          {form && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: INK, flex: 1 }}>{d.kinds[form.kind]}</div>
                <span role="status" style={{ fontSize: 12, color: status === "error" ? BRICK : INK_SOFT }}>{status === "saving" ? "Saving…" : status === "unsaved" ? "Editing…" : status === "saved" ? "Saved" : status === "error" ? "Not saved" : ""}</span>
              </div>
              {(() => { const m = missing(form.kind, form.data || {}, ctx); return m.length && !readOnly ? <div style={{ fontSize: 12.5, color: AMBER, marginBottom: 8 }}>Still to fill in: {m.join(", ")}</div> : null; })()}
              {readOnly && <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}><Lock size={12} style={{ verticalAlign: -1 }} /> {p.status === "approved" ? "Approved: reopen it to make changes." : "Read-only."}</div>}
              <fieldset disabled={readOnly} style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
                <Editor key={form.id} formId={form.id} d={form.data || {}} set={data => change(form.id, data)} ctx={ctx} />
              </fieldset>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- The section ---------------------------------------------------------------------------------
export default function ImtModule({ onBack, init }) {
  const [view, setView] = useState(init?.period ? { kind: "period", id: init.period } : init?.incident ? { kind: "incident", id: init.incident } : { kind: "list" });
  const [d, setD] = useState(null), [error, setError] = useState(""), [msg, setMsg] = useState(""), [showClosed, setShowClosed] = useState(false);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? "" : x)), 5000); };
  const load = () => call("").then(setD, e => setError(e.message));
  useEffect(() => { load(); }, [view.kind]);
  const acc = d?.access || {};
  const openPeriod = async pid => setView({ kind: "period", id: pid });
  const active = (d?.incidents || []).filter(i => i.status !== "closed");
  const nav = [
    { key: "list", label: "Incidents", icon: Siren },
    ...(acc.manage ? [{ key: "new", label: "New incident", icon: Plus, group: "Actions" }, { key: "import", label: "Start from an IAP PDF", icon: Upload, group: "Actions" }] : []),
    ...active.slice(0, 8).map(i => ({ key: `inc:${i.id}`, label: i.name, icon: FileText, group: "Active incidents" })),
  ];
  const activeKey = view.kind === "incident" ? `inc:${view.id}` : view.kind === "list" ? "list" : view.kind;
  const go = k => k.startsWith("inc:") ? setView({ kind: "incident", id: k.slice(4) }) : setView({ kind: k });
  let page;
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) page = <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  else if (view.kind === "new") page = <IncidentForm onCancel={() => setView({ kind: "list" })} onSaved={id => setView({ kind: "incident", id })} />;
  else if (view.kind === "import") page = <ImportIap onCancel={() => setView({ kind: "list" })} onDone={r => setView({ kind: "period", id: r.periodId })} />;
  else if (view.kind === "incident") page = <IncidentView key={view.id} id={view.id} toast={toast} onBack={() => setView({ kind: "list" })} onOpenPeriod={openPeriod} />;
  else if (view.kind === "period") page = <PeriodView key={view.id} id={view.id} toast={toast} onOpenPeriod={openPeriod}
    onBack={async () => { try { const r = await call(`/periods/${view.id}`); setView({ kind: "incident", id: r.incident.id }); } catch { setView({ kind: "list" }); } }} />;
  else {
    const list = (d.incidents || []).filter(i => showClosed || i.status !== "closed");
    page = (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: INK_SOFT, flex: 1 }}>Incidents run under NIMS / ICS (hurricanes, floods, winter storms…). Each operational period is its own IAP.</div>
          <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Show closed</label>
          {acc.manage && <button style={btn("primary")} onClick={() => setView({ kind: "new" })}><Plus size={14} /> New incident</button>}
        </div>
        {list.length === 0 && <div style={{ ...cardStyle, color: INK_SOFT }}>{acc.view ? "No incidents yet." : "No incidents you're part of. When you're named in an IAP, it shows here."}</div>}
        {list.map(i => (
          <div key={i.id} role="button" tabIndex={0} aria-label={`Open ${i.name}`} onClick={() => setView({ kind: "incident", id: i.id })} onKeyDown={e => e.key === "Enter" && setView({ kind: "incident", id: i.id })}
            style={{ ...cardStyle, cursor: "pointer", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Siren size={26} color={i.status === "closed" ? INK_SOFT : BRICK} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: INK }}>{i.name}</div>
              <div style={{ fontSize: 13, color: INK_SOFT }}>{[i.number, i.kind, i.location].filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{ fontSize: 13, textAlign: "right" }}>
              <div>{i.periods} operational period{i.periods === 1 ? "" : "s"}</div>
              {i.latest && <div style={{ color: i.latest.status === "approved" ? SAGE : AMBER, fontWeight: 700 }}>Period {i.latest.seq}: {i.latest.status === "approved" ? "approved" : "draft"}</div>}
              {i.status === "closed" && <div style={{ color: INK_SOFT }}>Closed</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <AppShell section="IMT" nav={nav} active={activeKey} onNav={go} onHome={onBack} wide>
      <h1 style={{ fontSize: 22, margin: "0 0 12px", color: INK }}>{view.kind === "period" ? "Incident Action Plan" : view.kind === "new" ? "New incident" : view.kind === "import" ? "Start from an IAP PDF" : "IMT"}</h1>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
    </AppShell>
  );
}
