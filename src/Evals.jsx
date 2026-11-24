// Evaluations & Simulations: working test periods (Company Officer, Battalion Chief, Deputy Chief, ...), standalone
// evaluation forms at every rank, evaluator results with AI-drafted scores, submissions, reviews, final recommendation.
// Voice simulations live in EvalSim.jsx. Server: server/evals.js.
import React, { useEffect, useMemo, useState } from "react";
import { BRAND } from "./brand.js";
import { ClipboardCheck, Radio, History, Users, Plus, BookOpen, Settings, ChevronLeft, AlertTriangle, CheckCircle2, Lock, Unlock, Printer, Paperclip, Trash2, Sparkles, FileText, Pencil } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, SignaturePad, printDocument, escapeHtml } from "./App.jsx";
import { INK, INK_SOFT, LINE, PAPER, BRICK, SAGE, AMBER, BLUE, call, label, KIND_LABEL, pctColor, fmtDay, fmtWhen, fileB64, modulePct, isPassFail, scoreText, scaleText, tally } from "./evalsShared.js";
import { Simulator, SessionList, SessionView, ScenarioAdmin } from "./EvalSim.jsx";

const Verdict = ({ t }) => t.missing ? <Pill color={AMBER}>{t.missing} not scored{t.failed ? ` · ${t.failed} failed` : ""}</Pill>
  : t.failed ? <Pill color={BRICK}>Not passed · {t.failed} failed</Pill> : <Pill color={SAGE}>Passed</Pill>;
const Pct = ({ v, min, pass, big }) => <span style={{ fontWeight: 800, color: pctColor(v, min, pass), fontSize: big ? 22 : undefined }}>{v === null || v === undefined ? "—" : `${v}%`}</span>;
const Pill = ({ children, color = INK_SOFT }) => <span style={{ fontSize: 11.5, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>{children}</span>;
const Err = ({ children }) => children ? <div role="alert" style={{ color: BRICK, fontSize: 13, marginTop: 8 }}>{children}</div> : null;
const H = ({ children, right }) => <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 8px" }}><div style={{ fontSize: 16, fontWeight: 800, color: INK, flex: 1 }}>{children}</div>{right}</div>;

function usePeople(enabled = true) {
  const [people, setPeople] = useState([]);
  useEffect(() => { if (enabled) call("/people").then(r => setPeople(r.people)).catch(() => {}); }, [enabled]);
  return people;
}
function PeoplePicker({ people, value, onChange, aria = "Evaluators" }) {
  const [q, setQ] = useState("");
  const chosen = people.filter(p => value.includes(p.id));
  const opts = q ? people.filter(p => !value.includes(p.id) && p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {chosen.map(p => <span key={p.id} style={{ background: "#E8EEF6", borderRadius: 12, padding: "2px 8px", fontSize: 12.5 }}>{p.name} <button aria-label={`Remove ${p.name}`} style={{ border: 0, background: "none", cursor: "pointer", color: BRICK }} onClick={() => onChange(value.filter(v => v !== p.id))}>×</button></span>)}
        {!chosen.length && <span style={{ fontSize: 12.5, color: INK_SOFT }}>Nobody yet</span>}
      </div>
      <input aria-label={`Add to ${aria}`} style={inputStyle} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name to add…" />
      {opts.length > 0 && <div style={{ border: `1px solid ${LINE}`, borderRadius: 6, marginTop: 2, background: "#fff" }}>
        {opts.map(p => <button key={p.id} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "none", padding: "5px 8px", cursor: "pointer" }} onClick={() => { onChange([...value, p.id]); setQ(""); }}>{p.name} <span style={{ color: INK_SOFT, fontSize: 12 }}>{p.title || p.division}</span></button>)}
      </div>}
    </div>
  );
}

// ---- Rubric / guide viewer ----------------------------------------------------------------------------
function ModuleGuide({ program, mod, onClose }) {
  const sc = program.scale || program.data?.scale || { min: 0, max: 5 };
  return (
    <div role="dialog" aria-label={`Module ${mod.key} guide`} style={{ position: "fixed", inset: 0, background: "rgba(10,20,40,.45)", zIndex: 60, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "4vh 12px", overflow: "auto" }} onClick={onClose}>
      <div style={{ ...cardStyle, maxWidth: 820, width: "100%" }} onClick={e => e.stopPropagation()}>
        <H right={<button style={btn("ghost")} onClick={onClose}>Close</button>}>{mod.key} – {mod.title}</H>
        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>{[mod.weight != null && `Weight ${mod.weight}%`, mod.quarter && `Quarter ${mod.quarter}`, mod.competency, `Scored ${scaleText(sc)} per element`].filter(Boolean).join(" · ")}</div>
        {mod.note && <div style={{ fontSize: 13, background: "#FFF6E5", padding: 8, borderRadius: 6, marginBottom: 8 }}>{mod.note}</div>}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, marginBottom: 12 }}>
          <thead><tr><th style={{ textAlign: "left", borderBottom: `2px solid ${INK}` }}>Performance element</th><th style={{ borderBottom: `2px solid ${INK}`, width: 70 }}>Weight</th></tr></thead>
          <tbody>{mod.elements.map((e, i) => <tr key={i}><td style={{ padding: "4px 0", borderBottom: `1px solid ${LINE}` }}>{e.label}</td><td style={{ textAlign: "center", borderBottom: `1px solid ${LINE}` }}>×{e.mult}</td></tr>)}</tbody>
        </table>
        {mod.guide && <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5, maxHeight: "55vh", overflow: "auto", background: PAPER, padding: 12, borderRadius: 6 }}>{mod.guide}</div>}
      </div>
    </div>
  );
}

function StandingTable({ program, standing, onGuide }) {
  const pass = standing.passComposite, min = standing.passModule || 70;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead><tr style={{ textAlign: "left", color: INK_SOFT }}><th>Module</th><th>Weight</th><th>Quarter</th><th>Score</th><th>Based on</th></tr></thead>
        <tbody>{standing.modules.map(m => {
          const mod = (program.data?.modules || program.modules || []).find(x => x.key === m.key);
          return (
            <tr key={m.key} style={{ borderTop: `1px solid ${LINE}` }}>
              <td style={{ padding: "5px 0" }}>{onGuide && mod?.elements ? <button style={{ border: 0, background: "none", color: BLUE, cursor: "pointer", padding: 0, textAlign: "left", fontSize: 13.5 }} onClick={() => onGuide(mod)}>{m.key} – {m.title}</button> : `${m.key} – ${m.title}`}</td>
              <td>{m.weight != null ? `${m.weight}%` : ""}</td><td>{m.quarter ? `Q${m.quarter}` : ""}</td>
              <td>{isPassFail(program.scale || program.data?.scale) && m.pct !== null ? <Pill color={m.pct >= 100 ? SAGE : BRICK}>{m.pct >= 100 ? "Passed" : "Not passed"}</Pill> : <Pct v={m.pct} min={min} pass={pass} />}{m.below && !isPassFail(program.scale || program.data?.scale) && <span style={{ color: BRICK, fontSize: 12 }}> below {standing.passModule}%</span>}</td>
              <td style={{ fontSize: 12.5, color: m.overdue ? BRICK : INK_SOFT }}>{m.pct !== null ? m.source : m.overdue ? "not evaluated yet (due)" : "not evaluated yet"}</td>
            </tr>);
        })}</tbody>
      </table>
      {isPassFail(program.scale || program.data?.scale) ? <div style={{ marginTop: 8, fontSize: 14 }}>
        Skills passed: <b>{standing.modules.filter(m => m.pct !== null && m.pct >= 100).length} of {standing.modules.length}</b>
        <span style={{ color: INK_SOFT, fontSize: 12.5 }}> (every critical criterion must pass; the latest signed attempt counts)</span>
        {standing.complete && <span style={{ marginLeft: 8 }}><Pill color={standing.passing ? SAGE : BRICK}>{standing.passing ? "All skills passed" : "Not every skill passed"}</Pill></span>}</div>
      : <div style={{ marginTop: 8, fontSize: 14 }}>Composite: <Pct v={standing.composite} min={min} pass={pass} /> <span style={{ color: INK_SOFT, fontSize: 12.5 }}>
        (pass: {pass}% composite{standing.passModule ? `, no module under ${standing.passModule}%` : ""}{standing.complete ? "" : "; not every module is scored yet"})</span>
        {standing.complete && <span style={{ marginLeft: 8 }}><Pill color={standing.passing ? SAGE : BRICK}>{standing.passing ? "Meets the passing standard" : "Below the passing standard"}</Pill></span>}</div>}
    </div>
  );
}

// ---- Result editor (evaluator) and viewer -------------------------------------------------------------
function ScoreButtons({ value, scale, onChange, label: aria, disabled }) {
  const vals = []; for (let v = Number(scale.min); v <= Number(scale.max); v++) vals.push(v);
  const pf = isPassFail(scale);
  if (pf) vals.reverse();
  const on = v => pf ? (v === Number(scale.max) ? SAGE : BRICK) : INK;
  return <div role="radiogroup" aria-label={aria} style={{ display: "flex", gap: 3 }}>
    {vals.map(v => <button key={v} type="button" role="radio" aria-checked={value === v} aria-label={`${aria}: ${scoreText(scale, v)}`} disabled={disabled} onClick={() => onChange(value === v ? null : v)}
      style={{ minWidth: pf ? 56 : 30, padding: pf ? "0 10px" : 0, height: 28, borderRadius: 5, border: `1px solid ${value === v ? on(v) : LINE}`, background: value === v ? on(v) : "#fff", color: value === v ? "#fff" : INK, fontWeight: 700, cursor: disabled ? "default" : "pointer" }}>{scoreText(scale, v)}</button>)}
  </div>;
}

export function ResultEditor({ id, preset, onDone, onBack, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [sig, setSig] = useState(null), [guide, setGuide] = useState(null);
  const [programs, setPrograms] = useState([]), [r, setR] = useState(null), [ackNote, setAckNote] = useState("");
  const people = usePeople(!id);
  useEffect(() => {
    if (id) call(`/results/${id}`).then(x => { setD(x); setR(x.result); }).catch(e => setError(e.message));
    else call("").then(x => {
      setPrograms(x.programs.filter(p => p.active));
      const p0 = preset?.programId ? x.programs.find(p => p.id === preset.programId) : null;
      setR({ programId: p0?.id || "", userId: preset?.userId || "", candidateId: preset?.candidateId || null, kind: preset?.kind || "formal", modules: preset?.modules || (p0 && p0.kind === "form" ? p0.modules.map(m => m.key) : []),
        scores: {}, comments: {}, observations: "", feedback: "", flags: [], date: new Date().toLocaleDateString("en-CA"), status: "draft" });
    }).catch(e => setError(e.message));
  }, [id]);
  const [program, setProgram] = useState(null);
  useEffect(() => { const pid = d?.program?.id || r?.programId; if (!pid) { setProgram(null); return; } if (d?.program?.id === pid) { setProgram(d.program); return; }
    call(`/programs/${pid}`).then(x => setProgram(x.program)).catch(e => setError(e.message)); }, [r?.programId, d?.program?.id]);
  if (error && !r) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!r) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const editable = !id || d?.canEdit;
  const scale = program?.data?.scale || { min: 0, max: 5 };
  const mods = program?.data?.modules || [];
  const set = (k, v) => setR(x => ({ ...x, [k]: v }));
  const setScore = (mk, i, v) => setR(x => { const s = [...(x.scores[mk] || mods.find(m => m.key === mk).elements.map(() => null))]; s[i] = v; return { ...x, scores: { ...x.scores, [mk]: s } }; });
  const toggleMod = k => set("modules", r.modules.includes(k) ? r.modules.filter(x => x !== k) : [...r.modules, k]);
  let total = 0, w = 0;
  for (const k of r.modules) { const m = mods.find(x => x.key === k); if (!m) continue; const p = modulePct(m, r.scores[k], scale).pct; if (p !== null) { const ww = Number(m.weight) > 0 ? Number(m.weight) : 1; total += p * ww; w += ww; } }
  const pct = w ? Math.round((total / w) * 10) / 10 : null;
  async function aiDraft() {
    setBusy("ai"); setError("");
    try {
      const x = await call("/ai/draft", { programId: r.programId, modules: r.modules, observations: r.observations, userId: r.userId, candidateId: r.candidateId });
      setR(cur => {
        const scores = { ...cur.scores }, comments = { ...cur.comments };
        for (const [k, v] of Object.entries(x.draft.modules)) { scores[k] = v.scores.map((s, i) => cur.scores[k]?.[i] ?? s.score); if (!cur.comments[k]) comments[k] = v.comment; }
        return { ...cur, scores, comments, feedback: cur.feedback || x.draft.feedback, flags: [...cur.flags, ...x.draft.flags.map(t => ({ text: t, done: false }))], ai: x.draft };
      });
      toast?.("Draft scores filled in. Check each one; scores you had already set were kept.");
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  async function save(final) {
    setBusy(final ? "sign" : "save"); setError("");
    try {
      const out = await call("/results", { ...r, id: id || r.id, final, signature: sig });
      if (final) { toast?.(r.kind === "practice" ? "Saved." : "Signed. The person was notified."); onDone?.(out.id); }
      else { setR(x => ({ ...x, id: out.id })); toast?.("Draft saved."); if (!id) onDone?.(out.id, true); }
    } catch (e) { setError(e.message); }
    setBusy("");
  }
  const why = (k, i) => (r.ai?.modules?.[k]?.scores?.[i]?.why) || (r.ai?.grade?.scores?.[i]?.why) || "";
  const final = r.status === "final";
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 980 }}>
      <div><button style={btn("ghost")} onClick={onBack}><ChevronLeft size={14} /> Back</button></div>
      <div style={cardStyle}>
        <H right={final ? <Pill color={SAGE}>Signed {fmtDay(r.signedAt)}</Pill> : <Pill color={AMBER}>Draft</Pill>}>{id ? `${KIND_LABEL[r.kind]}: ${r.name}` : "New evaluation"}</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label><span style={label}>Program</span>{id || preset?.programId ? <div style={{ fontWeight: 700 }}>{program?.name}</div> :
            <select aria-label="Program" style={inputStyle} value={r.programId} onChange={e => { const p = programs.find(x => x.id === e.target.value); setR(x => ({ ...x, programId: e.target.value, modules: p?.kind === "form" ? p.modules.map(m => m.key) : [], scores: {}, comments: {} })); }}>
              <option value="">Pick…</option>{programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</label>
          <label><span style={label}>Person evaluated</span>{id || preset?.userId ? <div style={{ fontWeight: 700 }}>{r.name || preset?.name}</div> :
            <select aria-label="Person evaluated" style={inputStyle} value={r.userId} onChange={e => set("userId", e.target.value)}><option value="">Pick…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</label>
          <label><span style={label}>Kind</span><select aria-label="Kind" style={inputStyle} disabled={!editable} value={r.kind} onChange={e => set("kind", e.target.value)}>
            <option value="formal">Formal evaluation (on the record)</option><option value="retest">Retest (replaces earlier scores for these modules)</option><option value="practice">Practice (not on the record)</option></select></label>
          <label><span style={label}>Date</span><input type="date" aria-label="Date" style={inputStyle} disabled={!editable} value={r.date} onChange={e => set("date", e.target.value)} /></label>
        </div>
        {program && editable && <div style={{ marginTop: 10 }}><span style={label}>Modules in this evaluation</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{mods.map(m => <label key={m.key} style={{ fontSize: 13, border: `1px solid ${r.modules.includes(m.key) ? INK : LINE}`, borderRadius: 14, padding: "2px 9px", cursor: "pointer" }}>
            <input type="checkbox" aria-label={`Module ${m.key}`} checked={r.modules.includes(m.key)} onChange={() => toggleMod(m.key)} /> {m.key} – {m.title}</label>)}</div></div>}
      </div>

      <div style={cardStyle}>
        <H>What the evaluator observed</H>
        <textarea aria-label="Observations" rows={6} style={inputStyle} disabled={!editable} value={r.observations} onChange={e => set("observations", e.target.value)}
          placeholder="Write what you saw and heard: the radio report, decisions and timing, documents turned in, how the person handled it. Facts, not impressions." />
        {editable && <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button style={btn("outline")} disabled={busy || !r.programId || !r.modules.length || r.observations.trim().length < 20} onClick={aiDraft}><Sparkles size={14} /> {busy === "ai" ? "Drafting…" : "Draft scores with AI"}</button>
          <span style={{ fontSize: 12.5, color: INK_SOFT }}>The assistant applies this program's rubric to your notes{r.candidateId ? " and the candidate's written submissions" : ""}, drafts scores and feedback, and flags what needs checking. You review and sign.</span>
        </div>}
      </div>

      {r.modules.map(k => {
        const m = mods.find(x => x.key === k); if (!m) return null;
        const mp = modulePct(m, r.scores[k], scale);
        return (
          <div key={k} style={cardStyle}>
            <H right={<><button style={btn("ghost")} onClick={() => setGuide(m)}><BookOpen size={14} /> Guide</button><Pct v={mp.pct} /></>}>{m.key} – {m.title}</H>
            {m.elements.map((e, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(200px, 1fr) auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
                <div><div style={{ fontSize: 13.5 }}>{e.label} {e.mult !== 1 && <span style={{ color: INK_SOFT, fontSize: 12 }}>×{e.mult}</span>}</div>
                  {why(k, i) && <div style={{ fontSize: 12, color: BLUE, marginTop: 2 }}><Sparkles size={11} /> {why(k, i)}</div>}</div>
                <ScoreButtons label={`${k} ${e.label}`} value={r.scores[k]?.[i] ?? null} scale={scale} disabled={!editable} onChange={v => setScore(k, i, v)} />
              </div>))}
            <label style={{ display: "block", marginTop: 8 }}><span style={label}>Comments for {k}</span>
              <textarea aria-label={`Comments for ${k}`} rows={2} style={inputStyle} disabled={!editable} value={r.comments[k] || ""} onChange={e => set("comments", { ...r.comments, [k]: e.target.value })} /></label>
          </div>);
      })}

      <div style={cardStyle}>
        <H right={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>{isPassFail(scale) && <Verdict t={tally(mods, r, scale)} />}Overall: <Pct v={pct} big /></span>}>Feedback and sign-off</H>
        <textarea aria-label="Feedback" rows={4} style={inputStyle} disabled={!editable} value={r.feedback} onChange={e => set("feedback", e.target.value)} placeholder="Feedback to the person: what went well, what to work on." />
        {(r.flags || []).length > 0 && <div style={{ marginTop: 10 }}><span style={label}>Check before signing</span>
          {r.flags.map((f, i) => <label key={i} style={{ display: "flex", gap: 6, fontSize: 13.5, alignItems: "flex-start", padding: "3px 0" }}>
            <input type="checkbox" aria-label={`Verified: ${f.text}`} disabled={!editable} checked={f.done} onChange={e => set("flags", r.flags.map((g, j) => j === i ? { ...g, done: e.target.checked } : g))} />
            <span style={{ flex: 1, color: f.done ? INK_SOFT : AMBER }}><AlertTriangle size={12} /> {f.text}</span>
            {editable && <button aria-label="Remove flag" style={{ border: 0, background: "none", color: BRICK, cursor: "pointer" }} onClick={() => set("flags", r.flags.filter((_, j) => j !== i))}>×</button>}</label>)}</div>}
        {editable && <>
          {r.kind !== "practice" && <div style={{ marginTop: 12, maxWidth: 420 }}><SignaturePad label="Evaluator signature" onChange={setSig} /></div>}
          <Err>{error}</Err>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={btn("outline")} disabled={!!busy || !r.programId || !r.userId || !r.modules.length} onClick={() => save(false)}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            <button style={btn("primary")} disabled={!!busy || !r.programId || !r.userId || !r.modules.length || (r.kind !== "practice" && !sig)} onClick={() => save(true)}><Lock size={14} /> {r.kind === "practice" ? "Finish practice" : "Sign and make official"}</button>
            {id && <button style={btn("ghost")} onClick={async () => { if (!window.confirm("Delete this draft?")) return; try { await call(`/results/${id}/remove`, {}); onBack(); } catch (e) { setError(e.message); } }}><Trash2 size={14} /> Delete draft</button>}
          </div></>}
        {final && <div style={{ marginTop: 10, fontSize: 13.5 }}>
          Signed by <b>{r.evaluator}</b> on {fmtWhen(r.signedAt)}{r.signature && <div><img alt="Evaluator signature" src={r.signature} style={{ maxHeight: 60 }} /></div>}
          {r.ackAt && <div style={{ color: SAGE }}>Seen by {r.name} {fmtWhen(r.ackAt)}{r.ackComment ? `: "${r.ackComment}"` : ""}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button style={btn("outline")} onClick={() => printResult(program, r)}><Printer size={14} /> Print</button>
            {d?.canReopen && <button style={btn("ghost")} onClick={async () => { if (!window.confirm("Reopen this signed evaluation? The signature is removed and it goes back to draft.")) return; try { await call(`/results/${id}/reopen`, {}); const x = await call(`/results/${id}`); setD(x); setR(x.result); } catch (e) { setError(e.message); } }}><Unlock size={14} /> Reopen</button>}
          </div>
        </div>}
        {final && d?.mine && !r.ackAt && <AckBox id={id} onDone={async () => { const x = await call(`/results/${id}`); setD(x); setR(x.result); }} note={ackNote} setNote={setAckNote} />}
      </div>
      {guide && program && <ModuleGuide program={program} mod={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
function AckBox({ id, onDone, note, setNote }) {
  return (
    <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
      <span style={label}>Mark as seen (optional comment to the evaluator)</span>
      <textarea aria-label="Your comment" rows={2} style={inputStyle} value={note} onChange={e => setNote(e.target.value)} />
      <button style={{ ...btn("primary"), marginTop: 6 }} onClick={async () => { await call(`/results/${id}/ack`, { comment: note }); onDone(); }}><CheckCircle2 size={14} /> I've read this</button>
    </div>
  );
}
function printResult(program, r) {
  const scale = program?.data?.scale || { min: 0, max: 5 };
  const mods = (program?.data?.modules || []).filter(m => r.modules.includes(m.key));
  const body = `<h1>${escapeHtml(program?.name || "Evaluation")}</h1>
    <p class="meta"><b>${escapeHtml(r.name)}</b> · ${escapeHtml(KIND_LABEL[r.kind])} · ${escapeHtml(fmtDay(r.date))} · Evaluator: ${escapeHtml(r.evaluator)}</p>
    <p class="meta">Overall: <b>${r.pct ?? "—"}%</b> (scored ${escapeHtml(scaleText(scale))} per element)${isPassFail(scale) ? ` · ${(t => t.failed ? `${t.failed} criteria failed` : t.missing ? `${t.missing} not scored` : "all criteria passed")(tally(mods, r, scale))}` : ""}</p>
    ${mods.map(m => { const mp = modulePct(m, r.scores[m.key], scale); return `<h2>${escapeHtml(m.key)} – ${escapeHtml(m.title)}: ${mp.pct ?? "—"}%</h2>
      <table><tr><th>Performance element</th><th>Weight</th><th>Score</th></tr>${m.elements.map((e, i) => `<tr><td>${escapeHtml(e.label)}</td><td>×${e.mult}</td><td>${escapeHtml(scoreText(scale, r.scores[m.key]?.[i]))}</td></tr>`).join("")}</table>
      ${r.comments[m.key] ? `<p>${escapeHtml(r.comments[m.key]).replace(/\n/g, "<br>")}</p>` : ""}`; }).join("")}
    <h2>Observations</h2><p>${escapeHtml(r.observations).replace(/\n/g, "<br>")}</p>
    <h2>Feedback</h2><p>${escapeHtml(r.feedback).replace(/\n/g, "<br>")}</p>
    <h2>Signatures</h2><p>Evaluator: ${escapeHtml(r.evaluator)} ${r.signature ? `<br><img src="${r.signature}" style="max-height:60px">` : ""}<br>Signed ${escapeHtml(fmtWhen(r.signedAt))}</p>
    ${r.ackAt ? `<p>Seen by ${escapeHtml(r.name)} ${escapeHtml(fmtWhen(r.ackAt))}${r.ackComment ? `: "${escapeHtml(r.ackComment)}"` : ""}</p>` : ""}`;
  printDocument(`${program?.name} – ${r.name}`, body);
}

// ---- Working test period: one candidate ------------------------------------------------------------------
function CandidateView({ id, onBack, onOpenResult, onNewResult, onRunSim, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [guide, setGuide] = useState(null), [edit, setEdit] = useState(false);
  const load = () => call(`/candidates/${id}`).then(setD).catch(e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const { candidate: c, program: p, standing: st } = d;
  const months = p.data?.reviews || [];
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1040 }}>
      <div><button style={btn("ghost")} onClick={onBack}><ChevronLeft size={14} /> Back</button></div>
      <div style={cardStyle}>
        <H right={<Pill color={c.status === "active" ? BLUE : c.status === "completed" ? SAGE : AMBER}>{c.status}</Pill>}>{c.name}: {p.name}</H>
        <div style={{ fontSize: 13.5, color: INK_SOFT }}>{fmtDay(c.startDate)} – {fmtDay(c.endDate)} · month {Math.min(st.monthIn + 1, p.data?.months || 12)} of {p.data?.months || 12}</div>
        {d.canManage && <div style={{ marginTop: 6 }}><button style={btn("ghost")} onClick={() => setEdit(!edit)}><Pencil size={13} /> Dates, status, evaluators</button></div>}
        {edit && <EnrolForm existing={c} programs={[p]} onSaved={() => { setEdit(false); load(); }} onCancel={() => setEdit(false)} />}
        <div style={{ marginTop: 10 }}><StandingTable program={p} standing={st} onGuide={setGuide} /></div>
      </div>

      <div style={cardStyle}>
        <H right={d.canEvaluate && <div style={{ display: "flex", gap: 6 }}>
          <button style={btn("outline")} onClick={() => onRunSim({ candidateId: c.id, programKey: p.key })}><Radio size={14} /> Evaluated simulation</button>
          <button style={btn("primary")} onClick={() => onNewResult({ programId: p.id, userId: c.userId, name: c.name, candidateId: c.id })}><Plus size={14} /> New evaluation</button></div>}>Evaluations</H>
        {d.results.length === 0 && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No evaluations yet.</div>}
        {d.results.map(r => <ResultRow key={r.id} r={r} program={p} onOpen={() => onOpenResult(r.id)} />)}
      </div>

      <Submissions d={d} reload={load} toast={toast} />
      <div style={cardStyle}>
        <H>Reviews</H>
        {months.map(m => <ReviewCard key={m} month={m} d={d} reload={load} toast={toast} />)}
      </div>
      <FinalCard d={d} reload={load} toast={toast} />
      {guide && <ModuleGuide program={p} mod={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}
function ResultRow({ r, program, onOpen }) {
  return (
    <div role="button" tabIndex={0} aria-label={`Open evaluation ${r.modules.join(", ")} ${fmtDay(r.date)}`} onClick={onOpen} onKeyDown={e => e.key === "Enter" && onOpen()}
      style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${LINE}`, cursor: "pointer", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{r.modules.map(k => `${k}${program ? ` – ${(program.data?.modules || program.modules || []).find(m => m.key === k)?.title || ""}` : ""}`).join("; ")}</div>
        <div style={{ fontSize: 12.5, color: INK_SOFT }}>{fmtDay(r.date)} · {KIND_LABEL[r.kind]} · {r.evaluator || "—"}{r.sessionId ? " · from a voice simulation" : ""}</div>
      </div>
      {r.status === "draft" ? <Pill color={AMBER}>Draft</Pill> : <Pill color={SAGE}>Signed</Pill>}
      {r.passFail ? <Verdict t={r.passFail} /> : <Pct v={r.pct} />}
    </div>
  );
}
function Submissions({ d, reload, toast }) {
  const [f, setF] = useState({ moduleKey: "", title: "", body: "" }), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [open, setOpen] = useState(false);
  const mods = d.program.data?.modules || [];
  async function add() {
    setBusy(true); setError("");
    try {
      await call(`/candidates/${d.candidate.id}/submissions`, { ...f, ...(file ? { fileName: file.name, mime: file.type, data: await fileB64(file) } : {}) });
      setF({ moduleKey: "", title: "", body: "" }); setFile(null); setOpen(false); toast?.("Submission added."); reload();
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div style={cardStyle}>
      <H right={(d.self || d.canEvaluate) && <button style={btn("outline")} onClick={() => setOpen(!open)}><Plus size={14} /> Add a submission</button>}>Written deliverables</H>
      {open && <div style={{ background: PAPER, padding: 10, borderRadius: 6, marginBottom: 8, display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 2fr", gap: 8 }}>
          <select aria-label="Submission module" style={inputStyle} value={f.moduleKey} onChange={e => setF({ ...f, moduleKey: e.target.value })}><option value="">Module…</option>{mods.map(m => <option key={m.key} value={m.key}>{m.key} – {m.title}</option>)}</select>
          <input aria-label="Submission title" style={inputStyle} placeholder="Title (e.g. NERIS narrative, budget memo)" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        </div>
        <textarea aria-label="Submission text" rows={6} style={inputStyle} placeholder="Paste or write the deliverable here (the AI draft reads this text), and/or attach the file." value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
        <input aria-label="Submission file" type="file" onChange={e => setFile(e.target.files[0] || null)} />
        <Err>{error}</Err>
        <div><button style={btn("primary")} disabled={busy || !f.moduleKey || (!f.body.trim() && !file)} onClick={add}>Turn it in</button></div>
      </div>}
      {d.submissions.length === 0 && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>Nothing turned in yet.</div>}
      {d.submissions.map(s => (
        <details key={s.id} style={{ borderTop: `1px solid ${LINE}`, padding: "6px 0" }}>
          <summary style={{ cursor: "pointer", fontSize: 14 }}><b>{s.moduleKey}</b> · {s.title} <span style={{ color: INK_SOFT, fontSize: 12.5 }}>— {s.by}, {fmtWhen(s.at)}</span></summary>
          {s.body && <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, background: PAPER, padding: 8, borderRadius: 6, margin: "6px 0" }}>{s.body}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            {s.fileName && <a style={{ fontSize: 13 }} href={`/api/evals/submissions/${s.id}/file`}><Paperclip size={12} /> {s.fileName}</a>}
            {(d.self && s.byId === d.candidate.userId || d.canManage) && <button style={btn("ghost")} onClick={async () => { if (!window.confirm("Remove this submission?")) return; await call(`/submissions/${s.id}/remove`, {}); reload(); }}><Trash2 size={13} /> Remove</button>}
          </div>
        </details>))}
    </div>
  );
}
function ReviewCard({ month, d, reload, toast }) {
  const r = d.reviews.find(x => x.month === month);
  const [f, setF] = useState(r || { summary: "", achievements: "", deficiencies: "", goals: "", improvementPlan: false });
  const [open, setOpen] = useState(false), [sig, setSig] = useState(null), [error, setError] = useState(""), [comment, setComment] = useState("");
  useEffect(() => { if (r) setF(r); }, [r?.updatedAt]);
  const signed = r?.status === "signed";
  async function save(sign) {
    setError("");
    try { await call(`/candidates/${d.candidate.id}/reviews`, { month, ...f, sign, signature: sig }); toast?.(sign ? "Review signed. The candidate was asked to sign that they've seen it." : "Draft saved."); setOpen(false); reload(); }
    catch (e) { setError(e.message); }
  }
  const T = (k, l) => <label style={{ display: "block" }}><span style={label}>{l}</span><textarea aria-label={`${month}-month ${l}`} rows={3} style={inputStyle} disabled={signed} value={f[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div style={{ borderTop: `1px solid ${LINE}`, padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, flex: 1 }}>{month}-month review</div>
        {signed ? <Pill color={SAGE}>Signed by {r.evaluator}</Pill> : r ? <Pill color={AMBER}>Draft</Pill> : <Pill>Not started</Pill>}
        {signed && (r.ackAt ? <Pill color={SAGE}>Seen by candidate</Pill> : <Pill color={AMBER}>Waiting for the candidate</Pill>)}
        {(signed || (d.canEvaluate)) && <button style={btn("ghost")} onClick={() => setOpen(!open)}>{open ? "Close" : signed ? "Read" : r ? "Continue" : "Write"}</button>}
      </div>
      {open && <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {T("summary", "Summary of performance")}{T("achievements", "Notable achievements")}{T("deficiencies", "Deficiencies")}{T("goals", "Development goals for next quarter")}
        <label style={{ fontSize: 13.5 }}><input type="checkbox" disabled={signed} checked={!!f.improvementPlan} onChange={e => setF({ ...f, improvementPlan: e.target.checked })} /> A remediation / performance improvement plan is being issued</label>
        {signed ? <div style={{ fontSize: 13 }}>Signed {fmtWhen(r.signedAt)} by {r.evaluator}{r.evaluatorSignature && <div><img alt="Evaluator signature" src={r.evaluatorSignature} style={{ maxHeight: 50 }} /></div>}
          {r.ackAt && <div>Candidate signed {fmtWhen(r.ackAt)}{r.ackComment && `: "${r.ackComment}"`}{r.ackSignature && <div><img alt="Candidate signature" src={r.ackSignature} style={{ maxHeight: 50 }} /></div>}</div>}</div>
          : d.canEvaluate && <><div style={{ maxWidth: 420 }}><SignaturePad label="Evaluator signature" onChange={setSig} /></div>
            <div style={{ display: "flex", gap: 8 }}><button style={btn("outline")} onClick={() => save(false)}>Save draft</button><button style={btn("primary")} disabled={!sig} onClick={() => save(true)}>Sign review</button></div></>}
        {signed && d.self && !r.ackAt && <div style={{ background: PAPER, padding: 10, borderRadius: 6 }}>
          <span style={label}>Sign that you've seen this review (it doesn't mean you agree). Add a comment if you want.</span>
          <textarea aria-label="Comment on the review" rows={2} style={inputStyle} value={comment} onChange={e => setComment(e.target.value)} />
          <div style={{ maxWidth: 420, marginTop: 6 }}><SignaturePad label="Your signature" onChange={setSig} /></div>
          <button style={{ ...btn("primary"), marginTop: 6 }} disabled={!sig} onClick={async () => { try { await call(`/reviews/${r.id}/ack`, { signature: sig, comment }); toast?.("Thanks, signed."); reload(); } catch (e) { setError(e.message); } }}>Sign</button>
        </div>}
        <Err>{error}</Err>
      </div>}
    </div>
  );
}
function FinalCard({ d, reload, toast }) {
  const { candidate: c, program: p, standing: st } = d;
  const [f, setF] = useState({ outcome: c.outcome || "", note: c.outcomeNote || "" }), [sig, setSig] = useState(null), [error, setError] = useState("");
  const outcomes = p.data?.outcomes || [];
  return (
    <div style={cardStyle}>
      <H right={<button style={btn("outline")} onClick={() => printFinal(d)}><Printer size={14} /> Print final report</button>}>Final recommendation</H>
      {c.outcome ? <div style={{ fontSize: 14 }}><b>{c.outcome}</b> — signed by {c.outcomeBy} {fmtWhen(c.outcomeAt)}{c.outcomeNote && <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{c.outcomeNote}</div>}
        {c.outcomeSignature && <div><img alt="Final signature" src={c.outcomeSignature} style={{ maxHeight: 60 }} /></div>}</div>
        : <div style={{ fontSize: 13.5, color: INK_SOFT }}>Not signed yet. {st.complete ? (st.passing ? "Every module is scored and the candidate meets the passing standard." : "Every module is scored; the candidate is below the passing standard.") : "Some modules aren't scored yet."}</div>}
      {d.canManage && <div style={{ display: "grid", gap: 8, marginTop: 10, maxWidth: 640 }}>
        <select aria-label="Recommendation" style={inputStyle} value={f.outcome} onChange={e => setF({ ...f, outcome: e.target.value })}><option value="">(no recommendation)</option>{outcomes.map(o => <option key={o}>{o}</option>)}</select>
        <textarea aria-label="Recommendation notes" rows={3} style={inputStyle} placeholder="Written recommendation for Civil Service" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        {f.outcome && <div style={{ maxWidth: 420 }}><SignaturePad label="Signature" onChange={setSig} /></div>}
        <Err>{error}</Err>
        <div><button style={btn("primary")} disabled={f.outcome && !sig} onClick={async () => { try { await call(`/candidates/${c.id}/outcome`, { ...f, signature: sig }); toast?.(f.outcome ? "Final recommendation signed." : "Cleared."); reload(); } catch (e) { setError(e.message); } }}>{f.outcome ? "Sign recommendation" : "Save"}</button></div>
      </div>}
    </div>
  );
}
function printFinal(d) {
  const { candidate: c, program: p, standing: st } = d;
  const pf = isPassFail(p.scale || p.data?.scale);
  const modScore = m => pf ? (m.pct === null ? "—" : m.pct >= 100 ? "Passed" : "Not passed") : `${m.pct ?? "—"}${m.pct != null ? "%" : ""}`;
  const resScore = r => r.passFail ? (r.passFail.failed ? `${r.passFail.failed} failed` : "Passed") : `${r.pct}%`;
  const body = `<h1>${escapeHtml(p.name)}: Final Evaluation Report</h1>
    <p class="meta"><b>${escapeHtml(c.name)}</b> · Working test period ${escapeHtml(fmtDay(c.startDate))} – ${escapeHtml(fmtDay(c.endDate))}</p>
    <h2>Module scores</h2><table><tr><th>Module</th><th>Weight</th><th>Score</th><th>Based on</th></tr>
    ${st.modules.map(m => `<tr><td>${escapeHtml(m.key)} – ${escapeHtml(m.title)}</td><td>${m.weight ?? ""}${m.weight != null ? "%" : ""}</td><td>${modScore(m)}</td><td>${escapeHtml(m.source || "not evaluated")}</td></tr>`).join("")}
    ${pf ? `<tr class="total"><td>Skills passed</td><td></td><td>${st.modules.filter(m => m.pct !== null && m.pct >= 100).length} of ${st.modules.length}</td><td>Every critical criterion must pass</td></tr>`
      : `<tr class="total"><td>Composite</td><td></td><td>${st.composite ?? "—"}%</td><td>Pass: ${st.passComposite}%${st.passModule ? `, no module under ${st.passModule}%` : ""}</td></tr>`}</table>
    <h2>Evaluations</h2><table><tr><th>Date</th><th>Modules</th><th>Kind</th><th>Evaluator</th><th>Score</th></tr>
    ${d.results.filter(r => r.status === "final").map(r => `<tr><td>${escapeHtml(fmtDay(r.date))}</td><td>${escapeHtml(r.modules.join(", "))}</td><td>${escapeHtml(KIND_LABEL[r.kind])}</td><td>${escapeHtml(r.evaluator)}</td><td>${resScore(r)}</td></tr>`).join("")}</table>
    <h2>Reviews</h2>${d.reviews.filter(r => r.status === "signed").map(r => `<p><b>${r.month}-month review</b> (${escapeHtml(r.evaluator)}, ${escapeHtml(fmtDay(r.signedAt))})${r.improvementPlan ? " — improvement plan issued" : ""}<br>${escapeHtml(r.summary).replace(/\n/g, "<br>")}</p>`).join("") || "<p>None signed.</p>"}
    <h2>Final recommendation</h2><p><b>${escapeHtml(c.outcome || "Not signed yet")}</b>${c.outcomeBy ? ` — ${escapeHtml(c.outcomeBy)}, ${escapeHtml(fmtDay(c.outcomeAt))}` : ""}</p>
    ${c.outcomeNote ? `<p>${escapeHtml(c.outcomeNote).replace(/\n/g, "<br>")}</p>` : ""}${c.outcomeSignature ? `<img src="${c.outcomeSignature}" style="max-height:60px">` : ""}
    <h2>Signatures</h2><table>${(p.data?.signatures || []).map(s => `<tr><td style="width:40%">${escapeHtml(s)}</td><td>______________________________ Date: __________</td></tr>`).join("")}</table>`;
  printDocument(`${p.name} – ${c.name}`, body);
}

function EnrolForm({ existing, programs, onSaved, onCancel }) {
  const people = usePeople();
  const [f, setF] = useState(existing ? { ...existing } : { programId: programs[0]?.id || "", userId: "", startDate: new Date().toLocaleDateString("en-CA"), evaluators: [] });
  const [error, setError] = useState("");
  return (
    <div style={{ background: PAPER, padding: 12, borderRadius: 6, marginTop: 8, display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        {!existing && <label><span style={label}>Program</span><select aria-label="Enrol program" style={inputStyle} value={f.programId} onChange={e => setF({ ...f, programId: e.target.value })}>{programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {!existing && <label><span style={label}>Person</span><select aria-label="Enrol person" style={inputStyle} value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })}><option value="">Pick…</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label><span style={label}>Start (promotion / appointment date)</span><input type="date" aria-label="Start date" style={inputStyle} value={f.startDate} onChange={e => setF({ ...f, startDate: e.target.value })} /></label>
        {existing && <label><span style={label}>Ends</span><input type="date" aria-label="End date" style={inputStyle} value={f.endDate} onChange={e => setF({ ...f, endDate: e.target.value })} /></label>}
        {existing && <label><span style={label}>Status</span><select aria-label="Enrolment status" style={inputStyle} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{["active", "extended", "completed", "withdrawn"].map(s => <option key={s}>{s}</option>)}</select></label>}
      </div>
      <label><span style={label}>Assigned evaluators (they can score this candidate even without Evaluations access)</span><PeoplePicker people={people} value={f.evaluators} onChange={v => setF({ ...f, evaluators: v })} /></label>
      <Err>{error}</Err>
      <div style={{ display: "flex", gap: 8 }}><button style={btn("primary")} onClick={async () => { try { const r = await call("/candidates", f); onSaved(r.id); } catch (e) { setError(e.message); } }}>{existing ? "Save" : "Start working test period"}</button><button style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function CandidateList({ d, onOpen, reload }) {
  const [adding, setAdding] = useState(false), [show, setShow] = useState("open");
  const wtp = d.programs.filter(p => p.kind === "wtp" && p.active);
  const list = d.candidates.filter(c => show === "all" || ["active", "extended"].includes(c.status));
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, fontSize: 13, color: INK_SOFT }}>People in a 12-month working test period. Scores come from signed evaluations; retests replace earlier scores.</div>
        <select aria-label="Show" style={{ ...inputStyle, width: "auto" }} value={show} onChange={e => setShow(e.target.value)}><option value="open">Active and extended</option><option value="all">Everyone</option></select>
        {d.access.manage && <button style={btn("primary")} onClick={() => setAdding(!adding)}><Plus size={14} /> Start a working test period</button>}
      </div>
      {adding && <div style={cardStyle}><EnrolForm programs={wtp} onCancel={() => setAdding(false)} onSaved={id => { setAdding(false); reload(); onOpen(id); }} /></div>}
      {list.length === 0 && <div style={{ ...cardStyle, color: INK_SOFT }}>Nobody yet.</div>}
      {list.map(c => {
        const p = d.programs.find(x => x.id === c.programId);
        const st = c.standing;
        return (
          <div key={c.id} role="button" tabIndex={0} aria-label={`Open ${c.name} ${p?.name}`} onClick={() => onOpen(c.id)} onKeyDown={e => e.key === "Enter" && onOpen(c.id)}
            style={{ ...cardStyle, cursor: "pointer", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
            <ClipboardCheck size={24} color={BLUE} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{c.name}</div>
              <div style={{ fontSize: 13, color: INK_SOFT }}>{p?.name} · started {fmtDay(c.startDate)} · month {Math.min((st?.monthIn || 0) + 1, 12)}{c.outcome ? ` · ${c.outcome}` : ""}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13 }}>
              {isPassFail(p?.scale) ? <div>Skills passed <b>{st?.modules.filter(m => m.pct !== null && m.pct >= 100).length || 0}/{st?.modules.length}</b></div>
                : <div>Composite <Pct v={st?.composite} pass={st?.passComposite} /></div>}
              <div style={{ color: INK_SOFT }}>{st?.modules.filter(m => m.pct !== null).length}/{st?.modules.length} modules scored</div>
              {st?.modules.some(m => m.overdue) && <div style={{ color: BRICK }}>{st.modules.filter(m => m.overdue).length} due</div>}
              {st?.belowMin?.length > 0 && <div style={{ color: BRICK }}>Below minimum: {st.belowMin.join(", ")}</div>}
            </div>
          </div>);
      })}
    </div>
  );
}

function ResultsList({ onOpen, onNew, d }) {
  const [rows, setRows] = useState(null), [q, setQ] = useState(""), [kind, setKind] = useState("");
  useEffect(() => { call("/results").then(x => setRows(x.results)).catch(() => setRows([])); }, []);
  if (!rows) return <div style={{ color: INK_SOFT }}>Loading…</div>;
  const list = rows.filter(r => (!kind || (kind === "draft" ? r.status === "draft" : r.kind === kind)) && (!q || `${r.name} ${r.evaluator}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input aria-label="Search evaluations" style={{ ...inputStyle, maxWidth: 260 }} placeholder="Search by name" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Filter" style={{ ...inputStyle, width: "auto" }} value={kind} onChange={e => setKind(e.target.value)}><option value="">Everything</option><option value="draft">Drafts</option><option value="formal">Formal</option><option value="retest">Retests</option><option value="practice">Practice</option></select>
        <div style={{ flex: 1 }} />
        {d.evaluatesAny && <button style={btn("primary")} onClick={onNew}><Plus size={14} /> Evaluate someone</button>}
      </div>
      <div style={cardStyle}>
        {list.length === 0 && <div style={{ color: INK_SOFT }}>Nothing here.</div>}
        {list.map(r => { const p = d.programs.find(x => x.id === r.programId); return (
          <div key={r.id} role="button" tabIndex={0} aria-label={`Open ${r.name} ${p?.name}`} onClick={() => onOpen(r.id)} onKeyDown={e => e.key === "Enter" && onOpen(r.id)}
            style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: `1px solid ${LINE}`, cursor: "pointer", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontWeight: 700 }}>{r.name} <span style={{ fontWeight: 400, color: INK_SOFT }}>· {p?.name}</span></div>
              <div style={{ fontSize: 12.5, color: INK_SOFT }}>{r.modules.join(", ")} · {fmtDay(r.date)} · {KIND_LABEL[r.kind]} · {r.evaluator}</div></div>
            {r.status === "draft" ? <Pill color={AMBER}>Draft</Pill> : <Pill color={SAGE}>Signed</Pill>}{r.passFail ? <Verdict t={r.passFail} /> : <Pct v={r.pct} />}
          </div>); })}
      </div>
    </div>
  );
}

// ---- Programs (manage) --------------------------------------------------------------------------------
function Programs({ d, reload, toast }) {
  const [editing, setEditing] = useState(null);
  if (editing) return <ProgramEditor id={editing === "new" ? null : editing} onDone={() => { setEditing(null); reload(); }} toast={toast} />;
  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 1000 }}>
      <div style={{ display: "flex", gap: 8 }}><div style={{ flex: 1, fontSize: 13, color: INK_SOFT }}>Evaluation programs by rank. Company Officer, Battalion Chief and Deputy Chief came from {BRAND.short}'s documents; add Firefighter, Driver/Operator, Assistant Chief and others here.</div>
        <button style={btn("primary")} onClick={() => setEditing("new")}><Plus size={14} /> New program</button></div>
      {d.programs.map(p => (
        <div key={p.id} style={{ ...cardStyle, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 800 }}>{p.name} {!p.active && <Pill>inactive</Pill>}</div>
            <div style={{ fontSize: 12.5, color: INK_SOFT }}>{p.rank} · {p.kind === "wtp" ? "Working test period" : "Evaluation form"} · {p.modules.length} modules · scored {scaleText(p.scale)}</div></div>
          <button style={btn("outline")} aria-label={`Edit ${p.name}`} onClick={() => setEditing(p.id)}><Pencil size={13} /> Edit</button>
        </div>))}
    </div>
  );
}
function ProgramEditor({ id, onDone, toast }) {
  const people = usePeople();
  const [p, setP] = useState(id ? null : { name: "", rank: "", kind: "form", description: "", active: true, evaluators: [], data: { scale: { min: 0, max: 5 }, passComposite: 80, passModule: 70, months: 12, reviews: [3, 6, 9, 12], outcomes: [], signatures: [], modules: [{ key: "A", title: "", weight: null, elements: [{ label: "", mult: 1 }], guide: "" }] } });
  const [error, setError] = useState(""), [open, setOpen] = useState(null);
  useEffect(() => { if (id) call(`/programs/${id}`).then(x => setP(x.program)).catch(e => setError(e.message)); }, [id]);
  if (!p) return <div style={{ color: INK_SOFT }}>{error || "Loading…"}</div>;
  const D = p.data;
  const setD = (k, v) => setP({ ...p, data: { ...D, [k]: v } });
  const setM = (i, m) => setD("modules", D.modules.map((x, j) => j === i ? m : x));
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000 }}>
      <div><button style={btn("ghost")} onClick={onDone}><ChevronLeft size={14} /> Programs</button></div>
      <div style={cardStyle}>
        <H>{id ? "Edit program" : "New program"}</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          <label style={{ gridColumn: "span 2" }}><span style={label}>Name</span><input aria-label="Program name" style={inputStyle} value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></label>
          <label><span style={label}>Rank / role</span><input aria-label="Rank" style={inputStyle} value={p.rank} onChange={e => setP({ ...p, rank: e.target.value })} placeholder="e.g. Driver/Operator" /></label>
          <label><span style={label}>Kind</span><select aria-label="Program kind" style={inputStyle} value={p.kind} onChange={e => setP({ ...p, kind: e.target.value })}><option value="form">Evaluation form (one-time or periodic)</option><option value="wtp">Working test period (months, reviews, final)</option></select></label>
          <label><span style={label}>Scoring</span><select aria-label="Scoring" style={inputStyle} value={isPassFail(D.scale) ? "pf" : "points"}
            onChange={e => setP({ ...p, data: e.target.value === "pf" ? { ...D, scale: { min: 0, max: 1, labels: ["Fail", "Pass"] }, passComposite: 100, passModule: 100, standing: "latest" } : { ...D, scale: { min: 0, max: 5 }, passComposite: 80, passModule: 70, standing: "average" } })}>
            <option value="points">Points per element</option><option value="pf">Pass / fail per element</option></select></label>
          {!isPassFail(D.scale) && <label><span style={label}>Scores from</span><input type="number" aria-label="Scale minimum" style={inputStyle} value={D.scale.min} onChange={e => setD("scale", { min: e.target.value, max: D.scale.max })} /></label>}
          {!isPassFail(D.scale) && <label><span style={label}>to</span><input type="number" aria-label="Scale maximum" style={inputStyle} value={D.scale.max} onChange={e => setD("scale", { min: D.scale.min, max: e.target.value })} /></label>}
          {p.kind === "wtp" && <label><span style={label}>Standing per module</span><select aria-label="Standing rule" style={inputStyle} value={D.standing === "latest" ? "latest" : "average"} onChange={e => setD("standing", e.target.value)}>
            <option value="average">Average of formals; a retest replaces them</option><option value="latest">Latest signed formal or retest</option></select></label>}
          <label><span style={label}>Pass: composite %</span><input type="number" aria-label="Passing composite" style={inputStyle} value={D.passComposite} onChange={e => setD("passComposite", e.target.value)} /></label>
          <label><span style={label}>No module under %</span><input type="number" aria-label="Module minimum" style={inputStyle} value={D.passModule} onChange={e => setD("passModule", e.target.value)} /></label>
          {p.kind === "wtp" && <label><span style={label}>Months</span><input type="number" aria-label="Months" style={inputStyle} value={D.months} onChange={e => setD("months", e.target.value)} /></label>}
          {p.kind === "wtp" && <label><span style={label}>Reviews at months</span><input aria-label="Review months" style={inputStyle} value={(D.reviews || []).join(", ")} onChange={e => setD("reviews", e.target.value.split(/[ ,]+/).filter(Boolean).map(Number))} /></label>}
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Description</span><textarea aria-label="Program description" rows={2} style={inputStyle} value={p.description} onChange={e => setP({ ...p, description: e.target.value })} /></label>
          {p.kind === "wtp" && <label style={{ gridColumn: "1 / -1" }}><span style={label}>Final recommendations (one per line)</span><textarea aria-label="Outcomes" rows={3} style={inputStyle} value={(D.outcomes || []).join("\n")} onChange={e => setD("outcomes", e.target.value.split("\n"))} /></label>}
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Signature lines (one per line)</span><textarea aria-label="Signature lines" rows={2} style={inputStyle} value={(D.signatures || []).join("\n")} onChange={e => setD("signatures", e.target.value.split("\n"))} /></label>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Authorized evaluators for this program (besides people with Evaluations edit access)</span><PeoplePicker people={people} value={p.evaluators || []} onChange={v => setP({ ...p, evaluators: v })} /></label>
          <label style={{ gridColumn: "1 / -1", fontSize: 13.5 }}><input type="checkbox" checked={p.active} onChange={e => setP({ ...p, active: e.target.checked })} /> Active</label>
        </div>
      </div>
      <div style={cardStyle}>
        <H right={<button style={btn("outline")} onClick={() => setD("modules", [...D.modules, { key: String.fromCharCode(65 + D.modules.length), title: "", weight: null, elements: [{ label: "", mult: 1 }], guide: "" }])}><Plus size={14} /> Module</button>}>Modules / competencies</H>
        {D.modules.map((m, i) => (
          <div key={i} style={{ borderTop: `1px solid ${LINE}`, padding: "8px 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 90px 90px auto", gap: 6, alignItems: "center" }}>
              <input aria-label={`Module ${i + 1} key`} style={inputStyle} value={m.key} onChange={e => setM(i, { ...m, key: e.target.value })} />
              <input aria-label={`Module ${i + 1} title`} style={inputStyle} value={m.title} placeholder="Title" onChange={e => setM(i, { ...m, title: e.target.value })} />
              <input aria-label={`Module ${i + 1} weight`} style={inputStyle} value={m.weight ?? ""} placeholder="Weight %" onChange={e => setM(i, { ...m, weight: e.target.value === "" ? null : e.target.value })} />
              <select aria-label={`Module ${i + 1} quarter`} style={inputStyle} value={m.quarter || ""} onChange={e => setM(i, { ...m, quarter: e.target.value ? Number(e.target.value) : null })}><option value="">Any time</option>{[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}</select>
              <div style={{ display: "flex", gap: 4 }}><button style={btn("ghost")} onClick={() => setOpen(open === i ? null : i)}>{open === i ? "Close" : "Elements & guide"}</button>
                <button aria-label={`Remove module ${m.key}`} style={btn("ghost")} onClick={() => setD("modules", D.modules.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>
            </div>
            {open === i && <div style={{ display: "grid", gap: 6, marginTop: 8, paddingLeft: 66 }}>
              {m.elements.map((e, j) => <div key={j} style={{ display: "grid", gridTemplateColumns: "1fr 80px auto", gap: 6 }}>
                <input aria-label={`Element ${j + 1}`} style={inputStyle} value={e.label} onChange={ev => setM(i, { ...m, elements: m.elements.map((x, k) => k === j ? { ...x, label: ev.target.value } : x) })} />
                <input aria-label={`Element ${j + 1} weight`} style={inputStyle} value={e.mult} onChange={ev => setM(i, { ...m, elements: m.elements.map((x, k) => k === j ? { ...x, mult: ev.target.value } : x) })} title="Multiplier (×)" />
                <button aria-label={`Remove element ${j + 1}`} style={btn("ghost")} onClick={() => setM(i, { ...m, elements: m.elements.filter((_, k) => k !== j) })}><Trash2 size={13} /></button></div>)}
              <div><button style={btn("ghost")} onClick={() => setM(i, { ...m, elements: [...m.elements, { label: "", mult: 1 }] })}><Plus size={13} /> Element</button></div>
              <label><span style={label}>Competency</span><input aria-label="Competency" style={inputStyle} value={m.competency || ""} onChange={e => setM(i, { ...m, competency: e.target.value })} /></label>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={!!m.sim} onChange={e => setM(i, { ...m, sim: e.target.checked })} /> Can be run as a voice simulation</label>
              <label><span style={label}>Guide (scenario, tasks, discussion prompts, expected behaviors, deliverables). The AI reads this when it drafts scores.</span>
                <textarea aria-label="Guide" rows={10} style={inputStyle} value={m.guide || ""} onChange={e => setM(i, { ...m, guide: e.target.value })} /></label>
            </div>}
          </div>))}
      </div>
      <Err>{error}</Err>
      <div style={{ display: "flex", gap: 8 }}><button style={btn("primary")} disabled={!p.name.trim()} onClick={async () => { setError(""); try { await call("/programs", p); toast?.("Program saved."); onDone(); } catch (e) { setError(e.message); } }}>Save program</button><button style={btn("ghost")} onClick={onDone}>Cancel</button></div>
    </div>
  );
}

// ---- My development (home) ------------------------------------------------------------------------------
function Home({ d, onOpenCand, onOpenResult, go }) {
  const progById = id => d.programs.find(p => p.id === id);
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000 }}>
      {(d.reviewsToAck.length > 0 || d.resultsToAck.length > 0) && <div style={{ ...cardStyle, borderLeft: `4px solid ${AMBER}` }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Needs your signature</div>
        {d.reviewsToAck.map(r => <div key={r.id}><button style={{ ...btn("ghost"), padding: "2px 0" }} onClick={() => onOpenCand(r.candidateId)}>{r.month}-month review: read and sign</button></div>)}
        {d.resultsToAck.map(id => <div key={id}><button style={{ ...btn("ghost"), padding: "2px 0" }} onClick={() => onOpenResult(id)}>A signed evaluation: read it</button></div>)}
      </div>}
      {d.mine.map(c => { const p = progById(c.programId); return (
        <div key={c.id} style={cardStyle}>
          <H right={<button style={btn("outline")} onClick={() => onOpenCand(c.id)}>Open</button>}>{p?.name}</H>
          <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>{fmtDay(c.startDate)} – {fmtDay(c.endDate)} · {c.status}{c.outcome ? ` · ${c.outcome}` : ""}</div>
          {c.standing && p && <StandingTable program={p} standing={c.standing} />}
        </div>); })}
      <div style={cardStyle}>
        <H>My evaluations</H>
        {d.myResults.filter(r => r.kind !== "practice").length === 0 && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No signed evaluations yet.</div>}
        {d.myResults.filter(r => r.kind !== "practice").map(r => <ResultRow key={r.id} r={r} program={progById(r.programId)} onOpen={() => onOpenResult(r.id)} />)}
      </div>
      <div style={{ ...cardStyle, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Radio size={28} color={BRICK} />
        <div style={{ flex: 1, minWidth: 240 }}><div style={{ fontWeight: 800 }}>Practice with the voice simulator</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>Fireground radio scenarios (size-up, command, Mayday cues) and leadership conversations. Practice runs are private and never go on your record.</div></div>
        <button style={btn("primary")} onClick={() => go("sim")}>Open the simulator</button>
      </div>
    </div>
  );
}

// ---- Module -------------------------------------------------------------------------------------------
export default function EvalsModule({ onBack, init }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [view, setView] = useState(init?.view ? init : { kind: "home" }), [msg, setMsg] = useState("");
  const load = () => call("").then(setD).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(""), 5000); };
  const evaluator = d && (d.evaluatesAny || d.access.view);
  const nav = [
    { key: "home", label: "My development", icon: ClipboardCheck, badge: d ? d.reviewsToAck.length + d.resultsToAck.length : 0 },
    { key: "sim", label: "Simulator", icon: Radio, group: "Voice simulations" },
    { key: "runs", label: "Simulation runs", icon: History, group: "Voice simulations" },
    ...(evaluator ? [{ key: "cands", label: "Working test periods", icon: Users, group: "Evaluator" },
      { key: "results", label: "Evaluations", icon: FileText, group: "Evaluator", badge: d?.myDrafts || 0 }] : []),
    ...(d?.access.manage ? [{ key: "programs", label: "Programs", icon: Settings, group: "Manage" }, { key: "scenarios", label: "Scenarios", icon: BookOpen, group: "Manage" }] : []),
  ];
  const go = k => setView({ kind: k });
  const activeKey = { cand: "cands", result: "results", newResult: "results", session: "runs" }[view.kind] || view.kind;
  const openResult = id => setView({ kind: "result", id });
  let page, title = "Evaluations";
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) page = <div style={{ color: INK_SOFT }}>Loading…</div>;
  else if (view.kind === "cands") { title = "Working test periods"; page = <CandidateList d={d} reload={load} onOpen={id => setView({ kind: "cand", id })} />; }
  else if (view.kind === "cand") { title = "Working test period"; page = <CandidateView key={view.id} id={view.id} toast={toast} onBack={() => setView({ kind: d.candidates.some(c => c.id === view.id) && evaluator ? "cands" : "home" })}
    onOpenResult={openResult} onNewResult={preset => setView({ kind: "newResult", preset, back: { kind: "cand", id: view.id } })} onRunSim={preset => setView({ kind: "sim", preset })} />; }
  else if (view.kind === "results") { title = "Evaluations"; page = <ResultsList d={d} onOpen={openResult} onNew={() => setView({ kind: "newResult", back: { kind: "results" } })} />; }
  else if (view.kind === "result") { title = "Evaluation"; page = <ResultEditor key={view.id} id={view.id} toast={toast} onBack={() => { load(); setView(view.back || { kind: evaluator ? "results" : "home" }); }} onDone={() => { load(); setView({ kind: "result", id: view.id, back: view.back, n: Date.now() }); }} />; }
  else if (view.kind === "newResult") { title = "New evaluation"; page = <ResultEditor preset={view.preset} toast={toast} onBack={() => setView(view.back || { kind: "results" })} onDone={(id) => { load(); setView({ kind: "result", id, back: view.back }); }} />; }
  else if (view.kind === "programs") { title = "Programs"; page = <Programs d={d} reload={load} toast={toast} />; }
  else if (view.kind === "scenarios") { title = "Simulation scenarios"; page = <ScenarioAdmin d={d} toast={toast} />; }
  else if (view.kind === "sim") { title = "Voice simulator"; page = <Simulator d={d} preset={view.preset} toast={toast} onOpenSession={id => setView({ kind: "session", id })} />; }
  else if (view.kind === "runs") { title = "Simulation runs"; page = <SessionList d={d} onOpen={id => setView({ kind: "session", id })} />; }
  else if (view.kind === "session") { title = "Simulation run"; page = <SessionView id={view.id} d={d} toast={toast} onBack={() => setView({ kind: "runs" })} onOpenResult={id => setView({ kind: "result", id, back: { kind: "session", id: view.id } })} />; }
  else page = <Home d={d} go={go} onOpenCand={id => setView({ kind: "cand", id })} onOpenResult={id => setView({ kind: "result", id, back: { kind: "home" } })} />;
  return (
    <AppShell section="Evaluations" nav={nav} active={activeKey} onNav={go} onHome={onBack} wide>
      <h1 style={{ fontSize: 22, margin: "0 0 12px", color: INK }}>{title}</h1>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
    </AppShell>
  );
}
