// Punch in / punch out. The server records the time (its clock), so it's the same from any device.
// Used on the Time Tracker and in the Your Day "Time this pay period" widget.
// (Its own file with its own colors so YourDay.jsx can load it without importing App.jsx.)
import React, { useEffect, useState } from "react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", SAGE = "#2E7D4F";

async function call(method, body) {
  const r = await fetch("/api/time/clock", {
    method, credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-SGFD": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
  return j;
}
const since = iso => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function PunchClock({ onChange, compact = false }) {
  const [state, setState] = useState(null);     // { open, pattern }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);         // { text, tone }
  const [, tick] = useState(0);
  const load = () => call("GET").then(setState, () => setState({ open: null, failed: true }));
  useEffect(() => { load(); const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t); }, []);

  async function punch(action) {
    setBusy(true); setMsg(null);
    try {
      const r = await call("POST", { action });
      setState(s => ({ ...s, open: r.open }));
      setMsg(action === "in"
        ? { text: `Punched in at ${r.open.start}.`, tone: SAGE }
        : { text: `Punched out at ${r.punched.end}: ${r.punched.start}–${r.punched.end}, ${r.punched.hours} h.`, tone: SAGE });
      onChange && onChange();
    } catch (e) { setMsg({ text: e.message, tone: BRICK }); load(); }
    setBusy(false);
  }

  if (!state) return null;
  const open = state.open;
  const button = {
    border: "none", borderRadius: 7, cursor: busy ? "default" : "pointer", fontFamily: "inherit", fontWeight: 800,
    fontSize: compact ? 13 : 14.5, padding: compact ? "7px 14px" : "10px 20px", color: "#fff",
    background: open ? BRICK : SAGE, opacity: busy ? 0.6 : 1, whiteSpace: "nowrap",
  };
  return (
    <div role="group" aria-label="Punch clock" style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      ...(compact ? { borderTop: `1px dashed ${LINE}`, paddingTop: 10, marginTop: 10 } : {}),
    }}>
      <button type="button" style={button} disabled={busy} onClick={() => punch(open ? "out" : "in")}>
        {open ? "Punch out" : "Punch in"}
      </button>
      <div style={{ fontSize: compact ? 12.5 : 13.5, color: INK, minWidth: 0, flex: "1 1 160px" }}>
        {open
          ? <><b>On the clock</b> since {open.start}{open.date !== new Date().toLocaleDateString("en-CA") ? ` (${open.date})` : ""} · {since(open.startedAt)}</>
          : <span style={{ color: INK_SOFT }}>Records the time now. Punch out when you leave.</span>}
        {msg && <div style={{ color: msg.tone, fontSize: 12.5, marginTop: 2 }}>{msg.text}</div>}
      </div>
    </div>
  );
}
