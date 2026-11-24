// Live spot prices (module "spot", opt-in): gold, silver, platinum and palladium per troy ounce in US dollars.
// The server checks the price source every SPOT_REFRESH_SECONDS (one request for everyone, so screens never use up the data plan),
// keeps the latest in memory and one row per metal per check in spot_points (35 days: today's chart, week, month).
//
// .env:
//   SPOT_PROVIDER = nfusion | metalpriceapi | demo     (blank: demo on a sandbox, otherwise off until set)
//   SPOT_API_KEY  = the provider's key / token          (a secret: never shown in Server settings)
//   SPOT_API_URL  = nFusion's spot summary address, if theirs differs (default below; confirm with nFusion when the account is set up)
//   SPOT_REFRESH_SECONDS = 60                            (weekends, when markets are closed: every 30 minutes)
//   SPOT_TEST_FILE = JSON for tests: {"gold": {"bid": 1, "ask": 2, "change": 0.5, "changePct": 0.1}, ...}
//
// Routes (any signed-in user; module on):
//   GET /api/spot                       {provider, label, at, stale, refreshSeconds, metals: [{metal, name, price, bid, ask, change, changePct, high, low}], error?}
//   GET /api/spot/history?metal=&range= day | week | month -> {points: [{t, p}]}
//   POST /api/spot/refresh              masters: check now (at most once a minute)
import fs from "node:fs";
import { pool } from "./db.js";
import { isSandbox } from "./brand.js";

export const METALS = [
  { metal: "gold", name: "Gold", code: "XAU" }, { metal: "silver", name: "Silver", code: "XAG" },
  { metal: "platinum", name: "Platinum", code: "XPT" }, { metal: "palladium", name: "Palladium", code: "XPD" },
];
const NFUSION_URL = "https://api.nfusionsolutions.biz/api/v1/Metals/spot/summary";
const err = (status, message) => Object.assign(new Error(message), { status });
const num = v => { const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : Number(v); return Number.isFinite(n) ? n : null; };
const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function provider() {
  const p = String(process.env.SPOT_PROVIDER || "").trim().toLowerCase();
  if (process.env.SPOT_TEST_FILE) return "test";
  if (["nfusion", "metalpriceapi", "demo"].includes(p)) return p;
  return isSandbox() ? "demo" : "";
}
const LABEL = { nfusion: "nFusion Solutions", metalpriceapi: "MetalpriceAPI", demo: "Demo prices (made up)", test: "Test prices" };
export function refreshSeconds() {
  const base = Math.max(15, Number(process.env.SPOT_REFRESH_SECONDS) || 60);
  return marketClosed(new Date()) ? Math.max(base, 1800) : base;
}
// Metals trade nearly around the clock on weekdays; closed Friday 5 pm to Sunday 6 pm New York time.
export function marketClosed(d) {
  const ny = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay(), h = ny.getHours();
  return day === 6 || (day === 5 && h >= 17) || (day === 0 && h < 18);
}

// ---- Price sources -----------------------------------------------------------------------------------------------------
async function getJson(url, ms = 12_000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json", "User-Agent": "Fenmorix OS spot prices" } });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw new Error(`The price source answered ${r.status} without data.`); }
    if (r.status === 401 || r.status === 403) throw new Error("The price source refused the key (check SPOT_API_KEY).");
    if (!r.ok) throw new Error(`The price source answered ${r.status}.`);
    return j;
  } catch (e) { throw e.name === "AbortError" ? new Error("The price source didn't answer in time.") : e; }
  finally { clearTimeout(t); }
}
// nFusion: an array (or {data: [...]}) of {requestedSymbol: "gold", data: {bid, ask, high, low, oneDayChange, oneDayPercentChange, ...}}.
// Field names are matched loosely, since the exact names come with the account; parseNfusion is tested on the common shapes.
export function parseNfusion(j) {
  const list = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.results) ? j.results : [];
  const out = {};
  for (const item of list) {
    const d = item?.data && typeof item.data === "object" ? { ...item, ...item.data } : item || {};
    const low = Object.fromEntries(Object.entries(d).map(([k, v]) => [k.toLowerCase(), v]));
    const name = String(low.requestedsymbol || low.metal || low.symbol || low.name || "").toLowerCase();
    const m = METALS.find(x => name.includes(x.metal) || name.startsWith(x.code.toLowerCase()));
    if (!m) continue;
    const pick = (...keys) => { for (const k of keys) { const v = num(low[k]); if (v != null) return v; } return null; };
    const bid = pick("bid"), ask = pick("ask");
    out[m.metal] = { bid, ask, price: pick("last", "price", "spot") ?? (bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask),
      change: pick("onedaychange", "change", "netchange", "daychange"), changePct: pick("onedaypercentchange", "changepercent", "percentchange", "changepct", "daypercentchange"),
      high: pick("high", "dayhigh"), low: pick("low", "daylow") };
  }
  return out;
}
// MetalpriceAPI: {success, rates: {USDXAU: price per ounce, XAU: ounces per dollar, ...}} (no bid/ask)
export function parseMetalprice(j) {
  if (j?.success === false) throw new Error(j.error?.info || "The price source refused the request.");
  const r = j?.rates || {}, out = {};
  for (const m of METALS) {
    const p = num(r[`USD${m.code}`]) ?? (num(r[m.code]) ? 1 / num(r[m.code]) : null);
    if (p != null) out[m.metal] = { price: p, bid: null, ask: null, change: null, changePct: null, high: null, low: null };
  }
  return out;
}
// Demo: a smooth made-up walk (the same for everyone at the same minute), clearly labeled on screen
export function demoPrices(t = Date.now()) {
  const base = { gold: 2650, silver: 31.2, platinum: 965, palladium: 1010 }, out = {};
  const minute = Math.floor(t / 60_000), day0 = Math.floor(t / 86_400_000) * 1440;
  const wave = (m, k) => Math.sin(m / (37 + k * 11)) * 0.006 + Math.sin(m / (233 + k * 29)) * 0.012 + Math.sin(m / 1931) * 0.02;
  METALS.forEach((x, k) => {
    const p = base[x.metal] * (1 + wave(minute, k)), open = base[x.metal] * (1 + wave(day0, k));
    const spread = x.metal === "silver" ? 0.25 : x.metal === "gold" ? 2 : 6;
    out[x.metal] = { price: p, bid: p - spread / 2, ask: p + spread / 2, change: p - open, changePct: ((p - open) / open) * 100, high: null, low: null };
  });
  return out;
}
async function fetchPrices() {
  const p = provider(), key = String(process.env.SPOT_API_KEY || "").trim();
  if (p === "test") return JSON.parse(fs.readFileSync(process.env.SPOT_TEST_FILE, "utf8"));
  if (p === "demo") return demoPrices();
  if (!key) throw new Error("SPOT_API_KEY isn't set (User Management › System › Server settings).");
  if (p === "nfusion") {
    const u = new URL(process.env.SPOT_API_URL || NFUSION_URL);
    u.searchParams.set("metals", METALS.map(m => m.metal).join(","));
    u.searchParams.set("currency", "USD"); u.searchParams.set("unitofmeasure", "toz"); u.searchParams.set("format", "json"); u.searchParams.set("token", key);
    return parseNfusion(await getJson(u));
  }
  if (p === "metalpriceapi") {
    const u = new URL(process.env.SPOT_API_URL || "https://api.metalpriceapi.com/v1/latest");
    u.searchParams.set("api_key", key); u.searchParams.set("base", "USD"); u.searchParams.set("currencies", METALS.map(m => m.code).join(","));
    return parseMetalprice(await getJson(u));
  }
  throw new Error("SPOT_PROVIDER isn't set.");
}

// ---- The latest prices and the loop ------------------------------------------------------------------------------------
let snap = { at: null, prices: {}, error: "", checkedAt: null };
let timer = null, lastManual = 0;
const localStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

async function refresh() {
  try {
    const got = await fetchPrices();
    const ok = METALS.filter(m => got[m.metal] && got[m.metal].price != null);
    if (!ok.length) throw new Error("The price source sent no prices.");
    const at = new Date();
    // Change since the first reading of the day when the source doesn't give one
    const opens = (await pool.query(`SELECT DISTINCT ON (metal) metal, price FROM spot_points WHERE at >= $1 ORDER BY metal, at`, [localStart()])).rows;
    const open = Object.fromEntries(opens.map(r => [r.metal, Number(r.price)]));
    const prices = {};
    for (const m of ok) {
      const x = got[m.metal], o = open[m.metal];
      const change = x.change ?? (o ? x.price - o : null), changePct = x.changePct ?? (o ? ((x.price - o) / o) * 100 : null);
      prices[m.metal] = { ...x, change, changePct };
      await pool.query(`INSERT INTO spot_points (at, metal, price, bid, ask) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [at, m.metal, round(x.price, 4), round(x.bid, 4), round(x.ask, 4)]);
    }
    snap = { at: at.toISOString(), prices, error: "", checkedAt: at.toISOString() };
    if (Math.random() < 0.02) await pool.query("DELETE FROM spot_points WHERE at < now() - interval '35 days'");
  } catch (e) {
    snap = { ...snap, error: e.message, checkedAt: new Date().toISOString() };
    console.warn(`[Spot prices] ${e.message}`);
  }
}
export function startSpot() {
  if (!provider() || timer) return;
  const loop = async () => { await refresh(); timer = setTimeout(loop, refreshSeconds() * 1000); };
  loop();
}
export function spotState(forMaster = false) {
  const p = provider(), secs = refreshSeconds();
  const stale = !snap.at || Date.now() - new Date(snap.at) > Math.max(secs * 3, 300) * 1000;
  return {
    provider: p, label: LABEL[p] || "", configured: !!p, demo: p === "demo", at: snap.at, stale, marketClosed: marketClosed(new Date()), refreshSeconds: secs,
    metals: METALS.filter(m => snap.prices[m.metal]).map(m => {
      const x = snap.prices[m.metal];
      return { metal: m.metal, name: m.name, price: round(x.price), bid: round(x.bid), ask: round(x.ask), change: round(x.change), changePct: round(x.changePct, 2), high: round(x.high), low: round(x.low) };
    }),
    ...(snap.error ? { error: forMaster ? snap.error : "Spot prices can't be reached right now." } : {}),
  };
}
export async function spotHistory(metal, range) {
  if (!METALS.some(m => m.metal === metal)) throw err(400, "Which metal?");
  const since = range === "month" ? new Date(Date.now() - 31 * 86400e3) : range === "week" ? new Date(Date.now() - 7 * 86400e3) : localStart();
  // Day: every reading; week: one per 30 minutes; month: one per 3 hours
  const bucket = range === "month" ? 10800 : range === "week" ? 1800 : 0;
  const r = bucket
    ? await pool.query(`SELECT to_timestamp(floor(extract(epoch FROM at) / $3) * $3) AS t, avg(price) AS p FROM spot_points WHERE metal = $1 AND at >= $2 GROUP BY 1 ORDER BY 1`, [metal, since, bucket])
    : await pool.query(`SELECT at AS t, price AS p FROM spot_points WHERE metal = $1 AND at >= $2 ORDER BY at`, [metal, since]);
  return { metal, range: range || "day", points: r.rows.map(x => ({ t: new Date(x.t).toISOString(), p: round(Number(x.p)) })) };
}

export async function handleSpot(req, res, parts, user, send, url) {
  if (req.method === "GET" && !parts[2]) return send(res, 200, spotState(user.role === "master"));
  if (req.method === "GET" && parts[2] === "history") return send(res, 200, await spotHistory(url.searchParams.get("metal") || "gold", url.searchParams.get("range") || "day"));
  if (req.method === "POST" && parts[2] === "refresh") {
    if (user.role !== "master") throw err(403, "Only a master admin can check now.");
    if (Date.now() - lastManual < 60_000) throw err(429, "Checked less than a minute ago.");
    lastManual = Date.now();
    await refresh();
    return send(res, 200, spotState(true));
  }
  throw err(404, "Not found");
}
