// Evaluations & Simulations: seeded programs, working test period enrolment, evaluator results with AI drafts and
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

// ======= Seeds =======
check("six programs seeded from the documents (plus the four pass/fail skills programs)", psql("SELECT string_agg(key, ',' ORDER BY sort) FROM eval_programs WHERE sort >= 30 AND key NOT LIKE 'ac-%'") === "co-wtp,co-eval,co-matrix,bc-wtp,bc-matrix,dc-wtp");
const wsum = k => Number(psql(`SELECT sum((m->>'weight')::numeric) FROM eval_programs, jsonb_array_elements(data->'modules') m WHERE key = '${k}'`));
check("module weights add to 100 (CO, BC, DC working test periods; CO 7-category form's own 105)", wsum("co-wtp") === 100 && wsum("bc-wtp") === 100 && wsum("dc-wtp") === 100 && wsum("co-eval") === 105, [wsum("co-wtp"), wsum("bc-wtp"), wsum("dc-wtp")]);
check("matrix points match the documents (160 / 155)", wsum("co-matrix") === 160 && wsum("bc-matrix") === 155);
check("CO module I element weights 10/20/25/25/20", psql("SELECT string_agg(e->>'mult', ',') FROM eval_programs, jsonb_array_elements(data->'modules') m, jsonb_array_elements(m->'elements') e WHERE key='co-wtp' AND m->>'key'='I'") === "1,2,2.5,2.5,2");
check("guides carry the scenario text", /Brookshire Drive/.test(psql("SELECT data->'modules'->0->>'guide' FROM eval_programs WHERE key='co-wtp'")) && /Oak Ridge Apartments/.test(psql("SELECT data->'modules'->0->>'guide' FROM eval_programs WHERE key='bc-wtp'")));
check("nine simulation scenarios seeded (5 radio, 4 conversation)", psql("SELECT count(*) FILTER (WHERE kind='radio') || '/' || count(*) FILTER (WHERE kind='conversation') FROM sim_scenarios") === "5/4");

// ======= Enrol (Mike, UI) =======
await M.nav("Evaluations");
check("Evaluations in the side bar; My development page", /Practice with the voice simulator/.test(await M.body()));
await M.nav("Working test periods");
await M.page.getByRole("button", { name: "Start a working test period" }).click(); await M.settle(400);
await M.page.getByLabel("Enrol program").selectOption({ label: "Company Officer – Working Test Period" });
await M.page.getByLabel("Enrol person").selectOption({ label: "Cal Candidate" });
await M.page.getByLabel("Start date").fill("2026-02-02");
await M.page.getByLabel("Add to Evaluators").fill("Bea"); await M.page.getByRole("button", { name: /^Bea Battalion/ }).click();
await M.page.getByRole("button", { name: "Start working test period" }).click(); await M.settle(900);
const candId = psql("SELECT id FROM eval_candidates");
check("enrolment saved with end date 12 months later and Bea as evaluator", psql(`SELECT end_date || ' ' || (evaluators ? '${uid("Bea Battalion")}') FROM eval_candidates`) === "2027-02-02 true");
check("candidate page opens with every module not evaluated", /Cal Candidate: Company Officer/.test(await M.body()) && (await M.body()).match(/not evaluated yet/g)?.length === 9);
check("Cal and Bea were messaged", Number(psql(`SELECT count(*) FROM message_recipients r JOIN message_threads t ON t.id = r.thread_id WHERE t.subject LIKE 'Working test period%' AND r.user_id IN ('${uid("Cal Candidate")}','${uid("Bea Battalion")}')`)) === 2);
check("duplicate open enrolment refused", (await M.post("/api/evals/candidates", { programId: psql("SELECT id FROM eval_programs WHERE key='co-wtp'"), userId: uid("Cal Candidate"), startDate: "2026-03-01" })).status === 409);

// ======= Eve evaluates module A with an AI draft =======
const E = await person(); await E.login("eve@sgfd.org");
await E.nav("Evaluations"); await E.nav("Working test periods");
await E.page.getByRole("button", { name: /Open Cal Candidate/ }).click(); await E.settle();
await E.page.getByRole("button", { name: "New evaluation" }).click(); await E.settle(600);
await E.page.getByLabel("Module A").check(); await E.settle(300);
await E.page.getByLabel("Observations").fill("Engine 623 on scene report at 0:20 gave building, conditions, offensive mode and command at Alpha. Requested a second alarm. Named the hydrant.");
await E.page.getByRole("button", { name: "Draft scores with AI" }).click(); await E.settle(900);
const draftReq = ai.filter(a => a.kind === "draft").pop();
check("AI draft prompt carries the rubric, the guide and the observations", /MODULE A – Size-Up/.test(draftReq.text) && /Brookshire/.test(draftReq.text) && /second alarm/.test(draftReq.text));
check("drafted scores land on the buttons (unscored element left empty)", await E.page.getByRole("radio", { name: "A Completeness of radio report: 4" }).getAttribute("aria-checked") === "true"
  && await E.page.getByRole("radio", { name: "A Risk/benefit and safety awareness: 3" }).getAttribute("aria-checked") === "false");
check("flag to verify is shown; feedback filled; reasons shown", /Risk\/benefit wasn't in the notes/.test(await E.body()) && (await E.page.getByLabel("Feedback").inputValue()).startsWith("Good radio discipline") && /Location vague/.test(await E.body()));
await E.page.getByRole("radio", { name: "A Risk/benefit and safety awareness: 3" }).click();
await E.sign();
await E.page.getByRole("button", { name: "Sign and make official" }).click(); await E.settle(700);
check("can't sign with an unchecked flag", /Check off \(or remove\) the items flagged/.test(await E.body()));
await E.page.getByLabel(/^Verified: Risk/).check();
await E.page.getByRole("button", { name: "Sign and make official" }).click(); await E.settle(900);
const rA = psql("SELECT id || ' ' || status || ' ' || pct || ' ' || kind FROM eval_results").split(" ");
// A: (4+4+3+3+4)/25 = 72%
check("signed result stored: final, 72%, formal, linked to the candidate", rA[1] === "final" && Number(rA[2]) === 72 && rA[3] === "formal" && psql(`SELECT candidate_id FROM eval_results WHERE id='${rA[0]}'`) === candId, rA.join(" "));
check("signed result shows read-only with the signature", /Signed by Eve Evaluator/.test(await E.body()) && await E.page.getByAltText("Evaluator signature").count() === 1);
check("Cal messaged that it was signed", psql(`SELECT count(*) FROM message_threads WHERE subject = 'Evaluation signed: Company Officer – Working Test Period'`) === "1");

// ======= Access rules (API) =======
const N = await person(); await N.login("ned@sgfd.org");
const coId = psql("SELECT id FROM eval_programs WHERE key='co-wtp'"), bcId = psql("SELECT id FROM eval_programs WHERE key='bc-wtp'"), dcId = psql("SELECT id FROM eval_programs WHERE key='dc-wtp'");
const full = (k, n, v) => ({ [k]: Array(n).fill(v) });
check("no access: can't see Cal's working test period", (await N.api(`/api/evals/candidates/${candId}`)).status === 403);
check("no access: can't record a formal evaluation", (await N.post("/api/evals/results", { programId: coId, userId: uid("Cal Candidate"), kind: "formal", modules: ["B"], scores: full("B", 6, 4) })).status === 403);
check("no access: can't see the signed result", (await N.api(`/api/evals/results/${rA[0]}`)).status === 404);
const B = await person(); await B.login("bea@sgfd.org");
check("assigned evaluator (no section access) can open the candidate", (await B.api(`/api/evals/candidates/${candId}`)).body?.canEvaluate === true);
const bDraft = await B.post("/api/evals/results", { programId: coId, candidateId: candId, kind: "formal", modules: ["B"], scores: full("B", 6, 4), observations: "Engine ops drill." });
check("assigned evaluator can record for that candidate", bDraft.status === 200, JSON.stringify(bDraft.body));
check("…but not for someone else in another program", (await B.post("/api/evals/results", { programId: bcId, userId: uid("Dot Driver"), kind: "formal", modules: ["A"], scores: full("A", 5, 4) })).status === 403);
check("nobody evaluates themselves", (await E.post("/api/evals/results", { programId: bcId, userId: uid("Eve Evaluator"), kind: "formal", modules: ["A"], scores: full("A", 5, 4) })).status === 403);
check("final needs every element scored", (await E.post("/api/evals/results", { programId: coId, candidateId: candId, kind: "formal", modules: ["C"], scores: { C: [4, 4, null, 4, 4] }, final: true, signature: "data:image/png;base64,iVBORw0KGgo=" })).status === 400);
check("final formal needs a signature", (await E.post("/api/evals/results", { programId: coId, candidateId: candId, kind: "formal", modules: ["C"], scores: full("C", 5, 4), final: true })).status === 400);
check("scores outside the scale refused", (await E.post("/api/evals/results", { programId: coId, candidateId: candId, kind: "formal", modules: ["C"], scores: { C: [6, 4, 4, 4, 4] } })).status === 400);

// ======= Composite / retest math =======
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const fin = async (mods, scores, kind = "formal", date) => (await E.post("/api/evals/results", { programId: coId, candidateId: candId, kind, modules: mods, scores, final: true, signature: SIG, date })).body;
await B.post("/api/evals/results", { id: bDraft.body.id, programId: coId, candidateId: candId, kind: "formal", modules: ["B"], scores: full("B", 6, 4), final: true, signature: SIG });   // B 80
await fin(["C"], full("C", 5, 5));      // 100
await fin(["D"], full("D", 5, 3));      // 60  (below 70)
await fin(["E"], full("E", 5, 4)); await fin(["F"], full("F", 5, 4)); await fin(["G"], full("G", 5, 4)); await fin(["H"], full("H", 5, 4));
await fin(["I"], { I: [5, 4, 4, 4, 5] });   // (5*1+4*2+4*2.5+4*2.5+5*2)/(5*10) = 43/50 = 86
let st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
// composite = (72*10 + 80*10 + 100*7.5 + 60*7.5 + 80*15 + 80*10 + 80*10 + 80*15 + 86*15) / 100 = 80.1
check("composite weighted by the document's category weights (80.1)", st.composite === 80.1 && st.complete, JSON.stringify(st.modules.map(m => [m.key, m.pct])));
check("module under 70% blocks passing even with composite ≥ 80", st.meetsComposite && !st.passing && st.belowMin.join() === "D");
await fin(["D"], full("D", 5, 4), "formal", "2026-05-01");   // second formal: average (60 + 80) / 2 = 70
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("two formal results for a module are averaged", st.modules.find(m => m.key === "D").pct === 70 && st.modules.find(m => m.key === "D").source === "average of 2");
await fin(["D"], full("D", 5, 5), "retest", "2026-06-01");
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("a retest replaces the module's earlier scores; candidate now passing", st.modules.find(m => m.key === "D").pct === 100 && st.modules.find(m => m.key === "D").source === "retest" && st.passing, st.composite);
const pr = await (async () => { const C0 = await person(); await C0.login("cal@sgfd.org"); return C0; })();
const C = pr;
const prac = await C.post("/api/evals/results", { programId: coId, userId: uid("Cal Candidate"), kind: "practice", modules: ["A"], scores: full("A", 5, 1), final: true });
st = (await E.api(`/api/evals/candidates/${candId}`)).body.standing;
check("practice results never count and stay private", prac.status === 200 && st.modules.find(m => m.key === "A").pct === 72 && (await E.api(`/api/evals/results/${prac.body.id}`)).status === 404);

// ======= Cal: submissions, reviews =======
await C.nav("Evaluations");
check("Cal sees the standing and the signed evaluations", /Company Officer – Working Test Period/.test(await C.body()) && /Composite:/.test(await C.body()) && /A signed evaluation: read it/.test(await C.body()));
await C.page.getByRole("button", { name: "Open", exact: true }).first().click(); await C.settle();
await C.page.getByRole("button", { name: "Add a submission" }).click();
await C.page.getByLabel("Submission module").selectOption("G");
await C.page.getByLabel("Submission title").fill("NERIS narrative");
await C.page.getByLabel("Submission text").fill("On arrival Engine 643 found a two-story townhouse with heavy fire showing from Unit 4. Primary search negative.");
await C.page.getByRole("button", { name: "Turn it in" }).click(); await C.settle(700);
check("submission saved and listed", psql("SELECT title FROM eval_submissions") === "NERIS narrative" && /NERIS narrative/.test(await C.body()));
const dr = await E.post("/api/evals/ai/draft", { programId: coId, candidateId: candId, modules: ["G"], observations: "Reviewed the NERIS narrative and memo turned in on time." });
check("AI draft reads the candidate's written submission", dr.status === 200 && /two-story townhouse with heavy fire/.test(ai.filter(a => a.kind === "draft").pop().text) && dr.body.draft.modules.G.scores[0].score === 5);
check("AI draft refuses with no observations", (await E.post("/api/evals/ai/draft", { programId: coId, candidateId: candId, modules: ["G"], observations: "ok" })).status === 400);
// Eve signs the 3-month review (UI)
await E.nav("Working test periods");
await E.page.getByRole("button", { name: /Open Cal Candidate/ }).click(); await E.settle();
await E.page.getByRole("button", { name: "Write" }).first().click(); await E.settle(300);
await E.page.getByLabel("3-month Summary of performance").fill("Strong start; tactical communication is clear.");
await E.page.getByLabel("3-month Development goals for next quarter").fill("Lead two company drills on ladder operations.");
await E.sign();
await E.page.getByRole("button", { name: "Sign review" }).click(); await E.settle(800);
check("review signed; candidate asked to sign", psql("SELECT status FROM eval_reviews WHERE month = 3") === "signed" && /Waiting for the candidate/.test(await E.body()));
await C.page.goto(BASE); await C.settle(); await C.nav("Evaluations");
check("Cal's home shows the review to sign", /3-month review: read and sign/.test(await C.body()));
await C.page.getByRole("button", { name: "3-month review: read and sign" }).click(); await C.settle();
await C.page.getByRole("button", { name: "Read", exact: true }).first().click(); await C.settle(300);
await C.page.getByLabel("Comment on the review").fill("Thanks — will schedule the drills.");
await C.sign();
await C.page.getByRole("button", { name: "Sign", exact: true }).click(); await C.settle(700);
check("Cal acknowledged the review with a comment", psql("SELECT ack_comment FROM eval_reviews WHERE month = 3") === "Thanks — will schedule the drills.");
await C.page.screenshot({ path: `${SCR}/shot-evals-candidate.png`, fullPage: true });

// ======= Final recommendation (Mike) =======
await M.page.goto(BASE); await M.settle(); await M.nav("Evaluations"); await M.nav("Working test periods");
await M.page.getByRole("button", { name: /Open Cal Candidate/ }).click(); await M.settle();
await M.page.getByLabel("Recommendation", { exact: true }).selectOption("Recommend permanent status");
await M.page.getByLabel("Recommendation notes").fill("Meets every standard of the working test period.");
await M.sign();
await M.page.getByRole("button", { name: "Sign recommendation" }).click(); await M.settle(800);
check("final recommendation signed; status completed", psql("SELECT outcome || '|' || status FROM eval_candidates") === "Recommend permanent status|completed");
await M.page.getByRole("button", { name: "Print final report" }).click(); await M.page.waitForTimeout(600);
const printed = await M.page.evaluate(() => document.getElementById("print-frame")?.contentDocument?.body?.innerText || "");
check("final report prints composite, evaluations, reviews and recommendation", /Final Evaluation Report/.test(printed) && /Composite/.test(printed) && /3-month review/.test(printed) && /Recommend permanent status/.test(printed));

// ======= Voice simulator: practice (Cal) =======
await C.page.goto(BASE); await C.settle(); await C.nav("Evaluations"); await C.nav("Simulator");
check("simulator lists radio and conversation scenarios", /Fireground radio/.test(await C.body()) && /Leadership conversations/.test(await C.body()) && /Mayday Recognition Drill/.test(await C.body()));
await C.page.getByRole("button", { name: /Scenario Mayday Recognition Drill/ }).click(); await C.settle(300);
check("no evaluated-run option for a non-evaluator", await C.page.getByText("Evaluated run for a candidate").count() === 0);
await C.page.getByRole("button", { name: "Start" }).click(); await C.settle(1200);
check("run starts with dispatch and the arrival picture", /Engine 613, Ladder 618/.test(await C.body()) && /What you see/.test(await C.body()) && /One-story ranch/.test(await C.body()));
const ptt = C.page.getByRole("button", { name: "Push to talk" });
await ptt.dispatchEvent("pointerdown"); await C.page.waitForTimeout(1500); await ptt.dispatchEvent("pointerup");
await C.page.waitForTimeout(2500);
let sess = psql("SELECT id FROM sim_sessions");
const tr1 = JSON.parse(psql(`SELECT transcript FROM sim_sessions WHERE id='${sess}'`));
check("push to talk: the microphone recording was transcribed on the server", tr1.some(e => e.who === "officer" && /one story ranch/.test(e.text)), JSON.stringify(tr1.slice(-3)));
check("the reply from Dispatch shows in the radio log", /Dispatch copies, Engine 613 has command/.test(await C.body()));
check("the simulation prompt carries the scenario facts and the officer's words", /floor over the crawl space/.test(ai.filter(a => a.kind === "radio")[0].text) && /one story ranch/.test(ai.filter(a => a.kind === "radio")[0].text));
await C.page.getByLabel("Type a transmission").fill("Ladder 618, primary search. Squad 605, you are On Deck.");
await C.page.keyboard.press("Enter"); await C.page.waitForTimeout(1500);
check("typed transmission works too", JSON.parse(psql(`SELECT transcript FROM sim_sessions WHERE id='${sess}'`)).some(e => e.who === "officer" && /On Deck/.test(e.text)));
const tick = await C.post(`/api/evals/sessions/${sess}/tick`, { clock: 430 });
check("timeline injects arrive by the clock (units on scene + the Mayday cues)", tick.body.events.filter(e => e.cue).length === 4 && tick.body.events.some(e => /Ladder 618 on scene/.test(e.text)), tick.body.events.map(e => e.from).join());
check("a tick doesn't send the same inject twice", (await C.post(`/api/evals/sessions/${sess}/tick`, { clock: 431 })).body.events.length === 0);
check("non-WAV audio refused", (await C.post(`/api/evals/sessions/${sess}/turn`, { clock: 432, audio: Buffer.from("hello world, not audio at all").toString("base64") })).status === 400);
check("someone else's practice run is private", (await E.api(`/api/evals/sessions/${sess}`)).status === 404);
await C.page.screenshot({ path: `${SCR}/shot-sim-live.png`, fullPage: false });
await C.page.getByRole("button", { name: "End and grade" }).click(); await C.settle(2000);
const g = JSON.parse(psql(`SELECT grade FROM sim_sessions WHERE id='${sess}'`));
check("graded against the Blue Card rubric (5 elements) with Mayday cues in the prompt", g.scores.length === 5 && /spongy/.test(ai.filter(a => a.kind === "grade").pop().text) && g.pct === 66.7, g.pct);
let cb = await C.body();
check("debrief: score, scores with reasons, strengths, cues caught/missed, assignments, key decisions", /66.7%/.test(cb) && /Element 1: radio report/.test(cb) && /Clear initial radio report/.test(cb) && /Missed/.test(cb) && /12 s/.test(cb) && /Primary search/.test(cb) && /Key decisions/.test(cb));
check("replay controls on the transcript", await C.page.getByRole("button", { name: "Replay" }).count() === 1 && await C.page.getByRole("button", { name: /Play from 0:00/ }).count() > 0);
check("practice can't become an evaluation", (await C.post(`/api/evals/sessions/${sess}/result`, {})).status === 400);
await C.page.screenshot({ path: `${SCR}/shot-sim-debrief.png`, fullPage: true });

// ======= Evaluated run (Eve -> Dot isn't a candidate; enrol Dot in BC) =======
await M.post("/api/evals/candidates", { programId: bcId, userId: uid("Dot Driver"), startDate: "2026-09-01", evaluators: [] });
const dotCand = psql(`SELECT id FROM eval_candidates WHERE user_id='${uid("Dot Driver")}'`);
check("no access: can't start an evaluated run", (await N.post("/api/evals/sessions", { scenarioId: psql("SELECT id FROM sim_scenarios WHERE key='bc-a-oakridge'"), mode: "formal", candidateId: dotCand })).status === 403);
await E.page.goto(BASE); await E.settle(); await E.nav("Evaluations"); await E.nav("Working test periods");
await E.page.getByRole("button", { name: /Open Dot Driver/ }).click(); await E.settle();
await E.page.getByRole("button", { name: "Evaluated simulation" }).click(); await E.settle(600);
check("evaluated simulation shows only this program's scenarios", /Oak Ridge Apartments/.test(await E.body()) && !/Brookshire/.test(await E.body()));
await E.page.getByRole("button", { name: /Scenario Advanced Incident Command/ }).click(); await E.settle(300);
await E.page.getByLabel("Candidate", { exact: true }).selectOption({ label: "Dot Driver" });
await E.page.getByRole("button", { name: "Start" }).click(); await E.settle(1200);
await E.page.getByLabel("Type a transmission").fill("SG7 on scene, assuming Oak Ridge Command, defensive on Charlie.");
await E.page.keyboard.press("Enter"); await E.page.waitForTimeout(1500);
await E.page.getByRole("button", { name: "End and grade" }).click(); await E.settle(2000);
const es = psql(`SELECT id || ' ' || mode || ' ' || user_id FROM sim_sessions WHERE evaluator_id = '${uid("Eve Evaluator")}'`).split(" ");
check("evaluated run belongs to the candidate, run by the evaluator", es[1] === "formal" && es[2] === uid("Dot Driver"));
check("graded with the BC module A rubric", /Accurate Size-Up & Command Declaration/.test(ai.filter(a => a.kind === "grade").pop().text));
await E.page.getByRole("button", { name: "Review scores and sign" }).click(); await E.settle(900);
check("draft evaluation made from the run with the AI's scores and flags", /Formal evaluation: Dot Driver/.test(await E.body()) && await E.page.getByRole("radio", { name: /^A Accurate Size-Up & Command Declaration: 4$/ }).getAttribute("aria-checked") === "true" && /Confirm whether RIT/.test(await E.body()));
await E.page.getByLabel(/^Verified: Confirm whether RIT/).check();
await E.sign();
await E.page.getByRole("button", { name: "Sign and make official" }).click(); await E.settle(900);
check("signed: counts toward Dot's module A (64%)", psql(`SELECT status || ' ' || pct || ' ' || (session_id IS NOT NULL) FROM eval_results WHERE user_id='${uid("Dot Driver")}'`) === "final 64 true"
  && (await E.api(`/api/evals/candidates/${dotCand}`)).body.standing.modules[0].pct === 64);
check("run links to its evaluation", psql(`SELECT result_id IS NOT NULL FROM sim_sessions WHERE id='${es[0]}'`) === "t");

// ======= Conversation practice (Ned, API + UI debrief) =======
const talk = await N.post("/api/evals/sessions", { scenarioId: psql("SELECT id FROM sim_scenarios WHERE key='talk-late'"), mode: "practice" });
check("conversation opens with the member's first words", talk.body.session.transcript[0].text.startsWith("You wanted to see me?"));
const t1 = await N.post(`/api/evals/sessions/${talk.body.session.id}/turn`, { clock: 20, text: "Help me understand what's been going on in the mornings." });
check("the member answers in character and the mood moves", t1.body.replies[0].from === "FF Jordan Example" && t1.body.mood === "calmer" && /HIDDEN BACKGROUND: Jordan is defensive/.test(ai.filter(a => a.kind === "talk").pop().text));
await N.post(`/api/evals/sessions/${talk.body.session.id}/end`, { clock: 300 });
await N.page.goto(BASE); await N.settle(); await N.nav("Evaluations"); await N.nav("Simulation runs");
await N.page.getByRole("button", { name: /Open run Defensive member/ }).click(); await N.settle(800);
const nb = await N.body();
check("conversation debrief: what helped, what escalated, listening / expectations / follow-up", /What escalated it/.test(nb) && /Mentioned a write-up early/.test(nb) && /Listening:/.test(nb) && /Missing a date/.test(nb));
check("people without access see only practice: no evaluator pages", await N.page.getByRole("button", { name: "Working test periods", exact: true }).count() === 0);

// ======= Program editor (Mike): Driver/Operator form; Eve evaluates with it =======
await M.page.goto(BASE); await M.settle(); await M.nav("Evaluations"); await M.nav("Programs");
await M.page.getByRole("button", { name: "New program" }).click(); await M.settle(300);
await M.page.getByLabel("Program name").fill("Driver/Operator Evaluation");
await M.page.getByLabel("Rank").fill("Driver/Operator");
await M.page.getByLabel("Module 1 title").fill("Pump operations");
await M.page.getByLabel("Module 1 weight").fill("60");
await M.page.getByRole("button", { name: "Elements & guide" }).click();
await M.page.getByLabel("Element 1", { exact: true }).fill("Establishes water supply");
await M.page.getByRole("button", { name: "Element", exact: true }).click();
await M.page.getByLabel("Element 2", { exact: true }).fill("Correct pump discharge pressure");
await M.page.getByLabel("Element 2 weight").fill("2");
await M.page.getByRole("button", { name: "Module", exact: true }).click();
await M.page.getByLabel("Module 2 title").fill("Driving");
await M.page.getByLabel("Module 2 weight").fill("40");
await M.page.getByRole("button", { name: "Save program" }).click(); await M.settle(800);
const dop = psql("SELECT id || '|' || kind || '|' || jsonb_array_length(data->'modules') FROM eval_programs WHERE name='Driver/Operator Evaluation'").split("|");
check("new evaluation form program saved", dop[1] === "form" && dop[2] === "2" && psql(`SELECT data->'modules'->0->'elements'->1->>'mult' FROM eval_programs WHERE id='${dop[0]}'`) === "2");
const dres = await E.post("/api/evals/results", { programId: dop[0], userId: uid("Ned Nobody"), kind: "formal", modules: ["A", "B"], scores: { A: [4, 5], B: [3] }, final: true, signature: SIG });
// A: (4 + 5*2)/(5*3) = 93.3; B: 60; overall (93.3*60 + 60*40)/100 = 80
check("form evaluation across all modules, weighted overall (80%)", dres.status === 200 && dres.body.pct === 80, JSON.stringify(dres.body));
check("Ned sees his signed evaluation", (await N.api("/api/evals")).body.myResults.some(r => r.id === dres.body.id));

// ======= Scenario editor (Mike) =======
await M.nav("Scenarios");
await M.page.getByRole("button", { name: "Edit Mayday Recognition Drill: Pecan Hollow Court" }).click(); await M.settle(400);
await M.page.getByLabel("Scenario title").fill("Mayday Recognition Drill: Pecan Hollow Ct.");
await M.page.getByRole("button", { name: "Add" }).nth(1).click();
await M.page.getByLabel("Text 5").fill("Command from Ladder 618, we have a hole in the floor near the den.");
await M.page.getByRole("button", { name: "Save scenario" }).click(); await M.settle(700);
check("scenario edits saved (title + new inject)", psql("SELECT title || '|' || jsonb_array_length(data->'injects') FROM sim_scenarios WHERE key='mayday-pecan'") === "Mayday Recognition Drill: Pecan Hollow Ct.|5");
check("evaluator can't edit scenarios", (await E.post("/api/evals/scenarios", { kind: "radio", title: "x" })).status === 403);

// ======= Permissions page lists the section; audit =======
check("audit log has Evaluations entries", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Evaluations'")) >= 8);
const permSections = (await M.api("/api/access")).body;
check("permissions catalog has Evaluations & simulations", JSON.stringify(permSections).includes("Evaluations & simulations"));

// phone layout of the live run
const P = await person({ width: 390, height: 844 }); await P.login("cal@sgfd.org");
await P.nav("Evaluations").catch(() => {});
await P.page.goto(BASE); await P.settle();
const run2 = await P.post("/api/evals/sessions", { scenarioId: psql("SELECT id FROM sim_scenarios WHERE key='co-b-magnolia'"), mode: "practice" });
check("Cal can start a practice run of a linked scenario", run2.status === 200);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
done();
await browser.close(); mock.close(); process.exit(0);
