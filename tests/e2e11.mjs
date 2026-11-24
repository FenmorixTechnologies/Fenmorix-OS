// Forms: injury case end to end, privacy, approvals, reviews, LWC-1007 PDF, builder, anonymous
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
    if (ct.includes("json")) body = await res.json(); else { const b = new Uint8Array(await res.arrayBuffer()); body = { size: b.length, head: String.fromCharCode(...b.slice(0, 5)) }; }
    return { status: res.status, body, ct };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await L("Email").fill(email); await L("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };
const home = async () => { await page.getByText("Main menu", { exact: true }).first().click(); await settle(); };
async function sign(label) {
  const pad = page.getByRole("img", { name: label });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 60); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 20 + i * 18, box.y + 60 + (i % 2 ? -18 : 18));
  await page.mouse.up(); await page.waitForTimeout(150);
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const L = label => page.getByLabel(new RegExp(`^${esc(label)}( \\*)?$`));
const yes = async (label, v = "Yes") => { await page.locator("[data-field]").filter({ has: page.locator("label, [id$='-l']", { hasText: new RegExp(`^${esc(label)}( \\*)?$`) }) }).first().getByLabel(v, { exact: true }).check(); };
const fill = async (label, value) => { await L(label).fill(value); };

// ---- People
await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [["Fred Floor", "fred"], ["Sam Sup", "sam"], ["Wendy Witness", "wendy"], ["Sally Safety", "sally"], ["Carl Chief", "carl"]];
for (const [n, e] of people) await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: a.name === "Carl Chief" ? "fire_chief" : "user", division: "Suppression" });
let roster = await read("roster");
const id = n => roster.find(u => u.name === n).id;

// ---- Mike sets up the injury form in the builder
check("main menu: Forms and Personnel File tiles, no Certifications tile",
  await page.getByText("Forms", { exact: true }).count() >= 1 && await page.getByText("Personnel File", { exact: true }).count() === 1 && await page.locator(".sgfd-tile", { hasText: /^Certifications/ }).count() === 0);
await tile("Forms");
check("catalog groups seed forms", await page.getByRole("button", { name: "Open Injury / Illness Report" }).count() === 1 &&
  await page.getByRole("button", { name: "Open Communications Leave Request" }).count() === 1 &&
  await page.getByRole("button", { name: "Open Witness Statement" }).count() === 0);
await page.getByRole("button", { name: "Manage forms", exact: true }).click();
await page.getByRole("button", { name: "Edit Injury / Illness Report" }).click(); await settle();
await L("Add to Required recipients").selectOption({ label: "Carl Chief — Suppression" });
await L("Add to Safety officer report").selectOption({ label: "Sally Safety — Suppression" });
await L("Add to Employer report (LWC-WC-1007)").selectOption({ label: "Sally Safety — Suppression" });
await L("Add to Can see all submissions").selectOption({ label: "Sally Safety — Suppression" }); await settle();
await page.getByRole("button", { name: "Save form" }).click(); await settle();
let defs = (await api("/api/forms/definitions")).body.definitions;
let inj = defs.find(d => d.key === "injury_initial");
check("builder saved recipients and case assignees", JSON.stringify(inj.settings.recipients) === JSON.stringify([id("Carl Chief")]) &&
  JSON.stringify(inj.settings.case.followUps.find(f => f.form === "injury_safety").users) === JSON.stringify([id("Sally Safety")]));
check("builder saved form access", (await api("/api/forms/access")).body.access.some(a => a.userId === id("Sally Safety") && a.formKey === "injury_initial"));
// District defaults for the 1007, set once
const d1007 = defs.find(d => d.key === "injury_1007");
await post("/api/forms/definitions", { ...d1007, fields: d1007.fields.map(f => f.key === "employer_address" ? { ...f, default: "14100 Airline Hwy, Baton Rouge LA 70817" } : f.key === "employer_phone" ? { ...f, default: "(225) 555-0100" } : f), settings: d1007.settings });

// ---- Fred files the injury report through the screen
await login("fred@sgfd.org");
await tile("Forms");
await page.getByRole("button", { name: "Open Injury / Illness Report" }).click(); await settle();
check("name pre-filled from account", (await L("Name").inputValue()) === "Fred Floor");
check("email pre-filled", (await L("Email").inputValue()) === "fred@sgfd.org");
check("witness question hidden until 'Yes'", await page.getByText("Witnesses on the roster").count() === 0);
await page.getByRole("button", { name: "Submit" }).click(); await settle();
check("missing answers are flagged", await page.getByRole("alert").filter({ hasText: "highlighted items" }).count() === 1);
await fill("Date of birth", "1990-01-02");
await L("Social Security number").fill("123456789");
check("SSN formats as typed", (await L("Social Security number").inputValue()) === "123-45-6789");
await fill("Home address: street", "1 Main St"); await fill("Home address: city", "Baton Rouge"); await fill("Home address: state", "LA"); await fill("Home address: zip", "70810");
await fill("Phone", "(225) 555-1111"); await fill("Job title", "Firefighter");
await fill("Hire date", "2015-03-02"); await fill("Admin / station assigned", "Station 65"); await fill("Last day worked at SGFD", "2026-10-20");
await yes("Has the employee returned to work?", "No");
check("return date hidden when 'No'", await page.getByText("Date returned to work").count() === 0);
await fill("Date of injury/illness", "2026-10-20"); await fill("Time of injury/illness", "15:45");
await page.locator("[data-field='injury_or_illness']").getByLabel("Injury", { exact: true }).check();
await fill("Part of body affected", "Right knee");
await yes("Did it occur on SGFD time?"); await fill("Where did it happen?", "2113 Anne Marie Dr");
await yes("Were there any witnesses?");
await L("Add to Witnesses on the roster").selectOption({ label: "Wendy Witness — Suppression" });
await fill("Equipment, materials or chemicals involved", "1-3/4 hose line");
await fill("What work was being done?", "Interior attack");
await fill("Describe how it happened", "Slipped on a wet stair tread");
await fill("Safeguards or safety equipment provided / used", "Full PPE");
await yes("Was a drug screen performed?", "No");
await fill("Initial medical care provided by", "Medic 5");
await L("Supervisor").selectOption({ label: "Sam Sup — Suppression" });
await sign("Signature of the person completing this report");
await page.getByRole("button", { name: "Submit" }).click(); await settle();
let body = await page.locator("body").innerText();
check("submitting opens the case", /Injury\/Illness — Fred Floor, Oct 20, 2026/.test(body), body.slice(0, 200).replace(/\n/g, " | "));
check("Fred sees only his own task in the case", /Injury questionnaire/.test(body) && !/Supervisor statement/.test(body) && !/Witness statement/.test(body));
const cases = (await api("/api/forms/cases")).body.cases;
if (!cases.length) { console.log(results.join("\n")); console.log("ALERT:", await page.getByRole("alert").allInnerTexts()); await page.screenshot({ path: "/home/claude/testrun/dbg.png", fullPage: true }); process.exit(1); }
const caseId = cases[0].id;
const fredSub = (await api(`/api/forms/submissions?subject=${id("Fred Floor")}`)).body.submissions.find(s => s.formKey === "injury_initial");
const fredView = (await api(`/api/forms/submissions/${fredSub.id}`)).body.submission;
check("Fred's own SSN is masked to him", fredView.data.ssn === "***-**-6789" && fredView.data.dob === "Hidden");
check("signature stored as image", /^data:image\/png;base64,/.test(fredView.data.signature || ""));

// ---- Sam: Your Day -> fill supervisor statement
await login("sam@sgfd.org");
let status = await page.locator("[role=status]").innerText();
check("Sam's day: a form to fill out", /1 form is waiting for you to fill out\.\s*Supervisor statement/.test(status), status.replace(/\n/g, " | "));
await page.getByRole("button", { name: "Fill out", exact: true }).click(); await settle();
await page.getByRole("button", { name: "Supervisor statement" }).click(); await settle();
check("statement pre-filled from the case", (await L("Injured/sick employee").inputValue()) === "Fred Floor" &&
  (await L("Where did the injury/incident occur?").inputValue()) === "2113 Anne Marie Dr" &&
  (await L("Supervisor name").inputValue()) === "Sam Sup");
await fill("Reported by", "Fred Floor"); await fill("When reported", "10/20 16:00");
await fill("Describe what you witnessed or were told. Please describe the accident in detail.", "Told by member at scene");
await yes("Were there any witnesses?"); await fill("If yes, who?", "Wendy");
await yes("Did the employee seek medical attention?"); await fill("If yes, where?", "OLOL");
await yes("Do you believe this injury/illness is NOT job related?", "No");
await yes("Did the employee miss work due to the injury?"); await yes("Has the employee returned to work?", "No");
await page.locator("[data-field='acknowledge'] input").check();
await sign("Signature");
await page.getByRole("button", { name: "Submit" }).click(); await settle();
const samBody = await page.locator("body").innerText();
check("Sam lands on his submitted statement", /Supervisor Injury\/Illness Statement/.test(samBody) && /Submitted by Sam Sup/.test(samBody) && !/don't have access/.test(samBody), samBody.slice(0, 160).replace(/\n/g, " | "));
check("Sam can't open Fred's initial report", (await api(`/api/forms/submissions/${fredSub.id}`)).status === 403);

// ---- Wendy can't see the case
await login("wendy@sgfd.org");
check("witness can't open the case", (await api(`/api/forms/cases/${caseId}`)).status === 403);

// ---- Carl (required recipient): review
await login("carl@sgfd.org");
status = await page.locator("[role=status]").innerText();
check("Carl's day: forms to review", /submitted forms? needs? your review/.test(status), status.replace(/\n/g, " | "));
await page.getByRole("button", { name: "Review forms" }).click(); await settle();
await page.getByText("Injury / Illness Report").first().click(); await settle();
check("recipient sees full SSN", /123-45-6789/.test(await page.locator("body").innerText()));
await page.getByRole("button", { name: "Mark reviewed" }).click(); await settle();
check("marked reviewed", /Reviewed by\s*Carl Chief/i.test(await page.locator("body").innerText()));
await page.evaluate(() => { window.print = () => {}; });
await page.getByRole("button", { name: "Print / save as PDF" }).click(); await page.waitForTimeout(500);
const printed = await page.frameLocator("#print-frame").locator("body").innerText().catch(() => "");
check("print layout has the form and answers", /Injury \/ Illness Report/.test(printed) && /Slipped on a wet stair tread/.test(printed) && /123-45-6789/.test(printed));
await page.getByRole("button", { name: "Part of a case: open the case ›" }).click(); await settle();
const carlCase = await page.locator("body").innerText();
check("recipient sees every part of the case", /Supervisor statement · Sam Sup/.test(carlCase) && /Witness statement · Wendy Witness/.test(carlCase), carlCase.slice(0, 400).replace(/\n/g, " | "));

// ---- Sally: the 1007, filled in from the case, downloaded as the official PDF
await login("sally@sgfd.org");
status = await page.locator("[role=status]").innerText();
check("Sally has two forms to fill (safety report + 1007)", /2 forms are waiting for you to fill out/.test(status), status.replace(/\n/g, " | "));
await page.getByRole("button", { name: "Fill out", exact: true }).click(); await settle();
await page.getByRole("button", { name: /Employer report \(LWC-WC-1007\)/ }).click(); await settle();
check("1007: SSN pre-filled for the safety officer", (await L("Employee Social Security number").inputValue()) === "123-45-6789");
check("1007: employer defaults filled", (await L("29. Employer's address and zip code").inputValue()) === "14100 Airline Hwy, Baton Rouge LA 70817");
check("1007: injury details carried over", (await L("22. What caused the injury to happen?").inputValue()) === "Slipped on a wet stair tread");
await page.locator("[data-field='purpose']").getByLabel("Medical only", { exact: true }).check();
await yes("19. Place of injury on employer's premises?", "No");
await page.getByRole("button", { name: "Submit" }).click(); await settle();
const sallySubs = (await api(`/api/forms/submissions?subject=${id("Fred Floor")}`)).body.submissions;
const s1007 = sallySubs.find(s => s.formKey === "injury_1007");
const pdf = await api(`/api/forms/submissions/${s1007.id}/pdf`);
check("official PDF downloads", pdf.status === 200 && pdf.ct === "application/pdf" && pdf.body.head === "%PDF-" && pdf.body.size > 50000, `${pdf.status} ${pdf.body.size}`);
await login("fred@sgfd.org");
check("Fred can't see the 1007", (await api(`/api/forms/submissions/${s1007.id}`)).status === 403);

// ---- Leave request with approval
await tile("Forms");
await page.getByRole("button", { name: "Open Communications Leave Request" }).click(); await settle();
await L("Employee number").fill("1234");
await L("Type of leave").selectOption("Shift Trade (SWAP)");
check("swap question appears for SWAP", await L("Trading shifts with").count() === 1);
await L("Trading shifts with").selectOption({ label: "Wendy Witness — Suppression" });
await fill("Date", "2026-11-14");
await page.locator("[data-field='time']").getByLabel("Other", { exact: true }).check();
await fill("Other time", "0700-1300");
await L("Add to Shift supervisor").selectOption({ label: "Sam Sup — Suppression" });
await page.getByRole("button", { name: "Print / save as PDF" }).click(); await page.waitForTimeout(600);
const fillPrint = await page.frameLocator("#print-frame").locator("body").innerText().catch(() => "");
check("fill screen prints answers so far, with boxes for choices", /Communications Leave Request/.test(fillPrint) && /1234/.test(fillPrint) && /☒ Other/.test(fillPrint) && /☐/.test(fillPrint), fillPrint.slice(0, 300));
await page.getByRole("button", { name: "Submit" }).click(); await settle();
check("leave request waiting for approval", /Waiting for approval/.test(await page.locator("body").innerText()));
await login("sam@sgfd.org");
status = await page.locator("[role=status]").innerText();
check("Sam's day: an approval", /1 form is waiting for your approval/.test(status));
await page.getByRole("button", { name: "Review", exact: true }).click(); await settle();
await page.getByText("Communications Leave Request").first().click(); await settle();
await page.getByRole("button", { name: "Approve" }).click(); await settle();
check("approved", /Approved/.test(await page.locator("body").innerText()));
await login("fred@sgfd.org");
await tile("Personnel File");
check("Fred's file lists his leave request as approved", /Communications Leave Request[\s\S]*Approved/i.test(await page.locator("body").innerText()));
check("Fred's file shows his injury case", await page.getByRole("button", { name: /Open case Injury\/Illness — Fred Floor/ }).count() === 1);
check("non-master sees only their own file", await L("Search people").count() === 0);
await page.getByRole("button", { name: "Profile", exact: true }).click();
await page.getByRole("button", { name: "Edit profile details" }).click();
await L("Employee number").fill("4321"); await L("Station").fill("Station 65");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
roster = await read("roster");
check("profile details saved", roster.find(u => u.name === "Fred Floor").employeeNumber === "4321");
await login("sam@sgfd.org");
roster = await read("roster");
check("others can't see private profile details", roster.find(u => u.name === "Fred Floor").employeeNumber === undefined && roster.find(u => u.name === "Fred Floor").station === "Station 65");

// ---- Builder: new anonymous form
await login("mike@sgfd.org");
await tile("Forms");
await page.getByRole("button", { name: "Manage forms", exact: true }).click();
await page.getByRole("button", { name: "+ New form" }).click(); await settle();
await L("Form title").fill("Anonymous Safety Concern");
await L("Section").fill("Safety");
await page.getByLabel(/Anonymous \(never records/).check();
await L("Add to Required recipients").selectOption({ label: "Carl Chief — Suppression" });
await page.getByRole("button", { name: "+ Question" }).click();
await L("Question text").fill("Describe the safety concern");
await L("Question type").selectOption("textarea");
await page.getByRole("checkbox", { name: "Required", exact: true }).check();
await page.getByRole("button", { name: "Done" }).click();
await page.getByRole("button", { name: "+ Question" }).click();
await L("Question text").fill("Station");
await L("Question type").selectOption("select");
await L("Choices").fill("Station 61\nStation 65\nAdmin");
await page.getByRole("button", { name: "Done" }).click();
await page.getByRole("button", { name: "Save form" }).click(); await settle();
defs = (await api("/api/forms/definitions")).body.definitions;
const anon = defs.find(d => d.title === "Anonymous Safety Concern");
check("new form saved with named questions", anon && anon.settings.anonymous && JSON.stringify(anon.fields.map(f => f.key)) === '["describe_the_safety_concern","station"]', JSON.stringify(anon && anon.fields.map(f => f.key)));
await login("wendy@sgfd.org");
await tile("Forms");
await page.getByRole("button", { name: "Open Anonymous Safety Concern" }).click(); await settle();
check("anonymous notice shown", await page.getByText("This form is anonymous", { exact: false }).count() === 1);
await fill("Describe the safety concern", "Frayed rope on Ladder 65");
await L("Station").selectOption("Station 65");
await page.getByRole("button", { name: "Submit" }).click(); await settle();
await login("carl@sgfd.org");
const anonList = (await api("/api/forms/inbox")).body.toReview.filter(s => s.formKey === anon.key);
const anonSub = (await api(`/api/forms/submissions/${anonList[0]?.id}`)).body.submission;
check("anonymous: no submitter recorded", anonSub && anonSub.anonymous === true && !anonSub.submittedById && anonSub.submittedByName === "");
await login("mike@sgfd.org");
const log = await read("audit-log");
check("audit: anonymous entry has no actor", log.some(e => e.action === "Submitted form" && /Anonymous Safety Concern/.test(e.detail) && e.actor === "Anonymous") && !log.some(e => /Anonymous Safety Concern/.test(e.detail) && e.actor === "Wendy Witness"));
check("audit: PDF download logged", log.some(e => e.action === "Downloaded filled PDF"));

// ---- Personnel File for a master
await tile("Personnel File");
await page.getByRole("button", { name: "Open file for Fred Floor" }).click(); await settle();
check("master sees Fred's case and leave request", /Injury\/Illness — Fred Floor/.test(await page.locator("body").innerText()) && /Communications Leave Request/i.test(await page.locator("body").innerText()));
await page.getByRole("button", { name: /Open case Injury\/Illness — Fred Floor/ }).click(); await settle();
await page.evaluate(() => { window.print = () => {}; });
await page.getByRole("button", { name: "Print case packet" }).click(); await page.waitForTimeout(1500);
const packetHtml = await page.frameLocator("#print-frame").locator("body").innerText().catch(() => "");
check("case packet prints every part", /Injury \/ Illness Report/.test(packetHtml) && /Supervisor Injury\/Illness Statement/.test(packetHtml) && /Employer Report of Injury\/Illness/.test(packetHtml));
await page.screenshot({ path: "/home/claude/testrun/shot-case.png", fullPage: true });

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
