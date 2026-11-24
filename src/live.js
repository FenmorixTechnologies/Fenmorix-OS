import { moduleOn } from "./licensing.js";
// Live updates from the server (/api/events, server/events.js), shared by every screen.
// Fires window events the screens listen for:
//   "sgfd-message"           { threadId, subject, from, preview, important, kind, mine }  a message or reply arrived
//   "sgfd-messages-changed"  something was archived / deleted / read (maybe in another tab)
//   "sgfd-message-summary"   the unread summary, checked every 30-90 s as a safety net
// Without live updates (LIVE_EVENTS=off, or the stream can't connect) the summary check runs every 30 s
// and new unread messages it finds are announced as "sgfd-message" too.

let source = null, started = false, connected = false, pollTimer = null;
let known = null;                      // threadId -> time of newest unread item, from the last summary
let viewing = null;                    // conversation on screen right now (no pop-up for it)

export const setViewing = id => { viewing = id || null; };
export const isViewing = id => !!id && viewing === id && typeof document !== "undefined" && !document.hidden;
export const isLive = () => connected;
const fire = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

async function summary() {
  try {
    const r = await fetch(moduleOn("messaging") ? "/api/messages/summary" : "/api/notices/summary", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } });
    if (r.status === 401) return;
    if (!r.ok) return;
    const s = await r.json();
    const now = new Map((s.latest || []).map(m => [m.id, m.at]));
    for (const m of s.importantUnread || []) now.set(m.id, now.get(m.id) || m.at);
    if (known) {
      for (const m of s.latest || []) {
        const before = known.get(m.id);
        if (!before || new Date(m.at) > new Date(before)) {
          fire("sgfd-message", { threadId: m.id, subject: m.subject, from: m.from, preview: "", important: m.important, kind: "", mine: false, fromSummary: true });
        }
      }
    }
    known = now;
    fire("sgfd-message-summary", s);
  } catch (e) { /* offline for a moment */ }
}

function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => { await summary(); schedule(); }, connected ? 90_000 : 30_000);
}

export function startLive(enabled) {
  if (started || typeof window === "undefined") return;
  started = true;
  summary();
  schedule();
  if (!enabled || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("hello", () => { connected = true; schedule(); });
  source.addEventListener("message", e => {
    let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ }
    if (known && !d.mine) known.set(d.threadId, new Date().toISOString());   // the safety-net check won't repeat it
    fire("sgfd-message", d);
  });
  source.addEventListener("changed", e => { let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ } fire("sgfd-messages-changed", d); });
  source.addEventListener("leave", e => { let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ } fire("sgfd-leave", d); });
  source.addEventListener("callalert", e => { let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ } fire("sgfd-callalert", d); });
  source.addEventListener("status", e => { let d = {}; try { d = JSON.parse(e.data); } catch (x) { /* ignore */ } fire("sgfd-status", d); });
  source.addEventListener("signedout", () => { source.close(); location.reload(); });
  source.onerror = () => { connected = false; schedule(); };
}
export function stopLive() { try { source?.close(); } catch (e) { /* ignore */ } clearTimeout(pollTimer); started = false; connected = false; }
