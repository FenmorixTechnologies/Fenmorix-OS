// System page: server settings (.env) editor and the updater progress bar. Fictional values only.
// Run with: SYSTEM_DIR=/home/claude/testrun/sysroot ENV_FILE=/home/claude/testrun/sysroot/test.env UPDATER_COMMAND=/home/claude/testrun/fake-updater.sh FAKE_UPDATER_MS=7000
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { hotp, stepNow } from "/home/claude/testrun/app/server/totp.js";

const BASE = "http://localhost:3077", SYS = "/home/claude/testrun/sysroot", ENV = `${SYS}/test.env`;
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + String(extra).slice(0, 300) : ""}`);
const PW = "Correct horse battery";
const psql = sql => execSync(`psql -h /home/pgtest -p 5498 -U sgfd_app -d sgfd -Atc "${sql}"`).toString().trim();
const done = () => { console.log(results.join("\n")); console.log(`${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`); };
process.on("uncaughtException", e => { done(); console.log("ERR", e.stack); process.exit(1); });
process.on("unhandledRejection", e => { done(); console.log("ERR", e.stack); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const lastUsed = new Map();
const code = async secret => { while (lastUsed.get(secret) === stepNow()) await wait(500); lastUsed.set(secret, stepNow()); return hotp(secret.replace(/\s/g, ""), stepNow()); };

fs.rmSync(SYS, { recursive: true, force: true }); fs.mkdirSync(`${SYS}/logs`, { recursive: true });
fs.writeFileSync(ENV, ["# sample settings", "PGHOST=localhost", "PGPASSWORD=sample-db-pass", "PORT=3000", "SMTP_HOST=smtp.example.org", "SMTP_PORT=587",
  "SMTP_PASS=sample-mail-pass", 'SMTP_FROM="Sample Sender <sender@example.org>"', "OLD_SETTING=yes # a note", "CAD_PENDING_MAX_MINUTES=10", ""].join("\r\n"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1350, height: 1000 }, timezoneId: "America/Chicago" });
const page = await ctx.newPage(); const errors = [];
page.on("pageerror", e => errors.push(e.message));
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
await page.goto(BASE); await page.waitForTimeout(800);
await api("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
await page.goto(BASE); await page.waitForTimeout(1000);
const secret = (await api("/api/auth/mfa-setup", {})).body.secret;
await api("/api/auth/mfa-confirm", { code: await code(secret) });

let r = await api("/api/system/env");
const E = k => r.body.entries.find(x => x.key === k);
check("settings listed with descriptions from .env.example", r.status === 200 && E("SMTP_HOST")?.value === "smtp.example.org" && /mail server|Microsoft/i.test(E("SMTP_HOST")?.desc || "") && E("SMTP_HOST").section === "Email for \"Forgot your password?\"", JSON.stringify(E("SMTP_HOST")));
check("secrets never sent: only set / not set", E("SMTP_PASS").secret && E("SMTP_PASS").set && E("SMTP_PASS").value === undefined && !JSON.stringify(r.body).includes("sample-mail-pass") && !JSON.stringify(r.body).includes("sample-db-pass"));
check("quoted value read without quotes; inline note dropped", E("SMTP_FROM").value === "Sample Sender <sender@example.org>" && E("OLD_SETTING").value === "yes");
check("database / port locked", E("PGPASSWORD").locked && E("PORT").locked && !E("SMTP_PORT").locked);
check("settings only from the example show as not set", E("PUBLIC_URL") && !E("PUBLIC_URL").inFile);
// changes need a fresh code
psql("UPDATE sessions SET mfa_at = now() - interval '10 minutes'");
r = await api("/api/system/env", { changes: [{ key: "SMTP_PORT", value: "25" }] });
check("saving needs an authenticator code", r.status === 401 && r.body.need === "code");
await api("/api/auth/mfa-verify", { code: await code(secret) });
check("locked setting refused", (await api("/api/system/env", { changes: [{ key: "PGPASSWORD", value: "x" }] })).status === 400);
check("line breaks refused", (await api("/api/system/env", { changes: [{ key: "SMTP_HOST", value: "a\nPGPASSWORD=evil" }] })).status === 400);
check("bad names refused", (await api("/api/system/env", { changes: [{ key: "lower-case", value: "1" }] })).status === 400);
r = await api("/api/system/env", { changes: [{ key: "SMTP_PORT", value: "25" }, { key: "SMTP_PASS", value: "new pass # with hash" }, { key: "OLD_SETTING", remove: true },
  { key: "PUBLIC_URL", value: "https://nexus.example.org" }, { key: "CUSTOM_NOTE", value: "Hello there" }] });
check("saved", r.status === 200 && r.body.saved, JSON.stringify(r.body).slice(0, 200));
const txt = fs.readFileSync(ENV, "utf8");
check("written in place, Windows line endings kept, comments kept", txt.includes("\r\n") && txt.startsWith("# sample settings") && /^SMTP_PORT=25\r$/m.test(txt) && !/OLD_SETTING/.test(txt), txt);
check("values that need quotes are quoted; new ones added at the end", /^SMTP_PASS="new pass # with hash"\r$/m.test(txt) && /# --- Set in the app/.test(txt) && /^CUSTOM_NOTE=Hello there\r$/m.test(txt) && /^PUBLIC_URL=https:\/\/nexus\.example\.org\r$/m.test(txt), txt);
check("untouched lines untouched", /^PGPASSWORD=sample-db-pass\r$/m.test(txt) && /^SMTP_FROM="Sample Sender <sender@example.org>"\r$/m.test(txt));
check("Node reads it back the same", (() => { const v = {}; for (const l of txt.split(/\r?\n/)) { const m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) v[m[1]] = m[2]; } return true; })()
  && execSync(`node -e 'process.loadEnvFile("${ENV}"); console.log(process.env.SMTP_PASS + "|" + process.env.CUSTOM_NOTE + "|" + process.env.SMTP_FROM)'`).toString().trim() === "new pass # with hash|Hello there|Sample Sender <sender@example.org>");
check("a copy of the old file was kept", r.body.history.length === 1 && fs.readFileSync(`${SYS}/updates/env-history/${r.body.history[0]}`, "utf8").includes("OLD_SETTING=yes"));
check("audited by name only (no values)", (() => { const a = psql("SELECT detail FROM audit_log WHERE action = 'Changed server settings'"); return /SMTP_PASS/.test(a) && !/new pass/.test(a); })());
r = await api("/api/system/env/restore", { name: r.body.history[0] });
check("put an earlier copy back", r.status === 200 && fs.readFileSync(ENV, "utf8").includes("OLD_SETTING=yes") && r.body.history.length === 2);

// ---- UI: edit, save with code, restart -> progress bar ----
await page.goto(BASE); await page.waitForTimeout(1000);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(500);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(800);
await page.getByRole("button", { name: "Show settings" }).click(); await page.waitForTimeout(600);
const card = page.getByRole("region", { name: "Server settings" });
check("settings card shows secrets as set, never the value", /● set/.test(await card.getByRole("group", { name: "SMTP_PASS setting" }).innerText()) && !(await card.innerText()).includes("sample-mail-pass"));
await card.getByLabel("Find a setting").fill("SMTP_PORT");
await card.getByLabel("SMTP_PORT", { exact: true }).fill("2525");
await card.getByRole("button", { name: /Save 1 change/ }).click();
await page.getByLabel("Authenticator code").fill(await code(secret));
await page.getByRole("dialog", { name: "Confirm with your authenticator" }).getByRole("button", { name: "Save settings" }).click(); await page.waitForTimeout(1000);
check("saved from the page", /^SMTP_PORT=2525\r$/m.test(fs.readFileSync(ENV, "utf8")));
await card.getByRole("button", { name: "Restart now to use them" }).click(); await page.waitForTimeout(2500);
const bar = page.getByRole("progressbar", { name: "Updater progress" });
check("progress bar shows the step and time", await bar.count() === 1 && /Restart the service/.test(await bar.innerText()) && /Step 1 of 1/.test(await bar.innerText()) && /\d:\d\d/.test(await bar.innerText()), await bar.innerText().catch(() => ""));
await page.waitForTimeout(7000);
check("bar goes away with the result", await bar.count() === 0 && /Restarted\./.test(await page.locator("main").innerText()));
// Install shows 6 steps
fs.mkdirSync(`${SYS}/updates/incoming`, { recursive: true });
await api("/api/system/upload", { fileName: "good.zip", data: fs.readFileSync("/home/claude/testrun/sysdata/good.zip").toString("base64") });
await api("/api/auth/mfa-verify", { code: await code(secret) });
await page.goto(BASE); await page.waitForTimeout(1000);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(500);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(800);
await page.getByRole("button", { name: "Install the update" }).click(); await page.waitForTimeout(3000);
check("install progress: step of 6 with the label", /Step 2 of 6/.test(await bar.innerText().catch(() => "")) && /Backing up the database first/.test(await bar.innerText().catch(() => "")), await bar.innerText().catch(() => ""));
await page.goto(BASE); await page.waitForTimeout(700);
await page.locator("nav button", { hasText: "User Management" }).first().click(); await page.waitForTimeout(300);
await page.locator("nav button", { hasText: "System" }).first().click(); await page.waitForTimeout(500);
check("reopening the page picks the running job back up", await bar.count() === 1);
await page.waitForTimeout(6000);
check("install finished", /Installed 2099\.01\.01/.test(await page.locator("main").innerText()));
check("no page errors", !errors.length, errors.join(" | "));
await browser.close();
done();
process.exit(0);
