// Everything someone sees before they're signed in: sign in, the authenticator step (admins), forgot / reset password,
// request an account, first-run setup, and pairing a TV display screen. Built as its own small bundle (signin.html ->
// src/signedOut.jsx) so the server can keep the rest of the app's code from anyone who isn't signed in (server/index.js
// serveBuilt). Must not import App.jsx or anything that does.
import React, { useEffect, useState } from "react";
import { BRAND, THEME } from "./brand.js";
import SandboxBanner from "./SandboxBanner.jsx";
import NexusBrand from "./Brand.jsx";
import { PN } from "./brand.js";

export const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", SAGE = "#2E7D4F";
export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export const input = {
  width: "100%", padding: "10px 12px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff",
  fontSize: 15, color: INK, boxSizing: "border-box", fontFamily: FONT,
};
export const primary = {
  width: "100%", padding: "11px 16px", borderRadius: 6, border: `1px solid ${INK}`, background: INK,
  color: "#FFFFFF", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
};
export const linkBtn = {
  background: "none", border: "none", color: INK_SOFT, fontSize: 13.5, cursor: "pointer",
  textDecoration: "underline", padding: 0, fontFamily: FONT,
};

export async function post(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status})`), { status: res.status });
  return data;
}
const goHome = () => { window.location.href = "/"; };

// Sign-in screens: the color Nexus artwork fills the background, the form sits on a card
export function Shell({ subtitle, children }) {
  return (
    <div className="nexus-login" style={{ minHeight: "100vh", fontFamily: FONT, color: INK, boxSizing: "border-box", position: "relative", overflow: "hidden", background: THEME.loginBase }}>
      <style>{`
        .nexus-login .nx-bg { position: absolute; inset: 0; pointer-events: none;
          background: ${THEME.loginBg}; }
        .nexus-login .nx-net { position: absolute; inset: 0; pointer-events: none; opacity: .5;
          background-image: radial-gradient(rgba(255,255,255,0.16) 1.2px, transparent 1.6px), radial-gradient(${THEME.loginDots} 1px, transparent 1.4px);
          background-size: 46px 46px, 92px 92px; background-position: 0 0, 23px 23px;
          -webkit-mask-image: radial-gradient(70% 70% at 35% 45%, #000 20%, transparent 85%); mask-image: radial-gradient(70% 70% at 35% 45%, #000 20%, transparent 85%); }
        .nexus-login .nx-wrap { position: relative; min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
          align-items: center; gap: clamp(24px, 4vw, 72px); padding: 40px clamp(16px, 5vw, 80px); box-sizing: border-box; max-width: 1400px; margin: 0 auto; }
        .nexus-login .nx-brand { display: flex; flex-direction: column; align-items: center; }
        .nexus-login .nx-sub { color: ${THEME.loginSub}; font-size: clamp(14px, 1.4vw, 17px); font-weight: 600; margin-top: 12px; letter-spacing: .4px; text-align: center;
          text-shadow: 0 2px 8px rgba(0,0,0,0.6); animation: nx-fade .8s ease-out 1.2s both; }
        .nexus-login .nx-col { width: min(430px, 100%); justify-self: center; }
        .nexus-login .nx-card { animation: nx-card .8s cubic-bezier(.2,.8,.2,1) 1.1s both; }
        @keyframes nx-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes nx-card { from { opacity: 0; transform: translateX(26px); } to { opacity: 1; transform: none; } }
        @media (max-width: 860px) {
          .nexus-login .nx-wrap { grid-template-columns: 1fr; align-content: start; padding-top: 28px; gap: 22px; }
          .nexus-login .nx-brand .nx-hero > span:first-of-type { width: 190px !important; height: 190px !important; }
          @keyframes nx-card { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
        }
        @media (prefers-reduced-motion: reduce) { .nexus-login .nx-sub, .nexus-login .nx-card { animation: none !important; } }
      `}</style>
      <div className="nx-bg" aria-hidden="true" />
      <div className="nx-net" aria-hidden="true" />
      <SandboxBanner />
      <div className="nx-wrap">
        <div className="nx-brand">
          <NexusBrand size="splash" />
          <div className="nx-sub">{BRAND.org}</div>
        </div>
        <div className="nx-col">
          <div className="nx-card" style={{ background: "rgba(255,255,255,0.97)", borderRadius: 12, padding: "22px 26px 24px", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", borderTop: `4px solid ${THEME.cardTop}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <img src="/logo-large.png" alt={BRAND.org} style={{ width: 40, height: 40, borderRadius: "50%" }} />
              <div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{subtitle}</div>
                <div style={{ fontSize: 12.5, color: INK_SOFT }}>{BRAND.product === "nexus" ? `${BRAND.app} Management System` : `${BRAND.app} · ${BRAND.tagline.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}`}</div>
              </div>
            </div>
            {children}
          </div>
          {BRAND.copyright && <div style={{ textAlign: "center", fontSize: 11.5, color: "rgba(230,234,242,0.6)", marginTop: 14, letterSpacing: 0.3 }}>{BRAND.productName} · {BRAND.copyright}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: 13, color: INK_SOFT, marginBottom: 5, fontWeight: 500 }}>{label}</span>
        {children}
      </label>
      {hint && <div style={{ fontSize: 12, color: "#6B7385", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ErrorText({ children }) {
  return children ? <div role="alert" style={{ color: BRICK, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>{children}</div> : null;
}

export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const bind = k => ({ value: form[k], onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) });
  return [form, bind, setForm];
}

// The password rule, checked as they type (the server checks it again)
export const RULES = [["10 or more characters", p => p.length >= 10], ["A capital letter", p => /[A-Z]/.test(p)],
  ["A lowercase letter", p => /[a-z]/.test(p)], ["A symbol, like ! - # or a space", p => /[^A-Za-z0-9]/.test(p)]];
export const passwordOk = p => RULES.every(([, t]) => t(p || ""));
export function PasswordRules({ value }) {
  const p = value || "";
  return (
    <ul aria-label="Password rules" style={{ listStyle: "none", padding: 0, margin: "-6px 0 12px", fontSize: 12.5, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 10px" }}>
      {RULES.map(([label, test]) => { const ok = test(p); return (
        <li key={label} style={{ color: ok ? SAGE : "#6B7385" }}><span aria-hidden="true">{ok ? "✓" : "○"}</span> {label}{ok ? <span style={{ position: "absolute", left: -9999 }}> (done)</span> : null}</li>); })}
    </ul>
  );
}
const EXPIRY_NOTE = "Passwords are changed every 90 days.";

function SignIn({ me, onForgot, onRequest, onMfa }) {
  const [form, bind] = useForm({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try { const r = await post("/api/auth/login", form); if (r.mfa) onMfa(); else goHome(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Shell subtitle="Sign in to continue">
      <form onSubmit={submit}>
        <Field label="Email"><input style={input} type="email" autoComplete="username" autoFocus {...bind("email")} /></Field>
        <Field label="Password"><input style={input} type="password" autoComplete="current-password" {...bind("password")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <div style={{ marginTop: 10, textAlign: "center" }}>
        {me.resetByEmail ? <button style={linkBtn} onClick={onForgot}>Forgot your password?</button>
          : <div style={{ fontSize: 12.5, color: INK_SOFT }}>Forgot your password? Ask an accounts admin for a temporary one.</div>}
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${LINE}`, fontSize: 13.5, color: INK_SOFT, textAlign: "center" }}>
        New here? <button style={linkBtn} onClick={onRequest}>Request an account</button>
      </div>
    </Shell>
  );
}

function Forgot({ onBack }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [sent, setSent] = useState(null);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { setSent(await post("/api/auth/forgot", { email })); } catch (err) { setError(err.message); } setBusy(false);
  }
  if (sent) return (
    <Shell subtitle="Check your email">
      <div role="status" style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>
        If <b>{email}</b> has a {PN} account, a reset link is on its way. It works once, for {sent.minutes || 30} minutes.
        Nothing there after a few minutes? Check junk mail, or ask an accounts admin.
      </div>
      <button style={primary} onClick={onBack}>Back to sign in</button>
    </Shell>
  );
  return (
    <Shell subtitle="Reset your password">
      <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 14, lineHeight: 1.5 }}>Enter the email you sign in with. We'll email you a link to choose a new password.</div>
      <form onSubmit={submit}>
        <Field label="Email"><input style={input} type="email" autoComplete="username" autoFocus value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Sending…" : "Email me a reset link"}</button>
      </form>
      <div style={{ marginTop: 14, textAlign: "center" }}><button style={linkBtn} onClick={onBack}>Back to sign in</button></div>
    </Shell>
  );
}

function ResetPassword({ token }) {
  const [info, setInfo] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  const [form, bind] = useForm({ password: "", confirm: "", code: "" });
  useEffect(() => { post("/api/auth/reset-check", { token }).then(setInfo, e => setInfo({ dead: e.message })); }, [token]);
  async function submit(e) {
    e.preventDefault();
    if (BRAND.sandbox && form.organization.trim().length < 3) { setError("Enter the department or agency you're with."); return; }
    if (form.password !== form.confirm) { setError("The two passwords don't match."); return; }
    if (!passwordOk(form.password)) { setError("The new password doesn't meet the rules yet."); return; }
    setBusy(true); setError("");
    try { await post("/api/auth/reset", { token, password: form.password, code: form.code }); setDone(true); window.history.replaceState(null, "", "/"); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  if (!info) return <Shell subtitle="Reset your password"><div style={{ color: INK_SOFT }}>Checking the link…</div></Shell>;
  if (info.dead) return (
    <Shell subtitle="Link expired">
      <div role="alert" style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>{info.dead}</div>
      <button style={primary} onClick={goHome}>Back to sign in</button>
    </Shell>
  );
  if (done) return (
    <Shell subtitle="Password changed">
      <div role="status" style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}><b style={{ color: SAGE }}>Your new password is set.</b> Every device that was signed in has been signed out. Sign in with the new password.</div>
      <button style={primary} onClick={goHome}>Sign in</button>
    </Shell>
  );
  return (
    <Shell subtitle={`Choose a new password${info.name ? `, ${info.name}` : ""}`}>
      <form onSubmit={submit}>
        <Field label="New password"><input style={input} type="password" autoComplete="new-password" autoFocus {...bind("password")} /></Field>
        <PasswordRules value={form.password} />
        <Field label="Confirm new password"><input style={input} type="password" autoComplete="new-password" {...bind("confirm")} /></Field>
        {info.needCode && <Field label="Code from your authenticator app" hint="Or one of your recovery codes.">
          <input style={{ ...input, letterSpacing: 3 }} inputMode="numeric" autoComplete="one-time-code" {...bind("code")} /></Field>}
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
      <div style={{ marginTop: 10, fontSize: 12.5, color: INK_SOFT, textAlign: "center" }}>{EXPIRY_NOTE}</div>
    </Shell>
  );
}

export function QrCode({ rows }) {
  const n = rows.length, q = 4;
  return (
    <svg role="img" aria-label="QR code for your authenticator app" viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} width="200" height="200" style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, display: "block", margin: "0 auto" }} shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((c, x) => c === "1" ? <rect key={`${x}-${y}`} x={x + q} y={y + q} width="1" height="1" fill="#000" /> : null))}
    </svg>
  );
}
export function RecoveryCodes({ codes, onDone }) {
  return (
    <div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 10 }}>
        <b>Save these recovery codes</b> somewhere safe (print them, or keep them in a locked drawer). If you lose your phone, each one
        signs you in once instead of an authenticator code. They won't be shown again.
      </div>
      <div aria-label="Recovery codes" style={{ fontFamily: "monospace", fontSize: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 18px", background: "#F3F5F8", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
        {codes.map(c => <span key={c}>{c}</span>)}
      </div>
      <button style={{ ...primary, background: "#fff", color: INK, marginBottom: 8 }} onClick={() => window.print()}>Print them</button>
      <button style={primary} onClick={onDone}>I've saved them, continue</button>
    </div>
  );
}

// Admins: the second step after the password, or setting up the authenticator the first time
function MfaStep({ mfa }) {
  const [setup, setSetup] = useState(null), [code, setCode] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  useEffect(() => { if (mfa.setup && !mfa.locked) post("/api/auth/mfa-setup").then(setSetup, e => setError(e.message)); }, []);
  const cancel = async () => { await post("/api/auth/logout").catch(() => {}); goHome(); };
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (mfa.setup) { const r = await post("/api/auth/mfa-confirm", { code }); setCodes(r.recoveryCodes || []); }
      else { await post("/api/auth/mfa-verify", { code }); goHome(); }
    } catch (err) { setError(err.status === 401 ? "That sign-in timed out. Sign in again." : err.message); setCode(""); }
    setBusy(false);
  }
  if (mfa.locked) return (
    <Shell subtitle="Authenticator locked">
      <div role="alert" style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>Your authenticator is locked after 5 wrong codes. Ask a master admin to release it in User Management › Accounts & sign-in.</div>
      <button style={primary} onClick={cancel}>Back to sign in</button>
    </Shell>
  );
  if (codes) return <Shell subtitle="Authenticator is set up"><RecoveryCodes codes={codes} onDone={goHome} /></Shell>;
  return (
    <Shell subtitle={mfa.setup ? "Set up two-step sign-in" : "Two-step sign-in"}>
      {mfa.setup ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>
          Admin accounts sign in with a password <b>and</b> a code from an authenticator app. On your phone, open <b>Microsoft Authenticator</b> or <b>Google Authenticator</b>, add an account, and scan this:
          {setup ? <div style={{ margin: "12px 0" }}><QrCode rows={setup.qr} />
            <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8, textAlign: "center" }}>Can't scan? Enter this setup key: <span aria-label="Setup key" style={{ fontFamily: "monospace", color: INK, wordBreak: "break-all" }}>{setup.secret}</span></div></div>
            : !error && <div style={{ color: INK_SOFT, margin: "12px 0" }}>Getting your code…</div>}
          Then type the 6-digit code it shows.
        </div>
      ) : (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, marginBottom: 12 }}>Enter the 6-digit code from your authenticator app{mfa.name ? `, ${mfa.name.split(" ")[0]}` : ""}. Lost your phone? Use one of your recovery codes instead.</div>
      )}
      <form onSubmit={submit}>
        <Field label={mfa.setup ? "6-digit code" : "Code"}>
          <input aria-label="Authenticator code" style={{ ...input, fontSize: 20, letterSpacing: 4 }} autoFocus inputMode={mfa.setup ? "numeric" : "text"} autoComplete="one-time-code" maxLength={12} value={code} onChange={e => setCode(e.target.value.trim())} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy || !code}>{busy ? "Checking…" : mfa.setup ? "Turn it on" : "Sign in"}</button>
      </form>
      <div style={{ marginTop: 14, textAlign: "center" }}><button style={linkBtn} onClick={cancel}>Cancel</button></div>
    </Shell>
  );
}

function RequestAccount({ divisions, onBack }) {
  const [form, bind] = useForm({ firstName: "", lastName: "", email: "", organization: "", division: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("Enter your first and last name."); return; }
    if (form.password !== form.confirm) { setError("The two passwords don't match."); return; }
    if (!passwordOk(form.password)) { setError("The password doesn't meet the rules yet."); return; }
    setBusy(true); setError("");
    try { await post("/api/auth/signup", form); setDone(true); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  if (done) {
    return (
      <Shell subtitle="Account requested">
        <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>
          <b style={{ color: SAGE }}>Thanks, your request is in.</b> A master admin needs to approve it and set
          your role. Once they do, sign in with the email and password you just chose.
        </div>
        <button style={primary} onClick={onBack}>Back to sign in</button>
      </Shell>
    );
  }
  return (
    <Shell subtitle="Request an account">
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="First name"><input style={input} autoComplete="given-name" autoFocus {...bind("firstName")} /></Field>
          <Field label="Last name"><input style={input} autoComplete="family-name" {...bind("lastName")} /></Field>
        </div>
        <Field label="Work email" hint="You'll sign in with this.">
          <input style={input} type="email" autoComplete="email" {...bind("email")} />
        </Field>
        {BRAND.sandbox && <Field label="Your department or agency" hint="So the admin knows who you are. This is a sandbox: use any division below.">
          <input style={input} autoComplete="organization" {...bind("organization")} />
        </Field>}
        <Field label="Division">
          <select style={input} {...bind("division")}>
            <option value="">Choose your division…</option>
            {divisions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Password"><input style={input} type="password" autoComplete="new-password" {...bind("password")} /></Field>
        <PasswordRules value={form.password} />
        <Field label="Confirm password"><input style={input} type="password" autoComplete="new-password" {...bind("confirm")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Sending…" : "Request account"}</button>
      </form>
      <div style={{ marginTop: 14, textAlign: "center" }}><button style={linkBtn} onClick={onBack}>Back to sign in</button></div>
    </Shell>
  );
}

function FirstRun({ allowedHere }) {
  const [form, bind] = useForm({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowedHere) {
    return (
      <Shell subtitle="Not set up yet">
        <div style={{ fontSize: 14.5, lineHeight: 1.5 }}>
          The first administrator account has to be created on the computer running the app.
          Open <b>http://localhost:3000</b> there to finish setup.
        </div>
      </Shell>
    );
  }
  async function submit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try { await post("/api/auth/first-run", form); goHome(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Shell subtitle="First-time setup">
      <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 16, lineHeight: 1.5 }}>
        Create the master admin sign-in. If a master admin is already on the roster, this takes it over,
        keeping everything they've done. Everyone else will request accounts for you to approve.
      </div>
      <form onSubmit={submit}>
        <Field label="Your full name"><input style={input} autoFocus {...bind("name")} /></Field>
        <Field label="Your work email"><input style={input} type="email" autoComplete="username" {...bind("email")} /></Field>
        <Field label="Password"><input style={input} type="password" autoComplete="new-password" {...bind("password")} /></Field>
        <PasswordRules value={form.password} />
        <Field label="Confirm password"><input style={input} type="password" autoComplete="new-password" {...bind("confirm")} /></Field>
        <ErrorText>{error}</ErrorText>
        <button style={primary} disabled={busy}>{busy ? "Setting up…" : "Create master admin account"}</button>
      </form>
    </Shell>
  );
}

// A TV display screen that isn't paired yet (or was signed out): show a code for an admin to enter
function Pairing() {
  const [code, setCode] = useState("");
  useEffect(() => {
    let alive = true, t;
    const tick = async () => {
      try {
        const me = await (await fetch("/api/display/me", { credentials: "same-origin" })).json();
        if (me.paired) { window.location.reload(); return; }
        let c = me.code;
        if (!c) c = (await post("/api/display/pair")).code;
        if (alive) setCode(c || "");
      } catch { /* try again */ }
      if (alive) t = setTimeout(tick, 5000);
    };
    tick();
    return () => { alive = false; clearTimeout(t); };
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", color: "#fff", padding: 24, fontFamily: FONT,
      background: "linear-gradient(160deg, #0B1730 0%, #13233F 55%, #2A1020 100%)" }}>
      <div>
        <img src="/nexus-emblem.png" alt="" style={{ width: 150, height: 150, objectFit: "contain" }} />
        <div style={{ fontSize: 30, fontWeight: 800, fontStyle: "italic", letterSpacing: 1 }}>{BRAND.app.toUpperCase()} · DISPLAY SCREEN</div>
        <div style={{ fontSize: 20, opacity: 0.85, marginTop: 18 }}>To use this screen, an accounts admin enters this code in<br /><b>User Management › Display screens</b>.</div>
        <div aria-label="Pairing code" style={{ fontSize: 96, fontWeight: 800, letterSpacing: 18, margin: "28px 0 10px", fontVariantNumeric: "tabular-nums" }}>{code || "······"}</div>
        <div style={{ fontSize: 16, opacity: 0.7 }}>The code changes every 15 minutes. This page checks on its own; leave it open.</div>
      </div>
    </div>
  );
}

// The whole signed-out experience. `initial` = /api/auth/me already loaded (AuthGate in development), else it loads it.
export default function SignInRoot({ initial = null }) {
  const [me, setMe] = useState(initial);
  const [screen, setScreen] = useState("signin");
  const [offline, setOffline] = useState(false);
  const load = () => fetch("/api/auth/me", { headers: { "X-SGFD": "1" } }).then(r => r.json()).then(j => { if (j.user) goHome(); else setMe(j); }, () => setOffline(true));
  useEffect(() => { if (!initial) load(); }, []);
  const path = window.location.pathname.replace(/\/+$/, "");
  if (path === "/display") return <Pairing />;
  if (offline) return (
    <Shell subtitle="Can't reach the server">
      <div style={{ fontSize: 14.5, lineHeight: 1.5, marginBottom: 16 }}>The app server isn't responding. Make sure it's running, then try again.</div>
      <button style={primary} onClick={() => window.location.reload()}>Try again</button>
    </Shell>
  );
  if (!me) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT, fontFamily: FONT }}>Loading…</div>;
  const token = new URLSearchParams(window.location.search).get("token");
  if (path === "/reset-password" && token) return <ResetPassword token={token} />;
  if (me.mfaPending) return <MfaStep mfa={me.mfaPending} />;
  if (me.firstRun) return <FirstRun allowedHere={me.firstRunAllowedHere} />;
  if (screen === "request") return <RequestAccount divisions={me.divisions || []} onBack={() => setScreen("signin")} />;
  if (screen === "forgot") return <Forgot onBack={() => setScreen("signin")} />;
  return <SignIn me={me} onForgot={() => setScreen("forgot")} onRequest={() => setScreen("request")} onMfa={() => { setMe(null); load(); }} />;
}
