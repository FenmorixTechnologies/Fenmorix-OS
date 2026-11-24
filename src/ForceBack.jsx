// Force Back lists (server/forceback.js): who gets forced back next, in order (longest since their last force back first),
// with the log supervisors keep as they call down the list. Replaces the Communications spreadsheet; Suppression can get its own list.
import React, { useEffect, useMemo, useState } from "react";
import { ListOrdered, ScrollText, Settings, Plus, PhoneOff, UserCheck, StickyNote, Pencil, Upload, X } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/forceback${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const md = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) : "");
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "8px 10px", fontWeight: 700, fontSize: 12, color: "#fff", background: INK, textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "7px 10px", borderBottom: `1px solid ${LINE}`, verticalAlign: "middle" };
const KIND_COLOR = { forced: BRICK, oncall: BRICK, no_answer: AMBER, excused: BLUE, note: INK_SOFT, added: SAGE, removed: INK_SOFT, changed: INK_SOFT, imported: INK_SOFT };
const toBase64 = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(new Error("Couldn't read that file.")); r.readAsDataURL(file); });

// What happened when the supervisor called this person
function ActionDialog({ d, member, kind: startKind, onClose, onDone, toast }) {
  const [kind, setKind] = useState(startKind || "forced");
  const [day, setDay] = useState(d.today), [note, setNote] = useState(""), [notify, setNotify] = useState(true), [busy, setBusy] = useState(false);
  const KINDS = [["forced", "Forced back"], ["oncall", "Forced back (on call)"], ["no_answer", "No answer"], ["excused", "Excused"], ["note", "Note"]];
  const reasons = ["Out of town", "PTO / leave", "Covered another shift", "Sick", "Training"];
  const forced = kind === "forced" || kind === "oncall";
  const save = async () => {
    setBusy(true);
    try { const x = await call(`/${d.list.id}/action`, { memberId: member?.id, kind, day, note, notify }); toast(forced ? `${member.name} moved to the bottom of the list.` : "Logged."); onDone(x); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return <div role="dialog" aria-label="Log a call" style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
    <div style={{ ...cardStyle, width: "min(460px, 100%)", margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: INK }}>{member ? member.name : "Note on the list"}</div>
        <button type="button" aria-label="Close" style={btn("ghost")} onClick={onClose}><X size={16} /></button></div>
      {member && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {KINDS.map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
          style={{ ...btn(kind === k ? "primary" : "outline"), padding: "6px 10px", fontSize: 13 }}>{l}</button>)}</div>}
      <label style={{ display: "block", marginBottom: 10 }}><span style={label}>{forced ? "Force back date (the shift they're working)" : "Date"}</span>
        <input type="date" aria-label="Date" style={inputStyle} value={day} onChange={e => setDay(e.target.value)} /></label>
      {kind === "excused" && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {reasons.map(x => <button key={x} type="button" style={{ ...btn("ghost"), padding: "4px 9px", fontSize: 12.5, border: `1px solid ${LINE}` }} onClick={() => setNote(x)}>{x}</button>)}</div>}
      <label style={{ display: "block", marginBottom: 10 }}><span style={label}>{kind === "excused" ? "Reason (required)" : kind === "note" ? "Note" : "Note (optional)"}</span>
        <textarea aria-label="Note" rows={2} style={{ ...inputStyle, resize: "vertical" }} value={note} onChange={e => setNote(e.target.value)}
          placeholder={kind === "no_answer" ? "e.g. left voicemail" : kind === "forced" ? "e.g. covering B shift for Jones" : ""} /></label>
      {forced && member?.userId && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, color: INK, marginBottom: 10 }}>
        <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> Send {member.name.split(/[ ,]+/)[0]} a {PN} message about it (important)</label>}
      {forced && !member?.userId && <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10 }}>Not linked to a {PN} account, so no message will go out.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btn("primary")} disabled={busy} onClick={save}>{forced ? "Log force back" : "Log it"}</button>
        <button type="button" style={btn("ghost")} onClick={onClose}>Cancel</button></div>
    </div></div>;
}

function MemberEditor({ d, member, onClose, onDone, toast }) {
  const [f, setF] = useState(() => member ? { name: member.name, shift: member.shift, lastFb: member.lastFb || "", userId: member.userId || "" }
    : { name: "", shift: "", lastFb: "", userId: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = async (extra = {}) => {
    try { const x = await call(`/${d.list.id}/member`, { memberId: member?.id, ...f, ...extra }); toast(extra.active === false ? "Removed from the list." : member ? "Saved." : "Added."); onDone(x); }
    catch (e) { toast(e.message); }
  };
  const onList = new Set(d.members.map(m => m.userId).filter(Boolean));
  return <div role="dialog" aria-label={member ? "Edit person" : "Add a person"} style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
    <div style={{ ...cardStyle, width: "min(460px, 100%)", margin: 0 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: INK, marginBottom: 10 }}>{member ? member.name : "Add a person"}</div>
      {!member && <label style={{ display: "block", marginBottom: 10 }}><span style={label}>{PN} account</span>
        <select aria-label="Account" style={inputStyle} value={f.userId} onChange={e => { const p = d.people.find(x => x.id === e.target.value); setF(x => ({ ...x, userId: e.target.value, name: p?.name || x.name, shift: x.shift || p?.shift || "" })); }}>
          <option value="">(none: type a name)</option>
          {d.people.filter(p => !onList.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.division ? ` — ${p.division}` : ""}</option>)}</select></label>}
      {!member && !f.userId && <label style={{ display: "block", marginBottom: 10 }}><span style={label}>Name</span>
        <input aria-label="Name" style={inputStyle} value={f.name} onChange={e => set("name", e.target.value)} /></label>}
      <div style={{ display: "flex", gap: 10 }}>
        <label style={{ flex: 1 }}><span style={label}>Shift</span>
          <input aria-label="Shift" list="fb-shifts" style={inputStyle} value={f.shift} onChange={e => set("shift", e.target.value)} placeholder="A, B, C, D, Days…" />
          <datalist id="fb-shifts">{["A", "B", "C", "D", "Days", ...d.shifts].filter((v, i, a) => a.indexOf(v) === i).map(s => <option key={s} value={s} />)}</datalist></label>
        <label style={{ flex: 1 }}><span style={label}>Last force back</span>
          <input type="date" aria-label="Last force back" style={inputStyle} value={f.lastFb} onChange={e => set("lastFb", e.target.value)} /></label>
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "6px 0 12px" }}>Blank date = never forced back (top of the list). Changes are logged.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn("primary")} onClick={() => save()}>{member ? "Save" : "Add"}</button>
        <button type="button" style={btn("ghost")} onClick={onClose}>Cancel</button>
        {member && !confirmRemove && <button type="button" style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={() => setConfirmRemove(true)}>Remove from list</button>}
        {member && confirmRemove && <button type="button" style={{ ...btn("primary"), background: BRICK, marginLeft: "auto" }} onClick={() => save({ active: false })}>Yes, remove {member.name.split(/[ ,]+/)[0]}</button>}
      </div>
    </div></div>;
}

function ImportCard({ d, onDone, toast }) {
  const [file, setFile] = useState(null), [prev, setPrev] = useState(null), [busy, setBusy] = useState(false);
  const go = async (preview) => {
    setBusy(true);
    try { const x = await call(`/${d.list.id}/import`, { fileName: file.name, data: await toBase64(file), preview }); if (preview) setPrev(x.rows); else { setPrev(null); setFile(null); toast("Imported."); onDone(x); } }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return <section style={cardStyle} aria-label="Import the spreadsheet">
    <div style={{ fontWeight: 800, color: INK, marginBottom: 4 }}>Import the spreadsheet</div>
    <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>The force back workbook (Employee, Shift, Force Back Date, Entered By). People already on the list are updated; names are matched to {PN} accounts.</div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="file" aria-label="Force back spreadsheet" accept=".xlsx,.csv" onChange={e => { setFile(e.target.files[0] || null); setPrev(null); }} />
      <button type="button" style={btn("outline")} disabled={!file || busy} onClick={() => go(true)}><Upload size={14} /> Check file</button></div>
    {prev && <div style={{ marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}><tbody>
        {prev.map((x, i) => <tr key={i}><td style={td}>{x.name}</td><td style={td}>{x.shift}</td><td style={td}>{md(x.lastFb) || "never"}</td><td style={td}>{x.lastBy}</td>
          <td style={{ ...td, color: x.account ? SAGE : AMBER }}>{x.account ? `account: ${x.account}` : "no account match"}</td><td style={td}>{x.status === "new" ? "new" : "update"}</td></tr>)}</tbody></table>
      <button type="button" style={{ ...btn("primary"), marginTop: 8 }} disabled={busy} onClick={() => go(false)}>Import {prev.length} people</button></div>}
  </section>;
}

function ListSettings({ d, onDone, toast }) {
  const [f, setF] = useState({ name: d.list.name, division: d.list.division, steps: d.list.steps, active: d.list.active });
  const save = async () => { try { await call("/lists", { id: d.list.id, ...f }); toast("Saved."); onDone(); } catch (e) { toast(e.message); } };
  return <section style={cardStyle} aria-label="List settings">
    <div style={{ fontWeight: 800, color: INK, marginBottom: 8 }}>List settings</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <label style={{ flex: "1 1 200px" }}><span style={label}>Name</span><input aria-label="List name" style={inputStyle} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label style={{ flex: "1 1 200px" }}><span style={label}>Division (who manages it)</span><input aria-label="List division" style={inputStyle} value={f.division} onChange={e => setF({ ...f, division: e.target.value })} /></label></div>
    <label style={{ display: "block", marginTop: 10 }}><span style={label}>Steps to follow (shown above the list)</span>
      <textarea aria-label="Steps to follow" rows={4} style={{ ...inputStyle, resize: "vertical" }} value={f.steps} onChange={e => setF({ ...f, steps: e.target.value })} /></label>
    <button type="button" style={{ ...btn("primary"), marginTop: 8 }} onClick={save}>Save</button>
  </section>;
}

function NewList({ divisions, onDone, toast }) {
  const [name, setName] = useState(""), [division, setDivision] = useState(divisions[0] || "");
  const save = async () => { try { const x = await call("/lists", { name, division }); toast("List created."); onDone(x); } catch (e) { toast(e.message); } };
  return <section style={cardStyle} aria-label="New list">
    <div style={{ fontWeight: 800, color: INK, marginBottom: 8 }}>New force back list</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ flex: "1 1 200px" }}><span style={label}>Name</span><input aria-label="New list name" style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Communications" /></label>
      <label style={{ flex: "1 1 200px" }}><span style={label}>Division</span><input aria-label="New list division" list="fb-divs" style={inputStyle} value={division} onChange={e => setDivision(e.target.value)} />
        <datalist id="fb-divs">{divisions.map(x => <option key={x} value={x} />)}</datalist></label>
      <button type="button" style={btn("primary")} onClick={save}><Plus size={14} /> Create</button></div>
  </section>;
}

export default function ForceBackModule({ onBack }) {
  const [lists, setLists] = useState(null), [canCreate, setCanCreate] = useState(false);
  const [listId, setListId] = useState(null), [d, setD] = useState(null), [page, setPage] = useState("list");
  const [shift, setShift] = useState(""), [dialog, setDialog] = useState(null), [toastMsg, setToastMsg] = useState(null), [error, setError] = useState("");
  const toast = m => { setToastMsg(m); setTimeout(() => setToastMsg(null), 2600); };
  const loadLists = () => call("").then(x => { setLists(x.lists); setCanCreate(x.canCreate); setListId(id => id || x.lists[0]?.id || null); }, e => setError(e.message));
  useEffect(() => { loadLists(); }, []);
  const load = () => listId && call(`/${listId}`).then(setD, e => setError(e.message));
  useEffect(() => { setD(null); load(); }, [listId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const divisions = useMemo(() => [...new Set([...(d?.people || []).map(p => p.division), ...(lists || []).map(l => l.division)].filter(Boolean))].sort(), [d, lists]);

  const nav = [
    ...(lists || []).map(l => ({ key: `list:${l.id}`, label: l.name, icon: ListOrdered, group: "Lists" })),
    ...(d ? [{ key: "log", label: "Edit log", icon: ScrollText, group: d.list.name }] : []),
    ...(d?.canManage || canCreate ? [{ key: "manage", label: "Manage", icon: Settings, group: "Admin" }] : []),
  ];
  const active = page === "list" ? `list:${listId}` : page;
  const go = k => { if (k.startsWith("list:")) { setListId(k.slice(5)); setPage("list"); } else setPage(k); };
  const shown = d ? d.members.filter(m => !shift || m.shift === shift) : [];
  const done = x => { setDialog(null); if (x?.members) setD(x); else load(); };

  return <AppShell section="Force Back" nav={nav} active={active} onNav={go} onHome={onBack}>
    {error && <div style={{ ...cardStyle, color: BRICK }}>{error}</div>}
    {lists && !lists.length && <div style={{ ...cardStyle, color: INK_SOFT }}>{canCreate ? "No force back lists yet. Create one under Manage." : "You're not on a force back list."}</div>}
    {page === "manage" && <>
      {canCreate && <NewList divisions={divisions} toast={toast} onDone={x => { setLists(x.lists); setListId(x.lists.find(l => !(lists || []).some(o => o.id === l.id))?.id || listId); setPage("list"); }} />}
      {d?.canManage && <><ImportCard d={d} toast={toast} onDone={x => { setD(x); setPage("list"); }} /><ListSettings d={d} toast={toast} onDone={() => { loadLists(); load(); }} /></>}
    </>}
    {d && page === "list" && <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{d.list.name} force back list</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>Top = longest since their last force back. Forcing someone back moves them to the bottom.</div></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div role="group" aria-label="Shift" style={{ display: "flex", gap: 4 }}>
            {["", ...d.shifts].map(s => <button key={s || "all"} type="button" aria-pressed={shift === s} onClick={() => setShift(s)}
              style={{ ...btn(shift === s ? "primary" : "outline"), padding: "5px 10px", fontSize: 13 }}>{s || "All shifts"}</button>)}</div>
          {d.canEdit && <button type="button" style={btn("ghost")} onClick={() => setDialog({ kind: "action", member: null, start: "note" })}><StickyNote size={14} /> Note</button>}
          {d.canManage && <button type="button" style={btn("outline")} onClick={() => setDialog({ kind: "member", member: null })}><Plus size={14} /> Add person</button>}
        </div></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <details style={{ ...cardStyle, padding: "10px 14px", margin: 0 }}><summary style={{ cursor: "pointer", fontWeight: 700, color: INK }}>Steps to follow</summary>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, color: INK, marginTop: 6 }}>{d.list.steps}</div></details>
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto", margin: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }} aria-label="Force back order">
            <thead><tr><th style={{ ...th, width: 36 }}>#</th><th style={th}>Employee</th><th style={th}>Shift</th><th style={th}>Force back date</th>
              <th style={{ ...th, textAlign: "right" }}>Days since</th><th style={th}>Entered by</th>{(d.canEdit || d.canManage) && <th style={th} />}</tr></thead>
            <tbody>{shown.map((m, i) => <tr key={m.id} aria-label={m.name} style={{ background: m.me ? "#FFF7E6" : i % 2 ? PAPER : "#fff" }}>
              <td style={{ ...td, color: INK_SOFT }}>{m.order}</td>
              <td style={{ ...td, fontWeight: 600, color: INK }}>{m.name}{m.me ? <span style={{ fontWeight: 400, color: INK_SOFT }}> (you)</span> : ""}</td>
              <td style={td}>{m.shift}</td><td style={td}>{m.lastFb ? md(m.lastFb) : <span style={{ color: INK_SOFT }}>never</span>}</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{m.days ?? "—"}</td><td style={td}>{m.lastBy}</td>
              {(d.canEdit || d.canManage) && <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                {d.canEdit && <>
                  <button type="button" style={{ ...btn("primary"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => setDialog({ kind: "action", member: m, start: "forced" })}><UserCheck size={13} /> Forced back</button>{" "}
                  <button type="button" style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => setDialog({ kind: "action", member: m, start: "no_answer" })}><PhoneOff size={13} /> No answer</button>{" "}
                  <button type="button" style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => setDialog({ kind: "action", member: m, start: "excused" })}>Excused</button></>}
                {d.canManage && <button type="button" aria-label={`Edit ${m.name}`} style={{ ...btn("ghost"), padding: "4px 7px" }} onClick={() => setDialog({ kind: "member", member: m })}><Pencil size={13} /></button>}
              </td>}</tr>)}
              {!shown.length && <tr><td colSpan={7} style={{ ...td, color: INK_SOFT }}>Nobody on this list{shift ? ` for ${shift}` : ""} yet.</td></tr>}</tbody></table></div>
        <LogCard d={d} limit={12} onAll={() => setPage("log")} />
      </div>
    </>}
    {d && page === "log" && <LogCard d={d} />}
    {dialog?.kind === "action" && <ActionDialog d={d} member={dialog.member} kind={dialog.start} toast={toast} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.kind === "member" && <MemberEditor d={d} member={dialog.member} toast={toast} onClose={() => setDialog(null)} onDone={done} />}
    {toastMsg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{toastMsg}</div>}
  </AppShell>;
}

function LogCard({ d, limit, onAll }) {
  const rows = limit ? d.log.slice(0, limit) : d.log;
  return <section style={{ ...cardStyle, margin: 0 }} aria-label="Edit log">
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <div style={{ fontWeight: 800, color: INK }}>Edit log</div>
      {limit && d.log.length > limit && <button type="button" style={btn("ghost")} onClick={onAll}>All {d.log.length}</button>}</div>
    {!rows.length && <div style={{ fontSize: 13, color: INK_SOFT }}>Nothing logged yet.</div>}
    {rows.map(x => <div key={x.id} style={{ display: "flex", gap: 8, padding: "5px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, flexWrap: "wrap" }}>
      <span style={{ color: INK_SOFT, minWidth: 64 }}>{md(x.day)}</span>
      <span style={{ fontWeight: 700, color: INK }}>{x.name || "List"}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: KIND_COLOR[x.kind] || INK_SOFT, borderRadius: 999, padding: "2px 8px" }}>{x.label}</span>
      {x.note && <span style={{ color: INK }}>{x.note}</span>}
      <span style={{ marginLeft: "auto", color: INK_SOFT }} title={x.by}>{x.initials}</span></div>)}
  </section>;
}
