// Quick Links (module "links"): the websites the team uses, grouped by category; shared logins revealed on request (logged),
// copied with one click and hidden again after 30 seconds. Editors add/change links and choose who sees each one and its login.
// Server: server/links.js.
import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, KeyRound, Copy, Pencil, Plus, Trash2, Eye, Lock, Link2 } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", SAGE = "#2E7D4F";
const lbl = { fontSize: 12, fontWeight: 700, color: INK_SOFT, display: "block", marginBottom: 3 };
async function api(path, body) {
  const r = await fetch(`/api/links${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
export const fetchLinks = () => api("");
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const letter = t => (t || "?").trim()[0]?.toUpperCase() || "?";
const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); done("Copied."); } catch { done("Couldn't copy here; select and copy it by hand."); } };

// Personal links: save your own login (only you can see it)
function MyLoginForm({ link, onDone, onCancel, toast }) {
  const [f, setF] = useState({ user: "", password: "", note: "" }), [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api(`/${link.id}/my-login`, f); onDone("Your login is saved. Only you can see it."); } catch (e) { toast(e.message); } setBusy(false); };
  return <div role="group" aria-label={`Your login for ${link.title}`} style={{ marginTop: 8, padding: 10, border: `1px dashed ${LINE}`, borderRadius: 8, display: "grid", gap: 6 }}>
    <input aria-label="Your user name" autoComplete="off" placeholder="Your user name" value={f.user} onChange={e => setF(x => ({ ...x, user: e.target.value }))} style={{ ...inputStyle, margin: 0 }} />
    <input aria-label="Your password" type="password" autoComplete="new-password" placeholder="Your password" value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} style={{ ...inputStyle, margin: 0 }} />
    <div style={{ display: "flex", gap: 6 }}><button type="button" style={btn("primary")} disabled={busy || (!f.user && !f.password)} onClick={save}>Save my login</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    <div style={{ fontSize: 11.5, color: INK_SOFT }}>Stored encrypted. Only you can see it, not even the owner.</div></div>;
}

// A login, shown for 30 seconds after "Show login" (shared: logged; personal: your own)
function LoginBox({ link, toast, reload }) {
  const [s, setS] = useState(null), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  useEffect(() => { if (!s) return; const t = setTimeout(() => setS(null), 30_000); return () => clearTimeout(t); }, [s]);
  if (link.personal && (editing || !link.myLogin)) {
    if (!editing) return <button type="button" aria-label={`Save my login for ${link.title}`} style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} onClick={() => setEditing(true)}><KeyRound size={13} /> Save my login</button>;
    return <MyLoginForm link={link} toast={toast} onCancel={() => setEditing(false)} onDone={m => { setEditing(false); toast(m); reload(); }} />;
  }
  if (!link.hasLogin) return null;
  if (!link.canReveal) return <span title="This login isn't shared with you" style={{ fontSize: 12, color: INK_SOFT, display: "inline-flex", gap: 4, alignItems: "center" }}><Lock size={12} /> Login</span>;
  if (!s) return <span style={{ display: "inline-flex", gap: 4 }}><button type="button" disabled={busy} aria-label={`Show ${link.personal ? "my " : ""}login for ${link.title}`} style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }}
    onClick={async () => { setBusy(true); try { setS(await api(`/${link.id}/reveal`, {})); } catch (e) { toast(e.message); } setBusy(false); }}><KeyRound size={13} /> {link.personal ? "Show my login" : "Show login"}</button>
    {link.personal && <button type="button" style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} onClick={() => setEditing(true)}>Change</button>}</span>;
  const row = (k, v, secret) => v ? <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><span style={{ width: 70, color: INK_SOFT }}>{k}</span>
    <code style={{ background: "#F3F5F8", borderRadius: 5, padding: "2px 6px", wordBreak: "break-all" }}>{v}</code>
    <button type="button" aria-label={`Copy ${k.toLowerCase()}`} title="Copy" style={{ ...btn("ghost"), padding: "2px 6px" }} onClick={() => copy(v, toast)}><Copy size={13} /></button></div> : null;
  return <div role="group" aria-label={`Login for ${link.title}`} style={{ marginTop: 8, padding: 10, border: `1px dashed ${LINE}`, borderRadius: 8, display: "grid", gap: 4 }}>
    {row("User", s.user)}{row("Password", s.password, true)}{s.note && <div style={{ fontSize: 12.5, color: INK_SOFT }}>{s.note}</div>}
    {s.password && <div><button type="button" style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }}
      onClick={() => { copy(s.password, m => toast(m === "Copied." ? `Password copied. Paste it on ${link.title}'s sign-in page${s.user ? ` (user: ${s.user})` : ""}.` : m)); window.open(link.url, "_blank", "noopener"); }}>
      <Copy size={13} /> Copy password and open the site</button></div>}
    <div style={{ fontSize: 11.5, color: INK_SOFT }}>Hides again in 30 seconds.{link.personal ? " Only you can see this." : " Viewing a shared login is recorded."}</div></div>;
}

// Pick people and groups ([{kind, id, name}])
function WhoPicker({ label, value, onChange, people, groups, empty }) {
  const [q, setQ] = useState("");
  const opts = [...groups.map(g => ({ kind: "group", id: g.id, name: g.name, sub: `group · ${g.size}` })), ...people.map(p => ({ kind: "user", id: p.id, name: p.name }))]
    .filter(o => !value.some(v => v.id === o.id) && (!q || o.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return <div><span style={lbl}>{label}</span>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
      {value.length === 0 && <span style={{ fontSize: 12.5, color: INK_SOFT }}>{empty}</span>}
      {value.map(v => <span key={v.id} style={{ background: "#EEF2F7", borderRadius: 12, padding: "3px 4px 3px 10px", fontSize: 12.5, display: "inline-flex", gap: 4, alignItems: "center" }}>{v.name}
        <button type="button" aria-label={`Remove ${v.name}`} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT }} onClick={() => onChange(value.filter(x => x.id !== v.id))}>×</button></span>)}</div>
    <input aria-label={`${label}: add`} placeholder="Add a person or group…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, margin: 0 }} />
    {q && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, marginTop: 4, background: "#fff" }}>{opts.map(o =>
      <button type="button" key={o.id} onClick={() => { onChange([...value, { kind: o.kind, id: o.id, name: o.name }]); setQ(""); }}
        style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "6px 10px", cursor: "pointer", fontFamily: "inherit" }}>{o.name} {o.sub && <span style={{ color: INK_SOFT, fontSize: 12 }}>{o.sub}</span>}</button>)}
      {!opts.length && <div style={{ padding: "6px 10px", fontSize: 12.5, color: INK_SOFT }}>No match.</div>}</div>}
  </div>;
}

function LinkEditor({ link, categories, people, groups, onDone, onCancel, toast }) {
  const [f, setF] = useState({ title: link?.title || "", url: link?.url || "", category: link?.category || "", note: link?.note || "",
    visibleTo: link?.visibleTo || [], loginTo: link?.loginTo || [], personal: !!link?.personal });
  const [login, setLogin] = useState({ user: "", password: "", note: "" }), [clear, setClear] = useState(false), [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, id: link?.id };
      if (f.personal) delete body.login; else if (clear) body.login = { clear: true }; else if (login.user || login.password) body.login = login;
      await api("", body); onDone(link ? "Link saved." : "Link added.");
    } catch (e) { toast(e.message); }
    setBusy(false);
  };
  return <section aria-label={link ? `Edit ${link.title}` : "New link"} style={{ ...cardStyle, maxWidth: 760 }}>
    <div style={{ fontWeight: 800, fontSize: 17, color: INK, marginBottom: 10 }}>{link ? `Edit ${link.title}` : "New link"}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      <label><span style={lbl}>Name</span><input aria-label="Name" maxLength={120} value={f.title} onChange={e => set("title", e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>
      <label><span style={lbl}>Web address</span><input aria-label="Web address" placeholder="https://…" value={f.url} onChange={e => set("url", e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>
      <label><span style={lbl}>Category</span><input aria-label="Category" list="ql-cats" maxLength={60} placeholder="e.g. Suppliers" value={f.category} onChange={e => set("category", e.target.value)} style={{ ...inputStyle, margin: 0 }} />
        <datalist id="ql-cats">{categories.map(c => <option key={c} value={c} />)}</datalist></label>
      <label><span style={lbl}>Note (optional)</span><input aria-label="Note" maxLength={500} value={f.note} onChange={e => set("note", e.target.value)} style={{ ...inputStyle, margin: 0 }} /></label>
    </div>
    <div style={{ marginTop: 12 }}><WhoPicker label="Who sees this link" value={f.visibleTo} onChange={v => set("visibleTo", v)} people={people} groups={groups} empty="Everyone" /></div>
    <div style={{ fontWeight: 800, color: INK, margin: "16px 0 4px" }}><KeyRound size={15} style={{ verticalAlign: -2 }} /> Login (optional)</div>
    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginBottom: 6 }}><input type="checkbox" checked={f.personal} onChange={e => set("personal", e.target.checked)} />
      Each person has their own login for this site (they save it themselves; only they can see it)</label>
    {!f.personal && <>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>Stored encrypted. Only the people below (and master admins) can show it, and each time is recorded.
      {link?.hasLogin ? " A login is saved: leave these blank to keep it, or type a new one to replace it." : ""}</div>
    {!clear && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
      <label><span style={lbl}>User name</span><input aria-label="Login user name" autoComplete="off" value={login.user} onChange={e => setLogin(x => ({ ...x, user: e.target.value }))} style={{ ...inputStyle, margin: 0 }} /></label>
      <label><span style={lbl}>Password</span><input aria-label="Login password" type="password" autoComplete="new-password" value={login.password} onChange={e => setLogin(x => ({ ...x, password: e.target.value }))} style={{ ...inputStyle, margin: 0 }} /></label>
      <label><span style={lbl}>Login note</span><input aria-label="Login note" placeholder="e.g. PIN on the back office card" value={login.note} onChange={e => setLogin(x => ({ ...x, note: e.target.value }))} style={{ ...inputStyle, margin: 0 }} /></label></div>}
    {link?.hasLogin && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, marginTop: 8 }}><input type="checkbox" checked={clear} onChange={e => setClear(e.target.checked)} /> Remove the saved login</label>}
    {!clear && <div style={{ marginTop: 10 }}><WhoPicker label="Who can show the login" value={f.loginTo} onChange={v => set("loginTo", v)} people={people} groups={groups} empty="Only master admins" /></div>}</>}
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <button type="button" style={btn("primary")} disabled={busy || !f.title.trim() || !f.url.trim()} onClick={save}>{link ? "Save" : "Add the link"}</button>
      <button type="button" style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
  </section>;
}

export default function QuickLinksModule({ onBack }) {
  const [d, setD] = useState(null), [view, setView] = useState("all"), [edit, setEdit] = useState(null), [q, setQ] = useState(""), [msg, setMsg] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 3500); };
  const load = () => fetchLinks().then(setD, e => toast(e.message));
  useEffect(() => { load(); }, []);
  const cats = useMemo(() => [...new Set((d?.links || []).map(l => l.category || "Other"))], [d]);
  const shown = (d?.links || []).filter(l => (view === "all" || (l.category || "Other") === view) && (!q || `${l.title} ${l.url} ${l.note}`.toLowerCase().includes(q.toLowerCase())));
  const remove = async l => { if (!window.confirm(`Remove ${l.title}?`)) return; try { await api(`/${l.id}/remove`, {}); toast("Removed."); load(); } catch (e) { toast(e.message); } };
  const shellNav = [{ key: "all", label: "All links", icon: Link2 }, ...cats.map(c => ({ key: c, label: c, icon: Link2, group: "Categories", badge: 0 })),
    ...(d?.canEdit ? [{ key: "new", label: "Add a link", icon: Plus, group: "Manage" }] : [])];
  const go = k => { if (k === "new") { setEdit({}); } else { setEdit(null); setView(k); } };
  return <AppShell section="Quick Links" nav={shellNav} active={edit ? "new" : view} onNav={go} onHome={onBack}>
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "8px 16px", borderRadius: 8, zIndex: 60 }}>{msg}</div>}
    {!d && <div style={{ color: INK_SOFT }}>Loading…</div>}
    {d && edit && <LinkEditor link={edit.id ? edit : null} categories={cats} people={d.people || []} groups={d.groups || []} toast={toast}
      onCancel={() => setEdit(null)} onDone={m => { setEdit(null); toast(m); load(); }} />}
    {d && !edit && <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, color: INK }}>{view === "all" ? "Quick Links" : view}</h1><span style={{ flex: 1 }} />
        <input aria-label="Find a link" placeholder="Find a link…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, margin: 0, width: 220 }} />
        {d.canEdit && <button type="button" style={btn("primary")} onClick={() => setEdit({})}><Plus size={14} /> Add a link</button>}</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "-6px 0 12px", maxWidth: 820 }}>Logins are kept here in one safe place (encrypted, and every look at a shared one is recorded). Websites don't let another site sign you in, so to log in: <b>Show login</b>, then <b>Copy password and open the site</b> and paste. Your browser can also offer to remember it after that.</div>
      {!shown.length && <div style={{ color: INK_SOFT }}>{d.links.length ? "No links match." : d.canEdit ? "No links yet. Add the websites the team uses every day." : "No links have been shared with you yet."}</div>}
      {(view === "all" ? cats : [view]).map(c => { const list = shown.filter(l => (l.category || "Other") === c); if (!list.length) return null; return <div key={c} style={{ marginBottom: 18 }}>
        {view === "all" && <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 0 8px" }}>{c}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {list.map(l => <div key={l.id} data-link={l.title} style={{ ...cardStyle, margin: 0, padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 9, background: "#E8EDF4", color: INK, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{letter(l.title)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 800, color: INK, textDecoration: "none", display: "inline-flex", gap: 5, alignItems: "center" }}>{l.title} <ExternalLink size={13} /></a>
                <div style={{ fontSize: 12, color: INK_SOFT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hostOf(l.url)}{l.note ? ` · ${l.note}` : ""}</div></div>
              {d.canEdit && <span style={{ display: "inline-flex", gap: 2 }}>
                <button type="button" aria-label={`Edit ${l.title}`} title="Edit" style={{ ...btn("ghost"), padding: "4px 6px" }} onClick={() => setEdit(l)}><Pencil size={14} /></button>
                <button type="button" aria-label={`Remove ${l.title}`} title="Remove" style={{ ...btn("ghost"), padding: "4px 6px", color: BRICK }} onClick={() => remove(l)}><Trash2 size={14} /></button></span>}
            </div>
            <div style={{ marginTop: 6 }}><LoginBox link={l} toast={toast} reload={load} /></div>
            {d.canEdit && (l.visibleTo?.length > 0 || l.hasLogin || l.personal) && <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 6 }}>
              <Eye size={11} style={{ verticalAlign: -1 }} /> {l.visibleTo?.length ? l.visibleTo.map(v => v.name).join(", ") : "Everyone"}
              {l.personal ? <> · <KeyRound size={11} style={{ verticalAlign: -1 }} /> each person's own login</>
                : l.hasLogin && <> · <KeyRound size={11} style={{ verticalAlign: -1 }} /> {l.loginTo?.length ? l.loginTo.map(v => v.name).join(", ") : "master admins only"}</>}</div>}
          </div>)}</div></div>; })}
    </>}
  </AppShell>;
}
