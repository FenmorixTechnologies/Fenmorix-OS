// Gradebook (schools): roster import, teacher grid (weighted categories, missing, hidden drafts, comments, graded work, report-card
// comments), rights (teacher / counselor / manager), reports by grade and subject, family sign-ins (invite link, /grades page, only their
// own student, only shown work), access log and audit. Run with run-school.sh (license keys/school.lic = all + gradebook).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import zlib from "node:zlib";

const BASE = "http://localhost:3077", PW = "Correct horse battery";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const done = () => { console.log(results.join("\n")); console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
for (const ev of ["unhandledRejection", "uncaughtException"]) process.on(ev, e => { done(); console.log("ERR", e.stack); process.exit(1); });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const errors = [];
const newPage = async (vp = { width: 1400, height: 1000 }) => { const p = await (await browser.newContext({ viewport: vp })).newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const apiOn = p => (path, body) => p.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}, [path, body]);

const page = await newPage();
const api = apiOn(page);
await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Dana Principal", email: "principal@school.example", password: PW });
const p2 = await newPage(); await p2.goto(BASE); await p2.waitForTimeout(600);
for (const [f, l] of [["Tess", "Teacher"], ["Cora", "Counselor"], ["Otto", "Other"]]) await apiOn(p2)("/api/auth/signup", { firstName: f, lastName: l, email: `${f.toLowerCase()}@school.example`, division: "Administration", password: PW });
const uid = e => psql(`SELECT id FROM users WHERE email = '${e}'`);
const tess = uid("tess@school.example"), cora = uid("cora@school.example"), otto = uid("otto@school.example");
for (const id of [tess, cora, otto]) await api("/api/auth/approve", { id, role: "user", division: "Training" });
let r = await api("/api/access/grants", { section: "gradebook", level: "view", userId: cora, scope: "all" });
check("counselor given Gradebook view", r.status === 200, JSON.stringify(r.body));

// ---- School setup ----
r = await api("/api/gradebook/settings", { schoolYear: "2026-27", passing: 60 });
check("settings saved (defaults: A-F, 4 categories)", r.status === 200 && r.body.settings.scale.length === 5 && r.body.settings.categories.length === 4, JSON.stringify(r.body).slice(0, 200));
await api("/api/gradebook/periods", { name: "Quarter 1", starts: "2026-08-10", ends: "2026-10-16" });
r = await api("/api/gradebook/periods", { name: "Quarter 2", starts: "2026-10-19", ends: "2026-12-18" });
check("grading periods", r.body.periods?.length === 2, JSON.stringify(r.body));
r = await api("/api/gradebook/periods", { name: "Bad", starts: "2026-12-01", ends: "2026-11-01" });
check("period end before start refused", r.status === 400);

const csv = [
  "Class code,Class,Subject,Period,Teacher,Student ID,Student,Grade,Guardian name,Guardian email",
  "SS4-01,4th Grade Social Studies,Social Studies,2nd,tess@school.example,1001,\"Adams, Ava\",4,Pat Adams,pat@family.example",
  "SS4-01,4th Grade Social Studies,Social Studies,2nd,tess@school.example,1002,\"Brooks, Ben\",4,,",
  "SS4-01,4th Grade Social Studies,Social Studies,2nd,tess@school.example,1003,\"Cruz, Cal\",4,Rita Cruz,rita@family.example",
  "MA4-01,4th Grade Math,Math,3rd,\"Teacher, Tess\",1001,\"Adams, Ava\",4,Pat Adams,pat@family.example",
  "MA4-01,4th Grade Math,Math,3rd,\"Teacher, Tess\",1002,\"Brooks, Ben\",4,,",
  "SC4-01,4th Grade Science,Science,4th,Mr. Nobody,1003,\"Cruz, Cal\",4,,bad-email",
].join("\n");
const data = Buffer.from(csv).toString("base64");
r = await api("/api/gradebook/import", { fileName: "rosters.csv", data, preview: true });
check("import preview counts", r.status === 200 && r.body.classes.new === 3 && r.body.students.new === 3 && r.body.enrollments === 6 && r.body.guardians.new === 2,
  JSON.stringify(r.body).slice(0, 300));
check("preview names the teacher with no account", r.body.teachersMissing?.includes("Mr. Nobody"));
check("preview flags the bad guardian email", r.body.problems?.some(p => /bad-email/.test(p.text)));
check("preview changes nothing", psql("SELECT count(*) FROM gb_classes") === "0");
r = await api("/api/gradebook/import", { fileName: "rosters.csv", data });
check("import applied", r.status === 200 && psql("SELECT count(*) FROM gb_classes") === "3" && psql("SELECT count(*) FROM gb_enrollments") === "6" && psql("SELECT count(*) FROM gb_family") === "2");
check("teachers linked by email and by 'Last, First'", psql(`SELECT count(*) FROM gb_class_teachers WHERE user_id = '${tess}'`) === "2");
r = await api("/api/gradebook/import", { fileName: "rosters.csv", data, preview: true });
check("running it again adds nothing", r.body.classes.new === 0 && r.body.students.new === 0 && r.body.enrollments === 0 && r.body.guardians.links === 0, JSON.stringify(r.body).slice(0, 200));
const cls = Object.fromEntries(psql("SELECT code || '=' || id FROM gb_classes").split("\n").map(x => x.split("=")));
const stu = Object.fromEntries(psql("SELECT student_number || '=' || id FROM gb_students").split("\n").map(x => x.split("=")));
check("class school year from settings, default categories copied", psql(`SELECT school_year || ':' || jsonb_array_length(categories) FROM gb_classes WHERE id = '${cls["SS4-01"]}'`) === "2026-27:4");

// ---- Teacher ----
const tp = await newPage(); const tapi = apiOn(tp);
await tp.goto(BASE); await tapi("/api/auth/login", { email: "tess@school.example", password: PW });
await tp.goto(BASE); await tp.waitForTimeout(2200);
await tp.locator("nav button", { hasText: "Gradebook" }).first().click(); await tp.waitForTimeout(1400);
let t = await tp.locator("main").innerText();
check("teacher sees My classes (her two)", /My classes/.test(t) && /4th Grade Social Studies/.test(t) && /4th Grade Math/.test(t) && !/Science/.test(t), t.slice(0, 300));
await tp.getByRole("button", { name: /4th Grade Social Studies/ }).click(); await tp.waitForTimeout(1300);
await tp.getByRole("button", { name: "New assignment" }).click();
const dlg = tp.getByRole("dialog", { name: "New assignment" });
await dlg.getByLabel("Assignment name").fill("Unit 4 quiz");
await dlg.getByLabel("Category").selectOption({ label: "Quizzes (20%)" });
await dlg.getByLabel("Points possible").fill("20");
await dlg.getByLabel("Due").fill("2026-11-20");
await dlg.getByRole("button", { name: "Add assignment" }).click(); await tp.waitForTimeout(1200);
check("assignment added", (await tp.getByRole("columnheader", { name: /Unit 4 quiz/ }).count()) === 1);
const cell = (a, s) => tp.getByLabel(`${a}, ${s}`, { exact: true });
await cell("Unit 4 quiz", "Adams, Ava").click(); await tp.keyboard.type("18"); await tp.keyboard.press("Enter");
await tp.keyboard.type("m"); await tp.keyboard.press("Enter");
await tp.keyboard.type("15"); await tp.keyboard.press("Enter");
await tp.waitForTimeout(2200);
check("autosaved", /Saved/.test(await tp.getByRole("status", { name: "Save status" }).innerText()));
check("scores stored (Enter moves down)", psql(`SELECT string_agg(coalesce(points::text, status), ',' ORDER BY student_id = '${stu["1001"]}' DESC, student_id = '${stu["1002"]}' DESC) FROM gb_scores`) === "18.00,missing,15.00");
const gradeOf = async s => (await tp.getByLabel(`Grade for ${s}`).innerText()).trim();
check("grade from the quiz alone: A 90%", (await gradeOf("Adams, Ava")) === "A 90%", await gradeOf("Adams, Ava"));
check("missing counts as zero: F 0%", (await gradeOf("Brooks, Ben")) === "F 0%", await gradeOf("Brooks, Ben"));
// A test (40%) and a hidden draft
const st = (await tapi(`/api/gradebook/classes/${cls["SS4-01"]}`)).body;
const testsCat = st.class.categories.find(c => c.name === "Tests").id, projCat = st.class.categories.find(c => c.name === "Projects").id;
r = await tapi(`/api/gradebook/classes/${cls["SS4-01"]}/assignments`, { title: "Chapter 5 test", category: testsCat, points: 100, due: "2026-11-24", published: true });
const test5 = r.body.assignments.find(a => a.title === "Chapter 5 test").id;
r = await tapi(`/api/gradebook/classes/${cls["SS4-01"]}/assignments`, { title: "Draft project", category: projCat, points: 50, due: "2026-11-25", published: false });
const draft = r.body.assignments.find(a => a.title === "Draft project").id;
r = await tapi(`/api/gradebook/classes/${cls["SS4-01"]}/scores`, { changes: [{ assignmentId: test5, studentId: stu["1001"], points: 80 }, { assignmentId: draft, studentId: stu["1001"], points: 0 }] });
check("scores saved by API", r.status === 200);
await tp.reload(); await tp.waitForTimeout(2200);
await tp.locator("nav button", { hasText: "Gradebook" }).first().click(); await tp.waitForTimeout(1200);
await tp.getByRole("button", { name: /4th Grade Social Studies/ }).click(); await tp.waitForTimeout(1300);
check("weighted: (40×80 + 20×90) / 60 = B 83.3%, hidden draft doesn't count", (await gradeOf("Adams, Ava")) === "B 83.3%", await gradeOf("Adams, Ava"));
check("hidden draft is marked", /Hidden draft/.test(await tp.getByRole("columnheader", { name: /Draft project/ }).innerText()));
// Comment + graded work on Ava's quiz
await cell("Unit 4 quiz", "Adams, Ava").click();
const det = tp.getByRole("region", { name: "Grade details" });
await det.getByLabel("Grade comment").fill("Great map work. Check #4.");
await det.getByLabel("Grade comment").blur(); await tp.waitForTimeout(1200);
const png = (() => { const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(14, 200))), chunk("IEND", Buffer.alloc(0))]); })();
await det.getByLabel("Graded work file").setInputFiles({ name: "ava-quiz.png", mimeType: "image/png", buffer: png }); await tp.waitForTimeout(1500);
check("comment and graded work stored", psql(`SELECT comment FROM gb_scores WHERE student_id = '${stu["1001"]}' AND points = 18`) === "Great map work. Check #4." && psql("SELECT count(*) FROM gb_score_files") === "1");
r = await tapi("/api/gradebook/files", { assignmentId: test5, studentId: stu["1001"], name: "x.exe", dataUrl: "data:application/octet-stream;base64," + Buffer.from("MZ not a picture").toString("base64") });
check("graded work must be a PDF or picture", r.status === 415);
// Report-card comment for Quarter 2
await tp.getByRole("tab", { name: /Students/ }).click(); await tp.waitForTimeout(600);
await tp.getByLabel("Report card comment for Adams, Ava").fill("Ava leads her group well.");
await tp.getByLabel("Report card comment for Adams, Ava").blur(); await tp.waitForTimeout(1000);
check("report-card comment saved", psql("SELECT comment FROM gb_period_comments") === "Ava leads her group well.");
// Categories (weights) for this class
r = await tapi(`/api/gradebook/classes/${cls["SS4-01"]}/categories`, { categories: [{ id: testsCat, name: "Tests", weight: 50 }, { id: st.class.categories.find(c => c.name === "Quizzes").id, name: "Quizzes", weight: 50 }] });
check("class categories changed; removed categories' work moves to the first", r.status === 200 && r.body.class.categories.length === 2 && psql(`SELECT category FROM gb_assignments WHERE id = '${draft}'`) === testsCat);
await tp.screenshot({ path: "/tmp/claude-0/gb-roster.png" });
await tp.getByRole("tab", { name: "Grades" }).click(); await tp.waitForTimeout(700);
await tp.screenshot({ path: "/tmp/claude-0/gb-grid.png" });
// Rights
check("teacher can't see reports", (await tapi("/api/gradebook/report")).status === 403);
check("teacher can't change school setup", (await tapi("/api/gradebook/settings", { passing: 10 })).status === 403);
check("teacher can't open a class she doesn't teach", (await tapi(`/api/gradebook/classes/${cls["SC4-01"]}`)).status === 403);
r = await tapi(`/api/gradebook/students/${stu["1003"]}`);
check("teacher sees a student's grades for her classes only", r.status === 200 && r.body.limited && r.body.classes.length === 1 && r.body.family.length === 0, JSON.stringify(r.body).slice(0, 200));
r = await tapi("/api/gradebook/widget");
check("Your Day widget: her classes with work to grade", r.body.classes?.length === 2 && r.body.classes.find(c => c.id === cls["SS4-01"]).toGrade >= 1, JSON.stringify(r.body));
const op = await newPage(); const oapi = apiOn(op); await op.goto(BASE); await oapi("/api/auth/login", { email: "otto@school.example", password: PW });
check("staff who don't teach see no classes", (await oapi("/api/gradebook")).body.classes.length === 0);
check("...and can't grade", (await oapi(`/api/gradebook/classes/${cls["SS4-01"]}/scores`, { changes: [{ assignmentId: test5, studentId: stu["1002"], points: 100 }] })).status === 403);

// ---- Counselor (Gradebook view) ----
const cp = await newPage(); const capi = apiOn(cp); await cp.goto(BASE); await capi("/api/auth/login", { email: "cora@school.example", password: PW });
r = await capi("/api/gradebook/report");
const g = r.body.groups?.find(x => x.subject === "Social Studies");
check("report by grade and subject", r.status === 200 && g && g.gradeLevel === "4" && g.students === 3, JSON.stringify(r.body).slice(0, 400));
r = await capi(`/api/gradebook/report.csv`);
check("report CSV", r.status === 200 && /4th Grade Social Studies/.test(r.body) && /Average %/.test(r.body));
check("counselor sees every class", (await capi("/api/gradebook")).body.classes.length === 3);
check("counselor can't change grades", (await capi(`/api/gradebook/classes/${cls["SS4-01"]}/scores`, { changes: [{ assignmentId: test5, studentId: stu["1002"], points: 100 }] })).status === 403);
await cp.goto(BASE); await cp.waitForTimeout(2000);
await cp.locator("nav button", { hasText: "Gradebook" }).first().click(); await cp.waitForTimeout(1200);
await cp.locator("nav button", { hasText: "Reports" }).first().click(); await cp.waitForTimeout(1500);
t = await cp.getByRole("region", { name: "By grade level and subject" }).innerText();
check("Reports page", /Social Studies/.test(t) && /Math/.test(t), t.slice(0, 300));
await cp.screenshot({ path: "/tmp/claude-0/gb-reports.png" });

// ---- Family sign-ins ----
r = await api("/api/gradebook/family", { studentId: stu["1002"], kind: "guardian", name: "Bo Brooks", email: "bo@family.example", relationship: "Father" });
check("guardian added on a student's page, link returned (no email set up)", r.status === 200 && r.body.invite?.path?.startsWith("/grades?invite=") && !r.body.invite.emailed);
r = await api("/api/gradebook/family", { studentId: stu["1001"], kind: "student", name: "Ava Adams", email: "bo@family.example" });
check("an email can't be both a guardian and a student", r.status === 409);
r = await api("/api/gradebook/family/invites", { all: true });
const patInv = r.body.invites?.find(x => x.email === "pat@family.example");
check("links for everyone without a password (imported guardians too)", r.status === 200 && patInv && r.body.invites.length === 2, JSON.stringify(r.body).slice(0, 300));
check("only the hash of the link is stored", psql("SELECT count(*) FROM gb_family WHERE invite_hash IS NOT NULL") === "3" && !psql("SELECT invite_hash FROM gb_family WHERE email = 'pat@family.example'").includes(patInv.path.split("=")[1]));

const fp = await newPage({ width: 420, height: 860 }); const fapi = apiOn(fp);
await fp.goto(BASE + patInv.path); await fp.waitForTimeout(1500);
check("invite page", /Welcome, Pat/.test(await fp.locator("body").innerText()));
await fp.getByLabel("New password").fill("short"); await fp.getByLabel("Type it again").fill("short");
await fp.getByRole("button", { name: "Save and see grades" }).click(); await fp.waitForTimeout(800);
check("password rule enforced", (await fp.getByRole("alert").count()) === 1);
await fp.getByLabel("New password").fill(PW); await fp.getByLabel("Type it again").fill(PW);
await fp.getByRole("button", { name: "Save and see grades" }).click(); await fp.waitForTimeout(2200);
t = await fp.locator("body").innerText();
check("family sees their student and grades", /Adams/.test(t) && /4th Grade Social Studies/.test(t) && /4th Grade Math/.test(t) && !/Brooks|Cruz/.test(t), t.slice(0, 400));
check("this period's grade (Q2), weights 50/50: (80+90)/2 = B 85%", /B\s*85%/.test(t), t.slice(0, 500));
check("report-card comment shown", /leads her group well/.test(t));
await fp.screenshot({ path: "/tmp/claude-0/gb-family.png" });
await fp.getByRole("button", { name: /4th Grade Social Studies/ }).click(); await fp.waitForTimeout(1500);
t = await fp.locator("body").innerText();
check("class page: score, comment, graded work; no hidden draft", /Unit 4 quiz/.test(t) && /18 \/ 20/.test(t) && /Check #4/.test(t) && /ava-quiz\.png/.test(t) && !/Draft project/.test(t), t.slice(0, 600));
await fp.screenshot({ path: "/tmp/claude-0/gb-family-class.png" });
const fileId = psql("SELECT id FROM gb_score_files");
check("graded work opens for the family", await fp.evaluate(async id => (await fetch(`/api/family/files/${id}`)).status, fileId) === 200);
check("another student's class: not found", (await fapi(`/api/family/students/${stu["1002"]}/classes/${cls["SS4-01"]}`)).status === 404);
check("family can't reach the staff API", (await fapi("/api/gradebook")).status === 401 && (await fapi("/api/collections/roster")).status === 401);
check("family can't load the staff app", await fp.evaluate(async () => (await fetch("/app.js")).status) === 404);
r = await fapi("/api/family/invite", { token: patInv.path.split("=")[1], password: PW });
check("an invite link works once", r.status === 410);
// Signs in again later
await fapi("/api/family/logout", {});
r = await fapi("/api/family/login", { email: "pat@family.example", password: "wrong" });
check("wrong password refused", r.status === 401);
r = await fapi("/api/family/login", { email: "PAT@family.example", password: PW });
check("signs in with email + password", r.status === 200 && r.body.user.students.length === 1);
// Turned off
const patId = psql("SELECT id FROM gb_family WHERE email = 'pat@family.example'");
await api(`/api/gradebook/family/${patId}/active`, { active: false });
check("turning a sign-in off ends it", (await fapi("/api/family/overview")).status === 401);
await api(`/api/gradebook/family/${patId}/active`, { active: true });

// ---- Access log and audit ----
r = await api(`/api/gradebook/log?studentId=${stu["1001"]}`);
check("access log lists family views", r.body.log?.some(x => x.kind === "guardian" && /Pat/.test(x.name)), JSON.stringify(r.body).slice(0, 300));
r = await api(`/api/gradebook/log?studentId=${stu["1003"]}`);
check("...and staff views (the teacher opened Cal's grades)", r.body.log?.some(x => x.kind === "staff" && /Tess/.test(x.name)), JSON.stringify(r.body).slice(0, 300));
let blocked = false; try { psql("DELETE FROM gb_view_log"); } catch { blocked = true; }
check("access log is append-only", blocked);
check("audit: grades, imports, family links", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Gradebook' AND action IN ('Entered grades', 'Imported class rosters', 'Linked a parent / guardian', 'Sent family sign-in links')")) >= 4);

// ---- Manager UI pages open ----
await page.goto(BASE); await page.waitForTimeout(2200);
await page.locator("nav button", { hasText: "Gradebook" }).first().click(); await page.waitForTimeout(1200);
for (const n of ["School setup", "Classes & teachers", "Import rosters", "Family sign-ins", "Students", "Reports", "Classes"]) {
  await page.locator("nav button", { hasText: n }).first().click(); await page.waitForTimeout(900);
}
check("every manager page opens", true);
await page.locator("nav button", { hasText: "Students" }).first().click(); await page.waitForTimeout(600);
await page.getByLabel("Filter students").fill("Adams"); await page.waitForTimeout(600);
await page.getByRole("region", { name: "Student list" }).getByRole("button", { name: /Adams, Ava/ }).click(); await page.waitForTimeout(1300);
t = await page.getByRole("region", { name: "Report card" }).innerText();
check("report card with every period", /Quarter 1/.test(t) && /Quarter 2/.test(t) && /4th Grade Social Studies/.test(t), t.slice(0, 300));
check("family sign-ins on the student page", /Pat Adams/.test(await page.getByRole("region", { name: "Student and family sign-ins" }).innerText()));
await page.screenshot({ path: "/tmp/claude-0/gb-student.png" });

// ---- Students page: list and add a student by hand (with a class and a parent sign-in)
await page.locator("nav button", { hasText: "Students" }).first().click(); await page.waitForTimeout(1200);
t = await page.getByRole("region", { name: "Student list" }).innerText();
check("student list for managers", /Adams, Ava/.test(t) && /Cruz, Cal/.test(t), t.slice(0, 200));
await page.getByRole("button", { name: "Add a student" }).click();
const sd = page.getByRole("dialog", { name: "Add a student" });
await sd.getByLabel("Student first name").fill("Dee"); await sd.getByLabel("Student last name").fill("Diaz");
await sd.getByLabel("Student student id").fill("1004"); await sd.getByLabel("Student grade").fill("4");
await sd.getByLabel("Add to a class").selectOption({ label: "4th Grade Math · 3rd (Tess Teacher)" });
await sd.getByLabel("Guardian name").fill("Lee Diaz"); await sd.getByLabel("Guardian email").fill("lee@family.example");
await sd.getByRole("button", { name: "Add student" }).click(); await page.waitForTimeout(1500);
check("student added by hand, in the class, with a parent sign-in", psql("SELECT count(*) FROM gb_students WHERE student_number = '1004'") === "1"
  && psql(`SELECT count(*) FROM gb_enrollments e JOIN gb_students s ON s.id = e.student_id WHERE s.student_number = '1004' AND e.class_id = '${cls["MA4-01"]}'`) === "1"
  && psql("SELECT count(*) FROM gb_family_links l JOIN gb_family f ON f.id = l.family_id JOIN gb_students s ON s.id = l.student_id WHERE s.student_number = '1004' AND f.email = 'lee@family.example'") === "1");
check("new student in the list", /Diaz, Dee/.test(await page.getByRole("region", { name: "Student list" }).innerText()));
r = await tapi("/api/gradebook/students?all=1");
check("teachers can't pull the whole student list", r.status === 403);
await page.goto(BASE); await page.waitForTimeout(2000);
t = await page.locator("nav").first().innerText();
check("Gradebook under its own Education group in the menu", /EDUCATION/i.test(t) && t.toUpperCase().indexOf("EDUCATION") < t.toUpperCase().indexOf("GRADEBOOK"), t.slice(0, 300));
check("no page errors", !errors.length, errors.join(" | "));
done();
await browser.close();
