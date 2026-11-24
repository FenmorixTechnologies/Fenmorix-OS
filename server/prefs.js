// Per-person display preferences (/api/prefs), saved on the account so they follow people
// to any device. Only known keys, small values.
import { pool } from "./db.js";

const KEYS = new Set(["yourDay"]);
const err = (status, message) => Object.assign(new Error(message), { status });

export async function handlePrefs(req, res, parts, user, send, jsonBody) {
  if (req.method === "GET") {
    const r = (await pool.query("SELECT ui_prefs FROM users WHERE id = $1", [user.id])).rows[0];
    return send(res, 200, { prefs: r?.ui_prefs || {} });
  }
  if (req.method === "POST") {
    const b = await jsonBody(req);
    if (!KEYS.has(b.key)) throw err(400, "Unknown setting.");
    const json = JSON.stringify(b.value ?? null);
    if (json.length > 8000) throw err(400, "That setting is too large.");
    await pool.query("UPDATE users SET ui_prefs = jsonb_set(ui_prefs, ARRAY[$2::text], $3::jsonb, true) WHERE id = $1", [user.id, b.key, json]);
    return send(res, 200, { ok: true });
  }
  throw err(404, "Not found");
}
