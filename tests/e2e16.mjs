// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
// Keep the CAD stand-in's calls recent (the server skips calls older than CAD_MAX_AGE_HOURS); it reads the file each refresh
{ const fs = await import("node:fs"); const f = "/home/claude/testrun/cad-mock.json"; const rows = JSON.parse(fs.readFileSync(f, "utf8"));
  const local = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 19); };
  rows.forEach((r, i) => { if ("received_at" in r) r.received_at = local(Date.now() - (60 - i * 10) * 60000); if (r.old_pending) r.time_received = local(Date.now() - 5 * 3600e3);
  if (r.long_running) r.time_received = local(Date.now() - 30 * 3600e3); if (r.twin) r.time_received = local(Date.now() - (60 - 10 - 2) * 60000); });
  fs.writeFileSync(f, JSON.stringify(rows, null, 1)); }
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
const MOCK = "/home/claude/testrun/cad-mock.json";
import fs from "node:fs";
const good = fs.readFileSync(MOCK, "utf8");

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: "Fred Floor", email: "fred@sgfd.org", division: "Technology", password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Technology" });

await post("/api/cad/refresh", {});
const a = (await api("/api/cad/active")).body;
check("CAD configured from test file", a.configured === true && !a.error, JSON.stringify(a).slice(0, 200));
check("closed call skipped, three active (one a 30-hour incident with units)", a.calls.length === 3 && a.calls[2].id === "505", JSON.stringify(a).slice(0, 400));
check("newest first", a.calls[0]?.id === "502" && a.calls[1].id === "501");
const sf = a.calls[1];
check("uppercase column names normalized", sf.type === "STRUCTURE FIRE" && sf.units.join("|") === "E61|L61|BC1" && sf.lat === 30.37 && sf.crossStreets.includes("Pecue"));
check("CentralSquare coordinates (millionths, unsigned) fixed", a.calls[0].lat === 30.383119 && a.calls[0].lon === -91.02172, JSON.stringify([a.calls[0].lat, a.calls[0].lon]));
await page.goto(BASE); await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Feed check" }).click(); await page.waitForTimeout(800);
const fc = await page.getByRole("region", { name: "CAD feed check" }).innerText();
check("master feed check lists columns and counts", /Columns in the view:.*incident_number/s.test(fc) && /Units column: units/.test(fc) && /7 rows read → 3 calls \(3 with units\), 1 closed skipped, 1 with no address left off, 1 waiting with no units too long left off, 1 second record at the same address shown with its call/.test(fc), fc.slice(0, 400));
check("no extra fields leak", Object.keys(sf).sort().join(",") === "address,agency,city,crossStreets,dispatchedAt,id,lat,lon,number,priority,receivedAt,status,type,unitStatus,units", Object.keys(sf).sort().join(","));
const md = a.calls[0];
check("second record at the same address joins the call", md.otherNumbers?.[0] === "2026-004514" && md.units.includes("EG653"), JSON.stringify(md));
check("per-unit status; call shows the furthest along", md.status === "Patient contact" && md.units.slice(0, 3).join("|") === "MD687|EG613|LD618"
  && md.unitStatus.slice(0, 3).map(u => u.status).join("|") === "Patient contact|On scene|Enroute" && md.agency === "St George FD" && sf.status === "ON SCENE", JSON.stringify(md));

await page.waitForTimeout(500);
const sec = page.getByRole("region", { name: "Active calls" });
await sec.waitFor({ timeout: 5000 });
const t = await sec.innerText();
check("Your Day shows Active calls", /STRUCTURE FIRE/.test(t) && /MEDICAL/.test(t) && /E61/.test(t) && /14100 AIRLINE HWY, Baton Rouge/.test(t), t.slice(0, 200));
check("calls list scrolls (about 4 tall)", await sec.getByRole("list", { name: "Calls" }).evaluate(e => getComputedStyle(e).overflowY === "auto" && getComputedStyle(e).maxHeight === "400px"));
check("unit chips show each unit's status", /MD687 · Patient contact/.test(t) && /LD618 · Enroute/.test(t) && /St George FD/.test(t), t.slice(0, 500));
check("map link uses coordinates", (await sec.locator("a").nth(1).getAttribute("href")).includes("30.37,-91.03"));
check("new-call ding off by default", /New-call ding off/.test(t));
await page.screenshot({ path: "/home/claude/testrun/shot-calls.png", fullPage: false });

// Hide widgets still shows calls
await page.getByRole("button", { name: "Hide widgets" }).click(); await settle();
check("calls stay when widgets hidden", await sec.isVisible());
await page.getByRole("button", { name: "Show widgets" }).click();

// Broken source: master sees the reason, others a generic message
fs.writeFileSync(MOCK, "{not json");
const r = await post("/api/cad/refresh", {});
check("refresh is master-only and reports error", r.status === 200 && !!r.body.error);
const m = (await api("/api/cad/active")).body;
check("master sees detail, last calls kept", m.error && m.error !== "Active calls can't be reached right now." && m.calls.length === 3);
await login("fred@sgfd.org");
const f = (await api("/api/cad/active")).body;
check("user sees generic error", f.error === "Active calls can't be reached right now.");
check("user can't force refresh", (await post("/api/cad/refresh", {})).status === 403);
fs.writeFileSync(MOCK, good);
await page.waitForTimeout(21000);
const f2 = (await api("/api/cad/active")).body;
check("recovers on next poll", !f2.error && f2.calls.length === 3);

check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
