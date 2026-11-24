// Off Work: post days you're out and choose who sees them (everyone, your division, or certain people/groups); see who's
// out. Sick leave call-outs appear on their own as "Out sick". Server: server/offwork.js. Your Day widget: YourDay.jsx OffWorkWidget.
import React, { useEffect, useMemo, useState } from "react";
import { CalendarOff, CalendarDays, Plus, Settings, User, Users, X, Pencil } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/offwork${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const prettyDay = (d, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", o);
export const hm12 = t => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
// "Tue, Nov 17" · "Tue, Nov 17, about 9:00 AM – 12:00 PM" · "Tue, Nov 17 – Fri, Nov 20"
export const span = e => {
  const t = e.startTime || e.endTime ? `, about ${e.startTime ? hm12(e.startTime) : "?"} – ${e.endTime ? hm12(e.endTime) : "?"}` : "";
  if (e.from === e.to) return `${prettyDay(e.from)}${t}`;
  return `${prettyDay(e.from)}${e.startTime ? ` ${hm12(e.startTime)}` : ""} – ${prettyDay(e.to)}${e.endTime ? ` ${hm12(e.endTime)}` : ""}`;
};
export const KIND_COLOR = { off: BLUE, vacation: SAGE, meeting: "#0E7C86", training: "#7A4FB0", ooo: AMBER, remote: INK_SOFT, other: INK_SOFT, sick: BRICK, leave: INK_SOFT };
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", whiteSpace: "nowrap", borderBottom: `1px solid ${LINE}` };
const td = { padding: "7px 9px", verticalAlign: "top", borderBottom: `1px solid ${LINE}` };
const VIS_LABEL = { everyone: "Everyone", division: "Their division", people: "Certain people" };
export const Tag = ({ e }) => <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: KIND_COLOR[e.kind] || INK_SOFT, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{e.label}</span>;

function Editor({ d, entry, onDone, toast }) {
  const me = d.people.find(p => p.id === d.meId);
  const [f, setF] = useState(() => entry ? { id: entry.id, userId: entry.userId, from: entry.from, to: entry.to, kind: entry.kind, note: entry.note || "", visibility: entry.visibility || "everyone", people: entry.people || [],
      startTime: entry.startTime || "", endTime: entry.endTime || "", location: entry.location || "", partDay: !!(entry.startTime || entry.endTime) }
    : { userId: d.meId, from: todayISO(), to: todayISO(), kind: "off", note: "", visibility: "everyone", people: [], startTime: "", endTime: "", location: "", partDay: false });
  const [pick, setPick] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const canOthers = d.people.some(p => p.canEdit && p.id !== d.meId);
  const has = (kind, id) => f.people.some(x => x.kind === kind && x.id === id);
  const add = v => {
    if (!v) return;
    const [kind, id] = v.split(":");
    const name = kind === "group" ? d.groups.find(g => g.id === id)?.name : d.people.find(p => p.id === id)?.name;
    if (name && !has(kind, id)) set("people", [...f.people, { kind, id, name }]);
    setPick("");
  };
  const save = async () => {
    const body = f.partDay ? { ...f, to: f.from } : { ...f, startTime: "", endTime: "" };
    try { await call("", body); toast(entry ? "Saved." : "Posted."); onDone(); } catch (e) { toast(e.message); }
  };
  const owner = d.people.find(p => p.id === f.userId) || me;
  return (
    <div style={cardStyle} role="form" aria-label="Days off">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {canOthers && <label><span style={label}>Person</span>
          <select aria-label="Person" style={inputStyle} value={f.userId} onChange={e => set("userId", e.target.value)}>
            {d.people.filter(p => p.canEdit).map(p => <option key={p.id} value={p.id}>{p.name}{p.id === d.meId ? " (me)" : ` — ${p.division}`}</option>)}
          </select></label>}
        <label><span style={label}>What</span>
          <select aria-label="What" style={inputStyle} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value, partDay: e.target.value === "meeting" ? true : x.partDay }))}>
            {Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label><span style={label}>{f.partDay ? "Day" : "First day off"}</span><input aria-label={f.partDay ? "Day" : "First day off"} type="date" style={inputStyle} value={f.from} onChange={e => setF(x => ({ ...x, from: e.target.value, to: x.to < e.target.value ? e.target.value : x.to }))} /></label>
        {!f.partDay && <label><span style={label}>Last day off</span><input aria-label="Last day off" type="date" style={inputStyle} value={f.to} min={f.from} onChange={e => set("to", e.target.value)} /></label>}
        {f.partDay && <label><span style={label}>Leaving about</span><input aria-label="Leaving about" type="time" style={inputStyle} value={f.startTime} onChange={e => set("startTime", e.target.value)} /></label>}
        {f.partDay && <label><span style={label}>Back about</span><input aria-label="Back about" type="time" style={inputStyle} value={f.endTime} onChange={e => set("endTime", e.target.value)} /></label>}
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 10 }}>
        <input type="checkbox" checked={f.partDay} onChange={e => set("partDay", e.target.checked)} /> Only part of the day (e.g. a 3-hour meeting off site)</label>
      <label style={{ display: "block", marginTop: 10 }}><span style={label}>Where (optional)</span>
        <input aria-label="Where" style={inputStyle} value={f.location} onChange={e => set("location", e.target.value)} placeholder="e.g. Parish EOC, 3773 Harding Blvd" /></label>
      <label style={{ display: "block", marginTop: 10 }}><span style={label}>Note (optional)</span>
        <input aria-label="Note" style={inputStyle} value={f.note} onChange={e => set("note", e.target.value)} placeholder="e.g. Back Monday; reach Lt. Smith for anything urgent" /></label>
      <div style={{ marginTop: 12 }}>
        <span style={label}>Who can see it</span>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
          {Object.entries(VIS_LABEL).map(([k, v]) => (
            <label key={k} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input type="radio" name="vis" checked={f.visibility === k} onChange={() => set("visibility", k)} />
              {k === "division" ? `${owner?.division || "Their"} division` : v}
            </label>))}
        </div>
        {f.visibility === "people" && (
          <div style={{ marginTop: 8 }}>
            <select aria-label="Share with" style={inputStyle} value={pick} onChange={e => add(e.target.value)}>
              <option value="">Add a group or person…</option>
              {d.groups.length > 0 && <optgroup label="Groups">{d.groups.filter(g => !has("group", g.id)).map(g => <option key={g.id} value={`group:${g.id}`}>{g.name} ({g.count})</option>)}</optgroup>}
              <optgroup label="People">{d.people.filter(p => p.id !== f.userId && !has("user", p.id)).map(p => <option key={p.id} value={`user:${p.id}`}>{p.name} — {p.division}</option>)}</optgroup>
            </select>
            <div aria-label="Shared with" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {f.people.length === 0 && <span style={{ fontSize: 12.5, color: INK_SOFT }}>Nobody picked yet.</span>}
              {f.people.map(x => (
                <span key={`${x.kind}:${x.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, background: x.kind === "group" ? "#E8EEF7" : "#F1EFE8", borderRadius: 999, padding: "3px 6px 3px 10px" }}>
                  {x.kind === "group" ? <Users size={12} /> : <User size={12} />} {x.name}
                  <button type="button" aria-label={`Remove ${x.name}`} onClick={() => set("people", f.people.filter(y => !(y.kind === x.kind && y.id === x.id)))}
                    style={{ border: "none", background: "transparent", cursor: "pointer", color: BRICK, display: "inline-flex", padding: "0 2px" }}><X size={12} /></button>
                </span>))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>You{f.userId !== d.meId ? `, ${owner?.name},` : ""} and Off Work coordinators always see it.</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={btn("primary")} onClick={save}>{entry ? "Save" : "Post days off"}</button>
        <button style={btn("ghost")} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function EntryTable({ list, onEdit, onRemove, showWho = true }) {
  if (!list.length) return <div style={{ fontSize: 13.5, color: INK_SOFT, padding: 12 }}>Nobody.</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead><tr>{showWho && <th style={th}>Name</th>}{showWho && <th style={th}>Division</th>}<th style={th}>Out</th><th style={th}>When</th><th style={th}>Note</th><th style={th} /></tr></thead>
      <tbody>{list.map(e => (
        <tr key={e.id}>
          {showWho && <td style={td}><b>{e.name}</b>{e.title ? <div style={{ fontSize: 12, color: INK_SOFT }}>{e.title}</div> : null}</td>}
          {showWho && <td style={td}>{e.division}</td>}
          <td style={td}><Tag e={e} /></td>
          <td style={{ ...td, whiteSpace: "nowrap" }}>{span(e)}</td>
          <td style={{ ...td, fontSize: 12.5 }}>{e.location && <div><b>At:</b> {e.location}</div>}{e.note}{e.source === "sick" && e.kind === "sick" && <span style={{ color: INK_SOFT }}>From Sick Leave</span>}
            {e.canEdit && e.visibility && e.visibility !== "everyone" && <div style={{ fontSize: 11.5, color: INK_SOFT }}>Seen by: {e.visibility === "division" ? "their division" : (e.people || []).map(x => x.name).join(", ")}</div>}
            {e.postedBy && <div style={{ fontSize: 11.5, color: INK_SOFT }}>Posted by {e.postedBy}</div>}</td>
          <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>{e.canEdit && <>
            <button type="button" aria-label={`Edit ${e.name} ${e.from}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => onEdit(e)}><Pencil size={13} /></button>
            <button type="button" aria-label={`Remove ${e.name} ${e.from}`} style={{ ...btn("ghost"), padding: "2px 6px", color: BRICK }} onClick={() => onRemove(e)}><X size={13} /></button></>}</td>
        </tr>))}</tbody>
    </table>
  );
}

export default function OffWorkModule({ onBack, initialView }) {
  const [view, setView] = useState(initialView || "who");
  const [range, setRange] = useState("week");
  const [custom, setCustom] = useState({ from: todayISO(), to: addDays(todayISO(), 30) });
  const [division, setDivision] = useState("");
  const [d, setD] = useState(null), [error, setError] = useState(""), [msg, setMsg] = useState(""), [editing, setEditing] = useState(null);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 2600); };
  const window_ = useMemo(() => {
    const t = todayISO();
    if (range === "today") return { from: t, to: t };
    if (range === "2weeks") return { from: t, to: addDays(t, 13) };
    if (range === "month") return { from: t, to: addDays(t, 30) };
    if (range === "custom") return custom;
    return { from: t, to: addDays(t, 6) };
  }, [range, custom]);
  const load = () => {
    const from = view === "mine" ? addDays(todayISO(), -30) : window_.from, to = view === "mine" ? addDays(todayISO(), 365) : window_.to;
    return call(`?from=${from}&to=${to}${division && view === "who" ? `&division=${encodeURIComponent(division)}` : ""}`).then(x => { setD(x); setError(""); }, e => setError(e.message));
  };
  useEffect(() => { load(); }, [view, window_.from, window_.to, division]);   // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async e => { try { await call(`/${e.id}/remove`, {}); toast("Removed."); load(); } catch (x) { toast(x.message); } };
  const nav = [
    { key: "who", label: "Who's out", icon: CalendarOff },
    { key: "mine", label: "My days off", icon: CalendarDays },
    { key: "post", label: "Post days off", icon: Plus, group: "Actions" },
    ...(d?.rights?.manage ? [{ key: "settings", label: "Settings", icon: Settings, group: "Admin" }] : []),
  ];
  const TITLE = { who: "Who's out", mine: "My days off", post: "Post days off", settings: "Settings" };
  const today = todayISO();
  let body = null;
  if (error) body = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) body = <div style={cardStyle}>Loading…</div>;
  else if (editing || view === "post") body = <Editor d={d} entry={editing} toast={toast} onDone={() => { setEditing(null); setView(view === "post" ? "mine" : view); load(); }} />;
  else if (view === "who") {
    const outToday = d.entries.filter(e => e.from <= today && e.to >= today);
    body = <>
      <div style={{ ...cardStyle, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label><span style={label}>Show</span>
          <select aria-label="Show" style={{ ...inputStyle, width: "auto" }} value={range} onChange={e => setRange(e.target.value)}>
            <option value="today">Today</option><option value="week">Next 7 days</option><option value="2weeks">Next 2 weeks</option><option value="month">Next 30 days</option><option value="custom">Dates…</option>
          </select></label>
        {range === "custom" && <>
          <label><span style={label}>From</span><input aria-label="From" type="date" style={{ ...inputStyle, width: "auto" }} value={custom.from} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} /></label>
          <label><span style={label}>To</span><input aria-label="To" type="date" style={{ ...inputStyle, width: "auto" }} value={custom.to} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} /></label>
        </>}
        <label><span style={label}>Division</span>
          <select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={division} onChange={e => setDivision(e.target.value)}>
            <option value="">All divisions</option>{d.divisions.map(x => <option key={x}>{x}</option>)}
          </select></label>
        <span style={{ flex: 1 }} />
        <button style={btn("primary")} onClick={() => setView("post")}><Plus size={14} /> Post days off</button>
      </div>
      {range !== "today" && <div style={{ ...cardStyle, padding: 0 }} role="region" aria-label="Out today">
        <div style={{ padding: "10px 12px 0", fontWeight: 800 }}>Out today <span style={{ color: INK_SOFT, fontWeight: 600 }}>({outToday.length})</span></div>
        <EntryTable list={outToday} onEdit={setEditing} onRemove={remove} />
      </div>}
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }} role="region" aria-label="Everyone out">
        <div style={{ padding: "10px 12px 0", fontWeight: 800 }}>{range === "today" ? "Out today" : `${prettyDay(d.from)} to ${prettyDay(d.to)}`} <span style={{ color: INK_SOFT, fontWeight: 600 }}>({d.entries.length})</span></div>
        <EntryTable list={d.entries} onEdit={setEditing} onRemove={remove} />
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>You see what each person shares with you. Sick leave call-outs show as "Out sick" automatically{d.settings ? ` (shown to: ${d.settings.sickVisibility === "off" ? "nobody" : d.settings.sickVisibility === "division" ? "their division" : "everyone"})` : ""}.</div>
    </>;
  } else if (view === "mine") {
    const mine = d.entries.filter(e => e.mine);
    body = <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center" }}><b style={{ flex: 1 }}>Last 30 days and coming up</b><button style={btn("primary")} onClick={() => setView("post")}><Plus size={14} /> Post days off</button></div>
      <EntryTable list={mine} onEdit={setEditing} onRemove={remove} showWho={false} />
    </div>;
  } else if (view === "settings") {
    body = <div style={cardStyle}>
      <span style={label}>Sick leave call-outs show as "Out sick" to</span>
      <select aria-label="Sick call-outs shown to" style={{ ...inputStyle, width: "auto" }} value={d.settings.sickVisibility}
        onChange={async e => { try { await call("/settings", { sickVisibility: e.target.value }); toast("Saved."); load(); } catch (x) { toast(x.message); } }}>
        <option value="everyone">Everyone</option><option value="division">Their division only</option><option value="off">Nobody (don't show them)</option>
      </select>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8 }}>Only "Out sick" (or just "Out" for protected leave) and the days are shown: never hours, notes or reasons.</div>
    </div>;
  }
  return (
    <AppShell section="Off Work" nav={nav} active={editing ? "post" : view} onNav={k => { setEditing(null); setView(k); }} onHome={onBack}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{editing ? `Edit days off: ${editing.name}` : TITLE[view]}</div>
        {body}
      </div>
      {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 50 }}>{msg}</div>}
    </AppShell>
  );
}
