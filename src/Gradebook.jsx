// Gradebook (server/gradebook.js; math in src/gradebookShared.js). Teachers: their classes' grade grid (points by weighted category,
// comments and graded work per grade, report-card comments), rosters. Administrators and counselors (Gradebook view): every class,
// report cards, reports by grade level and subject. Gradebook manage: school setup (periods, letter scale, categories, classes and
// teachers, roster import, student and family sign-ins). Students and families use their own page at /grades (src/family/Family.jsx).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Users, BarChart3, Settings, Upload, Plus, Trash2, Printer, Download, Search, Paperclip, X, Mail, Calendar, ClipboardList, Check, ArrowLeft, Eye } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { BRAND } from "./brand.js";
import { studentGrade, inPeriod, letterFor, round, cleanScale, DEFAULT_SCALE, PLUS_MINUS_SCALE, studentName } from "./gradebookShared.js";

const INK = "#13233F", SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", RED = "#B42318", GREEN = "#1F7A45", AMBER = "#9A5B00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/gradebook${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const label = { fontSize: 12.5, color: SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "8px 10px", fontWeight: 700, fontSize: 12.5, color: "#fff", background: INK, textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "7px 10px", borderBottom: `1px solid ${LINE}`, verticalAlign: "middle", fontSize: 14 };
const pretty = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const pctText = p => (p == null ? "—" : `${p}%`);
const gColor = (p, passing = 60) => (p == null ? SOFT : p < passing ? RED : p < passing + 10 ? AMBER : GREEN);
const toDataUrl = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error("Couldn't read that file.")); r.readAsDataURL(file); });
const toBase64 = async file => (await toDataUrl(file)).split(",")[1] || "";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function printHtml(title, body) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#13233F;margin:18mm 14mm}h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 6px}
    .sub{color:#555;margin-bottom:12px}table{border-collapse:collapse;width:100%;margin:6px 0 12px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;font-size:12px}
    th{background:#eef1f5}.num{text-align:right}.c{color:#333;font-style:italic}@page{size:letter;margin:12mm}</style></head><body>${body}
    <script>window.onload=()=>{window.print()}</script></body></html>`);
  w.document.close();
}
function Dialog({ title, onClose, children, wide }) {
  return <div role="dialog" aria-label={title} style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16 }}>
    <div style={{ ...cardStyle, width: wide ? "min(760px, 100%)" : "min(480px, 100%)", margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16, color: INK }}>{title}</div>
        <button type="button" aria-label="Close" style={btn("ghost")} onClick={onClose}><X size={16} /></button></div>
      {children}
    </div></div>;
}
const periodSelect = (periods, value, onChange, aria = "Grading period") => <select aria-label={aria} style={{ ...inputStyle, width: "auto" }} value={value} onChange={e => onChange(e.target.value)}>
  {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="">Whole year</option></select>;

// ---------------------------------------------------------------- assignment editor
function AssignmentDialog({ d, a, onClose, onSaved, toast }) {
  const cats = d.class.categories.length ? d.class.categories : d.settings.categories;
  const today = new Date(); const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [f, setF] = useState(() => a ? { ...a, points: String(a.points), due: a.due || "", periodId: a.periodId || "" }
    : { title: "", category: cats[0]?.id || "", points: "100", due: iso, periodId: "", published: true, description: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { onSaved(await call(`/classes/${d.class.id}/assignments`, { ...f, id: a?.id, points: Number(f.points), periodId: f.periodId || null })); toast(a ? "Assignment saved." : "Assignment added."); onClose(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Remove "${a.title}" and every grade entered for it?`)) return;
    try { onSaved(await call(`/assignments/${a.id}/remove`, {})); toast("Assignment removed."); onClose(); } catch (e) { toast(e.message); }
  };
  return <Dialog title={a ? "Edit assignment" : "New assignment"} onClose={onClose}>
    <label style={{ display: "block", marginBottom: 10 }}><span style={label}>Name</span><input aria-label="Assignment name" style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Unit 4 quiz" autoFocus /></label>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
      <label><span style={label}>Category</span><select aria-label="Category" style={inputStyle} value={f.category} onChange={e => set("category", e.target.value)}>
        {cats.map(c => <option key={c.id} value={c.id}>{c.name}{c.weight ? ` (${c.weight}%)` : ""}</option>)}</select></label>
      <label><span style={label}>Points possible</span><input aria-label="Points possible" inputMode="decimal" style={inputStyle} value={f.points} onChange={e => set("points", e.target.value)} /></label>
      <label><span style={label}>Due</span><input type="date" aria-label="Due" style={inputStyle} value={f.due} onChange={e => set("due", e.target.value)} /></label>
      <label><span style={label}>Grading period</span><select aria-label="Assignment grading period" style={inputStyle} value={f.periodId} onChange={e => set("periodId", e.target.value)}>
        <option value="">By due date</option>{d.periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    <label style={{ display: "block", marginBottom: 10 }}><span style={label}>Notes for students (optional)</span>
      <textarea aria-label="Notes for students" rows={2} style={{ ...inputStyle, resize: "vertical" }} value={f.description} onChange={e => set("description", e.target.value)} /></label>
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, color: INK, marginBottom: 14 }}>
      <input type="checkbox" checked={f.published} onChange={e => set("published", e.target.checked)} style={{ marginTop: 3 }} />
      <span>Show to students and families<br /><span style={{ color: SOFT, fontSize: 12.5 }}>Hidden assignments are drafts: they don't count toward anyone's grade until you show them.</span></span></label>
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" style={btn("primary")} disabled={busy} onClick={save}>{a ? "Save assignment" : "Add assignment"}</button>
      <button type="button" style={btn("outline")} onClick={onClose}>Cancel</button>
      <span style={{ flex: 1 }} />
      {a && <button type="button" style={{ ...btn("ghost"), color: RED }} onClick={remove}><Trash2 size={14} /> Remove</button>}
    </div>
  </Dialog>;
}

// ---------------------------------------------------------------- the grade grid
const cellText = c => (!c ? "" : c.points != null ? String(c.points) : c.status === "missing" ? "M" : c.status === "excused" ? "EX" : "");
function parseCell(t, prev) {
  const v = String(t).trim().toLowerCase();
  if (v === "") return { points: null, status: prev?.status === "late" ? "late" : "" };
  if (v === "m" || v === "missing") return { points: null, status: "missing" };
  if (v === "x" || v === "ex" || v === "excused") return { points: null, status: "excused" };
  const n = Number(v.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(v)) return null;
  return { points: n, status: prev?.status === "late" ? "late" : "" };
}
function GradeGrid({ d, setD, periodId, toast }) {
  const [draft, setDraft] = useState({});        // "a|s" -> text being typed
  const [focus, setFocus] = useState(null);      // {a, s}
  const [editing, setEditing] = useState(null);  // assignment or "new"
  const [saving, setSaving] = useState(""), pending = useRef(new Map()), timer = useRef(null);
  const period = d.periods.find(p => p.id === periodId) || null;
  const cols = useMemo(() => d.assignments.filter(a => inPeriod(a, period)), [d.assignments, period]);
  const cats = d.class.categories.length ? d.class.categories : d.settings.categories;
  const catName = id => cats.find(c => c.id === id)?.name || "";
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const changes = [...pending.current.values()];
    if (!changes.length) return;
    pending.current.clear();
    setSaving("Saving…");
    try { const x = await call(`/classes/${d.class.id}/scores`, { changes }); setD(x); setDraft(dr => { const n = { ...dr }; for (const c of changes) delete n[`${c.assignmentId}|${c.studentId}`]; return n; }); setSaving("Saved"); }
    catch (e) { setSaving(""); toast(e.message); }
  }, [d.class.id]);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const queue = (aId, sId, change) => {
    const k = `${aId}|${sId}`, prev = pending.current.get(k) || { assignmentId: aId, studentId: sId };
    pending.current.set(k, { ...prev, ...change });
    clearTimeout(timer.current); timer.current = setTimeout(flush, 800); setSaving("Not saved yet");
  };
  const commit = (a, s) => {
    const k = `${a.id}|${s.id}`;
    if (!(k in draft)) return;
    const prev = d.scores[a.id]?.[s.id];
    const v = parseCell(draft[k], prev);
    if (!v) { toast(`"${draft[k]}" isn't a score. Type points, M for missing or EX for excused.`); return; }
    if (v.points != null && v.points > a.points * 2) toast(`${v.points} is more than twice the ${a.points} points possible. Check it.`);
    queue(a.id, s.id, v);
  };
  const move = (row, col, e) => {
    const go = (r, c) => { const el = document.querySelector(`[data-gb="${r}:${c}"]`); if (el) { e.preventDefault(); el.focus(); el.select?.(); } };
    if (e.key === "Enter" || e.key === "ArrowDown") go(row + 1, col);
    else if (e.key === "ArrowUp") go(row - 1, col);
    else if (e.key === "ArrowRight" && e.target.selectionStart === e.target.value.length) go(row, col + 1);
    else if (e.key === "ArrowLeft" && e.target.selectionStart === 0) go(row, col - 1);
  };
  // Grades as shown, including what's typed and not yet saved
  const live = useMemo(() => {
    const out = {};
    for (const s of d.students) {
      const mine = {};
      for (const a of d.assignments) {
        const k = `${a.id}|${s.id}`, base = d.scores[a.id]?.[s.id];
        const p = pending.current.get(k);
        mine[a.id] = p ? { ...base, ...p } : base;
      }
      const shown = cols.filter(a => a.published);
      out[s.id] = studentGrade(cats, shown, mine, { missingZero: d.settings.missingZero, scale: d.settings.scale });
    }
    return out;
  }, [d, cols, draft, saving]);
  const fc = focus ? { a: d.assignments.find(x => x.id === focus.a), s: d.students.find(x => x.id === focus.s) } : null;
  const fcell = fc?.a && fc?.s ? d.scores[fc.a.id]?.[fc.s.id] || null : null;
  const setStatus = async status => { await flush(); queue(fc.a.id, fc.s.id, { status, points: status === "missing" || status === "excused" ? null : fcell?.points ?? null }); await flush(); };
  const avg = a => { const v = d.students.map(s => d.scores[a.id]?.[s.id]?.points).filter(x => x != null); return v.length ? round((100 * v.reduce((t, x) => t + x, 0)) / (v.length * a.points), 0) : null; };
  return <>
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {d.canGrade && <button type="button" style={btn("primary")} onClick={() => setEditing("new")}><Plus size={14} /> New assignment</button>}
      <span style={{ fontSize: 13, color: saving === "Saved" ? GREEN : SOFT }} role="status" aria-label="Save status">{saving}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12.5, color: SOFT }}>Type points; <b>M</b> = missing, <b>EX</b> = excused. Enter moves down.</span>
    </div>
    <div style={{ ...cardStyle, padding: 0, overflow: "auto", maxHeight: "65vh" }} role="region" aria-label="Grades">
      {!d.students.length ? <div style={{ padding: 16, color: SOFT }}>No students in this class yet. Add them on the Students tab, or import the rosters (Gradebook setup).</div> :
      <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
        <thead><tr>
          <th style={{ ...th, position: "sticky", left: 0, top: 0, zIndex: 3, minWidth: 180 }}>Student</th>
          <th style={{ ...th, position: "sticky", top: 0, zIndex: 2, textAlign: "center" }}>{period ? period.name : "Year"}</th>
          {cols.map(a => <th key={a.id} style={{ ...th, position: "sticky", top: 0, zIndex: 2, minWidth: 96, maxWidth: 140, whiteSpace: "normal", verticalAlign: "bottom",
            background: a.published ? INK : "#5B6675", cursor: d.canGrade ? "pointer" : "default" }} onClick={() => d.canGrade && setEditing(a)} title={d.canGrade ? "Edit assignment" : ""}>
            <div style={{ fontSize: 12.5, lineHeight: 1.2 }}>{a.title}</div>
            <div style={{ fontWeight: 500, fontSize: 11, opacity: .85, marginTop: 2 }}>{catName(a.category)} · {a.points} pts{a.due ? ` · ${pretty(a.due)}` : ""}</div>
            {!a.published && <div style={{ fontWeight: 700, fontSize: 10.5, color: "#FFD58A", marginTop: 2 }}>Hidden draft</div>}
          </th>)}
        </tr></thead>
        <tbody>{d.students.map((s, row) => {
          const g = live[s.id];
          return <tr key={s.id}>
            <td style={{ ...td, position: "sticky", left: 0, background: "#fff", zIndex: 1, fontWeight: 600, whiteSpace: "nowrap" }}>{studentName(s)}</td>
            <td style={{ ...td, textAlign: "center", fontWeight: 800, color: gColor(g.pct, d.settings.passing), whiteSpace: "nowrap" }} aria-label={`Grade for ${studentName(s)}`}>
              {g.pct == null ? "—" : `${g.letter} ${round(g.pct, d.settings.decimals ?? 1)}%`}</td>
            {cols.map((a, col) => {
              const k = `${a.id}|${s.id}`, c = d.scores[a.id]?.[s.id], p = pending.current.get(k);
              const val = k in draft ? draft[k] : cellText(p ? { ...c, ...p } : c);
              const st = (p?.status ?? c?.status) || "";
              const on = focus?.a === a.id && focus?.s === s.id;
              return <td key={a.id} style={{ ...td, padding: 3, position: "relative", background: st === "missing" ? "#FDECEC" : st === "excused" ? "#EEF1F5" : st === "late" ? "#FFF5E0" : on ? "#EAF2FF" : "#fff" }}>
                <input data-gb={`${row}:${col}`} aria-label={`${a.title}, ${studentName(s)}`} value={val} disabled={!d.canGrade} inputMode="decimal"
                  onChange={e => setDraft(x => ({ ...x, [k]: e.target.value }))} onBlur={() => commit(a, s)} onFocus={e => { setFocus({ a: a.id, s: s.id }); e.target.select(); }}
                  onKeyDown={e => { if (["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) { commit(a, s); move(row, col, e); } }}
                  style={{ width: "100%", minWidth: 60, boxSizing: "border-box", border: `1px solid ${on ? BLUE : "transparent"}`, borderRadius: 5, padding: "6px 6px", fontSize: 14, textAlign: "right",
                    background: "transparent", color: st === "missing" ? RED : INK, fontWeight: st === "missing" ? 700 : 500, fontFamily: "inherit" }} />
                {(c?.comment || c?.files?.length > 0) && <span aria-hidden="true" style={{ position: "absolute", top: 3, left: 4, width: 6, height: 6, borderRadius: 3, background: BLUE }} />}
              </td>;
            })}
          </tr>;
        })}
        <tr><td style={{ ...td, position: "sticky", left: 0, background: PAPER, fontWeight: 700, zIndex: 1 }}>Class average</td>
          <td style={{ ...td, background: PAPER, textAlign: "center", fontWeight: 700 }}>{(() => { const v = d.students.map(s => live[s.id].pct).filter(x => x != null); return v.length ? `${round(v.reduce((t, x) => t + x, 0) / v.length, 1)}%` : "—"; })()}</td>
          {cols.map(a => <td key={a.id} style={{ ...td, background: PAPER, textAlign: "right", color: SOFT }}>{pctText(avg(a))}</td>)}</tr>
        </tbody>
      </table>}
    </div>
    {!cols.length && d.students.length > 0 && <div style={{ color: SOFT, fontSize: 14 }}>No assignments in {period ? period.name : "this class"} yet.{d.canGrade ? " Add one with New assignment." : ""}</div>}
    {fc?.a && fc?.s && <div style={cardStyle} role="region" aria-label="Grade details">
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ color: INK }}>{studentName(fc.s)}</b><span style={{ color: SOFT }}>{fc.a.title} · {fc.a.points} points</span>
        {fcell?.by && <span style={{ fontSize: 12, color: SOFT }}>last changed by {fcell.by}</span>}</div>
      {d.canGrade && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[["", "On time"], ["late", "Late"], ["missing", "Missing"], ["excused", "Excused"]].map(([k, l]) =>
          <button key={k || "none"} type="button" aria-pressed={(fcell?.status || "") === k} onClick={() => setStatus(k)} style={{ ...btn((fcell?.status || "") === k ? "primary" : "outline"), padding: "5px 10px", fontSize: 13 }}>{l}</button>)}</div>}
      <CellComment key={`${fc.a.id}|${fc.s.id}`} d={d} a={fc.a} s={fc.s} cell={fcell} setD={setD} flush={flush} toast={toast} />
    </div>}
    {editing && <AssignmentDialog d={d} a={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={setD} toast={toast} />}
  </>;
}
function CellComment({ d, a, s, cell, setD, flush, toast }) {
  const [text, setText] = useState(cell?.comment || ""), [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const saveComment = async () => {
    if (text === (cell?.comment || "")) return;
    await flush();
    try { setD(await call(`/classes/${d.class.id}/scores`, { changes: [{ assignmentId: a.id, studentId: s.id, points: cell?.points ?? null, status: cell?.status || "", comment: text }] })); toast("Comment saved."); }
    catch (e) { toast(e.message); }
  };
  const attach = async e => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    if (f.size > 10 * 1024 * 1024) return toast("That file is over 10 MB.");
    setBusy(true);
    try { setD(await call("/files", { assignmentId: a.id, studentId: s.id, name: f.name, dataUrl: await toDataUrl(f) })); toast("Graded work attached."); }
    catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const remove = async f => { if (!window.confirm(`Remove ${f.name}?`)) return; try { setD(await call(`/files/${f.id}/remove`, {})); } catch (x) { toast(x.message); } };
  return <div style={{ display: "grid", gap: 8 }}>
    <label><span style={label}>Comment the student and family see</span>
      <textarea aria-label="Grade comment" rows={2} disabled={!d.canGrade} style={{ ...inputStyle, resize: "vertical" }} value={text} onChange={e => setText(e.target.value)} onBlur={saveComment}
        placeholder="e.g. Great work on the essay question; check your units on #4." /></label>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {(cell?.files || []).map(f => <span key={f.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${LINE}`, borderRadius: 6, padding: "4px 8px", fontSize: 13 }}>
        <Paperclip size={13} /><a href={`/api/gradebook/files/${f.id}`} target="_blank" rel="noreferrer" style={{ color: INK }}>{f.name}</a>
        {d.canGrade && <button type="button" aria-label={`Remove ${f.name}`} style={{ ...btn("ghost"), padding: 2 }} onClick={() => remove(f)}><X size={12} /></button>}</span>)}
      {d.canGrade && <><input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden aria-label="Graded work file" onChange={attach} />
        <button type="button" style={btn("outline")} disabled={busy} onClick={() => fileRef.current?.click()}><Paperclip size={14} /> {busy ? "Attaching…" : "Attach graded work"}</button></>}
      {!d.canGrade && !(cell?.files || []).length && <span style={{ fontSize: 13, color: SOFT }}>No graded work attached.</span>}
    </div>
  </div>;
}

// ---------------------------------------------------------------- class: students tab, categories tab
function StudentPicker({ onPick, exclude = new Set(), placeholder = "Find a student by name or ID" }) {
  const [q, setQ] = useState(""), [list, setList] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return; }
    const t = setTimeout(() => call(`/students?q=${encodeURIComponent(q.trim())}`).then(r => setList(r.students), () => setList([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return <div style={{ position: "relative" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Search size={15} color={SOFT} />
      <input aria-label="Find a student" style={inputStyle} value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} /></div>
    {list.length > 0 && <div style={{ border: `1px solid ${LINE}`, borderRadius: 6, marginTop: 4, background: "#fff", maxHeight: 240, overflowY: "auto" }}>
      {list.map(s => <button key={s.id} type="button" disabled={exclude.has(s.id)} onClick={() => { onPick(s); setQ(""); setList([]); }}
        style={{ display: "flex", width: "100%", gap: 8, padding: "8px 10px", border: 0, borderBottom: `1px solid ${LINE}`, background: "#fff", cursor: exclude.has(s.id) ? "default" : "pointer", textAlign: "left", fontSize: 14, color: exclude.has(s.id) ? SOFT : INK }}>
        <b style={{ fontWeight: 600 }}>{studentName(s)}</b><span style={{ color: SOFT }}>{[s.number, s.gradeLevel && `Grade ${s.gradeLevel}`].filter(Boolean).join(" · ")}</span>
        {exclude.has(s.id) && <span style={{ marginLeft: "auto", color: SOFT }}>in this class</span>}</button>)}</div>}
  </div>;
}
function NewStudent({ classId, onDone, toast, onCancel }) {
  const [f, setF] = useState({ firstName: "", lastName: "", number: "", gradeLevel: "" }), [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await call("/students", { ...f, classId }); toast("Student added."); onDone(); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end" }}>
    {[["firstName", "First name"], ["lastName", "Last name"], ["number", "Student ID"], ["gradeLevel", "Grade"]].map(([k, l]) =>
      <label key={k}><span style={label}>{l}</span><input aria-label={`New student ${l.toLowerCase()}`} style={inputStyle} value={f[k]} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} /></label>)}
    <div style={{ display: "flex", gap: 6 }}><button type="button" style={btn("primary")} disabled={busy} onClick={save}>Add student</button><button type="button" style={btn("outline")} onClick={onCancel}>Cancel</button></div>
  </div>;
}
function RosterTab({ d, setD, periodId, toast, openStudent, reload }) {
  const [adding, setAdding] = useState(false);
  const period = d.periods.find(p => p.id === periodId) || null;
  const ids = new Set(d.students.map(s => s.id));
  const cats = d.class.categories.length ? d.class.categories : d.settings.categories;
  const shown = d.assignments.filter(a => a.published && inPeriod(a, period));
  const scoresFor = sid => Object.fromEntries(d.assignments.map(a => [a.id, d.scores[a.id]?.[sid]]).filter(([, v]) => v));
  const add = async s => { try { setD(await call(`/classes/${d.class.id}/students`, { add: [s.id] })); toast(`${s.firstName} added to the class.`); } catch (e) { toast(e.message); } };
  const drop = async s => { if (!window.confirm(`Drop ${s.firstName} ${s.lastName} from ${d.class.name}? Their grades are kept.`)) return; try { setD(await call(`/classes/${d.class.id}/students`, { drop: [s.id] })); } catch (e) { toast(e.message); } };
  const saveComment = async (s, text) => { try { await call(`/classes/${d.class.id}/comment`, { studentId: s.id, periodId, comment: text }); setD(x => ({ ...x, comments: { ...x.comments, [periodId]: { ...(x.comments[periodId] || {}), [s.id]: text } } })); toast("Comment saved."); } catch (e) { toast(e.message); } };
  const canRoster = d.teaches || d.canManage;
  return <>
    {canRoster && <div style={cardStyle}>
      <div style={{ fontWeight: 800, color: INK, marginBottom: 8 }}>Add a student</div>
      {adding ? <NewStudent classId={d.class.id} toast={toast} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
        : <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}><StudentPicker exclude={ids} onPick={add} />
          <button type="button" style={btn("outline")} onClick={() => setAdding(true)}><Plus size={14} /> New student</button></div>}
    </div>}
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={th}>Student</th><th style={th}>ID</th><th style={th}>Grade</th><th style={{ ...th, textAlign: "center" }}>{period ? period.name : "Year"}</th>
          {period && <th style={th}>Report card comment ({period.name})</th>}<th style={th}></th></tr></thead>
        <tbody>{d.students.map(s => {
          const g = studentGrade(cats, shown, scoresFor(s.id), { missingZero: d.settings.missingZero, scale: d.settings.scale });
          return <tr key={s.id}>
            <td style={td}><button type="button" style={{ ...btn("ghost"), padding: 0, color: BLUE, fontWeight: 600 }} onClick={() => openStudent(s.id)}>{studentName(s)}</button></td>
            <td style={td}>{s.number}</td><td style={td}>{s.gradeLevel}</td>
            <td style={{ ...td, textAlign: "center", fontWeight: 800, color: gColor(g.pct, d.settings.passing) }}>{g.pct == null ? "—" : `${g.letter} ${round(g.pct, 1)}%`}</td>
            {period && <td style={{ ...td, minWidth: 260 }}><textarea aria-label={`Report card comment for ${studentName(s)}`} rows={1} disabled={!d.canGrade} defaultValue={d.comments[periodId]?.[s.id] || ""}
              onBlur={e => e.target.value !== (d.comments[periodId]?.[s.id] || "") && saveComment(s, e.target.value)} style={{ ...inputStyle, resize: "vertical", fontSize: 13.5 }} /></td>}
            <td style={{ ...td, textAlign: "right" }}>{canRoster && <button type="button" style={{ ...btn("ghost"), color: RED }} onClick={() => drop(s)}>Drop</button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!d.students.length && <div style={{ padding: 14, color: SOFT }}>No students yet.</div>}
    </div>
  </>;
}
function CategoryEditor({ value, onSave, saveLabel = "Save categories", note }) {
  const [rows, setRows] = useState(() => value.map(c => ({ ...c, weight: String(c.weight) })));
  useEffect(() => { setRows(value.map(c => ({ ...c, weight: String(c.weight) }))); }, [JSON.stringify(value)]);
  const total = rows.reduce((t, r) => t + (Number(r.weight) || 0), 0);
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return <div>
    {rows.map((r, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: 8, marginBottom: 6 }}>
      <input aria-label={`Category ${i + 1} name`} style={inputStyle} value={r.name} onChange={e => set(i, "name", e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}><input aria-label={`Category ${i + 1} weight`} inputMode="decimal" style={{ ...inputStyle, textAlign: "right" }} value={r.weight} onChange={e => set(i, "weight", e.target.value)} />%</div>
      <button type="button" aria-label={`Remove category ${i + 1}`} style={btn("ghost")} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>)}
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <button type="button" style={btn("outline")} onClick={() => setRows(rs => [...rs, { id: "", name: "", weight: "0" }])}><Plus size={14} /> Add category</button>
      <span style={{ fontSize: 13, color: total === 100 ? GREEN : AMBER, fontWeight: 600 }}>Weights add up to {total}%{total !== 100 && total > 0 ? " (grades are scaled to the weights used, so this still works)" : ""}{total === 0 ? " (all 0: straight points, total earned / total possible)" : ""}</span>
      <span style={{ flex: 1 }} />
      <button type="button" style={btn("primary")} onClick={() => onSave(rows.map(r => ({ ...r, weight: Number(r.weight) || 0 })))}>{saveLabel}</button>
    </div>
    {note && <div style={{ fontSize: 12.5, color: SOFT, marginTop: 8 }}>{note}</div>}
  </div>;
}

function ClassView({ id, top, onBack, openStudent, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [tab, setTab] = useState("grades"), [periodId, setPeriodId] = useState(null);
  const load = () => call(`/classes/${id}`).then(x => { setD(x); setPeriodId(p => (p === null ? x.current : p)); }, e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <div role="alert" style={{ ...cardStyle, color: RED }}>{error}</div>;
  if (!d) return <div style={{ color: SOFT }}>Loading…</div>;
  const c = d.class;
  const printSheet = () => {
    const period = d.periods.find(p => p.id === periodId) || null;
    const cats = c.categories.length ? c.categories : d.settings.categories;
    const cols = d.assignments.filter(a => a.published && inPeriod(a, period));
    const rows = d.students.map(s => { const sc = Object.fromEntries(d.assignments.map(a => [a.id, d.scores[a.id]?.[s.id]]).filter(([, v]) => v));
      const g = studentGrade(cats, cols, sc, { missingZero: d.settings.missingZero, scale: d.settings.scale });
      return `<tr><td>${esc(studentName(s))}</td><td class="num"><b>${g.pct == null ? "—" : `${esc(g.letter)} ${round(g.pct, 1)}%`}</b></td>${cols.map(a => `<td class="num">${esc(cellText(sc[a.id]))}</td>`).join("")}</tr>`; }).join("");
    printHtml(`${c.name} grades`, `<h1>${esc(c.name)}</h1><div class="sub">${esc(BRAND.org)} · ${esc(c.teachers.map(t => t.name).join(", "))} · ${esc(period ? period.name : "Whole year")}</div>
      <table><tr><th>Student</th><th>Grade</th>${cols.map(a => `<th>${esc(a.title)}<br><small>${a.points} pts</small></th>`).join("")}</tr>${rows}</table>`);
  };
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {top}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{c.name}</div>
        <div style={{ color: SOFT, fontSize: 14 }}>{[c.section, c.subject, c.gradeLevel && `Grade ${c.gradeLevel}`, c.teachers.map(t => t.name).join(", ") || "No teacher listed"].filter(Boolean).join(" · ")}</div></div>
      {periodSelect(d.periods, periodId ?? "", setPeriodId)}
      <button type="button" style={btn("outline")} onClick={printSheet}><Printer size={14} /> Print</button>
    </div>
    <div style={{ display: "flex", gap: 6 }} role="tablist">
      {[["grades", "Grades"], ["students", `Students (${d.students.length})`], ["categories", "Categories"]].map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...btn(tab === k ? "primary" : "outline"), padding: "6px 12px" }}>{l}</button>)}</div>
    {tab === "grades" && <GradeGrid d={d} setD={setD} periodId={periodId ?? ""} toast={toast} />}
    {tab === "students" && <RosterTab d={d} setD={setD} periodId={periodId ?? ""} toast={toast} openStudent={openStudent} reload={load} />}
    {tab === "categories" && <div style={cardStyle}>
      <div style={{ fontWeight: 800, color: INK, marginBottom: 4 }}>How {c.name} is graded</div>
      <div style={{ fontSize: 13.5, color: SOFT, marginBottom: 12 }}>Each category's percent counts by its weight. Work in a category you remove moves to the first one.</div>
      {d.canGrade ? <CategoryEditor value={c.categories.length ? c.categories : d.settings.categories} onSave={async cats => { try { setD(await call(`/classes/${c.id}/categories`, { categories: cats })); toast("Categories saved."); } catch (e) { toast(e.message); } }} />
        : <ul>{(c.categories.length ? c.categories : d.settings.categories).map(x => <li key={x.id}>{x.name}: {x.weight}%</li>)}</ul>}
    </div>}
  </div>;
}

// ---------------------------------------------------------------- report card (one student)
function FamilyCard({ d, studentId, setFam, toast }) {
  const [f, setF] = useState({ kind: "guardian", name: "", email: "", relationship: "" }), [link, setLink] = useState(null), [busy, setBusy] = useState(false);
  const showLink = inv => setLink(inv);
  const add = async () => { setBusy(true); try { const r = await call("/family", { ...f, studentId }); setFam(r.family); setF({ kind: "guardian", name: "", email: "", relationship: "" }); toast("Sign-in set up."); if (r.invite) showLink(r.invite); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const newLink = async p => { try { showLink((await call(`/family/${p.id}/invite`, {})).invite); } catch (e) { toast(e.message); } };
  const active = async (p, on) => { try { await call(`/family/${p.id}/active`, { active: on }); setFam((await call(`/family?studentId=${studentId}`)).family); } catch (e) { toast(e.message); } };
  const unlink = async p => { if (!window.confirm(`Remove ${p.name}'s access to this student?`)) return; try { setFam((await call(`/family/${p.id}/unlink`, { studentId })).family); } catch (e) { toast(e.message); } };
  const full = link ? (link.link || location.origin + link.path) : "";
  return <div style={cardStyle} role="region" aria-label="Student and family sign-ins">
    <div style={{ fontWeight: 800, color: INK, marginBottom: 8 }}>Student and family sign-ins</div>
    {d.family.length ? d.family.map(p => <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}><b>{p.name}</b> <span style={{ color: SOFT }}>{p.kind === "student" ? "Student" : p.relationship || "Parent / guardian"} · {p.email}</span>
        <div style={{ fontSize: 12.5, color: !p.active ? RED : p.ready ? GREEN : AMBER }}>{!p.active ? "Turned off" : p.ready ? `Signed up${p.lastLogin ? ` · last signed in ${new Date(p.lastLogin).toLocaleDateString()}` : ""}` : p.invited ? "Link sent, not used yet" : "No password yet"}</div></div>
      {d.canManage && <>
        <button type="button" style={btn("outline")} onClick={() => newLink(p)}><Mail size={14} /> New sign-in link</button>
        <button type="button" style={btn("ghost")} onClick={() => active(p, !p.active)}>{p.active ? "Turn off" : "Turn on"}</button>
        <button type="button" style={{ ...btn("ghost"), color: RED }} onClick={() => unlink(p)}>Remove</button></>}
    </div>) : <div style={{ color: SOFT, fontSize: 14 }}>Nobody signs in for this student yet.</div>}
    {link && <div role="status" style={{ marginTop: 10, background: PAPER, borderRadius: 8, padding: 10, fontSize: 13.5 }}>
      {link.emailed ? "The sign-in link was emailed. " : "Email isn't set up on this server, so give them this link (it works once, for " + link.days + " days): "}
      {!link.emailed && <div style={{ display: "flex", gap: 6, marginTop: 6 }}><input readOnly aria-label="Sign-in link" style={{ ...inputStyle, fontSize: 12.5 }} value={full} onFocus={e => e.target.select()} />
        <button type="button" style={btn("outline")} onClick={() => navigator.clipboard?.writeText(full).then(() => toast("Link copied."))}>Copy</button></div>}</div>}
    {d.canManage && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 12, alignItems: "end" }}>
      <label><span style={label}>Who</span><select aria-label="Sign-in for" style={inputStyle} value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value }))}>
        <option value="guardian">Parent / guardian</option><option value="student">The student</option></select></label>
      <label><span style={label}>Name</span><input aria-label="Sign-in name" style={inputStyle} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></label>
      <label><span style={label}>Email</span><input aria-label="Sign-in email" type="email" style={inputStyle} value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></label>
      {f.kind === "guardian" && <label><span style={label}>Relationship</span><input aria-label="Relationship" style={inputStyle} value={f.relationship} placeholder="Mother, Father, Guardian…" onChange={e => setF(x => ({ ...x, relationship: e.target.value }))} /></label>}
      <button type="button" style={btn("primary")} disabled={busy} onClick={add}><Plus size={14} /> Add sign-in</button>
    </div>}
  </div>;
}
function StudentView({ id, onBack, openClass, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [open, setOpen] = useState(null), [log, setLog] = useState(null);
  useEffect(() => { setD(null); call(`/students/${id}`).then(setD, e => setError(e.message)); }, [id]);
  if (error) return <div role="alert" style={{ ...cardStyle, color: RED }}>{error}</div>;
  if (!d) return <div style={{ color: SOFT }}>Loading…</div>;
  const st = d.student;
  const print = () => printHtml(`Report card ${st.lastName}`, `<h1>${esc(st.firstName)} ${esc(st.lastName)}</h1><div class="sub">${esc(BRAND.org)} · ${st.gradeLevel ? `Grade ${esc(st.gradeLevel)} · ` : ""}${st.number ? `ID ${esc(st.number)} · ` : ""}printed ${new Date().toLocaleDateString()}</div>
    <table><tr><th>Class</th><th>Teacher</th>${d.periods.map(p => `<th>${esc(p.name)}</th>`).join("")}<th>Year</th></tr>${d.classes.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.teachers.map(t => t.name).join(", "))}</td>${d.periods.map(p => { const g = c.grade?.periods[p.id]; return `<td class="num">${g?.pct == null ? "" : `${esc(g.letter)} ${g.pct}%`}</td>`; }).join("")}<td class="num"><b>${c.grade?.year?.pct == null ? "" : `${esc(c.grade.year.letter)} ${c.grade.year.pct}%`}</b></td></tr>`).join("")}</table>
    ${d.classes.flatMap(c => d.periods.filter(p => c.comments[p.id]).map(p => `<div><b>${esc(c.name)}, ${esc(p.name)}:</b> <span class="c">${esc(c.comments[p.id])}</span></div>`)).join("")}`);
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" style={btn("outline")} onClick={onBack}><ArrowLeft size={14} /> Back</button>
      <div style={{ flex: 1 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{st.firstName} {st.lastName}</div>
        <div style={{ color: SOFT, fontSize: 14 }}>{[st.gradeLevel && `Grade ${st.gradeLevel}`, st.number && `ID ${st.number}`, st.email].filter(Boolean).join(" · ")}</div></div>
      <button type="button" style={btn("outline")} onClick={print}><Printer size={14} /> Print report card</button>
      {d.canManage && <button type="button" style={btn("outline")} onClick={async () => { try { setLog((await call(`/log?studentId=${id}`)).log); } catch (e) { toast(e.message); } }}><Eye size={14} /> Who looked</button>}
    </div>
    {d.limited && <div style={{ fontSize: 13, color: SOFT }}>You see the classes you teach.</div>}
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }} role="region" aria-label="Report card">
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th style={th}>Class</th><th style={th}>Teacher</th>{d.periods.map(p => <th key={p.id} style={{ ...th, textAlign: "center" }}>{p.name}</th>)}<th style={{ ...th, textAlign: "center" }}>Year</th></tr></thead>
        <tbody>{d.classes.map(c => <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setOpen(c)}>
          <td style={{ ...td, fontWeight: 600, color: BLUE }}>{c.name}</td><td style={td}>{c.teachers.map(t => t.name).join(", ")}</td>
          {d.periods.map(p => { const g = c.grade?.periods[p.id]; return <td key={p.id} style={{ ...td, textAlign: "center", color: gColor(g?.pct, d.passing), fontWeight: 700 }}>{g?.pct == null ? "—" : `${g.letter} ${g.pct}%`}</td>; })}
          <td style={{ ...td, textAlign: "center", fontWeight: 800, color: gColor(c.grade?.year?.pct, d.passing) }}>{c.grade?.year?.pct == null ? "—" : `${c.grade.year.letter} ${c.grade.year.pct}%`}</td></tr>)}</tbody>
      </table>
      {!d.classes.length && <div style={{ padding: 14, color: SOFT }}>Not in any classes.</div>}
    </div>
    {open && <StudentClass studentId={id} cls={open} onClose={() => setOpen(null)} openClass={openClass} />}
    {(d.canManage || d.family.length > 0) && <FamilyCard d={d} studentId={id} setFam={family => setD(x => ({ ...x, family }))} toast={toast} />}
    {log && <Dialog title={`Who looked at ${st.firstName}'s grades`} onClose={() => setLog(null)} wide>
      {!log.length ? <div style={{ color: SOFT }}>Nobody yet.</div> : <table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>{log.map((x, i) => <tr key={i}>
        <td style={td}>{new Date(x.at).toLocaleString()}</td><td style={td}>{x.name}</td><td style={td}>{x.kind === "staff" ? "Staff" : x.kind === "student" ? "Student" : "Parent / guardian"}</td><td style={td}>{x.what}</td></tr>)}</tbody></table>}
      <div style={{ fontSize: 12.5, color: SOFT, marginTop: 8 }}>Each person is listed at most once an hour for the same page.</div>
    </Dialog>}
  </div>;
}
function StudentClass({ studentId, cls, onClose, openClass }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => { call(`/students/${studentId}/classes/${cls.id}`).then(setD, e => setError(e.message)); }, [cls.id]);
  const catName = id => d?.class.categories.find(c => c.id === id)?.name || "";
  return <Dialog title={cls.name} onClose={onClose} wide>
    {error && <div role="alert" style={{ color: RED }}>{error}</div>}
    {!d && !error && <div style={{ color: SOFT }}>Loading…</div>}
    {d && <>
      <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={th}>Assignment</th><th style={th}>Category</th><th style={th}>Due</th><th style={{ ...th, textAlign: "right" }}>Score</th><th style={th}>Comment</th></tr></thead>
        <tbody>{d.assignments.map(a => <tr key={a.id} style={{ opacity: a.published ? 1 : 0.6 }}>
          <td style={td}>{a.title}{!a.published && <span style={{ color: SOFT, fontSize: 12 }}> (hidden draft)</span>}</td><td style={td}>{catName(a.category)}</td><td style={td}>{pretty(a.due)}</td>
          <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", color: a.score?.status === "missing" ? RED : INK }}>{a.score?.status === "excused" ? "Excused" : a.score?.points != null ? `${a.score.points} / ${a.points}` : a.score?.status === "missing" ? `Missing / ${a.points}` : `– / ${a.points}`}{a.score?.status === "late" ? " · Late" : ""}</td>
          <td style={{ ...td, fontSize: 13 }}>{a.score?.comment}{a.score?.files?.map(f => <div key={f.id}><a href={`/api/gradebook/files/${f.id}`} target="_blank" rel="noreferrer"><Paperclip size={12} /> {f.name}</a></div>)}</td></tr>)}</tbody></table>
      {openClass && <button type="button" style={{ ...btn("outline"), marginTop: 10 }} onClick={() => { onClose(); openClass(cls.id); }}>Open the class</button>}
    </>}
  </Dialog>;
}

// ---------------------------------------------------------------- reports
function Reports({ home, toast }) {
  const [q, setQ] = useState({ periodId: home.current || "", grade: "", subject: "" }), [d, setD] = useState(null), [error, setError] = useState("");
  const qs = `periodId=${encodeURIComponent(q.periodId)}&grade=${encodeURIComponent(q.grade)}&subject=${encodeURIComponent(q.subject)}`;
  useEffect(() => { setD(null); call(`/report?${qs}`).then(setD, e => setError(e.message)); }, [qs]);
  const sel = (k, opts, all, aria) => <select aria-label={aria} style={{ ...inputStyle, width: "auto" }} value={q[k]} onChange={e => setQ(x => ({ ...x, [k]: e.target.value }))}><option value="">{all}</option>{opts.map(o => <option key={o} value={o}>{o}</option>)}</select>;
  const dist = (r, letters) => letters.map(l => `${l} ${r.letters[l] || 0}`).join(" · ");
  const print = () => printHtml("Grade report", `<h1>Grade report</h1><div class="sub">${esc(BRAND.org)} · ${esc(d.period ? d.period.name : "Whole year")}${q.grade ? ` · Grade ${esc(q.grade)}` : ""}${q.subject ? ` · ${esc(q.subject)}` : ""} · printed ${new Date().toLocaleDateString()}</div>
    <h2>By grade level and subject</h2><table><tr><th>Grade</th><th>Subject</th><th class="num">Classes</th><th class="num">Students</th><th class="num">Average</th><th class="num">Median</th><th class="num">Below passing</th><th>Letter grades</th></tr>
    ${d.groups.map(g => `<tr><td>${esc(g.gradeLevel)}</td><td>${esc(g.subject)}</td><td class="num">${g.classes}</td><td class="num">${g.students}</td><td class="num">${g.average ?? "—"}% ${esc(g.averageLetter)}</td><td class="num">${g.median ?? "—"}%</td><td class="num">${g.failing}</td><td>${esc(dist(g, d.letters))}</td></tr>`).join("")}</table>
    <h2>By class</h2><table><tr><th>Class</th><th>Teacher</th><th class="num">Students</th><th class="num">Average</th><th class="num">Below passing</th><th>Letter grades</th></tr>
    ${d.classes.map(c => `<tr><td>${esc(c.name)}${c.section ? ` (${esc(c.section)})` : ""}</td><td>${esc(c.teachers.join(", "))}</td><td class="num">${c.students}</td><td class="num">${c.average ?? "—"}% ${esc(c.averageLetter)}</td><td class="num">${c.failing}</td><td>${esc(dist(c, d.letters))}</td></tr>`).join("")}</table>`);
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {periodSelect(home.periods, q.periodId, v => setQ(x => ({ ...x, periodId: v })), "Report grading period")}
      {sel("grade", d?.gradeLevels || [], "Every grade", "Grade level")}{sel("subject", d?.subjects || [], "Every subject", "Subject")}
      <span style={{ flex: 1 }} />
      <a href={`/api/gradebook/report.csv?${qs}`} style={{ ...btn("outline"), textDecoration: "none" }}><Download size={14} /> Spreadsheet (CSV)</a>
      <button type="button" style={btn("outline")} disabled={!d} onClick={print}><Printer size={14} /> Print</button>
    </div>
    {error && <div role="alert" style={{ ...cardStyle, color: RED }}>{error}</div>}
    {!d && !error && <div style={{ color: SOFT }}>Loading…</div>}
    {d && <>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }} role="region" aria-label="By grade level and subject">
        <div style={{ padding: "10px 12px 4px", fontWeight: 800 }}>By grade level and subject</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr>{["Grade", "Subject", "Classes", "Students", "Average", "Median", "Below passing", "Letter grades"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{d.groups.map(g => <tr key={g.gradeLevel + g.subject}><td style={td}>{g.gradeLevel || "—"}</td><td style={td}>{g.subject || "—"}</td><td style={td}>{g.classes}</td><td style={td}>{g.students}</td>
            <td style={{ ...td, fontWeight: 700, color: gColor(g.average, d.passing) }}>{g.average == null ? "—" : `${g.average}% ${g.averageLetter}`}</td><td style={td}>{g.median == null ? "—" : `${g.median}%`}</td>
            <td style={{ ...td, color: g.failing ? RED : INK, fontWeight: g.failing ? 700 : 400 }}>{g.failing}</td><td style={{ ...td, fontSize: 12.5, color: SOFT }}>{dist(g, d.letters)}</td></tr>)}</tbody></table>
        {!d.groups.length && <div style={{ padding: 14, color: SOFT }}>No classes match.</div>}
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }} role="region" aria-label="By class">
        <div style={{ padding: "10px 12px 4px", fontWeight: 800 }}>By class</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr>{["Class", "Grade", "Subject", "Teacher", "Students", "Average", "Below passing", "Letter grades"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{d.classes.map(c => <tr key={c.id}><td style={td}>{c.name}{c.section ? <span style={{ color: SOFT }}> · {c.section}</span> : null}</td><td style={td}>{c.gradeLevel}</td><td style={td}>{c.subject}</td><td style={td}>{c.teachers.join(", ")}</td>
            <td style={td}>{c.students}</td><td style={{ ...td, fontWeight: 700, color: gColor(c.average, d.passing) }}>{c.average == null ? "—" : `${c.average}% ${c.averageLetter}`}</td>
            <td style={{ ...td, color: c.failing ? RED : INK }}>{c.failing}</td><td style={{ ...td, fontSize: 12.5, color: SOFT }}>{dist(c, d.letters)}</td></tr>)}</tbody></table>
      </div>
      <div style={{ fontSize: 12.5, color: SOFT }}>Below passing = under {d.passing}%. Averages are of each student's grade in the class (assignments shown to students only).</div>
    </>}
  </div>;
}

// ---------------------------------------------------------------- setup (Gradebook manage)
function ScaleEditor({ value, onSave }) {
  const [rows, setRows] = useState(() => value.map(r => ({ ...r, min: String(r.min) })));
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return <div>
    <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
      <button type="button" style={btn("outline")} onClick={() => setRows(DEFAULT_SCALE.map(r => ({ ...r, min: String(r.min) })))}>A–F (10-point)</button>
      <button type="button" style={btn("outline")} onClick={() => setRows(PLUS_MINUS_SCALE.map(r => ({ ...r, min: String(r.min) })))}>With + and −</button></div>
    {rows.map((r, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
      <input aria-label={`Letter ${i + 1}`} style={inputStyle} value={r.letter} onChange={e => set(i, "letter", e.target.value)} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: SOFT }}>at least <input aria-label={`Letter ${i + 1} minimum`} inputMode="decimal" style={{ ...inputStyle, width: 90, textAlign: "right" }} value={r.min} onChange={e => set(i, "min", e.target.value)} />%</div>
      <button type="button" aria-label={`Remove letter ${i + 1}`} style={btn("ghost")} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}><Trash2 size={14} /></button></div>)}
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button type="button" style={btn("outline")} onClick={() => setRows(rs => [...rs, { letter: "", min: "0" }])}><Plus size={14} /> Add letter</button>
      <span style={{ flex: 1 }} /><button type="button" style={btn("primary")} onClick={() => onSave(cleanScale(rows.map(r => ({ letter: r.letter, min: Number(r.min) }))))}>Save letter scale</button></div>
    <div style={{ fontSize: 12.5, color: SOFT, marginTop: 6 }}>The lowest letter always starts at 0, so every grade gets one.</div>
  </div>;
}
function Periods({ home, setHome, toast }) {
  const [f, setF] = useState(null);
  const save = async () => { try { const r = await call("/periods", f); setHome(h => ({ ...h, periods: r.periods })); setF(null); toast("Grading period saved."); } catch (e) { toast(e.message); } };
  const remove = async p => { if (!window.confirm(`Remove ${p.name}? Assignments put in it go back to counting by due date.`)) return; try { const r = await call(`/periods/${p.id}/remove`, {}); setHome(h => ({ ...h, periods: r.periods })); } catch (e) { toast(e.message); } };
  return <div>
    {home.periods.map(p => <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
      <b style={{ minWidth: 120 }}>{p.name}</b><span style={{ color: SOFT, flex: 1 }}>{pretty(p.starts)} – {pretty(p.ends)}{p.schoolYear ? ` · ${p.schoolYear}` : ""}</span>
      <button type="button" style={btn("ghost")} onClick={() => setF(p)}>Edit</button><button type="button" style={{ ...btn("ghost"), color: RED }} onClick={() => remove(p)}>Remove</button></div>)}
    {!home.periods.length && <div style={{ color: SOFT, fontSize: 14 }}>No grading periods yet: grades show for the whole year until you add them.</div>}
    {f ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, alignItems: "end", marginTop: 10 }}>
      <label><span style={label}>Name</span><input aria-label="Period name" style={inputStyle} value={f.name} placeholder="Quarter 1" onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></label>
      <label><span style={label}>Starts</span><input type="date" aria-label="Period starts" style={inputStyle} value={f.starts} onChange={e => setF(x => ({ ...x, starts: e.target.value }))} /></label>
      <label><span style={label}>Ends</span><input type="date" aria-label="Period ends" style={inputStyle} value={f.ends} onChange={e => setF(x => ({ ...x, ends: e.target.value }))} /></label>
      <div style={{ display: "flex", gap: 6 }}><button type="button" style={btn("primary")} onClick={save}>Save period</button><button type="button" style={btn("outline")} onClick={() => setF(null)}>Cancel</button></div></div>
      : <button type="button" style={{ ...btn("outline"), marginTop: 10 }} onClick={() => setF({ name: "", starts: "", ends: "", schoolYear: home.settings.schoolYear })}><Plus size={14} /> Add grading period</button>}
  </div>;
}
function Setup({ home, setHome, toast }) {
  const s = home.settings;
  const save = async patch => { try { const r = await call("/settings", { ...s, ...patch }); setHome(h => ({ ...h, settings: r.settings })); toast("Saved."); } catch (e) { toast(e.message); } };
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={cardStyle}><div style={{ fontWeight: 800, marginBottom: 10 }}>School year and rules</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <label><span style={label}>School year</span><input aria-label="School year" style={inputStyle} defaultValue={s.schoolYear} placeholder="2026-27" onBlur={e => e.target.value !== s.schoolYear && save({ schoolYear: e.target.value })} /></label>
        <label><span style={label}>Passing grade (%)</span><input aria-label="Passing grade" inputMode="decimal" style={inputStyle} defaultValue={s.passing} onBlur={e => Number(e.target.value) !== s.passing && save({ passing: Number(e.target.value) })} /></label>
        <label><span style={label}>Decimal places shown</span><select aria-label="Decimal places" style={inputStyle} value={s.decimals ?? 1} onChange={e => save({ decimals: Number(e.target.value) })}><option value={0}>None (87%)</option><option value={1}>One (87.4%)</option><option value={2}>Two (87.45%)</option></select></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 14 }}><input type="checkbox" checked={s.missingZero} onChange={e => save({ missingZero: e.target.checked })} /> Missing work counts as zero</label>
    </div>
    <div style={cardStyle}><div style={{ fontWeight: 800, marginBottom: 10 }}>Grading periods</div><Periods home={home} setHome={setHome} toast={toast} /></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
      <div style={cardStyle}><div style={{ fontWeight: 800, marginBottom: 10 }}>Letter scale</div><ScaleEditor value={s.scale} onSave={scale => save({ scale })} /></div>
      <div style={cardStyle}><div style={{ fontWeight: 800, marginBottom: 10 }}>Categories for new classes</div>
        <CategoryEditor value={s.categories} onSave={categories => save({ categories })} saveLabel="Save default categories" note="Teachers can change their own class's categories and weights; this is where new classes start." /></div>
    </div>
  </div>;
}
function ClassDialog({ c, home, onClose, onSaved, toast }) {
  const [f, setF] = useState(() => c ? { ...c, teacherIds: c.teachers.map(t => t.id) } : { name: "", code: "", subject: "", gradeLevel: "", section: "", schoolYear: home.settings.schoolYear, teacherIds: [], active: true });
  const [pick, setPick] = useState("");
  const staff = home.staff || [];
  const save = async () => { try { await call("/classes", { ...f, id: c?.id }); toast(c ? "Class saved." : "Class added."); onSaved(); onClose(); } catch (e) { toast(e.message); } };
  return <Dialog title={c ? `Edit ${c.name}` : "New class"} onClose={onClose}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {[["name", "Class name"], ["code", "Section code"], ["subject", "Subject"], ["gradeLevel", "Grade"], ["section", "Period / block"], ["schoolYear", "School year"]].map(([k, l]) =>
        <label key={k} style={k === "name" ? { gridColumn: "1 / -1" } : null}><span style={label}>{l}</span><input aria-label={l} style={inputStyle} value={f[k] || ""} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} /></label>)}
    </div>
    <div style={{ marginTop: 10 }}><span style={label}>Teachers</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>{f.teacherIds.map(t => <span key={t} style={{ border: `1px solid ${LINE}`, borderRadius: 999, padding: "3px 6px 3px 10px", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
        {staff.find(x => x.id === t)?.name || "Teacher"}<button type="button" aria-label="Remove teacher" style={{ ...btn("ghost"), padding: 2 }} onClick={() => setF(x => ({ ...x, teacherIds: x.teacherIds.filter(y => y !== t) }))}><X size={12} /></button></span>)}</div>
      <select aria-label="Add a teacher" style={inputStyle} value={pick} onChange={e => { const v = e.target.value; if (v) setF(x => ({ ...x, teacherIds: [...new Set([...x.teacherIds, v])] })); setPick(""); }}>
        <option value="">Add a teacher…</option>{staff.filter(p => !f.teacherIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` (${p.job_title})` : ""}</option>)}</select></div>
    {c && <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14 }}><input type="checkbox" checked={f.active} onChange={e => setF(x => ({ ...x, active: e.target.checked }))} /> Active (unchecked = archived; grades are kept)</label>}
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}><button type="button" style={btn("primary")} onClick={save}>{c ? "Save class" : "Add class"}</button><button type="button" style={btn("outline")} onClick={onClose}>Cancel</button></div>
  </Dialog>;
}
function ImportRosters({ toast, reload }) {
  const [file, setFile] = useState(null), [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [done, setDone] = useState(null);
  const run = async (prev) => {
    setBusy(true);
    try { const r = await call("/import", { fileName: file.name, data: await toBase64(file), preview: prev }); if (prev) setPreview(r); else { setDone(r); setPreview(null); setFile(null); toast("Rosters imported."); reload(); } }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={cardStyle}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Import class rosters</div>
      <div style={{ fontSize: 14, color: SOFT, marginBottom: 10, lineHeight: 1.5 }}>A class list exported from your student information system (CSV or Excel), one row per student per class. Columns it understands:
        <b> Class</b> or <b>Class code</b>, <b>Teacher</b> (name or email), <b>Student ID</b>, <b>Student</b> (or First name / Last name), <b>Grade</b>, and optionally Subject, Period, Student email,
        Guardian name / Guardian email (and Guardian 2). Running it again adds new students and enrollments and never removes anyone.</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="file" aria-label="Roster file" accept=".csv,.xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setDone(null); }} />
        <button type="button" style={btn("primary")} disabled={!file || busy} onClick={() => run(true)}><Upload size={14} /> {busy && !preview ? "Reading…" : "Check the file"}</button></div>
    </div>
    {preview && <div style={cardStyle} role="region" aria-label="Import preview">
      <div style={{ fontWeight: 800, marginBottom: 8 }}>What this will do{preview.schoolYear ? ` (school year ${preview.schoolYear})` : ""}</div>
      <ul style={{ margin: "0 0 10px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>{preview.classes.new} new classes, {preview.classes.existing} already here</li>
        <li>{preview.students.new} new students, {preview.students.existing} already here</li>
        <li>{preview.enrollments} students added to classes</li>
        <li>{preview.guardians.new} new parent / guardian sign-ins, {preview.guardians.links} links to students (no email goes out until you send sign-in links)</li></ul>
      {preview.teachersMissing.length > 0 && <div style={{ color: AMBER, fontSize: 14, marginBottom: 8 }}>No staff account matched these teachers, so their classes won't have a teacher yet: {preview.teachersMissing.join(", ")}. Teachers need an approved account first (same email or name).</div>}
      {preview.problems.length > 0 && <div style={{ color: RED, fontSize: 13.5, marginBottom: 8 }}>{preview.problems.slice(0, 8).map((p, i) => <div key={i}>Row {p.row}: {p.text}</div>)}{preview.problems.length > 8 ? <div>and {preview.problems.length - 8} more</div> : null}</div>}
      <div style={{ overflowX: "auto", marginBottom: 10 }}><table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr>{["Class", "Period", "Subject", "Grade", "Teacher", "Students", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{preview.sample.map((c, i) => <tr key={i}><td style={td}>{c.name}{c.code ? <span style={{ color: SOFT }}> · {c.code}</span> : null}</td><td style={td}>{c.section}</td><td style={td}>{c.subject}</td><td style={td}>{c.gradeLevel}</td>
          <td style={td}>{c.teachers.join(", ") || <span style={{ color: AMBER }}>none matched</span>}</td><td style={td}>{c.students}</td><td style={{ ...td, color: c.status === "new" ? GREEN : SOFT }}>{c.status === "new" ? "New" : "Update"}</td></tr>)}</tbody></table></div>
      <button type="button" style={btn("primary")} disabled={busy} onClick={() => run(false)}><Check size={14} /> {busy ? "Importing…" : "Import"}</button>
    </div>}
    {done && <div role="status" style={{ ...cardStyle, color: GREEN }}>Imported {done.rows} rows: {done.classes.new + done.classes.existing} classes, {done.students.new + done.students.existing} students.</div>}
  </div>;
}
function FamilySignIns({ home, toast }) {
  const [busy, setBusy] = useState(false), [out, setOut] = useState(null);
  const send = async () => {
    if (!window.confirm("Make sign-in links for every student and parent / guardian who hasn't chosen a password yet? Links already sent in the last day are skipped.")) return;
    setBusy(true); try { setOut((await call("/family/invites", { all: true })).invites); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const csv = () => {
    const rows = [["Name", "Email", "Who", "Link"], ...out.map(x => [x.name, x.email, x.kind === "student" ? "Student" : "Parent / guardian", x.link || location.origin + x.path])];
    const blob = new Blob(["﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "family-sign-in-links.csv"; a.click();
  };
  return <div style={{ display: "grid", gap: 12 }}>
    <div style={cardStyle}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>Student and family sign-ins</div>
      <div style={{ fontSize: 14, color: SOFT, lineHeight: 1.5, marginBottom: 10 }}>Students and parents / guardians sign in at <b>{location.origin}/grades</b> with their own accounts (separate from staff accounts). They see only their own student's classes:
        assignments you show, scores, comments, graded work and report-card comments. Add one person at a time on a student's page, or import guardians with the rosters and send everyone their link here.</div>
      {home.stats && <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10, fontSize: 14 }}><span><b>{home.stats.students}</b> students</span><span><b>{home.stats.guardians}</b> parent / guardian sign-ins</span><span><b>{home.stats.signed_up}</b> have chosen a password</span></div>}
      <button type="button" style={btn("primary")} disabled={busy} onClick={send}><Mail size={14} /> {busy ? "Making links…" : "Send sign-in links to everyone who hasn't signed up"}</button>
    </div>
    {out && <div style={cardStyle} role="region" aria-label="Sign-in links">
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{out.length} sign-in link{out.length === 1 ? "" : "s"}</div>
      {out.length > 0 && (out.every(x => x.emailed) ? <div style={{ color: GREEN }}>Emailed to everyone on the list.</div>
        : <div style={{ fontSize: 14, color: SOFT, marginBottom: 8 }}>Email isn't set up on this server, so the links weren't sent. Download them and send them another way (each link works once, for {out[0].days} days).
          <div style={{ marginTop: 8 }}><button type="button" style={btn("outline")} onClick={csv}><Download size={14} /> Download the links (CSV)</button></div></div>)}
    </div>}
  </div>;
}

// ---------------------------------------------------------------- the module
export default function GradebookModule({ onBack, initial }) {
  const [home, setHome] = useState(null), [error, setError] = useState(""), [view, setView] = useState("classes");
  const [classId, setClassId] = useState(initial?.classId || null), [studentId, setStudentId] = useState(initial?.studentId || null), [back, setBack] = useState(null);
  const [msg, setMsg] = useState(""), [filter, setFilter] = useState(""), [editClass, setEditClass] = useState(null);
  const toast = useCallback(m => { setMsg(m); setTimeout(() => setMsg(""), 3200); }, []);
  const load = () => call("").then(setHome, e => setError(e.message));
  useEffect(() => { load(); }, []);
  const classes = home?.classes || [];
  const shown = useMemo(() => { const f = filter.toLowerCase(); return classes.filter(c => !f || [c.name, c.subject, c.section, c.gradeLevel, c.teachers.map(t => t.name).join(" ")].join(" ").toLowerCase().includes(f)); }, [classes, filter]);
  const openClass = id => { setBack({ view, studentId }); setStudentId(null); setClassId(id); };
  const openStudent = id => { setBack({ view, classId }); setClassId(null); setStudentId(id); };
  const goBack = () => { setClassId(back?.classId || null); setStudentId(back?.studentId || null); setBack(null); };
  if (error) return <AppShell section="Gradebook" nav={[]} active="" onNav={() => {}} onHome={onBack}><div role="alert" style={{ ...cardStyle, color: RED }}>{error}</div></AppShell>;
  if (!home) return <AppShell section="Gradebook" nav={[]} active="" onNav={() => {}} onHome={onBack}><div style={{ color: SOFT }}>Loading…</div></AppShell>;
  const nav = [
    { key: "classes", label: home.canView ? "Classes" : "My classes", icon: BookOpen, badge: 0 },
    ...(home.canView || home.teacher ? [{ key: "students", label: "Students", icon: Users }] : []),
    ...(home.canView ? [{ key: "reports", label: "Reports", icon: BarChart3 }] : []),
    ...(home.canManage ? [{ key: "setup", label: "School setup", icon: Settings, group: "Setup" }, { key: "manageclasses", label: "Classes & teachers", icon: ClipboardList, group: "Setup" },
      { key: "import", label: "Import rosters", icon: Upload, group: "Setup" }, { key: "family", label: "Family sign-ins", icon: Mail, group: "Setup" }] : []),
  ];
  const go = k => { setClassId(null); setStudentId(null); setBack(null); setView(k); };
  let body;
  if (classId) body = <ClassView id={classId} toast={toast} openStudent={openStudent} top={<button type="button" style={btn("outline")} onClick={goBack}><ArrowLeft size={14} /> Back</button>} />;
  else if (studentId) body = <StudentView id={studentId} toast={toast} onBack={goBack} openClass={openClass} />;
  else if (view === "classes") body = <div style={{ display: "grid", gap: 12 }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>{home.canView ? "Classes" : "My classes"}</div>
    {classes.length > 8 && <input aria-label="Filter classes" style={{ ...inputStyle, maxWidth: 360 }} placeholder="Filter by class, subject, grade or teacher" value={filter} onChange={e => setFilter(e.target.value)} />}
    {!classes.length ? <div style={{ ...cardStyle, color: SOFT }}>{home.canManage ? "No classes yet. Import the rosters or add classes in Classes & teachers." : "You aren't listed as the teacher of any class yet. The school's gradebook manager sets that up."}</div> :
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>{shown.map(c =>
        <button key={c.id} type="button" onClick={() => openClass(c.id)} style={{ ...cardStyle, margin: 0, textAlign: "left", cursor: "pointer", borderTop: `3px solid ${c.mine ? INK : LINE}`, opacity: c.active ? 1 : 0.6 }}>
          <div style={{ fontWeight: 800, color: INK, fontSize: 16 }}>{c.name}</div>
          <div style={{ fontSize: 13, color: SOFT, marginTop: 2 }}>{[c.section, c.subject, c.gradeLevel && `Grade ${c.gradeLevel}`].filter(Boolean).join(" · ")}</div>
          <div style={{ fontSize: 13, color: SOFT, marginTop: 6 }}>{c.students} student{c.students === 1 ? "" : "s"} · {c.teachers.map(t => t.name).join(", ") || "No teacher"}{c.active ? "" : " · archived"}</div>
        </button>)}</div>}
  </div>;
  else if (view === "students") body = <div style={{ display: "grid", gap: 12 }}>
    <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Students</div>
    <div style={cardStyle}><StudentPicker onPick={s => openStudent(s.id)} placeholder="Type a student's name or ID" />
      <div style={{ fontSize: 12.5, color: SOFT, marginTop: 8 }}>{home.canView ? "Opening a student's grades is logged." : "You'll see their grades for the classes you teach. Opening a student's grades is logged."}</div></div>
  </div>;
  else if (view === "reports") body = <div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Reports</div><Reports home={home} toast={toast} /></div>;
  else if (view === "setup") body = <div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>School setup</div><Setup home={home} setHome={setHome} toast={toast} /></div>;
  else if (view === "manageclasses") body = <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK, flex: 1 }}>Classes & teachers</div>
      <button type="button" style={btn("primary")} onClick={() => setEditClass("new")}><Plus size={14} /> New class</button></div>
    <input aria-label="Filter classes" style={{ ...inputStyle, maxWidth: 360 }} placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
    <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}><table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>{["Class", "Code", "Period", "Subject", "Grade", "Teachers", "Students", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{shown.map(c => <tr key={c.id} style={{ opacity: c.active ? 1 : 0.55 }}><td style={td}>{c.name}</td><td style={td}>{c.code}</td><td style={td}>{c.section}</td><td style={td}>{c.subject}</td><td style={td}>{c.gradeLevel}</td>
        <td style={td}>{c.teachers.map(t => t.name).join(", ") || <span style={{ color: AMBER }}>None</span>}</td><td style={td}>{c.students}</td>
        <td style={{ ...td, textAlign: "right" }}><button type="button" style={btn("ghost")} onClick={() => setEditClass(c)}>Edit</button></td></tr>)}</tbody></table>
      {!shown.length && <div style={{ padding: 14, color: SOFT }}>No classes.</div>}</div>
  </div>;
  else if (view === "import") body = <div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Import rosters</div><ImportRosters toast={toast} reload={load} /></div>;
  else if (view === "family") body = <div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Family sign-ins</div><FamilySignIns home={home} toast={toast} /></div>;
  return <AppShell section="Gradebook" nav={nav} active={classId ? "classes" : studentId ? "students" : view} onNav={go} onHome={onBack}>
    {body}
    {editClass && <ClassDialog c={editClass === "new" ? null : editClass} home={home} onClose={() => setEditClass(null)} onSaved={load} toast={toast} />}
    {msg && <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600, zIndex: 70 }}>{msg}</div>}
  </AppShell>;
}
