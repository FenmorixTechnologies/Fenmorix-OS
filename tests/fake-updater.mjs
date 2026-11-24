// Stand-in for scripts/apply-update.ps1 (tests): does the pending job "instantly" and writes the result like the real one.
import fs from "node:fs";
import path from "node:path";
const root = process.env.SYSTEM_DIR, upd = path.join(root, "updates"), logs = path.join(root, "logs");
fs.mkdirSync(logs, { recursive: true });
const job = JSON.parse(fs.readFileSync(path.join(upd, "pending.json"), "utf8"));
const name = `update-20991231-000000-${job.action}.log`;
fs.writeFileSync(path.join(logs, name), `fake updater: ${job.action} ${job.version || ""}\n`);
let ok = true, message = { restart: "Restarted.", backup: "Backup finished.", rollback: "Rolled back to the previous version." }[job.action];
if (job.action === "install") { ok = fs.existsSync(job.zip); message = ok ? `Installed ${job.version} and running.` : "zip missing"; fs.rmSync(path.join(upd, "incoming"), { recursive: true, force: true });
  fs.mkdirSync(path.join(upd, "previous", "app"), { recursive: true }); fs.writeFileSync(path.join(upd, "previous", "app", "package.json"), "{}"); }
fs.writeFileSync(path.join(upd, "progress.json"), JSON.stringify({ id: job.id, action: job.action, step: 1, total: job.action === "install" ? 6 : 1, label: job.action === "install" ? "Checking the uploaded zip" : "Working", at: new Date().toISOString() }));
const delay = Number(process.env.FAKE_UPDATER_MS || 1500);
setTimeout(() => fs.writeFileSync(path.join(upd, "progress.json"), JSON.stringify({ id: job.id, action: job.action, step: job.action === "install" ? 2 : 1, total: job.action === "install" ? 6 : 1, label: job.action === "install" ? "Backing up the database first" : "Working", at: new Date().toISOString() })), delay / 4);
setTimeout(() => {
  fs.rmSync(path.join(upd, "progress.json"), { force: true });
  fs.writeFileSync(path.join(upd, "last-result.json"), "\uFEFF" + JSON.stringify({ id: job.id, action: job.action, ok, message, at: new Date().toISOString(), by: job.by, version: job.version, log: name }));
  fs.rmSync(path.join(upd, "pending.json"), { force: true });
}, delay);
