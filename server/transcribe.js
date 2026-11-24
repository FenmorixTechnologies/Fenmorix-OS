// Working Fire transcripts: speech-to-text on the Nexus server with whisper.cpp (Whisper, run locally:
// the audio never leaves the server). scripts/install-whisper.ps1 puts the program and a model in
// <install folder>\tools\whisper.
//
//   WHISPER_BIN      path to whisper-cli(.exe)   default ..\tools\whisper\whisper-cli.exe (or the Linux name)
//   WHISPER_MODEL    path to a ggml model        default ..\tools\whisper\ggml-small.en.bin (falls back to base.en)
//   WHISPER_THREADS  CPU threads                 default: cores − 1 (max 8)
//
// One recording at a time, in the background. Every transmission is a separate WAV, passed to
// whisper-cli in batches (the model loads once per batch) with one output file each, so each line
// of the report is exactly one radio transmission. The prompt lists unit names and fireground words
// so they're spelled the way the district says them.
import fs from "node:fs/promises";
import { brand, brandText, brandDeep } from "./brand.js";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pool } from "./db.js";
import { UPLOAD_DIR } from "./files.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const TOOLS = path.join(path.dirname(ROOT), "tools", "whisper");
const WIN = process.platform === "win32";
const BATCH = 40;

function binPath() {
  if (process.env.WHISPER_BIN) return process.env.WHISPER_BIN;
  for (const n of WIN ? ["whisper-cli.exe", "main.exe", "Release/whisper-cli.exe"] : ["whisper-cli", "main"]) {
    const p = path.join(TOOLS, n);
    if (existsSync(p)) return p;
  }
  return path.join(TOOLS, WIN ? "whisper-cli.exe" : "whisper-cli");
}
function modelPath() {
  if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
  for (const n of ["ggml-small.en.bin", "ggml-medium.en.bin", "ggml-base.en.bin", "ggml-small.bin", "ggml-base.bin"]) {
    const p = path.join(TOOLS, n);
    if (existsSync(p)) return p;
  }
  return path.join(TOOLS, "ggml-small.en.bin");
}
const threads = () => Math.max(1, Math.min(8, Number(process.env.WHISPER_THREADS) || os.cpus().length - 1));

// Is it set up? { ready, reason, model }
export function transcriberStatus() {
  const bin = binPath(), model = modelPath();
  if (!existsSync(bin)) return { ready: false, reason: `The transcription program isn't installed on the server (looked for ${bin}). Run scripts\\install-whisper.ps1 on the server, or set WHISPER_BIN in .env.` };
  if (!existsSync(model)) return { ready: false, reason: `The transcription model isn't on the server (looked for ${model}). Run scripts\\install-whisper.ps1, or set WHISPER_MODEL in .env.` };
  return { ready: true, reason: "", model: path.basename(model).replace(/^ggml-|\.bin$/g, "") };
}

// Words Whisper should expect on a fireground channel
const FIREGROUND = () => `${brand().place} Fire. ` + "Engine, Ladder, Rescue, Medic, Battalion, Squad, Tanker, Command, Dispatch. Working fire, size-up, " +
  "offensive, defensive, primary search all clear, secondary search, water supply, hydrant, supply line, attack line, " +
  "Alpha side, Bravo, Charlie, Delta, RIT, PAR, Mayday, ventilation, overhaul, fire under control, CAN report, copy, en route, on scene.";
async function promptFor(recordingId) {
  const units = new Set();
  try { for (const r of (await pool.query("SELECT unit FROM apparatus WHERE active ORDER BY sort, unit")).rows) units.add(r.unit); } catch { /* table not there yet */ }
  for (const r of (await pool.query("SELECT DISTINCT unit FROM fire_recording_clips WHERE recording_id = $1 AND unit <> ''", [recordingId])).rows) {
    if (/^[A-Za-z]{1,4}[ -]?\d{1,4}$/.test(r.unit)) units.add(r.unit);
  }
  return `${FIREGROUND()} ${[...units].slice(0, 60).join(", ")}.`.slice(0, 900);
}

// Whisper's habits on radio audio: markers for silence/noise, and stock phrases it invents on static
const NOISE = /\[(?:BLANK_AUDIO|MUSIC|NOISE|SOUND|INAUDIBLE|static)[^\]]*\]|\((?:static|beeping|radio (?:static|chatter)|inaudible|music|silence|siren[s]?)[^)]*\)|\*[^*]{1,30}\*/gi;
const INVENTED = /^(?:thank you\.?|thanks for watching[.!]?|you|bye\.?|\.+)$/i;
export function cleanText(t) {
  const s = String(t || "").replace(NOISE, " ").replace(/\s+/g, " ").trim();
  return INVENTED.test(s) ? "" : s;
}

function run(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(binPath(), args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", d => { err = (err + d).slice(-4000); });
    p.stdout.on("data", () => {});
    const t = setTimeout(() => { p.kill(); reject(new Error("Transcription took too long and was stopped.")); }, timeoutMs);
    p.on("error", e => { clearTimeout(t); reject(e); });
    p.on("close", code => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`whisper exited with code ${code}: ${err.split("\n").filter(Boolean).slice(-3).join(" ")}`)); });
  });
}

// ---- The queue ---------------------------------------------------------------------------------
let busy = false;
const clipDir = id => path.join(UPLOAD_DIR, "recordings", id, "clips");

export async function queueTranscript(recordingId, user, redo = false) {
  const st = transcriberStatus();
  if (!st.ready) throw Object.assign(new Error(st.reason), { status: 503 });
  const r = (await pool.query("SELECT transcript_status FROM fire_recordings WHERE id = $1", [recordingId])).rows[0];
  if (!r) throw Object.assign(new Error("That recording was not found."), { status: 404 });
  if (["queued", "running"].includes(r.transcript_status)) return;
  if (redo) await pool.query("UPDATE fire_recording_clips SET transcript = NULL WHERE recording_id = $1 AND NOT transcript_edited", [recordingId]);
  await pool.query(`UPDATE fire_recordings SET transcript_status = 'queued', transcript_error = '', transcript_by = $2,
    transcript_done = (SELECT count(*) FROM fire_recording_clips WHERE recording_id = $1 AND transcript IS NOT NULL) WHERE id = $1`, [recordingId, user.name]);
  setImmediate(work);
}

async function work() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const next = (await pool.query(
        "SELECT id FROM fire_recordings WHERE transcript_status IN ('queued', 'running') ORDER BY transcript_status DESC, imported_at LIMIT 1")).rows[0];
      if (!next) break;
      await transcribeOne(next.id);
    }
  } catch (e) { console.warn(`[Transcripts] ${e.message}`); }
  busy = false;
}

async function transcribeOne(id) {
  await pool.query("UPDATE fire_recordings SET transcript_status = 'running' WHERE id = $1", [id]);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sgfd-whisper-"));
  try {
    const clips = (await pool.query(
      "SELECT item_id, duration FROM fire_recording_clips WHERE recording_id = $1 AND transcript IS NULL ORDER BY started_at, item_id", [id])).rows;
    const prompt = await promptFor(id);
    const model = modelPath();
    const dir = clipDir(id);
    for (let i = 0; i < clips.length; i += BATCH) {
      const batch = clips.slice(i, i + BATCH);
      const args = ["-m", model, "-t", String(threads()), "-l", "en", "-otxt", "-np", "-nt", "-sns", "--prompt", prompt];
      const seconds = batch.reduce((s, c) => s + Number(c.duration || 0), 0);
      for (const c of batch) args.push("-f", path.join(dir, `${c.item_id}.wav`), "-of", path.join(tmp, String(c.item_id)));
      await run(args, Math.max(120_000, seconds * 20_000));
      for (const c of batch) {
        const text = await fs.readFile(path.join(tmp, `${c.item_id}.txt`), "utf8").catch(() => "");
        await pool.query("UPDATE fire_recording_clips SET transcript = $3 WHERE recording_id = $1 AND item_id = $2 AND NOT transcript_edited",
          [id, c.item_id, cleanText(text)]);
      }
      await pool.query("UPDATE fire_recordings SET transcript_done = (SELECT count(*) FROM fire_recording_clips WHERE recording_id = $1 AND transcript IS NOT NULL) WHERE id = $1", [id]);
    }
    await pool.query(`UPDATE fire_recordings SET transcript_status = 'done', transcript_at = now(), transcript_model = $2,
      transcript_done = clip_count WHERE id = $1`, [id, path.basename(model).replace(/^ggml-|\.bin$/g, "")]);
    console.log(`[Transcripts] ${id}: ${clips.length} transmissions`);
  } catch (e) {
    console.warn(`[Transcripts] ${id}: ${e.message}`);
    await pool.query("UPDATE fire_recordings SET transcript_status = 'failed', transcript_error = $2 WHERE id = $1", [id, String(e.message).slice(0, 500)]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// After a restart: pick up where it left off
export function startTranscripts() { setTimeout(work, 5000).unref?.(); }

// One short recording (a voice simulation turn): WAV bytes -> text. Runs one at a time; a Working Fire
// transcript in progress keeps going alongside (turns are a few seconds of audio).
let voiceChain = Promise.resolve();
export function transcribeWav(buf, extraPrompt = "") {
  const st = transcriberStatus();
  if (!st.ready) return Promise.reject(Object.assign(new Error(st.reason), { status: 503 }));
  const job = voiceChain.then(async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "sgfd-voice-"));
    try {
      const wav = path.join(tmp, "voice-1.wav");
      await fs.writeFile(wav, buf);
      const prompt = `${FIREGROUND()} ${extraPrompt}`.slice(0, 900);
      await run(["-m", modelPath(), "-t", String(threads()), "-l", "en", "-otxt", "-np", "-nt", "-sns", "--prompt", prompt,
        "-f", wav, "-of", path.join(tmp, "voice-1")], 90_000);
      return cleanText(await fs.readFile(path.join(tmp, "voice-1.txt"), "utf8").catch(() => ""));
    } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  });
  voiceChain = job.catch(() => {});
  return job;
}
