// Training section: training hours (mine, today's crew, everyone) against ISO / state / department / EMS
// requirements, FireWorks imports, classroom bookings with apparatus rotations, and the apparatus list.
// Server: server/training.js, server/bookings.js.
import React, { useEffect, useMemo, useState } from "react";
import { GraduationCap, Users, UserCheck, Upload, Plus, Settings, School, Truck, X, Trash2, Info, ChevronLeft, Printer, ClipboardList, ListChecks, Building2, Award, History, BarChart3 } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, printDocument, letterhead, escapeHtml } from "./App.jsx";
import { PeoplePicker } from "./FormFields.jsx";
import { DrillsPage, DrillEditor, DrillView, CompanyView, ShiftView, ProficiencyPage, RosterPage, PialEstimate, SkillSettings } from "./TrainingPlus.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const todayISO = () => new Date().toLocaleDateString("en-CA");
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
const pretty = (d, o = { weekday: "short", month: "short", day: "numeric" }) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", o);
const h1 = n => (Math.round(n * 10) / 10).toLocaleString("en-US");
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", whiteSpace: "nowrap" }, td = { padding: "7px 9px", verticalAlign: "top" };
const GROUP_COLOR = { ISO: BLUE, State: "#7A4FB5", EMS: BRICK, Department: SAGE };
const fileData = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });

function Bar({ pct, color, pace }) {
  return (
    <div style={{ position: "relative", height: 8, background: "#E6EAF0", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
      {pace !== null && pace !== undefined && <div title="Where they should be by now" style={{ position: "absolute", top: 0, bottom: 0, left: `${pace}%`, width: 2, background: INK }} />}
    </div>
  );
}
function ReqCard({ r }) {
  const done = r.missing === 0;
  const color = done ? SAGE : r.behind ? BRICK : AMBER;
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: GROUP_COLOR[r.group] || INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{r.group}</span>
        <span style={{ fontWeight: 700, color: INK, flex: 1 }}>{r.label}</span>
        <span style={{ fontSize: 11.5, color: INK_SOFT }}>{r.window}</span>
      </div>
      <Bar pct={r.pct} color={color} pace={r.pace !== null && r.required ? Math.min(100, 100 * r.pace / r.required) : null} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginTop: 5 }}>
        <span><b>{h1(r.done)}</b> of {h1(r.required)} h</span>
        <span style={{ color, fontWeight: 700 }}>{done ? "Done" : `${h1(r.missing)} h to go${r.behind ? " · behind pace" : ""}`}</span>
      </div>
    </div>
  );
}
export function MissingChips({ reqs }) {
  const miss = reqs.filter(r => r.missing > 0);
  if (!miss.length) return <span style={{ color: SAGE, fontWeight: 700, fontSize: 12.5 }}>All requirements met</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {miss.map(r => (
        <span key={r.id} title={`${r.done} of ${r.required} h (${r.window})`} style={{ fontSize: 11.5, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap",
          background: r.behind ? "#FDECEE" : "#FFF4DE", color: r.behind ? BRICK : "#8A5A00", fontWeight: 600 }}>{r.label} −{h1(r.missing)}</span>
      ))}
    </div>
  );
}

// ---- One person ------------------------------------------------------------------------------------
function PersonView({ query, year, onBack, canEdit, onChanged }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  const load = () => call(`/training/person?${new URLSearchParams({ ...query, year })}`).then(setD, e => setError(e.message));
  useEffect(() => { load(); }, [JSON.stringify(query), year]);
  async function remove(r) {
    if (!window.confirm(`Remove ${r.hours} h "${r.topic || r.category}" on ${pretty(r.day)}?`)) return;
    try { await call(`/training/records/${r.id}/remove`, {}); load(); onChanged?.(); } catch (e) { setError(e.message); }
  }
  if (error) return <div style={cardStyle}><div style={{ color: BRICK }}>{error}</div></div>;
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  return (
    <div>
      {onBack && <button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}><ChevronLeft size={15} /> Back</button>}
      <div style={{ ...cardStyle, marginTop: 6 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: INK, flex: 1 }}>{d.person.name}</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>{d.person.title}{d.person.title ? " · " : ""}<b style={{ color: INK }}>{h1(d.totalHours)} h</b> logged in {year}</div>
          <button style={btn("outline")} onClick={() => printPerson(d, year)}><Printer size={14} /> Print</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, marginTop: 12 }}>
          {d.requirements.map(r => <ReqCard key={r.id} r={r} />)}
          {!d.requirements.length && <div style={{ color: INK_SOFT, fontSize: 13 }}>No requirements apply (check job title and division in the Directory).</div>}
        </div>
      </div>
      <div style={{ ...cardStyle, marginTop: 12, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Date</th><th style={th}>Class</th><th style={th}>Certification · subject</th><th style={th}>Hours</th><th style={th}>Source</th>{canEdit && <th style={th} />}</tr></thead>
          <tbody>
            {d.records.length === 0 && <tr><td style={{ ...td, color: INK_SOFT }} colSpan={6}>No training recorded in {year}.</td></tr>}
            {d.records.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{pretty(r.day)}</td>
                <td style={td}>{r.topic || "—"}{r.instructor ? <div style={{ fontSize: 11.5, color: INK_SOFT }}>{r.instructor}</div> : null}</td>
                <td style={{ ...td, color: INK_SOFT, fontSize: 12.5 }}>{[r.certification, r.category].filter(Boolean).join(" · ") || "—"}{r.fw_category ? <div style={{ fontSize: 11.5 }}>Category: {r.fw_category}</div> : null}</td>
                <td style={{ ...td, fontWeight: 700 }}>{h1(r.hours)}</td>
                <td style={{ ...td, fontSize: 12, color: INK_SOFT }}>{r.source === "fireworks" ? "FireWorks" : r.source === "drill" ? "Drill (verified)" : "Entered"}</td>
                {canEdit && <td style={td}><button aria-label={`Remove ${r.topic || r.category} ${r.day}`} onClick={() => remove(r)} style={{ border: "none", background: "none", color: BRICK, cursor: "pointer" }}><Trash2 size={14} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function printPerson(d, year) {
  const reqs = d.requirements.map(r => `<tr><td>${escapeHtml(r.group)}</td><td>${escapeHtml(r.label)}</td><td>${escapeHtml(r.window)}</td><td style="text-align:right">${h1(r.done)}</td><td style="text-align:right">${h1(r.required)}</td><td>${r.missing ? `${h1(r.missing)} h to go` : "Done"}</td></tr>`).join("");
  const recs = d.records.map(r => `<tr><td>${r.day}</td><td>${escapeHtml(r.topic)}</td><td>${escapeHtml([r.certification, r.category].filter(Boolean).join(" · "))}</td><td style="text-align:right">${h1(r.hours)}</td></tr>`).join("");
  printDocument(`Training — ${d.person.name}`, `${letterhead(`Training record ${year}`)}<h1>${escapeHtml(d.person.name)}</h1><div class="meta">${escapeHtml(d.person.title || "")} · ${h1(d.totalHours)} hours in ${year}</div>
    <h2>Requirements</h2><table><thead><tr><th>Group</th><th>Requirement</th><th>Period</th><th style="text-align:right">Done</th><th style="text-align:right">Required</th><th></th></tr></thead><tbody>${reqs}</tbody></table>
    <h2>Classes</h2><table><thead><tr><th>Date</th><th>Class</th><th>Certification · subject</th><th style="text-align:right">Hours</th></tr></thead><tbody>${recs}</tbody></table>`);
}

// ---- Crew / everyone table -----------------------------------------------------------------------
function PeopleTable({ rows, onOpen, extra }) {
  const [q, setQ] = useState(""), [only, setOnly] = useState("all");
  const shown = rows.filter(p => (!q || `${p.name} ${p.title} ${p.division || ""}`.toLowerCase().includes(q.toLowerCase()))
    && (only === "all" || (only === "missing" ? p.missingCount > 0 : p.behindCount > 0)));
  return (
    <div style={{ ...cardStyle, padding: 0 }}>
      <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap", alignItems: "center", borderBottom: `1px solid ${LINE}` }}>
        <input aria-label="Search people" placeholder="Search name, title…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }} />
        <select aria-label="Show" value={only} onChange={e => setOnly(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
          <option value="all">Everyone ({rows.length})</option>
          <option value="missing">Missing hours ({rows.filter(p => p.missingCount).length})</option>
          <option value="behind">Behind pace ({rows.filter(p => p.behindCount).length})</option>
        </select>
        {extra}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Name</th><th style={th}>Hours this year</th><th style={th}>Missing</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={3} style={{ ...td, color: INK_SOFT }}>Nobody to show.</td></tr>}
            {shown.map(p => (
              <tr key={p.userId || p.id || p.name} style={{ borderBottom: `1px solid ${LINE}`, cursor: "pointer" }} onClick={() => onOpen(p)}>
                <td style={td}><span style={{ fontWeight: 700, color: INK }}>{p.name}</span>
                  {p.onNow && <span style={{ fontSize: 10.5, fontWeight: 800, color: SAGE, marginLeft: 6 }}>ON NOW</span>}
                  {p.trade && <span style={{ fontSize: 10.5, fontWeight: 800, color: AMBER, marginLeft: 6 }}>TRADE</span>}
                  <div style={{ fontSize: 11.5, color: INK_SOFT }}>{[p.title, p.schedules?.join(", ")].filter(Boolean).join(" · ")}{!p.userId && p.schedules ? " · no " + PN + " account" : ""}</div></td>
                <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{h1(p.totalHours)} h</td>
                <td style={td}><MissingChips reqs={p.requirements} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function Crew({ year, onOpen }) {
  const [d, setD] = useState(null), [error, setError] = useState("");
  useEffect(() => { call(`/training/crew?year=${year}`).then(setD, e => setError(e.message)); }, [year]);
  if (error) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading today's roster…</div>;
  if (!d.configured) return <div style={cardStyle}>Today's crew comes from Aladtec, which isn't connected yet (Directory › Aladtec setup).</div>;
  return (
    <>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "0 0 10px" }}>
        Everyone on today's Aladtec schedule{d.shiftDay ? ` (shift starting ${d.shiftDay})` : ""}, A–Z by last name. People on time off are left out.
        {d.updatedAt ? ` Roster checked ${new Date(d.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
        {d.error && <span style={{ color: BRICK }}> Aladtec: {d.error}</span>}
      </div>
      <PeopleTable rows={d.crew} onOpen={onOpen} extra={<button style={btn("outline")} onClick={() => printCrew(d, year)}><Printer size={14} /> Print</button>} />
    </>
  );
}
function printCrew(d, year) {
  const rows = d.crew.map(p => `<tr><td><b>${escapeHtml(p.name)}</b><br><span style="color:#666;font-size:11px">${escapeHtml(p.title || "")}</span></td><td style="text-align:right">${h1(p.totalHours)}</td>
    <td>${p.requirements.filter(r => r.missing > 0).map(r => `${escapeHtml(r.label)} −${h1(r.missing)}`).join("; ") || "All met"}</td></tr>`).join("");
  printDocument("Today's crew — training", `${letterhead(`Today's crew: training ${year}`)}<h1>${pretty(todayISO(), { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h1>
    <table><thead><tr><th>Name</th><th style="text-align:right">Hours ${year}</th><th>Missing</th></tr></thead><tbody>${rows}</tbody></table>`);
}

// ---- Enter hours ---------------------------------------------------------------------------------
function EnterHours({ roster, categories, toast, onDone }) {
  const [f, setF] = useState({ userIds: [], day: todayISO(), hours: "", certification: "", category: "", fwCategory: "", topic: "", instructor: "" });
  const [q, setQ] = useState(""), [content, setContent] = useState(null);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  useEffect(() => { const t = setTimeout(() => call(`/training/content?q=${encodeURIComponent(q)}`).then(setContent, () => setContent({ content: [], total: 0 })), 250); return () => clearTimeout(t); }, [q]);
  async function save() {
    try { const r = await call("/training/records", { ...f, hours: Number(f.hours) }); toast(`Saved for ${r.added} ${r.added === 1 ? "person" : "people"}.`); setF(x => ({ ...x, userIds: [] })); onDone(); }
    catch (e) { toast(e.message); }
  }
  return (
    <div style={{ ...cardStyle, maxWidth: 760 }}>
      <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Enter training hours</div>
      <div style={{ display: "grid", gap: 12 }}>
        <div><span style={label}>Who attended</span><PeoplePicker roster={roster} value={f.userIds} onChange={v => set("userIds", v)} label="Attendees" /></div>
        {content && content.total > 0 && (
          <div>
            <span style={label}>Class (from the FireWorks content list, optional)</span>
            <input aria-label="Find a class" placeholder="Search content titles…" value={q} onChange={e => setQ(e.target.value)} style={inputStyle} />
            {q && (content.content || []).length > 0 && (
              <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, maxHeight: 200, overflowY: "auto", marginTop: 4 }}>
                {content.content.map((c, i) => (
                  <button key={i} type="button" onClick={() => { setF(x => ({ ...x, certification: c.certification, category: c.subject, topic: c.title, hours: c.auto ? String(c.auto) : x.hours })); setQ(""); }}
                    style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${LINE}`, background: "#fff", padding: "6px 10px", cursor: "pointer", fontSize: 13 }}>
                    <b>{c.title}</b> <span style={{ color: INK_SOFT }}>· {c.certification} · {c.subject}{c.auto ? ` · ${c.auto} h` : ""}</span></button>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <label><span style={label}>Date</span><input aria-label="Date" type="date" style={inputStyle} value={f.day} onChange={e => set("day", e.target.value)} /></label>
          <label><span style={label}>Hours each</span><input aria-label="Hours" type="number" step="0.25" min="0" style={inputStyle} value={f.hours} onChange={e => set("hours", e.target.value)} /></label>
          <label><span style={label}>Instructor</span><input aria-label="Instructor" style={inputStyle} value={f.instructor} onChange={e => set("instructor", e.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Class / content title</span><input aria-label="Class" style={inputStyle} value={f.topic} onChange={e => set("topic", e.target.value)} /></label>
          <label><span style={label}>Certification</span><input aria-label="Certification" style={inputStyle} value={f.certification} onChange={e => set("certification", e.target.value)} placeholder="01 PIAL - Firefighter/Operator" /></label>
          <label><span style={label}>Subject</span><input aria-label="Subject" style={inputStyle} value={f.category} onChange={e => set("category", e.target.value)} placeholder="Company, Hazmat, Driver…" /></label>
          {categories.length > 0 && <label><span style={label}>FireWorks category</span><select aria-label="FireWorks category" style={inputStyle} value={f.fwCategory} onChange={e => set("fwCategory", e.target.value)}>
            <option value="">—</option>{categories.filter(c => !c.archived).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>}
        </div>
        <div style={{ fontSize: 12, color: INK_SOFT }}>Most hours should come from FireWorks (Import). Use this for classes that aren't in FireWorks yet.</div>
        <div><button style={btn("primary")} onClick={save} disabled={!f.userIds.length || !f.hours}>Save hours</button></div>
      </div>
    </div>
  );
}

// ---- Import ----------------------------------------------------------------------------------------
function ImportPage({ d, toast, onDone }) {
  const [file, setFile] = useState(null), [prev, setPrev] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(preview) {
    setBusy(true); setError("");
    try {
      const data = await fileData(file);
      const r = await call("/training/import", { fileName: file.name, data, preview });
      if (preview) setPrev(r.preview);
      else { toast(`Imported ${r.imported.newRows} rows (${r.imported.hours} h).`); setPrev(null); setFile(null); onDone(); }
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Import training from FireWorks</div>
        <div style={{ fontSize: 13, color: INK_SOFT, margin: "4px 0 12px" }}>
          Export the training records report from FireWorks as Excel or CSV: one row per person per class, with the person (name or employee ID), date and hours.
          Certification, Subject and Content Title are used when they're there{d.contentCount ? "; when only the title is there, the content list fills in the rest" : ""}.
          Importing the same rows again doesn't double them.
        </div>
        <input type="file" aria-label="FireWorks training file" accept=".xlsx,.xlsm,.csv" onChange={e => { setFile(e.target.files[0] || null); setPrev(null); }} />
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button style={btn("outline")} disabled={!file || busy} onClick={() => run(true)}>Check the file</button>
          {prev && <button style={btn("primary")} disabled={busy || !prev.newRows} onClick={() => run(false)}>Import {prev.newRows} rows</button>}
        </div>
        {error && <div role="alert" style={{ color: BRICK, marginTop: 8, fontSize: 13 }}>{error}</div>}
      </div>
      {prev && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>What's in the file</div>
          <div style={{ fontSize: 13, display: "grid", gap: 3 }}>
            <div><b>{prev.rows}</b> rows for <b>{prev.people}</b> people, {prev.from ? `${pretty(prev.from)} to ${pretty(prev.to)}` : ""}: <b>{prev.newRows}</b> new ({prev.hours} h){prev.duplicates ? `, ${prev.duplicates} already imported or repeated in the file` : ""}.</div>
            {prev.categories?.length > 0 && <div style={{ color: INK_SOFT }}>Categories: {prev.categories.join(", ")}</div>}
            <div style={{ color: INK_SOFT }}>Columns found: {prev.columns.join(", ")}{prev.filledFromContent ? ` · ${prev.filledFromContent} rows matched to the content list` : ""}</div>
            {prev.badCount > 0 && <div style={{ color: AMBER }}>{prev.badCount} rows skipped: {prev.bad.slice(0, 5).map(b => `row ${b.row} (${b.why})`).join(", ")}</div>}
            {prev.unmatchedCount > 0 && <div style={{ color: AMBER }}>{prev.unmatchedCount} names don't match a {PN} account yet ({prev.unmatched.slice(0, 8).join(", ")}{prev.unmatchedCount > 8 ? "…" : ""}). Their hours are kept and linked when the account exists (by employee number or name).</div>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 10 }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Name</th><th style={th}>Date</th><th style={th}>Hours</th><th style={th}>Certification · subject</th><th style={th}>Class</th></tr></thead>
            <tbody>{prev.sample.map((r, i) => <tr key={i} style={{ borderBottom: `1px solid ${LINE}` }}><td style={td}>{r.name}</td><td style={td}>{r.day}</td><td style={td}>{r.hours}</td><td style={td}>{[r.certification, r.category].filter(Boolean).join(" · ")}</td><td style={td}>{r.topic}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {d.imports.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Recent imports</div>
          {d.imports.map(i => <div key={i.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${LINE}` }}>{new Date(i.at).toLocaleDateString()} · {i.file_name}: {i.rows_added} added, {i.rows_skipped} already there ({i.date_from} to {i.date_to}) · {i.by_name}</div>)}
        </div>
      )}
    </div>
  );
}

// ---- Settings: requirements + content list ---------------------------------------------------------
const PERIODS = { month: "Each month", quarter: "Each quarter", year: "Each calendar year", "2years": "Every 2 years" };
const KIND_LABEL = { company: "Company", facility: "Facility (training ground) + company", officer: "Officer development", driver: "Driver / operator",
  hazmat: "Hazmat", ims: "Incident management (not ISO hours)", other: "Not ISO (EMS, comms, CRR, admin…)" };
function CategoryMap({ d, toast, onDone }) {
  const [map, setMap] = useState(() => Object.fromEntries(d.categories.map(c => [c.name.toLowerCase(), c.kind])));
  const [showArchived, setShowArchived] = useState(false);
  async function upload(f) {
    if (!f) return;
    try { const r = await call("/training/categories", { fileName: f.name, data: await fileData(f) }); toast(`Loaded ${r.loaded} categories (${r.active} active).`); onDone(); }
    catch (e) { toast(e.message); }
  }
  async function save() {
    try { await call("/training/settings", { fwmap: map }); toast("Category credit saved."); onDone(); } catch (e) { toast(e.message); }
  }
  const list = d.categories.filter(c => showArchived || !c.archived || c.n);
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>FireWorks training categories</div>
      <div style={{ fontSize: 13, color: INK_SOFT, margin: "4px 0 10px" }}>
        FireWorks › "Training Category List" (Excel). When a class has a subject from the content list (Company, Hazmat, Officer…), the subject decides its ISO credit;
        otherwise its category does, as set here.
      </div>
      <input type="file" aria-label="Category list file" accept=".xlsx,.csv" onChange={e => upload(e.target.files[0])} />
      {d.categories.length > 0 && (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 12 }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Category</th><th style={th}>Classes logged</th><th style={th}>Counts toward</th></tr></thead>
            <tbody>{list.map(c => (
              <tr key={c.name} style={{ borderBottom: `1px solid ${LINE}`, opacity: c.archived ? 0.6 : 1 }}>
                <td style={td}>{c.name}{c.archived ? <span style={{ fontSize: 11, color: INK_SOFT }}> (archived in FireWorks)</span> : null}</td>
                <td style={td}>{c.n || "—"}</td>
                <td style={td}><select aria-label={`Credit for ${c.name}`} style={{ ...inputStyle, width: "auto" }} value={map[c.name.toLowerCase()] || c.kind}
                  onChange={e => setMap(m => ({ ...m, [c.name.toLowerCase()]: e.target.value }))}>
                  {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              </tr>))}</tbody>
          </table>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
            <button style={btn("primary")} onClick={save}>Save category credit</button>
            <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived categories</label>
          </div>
        </>
      )}
    </div>
  );
}

function SettingsPage({ d, toast, onDone }) {
  const [reqs, setReqs] = useState(d.requirements);
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setReqs(list => list.map((r, j) => j === i ? { ...r, [k]: v } : r));
  async function save() {
    setBusy(true);
    try { await call("/training/settings", { requirements: reqs }); toast("Requirements saved."); onDone(); } catch (e) { toast(e.message); }
    setBusy(false);
  }
  async function loadContent(f) {
    if (!f) return;
    try { const r = await call("/training/content", { fileName: f.name, data: await fileData(f) }); toast(`Loaded ${r.loaded} content titles in ${r.certifications} certifications.`); onDone(); }
    catch (e) { toast(e.message); }
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>FireWorks content list</div>
        <div style={{ fontSize: 13, color: INK_SOFT, margin: "4px 0 10px" }}>
          FireWorks › Reports › "Certification Subjects and Relevant Content Master List" (Excel). It tells {PN} which certification and subject each class belongs to,
          so hours count toward the right requirement, and it fills the class picker under Enter hours. Load it again whenever classes are added in FireWorks.
          {d.contentCount ? <b style={{ color: SAGE }}> {d.contentCount} content titles loaded.</b> : <b style={{ color: AMBER }}> Not loaded yet.</b>}
        </div>
        <input type="file" aria-label="Content list file" accept=".xlsx,.csv" onChange={e => loadContent(e.target.files[0])} />
      </div>
      <CategoryMap key={JSON.stringify(d.categories)} d={d} toast={toast} onDone={onDone} />
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Requirements</div>
          <button style={btn("outline")} onClick={() => setReqs(r => [...r, { id: "", label: "", group: "Department", hours: 1, period: "year", counts: "", titles: "", divisions: "", holders: "", monthlyCap: 0, note: "" }])}><Plus size={14} /> Add</button>
          <button style={btn("ghost")} onClick={() => window.confirm("Put the requirements back to the built-in ISO, Louisiana and NREMT list?") && setReqs(d.defaults)}>Reset to defaults</button>
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10, display: "flex", gap: 6 }}><Info size={15} style={{ flexShrink: 0 }} />
          <span><b>Counts</b>: <code>iso:company</code>, <code>iso:facility</code>, <code>iso:officer</code>, <code>iso:driver</code>, <code>iso:hazmat</code> use the FireWorks subject (Company, Facility (Drills),
            Officer, Driver, Hazmat); anything else is words (comma-separated) looked for in the certification, subject or class title. <b>Job titles</b> / <b>divisions</b>: who it's for
            (e.g. <code>captain|lieutenant</code>; empty = everyone). <b>Only people with</b>: e.g. <code>Paramedic Training Hours</code> applies it only to people with hours under that certification.
            Check the state and NREMT defaults against your own requirements.</span></div>
        <div style={{ display: "grid", gap: 8 }}>
          {reqs.map((r, i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, background: PAPER }}>
              <label style={{ gridColumn: "span 2" }}><span style={label}>Requirement</span><input aria-label={`Requirement ${i + 1} name`} style={inputStyle} value={r.label} onChange={e => set(i, "label", e.target.value)} /></label>
              <label><span style={label}>Group</span><select style={inputStyle} value={r.group} onChange={e => set(i, "group", e.target.value)}>{["ISO", "State", "EMS", "Department"].map(g => <option key={g}>{g}</option>)}</select></label>
              <label><span style={label}>Hours</span><input aria-label={`Requirement ${i + 1} hours`} type="number" style={inputStyle} value={r.hours} onChange={e => set(i, "hours", e.target.value)} /></label>
              <label><span style={label}>Period</span><select style={inputStyle} value={r.period} onChange={e => set(i, "period", e.target.value)}>{Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label style={{ gridColumn: "span 2" }}><span style={label}>Counts</span><input aria-label={`Requirement ${i + 1} counts`} style={inputStyle} value={r.counts} onChange={e => set(i, "counts", e.target.value)} /></label>
              <label><span style={label}>Job titles</span><input style={inputStyle} value={r.titles || ""} onChange={e => set(i, "titles", e.target.value)} /></label>
              <label><span style={label}>Divisions</span><input style={inputStyle} value={r.divisions || ""} onChange={e => set(i, "divisions", e.target.value)} /></label>
              <label><span style={label}>Only people with</span><input style={inputStyle} value={r.holders || ""} onChange={e => set(i, "holders", e.target.value)} /></label>
              <label><span style={label}>Max per month</span><input type="number" style={inputStyle} value={r.monthlyCap || ""} onChange={e => set(i, "monthlyCap", e.target.value)} /></label>
              <label style={{ gridColumn: "1 / -1" }}><span style={label}>Note</span><input style={inputStyle} value={r.note || ""} onChange={e => set(i, "note", e.target.value)} /></label>
              <div><button style={{ ...btn("ghost"), color: BRICK }} onClick={() => setReqs(list => list.filter((_, j) => j !== i))}>Remove</button></div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}><button style={btn("primary")} disabled={busy} onClick={save}>Save requirements</button></div>
      </div>
    </div>
  );
}

// ---- Apparatus -----------------------------------------------------------------------------------
const STATUS = { in_service: "In service", reserve: "Reserve", out_of_service: "Out of service" };
export function ApparatusPage({ toast }) {
  const [d, setD] = useState(null), [f, setF] = useState(null), [bulk, setBulk] = useState("");
  const load = () => call("/apparatus").then(setD, () => setD({ apparatus: [], kinds: [], canEdit: false }));
  useEffect(() => { load(); }, []);
  async function save() { try { setD({ ...d, ...(await call("/apparatus", { ...f })) }); setF(null); toast("Saved."); } catch (e) { toast(e.message); } }
  async function remove(a) { if (!window.confirm(`Take ${a.unit} off the list?`)) return; try { setD({ ...d, ...(await call(`/apparatus/${a.id}/remove`, {})) }); } catch (e) { toast(e.message); } }
  async function addBulk() { try { const r = await call("/apparatus/import", { text: bulk }); toast(`Added ${r.added}.`); setBulk(""); load(); } catch (e) { toast(e.message); } }
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: 12, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>Apparatus ({d.apparatus.length})</div>
          {d.canEdit && <button style={btn("primary")} onClick={() => setF({ unit: "", kind: "Engine", station: "", status: "in_service", notes: "", sort: 0 })}><Plus size={14} /> Add apparatus</button>}
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Unit</th><th style={th}>Type</th><th style={th}>Station</th><th style={th}>Status</th><th style={th}>Notes</th>{d.canEdit && <th style={th} />}</tr></thead>
          <tbody>
            {d.apparatus.length === 0 && <tr><td colSpan={6} style={{ ...td, color: INK_SOFT }}>No apparatus yet.{d.canEdit ? " Add them one at a time, or paste a list below." : ""}</td></tr>}
            {d.apparatus.map(a => (
              <tr key={a.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ ...td, fontWeight: 800 }}>{a.unit}</td><td style={td}>{a.kind}</td><td style={td}>{a.station}</td>
                <td style={{ ...td, color: a.status === "in_service" ? SAGE : a.status === "reserve" ? AMBER : BRICK, fontWeight: 600 }}>{STATUS[a.status]}</td>
                <td style={{ ...td, color: INK_SOFT }}>{a.notes}</td>
                {d.canEdit && <td style={{ ...td, whiteSpace: "nowrap" }}><button style={{ ...btn("ghost"), padding: "2px 8px" }} onClick={() => setF(a)}>Edit</button>
                  <button aria-label={`Remove ${a.unit}`} style={{ ...btn("ghost"), padding: "2px 8px", color: BRICK }} onClick={() => remove(a)}>Remove</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {f && (
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>{f.id ? `Edit ${f.unit}` : "Add apparatus"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label><span style={label}>Unit (radio name)</span><input aria-label="Unit" style={inputStyle} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="EG613" /></label>
            <label><span style={label}>Type</span><select aria-label="Type" style={inputStyle} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{d.kinds.map(k => <option key={k}>{k}</option>)}</select></label>
            <label><span style={label}>Station</span><input aria-label="Station" style={inputStyle} value={f.station} onChange={e => setF({ ...f, station: e.target.value })} /></label>
            <label><span style={label}>Status</span><select aria-label="Status" style={inputStyle} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label style={{ gridColumn: "1 / -1" }}><span style={label}>Notes</span><input aria-label="Notes" style={inputStyle} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button style={btn("primary")} onClick={save}>Save</button><button style={btn("ghost")} onClick={() => setF(null)}>Cancel</button></div>
        </div>
      )}
      {d.canEdit && (
        <div style={{ ...cardStyle, maxWidth: 640 }}>
          <div style={{ fontWeight: 700 }}>Add several at once</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT, margin: "4px 0 8px" }}>One per line or comma-separated, e.g. <code>EG613, LD618, SQ605, MD687</code>. The type is guessed from the letters (EG = Engine, LD = Ladder, SQ = Squad, MD = Medic…) and the station from the digits.</div>
          <textarea aria-label="Apparatus list" rows={3} style={inputStyle} value={bulk} onChange={e => setBulk(e.target.value)} />
          <div style={{ marginTop: 8 }}><button style={btn("outline")} disabled={!bulk.trim()} onClick={addBulk}>Add these</button></div>
        </div>
      )}
    </div>
  );
}

// ---- Classroom bookings ---------------------------------------------------------------------------
function RotationEditor({ b, apparatus, toast, onSaved, onCancel }) {
  const days = useMemo(() => { const out = []; for (let d = b.from; d && d <= b.to; d = addDays(d, 1)) out.push(d); return out; }, [b.from, b.to]);
  const [list, setList] = useState(b.rotations.length ? b.rotations.map(r => ({ day: r.day || "", start: r.start, end: r.end, apparatus: r.apparatus.map(a => a.id), notes: r.notes || "" }))
    : [{ day: "", start: b.start, end: b.end, apparatus: [], notes: "" }]);
  const [warn, setWarn] = useState([]);
  const set = (i, k, v) => setList(l => l.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const toggle = (i, id) => setList(l => l.map((r, j) => j === i ? { ...r, apparatus: r.apparatus.includes(id) ? r.apparatus.filter(x => x !== id) : [...r.apparatus, id] } : r));
  function addNext() {
    const last = list[list.length - 1];
    const len = (h => h)(timeToMin(last.end) - timeToMin(last.start));
    const s = last.end, e = minToTime(Math.min(timeToMin(b.end), timeToMin(last.end) + Math.max(30, len)));
    setList(l => [...l, { day: last.day, start: s, end: e > s ? e : b.end, apparatus: [], notes: "" }]);
  }
  async function save() {
    try { const r = await call(`/bookings/requests/${b.requestId}/rotations`, { rotations: list.map(x => ({ ...x, day: x.day || null })) }); setWarn(r.warnings || []); toast(r.warnings?.length ? "Saved, with conflicts to check." : "Rotations saved."); onSaved(); }
    catch (e) { toast(e.message); }
  }
  const usable = apparatus.filter(a => a.status !== "out_of_service");
  return (
    <div style={{ marginTop: 10, padding: 12, background: PAPER, borderRadius: 9 }}>
      <div style={{ fontWeight: 800, marginBottom: 6, display: "flex", gap: 6, alignItems: "center" }}><Truck size={16} /> Apparatus rotations</div>
      {!apparatus.length && <div style={{ fontSize: 13, color: AMBER }}>The apparatus list is empty. Add apparatus first (Training › Apparatus).</div>}
      {list.map((r, i) => (
        <div key={i} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b style={{ minWidth: 86 }}>Rotation {i + 1}</b>
            {days.length > 1 && <select aria-label={`Rotation ${i + 1} day`} style={{ ...inputStyle, width: "auto" }} value={r.day} onChange={e => set(i, "day", e.target.value)}>
              <option value="">Every day</option>{days.map(d => <option key={d} value={d}>{pretty(d)}</option>)}</select>}
            <input aria-label={`Rotation ${i + 1} start`} type="time" style={{ ...inputStyle, width: "auto" }} value={r.start} onChange={e => set(i, "start", e.target.value)} />
            <span>to</span>
            <input aria-label={`Rotation ${i + 1} end`} type="time" style={{ ...inputStyle, width: "auto" }} value={r.end} onChange={e => set(i, "end", e.target.value)} />
            <button aria-label={`Remove rotation ${i + 1}`} style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={() => setList(l => l.filter((_, j) => j !== i))}><X size={14} /></button>
          </div>
          <div role="group" aria-label={`Rotation ${i + 1} apparatus`} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {usable.map(a => {
              const on = r.apparatus.includes(a.id);
              return <label key={a.id} style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "4px 9px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                border: `1.5px solid ${on ? BLUE : LINE}`, background: on ? "#E8F0FA" : "#fff", color: on ? BLUE : INK }}>
                <input type="checkbox" checked={on} onChange={() => toggle(i, a.id)} style={{ margin: 0 }} />{a.unit}{a.status === "reserve" ? " (R)" : ""}</label>;
            })}
          </div>
          <input aria-label={`Rotation ${i + 1} notes`} placeholder="Notes (e.g. drafting at the pump pit)" style={{ ...inputStyle, marginTop: 8 }} value={r.notes} onChange={e => set(i, "notes", e.target.value)} />
        </div>
      ))}
      {warn.length > 0 && <div role="alert" style={{ fontSize: 12.5, color: AMBER, marginBottom: 8 }}>{warn.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={btn("outline")} onClick={addNext}><Plus size={14} /> Next rotation</button>
        <button style={btn("primary")} onClick={save}>Save rotations</button>
        <button style={btn("ghost")} onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}
const timeToMin = t => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; };
const minToTime = m => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function BookForm({ rooms, toast, onDone, onCancel }) {
  const [f, setF] = useState({ rooms: [], from: todayISO(), to: "", start: "08:00", end: "12:00", title: "", attendees: "", notes: "", needsRotation: false });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  async function save() {
    try { await call("/bookings", { ...f, to: f.to || f.from, attendees: f.attendees ? Number(f.attendees) : undefined }); toast("Booked."); onDone(); } catch (e) { toast(e.message); }
  }
  return (
    <div style={{ ...cardStyle, maxWidth: 760 }}>
      <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Book a room</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={{ gridColumn: "1 / -1" }}><span style={label}>Class or event</span><input aria-label="Class or event" style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)} /></label>
        <label><span style={label}>First day</span><input aria-label="First day" type="date" style={inputStyle} value={f.from} onChange={e => set("from", e.target.value)} /></label>
        <label><span style={label}>Last day</span><input aria-label="Last day" type="date" style={inputStyle} value={f.to} onChange={e => set("to", e.target.value)} /></label>
        <label><span style={label}>Start</span><input aria-label="Start" type="time" style={inputStyle} value={f.start} onChange={e => set("start", e.target.value)} /></label>
        <label><span style={label}>End</span><input aria-label="End" type="time" style={inputStyle} value={f.end} onChange={e => set("end", e.target.value)} /></label>
        <label><span style={label}>Attendees</span><input aria-label="Attendees" type="number" style={inputStyle} value={f.attendees} onChange={e => set("attendees", e.target.value)} /></label>
      </div>
      <div style={{ marginTop: 10 }}><span style={label}>Rooms</span>
        <div role="group" aria-label="Rooms" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {rooms.map(r => <label key={r} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 13, padding: "3px 8px", border: `1px solid ${f.rooms.includes(r) ? BLUE : LINE}`, borderRadius: 999, cursor: "pointer" }}>
            <input type="checkbox" checked={f.rooms.includes(r)} onChange={() => set("rooms", f.rooms.includes(r) ? f.rooms.filter(x => x !== r) : [...f.rooms, r])} style={{ margin: 0 }} />{r}</label>)}
        </div></div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 10 }}><input type="checkbox" checked={f.needsRotation} onChange={e => set("needsRotation", e.target.checked)} /> Needs an apparatus rotation</label>
      <label style={{ display: "block", marginTop: 8 }}><span style={label}>Notes</span><input aria-label="Notes" style={inputStyle} value={f.notes} onChange={e => set("notes", e.target.value)} /></label>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button style={btn("primary")} onClick={save} disabled={!f.rooms.length || !f.title}>Book</button><button style={btn("ghost")} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function BookingsPage({ me, toast, initDay }) {
  const [from, setFrom] = useState(() => initDay || todayISO());
  const [d, setD] = useState(null), [apparatus, setApparatus] = useState([]);
  const [booking, setBooking] = useState(false), [rot, setRot] = useState(null), [showCancelled, setShowCancelled] = useState(false);
  const to = addDays(from, 13);
  const load = () => call(`/bookings?from=${from}&to=${to}${showCancelled ? "&all=1" : ""}`).then(setD, e => toast(e.message));
  useEffect(() => { load(); }, [from, showCancelled]);
  useEffect(() => { call("/apparatus").then(r => setApparatus(r.apparatus), () => {}); }, []);
  async function act(b, what) {
    let reason = "";
    if (what === "cancel") { reason = window.prompt(`Cancel "${b.title}" (${b.room}${b.from !== b.to ? `, all days ${b.from} to ${b.to}` : ""})? Reason (optional):`, ""); if (reason === null) return; }
    try { await call(`/bookings/requests/${b.requestId}/${what}`, { reason }); toast(what === "approve" ? "Approved." : "Cancelled."); load(); } catch (e) { toast(e.message); }
  }
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading bookings…</div>;
  const days = []; for (let x = from; x <= to; x = addDays(x, 1)) days.push(x);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={btn("outline")} onClick={() => setFrom(addDays(from, -7))}>‹ Week</button>
        <input aria-label="From" type="date" style={{ ...inputStyle, width: "auto" }} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        <button style={btn("outline")} onClick={() => setFrom(addDays(from, 7))}>Week ›</button>
        <button style={btn("ghost")} onClick={() => setFrom(todayISO())}>Today</button>
        <label style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} /> Show cancelled</label>
        <span style={{ flex: 1 }} />
        {d.canEdit && !booking && <button style={btn("primary")} onClick={() => setBooking(true)}><Plus size={14} /> Book a room</button>}
      </div>
      <div style={{ fontSize: 12.5, color: INK_SOFT }}>Rooms are requested with the <b>Facility &amp; Resource Request</b> form (Forms › Requests). A room is held as soon as the form is sent and can't be double-booked; it's confirmed when the form is marked Approved.</div>
      {booking && <BookForm rooms={d.rooms} toast={toast} onCancel={() => setBooking(false)} onDone={() => { setBooking(false); load(); }} />}
      {days.map(day => {
        const list = d.bookings.filter(b => b.day === day);
        if (!list.length) return null;
        return (
          <div key={day} style={cardStyle}>
            <div style={{ fontWeight: 800, color: day === todayISO() ? BRICK : INK, marginBottom: 6 }}>{pretty(day, { weekday: "long", month: "long", day: "numeric" })}{day === todayISO() ? " · Today" : ""}</div>
            {list.map(b => {
              const mine = b.contactId === me.id;
              return (
                <div key={b.id} style={{ padding: "8px 0", borderTop: `1px solid ${LINE}`, opacity: b.status === "cancelled" ? 0.55 : 1 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 92 }}>{b.start.replace(":", "")}–{b.end.replace(":", "")}</span>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 700 }}>{b.title}</div>
                      <div style={{ fontSize: 12.5, color: INK_SOFT }}>{b.room} · {b.contact}{b.division ? ` · ${b.division}` : ""}{b.attendees ? ` · ${b.attendees} people` : ""}
                        {b.from !== b.to ? ` · ${pretty(b.from)} – ${pretty(b.to)}` : ""}</div>
                      {b.rotations.length > 0 && (
                        <div style={{ fontSize: 12.5, marginTop: 4, display: "grid", gap: 2 }}>
                          {b.rotations.map(r => <div key={r.id}><Truck size={12} color={BLUE} style={{ verticalAlign: -1 }} /> <b>Rotation {r.seq}</b> {r.start.replace(":", "")}–{r.end.replace(":", "")}: {r.apparatus.map(a => a.unit).join(", ")}{r.notes ? <span style={{ color: INK_SOFT }}> · {r.notes}</span> : null}</div>)}
                        </div>
                      )}
                      {b.needsRotation && !b.rotations.length && <div style={{ fontSize: 12, color: AMBER, marginTop: 3 }}>Truck rotation needed, not assigned yet</div>}
                      {b.status === "cancelled" && <div style={{ fontSize: 12, color: BRICK }}>Cancelled{b.cancelledReason ? `: ${b.cancelledReason}` : ""}</div>}
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: b.status === "approved" ? "#EAF4EE" : b.status === "cancelled" ? "#EEE" : "#FFF4DE",
                      color: b.status === "approved" ? SAGE : b.status === "cancelled" ? INK_SOFT : "#8A5A00" }}>{b.status === "requested" ? "Requested" : b.status === "approved" ? "Approved" : "Cancelled"}</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {b.status !== "cancelled" && (d.canEdit || mine) && <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => setRot(rot === b.id ? null : b.id)}>Rotations</button>}
                      {d.canEdit && b.status === "requested" && <button style={{ ...btn("primary"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => act(b, "approve")}>Approve</button>}
                      {d.canEdit && b.status === "cancelled" && <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => act(b, "approve")}>Restore</button>}
                      {d.canEdit && b.status !== "cancelled" && <button style={{ ...btn("ghost"), padding: "4px 10px", fontSize: 12.5, color: BRICK }} onClick={() => act(b, "cancel")}>Cancel</button>}
                    </div>
                  </div>
                  {rot === b.id && <RotationEditor b={b} apparatus={apparatus} toast={toast} onCancel={() => setRot(null)} onSaved={load} />}
                </div>
              );
            })}
          </div>
        );
      })}
      {!d.bookings.length && <div style={{ ...cardStyle, color: INK_SOFT }}>Nothing booked {pretty(from)} – {pretty(to)}.</div>}
    </div>
  );
}

// ---- The section ---------------------------------------------------------------------------------
export default function TrainingModule({ onBack, init }) {
  const [tab, setTab] = useState(init?.tab || "mine");
  const [year, setYear] = useState(new Date().getFullYear());
  const [d, setD] = useState(null), [error, setError] = useState("");
  const [person, setPerson] = useState(null);
  const [roster, setRoster] = useState([]);
  const [msg, setMsg] = useState("");
  const toast = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? "" : x)), 5000); };
  const load = () => call(`/training?year=${year}`).then(setD, e => setError(e.message));
  useEffect(() => { load(); }, [year]);
  useEffect(() => { call("/messages/people").then(r => setRoster(r.people.map(p => ({ id: p.id, name: p.name })))).catch(() => {}); }, []);
  const acc = d?.access || {};
  const [views, setViews] = useState(null), [todo, setTodo] = useState(null), [drill, setDrill] = useState(init?.drill ? { id: init.drill } : null), [company, setCompany] = useState(null);
  const loadViews = () => { call("/training/views").then(setViews, () => {}); call("/training/todo").then(setTodo, () => {}); };
  useEffect(() => { loadViews(); }, []);

  const nav = [
    { key: "mine", label: "My training", icon: GraduationCap, group: "Training hours" },
    ...(acc.view ? [{ key: "crew", label: "Today's crew", icon: UserCheck, group: "Training hours" }, { key: "everyone", label: "Everyone", icon: Users, group: "Training hours" }] : []),
    ...(acc.edit ? [{ key: "enter", label: "Enter hours", icon: Plus, group: "Training hours" }, { key: "import", label: "Import from FireWorks", icon: Upload, group: "Training hours" }] : []),
    { key: "drills", label: "Drills", icon: ClipboardList, group: "Drills & proficiency", badge: todo ? todo.confirm + todo.verify + todo.returned : 0 },
    ...(views?.canLog ? [{ key: "logdrill", label: "Log a drill", icon: Plus, group: "Drills & proficiency" }] : []),
    { key: "proficiency", label: "Proficiency", icon: ListChecks, group: "Drills & proficiency" },
    ...(views?.companies?.length ? [{ key: "company", label: views.role === "officer" ? "My company" : "Companies", icon: Building2, group: "Views" }] : []),
    ...(views?.shifts?.length ? [{ key: "shift", label: views.role === "bc" ? "My shift" : "Shifts", icon: Users, group: "Views" }] : []),
    ...(acc.view ? [{ key: "roster", label: "Roster history", icon: History, group: "PIAL" }, { key: "pial", label: "PIAL estimate", icon: BarChart3, group: "PIAL" }] : []),
    { key: "bookings", label: "Classroom bookings", icon: School, group: "Facilities" },
    { key: "apparatus", label: "Apparatus", icon: Truck, group: "Facilities" },
    ...(acc.manage ? [{ key: "settings", label: "Requirements & settings", icon: Settings, group: "Admin" }, { key: "skills", label: "Skills & roles", icon: Award, group: "Admin" }] : []),
  ];
  const go = k => { setTab(k); setPerson(null); setDrill(null); setCompany(null); if (k === "drills") loadViews(); };
  const openDrill = id => setDrill({ id });
  const yearPicker = (
    <select aria-label="Year" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...inputStyle, width: "auto" }}>
      {[0, 1, 2, 3].map(i => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
  let page;
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) page = <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  else if (person) page = <PersonView query={person} year={year} canEdit={acc.edit} onBack={() => setPerson(null)} onChanged={load} />;
  else if (["drills", "logdrill", "company", "shift", "proficiency", "skills"].includes(tab) && !views) page = <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  else if (drill?.edit || tab === "logdrill") page = <DrillEditor key={drill?.id || "new"} id={drill?.id} views={views} roster={roster} categories={d.categories || []} toast={toast}
    onCancel={() => { setDrill(drill?.id ? { id: drill.id } : null); if (tab === "logdrill") setTab("drills"); }} onDone={id => { setTab("drills"); setDrill({ id }); loadViews(); }} />;
  else if (drill) page = <DrillView key={drill.id + (drill.n || "")} id={drill.id} views={views} toast={m => { toast(m); loadViews(); }} onBack={() => { setDrill(null); loadViews(); }} onEdit={() => setDrill({ id: drill.id, edit: true })} />;
  else if (tab === "drills") page = <DrillsPage views={views} year={year} init={init} onOpen={openDrill} onNew={() => setTab("logdrill")} />;
  else if (tab === "company") page = <CompanyView key={company ? `${company.station}${company.shift}` : "c"} views={views} year={year} init={company} onOpenPerson={p => setPerson({ user: p.id })} onOpenDrill={openDrill} />;
  else if (tab === "shift") page = <ShiftView views={views} year={year} onOpenCompany={(station, shift) => { setCompany({ station, shift }); setTab("company"); }} />;
  else if (tab === "proficiency") page = <ProficiencyPage views={views} toast={toast} />;
  else if (tab === "roster") page = <RosterPage views={views || {}} roster={roster} toast={toast} />;
  else if (tab === "pial") page = <PialEstimate year={year} />;
  else if (tab === "skills") page = views ? <SkillSettings views={views} toast={toast} onDone={loadViews} /> : null;
  else if (tab === "mine") page = <PersonView query={{ user: d.me.id }} year={year} canEdit={false} />;
  else if (tab === "crew") page = <Crew year={year} onOpen={p => setPerson(p.userId ? { user: p.userId } : { name: p.name })} />;
  else if (tab === "everyone") page = (
    <>
      {d.unlinked.length > 0 && <div style={{ ...cardStyle, fontSize: 13, color: AMBER, marginBottom: 10 }}>Hours for {d.unlinked.length} name{d.unlinked.length === 1 ? "" : "s"} in FireWorks don't match a {PN} account: {d.unlinked.slice(0, 10).map(u => u.name).join(", ")}{d.unlinked.length > 10 ? "…" : ""}. They link automatically once the name or employee number matches.</div>}
      <PeopleTable rows={d.people} onOpen={p => setPerson({ user: p.id })} />
    </>
  );
  else if (tab === "enter") page = <EnterHours roster={roster} categories={d.categories || []} toast={toast} onDone={load} />;
  else if (tab === "import") page = <ImportPage d={d} toast={toast} onDone={load} />;
  else if (tab === "settings") page = <SettingsPage d={d} toast={toast} onDone={load} />;
  else if (tab === "bookings") page = <BookingsPage me={d.me} toast={toast} initDay={init?.day} />;
  else if (tab === "apparatus") page = <ApparatusPage toast={toast} />;

  const titles = { mine: "My training", crew: "Today's crew", everyone: "Everyone's training", enter: "Enter training hours", import: "Import from FireWorks",
    settings: "Requirements & settings", bookings: "Classroom bookings", apparatus: "Apparatus", drills: "Drills", logdrill: "Log a drill", proficiency: "Proficiency",
    company: "Company training", shift: "Shift training", roster: "Grading-year roster", pial: "PIAL training estimate", skills: "Skills & roles" };
  return (
    <AppShell section="Training" nav={nav} active={tab} onNav={go} onHome={onBack}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, margin: 0, color: INK, flex: 1 }}>{titles[tab]}</h1>
        {["mine", "crew", "everyone", "drills", "company", "shift", "pial"].includes(tab) && !drill && yearPicker}
      </div>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
    </AppShell>
  );
}
