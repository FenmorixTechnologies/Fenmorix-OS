// Weather next to the date on Your Day: temperature, wind (speed, direction, gusts) and rain
// chance, from the National Weather Service via the server (GET /api/weather, cached 10 min).
// Click it for the next 12 hours. Active NWS warnings show as a red pill beside it.
import React, { useEffect, useRef, useState } from "react";
import { Sun, Moon, Cloud, CloudSun, CloudMoon, CloudRain, CloudDrizzle, CloudLightning, CloudSnow, CloudFog, Navigation2, Umbrella, AlertTriangle } from "lucide-react";

const INK = "#13233F", INK_SOFT = "#4B5565", LINE = "#DDE2EA", BRICK = "#C8102E", AMBER = "#B26A00", BLUE = "#1D5FA8";

export function skyIcon(text, day = true) {
  const t = String(text || "").toLowerCase();
  if (/thunder|t-storm|tstorm/.test(t)) return CloudLightning;
  if (/snow|sleet|ice|flurr/.test(t)) return CloudSnow;
  if (/drizzle/.test(t)) return CloudDrizzle;
  if (/rain|shower/.test(t)) return CloudRain;
  if (/fog|haze|mist|smoke/.test(t)) return CloudFog;
  if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) return day ? CloudSun : CloudMoon;
  if (/cloud|overcast/.test(t)) return Cloud;
  return day ? Sun : Moon;
}
const sevColor = s => (s === "Extreme" || s === "Severe" ? BRICK : AMBER);
const until = iso => (iso ? new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : "");

export default function WeatherBar() {
  const [w, setW] = useState(null);
  const [open, setOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/weather", { credentials: "same-origin", headers: { "X-SGFD-Background": "1" } })
      .then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setW(j); }, () => {});
    load();
    const t = setInterval(load, 10 * 60_000);
    const close = e => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setAlertOpen(false); } };
    document.addEventListener("pointerdown", close);
    return () => { alive = false; clearInterval(t); document.removeEventListener("pointerdown", close); };
  }, []);
  if (!w || !w.configured || w.error || !w.now) return null;
  const n = w.now, Icon = skyIcon(n.text, n.isDaytime);
  const rainText = w.rain.nextAt ? `${w.rain.now}% now · rain likely by ${w.rain.nextAt}` : w.rain.peak > w.rain.now ? `${w.rain.now}% now · up to ${w.rain.peak}% by ${w.rain.peakAt}` : `${w.rain.now}% chance of rain`;
  const top = w.alerts && w.alerts[0];
  const chip = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };

  return (
    <div ref={box} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
      <button type="button" onClick={() => { setOpen(o => !o); setAlertOpen(false); }} aria-expanded={open}
        title={`${w.location}: ${n.text}${n.observedAt ? ` (observed ${new Date(n.observedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}. Click for the next 12 hours.`}
        aria-label={`Weather: ${n.tempF} degrees, ${n.text}, wind ${n.windDir} ${n.windMph} miles per hour, ${rainText}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "rgba(255,255,255,0.85)", border: `1px solid ${LINE}`, borderRadius: 10, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", color: INK, fontSize: 13 }}>
        <span style={chip}>
          <Icon size={22} color={/rain|storm|thunder|shower/i.test(n.text) ? BLUE : AMBER} strokeWidth={1.8} />
          <b style={{ fontSize: 18, fontWeight: 800 }}>{n.tempF ?? "—"}°F</b>
          {n.feelsF != null && <span style={{ color: INK_SOFT }}>feels {n.feelsF}°</span>}
        </span>
        <span style={chip} title="Wind">
          {n.windDeg != null && <Navigation2 size={14} color={INK} fill={INK} style={{ transform: `rotate(${(n.windDeg + 180) % 360}deg)` }} aria-hidden="true" />}
          <span>{n.windMph === 0 ? "Calm" : <>{n.windDir} {n.windMph ?? "—"} mph{n.gustMph ? <span style={{ color: INK_SOFT }}>, gusts {n.gustMph}</span> : null}</>}</span>
        </span>
        <span style={chip} title="Chance of rain">
          <Umbrella size={14} color={BLUE} /> {rainText}
        </span>
      </button>
      {top && (
        <button type="button" onClick={() => { setAlertOpen(o => !o); setOpen(false); }} aria-expanded={alertOpen}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: sevColor(top.severity), color: "#fff", border: "none", borderRadius: 999, padding: "5px 12px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
          <AlertTriangle size={14} /> {top.event}{top.ends ? ` until ${until(top.ends)}` : ""}{w.alerts.length > 1 ? ` (+${w.alerts.length - 1})` : ""}
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Next 12 hours" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 30, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, boxShadow: "0 12px 30px rgba(19,35,63,0.18)", padding: "12px 14px", width: "min(560px, 92vw)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
            <b style={{ fontSize: 14 }}>{w.location} · next 12 hours</b>
            {w.today && <span style={{ fontSize: 12.5, color: INK_SOFT }}>{w.today.name}: {w.today.isDaytime ? "high" : "low"} {w.today.temp}°, {w.today.short}</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${w.hours.length}, minmax(38px, 1fr))`, gap: 2, overflowX: "auto" }}>
            {w.hours.map((h, i) => {
              const H = skyIcon(h.short, h.isDaytime);
              return (
                <div key={i} title={`${h.at}: ${h.short}, wind ${h.wind} mph`} style={{ textAlign: "center", fontSize: 11.5, color: INK_SOFT, padding: "4px 0" }}>
                  <div>{h.at.replace(" ", "").toLowerCase()}</div>
                  <H size={18} color={INK} strokeWidth={1.7} style={{ margin: "4px auto" }} />
                  <div style={{ fontWeight: 800, color: INK, fontSize: 13 }}>{h.tempF}°</div>
                  <div style={{ height: 34, display: "flex", alignItems: "flex-end", justifyContent: "center", margin: "3px 0" }}>
                    <div style={{ width: 10, height: `${Math.max(2, h.pop * 0.34)}px`, background: h.pop >= 50 ? BLUE : "#8FB3E0", borderRadius: 2 }} />
                  </div>
                  <div style={{ color: h.pop >= 30 ? BLUE : INK_SOFT, fontWeight: h.pop >= 30 ? 700 : 400 }}>{h.pop}%</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11.5, color: INK_SOFT, gap: 10, flexWrap: "wrap" }}>
            <span>National Weather Service{n.station ? ` · station ${n.station}` : ""}{w.stale ? " · couldn't refresh, showing the last reading" : ""}</span>
            <a href={w.link} target="_blank" rel="noopener noreferrer" style={{ color: BLUE }}>Full forecast ›</a>
          </div>
        </div>
      )}
      {alertOpen && top && (
        <div role="dialog" aria-label="Weather alerts" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 30, background: "#fff", border: `1px solid ${LINE}`, borderLeft: `4px solid ${sevColor(top.severity)}`, borderRadius: 10, boxShadow: "0 12px 30px rgba(19,35,63,0.18)", padding: "12px 14px", width: "min(560px, 92vw)", maxHeight: 360, overflowY: "auto" }}>
          {w.alerts.map((a, i) => (
            <div key={i} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: i < w.alerts.length - 1 ? `1px solid ${LINE}` : "none" }}>
              <div style={{ fontWeight: 800, color: sevColor(a.severity) }}>{a.event}</div>
              {a.headline && <div style={{ fontSize: 13, color: INK, marginTop: 2 }}>{a.headline}</div>}
              {a.instruction && <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 6, whiteSpace: "pre-wrap" }}>{a.instruction}</div>}
            </div>
          ))}
          <a href={w.link} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontSize: 12.5 }}>Details on weather.gov ›</a>
        </div>
      )}
    </div>
  );
}
