// Uploaded files: bytes go in the uploads folder, details go in the
// `files` table. The app sends and receives files as data: URLs, exactly
// as it did with artifact storage.
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Files the app asked to delete while a record still pointed at them.
// The app deletes the file first and saves the record second, so these
// are retried after every save, once nothing links to them anymore.
const pendingDeletes = new Set();

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// Which records point at a file: [collection key, table] (the record's own JSON carries the file id)
const LINKS = [["requisitions", "requisition_attachments"], ["reimbursements", "reimbursement_attachments"], ["tickets", "ticket_attachments"],
  ["quotes", "quote_attachments"], ["contracts", "contracts"], ["certifications", "certifications"], ["gear", "gear_items"]];
async function linksOf(id) {
  const out = [];
  for (const [key, table] of LINKS) if ((await pool.query(`SELECT 1 FROM ${table} WHERE file_id = $1 LIMIT 1`, [id])).rowCount) out.push(key);
  return out;
}
// Who may open a file: whoever uploaded it, master admins, and anyone who can see a record it's attached to (the
// collection's own read rules decide that). Everyone else gets "not found".
export async function canReadFile(id, actor) {
  if (!UUID_RE.test(id) || !actor) return false;
  const f = (await pool.query("SELECT uploaded_by FROM files WHERE id = $1", [id])).rows[0];
  if (!f) return false;
  if (actor.role === "master" || f.uploaded_by === actor.id) return true;
  const { readCollection } = await import("./collections.js");
  for (const key of await linksOf(id)) {
    try { if (JSON.stringify(await readCollection(key, actor)).includes(id)) return true; } catch { /* no access to that list */ }
  }
  return false;
}

export async function putFile(id, dataUrl, actor) {
  if (!UUID_RE.test(id)) throw badRequest("Bad file id");
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl || "");
  if (!m) throw badRequest("Bad file data");
  const bytes = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  // A stored file never changes once it's attached to a record or belongs to someone else (an invoice can't be swapped
  // for a different one under the same id). Sending the same bytes again is fine.
  const have = (await pool.query("SELECT uploaded_by, storage_key FROM files WHERE id = $1", [id])).rows[0];
  if (have) {
    const same = await fs.readFile(path.join(UPLOAD_DIR, have.storage_key)).then(b => b.equals(bytes), () => false);
    if (same) return;
    if (have.uploaded_by !== actor?.id || (await linksOf(id)).length) {
      const e = new Error("That file is already saved and can't be replaced. Attach a new one instead."); e.status = 409; throw e;
    }
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, id), bytes);
  await pool.query(
    `INSERT INTO files (id, storage_key, original_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1, $2, 'upload', $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [id, id, m[1] || "application/octet-stream", bytes.length, actor?.id ?? null]);
}

export async function getFile(id) {
  if (!UUID_RE.test(id)) return null;
  const r = await pool.query("SELECT storage_key, mime_type FROM files WHERE id = $1", [id]);
  if (!r.rowCount) return null;
  try {
    const bytes = await fs.readFile(path.join(UPLOAD_DIR, r.rows[0].storage_key));
    return `data:${r.rows[0].mime_type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function tryDelete(id) {
  const r = await pool.query("SELECT storage_key FROM files WHERE id = $1", [id]);
  if (!r.rowCount) return true;
  try {
    await pool.query("DELETE FROM files WHERE id = $1", [id]);
  } catch (err) {
    if (err.code === "23503") return false;   // still linked to a record
    throw err;
  }
  await fs.rm(path.join(UPLOAD_DIR, r.rows[0].storage_key), { force: true });
  return true;
}

// Called when a record that owned the file is deleted
export function markFileForDeletion(id) {
  if (UUID_RE.test(id)) pendingDeletes.add(id);
}

export async function deleteFile(id) {
  if (!UUID_RE.test(id)) return;
  if (!(await tryDelete(id))) pendingDeletes.add(id);
}

export async function flushPendingFileDeletes() {
  for (const id of [...pendingDeletes]) {
    try {
      if (await tryDelete(id)) pendingDeletes.delete(id);
    } catch (err) {
      console.error("File cleanup failed for", id, err.message);
    }
  }
}
