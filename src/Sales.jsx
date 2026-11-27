// Clients & Quotes (module "sales", vendor tool): Fenmorix Technologies' client book (contacts, current software spend, secure vault for
// server logins, work log), quote builder with a live calculator (src/pricing.js), printable quotes and spec sheets (src/SalesPrint.js),
// and the price book editor. Server: server/sales.js. Never shipped to customers (packaging/owners.json).
import React, { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, Building2, FileText, FilePlus2, BookOpen, Printer, Plus, Pencil, Trash2, KeyRound, Copy, Eye, Lock, Save,
  Send, Check, X, Server, Clock, ExternalLink, Search } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, btn } from "./App.jsx";
import { DEFAULT_INPUTS, calculate, money, sizeFor, marketLine } from "./pricing.js";
import { MODULES } from "./modules.js";
import { quoteHtml, specHtml, printHtml, specPrices } from "./SalesPrint.js";
import { Installations, Releases } from "./HubAdmin.jsx";
import { PortalCard, PortalRequests } from "./PortalAdmin.jsx";

const INK = "#13233F", SOFT = "#4B5565", LINE = "#DDE2EA", ORANGE = "#C94D00", GREEN = "#1F8A4C", RED = "#B42318";
const lbl = { fontSize: 12, fontWeight: 700, color: SOFT, display: "block", marginBottom: 3 };
// Own copy: App.jsx exports aren't ready while this module loads (circular import)
const inp = { width: "100%", padding: "8px 10px", borderRadius: 6, border: `1px solid ${LINE}`, background: "#fff", fontSize: 14, color: INK, boxSizing: "border-box", fontFamily: "inherit", margin: 0 };
const h1 = { margin: 0, fontSize: 24, color: INK };
const KIND = { ps: "Public safety", biz: "Business", gov: "Government" };
const STATUS = { prospect: "Prospect", active: "Customer", former: "Former customer", lost: "Lost" };
const Q_STATUS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" };
const Q_COLOR = { draft: SOFT, sent: ORANGE, accepted: GREEN, declined: RED, expired: "#8A929C" };
const VAULT_KIND = { server: "Server", login: "Website login", database: "Database", key: "Key / token", note: "Secure note", other: "Other" };
const ACT_KIND = { note: "Note", call: "Call", email: "Email", meeting: "Meeting", work: "Work", support: "Support" };
const fmtDay = d => (d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

async function api(path, body) {
  const r = await fetch(`/api/sales${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const copy = async (text, toast) => { try { await navigator.clipboard.writeText(text); toast("Copied."); } catch { toast("Couldn't copy here; select it by hand."); } };
const Pill = ({ color, children }) => <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" }}>{children}</span>;
const Card = ({ title, actions, children, style }) => <section style={{ ...cardStyle, marginBottom: 14, ...style }}>
  {(title || actions) && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><h2 style={{ margin: 0, fontSize: 16, color: INK }}>{title}</h2><span style={{ flex: 1 }} />{actions}</div>}
  {children}</section>;
const Field = ({ label, children, style }) => <label style={{ display: "block", ...style }}><span style={lbl}>{label}</span>{children}</label>;
const Kpi = ({ label, value, sub, color = INK }) => <div style={{ ...cardStyle, padding: 14, borderLeft: `4px solid ${color === INK ? "#FF7900" : color}` }}>
  <div style={{ fontSize: 11.5, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
  <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>{sub && <div style={{ fontSize: 12, color: SOFT }}>{sub}</div>}</div>;
const CAD_DEFAULT = { existing: 2500, new: 7500, includedViews: 2, extraView: 1500 };
const th = { textAlign: "left", fontSize: 11.5, color: SOFT, padding: "6px 8px", borderBottom: `2px solid ${LINE}`, whiteSpace: "nowrap" };
const td = { padding: "7px 8px", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, verticalAlign: "top" };
const tdn = { ...td, textAlign: "right", whiteSpace: "nowrap" };

// ---------------------------------------------------------------- Overview
function Overview({ d, open }) {
  const t = d.totals;
  const soon = d.clients.filter(c => c.status === "active" && c.renewalDate && new Date(c.renewalDate) - Date.now() < 90 * 864e5).sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
  return <>
    <h1 style={{ ...h1, marginBottom: 14 }}>Clients &amp; Quotes</h1>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 16 }}>
      <Kpi label="Open quotes" value={money(t.pipeline)} sub={`${t.open} sent, waiting for an answer`} />
      <Kpi label="Won, yearly" value={money(t.wonYearly)} sub={`${t.won} accepted quote${t.won === 1 ? "" : "s"}`} color={GREEN} />
      <Kpi label="Clients" value={d.clients.filter(c => c.status === "active").length} sub={`${d.clients.filter(c => c.status === "prospect").length} prospects`} />
      <Kpi label="Hours this month" value={t.hoursThisMonth} sub={`${t.billableThisMonth} billable`} />
      <Kpi label="Renewals in 90 days" value={t.renewalsSoon} color={t.renewalsSoon ? ORANGE : INK} />
    </div>
    <PortalRequests open={open} />
    <Card title="Recent quotes" actions={<button type="button" style={btn("primary")} onClick={() => open("new")}><FilePlus2 size={14} /> New quote</button>}>
      <QuoteTable quotes={d.quotes.slice(0, 10)} open={open} />
    </Card>
    {soon.length > 0 && <Card title="Renewals coming up">
      {soon.map(c => <div key={c.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>
        <button type="button" style={{ ...btn("ghost"), padding: 0, border: 0, fontWeight: 700 }} onClick={() => open("client", c.id)}>{c.name}</button><span style={{ flex: 1 }} />{fmtDay(c.renewalDate)}</div>)}
    </Card>}
  </>;
}
function QuoteTable({ quotes, open, client = true }) {
  if (!quotes.length) return <div style={{ color: SOFT }}>No quotes yet.</div>;
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>
    <th style={th}>Quote</th>{client && <th style={th}>Client</th>}<th style={th}>Edition</th><th style={th}>Status</th>
    <th style={{ ...th, textAlign: "right" }}>Year one</th><th style={{ ...th, textAlign: "right" }}>Contract</th><th style={th}>Updated</th></tr></thead>
    <tbody>{quotes.map(q => <tr key={q.id} onClick={() => open("quote", q.id)} style={{ cursor: "pointer" }}>
      <td style={td}><b>{q.number}</b><div style={{ fontSize: 12, color: SOFT }}>{q.title}</div></td>{client && <td style={td}>{q.clientName}</td>}
      <td style={td}>{q.edition}</td><td style={td}><Pill color={Q_COLOR[q.status]}>{Q_STATUS[q.status]}</Pill></td>
      <td style={tdn}>{money(q.year1)}</td><td style={tdn}>{money(q.contractValue)}</td><td style={td}>{fmtDay(q.updatedAt)}</td></tr>)}</tbody></table></div>;
}

// ---------------------------------------------------------------- Clients
function ClientsPage({ d, open, edit }) {
  const [q, setQ] = useState(""), [st, setSt] = useState("all");
  const list = d.clients.filter(c => (st === "all" || c.status === st) && (!q || `${c.name} ${c.city} ${(c.contacts || []).map(x => x.name + " " + x.email).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  return <>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
      <h1 style={h1}>Clients</h1><span style={{ flex: 1 }} />
      <select aria-label="Show" value={st} onChange={e => setSt(e.target.value)} style={{ ...inp, width: 170 }}><option value="all">Everyone</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}</select>
      <input aria-label="Find a client" placeholder="Find a client…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inp, width: 220 }} />
      {d.rights.canEdit && <button type="button" style={btn("primary")} onClick={() => edit({})}><Plus size={14} /> Add a client</button>}</div>
    {!list.length && <div style={{ color: SOFT }}>{d.clients.length ? "No clients match." : "No clients yet. Add your first one."}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
      {list.map(c => { const p = (c.contacts || []).find(x => x.primary) || c.contacts?.[0];
        return <button key={c.id} type="button" onClick={() => open("client", c.id)} aria-label={`Open ${c.name}`}
          style={{ ...cardStyle, textAlign: "left", cursor: "pointer", border: `1px solid ${LINE}`, font: "inherit", color: INK }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><b style={{ fontSize: 15.5, flex: 1 }}>{c.name}</b><Pill color={c.status === "active" ? GREEN : c.status === "prospect" ? ORANGE : SOFT}>{STATUS[c.status]}</Pill></div>
          <div style={{ fontSize: 12.5, color: SOFT, marginTop: 2 }}>{KIND[c.kind]}{c.city ? ` · ${c.city}${c.state ? ", " + c.state : ""}` : ""}</div>
          {p && <div style={{ fontSize: 13, marginTop: 6 }}>{p.name}{p.title ? `, ${p.title}` : ""}<div style={{ color: SOFT, fontSize: 12 }}>{[p.email, p.phone].filter(Boolean).join(" · ")}</div></div>}
          <div style={{ fontSize: 12, color: SOFT, marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>{c.quotes} quote{c.quotes === 1 ? "" : "s"}</span>{c.openValue > 0 && <span style={{ color: ORANGE }}>{money(c.openValue)} open</span>}
            {c.wonValue > 0 && <span style={{ color: GREEN }}>{money(c.wonValue)} won</span>}{c.lastActivity && <span>Last contact {fmtDay(c.lastActivity)}</span>}</div>
        </button>; })}
    </div>
  </>;
}

function ClientEditor({ client, toast, onDone, onCancel }) {
  const [f, setF] = useState(() => ({ name: "", kind: "ps", status: "prospect", website: "", address: "", city: "", state: "LA", zip: "", instanceUrl: "", licenseId: "",
    modules: [], renewalDate: "", notes: "", contacts: [{ name: "", title: "", email: "", phone: "", primary: true }], currentSpend: [], ...(client || {}) }));
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setRow = (k, i, p) => setF(x => ({ ...x, [k]: x[k].map((r, j) => (j === i ? { ...r, ...p } : r)) }));
  const save = async () => { setBusy(true); try { const r = await api("/clients", f); onDone(r.id, client?.id ? "Saved." : "Client added."); } catch (e) { toast(e.message); } setBusy(false); };
  const g2 = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 10 };
  return <Card title={client?.id ? `Edit ${client.name}` : "Add a client"}>
    <div style={g2}>
      <Field label="Name" style={{ gridColumn: "span 2" }}><input aria-label="Client name" value={f.name} onChange={e => set("name", e.target.value)} style={inp} /></Field>
      <Field label="Kind"><select aria-label="Kind" value={f.kind} onChange={e => set("kind", e.target.value)} style={inp}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Status"><select aria-label="Status" value={f.status} onChange={e => set("status", e.target.value)} style={inp}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
    </div>
    <div style={g2}>
      <Field label="Address" style={{ gridColumn: "span 2" }}><input aria-label="Address" value={f.address} onChange={e => set("address", e.target.value)} style={inp} /></Field>
      <Field label="City"><input aria-label="City" value={f.city} onChange={e => set("city", e.target.value)} style={inp} /></Field>
      <Field label="State / ZIP"><div style={{ display: "flex", gap: 6 }}><input aria-label="State" value={f.state} onChange={e => set("state", e.target.value)} style={{ ...inp, width: 60 }} />
        <input aria-label="ZIP" value={f.zip} onChange={e => set("zip", e.target.value)} style={inp} /></div></Field>
      <Field label="Website"><input aria-label="Website" value={f.website} onChange={e => set("website", e.target.value)} style={inp} /></Field>
    </div>
    <div style={{ ...lbl, marginTop: 6 }}>Contacts</div>
    {f.contacts.map((c, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1.3fr 1fr auto auto", gap: 6, marginBottom: 6, alignItems: "center" }}>
      <input aria-label={`Contact ${i + 1} name`} placeholder="Name" value={c.name} onChange={e => setRow("contacts", i, { name: e.target.value })} style={inp} />
      <input aria-label={`Contact ${i + 1} title`} placeholder="Title" value={c.title} onChange={e => setRow("contacts", i, { title: e.target.value })} style={inp} />
      <input aria-label={`Contact ${i + 1} email`} placeholder="Email" value={c.email} onChange={e => setRow("contacts", i, { email: e.target.value })} style={inp} />
      <input aria-label={`Contact ${i + 1} phone`} placeholder="Phone" value={c.phone} onChange={e => setRow("contacts", i, { phone: e.target.value })} style={inp} />
      <label style={{ fontSize: 12, whiteSpace: "nowrap" }}><input type="radio" name="primary" checked={!!c.primary} onChange={() => set("contacts", f.contacts.map((r, j) => ({ ...r, primary: j === i })))} /> Main</label>
      <button type="button" aria-label="Remove contact" style={btn("ghost")} onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))}><X size={14} /></button></div>)}
    <button type="button" style={{ ...btn("ghost"), marginBottom: 12 }} onClick={() => set("contacts", [...f.contacts, { name: "", title: "", email: "", phone: "", primary: !f.contacts.length }])}><Plus size={13} /> Add a contact</button>
    <div style={lbl}>Software they pay for today (what Fenmorix OS could replace)</div>
    {f.currentSpend.map((s, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, marginBottom: 6 }}>
      <input aria-label={`Current software ${i + 1}`} placeholder="Product (e.g. scheduling)" value={s.label} onChange={e => setRow("currentSpend", i, { label: e.target.value })} style={inp} />
      <input aria-label={`Current software ${i + 1} per year`} type="number" placeholder="Per year" value={s.annual || ""} onChange={e => setRow("currentSpend", i, { annual: Number(e.target.value) })} style={inp} />
      <button type="button" aria-label="Remove" style={btn("ghost")} onClick={() => set("currentSpend", f.currentSpend.filter((_, j) => j !== i))}><X size={14} /></button></div>)}
    <button type="button" style={{ ...btn("ghost"), marginBottom: 12 }} onClick={() => set("currentSpend", [...f.currentSpend, { label: "", annual: 0 }])}><Plus size={13} /> Add software they use</button>
    <div style={g2}>
      <Field label="Their Fenmorix OS address"><input aria-label="Fenmorix OS address" placeholder="https://…" value={f.instanceUrl} onChange={e => set("instanceUrl", e.target.value)} style={inp} /></Field>
      <Field label="License id"><input aria-label="License id" value={f.licenseId} onChange={e => set("licenseId", e.target.value)} style={inp} /></Field>
      <Field label="Renewal date"><input aria-label="Renewal date" type="date" value={f.renewalDate || ""} onChange={e => set("renewalDate", e.target.value)} style={inp} /></Field>
    </div>
    <Field label="Notes"><textarea aria-label="Notes" rows={3} value={f.notes} onChange={e => set("notes", e.target.value)} style={inp} /></Field>
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button type="button" style={btn("primary")} disabled={busy || !f.name.trim()} onClick={save}><Save size={14} /> Save client</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
  </Card>;
}

function VaultEntry({ v, toast, edit, reload }) {
  const [s, setS] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (!s) return; const t = setTimeout(() => setS(null), 30_000); return () => clearTimeout(t); }, [s]);
  const remove = async () => { if (!window.confirm(`Remove ${v.label} from the vault? This can't be undone.`)) return; try { await api(`/vault/${v.id}/remove`, {}); toast("Removed."); reload(); } catch (e) { toast(e.message); } };
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Server size={15} color={SOFT} /><b style={{ flex: 1 }}>{v.label}</b><Pill color={SOFT}>{VAULT_KIND[v.kind]}</Pill></div>
    {v.host && <div style={{ fontSize: 12.5, color: SOFT, marginTop: 3, wordBreak: "break-all" }}>{v.host}</div>}
    {s ? <div role="group" aria-label={`Login for ${v.label}`} style={{ marginTop: 8, background: "#F6F7F9", borderRadius: 8, padding: 8, fontSize: 13, display: "grid", gap: 4 }}>
      {s.user && <div>User: <code>{s.user}</code> <button type="button" aria-label="Copy user" style={{ ...btn("ghost"), padding: "0 6px" }} onClick={() => copy(s.user, toast)}><Copy size={12} /></button></div>}
      {s.password && <div>Password: <code>{s.password}</code> <button type="button" aria-label="Copy password" style={{ ...btn("ghost"), padding: "0 6px" }} onClick={() => copy(s.password, toast)}><Copy size={12} /></button></div>}
      {s.note && <div style={{ whiteSpace: "pre-wrap" }}>{s.note}</div>}
      <div style={{ fontSize: 11, color: SOFT }}>Hides again in 30 seconds. This look was recorded in the audit log.</div></div> : null}
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
      {v.hasSecret && !s && <button type="button" aria-label={`Show ${v.label}`} style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} disabled={busy}
        onClick={async () => { setBusy(true); try { setS(await api(`/vault/${v.id}/reveal`, {})); } catch (e) { toast(e.message); } setBusy(false); }}><Eye size={13} /> Show</button>}
      {s && <button type="button" style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} onClick={() => setS(null)}><Lock size={13} /> Hide</button>}
      <button type="button" aria-label={`Edit ${v.label}`} style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} onClick={() => edit(v)}><Pencil size={13} /> Edit</button>
      <button type="button" aria-label={`Remove ${v.label}`} style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5, color: RED }} onClick={remove}><Trash2 size={13} /></button>
      <span style={{ flex: 1 }} /><span style={{ fontSize: 11, color: SOFT, alignSelf: "center" }}>{v.updatedBy} · {fmtDay(v.updatedAt)}</span></div>
  </div>;
}
function VaultEditor({ clientId, entry, toast, onDone, onCancel }) {
  const [f, setF] = useState({ label: entry?.label || "", kind: entry?.kind || "server", host: entry?.host || "", user: "", password: "", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { await api(`/clients/${clientId}/vault`, { id: entry?.id, label: f.label, kind: f.kind, host: f.host, secret: f.user || f.password || f.note ? { user: f.user, password: f.password, note: f.note } : undefined }); onDone(); }
    catch (e) { toast(e.message); } setBusy(false);
  };
  return <div role="group" aria-label="Vault entry" style={{ border: `1px dashed ${LINE}`, borderRadius: 10, padding: 12, display: "grid", gap: 8, gridColumn: "1 / -1" }}>
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
      <Field label="What is it"><input aria-label="Vault label" placeholder="Production server (SSH)" value={f.label} onChange={e => set("label", e.target.value)} style={inp} /></Field>
      <Field label="Kind"><select aria-label="Vault kind" value={f.kind} onChange={e => set("kind", e.target.value)} style={inp}>{Object.entries(VAULT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
    <Field label="Address (shown openly)"><input aria-label="Vault address" placeholder="3.19.183.152, ssh ubuntu@…, https://…" value={f.host} onChange={e => set("host", e.target.value)} style={inp} /></Field>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <Field label="User name"><input aria-label="Vault user" autoComplete="off" value={f.user} onChange={e => set("user", e.target.value)} style={inp} /></Field>
      <Field label="Password"><input aria-label="Vault password" type="password" autoComplete="new-password" value={f.password} onChange={e => set("password", e.target.value)} style={inp} /></Field></div>
    <Field label="Secure note (keys, recovery codes, steps)"><textarea aria-label="Vault note" rows={3} value={f.note} onChange={e => set("note", e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} /></Field>
    {entry?.hasSecret && <div style={{ fontSize: 12, color: SOFT }}>Leave the user, password and note empty to keep what's stored.</div>}
    <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn("primary")} disabled={busy || !f.label.trim()} onClick={save}><Lock size={14} /> Save to vault</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    <div style={{ fontSize: 11.5, color: SOFT }}>Encrypted on the server. Only managers of Clients &amp; Quotes can see it, and every look is recorded.</div>
  </div>;
}

function ClientView({ id, rights, toast, open, reloadAll, init }) {
  const [d, setD] = useState(null), [editing, setEditing] = useState(false), [vaultEdit, setVaultEdit] = useState(null);
  const [act, setAct] = useState({ kind: "call", body: "", hours: "", billable: false, day: new Date().toISOString().slice(0, 10) });
  const load = () => api(`/clients/${id}`).then(setD, e => toast(e.message));
  useEffect(() => { setD(null); setEditing(false); load(); }, [id]);
  if (!d) return <div style={{ color: SOFT }}>Loading…</div>;
  const c = d.client;
  if (editing) return <ClientEditor client={c} toast={toast} onCancel={() => setEditing(false)} onDone={(_, m) => { setEditing(false); toast(m); load(); reloadAll(); }} />;
  const addAct = async () => { try { await api(`/clients/${id}/activity`, act); setAct(a => ({ ...a, body: "", hours: "" })); load(); reloadAll(); } catch (e) { toast(e.message); } };
  const removeClient = async () => { if (!window.confirm(`Remove ${c.name} and everything in its vault and work log?`)) return; try { await api(`/clients/${id}/remove`, {}); toast("Removed."); reloadAll(); open("clients"); } catch (e) { toast(e.message); } };
  const hours = d.activity.reduce((s, a) => s + a.hours, 0), billable = d.activity.filter(a => a.billable).reduce((s, a) => s + a.hours, 0);
  return <>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
      <h1 style={h1}>{c.name}</h1><Pill color={c.status === "active" ? GREEN : c.status === "prospect" ? ORANGE : SOFT}>{STATUS[c.status]}</Pill><span style={{ flex: 1 }} />
      {rights.canEdit && <button type="button" style={btn("ghost")} onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>}
      {rights.canEdit && <button type="button" style={btn("primary")} onClick={() => open("new", null, { clientId: id })}><FilePlus2 size={14} /> New quote</button>}</div>
    <div style={{ color: SOFT, fontSize: 13, marginBottom: 14 }}>{KIND[c.kind]}{c.address ? ` · ${c.address}` : ""}{c.city ? `, ${c.city}` : ""}{c.state ? `, ${c.state}` : ""} {c.zip}
      {c.website && <> · <a href={/^https?:/.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a></>}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
      <Card title="Contacts" style={{ marginBottom: 0 }}>
        {!c.contacts.length && <div style={{ color: SOFT }}>No contacts yet.</div>}
        {c.contacts.map((p, i) => <div key={i} style={{ padding: "6px 0", borderBottom: `1px solid ${LINE}` }}><b>{p.name}</b>{p.title && <span style={{ color: SOFT }}>, {p.title}</span>}{p.primary && <span style={{ marginLeft: 6 }}><Pill color={ORANGE}>Main</Pill></span>}
          <div style={{ fontSize: 13 }}>{p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}{p.email && p.phone && " · "}{p.phone && <a href={`tel:${p.phone}`}>{p.phone}</a>}</div></div>)}
      </Card>
      <Card title="Their system" style={{ marginBottom: 0 }}>
        <div style={{ fontSize: 13.5, display: "grid", gap: 4 }}>
          <div><span style={lbl}>Fenmorix OS address</span>{c.instanceUrl ? <a href={c.instanceUrl} target="_blank" rel="noreferrer">{c.instanceUrl} <ExternalLink size={12} /></a> : <span style={{ color: SOFT }}>Not installed yet</span>}</div>
          <div><span style={lbl}>License</span>{c.licenseId || <span style={{ color: SOFT }}>—</span>}{c.renewalDate && <span> · renews {fmtDay(c.renewalDate)}</span>}</div>
          <div><span style={lbl}>Modules</span>{c.modules.length ? c.modules.map(k => MODULES.find(m => m.key === k)?.name || k).join(", ") : <span style={{ color: SOFT }}>—</span>}</div>
          {c.currentSpend.length > 0 && <div><span style={lbl}>Software they pay for today</span>{c.currentSpend.map((s, i) => <div key={i}>{s.label}: {money(s.annual)}/yr</div>)}
            <b>{money(c.currentSpend.reduce((s, x) => s + x.annual, 0))} a year</b></div>}
          {c.notes && <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{c.notes}</div>}
        </div>
      </Card>
    </div>
    {d.vault && <Card title="Vault: servers and logins" style={{ marginTop: 14 }} actions={<button type="button" style={btn("ghost")} onClick={() => setVaultEdit({})}><KeyRound size={14} /> Add to vault</button>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
        {vaultEdit && <VaultEditor clientId={id} entry={vaultEdit.id ? vaultEdit : null} toast={toast} onCancel={() => setVaultEdit(null)} onDone={() => { setVaultEdit(null); toast("Saved to the vault."); load(); }} />}
        {!d.vault.length && !vaultEdit && <div style={{ color: SOFT }}>Nothing stored yet: server addresses and SSH logins, admin accounts, database passwords, Cloudflare and DNS logins, recovery codes.</div>}
        {d.vault.map(v => <VaultEntry key={v.id} v={v} toast={toast} reload={load} edit={setVaultEdit} />)}
      </div></Card>}
    <Card title="Quotes" style={{ marginTop: d.vault ? 0 : 14 }}><QuoteTable quotes={d.quotes} open={open} client={false} /></Card>
    <PortalCard client={c} toast={toast} initTicket={init?.ticket} />
    <Card title="Work log" actions={<span style={{ fontSize: 12.5, color: SOFT }}>{hours} hours logged · {billable} billable</span>}>
      {rights.canEdit && <div style={{ display: "grid", gridTemplateColumns: "130px 120px 1fr 80px auto auto", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <input aria-label="Day" type="date" value={act.day} onChange={e => setAct(a => ({ ...a, day: e.target.value }))} style={inp} />
        <select aria-label="Kind of entry" value={act.kind} onChange={e => setAct(a => ({ ...a, kind: e.target.value }))} style={inp}>{Object.entries(ACT_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input aria-label="What happened" placeholder="What happened or what was done" value={act.body} onChange={e => setAct(a => ({ ...a, body: e.target.value }))} onKeyDown={e => e.key === "Enter" && act.body.trim() && addAct()} style={inp} />
        <input aria-label="Hours" type="number" step="0.25" min="0" placeholder="Hours" value={act.hours} onChange={e => setAct(a => ({ ...a, hours: e.target.value }))} style={inp} />
        <label style={{ fontSize: 12.5, whiteSpace: "nowrap" }}><input type="checkbox" checked={act.billable} onChange={e => setAct(a => ({ ...a, billable: e.target.checked }))} /> Billable</label>
        <button type="button" style={btn("primary")} disabled={!act.body.trim()} onClick={addAct}><Plus size={14} /> Log</button></div>}
      {!d.activity.length && <div style={{ color: SOFT }}>Nothing logged yet.</div>}
      {d.activity.map(a => <div key={a.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13.5 }}>
        <span style={{ width: 92, color: SOFT, flexShrink: 0 }}>{fmtDay(a.day)}</span><span style={{ width: 70, flexShrink: 0 }}><Pill color={a.kind === "work" || a.kind === "support" ? ORANGE : SOFT}>{ACT_KIND[a.kind]}</Pill></span>
        <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{a.body}<span style={{ color: SOFT, fontSize: 12 }}> · {a.by}</span></span>
        {a.hours > 0 && <span style={{ whiteSpace: "nowrap" }}><Clock size={12} /> {a.hours} h{a.billable ? " $" : ""}</span>}
        {rights.canEdit && <button type="button" aria-label="Remove entry" style={{ ...btn("ghost"), padding: "0 6px" }} onClick={async () => { if (window.confirm("Remove this entry?")) { await api(`/activity/${a.id}/remove`, {}).catch(e => toast(e.message)); load(); } }}><X size={12} /></button>}</div>)}
    </Card>
    {rights.canManage && !d.quotes.length && <button type="button" style={{ ...btn("ghost"), color: RED }} onClick={removeClient}><Trash2 size={14} /> Remove this client</button>}
  </>;
}

// ---------------------------------------------------------------- Quote builder
function Num({ label, value, onChange, step = 1, min = 0, width }) {
  return <Field label={label} style={width ? { width } : undefined}><input aria-label={label} type="number" step={step} min={min} value={value ?? ""} onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))} style={inp} /></Field>;
}
function Choice({ label, value, options, onChange }) {
  return <Field label={label}><select aria-label={label} value={value} onChange={e => onChange(e.target.value)} style={inp}>{options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>;
}
function QuoteBuilder({ quoteId, init, d, book, toast, open, reloadAll }) {
  const [q, setQ] = useState(null), [client, setClient] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (quoteId) api(`/quotes/${quoteId}`).then(r => { setQ(r.quote); setClient(r.client); setForm({ clientId: r.quote.clientId, title: r.quote.title, notes: r.quote.notes, internalNotes: r.quote.internalNotes, inputs: r.quote.inputs }); }, e => toast(e.message));
    else {
      const c = d.clients.find(x => x.id === init?.clientId);
      setQ(null); setClient(c || null);
      setForm({ clientId: c?.id || "", title: "", notes: "", internalNotes: "", inputs: { ...DEFAULT_INPUTS, segment: c?.kind === "biz" ? "biz" : "ps", edition: c?.kind === "biz" ? "business" : "operations", users: c?.kind === "biz" ? 10 : 40, currentSpend: c?.currentSpend || [] } });
    }
  }, [quoteId, init?.clientId]);
  const locked = q && q.status !== "draft";
  const useBook = locked ? q.book : book;
  const r = useMemo(() => (form && useBook ? calculate(form.inputs, useBook) : null), [form, useBook]);
  if (!form || !useBook) return <div style={{ color: SOFT }}>Loading…</div>;
  const i = form.inputs, seg = useBook.segments[i.segment];
  const set = (k, v) => setForm(f => ({ ...f, inputs: { ...f.inputs, [k]: v } }));
  const setSeg = s => setForm(f => ({ ...f, inputs: { ...f.inputs, segment: s, edition: useBook.segments[s].editions[1]?.key || useBook.segments[s].editions[0].key, addons: [] } }));
  const save = async () => {
    setBusy(true);
    try { const x = await api("/quotes", { id: q?.id, ...form }); toast(q ? "Saved." : `Quote ${x.number} saved.`); reloadAll(); if (!q) open("quote", x.id); else { const rr = await api(`/quotes/${q.id}`); setQ(rr.quote); } }
    catch (e) { toast(e.message); } setBusy(false);
  };
  const status = async st => {
    try { await api(`/quotes/${q.id}/status`, { status: st }); const rr = await api(`/quotes/${q.id}`); setQ(rr.quote); toast(`Marked ${Q_STATUS[st].toLowerCase()}.`); reloadAll(); } catch (e) { toast(e.message); }
  };
  const copyQuote = async () => { try { const x = await api(`/quotes/${q.id}/copy`, {}); toast(`Copied to ${x.number}.`); reloadAll(); open("quote", x.id); } catch (e) { toast(e.message); } };
  const removeQuote = async () => { if (!window.confirm(`Delete draft ${q.number}?`)) return; try { await api(`/quotes/${q.id}/remove`, {}); toast("Deleted."); reloadAll(); open("quotes"); } catch (e) { toast(e.message); } };
  const doPrint = () => {
    const cl = client || d.clients.find(c => c.id === form.clientId);
    if (!cl) return toast("Pick the client first.");
    const pq = q && !(q.status === "draft") ? q : { number: q?.number || "DRAFT", createdAt: q?.createdAt || new Date().toISOString(), validUntil: q?.validUntil || new Date(Date.now() + useBook.quoteValidDays * 864e5).toISOString().slice(0, 10),
      title: form.title, notes: form.notes, inputs: i, result: r, book: useBook, createdBy: q?.createdBy || "" };
    printHtml(() => quoteHtml(pq, cl, { draft: !q || q.status === "draft" }));
  };
  const addonsHere = useBook.addons.filter(a => a.segments.includes(i.segment));
  const spend = i.currentSpend || [];
  const row = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 10 };
  return <>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <h1 style={h1}>{q ? q.number : "New quote"}</h1>{q && <Pill color={Q_COLOR[q.status]}>{Q_STATUS[q.status]}</Pill>}<span style={{ flex: 1 }} />
      <button type="button" style={btn("ghost")} onClick={doPrint}><Printer size={14} /> {q && !locked ? "Print draft" : locked ? "Print quote" : "Preview"}</button>
      {!locked && d.rights.canEdit && <button type="button" style={btn("primary")} disabled={busy || !form.clientId} onClick={save}><Save size={14} /> {q ? "Save" : "Save quote"}</button>}
      {q?.status === "draft" && d.rights.canEdit && <button type="button" style={btn("primary")} onClick={async () => { await save(); await status("sent"); }}><Send size={14} /> Mark sent</button>}
      {q?.status === "sent" && d.rights.canEdit && <>
        <button type="button" style={{ ...btn("primary"), background: GREEN }} onClick={() => status("accepted")}><Check size={14} /> Accepted</button>
        <button type="button" style={btn("ghost")} onClick={() => status("declined")}><X size={14} /> Declined</button>
        <button type="button" style={btn("ghost")} onClick={() => status("draft")}>Back to draft</button></>}
      {q && d.rights.canEdit && <button type="button" style={btn("ghost")} onClick={copyQuote}><Copy size={14} /> Copy</button>}
      {q?.status === "draft" && d.rights.canEdit && <button type="button" aria-label="Delete draft" style={{ ...btn("ghost"), color: RED }} onClick={removeQuote}><Trash2 size={14} /></button>}
    </div>
    {locked && <div style={{ ...cardStyle, background: "#FFF7EF", borderColor: "#FFD9B8", marginBottom: 12, fontSize: 13 }}>This quote was {Q_STATUS[q.status].toLowerCase()}{q.sentAt ? ` (sent ${fmtDay(q.sentAt)})` : ""}, so its prices are fixed as quoted. Use <b>Copy</b> to revise it with today's price book.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(300px, 1fr)", gap: 14, alignItems: "start" }} className="sales-builder">
      <fieldset disabled={locked || !d.rights.canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Card title="Who it's for">
          <div style={row}>
            <Field label="Client"><select aria-label="Client" value={form.clientId} onChange={e => { const c = d.clients.find(x => x.id === e.target.value); setClient(c || null); setForm(f => ({ ...f, clientId: e.target.value, inputs: { ...f.inputs, currentSpend: f.inputs.currentSpend?.length ? f.inputs.currentSpend : c?.currentSpend || [] } })); }} style={inp}>
              <option value="">Pick a client…</option>{d.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Quote title"><input aria-label="Quote title" placeholder={r ? `${r.edition.label} for …` : ""} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={inp} /></Field>
          </div>
          <div style={row}>
            <Choice label="Market" value={i.segment} options={Object.entries(useBook.segments).map(([k, s]) => ({ key: k, label: s.label }))} onChange={setSeg} />
            <Num label={i.segment === "ps" ? "Users per agency" : "Users per company"} value={i.users} onChange={v => set("users", v)} min={1} />
            <Num label={i.segment === "ps" ? "Agencies in the group" : "Companies in the family"} value={i.members} onChange={v => set("members", v)} min={1} />
            <Choice label="Delivery" value={i.delivery} options={[{ key: "hosted", label: "Hosted by Avexon" }, { key: "onprem", label: "On-premises license" }]} onChange={v => set("delivery", v)} />
          </div>
          {!!d.clients.length && !form.clientId && <div style={{ fontSize: 12.5, color: ORANGE }}>Pick the client to save the quote. You can price it first.</div>}
          {!d.clients.length && <div style={{ fontSize: 12.5, color: ORANGE }}>Add the client on the Clients page to save a quote.</div>}
        </Card>
        <Card title="Edition">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            {seg.editions.map(e => { const on = e.key === i.edition, sz = sizeFor(seg, Number(i.users) || 1);
              return <button key={e.key} type="button" aria-pressed={on} onClick={() => set("edition", e.key)} style={{ textAlign: "left", font: "inherit", cursor: "pointer", borderRadius: 10, padding: 10,
                border: `2px solid ${on ? "#FF7900" : LINE}`, background: on ? "#FFF7EF" : "#fff", color: INK }}>
                <b>{e.label}</b><div style={{ fontSize: 13, fontWeight: 700, color: ORANGE }}>{i.segment === "biz" ? `${money(e.perUserMonth)}/user/mo` : `${money(e.prices[sz.key])}/yr`}</div>
                <div style={{ fontSize: 12, color: SOFT }}>{e.blurb}</div><div style={{ fontSize: 11.5, color: SOFT, marginTop: 4 }}>{e.modules.length} modules{e.includesTraining ? " · training environment" : ""}</div></button>; })}
          </div>
          {addonsHere.length > 0 && <><div style={{ ...lbl, marginTop: 12 }}>Add-ons</div>
            <div style={{ display: "grid", gap: 6 }}>{addonsHere.map(a => { const inEd = a.module && seg.editions.find(e => e.key === i.edition)?.modules.includes(a.module);
              const on = (i.addons || []).includes(a.key);
              return <label key={a.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, opacity: inEd ? 0.5 : 1 }}>
                <input type="checkbox" disabled={inEd} checked={on || !!inEd} onChange={e => set("addons", e.target.checked ? [...(i.addons || []), a.key] : (i.addons || []).filter(k => k !== a.key))} />
                <span style={{ flex: 1 }}><b>{a.label}</b> <span style={{ color: SOFT, fontSize: 12 }}>{inEd ? "included in this edition" : a.note}</span></span>
                {a.perUnit && on && <input aria-label="How many blocks of 5" type="number" min={0} value={i.screens} onChange={e => set("screens", Number(e.target.value))} style={{ ...inp, width: 70 }} />}</label>; })}</div></>}
        </Card>
        <Card title="Service">
          <div style={row}>
            <Choice label="Environments" value={i.environments} options={useBook.environments} onChange={v => set("environments", v)} />
            <Choice label="Disaster recovery" value={i.dr} options={useBook.dr.map(x => ({ key: x.key, label: `${x.label} (${x.rto} / ${x.rpo})${x.pct ? ` +${Math.round(x.pct * 100)}%` : ""}` }))} onChange={v => set("dr", v)} />
            <Choice label="Support" value={i.support} options={useBook.support.map(x => ({ key: x.key, label: `${x.label} (${x.critical})` }))} onChange={v => set("support", v)} />
            <Choice label="Term" value={String(i.termYears)} options={useBook.terms.map(t => ({ key: String(t.years), label: `${t.label}${t.discount ? ` (−${Math.round(t.discount * 100)}%)` : ""}` }))} onChange={v => set("termYears", Number(v))} />
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5 }}>
            <label><input type="checkbox" checked={!!i.founding} onChange={e => set("founding", e.target.checked)} /> {useBook.founding.label} ({Math.round(useBook.founding.pct * 100)}% for {useBook.founding.years} years)</label>
            <label><input type="checkbox" checked={i.implementation !== false} onChange={e => set("implementation", e.target.checked)} /> Implementation fee</label></div>
        </Card>
        {i.delivery !== "onprem" && <Card title={`Hosting and compute (${useBook.seller?.partner || "Avexon"})`}>
          <p style={{ fontSize: 12.5, color: SOFT, marginTop: 0 }}>Not part of Fenmorix's price. {useBook.seller?.partner || "Avexon"} sizes it from the users, the data kept and the recovery tier, and bills it themselves. Enter their figures when you have them: they print as a separate section and count in the savings comparison. Left blank, the quote says hosting is quoted separately.</p>
          <div style={row}>
            <Num label="Their yearly price" value={i.hostingAnnual} onChange={v => set("hostingAnnual", v)} />
            <Num label="Their one-time setup" value={i.hostingOneTime} onChange={v => set("hostingOneTime", v)} />
            <Field label="Their quote (reference or note)"><input aria-label="Hosting note" value={i.hostingNote || ""} onChange={e => set("hostingNote", e.target.value)} style={inp} /></Field>
          </div></Card>}
        <Card title="CAD connection">
          {(() => { const c = { existing: 2500, new: useBook.oneTime.cadIntegration ?? 7500, includedViews: 2, extraView: 1500, ...(useBook.oneTime.cad || {}) };
            const kind = i.cadKind && i.cadKind !== "none" ? i.cadKind : Number(i.cadIntegrations) > 0 ? "new" : "none";
            return <>
              <div role="radiogroup" aria-label="CAD connection" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 10 }}>
                {[["none", "No CAD connection", "Active calls and call statistics stay off, or come from uploaded reports."],
                  ["existing", `Views already exist · ${money(c.existing)}`, `A CAD we already have SQL views for (same vendor, or a shared regional CAD already connected). ${money(c.new - c.existing)} less than a new one.`],
                  ["new", `New CAD vendor · ${money(c.new)}`, "A CAD not connected before: map its database, build and test the views."]].map(([k, t, d]) =>
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setForm(f => ({ ...f, inputs: { ...f.inputs, cadKind: k, cadIntegrations: 0 } }))}
                    style={{ textAlign: "left", font: "inherit", cursor: "pointer", borderRadius: 10, padding: 10, border: `2px solid ${kind === k ? "#FF7900" : LINE}`, background: kind === k ? "#FFF7EF" : "#fff", color: INK }}>
                    <b>{t}</b><div style={{ fontSize: 12, color: SOFT }}>{d}</div></button>)}
              </div>
              {kind !== "none" && <div style={row}>
                <Field label="CAD system"><input aria-label="CAD system" placeholder="e.g. CentralSquare Enterprise" value={i.cadVendor || ""} onChange={e => set("cadVendor", e.target.value)} style={inp} /></Field>
                <Num label="How many CAD systems" value={i.cadSystems || 1} onChange={v => set("cadSystems", v)} min={1} />
              </div>}
              <div style={row}>
                <Num label={`More standard views (${money(c.extraView)} each)`} value={i.cadExtraViews} onChange={v => set("cadExtraViews", v)} />
                <Num label={`Custom views, hours ($${useBook.hourly.custom}/h)`} value={i.cadCustomHours} onChange={v => set("cadCustomHours", v)} step={0.5} />
              </div>
              <div style={{ fontSize: 12, color: SOFT }}>Included: {c.includedViews} standard views (active calls and call statistics). More standard views: apparatus and unit times, a master incident list for reports. Anything the customer designs is custom.</div>
            </>; })()}
        </Card>
        <Card title="One-time services and extras">
          <div style={row}>
            <Num label="Data migration hours" value={i.migrationHours} onChange={v => set("migrationHours", v)} step={0.5} />
            <Num label="On-site training days" value={i.trainingDays} onChange={v => set("trainingDays", v)} step={0.5} />
            <Num label={`Prepaid ${useBook.hourly.prepaidHours}-hour blocks`} value={i.prepaidBlocks} onChange={v => set("prepaidBlocks", v)} />
            <Num label="Extra discount %" value={i.manualDiscount} onChange={v => set("manualDiscount", v)} />
          </div>
          <div style={lbl}>Custom lines (custom work, integrations, anything else)</div>
          {(i.customLines || []).map((c, k) => <div key={k} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 6, marginBottom: 6 }}>
            <input aria-label={`Custom line ${k + 1}`} placeholder="Description" value={c.label} onChange={e => set("customLines", i.customLines.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} style={inp} />
            <input aria-label={`Custom line ${k + 1} amount`} type="number" value={c.amount || ""} onChange={e => set("customLines", i.customLines.map((x, j) => (j === k ? { ...x, amount: Number(e.target.value) } : x)))} style={inp} />
            <select aria-label={`Custom line ${k + 1} kind`} value={c.kind} onChange={e => set("customLines", i.customLines.map((x, j) => (j === k ? { ...x, kind: e.target.value } : x)))} style={inp}><option value="once">One time</option><option value="annual">Every year</option></select>
            <button type="button" aria-label="Remove line" style={btn("ghost")} onClick={() => set("customLines", i.customLines.filter((_, j) => j !== k))}><X size={14} /></button></div>)}
          <button type="button" style={btn("ghost")} onClick={() => set("customLines", [...(i.customLines || []), { label: "", amount: 0, kind: "once" }])}><Plus size={13} /> Add a line</button>
        </Card>
        <Card title="Software it replaces">
          {spend.map((s, k) => <div key={k} style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6, marginBottom: 6 }}>
            <input aria-label={`Replaces ${k + 1}`} placeholder="Product" value={s.label} onChange={e => set("currentSpend", spend.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} style={inp} />
            <input aria-label={`Replaces ${k + 1} per year`} type="number" placeholder="Per year" value={s.annual || ""} onChange={e => set("currentSpend", spend.map((x, j) => (j === k ? { ...x, annual: Number(e.target.value) } : x)))} style={inp} />
            <button type="button" aria-label="Remove" style={btn("ghost")} onClick={() => set("currentSpend", spend.filter((_, j) => j !== k))}><X size={14} /></button></div>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={btn("ghost")} onClick={() => set("currentSpend", [...spend, { label: "", annual: 0 }])}><Plus size={13} /> Add software</button>
            {(useBook.marketRates || []).length > 0 && <select aria-label="Add a typical cost" value="" style={{ ...inp, width: "auto", maxWidth: 360 }}
              onChange={e => { const rate = useBook.marketRates.find(m => m.key === e.target.value); const l = marketLine(rate, (Number(i.users) || 1) * (Number(i.members) || 1), r?.size?.key || "m");
                if (l) set("currentSpend", [...spend, { label: l.label + " (typical)", annual: l.annual }]); }}>
              <option value="">Add a typical cost…</option>
              {useBook.marketRates.map(m => <option key={m.key} value={m.key} title={m.source}>{m.label}{m.basis === "user" ? ` · ${money(m.annual, m.annual % 1 !== 0)}/user/yr` : ""}</option>)}
            </select>}
          </div>
          <div style={{ fontSize: 11.5, color: SOFT, marginTop: 6 }}>Typical costs come from public contracts and published prices (Price book › Typical competitor costs). Replace them with the customer's real invoices when you have them.</div>
        </Card>
        <Card title="Notes">
          <Field label="On the quote (the customer sees this)"><textarea aria-label="Quote notes" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={inp} /></Field>
          <Field label="Internal (never printed)" style={{ marginTop: 8 }}><textarea aria-label="Internal notes" rows={2} value={form.internalNotes} onChange={e => setForm(f => ({ ...f, internalNotes: e.target.value }))} style={inp} /></Field>
        </Card>
      </fieldset>
      <div style={{ position: "sticky", top: 12 }}>{r && <Summary r={r} />}</div>
    </div>
    <style>{`@media (max-width: 980px) { .sales-builder { grid-template-columns: 1fr !important; } }`}</style>
  </>;
}
function Summary({ r }) {
  const L = (lines) => lines.map((l, k) => <div key={k} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "3px 0", color: l.amount < 0 ? GREEN : INK }}><span style={{ flex: 1 }}>{l.label}</span><b>{money(l.amount)}</b></div>);
  const on = r.onPremQuote;
  return <section aria-label="Price summary" style={{ ...cardStyle, borderTop: "4px solid #FF7900" }}>
    <div style={{ fontSize: 12, fontWeight: 800, color: SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{r.segmentLabel} · {r.edition.label} · {r.size.label}</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
      {on ? <><Kpi label="License, once" value={money(on.license)} /><Kpi label="Maintenance / yr" value={money(on.yearly)} /></>
        : <><Kpi label="Year one" value={money(r.year1Recurring)} sub={`${money(r.perUserMonth, true)} per user / month`} /><Kpi label="One-time" value={money(r.oneTimeTotal)} /></>}
      <Kpi label={`${r.term.label} total`} value={money(r.contractValue)} />
      {r.savings ? <Kpi label={r.savings.hostingUnknown ? "Saves a year, before hosting" : "Saves a year"} value={money(r.savings.yearly)} sub={`${Math.round(r.savings.pct * 100)}% of ${money(r.savings.replaced)}`} color={r.savings.yearly >= 0 ? GREEN : RED} /> : <Kpi label="Users" value={r.totalUsers} />}
    </div>
    {!on && <><div style={lbl}>Yearly</div>{L(r.lines.recurring)}<div style={{ display: "flex", fontSize: 12.5, borderTop: `1px solid ${LINE}`, paddingTop: 3 }}><span style={{ flex: 1 }}>List per year</span><b>{money(r.listAnnual)}</b></div>{L(r.lines.yearly)}{L(r.lines.customAnnual || [])}</>}
    {r.lines.once.length > 0 && <><div style={{ ...lbl, marginTop: 8 }}>One time</div>{L(r.lines.once)}</>}
    <div style={{ ...lbl, marginTop: 8 }}>Year by year</div>
    {r.schedule.map(s => <div key={s.year} style={{ display: "flex", fontSize: 12.5, color: s.inTerm ? INK : SOFT }}><span style={{ flex: 1 }}>Year {s.year}{s.inTerm ? "" : " (renewal)"}</span><b>{money(s.total)}</b></div>)}
    {r.hosting?.known && <><div style={{ ...lbl, marginTop: 8 }}>{r.hosting.partner} hosting (separate)</div>
      {r.hosting.annual > 0 && <div style={{ display: "flex", fontSize: 12.5 }}><span style={{ flex: 1 }}>Per year</span><b>{money(r.hosting.annual)}</b></div>}
      {r.hosting.oneTime > 0 && <div style={{ display: "flex", fontSize: 12.5 }}><span style={{ flex: 1 }}>Setup</span><b>{money(r.hosting.oneTime)}</b></div>}</>}
    {r.notes.map((n, k) => <div key={k} style={{ fontSize: 12, color: ORANGE, marginTop: 6 }}>{n}</div>)}
  </section>;
}

// ---------------------------------------------------------------- Quotes list
function QuotesPage({ d, open }) {
  const [st, setSt] = useState("all");
  const list = d.quotes.filter(q => st === "all" || q.status === st);
  return <>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}><h1 style={h1}>Quotes</h1><span style={{ flex: 1 }} />
      <select aria-label="Show quotes" value={st} onChange={e => setSt(e.target.value)} style={{ ...inp, width: 160 }}><option value="all">All quotes</option>{Object.entries(Q_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {d.rights.canEdit && <button type="button" style={btn("primary")} onClick={() => open("new")}><FilePlus2 size={14} /> New quote</button>}</div>
    <Card><QuoteTable quotes={list} open={open} /></Card></>;
}

// ---------------------------------------------------------------- Spec sheets
function SpecSheets({ book }) {
  const [seg, setSeg] = useState("ps"), [ed, setEd] = useState("operations"), [prices, setPrices] = useState(false);
  const s = book.segments[seg];
  return <>
    <h1 style={{ ...h1, marginBottom: 6 }}>Spec sheets</h1>
    <p style={{ color: SOFT, marginTop: 0, maxWidth: 760 }}>One page per edition for a customer: the modules it includes, add-ons, recovery and support options, and the platform. Leave prices off to hand it out freely.</p>
    <Card>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <Choice label="Market" value={seg} options={Object.entries(book.segments).map(([k, x]) => ({ key: k, label: x.label }))} onChange={v => { setSeg(v); setEd(book.segments[v].editions[0].key); }} />
        <Choice label="Edition" value={ed} options={s.editions} onChange={setEd} />
        <label style={{ fontSize: 13.5, paddingBottom: 8 }}><input type="checkbox" checked={prices} onChange={e => setPrices(e.target.checked)} /> Show prices</label>
        <button type="button" style={btn("primary")} onClick={() => printHtml(() => specHtml(book, seg, ed, { prices }))}><Printer size={14} /> Print spec sheet</button></div>
      {prices && (() => { const pr = specPrices(book, seg, ed); return <div style={{ marginTop: 14, overflowX: "auto" }} role="region" aria-label="Spec sheet prices">
        <table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr>{pr.head.map((h, i) => <th key={i} style={{ ...th, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
          <tbody>{pr.rows.map((r, k) => <tr key={k}>{r.map((c, i) => <td key={i} style={i ? tdn : td}>{i ? c : <b>{c}</b>}</td>)}</tr>)}</tbody></table>
        <div style={{ fontSize: 12, color: SOFT, marginTop: 4 }}>{pr.note}</div></div>; })()}
      <div style={{ ...lbl, marginTop: 16 }}>Preview: exactly what prints</div>
      <iframe title="Spec sheet preview" srcDoc={specHtml(book, seg, ed, { prices })} style={{ width: "100%", maxWidth: 860, height: 1100, border: `1px solid ${LINE}`, borderRadius: 8, background: "#fff" }} />
    </Card></>;
}

// ---------------------------------------------------------------- Price book
function BookEditor({ toast, book, setBook, canManage }) {
  const [b, setB] = useState(() => structuredClone(book)), [json, setJson] = useState(""), [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(b) !== JSON.stringify(book);
  const upd = fn => setB(x => { const y = structuredClone(x); fn(y); return y; });
  const save = async (val = b) => { setBusy(true); try { const r = await api("/book", { book: val }); setBook(r.book); setB(structuredClone(r.book)); toast("Price book saved. New quotes use it; sent quotes keep their prices."); } catch (e) { toast(e.message); } setBusy(false); };
  const reset = async () => { if (!window.confirm("Put every price back to the defaults?")) return; try { const r = await api("/book/reset", {}); setBook(r.book); setB(structuredClone(r.book)); toast("Back to the defaults."); } catch (e) { toast(e.message); } };
  const pctIn = (label, get, put) => <Num label={label} value={Math.round(get() * 1000) / 10} step={0.5} onChange={v => upd(y => put(y, (Number(v) || 0) / 100))} />;
  const n = (label, get, put, step = 1) => <Num label={label} value={get()} step={step} onChange={v => upd(y => put(y, Number(v) || 0))} />;
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 };
  return <fieldset disabled={!canManage} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}><h1 style={h1}>Price book</h1><span style={{ flex: 1 }} />
      {canManage && <button type="button" style={btn("ghost")} onClick={reset}>Reset to defaults</button>}
      {canManage && <button type="button" style={btn("primary")} disabled={!dirty || busy} onClick={() => save()}><Save size={14} /> Save price book</button>}</div>
    <p style={{ color: SOFT, marginTop: 0, maxWidth: 820 }}>Every number the calculator uses. Saved quotes keep the book they were priced with, so changing a price here never changes a quote you've sent.</p>
    {Object.entries(b.segments).map(([sk, s]) => <Card key={sk} title={`${s.label} editions`}>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Edition</th>
        {sk === "biz" ? <><th style={th}>Per user / month</th><th style={th}>Yearly minimum</th></> : s.sizes.map(z => <th key={z.key} style={th}>{z.label} (≤ {z.upTo} users) / yr</th>)}</tr></thead>
        <tbody>{s.editions.map((e, k) => <tr key={e.key}><td style={td}><input aria-label={`${s.label} edition ${k + 1} name`} value={e.label} onChange={ev => upd(y => { y.segments[sk].editions[k].label = ev.target.value; })} style={inp} /></td>
          {sk === "biz" ? <><td style={td}><input aria-label={`${e.label} per user`} type="number" value={e.perUserMonth} onChange={ev => upd(y => { y.segments[sk].editions[k].perUserMonth = Number(ev.target.value); })} style={inp} /></td>
            <td style={td}><input aria-label={`${e.label} minimum`} type="number" value={e.minYear} onChange={ev => upd(y => { y.segments[sk].editions[k].minYear = Number(ev.target.value); })} style={inp} /></td></>
            : s.sizes.map(z => <td key={z.key} style={td}><input aria-label={`${e.label} ${z.label}`} type="number" value={e.prices[z.key]} onChange={ev => upd(y => { y.segments[sk].editions[k].prices[z.key] = Number(ev.target.value); })} style={inp} /></td>)}</tr>)}
          <tr><td style={td}><b>Implementation (one time)</b></td>{sk === "biz" ? <td style={td} colSpan={2}><div style={{ display: "flex", gap: 6 }}>{s.sizes.map(z => <input key={z.key} aria-label={`${s.label} implementation ${z.label}`} title={z.label} type="number" value={s.implementation[z.key]} onChange={ev => upd(y => { y.segments[sk].implementation[z.key] = Number(ev.target.value); })} style={inp} />)}</div></td>
            : s.sizes.map(z => <td key={z.key} style={td}><input aria-label={`${s.label} implementation ${z.label}`} type="number" value={s.implementation[z.key]} onChange={ev => upd(y => { y.segments[sk].implementation[z.key] = Number(ev.target.value); })} style={inp} /></td>)}</tr>
        </tbody></table></div></Card>)}
    <Card title="Add-ons (per year: small / mid / large)">
      {b.addons.map((a, k) => <div key={a.key} style={{ display: "grid", gridTemplateColumns: "2fr repeat(3, 1fr)", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <span style={{ fontSize: 13.5 }}><b>{a.label}</b></span>
        {["s", "m", "l"].map(z => <input key={z} aria-label={`${a.label} ${z}`} type="number" value={a.prices[z]} onChange={ev => upd(y => { y.addons[k].prices[z] = Number(ev.target.value); })} style={inp} />)}</div>)}
    </Card>
    <Card title="Percentages (of the yearly software price)">
      <p style={{ fontSize: 12.5, color: SOFT, marginTop: 0 }}>Hosting, compute and the servers behind each recovery tier are {b.seller?.partner || "Avexon"}'s and priced by them. A recovery fee here is only Fenmorix's own work for that tier (0 = none).</p>
      <div style={grid}>
        {b.environments.filter(e => e.key !== "none").map(e => pctIn(e.label, () => e.pct, (y, v) => { y.environments.find(x => x.key === e.key).pct = v; }))}
        {b.dr.filter(e => e.key !== "standard").map(e => pctIn(`Fenmorix fee, ${e.label} recovery`, () => e.pct, (y, v) => { y.dr.find(x => x.key === e.key).pct = v; }))}
        {b.support.filter(e => e.key !== "standard").map(e => pctIn(`Support: ${e.label}`, () => e.pct, (y, v) => { y.support.find(x => x.key === e.key).pct = v; }))}
      </div></Card>
    <Card title="Terms and discounts">
      {b.terms.map((t, k) => <div key={t.years} style={{ ...grid, marginBottom: 8 }}><b style={{ alignSelf: "end", paddingBottom: 8 }}>{t.label}</b>
        {pctIn("Discount %", () => t.discount, (y, v) => { y.terms[k].discount = v; })}
        {n("Price lock (years)", () => t.lockYears, (y, v) => { y.terms[k].lockYears = v; })}
        {pctIn("Yearly increase after %", () => t.escalator, (y, v) => { y.terms[k].escalator = v; })}</div>)}
      <div style={grid}>{pctIn(`${b.founding.label} %`, () => b.founding.pct, (y, v) => { y.founding.pct = v; })}{n("…for years", () => b.founding.years, (y, v) => { y.founding.years = v; })}
        {n("Quote valid (days)", () => b.quoteValidDays, (y, v) => { y.quoteValidDays = v; })}</div></Card>
    <Card title="One-time, hourly, on-premises">
      <div style={grid}>
        {n("CAD: views already exist", () => (b.oneTime.cad || {}).existing ?? 2500, (y, v) => { y.oneTime.cad = { ...CAD_DEFAULT, ...(y.oneTime.cad || {}), existing: v }; })}
        {n("CAD: new vendor", () => (b.oneTime.cad || {}).new ?? b.oneTime.cadIntegration ?? 7500, (y, v) => { y.oneTime.cad = { ...CAD_DEFAULT, ...(y.oneTime.cad || {}), new: v }; y.oneTime.cadIntegration = v; })}
        {n("CAD: each extra standard view", () => (b.oneTime.cad || {}).extraView ?? 1500, (y, v) => { y.oneTime.cad = { ...CAD_DEFAULT, ...(y.oneTime.cad || {}), extraView: v }; })}
        {n("Migration $/hour", () => b.oneTime.migrationHourly, (y, v) => { y.oneTime.migrationHourly = v; })}
        {n("Training day", () => b.oneTime.trainingDay, (y, v) => { y.oneTime.trainingDay = v; })}
        {n("Group setup", () => b.oneTime.groupSetup, (y, v) => { y.oneTime.groupSetup = v; })}
        {pctIn("Each extra member's implementation %", () => b.oneTime.additionalMemberImplementation, (y, v) => { y.oneTime.additionalMemberImplementation = v; })}
        {n("Custom work $/hour", () => b.hourly.custom, (y, v) => { y.hourly.custom = v; })}
        {n("Prepaid block hours", () => b.hourly.prepaidHours, (y, v) => { y.hourly.prepaidHours = v; })}
        {n("Prepaid $/hour", () => b.hourly.prepaidRate, (y, v) => { y.hourly.prepaidRate = v; })}
        {n("On-prem license × yearly", () => b.onPrem.licenseMultiple, (y, v) => { y.onPrem.licenseMultiple = v; }, 0.05)}
        {pctIn("On-prem maintenance %", () => b.onPrem.maintenancePct, (y, v) => { y.onPrem.maintenancePct = v; })}
      </div></Card>
    <Card title="Typical competitor costs">
      <p style={{ fontSize: 12.5, color: SOFT, marginTop: 0 }}>What departments pay today, from public contracts and published prices. The quote builder's "Add a typical cost" uses these. Per-user rates are multiplied by the quote's users; flat rates use the quote's size.</p>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th style={th}>Product</th><th style={th}>Basis</th><th style={th}>Small</th><th style={th}>Mid</th><th style={th}>Large</th><th style={th}>Source</th></tr></thead>
        <tbody>{(b.marketRates || []).map((m, k) => <tr key={m.key}><td style={td}><b>{m.label}</b><div style={{ fontSize: 11.5, color: SOFT }}>Replaced by: {m.replaces}</div></td>
          <td style={td}>{m.basis === "user" ? "per user / yr" : "per year"}</td>
          {m.basis === "user" ? <td style={td} colSpan={3}><input aria-label={`${m.label} per user`} type="number" step="0.01" value={m.annual} onChange={e => upd(y => { y.marketRates[k].annual = Number(e.target.value); })} style={{ ...inp, width: 110 }} /></td>
            : ["s", "m", "l"].map(z => <td key={z} style={td}><input aria-label={`${m.label} ${z}`} type="number" value={m.annual[z]} onChange={e => upd(y => { y.marketRates[k].annual[z] = Number(e.target.value); })} style={{ ...inp, width: 100 }} /></td>)}
          <td style={{ ...td, fontSize: 11.5, color: SOFT, maxWidth: 320 }}>{m.source}{m.setup ? ` · setup ${money(m.setup.m)}` : ""}</td></tr>)}</tbody></table></div>
    </Card>
    <Card title="Groups">
      <div style={grid}>
        {b.group.discounts.map((g, k) => pctIn(`${g.min}+ agencies %`, () => g.pct, (y, v) => { y.group.discounts[k].pct = v; }))}
        {b.group.platformFees.map((g, k) => n(`Platform fee, ${g.min}+ agencies`, () => g.fee, (y, v) => { y.group.platformFees[k].fee = v; }))}
        {n("Family: $/company/month", () => b.group.familyPerCompanyMonth, (y, v) => { y.group.familyPerCompanyMonth = v; })}
        {b.group.familyDiscounts.map((g, k) => pctIn(`${g.min}+ companies %`, () => g.pct, (y, v) => { y.group.familyDiscounts[k].pct = v; }))}
      </div></Card>
    <Card title="On every quote">
      <div style={grid}>{["name", "contact", "email", "phone", "web", "partner", "partnerEmail"].map(k => <Field key={k} label={{ name: "Company", contact: "Your name", email: "Email", phone: "Phone", web: "Website", partner: "Hosting partner", partnerEmail: "Partner email" }[k]}>
        <input aria-label={`Seller ${k}`} value={b.seller?.[k] || ""} onChange={e => upd(y => { y.seller = { ...(y.seller || {}), [k]: e.target.value }; })} style={inp} /></Field>)}</div>
      <Field label="Payment terms" style={{ marginTop: 10 }}><textarea aria-label="Payment terms" rows={2} value={b.paymentTerms} onChange={e => upd(y => { y.paymentTerms = e.target.value; })} style={inp} /></Field>
      <div style={{ ...lbl, marginTop: 12 }}>Terms and conditions (printed on every quote)</div>
      <div style={{ fontSize: 12.5, color: ORANGE, marginBottom: 8 }}>Starting language only: have an attorney review these before a customer signs.</div>
      {b.termsSections.map((t, k) => <div key={k} style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: 6, marginBottom: 6 }}>
        <input aria-label={`Term ${k + 1} title`} value={t.title} onChange={e => upd(y => { y.termsSections[k].title = e.target.value; })} style={inp} />
        <textarea aria-label={`Term ${k + 1} text`} rows={3} value={t.body} onChange={e => upd(y => { y.termsSections[k].body = e.target.value; })} style={inp} />
        <button type="button" aria-label="Remove term" style={btn("ghost")} onClick={() => upd(y => { y.termsSections.splice(k, 1); })}><X size={14} /></button></div>)}
      <button type="button" style={btn("ghost")} onClick={() => upd(y => { y.termsSections.push({ title: "New section", body: "" }); })}><Plus size={13} /> Add a section</button>
    </Card>
    {canManage && <Card title="Everything else (advanced)">
      <p style={{ fontSize: 12.5, color: SOFT, marginTop: 0 }}>The whole book as JSON: edition blurbs and module lists, size limits, recovery and support wording. Load, edit, apply, then save.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}><button type="button" style={btn("ghost")} onClick={() => setJson(JSON.stringify(b, null, 2))}>Load</button>
        <button type="button" style={btn("ghost")} disabled={!json} onClick={() => { try { setB(JSON.parse(json)); toast("Applied. Save the price book to keep it."); } catch { toast("That JSON has a mistake in it."); } }}>Apply</button></div>
      {json && <textarea aria-label="Price book JSON" rows={18} value={json} onChange={e => setJson(e.target.value)} style={{ ...inp, fontFamily: "ui-monospace, monospace", fontSize: 12 }} />}
    </Card>}
  </fieldset>;
}

// ---------------------------------------------------------------- Module
export default function SalesModule({ onBack, initial }) {
  const [d, setD] = useState(null), [book, setBook] = useState(null), [msg, setMsg] = useState("");
  const [view, setView] = useState(() => initial?.clientId ? { page: "client", id: initial.clientId, init: { ticket: initial.ticket }, t: Date.now() } : { page: "overview" }), [clientEdit, setClientEdit] = useState(null);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const load = () => api("").then(setD, e => toast(e.message));
  useEffect(() => { load(); api("/book").then(r => setBook(r.book), e => toast(e.message)); }, []);
  const open = (page, id, init) => { setClientEdit(null); setView({ page, id, init, t: Date.now() }); window.scrollTo?.(0, 0); };
  const nav = [{ key: "overview", label: "Overview", icon: LayoutDashboard }, { key: "clients", label: "Clients", icon: Building2, badge: 0 },
    { key: "quotes", label: "Quotes", icon: FileText }, ...(d?.rights.canEdit ? [{ key: "new", label: "New quote", icon: FilePlus2 }] : []),
    { key: "specs", label: "Spec sheets", icon: Printer, group: "Sales tools" }, { key: "book", label: "Price book", icon: BookOpen, group: "Sales tools" },
    ...(d?.rights.canManage ? [{ key: "installs", label: "Installations", icon: Server, group: "Updates" }, { key: "releases", label: "Releases", icon: Send, group: "Updates" }] : [])];
  const active = view.page === "client" ? "clients" : view.page === "quote" ? "quotes" : view.page;
  return <AppShell section="Clients & Quotes" nav={nav} active={active} onNav={k => open(k)} onHome={onBack}>
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "8px 16px", borderRadius: 8, zIndex: 60 }}>{msg}</div>}
    {(!d || !book) && <div style={{ color: SOFT }}>Loading…</div>}
    {d && book && clientEdit && <ClientEditor client={clientEdit.id ? clientEdit : null} toast={toast} onCancel={() => setClientEdit(null)} onDone={(id, m) => { setClientEdit(null); toast(m); load(); open("client", id); }} />}
    {d && book && !clientEdit && <>
      {view.page === "overview" && <Overview d={d} open={open} />}
      {view.page === "clients" && <ClientsPage d={d} open={open} edit={setClientEdit} />}
      {view.page === "client" && <ClientView id={view.id} init={view.init} rights={d.rights} toast={toast} open={open} reloadAll={load} />}
      {view.page === "quotes" && <QuotesPage d={d} open={open} />}
      {(view.page === "new" || view.page === "quote") && <QuoteBuilder key={view.t} quoteId={view.page === "quote" ? view.id : null} init={view.init} d={d} book={book} toast={toast} open={open} reloadAll={load} />}
      {view.page === "specs" && <SpecSheets book={book} />}
      {view.page === "installs" && <Installations clients={d.clients} toast={toast} />}
      {view.page === "releases" && <Releases toast={toast} />}
      {view.page === "book" && <BookEditor key={JSON.stringify(book).length} book={book} setBook={setBook} toast={toast} canManage={d.rights.canManage} />}
    </>}
  </AppShell>;
}
