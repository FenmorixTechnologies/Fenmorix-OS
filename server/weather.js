// Current weather for Your Day, from the National Weather Service (api.weather.gov: free, no key).
//
// .env (all optional):
//   WEATHER_LAT=30.37  WEATHER_LON=-91.01   where to report (default: Headquarters, 14100 Airline Hwy)
//   WEATHER_LABEL=St. George                name shown next to the weather
//   WEATHER_DISABLED=true                   turn it off
//   WEATHER_API_BASE=https://api.weather.gov   (tests point this at a stand-in)
//
// The server asks NWS at most every 10 minutes (whoever opens Your Day first triggers it) and
// keeps the last good answer if NWS is slow or down. NWS asks callers to identify themselves with
// a User-Agent; this sends the app's name only.
import { brand, brandText, brandDeep } from "./brand.js";
const UA = () => `${brand().app} (${brand().org})`;
const FRESH_MS = 10 * 60_000, POINT_MS = 24 * 3600_000;

const state = { point: null, pointAt: 0, data: null, at: 0, inflight: null };

function config() {
  const e = process.env;
  return {
    disabled: String(e.WEATHER_DISABLED || "").toLowerCase() === "true",
    lat: Number(e.WEATHER_LAT) || 30.37, lon: Number(e.WEATHER_LON) || -91.01,
    label: String(e.WEATHER_LABEL || brand().place).trim(),
    base: String(e.WEATHER_API_BASE || "https://api.weather.gov").replace(/\/+$/, ""),
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA(), Accept: "application/geo+json" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`weather.gov answered ${r.status}`);
  return r.json();
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = deg => (Number.isFinite(deg) ? COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] : "");
const DEG = Object.fromEntries(COMPASS.map((c, i) => [c, i * 22.5]));
const f = c => (Number.isFinite(c) ? Math.round(c * 9 / 5 + 32) : null);
const mph = (v, unit) => (Number.isFinite(v) ? Math.round(/km_h/.test(unit || "") ? v * 0.621371 : /m_s/.test(unit || "") ? v * 2.23694 : v) : null);
const val = q => (q && Number.isFinite(q.value) ? q.value : null);
// "10 mph" / "5 to 10 mph" -> the higher number
const mphText = s => { const n = String(s || "").match(/\d+/g); return n ? Number(n[n.length - 1]) : null; };
const hourLabel = iso => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric" });

async function load() {
  const c = config();
  if (!state.point || Date.now() - state.pointAt > POINT_MS) {
    const p = (await getJson(`${c.base}/points/${c.lat.toFixed(4)},${c.lon.toFixed(4)}`)).properties || {};
    let station = "";
    try { station = (await getJson(p.observationStations)).features?.[0]?.properties?.stationIdentifier || ""; } catch { /* hourly forecast still works */ }
    state.point = { hourly: p.forecastHourly, forecast: p.forecast, station }; state.pointAt = Date.now();
  }
  const pt = state.point;
  const [hourly, obs, daily, alerts] = await Promise.all([
    getJson(pt.hourly),
    pt.station ? getJson(`${c.base}/stations/${pt.station}/observations/latest`).catch(() => null) : null,
    getJson(pt.forecast).catch(() => null),
    getJson(`${c.base}/alerts/active?point=${c.lat.toFixed(4)},${c.lon.toFixed(4)}`).catch(() => null),
  ]);

  const now = Date.now();
  const periods = (hourly.properties?.periods || []).filter(p => new Date(p.endTime).getTime() > now).slice(0, 12);
  const cur = periods[0] || {};
  const o = obs?.properties || {};
  // Observations can be missing or an hour or two old; fall back to the current forecast hour
  const obsFresh = o.timestamp && now - new Date(o.timestamp).getTime() < 2 * 3600_000;
  const tempF = obsFresh && val(o.temperature) !== null ? f(val(o.temperature)) : cur.temperature ?? null;
  const feels = obsFresh ? (val(o.heatIndex) !== null ? f(val(o.heatIndex)) : val(o.windChill) !== null ? f(val(o.windChill)) : null) : null;
  const windDeg = obsFresh && val(o.windDirection) !== null ? val(o.windDirection) : DEG[cur.windDirection] ?? null;
  const windMph = obsFresh && val(o.windSpeed) !== null ? mph(val(o.windSpeed), o.windSpeed.unitCode) : mphText(cur.windSpeed);
  const gustMph = obsFresh && val(o.windGust) !== null ? mph(val(o.windGust), o.windGust.unitCode) : null;
  const pop = p => p?.probabilityOfPrecipitation?.value ?? 0;
  const wet = periods.find(p => pop(p) >= 30);
  const peak = periods.reduce((m, p) => (pop(p) > pop(m) ? p : m), periods[0] || null);
  const today = (daily?.properties?.periods || [])[0] || null;
  const RANK = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
  const alertList = (alerts?.features || []).map(a => a.properties || {})
    .filter(a => a.status !== "Test" && a.messageType !== "Cancel")
    .sort((a, b) => (RANK[a.severity] ?? 5) - (RANK[b.severity] ?? 5))
    .map(a => ({ event: a.event || "Weather alert", severity: a.severity || "", headline: a.headline || "", ends: a.ends || a.expires || null, instruction: String(a.instruction || "").slice(0, 1200), url: a["@id"] || a.id || "" }))
    .slice(0, 5);

  return {
    configured: true, updatedAt: new Date().toISOString(), location: c.label,
    link: `https://forecast.weather.gov/MapClick.php?lat=${c.lat}&lon=${c.lon}`,
    now: {
      tempF, feelsF: feels !== null && Math.abs(feels - tempF) >= 3 ? feels : null,
      text: (obsFresh && o.textDescription) || cur.shortForecast || "", isDaytime: cur.isDaytime !== false,
      windMph, windDir: compass(windDeg), windDeg, gustMph: gustMph && gustMph > (windMph || 0) + 4 ? gustMph : null,
      humidity: obsFresh && val(o.relativeHumidity) !== null ? Math.round(val(o.relativeHumidity)) : null,
      observedAt: obsFresh ? o.timestamp : null, station: obsFresh ? state.point.station : "",
    },
    rain: { now: pop(cur), peak: peak ? pop(peak) : 0, peakAt: peak ? hourLabel(peak.startTime) : "", nextAt: wet && wet !== cur ? hourLabel(wet.startTime) : "" },
    today: today ? { name: today.name, temp: today.temperature, isDaytime: today.isDaytime, short: today.shortForecast } : null,
    hours: periods.map(p => ({ at: hourLabel(p.startTime), tempF: p.temperature, pop: pop(p), wind: `${p.windDirection || ""} ${mphText(p.windSpeed) ?? ""}`.trim(), short: p.shortForecast, isDaytime: p.isDaytime })),
    alerts: alertList,
  };
}

export async function getWeather() {
  const c = config();
  if (c.disabled) return { configured: false };
  if (state.data && Date.now() - state.at < FRESH_MS) return state.data;
  if (!state.inflight) {
    state.inflight = load().then(d => { state.data = d; state.at = Date.now(); return d; })
      .catch(e => {
        console.warn(`[weather] ${e.message}`);
        state.at = Date.now() - FRESH_MS + 60_000;     // try again in a minute
        return state.data ? { ...state.data, stale: true } : { configured: true, error: "Weather isn't available right now." };
      })
      .finally(() => { state.inflight = null; });
  }
  return state.inflight;
}

// ---- Any point (IMT weather page for an incident's location) ----------------------------------------
// Daily forecast (day/night periods), the latest observation, sunrise-free; cached 30 minutes per point.
const pointCache = new Map();
export async function forecastAt(lat, lon) {
  const c = config();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Object.assign(new Error("The incident needs a map location (latitude/longitude) for the forecast."), { status: 400 });
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = pointCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.data;
  let p;
  try { p = (await getJson(`${c.base}/points/${lat.toFixed(4)},${lon.toFixed(4)}`)).properties || {}; }
  catch (e) { throw Object.assign(new Error(`The National Weather Service didn't answer for that location (${e.message}). It covers the US only.`), { status: 502 }); }
  let station = "", obs = null;
  try {
    station = (await getJson(p.observationStations)).features?.[0]?.properties?.stationIdentifier || "";
    if (station) obs = (await getJson(`${c.base}/stations/${station}/observations/latest`)).properties || null;
  } catch { /* forecast alone is fine */ }
  const [daily, alerts] = await Promise.all([
    getJson(p.forecast).catch(() => null),
    getJson(`${c.base}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`).catch(() => null),
  ]);
  const place = [p.relativeLocation?.properties?.city, p.relativeLocation?.properties?.state].filter(Boolean).join(", ");
  const data = {
    place, station, office: p.cwa || "", updatedAt: new Date().toISOString(),
    link: `https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`,
    now: obs ? {
      at: obs.timestamp, text: obs.textDescription || "", tempF: f(val(obs.temperature)), windMph: mph(val(obs.windSpeed), obs.windSpeed?.unitCode),
      windDir: compass(val(obs.windDirection)), gustMph: mph(val(obs.windGust), obs.windGust?.unitCode),
      humidity: val(obs.relativeHumidity) !== null ? Math.round(val(obs.relativeHumidity)) : null,
      dewF: f(val(obs.dewpoint)), visibilityMi: val(obs.visibility) !== null ? Math.round(val(obs.visibility) / 1609.34) : null,
    } : null,
    periods: (daily?.properties?.periods || []).slice(0, 14).map(x => ({
      name: x.name, start: x.startTime, isDaytime: x.isDaytime, tempF: x.temperature, wind: `${x.windDirection || ""} ${x.windSpeed || ""}`.trim(),
      pop: x.probabilityOfPrecipitation?.value ?? 0, short: x.shortForecast, detail: x.detailedForecast,
    })),
    alerts: (alerts?.features || []).map(a => a.properties || {}).filter(a => a.status !== "Test" && a.messageType !== "Cancel").slice(0, 6)
      .map(a => ({ event: a.event, severity: a.severity, headline: a.headline || "", ends: a.ends || a.expires || null, instruction: String(a.instruction || "").slice(0, 800) })),
  };
  pointCache.set(key, { at: Date.now(), data });
  return data;
}
