// User Management › Organization (master admins): what kind of organization this is, its wording, divisions, work schedules
// and pay periods. Server: server/system.js /api/system/org + /divisions -> <SYSTEM_DIR>/settings/org.json (kept across updates).
// Pages read the saved settings from the nexus-brand meta, so a reload shows the change.
import React, { useEffect, useState } from "react";
import { Building2, RefreshCw, Pencil, Trash2, Plus } from "lucide-react";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { call } from "./SystemAdmin.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#B42318";
const lbl = { fontSize: 12, fontWeight: 700, color: INK_SOFT, display: "block", marginBottom: 3 };
const h = { fontWeight: 800, color: INK, fontSize: 15, marginBottom: 4 };
const note = { fontSize: 12.5, color: INK_SOFT };
const PAY = [["weekly", "Every week"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month (1st–15th, 16th–end)"], ["monthly", "Once a month"]];

export default function OrgAdmin({ toast }) {
  const [s, setS] = useState(null), [f, setF] = useState(null), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const load = () => call("/org").then(x => { setS(x); setF({ industry: x.industry, words: { ...x.words }, useCallSign: !!x.words.callSign, work: JSON.parse(JSON.stringify(x.work)) }); }, e => toast(e.message));
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !f) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const setW = (k, v) => setF(o => ({ ...o, work: { ...o.work, [k]: v } }));
  const setPay = (k, v) => setF(o => ({ ...o, work: { ...o.work, pay: { ...o.work.pay, [k]: v } } }));
  const setWord = (k, v) => setF(o => ({ ...o, words: { ...o.words, [k]: v } }));
  // Choosing a type fills in that type's usual wording and schedules (still editable before saving)
  const pickIndustry = v => setF(o => ({
    ...o, industry: v, useCallSign: v === "fire",
    words: v === "fire" ? { station: "Station / assignment", homeStation: "Home station", callSign: "Radio call sign" } : { station: "Location", homeStation: "Location", callSign: "" },
    work: { ...o.work, rotations: { fire: v === "fire", comms: v === "fire" } },
  }));
  const save = async () => {
    setBusy(true);
    try {
      const w = f.work;
      const x = await call("/org", {
        industry: f.industry, words: { ...f.words, callSign: f.useCallSign ? (f.words.callSign || "Radio call sign") : "" },
        work: { rotations: w.rotations, pay: { kind: w.pay.kind, start: w.pay.start, payDays: Number(w.pay.payDays) || 0 },
          periodHours: w.periodHours === "" || w.periodHours == null ? null : Number(w.periodHours), dayHours: Number(w.dayHours), dayStart: w.dayStart },
      });
      setS(x); setSaved(true); toast("Saved. Reload the page to see it everywhere.");
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const fixed = f.work.pay.kind === "weekly" || f.work.pay.kind === "biweekly";
  return <>
    <section style={cardStyle} aria-label="Organization">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div><div style={h}><Building2 size={16} style={{ verticalAlign: -3 }} /> Organization</div>
          <div style={note}>What kind of organization this is, the words it uses, its workdays and pay periods. Kept when the app is updated.</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          {saved && <button type="button" style={btn("outline")} onClick={() => window.location.reload()}><RefreshCw size={14} /> Reload to see it</button>}
          <button type="button" style={btn("primary")} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div></div>

      <div style={{ marginTop: 14 }}>
        <span style={lbl}>This organization is</span>
        <div role="radiogroup" aria-label="Type of organization" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[["business", "A business or office", "Locations, Mon–Fri workdays, no radio call signs"], ["fire", "A fire / EMS department", "Stations, 24-hour and 12-hour rotations, call signs"]].map(([v, t, d]) =>
            <label key={v} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", maxWidth: 320 }}>
              <input type="radio" name="industry" checked={f.industry === v} onChange={() => pickIndustry(v)} style={{ marginTop: 3 }} />
              <span><b style={{ color: INK }}>{t}</b><br /><span style={note}>{d}</span></span></label>)}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ ...h, fontSize: 14 }}>Wording</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <label><span style={lbl}>Where someone works (Personnel File)</span>
            <input aria-label="Work location label" style={inputStyle} value={f.words.station} placeholder="e.g. Location, Store, Office" onChange={e => setWord("station", e.target.value)} /></label>
          <label><span style={lbl}>Where someone works (Directory card)</span>
            <input aria-label="Directory location label" style={inputStyle} value={f.words.homeStation} placeholder="e.g. Location, Home station" onChange={e => setWord("homeStation", e.target.value)} /></label>
          <div><span style={lbl}>Radio call signs</span>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
              <input type="checkbox" checked={f.useCallSign} onChange={e => setF(o => ({ ...o, useCallSign: e.target.checked, words: { ...o.words, callSign: e.target.checked ? (o.words.callSign || "Radio call sign") : "" } }))} />
              People have call signs</label>
            {f.useCallSign && <input aria-label="Call sign label" style={{ ...inputStyle, marginTop: 4 }} value={f.words.callSign} onChange={e => setWord("callSign", e.target.value)} />}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ ...h, fontSize: 14 }}>Workdays and pay periods</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label><span style={lbl}>People are paid</span>
            <select aria-label="Pay period" style={inputStyle} value={f.work.pay.kind} onChange={e => setPay("kind", e.target.value)}>
              {PAY.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
          {fixed && <label><span style={lbl}>First day of any one pay period</span>
            <input aria-label="Pay period start" type="date" style={inputStyle} value={f.work.pay.start || ""} onChange={e => setPay("start", e.target.value)} /></label>}
          <label><span style={lbl}>Payday: days after the period ends</span>
            <input aria-label="Days until payday" type="number" min="0" max="31" style={inputStyle} value={f.work.pay.payDays} onChange={e => setPay("payDays", e.target.value)} /></label>
          <label><span style={lbl}>Hours in a workday</span>
            <input aria-label="Hours in a workday" type="number" min="1" max="24" step="0.25" style={inputStyle} value={f.work.dayHours} onChange={e => setW("dayHours", e.target.value)} /></label>
          <label><span style={lbl}>Workday usually starts</span>
            <input aria-label="Workday start" type="time" style={inputStyle} value={f.work.dayStart} onChange={e => setW("dayStart", e.target.value)} /></label>
          <label><span style={lbl}>Hours expected per pay period</span>
            <input aria-label="Hours per pay period" type="number" min="0" step="0.5" style={inputStyle} value={f.work.periodHours ?? ""} placeholder="Workdays × hours in a workday" onChange={e => setW("periodHours", e.target.value)} /></label>
        </div>
        <div style={{ ...note, marginTop: 6 }}>Leave "Hours expected" empty to use Monday–Friday days × hours in a workday (80 for two weeks of 8-hour days).</div>
        <div style={{ marginTop: 10 }}>
          <span style={lbl}>Schedules people can pick (Time Tracker, Sick Leave)</span>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5 }}>
            <label><input type="checkbox" checked disabled /> Mon–Fri days (always)</label>
            <label><input type="checkbox" checked={f.work.rotations.fire} onChange={e => setW("rotations", { ...f.work.rotations, fire: e.target.checked })} /> Fire 24-hour shifts (A/B/C)</label>
            <label><input type="checkbox" checked={f.work.rotations.comms} onChange={e => setW("rotations", { ...f.work.rotations, comms: e.target.checked })} /> Communications 12-hour crews (A–D)</label>
          </div>
        </div>
      </div>
    </section>
    <Divisions list={s.divisions} toast={toast} onChange={x => setS(o => ({ ...o, divisions: x.divisions }))} />
  </>;
}

// Divisions (departments): add, rename, remove (moving their people to another one)
function Divisions({ list, toast, onChange }) {
  const [add, setAdd] = useState(""), [edit, setEdit] = useState(null), [del, setDel] = useState(null), [busy, setBusy] = useState(false);
  const run = async (body, msg) => {
    setBusy(true);
    try { onChange(await call("/divisions", body)); toast(msg); setEdit(null); setDel(null); setAdd(""); return true; }
    catch (e) { toast(e.message); return false; } finally { setBusy(false); }
  };
  return <section style={cardStyle} aria-label="Divisions">
    <div style={h}>Divisions</div>
    <div style={note}>The groups people belong to (departments, crews, stores). Used for permissions, Off Work, Sick Leave and more. Renaming keeps everyone in it.</div>
    <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 8 }}>
      {list.map((d, i) => <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: i ? `1px solid ${LINE}` : "none", flexWrap: "wrap" }}>
        {edit?.name === d.name ? <>
          <input aria-label={`New name for ${d.name}`} autoFocus style={{ ...inputStyle, flex: "1 1 200px" }} value={edit.to} onChange={e => setEdit({ ...edit, to: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") run({ action: "rename", name: d.name, to: edit.to }, "Renamed."); }} />
          <button type="button" style={btn("primary")} disabled={busy || !edit.to.trim()} onClick={() => run({ action: "rename", name: d.name, to: edit.to }, "Renamed.")}>Save</button>
          <button type="button" style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
        </> : del?.name === d.name ? <>
          <span style={{ flex: "1 1 200px", color: INK }}>Remove <b>{d.name}</b>{d.people ? <> · move its {d.people} {d.people === 1 ? "person" : "people"} to </> : "?"}</span>
          {d.people > 0 && <select aria-label="Move people to" style={{ ...inputStyle, width: "auto" }} value={del.moveTo} onChange={e => setDel({ ...del, moveTo: e.target.value })}>
            <option value="">Pick a division…</option>{list.filter(x => x.name !== d.name).map(x => <option key={x.name}>{x.name}</option>)}</select>}
          <button type="button" style={{ ...btn("primary"), background: BRICK }} disabled={busy || (d.people > 0 && !del.moveTo)}
            onClick={() => run({ action: "remove", name: d.name, moveTo: del.moveTo || undefined }, "Removed.")}>Remove</button>
          <button type="button" style={btn("ghost")} onClick={() => setDel(null)}>Cancel</button>
        </> : <>
          <span style={{ flex: "1 1 200px", color: INK, fontWeight: 600 }}>{d.name}</span>
          <span style={note}>{d.people} {d.people === 1 ? "person" : "people"}</span>
          <button type="button" aria-label={`Rename ${d.name}`} style={btn("ghost")} onClick={() => { setDel(null); setEdit({ name: d.name, to: d.name }); }}><Pencil size={14} /> Rename</button>
          <button type="button" aria-label={`Remove ${d.name}`} style={btn("ghost")} onClick={() => { setEdit(null); setDel({ name: d.name, moveTo: "" }); }}><Trash2 size={14} /> Remove</button>
        </>}
      </div>)}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      <input aria-label="New division" style={{ ...inputStyle, flex: "1 1 220px" }} value={add} placeholder="New division, e.g. Sales" onChange={e => setAdd(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && add.trim()) run({ action: "add", name: add }, "Added."); }} />
      <button type="button" style={btn("outline")} disabled={busy || !add.trim()} onClick={() => run({ action: "add", name: add }, "Added.")}><Plus size={14} /> Add division</button>
    </div>
  </section>;
}
