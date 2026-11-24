// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(350); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) body = await res.json(); else { const b = new Uint8Array(await res.arrayBuffer()); body = { size: b.length }; }
    return { status: res.status, body, ct };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const L = label => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await L("Email").fill(email); await L("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
const body = async () => page.locator("body").innerText();
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Michael Neucere", email: "mike@sgfd.org", password: PW });
await login("mike@sgfd.org");
const w = (await api("/api/weather")).body;
check("weather loads", w.configured && !w.error && w.now, JSON.stringify(w).slice(0, 300));
check("temperature from the station, in F", w.now.tempF === 74 && w.now.feelsF === 78, `${w.now.tempF} feels ${w.now.feelsF}`);
check("wind in mph with compass direction and gusts", w.now.windMph === 11 && w.now.windDir === "SE" && w.now.gustMph === 24, JSON.stringify(w.now));
check("rain chance now and when it's likely", w.rain.now === 10 && w.rain.peak === 70 && !!w.rain.nextAt, JSON.stringify(w.rain));
check("12 hours ahead", w.hours.length === 12);
check("alerts sorted, severe first", w.alerts[0].event === "Severe Thunderstorm Warning" && w.alerts.length === 2);
const bar = page.getByRole("button", { name: /^Weather:/ });
await bar.waitFor({ timeout: 8000 });
const t = await bar.innerText();
check("Your Day shows the weather", /74°F/.test(t) && /feels 78°/.test(t) && /SE 11 mph/.test(t) && /gusts 24/.test(t) && /10% now · rain likely by/.test(t), t.replace(/\n/g, " | "));
check("warning pill shows", await page.getByRole("button", { name: /Severe Thunderstorm Warning until/ }).isVisible());
await page.setViewportSize({ width: 1500, height: 900 });
await page.screenshot({ path: "/home/claude/testrun/shot-weather.png", clip: { x: 268, y: 0, width: 1232, height: 330 } });
await bar.click(); await page.waitForTimeout(300);
check("click opens the next 12 hours", await page.getByRole("dialog", { name: "Next 12 hours" }).isVisible());
await page.screenshot({ path: "/home/claude/testrun/shot-weather-hours.png", clip: { x: 268, y: 0, width: 1232, height: 520 } });
await page.getByRole("button", { name: /Severe Thunderstorm Warning until/ }).click(); await page.waitForTimeout(300);
check("alert details", /interior room/.test(await page.getByRole("dialog", { name: "Weather alerts" }).innerText()));
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
