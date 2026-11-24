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
for (const [n, e] of [["Fred Floor", "fred"], ["Liz Lea", "liz"], ["Wendy Witness", "wendy"]])
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;

// ---- Every new form opens and prints without errors
const defs = (await api("/api/forms/definitions")).body.definitions;
const NEW = ["gis_issue", "premise_update", "cad_flag", "medical_incident", "uniform_request", "station_supply", "facility_request", "pool_vehicle", "it_reset", "cad_update", "employee_info_change", "exec_physical",
  "exceptional_performance", "officer_courses", "probationary_eval", "lateral_eval", "operator_pumper", "operator_aerial", "operator_confirmation",
  "scba_performance", "preceptee_feedback", "plan_of_action", "safety_concern", "accident_damage", "smoke_alarm", "exposure_report", "near_miss", "incident_statement"];
check("all 30 new forms seeded", ["pool_vehicle_return", "incident_review", ...NEW].every(k => defs.some(d => d.key === k)), defs.length + " forms");
await tile("Forms");
let opened = 0;
for (const k of NEW) {
  const d = defs.find(x => x.key === k);
  await page.getByRole("button", { name: "All forms", exact: true }).click();
  await page.getByRole("button", { name: `Open ${d.title}` }).click(); await settle();
  const ok = (await page.getByText(d.title, { exact: true }).count()) > 0;
  await page.getByRole("button", { name: "Print / save as PDF" }).click(); await page.waitForTimeout(250);
  const printed = await page.frameLocator("#print-frame").locator("body").innerText().catch(() => "");
  if (ok && printed.includes(d.title)) opened++; else check(`opens and prints: ${d.title}`, false, printed.slice(0, 80));
  await page.getByRole("button", { name: "Cancel" }).click(); await settle();
}
check("every new form opens and prints", opened === NEW.length, `${opened}/${NEW.length}`);
check("categories shown", /UNIFORMS & SUPPLIES/i.test(await body()) && /TRAINING & EVALUATIONS/i.test(await body()) && /COMMUNITY/i.test(await body()));

// ---- Mike makes Liz the uniform handler (through the builder API, keeping steps and limits)
const uni = defs.find(d => d.key === "uniform_request");
let r = await post("/api/forms/definitions", { id: uni.id, title: uni.title, category: uni.category, description: uni.description, fields: uni.fields,
  settings: { ...uni.settings, recipients: [id("Liz Lea")] }, active: true, sort: uni.sort });
const uni2 = (await api("/api/forms/definitions")).body.definitions.find(d => d.key === "uniform_request");
check("saving the form keeps progress steps and limits", r.status === 200 && uni2.settings.stages.length === 3 && uni2.settings.limits.length === 4 && uni2.settings.recipients[0] === id("Liz Lea"), JSON.stringify(r.body).slice(0, 120));

// builder shows the steps editor
await page.getByRole("button", { name: "Manage forms", exact: true }).click(); await settle();
await page.getByRole("button", { name: "Edit Uniform Request" }).click(); await settle();
check("builder lists progress steps", (await page.getByRole("textbox", { name: "Step 2" }).inputValue()) === "Ready for pickup" && /Yearly limits shown/.test(await body()));
await page.getByRole("button", { name: "‹ All forms" }).click(); await settle();

// ---- Fred orders uniforms
await login("fred@sgfd.org");
await tile("Forms");
await page.getByRole("button", { name: "Open Uniform Request" }).click(); await settle();
check("limits panel starts at zero", /Shirts: 0 of 5/.test(await body()) && /Pants: 0 of 3/.test(await body()), (await body()).match(/Your yearly limits[\s\S]{0,200}/)?.[0]);
check("no item questions until an item is checked", await field("navy_tee_qty").count() === 0);
await pick("items", "Navy T-shirt (cotton)");
await pick("items", "Class A blue shirt");
await field("navy_tee_qty").locator("select").selectOption("3");
await field("navy_tee_size").locator("select").selectOption("L");
await field("class_a_shirt_neck").locator("select").selectOption("16.5");
await field("class_a_shirt_sleeve").locator("select").selectOption("34");
await page.locator("[data-field='position'] select").selectOption("Firefighter");
await L("Phone").fill("225-555-0101");
check("limits count this request", /Shirts: 4 of 5 \(4 on this request\)/.test(await body()));
await pick("items", "White shirt");
await field("white_shirt_qty").locator("select").selectOption("2");
await field("white_shirt_neck").locator("select").selectOption("16");
check("over the limit shows a warning", /Shirts: 6 of 5/.test(await body()) && /goes over a yearly limit/.test(await body()));
await field("items").getByLabel("White shirt", { exact: true }).uncheck();
check("unchecking hides its questions and clears the warning", await field("white_shirt_qty").count() === 0 && !/goes over a yearly limit/.test(await body()));
await page.getByRole("button", { name: "Submit" }).click(); await settle();
check("uniform request submitted", /Submitted/.test(await body()) && /Navy T-shirt/.test(await body()));
check("progress panel shows the steps to Fred", /Progress/i.test(await body()) && /Ready for pickup/.test(await body()) && await page.getByLabel("Progress step").count() === 0);
let mine = (await api("/api/forms/inbox")).body.mine;
const uniformId = mine.find(s => s.formKey === "uniform_request").id;
const stored = (await api(`/api/forms/submissions/${uniformId}`)).body.submission.data;
check("only checked items are stored", stored.navy_tee_qty === "3" && !("white_shirt_qty" in stored) && !("white_shirt_neck" in stored), JSON.stringify(stored).slice(0, 200));
r = await api("/api/forms/limits/uniform_request");
check("server counts this year's orders", r.body.limits.find(l => l.label === "Shirts").used === 4, JSON.stringify(r.body));

// ---- Liz handles it
await login("liz@sgfd.org");
r = (await api("/api/forms/inbox")).body;
check("Liz sees the request waiting", r.toReview.some(s => s.id === uniformId));
await tile("Forms");
await page.getByRole("button", { name: /Waiting for me/ }).click(); await settle();
await page.getByText("Uniform Request", { exact: true }).first().click(); await settle();
await page.getByLabel("Progress step").selectOption("Ready for pickup");
await page.getByLabel("Progress note").fill("At the HQ front desk");
await page.getByRole("button", { name: "Update" }).click(); await settle();
check("Liz sets Ready for pickup", /Ready for pickup ·/.test(await body()) && /At the HQ front desk/.test(await body()));
check("still in Liz's list until picked up", (await api("/api/forms/inbox")).body.toReview.some(s => s.id === uniformId));
r = await post(`/api/forms/submissions/${uniformId}/stage`, { stage: "Shipped" });
check("unknown step rejected", r.status === 400);

// ---- Fred is told
await login("fred@sgfd.org");
await page.getByText("Uniform Request: Ready for pickup").first().waitFor({ timeout: 8000 }).catch(() => {});
check("Your Day shows the pickup", /Uniform Request: Ready for pickup/.test(await body()));
await page.getByRole("button", { name: "View" }).first().click(); await settle();
check("View opens the Waiting tab with the update", /Updates on your forms/i.test(await body()));
await page.getByText("Uniform Request: Ready for pickup").first().click(); await settle();
check("Fred sees the note", /At the HQ front desk/.test(await body()));
check("viewing clears the update", (await api("/api/forms/inbox")).body.updates.length === 0);
r = await post(`/api/forms/submissions/${uniformId}/stage`, { stage: "Picked up" });
check("Fred can't change progress", r.status === 403);

await login("liz@sgfd.org");
r = await post(`/api/forms/submissions/${uniformId}/stage`, { stage: "Picked up" });
check("Picked up finishes it for Liz", r.status === 200 && !(await api("/api/forms/inbox")).body.toReview.some(s => s.id === uniformId));
await login("fred@sgfd.org");
check("Picked up doesn't notify (not marked Tell them)", (await api("/api/forms/inbox")).body.updates.length === 0);

// ---- Station supply: hidden questions under a hidden question stay hidden
await tile("Forms");
await page.getByRole("button", { name: "Open Station Supply Order" }).click(); await settle();
await page.locator("[data-field='station'] select").selectOption("61");
await page.locator("[data-field='shift'] select").selectOption("B");
await pick("status", "We are placing our order below");
await pick("items", "Bleach (1 gallon)");
check("item quantity appears with its par level", await field("bleach_qty").count() === 1 && /Keep 2 per truck/.test(await field("bleach_qty").innerText()));
await pick("status", "We do NOT need any supplies this week");
check("switching to no order hides items and their quantities", await field("items").count() === 0 && await field("bleach_qty").count() === 0);
await page.getByRole("button", { name: "Submit" }).click(); await settle();
check("no-order submits without the hidden required questions", /Submitted/.test(await body()), (await page.getByRole("alert").allInnerTexts()).join(" "));
// and the server ignores a hidden quantity sent anyway
r = await post("/api/forms/submit", { formKey: "station_supply", data: { order_date: "2026-10-25", station: "61", shift: "B", name: "Fred Floor", status: "We do NOT need any supplies this week", items: ["Bleach (1 gallon)"], bleach_qty: 4 } });
const s2 = (await api(`/api/forms/submissions/${r.body.id}`)).body.submission.data;
check("server drops answers under hidden questions", r.status === 200 && !("items" in s2) && !("bleach_qty" in s2), JSON.stringify(s2));

// ---- Facility: "any of" condition
await home(); await tile("Forms");
await page.getByRole("button", { name: "Open Facility & Resource Request" }).click(); await settle();
check("division pre-filled", (await L("Division making the request").inputValue()) === "Suppression");
check("explain hidden at first", await field("apparatus_explain").count() === 0);
await pick("facilities", "Props");
check("explain shows for Props", await field("apparatus_explain").count() === 1);
await field("facilities").getByLabel("Props", { exact: true }).uncheck();
await pick("facilities", "Pavilion");
check("explain hidden for Pavilion", await field("apparatus_explain").count() === 0);
await page.getByRole("button", { name: "Cancel" }).click(); await settle();

// ---- Pool vehicle: approval + return task with a photo
await page.getByRole("button", { name: "Open Pool Vehicle Checkout" }).click(); await settle();
await page.locator("[data-field='division'] select").selectOption("Operations");
await L("Rank / position").fill("Firefighter");
await L("Phone").fill("225-555-0101");
await L("Requested vehicle").fill("Tahoe 12");
await L("Date of departure").fill("2026-11-02");
await L("Expected return date").fill("2026-11-04");
await L("Reason for vehicle use").fill("State conference");
await pick("out_of_state", "Yes");
check("out-of-state questions appear", await field("states").count() === 1 && await field("ack_out").count() === 1);
await pick("out_of_state", "No");
await page.getByLabel(/^Add to Supervisor and Special Services/).selectOption({ label: "Liz Lea — Suppression" });
await page.getByRole("button", { name: "Submit" }).click(); await settle();
check("checkout submitted and opens a case", /Pool vehicle — Fred Floor/.test(await body()) || /Vehicle return/.test(await body()), (await body()).slice(0, 300));
r = (await api("/api/forms/inbox")).body;
const task = r.tasks.find(t => /Vehicle return/.test(t.label));
check("Fred has the return task", !!task);
await page.goto(BASE); await settle();
check("Your Day lists the return form", /waiting for you to fill out/.test(await body()));
await tile("Forms");
await page.getByRole("button", { name: /Waiting for me/ }).click(); await settle();
await page.getByRole("button", { name: /Vehicle return/ }).click(); await settle();
await L("Return mileage").fill("40210");
await pick("full_tank", "Yes"); await pick("washed", "Yes"); await pick("damage", "Yes");
await L("Describe the damage").fill("Scratch on rear bumper");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await field("photos").locator("input[type=file]").setInputFiles({ name: "bumper.png", mimeType: "image/png", buffer: png });
await page.waitForTimeout(800);
check("photo uploaded and listed", /bumper\.png/.test(await field("photos").innerText()));
await page.getByRole("button", { name: "Submit" }).click(); await settle();
const returnSub = (await api("/api/forms/inbox")).body.mine.find(s => s.formKey === "pool_vehicle_return");
const rs = (await api(`/api/forms/submissions/${returnSub.id}`)).body.submission;
const fileId = rs.data.photos?.[0]?.id;
check("return stored with the photo", rs.data.photos?.[0]?.name === "bumper.png" && !!fileId, JSON.stringify(rs.data.photos));
r = await api(`/api/forms/files/${fileId}`);
check("Fred can open his photo", r.status === 200 && r.ct.startsWith("image/png") && r.body.size === png.length, `${r.status} ${r.ct} ${r.body.size} vs ${png.length}`);
// a file uploaded by someone else can't be attached
const wendyFile = await (async () => { await login("wendy@sgfd.org"); return (await post("/api/forms/files", { name: "x.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` })).body.id; })();
r = await api(`/api/forms/files/${fileId}`);
check("Wendy can't open Fred's photo", r.status === 403);
await login("fred@sgfd.org");
r = await post("/api/forms/submit", { formKey: "scba_performance", data: { test_date: "2026-10-28", name: "Fred Floor", bp_before: "120/80", bp_after: "130/85", leaderboard: "My name is OK", attachment: [{ id: wendyFile }] } });
check("can't attach someone else's upload", r.status === 400 && /attached file/.test(r.body.error), JSON.stringify(r.body));
await login("mike@sgfd.org");
r = await api(`/api/forms/files/${fileId}`);
check("master can open the photo", r.status === 200);
r = await post("/api/forms/files", { name: "big.bin", dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(11 * 1024 * 1024).toString("base64")}` });
check("files over 10 MB rejected", r.status === 400);

// ---- SCBA sensitive answers are masked for the participant
r = await post("/api/forms/submit", { formKey: "scba_performance", subjectId: id("Fred Floor"), data: { test_date: "2026-10-28", name: "Fred Floor", bp_before: "120/80", bp_after: "130/85", leaderboard: "My name is OK" } });
const scbaId = r.body.id;
check("master sees blood pressure", (await api(`/api/forms/submissions/${scbaId}`)).body.submission.data.bp_before === "120/80");

// ---- Near miss: anonymous, name only if they agree to contact
await login("wendy@sgfd.org");
r = await post("/api/forms/submit", { formKey: "near_miss", data: { what: "Slipped on wet bay floor", could_have: "Head injury", contact_ok: true } });
check("contact OK makes name required", r.status === 400 && /Name/.test(r.body.error), JSON.stringify(r.body));
r = await post("/api/forms/submit", { formKey: "near_miss", data: { what: "Slipped on wet bay floor", could_have: "Head injury" } });
check("anonymous near miss accepted", r.status === 200);
await login("mike@sgfd.org");
const nm = (await api(`/api/forms/submissions/${r.body.id}`)).body.submission;
check("near miss has no submitter", nm.anonymous === true && !nm.submittedByName);

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
