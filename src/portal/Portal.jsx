// Fenmorix Client Portal: what a customer's contacts see at the portal's own address (server/portal.js). Their servers and versions,
// quotes (read, print, accept or decline), support requests, release notes and documents Fenmorix shared with them.
import React, { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Server, FileText, LifeBuoy, Sparkles, Folder, LogOut, CheckCircle2, AlertTriangle, Printer, Download, Plus, Send, X, ArrowLeft, Clock } from "lucide-react";

const NAVY = "#08131D", NAVY2 = "#12263A", ORANGE = "#FF7900", BURNT = "#C94D00", INK = "#13233F", SOFT = "#5B6573", LINE = "#E2E6EC", GREEN = "#1F8A4C", RED = "#B42318", AMBER = "#B26A00", BG = "#F3F5F8";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const card = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, boxShadow: "0 1px 2px rgba(8,19,29,.05)" };
const inp = { width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid #CBD2DC`, fontSize: 15, color: INK, boxSizing: "border-box", fontFamily: FONT, background: "#fff" };
const btn = (kind = "primary") => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: FONT,
  ...(kind === "primary" ? { background: ORANGE, color: "#fff", border: `1px solid ${BURNT}` } : kind === "dark" ? { background: NAVY, color: "#fff", border: `1px solid ${NAVY}` }
    : { background: "#fff", color: INK, border: `1px solid #CBD2DC` }) });
const money = n => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = d => (d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const ago = t => { if (!t) return "never"; const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 2 ? "just now" : m < 120 ? `${m} minutes ago` : m < 2880 ? `${Math.round(m / 60)} hours ago` : `${Math.round(m / 1440)} days ago`; };
const Q_LABEL = { sent: "Waiting for your answer", accepted: "Accepted", declined: "Declined", expired: "Expired" };
const Q_COLOR = { sent: ORANGE, accepted: GREEN, declined: RED, expired: SOFT };
const T_LABEL = { open: "Open", answered: "Answered", waiting: "Waiting on you", closed: "Closed" };
const T_COLOR = { open: ORANGE, answered: GREEN, waiting: AMBER, closed: SOFT };

async function api(path, body) {
  const r = await fetch(`/api/portal${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work. Try again."), { status: r.status });
  return j;
}
const Pill = ({ color, children }) => <span style={{ display: "inline-block", fontSize: 12, fontWeight: 800, color, background: color + "14", border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>{children}</span>;
const H = ({ children, sub }) => <div style={{ margin: "0 0 16px" }}><h1 style={{ margin: 0, fontSize: 26, color: INK, letterSpacing: -0.3 }}>{children}</h1>{sub && <div style={{ color: SOFT, marginTop: 4 }}>{sub}</div>}</div>;
const Empty = ({ children }) => <div style={{ color: SOFT, padding: "18px 0" }}>{children}</div>;

// ---------------------------------------------------------------- Signed out
function Frame({ children }) {
  return <div style={{ minHeight: "100vh", fontFamily: FONT, background: `radial-gradient(1200px 600px at 85% -10%, ${ORANGE}33, transparent 60%), linear-gradient(160deg, ${NAVY} 0%, ${NAVY2} 100%)`,
    display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
    <div style={{ width: "min(420px, 100%)" }}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <img src="/api/portal/logo" alt="Fenmorix Technologies" style={{ height: 64, maxWidth: "80%", objectFit: "contain" }} />
        <div style={{ color: "#C5CAD0", fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginTop: 8, fontWeight: 700 }}>Client Portal</div>
      </div>
      <div style={{ ...card, padding: 24 }}>{children}</div>
      <div style={{ color: "#8D97A5", fontSize: 12, textAlign: "center", marginTop: 14 }}>© {new Date().getFullYear()} Fenmorix Technologies, LLC</div>
    </div>
  </div>;
}
function SignIn({ onIn }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const go = async e => { e.preventDefault(); setBusy(true); setError(""); try { onIn((await api("/login", { email, password: pw })).user); } catch (x) { setError(x.message); } finally { setBusy(false); } };
  return <Frame><form onSubmit={go}>
    <h2 style={{ margin: "0 0 4px", color: INK, fontSize: 20 }}>Sign in</h2>
    <div style={{ color: SOFT, fontSize: 14, marginBottom: 16 }}>Your servers, quotes, support and documents in one place.</div>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: SOFT, marginBottom: 12 }}>Email<input type="email" autoComplete="username" style={{ ...inp, marginTop: 4 }} value={email} onChange={e => setEmail(e.target.value)} required /></label>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: SOFT, marginBottom: 16 }}>Password<input type="password" autoComplete="current-password" style={{ ...inp, marginTop: 4 }} value={pw} onChange={e => setPw(e.target.value)} required /></label>
    {error && <div role="alert" style={{ color: RED, fontSize: 14, marginBottom: 12 }}>{error}</div>}
    <button type="submit" disabled={busy} style={{ ...btn(), width: "100%", justifyContent: "center", padding: "11px 16px" }}>{busy ? "Signing in…" : "Sign in"}</button>
    <div style={{ color: SOFT, fontSize: 13, marginTop: 14 }}>Forgot your password or need access? Ask your Fenmorix contact for a new sign-in link.</div>
  </form></Frame>;
}
function SetPassword({ token, onIn }) {
  const [info, setInfo] = useState(null), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api(`/invite?token=${encodeURIComponent(token)}`).then(setInfo, x => setError(x.message)); }, [token]);
  const go = async e => {
    e.preventDefault(); if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true); setError("");
    try { const r = await api("/invite", { token, password: pw }); window.history.replaceState(null, "", "/"); onIn(r.user); } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return <Frame>{!info ? <div role={error ? "alert" : undefined} style={{ color: error ? RED : SOFT }}>{error || "Checking your link…"}</div> : <form onSubmit={go}>
    <h2 style={{ margin: "0 0 4px", color: INK, fontSize: 20 }}>Welcome, {info.name}</h2>
    <div style={{ color: SOFT, fontSize: 14, marginBottom: 16 }}>Choose a password for <b>{info.email}</b> ({info.client}).</div>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: SOFT, marginBottom: 12 }}>New password<input type="password" autoComplete="new-password" aria-label="New password" style={{ ...inp, marginTop: 4 }} value={pw} onChange={e => setPw(e.target.value)} required /></label>
    <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: SOFT, marginBottom: 8 }}>Type it again<input type="password" autoComplete="new-password" aria-label="Type it again" style={{ ...inp, marginTop: 4 }} value={pw2} onChange={e => setPw2(e.target.value)} required /></label>
    <div style={{ fontSize: 12.5, color: SOFT, marginBottom: 14 }}>At least 10 characters, with a capital letter, a lowercase letter and a symbol (like ! - # or a space).</div>
    {error && <div role="alert" style={{ color: RED, fontSize: 14, marginBottom: 12 }}>{error}</div>}
    <button type="submit" disabled={busy} style={{ ...btn(), width: "100%", justifyContent: "center" }}>{busy ? "Saving…" : "Save and sign in"}</button>
  </form>}</Frame>;
}

// ---------------------------------------------------------------- Pages
function Home({ d, go }) {
  const behind = d.servers.filter(s => !s.upToDate).length, waiting = d.quotes.filter(q => q.status === "sent"), open = d.tickets.filter(t => t.status !== "closed");
  const Stat = ({ label, value, sub, color = INK, onClick }) => <button type="button" onClick={onClick} style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: FONT, borderLeft: `4px solid ${color === INK ? ORANGE : color}` }}>
    <div style={{ fontSize: 12, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 800, color, margin: "4px 0 2px" }}>{value}</div><div style={{ fontSize: 13, color: SOFT }}>{sub}</div></button>;
  return <>
    <H sub={d.client.status === "active" ? "Thanks for working with Fenmorix Technologies." : null}>{d.client.name}</H>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 16 }}>
      <Stat label="Servers" value={d.servers.length ? (behind ? `${behind} to update` : "Up to date") : "—"} sub={d.servers.length ? `${d.servers.length} server${d.servers.length === 1 ? "" : "s"}` : "Not connected yet"} color={behind ? ORANGE : d.servers.length ? GREEN : INK} onClick={() => go("servers")} />
      <Stat label="Quotes" value={waiting.length || d.quotes.length} sub={waiting.length ? "waiting for your answer" : `${d.quotes.length} in total`} color={waiting.length ? ORANGE : INK} onClick={() => go("quotes")} />
      <Stat label="Support" value={open.length} sub={`open request${open.length === 1 ? "" : "s"}${d.tickets.some(t => t.unread) ? " · new reply" : ""}`} color={d.tickets.some(t => t.unread) ? ORANGE : INK} onClick={() => go("support")} />
      <Stat label="Renewal" value={d.client.renewalDate ? day(d.client.renewalDate) : "—"} sub={d.client.licenseId || "License"} onClick={() => go("home")} />
    </div>
    {waiting.length > 0 && <div style={{ ...card, borderLeft: `4px solid ${ORANGE}`, marginBottom: 16 }}>
      <b style={{ color: INK }}>Quote{waiting.length === 1 ? "" : "s"} waiting for your answer</b>
      {waiting.map(q => <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}><span style={{ flex: 1, minWidth: 200 }}>{q.number} · {q.title || "Quote"} · valid until {day(q.validUntil)}</span>
        <button type="button" style={btn()} onClick={() => go("quote", q.id)}>Review</button></div>)}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      <div style={card}><h2 style={{ margin: "0 0 10px", fontSize: 17, color: INK }}>Your plan</h2>
        {d.client.modules.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{d.client.modules.map(m => <span key={m} style={{ fontSize: 13, background: BG, border: `1px solid ${LINE}`, borderRadius: 6, padding: "3px 8px" }}>{m}</span>)}</div>
          : <Empty>Your modules show here once a quote is accepted.</Empty>}
        {d.client.instanceUrl && <div style={{ marginTop: 12, fontSize: 14 }}>Your system: <a href={d.client.instanceUrl} target="_blank" rel="noreferrer" style={{ color: BURNT, fontWeight: 700 }}>{d.client.instanceUrl.replace(/^https?:\/\//, "")}</a></div>}</div>
      <div style={card}><h2 style={{ margin: "0 0 10px", fontSize: 17, color: INK }}>What's new</h2>
        {d.releases.length ? d.releases.slice(0, 2).map(r => <div key={r.version} style={{ marginBottom: 10 }}><b>{r.version}</b> <span style={{ color: SOFT, fontSize: 13 }}>{day(r.date)}</span>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 14, color: INK }}>{r.notes.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}</ul></div>) : <Empty>Release notes show here.</Empty>}
        {d.releases.length > 0 && <button type="button" style={btn("ghost")} onClick={() => go("updates")}>All updates</button>}</div>
    </div>
  </>;
}
function Servers({ d }) {
  return <><H sub="Your servers check in every few hours and report the version they run.">Servers</H>
    <div style={card}>{!d.servers.length ? <Empty>No server is connected to updates yet.</Empty> :
      d.servers.map((s, i) => <div key={i} style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 0", borderTop: i ? `1px solid ${LINE}` : 0, flexWrap: "wrap" }}>
        <Server size={22} color={s.online ? GREEN : RED} />
        <div style={{ flex: 1, minWidth: 200 }}><b style={{ color: INK }}>{s.name}</b>{s.url && <div style={{ fontSize: 13 }}><a href={s.url} target="_blank" rel="noreferrer" style={{ color: BURNT }}>{s.url.replace(/^https?:\/\//, "")}</a></div>}
          <div style={{ fontSize: 13, color: SOFT }}>Checked in {ago(s.lastSeen)}{s.users != null ? ` · ${s.users} user${s.users === 1 ? "" : "s"}` : ""} · automatic updates {s.auto ? "on" : "off"}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontWeight: 800, color: INK }}>{s.version || "—"}</div>
          {s.upToDate ? <Pill color={GREEN}>Up to date</Pill> : <Pill color={ORANGE}>{s.latest} available</Pill>}
          {s.lastUpdate && <div style={{ fontSize: 12, color: s.lastUpdate.ok ? SOFT : RED, marginTop: 4 }}>Last update {s.lastUpdate.ok ? "succeeded" : "didn't finish"} {day(s.lastUpdate.at)}</div>}</div></div>)}</div>
  </>;
}
function Quotes({ d, go }) {
  return <><H>Quotes</H><div style={card}>{!d.quotes.length ? <Empty>No quotes yet.</Empty> :
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr>{["Quote", "For", "Year one", "One-time", "Total", "Status", ""].map(h => <th key={h} style={{ textAlign: "left", color: SOFT, fontSize: 12, padding: "6px 8px", borderBottom: `2px solid ${LINE}` }}>{h}</th>)}</tr></thead>
      <tbody>{d.quotes.map(q => <tr key={q.id}><td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}`, fontWeight: 700 }}>{q.number}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}` }}>{q.title}<div style={{ fontSize: 12, color: SOFT }}>{q.term}</div></td>
        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}` }}>{money(q.year1)}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}` }}>{money(q.oneTime)}</td><td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}`, fontWeight: 700 }}>{money(q.total)}</td>
        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}` }}><Pill color={Q_COLOR[q.status]}>{Q_LABEL[q.status]}</Pill></td>
        <td style={{ padding: "10px 8px", borderBottom: `1px solid ${LINE}` }}><button type="button" style={btn(q.status === "sent" ? "primary" : "ghost")} onClick={() => go("quote", q.id)}>{q.status === "sent" ? "Review" : "Open"}</button></td></tr>)}</tbody></table></div>}</div></>;
}
function QuoteView({ d, id, go, setD, toast }) {
  const q = d.quotes.find(x => x.id === id), frame = useRef(null);
  const [name, setName] = useState(""), [title, setTitle] = useState(""), [agree, setAgree] = useState(false), [decline, setDecline] = useState(null), [busy, setBusy] = useState(false);
  if (!q) return <Empty>That quote isn't here.</Empty>;
  const accept = async () => { setBusy(true); try { setD(await api(`/quotes/${q.id}/accept`, { name, title, agree })); toast("Thank you! Your acceptance was recorded and Fenmorix has been told."); } catch (x) { toast(x.message); } finally { setBusy(false); } };
  const no = async () => { setBusy(true); try { setD(await api(`/quotes/${q.id}/decline`, { note: decline })); setDecline(null); toast("Recorded. Fenmorix has been told."); } catch (x) { toast(x.message); } finally { setBusy(false); } };
  return <>
    <button type="button" style={{ ...btn("ghost"), marginBottom: 12 }} onClick={() => go("quotes")}><ArrowLeft size={15} /> All quotes</button>
    <H sub={<><Pill color={Q_COLOR[q.status]}>{Q_LABEL[q.status]}</Pill>{q.decidedBy && <span style={{ marginLeft: 8 }}>by {q.decidedBy} on {day(q.decidedAt)}</span>}</>}>{q.number}{q.title ? ` · ${q.title}` : ""}</H>
    {q.status === "sent" && <div style={{ ...card, borderLeft: `4px solid ${ORANGE}`, marginBottom: 16 }}>
      <b style={{ color: INK }}>Accept this quote</b><div style={{ fontSize: 14, color: SOFT, margin: "4px 0 10px" }}>Valid until {day(q.validUntil)}. Read the quote below first; accepting records your name, title and the time.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <input aria-label="Your full name" placeholder="Your full name" style={inp} value={name} onChange={e => setName(e.target.value)} />
        <input aria-label="Your title" placeholder="Your title (Fire Chief, Owner…)" style={inp} value={title} onChange={e => setTitle(e.target.value)} /></div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: INK, margin: "10px 0" }}><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
        I'm authorized to accept this quote for {d.client.name} and agree to the terms in it.</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" style={btn()} disabled={busy || !name.trim() || !agree} onClick={accept}><CheckCircle2 size={15} /> Accept quote</button>
        {decline === null ? <button type="button" style={btn("ghost")} onClick={() => setDecline("")}>Decline</button> : <>
          <input aria-label="Why (optional)" placeholder="Why? (optional)" style={{ ...inp, flex: 1, minWidth: 200 }} value={decline} onChange={e => setDecline(e.target.value)} />
          <button type="button" style={btn("dark")} disabled={busy} onClick={no}>Decline quote</button></>}</div></div>}
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: 10, borderBottom: `1px solid ${LINE}` }}><button type="button" style={btn("ghost")} onClick={() => frame.current?.contentWindow?.print()}><Printer size={15} /> Print or save as PDF</button></div>
      <iframe ref={frame} title={`Quote ${q.number}`} src={`/api/portal/quotes/${q.id}/html`} style={{ width: "100%", height: "75vh", border: 0, background: "#fff" }} /></div>
  </>;
}
function Support({ d, go, reload, toast }) {
  const [nw, setNw] = useState(null), [busy, setBusy] = useState(false);
  const create = async () => { setBusy(true); try { const r = await api("/tickets", nw); setNw(null); await reload(); go("ticket", r.id); toast(`Request #${r.number} sent. We'll answer here.`); } catch (x) { toast(x.message); } finally { setBusy(false); } };
  return <><H sub="Questions, problems or changes: we answer here, and you'll see the whole conversation.">Support</H>
    {!nw ? <button type="button" style={{ ...btn(), marginBottom: 14 }} onClick={() => setNw({ subject: "", body: "", priority: "normal" })}><Plus size={15} /> New request</button>
      : <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}><input aria-label="Subject" placeholder="Subject" style={inp} value={nw.subject} onChange={e => setNw({ ...nw, subject: e.target.value })} />
          <select aria-label="Priority" style={inp} value={nw.priority} onChange={e => setNw({ ...nw, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent: something is down</option></select></div>
        <textarea aria-label="What do you need?" placeholder="What do you need? Include the page and what you expected to happen." rows={6} style={{ ...inp, marginTop: 10, resize: "vertical" }} value={nw.body} onChange={e => setNw({ ...nw, body: e.target.value })} />
        <div style={{ fontSize: 12.5, color: SOFT, margin: "6px 0 10px" }}>Never send passwords here. For an emergency, also call us.</div>
        <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn()} disabled={busy} onClick={create}><Send size={15} /> Send request</button><button type="button" style={btn("ghost")} onClick={() => setNw(null)}>Cancel</button></div></div>}
    <div style={card}>{!d.tickets.length ? <Empty>No requests yet.</Empty> : d.tickets.map((t, i) => <button key={t.id} type="button" onClick={() => go("ticket", t.id)}
      style={{ display: "flex", width: "100%", gap: 12, alignItems: "center", padding: "12px 4px", border: 0, borderTop: i ? `1px solid ${LINE}` : 0, background: "none", cursor: "pointer", textAlign: "left", fontFamily: FONT }}>
      <div style={{ flex: 1 }}><b style={{ color: INK }}>#{t.number} {t.subject}</b>{t.unread && <span style={{ marginLeft: 8, color: ORANGE, fontWeight: 800, fontSize: 12 }}>NEW REPLY</span>}
        <div style={{ fontSize: 13, color: SOFT }}>{t.openedBy} · updated {ago(t.updatedAt)}</div></div><Pill color={T_COLOR[t.status]}>{T_LABEL[t.status]}</Pill></button>)}</div></>;
}
function Ticket({ id, go, reload, toast }) {
  const [t, setT] = useState(null), [reply, setReply] = useState(""), [busy, setBusy] = useState(false);
  const load = () => api(`/tickets/${id}`).then(x => { setT(x); reload(); }, x => toast(x.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <Empty>Loading…</Empty>;
  const send = async () => { setBusy(true); try { await api(`/tickets/${id}/reply`, { body: reply }); setReply(""); await load(); reload(); } catch (x) { toast(x.message); } finally { setBusy(false); } };
  const close = async () => { try { await api(`/tickets/${id}/close`, {}); await load(); reload(); toast("Closed. Reply any time to open it again."); } catch (x) { toast(x.message); } };
  return <>
    <button type="button" style={{ ...btn("ghost"), marginBottom: 12 }} onClick={() => go("support")}><ArrowLeft size={15} /> All requests</button>
    <H sub={<Pill color={T_COLOR[t.ticket.status]}>{T_LABEL[t.ticket.status]}</Pill>}>#{t.ticket.number} {t.ticket.subject}</H>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>{t.posts.map((p, i) => <div key={i} style={{ ...card, alignSelf: p.from === "client" ? "flex-end" : "flex-start", maxWidth: "min(680px, 92%)",
      background: p.from === "client" ? "#FFF6EE" : "#fff", borderColor: p.from === "client" ? "#FFD3AE" : LINE }}>
      <div style={{ fontSize: 12.5, color: SOFT, marginBottom: 4 }}><b style={{ color: p.from === "vendor" ? BURNT : INK }}>{p.name}</b> · {new Date(p.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
      <div style={{ whiteSpace: "pre-wrap", color: INK, fontSize: 14.5, lineHeight: 1.45 }}>{p.body}</div></div>)}</div>
    <div style={card}><textarea aria-label="Reply" placeholder={t.ticket.status === "closed" ? "Reply to open it again" : "Reply"} rows={4} style={{ ...inp, resize: "vertical" }} value={reply} onChange={e => setReply(e.target.value)} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button type="button" style={btn()} disabled={busy || !reply.trim()} onClick={send}><Send size={15} /> Send reply</button>
        {t.ticket.status !== "closed" && <button type="button" style={btn("ghost")} onClick={close}><X size={15} /> Close request</button>}</div></div>
  </>;
}
function Updates({ d }) {
  return <><H sub="What changed in each version of your system.">Updates</H>
    {!d.releases.length ? <div style={card}><Empty>Release notes show here once your server is connected to updates.</Empty></div>
      : d.releases.map(r => <div key={r.version} style={{ ...card, marginBottom: 12 }}><div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><b style={{ fontSize: 17, color: INK }}>{r.version}</b><span style={{ color: SOFT, fontSize: 13 }}>{day(r.date)}</span>
        {d.servers.some(s => s.version === r.version) && <Pill color={GREEN}>You're on this</Pill>}</div>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: INK, lineHeight: 1.55 }}>{r.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></div>)}</>;
}
function Docs({ d }) {
  return <><H sub="Contracts, spec sheets and other files Fenmorix shared with you.">Documents</H>
    <div style={card}>{!d.docs.length ? <Empty>No documents yet.</Empty> : d.docs.map((x, i) => <div key={x.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: i ? `1px solid ${LINE}` : 0 }}>
      <FileText size={20} color={BURNT} /><div style={{ flex: 1 }}><b style={{ color: INK }}>{x.name}</b><div style={{ fontSize: 13, color: SOFT }}>{x.note ? `${x.note} · ` : ""}{day(x.date)} · {(x.size / 1048576).toFixed(1)} MB</div></div>
      <a href={`/api/portal/docs/${x.id}`} style={{ ...btn("ghost"), textDecoration: "none" }}><Download size={15} /> Download</a></div>)}</div></>;
}

// ---------------------------------------------------------------- App
export default function Portal() {
  const invite = new URLSearchParams(window.location.search).get("invite");
  const [user, setUser] = useState(undefined), [d, setD] = useState(null), [view, setView] = useState({ page: "home" }), [msg, setMsg] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 4500); };
  useEffect(() => { if (!invite) api("/me").then(r => setUser(r.user), () => setUser(null)); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => api("/overview").then(setD, x => { if (x.status === 401) setUser(null); else toast(x.message); });
  useEffect(() => { if (user) reload(); }, [user]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = (page, id) => { setView({ page, id }); window.scrollTo?.(0, 0); };
  if (invite && !user) return <SetPassword token={invite} onIn={setUser} />;
  if (user === undefined) return <div style={{ fontFamily: FONT, padding: 40, color: SOFT }}>Loading…</div>;
  if (!user) return <SignIn onIn={setUser} />;
  const out = async () => { await api("/logout", {}).catch(() => {}); setUser(null); setD(null); };
  const tabs = [["home", "Home", LayoutDashboard], ["servers", "Servers", Server], ["quotes", "Quotes", FileText], ["support", "Support", LifeBuoy], ["updates", "Updates", Sparkles], ["docs", "Documents", Folder]];
  const active = view.page === "quote" ? "quotes" : view.page === "ticket" ? "support" : view.page;
  const badge = k => (k === "quotes" ? d?.quotes.filter(q => q.status === "sent").length : k === "support" ? d?.tickets.filter(t => t.unread).length : 0) || 0;
  return <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT }}>
    <header style={{ background: `linear-gradient(120deg, ${NAVY}, ${NAVY2})`, color: "#fff", borderBottom: `3px solid ${ORANGE}` }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/api/portal/logo" alt="Fenmorix Technologies" style={{ height: 36 }} /><span style={{ fontSize: 12, letterSpacing: 2, color: "#C5CAD0", fontWeight: 800 }}>CLIENT PORTAL</span>
        <span style={{ flex: 1 }} /><span style={{ fontSize: 13, color: "#C5CAD0", textAlign: "right" }}>{user.name}<br /><span style={{ fontSize: 12 }}>{user.client}</span></span>
        <button type="button" onClick={out} aria-label="Sign out" title="Sign out" style={{ background: "none", border: "1px solid #ffffff33", color: "#fff", borderRadius: 8, padding: 8, cursor: "pointer" }}><LogOut size={16} /></button></div>
      <nav style={{ maxWidth: 1100, margin: "0 auto", padding: "0 8px", display: "flex", gap: 2, overflowX: "auto" }}>{tabs.map(([k, label, Icon]) =>
        <button key={k} type="button" aria-current={active === k ? "page" : undefined} onClick={() => go(k)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", border: 0, background: active === k ? "#ffffff14" : "none",
          color: active === k ? "#fff" : "#C5CAD0", borderBottom: `3px solid ${active === k ? ORANGE : "transparent"}`, marginBottom: -3, cursor: "pointer", fontWeight: 700, fontSize: 14, fontFamily: FONT, whiteSpace: "nowrap" }}>
          <Icon size={16} />{label}{badge(k) > 0 && <span style={{ background: ORANGE, color: "#fff", borderRadius: 999, fontSize: 11, padding: "1px 7px" }}>{badge(k)}</span>}</button>)}</nav>
    </header>
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 16px 60px" }}>
      {!d ? <Empty>Loading…</Empty> : <>
        {view.page === "home" && <Home d={d} go={go} />}
        {view.page === "servers" && <Servers d={d} />}
        {view.page === "quotes" && <Quotes d={d} go={go} />}
        {view.page === "quote" && <QuoteView key={view.id} d={d} id={view.id} go={go} setD={setD} toast={toast} />}
        {view.page === "support" && <Support d={d} go={go} reload={reload} toast={toast} />}
        {view.page === "ticket" && <Ticket id={view.id} go={go} reload={reload} toast={toast} />}
        {view.page === "updates" && <Updates d={d} />}
        {view.page === "docs" && <Docs d={d} />}
      </>}
      <div style={{ color: SOFT, fontSize: 12.5, marginTop: 30, textAlign: "center" }}>Need help now? {d?.vendor ? <a href={`mailto:${d.vendor.email}`} style={{ color: BURNT }}>{d.vendor.email}</a> : null} · © {new Date().getFullYear()} Fenmorix Technologies, LLC</div>
    </main>
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: NAVY, color: "#fff", padding: "10px 18px", borderRadius: 10, zIndex: 60, maxWidth: "90vw", boxShadow: "0 6px 20px rgba(0,0,0,.25)" }}>{msg}</div>}
  </div>;
}
