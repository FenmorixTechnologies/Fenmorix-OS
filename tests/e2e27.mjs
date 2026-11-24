// Leave picks, part 2: locked roster entries (no Nexus account yet), editing the import, re-import updates,
// unlocking on approval, completed picks filed in the Personnel File, shift officers (notices, reports).
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
const { fireShift, commsShifts, addDays } = await import("/home/claude/testrun/app/src/shifts.js");
const { readWorkbook } = await import("/home/claude/testrun/app/server/xlsx.js");

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: "America/Chicago", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("dialog", d => d.accept());
process.on("uncaughtException", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n").slice(0, 3).join(" ")); process.exit(1); });
const pending = new Map();
page.on("request", r => pending.set(r, r.url())); page.on("requestfinished", r => pending.delete(r)); page.on("requestfailed", r => pending.delete(r));
const settle = async () => {
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); }
  catch (e) { throw new Error("settle timed out; pending: " + [...pending.values()].join(", ")); }
  await page.waitForTimeout(350);
};
const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const ct = res.headers.get("content-type") || "";
  return { status: res.status, body: ct.includes("json") ? await res.json() : ct.includes("csv") ? await res.text() : { size: (await res.arrayBuffer()).byteLength }, ct };
}, [path, opts]);
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE).catch(() => page.waitForTimeout(500).then(() => page.goto(BASE))); await settle();
  await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await page.waitForTimeout(1500);
}
const body = () => page.locator("body").innerText();
const signup = async (n, e, division = "Suppression") => {
  const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division, password: PW });
  await reg.context().close();
};
const inbox = (who, like) => Number(psql(`SELECT count(*) FROM message_threads t JOIN message_recipients r ON r.thread_id = t.id JOIN users u ON u.id = r.user_id WHERE u.full_name = '${who}' AND t.subject LIKE '${like}'`));

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const PEOPLE = [["Cody Captain", "cody", "Captain"], ["Lena Lieutenant", "lena", "Lieutenant"], ["Ben Battalion", "ben", "Battalion Chief"], ["Ada Admin", "ada", "Secretary"]];
for (const [n, e] of PEOPLE) await signup(n, e);
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t] of PEOPLE) psql(`UPDATE users SET job_title = '${t}' WHERE full_name = '${n}'`);
const [cody, lena, ben] = ["Cody Captain", "Lena Lieutenant", "Ben Battalion"].map(id);

// ---- Import with people who aren't in Nexus yet ---------------------------------------------------
let r = await post("/api/leave/seasons", { year: 2027 });
const sid = r.body.id;
const head = "Position,Employee,Shift,Emp #,Hire Date,Adjusted Date,2027 Actual YOS,2027 OV Accrual,2027 Holidays";
const csv1 = [head,
  "613,\"Captain, Cody\",A,1001,1/5/2005,1/5/2005,22,24,0",
  "613,\"Lieutenant, Lena\",A,1002,3/1/2012,3/1/2012,14,48,0",
  "613,\"Ghost, Gus\",A,1003,6/1/2019,6/1/2019,7,24,0",
  "618,\"Hopeful, Hal\",A,1004,2/2/2018,2/2/2018,9,48,0",
].join("\n");
r = await post(`/api/leave/${sid}/import/preview`, { filename: "roster.csv", data: Buffer.from(csv1).toString("base64") });
let rows = r.body.parsed[0].rows;
const row = n => rows.find(x => x.name.includes(n));
check("preview: Gus and Hal have no Nexus account; all new", !row("Gus").userId && !row("Hal").userId && row("Cody").userId === cody && rows.every(x => x.status === "new"), JSON.stringify(rows.map(x => [x.name, x.userId, x.status])));
check("preview gives the display name", row("Gus").displayName === "Gus Ghost");
// Edit the list before importing: Hal actually goes to B Shift
row("Hal").shift = "B";
r = await post(`/api/leave/${sid}/import/apply`, { rows });
check("import adds everyone, 2 locked", r.body.added === 4 && r.body.locked === 2, JSON.stringify(r.body));
let st = (await api(`/api/leave/${sid}`)).body;
const all = () => st.units.flatMap(u => u.members.map(m => ({ ...m, unit: u })));
const mem = n => all().find(m => m.name === n);
check("Gus is on the roster, locked, with his roster name", mem("Gus Ghost")?.locked === true && mem("Gus Ghost").userId === null, JSON.stringify(mem("Gus Ghost")));
check("edited shift used: Hal on 618 · B Shift", mem("Hal Hopeful")?.unit.label === "618 · B Shift", mem("Hal Hopeful")?.unit.label);
check("people list for linking accounts (managers)", Array.isArray(st.people) && st.people.some(p => p.id === cody));

// ---- Newer roster updates the existing ------------------------------------------------------------
const csv2 = [head,
  "613,\"Captain, Cody\",A,1001,1/5/2005,1/5/2005,22,24,0",
  "613,\"Lieutenant, Lena\",A,1002,3/1/2012,3/1/2012,14,48,0",
  "613,\"Ghost, Gus\",A,1003,6/1/2019,6/1/2019,7,24,0",
  "620,\"Incoming, Ivy\",B,1005,8/8/2020,8/8/2020,6,48,0",
].join("\n");
r = await post(`/api/leave/${sid}/import/preview`, { filename: "roster.csv", data: Buffer.from(csv2).toString("base64") });
rows = r.body.parsed[0].rows;
check("re-import preview: existing people update (Gus matched to his locked entry)", row("Gus").status === "update" && row("Gus").memberId === mem("Gus Ghost").id && row("Cody").status === "update", JSON.stringify(rows.map(x => [x.name, x.status])));
check("re-import preview: Ivy is new", row("Ivy").status === "new");
check("re-import preview lists Hal as missing (not removed)", r.body.missing.length === 1 && r.body.missing[0].name === "Hal Hopeful", JSON.stringify(r.body.missing));
row("Lena").vacation = 72;
r = await post(`/api/leave/${sid}/import/apply`, { rows });
check("re-import: 1 added, 3 updated", r.body.added === 1 && r.body.updated === 3, JSON.stringify(r.body));
st = (await api(`/api/leave/${sid}`)).body;
check("no duplicates; Hal kept; Lena's hours updated", all().length === 5 && mem("Hal Hopeful") && mem("Lena Lieutenant").vacation === 72, all().map(m => m.name).join());
r = await post(`/api/leave/${sid}/member`, { memberId: mem("Hal Hopeful").id, remove: true });
check("take Hal out by hand", r.body.ok && (await api(`/api/leave/${sid}`)).body.units.flatMap(u => u.members).length === 4);
r = await post(`/api/leave/${sid}/member`, { name: "Wes Walkon", userId: null, unit: { ruleset: "fire", shift: "B", name: "620", pool: "Suppression" }, yos: 1, vacation: 24, holiday: 0 });
st = (await api(`/api/leave/${sid}`)).body;
check("add someone without an account by hand", r.body.ok && mem("Wes Walkon")?.locked && mem("Wes Walkon").unit.label === "620 · B Shift", JSON.stringify(r.body));
r = await post(`/api/leave/${sid}/member`, { memberId: mem("Wes Walkon").id, name: "Wes Walk-On", unit: { ruleset: "fire", shift: "B", name: "620", pool: "Suppression" }, yos: 1, vacation: 24, holiday: 0 });
st = (await api(`/api/leave/${sid}`)).body;
check("edit a locked person's name", !!mem("Wes Walk-On"));
r = await post(`/api/leave/${sid}/member`, { memberId: mem("Wes Walk-On").id, userId: cody, unit: { ruleset: "fire", shift: "B", name: "620", pool: "Suppression" } });
check("can't link an account that's already on the roster", r.status === 409, JSON.stringify(r.body));

// ---- Shift officers, open, locked person's turn --------------------------------------------------
r = await post(`/api/leave/${sid}/settings`, { rules: { fire: { officers: { A: [ben], B: [], C: [] } } } });
check("shift officers saved", r.status === 200 && (await api(`/api/leave/${sid}`)).body.season.rules.fire.officers.A[0] === ben);
st = (await api(`/api/leave/${sid}`)).body;
const u613 = st.units.find(u => u.label === "613 · A Shift");
const order = [mem("Gus Ghost").id, mem("Cody Captain").id, mem("Lena Lieutenant").id];
r = await post(`/api/leave/${sid}/order`, { unitId: u613.id, memberIds: order, leaders: [mem("Cody Captain").id] });
check("reorder by member id (Gus first)", r.status === 200);
r = await post(`/api/leave/${sid}/settings`, { status: "open" });
await page.waitForTimeout(600);
st = (await api(`/api/leave/${sid}`)).body;
check("Gus (locked) is up in 613", st.units.find(u => u.id === u613.id).turn?.memberId === mem("Gus Ghost").id && st.units.find(u => u.id === u613.id).turn.locked);
check("his leader Cody is messaged to enter it", inbox("Cody Captain", "Leave pick: Gus Ghost is up%") === 1);
check("Ivy (locked, no leader) goes to a coordinator or the opener", Number(psql(`SELECT count(*) FROM message_threads WHERE subject LIKE 'Leave pick: Ivy Incoming is up%'`)) === 1);
await login("cody@sgfd.org");
const turn = (await api("/api/leave/turn")).body;
check("Cody's Your Day says Gus needs it entered", /Gus Ghost \(no Nexus account yet/.test(turn.unitUp || ""), JSON.stringify(turn));
const aDays = []; for (let d = "2027-01-01"; d <= "2027-12-31"; d = addDays(d, 1)) if (fireShift(d) === "A") aDays.push(d);
r = await post(`/api/leave/${sid}/pick`, { memberId: mem("Gus Ghost").id, days: [aDays[2]] });
check("leader picks for the locked person", r.body.ok, JSON.stringify(r.body));
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[4]] });
check("Cody's own pick", r.body.ok, JSON.stringify(r.body));
await login("ada@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { memberId: mem("Lena Lieutenant").id, days: [aDays[6]] });
check("someone else can't pick for Lena", r.status === 403);

// ---- Gus gets his Nexus account: unlocks ---------------------------------------------------------
await signup("Gus Ghost", "gus");
await login("mike@sgfd.org");
const pend = (await api("/api/auth/accounts")).body.accounts.find(a => a.status === "pending" && a.name === "Gus Ghost");
await post("/api/auth/approve", { id: pend.id, role: "user", division: "Suppression" });
await page.waitForTimeout(800);
st = (await api(`/api/leave/${sid}`)).body;
check("approval links Gus's roster entry and unlocks it", mem("Gus Ghost")?.userId === pend.id && !mem("Gus Ghost").locked, JSON.stringify(mem("Gus Ghost")));
check("the pick his leader entered is now his", psql(`SELECT count(*) FROM leave_picks WHERE user_id = '${pend.id}'`) === "1");
check("Gus's 2027 record filed (24 h, done)", psql(`SELECT count(*) FROM leave_records WHERE user_id = '${pend.id}'`) === "1");

// ---- Completed picks -> Personnel File; officer notices -------------------------------------------
await login("lena@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[6], aDays[7], aDays[8]] });
check("Lena picks all 72 h", r.body.ok, JSON.stringify(r.body));
await page.waitForTimeout(500);
check("Lena told her picks are filed", inbox("Lena Lieutenant", "Your 2027 leave picks are complete") === 1);
let rec = (await api("/api/leave/records")).body.records;
check("Lena's Personnel File has her dates and types", rec.length === 1 && rec[0].lines.length === 3 && rec[0].lines.every(l => l.code === "OV") && rec[0].totals.OV === 72, JSON.stringify(rec));
check("613 done -> Ben (A Shift officer) told", inbox("Ben Battalion", "Leave picks complete: 613 · A Shift") === 1);
check("whole A Shift done -> Ben told", inbox("Ben Battalion", "A Shift leave picks are complete%") === 1);
check("officer notices not sent for B Shift (no officers, not done)", Number(psql(`SELECT count(*) FROM message_threads WHERE subject LIKE 'B Shift leave picks%'`)) === 0);
await login("ada@sgfd.org");
check("Ada (no leave access) can't see Lena's leave record", (await api(`/api/leave/records?user=${lena}`)).body.records.length === 0);
check("Ada has no Reports", (await api(`/api/leave/${sid}/report/aladtec.csv`)).status === 403);

// ---- Shift officer: sees his shift, reports for it ------------------------------------------------
await login("ben@sgfd.org");
const list = (await api("/api/leave")).body;
check("Ben (officer, no Leave picks permission) sees 2027", list.seasons.some(s => s.id === sid));
st = (await api(`/api/leave/${sid}`)).body;
check("Ben sees A Shift units only, with full detail", st.access.officer.join() === "A" && st.units.every(u => u.shift === "A") && st.units.length > 0 && st.units[0].members.every(m => m.remaining !== undefined), st.units.map(u => u.label).join());
let csvR = await api(`/api/leave/${sid}/report/aladtec.csv`);
check("Ben's report: A Shift only", csvR.status === 200 && /Lena Lieutenant/.test(csvR.body) && !/Ivy/.test(csvR.body), csvR.body.slice(0, 200));
csvR = await api(`/api/leave/${sid}/report/aladtec.csv?shift=B`);
check("Ben can't pull B Shift", csvR.status === 200 && !/Ivy|Walk/.test(csvR.body) && csvR.body.trim().split("\n").length === 1);
check("Ben sees Lena's record in her file", (await api(`/api/leave/records?user=${lena}`)).body.records.length === 1);
csvR = await api(`/api/leave/${sid}/report/aladtec.csv?member=${mem("Lena Lieutenant").id}`);
check("per-person report", csvR.body.trim().split("\n").length === 4 && csvR.body.split("\n").slice(1).every(l => !l || l.startsWith("Lena")), csvR.body);

// ---- Changes after completion: record reopened, then refiled ---------------------------------------
await login("mike@sgfd.org");
const lp = (await api(`/api/leave/${sid}`)).body.units.flatMap(u => u.members).find(m => m.name === "Lena Lieutenant").picks[0];
r = await post(`/api/leave/${sid}/undo`, { pickId: lp.id, day: aDays[8] });
check("manager rescinds one of Lena's days", r.body.ok, JSON.stringify(r.body));
check("Lena's record marked reopened", psql(`SELECT status FROM leave_records WHERE user_id = '${lena}'`) === "reopened");
check("613 complete flag reset", psql(`SELECT complete_notified FROM leave_units WHERE id = '${u613.id}'`) === "f");
await login("lena@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[10]] });
check("Lena picks again", r.body.ok, JSON.stringify(r.body));
check("record refiled with the change", psql(`SELECT status || ' ' || revisions || ' ' || jsonb_array_length(lines) FROM leave_records WHERE user_id = '${lena}'`) === "complete 1 3");
check("filed message not repeated", inbox("Lena Lieutenant", "Your 2027 leave picks are complete") === 1);
check("Ben told 613 finished again", inbox("Ben Battalion", "Leave picks complete: 613 · A Shift") === 2);

// ---- UI ----------------------------------------------------------------------------------------------
await page.getByText("Personnel File", { exact: true }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: /Leave picks/ }).first().click(); await page.waitForTimeout(1200);
let b = await body();
check("Personnel File: Leave picks tab shows the 2027 record", /2027 leave picks · 613 · A Shift/.test(b) && /Vacation 72 h/.test(b), b.slice(0, 500).replace(/\n/g, " / "));
await page.screenshot({ path: "shot-leave-pfile.png" });
await login("ben@sgfd.org");
await page.getByText("Leave Picks", { exact: true }).first().click(); await page.waitForTimeout(1500);
b = await body();
check("Ben: My shift + Reports", /My shift/.test(b) && /Reports/.test(b));
await page.getByRole("button", { name: "Reports" }).click(); await page.waitForTimeout(1200);
b = await body();
check("Ben's reports page: shift officer note + summary", /shift officer for A Shift/.test(b) && /Lena Lieutenant/.test(b) && /Done/.test(b), b.slice(0, 600).replace(/\n/g, " / "));
await page.getByLabel("Report person").selectOption({ label: "Lena Lieutenant · 613 · A Shift" }); await page.waitForTimeout(400);
b = await body();
check("per-person view in Reports", /Lena Lieutenant's Annual Leave Request Form/.test(b));
await page.screenshot({ path: "shot-leave-officer.png" });
await login("mike@sgfd.org");
await page.getByText("Leave Picks", { exact: true }).first().click(); await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Setup" }).click(); await page.waitForTimeout(1500);
b = await body();
check("Setup: shift officers card with Ben on A", /Shift officers/.test(b) && /Ben Battalion/.test(b));
check("Setup: locked count shown (Ivy, Wes)", /2 locked/.test(b), (b.match(/\d+ locked/) || [])[0]);
const xl = (await import("/home/claude/testrun/app/server/xlsx.js")).workbook({ sheets: [{ name: "A Shift", rows: csv2.split("\n").map(l => l.match(/("[^"]*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "")).filter((x, i, a) => i < a.length - 1 || x !== "").map(v => v === "" ? null : isNaN(Number(v)) ? v : Number(v))) }] });
const f = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/roster2.xlsx";
fs.writeFileSync(f, xl);
await page.getByLabel("Roster file").setInputFiles(f); await page.waitForTimeout(1500);
b = await body();
check("UI preview: update/new status and shift dropdowns", /Already here: updates/.test(b) && /New/.test(b) && await page.getByLabel("Shift for Incoming, Ivy").count() === 1, b.match(/\d+ of \d+ matched[^\n]*/)?.[0]);
await page.getByLabel("Shift for Incoming, Ivy").selectOption("fire:C");
check("shift dropdown changes the row", await page.getByLabel("Shift for Incoming, Ivy").inputValue() === "fire:C");
await page.screenshot({ path: "shot-leave-import2.png" });
check("Import button counts everyone with a shift and unit", /Import 4 people/.test(await body()));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(x => x.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
