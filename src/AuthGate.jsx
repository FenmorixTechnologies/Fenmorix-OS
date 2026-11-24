// Sign-in, account requests, first-run setup and password changes.
// Shows the app only once someone is signed in with an approved account.
import NexusBrand from "./Brand.jsx";
import React, { useEffect, useState } from "react";
import { installStorage, signOut } from "./storage.js";
import App from "./App.jsx";
import MessageCenter from "./MessageCenter.jsx";
import { SessionContext } from "./session.js";

import SignInRoot, { Shell, Field, ErrorText, useForm, post, input, primary, linkBtn, PasswordRules, passwordOk } from "./SignIn.jsx";

const INK_SOFT = "#4B5565", PAPER = "#F3F5F8";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function ChangePassword({ forced, reason, onDone, onCancel }) {
  const [form, bind] = useForm({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) { setError("The two new passwords don't match."); return; }
    if (!passwordOk(form.newPassword)) { setError("The new password doesn't meet the rules yet."); return; }
    setBusy(true); setError("");
    try { await post("/api/auth/change-password", form); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Shell subtitle={forced ? (reason === "expired" ? "Time for a new password" : "Choose your own password") : "Change password"}>
      {forced && (
        <div role="status" style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 16, lineHeight: 1.5 }}>
          {reason === "expired" ? "Your password is 90 days old. Choose a new one to keep going." : "You signed in with a temporary password. Pick a new one only you know."}
        </div>
      )}
      <form onSubmit={submit}>
        <Field label={forced && reason !== "expired" ? "Temporary password" : "Current password"}>
          <input style={input} type="password" autoComplete="current-password" autoFocus {...bind("currentPassword")} />
        </Field>
        <Field label="New password">
          <input style={input} type="password" autoComplete="new-password" {...bind("newPassword")} />
        </Field>
        <PasswordRules value={form.newPassword} />
        <Field label="Confirm new password"><input style={input} type="password" autoComplete="new-password" {...bind("confirm")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        {forced
          ? <button style={linkBtn} onClick={signOut}>Sign out</button>
          : <button style={linkBtn} onClick={onCancel}>Cancel</button>}
      </div>
    </Shell>
  );
}

export default function AuthGate() {
  const [state, setState] = useState({ loading: true });
  const [changing, setChanging] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/auth/me", { headers: { "X-SGFD": "1" } });
      const data = await res.json();
      if (data.user) installStorage(data.user.id);
      setState({ loading: false, ...data });
    } catch {
      setState({ loading: false, offline: true });
    }
  }
  useEffect(() => { load(); }, []);

  if (state.loading) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT, fontFamily: FONT }}>Loading…</div>;
  if (state.offline) {
    return (
      <Shell subtitle="Can't reach the server">
        <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>The app server isn't responding. Make sure it's running, then try again.</div>
        <button style={primary} onClick={() => location.reload()}>Try again</button>
      </Shell>
    );
  }

  const user = state.user;
  if (!user) return <SignInRoot initial={state} />;

  if (user.mustChangePassword) return <ChangePassword forced reason={user.mustChangeReason} onDone={() => location.reload()} />;
  if (changing) return <ChangePassword onDone={() => { setChanging(false); alert("Password changed."); }} onCancel={() => setChanging(false)} />;

  // Name, password change and sign out live in each screen's side bar (AppShell)
  return (
    <SessionContext.Provider value={{ user, pendingCount: state.pendingCount || 0, changePassword: () => setChanging(true), signOut }}>
      <div style={{ background: PAPER, minHeight: "100vh", boxSizing: "border-box" }}><App /></div>
      <MessageCenter live={state.live !== false} />
    </SessionContext.Provider>
  );
}
