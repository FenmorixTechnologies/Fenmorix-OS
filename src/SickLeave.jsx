// Sick Leave: call-outs logged by each division, hours used, habitual patterns and a risk score for coming shifts
// (server/sick.js has the model). Pages: Outlook, People, Call-outs, Log a call-out, Settings.
import React, { useEffect, useMemo, useState } from "react";
import { Thermometer, CalendarClock, Users, ClipboardList, Plus, Settings, CalendarDays, AlertTriangle, Download, Trash2, Pencil, X, Info } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { WORK_PATTERNS } from "./shifts.js";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function api(path, body) {
  const r = await fetch(`/api/sick${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pretty = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const short = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const hrs = h => `${Math.round(h * 100) / 100} h`;
const scoreColor = s => (s >= 7 ? BRICK : s >= 4 ? AMBER : SAGE);
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left" }, td = { padding: "7px 9px", verticalAlign: "top" };

function Score({ s, big }) {
  return <span title="Risk score 0-10" style={{ display: "inline-block", minWidth: big ? 64 : 42, textAlign: "center", fontWeight: 800, fontSize: big ? 22 : 13.5, color: "#fff",
    background: scoreColor(s), borderRadius: 8, padding: big ? "6px 10px" : "2px 7px" }}>{s.toFixed(1)}</span>;
}
function Guide() {
  return <div style={{ ...cardStyle, background: "#F7F9FC", fontSize: 13, color: INK_SOFT, display: "flex", gap: 10 }}>
    <Info size={18} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
    <div>Patterns and scores are a starting point for staffing and for a conversation, not proof that sick leave was misused. Protected leave (FMLA, on-duty
      injury, approved medical accommodation) is listed but never counted. Don't record diagnoses or symptoms here: a doctor's note is just "on file".</div></div>;
}

// ---- Log a call-out ------------------------------------------------------------------------------------
function LogForm({ meta, toast, onDone, preset }) {
  const editable = meta.people.filter(p => p.canEdit);
  const [f, setF] = useState({ userId: preset || "", from: new Date().toLocaleDateString("en-CA"), to: "", hours: "", kind: Object.keys(meta.kinds).find(k => !meta.kinds[k].off) || "sick", noteOnFile: false, calledAt: "", notes: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const person = editable.find(p => p.id === f.userId);
  async function save() {
    try { const r = await api("/entries", { ...f, hours: f.hours === "" ? undefined : Number(f.hours) }); toast(`Logged ${r.days.length} shift${r.days.length === 1 ? "" : "s"}${r.updated ? ` (${r.updated} updated)` : ""}.`); onDone(); }
    catch (e) { toast(e.message); }
  }
  if (!editable.length) return <div style={cardStyle}>You can see call-outs but not log them. Logging needs Sick leave: Edit for the person's division.</div>;
  return (
    <div style={{ ...cardStyle, maxWidth: 640 }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Log a sick call-out</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Person</span>
          <select aria-label="Person" style={inputStyle} value={f.userId} onChange={e => set("userId", e.target.value)}>
            <option value="">Choose…</option>{editable.map(p => <option key={p.id} value={p.id}>{p.name} · {p.division}</option>)}</select></label>
        <label><span style={label}>Day (first day)</span><input aria-label="First day" type="date" style={inputStyle} value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label><span style={label}>Through (optional)</span><input aria-label="Last day" type="date" style={inputStyle} value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <label><span style={label}>Hours per shift</span><input aria-label="Hours" type="number" step="0.25" style={inputStyle} value={f.hours} placeholder={person ? String(person.hours) : ""} onChange={e => set("hours", e.target.value)} /></label>
        <label><span style={label}>Type</span><select aria-label="Type" style={inputStyle} value={f.kind} onChange={e => set("kind", e.target.value)}>
          {Object.entries(meta.kinds).filter(([k, v]) => !v.off || k === f.kind).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label><span style={label}>Called out at (optional)</span><input aria-label="Called out at" type="datetime-local" style={inputStyle} value={f.calledAt} onChange={e => set("calledAt", e.target.value)} /></label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 18 }}><input type="checkbox" checked={f.noteOnFile} onChange={e => set("noteOnFile", e.target.checked)} /> Doctor's note on file</label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Notes (no medical details)</span><input aria-label="Notes" style={inputStyle} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. called the BC at 0545; covered by OT" /></label>
      </div>
      {f.to && f.to > f.from && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8 }}>One entry is made for each day {person ? person.name.split(" ")[0] : "they"} {person?.schedule?.missing ? "(shift not set, so every day)" : "was scheduled"} in that range.</div>}
      {meta.kinds[f.kind]?.protected && <div style={{ fontSize: 12.5, color: SAGE, marginTop: 8 }}>Protected leave: kept in their totals, never counted in patterns or risk.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button style={btn("primary")} disabled={!f.userId || !f.from} onClick={save}><Plus size={14} /> Log call-out</button></div>
    </div>
  );
}

// ---- Call-outs list ------------------------------------------------------------------------------------
function EntryEdit({ e, meta, onClose, onSaved, toast }) {
  const [f, setF] = useState({ day: e.day, hours: e.hours, kind: e.kind, noteOnFile: e.noteOnFile, notes: e.notes });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return <div role="dialog" aria-label={`Change ${e.name || ""} ${e.day}`} style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
    <div style={{ ...cardStyle, width: "min(480px, 100%)", marginBottom: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>{e.name}: {pretty(e.day)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label><span style={label}>Day</span><input aria-label="Day" type="date" style={inputStyle} value={f.day} onChange={x => set("day", x.target.value)} /></label>
        <label><span style={label}>Hours</span><input aria-label="Hours" type="number" step="0.25" style={inputStyle} value={f.hours} onChange={x => set("hours", x.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Type</span><select aria-label="Type" style={inputStyle} value={f.kind} onChange={x => set("kind", x.target.value)}>{Object.entries(meta.kinds).filter(([k, v]) => !v.off || k === f.kind).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={f.noteOnFile} onChange={x => set("noteOnFile", x.target.checked)} /> Doctor's note on file</label>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Notes</span><input aria-label="Notes" style={inputStyle} value={f.notes} onChange={x => set("notes", x.target.value)} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={btn("primary")} onClick={async () => { try { await api(`/entries/${e.id}`, { ...f, hours: Number(f.hours) }); onSaved(); } catch (x) { toast(x.message); } }}>Save</button>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
        <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={async () => { if (!window.confirm("Delete this call-out?")) return; try { await api(`/entries/${e.id}/remove`, {}); onSaved(); } catch (x) { toast(x.message); } }}><Trash2 size={13} /> Delete</button>
      </div>
    </div>
  </div>;
}
function EntriesTable({ entries, meta, onEdit, showName = true }) {
  const canEdit = id => meta.people.find(p => p.id === id)?.canEdit;
  return <div style={{ overflowX: "auto" }}><table aria-label="Call-outs" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
    <thead><tr style={{ background: PAPER }}><th style={th}>Day</th>{showName && <th style={th}>Name</th>}<th style={th}>Hours</th><th style={th}>Type</th><th style={th}>Note</th><th style={th}>Logged by</th><th style={th} /></tr></thead>
    <tbody>{entries.map(e => <tr key={e.id} style={{ borderTop: `1px solid ${LINE}` }}>
      <td style={{ ...td, whiteSpace: "nowrap" }}>{pretty(e.day)}{e.calledAt ? <div style={{ fontSize: 11.5, color: INK_SOFT }}>called {e.calledAt.slice(11)}</div> : null}</td>
      {showName && <td style={td}><b>{e.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{e.division}</div></td>}
      <td style={td}>{hrs(e.hours)}</td>
      <td style={td}>{meta.kinds[e.kind]?.label || e.kind}{e.protected ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: SAGE }}>not counted</span> : null}</td>
      <td style={td}>{e.noteOnFile ? "Doctor's note" : ""}{e.notes ? <div style={{ fontSize: 12, color: INK_SOFT }}>{e.notes}</div> : null}</td>
      <td style={{ ...td, fontSize: 12.5, color: INK_SOFT }}>{e.enteredBy}</td>
      <td style={{ ...td, textAlign: "right" }}>{canEdit(e.userId) && <button aria-label={`Change call-out ${e.day}`} style={{ ...btn("ghost"), padding: "2px 7px" }} onClick={() => onEdit(e)}><Pencil size={13} /></button>}</td>
    </tr>)}
    {!entries.length && <tr><td colSpan={7} style={{ ...td, color: INK_SOFT }}>No call-outs.</td></tr>}</tbody></table></div>;
}
function Entries({ meta, toast }) {
  const [q, setQ] = useState({ from: "", to: "", division: "", user: "" }), [d, setD] = useState(null), [edit, setEdit] = useState(null);
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v))).toString();
  const load = () => api(`/entries?${qs}`).then(setD, e => toast(e.message));
  useEffect(() => { load(); }, [qs]);   // eslint-disable-line react-hooks/exhaustive-deps
  const divisions = [...new Set(meta.people.map(p => p.division))].sort();
  const total = (d?.entries || []).reduce((a, e) => a + e.hours, 0);
  return <div>
    <div style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label><span style={label}>From</span><input aria-label="From" type="date" style={{ ...inputStyle, width: "auto" }} value={q.from} onChange={e => setQ(x => ({ ...x, from: e.target.value }))} /></label>
      <label><span style={label}>To</span><input aria-label="To" type="date" style={{ ...inputStyle, width: "auto" }} value={q.to} onChange={e => setQ(x => ({ ...x, to: e.target.value }))} /></label>
      <label><span style={label}>Division</span><select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={q.division} onChange={e => setQ(x => ({ ...x, division: e.target.value }))}><option value="">All</option>{divisions.map(v => <option key={v}>{v}</option>)}</select></label>
      <label><span style={label}>Person</span><select aria-label="Person filter" style={{ ...inputStyle, width: "auto", maxWidth: 220 }} value={q.user} onChange={e => setQ(x => ({ ...x, user: e.target.value }))}><option value="">Everyone</option>{meta.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <span style={{ flex: 1 }} />
      <a href={`/api/sick/entries/export.csv?${qs}`} download style={{ ...btn("outline"), textDecoration: "none" }}><Download size={14} /> CSV</a>
    </div>
    {d && <div style={{ fontSize: 13, color: INK_SOFT, margin: "0 0 8px" }}>{d.entries.length} call-out{d.entries.length === 1 ? "" : "s"}, {hrs(total)} · {pretty(d.from)} to {pretty(d.to)}</div>}
    <div style={{ ...cardStyle, padding: 0 }}>{d ? <EntriesTable entries={d.entries} meta={meta} onEdit={setEdit} /> : <div style={{ padding: 14 }}>Loading…</div>}</div>
    {edit && <EntryEdit e={edit} meta={meta} toast={toast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); toast("Saved."); }} />}
  </div>;
}

// ---- People (analysis) ------------------------------------------------------------------------------------
// Shift choices, the ones that fit the person's division first
const SHIFT_GROUPS = { fire: ["fire:A", "fire:B", "fire:C"], comms: ["comms:A", "comms:B", "comms:C", "comms:D"], weekdays: ["weekdays"] };
const PATTERN_NAME = Object.fromEntries(WORK_PATTERNS);
function ShiftSelect({ value, kind, onChange, name }) {
  const first = SHIFT_GROUPS[kind] || [], rest = WORK_PATTERNS.map(([v]) => v).filter(v => v && !first.includes(v));
  return <select aria-label={`Shift for ${name}`} style={{ ...inputStyle, width: "auto", minWidth: 190 }} value={value} onChange={e => onChange(e.target.value)}>
    <option value="">Choose a shift…</option>
    {first.map(v => <option key={v} value={v}>{PATTERN_NAME[v]}</option>)}
    {rest.length > 0 && <optgroup label="Different schedule (e.g. a weekday chief)">{rest.map(v => <option key={v} value={v}>{PATTERN_NAME[v]}</option>)}</optgroup>}
  </select>;
}
// Set the shift for people whose shift isn't set up yet (Sick leave editors, their divisions)
function SetShifts({ people, onClose, onSaved, toast }) {
  const [vals, setVals] = useState(() => Object.fromEntries(people.map(p => [p.id, p.pattern || ""]))), [busy, setBusy] = useState(false);
  const changes = people.filter(p => vals[p.id] && vals[p.id] !== (p.pattern || ""));
  async function save() {
    setBusy(true);
    try { const r = await api("/shifts", { shifts: changes.map(p => ({ userId: p.id, pattern: vals[p.id] })) }); toast(`Saved ${r.changed} shift${r.changed === 1 ? "" : "s"}.`); onSaved(); }
    catch (e) { toast(e.message); setBusy(false); }
  }
  return <div style={{ position: "fixed", inset: 0, background: "rgba(10,20,40,.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Set shifts" style={{ ...cardStyle, width: "min(620px, 100%)", maxHeight: "85vh", overflowY: "auto", margin: 0 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}><div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>Set shifts</div><button aria-label="Close" style={btn("ghost")} onClick={onClose}><X size={16} /></button></div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10 }}>Pick each person's shift or crew so their patterns and risk score can be worked out. It's saved on their account (the same setting as their punch clock), so other parts of {PN} use it too. They can still change it themselves.</div>
      {people.map(p => <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}><b>{p.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.division}{p.title ? ` · ${p.title}` : ""}</div></div>
        <ShiftSelect name={p.name} kind={p.schedule?.divisionKind || p.schedule?.kind} value={vals[p.id]} onChange={v => setVals(o => ({ ...o, [p.id]: v }))} />
      </div>)}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
        <button style={btn("primary")} disabled={busy || !changes.length} onClick={save}>{busy ? "Saving…" : `Save ${changes.length || ""} shift${changes.length === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  </div>;
}
// Everyone the signed-in editor covers, with their shift: set or change any of them (side bar "Shifts")
function ShiftsPage({ meta, toast, reload }) {
  const editable = meta.people.filter(p => p.canEdit);
  const [vals, setVals] = useState(() => Object.fromEntries(editable.map(p => [p.id, p.pattern || ""])));
  const [division, setDivision] = useState(""), [q, setQ] = useState(""), [onlyUnset, setOnlyUnset] = useState(false), [busy, setBusy] = useState(false);
  const divisions = [...new Set(editable.map(p => p.division))].sort();
  const rows = editable.filter(p => (!division || p.division === division) && (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!onlyUnset || p.schedule?.missing));
  const changes = editable.filter(p => vals[p.id] && vals[p.id] !== (p.pattern || ""));
  const unset = editable.filter(p => p.schedule?.missing).length;
  async function save() {
    setBusy(true);
    try { const r = await api("/shifts", { shifts: changes.map(p => ({ userId: p.id, pattern: vals[p.id] })) }); toast(`Saved ${r.changed} shift${r.changed === 1 ? "" : "s"}.`); reload(); }
    catch (e) { toast(e.message); setBusy(false); }
  }
  if (!editable.length) return <div style={cardStyle}>You can see sick leave but not change it, so you can't set shifts. Someone with Sick leave edit for the division can.</div>;
  return <div>
    <div style={{ ...cardStyle, fontSize: 13.5 }}>Each person's shift or crew decides which days they're scheduled, which their patterns and risk score need. {unset ? <b style={{ color: AMBER }}>{unset} {unset === 1 ? "person has" : "people have"} no shift set.</b> : "Everyone here has a shift."} It's saved on their account (the same setting as their punch clock) and they can still change it themselves. Weekday staff need nothing: Mon–Fri is assumed outside Suppression and Communications.</div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
      <input aria-label="Find a person" placeholder="Find a person" style={{ ...inputStyle, width: 200 }} value={q} onChange={e => setQ(e.target.value)} />
      <select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={division} onChange={e => setDivision(e.target.value)}><option value="">All divisions</option>{divisions.map(v => <option key={v}>{v}</option>)}</select>
      <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyUnset} onChange={e => setOnlyUnset(e.target.checked)} /> Only people with no shift</label>
      <span style={{ flex: 1 }} />
      <button style={btn("primary")} disabled={busy || !changes.length} onClick={save}>{busy ? "Saving…" : changes.length ? `Save ${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"}</button>
    </div>
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}><table aria-label="Shifts" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead><tr style={{ background: PAPER }}><th style={th}>Name</th><th style={th}>Division</th><th style={th}>Now</th><th style={th}>Shift</th></tr></thead>
      <tbody>{rows.map(p => <tr key={p.id} style={{ borderTop: `1px solid ${LINE}`, background: vals[p.id] !== (p.pattern || "") ? "#FFF8E6" : undefined }}>
        <td style={td}><b>{p.name}</b>{p.title ? <div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.title}</div> : null}</td>
        <td style={td}>{p.division}</td>
        <td style={td}><SchedLine s={p.schedule} /></td>
        <td style={td}><ShiftSelect name={p.name} kind={p.schedule?.divisionKind || p.schedule?.kind} value={vals[p.id]} onChange={v => setVals(o => ({ ...o, [p.id]: v }))} /></td>
      </tr>)}
      {!rows.length && <tr><td style={td} colSpan={4}>No one matches.</td></tr>}</tbody></table></div>
  </div>;
}
function PeoplePage({ meta, toast, onOpen, reload }) {
  const [a, setA] = useState(null), [division, setDivision] = useState(""), [sort, setSort] = useState("peak"), [setting, setSetting] = useState(false);
  useEffect(() => { api("/analysis").then(setA, e => toast(e.message)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <div style={cardStyle}>Working it out…</div>;
  const divisions = [...new Set(a.people.map(p => p.division))].sort();
  const rows = a.people.filter(p => !division || p.division === division).sort((x, y) => sort === "name" ? x.name.localeCompare(y.name)
    : sort === "hours" ? y.hoursYear - x.hoursYear : sort === "bradford" ? y.bradford - x.bradford : (y.peak?.score || 0) - (x.peak?.score || 0) || y.S - x.S);
  const unset = rows.filter(p => p.schedule?.missing);
  const canSet = id => meta.people.find(x => x.id === id)?.canEdit;
  const fixable = unset.filter(p => canSet(p.id));
  return <div>
    {setting && <SetShifts people={fixable} toast={toast} onClose={() => setSetting(false)} onSaved={() => { setSetting(false); reload(); }} />}
    {unset.length > 0 && <div role="status" style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}`, fontSize: 13.5 }}><AlertTriangle size={14} color={AMBER} style={{ verticalAlign: -2, marginRight: 6 }} />
      {unset.length} {unset.length === 1 ? "person has" : "people have"} no shift set ({unset.map(p => p.name).slice(0, 6).join(", ")}{unset.length > 6 ? ", …" : ""}). Their call-outs and Bradford factor still count, but patterns and risk need their shift.
      {fixable.length > 0 ? <button style={{ ...btn("primary"), marginLeft: 10, padding: "4px 12px" }} onClick={() => setSetting(true)}>Set their shifts</button>
        : " Someone with Sick leave edit for their division can set it (Shifts in the side bar)."}</div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
      <select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={division} onChange={e => setDivision(e.target.value)}><option value="">All divisions</option>{divisions.map(v => <option key={v}>{v}</option>)}</select>
      <select aria-label="Sort" style={{ ...inputStyle, width: "auto" }} value={sort} onChange={e => setSort(e.target.value)}>
        <option value="peak">Highest risk next 60 days</option><option value="bradford">Bradford factor</option><option value="hours">Sick hours this year</option><option value="name">Name</option></select>
      <span style={{ fontSize: 12.5, color: INK_SOFT }}>Looking back {a.settings.lookbackMonths} months ({pretty(a.from)} on). Department: about {Math.round(a.dept.rate * 1000) / 10}% of scheduled shifts start a call-out (score {a.typicalScore.toFixed(1)}).</span>
    </div>
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}><table aria-label="People" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead><tr style={{ background: PAPER }}><th style={th}>Name</th><th style={th}>Hours this year</th><th style={th}>Call-outs</th><th style={th} title="Occurrences² × shifts missed. A shift is one Bradford 'day': 24 hours in Suppression, 12 in Communications, 8 for everyone else.">Bradford</th><th style={th}>Patterns</th><th style={th}>Highest risk, next 60 days</th></tr></thead>
      <tbody>{rows.map(p => <tr key={p.id} role="button" tabIndex={0} aria-label={`Open ${p.name}`} onClick={() => onOpen(p.id)} onKeyDown={e => { if (e.key === "Enter") onOpen(p.id); }} style={{ borderTop: `1px solid ${LINE}`, cursor: "pointer" }}>
        <td style={td}><b>{p.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.division}{p.title ? ` · ${p.title}` : ""}</div><SchedLine s={p.schedule} /></td>
        <td style={td}>{hrs(p.hoursYear)}{p.protectedHours ? <div style={{ fontSize: 11.5, color: SAGE }}>{hrs(p.protectedHours)} protected</div> : null}</td>
        <td style={td}>{p.S}{p.D > p.S ? <span style={{ color: INK_SOFT, fontSize: 12 }}> ({p.D} shifts)</span> : null}</td>
        <td style={td}>{p.bradford}</td>
        <td style={{ ...td, fontSize: 12.5 }}>{p.patterns.length ? <span style={{ color: AMBER, fontWeight: 700 }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> {p.patterns.length}</span> : <span style={{ color: INK_SOFT }}>none</span>}</td>
        <td style={td}>{p.peak ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Score s={p.peak.score} /> <span style={{ fontSize: 12.5 }}>{short(p.peak.day)}</span></span> : <span style={{ color: INK_SOFT }}>{p.schedule?.missing ? "shift not set" : "not scheduled"}</span>}</td>
      </tr>)}</tbody></table></div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 10 }}>Schedules follow each person's division: Suppression works 24-hour shifts on their A/B/C rotation, Communications 12-hour shifts on their crew's rotation, everyone else 8-hour days Monday–Friday. Bradford factor = call-outs² × shifts missed, where one missed shift counts as one day for that schedule, so compare Bradford scores within a division. The shift letter comes from each person's work pattern (their punch clock setting); Sick leave editors can set it from a person's page or with Set their shifts.</div>
  </div>;
}
function SchedLine({ s }) {
  if (!s) return null;
  return <div style={{ fontSize: 11.5, color: s.missing ? AMBER : INK_SOFT, fontWeight: s.missing ? 700 : 400 }}>{s.label}{s.override ? " (set on their account)" : ""}</div>;
}
function PersonShift({ p, toast, onSaved }) {
  const [open, setOpen] = useState(false), [v, setV] = useState(p.pattern || ""), [busy, setBusy] = useState(false);
  if (!open) return <button style={{ ...btn(p.schedule?.missing ? "primary" : "ghost"), padding: "3px 10px", fontSize: 12.5, marginTop: 6 }} onClick={() => setOpen(true)}>{p.schedule?.missing ? "Set shift" : "Change shift"}</button>;
  async function save() {
    setBusy(true);
    try { await api("/shifts", { shifts: [{ userId: p.id, pattern: v }] }); toast("Shift saved."); onSaved(); }
    catch (e) { toast(e.message); setBusy(false); }
  }
  return <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
    <ShiftSelect name={p.name} kind={p.schedule?.divisionKind || p.schedule?.kind} value={v} onChange={setV} />
    <button style={btn("primary")} disabled={busy || !v || v === (p.pattern || "")} onClick={save}>Save shift</button>
    <button style={btn("ghost")} onClick={() => setOpen(false)}>Cancel</button>
  </div>;
}
function PersonPage({ id, meta, toast, onBack, onLog, reload }) {
  const [a, setA] = useState(null), [edit, setEdit] = useState(null);
  const load = () => api(`/analysis?person=${id}&days=90`).then(x => setA(x), e => toast(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const p = a?.people[0];
  if (!a) return <div style={cardStyle}>Loading…</div>;
  if (!p) return <div style={cardStyle}>Not found.</div>;
  const nextRisky = [...p.forecast].sort((x, y) => y.score - x.score).slice(0, 8).sort((x, y) => x.day.localeCompare(y.day));
  const maxDow = Math.max(1, ...p.dow.map(d => d.n));
  const canEdit = meta.people.find(x => x.id === id)?.canEdit;
  return <div>
    <button style={{ ...btn("ghost"), marginBottom: 8 }} onClick={onBack}>‹ All people</button>
    <div style={{ ...cardStyle, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontSize: 20, fontWeight: 800 }}>{p.name}</div><div style={{ fontSize: 13, color: INK_SOFT }}>{p.division}{p.title ? ` · ${p.title}` : ""}</div><SchedLine s={p.schedule} />
        {canEdit && <PersonShift p={p} toast={toast} onSaved={reload} />}</div>
      {[["Sick hours this year", hrs(p.hoursYear)], [`Call-outs, last ${a.settings.lookbackMonths} months`, `${p.S}${p.D > p.S ? ` (${p.D} shifts)` : ""}`], ["Bradford factor", p.bradford], ["Usual rate", `${Math.round(p.rate * 1000) / 10}% of shifts`]].map(([l, v]) =>
        <div key={l} style={{ minWidth: 110 }}><div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 18, fontWeight: 800 }}>{v}</div></div>)}
      {canEdit && <button style={btn("primary")} onClick={() => onLog(id)}><Plus size={14} /> Log call-out</button>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Patterns</div>
        {!p.patterns.length && <div style={{ fontSize: 13.5, color: INK_SOFT }}>Nothing stands out{p.S < 3 ? " (too few call-outs to tell)" : ""}.</div>}
        {p.patterns.map(x => <div key={x.key} style={{ fontSize: 13.5, padding: "6px 0", borderTop: `1px solid ${LINE}` }}><AlertTriangle size={13} color={AMBER} style={{ verticalAlign: -2, marginRight: 4 }} />{x.text}</div>)}
        <div style={{ fontWeight: 700, fontSize: 13, margin: "12px 0 4px" }}>Call-outs by weekday (first day)</div>
        {p.dow.map(d => <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <span style={{ width: 34, color: INK_SOFT }}>{d.name.slice(0, 3)}</span>
          <span style={{ flex: 1, background: PAPER, height: 12, borderRadius: 3 }}><span style={{ display: "block", width: `${(100 * d.n) / maxDow}%`, height: "100%", background: d.lift >= 1.75 && d.n >= 3 ? AMBER : BLUE, borderRadius: 3 }} /></span>
          <span style={{ width: 22, textAlign: "right" }}>{d.n}</span></div>)}
      </div>
      <div style={cardStyle}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Highest-risk scheduled shifts, next 90 days</div>
        {!nextRisky.length && <div style={{ fontSize: 13.5, color: INK_SOFT }}>Not scheduled in the next 90 days.</div>}
        {nextRisky.map(f => <div key={f.day} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: `1px solid ${LINE}`, fontSize: 13.5 }}>
          <Score s={f.score} /><div><b>{short(f.day)}</b> <span style={{ color: INK_SOFT }}>about {Math.round(f.p * 100)}% chance</span>
            <div style={{ fontSize: 12.5, color: INK_SOFT }}>{f.why.length ? f.why.join("; ") : "their usual rate"}</div></div></div>)}
      </div>
    </div>
    <div style={cardStyle}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Call-outs</div>
      {p.occurrences.filter(o => o.context).length > 0 && <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>Around holidays or their own leave: {p.occurrences.filter(o => o.context).map(o => `${short(o.start)} (${o.context})`).join(" · ")}</div>}
      <EntriesTable entries={[...p.entries].sort((x, y) => y.day.localeCompare(x.day)).map(e => ({ ...e, name: p.name, division: p.division }))} meta={meta} onEdit={setEdit} showName={false} />
    </div>
    {edit && <EntryEdit e={edit} meta={meta} toast={toast} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); toast("Saved."); }} />}
  </div>;
}

// ---- Outlook ----------------------------------------------------------------------------------------------
function Outlook({ meta, toast, onOpen }) {
  const [days, setDays] = useState(30), [min, setMin] = useState(meta.settings.alertScore), [o, setO] = useState(null);
  useEffect(() => { setO(null); api(`/outlook?days=${days}&min=${min}`).then(setO, e => toast(e.message)); }, [days, min]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
      <select aria-label="Days ahead" style={{ ...inputStyle, width: "auto" }} value={days} onChange={e => setDays(Number(e.target.value))}>{[14, 30, 60, 90].map(n => <option key={n} value={n}>Next {n} days</option>)}</select>
      <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>Show scores of <select aria-label="Minimum score" style={{ ...inputStyle, width: "auto" }} value={min} onChange={e => setMin(Number(e.target.value))}>{[3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}</select> and up</label>
      {o && <span style={{ fontSize: 12.5, color: INK_SOFT }}>Typical score {o.typicalScore.toFixed(1)}. Only people scheduled that day (not on their own leave).</span>}
    </div>
    {!o ? <div style={cardStyle}>Working it out…</div> : !o.outlook.length ? <div style={cardStyle}>No holidays and nobody at {min}+ in the next {days} days.</div> :
      o.outlook.map(d => <div key={d.day} style={{ ...cardStyle, padding: "12px 16px", borderLeft: `5px solid ${d.people.length ? scoreColor(d.people[0].score) : LINE}` }}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ fontSize: 15 }}>{pretty(d.day)}</b>{d.holiday && <span style={{ fontSize: 12.5, fontWeight: 700, color: BLUE }}>{d.holiday}</span>}
          <span style={{ fontSize: 12.5, color: INK_SOFT }}>{d.people.length ? `${d.people.length} at ${min}+` : `nobody at ${min}+`}</span></div>
        {d.people.map(p => <div key={p.id} role="button" tabIndex={0} aria-label={`Open ${p.name}`} onClick={() => onOpen(p.id)} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderTop: `1px solid ${LINE}`, cursor: "pointer", fontSize: 13.5 }}>
          <Score s={p.score} /><div><b>{p.name}</b> <span style={{ color: INK_SOFT }}>{p.division} · about {Math.round(p.p * 100)}% chance</span><div style={{ fontSize: 12.5, color: INK_SOFT }}>{p.why.join("; ") || "their usual rate"}</div></div></div>)}
      </div>)}
  </div>;
}

// ---- Settings -------------------------------------------------------------------------------------------
const BUILTIN_KINDS = ["sick", "family", "fmla", "injury", "accommodation"];
function SettingsPage({ meta, toast, reload }) {
  const s = meta.settings;
  const [f, setF] = useState({ lookbackMonths: s.lookbackMonths, windowDays: s.windowDays, alertScore: s.alertScore, removed: s.removed || [], extra: s.extra || [],
    kinds: Object.entries(meta.kinds).map(([key, v]) => ({ key, label: v.label, off: !!v.off, protected: !!v.protected, custom: !!v.custom || !BUILTIN_KINDS.includes(key) })) });
  const [nd, setNd] = useState(""), [nl, setNl] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  return <div style={{ ...cardStyle, maxWidth: 760 }}>
    <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Settings</div>
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      <label><span style={label}>Look back (months)</span><input aria-label="Look back months" type="number" min="6" max="60" style={{ ...inputStyle, width: 110 }} value={f.lookbackMonths} onChange={e => set("lookbackMonths", e.target.value)} /></label>
      <label><span style={label}>Holiday window</span><select aria-label="Holiday window" style={{ ...inputStyle, width: "auto" }} value={f.windowDays} onChange={e => set("windowDays", Number(e.target.value))}>
        <option value={0}>The holiday only</option><option value={1}>The day before, the holiday and the day after</option><option value={2}>Two days either side</option></select></label>
      <label><span style={label}>Alert at a score of</span><input aria-label="Alert score" type="number" min="1" max="10" step="0.5" style={{ ...inputStyle, width: 90 }} value={f.alertScore} onChange={e => set("alertScore", e.target.value)} /></label>
    </div>
    <div style={{ fontWeight: 700, margin: "14px 0 6px" }}>Leave types</div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>Rename them, turn off the ones your organization doesn't use (FMLA, for example), or add your own. Protected types are kept in totals but never counted in patterns or risk.</div>
    {f.kinds.map((k, i) => <div key={k.key || `new${i}`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "3px 0" }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" aria-label={`Use ${k.label}`} checked={!k.off}
        onChange={e => set("kinds", f.kinds.map((x, j) => j === i ? { ...x, off: !e.target.checked } : x))} /> Use</label>
      <input aria-label={`Name of leave type ${i + 1}`} style={{ ...inputStyle, flex: "1 1 260px", opacity: k.off ? 0.55 : 1 }} value={k.label}
        onChange={e => set("kinds", f.kinds.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
      {k.custom ? <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={k.protected}
        onChange={e => set("kinds", f.kinds.map((x, j) => j === i ? { ...x, protected: e.target.checked } : x))} /> Protected</label>
        : <span style={{ fontSize: 12, color: INK_SOFT, minWidth: 70 }}>{k.protected ? "Protected" : ""}</span>}
      {k.custom && <button aria-label={`Remove ${k.label}`} style={{ ...btn("ghost"), color: BRICK, padding: "2px 6px" }} onClick={() => set("kinds", f.kinds.filter((_, j) => j !== i))}><X size={13} /></button>}
    </div>)}
    <button style={{ ...btn("outline"), marginTop: 4 }} onClick={() => set("kinds", [...f.kinds, { key: "", label: "", off: false, protected: false, custom: true }])}><Plus size={13} /> Add a leave type</button>
    <div style={{ fontWeight: 700, margin: "14px 0 6px" }}>Holidays and high-call-out days</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>{meta.defaults.map(l => <label key={l} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
      <input type="checkbox" checked={!f.removed.includes(l)} onChange={e => set("removed", e.target.checked ? f.removed.filter(x => x !== l) : [...f.removed, l])} /> {l}</label>)}</div>
    <div style={{ fontWeight: 700, margin: "12px 0 6px", fontSize: 13.5 }}>Other dates (local events, school breaks, a big game)</div>
    {f.extra.map((h, i) => <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, padding: "2px 0" }}>{pretty(h.day)} · {h.label}
      <button aria-label={`Remove ${h.label}`} style={{ ...btn("ghost"), color: BRICK, padding: "2px 6px" }} onClick={() => set("extra", f.extra.filter((_, j) => j !== i))}><X size={13} /></button></div>)}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <input aria-label="Extra date" type="date" style={{ ...inputStyle, width: "auto" }} value={nd} onChange={e => setNd(e.target.value)} />
      <input aria-label="Extra date name" style={{ ...inputStyle, width: 220 }} placeholder="What it is" value={nl} onChange={e => setNl(e.target.value)} />
      <button style={btn("outline")} disabled={!nd} onClick={() => { set("extra", [...f.extra, { day: nd, label: nl || "Holiday" }]); setNd(""); setNl(""); }}><Plus size={13} /> Add</button>
    </div>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 12 }}>How the score works: each person's usual rate of starting a call-out on a scheduled shift (pulled toward the department's rate when they have little history), raised by any pattern that fits the day (holiday, weekday, next to their own leave), turned into a chance for that shift. Score = 10 × (1 − e<sup>−chance ÷ 15%</sup>): a 10% chance is about 4.9, 20% about 7.4, 35% about 9.0.</div>
    <div style={{ marginTop: 14 }}><button style={btn("primary")} onClick={async () => { try { await api("/settings", { ...f, kinds: f.kinds.filter(k => k.label.trim()), lookbackMonths: Number(f.lookbackMonths), alertScore: Number(f.alertScore) }); toast("Settings saved."); reload(); } catch (e) { toast(e.message); } }}>Save settings</button></div>
  </div>;
}

export default function SickLeaveModule({ onBack }) {
  const [meta, setMeta] = useState(null), [error, setError] = useState(""), [page, setPage] = useState("outlook"), [person, setPerson] = useState(null), [preset, setPreset] = useState(null);
  const [toast, setToast] = useState(null), [nonce, setNonce] = useState(0);
  const say = m => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const load = () => api("").then(setMeta, e => setError(e.message));
  useEffect(() => { load(); }, []);
  const canLog = meta?.people.some(p => p.canEdit);
  const nav = [
    { key: "outlook", label: "Outlook", icon: CalendarDays }, { key: "people", label: "People", icon: Users },
    { key: "entries", label: "Call-outs", icon: ClipboardList }, ...(canLog ? [{ key: "log", label: "Log a call-out", icon: Plus, group: "Actions" }, { key: "shifts", label: "Shifts", icon: CalendarClock, group: "Actions",
      badge: meta.people.filter(p => p.canEdit && p.schedule?.missing).length || undefined }] : []),
    ...(meta?.access.manage ? [{ key: "settings", label: "Settings", icon: Settings, group: "Admin" }] : []),
  ];
  const TITLE = { outlook: ["Outlook", "Coming holidays and the scheduled people most likely to call out"], people: ["People", "Sick hours, call-outs and patterns by person"],
    entries: ["Call-outs", "Every logged call-out"], shifts: ["Shifts", "Set each person's shift or crew"], log: ["Log a call-out", ""], settings: ["Settings", "Holidays and how patterns are scored"], person: ["Person", ""] };
  const open = id => { setPerson(id); setPage("person"); };
  let body;
  if (error) body = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!meta) body = <div style={cardStyle}>Loading…</div>;
  else if (page === "outlook") body = <Outlook key={nonce} meta={meta} toast={say} onOpen={open} />;
  else if (page === "people") body = <PeoplePage key={nonce} meta={meta} toast={say} onOpen={open} reload={() => load().then(() => setNonce(n => n + 1))} />;
  else if (page === "person") body = <PersonPage key={`${person}${nonce}`} id={person} meta={meta} toast={say} reload={() => load().then(() => setNonce(n => n + 1))} onBack={() => setPage("people")} onLog={id => { setPreset(id); setPage("log"); }} />;
  else if (page === "entries") body = <Entries key={nonce} meta={meta} toast={say} />;
  else if (page === "log") body = <LogForm key={preset || "x"} meta={meta} toast={say} preset={preset} onDone={() => { setNonce(n => n + 1); if (preset) { setPerson(preset); setPage("person"); } else setPage("entries"); setPreset(null); }} />;
  else if (page === "shifts") body = <ShiftsPage key={nonce} meta={meta} toast={say} reload={() => load().then(() => setNonce(n => n + 1))} />;
  else if (page === "settings") body = <SettingsPage meta={meta} toast={say} reload={() => load().then(() => setNonce(n => n + 1))} />;
  const [title, sub] = TITLE[page];
  return (
    <AppShell section="Sick Leave" nav={nav} active={page === "person" ? "people" : page} onNav={k => { setPreset(null); setPage(k); }} onHome={onBack} wide>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK }}><Thermometer size={22} style={{ verticalAlign: -3, marginRight: 6 }} />{title}</div>
      {sub && <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 12 }}>{sub}</div>}
      {meta && page !== "log" && page !== "settings" && page !== "shifts" && <Guide />}
      {body}
      {toast && <div role="status" style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, zIndex: 80, maxWidth: "90vw" }}>{toast}</div>}
    </AppShell>
  );
}
