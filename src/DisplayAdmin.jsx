// User Management › Display screens: pair a TV (enter the code it shows), choose what it cycles through, sign it out.
// Server: server/display.js (/api/display/screens). The TV itself runs src/Display.jsx at /display.
import React, { useEffect, useState } from "react";
import { BRAND } from "./brand.js";
import { MonitorSmartphone, LogOut, Trash2, Pencil } from "lucide-react";
import { cardStyle, inputStyle, btn } from "./App.jsx";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", SAGE = "#2E7D4F";
const ORDER = ["spot", "duty", "weather", "oncall", "classes", "calls"];

async function call(path, body) {
  const r = await fetch(`/api/display/screens${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const ago = iso => { if (!iso) return "never"; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };

function SettingsFields({ v, setV, viewNames }) {
  const toggle = k => setV({ ...v, views: v.views.includes(k) ? v.views.filter(x => x !== k) : ORDER.filter(x => x === k || v.views.includes(x)) });
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 10 }}>What it shows, in turn</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 4 }}>
        {ORDER.filter(k => viewNames?.[k]).map(k => (
          <label key={k} style={{ fontSize: 13.5, display: "flex", gap: 5, alignItems: "center" }}>
            <input type="checkbox" checked={v.views.includes(k)} onChange={() => toggle(k)} /> {viewNames[k]}
          </label>))}
      </div>
      {v.views.includes("calls") && <div style={{ fontSize: 12.5, color: AMBER, marginTop: 4 }}>Active calls show addresses. Only turn this on for a screen in a room the public can't see.</div>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <label style={{ fontSize: 13.5 }}>Seconds per view <input aria-label="Seconds per view" type="number" min={8} max={120} value={v.seconds} onChange={e => setV({ ...v, seconds: e.target.value })} style={{ ...inputStyle, width: 80, display: "inline-block", marginLeft: 6 }} /></label>
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={v.switchToBoard} onChange={e => setV({ ...v, switchToBoard: e.target.checked })} /> Switch to an open Command Board on its own
        </label>
      </div>
      {v.switchToBoard && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 4 }}>When an officer opens a Command Board on a real incident, this screen shows it live (read-only), with the address, crews and timeline, until the board is closed. Training boards never show.</div>}
    </>
  );
}

export default function DisplayScreensPanel({ toast }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [add, setAdd] = useState({ code: "", name: "", views: ["duty", "weather", "oncall", "classes"], seconds: 20, switchToBoard: true });
  const [editing, setEditing] = useState(null);
  const load = () => call("").then(setD, e => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!d) return <div style={{ color: error ? BRICK : INK_SOFT }}>{error || "Loading…"}</div>;

  const pair = async () => {
    try { await call("", add); setAdd({ ...add, code: "", name: "" }); setError(""); toast?.("Screen paired"); load(); } catch (e) { setError(e.message); }
  };
  const save = async () => { try { await call(`/${editing.id}`, editing); setEditing(null); toast?.("Saved"); load(); } catch (e) { setError(e.message); } };
  const act = async (s, what, ask) => { if (!window.confirm(ask)) return; try { await call(`/${s.id}/${what}`, {}); load(); } catch (e) { setError(e.message); } };

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, color: INK, display: "flex", gap: 8, alignItems: "center" }}><MonitorSmartphone size={16} /> Add a screen</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 4 }}>
          On the TV's computer, open <b>{BRAND.host || location.host}/display</b> in the browser (full screen with F11). It shows a code. Enter it here.
          The screen gets its own view-only sign-in: it can't open messages, personnel files or anything else, and it stays signed in until you sign it out.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <input aria-label="Code on the screen" placeholder="Code on the screen" value={add.code} onChange={e => setAdd({ ...add, code: e.target.value.toUpperCase() })} style={{ ...inputStyle, width: 190, letterSpacing: 3, fontWeight: 700 }} />
          <input aria-label="Screen name" placeholder="Name, e.g. Station 61 day room" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
        </div>
        <SettingsFields v={add} setV={setAdd} viewNames={d.views} />
        <button style={{ ...btn("primary"), marginTop: 12 }} onClick={pair}>Pair screen</button>
        {error && <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 800, color: INK, marginBottom: 6 }}>Screens</div>
        {!d.screens.length && <div style={{ fontSize: 13, color: INK_SOFT }}>No screens yet.</div>}
        {d.screens.map(s => (
          <div key={s.id} role="listitem" aria-label={s.name} style={{ borderTop: `1px solid ${LINE}`, padding: "10px 0" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ color: INK }}>{s.name}</b>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.paired ? SAGE : INK_SOFT }}>{s.paired ? `Signed in · seen ${ago(s.lastSeenAt)}` : "Signed out"}</span>
              <span style={{ fontSize: 12.5, color: INK_SOFT }}>{s.views.map(v => d.views[v]).join(" · ")}{s.switchToBoard ? " · switches to Command Boards" : ""} · {s.seconds} s each</span>
              <span style={{ flex: 1 }} />
              <button style={btn("outline")} onClick={() => setEditing(editing?.id === s.id ? null : { ...s })}><Pencil size={13} /> Edit</button>
              {s.paired && <button style={btn("outline")} onClick={() => act(s, "signout", `Sign out ${s.name}? It goes back to showing a pairing code.`)}><LogOut size={13} /> Sign out</button>}
              <button style={{ ...btn("ghost"), color: BRICK }} aria-label={`Remove ${s.name}`} onClick={() => act(s, "remove", `Remove ${s.name}?`)}><Trash2 size={14} /></button>
            </div>
            {editing?.id === s.id && (
              <div style={{ background: "#F7F8FA", borderRadius: 8, padding: 12, marginTop: 8 }}>
                <input aria-label="Screen name" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} style={{ ...inputStyle, maxWidth: 360 }} />
                <SettingsFields v={editing} setV={setEditing} viewNames={d.views} />
                <button style={{ ...btn("primary"), marginTop: 10 }} onClick={save}>Save</button>
              </div>)}
          </div>))}
      </div>
    </div>
  );
}
