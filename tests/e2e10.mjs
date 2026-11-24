// Working Fire Recordings: import the real NICE sample, play, permissions
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
import crypto from "node:crypto";

const SAMPLE = "/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/nice/sample.distribution";
fs.writeFileSync("/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/nice/not-a-recording.distribution", "hello, not a zip");
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
const settle = async () => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
async function api(path, opts = {}) {
  return page.evaluate(async ([path, opts]) => {
    const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body, type: res.headers.get("content-type") };
  }, [path, opts]);
}
const post = (path, body) => api(path, { method: "POST", headers: { "X-SGFD": "1" }, body: JSON.stringify(body) });
const read = async key => (await api(`/api/collections/${key}`)).body?.value;
async function login(email) {
  await ctx.clearCookies(); await page.goto(BASE); await settle();
  await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click(); await settle();
}
const tile = async label => { await page.getByText(label, { exact: true }).first().click(); await settle(); };

await page.goto(BASE); await settle();
await post("/api/auth/first-run", { name: "Mike Admin", email: "mike@sgfd.org", password: PW });
const reg = await (await browser.newContext()).newPage(); await reg.goto(BASE);
for (const [n, e] of [["Ollie Officer", "ollie@sgfd.org"], ["Nora Nobody", "nora@sgfd.org"]]) {
  await reg.evaluate(b => fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(b) }), { name: n, email: e, division: "Suppression", password: PW });
}
await login("mike@sgfd.org");
for (const a of (await api("/api/auth/accounts")).body.accounts.filter(a => a.status === "pending")) await post("/api/auth/approve", { id: a.id, role: "user", division: "Suppression" });

// ---- Master imports through the screen
await page.getByText("Working Fire Recordings", { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
check("master sees the tile", await page.getByText("Working Fire Recordings", { exact: true }).count() === 1);
await tile("Working Fire Recordings");
check("empty list message", await page.getByText("No recordings yet.", { exact: false }).count() === 1);
await page.getByRole("button", { name: "Department list…" }).click();
await page.getByLabel("New department").fill("Central Fire Protection District");
await page.getByRole("button", { name: "Add", exact: true }).click(); await settle();
await page.getByRole("button", { name: "Done" }).click();
await page.getByRole("button", { name: "+ Import recording" }).click();
check("department list offered", JSON.stringify(await page.getByLabel("Department", { exact: true }).locator("option").allInnerTexts()) ===
  '["Choose…","Central Fire Protection District","St. George Fire Protection District","Other…"]');
await page.getByLabel("Department", { exact: true }).selectOption("St. George Fire Protection District");
await page.getByLabel("Recording file").setInputFiles(SAMPLE);
await page.getByRole("button", { name: "Import", exact: true }).click();
await page.getByText("Transmissions ready", { exact: false }).or(page.getByText("291 transmissions", { exact: false })).first().waitFor({ timeout: 30000 }); await settle();
const head = await page.locator("body").innerText();
check("details read from the file", /2113 Anne Marie Dr/.test(head) && /Working Structure Fire · Incident 26-10871 · St. George Fire Protection District/.test(head), head.slice(0, 400).replace(/\n/g, " | "));
check("date and times in Central time", /Tue, Oct 6, 2026, 15:18–17:39/.test(head));
check("291 transmissions, ~15 minutes", /291 transmissions · 14m 5\ds of radio traffic|291 transmissions · 15m 0\ds of radio traffic/.test(head), (head.match(/291 transmissions[^|\n]*/) || [""])[0]);
check("talkgroups with counts", /EBRFD-BOX 1 \(275\)/.test(head) && /EBRFD-S DISP \(14\)/.test(head) && /EBRFD-S PAGING \(2\)/.test(head));
check("first transmission row", /15:18:25\s*\+0:00:00\s*EBRFD-S PAGING\s*St\. George Op-4/.test(head));

// ---- Audio
const recs = (await api("/api/recordings")).body.recordings;
const rec = (await api(`/api/recordings/${recs[0].id}`)).body.recording;
const clipInfo = await page.evaluate(async url => {
  const r = await fetch(url); const b = new Uint8Array(await r.arrayBuffer());
  const dv = new DataView(b.buffer); let peak = 0;
  for (let i = 44; i + 1 < b.length; i += 2) peak = Math.max(peak, Math.abs(dv.getInt16(i, true)));
  return { status: r.status, type: r.headers.get("content-type"), riff: String.fromCharCode(...b.slice(0, 4)), peak };
}, `/api/recordings/${rec.id}/clips/387137.wav`);
check("clip served as WAV", clipInfo.status === 200 && clipInfo.type === "audio/wav" && clipInfo.riff === "RIFF");
check("audio boosted (original peak 1827)", clipInfo.peak > 10000 && clipInfo.peak <= 32767, String(clipInfo.peak));
await page.getByLabel("Playback speed").selectOption("2");
await page.getByRole("button", { name: "▶ Play all" }).click();
await page.getByText("Transmission 1 of 291").waitFor({ timeout: 5000 });
check("Play all starts at the first transmission", await page.getByText("Transmission 1 of 291").count() === 1);
await page.getByText("Transmission 2 of 291").waitFor({ timeout: 15000 }).then(() => {}, () => {});
check("keeps playing into the next transmission", await page.getByText("Transmission 2 of 291").count() === 1);
await page.getByRole("button", { name: "❚❚ Pause" }).click().catch(() => {});
await page.getByLabel("EBRFD-BOX 1 (275)", { exact: false }).first().uncheck().catch(async () => {
  await page.locator("label", { hasText: "EBRFD-BOX 1 (275)" }).click();
});
await settle();
check("talkgroup filter narrows the timeline", (await page.locator("[aria-label^='Play ']").count()) === 16, String(await page.locator("[aria-label^='Play ']").count()));
await page.getByLabel("Filter by radio").selectOption("St. George Op-4"); await settle();
check("radio filter", (await page.locator("[aria-label^='Play ']").count()) > 0 && (await page.locator("[aria-label^='Play ']").allInnerTexts()).every(t => t.includes("St. George Op-4")));

// Original download is byte-for-byte the upload
const dl = await page.evaluate(async url => { const r = await fetch(url); const b = new Uint8Array(await r.arrayBuffer()); let h = 0; for (const x of b) h = (h * 31 + x) >>> 0; return { status: r.status, size: b.length, h, cd: r.headers.get("content-disposition") }; }, `/api/recordings/${rec.id}/download`);
const orig = fs.readFileSync(SAMPLE); let oh = 0; for (const x of orig) oh = (oh * 31 + x) >>> 0;
check("download returns the original .distribution", dl.status === 200 && dl.size === orig.length && dl.h === oh && /filename="sample\.distribution"/.test(dl.cd || ""), dl.cd);

// Duplicate and bad files
await page.getByRole("button", { name: "‹ All recordings" }).click(); await settle();
await page.getByRole("button", { name: "+ Import recording" }).click();
await page.getByLabel("Department", { exact: true }).selectOption("St. George Fire Protection District");
await page.getByLabel("Recording file").setInputFiles(SAMPLE);
await page.getByRole("button", { name: "Import", exact: true }).click();
await page.getByText("already imported", { exact: false }).waitFor({ timeout: 20000 });
check("duplicate import is refused with Open it", await page.getByRole("button", { name: "Open it" }).count() === 1);
await page.getByLabel("Recording file").setInputFiles("/tmp/claude-0/-home-claude/936fcc05-20e3-5129-8bb4-925077c41c5a/scratchpad/nice/not-a-recording.distribution");
await page.getByRole("button", { name: "Import", exact: true }).click();
await page.getByText("isn't a NICE .distribution file", { exact: false }).waitFor({ timeout: 10000 }).catch(() => {});
check("non-NICE file is refused with a clear message", await page.getByText("isn't a NICE .distribution file", { exact: false }).count() === 1);
await page.getByRole("button", { name: "Cancel" }).click();
check("list shows the recording", await page.getByText("2113 Anne Marie Dr", { exact: true }).count() === 1);
await page.getByLabel("Search").fill("26-10871"); await settle();
check("search by incident number", /of 1 recordings/.test(await page.getByText(/^Showing|^No /).first().innerText()));

// ---- Permissions
await login("nora@sgfd.org");
check("no tile without permission", await page.getByText("Working Fire Recordings", { exact: true }).count() === 0);
const noraList = await api("/api/recordings"), noraClip = await api(`/api/recordings/${rec.id}/clips/387137.wav`);
check("API refuses without permission", noraList.status === 403 && noraClip.status === 403, `${noraList.status} ${noraClip.status} ${JSON.stringify(noraList.body)}`);

await login("mike@sgfd.org");
await tile("User Management");
await page.getByRole("button", { name: "People & roles", exact: true }).click(); await settle();
await page.getByLabel("Edit Ollie Officer").click();
await page.getByLabel("Fire recordings for Ollie Officer").check();
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
const ollie = (await read("roster")).find(u => u.name === "Ollie Officer");
check("permission saved", JSON.stringify(ollie.permissions.recordings) === '["*"]');

await login("ollie@sgfd.org");
check("tile appears with permission", await page.getByText("Working Fire Recordings", { exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false));
await tile("Working Fire Recordings");
await page.getByRole("button", { name: "Open 2113 Anne Marie Dr" }).click(); await settle();
check("Ollie can listen", await page.getByRole("button", { name: "▶ Play all" }).count() === 1);
check("Ollie can't edit or delete someone else's import", await page.getByRole("button", { name: "Edit details" }).count() === 0 && await page.getByRole("button", { name: "Delete" }).count() === 0);
check("API: Ollie can't delete", (await api(`/api/recordings/${rec.id}`, { method: "DELETE", headers: { "X-SGFD": "1" } })).status === 403);
check("API: Ollie can't edit", (await api(`/api/recordings/${rec.id}`, { method: "PUT", headers: { "X-SGFD": "1" }, body: JSON.stringify({ notes: "x" }) })).status === 403);
check("API: Ollie can't change departments", (await post("/api/recordings/departments", { name: "X" })).status === 403);

// Master edits and deletes
await login("mike@sgfd.org");
await tile("Working Fire Recordings");
await page.getByRole("button", { name: "Open 2113 Anne Marie Dr" }).click(); await settle();
await page.getByRole("button", { name: "Edit details" }).click();
await page.getByLabel("Notes").fill("Good example of a defensive-to-offensive transition");
await page.getByRole("button", { name: "Save", exact: true }).click(); await settle();
check("edit saved", await page.getByText("Good example of a defensive-to-offensive transition").count() === 1);
await page.screenshot({ path: "/home/claude/testrun/shot-recording.png" });
const log = await read("audit-log");
check("import and edit are audited", log.some(e => e.action === "Imported recording" && /2113 Anne Marie Dr \(26-10871\) — 291 transmissions/.test(e.detail)) && log.some(e => e.action === "Edited recording"));
await page.getByRole("button", { name: "Delete" }).click(); await settle();
check("master deletes", (await api("/api/recordings")).body.recordings.length === 0);
check("files removed", !fs.existsSync(`/home/claude/testrun/app/uploads/recordings/${rec.id}`));

check("no browser errors", errors.length === 0, errors.join(" | "));
console.log(results.join("\n"));
console.log(`\n${results.filter(r => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
