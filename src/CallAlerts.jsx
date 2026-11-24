// Call alerts (server/callalerts.js): choose which Active calls send a push notification, and to whom. Everyone can make their own
// alerts and turn off department alerts sent to them; Call alerts edit makes alerts for people and groups.
import React, { useEffect, useState } from "react";
import { BellRing, Bell, BellOff, Users, Plus, Trash2, Pencil, Smartphone } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00";
async function call(path, body) {
  const r = await fetch(`/api/callalerts${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const when = d => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const join = a => (a || []).join(", ");
const split = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
export function describe(m = {}) {
  const parts = [];
  if (m.types?.length) parts.push(`call type has ${m.types.map(t => `“${t}”`).join(" or ")}`);
  if (m.exclude?.length) parts.push(`not ${m.exclude.map(t => `“${t}”`).join(" / ")}`);
  if (m.units?.length) parts.push(`unit ${m.units.join(" or ")} assigned`);
  if (m.agencies?.length) parts.push(m.agencies.join(" or "));
  if (m.priorities?.length) parts.push(`priority ${m.priorities.join(" or ")}`);
  return parts.join(" · ") || "(nothing chosen)";
}

function RuleEditor({ rule, dept, info, people, groups, onDone, onCancel, toast }) {
  const m = rule?.match || {};
  const [f, setF] = useState({ name: rule?.name || "", active: rule?.active !== false, types: join(m.types), exclude: join(m.exclude), units: join(m.units),
    agencies: m.agencies || [], agencyText: "", priorities: join(m.priorities), important: !!rule?.important, onDutyOnly: !!rule?.onDutyOnly, showAddress: !!rule?.showAddress,
    recipients: rule?.recipients || [] });
  const [pick, setPick] = useState(""), [test, setTest] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const match = () => ({ types: split(f.types), exclude: split(f.exclude), units: split(f.units), agencies: [...f.agencies, ...split(f.agencyText)], priorities: split(f.priorities) });
  const save = async () => {
    try {
      await call("/rules", { id: rule?.id, personal: !dept, name: f.name, active: f.active, match: match(), recipients: f.recipients, important: f.important, onDutyOnly: f.onDutyOnly, showAddress: f.showAddress });
      toast("Saved."); onDone();
    } catch (e) { toast(e.message); }
  };
  const tryIt = async () => { try { setTest(await call("/test", { match: match() })); } catch (e) { toast(e.message); } };
  const add = v => {
    if (!v) return; const [kind, id] = v.split(":");
    const name = kind === "group" ? groups.find(g => g.id === id)?.name : people.find(p => p.id === id)?.name;
    if (name && !f.recipients.some(x => x.kind === kind && x.id === id)) set("recipients", [...f.recipients, { kind, id, name }]);
    setPick("");
  };
  const agencies = [...new Set([...(info.agencies || []), ...f.agencies])];
  return <section style={cardStyle} aria-label="Call alert">
    <div style={{ fontWeight: 800, color: INK, fontSize: 16, marginBottom: 10 }}>{rule ? "Change call alert" : dept ? "New call alert for people or groups" : "New call alert for me"}</div>
    <label style={{ display: "block", marginBottom: 10 }}><span style={label}>Name</span>
      <input aria-label="Alert name" style={inputStyle} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Structure fires in our district" /></label>
    <div style={{ fontWeight: 700, color: INK, margin: "6px 0" }}>Which calls</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
      <label><span style={label}>Call type has any of these words</span>
        <input aria-label="Call type words" list="ca-types" style={inputStyle} value={f.types} onChange={e => set("types", e.target.value)} placeholder="FIRE, ALARM, MVA" />
        <datalist id="ca-types">{(info.types || []).map(t => <option key={t} value={t} />)}</datalist></label>
      <label><span style={label}>…but not these words</span>
        <input aria-label="Not these words" style={inputStyle} value={f.exclude} onChange={e => set("exclude", e.target.value)} placeholder="BRUSH, CONTROLLED BURN" /></label>
      <label><span style={label}>A unit like these is assigned</span>
        <input aria-label="Units" style={inputStyle} value={f.units} onChange={e => set("units", e.target.value)} placeholder="EG613, ??61*, LD6*" />
        <span style={{ fontSize: 11.5, color: INK_SOFT }}>? = one letter or digit, * = anything. Fires when that unit is put on the call.</span></label>
      <label><span style={label}>Priority</span>
        <input aria-label="Priorities" style={inputStyle} value={f.priorities} onChange={e => set("priorities", e.target.value)} placeholder="1, 2 (blank = any)" /></label>
    </div>
    <div style={{ marginTop: 10 }}><span style={label}>Agency (none checked = any)</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {agencies.map(a => <label key={a} style={{ fontSize: 13.5, display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={f.agencies.includes(a)} onChange={e => set("agencies", e.target.checked ? [...f.agencies, a] : f.agencies.filter(x => x !== a))} />{a}</label>)}
        <input aria-label="Other agency" style={{ ...inputStyle, width: 200 }} value={f.agencyText} onChange={e => set("agencyText", e.target.value)} placeholder="Other agency name" /></div></div>
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
      <button type="button" style={btn("outline")} onClick={tryIt}>Check against calls open now</button>
      {test && <span style={{ fontSize: 13, color: INK }}>{test.count ? `${test.count} open call(s) match: ${test.calls.slice(0, 4).map(c => `${c.type}${c.units.length ? ` (${c.units.join(", ")})` : ""}`).join("; ")}` : "No open calls match right now."}</span>}
    </div>
    {dept && <>
      <div style={{ fontWeight: 700, color: INK, margin: "14px 0 6px" }}>Who gets it</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {f.recipients.map(x => <span key={x.kind + x.id} style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 999, padding: "3px 10px", fontSize: 13 }}>
          {x.kind === "group" ? <Users size={12} /> : null} {x.name}{" "}
          <button type="button" aria-label={`Remove ${x.name}`} onClick={() => set("recipients", f.recipients.filter(y => y !== x))} style={{ border: "none", background: "none", cursor: "pointer", color: BRICK }}>×</button></span>)}
      </div>
      <select aria-label="Add people or groups" style={{ ...inputStyle, maxWidth: 360 }} value={pick} onChange={e => add(e.target.value)}>
        <option value="">Add a group or person…</option>
        <optgroup label="Groups">{groups.map(g => <option key={g.id} value={`group:${g.id}`}>{g.name} ({g.size})</option>)}</optgroup>
        <optgroup label="People">{people.map(p => <option key={p.id} value={`user:${p.id}`}>{p.name}</option>)}</optgroup>
      </select>
    </>}
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, fontSize: 13.5, color: INK }}>
      <label style={{ display: "flex", gap: 6 }}><input type="checkbox" checked={f.important} onChange={e => set("important", e.target.checked)} /> Important (reaches phones set to "important only" and stays on screen)</label>
      {dept && <label style={{ display: "flex", gap: 6 }}><input type="checkbox" checked={f.onDutyOnly} onChange={e => set("onDutyOnly", e.target.checked)} /> Only people Aladtec has on duty right now</label>}
      {dept && <label style={{ display: "flex", gap: 6 }}><input type="checkbox" checked={f.showAddress} onChange={e => set("showAddress", e.target.checked)} /> Put the address in the notification</label>}
      {dept && f.showAddress && <div style={{ fontSize: 12.5, color: AMBER, marginLeft: 22 }}>Addresses then show on phone lock screens. Without it, people tap the alert to see the call in {PN}.</div>}
      <label style={{ display: "flex", gap: 6 }}><input type="checkbox" checked={f.active} onChange={e => set("active", e.target.checked)} /> On</label>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="button" style={btn("primary")} onClick={save}>Save</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
  </section>;
}

export default function CallAlertsModule({ onBack }) {
  const [d, setD] = useState(null), [dept, setDept] = useState(null), [page, setPage] = useState("mine"), [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState(null), [error, setError] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(null), 2600); };
  const load = () => call("").then(setD, e => setError(e.message));
  const loadDept = () => call("/rules").then(setDept, e => toast(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (page === "dept" && d?.canDept) loadDept(); }, [page, d?.canDept]);   // eslint-disable-line react-hooks/exhaustive-deps
  const mute = async (r, muted) => { try { await call(`/rules/${r.id}/mute`, { muted }); load(); toast(muted ? "Turned off for you." : "Turned back on."); } catch (e) { toast(e.message); } };
  const remove = async r => { try { await call(`/rules/${r.id}/remove`, {}); load(); if (page === "dept") loadDept(); toast("Removed."); } catch (e) { toast(e.message); } };
  const nav = [{ key: "mine", label: "My call alerts", icon: Bell }, ...(d?.canDept ? [{ key: "dept", label: "Alerts for people & groups", icon: Users }] : [])];
  const done = () => { setEdit(null); load(); if (page === "dept") loadDept(); };
  const RuleRow = ({ r, mine, deptRow }) => <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${LINE}` }} aria-label={r.name}>
    {r.muted || !r.active ? <BellOff size={18} color={INK_SOFT} /> : <BellRing size={18} color={BRICK} />}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, color: INK }}>{r.name}{!r.active && <span style={{ color: INK_SOFT, fontWeight: 400 }}> (off)</span>}{r.important && <span style={{ color: BRICK, fontSize: 12, marginLeft: 6 }}>important</span>}</div>
      <div style={{ fontSize: 13, color: INK_SOFT }}>{describe(r.match)}</div>
      {deptRow && <div style={{ fontSize: 12.5, color: INK_SOFT }}>To: {r.recipients.map(x => x.name).join(", ")} · reaches {r.reaches}{r.mutedBy ? ` (${r.mutedBy} turned it off)` : ""}{r.onDutyOnly ? " · on duty only" : ""}{r.showAddress ? " · with address" : ""}</div>}
      {!mine && !deptRow && <div style={{ fontSize: 12.5, color: INK_SOFT }}>From the department{r.onDutyOnly ? " · only while you're on duty" : ""}</div>}
    </div>
    {(mine || deptRow) && <button type="button" aria-label={`Change ${r.name}`} style={btn("ghost")} onClick={() => setEdit({ rule: r, dept: deptRow })}><Pencil size={14} /></button>}
    {(mine || deptRow) && <button type="button" aria-label={`Remove ${r.name}`} style={{ ...btn("ghost"), color: BRICK }} onClick={() => remove(r)}><Trash2 size={14} /></button>}
    {!mine && !deptRow && <button type="button" style={btn("outline")} onClick={() => mute(r, !r.muted)}>{r.muted ? "Turn back on" : "Turn off for me"}</button>}
  </div>;

  return <AppShell section="Call Alerts" nav={nav} active={page} onNav={k => { setPage(k); setEdit(null); }} onHome={onBack}>
    {error && <div style={{ ...cardStyle, color: BRICK }}>{error}</div>}
    {d && !d.cadConfigured && <div style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}`, fontSize: 13.5 }}>Active calls isn't connected to CAD on this server, so no alerts will go out yet.</div>}
    {d && page === "mine" && !edit && <>
      <div style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, borderLeft: `4px solid ${d.pushDevices ? SAGE : AMBER}` }}>
        <Smartphone size={18} color={d.pushDevices ? SAGE : AMBER} />
        <div style={{ flex: 1 }}>{d.pushDevices ? `Alerts go to your ${d.pushDevices} device${d.pushDevices === 1 ? "" : "s"} with notifications on, and pop up here while ${PN} is open.`
          : "Turn on notifications on your phone (chat button › Alert settings › Phone & computer notifications) to get alerts when " + PN + " isn't open."}</div></div>
      <section style={cardStyle} aria-label="My call alerts">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: INK }}>Alerts you get</div>
          <button type="button" style={btn("primary")} onClick={() => setEdit({ rule: null, dept: false })}><Plus size={14} /> New alert for me</button></div>
        {!d.rules.length && <div style={{ fontSize: 13.5, color: INK_SOFT, marginTop: 8 }}>None yet. Make one, e.g. call type “FIRE” or unit “EG613”.</div>}
        {d.rules.map(r => <RuleRow key={r.id} r={r} mine={r.personal} />)}
      </section>
      <section style={cardStyle} aria-label="Recent alerts">
        <div style={{ fontWeight: 800, color: INK, marginBottom: 6 }}>Recent alerts</div>
        {!d.recent.length && <div style={{ fontSize: 13.5, color: INK_SOFT }}>None yet.</div>}
        {d.recent.map((x, i) => <div key={i} style={{ fontSize: 13.5, padding: "5px 0", borderBottom: `1px solid ${LINE}` }}>
          <span style={{ color: INK_SOFT }}>{when(x.sent_at)}</span> · <b>{x.call_type || "Call"}</b>{x.units ? ` · ${x.units}` : ""}{x.agency ? ` · ${x.agency}` : ""} <span style={{ color: INK_SOFT }}>({x.name})</span></div>)}
      </section>
    </>}
    {d && page === "dept" && !edit && dept && <>
      <section style={cardStyle} aria-label="Department call alerts">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, color: INK }}>Alerts for people and groups</div>
          <button type="button" style={btn("primary")} onClick={() => setEdit({ rule: null, dept: true })}><Plus size={14} /> New alert</button></div>
        {!dept.rules.length && <div style={{ fontSize: 13.5, color: INK_SOFT, marginTop: 8 }}>None yet.</div>}
        {dept.rules.map(r => <RuleRow key={r.id} r={r} deptRow />)}
      </section>
      <section style={cardStyle} aria-label="Sent">
        <div style={{ fontWeight: 800, color: INK, marginBottom: 6 }}>Sent</div>
        {!dept.sent.length && <div style={{ fontSize: 13.5, color: INK_SOFT }}>Nothing sent yet.</div>}
        {dept.sent.map((x, i) => <div key={i} style={{ fontSize: 13.5, padding: "5px 0", borderBottom: `1px solid ${LINE}` }}>
          <span style={{ color: INK_SOFT }}>{when(x.at)}</span> · <b>{x.type || "Call"}</b>{x.units ? ` · ${x.units}` : ""} · {x.rule} · {x.people} people, {x.devices} devices</div>)}
      </section>
    </>}
    {d && edit && <RuleEditor rule={edit.rule} dept={edit.dept} info={d} people={dept?.people || []} groups={dept?.groups || []} onDone={done} onCancel={() => setEdit(null)} toast={toast} />}
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{msg}</div>}
  </AppShell>;
}
