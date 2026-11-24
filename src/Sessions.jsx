// "Signed-in devices": your own sessions (master admins see everyone's) with sign-out buttons.
import React, { useEffect, useState } from "react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", SAGE = "#2E7D4F";
const post = (action, body) => fetch(`/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body || {}) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Request failed"); return j; });
const when = iso => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function device(ua) {
  const s = String(ua);
  const os = /iPhone|iPad/.test(s) ? "iPhone/iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "Unknown device";
  const br = /Edg\//.test(s) ? "Edge" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "browser";
  return `${br} on ${os}`;
}

export default function SessionsPanel({ isMaster, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const load = () => fetch("/api/auth/sessions", { headers: { "X-SGFD": "1" } }).then(r => r.json()).then(setData, e => setError(String(e)));
  useEffect(() => { load(); }, []);
  const act = async (fn, msg) => { setError(""); try { await fn(); load(); } catch (e) { setError(e.message); } };
  const btn = (primary) => ({ border: `1px solid ${primary ? INK : LINE}`, background: primary ? INK : "#fff", color: primary ? "#fff" : INK, borderRadius: 6, padding: "6px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" });
  return (
    <div role="dialog" aria-modal="true" aria-label="Signed-in devices" onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(10,18,34,0.45)", zIndex: 300, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "6vh 14px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 10, width: "min(720px, 100%)", padding: "18px 20px", color: INK, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 17, fontWeight: 800 }}>{isMaster ? "Signed-in devices (everyone)" : "Your signed-in devices"}</div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: INK_SOFT }}>×</button>
        </div>
        {data && <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "4px 0 12px" }}>
          People are signed out after {data.idleMinutes} minutes without using the app, and after {data.sessionHours} hours no matter what.
        </div>}
        {!data && !error && <div style={{ color: INK_SOFT }}>Loading…</div>}
        {data && data.sessions.map(s => (
          <div key={s.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", fontSize: 13 }}>
              {isMaster && <b>{s.name} · </b>}{device(s.device)}{s.ip ? ` · ${s.ip}` : ""}
              {s.current && <span style={{ color: SAGE, fontWeight: 700 }}> · this device</span>}
              <div style={{ fontSize: 12, color: INK_SOFT }}>Signed in {when(s.startedAt)} · last active {when(s.lastSeenAt)}</div>
            </div>
            {!s.current && <button style={btn(false)} onClick={() => act(() => post("end-session", { id: s.id }))}>Sign out</button>}
          </div>
        ))}
        <TwoStep btn={btn} />
        {error && <div role="alert" style={{ color: BRICK, fontWeight: 600, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button style={btn(true)} onClick={() => act(() => post("end-other-sessions", {}))}>Sign out my other devices</button>
          {isMaster && <button style={{ ...btn(false), color: BRICK, borderColor: BRICK }} onClick={() => window.confirm("Sign out everyone except you? They'll have to sign in again.") && act(() => post("end-other-sessions", { everyone: true }))}>Sign everyone else out</button>}
        </div>
      </div>
    </div>
  );
}

// Two-step sign-in: status, and new recovery codes (shown once)
function TwoStep({ btn }) {
  const [st, setSt] = useState(null), [codes, setCodes] = useState(null), [error, setError] = useState("");
  useEffect(() => { fetch("/api/auth/mfa-status", { headers: { "X-SGFD": "1" } }).then(r => r.ok ? r.json() : null).then(setSt, () => {}); }, []);
  if (!st || !st.enabled) return null;
  const renew = async () => {
    const code = window.prompt("Enter the 6-digit code from your authenticator app to make new recovery codes. Your old ones will stop working.");
    if (!code) return;
    setError("");
    try { setCodes((await post("mfa-recovery", { code: code.trim() })).recoveryCodes); setSt({ ...st, recoveryLeft: 10 }); } catch (e) { setError(e.message); }
  };
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 14, paddingTop: 12, fontSize: 13 }}>
      <b>Two-step sign-in is on</b> <span style={{ color: st.recoveryLeft <= 2 ? BRICK : INK_SOFT }}>· {st.recoveryLeft} recovery code{st.recoveryLeft === 1 ? "" : "s"} left</span>
      {st.requiredAtSignIn && <div style={{ fontSize: 12, color: INK_SOFT }}>Your account needs a code from your authenticator app at every sign-in.</div>}
      {codes ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>Save these new recovery codes somewhere safe. Each works once. They won't be shown again.</div>
          <div aria-label="Recovery codes" style={{ fontFamily: "monospace", fontSize: 15, display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "2px 22px", background: "#F3F5F8", borderRadius: 6, padding: "8px 12px" }}>
            {codes.map(c => <span key={c}>{c}</span>)}</div>
          <button style={{ ...btn(false), marginTop: 8 }} onClick={() => setCodes(null)}>I've saved them</button>
        </div>
      ) : <div style={{ marginTop: 8 }}><button style={btn(false)} onClick={renew}>Make new recovery codes</button></div>}
      {error && <div role="alert" style={{ color: BRICK, fontWeight: 600, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
