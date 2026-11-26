// Client portal, vendor side (Clients & Quotes; vendor office only): who at a client can sign in to the portal (one-time set-password
// links), their support requests with replies, and documents shared with them. Plus the Overview card of open requests.
// Server: server/portal.js (/api/clientportal). Never shipped to customers (packaging/owners.json).
import React, { useEffect, useRef, useState } from "react";
import { UserCheck, Copy, Send, Upload, Trash2, Download, LifeBuoy, X, ExternalLink } from "lucide-react";
import { cardStyle, btn } from "./App.jsx";

const INK = "#13233F", SOFT = "#4B5565", LINE = "#DDE2EA", ORANGE = "#C94D00", GREEN = "#1F8A4C", RED = "#B42318";
const inp = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff", fontSize: 14, color: INK, boxSizing: "border-box", fontFamily: "inherit", margin: 0 };
const T_LABEL = { open: "Open", answered: "Answered", waiting: "Waiting on them", closed: "Closed" };
const T_COLOR = { open: ORANGE, answered: GREEN, waiting: "#B26A00", closed: "#8A929C" };
const when = t => (t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
async function api(path, body) {
  const r = await fetch(`/api/clientportal${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const Pill = ({ color, children }) => <span style={{ fontSize: 11, fontWeight: 800, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>;
const Card = ({ title, actions, children }) => <section style={{ ...cardStyle, marginBottom: 14 }}>
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 16, color: INK }}>{title}</h2><span style={{ flex: 1 }} />{actions}</div>{children}</section>;

// Overview: requests waiting for the vendor across every client
export function PortalRequests({ open }) {
  const [d, setD] = useState(null);
  useEffect(() => { api("").then(setD, () => setD({ open: [] })); }, []);
  if (!d || !d.open.length) return null;
  return <Card title={`Client portal: ${d.open.length} request${d.open.length === 1 ? "" : "s"} to look at`}>
    {d.open.map(t => <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
      <button type="button" style={{ ...btn("ghost"), padding: 0, border: 0, fontWeight: 700 }} onClick={() => open("client", t.clientId, { ticket: t.id })}>{t.clientName}: #{t.number} {t.subject}</button>
      {t.unread && <span style={{ color: ORANGE, fontWeight: 800, fontSize: 12 }}>NEW</span>}<span style={{ flex: 1 }} />
      <Pill color={T_COLOR[t.status]}>{T_LABEL[t.status]}</Pill><span style={{ fontSize: 12, color: SOFT }}>{when(t.updatedAt)}</span></div>)}
  </Card>;
}

function TicketThread({ id, toast, onClose, reload }) {
  const [t, setT] = useState(null), [reply, setReply] = useState(""), [status, setStatus] = useState("answered"), [busy, setBusy] = useState(false);
  const load = () => api(`/tickets/${id}`).then(setT, e => toast(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <div style={{ color: SOFT }}>Loading…</div>;
  const send = async () => { setBusy(true); try { await api(`/tickets/${id}/reply`, { body: reply, status }); setReply(""); await load(); reload(); toast("Reply sent. They'll see it in the portal."); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const setSt = async s => { try { await api(`/tickets/${id}/status`, { status: s }); await load(); reload(); } catch (e) { toast(e.message); } };
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 12, marginTop: 8 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><b style={{ color: INK }}>#{t.ticket.number} {t.ticket.subject}</b><Pill color={T_COLOR[t.ticket.status]}>{T_LABEL[t.ticket.status]}</Pill>
      <span style={{ fontSize: 12, color: SOFT }}>{t.ticket.priority} priority · opened by {t.ticket.openedBy}</span><span style={{ flex: 1 }} />
      <button type="button" aria-label="Close thread" style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={onClose}><X size={14} /></button></div>
    {t.posts.map((p, i) => <div key={i} style={{ margin: "8px 0", padding: 10, borderRadius: 8, background: p.from === "vendor" ? "#FFF6EE" : "#F6F8FB" }}>
      <div style={{ fontSize: 12, color: SOFT }}><b style={{ color: INK }}>{p.name}</b> · {when(p.at)}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: INK }}>{p.body}</div></div>)}
    <textarea aria-label="Reply to the client" rows={3} style={{ ...inp, resize: "vertical" }} value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply (they see it in the portal)" />
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select aria-label="Status after reply" style={{ ...inp, width: 200 }} value={status} onChange={e => setStatus(e.target.value)}><option value="answered">Answered</option><option value="waiting">Waiting on them</option><option value="open">Still open</option><option value="closed">Closed</option></select>
      <button type="button" style={btn("primary")} disabled={busy || !reply.trim()} onClick={send}><Send size={14} /> Send reply</button>
      {t.ticket.status !== "closed" && <button type="button" style={btn("ghost")} onClick={() => setSt("closed")}>Close without reply</button>}</div>
  </div>;
}

export function PortalCard({ client, toast, initTicket }) {
  const [d, setD] = useState(null), [add, setAdd] = useState(null), [shown, setShown] = useState(null), [ticket, setTicket] = useState(initTicket || null), [doc, setDoc] = useState(null);
  const fileRef = useRef(null);
  const load = () => api(`/${client.id}`).then(setD, e => toast(e.message));
  useEffect(() => { load(); }, [client.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const invite = async () => { try { const r = await api(`/${client.id}/users`, add); setAdd(null); setShown({ name: add.name, ...r }); load(); } catch (e) { toast(e.message); } };
  const relink = async u => { try { const r = await api(`/users/${u.id}/link`, {}); setShown({ name: u.name, ...r }); load(); } catch (e) { toast(e.message); } };
  const onoff = async u => { try { await api(`/users/${u.id}/${u.active ? "disable" : "enable"}`, {}); load(); } catch (e) { toast(e.message); } };
  const upload = async () => {
    const f = doc.file; if (!f) return toast("Choose the file.");
    const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); });
    try { await api(`/${client.id}/docs`, { name: f.name, note: doc.note, dataUrl }); setDoc(null); load(); toast("Shared. They'll see it under Documents."); } catch (e) { toast(e.message); }
  };
  const removeDoc = async x => { if (!window.confirm(`Stop sharing ${x.name}?`)) return; try { await api(`/docs/${x.id}/remove`, {}); load(); } catch (e) { toast(e.message); } };
  const contacts = (client.contacts || []).filter(c => c.email && !d.users.some(u => u.email.toLowerCase() === c.email.toLowerCase()));
  return <>
    <Card title="Client portal" actions={<>{d.portalUrl && <a href={d.portalUrl} target="_blank" rel="noreferrer" style={{ ...btn("ghost"), textDecoration: "none" }}><ExternalLink size={14} /> {d.portalUrl.replace(/^https?:\/\//, "")}</a>}
      {d.canManage && !add && <button type="button" style={btn("primary")} onClick={() => setAdd({ name: contacts[0]?.name || "", email: contacts[0]?.email || "" })}><UserCheck size={14} /> Give portal access</button>}</>}>
      {!d.portalUrl && <div style={{ color: RED, fontSize: 13, marginBottom: 8 }}>PORTAL_HOST isn't set on this server, so the portal has no web address yet.</div>}
      {shown && <div role="alert" style={{ border: `1px solid ${ORANGE}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
        <b>Sign-in link for {shown.name}</b> <span style={{ color: SOFT, fontSize: 13 }}>(works once, for {shown.expires} days{shown.emailed ? "; also emailed to them" : "; send it to them"})</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}><code style={{ background: "#F3F5F8", padding: "6px 10px", borderRadius: 6, fontSize: 12.5, wordBreak: "break-all" }}>{shown.link}</code>
          <button type="button" style={btn()} onClick={() => navigator.clipboard?.writeText(shown.link).then(() => toast("Copied."), () => toast("Select it and copy by hand."))}><Copy size={14} /> Copy</button>
          <button type="button" style={btn("ghost")} onClick={() => setShown(null)}>Done</button></div></div>}
      {add && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {contacts.length > 0 && <select aria-label="From contacts" style={{ ...inp, width: 200 }} onChange={e => { const c = contacts[Number(e.target.value)]; if (c) setAdd({ name: c.name, email: c.email }); }}>{contacts.map((c, i) => <option key={i} value={i}>{c.name}</option>)}</select>}
        <input aria-label="Portal name" placeholder="Name" style={{ ...inp, width: 200 }} value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
        <input aria-label="Portal email" placeholder="Email" style={{ ...inp, width: 240 }} value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} />
        <button type="button" style={btn("primary")} onClick={invite}>Make the sign-in link</button><button type="button" style={btn("ghost")} onClick={() => setAdd(null)}>Cancel</button></div>}
      {!d.users.length ? <div style={{ color: SOFT }}>Nobody at {client.name} can sign in to the portal yet.</div> : d.users.map(u => <div key={u.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap", opacity: u.active ? 1 : 0.55 }}>
        <span style={{ flex: 1, minWidth: 200 }}><b>{u.name}</b> <span style={{ color: SOFT }}>{u.email}</span><div style={{ fontSize: 12, color: SOFT }}>{!u.active ? "Turned off" : u.ready ? `Last sign-in ${when(u.lastLogin)}` : u.inviteOpen ? "Hasn't set a password yet" : "Link expired: make a new one"}</div></span>
        {d.canManage && <><button type="button" style={btn("ghost")} onClick={() => relink(u)}>New sign-in link</button><button type="button" style={btn("ghost")} onClick={() => onoff(u)}>{u.active ? "Turn off" : "Turn on"}</button></>}</div>)}
    </Card>
    <Card title={`Support requests (${d.tickets.filter(t => t.status !== "closed").length} open)`}>
      {!d.tickets.length ? <div style={{ color: SOFT }}>None yet. They open requests from the portal.</div> : d.tickets.map(t => <div key={t.id}>
        <button type="button" onClick={() => setTicket(ticket === t.id ? null : t.id)} style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", padding: "6px 0", border: 0, borderBottom: `1px solid ${LINE}`, background: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
          <LifeBuoy size={15} color={t.unread ? ORANGE : SOFT} /><span style={{ flex: 1 }}><b>#{t.number} {t.subject}</b>{t.unread && <span style={{ color: ORANGE, fontWeight: 800, fontSize: 12, marginLeft: 6 }}>NEW</span>}<span style={{ color: SOFT, fontSize: 12 }}> · {t.openedBy} · {when(t.updatedAt)}</span></span>
          <Pill color={T_COLOR[t.status]}>{T_LABEL[t.status]}</Pill></button>
        {ticket === t.id && <TicketThread id={t.id} toast={toast} onClose={() => setTicket(null)} reload={load} />}</div>)}
    </Card>
    <Card title="Shared documents" actions={!doc && <button type="button" style={btn()} onClick={() => setDoc({ file: null, note: "" })}><Upload size={14} /> Share a document</button>}>
      {doc && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <input ref={fileRef} type="file" aria-label="Document to share" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" onChange={e => setDoc({ ...doc, file: e.target.files[0] || null })} />
        <input aria-label="Document note" placeholder="Note (optional)" style={{ ...inp, width: 240 }} value={doc.note} onChange={e => setDoc({ ...doc, note: e.target.value })} />
        <button type="button" style={btn("primary")} onClick={upload}>Share</button><button type="button" style={btn("ghost")} onClick={() => setDoc(null)}>Cancel</button></div>}
      {!d.docs.length ? <div style={{ color: SOFT }}>Nothing shared yet (signed quotes, spec sheets, contracts…).</div> : d.docs.map(x => <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>
        <Download size={14} color={SOFT} /><span style={{ flex: 1 }}><b>{x.name}</b> <span style={{ color: SOFT, fontSize: 12 }}>{x.note} · {when(x.date)} · {x.by}</span></span>
        <button type="button" aria-label={`Stop sharing ${x.name}`} style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => removeDoc(x)}><Trash2 size={13} /></button></div>)}
    </Card>
  </>;
}
