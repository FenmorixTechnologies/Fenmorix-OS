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
import { execSync } from "node:child_process";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const S = await import("/home/claude/sgfd-app/src/shifts.js");
const msg = (path, body) => body === undefined ? api(`/api/messages${path}`) : post(`/api/messages${path}`, body);
await page.goto(BASE); await settle();
psql("DELETE FROM access_groups WHERE is_default"); // these suites build their own groups (pre-017)
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
const people = [["Olivia Ops", "olivia@sgfd.org", "Administration"], ["Fred Floor", "fred@sgfd.org", "Suppression"], ["Bea Bravo", "bea@sgfd.org", "Suppression"], ["Tina Tech", "tina@sgfd.org", "Technology"]];
for (const [n, e, d] of people) await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: e, division: d, password: PW });
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: people.find(x => x[0] === a.name)[2] });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
const [olivia, fred, bea, tina] = ["Olivia Ops", "Fred Floor", "Bea Bravo", "Tina Tech"].map(id);
// Which Fire shift is working right now (server local time)? Fred gets that one, Bea another.
const now = new Date(); const day = new Date(now); if (now.getHours() < 7) day.setDate(day.getDate() - 1);
const onLetter = S.fireShift(day.toLocaleDateString("en-CA")); const offLetter = ["A", "B", "C"].find(l => l !== onLetter);
psql(`UPDATE users SET work_pattern = 'fire:${onLetter}' WHERE id = '${fred}'`);
psql(`UPDATE users SET work_pattern = 'fire:${offLetter}' WHERE id = '${bea}'`);

// ---- Direct message: Fred -> Tina, from the screen
await login("fred@sgfd.org");
await page.getByRole("navigation").getByRole("button", { name: /^Messages/ }).click(); await settle();
await page.getByRole("button", { name: /New$/ }).first().click(); await settle();
await page.getByLabel("To", { exact: true }).fill("Tina");
await page.getByRole("option", { name: /Tina Tech/ }).click();
check("can't pick groups without permission", /needs permission/.test(await page.getByRole("form", { name: "New message" }).innerText()));
await page.getByLabel("Subject").fill("Laptop for Station 61");
await page.getByLabel("Message", { exact: true }).fill("Can you set up the new laptop for 61 this week?");
await page.getByRole("button", { name: /^Send$/ }).click(); await settle();
check("sent toast", /Sent to 1 person/.test(await body()));
check("non-permitted group send refused", (await msg("", { body: "x", everyone: true })).status === 403);

await login("tina@sgfd.org");
await page.getByText(/New message from Fred Floor: Laptop for Station 61/).first().waitFor({ timeout: 8000 }).catch(() => {});
check("Your Day shows the new message", /New message from Fred Floor: Laptop for Station 61/.test(await body()));
check("side bar badge", /Messages\s*1/.test(await page.getByRole("navigation").innerText()));
await page.getByRole("button", { name: "Read" }).first().click(); await settle();
check("Read opens the conversation", await page.getByRole("article", { name: "Laptop for Station 61" }).isVisible());
await page.getByLabel("Reply").fill("Will do, Thursday.");
await page.getByRole("button", { name: /^Reply$/ }).click(); await settle();
check("reply shows", /Will do, Thursday\./.test(await page.getByRole("article").innerText()));
await page.getByLabel("Reply").click();
await page.keyboard.type("Line one"); await page.keyboard.press("Shift+Enter"); await page.keyboard.type("line two");
check("Shift+Enter makes a new line, doesn't send", (await page.getByLabel("Reply").inputValue()) === "Line one\nline two");
await page.keyboard.press("Enter"); await settle();
check("Enter sends the reply", (await page.getByLabel("Reply").inputValue()) === "" && /Line one\s+line two/.test(await page.getByRole("article").innerText()));
const ft = (await msg("")).body.threads[0];
await login("fred@sgfd.org");
const fsum = (await msg("/summary")).body;
check("Fred sees the reply as unread", fsum.unread === 1, JSON.stringify(fsum));
await login("bea@sgfd.org");
check("others can't open it", (await msg(`/${ft.id}`)).status === 404);

// ---- Group message at next shift (Olivia has permission)
await login("mike@sgfd.org");
const gA = (await post("/api/access/groups", { name: `${onLetter}-Shift`, rules: { patterns: [`fire:${onLetter}`] } })).body.id;
const gB = (await post("/api/access/groups", { name: `${offLetter}-Shift`, rules: { patterns: [`fire:${offLetter}`] } })).body.id;
await post("/api/access/grants", { section: "messages", level: "edit", userId: olivia });
await login("olivia@sgfd.org");
const opts = (await msg("/people")).body;
check("permitted sender sees groups and Everyone", opts.canBroadcast && opts.groups.length === 2 && opts.everyoneCount === 5, JSON.stringify(opts));
const sent = (await msg("", { subject: "Hydrant testing", body: "Hydrant testing on Airline Hwy starts at 0800.", groups: [gA, gB], timing: "next_shift", important: true })).body;
check("sent to both shifts, one waits for their shift", sent.recipients === 2 && sent.waiting === 1, JSON.stringify(sent));
await login("fred@sgfd.org");
const fIn = (await msg("")).body.threads.find(t => t.subject === "Hydrant testing");
check("on-shift Fred gets it now", !!fIn && fIn.important);
await login("bea@sgfd.org");
check("off-shift Bea doesn't see it yet", !(await msg("")).body.threads.some(t => t.subject === "Hydrant testing"));
psql(`UPDATE message_recipients SET deliver_at = now() - interval '1 minute' WHERE user_id = '${bea}'`);   // her shift starts
await page.reload(); await settle();
await page.getByText(/Important message from Olivia Ops/).first().waitFor({ timeout: 8000 }).catch(() => {});
check("at her shift: important message tops Your Day", /Important message from Olivia Ops: Hydrant testing/.test(await body()));

// Fred replies to the broadcast -> only Olivia sees it
await login("fred@sgfd.org");
await msg(`/${fIn.id}/reply`, { body: "Copy, E61 will be out." });
await login("bea@sgfd.org");
const bThread = (await msg(`/${fIn.id}`)).body;
check("members don't see each other's replies", bThread.posts.length === 1 && /Replies go only to Olivia Ops/.test(bThread.replyNote));
check("members don't get the recipient list", bThread.participants.length === 0 && bThread.receipts === null);
await login("olivia@sgfd.org");
const oThread = (await msg(`/${fIn.id}`)).body;
check("sender sees the private reply", oThread.posts.some(p => p.body === "Copy, E61 will be out." && p.privateTo));
check("read receipts", oThread.receipts.length === 2 && oThread.receipts.filter(r => r.readAt).length === 2, JSON.stringify(oThread.receipts));
await msg(`/${fIn.id}/reply`, { body: "Update: starts 0900 now." });
await login("bea@sgfd.org");
check("sender's follow-up reaches everyone", (await msg(`/${fIn.id}`)).body.posts.some(p => /0900/.test(p.body)));

// Archive, then a new reply brings it back
await login("tina@sgfd.org");
await msg(`/${ft.id}/archive`, { archived: true });
check("archived leaves the inbox", !(await msg("")).body.threads.some(t => t.id === ft.id) && (await msg("?box=archived")).body.threads.some(t => t.id === ft.id));
await login("fred@sgfd.org");
await msg(`/${ft.id}/reply`, { body: "Thanks!" });
await login("tina@sgfd.org");
check("new reply un-archives", (await msg("")).body.threads.some(t => t.id === ft.id && t.unread));

// Everyone
await login("olivia@sgfd.org");
const all = (await msg("", { subject: "Holiday schedule", body: "Posted on the board.", everyone: true })).body;
check("everyone = everyone on the roster but me", all.recipients === 5, JSON.stringify(all));
check("group sends are in the audit log", Number(psql("SELECT count(*) FROM audit_log WHERE module = 'Messages'")) === 2);

// Screens
await page.setViewportSize({ width: 1400, height: 900 });
await page.getByRole("navigation").getByRole("button", { name: /^Messages/ }).click(); await settle();
await page.getByRole("navigation").getByRole("button", { name: "Sent" }).click(); await settle();
await page.getByRole("listitem", { name: /Hydrant testing/ }).click(); await settle();
await page.getByRole("button", { name: /Read by/ }).click();
await page.screenshot({ path: "/home/claude/testrun/shot-messages-thread.png" });
await page.getByRole("navigation").getByRole("button", { name: "New message" }).click(); await settle();
await page.getByLabel("To", { exact: true }).fill("shift");
await page.waitForTimeout(200);
await page.screenshot({ path: "/home/claude/testrun/shot-messages-compose.png" });
const list = page.getByRole("listbox");
check("suggestions open while typing", await list.isVisible());
await page.getByRole("option", { name: /A-Shift|B-Shift/ }).first().click();
check("picking one closes the list", !(await list.isVisible()));
await page.getByLabel("To", { exact: true }).fill("Fred");
check("typing reopens it", await list.isVisible());
await page.keyboard.press("Tab");
check("Tab closes it", !(await list.isVisible()));
check("Tab moves on to the Subject", await page.getByLabel("Subject").evaluate(el => el === document.activeElement));
await page.getByLabel("To", { exact: true }).fill("Tina");
await page.getByLabel("Message", { exact: true }).click();
check("clicking elsewhere closes it", !(await list.isVisible()));
await page.getByLabel("To", { exact: true }).fill("Tina");
await page.keyboard.press("Escape");
check("Escape closes it", !(await list.isVisible()));
check("no page errors", errors.length === 0, errors.join("; "));
console.log(results.join("\n"));
await browser.close();
