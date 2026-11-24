// "Active calls" on Your Day: calls open in CentralSquare CAD right now (server/cad.js).
// Hidden entirely until CAD is set up in .env. Checks as often as Nexus reads CAD (CAD_REFRESH_SECONDS, 15 by default).
import React, { useEffect, useRef, useState } from "react";
import { Phone, MapPin, Bell, BellOff, Flame, X } from "lucide-react";
import { chime } from "./chime.js";
import { useSession } from "./session.js";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", SAGE = "#2E7D4F";
const POLL_MS = 15_000;
const SOUND_KEY = "sgfd-call-sound";
const callSoundOn = () => { try { return localStorage.getItem(SOUND_KEY) === "on"; } catch (e) { return false; } };

function elapsed(iso, now) {
  if (!iso) return "";
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d`;
}
const clock = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const mapHref = c => c.lat != null && c.lon != null
  ? `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lon}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c.address, c.city].filter(Boolean).join(", "))}`;
const BLUE = "#1D5FA8";
const FIRE_CALL = /FIRE/i;
const unitKey = u => String(u || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const openModule = (module, init) => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module, init } }));
async function openBoard(c, boardId) {
  if (boardId) return openModule("command", { board: boardId });
  try {
    const r = await fetch("/api/command/open", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ incidentId: c.id }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    openModule("command", { board: j.id });
  } catch (e) { window.alert(e.message || "Couldn't open the command board."); }
}
const statusColor = s => /patient|contact/i.test(s) ? BLUE : /scene|arriv/i.test(s) ? BRICK : /enroute|en route|respond/i.test(s) ? AMBER : /dispatch/i.test(s) ? INK : INK_SOFT;

export default function ActiveCalls() {
  const [snap, setSnap] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(callSoundOn);
  const seen = useRef(null);
  const { user } = useSession();
  const [diag, setDiag] = useState(null);
  const [riders, setRiders] = useState({});        // unit -> [{name, position}]: Aladtec ride positions, else directory call sign
  const [boards, setBoards] = useState({});        // CAD incident id -> command board id
  const [canCommand, setCanCommand] = useState(false);
  const [ride, setRide] = useState(null);          // unit whose ride list is open
  const unitsKey = useRef("");
  const feedCheck = async () => {
    if (diag) { setDiag(null); return; }
    try { await fetch("/api/cad/refresh", { method: "POST", credentials: "same-origin", headers: { "X-SGFD": "1" } }); } catch (e) {}
    try { const r = await fetch("/api/cad/diagnostics", { credentials: "same-origin" }); setDiag(await r.json()); } catch (e) { setDiag({ error: e.message }); }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/cad/active", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } });
        if (!r.ok) return;
        const s = await r.json();
        if (!alive) return;
        const ids = new Set((s.calls || []).map(c => c.id));
        if (seen.current && [...ids].some(id => !seen.current.has(id)) && callSoundOn()) chime(true);
        seen.current = ids;
        setSnap(s); setNow(Date.now());
        // Who is riding each unit (only asked again when the units change) and which fire calls have a command board
        const units = [...new Set((s.calls || []).flatMap(c => c.units || []))].sort().join(",");
        const rideKey = `${units}|${Math.floor(Date.now() / 300000)}`;   // and again every 5 minutes (shift change)
        if (units && rideKey !== unitsKey.current) {
          fetch(`/api/command/riders?units=${encodeURIComponent(units)}`, { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
            .then(r => (r.ok ? r.json() : null)).then(j => { if (j && alive) { unitsKey.current = rideKey; setRiders(j.riders || {}); } }).catch(() => {});
        }
        if ((s.calls || []).some(c => FIRE_CALL.test(c.type || ""))) {
          fetch("/api/command", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } }).then(r => (r.ok ? r.json() : null)).then(j => {
            if (!j || !alive) return;
            setCanCommand(!!j.canEdit);
            setBoards(Object.fromEntries((j.boards || []).filter(b => b.status === "open").map(b => [String(b.incidentId), b.id])));
          }).catch(() => {});
        }
        if (s.refreshSeconds >= 10) wait = s.refreshSeconds * 1000;
      } catch (e) { /* offline: keep the last list */ }
    };
    let wait = POLL_MS, t = null;
    const loop = async () => { await load(); if (alive) t = setTimeout(loop, wait); };
    loop();
    return () => { alive = false; clearTimeout(t); };
  }, []);

  if (!snap || !snap.configured) return null;
  const calls = snap.calls || [];
  const toggleSound = () => { const on = !sound; setSound(on); try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch (e) {} if (on) chime(true); };

  return (
    <section aria-label="Active calls" style={{ background: "#fff", border: `1px solid ${LINE}`, borderLeft: `4px solid ${calls.length ? BRICK : SAGE}`, borderRadius: 8, marginBottom: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderBottom: calls.length ? `1px solid ${LINE}` : "none", flexWrap: "wrap" }}>
        <Phone size={19} color={calls.length ? BRICK : SAGE} strokeWidth={2.2} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, textTransform: "uppercase", letterSpacing: 0.6 }}>Active calls</span>
        {calls.length > 0 && <span style={{ background: BRICK, color: "#fff", borderRadius: 999, fontSize: 11.5, fontWeight: 700, padding: "1px 8px" }}>{calls.length}</span>}
        {calls.length === 0 && !snap.error && <span style={{ fontSize: 13.5, color: SAGE, fontWeight: 600, marginLeft: 6 }}>No active calls.</span>}
        {snap.error && <span style={{ fontSize: 12.5, color: AMBER, fontWeight: 600, marginLeft: 6 }}>{snap.error}</span>}
        <span style={{ flex: 1 }} />
        {snap.updatedAt && <span style={{ fontSize: 11.5, color: INK_SOFT }}>Updated {clock(snap.updatedAt)}</span>}
        {user?.role === "master" && <button onClick={feedCheck} aria-pressed={!!diag} style={{ border: `1px solid ${LINE}`, background: "#fff", color: INK, cursor: "pointer", fontSize: 12, padding: "2px 9px", borderRadius: 999, fontFamily: "inherit" }}>Feed check</button>}
        <button onClick={toggleSound} aria-pressed={sound} title="Ding when a new call comes in"
          style={{ border: `1px solid ${LINE}`, background: "#fff", color: sound ? INK : INK_SOFT, cursor: "pointer", fontSize: 12, padding: "2px 9px", borderRadius: 999, fontFamily: "inherit" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{sound ? <Bell size={13} color={AMBER} fill="#F4B860" /> : <BellOff size={13} />}{sound ? "New-call ding on" : "New-call ding off"}</span>
        </button>
      </div>
      <style>{`@keyframes cbglow{0%,100%{box-shadow:0 0 0 0 rgba(200,16,46,.55)}50%{box-shadow:0 0 0 6px rgba(200,16,46,0)}} .cb-glow{animation:cbglow 1.6s infinite}`}</style>
      {diag && <FeedCheck d={diag} />}
      <div role="list" aria-label="Calls" style={{ maxHeight: 400, overflowY: "auto", overscrollBehavior: "contain" }}>
      {calls.map((c, i) => (
        <div key={c.id} role="listitem" style={{ display: "flex", gap: 14, padding: "10px 18px", borderTop: i ? `1px solid ${LINE}` : "none", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 800, fontSize: 14.5, color: INK }}>{c.type || "Call"}</span>
              {c.priority && <span style={{ fontSize: 11.5, fontWeight: 700, color: BRICK, border: `1px solid ${BRICK}55`, borderRadius: 4, padding: "0 5px" }}>P{String(c.priority).replace(/^p/i, "")}</span>}
              {c.status && <span style={{ fontSize: 12, fontWeight: 700, color: statusColor(c.status) }}>{c.status}</span>}
              {c.agency && <span style={{ fontSize: 11.5, color: INK_SOFT }}>{c.agency}</span>}
            </div>
            <a href={mapHref(c)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13.5, color: "#1D5FA8", marginTop: 2, textDecoration: "none" }}>
              <MapPin size={13} /> {[c.address, c.city].filter(Boolean).join(", ") || "Location not given"}
            </a>
            {c.crossStreets && <div style={{ fontSize: 12, color: INK_SOFT }}>Near {c.crossStreets}</div>}
            {c.units.length > 0 && (
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                {(c.unitStatus || c.units.map(u => ({ unit: u, status: "" }))).map(u => {
                  const who = riders[unitKey(u.unit)] || [];
                  const open = ride === `${c.id}|${u.unit}`;
                  return (
                    <span key={u.unit}>
                      <button onClick={() => setRide(open ? null : `${c.id}|${u.unit}`)} aria-expanded={open} aria-label={`${u.unit} ride list`}
                        title={who.length ? who.map(r => r.name).join(", ") : u.status || "Who's riding isn't known"}
                        style={{ fontSize: 11.5, fontWeight: 700, color: INK, background: "#EEF1F5", border: "none", borderRadius: 4, padding: "2px 7px", cursor: "pointer", fontFamily: "inherit", borderLeft: u.status ? `3px solid ${statusColor(u.status)}` : undefined }}>
                        {u.unit}{u.status && <span style={{ fontWeight: 600, color: statusColor(u.status) }}> · {u.status}</span>}</button>
                    </span>);
                })}
              </div>
            )}
            {(() => {
              const u = (c.unitStatus || c.units.map(x => ({ unit: x, status: "" }))).find(x => ride === `${c.id}|${x.unit}`);
              if (!u) return null;
              const who = riders[unitKey(u.unit)] || [];
              return (
                <div role="dialog" aria-label={`Riding ${u.unit}`} style={{ marginTop: 6, maxWidth: 360, background: "#fff", border: `1px solid ${LINE}`, borderLeft: `3px solid ${statusColor(u.status)}`, borderRadius: 8, boxShadow: "0 4px 14px rgba(19,35,63,.12)", padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}><b style={{ flex: 1, fontSize: 13, color: INK }}>{u.unit}{u.status ? ` · ${u.status}` : ""}</b>
                    <button aria-label="Close" onClick={() => setRide(null)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}><X size={14} /></button></div>
                  {!who.length && <div style={{ fontSize: 12.5, color: INK_SOFT }}>Not on today's Aladtec schedule, and no one has this call sign in the directory.</div>}
                  {who.map(r => <div key={r.name} style={{ fontSize: 13, color: INK, padding: "2px 0" }}>{r.name}{r.position && <span style={{ color: INK_SOFT, fontSize: 12 }}> · {r.position}</span>}</div>)}
                  {who.length > 0 && <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 4 }}>{who[0].source === "aladtec" ? "From today's Aladtec schedule" : "From the directory call sign"}</div>}
                </div>);
            })()}
            {FIRE_CALL.test(c.type || "") && (boards[String(c.id)] || canCommand) && (
              <button onClick={() => openBoard(c, boards[String(c.id)])} className="cb-glow"
                style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, background: BRICK, color: "#fff", border: "none", borderRadius: 6, padding: "5px 12px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                <Flame size={14} /> {boards[String(c.id)] ? "Command board" : "Open command board"}</button>)}
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: INK_SOFT, minWidth: 90 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: INK }}>{elapsed(c.receivedAt, now)}</div>
            {c.receivedAt && <div>since {clock(c.receivedAt)}</div>}
            {c.number && <div>#{c.number}</div>}
            {(c.otherNumbers || []).map(n => <div key={n} title="A second CAD record at the same address">+ #{n}</div>)}
          </div>
        </div>
      ))}
      </div>
      {calls.length > 4 && <div style={{ fontSize: 11.5, color: INK_SOFT, padding: "5px 18px", borderTop: `1px solid ${LINE}`, background: "#F8F9FB" }}>{calls.length} active calls · scroll for more</div>}
    </section>
  );
}

// Master admins: what the CAD view is giving Nexus (column names and counts; no addresses), to sort out missing calls or units
function FeedCheck({ d }) {
  const f = d.found || {}, st = d.stats || {};
  const line = (ok, text) => <div style={{ color: ok ? INK : BRICK }}>{ok ? "✓" : "✗"} {text}</div>;
  return (
    <div role="region" aria-label="CAD feed check" style={{ background: "#F3F5F8", padding: "10px 18px", fontSize: 12.5, borderBottom: `1px solid ${LINE}`, display: "grid", gap: 3 }}>
      {d.error && <div style={{ color: BRICK, fontWeight: 700 }}>{d.error}</div>}
      <div><b>Query:</b> <code style={{ fontSize: 11.5 }}>{d.sql}</code></div>
      <div><b>Columns in the view:</b> {(d.columns || []).join(", ") || "none"}</div>
      {line(!!f.id, f.id ? `Incident id column: ${f.id}` : "No incident_id column: calls can't be told apart")}
      {line(!!f.received, f.received ? `Received time column: ${f.received} (newest calls first)` : "No received_at column: " + PN + " can't ask for the newest calls first")}
      {line(!!f.closed, f.closed ? `Closed column: ${f.closed} (open calls only)` : "No closed_at column: the view must already hold only open calls")}
      {line(!!f.units, f.units ? `Units column: ${f.units}${d.unitColumnsEmpty ? ` (empty on ${d.unitColumnsEmpty} of ${st.rows} rows)` : ""}` : "No units column (units, unit, unit_id …): units can't show")}
      <div><b>This check:</b> {st.rows ?? 0} rows read → {st.calls ?? 0} calls ({st.withUnits ?? 0} with units){st.merged ? `, ${st.merged} extra rows merged into their call` : ""}{st.closed ? `, ${st.closed} closed skipped` : ""}{st.stale ? `, ${st.stale} older than the cutoff skipped` : ""}{st.noId ? `, ${st.noId} with no incident id skipped` : ""}{st.noAddress ? `, ${st.noAddress} with no address left off` : ""}{st.oldPending ? `, ${st.oldPending} waiting with no units too long left off` : ""}{st.untypedPending ? `, ${st.untypedPending} with no units and no call type (duplicate / linked / test) left off` : ""}{st.sameCall ? `, ${st.sameCall} second record${st.sameCall === 1 ? "" : "s"} at the same address shown with ${st.sameCall === 1 ? "its" : "their"} call` : ""}.</div>
      {(d.calls || []).length > 0 && <div><b>Calls:</b> {d.calls.map(c => `${c.number || "?"} ${c.type || ""} (${c.units} unit${c.units === 1 ? "" : "s"})`).join(" · ")}</div>}
    </div>
  );
}
