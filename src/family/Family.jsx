// Gradebook family page (/grades): what a student, or a parent / guardian, sees (server/gradebook.js handleFamily).
// Each linked student's classes with this grading period's grade, then a class's work: scores, teacher comments, graded work.
// Only assignments the teacher has shown to students appear and count.
import React, { useEffect, useMemo, useState } from "react";
import { GraduationCap, LogOut, ArrowLeft, Paperclip, MessageSquare, ChevronRight } from "lucide-react";
import { BRAND, THEME } from "../brand.js";

const INK = "#14202E", SOFT = "#5B6573", LINE = "#E1E5EB", BG = "#F3F5F8", RED = "#B42318", GREEN = "#1F7A45", AMBER = "#9A5B00";
const ACC = THEME.accent || "#FF7900";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const card = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 };
const inp = { width: "100%", padding: "11px 12px", borderRadius: 8, border: "1px solid #C9D0DA", fontSize: 16, color: INK, boxSizing: "border-box", fontFamily: FONT, background: "#fff" };
const primary = { width: "100%", padding: "12px 16px", borderRadius: 8, border: 0, background: ACC, color: "#fff", fontWeight: 700, fontSize: 15.5, cursor: "pointer", fontFamily: FONT };
const ghost = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: `1px solid ${LINE}`, background: "#fff", color: INK, fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: FONT };
const day = d => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const pctText = p => (p == null ? "—" : `${p}%`);

async function api(path, body) {
  const r = await fetch(`/api/family${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't work. Try again."), { status: r.status });
  return j;
}
// The grade's color: below passing red, near it amber
const gradeColor = (pct, passing = 60) => (pct == null ? SOFT : pct < passing ? RED : pct < passing + 10 ? AMBER : GREEN);

function Frame({ children, school }) {
  return <div style={{ minHeight: "100vh", fontFamily: FONT, background: THEME.loginBg || INK, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
    <div style={{ width: "min(420px, 100%)" }}>
      <div style={{ textAlign: "center", color: "#fff", marginBottom: 18 }}>
        {BRAND.orgLogo ? <img src="/org-logo.png" alt="" style={{ maxHeight: 84, maxWidth: "80%", objectFit: "contain" }} />
          : <GraduationCap size={44} color={ACC} />}
        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{school || BRAND.org}</div>
        <div style={{ fontSize: 14, color: THEME.loginSub || "#C5CAD0", marginTop: 2 }}>Grades for students and families</div>
      </div>
      <div style={{ ...card, padding: 22, borderTop: `4px solid ${ACC}` }}>{children}</div>
    </div>
  </div>;
}
function SignIn({ school, onIn }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const go = async e => { e.preventDefault(); setBusy(true); setError(""); try { onIn((await api("/login", { email, password: pw })).user); } catch (x) { setError(x.message); } finally { setBusy(false); } };
  return <Frame school={school}><form onSubmit={go}>
    <h1 style={{ margin: "0 0 14px", color: INK, fontSize: 21 }}>Sign in</h1>
    <label style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: SOFT, marginBottom: 12 }}>Email
      <input type="email" autoComplete="username" style={{ ...inp, marginTop: 4 }} value={email} onChange={e => setEmail(e.target.value)} required /></label>
    <label style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: SOFT, marginBottom: 16 }}>Password
      <input type="password" autoComplete="current-password" style={{ ...inp, marginTop: 4 }} value={pw} onChange={e => setPw(e.target.value)} required /></label>
    {error && <div role="alert" style={{ color: RED, fontSize: 14, marginBottom: 12 }}>{error}</div>}
    <button type="submit" disabled={busy} style={primary}>{busy ? "Signing in…" : "Sign in"}</button>
    <p style={{ color: SOFT, fontSize: 13.5, margin: "14px 0 0", lineHeight: 1.45 }}>New here, or forgot your password? The school office can send you a sign-in link.</p>
  </form></Frame>;
}
function SetPassword({ token, onIn }) {
  const [info, setInfo] = useState(null), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { api(`/invite?token=${encodeURIComponent(token)}`).then(setInfo, x => setError(x.message)); }, [token]);
  const go = async e => {
    e.preventDefault(); if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true); setError("");
    try { const r = await api("/invite", { token, password: pw }); window.history.replaceState(null, "", "/grades"); onIn(r.user); } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return <Frame school={info?.school}>{!info ? <div role={error ? "alert" : undefined} style={{ color: error ? RED : SOFT }}>{error || "Checking your link…"}</div> : <form onSubmit={go}>
    <h1 style={{ margin: "0 0 4px", color: INK, fontSize: 21 }}>Welcome, {info.name.split(" ")[0]}</h1>
    <p style={{ color: SOFT, fontSize: 14.5, margin: "0 0 16px" }}>Choose a password for <b>{info.email}</b>.</p>
    <label style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: SOFT, marginBottom: 12 }}>New password
      <input type="password" autoComplete="new-password" aria-label="New password" style={{ ...inp, marginTop: 4 }} value={pw} onChange={e => setPw(e.target.value)} required /></label>
    <label style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: SOFT, marginBottom: 8 }}>Type it again
      <input type="password" autoComplete="new-password" aria-label="Type it again" style={{ ...inp, marginTop: 4 }} value={pw2} onChange={e => setPw2(e.target.value)} required /></label>
    <div style={{ fontSize: 13, color: SOFT, marginBottom: 14 }}>At least 10 characters, with a capital letter, a lowercase letter and a symbol (like ! - # or a space).</div>
    {error && <div role="alert" style={{ color: RED, fontSize: 14, marginBottom: 12 }}>{error}</div>}
    <button type="submit" disabled={busy} style={primary}>{busy ? "Saving…" : "Save and see grades"}</button>
  </form>}</Frame>;
}

// ---------------------------------------------------------------- signed in
function Top({ user, onOut }) {
  return <header style={{ background: THEME.sideBg || INK, color: "#fff", padding: "12px 16px" }}>
    <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
      {BRAND.orgLogo ? <img src="/org-logo.png" alt="" style={{ height: 34, maxWidth: 120, objectFit: "contain" }} /> : <GraduationCap size={26} color={ACC} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.school}</div>
        <div style={{ fontSize: 12.5, color: THEME.loginSub || "#C5CAD0" }}>{user.name}</div>
      </div>
      <button type="button" onClick={onOut} style={{ ...ghost, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.3)" }}><LogOut size={16} /> Sign out</button>
    </div>
  </header>;
}
function PeriodPicker({ periods, value, onChange }) {
  if (!periods.length) return null;
  return <label style={{ fontSize: 13.5, color: SOFT, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>Grading period
    <select aria-label="Grading period" value={value} onChange={e => onChange(e.target.value)} style={{ ...inp, width: "auto", padding: "7px 10px", fontSize: 14.5 }}>
      {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="">Whole year</option></select></label>;
}
const gradeOf = (g, periodId) => (g ? (periodId ? g.periods?.[periodId] : g.year) : null);

function StudentCard({ card: rc, periodId, onOpen }) {
  return <section style={{ marginBottom: 22 }} aria-label={`${rc.student.firstName} ${rc.student.lastName}`}>
    <h2 style={{ fontSize: 19, color: INK, margin: "0 0 10px" }}>{rc.student.firstName} {rc.student.lastName}{rc.student.gradeLevel ? <span style={{ color: SOFT, fontWeight: 600, fontSize: 14 }}> · Grade {rc.student.gradeLevel}</span> : null}</h2>
    {!rc.classes.length ? <div style={{ ...card, color: SOFT }}>No classes yet.</div> :
      <div style={{ display: "grid", gap: 8 }}>{rc.classes.map(c => {
        const g = gradeOf(c.grade, periodId), comment = periodId ? c.comments?.[periodId] : "";
        return <button key={c.id} type="button" onClick={() => onOpen(rc.student, c)} style={{ ...card, display: "flex", alignItems: "center", gap: 14, textAlign: "left", cursor: "pointer", fontFamily: FONT, padding: "12px 14px" }}>
          <div style={{ width: 58, textAlign: "center", flexShrink: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: gradeColor(g?.pct, rc.passing), lineHeight: 1 }}>{g?.letter || "—"}</div>
            <div style={{ fontSize: 12.5, color: SOFT, marginTop: 3 }}>{g?.pct == null ? "no grades" : pctText(g.pct)}</div></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: INK, fontSize: 15.5 }}>{c.name}</div>
            <div style={{ fontSize: 13, color: SOFT }}>{[c.section, c.teachers.map(t => t.name).join(", ")].filter(Boolean).join(" · ")}</div>
            {comment && <div style={{ fontSize: 13, color: INK, marginTop: 4, display: "flex", gap: 6 }}><MessageSquare size={14} style={{ flexShrink: 0, marginTop: 2 }} color={ACC} /><span>{comment}</span></div>}
          </div>
          <ChevronRight size={18} color={SOFT} />
        </button>;
      })}</div>}
  </section>;
}

function ClassView({ student, cls, periodId, setPeriod, onBack }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => { api(`/students/${student.id}/classes/${cls.id}`).then(setD, e => setError(e.message)); }, [student.id, cls.id]);
  const shown = useMemo(() => {
    if (!d) return [];
    const p = periodId ? d.periods.find(x => x.id === periodId) : null;
    return d.assignments.filter(a => !p || (a.periodId ? a.periodId === p.id : a.due && a.due >= p.starts && a.due <= p.ends));
  }, [d, periodId]);
  const g = d ? gradeOf(d.grade, periodId) : null;
  const catName = id => d?.class.categories.find(c => c.id === id)?.name || "";
  return <>
    <button type="button" onClick={onBack} style={{ ...ghost, marginBottom: 14 }}><ArrowLeft size={16} /> All classes</button>
    {error && <div role="alert" style={{ ...card, color: RED }}>{error}</div>}
    {!d && !error && <div style={{ color: SOFT }}>Loading…</div>}
    {d && <>
      <div style={{ ...card, marginBottom: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ margin: 0, fontSize: 22, color: INK }}>{d.class.name}</h1>
          <div style={{ color: SOFT, fontSize: 14 }}>{student.firstName} {student.lastName} · {d.class.teachers.map(t => t.name).join(", ") || "Teacher not set"}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: gradeColor(g?.pct, d.passing) }}>{g?.letter || "—"}</div>
          <div style={{ fontSize: 14, color: SOFT }}>{pctText(g?.pct)}</div></div>
      </div>
      <div style={{ marginBottom: 12 }}><PeriodPicker periods={d.periods} value={periodId} onChange={setPeriod} /></div>
      {periodId && d.comments[periodId] && <div style={{ ...card, marginBottom: 12, borderLeft: `4px solid ${ACC}` }}>
        <div style={{ fontWeight: 700, color: INK, fontSize: 14, marginBottom: 4 }}>Teacher's comment</div><div style={{ color: INK, whiteSpace: "pre-wrap" }}>{d.comments[periodId]}</div></div>}
      {g?.categories?.some(c => c.pct != null) && <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, color: INK, fontSize: 14, marginBottom: 8 }}>How the grade is figured</div>
        {g.categories.map(c => <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0", borderTop: `1px solid ${LINE}`, color: c.pct == null ? SOFT : INK }}>
          <span>{c.name}{c.weight ? <span style={{ color: SOFT }}> · counts {c.weight}%</span> : null}</span><b>{c.pct == null ? "nothing graded yet" : `${c.pct}%`}</b></div>)}
      </div>}
      <div style={card}>
        <div style={{ fontWeight: 700, color: INK, fontSize: 15, marginBottom: 6 }}>Assignments</div>
        {!shown.length ? <div style={{ color: SOFT, padding: "8px 0" }}>No assignments in this grading period yet.</div> : shown.map(a => {
          const s = a.score;
          const got = s?.status === "excused" ? "Excused" : s?.points != null ? `${s.points} / ${a.points}` : s?.status === "missing" ? `Missing · 0 / ${a.points}` : `– / ${a.points}`;
          return <div key={a.id} style={{ padding: "10px 0", borderTop: `1px solid ${LINE}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, color: INK }}>{a.title}</div>
                <div style={{ fontSize: 12.5, color: SOFT }}>{[catName(a.category), a.due ? `Due ${day(a.due)}` : ""].filter(Boolean).join(" · ")}</div></div>
              <div style={{ fontWeight: 800, whiteSpace: "nowrap", color: s?.status === "missing" ? RED : INK }}>{got}{s?.status === "late" ? <span style={{ color: AMBER, fontWeight: 700, fontSize: 12.5 }}> · Late</span> : null}</div>
            </div>
            {s?.comment && <div style={{ fontSize: 14, color: INK, marginTop: 6, background: BG, borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>{s.comment}</div>}
            {s?.files?.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{s.files.map(f =>
              <a key={f.id} href={`/api/family/files/${f.id}`} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 13.5, color: INK, fontWeight: 600 }}><Paperclip size={14} /> {f.name}</a>)}</div>}
          </div>;
        })}
      </div>
    </>}
  </>;
}

export default function Family() {
  const params = new URLSearchParams(location.search);
  const invite = params.get("invite");
  const [me, setMe] = useState(undefined), [school, setSchool] = useState(""), [data, setData] = useState(null), [error, setError] = useState("");
  const [periodId, setPeriodId] = useState(null), [open, setOpen] = useState(null);
  useEffect(() => { document.title = `Grades · ${school || me?.school || BRAND.org}`; }, [school, me]);
  useEffect(() => { if (!invite) api("/me").then(r => { setMe(r.user); setSchool(r.school || ""); }, () => setMe(null)); }, []);
  useEffect(() => {
    if (!me) return;
    api("/overview").then(r => { setData(r); if (periodId === null) setPeriodId(r.students[0]?.current || ""); }, e => { if (e.status === 401) setMe(null); else setError(e.message); });
  }, [me]);
  if (invite && !me) return <SetPassword token={invite} onIn={setMe} />;
  if (me === undefined) return <div style={{ fontFamily: FONT, padding: 40, textAlign: "center", color: SOFT }}>Loading…</div>;
  if (!me) return <SignIn school={school} onIn={setMe} />;
  const out = async () => { await api("/logout", {}).catch(() => {}); setMe(null); setData(null); };
  const periods = data?.students[0]?.periods || [];
  return <div style={{ minHeight: "100vh", background: BG, fontFamily: FONT, color: INK }}>
    <Top user={me} onOut={out} />
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "18px 16px 40px" }}>
      {error && <div role="alert" style={{ ...card, color: RED, marginBottom: 12 }}>{error}</div>}
      {!data && !error && <div style={{ color: SOFT }}>Loading grades…</div>}
      {data && (open ? <ClassView student={open.student} cls={open.cls} periodId={periodId ?? ""} setPeriod={setPeriodId} onBack={() => setOpen(null)} /> : <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Grades</h1>
          <PeriodPicker periods={periods} value={periodId ?? ""} onChange={setPeriodId} /></div>
        {!data.students.length ? <div style={{ ...card, color: SOFT }}>No students are linked to this sign-in yet. Ask the school office.</div>
          : data.students.map(rc => <StudentCard key={rc.student.id} card={rc} periodId={periodId ?? ""} onOpen={(student, cls) => setOpen({ student, cls })} />)}
        <p style={{ fontSize: 13, color: SOFT, lineHeight: 1.5 }}>Grades show assignments your teachers have posted. {data.students[0]?.missingZero !== false ? "Missing work counts as zero until it's turned in; excused work doesn't count." : "Missing and excused work don't count."}</p>
      </>)}
    </main>
  </div>;
}
