// Emergency recall (Policy 1010): start a recall, members answer (coming / can't report safely), the board mirrors the
// Aladtec schedule, staffs units with seat-qualification flags, takes roll call, tracks the policy checklist and keeps
// an after-action timeline. Aladtec stays where sign-ups are approved and assigned. Server: server/recall.js.
import React, { useEffect, useMemo, useState } from "react";
import { BellRing, Plus, ChevronLeft, Printer, Settings, Check, Phone, ExternalLink, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn, printDocument, letterhead, escapeHtml } from "./App.jsx";
import { PeoplePicker } from "./FormFields.jsx";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
async function call(path, body) {
  const r = await fetch(`/api/recall${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const todayISO = () => new Date().toLocaleDateString("en-CA");
const when = d => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const time = d => d ? new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
const prettyDay = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };
const th = { padding: "7px 9px", fontWeight: 700, fontSize: 12, color: INK_SOFT, textAlign: "left", whiteSpace: "nowrap" }, td = { padding: "7px 9px", verticalAlign: "top" };
const Pill = ({ children, color = INK_SOFT, solid }) => <span style={{ fontSize: 11.5, fontWeight: 700, color: solid ? "#fff" : color, background: solid ? color : "transparent", border: `1px solid ${color}`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>{children}</span>;
const H = ({ children, right, sub }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
    <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 16, fontWeight: 800, color: INK }}>{children}</div>{sub && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>{sub}</div>}</div>{right}
  </div>
);
const Err = ({ e }) => e ? <div role="alert" style={{ color: BRICK, fontSize: 13.5, margin: "6px 0" }}>{e}</div> : null;
const Stat = ({ k, v, tone, sub }) => (
  <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "10px 12px", minWidth: 110, flex: "1 1 110px" }}>
    <div style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }}>{k}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: tone || INK }}>{v}</div>{sub && <div style={{ fontSize: 12, color: INK_SOFT }}>{sub}</div>}
  </div>
);
const RESP = { coming: ["Coming", SAGE], impaired: ["Can't report safely", BRICK], "": ["No answer yet", AMBER] };
const ROLE = { officer: "Officer", driver: "Driver", ff: "FF" };

// ---- A member's own card -----------------------------------------------------------------------------
function MyRecall({ r, mine, portalUrl, onDone, toast }) {
  const [eta, setEta] = useState(mine?.eta || ""), [note, setNote] = useState(mine?.note || ""), [mode, setMode] = useState(""), [error, setError] = useState("");
  const answer = async response => { setError(""); try { await call(`/${r.id}/respond`, { response, eta, note }); toast(response === "coming" ? "Thanks. The Assistant Chief can see you're coming." : "Sent to the Assistant Chief. Do not report for duty."); setMode(""); onDone(); } catch (e) { setError(e.message); } };
  const done = mine?.response;
  return (
    <div style={{ ...cardStyle, borderLeft: `6px solid ${BRICK}` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}><BellRing size={20} color={BRICK} /><div style={{ fontSize: 18, fontWeight: 800, color: BRICK }}>Emergency recall: {r.title}</div></div>
      <div style={{ fontSize: 13.5, color: INK_SOFT, marginBottom: 8 }}>{r.kindLabel} · {prettyDay(r.startDate)}{r.endDate !== r.startDate ? ` – ${prettyDay(r.endDate)}` : ""} · started by {r.startedBy} {when(r.startedAt)}</div>
      <ol style={{ margin: "0 0 10px 18px", padding: 0, fontSize: 14, lineHeight: 1.55 }}>
        <li><b>Log in to Aladtec</b>, acknowledge the required message, then sign up for the recall date (the link in the recall email, or Dashboard › Find Open Shifts).</li>
        <li>Wait for the approval text/email. <b>Report only once the assignment shows in Upcoming Shifts.</b></li>
        <li>Report directly to your assignment{r.reportTo ? ` (${r.reportTo})` : ""}. Roll call is taken when you arrive.</li>
      </ol>
      {r.instructions && <div style={{ whiteSpace: "pre-wrap", background: PAPER, padding: 10, borderRadius: 8, fontSize: 13.5, marginBottom: 10 }}>{r.instructions}</div>}
      <a href={portalUrl} target="_blank" rel="noreferrer" style={{ ...btn("primary"), textDecoration: "none", display: "inline-flex", marginBottom: 10 }}><ExternalLink size={14} /> Open Aladtec</a>
      {done && mode !== "change" ? (
        <div style={{ fontSize: 14, marginTop: 4 }}>
          You answered: <Pill color={RESP[done][1]} solid>{RESP[done][0]}</Pill>{mine.eta ? ` · ETA ${mine.eta}` : ""}{mine.checkedInAt ? ` · arrived ${time(mine.checkedInAt)}` : ""}
          {r.status === "open" && !mine.checkedInAt && <button style={{ ...btn("ghost"), marginLeft: 8 }} onClick={() => setMode("change")}>Change</button>}
        </div>
      ) : r.status === "open" && (
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Tell the Assistant Chief:</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <label><span style={label}>About when can you get there?</span><input aria-label="ETA" style={{ ...inputStyle, width: 200 }} placeholder="e.g. 45 min, 14:30" value={eta} onChange={e => setEta(e.target.value)} /></label>
            <button style={{ ...btn("primary"), background: SAGE, borderColor: SAGE }} onClick={() => answer("coming")}><Check size={14} /> I'm coming</button>
            <button style={btn("outline")} onClick={() => setMode(mode === "impaired" ? "" : "impaired")}>I can't report safely</button>
          </div>
          {mode === "impaired" && <div style={{ ...cardStyle, background: "#FDECEE", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13.5 }}>Members may not refuse a recall. If you're under the influence of any impairment (medications, alcohol), tell the Assistant Chief and <b>do not report for duty</b> (Policy 1010.3.4).</div>
            <input aria-label="Impairment note" style={inputStyle} placeholder="Anything the Assistant Chief needs to know (optional; no medical details needed)" value={note} onChange={e => setNote(e.target.value)} />
            <div><button style={{ ...btn("primary"), background: BRICK, borderColor: BRICK }} onClick={() => answer("impaired")}>Send to the Assistant Chief</button></div>
          </div>}
          <Err e={error} />
        </div>
      )}
    </div>
  );
}

// ---- Start a recall ------------------------------------------------------------------------------------
function StartRecall({ d, roster, onDone, onCancel }) {
  const [f, setF] = useState({ kind: "hurricane", title: "", startDate: todayISO(), endDate: todayISO(), reportTo: "", instructions: "", groups: [], users: [], imtIncidentId: "" });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [q, setQ] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const chosen = d.groups.filter(g => f.groups.includes(g.id));
  const approx = chosen.reduce((a, g) => a + g.count, 0) + f.users.length;
  async function start() {
    if (!window.confirm(`Start the recall "${f.title}" and send the notice now?`)) return;
    setBusy(true); setError("");
    try { const r = await call("", f); onDone(r.id, r.recalled); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const shown = d.groups.filter(g => !q || g.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div><button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onCancel}><ChevronLeft size={15} /> Back</button></div>
      <div style={cardStyle}>
        <H sub={"Policy 1010. " + PN + " sends an important message and push notification with the Aladtec steps. Still send the Aladtec alert and have Communications send the Blackboard message; the board keeps the checklist."}>Start an emergency recall</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Title</span><input aria-label="Recall title" style={inputStyle} value={f.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Hurricane Example – pre-landfall recall" /></label>
          <label style={{ gridColumn: "span 2" }}><span style={label}>Reason (1010.3.1)</span><select aria-label="Recall reason" style={inputStyle} value={f.kind} onChange={e => set("kind", e.target.value)}>{Object.entries(d.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span style={label}>First day</span><input aria-label="First day" type="date" style={inputStyle} value={f.startDate} onChange={e => setF(x => ({ ...x, startDate: e.target.value, endDate: x.endDate < e.target.value ? e.target.value : x.endDate }))} /></label>
          <label><span style={label}>Last day</span><input aria-label="Last day" type="date" style={inputStyle} value={f.endDate} min={f.startDate} onChange={e => set("endDate", e.target.value)} /></label>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Where to report (if not by Aladtec assignment)</span><input aria-label="Report to" style={inputStyle} value={f.reportTo} onChange={e => set("reportTo", e.target.value)} placeholder="e.g. Report to your Aladtec assignment" /></label>
          <label style={{ gridColumn: "1 / -1" }}><span style={label}>Instructions (also put these in the Aladtec required message)</span><textarea aria-label="Instructions" rows={4} style={inputStyle} value={f.instructions} onChange={e => set("instructions", e.target.value)} /></label>
          {d.incidents.length > 0 && <label style={{ gridColumn: "span 2" }}><span style={label}>IMT incident (for roll call and the IAP)</span><select aria-label="IMT incident" style={inputStyle} value={f.imtIncidentId} onChange={e => set("imtIncidentId", e.target.value)}>
            <option value="">—</option>{d.incidents.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
        </div>
      </div>
      <div style={cardStyle}>
        <H sub="Groups come from User Management (shifts, stations, divisions); add individuals below.">Who is recalled{approx ? ` (about ${approx})` : ""}</H>
        <input aria-label="Find a group" placeholder="Find a group…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, maxWidth: 280, marginBottom: 8 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {shown.map(g => <label key={g.id} style={{ fontSize: 13, display: "flex", gap: 5, alignItems: "center", border: `1px solid ${LINE}`, borderRadius: 8, padding: "3px 8px", background: f.groups.includes(g.id) ? "#FDECEE" : "#fff" }}>
            <input type="checkbox" aria-label={`Group: ${g.name}`} checked={f.groups.includes(g.id)} onChange={e => set("groups", e.target.checked ? [...f.groups, g.id] : f.groups.filter(x => x !== g.id))} />{g.name} <span style={{ color: INK_SOFT }}>({g.count})</span></label>)}
        </div>
        <div style={{ marginTop: 10 }}><span style={label}>People</span><PeoplePicker roster={roster} value={f.users} onChange={v => set("users", v)} label="Recalled people" /></div>
      </div>
      <Err e={error} />
      <div><button style={{ ...btn("primary"), background: BRICK, borderColor: BRICK }} disabled={busy || !f.title || (!f.groups.length && !f.users.length)} onClick={start}><BellRing size={14} /> Start recall and send the notice</button></div>
    </div>
  );
}

// ---- The board -----------------------------------------------------------------------------------------
function Board({ id, toast, onBack, roster }) {
  const [d, setD] = useState(null), [al, setAl] = useState(null), [error, setError] = useState(""), [filter, setFilter] = useState("all"), [units, setUnits] = useState(null), [dirty, setDirty] = useState(false);
  const [note, setNote] = useState(""), [add, setAdd] = useState([]), [closing, setClosing] = useState(false), [closeNote, setCloseNote] = useState(""), [newUnit, setNewUnit] = useState("");
  const load = () => call(`/${id}`).then(x => { setD(x); if (!dirty) setUnits(x.units || []); }, e => setError(e.message));
  const loadAl = fresh => call(`/${id}/aladtec${fresh ? "?fresh=1" : ""}`).then(setAl, () => setAl(null));
  useEffect(() => { load(); loadAl(false); }, [id]);
  useEffect(() => { const t = setInterval(() => { if (!dirty) load(); }, 30_000); return () => clearInterval(t); }, [id, dirty]);
  if (error && !d) return <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  if (!d) return <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  if (!d.board) return <div style={{ display: "grid", gap: 12 }}><div><button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}><ChevronLeft size={15} /> Back</button></div><MyRecall r={d.recall} mine={d.mine} portalUrl={d.portalUrl} onDone={load} toast={toast} /></div>;
  const r = d.recall, op = d.canOperate;
  const act = async (path, body, msg) => { setError(""); try { await call(`/${id}/${path}`, body); if (msg) toast(msg); load(); } catch (e) { setError(e.message); } };
  const seatOf = new Map(); (units || []).forEach(u => u.seats.forEach((s, i) => s.userId && seatOf.set(s.userId, `${u.unit} ${ROLE[s.role]}`)));
  const alOf = m => al?.matches?.[m.id] || null;
  const counts = { total: d.members.length, coming: d.members.filter(m => m.response === "coming").length, impaired: d.members.filter(m => m.response === "impaired").length,
    none: d.members.filter(m => !m.response && !m.releasedAt).length, arrived: d.members.filter(m => m.checkedInAt).length, aladtec: d.members.filter(m => alOf(m)).length };
  const list = d.members.filter(m => filter === "all" || (filter === "none" ? !m.response && !m.releasedAt : filter === "arrived" ? !!m.checkedInAt
    : filter === "comingNoAladtec" ? m.response === "coming" && al?.configured && !alOf(m) : m.response === filter));
  const people = d.members.filter(m => m.userId && m.response !== "impaired" && !m.releasedAt);
  const quals = d.quals || {};
  const qualOk = (role, uid) => !uid || role === "ff" || (role === "officer" ? quals[uid]?.officer : quals[uid]?.driver);
  const setSeat = (ui, si, uid) => { setDirty(true); setUnits(units.map((u, i) => i !== ui ? u : { ...u, seats: u.seats.map((s, j) => j !== si ? s : { ...s, userId: uid || null }) })); };
  const addUnit = (unit, extra = {}) => { const u = unit.trim().toUpperCase(); if (!u || units.some(x => x.unit === u)) return; setDirty(true); setUnits([...units, { unit: u, kind: "", location: "", seats: [], notes: "", specialOps: false, ...extra }]); };
  async function saveUnits() { setError(""); try { await call(`/${id}/units`, { units }); setDirty(false); toast("Staffing board saved."); const x = await call(`/${id}`); setD(x); setUnits(x.units); } catch (e) { setError(e.message); } }
  const unitsIn = d.units.filter(u => u.inServiceAt).length;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div><button style={{ ...btn("ghost"), paddingLeft: 0 }} onClick={onBack}><ChevronLeft size={15} /> Recalls</button></div>
      <div style={{ ...cardStyle, borderLeft: `6px solid ${r.status === "open" ? BRICK : INK_SOFT}` }}>
        <H right={<>{r.status === "open" ? <Pill color={BRICK} solid>OPEN</Pill> : <Pill>Closed {when(r.closedAt)}</Pill>}<button style={btn("outline")} onClick={() => printAfterAction(d, al)}><Printer size={14} /> After-action report</button></>}
          sub={`${r.kindLabel} · ${prettyDay(r.startDate)}${r.endDate !== r.startDate ? ` – ${prettyDay(r.endDate)}` : ""} · started by ${r.startedBy} ${when(r.startedAt)}${d.imt ? ` · IMT: ${d.imt.name}` : ""}`}>{r.title}</H>
        {r.instructions && <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, background: PAPER, padding: 10, borderRadius: 8 }}>{r.instructions}</div>}
      </div>
      {d.mine && <MyRecall r={r} mine={d.mine} portalUrl={d.portalUrl} onDone={load} toast={toast} />}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Stat k="Recalled" v={counts.total} /><Stat k="Coming" v={counts.coming} tone={SAGE} /><Stat k="No answer" v={counts.none} tone={counts.none ? AMBER : SAGE} />
        <Stat k="Can't report" v={counts.impaired} tone={counts.impaired ? BRICK : INK} /><Stat k="In Aladtec" v={al?.configured ? counts.aladtec : "—"} sub={al?.configured ? "approved & assigned" : "not connected"} />
        <Stat k="Arrived" v={counts.arrived} tone={BLUE} sub="roll call" /><Stat k="Units in service" v={`${unitsIn} / ${d.units.length}`} />
      </div>
      <Err e={error} />

      <div style={cardStyle}>
        <H sub="Policy 1010.3.2 and 1010.4. Tick each step as it's done; it goes in the timeline.">Checklist</H>
        {d.checklist.map(k => { const s = r.checklist[k.key] || {}; return (
          <label key={k.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: `1px solid ${LINE}`, fontSize: 13.5 }}>
            <input type="checkbox" aria-label={`Checklist: ${k.label}`} disabled={!op} checked={!!s.done} onChange={e => act("checklist", { key: k.key, done: e.target.checked })} />
            <span style={{ flex: 1, color: s.done ? INK_SOFT : INK }}>{k.label}{s.done && <span style={{ fontSize: 12, color: SAGE }}> · {s.by}, {when(s.at)}</span>}</span></label>); })}
      </div>

      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${LINE}` }}>
          <b style={{ color: INK, fontSize: 15 }}>People</b>
          <select aria-label="Show people" value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
            <option value="all">Everyone ({counts.total})</option><option value="none">No answer yet ({counts.none})</option><option value="coming">Coming ({counts.coming})</option>
            <option value="impaired">Can't report safely ({counts.impaired})</option><option value="arrived">Arrived ({counts.arrived})</option>
            {al?.configured && <option value="comingNoAladtec">Coming but not in Aladtec yet ({d.members.filter(m => m.response === "coming" && !alOf(m)).length})</option>}
          </select>
          <div style={{ flex: 1 }} />
          {al && <span style={{ fontSize: 12, color: INK_SOFT }}>{al.configured ? `Aladtec checked ${time(al.days[0]?.checkedAt)}` : "Aladtec isn't connected"}{al.days.some(x => x.error) ? <span style={{ color: BRICK }}> · {al.days.find(x => x.error).error}</span> : ""}</span>}
          {al?.configured && <button style={btn("outline")} onClick={() => loadAl(true)}><RefreshCw size={13} /> Check Aladtec</button>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}><th style={th}>Name</th><th style={th}>Answer</th><th style={th}>Aladtec assignment</th><th style={th}>Seat</th><th style={th}>Roll call</th>{op && <th style={th} />}</tr></thead>
            <tbody>
              {!list.length && <tr><td colSpan={6} style={{ ...td, color: INK_SOFT }}>Nobody to show.</td></tr>}
              {list.map(m => { const a = alOf(m); const [rl, rc] = RESP[m.response] || RESP[""]; return (
                <tr key={m.id} style={{ borderBottom: `1px solid ${LINE}`, opacity: m.releasedAt ? 0.55 : 1 }}>
                  <td style={td}><b style={{ color: INK }}>{m.name}</b><div style={{ fontSize: 11.5, color: INK_SOFT }}>{[m.title, m.station && `Sta ${m.station}`, m.shift && `${m.shift} shift`].filter(Boolean).join(" · ")}</div>
                    {m.phone && <a href={`tel:${m.phone}`} style={{ fontSize: 12, color: BLUE }}><Phone size={11} /> {m.phone}</a>}</td>
                  <td style={td}><Pill color={rc} solid={!!m.response}>{rl}</Pill>{m.eta && <div style={{ fontSize: 12 }}>ETA {m.eta}</div>}{m.note && <div style={{ fontSize: 12, color: INK_SOFT }}>{m.note}</div>}
                    {m.respondedAt && <div style={{ fontSize: 11, color: INK_SOFT }}>{time(m.respondedAt)}{m.respondedVia && m.respondedVia !== "self" ? ` · by ${m.respondedVia}` : ""}</div>}{m.releasedAt && <div style={{ fontSize: 11 }}>released {time(m.releasedAt)}</div>}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{a ? a.map((x, i) => <div key={i}>{prettyDay(x.day)}: {x.schedule}{x.position ? ` · ${x.position}` : ""}{x.start ? ` ${x.start}–${x.stop}` : ""}</div>)
                    : <span style={{ color: m.response === "coming" && al?.configured ? AMBER : INK_SOFT }}>{al?.configured ? "not on the schedule yet" : "—"}</span>}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{seatOf.get(m.userId) || "—"}</td>
                  <td style={td}>{m.checkedInAt ? <span style={{ color: BLUE, fontWeight: 700 }}>✓ {time(m.checkedInAt)}<div style={{ fontSize: 11, color: INK_SOFT, fontWeight: 400 }}>{m.checkedInBy}</div></span>
                    : op && m.response !== "impaired" ? <button aria-label={`Arrived: ${m.name}`} style={btn("outline")} onClick={() => act(`members/${m.id}`, { checkIn: true })}>Arrived</button> : "—"}</td>
                  {op && <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {!m.response && <><button aria-label={`Coming (by phone): ${m.name}`} title="Record a phoned-in answer" style={btn("ghost")} onClick={() => { const eta = window.prompt(`${m.name} is coming. ETA (optional)?`, ""); if (eta !== null) act(`members/${m.id}`, { response: "coming", eta }); }}>Coming</button>
                      <button aria-label={`Impaired (by phone): ${m.name}`} style={{ ...btn("ghost"), color: BRICK }} onClick={() => act(`members/${m.id}`, { response: "impaired" })}>Can't report</button></>}
                    {m.checkedInAt && !m.releasedAt && <button aria-label={`Release: ${m.name}`} style={btn("ghost")} onClick={() => act(`members/${m.id}`, { release: true })}>Release</button>}
                  </td>}
                </tr>); })}
            </tbody>
          </table>
        </div>
        {al?.notInNexus?.length > 0 && <div style={{ padding: 12, fontSize: 12.5, color: INK_SOFT, borderTop: `1px solid ${LINE}` }}>On the Aladtec schedule for these days but not on this recall (regular shift or not in {PN}): {al.notInNexus.slice(0, 30).map(x => x.name).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</div>}
        {op && <div style={{ padding: 12, borderTop: `1px solid ${LINE}`, display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><span style={label}>Recall more people</span><PeoplePicker roster={roster} value={add} onChange={setAdd} label="More people" exclude={d.members.map(m => m.userId).filter(Boolean)} /></div>
          <button style={btn("outline")} disabled={!add.length} onClick={async () => { await act("add", { users: add }, "Recalled and notified."); setAdd([]); }}>Recall and notify</button>
        </div>}
      </div>

      <div style={cardStyle}>
        <H sub="Who staffs which unit on the recall. Seats flag people without the officer title or a driver sign-off (pumper/aerial evaluation or driver title). Assignments themselves are still made in Aladtec."
          right={op && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {d.specialOps.length > 0 && <button style={btn("outline")} onClick={() => d.specialOps.forEach(s => addUnit(s.unit, { location: s.location, notes: s.note, specialOps: true,
              seats: [{ role: "officer", userId: null }, { role: "driver", userId: null }, ...Array(Math.max(1, (s.people || []).length - 2)).fill(0).map(() => ({ role: "ff", userId: null }))] }))}>Add Special Operations units</button>}
            <input aria-label="Add unit" list="recall-apparatus" placeholder="Unit (e.g. EG613)" style={{ ...inputStyle, width: 150 }} value={newUnit} onChange={e => setNewUnit(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addUnit(newUnit); setNewUnit(""); } }} />
            <datalist id="recall-apparatus">{d.apparatus.map(a => <option key={a.unit} value={a.unit}>{a.kind} {a.station}</option>)}</datalist>
            <button style={btn("outline")} onClick={() => { addUnit(newUnit); setNewUnit(""); }}><Plus size={13} /> Unit</button>
          </div>}>Unit staffing</H>
        {!units?.length && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No units on the board yet.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {(units || []).map((u, ui) => { const saved = d.units.find(x => x.id === u.id); return (
            <div key={u.id || u.unit} style={{ border: `1px solid ${saved?.inServiceAt ? SAGE : LINE}`, borderRadius: 10, padding: 10, background: saved?.inServiceAt ? "#F1F8F3" : "#fff" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <b style={{ fontSize: 15, color: INK, flex: 1 }}>{u.unit}{u.specialOps && <span style={{ fontSize: 11, color: BLUE, marginLeft: 6 }}>SPECIAL OPS</span>}</b>
                {saved && (saved.inServiceAt ? <Pill color={SAGE} solid>In service {time(saved.inServiceAt)}</Pill> : null)}
                {op && <button aria-label={`Remove ${u.unit}`} style={btn("ghost")} onClick={() => { setDirty(true); setUnits(units.filter((_, i) => i !== ui)); }}><Trash2 size={13} /></button>}
              </div>
              {(u.seats.length ? u.seats : [{ role: "officer" }, { role: "driver" }, { role: "ff" }]).map((s, si) => (
                <div key={si} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ width: 54, fontSize: 12, color: INK_SOFT, fontWeight: 700 }}>{ROLE[s.role]}</span>
                  <select aria-label={`${u.unit} ${ROLE[s.role]} seat ${si + 1}`} disabled={!op} style={{ ...inputStyle, flex: 1 }} value={s.userId || ""}
                    onChange={e => { if (!u.seats.length) { setDirty(true); setUnits(units.map((x, i) => i !== ui ? x : { ...x, seats: [{ role: "officer", userId: null }, { role: "driver", userId: null }, { role: "ff", userId: null }].map((y, j) => j === si ? { ...y, userId: e.target.value || null } : y) })); } else setSeat(ui, si, e.target.value); }}>
                    <option value="">— open —</option>
                    {people.map(p => <option key={p.userId} value={p.userId}>{p.name}{p.response === "coming" ? "" : " (no answer)"}{seatOf.get(p.userId) && s.userId !== p.userId ? ` · on ${seatOf.get(p.userId)}` : ""}</option>)}
                  </select>
                  {s.userId && !qualOk(s.role, s.userId) && <span title={s.role === "officer" ? "Not an officer title: acting officer?" : "No driver title or pumper/aerial sign-off"} style={{ color: AMBER }}><AlertTriangle size={14} /></span>}
                </div>))}
              {saved && op && <div style={{ marginTop: 6 }}><button style={btn(saved.inServiceAt ? "ghost" : "outline")} onClick={() => act(`units/${saved.id}/service`, { inService: !saved.inServiceAt }, saved.inServiceAt ? "" : `${u.unit} placed in service.`)}>
                {saved.inServiceAt ? "Undo in service" : "Placed in service with Comms"}</button></div>}
            </div>); })}
        </div>
        {op && dirty && <div style={{ marginTop: 10 }}><button style={btn("primary")} onClick={saveUnits}>Save staffing board</button> <button style={btn("ghost")} onClick={() => { setDirty(false); setUnits(d.units); }}>Discard</button></div>}
      </div>

      <div style={cardStyle}>
        <H>Timeline</H>
        <div style={{ maxHeight: 320, overflowY: "auto", fontSize: 13 }}>
          {d.log.slice().reverse().map((l, i) => <div key={i} style={{ padding: "4px 0", borderTop: `1px solid ${LINE}` }}><span style={{ color: INK_SOFT, width: 120, display: "inline-block" }}>{when(l.at)}</span> <b>{l.who}</b> {l.what}</div>)}
        </div>
        {op && <div style={{ display: "flex", gap: 6, marginTop: 8 }}><input aria-label="Timeline note" placeholder="Add a note (decisions, calls made, unit moves)…" style={inputStyle} value={note} onChange={e => setNote(e.target.value)} />
          <button style={btn("outline")} disabled={!note.trim()} onClick={async () => { await act("note", { text: note }); setNote(""); }}>Add</button></div>}
      </div>

      {d.canClose && (closing ? <div style={{ ...cardStyle, display: "grid", gap: 6, maxWidth: 600 }}>
        <textarea aria-label="Close note" rows={2} style={inputStyle} placeholder="Closing note (optional)" value={closeNote} onChange={e => setCloseNote(e.target.value)} />
        <div style={{ display: "flex", gap: 6 }}><button style={btn("primary")} onClick={async () => { await act("close", { note: closeNote }, "Recall closed."); setClosing(false); }}>Close recall</button><button style={btn("ghost")} onClick={() => setClosing(false)}>Cancel</button></div>
      </div> : <div><button style={btn("outline")} onClick={() => setClosing(true)}>Close this recall</button></div>)}
    </div>
  );
}
function printAfterAction(d, al) {
  const r = d.recall;
  const ppl = d.members.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml((RESP[m.response] || RESP[""])[0])}${m.eta ? ` (ETA ${escapeHtml(m.eta)})` : ""}</td><td>${escapeHtml(when(m.respondedAt))}</td>
    <td>${escapeHtml((al?.matches?.[m.id] || []).map(x => `${x.schedule} ${x.position}`).join("; "))}</td><td>${escapeHtml(when(m.checkedInAt))}</td></tr>`).join("");
  const units = d.units.map(u => `<tr><td>${escapeHtml(u.unit)}</td><td>${u.seats.map(s => `${ROLE[s.role]}: ${escapeHtml(d.members.find(m => m.userId === s.userId)?.name || "open")}`).join("<br>")}</td><td>${escapeHtml(when(u.inServiceAt))}</td></tr>`).join("");
  const cl = d.checklist.map(k => { const s = r.checklist[k.key] || {}; return `<tr><td>${s.done ? "✓" : ""}</td><td>${escapeHtml(k.label)}</td><td>${s.done ? escapeHtml(`${s.by}, ${when(s.at)}`) : ""}</td></tr>`; }).join("");
  const log = d.log.map(l => `<tr><td>${escapeHtml(when(l.at))}</td><td>${escapeHtml(l.who)}</td><td>${escapeHtml(l.what)}</td></tr>`).join("");
  printDocument(`Recall — ${r.title}`, `${letterhead("Emergency recall: after-action record")}<h1>${escapeHtml(r.title)}</h1>
    <div class="meta">${escapeHtml(r.kindLabel)} · ${escapeHtml(prettyDay(r.startDate))}${r.endDate !== r.startDate ? ` – ${escapeHtml(prettyDay(r.endDate))}` : ""} · started by ${escapeHtml(r.startedBy)} ${escapeHtml(when(r.startedAt))}${r.closedAt ? ` · closed ${escapeHtml(when(r.closedAt))} by ${escapeHtml(r.closedBy)}` : ""}</div>
    ${r.instructions ? `<p>${escapeHtml(r.instructions).replace(/\n/g, "<br>")}</p>` : ""}
    <h2>Checklist (Policy 1010)</h2><table><tbody>${cl}</tbody></table>
    <h2>People (${d.members.length})</h2><table><thead><tr><th>Name</th><th>Answer</th><th>Answered</th><th>Aladtec</th><th>Arrived</th></tr></thead><tbody>${ppl}</tbody></table>
    <h2>Units</h2><table><thead><tr><th>Unit</th><th>Seats</th><th>In service</th></tr></thead><tbody>${units}</tbody></table>
    <h2>Timeline</h2><table><tbody>${log}</tbody></table>`);
}

// ---- Settings ------------------------------------------------------------------------------------------
function RecallSettings({ roster, toast }) {
  const [s, setS] = useState(null), [error, setError] = useState("");
  useEffect(() => { call("/settings").then(x => setS(x.settings), e => setError(e.message)); }, []);
  if (!s) return error ? <div style={{ ...cardStyle, color: BRICK }}>{error}</div> : <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  const set = (k, v) => setS({ ...s, [k]: v });
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 900 }}>
      <div style={cardStyle}>
        <H sub="Job titles (patterns, | between words).">Who can start a recall, seat qualifications</H>
        <div style={{ display: "grid", gap: 8 }}>
          <label><span style={label}>Can start and close recalls (Assistant Chief on duty and above)</span><input aria-label="Starters" style={inputStyle} value={s.starters} onChange={e => set("starters", e.target.value)} /></label>
          <label><span style={label}>Officer seats</span><input aria-label="Officer titles" style={inputStyle} value={s.officerTitles} onChange={e => set("officerTitles", e.target.value)} /></label>
          <label><span style={label}>Driver seats (or a passed pumper / aerial evaluation)</span><input aria-label="Driver titles" style={inputStyle} value={s.driverTitles} onChange={e => set("driverTitles", e.target.value)} /></label>
          <label><span style={label}>Aladtec link in the notice</span><input aria-label="Aladtec link" style={inputStyle} value={s.portalUrl} onChange={e => set("portalUrl", e.target.value)} /></label>
        </div>
      </div>
      <div style={cardStyle}>
        <H sub="Policy 1010.4 step 15: Special Operations personnel for specific assignments and units to be staffed." right={<button style={btn("outline")} onClick={() => set("specialOps", [...s.specialOps, { unit: "", location: "", note: "", people: [] }])}><Plus size={13} /> Assignment</button>}>Special Operations assignments</H>
        {s.specialOps.map((x, i) => <div key={i} style={{ borderTop: `1px solid ${LINE}`, padding: "8px 0", display: "grid", gap: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 6 }}>
            <input aria-label={`Special Ops unit ${i + 1}`} placeholder="Unit" style={inputStyle} value={x.unit} onChange={e => set("specialOps", s.specialOps.map((y, j) => j === i ? { ...y, unit: e.target.value } : y))} />
            <input aria-label={`Special Ops location ${i + 1}`} placeholder="Where it works from" style={inputStyle} value={x.location} onChange={e => set("specialOps", s.specialOps.map((y, j) => j === i ? { ...y, location: e.target.value } : y))} />
            <button aria-label={`Remove assignment ${i + 1}`} style={btn("ghost")} onClick={() => set("specialOps", s.specialOps.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
          </div>
          <PeoplePicker roster={roster} value={x.people} onChange={v => set("specialOps", s.specialOps.map((y, j) => j === i ? { ...y, people: v } : y))} label={`Special Ops ${i + 1} people`} />
          <input aria-label={`Special Ops note ${i + 1}`} placeholder="Note" style={inputStyle} value={x.note} onChange={e => set("specialOps", s.specialOps.map((y, j) => j === i ? { ...y, note: e.target.value } : y))} />
        </div>)}
      </div>
      <Err e={error} />
      <div><button style={btn("primary")} onClick={async () => { try { await call("/settings", s); toast("Saved."); setError(""); } catch (e) { setError(e.message); } }}>Save</button></div>
    </div>
  );
}

// ---- The section ---------------------------------------------------------------------------------------
export default function RecallModule({ onBack, init }) {
  const [d, setD] = useState(null), [error, setError] = useState(""), [view, setView] = useState(init?.recall ? { kind: "board", id: init.recall } : { kind: "list" });
  const [roster, setRoster] = useState([]), [msg, setMsg] = useState("");
  const toast = m => { if (!m) return; setMsg(m); setTimeout(() => setMsg(x => (x === m ? "" : x)), 6000); };
  const load = () => call("").then(setD, e => setError(e.message));
  useEffect(() => { load(); fetch("/api/messages/people", { credentials: "same-origin" }).then(r => r.json()).then(r => setRoster((r.people || []).map(p => ({ id: p.id, name: p.name, division: p.division || "" })))).catch(() => {}); }, []);
  const nav = [
    { key: "list", label: "Recalls", icon: BellRing },
    ...(d?.canStart ? [{ key: "start", label: "Start a recall", icon: Plus }] : []),
    ...(d?.canManage ? [{ key: "settings", label: "Settings", icon: Settings }] : []),
  ];
  let page;
  if (error) page = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!d) page = <div style={{ color: INK_SOFT, padding: 16 }}>Loading…</div>;
  else if (view.kind === "board") page = <Board key={view.id} id={view.id} roster={roster} toast={toast} onBack={() => { setView({ kind: "list" }); load(); }} />;
  else if (view.kind === "start") page = <StartRecall d={d} roster={roster} onCancel={() => setView({ kind: "list" })} onDone={(id, n) => { toast(`Recall started: ${n} people notified.`); load(); setView({ kind: "board", id }); }} />;
  else if (view.kind === "settings") page = <RecallSettings roster={roster} toast={toast} />;
  else {
    const open = d.recalls.filter(r => r.status === "open"), closed = d.recalls.filter(r => r.status !== "open");
    const row = r => (
      <div key={r.id} role="button" tabIndex={0} aria-label={`Open recall ${r.title}`} onClick={() => setView({ kind: "board", id: r.id })} onKeyDown={e => e.key === "Enter" && setView({ kind: "board", id: r.id })}
        style={{ ...cardStyle, cursor: "pointer", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", borderLeft: `6px solid ${r.status === "open" ? BRICK : LINE}` }}>
        <BellRing size={22} color={r.status === "open" ? BRICK : INK_SOFT} />
        <div style={{ flex: 1, minWidth: 220 }}><div style={{ fontWeight: 800, fontSize: 15 }}>{r.title}</div>
          <div style={{ fontSize: 12.5, color: INK_SOFT }}>{r.kindLabel} · {prettyDay(r.startDate)}{r.endDate !== r.startDate ? ` – ${prettyDay(r.endDate)}` : ""} · {r.startedBy}</div></div>
        {r.mine && <Pill color={(RESP[r.mine.response] || RESP[""])[1]} solid={!!r.mine.response}>You: {(RESP[r.mine.response] || RESP[""])[0]}</Pill>}
        {d.canOperate || r.counts.total ? <div style={{ fontSize: 12.5, color: INK_SOFT, textAlign: "right" }}>{r.counts.coming} coming · {r.counts.total - r.counts.coming - r.counts.impaired} no answer<br />{r.counts.arrived} arrived</div> : null}
      </div>);
    page = (
      <div style={{ display: "grid", gap: 10 }}>
        {open.filter(r => r.mine && !r.mine.response).map(r => <MyRecall key={`my-${r.id}`} r={r} mine={{ response: r.mine.response, eta: r.mine.eta, note: r.mine.note }} portalUrl={d.portalUrl} onDone={load} toast={toast} />)}
        <div style={{ fontWeight: 800, color: INK }}>Open</div>
        {open.length ? open.map(row) : <div style={{ ...cardStyle, color: INK_SOFT }}>No recall is open.{d.canStart ? " Start one from the side bar." : ""}</div>}
        {closed.length > 0 && <><div style={{ fontWeight: 800, color: INK, marginTop: 8 }}>Past year</div>{closed.map(row)}</>}
      </div>);
  }
  const titles = { list: "Emergency recall", start: "Start an emergency recall", settings: "Recall settings", board: "Recall board" };
  return (
    <AppShell section="Emergency Recall" nav={nav} active={view.kind === "board" ? "list" : view.kind} onNav={k => setView({ kind: k })} onHome={onBack}>
      <h1 style={{ fontSize: 22, margin: "0 0 12px", color: INK }}>{titles[view.kind]}</h1>
      {msg && <div role="status" style={{ ...cardStyle, padding: "8px 12px", marginBottom: 10, background: "#EEF4FB", fontSize: 13.5 }}>{msg}</div>}
      {page}
    </AppShell>
  );
}
