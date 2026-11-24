// Messages: interdepartmental messages (server/messages.js).
// Inbox / Sent / Archived on the left, the conversation on the right (one at a time on phones).
// Anyone can message people; groups and "Everyone" need the Messages permission.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Send, Archive, PenSquare, Users, Megaphone, AlertCircle, CheckCheck, Clock3, Reply, ListChecks, Trash2, MessageCircle, MailOpen, Mail } from "lucide-react";
import { setViewing } from "./live.js";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";

async function call(path, body, background = false) {
  const r = await fetch(`/api/messages${path}`, body === undefined
    ? { credentials: "same-origin", headers: background ? { "X-SGFD-Background": "1" } : {} }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const when = iso => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }) + (d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : "");
};
const fullWhen = iso => new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function useNarrow() {
  const q = "(max-width: 900px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => { const m = window.matchMedia?.(q); if (!m) return; const on = () => setN(m.matches); m.addEventListener?.("change", on); return () => m.removeEventListener?.("change", on); }, []);
  return n;
}

export default function MessagesModule({ onBack, initialThread }) {
  const [box, setBox] = useState("inbox");
  const [threads, setThreads] = useState(null);
  const [unread, setUnread] = useState(0);
  const [openId, setOpenId] = useState(initialThread || null);
  const [composing, setComposing] = useState(null);     // null | { to?: [...], subject? }
  const [toast, setToast] = useState(null);
  const [sel, setSel] = useState(() => new Set());        // ticked conversations
  const narrow = useNarrow();
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = (bg = false) => {
    call(`?box=${box}`, undefined, bg).then(r => setThreads(r.threads), () => {});
    call("/summary", undefined, bg).then(r => setUnread(r.unread), () => {});
  };
  useEffect(() => { if (box === "lists") return; setThreads(null); setSel(new Set()); load(); }, [box]);
  useEffect(() => {
    if (box === "lists") return;
    const t = setInterval(() => load(true), 60_000);
    // New messages and replies arrive live; archive/delete in another tab or the chat window too
    let soon = null;
    const on = () => { clearTimeout(soon); soon = setTimeout(() => load(true), 250); };
    window.addEventListener("sgfd-message", on); window.addEventListener("sgfd-messages-changed", on);
    return () => { clearInterval(t); clearTimeout(soon); window.removeEventListener("sgfd-message", on); window.removeEventListener("sgfd-messages-changed", on); };
  }, [box]);
  // Ticked ones that are still in the list
  const picked = (threads || []).filter(t => sel.has(t.id));
  const allPicked = !!threads?.length && picked.length === threads.length;
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  async function bulk(action) {
    const ids = picked.map(t => t.id);
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(`Delete ${ids.length === 1 ? "this conversation" : `these ${ids.length} conversations`}?\n\n` +
      "They're removed from your messages for good. Anyone else in them keeps their copy. If someone replies later, you'll see just the new reply.")) return;
    try {
      await call("/bulk", { ids, action });
      setSel(new Set());
      if (ids.includes(openId) && (action === "delete" || action === "archive" || action === "unarchive")) setOpenId(null);
      load();
      showToast({ delete: "Deleted", archive: "Archived", unarchive: "Moved to inbox", read: "Marked as read", unread: "Marked as unread" }[action] + (ids.length > 1 ? ` (${ids.length})` : ""));
    } catch (e) { showToast(e.message); }
  }

  const shellNav = [
    { key: "new", label: "New message", icon: PenSquare },
    { key: "inbox", label: "Inbox", icon: Inbox, badge: unread },
    { key: "sent", label: "Sent", icon: Send },
    { key: "archived", label: "Archived", icon: Archive },
    { key: "lists", label: "My lists", icon: ListChecks },
  ];
  const go = k => {
    if (k === "new") { setComposing({}); setOpenId(null); return; }
    if (k === "lists") { setComposing(null); setOpenId(null); setBox("lists"); return; }
    setComposing(null); setOpenId(null); setBox(k);
  };
  const active = composing ? "new" : box;
  if (box === "lists" && !composing) {
    return (
      <AppShell section="Messages" nav={shellNav} active="lists" onNav={go} onHome={onBack}>
        <MyLists toast={showToast} onMessage={l => setBox("inbox") || setComposing({ to: [{ kind: "l", id: l.id, name: l.name, count: l.members.length }] })} />
        {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{toast}</div>}
      </AppShell>
    );
  }
  const showList = !narrow || (!openId && !composing);
  const showRight = !narrow || openId || composing;

  return (
    <AppShell section="Messages" nav={shellNav} active={active} onNav={go} onHome={onBack} wide>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(280px, 380px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {showList && (
          <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${LINE}` }}>
              <input type="checkbox" aria-label="Select all" title="Select all" checked={allPicked} disabled={!threads?.length}
                ref={el => { if (el) el.indeterminate = picked.length > 0 && !allPicked; }}
                onChange={() => setSel(allPicked ? new Set() : new Set(threads.map(t => t.id)))} style={{ width: 16, height: 16, cursor: "pointer" }} />
              <b style={{ fontSize: 15, flex: 1 }}>{box === "inbox" ? "Inbox" : box === "sent" ? "Sent" : "Archived"}</b>
              <button style={{ ...btn("primary"), padding: "6px 12px" }} onClick={() => go("new")}><PenSquare size={14} /> New</button>
            </div>
            {picked.length > 0 && (
              <div role="toolbar" aria-label="With the selected messages" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 14px", background: "#EEF3FA", borderBottom: `1px solid ${LINE}` }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, marginRight: 4 }}>{picked.length} selected</span>
                {picked.some(t => t.unread)
                  ? <button style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => bulk("read")}><MailOpen size={13} /> Mark read</button>
                  : <button style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => bulk("unread")}><Mail size={13} /> Mark unread</button>}
                {box === "archived"
                  ? <button style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => bulk("unarchive")}><Inbox size={13} /> Move to inbox</button>
                  : <button style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5 }} onClick={() => bulk("archive")}><Archive size={13} /> Archive</button>}
                <button style={{ ...btn("outline"), padding: "4px 9px", fontSize: 12.5, color: BRICK, borderColor: "#F0C4CB" }} onClick={() => bulk("delete")}><Trash2 size={13} /> Delete</button>
                <button style={{ ...btn("ghost"), padding: "4px 6px", fontSize: 12.5, marginLeft: "auto" }} onClick={() => setSel(new Set())}>Clear</button>
              </div>
            )}
            {threads === null && <div style={{ padding: 14, color: INK_SOFT }}>Loading…</div>}
            {threads && threads.length === 0 && <div style={{ padding: 14, color: INK_SOFT, fontSize: 13.5 }}>{box === "inbox" ? "No messages." : box === "sent" ? "You haven't sent anything yet." : "Nothing archived."}</div>}
            <div role="list" aria-label="Messages" style={{ maxHeight: "calc(100vh - 190px)", overflowY: "auto" }}>
              {(threads || []).map(t => (
                <div key={t.id} role="listitem" aria-label={`${t.unread ? "Unread: " : ""}${t.kind === "chat" ? `Chat with ${t.with?.name || t.to}` : `${t.subject} from ${t.from}`}`} style={{ display: "flex", alignItems: "stretch", borderBottom: `1px solid ${LINE}`,
                  background: sel.has(t.id) ? "#EEF3FA" : t.id === openId ? "#E8EEF8" : t.unread ? "#FFF8F0" : "#fff", borderLeft: `3px solid ${t.important ? BRICK : t.unread ? AMBER : "transparent"}` }}>
                <label style={{ display: "flex", alignItems: "flex-start", padding: "12px 0 0 11px", cursor: "pointer" }}>
                  <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Select ${t.kind === "chat" ? `chat with ${t.with?.name || t.to}` : t.subject}`} style={{ width: 15, height: 15, cursor: "pointer" }} />
                </label>
                <button type="button" onClick={() => { setOpenId(t.id); setComposing(null); }}
                  aria-label={`${t.unread ? "Unread: " : ""}${t.kind === "chat" ? `Chat with ${t.with?.name || t.to}` : `${t.subject} from ${t.from}`}`}
                  style={{ display: "block", flex: 1, minWidth: 0, textAlign: "left", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "10px 14px 10px 10px", background: "transparent" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: t.unread ? 800 : 600, fontSize: 13.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.kind === "chat" ? (t.with?.name || t.to) : box === "sent" ? `To ${t.to}` : t.from}
                    </span>
                    <span style={{ fontSize: 11.5, color: INK_SOFT, whiteSpace: "nowrap" }}>{when(t.last?.at || t.createdAt)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: INK, fontWeight: t.unread ? 700 : 400 }}>
                    {t.important && <AlertCircle size={13} color={BRICK} />}
                    {t.broadcast && <Megaphone size={13} color={INK_SOFT} />}
                    {t.kind === "chat" && <MessageCircle size={13} color={INK_SOFT} />}
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.kind === "chat" ? "Chat" : t.subject}</span>
                    {t.replies > 0 && <span style={{ fontSize: 11, color: INK_SOFT }}>({t.replies + 1})</span>}
                  </div>
                  {t.last && <div style={{ fontSize: 12, color: INK_SOFT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.last.mine ? "You: " : ""}{t.last.text}</div>}
                  {t.recipients != null && t.broadcast && (
                    <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 2 }}>Read by {t.readBy} of {t.recipients}{t.waiting ? ` · ${t.waiting} waiting for their shift` : ""}</div>
                  )}
                </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {showRight && (
          <div>
            {narrow && (openId || composing) && <button style={{ ...btn("ghost"), marginBottom: 8 }} onClick={() => { setOpenId(null); setComposing(null); }}>‹ Back to {box}</button>}
            {composing && <Compose start={composing} onSent={r => { setComposing(null); setBox("sent"); load(); setOpenId(r.id);
              showToast(`Sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}${r.waiting ? `; ${r.waiting} will get it at their next shift` : ""}`); }}
              onCancel={() => setComposing(null)} toast={showToast} />}
            {!composing && openId && <Thread key={openId} id={openId} onChanged={() => load(true)} onArchived={() => { setOpenId(null); load(); }}
              onPrivateReply={(person, subject) => { setOpenId(null); setComposing({ to: [{ kind: "u", id: person.id, name: person.name }], subject: subject.startsWith("Re:") ? subject : `Re: ${subject}` }); }}
              toast={showToast} />}
            {!composing && !openId && !narrow && (
              <div style={{ ...cardStyle, color: INK_SOFT, textAlign: "center", padding: 40 }}>
                <Inbox size={34} color={LINE} /><div style={{ marginTop: 8 }}>Choose a message, or start a new one.</div>
              </div>
            )}
          </div>
        )}
      </div>
      {toast && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 60 }}>{toast}</div>}
    </AppShell>
  );
}

// ---- One conversation ------------------------------------------------------------------------
function Thread({ id, onChanged, onArchived, onPrivateReply, toast }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const end = useRef(null);
  const load = () => call(`/${id}`).then(x => { setT(x); onChanged(); }, e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  useEffect(() => { setViewing(id); return () => setViewing(null); }, [id]);
  useEffect(() => {
    const on = e => { if (e.detail?.threadId === id) load(); };
    window.addEventListener("sgfd-message", on);
    return () => window.removeEventListener("sgfd-message", on);
  }, [id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [t?.posts?.length]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!t) return <div style={{ ...cardStyle, color: INK_SOFT }}>Loading…</div>;

  async function reply() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try { await call(`/${id}/reply`, { body: text }); setText(""); await load(); } catch (e) { toast(e.message); }
    setBusy(false);
  }
  async function archive(on) {
    try { await call(`/${id}/archive`, { archived: on }); toast(on ? "Archived" : "Moved to inbox"); onArchived(); } catch (e) { toast(e.message); }
  }
  async function remove() {
    if (!window.confirm("Delete this conversation?\n\nIt's removed from your messages for good. Anyone else in it keeps their copy. If someone replies later, you'll see just the new reply.")) return;
    try { await call(`/${id}/delete`, {}); toast("Deleted"); onArchived(); } catch (e) { toast(e.message); }
  }
  const r = t.receipts;
  const readN = r ? r.filter(x => x.readAt).length : 0, waitN = r ? r.filter(x => x.waiting).length : 0;
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }} role="article" aria-label={t.subject}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${LINE}`, borderTop: t.important ? `4px solid ${BRICK}` : undefined }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {t.important && <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 800, color: BRICK, textTransform: "uppercase", letterSpacing: 0.5 }}><AlertCircle size={13} /> Important</div>}
            <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{t.kind === "chat" ? <><MessageCircle size={17} style={{ verticalAlign: -2 }} /> Chat with {t.with?.name || t.to}</> : t.subject}</div>
            <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>
              From <b style={{ color: INK }}>{t.mine ? "you" : t.from}</b> to {t.broadcast ? <b style={{ color: INK }}>{t.to}</b> : (t.participants.length ? t.participants.map(p => p.name).join(", ") : t.to)} · {fullWhen(t.createdAt)}
              {t.timing === "next_shift" && <> · <Clock3 size={12} style={{ verticalAlign: -1 }} /> delivered at each person's next shift</>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...btn("outline"), padding: "5px 10px" }} onClick={() => archive(!t.archived)}><Archive size={13} /> {t.archived ? "Move to inbox" : "Archive"}</button>
            <button style={{ ...btn("outline"), padding: "5px 10px", color: BRICK, borderColor: "#F0C4CB" }} onClick={remove}><Trash2 size={13} /> Delete</button>
          </div>
        </div>
        {r && (
          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            <button type="button" onClick={() => setShowReceipts(s => !s)} aria-expanded={showReceipts}
              style={{ border: "none", background: "none", padding: 0, cursor: "pointer", color: BLUE, fontFamily: "inherit", fontSize: 12.5 }}>
              <CheckCheck size={13} style={{ verticalAlign: -2 }} /> Read by {readN} of {r.length}{waitN ? ` · ${waitN} waiting for their shift` : ""} {showReceipts ? "▲" : "▼"}
            </button>
            {showReceipts && (
              <div style={{ marginTop: 6, maxHeight: 220, overflowY: "auto", border: `1px solid ${LINE}`, borderRadius: 6 }}>
                {r.map((x, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "5px 10px", borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
                    <span style={{ flex: 1 }}><b>{x.name}</b> <span style={{ color: INK_SOFT }}>{x.via !== "Direct" ? `· ${x.via}` : ""}</span></span>
                    <span style={{ color: x.readAt ? SAGE : x.waiting ? AMBER : INK_SOFT }}>
                      {x.readAt ? `Read ${when(x.readAt)}` : x.waiting ? `Gets it ${fullWhen(x.deliverAt)}` : "Not read yet"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ padding: "14px 18px", background: PAPER, maxHeight: "calc(100vh - 360px)", minHeight: 160, overflowY: "auto" }}>
        {t.posts.map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: p.mine ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div style={{ maxWidth: "min(620px, 88%)", background: p.mine ? "#E3ECFA" : "#fff", border: `1px solid ${p.privateTo ? AMBER : LINE}`, borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 3 }}>
                <b style={{ color: INK }}>{p.mine ? "You" : p.author}</b> · {fullWhen(p.at)}
                {p.privateTo && <span style={{ color: AMBER }}> · private reply{t.mine && !p.mine ? "" : ` to ${p.privateTo}`}</span>}
              </div>
              <div style={{ fontSize: 14, color: INK, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.45 }}>{p.body}</div>
              {t.mine && t.broadcast && !p.mine && (
                <button type="button" onClick={() => onPrivateReply({ id: p.authorId, name: p.author }, t.subject)}
                  style={{ ...btn("ghost"), padding: "2px 0", fontSize: 12, marginTop: 4 }}><Reply size={12} /> Reply to {p.author.split(" ")[0]} only</button>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div style={{ padding: "12px 18px", borderTop: `1px solid ${LINE}` }}>
        {t.replyNote && <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 6 }}>{t.replyNote}</div>}
        {t.mine && t.broadcast && <div style={{ fontSize: 12, color: INK_SOFT, marginBottom: 6 }}>Your reply here goes to everyone this was sent to.</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea aria-label="Reply" value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply… (Enter sends, Shift+Enter for a new line)"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy) reply(); } }}
            style={{ ...inputStyle, minHeight: 60, flex: 1, resize: "vertical" }} />
          <button style={btn("primary")} disabled={busy || !text.trim()} onClick={reply}><Send size={14} /> Reply</button>
        </div>
      </div>
    </div>
  );
}

// ---- New message ----------------------------------------------------------------------------
function Compose({ start, onSent, onCancel, toast }) {
  const [opts, setOpts] = useState(null);
  const [to, setTo] = useState(start.to || []);        // [{ kind: "u"|"g"|"all", id, name, count }]
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState(start.subject || "");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [timing, setTiming] = useState("now");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState(null);       // null = default for what's picked; "all" | "me"
  const picker = useRef(null);
  useEffect(() => { call("/people").then(setOpts, e => toast(e.message)); }, []);
  // Close the suggestions when clicking or tapping anywhere outside the To box
  useEffect(() => {
    const away = e => { if (picker.current && !picker.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);
  const pick = c => { setTo(t => [...t, c]); setQ(""); setOpen(false); };
  const choices = useMemo(() => {
    if (!opts) return [];
    const needle = q.trim().toLowerCase();
    const has = (k, id) => to.some(x => x.kind === k && x.id === id);
    const list = [];
    if (opts.canBroadcast && !has("all", "all") && (!needle || "everyone".includes(needle))) list.push({ kind: "all", id: "all", name: "Everyone", count: opts.everyoneCount });
    for (const l of opts.lists || []) if (!has("l", l.id) && (!needle || l.name.toLowerCase().includes(needle))) list.push({ kind: "l", id: l.id, name: l.name, count: l.members.length, sub: "My list" });
    for (const g of opts.groups) if (!has("g", g.id) && (!needle || g.name.toLowerCase().includes(needle))) list.push({ kind: "g", id: g.id, name: g.name, count: g.count });
    for (const p of opts.people) if (!has("u", p.id) && (!needle || `${p.name} ${p.division} ${p.title}`.toLowerCase().includes(needle))) list.push({ kind: "u", id: p.id, name: p.name, sub: [p.title, p.division].filter(Boolean).join(" · ") });
    return list.slice(0, 40);
  }, [opts, q, to]);
  const broadcast = to.some(x => x.kind === "g" || x.kind === "all");
  const peopleCount = to.reduce((n, x) => n + (x.kind === "u" ? 1 : x.kind === "l" ? x.count : 0), 0);
  const askReplies = !broadcast && peopleCount > 1;
  const privateReplies = askReplies && (replies ? replies === "me" : to.some(x => x.kind === "l"));

  async function sendIt() {
    if (!to.length) { toast("Choose who it's for"); return; }
    if (!body.trim()) { toast("Write a message"); return; }
    setBusy(true);
    try {
      const r = await call("", { subject, body, important, timing,
        users: to.filter(x => x.kind === "u").map(x => x.id), groups: to.filter(x => x.kind === "g").map(x => x.id), everyone: to.some(x => x.kind === "all"),
        lists: to.filter(x => x.kind === "l").map(x => x.id), privateReplies });
      onSent(r);
    } catch (e) { toast(e.message); }
    setBusy(false);
  }
  const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
  return (
    <div style={cardStyle} role="form" aria-label="New message">
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>New message</div>
      <div ref={picker} style={{ marginBottom: 12, position: "relative" }}>
        <span style={label}>To</span>
        <div style={{ ...inputStyle, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "6px 8px", minHeight: 42 }} onClick={() => setOpen(true)}>
          {to.map(x => (
            <span key={`${x.kind}${x.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: x.kind === "u" ? "#E8EEF8" : x.kind === "l" ? "#E7F4EC" : "#FDECEE", color: INK, borderRadius: 999, padding: "2px 8px", fontSize: 13, fontWeight: 600 }}>
              {x.kind === "all" ? <Megaphone size={12} /> : x.kind === "g" ? <Users size={12} /> : x.kind === "l" ? <ListChecks size={12} /> : null}{x.name}{x.count != null ? ` (${x.count})` : ""}
              <button type="button" aria-label={`Remove ${x.name}`} onClick={e => { e.stopPropagation(); setTo(t => t.filter(y => y !== x)); }} style={{ border: "none", background: "none", cursor: "pointer", color: INK_SOFT, padding: 0, fontSize: 14 }}>×</button>
            </span>
          ))}
          <input aria-label="To" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={e => { if (e.key === "Enter" && choices[0] && open) { e.preventDefault(); pick(choices[0]); } if (e.key === "Escape" || e.key === "Tab") setOpen(false); }}
            placeholder={to.length ? "" : opts?.canBroadcast ? "Name, list, group, or Everyone…" : "Name or one of your lists…"} style={{ border: "none", outline: "none", flex: 1, minWidth: 140, fontSize: 14, fontFamily: "inherit", background: "transparent" }} />
        </div>
        {open && choices.length > 0 && (
          <div role="listbox" style={{ position: "absolute", left: 0, right: 0, top: "100%", zIndex: 20, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, boxShadow: "0 10px 24px rgba(19,35,63,0.15)", maxHeight: 280, overflowY: "auto", marginTop: 4 }}>
            {choices.map(c => (
              <div key={`${c.kind}${c.id}`} role="option" aria-selected="false" onMouseDown={e => { e.preventDefault(); pick(c); }}
                style={{ padding: "7px 12px", cursor: "pointer", borderBottom: `1px solid ${LINE}`, display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
                {c.kind === "all" ? <Megaphone size={14} color={BRICK} /> : c.kind === "g" ? <Users size={14} color={BRICK} /> : c.kind === "l" ? <ListChecks size={14} color={SAGE} /> : <span style={{ width: 14 }} />}
                <b>{c.name}</b>
                <span style={{ color: INK_SOFT, fontSize: 12.5 }}>{c.kind === "u" ? c.sub : `${c.kind === "l" ? "My list · " : ""}${c.count} ${c.count === 1 ? "person" : "people"}`}</span>
              </div>
            ))}
          </div>
        )}
        {opts && !opts.canBroadcast && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4 }}>You can send to people and your own lists (My lists). Sending to groups needs permission from a master admin.</div>}
      </div>
      <label style={{ display: "block", marginBottom: 12 }}><span style={label}>Subject</span>
        <input aria-label="Subject" style={inputStyle} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What's it about?" /></label>
      <label style={{ display: "block", marginBottom: 12 }}><span style={label}>Message</span>
        <textarea aria-label="Message" style={{ ...inputStyle, minHeight: 160, resize: "vertical" }} value={body} onChange={e => setBody(e.target.value)} /></label>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 14 }}>
        <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: "8px 12px", margin: 0 }}>
          <legend style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600, padding: "0 4px" }}>When should they get it?</legend>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="radio" name="timing" checked={timing === "now"} onChange={() => setTiming("now")} /> Right away</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 4 }}><input type="radio" name="timing" checked={timing === "next_shift"} onChange={() => setTiming("next_shift")} /> At each person's next shift</label>
          {timing === "next_shift" && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4, maxWidth: 340 }}>Uses each person's schedule from Time Tracker. People on shift now, or with no schedule set, get it right away.</div>}
        </fieldset>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 14 }}>
          <input type="checkbox" checked={important} onChange={e => setImportant(e.target.checked)} /> <AlertCircle size={14} color={BRICK} /> Mark as important
        </label>
      </div>
      {broadcast && <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10 }}>Group message: replies come back to you only, not to the whole group.</div>}
      {askReplies && (
        <fieldset style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: "8px 12px", margin: "0 0 12px" }}>
          <legend style={{ fontSize: 12.5, color: INK_SOFT, fontWeight: 600, padding: "0 4px" }}>Replies ({peopleCount} people)</legend>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="radio" name="replies" checked={!privateReplies} onChange={() => setReplies("all")} /> Everyone sees every reply (a group conversation)</label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 4 }}><input type="radio" name="replies" checked={privateReplies} onChange={() => setReplies("me")} /> Replies come back to just me</label>
        </fieldset>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn("primary")} disabled={busy} onClick={sendIt}><Send size={14} /> {busy ? "Sending…" : "Send"}</button>
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---- My lists: your own lists of people to message ---------------------------------------------
function MyLists({ toast, onMessage }) {
  const [lists, setLists] = useState(null);
  const [people, setPeople] = useState([]);
  const [edit, setEdit] = useState(null);           // { id?, name, members: [] }
  const [q, setQ] = useState("");
  const load = () => call("/lists").then(r => setLists(r.lists), e => toast(e.message));
  useEffect(() => { load(); call("/people").then(r => setPeople(r.people), () => {}); }, []);
  const nameOf = id => people.find(p => p.id === id)?.name || "(no longer active)";
  async function save() {
    if (!edit.name.trim()) { toast("Give the list a name"); return; }
    try { const r = await call("/lists", edit); setLists(r.lists); setEdit(null); toast("List saved"); } catch (e) { toast(e.message); }
  }
  async function remove(l) {
    if (!window.confirm(`Delete your list "${l.name}"? This doesn't affect any messages already sent.`)) return;
    try { await call(`/lists/${l.id}/remove`, {}); load(); setEdit(null); toast("List deleted"); } catch (e) { toast(e.message); }
  }
  if (!lists) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  if (edit) {
    const shown = people.filter(p => !q || `${p.name} ${p.division} ${p.title}`.toLowerCase().includes(q.toLowerCase()));
    return (
      <div style={cardStyle} role="form" aria-label="Edit list">
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{edit.id ? "Edit list" : "New list"}</div>
        <label style={{ display: "block", marginBottom: 10, fontSize: 12.5, color: INK_SOFT, fontWeight: 600 }}>List name
          <input aria-label="List name" style={inputStyle} value={edit.name} onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} placeholder="e.g. My crew, Training committee" /></label>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
          <div>
            <input aria-label="Find people" style={{ ...inputStyle, marginBottom: 6 }} placeholder="Find people…" value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${LINE}`, borderRadius: 8 }}>
              {shown.map(p => (
                <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, cursor: "pointer" }}>
                  <input type="checkbox" checked={edit.members.includes(p.id)} onChange={e => setEdit(x => ({ ...x, members: e.target.checked ? [...x.members, p.id] : x.members.filter(m => m !== p.id) }))} />
                  <span><b>{p.name}</b> <span style={{ color: INK_SOFT, fontSize: 12.5 }}>{[p.title, p.division].filter(Boolean).join(" · ")}</span></span>
                </label>
              ))}
            </div>
          </div>
          <div role="region" aria-label="On this list">
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>On this list: {edit.members.length}</div>
            {edit.members.map(id => (
              <div key={id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, padding: "3px 0" }}>
                <span style={{ flex: 1 }}>{nameOf(id)}</span>
                <button type="button" aria-label={`Take ${nameOf(id)} off the list`} onClick={() => setEdit(x => ({ ...x, members: x.members.filter(m => m !== id) }))} style={{ ...btn("ghost"), padding: "0 6px", color: BRICK }}>✕</button>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button style={btn("primary")} onClick={save}>Save list</button>
          <button style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
          {edit.id && <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={() => remove(edit)}><Trash2 size={13} /> Delete list</button>}
        </div>
      </div>
    );
  }
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>My lists</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>Your own lists of people to message in one go. Only you can see them.</div>
        </div>
        <button style={btn("primary")} onClick={() => setEdit({ name: "", members: [] })}>+ New list</button>
      </div>
      {lists.length === 0 && <div style={{ fontSize: 13.5, color: INK_SOFT }}>No lists yet. Make one for your crew, a committee, or anyone you message together often.</div>}
      {lists.map(l => (
        <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
          <ListChecks size={18} color={SAGE} />
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <b>{l.name}</b> <span style={{ color: INK_SOFT, fontSize: 13 }}>· {l.members.length} {l.members.length === 1 ? "person" : "people"}</span>
            <div style={{ fontSize: 12.5, color: INK_SOFT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.members.map(nameOf).join(", ")}</div>
          </div>
          <button style={btn("outline")} onClick={() => setEdit({ id: l.id, name: l.name, members: l.members })}>Edit</button>
          <button style={btn("primary")} aria-label={`Message ${l.name}`} onClick={() => onMessage(l)}><Send size={13} /> Message</button>
        </div>
      ))}
    </div>
  );
}
