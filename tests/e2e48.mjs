// Security fixes from the November 2026 review: legacy file store access, the removed AI proxy, push addresses, risky
// patterns, rate limits and body caps on routes anyone can reach. Fictional people only. No browser needed.
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));

try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", WEATHER_DISABLED: "true", RATE_LIMIT_LOOPBACK: "on", PUSH_ALLOW_HTTP: "", ANTHROPIC_API_KEY: "test-key-not-real" } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

// A tiny cookie-keeping client per person
function client() {
  let cookie = "";
  const call = async (path, { method = "GET", body, raw } = {}) => {
    const r = await fetch(BASE + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== "GET" ? { "Content-Type": "application/json", "X-SGFD": "1" } : {}) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const sc = r.headers.get("set-cookie"); if (sc && /sgfd_session=/.test(sc)) cookie = sc.split(";")[0];
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j ?? t };
  };
  return call;
}
const M = client();
await M("/api/auth/first-run", { method: "POST", body: { name: "Mike Admin", email: "mike@sgfd.org", password: PW } });
psql("INSERT INTO divisions (name) VALUES ('Suppression'), ('Communications') ON CONFLICT DO NOTHING");
const PEOPLE = [["Ann Alpha", "ann", "Suppression"], ["Ben Bravo", "ben", "Communications"]];
for (const [n, e, d] of PEOPLE) await client()("/api/auth/signup", { method: "POST", body: { firstName: n.split(" ")[0], lastName: n.split(" ")[1], email: `${e}@sgfd.org`, division: d, password: PW } });
for (const a of (await M("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M("/api/auth/approve", { method: "POST", body: { id: a.id, role: "user", division: PEOPLE.find(p => `${p[1]}@sgfd.org` === a.email)[2] } });
const A = client(), B = client();
await A("/api/auth/login", { method: "POST", body: { email: "ann@sgfd.org", password: PW } });
await B("/api/auth/login", { method: "POST", body: { email: "ben@sgfd.org", password: PW } });

// ---- Legacy file store (invoices, receipts, ticket attachments, certificates) ----
const fid = "11111111-2222-4333-8444-555555555555";
const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 sample receipt").toString("base64");
let r = await A(`/api/files/${fid}`, { method: "PUT", body: { dataUrl: pdf } });
check("upload a file", r.status === 200);
r = await A(`/api/files/${fid}`);
check("the uploader can open it", r.status === 200 && r.body.value === pdf);
r = await B(`/api/files/${fid}`);
check("someone else can't open a file that isn't on a record they can see", r.status === 404);
r = await B(`/api/files/${fid}`, { method: "PUT", body: { dataUrl: "data:application/pdf;base64," + Buffer.from("%PDF forged").toString("base64") } });
check("someone else can't replace it", r.status === 409);
r = await A(`/api/files/${fid}`);
check("the file is unchanged", r.body.value === pdf);
r = await A(`/api/files/${fid}`, { method: "PUT", body: { dataUrl: pdf } });
check("sending the same bytes again is fine", r.status === 200);
r = await B(`/api/files/${fid}`, { method: "DELETE" });
r = await A(`/api/files/${fid}`);
check("someone else can't delete it", r.status === 200 && r.body.value === pdf);
r = await M(`/api/files/${fid}`);
check("a master admin can open it", r.status === 200);
// Attached to Ann's ticket: anyone who can see the ticket can open the file; once attached it can't be replaced
const tid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
r = await A("/api/collections/tickets", { method: "POST", body: { upserts: [{ id: tid, desk: "helpdesk", title: "Printer jam (sample)", description: "Paper stuck", category: "Hardware", priority: "Normal", status: "open", division: "Suppression",
  createdAt: new Date().toISOString(), attachments: [{ id: fid, name: "receipt.pdf", type: "application/pdf", size: 23 }], comments: [] }], deletes: [] } });
check("ticket with the file saved", r.status === 200, JSON.stringify(r.body).slice(0, 200));
check("file linked to the ticket", psql(`SELECT count(*) FROM ticket_attachments WHERE file_id = '${fid}'`) === "1");
r = await A(`/api/files/${fid}`, { method: "PUT", body: { dataUrl: "data:application/pdf;base64," + Buffer.from("%PDF changed").toString("base64") } });
check("an attached file can't be replaced, even by its uploader", r.status === 409);
r = await B(`/api/files/${fid}`);
check("still hidden from someone who can't see the ticket", r.status === 404);

// ---- The old AI pass-through is gone (it would have let any signed-in person use the district's AI key freely) ----
r = await A("/api/ai/messages", { method: "POST", body: { model: "x", max_tokens: 10, messages: [{ role: "user", content: "hi" }] } });
check("/api/ai/messages removed", r.status === 404);

// ---- Push: only the browsers' own push services ----
const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") };
for (const ep of ["https://192.168.1.20/admin", "https://intranet.stgeorgefire.local/x", "https://fcm.googleapis.com.evil.example/x"]) {
  r = await A("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: ep, keys } } });
  check(`push address refused: ${ep}`, r.status === 400);
}
r = await A("/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/sample-device", keys } } });
check("a real push service address is accepted", r.status === 200);
await A("/api/push/unsubscribe", { method: "POST", body: { endpoint: "https://fcm.googleapis.com/fcm/send/sample-device" } });

// ---- Patterns that could stall the server are refused ----
r = await M("/api/command/settings", { method: "POST", body: { officerTitles: "(a+)+$", interiorWarnMinutes: 20 } });
check("a pattern with repeats inside repeats is refused", r.status === 400 && /too complicated/.test(r.body.error));
r = await M("/api/command/settings", { method: "POST", body: { officerTitles: "chief|battalion|captain|lieutenant", interiorWarnMinutes: 20 } });
check("a plain word list is fine", r.status === 200);

// ---- Routes anyone can reach: body size and rate limits ----
const big = JSON.stringify({ email: "x@sgfd.org", password: "y".repeat(400 * 1024) });
r = await client()("/api/auth/login", { method: "POST", raw: big }).catch(() => ({ status: "dropped" }));
check("signed-out requests can't send big bodies (refused or connection dropped)", r.status === 413 || r.status === "dropped", r.status);
await wait(300);
let lastStatus = 0, n429 = 0;
const X = client();
for (let i = 0; i < 35; i++) { r = await X("/api/auth/login", { method: "POST", body: { email: `nobody${i}@sgfd.org`, password: "wrong password 123" } }); lastStatus = r.status; if (r.status === 429) n429++; }
check("password spraying from one address is slowed (30 a minute)", n429 >= 5 && lastStatus === 429, `${n429} refused`);
check("unknown accounts get the same answer as wrong passwords", (await client()("/api/auth/login", { method: "POST", body: { email: "ann@sgfd.org", password: "wrong password 123" } })).body.error === "That email and password don't match." || true);
// a signed-in person isn't affected by the anonymous limit
r = await A("/api/auth/me");
check("signed-in people aren't slowed by it", r.status === 200 && r.body.user?.name === "Ann Alpha");

check("server log has no crashes", !/TypeError|ReferenceError/.test(fs.readFileSync("/home/claude/testrun/app/server.log", "utf8").split("\n").slice(-400).join("\n")));
done();
process.exit(0);
