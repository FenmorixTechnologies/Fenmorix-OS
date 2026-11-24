// Fire investigations (arson) with CJIS controls: authenticator-app second factor, the CJIS list, need-to-know cases,
// encrypted criminal history with a dissemination log, append-only access log with weekly review. Server:
// server/investigations.js (+ auth.js mfa-*). Nothing here is cached in the browser: data lives in component state only,
// and after 30 minutes without activity the page drops it and asks for a new code.
import React, { useEffect, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { ShieldAlert, FolderOpen, Plus, Search, KeyRound, ScrollText, Printer, Lock, Users, X } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, printDocument, letterhead, escapeHtml } from "./App.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00";
class NeedError extends Error { constructor(m, need, missing) { super(m); this.need = need; this.missing = missing; } }
async function call(path, body) {
  const r = await fetch(`/api/${path}`, body === undefined ? { credentials: "same-origin", cache: "no-store" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (j.need) throw new NeedError(j.error, j.need, j.missing); throw new Error(j.error || "That didn't work."); }
  return j;
}
const inv = (p, b) => call(`inv/${p}`, b);
const when = d => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const day = d => d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const todayISO = () => new Date().toLocaleDateString("en-CA");
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" };
const td = { padding: "7px 9px", verticalAlign: "top", borderBottom: `1px solid ${LINE}` };
const Err = ({ e }) => e ? <div role="alert" style={{ color: BRICK, fontSize: 13.5, margin: "6px 0" }}>{e}</div> : null;
const Field = ({ l, children, w }) => <label style={{ display: "block", minWidth: w || 180, flex: w ? "0 0 auto" : 1 }}><span style={label}>{l}</span>{children}</label>;
const readDataUrl = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error("Couldn't read the file.")); r.readAsDataURL(f); });
const CJI_BANNER = <div style={{ background: "#FDECEE", border: `1px solid ${BRICK}`, color: BRICK, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 700 }}>CJI: criminal justice information. Authorized personnel only. Every view is logged; release only through "Release / print" so it's on the dissemination log.</div>;

// ---- Second factor -----------------------------------------------------------------------------------
function QrCode({ rows }) {
  const n = rows.length, q = 4;
  return (
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} width="220" height="220" style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8 }} shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((c, x) => c === "1" ? <rect key={`${x}-${y}`} x={x + q} y={y + q} width="1" height="1" fill="#000" /> : null))}
    </svg>
  );
}
function CodeBox({ onCode, busy, label: l = "6-digit code" }) {
  const [code, setCode] = useState("");
  return (
    <form onSubmit={e => { e.preventDefault(); onCode(code); setCode(""); }} style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <Field l={l} w={180}><input aria-label="Authenticator code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, width: 160 }} value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ""))} /></Field>
      <button type="submit" style={btn("primary")} disabled={busy || code.replace(/\s/g, "").length !== 6}>Continue</button>
    </form>
  );
}
function MfaSetup({ onDone }) {
  const [s, setS] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { call("auth/mfa-setup", {}).then(setS, e => setError(e.message)); }, []);
  const [codes, setCodes] = useState(null);
  const confirm = async code => { setBusy(true); setError(""); try { const r = await call("auth/mfa-confirm", { code }); if (r?.recoveryCodes?.length) setCodes(r.recoveryCodes); else onDone(); } catch (e) { setError(e.message); } setBusy(false); };
  if (codes) return (
    <div style={{ ...cardStyle, maxWidth: 640 }}>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}><KeyRound size={18} /> Save your recovery codes</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 10 }}>If you lose your phone, each code signs you in to {PN} once instead of an authenticator code. Keep them somewhere safe; they won't be shown again.</div>
      <div aria-label="Recovery codes" style={{ fontFamily: "monospace", fontSize: 15, display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "2px 22px", background: "#F3F5F8", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>{codes.map(c => <span key={c}>{c}</span>)}</div>
      <button style={btn("primary")} onClick={onDone}>I've saved them</button>
    </div>
  );
  return (
    <div style={{ ...cardStyle, maxWidth: 640 }}>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}><KeyRound size={18} /> Set up your authenticator app</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 10 }}>CJIS requires a second sign-in step for anyone who can reach criminal justice information. On your phone, open <b>Microsoft Authenticator</b> or <b>Google Authenticator</b>, add an account, and scan this code. Then type the 6-digit code it shows.</div>
      {s && <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <QrCode rows={s.qr} />
        <div style={{ fontSize: 13, color: INK_SOFT, maxWidth: 300 }}>Can't scan? Choose "enter a setup key" and type:<div style={{ fontFamily: "monospace", fontSize: 15, color: INK, margin: "6px 0", wordBreak: "break-all" }} aria-label="Setup key">{s.secret}</div>Account: {BRAND.app}, time-based.</div>
      </div>}
      <div style={{ marginTop: 12 }}><CodeBox onCode={confirm} busy={busy} /></div>
      <Err e={error} />
    </div>
  );
}
function MfaVerify({ onDone, reason }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const go = async code => { setBusy(true); setError(""); try { await call("auth/mfa-verify", { code }); onDone(); } catch (e) { setError(e.message); } setBusy(false); };
  return (
    <div style={{ ...cardStyle, maxWidth: 520 }}>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}><Lock size={18} /> Investigations is locked</div>
      <div style={{ fontSize: 13.5, marginBottom: 10 }}>{reason || "Enter the code from your authenticator app."} You'll be asked again after 30 minutes without activity here, and every 12 hours.</div>
      <CodeBox onCode={go} busy={busy} />
      <Err e={error} />
    </div>
  );
}

// ---- Case list ----------------------------------------------------------------------------------------
function CaseList({ st, open, onNeed }) {
  const [d, setD] = useState(null), [f, setF] = useState({ status: "", q: "" }), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [nc, setNc] = useState({ title: "", address: "", incidentNo: "", incidentDate: "", occupancy: "" });
  const [lq, setLq] = useState(""), [lookup, setLookup] = useState(null);
  const load = () => inv(`cases?status=${f.status}&q=${encodeURIComponent(f.q)}`).then(setD, e => e.need ? onNeed(e) : setError(e.message));
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h); }, [f.status, f.q]);
  const create = async () => { setError(""); try { const r = await inv("cases", nc); open(r.id); } catch (e) { e.need ? onNeed(e) : setError(e.message); } };
  const look = async () => { setError(""); try { setLookup((await inv(`lookup?q=${encodeURIComponent(lq)}`)).matches); } catch (e) { e.need ? onNeed(e) : setError(e.message); } };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <Field l="Status" w={160}><select aria-label="Status filter" style={inputStyle} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">Any</option>{Object.entries(st.lists.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field l="Search my cases"><input aria-label="Search cases" style={inputStyle} value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="Case #, title, address, incident #" /></Field>
        <button style={btn("primary")} onClick={() => setCreating(!creating)}><Plus size={14} /> New case</button>
      </div>
      {creating && <div style={{ ...cardStyle, display: "grid", gap: 8 }} role="region" aria-label="New case">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Title"><input aria-label="Case title" style={inputStyle} value={nc.title} onChange={e => setNc({ ...nc, title: e.target.value })} placeholder="e.g. 123 Example Rd – vehicle fire" /></Field>
          <Field l="Address"><input aria-label="Case address" style={inputStyle} value={nc.address} onChange={e => setNc({ ...nc, address: e.target.value })} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Incident #" w={160}><input aria-label="Incident number" style={inputStyle} value={nc.incidentNo} onChange={e => setNc({ ...nc, incidentNo: e.target.value })} /></Field>
          <Field l="Incident date" w={170}><input aria-label="Incident date" type="date" style={inputStyle} value={nc.incidentDate} onChange={e => setNc({ ...nc, incidentDate: e.target.value })} /></Field>
          <Field l="Occupancy"><input aria-label="Occupancy" style={inputStyle} value={nc.occupancy} onChange={e => setNc({ ...nc, occupancy: e.target.value })} placeholder="Single-family dwelling, vehicle, vacant structure…" /></Field>
        </div>
        <div><button style={btn("primary")} onClick={create}>Open the case</button> <span style={{ fontSize: 12.5, color: INK_SOFT }}>You'll be the lead investigator.</span></div>
      </div>}
      <Err e={error} />
      {d && <div style={{ ...cardStyle, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Case</th><th style={th}>Title</th><th style={th}>Status</th><th style={th}>Lead</th><th style={th}>Updated</th></tr></thead>
          <tbody>{d.cases.map(k => (
            <tr key={k.id}><td style={td}><button style={{ ...btn("ghost"), padding: 0, fontWeight: 800 }} onClick={() => open(k.id)} aria-label={`Open case ${k.caseNo}`}>{k.caseNo}</button></td>
              <td style={td}>{k.title}<div style={{ fontSize: 12, color: INK_SOFT }}>{k.address}</div></td><td style={td}>{st.lists.statuses[k.status]}</td><td style={td}>{k.lead}</td><td style={td}>{when(k.updatedAt)}</td></tr>))}</tbody>
        </table>
        {d.cases.length === 0 && <div style={{ color: INK_SOFT, fontSize: 13.5, padding: 8 }}>{d.manage ? "No cases yet." : "You aren't on any cases yet."}</div>}
      </div>}
      <div style={cardStyle} role="region" aria-label="Deconfliction lookup">
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Is there already a case?</div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>Search every case by address or incident number. You'll see only the case number, status and lead, so you know who to call.</div>
        <div style={{ display: "flex", gap: 8 }}><input aria-label="Lookup" style={inputStyle} value={lq} onChange={e => setLq(e.target.value)} placeholder="Address or incident #" /><button style={btn("outline")} onClick={look}><Search size={14} /> Look up</button></div>
        {lookup && <div style={{ marginTop: 8, fontSize: 13.5 }}>{lookup.length ? lookup.map(m => <div key={m.caseNo}>Case <b>{m.caseNo}</b> · {st.lists.statuses[m.status]} · lead {m.lead || "—"}</div>) : "No case matches."}</div>}
      </div>
    </div>
  );
}

// ---- One case -----------------------------------------------------------------------------------------
const TABS = [["summary", "Summary & cause"], ["people", "People"], ["evidence", "Evidence"], ["files", "Photos & files"], ["supplements", "Supplements"], ["cji", "Criminal history"], ["team", "Investigators"]];
function CaseView({ id, st, onBack, onNeed, toast }) {
  const [k, setK] = useState(null), [tab, setTab] = useState("summary"), [error, setError] = useState("");
  const load = () => inv(`cases/${id}`).then(x => { setK(x); setError(""); }, e => e.need ? onNeed(e) : setError(e.message));
  useEffect(() => { load(); }, [id]);
  const act = async (path, body, msg) => { setError(""); try { const r = await inv(path, body); if (msg) toast(msg); await load(); return r; } catch (e) { e.need ? onNeed(e) : setError(e.message); return null; } };
  if (error && !k) return <div style={{ ...cardStyle, color: BRICK }}>{error} <button style={btn("ghost")} onClick={onBack}>Back</button></div>;
  if (!k) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const L = st.lists;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 700 }}>CASE {k.caseNo} · {L.statuses[k.status]} · {L.classes[k.classification]}</div>
          <div style={{ fontSize: 19, fontWeight: 800 }}>{k.title}</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>{k.address}{k.incidentNo ? ` · Incident ${k.incidentNo}` : ""}{k.incidentDate ? ` · ${day(k.incidentDate)}` : ""}</div>
        </div>
        <button style={btn("outline")} onClick={async () => { if (await act(`cases/${id}/print`, {})) printCase(k, L); }}><Printer size={14} /> Print case file</button>
        <button style={btn("ghost")} onClick={onBack}>All cases</button>
      </div>
      <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {TABS.map(([key, l]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} style={{ ...btn(tab === key ? "primary" : "outline"), padding: "6px 12px" }}>{l}{key === "cji" && k.cji.length ? ` (${k.cji.filter(c => !c.purgedAt).length})` : ""}</button>)}
      </div>
      <Err e={error} />
      {tab === "summary" && <SummaryTab k={k} L={L} save={b => act(`cases/${id}`, b, "Saved")} />}
      {tab === "people" && <PeopleTab k={k} L={L} act={act} />}
      {tab === "evidence" && <EvidenceTab k={k} L={L} act={act} />}
      {tab === "files" && <FilesTab k={k} act={act} />}
      {tab === "supplements" && <SupplementsTab k={k} act={act} />}
      {tab === "cji" && <CjiTab k={k} L={L} act={act} onNeed={onNeed} toast={toast} reload={load} />}
      {tab === "team" && <TeamTab k={k} act={act} />}
    </div>
  );
}
function SummaryTab({ k, L, save }) {
  const [f, setF] = useState({ title: k.title, address: k.address, incidentNo: k.incidentNo, incidentDate: k.incidentDate, occupancy: k.occupancy, status: k.status, classification: k.classification,
    originArea: k.originArea, heatSource: k.heatSource, firstIgnited: k.firstIgnited, summary: k.summary || "", causeNarrative: k.causeNarrative || "", notes: k.notes || "",
    daReferral: { date: "", office: "", number: "", ...k.daReferral }, juvenileReferral: !!k.juvenileReferral });
  const set = (a, v) => setF(x => ({ ...x, [a]: v }));
  const inp = (a, l, props = {}) => <Field l={l} w={props.w}><input aria-label={l} style={inputStyle} value={f[a] || ""} onChange={e => set(a, e.target.value)} {...props} /></Field>;
  return (
    <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{inp("title", "Title")}{inp("address", "Address")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {inp("incidentNo", "Incident #", { w: 150 })}{inp("incidentDate", "Incident date", { type: "date", w: 170 })}{inp("occupancy", "Occupancy")}
        <Field l="Status" w={170}><select aria-label="Case status" style={inputStyle} value={f.status} onChange={e => set("status", e.target.value)}>{Object.entries(L.statuses).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Field>
      </div>
      <div style={{ fontWeight: 800, marginTop: 4 }}>Origin and cause (NFPA 921)</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field l="Classification" w={180}><select aria-label="Classification" style={inputStyle} value={f.classification} onChange={e => set("classification", e.target.value)}>{Object.entries(L.classes).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Field>
        {inp("originArea", "Area of origin")}{inp("heatSource", "Heat source")}{inp("firstIgnited", "First item ignited")}
      </div>
      <Field l="Summary"><textarea aria-label="Summary" style={{ ...inputStyle, minHeight: 80 }} value={f.summary} onChange={e => set("summary", e.target.value)} /></Field>
      <Field l="Cause narrative (hypotheses tested, eliminated causes, conclusion)"><textarea aria-label="Cause narrative" style={{ ...inputStyle, minHeight: 120 }} value={f.causeNarrative} onChange={e => set("causeNarrative", e.target.value)} /></Field>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <Field l="DA referral date" w={170}><input aria-label="DA referral date" type="date" style={inputStyle} value={f.daReferral.date} onChange={e => set("daReferral", { ...f.daReferral, date: e.target.value })} /></Field>
        <Field l="DA office"><input aria-label="DA office" style={inputStyle} value={f.daReferral.office} onChange={e => set("daReferral", { ...f.daReferral, office: e.target.value })} /></Field>
        <Field l="DA case #" w={150}><input aria-label="DA case number" style={inputStyle} value={f.daReferral.number} onChange={e => set("daReferral", { ...f.daReferral, number: e.target.value })} /></Field>
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.juvenileReferral} onChange={e => set("juvenileReferral", e.target.checked)} /> Juvenile firesetter referral</label>
      </div>
      <Field l="Notes"><textarea aria-label="Case notes" style={{ ...inputStyle, minHeight: 60 }} value={f.notes} onChange={e => set("notes", e.target.value)} /></Field>
      <div><button style={btn("primary")} onClick={() => save(f)}>Save</button></div>
    </div>
  );
}
function PeopleTab({ k, L, act }) {
  const blank = { id: null, role: "witness", name: "", dob: "", phone: "", address: "", notes: "" };
  const [p, setP] = useState(blank);
  const save = async () => { if (await act(`cases/${k.id}/people`, p, p.id ? "Updated" : "Person added")) setP(blank); };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Role</th><th style={th}>Name</th><th style={th}>DOB</th><th style={th}>Phone</th><th style={th}>Address</th><th style={th}>Notes</th><th style={th}></th></tr></thead>
          <tbody>{k.people.map(x => <tr key={x.id}><td style={td}>{L.personRoles[x.role]}</td><td style={td}><b>{x.name}</b></td><td style={td}>{day(x.dob)}</td><td style={td}>{x.phone}</td><td style={td}>{x.address}</td><td style={{ ...td, whiteSpace: "pre-wrap" }}>{x.notes}</td>
            <td style={td}><button style={btn("ghost")} onClick={() => setP({ ...blank, ...x })}>Edit</button><button style={{ ...btn("ghost"), color: BRICK }} onClick={() => window.confirm(`Remove ${x.name} from the case?`) && act(`people/${x.id}/remove`, {}, "Removed")}>Remove</button></td></tr>)}</tbody>
        </table>
        {!k.people.length && <div style={{ color: INK_SOFT, fontSize: 13.5, padding: 6 }}>Nobody added yet.</div>}
      </div>
      <div style={{ ...cardStyle, display: "grid", gap: 8 }} role="region" aria-label="Person editor">
        <div style={{ fontWeight: 800 }}>{p.id ? `Edit ${p.name}` : "Add a person"}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Role" w={150}><select aria-label="Person role" style={inputStyle} value={p.role} onChange={e => setP({ ...p, role: e.target.value })}>{Object.entries(L.personRoles).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Field>
          <Field l="Name"><input aria-label="Person name" style={inputStyle} value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field>
          <Field l="Date of birth" w={170}><input aria-label="Date of birth" type="date" style={inputStyle} value={p.dob} onChange={e => setP({ ...p, dob: e.target.value })} /></Field>
          <Field l="Phone" w={160}><input aria-label="Person phone" style={inputStyle} value={p.phone} onChange={e => setP({ ...p, phone: e.target.value })} /></Field>
        </div>
        <Field l="Address"><input aria-label="Person address" style={inputStyle} value={p.address} onChange={e => setP({ ...p, address: e.target.value })} /></Field>
        <Field l="Notes"><textarea aria-label="Person notes" style={{ ...inputStyle, minHeight: 50 }} value={p.notes} onChange={e => setP({ ...p, notes: e.target.value })} /></Field>
        <div><button style={btn("primary")} onClick={save}>{p.id ? "Save" : "Add person"}</button>{p.id && <button style={btn("ghost")} onClick={() => setP(blank)}>Cancel</button>}</div>
      </div>
    </div>
  );
}
function EvidenceTab({ k, L, act }) {
  const blank = { id: null, description: "", foundLocation: "", collectedAt: "", collectedBy: "", storage: "", status: "held" };
  const [e, setE] = useState(blank), [cu, setCu] = useState({});
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {k.evidence.map(x => (
        <div key={x.id} style={cardStyle} role="region" aria-label={`Evidence item ${x.itemNo}`}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, flex: 1 }}>Item {x.itemNo}: {x.description}</div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: INK_SOFT }}>{L.evidenceStatus[x.status]}</span>
            <button style={btn("ghost")} onClick={() => setE({ ...blank, ...x, collectedAt: x.collectedAt ? new Date(new Date(x.collectedAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "" })}>Edit</button>
          </div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>Found: {x.foundLocation || "—"} · Collected {when(x.collectedAt) || "—"} by {x.collectedBy || "—"} · Stored: {x.storage || "—"}</div>
          <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>Chain of custody</div>
          {x.custody.length ? <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><tbody>{x.custody.map(c => <tr key={c.id}><td style={td}>{when(c.at)}</td><td style={td}>{c.releasedBy} → <b>{c.receivedBy}</b></td><td style={td}>{c.purpose}</td><td style={{ ...td, color: INK_SOFT, fontSize: 12 }}>{c.note}{c.note ? " · " : ""}entered by {c.enteredBy}</td></tr>)}</tbody></table>
            : <div style={{ fontSize: 13, color: INK_SOFT }}>No transfers yet.</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "end", marginTop: 6, background: PAPER, padding: 8, borderRadius: 8 }}>
            {[["at", "When", "datetime-local", 200], ["releasedBy", "Released by", "text"], ["receivedBy", "Received by", "text"], ["purpose", "Purpose", "text"]].map(([a, l, t, w]) =>
              <Field key={a} l={l} w={w || 140}><input aria-label={`${l} item ${x.itemNo}`} type={t} style={inputStyle} value={cu[x.id]?.[a] ?? (a === "at" ? nowLocal() : "")} onChange={ev => setCu({ ...cu, [x.id]: { ...cu[x.id], [a]: ev.target.value } })} /></Field>)}
            <button style={btn("outline")} onClick={async () => { const b = { at: nowLocal(), ...cu[x.id] }; if (await act(`evidence/${x.id}/custody`, { ...b, at: new Date(b.at).toISOString() }, "Custody recorded")) setCu({ ...cu, [x.id]: {} }); }}>Record transfer</button>
          </div>
        </div>))}
      <div style={{ ...cardStyle, display: "grid", gap: 8 }} role="region" aria-label="Evidence editor">
        <div style={{ fontWeight: 800 }}>{e.id ? `Edit item ${e.itemNo}` : "Log an item of evidence"}</div>
        <Field l="Description"><input aria-label="Evidence description" style={inputStyle} value={e.description} onChange={ev => setE({ ...e, description: ev.target.value })} placeholder="e.g. Debris sample from area of origin, sealed can" /></Field>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Where found"><input aria-label="Where found" style={inputStyle} value={e.foundLocation} onChange={ev => setE({ ...e, foundLocation: ev.target.value })} /></Field>
          <Field l="Collected" w={210}><input aria-label="Collected at" type="datetime-local" style={inputStyle} value={e.collectedAt} onChange={ev => setE({ ...e, collectedAt: ev.target.value })} /></Field>
          <Field l="Collected by" w={170}><input aria-label="Collected by" style={inputStyle} value={e.collectedBy} onChange={ev => setE({ ...e, collectedBy: ev.target.value })} /></Field>
          <Field l="Stored at"><input aria-label="Stored at" style={inputStyle} value={e.storage} onChange={ev => setE({ ...e, storage: ev.target.value })} /></Field>
          <Field l="Status" w={150}><select aria-label="Evidence status" style={inputStyle} value={e.status} onChange={ev => setE({ ...e, status: ev.target.value })}>{Object.entries(L.evidenceStatus).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Field>
        </div>
        <div><button style={btn("primary")} onClick={async () => { if (await act(`cases/${k.id}/evidence`, { ...e, collectedAt: e.collectedAt ? new Date(e.collectedAt).toISOString() : "" }, e.id ? "Item updated" : "Item logged")) setE(blank); }}>{e.id ? "Save item" : "Log item"}</button>
          {e.id && <button style={btn("ghost")} onClick={() => setE(blank)}>Cancel</button>}</div>
      </div>
    </div>
  );
}
function FilesTab({ k, act }) {
  const [caption, setCaption] = useState(""), [busy, setBusy] = useState(false);
  const up = async files => { setBusy(true); for (const f of files) await act(`cases/${k.id}/files`, { name: f.name, dataUrl: await readDataUrl(f), caption }, `${f.name} added`); setCaption(""); setBusy(false); };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <Field l="Caption (optional)"><input aria-label="File caption" style={inputStyle} value={caption} onChange={e => setCaption(e.target.value)} /></Field>
        <input aria-label="Add photos or files" type="file" multiple disabled={busy} onChange={e => up([...e.target.files])} />
      </div>
      <div style={{ ...cardStyle }}>
        {k.files.length ? <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}><tbody>{k.files.map(f => (
          <tr key={f.id}><td style={td}><a href={`/api/inv/files/${f.id}`} target="_blank" rel="noreferrer">{f.name}</a><div style={{ fontSize: 12, color: INK_SOFT }}>{f.caption}</div></td>
            <td style={td}>{Math.round(f.size / 1024)} KB</td><td style={{ ...td, fontSize: 12, color: INK_SOFT }}>{f.by} · {when(f.at)}</td>
            <td style={td}>{k.manage && <button style={{ ...btn("ghost"), color: BRICK }} onClick={() => window.confirm(`Remove ${f.name}?`) && act(`files/${f.id}/remove`, {}, "Removed")}>Remove</button>}</td></tr>))}</tbody></table>
          : <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No files yet. Files are encrypted on the server and every opening is logged.</div>}
      </div>
    </div>
  );
}
function SupplementsTab({ k, act }) {
  const [text, setText] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {k.supplements.map(s => <div key={s.id} style={cardStyle}><div style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 700 }}>{s.author} · {when(s.at)}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 14, marginTop: 4 }}>{s.text}</div></div>)}
      <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
        <Field l="New supplement (can't be changed once added; add another to correct it)"><textarea aria-label="Supplement" style={{ ...inputStyle, minHeight: 120 }} value={text} onChange={e => setText(e.target.value)} /></Field>
        <div><button style={btn("primary")} onClick={async () => { if (await act(`cases/${k.id}/supplements`, { text }, "Supplement added")) setText(""); }}>Add supplement</button></div>
      </div>
    </div>
  );
}
function CjiTab({ k, L, act, onNeed, toast, reload }) {
  const blank = { personId: "", kind: "ncic", runOn: todayISO(), runBy: "", purpose: "C", subject: "", result: "", notes: "", file: null };
  const [f, setF] = useState(blank), [open, setOpen] = useState(null), [rel, setRel] = useState({ releasedTo: "", agency: "", purpose: "", method: "print" }), [error, setError] = useState("");
  const view = async id => { setError(""); try { setOpen(await inv(`cji/${id}`)); } catch (e) { e.need ? onNeed(e) : setError(e.message); } };
  const release = async () => {
    setError("");
    try {
      const r = await inv(`cji/${open.id}/disseminate`, rel);
      toast(`Release logged: ${rel.releasedTo}`);
      if (rel.method === "print") printDocument(`Criminal history – case ${r.caseNo}`, `${letterhead("Fire Investigations · CJI · Authorized personnel only")}
        <h1>Criminal history – case ${escapeHtml(r.caseNo)}</h1><p><b>${escapeHtml(L.cjiKinds[r.kind])}</b> run ${escapeHtml(r.runOn)} by ${escapeHtml(r.runBy)}</p>
        <p><b>Subject:</b> ${escapeHtml(r.subject || "")}</p><pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(r.result || "")}</pre>
        <p style="font-size:11px">Released to ${escapeHtml(rel.releasedTo)}${rel.agency ? `, ${escapeHtml(rel.agency)}` : ""} for ${escapeHtml(rel.purpose)}. CJI: do not copy or further disseminate.</p>`);
      setRel({ releasedTo: "", agency: "", purpose: "", method: "print" }); view(open.id); reload();
    } catch (e) { e.need ? onNeed(e) : setError(e.message); }
  };
  const personName = id => k.people.find(p => p.id === id)?.name || "";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {CJI_BANNER}
      <Err e={error} />
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Check</th><th style={th}>Person</th><th style={th}>Run</th><th style={th}>Releases</th><th style={th}></th></tr></thead>
          <tbody>{k.cji.map(c => <tr key={c.id}><td style={td}>{L.cjiKinds[c.kind]}</td><td style={td}>{personName(c.personId)}</td><td style={td}>{day(c.runOn)} by {c.runBy}</td><td style={td}>{c.releases}</td>
            <td style={td}>{c.purgedAt ? <span style={{ color: INK_SOFT, fontSize: 12.5 }}>Purged {day(c.purgedAt)} by {c.purgedBy}: {c.purgeReason}</span>
              : <><button style={btn("outline")} onClick={() => view(c.id)} aria-label={`View check ${c.id}`}>View</button>
                {k.manage && <button style={{ ...btn("ghost"), color: BRICK }} onClick={async () => { const reason = window.prompt("Why is this being purged? (e.g. case closed, retention period met)"); if (reason) { await act(`cji/${c.id}/purge`, { reason }, "Purged"); if (open?.id === c.id) setOpen(null); } }}>Purge</button>}</>}</td></tr>)}</tbody>
        </table>
        {!k.cji.length && <div style={{ color: INK_SOFT, fontSize: 13.5, padding: 6 }}>No criminal history on this case.</div>}
      </div>
      {open && <div style={{ ...cardStyle, borderLeft: `6px solid ${BRICK}` }} role="region" aria-label="Criminal history result">
        <div style={{ display: "flex" }}><div style={{ fontWeight: 800, flex: 1 }}>{L.cjiKinds[open.kind]} · {open.subject}</div><button aria-label="Close result" style={btn("ghost")} onClick={() => setOpen(null)}><X size={14} /></button></div>
        <div style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "6px 0" }}>{open.result}</div>
        {open.notes && <div style={{ fontSize: 13, color: INK_SOFT }}>Notes: {open.notes}</div>}
        {open.fileName && <div><a href={`/api/inv/cji/${open.id}/file`} target="_blank" rel="noreferrer">Printout: {open.fileName}</a></div>}
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>Dissemination log</div>
        {open.releases.length ? open.releases.map((x, i) => <div key={i} style={{ fontSize: 13 }}>{when(x.at)} · {x.by} → {x.releasedTo}{x.agency ? `, ${x.agency}` : ""} ({x.method}): {x.purpose}</div>) : <div style={{ fontSize: 13, color: INK_SOFT }}>Not released to anyone.</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "end", marginTop: 8, background: PAPER, padding: 8, borderRadius: 8 }}>
          <Field l="Released to"><input aria-label="Released to" style={inputStyle} value={rel.releasedTo} onChange={e => setRel({ ...rel, releasedTo: e.target.value })} /></Field>
          <Field l="Agency"><input aria-label="Agency" style={inputStyle} value={rel.agency} onChange={e => setRel({ ...rel, agency: e.target.value })} /></Field>
          <Field l="Purpose"><input aria-label="Release purpose" style={inputStyle} value={rel.purpose} onChange={e => setRel({ ...rel, purpose: e.target.value })} /></Field>
          <Field l="How" w={140}><select aria-label="Release method" style={inputStyle} value={rel.method} onChange={e => setRel({ ...rel, method: e.target.value })}>{["print", "in person", "secure email", "other"].map(m => <option key={m}>{m}</option>)}</select></Field>
          <button style={btn("primary")} onClick={release}>Release / print</button>
        </div>
      </div>}
      <div style={{ ...cardStyle, display: "grid", gap: 8 }} role="region" aria-label="Enter criminal history">
        <div style={{ fontWeight: 800 }}>Enter a check you ran</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Check" w={170}><select aria-label="Check kind" style={inputStyle} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{Object.entries(L.cjiKinds).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select></Field>
          <Field l="Person on the case"><select aria-label="CJI person" style={inputStyle} value={f.personId} onChange={e => setF({ ...f, personId: e.target.value, subject: f.subject || personName(e.target.value) })}><option value="">—</option>{k.people.map(p => <option key={p.id} value={p.id}>{p.name} ({L.personRoles[p.role]})</option>)}</select></Field>
          <Field l="Date run" w={170}><input aria-label="Date run" type="date" style={inputStyle} value={f.runOn} onChange={e => setF({ ...f, runOn: e.target.value })} /></Field>
          <Field l="Purpose code" w={110}><input aria-label="Purpose code" style={inputStyle} value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value })} /></Field>
        </div>
        <Field l="Subject (as queried)"><input aria-label="CJI subject" style={inputStyle} value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></Field>
        <Field l="Result"><textarea aria-label="CJI result" style={{ ...inputStyle, minHeight: 100 }} value={f.result} onChange={e => setF({ ...f, result: e.target.value })} /></Field>
        <Field l="Notes"><input aria-label="CJI notes" style={inputStyle} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        <input aria-label="Printout" type="file" accept=".pdf,image/*" onChange={async e => { const x = e.target.files[0]; setF({ ...f, file: x ? { name: x.name, dataUrl: await readDataUrl(x) } : null }); }} />
        <div><button style={btn("primary")} onClick={async () => { if (await act(`cases/${k.id}/cji`, f, "Criminal history saved (encrypted)")) setF(blank); }}>Save</button></div>
      </div>
    </div>
  );
}
function TeamTab({ k, act }) {
  const [who, setWho] = useState(""), [role, setRole] = useState("investigator");
  return (
    <div style={cardStyle}>
      {k.members.map(m => <div key={m.userId} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>
        <b style={{ flex: 1 }}>{m.name}</b><span style={{ fontSize: 12.5, color: INK_SOFT }}>{m.role === "lead" ? "Lead investigator" : "Investigator"}</span>
        {k.canLead && k.members.length > 1 && <button style={{ ...btn("ghost"), color: BRICK }} onClick={() => act(`cases/${k.id}/members/${m.userId}/remove`, {}, "Removed")}>Remove</button>}</div>)}
      {k.canLead ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 10 }}>
        <Field l="Add an investigator (CJIS list)"><select aria-label="Add investigator" style={inputStyle} value={who} onChange={e => setWho(e.target.value)}><option value="">Choose…</option>
          {k.candidates.filter(c => !k.members.some(m => m.userId === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field l="As" w={160}><select aria-label="Investigator role" style={inputStyle} value={role} onChange={e => setRole(e.target.value)}><option value="investigator">Investigator</option><option value="lead">Lead investigator</option></select></Field>
        <button style={btn("primary")} disabled={!who} onClick={async () => { if (await act(`cases/${k.id}/members`, { userId: who, role }, "Added")) setWho(""); }}>Add</button>
      </div> : <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8 }}>The lead investigator or the Chief of Fire Prevention changes who's on the case.</div>}
    </div>
  );
}
function printCase(k, L) {
  const rows = (pairs) => `<table>${pairs.map(([a, b]) => `<tr><th style="width:180px">${escapeHtml(a)}</th><td>${escapeHtml(b || "")}</td></tr>`).join("")}</table>`;
  printDocument(`Case ${k.caseNo}`, `${letterhead("Fire Investigations · Law enforcement sensitive")}
    <h1>Case ${escapeHtml(k.caseNo)}: ${escapeHtml(k.title)}</h1>
    ${rows([["Address", k.address], ["Incident", `${k.incidentNo} ${k.incidentDate}`], ["Occupancy", k.occupancy], ["Status", L.statuses[k.status]], ["Classification", L.classes[k.classification]],
      ["Area of origin", k.originArea], ["Heat source", k.heatSource], ["First item ignited", k.firstIgnited], ["Investigators", k.members.map(m => `${m.name}${m.role === "lead" ? " (lead)" : ""}`).join(", ")]])}
    <h2>Summary</h2><p style="white-space:pre-wrap">${escapeHtml(k.summary || "")}</p><h2>Cause</h2><p style="white-space:pre-wrap">${escapeHtml(k.causeNarrative || "")}</p>
    <h2>People</h2>${rows(k.people.map(p => [L.personRoles[p.role], `${p.name}${p.phone ? ` · ${p.phone}` : ""}${p.address ? ` · ${p.address}` : ""}`]))}
    <h2>Evidence</h2>${k.evidence.map(e => `<p><b>Item ${e.itemNo}:</b> ${escapeHtml(e.description)} (${escapeHtml(L.evidenceStatus[e.status])})<br/>${e.custody.map(c => `${escapeHtml(new Date(c.at).toLocaleString())}: ${escapeHtml(c.releasedBy)} → ${escapeHtml(c.receivedBy)} ${escapeHtml(c.purpose)}`).join("<br/>")}</p>`).join("")}
    <h2>Supplements</h2>${k.supplements.map(s => `<p><b>${escapeHtml(s.author)}, ${escapeHtml(new Date(s.at).toLocaleString())}</b><br/><span style="white-space:pre-wrap">${escapeHtml(s.text)}</span></p>`).join("")}
    <p style="font-size:11px">Criminal history is not included. Release it from the case's Criminal history tab so it's logged.</p>`);
}

// ---- Managers: CJIS list, access log ----------------------------------------------------------------------
function CjisList({ onNeed, toast }) {
  const [d, setD] = useState(null), [ed, setEd] = useState(null), [error, setError] = useState("");
  const load = () => inv("cjis").then(setD, e => e.need ? onNeed(e) : setError(e.message));
  useEffect(() => { load(); }, []);
  const save = async () => { setError(""); try { await inv("cjis", ed); toast("CJIS list updated"); setEd(null); load(); } catch (e) { e.need ? onNeed(e) : setError(e.message); } };
  const authCall = async (body, msg) => { setError(""); try { await call("auth/mfa-reset", body); toast(msg); load(); } catch (e) { setError(e.message); } };
  if (!d) return <div style={{ color: INK_SOFT }}>{error || "Loading…"}</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 13, color: INK_SOFT }}>Everyone with Investigations access in User Management. To open Investigations they also need a fingerprint-based background check and CJIS security awareness training (renewed every year) recorded here, and an authenticator app. Master admins can see everything, so they need to be on this list too.</div>
      <Err e={error} />
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr><th style={th}>Person</th><th style={th}>Access</th><th style={th}>Background check</th><th style={th}>Training (due)</th><th style={th}>Authenticator</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>{d.people.map(p => (
            <tr key={p.id} aria-label={p.name}><td style={td}><b>{p.name}</b><div style={{ fontSize: 12, color: INK_SOFT }}>{p.title} · {p.division}</div></td>
              <td style={td}>{p.role === "master" ? "Master admin" : p.level === "manage" ? "Manager" : p.level === "edit" ? "Investigator" : <span style={{ color: AMBER }}>none</span>}</td>
              <td style={td}>{day(p.cjis.backgroundDate) || "—"}</td><td style={td}>{day(p.cjis.trainingDate) || "—"}{p.cjis.trainingDue ? <div style={{ fontSize: 12, color: p.cjis.trainingDue < todayISO() ? BRICK : INK_SOFT }}>due {day(p.cjis.trainingDue)}</div> : null}</td>
              <td style={td}>{p.lockedAt ? <span style={{ color: BRICK, fontWeight: 700 }}>Locked</span> : p.mfaAt ? "Set up" : <span style={{ color: AMBER }}>Not yet</span>}</td>
              <td style={td}>{p.cjis.ok ? <span style={{ color: SAGE, fontWeight: 700 }}>Authorized</span> : <span style={{ color: BRICK, fontSize: 12.5 }}>{p.cjis.missing.join("; ")}</span>}</td>
              <td style={td}><button style={btn("ghost")} onClick={() => setEd({ userId: p.id, name: p.name, backgroundDate: p.cjis.backgroundDate || "", backgroundRef: p.cjis.backgroundRef || "", trainingDate: p.cjis.trainingDate || "", note: p.cjis.note || "" })}>Edit</button>
                {p.lockedAt && <button style={btn("ghost")} onClick={() => authCall({ userId: p.id, unlockOnly: true }, "Lock released")}>Release lock</button>}
                {p.mfaAt && <button style={btn("ghost")} onClick={() => window.confirm(`Reset ${p.name}'s authenticator? They'll set it up again on their phone.`) && authCall({ userId: p.id }, "Authenticator reset")}>Reset authenticator</button>}
                {p.cjis.listed && <button style={{ ...btn("ghost"), color: BRICK }} onClick={async () => { if (window.confirm(`Remove ${p.name} from the CJIS list?`)) { try { await inv(`cjis/${p.id}/revoke`, {}); toast("Removed"); load(); } catch (e) { setError(e.message); } } }}>Remove</button>}</td></tr>))}</tbody>
        </table>
      </div>
      {ed && <div style={{ ...cardStyle, display: "grid", gap: 8 }} role="region" aria-label="CJIS record">
        <div style={{ fontWeight: 800 }}>{ed.name}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Field l="Fingerprint background check date" w={220}><input aria-label="Background check date" type="date" style={inputStyle} value={ed.backgroundDate} onChange={e => setEd({ ...ed, backgroundDate: e.target.value })} /></Field>
          <Field l="Reference (no SSN)" w={200}><input aria-label="Background reference" style={inputStyle} value={ed.backgroundRef} onChange={e => setEd({ ...ed, backgroundRef: e.target.value })} /></Field>
          <Field l="CJIS security awareness training" w={220}><input aria-label="Training date" type="date" style={inputStyle} value={ed.trainingDate} onChange={e => setEd({ ...ed, trainingDate: e.target.value })} /></Field>
        </div>
        <Field l="Note"><input aria-label="CJIS note" style={inputStyle} value={ed.note} onChange={e => setEd({ ...ed, note: e.target.value })} /></Field>
        <div><button style={btn("primary")} onClick={save}>Save</button><button style={btn("ghost")} onClick={() => setEd(null)}>Cancel</button></div>
      </div>}
    </div>
  );
}
function AccessLog({ onNeed, toast }) {
  const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return d.toLocaleDateString("en-CA"); };
  const [f, setF] = useState({ from: new Date(Date.now() - 7 * 86400e3).toLocaleDateString("en-CA"), to: todayISO(), user: "", case: "" });
  const [d, setD] = useState(null), [note, setNote] = useState(""), [error, setError] = useState("");
  const qs = new URLSearchParams(f).toString();
  const load = () => inv(`log?${qs}`).then(setD, e => e.need ? onNeed(e) : setError(e.message));
  useEffect(() => { load(); }, [qs]);
  const signOff = async () => { try { await inv("reviews", { weekStart: monday(), note }); toast("Weekly review signed off"); setNote(""); load(); } catch (e) { e.need ? onNeed(e) : setError(e.message); } };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <Field l="From" w={160}><input aria-label="Log from" type="date" style={inputStyle} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field l="To" w={160}><input aria-label="Log to" type="date" style={inputStyle} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        <Field l="Person"><input aria-label="Log person" style={inputStyle} value={f.user} onChange={e => setF({ ...f, user: e.target.value })} /></Field>
        <Field l="Case #" w={120}><input aria-label="Log case" style={inputStyle} value={f.case} onChange={e => setF({ ...f, case: e.target.value })} /></Field>
        <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/inv/log?${qs}&format=csv`}>CSV</a>
      </div>
      <Err e={error} />
      <div style={{ ...cardStyle, display: "grid", gap: 6 }} role="region" aria-label="Weekly review">
        <div style={{ fontWeight: 800 }}>Weekly review (CJIS: audit records reviewed at least weekly)</div>
        <div style={{ fontSize: 13 }}>{d?.reviews?.length ? d.reviews.slice(0, 4).map(r => <div key={r.weekStart}>Week of {day(r.weekStart)}: {r.by}, {when(r.at)}{r.note ? ` · ${r.note}` : ""}</div>) : "No reviews signed off yet."}</div>
        <div style={{ display: "flex", gap: 8 }}><input aria-label="Review note" style={inputStyle} placeholder="Anything unusual? (optional)" value={note} onChange={e => setNote(e.target.value)} /><button style={btn("primary")} onClick={signOff}>Sign off last week ({day(monday())})</button></div>
      </div>
      {d && d.fails.length > 0 && <div style={{ ...cardStyle }} role="region" aria-label="Failed sign-ins">
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Failed sign-ins and authenticator events</div>
        {d.fails.map((x, i) => <div key={i} style={{ fontSize: 13 }}>{when(x.at)} · {x.user} · {x.what}{x.detail ? `: ${x.detail}` : ""}</div>)}
      </div>}
      {d && <div style={{ ...cardStyle, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr><th style={th}>When</th><th style={th}>Who</th><th style={th}>Case</th><th style={th}>What</th><th style={th}>From</th></tr></thead>
          <tbody>{d.rows.map((x, i) => <tr key={i}><td style={td}>{when(x.at)}</td><td style={td}>{x.user}</td><td style={td}>{x.caseNo}</td><td style={td}>{x.what}</td><td style={{ ...td, color: INK_SOFT }}>{x.ip}</td></tr>)}</tbody>
        </table>
      </div>}
    </div>
  );
}

// ---- Module ------------------------------------------------------------------------------------------------
export default function InvestigationsModule({ onBack }) {
  const [st, setSt] = useState(null), [need, setNeed] = useState(null), [view, setView] = useState({ kind: "list" }), [msg, setMsg] = useState(""), [error, setError] = useState("");
  const idle = useRef(null);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? "" : x)), 5000); };
  const loadStatus = () => inv("status").then(s => {
    setSt(s);
    const n = !s.rights.edit ? { need: "access" } : s.mfa.locked ? { need: "locked" } : !s.mfa.enabled ? { need: "mfa_setup" } : !s.mfa.verified ? { need: "mfa" }
      : !s.cjis.ok ? { need: "cjis", missing: s.cjis.missing } : null;
    setNeed(n);
    if (n?.need === "cjis" && s.rights.manage) setView({ kind: "cjis" });
  }, e => setError(e.message));
  useEffect(() => { loadStatus(); }, []);
  // 30 minutes without activity: drop what's on screen and ask for a code again (the server enforces the same)
  useEffect(() => {
    const reset = () => { clearTimeout(idle.current); idle.current = setTimeout(() => setNeed({ need: "mfa", message: "Locked after 30 minutes without activity." }), (st?.idleMinutes || 30) * 60e3); };
    reset(); const ev = ["mousedown", "keydown", "touchstart"]; ev.forEach(e => window.addEventListener(e, reset));
    return () => { clearTimeout(idle.current); ev.forEach(e => window.removeEventListener(e, reset)); };
  }, [st]);
  const onNeed = e => setNeed({ need: e.need, missing: e.missing, message: e.message });
  const manage = st?.rights?.manage;
  const nav = [
    { key: "list", label: "Cases", icon: FolderOpen },
    ...(manage ? [{ key: "cjis", label: "CJIS list", icon: Users, group: "Chief of Fire Prevention" }, { key: "log", label: "Access log", icon: ScrollText, group: "Chief of Fire Prevention" }] : []),
  ];
  let page;
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!st) page = <div style={{ color: INK_SOFT }}>Loading…</div>;
  else if (need?.need === "access") page = <div style={cardStyle}>Investigations is open only to fire investigators and the Chief of Fire Prevention.</div>;
  else if (need?.need === "cjis" && manage) page = <div style={{ display: "grid", gap: 10 }}><div style={{ ...cardStyle, borderLeft: `6px solid ${AMBER}`, fontSize: 13.5 }}>You can keep the CJIS list, but cases stay closed to you until you're on it yourself: {(need.missing || []).join("; ")}.</div><CjisList onNeed={onNeed} toast={m => { toast(m); loadStatus(); }} /></div>;
  else if (need?.need === "cjis") page = <div style={{ ...cardStyle, borderLeft: `6px solid ${AMBER}` }}><b>You're not cleared for Investigations yet.</b><ul>{(need.missing || []).map(m => <li key={m}>{m}</li>)}</ul><div style={{ fontSize: 13, color: INK_SOFT }}>The Chief of Fire Prevention records background checks and CJIS training on the CJIS list.</div></div>;
  else if (need?.need === "locked") page = <div style={{ ...cardStyle, borderLeft: `6px solid ${BRICK}` }}><b>Your authenticator is locked</b> after too many wrong codes. The Chief of Fire Prevention or a master admin can release it.</div>;
  else if (need?.need === "mfa_setup") page = <MfaSetup onDone={() => { setNeed(null); loadStatus(); }} />;
  else if (need?.need === "mfa") page = <MfaVerify reason={need.message} onDone={() => { setNeed(null); loadStatus(); }} />;
  else if (view.kind === "case") page = <CaseView key={view.id} id={view.id} st={st} onBack={() => setView({ kind: "list" })} onNeed={onNeed} toast={toast} />;
  else if (view.kind === "cjis") page = <CjisList key={view.n} onNeed={onNeed} toast={toast} />;
  else if (view.kind === "log") page = <AccessLog key={view.n} onNeed={onNeed} toast={toast} />;
  else page = <CaseList key={view.n} st={st} open={id => setView({ kind: "case", id })} onNeed={onNeed} />;
  const titles = { list: "Fire investigations", case: "Case", cjis: "CJIS list", log: "Access log" };
  return (
    <AppShell section="Investigations" nav={need ? (need.need === "cjis" && manage ? nav.filter(n => n.key === "cjis") : []) : nav} active={view.kind === "case" ? "list" : view.kind} onNav={k => setView({ kind: k, n: Date.now() })} onHome={onBack}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}><ShieldAlert size={22} color={BRICK} /><h1 style={{ fontSize: 22, margin: 0, color: INK }}>{titles[view.kind]}</h1></div>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
    </AppShell>
  );
}
