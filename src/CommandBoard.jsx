// Command Board: the incident commander's board for a fire call (server/command.js). Opened from the button on a fire
// call in Active calls, or from the Command Board tile (open boards + past boards). Every tap is saved on the server as
// it happens, so closing the app or changing screens loses nothing. If the network drops, changes wait on this device
// and are sent as soon as it's back. When the board is closed it becomes a record: an after-action report (HTML file,
// printable), listed here, in the commander's Personnel File, and on the Working Fire Recording for the same incident.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flame, Siren, Plus, GraduationCap, Copy, Trash2, Timer, Wind, Radio, Printer, FileDown, Users, AlertTriangle, X, Map as MapIcon, LayoutGrid, Check, ArrowLeft, ClipboardList } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { setEmergency } from "./emergency.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", SAGE = "#2E7D4F", BLUE = "#1D5FA8", PAPER = "#F3F5F8";
export const LOCATIONS = [["assigned", "Assigned / en route"], ["staged", "Staged"], ["interior", "Interior"], ["exterior", "Exterior"], ["rit", "RIT"], ["rehab", "Rehab"], ["released", "Released"]];
const LOC_NAME = Object.fromEntries(LOCATIONS);
const LOC_COLOR = { interior: BRICK, exterior: AMBER, rit: BLUE, staged: INK, rehab: SAGE, assigned: INK_SOFT, released: "#8A93A3" };
export const BENCHMARKS = [["waterOnFire", "Water on the fire"], ["primaryStart", "Primary search started"], ["primary", "Primary all clear"], ["secondaryStart", "Secondary search started"], ["secondary", "Secondary all clear"], ["underControl", "Under control"], ["lossStopped", "Loss stopped"], ["utilities", "Utilities secured"]];
const SMOKE = { volume: ["Light", "Moderate", "Heavy"], velocity: ["Lazy", "Pushing", "Turbulent"], density: ["Thin", "Thick", "Black fire"], color: ["White", "Gray", "Brown", "Black"] };
const EDGES = ["bottom", "left", "top", "right"];             // clockwise; A is whichever edge is the front, then B, C, D
export const FIRE_CALL = /FIRE/i;
// PAR: every 13 minutes for the first hour, then every 10
export const parInterval = elapsedMin => (elapsedMin < 60 ? 13 : 10);

async function api(path, body, base = "/api/command") {
  const r = await fetch(`${base}${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work."), { status: r.status });
  return j;
}
const qKey = id => `sgfd-cmd-queue-${id}`;
const readQ = id => { try { return JSON.parse(localStorage.getItem(qKey(id)) || "[]"); } catch (e) { return []; } };
const writeQ = (id, q) => { try { q.length ? localStorage.setItem(qKey(id), JSON.stringify(q)) : localStorage.removeItem(qKey(id)); } catch (e) { /* storage off */ } };
const hms = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`; };
const clock = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "");
const when = iso => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "");

export default function CommandBoardModule({ onBack, init }) {
  const [boardId, setBoardId] = useState(init?.board || null);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [making, setMaking] = useState(false);
  const load = () => api("").then(setList, e => setError(e.message));
  const again = async b => { try { const j = await api("/new", { copyFrom: b.id, kind: "training" }); setBoardId(j.id); } catch (e) { setError(e.message); } };
  useEffect(() => { if (!boardId) load(); }, [boardId]);
  const nav = [{ key: "list", label: "Command boards", icon: ClipboardList }];
  if (boardId) return <Board id={boardId} onBack={() => setBoardId(null)} onHome={onBack} />;
  const all = list?.boards || [];
  const open = all.filter(b => b.status === "open"), closed = all.filter(b => b.status !== "open" && b.kind !== "training"), training = all.filter(b => b.status !== "open" && b.kind === "training");
  return (
    <AppShell section="Command Board" nav={nav} active="list" onNav={() => {}} onHome={onBack}>
      <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Command boards</div>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "2px 0 14px" }}>
        Boards are opened from the <b>Command board</b> button on a fire call in Active calls. Closed boards are kept here as after-action records for working fire reviews.
        You can also make a <b>training board</b> to teach the board, or a board for a real incident that isn't in CAD.
      </div>
      {list?.canEdit && !making && <button style={{ ...btn("primary"), marginBottom: 14 }} onClick={() => setMaking(true)}><Plus size={14} /> New board</button>}
      {making && <NewBoard onCancel={() => setMaking(false)} onMade={id => { setMaking(false); setBoardId(id); }} />}
      {error && <div role="alert" style={{ color: BRICK, marginBottom: 10 }}>{error}</div>}
      {!list && !error && <div style={{ color: INK_SOFT }}>Loading…</div>}
      {list && <>
        <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 0" }}>Open now ({open.length})</div>
        {!open.length && <div style={{ ...cardStyle, color: INK_SOFT, fontSize: 13.5 }}>No open command boards.</div>}
        {open.map(b => <BoardRow key={b.id} b={b} onOpen={() => setBoardId(b.id)} />)}
        <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 6px" }}>Closed (last 60 days)</div>
        {!closed.length && <div style={{ ...cardStyle, color: INK_SOFT, fontSize: 13.5 }}>None yet.</div>}
        {closed.map(b => <BoardRow key={b.id} b={b} onOpen={() => setBoardId(b.id)} />)}
        <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "18px 0 6px" }}>Saved training boards ({training.length})</div>
        {!training.length && <div style={{ ...cardStyle, color: INK_SOFT, fontSize: 13.5 }}>None saved. Training boards you keep when you close them show up here for future reference.</div>}
        {training.map(b => <BoardRow key={b.id} b={b} onOpen={() => setBoardId(b.id)} onAgain={list.canEdit ? () => again(b) : null} />)}
        {list.manage && <SettingsCard s={list.settings} />}
      </>}
    </AppShell>
  );
}

export function BoardRow({ b, onOpen, onAgain }) {
  return (
    <div style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8, padding: "10px 14px", borderLeft: `4px solid ${b.status === "open" ? BRICK : SAGE}` }}>
      <Flame size={18} color={b.status === "open" ? BRICK : INK_SOFT} />
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontWeight: 800, color: INK }}>{b.kind === "training" && <TrainingTag />} {b.title || b.nature || "Fire call"} {b.number && <span style={{ fontWeight: 600, color: INK_SOFT, fontSize: 12.5 }}>#{b.number}</span>}
          {!b.fromCad && b.kind !== "training" && <span style={{ fontWeight: 600, color: INK_SOFT, fontSize: 12 }}> · not from CAD</span>}</div>
        <div style={{ fontSize: 13, color: INK_SOFT }}>{[b.title && b.nature, b.address].filter(Boolean).join(" · ")}</div>
        <div style={{ fontSize: 12, color: INK_SOFT }}>Opened {when(b.openedAt)} by {b.openedBy}{b.closedAt ? ` · closed ${when(b.closedAt)}${b.completedBy ? ` by ${b.completedBy}` : ""}` : ""}</div>
      </div>
      <button style={btn(b.status === "open" ? "primary" : "outline")} onClick={onOpen}>{b.status === "open" ? "Open board" : "View board"}</button>
      {onAgain && <button style={btn("outline")} onClick={onAgain} title="A new training board with the same setup (address, units, scene)"><Copy size={14} /> Run again</button>}
      <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/command/${b.id}/report`} target="_blank" rel="noopener noreferrer"><Printer size={14} /> Report</a>
    </div>
  );
}

const TrainingTag = () => <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: BLUE, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.5, verticalAlign: 2 }}>TRAINING</span>;

function NewBoard({ onCancel, onMade }) {
  const [v, setV] = useState({ kind: "training", title: "", nature: "", address: "", number: "", units: "", findAddress: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const set = (k, x) => setV(o => ({ ...o, [k]: x }));
  const make = async () => {
    setBusy(true); setError("");
    try { const j = await api("/new", v); onMade(j.id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const lab = { fontSize: 13, display: "block", marginTop: 8 };
  return (
    <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `4px solid ${v.kind === "training" ? BLUE : BRICK}` }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>New command board</div>
      <div role="radiogroup" aria-label="Kind of board" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["training", "Training", "To teach the board. Notifications aren't silenced; keep it or discard it when you close it."], ["incident", "Real incident not in CAD", "Emergency mode and an after-action record, like a board opened from Active calls."]].map(([k, l, d]) => (
          <label key={k} style={{ flex: "1 1 240px", border: `2px solid ${v.kind === k ? (k === "training" ? BLUE : BRICK) : LINE}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 13 }}>
            <input type="radio" name="cb-kind" checked={v.kind === k} onChange={() => set("kind", k)} /> <b>{l}</b><div style={{ color: INK_SOFT, fontSize: 12.5 }}>{d}</div></label>))}
      </div>
      {v.kind === "training" && <label style={lab}>Name for this training (e.g. B-shift drill: 2-story residential, fire on floor 2)
        <input aria-label="Training name" style={{ ...inputStyle, marginTop: 4 }} value={v.title} onChange={e => set("title", e.target.value)} /></label>}
      <label style={lab}>Nature
        <input aria-label="Nature" style={{ ...inputStyle, marginTop: 4 }} value={v.nature} onChange={e => set("nature", e.target.value)} placeholder="Structure fire, residential" /></label>
      <label style={lab}>Address{v.kind === "training" ? " (optional; a real building makes the aerial useful)" : ""}
        <input aria-label="Address" style={{ ...inputStyle, marginTop: 4 }} value={v.address} onChange={e => set("address", e.target.value)} placeholder="Street address, city, state" /></label>
      {v.address && <label style={{ ...lab, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={v.findAddress} onChange={e => set("findAddress", e.target.checked)} /> Find it on the map (so the board can show the USGS aerial)</label>}
      {v.kind === "incident" && <label style={lab}>Incident number (if there is one)
        <input aria-label="Incident number" style={{ ...inputStyle, marginTop: 4, maxWidth: 220 }} value={v.number} onChange={e => set("number", e.target.value)} /></label>}
      <label style={lab}>Units (separated by commas; crews are filled in from Aladtec and call signs)
        <input aria-label="Units" style={{ ...inputStyle, marginTop: 4 }} value={v.units} onChange={e => set("units", e.target.value)} placeholder="EG653, LD618, SG10" /></label>
      {error && <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={btn("primary")} disabled={busy} onClick={make}>{busy ? "Making…" : v.kind === "training" ? "Start training board" : "Open command board"}</button>
        <button style={btn("outline")} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SettingsCard({ s }) {
  const [v, setV] = useState(s || {}); const [msg, setMsg] = useState("");
  return (
    <div style={{ ...cardStyle, marginTop: 22 }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Settings</div>
      <label style={{ fontSize: 13, display: "block" }}>Job titles that can run a board (words separated by |)
        <input aria-label="Officer titles" style={{ ...inputStyle, marginTop: 4 }} value={v.officerTitles || ""} onChange={e => setV({ ...v, officerTitles: e.target.value })} /></label>
      <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>Warn when a crew has been interior this many minutes
        <input aria-label="Interior warning minutes" type="number" min={5} max={60} style={{ ...inputStyle, width: 90, marginTop: 4 }} value={v.interiorWarnMinutes || 20} onChange={e => setV({ ...v, interiorWarnMinutes: e.target.value })} /></label>
      <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>Anyone else can be given Command board: Edit under Permissions.</div>
      <button style={{ ...btn("primary"), marginTop: 10 }} onClick={() => fetch("/api/command/settings", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(v) })
        .then(r => r.json().then(j => setMsg(r.ok ? "Saved." : j.error)))}>Save settings</button> <span role="status" style={{ fontSize: 13 }}>{msg}</span>
    </div>
  );
}

// ---- One board ----------------------------------------------------------------------------------
// A TV display screen shows a board without the side bar (DisplayFrame), read-only, from /api/display.
const DisplayFrame = ({ children }) => (
  <div className="sgfd-display" style={{ padding: "14px 22px", background: PAPER, minHeight: "100vh", boxSizing: "border-box", color: INK, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
    <style>{`.sgfd-display button, .sgfd-display input, .sgfd-display select { font-family: inherit; }`}</style>{children}</div>);
export function Board({ id, onBack, onHome, display = false }) {
  const [b, setB] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(() => readQ(id).length);
  const [offset, setOffset] = useState(0);              // server clock - this device's clock
  const [now, setNow] = useState(Date.now());
  const [dialog, setDialog] = useState(null);           // "mayday" | "smoke" | "par" | {crew}
  const [busy, setBusy] = useState(false);
  const ver = useRef(0);
  const working = useRef(false);                       // running this board (an officer, board open) -> emergency mode
  useEffect(() => {
    if (display) return;
    working.current = !!(b?.canEdit && b?.status === "open" && b?.kind !== "training");
    setEmergency(working.current);
  }, [b?.canEdit, b?.status, b?.kind]);
  useEffect(() => () => { if (display) return; setEmergency(false); fetch(`/api/command/${id}?em=0`, { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } }).catch(() => {}); }, [id]);

  const take = j => { if (j.now) setOffset(new Date(j.now).getTime() - Date.now()); if (!j.same) { setB(j); ver.current = j.version; } };
  const flush = async () => {
    let q = readQ(id);
    while (q.length) {
      try { take(await api(`/${id}/action`, q[0])); }
      catch (e) { if (!e.status) break; setError(e.message); }      // still offline: keep waiting; refused: drop it
      q = q.slice(1); writeQ(id, q);
    }
    setPending(readQ(id).length);
  };
  useEffect(() => {
    let alive = true, t;
    const tick = async () => {
      try {
        if (!display) await flush();
        const j = display ? await api(`/board/${id}?v=${ver.current}`, undefined, "/api/display") : await api(`/${id}?v=${ver.current}&em=${working.current ? 1 : 0}`);
        if (alive) { take(j); setError(""); }
      }
      catch (e) { if (alive && e.status) setError(e.message); }
      if (alive) t = setTimeout(tick, 3000);
    };
    tick();
    const clockT = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; clearTimeout(t); clearInterval(clockT); };
  }, [id]);

  // Every change goes straight to the server; with no connection it waits on this device and is sent when it's back
  const act = async a => {
    setBusy(true);
    try { take(await api(`/${id}/action`, a)); setError(""); }
    catch (e) {
      if (!e.status) { writeQ(id, [...readQ(id), a]); setPending(readQ(id).length); }
      else setError(e.message);
    } finally { setBusy(false); }
  };

  const discard = async () => {
    try { await api(`/${id}/discard`, {}); onBack(); } catch (e) { setError(e.message); }
  };
  const Shell = display ? DisplayFrame : AppShell;
  if (!b) return <Shell section="Command Board" nav={[]} active="" onNav={() => {}} onHome={onHome}><div style={{ color: error ? BRICK : INK_SOFT }}>{error || "Loading…"}</div></Shell>;
  const st = b.state, edit = b.canEdit && b.status === "open", training = b.kind === "training";
  const t = now + offset;
  const start = new Date(b.receivedAt || b.openedAt).getTime();
  const elapsedMs = (b.closedAt ? new Date(b.closedAt).getTime() : t) - start;
  const parLast = new Date(st.par?.lastAt || b.receivedAt || b.openedAt).getTime();
  const parEvery = parInterval((parLast - start) / 60000) * 60000;
  const parDue = parLast + parEvery - t;
  const crewsBy = loc => st.crews.filter(c => c.location === loc);
  const warn = (b.settings?.interiorWarnMinutes || 20) * 60000;

  return (
    <Shell section="Command Board" nav={[]} active="" onNav={() => {}} onHome={onHome}>
      <style>{`@keyframes cbpulse{0%,100%{opacity:1}50%{opacity:.45}} .cb-pulse{animation:cbpulse 1s infinite}`}</style>
      {training && (
        <div role="status" aria-label="Training board" style={{ position: "sticky", top: 0, zIndex: 50, margin: "-4px 0 10px", background: BLUE, color: "#fff", borderRadius: 6, padding: "7px 12px", display: "flex", gap: 8, alignItems: "center", fontWeight: 800, fontSize: 13.5, letterSpacing: 0.3, flexWrap: "wrap" }}>
          <GraduationCap size={16} /> TRAINING BOARD · not a real incident
          <span style={{ fontWeight: 600, fontSize: 12.5, opacity: 0.9 }}>· on a real fire this bar reads EMERGENCY MODE and notifications are silenced; here they aren't.</span>
        </div>)}
      {edit && !training && (
        <div role="status" aria-label="Emergency mode" style={{ position: "sticky", top: 0, zIndex: 50, margin: "-4px 0 10px", background: "#7A0019", color: "#fff", borderRadius: 6, padding: "7px 12px", display: "flex", gap: 8, alignItems: "center", fontWeight: 800, fontSize: 13.5, letterSpacing: 0.3 }}>
          <Siren size={16} /> EMERGENCY MODE · Command Board active
          <span style={{ fontWeight: 600, fontSize: 12.5, opacity: 0.9 }}>· notifications, pop-ups and sounds are silenced. Messages still come in; open the chat to read them.</span>
        </div>)}
      {!display && <button onClick={onBack} style={{ ...btn("outline"), marginBottom: 10 }}><ArrowLeft size={14} /> All boards</button>}

      {/* Header: call, the incident clock, PAR */}
      <div style={{ ...cardStyle, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", borderLeft: `5px solid ${BRICK}` }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: INK }}>{training ? <TrainingTag /> : <Flame size={18} color={BRICK} />} {b.title || b.nature || "Fire call"} {b.number && <span style={{ fontSize: 13, color: INK_SOFT }}>#{b.number}</span>}</div>
          <div style={{ fontSize: 14, color: INK }}>{[b.title && b.nature, b.address].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 12, color: INK_SOFT }}>Board opened {clock(b.openedAt)} by {b.openedBy}{b.status === "closed" ? ` · closed ${when(b.closedAt)} by ${b.completedBy}` : ""}{display ? " · live on this screen" : !b.canEdit ? " · you're watching (read-only)" : ""}</div>
          <CommandLine b={b} display={display} act={act} onPick={k => setDialog({ pick: k })} />
        </div>
        <div style={{ textAlign: "center" }} aria-label="Incident clock">
          <div style={{ fontSize: 11, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase" }}><Timer size={12} /> On the call</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{hms(elapsedMs)}</div>
        </div>
        {b.status === "open" && (
          <div style={{ textAlign: "center", padding: "6px 12px", borderRadius: 8, background: parDue <= 0 ? BRICK : parDue < 120000 ? "#FFF3D6" : PAPER, color: parDue <= 0 ? "#fff" : INK }} className={parDue <= 0 ? "cb-pulse" : ""} aria-label="PAR timer">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>PAR {(st.par?.round || 0) + 1} · every {parEvery / 60000} min</div>
            <div style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{parDue <= 0 ? `DUE ${hms(-parDue)}` : hms(parDue)}</div>
            {edit && <button style={{ ...btn(parDue <= 0 ? "outline" : "primary"), padding: "3px 10px", fontSize: 12.5, background: "#fff", color: INK }} onClick={() => setDialog("par")}>Take PAR</button>}
          </div>
        )}
      </div>
      {pending > 0 && <div role="status" style={{ background: "#FFF3D6", border: `1px solid ${AMBER}`, color: AMBER, borderRadius: 6, padding: "6px 10px", margin: "8px 0", fontWeight: 700, fontSize: 13 }}>No connection: {pending} change{pending === 1 ? "" : "s"} saved on this device, sending as soon as it's back.</div>}
      {error && <div role="alert" style={{ color: BRICK, margin: "8px 0", fontSize: 13.5 }}>{error}</div>}

      {/* MAYDAY */}
      {st.mayday?.active ? (
        <div role="alert" className="cb-pulse" style={{ background: BRICK, color: "#fff", borderRadius: 8, padding: "12px 16px", margin: "10px 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Siren size={26} />
          <div style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>MAYDAY · {[st.mayday.who, st.mayday.unit].filter(Boolean).join(", ") || "member"}{st.mayday.location ? ` · ${st.mayday.location}` : ""}
            <div style={{ fontSize: 13, fontWeight: 600 }}>Called {clock(st.mayday.at)} ({hms(t - new Date(st.mayday.at).getTime())} ago) · logged by {st.mayday.by}</div></div>
          {edit && <button style={{ ...btn("outline"), background: "#fff", color: BRICK }} onClick={() => { const note = window.prompt("How was the MAYDAY resolved? (optional)") ?? null; if (note !== null) act({ type: "mayday_clear", note }); }}>MAYDAY cleared</button>}
        </div>
      ) : edit && (
        <button style={{ ...btn("primary"), background: BRICK, borderColor: BRICK, margin: "10px 0", fontSize: 15, padding: "8px 18px" }} onClick={() => setDialog("mayday")}><Siren size={16} /> MAYDAY</button>
      )}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start", marginTop: 6 }}>
        {/* Strategy and benchmarks */}
        <div style={{ ...cardStyle, flex: "1 1 320px" }}>
          <div style={head}>Strategy</div>
          <Toggle label="Strategy" value={st.strategy} edit={edit} options={[["offensive", "Offensive"], ["transitional", "Transitional"], ["defensive", "Defensive"]]} onPick={v => act({ type: "strategy", value: v })}
            color={v => (v === "defensive" ? BRICK : v === "offensive" ? SAGE : AMBER)} />
          <div style={{ height: 8 }} />
          <Toggle label="Attack" value={st.attack} edit={edit} options={[["interior", "Interior"], ["exterior", "Exterior"]]} onPick={v => act({ type: "attack", value: v })} color={() => INK} />
          <div style={{ ...head, marginTop: 14 }}>Benchmarks</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {BENCHMARKS.map(([k, label]) => {
              const at = st.benchmarks?.[k];
              return <button key={k} disabled={!edit} aria-pressed={!!at} onClick={() => (at ? window.confirm(`Take back "${label}"?`) && act({ type: "benchmark", key: k, on: false }) : act({ type: "benchmark", key: k, on: true }))}
                style={{ ...btn(at ? "primary" : "outline"), background: at ? SAGE : "#fff", borderColor: at ? SAGE : LINE, color: at ? "#fff" : INK, fontSize: 13, padding: "6px 10px", opacity: 1 }}>
                {at && <Check size={13} />} {label}{at && <span style={{ fontWeight: 500 }}> · {clock(at)}</span>}</button>;
            })}
          </div>
        </div>
        {/* Smoke */}
        <div style={{ ...cardStyle, flex: "1 1 280px" }}>
          <div style={{ ...head, display: "flex", alignItems: "center" }}><Wind size={14} /> &nbsp;Smoke reading<span style={{ flex: 1 }} />{edit && <button style={{ ...btn("outline"), padding: "2px 8px", fontSize: 12 }} onClick={() => setDialog("smoke")}>Read smoke</button>}</div>
          {!Object.keys(st.smoke || {}).length && <div style={{ fontSize: 13, color: INK_SOFT }}>No reading yet.</div>}
          {Object.values(st.smoke || {}).sort((x, y) => (x.side || "Z").localeCompare(y.side || "Z") || floorRank(x.floor) - floorRank(y.floor)).map(x => (
            <div key={(x.side || "g") + (x.floor || "")} style={{ fontSize: 13.5, padding: "4px 0", borderBottom: `1px solid ${LINE}`, color: x.density === "Black fire" || x.velocity === "Turbulent" ? BRICK : INK }}>
              <b>{smokeWhere(x) || "General"}:</b> {[x.volume, x.velocity, x.density, x.color].filter(Boolean).join(", ")}{x.note ? ` — ${x.note}` : ""} <span style={{ color: INK_SOFT, fontSize: 12 }}>{clock(x.at)}</span>
            </div>))}
        </div>
      </div>

      {/* Accountability */}
      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ ...head, display: "flex", alignItems: "center" }}><Users size={14} /> &nbsp;Accountability<span style={{ flex: 1 }} />
          <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: INK }}>In the structure: <b style={{ color: BRICK }}>{crewsBy("interior").reduce((n, c) => n + Math.max(1, c.names.length), 0)}</b></span>
          {edit && <button style={{ ...btn("outline"), padding: "2px 8px", fontSize: 12, marginLeft: 10 }} onClick={() => { const u = window.prompt("Unit to add (e.g. SQ62)"); if (u) act({ type: "crew_add", unit: u }); }}>Add unit</button>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {["interior", "exterior", "rit", "staged", "rehab", "assigned", "released"].map(loc => (
            <div key={loc} aria-label={LOC_NAME[loc]} style={{ background: loc === "interior" ? "#FCECEE" : PAPER, borderRadius: 8, padding: 8, minHeight: 60, borderTop: `3px solid ${LOC_COLOR[loc]}` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: LOC_COLOR[loc], textTransform: "uppercase", marginBottom: 6 }}>{LOC_NAME[loc]} ({crewsBy(loc).length})</div>
              {crewsBy(loc).map(c => <CrewTile key={c.unit} c={c} t={t} warn={warn} edit={edit} onOpen={() => setDialog({ crew: c.unit })} />)}
            </div>
          ))}
        </div>
      </div>

      {/* Scene view */}
      <Scene b={b} edit={edit} act={act} setError={setError} onBoard={take} />

      {/* Radio notes and the timeline */}
      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ ...head, display: "flex", alignItems: "center" }}><Radio size={14} /> &nbsp;Radio notes &amp; timeline</div>
        {edit && <NoteBox onSave={(text, critical) => act({ type: "note", text, critical })} />}
        <div style={{ maxHeight: 360, overflowY: "auto", marginTop: 8 }} role="list" aria-label="Timeline">
          {[...(b.events || [])].reverse().map(e => (
            <div key={e.id} role="listitem" style={{ display: "flex", gap: 10, fontSize: 13.5, padding: "5px 0", borderBottom: `1px solid ${LINE}`, color: e.critical ? BRICK : INK, fontWeight: e.critical ? 700 : 400 }}>
              <span style={{ fontVariantNumeric: "tabular-nums", color: INK_SOFT, minWidth: 92 }}>{clock(e.at)} <span style={{ fontSize: 11.5 }}>+{Math.max(0, Math.round((new Date(e.at) - start) / 60000))}m</span></span>
              <span style={{ flex: 1 }}>{e.critical && <AlertTriangle size={13} />} {e.text}</span>
              <span style={{ color: INK_SOFT, fontSize: 12, fontWeight: 400 }}>{e.by}</span>
            </div>))}
        </div>
      </div>

      {/* Record */}
      {!display && <div style={{ ...cardStyle, marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/command/${b.id}/report`} target="_blank" rel="noopener noreferrer"><Printer size={14} /> Print report</a>
        {b.status === "closed" && <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/command/${b.id}/report?download=1`}><FileDown size={14} /> Download file</a>}
        {(b.recordings || []).map(r => <span key={r.id} style={{ fontSize: 13, color: INK_SOFT }}>Working fire recording: <b style={{ color: INK }}>{r.address}</b> {when(r.startedAt)}</span>)}
        <span style={{ flex: 1 }} />
        {b.isIc && b.status === "open" && !training && <button style={{ ...btn("primary") }} onClick={() => window.confirm("Close the command board? It's saved as the after-action record (in your Personnel File and Command boards), and linked to the working fire recording for this incident.") && act({ type: "close" })}>Close board (incident terminated)</button>}
        {b.isIc && b.status === "open" && training && <button style={btn("primary")} onClick={() => setDialog("closeTraining")}>End training</button>}
        {b.canEdit && b.status === "closed" && training && <button style={{ ...btn("ghost"), color: BRICK }} onClick={() => window.confirm("Delete this saved training board? This can't be undone.") && discard()}><Trash2 size={14} /> Delete</button>}
        {(b.canEdit || b.role === "officer") && b.status === "closed" && <button style={btn("outline")} onClick={() => act({ type: "reopen" })}>Reopen</button>}
      </div>}

      {dialog === "mayday" && <MaydayDialog crews={st.crews} onClose={() => setDialog(null)} onSave={a => { setDialog(null); act({ type: "mayday", ...a }); }} />}
      {dialog === "smoke" && <SmokeDialog onClose={() => setDialog(null)} onSave={a => { setDialog(null); act({ type: "smoke", ...a }); }} />}
      {dialog === "closeTraining" && (
        <Modal title="End training" onClose={() => setDialog(null)}>
          <div style={{ fontSize: 13.5, marginBottom: 12 }}>Keep this board for future reference? Saved training boards stay under <b>Saved training boards</b> (with their report), and can be run again with the same setup.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn("primary")} onClick={() => { setDialog(null); act({ type: "close" }); }}>Save for future reference</button>
            <button style={{ ...btn("outline"), color: BRICK, borderColor: BRICK }} onClick={() => { setDialog(null); discard(); }}>Discard it</button>
            <button style={btn("ghost")} onClick={() => setDialog(null)}>Keep going</button>
          </div>
        </Modal>)}
      {dialog?.pick && <PersonPick kind={dialog.pick} b={b} onClose={() => setDialog(null)} onPick={uid => { const k = dialog.pick; setDialog(null); act({ type: k === "transfer" ? "transfer_command" : "editor_add", userId: uid }); }} />}
      {dialog === "par" && <ParDialog crews={st.crews} act={act} onClose={() => setDialog(null)} />}
      {dialog?.crew && <CrewDialog c={st.crews.find(x => x.unit === dialog.crew)} edit={edit} act={act} onClose={() => setDialog(null)} />}
    </Shell>
  );
}
const head = { fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };

function Toggle({ label, value, options, edit, onPick, color }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: INK_SOFT, width: 62 }}>{label}</span>
      {options.map(([v, l]) => (
        <button key={v} disabled={!edit} aria-pressed={value === v} onClick={() => value !== v && onPick(v)}
          style={{ ...btn(value === v ? "primary" : "outline"), background: value === v ? color(v) : "#fff", borderColor: value === v ? color(v) : LINE, color: value === v ? "#fff" : INK, fontWeight: 800, padding: "7px 12px", opacity: 1 }}>{l.toUpperCase()}</button>))}
    </div>
  );
}

function CrewTile({ c, t, warn, edit, onOpen }) {
  const inside = c.location === "interior" && c.inAt ? t - new Date(c.inAt).getTime() : 0;
  return (
    <button onClick={onOpen} aria-label={`${c.unit} crew`} title={c.names.join(", ") || "No names"} style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: `1px solid ${LINE}`, borderLeft: `4px solid ${LOC_COLOR[c.location]}`, borderRadius: 6, padding: "6px 8px", marginBottom: 6, cursor: "pointer", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <b style={{ fontSize: 15, color: INK }}>{c.unit}</b>
        {c.par && <Check size={13} color={SAGE} aria-label="PAR accounted" />}
        <span style={{ flex: 1 }} />
        {inside > 0 && <span className={inside > warn ? "cb-pulse" : ""} style={{ fontSize: 13, fontWeight: 800, color: inside > warn ? BRICK : INK, fontVariantNumeric: "tabular-nums" }}>{hms(inside)}</span>}
      </div>
      {c.assignment && <div style={{ fontSize: 12.5, color: INK, fontWeight: 600 }}>{c.assignment}</div>}
      <div style={{ fontSize: 12, color: INK_SOFT }}>{c.names.join(", ") || "Crew names not known"}{c.side ? ` · ${c.side}` : ""}</div>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div role="dialog" aria-label={title} aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ ...cardStyle, width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><b style={{ fontSize: 17, flex: 1 }}>{title}</b><button aria-label="Close" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

function CrewDialog({ c, edit, act, onClose }) {
  const [assignment, setAssignment] = useState(c?.assignment || "");
  const [names, setNames] = useState((c?.names || []).join(", "));
  if (!c) return null;
  return (
    <Modal title={`${c.unit}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>{LOC_NAME[c.location]}{c.side ? ` · ${c.side}` : ""}</div>
      {edit ? <>
        <div style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT, marginBottom: 4 }}>MOVE TO</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {LOCATIONS.map(([k, l]) => <button key={k} aria-pressed={c.location === k} onClick={() => { act({ type: "crew_move", unit: c.unit, location: k }); onClose(); }}
            style={{ ...btn(c.location === k ? "primary" : "outline"), background: c.location === k ? LOC_COLOR[k] : "#fff", borderColor: LOC_COLOR[k], color: c.location === k ? "#fff" : LOC_COLOR[k], fontWeight: 800 }}>{l}</button>)}
        </div>
        <label style={{ fontSize: 13, display: "block" }}>Assignment (e.g. Fire attack, Search, Vent, Water supply, Division C)
          <input aria-label="Assignment" style={{ ...inputStyle, marginTop: 4 }} value={assignment} onChange={e => setAssignment(e.target.value)} /></label>
        <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>Crew (names, separated by commas)
          <input aria-label="Crew names" style={{ ...inputStyle, marginTop: 4 }} value={names} onChange={e => setNames(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={btn("primary")} onClick={() => { if (assignment !== c.assignment) act({ type: "crew_assign", unit: c.unit, assignment }); if (names !== c.names.join(", ")) act({ type: "crew_names", unit: c.unit, names: names.split(",").map(s => s.trim()).filter(Boolean) }); onClose(); }}>Save</button>
          <button style={btn("outline")} onClick={onClose}>Cancel</button>
        </div>
      </> : <div style={{ fontSize: 14 }}>{c.assignment && <div><b>{c.assignment}</b></div>}{c.names.join(", ") || "Crew names not known"}</div>}
    </Modal>
  );
}

function MaydayDialog({ crews, onClose, onSave }) {
  const [v, setV] = useState({ unit: "", who: "", location: "" });
  return (
    <Modal title="MAYDAY" onClose={onClose}>
      <label style={{ fontSize: 13, display: "block" }}>Unit
        <select aria-label="Mayday unit" style={{ ...inputStyle, marginTop: 4 }} value={v.unit} onChange={e => setV({ ...v, unit: e.target.value })}>
          <option value="">Unknown</option>{crews.map(c => <option key={c.unit}>{c.unit}</option>)}</select></label>
      <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>Who
        <input aria-label="Mayday who" list="cb-names" style={{ ...inputStyle, marginTop: 4 }} value={v.who} onChange={e => setV({ ...v, who: e.target.value })} />
        <datalist id="cb-names">{(crews.find(c => c.unit === v.unit)?.names || crews.flatMap(c => c.names)).map(n => <option key={n} value={n} />)}</datalist></label>
      <label style={{ fontSize: 13, display: "block", marginTop: 8 }}>Location / problem (LUNAR)
        <input aria-label="Mayday location" style={{ ...inputStyle, marginTop: 4 }} value={v.location} onChange={e => setV({ ...v, location: e.target.value })} placeholder="e.g. Floor 2, C/D corner, low air, trapped" /></label>
      <button style={{ ...btn("primary"), background: BRICK, borderColor: BRICK, marginTop: 12 }} onClick={() => onSave(v)}><Siren size={14} /> Log MAYDAY</button>
    </Modal>
  );
}

const smokeWhere = x => [x.side ? `${x.side} side` : "", x.floor ? (/^\d/.test(x.floor) ? `floor ${x.floor}` : x.floor.toLowerCase()) : ""].filter(Boolean).join(", ");
const floorRank = f => f === "Basement" ? 0 : /^\d+$/.test(f || "") ? +f : f === "Attic" ? 200 : f === "Roof" ? 201 : -1;
// Who runs the board: the IC, and the people the IC chose to edit with them. Other officers can take command.
function CommandLine({ b, display, act, onPick }) {
  const c = b.command || { icName: b.openedBy, editors: [] };
  const small = { ...btn("outline"), padding: "2px 9px", fontSize: 12 };
  return (
    <div aria-label="Command" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6, fontSize: 13.5, color: INK }}>
      <span><b style={{ fontSize: 11, color: "#fff", background: INK, borderRadius: 4, padding: "1px 6px", letterSpacing: 0.5 }}>IC</b> <b>{c.icName}</b>{b.isIc && !display ? " (you)" : ""}</span>
      {c.editors.length > 0 && <span style={{ color: INK_SOFT }}>· also editing:</span>}
      {c.editors.map(e => (
        <span key={e.id} style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 12, padding: "1px 8px" }}>{e.name}
          {b.isIc && b.status === "open" && !display && <button aria-label={`Remove ${e.name}`} title="Stop them editing" onClick={() => window.confirm(`Stop ${e.name} editing the board?`) && act({ type: "editor_remove", userId: e.id })} style={{ border: "none", background: "none", cursor: "pointer", padding: "0 0 0 4px", color: INK_SOFT }}><X size={12} /></button>}</span>))}
      {!display && b.status === "open" && b.isIc && <>
        <button style={small} onClick={() => onPick("editor")}><Plus size={12} /> Add someone</button>
        <button style={small} onClick={() => onPick("transfer")}>Transfer command</button></>}
      {!display && b.canAssume && <button style={{ ...small, borderColor: BRICK, color: BRICK }} onClick={() => window.confirm(`Assume command from ${c.icName}? You become the incident commander on this board; ${c.icName} stays on as an editor.`) && act({ type: "assume_command" })}>Assume command</button>}
    </div>
  );
}
function PersonPick({ kind, b, onClose, onPick }) {
  const [people, setPeople] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { api("/people").then(j => setPeople(j.people), () => setPeople([])); }, []);
  const c = b.command || { editors: [] };
  const taken = new Set([c.icId, ...(kind === "editor" ? c.editors.map(e => e.id) : [])]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = (people || []).filter(p => !taken.has(p.id) && words.every(w => `${p.name} ${p.title} ${p.callSign}`.toLowerCase().includes(w))).slice(0, 30);
  return (
    <Modal title={kind === "transfer" ? "Transfer command" : "Add someone to the board"} onClose={onClose}>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>{kind === "transfer"
        ? "They become the incident commander on this board. You stay on as an editor; they can remove you."
        : "They can change the board with you (crews, PAR, benchmarks, notes). Only you can close it or hand off command."}</div>
      <input aria-label="Find a person" autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Name, title or call sign" style={inputStyle} />
      <div role="list" style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
        {!people && <div style={{ fontSize: 13, color: INK_SOFT }}>Loading…</div>}
        {list.map(p => (
          <button key={p.id} role="listitem" onClick={() => onPick(p.id)} style={{ display: "block", width: "100%", textAlign: "left", background: "#fff", border: "none", borderBottom: `1px solid ${LINE}`, padding: "7px 4px", cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: INK }}>
            <b>{p.name}</b> <span style={{ color: INK_SOFT, fontSize: 12.5 }}>{[p.title, p.callSign].filter(Boolean).join(" · ")}</span></button>))}
      </div>
    </Modal>
  );
}
function SmokeDialog({ onClose, onSave }) {
  const [v, setV] = useState({ side: "" });
  return (
    <Modal title="Read smoke" onClose={onClose}>
      <Pick label="Side" options={["A", "B", "C", "D"]} value={v.side} onPick={x => setV({ ...v, side: x })} />
      <Pick label="Floor" options={["Basement", "1", "2", "3", "4", "Attic", "Roof"]} value={v.hi ? "" : v.floor} onPick={x => setV({ ...v, floor: x, hi: "" })} />
      <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>Higher floor
        <input aria-label="Floor number" inputMode="numeric" style={{ ...inputStyle, width: 90 }} value={v.hi || ""} onChange={e => { const hi = e.target.value.replace(/\D/g, "").slice(0, 3); setV({ ...v, hi, floor: hi }); }} placeholder="e.g. 7" /></label>
      {Object.entries(SMOKE).map(([k, opts]) => <Pick key={k} label={k[0].toUpperCase() + k.slice(1)} options={opts} value={v[k]} onPick={x => setV({ ...v, [k]: x })} />)}
      <label style={{ fontSize: 13, display: "block", marginTop: 6 }}>Note
        <input aria-label="Smoke note" style={{ ...inputStyle, marginTop: 4 }} value={v.note || ""} onChange={e => setV({ ...v, note: e.target.value })} placeholder="e.g. pulsing at the eaves, getting darker" /></label>
      <button style={{ ...btn("primary"), marginTop: 12 }} onClick={() => onSave(v)}>Save reading</button>
    </Modal>
  );
}
function Pick({ label, options, value, onPick }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
      <span style={{ width: 70, fontSize: 13, color: INK_SOFT }}>{label}</span>
      {options.map(o => <button key={o} aria-pressed={value === o} onClick={() => onPick(value === o ? "" : o)} style={{ ...btn(value === o ? "primary" : "outline"), padding: "5px 10px" }}>{o}</button>)}
    </div>
  );
}

function ParDialog({ crews, act, onClose }) {
  const list = crews.filter(c => c.location !== "released");
  return (
    <Modal title="PAR" onClose={onClose}>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>Tap each crew as its officer reports PAR. Interior crews first.</div>
      {[...list].sort((a, b) => (a.location === "interior" ? -1 : 0) - (b.location === "interior" ? -1 : 0)).map(c => (
        <button key={c.unit} aria-pressed={c.par} onClick={() => act({ type: "par_crew", unit: c.unit, ok: !c.par })}
          style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "9px 10px", marginBottom: 6, borderRadius: 6, border: `1px solid ${c.par ? SAGE : LINE}`, background: c.par ? "#E7F4EC" : "#fff", cursor: "pointer", fontFamily: "inherit", fontSize: 14 }}>
          <span style={{ width: 20 }}>{c.par && <Check size={16} color={SAGE} />}</span><b>{c.unit}</b><span style={{ color: LOC_COLOR[c.location], fontWeight: 700, fontSize: 12.5 }}>{LOC_NAME[c.location]}</span>
          <span style={{ flex: 1, textAlign: "right", color: INK_SOFT, fontSize: 12.5 }}>{c.names.length ? `${c.names.length} member${c.names.length === 1 ? "" : "s"}` : ""}</span>
        </button>))}
      <button style={{ ...btn("primary"), marginTop: 8 }} onClick={() => { act({ type: "par_complete" }); onClose(); }}>PAR complete</button>
      <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>Crews not tapped are logged in red as not accounted for. The PAR timer starts over.</div>
    </Modal>
  );
}

function NoteBox({ onSave }) {
  const [text, setText] = useState(""), [critical, setCritical] = useState(false);
  const save = () => { if (text.trim()) { onSave(text.trim(), critical); setText(""); setCritical(false); } };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input aria-label="Radio note" style={{ ...inputStyle, flex: "1 1 260px" }} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} placeholder="What was said (e.g. Div 2: floor feels spongy, heat increasing)" />
      <label style={{ fontSize: 13, color: critical ? BRICK : INK, fontWeight: 700, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={critical} onChange={e => setCritical(e.target.checked)} /> Critical</label>
      <button style={btn("primary")} onClick={save}>Log</button>
    </div>
  );
}

// ---- Scene: diagram or USGS aerial, building box, A/B/C/D sides, apparatus you can drag ----------------------------
function Scene({ b, edit, act, setError, onBoard }) {
  const st = b.state;
  const W = st.imageW || 1280, H = st.imageH || 1280;
  const svg = useRef(null);
  const [drag, setDrag] = useState(null);         // { unit, x, y } | { building: {...}, mode, ox, oy }
  const [placing, setPlacing] = useState("");
  const [recenter, setRecenter] = useState(false);
  const [moveBldg, setMoveBldg] = useState(false);
  const [loadingAerial, setLoadingAerial] = useState(false);
  const [range, setRange] = useState("normal");
  const fileRef = useRef(null);
  const aerial = st.view === "aerial" && st.imageId;
  const fullW = aerial ? W : 1280, fullH = aerial ? H : 1280;

  // Zoom and pan: the viewBox. Wheel / pinch / + − zoom, drag the background to move around, Fit shows everything.
  const [vb, setVb] = useState({ x: 0, y: 0, w: fullW, h: fullH });
  useEffect(() => { setVb({ x: 0, y: 0, w: fullW, h: fullH }); }, [fullW, fullH, st.imageId, aerial]);
  const clampVb = v => {
    const w = Math.min(fullW, Math.max(fullW / 10, v.w)), h = w * fullH / fullW;
    return { w, h, x: Math.min(fullW - w, Math.max(0, v.x)), y: Math.min(fullH - h, Math.max(0, v.y)) };
  };
  const zoomAt = (f, cx, cy) => setVb(v => { const w = v.w / f, h = v.h / f; return clampVb({ w, h, x: cx - (cx - v.x) * (w / v.w), y: cy - (cy - v.y) * (h / v.h) }); });
  const zoomBy = f => setVb(v => { const cx = v.x + v.w / 2, cy = v.y + v.h / 2, w = v.w / f, h = v.h / f; return clampVb({ w, h, x: cx - w / 2, y: cy - h / 2 }); });
  const sc = vb.w / 1280;                         // symbol scale: tags and labels stay the same size on screen at any zoom
  const pt = e => { const s = svg.current; const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const r = p.matrixTransform(s.getScreenCTM().inverse()); return { x: Math.round(r.x), y: Math.round(r.y) }; };
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wheel = e => { e.preventDefault(); const p = pt(e); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, p.x, p.y); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const pointers = useRef(new Map());
  const pan = useRef(null);                       // { sx, sy, vb, moved } | { pinch: dist, vb, mid }
  const panned = useRef(false);

  const bl = drag?.building || st.building || { x: 440, y: 510, w: 400, h: 260 };
  const sideAt = useMemo(() => { const i = EDGES.indexOf(st.aSide || "bottom"); return Object.fromEntries([0, 1, 2, 3].map(k => [EDGES[(i + k) % 4], "ABCD"[k]])); }, [st.aSide]);
  const g = 46 * sc;
  const label = { bottom: [bl.x + bl.w / 2, bl.y + bl.h + g], top: [bl.x + bl.w / 2, bl.y - g / 2], left: [bl.x - g, bl.y + bl.h / 2 + 12 * sc], right: [bl.x + bl.w + g, bl.y + bl.h / 2 + 12 * sc] };
  const unplaced = st.crews.filter(c => c.x == null && c.location !== "released");

  const down = (e, what) => {
    if (!edit) return;
    e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pt(e);
    if (what === "move" || what === "size") setDrag({ building: { ...bl }, mode: what, ox: p.x, oy: p.y, start: { ...bl } });
    else setDrag({ unit: what, x: p.x, y: p.y, moved: false });
  };
  const bgDown = e => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.current.setPointerCapture?.(e.pointerId);
    panned.current = false;
    const ps = [...pointers.current.values()];
    if (ps.length === 2) {
      const r = svg.current.getBoundingClientRect();
      pan.current = { pinch: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), vb, mid: { x: vb.x + (((ps[0].x + ps[1].x) / 2 - r.left) / r.width) * vb.w, y: vb.y + (((ps[0].y + ps[1].y) / 2 - r.top) / r.height) * vb.h } };
    } else pan.current = { sx: e.clientX, sy: e.clientY, vb, moved: false };
  };
  const move = e => {
    if (drag) {
      const p = pt(e);
      if (drag.unit) setDrag({ ...drag, x: p.x, y: p.y, moved: true });
      else {
        const dx = p.x - drag.ox, dy = p.y - drag.oy, s0 = drag.start;
        setDrag({ ...drag, building: drag.mode === "move" ? { ...s0, x: s0.x + dx, y: s0.y + dy } : { ...s0, w: Math.max(10, s0.w + dx), h: Math.max(10, s0.h + dy) } });
      }
      return;
    }
    if (!pointers.current.has(e.pointerId) || !pan.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.current.getBoundingClientRect(), P = pan.current, ps = [...pointers.current.values()];
    if (P.pinch && ps.length === 2) {
      const f = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) / P.pinch;
      const w = P.vb.w / f, h = P.vb.h / f;
      setVb(clampVb({ w, h, x: P.mid.x - (P.mid.x - P.vb.x) * (w / P.vb.w), y: P.mid.y - (P.mid.y - P.vb.y) * (h / P.vb.h) }));
      panned.current = true;
    } else if (!P.pinch) {
      const dx = e.clientX - P.sx, dy = e.clientY - P.sy;
      if (!P.moved && Math.hypot(dx, dy) < 6) return;
      P.moved = true; panned.current = true;
      setVb(clampVb({ ...P.vb, x: P.vb.x - dx * P.vb.w / r.width, y: P.vb.y - dy * P.vb.h / r.height }));
    }
  };
  const up = e => {
    pointers.current.delete(e?.pointerId);
    if (pointers.current.size < 2 && pan.current?.pinch) pan.current = null;
    if (!pointers.current.size) pan.current = null;
    if (!drag) return;
    if (drag.unit && drag.moved) act({ type: "crew_place", unit: drag.unit, x: Math.min(W, Math.max(0, drag.x)), y: Math.min(H, Math.max(0, drag.y)) });
    if (drag.building) act({ type: "scene", building: drag.building });
    setDrag(null);
  };
  const tapScene = e => {
    if (panned.current) { panned.current = false; return; }
    if (!edit) return;
    const p = pt(e);
    if (recenter) { setRecenter(false); getAerial({ dx: p.x - W / 2, dy: p.y - H / 2 }); return; }
    if (placing) { act({ type: "crew_place", unit: placing, x: p.x, y: p.y }); setPlacing(""); }
  };
  const call = async (path, body) => {
    setLoadingAerial(true);
    try {
      const r = await fetch(`/api/command/${b.id}/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error); onBoard(j);
    } catch (e) { setError(e.message || "Couldn't get the picture."); } finally { setLoadingAerial(false); }
  };
  const placed = st.crews.some(c => c.x != null);
  const getAerial = (extra = {}) => { if (!placed || window.confirm("A new picture takes the units off the scene (they stay on the board); place them again on the new one. Go ahead?")) call("aerial", { range, ...extra }); };
  const upload = file => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError("Upload a JPEG, PNG or WebP picture."); return; }
    if (file.size > 15 * 1024 * 1024) { setError("The picture must be under 15 MB."); return; }
    if (placed && !window.confirm("A new picture takes the units off the scene (they stay on the board); place them again on the new one. Go ahead?")) return;
    const rd = new FileReader();
    rd.onload = () => { const im = new Image(); im.onload = () => call("picture", { picture: { mime: file.type, data: rd.result, width: im.naturalWidth, height: im.naturalHeight } }); im.src = rd.result; };
    rd.readAsDataURL(file);
  };
  const small = { ...btn("outline"), padding: "3px 9px", fontSize: 12 };
  const across = st.imgFtPerPx ? Math.round(st.imgFtPerPx * W) : null;

  return (
    <div style={{ ...cardStyle, marginTop: 14 }}>
      <div style={{ ...head, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><MapIcon size={14} /> Scene
        <span style={{ flex: 1 }} />
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button aria-pressed={!aerial} style={{ ...btn(!aerial ? "primary" : "outline"), padding: "3px 9px", fontSize: 12 }} disabled={!edit && !aerial} onClick={() => act({ type: "scene", view: "diagram" })}><LayoutGrid size={12} /> Diagram</button>
          {st.imageId && <button aria-pressed={!!aerial} style={{ ...btn(aerial ? "primary" : "outline"), padding: "3px 9px", fontSize: 12 }} disabled={!edit} onClick={() => act({ type: "scene", view: "aerial" })}><MapIcon size={12} /> {st.imgFtPerPx ? "Aerial" : "Picture"}</button>}
          {edit && <label style={{ fontSize: 12, color: INK_SOFT }}>A side faces <select aria-label="A side faces" value={st.aSide || "bottom"} onChange={e => act({ type: "scene", aSide: e.target.value })} style={{ ...inputStyle, width: "auto", padding: "2px 6px", fontSize: 12 }}>
            {[["bottom", "down"], ["top", "up"], ["left", "left"], ["right", "right"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
          {edit && <button aria-pressed={moveBldg} style={{ ...btn(moveBldg ? "primary" : "outline"), padding: "3px 9px", fontSize: 12 }} onClick={() => setMoveBldg(!moveBldg)}>{moveBldg ? "Done with building" : "Move / size building"}</button>}
        </span>
      </div>
      {edit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8, fontSize: 12.5, color: INK_SOFT }}>
          {(b.lat != null || st.imgLat != null) && <>
            <select aria-label="Aerial area" value={range} onChange={e => setRange(e.target.value)} style={{ ...inputStyle, width: "auto", padding: "2px 6px", fontSize: 12 }}>
              <option value="closer">Closer (500 ft)</option><option value="normal">Normal (800 ft)</option><option value="wider">Wider (1,500 ft)</option></select>
            <button style={small} disabled={loadingAerial} onClick={() => getAerial()}><MapIcon size={12} /> {loadingAerial ? "Getting picture…" : st.imgFtPerPx ? "New aerial (USGS)" : "Get aerial (USGS)"}</button>
            {aerial && st.imgFtPerPx && <button aria-pressed={recenter} style={recenter ? { ...small, ...btn("primary"), padding: "3px 9px", fontSize: 12 } : small} disabled={loadingAerial} onClick={() => setRecenter(!recenter)}>{recenter ? "Tap the new center…" : "Re-center here"}</button>}</>}
          <button style={small} disabled={loadingAerial} onClick={() => fileRef.current?.click()}>Upload a picture</button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Scene picture" style={{ display: "none" }} onChange={e => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </div>)}
      {edit && unplaced.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8, fontSize: 12.5, color: INK_SOFT }}>
          {placing ? <>Tap the scene where <b style={{ color: INK }}>{placing}</b> is set up. <button style={{ ...btn("outline"), padding: "2px 8px", fontSize: 12 }} onClick={() => setPlacing("")}>Cancel</button></>
            : <>Place on the scene:{unplaced.map(c => <button key={c.unit} style={{ ...btn("outline"), padding: "2px 8px", fontSize: 12 }} onClick={() => setPlacing(c.unit)}>{c.unit}</button>)}</>}
        </div>)}
      <div style={{ position: "relative" }}>
        <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label="Scene view" onPointerDown={bgDown} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={e => { if (!drag) up(e); }} onClick={tapScene}
          style={{ width: "100%", maxHeight: "70vh", background: aerial ? "#222" : "#F7F8FA", borderRadius: 8, touchAction: "none", cursor: placing || recenter ? "crosshair" : "grab", display: "block" }}>
          {aerial ? <image href={b.display ? `/api/display/image/${st.imageId}` : `/api/evals/images/${st.imageId}`} x={0} y={0} width={W} height={H} style={{ imageRendering: "auto" }} />
            : <g>{Array.from({ length: Math.ceil(fullW / 80) + 1 }, (_, i) => <line key={`v${i}`} x1={i * 80} y1={0} x2={i * 80} y2={fullH} stroke="#E3E7EE" strokeWidth={2} />)}
              {Array.from({ length: Math.ceil(fullH / 80) + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * 80} x2={fullW} y2={i * 80} stroke="#E3E7EE" strokeWidth={2} />)}
              <text x={fullW / 2} y={fullH - 30} textAnchor="middle" fontSize={34} fill="#A8B0BD">{st.aSide === "bottom" || !st.aSide ? "Street (A side)" : ""}</text></g>}
          <rect x={bl.x} y={bl.y} width={bl.w} height={bl.h} fill={aerial ? "rgba(200,16,46,.18)" : "#E8D9C7"} stroke={BRICK} strokeWidth={6 * sc} strokeDasharray={moveBldg ? `${18 * sc} ${10 * sc}` : undefined}
            style={{ cursor: moveBldg && edit ? "move" : "default" }} onPointerDown={moveBldg ? e => down(e, "move") : undefined} />
          {moveBldg && edit && <rect x={bl.x + bl.w - 26 * sc} y={bl.y + bl.h - 26 * sc} width={44 * sc} height={44 * sc} fill={BRICK} style={{ cursor: "nwse-resize" }} onPointerDown={e => down(e, "size")} />}
          {Object.entries(label).map(([edge, [x, y]]) => (
            <g key={edge} transform={`translate(${x},${y}) scale(${sc})`} style={{ pointerEvents: "none" }}><circle cx={0} cy={-12} r={30} fill={INK} opacity={0.88} /><text x={0} y={0} textAnchor="middle" fontSize={36} fontWeight={800} fill="#fff">{sideAt[edge]}</text></g>))}
          {st.crews.filter(c => c.x != null).map(c => {
            const x = drag?.unit === c.unit ? drag.x : c.x, y = drag?.unit === c.unit ? drag.y : c.y;
            const fill = LOC_COLOR[c.location] || INK, w = Math.max(110, c.unit.length * 24 + 30);
            return (
              <g key={c.unit} transform={`translate(${x},${y}) scale(${sc})`} style={{ cursor: edit ? "grab" : "default" }} onPointerDown={e => down(e, c.unit)} aria-label={`${c.unit} on scene`}>
                <title>{`${c.unit}${c.side ? ` · ${c.side}` : ""}${c.names.length ? ` · ${c.names.join(", ")}` : ""}`}</title>
                <rect x={-w / 2} y={-26} width={w} height={52} rx={10} fill={fill} stroke="#fff" strokeWidth={4} />
                <text x={0} y={11} textAnchor="middle" fontSize={32} fontWeight={800} fill="#fff">{c.unit}</text>
              </g>);
          })}
        </svg>
        {!b.display && <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {[["Zoom in", "+", () => zoomBy(1.5)], ["Zoom out", "−", () => zoomBy(1 / 1.5)], ["Fit", "Fit", () => setVb({ x: 0, y: 0, w: fullW, h: fullH })]].map(([l, t, f]) => (
            <button key={l} aria-label={l} title={l} onClick={f} style={{ minWidth: 36, height: 34, borderRadius: 7, border: `1px solid ${LINE}`, background: "rgba(255,255,255,.94)", fontWeight: 800, fontSize: t.length > 1 ? 12 : 19, color: INK, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>))}
        </div>}
      </div>
      {aerial && <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 4 }}>{st.imgCredit || "Imagery: USGS The National Map (NAIP)"}{across ? `. About ${across.toLocaleString()} ft across.` : "."} Pinch or scroll to zoom; drag to move around.</div>}
    </div>
  );
}
