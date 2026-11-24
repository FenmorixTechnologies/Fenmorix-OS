// Working Fire Recordings: import NICE .distribution exports and play them back.
import AppShell from "./AppShell.jsx";
import { BRAND } from "./brand.js";
import { Headphones, Building2, Upload } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton, loadShared, printDocument, letterhead, escapeHtml } from "./App.jsx";
import { useListView, ListControls, Pager } from "./ListControls.jsx";
import { PN } from "./brand.js";

// Local colors: values used outside components can't come from App.jsx (circular import)
const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8";
const BRICK = "#C8102E", BRASS_DEEP = "#1D5FA8", SAGE = "#2E7D4F";
const TG_COLORS = ["#1D5FA8", "#C8102E", "#2E7D4F", "#B26A00", "#7A4FB5", "#0F7C86", "#9E4A1C", "#A3376A"];
const ZONE = "America/Chicago";

async function api(path, opts = {}) {
  const res = await fetch(`/api/recordings${path}`, {
    ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status})`), { status: res.status, data });
  return data;
}

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: ZONE, weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtTime = (iso, secs = false) => iso ? new Date(iso).toLocaleTimeString("en-GB", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", ...(secs ? { second: "2-digit" } : {}) }) : "";
const fmtLen = s => {
  s = Math.round(Number(s) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(x).padStart(2, "0")}s` : `${x}s`;
};
const elapsed = (from, to) => {
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return `+${String(Math.floor(s / 3600)).padStart(1, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const yearOf = iso => iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: ZONE }).slice(0, 4) : "";

function DepartmentPicker({ departments, value, onChange, label = "Department" }) {
  const known = departments.map(d => d.name);
  const [other, setOther] = useState(!!value && !known.includes(value));
  return (
    <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 }}>{label}
      <select aria-label={label} style={inputStyle} value={other ? "__other" : value}
        onChange={e => { if (e.target.value === "__other") { setOther(true); onChange(""); } else { setOther(false); onChange(e.target.value); } }}>
        <option value="">Choose…</option>
        {known.map(n => <option key={n} value={n}>{n}</option>)}
        <option value="__other">Other…</option>
      </select>
      {other && <input aria-label="Other department" style={{ ...inputStyle, marginTop: 4 }} value={value} onChange={e => onChange(e.target.value)} placeholder="Department name" />}
    </label>
  );
}

function ImportForm({ departments, onDone, onOpenExisting, onCancel }) {
  const [file, setFile] = useState(null);
  const [department, setDepartment] = useState(departments[0]?.name || "");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  function upload() {
    if (!file) { setError({ message: "Choose the .distribution file." }); return; }
    if (!department.trim()) { setError({ message: "Choose the department." }); return; }
    setError(null); setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/recordings/import?name=${encodeURIComponent(file.name)}&department=${encodeURIComponent(department.trim())}`);
    xhr.setRequestHeader("X-SGFD", "1");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 200) onDone(data.recording);
      else { setProgress(null); setError({ message: data.error || `Import failed (${xhr.status})`, existingId: data.existingId }); }
    };
    xhr.onerror = () => { setProgress(null); setError({ message: "The upload didn't finish. Check the connection and try again." }); };
    xhr.send(file);
  }
  return (
    <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `4px solid ${BRASS_DEEP}` }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Import a recording</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12 }}>
        Choose a NICE Inform <b>.distribution</b> export. The address, incident number, description, times and every
        transmission (talkgroup, radio, time) are read from the file.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignItems: "end" }}>
        <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 }}>File
          <input aria-label="Recording file" type="file" accept=".distribution" onChange={e => setFile(e.target.files[0] || null)} style={{ fontSize: 13 }} />
        </label>
        <DepartmentPicker departments={departments} value={department} onChange={setDepartment} />
      </div>
      {progress !== null && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, background: "#E6EAF0", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: BRASS_DEEP }} />
          </div>
          <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 4 }}>{progress < 100 ? `Uploading… ${progress}%` : "Reading the recording…"}</div>
        </div>
      )}
      {error && (
        <div style={{ color: BRICK, fontSize: 13, marginTop: 10 }}>
          {error.message}{" "}
          {error.existingId && <button style={{ ...btn("outline"), padding: "3px 10px", fontSize: 12.5 }} onClick={() => onOpenExisting(error.existingId)}>Open it</button>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={btn("primary")} onClick={upload} disabled={progress !== null}>Import</button>
        <button style={btn("ghost")} onClick={onCancel} disabled={progress !== null}>Cancel</button>
      </div>
    </div>
  );
}

function DepartmentsEditor({ departments, onChanged }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function add() {
    if (!name.trim()) return;
    try { await api("/departments", { method: "POST", body: JSON.stringify({ name: name.trim() }) }); setName(""); onChanged(); }
    catch (e) { setError(e.message); }
  }
  async function remove(d) {
    if (!window.confirm(`Remove "${d.name}" from the list? Recordings already filed under it keep it.`)) return;
    try { await api(`/departments/${d.id}`, { method: "DELETE" }); onChanged(); } catch (e) { setError(e.message); }
  }
  if (!open) return <button style={{ ...btn("ghost"), fontSize: 12.5 }} onClick={() => setOpen(true)}>Department list…</button>;
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Departments</div>
      {departments.map(d => (
        <div key={d.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
          <span>{d.name}</span>
          <button style={{ ...btn("ghost"), color: BRICK, padding: "2px 8px", fontSize: 12 }} onClick={() => remove(d)}>Remove</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input aria-label="New department" style={{ ...inputStyle, flex: 1 }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Central Fire Protection District" />
        <button style={btn("primary")} onClick={add}>Add</button>
        <button style={btn("ghost")} onClick={() => setOpen(false)}>Done</button>
      </div>
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function EditDetails({ rec, departments, onSaved, onCancel }) {
  const [f, setF] = useState({ address: rec.address, incidentNumber: rec.incidentNumber, description: rec.description, department: rec.department, notes: rec.notes });
  const [error, setError] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    try { const r = await api(`/${rec.id}`, { method: "PUT", body: JSON.stringify(f) }); onSaved(r.recording); }
    catch (e) { setError(e.message); }
  }
  const lab = { fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 };
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 6, padding: "12px 14px", marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        <label style={lab}>Address<input aria-label="Address" style={inputStyle} value={f.address} onChange={e => set("address", e.target.value)} /></label>
        <label style={lab}>Incident number<input aria-label="Incident number" style={inputStyle} value={f.incidentNumber} onChange={e => set("incidentNumber", e.target.value)} /></label>
        <label style={lab}>Description<input aria-label="Description" style={inputStyle} value={f.description} onChange={e => set("description", e.target.value)} /></label>
        <DepartmentPicker departments={departments} value={f.department} onChange={v => set("department", v)} />
      </div>
      <label style={{ ...lab, marginTop: 10 }}>Notes
        <textarea aria-label="Notes" style={{ ...inputStyle, minHeight: 60 }} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. used for training, mayday at 16:02" />
      </label>
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn("primary")} onClick={save}>Save</button>
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// One recording: details, transmission timeline and player
// ---- Transcript: Whisper on the server, printable radio log --------------------------------------
function TranscriptCard({ rec, queue, hiddenTg, unit, onChange }) {
  const [svc, setSvc] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api("/transcriber").then(setSvc, () => setSvc({ ready: false, reason: "Couldn't check the transcription service." })); }, []);
  const t = rec.transcript || {};
  const running = t.status === "queued" || t.status === "running";
  const done = t.status === "done";
  async function start(redo) {
    if (redo && !window.confirm("Transcribe this recording again? Lines you corrected by hand are kept.")) return;
    setBusy(true); setError("");
    try { onChange((await api(`/${rec.id}/transcribe`, { method: "POST", body: JSON.stringify({ redo }) })).recording); }
    catch (e) { setError(e.message); }
    setBusy(false);
  }
  const filtered = hiddenTg.length > 0 || !!unit;
  return (
    <div style={{ ...cardStyle, marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 300px", minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: INK, fontSize: 15 }}>Transcript</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>
          {!t.status && "Turn the radio traffic into a written, printable radio log. It runs on the " + PN + " server; the audio never leaves the district."}
          {t.status === "queued" && "Waiting to start…"}
          {t.status === "running" && <>Transcribing… <b style={{ color: INK }}>{t.done} of {rec.clipCount}</b> transmissions done. You can leave this page; it keeps going.</>}
          {done && <>Transcribed {fmtDate(t.at)} by {t.by || PN}{t.model ? ` (Whisper ${t.model})` : ""}. Machine transcripts make mistakes: click <b>Correct</b> under any line to fix it.</>}
          {t.status === "failed" && <span style={{ color: BRICK }}>The transcript stopped: {t.error}</span>}
        </div>
        {running && (
          <div aria-label="Transcript progress" style={{ height: 6, borderRadius: 3, background: LINE, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(100 * (t.done || 0) / Math.max(1, rec.clipCount))}%`, height: "100%", background: BRASS_DEEP, transition: "width 0.4s" }} />
          </div>
        )}
        {svc && !svc.ready && !done && <div style={{ fontSize: 12.5, color: "#8A5A00", marginTop: 6 }}>{svc.reason}</div>}
        {error && <div role="alert" style={{ fontSize: 12.5, color: BRICK, marginTop: 6 }}>{error}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(!t.status || t.status === "failed") && <button style={btn("primary")} disabled={busy || !svc?.ready} onClick={() => start(t.status === "failed")}>
          {t.status === "failed" ? "Try again" : "Transcribe Working Fire Audio"}</button>}
        {(done || (t.status === "failed" && rec.clips.some(c => c.text != null))) && <button style={btn("primary")} onClick={() => printTranscript(rec, queue, filtered)}>
          Print transcript{filtered ? " (shown transmissions)" : ""}</button>}
        {done && <button style={btn("outline")} disabled={busy || !svc?.ready} onClick={() => start(true)}>Transcribe again</button>}
      </div>
    </div>
  );
}

function printTranscript(rec, clips, filtered) {
  const tgs = [...new Set(clips.map(c => c.talkgroup).filter(Boolean))];
  const rows = clips.map(c => `<tr>
      <td style="white-space:nowrap;font-variant-numeric:tabular-nums">${fmtTime(c.startedAt, true)}</td>
      <td style="white-space:nowrap;color:#555;font-variant-numeric:tabular-nums">${elapsed(rec.startedAt, c.startedAt)}</td>
      <td style="white-space:nowrap"><b>${escapeHtml(c.unit || c.unitId || "Unknown radio")}</b>${tgs.length > 1 ? `<br><span style="color:#666;font-size:11px">${escapeHtml(c.talkgroup)}</span>` : ""}</td>
      <td>${c.text ? escapeHtml(c.text) : `<i style="color:#888">${c.text == null ? "not transcribed" : "(not understandable)"}</i>`}${c.edited ? " *" : ""}</td>
    </tr>`).join("");
  const t = rec.transcript || {};
  const body = `
    ${letterhead("Working fire radio transcript")}
    <h1>${escapeHtml(rec.address || "(no address)")}</h1>
    <div class="meta">${escapeHtml(rec.description || "Working fire")}${rec.incidentNumber ? ` · Incident ${escapeHtml(rec.incidentNumber)}` : ""}${rec.department ? ` · ${escapeHtml(rec.department)}` : ""}</div>
    <div class="meta">${fmtDate(rec.startedAt)}, ${fmtTime(rec.startedAt)}–${fmtTime(rec.endedAt)} · ${clips.length} transmissions${filtered ? ` (of ${rec.clipCount}; filtered)` : ""} · ${escapeHtml(fmtLen(rec.audioSeconds))} of radio traffic</div>
    <div class="meta">Talkgroups: ${escapeHtml(tgs.join(", ") || "—")}</div>
    <h2>Radio log</h2>
    <table><thead><tr><th style="width:70px">Time</th><th style="width:70px">Into call</th><th style="width:130px">Radio</th><th>Transmission</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="meta" style="margin-top:16px">Machine transcription (Whisper${t.model ? ` ${escapeHtml(t.model)}` : ""}, run on the ${escapeHtml(BRAND.app)} server${t.at ? ` ${fmtDate(t.at)}` : ""}). * = corrected by hand.
    Radio audio is often unclear: check important lines against the recording before relying on them.</p>`;
  printDocument(`Transcript — ${rec.address}`, body);
}

// The incident's command board, for after-action reviews: linked by incident number on its own, or picked here
function CommandBoardLink({ rec, onChange }) {
  const [boards, setBoards] = useState(null), [pick, setPick] = useState(""), [msg, setMsg] = useState("");
  const set = async boardId => {
    try { const r = await api(`/${rec.id}/command-board`, { method: "PUT", body: JSON.stringify({ boardId }) }); onChange(r.recording); setBoards(null); setMsg(""); }
    catch (e) { setMsg(e.message); }
  };
  const b = rec.commandBoard;
  return (
    <div style={{ marginTop: 10, padding: "8px 10px", background: "#F3F5F8", borderRadius: 6, fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <b>Command board:</b>
      {b ? <>
        <span>#{b.number} {b.nature}{b.commander ? ` · ${b.commander}` : ""}{b.status === "open" ? " · still open" : ""}</span>
        <a href={`/api/command/${b.id}/report`} target="_blank" rel="noopener noreferrer" style={{ ...btn("outline"), textDecoration: "none", padding: "3px 10px" }}>Open after-action report</a>
        <button style={{ ...btn("ghost"), padding: "3px 8px" }} onClick={() => window.dispatchEvent(new CustomEvent("sgfd-open", { detail: { module: "command", init: { board: b.id } } }))}>Open the board</button>
        <button style={{ ...btn("ghost"), padding: "3px 8px", color: "#C8102E" }} onClick={() => window.confirm("Remove the command board from this recording?") && set(null)}>Remove</button>
      </> : boards ? <>
        <select aria-label="Command board to attach" style={{ ...inputStyle, width: "auto" }} value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Pick a board…</option>
          {boards.map(x => <option key={x.id} value={x.id}>#{x.number} {x.nature} · {x.address} · {new Date(x.openedAt).toLocaleDateString()}</option>)}
        </select>
        <button style={{ ...btn("primary"), padding: "3px 10px" }} disabled={!pick} onClick={() => set(pick)}>Attach</button>
        <button style={{ ...btn("ghost"), padding: "3px 8px" }} onClick={() => setBoards(null)}>Cancel</button>
      </> : <>
        <span style={{ color: "#4B5565" }}>None attached.</span>
        <button style={{ ...btn("outline"), padding: "3px 10px" }} onClick={() => fetch("/api/command", { credentials: "same-origin" }).then(r => r.json()).then(j => setBoards((j.boards || []).filter(x => x.kind !== "training")), () => setMsg("Couldn't load the boards."))}>Attach a command board</button>
      </>}
      {msg && <span style={{ color: "#C8102E" }}>{msg}</span>}
    </div>
  );
}

function RecordingView({ id, me, departments, onBack, onDeleted }) {
  const [rec, setRec] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [hiddenTg, setHiddenTg] = useState([]);
  const [unit, setUnit] = useState("");
  const [current, setCurrent] = useState(null);     // clip id
  const [playing, setPlaying] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const audio = useRef(null);
  const rowRefs = useRef({});

  useEffect(() => { api(`/${id}`).then(r => setRec(r.recording), e => setError(e.message)); }, [id]);
  // While a transcript is being made, check on it every few seconds
  const tStatus = rec?.transcript?.status;
  useEffect(() => {
    if (tStatus !== "queued" && tStatus !== "running") return;
    const t = setInterval(() => api(`/${id}`).then(r => setRec(r.recording), () => {}), 3000);
    return () => clearInterval(t);
  }, [id, tStatus]);
  const [editingClip, setEditingClip] = useState(null);   // { id, text }
  async function saveClip() {
    const e = editingClip;
    try {
      const r = await api(`/${id}/clips/${e.id}`, { method: "PUT", body: JSON.stringify({ text: e.text }) });
      setRec(x => ({ ...x, clips: x.clips.map(c => c.id === e.id ? { ...c, text: r.text, edited: true } : c) }));
      setEditingClip(null);
    } catch (x) { setError(x.message); }
  }
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate, current]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume, current]);

  const tgColor = useMemo(() => {
    const m = {}; (rec?.talkgroups || []).forEach((t, i) => { m[t] = TG_COLORS[i % TG_COLORS.length]; }); return m;
  }, [rec]);
  const units = useMemo(() => [...new Set((rec?.clips || []).map(c => c.unit || c.unitId).filter(Boolean))].sort(), [rec]);
  const queue = useMemo(() => (rec?.clips || []).filter(c => !hiddenTg.includes(c.talkgroup) && (!unit || (c.unit || c.unitId) === unit)), [rec, hiddenTg, unit]);
  const idx = queue.findIndex(c => c.id === current);
  const clip = (rec?.clips || []).find(c => c.id === current) || null;

  function play(c) {
    setCurrent(c.id);
    const a = audio.current;
    a.src = `/api/recordings/${id}/clips/${c.id}.wav`;
    a.playbackRate = rate; a.volume = volume;
    a.play().then(() => setPlaying(true), () => setPlaying(false));
    const row = rowRefs.current[c.id];
    if (row) row.scrollIntoView({ block: "nearest" });
  }
  function toggle() {
    const a = audio.current;
    if (!clip || idx < 0) { if (queue[0]) play(queue[0]); return; }
    if (a.paused) a.play().then(() => setPlaying(true), () => {}); else { a.pause(); setPlaying(false); }
  }
  const step = d => { const n = queue[(idx < 0 ? 0 : idx) + d]; if (n) play(n); };
  function onEnded() {
    setPlaying(false);
    if (autoNext && idx >= 0 && queue[idx + 1]) play(queue[idx + 1]);
  }
  async function remove() {
    if (!window.confirm(`Delete the recording for ${rec.address}?\n\nThe audio and the original file are removed. This can't be undone.`)) return;
    try { await api(`/${id}`, { method: "DELETE" }); onDeleted(); } catch (e) { setError(e.message); }
  }

  if (error && !rec) return <div style={cardStyle}><button style={btn("ghost")} onClick={onBack}>‹ All recordings</button><div style={{ color: BRICK, marginTop: 8 }}>{error}</div></div>;
  if (!rec) return <div style={{ color: INK_SOFT, padding: 20 }}>Loading recording…</div>;
  const canEdit = me.role === "master" || rec.importedById === me.id;
  const hasText = rec.clips.some(c => c.text != null);

  return (
    <div>
      <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}>‹ All recordings</button>
      <div style={{ ...cardStyle, marginTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: INK }}>{rec.address || "(no address)"}</div>
            <div style={{ fontSize: 13.5, color: INK_SOFT, marginTop: 3 }}>
              {rec.description || "Recording"}{rec.incidentNumber ? ` · Incident ${rec.incidentNumber}` : ""}{rec.department ? ` · ${rec.department}` : ""}
            </div>
            <div style={{ fontSize: 13, color: INK, marginTop: 6 }}>
              <b>{fmtDate(rec.startedAt)}</b>, {fmtTime(rec.startedAt)}–{fmtTime(rec.endedAt)}
              <span style={{ color: INK_SOFT }}> · {rec.clipCount} transmissions · {fmtLen(rec.audioSeconds)} of radio traffic</span>
            </div>
            {rec.notes && <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 6, whiteSpace: "pre-wrap" }}>{rec.notes}</div>}
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>Imported by {rec.importedBy} on {fmtDate(rec.importedAt)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <a href={`/api/recordings/${id}/download`} style={{ ...btn("outline"), textDecoration: "none" }}>Download for NICE player</a>
            {canEdit && !editing && <button style={btn("outline")} onClick={() => setEditing(true)}>Edit details</button>}
            {me.role === "master" && <button style={{ ...btn("ghost"), color: BRICK }} onClick={remove}>Delete</button>}
          </div>
        </div>
        <CommandBoardLink rec={rec} onChange={setRec} />
        {editing && <EditDetails rec={rec} departments={departments} onCancel={() => setEditing(false)} onSaved={r => { setRec(r); setEditing(false); }} />}
        {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
      </div>

      <TranscriptCard rec={rec} queue={queue} hiddenTg={hiddenTg} unit={unit} onChange={setRec} />

      {/* Player */}
      <div style={{ ...cardStyle, marginTop: 12, position: "sticky", top: 8, zIndex: 2, boxShadow: "0 2px 10px rgba(19,35,63,0.08)" }}>
        <audio ref={audio} onEnded={onEnded} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} preload="none" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button aria-label="Previous transmission" style={{ ...btn("outline"), padding: "7px 11px" }} onClick={() => step(-1)} disabled={idx <= 0}>⏮</button>
          <button style={{ ...btn("primary"), minWidth: 110, justifyContent: "center" }} onClick={toggle}>
            {playing ? "❚❚ Pause" : clip ? "▶ Resume" : "▶ Play all"}
          </button>
          <button aria-label="Next transmission" style={{ ...btn("outline"), padding: "7px 11px" }} onClick={() => step(1)} disabled={idx < 0 || idx >= queue.length - 1}>⏭</button>
          <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13 }}>
            {clip ? (
              <>
                <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {fmtTime(clip.startedAt, true)} · <span style={{ color: tgColor[clip.talkgroup] }}>{clip.talkgroup}</span> · {clip.unit || clip.unitId || "Unknown radio"}
                </div>
                <div style={{ color: INK_SOFT, fontSize: 12 }}>Transmission {idx + 1} of {queue.length} · {elapsed(rec.startedAt, clip.startedAt)} into the call</div>
              </>
            ) : <span style={{ color: INK_SOFT }}>{queue.length} transmissions ready. Play all runs them in order, back to back.</span>}
          </div>
          <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", alignItems: "center", gap: 5 }}>Volume
            <input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} />
          </label>
          <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", alignItems: "center", gap: 5 }}>Speed
            <select aria-label="Playback speed" style={{ ...inputStyle, width: "auto", padding: "4px 6px", fontSize: 12.5 }} value={rate} onChange={e => setRate(Number(e.target.value))}>
              {[1, 1.25, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: INK_SOFT, display: "flex", alignItems: "center", gap: 5 }}>
            <input type="checkbox" checked={autoNext} onChange={e => setAutoNext(e.target.checked)} /> Keep playing
          </label>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: INK_SOFT }}>Talkgroups:</span>
          {rec.talkgroups.map(t => {
            const on = !hiddenTg.includes(t);
            const n = rec.clips.filter(c => c.talkgroup === t).length;
            return (
              <label key={t} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5, cursor: "pointer", padding: "3px 9px", borderRadius: 999, border: `1px solid ${on ? tgColor[t] : LINE}`, color: on ? tgColor[t] : INK_SOFT, fontWeight: 600 }}>
                <input type="checkbox" checked={on} onChange={() => setHiddenTg(h => on ? [...h, t] : h.filter(x => x !== t))} style={{ margin: 0 }} />
                {t} ({n})
              </label>
            );
          })}
          <select aria-label="Filter by radio" style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12.5, marginLeft: 6 }} value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="">All radios</option>
            {units.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ ...cardStyle, marginTop: 12, padding: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "92px 84px minmax(120px, 1.2fr) minmax(120px, 1fr) 70px 70px", gap: 8, padding: "10px 16px", fontSize: 11.5, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${LINE}` }}>
          <span>Time</span><span>Into call</span><span>Talkgroup</span><span>Radio</span><span>Length</span><span></span>
        </div>
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {queue.length === 0 && <div style={{ padding: 16, color: INK_SOFT, fontSize: 13 }}>No transmissions match.</div>}
          {queue.map(c => {
            const isCur = c.id === current;
            return (
              <div key={c.id} ref={el => { rowRefs.current[c.id] = el; }} onClick={() => play(c)} role="button" aria-label={`Play ${fmtTime(c.startedAt, true)} ${c.talkgroup} ${c.unit}`}
                style={{
                  display: "grid", gridTemplateColumns: "92px 84px minmax(120px, 1.2fr) minmax(120px, 1fr) 70px 70px", gap: 8,
                  padding: "7px 16px", fontSize: 13, cursor: "pointer", borderBottom: `1px solid ${LINE}`,
                  background: isCur ? "#E6ECF5" : "transparent", boxShadow: isCur ? `inset 3px 0 0 ${BRICK}` : "none", alignItems: "center",
                }}>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtTime(c.startedAt, true)}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", color: INK_SOFT }}>{elapsed(rec.startedAt, c.startedAt)}</span>
                <span style={{ color: tgColor[c.talkgroup], fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.talkgroup || "—"}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.unit || c.unitId || "Unknown radio"}</span>
                <span style={{ color: INK_SOFT, fontVariantNumeric: "tabular-nums" }}>{fmtLen(c.duration)}</span>
                <span style={{ color: isCur && playing ? SAGE : BRASS_DEEP, fontWeight: 700, fontSize: 12 }}>{isCur && playing ? "Playing" : "▶ Play"}</span>
                {hasText && (
                  <div style={{ gridColumn: "1 / -1", marginTop: -2, paddingLeft: 100 }} onClick={e => editingClip?.id === c.id && e.stopPropagation()}>
                    {editingClip?.id === c.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <textarea aria-label="Transmission text" autoFocus value={editingClip.text} rows={2} onChange={e => setEditingClip({ ...editingClip, text: e.target.value })}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveClip(); } if (e.key === "Escape") setEditingClip(null); }}
                          style={{ ...inputStyle, flex: 1, fontSize: 13, padding: "5px 8px" }} />
                        <button style={{ ...btn("primary"), padding: "5px 10px", fontSize: 12.5 }} onClick={saveClip}>Save</button>
                        <button style={{ ...btn("ghost"), padding: "5px 8px", fontSize: 12.5 }} onClick={() => setEditingClip(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13.5, color: c.text ? INK : INK_SOFT, fontStyle: c.text ? "normal" : "italic" }}>
                        <span style={{ flex: 1 }}>{c.text == null ? "Not transcribed yet" : c.text || "(nothing understandable)"}{c.edited && <span title="Corrected by hand" style={{ color: SAGE, fontSize: 11.5, fontStyle: "normal", marginLeft: 6 }}>✓ corrected</span>}</span>
                        {c.text != null && <button aria-label={`Correct the text at ${fmtTime(c.startedAt, true)}`} onClick={e => { e.stopPropagation(); setEditingClip({ id: c.id, text: c.text || "" }); }}
                          style={{ border: "none", background: "none", color: BRASS_DEEP, cursor: "pointer", fontSize: 12, fontWeight: 600, padding: 0 }}>Correct</button>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function RecordingsModule({ onBack }) {
  const [me, setMe] = useState(null);
  const [list, setList] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState(null);

  const load = () => api("").then(r => setList(r.recordings), e => setError(e.message));
  const loadDepts = () => api("/departments").then(r => setDepartments(r.departments), () => {});
  useEffect(() => {
    load(); loadDepts();
    (async () => {
      const roster = await loadShared("roster", []);
      let id = null;
      try { const x = await window.storage.get("current-identity", false); id = x ? x.value : null; } catch (e) {}
      setMe(roster.find(u => u.id === id) || { id, role: "user" });
    })();
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const view = useListView(list || [], {
    search: r => [r.address, r.incidentNumber, r.description, r.department, r.notes, r.talkgroups.join(" "), r.importedBy],
    sorts: [
      { key: "date", label: "Date", get: r => r.startedAt, dir: "desc" },
      { key: "address", label: "Address", get: r => r.address, dir: "asc" },
      { key: "length", label: "Radio traffic", get: r => r.audioSeconds, dir: "desc" },
      { key: "department", label: "Department", get: r => r.department, dir: "asc" },
      { key: "imported", label: "Date imported", get: r => r.importedAt, dir: "desc" },
    ],
    filters: [
      { key: "department", label: "Department", get: r => r.department },
      { key: "year", label: "Year", get: r => yearOf(r.startedAt) },
      { key: "talkgroup", label: "Talkgroup", get: r => r.talkgroups[0] || "",
        options: [...new Set((list || []).flatMap(r => r.talkgroups))].sort().map(t => ({ value: t, label: t })),
        match: (r, v) => r.talkgroups.includes(v) },
    ],
  });

  const deptNames = [...new Set((list || []).map(r => r.department).filter(Boolean))].sort();
  const shellActive = importing ? "import" : (view.filterValues.department || "all");
  const shellGo = k => {
    setOpenId(null);
    if (k === "import") { setImporting(true); return; }
    setImporting(false); view.setFilter("department", k === "all" ? "" : k);
  };
  const shellNav = [
    { key: "all", label: "All recordings", icon: Headphones },
    ...deptNames.map(d => ({ key: d, label: d, icon: Building2, group: "Departments" })),
    { key: "import", label: "Import recording", icon: Upload, group: "Actions" },
  ];

  return (
    <AppShell section="Fire Recordings" nav={shellNav} active={shellActive} onNav={shellGo} onHome={onBack}>
      <div>
        {!me ? <div style={{ color: INK_SOFT }}>Loading…</div> : openId ? (
          <RecordingView id={openId} me={me} departments={departments} onBack={() => { setOpenId(null); load(); }}
            onDeleted={() => { setOpenId(null); load(); showToast("Recording deleted"); }} />
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={sectionTitle}>Working Fire Recordings</div>
                <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>Radio traffic from working fires, imported from NICE Inform. Click one to listen.</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {me?.role === "master" && <DepartmentsEditor departments={departments} onChanged={loadDepts} />}
                {!importing && <button style={btn("primary")} onClick={() => setImporting(true)}>+ Import recording</button>}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {importing && (
                <ImportForm departments={departments} onCancel={() => setImporting(false)}
                  onOpenExisting={id => { setImporting(false); setOpenId(id); }}
                  onDone={r => { setImporting(false); showToast(`Imported ${r.address}: ${r.clipCount} transmissions`); load(); setOpenId(r.id); }} />
              )}
              {error && <div style={{ ...cardStyle, color: BRICK }}>{error}</div>}
              {list === null && !error && <div style={{ color: INK_SOFT }}>Loading…</div>}
              {list && (
                <>
                  <ListControls view={view} placeholder="Search address, incident #, department, talkgroup…" label="recordings" />
                  {view.total === 0 && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>{view.active ? "No recordings match." : "No recordings yet. Use Import recording to add one."}</div>}
                  {view.pageItems.map(r => (
                    <div key={r.id} onClick={() => setOpenId(r.id)} role="button" aria-label={`Open ${r.address}`}
                      style={{ ...cardStyle, marginBottom: 8, padding: "12px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.address}</div>
                        <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>
                          {r.description}{r.incidentNumber ? ` · ${r.incidentNumber}` : ""}{r.department ? ` · ${r.department}` : ""}
                        </div>
                        <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 3 }}>{r.talkgroups.join(" · ")}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13 }}>
                        <div style={{ fontWeight: 700 }}>{fmtDate(r.startedAt)}</div>
                        <div style={{ color: INK_SOFT }}>{fmtTime(r.startedAt)}–{fmtTime(r.endedAt)} · {r.clipCount} transmissions · {fmtLen(r.audioSeconds)}</div>
                      </div>
                    </div>
                  ))}
                  <Pager view={view} />
                </>
              )}
            </div>
          </>
        )}
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </AppShell>
  );
}
