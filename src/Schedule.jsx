// Work Schedule (Time Clock module): who works which day and which hours, planned days or weeks ahead. Everyone sees it; people
// with Work schedule "edit" (User Management › Permissions) set it for their divisions: one day at a time, "Fill the week" for
// several people at once, "Copy last week", and "Leaving early" on today's list. Days off from Off Work show on the grid.
// Server: server/schedule.js. Your Day card: YourDay.jsx ScheduleWidget. TV view: Display.jsx "schedule".
import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Copy, Plus, X, Clock } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { fmtTime, fmtRange, STATUS, dayLine } from "./scheduleShared.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#B42318", SAGE = "#2E7D4F", AMBER = "#B26A00";
async function call(path, body) {
  const r = await fetch(`/api/schedule${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
const monday = d => { const w = new Date(`${d}T12:00:00`).getDay(); return addDays(d, -((w + 6) % 7)); };
const pretty = (d, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", o);
const plusHours = (t, h) => { const [a, b] = t.split(":").map(Number), m = (a * 60 + b + Math.round(h * 60)) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function ScheduleModule({ onBack }) {
  const [view, setView] = useState("week");          // week | today
  const [week, setWeek] = useState(() => monday(todayISO()));
  const [d, setD] = useState(null), [today, setToday] = useState(null), [error, setError] = useState("");
  const [division, setDivision] = useState(""), [q, setQ] = useState("");
  const [cell, setCell] = useState(null), [fill, setFill] = useState(false), [picked, setPicked] = useState(new Set());
  const [toast, setToast] = useState("");
  const say = m => { setToast(m); setTimeout(() => setToast(""), 3000); };
  const load = () => {
    call(`?from=${week}&to=${addDays(week, 6)}`).then(x => { setD(x); setError(""); }, e => setError(e.message));
    call("/today").then(setToday, () => {});
  };
  useEffect(load, [week]);   // eslint-disable-line react-hooks/exhaustive-deps

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const canEditDiv = div => d && (d.canEdit === "all" || d.canEdit.includes(div));
  const anyEdit = d && (d.canEdit === "all" || d.canEdit.length > 0);
  const divisions = useMemo(() => [...new Set((d?.people || []).map(p => p.division))], [d]);
  const shown = (d?.people || []).filter(p => (!division || p.division === division) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const entryOf = (id, day) => d?.entries.find(e => e.userId === id && e.day === day);
  const offOf = (id, day) => (d?.off || []).find(o => o.userId === id && o.from <= day && o.to >= day);
  const save = async (body, msg) => { try { await call("/save", body); say(msg); setCell(null); setFill(false); load(); return true; } catch (e) { say(e.message); return false; } };

  const nav = [
    { key: "week", label: "Week", icon: CalendarDays },
    { key: "today", label: "Today", icon: Clock, badge: today?.list?.filter(e => e.status === "working").length || 0 },
  ];
  let body;
  if (error) body = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) body = <div style={{ color: INK_SOFT }}>Loading…</div>;
  else if (view === "today") body = <TodayList t={today} canEditDiv={canEditDiv} onEarly={(e, at) => save({ entries: [{ userId: e.userId, day: today.today, start: e.start, end: e.end, earlyAt: at, note: e.note }] }, at ? `${e.name} is leaving early at ${fmtTime(at)}.` : "Leaving early taken off.")} />;
  else body = <>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <button aria-label="Previous week" style={btn("outline")} onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={15} /></button>
      <b style={{ color: INK, minWidth: 200, textAlign: "center" }}>{pretty(week, { month: "short", day: "numeric" })} – {pretty(addDays(week, 6), { month: "short", day: "numeric", year: "numeric" })}</b>
      <button aria-label="Next week" style={btn("outline")} onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={15} /></button>
      {week !== monday(todayISO()) && <button style={btn("ghost")} onClick={() => setWeek(monday(todayISO()))}>This week</button>}
      <select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={division} onChange={e => setDivision(e.target.value)}>
        <option value="">Everyone</option>{divisions.map(x => <option key={x}>{x}</option>)}</select>
      <input aria-label="Find a person" placeholder="Find a person…" style={{ ...inputStyle, width: 180 }} value={q} onChange={e => setQ(e.target.value)} />
      {anyEdit && <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={btn("primary")} onClick={() => setFill(true)}><Plus size={14} /> Fill the week</button>
        <button style={btn("outline")} onClick={async () => {
          const who = picked.size ? [...picked] : shown.filter(p => canEditDiv(p.division)).map(p => p.id);
          if (!window.confirm(`Copy last week's schedule into this week for ${picked.size ? `${picked.size} selected ${picked.size === 1 ? "person" : "people"}` : "everyone shown"}? Their days this week are replaced.`)) return;
          try { const r = await call("/copy", { from: addDays(week, -7), to: week, userIds: who }); say(r.copied ? `Copied ${r.copied} days for ${r.people} ${r.people === 1 ? "person" : "people"}.` : "Last week had nothing to copy."); load(); } catch (e) { say(e.message); }
        }}><Copy size={14} /> Copy last week</button></span>}
    </div>
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 820 }}>
        <thead><tr style={{ background: PAPER }}>
          {anyEdit && <th style={{ width: 30, borderBottom: `1px solid ${LINE}` }}><input type="checkbox" aria-label="Select everyone shown" checked={shown.length > 0 && shown.every(p => picked.has(p.id))}
            onChange={e => setPicked(e.target.checked ? new Set(shown.filter(p => canEditDiv(p.division)).map(p => p.id)) : new Set())} /></th>}
          <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${LINE}`, color: INK_SOFT, fontSize: 12 }}>Person</th>
          {days.map((x, i) => <th key={x} style={{ padding: "8px 6px", borderBottom: `1px solid ${LINE}`, color: x === d.today ? INK : INK_SOFT, fontSize: 12, background: x === d.today ? "#E8F0FB" : undefined }}>
            {DAY_NAMES[i]}<div style={{ fontWeight: 500 }}>{pretty(x, { month: "numeric", day: "numeric" })}</div></th>)}
        </tr></thead>
        <tbody>{shown.map(p => <tr key={p.id}>
          {anyEdit && <td style={{ borderBottom: `1px solid ${LINE}`, textAlign: "center" }}>{canEditDiv(p.division) && <input type="checkbox" aria-label={`Select ${p.name}`} checked={picked.has(p.id)}
            onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />}</td>}
          <td style={{ padding: "6px 10px", borderBottom: `1px solid ${LINE}`, whiteSpace: "nowrap" }}><b style={{ color: INK }}>{p.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.division}{p.title ? ` · ${p.title}` : ""}</div></td>
          {days.map(x => {
            const e = entryOf(p.id, x), o = offOf(p.id, x), edit = canEditDiv(p.division);
            return <td key={x} style={{ padding: 4, borderBottom: `1px solid ${LINE}`, borderLeft: `1px solid ${LINE}`, verticalAlign: "top", background: x === d.today ? "#F5F9FE" : undefined }}>
              <button type="button" disabled={!edit} aria-label={`${p.name}, ${pretty(x)}${e ? `: ${dayLine(e)}` : ": not scheduled"}`} onClick={() => setCell({ person: p, day: x, e })}
                style={{ width: "100%", minHeight: 40, border: e ? `1px solid ${SAGE}55` : `1px dashed ${LINE}`, background: e ? "#EEF7F1" : "transparent", borderRadius: 6, cursor: edit ? "pointer" : "default",
                  fontFamily: "inherit", fontSize: 12, color: INK, padding: "3px 4px", textAlign: "center" }}>
                {e ? <><b>{fmtTime(e.start)}</b>–<b>{fmtTime(e.end)}</b>{e.earlyAt && <div style={{ color: AMBER, fontWeight: 700 }}>leaves {fmtTime(e.earlyAt)}</div>}{e.note && <div style={{ color: INK_SOFT, fontSize: 11 }}>{e.note}</div>}</>
                  : <span style={{ color: "#A0A8B5" }}>{edit ? "+" : "–"}</span>}
                {o && <div style={{ color: BRICK, fontWeight: 700, fontSize: 11 }}>{o.label}</div>}
              </button></td>;
          })}
        </tr>)}</tbody>
      </table>
      {!shown.length && <div style={{ padding: 16, color: INK_SOFT }}>No one to show.</div>}
    </div>
    {!anyEdit && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8 }}>Ask your manager to change the schedule.</div>}
  </>;

  return (
    <AppShell section="Work Schedule" nav={nav} active={view} onNav={setView} onHome={onBack}>
      <div style={{ fontSize: 22, fontWeight: 800, color: INK }}><CalendarClock size={22} style={{ verticalAlign: -4 }} /> Work Schedule</div>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "2px 0 14px" }}>Who works when. {anyEdit ? "Click a day to set or change it." : ""}</div>
      {body}
      {cell && <CellEditor cell={cell} d={d} onClose={() => setCell(null)} onSave={save} />}
      {fill && <FillWeek d={d} week={week} people={shown.filter(p => canEditDiv(p.division) && (!picked.size || picked.has(p.id)))} onClose={() => setFill(false)} onSave={save} />}
      {toast && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 16px", borderRadius: 8, zIndex: 60 }}>{toast}</div>}
    </AppShell>
  );
}

function Dialog({ title, onClose, children }) {
  return <div role="dialog" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}>
    <div style={{ ...cardStyle, width: "min(460px, 100%)", margin: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><b style={{ color: INK, fontSize: 15 }}>{title}</b>
        <button aria-label="Close" style={btn("ghost")} onClick={onClose}><X size={16} /></button></div>
      {children}</div></div>;
}

// One person, one day
function CellEditor({ cell, d, onClose, onSave }) {
  const e = cell.e;
  const [f, setF] = useState({ start: e?.start || d.dayStart, end: e?.end || plusHours(d.dayStart, d.dayHours), early: !!e?.earlyAt, earlyAt: e?.earlyAt || "", note: e?.note || "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const base = { userId: cell.person.id, day: cell.day };
  return <Dialog title={`${cell.person.name} · ${pretty(cell.day, { weekday: "long", month: "short", day: "numeric" })}`} onClose={onClose}>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <label><span style={label}>Starts</span><input aria-label="Starts" type="time" style={{ ...inputStyle, width: 140 }} value={f.start} onChange={x => set("start", x.target.value)} /></label>
      <label><span style={label}>Ends</span><input aria-label="Ends" type="time" style={{ ...inputStyle, width: 140 }} value={f.end} onChange={x => set("end", x.target.value)} /></label>
    </div>
    <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, fontSize: 13.5 }}><input type="checkbox" checked={f.early} onChange={x => set("early", x.target.checked)} /> Leaving early</label>
    {f.early && <label><span style={label}>Leaving at</span><input aria-label="Leaving at" type="time" style={{ ...inputStyle, width: 140 }} value={f.earlyAt} onChange={x => set("earlyAt", x.target.value)} /></label>}
    <label style={{ display: "block", marginTop: 10 }}><span style={label}>Note (everyone sees it)</span><input aria-label="Note" style={inputStyle} value={f.note} placeholder="e.g. opening, front counter" onChange={x => set("note", x.target.value)} /></label>
    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
      <button style={btn("primary")} onClick={() => onSave({ entries: [{ ...base, start: f.start, end: f.end, earlyAt: f.early ? f.earlyAt : "", note: f.note }] }, "Saved.")}>Save</button>
      {e && <button style={{ ...btn("outline"), color: BRICK }} onClick={() => onSave({ remove: [base] }, "Taken off the schedule.")}>Not working this day</button>}
      <button style={btn("ghost")} onClick={onClose}>Cancel</button>
    </div>
  </Dialog>;
}

// Several people, the same hours on the chosen days of this week
function FillWeek({ d, week, people, onClose, onSave }) {
  const [f, setF] = useState({ start: d.dayStart, end: plusHours(d.dayStart, d.dayHours), days: [0, 1, 2, 3, 4], note: "" });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const go = () => onSave({ entries: people.flatMap(p => f.days.map(i => ({ userId: p.id, day: addDays(week, i), start: f.start, end: f.end, note: f.note }))) },
    `Scheduled ${people.length} ${people.length === 1 ? "person" : "people"} on ${f.days.length} day${f.days.length === 1 ? "" : "s"}.`);
  return <Dialog title="Fill the week" onClose={onClose}>
    <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>{people.length ? `For ${people.length === 1 ? people[0].name : `${people.length} people`} (${people.length > 3 ? "the ones you selected or everyone shown" : people.map(p => p.name).join(", ")}). Days you pick are replaced.` : "No one to schedule: pick people you can schedule."}</div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <label><span style={label}>Starts</span><input aria-label="Fill starts" type="time" style={{ ...inputStyle, width: 140 }} value={f.start} onChange={x => set("start", x.target.value)} /></label>
      <label><span style={label}>Ends</span><input aria-label="Fill ends" type="time" style={{ ...inputStyle, width: 140 }} value={f.end} onChange={x => set("end", x.target.value)} /></label>
    </div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>{DAY_NAMES.map((n, i) => <label key={n} style={{ fontSize: 13.5, display: "flex", gap: 4, alignItems: "center" }}>
      <input type="checkbox" checked={f.days.includes(i)} onChange={x => set("days", x.target.checked ? [...f.days, i].sort() : f.days.filter(y => y !== i))} />{n}</label>)}</div>
    <label style={{ display: "block", marginTop: 10 }}><span style={label}>Note (optional)</span><input aria-label="Fill note" style={inputStyle} value={f.note} onChange={x => set("note", x.target.value)} /></label>
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      <button style={btn("primary")} disabled={!people.length || !f.days.length} onClick={go}>Schedule them</button>
      <button style={btn("ghost")} onClick={onClose}>Cancel</button></div>
  </Dialog>;
}

// Today, by where everyone is; editors can mark someone as leaving early
function TodayList({ t, canEditDiv, onEarly }) {
  const [early, setEarly] = useState(null);
  if (!t) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  if (!t.list.length) return <div style={{ ...cardStyle, color: INK_SOFT }}>No one is on today's schedule.</div>;
  const groups = ["working", "later", "left_early", "done", "out"].map(k => [k, t.list.filter(e => e.status === k)]).filter(([, l]) => l.length);
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
    {groups.map(([k, l]) => <div key={k} style={{ ...cardStyle, margin: 0, borderTop: `4px solid ${STATUS[k].color}` }}>
      <div style={{ fontWeight: 800, color: STATUS[k].color, marginBottom: 6 }}>{STATUS[k].label} · {l.length}</div>
      {l.map(e => <div key={e.userId} style={{ padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}><b style={{ color: INK }}>{e.name}</b>
          {canEditDiv(e.division) && k !== "out" && k !== "done" && k !== "left_early" && <button style={{ ...btn("ghost"), fontSize: 12, padding: "2px 6px" }}
            onClick={() => setEarly(early?.userId === e.userId ? null : { userId: e.userId, at: e.earlyAt || "" })}>{e.earlyAt ? "Change leaving early" : "Leaving early"}</button>}</div>
        <div style={{ fontSize: 12.5, color: INK_SOFT }}>{k === "out" ? (e.off?.label || "Out") : dayLine(e)}{e.note ? ` · ${e.note}` : ""}</div>
        {early?.userId === e.userId && <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input aria-label={`${e.name} leaving at`} type="time" style={{ ...inputStyle, width: 130 }} value={early.at} onChange={x => setEarly({ ...early, at: x.target.value })} />
          <button style={btn("primary")} disabled={!early.at} onClick={() => { onEarly(e, early.at); setEarly(null); }}>Save</button>
          {e.earlyAt && <button style={btn("ghost")} onClick={() => { onEarly(e, ""); setEarly(null); }}>Not leaving early</button>}
        </div>}
      </div>)}
    </div>)}
  </div>;
}
