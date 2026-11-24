// User Management (master admins): account approvals and password resets,
// and each person's division, role, signing divisions and permissions.
import AppShell from "./AppShell.jsx";
import { useSession } from "./session.js";
import { KeyRound, Users, ShieldCheck, Layers, User, BadgeCheck, MonitorSmartphone, Server } from "lucide-react";
import PermissionsPanel from "./Permissions.jsx";
import DisplayScreensPanel from "./DisplayAdmin.jsx";
import SystemPanel from "./SystemAdmin.jsx";
import React, { useEffect, useState } from "react";
import {
  wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton,
  loadShared, saveStrict, uid, ROLE_LABEL, INK, INK_SOFT, LINE, PAPER, BRICK, SAGE,
} from "./App.jsx";
import AccountsPanel, { SignDivisionsPicker } from "./AccountsPanel.jsx";
import { useListView, ListControls, Pager } from "./ListControls.jsx";
import { formsApi } from "./Forms.jsx";
import { PN } from "./brand.js";

const PERMISSIONS = [
  ["timeView", "View time punches", "See (not change) other people's Time Tracker hours — for supervisors."],
  ["calloutEdit", "Edit call-out schedule", "Keep the call-out schedule for divisions besides their own."],
];
const describe = list => !list?.length ? "—" : list.includes("*") ? "All divisions" : list.join(", ");

// None / all divisions / chosen divisions
function ScopePicker({ label, hint, value, divisions, onChange, group }) {
  const [mode, setMode] = useState(() => !value.length ? "none" : value.includes("*") ? "all" : "some");
  const name = `${group}-${label.replace(/\W+/g, "-").toLowerCase()}`;
  function choose(k) {
    setMode(k);
    onChange(k === "none" ? [] : k === "all" ? ["*"] : value.filter(v => v !== "*"));
  }
  return (
    <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 12px", margin: "10px 0 0", background: "#fff" }}>
      <legend style={{ fontSize: 12.5, fontWeight: 700, color: INK, padding: "0 4px" }}>{label}</legend>
      <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 6 }}>{hint}</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
        {[["none", "No"], ["all", "All divisions"], ["some", "Only these divisions"]].map(([k, l]) => (
          <label key={k} style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
            <input type="radio" name={name} checked={mode === k} onChange={() => choose(k)} />
            {l}
          </label>
        ))}
      </div>
      {mode === "some" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {divisions.map(d => {
            const on = value.includes(d);
            return (
              <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer", padding: "4px 9px", borderRadius: 14, border: `1px solid ${on ? INK : LINE}`, background: on ? "#E6ECF5" : "#fff", fontWeight: on ? 600 : 400 }}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(x => x !== d) : [...value, d])} style={{ margin: 0 }} />
                {d}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

// Which forms someone can see every submission of
function FormAccessPicker({ forms, value, onChange, name }) {
  const all = value.includes("*");
  return (
    <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 12px", margin: "10px 0 0", background: "#fff" }}>
      <legend style={{ fontSize: 12.5, fontWeight: 700, color: INK, padding: "0 4px" }}>Forms: can see every submission of</legend>
      <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 6 }}>For chiefs, safety officers and others who handle these forms. Includes sensitive details. A form that opens a case (like an injury report) gives access to the whole case.</div>
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, marginBottom: 6 }}>
        <input type="checkbox" aria-label={`All forms for ${name}`} checked={all} onChange={e => onChange(e.target.checked ? ["*"] : [])} /> All forms
      </label>
      {!all && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {forms.map(fm => {
            const on = value.includes(fm.key);
            return (
              <label key={fm.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer", padding: "4px 9px", borderRadius: 14, border: `1px solid ${on ? INK : LINE}`, background: on ? "#E6ECF5" : "#fff", fontWeight: on ? 600 : 400 }}>
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(x => x !== fm.key) : [...value, fm.key])} style={{ margin: 0 }} />
                {fm.title}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

const ADMIN_DUTIES = [
  ["directoryAdmin", "Directory admin", "Edit anyone's directory card (including home phone and emergency contact), stations, facilities and outside contacts, and run directory verifications."],
  ["formsAdmin", "Forms admin", "Create and edit forms, their questions, recipients and progress steps. (Who can see all submissions stays with master admins.)"],
  ["accountsAdmin", "Accounts admin", "Approve or decline account requests and give people temporary passwords. Can't create or reset master admins."],
];

function UserRow({ user, divisions, isMe, onSave, onRemove, forms, formAccess, onSaveFormAccess }) {
  const [open, setOpen] = useState(false);
  const blank = () => ({
    division: user.division, role: user.role, signDivisions: user.signDivisions || [],
    timeView: user.permissions?.timeView || [], calloutEdit: user.permissions?.calloutEdit || [],
    recordings: (user.permissions?.recordings || []).length > 0,
    directoryAdmin: (user.permissions?.directoryAdmin || []).length > 0,
    formsAdmin: (user.permissions?.formsAdmin || []).length > 0,
    accountsAdmin: (user.permissions?.accountsAdmin || []).length > 0,
    formAccess: formAccess || [],
  });
  const [f, setF] = useState(blank);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const signs = f.role === "approver1" || f.role === "approver2";
  const perms = user.permissions || {};
  const extras = [
    (user.signDivisions || []).length ? `signs for ${user.signDivisions.join(", ")}` : null,
    perms.timeView?.length ? `views time: ${describe(perms.timeView)}` : null,
    perms.calloutEdit?.length ? `call-out: ${describe(perms.calloutEdit)}` : null,
    perms.recordings?.length ? "fire recordings" : null,
    perms.directoryAdmin?.length ? "directory admin" : null,
    perms.formsAdmin?.length ? "forms admin" : null,
    perms.accountsAdmin?.length ? "accounts admin" : null,
    (formAccess || []).length ? `forms: ${formAccess.includes("*") ? "all" : formAccess.map(k => forms.find(x => x.key === k)?.title || k).join(", ")}` : null,
  ].filter(Boolean);

  async function save() {
    const ok = await onSave({
      division: f.division, role: f.role,
      signDivisions: signs ? f.signDivisions.filter(d => d !== f.division) : [],
      permissions: {
        timeView: f.timeView, calloutEdit: f.calloutEdit, recordings: f.recordings ? ["*"] : [],
        directoryAdmin: f.directoryAdmin ? ["*"] : [], formsAdmin: f.formsAdmin ? ["*"] : [], accountsAdmin: f.accountsAdmin ? ["*"] : [],
      },
    });
    if (!ok) return;
    const before = [...(formAccess || [])].sort().join("|"), after = [...f.formAccess].sort().join("|");
    if (before !== after && !(await onSaveFormAccess(f.formAccess))) return;
    setOpen(false);
  }
  return (
    <div style={{ borderBottom: `1px solid ${LINE}`, padding: "9px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13.5 }}>
          <b>{user.name}</b>{isMe && <span style={{ color: INK_SOFT }}> (you)</span>}
          <span style={{ color: INK_SOFT }}> — {ROLE_LABEL[user.role]}, {user.division}</span>
          {extras.length > 0 && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 2 }}>{extras.join(" · ")}</div>}
        </div>
        {!open && <button aria-label={`Edit ${user.name}`} style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => { setF(blank()); setOpen(true); }}>Edit</button>}
      </div>
      {open && (
        <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 6, padding: "12px 14px", marginTop: 8 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 }}>Division
              <select aria-label={`Division of ${user.name}`} style={{ ...inputStyle, width: "auto" }} value={f.division} onChange={e => set("division", e.target.value)}>
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 }}>Role
              <select aria-label={`Role of ${user.name}`} style={{ ...inputStyle, width: "auto" }} value={f.role} disabled={isMe} onChange={e => set("role", e.target.value)}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          {isMe && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4 }}>You can't change your own role.</div>}
          {signs && <SignDivisionsPicker divisions={divisions} home={f.division} value={f.signDivisions} onChange={v => set("signDivisions", v)} />}
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" aria-label={`Fire recordings for ${user.name}`} checked={f.recordings} onChange={e => set("recordings", e.target.checked)} style={{ marginTop: 3 }} />
            <span><b>Working Fire Recordings</b><br /><span style={{ fontSize: 12, color: INK_SOFT }}>Listen to and import fire recordings. (Master admins always can.)</span></span>
          </label>
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4 }}>Admin duties (without full master access)</div>
          {ADMIN_DUTIES.map(([key, label, hint]) => (
            <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 6, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 12px", fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" aria-label={`${label} for ${user.name}`} checked={f[key]} disabled={user.role === "master"} onChange={e => set(key, e.target.checked)} style={{ marginTop: 3 }} />
              <span><b>{label}</b><br /><span style={{ fontSize: 12, color: INK_SOFT }}>{hint}</span></span>
            </label>
          ))}
          {PERMISSIONS.map(([key, label, hint]) => (
            <ScopePicker key={key} group={user.id} label={label} hint={hint} value={f[key]} divisions={divisions} onChange={v => set(key, v)} />
          ))}
          {forms.length > 0 && <FormAccessPicker forms={forms} value={f.formAccess} onChange={v => set("formAccess", v)} name={user.name} />}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={btn("primary")} onClick={save}>Save</button>
            <button style={btn("ghost")} onClick={() => setOpen(false)}>Cancel</button>
            {!isMe && <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={onRemove}>Remove from roster</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function UserManagementModule({ onBack }) {
  const [loaded, setLoaded] = useState(false);
  const [roster, setRoster] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [identityId, setIdentityId] = useState(null);
  const [form, setForm] = useState({ name: "", division: "", role: "user" });
  const [toast, setToast] = useState(null);
  const [page, setPage] = useState("accounts");
  const { pendingCount } = useSession();

  useEffect(() => {
    (async () => {
      const [r, d, ident] = await Promise.all([
        loadShared("roster", []), loadShared("divisions", []),
        (async () => { try { const x = await window.storage.get("current-identity", false); return x ? x.value : null; } catch (e) { return null; } })(),
      ]);
      setRoster(r); setDivisions(d); setIdentityId(ident); setForm(f => ({ ...f, division: d[0] || "" }));
      setLoaded(true);
    })();
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const me = roster.find(u => u.id === identityId) || null;

  const view = useListView(roster, {
    search: u => [u.name, u.division, ROLE_LABEL[u.role], u.email, (u.signDivisions || []).join(" ")],
    sorts: [
      { key: "name", label: "Name", get: u => u.name, dir: "asc" },
      { key: "division", label: "Division", get: u => u.division, dir: "asc" },
      { key: "role", label: "Role", get: u => ROLE_LABEL[u.role], dir: "asc" },
    ],
    filters: [
      { key: "division", label: "Division", get: u => u.division },
      { key: "role", label: "Role", get: u => u.role, options: Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })) },
      { key: "perm", label: "Permission", allLabel: "Any permissions", get: () => "",
        options: [{ value: "timeView", label: "Can view time punches" }, { value: "calloutEdit", label: "Can edit call-out schedules" }, { value: "recordings", label: "Fire recordings" }],
        match: (u, v) => (u.permissions?.[v] || []).length > 0 },
    ],
  });

  async function save(next, message) {
    if (!(await saveStrict("roster", next))) return false;
    setRoster(next); showToast(message);
    return true;
  }
  const [forms, setForms] = useState([]);
  const [formAccess, setFormAccess] = useState([]);
  useEffect(() => {
    formsApi("/definitions").then(r => setForms(r.definitions.filter(d => d.active).sort((a, b) => a.title.localeCompare(b.title))), () => {});
    formsApi("/access").then(r => setFormAccess(r.access), () => {});
  }, []);
  async function saveFormAccess(u, keys) {
    try {
      await formsApi("/access", { method: "POST", body: JSON.stringify({ userId: u.id, formKeys: keys }) });
      setFormAccess((await formsApi("/access")).access);
      return true;
    } catch (e) { showToast(e.message); return false; }
  }
  const editUser = (u, changes) => save(roster.map(x => x.id === u.id ? { ...x, ...changes } : x), `${u.name} updated`);
  async function removeUser(u) {
    if (!window.confirm(`Remove ${u.name} from the roster?\n\nThey're signed out and can't sign in. Their history stays.`)) return;
    await save(roster.filter(x => x.id !== u.id), `${u.name} removed`);
  }
  async function addUser() {
    if (!form.name.trim()) return;
    const ok = await save([...roster, { id: uid(), name: form.name.trim(), division: form.division, role: form.role }], `${form.name.trim()} added`);
    if (ok) setForm(f => ({ ...f, name: "" }));
  }

  if (!loaded) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Loading…</div>;
  const isMaster = me?.role === "master";
  const accountsOnly = !isMaster && (me?.permissions?.accountsAdmin || []).length > 0;
  const managesSomething = !isMaster && (me?.manages || []).length > 0;
  if (!isMaster && !accountsOnly && !managesSomething) {
    return (
      <div style={wrapStyle}><StyleBlock />
        <div style={{ maxWidth: 560, margin: "40px auto" }}>
          <MainMenuButton onClick={onBack} />
          <div style={cardStyle}>User Management is for master admins, accounts admins and section managers.</div>
        </div>
      </div>
    );
  }

  const canAccounts = isMaster || accountsOnly;
  const shellNav = [
    ...(canAccounts ? [{ key: "accounts", label: "Accounts & sign-in", icon: KeyRound, badge: pendingCount }] : []),
    ...(isMaster ? [{ key: "people", label: "People & roles", icon: Users }] : []),
    { key: "perm-person", label: "By person", icon: User, group: "Permissions" },
    { key: "perm-section", label: "By section", icon: ShieldCheck, group: "Permissions" },
    ...(isMaster ? [{ key: "profiles", label: "Profiles", icon: BadgeCheck, group: "Permissions" }] : []),
    { key: "groups", label: "Groups", icon: Layers, group: "Permissions" },
    ...(canAccounts ? [{ key: "displays", label: "Display screens", icon: MonitorSmartphone }] : []),
    ...(isMaster ? [{ key: "system", label: "System", icon: Server, group: "Server" }] : []),
  ];
  const activePage = (!canAccounts && (page === "accounts" || page === "displays")) || (!isMaster && page === "system") ? "perm-section" : page;
  const TITLES = {
    accounts: ["Accounts & sign-in", "Approve account requests and reset passwords."],
    people: ["People & roles", "Set each person's division, role, signing divisions, quick permissions and form access."],
    "perm-person": ["Permissions by person", "Every section: whether it shows in their side bar, their access level, what they can do there, and where it comes from."],
    profiles: ["Permission profiles", "Bundles of view access to give people or groups in one step. Built-in profiles pick up new sections when " + PN + " is updated."],
    "perm-section": ["Permissions by section", "Who can view, edit or manage each section. Managers of a section can give view and edit access in it."],
    displays: ["Display screens", "TVs that show the duty board, weather, on call and classes in turn, and switch to a live Command Board on their own."],
    system: ["System", "Install updates, restart the service, go back a version, back up and read the logs, without remote desktop."],
    groups: ["Groups", "Named sets of people that fill themselves from rules. Give access to a group once instead of person by person."],
  };
  return (
    <AppShell section="User Management" nav={shellNav} active={activePage} onNav={setPage} onHome={onBack}>
      <div>
        <div style={sectionTitle}>{TITLES[activePage][0]}</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2, marginBottom: 16 }}>{TITLES[activePage][1]}</div>

        {activePage === "accounts" && <AccountsPanel divisions={divisions} roleLabels={ROLE_LABEL} canMakeMaster={isMaster} />}
        {activePage === "perm-person" && <PermissionsPanel view="person" toast={showToast} />}
        {activePage === "perm-section" && <PermissionsPanel view="section" toast={showToast} />}
        {activePage === "groups" && <PermissionsPanel view="groups" toast={showToast} />}
        {activePage === "displays" && canAccounts && <DisplayScreensPanel toast={showToast} />}
        {activePage === "system" && isMaster && <SystemPanel toast={showToast} />}
        {activePage === "profiles" && <PermissionsPanel view="profiles" toast={showToast} />}

        {page === "people" && isMaster && <div style={cardStyle}>
          <ListControls view={view} placeholder="Search name, division, role…" label="people" />
          {view.pageItems.map(u => (
            <UserRow key={u.id} user={u} divisions={divisions} isMe={u.id === me.id}
              forms={forms} formAccess={formAccess.filter(x => x.userId === u.id).map(x => x.formKey)}
              onSaveFormAccess={keys => saveFormAccess(u, keys)}
              onSave={changes => editUser(u, changes)} onRemove={() => removeUser(u)} />
          ))}
          <Pager view={view} />

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: INK_SOFT, marginBottom: 6 }}>Add someone by hand</div>
            <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 8 }}>
              Usually people request an account themselves. Someone added here gets a sign-in from <i>Sign-in details and password resets</i> above.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input aria-label="New person's name" style={{ ...inputStyle, flex: 2, minWidth: 160 }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" />
              <select aria-label="New person's division" style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={form.division} onChange={e => setForm(f => ({ ...f, division: e.target.value }))}>
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select aria-label="New person's role" style={{ ...inputStyle, flex: 1, minWidth: 150 }} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button style={btn("primary")} onClick={addUser}>Add</button>
            </div>
          </div>
        </div>}
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </AppShell>
  );
}
