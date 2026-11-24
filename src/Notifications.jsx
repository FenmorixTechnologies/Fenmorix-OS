// Notifications (core): the system notices sent to you (a requisition was approved, it's your turn to pick leave, a ticket changed...).
// Read-only. Shown in the side bar when the Messaging module isn't part of the subscription; with Messaging they're in Messages too.
// Server: messages.js handleNotices (/api/notices).
import React, { useEffect, useState } from "react";
import { Bell, Archive, Inbox, CheckCheck, Trash2, ArrowLeft } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/notices${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const when = d => new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function NotificationsModule({ onBack, initialThread }) {
  const [box, setBox] = useState("inbox"), [list, setList] = useState(null), [open, setOpen] = useState(initialThread || null), [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const load = () => call(box === "archived" ? "?box=archived" : "").then(x => setList(x.threads), e => setError(e.message));
  useEffect(() => { setList(null); load(); }, [box]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) { setItem(null); return; }
    call(`/${open}`).then(x => { setItem(x); setList(l => (l || []).map(t => (t.id === open ? { ...t, unread: false } : t))); window.dispatchEvent(new Event("sgfd-messages-changed")); }, e => { setError(e.message); setOpen(null); });
  }, [open]);
  useEffect(() => { const f = () => load(); window.addEventListener("sgfd-message", f); return () => window.removeEventListener("sgfd-message", f); }, [box]);   // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (ids, action) => { try { await call("/bulk", { ids, action }); setOpen(null); load(); window.dispatchEvent(new Event("sgfd-messages-changed")); } catch (e) { setError(e.message); } };
  const unread = (list || []).filter(t => t.unread).length;
  const nav = [{ key: "inbox", label: "Notifications", icon: Inbox, badge: box === "inbox" ? unread : 0 }, { key: "archived", label: "Archived", icon: Archive }];
  return (
    <AppShell section="Notifications" nav={nav} active={box} onNav={k => { setOpen(null); setBox(k); }} onHome={onBack}>
      <div style={{ fontSize: 24, fontWeight: 800, color: INK }}><Bell size={22} style={{ verticalAlign: -3, marginRight: 6 }} />Notifications</div>
      <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 12 }}>Updates sent to you about requests, approvals, assignments and turns. They can't be replied to.</div>
      {error && <div role="alert" style={{ ...cardStyle, color: BRICK }}>{error}</div>}
      {item ? <div style={cardStyle}>
        <button type="button" style={{ ...btn("ghost"), marginBottom: 8 }} onClick={() => setOpen(null)}><ArrowLeft size={14} /> All notifications</button>
        <article aria-label={item.subject}>
          <div style={{ fontSize: 18, fontWeight: 800, color: item.important ? BRICK : INK }}>{item.important ? "Important: " : ""}{item.subject}</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "2px 0 12px" }}>From {item.from} · {when(item.createdAt)}</div>
          {item.posts.map(p => <div key={p.id} style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.5, padding: "8px 0", borderTop: `1px solid ${LINE}` }}>{p.body}</div>)}
        </article>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" style={btn("outline")} onClick={() => act([item.id], box === "archived" ? "unarchive" : "archive")}><Archive size={14} /> {box === "archived" ? "Move back" : "Archive"}</button>
          <button type="button" style={btn("ghost")} onClick={() => act([item.id], "delete")}><Trash2 size={14} /> Delete</button></div>
      </div>
        : <div style={{ ...cardStyle, padding: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 13, color: INK_SOFT }}>{list ? `${list.length} notification${list.length === 1 ? "" : "s"}${unread ? `, ${unread} unread` : ""}` : "Loading…"}</span>
            {unread > 0 && <button type="button" style={btn("ghost")} onClick={async () => { await call("/read-all", {}); load(); window.dispatchEvent(new Event("sgfd-messages-changed")); }}><CheckCheck size={14} /> Mark all read</button>}</div>
          {list && !list.length && <div style={{ padding: 18, color: INK_SOFT, fontSize: 14 }}>{box === "archived" ? "Nothing archived." : "No notifications yet."}</div>}
          {(list || []).map(t => <button key={t.id} type="button" onClick={() => setOpen(t.id)} aria-label={`${t.unread ? "Unread: " : ""}${t.subject}`}
            style={{ display: "flex", gap: 10, width: "100%", textAlign: "left", background: t.unread ? "#F4F8FE" : "#fff", border: "none", borderBottom: `1px solid ${LINE}`, padding: "11px 14px", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, flexShrink: 0, background: t.unread ? (t.important ? BRICK : BLUE) : "transparent" }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: t.unread ? 800 : 600, color: t.important ? BRICK : INK, fontSize: 14.5 }}>{t.subject}</span>
              <span style={{ display: "block", fontSize: 12.5, color: INK_SOFT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.last?.text || ""}</span></span>
            <span style={{ fontSize: 12, color: INK_SOFT, whiteSpace: "nowrap" }}>{when(t.last?.at || t.createdAt)}</span>
          </button>)}
        </div>}
    </AppShell>
  );
}
