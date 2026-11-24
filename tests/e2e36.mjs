// Pass/fail skills programs (probationary, lateral, pumper, aerial) — e2e36. Header copied from e2e34: seeded programs, working test period enrolment, evaluator results with AI drafts and
// verification flags, access rules (section edit, program/candidate evaluators, no self-evaluation), composite/retest
// math, submissions, reviews + acknowledgement, final recommendation, voice simulator (push to talk with a fake
// microphone + fake whisper, injects/Mayday cues, grading, replay), evaluated run -> signed result, conversation sim,
// program and scenario editors. Fictional people only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import http from "node:http";
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 400) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const SCR = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad";

// ---- Claude stand-in ----
const ai = [];
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", c => (body += c));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    const text = (j.messages?.[0]?.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    let reply;
    if (/voice fireground radio simulation/.test(text)) { ai.push({ kind: "radio", text }); reply = { replies: [{ from: "Dispatch", text: "Dispatch copies, Engine 613 has command." }] }; }
    else if (/role-playing a fire department member/.test(text)) { ai.push({ kind: "talk", text }); reply = { replies: [{ from: "FF Jordan Example", text: "Fine. Honestly, it's my kid's new daycare." }], mood: "calmer" }; }
    else if (/You grade a/.test(text)) {
      const conv = /leadership conversation practice/.test(text);
      ai.push({ kind: "grade", conv, text });
      const n = (text.match(/^\d+\. /gm) || []).length;
      reply = conv ? { scores: Array.from({ length: n }, (_, i) => ({ score: [4, 3, 4, 4, 2][i] ?? 3, why: "Asked open questions at 0:40." })), summary: "Listened well; follow-up plan was vague.",
          strengths: ["Asked about the reason before talking about discipline"], improvements: ["Set a follow-up date"], helped: ["Open question at 0:40"], escalated: ["Mentioned a write-up early"],
          listening: "Good", expectations: "Clear", followUp: "Missing a date", keyMoments: [{ t: "0:40", text: "Asked why", note: "Opened the conversation" }], flags: [] }
        : { scores: Array.from({ length: n }, (_, i) => ({ score: [4, 3, 4, 3, 2][i] ?? 3, why: `Element ${i + 1}: radio report at 0:15.` })), summary: "Solid size-up; slow to react to the floor cue.",
          strengths: ["Clear initial radio report"], improvements: ["React to the spongy floor immediately"],
          keyMoments: [{ t: "0:15", text: "Initial report", note: "Complete" }],
          cues: [{ t: "3:20", cue: "Spongy floor", recognized: false, responseSeconds: null, note: "Not addressed" }, { t: "7:00", cue: "Mayday", recognized: true, responseSeconds: 12, note: "LUNAR obtained" }],
          assignments: [{ t: "2:00", unit: "Ladder 618", task: "Primary search" }], flags: ["Confirm whether RIT was assigned before 4:00"] };
    } else if (/apply an approved rubric/.test(text)) {
      ai.push({ kind: "draft", text });
      const mods = [...text.matchAll(/^MODULE (\S+) –/gm)].map(m => m[1]);
      reply = { modules: Object.fromEntries(mods.map(k => [k, { scores: k === "A" ? [{ score: 4, why: "Complete report" }, { score: 4, why: "Accurate" }, { score: 3, why: "Location vague" }, { score: null, why: "Not observed" }, { score: 4, why: "Asked for resources" }]
          : [5, 4, 4, 4, 5, 3].map(s => ({ score: s, why: "From the submission" })), comment: `Draft comment for ${k}` }])),
        feedback: "Good radio discipline. Work on risk/benefit statements.", flags: ["Risk/benefit wasn't in the notes; confirm with the candidate"] };
    } else reply = {};
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }));
  });
});
await new Promise(r => mock.listen(3099, "127.0.0.1", r));
fs.writeFileSync("/home/claude/testrun/fake-voice.txt", "Engine 613 on scene, one story ranch, smoke showing Charlie side, offensive, Engine 613 has command.\n");
try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", ANTHROPIC_API_KEY: "test", AI_API_BASE: "http://127.0.0.1:3099",
    WHISPER_BIN: "/home/claude/testrun/fake-whisper.mjs", WHISPER_MODEL: "/home/claude/testrun/fake-model.bin" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
async function person(viewport = { width: 1400, height: 950 }) {
  const ctx = await browser.newContext({ viewport, timezoneId: "America/Chicago", permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept());
  const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [path, opts]);
  const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
  const settle = async (ms = 500) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  async function login(email) {
    await ctx.clearCookies(); await page.goto(BASE); await settle();
    await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click(); await settle(900);
  }
  const nav = async name => { await page.getByRole("button", { name, exact: true }).first().click(); await settle(700); };
  const sign = async (labelText = null) => {
    const canvas = page.locator("canvas").last();
    await canvas.scrollIntoViewIfNeeded();
    const b = await canvas.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 40); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + 70, { steps: 8 }); await page.mouse.move(b.x + 200, b.y + 30, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(200);
  };
  return { ctx, page, api, post, settle, login, nav, sign, body: () => page.locator("body").innerText() };
}
const M = await person();
await M.page.goto(BASE); await M.settle();
await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Cal Candidate", "cal"], ["Eve Evaluator", "eve"], ["Ned Nobody", "ned"], ["Bea Battalion", "bea"], ["Dot Driver", "dot"]]) {
  await M.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await M.login("mike@sgfd.org");
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const uid = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
await M.post("/api/access/grants", { section: "evals", level: "edit", userId: uid("Eve Evaluator"), scope: "all" });


const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pid = k => psql(`SELECT id FROM eval_programs WHERE key='${k}'`);
// ======= Seeds =======
check("four pass/fail programs seeded ahead of the officer programs", psql("SELECT string_agg(key, ',' ORDER BY sort) FROM eval_programs") === "ff-probation,ff-lateral,op-pumper,op-aerial,op-confirm,co-wtp,co-eval,co-matrix,bc-wtp,bc-matrix,ac-wtp,ac-matrix,dc-wtp");
const mods = k => psql(`SELECT string_agg(m->>'key' || ':' || jsonb_array_length(m->'elements'), ',') FROM eval_programs, jsonb_array_elements(data->'modules') m WHERE key = '${k}'`);
check("operator confirmation: 5 skills, pass/fail", mods("op-confirm") === "A:3,B:4,C:1,D:1,E:1" && psql("SELECT data->'scale'->>'labels' FROM eval_programs WHERE key='op-confirm'") === '["Fail", "Pass"]');
check("Assistant Chief WTP: modules A-F, 5 elements each, two per quarter", mods("ac-wtp") === "A:5,B:5,C:5,D:5,E:5,F:5"
  && psql("SELECT string_agg(m->>'quarter', '' ORDER BY m->>'key') FROM eval_programs, jsonb_array_elements(data->'modules') m WHERE key='ac-wtp'") === "112233");
const pts = k => Number(psql(`SELECT sum((e->>'mult')::numeric * 5) FROM eval_programs, jsonb_array_elements(data->'modules') m, jsonb_array_elements(m->'elements') e WHERE key = '${k}'`));
check("Assistant Chief matrix totals 170 points (35/35/30/35/35)", pts("ac-matrix") === 170
  && psql("SELECT string_agg(m->>'weight', ',') FROM eval_programs, jsonb_array_elements(data->'modules') m WHERE key='ac-matrix'") === "35,35,30,35,35");
check("AC guides carry the scenarios", /One Problem After Another/.test(psql("SELECT data->'modules'->1->>'guide' FROM eval_programs WHERE key='ac-wtp'")) && /Auditing the Auditors/.test(psql("SELECT data->'modules'->2->>'guide' FROM eval_programs WHERE key='ac-wtp'")));
check("probationary: 7 skills, 27 criteria, pass/fail, latest standing, reviews 3/6/9",
  psql("SELECT jsonb_array_length(data->'modules') || '/' || (SELECT count(*) FROM jsonb_array_elements(data->'modules') m, jsonb_array_elements(m->'elements')) || '/' || (data->'scale'->>'labels') || '/' || (data->>'standing') || '/' || (data->>'reviews') FROM eval_programs WHERE key='ff-probation'")
    === '7/27/["Fail", "Pass"]/latest/[3, 6, 9]');
check("lateral = aerobic + 7 skills; pumper and aerial = 2 modules each", psql("SELECT string_agg(jsonb_array_length(data->'modules')::text, ',' ORDER BY sort) FROM eval_programs WHERE key IN ('ff-lateral','op-pumper','op-aerial')") === "8,2,2");
check("guides carry the form's criteria", /2:00 minute/.test(psql("SELECT data->'modules'->0->>'guide' FROM eval_programs WHERE key='ff-probation'")) && /77-foot/.test(psql("SELECT data->'modules'->1->>'guide' FROM eval_programs WHERE key='op-aerial'")));

// ======= Enrol a probationary firefighter (UI) =======
await M.nav("Evaluations");
await M.nav("Working test periods");
await M.page.getByRole("button", { name: "Start a working test period" }).click(); await M.settle(400);
await M.page.getByLabel("Enrol program").selectOption({ label: "Probationary Firefighter" });
await M.page.getByLabel("Enrol person").selectOption({ label: "Cal Candidate" });
await M.page.getByLabel("Start date").fill("2026-06-01");
await M.page.getByRole("button", { name: "Start working test period" }).click(); await M.settle(900);
const candId = psql("SELECT id FROM eval_candidates");
let b = await M.body();
check("candidate page lists the 7 skills as not evaluated; skills-passed line", (b.match(/not evaluated yet/g) || []).length === 7 && /Skills passed: 0 of 7/.test(b), b.slice(0, 600));

// ======= Eve: 3-month evaluation in the UI, two criteria fail =======
const E = await person(); await E.login("eve@sgfd.org");
await E.nav("Evaluations"); await E.nav("Working test periods");
await E.page.getByRole("button", { name: /Open Cal Candidate/ }).click(); await E.settle();
await E.page.getByRole("button", { name: "New evaluation" }).click(); await E.settle(600);
await E.page.getByLabel("Module A").check(); await E.page.getByLabel("Module D").check(); await E.settle(300);
check("pass/fail buttons instead of 0–5", await E.page.getByRole("radio", { name: "A Completed within 2:00: Pass" }).count() === 1 && await E.page.getByRole("radio", { name: "A Completed within 2:00: 3" }).count() === 0);
for (const n of ["Done in a safe and controlled manner", "All PPE worn and properly adjusted", "SCBA fully on, worn and operating"]) await E.page.getByRole("radio", { name: `A ${n}: Pass` }).click();
await E.page.getByRole("radio", { name: "A Completed within 2:00: Fail" }).click();
await E.page.getByLabel("Comments for A").fill("2:14. Retrain by 2026-09-15.");
b = await E.body();
check("verdict shows what's left: 3 not scored, 1 failed", /3 not scored · 1 failed/.test(b));
for (const n of ["1¾ line advanced while flowing; nozzle passes the 25 ft cone", "2½ line advanced charged, not flowing; nozzle passes the 75 ft cone", "Done in a safe and controlled manner"]) await E.page.getByRole("radio", { name: `D ${n}: Pass` }).click();
check("verdict: Not passed · 1 failed", /Not passed · 1 failed/.test(await E.body()));
await E.page.getByLabel("Date").fill("2026-09-01");
await E.sign();
await E.page.getByRole("button", { name: "Sign and make official" }).click(); await E.settle(900);
const r1 = psql("SELECT pct || ' ' || status FROM eval_results");
// A: 3/4 = 75, D: 3/3 = 100 -> 87.5
check("result stored: 87.5%, final", r1 === "87.5 final", r1);
let st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("standing: A not passed (latest formal), D passed", st.modules.find(m => m.key === "A").pct === 75 && /latest formal/.test(st.modules.find(m => m.key === "A").source) && st.modules.find(m => m.key === "D").pct === 100 && !st.passing);
const res = (await E.api(`/api/evals/candidates/${candId}`)).body.results[0];
check("result carries the pass/fail tally", res.passFail?.failed === 1 && res.passFail?.missing === 0 && res.passFail?.total === 7, JSON.stringify(res.passFail));

// ======= Retest (attempt #2) then the latest attempt counts =======
const p = pid("ff-probation");
const fin = async (mods, scores, kind, date) => (await E.post("/api/evals/results", { programId: p, candidateId: candId, kind, modules: mods, scores, final: true, signature: SIG, date }));
const ok = await fin(["A"], { A: [1, 1, 1, 1] }, "retest", "2026-09-15");
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("retest passes A (latest retest)", ok.status === 200 && st.modules.find(m => m.key === "A").pct === 100 && /latest retest/.test(st.modules.find(m => m.key === "A").source));
check("scores other than 0/1 refused", (await E.post("/api/evals/results", { programId: p, candidateId: candId, kind: "formal", modules: ["B"], scores: { B: [2] } })).status === 400);
for (const k of ["B", "C", "E", "F", "G"]) {
  const n = { B: 1, C: 5, E: 4, F: 6, G: 4 }[k];
  await fin([k], { [k]: Array(n).fill(1) }, "formal", "2026-09-01");
}
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("every skill passed -> passing", st.complete && st.passing && st.modules.every(m => m.pct === 100));
await fin(["F"], { F: [1, 1, 1, 1, 0, 1] }, "formal", "2026-12-01");   // 6-month evaluation: Mayday call missed
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("a later failed formal makes that skill not passed again (latest counts)", !st.passing && st.modules.find(m => m.key === "F").pct < 100);
await E.page.goto(BASE); await E.settle(); await E.nav("Evaluations"); await E.nav("Working test periods");
check("list shows skills passed 6/7", /Skills passed 6\/7/.test(await E.body()), (await E.body()).slice(0, 500));
await E.page.getByRole("button", { name: /Open Cal Candidate/ }).click(); await E.settle();
b = await E.body();
check("candidate page: Passed / Not passed pills and 6 of 7", /Skills passed: 6 of 7/.test(b) && (b.match(/Not passed/g) || []).length >= 1 && /Passed/.test(b));

// ======= Lateral firefighter: one-time form with the AI draft =======
await E.page.goto(BASE); await E.settle(); await E.nav("Evaluations");
await E.page.getByRole("button", { name: "Evaluations", exact: true }).last().click(); await E.settle(500);
await E.page.getByRole("button", { name: "Evaluate someone" }).click(); await E.settle(500);
await E.page.getByLabel("Program", { exact: true }).selectOption({ label: "Lateral Firefighter" });
await E.page.getByLabel("Person evaluated").selectOption({ label: "Dot Driver" }); await E.settle(300);
check("lateral form selects all 8 modules", await E.page.getByRole("radio", { name: /: Pass$/ }).count() === 28);
await E.page.getByLabel("Observations").fill("Ran 1.5 miles in 14:50. Donning in 1:38.");
await E.page.getByRole("button", { name: "Draft scores with AI" }).click(); await E.settle(900);
const dr = ai.filter(a => a.kind === "draft").pop();
check("AI prompt explains pass/fail scoring", /Score each element 0 = Fail or 1 = Pass/.test(dr?.text || ""), (dr?.text || "").slice(0, 300));
const lat = await E.post("/api/evals/results", { programId: pid("ff-lateral"), userId: uid("Dot Driver"), kind: "formal", modules: ["A", "B", "C", "D", "E", "F", "G", "H"],
  scores: { A: [1], B: [1, 1, 1, 1], C: [1], D: [1, 1, 1, 1, 1], E: [1, 1, 1], F: [1, 1, 1, 1], G: [1, 1, 1, 1, 1, 1], H: [1, 1, 1, 1] }, final: true, signature: SIG });
check("lateral signed: 100%, Passed tally", lat.status === 200 && (await E.api(`/api/evals/results/${lat.body.id}`)).body.result.passFail?.failed === 0, JSON.stringify(lat.body).slice(0, 200));

// ======= Pumper and aerial =======
const pump = await E.post("/api/evals/results", { programId: pid("op-pumper"), userId: uid("Dot Driver"), kind: "formal", modules: ["A", "B"], scores: { A: [1, 1, 0, 1], B: [1, 1, 1, 1] }, final: true, signature: SIG });
check("pumper with one failed minimum: Not passed tally", pump.status === 200 && (await E.api(`/api/evals/results/${pump.body.id}`)).body.result.passFail?.failed === 1);
await E.page.goto(BASE); await E.settle(); await E.nav("Evaluations");
await E.page.getByRole("button", { name: "Evaluations", exact: true }).last().click(); await E.settle(500);
b = await E.body();
check("results list shows Passed and Not passed verdicts", /Passed/.test(b) && /Not passed · 1 failed/.test(b));
await E.page.screenshot({ path: SCR + "/e36-list.png" });

// ======= Program editor: switch a program to pass/fail =======
const prog = await M.post("/api/evals/programs", { name: "Test PF", rank: "x", kind: "form", data: { scale: { min: 0, max: 1, labels: ["Fail", "Pass"] }, passComposite: 100, passModule: 100, standing: "latest", modules: [{ key: "A", title: "One", elements: [{ label: "x", mult: 1 }] }] } });
check("program save keeps pass/fail labels", prog.status === 200 && psql(`SELECT data->'scale'->>'labels' FROM eval_programs WHERE name='Test PF'`) === '["Fail", "Pass"]');
const prog2 = await M.post("/api/evals/programs", { name: "Bad labels", rank: "x", kind: "form", data: { scale: { min: 0, max: 5, labels: ["Fail", "Pass"] }, modules: [{ key: "A", title: "One", elements: [{ label: "x", mult: 1 }] }] } });
check("labels that don't fit the scale are dropped", prog2.status === 200 && psql(`SELECT coalesce(data->'scale'->>'labels', 'none') FROM eval_programs WHERE name='Bad labels'`) === "none");
await M.page.goto(BASE); await M.settle(); await M.nav("Evaluations"); await M.nav("Programs");
check("programs list says Pass / Fail", /scored Pass \/ Fail/.test(await M.body()));

check("no page errors", errors.length === 0, errors.join(" | "));
done();
await browser.close(); mock.close();
try { process.kill(srv.pid); } catch {}
process.exit(0);
