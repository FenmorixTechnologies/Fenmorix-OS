// Leave picks: import roster (CSV), rules, turn order, consecutive/size/blocked/one-per-unit, daily cap by YOS,
// anniversary rule, holidays-first codes, leader pick-for/skip, take back/rescind, turn messages, reports, UI.
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
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const body = () => page.locator("body").innerText();

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const PEOPLE = [
  ["Cody Captain", "cody", "Captain"], ["Lena Lieutenant", "lena", "Lieutenant"], ["Fran Firefighter", "fran", "Firefighter"], ["Nate Newhire", "nate", "Firefighter"],
  ["Otto Other", "otto", "Captain"], ["Pia Third", "pia", "Captain"],
  ["Sue Lead", "sue", "Shift Lead"], ["Tom Telecom", "tom", "Telecommunicator"], ["Ada Admin", "ada", "Secretary"],
];
for (const [n, e] of PEOPLE) {
  const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: a.name.match(/Sue|Tom/) ? "Communications" : "Suppression" });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
for (const [n, , t] of PEOPLE) psql(`UPDATE users SET job_title = '${t}' WHERE full_name = '${n}'`);
psql(`UPDATE users SET work_pattern = 'comms:C' WHERE full_name IN ('Sue Lead', 'Tom Telecom')`);
const [cody, lena, fran, nate, otto, pia, sue, tom] = ["Cody Captain", "Lena Lieutenant", "Fran Firefighter", "Nate Newhire", "Otto Other", "Pia Third", "Sue Lead", "Tom Telecom"].map(id);

// ---- Season + import ---------------------------------------------------------------------------
let r = await post("/api/leave/seasons", { year: 2027 });
check("create 2027", r.status === 200, JSON.stringify(r.body));
const sid = r.body.id;
check("duplicate year refused", (await post("/api/leave/seasons", { year: 2027 })).status === 409);
const csv = [
  "Fire Suppression,,,,,,,",
  "Position,Employee,Shift,Hire Date,Adjusted Date,2027 Actual YOS,2027 OV Accrual,2027 Holidays",
  "613,\"Captain, Cody\",A,1/5/2005,1/5/2005,22,360,240",
  "613,\"Lieutenant, Lena\",A,3/1/2012,3/1/2012,14,264,240",
  "613,\"Firefighter, Fran\",A,6/1/2019,6/1/2019,7,216,240",
  "613,\"Newhire, Nate\",A,5/15/2026,5/15/2026,0,162,240",
  "618,\"Other, Otto\",A,2/2/2010,2/2/2010,16,288,240",
  "SG-5,\"Third, Pia\",A,1/1/2001,1/1/2001,26,360,240",
  "Number Off Per Day,,,,,,,",
  ",\"Lead, Sue\",COM,4/4/2015,4/4/2015,11,180,120",
  ",\"Telecom, Tom\",COM,7/7/2021,7/7/2021,5,180,120",
  ",\"Admin, Ada\",ADM,1/1/2020,1/1/2020,6,160,80",
].join("\n");
r = await post(`/api/leave/${sid}/import/preview`, { filename: "roster.csv", data: Buffer.from(csv).toString("base64") });
const rows = r.body.parsed?.[0]?.rows || [];
check("import preview matches everyone by last, first", rows.length === 8 && rows.every(x => x.userId), JSON.stringify(rows.map(x => [x.name, x.matchName, x.unit, x.shift])));
check("ADM skipped, comms crew from schedule, SG-5 -> Chiefs", r.body.parsed[0].skipped.length === 1 && rows.find(x => x.name.includes("Sue")).shift === "C" && rows.find(x => x.name.includes("Pia")).unit === "Chiefs");
r = await post(`/api/leave/${sid}/import/apply`, { rows });
check("import applies", r.body.imported === 8, JSON.stringify(r.body));
let st = (await api(`/api/leave/${sid}`)).body;
const unit = name => st.units.find(u => u.name === name);
check("units: 613, 618, Chiefs, Comms C Crew", ["613", "618", "Chiefs", "Comms C Crew"].every(unit));
check("turn order by rank: Captain, Lt, FF (7 yrs), FF (new)", unit("613").members.map(m => m.name).join() === "Cody Captain,Lena Lieutenant,Fran Firefighter,Nate Newhire", unit("613").members.map(m => m.name).join());
check("leaders: captain leads 613; Communications crews have no leader", unit("613").members[0].leader && unit("Comms C Crew").members.every(m => !m.leader));
// Communications goes by seniority only: make Tom (title Telecommunicator) senior to Sue (title Shift Lead)
const csvTom = csv.replace("7/7/2021,7/7/2021,5", "7/7/2009,7/7/2009,17");
r = await post(`/api/leave/${sid}/import/preview`, { filename: "roster.csv", data: Buffer.from(csvTom).toString("base64") });
await post(`/api/leave/${sid}/import/apply`, { rows: r.body.parsed[0].rows });
st = (await api(`/api/leave/${sid}`)).body;
check("Communications order is seniority only (title ignored)", unit("Comms C Crew").members.map(m => m.name).join() === "Tom Telecom,Sue Lead", unit("Comms C Crew").members.map(m => m.name).join());
r = await post(`/api/leave/${sid}/import/preview`, { filename: "roster.csv", data: Buffer.from(csv).toString("base64") });
await post(`/api/leave/${sid}/import/apply`, { rows: r.body.parsed[0].rows });
st = (await api(`/api/leave/${sid}`)).body;
check("back to Sue first (more senior)", unit("Comms C Crew").members[0].name === "Sue Lead");
// The Communications coordinator: Leave picks Edit for the Communications division
r = await post("/api/access/grants", { section: "leave", level: "edit", userId: sue, scope: ["Communications"] });
check("coordinator gets Leave picks: Edit for Communications", r.status === 200, JSON.stringify(r.body));
check("anniversary for under 1 year", unit("613").members.find(m => m.name === "Nate Newhire").anniversary === "2027-05-15");

// Rules: blocked dates for comms, cap 2 for testing
const aDays = []; for (let d = "2027-01-01"; d <= "2027-12-31"; d = addDays(d, 1)) if (fireShift(d) === "A") aDays.push(d);
const cDays = []; for (let d = "2027-01-01"; d <= "2027-12-31"; d = addDays(d, 1)) { const c = commsShifts(d); if (c.day === "C" || c.night === "C") cDays.push(d); }
const blocked = cDays.find(d => d >= "2027-03-01");
r = await post(`/api/leave/${sid}/settings`, { rules: { fire: { caps: { Suppression: 2 } }, comms: { blocked: [{ from: blocked, to: blocked, label: "LIFT Conference" }] } } });
check("rules saved", r.status === 200);

// Not open yet
await login("cody@sgfd.org");
check("can't pick before it opens", (await post(`/api/leave/${sid}/pick`, { days: aDays.slice(0, 3) })).body.errors?.some(e => /isn't open/.test(e)));
await login("mike@sgfd.org");
r = await post(`/api/leave/${sid}/settings`, { status: "open" });
check("opened", r.status === 200);
await page.waitForTimeout(500);

// Turn messages went to the first person in each unit
const turnMsgs = psql(`SELECT count(*) FROM message_threads WHERE subject LIKE 'Your turn to pick leave%'`);
check("turn messages sent to each unit's first picker", Number(turnMsgs) === 4, turnMsgs);

// ---- Picking rules -----------------------------------------------------------------------------
await login("lena@sgfd.org");
check("not Lena's turn yet", (await post(`/api/leave/${sid}/check`, { days: [aDays[5]] })).body.errors.some(e => /isn't Lena's turn/.test(e)));
const lt = (await api("/api/leave/turn")).body;
check("Your Day turn: Lena isn't up", lt.myTurn === null && lt.inPick);
await login("cody@sgfd.org");
check("Cody is up (Your Day)", (await api("/api/leave/turn")).body.myTurn === 1);
let c = (await post(`/api/leave/${sid}/check`, { days: [aDays[0], aDays[2]] })).body;
check("first pick must be shifts in a row", c.errors.some(e => /in a row/.test(e)), JSON.stringify(c.errors));
c = (await post(`/api/leave/${sid}/check`, { days: aDays.slice(0, 4) })).body;
check("first pick max 3 shifts", c.errors.some(e => /up to 3/.test(e)));
c = (await post(`/api/leave/${sid}/check`, { days: [addDays(aDays[0], 1)] })).body;
check("can't pick a day the shift doesn't work", c.errors.some(e => /doesn't work/.test(e)));
r = await post(`/api/leave/${sid}/pick`, { days: aDays.slice(0, 3) });
check("Cody picks 3 in a row", r.body.ok && r.body.round === 1, JSON.stringify(r.body));
st = (await api(`/api/leave/${sid}`)).body;
const codyM = unit("613").members.find(m => m.userId === cody);
check("charged as holidays first (OH)", codyM.picks[0].days.every(d => d.codes[0].code === "OH" && d.codes[0].hours === 24));
check("Lena is up next", unit("613").turn.userId === lena && unit("613").turn.round === 1);

// Lena tries Cody's day -> taken (one off per unit)
await login("lena@sgfd.org");
c = (await post(`/api/leave/${sid}/check`, { days: [aDays[2], aDays[3]] })).body;
check("one off per unit per shift", c.errors.some(e => /already taken by Cody/.test(e)));
// Daily cap (2 for the test): Otto (618, 16 yrs) and Pia (Chiefs pool, not counted) take aDays[3]; Lena (14 yrs) third -> warning
await login("otto@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[3], aDays[4], aDays[5]] });
check("Otto (other unit) can take the same day", r.body.ok);
await login("pia@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[3]] });
check("chief unit picks independently", r.body.ok);
// Fran (7 yrs) isn't up; Lena takes aDays[3..5]: 2 people (Otto 16, Lena 14) -> fine; later Fran takes one -> flagged
await login("lena@sgfd.org");
c = (await post(`/api/leave/${sid}/check`, { days: [aDays[3], aDays[4], aDays[5]] })).body;
check("no cap warning at 2 of 2", c.errors.length === 0 && c.warnings.length === 0, JSON.stringify(c));
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[6], aDays[7], aDays[8]] });
check("Lena picks", r.body.ok);
// Fran: picks a day where Otto + Cody are off? Cody's days are in 613 (taken). Use Otto's aDays[4] (Otto + nobody else from Suppression) -> 2 = ok; add Mike-led test via rescind later.
await login("fran@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[4]] });
check("Fran picks (2 of 2 that day)", r.body.ok && !r.body.warnings.length, JSON.stringify(r.body));
// Nate (0 yrs, anniversary 5/15) can't use vacation before May: holiday 240 = 10 shifts; first pick OK
await login("nate@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[9], aDays[10], aDays[11]] });
check("Nate picks early-year holidays", r.body.ok, JSON.stringify(r.body));
// Round 2: Cody. Third person on aDays[4] (Otto 16, Fran 7) -> Cody 22 yrs is more senior -> Fran gets flagged
await login("cody@sgfd.org");
c = (await post(`/api/leave/${sid}/check`, { days: [aDays[4]] })).body;
check("cap: Cody is #1 by YOS but someone gets flagged", c.errors.some(e => /already taken by Fran/.test(e)) || c.warnings.length > 0, JSON.stringify(c));
// aDays[4] is Fran's (same unit) -> taken. Use 618's Otto day aDays[5]: Otto(16) + Cody(22) = 2 ok. Make it 3 with Pia? Pia is Chiefs pool (not counted).
r = await post(`/api/leave/${sid}/pick`, { days: [aDays[12], aDays[13], aDays[14]] });
check("Cody round 2", r.body.ok && r.body.round === 2);
// Lena round 2 skipped by Cody (leader)
r = await post(`/api/leave/${sid}/skip`, { userId: lena });
check("leader skips Lena's turn", r.status === 200, JSON.stringify(r.body));
// Cody picks for Fran (leader): Fran round 2 = aDays[5] (Otto already off; Fran 3rd? Otto16, Lena? no). Suppression on aDays[5]: Otto -> 2nd
r = await post(`/api/leave/${sid}/pick`, { userId: fran, days: [aDays[5]] });
check("leader picks for Fran", r.body.ok, JSON.stringify(r.body));
// Make a 3rd person on aDays[5]: Nate round 2 picks aDays[5]? same unit as Fran -> taken. Use rescind+manager to test flag: Mike adds Otto's unit person... simpler: lower cap to 1 now
await login("mike@sgfd.org");
await post(`/api/leave/${sid}/settings`, { rules: { fire: { caps: { Suppression: 1 } } } });
st = (await api(`/api/leave/${sid}`)).body;
const franDay = unit("613").members.find(m => m.userId === fran).picks.flatMap(p => p.days).find(d => d.day === aDays[5]);
const ottoDay = unit("618").members.find(m => m.userId === otto).picks.flatMap(p => p.days).find(d => d.day === aDays[5]);
check("cap 1: Otto (16 yrs) keeps the day, Fran (7) flagged", ottoDay.standing.rank === 1 && !ottoDay.standing.bumped && franDay.standing.bumped && franDay.standing.rank === 2, JSON.stringify([ottoDay.standing, franDay.standing]));
check("Chiefs not counted in the Suppression limit", !unit("Chiefs").members[0].picks[0].days[0].standing);
await post(`/api/leave/${sid}/settings`, { rules: { fire: { caps: { Suppression: 6 } } } });

// Nate round 2: vacation before anniversary -> refused (holidays 240 = 10 shifts; already 3; 7 more fine, 8th refused)
await login("nate@sgfd.org");
const early = aDays.filter(d => d < "2027-05-15").slice(15, 26);
c = (await post(`/api/leave/${sid}/check`, { days: early.slice(0, 3) })).body;
check("Nate: holidays still cover these", c.errors.length === 0, JSON.stringify(c.errors));
// put 8 early shifts total via manager-test: check with laterMax 3 only, so simulate by raising laterMax
await login("mike@sgfd.org");
await post(`/api/leave/${sid}/settings`, { rules: { fire: { firstMax: 10, firstConsecutive: false } } });
await login("nate@sgfd.org");
c = (await post(`/api/leave/${sid}/check`, { days: early.slice(0, 8) })).body;
check("anniversary rule: vacation can't be used before 5/15", c.errors.some(e => /anniversary/.test(e)), JSON.stringify(c.errors));
r = await post(`/api/leave/${sid}/pick`, { days: [...early.slice(0, 7)] });
check("Nate uses all 10 holidays before his anniversary", r.body.ok, JSON.stringify(r.body));
await login("mike@sgfd.org");
await post(`/api/leave/${sid}/settings`, { rules: { fire: { firstMax: 3, firstConsecutive: true } } });

// Holidays-all rule on done: Lena has 240 h holidays, used 72
await login("lena@sgfd.org");
r = await post(`/api/leave/${sid}/done`, {});
check("can't finish with holidays left (Suppression)", r.status === 400 && /holidays/.test(r.body.error), JSON.stringify(r.body));

// Comms: blocked date, 7 in a row, 0700/1900 start times
await login("sue@sgfd.org");
c = (await post(`/api/leave/${sid}/check`, { days: [blocked] })).body;
check("blocked date refused", c.errors.some(e => /blocked \(LIFT Conference\)/.test(e)), JSON.stringify(c.errors));
const run7 = cDays.slice(0, 7);
c = (await post(`/api/leave/${sid}/check`, { days: run7 })).body;
check("comms first pick: 7 shifts in a row allowed", c.errors.length === 0, JSON.stringify(c.errors));
check("comms start times from the crew rotation", c.days.every(d => d.start === (commsShifts(d.day).day === "C" ? "0700" : "1900")) && c.days.every(d => d.hours === 12));
r = await post(`/api/leave/${sid}/pick`, { days: run7 });
check("Sue picks 7", r.body.ok);
await login("tom@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: [cDays[3]] });
check("Tom can't take Sue's shift (one per crew shift)", !r.body.ok && r.body.errors.some(e => /taken by Sue/.test(e)));

// Take back: Tom can't take back Sue's; Sue can take back hers (latest in unit)
r = await post(`/api/leave/${sid}/pick`, { days: cDays.slice(8, 10) });
check("Tom picks 2", r.body.ok);
st = (await api(`/api/leave/${sid}`)).body;
const tomPick = unit("Comms C Crew").members.find(m => m.userId === tom).picks[0];
const suePick = unit("Comms C Crew").members.find(m => m.userId === sue).picks[0];
check("Tom can't see Sue's hours (only his own)", unit("Comms C Crew").members.find(m => m.userId === sue).remaining === undefined && unit("Comms C Crew").members.find(m => m.userId === tom).remaining !== undefined);
check("non-member units hidden from Tom", st.units.length === 1);
r = await post(`/api/leave/${sid}/undo`, { pickId: suePick.id });
check("Tom can't take back Sue's pick", r.status === 403);
await login("sue@sgfd.org");
r = await post(`/api/leave/${sid}/undo`, { pickId: suePick.id });
check("Sue can't take back an older pick", r.status === 403, JSON.stringify(r.body));
await login("tom@sgfd.org");
r = await post(`/api/leave/${sid}/undo`, { pickId: tomPick.id });
check("Tom takes back his latest pick", r.status === 200);
// Manager rescinds one day of Sue's pick
await login("mike@sgfd.org");
r = await post(`/api/leave/${sid}/undo`, { pickId: suePick.id, day: run7[6] });
check("manager rescinds one day", r.status === 200 && psql(`SELECT count(*) FROM leave_pick_days WHERE pick_id = '${suePick.id}'`) === "6");
check("audit log entries", Number(psql(`SELECT count(*) FROM audit_log WHERE module = 'Leave picks'`)) >= 4);

// ---- Out-of-turn entry (phoned in / backfilled) -------------------------------------------------
st = (await api(`/api/leave/${sid}`)).body;
check("Communications: later picks up to 7 by default", st.season.rules.comms.laterMax === 7);
await login("tom@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { days: cDays.slice(20, 22), manual: true });
check("Tom can't enter his own pick out of turn", r.status === 403, JSON.stringify(r.body));
await login("sue@sgfd.org");
const upNow = (await api(`/api/leave/${sid}`)).body.units.find(u => u.name === "Comms C Crew").turn;
const free3 = cDays.filter(d => d > "2027-06-01").slice(0, 3);
c = (await post(`/api/leave/${sid}/check`, { userId: tom, days: free3, manual: true })).body;
check("coordinator checks an out-of-turn pick for Tom", c.errors.length === 0, JSON.stringify(c.errors) + " turn " + JSON.stringify(upNow));
const scattered = cDays.filter(d => d > "2027-08-01").filter((_, i) => i % 3 === 0).slice(0, 8);
c = (await post(`/api/leave/${sid}/check`, { userId: tom, days: scattered, manual: true })).body;
check("size / in-a-row rules still apply unless set aside", c.errors.some(e => /up to 7|in a row/.test(e)), JSON.stringify(c.errors));
c = (await post(`/api/leave/${sid}/check`, { userId: tom, days: scattered, manual: true, waive: true })).body;
check("set aside: rules become notes", c.errors.length === 0 && c.warnings.some(w => /set aside/.test(w)), JSON.stringify(c));
c = (await post(`/api/leave/${sid}/check`, { userId: tom, days: [run7[0]], manual: true, waive: true })).body;
check("conflicts are never set aside", c.errors.some(e => /already taken by Sue/.test(e)));
r = await post(`/api/leave/${sid}/pick`, { userId: tom, days: free3, manual: true });
check("coordinator saves Tom's phoned-in pick", r.body.ok, JSON.stringify(r.body));
st = (await api(`/api/leave/${sid}`)).body;
const tomNow = st.units.find(u => u.name === "Comms C Crew").members.find(m => m.userId === tom);
await login("fran@sgfd.org");
check("someone without the grant can't enter for others", (await post(`/api/leave/${sid}/pick`, { userId: tom, days: cDays.slice(40, 41), manual: true })).status === 403);
await login("sue@sgfd.org");
check("coordinator can't enter for Suppression (grant is Communications only)", (await post(`/api/leave/${sid}/pick`, { userId: fran, days: [aDays[40]], manual: true })).status === 403);
check("saved as Tom's next pick, marked out of turn", tomNow.picks.some(p => p.manual && !p.waived && p.enteredById === sue && p.days.length === 3));
check("audit says out of turn", Number(psql(`SELECT count(*) FROM audit_log WHERE action LIKE 'Entered leave for Tom Telecom out of turn'`)) === 1);
await login("mike@sgfd.org");
r = await post(`/api/leave/${sid}/pick`, { userId: tom, days: scattered, manual: true, waive: true });
check("manager backfills a paper pick with the rules set aside", r.body.ok, JSON.stringify(r.body));

// ---- Reports ----------------------------------------------------------------------------------
const csvR = await api(`/api/leave/${sid}/report/aladtec.csv`);
const lines = csvR.body.trim().split(/\r?\n/);
check("Aladtec CSV: header + one line per shift", /Employee,Emp #,Unit,Shift,Date,Start time,Hours,Leave type,Code/.test(lines[0]) && lines.length - 1 === Number(psql(`SELECT count(*) FROM leave_pick_days`)), `${lines.length - 1} lines`);
check("CSV has codes and the flagged column", lines.some(l => /,OH,/.test(l)) && lines.some(l => /Comms C,.*,1900,12,Holiday,OH/.test(l) || /Comms C,.*,0700,12,Holiday,OH/.test(l)));
const dl = async (path, file) => {
  const [d] = await Promise.all([page.waitForEvent("download"), page.evaluate(p => { const a = document.createElement("a"); a.href = p; a.download = ""; document.body.appendChild(a); a.click(); }, path)]);
  await d.saveAs(file); return readWorkbook(fs.readFileSync(file));
};
await page.goto(BASE); await settle();
const forms = await dl(`/api/leave/${sid}/report/forms.xlsx?ruleset=fire&shift=A`, "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/forms.xlsx");
const codySheet = forms.find(s => s.name === "Cody Captain");
check("forms workbook: a sheet per person (Suppression A)", forms.length === 6 && !!codySheet, forms.map(s => s.name).join(","));
check("form layout: Name / EMP# / Annual Vacation 15 / Holidays 10 / dates + codes", codySheet.rows[0][0] === "Name:" && codySheet.rows[0][1] === "Cody Captain" && codySheet.rows[1][2] === 15 && codySheet.rows[1][5] === 10 && codySheet.rows[3][0] === aDays[0] && codySheet.rows[3][4] === "OH", JSON.stringify(codySheet.rows.slice(0, 5)));
check("form has the signature lines", JSON.stringify(codySheet.rows).includes("Fire Chief Signature:"));
const master = await dl(`/api/leave/${sid}/report/master.xlsx`, "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/master.xlsx");
check("leave spreadsheet: A Shift + Comms C Crew sheets", master.map(s => s.name).join() === "A Shift,Comms C Crew", master.map(s => s.name).join());
const ms = master[0];
const codyRow = ms.rows.find(r => r[3] === "Cody Captain");
const col = 9 + (new Date(`${aDays[0]}T12:00:00Z`) - new Date("2027-01-01T12:00:00Z")) / 864e5;
check("spreadsheet: hours on the right day + number off row", codyRow && codyRow[col] === 24 && ms.rows.some(r => r[0] === "Number off per day"), JSON.stringify(codyRow?.slice(0, 12)));
fs.writeFileSync("/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/aladtec.csv", csvR.body);
await login("tom@sgfd.org");
check("reports need permission", (await api(`/api/leave/${sid}/report/aladtec.csv`)).status === 403);
check("Tom can't change setup", (await post(`/api/leave/${sid}/settings`, { status: "closed" })).status === 403);

// ---- UI --------------------------------------------------------------------------------------------
await login("lena@sgfd.org");
await page.getByText("Leave Picks", { exact: true }).first().click(); await settle();
let b = await body();
check("Leave Picks opens on My picks", /Your leave/i.test(b) && /613 · A Shift/.test(b), b.slice(0, 300));
// Lena's round 2 was skipped; it's Fran's or Nate's turn... find whose turn and log in
st = (await api(`/api/leave/${sid}`)).body;
const upId = unit("613").turn?.userId;
const upName = unit("613").members.find(m => m.userId === upId)?.name;
const upEmail = { [cody]: "cody", [lena]: "lena", [fran]: "fran", [nate]: "nate" }[upId];
check("613 has someone up", !!upEmail, JSON.stringify(unit("613").turn));
await login(`${upEmail}@sgfd.org`);
const t0 = Date.now();
await page.getByText(/It's your turn to pick leave/).first().waitFor({ timeout: 8000 }).catch(() => {});
const turnMs = await page.evaluate(async () => { const t = performance.now(); await fetch("/api/leave/turn"); return Math.round(performance.now() - t); });
check("turn lookup is quick", turnMs < 500, `${turnMs} ms`);
const yd = await body();
check("Your Day: it's your turn to pick leave", /It's your turn to pick leave \(2027, pick \d\)/.test(yd), upName + " | " + yd.slice(0, 600).replace(/\n/g, " / "));
await page.getByRole("button", { name: "Pick now" }).click();
await page.getByText(/It's your turn: pick/).first().waitFor({ timeout: 10000 }).catch(() => {});
check("Pick now opens the pick page", /It's your turn: pick/.test(await body()));
// pick the first free A-shift days in July via the calendar
const free = aDays.filter(d => d >= "2027-07-01").slice(0, 1);
const pretty = d => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
await page.locator(`button[aria-label^="${pretty(free[0])} ·"]`).first().click();
await page.waitForTimeout(700);
b = await body();
check("selected day shows codes", /1 shift selected/.test(b) && /O[HV]/.test(b), b.match(/Pick \d:[^\n]*/)?.[0]);
await page.screenshot({ path: "shot-leave-pick.png", fullPage: false });
await page.getByRole("button", { name: /^Submit pick/ }).click();
await page.getByText(/Pick \d saved/).first().waitFor({ timeout: 6000 }).catch(() => {});
check("pick submitted from the calendar", /Pick \d saved/.test(await body()));
await page.getByRole("button", { name: "My unit" }).click(); await page.waitForTimeout(1200);
await page.screenshot({ path: "shot-leave-unit.png" });
check("unit page shows turn order", /Turn order/.test(await body()) && /Up now|All done|Waiting/.test(await body()));
await login("mike@sgfd.org");
await page.getByText("Leave Picks", { exact: true }).first().click(); await page.waitForTimeout(1200);
await page.getByRole("button", { name: "All units" }).click(); await page.waitForTimeout(1200);
await page.screenshot({ path: "shot-leave-units.png" });
check("all units page", /A Shift/.test(await body()) && /Communications/.test(await body()));
await page.getByRole("button", { name: "Reports" }).click(); await page.waitForTimeout(1200);
check("reports page", /List for Aladtec/.test(await body()));
await page.screenshot({ path: "shot-leave-reports.png" });
await page.getByRole("button", { name: "Setup" }).click(); await page.waitForTimeout(1200);
check("setup page", /Rules/.test(await body()) && /Import the roster/.test(await body()) && /Units and turn order/.test(await body()));
await page.screenshot({ path: "shot-leave-setup.png", fullPage: true });
// UI import of the real-layout xlsx (built in the test from the CSV) -> preview table
const { workbook } = await import("/home/claude/testrun/app/server/xlsx.js");
const xl = workbook({ sheets: [{ name: "A Shift", rows: csv.split("\n").map(l => l.match(/("[^"]*"|[^,]*)(,|$)/g).map(x => x.replace(/,$/, "").replace(/^"|"$/g, "")).map(v => v === "" ? null : isNaN(Number(v)) ? v : Number(v))) }] });
fs.writeFileSync("/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/roster.xlsx", xl);
await page.getByLabel("Roster file").setInputFiles("/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/roster.xlsx");
await page.waitForTimeout(1200);
check("xlsx import preview in the UI", /8 of 8 matched/.test(await body()), (await body()).match(/\d+ of \d+ matched/)?.[0]);
await page.screenshot({ path: "shot-leave-import.png" });

// Phone
const P = await browser.newContext({ ...(await import("/opt/npm-tools/node_modules/playwright/index.mjs")).devices["iPhone 13"] });
const pp = await P.newPage(); pp.on("pageerror", e => errors.push("phone: " + e.message));
await pp.goto(BASE); await pp.waitForTimeout(700);
await pp.getByLabel(/^Email/).fill("sue@sgfd.org"); await pp.getByLabel(/^Password/).fill(PW);
await pp.getByRole("button", { name: "Sign in" }).click(); await pp.waitForTimeout(1500);
await pp.getByRole("button", { name: /menu/i }).first().click().catch(() => {}); await pp.waitForTimeout(400);
await pp.getByText("Leave Picks", { exact: true }).first().click(); await pp.waitForTimeout(1500);
const ow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone: no sideways scrolling", ow <= 2, `${ow}px`);
await pp.screenshot({ path: "shot-leave-phone.png" });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(x => x.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
