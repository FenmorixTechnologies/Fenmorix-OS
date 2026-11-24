// The Aladtec duty board, used on the Directory's Aladtec setup page and the Your Day widget.
// (Its own file, with its own colors, so YourDay.jsx can load it without importing App.jsx.)
import React from "react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", SAGE = "#2E7D4F", AMBER = "#B26A00";
const cardStyle = { background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 8 };

// The shift, grouped into cards: Chiefs (SG units), each station with its units, then a card per
// other schedule (Communications split into Days and Nights), Trades and Time Off.
// Uses today's whole shift when Aladtec provides it, otherwise just who's on right now.
const CHIEF_MATCH = "SG*";
const isNightStart = t => { const h = Number(String(t).slice(0, 2)); return t && (h >= 17 || h < 5); };
export function DutyBoard({ snap, places, compact = false }) {
  const whole = Array.isArray(snap.today) && snap.today.length > 0;
  const rows = whole ? snap.today : snap.assignments;
  const full = snap.shiftStartTime || "07:00";
  const stations = places.filter(p => p.kind === "station")
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
  const cards = [{ key: "chiefs", title: "Chiefs", units: new Map() },
    ...stations.map(p => ({ key: p.id, title: p.name, place: p, units: new Map() }))];
  const other = new Map();   // schedule name -> rows
  const add = (card, unit, a) => { if (!card.units.has(unit)) card.units.set(unit, []); card.units.get(unit).push(a); };
  for (const a of rows) {
    const unit = a.scheduleName || "Unassigned";
    if (matchStation(a, CHIEF_MATCH)) { add(cards[0], unit, a); continue; }
    const st = cards.find(c => c.place && matchStation(a, c.place.aladtecMatch));
    if (st) { add(st, unit, a); continue; }
    if (!other.has(unit)) other.set(unit, []);
    other.get(unit).push(a);
  }
  // Other schedules: one card each; split into Days / Nights when it has both
  for (const [name, list] of other) {
    const nights = list.filter(a => isNightStart(a.start)), days = list.filter(a => !isNightStart(a.start));
    if (whole && nights.length && days.length) {
      cards.push({ key: `o-${name}-d`, title: `${name} Days`, people: days });
      cards.push({ key: `o-${name}-n`, title: `${name} Nights`, people: nights });
    } else cards.push({ key: `o-${name}`, title: name, people: list });
  }
  const trades = whole ? rows.filter(a => a.trade) : [];
  if (trades.length) cards.push({ key: "trades", title: "Trades", people: trades, showUnit: true });
  if (snap.timeOff?.length) cards.push({ key: "off", title: "Time Off", off: snap.timeOff });

  const times = a => (a.start && a.stop && !(a.start === full && a.stop === full) ? `${a.start}–${a.stop}` : "");
  const person = (a, i, showUnit) => {
    const t = times(a);
    return (
      <div key={i} style={{ padding: "2px 0", opacity: whole && a.onNow === false ? 0.55 : 1 }} title={whole && a.onNow === false ? "Not on right now" : undefined}>
        <b>{a.name}</b>{a.positionLabel && <span style={{ color: INK_SOFT }}> ({a.positionLabel})</span>}
        {showUnit && <span style={{ color: INK_SOFT }}> · {a.scheduleName}</span>}
        {t && <span style={{ color: INK_SOFT, fontVariantNumeric: "tabular-nums" }}> · {t}</span>}
      </div>
    );
  };
  const shown = cards.filter(c => (c.units && c.units.size) || (c.people && c.people.length) || (c.off && c.off.length));
  if (!shown.length) return <div style={{ fontSize: 13, color: INK_SOFT }}>No one is scheduled right now.</div>;
  return (
    <div>
      {!compact && <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 10 }}>
        {whole ? <>Today's shift (from {full}). Faded names aren't on at this moment.</> : <>Who's on right now.</>}
        {snap.todayError && <span style={{ color: AMBER }}> The whole shift couldn't be loaded: {snap.todayError}</span>}
        {snap.timeOffError && <span style={{ color: AMBER }}> Time off couldn't be loaded: {snap.timeOffError}</span>}
      </div>}
      <div style={{ display: "grid", gridTemplateColumns: compact ? "minmax(0, 1fr)" : "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: compact ? 10 : 14, alignItems: "start" }}>
        {shown.map(c => (
          <section key={c.key} aria-label={`On duty: ${c.title}`} style={compact ? { padding: "2px 0" } : { ...cardStyle, padding: "12px 16px" }}>
            <div style={{ fontWeight: 800, fontSize: compact ? 13.5 : 15, color: INK, borderBottom: `2px solid ${c.key === "off" ? AMBER : c.key === "trades" ? SAGE : INK}`, paddingBottom: 4, marginBottom: 6 }}>{c.title}</div>
            {c.units && [...c.units].map(([unit, people]) => (
              <div key={unit} style={{ display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", gap: 8, fontSize: 13, padding: "5px 0", borderBottom: `1px solid ${LINE}` }}>
                <span style={{ fontWeight: 700, color: INK_SOFT }}>{unit}</span>
                <div>{people.map((a, i) => person(a, i))}</div>
              </div>
            ))}
            {c.people && <div style={{ fontSize: 13 }}>{c.people.map((a, i) => person(a, i, c.showUnit))}</div>}
            {c.off && <div style={{ fontSize: 13 }}>{c.off.map((o, i) => (
              <div key={i} style={{ padding: "2px 0" }}><b>{o.name}</b>{o.type && <span style={{ color: INK_SOFT }}> · {o.type}</span>}
                {o.start && o.stop && !(o.start === full && o.stop === full) && <span style={{ color: INK_SOFT }}> · {o.start}–{o.stop}</span>}</div>
            ))}</div>}
          </section>
        ))}
      </div>
    </div>
  );
}

// Same rule as server/aladtec.js matches(): whole words; ? = one letter/digit, * = any number
export function matchStation(a, match) {
  const words = `${a.scheduleName} ${a.positionLabel}`.toLowerCase();
  return String(match || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean).some(x => {
    const body = x.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\?/g, "[a-z0-9]").replace(/\*/g, "[a-z0-9]*");
    return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`).test(words);
  });
}

