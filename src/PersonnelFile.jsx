// Personnel File: a person's profile details, the forms and cases filed about
// them, and their certifications. Everyone sees their own file; master admins
// and people with access to forms can look up others (the server decides what
// each person may see).
import AppShell from "./AppShell.jsx";
import { BRAND } from "./brand.js";
import { Folder, User, ShieldCheck, CalendarDays, Printer, Receipt, Crosshair } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton, loadShared, saveStrict, ROLE_LABEL, Stamp, money, reqAmount, fmtDate, reimbTotal, printReimbursement, ReqQuickView } from "./App.jsx";
import { C, STATUS_LABEL, STATUS_COLOR } from "./FormFields.jsx";
import { formsApi, FormFill, SubmissionView, CaseView } from "./Forms.jsx";

const when = iso => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const day = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

function certStatus(c) {
  if (!c.expirationDate) return ["No expiration", C.INK_SOFT];
  const days = (new Date(c.expirationDate) - new Date()) / 86400000;
  if (days < 0) return ["Expired", C.BRICK];
  if (days <= 60) return ["Expiring soon", C.AMBER];
  return ["Valid", C.SAGE];
}

function Profile({ person, me, roster, onSaved }) {
  const canEdit = me.role === "master" || me.id === person.id;
  const hasPrivate = "employeeNumber" in person;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [error, setError] = useState("");
  const start = () => {
    setF({
      employeeNumber: person.employeeNumber || "", jobTitle: person.jobTitle || "", station: person.station || "", hireDate: person.hireDate || "",
      street: person.address?.street || "", city: person.address?.city || "", state: person.address?.state || "LA", zip: person.address?.zip || "",
    });
    setEditing(true);
  };
  async function save() {
    const updated = {
      ...person, employeeNumber: f.employeeNumber.trim(), jobTitle: f.jobTitle.trim(), station: f.station.trim(), hireDate: f.hireDate,
      address: { street: f.street.trim(), city: f.city.trim(), state: f.state.trim(), zip: f.zip.trim() },
    };
    const next = roster.map(u => u.id === person.id ? updated : u);
    if (!(await saveStrict("roster", next))) { setError("The change wasn't saved."); return; }
    setEditing(false); onSaved(next);
  }
  const row = (label, value) => (
    <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.LINE}`, fontSize: 13.5 }}>
      <span style={{ color: C.INK_SOFT }}>{label}</span><span style={{ fontWeight: 500 }}>{value || <span style={{ color: "#9AA3B2" }}>—</span>}</span>
    </div>
  );
  if (editing) {
    const lab = { fontSize: 12, color: C.INK_SOFT, display: "flex", flexDirection: "column", gap: 3 };
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          <label style={lab}>Employee number<input aria-label="Employee number" style={inputStyle} value={f.employeeNumber} onChange={e => set("employeeNumber", e.target.value)} /></label>
          <label style={lab}>Job title<input aria-label="Job title" style={inputStyle} value={f.jobTitle} onChange={e => set("jobTitle", e.target.value)} /></label>
          <label style={lab}>Station / assignment<input aria-label="Station" style={inputStyle} value={f.station} onChange={e => set("station", e.target.value)} /></label>
          <label style={lab}>Hire date<input aria-label="Hire date" type="date" style={inputStyle} value={f.hireDate} onChange={e => set("hireDate", e.target.value)} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) 70px 100px", gap: 8, marginTop: 10 }}>
          <label style={lab}>Street<input aria-label="Street" style={inputStyle} value={f.street} onChange={e => set("street", e.target.value)} /></label>
          <label style={lab}>City<input aria-label="City" style={inputStyle} value={f.city} onChange={e => set("city", e.target.value)} /></label>
          <label style={lab}>State<input aria-label="State" style={inputStyle} value={f.state} onChange={e => set("state", e.target.value)} /></label>
          <label style={lab}>Zip<input aria-label="Zip" style={inputStyle} value={f.zip} onChange={e => set("zip", e.target.value)} /></label>
        </div>
        <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 8 }}>These fill in automatically on forms. Your address, hire date and employee number are visible only to you and master admins.</div>
        {error && <div style={{ color: C.BRICK, fontSize: 13, marginTop: 8 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={btn("primary")} onClick={save}>Save</button>
          <button style={btn("ghost")} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }
  const a = person.address || {};
  return (
    <div>
      {row("Division", person.division)}
      {row("Role", ROLE_LABEL[person.role])}
      {row("Job title", person.jobTitle)}
      {row("Station / assignment", person.station)}
      {row("Phone", person.phone)}
      {row("Email", person.email)}
      {hasPrivate && (
        <>
          {row("Employee number", person.employeeNumber)}
          {row("Hire date", day(person.hireDate))}
          {row("Address", [a.street, [a.city, a.state].filter(Boolean).join(", "), a.zip].filter(Boolean).join(" "))}
          {row("Emergency contact", [person.emergencyContactName, person.emergencyContactPhone].filter(Boolean).join(" · "))}
        </>
      )}
      {canEdit && <button style={{ ...btn("outline"), marginTop: 12 }} onClick={start}>Edit profile details</button>}
      {canEdit && <div style={{ fontSize: 12, color: C.INK_SOFT, marginTop: 6 }}>Phone, email and emergency contact are changed in the Directory.</div>}
    </div>
  );
}

function FilesTab({ person, onOpenCase, onOpenSubmission }) {
  const [cases, setCases] = useState(null);
  const [subs, setSubs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setCases(null); setSubs(null);
    formsApi(`/cases?subject=${person.id}`).then(r => setCases(r.cases), e => setError(e.message));
    formsApi(`/submissions?subject=${person.id}`).then(r => setSubs(r.submissions), e => setError(e.message));
  }, [person.id]);
  if (error) return <div style={{ color: C.BRICK }}>{error}</div>;
  if (!cases || !subs) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  const loose = subs.filter(s => !s.caseId);
  const forms = [...new Set(loose.map(s => s.formTitle))].sort();
  return (
    <div>
      {cases.length === 0 && loose.length === 0 && <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>No forms on file that you can see.</div>}
      {cases.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>Cases</div>
          {cases.map(c => (
            <div key={c.id} role="button" aria-label={`Open case ${c.title}`} onClick={() => onOpenCase(c.id)}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 10px", border: `1px solid ${C.LINE}`, borderLeft: `4px solid ${C.BRICK}`, borderRadius: 6, marginBottom: 6, cursor: "pointer", background: "#fff", flexWrap: "wrap" }}>
              <span><b>{c.title}</b> <span style={{ color: C.INK_SOFT, fontSize: 12.5 }}>· {c.done} part{c.done === 1 ? "" : "s"} done{c.pending ? `, ${c.pending} waiting` : ""}</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c.status === "open" ? C.AMBER : C.SAGE }}>{c.status === "open" ? "Open" : "Closed"}</span>
            </div>
          ))}
        </div>
      )}
      {forms.map(title => (
        <div key={title} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{title}</div>
          {loose.filter(s => s.formTitle === title).map(s => (
            <div key={s.id} role="button" aria-label={`Open ${title} from ${when(s.submittedAt)}`} onClick={() => onOpenSubmission(s.id)}
              style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: `1px solid ${C.LINE}`, borderRadius: 6, marginBottom: 6, cursor: "pointer", background: "#fff", fontSize: 13.5, flexWrap: "wrap" }}>
              <span>{when(s.submittedAt)} <span style={{ color: C.INK_SOFT }}>· {s.submittedByName || "Anonymous"}</span></span>
              <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[s.status] }}>{STATUS_LABEL[s.status]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Leave picks filed when someone's picks were completed (server/leave.js leave_records)
const CODE_NAME = { OH: "Holiday", OV: "Vacation", OC: "Banked / comp", "??": "More than available" };
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const longDay = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
function printRecord(r) {
  const w = window.open("", "_blank");
  if (!w) return;
  const rows = r.lines.map(l => `<tr><td>${esc(longDay(l.day))}</td><td>${r.ruleset === "comms" ? esc(l.start) : ""}</td><td>${esc(l.hours)}</td><td>${esc(l.code)} (${esc(CODE_NAME[l.code] || l.code)})</td><td>${l.bumped ? "Over the daily limit" : ""}</td></tr>`).join("");
  const tot = ["OH", "OV", "OC"].filter(k => r.totals[k]).map(k => `${CODE_NAME[k]}: ${r.totals[k]} h`).join(" · ");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.name)} leave picks ${r.year}</title>
    <style>body{font:14px/1.4 Arial,sans-serif;color:#13233F;margin:32px}h1{font-size:20px;margin:0}table{border-collapse:collapse;width:100%;margin-top:14px}
    th,td{border:1px solid #BCC4D0;padding:6px 8px;text-align:left}th{background:#E6ECF5}.sig{margin-top:40px;display:flex;gap:40px}.sig div{flex:1;border-top:1px solid #13233F;padding-top:4px;font-size:12px}</style></head>
    <body><h1>${BRAND.org}: ${r.year} Leave Picks</h1>
    <div style="margin-top:8px"><b>${esc(r.name)}</b> · ${esc(r.unit)}</div>
    <div style="font-size:12.5px;color:#4B5565">Completed ${esc(new Date(r.filedAt).toLocaleDateString())}${r.revisions ? ` · updated ${esc(new Date(r.updatedAt).toLocaleDateString())}` : ""} · ${esc(tot)} · ${r.totals.total || 0} h total</div>
    <table><thead><tr><th>Date</th><th>Start</th><th>Hours</th><th>Leave type</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No leave picked.</td></tr>'}</tbody></table>
    <div class="sig"><div>Employee signature / date</div><div>Supervisor signature / date</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
function LeaveTab({ person }) {
  const [recs, setRecs] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRecs(null); setError("");
    fetch(`/api/leave/records?user=${person.id}`, { credentials: "same-origin" }).then(r => r.ok ? r.json() : r.json().then(x => Promise.reject(new Error(x.error || "Couldn't load leave picks."))))
      .then(r => setRecs(r.records || []), e => setError(e.message));
  }, [person.id]);
  if (error) return <div style={{ color: C.BRICK }}>{error}</div>;
  if (!recs) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  if (!recs.length) return <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>No completed leave picks on file that you can see. When someone finishes their picks in Leave Picks, a copy is filed here.</div>;
  return (
    <div>
      {recs.map(r => (
        <div key={r.id} style={{ border: `1px solid ${C.LINE}`, borderRadius: 8, padding: 12, marginBottom: 12, background: "#fff" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <b style={{ fontSize: 15.5, flex: 1 }}>{r.year} leave picks · {r.unit}</b>
            <span style={{ fontSize: 12, fontWeight: 700, color: r.status === "complete" ? C.SAGE : C.AMBER }}>{r.status === "complete" ? "Complete" : "Reopened (being changed)"}</span>
            <button style={{ ...btn("outline"), padding: "3px 10px", fontSize: 12.5 }} aria-label={`Print ${r.year} leave picks`} onClick={() => printRecord(r)}><Printer size={13} /> Print</button>
          </div>
          <div style={{ fontSize: 12.5, color: C.INK_SOFT, margin: "2px 0 8px" }}>
            Filed {when(r.filedAt)}{r.revisions ? ` · updated ${when(r.updatedAt)}` : ""} · {["OH", "OV", "OC"].filter(k => r.totals[k]).map(k => `${CODE_NAME[k]} ${r.totals[k]} h`).join(" · ") || "no leave"}
          </div>
          <table aria-label={`${r.year} leave picks`} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: C.INK_SOFT, fontSize: 12 }}><th style={{ padding: "4px 6px" }}>Date</th>{r.ruleset === "comms" && <th style={{ padding: "4px 6px" }}>Start</th>}<th style={{ padding: "4px 6px" }}>Hours</th><th style={{ padding: "4px 6px" }}>Type</th></tr></thead>
            <tbody>{r.lines.map((l, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.LINE}` }}>
                <td style={{ padding: "4px 6px" }}>{day(l.day)}</td>{r.ruleset === "comms" && <td style={{ padding: "4px 6px" }}>{l.start}</td>}
                <td style={{ padding: "4px 6px" }}>{l.hours}</td>
                <td style={{ padding: "4px 6px" }}><b>{l.code}</b> {CODE_NAME[l.code] || ""}{l.bumped ? <span style={{ color: C.BRICK }}> · over the daily limit</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// Requisitions and reimbursements the person asked for: a quick record of what they submitted and where it stands
const REIMB_LABEL = { pending_approval: "Awaiting approval", approved: "Approved", rejected: "Rejected", paid: "Paid" };
const REIMB_COLOR = { pending_approval: C.AMBER, approved: C.SAGE, rejected: C.BRICK, paid: C.BRASS };
function PurchasesTab({ person, onOpenModule }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [view, setView] = useState(null), [year, setYear] = useState("");
  useEffect(() => {
    setD(null); setError("");
    fetch(`/api/personnel/purchases?user=${person.id}`, { credentials: "same-origin" }).then(r => r.json().then(x => (r.ok ? x : Promise.reject(new Error(x.error || "Couldn't load them.")))))
      .then(setD, e => setError(e.message));
  }, [person.id]);
  if (error) return <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>{error}</div>;
  if (!d) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  const yr = x => String(new Date(x).getFullYear());
  const years = [...new Set([...d.requisitions.map(r => yr(r.createdAt)), ...d.reimbursements.map(r => yr(r.createdAt))])].sort().reverse();
  const reqs = d.requisitions.filter(r => !year || yr(r.createdAt) === year), reimb = d.reimbursements.filter(r => !year || yr(r.createdAt) === year);
  const head = { fontSize: 12, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0 6px" };
  const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${C.LINE}`, borderRadius: 6, marginBottom: 6, background: "#fff", fontSize: 13.5, flexWrap: "wrap", cursor: "pointer" };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.INK_SOFT, flex: 1 }}>Everything {person.name.split(" ")[0]} submitted, newest first, with where it stands now. Click one to see it.</span>
        {years.length > 1 && <select aria-label="Year" style={{ ...inputStyle, width: "auto" }} value={year} onChange={e => setYear(e.target.value)}><option value="">All years</option>{years.map(y => <option key={y}>{y}</option>)}</select>}
      </div>
      <div style={head}>Requisitions ({reqs.length})</div>
      {!reqs.length && <div style={{ fontSize: 13.5, color: C.INK_SOFT }}>None.</div>}
      {reqs.map(r => (
        <div key={r.id} role="button" tabIndex={0} aria-label={`View requisition ${r.title}`} onClick={() => setView(r)} onKeyDown={e => { if (e.key === "Enter") setView(r); }} style={rowStyle}>
          <span><b>{r.title}</b> <span style={{ color: C.INK_SOFT, fontSize: 12.5 }}>· {r.vendor} · {fmtDate(r.createdAt)}</span></span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}><b>{money(reqAmount(r))}</b><Stamp status={r.status} /></span>
        </div>
      ))}
      <div style={head}>Reimbursements ({reimb.length})</div>
      {!reimb.length && <div style={{ fontSize: 13.5, color: C.INK_SOFT }}>None.</div>}
      {reimb.map(r => (
        <div key={r.id} role="button" tabIndex={0} aria-label={`Print reimbursement ${r.reason}`} title="Print this request" onClick={() => printReimbursement(r, d.mileageRate)} style={rowStyle}>
          <span><b>{r.reason}</b> <span style={{ color: C.INK_SOFT, fontSize: 12.5 }}>· {r.type === "travel" ? "Travel" : "Non-travel"} · {fmtDate(r.createdAt)}{r.paidDate ? ` · paid ${fmtDate(r.paidDate)}` : ""}</span></span>
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}><b>{money(reimbTotal(r, d.mileageRate))}</b>
            <span style={{ fontSize: 12, fontWeight: 700, color: REIMB_COLOR[r.status] }}>{REIMB_LABEL[r.status]}</span></span>
        </div>
      ))}
      {view && <ReqQuickView r={view} onClose={() => setView(null)} onOpenFull={() => { setView(null); onOpenModule("procurement"); }} />}
    </div>
  );
}

// Command boards this person completed as incident commander (or opened), each with its after-action report
function CommandTab({ person }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => {
    setD(null); setError("");
    fetch(`/api/command/person/${person.id}`, { credentials: "same-origin" }).then(r => r.json().then(x => (r.ok ? x : Promise.reject(new Error(x.error || "Couldn't load them.")))))
      .then(setD, e => setError(e.message));
  }, [person.id]);
  if (error) return <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>{error}</div>;
  if (!d) return <div style={{ color: C.INK_SOFT }}>Loading…</div>;
  if (!d.boards.length) return <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>No command boards yet.</div>;
  return (
    <div>
      {d.boards.map(b => (
        <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "8px 10px", border: `1px solid ${C.LINE}`, borderRadius: 6, marginBottom: 6, fontSize: 13.5, flexWrap: "wrap" }}>
          <span><b>{b.kind === "training" ? "Training: " : ""}{b.title || b.nature || "Fire call"}</b> <span style={{ color: C.INK_SOFT, fontSize: 12.5 }}>{b.number ? `· #${b.number} ` : ""}· {b.address} · {when(b.openedAt)} · {b.role === "completed" ? (b.kind === "training" ? "Ran the training (saved it)" : "Incident commander (closed the board)") : b.status === "open" ? "Opened (still open)" : `Opened; closed by ${b.completedBy}`}</span></span>
          <a href={`/api/command/${b.id}/report`} target="_blank" rel="noopener noreferrer" style={{ ...btn("outline"), textDecoration: "none" }}><Printer size={13} /> After-action report</a>
        </div>
      ))}
    </div>
  );
}

export default function PersonnelFileModule({ onBack, onOpenModule }) {
  const [me, setMe] = useState(null);
  const [roster, setRoster] = useState([]);
  const [certs, setCerts] = useState([]);
  const [canBrowse, setCanBrowse] = useState(false);
  const [personId, setPersonId] = useState(null);
  const [tab, setTab] = useState("forms");
  const [view, setView] = useState(null);   // { kind: case|submission|task, id }
  const [taskFill, setTaskFill] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const [r, c, defs] = await Promise.all([
        loadShared("roster", []), loadShared("certifications", []),
        formsApi("/definitions").catch(() => ({ definitions: [], myAccess: [] })),
      ]);
      let id = null;
      try { const x = await window.storage.get("current-identity", false); id = x ? x.value : null; } catch (e) {}
      const meRow = r.find(u => u.id === id) || null;
      setRoster(r); setCerts(c); setMe(meRow); setPersonId(id);
      const recipient = (defs.definitions || []).some(d => (d.settings?.recipients || []).includes(id));
      setCanBrowse(meRow?.role === "master" || (defs.myAccess || []).length > 0 || recipient);
    })();
  }, []);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...roster].filter(u => !q || `${u.name} ${u.division}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, search]);
  if (!me) return <div style={wrapStyle}><StyleBlock /><div style={{ color: C.INK_SOFT }}>Loading…</div></div>;
  const person = roster.find(u => u.id === personId) || me;
  const myCerts = certs.filter(c => c.personId === person.id);

  async function openTask(taskId) {
    const r = await formsApi(`/tasks/${taskId}`);
    setTaskFill(r); setView({ kind: "task", id: taskId });
  }
  let detail;
  if (view?.kind === "case") detail = <CaseView id={view.id} me={me} roster={roster} onBack={() => setView(null)} onOpenSubmission={id => setView({ kind: "submission", id, back: view })} onFillTask={openTask} />;
  else if (view?.kind === "submission") detail = <SubmissionView id={view.id} me={me} roster={roster} onBack={() => setView(view.back || null)} onOpenCase={id => setView({ kind: "case", id })} />;
  else if (view?.kind === "task" && taskFill) detail = <FormFill def={taskFill.definition} me={me} roster={roster} context={taskFill.context} taskId={view.id} onCancel={() => setView(null)} onDone={r => setView(r.canViewCase ? { kind: "case", id: r.caseId } : { kind: "submission", id: r.id })} />;

  const shellNav = [
    { key: "forms", label: "Forms & cases", icon: Folder },
    { key: "profile", label: "Profile", icon: User },
    { key: "certs", label: `Certifications (${myCerts.length})`, icon: ShieldCheck },
    { key: "leave", label: "Leave picks", icon: CalendarDays },
    { key: "purchases", label: "Requisitions & reimbursements", icon: Receipt },
    { key: "command", label: "Command boards", icon: Crosshair },
  ];
  const shellGo = k => { setTab(k); setView(null); };

  return (
    <AppShell section="Personnel File" nav={shellNav} active={tab} onNav={shellGo} onHome={onBack}>
      <div>
        <div style={sectionTitle}>{person.id === me.id ? "My file" : `${person.name}'s file`}</div>
        <div style={{ fontSize: 13, color: C.INK_SOFT, marginTop: 2, marginBottom: 14 }}>
          {canBrowse ? "Choose a person to see their file. You see only the forms you have access to." : "Your profile details, the forms filed about you, and your certifications."}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {canBrowse && (
            <div style={{ ...cardStyle, padding: 12, width: 280, flexShrink: 0, maxHeight: "75vh", overflowY: "auto" }}>
              <input type="search" aria-label="Search people" placeholder="Search people…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
              {people.map(u => (
                <div key={u.id} role="button" aria-label={`Open file for ${u.name}`} onClick={() => { setPersonId(u.id); setView(null); }}
                  style={{ padding: "7px 9px", borderRadius: 6, cursor: "pointer", background: u.id === person.id ? "#E6ECF5" : "transparent", fontWeight: u.id === person.id ? 700 : 400, fontSize: 13.5 }}>
                  {u.name}{u.id === me.id ? " (me)" : ""}
                  <div style={{ fontSize: 11.5, color: C.INK_SOFT, fontWeight: 400 }}>{u.division}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: "1 1 600px", minWidth: 0 }}>
            {detail || (
              <div style={cardStyle}>
                <div style={{ fontSize: 19, fontWeight: 700 }}>{person.name}</div>
                <div style={{ fontSize: 13, color: C.INK_SOFT }}>{[person.jobTitle, person.division].filter(Boolean).join(" · ")}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: C.INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, margin: "16px 0 10px", borderBottom: `2px solid ${C.BRICK}`, paddingBottom: 4 }}>
                  {(shellNav.find(n => n.key === tab) || shellNav[0]).label}
                </div>
                {tab === "leave" && <LeaveTab person={person} />}
                {tab === "command" && <CommandTab person={person} />}
                {tab === "purchases" && <PurchasesTab person={person} onOpenModule={onOpenModule} />}
                {tab === "profile" && <Profile person={person} me={me} roster={roster} onSaved={setRoster} />}
                {tab === "forms" && <FilesTab person={person} onOpenCase={id => setView({ kind: "case", id })} onOpenSubmission={id => setView({ kind: "submission", id })} />}
                {tab === "certs" && (
                  <div>
                    {myCerts.length === 0 && <div style={{ color: C.INK_SOFT, fontSize: 13.5 }}>No certifications on file.</div>}
                    {myCerts.map(c => {
                      const [label, color] = certStatus(c);
                      return (
                        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.LINE}`, fontSize: 13.5, flexWrap: "wrap" }}>
                          <span><b>{c.certName}</b>{c.issuingOrg ? <span style={{ color: C.INK_SOFT }}> · {c.issuingOrg}</span> : null}
                            <div style={{ fontSize: 12, color: C.INK_SOFT }}>Completed {day(c.completionDate)}{c.expirationDate ? ` · expires ${day(c.expirationDate)}` : ""}</div></span>
                          <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
                        </div>
                      );
                    })}
                    <button style={{ ...btn("outline"), marginTop: 12 }} onClick={() => onOpenModule("certifications")}>Open Certifications</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
