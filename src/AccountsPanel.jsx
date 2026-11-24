// Admin → Accounts: approve or decline account requests, and give people
// temporary passwords (for a forgotten password, or someone added by hand).
import React, { useEffect, useState } from "react";
import { useListView, ListControls, Pager } from "./ListControls.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", PAPER = "#F3F5F8", PAPER_RAISED = "#FFFFFF";
const LINE = "#DDE2EA", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00";

const card = { background: PAPER_RAISED, border: `1px solid ${LINE}`, borderRadius: 8, padding: "20px 22px", marginBottom: 18 };
const small = { padding: "6px 9px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff", fontSize: 13, color: INK, fontFamily: "inherit" };
const btn = kind => ({
  padding: "6px 12px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  border: `1px solid ${kind === "primary" ? INK : LINE}`,
  background: kind === "primary" ? INK : "transparent", color: kind === "primary" ? "#FFFFFF" : INK,
});

async function call(path, body) {
  const res = await fetch(`/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "X-SGFD": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}

// Pick the extra divisions an approver signs for (beyond their own)
export function SignDivisionsPicker({ divisions, home, value, onChange, label }) {
  const opts = divisions.filter(d => d !== home);
  if (!opts.length) return null;
  const toggle = d => onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d]);
  return (
    <fieldset style={{ border: "none", padding: 0, margin: "8px 0 0" }}>
      <legend style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, marginBottom: 4 }}>
        {label || "Also signs for"} <span style={{ fontWeight: 400 }}>(besides {home}; optional)</span>
      </legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {opts.map(d => {
          const on = value.includes(d);
          return (
            <label key={d} style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, cursor: "pointer",
              padding: "4px 9px", borderRadius: 14, border: `1px solid ${on ? INK : LINE}`,
              background: on ? "#E6ECF5" : "#fff", color: INK, fontWeight: on ? 600 : 400,
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(d)} style={{ margin: 0 }} />
              {d}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const when = d => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

function PendingRow({ a, divisions, roleLabels, onDone, canMakeMaster = true }) {
  const [division, setDivision] = useState(a.division);
  const [role, setRole] = useState("user");
  const [also, setAlso] = useState([]);
  const signs = role === "approver1" || role === "approver2";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(kind) {
    setBusy(true); setError("");
    try {
      if (kind === "approve") await call("approve", { id: a.id, role, division, signDivisions: signs ? also.filter(d => d !== division) : [] });
      else await call("reject", { id: a.id });
      onDone(kind === "approve" ? `${a.name} approved as ${roleLabels[role]}.` : `${a.name}'s request was declined.`);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <div style={{ padding: "10px 0", borderBottom: `1px solid ${LINE}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.name}</div>
          <div style={{ fontSize: 12, color: INK_SOFT }}>
            {a.email} · requested {when(a.signedUpAt)}
            {a.claimedExisting && <span style={{ color: AMBER, fontWeight: 600 }}> · matches someone already on the roster</span>}
            {a.organization && <div style={{ color: INK, fontWeight: 600 }}>From: {a.organization}</div>}
          </div>
        </div>
        <select aria-label={`Division for ${a.name}`} style={small} value={division} onChange={e => setDivision(e.target.value)}>
          {divisions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select aria-label={`Role for ${a.name}`} style={small} value={role} onChange={e => setRole(e.target.value)}>
          {Object.entries(roleLabels).filter(([k]) => canMakeMaster || k !== "master").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button style={btn("primary")} disabled={busy} onClick={() => act("approve")}>Approve</button>
        <button style={btn()} disabled={busy} onClick={() => act("reject")}>Decline</button>
      </div>
      {signs && (
        <SignDivisionsPicker divisions={divisions} home={division} value={also} onChange={setAlso} />
      )}
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function PersonRow({ a, onIssued }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(a.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function resetMfa(unlockOnly) {
    if (!window.confirm(unlockOnly ? `Release ${a.name}'s locked authenticator?` : `Reset ${a.name}'s two-step sign-in? They'll set up their authenticator app again the next time they sign in.`)) return;
    setBusy(true); setError("");
    try { await call("mfa-reset", { userId: a.id, unlockOnly }); onIssued({ name: a.name, mfaReset: unlockOnly ? "released" : "reset" }); }
    catch (err) { setError(err.message); }
    setBusy(false);
  }
  async function issue() {
    setBusy(true); setError("");
    try {
      const r = await call("reset-password", { id: a.id, email });
      onIssued({ name: a.name, email: r.email, password: r.tempPassword });
      setOpen(false);
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <b>{a.name}</b> <span style={{ color: INK_SOFT }}>— {a.email || "no email"}</span>
          <div style={{ fontSize: 12, color: a.hasPassword ? INK_SOFT : AMBER }}>
            {a.hasPassword ? `Last signed in ${when(a.lastLoginAt)}` : "Hasn't set up sign-in yet"}
            {a.mfa && <span style={{ color: a.mfaLocked ? BRICK : INK_SOFT }}> · {a.mfaLocked ? "authenticator locked" : "two-step sign-in on"}</span>}
          </div>
        </div>
        {!open && <button style={btn()} onClick={() => setOpen(true)}>{a.hasPassword ? "Reset password" : "Set up sign-in"}</button>}
        {!open && a.mfaLocked && <button style={btn()} disabled={busy} onClick={() => resetMfa(true)}>Release authenticator</button>}
        {!open && a.mfa && <button style={btn()} disabled={busy} onClick={() => resetMfa(false)}>Reset two-step sign-in</button>}
      </div>
      {open && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <input aria-label={`Email for ${a.name}`} style={{ ...small, flex: "1 1 220px" }} type="email" placeholder="Their work email"
            value={email} onChange={e => setEmail(e.target.value)} />
          <button style={btn("primary")} disabled={busy} onClick={issue}>Create temporary password</button>
          <button style={btn()} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

export default function AccountsPanel({ divisions, roleLabels, canMakeMaster = true }) {
  const [accounts, setAccounts] = useState(null);
  const [notice, setNotice] = useState("");
  const [issued, setIssued] = useState(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  async function load() {
    try { setAccounts((await call("accounts")).accounts); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  const people = (accounts || []).filter(a => a.status === "approved");
  const peopleView = useListView(people, {
    search: a => [a.name, a.email, a.division, roleLabels[a.role]],
    sorts: [
      { key: "name", label: "Name", get: a => a.name, dir: "asc" },
      { key: "last", label: "Last sign-in", get: a => a.lastLoginAt, dir: "desc" },
      { key: "division", label: "Division", get: a => a.division, dir: "asc" },
    ],
    filters: [
      { key: "signin", label: "Sign-in", allLabel: "With or without sign-in", get: a => (a.hasPassword ? "yes" : "no"),
        options: [{ value: "yes", label: "Has a sign-in" }, { value: "no", label: "No sign-in yet" }] },
      { key: "division", label: "Division", get: a => a.division },
    ],
  });

  if (error) return <div style={{ ...card, color: BRICK }}>{error}</div>;
  if (!accounts) return <div style={card}>Loading accounts…</div>;

  const pending = accounts.filter(a => a.status === "pending");

  return (
    <div style={card}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Accounts</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
        People request an account from the sign-in screen. Approve them here and choose their role.
      </div>

      {notice && (
        <div style={{ background: "#E3F2E8", border: `1px solid ${SAGE}`, color: SAGE, borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ flex: 1 }}>{notice} They'll appear in the roster below after a refresh.</span>
          <button style={btn()} onClick={() => location.reload()}>Refresh</button>
        </div>
      )}

      {issued?.mfaReset && (
        <div role="status" style={{ background: "#E8F3EC", border: `1px solid ${LINE}`, borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
          {issued.mfaReset === "released" ? <>The authenticator lock for <b>{issued.name}</b> is released.</> : <>Two-step sign-in for <b>{issued.name}</b> is reset. They'll scan a new code the next time they sign in.</>}
          {" "}<button style={btn()} onClick={() => setIssued(null)}>Done</button>
        </div>
      )}
      {issued && !issued.mfaReset && (
        <div style={{ background: "#FDF0DA", border: `1px solid ${AMBER}`, borderRadius: 6, padding: "10px 12px", fontSize: 13, marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>
            Temporary password for <b>{issued.name}</b> ({issued.email}). Give it to them in person or by phone;
            it won't be shown again. They'll pick their own password when they sign in.
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <code style={{ fontSize: 16, fontWeight: 700, background: "#fff", padding: "4px 10px", borderRadius: 5, border: `1px solid ${LINE}` }}>{issued.password}</code>
            <button style={btn()} onClick={() => navigator.clipboard?.writeText(issued.password)}>Copy</button>
            <button style={btn()} onClick={() => setIssued(null)}>Done</button>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, margin: "6px 0 4px" }}>
        Waiting for approval ({pending.length})
      </div>
      {pending.length === 0 && <div style={{ fontSize: 13, color: "#6B7385", padding: "6px 0 10px" }}>No requests right now.</div>}
      {pending.map(a => (
        <PendingRow key={a.id} a={a} divisions={divisions} roleLabels={roleLabels} canMakeMaster={canMakeMaster}
          onDone={msg => { setNotice(msg); load(); }} />
      ))}

      <div style={{ marginTop: 14 }}>
        <button style={{ background: "none", border: "none", padding: 0, color: INK_SOFT, fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}
          onClick={() => setShowAll(v => !v)}>
          {showAll ? "Hide sign-in details" : `Sign-in details and password resets (${people.length} people)`}
        </button>
      </div>
      {showAll && (
        <div style={{ marginTop: 6 }}>
          <ListControls view={peopleView} placeholder="Search name, email, division…" label="people" />
          {peopleView.pageItems.map(a => <PersonRow key={a.id} a={a} onIssued={i => { setIssued(i); load(); }} />)}
          <Pager view={peopleView} />
        </div>
      )}
    </div>
  );
}
