// Messages round 2: delete (per person, purge when everyone has), bulk actions, chat window,
// live events (two people signed in at once), notifications, important banner, next-shift delivery notice.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
process.on("uncaughtException", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
process.on("unhandledRejection", e => { console.log(results.join("\n")); console.log("ERR", e.message.split("\n")[0]); process.exit(1); });
const errors = [];

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 1350, height: 950 }, timezoneId: "America/Chicago" });
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept());
  // Record desktop notifications
  await page.addInitScript(() => {
    window.__notes = [];
    const N = function (title, opts) { window.__notes.push({ title, ...opts }); this.close = () => {}; };
    N.permission = "granted"; N.requestPermission = async () => "granted";
    window.Notification = N;
  });
  const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [path, opts]);
  const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
  const settle = async (ms = 500) => { await page.waitForLoadState("load"); await page.waitForTimeout(ms); };
  async function login(email) {
    await ctx.clearCookies(); await page.goto(BASE); await settle();
    await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click(); await settle(900);
  }
  return { ctx, page, api, post, settle, login, body: () => page.locator("body").innerText() };
}

const A = await person();     // Mike (admin)
await A.page.goto(BASE); await A.settle();
await A.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Fred Floor", "fred"], ["Bea Bravo", "bea"], ["Cal Charlie", "cal"]]) {
  await A.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await A.login("mike@sgfd.org");
for (const a of (await A.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await A.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
const [fred, bea, cal, mike] = ["Fred Floor", "Bea Bravo", "Cal Charlie", "Mike Admin"].map(id);
check("live updates on", (await A.api("/api/auth/me")).body.live === true);

const F = await person(); await F.login("fred@sgfd.org");
const B = await person(); await B.login("bea@sgfd.org");

// ---- Presence + chat window ------------------------------------------------------------------
await F.page.getByRole("button", { name: /^Chat/ }).click(); await F.settle(800);
let fb = await F.body();
check("chat window opens with Online now", /Online now/i.test(fb) && /Bea/.test(fb), fb.slice(0, 200));
const people = (await F.api("/api/messages/people")).body.people;
check("people list marks Bea online, Cal not", people.find(p => p.id === bea)?.online === true && people.find(p => p.id === cal)?.online === false);
await F.page.getByLabel("Find someone to chat with").fill("bea");
await F.page.getByRole("button", { name: /Bea Bravo/ }).first().click(); await F.settle(700);
check("new chat view", /Say hello to Bea/.test(await F.body()));
await F.page.getByLabel("Message", { exact: true }).fill("Hey Bea, got a minute?");
await F.page.keyboard.press("Enter"); await F.settle(900);
check("Fred's chat bubble shows", /Hey Bea, got a minute\?/.test(await F.body()));

// Bea gets it live: pop-up + chime path + badge, without reloading
await B.page.waitForTimeout(1200);
let bb = await B.body();
check("Bea gets a live pop-up", /Fred Floor/.test(bb) && /Hey Bea, got a minute/.test(bb), bb.slice(-300));
check("Bea's chat button shows unread", await B.page.getByRole("button", { name: /Chat, 1 unread/ }).count() === 1);
await B.page.getByRole("button", { name: "Reply" }).first().click(); await B.settle(800);
await B.page.getByLabel("Message", { exact: true }).fill("Sure, what's up?");
await B.page.keyboard.press("Enter"); await B.settle(300);
await F.page.waitForTimeout(1200);
check("Fred sees Bea's reply live in the open chat", /Sure, what's up\?/.test(await F.body()));
const pops = await F.page.locator("[aria-live=polite] [role=status]").allInnerTexts();
check("no pop-up for the chat Fred has open", !pops.length, pops.join(" | "));
await F.page.screenshot({ path: "shot-chat-window.png" });
await B.page.screenshot({ path: "shot-chat-bea.png" });
const chatIds = psql(`SELECT count(*) FROM message_threads WHERE kind = 'chat'`);
// A second chat between the same two continues the same conversation
await B.post("/api/messages/chat", { userId: fred, body: "One more thing" });
check("same pair reuses one chat", psql(`SELECT count(*) FROM message_threads WHERE kind = 'chat'`) === chatIds && chatIds === "1");
const chatId = psql(`SELECT id FROM message_threads WHERE kind = 'chat'`);
check("chat shows in Messages inbox", (await F.api("/api/messages?box=inbox")).body.threads.some(t => t.id === chatId && t.kind === "chat" && t.with?.name === "Bea Bravo"));

// ---- Important message: urgent banner + desktop notification that stays ---------------------
await F.page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
await A.post("/api/messages", { users: [fred], subject: "Station 61 water main", body: "Boil advisory at 61 until further notice.", important: true });
await F.page.waitForTimeout(1500);
const notes = await F.page.evaluate(() => window.__notes);
const imp = notes.find(n => /IMPORTANT/.test(n.title));
check("desktop notification for important, stays on screen", !!imp && imp.requireInteraction === true, JSON.stringify(notes).slice(0, 300));
const titles = []; for (let i = 0; i < 6; i++) { titles.push(await F.page.title()); await F.page.waitForTimeout(450); }
check("tab title blinks while hidden", titles.some(t => /Important message/.test(t)) && titles.some(t => !/Important message/.test(t)), titles.join(" / "));
await F.page.evaluate(() => { delete document.hidden; });
fb = await F.body();
check("red banner for unread important", /IMPORTANT MESSAGE/i.test(fb) && /Station 61 water main/.test(fb));
await F.page.screenshot({ path: "shot-important.png" });
await F.page.getByRole("button", { name: "Read it" }).first().click(); await F.settle(900);
fb = await F.body();
check("Read it opens the message in Messages", /Boil advisory at 61/.test(fb));
await F.page.waitForTimeout(600);
check("banner gone once read", !/IMPORTANT MESSAGE/i.test(await F.body()));

// ---- Delete and bulk ----------------------------------------------------------------------------
for (let i = 1; i <= 4; i++) await A.post("/api/messages", { users: [fred, bea], subject: `Notice ${i}`, body: `Body ${i}`, privateReplies: false });
await F.page.waitForTimeout(800);
await F.page.getByRole("button", { name: "Inbox" }).first().click(); await F.settle(800);
await F.page.getByRole("checkbox", { name: "Select all" }).check(); await F.settle(300);
fb = await F.body();
check("select all shows the bulk bar", /selected/.test(fb) && /Mark read/.test(fb), fb.match(/\d+ selected/)?.[0]);
await F.page.screenshot({ path: "shot-bulk.png" });
await F.page.getByRole("button", { name: "Mark read" }).click(); await F.settle(700);
check("bulk mark read", (await F.api("/api/messages/summary")).body.unread === 0);
// tick two notices and delete them
await F.page.getByRole("checkbox", { name: "Select Notice 1" }).check();
await F.page.getByRole("checkbox", { name: "Select Notice 2" }).check();
await F.page.getByRole("toolbar").getByRole("button", { name: "Delete" }).click(); await F.settle(800);
let inbox = (await F.api("/api/messages?box=inbox")).body.threads.map(t => t.subject);
check("Fred's deleted notices are gone", !inbox.includes("Notice 1") && !inbox.includes("Notice 2") && inbox.includes("Notice 3"), inbox.join(", "));
check("not in archived either", !(await F.api("/api/messages?box=archived")).body.threads.some(t => /Notice [12]/.test(t.subject)));
const n1 = psql(`SELECT id FROM message_threads WHERE subject = 'Notice 1'`);
check("still there for Bea (and kept in the database)", (await B.api("/api/messages?box=inbox")).body.threads.some(t => t.subject === "Notice 1") && !!n1);
check("Fred can't open a deleted one", (await F.api(`/api/messages/${n1}`)).status === 404);
// A reply brings back just the new post
await B.post(`/api/messages/${n1}/reply`, { body: "Bea's later reply" });
const back = (await F.api(`/api/messages/${n1}`)).body;
check("new reply after delete shows only the new post", back.posts?.length === 1 && back.posts[0].body === "Bea's later reply", JSON.stringify(back.posts?.map(p => p.body)));
// Everyone deletes -> removed for good
await F.post("/api/messages/bulk", { ids: [n1], action: "delete" });
await B.post("/api/messages/bulk", { ids: [n1], action: "delete" });
check("not purged while the sender still has it", psql(`SELECT count(*) FROM message_threads WHERE id = '${n1}'`) === "1");
await A.post(`/api/messages/${n1}/delete`, {});
check("purged once everyone deleted it", psql(`SELECT count(*) FROM message_threads WHERE id = '${n1}'`) === "0" && psql(`SELECT count(*) FROM message_posts WHERE thread_id = '${n1}'`) === "0");
// bulk archive / unarchive / unread; someone else's ids are ignored
const n3 = psql(`SELECT id FROM message_threads WHERE subject = 'Notice 3'`), n4 = psql(`SELECT id FROM message_threads WHERE subject = 'Notice 4'`);
await F.post("/api/messages/bulk", { ids: [n3, n4], action: "archive" });
check("bulk archive", (await F.api("/api/messages?box=archived")).body.threads.filter(t => /Notice [34]/.test(t.subject)).length === 2);
await F.post("/api/messages/bulk", { ids: [n3], action: "unarchive" });
await F.post("/api/messages/bulk", { ids: [n3], action: "unread" });
check("bulk unarchive + unread", (await F.api("/api/messages/summary")).body.unread === 1);
const C = await person(); await C.login("cal@sgfd.org");
await C.post("/api/messages/bulk", { ids: [n4], action: "delete" });
check("Cal can't delete a conversation he's not in", psql(`SELECT count(*) FROM message_threads WHERE id = '${n4}'`) === "1" && psql(`SELECT count(*) FROM message_recipients WHERE thread_id = '${n4}' AND cleared_at IS NOT NULL`) === "0");
check("bad action refused", (await F.post("/api/messages/bulk", { ids: [n3], action: "explode" })).status === 400);
// Delete from inside a conversation (UI)
await F.page.reload(); await F.settle(900);
await F.page.getByText("Messages", { exact: true }).first().click(); await F.settle(900);
await F.page.getByRole("button", { name: /Notice 3 from Mike/ }).click(); await F.settle(700);
await F.page.getByRole("article").getByRole("button", { name: "Delete" }).click(); await F.settle(800);
check("delete from the open conversation", !(await F.api("/api/messages?box=inbox")).body.threads.some(t => t.subject === "Notice 3"));

// ---- Next-shift delivery gets a live notice when it arrives ---------------------------------------
await C.page.evaluate(() => { window.__notes = []; });
await A.post("/api/messages", { users: [cal], subject: "Shift brief", body: "Read before roll call" });
psql(`UPDATE message_recipients SET deliver_at = now() + interval '3 seconds' WHERE user_id = '${cal}' AND thread_id = (SELECT id FROM message_threads WHERE subject = 'Shift brief')`);
await C.page.waitForTimeout(500);
const early = (await C.api("/api/messages/summary")).body.unread;
await C.page.waitForTimeout(24_000);
check("next-shift message announced when delivered", /Shift brief/.test(await C.body()) && early === 0, `early unread ${early}`);

// ---- Live: Messages screen list updates by itself -------------------------------------------------
await B.page.getByText("Messages", { exact: true }).first().click(); await B.settle(900);
await A.post("/api/messages", { users: [bea], subject: "Live list test", body: "appears without reload" });
await B.page.waitForTimeout(1500);
check("Messages list updates live", /Live list test/.test(await B.body()));

// ---- Sign-out closes the live stream ------------------------------------------------------------
const before = (await A.api("/api/messages/people")).body.people.find(p => p.id === cal)?.online;
await C.post("/api/auth/logout", {});
await C.page.close();
await A.page.waitForTimeout(800);
const after = (await A.api("/api/messages/people")).body.people.find(p => p.id === cal)?.online;
check("presence drops when Cal leaves", before === true && after === false, `${before} -> ${after}`);
const sse = await A.page.evaluate(async () => { const r = await fetch("/api/events"); const ok = r.headers.get("content-type"); r.body.cancel(); return ok; });
check("events stream is text/event-stream", /event-stream/.test(sse || ""));
const anon = await (await browser.newContext()).newPage(); await anon.goto(BASE);
check("events need sign-in", (await anon.evaluate(async () => (await fetch("/api/events")).status)) === 401);

// ---- Phone: chat opens full screen ------------------------------------------------------------
const P = await browser.newContext({ ...(await import("/opt/npm-tools/node_modules/playwright/index.mjs")).devices["iPhone 13"] });
const pp = await P.newPage(); pp.on("pageerror", e => errors.push("phone: " + e.message));
await pp.goto(BASE); await pp.waitForTimeout(600);
await pp.getByLabel(/^Email/).fill("bea@sgfd.org"); await pp.getByLabel(/^Password/).fill(PW);
await pp.getByRole("button", { name: "Sign in" }).click(); await pp.waitForTimeout(1200);
await pp.getByRole("button", { name: /^Chat/ }).click(); await pp.waitForTimeout(800);
const box = await pp.getByRole("dialog", { name: "Chat" }).boundingBox();
const vh = await pp.evaluate(() => window.innerHeight);
check("phone: chat is full screen", box && box.width >= 380 && box.height >= vh - 1, JSON.stringify(box) + " vh " + vh);
await pp.getByRole("button", { name: /Chat with Fred Floor/ }).first().click(); await pp.waitForTimeout(800);
await pp.screenshot({ path: "shot-chat-phone.png" });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
