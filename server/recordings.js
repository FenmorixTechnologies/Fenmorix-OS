// Working Fire Recordings: import NICE Inform ".distribution" exports.
//
// A .distribution file is a ZIP holding:
//   Index.xml                                  name (address), description, NICE's export ID
//   Original Data/<name>.incident              XML: incident number, start/end, and one
//                                              <IncidentSearchResults> per radio transmission
//                                              (time, talkgroup, radio alias) -> Audio_<id>.wav
//   Original Data/Reconstruction Content/*.wav 8 kHz mono PCM, one per transmission
//
// On import the original file is kept untouched (for the NICE player) and each
// transmission's WAV is saved, volume-boosted, so browsers can play it.
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pool, tx } from "./db.js";
import { UPLOAD_DIR } from "./files.js";
import { HttpError, isUuid, ROLE_LABEL } from "./collections.js";
import { hasLegacy } from "./access.js";
import { transcriberStatus, queueTranscript, cleanText } from "./transcribe.js";

const REC_DIR = path.join(UPLOAD_DIR, "recordings");
export const MAX_UPLOAD = Number(process.env.RECORDINGS_MAX_MB || 300) * 1024 * 1024;
const MAX_UNPACKED = 2 * 1024 * 1024 * 1024;   // refuse "zip bombs"
const MAX_ENTRIES = 20000;
const bad = msg => new HttpError(400, msg);

// ---------------------------------------------------------------------
// Minimal ZIP reader (stored and deflated entries)
// ---------------------------------------------------------------------
export function readZip(buf) {
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw bad("This isn't a NICE .distribution file (not a ZIP package).");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw bad("The package has too many files.");
  const entries = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw bad("The package is damaged.");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), xlen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nlen).replace(/\\/g, "/");
    off += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    total += usize;
    if (total > MAX_UNPACKED) throw bad("The package is too large once unpacked.");
    entries.set(name, { method, csize, usize, local });
  }
  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (buf.readUInt32LE(e.local) !== 0x04034b50) throw bad("The package is damaged.");
      const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.usize, 1) });
      throw bad("The package uses an unsupported compression type.");
    },
  };
}

// ---------------------------------------------------------------------
// NICE XML (simple, predictable structure; read with patterns, no DTDs)
// ---------------------------------------------------------------------
const unescape = s => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? unescape(m[1]).trim() : ""; };
const attr = (xml, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(xml); return m ? unescape(m[1]) : ""; };
const field = (xml, name) => {
  const m = new RegExp(`<Name>${name}</Name><SerializationType>[^<]*</SerializationType>(?:<Value>([\\s\\S]*?)</Value>|<Value\\s*/>)`).exec(xml);
  return m ? unescape(m[1] || "").trim() : "";
};
const validTime = s => (s && !isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);

export function parseDistribution(buf) {
  const zip = readZip(buf);
  const indexXml = zip.read("Index.xml")?.toString("utf8") || "";
  const incidentName = zip.names.find(n => /^Original Data\/[^/]+\.incident$/i.test(n));
  if (!indexXml.includes("<Distribution") || !incidentName) {
    throw bad("This doesn't look like a NICE Inform .distribution export (no incident inside).");
  }
  const inc = zip.read(incidentName).toString("utf8");
  const head = /<Incidents>([\s\S]*?)<\/Incidents>/.exec(inc)?.[1] || "";
  const clips = [];
  for (const m of inc.matchAll(/<IncidentSearchResults>([\s\S]*?)<\/IncidentSearchResults>/g)) {
    const x = m[1];
    const file = tag(x, "DataFilename");
    if (!/^Audio_\d+\.wav$/i.test(file)) continue;            // only plain audio files
    const zipPath = `Original Data/Reconstruction Content/${file}`;
    if (!zip.has(zipPath)) continue;
    const ser = unescape(/<XmlSerialization>([\s\S]*?)<\/XmlSerialization>/.exec(x)?.[1] || "");
    clips.push({
      itemId: Number(tag(x, "IncidentItemID")) || Number(file.match(/\d+/)[0]),
      zipPath,
      startedAt: validTime(tag(x, "StartTime")) || validTime(field(ser, "Start_Time") + "Z"),
      duration: Number(field(ser, "Duration")) || 0,
      talkgroup: field(ser, "ResourceAlias") || field(ser, "ResourceName"),
      unit: field(ser, "IndividualAlias"),
      unitId: field(ser, "UnitID"),
      site: field(ser, "SiteAlias"),
    });
  }
  if (!clips.length) throw bad("No radio audio was found in this file.");
  clips.sort((a, b) => (a.startedAt || "").localeCompare(b.startedAt || "") || a.itemId - b.itemId);
  const desc = tag(head, "Description") || attr(indexXml, "Description") || unescape(/<Description>([\s\S]*?)<\/Description>/.exec(indexXml)?.[1] || "");
  return {
    zip, clips,
    universalId: attr(indexXml, "UniversalID"),
    incidentNumber: tag(head, "IncidentNumber"),
    address: tag(head, "IncidentName") || attr(indexXml, "Name"),
    description: desc.replace(/\s+\d{2}-\d+\s*$/, "").trim(),
    startedAt: validTime(tag(head, "StartTime")) || clips[0].startedAt,
    endedAt: validTime(tag(head, "EndTime")) || clips[clips.length - 1].startedAt,
  };
}

// ---------------------------------------------------------------------
// WAV: find the 16-bit PCM data so it can be made louder
// ---------------------------------------------------------------------
function pcmInfo(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12, fmt = null;
  while (off + 8 <= wav.length) {
    const id = wav.toString("ascii", off, off + 4), size = wav.readUInt32LE(off + 4);
    if (id === "fmt ") fmt = { format: wav.readUInt16LE(off + 8), channels: wav.readUInt16LE(off + 10), rate: wav.readUInt32LE(off + 12), bits: wav.readUInt16LE(off + 22) };
    if (id === "data") return fmt && fmt.format === 1 && fmt.bits === 16 ? { ...fmt, start: off + 8, end: Math.min(wav.length, off + 8 + size) } : null;
    off += 8 + size + (size % 2);
  }
  return null;
}
function peakOf(wav, info) {
  let peak = 0;
  for (let i = info.start; i + 1 < info.end; i += 2) { const v = Math.abs(wav.readInt16LE(i)); if (v > peak) peak = v; }
  return peak;
}
function amplify(wav, info, gain) {
  const out = Buffer.from(wav);
  for (let i = info.start; i + 1 < info.end; i += 2) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out.readInt16LE(i) * gain))), i);
  }
  return out;
}

// ---------------------------------------------------------------------
// Access: master admins and anyone with the "recordings" permission
// ---------------------------------------------------------------------
export async function canUseRecordings(user) {
  if (!user) return false;
  if (user.role === "master") return true;
  return hasLegacy(pool, user, "recordings");
}
async function audit(c, user, action, detail) {
  await c.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail) VALUES ($1, $2, $3, 'Fire Recordings', $4, $5)`,
    [user.id, user.name, ROLE_LABEL[user.role] || user.role, action, detail]);
}
const recDir = id => path.join(REC_DIR, id);
const clean = (v, max = 300) => String(v ?? "").trim().slice(0, max);

function toJson(r) {
  return {
    id: r.id, incidentNumber: r.incident_number, address: r.address, description: r.description,
    department: r.department, notes: r.notes, startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null, clipCount: r.clip_count,
    audioSeconds: Number(r.audio_seconds), talkgroups: r.talkgroups ? r.talkgroups.split(" | ") : [],
    originalName: r.original_name, sizeBytes: Number(r.size_bytes),
    importedBy: r.imported_by_name, importedById: r.imported_by, importedAt: new Date(r.imported_at).toISOString(),
    transcript: { status: r.transcript_status || "", error: r.transcript_error || "", done: r.transcript_done || 0,
      at: r.transcript_at ? new Date(r.transcript_at).toISOString() : null, by: r.transcript_by || "", model: r.transcript_model || "" },
    commandBoardId: r.command_board_id || null,
  };
}

export async function importRecording(buf, originalName, department, user) {
  const p = parseDistribution(buf);
  if (p.universalId) {
    const dup = (await pool.query("SELECT id, address FROM fire_recordings WHERE universal_id = $1", [p.universalId])).rows[0];
    if (dup) throw Object.assign(new HttpError(409, `This recording was already imported (${dup.address}).`), { existingId: dup.id });
  }
  // Radio audio is recorded quietly: raise each transmission toward the same
  // loudness (up to 8x), so quiet and loud units sound alike
  const wavs = p.clips.map(c => p.zip.read(c.zipPath));
  let seconds = 0;
  wavs.forEach((w, i) => {
    const info = pcmInfo(w);
    seconds += info ? (info.end - info.start) / (2 * info.channels * info.rate) : p.clips[i].duration;
  });

  const id = crypto.randomUUID();
  const dir = recDir(id);
  await fs.mkdir(path.join(dir, "clips"), { recursive: true });
  try {
    await fs.writeFile(path.join(dir, "original.distribution"), buf);
    for (let i = 0; i < wavs.length; i++) {
      const info = pcmInfo(wavs[i]);
      const peak = info ? peakOf(wavs[i], info) : 0;
      const gain = peak > 0 ? Math.min(8, 26000 / peak) : 1;
      await fs.writeFile(path.join(dir, "clips", `${p.clips[i].itemId}.wav`), info && gain > 1.05 ? amplify(wavs[i], info, gain) : wavs[i]);
    }
    const talkgroups = [...new Set(p.clips.map(c => c.talkgroup).filter(Boolean))];
    await tx(async c => {
      await c.query(
        `INSERT INTO fire_recordings (id, universal_id, incident_number, address, description, department, started_at, ended_at,
           clip_count, audio_seconds, talkgroups, original_name, size_bytes, imported_by, imported_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, p.universalId || null, clean(p.incidentNumber, 60), clean(p.address), clean(p.description, 500), clean(department, 120),
          p.startedAt, p.endedAt, p.clips.length, Math.round(seconds * 100) / 100, talkgroups.join(" | "),
          clean(originalName, 255), buf.length, user.id, user.name]);
      for (const cl of p.clips) {
        await c.query(
          `INSERT INTO fire_recording_clips (recording_id, item_id, started_at, duration, talkgroup, unit, unit_id, site)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [id, cl.itemId, cl.startedAt, Math.round(cl.duration * 100) / 100, clean(cl.talkgroup, 120), clean(cl.unit, 120), clean(cl.unitId, 40), clean(cl.site, 120)]);
      }
      await audit(c, user, "Imported recording",
        `${p.address}${p.incidentNumber ? ` (${p.incidentNumber})` : ""} — ${p.clips.length} transmissions${department ? `, ${department}` : ""}`);
    });
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  // A command board for the same incident number joins the recording on its own
  await pool.query(`UPDATE fire_recordings f SET command_board_id = b.id FROM command_boards b
    WHERE f.id = $1 AND f.command_board_id IS NULL AND f.incident_number <> '' AND b.incident_number = f.incident_number`, [id]).catch(() => {});
  return getRecording(id);
}

async function getRecording(id) {
  const r = (await pool.query("SELECT * FROM fire_recordings WHERE id = $1", [id])).rows[0];
  if (!r) return null;
  const clips = (await pool.query(
    "SELECT * FROM fire_recording_clips WHERE recording_id = $1 ORDER BY started_at, item_id", [id])).rows;
  const board = r.command_board_id ? (await pool.query(`SELECT id, incident_number, nature, address, status, opened_at, closed_at, completed_by_name, opened_by_name
    FROM command_boards WHERE id = $1`, [r.command_board_id])).rows[0] : null;
  return {
    ...toJson(r),
    commandBoard: board ? { id: board.id, number: board.incident_number, nature: board.nature, address: board.address, status: board.status,
      openedAt: board.opened_at, closedAt: board.closed_at, commander: board.completed_by_name || board.opened_by_name } : null,
    clips: clips.map(c => ({
      id: String(c.item_id), startedAt: c.started_at ? new Date(c.started_at).toISOString() : null, duration: Number(c.duration),
      talkgroup: c.talkgroup, unit: c.unit, unitId: c.unit_id, site: c.site,
      text: c.transcript, edited: c.transcript_edited,
    })),
  };
}

// Read the raw request body as a Buffer, with a size cap
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", ch => {
      size += ch.length;
      if (size > limit) { reject(new HttpError(413, `That file is larger than ${Math.round(limit / 1048576)} MB.`)); req.destroy(); return; }
      chunks.push(ch);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// /api/recordings/...
export async function handleRecordings(req, res, parts, user, send, jsonBody) {
  if (!(await canUseRecordings(user))) return send(res, 403, { error: "You don't have access to Working Fire Recordings." });
  const isMaster = user.role === "master";
  const [, , a, b, c] = parts;   // api, recordings, a, b, c

  // Departments list
  if (a === "departments") {
    if (req.method === "GET" && !b) {
      const r = await pool.query("SELECT id, name FROM fire_departments ORDER BY name");
      return send(res, 200, { departments: r.rows });
    }
    if (!isMaster) return send(res, 403, { error: "Only master admins can change the department list." });
    if (req.method === "POST" && !b) {
      const name = clean((await jsonBody(req)).name, 120);
      if (!name) return send(res, 400, { error: "Enter a department name." });
      await pool.query("INSERT INTO fire_departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE" && /^\d+$/.test(b || "")) {
      await pool.query("DELETE FROM fire_departments WHERE id = $1", [Number(b)]);
      return send(res, 200, { ok: true });
    }
  }

  // Import: raw file body
  if (a === "import" && req.method === "POST") {
    const buf = await readRaw(req, MAX_UPLOAD);
    if (!buf.length) return send(res, 400, { error: "Choose a .distribution file." });
    const url = new URL(req.url, "http://x");
    try {
      const rec = await importRecording(buf, url.searchParams.get("name") || "recording.distribution", url.searchParams.get("department") || "", user);
      return send(res, 200, { recording: rec });
    } catch (err) {
      if (err.existingId) return send(res, 409, { error: err.message, existingId: err.existingId });
      throw err;
    }
  }

  // Is speech-to-text set up on this server?
  if (a === "transcriber" && req.method === "GET") return send(res, 200, transcriberStatus());

  // List
  if (!a && req.method === "GET") {
    const r = await pool.query("SELECT * FROM fire_recordings ORDER BY started_at DESC NULLS LAST, imported_at DESC");
    return send(res, 200, { recordings: r.rows.map(toJson) });
  }

  if (!isUuid(a)) return send(res, 404, { error: "Not found" });
  const rec = (await pool.query("SELECT * FROM fire_recordings WHERE id = $1", [a])).rows[0];
  if (!rec) return send(res, 404, { error: "That recording was not found." });

  // One recording with its transmissions
  if (!b && req.method === "GET") return send(res, 200, { recording: await getRecording(a) });

  // A transmission's audio
  if (b === "clips" && /^\d+\.wav$/.test(c || "") && req.method === "GET") {
    try {
      const data = await fs.readFile(path.join(recDir(a), "clips", c));
      res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": data.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(data);
    } catch { return send(res, 404, { error: "Audio not found" }); }
  }

  // Transcribe (queued; runs in the background). redo: start over, keeping hand corrections.
  if (b === "transcribe" && req.method === "POST") {
    const x = await jsonBody(req);
    try { await queueTranscript(a, user, x.redo === true); }
    catch (e) { return send(res, e.status || 500, { error: e.message }); }
    await audit(pool, user, x.redo ? "Re-ran transcript" : "Started transcript", `${rec.address}${rec.incident_number ? ` (${rec.incident_number})` : ""}`);
    return send(res, 200, { recording: await getRecording(a) });
  }
  // Correct one transmission's text (anyone who can listen; audited)
  if (b === "clips" && /^\d+$/.test(c || "") && req.method === "PUT") {
    const x = await jsonBody(req);
    const text = String(x.text ?? "").replace(/\s+/g, " ").trim().slice(0, 4000);
    const old = (await pool.query("SELECT transcript, unit, started_at FROM fire_recording_clips WHERE recording_id = $1 AND item_id = $2", [a, c])).rows[0];
    if (!old) return send(res, 404, { error: "That transmission was not found." });
    await tx(async c2 => {
      await c2.query("UPDATE fire_recording_clips SET transcript = $3, transcript_edited = true WHERE recording_id = $1 AND item_id = $2", [a, c, text]);
      await audit(c2, user, "Corrected transcript", `${rec.address}, ${old.unit || "radio"}: "${(old.transcript || "").slice(0, 120)}" → "${text.slice(0, 120)}"`);
    });
    return send(res, 200, { ok: true, text });
  }

  // The original file, for the NICE player
  if (b === "download" && req.method === "GET") {
    try {
      const data = await fs.readFile(path.join(recDir(a), "original.distribution"));
      const name = (rec.original_name || `${rec.address}.distribution`).replace(/[^\w .,()#-]/g, "_");
      res.writeHead(200, {
        "Content-Type": "application/octet-stream", "Content-Length": data.length, "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff",
      });
      return res.end(data);
    } catch { return send(res, 404, { error: "The original file is missing." }); }
  }

  // Attach / detach the incident's command board (anyone who can use recordings; written to the audit log)
  if (b === "command-board" && req.method === "PUT") {
    const x = await jsonBody(req);
    const boardId = x.boardId || null;
    if (boardId && !isUuid(boardId)) return send(res, 400, { error: "Pick a command board." });
    const board = boardId ? (await pool.query("SELECT incident_number, nature FROM command_boards WHERE id = $1", [boardId])).rows[0] : null;
    if (boardId && !board) return send(res, 404, { error: "That command board wasn't found." });
    await tx(async c2 => {
      await c2.query("UPDATE fire_recordings SET command_board_id = $2 WHERE id = $1", [a, boardId]);
      await audit(c2, user, boardId ? "Attached command board" : "Removed command board",
        `${rec.address}${board ? `: board for #${board.incident_number || "?"} ${board.nature}` : ""}`);
    });
    return send(res, 200, { recording: await getRecording(a) });
  }

  // Edit details (the person who imported it, or a master admin)
  if (!b && req.method === "PUT") {
    if (!isMaster && rec.imported_by !== user.id) return send(res, 403, { error: "Only the person who imported it or a master admin can edit it." });
    const x = await jsonBody(req);
    const next = {
      address: clean(x.address ?? rec.address), incident_number: clean(x.incidentNumber ?? rec.incident_number, 60),
      description: clean(x.description ?? rec.description, 500), department: clean(x.department ?? rec.department, 120),
      notes: clean(x.notes ?? rec.notes, 4000),
    };
    const changes = Object.entries(next).filter(([k, v]) => v !== rec[k]).map(([k, v]) => `${k.replace("_", " ")}: "${rec[k]}" → "${v}"`);
    if (changes.length) {
      await tx(async c2 => {
        await c2.query(
          `UPDATE fire_recordings SET address = $2, incident_number = $3, description = $4, department = $5, notes = $6 WHERE id = $1`,
          [a, next.address, next.incident_number, next.description, next.department, next.notes]);
        await audit(c2, user, "Edited recording", `${rec.address}: ${changes.join("; ")}`);
      });
    }
    return send(res, 200, { recording: await getRecording(a) });
  }

  // Delete (master admins)
  if (!b && req.method === "DELETE") {
    if (!isMaster) return send(res, 403, { error: "Only master admins can delete recordings." });
    await tx(async c2 => {
      await c2.query("DELETE FROM fire_recordings WHERE id = $1", [a]);
      await audit(c2, user, "Deleted recording", `${rec.address}${rec.incident_number ? ` (${rec.incident_number})` : ""}`);
    });
    await fs.rm(recDir(a), { recursive: true, force: true });
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "Not found" });
}
