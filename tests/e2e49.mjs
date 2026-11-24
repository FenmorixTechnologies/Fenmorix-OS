// Sign-in hardening: password rule (10+, capital, lowercase, symbol), 90-day expiry, two-step sign-in for master and accounts
// admins (setup, recovery codes, lock, reset by an admin), "Forgot your password?" by email (mock mail server), and the app's
// code going only to signed-in people and paired TV screens. Fictional people only.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import net from "node:net";
import fs from "node:fs";
import { execSync, spawn } from "node:child_process";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077";
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
// A code can be used once (no replay): wait for the next 30-second step when this secret's last code was this step
const lastUsed = new Map();
const code = async secret => {
  while (lastUsed.get(secret) === stepNow()) await new Promise(r => setTimeout(r, 500));
  lastUsed.set(secret, stepNow());
  return hotp(secret.replace(/\s/g, ""), stepNow());
};

// A stand-in mail server: plain SMTP on 2525, keeps every message
const mails = [];
const smtp = net.createServer(sock => {
  let data = false, buf = "", msg = "";
  sock.write("220 mock ESMTP\r\n");
  sock.on("data", d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) { if (line === ".") { data = false; mails.push(msg); msg = ""; sock.write("250 queued\r\n"); } else msg += line + "\n"; continue; }
      if (/^EHLO/i.test(line)) sock.write("250-mock\r\n250 8BITMIME\r\n");
      else if (/^DATA/i.test(line)) { data = true; sock.write("354 go\r\n"); }
      else if (/^QUIT/i.test(line)) { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 ok\r\n");
    }
  });
});
await new Promise(r => smtp.listen(2525, "127.0.0.1", r));
const mailText = m => { const b = m.split("\n\n").slice(1).join("").replace(/\s/g, ""); return Buffer.from(b, "base64").toString("utf8"); };

try { execSync(`for p in $(ps -eo pid,args | awk '$2=="node" && $3=="server/index.js" {print $1}'); do kill $p; done`); } catch {}
for (let i = 0; i < 50; i++) { if (!(await fetch(BASE + "/api/health").then(() => true, () => false))) break; await wait(200); }
const srv = spawn("node", ["server/index.js", "--production"], { cwd: "/home/claude/testrun/app", detached: true,
  stdio: ["ignore", fs.openSync("/home/claude/testrun/app/server.log", "a"), fs.openSync("/home/claude/testrun/app/server.log", "a")],
  env: { ...process.env, LIVE_EVENTS: "off", WEATHER_DISABLED: "true", MFA_ADMINS: "on", SMTP_HOST: "127.0.0.1", SMTP_PORT: "2525",
    SMTP_FROM: "SGFD Nexus <nexus@sgfd.example>", PUBLIC_URL: BASE } });
srv.unref(); fs.writeFileSync("/home/claude/testrun/app/server.pid", String(srv.pid));
await wait(5000);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const errors = [];
async function person() {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("dialog", d => d.accept());
  const api = (path, opts = {}) => page.evaluate(async ([path, opts]) => {
    const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    const t = await r.text(); let b = t; try { b = JSON.parse(t); } catch {}
    return { status: r.status, body: b };
  }, [path, opts]);
  const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
  const settle = async (ms = 600) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  async function login(email, pw = PW) {
    await ctx.clearCookies(); await page.goto(BASE); await settle();
    await page.getByLabel(/^Email/).fill(email); await page.getByLabel(/^Password/).fill(pw);
    await page.getByRole("button", { name: "Sign in" }).click(); await settle(1200);
  }
  return { ctx, page, api, post, settle, login, body: () => page.locator("body").innerText() };
}

// ---- Signed out: only the small sign-in page and its script ----
const anon = await fetch(BASE + "/").then(r => r.text());
check("signed out: the sign-in page, not the app", anon.includes("/signin.js") && !anon.includes("/app.js"));
check("signed out: the app's code is refused", (await fetch(BASE + "/app.js")).status === 404);
check("signed out: the sign-in script loads", (await fetch(BASE + "/signin.js")).status === 200);
check("sign-in script has no app screens in it", !/Requisition|Command Board|PIAL/.test(await fetch(BASE + "/signin.js").then(r => r.text())));
check("any page address gives the sign-in page", (await fetch(BASE + "/index.html").then(r => r.text())).includes("/signin.js") && (await fetch(BASE + "/some/deep/link").then(r => r.text())).includes("/signin.js"));
check("pictures and icons stay public", (await fetch(BASE + "/nexus-emblem.png")).status === 200 && (await fetch(BASE + "/sw.js")).status === 200);

// ---- First master (from this computer); password rule ----
const M = await person();
await M.page.goto(BASE); await M.settle();
let r = await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: "alllowercase words" });
check("password without a capital is refused, with the rule", r.status === 400 && /capital letter/.test(r.body.error) && /symbol/.test(r.body.error), r.body.error);
r = await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: "Short!1" });
check("too short refused", r.status === 400 && /10 characters/.test(r.body.error));
r = await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: "NoSymbolsHere1" });
check("no symbol refused", r.status === 400 && /symbol/.test(r.body.error));
r = await M.post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
check("a capital, lowercase and a space (symbol) is accepted", r.status === 200);
psql("INSERT INTO divisions (name) VALUES ('Suppression') ON CONFLICT DO NOTHING");

// ---- Master signs in: has to set up two-step sign-in first ----
await M.login("mike@sgfd.org");
let body = await M.body();
check("master is asked to set up two-step sign-in", body.includes("Set up two-step sign-in") && (await M.page.locator('svg[aria-label="QR code for your authenticator app"] rect').count()) > 200);
r = await M.api("/api/directory");
check("before the code: nothing in the app answers", r.status === 401);
check("before the code: the app's code is still refused", (await M.api("/app.js")).status === 404);
const secret = await M.page.getByLabel("Setup key").innerText();
await M.page.getByLabel("Authenticator code").fill("000000"); await M.page.getByRole("button", { name: "Turn it on" }).click(); await M.settle(500);
check("wrong code counts down", /4 tries left/.test(await M.body()));
await M.page.getByLabel("Authenticator code").fill(await code(secret)); await M.page.getByRole("button", { name: "Turn it on" }).click(); await M.settle(800);
const recovery = (await M.page.getByLabel("Recovery codes").innerText()).split(/\s+/).filter(Boolean);
check("10 recovery codes shown once", recovery.length === 10 && recovery.every(c => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(c)), recovery.join(" "));
check("recovery codes stored only as hashes", !psql("SELECT mfa_recovery::text FROM users WHERE email = 'mike@sgfd.org'").includes(recovery[0]));
await M.page.getByRole("button", { name: "I've saved them, continue" }).click(); await M.settle(1500);
check("then into the app", (await M.body()).includes("Mike Admin") && (await M.api("/api/directory")).status === 200);
check("signed in: the app's code loads", (await M.api("/app.js")).status === 200);
check("sign-in audited with the code", psql("SELECT count(*) FROM audit_log WHERE action = 'Signed in' AND detail = 'with authenticator code'") === "1");

// Next sign-in: the code; a recovery code works once
await M.login("mike@sgfd.org");
check("next time: just the code", (await M.body()).includes("Two-step sign-in") && !(await M.body()).includes("scan"));
await M.page.getByLabel("Authenticator code").fill(recovery[0]); await M.page.getByRole("button", { name: "Sign in" }).click(); await M.settle(1500);
check("a recovery code signs in", (await M.api("/api/directory")).status === 200);
await M.login("mike@sgfd.org");
await M.page.getByLabel("Authenticator code").fill(recovery[0]); await M.page.getByRole("button", { name: "Sign in" }).click(); await M.settle(800);
check("the same recovery code doesn't work twice", (await M.api("/api/directory")).status === 401 && /isn't right/.test(await M.body()));
await M.page.getByLabel("Authenticator code").fill(await code(secret)); await M.page.getByRole("button", { name: "Sign in" }).click(); await M.settle(1500);
check("authenticator code signs in", (await M.api("/api/directory")).status === 200);

// ---- People: a firefighter (no two-step), an accounts admin (two-step) ----
for (const [f, l, e] of [["Fran", "Firefighter", "fran"], ["Andy", "Accounts", "andy"]]) {
  const P = await person(); await P.page.goto(BASE);
  r = await P.post("/api/auth/signup", { firstName: f, lastName: l, email: `${e}@sgfd.org`, division: "Suppression", password: PW });
}
for (const a of (await M.api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await M.post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });
const andyId = psql("SELECT id FROM users WHERE email = 'andy@sgfd.org'");
r = await M.post("/api/access/grants", { section: "accounts", level: "manage", userId: andyId, scope: "all" });
check("Andy made an accounts admin", r.status === 200, JSON.stringify(r.body));
const F = await person(); await F.login("fran@sgfd.org");
check("a firefighter signs in with just the password", (await F.api("/api/directory")).status === 200 && !(await F.body()).includes("Two-step"));
const A = await person(); await A.login("andy@sgfd.org");
check("an accounts admin is asked for two-step setup", (await A.body()).includes("Set up two-step sign-in"));
const aSecret = await A.page.getByLabel("Setup key").innerText();
await A.page.getByLabel("Authenticator code").fill(await code(aSecret)); await A.page.getByRole("button", { name: "Turn it on" }).click(); await A.settle(600);
await A.page.getByRole("button", { name: "I've saved them, continue" }).click(); await A.settle(1200);
check("accounts admin in", (await A.api("/api/directory")).status === 200);

// Locked after 5 wrong codes; an admin releases it
await A.login("andy@sgfd.org");
for (let i = 0; i < 5; i++) { await A.page.getByLabel("Authenticator code").fill(String(111111 + i)); await A.page.getByRole("button", { name: "Sign in" }).click(); await A.settle(300); }
check("5 wrong codes lock it", /locked/i.test(await A.body()) && psql(`SELECT mfa_locked_at IS NOT NULL FROM users WHERE id = '${andyId}'`) === "t");
r = await F.post("/api/auth/mfa-reset", { userId: andyId, unlockOnly: true });
check("a firefighter can't release it", r.status === 403);
const mikeId = psql("SELECT id FROM users WHERE email = 'mike@sgfd.org'");
r = await A.post("/api/auth/mfa-reset", { userId: mikeId });
check("can't reset from a half-finished sign-in", r.status === 401 || r.status === 403);
await M.page.goto(BASE); await M.settle(800);
await M.page.getByRole("button", { name: /User Management/ }).first().click(); await M.settle(800);
await M.page.getByRole("button", { name: /Sign-in details and password resets/ }).click(); await M.settle(500);
body = await M.body();
check("accounts list shows the lock", body.includes("authenticator locked"));
await M.page.getByRole("button", { name: "Release authenticator" }).click(); await M.settle(800);
check("master released it", psql(`SELECT mfa_locked_at IS NULL FROM users WHERE id = '${andyId}'`) === "t" && (await M.body()).includes("is released"));
await M.page.getByRole("button", { name: "Reset two-step sign-in" }).first().click(); await M.settle(800);
check("master reset someone's two-step sign-in", psql("SELECT count(*) FROM users WHERE totp_enabled_at IS NULL AND email IN ('andy@sgfd.org', 'mike@sgfd.org')") === "1");

// ---- 90 days: an expired password must be changed first ----
psql("UPDATE users SET password_changed_at = now() - interval '91 days' WHERE email = 'fran@sgfd.org'");
await F.login("fran@sgfd.org");
body = await F.body();
check("expired: 'Time for a new password'", body.includes("Time for a new password") && body.includes("90 days old"), body.slice(0, 300));
await F.page.getByLabel("Current password").fill(PW);
await F.page.getByLabel("New password", { exact: true }).fill("weak password");
check("the rule checklist shows what's missing", (await F.page.getByLabel("Password rules").innerText()).includes("○"));
await F.page.getByLabel("Confirm new password").fill("weak password");
await F.page.getByRole("button", { name: "Save new password" }).click(); await F.settle(400);
check("weak new password refused before sending", /doesn't meet the rules/.test(await F.body()));
await F.page.getByLabel("New password", { exact: true }).fill("Brand new password!");
await F.page.getByLabel("Confirm new password").fill("Brand new password!");
await F.page.getByRole("button", { name: "Save new password" }).click(); await F.settle(1200);
check("changed: into the app, clock restarted", (await F.api("/api/directory")).status === 200 && psql("SELECT (now() - password_changed_at < interval '1 minute') AND NOT must_change_password FROM users WHERE email = 'fran@sgfd.org'") === "t");

// Temporary passwords from an admin meet the rule
r = await M.post("/api/auth/reset-password", { id: psql("SELECT id FROM users WHERE email = 'fran@sgfd.org'") });
check("temporary password meets the rule", /^[A-Z][a-z]+-[a-z]+-\d{4}$/.test(r.body.tempPassword), r.body.tempPassword);
await F.login("fran@sgfd.org", r.body.tempPassword);
check("temporary password: choose your own first", (await F.body()).includes("Choose your own password"));

// ---- Forgot your password? ----
const G = await person();
await G.page.goto(BASE); await G.settle();
await G.page.getByRole("button", { name: "Forgot your password?" }).click();
await G.page.getByLabel("Email").fill("fran@sgfd.org");
await G.page.getByRole("button", { name: "Email me a reset link" }).click(); await G.settle(1500);
check("same answer screen", (await G.body()).includes("If fran@sgfd.org has a Nexus account"));
r = await G.post("/api/auth/forgot", { email: "nobody@sgfd.org" });
check("unknown email: same answer, no email sent", r.status === 200 && mails.length === 1, mails.length);
const resetMail = mailText(mails[0]);
const link = /(http:\/\/\S+reset-password\?token=\S+)/.exec(resetMail)?.[1];
check("reset email with a link to Nexus", !!link && link.startsWith(BASE) && /30 minutes/.test(resetMail), resetMail.slice(0, 200));
check("token stored only as a hash", !psql("SELECT token_hash FROM password_resets LIMIT 1").includes(new URL(link).searchParams.get("token")));
const sessionsBefore = Number(psql("SELECT count(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'fran@sgfd.org')"));
await G.page.goto(link); await G.settle(800);
check("link opens the reset page", (await G.body()).includes("Choose a new password, Fran"));
await G.page.getByLabel("New password", { exact: true }).fill("Reset by email 2026!");
await G.page.getByLabel("Confirm new password").fill("Reset by email 2026!");
await G.page.getByRole("button", { name: "Save new password" }).click(); await G.settle(1000);
check("password reset", (await G.body()).includes("Your new password is set"));
check("signed out everywhere", sessionsBefore > 0 && psql("SELECT count(*) FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'fran@sgfd.org')") === "0");
check("confirmation email sent", await (async () => { for (let i = 0; i < 20 && mails.length < 2; i++) await wait(200); return mails.length === 2 && /was just changed/.test(mailText(mails[1])); })());
r = await G.post("/api/auth/reset", { token: new URL(link).searchParams.get("token"), password: "Another one again!" });
check("the link works once", r.status === 410);
await G.login("fran@sgfd.org", "Reset by email 2026!");
check("signs in with the new password", (await G.api("/api/directory")).status === 200);
// An admin's reset also needs the authenticator code
await G.ctx.clearCookies();
r = await G.post("/api/auth/forgot", { email: "mike@sgfd.org" });
for (let i = 0; i < 20 && mails.length < 3; i++) await wait(200);
const mLink = /(http:\/\/\S+reset-password\?token=\S+)/.exec(mailText(mails[2]))?.[1];
const mTok = new URL(mLink).searchParams.get("token");
r = await G.post("/api/auth/reset-check", { token: mTok });
check("admin reset asks for the authenticator code", r.body.needCode === true);
r = await G.post("/api/auth/reset", { token: mTok, password: "Admin new pass 2026!", code: "123456" });
check("wrong code: refused, link still good", r.status === 400 && psql("SELECT count(*) FROM password_resets WHERE used_at IS NULL") === "1");
r = await G.post("/api/auth/reset", { token: mTok, password: "Admin new pass 2026!", code: await code(secret) });
check("right code: admin password reset", r.status === 200);

// ---- A paired TV screen may load the app's code; nothing else of the app opens for it ----
const TV = await person();
await TV.page.goto(BASE + "/display"); await TV.settle(2500);
const pairCode = (await TV.page.getByLabel("Pairing code").innerText()).trim();
check("unpaired TV: pairing page from the sign-in bundle", /^[A-Z2-9]{6}$/.test(pairCode) && (await TV.api("/app.js")).status === 404);
await M.login("mike@sgfd.org", "Admin new pass 2026!").catch(() => {});
await M.page.getByLabel("Authenticator code").fill(await code(secret)).catch(() => {});
await M.page.getByRole("button", { name: "Sign in" }).click().catch(() => {}); await M.settle(1200);
r = await M.post("/api/display/screens", { code: pairCode, name: "Test screen", views: ["duty"], seconds: 10 });
check("paired", r.status === 200, JSON.stringify(r.body));
await TV.page.waitForSelector("text=Test screen", { timeout: 15000 });
check("paired TV loads the app's code", (await TV.api("/app.js")).status === 200 && (await TV.api("/api/directory")).status === 401);

check("no page errors", !errors.length, errors.join(" | "));
done();
await browser.close(); smtp.close(); process.exit(0);
