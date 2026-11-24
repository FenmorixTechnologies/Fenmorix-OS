// Permissions and groups (User Management). Data and rules live in server/access.js.
//   PermissionsPanel view="person"  - pick someone: everything they can do and why; give/remove access
//   PermissionsPanel view="section" - each section: who can do what; give/remove access
//   PermissionsPanel view="profiles" - permission profiles (masters): built-in + custom, give to people or groups
//   PermissionsPanel view="groups"  - groups with automatic rules + hand-picked members (masters and accounts admins)
// Masters can do everything here. Section managers see and change view/edit in their sections.
import React, { useEffect, useMemo, useState } from "react";
import { cardStyle, inputStyle, btn, ROLE_LABEL } from "./App.jsx";
import { WORK_PATTERNS } from "./shifts.js";
import { PN } from "./brand.js";

// Colors are local: this file loads while App.jsx is still starting up, so values used
// outside a component can't come from there.
const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00";
const LEVEL_LABEL = { view: "View", edit: "Edit", manage: "Manage" };
const LEVEL_COLOR = { view: "#1D5FA8", edit: "#7A4FB5", manage: BRICK };
const PATTERNS = WORK_PATTERNS.filter(([k]) => k);

async function call(path, body) {
  const r = await fetch(`/api/access${path}`, body === undefined ? { credentials: "same-origin" } : {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}

// Same rules as the server (access.js): within a kind any value matches; every kind that's set must match
const stationKey = v => { const s = String(v || "").trim().toLowerCase(); const n = s.match(/\d+/); return n ? String(Number(n[0])) : s; };
function matchesRules(r, u) {
  const checks = [];
  if (r.stations?.length) checks.push(r.stations.map(stationKey).includes(stationKey(u.station)) && !!String(u.station || "").trim());
  if (r.divisions?.length) checks.push(r.divisions.includes(u.division));
  if (r.patterns?.length) checks.push(r.patterns.includes(u.pattern || ""));
  if (r.roles?.length) checks.push(r.roles.includes(u.role));
  if (r.titles?.length) checks.push(r.titles.some(t => t && String(u.title || "").toLowerCase().includes(t.toLowerCase())));
  return checks.length > 0 && checks.every(Boolean);
}
const scopeText = g => (g.ownDivision ? "their own division" : g.division ? g.division : "all divisions");
const Pill = ({ level }) => <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: LEVEL_COLOR[level], borderRadius: 999, padding: "1px 8px" }}>{LEVEL_LABEL[level]}</span>;

export default function PermissionsPanel({ view, toast }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = () => call("").then(d => { setData(d); setError(""); }, e => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!data) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const ctx = { data, reload: load, toast };
  if (view === "groups") return <Groups {...ctx} />;
  if (view === "profiles") return <Profiles {...ctx} />;
  if (view === "section") return <BySection {...ctx} />;
  return <ByPerson {...ctx} />;
}

// ---- Give access (shared) --------------------------------------------------------------------
function GrantForm({ data, fixedSection, fixedSubject, onDone, toast }) {
  const grantable = data.sections.filter(s => data.canGrant[s.key]);
  const [section, setSection] = useState(fixedSection || grantable[0]?.key || "");
  const sec = data.sections.find(s => s.key === section);
  const levels = sec ? Object.keys(sec.levels).filter(l => data.isMaster || l !== "manage") : [];
  const [level, setLevel] = useState(levels[0] || "");
  const [subject, setSubject] = useState(fixedSubject || "");
  const [scope, setScope] = useState("all");
  const [divs, setDivs] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!levels.includes(level)) setLevel(levels[0] || ""); }, [section]);
  const mine = data.canGrant[section];
  const limited = mine && !mine.all;
  const divOptions = limited ? mine.divisions : data.divisions;
  if (!grantable.length) return null;

  async function give() {
    if (!subject) { toast("Choose a person or group"); return; }
    if (sec?.divisions && scope === "some" && !divs.length) { toast("Pick at least one division"); return; }
    const [kind, id] = subject.split(":");
    setBusy(true);
    try {
      await call("/grants", { section, level, [kind === "g" ? "groupId" : "userId"]: id, scope: !sec?.divisions ? "all" : scope === "some" || limited ? divs : scope });
      toast("Access given"); setDivs([]); if (!fixedSubject) setSubject(""); onDone();
    } catch (e) { toast(e.message); }
    setBusy(false);
  }
  const small = { ...inputStyle, width: "auto", padding: "6px 8px", fontSize: 13 };
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 12px", marginTop: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK_SOFT, marginBottom: 6 }}>Give access</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!fixedSubject && (
          <select aria-label="Person or group" style={{ ...small, minWidth: 200 }} value={subject} onChange={e => setSubject(e.target.value)}>
            <option value="">Person or group…</option>
            {data.groups.length > 0 && <optgroup label="Groups">{data.groups.map(g => <option key={g.id} value={`g:${g.id}`}>{g.name} ({g.members.length})</option>)}</optgroup>}
            <optgroup label="People">{data.people.map(p => <option key={p.id} value={`u:${p.id}`}>{p.name} — {p.division}</option>)}</optgroup>
          </select>
        )}
        {!fixedSection && (
          <select aria-label="Section" style={small} value={section} onChange={e => setSection(e.target.value)}>
            {grantable.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
        <select aria-label="Level" style={small} value={level} onChange={e => setLevel(e.target.value)}>
          {levels.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}: {sec.levels[l]}</option>)}
        </select>
        {sec?.divisions && !limited && (
          <select aria-label="Which divisions" style={small} value={scope} onChange={e => setScope(e.target.value)}>
            <option value="all">All divisions</option>
            <option value="own">Their own division</option>
            <option value="some">Chosen divisions…</option>
          </select>
        )}
        <button style={btn("primary")} disabled={busy} onClick={give}>Give access</button>
      </div>
      {sec?.divisions && (scope === "some" || limited) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, fontSize: 13 }}>
          {divOptions.map(d => (
            <label key={d} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={divs.includes(d)} onChange={e => setDivs(v => e.target.checked ? [...v, d] : v.filter(x => x !== d))} /> {d}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function canRemove(data, g) {
  const mine = data.canGrant[g.section];
  if (data.isMaster) return true;
  if (!mine || g.level === "manage") return false;
  return mine.all || (g.division && mine.divisions.includes(g.division));
}
async function removeGrant(g, who, reload, toast) {
  if (!window.confirm(`Remove ${who}'s ${LEVEL_LABEL[g.level].toLowerCase()} access (${scopeText(g)})?`)) return;
  try { await call(`/grants/${g.id}/remove`, {}); toast("Access removed"); reload(); } catch (e) { toast(e.message); }
}

// ---- By person ---------------------------------------------------------------------------------
// One row per section: does it show in their side bar, their level (from grants, groups, profiles or automatic rules),
// what that lets them do (what everyone gets + each level up to theirs), and where it comes from.
const LEVEL_ORDER = ["view", "edit", "manage"];
export function personMatrix(data, person) {
  const eff = data.effective[person.id] || [], auto = data.auto?.[person.id] || [];
  const master = person.role === "master";
  const sections = data.sections.filter(s => data.isMaster || data.canGrant[s.key]);
  return sections.map(s => {
    const from = eff.filter(g => g.section === s.key), au = auto.filter(a => a.section === s.key);
    let level = null;
    for (const g of [...from, ...au]) if (g.level && (!level || LEVEL_ORDER.indexOf(g.level) > LEVEL_ORDER.indexOf(level))) level = g.level;
    if (master) level = "master";
    const top = master ? "manage" : level;
    const can = [];
    if (s.everyone) can.push(s.everyone);
    for (const l of LEVEL_ORDER) if (s.levels[l] && top && LEVEL_ORDER.indexOf(l) <= LEVEL_ORDER.indexOf(top)) can.push(s.levels[l]);
    for (const a of au) if (!a.level) can.push(a.note);
    const shows = master || s.tile === "everyone" || (s.tile === "access" && (level || au.length > 0)) || (s.tile === "users" && level);
    const divs = master ? [] : [...new Set(from.filter(g => g.level === level && g.division).map(g => g.division))];
    const allDivs = from.some(g => g.level === level && !g.division) || au.some(a => a.level === level);
    return { s, level, shows, can, divs: allDivs ? [] : divs, from, auto: au };
  });
}
function ByPerson({ data, reload, toast }) {
  const [q, setQ] = useState("");
  const [pid, setPid] = useState("");
  const [onlyAccess, setOnlyAccess] = useState(false);
  const people = data.people.filter(p => !q || `${p.name} ${p.division} ${p.title}`.toLowerCase().includes(q.toLowerCase()));
  const person = data.people.find(p => p.id === pid);
  const groupsOf = person ? data.groups.filter(g => g.members.includes(person.id)) : [];
  const rows = person ? personMatrix(data, person) : [];
  const profilesOf = person ? (data.profileOf?.[person.id] || []).map(k => data.profiles.find(p => p.key === k)).filter(Boolean) : [];
  const directProfiles = person ? data.profiles.filter(p => p.assigned.some(m => m.userId === person.id)) : [];
  const [addProfile, setAddProfile] = useState("");
  const shown = onlyAccess ? rows.filter(r => r.level || r.auto.length) : rows;
  const sourceText = g => (g.via === "Direct" ? "given directly" : g.profile ? g.via : `group ${g.via}`);
  async function giveProfile() {
    if (!addProfile) return;
    try { await call(`/profiles/${addProfile}/assign`, { userIds: [person.id] }); toast("Profile given"); setAddProfile(""); reload(); } catch (e) { toast(e.message); }
  }
  async function takeProfile(p) {
    const m = p.assigned.find(x => x.userId === person.id);
    if (!m || !window.confirm(`Take the ${p.name} profile away from ${person.name}?`)) return;
    try { await call(`/profiles/${p.key}/unassign`, { id: m.id }); toast("Profile removed"); reload(); } catch (e) { toast(e.message); }
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div style={{ ...cardStyle, padding: 12 }}>
        <input aria-label="Find a person" style={{ ...inputStyle, marginBottom: 8 }} placeholder="Find a person…" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ maxHeight: 620, overflowY: "auto" }}>
          {people.map(p => {
            const n = new Set((data.effective[p.id] || []).map(g => g.section)).size;
            return (
              <button key={p.id} type="button" onClick={() => setPid(p.id)} aria-pressed={p.id === pid}
                style={{ display: "flex", width: "100%", textAlign: "left", gap: 8, alignItems: "center", border: "none", borderRadius: 6, padding: "7px 8px", cursor: "pointer", fontFamily: "inherit",
                  background: p.id === pid ? "#E8EEF8" : "transparent", color: INK }}>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontSize: 13.5 }}>{p.name}</b><br /><span style={{ fontSize: 12, color: INK_SOFT }}>{p.division} · {ROLE_LABEL[p.role] || p.role}</span></span>
                {(p.role === "master" || n > 0) && <span style={{ fontSize: 11, fontWeight: 800, color: p.role === "master" ? BRICK : INK_SOFT }}>{p.role === "master" ? "ALL" : n}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ ...cardStyle, overflowX: "auto" }}>
        {!person && <div style={{ color: INK_SOFT }}>Pick someone to see every section: what they can see and do there, and why.</div>}
        {person && <>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{person.name}</div>
          <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>{person.division} · {ROLE_LABEL[person.role] || person.role}{person.title ? ` · ${person.title}` : ""}
            {groupsOf.length > 0 && <> · groups: {groupsOf.map(g => g.name).join(", ")}</>}</div>
          {person.role === "master" && <div style={{ ...cardStyle, padding: "8px 12px", borderLeft: `4px solid ${BRICK}`, fontSize: 13, marginBottom: 10 }}>Master admin: sees and manages everything, no grants needed.</div>}
          {data.isMaster && person.role !== "master" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10, fontSize: 13.5 }} aria-label="Profiles" role="group">
              <b>Profiles:</b>
              {profilesOf.length === 0 && <span style={{ color: INK_SOFT }}>none</span>}
              {profilesOf.map(p => {
                const direct = directProfiles.includes(p);
                return <span key={p.key} style={{ background: "#E8EEF8", borderRadius: 999, padding: "2px 10px", fontWeight: 700 }}>{p.name}{!direct && <span style={{ fontWeight: 400, color: INK_SOFT }}> (through a group)</span>}
                  {direct && <button aria-label={`Remove profile ${p.name}`} onClick={() => takeProfile(p)} style={{ border: "none", background: "none", color: BRICK, cursor: "pointer", fontWeight: 800, marginLeft: 4 }}>×</button>}</span>;
              })}
              <select aria-label="Give a profile" style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 13 }} value={addProfile} onChange={e => setAddProfile(e.target.value)}>
                <option value="">Give a profile…</option>
                {data.profiles.filter(p => !directProfiles.includes(p)).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
              {addProfile && <button style={btn("primary")} onClick={giveProfile}>Give</button>}
            </div>
          )}
          <label style={{ fontSize: 12.5, color: INK_SOFT, display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
            <input type="checkbox" checked={onlyAccess} onChange={e => setOnlyAccess(e.target.checked)} /> Only sections where they have more than the basics</label>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }} aria-label={`Access for ${person.name}`}>
            <thead><tr>{["Section", "Side bar", "Access", "What they can do", "Comes from"].map(h => <th key={h} style={{ textAlign: "left", fontSize: 12, color: INK_SOFT, padding: "6px 8px", borderBottom: `2px solid ${LINE}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
            <tbody>{shown.map(({ s, level, shows, can, divs, from, auto }) => (
              <tr key={s.key} aria-label={s.label}>
                <td style={{ padding: "7px 8px", borderBottom: `1px solid ${LINE}`, fontWeight: 700, verticalAlign: "top" }}>{s.label}</td>
                <td style={{ padding: "7px 8px", borderBottom: `1px solid ${LINE}`, verticalAlign: "top", whiteSpace: "nowrap", color: shows ? SAGE : INK_SOFT, fontWeight: 700 }}>{shows ? "Shows" : "Hidden"}</td>
                <td style={{ padding: "7px 8px", borderBottom: `1px solid ${LINE}`, verticalAlign: "top", whiteSpace: "nowrap" }}>
                  {level === "master" ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "#fff", background: INK, borderRadius: 999, padding: "1px 8px" }}>Master</span>
                    : level ? <Pill level={level} /> : <span style={{ color: INK_SOFT }}>{s.everyone ? "Basic" : "None"}</span>}
                  {divs.length > 0 && <div style={{ fontSize: 11.5, color: INK_SOFT }}>{divs.join(", ")}</div>}
                </td>
                <td style={{ padding: "7px 8px", borderBottom: `1px solid ${LINE}`, verticalAlign: "top" }}>
                  {can.length ? <ul style={{ margin: 0, paddingLeft: 16 }}>{can.map((c, i) => <li key={i}>{c}</li>)}</ul> : <span style={{ color: INK_SOFT }}>Nothing: the section is hidden.</span>}
                </td>
                <td style={{ padding: "7px 8px", borderBottom: `1px solid ${LINE}`, verticalAlign: "top", fontSize: 12.5 }}>
                  {level === "master" && "master admin"}
                  {from.map((g, i) => {
                    const grant = g.grantId && data.grants.find(x => x.id === g.grantId);
                    return <div key={i}><Pill level={g.level} /> {sourceText(g)}{g.division ? ` (${g.own ? "own division" : g.division})` : ""}
                      {g.via === "Direct" && grant && canRemove(data, grant) && <button aria-label={`Remove ${s.label} ${g.level}`} style={{ ...btn("ghost"), color: BRICK, padding: "0 6px", fontSize: 12 }} onClick={() => removeGrant(grant, person.name, reload, toast)}>Remove</button>}</div>;
                  })}
                  {auto.map((a, i) => <div key={`a${i}`} style={{ color: INK_SOFT }}>{a.level && <Pill level={a.level} />} automatic: {a.level ? a.note : a.note.split(":")[0]}</div>)}
                  {!from.length && !auto.length && level !== "master" && <span style={{ color: INK_SOFT }}>—</span>}
                </td>
              </tr>))}</tbody>
          </table>
          <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 8 }}>Procurement, Reimbursements, Announcements, Meetings, PPE and the Personnel File show for everyone; signing and paying follow the person's role ({ROLE_LABEL[person.role] || person.role}) and signing divisions in People &amp; roles.</div>
          <GrantForm key={person.id} data={data} fixedSubject={`u:${person.id}`} onDone={reload} toast={toast} />
        </>}
      </div>
    </div>
  );
}

// ---- Profiles (masters) -------------------------------------------------------------------------
function Profiles({ data, reload, toast }) {
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState({});
  const nameOf = m => (m.userId ? data.people.find(p => p.id === m.userId)?.name || "(inactive person)" : `Group: ${data.groups.find(g => g.id === m.groupId)?.name || "?"}`);
  const sectionLabel = k => data.sections.find(s => s.key === k)?.label || k;
  async function assign(p) {
    const v = adding[p.key]; if (!v) return;
    const [kind, id] = v.split(":");
    try { await call(`/profiles/${p.key}/assign`, kind === "g" ? { groupIds: [id] } : { userIds: [id] }); toast(`${p.name} given`); setAdding(a => ({ ...a, [p.key]: "" })); reload(); } catch (e) { toast(e.message); }
  }
  async function act(p, what, body, msg, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await call(`/profiles/${p.key}/${what}`, body); toast(msg); reload(); } catch (e) { toast(e.message); }
  }
  if (editing) return <ProfileEditor data={data} profile={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} toast={toast} />;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 13, color: INK_SOFT }}>A profile adds its access on top of what someone already has (nothing is taken away). Give it to people or to a group (e.g. "Battalion Chiefs") so new members get it automatically. The built-in profiles are kept up to date by {PN}: when an update adds a section, it joins the profiles it belongs in, and your changes to a built-in profile are kept.</div>
      <div><button style={btn("primary")} onClick={() => setEditing({ key: null, name: "", description: "", levels: {}, builtin: false })}>New profile</button></div>
      {data.profiles.map(p => (
        <div key={p.key} style={cardStyle} role="region" aria-label={`Profile ${p.name}`}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>{p.name} {p.builtin && <span style={{ fontSize: 11, color: INK_SOFT, fontWeight: 700 }}>BUILT-IN{p.changed ? " · CHANGED HERE" : ""}</span>}</div>
            <button style={btn("outline")} onClick={() => setEditing(p)}>Edit</button>
            {p.builtin && p.changed && <button style={btn("ghost")} onClick={() => act(p, "reset", {}, "Profile reset", `Put ${p.name} back to how ${PN} ships it?`)}>Reset to default</button>}
            {!p.builtin && <button style={{ ...btn("ghost"), color: BRICK }} onClick={() => act(p, "remove", {}, "Profile deleted", `Delete ${p.name}? Everyone given it loses its access.`)}>Delete</button>}
          </div>
          <div style={{ fontSize: 13, color: INK_SOFT, margin: "2px 0 8px" }}>{p.description}{p.all ? " New sections are included automatically." : ""}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {Object.keys(p.levels).length === 0 && <span style={{ fontSize: 13, color: INK_SOFT }}>Nothing beyond what everyone gets.</span>}
            {Object.entries(p.levels).map(([k, l]) => <span key={k} style={{ fontSize: 12.5, border: `1px solid ${LINE}`, borderRadius: 999, padding: "2px 8px" }}>{sectionLabel(k)} <Pill level={l} /></span>)}
          </div>
          <div style={{ fontSize: 13, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <b>Given to:</b>
            {p.assigned.length === 0 && <span style={{ color: INK_SOFT }}>nobody yet</span>}
            {p.assigned.map(m => <span key={m.id} style={{ background: PAPER, borderRadius: 999, padding: "2px 10px" }}>{nameOf(m)}
              <button aria-label={`Take ${p.name} from ${nameOf(m)}`} onClick={() => act(p, "unassign", { id: m.id }, "Removed", `Take ${p.name} away from ${nameOf(m)}?`)} style={{ border: "none", background: "none", color: BRICK, cursor: "pointer", fontWeight: 800 }}>×</button></span>)}
            <select aria-label={`Give ${p.name} to`} style={{ ...inputStyle, width: "auto", padding: "5px 8px", fontSize: 13 }} value={adding[p.key] || ""} onChange={e => setAdding(a => ({ ...a, [p.key]: e.target.value }))}>
              <option value="">Give to a person or group…</option>
              <optgroup label="Groups">{data.groups.map(g => <option key={g.id} value={`g:${g.id}`}>{g.name} ({g.members.length})</option>)}</optgroup>
              <optgroup label="People">{data.people.filter(x => x.role !== "master").map(x => <option key={x.id} value={`u:${x.id}`}>{x.name} — {x.division}</option>)}</optgroup>
            </select>
            {adding[p.key] && <button style={btn("primary")} onClick={() => assign(p)}>Give</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
function ProfileEditor({ data, profile, onClose, onSaved, toast }) {
  const [name, setName] = useState(profile.name), [description, setDescription] = useState(profile.description || ""), [levels, setLevels] = useState({ ...profile.levels });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await call("/profiles", { key: profile.key, name, description, levels }); toast("Profile saved"); onSaved(); } catch (e) { toast(e.message); }
    setBusy(false);
  }
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{profile.key ? `Edit ${profile.name}` : "New profile"}</div>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: INK_SOFT }}>Name<input aria-label="Profile name" style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></label>
        <label style={{ fontSize: 12.5, fontWeight: 700, color: INK_SOFT }}>Description<input aria-label="Profile description" style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} /></label>
      </div>
      {profile.builtin && <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "8px 0" }}>Only your changes from the built-in version are saved, so sections added by later updates still arrive. "Reset to default" undoes your changes.</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 10 }}>
        <tbody>{data.sections.map(s => (
          <tr key={s.key}>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}`, fontWeight: 700, width: 220 }}>{s.label}{profile.builtin && profile.base?.[s.key] && profile.base[s.key] !== levels[s.key] && <div style={{ fontSize: 11, color: AMBER }}>ships as {LEVEL_LABEL[profile.base[s.key]]}</div>}</td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}` }}>
              <select aria-label={`${s.label} level`} style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 13 }} value={levels[s.key] || ""}
                onChange={e => setLevels(l => { const n = { ...l }; if (e.target.value) n[s.key] = e.target.value; else delete n[s.key]; return n; })}>
                <option value="">{s.everyone ? "Basic (what everyone gets)" : "None"}</option>
                {Object.keys(s.levels).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
              </select>
            </td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${LINE}`, color: INK_SOFT, fontSize: 12.5 }}>{levels[s.key] ? s.levels[levels[s.key]] : s.everyone || "Hidden"}</td>
          </tr>))}</tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn("primary")} disabled={busy} onClick={save}>Save profile</button>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ---- By section ---------------------------------------------------------------------------------
function BySection({ data, reload, toast }) {
  const who = g => (g.groupId ? data.groups.find(x => x.id === g.groupId) : data.people.find(p => p.id === g.userId));
  const sections = data.sections.filter(s => data.isMaster || data.canGrant[s.key]);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {sections.map(s => {
        const list = data.grants.filter(g => g.section === s.key).sort((a, b) => (b.level === "manage") - (a.level === "manage"));
        return (
          <div key={s.key} style={cardStyle} aria-label={`${s.label} access`} role="region">
            <div style={{ fontSize: 16, fontWeight: 800 }}>{s.label}</div>
            <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>
              {Object.entries(s.levels).map(([l, d]) => <div key={l}><b>{LEVEL_LABEL[l]}:</b> {d}</div>)}
            </div>
            {list.length === 0 && <div style={{ fontSize: 13, color: INK_SOFT }}>Only master admins.</div>}
            {list.map(g => {
              const w = who(g);
              return (
                <div key={g.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap", fontSize: 13.5 }}>
                  <Pill level={g.level} />
                  <b>{g.groupId ? `Group: ${w?.name || "?"}` : w?.name || "(removed person)"}</b>
                  {g.groupId && w && <span style={{ color: INK_SOFT }}>({w.members.length} {w.members.length === 1 ? "person" : "people"})</span>}
                  <span>{s.divisions ? scopeText(g) : ""}</span>
                  <span style={{ color: INK_SOFT, flex: 1, fontSize: 12 }}>{g.grantedBy ? `by ${g.grantedBy}` : ""}{g.grantedAt ? ` · ${new Date(g.grantedAt).toLocaleDateString()}` : ""}</span>
                  {canRemove(data, g) && <button style={{ ...btn("ghost"), color: BRICK, padding: "3px 8px" }} onClick={() => removeGrant(g, g.groupId ? `group ${w?.name}` : w?.name, reload, toast)}>Remove</button>}
                </div>
              );
            })}
            {data.canGrant[s.key] && <GrantForm data={data} fixedSection={s.key} onDone={reload} toast={toast} />}
          </div>
        );
      })}
    </div>
  );
}

// ---- Groups ---------------------------------------------------------------------------------
const emptyGroup = () => ({ id: null, name: "", description: "", rules: { divisions: [], patterns: [], roles: [], titles: [], stations: [] }, includes: [], excludes: [] });

function Groups({ data, reload, toast }) {
  const [editing, setEditing] = useState(null);
  if (!data.isMaster && !data.canGroups) {
    return <div style={cardStyle}>{data.groups.length ? data.groups.map(g => <div key={g.id} style={{ padding: "4px 0" }}><b>{g.name}</b> ({g.members.length})</div>) : "No groups yet."}<div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8 }}>Only master admins and accounts admins can create or change groups.</div></div>;
  }
  if (editing) return <GroupEditor data={data} group={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} toast={toast} />;
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: INK_SOFT }}>Groups fill themselves from rules (division, shift or crew, role, job title), plus anyone you add or leave out by hand. Give a group access once and everyone in it gets it. Messages will use them too.</div>
        <button style={btn("primary")} onClick={() => setEditing(emptyGroup())}>+ New group</button>
      </div>
      {data.groups.length === 0 && <div style={{ fontSize: 13, color: INK_SOFT }}>No groups yet. Start with something like "A-Shift" (Fire A shift) or "Division Heads".</div>}
      {data.groups.map(g => {
        const grants = data.grants.filter(x => x.groupId === g.id);
        return (
          <div key={g.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <b style={{ fontSize: 14.5 }}>{g.name}</b> <span style={{ color: INK_SOFT, fontSize: 13 }}>· {g.members.length} {g.members.length === 1 ? "person" : "people"}</span>
              {g.isDefault && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: INK_SOFT, border: `1px solid ${LINE}`, borderRadius: 999, padding: "0 7px" }}>default</span>}
              {g.description && <div style={{ fontSize: 12.5, color: INK_SOFT }}>{g.description}</div>}
              {grants.length > 0 && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 2 }}>Access: {grants.map(x => `${data.sections.find(s => s.key === x.section)?.label} ${x.level}`).join(", ")}</div>}
            </div>
            <button style={btn("outline")} onClick={() => setEditing(g)}>Edit</button>
          </div>
        );
      })}
    </div>
  );
}

function GroupEditor({ data, group, onClose, onSaved, toast }) {
  const [g, setG] = useState(() => JSON.parse(JSON.stringify(group)));
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState("");
  const [titleText, setTitleText] = useState((group.rules.titles || []).join(", "));
  const r = { divisions: [], patterns: [], roles: [], titles: [], stations: [], ...g.rules };
  const setRule = (k, v) => setG(x => ({ ...x, rules: { ...r, [k]: v } }));
  const toggle = (k, v, on) => setRule(k, on ? [...new Set([...(r[k] || []), v])] : (r[k] || []).filter(x => x !== v));
  const rules = { ...r, titles: titleText.split(",").map(t => t.trim()).filter(Boolean) };
  const auto = useMemo(() => data.people.filter(p => matchesRules(rules, p)).map(p => p.id), [JSON.stringify(rules)]);
  const members = data.people.filter(p => !g.excludes.includes(p.id) && (g.includes.includes(p.id) || auto.includes(p.id)));
  const nameOf = id => data.people.find(p => p.id === id)?.name || "?";

  async function save() {
    if (!g.name.trim()) { toast("Give the group a name"); return; }
    setBusy(true);
    try { await call("/groups", { ...g, rules }); toast("Group saved"); onSaved(); } catch (e) { toast(e.message); }
    setBusy(false);
  }
  async function remove() {
    if (!window.confirm(`Delete the group "${group.name}"? Access given to the group goes away with it.`)) return;
    try { await call(`/groups/${group.id}/remove`, {}); toast("Group deleted"); onSaved(); } catch (e) { toast(e.message); }
  }
  const box = { border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 12px", background: "#fff" };
  const check = (k, v, label) => (
    <label key={v} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 13 }}>
      <input type="checkbox" checked={(r[k] || []).includes(v)} onChange={e => toggle(k, v, e.target.checked)} /> {label}
    </label>
  );
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{group.id ? `Edit group: ${group.name}` : "New group"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12.5, color: INK_SOFT }}>Name<input aria-label="Group name" style={inputStyle} value={g.name} onChange={e => setG(x => ({ ...x, name: e.target.value }))} placeholder="e.g. A-Shift" /></label>
        <label style={{ fontSize: 12.5, color: INK_SOFT }}>Description (optional)<input aria-label="Group description" style={inputStyle} value={g.description} onChange={e => setG(x => ({ ...x, description: e.target.value }))} /></label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Automatic members <span style={{ fontWeight: 400, color: INK_SOFT }}>(everyone who fits all the kinds you set)</span></div>
          <div style={box}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, marginBottom: 4 }}>DIVISION</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{data.divisions.map(d => check("divisions", d, d))}</div></div>
          {data.stations?.length > 0 && <div style={box}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, marginBottom: 4 }}>HOME STATION <span style={{ fontWeight: 400 }}>(the station on each person's directory card)</span></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{data.stations.map(st => check("stations", st.key, st.name))}</div></div>}
          <div style={box}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, marginBottom: 4 }}>SHIFT / CREW <span style={{ fontWeight: 400 }}>(each person's schedule setting in Time Tracker)</span></div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{PATTERNS.map(([k, l]) => check("patterns", k, l))}</div></div>
          <div style={box}><div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, marginBottom: 4 }}>ROLE</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{Object.entries(ROLE_LABEL).map(([k, l]) => check("roles", k, l))}</div></div>
          <label style={{ ...box, display: "block", fontSize: 12, fontWeight: 800, color: INK_SOFT }}>JOB TITLE CONTAINS <span style={{ fontWeight: 400 }}>(comma-separated, e.g. Captain, Chief)</span>
            <input aria-label="Job title contains" style={{ ...inputStyle, marginTop: 4 }} value={titleText} onChange={e => setTitleText(e.target.value)} /></label>
          <div style={box}>
            <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, marginBottom: 4 }}>ADD SOMEONE BY HAND</div>
            <div style={{ display: "flex", gap: 8 }}>
              <select aria-label="Add a person" style={{ ...inputStyle, flex: 1 }} value={addId} onChange={e => setAddId(e.target.value)}>
                <option value="">Choose a person…</option>
                {data.people.filter(p => !members.some(m => m.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name} — {p.division}</option>)}
              </select>
              <button style={btn("outline")} onClick={() => { if (addId) { setG(x => ({ ...x, includes: [...new Set([...x.includes, addId])], excludes: x.excludes.filter(e => e !== addId) })); setAddId(""); } }}>Add</button>
            </div>
            {g.excludes.length > 0 && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6 }}>Left out by hand: {g.excludes.map(id => (
              <button key={id} type="button" title="Put back" onClick={() => setG(x => ({ ...x, excludes: x.excludes.filter(e => e !== id) }))} style={{ ...btn("ghost"), padding: "0 6px", fontSize: 12.5 }}>{nameOf(id)} ↺</button>
            ))}</div>}
          </div>
        </div>
        <div style={box} role="region" aria-label="Group members">
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Members right now: {members.length}</div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {members.length === 0 && <div style={{ fontSize: 13, color: INK_SOFT }}>Nobody yet. Set a rule or add someone.</div>}
            {members.map(p => (
              <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
                <span style={{ flex: 1 }}><b>{p.name}</b> <span style={{ color: INK_SOFT }}>{p.division}{p.station ? ` · Sta ${stationKey(p.station)}` : ""}</span></span>
                <span style={{ fontSize: 11, color: g.includes.includes(p.id) ? AMBER : SAGE, fontWeight: 700 }}>{g.includes.includes(p.id) ? "by hand" : "rule"}</span>
                <button type="button" title="Leave this person out" aria-label={`Leave out ${p.name}`}
                  onClick={() => setG(x => ({ ...x, includes: x.includes.filter(i => i !== p.id), excludes: auto.includes(p.id) ? [...new Set([...x.excludes, p.id])] : x.excludes }))}
                  style={{ ...btn("ghost"), padding: "0 6px", color: BRICK }}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 6 }}>Rule-based members update by themselves when someone's division, shift or title changes.</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button style={btn("primary")} disabled={busy} onClick={save}>Save group</button>
        <button style={btn("ghost")} onClick={onClose}>Cancel</button>
        {group.id && <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={remove}>Delete group</button>}
      </div>
    </div>
  );
}
