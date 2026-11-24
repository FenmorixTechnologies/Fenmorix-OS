// TV dashboard mode (/display). A station TV or a wall screen signs in as a display screen (paired with a code by an accounts
// admin in User Management › Display screens), then cycles through the views it was given. When an incident Command Board is
// open and the screen is set to switch to boards, it shows the live board on its own, and goes back to cycling when the board
// closes. The screen never has a person's session: everything comes from /api/display.
import React, { useEffect, useRef, useState } from "react";
import { BRAND } from "./brand.js";
import { Users, CloudSun, Phone, GraduationCap, Radio, Flame, Wind, Umbrella, AlertTriangle, MonitorSmartphone } from "lucide-react";
import { DutyBoard } from "./DutyBoard.jsx";
import { skyIcon } from "./Weather.jsx";
import { Board } from "./CommandBoard.jsx";
import { SpotTv } from "./Spot.jsx";
import { Coins, CalendarClock } from "lucide-react";
import { STATUS, dayLine } from "./scheduleShared.js";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", SAGE = "#2E7D4F", PAPER = "#F3F5F8";
const ICONS = { schedule: CalendarClock, duty: Users, weather: CloudSun, oncall: Phone, classes: GraduationCap, calls: Radio, spot: Coins };
const BOARD_POLL_MS = 10_000, ME_POLL_MS = 60_000, BOARD_ROTATE_MS = 30_000;

async function get(path) {
  const r = await fetch(`/api/display${path}`, { credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Not available"), { status: r.status });
  return j;
}
const post = path => fetch(`/api/display${path}`, { method: "POST", credentials: "same-origin", headers: { "X-SGFD": "1" } }).then(r => r.json());

export default function DisplayScreen() {
  const [me, setMe] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { document.title = `${BRAND.app} · Display`; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Paired? Unpaired screens get a code and check every 5 s until someone enters it.
  useEffect(() => {
    let alive = true, t;
    const check = async () => {
      try {
        let j = await get("/me");
        if (!j.paired && !j.code) j = { ...j, ...(await post("/pair")) };
        if (j.paired && !j.views) j = await get("/me");
        if (alive) setMe(j);
        t = setTimeout(check, j.paired ? ME_POLL_MS : 5000);
      } catch (e) { if (alive) t = setTimeout(check, 10_000); }
    };
    check();
    return () => { alive = false; clearTimeout(t); };
  }, []);

  if (!me) return <Frame><div style={{ color: "#fff", fontSize: 28, padding: 60 }}>Starting…</div></Frame>;
  if (!me.paired) return <Pairing code={me.code} />;
  return <Dashboard me={me} now={now} />;
}

function Frame({ children }) {
  return <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0B1730 0%, #13233F 55%, #2A1020 100%)", fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>{children}</div>;
}

function Pairing({ code }) {
  return (
    <Frame>
      <div style={{ display: "grid", placeItems: "center", minHeight: "100vh", textAlign: "center", color: "#fff", padding: 24 }}>
        <div>
          <img src="/nexus-emblem.png" alt="" style={{ width: 150, height: 150, objectFit: "contain" }} />
          <div style={{ fontSize: 30, fontWeight: 800, fontStyle: "italic", letterSpacing: 1 }}>{BRAND.app.toUpperCase()} · DISPLAY SCREEN</div>
          <div style={{ fontSize: 20, opacity: 0.85, marginTop: 18 }}>To use this screen, an accounts admin enters this code in<br /><b>User Management › Display screens</b>.</div>
          <div aria-label="Pairing code" style={{ fontSize: 96, fontWeight: 800, letterSpacing: 18, margin: "28px 0 10px", fontVariantNumeric: "tabular-nums" }}>{code || "······"}</div>
          <div style={{ fontSize: 16, opacity: 0.7 }}>The code changes every 15 minutes. This page checks on its own; leave it open.</div>
        </div>
      </div>
    </Frame>
  );
}

function Dashboard({ me, now }) {
  const views = me.views.length ? me.views : ["weather"];
  const [i, setI] = useState(0);
  const [boards, setBoards] = useState([]);
  const [b, setB] = useState(0);
  useEffect(() => { setI(0); }, [views.join(",")]);
  // Each view stays up for its seconds, or longer when it's taller than the screen and needs time to scroll all the way down
  const [need, setNeed] = useState(0);
  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); setNeed(0); }, [i]);
  useEffect(() => {
    if (views.length < 2) return;
    const dwell = Math.max(me.seconds * 1000, need + 1000);
    const t = setTimeout(() => setI(x => (x + 1) % views.length), Math.max(0, dwell - (Date.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [i, need, me.seconds, views.join(",")]);

  // An open incident Command Board takes over the screen (several: they take turns every 30 s)
  useEffect(() => {
    if (!me.switchToBoard) { setBoards([]); return; }
    let alive = true;
    const load = () => get("/boards").then(j => { if (alive) setBoards(j.boards.map(x => x.id)); }, () => {});
    load();
    const t = setInterval(load, BOARD_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [me.switchToBoard]);
  useEffect(() => { if (boards.length < 2) { setB(0); return; } const t = setInterval(() => setB(x => (x + 1) % boards.length), BOARD_ROTATE_MS); return () => clearInterval(t); }, [boards.join(",")]);

  if (boards.length) {
    const id = boards[b % boards.length];
    return (
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", height: "100vh", overflow: "hidden" }}>
        <div role="status" aria-label="Live Command Board" style={{ background: "#7A0019", color: "#fff", padding: "8px 22px", display: "flex", gap: 10, alignItems: "center", fontWeight: 800, fontSize: 18, letterSpacing: 0.4 }}>
          <Flame size={20} /> LIVE COMMAND BOARD{boards.length > 1 ? ` · ${b % boards.length + 1} of ${boards.length}` : ""}
          <span style={{ flex: 1 }} /><span style={{ fontWeight: 600, opacity: 0.9 }}>{me.name}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
        </div>
        <AutoScroll key={id} loop style={{ height: "calc(100vh - 38px)" }}><div style={{ zoom: 1.15 }}><Board id={id} display onBack={() => {}} onHome={() => {}} /></div></AutoScroll>
      </div>
    );
  }

  const view = views[i % views.length];
  const Icon = ICONS[view] || MonitorSmartphone;
  return (
    <Frame>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 34px", color: "#fff" }}>
          <img src="/nexus-emblem.png" alt="" style={{ width: 58, height: 58, objectFit: "contain" }} />
          <div style={{ fontSize: 22, fontWeight: 800, fontStyle: "italic", letterSpacing: 1 }}>{BRAND.app.toUpperCase()}</div>
          <div style={{ fontSize: 17, opacity: 0.75 }}>{me.name}</div>
          <span style={{ flex: 1 }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 40, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
            <div style={{ fontSize: 16, opacity: 0.8 }}>{new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
        </header>
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "0 34px", background: PAPER, borderRadius: 14, padding: "22px 28px", boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden" }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 0 16px", fontSize: 30, color: INK }}><Icon size={30} color={BRICK} /> {me.viewNames?.[view] || view}</h1>
          <AutoScroll key={view} onNeed={setNeed} style={{ flex: 1, minHeight: 0 }}><ViewBody view={view} now={now} /></AutoScroll>
        </main>
        <footer style={{ display: "flex", gap: 10, justifyContent: "center", padding: "14px 0 18px" }} aria-label="Views">
          {views.map((v, k) => <span key={v} title={me.viewNames?.[v]} style={{ width: k === i % views.length ? 34 : 12, height: 12, borderRadius: 6, background: k === i % views.length ? BRICK : "rgba(255,255,255,.35)", transition: "width .3s" }} />)}
        </footer>
      </div>
    </Frame>
  );
}

// Nobody is at a TV to scroll it: anything taller than its space scrolls down slowly on its own after a pause at the top.
// A view stops at the bottom (onNeed tells the dashboard how long that takes); a Command Board (loop) scrolls back up and goes again.
export function AutoScroll({ children, loop = false, onNeed, style, speed = 45, hold = 4000 }) {
  const box = useRef(null), inner = useRef(null), told = useRef(0);
  useEffect(() => {
    let raf, start = performance.now(), lastOver = 0;
    const step = t => {
      const el = inner.current, bx = box.current;
      if (el && bx) {
        const over = Math.max(0, el.offsetHeight - bx.clientHeight);
        if ((over > 0) !== (lastOver > 0)) start = t;          // content just started (or stopped) overflowing: begin again from the top
        lastOver = over;
        const travel = (over / speed) * 1000, back = loop ? travel / 3 : 0, cycle = hold + travel + hold + back;
        if (over > 0 && onNeed && Math.abs(told.current - (hold + travel + hold)) > 500) { told.current = hold + travel + hold; onNeed(told.current); }
        let e = t - start;
        e = loop ? e % cycle : Math.min(e, cycle);
        const y = over <= 0 ? 0 : e < hold ? 0 : e < hold + travel ? ((e - hold) / travel) * over : e < hold + travel + hold ? over : over * (1 - (e - hold - travel - hold) / back);
        el.style.transform = `translateY(${-Math.round(y)}px)`;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [loop, speed, hold]);
  return <div ref={box} data-autoscroll={loop ? "loop" : "view"} style={{ overflow: "hidden", position: "relative", ...style }}><div ref={inner}>{children}</div></div>;
}

function ViewBody({ view, now }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () => get(`/view/${view}`).then(j => { if (alive) { setD(j); setError(""); } }, e => { if (alive) setError(e.message); });
    load();
    const t = setInterval(load, view === "calls" || view === "spot" ? 15_000 : 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [view]);
  const big = { fontSize: 22, color: INK };
  if (error) return <div style={{ ...big, color: INK_SOFT }}>{error}</div>;
  if (!d) return <div style={{ ...big, color: INK_SOFT }}>Loading…</div>;

  if (view === "spot") return <SpotTv d={d} />;
  if (view === "duty") {
    if (!d.configured) return <div style={{ ...big, color: INK_SOFT }}>Aladtec isn't set up.</div>;
    if (d.error) return <div style={{ ...big, color: INK_SOFT }}>{d.error}</div>;
    return <div style={{ zoom: 1.35 }}><DutyBoard snap={d} places={d.places || []} /></div>;
  }
  if (view === "weather") {
    if (!d.configured || d.error || !d.now) return <div style={{ ...big, color: INK_SOFT }}>{d.error || "Weather isn't available."}</div>;
    const n = d.now, Sky = skyIcon(n.text, n.isDaytime);
    return (
      <div>
        {(d.alerts || []).slice(0, 2).map((a, k) => (
          <div key={k} style={{ background: a.severity === "Extreme" || a.severity === "Severe" ? BRICK : AMBER, color: "#fff", borderRadius: 10, padding: "10px 16px", marginBottom: 12, fontSize: 20, fontWeight: 700, display: "flex", gap: 10, alignItems: "center" }}>
            <AlertTriangle size={22} /> {a.event}{a.ends ? ` · until ${new Date(a.ends).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}</div>))}
        <div style={{ display: "flex", gap: 40, alignItems: "center", flexWrap: "wrap" }}>
          <Sky size={120} color={INK} />
          <div>
            <div style={{ fontSize: 96, fontWeight: 800, color: INK, lineHeight: 1 }}>{n.tempF}°F</div>
            <div style={{ fontSize: 26, color: INK_SOFT }}>{n.text}{n.feelsF ? ` · feels like ${n.feelsF}°` : ""}</div>
          </div>
          <div style={{ fontSize: 26, color: INK, lineHeight: 1.6 }}>
            <div><Wind size={24} /> {n.windDir} {n.windMph ?? "–"} mph{n.gustMph ? `, gusts ${n.gustMph}` : ""}</div>
            <div><Umbrella size={24} /> {d.rain.now}% now{d.rain.nextAt ? ` · rain likely by ${d.rain.nextAt}` : ""}</div>
            {n.humidity != null && <div>Humidity {n.humidity}%</div>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10, marginTop: 24 }}>
          {(d.hours || []).slice(0, 8).map((h, k) => { const I = skyIcon(h.short, h.isDaytime); return (
            <div key={k} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 12, textAlign: "center", color: INK }}>
              <div style={{ fontSize: 17, color: INK_SOFT }}>{h.at}</div><I size={34} /><div style={{ fontSize: 26, fontWeight: 800 }}>{h.tempF}°</div>
              <div style={{ fontSize: 15, color: INK_SOFT }}>{h.pop}% · {h.wind}</div></div>); })}
        </div>
      </div>
    );
  }
  if (view === "schedule") {
    const list = d.list || [];
    if (!list.length) return <div style={{ ...big, color: INK_SOFT }}>No one is on today's schedule.</div>;
    const groups = ["working", "later", "left_early", "done", "out"].map(k => [k, list.filter(e => e.status === k)]).filter(([, l]) => l.length);
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
        {groups.map(([k, l]) => (
          <div key={k} style={{ background: "#fff", border: `1px solid ${LINE}`, borderTop: `6px solid ${STATUS[k].color}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: STATUS[k].color, marginBottom: 6 }}>{STATUS[k].label} · {l.length}</div>
            {l.map(e => <div key={e.userId} style={{ padding: "6px 0", borderTop: `1px solid ${LINE}`, color: INK }}>
              <div style={{ fontSize: 23, fontWeight: 700 }}>{e.name}</div>
              <div style={{ fontSize: 18, color: INK_SOFT }}>{e.status === "out" ? (e.off?.label || "Out") : dayLine(e)}</div></div>)}
          </div>))}
      </div>
    );
  }
  if (view === "oncall") {
    if (!d.entries.length) return <div style={{ ...big, color: INK_SOFT }}>Nobody is on the call-out schedule today.</div>;
    const byDiv = d.entries.reduce((m, e) => ((m[e.division] = m[e.division] || []).push(e), m), {});
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {Object.entries(byDiv).map(([div, list]) => (
          <div key={div} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: INK, marginBottom: 6 }}>{div}</div>
            {list.map((e, k) => <div key={k} style={{ fontSize: 21, color: INK, padding: "4px 0" }}><span style={{ color: INK_SOFT, display: "inline-block", width: 36 }}>{e.position}.</span>{e.name}</div>)}
          </div>))}
      </div>
    );
  }
  if (view === "classes") {
    if (!d.classes.length) return <div style={{ ...big, color: INK_SOFT }}>No classes booked today.</div>;
    return (
      <div role="list">
        {d.classes.map((c, k) => (
          <div key={k} role="listitem" style={{ display: "flex", gap: 24, alignItems: "baseline", padding: "12px 0", borderBottom: `1px solid ${LINE}`, color: INK }}>
            <span style={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 190 }}>{c.start}–{c.end}</span>
            <span style={{ fontSize: 24, fontWeight: 700, flex: 1 }}>{c.title || "Booked"}</span>
            <span style={{ fontSize: 20, color: INK_SOFT }}>{c.room}</span>
          </div>))}
      </div>
    );
  }
  if (view === "calls") {
    if (!d.configured) return <div style={{ ...big, color: INK_SOFT }}>Active calls aren't set up.</div>;
    if (d.error) return <div style={{ ...big, color: INK_SOFT }}>{d.error}</div>;
    if (!d.calls?.length) return <div style={{ ...big, color: SAGE, fontWeight: 700 }}>No open calls.</div>;
    const mins = iso => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : null);
    return (
      <div role="list">
        {d.calls.slice(0, 8).map(c => (
          <div key={c.id} role="listitem" style={{ display: "flex", gap: 20, padding: "12px 0", borderBottom: `1px solid ${LINE}`, color: INK, alignItems: "baseline" }}>
            <span style={{ fontSize: 24, fontWeight: 800, minWidth: 260, color: /FIRE/i.test(c.type) ? BRICK : INK }}>{c.type || "Call"}</span>
            <span style={{ fontSize: 21, flex: 1 }}>{[c.address, c.city].filter(Boolean).join(", ")}<div style={{ fontSize: 17, color: INK_SOFT }}>{(c.units || []).join(" · ")}</div></span>
            <span style={{ fontSize: 20, fontWeight: 700 }}>{c.status}</span>
            <span style={{ fontSize: 22, fontWeight: 800, minWidth: 90, textAlign: "right" }}>{mins(c.receivedAt) != null ? `${mins(c.receivedAt)} min` : ""}</span>
          </div>))}
      </div>
    );
  }
  return null;
}
