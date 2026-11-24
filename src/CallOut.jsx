// Call-Out Schedule: who's on call for each division, and the floor's
// call-back order, on a month calendar with the Fire and Communications shifts.
import AppShell from "./AppShell.jsx";
import { PhoneCall, Building2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  wrapStyle, cardStyle, inputStyle, btn, sectionTitle, StyleBlock, MainMenuButton,
  loadShared, saveStrict, uid, INK, INK_SOFT, LINE, PAPER, BRICK, BRASS_DEEP, SAGE,
} from "./App.jsx";
import { todayISO, addDays, pretty, fireShift, commsShifts, weekday, dayNum } from "./shifts.js";

const PALETTE = ["#1D5FA8", "#C8102E", "#2E7D4F", "#B26A00", "#7A4FB5", "#0F7C86", "#9E4A1C", "#4B5565", "#A3376A", "#3F6B2A", "#5B4FA8", "#86610F"];

export function canEditCallout(me, division) {
  if (!me) return false;
  if (me.role === "master" || me.division === division) return true;
  const ce = me.permissions?.calloutEdit || [];
  return ce.includes("*") || ce.includes(division);
}
const onDay = (e, d) => e.startDate <= d && e.endDate >= d;
const telHref = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");

function EntryForm({ initial, divisions, roster, me, onSave, onCancel }) {
  const editable = divisions.filter(d => canEditCallout(me, d));
  const [f, setF] = useState(() => ({
    division: initial.division && editable.includes(initial.division) ? initial.division : (editable.includes(me.division) ? me.division : editable[0]),
    startDate: initial.startDate, endDate: initial.endDate || initial.startDate,
    userId: initial.userId || "", personName: initial.userId ? "" : (initial.personName || ""),
    phone: initial.phone || "", position: String(initial.position || 1), notes: initial.notes || "",
  }));
  const [error, setError] = useState("");
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const people = [...roster].sort((a, b) => (a.division === f.division ? 0 : 1) - (b.division === f.division ? 0 : 1) || a.name.localeCompare(b.name));
  function pickPerson(id) {
    const u = roster.find(x => x.id === id);
    setF(x => ({ ...x, userId: id, personName: "", phone: u?.phone ? u.phone : x.phone }));
  }
  function save() {
    if (!f.division) { setError("You can't edit any division's schedule."); return; }
    if (!f.startDate || !f.endDate) { setError("Choose the dates."); return; }
    if (f.endDate < f.startDate) { setError("The end date is before the start date."); return; }
    if (!f.userId && !f.personName.trim()) { setError("Choose who is on call."); return; }
    const u = roster.find(x => x.id === f.userId);
    onSave({
      ...initial, id: initial.id || uid(), division: f.division, startDate: f.startDate, endDate: f.endDate,
      userId: u ? u.id : null, personName: u ? u.name : f.personName.trim(), phone: f.phone.trim(),
      position: Math.max(1, Math.min(99, parseInt(f.position, 10) || 1)), notes: f.notes.trim(),
    });
  }
  const lab = { fontSize: 12, color: INK_SOFT, display: "flex", flexDirection: "column", gap: 3 };
  const inp = { ...inputStyle, padding: "6px 8px", fontSize: 13 };
  return (
    <div style={{ background: PAPER, border: `1px solid ${LINE}`, borderRadius: 6, padding: "12px 14px", marginTop: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        <label style={lab}>Division
          <select aria-label="Call-out division" style={inp} value={f.division} onChange={e => set("division", e.target.value)}>
            {editable.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label style={lab}>From
          <input aria-label="On call from" type="date" style={inp} value={f.startDate} onChange={e => set("startDate", e.target.value)} />
        </label>
        <label style={lab}>Through
          <input aria-label="On call through" type="date" style={inp} value={f.endDate} onChange={e => set("endDate", e.target.value)} />
        </label>
        <label style={lab}>Person
          <select aria-label="On-call person" style={inp} value={f.userId || (f.personName ? "__other" : "")}
            onChange={e => e.target.value === "__other" ? setF(x => ({ ...x, userId: "", personName: x.personName || " " })) : pickPerson(e.target.value)}>
            <option value="">Choose…</option>
            {people.map(u => <option key={u.id} value={u.id}>{u.name} — {u.division}</option>)}
            <option value="__other">Someone not on the roster…</option>
          </select>
        </label>
        {!f.userId && f.personName !== "" && (
          <label style={lab}>Name
            <input aria-label="On-call name" style={inp} value={f.personName.trimStart()} onChange={e => set("personName", e.target.value)} />
          </label>
        )}
        <label style={lab}>Contact number
          <input aria-label="Contact number" style={inp} value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="Cell phone" />
        </label>
        <label style={lab}>Order <span style={{ fontWeight: 400 }}>(1 = first called)</span>
          <input aria-label="Call order" type="number" min="1" max="99" style={inp} value={f.position} onChange={e => set("position", e.target.value)} />
        </label>
      </div>
      <label style={{ ...lab, marginTop: 10 }}>Notes (optional)
        <input aria-label="Call-out notes" style={inp} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="e.g. backup radio, covering for…" />
      </label>
      {error && <div style={{ color: BRICK, fontSize: 12.5, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={btn("primary")} onClick={save}>Save</button>
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function CallOutModule({ onBack }) {
  const [loaded, setLoaded] = useState(false);
  const [roster, setRoster] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [identityId, setIdentityId] = useState(null);
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));   // YYYY-MM
  const [selected, setSelected] = useState(todayISO());
  const [hidden, setHidden] = useState([]);                          // divisions hidden from the calendar
  const [editing, setEditing] = useState(null);                      // entry, or { new: true }
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      const [r, d, c, ident] = await Promise.all([
        loadShared("roster", []), loadShared("divisions", []), loadShared("callouts", []),
        (async () => { try { const x = await window.storage.get("current-identity", false); return x ? x.value : null; } catch (e) { return null; } })(),
      ]);
      setRoster(r); setDivisions(d); setEntries(c); setIdentityId(ident);
      setLoaded(true);
    })();
  }, []);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const me = roster.find(u => u.id === identityId) || null;
  const today = todayISO();

  const usedDivisions = useMemo(() => [...new Set(entries.map(e => e.division))].sort(), [entries]);
  const color = d => PALETTE[Math.max(0, divisions.indexOf(d)) % PALETTE.length];
  const shown = e => !hidden.includes(e.division);
  const canAdd = divisions.some(d => canEditCallout(me, d));

  async function saveEntry(rec) {
    const isNew = !entries.some(x => x.id === rec.id);
    const next = isNew ? [...entries, rec] : entries.map(x => x.id === rec.id ? rec : x);
    if (!(await saveStrict("callouts", next))) return;
    setEntries(next); setEditing(null);
    showToast(isNew ? "Added to the call-out schedule" : "Call-out schedule updated");
  }
  async function removeEntry(e) {
    if (!window.confirm(`Remove ${e.personName} from ${e.division}'s call-out schedule?`)) return;
    const next = entries.filter(x => x.id !== e.id);
    if (!(await saveStrict("callouts", next))) return;
    setEntries(next); setEditing(null);
    showToast("Removed");
  }

  if (!loaded) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Loading…</div>;
  if (!me) return <div style={{ padding: 40, textAlign: "center", color: INK_SOFT }}>Your account isn't on the roster yet.</div>;

  // Month grid, Sunday first
  const first = `${month}-01`;
  const gridStart = addDays(first, -weekday(first));
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weeks = Math.ceil((weekday(first) + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const shiftMonth = delta => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const dayList = d => entries.filter(e => onDay(e, d) && shown(e))
    .sort((a, b) => a.division.localeCompare(b.division) || a.position - b.position);
  const grouped = d => {
    const g = new Map();
    for (const e of dayList(d)) { if (!g.has(e.division)) g.set(e.division, []); g.get(e.division).push(e); }
    return g;
  };
  const todayGroups = grouped(today);
  const selGroups = grouped(selected);
  const c = commsShifts(selected);

  const PersonLine = ({ e, big }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: big ? "7px 0" : "3px 0", borderBottom: big ? `1px solid ${LINE}` : "none", fontSize: big ? 13.5 : 13, flexWrap: "wrap" }}>
      {e.position > 1 || big ? <span style={{ fontWeight: 700, color: INK_SOFT, minWidth: 22 }}>#{e.position}</span> : null}
      <span style={{ fontWeight: 700 }}>{e.personName}</span>
      {e.phone && <a href={telHref(e.phone)} style={{ color: BRASS_DEEP, fontWeight: 600 }}>{e.phone}</a>}
      {big && <span style={{ color: INK_SOFT, fontSize: 12.5 }}>{e.startDate === e.endDate ? pretty(e.startDate) : `${pretty(e.startDate)} – ${pretty(e.endDate)}`}</span>}
      {e.notes && <span style={{ color: INK_SOFT, fontSize: 12.5 }}>{e.notes}</span>}
      {big && canEditCallout(me, e.division) && (
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={{ ...btn("outline"), padding: "3px 9px", fontSize: 12 }} onClick={() => setEditing(e)}>Edit</button>
          <button style={{ ...btn("ghost"), padding: "3px 9px", fontSize: 12, color: BRICK }} onClick={() => removeEntry(e)}>Remove</button>
        </span>
      )}
    </div>
  );

  const onlyOne = usedDivisions.filter(d => !hidden.includes(d));
  const shellActive = hidden.length === 0 ? "all" : onlyOne.length === 1 ? onlyOne[0] : "";
  const shellGo = k => setHidden(k === "all" ? [] : usedDivisions.filter(d => d !== k));
  const shellNav = [
    { key: "all", label: "All divisions", icon: PhoneCall },
    ...usedDivisions.map(d => ({ key: d, label: d, icon: Building2, group: "Divisions" })),
  ];

  return (
    <AppShell section="Call-Out Schedule" nav={shellNav} active={shellActive} onNav={shellGo} onHome={onBack}>
      <div>
        <div style={sectionTitle}>{shellActive && shellActive !== "all" ? `${shellActive} call-out` : "Call-Out Schedule"}</div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2, marginBottom: 14 }}>
          Who's on call for each division, and the floor's call-back order. Each division keeps its own; everyone can see all of them.
        </div>

        {/* On call today */}
        <div style={{ ...cardStyle, marginBottom: 16, borderLeft: `4px solid ${BRICK}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>On call today · {pretty(today, { weekday: "long", month: "long", day: "numeric" })}</div>
            <div style={{ fontSize: 12.5, color: INK_SOFT }}>
              Fire: <b style={{ color: BRICK }}>{fireShift(today)} shift</b> · Communications: <b>{commsShifts(today).day}</b> days, <b>{commsShifts(today).night}</b> nights
            </div>
          </div>
          {todayGroups.size === 0 && <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 8 }}>No one is listed for today yet.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "6px 22px", marginTop: 8 }}>
            {[...todayGroups].map(([div, list]) => (
              <div key={div}>
                <div style={{ fontSize: 12, fontWeight: 700, color: color(div), textTransform: "uppercase", letterSpacing: 0.4 }}>{div}{list.length > 1 ? " · call-back order" : ""}</div>
                {list.map(e => <PersonLine key={e.id} e={e} />)}
              </div>
            ))}
          </div>
        </div>

        {/* Month controls and division toggles */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button style={{ ...btn("outline"), padding: "6px 11px" }} aria-label="Previous month" onClick={() => shiftMonth(-1)}>‹</button>
          <div style={{ fontWeight: 700, fontSize: 16, minWidth: 150, textAlign: "center" }}>{pretty(first, { month: "long", year: "numeric" })}</div>
          <button style={{ ...btn("outline"), padding: "6px 11px" }} aria-label="Next month" onClick={() => shiftMonth(1)}>›</button>
          <button style={btn("ghost")} onClick={() => { setMonth(today.slice(0, 7)); setSelected(today); }}>Today</button>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 8 }}>
            {usedDivisions.map(d => {
              const on = !hidden.includes(d);
              return (
                <label key={d} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12.5, cursor: "pointer", padding: "3px 9px", borderRadius: 999, border: `1px solid ${on ? color(d) : LINE}`, color: on ? color(d) : INK_SOFT, fontWeight: 600, background: "#fff" }}>
                  <input type="checkbox" checked={on} onChange={() => setHidden(h => on ? [...h, d] : h.filter(x => x !== d))} style={{ margin: 0 }} />
                  {d}
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} style={{ fontSize: 11.5, fontWeight: 700, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5, padding: "0 4px" }}>{d}</div>
          ))}
          {cells.map(d => {
            const inMonth = d.slice(0, 7) === month;
            const g = grouped(d);
            const cs = commsShifts(d);
            const sel = d === selected;
            return (
              <div key={d} role="button" aria-label={`${pretty(d, { weekday: "long", month: "long", day: "numeric" })}: ${g.size} division${g.size === 1 ? "" : "s"} on call`}
                onClick={() => { setSelected(d); setEditing(null); }}
                style={{
                  background: inMonth ? "#fff" : "#F7F8FA", border: `1px solid ${sel ? INK : LINE}`, boxShadow: sel ? `inset 0 0 0 1px ${INK}` : "none",
                  borderRadius: 7, padding: "6px 7px", minHeight: 104, cursor: "pointer", opacity: inMonth ? 1 : 0.65, minWidth: 0,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: d === today ? "#fff" : INK, background: d === today ? BRICK : "transparent", borderRadius: 4, padding: d === today ? "0 5px" : 0 }}>
                    {Number(d.slice(8))}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                    <span title="Fire shift on duty" style={{ color: BRICK }}>F-{fireShift(d)}</span>{" "}
                    <span title={`Communications: ${cs.day} days, ${cs.night} nights`} style={{ color: BRASS_DEEP }}>C-{cs.day}/{cs.night}</span>
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>
                  {[...g].slice(0, 5).map(([div, list]) => (
                    <div key={div} title={`${div}: ${list.map(e => `${e.position}. ${e.personName}`).join(", ")}`}
                      style={{ fontSize: 11, lineHeight: 1.35, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", borderLeft: `3px solid ${color(div)}`, paddingLeft: 4, marginBottom: 2 }}>
                      <b style={{ color: color(div) }}>{div.split(/[\s/(]/)[0]}</b> {list[0].personName}{list.length > 1 ? ` +${list.length - 1}` : ""}
                    </div>
                  ))}
                  {g.size > 5 && <div style={{ fontSize: 11, color: INK_SOFT }}>+{g.size - 5} more</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 6 }}>
          F = Fire (floor) shift on duty, 24 hours. C = Communications day / night shift (0700–1900 / 1900–0700).
        </div>

        {/* Selected day */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{pretty(selected, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
              <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 2 }}>
                Fire on duty: <b>{fireShift(selected)} shift</b> · Communications: <b>{c.day}</b> days (0700–1900), <b>{c.night}</b> nights (1900–0700)
              </div>
            </div>
            {canAdd && !editing && <button style={btn("primary")} onClick={() => setEditing({ new: true })}>+ Add on-call person</button>}
          </div>
          {editing?.new && (
            <EntryForm initial={{ startDate: selected, endDate: selected }} divisions={divisions} roster={roster} me={me}
              onSave={saveEntry} onCancel={() => setEditing(null)} />
          )}
          {selGroups.size === 0 && !editing && <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 10 }}>No one is listed for this day.</div>}
          {[...selGroups].map(([div, list]) => (
            <div key={div} style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: color(div), textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `2px solid ${color(div)}`, paddingBottom: 3 }}>
                {div}{list.length > 1 ? " — call-back order" : ""}
              </div>
              {list.map(e => editing && editing.id === e.id ? (
                <EntryForm key={e.id} initial={e} divisions={divisions} roster={roster} me={me} onSave={saveEntry} onCancel={() => setEditing(null)} />
              ) : <PersonLine key={e.id} e={e} big />)}
            </div>
          ))}
          {!canAdd && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 12 }}>A division's schedule is kept by its own members and anyone a master admin allows.</div>}
        </div>
      </div>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: "#FFFFFF", padding: "10px 18px", borderRadius: 7, fontSize: 13.5, fontWeight: 600 }}>
          {toast}
        </div>
      )}
    </AppShell>
  );
}
