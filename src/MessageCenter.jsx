// On every screen while someone is signed in:
//  - pop-ups and sounds when a message arrives (a distinct alert for important ones), desktop
//    notifications when the browser allows them, and a red banner for unread important messages
//  - the chat window (bottom right): recent conversations, who's online, quick one-to-one chats.
// Chats are ordinary conversations, so they also show in the Messages screen.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { moduleOn } from "./licensing.js";
import { MessageCircle, X, ChevronLeft, Send, Settings, ExternalLink, AlertCircle, Search, Megaphone, Bell, Smartphone, Inbox } from "lucide-react";
import { startLive, setViewing, isViewing } from "./live.js";
import { messageTone, importantTone, alertPrefs, setAlertPrefs } from "./chime.js";
import { emergencyOn } from "./emergency.js";
import { pushBlocker, pushOnHere, enablePush, disablePush, currentSubscription, pushDevices, removeDevice, setDeviceImportantOnly, testPush, refreshPush, isApple } from "./pushClient.js";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F";
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

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
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const initials = n => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
export const openInMessages = threadId => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: "messages", init: { thread: threadId } } }));

function useNarrow() {
  const q = "(max-width: 600px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia?.(q).matches);
  useEffect(() => { const m = window.matchMedia?.(q); if (!m) return; const on = () => setN(m.matches); m.addEventListener?.("change", on); return () => m.removeEventListener?.("change", on); }, []);
  return n;
}

// Chat status: Available / Busy / Do not disturb / Out of office (see server/messages.js)
export const STATUSES = [
  { key: "available", label: "Available", color: "#22A45D", note: "Chats and alerts as usual." },
  { key: "busy", label: "Busy", color: "#E8A10C", note: "Chats go to your Messages inbox. No pop-ups, sounds or phone alerts except important messages." },
  { key: "dnd", label: "Do not disturb", color: "#D93025", note: "Same as Busy: chats go to your Messages inbox, and only important messages alert you." },
  { key: "away", label: "Out of office", color: "#8E44AD", note: "Chats go to your Messages inbox, and people who message you get your away message." },
];
const statusInfo = k => STATUSES.find(x => x.key === k) || STATUSES[0];
const untilText = iso => iso ? new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
function StatusDot({ status, online, size }) {
  const away = status && status !== "available";
  if (!away && !online) return null;
  const c = away ? statusInfo(status).color : "#22A45D";
  return (
    <span style={{ position: "absolute", right: -1, bottom: -1, width: size, height: size, borderRadius: "50%", background: c, border: "2px solid #fff", boxSizing: "content-box",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      {status === "dnd" && <span style={{ width: "60%", height: 2, background: "#fff", borderRadius: 1 }} />}
    </span>
  );
}
function Avatar({ name, online, status, size = 34, important, onDark }) {
  return (
    <span style={{ position: "relative", flexShrink: 0, width: size, height: size, borderRadius: "50%", background: important ? BRICK : onDark ? "#3A5584" : INK, color: "#fff",
      display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700 }} aria-hidden="true">
      {initials(name)}
      <StatusDot status={status} online={online} size={size * 0.28} />
    </span>
  );
}
const statusLine = p => p?.status && p.status !== "available"
  ? `${statusInfo(p.status).label}${p.statusUntil ? ` until ${untilText(p.statusUntil)}` : ""}` : p?.online ? "Online" : "";

export default function MessageCenter({ live }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ kind: "list" });       // list | chat { threadId?, person? } | settings
  const [unread, setUnread] = useState(0);
  const [important, setImportant] = useState([]);
  const [dismissed, setDismissed] = useState(() => { try { return JSON.parse(sessionStorage.getItem("sgfd-imp-dismissed") || "[]"); } catch (e) { return []; } });
  const [toasts, setToasts] = useState([]);
  const narrow = useNarrow();
  const savedTitle = useRef(null);
  const [me, setMe] = useState({ status: "available" });
  const meRef = useRef(me);
  meRef.current = me;
  const loadMe = () => call("/status", undefined, true).then(setMe, () => {});

  const refresh = () => call("/summary", undefined, true).then(s => { setUnread(s.unread); setImportant(s.importantUnread || []); }, () => {});

  // Opened from a phone/computer notification: /?thread=ID (Messages) or /?chat=ID (chat window)
  function openUrl(href) {
    let u; try { u = new URL(href, location.origin); } catch (e) { return; }
    const c = u.searchParams.get("chat"), t = u.searchParams.get("thread");
    if (c) showThread(c); else if (t) openInMessages(t);
    else if (u.searchParams.get("calls")) window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: null } }));   // a call alert: home shows Active calls
  }
  useEffect(() => {
    loadMe();
    refreshPush();
    const q = new URLSearchParams(location.search);
    if (q.get("chat") || q.get("thread") || q.get("calls")) {
      const href = location.href;
      try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
      setTimeout(() => openUrl(href), 400);
    }
    const onSw = e => { if (e.data?.type === "sgfd-open-url") openUrl(e.data.url); };
    navigator.serviceWorker?.addEventListener?.("message", onSw);
    const onStatus = () => loadMe();
    window.addEventListener("sgfd-status", onStatus);
    return () => { navigator.serviceWorker?.removeEventListener?.("message", onSw); window.removeEventListener("sgfd-status", onStatus); };
  }, []);

  useEffect(() => {
    startLive(live);
    const onSummary = e => { setUnread(e.detail.unread); setImportant(e.detail.importantUnread || []); };
    const onChanged = () => refresh();
    const onMsg = e => {
      const m = e.detail || {};
      refresh();
      if (m.mine || isViewing(m.threadId)) return;
      // Command Board emergency mode: the message arrives (unread count, chat) but nothing pops up, sounds or notifies
      if (emergencyOn()) return;
      // Busy / Do not disturb / Out of office: only important messages pop up or make a sound
      if (meRef.current.status !== "available" && !m.important) return;
      const prefs = alertPrefs();
      if (m.important) importantTone(); else messageTone();
      const id = `${m.threadId}-${Date.now()}`;
      setToasts(t => [...t.filter(x => x.threadId !== m.threadId), { ...m, id }].slice(-3));
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), m.important ? 15_000 : 8_000);
      if (typeof document !== "undefined" && document.hidden) flashTitle(`${m.important ? "❗ Important message" : "💬 New message"} · ${m.from || BRAND.app}`);
      // With push turned on for this browser, the service worker shows it when Nexus isn't in front
      const behind = document.hidden || !document.hasFocus();
      if (prefs.desktop && typeof Notification !== "undefined" && Notification.permission === "granted" && (behind ? !pushOnHere() : m.important)) {
        try {
          const n = new Notification(`${m.important ? "IMPORTANT · " : ""}${m.from || "New message"}`, {
            body: m.kind === "chat" ? m.preview : [m.subject, m.preview].filter(Boolean).join("\n"),
            tag: m.threadId, icon: "/icon-192.png", requireInteraction: !!m.important, renotify: true,
          });
          n.onclick = () => { window.focus(); n.close(); m.important ? openInMessages(m.threadId) : showThread(m.threadId); };
        } catch (x) { /* some phones only allow notifications from an installed app */ }
      }
    };
    const onVisible = () => { if (!document.hidden) stopFlash(); };
    window.addEventListener("sgfd-message-summary", onSummary);
    window.addEventListener("sgfd-message", onMsg);
    window.addEventListener("sgfd-messages-changed", onChanged);
    // Call alerts (server/callalerts.js): a red pop-up and the important tone; a desktop notice when Nexus is in the background
    const onCall = e => {
      const c = e.detail || {};
      if (emergencyOn()) return;
      importantTone();
      const id = `call-${c.incidentId}-${Date.now()}`;
      setToasts(t => [...t, { id, call: c }].slice(-4));
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), c.important ? 60_000 : 25_000);
      if (typeof document !== "undefined" && document.hidden) flashTitle(`🚨 ${c.type || "Call"}`);
      const behind = document.hidden || !document.hasFocus();
      if (behind && !pushOnHere() && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { const n = new Notification(`🚨 ${c.type || "Call"}`, { body: [c.units?.length ? `Units: ${c.units.join(", ")}` : "Waiting for units", c.agency, c.address].filter(Boolean).join("\n"), tag: `call-${c.incidentId}`, icon: "/icon-192.png", requireInteraction: !!c.important });
          n.onclick = () => { window.focus(); n.close(); window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: null } })); }; } catch (x) { /* ignore */ }
      }
    };
    window.addEventListener("sgfd-callalert", onCall);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("sgfd-message-summary", onSummary);
      window.removeEventListener("sgfd-message", onMsg);
      window.removeEventListener("sgfd-messages-changed", onChanged);
      window.removeEventListener("sgfd-callalert", onCall);
      document.removeEventListener("visibilitychange", onVisible);
      stopFlash();
    };
  }, []);

  // While the tab is in the background, the title blinks between the alert and the normal title
  // (other screens may change the normal title meanwhile; that's kept for when you come back)
  const flash = useRef(null);
  function flashTitle(text) {
    stopFlash(true);
    let on = true;
    const show = () => {
      if (document.title !== text) savedTitle.current = document.title;
      document.title = on ? text : (savedTitle.current || BRAND.app);
      on = !on;
    };
    show();
    flash.current = setInterval(show, 1200);
  }
  function stopFlash(keepSaved = false) {
    if (flash.current) { clearInterval(flash.current); flash.current = null; }
    if (!keepSaved && savedTitle.current !== null) { document.title = savedTitle.current; savedTitle.current = null; }
  }

  function showThread(threadId) { setView({ kind: "chat", threadId }); setOpen(true); }
  const dismiss = id => setDismissed(d => { const n = [...d, id]; try { sessionStorage.setItem("sgfd-imp-dismissed", JSON.stringify(n)); } catch (e) {} return n; });
  const [emergency, setEmergencyState] = useState(emergencyOn);
  useEffect(() => { const f = e => setEmergencyState(!!e.detail?.on); window.addEventListener("sgfd-emergency", f); return () => window.removeEventListener("sgfd-emergency", f); }, []);
  const banner = emergency ? [] : important.filter(m => !dismissed.includes(m.id));

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Room at the bottom of phone screens so the chat button never covers a page's last button */}
      <style>{"@media (max-width: 900px) { body { padding-bottom: 80px; } }"}</style>
      {/* Important messages: a banner across the top until it's read (or put aside for this visit) */}
      {banner.length > 0 && (
        <div role="alert" style={{ position: "fixed", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 95, width: "min(720px, calc(100vw - 20px))",
          background: BRICK, color: "#fff", borderRadius: 10, boxShadow: "0 12px 32px rgba(120,0,20,0.35)", padding: "10px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <AlertCircle size={22} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.9 }}>
              Important message{banner.length > 1 ? `s (${banner.length})` : ""}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{banner[0].from}: {banner[0].subject}</div>
          </div>
          <button type="button" onClick={() => { openInMessages(banner[0].id); dismiss(banner[0].id); }}
            style={{ border: "none", background: "#fff", color: BRICK, fontWeight: 800, borderRadius: 7, padding: "7px 14px", cursor: "pointer", fontFamily: FONT, fontSize: 13.5 }}>Read it</button>
          <button type="button" aria-label="Hide this until later" title="Hide until later" onClick={() => dismiss(banner[0].id)}
            style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>
      )}

      {/* Pop-ups */}
      <div aria-live="polite" style={{ position: "fixed", right: open && !narrow ? 400 : 18, bottom: open && !narrow ? 86 : 86, zIndex: 90, display: "flex", flexDirection: "column", gap: 8, width: "min(340px, calc(100vw - 36px))", pointerEvents: "none" }}>
        {!emergency && toasts.map(t => t.call ? (
          <div key={t.id} role="alert" aria-label="Call alert" style={{ pointerEvents: "auto", background: BRICK, color: "#fff", borderRadius: 10, boxShadow: "0 10px 28px rgba(19,35,63,0.35)", padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, opacity: 0.9 }}>Call alert · {t.call.rule}</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{t.call.type || "Call"}{t.call.priority ? ` · P${t.call.priority}` : ""}</div>
            <div style={{ fontSize: 13 }}>{t.call.units?.length ? `Units: ${t.call.units.join(", ")}` : "Waiting for units"}{t.call.agency ? ` · ${t.call.agency}` : ""}</div>
            {t.call.address && <div style={{ fontSize: 13 }}>{t.call.address}</div>}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button type="button" onClick={() => { setToasts(x => x.filter(y => y.id !== t.id)); window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: null } })); }}
                style={{ ...smallBtn(false), background: "#fff", color: BRICK }}>Active calls</button>
              <button type="button" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} style={{ ...smallBtn(false), background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,.6)" }}>Dismiss</button>
            </div>
          </div>
        ) : (
          <div key={t.id} role="status" style={{ pointerEvents: "auto", background: "#fff", borderRadius: 10, boxShadow: "0 10px 28px rgba(19,35,63,0.25)",
            borderLeft: `5px solid ${t.important ? BRICK : INK}`, padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Avatar name={t.from} important={t.important} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {t.important && <div style={{ fontSize: 11, fontWeight: 800, color: BRICK, textTransform: "uppercase", letterSpacing: 0.5 }}>Important</div>}
              <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{t.from || "New message"}</div>
              <div style={{ fontSize: 12.5, color: INK_SOFT, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {t.kind === "chat" ? t.preview : <>{t.subject}{t.preview ? ` · ${t.preview}` : ""}</>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button type="button" onClick={() => { setToasts(x => x.filter(y => y.id !== t.id)); t.important ? openInMessages(t.threadId) : showThread(t.threadId); }}
                  style={smallBtn(true)}>{t.important ? "Read it" : "Reply"}</button>
                <button type="button" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} style={smallBtn(false)}>Later</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* The chat button */}
      {!(open && narrow) && moduleOn("messaging") && (
        <button type="button" onClick={() => { setOpen(o => !o); if (!open) setView({ kind: "list" }); }} aria-expanded={open}
          aria-label={`Chat${unread ? `, ${unread} unread` : ""}`} title="Chat"
          style={{ position: "fixed", right: 18, bottom: 18, zIndex: 91, width: 56, height: 56, borderRadius: "50%", border: "none", cursor: "pointer",
            background: open ? "#24385E" : INK, color: "#fff", boxShadow: "0 8px 22px rgba(19,35,63,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {open ? <X size={24} /> : <MessageCircle size={25} />}
          {!open && me.status !== "available" && <span title={statusInfo(me.status).label} aria-hidden="true" style={{ position: "absolute", left: 1, bottom: 1 }}>
            <span style={{ position: "relative", display: "block", width: 14, height: 14 }}><StatusDot status={me.status} size={12} /></span></span>}
          {!open && unread > 0 && (
            <span style={{ position: "absolute", top: -3, right: -3, minWidth: 22, height: 22, padding: "0 6px", boxSizing: "border-box", borderRadius: 11,
              background: important.length ? BRICK : "#E0233F", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #fff" }}>
              {unread > 99 ? "99+" : unread}</span>
          )}
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Chat" style={{ position: "fixed", zIndex: narrow ? 96 : 92, background: "#fff", display: "flex", flexDirection: "column", overflow: "hidden",
          ...(narrow ? { inset: 0 } : { right: 18, bottom: 86, width: 370, height: "min(560px, calc(100vh - 110px))", borderRadius: 14, boxShadow: "0 18px 48px rgba(19,35,63,0.32)", border: `1px solid ${LINE}` }) }}>
          {view.kind === "list" && <ChatList me={me} onStatus={() => setView({ kind: "status" })} onOpen={v => setView({ kind: "chat", ...v })} onSettings={() => setView({ kind: "settings" })} onClose={() => setOpen(false)} />}
          {view.kind === "status" && <StatusPicker me={me} onSaved={s => { setMe(s); setView({ kind: "list" }); }} onBack={() => setView({ kind: "list" })} />}
          {view.kind === "chat" && <ChatView key={view.threadId || view.person?.id} start={view} onBack={() => setView({ kind: "list" })} onClose={() => setOpen(false)}
            onThread={id => setView(v => ({ ...v, threadId: id }))} />}
          {view.kind === "settings" && <AlertSettings onBack={() => setView({ kind: "list" })} />}
        </div>
      )}
    </div>
  );
}

const smallBtn = primary => ({ border: primary ? "none" : `1px solid ${LINE}`, background: primary ? INK : "#fff", color: primary ? "#fff" : INK, borderRadius: 6,
  padding: "4px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: FONT });
const iconBtn = { border: "none", background: "transparent", color: "#fff", cursor: "pointer", padding: 6, borderRadius: 6, display: "inline-flex", alignItems: "center" };

function Header({ children, onBack, onClose, extra }) {
  return (
    <div style={{ background: INK, color: "#fff", padding: "10px 10px 10px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      {onBack && <button type="button" aria-label="Back" onClick={onBack} style={iconBtn}><ChevronLeft size={20} /></button>}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {extra}
      {onClose && <button type="button" aria-label="Close chat" onClick={onClose} style={iconBtn}><X size={19} /></button>}
    </div>
  );
}

// ---- Conversations and people ------------------------------------------------------------------
function ChatList({ me, onStatus, onOpen, onSettings, onClose }) {
  const [threads, setThreads] = useState(null);
  const [people, setPeople] = useState([]);
  const [q, setQ] = useState("");
  const load = () => {
    call("/recent", undefined, true).then(r => setThreads(r.threads), () => setThreads([]));
    call("/people", undefined, true).then(r => setPeople(r.people), () => {});
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener("sgfd-message", load); window.addEventListener("sgfd-messages-changed", load);
    return () => { clearInterval(t); window.removeEventListener("sgfd-message", load); window.removeEventListener("sgfd-messages-changed", load); };
  }, []);
  const needle = q.trim().toLowerCase();
  const found = useMemo(() => needle ? people.filter(p => `${p.name} ${p.title} ${p.division}`.toLowerCase().includes(needle)).slice(0, 30) : [], [people, needle]);
  const online = people.filter(p => p.online);
  const mine = statusInfo(me?.status);
  return (
    <>
      <Header onClose={onClose} extra={<>
        <button type="button" onClick={onStatus} aria-label={`My status: ${mine.label}. Change it`} title="Set your status"
          style={{ ...iconBtn, gap: 6, fontSize: 12.5, fontWeight: 700, fontFamily: FONT, background: "rgba(255,255,255,0.12)", padding: "5px 9px" }}>
          <span style={{ position: "relative", width: 10, height: 10 }}><StatusDot status={me?.status} online size={8} /></span>
          <span style={{ maxWidth: 110, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mine.label}</span>
        </button>
        <button type="button" aria-label="Alert settings" title="Alerts and sounds" onClick={onSettings} style={iconBtn}><Settings size={18} /></button></>}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Chat</div>
        <div style={{ fontSize: 11.5, opacity: 0.8 }}>Chats also show in Messages</div>
      </Header>
      {me?.status && me.status !== "available" && (
        <button type="button" onClick={onStatus} style={{ border: "none", borderBottom: `1px solid ${LINE}`, background: "#FFF7E6", color: INK, textAlign: "left", padding: "8px 12px", fontSize: 12.5, cursor: "pointer", fontFamily: FONT }}>
          <b>You're set to {mine.label}{me.until ? ` until ${untilText(me.until)}` : ""}.</b> Chats go to your Messages inbox and only important messages alert you. <span style={{ color: "#1D5FA8", textDecoration: "underline" }}>Change</span>
        </button>
      )}
      <div style={{ padding: 10, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${LINE}`, borderRadius: 8, padding: "6px 10px", background: PAPER }}>
          <Search size={15} color={INK_SOFT} />
          <input aria-label="Find someone to chat with" value={q} onChange={e => setQ(e.target.value)} placeholder="Find someone to chat with…"
            style={{ border: "none", outline: "none", background: "transparent", flex: 1, fontSize: 14, fontFamily: FONT }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {needle ? (
          found.length ? found.map(p => (
            <button key={p.id} type="button" onClick={() => onOpen({ person: p })} style={rowStyle(false)}>
              <Avatar name={p.name} online={p.online} status={p.status} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: INK }}>{p.name}</div>
                <div style={{ fontSize: 12, color: INK_SOFT }}>{[statusLine(p), p.title, p.division].filter(Boolean).join(" · ")}</div>
              </span>
            </button>
          )) : <div style={{ padding: 16, color: INK_SOFT, fontSize: 13.5 }}>Nobody matches “{q}”.</div>
        ) : (
          <>
            {online.length > 0 && (
              <div style={{ padding: "10px 12px 4px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Online now · {online.length}</div>
                <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
                  {online.slice(0, 30).map(p => (
                    <button key={p.id} type="button" onClick={() => onOpen({ person: p })} title={p.name} aria-label={`Chat with ${p.name}`}
                      style={{ border: "none", background: "none", cursor: "pointer", padding: 0, width: 54, flexShrink: 0, fontFamily: FONT, textAlign: "center" }}>
                      <Avatar name={p.name} online status={p.status} size={40} />
                      <div style={{ fontSize: 11, color: INK, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name.split(" ")[0]}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 11.5, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 12px 4px" }}>Recent</div>
            {threads === null && <div style={{ padding: 12, color: INK_SOFT }}>Loading…</div>}
            {threads?.length === 0 && <div style={{ padding: 12, color: INK_SOFT, fontSize: 13.5 }}>No conversations yet. Find someone above to start a chat.</div>}
            {(threads || []).map(t => {
              const chat = t.kind === "chat";
              const name = chat ? t.with?.name || t.to : t.mine ? `To ${t.to}` : t.from;
              return (
                <button key={t.id} type="button" onClick={() => onOpen({ threadId: t.id })} style={rowStyle(t.unread)}
                  aria-label={`${t.unread ? "Unread: " : ""}${chat ? `Chat with ${name}` : `${t.subject} from ${name}`}`}>
                  <Avatar name={chat ? name : t.from} online={chat && t.with?.online} status={chat ? t.with?.status : null} important={t.important} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: t.unread ? 800 : 600, fontSize: 14, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                      <span style={{ fontSize: 11, color: INK_SOFT }}>{when(t.last?.at || t.createdAt)}</span>
                    </span>
                    {!chat && <span style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12.5, color: INK, fontWeight: t.unread ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {t.important && <AlertCircle size={12} color={BRICK} />}{t.broadcast && <Megaphone size={12} color={INK_SOFT} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.subject}</span></span>}
                    <span style={{ display: "block", fontSize: 12.5, color: INK_SOFT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: t.unread ? 600 : 400 }}>
                      {t.last?.mine ? "You: " : ""}{t.last?.text}</span>
                  </span>
                  {t.unread && <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: t.important ? BRICK : "#1D5FA8", flexShrink: 0 }} />}
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
const rowStyle = unread => ({ display: "flex", gap: 10, alignItems: "center", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${LINE}`,
  background: unread ? "#F4F8FE" : "#fff", padding: "9px 12px", cursor: "pointer", fontFamily: FONT });

// ---- One conversation ---------------------------------------------------------------------------
function ChatView({ start, onBack, onClose, onThread }) {
  const [threadId, setThreadId] = useState(start.threadId || null);
  const [t, setT] = useState(null);
  const [person, setPerson] = useState(start.person || null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diverted, setDiverted] = useState([]);    // chats that went to their Messages inbox (they're not Available)
  const end = useRef(null), box = useRef(null);

  const load = async id => {
    try { setT(await call(`/${id}`)); setError(""); window.dispatchEvent(new CustomEvent("sgfd-messages-changed")); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      let id = threadId;
      if (!id && person) { try { id = (await call(`/chat/${person.id}`)).id; } catch (e) { /* new chat */ } }
      if (!alive) return;
      if (id) { setThreadId(id); onThread(id); await load(id); } else setT({ posts: [], kind: "chat", with: person });
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => { setViewing(threadId); return () => setViewing(null); }, [threadId]);
  useEffect(() => {
    if (!threadId) return;
    const on = e => { if (e.detail?.threadId === threadId) load(threadId); };
    window.addEventListener("sgfd-message", on);
    return () => window.removeEventListener("sgfd-message", on);
  }, [threadId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [t?.posts?.length, diverted.length]);
  useEffect(() => { box.current?.focus(); }, [t !== null]);

  async function sendIt() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const r = threadId ? await call(`/${threadId}/reply`, { body }) : await call("/chat", { userId: person.id, body });
      if (r.redirected) {
        setDiverted(d => [...d, { id: `${Date.now()}`, body, at: new Date().toISOString(), ...r }]);
        setPerson(p => ({ ...(p || {}), status: r.status, statusMessage: r.awayMessage, statusUntil: r.until }));
        setT(x => x && x.with ? { ...x, with: { ...x.with, status: r.status, statusMessage: r.awayMessage, statusUntil: r.until } } : x);
      } else if (!threadId) { setThreadId(r.id); onThread(r.id); await load(r.id); }
      setText("");
      if (threadId && !r.redirected) await load(threadId);
    } catch (e) { setError(e.message); }
    setBusy(false);
    box.current?.focus();
  }

  const chat = t?.kind === "chat";
  const other = chat ? t?.with || person : null;
  const title = chat ? other?.name : t?.subject;
  return (
    <>
      <Header onBack={onBack} onClose={onClose}
        extra={threadId && <button type="button" title="Open in Messages" aria-label="Open in Messages" onClick={() => openInMessages(threadId)} style={iconBtn}><ExternalLink size={17} /></button>}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {chat && <Avatar name={other?.name} online={other?.online} status={other?.status} size={30} onDark />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title || "Loading…"}</div>
            <div style={{ fontSize: 11.5, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {chat ? (other?.status && other.status !== "available" ? `${statusLine(other)} · chats go to their Messages inbox`
                : other?.online ? "Online now" : "Not online. They'll see it next time they sign in.") : t ? `From ${t.mine ? "you" : t.from}${t.to ? ` to ${t.to}` : ""}` : ""}
            </div>
          </div>
        </div>
      </Header>
      {chat && other?.status && other.status !== "available" && (
        <div role="note" style={{ background: "#FFF7E6", borderBottom: `1px solid ${LINE}`, color: INK, fontSize: 12.5, padding: "7px 12px" }}>
          <b>{other.name?.split(" ")[0]} is {statusInfo(other.status).label === "Out of office" ? "out of office" : statusInfo(other.status).label === "Busy" ? "busy" : "on Do not disturb"}.</b>{" "}
          What you send now goes to their Messages inbox instead of popping up.
          {other.statusMessage && <div style={{ marginTop: 3, fontStyle: "italic", color: INK_SOFT, whiteSpace: "pre-wrap" }}>“{other.statusMessage}”</div>}
        </div>
      )}
      {t?.important && <div style={{ background: "#FDECEE", color: BRICK, fontSize: 12, fontWeight: 800, padding: "5px 12px", display: "flex", gap: 5, alignItems: "center" }}><AlertCircle size={13} /> IMPORTANT</div>}
      <div style={{ flex: 1, overflowY: "auto", background: PAPER, padding: "10px 12px" }}>
        {error && <div style={{ color: BRICK, fontSize: 13, marginBottom: 8 }}>{error}</div>}
        {t && t.posts.length === 0 && !diverted.length && <div style={{ color: INK_SOFT, fontSize: 13, textAlign: "center", marginTop: 20 }}>Say hello to {person?.name?.split(" ")[0]}.</div>}
        {(t?.posts || []).map((p, i) => {
          const prev = t.posts[i - 1];
          const showName = !p.mine && (!chat) && (!prev || prev.authorId !== p.authorId);
          const gap = !prev || new Date(p.at) - new Date(prev.at) > 15 * 60_000;
          return (
            <React.Fragment key={p.id}>
              {gap && <div style={{ textAlign: "center", fontSize: 11, color: INK_SOFT, margin: "8px 0 4px" }}>{new Date(p.at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}</div>}
              <div style={{ display: "flex", justifyContent: p.mine ? "flex-end" : "flex-start", marginBottom: 4 }}>
                <div title={new Date(p.at).toLocaleString()} style={{ maxWidth: "80%", background: p.mine ? INK : "#fff", color: p.mine ? "#fff" : INK,
                  border: p.mine ? "none" : `1px solid ${LINE}`, borderRadius: 14, borderBottomRightRadius: p.mine ? 4 : 14, borderBottomLeftRadius: p.mine ? 14 : 4, padding: "7px 11px" }}>
                  {showName && <div style={{ fontSize: 11.5, fontWeight: 700, color: INK_SOFT, marginBottom: 2 }}>{p.author}</div>}
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.4 }}>{p.body}</div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        {diverted.map(d => (
          <React.Fragment key={d.id}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <div style={{ maxWidth: "80%", background: "#E7EBF2", color: INK, border: `1px dashed #9AA6B8`, borderRadius: 14, borderBottomRightRadius: 4, padding: "7px 11px" }}>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.4 }}>{d.body}</div>
              </div>
            </div>
            <div role="status" style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: INK_SOFT, margin: "2px 0 10px", padding: "6px 9px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8 }}>
              <Inbox size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Sent to {d.to?.split(" ")[0] || "their"}’s Messages inbox ({d.label}{d.until ? ` until ${untilText(d.until)}` : ""}).
                {d.awayMessage && <><br /><b>Away message:</b> {d.awayMessage}</>}
                {d.messageId && <> <button type="button" onClick={() => openInMessages(d.messageId)} style={linkBtn}>Open in Messages</button></>}</span>
            </div>
          </React.Fragment>
        ))}
        <div ref={end} />
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, padding: 8, flexShrink: 0 }}>
        {t?.replyNote && <div style={{ fontSize: 11.5, color: INK_SOFT, margin: "0 4px 5px" }}>{t.replyNote}</div>}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea ref={box} aria-label="Message" value={text} rows={1} onChange={e => setText(e.target.value)} placeholder="Type a message…"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendIt(); } }}
            style={{ flex: 1, resize: "none", border: `1px solid ${LINE}`, borderRadius: 18, padding: "8px 12px", fontSize: 14, fontFamily: FONT, maxHeight: 110, minHeight: 20, outline: "none",
              height: Math.min(110, 20 + 18 * (text.split("\n").length - 1)) + 18, boxSizing: "border-box" }} />
          <button type="button" aria-label="Send" onClick={sendIt} disabled={busy || !text.trim() || !t}
            style={{ width: 38, height: 38, borderRadius: "50%", border: "none", background: text.trim() ? INK : "#B9C2D0", color: "#fff", cursor: text.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Send size={17} /></button>
        </div>
        <div style={{ fontSize: 10.5, color: INK_SOFT, margin: "4px 6px 0" }}>Enter to send · Shift+Enter for a new line</div>
      </div>
    </>
  );
}

// ---- My status ------------------------------------------------------------------------------------
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d; };
const localInput = d => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function StatusPicker({ me, onSaved, onBack }) {
  const [status, setStatus] = useState(me?.status || "available");
  const [message, setMessage] = useState(me?.message || "");
  const [until, setUntil] = useState(me?.until ? "date" : "never");
  const [date, setDate] = useState(me?.until ? localInput(new Date(me.until)) : localInput(new Date(Date.now() + 86400_000)));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    const end = status === "available" ? null : until === "1h" ? new Date(Date.now() + 3600_000) : until === "2h" ? new Date(Date.now() + 7200_000)
      : until === "today" ? endOfToday() : until === "date" ? new Date(date) : null;
    try { onSaved(await call("/status", { status, message, until: end ? end.toISOString() : null })); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  const away = status !== "available";
  const field = { width: "100%", boxSizing: "border-box", border: `1px solid ${LINE}`, borderRadius: 8, padding: "8px 10px", fontSize: 14, fontFamily: FONT };
  return (
    <>
      <Header onBack={onBack}><div style={{ fontSize: 16, fontWeight: 800 }}>My status</div><div style={{ fontSize: 11.5, opacity: 0.8 }}>Everyone sees it next to your name</div></Header>
      <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        <div role="radiogroup" aria-label="Status" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {STATUSES.map(x => (
            <label key={x.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: `1.5px solid ${status === x.key ? INK : LINE}`, borderRadius: 9, padding: "9px 10px", cursor: "pointer", background: status === x.key ? "#F4F8FE" : "#fff" }}>
              <input type="radio" name="chat-status" checked={status === x.key} onChange={() => setStatus(x.key)} style={{ marginTop: 3 }} />
              <span style={{ position: "relative", width: 14, height: 14, marginTop: 2, flexShrink: 0 }}><StatusDot status={x.key} online size={10} /></span>
              <span><b style={{ fontSize: 14, color: INK }}>{x.label}</b><div style={{ fontSize: 12, color: INK_SOFT }}>{x.note}</div></span>
            </label>
          ))}
        </div>
        {away && (
          <>
            <label style={{ display: "block", marginTop: 14, fontSize: 13, fontWeight: 700, color: INK }}>Away message <span style={{ fontWeight: 400, color: INK_SOFT }}>(optional)</span>
              <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={400} aria-label="Away message"
                placeholder={status === "away" ? "e.g. Out of the office until Monday. For anything urgent, call the Battalion Chief." : "e.g. In a meeting until 3:00."}
                style={{ ...field, marginTop: 5, resize: "vertical" }} /></label>
            <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 3 }}>Shown to anyone who opens a chat with you, and sent once as an automatic reply to each person who messages you.</div>
            <label style={{ display: "block", marginTop: 12, fontSize: 13, fontWeight: 700, color: INK }}>Go back to Available
              <select aria-label="Go back to Available" value={until} onChange={e => setUntil(e.target.value)} style={{ ...field, marginTop: 5 }}>
                <option value="never">When I change it</option>
                <option value="1h">In 1 hour</option>
                <option value="2h">In 2 hours</option>
                <option value="today">At the end of today</option>
                <option value="date">On a date and time…</option>
              </select></label>
            {until === "date" && <input type="datetime-local" aria-label="Back on" value={date} onChange={e => setDate(e.target.value)} style={{ ...field, marginTop: 6 }} />}
          </>
        )}
        {error && <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 10 }}>{error}</div>}
        <button type="button" onClick={save} disabled={busy} style={{ ...smallBtn(true), marginTop: 14, padding: "9px 16px", fontSize: 14, width: "100%" }}>{busy ? "Saving…" : "Save status"}</button>
      </div>
    </>
  );
}

// ---- Push notifications on this phone / tablet / computer ---------------------------------------
function PushSettings() {
  const [why] = useState(pushBlocker);
  const [here, setHere] = useState(null);          // this device's subscription endpoint, or ""
  const [devices, setDevices] = useState([]);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(""), [error, setError] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const load = async () => {
    try { setDevices(await pushDevices()); } catch (e) { /* offline */ }
    const sub = why ? null : await currentSubscription();
    setHere(sub && pushOnHere() ? sub.endpoint : "");
  };
  useEffect(() => { load(); }, []);
  const mine = devices.find(d => d.endpoint === here);
  const run = async (fn, done) => { setBusy(true); setError(""); setMsg(""); try { await fn(); await load(); if (done) setMsg(done); } catch (e) { setError(e.message); } setBusy(false); };
  return (
    <div style={{ padding: "12px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 13, color: INK_SOFT }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", color: INK, fontSize: 14, fontWeight: 700 }}><Smartphone size={16} /> Notifications on this phone, tablet or computer</div>
      <div style={{ marginTop: 4 }}>Messages, chats and things that need your attention (requisitions to sign, tickets, leave turns) show on this device even when {PN} is closed.</div>
      {why === "apple-install" && <div style={{ marginTop: 8, background: PAPER, borderRadius: 8, padding: "8px 10px", color: INK }}>
        <b>iPhone and iPad:</b> tap the Share button <span aria-hidden="true">(□↑)</span>, choose <b>Add to Home Screen</b>, open {PN} from the new icon, sign in, and come back here. (Needs iOS 16.4 or newer.)</div>}
      {why === "insecure" && <div style={{ marginTop: 8 }}>Push needs {PN} to be opened over HTTPS with a trusted certificate.</div>}
      {why === "unsupported" && <div style={{ marginTop: 8 }}>This browser can't get push notifications. Chrome, Edge, Firefox and Safari can.</div>}
      {!why && here === "" && (
        <div style={{ marginTop: 8 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8, color: INK, cursor: "pointer" }}>
            <input type="checkbox" checked={importantOnly} onChange={e => setImportantOnly(e.target.checked)} /> Only important messages on this device</label>
          <button type="button" disabled={busy} onClick={() => run(() => enablePush(importantOnly), "Notifications are on for this device.")} style={{ ...smallBtn(true), padding: "7px 12px", fontSize: 13 }}>
            <Bell size={13} style={{ verticalAlign: -2 }} /> Turn on notifications here</button>
          <div style={{ fontSize: 11.5, marginTop: 6 }}>Don't turn this on for a shared station computer: your message previews would show on it.</div>
        </div>
      )}
      {!why && mine && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: SAGE, fontWeight: 700 }}><Bell size={13} style={{ verticalAlign: -2 }} /> On for this device ({mine.label}).</div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0", color: INK, cursor: "pointer" }}>
            <input type="checkbox" checked={mine.importantOnly} disabled={busy} onChange={e => run(() => setDeviceImportantOnly(mine.endpoint, e.target.checked))} /> Only important messages on this device</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={() => run(() => testPush(mine.endpoint), "Test sent. It should appear in a few seconds.")} style={smallBtn(true)}>Send a test</button>
            <button type="button" disabled={busy} onClick={() => run(() => disablePush(), "Notifications are off for this device.")} style={smallBtn(false)}>Turn off here</button>
          </div>
        </div>
      )}
      {msg && <div role="status" style={{ marginTop: 8, color: SAGE, fontWeight: 600 }}>{msg}</div>}
      {error && <div role="alert" style={{ marginTop: 8, color: BRICK }}>{error}</div>}
      {devices.filter(d => d.endpoint !== here).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>Your other devices</div>
          {devices.filter(d => d.endpoint !== here).map(d => (
            <div key={d.endpoint} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${LINE}` }}>
              <span style={{ flex: 1, color: INK }}>{d.label}{d.importantOnly ? " · important only" : ""}<div style={{ fontSize: 11.5, color: INK_SOFT }}>Added {when(d.added)}{d.lastUsed ? ` · last alert ${when(d.lastUsed)}` : ""}</div></span>
              <button type="button" disabled={busy} onClick={() => run(() => removeDevice(d.endpoint))} aria-label={`Remove ${d.label}`} style={smallBtn(false)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5 }}>While your status is Busy, Do not disturb or Out of office, only important messages come through.</div>
    </div>
  );
}

// ---- Alerts and sounds (this computer) ---------------------------------------------------------
function AlertSettings({ onBack }) {
  const [p, setP] = useState(alertPrefs);
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const set = (k, v) => { setAlertPrefs({ [k]: v }); setP(alertPrefs()); };
  async function ask() {
    try { const r = await Notification.requestPermission(); setPerm(r); if (r === "granted") new Notification("Desktop alerts are on", { body: "You'll get a pop-up here when a message arrives.", icon: "/icon-192.png" }); }
    catch (e) { setPerm("unsupported"); }
  }
  const row = { display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderBottom: `1px solid ${LINE}`, fontSize: 14, color: INK, cursor: "pointer" };
  return (
    <>
      <Header onBack={onBack}><div style={{ fontSize: 16, fontWeight: 800 }}>Alerts and sounds</div><div style={{ fontSize: 11.5, opacity: 0.8 }}>For this computer or phone</div></Header>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <PushSettings />
        <label style={row}><input type="checkbox" checked={p.sound} onChange={e => set("sound", e.target.checked)} style={{ marginTop: 3 }} />
          <span><b>Sound for new messages</b><div style={{ fontSize: 12.5, color: INK_SOFT }}>A soft pop. <button type="button" onClick={e => { e.preventDefault(); messageTone(true); }} style={linkBtn}>Play it</button></div></span></label>
        <label style={row}><input type="checkbox" checked={p.importantSound} onChange={e => set("importantSound", e.target.checked)} style={{ marginTop: 3 }} />
          <span><b>Alert sound for important messages</b><div style={{ fontSize: 12.5, color: INK_SOFT }}>An urgent triple tone, twice. <button type="button" onClick={e => { e.preventDefault(); importantTone(true); }} style={linkBtn}>Play it</button></div></span></label>
        <label style={row}><input type="checkbox" checked={p.desktop} onChange={e => set("desktop", e.target.checked)} style={{ marginTop: 3 }} />
          <span><b>Desktop pop-ups</b><div style={{ fontSize: 12.5, color: INK_SOFT }}>When {PN} is open in another tab or behind other windows. Important messages stay on screen until you click them.</div></span></label>
        <div style={{ padding: "12px 14px", fontSize: 13, color: INK_SOFT }}>
          {perm === "granted" && <span style={{ color: SAGE, fontWeight: 700 }}><Bell size={13} style={{ verticalAlign: -2 }} /> This browser allows desktop pop-ups.</span>}
          {perm === "default" && <button type="button" onClick={ask} style={{ ...smallBtn(true), padding: "7px 12px", fontSize: 13 }}><Bell size={13} style={{ verticalAlign: -2 }} /> Turn on desktop pop-ups</button>}
          {perm === "denied" && <span>This browser is blocking pop-ups from {PN}. Allow notifications for this site in the browser’s site settings (the padlock next to the address).</span>}
          {perm === "unsupported" && <span>This browser can’t show desktop pop-ups{isApple() ? ". On an iPhone or iPad, add " + PN + " to the Home Screen first" : ""}.</span>}
          <div style={{ marginTop: 10 }}>Alerts come while {PN} is open in a browser tab (it can be in the background). Pop-ups inside {PN} and the red banner for important messages always show.</div>
        </div>
      </div>
    </>
  );
}
const linkBtn = { border: "none", background: "none", padding: 0, color: "#1D5FA8", cursor: "pointer", fontSize: 12.5, fontFamily: FONT, textDecoration: "underline" };
