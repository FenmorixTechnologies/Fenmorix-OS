// User Management › Organization (master admins): what kind of organization this is, its wording, divisions, work schedules
// and pay periods. Server: server/system.js /api/system/org + /divisions -> <SYSTEM_DIR>/settings/org.json (kept across updates).
// Pages read the saved settings from the nexus-brand meta, so a reload shows the change.
import React, { useEffect, useState } from "react";
import { Building2, RefreshCw, Pencil, Trash2, Plus, ArrowUp, ArrowDown, LayoutGrid } from "lucide-react";
import { menuLayout, TILE_LABELS } from "./modules.js";
import { tileOn, tileName } from "./licensing.js";
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
    words: v === "fire" ? { station: "Station / assignment", homeStation: "Home station", callSign: "Radio call sign" }
      : (w => ({ station: w, homeStation: w, callSign: "" }))({ education: "Campus / building", government: "Office / location" }[v] || "Location"),
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
          {[["business", "A business or office", "Locations, Mon–Fri workdays, no radio call signs"], ["government", "A government office", "Cities, parishes, counties, utilities: offices, Mon–Fri workdays"],
            ["education", "A school or district", "Campuses and buildings, faculty and staff, students"], ["fire", "A fire / EMS department", "Stations, 24-hour and 12-hour rotations, call signs"]].map(([v, t, d]) =>
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
    <JobRoles list={s.roles || []} profiles={s.profiles || []} toast={toast} onChange={x => setS(o => ({ ...o, roles: x.roles }))} />
    <MainMenu menu={s.menu} toast={toast} onChange={x => setS(o => ({ ...o, menu: x.menu }))} />
  </>;
}

// Main menu: the Home side bar's groups, their order, and which sections are in each (sections this install has)
function MainMenu({ menu, toast, onChange }) {
  const here = new Map(TILE_LABELS.filter(t => tileOn(t.key)).map(t => [t.key, tileName(t.key, t.label)]));
  const fromSaved = m => menuLayout(m).map(g => ({ name: g.name, keys: g.keys.filter(k => here.has(k)) }));
  const [groups, setGroups] = useState(() => fromSaved(menu)), [closed, setClosed] = useState(!!menu?.startClosed);
  const [add, setAdd] = useState(""), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const change = fn => { setGroups(g => fn(g.map(x => ({ ...x, keys: [...x.keys] })))); setDirty(true); };
  const swap = (arr, i, j) => { if (j < 0 || j >= arr.length) return arr; [arr[i], arr[j]] = [arr[j], arr[i]]; return arr; };
  const save = async (reset) => {
    setBusy(true);
    try {
      const x = await call("/org", { menu: reset ? null : { groups: groups.filter(g => g.name.trim()), startClosed: closed } });
      setGroups(fromSaved(x.menu)); setClosed(!!x.menu?.startClosed); setDirty(false); onChange(x);
      toast(reset ? "Back to the built-in menu. Reload to see it." : "Main menu saved. Reload to see it.");
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const small = { ...btn("ghost"), padding: "2px 6px" };
  return <section style={{ ...cardStyle, marginTop: 14 }} aria-label="Main menu">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <div><div style={h}><LayoutGrid size={16} style={{ verticalAlign: -3 }} /> Main menu</div>
        <div style={note}>The groups on the Home side bar. People click a group to open or close it; their choice is remembered on their device.</div></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={btn("outline")} disabled={busy} onClick={() => save(true)}>Use the built-in menu</button>
        <button type="button" style={btn("primary")} disabled={busy || !dirty} onClick={() => save(false)}>{busy ? "Saving…" : "Save the menu"}</button></div></div>
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 10 }}>
      <input type="checkbox" checked={closed} onChange={e => { setClosed(e.target.checked); setDirty(true); }} /> Groups start closed (people open the ones they use)</label>
    {groups.map((g, gi) => <div key={gi} role="group" aria-label={`Menu group ${g.name || gi + 1}`} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, marginTop: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <input aria-label="Group name" style={{ ...inputStyle, maxWidth: 260, fontWeight: 700 }} value={g.name} maxLength={40} onChange={e => { const v = e.target.value; change(a => { a[gi].name = v; return a; }); }} />
        <button type="button" aria-label={`Move group ${g.name} up`} style={small} onClick={() => change(a => swap(a, gi, gi - 1))}><ArrowUp size={14} /></button>
        <button type="button" aria-label={`Move group ${g.name} down`} style={small} onClick={() => change(a => swap(a, gi, gi + 1))}><ArrowDown size={14} /></button>
        <span style={{ flex: 1 }} />
        {!g.keys.length && <button type="button" aria-label={`Remove group ${g.name}`} style={small} onClick={() => change(a => { a.splice(gi, 1); return a; })}><Trash2 size={14} /></button>}
      </div>
      {!g.keys.length && <div style={{ ...note, marginTop: 6 }}>Empty: move sections here, or remove it.</div>}
      {g.keys.map((k, ki) => <div key={k} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderTop: ki ? `1px solid ${LINE}` : "none", marginTop: ki ? 0 : 6 }}>
        <span style={{ flex: 1, fontSize: 14, color: INK }}>{here.get(k)}</span>
        <button type="button" aria-label={`Move ${here.get(k)} up`} style={small} onClick={() => change(a => { swap(a[gi].keys, ki, ki - 1); return a; })}><ArrowUp size={13} /></button>
        <button type="button" aria-label={`Move ${here.get(k)} down`} style={small} onClick={() => change(a => { swap(a[gi].keys, ki, ki + 1); return a; })}><ArrowDown size={13} /></button>
        <select aria-label={`Group for ${here.get(k)}`} style={{ ...inputStyle, width: 200 }} value={gi} onChange={e => { const to = Number(e.target.value); change(a => { a[gi].keys.splice(ki, 1); a[to].keys.push(k); return a; }); }}>
          {groups.map((x, xi) => <option key={xi} value={xi}>{x.name || `Group ${xi + 1}`}</option>)}</select>
      </div>)}
    </div>)}
    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
      <input aria-label="New group name" style={{ ...inputStyle, maxWidth: 260 }} placeholder="New group name" maxLength={40} value={add} onChange={e => setAdd(e.target.value)} />
      <button type="button" style={btn("outline")} disabled={!add.trim() || groups.some(g => g.name.toLowerCase() === add.trim().toLowerCase())}
        onClick={() => { change(a => [...a, { name: add.trim(), keys: [] }]); setAdd(""); }}><Plus size={14} /> Add a group</button></div>
  </section>;
}

// Divisions (departments): add, rename, remove (moving their people to another one)
// Job roles: what people are called here (their job title), each optionally carrying a permission profile
function JobRoles({ list, profiles, toast, onChange }) {
  const [add, setAdd] = useState({ name: "", profile: "" }), [edit, setEdit] = useState(null), [del, setDel] = useState(null), [busy, setBusy] = useState(false);
  const pname = k => profiles.find(p => p.key === k)?.name || k;
  const run = async (body, msg) => {
    setBusy(true);
    try { onChange(await call("/roles", body)); toast(msg); setEdit(null); setDel(null); setAdd({ name: "", profile: "" }); return true; }
    catch (e) { toast(e.message); return false; } finally { setBusy(false); }
  };
  const ProfilePick = ({ value, onPick, label }) => <select aria-label={label} style={{ ...inputStyle, width: "auto" }} value={value} onChange={e => onPick(e.target.value)}>
    <option value="">No extra access</option>{profiles.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select>;
  return <section style={cardStyle} aria-label="Job roles">
    <div style={h}>Job roles</div>
    <div style={note}>What people are called here, picked when you approve someone or edit them in People &amp; roles. A role can come with a
      permission profile: everyone given the role gets that access, and changing the role's access changes it for all of them.</div>
    <div style={{ marginTop: 10, border: `1px solid ${LINE}`, borderRadius: 8 }}>
      {!list.length && <div style={{ ...note, padding: "10px" }}>No roles yet.</div>}
      {list.map((r, i) => <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: i ? `1px solid ${LINE}` : "none", flexWrap: "wrap" }}>
        {edit?.name === r.name ? <>
          <input aria-label={`New name for ${r.name}`} autoFocus style={{ ...inputStyle, flex: "1 1 200px" }} value={edit.to} onChange={e => setEdit({ ...edit, to: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter") run({ action: "rename", name: r.name, to: edit.to }, "Renamed."); }} />
          <button type="button" style={btn("primary")} disabled={busy || !edit.to.trim()} onClick={() => run({ action: "rename", name: r.name, to: edit.to }, "Renamed.")}>Save</button>
          <button type="button" style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
        </> : del === r.name ? <>
          <span style={{ flex: "1 1 200px", color: INK }}>Remove <b>{r.name}</b>?{r.people ? ` Its ${r.people} ${r.people === 1 ? "person keeps" : "people keep"} the title${r.profile ? " but lose the role's access" : ""}.` : ""}</span>
          <button type="button" style={{ ...btn("primary"), background: BRICK }} disabled={busy} onClick={() => run({ action: "remove", name: r.name }, "Removed.")}>Remove</button>
          <button type="button" style={btn("ghost")} onClick={() => setDel(null)}>Cancel</button>
        </> : <>
          <span style={{ flex: "1 1 160px", color: INK, fontWeight: 600 }}>{r.name}</span>
          <span style={note}>{r.people} {r.people === 1 ? "person" : "people"}</span>
          <ProfilePick label={`Access for ${r.name}`} value={r.profile} onPick={v => run({ action: "profile", name: r.name, profile: v }, v ? `${r.name} now comes with ${pname(v)}.` : `${r.name} no longer comes with extra access.`)} />
          <button type="button" aria-label={`Rename ${r.name}`} style={btn("ghost")} onClick={() => { setDel(null); setEdit({ name: r.name, to: r.name }); }}><Pencil size={14} /> Rename</button>
          <button type="button" aria-label={`Remove ${r.name}`} style={btn("ghost")} onClick={() => { setEdit(null); setDel(r.name); }}><Trash2 size={14} /> Remove</button>
        </>}
      </div>)}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      <input aria-label="New job role" style={{ ...inputStyle, flex: "1 1 220px" }} value={add.name} placeholder="New role, e.g. Sales associate" onChange={e => setAdd({ ...add, name: e.target.value })}
        onKeyDown={e => { if (e.key === "Enter" && add.name.trim()) run({ action: "add", ...add }, "Added."); }} />
      <ProfilePick label="Access for the new role" value={add.profile} onPick={v => setAdd({ ...add, profile: v })} />
      <button type="button" style={btn("outline")} disabled={busy || !add.name.trim()} onClick={() => run({ action: "add", ...add }, "Added.")}><Plus size={14} /> Add role</button>
    </div>
    <div style={{ ...note, marginTop: 8 }}>The profiles themselves (what Manager or Supervisor can see and do) are set in Permissions › Profiles.</div>
  </section>;
}

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
