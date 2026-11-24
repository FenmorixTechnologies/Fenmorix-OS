// JotForm batch: every new form renders, uniform limits + progress, cascade hiding,
// any-of conditions, pool vehicle case + file upload, builder keeps steps/limits.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
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
const field = key => page.locator(`[data-field="${key}"]`);
const pick = async (key, option) => { await field(key).getByLabel(option, { exact: true }).check(); };
const body = async () => page.locator("body").innerText();

// ---- People
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
for (const [n, e] of [["Fred Floor", "fred"], ["Vera Viewer", "vera"]])
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;
await post("/api/forms/access", { userId: id("Vera Viewer"), formKeys: ["cad_update"] });

// ---- Fred sends a CAD update (nobody set to handle it yet)
await login("fred@sgfd.org");
await page.getByText("You haven't sent any forms").first().waitFor({ timeout: 8000 }).catch(() => {});
check("Your Day has a Your forms card", /YOUR FORMS/i.test(await body()) && /haven't sent any forms/.test(await body()));
await tile("Forms");
check("no Submissions tab without access", await page.getByRole("button", { name: "Submissions", exact: true }).count() === 0);
await page.getByRole("button", { name: "Open CAD Update" }).click(); await settle();
await pick("topic", "Access information");
await L("Address").fill("123 Main St");
await pick("access_type", "Gate code");
await L("Details").fill("Gate 4321");
await page.getByRole("button", { name: "Submit" }).click(); await settle();
await home();
check("Your Day lists the CAD update as submitted, not assigned", /CAD Update/.test(await body()) && /Submitted/.test(await body()) && /not assigned yet/.test(await body()));
await page.getByText("CAD Update", { exact: true }).first().click(); await settle();
check("clicking it opens the submission", /Gate 4321/.test(await body()) && /Progress/i.test(await body()));
await page.getByRole("button", { name: "‹ Back" }).click(); await settle();
await page.getByRole("button", { name: "My submissions", exact: true }).click(); await settle();
check("My submissions shows status and the not-assigned hint", /not assigned to anyone yet/.test(await body()));

// ---- Mike (master) gets it as a fallback, and can find it under Submissions
await login("mike@sgfd.org");
let inbox = (await api("/api/forms/inbox")).body;
check("unassigned form goes to master's Waiting list", inbox.toReview.some(s => s.formKey === "cad_update" && s.unassigned));
await tile("Forms");
await page.getByRole("button", { name: /Waiting for me/ }).click(); await settle();
check("Waiting explains no one handles it", /no one handles this form yet/.test(await body()));
await page.getByRole("button", { name: "Submissions", exact: true }).click(); await settle();
check("Submissions tab lists it", /CAD Update/.test(await body()) && /Fred Floor/.test(await body()));
await page.getByLabel("Filter by form").selectOption("CAD Update");
check("filter by form", /1 submission\b/.test(await body()));
await page.getByRole("button", { name: /Open CAD Update from Fred Floor/ }).click(); await settle();
await page.getByLabel("Progress step").selectOption("Entered in CAD");
await page.getByRole("button", { name: "Update" }).click(); await settle();
check("master marks it entered", /Entered in CAD ·/.test(await body()));
check("finished, so it leaves master's Waiting list", !(await api("/api/forms/inbox")).body.toReview.some(s => s.formKey === "cad_update"));

// ---- Vera has view access to CAD updates: Submissions tab, read the update
await login("vera@sgfd.org");
await tile("Forms");
check("viewer gets the Submissions tab", await page.getByRole("button", { name: "Submissions", exact: true }).count() === 1);
await page.getByRole("button", { name: "Submissions", exact: true }).click(); await settle();
check("viewer sees the CAD update", /CAD Update/.test(await body()) && /Entered in CAD/.test(await body()));

// ---- Fred is told and the card clears
await login("fred@sgfd.org");
await page.getByText("CAD Update: Entered in CAD").first().waitFor({ timeout: 8000 }).catch(() => {});
check("Your Day shows Entered in CAD update", /CAD Update: Entered in CAD/.test(await body()));
check("finished form no longer in progress on the card", /Nothing in progress/.test(await body()));

// ---- CAD flag codes are encrypted and masked for the sender
await login("fred@sgfd.org");
let rr = await post("/api/forms/submit", { formKey: "cad_flag", data: { name: "Fred Floor", date: "2026-10-29", address: "9 Oak Ln", jurisdiction: "Central", requesting_party: "HOA", change_type: "Gate code update", info: "Gate 4455#" } });
check("CAD flag code update accepted", rr.status === 200, JSON.stringify(rr.body));
const flagId = rr.body.id;
const fredView = (await api(`/api/forms/submissions/${flagId}`)).body.submission.data.info;
check("sender sees the code masked", fredView && fredView !== "Gate 4455#", fredView);
rr = await post("/api/forms/submit", { formKey: "cad_flag", data: { name: "Fred Floor", date: "2026-10-29", address: "9 Oak Ln", jurisdiction: "Central", requesting_party: "HOA", change_type: "Remove flag/caution note" } });
check("removing a flag needs which flag", rr.status === 400 && /Flag to be removed/.test(rr.body.error), JSON.stringify(rr.body));
rr = await post("/api/forms/submit", { formKey: "gis_issue", data: { name: "Fred Floor", date: "2026-10-29", address: "1 Main", jurisdiction: "St. George", issue_type: "Incorrect cross street", cad_cross: "Oak/Elm", correct_cross: "Oak/Pine" } });
check("GIS cross street issue accepted", rr.status === 200, JSON.stringify(rr.body));
await login("mike@sgfd.org");
check("handler sees the full code", (await api(`/api/forms/submissions/${flagId}`)).body.submission.data.info === "Gate 4455#");

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
