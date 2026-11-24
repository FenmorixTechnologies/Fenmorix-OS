// Forms: fill out forms, see what's waiting for you, follow cases (injury reports).
import AppShell from "./AppShell.jsx";
import { Inbox, Send, ClipboardList, Folder, FileText, Settings } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton, loadShared, printDocument, letterhead } from "./App.jsx";
import { C, FieldInput, PeoplePicker, isVisible, initialValues, missingRequired, visibleValues, displayValue, submissionHtml, formPrintHtml, STATUS_LABEL, STATUS_COLOR, prefillValue } from "./FormFields.jsx";
import FormBuilder from "./FormBuilder.jsx";

export async function formsApi(path, opts = {}) {
  const res = await fetch(`/api/forms${path}`, { ...opts, headers: { "Content-Type": "application/json", "X-SGFD": "1", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.reload(); throw new Error("Please sign in again."); }
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}
const post = (path, body) => formsApi(path, { method: "POST", body: JSON.stringify(body || {}) });
const when = iso => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const day = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

export function statusText(s) {
  if (s.stage && s.status !== "denied") return s.stage;
  if (s.status === "submitted" && s.reviewed) return "Reviewed";
  return STATUS_LABEL[s.status] || s.status;
}
function StatusChip({ status, stage, reviewed }) {
  const color = (stage && status !== "denied") || (reviewed && status === "submitted") ? C.SAGE : (STATUS_COLOR[status] || C.INK_SOFT);
  const text = statusText({ status, stage, reviewed });
  return <span style={{ fontSize: 12, fontWeight: 700, color, border: `1.5px solid ${color}`, background: `${color}12`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{text}</span>;
}

// Yearly limits (e.g. uniform items): same counting as the server's countLimit
function countLimit(limit, data) {
  let n = 0;
  for (const c of limit.count || []) {
    const v = data?.[c.field];
    const on = Array.isArray(v) ? v.includes(c.option) : v === c.option;
    if (on) n += c.qty ? (Number(data[c.qty]) || 0) : 1;
  }
  return n;
}
function LimitsPanel({ def, values }) {
  const [used, setUsed] = useState(null);
  useEffect(() => { formsApi(`/limits/${def.key}`).then(r => setUsed(r.limits), () => setUsed([])); }, [def.key]);
  if (!used || !used.length) return null;
  return (
    <div style={{ margin: "14px 0 4px", padding: "10px 14px", background: C.PAPER, borderRadius: 7 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Your yearly limits ({new Date().getFullYear()})</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {used.map(l => {
          const now = countLimit((def.settings.limits || []).find(x => x.label === l.label) || {}, values);
          const total = l.used + now, over = total > l.max;
          return (
            <span key={l.label} style={{ fontSize: 13, padding: "4px 10px", borderRadius: 999, background: "#fff", border: `1px solid ${over ? C.BRICK : C.LINE}`, color: over ? C.BRICK : C.INK, fontWeight: over ? 700 : 500 }}>
              {l.label}: {total} of {l.max}{now ? ` (${now} on this request)` : ""}
            </span>
          );
        })}
      </div>
      {used.some(l => l.used + countLimit((def.settings.limits || []).find(x => x.label === l.label) || {}, values) > l.max) &&
        <div role="status" style={{ fontSize: 12.5, color: C.BRICK, marginTop: 6 }}>This request goes over a yearly limit. You can still send it; it may not be filled.</div>}
    </div>
  );
}

// Room bookings (Facility & Resource Request): is what they picked free?
function BookingPanel({ map, values }) {
  const [rooms, setRooms] = useState(null);
  const [res, setRes] = useState(null);
  useEffect(() => { fetch("/api/bookings/rooms").then(r => r.json()).then(r => setRooms(r.rooms || []), () => setRooms([])); }, []);
  const picked = (Array.isArray(values[map.rooms]) ? values[map.rooms] : [values[map.rooms]]).filter(r => rooms?.includes(r));
  const from = values[map.startDate], to = values[map.endDate] || from, start = values[map.startTime], end = values[map.endTime];
  const ready = picked.length && from && start && end && end > start && (!to || to >= from);
  const q = ready ? new URLSearchParams({ rooms: picked.join("|"), from, to, start, end }).toString() : "";
  useEffect(() => {
    if (!q) { setRes(null); return; }
    const t = setTimeout(() => fetch(`/api/bookings/check?${q}`).then(r => r.json()).then(r => setRes(r.conflicts || []), () => setRes(null)), 350);
    return () => clearTimeout(t);
  }, [q]);
  if (!rooms) return null;
  const pretty = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <div role="status" aria-label="Room availability" style={{ margin: "14px 0 4px", padding: "10px 14px", background: res?.length ? "#FDECEE" : C.PAPER, borderRadius: 7, fontSize: 13 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Room availability</div>
      {!ready && <span style={{ color: C.INK_SOFT }}>Pick the dates, start and end times, and a room to see if it's free. Rooms are held for you as soon as you submit.</span>}
      {ready && res === null && <span style={{ color: C.INK_SOFT }}>Checking…</span>}
      {ready && res?.length === 0 && <span style={{ color: C.SAGE, fontWeight: 600 }}>✓ {picked.join(", ")} {picked.length > 1 ? "are" : "is"} free then.</span>}
      {ready && res?.length > 0 && (
        <div style={{ color: C.BRICK }}>
          <b>Already booked:</b>
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
            {res.slice(0, 8).map((c, i) => <li key={i}>{c.room}, {pretty(c.day)} {c.start}–{c.end}: {c.title}{c.contact ? ` (${c.contact})` : ""}</li>)}
          </ul>
          <div style={{ marginTop: 4, color: C.INK }}>Pick another room or time. The form can't be sent while a room is taken.</div>
        </div>
      )}
    </div>
  );
}

// Progress steps on a submitted form (e.g. Ordered → Ready for pickup → Picked up)
function ProgressPanel({ sub, onSet }) {
  const [step, setStep] = useState(sub.stage || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const idx = sub.stages.findIndex(x => x.label === sub.stage);
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", background: C.PAPER, borderRadius: 7 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>Progress</div>
      <ol style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
        <li style={{ fontSize: 13, padding: "4px 10px", borderRadius: 999, background: "#fff", border: `1px solid ${C.SAGE}`, color: C.SAGE, fontWeight: 600 }}>✓ Submitted</li>
        {sub.stages.map((x, i) => {
          const done = i <= idx;
          return <li key={x.label} aria-current={i === idx ? "step" : undefined} style={{ fontSize: 13, padding: "4px 10px", borderRadius: 999, background: done ? C.SAGE : "#fff", color: done ? "#fff" : C.INK_SOFT, border: `1px solid ${done ? C.SAGE : C.LINE}`, fontWeight: i === idx ? 700 : 500 }}>{done ? "✓ " : ""}{x.label}</li>;
        })}
      </ol>
      {sub.stage && (
        <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginTop: 8 }}>
          {sub.stage} · {when(sub.stageAt)}{sub.stageByName ? ` · ${sub.stageByName}` : ""}
          {sub.stageNote && <div style={{ color: C.INK, marginTop: 3 }}>“{sub.stageNote}”</div>}
        </div>
      )}
      {sub.canSetStage && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select aria-label="Progress step" style={{ ...inputStyle, width: "auto", minWidth: 180 }} value={step} onChange={e => setStep(e.target.value)}>
            <option value="">Not started</option>
            {sub.stages.map(x => <option key={x.label} value={x.label}>{x.label}{x.notify ? " (tells them)" : ""}</option>)}
          </select>
          <input aria-label="Progress note" style={{ ...inputStyle, flex: "1 1 220px" }} placeholder="Note for them (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <button style={btn("primary")} disabled={busy || (step === (sub.stage || "") && !note)}
            onClick={async () => { setBusy(true); try { await onSet(step, note); setNote(""); } finally { setBusy(false); } }}>Update</button>
        </div>
      )}
    </div>
  );
}
function Row({ title, sub, right, onClick, label }) {
  return (
    <div role="button" aria-label={label || title} onClick={onClick} style={{ ...cardStyle, padding: "11px 16px", marginBottom: 8, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------
// Filling out a form
// ---------------------------------------------------------------------
export function FormFill({ def, me, roster, context, taskId, onDone, onCancel, preview }) {
  const st = def.settings || {};
  const [subjectId, setSubjectId] = useState(me.id);
  const subject = roster.find(u => u.id === subjectId) || me;
  const ctx = { me, subject, context };
  const [values, setValues] = useState(() => initialValues(def.fields, ctx));
  const [touched, setTouched] = useState({});
  const [approvers, setApprovers] = useState([]);
  const [invalid, setInvalid] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Choosing a different person re-fills their details (unless someone already typed over them)
  function chooseSubject(id) {
    setSubjectId(id);
    const subj = roster.find(u => u.id === id) || me;
    setValues(v => {
      const next = { ...v };
      for (const f of def.fields) {
        if (!f.prefill?.startsWith("subject:") || touched[f.key]) continue;
        const p = prefillValue(f.prefill, { me, subject: subj, context });
        if (p === undefined || p === "") delete next[f.key]; else next[f.key] = p;
      }
      return next;
    });
  }
  const set = (k, v) => { setValues(x => ({ ...x, [k]: v })); setTouched(t => ({ ...t, [k]: true })); setInvalid(i => i.filter(x => x !== k)); };

  const shown = visibleValues(def.fields, values);
  const printForm = () => printDocument(def.title, letterhead(def.title) + formPrintHtml(def, values, roster, st.subject === "choose" || st.subject === "self" ? subject.name : context?.subjectName));

  async function submit() {
    const miss = missingRequired(def.fields, values);
    if (st.approval?.enabled && !approvers.length) miss.push("__approvers");
    setInvalid(miss);
    if (miss.length) {
      setError(`Please complete the ${miss.length === 1 ? "highlighted item" : `${miss.length} highlighted items`}.`);
      const el = document.querySelector(`[data-field="${miss[0]}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (preview) { setError("Preview only: nothing was submitted."); return; }
    setBusy(true); setError("");
    // Send only answers to questions that are showing
    const data = {};
    Object.assign(data, visibleValues(def.fields, values));
    try {
      const r = await post("/submit", { formKey: def.key, subjectId: st.subject === "choose" ? subjectId : undefined, data, approverIds: approvers, taskId });
      onDone(r);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ ...cardStyle, borderTop: `4px solid ${C.BRICK}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.INK }}>{def.title}</div>
          <button style={btn("outline")} onClick={printForm} title="Prints what's filled in so far, with blanks for the rest">Print / save as PDF</button>
        </div>
        {def.description && <div style={{ fontSize: 13.5, color: C.INK_SOFT, marginTop: 4, whiteSpace: "pre-wrap" }}>{def.description}</div>}
        {context?.subjectName && (
          <div style={{ fontSize: 13, background: C.PAPER, borderRadius: 6, padding: "8px 12px", marginTop: 10 }}>
            For the case: <b>{context.subjectName}</b>{context.date ? `, ${day(context.date)}` : ""}{context.time ? ` at ${context.time}` : ""}{context.location ? ` — ${context.location}` : ""}
          </div>
        )}
        {st.anonymous && <div style={{ fontSize: 13, color: C.SAGE, fontWeight: 600, marginTop: 10 }}>This form is anonymous: your name is not recorded with it.</div>}
        {st.subject === "choose" && (
          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", fontSize: 13.5, fontWeight: 600, marginBottom: 5 }}>{st.subjectLabel || "Who is this form about?"}</label>
            <select aria-label={st.subjectLabel || "Who is this form about?"} style={{ ...inputStyle, maxWidth: 360 }} value={subjectId} onChange={e => chooseSubject(e.target.value)}>
              {[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(u => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (me)` : u.name}</option>)}
            </select>
            <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 4 }}>It's filed in this person's personnel file.</div>
          </div>
        )}
        {st.limits?.length > 0 && <LimitsPanel def={def} values={shown} />}
        {def.fields.map(f => isVisible(f, shown) && (
          <FieldInput key={f.key} f={f} value={values[f.key]} onChange={v => set(f.key, v)} roster={roster} invalid={invalid.includes(f.key)} />
        ))}
        {st.booking && <BookingPanel map={st.booking} values={shown} />}
        {st.approval?.enabled && (
          <div style={{ margin: "18px 0 6px", padding: "12px 14px", background: C.PAPER, borderRadius: 7 }} data-field="__approvers">
            <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{st.approval.label || "Approver"}<span aria-hidden="true" style={{ color: C.BRICK }}> *</span></div>
            <div style={{ fontSize: 12, color: C.INK_SOFT, marginBottom: 8 }}>{st.approval.help || "They'll be asked to approve or deny this."}</div>
            <PeoplePicker roster={roster} value={approvers} onChange={v => { setApprovers(v); setInvalid(i => i.filter(x => x !== "__approvers")); }} exclude={[me.id]} label={st.approval.label || "Approver"} />
            {invalid.includes("__approvers") && <div style={{ fontSize: 12, color: C.BRICK, marginTop: 4 }}>Choose who approves this.</div>}
          </div>
        )}
        {error && <div role="alert" style={{ color: C.BRICK, fontWeight: 600, fontSize: 13.5, marginTop: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button style={btn("primary")} onClick={submit} disabled={busy}>{busy ? "Submitting…" : preview ? "Check (preview)" : "Submit"}</button>
          <button style={btn("ghost")} onClick={onCancel}>{preview ? "Close preview" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// A submitted form
// ---------------------------------------------------------------------
export function SubmissionView({ id, me, roster, onBack, onOpenCase, onChanged }) {
  const [sub, setSub] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const load = () => formsApi(`/submissions/${id}`).then(r => setSub(r.submission), e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error) return <div style={cardStyle}><button style={btn("ghost")} onClick={onBack}>‹ Back</button><div style={{ color: C.BRICK, marginTop: 8 }}>{error}</div></div>;
  if (!sub) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;

  const myApproval = sub.approvals.find(a => a.userId === me.id && a.decision === "pending");
  const reviewedByMe = sub.reviews.some(r => r.userId === me.id);
  async function decide(decision) {
    try { await post(`/submissions/${id}/decision`, { decision, note }); setNote(""); await load(); onChanged && onChanged(); } catch (e) { setError(e.message); }
  }
  async function review() {
    try { await post(`/submissions/${id}/review`, { note }); setNote(""); await load(); onChanged && onChanged(); } catch (e) { setError(e.message); }
  }
  const print = () => printDocument(sub.formTitle, letterhead(sub.formTitle) + submissionHtml(sub, roster));
  async function setStage(stage, n) {
    try { await post(`/submissions/${id}/stage`, { stage, note: n }); await load(); onChanged && onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}>‹ Back</button>
      <div style={{ ...cardStyle, marginTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{sub.formTitle}</div>
            <div style={{ fontSize: 13, color: C.INK_SOFT, marginTop: 3 }}>
              {sub.subjectName && <>About <b style={{ color: C.INK }}>{sub.subjectName}</b> · </>}
              {sub.anonymous ? "Submitted anonymously" : <>Submitted by {sub.submittedByName}</>} · {when(sub.submittedAt)}
            </div>
            {sub.caseId && onOpenCase && <button style={{ ...btn("ghost"), paddingLeft: 0, fontSize: 13 }} onClick={() => onOpenCase(sub.caseId)}>Part of a case: open the case ›</button>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <StatusChip status={sub.status} stage={sub.stage} />
            <button style={btn("outline")} onClick={print}>Print / save as PDF</button>
            {sub.hasPdf && sub.access === "full" && <a href={`/api/forms/submissions/${id}/pdf`} style={{ ...btn("primary"), textDecoration: "none" }}>Download official PDF</a>}
          </div>
        </div>
        {sub.access !== "full" && sub.fields.some(f => f.type === "ssn" || f.sensitive) && (
          <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 8 }}>Sensitive details are partly hidden.</div>
        )}

        {sub.stages?.length > 0 && <ProgressPanel key={`${sub.stage}|${sub.stageAt}`} sub={sub} onSet={setStage} />}

        {(myApproval || (sub.canReview && !reviewedByMe && !sub.stages?.length)) && (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "#FFF8EC", border: `1px solid ${C.AMBER}55`, borderRadius: 7 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{myApproval ? "This is waiting for your approval." : sub.isRecipient ? "You're a required recipient of this form." : "Mark this reviewed when you've gone over it."}</div>
            <textarea aria-label="Note" style={{ ...inputStyle, minHeight: 50 }} placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {myApproval ? (
                <>
                  <button style={btn("primary")} onClick={() => decide("approved")}>Approve</button>
                  <button style={{ ...btn("outline"), color: C.BRICK }} onClick={() => decide("denied")}>Deny</button>
                </>
              ) : <button style={btn("primary")} onClick={review}>Mark reviewed</button>}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          {sub.fields.map(f => {
            if (!isVisible(f, sub.data)) return null;
            if (f.type === "heading") return <div key={f.key} style={{ fontSize: 14.5, fontWeight: 700, borderBottom: `2px solid ${C.BRICK}`, paddingBottom: 3, margin: "18px 0 4px" }}>{f.label}</div>;
            if (f.type === "paragraph") return <div key={f.key} style={{ fontSize: 13, color: C.INK_SOFT, margin: "6px 0" }}>{f.label}</div>;
            const v = sub.data[f.key];
            return (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 40%) 1fr", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.LINE}`, fontSize: 13.5 }}>
                <div style={{ color: C.INK_SOFT }}>{f.label}</div>
                <div style={{ whiteSpace: "pre-wrap", fontWeight: 500 }}>
                  {f.type === "signature" ? (v ? <img src={v} alt="Signature" style={{ height: 60, border: `1px solid ${C.LINE}`, borderRadius: 4, background: "#fff" }} /> : "")
                    : f.type === "file" && Array.isArray(v) && v.length ? v.map(x => <div key={x.id}><a href={`/api/forms/files/${x.id}`} target="_blank" rel="noreferrer" style={{ color: C.INK }}>{x.name}</a></div>)
                    : (displayValue(f, v, roster) || <span style={{ color: "#9AA3B2" }}>—</span>)}
                </div>
              </div>
            );
          })}
        </div>

        {(sub.approvals.length > 0 || sub.reviews.length > 0) && (
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {sub.approvals.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Approvals</div>
                {sub.approvals.map(a => (
                  <div key={a.userId} style={{ fontSize: 13, padding: "4px 0" }}>
                    <b>{a.name}</b>: <span style={{ color: a.decision === "approved" ? C.SAGE : a.decision === "denied" ? C.BRICK : C.AMBER, fontWeight: 600 }}>{a.decision}</span>
                    {a.decidedAt && <span style={{ color: C.INK_SOFT }}> · {when(a.decidedAt)}</span>}{a.note && <div style={{ color: C.INK_SOFT }}>“{a.note}”</div>}
                  </div>
                ))}
              </div>
            )}
            {sub.reviews.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Reviewed by</div>
                {sub.reviews.map(r => (
                  <div key={r.userId} style={{ fontSize: 13, padding: "4px 0" }}><b>{r.name}</b> · {when(r.reviewedAt)}{r.note && <div style={{ color: C.INK_SOFT }}>“{r.note}”</div>}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// A case (e.g. an injury): its parts, who still owes what, the packet
// ---------------------------------------------------------------------
export function CaseView({ id, me, roster, onBack, onOpenSubmission, onFillTask }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(null);   // { form, assigneeId, assigneeName }
  const load = () => formsApi(`/cases/${id}`).then(setData, e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error && !data) return <div style={cardStyle}><button style={btn("ghost")} onClick={onBack}>‹ Back</button><div style={{ color: C.BRICK, marginTop: 8 }}>{error}</div></div>;
  if (!data) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  const cs = data.case;
  const act = async (fn) => { try { setError(""); await fn(); await load(); } catch (e) { setError(e.message); } };

  async function printPacket() {
    const parts = [];
    for (const s of data.submissions) parts.push((await formsApi(`/submissions/${s.id}`)).submission);
    const html = letterhead(cs.title) +
      `<p style="font-size:12px">Opened ${when(cs.openedAt)} by ${cs.openedBy} · ${cs.status === "closed" ? "Closed" : "Open"}</p>` +
      parts.map((p, i) => `<div style="${i ? "page-break-before:always;" : ""}">${submissionHtml(p, roster)}</div>`).join("");
    printDocument(cs.title, html);
  }
  const statusColor = { pending: C.AMBER, done: C.SAGE, cancelled: C.INK_SOFT };

  return (
    <div style={{ maxWidth: 1000 }}>
      <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}>‹ Back</button>
      <div style={{ ...cardStyle, marginTop: 6, borderTop: `4px solid ${C.BRICK}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>{cs.title}</div>
            <div style={{ fontSize: 13, color: C.INK_SOFT, marginTop: 3 }}>
              {cs.summary.date && <>{day(cs.summary.date)}{cs.summary.time ? ` at ${cs.summary.time}` : ""} · </>}{cs.summary.location && <>{cs.summary.location} · </>}
              Opened {when(cs.openedAt)} by {cs.openedBy}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: cs.status === "open" ? C.AMBER : C.SAGE, border: `1.5px solid currentColor`, borderRadius: 999, padding: "2px 9px" }}>{cs.status === "open" ? "Open" : "Closed"}</span>
            {data.submissions.length > 0 && <button style={btn("outline")} onClick={printPacket}>Print case packet</button>}
            {cs.canManage && <button style={btn("ghost")} onClick={() => act(() => post(`/cases/${id}/status`, { status: cs.status === "open" ? "closed" : "open" }))}>{cs.status === "open" ? "Close case" : "Reopen"}</button>}
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, margin: "18px 0 6px" }}>Parts of this case</div>
        {data.submissions.filter(s => !data.tasks.some(t => t.submissionId === s.id)).map(s => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.LINE}`, fontSize: 13.5, flexWrap: "wrap" }}>
            <span style={{ color: C.SAGE, fontWeight: 700, width: 70 }}>Done</span>
            <span style={{ flex: 1, minWidth: 200 }}><b>{s.formTitle}</b> <span style={{ color: C.INK_SOFT }}>· {s.submittedByName} · {when(s.submittedAt)}</span></span>
            <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => onOpenSubmission(s.id)}>View</button>
          </div>
        ))}
        {data.tasks.map(t => (
          <TaskLine key={t.id} t={t} me={me} roster={roster} canManage={cs.canManage} statusColor={statusColor}
            submissions={data.submissions} onOpenSubmission={onOpenSubmission} onFill={() => onFillTask(t.id)}
            onReassign={(assigneeId, assigneeName) => act(() => post(`/tasks/${t.id}`, { assigneeId, assigneeName }))}
            onCancel={() => window.confirm(`Cancel "${t.label}"?`) && act(() => post(`/tasks/${t.id}`, { cancel: true }))} />
        ))}

        {cs.canManage && cs.status === "open" && (
          adding ? (
            <div style={{ marginTop: 12, padding: "12px 14px", background: C.PAPER, borderRadius: 7, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ fontSize: 12, color: C.INK_SOFT }}>Form<br />
                <select aria-label="Form to request" style={{ ...inputStyle, width: "auto" }} value={adding.form} onChange={e => setAdding(a => ({ ...a, form: e.target.value }))}>
                  {cs.followUps.map(f => <option key={f.form} value={f.form}>{f.label}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12, color: C.INK_SOFT }}>From<br />
                <select aria-label="Request from" style={{ ...inputStyle, width: "auto", minWidth: 220 }} value={adding.assigneeId} onChange={e => setAdding(a => ({ ...a, assigneeId: e.target.value }))}>
                  <option value="">Someone not on the roster…</option>
                  {[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </label>
              {!adding.assigneeId && (
                <label style={{ fontSize: 12, color: C.INK_SOFT }}>Their name<br />
                  <input aria-label="Their name" style={{ ...inputStyle, width: 200 }} value={adding.assigneeName} onChange={e => setAdding(a => ({ ...a, assigneeName: e.target.value }))} />
                </label>
              )}
              <button style={btn("primary")} onClick={() => act(async () => { await post(`/cases/${id}/tasks`, { formKey: adding.form, assigneeId: adding.assigneeId || null, assigneeName: adding.assigneeName }); setAdding(null); })}>Request</button>
              <button style={btn("ghost")} onClick={() => setAdding(null)}>Cancel</button>
              <div style={{ fontSize: 12, color: C.INK_SOFT, width: "100%" }}>For someone not on the roster, you can fill in their statement yourself from their paper copy.</div>
            </div>
          ) : (
            <button style={{ ...btn("outline"), marginTop: 12 }} onClick={() => setAdding({ form: cs.followUps[0]?.form || "", assigneeId: "", assigneeName: "" })}>+ Request another statement</button>
          )
        )}
        {error && <div style={{ color: C.BRICK, fontSize: 13, marginTop: 10 }}>{error}</div>}
      </div>
    </div>
  );
}

function TaskLine({ t, me, roster, canManage, statusColor, submissions, onOpenSubmission, onFill, onReassign, onCancel }) {
  const [editing, setEditing] = useState(false);
  const [who, setWho] = useState(t.assignedTo || "");
  const [name, setName] = useState(t.assignedTo ? "" : t.assigneeName);
  const mine = t.assignedTo === me.id;
  const sub = submissions.find(s => s.id === t.submissionId);
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px solid ${C.LINE}`, fontSize: 13.5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: statusColor[t.status], fontWeight: 700, width: 70 }}>{t.status === "pending" ? "Waiting" : t.status === "done" ? "Done" : "Cancelled"}</span>
        <span style={{ flex: 1, minWidth: 200 }}>
          <b>{t.label}</b>{" "}
          <span style={{ color: C.INK_SOFT }}>· {t.assigneeName || "not assigned"}{t.status === "done" && t.completedAt ? ` · ${when(t.completedAt)}` : ""}</span>
        </span>
        {t.status === "done" && sub && <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => onOpenSubmission(sub.id)}>View</button>}
        {t.status === "pending" && (mine || canManage) && (
          <button style={{ ...btn(mine ? "primary" : "outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={onFill}>{mine ? "Fill out" : "Fill out for them"}</button>
        )}
        {t.status === "pending" && canManage && !editing && (
          <>
            <button style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5 }} onClick={() => setEditing(true)}>Reassign</button>
            <button style={{ ...btn("ghost"), padding: "4px 8px", fontSize: 12.5, color: C.BRICK }} onClick={onCancel}>Cancel</button>
          </>
        )}
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", paddingLeft: 80 }}>
          <select aria-label="Reassign to" style={{ ...inputStyle, width: "auto", minWidth: 220 }} value={who} onChange={e => setWho(e.target.value)}>
            <option value="">Not on the roster / unassigned…</option>
            {[...roster].sort((a, b) => a.name.localeCompare(b.name)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {!who && <input aria-label="Name" style={{ ...inputStyle, width: 200 }} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />}
          <button style={btn("primary")} onClick={() => { onReassign(who || null, who ? "" : name); setEditing(false); }}>Save</button>
          <button style={btn("ghost")} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// The Forms section
// ---------------------------------------------------------------------
// Every submission this person can see, with search and filters
function AllSubmissions({ defs, onOpen }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState("");
  const [state, setState] = useState("");
  const [shown, setShown] = useState(50);
  useEffect(() => { formsApi("/submissions").then(r => setList(r.submissions), () => setList([])); }, []);
  if (!list) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  const forms = [...new Set(list.map(s => s.formTitle))].sort();
  const states = [...new Set(list.map(statusText))].sort();
  const needle = q.trim().toLowerCase();
  const rows = list.filter(s => (!form || s.formTitle === form) && (!state || statusText(s) === state) &&
    (!needle || `${s.formTitle} ${s.subjectName} ${s.submittedByName}`.toLowerCase().includes(needle)));
  const sel = { ...inputStyle, width: "auto", minWidth: 170 };
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input type="search" aria-label="Search submissions" placeholder="Search by form or name…" value={q} onChange={e => { setQ(e.target.value); setShown(50); }} style={{ ...inputStyle, maxWidth: 300 }} />
        <select aria-label="Filter by form" style={sel} value={form} onChange={e => { setForm(e.target.value); setShown(50); }}>
          <option value="">All forms</option>{forms.map(f => <option key={f}>{f}</option>)}
        </select>
        <select aria-label="Filter by status" style={sel} value={state} onChange={e => { setState(e.target.value); setShown(50); }}>
          <option value="">Any status</option>{states.map(f => <option key={f}>{f}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginBottom: 8 }}>{rows.length} submission{rows.length === 1 ? "" : "s"}</div>
      {rows.slice(0, shown).map(s => (
        <Row key={s.id} title={s.formTitle} label={`Open ${s.formTitle} from ${s.submittedByName || "Anonymous"}`}
          sub={`${s.submittedByName || "Anonymous"}${s.subjectName && s.subjectName !== s.submittedByName ? ` · about ${s.subjectName}` : ""} · ${when(s.submittedAt)}`}
          onClick={() => onOpen(s.id)} right={<StatusChip status={s.status} stage={s.stage} />} />
      ))}
      {rows.length > shown && <button style={btn("outline")} onClick={() => setShown(n => n + 50)}>Show more</button>}
    </>
  );
}

export default function FormsModule({ onBack, initialTab, initialSubmission }) {
  const [me, setMe] = useState(null);
  const [roster, setRoster] = useState([]);
  const [defs, setDefs] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [inbox, setInbox] = useState(null);
  const [cases, setCases] = useState(null);
  const [tab, setTab] = useState(initialTab || "forms");
  const [category, setCategory] = useState("");
  const [view, setView] = useState(initialSubmission ? { kind: "submission", id: initialSubmission } : null);       // { kind: fill|task|submission|case|build, ... }
  const [myAccess, setMyAccess] = useState([]);
  const [canGrantAccess, setCanGrantAccess] = useState(false);
  const [taskFill, setTaskFill] = useState(null);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");

  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2800); };
  const loadDefs = () => formsApi("/definitions").then(r => { setDefs(r.definitions); setCanManage(r.canManage); setCanGrantAccess(!!r.canGrantAccess); setMyAccess(r.myAccess || []); }, e => setError(e.message));
  const loadInbox = () => formsApi("/inbox").then(setInbox, () => {});
  const loadCases = () => formsApi("/cases").then(r => setCases(r.cases), () => setCases([]));
  useEffect(() => {
    loadDefs(); loadInbox(); loadCases();
    (async () => {
      const r = await loadShared("roster", []);
      let id = null;
      try { const x = await window.storage.get("current-identity", false); id = x ? x.value : null; } catch (e) {}
      setRoster(r); setMe(r.find(u => u.id === id) || null);
    })();
  }, []);
  const refresh = () => { loadInbox(); loadCases(); };

  async function openTask(taskId) {
    try { const r = await formsApi(`/tasks/${taskId}`); setTaskFill(r); setView({ kind: "task", id: taskId }); }
    catch (e) { setError(e.message); }
  }
  const byKey = useMemo(() => new Map((defs || []).map(d => [d.key, d])), [defs]);
  const updates = inbox?.updates || [];
  const waitingCount = inbox ? inbox.tasks.length + inbox.approvals.length + inbox.toReview.length + updates.length : 0;

  if (!me || !defs) return <div style={wrapStyle}><StyleBlock /><div style={{ color: C.INK_SOFT }}>{error || "Loading…"}</div></div>;

  const back = () => { setView(null); refresh(); };
  const handlesSome = canManage || myAccess.length > 0 || defs.some(d => (d.settings?.recipients || []).includes(me.id));
  const allCats = [...new Set(defs.filter(d => d.active && !d.settings?.followUpOnly).map(d => d.category))].sort();
  const shellActive = view ? (view.kind === "fill" ? `cat:${category}` : view.kind === "build" ? "manage" : tab === "forms" ? `cat:${category}` : tab) : tab === "forms" ? `cat:${category}` : tab;
  const shellGo = k => {
    setView(null); refresh(); setSearch("");
    if (k.startsWith("cat:")) { setTab("forms"); setCategory(k.slice(4)); } else setTab(k);
  };
  const shellNav = [
    { key: "waiting", label: "Waiting for me", icon: Inbox, badge: waitingCount },
    { key: "mine", label: "My submissions", icon: Send },
    ...(handlesSome ? [{ key: "all", label: "Submissions", icon: ClipboardList }] : []),
    { key: "cases", label: "Cases", icon: Folder },
    { key: "cat:", label: "All forms", icon: FileText, group: "Fill out a form" },
    ...allCats.map(c => ({ key: `cat:${c}`, label: c, icon: FileText, group: "Fill out a form" })),
    ...(canManage ? [{ key: "manage", label: "Manage forms", icon: Settings, group: "Admin" }] : []),
  ];
  const pageTitle = (shellNav.find(n => n.key === shellActive) || {}).label || "Forms";
  let body;
  if (view?.kind === "fill") {
    body = <FormFill key={view.key} def={byKey.get(view.key)} me={me} roster={roster} onCancel={back}
      onDone={r => { showToast("Submitted"); setView(r.caseId && r.canViewCase ? { kind: "case", id: r.caseId } : { kind: "submission", id: r.id }); refresh(); }} />;
  } else if (view?.kind === "task" && taskFill) {
    body = taskFill.canFill ? (
      <FormFill key={view.id} def={taskFill.definition} me={me} roster={roster} context={taskFill.context} taskId={view.id} onCancel={back}
        onDone={r => { showToast("Submitted. Thank you."); setView(r.canViewCase ? { kind: "case", id: r.caseId } : { kind: "submission", id: r.id }); refresh(); }} />
    ) : <div style={cardStyle}>This task can't be filled out by you. <button style={btn("ghost")} onClick={back}>Back</button></div>;
  } else if (view?.kind === "submission") {
    body = <SubmissionView key={view.id} id={view.id} me={me} roster={roster} onBack={back} onChanged={refresh} onOpenCase={cid => setView({ kind: "case", id: cid })} />;
  } else if (view?.kind === "case") {
    body = <CaseView key={view.id} id={view.id} me={me} roster={roster} onBack={back}
      onOpenSubmission={sid => setView({ kind: "submission", id: sid })} onFillTask={openTask} />;
  } else if (view?.kind === "build") {
    body = <FormBuilder id={view.id} defs={defs} roster={roster} canGrantAccess={canGrantAccess} onBack={() => { setView(null); loadDefs(); }} onSaved={() => { loadDefs(); showToast("Form saved"); }} />;
  } else {
    const q = search.trim().toLowerCase();
    const fillable = defs.filter(d => d.active && !d.settings?.followUpOnly && (!q || `${d.title} ${d.category} ${d.description}`.toLowerCase().includes(q)));
    const groups = [...new Set(fillable.map(d => d.category))].filter(g => !category || g === category || q);
    body = (
      <>
        <div style={sectionTitle}>{pageTitle}</div>
        <div style={{ fontSize: 13, color: C.INK_SOFT, marginTop: 2, marginBottom: 16 }}>
          {tab === "forms" ? "Fill out district forms. What you submit is filed in the right personnel file and sent to the people who need it."
            : tab === "waiting" ? "Forms to fill out, approve or handle, and updates on forms you sent."
            : tab === "mine" ? "Forms you've sent and where each one stands."
            : tab === "all" ? "Every submission you're allowed to see."
            : tab === "cases" ? "Injury reports and other forms that gather several statements."
            : "Create and edit forms, who gets them, and who can see them."}
        </div>

        {tab === "forms" && (
          <>
            <input type="search" aria-label="Search forms" placeholder="Search forms…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 420, marginBottom: 6 }} />
            {groups.length === 0 && <div style={{ color: C.INK_SOFT, marginTop: 10 }}>No forms match.</div>}
            {groups.map(g => (
              <div key={g} style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{g}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                  {fillable.filter(d => d.category === g).map(d => (
                    <div key={d.key} role="button" aria-label={`Open ${d.title}`} onClick={() => setView({ kind: "fill", key: d.key })}
                      className="sgfd-tile" style={{ ...cardStyle, padding: "14px 16px", cursor: "pointer", borderLeft: `4px solid ${C.BRICK}` }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{d.title}</div>
                      {d.description && <div style={{ fontSize: 12.5, color: C.INK_SOFT, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.description}</div>}
                      <div style={{ fontSize: 11.5, color: C.INK_SOFT, marginTop: 6 }}>
                        {d.settings?.anonymous ? "Anonymous · " : ""}{d.settings?.approval?.enabled ? "Needs approval · " : ""}{d.settings?.case ? "Opens a case" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === "waiting" && inbox && (
          <>
            {waitingCount === 0 && <div style={{ color: C.INK_SOFT }}>Nothing is waiting for you.</div>}
            {updates.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", margin: "6px 0 8px" }}>Updates on your forms</div>}
            {updates.map(s => <Row key={s.id} title={`${s.formTitle}: ${s.stage}`} sub={when(s.stageAt)} onClick={() => setView({ kind: "submission", id: s.id })} right={<StatusChip status={s.status} stage={s.stage} />} />)}
            {inbox.tasks.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", margin: "6px 0 8px" }}>Forms you've been asked to fill out</div>}
            {inbox.tasks.map(t => <Row key={t.id} title={t.label} sub={t.caseTitle} onClick={() => openTask(t.id)} right={<span style={{ ...btn("primary"), padding: "5px 12px" }}>Fill out</span>} />)}
            {inbox.approvals.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", margin: "14px 0 8px" }}>Waiting for your approval</div>}
            {inbox.approvals.map(s => <Row key={s.id} title={s.formTitle} sub={`${s.submittedByName} · ${when(s.submittedAt)}`} onClick={() => setView({ kind: "submission", id: s.id })} right={<span style={{ ...btn("primary"), padding: "5px 12px" }}>Review</span>} />)}
            {inbox.toReview.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", margin: "14px 0 8px" }}>Submitted forms for you to review</div>}
            {inbox.toReview.map(s => <Row key={s.id} title={s.formTitle} sub={`${s.subjectName ? `${s.subjectName} · ` : ""}${s.submittedByName || "Anonymous"} · ${when(s.submittedAt)}${s.unassigned ? " · no one handles this form yet: choose recipients in Manage forms" : ""}`} onClick={() => setView({ kind: "submission", id: s.id })} right={<StatusChip status={s.status} stage={s.stage} />} />)}
          </>
        )}

        {tab === "mine" && inbox && (
          <>
            {inbox.mine.length === 0 && <div style={{ color: C.INK_SOFT }}>You haven't submitted any forms yet.</div>}
            {inbox.mine.map(s => <Row key={s.id} title={s.formTitle} sub={`${s.subjectName && s.subjectName !== me.name ? `About ${s.subjectName} · ` : ""}${when(s.submittedAt)}${s.open && s.noHandler ? " · not assigned to anyone yet" : ""}`} onClick={() => setView({ kind: "submission", id: s.id })} right={<StatusChip status={s.status} stage={s.stage} reviewed={s.reviewed} />} />)}
          </>
        )}

        {tab === "all" && handlesSome && <AllSubmissions defs={defs} onOpen={sid => setView({ kind: "submission", id: sid })} />}

        {tab === "cases" && cases && (
          <>
            {cases.length === 0 && <div style={{ color: C.INK_SOFT }}>No cases you can see.</div>}
            {cases.map(c => (
              <Row key={c.id} title={c.title} label={`Open case ${c.title}`}
                sub={`${c.summary?.location ? `${c.summary.location} · ` : ""}${c.done} done${c.pending ? `, ${c.pending} waiting` : ""}`}
                onClick={() => setView({ kind: "case", id: c.id })}
                right={<span style={{ fontSize: 12, fontWeight: 700, color: c.status === "open" ? C.AMBER : C.SAGE }}>{c.status === "open" ? "Open" : "Closed"}</span>} />
            ))}
          </>
        )}

        {tab === "manage" && canManage && (
          <>
            <button style={{ ...btn("primary"), marginBottom: 12 }} onClick={() => setView({ kind: "build", id: null })}>+ New form</button>
            {[...new Set(defs.map(d => d.category))].map(g => (
              <div key={g} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", marginBottom: 6 }}>{g}</div>
                {defs.filter(d => d.category === g).map(d => (
                  <Row key={d.key} title={`${d.title}${d.active ? "" : " (archived)"}`} label={`Edit ${d.title}`}
                    sub={`${d.fields.filter(f => !["heading", "paragraph"].includes(f.type)).length} questions${d.settings?.followUpOnly ? " · part of a case" : ""}${(d.settings?.recipients || []).length ? ` · ${d.settings.recipients.length} required recipient${d.settings.recipients.length === 1 ? "" : "s"}` : ""}`}
                    onClick={() => setView({ kind: "build", id: d.id })} right={<span style={{ ...btn("outline"), padding: "5px 12px" }}>Edit</span>} />
                ))}
              </div>
            ))}
          </>
        )}
      </>
    );
  }

  return (
    <AppShell section="Forms" nav={shellNav} active={shellActive} onNav={shellGo} onHome={onBack}>
      <div>
        {error && <div style={{ color: C.BRICK, marginBottom: 10 }}>{error}</div>}
        {body}
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: C.INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </AppShell>
  );
}
