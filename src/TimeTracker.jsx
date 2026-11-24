// Time Tracker: punches per day, totals toward the 80-hour pay period.
// Each person edits their own; master admins and people granted "view time
// punches" can look at others' (read-only).
import AppShell from "./AppShell.jsx";
import { Clock, History, User, Users, ChevronRight } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton, StatCard,
  loadShared, saveStrict, uid, INK, INK_SOFT, LINE, PAPER, BRICK, SAGE, AMBER, BRASS_DEEP,
} from "./App.jsx";
import { payPeriod, addDays, todayISO, pretty, fireShift, commsShifts, dayNum, WORK_PATTERNS, neededPerShift, unitWord, worksOn,
  previousPeriod, nextPeriod, periodHours, describePay, workSettings } from "./shifts.js";
import PunchClock from "./PunchClock.jsx";

export const PERIOD_HOURS = 80;   // St. George's; the page uses periodHours(period) from the organization settings
export const TIME_KINDS = [
  ["regular", "Regular"], ["vacation", "Vacation"], ["comp", "Comp time"], ["sick", "Sick leave"], ["swap", "Swap"],
];
const KIND_LABEL = Object.fromEntries(TIME_KINDS);
const KIND_COLOR = { regular: "#1D5FA8", vacation: "#2E7D4F", comp: "#7A4FB5", sick: "#B26A00", swap: "#6B7385" };

// "0700", "7:00", "7" -> "07:00"; anything else -> null
export function normalizeTime(v) {
  const s = String(v || "").trim().replace(/[^\d:]/g, "");
  let h, m;
  if (/^\d{1,2}:\d{2}$/.test(s)) [h, m] = s.split(":").map(Number);
  else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, -2)); m = Number(s.slice(-2)); }
  else if (/^\d{1,2}$/.test(s)) { h = Number(s); m = 0; }
  else return null;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function punchHours(start, end) {
  const [h1, m1] = start.split(":").map(Number), [h2, m2] = end.split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) mins += 24 * 60;
  return Math.round(mins / 60 * 100) / 100;
}
const hrs = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");

function canViewTimeOf(me, person) {
  if (!me || !person) return false;
  if (me.id === person.id || me.role === "master") return true;
  const tv = me.permissions?.timeView || [];
  return tv.includes("*") || tv.includes(person.division);
}

// Which fire / Communications shift is on: only for organizations that use those rotations (User Management › Organization)
function ShiftTags({ iso }) {
  const r = workSettings().rotations;
  if (!r.fire && !r.comms) return null;
  const c = commsShifts(iso);
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
      {r.fire && <span title="Fire (floor) shift on duty" style={{ fontSize: 10.5, fontWeight: 700, color: BRICK, border: `1px solid ${BRICK}55`, borderRadius: 4, padding: "0 4px" }}>
        Fire {fireShift(iso)}
      </span>}
      {r.comms && <span title="Communications: day shift 0700–1900 / night shift 1900–0700" style={{ fontSize: 10.5, fontWeight: 700, color: BRASS_DEEP, border: `1px solid ${BRASS_DEEP}55`, borderRadius: 4, padding: "0 4px" }}>
        Comms {c.day}/{c.night}
      </span>}
    </div>
  );
}

// One editable punch line
function EntryEditor({ entry, onSave, onDelete, onCancel }) {
  const [start, setStart] = useState(entry.start || "");
  const [end, setEnd] = useState(entry.end || "");
  const [hoursOnly, setHoursOnly] = useState(!!entry.id && !entry.start && entry.hours > 0);
  const [hours, setHours] = useState(entry.hours ? String(entry.hours) : "");
  const [kind, setKind] = useState(entry.kind || "regular");
  const [note, setNote] = useState(entry.note || "");
  const [error, setError] = useState("");
  const s = normalizeTime(start), e = normalizeTime(end);
  const preview = !hoursOnly && s && e ? punchHours(s, e) : null;

  function save() {
    if (hoursOnly) {
      const h = Number(hours);
      if (!(h > 0 && h <= 48)) { setError("Enter the number of hours (up to 48)."); return; }
      onSave({ ...entry, start: "", end: "", hours: Math.round(h * 100) / 100, kind, note: note.trim() });
      return;
    }
    if (!s || !e) { setError("Enter in and out as 24-hour times, like 0700 and 1730."); return; }
    onSave({ ...entry, start: s, end: e, hours: punchHours(s, e), kind, note: note.trim() });
  }
  const small = { ...inputStyle, padding: "6px 8px", fontSize: 13 };
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 6, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {!hoursOnly ? (
          <>
            <label style={{ fontSize: 12, color: INK_SOFT }}>In<br />
              <input aria-label="Time in" style={{ ...small, width: 80 }} placeholder="0700" value={start}
                onChange={ev => setStart(ev.target.value)} onBlur={() => { const n = normalizeTime(start); if (n) setStart(n); }} />
            </label>
            <label style={{ fontSize: 12, color: INK_SOFT }}>Out<br />
              <input aria-label="Time out" style={{ ...small, width: 80 }} placeholder="1730" value={end}
                onChange={ev => setEnd(ev.target.value)} onBlur={() => { const n = normalizeTime(end); if (n) setEnd(n); }} />
            </label>
          </>
        ) : (
          <label style={{ fontSize: 12, color: INK_SOFT }}>Hours<br />
            <input aria-label="Hours" type="number" min="0" max="48" step="0.25" style={{ ...small, width: 90 }} value={hours} onChange={ev => setHours(ev.target.value)} />
          </label>
        )}
        <label style={{ fontSize: 12, color: INK_SOFT }}>Type<br />
          <select aria-label="Hour type" style={{ ...small, width: "auto" }} value={kind} onChange={ev => setKind(ev.target.value)}>
            {TIME_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: INK_SOFT, flex: "1 1 160px" }}>Note (optional)<br />
          <input aria-label="Note" style={small} value={note} onChange={ev => setNote(ev.target.value)} placeholder="e.g. call-out, appointment" />
        </label>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, minWidth: 64, paddingBottom: 7 }}>
          {preview !== null ? `${hrs(preview)} h` : ""}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={btn("primary")} onClick={save}>Save</button>
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
        {entry.id && onDelete && <button style={{ ...btn("ghost"), color: BRICK }} onClick={onDelete}>Delete</button>}
        <label style={{ fontSize: 12.5, color: INK_SOFT, marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={hoursOnly} onChange={ev => setHoursOnly(ev.target.checked)} />
          Enter hours instead of in/out (leave)
        </label>
      </div>
      {preview !== null && e <= s && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>Ends the next day.</div>}
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 6 }}>{error}</div>}
    </div>
  );
}

// Team time: groups (division, then shift / crew) first, then the people in the group with their hours this period
const crewLabel = p => (p === "weekdays" ? "Weekdays" : /^fire:/.test(p || "") ? `${p.slice(5)} Shift` : /^comms:/.test(p || "") ? `${p.slice(6)} Crew` : "No schedule set");
function TeamTime({ people, entries, period, onPick, group, setGroup }) {
  const hoursOf = id => entries.filter(e => e.userId === id && e.date >= period.start && e.date <= period.end).reduce((s, e) => s + Number(e.hours || 0), 0);
  const groups = useMemo(() => {
    const g = new Map();
    for (const u of people) {
      const key = `${u.division || "No division"}|${crewLabel(u.workPattern)}`;
      if (!g.has(key)) g.set(key, { key, division: u.division || "No division", crew: crewLabel(u.workPattern), people: [] });
      g.get(key).people.push(u);
    }
    return [...g.values()].sort((a, b) => a.division.localeCompare(b.division) || a.crew.localeCompare(b.crew));
  }, [people]);
  const [q, setQ] = useState("");
  const found = q.trim() ? people.filter(u => u.name.toLowerCase().includes(q.trim().toLowerCase())) : null;
  const open = groups.find(x => x.key === group);
  const row = u => <button key={u.id} type="button" onClick={() => onPick(u.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "10px 12px", background: "#fff",
    border: "none", borderBottom: `1px solid ${LINE}`, cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: 14, color: INK }}>
    <User size={16} color={INK_SOFT} /><span style={{ flex: 1 }}>{u.name}{u.jobTitle ? <span style={{ color: INK_SOFT, fontSize: 12.5 }}> · {u.jobTitle}</span> : null}</span>
    <span style={{ fontSize: 13, color: INK_SOFT }}>{hrs(hoursOf(u.id))} h</span><ChevronRight size={16} color={INK_SOFT} /></button>;
  const divisions = [...new Set(groups.map(x => x.division))];
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
      <div><div style={sectionTitle}>{open ? `${open.division} · ${open.crew}` : "Team time"}</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>{open ? "Pick a person to see their punches." : "Pick a group, then a person."} Hours are for {pretty(period.start)} – {pretty(period.end)}.</div></div>
      <input aria-label="Find a person" placeholder="Find a person…" value={q} onChange={e => setQ(e.target.value)} style={{ ...inputStyle, width: 220 }} />
    </div>
    {found ? <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>{found.length ? found.map(row) : <div style={{ padding: 14, color: INK_SOFT }}>Nobody by that name.</div>}</div>
      : open ? <>
        <button type="button" style={{ ...btn("ghost"), marginBottom: 8 }} onClick={() => setGroup(null)}>‹ All groups</button>
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>{open.people.map(row)}</div></>
      : divisions.map(d => <div key={d} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{d}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
          {groups.filter(x => x.division === d).map(x => <button key={x.key} type="button" aria-label={`${d} ${x.crew}`} onClick={() => setGroup(x.key)}
            style={{ ...cardStyle, margin: 0, padding: "12px 14px", cursor: "pointer", textAlign: "left", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={18} color={INK_SOFT} /><span style={{ flex: 1 }}><b style={{ color: INK }}>{x.crew}</b><br /><span style={{ fontSize: 12.5, color: INK_SOFT }}>{x.people.length} {x.people.length === 1 ? "person" : "people"}</span></span>
            <ChevronRight size={16} color={INK_SOFT} /></button>)}
        </div></div>)}
  </div>;
}

export default function TimeTrackerModule({ onBack }) {
  const [loaded, setLoaded] = useState(false);
  const [roster, setRoster] = useState([]);
  const [entries, setEntries] = useState([]);
  const [identityId, setIdentityId] = useState(null);
  const [personId, setPersonId] = useState(null);
  const [periodStart, setPeriodStart] = useState(() => payPeriod(todayISO()).start);
  const [selectedDay, setSelectedDay] = useState(todayISO());
  const [editing, setEditing] = useState(null);   // entry id or "new"
  const [toast, setToast] = useState(null);
  const [team, setTeam] = useState(false), [teamGroup, setTeamGroup] = useState(null);

  useEffect(() => {
    (async () => {
      const [r, t, ident] = await Promise.all([
        loadShared("roster", []), loadShared("time-entries", []),
        (async () => { try { const x = await window.storage.get("current-identity", false); return x ? x.value : null; } catch (e) { return null; } })(),
      ]);
      setRoster(r); setEntries(t); setIdentityId(ident); setPersonId(ident);
      setLoaded(true);
    })();
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const reloadEntries = async () => { setEntries(await loadShared("time-entries", [])); };
  const [patternOverride, setPatternOverride] = useState(null);   // my pattern, just changed here
  async function savePattern(p) {
    const r = await fetch("/api/time/pattern", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify({ pattern: p }) });
    if (r.ok) { setPatternOverride(p); showToast("Schedule saved"); } else showToast("Couldn't save your schedule");
  }

  const me = roster.find(u => u.id === identityId) || null;
  const viewable = useMemo(() => roster.filter(u => canViewTimeOf(me, u)).sort((a, b) => a.name.localeCompare(b.name)), [roster, me]);
  const person = roster.find(u => u.id === personId) || me;
  const mine = !!me && person?.id === me.id;

  const period = payPeriod(periodStart);
  const days = Array.from({ length: dayNum(period.end) - dayNum(period.start) + 1 }, (_, i) => addDays(period.start, i));
  const PERIOD_HOURS = periodHours(period);
  const personEntries = entries.filter(e => e.userId === person?.id);
  const inPeriod = personEntries.filter(e => e.date >= period.start && e.date <= period.end);
  const byDay = d => inPeriod.filter(e => e.date === d).sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
  const total = inPeriod.reduce((s, e) => s + Number(e.hours || 0), 0);
  const byKind = Object.fromEntries(TIME_KINDS.map(([k]) => [k, inPeriod.filter(e => e.kind === k).reduce((s, e) => s + Number(e.hours || 0), 0)]));
  const remaining = Math.max(0, PERIOD_HOURS - total);
  const over = Math.max(0, total - PERIOD_HOURS);
  const today = todayISO();
  // Work days/shifts left in this period for the person's schedule (Time Tracker setting)
  const pattern = person && me && person.id === me.id && patternOverride !== null ? patternOverride : (person?.workPattern || "");
  const workedToday = inPeriod.some(e => e.date === today && (e.hours > 0) && !(e.start && !e.end));
  const need = neededPerShift({ pattern, period, today, remaining, workedToday });
  const isCurrent = today >= period.start && today <= period.end;

  async function saveEntry(entry) {
    const isNew = !entry.id;
    const rec = { ...entry, id: entry.id || uid(), userId: me.id, userName: me.name, division: me.division };
    const next = isNew ? [...entries, rec] : entries.map(x => x.id === rec.id ? rec : x);
    if (!(await saveStrict("time-entries", next))) return;
    setEntries(next); setEditing(null);
    showToast(isNew ? "Punch added" : "Punch updated");
  }
  async function deleteEntry(entry) {
    if (!window.confirm(`Delete this ${KIND_LABEL[entry.kind].toLowerCase()} entry (${hrs(entry.hours)} h)?`)) return;
    const next = entries.filter(x => x.id !== entry.id);
    if (!(await saveStrict("time-entries", next))) return;
    setEntries(next); setEditing(null);
    showToast("Punch deleted");
  }
  function goPeriod(delta) {
    const p = delta < 0 ? previousPeriod(period) : nextPeriod(period), start = p.start;
    setPeriodStart(start); setEditing(null);
    setSelectedDay(today >= start && today <= p.end ? today : start);
  }

  if (!loaded) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Loading…</div>;
  if (!me) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Your account isn't on the roster yet.</div>;

  const dayEntries = byDay(selectedDay);
  const pct = Math.min(100, (total / PERIOD_HOURS) * 100);
  const navBtn = { ...btn("outline"), padding: "6px 11px" };

  const prevStart = previousPeriod(payPeriod(today)).start;
  const shellActive = team || person.id !== me.id ? "team" : isCurrent ? "current" : period.start === prevStart ? "previous" : "";
  const shellGo = k => {
    setEditing(null);
    if (k === "team") { setTeam(true); setPersonId(me.id); return; }
    setTeam(false);
    if (k === "current" || k === "previous") {
      setPersonId(me.id);
      const start = k === "current" ? payPeriod(today).start : prevStart;
      setPeriodStart(start); setSelectedDay(k === "current" ? today : start);
      return;
    }
    setPersonId(k);
  };
  const shellNav = [
    { key: "current", label: "This pay period", icon: Clock },
    { key: "previous", label: "Last pay period", icon: History },
    ...(viewable.length > 1 ? [{ key: "team", label: "Team time", icon: Users }] : []),
  ];

  return (
    <AppShell section="Time Tracker" nav={shellNav} active={shellActive} onNav={shellGo} onHome={onBack}>
      {team ? <TeamTime people={viewable.filter(u => u.id !== me.id)} entries={entries} period={period} group={teamGroup} setGroup={setTeamGroup}
        onPick={id => { setPersonId(id); setTeam(false); setEditing(null); }} /> : <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={sectionTitle}>{mine ? "My time" : `${person.name}'s time`}</div>
            <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>Punches toward the {PERIOD_HOURS}-hour pay period ({describePay()}).</div>
          </div>
          {viewable.length > 1 && (
            <label style={{ fontSize: 12.5, color: INK_SOFT }}>Viewing<br />
              <select aria-label="Whose time" style={{ ...inputStyle, width: "auto", minWidth: 220 }} value={person.id}
                onChange={e => { setPersonId(e.target.value); setEditing(null); }}>
                {viewable.map(u => <option key={u.id} value={u.id}>{u.id === me.id ? `${u.name} (me)` : `${u.name} — ${u.division}`}</option>)}
              </select>
            </label>
          )}
        </div>

        {!mine && (
          <div style={{ ...cardStyle, padding: "10px 16px", marginBottom: 14, borderLeft: `4px solid ${AMBER}`, fontSize: 13 }}>
            Viewing <b>{person.name}</b>'s time (read-only).
          </div>
        )}

        {mine && (
          <div style={{ ...cardStyle, padding: "12px 16px", marginBottom: 14, borderLeft: `4px solid ${SAGE}` }}>
            <PunchClock onChange={reloadEntries} />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button style={navBtn} aria-label="Previous pay period" onClick={() => goPeriod(-1)}>‹ Previous</button>
          <div style={{ fontWeight: 700, fontSize: 15, color: INK, padding: "0 6px" }}>
            {pretty(period.start)} – {pretty(period.end, { month: "short", day: "numeric", year: "numeric" })}
            <span style={{ fontWeight: 400, color: INK_SOFT, fontSize: 13 }}> · pay day {pretty(period.payday, { weekday: "short", month: "short", day: "numeric" })}</span>
          </div>
          <button style={navBtn} aria-label="Next pay period" onClick={() => goPeriod(1)}>Next ›</button>
          {!isCurrent && <button style={btn("ghost")} onClick={() => { const p = payPeriod(today); setPeriodStart(p.start); setSelectedDay(today); setEditing(null); }}>Current period</button>}
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <StatCard label="Hours this period" value={hrs(total)} accent={INK} sub={`of ${PERIOD_HOURS}`} />
          <StatCard label={over > 0 ? `Over ${PERIOD_HOURS}` : `Remaining to ${PERIOD_HOURS}`} value={hrs(over > 0 ? over : remaining)} accent={over > 0 ? AMBER : remaining === 0 ? SAGE : BRICK} />
          <StatCard label={`Needed per ${unitWord(pattern, 1)}`} value={remaining === 0 ? "0" : need.perShift === null ? "—" : hrs(need.perShift)}
            accent={BRASS_DEEP} sub={today > period.end ? "Period has ended" : need.left > 0 ? `${need.left} ${unitWord(pattern, need.left)} left${workedToday ? "" : ", counting today"}` : `No ${unitWord(pattern, 2)} left this period`} />
        </div>
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {mine ? (
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>My schedule:
              <select aria-label="My schedule" style={{ ...inputStyle, width: "auto", padding: "4px 8px", fontSize: 12.5 }} value={pattern} onChange={e => savePattern(e.target.value)}>
                {WORK_PATTERNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          ) : <span>Schedule: <b>{(WORK_PATTERNS.find(([k]) => k === pattern) || WORK_PATTERNS[0])[1]}</b></span>}
          {!pattern && mine && <span style={{ color: AMBER }}>Pick your schedule so "needed per shift" counts only the days you work.</span>}
          {pattern && <span><span style={{ display: "inline-block", width: 14, height: 4, background: BRASS_DEEP, borderRadius: 2, verticalAlign: "middle", marginRight: 4 }} />= scheduled to work</span>}
        </div>
        <div style={{ ...cardStyle, padding: "12px 16px", marginBottom: 16 }}>
          <div aria-label={`${hrs(total)} of ${PERIOD_HOURS} hours`} style={{ height: 10, background: "#E6EAF0", borderRadius: 999, overflow: "hidden", display: "flex" }}>
            {TIME_KINDS.map(([k]) => byKind[k] > 0 && (
              <div key={k} title={`${KIND_LABEL[k]}: ${hrs(byKind[k])} h`} style={{ width: `${Math.min(100, byKind[k] / Math.max(PERIOD_HOURS, total) * 100)}%`, background: KIND_COLOR[k] }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: INK_SOFT }}>
            {TIME_KINDS.map(([k, l]) => (
              <span key={k}><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: KIND_COLOR[k], marginRight: 5 }} />{l}: <b style={{ color: INK }}>{hrs(byKind[k])}</b></span>
            ))}
            <span style={{ marginLeft: "auto" }}>{Math.round(pct)}% of {PERIOD_HOURS}</span>
          </div>
        </div>

        {/* Two weeks, Thursday through Wednesday */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].map(d => (
            <div key={d} style={{ fontSize: 11.5, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, padding: "0 4px" }}>{d}</div>
          ))}
          {days.map(d => {
            const list = byDay(d);
            const dayTotal = list.reduce((s, e) => s + Number(e.hours || 0), 0);
            const sel = d === selectedDay;
            const workDay = !!pattern && worksOn(pattern, d);
            return (
              <div key={d} role="button" aria-label={`${pretty(d, { weekday: "long", month: "long", day: "numeric" })}, ${hrs(dayTotal)} hours${workDay ? ", scheduled work day" : ""}`}
                title={workDay ? "Scheduled to work (your schedule setting)" : undefined}
                onClick={() => { setSelectedDay(d); setEditing(null); }}
                style={{
                  background: "#fff", border: `1px solid ${sel ? INK : LINE}`, boxShadow: sel ? `inset 0 0 0 1px ${INK}` : "none",
                  borderRadius: 7, padding: "7px 8px", minHeight: 96, cursor: "pointer", minWidth: 0,
                  borderTop: workDay ? `4px solid ${BRASS_DEEP}` : undefined,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: d === today ? "#fff" : INK, background: d === today ? BRICK : "transparent", borderRadius: 4, padding: d === today ? "0 5px" : 0 }}>
                    {pretty(d)}
                  </span>
                  {dayTotal > 0 && <span style={{ fontWeight: 700, fontSize: 13, color: INK }}>{hrs(dayTotal)} h</span>}
                </div>
                <ShiftTags iso={d} />
                <div style={{ marginTop: 5 }}>
                  {list.map(e => (
                    <div key={e.id} style={{ fontSize: 11.5, color: INK, display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: KIND_COLOR[e.kind], flexShrink: 0 }} />
                      {e.start && !e.end ? `${e.start.replace(":", "")}– on the clock` : e.start ? `${e.start.replace(":", "")}–${e.end.replace(":", "")} · ${hrs(e.hours)}` : `${KIND_LABEL[e.kind]} · ${hrs(e.hours)}`}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected day */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{pretty(selectedDay, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
              {(workSettings().rotations.fire || workSettings().rotations.comms) && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>
                {workSettings().rotations.fire && <>Fire on duty: <b>{fireShift(selectedDay)} shift</b></>}
                {workSettings().rotations.fire && workSettings().rotations.comms && " · "}
                {workSettings().rotations.comms && <>Communications: <b>{commsShifts(selectedDay).day}</b> days (0700–1900), <b>{commsShifts(selectedDay).night}</b> nights (1900–0700)</>}
              </div>}
            </div>
            {mine && editing !== "new" && <button style={btn("primary")} onClick={() => setEditing("new")}>+ Add punch</button>}
          </div>

          {dayEntries.length === 0 && editing !== "new" && <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 10 }}>No time entered for this day.</div>}
          {dayEntries.map(e => (
            editing === e.id ? (
              <EntryEditor key={e.id} entry={e} onSave={saveEntry} onDelete={() => deleteEntry(e)} onCancel={() => setEditing(null)} />
            ) : (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: `1px solid ${LINE}`, fontSize: 13.5, flexWrap: "wrap" }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: KIND_COLOR[e.kind] }} />
                <span style={{ fontWeight: 700, minWidth: 110, fontVariantNumeric: "tabular-nums" }}>{e.start ? `${e.start} – ${e.end || "…"}` : "Hours only"}</span>
                <span style={{ minWidth: 70, color: e.start && !e.end ? SAGE : INK, fontWeight: e.start && !e.end ? 700 : 400 }}>{e.start && !e.end ? "On the clock" : `${hrs(e.hours)} h`}</span>
                <span style={{ color: KIND_COLOR[e.kind], fontWeight: 600, minWidth: 90 }}>{KIND_LABEL[e.kind]}</span>
                <span style={{ color: INK_SOFT, flex: 1 }}>{e.note}</span>
                {mine && <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => setEditing(e.id)}>Edit</button>}
              </div>
            )
          ))}
          {editing === "new" && (
            <EntryEditor entry={{ date: selectedDay, kind: "regular" }} onSave={saveEntry} onCancel={() => setEditing(null)} />
          )}
          {dayEntries.length > 0 && (
            <div style={{ textAlign: "right", fontWeight: 700, fontSize: 13.5, marginTop: 8 }}>
              Day total: {hrs(dayEntries.reduce((s, e) => s + Number(e.hours || 0), 0))} h
            </div>
          )}
          <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 8 }}>
            Use <b>Punch in</b> / <b>Punch out</b> at the top to record times as you go, or add them here afterwards.
            Times are 24-hour (type 0700 or 07:00). An out time earlier than the in time ends the next day, so a 0700–0700 shift is 24 hours.
            Hours count on the day the punch starts. All hour types count toward {PERIOD_HOURS}.
          </div>
        </div>
      </div>}
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </AppShell>
  );
}
