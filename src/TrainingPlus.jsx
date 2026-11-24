// Training, part 2: drills (log, confirm, verify), proficiency, company and shift views, grading-year roster, PIAL estimate.
// Used by Training.jsx. Server: server/trainingPlus.js.
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Printer, Download, Check, AlertTriangle, Pencil, Trash2, Send, RotateCcw, Plus, X } from "lucide-react";
import { cardStyle, inputStyle, btn, printDocument, letterhead, escapeHtml, SignaturePad } from "./App.jsx";
import { PeoplePicker } from "./FormFields.jsx";
import { MissingChips } from "./Training.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/training${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const todayISO = () => new Date().toLocaleDateString("en-CA");
const pretty = (d, o = { weekday: "short", month: "short", day: "numeric" }) => d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", o) : "";
const h1 = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("en-US");
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", whiteSpace: "nowrap" }, td = { padding: "7px 9px", verticalAlign: "top" };
const Pill = ({ children, color = INK_SOFT, solid }) => <span style={{ fontSize: 11.5, fontWeight: 700, color: solid ? "#fff" : color, background: solid ? color : "transparent", border: `1px solid ${color}`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>{children}</span>;
const H = ({ children, right, sub }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
    <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{children}</div>{sub && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>{sub}</div>}</div>{right}
  </div>
);
const Err = ({ e }) => e ? <div role="alert" style={{ color: BRICK, fontSize: 13.5, margin: "6px 0" }}>{e}</div> : null;
const Loading = () => <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
export const STATUS = { draft: ["Draft", INK_SOFT], submitted: ["Waiting for Training", AMBER], returned: ["Sent back", BRICK], verified: ["Verified", SAGE] };
const StatusPill = ({ s }) => <Pill color={STATUS[s]?.[1]}>{STATUS[s]?.[0] || s}</Pill>;
const PROF = { current: ["Current", SAGE], due: ["Due soon", AMBER], overdue: ["Overdue", BRICK], never: ["Not on record", BRICK], retrain: ["Retrain", BRICK], pending: ["Pending", AMBER] };
const Stat = ({ k, v, sub, tone }) => (
  <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", minWidth: 130, flex: "1 1 130px" }}>
    <div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: tone || INK }}>{v}</div>{sub && <div style={{ fontSize: 12, color: INK_SOFT }}>{sub}</div>}
  </div>
);
function PaceBar({ done, required, pace }) {
  const pct = required ? Math.min(100, 100 * done / required) : 0, p = required && pace !== null && pace !== undefined ? Math.min(100, 100 * pace / required) : null;
  const color = done >= required ? SAGE : pace !== null && done + 0.05 < pace ? BRICK : AMBER;
  return (
    <div style={{ minWidth: 120 }}>
      <div style={{ position: "relative", height: 7, background: "#E6EAF0", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color }} />
        {p !== null && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${p}%`, width: 2, background: INK }} />}
      </div>
      <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 2 }}>{h1(done)} / {h1(required)} h{pace !== null && pace !== undefined ? ` · pace ${h1(pace)}` : ""}</div>
    </div>
  );
}

// ---- Drills list --------------------------------------------------------------------------------------
export function DrillsPage({ views, year, init, onOpen, onNew }) {
  const [filter, setFilter] = useState(init?.filter || "all"), [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => { call(`/drills?year=${year}`).then(setD, e => setError(e.message)); }, [year]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <Loading />;
  const list = d.drills.filter(x => filter === "all" ? true : filter === "confirm" ? x.attended && x.status !== "draft" : filter === "mine" ? x.officerId === views.me : x.status === filter);
  const count = f => d.drills.filter(x => f === "confirm" ? x.attended && x.status !== "draft" : x.status === f).length;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select aria-label="Show drills" value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="all">All drills ({d.drills.length})</option>
          <option value="submitted">Waiting for Training ({count("submitted")})</option>
          <option value="returned">Sent back ({count("returned")})</option>
          <option value="verified">Verified ({count("verified")})</option>
          <option value="draft">Drafts ({count("draft")})</option>
          <option value="confirm">I attended ({count("confirm")})</option>
        </select>
        <div style={{ flex: 1 }} />
        {views.canVerify && <a style={{ ...btn("outline"), textDecoration: "none" }} href={`/api/training/drills/export.csv?year=${year}`}><Download size={14} /> Verified drills for FireWorks (CSV)</a>}
        {views.canLog && <button style={btn("primary")} onClick={onNew}><Plus size={14} /> Log a drill</button>}
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Date</th><th style={th}>Drill</th><th style={th}>Company</th><th style={th}>Hours</th><th style={th}>Crew</th><th style={th}>Status</th></tr></thead>
          <tbody>
            {!list.length && <tr><td colSpan={6} style={{ ...td, color: INK_SOFT }}>No drills to show.</td></tr>}
            {list.map(x => (
              <tr key={x.id} role="button" tabIndex={0} aria-label={`Open drill ${x.topic} ${x.day}`} onClick={() => onOpen(x.id)} onKeyDown={e => e.key === "Enter" && onOpen(x.id)}
                style={{ borderBottom: `1px solid ${LINE}`, cursor: "pointer" }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{pretty(x.day)}</td>
                <td style={td}><b style={{ color: INK }}>{x.topic}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{x.officer}{x.atFacility ? " · training ground" : ""}</div></td>
                <td style={td}>{x.station ? `Sta ${x.station}` : "—"} {x.shift}</td>
                <td style={{ ...td, fontWeight: 700 }}>{h1(x.hours)}</td>
                <td style={{ ...td, fontSize: 12.5 }}>{x.count} · {x.confirmed} confirmed{x.disputed ? <span style={{ color: BRICK }}> · {x.disputed} questioned</span> : ""}{x.inFireWorks ? <div style={{ color: SAGE }}>{x.inFireWorks} in FireWorks</div> : null}</td>
                <td style={td}><StatusPill s={x.status} />{x.attended && x.status !== "draft" ? <div style={{ fontSize: 11, color: BLUE, marginTop: 2 }}>you attended</div> : null}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Drill editor -------------------------------------------------------------------------------------
export function DrillEditor({ id, views, roster, categories, onDone, onCancel, toast }) {
  const [f, setF] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [sig, setSig] = useState(null);
  const [crew, setCrew] = useState(null), [q, setQ] = useState(""), [content, setContent] = useState(null), [extra, setExtra] = useState([]), [chosenSkills, setChosenSkills] = useState([]);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  useEffect(() => {
    if (id) call(`/drills/${id}`).then(r => {
      const d = r.drill;
      setF({ ...d, people: d.people.map(p => ({ userId: p.userId, name: p.name, hours: p.hours })), skills: d.skills });
      setChosenSkills([...new Set(d.skills.map(k => k.skillId))]);
    }, e => setError(e.message));
    else {
      const c = views.companies.find(x => x.station === views.station && x.shift === views.shift) || views.companies[0] || { station: views.station, shift: views.shift };
      setF({ day: todayISO(), start: "", end: "", hours: "", station: c.station || "", shift: c.shift || "", units: "", location: c.station ? `Station ${c.station}` : "", atFacility: false,
        kind: "company", delivery: "inhouse", certification: "", subject: "", fwCategory: "", topic: "", objectives: "", instructor: "", people: [], skills: [] });
    }
  }, [id]);
  useEffect(() => {
    if (!f?.station || !f?.shift) { setCrew(null); return; }
    call(`/company?station=${encodeURIComponent(f.station)}&shift=${f.shift}`).then(r => {
      setCrew(r.people);
      if (!id) setF(x => x.people.length ? x : { ...x, people: r.people.filter(p => p.onDuty).map(p => ({ userId: p.id, name: p.name, hours: "" })) });
    }, () => setCrew([]));
  }, [f?.station, f?.shift]);
  useEffect(() => { const t = setTimeout(() => call(`/content?q=${encodeURIComponent(q)}`).then(setContent, () => setContent(null)), 250); return () => clearTimeout(t); }, [q]);
  if (error && !f) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!f) return <Loading />;
  const auto = (() => {
    if (!/^\d{2}:\d{2}$/.test(f.start) || !/^\d{2}:\d{2}$/.test(f.end)) return null;
    const m = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); let d = m(f.end) - m(f.start); if (d <= 0) d += 1440; return Math.round(d / 15) / 4;
  })();
  const hours = Number(f.hours) > 0 ? Number(f.hours) : auto;
  const inList = uid => f.people.some(p => p.userId === uid);
  const toggle = p => set("people", inList(p.id) ? f.people.filter(x => x.userId !== p.id) : [...f.people, { userId: p.id, name: p.name, hours: "" }]);
  const others = f.people.filter(p => !crew?.some(c => c.id === p.userId));
  const skillMap = new Map(views.skills.map(k => [k.id, k]));
  const res = (uid, sk) => f.skills.find(k => k.userId === uid && k.skillId === sk)?.result || "";
  const setRes = (uid, sk, v) => set("skills", [...f.skills.filter(k => !(k.userId === uid && k.skillId === sk)), ...(v ? [{ userId: uid, skillId: sk, result: v }] : [])]);
  async function save(submit) {
    setBusy(true); setError("");
    try {
      const r = await call("/drills", { ...f, id: id || f.id, hours: Number(f.hours) > 0 ? Number(f.hours) : auto, submit, signature: sig,
        people: f.people.map(p => ({ userId: p.userId, name: p.name, hours: p.hours === "" ? undefined : Number(p.hours) })),
        skills: f.skills.filter(k => chosenSkills.includes(k.skillId)) });
      toast(submit ? "Submitted. The crew was asked to confirm, and it's waiting for Training to verify." : "Draft saved.");
      onDone(r.id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const stations = [...new Set(views.companies.map(c => c.station))];
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 980 }}>
      <div><button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onCancel}><ChevronLeft size={15} /> Back</button></div>
      {f.status === "returned" && f.returnNote && <div style={{ ...cardStyle, borderLeft: `4px solid ${BRICK}`, fontSize: 13.5 }}><b>Training sent this back:</b> {f.returnNote}</div>}
      <div style={cardStyle}>
        <H sub="Log a company drill for your crew. It counts toward everyone's hours once Training verifies it.">{id ? "Edit drill" : "Drill details"}</H>
        {content && content.total > 0 && (
          <div style={{ marginBottom: 10 }}>
            <span style={label}>Find the class in the FireWorks content list (optional)</span>
            <input aria-label="Find a class" placeholder="Search content titles…" value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
            {q && (content.content || []).length > 0 && <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, maxHeight: 200, overflowY: "auto", marginTop: 4 }}>
              {content.content.map((c, i) => <button key={i} type="button" onClick={() => { setF(x => ({ ...x, certification: c.certification, subject: c.subject, topic: c.title, hours: c.auto ? String(c.auto) : x.hours })); setQ(""); }}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${LINE}`, background: "#fff", padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>
                <b>{c.title}</b> <span style={{ color: INK_SOFT }}>· {c.certification} · {c.subject}{c.auto ? ` · ${c.auto} h` : ""}</span></button>)}
            </div>}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Drill / content title</span><input aria-label="Drill topic" style={inputStyle} value={f.topic} onChange={e => set("topic", e.target.value)} placeholder="e.g. Hydrant connections and supply line" /></label>
          <label><span style={label}>Date</span><input aria-label="Drill date" type="date" max={todayISO()} style={inputStyle} value={f.day} onChange={e => set("day", e.target.value)} /></label>
          <label><span style={label}>Start</span><input aria-label="Start time" type="time" style={inputStyle} value={f.start} onChange={e => set("start", e.target.value)} /></label>
          <label><span style={label}>End</span><input aria-label="End time" type="time" style={inputStyle} value={f.end} onChange={e => set("end", e.target.value)} /></label>
          <label><span style={label}>Hours{auto ? ` (${auto} from the times)` : ""}</span><input aria-label="Drill hours" type="number" step="0.25" min="0" style={inputStyle} value={f.hours} placeholder={auto ? String(auto) : ""} onChange={e => set("hours", e.target.value)} /></label>
          <label><span style={label}>Station</span>{stations.length && !views.canVerify ? <select aria-label="Station" style={inputStyle} value={f.station} onChange={e => set("station", e.target.value)}>{stations.map(s => <option key={s} value={s}>Station {s}</option>)}</select>
            : <input aria-label="Station" style={inputStyle} value={f.station} onChange={e => set("station", e.target.value)} placeholder="61" />}</label>
          <label><span style={label}>Shift</span><select aria-label="Shift" style={inputStyle} value={f.shift} onChange={e => set("shift", e.target.value)}><option value="">—</option>{["A", "B", "C"].map(s => <option key={s}>{s}</option>)}</select></label>
          <label><span style={label}>Units</span><input aria-label="Units" style={inputStyle} value={f.units} onChange={e => set("units", e.target.value)} placeholder="EG613, LD618" /></label>
          <label><span style={label}>Location</span><input aria-label="Location" style={inputStyle} value={f.location} onChange={e => set("location", e.target.value)} /></label>
          <label><span style={label}>ISO credit</span><select aria-label="ISO credit" style={inputStyle} value={f.kind} onChange={e => set("kind", e.target.value)}>{Object.entries(views.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span style={label}>How it was delivered</span><select aria-label="Delivery" style={inputStyle} value={f.delivery} onChange={e => set("delivery", e.target.value)}>{Object.entries(views.delivery).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, paddingTop: 18 }}><input type="checkbox" checked={f.atFacility || f.kind === "facility"} disabled={f.kind === "facility"} onChange={e => set("atFacility", e.target.checked)} /> At the training ground / props</label>
          <label><span style={label}>Certification (FireWorks)</span><input aria-label="Certification" style={inputStyle} value={f.certification} onChange={e => set("certification", e.target.value)} /></label>
          <label><span style={label}>Subject</span><input aria-label="Subject" style={inputStyle} value={f.subject} onChange={e => set("subject", e.target.value)} placeholder="Company" /></label>
          {categories.length > 0 && <label><span style={label}>FireWorks category</span><select aria-label="FireWorks category" style={inputStyle} value={f.fwCategory} onChange={e => set("fwCategory", e.target.value)}>
            <option value="">—</option>{categories.filter(c => !c.archived).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>}
          <label><span style={label}>Instructor</span><input aria-label="Instructor" style={inputStyle} value={f.instructor} onChange={e => set("instructor", e.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>What was covered (objectives, evolutions, notes)</span><textarea aria-label="Objectives" rows={3} style={inputStyle} value={f.objectives} onChange={e => set("objectives", e.target.value)} /></label>
        </div>
      </div>

      <div style={cardStyle}>
        <H sub={crew === null ? "Pick the station and shift to see the crew." : "On-duty members (from Aladtec) start checked. Change anyone's hours if they arrived late or left early."}>Who attended ({f.people.length})</H>
        {crew && crew.map(p => {
          const row = f.people.find(x => x.userId === p.id);
          return (
            <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 0", borderTop: `1px solid ${LINE}`, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 220, fontSize: 13.5 }}>
                <input type="checkbox" aria-label={`Attended: ${p.name}`} checked={!!row} onChange={() => toggle(p)} />
                <span><b>{p.name}</b> <span style={{ color: INK_SOFT, fontSize: 12 }}>{p.title}</span>{p.onDuty && <span style={{ fontSize: 10.5, fontWeight: 800, color: SAGE, marginLeft: 6 }}>ON DUTY</span>}</span></label>
              {row && <input aria-label={`Hours for ${p.name}`} type="number" step="0.25" min="0" placeholder={hours ? String(hours) : "hours"} style={{ ...inputStyle, width: 90 }}
                value={row.hours} onChange={e => set("people", f.people.map(x => x.userId === p.id ? { ...x, hours: e.target.value } : x))} />}
            </div>);
        })}
        {others.map((p, i) => (
          <div key={p.userId || p.name} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 0", borderTop: `1px solid ${LINE}` }}>
            <span style={{ flex: 1, fontSize: 13.5 }}><b>{p.name}</b> <span style={{ color: INK_SOFT, fontSize: 12 }}>{p.userId ? "from another company" : "no " + PN + " account"}</span></span>
            <input aria-label={`Hours for ${p.name}`} type="number" step="0.25" min="0" placeholder={hours ? String(hours) : "hours"} style={{ ...inputStyle, width: 90 }}
              value={p.hours} onChange={e => set("people", f.people.map(x => x === p ? { ...x, hours: e.target.value } : x))} />
            <button aria-label={`Remove ${p.name}`} style={btn("ghost")} onClick={() => set("people", f.people.filter(x => x !== p))}><X size={14} /></button>
          </div>))}
        <div style={{ marginTop: 8 }}>
          <span style={label}>Add someone from another company</span>
          <PeoplePicker roster={roster} value={extra} label="Extra attendees" exclude={f.people.map(p => p.userId).filter(Boolean)}
            onChange={v => { const add = v.filter(x => !extra.includes(x)); setExtra([]); set("people", [...f.people, ...add.map(uid => ({ userId: uid, name: roster.find(r => r.id === uid)?.name || "", hours: "" }))]); }} />
        </div>
      </div>

      <div style={cardStyle}>
        <H sub="Optional. Record who showed the skill to standard. Proficiency is tracked apart from hours.">Proficiency shown in this drill</H>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {views.skills.map(k => <label key={k.id} style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", border: `1px solid ${LINE}`, borderRadius: 8, padding: "3px 8px", background: chosenSkills.includes(k.id) ? "#EEF4FB" : "#fff" }}>
            <input type="checkbox" aria-label={`Skill: ${k.label}`} checked={chosenSkills.includes(k.id)} onChange={e => setChosenSkills(e.target.checked ? [...chosenSkills, k.id] : chosenSkills.filter(x => x !== k.id))} /> {k.label}</label>)}
        </div>
        {chosenSkills.length > 0 && f.people.filter(p => p.userId).length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr><th style={th}>Member</th>{chosenSkills.map(sk => <th key={sk} style={{ ...th, whiteSpace: "normal", maxWidth: 160 }}>{skillMap.get(sk)?.label}</th>)}</tr></thead>
              <tbody>{f.people.filter(p => p.userId).map(p => (
                <tr key={p.userId} style={{ borderTop: `1px solid ${LINE}` }}><td style={td}>{p.name}</td>
                  {chosenSkills.map(sk => <td key={sk} style={td}><div role="radiogroup" aria-label={`${p.name} ${skillMap.get(sk)?.label}`} style={{ display: "flex", gap: 3 }}>
                    {[["met", "Met", SAGE], ["not_met", "Not met", BRICK]].map(([v, l, c]) => <button key={v} type="button" role="radio" aria-checked={res(p.userId, sk) === v} aria-label={`${p.name} ${skillMap.get(sk)?.label}: ${l}`}
                      onClick={() => setRes(p.userId, sk, res(p.userId, sk) === v ? "" : v)}
                      style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, cursor: "pointer", border: `1px solid ${res(p.userId, sk) === v ? c : LINE}`, background: res(p.userId, sk) === v ? c : "#fff", color: res(p.userId, sk) === v ? "#fff" : INK }}>{l}</button>)}
                  </div></td>)}</tr>))}</tbody>
            </table>
          </div>)}
      </div>

      <div style={cardStyle}>
        <H sub="Your signature certifies the drill took place as logged.">Submit</H>
        <div style={{ maxWidth: 420 }}><SignaturePad label="Officer signature" onChange={setSig} /></div>
        <Err e={error} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button style={btn("outline")} disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button style={btn("primary")} disabled={busy || !sig || !f.people.length || !f.topic || !hours} onClick={() => save(true)}><Send size={14} /> Sign and submit</button>
        </div>
      </div>
    </div>
  );
}

// ---- One drill ----------------------------------------------------------------------------------------
export function DrillView({ id, views, onBack, onEdit, toast }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [note, setNote] = useState(""), [dispute, setDispute] = useState(""), [mode, setMode] = useState("");
  const load = () => call(`/drills/${id}`).then(setD, e => setError(e.message));
  useEffect(() => { load(); }, [id]);
  if (error && !d) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <Loading />;
  const x = d.drill, skills = new Map(views.skills.map(k => [k.id, k]));
  const act = async (path, body, msg) => { setError(""); try { await call(`/drills/${id}/${path}`, body); toast(msg); setMode(""); load(); } catch (e) { setError(e.message); } };
  const remove = async () => { if (!window.confirm("Delete this drill log?")) return; try { await call(`/drills/${id}/remove`, {}); toast("Deleted."); onBack(); } catch (e) { setError(e.message); } };
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 980 }}>
      <div><button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}><ChevronLeft size={15} /> Drills</button></div>
      <div style={cardStyle}>
        <H right={<><StatusPill s={x.status} /><button style={btn("outline")} onClick={() => printDrill(x, views)}><Printer size={14} /> Print</button></>}
          sub={`${pretty(x.day, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${x.start ? ` · ${x.start}–${x.end}` : ""} · ${h1(x.hours)} h · ${x.station ? `Station ${x.station}` : ""} ${x.shift ? `${x.shift} shift` : ""}`}>{x.topic}</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, fontSize: 13.5 }}>
          <div><span style={label}>Logged by</span>{x.officer}{x.submittedAt ? `, submitted ${pretty(x.submittedAt)}` : ""}</div>
          <div><span style={label}>ISO credit</span>{views.kinds[x.kind] || x.kind}{x.atFacility ? " · at the training ground" : ""}</div>
          <div><span style={label}>Delivery</span>{views.delivery[x.delivery] || x.delivery}</div>
          {x.units && <div><span style={label}>Units</span>{x.units}</div>}
          {x.location && <div><span style={label}>Location</span>{x.location}</div>}
          {(x.certification || x.subject) && <div><span style={label}>FireWorks</span>{[x.certification, x.subject, x.fwCategory].filter(Boolean).join(" · ")}</div>}
          {x.instructor && <div><span style={label}>Instructor</span>{x.instructor}</div>}
          {x.verifiedAt && <div><span style={label}>Verified</span>{x.verifiedBy}, {pretty(x.verifiedAt)}</div>}
        </div>
        {x.objectives && <div style={{ marginTop: 10, whiteSpace: "pre-wrap", fontSize: 13.5, background: PAPER, padding: 10, borderRadius: 8 }}>{x.objectives}</div>}
        {x.status === "returned" && <div style={{ marginTop: 10, color: BRICK, fontSize: 13.5 }}><b>Sent back:</b> {x.returnNote}</div>}
        {x.signature && <div style={{ marginTop: 10 }}><span style={label}>Officer signature</span><img alt="Officer signature" src={x.signature} style={{ maxHeight: 60 }} /></div>}
      </div>

      {d.mine && ["submitted", "verified"].includes(x.status) && (
        <div style={{ ...cardStyle, borderLeft: `4px solid ${d.mine.confirmedAt ? SAGE : AMBER}` }}>
          {d.mine.confirmedAt ? <div style={{ fontSize: 13.5 }}><Check size={14} color={SAGE} /> You confirmed you attended ({h1(d.mine.hours)} h).</div>
            : d.mine.disputed ? <div style={{ fontSize: 13.5 }}>You said: “{d.mine.disputed}”. {x.officer} was told.</div>
            : <>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>You're on this drill for {h1(d.mine.hours)} h. Is that right?</div>
              {mode === "dispute" ? <div style={{ display: "grid", gap: 6, maxWidth: 560 }}>
                <textarea aria-label="What's wrong" rows={2} style={inputStyle} value={dispute} onChange={e => setDispute(e.target.value)} placeholder="e.g. I left at 10:00 for a medical call" />
                <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} disabled={!dispute.trim()} onClick={() => act("confirm", { dispute }, "Sent to the officer.")}>Send</button><button style={btn("ghost")} onClick={() => setMode("")}>Cancel</button></div></div>
                : <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} onClick={() => act("confirm", {}, "Confirmed. Thanks.")}><Check size={14} /> Yes, confirm</button>
                  <button style={btn("outline")} onClick={() => setMode("dispute")}>Something's wrong</button></div>}
            </>}
        </div>
      )}

      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Member</th><th style={th}>Hours</th><th style={th}>Confirmed</th><th style={th}>Proficiency</th></tr></thead>
          <tbody>{x.people.map(p => (
            <tr key={p.id} style={{ borderBottom: `1px solid ${LINE}` }}>
              <td style={td}><b>{p.name}</b>{!p.userId && <div style={{ fontSize: 11.5, color: INK_SOFT }}>no {PN} account</div>}</td>
              <td style={{ ...td, fontWeight: 700 }}>{h1(p.hours)}{p.inFireWorks && <div style={{ fontSize: 11, color: SAGE, fontWeight: 600 }}>in FireWorks</div>}</td>
              <td style={td}>{p.confirmedAt ? <span style={{ color: SAGE }}>✓ {pretty(p.confirmedAt)}</span> : p.disputed ? <span style={{ color: BRICK }}>Questioned: {p.disputed}</span> : <span style={{ color: INK_SOFT }}>—</span>}</td>
              <td style={{ ...td, fontSize: 12.5 }}>{x.skills.filter(k => k.userId === p.userId).map(k => <div key={k.id} style={{ color: k.result === "met" ? SAGE : BRICK }}>{skills.get(k.skillId)?.label || k.skillId}: {k.result === "met" ? "met" : "not met"}</div>)}</td>
            </tr>))}</tbody>
        </table>
      </div>

      <Err e={error} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {d.canEdit && <button style={btn("primary")} onClick={onEdit}><Pencil size={14} /> {x.status === "returned" ? "Fix and resubmit" : "Edit"}</button>}
        {d.canVerify && mode !== "return" && <><button style={btn("primary")} onClick={() => act("verify", {}, "Verified. The hours now count for everyone on the list.")}><Check size={14} /> Verify</button>
          <button style={btn("outline")} onClick={() => setMode("return")}><RotateCcw size={14} /> Send back</button></>}
        {(d.canEdit || views.canManage) && <button style={{ ...btn("ghost"), color: BRICK }} onClick={remove}><Trash2 size={14} /> Delete</button>}
      </div>
      {mode === "return" && <div style={{ ...cardStyle, display: "grid", gap: 6, maxWidth: 600 }}>
        <textarea aria-label="What needs to change" rows={2} style={inputStyle} value={note} onChange={e => setNote(e.target.value)} placeholder="What needs to change?" />
        <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} disabled={!note.trim()} onClick={() => act("return", { note }, "Sent back to the officer.")}>Send back</button><button style={btn("ghost")} onClick={() => setMode("")}>Cancel</button></div>
      </div>}
    </div>
  );
}
function printDrill(x, views) {
  const skills = new Map(views.skills.map(k => [k.id, k.label]));
  const rows = x.people.map(p => `<tr><td>${escapeHtml(p.name)}</td><td style="text-align:right">${h1(p.hours)}</td><td>${p.confirmedAt ? "✓" : p.disputed ? escapeHtml(`Questioned: ${p.disputed}`) : ""}</td>
    <td>${x.skills.filter(k => k.userId === p.userId).map(k => `${escapeHtml(skills.get(k.skillId) || k.skillId)}: ${k.result === "met" ? "met" : "NOT met"}`).join("<br>")}</td></tr>`).join("");
  printDocument(`Drill — ${x.topic}`, `${letterhead("Company drill record")}<h1>${escapeHtml(x.topic)}</h1>
    <div class="meta">${escapeHtml(pretty(x.day, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}${x.start ? ` · ${x.start}–${x.end}` : ""} · ${h1(x.hours)} h · ${x.station ? `Station ${escapeHtml(x.station)}` : ""} ${escapeHtml(x.shift)} shift${x.units ? ` · ${escapeHtml(x.units)}` : ""}</div>
    <p>ISO credit: ${escapeHtml(views.kinds[x.kind] || x.kind)}${x.atFacility ? " (training ground)" : ""} · ${escapeHtml(views.delivery[x.delivery] || "")}${x.location ? ` · ${escapeHtml(x.location)}` : ""}</p>
    ${x.objectives ? `<h2>Covered</h2><p>${escapeHtml(x.objectives).replace(/\n/g, "<br>")}</p>` : ""}
    <h2>Attendance</h2><table><thead><tr><th>Member</th><th style="text-align:right">Hours</th><th>Confirmed</th><th>Proficiency</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>Signatures</h2><p>Officer: ${escapeHtml(x.officer)}${x.signature ? `<br><img src="${x.signature}" style="max-height:60px">` : ""}</p>
    ${x.verifiedAt ? `<p>Verified by ${escapeHtml(x.verifiedBy)}, ${escapeHtml(pretty(x.verifiedAt))}</p>` : `<p>Status: ${escapeHtml(STATUS[x.status]?.[0] || x.status)}</p>`}`);
}

// ---- Company view ---------------------------------------------------------------------------------------
export function CompanyView({ views, year, init, onOpenPerson, onOpenDrill }) {
  const first = views.companies.find(c => c.station === (init?.station || views.station) && c.shift === (init?.shift || views.shift)) || views.companies[0];
  const [sel, setSel] = useState(first ? `${first.station}|${first.shift}` : ""), [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    if (!sel) return;
    setD(null); setError("");
    const [station, shift] = sel.split("|");
    call(`/company?station=${encodeURIComponent(station)}&shift=${shift}&year=${year}`).then(setD, e => setError(e.message));
  }, [sel, year]);
  if (!views.companies.length) return <div style={cardStyle}>No companies to show. Companies come from each member's home station (directory card) and shift (work pattern).</div>;
  const s = d?.summary;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select aria-label="Company" value={sel} onChange={e => setSel(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {views.companies.map(c => <option key={`${c.station}|${c.shift}`} value={`${c.station}|${c.shift}`}>Station {c.station} · {c.shift} shift</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {d && <button style={btn("outline")} onClick={() => printCompany(d, views)}><Printer size={14} /> Print</button>}
      </div>
      {error && <div style={{ ...cardStyle, color: BRICK }}>{error}</div>}
      {!d && !error && <Loading />}
      {d && <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat k="Members" v={s.members} sub={`${s.onDuty} on duty today`} />
          <Stat k="Company hours" v={h1(s.avgCompany)} sub="average per member" />
          <Stat k="Behind pace" v={s.behind} tone={s.behind ? BRICK : SAGE} sub="company training" />
          <Stat k="Proficiency" v={s.profOverdue} tone={s.profOverdue ? BRICK : SAGE} sub={`overdue or retrain · ${s.profDue} due soon · ${s.profNever} not on record yet`} />
          <Stat k="Drills" v={d.drillCount} sub={`${h1(d.drillHours)} h verified${d.pending ? ` · ${d.pending} waiting` : ""}`} />
        </div>
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Member</th><th style={th}>Company training</th><th style={th}>Missing</th><th style={th}>Proficiency</th></tr></thead>
            <tbody>
              {!d.people.length && <tr><td colSpan={4} style={{ ...td, color: INK_SOFT }}>Nobody in this company.</td></tr>}
              {d.people.map(p => (
                <tr key={p.id} role="button" tabIndex={0} aria-label={`Open ${p.name}`} onClick={() => onOpenPerson(p)} onKeyDown={e => e.key === "Enter" && onOpenPerson(p)} style={{ borderBottom: `1px solid ${LINE}`, cursor: "pointer" }}>
                  <td style={td}><b style={{ color: INK }}>{p.name}</b>{p.onDuty && <span style={{ fontSize: 10.5, fontWeight: 800, color: SAGE, marginLeft: 6 }}>ON DUTY</span>}<div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.title}</div></td>
                  <td style={td}>{p.company ? <PaceBar {...p.company} /> : <span style={{ color: INK_SOFT }}>—</span>}</td>
                  <td style={td}><MissingChips reqs={p.requirements} /></td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    <span style={{ color: SAGE }}>{p.proficiency.current} current</span>
                    {p.proficiency.due > 0 && <span style={{ color: AMBER }}> · {p.proficiency.due} due</span>}
                    {p.proficiency.overdue + p.proficiency.retrain > 0 && <span style={{ color: BRICK }}> · {p.proficiency.overdue + p.proficiency.retrain} overdue</span>}
                    {p.proficiency.never > 0 && <span style={{ color: INK_SOFT }}> · {p.proficiency.never} not on record</span>}
                    <span style={{ color: INK_SOFT }}> of {p.proficiency.total}</span></td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <div style={{ padding: "10px 12px", fontWeight: 800, color: INK }}>Drills in {year}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {!d.drills.length && <tr><td style={{ ...td, color: INK_SOFT }}>No drills logged yet.</td></tr>}
              {d.drills.map(x => <tr key={x.id} style={{ borderTop: `1px solid ${LINE}`, cursor: "pointer" }} onClick={() => onOpenDrill(x.id)}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{pretty(x.day)}</td><td style={td}>{x.topic}</td><td style={td}>{h1(x.hours)} h · {x.count}</td><td style={td}><StatusPill s={x.status} /></td></tr>)}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
function printCompany(d, views) {
  const sk = new Map(views.skills.map(k => [k.id, k.label]));
  const rows = d.people.map(p => `<tr><td><b>${escapeHtml(p.name)}</b><br><span style="color:#666;font-size:11px">${escapeHtml(p.title)}</span></td>
    <td style="text-align:right">${p.company ? `${h1(p.company.done)} / ${h1(p.company.required)}` : ""}</td>
    <td>${p.requirements.filter(r => r.missing > 0).map(r => `${escapeHtml(r.label)} −${h1(r.missing)}`).join("; ") || "All met"}</td>
    <td>${p.proficiency.skills.filter(x => ["overdue", "never", "retrain"].includes(x.status)).map(x => escapeHtml(sk.get(x.id) || x.id)).join(", ") || "Current"}</td></tr>`).join("");
  printDocument(`Station ${d.station} ${d.shift} shift — training`, `${letterhead(`Company training ${d.year}`)}<h1>Station ${escapeHtml(d.station)} · ${escapeHtml(d.shift)} shift</h1>
    <div class="meta">${d.summary.members} members · average company training ${h1(d.summary.avgCompany)} h · ${d.summary.behind} behind pace · ${d.drillCount} verified drills (${h1(d.drillHours)} h)</div>
    <table><thead><tr><th>Member</th><th style="text-align:right">Company hrs</th><th>Missing</th><th>Proficiency due</th></tr></thead><tbody>${rows}</tbody></table>`);
}

// ---- Shift (battalion) view ---------------------------------------------------------------------------
export function ShiftView({ views, year, onOpenCompany }) {
  const [shift, setShift] = useState(views.shift && views.shifts.includes(views.shift) ? views.shift : views.shifts[0]), [d, setD] = useState(null), [error, setError] = useState(""), [open, setOpen] = useState(null);
  useEffect(() => { if (!shift) return; setD(null); call(`/shift?shift=${shift}&year=${year}`).then(setD, e => setError(e.message)); }, [shift, year]);
  if (!views.shifts.length) return <div style={cardStyle}>The shift view is for battalion chiefs and Training.</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select aria-label="Shift view" value={shift} onChange={e => setShift(e.target.value)} style={{ ...inputStyle, width: "auto" }}>{views.shifts.map(s => <option key={s} value={s}>{s} shift</option>)}</select>
      </div>
      {error && <div style={{ ...cardStyle, color: BRICK }}>{error}</div>}
      {!d && !error && <Loading />}
      {d && <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Stat k="Members" v={d.summary.members} sub={`${d.summary.onDuty} on duty today`} />
          <Stat k="Company hours" v={h1(d.summary.avgCompany)} sub="average per member" />
          <Stat k="Behind pace" v={d.summary.behind} tone={d.summary.behind ? BRICK : SAGE} />
          <Stat k="Proficiency overdue" v={d.summary.profOverdue} tone={d.summary.profOverdue ? BRICK : SAGE} sub={`${d.summary.profNever} not on record yet`} />
        </div>
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Company</th><th style={th}>Members</th><th style={th}>Avg company hrs</th><th style={th}>Behind</th><th style={th}>Proficiency</th><th style={th}>Drills</th><th style={th} /></tr></thead>
            <tbody>{d.companies.map(c => <React.Fragment key={c.station}>
              <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={td}>{c.station ? <button style={{ border: 0, background: "none", color: BLUE, cursor: "pointer", fontWeight: 700, padding: 0, fontSize: 13 }} onClick={() => onOpenCompany(c.station, shift)}>Station {c.station}</button>
                  : <span style={{ color: INK_SOFT }} title="Set the home station on their directory card">No home station</span>}</td>
                <td style={td}>{c.members}</td><td style={{ ...td, fontWeight: 700 }}>{h1(c.avgCompany)}</td>
                <td style={{ ...td, color: c.behind ? BRICK : SAGE, fontWeight: 700 }}>{c.behind}</td>
                <td style={td}>{c.profOverdue ? <span style={{ color: BRICK }}>{c.profOverdue} overdue</span> : <span style={{ color: SAGE }}>none overdue</span>}{c.profDue ? <span style={{ color: AMBER }}> · {c.profDue} due</span> : ""}{c.profNever ? <span style={{ color: INK_SOFT }}> · {c.profNever} not on record</span> : ""}</td>
                <td style={td}>{c.drills} verified ({h1(c.drillHours)} h) · {c.drillsThisMonth} this month{c.pending ? <span style={{ color: AMBER }}> · {c.pending} waiting</span> : ""}{c.returned ? <span style={{ color: BRICK }}> · {c.returned} sent back</span> : ""}</td>
                <td style={td}><button style={btn("ghost")} aria-label={`People at ${c.station ? `Station ${c.station}` : "no home station"}`} onClick={() => setOpen(open === c.station ? null : c.station)}>{open === c.station ? "Hide" : "People"}</button></td>
              </tr>
              {open === c.station && c.people.map(p => <tr key={p.id} style={{ background: PAPER, borderBottom: `1px solid ${LINE}` }}>
                <td style={{ ...td, paddingLeft: 22 }} colSpan={2}>{p.name}{p.onDuty && <span style={{ fontSize: 10.5, fontWeight: 800, color: SAGE, marginLeft: 6 }}>ON DUTY</span>}<div style={{ fontSize: 11.5, color: INK_SOFT }}>{p.title}</div></td>
                <td style={td} colSpan={2}>{p.company ? <PaceBar {...p.company} /> : "—"}</td>
                <td style={td} colSpan={3}>{p.profOverdue ? <span style={{ color: BRICK }}>{p.profOverdue} overdue</span> : "none overdue"}{p.profNever ? <span style={{ color: INK_SOFT }}> · {p.profNever} not on record</span> : ""}{p.missingCount ? ` · ${p.missingCount} requirement(s) short` : ""}</td></tr>)}
            </React.Fragment>)}</tbody>
          </table>
        </div>
      </>}
    </div>
  );
}

// ---- Proficiency ----------------------------------------------------------------------------------------
export function ProficiencyPage({ views, toast }) {
  const [sel, setSel] = useState(views.role === "member" ? "me" : views.companies.find(c => c.station === views.station && c.shift === views.shift) ? `${views.station}|${views.shift}` : views.companies[0] ? `${views.companies[0].station}|${views.companies[0].shift}` : "me");
  const [d, setD] = useState(null), [error, setError] = useState(""), [rec, setRec] = useState(null);
  const load = () => { const [station, shift] = sel === "me" ? ["", ""] : sel.split("|"); return call(`/proficiency?${new URLSearchParams({ station, shift })}`).then(setD, e => setError(e.message)); };
  useEffect(() => { setD(null); load(); }, [sel]);
  const canRecord = views.canVerify || views.role === "officer" || views.role === "bc";
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {views.companies.length > 0 && <select aria-label="Proficiency for" value={sel} onChange={e => setSel(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          {views.companies.map(c => <option key={`${c.station}|${c.shift}`} value={`${c.station}|${c.shift}`}>Station {c.station} · {c.shift} shift</option>)}
          <option value="me">Just me</option></select>}
        <div style={{ flex: 1 }} />
        {canRecord && sel !== "me" && <button style={btn("primary")} onClick={() => setRec({ skillId: views.skills[0]?.id || "", day: todayISO(), result: "met", note: "", userIds: [] })}><Plus size={14} /> Record a check</button>}
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>Proficiency is separate from hours: each skill stays current for its interval after it's shown to standard. Checks come from verified drills or are recorded directly.</div>
      {rec && d && <div style={{ ...cardStyle, display: "grid", gap: 8, maxWidth: 760 }}>
        <H>Record a proficiency check</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          <label style={{ gridColumn: "span 2" }}><span style={label}>Skill</span><select aria-label="Skill" style={inputStyle} value={rec.skillId} onChange={e => setRec({ ...rec, skillId: e.target.value })}>{views.skills.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}</select></label>
          <label><span style={label}>Date</span><input aria-label="Check date" type="date" max={todayISO()} style={inputStyle} value={rec.day} onChange={e => setRec({ ...rec, day: e.target.value })} /></label>
          <label><span style={label}>Result</span><select aria-label="Result" style={inputStyle} value={rec.result} onChange={e => setRec({ ...rec, result: e.target.value })}><option value="met">Met the standard</option><option value="not_met">Not met: retrain</option></select></label>
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT }}>{views.skills.find(k => k.id === rec.skillId)?.standard}</div>
        <div><span style={label}>Who</span><div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{d.people.filter(p => p.id !== views.me || views.canVerify).map(p => <label key={p.id} style={{ fontSize: 13, display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" aria-label={`Check: ${p.name}`} checked={rec.userIds.includes(p.id)} onChange={e => setRec({ ...rec, userIds: e.target.checked ? [...rec.userIds, p.id] : rec.userIds.filter(x => x !== p.id) })} />{p.name}</label>)}</div></div>
        <input aria-label="Check note" placeholder="Note (optional)" style={inputStyle} value={rec.note} onChange={e => setRec({ ...rec, note: e.target.value })} />
        <Err e={error} />
        <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} disabled={!rec.userIds.length} onClick={async () => { try { const r = await call("/proficiency/check", rec); toast(`Recorded for ${r.added}.`); setRec(null); setError(""); load(); } catch (e) { setError(e.message); } }}>Save</button>
          <button style={btn("ghost")} onClick={() => setRec(null)}>Cancel</button></div>
      </div>}
      {!d ? (error ? <div style={{ ...cardStyle, color: BRICK }}>{error}</div> : <Loading />) : (
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%" }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={{ ...th, position: "sticky", left: 0, background: "#fff" }}>Member</th>
              {d.skills.map(k => <th key={k.id} title={`${k.standard} (every ${k.every} months)`} style={{ ...th, whiteSpace: "normal", minWidth: 92, maxWidth: 120, fontSize: 11.5 }}>{k.label}<div style={{ fontWeight: 500 }}>every {k.every} mo</div></th>)}</tr></thead>
            <tbody>{d.people.map(p => {
              const by = new Map(p.skills.map(x => [x.id, x]));
              return <tr key={p.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ ...td, position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap" }}><b>{p.name}</b><div style={{ fontSize: 11, color: INK_SOFT }}>{p.title}</div></td>
                {d.skills.map(k => { const x = by.get(k.id); if (!x) return <td key={k.id} style={{ ...td, color: "#B8C0CC", textAlign: "center" }}>n/a</td>;
                  const [l, c] = PROF[x.status] || ["", INK_SOFT];
                  return <td key={k.id} aria-label={`${p.name} ${k.label}: ${l}`} title={x.due ? `Due ${x.due}` : ""} style={{ ...td, textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: c, borderRadius: 6, padding: "2px 4px" }}>{l}</div>
                    {x.last && <div style={{ fontSize: 10.5, color: INK_SOFT, marginTop: 2 }}>{pretty(x.last, { month: "short", day: "numeric", year: "2-digit" })}</div>}
                    {x.pending && <div style={{ fontSize: 10.5, color: AMBER }}>newer check pending</div>}</td>; })}
              </tr>; })}</tbody>
          </table>
        </div>)}
    </div>
  );
}

// ---- Grading-year roster ---------------------------------------------------------------------------------
export function RosterPage({ views, roster: people, toast }) {
  const [year, setYear] = useState(new Date().getFullYear()), [d, setD] = useState(null), [error, setError] = useState(""), [edit, setEdit] = useState(null), [q, setQ] = useState("");
  const load = () => call(`/roster?year=${year}`).then(setD, e => setError(e.message));
  useEffect(() => { setD(null); load(); }, [year]);
  if (error && !d) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <Loading />;
  const rows = d.rows.filter(r => !q || `${r.name} ${r.title} ${r.station} ${r.shift}`.toLowerCase().includes(q.toLowerCase()));
  const start = `${year}-01-01`;
  const joined = d.rows.filter(r => r.joined > start).length, left = d.rows.filter(r => r.left).length;
  const save = async () => { try { await call("/roster", { ...edit, year }); toast("Saved."); setEdit(null); setError(""); load(); } catch (e) { setError(e.message); } };
  const yrs = [...new Set([d.current, d.current - 1, d.current - 2, ...d.years])].sort((a, b) => b - a);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select aria-label="Roster year" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...inputStyle, width: "auto" }}>{yrs.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <input aria-label="Search roster" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, maxWidth: 240 }} />
        <div style={{ flex: 1 }} />
        {views.canManage && !d.rows.length && <button style={btn("outline")} onClick={async () => { try { const r = await call("/roster/start", { year }); toast(`${r.added} people added from accounts.`); load(); } catch (e) { setError(e.message); } }}>Start {year} from today's accounts</button>}
        {views.canManage && <button style={btn("primary")} onClick={() => setEdit({ name: "", title: "", station: "", shift: "", joined: start, left: "", officer: false, driver: false, suppression: true, note: "" })}><Plus size={14} /> Add someone</button>}
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>
        PIAL grades the members on the roster during the graded year, including people who left or joined part-way through. {year === d.current ? "This year's roster follows " + PN + " accounts automatically (suppression divisions); rank, station and shift changes are noted. " : ""}Rows edited by hand stay as you set them.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat k="On the roster" v={d.rows.filter(r => r.suppression).length} sub={`${d.rows.filter(r => r.suppression && !r.left).length} still on it`} />
        <Stat k="Joined during the year" v={joined} /><Stat k="Left during the year" v={left} />
        <Stat k="Officers / drivers" v={`${d.rows.filter(r => r.officer).length} / ${d.rows.filter(r => r.driver).length}`} />
      </div>
      {edit && <div style={{ ...cardStyle, display: "grid", gap: 8, maxWidth: 860 }}>
        <H>{edit.id ? `Edit ${edit.name}` : "Add to the roster"}</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <label style={{ gridColumn: "span 2" }}><span style={label}>Name</span><input aria-label="Roster name" style={inputStyle} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} list="roster-people" /></label>
          <datalist id="roster-people">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
          <label><span style={label}>Title</span><input aria-label="Roster title" style={inputStyle} value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
          <label><span style={label}>Station</span><input aria-label="Roster station" style={inputStyle} value={edit.station} onChange={e => setEdit({ ...edit, station: e.target.value })} /></label>
          <label><span style={label}>Shift</span><select aria-label="Roster shift" style={inputStyle} value={edit.shift} onChange={e => setEdit({ ...edit, shift: e.target.value })}><option value="">—</option>{["A", "B", "C"].map(s => <option key={s}>{s}</option>)}</select></label>
          <label><span style={label}>On the roster from</span><input aria-label="Joined" type="date" style={inputStyle} value={edit.joined || ""} onChange={e => setEdit({ ...edit, joined: e.target.value })} /></label>
          <label><span style={label}>Left on</span><input aria-label="Left" type="date" style={inputStyle} value={edit.left || ""} onChange={e => setEdit({ ...edit, left: e.target.value })} /></label>
          <label><span style={label}>Hire date</span><input aria-label="Hire date" type="date" style={inputStyle} value={edit.hireDate || ""} onChange={e => setEdit({ ...edit, hireDate: e.target.value })} /></label>
          <label><span style={label}>Driver since</span><input aria-label="Driver since" type="date" style={inputStyle} value={edit.driverSince || ""} onChange={e => setEdit({ ...edit, driverSince: e.target.value })} /></label>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 13.5, flexWrap: "wrap" }}>
          <label><input type="checkbox" checked={edit.officer} onChange={e => setEdit({ ...edit, officer: e.target.checked })} /> Officer</label>
          <label><input type="checkbox" checked={edit.driver} onChange={e => setEdit({ ...edit, driver: e.target.checked })} /> Driver / operator</label>
          <label><input type="checkbox" aria-label="Counts for PIAL" checked={edit.suppression} onChange={e => setEdit({ ...edit, suppression: e.target.checked })} /> Counts for PIAL (suppression member)</label>
        </div>
        <input aria-label="Roster note" placeholder="Note (e.g. resigned, transferred to Comms)" style={inputStyle} value={edit.note} onChange={e => setEdit({ ...edit, note: e.target.value })} />
        <Err e={error} />
        <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} disabled={!edit.name} onClick={save}>Save</button><button style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
          {edit.id && <button style={{ ...btn("ghost"), color: BRICK }} onClick={async () => { if (!window.confirm(`Remove ${edit.name} from the ${year} roster?`)) return; try { await call(`/roster/${edit.id}/remove`, {}); setEdit(null); load(); } catch (e) { setError(e.message); } }}><Trash2 size={14} /> Remove</button>}</div>
      </div>}
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Name</th><th style={th}>Company</th><th style={th}>On the roster</th><th style={th}>Role</th><th style={th}>Changes</th>{views.canManage && <th style={th} />}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={6} style={{ ...td, color: INK_SOFT }}>Nobody on the {year} roster yet.</td></tr>}
            {rows.map(r => <tr key={r.id} style={{ borderBottom: `1px solid ${LINE}`, opacity: r.suppression ? 1 : 0.55 }}>
              <td style={td}><b>{r.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{r.title}{!r.userId ? " · no " + PN + " account" : ""}{!r.suppression ? " · not counted" : ""}</div></td>
              <td style={td}>{r.station ? `Sta ${r.station}` : "—"} {r.shift}</td>
              <td style={{ ...td, whiteSpace: "nowrap" }}>{r.joined > start ? `from ${pretty(r.joined, { month: "short", day: "numeric" })}` : "all year"}{r.left ? <div style={{ color: BRICK }}>left {pretty(r.left, { month: "short", day: "numeric" })}</div> : null}</td>
              <td style={td}>{[r.officer && "Officer", r.driver && "Driver", r.driverSince && r.driverSince.startsWith(String(year)) && "new driver"].filter(Boolean).join(", ") || "—"}</td>
              <td style={{ ...td, fontSize: 12, color: INK_SOFT }}>{r.changes.slice(-3).map((c, i) => <div key={i}>{pretty(c.at, { month: "short", day: "numeric" })}: {c.what}</div>)}{r.note && <div>{r.note}</div>}{r.locked && <div style={{ color: BLUE }}>edited by hand</div>}</td>
              {views.canManage && <td style={td}><button aria-label={`Edit roster ${r.name}`} style={btn("ghost")} onClick={() => setEdit({ ...r, left: r.left || "" })}><Pencil size={13} /></button></td>}
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- PIAL estimate --------------------------------------------------------------------------------------
export function PialEstimate({ year }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [only, setOnly] = useState("all");
  useEffect(() => { setD(null); call(`/pial?year=${year}`).then(setD, e => setError(e.message)); }, [year]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <Loading />;
  const e = d.estimate, c = d.current, cur = new Map(c.items.map(i => [i.key, i]));
  const rows = e.rows.filter(r => only === "all" || (only === "behind" ? !r.onPaceCompany : !r.meetsMinimum));
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 13, color: INK_SOFT }}>
        PIAL's training items (FSRS 580) worked out from {PN} training: FireWorks imports and verified drills, for the members on the {d.year.year} roster. {d.project ? "The year is still running, so hours are projected to the full year at the current pace. " : ""}
        {d.trainingSource === "nexus" ? "The PIAL tracker uses this data too." : "The PIAL tracker is set to use its own training imports; switch it in PIAL › Settings to use this instead."}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat k={"Training credit (" + PN + ")"} v={`${h1(e.training)} / 9`} sub={`${h1(e.trainingRaw)} before the 9-point cap`} tone={BLUE} />
        <Stat k="PIAL tracker now" v={`${h1(c.training)} / 9`} sub={d.trainingSource === "nexus" ? "same data" : "from its own imports"} />
        <Stat k="Members" v={e.members} sub={`${e.counts.officers} officers · ${e.counts.drivers} drivers${e.counts.newDrivers ? ` · ${e.counts.newDrivers} new` : ""}`} />
        <Stat k="Below 12 hrs" v={e.belowMinimum} tone={e.belowMinimum ? BRICK : SAGE} sub="minimum per member" />
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Item</th><th style={th}>Available</th><th style={th}>{PN} estimate</th><th style={th}>PIAL tracker</th><th style={th}>How</th></tr></thead>
          <tbody>{e.items.map(i => <tr key={i.key} style={{ borderBottom: `1px solid ${LINE}` }}>
            <td style={td}><b>{i.code}</b> {i.label}</td><td style={td}>{h1(i.max)}</td>
            <td style={{ ...td, fontWeight: 800, color: BLUE }}>{i.credit.toFixed(2)}{i.pct !== null ? <span style={{ fontWeight: 500, color: INK_SOFT }}> ({Math.round(i.pct * 100)}%)</span> : ""}</td>
            <td style={td}>{cur.get(i.key)?.credit.toFixed(2)}</td>
            <td style={{ ...td, fontSize: 12, color: INK_SOFT }}>{i.method}{i.detail?.[0] ? `: ${i.detail[0]}` : ""}{i.warn?.length ? <div style={{ color: AMBER }}>{i.warn.join(" ")}</div> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", alignItems: "center" }}>
          <b style={{ flex: 1, color: INK }}>Members (graded-year hours)</b>
          <select aria-label="Show members" value={only} onChange={x => setOnly(x.target.value)} style={{ ...inputStyle, width: "auto" }}>
            <option value="all">Everyone ({e.rows.length})</option><option value="behind">Behind on company training ({e.rows.filter(r => !r.onPaceCompany).length})</option>
            <option value="minimum">Under the 12-hour minimum ({e.rows.filter(r => !r.meetsMinimum).length})</option></select>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead><tr style={{ borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}><th style={th}>Member</th><th style={th}>Company (credited)</th><th style={th}>Facility</th><th style={th}>Officer</th><th style={th}>Driver</th><th style={th}>Hazmat</th><th style={th}>Total</th><th style={th}>IFSAC</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.name} style={{ borderBottom: `1px solid ${LINE}` }}>
            <td style={td}><b>{r.name}</b> <span style={{ color: INK_SOFT }}>{r.rank}</span></td>
            <td style={{ ...td, color: r.onPaceCompany ? SAGE : BRICK, fontWeight: 700 }}>{h1(r.companyCredited)} / {d.targets.company}</td>
            <td style={td}>{h1(r.facility)}</td><td style={td}>{h1(r.officerHrs)}</td><td style={td}>{h1(r.driverHrs)}</td><td style={td}>{h1(r.hazmat)}</td>
            <td style={{ ...td, color: r.meetsMinimum ? INK : BRICK }}>{h1(r.total)}</td><td style={td}>{r.ifsac ? "✓" : ""}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Settings: skills and roles -------------------------------------------------------------------------
export function SkillSettings({ views, toast, onDone }) {
  const [skills, setSkills] = useState(views.skills.map(k => ({ ...k }))), [roles, setRoles] = useState({ ...views.roles }), [error, setError] = useState("");
  const setK = (i, k) => setSkills(skills.map((x, j) => (j === i ? k : x)));
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000 }}>
      <div style={cardStyle}>
        <H sub="Job titles (patterns, | between words) decide who's a company officer, battalion chief or driver for the company and shift views, the drill log and the roster.">Roles</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
          {[["officer", "Company officers"], ["bc", "Battalion chiefs (see their whole shift)"], ["driver", "Drivers / operators"], ["rosterDivisions", "Divisions on the PIAL roster"]].map(([k, l]) =>
            <label key={k}><span style={label}>{l}</span><input aria-label={l} style={inputStyle} value={roles[k] || ""} onChange={e => setRoles({ ...roles, [k]: e.target.value })} /></label>)}
        </div>
      </div>
      <div style={cardStyle}>
        <H sub="Each skill stays current for its interval after a member shows it to standard." right={<button style={btn("outline")} onClick={() => setSkills([...skills, { id: "", label: "", every: 12, who: "", standard: "" }])}><Plus size={14} /> Skill</button>}>Proficiency skills</H>
        {skills.map((k, i) => <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 110px 1.3fr auto", gap: 6, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
          <input aria-label={`Skill ${i + 1} name`} style={inputStyle} value={k.label} onChange={e => setK(i, { ...k, label: e.target.value })} />
          <select aria-label={`Skill ${i + 1} interval`} style={inputStyle} value={k.every} onChange={e => setK(i, { ...k, every: Number(e.target.value) })}>{[1, 3, 6, 12, 24, 36].map(m => <option key={m} value={m}>every {m} mo</option>)}</select>
          <input aria-label={`Skill ${i + 1} who`} placeholder="Job titles (empty = everyone)" style={inputStyle} value={k.who} onChange={e => setK(i, { ...k, who: e.target.value })} />
          <button aria-label={`Remove skill ${i + 1}`} style={btn("ghost")} onClick={() => setSkills(skills.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          <input aria-label={`Skill ${i + 1} standard`} placeholder="Standard (what 'met' means)" style={{ ...inputStyle, gridColumn: "1 / -1" }} value={k.standard} onChange={e => setK(i, { ...k, standard: e.target.value })} />
        </div>)}
      </div>
      <Err e={error} />
      <div><button style={btn("primary")} onClick={async () => { try { await call("/proficiency/settings", { skills, roles }); toast("Saved."); setError(""); onDone(); } catch (e) { setError(e.message); } }}>Save</button></div>
    </div>
  );
}
