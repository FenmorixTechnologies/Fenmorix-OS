// Leave Picks: annual vacation/holiday pick (server/leave.js).
// Pages: My picks (calendar + this turn's pick), My unit (turn order), All units, Reports, Setup.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Users, LayoutGrid, FileSpreadsheet, Settings, Star, Lock, Link2, ChevronUp, ChevronDown, Upload, Download, AlertTriangle, CheckCircle2, Clock3, Undo2, SkipForward, Trash2, Plus, X } from "lucide-react";
import AppShell from "./AppShell.jsx";
import { cardStyle, inputStyle, btn } from "./App.jsx";
import { fireShift, commsShifts, addDays } from "./shifts.js";
import { PN } from "./brand.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", PAPER = "#F3F5F8", BRICK = "#C8102E", SAGE = "#2E7D4F", AMBER = "#B26A00", BLUE = "#1D5FA8";
const CODE_BG = { OH: "#D7E6F7", OV: "#DCEFE2", OC: "#EFE3F7", "??": "#F8C9CF" };
const CODE_INK = { OH: "#1D4F8A", OV: "#1E6B3E", OC: "#6A3C8C", "??": BRICK };
const CODE_NAME = { OH: "Holiday", OV: "Vacation", OC: "Banked / comp", OVER: "More than available" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function call(path, body) {
  const r = await fetch(`/api/leave${path}`, body === undefined ? { credentials: "same-origin" }
    : { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
}
const pretty = d => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const h = n => `${Math.round(n * 100) / 100} h`;
const shiftsOf = (hours, per) => { const s = Math.round((hours / per) * 100) / 100; return `${s} shift${s === 1 ? "" : "s"}`; };
const initials = n => String(n || "?").split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const label = { fontSize: 12.5, color: INK_SOFT, fontWeight: 600, display: "block", marginBottom: 4 };

function unitShifts(unit, year, rules) {
  const out = new Map();
  for (let d = `${year}-01-01`; d <= `${year}-12-31`; d = addDays(d, 1)) {
    if (unit.ruleset === "fire") { if (fireShift(d) === unit.shift) out.set(d, rules.fire.start || "0700"); }
    else { const c = commsShifts(d); if (c.day === unit.shift) out.set(d, "0700"); else if (c.night === unit.shift) out.set(d, "1900"); }
  }
  return out;
}
const blockedOn = (rs, d) => (rs.blocked || []).find(b => d >= b.from && d <= (b.to || b.from));

export default function LeavePicksModule({ onBack }) {
  const [list, setList] = useState(null);
  const [sid, setSid] = useState(null);
  const [data, setData] = useState(null);
  const [page, setPage] = useState(null);
  const [unitId, setUnitId] = useState(null);
  const [actingFor, setActingFor] = useState(null);     // pick for someone else (leader / admin)
  const [toast, setToast] = useState(null);
  const [error, setError] = useState("");
  const say = m => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const loadList = async () => {
    try {
      const l = await call("");
      setList(l);
      if (!sid || !l.seasons.some(s => s.id === sid)) {
        const best = l.seasons.find(s => s.status === "open" && s.mine) || l.seasons.find(s => s.status === "open") || l.seasons.find(s => s.mine) || l.seasons[0];
        setSid(best?.id || null);
        if (!best) setPage(l.access.manage ? "setup" : "none");
      }
    } catch (e) { setError(e.message); }
  };
  const load = async (id = sid) => { if (!id) return; try { setData(await call(`/${id}`)); setError(""); } catch (e) { setError(e.message); } };
  useEffect(() => { loadList(); }, []);
  useEffect(() => { setData(null); load(); }, [sid]);
  useEffect(() => {
    const on = e => { if (!e.detail?.seasonId || e.detail.seasonId === sid) load(); };
    window.addEventListener("sgfd-leave", on);
    const t = setInterval(() => load(), 60_000);
    return () => { window.removeEventListener("sgfd-leave", on); clearInterval(t); };
  }, [sid]);
  useEffect(() => {
    if (!data || page) return;
    setPage(data.me ? "mine" : data.access.view || data.access.edit || data.access.manage || data.access.officer?.length ? "units" : "mine");
  }, [data]);

  const acc = data?.access || list?.access || {};
  const seeAll = acc.view || acc.edit || acc.manage;
  const myUnit = data?.units.find(u => u.id === data?.me?.unitId);
  const myTurn = !!myUnit?.turn && myUnit.turn.memberId === data?.me?.memberId;
  const nav = [
    ...(data?.me ? [{ key: "mine", label: "My picks", icon: CalendarDays, badge: myTurn ? 1 : 0 }, { key: "unit", label: myUnit ? "My unit" : "My unit", icon: Users }] : []),
    ...(seeAll || acc.officer?.length ? [{ key: "units", label: seeAll ? "All units" : "My shift", icon: LayoutGrid }] : []),
    ...(acc.reports || acc.view || acc.manage ? [{ key: "reports", label: "Reports", icon: FileSpreadsheet }] : []),
    ...(acc.manage ? [{ key: "setup", label: "Setup", icon: Settings, group: "Admin" }] : []),
  ];
  const go = k => { setActingFor(null); if (k === "unit") setUnitId(myUnit?.id || null); setPage(k); };

  const season = data?.season;
  const header = (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: INK }}>Leave Picks {season ? season.year : ""}</div>
        {season && <div style={{ fontSize: 13, color: INK_SOFT }}>
          {season.status === "open" ? "Picking is open." : season.status === "closed" ? "Picking is closed. Changes need the Fire Chief or his designee." : "Being set up. Picking hasn't opened yet."}
        </div>}
      </div>
      {list?.seasons?.length > 1 && (
        <select aria-label="Pick year" style={{ ...inputStyle, width: "auto" }} value={sid || ""} onChange={e => { setSid(e.target.value); setPage(null); }}>
          {list.seasons.map(s => <option key={s.id} value={s.id}>{s.year}{s.status === "open" ? " (open)" : s.status === "setup" ? " (setting up)" : ""}</option>)}
        </select>
      )}
    </div>
  );

  let body = null;
  if (error) body = <div style={{ ...cardStyle, color: BRICK }}>{error}</div>;
  else if (!list) body = <div style={{ color: INK_SOFT }}>Loading…</div>;
  else if (page === "none" || (!sid && page !== "setup")) body = <div style={cardStyle}>There's no leave pick to show yet. When your division opens one, it'll be here.</div>;
  else if (page === "setup") body = <Setup list={list} sid={sid} data={data} setSid={id => { setSid(id); }} reloadList={loadList} reload={() => load()} say={say} />;
  else if (!data) body = <div style={{ color: INK_SOFT }}>Loading…</div>;
  else if (page === "mine") {
    const unit = actingFor ? data.units.find(u => u.members.some(m => m.id === actingFor)) : myUnit;
    const member = unit?.members.find(m => m.id === (actingFor || data.me?.memberId));
    body = member ? <PickPage key={member.id} data={data} unit={unit} member={member} self={!actingFor} reload={() => load()} say={say}
      onBack={actingFor ? () => { setActingFor(null); setPage("unit"); } : null} />
      : <div style={cardStyle}>You're not in the {season.year} leave pick. If you should be, ask your Assistant Chief or supervisor.</div>;
  } else if (page === "unit") {
    const unit = data.units.find(u => u.id === (unitId || myUnit?.id));
    body = unit ? <UnitPage data={data} unit={unit} reload={() => load()} say={say} onPickFor={id => { setActingFor(id); setPage("mine"); }} />
      : <div style={cardStyle}>Choose a unit under All units.</div>;
  } else if (page === "units") body = <UnitsPage data={data} onOpen={id => { setUnitId(id); setPage("unit"); }} />;
  else if (page === "reports") body = <Reports data={data} />;

  return (
    <AppShell section="Leave Picks" nav={nav} active={actingFor ? "unit" : page} onNav={go} onHome={onBack} wide>
      {header}
      {body}
      {toast && <div role="status" style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: INK, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13.5, fontWeight: 600, zIndex: 80, maxWidth: "90vw" }}>{toast}</div>}
    </AppShell>
  );
}

// ---- The year calendar --------------------------------------------------------------------------
function YearCalendar({ year, unit, rules, focusId, selected, onToggle, pools, compact }) {
  const rs = rules[unit.ruleset];
  const works = useMemo(() => unitShifts(unit, year, rules), [unit.id, year]);
  const taken = useMemo(() => {
    const m = new Map();
    for (const mem of unit.members) for (const p of mem.picks) for (const d of p.days) m.set(d.day, { mem, d });
    return m;
  }, [unit]);
  const poolMap = pools?.[`${unit.ruleset}|${unit.pool}|${unit.shift}`] || {};
  const cap = rs.caps?.[unit.pool];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 200 : 228}px, 1fr))`, gap: 12 }}>
      {MONTHS.map((name, mi) => {
        const first = `${year}-${String(mi + 1).padStart(2, "0")}-01`;
        const lead = new Date(`${first}T12:00:00`).getDay();
        const days = []; for (let d = first; d.slice(5, 7) === first.slice(5, 7); d = addDays(d, 1)) days.push(d);
        return (
          <div key={name} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: INK, marginBottom: 4 }}>{name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {"SMTWTFS".split("").map((w, i) => <div key={i} style={{ fontSize: 10, color: INK_SOFT, textAlign: "center" }}>{w}</div>)}
              {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
              {days.map(d => {
                const start = works.get(d);
                const t = taken.get(d);
                const mine = t && t.mem.id === focusId;
                const sel = selected?.includes(d);
                const blk = start && blockedOn(rs, d);
                const off = poolMap[d] || [];
                const bumpedMine = mine && t.d.standing?.bumped;
                const code = mine ? (t.d.codes?.[0]?.code || "") : "";
                const clickable = onToggle && start && !t && !blk;
                let bg = "#fff", fg = "#B5BCC8", border = "1px solid transparent";
                if (start) { bg = "#F4F6FA"; fg = INK; border = `1px solid ${LINE}`; }
                if (blk) { bg = "repeating-linear-gradient(45deg, #FBE2E5, #FBE2E5 3px, #fff 3px, #fff 6px)"; fg = BRICK; }
                if (t && !mine) { bg = "#C9D0DB"; fg = INK; }
                if (mine) { bg = CODE_BG[code] || "#D7E6F7"; fg = CODE_INK[code] || INK; border = `1px solid ${bumpedMine ? BRICK : CODE_INK[code] || BLUE}`; }
                if (sel) { bg = "#FFB23F"; fg = INK; border = `2px solid ${AMBER}`; }
                const tip = [pretty(d), start ? (unit.ruleset === "comms" ? `${start === "0700" ? "Day" : "Night"} shift ${start}` : `${unit.shift} shift`) : "not a shift day",
                  blk ? `Blocked: ${blk.label || "no leave"}` : "", t ? `${mine ? "Your pick" : `Taken: ${t.mem.name}`}${mine && code ? ` (${CODE_NAME[code] || code})` : ""}` : "",
                  cap && start ? `${off.length} of ${cap} off on ${unit.shift} shift${off.length ? `: ${off.map(o => `${o.name}${o.bumped ? " (flagged)" : ""}`).join(", ")}` : ""}` : ""].filter(Boolean).join(" · ");
                return (
                  <button key={d} type="button" title={tip} aria-label={tip} aria-pressed={sel ? "true" : undefined} disabled={!clickable}
                    onClick={() => clickable && onToggle(d)}
                    style={{ position: "relative", height: compact ? 26 : 32, borderRadius: 5, border, background: bg, color: fg, fontSize: 11.5, fontWeight: start ? 700 : 400,
                      padding: 0, cursor: clickable ? "pointer" : "default", fontFamily: "inherit", lineHeight: 1.05 }}>
                    {Number(d.slice(8))}
                    {start && unit.ruleset === "comms" && !t && !blk && <span style={{ position: "absolute", top: 1, right: 2, fontSize: 7.5, color: INK_SOFT }}>{start === "0700" ? "D" : "N"}</span>}
                    {t && <div style={{ fontSize: 8.5, fontWeight: 800 }}>{mine ? code : initials(t.mem.name)}</div>}
                    {cap && start && off.length > 0 && !t && <span style={{ position: "absolute", bottom: 0, left: 2, fontSize: 7.5, color: off.length >= cap ? BRICK : INK_SOFT, fontWeight: 700 }}>{off.length}</span>}
                    {bumpedMine && <span style={{ position: "absolute", top: -3, right: -3, width: 9, height: 9, borderRadius: 5, background: BRICK }} />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Legend({ unit, rules }) {
  const rs = rules[unit.ruleset];
  const chip = (bg, text, extra = {}) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: INK_SOFT }}><span style={{ width: 14, height: 14, borderRadius: 3, background: bg, border: `1px solid ${LINE}`, ...extra }} />{text}</span>;
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "8px 0 12px" }}>
      {chip("#F4F6FA", unit.ruleset === "comms" ? "Your crew works (D = day 0700, N = night 1900)" : `${unit.shift} shift works`)}
      {chip("#FFB23F", "Selected")}
      {chip(CODE_BG.OH, "Your holiday (OH)")}{chip(CODE_BG.OV, "Your vacation (OV)")}{chip(CODE_BG.OC, "Banked / comp (OC)")}
      {chip("#C9D0DB", "Taken in your unit")}
      {chip("repeating-linear-gradient(45deg, #FBE2E5, #FBE2E5 3px, #fff 3px, #fff 6px)", "Blocked")}
      {rs.caps?.[unit.pool] ? <span style={{ fontSize: 12, color: INK_SOFT }}>Small number = people off on {unit.shift} shift that day (first {rs.caps[unit.pool]} by years of service are offered)</span> : null}
    </div>
  );
}

// ---- Making picks ----------------------------------------------------------------------------------
function PickPage({ data, unit, member, self, reload, say, onBack }) {
  const { season } = data;
  const rs = season.rules[unit.ruleset];
  const [sel, setSel] = useState([]);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  // Out of turn: a leader / coordinator enters a pick phoned in or from paper
  const canManual = member.canAct && (!self || data.access.manage) && (season.status === "open" || (season.status === "closed" && data.access.manage));
  const [manual, setManual] = useState(false);
  const [waive, setWaive] = useState(false);
  const myTurn = unit.turn?.memberId === member.id;
  const nextManual = Math.max(0, ...member.picks.map(p => p.round)) + 1;
  const round = manual ? nextManual : myTurn ? unit.turn.round : null;
  const canPick = member.canAct && (manual || (myTurn && season.status === "open"));
  const first = round && round <= rs.firstPicks;
  const max = first ? rs.firstMax : rs.laterMax;
  const consecutive = first ? rs.firstConsecutive : rs.laterConsecutive;
  const up = unit.turn ? unit.members.find(m => m.id === unit.turn.memberId) : null;
  const who = self ? "You" : member.name.split(" ")[0];
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!sel.length) { setCheck(null); return; }
    timer.current = setTimeout(() => call(`/${season.id}/check`, { memberId: member.id, days: sel, manual, waive }).then(setCheck, e => setCheck({ errors: [e.message], warnings: [], days: [] })), 250);
  }, [sel.join(","), manual, waive]);
  const toggle = d => {
    if (!canPick) return;
    setSel(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d].sort());
  };
  async function submit() {
    setBusy(true);
    try {
      const r = await call(`/${season.id}/pick`, { memberId: member.id, days: sel, manual, waive });
      if (!r.ok) { setCheck(r); setBusy(false); return; }
      setSel([]); setCheck(null); await reload();
      say(`Pick ${r.round} saved${manual ? " (entered out of turn)" : ""}${r.warnings?.length ? ` (${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"})` : ""}.`);
      setManual(false); setWaive(false);
    } catch (e) { say(e.message); await reload(); }
    setBusy(false);
  }
  async function done(on) {
    if (on && !window.confirm(`${self ? "Finish picking" : `Mark ${member.name} done`}? ${member.remaining ? `${h(member.remaining)} of leave stays unscheduled.` : ""}`)) return;
    try { await call(`/${season.id}/done`, { memberId: member.id, done: on }); await reload(); say(on ? "Marked done." : "Picking reopened."); } catch (e) { say(e.message); }
  }
  async function undo(p, day) {
    if (!window.confirm(day ? `Rescind ${pretty(day)}?` : `Take back pick ${p.round}?`)) return;
    try { await call(`/${season.id}/undo`, { pickId: p.id, day }); await reload(); say(day ? "Day rescinded." : "Pick taken back."); } catch (e) { say(e.message); }
  }
  const per = rs.shiftHours;
  const lastUnitPick = unit.members.flatMap(m => m.picks.map(p => ({ ...p, memberId: m.id }))).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  return (
    <div>
      {onBack && <button style={{ ...btn("ghost"), marginBottom: 8 }} onClick={onBack}>‹ Back to {unit.label}</button>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div style={{ ...cardStyle, marginBottom: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>{self ? "Your leave" : `Picking for ${member.name}`}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: INK, margin: "2px 0 8px" }}>{unit.label}{member.leader ? " · leader" : ""}</div>
          <Row k="Holidays" v={`${h(member.holiday)} (${shiftsOf(member.holiday, per)})`} />
          <Row k="Vacation" v={`${h(member.vacation)} (${shiftsOf(member.vacation, per)})`} />
          {member.banked > 0 && <Row k="Banked / comp" v={`${h(member.banked)} (${shiftsOf(member.banked, per)})`} />}
          <Row k="Scheduled" v={h(member.used)} />
          <Row k="Left to schedule" v={<b style={{ color: member.remaining >= per ? INK : SAGE }}>{h(member.remaining)} ({shiftsOf(member.remaining, per)})</b>} />
          {member.holidaysLeft > 0 && rs.holidaysAll && <div style={{ fontSize: 12.5, color: AMBER, marginTop: 6 }}>All holidays must be scheduled: {shiftsOf(member.holidaysLeft, per)} of holidays left.</div>}
          {member.anniversary && <div style={{ fontSize: 12.5, color: AMBER, marginTop: 6 }}>Under one year of service: before {pretty(member.anniversary)} only holiday leave can be used.</div>}
        </div>
        <div style={{ ...cardStyle, marginBottom: 0, borderTop: `4px solid ${myTurn ? SAGE : member.done || member.autoDone ? INK_SOFT : AMBER}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>Turn</div>
          {season.status !== "open" ? <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{season.status === "setup" ? "Picking hasn't opened yet." : "Picking is closed."}</div>
            : member.done || member.autoDone ? <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: SAGE }}><CheckCircle2 size={16} style={{ verticalAlign: -3 }} /> {who === "You" ? "You're" : `${who} is`} done picking.</div>
            : myTurn ? <>
              <div style={{ fontSize: 17, fontWeight: 800, color: SAGE, marginTop: 4 }}>{self ? "It's your turn" : `It's ${who}'s turn`}: pick {round}</div>
              <div style={{ fontSize: 13.5, color: INK, marginTop: 4 }}>Choose up to <b>{max} shift{max === 1 ? "" : "s"}</b>{consecutive ? <> <b>in a row</b></> : " (any dates)"}. Tap days on the calendar.</div>
            </> : <div style={{ fontSize: 14, marginTop: 4 }}><Clock3 size={14} style={{ verticalAlign: -2 }} /> {up ? <>Waiting for <b>{up.name}</b> (pick {unit.turn.round}).</> : "Waiting."}</div>}
          {rs.note && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8, whiteSpace: "pre-wrap" }}>{rs.note}</div>}
          <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 8 }}>
            Picks {rs.firstPicks ? `1–${rs.firstPicks}: up to ${rs.firstMax} shifts${rs.firstConsecutive ? " in a row" : ""}; after that` : "Each pick:"} up to {rs.laterMax}{rs.laterConsecutive ? " in a row" : " shifts, any dates"}. One person off per {unit.ruleset === "comms" ? "crew shift" : "unit per shift"}.
          </div>
          {canManual && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: manual ? "#FFF4E0" : PAPER, borderRadius: 8, border: `1px solid ${manual ? "#F2C987" : LINE}` }}>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, cursor: "pointer" }}>
                <input type="checkbox" checked={manual} onChange={e => { setManual(e.target.checked); if (!e.target.checked) setWaive(false); setSel([]); }} style={{ marginTop: 3 }} />
                <span><b>Enter a pick out of turn</b><div style={{ fontSize: 12.5, color: INK_SOFT }}>For a pick phoned in (working another shift) or backfilled from paper. It's saved as {member.name.split(" ")[0]}'s pick {nextManual}.</div></span>
              </label>
              {manual && (
                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginTop: 6, marginLeft: 22 }}>
                  <input type="checkbox" checked={waive} onChange={e => setWaive(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>Set aside the pick-size and in-a-row rules for this entry<div style={{ fontSize: 12, color: INK_SOFT }}>One off per shift, blocked dates and hours still apply.</div></span>
                </label>
              )}
            </div>
          )}
          {season.status === "open" && member.canAct && (
            <div style={{ marginTop: 10 }}>
              {member.done ? <button style={btn("outline")} onClick={() => done(false)}>Reopen picking</button>
                : !member.autoDone && <button style={btn("outline")} onClick={() => done(true)}>{self ? "I'm done picking" : "Mark done"}</button>}
            </div>
          )}
        </div>
      </div>

      {canPick && (
        <div role="region" aria-label="This pick" style={{ ...cardStyle, position: "sticky", top: 8, zIndex: 5, boxShadow: "0 8px 24px rgba(19,35,63,0.15)", borderLeft: `5px solid ${manual ? AMBER : SAGE}` }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>{manual ? `Out of turn, ${member.name.split(" ")[0]}'s pick ${round}:` : `Pick ${round}:`}</b> {sel.length ? `${sel.length} shift${sel.length === 1 ? "" : "s"} selected` : "nothing selected yet"}
              {check?.days?.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {check.days.map(d => <span key={d.day} style={{ fontSize: 12.5, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 6, padding: "2px 7px" }}>
                  {pretty(d.day)}{unit.ruleset === "comms" ? ` ${d.start}` : ""} · {(d.codes || []).map(c => `${c.code}${c.hours !== per ? ` ${c.hours}h` : ""}`).join("+")}
                  {d.rank ? <span style={{ color: d.rank > d.cap ? BRICK : INK_SOFT }}> · #{d.rank} of {d.of}</span> : null}
                </span>)}
              </div>}
              {check?.errors?.map((e, i) => <div key={i} style={{ color: BRICK, fontSize: 13, marginTop: 4 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {e}</div>)}
              {check?.warnings?.map((e, i) => <div key={i} style={{ color: AMBER, fontSize: 13, marginTop: 4 }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {e}</div>)}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {sel.length > 0 && <button style={btn("ghost")} onClick={() => setSel([])}>Clear</button>}
              <button style={btn("primary")} disabled={busy || !sel.length || !check || check.errors?.length > 0} onClick={submit}>{busy ? "Saving…" : manual ? `Save pick ${round}` : `Submit pick ${round}`}</button>
            </div>
          </div>
        </div>
      )}

      <Legend unit={unit} rules={season.rules} />
      <YearCalendar year={season.year} unit={unit} rules={season.rules} focusId={member.id} selected={sel}
        onToggle={canPick ? toggle : null} pools={data.pools} />

      <div style={{ ...cardStyle, marginTop: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{self ? "Your picks" : `${member.name}'s picks`}</div>
        {!member.picks.length && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>No picks yet.</div>}
        {member.picks.map(p => {
          const canUndo = (member.canAct && lastUnitPick?.id === p.id && season.status === "open") || data.access.manage;
          return (
            <div key={p.id} style={{ padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b>Pick {p.round}</b>
                {p.skipped ? <span style={{ color: INK_SOFT }}>skipped by {p.enteredBy}</span>
                  : <span style={{ fontSize: 12.5, color: INK_SOFT }}>{p.manual ? <span style={{ color: AMBER, fontWeight: 700 }}>entered out of turn{p.waived ? " (size rules set aside)" : ""} · </span> : null}{p.enteredById !== member.userId ? `entered by ${p.enteredBy} · ` : ""}{new Date(p.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
                {canUndo && <button style={{ ...btn("ghost"), padding: "2px 8px", fontSize: 12.5, marginLeft: "auto" }} onClick={() => undo(p)}><Undo2 size={13} /> {data.access.manage && lastUnitPick?.id !== p.id ? "Remove pick" : "Take back"}</button>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {p.days.map(d => {
                  const code = d.codes?.[0]?.code || "";
                  return (
                    <span key={d.day} style={{ fontSize: 12.5, background: CODE_BG[code] || PAPER, color: CODE_INK[code] || INK, borderRadius: 6, padding: "2px 8px", border: d.standing?.bumped ? `2px solid ${BRICK}` : `1px solid ${LINE}` }}>
                      {pretty(d.day)}{unit.ruleset === "comms" ? ` ${d.start}` : ""} · {(d.codes || []).map(c => c.code).join("+")}
                      {d.standing?.bumped && <b style={{ color: BRICK }}> · flagged (#{d.standing.rank} by YOS)</b>}
                      {data.access.manage && <button aria-label={`Rescind ${pretty(d.day)}`} title="Rescind this day" onClick={() => undo(p, d.day)} style={{ border: "none", background: "none", cursor: "pointer", color: BRICK, padding: "0 0 0 4px" }}>×</button>}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
const Row = ({ k, v }) => <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, padding: "2px 0" }}><span style={{ color: INK_SOFT }}>{k}</span><span>{v}</span></div>;

// ---- A unit: turn order --------------------------------------------------------------------------
function UnitPage({ data, unit, reload, say, onPickFor }) {
  const { season } = data;
  const rs = season.rules[unit.ruleset];
  async function skip(m) {
    if (!window.confirm(`Skip ${m.name}'s turn (pick ${unit.turn.round})? They keep their place for the next round.`)) return;
    try { await call(`/${season.id}/skip`, { memberId: m.id }); await reload(); say("Turn skipped."); } catch (e) { say(e.message); }
  }
  return (
    <div>
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 800, flex: 1 }}>{unit.label}</div>
          <span style={{ fontSize: 13, color: INK_SOFT }}>{unit.pool}{rs.caps?.[unit.pool] ? ` · first ${rs.caps[unit.pool]} by years of service each day` : ""}</span>
        </div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>Turn order. Each round goes down the list; people who are done are skipped.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead><tr style={{ textAlign: "left", color: INK_SOFT, fontSize: 12 }}>
              <th style={th}>#</th><th style={th}>Name</th><th style={th}>YOS</th><th style={th}>Left</th><th style={th}>Picks</th><th style={th}>Status</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {unit.members.map((m, i) => {
                const up = unit.turn?.memberId === m.id;
                return (
                  <tr key={m.id} style={{ background: up ? "#E8F5EC" : undefined, borderTop: `1px solid ${LINE}` }}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}><b>{m.name}</b>{m.leader && <Star size={12} color={AMBER} style={{ marginLeft: 4, verticalAlign: -1 }} aria-label="Leader" />}<Locked m={m} /><div style={{ fontSize: 12, color: INK_SOFT }}>{m.rank || m.title}</div></td>
                    <td style={td}>{m.yos ?? ""}</td>
                    <td style={td}>{m.remaining !== undefined ? shiftsOf(m.remaining, rs.shiftHours) : ""}</td>
                    <td style={td}>{m.picks.filter(p => !p.skipped).length}{m.picks.some(p => p.skipped) ? ` (+${m.picks.filter(p => p.skipped).length} skipped)` : ""}</td>
                    <td style={td}>{up ? <b style={{ color: SAGE }}>Up now · pick {unit.turn.round}</b> : m.done || m.autoDone ? <span style={{ color: INK_SOFT }}>Done</span> : season.status === "open" ? "Waiting" : ""}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      {m.canAct && m.id !== data.me?.memberId && <button style={{ ...btn("outline"), padding: "3px 9px", fontSize: 12.5 }} onClick={() => onPickFor(m.id)}>{up ? "Pick for" : "Enter picks"}</button>}
                      {up && m.canAct && m.id !== data.me?.memberId && <button style={{ ...btn("ghost"), padding: "3px 8px", fontSize: 12.5 }} onClick={() => skip(m)}><SkipForward size={13} /> Skip</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Legend unit={unit} rules={season.rules} />
      <YearCalendar year={season.year} unit={unit} rules={season.rules} focusId={null} pools={data.pools} compact />
    </div>
  );
}
// Someone on the roster who can't sign in to Nexus yet: a leader or coordinator enters their picks
function Locked({ m }) {
  if (!m.locked) return null;
  return <span title={m.userId ? "Hasn't set up their " + PN + " sign-in yet. Their leader or a coordinator enters picks for them." : "No " + PN + " account yet. Their leader or a coordinator enters picks for them; it unlocks when their account is approved."}
    style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: AMBER, background: "#FFF4E0", border: `1px solid #F0D9A8`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>
    <Lock size={10} style={{ verticalAlign: -1, marginRight: 3 }} />{m.userId ? "Not signed up yet" : "No " + PN + " account yet"}</span>;
}
const th = { padding: "6px 8px", fontWeight: 700 }, td = { padding: "7px 8px", verticalAlign: "top" };

// ---- Every unit ------------------------------------------------------------------------------------
function UnitsPage({ data, onOpen }) {
  const [rs, setRs] = useState("");
  const [shift, setShift] = useState("");
  const units = data.units.filter(u => (!rs || u.ruleset === rs) && (!shift || u.shift === shift));
  const groups = new Map();
  for (const u of units) { const k = u.ruleset === "comms" ? "Communications" : `${u.shift} Shift`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); }
  const flagged = Object.entries(data.pools).flatMap(([k, days]) => Object.entries(days).flatMap(([day, list]) => list.filter(e => e.bumped).map(e => ({ ...e, day, key: k }))));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select aria-label="Division" style={{ ...inputStyle, width: "auto" }} value={rs} onChange={e => setRs(e.target.value)}><option value="">Suppression and Communications</option><option value="fire">Suppression</option><option value="comms">Communications</option></select>
        <select aria-label="Shift" style={{ ...inputStyle, width: "auto" }} value={shift} onChange={e => setShift(e.target.value)}><option value="">All shifts / crews</option>{["A", "B", "C", "D"].map(s => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      {flagged.length > 0 && (
        <div style={{ ...cardStyle, borderLeft: `5px solid ${BRICK}` }}>
          <b style={{ color: BRICK }}><AlertTriangle size={15} style={{ verticalAlign: -2 }} /> {flagged.length} pick day{flagged.length === 1 ? "" : "s"} over the daily limit</b>
          <div style={{ fontSize: 13, color: INK_SOFT, margin: "2px 0 6px" }}>Only the most senior (years of service) are offered those days. See Reports for the full list.</div>
        </div>
      )}
      {!units.length && <div style={cardStyle}>No units yet. Set up the roster under Setup.</div>}
      {[...groups].map(([g, list]) => (
        <div key={g} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK, margin: "4px 0 8px" }}>{g}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {list.map(u => {
              const up = u.turn ? u.members.find(m => m.id === u.turn.memberId) : null;
              const done = u.members.filter(m => m.done || m.autoDone).length;
              return (
                <button key={u.id} type="button" onClick={() => onOpen(u.id)} aria-label={`Open ${u.label}`}
                  style={{ ...cardStyle, marginBottom: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${LINE}`, borderTop: `4px solid ${u.complete ? SAGE : up ? AMBER : LINE}` }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: INK }}>{u.label}</div>
                  <div style={{ fontSize: 12.5, color: INK_SOFT }}>{u.pool} · {u.members.length} {u.members.length === 1 ? "person" : "people"}</div>
                  <div style={{ fontSize: 13, marginTop: 6 }}>{u.complete ? <span style={{ color: SAGE, fontWeight: 700 }}>All done</span> : up ? <>Up: <b>{up.name}</b> (pick {u.turn.round})</> : data.season.status === "open" ? "Waiting" : "Not open"}</div>
                  <div style={{ height: 6, background: PAPER, borderRadius: 3, marginTop: 8, overflow: "hidden" }}><div style={{ width: `${u.members.length ? (done / u.members.length) * 100 : 0}%`, height: "100%", background: SAGE }} /></div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Reports --------------------------------------------------------------------------------------
function Reports({ data }) {
  const officerOnly = !data.access.view && !data.access.manage;
  const [rs, setRs] = useState(officerOnly ? "fire" : "");
  const [shift, setShift] = useState(officerOnly && data.access.officer.length === 1 ? data.access.officer[0] : "");
  const [who, setWho] = useState("");
  const inScope = data.units.filter(u => (!rs || u.ruleset === rs) && (!shift || u.shift === shift));
  const people = inScope.flatMap(u => u.members.map(m => ({ ...m, unitLabel: u.label, unit: u }))).sort((a, b) => a.name.localeCompare(b.name));
  const person = people.find(m => m.id === who);
  const q = new URLSearchParams({ ...(rs ? { ruleset: rs } : {}), ...(shift ? { shift } : {}), ...(person ? { member: person.id } : {}) }).toString();
  const base = `/api/leave/${data.season.id}/report`;
  const flagged = Object.entries(data.pools).flatMap(([k, days]) => Object.entries(days).flatMap(([day, list]) => list.filter(e => e.bumped).map(e => ({ ...e, day, shift: k.split("|")[2], pool: k.split("|")[1] }))))
    .filter(e => (!shift || e.shift === shift) && (!rs || rs === "fire") && (!person || e.memberId === person.id)).sort((a, b) => a.day.localeCompare(b.day));
  const totals = m => { const t = {}; for (const p of m.picks) for (const d of p.days) for (const c of (d.codes || [])) t[c.code] = (t[c.code] || 0) + c.hours; return t; };
  const listed = person ? [person] : people;
  const doneCount = listed.filter(m => m.done || m.autoDone).length;
  const dl = (href, title, desc, Icon = Download) => (
    <a href={href} download style={{ ...cardStyle, marginBottom: 0, display: "flex", gap: 12, alignItems: "flex-start", textDecoration: "none", color: INK }}>
      <Icon size={22} color={BLUE} style={{ flexShrink: 0, marginTop: 2 }} />
      <span><b style={{ fontSize: 15 }}>{title}</b><div style={{ fontSize: 13, color: INK_SOFT }}>{desc}</div></span>
    </a>
  );
  const shifts = officerOnly ? data.access.officer : ["A", "B", "C", "D"];
  return (
    <div>
      {officerOnly && <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>You're a shift officer for {data.access.officer.map(x => `${x} Shift`).join(" and ")}, so you see {data.access.officer.length === 1 ? "its" : "their"} reports.</div>}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {!officerOnly && <select aria-label="Report division" style={{ ...inputStyle, width: "auto" }} value={rs} onChange={e => { setRs(e.target.value); setWho(""); }}><option value="">Everyone</option><option value="fire">Suppression</option><option value="comms">Communications</option></select>}
        <select aria-label="Report shift" style={{ ...inputStyle, width: "auto" }} value={shift} onChange={e => { setShift(e.target.value); setWho(""); }}>
          {(!officerOnly || shifts.length > 1) && <option value="">{officerOnly ? "My shifts" : "All shifts / crews"}</option>}
          {shifts.map(s => <option key={s} value={s}>{rs === "comms" ? `Crew ${s}` : rs === "fire" || officerOnly ? `${s} Shift` : s}</option>)}
        </select>
        <select aria-label="Report person" style={{ ...inputStyle, width: "auto", maxWidth: 280 }} value={who} onChange={e => setWho(e.target.value)}>
          <option value="">Everyone in this selection</option>
          {people.map(m => <option key={m.id} value={m.id}>{m.name} · {m.unitLabel}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 14 }}>
        {dl(`${base}/aladtec.csv${q ? `?${q}` : ""}`, "List for Aladtec (CSV)", "One line per shift off: name, emp #, date, start time, hours and leave code (OH/OV/OC), with flagged days marked. Opens in Excel.")}
        {dl(`${base}/forms.xlsx${q ? `?${q}` : ""}`, person ? `${person.name}'s Annual Leave Request Form (Excel)` : "Annual Leave Request Forms (Excel)", "One filled-in form per person, in the same layout as the paper form, ready to print and sign.")}
        {dl(`${base}/master.xlsx${q ? `?${q}` : ""}`, "Department leave spreadsheet (Excel)", "One sheet per shift or crew: everyone by unit, a column for every day, hours off, and the number off per day.")}
      </div>
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 }}>
          <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>{person ? person.name : "Leave picked"}</div>
          <span style={{ fontSize: 13, color: INK_SOFT }}>{doneCount} of {listed.length} done</span>
        </div>
        {!listed.length ? <div style={{ color: INK_SOFT, fontSize: 13.5 }}>Nobody in this selection.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Leave picked" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead><tr style={{ textAlign: "left", color: INK_SOFT, fontSize: 12 }}><th style={th}>Name</th><th style={th}>Unit</th><th style={th}>Holiday</th><th style={th}>Vacation</th><th style={th}>Banked/comp</th><th style={th}>Left</th><th style={th}>Status</th></tr></thead>
              <tbody>{listed.map(m => {
                const t = totals(m), h = v => (v ? `${Math.round(v * 100) / 100} h` : "");
                return (
                  <tr key={m.id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={td}><b>{m.name}</b><Locked m={m} /></td><td style={td}>{m.unitLabel}</td>
                    <td style={td}>{h(t.OH)}</td><td style={td}>{h(t.OV)}</td><td style={td}>{h(t.OC)}{t["??"] ? <span style={{ color: BRICK }}> +{h(t["??"])} over</span> : null}</td>
                    <td style={td}>{m.remaining !== undefined ? h(m.remaining) || "0 h" : ""}</td>
                    <td style={td}>{m.done || m.autoDone ? <span style={{ color: SAGE, fontWeight: 700 }}>Done</span> : m.picks.length ? "Picking" : "Not started"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {person && person.picks.some(p => p.days.length) && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {person.picks.flatMap(p => p.days).sort((a, b) => a.day.localeCompare(b.day)).map(d => (
              <span key={d.day} style={{ fontSize: 12.5, padding: "3px 8px", borderRadius: 6, background: CODE_BG[(d.codes || [])[0]?.code] || PAPER, color: CODE_INK[(d.codes || [])[0]?.code] || INK }}>
                {pretty(d.day)} · {(d.codes || []).map(c => c.code).join("/") || `${d.hours} h`}{d.standing?.bumped ? " (flagged)" : ""}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Over the daily limit</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>Days where more people picked than are offered. Only the first ones by years of service keep the day.</div>
        {!flagged.length ? <div style={{ color: SAGE, fontSize: 13.5 }}>None.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead><tr style={{ textAlign: "left", color: INK_SOFT, fontSize: 12 }}><th style={th}>Date</th><th style={th}>Shift</th><th style={th}>Name</th><th style={th}>Unit</th><th style={th}>YOS</th><th style={th}>Standing</th></tr></thead>
            <tbody>{flagged.map((e, i) => <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}><td style={td}>{pretty(e.day)}</td><td style={td}>{e.shift}</td><td style={td}><b>{e.name}</b></td><td style={td}>{e.unit}</td><td style={td}>{e.yos}</td><td style={{ ...td, color: BRICK }}>#{e.rank}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---- Setup (manage) -------------------------------------------------------------------------------
function Setup({ list, sid, data, setSid, reloadList, reload, say }) {
  const [year, setYear] = useState(String(new Date().getFullYear() + 1));
  const season = data?.season;
  async function create() {
    try { const r = await call("/seasons", { year: Number(year) }); await reloadList(); setSid(r.id); say(`${year} created.`); } catch (e) { say(e.message); }
  }
  async function setStatus(status) {
    const msg = { open: `Open picking for ${season.year}? Whoever is first in each unit gets a message that it's their turn.`, closed: "Close picking? Nobody can pick after this (managers can still change picks).", setup: "Put this year back into setup? Nobody can pick until it's opened again." }[status];
    if (!window.confirm(msg)) return;
    try { await call(`/${sid}/settings`, { status }); await reload(); await reloadList(); say(status === "open" ? "Picking is open." : status === "closed" ? "Picking closed." : "Back in setup."); } catch (e) { say(e.message); }
  }
  async function remove() {
    if (!window.confirm(`Delete the ${season.year} pick year and its roster?`)) return;
    try { await call(`/${sid}/remove`, {}); setSid(null); await reloadList(); say("Deleted."); } catch (e) { say(e.message); }
  }
  return (
    <div>
      <div style={cardStyle}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Pick years</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {list.seasons.map(s => <button key={s.id} style={{ ...btn(s.id === sid ? "primary" : "outline"), padding: "5px 12px" }} onClick={() => setSid(s.id)}>{s.year} · {s.status === "setup" ? "setting up" : s.status}</button>)}
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 13 }}><span style={label}>New year</span><input aria-label="New year" style={{ ...inputStyle, width: 100 }} value={year} onChange={e => setYear(e.target.value)} /></label>
          <button style={btn("primary")} onClick={create}><Plus size={14} /> Create</button>
        </div>
        {season && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            <b>{season.year}:</b>
            <span style={{ color: INK_SOFT, fontSize: 13.5 }}>{season.status === "open" ? "Picking is open." : season.status === "closed" ? "Closed." : "Setting up (only managers see it)."}</span>
            <span style={{ flex: 1 }} />
            {season.status !== "open" && <button style={btn("primary")} onClick={() => setStatus("open")}>Open picking</button>}
            {season.status === "open" && <button style={btn("outline")} onClick={() => setStatus("closed")}>Close picking</button>}
            {season.status !== "setup" && <button style={btn("ghost")} onClick={() => setStatus("setup")}>Back to setup</button>}
            {season.status === "setup" && <button style={{ ...btn("ghost"), color: BRICK }} onClick={remove}><Trash2 size={13} /> Delete year</button>}
          </div>
        )}
      </div>
      {season && <RulesEditor key={`r${sid}`} data={data} reload={reload} say={say} />}
      {season && <ShiftOfficers key={`s${sid}`} data={data} reload={reload} say={say} />}
      {season && <RosterImport key={`i${sid}`} sid={sid} data={data} reload={reload} say={say} />}
      {season && <Roster key={`o${sid}`} data={data} reload={reload} say={say} />}
    </div>
  );
}

function RulesEditor({ data, reload, say }) {
  const [r, setR] = useState(() => JSON.parse(JSON.stringify(data.season.rules)));
  const [dirty, setDirty] = useState(false);
  const set = (k, f, v) => { setR(x => ({ ...x, [k]: { ...x[k], [f]: v } })); setDirty(true); };
  async function save() {
    // Shift officers are saved on their own card
    const { officers, ...fire } = r.fire;
    try { await call(`/${data.season.id}/settings`, { rules: { fire, comms: r.comms } }); setDirty(false); await reload(); say("Rules saved."); } catch (e) { say(e.message); }
  }
  const pools = k => [...new Set([...data.units.filter(u => u.ruleset === k).map(u => u.pool), ...Object.keys(r[k].caps || {})])].filter(Boolean);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Rules</div>
        <button style={btn("primary")} disabled={!dirty} onClick={save}>Save rules</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        {["fire", "comms"].map(k => {
          const x = r[k];
          const n = (f, lbl, w = 70) => <label style={{ fontSize: 13 }}><span style={label}>{lbl}</span><input aria-label={`${x.label}: ${lbl}`} type="number" style={{ ...inputStyle, width: w }} value={x[f]} onChange={e => set(k, f, e.target.value)} /></label>;
          const cb = (f, lbl) => <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}><input type="checkbox" checked={!!x[f]} onChange={e => set(k, f, e.target.checked)} /> {lbl}</label>;
          return (
            <fieldset key={k} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, margin: 0 }}>
              <legend style={{ fontWeight: 800, padding: "0 6px" }}>{k === "fire" ? "Suppression, Special Ops, EMS" : "Communications"}</legend>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {n("shiftHours", "Hours per shift")}{n("firstPicks", "First picks")}{n("firstMax", "Shifts per first pick")}{n("laterMax", "Shifts per later pick")}
              </div>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {cb("firstConsecutive", "First picks must be shifts in a row")}
                {cb("laterConsecutive", "Later picks must be shifts in a row")}
                {cb("holidaysAll", "All holidays must be scheduled before someone is done")}
              </div>
              <div style={{ marginTop: 10 }}>
                <span style={label}>Most people off per shift-day (by years of service)</span>
                {pools(k).map(p => (
                  <label key={p} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, marginRight: 12 }}>{p}
                    <input aria-label={`Daily limit ${p}`} type="number" placeholder="none" style={{ ...inputStyle, width: 70 }} value={x.caps?.[p] ?? ""} onChange={e => set(k, "caps", { ...x.caps, [p]: e.target.value === "" ? undefined : e.target.value })} />
                  </label>
                ))}
                {!pools(k).length && <span style={{ fontSize: 12.5, color: INK_SOFT }}>Import the roster first.</span>}
              </div>
              <div style={{ marginTop: 10 }}>
                <span style={label}>Blocked dates (no leave)</span>
                {(x.blocked || []).map((b, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                    <input aria-label="Blocked from" type="date" style={{ ...inputStyle, width: 150 }} value={b.from} onChange={e => set(k, "blocked", x.blocked.map((y, j) => j === i ? { ...y, from: e.target.value } : y))} />
                    <span>to</span>
                    <input aria-label="Blocked to" type="date" style={{ ...inputStyle, width: 150 }} value={b.to} onChange={e => set(k, "blocked", x.blocked.map((y, j) => j === i ? { ...y, to: e.target.value } : y))} />
                    <input aria-label="Reason" placeholder="Reason (e.g. APCO Conference)" style={{ ...inputStyle, flex: 1, minWidth: 140 }} value={b.label} onChange={e => set(k, "blocked", x.blocked.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} />
                    <button aria-label="Remove blocked dates" style={{ ...btn("ghost"), color: BRICK, padding: "4px 8px" }} onClick={() => set(k, "blocked", x.blocked.filter((_, j) => j !== i))}><X size={14} /></button>
                  </div>
                ))}
                <button style={{ ...btn("outline"), padding: "4px 10px", fontSize: 12.5 }} onClick={() => set(k, "blocked", [...(x.blocked || []), { from: `${data.season.year}-01-01`, to: `${data.season.year}-01-01`, label: "" }])}><Plus size={13} /> Add blocked dates</button>
              </div>
              <label style={{ display: "block", marginTop: 10 }}><span style={label}>Note shown to people picking (deadlines, reminders)</span>
                <textarea aria-label={`${x.label} note`} style={{ ...inputStyle, minHeight: 56 }} value={x.note || ""} onChange={e => set(k, "note", e.target.value)} /></label>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}

// Shift / crew choices on an imported row: Suppression A-C or a Communications crew
const SHIFT_CHOICES = [["fire", "A", "A Shift"], ["fire", "B", "B Shift"], ["fire", "C", "C Shift"], ["comms", "A", "Comms A"], ["comms", "B", "Comms B"], ["comms", "C", "Comms C"], ["comms", "D", "Comms D"]];
const importable = r => r.shift && (r.ruleset === "comms" || String(r.unit || "").trim());

function RosterImport({ sid, data, reload, say }) {
  const [prev, setPrev] = useState(null);
  const [sheet, setSheet] = useState(0);
  const [rows, setRows] = useState([]);
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const file = useRef(null);
  async function choose(f) {
    if (!f) return;
    setBusy(true);
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(f); });
      const p = await call(`/${sid}/import/preview`, { filename: f.name, data });
      // Start on the sheet with the most people that have a unit
      const best = p.parsed.map((s, i) => [i, s.rows.filter(r => r.unit || r.ruleset === "comms").length - s.rows.filter(r => r.problems.length).length]).sort((a, b) => b[1] - a[1])[0][0];
      setPrev(p); setSheet(best); setRows(p.parsed[best].rows); setMissing(p.missing || []);
    } catch (e) { say(e.message); }
    setBusy(false);
    if (file.current) file.current.value = "";
  }
  const ok = rows.filter(importable);
  async function apply() {
    const locked = ok.filter(r => !r.userId).length;
    if (!window.confirm(`Import ${ok.length} people?` + (locked ? ` ${locked} without a ${PN} account will be added locked: their leader or a coordinator enters their picks until their account is approved.` : "") +
      (rows.length - ok.length ? ` ${rows.length - ok.length} without a shift or unit will be left out.` : ""))) return;
    setBusy(true);
    try {
      const r = await call(`/${sid}/import/apply`, { rows: ok });
      setPrev(null); await reload();
      say(`Imported ${r.imported} people: ${r.added} added, ${r.updated} updated${r.locked ? `, ${r.locked} without an account yet` : ""}.`);
    } catch (e) { say(e.message); }
    setBusy(false);
  }
  async function dropMissing(m) {
    if (!window.confirm(`Take ${m.name} out of the ${data.season.year} pick? They're not in this spreadsheet.`)) return;
    try { await call(`/${sid}/member`, { memberId: m.id, remove: true }); setMissing(x => x.filter(y => y.id !== m.id)); await reload(); say("Removed."); } catch (e) { say(e.message); }
  }
  const upd = (i, f, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...(typeof f === "object" ? f : { [f]: v }) } : r));
  const setShift = (i, v) => {
    const [ruleset, shift] = v.split(":");
    const r = rows[i];
    upd(i, { ruleset: ruleset || r.ruleset, shift: shift || "", pool: ruleset === "comms" ? "Communications" : r.ruleset === "comms" ? "Suppression" : r.pool });
  };
  const shown = rows.map((r, i) => [r, i]).filter(([r]) => !filter || (filter === "new" ? r.status === "new" : filter === "update" ? r.status === "update" : filter === "locked" ? !r.userId : !importable(r)));
  const S = { ...inputStyle, padding: "3px 6px", fontSize: 12.5 };
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Import the roster</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>Upload the department leave spreadsheet (.xlsx), e.g. last year's A Shift sheet with Position, Employee, Shift, YOS, OV Accrual and Holidays, or a CSV with those columns. You can fix anyone's shift, crew or unit before importing. People without a {PN} account are added locked until their account is approved. Uploading a newer roster later updates the people already here.</div>
        </div>
        <input ref={file} type="file" accept=".xlsx,.csv" aria-label="Roster file" style={{ display: "none" }} onChange={e => choose(e.target.files[0])} />
        <button style={btn("primary")} disabled={busy} onClick={() => file.current?.click()}><Upload size={14} /> {busy ? "Reading…" : "Choose file"}</button>
      </div>
      {prev && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            {prev.parsed.length > 1 && (
              <label style={{ fontSize: 13 }}><span style={label}>Sheet</span>
                <select aria-label="Sheet" style={{ ...inputStyle, width: "auto" }} value={sheet} onChange={e => { const i = Number(e.target.value); setSheet(i); setRows(prev.parsed[i].rows); }}>
                  {prev.parsed.map((s, i) => <option key={i} value={i}>{s.sheet}: {s.rows.length} people</option>)}
                </select>
              </label>
            )}
            <label style={{ fontSize: 13 }}><span style={label}>Show</span>
              <select aria-label="Show rows" style={{ ...inputStyle, width: "auto" }} value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="">Everyone ({rows.length})</option>
                <option value="new">New this import ({rows.filter(r => r.status === "new").length})</option>
                <option value="update">Already here, will update ({rows.filter(r => r.status === "update").length})</option>
                <option value="locked">No {PN} account yet ({rows.filter(r => !r.userId).length})</option>
                <option value="fix">Needs a shift or unit ({rows.filter(r => !importable(r)).length})</option>
              </select>
            </label>
          </div>
          <div style={{ fontSize: 13, color: INK_SOFT, margin: "8px 0" }}>
            {rows.filter(r => r.userId).length} of {rows.length} matched to {PN} accounts; the rest are added locked (<Lock size={11} style={{ verticalAlign: -1 }} />) and unlock when their account is approved.
            {prev.parsed[sheet].skipped.length > 0 && ` Skipped ${prev.parsed[sheet].skipped.length} not in Suppression or Communications (e.g. ADM).`}
          </div>
          <div style={{ maxHeight: 460, overflow: "auto", border: `1px solid ${LINE}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead style={{ position: "sticky", top: 0, background: PAPER, zIndex: 1 }}><tr style={{ textAlign: "left" }}>
                <th style={th}>In spreadsheet</th><th style={th}>{PN} account</th><th style={th}>Shift / crew</th><th style={th}>Unit</th><th style={th}>YOS</th><th style={th}>Vacation h</th><th style={th}>Holiday h</th><th style={th}></th>
              </tr></thead>
              <tbody>{shown.map(([r, i]) => (
                <tr key={i} style={{ borderTop: `1px solid ${LINE}`, background: !importable(r) ? "#FFF6F6" : !r.userId ? "#FFFBF2" : undefined }}>
                  <td style={td}>{r.displayName || r.name}<div style={{ fontSize: 11, fontWeight: 700, color: r.status === "update" ? BLUE : SAGE }}>{r.status === "update" ? "Already here: updates" : "New"}</div></td>
                  <td style={td}>
                    <select aria-label={`Account for ${r.name}`} style={S} value={r.userId || ""} onChange={e => upd(i, "userId", e.target.value || null)}>
                      <option value="">🔒 No account yet (add locked)</option>
                      {prev.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td style={td}>
                    <select aria-label={`Shift for ${r.name}`} style={{ ...S, width: 100 }} value={r.shift ? `${r.ruleset}:${r.shift}` : ""} onChange={e => setShift(i, e.target.value)}>
                      <option value="">Shift?</option>
                      {SHIFT_CHOICES.map(([rs, sh, l]) => <option key={`${rs}:${sh}`} value={`${rs}:${sh}`}>{l}</option>)}
                    </select>
                  </td>
                  <td style={td}>{r.ruleset === "comms" ? <span style={{ color: INK_SOFT }}>Crew</span> : <input aria-label={`Unit for ${r.name}`} placeholder="Unit" style={{ ...S, width: 80 }} value={r.unit || ""} onChange={e => upd(i, "unit", e.target.value)} />}<div style={{ fontSize: 11, color: INK_SOFT }}>{r.pool}</div></td>
                  <td style={td}><input aria-label={`YOS for ${r.name}`} type="number" style={{ ...S, width: 56 }} value={r.yos ?? ""} onChange={e => upd(i, "yos", e.target.value === "" ? null : Number(e.target.value))} /></td>
                  <td style={td}><input aria-label={`Vacation hours for ${r.name}`} type="number" style={{ ...S, width: 70 }} value={r.vacation} onChange={e => upd(i, "vacation", Number(e.target.value))} /></td>
                  <td style={td}><input aria-label={`Holiday hours for ${r.name}`} type="number" style={{ ...S, width: 70 }} value={r.holiday} onChange={e => upd(i, "holiday", Number(e.target.value))} /></td>
                  <td style={{ ...td, color: AMBER, fontSize: 11.5 }}>{!importable(r) ? "Choose a shift and unit" : r.problems.filter(x => x !== "crew" && x !== "unit").length ? `Check: ${r.problems.filter(x => x !== "crew" && x !== "unit").join(", ")}` : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <div style={{ marginTop: 12, border: `1px solid #F0D9A8`, background: "#FFFBF2", borderRadius: 8, padding: 10 }}>
              <b style={{ fontSize: 13.5 }}>{missing.length} on this year's roster but not in this spreadsheet</b>
              <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 6 }}>They stay unless you take them out (someone who already picked has to have their picks taken back first).</div>
              {missing.map(m => (
                <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "3px 0" }}>
                  <span style={{ flex: 1 }}><b>{m.name}</b> <span style={{ color: INK_SOFT }}>· {m.ruleset === "comms" ? `Comms ${m.shift}` : `${m.unit} · ${m.shift} Shift`}{m.picked ? " · has picks" : ""}</span></span>
                  <button style={{ ...btn("ghost"), color: BRICK, padding: "2px 8px", fontSize: 12.5 }} aria-label={`Take ${m.name} out`} onClick={() => dropMissing(m)}><Trash2 size={12} /> Take out</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btn("primary")} disabled={busy || !ok.length} onClick={apply}>Import {ok.length} people</button>
            <button style={btn("ghost")} onClick={() => setPrev(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Each Suppression shift's Assistant Chief and Battalion Chiefs: messaged as units (and the whole shift) finish, and see the shift's reports
function ShiftOfficers({ data, reload, say }) {
  const [o, setO] = useState(() => JSON.parse(JSON.stringify(data.season.rules.fire.officers || { A: [], B: [], C: [] })));
  const [dirty, setDirty] = useState(false);
  const people = data.people || [];
  const name = id => people.find(p => p.id === id)?.name || "(no longer active)";
  async function save() {
    try { await call(`/${data.season.id}/settings`, { rules: { fire: { officers: o } } }); setDirty(false); await reload(); say("Shift officers saved."); } catch (e) { say(e.message); }
  }
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Shift officers (Suppression)</div>
        <button style={btn("primary")} disabled={!dirty} onClick={save}>Save officers</button>
      </div>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>Each shift's Assistant Chief and Battalion Chiefs get a message as each unit finishes its picks and when the whole shift is done, and can see their shift's units and reports.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {["A", "B", "C"].map(x => (
          <div key={x} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
            <b>{x} Shift</b>
            {(o[x] || []).map(id => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, padding: "3px 0" }}>
                <span style={{ flex: 1 }}>{name(id)}</span>
                <button aria-label={`Remove ${name(id)} from ${x} Shift officers`} style={{ ...btn("ghost"), color: BRICK, padding: "2px 6px" }} onClick={() => { setO(v => ({ ...v, [x]: v[x].filter(y => y !== id) })); setDirty(true); }}><X size={13} /></button>
              </div>
            ))}
            <select aria-label={`Add ${x} Shift officer`} style={{ ...inputStyle, marginTop: 6 }} value="" onChange={e => { const id = e.target.value; if (id) { setO(v => ({ ...v, [x]: [...(v[x] || []), id] })); setDirty(true); } }}>
              <option value="">Add an officer…</option>
              {people.filter(p => !(o[x] || []).includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

const BLANK = { userId: null, name: "", unit: { ruleset: "fire", shift: "A", name: "", pool: "Suppression" }, rank: "", empNo: "", hireDate: "", seniorityDate: "", yos: "", holiday: 0, vacation: 0, banked: 0, note: "" };
function Roster({ data, reload, say }) {
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState("");
  const people = data.people || [];
  const sid = data.season.id;
  async function move(unit, i, dir) {
    const ids = unit.members.map(m => m.id);
    const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await call(`/${sid}/order`, { unitId: unit.id, memberIds: ids, leaders: unit.members.filter(m => m.leader).map(m => m.id) }); await reload(); } catch (e) { say(e.message); }
  }
  async function leader(unit, m) {
    const leaders = unit.members.filter(x => x.leader).map(x => x.id);
    const next = m.leader ? leaders.filter(x => x !== m.id) : [...leaders, m.id];
    try { await call(`/${sid}/order`, { unitId: unit.id, memberIds: unit.members.map(x => x.id), leaders: next }); await reload(); } catch (e) { say(e.message); }
  }
  async function save() {
    try { await call(`/${sid}/member`, edit); setEdit(null); await reload(); say("Saved."); } catch (e) { say(e.message); }
  }
  async function remove(m) {
    if (!window.confirm(`Take ${m.name} out of the ${data.season.year} pick?`)) return;
    try { await call(`/${sid}/member`, { memberId: m.id, remove: true }); await reload(); say("Removed."); } catch (e) { say(e.message); }
  }
  const open = (m, u) => setEdit({ memberId: m.id, userId: m.userId || null, name: m.locked && !m.userId ? m.name : m.rosterName || m.name, title: m.name, unit: { ruleset: u.ruleset, shift: u.shift, name: u.name, pool: u.pool }, rank: m.rank || "", empNo: m.empNo || "",
    hireDate: m.hireDate || "", seniorityDate: m.seniorityDate || "", yos: m.yos ?? "", holiday: m.holiday ?? 0, vacation: m.vacation ?? 0, banked: m.banked ?? 0, note: m.note || "" });
  const onRoster = new Set(data.units.flatMap(u => u.members.map(m => m.userId)).filter(Boolean));
  const lockedCount = data.units.reduce((n, u) => n + u.members.filter(m => m.locked).length, 0);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, flex: 1 }}>Units and turn order</div>
        <select aria-label="Add someone" style={{ ...inputStyle, width: "auto" }} value={adding} onChange={e => setAdding(e.target.value)}>
          <option value="">Add someone…</option>
          <option value="none">🔒 Someone without a {PN} account yet</option>
          {people.filter(p => !onRoster.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button style={btn("outline")} disabled={!adding} onClick={() => { const p = people.find(x => x.id === adding); setEdit({ ...BLANK, userId: p?.id || null, name: p?.name || "", title: p?.name || "New person" }); setAdding(""); }}><Plus size={14} /> Add</button>
      </div>
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 10 }}>Order is the turn order inside each unit (Suppression: rank, then seniority; Communications: seniority). ★ = leader, who can pick, skip or enter picks for the unit. Communications crews have no leader unless you star one; give your coordinator Leave picks: Edit for Communications instead.
        {lockedCount > 0 && <> <b style={{ color: AMBER }}>{lockedCount} locked</b> (<Lock size={11} style={{ verticalAlign: -1 }} /> no {PN} sign-in yet): when it's their turn, their leader (or a coordinator) is messaged to enter it. They unlock on their own when their account is approved, or link them under Edit.</>}
      </div>
      {!data.units.length && <div style={{ color: INK_SOFT, fontSize: 13.5 }}>Nobody yet. Import the roster above.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
        {data.units.map(u => (
          <div key={u.id} style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 800 }}>{u.label} <span style={{ fontWeight: 400, color: INK_SOFT, fontSize: 12.5 }}>· {u.pool}</span></div>
            {u.members.map((m, i) => (
              <div key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 0", borderTop: i ? `1px solid ${LINE}` : "none", fontSize: 13 }}>
                <span style={{ width: 18, color: INK_SOFT }}>{i + 1}</span>
                <button aria-label={`${m.leader ? "Remove leader" : "Make leader"}: ${m.name}`} title="Leader" onClick={() => leader(u, m)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0 }}><Star size={14} color={m.leader ? AMBER : "#C5CBD6"} fill={m.leader ? AMBER : "none"} /></button>
                <span style={{ flex: 1, minWidth: 0 }}><b>{m.name}</b>{m.locked && <Lock size={11} color={AMBER} style={{ marginLeft: 4, verticalAlign: -1 }} aria-label={"No " + PN + " sign-in yet"} />} <span style={{ color: INK_SOFT, fontSize: 12 }}>{m.yos ?? "?"} yrs · {m.holiday ?? 0}/{m.vacation ?? 0} h</span></span>
                <button aria-label={`Move ${m.name} up`} style={{ ...btn("ghost"), padding: 2 }} onClick={() => move(u, i, -1)}><ChevronUp size={14} /></button>
                <button aria-label={`Move ${m.name} down`} style={{ ...btn("ghost"), padding: 2 }} onClick={() => move(u, i, 1)}><ChevronDown size={14} /></button>
                <button aria-label={`Edit ${m.name}`} style={{ ...btn("ghost"), padding: "2px 6px", fontSize: 12 }} onClick={() => open(m, u)}>Edit</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {edit && (
        <div role="dialog" aria-label={`Edit ${edit.title || edit.name}`} style={{ position: "fixed", inset: 0, background: "rgba(19,35,63,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div style={{ ...cardStyle, width: "min(620px, 100%)", maxHeight: "90vh", overflowY: "auto", marginBottom: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 10 }}>{edit.title || edit.name || "New person"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              <label style={{ gridColumn: "1 / -1" }}><span style={label}><Link2 size={12} style={{ verticalAlign: -1 }} /> {PN} account</span>
                <select aria-label={PN + " account"} style={inputStyle} value={edit.userId || ""} onChange={e => { const p = people.find(x => x.id === e.target.value); setEdit(x => ({ ...x, userId: p?.id || null, name: p ? p.name : x.name })); }}>
                  <option value="">🔒 No {PN} account yet (locked: a leader or coordinator enters their picks)</option>
                  {people.filter(p => p.id === edit.userId || !onRoster.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}{p.emp ? ` · #${p.emp}` : ""}</option>)}
                </select>
              </label>
              {!edit.userId && <label style={{ gridColumn: "1 / -1" }}><span style={label}>Name (as on the roster)</span><input aria-label="Name" style={inputStyle} value={edit.name} placeholder="First Last" onChange={e => setEdit(x => ({ ...x, name: e.target.value }))} /></label>}
              <label><span style={label}>Shift / crew</span>
                <select aria-label="Shift" style={inputStyle} value={`${edit.unit.ruleset}:${edit.unit.shift}`} onChange={e => { const [rs, sh] = e.target.value.split(":"); setEdit(x => ({ ...x, unit: { ...x.unit, ruleset: rs, shift: sh, pool: rs === "comms" ? "Communications" : x.unit.ruleset === "comms" ? "Suppression" : x.unit.pool } })); }}>
                  {SHIFT_CHOICES.map(([rs, sh, l]) => <option key={`${rs}:${sh}`} value={`${rs}:${sh}`}>{l}</option>)}
                </select></label>
              {edit.unit.ruleset === "fire" && <label><span style={label}>Unit</span><input aria-label="Unit" style={inputStyle} value={edit.unit.name} placeholder="613 or Chiefs" onChange={e => setEdit(x => ({ ...x, unit: { ...x.unit, name: e.target.value } }))} /></label>}
              {edit.unit.ruleset === "fire" && <label><span style={label}>Daily-limit group</span><input aria-label="Daily-limit group" style={inputStyle} value={edit.unit.pool} onChange={e => setEdit(x => ({ ...x, unit: { ...x.unit, pool: e.target.value } }))} /></label>}
              <label><span style={label}>Rank / title</span><input aria-label="Rank" style={inputStyle} value={edit.rank} onChange={e => setEdit(x => ({ ...x, rank: e.target.value }))} /></label>
              <label><span style={label}>Emp #</span><input aria-label="Emp #" style={inputStyle} value={edit.empNo} onChange={e => setEdit(x => ({ ...x, empNo: e.target.value }))} /></label>
              <label><span style={label}>Hire date</span><input aria-label="Hire date" type="date" style={inputStyle} value={edit.hireDate} onChange={e => setEdit(x => ({ ...x, hireDate: e.target.value }))} /></label>
              <label><span style={label}>Seniority (adjusted) date</span><input aria-label="Seniority date" type="date" style={inputStyle} value={edit.seniorityDate} onChange={e => setEdit(x => ({ ...x, seniorityDate: e.target.value }))} /></label>
              <label><span style={label}>Years of service</span><input aria-label="Years of service" type="number" style={inputStyle} value={edit.yos} onChange={e => setEdit(x => ({ ...x, yos: e.target.value }))} /></label>
              <label><span style={label}>Holiday hours</span><input aria-label="Holiday hours" type="number" style={inputStyle} value={edit.holiday} onChange={e => setEdit(x => ({ ...x, holiday: e.target.value }))} /></label>
              <label><span style={label}>Vacation hours</span><input aria-label="Vacation hours" type="number" style={inputStyle} value={edit.vacation} onChange={e => setEdit(x => ({ ...x, vacation: e.target.value }))} /></label>
              <label><span style={label}>Banked / comp hours</span><input aria-label="Banked hours" type="number" style={inputStyle} value={edit.banked} onChange={e => setEdit(x => ({ ...x, banked: e.target.value }))} /></label>
            </div>
            <label style={{ display: "block", marginTop: 10 }}><span style={label}>Note</span><input aria-label="Note" style={inputStyle} value={edit.note} onChange={e => setEdit(x => ({ ...x, note: e.target.value }))} /></label>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button style={btn("primary")} onClick={save}>Save</button>
              <button style={btn("ghost")} onClick={() => setEdit(null)}>Cancel</button>
              {edit.memberId && <button style={{ ...btn("ghost"), color: BRICK, marginLeft: "auto" }} onClick={() => { const m = data.units.flatMap(u => u.members).find(x => x.id === edit.memberId); setEdit(null); remove(m); }}><Trash2 size={13} /> Take out of pick</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
