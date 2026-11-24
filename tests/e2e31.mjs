// Push notifications (Web Push, decrypted by a mock push service) and chat status
// (Busy / Do not disturb / Out of office: chats diverted to Messages, away messages, quiet alerts).
// Run with: PUSH_ALLOW_HTTP=1 LIVE_EVENTS=on ./reset-db.sh
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { execSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
const PW = "Correct horse battery";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const errors = [];
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- A pretend push service that decrypts what Nexus sends -------------------------------------
const devices = new Map();     // name -> { ecdh, pub, auth }
function device(name) {
  const ecdh = crypto.createECDH("prime256v1"); const pub = ecdh.generateKeys(); const auth = crypto.randomBytes(16);
  devices.set(name, { ecdh, pub, auth });
  return { endpoint: `http://127.0.0.1:3111/push/${name}`, keys: { p256dh: pub.toString("base64url"), auth: auth.toString("base64url") } };
}
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
function decrypt(name, buf) {
  const d = devices.get(name);
  const salt = buf.subarray(0, 16), idlen = buf[20], as = buf.subarray(21, 21 + idlen), ct = buf.subarray(21 + idlen);
  const shared = d.ecdh.computeSecret(as);
  const ikm = hmac(hmac(d.auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), d.pub, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const dc = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  dc.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([dc.update(ct.subarray(0, -16)), dc.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString());
}
function verifyVapid(header) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || "");
  if (!m) return null;
  const [h, b, s] = m[1].split(".");
  const raw = Buffer.from(m[2], "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  const ok = crypto.verify("sha256", Buffer.from(`${h}.${b}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
  return { ok, claims: JSON.parse(Buffer.from(b, "base64url").toString()), k: m[2] };
}
const got = [];               // { name, data, headers, vapid }
const mock = http.createServer((req, res) => {
  const chunks = []; req.on("data", c => chunks.push(c));
  req.on("end", () => {
    const name = req.url.split("/").pop();
    if (name === "gone") { res.writeHead(410); return res.end(); }
    try { got.push({ name, data: decrypt(name, Buffer.concat(chunks)), headers: req.headers, vapid: verifyVapid(req.headers.authorization) }); }
    catch (e) { got.push({ name, error: e.message }); }
    res.writeHead(201); res.end();
  });
}).listen(3111);
const pushesFor = name => got.filter(g => g.name === name);

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 1350, height: 950 }, timezoneId: "America/Chicago" });
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept());
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

const A = await person();
await A.page.goto(BASE); await A.settle();
await A.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
for (const [n, e] of [["Fred Floor", "fred"], ["Bea Bravo", "bea"], ["Cal Charlie", "cal"]]) {
  await A.page.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
await A.login("mike@sgfd.org");
for (const a of (await A.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await A.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const id = n => psql(`SELECT id FROM users WHERE full_name = '${n}'`);
const [fred, bea, cal] = ["Fred Floor", "Bea Bravo", "Cal Charlie"].map(id);

const F = await person(); await F.login("fred@sgfd.org");
const B = await person(); await B.login("bea@sgfd.org");
const C = await person(); await C.login("cal@sgfd.org");

// ---- Push: key, subscribe, deliver -----------------------------------------------------------------
const key = (await B.api("/api/push/key")).body.key;
check("server key is a 65-byte P-256 point", Buffer.from(key, "base64url").length === 65 && Buffer.from(key, "base64url")[0] === 4);
check("key is stored and stays the same", (await F.api("/api/push/key")).body.key === key && psql("SELECT count(*) FROM settings WHERE key = 'vapid'") === "1");
const beaPhone = device("beaphone");
let r = await B.post("/api/push/subscribe", { subscription: beaPhone, label: "iPhone" });
check("Bea adds her phone", r.status === 200 && r.body.devices.length === 1 && r.body.devices[0].label === "iPhone", JSON.stringify(r));
check("bad subscription refused", (await B.post("/api/push/subscribe", { subscription: { endpoint: "nope" } })).status === 400);

r = await B.post("/api/push/test", {});
await wait(500);
let p = pushesFor("beaphone").at(-1);
check("test push arrives and decrypts", p?.data?.body?.includes("Test notification"), JSON.stringify(p));
check("push is signed (VAPID) for the push service's origin", p?.vapid?.ok === true && p.vapid.claims.aud === "http://127.0.0.1:3111" && p.vapid.k === key && p.vapid.claims.exp > Date.now() / 1000);
check("push headers: aes128gcm + TTL", p?.headers["content-encoding"] === "aes128gcm" && Number(p.headers.ttl) > 0);

r = await F.post("/api/messages", { users: [bea], subject: "Engine 61 inspection", body: "Please sign off on the E61 inspection by Friday." });
await wait(700);
p = pushesFor("beaphone").at(-1);
check("message pushes to Bea's phone", p?.data?.title === "Fred Floor" && /Engine 61 inspection/.test(p.data.body) && p.data.url === `/?thread=${r.body.id}`, JSON.stringify(p?.data));
check("no push to the sender", pushesFor("beaphone").length === 2);
const firstMsg = r.body.id;

r = await F.post("/api/messages/chat", { userId: bea, body: "Coffee run?" });
await wait(700);
p = pushesFor("beaphone").at(-1);
check("chat pushes with a chat link", p?.data?.body === "Coffee run?" && p.data.url === `/?chat=${r.body.id}`);
const chatId = r.body.id;

await B.post("/api/push/device", { endpoint: beaPhone.endpoint, importantOnly: true });
const before = pushesFor("beaphone").length;
await F.post("/api/messages", { users: [bea], subject: "Routine", body: "Routine note" });
await wait(600);
check("important-only device skips routine messages", pushesFor("beaphone").length === before);
await F.post("/api/messages", { users: [bea], subject: "Water main break", body: "Station 3 has no water", important: true });
await wait(700);
p = pushesFor("beaphone").at(-1);
check("important message comes through", pushesFor("beaphone").length === before + 1 && /^IMPORTANT · Fred Floor/.test(p.data.title) && p.data.important === true && p.headers.urgency === "high");
await B.post("/api/push/device", { endpoint: beaPhone.endpoint, importantOnly: false });

// A device the push service says is gone is removed
await B.post("/api/push/subscribe", { subscription: { ...device("gone"), endpoint: "http://127.0.0.1:3111/push/gone" }, label: "Old tablet" });
check("two devices listed", (await B.api("/api/push/devices")).body.devices.length === 2);
await F.post("/api/messages", { users: [bea], subject: "Hello", body: "hello" });
await wait(700);
check("gone device removed automatically", (await B.api("/api/push/devices")).body.devices.map(d => d.label).join() === "iPhone");

// The service worker file
const sw = await B.page.evaluate(async () => { const r = await fetch("/sw.js"); return { ct: r.headers.get("content-type"), cc: r.headers.get("cache-control"), text: await r.text() }; });
check("sw.js served fresh as JavaScript", /javascript/.test(sw.ct) && sw.cc === "no-cache" && /showNotification/.test(sw.text));

// ---- Status: UI --------------------------------------------------------------------------------
await B.page.reload(); await B.settle(900);
await B.page.getByRole("button", { name: /^Chat/ }).click(); await B.settle(700);
await B.page.getByRole("button", { name: /My status: Available/ }).click(); await B.settle(400);
check("status picker shows the four choices", (await Promise.all(["Available", "Busy", "Do not disturb", "Out of office"].map(x => B.page.getByText(x, { exact: true }).count()))).every(n => n >= 1));
await B.page.getByRole("radio").nth(2).check();
await B.page.getByRole("textbox", { name: "Away message" }).fill("In a budget meeting until 3.");
await B.page.getByLabel("Go back to Available").selectOption("1h");
await B.page.getByRole("button", { name: "Save status" }).click(); await B.settle(700);
let st = (await B.api("/api/messages/status")).body;
check("Bea is on Do not disturb for an hour", st.status === "dnd" && st.message === "In a budget meeting until 3." && Math.abs(new Date(st.until) - Date.now() - 3600_000) < 120_000, JSON.stringify(st));
let bb = await B.body();
check("Bea sees her status banner", /You're set to Do not disturb until/.test(bb));
check("chat list status button updates", await B.page.getByRole("button", { name: /My status: Do not disturb/ }).count() === 1);
check("past end time refused", (await B.post("/api/messages/status", { status: "busy", until: new Date(Date.now() - 60_000).toISOString() })).status === 400);
check("unknown status refused", (await B.post("/api/messages/status", { status: "napping" })).status === 400);

const ppl = (await F.api("/api/messages/people")).body.people;
const pb = ppl.find(x => x.id === bea);
check("others see Bea's status and away message", pb.status === "dnd" && pb.statusLabel === "Do not disturb" && pb.statusMessage === "In a budget meeting until 3." && pb.statusUntil);

// Fred chats Bea: it goes to her Messages inbox, he sees the away message
const notesBefore = await B.page.evaluate(() => window.__notes.length);
const bPushBefore = pushesFor("beaphone").length;
await F.page.reload(); await F.settle(800);
await F.page.getByRole("button", { name: /^Chat/ }).click(); await F.settle(700);
await F.page.getByRole("button", { name: /Chat with Bea Bravo/ }).first().click(); await F.settle(900);
let fb = await F.body();
check("Fred's chat shows Bea is on Do not disturb", /Bea is on Do not disturb/.test(fb) && /In a budget meeting until 3/.test(fb) && /chats go to their Messages inbox/.test(fb), fb.slice(0, 400));
await F.page.getByLabel("Message", { exact: true }).fill("Can you cover the 1500 inspection?");
await F.page.keyboard.press("Enter"); await F.settle(900);
fb = await F.body();
check("Fred sees it was sent to her Messages inbox", /Sent to Bea’s Messages inbox \(Do not disturb/.test(fb) && /Away message:/.test(fb), fb.slice(-500));
check("chat thread didn't get it", psql(`SELECT count(*) FROM message_posts WHERE thread_id = '${chatId}' AND body LIKE 'Can you cover%'`) === "0");
const div = psql(`SELECT id FROM message_threads WHERE subject = 'Chat from Fred Floor (while you were on Do not disturb)'`);
check("diverted message is a normal message to Bea", div && psql(`SELECT kind FROM message_threads WHERE id = '${div}'`) === "message"
  && psql(`SELECT count(*) FROM message_recipients WHERE thread_id = '${div}' AND user_id = '${bea}'`) === "1");
await F.page.getByLabel("Message", { exact: true }).fill("Never mind, Cal has it.");
await F.page.keyboard.press("Enter"); await F.settle(900);
check("second chat joins the same message", psql(`SELECT count(*) FROM message_threads WHERE subject LIKE 'Chat from Fred Floor (while%'`) === "1"
  && psql(`SELECT count(*) FROM message_posts WHERE thread_id = '${div}' AND author_id = '${fred}'`) === "2");
const auto = psql(`SELECT count(*) FROM message_posts WHERE author_id = '${bea}' AND private_to = '${fred}' AND body LIKE 'Automatic reply · Do not disturb%'`);
check("one automatic reply to Fred", auto === "1", auto);
await B.page.waitForTimeout(900);
bb = await B.body();
check("Bea gets no pop-up or desktop alert", !/Can you cover the 1500/.test(bb) && (await B.page.evaluate(() => window.__notes.length)) === notesBefore);
check("Bea's phone isn't buzzed", pushesFor("beaphone").length === bPushBefore);
const inbox = (await B.api("/api/messages?box=inbox")).body.threads;
check("it's waiting in Bea's Messages inbox, unread", inbox.some(t => t.id === div && t.unread && t.kind === "message"));
check("Fred's sent box has the automatic reply visible", (await F.api(`/api/messages/${div}`)).body.posts.some(x => /^Automatic reply/.test(x.body) && x.author === "Bea Bravo"));
check("Bea's chat thread to Fred untouched", (await B.api(`/api/messages/${chatId}`)).body.posts.length === 1);

// Important still gets through on DND
await F.post("/api/messages", { users: [bea], subject: "Structure fire recall", body: "All hands recall", important: true });
await B.page.waitForTimeout(1000);
check("important message still alerts Bea (pop-up + phone)", /Structure fire recall|All hands recall/.test(await B.body()) && pushesFor("beaphone").length === bPushBefore + 1);

// ---- Out of office with automatic replies ----------------------------------------------------------
await C.post("/api/messages/status", { status: "away", message: "On vacation until the 20th. Call Battalion 1 for anything urgent." });
r = await F.post("/api/messages", { users: [cal], subject: "SCBA fit test", body: "When can you do your fit test?" });
const ar = (await F.api(`/api/messages/${r.body.id}`)).body.posts;
check("out of office: automatic reply to direct message", ar.length === 2 && /^Automatic reply · Out of office\nOn vacation until the 20th/.test(ar[1].body) && ar[1].author === "Cal Charlie", JSON.stringify(ar.map(x => x.body)));
r = await F.post("/api/messages", { users: [cal], subject: "Second", body: "One more thing" });
check("only one automatic reply per person", (await F.api(`/api/messages/${r.body.id}`)).body.posts.length === 1);
await C.post("/api/messages/status", { status: "away", message: "Back Monday." });
r = await F.post("/api/messages", { users: [cal], subject: "Third", body: "Third note" });
check("a new away message replies again", (await F.api(`/api/messages/${r.body.id}`)).body.posts.at(-1).body === "Automatic reply · Out of office\nBack Monday.");
// A reply in a conversation with Cal also gets his away message (once)
await C.post("/api/messages/status", { status: "away", message: "Still out." });
await F.post(`/api/messages/${firstMsg}/reply`, { body: "ping" });  // Cal isn't in this one: nothing
check("no automatic reply where Cal isn't in the conversation", psql(`SELECT count(*) FROM message_posts WHERE thread_id = '${firstMsg}' AND body LIKE 'Automatic reply%'`) === "0");
r = await F.post("/api/messages", { users: [cal], subject: "Thread", body: "Starting this", }); // gets 'Still out.'
await F.post(`/api/messages/${r.body.id}/reply`, { body: "following up" });
check("reply in same conversation: no second automatic reply", psql(`SELECT count(*) FROM message_posts WHERE thread_id = '${r.body.id}' AND body LIKE 'Automatic reply%'`) === "1");
// Cal (away, no live pop-ups for routine messages) sees them unread in his inbox
check("Cal's inbox has the messages", (await C.api("/api/messages?box=inbox")).body.threads.filter(t => t.unread).length >= 3);

// Chat to Cal while out of office: subject says out of office, reply is in Fred's chat result
r = await F.post("/api/messages/chat", { userId: cal, body: "You around?" });
check("chat to someone out of office is diverted with the away message", r.body.redirected === true && r.body.status === "away" && r.body.awayMessage === "Still out." && r.body.label === "Out of office");
check("diverted chat subject says out of office", psql(`SELECT count(*) FROM message_threads WHERE subject = 'Chat from Fred Floor (while you were out of office)'`) === "1");

// ---- Status ends by itself, or by hand -----------------------------------------------------------
psql(`UPDATE users SET status_until = now() - interval '1 minute' WHERE id = '${bea}'`);
check("expired status reads as Available", (await B.api("/api/messages/status")).body.status === "available" && (await F.api("/api/messages/people")).body.people.find(x => x.id === bea).status === "available");
r = await F.post("/api/messages/chat", { userId: bea, body: "Meeting over?" });
check("chats go through again after it ends", !r.body.redirected && r.body.id === chatId);
await C.page.reload(); await C.settle(800);
await C.page.getByRole("button", { name: /^Chat/ }).click(); await C.settle(600);
check("Cal sees he's out of office in the chat window", /You're set to Out of office/.test(await C.body()));
await C.page.getByRole("button", { name: /My status: Out of office/ }).click(); await C.settle(400);
await C.page.getByRole("radio").first().check();
await C.page.getByRole("button", { name: "Save status" }).click(); await C.settle(600);
st = (await C.api("/api/messages/status")).body;
check("Cal back to Available, away message cleared", st.status === "available" && psql(`SELECT status_message FROM users WHERE id = '${cal}'`) === "");
r = await F.post("/api/messages/chat", { userId: cal, body: "Welcome back" });
check("chat to Cal is a chat again", !r.body.redirected && r.body.id);

// ---- Opening from a notification ---------------------------------------------------------------
await B.page.goto(`${BASE}/?thread=${firstMsg}`); await B.settle(1500);
bb = await B.body();
check("notification link opens the message in Messages", /Please sign off on the E61 inspection by Friday/.test(bb) && !B.page.url().includes("thread="), B.page.url());
await B.page.goto(`${BASE}/?chat=${chatId}`); await B.settle(1500);
bb = await B.body();
check("chat notification link opens the chat window", /Meeting over\?/.test(bb) && (await B.page.getByRole("dialog", { name: "Chat" }).count()) === 1);

// ---- Alert settings show the device section ----------------------------------------------------
await B.page.getByRole("button", { name: "Back", exact: true }).click(); await B.settle(300);
await B.page.getByRole("button", { name: "Alert settings" }).click(); await B.settle(800);
bb = await B.body();
check("alert settings: notifications on this device", /Notifications on this phone, tablet or computer/.test(bb) && /Turn on notifications here/.test(bb) && /Your other devices/i.test(bb) && /iPhone/.test(bb), [/Notifications on this phone/.test(bb), /Turn on notifications here/.test(bb), /Your other devices/i.test(bb), bb.slice(bb.indexOf("Notifications on"), bb.indexOf("Notifications on") + 600)].join(" | "));
await B.page.getByRole("button", { name: "Remove iPhone" }).click(); await B.settle(600);
check("removing a device", (await B.api("/api/push/devices")).body.devices.length === 0 && !/Your other devices/i.test(await B.body()));
await B.page.screenshot({ path: "/home/claude/testrun/shot-push-settings.png" });

// iPhone not added to Home Screen: explains how
const P = await browser.newContext({ ...(await import("/opt/npm-tools/node_modules/playwright/index.mjs")).devices["iPhone 13"] });
const pp = await P.newPage(); pp.on("pageerror", e => errors.push("pageerror: " + e.message));
await pp.goto(BASE); await pp.waitForTimeout(600);
await pp.getByLabel(/^Email/).fill("bea@sgfd.org"); await pp.getByLabel(/^Password/).fill(PW);
await pp.getByRole("button", { name: "Sign in" }).click(); await pp.waitForTimeout(1200);
await pp.getByRole("button", { name: /^Chat/ }).click(); await pp.waitForTimeout(600);
await pp.getByRole("button", { name: "Alert settings" }).click(); await pp.waitForTimeout(600);
check("iPhone shows Add to Home Screen steps", /Add to Home Screen/.test(await pp.locator("body").innerText()));
await pp.screenshot({ path: "/home/claude/testrun/shot-push-iphone.png" });

// Status picker screenshot
await F.page.getByRole("button", { name: "Back", exact: true }).click().catch(() => {}); await F.settle(300);
await F.page.getByRole("button", { name: /My status/ }).click(); await F.settle(300);
await F.page.getByRole("radio").nth(3).check();
await F.page.getByRole("textbox", { name: "Away message" }).fill("Out at the state fire school this week. For anything urgent, call the Battalion Chief.");
await F.page.screenshot({ path: "/home/claude/testrun/shot-status.png" });

check("no page errors", errors.length === 0, errors.join(" | "));
done();
mock.close();
await browser.close();
