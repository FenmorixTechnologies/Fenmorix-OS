// Voice simulator: fireground radio scenarios and leadership conversations. Push to talk records the microphone as a
// 16 kHz WAV (Whisper on the Nexus server can't read the browser's webm/opus), the server transcribes it, the assistant
// answers as Dispatch / units / the member, and replies are spoken with the browser's speech synthesis. At the end the
// run is graded against the rubric (the linked program module's elements, or the scenario's own) and can be replayed.
import React, { useEffect, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { Radio, Mic, MicOff, Send, Square, Play, Volume2, VolumeX, ChevronLeft, Plus, Trash2, Pencil, MessageSquare, AlertTriangle, CheckCircle2, Sparkles, Timer, FileText, Printer } from "lucide-react";
import { cardStyle, inputStyle, btn, printDocument, escapeHtml } from "./App.jsx";
import { INK, INK_SOFT, LINE, PAPER, BRICK, SAGE, AMBER, BLUE, call, label, KIND_LABEL, pctColor, fmtWhen, mmss } from "./evalsShared.js";
import SceneMap from "./SceneMap.jsx";

const H = ({ children, right }) => <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}><div style={{ fontSize: 16, fontWeight: 800, color: INK, flex: 1 }}>{children}</div>{right}</div>;
const Err = ({ children }) => children ? <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 8 }}>{children}</div> : null;

// ---- Microphone -> 16 kHz mono WAV ---------------------------------------------------------------------
export function encodeWav(chunks, rate, target = 16000) {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(len);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const ratio = rate / target, n = Math.floor(len / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {           // average the source samples that fall in each output sample (simple low-pass)
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const str = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, target, true); v.setUint32(28, target * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}
const b64 = buf => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
class MicRecorder {
  async open() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = []; this.on = false;
    this.proc.onaudioprocess = e => { if (this.on) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
    src.connect(this.proc); this.proc.connect(this.ctx.destination);
  }
  start() { this.chunks = []; this.on = true; this.started = Date.now(); this.ctx?.resume?.(); }
  stop() { this.on = false; const secs = (Date.now() - this.started) / 1000; return { wav: this.chunks.length ? encodeWav(this.chunks, this.ctx.sampleRate) : null, secs }; }
  close() { try { this.stream?.getTracks().forEach(t => t.stop()); this.ctx?.close(); } catch { /* already closed */ } this.ctx = null; }
}

// ---- Speech out -------------------------------------------------------------------------------------------
function useVoice() {
  const [on, setOn] = useState(() => { try { return localStorage.getItem("sgfd-sim-voice") !== "off"; } catch { return true; } });
  const queue = useRef(Promise.resolve());
  useEffect(() => { try { localStorage.setItem("sgfd-sim-voice", on ? "on" : "off"); } catch { /* private mode */ } if (!on) window.speechSynthesis?.cancel(); }, [on]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function squelch() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1450; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.09);
      setTimeout(() => ctx.close(), 300);
    } catch { /* no audio */ }
  }
  function say(entries, radio) {
    if (!on || !window.speechSynthesis) return queue.current;
    const voices = window.speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
    for (const e of entries) {
      if (e.who === "officer" || e.who === "system") continue;
      queue.current = queue.current.then(() => new Promise(res => {
        if (radio && e.who !== "scene") squelch();
        const u = new SpeechSynthesisUtterance(e.who === "scene" ? e.text : e.text);
        let h = 0; for (const ch of e.from || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        if (voices.length) u.voice = voices[h % voices.length];
        u.rate = e.who === "scene" ? 1 : 1.08; u.pitch = 0.85 + (h % 5) * 0.08;
        u.onend = u.onerror = () => res();
        setTimeout(res, 20000);
        window.speechSynthesis.speak(u);
      }));
    }
    return queue.current;
  }
  return { on, setOn, say, stop: () => { window.speechSynthesis?.cancel(); queue.current = Promise.resolve(); } };
}

// ---- Transcript ------------------------------------------------------------------------------------------
function Log({ entries, radio, highlight, onPlayFrom }) {
  const box = useRef(null);
  // keep the newest line in view inside the log (never scroll the page itself)
  useEffect(() => { const el = box.current; if (el && !onPlayFrom) el.scrollTop = el.scrollHeight; }, [entries.length]);
  return (
    <div ref={box} role="log" aria-label={radio ? "Radio traffic" : "Conversation"} style={{ display: "grid", gap: 6, maxHeight: onPlayFrom ? "none" : "52vh", overflow: "auto", padding: 4 }}>
      {entries.map((e, i) => {
        const mine = e.who === "officer";
        if (e.who === "scene") return <div key={i} style={{ background: "#FFF6E5", border: `1px solid #F0D9AE`, borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }}>
          <span style={{ fontWeight: 800, color: AMBER }}>{mmss(e.t)} · What you see</span><div>{e.text}</div></div>;
        if (e.who === "system") return <div key={i} style={{ textAlign: "center", fontSize: 12, color: INK_SOFT }}>{mmss(e.t)} · {e.text}</div>;
        if (e.who === "place") return <div key={i} style={{ fontSize: 12, color: BLUE, padding: "0 4px" }}>{mmss(e.t)} · <b>{e.from}</b> positioned: {e.text}</div>;
        return (
          <div key={i} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "80%", background: mine ? "#E5EEF9" : "#fff", border: `1px solid ${highlight?.has(i) ? AMBER : LINE}`, borderRadius: 10, padding: "6px 10px" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: mine ? BLUE : INK_SOFT }}>{mmss(e.t)} · {mine ? (e.from || "You") : e.from}
                {onPlayFrom && <button aria-label={`Play from ${mmss(e.t)}`} title="Play from here" style={{ border: 0, background: "none", cursor: "pointer", color: BLUE, padding: "0 0 0 6px" }} onClick={() => onPlayFrom(i)}><Play size={11} /></button>}</div>
              <div style={{ fontSize: 14 }}>{e.text}</div>
            </div>
          </div>);
      })}
    </div>
  );
}

// ---- Live run ----------------------------------------------------------------------------------------------
function LiveRun({ session: s0, onEnded, transcriber }) {
  const [s, setS] = useState(s0), [entries, setEntries] = useState(s0.transcript), [clock, setClock] = useState(0), [busy, setBusy] = useState(""), [talking, setTalking] = useState(false);
  const [text, setText] = useState(""), [note, setNote] = useState(""), [mood, setMood] = useState(s0.mood), [micErr, setMicErr] = useState("");
  const [placements, setPlacements] = useState(s0.placements || []);
  const radio = s.scenario.kind === "radio";
  const voice = useVoice();
  const startAt = useRef(Date.now() - Math.max(0, ...s0.transcript.map(e => e.t || 0)) * 1000);
  const rec = useRef(null), keyClock = useRef(0), ended = useRef(false);
  const now = () => Math.floor((Date.now() - startAt.current) / 1000);
  const limit = (s.scenario.data?.minutes || 10) * 60;
  useEffect(() => { voice.say(s0.transcript, radio); }, []);
  useEffect(() => {
    const t = setInterval(() => setClock(now()), 500);
    const k = setInterval(async () => {
      if (ended.current || !radio) return;
      try { const r = await call(`/sessions/${s.id}/tick`, { clock: now() }); if (r.events.length) { setEntries(x => [...x, ...r.events]); voice.say(r.events, radio); } } catch { /* next tick */ }
    }, 3000);
    return () => { clearInterval(t); clearInterval(k); rec.current?.close(); };
  }, []);
  async function send(body) {
    setBusy("send"); setNote("");
    try {
      const r = await call(`/sessions/${s.id}/turn`, body);
      if (r.note && !r.said) { setNote(r.note); setBusy(""); return; }
      const mine = { t: body.clock, who: "officer", from: radio ? s.scenario.data?.you : "", text: r.said };
      const replies = r.replies.map(x => ({ t: body.clock, who: "ai", from: x.from, text: x.text }));
      setEntries(x => [...x, ...r.events, mine, ...replies]);
      if (r.mood) setMood(r.mood);
      if (r.note) setNote(r.note);
      voice.say([...r.events, ...replies], radio);
    } catch (e) { setNote(e.message); }
    setBusy("");
  }
  async function keyDown() {
    if (busy || talking) return;
    setMicErr("");
    try {
      if (!rec.current) rec.current = new MicRecorder();
      await rec.current.open();
      voice.stop();
      keyClock.current = now();
      rec.current.start(); setTalking(true);
    } catch (e) { setMicErr(`The microphone isn't available (${e.message}). Allow microphone access for this site, or type instead.`); }
  }
  async function keyUp() {
    if (!talking) return;
    setTalking(false);
    const { wav, secs } = rec.current.stop();
    if (!wav || secs < 0.4) { setNote("Hold the button the whole time you talk."); return; }
    await send({ clock: keyClock.current, audio: b64(wav) });
  }
  useEffect(() => {
    const down = e => { if (e.code === "Space" && !e.repeat && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); keyDown(); } };
    const up = e => { if (e.code === "Space" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); keyUp(); } };
    if (transcriber.ready) { window.addEventListener("keydown", down); window.addEventListener("keyup", up); }
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });
  async function end() {
    if (!window.confirm("End the run and grade it?")) return;
    ended.current = true; voice.stop(); setBusy("end");
    try { const r = await call(`/sessions/${s.id}/end`, { clock: now() }); onEnded(r.session, r.note); } catch (e) { setNote(e.message); setBusy(""); ended.current = false; }
  }
  const d = s.scenario.data || {};
  const scene = radio ? d.scene : null;
  async function placeUnit(unit, x, y, angle) {
    try {
      const r = await call(`/sessions/${s.id}/place`, { unit, x, y, angle, clock: now() });
      if (r.ok) { setPlacements(ps => [...ps.filter(p => p.unit !== unit), r.placement]); setEntries(es => [...es, r.entry]); }
      return r;
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  const units = [{ name: d.you, eta: 0 }, ...(d.units || [])].map(u => ({ name: u.name, arrived: u.eta <= clock }));
  const mapCard = scene && <div style={{ ...cardStyle, padding: 10 }}>
    <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>Position apparatus as units arrive: pick a unit, then click the picture (drag to move it). Where you put them changes what they can do.</div>
    <SceneMap scene={scene} mode="run" clock={clock} units={units} placements={placements} onPlace={placeUnit} height="58vh" />
  </div>;
  const logCard = (
      <div style={{ ...cardStyle, padding: 12 }}>
        <Log entries={entries} radio={radio} />
        {busy === "send" && <div style={{ fontSize: 12.5, color: INK_SOFT, padding: 4 }}>{radio ? "…" : `${d.persona?.name} is thinking…`}</div>}
        <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 8, paddingTop: 10, display: "grid", gap: 8 }}>
          {transcriber.ready ? <button aria-label={radio ? "Push to talk" : "Hold to talk"} disabled={busy === "send" || busy === "end"}
            onPointerDown={e => { e.preventDefault(); keyDown(); }} onPointerUp={keyUp} onPointerLeave={keyUp} onContextMenu={e => e.preventDefault()}
            style={{ ...btn(talking ? "brick" : "primary"), padding: "18px 10px", fontSize: 17, justifyContent: "center", touchAction: "none", userSelect: "none" }}>
            {talking ? <><Mic size={20} /> Talking… let go to send</> : <><Mic size={20} /> {radio ? "Hold to key up" : "Hold to talk"} <span style={{ fontSize: 12, opacity: .8 }}>(or hold Space)</span></>}</button>
            : <div style={{ fontSize: 12.5, color: AMBER }}><MicOff size={13} /> Voice isn't set up on the server ({transcriber.reason || "Whisper isn't installed"}). Type your transmissions below.</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <input aria-label={radio ? "Type a transmission" : "Type what you say"} style={inputStyle} value={text} placeholder={radio ? "…or type the transmission" : "…or type what you'd say"}
              onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && text.trim() && !busy) { send({ clock: now(), text }); setText(""); } }} />
            <button aria-label="Send" style={btn("outline")} disabled={!text.trim() || !!busy} onClick={() => { send({ clock: now(), text }); setText(""); }}><Send size={14} /></button>
          </div>
          {(note || micErr) && <div role="status" style={{ fontSize: 12.5, color: AMBER }}>{micErr || note}</div>}
        </div>
      </div>);
  if (scene) return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.45fr) minmax(300px, 1fr)", gap: 12, alignItems: "start" }} className="sim-grid">
      <style>{`@media (max-width: 980px) { .sim-grid { grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ display: "grid", gap: 10 }}>
        {mapCard}
        <div style={{ ...cardStyle, padding: "8px 12px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div aria-label="Clock" style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: clock > limit ? BRICK : INK }}>{mmss(clock)}</div>
          <div style={{ flex: 1, fontSize: 12.5, minWidth: 180 }}><b>{s.scenario.title}</b><br />You are {d.you} · {s.mode === "practice" ? "practice (private)" : `${KIND_LABEL[s.mode]} · evaluator ${s.evaluator}`}</div>
          <button style={btn("ghost")} onClick={() => voice.setOn(!voice.on)}>{voice.on ? <><Volume2 size={14} /> Voices on</> : <><VolumeX size={14} /> Voices off</>}</button>
          <button style={btn("brick")} disabled={!!busy} onClick={end}><Square size={14} /> {busy === "end" ? "Grading…" : "End and grade"}</button>
        </div>
      </div>
      {logCard}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 320px)", gap: 12, alignItems: "start" }} className="sim-grid">
      <style>{`@media (max-width: 860px) { .sim-grid { grid-template-columns: 1fr !important; } }`}</style>
      {logCard}
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ ...cardStyle, padding: 12, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: INK_SOFT }}>{radio ? "Scenario clock" : "Elapsed"}</div>
          <div aria-label="Clock" style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: clock > limit ? BRICK : INK }}>{mmss(clock)}</div>
          <div style={{ fontSize: 12, color: INK_SOFT }}>{clock > limit ? "Time's up. End the run when you're ready." : `${d.minutes || 10}-minute scenario`}</div>
          {!radio && mood && <div style={{ fontSize: 12.5, marginTop: 4 }}>Mood: <b>{mood}</b></div>}
        </div>
        <div style={{ ...cardStyle, padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{s.scenario.title}</div>
          {radio ? <><div><b>You are:</b> {d.you}</div>
            <div style={{ marginTop: 4 }}><b>Assignment:</b> {[d.you, ...(d.units || []).map(u => u.name)].join(", ")}</div></>
            : <div style={{ whiteSpace: "pre-wrap" }}>{d.situation}</div>}
          <div style={{ marginTop: 6, color: INK_SOFT }}>{s.mode === "practice" ? "Practice run (private, not on your record)" : `${KIND_LABEL[s.mode]} · evaluator ${s.evaluator}`}</div>
        </div>
        <button style={btn("ghost")} onClick={() => voice.setOn(!voice.on)}>{voice.on ? <><Volume2 size={14} /> Voices on</> : <><VolumeX size={14} /> Voices off</>}</button>
        <button style={btn("brick")} disabled={!!busy} onClick={end}><Square size={14} /> {busy === "end" ? "Grading…" : "End and grade"}</button>
      </div>
    </div>
  );
}

// ---- Picking and starting a scenario ---------------------------------------------------------------------
export function Simulator({ d, preset, toast, onOpenSession }) {
  const [list, setList] = useState(null), [tr, setTr] = useState({ ready: false }), [pick, setPick] = useState(null), [error, setError] = useState("");
  const [mode, setMode] = useState(preset?.candidateId ? "formal" : "practice"), [cand, setCand] = useState(preset?.candidateId || ""), [running, setRunning] = useState(null);
  useEffect(() => { call("/scenarios").then(x => setList(x.scenarios)).catch(e => setError(e.message)); call("/transcriber").then(setTr).catch(() => {}); }, []);
  if (running) return <LiveRun session={running} transcriber={tr} onEnded={(s, note) => { if (note) toast?.(note); onOpenSession(s.id); }} />;
  if (!list) return <div style={{ color: INK_SOFT }}>{error || "Loading…"}</div>;
  const shown = preset?.programKey ? list.filter(s => s.programKey === preset.programKey) : list;
  const evalCands = s => d.candidates.filter(c => ["active", "extended"].includes(c.status) && d.programs.find(p => p.id === c.programId)?.key === s.programKey);
  async function start() {
    setError("");
    try {
      const r = await call("/sessions", { scenarioId: pick.id, mode, candidateId: mode === "practice" ? null : cand || null });
      setRunning(r.session);
    } catch (e) { setError(e.message); }
  }
  const progName = k => d.programs.find(p => p.key === k)?.name || k;
  const group = (kind, title, icon) => {
    const items = shown.filter(s => s.kind === kind);
    if (!items.length) return null;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 800, color: INK, display: "flex", gap: 6, alignItems: "center" }}>{icon} {title}</div>
        {items.map(s => (
          <div key={s.id} role="button" tabIndex={0} aria-label={`Scenario ${s.title}`} onClick={() => setPick(s)} onKeyDown={e => e.key === "Enter" && setPick(s)}
            style={{ ...cardStyle, padding: "10px 14px", cursor: "pointer", border: `1px solid ${pick?.id === s.id ? INK : LINE}` }}>
            <div style={{ fontWeight: 700 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: INK_SOFT }}>{s.summary}</div>
            <div style={{ fontSize: 12, color: BLUE, marginTop: 2 }}>{s.minutes} min{s.hasMap ? " · scene map" : ""}{s.programKey ? ` · graded with ${progName(s.programKey)}, module ${s.moduleKey}` : ""}</div>
          </div>))}
      </div>);
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(260px, 1fr)", gap: 14, alignItems: "start", maxWidth: 1150 }} className="sim-grid">
      <style>{`@media (max-width: 860px) { .sim-grid { grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ display: "grid", gap: 14 }}>
        {group("radio", "Fireground radio", <Radio size={16} color={BRICK} />)}
        {group("conversation", "Leadership conversations", <MessageSquare size={16} color={BLUE} />)}
        {shown.length === 0 && <div style={{ ...cardStyle, color: INK_SOFT }}>No scenarios for this program yet.</div>}
      </div>
      <div style={{ ...cardStyle, position: "sticky", top: 12 }}>
        {!pick ? <div style={{ color: INK_SOFT, fontSize: 13.5 }}>
          <b style={{ color: INK }}>How it works</b><br />Pick a scenario. Hold the talk button (or the space bar) and speak like you would on the radio; let go to send. Dispatch, the other units or the member answer out loud. Scene changes show up as the clock runs. When you end the run you get scores against the rubric, what went well, what to work on, how fast you caught any Mayday or safety cues, and a replay of the radio traffic.
          {!tr.ready && <div style={{ marginTop: 8, color: AMBER }}>Voice input isn't set up on the server yet, so you'll type instead.</div>}
          {tr.ready && tr.ai === false && <div style={{ marginTop: 8, color: AMBER }}>The assistant isn't turned on (no ANTHROPIC_API_KEY), so nobody will answer and runs can't be graded.</div>}
        </div> : <>
          <H>{pick.title}</H>
          <div style={{ fontSize: 13.5 }}>{pick.summary}</div>
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <label style={{ fontSize: 13.5 }}><input type="radio" name="mode" checked={mode === "practice"} onChange={() => setMode("practice")} /> Practice (private, not on anyone's record)</label>
            {d.evaluatesAny && pick.programKey && <label style={{ fontSize: 13.5 }}><input type="radio" name="mode" checked={mode !== "practice"} onChange={() => setMode("formal")} /> Evaluated run for a candidate</label>}
          </div>
          {mode !== "practice" && <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            <select aria-label="Candidate" style={inputStyle} value={cand} onChange={e => setCand(e.target.value)}><option value="">Candidate…</option>
              {evalCands(pick).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select aria-label="Run kind" style={inputStyle} value={mode} onChange={e => setMode(e.target.value)}><option value="formal">Formal evaluation</option><option value="retest">Retest</option></select>
            <div style={{ fontSize: 12, color: INK_SOFT }}>Run it on this device with the candidate at the microphone. You'll review the AI's scores and sign the official result afterward.</div>
          </div>}
          <Err>{error}</Err>
          <button style={{ ...btn("primary"), marginTop: 12, width: "100%", justifyContent: "center" }} disabled={mode !== "practice" && !cand} onClick={start}><Play size={15} /> Start</button>
        </>}
      </div>
    </div>
  );
}

// ---- Debrief and replay --------------------------------------------------------------------------------------
export function SessionView({ id, d, toast, onBack, onOpenResult }) {
  const [s, setS] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [tr, setTr] = useState({ ready: false });
  const voice = useVoice();
  const load = () => call(`/sessions/${id}`).then(x => setS(x.session)).catch(e => setError(e.message));
  useEffect(() => { load(); call("/transcriber").then(setTr).catch(() => {}); }, [id]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!s) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  if (s.status === "running" && s.userId === d.me) return <LiveRun session={s} transcriber={tr} onEnded={(x, note) => { if (note) toast?.(note); setS(x); }} />;
  const g = s.grade, radio = s.scenario.kind === "radio", rub = s.rubric;
  const keyIdx = new Set();
  for (const k of g?.keyMoments || []) { const [m, sec] = String(k.t).split(":").map(Number); const t = m * 60 + (sec || 0); const i = s.transcript.findIndex(e => Math.abs((e.t || 0) - t) <= 5 && e.who === "officer"); if (i >= 0) keyIdx.add(i); }
  const playFrom = i => { voice.stop(); voice.say(s.transcript.slice(i).map(e => e.who === "officer" ? { ...e, who: "ai", from: e.from || "Officer" } : e), radio); };
  async function regrade() { setBusy("grade"); try { const r = await call(`/sessions/${id}/end`, {}); setS(r.session); if (r.note) toast?.(r.note); } catch (e) { toast?.(e.message); } setBusy(""); }
  async function makeResult() { setBusy("res"); try { const r = await call(`/sessions/${id}/result`, {}); onOpenResult(r.id); } catch (e) { toast?.(e.message); } setBusy(""); }
  const maxS = rub?.scale?.max || 5;
  const canResult = s.mode !== "practice" && g && rub?.program && (s.evaluator && d.evaluatesAny);
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button style={btn("ghost")} onClick={onBack}><ChevronLeft size={14} /> Runs</button><div style={{ flex: 1 }} />
        {g && <button style={btn("outline")} onClick={() => printDebrief(s)}><Printer size={14} /> Print</button>}
        {canResult && (s.resultId ? <button style={btn("primary")} onClick={() => onOpenResult(s.resultId)}><FileText size={14} /> Open the evaluation</button>
          : <button style={btn("primary")} disabled={!!busy} onClick={makeResult}><FileText size={14} /> Review scores and sign</button>)}</div>
      <div style={cardStyle}>
        <H right={g && <span style={{ fontSize: 24, fontWeight: 800, color: pctColor(g.pct) }}>{g.pct ?? "—"}%</span>}>{s.scenario.title}</H>
        <div style={{ fontSize: 13, color: INK_SOFT }}>{s.name} · {fmtWhen(s.startedAt)} · {KIND_LABEL[s.mode]}{s.evaluator ? ` · evaluator ${s.evaluator}` : ""}{rub?.program ? ` · rubric: ${rub.program.name}, ${rub.module.key} – ${rub.module.title}` : ""}</div>
        {!g && <div style={{ marginTop: 8 }}><span style={{ color: AMBER, fontSize: 13.5 }}>Not graded{s.aiError ? ` (${s.aiError})` : ""}.</span> {(s.userId === d.me || s.evaluator) && <button style={btn("outline")} disabled={!!busy} onClick={regrade}><Sparkles size={14} /> {busy ? "Grading…" : "Grade it"}</button>}</div>}
        {g?.summary && <p style={{ fontSize: 14.5, marginBottom: 0 }}>{g.summary}</p>}
      </div>
      {g && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
        <div style={cardStyle}>
          <H>Scores</H>
          {g.scores.map((x, i) => <div key={i} style={{ borderTop: `1px solid ${LINE}`, padding: "6px 0" }}>
            <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{x.label}{x.mult !== 1 && <span style={{ color: INK_SOFT }}> ×{x.mult}</span>}</div><b>{x.score ?? "—"}/{maxS}</b></div>
            <div style={{ fontSize: 12.5, color: INK_SOFT }}>{x.why}</div></div>)}
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {[["What went well", g.strengths || g.helped, SAGE], ["To work on", g.improvements, AMBER], ...(radio ? [] : [["What escalated it", g.escalated, BRICK]])].map(([t, items, c]) => items?.length ? (
            <div key={t} style={cardStyle}><H>{t}</H><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{items.map((x, i) => <li key={i} style={{ color: INK, marginBottom: 3 }}><span style={{ color: c }}>●</span> {x}</li>)}</ul></div>) : null)}
          {!radio && <div style={cardStyle}><H>Listening, expectations, follow-up</H>
            {[["Listening", g.listening], ["Expectations", g.expectations], ["Follow-up", g.followUp]].map(([t, v]) => v && <div key={t} style={{ fontSize: 13.5, marginBottom: 6 }}><b>{t}:</b> {v}</div>)}
            {g.helped?.length > 0 && <div style={{ fontSize: 13.5 }}><b>Helped:</b> {g.helped.join("; ")}</div>}</div>}
        </div>
      </div>}
      {g && radio && g.cues?.length > 0 && <div style={cardStyle}>
        <H>Mayday and safety cues</H>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}><thead><tr style={{ textAlign: "left", color: INK_SOFT }}><th>Time</th><th>Cue</th><th>Caught?</th><th>Response</th><th>Notes</th></tr></thead>
          <tbody>{g.cues.map((c, i) => <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}><td>{c.t}</td><td>{c.cue}</td>
            <td style={{ color: c.recognized ? SAGE : BRICK, fontWeight: 700 }}>{c.recognized ? <><CheckCircle2 size={13} /> Yes</> : <><AlertTriangle size={13} /> Missed</>}</td>
            <td>{c.responseSeconds !== null && c.responseSeconds !== undefined ? `${c.responseSeconds} s` : "—"}</td><td style={{ fontSize: 12.5 }}>{c.note}</td></tr>)}</tbody></table>
      </div>}
      {radio && s.scenario.data?.scene && <PlacementReplay s={s} note={g?.placement} />}
      {g && radio && g.assignments?.length > 0 && <div style={cardStyle}>
        <H>Assignments and timing</H>
        <div style={{ display: "grid", gap: 4 }}>{g.assignments.map((a, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "52px 140px 1fr", gap: 8, fontSize: 13.5 }}><b>{a.t}</b><span>{a.unit}</span><span>{a.task}</span></div>)}</div>
      </div>}
      {g?.keyMoments?.length > 0 && <div style={cardStyle}>
        <H>Key decisions</H>
        {g.keyMoments.map((k, i) => <div key={i} style={{ borderTop: `1px solid ${LINE}`, padding: "5px 0", fontSize: 13.5 }}><b>{k.t}</b> {k.text} <div style={{ color: INK_SOFT, fontSize: 12.5 }}>{k.note}</div></div>)}
      </div>}
      {g?.flags?.length > 0 && <div style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}` }}><H>For the evaluator to check</H><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5 }}>{g.flags.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
      <div style={cardStyle}>
        <H right={<><button style={btn("outline")} onClick={() => playFrom(0)}><Play size={14} /> Replay</button><button style={btn("ghost")} onClick={voice.stop}><Square size={13} /> Stop</button></>}>{radio ? "Radio traffic" : "Conversation"}</H>
        <Log entries={s.transcript} radio={radio} highlight={keyIdx} onPlayFrom={playFrom} />
      </div>
    </div>
  );
}
// Apparatus positions over the run: slide through time to see where each unit was and the fire then
function PlacementReplay({ s, note }) {
  const end = Math.max(0, ...s.transcript.map(e => e.t || 0));
  const [t, setT] = useState(end);
  const log = s.placementLog || [];
  const at = new Map(); for (const p of log) if (p.t <= t) at.set(p.unit, p);
  const cur = [...at.values()];
  return (
    <div style={cardStyle}>
      <H>Apparatus placement</H>
      {note && <p style={{ fontSize: 14, marginTop: 0 }}>{note}</p>}
      <SceneMap scene={s.scenario.data.scene} mode="view" clock={t} placements={cur} height="52vh" />
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
        <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mmss(t)}</span>
        <input type="range" aria-label="Replay time" min={0} max={end || 1} value={t} onChange={e => setT(Number(e.target.value))} style={{ flex: 1 }} />
      </div>
      {cur.length > 0 && <div style={{ display: "grid", gap: 3, marginTop: 8 }}>{cur.map(p => <div key={p.unit} style={{ fontSize: 13 }}><b>{p.unit}</b> <span style={{ color: INK_SOFT }}>({mmss(p.t)})</span>: {p.notes.join("; ")}</div>)}</div>}
      {log.length === 0 && <div style={{ fontSize: 13, color: INK_SOFT }}>No apparatus were positioned in this run.</div>}
    </div>
  );
}
function printDebrief(s) {
  const g = s.grade, max = s.rubric?.scale?.max || 5;
  const body = `<h1>${escapeHtml(s.scenario.title)}</h1><p class="meta">${escapeHtml(s.name)} · ${escapeHtml(fmtWhen(s.startedAt))} · ${escapeHtml(KIND_LABEL[s.mode])}${s.evaluator ? ` · evaluator ${escapeHtml(s.evaluator)}` : ""}</p>
    <p><b>Score: ${g.pct ?? "—"}%</b></p><p>${escapeHtml(g.summary)}</p>
    <h2>Scores</h2><table><tr><th>Element</th><th>Score</th><th>Why</th></tr>${g.scores.map(x => `<tr><td>${escapeHtml(x.label)}</td><td>${x.score ?? "—"}/${max}</td><td>${escapeHtml(x.why)}</td></tr>`).join("")}</table>
    ${(g.strengths || []).length ? `<h2>What went well</h2><ul>${g.strengths.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    ${(g.improvements || []).length ? `<h2>To work on</h2><ul>${g.improvements.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    ${(g.cues || []).length ? `<h2>Mayday and safety cues</h2><table><tr><th>Time</th><th>Cue</th><th>Caught</th><th>Response</th></tr>${g.cues.map(c => `<tr><td>${escapeHtml(c.t)}</td><td>${escapeHtml(c.cue)}</td><td>${c.recognized ? "Yes" : "Missed"}</td><td>${c.responseSeconds ?? "—"}</td></tr>`).join("")}</table>` : ""}
    <h2>Transcript</h2><table>${s.transcript.map(e => `<tr><td style="width:50px">${mmss(e.t || 0)}</td><td style="width:140px">${escapeHtml(e.who === "officer" ? (e.from || "Officer") : e.who === "scene" ? "Scene" : e.from || "")}</td><td>${escapeHtml(e.text)}</td></tr>`).join("")}</table>`;
  printDocument(`${s.scenario.title} – ${s.name}`, body);
}

export function SessionList({ d, onOpen }) {
  const [rows, setRows] = useState(null), [scope, setScope] = useState("mine");
  useEffect(() => { setRows(null); call(`/sessions?scope=${scope}`).then(x => setRows(x.sessions)).catch(() => setRows([])); }, [scope]);
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1000 }}>
      {d.access.view && <div><select aria-label="Whose runs" style={{ ...inputStyle, width: "auto" }} value={scope} onChange={e => setScope(e.target.value)}><option value="mine">Mine (and ones I evaluated)</option><option value="all">All evaluated runs</option></select></div>}
      <div style={cardStyle}>
        {!rows ? <div style={{ color: INK_SOFT }}>Loading…</div> : rows.length === 0 ? <div style={{ color: INK_SOFT }}>No runs yet.</div> : rows.map(r => (
          <div key={r.id} role="button" tabIndex={0} aria-label={`Open run ${r.title} ${fmtWhen(r.startedAt)}`} onClick={() => onOpen(r.id)} onKeyDown={e => e.key === "Enter" && onOpen(r.id)}
            style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${LINE}`, cursor: "pointer", flexWrap: "wrap" }}>
            {r.kind === "conversation" ? <MessageSquare size={18} color={BLUE} /> : <Radio size={18} color={BRICK} />}
            <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontWeight: 700 }}>{r.title}</div>
              <div style={{ fontSize: 12.5, color: INK_SOFT }}>{r.name} · {fmtWhen(r.startedAt)} · {KIND_LABEL[r.mode]}{r.evaluator ? ` · ${r.evaluator}` : ""}{r.status === "running" ? " · still running" : ""}</div></div>
            <span style={{ fontWeight: 800, color: pctColor(r.pct) }}>{r.pct === null ? "—" : `${r.pct}%`}</span>
          </div>))}
      </div>
    </div>
  );
}

// ---- Scenario editor (manage) ----------------------------------------------------------------------------------
export function ScenarioAdmin({ d, toast }) {
  const [list, setList] = useState(null), [edit, setEdit] = useState(null);
  const load = () => call("/scenarios").then(x => setList(x.scenarios));
  useEffect(() => { load(); }, []);
  if (edit) return <ScenarioEditor s={edit} d={d} onDone={() => { setEdit(null); load(); }} toast={toast} />;
  if (!list) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const blank = kind => ({ kind, title: "", summary: "", programKey: "", moduleKey: "", active: true, data: kind === "radio"
    ? { minutes: 10, you: "Engine ", dispatch: "", arrival: "", setting: "", units: [], injects: [], rubric: [] }
    : { minutes: 8, situation: "", goal: "", persona: { name: "", role: "", opening: "", background: "", mood: "" }, rubric: [] } });
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1000 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><div style={{ flex: 1, fontSize: 13, color: INK_SOFT }}>Build scenarios from real {BRAND.short} fires and your approved criteria. Link one to a program module and it's graded with that module's rubric.</div>
        <button style={btn("outline")} onClick={() => setEdit(blank("radio"))}><Plus size={14} /> Radio scenario</button><button style={btn("outline")} onClick={() => setEdit(blank("conversation"))}><Plus size={14} /> Conversation</button></div>
      {list.map(s => <div key={s.id} style={{ ...cardStyle, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center" }}>
        {s.kind === "conversation" ? <MessageSquare size={18} color={BLUE} /> : <Radio size={18} color={BRICK} />}
        <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{s.title} {!s.active && <span style={{ color: INK_SOFT }}>(off)</span>}</div><div style={{ fontSize: 12.5, color: INK_SOFT }}>{s.summary}</div></div>
        <button aria-label={`Edit ${s.title}`} style={btn("outline")} onClick={() => setEdit(s)}><Pencil size={13} /> Edit</button></div>)}
    </div>
  );
}
// The scene picture for Strategies & Tactics: upload one, or load USGS aerial imagery for an address
function SceneEditor({ scene, onChange }) {
  const [addr, setAddr] = useState(scene?.address || ""), [feet, setFeet] = useState("600"), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const blank = img => ({ imageId: img.id, width: img.width, height: img.height, ftPerPx: img.ftPerPx || null, attribution: img.attribution || "", address: img.matched || addr,
    wind: scene?.wind || { from: 90, mph: 5 }, hydrants: [], building: [], fire: [], hazards: [], blocked: [] });
  async function upload(f) {
    if (!f) return;
    setBusy("up"); setError("");
    try {
      const url = URL.createObjectURL(f);
      const dims = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error("That file isn't a picture this browser can read.")); im.src = url; });
      URL.revokeObjectURL(url);
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
      const img = await call("/images", { name: f.name, mime: f.type, data, width: dims.w, height: dims.h });
      onChange(blank(img));
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function aerial() {
    setBusy("usgs"); setError("");
    try { const img = await call("/aerial", { address: addr, feet: Number(feet) }); onChange(blank(img)); } catch (e) { setError(e.message); }
    setBusy("");
  }
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 800 }}>Scene map (Strategies &amp; Tactics)</div>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>An overhead picture of the address. The officer positions apparatus on it during the run, and positions change what units can do (hose and aerial reach, hydrant distance, blocked access, collapse zones). Upload a picture (Google Earth screenshot with its credit line, drone photo, pre-plan drawing) or load free USGS aerial imagery.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ ...btn("outline"), cursor: "pointer" }}>{busy === "up" ? "Uploading…" : scene ? "Replace with a picture…" : "Upload a picture…"}
          <input type="file" aria-label="Scene picture" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={e => upload(e.target.files[0])} /></label>
        <span style={{ color: INK_SOFT, fontSize: 13 }}>or</span>
        <input aria-label="Scene address" style={{ ...inputStyle, maxWidth: 300 }} placeholder="Street address, city, LA" value={addr} onChange={e => setAddr(e.target.value)} />
        <select aria-label="Area across" style={{ ...inputStyle, width: "auto" }} value={feet} onChange={e => setFeet(e.target.value)}>{["400", "600", "1000", "1500"].map(f => <option key={f} value={f}>{f} ft across</option>)}</select>
        <button type="button" style={btn("outline")} disabled={!addr.trim() || !!busy} onClick={aerial}>{busy === "usgs" ? "Loading…" : "Load USGS aerial"}</button>
        {scene && <button type="button" style={btn("ghost")} onClick={() => { if (window.confirm("Remove the scene map from this scenario?")) onChange(null); }}>Remove map</button>}
      </div>
      {error && <div role="alert" style={{ color: BRICK, fontSize: 13 }}>{error}</div>}
      {scene && <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          <label>Wind from <input aria-label="Wind from (degrees)" style={{ ...inputStyle, width: 70, padding: "4px 6px" }} value={scene.wind?.from ?? 90} onChange={e => onChange({ ...scene, wind: { ...scene.wind, from: Number(e.target.value) || 0 } })} />° (0 = north, 90 = east)</label>
          <label>at <input aria-label="Wind mph" style={{ ...inputStyle, width: 60, padding: "4px 6px" }} value={scene.wind?.mph ?? 0} onChange={e => onChange({ ...scene, wind: { ...scene.wind, mph: Number(e.target.value) || 0 } })} /> mph</label>
          <span style={{ color: INK_SOFT }}>{scene.ftPerPx ? `Scale: ${Math.round(scene.width * scene.ftPerPx)} ft across` : "No scale yet"}</span>
        </div>
        <SceneMap scene={scene} mode="edit" onChange={onChange} height="60vh" />
        <div style={{ fontSize: 12, color: INK_SOFT }}>Tools: <b>Set scale</b> (click both ends of something you know), <b>Hydrant</b>, <b>Fire</b> (asks when it shows), <b>Hazard</b> (power lines show to the officer; collapse zones are hidden and graded), <b>No access</b> (drag a box: parked cars, fences, soft ground), <b>Building outline</b> (click the corners), <b>Erase</b>. Scroll or use +/− to zoom; drag with Move to pan.</div>
      </>}
    </div>
  );
}

function ScenarioEditor({ s: s0, d, onDone, toast }) {
  const [s, setS] = useState(JSON.parse(JSON.stringify(s0))), [error, setError] = useState("");
  const D = s.data, setD = (k, v) => setS({ ...s, data: { ...D, [k]: v } });
  const radio = s.kind === "radio";
  const prog = d.programs.find(p => p.key === s.programKey);
  const T = (k, l, rows = 3, obj) => <label style={{ display: "block" }}><span style={label}>{l}</span><textarea aria-label={l} rows={rows} style={inputStyle} value={(obj ? D[obj][k] : D[k]) || ""}
    onChange={e => obj ? setD(obj, { ...D[obj], [k]: e.target.value }) : setD(k, e.target.value)} /></label>;
  const rows = (k, cols, add) => <div style={{ display: "grid", gap: 4 }}>
    {(D[k] || []).map((r, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: `${cols.map(c => c.w || "1fr").join(" ")} auto`, gap: 4 }}>
      {cols.map(c => c.type === "check" ? <label key={c.k} style={{ fontSize: 12.5 }}><input type="checkbox" checked={!!r[c.k]} onChange={e => setD(k, D[k].map((x, j) => j === i ? { ...x, [c.k]: e.target.checked } : x))} /> {c.l}</label>
        : <input key={c.k} aria-label={`${c.l} ${i + 1}`} placeholder={c.l} style={inputStyle} value={r[c.k] ?? ""} onChange={e => setD(k, D[k].map((x, j) => j === i ? { ...x, [c.k]: c.num ? Number(e.target.value) || 0 : e.target.value } : x))} />)}
      <button aria-label="Remove row" style={btn("ghost")} onClick={() => setD(k, D[k].filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>)}
    <div><button style={btn("ghost")} onClick={() => setD(k, [...(D[k] || []), add])}><Plus size={13} /> Add</button></div></div>;
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000 }}>
      <div><button style={btn("ghost")} onClick={onDone}><ChevronLeft size={14} /> Scenarios</button></div>
      <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
        <H>{radio ? "Radio scenario" : "Leadership conversation"}</H>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <label><span style={label}>Title</span><input aria-label="Scenario title" style={inputStyle} value={s.title} onChange={e => setS({ ...s, title: e.target.value })} /></label>
          <label><span style={label}>Minutes</span><input type="number" aria-label="Minutes" style={inputStyle} value={D.minutes} onChange={e => setD("minutes", e.target.value)} /></label>
        </div>
        <label><span style={label}>Summary (shown in the list)</span><input aria-label="Summary" style={inputStyle} value={s.summary} onChange={e => setS({ ...s, summary: e.target.value })} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
          <label><span style={label}>Grade with program</span><select aria-label="Linked program" style={inputStyle} value={s.programKey} onChange={e => setS({ ...s, programKey: e.target.value, moduleKey: "" })}><option value="">Its own rubric (below)</option>{d.programs.filter(p => p.key).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
          <label><span style={label}>Module</span><select aria-label="Linked module" style={inputStyle} value={s.moduleKey} disabled={!prog} onChange={e => setS({ ...s, moduleKey: e.target.value })}><option value="">—</option>{(prog?.modules || []).map(m => <option key={m.key} value={m.key}>{m.key} – {m.title}</option>)}</select></label>
        </div>
        {radio ? <>
          <label><span style={label}>The officer's call sign</span><input aria-label="Call sign" style={inputStyle} value={D.you} onChange={e => setD("you", e.target.value)} /></label>
          <SceneEditor scene={D.scene} onChange={v => setD("scene", v)} />
          {T("dispatch", "Dispatch (read aloud at the start)", 2)}{T("arrival", "What the officer sees on arrival", 4)}{T("setting", "Hidden facts (what the simulated units and the grader know)", 4)}
          <div><span style={label}>Units and arrival times (seconds after the start; 0 = already on scene)</span>{rows("units", [{ k: "name", l: "Unit" }, { k: "eta", l: "Arrives (s)", num: true, w: "120px" }], { name: "", eta: 120 })}</div>
          <div><span style={label}>Timeline injects (From "Scene" = something the officer sees; mark Mayday/safety cues and what a good officer does)</span>
            {rows("injects", [{ k: "t", l: "At (s)", num: true, w: "80px" }, { k: "from", l: "From", w: "140px" }, { k: "text", l: "Text" }, { k: "cue", l: "Cue", type: "check", w: "60px" }, { k: "expect", l: "Expected action" }], { t: 60, from: "Scene", text: "", cue: false, expect: "" })}</div>
        </> : <>
          {T("situation", "Situation (the officer reads this)", 3)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label><span style={label}>Member's name</span><input aria-label="Persona name" style={inputStyle} value={D.persona.name} onChange={e => setD("persona", { ...D.persona, name: e.target.value })} /></label>
            <label><span style={label}>Role</span><input aria-label="Persona role" style={inputStyle} value={D.persona.role} onChange={e => setD("persona", { ...D.persona, role: e.target.value })} /></label>
          </div>
          {T("opening", "Their first words", 2, "persona")}{T("background", "Hidden background and how they react", 4, "persona")}
          <label><span style={label}>Starting mood</span><input aria-label="Mood" style={inputStyle} value={D.persona.mood} onChange={e => setD("persona", { ...D.persona, mood: e.target.value })} /></label>
          {T("goal", "What a good outcome looks like (for the grader)", 3)}
        </>}
        {!s.programKey && <div><span style={label}>Rubric (leave empty for the standard {radio ? "Blue Card command" : "leadership conversation"} rubric)</span>{rows("rubric", [{ k: "label", l: "Element" }, { k: "mult", l: "×", num: true, w: "70px" }], { label: "", mult: 1 })}</div>}
        <label style={{ fontSize: 13.5 }}><input type="checkbox" checked={s.active} onChange={e => setS({ ...s, active: e.target.checked })} /> Available to run</label>
        <Err>{error}</Err>
        <div style={{ display: "flex", gap: 8 }}><button style={btn("primary")} disabled={!s.title.trim()} onClick={async () => { setError(""); try { await call("/scenarios", s); toast?.("Scenario saved."); onDone(); } catch (e) { setError(e.message); } }}>Save scenario</button><button style={btn("ghost")} onClick={onDone}>Cancel</button></div>
      </div>
    </div>
  );
}
