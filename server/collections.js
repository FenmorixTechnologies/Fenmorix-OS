// Translates between the app's records (the same shapes the original
// artifact kept in window.storage) and the Postgres tables in db/schema.sql.
//
// Every collection has:
//   read(c)            -> the app-shaped value for GET /api/collections/<key>
//   upsert(ctx, item)  -> insert or update one record
//   remove(ctx, id)    -> delete (or deactivate) one record
// or, for simple lists/values:
//   saveValue(ctx, value)
//
// Writes only touch rows whose values actually changed, so re-saving a
// finalized (locked) record that hasn't changed never trips the
// database's locking rules.
import { tx } from "./db.js";
import { hasLegacy, legacyAll, legacyScope, setLegacyPermissions, noPerms, clearAccessCache } from "./access.js";
import { flushPendingFileDeletes, markFileForDeletion } from "./files.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => typeof v === "string" && UUID_RE.test(v);

const nz = v => (v === undefined || v === null || v === "" ? null : v);
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const str = v => (v === undefined || v === null ? "" : String(v));
const iso = d => (d ? new Date(d).toISOString() : null);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

export const ROLE_LABEL = {
  user: "Requester", approver1: "Purchaser's signature", approver2: "Pre-approval",
  fire_chief: "Fire chief (final approval)", accounting: "Accounting", master: "Master admin",
};
const ROLES = Object.keys(ROLE_LABEL);
const FREQUENCIES = ["one_time", "monthly", "quarterly", "semiannually", "yearly"];
const TICKET_CATEGORIES = ["Hardware", "Software", "Network", "Account & Access", "Phone / Radio", "Printer", "Other"];
const GEAR_TICKET_CATEGORIES = ["Turnout gear", "Helmet", "SCBA", "Boots", "Gloves / Hood", "Uniform", "Station equipment", "Other"];
const TICKET_STATUSES = ["open", "acknowledged", "in_progress", "on_hold", "awaiting_delivery", "resolved", "closed"];
const DESKS = { helpdesk: { name: "Help Desk", section: "helpdesk" }, gear: { name: "Gear tickets", section: "gear" } };
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const ANNOUNCEMENT_PRIORITIES = ["Normal", "Important", "Urgent"];
const TIMEZONE = process.env.APP_TIMEZONE || "America/Chicago";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------

async function rowExists(c, table, id) {
  const r = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return r.rowCount > 0;
}

// Insert the row if it doesn't exist; otherwise update only columns whose
// values differ. `insertOnly` columns are written on insert and never changed.
async function upsert(c, table, keys, data, insertOnly = {}) {
  const kc = Object.keys(keys), kv = Object.values(keys);
  const where = kc.map((k, i) => `${k} = $${i + 1}`).join(" AND ");
  const found = await c.query(`SELECT 1 FROM ${table} WHERE ${where}`, kv);
  if (!found.rowCount) {
    const all = { ...keys, ...data, ...insertOnly };
    const cols = Object.keys(all);
    await c.query(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(", ")})`,
      Object.values(all));
    return "inserted";
  }
  const dc = Object.keys(data);
  if (!dc.length) return "same";
  const off = kc.length;
  const set = dc.map((k, i) => `${k} = $${off + i + 1}`).join(", ");
  const changed = dc.map((k, i) => `${k} IS DISTINCT FROM $${off + i + 1}`).join(" OR ");
  const r = await c.query(`UPDATE ${table} SET ${set} WHERE ${where} AND (${changed})`, [...kv, ...Object.values(data)]);
  return r.rowCount ? "updated" : "same";
}

// Make a child table match `items` (each with an .id): delete rows that are
// gone, insert new ones, update changed ones.
async function syncChildren(c, table, parentCol, parentId, items, toRow) {
  const existing = await c.query(`SELECT id FROM ${table} WHERE ${parentCol} = $1`, [parentId]);
  const want = new Set(items.map(i => String(i.id)));
  for (const r of existing.rows) {
    if (!want.has(r.id)) await c.query(`DELETE FROM ${table} WHERE id = $1`, [r.id]);
  }
  for (let i = 0; i < items.length; i++) {
    await upsert(c, table, { id: items[i].id }, { [parentCol]: parentId, ...(await toRow(items[i], i)) });
  }
}

async function updateFileMeta(c, meta) {
  if (!meta || !isUuid(meta.id)) return;
  await c.query(
    `UPDATE files SET original_name = $2,
            size_bytes = COALESCE($3, size_bytes),
            mime_type  = COALESCE($4, mime_type)
      WHERE id = $1 AND original_name IS DISTINCT FROM $2`,
    [meta.id, meta.name || "file", meta.size ?? null, meta.type || null]);
}

async function syncAttachments(c, table, parentCol, parentId, atts) {
  const list = (atts || []).filter(a => a && isUuid(a.id));
  const existing = await c.query(`SELECT file_id FROM ${table} WHERE ${parentCol} = $1`, [parentId]);
  const have = new Set(existing.rows.map(r => r.file_id));
  const want = new Set(list.map(a => a.id));
  for (const id of have) {
    if (!want.has(id)) await c.query(`DELETE FROM ${table} WHERE ${parentCol} = $1 AND file_id = $2`, [parentId, id]);
  }
  for (const a of list) {
    await updateFileMeta(c, a);
    if (!have.has(a.id)) await c.query(`INSERT INTO ${table} (${parentCol}, file_id) VALUES ($1, $2)`, [parentId, a.id]);
  }
}

function fileMetaFromRow(r) {
  return {
    id: r.file_id, name: r.original_name, size: Number(r.size_bytes), type: r.mime_type || "",
    uploadedBy: r.uploader || "", uploadedAt: iso(r.uploaded_at),
  };
}

// All attachments for a link table, grouped by parent id
async function attachmentsByParent(c, linkTable, parentCol) {
  const r = await c.query(
    `SELECT l.${parentCol} AS parent, f.id AS file_id, f.original_name, f.size_bytes, f.mime_type,
            f.uploaded_at, u.full_name AS uploader
       FROM ${linkTable} l
       JOIN files f ON f.id = l.file_id
       LEFT JOIN users u ON u.id = f.uploaded_by
      ORDER BY f.uploaded_at`);
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.parent)) map.set(row.parent, []);
    map.get(row.parent).push(fileMetaFromRow(row));
  }
  return map;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

function forbid(message) { throw new HttpError(403, message); }
const isMaster = a => a?.role === "master";
const GLOBAL_ROLES = ["master", "fire_chief", "accounting"];

async function setImporting(c, on) {
  await c.query("SELECT set_config('sgfd.importing', $1, true)", [on ? "on" : "off"]);
}

// Name -> id lookups, cached for the length of one save
async function divisionId(ctx, name) {
  if (name === undefined || name === null || name === "") return null;
  const key = "div:" + name;
  if (!ctx.cache.has(key)) {
    const r = await ctx.c.query("SELECT id FROM divisions WHERE name = $1", [name]);
    if (!r.rowCount) throw new HttpError(409, `Unknown division "${name}"`);
    ctx.cache.set(key, r.rows[0].id);
  }
  return ctx.cache.get(key);
}
async function categoryId(ctx, name) {
  const key = "cat:" + name;
  if (!ctx.cache.has(key)) {
    let r = await ctx.c.query("SELECT id FROM categories WHERE name = $1", [name]);
    if (!r.rowCount) r = await ctx.c.query("SELECT id FROM categories WHERE name = 'Other'");
    if (!r.rowCount) throw new HttpError(409, `Unknown category "${name}"`);
    ctx.cache.set(key, r.rows[0].id);
  }
  return ctx.cache.get(key);
}
async function userIdByName(ctx, name) {
  if (!name) return null;
  const key = "user:" + name;
  if (!ctx.cache.has(key)) {
    const r = await ctx.c.query(
      "SELECT id FROM users WHERE full_name = $1 ORDER BY active DESC, created_at LIMIT 1", [name]);
    ctx.cache.set(key, r.rowCount ? r.rows[0].id : null);
  }
  return ctx.cache.get(key);
}
async function ensureVendor(ctx, vendorId, name) {
  if (isUuid(vendorId) && (await rowExists(ctx.c, "vendors", vendorId))) return vendorId;
  const clean = str(name).trim();
  if (!clean) throw new HttpError(409, "A vendor is required");
  const r = await ctx.c.query("SELECT id FROM vendors WHERE lower(btrim(name)) = lower($1)", [clean]);
  if (r.rowCount) return r.rows[0].id;
  const ins = await ctx.c.query("INSERT INTO vendors (name) VALUES ($1) RETURNING id", [clean]);
  return ins.rows[0].id;
}

// Keep a simple name list (divisions or categories) in step with the app.
// One name removed + one added in the same save is treated as a rename,
// so everything linked to it follows automatically.
async function saveNameList(c, table, list) {
  const names = [...new Set((list || []).map(s => String(s).trim()).filter(Boolean))];
  const cur = (await c.query(`SELECT id, name FROM ${table}`)).rows;
  const curNames = new Set(cur.map(r => r.name));
  const added = names.filter(n => !curNames.has(n));
  const removed = cur.filter(r => !names.includes(r.name));
  if (added.length === 1 && removed.length === 1) {
    await c.query(`UPDATE ${table} SET name = $2 WHERE id = $1`, [removed[0].id, added[0]]);
    return;
  }
  for (const n of added) await c.query(`INSERT INTO ${table} (name) VALUES ($1)`, [n]);
  for (const r of removed) await c.query(`DELETE FROM ${table} WHERE id = $1`, [r.id]);
}

// ---------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------

// Profile details (only the ones sent are changed)
async function saveProfile(c, u) {
  const sets = [], vals = [u.id];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if ("employeeNumber" in u) put("employee_number", nz(u.employeeNumber));
  if ("jobTitle" in u) put("job_title", nz(u.jobTitle));
  if ("station" in u) put("station", nz(u.station));
  if ("hireDate" in u) put("hire_date", /^\d{4}-\d{2}-\d{2}$/.test(String(u.hireDate || "")) ? u.hireDate : null);
  if (u.address && typeof u.address === "object") {
    put("street", nz(u.address.street)); put("city", nz(u.address.city));
    put("state", nz(u.address.state)); put("zip", nz(u.address.zip));
  }
  if (!sets.length) return;
  const changed = sets.map(x => { const [col, p] = x.split(" = "); return `${col} IS DISTINCT FROM ${p}`; }).join(" OR ");
  await c.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1 AND (${changed})`, vals);
}

const roster = {
  async read(c, actor) {
    const r = await c.query(
      `SELECT u.*, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
        WHERE u.active AND u.account_status = 'approved' ORDER BY u.created_at, u.full_name`);
    const perms = await allPermissions(c);
    const seePrivate = isMaster(actor) || await hasPerm(c, actor, "directory_admin");
    const signDivs = new Map();
    for (const row of (await c.query(
      `SELECT usd.user_id, d.name FROM user_sign_divisions usd JOIN divisions d ON d.id = usd.division_id ORDER BY d.name`)).rows) {
      if (!signDivs.has(row.user_id)) signDivs.set(row.user_id, []);
      signDivs.get(row.user_id).push(row.name);
    }
    return r.rows.map(u => {
      const o = {
        id: u.id, name: u.full_name, division: u.division, role: u.role,
        phone: str(u.phone), email: str(u.email), signDivisions: signDivs.get(u.id) || [],
        permissions: perms.get(u.id) || noPerms(),
        ...(actor?.id === u.id ? { manages: perms.manages?.get(u.id) || [], access: perms.sections?.get(u.id) || {} } : {}),
        jobTitle: str(u.job_title), station: str(u.station), extension: str(u.extension),
        workPattern: str(u.work_pattern),
        // Works Help Desk tickets: Technology, master admins, or Help Desk: Edit
        helpdeskTech: u.division === "Technology" || u.role === "master" || ["edit", "manage"].includes(perms.sections?.get(u.id)?.helpdesk),
        gearTech: u.role === "master" || ["edit", "manage"].includes(perms.sections?.get(u.id)?.gear),
      };
      // Home phone and emergency contacts are private: the person, master admins and directory admins
      if (seePrivate || actor?.id === u.id) {
        o.homePhone = str(u.home_phone);
        o.emergencyContactName = str(u.emergency_contact_name);
        o.emergencyContactPhone = str(u.emergency_contact_phone);
        o.emergencyContactRelationship = str(u.emergency_contact_relationship);
      }
      if (isMaster(actor) || actor?.id === u.id) {
        // Profile details used to fill in forms
        o.employeeNumber = str(u.employee_number);
        o.hireDate = u.hire_date ? String(u.hire_date).slice(0, 10) : "";
        o.address = { street: str(u.street), city: str(u.city), state: str(u.state), zip: str(u.zip) };
      }
      return o;
    });
  },
  async upsert(ctx, u) {
    if (!isMaster(ctx.actor)) {
      // Everyone else may only update their own contact details
      if (u.id !== ctx.actor?.id) return;
      await ctx.c.query(
        `UPDATE users SET phone = $2, emergency_contact_name = $3, emergency_contact_phone = $4
          WHERE id = $1`, [u.id, nz(u.phone), nz(u.emergencyContactName), nz(u.emergencyContactPhone)]);
      if (u.email !== undefined && nz(u.email) !== null) {
        await ctx.c.query("UPDATE users SET email = $2 WHERE id = $1 AND email IS DISTINCT FROM $2", [u.id, String(u.email).trim().toLowerCase()]);
      }
      await saveProfile(ctx.c, u);
      return;
    }
    const existing = (await ctx.c.query("SELECT emergency_contact_name, emergency_contact_phone FROM users WHERE id = $1", [u.id])).rows[0];
    await upsert(ctx.c, "users", { id: u.id }, {
      full_name: str(u.name).trim() || "(no name)",
      division_id: await divisionId(ctx, u.division),
      role: pick(u.role, ROLES, "user"),
      phone: nz(u.phone), email: u.email ? String(u.email).trim().toLowerCase() : null,
      emergency_contact_name: "emergencyContactName" in u ? nz(u.emergencyContactName) : (existing?.emergency_contact_name ?? null),
      emergency_contact_phone: "emergencyContactPhone" in u ? nz(u.emergencyContactPhone) : (existing?.emergency_contact_phone ?? null),
      active: true,
    });
    await saveProfile(ctx.c, u);
    if (Array.isArray(u.signDivisions)) await setSignDivisions(ctx.c, u.id, u.signDivisions);
    clearAccessCache();   // division / role changes move people in and out of rule-based groups
    if (u.permissions && typeof u.permissions === "object") await setPermissions(ctx, u.id, u.name, u.permissions);
  },
  // People are never deleted (their history must keep pointing at them);
  // removing someone deactivates them and signs them out everywhere.
  async remove(ctx, id) {
    if (!isMaster(ctx.actor)) forbid("Only a master admin can remove people.");
    if (id === ctx.actor.id) forbid("You can't remove your own account.");
    await ctx.c.query("UPDATE users SET active = false WHERE id = $1", [id]);
    await ctx.c.query("DELETE FROM sessions WHERE user_id = $1", [id]);
  },
};

// ---------------------------------------------------------------------
// Permissions: stored as grants and groups (server/access.js). The roster still
// reports them in the original shape: { timeView: [...], ... } ("*" = all divisions).
// ---------------------------------------------------------------------

// Does this person hold a whole-department permission (or are they a master admin)?
export async function hasPerm(c, user, permission) {
  if (!user) return false;
  if (user.role === "master") return true;
  return hasLegacy(c, user, permission);
}
async function allPermissions(c) {
  const all = await legacyAll(c);
  const out = new Map();
  for (const [uid, v] of all) out.set(uid, v.perms);
  out.manages = new Map([...all].map(([uid, v]) => [uid, v.manages]));
  out.sections = new Map([...all].map(([uid, v]) => [uid, v.sections]));
  return out;
}
// { all: bool, divisions: Set<name> } for one user and permission
async function permissionScope(c, userId, permission) {
  return legacyScope(c, userId, permission);
}
async function setPermissions(ctx, userId, userName, perms) {
  const changes = await setLegacyPermissions(ctx.c, ctx.actor, userId, perms);
  if (changes.length) await auditInTx(ctx, "User Management", "Changed permissions", `${userName || userId}: ${changes.join("; ")}`);
}


// Divisions (beyond their own) an approver may sign for
export async function setSignDivisions(c, userId, names) {
  const want = [...new Set((names || []).map(String))];
  const ids = [];
  for (const name of want) {
    const r = await c.query("SELECT id FROM divisions WHERE name = $1", [name]);
    if (r.rowCount) ids.push(r.rows[0].id);
  }
  const have = (await c.query("SELECT division_id FROM user_sign_divisions WHERE user_id = $1", [userId])).rows.map(r => r.division_id);
  for (const id of have) if (!ids.includes(id)) await c.query("DELETE FROM user_sign_divisions WHERE user_id = $1 AND division_id = $2", [userId, id]);
  for (const id of ids) if (!have.includes(id)) await c.query("INSERT INTO user_sign_divisions (user_id, division_id) VALUES ($1, $2)", [userId, id]);
}

const divisions = {
  async read(c) { return (await c.query("SELECT name FROM divisions ORDER BY name")).rows.map(r => r.name); },
  async saveValue(ctx, value) {
    if (!isMaster(ctx.actor)) forbid("Only a master admin can change divisions.");
    await saveNameList(ctx.c, "divisions", value);
  },
};

const categories = {
  // Original order (Equipment first, the app's default), new ones after
  async read(c) { return (await c.query("SELECT name FROM categories ORDER BY id")).rows.map(r => r.name); },
  async saveValue(ctx, value) {
    if (!isMaster(ctx.actor)) forbid("Only a master admin can change categories.");
    await saveNameList(ctx.c, "categories", value);
  },
};

const mileageRate = {
  async read(c) {
    const r = await c.query("SELECT value FROM settings WHERE key = 'mileage_rate'");
    return r.rowCount ? Number(r.rows[0].value) : null;
  },
  async saveValue(ctx, value) {
    if (!isMaster(ctx.actor)) forbid("Only a master admin can change the mileage rate.");
    const v = num(value);
    if (v <= 0) throw new HttpError(409, "Enter a valid mileage rate");
    await ctx.c.query(
      `INSERT INTO settings (key, value) VALUES ('mileage_rate', to_jsonb($1::numeric))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [v]);
  },
};

const vendors = {
  async read(c) {
    const r = await c.query("SELECT * FROM vendors ORDER BY name");
    return r.rows.map(v => ({
      id: v.id, name: v.name, phone: str(v.phone), fax: str(v.fax), address: str(v.address),
      city: str(v.city), state: str(v.state), zip: str(v.zip), accountNumber: str(v.account_number),
      repName: str(v.rep_name), repPhone: str(v.rep_phone), repEmail: str(v.rep_email), createdAt: iso(v.created_at),
    }));
  },
  async upsert(ctx, v) {
    await upsert(ctx.c, "vendors", { id: v.id }, {
      name: str(v.name).trim(), phone: nz(v.phone), fax: nz(v.fax), address: nz(v.address),
      city: nz(v.city), state: nz(v.state), zip: nz(v.zip), account_number: nz(v.accountNumber),
      rep_name: nz(v.repName), rep_phone: nz(v.repPhone), rep_email: nz(v.repEmail),
    }, { created_at: nz(v.createdAt) ?? new Date().toISOString() });
  },
  async remove(ctx, id) { await ctx.c.query("DELETE FROM vendors WHERE id = $1", [id]); },
};

// ---- Dates ----------------------------------------------------------
// Requisition and quote dates are calendar dates (no time). Signature and
// paid dates are moments; when someone types only a date we store noon,
// Central time, so the day never shifts in any time zone display.
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
function localDate(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) return s.slice(0, 10);   // no zone: already local
  const d = new Date(s);
  return isNaN(d) ? null : dayFmt.format(d);
}
function noonISO(day) {
  const guess = new Date(`${day}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, timeZoneName: "shortOffset" })
    .formatToParts(guess).find(p => p.type === "timeZoneName").value;          // e.g. "GMT-5"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  const offset = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  return new Date(guess.getTime() - offset * 60000).toISOString();
}
// A date the user picked: date-only -> noon local; full timestamp -> as given
function momentFrom(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s)) return noonISO(s.slice(0, 10));
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}
const today = () => dayFmt.format(new Date());
const prettyDay = d => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "none");

async function setDateCorrection(c, on) {
  await c.query("SELECT set_config('sgfd.date_correction', $1, true)", [on ? "on" : "off"]);
}
async function auditInTx(ctx, module, action, detail) {
  await ctx.c.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ctx.actor.id, ctx.actor.name, ROLE_LABEL[ctx.actor.role] || ctx.actor.role, module, action, detail]);
}

// Does this person cover a division: their own, or one they're set to sign for?
async function covers(c, userId, homeDivision, division) {
  if (homeDivision === division) return true;
  const r = await c.query(
    `SELECT 1 FROM user_sign_divisions usd JOIN divisions d ON d.id = usd.division_id
      WHERE usd.user_id = $1 AND d.name = $2`, [userId, division]);
  return r.rowCount > 0;
}
const actorCovers = (ctx, division) => covers(ctx.c, ctx.actor.id, ctx.actor.division, division);

const STAGE_ROLE = { auth1: "approver1", auth2: "approver2", chief: "fire_chief" };
const STAGE_FOR_STATUS = { pending_auth1: "auth1", pending_auth2: "auth2", pending_chief: "chief" };

// Can this user sign this stage for this division?
async function eligibleSigner(c, userId, stage, division) {
  if (!isUuid(userId)) return false;
  const u = (await c.query(
    `SELECT u.id, u.role, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
      WHERE u.id = $1 AND u.active AND u.account_status = 'approved'`, [userId])).rows[0];
  if (!u) return false;
  if (u.role === "master") return true;
  if (u.role !== STAGE_ROLE[stage]) return false;
  if (stage === "chief") return true;
  return covers(c, u.id, u.division, division);
}

// Who may sign each stage (mirrors the app's screens)
async function checkCanSign(ctx, reqId, stage) {
  const r = (await ctx.c.query(
    `SELECT r.status, d.name AS division FROM requisitions r JOIN divisions d ON d.id = r.division_id
      WHERE r.id = $1`, [reqId])).rows[0];
  const expected = { auth1: "pending_auth1", auth2: "pending_auth2", chief: "pending_chief" }[stage];
  if (!r || r.status !== expected) forbid("This requisition isn't waiting for that signature.");
  if (await eligibleSigner(ctx.c, ctx.actor.id, stage, r.division)) return;
  forbid("You don't have permission to sign this requisition at this stage.");
}

async function checkCanMarkPaid(ctx, division) {
  const a = ctx.actor;
  if (["master", "fire_chief", "accounting"].includes(a.role)) return;
  if (a.role === "approver2" && (await actorCovers(ctx, division))) return;
  forbid("You don't have permission to mark requisitions paid.");
}

// Master admins and accounting may record a signature someone gave on paper
const canRecordPaper = a => ["master", "accounting"].includes(a?.role);

const STAGE_NAME = { auth1: "Purchaser's signature", auth2: "Pre-approval", chief: "Final approval" };

// ---- Nexus messages about requisitions, reimbursements and tickets ---------------------------------
// Queued during the save and sent after it commits (ctx.after), from the person who made the change.
const usd = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function notify(ctx, to, subject, body) {
  const ids = [...new Set((to || []).filter(id => isUuid(id) && id !== ctx.actor.id))];
  if (!ids.length) return;
  ctx.after.push(async () => {
    const { send } = await import("./messages.js");
    try { await send(ctx.actor, { users: ids, important: false, timing: "now", subject, body }); }
    catch (e) { console.warn(`[Notify] ${subject}: ${e.message}`); }
  });
}
async function activeUsers(c, where, params = []) {
  return (await c.query(`SELECT u.id, u.role, d.name AS division FROM users u JOIN divisions d ON d.id = u.division_id
     WHERE u.active AND u.account_status = 'approved' AND ${where}`, params)).rows;
}
// Who can sign a stage for a division (not master admins, who can sign anything but aren't the usual signers)
async function stageSigners(c, stage, division) {
  const out = [];
  for (const u of await activeUsers(c, "u.role::text = $1", [STAGE_ROLE[stage]])) {
    if (stage === "chief" || (await covers(c, u.id, u.division, division))) out.push(u.id);
  }
  return out;
}
const roleIds = async (c, roles) => (await activeUsers(c, "u.role::text = ANY(string_to_array($1, ','))", [roles.join(",")])).map(u => u.id);

// The chosen next signer, if they're allowed to sign that stage
async function validNextSigner(c, userId, stage, division) {
  if (!stage || !isUuid(userId)) return null;
  if (!(await eligibleSigner(c, userId, stage, division))) {
    forbid("That person can't sign this stage for this division.");
  }
  return userId;
}
async function noteRouted(ctx, userId, stage, title) {
  const n = (await ctx.c.query("SELECT full_name FROM users WHERE id = $1", [userId])).rows[0]?.full_name;
  await auditInTx(ctx, "Procurement", `Sent for ${STAGE_NAME[stage]}`, `${title} → ${n}`);
}

// Who sees which requisitions (same as the screens): master admins, the Fire Chief and accounting see
// all; everyone else sees their home division, the divisions they sign for, and their own requests
async function reqScope(c, actor) {
  if (!actor || GLOBAL_ROLES.includes(actor.role)) return null;
  const divs = new Set([actor.division]);
  for (const r of (await c.query(
    `SELECT d.name FROM user_sign_divisions usd JOIN divisions d ON d.id = usd.division_id WHERE usd.user_id = $1`, [actor.id])).rows) divs.add(r.name);
  return divs;
}
// A drawn signature: a PNG data URL, at most ~200 KB
function signatureImage(v) {
  if (typeof v !== "string" || !v) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 280000) forbid("That signature picture isn't valid. Clear it and sign again.");
  return v;
}
// The drawn signature on one stage of a requisition (same visibility as the requisition)
export async function requisitionSignature(actor, id, stage) {
  if (!isUuid(id) || !["auth1", "auth2", "chief"].includes(stage)) return null;
  return tx(async c => {
    const r = (await c.query(`SELECT r.requested_by, d.name AS division, s.signature_image FROM requisition_signatures s
      JOIN requisitions r ON r.id = s.requisition_id JOIN divisions d ON d.id = r.division_id WHERE s.requisition_id = $1 AND s.stage = $2`, [id, stage])).rows[0];
    if (!r?.signature_image) return null;
    const scope = await reqScope(c, actor);
    if (scope && !scope.has(r.division) && r.requested_by !== actor.id) return null;
    return r.signature_image;
  });
}

const requisitions = {
  async read(c, actor) {
    const scope = await reqScope(c, actor);
    const r = await c.query(
      `SELECT r.*, r.req_date::text AS req_day, d.name AS division, cat.name AS category, v.name AS vendor,
              ns.full_name AS next_signer_name
         FROM requisitions r
         JOIN divisions d   ON d.id = r.division_id
         JOIN categories cat ON cat.id = r.category_id
         JOIN vendors v     ON v.id = r.vendor_id
         LEFT JOIN users ns ON ns.id = r.next_signer_id
        ORDER BY r.req_date DESC, r.created_at DESC`);
    if (scope) r.rows = r.rows.filter(q => scope.has(q.division) || q.requested_by === actor.id);
    const lines = groupBy((await c.query("SELECT * FROM requisition_line_items ORDER BY position")).rows, "requisition_id");
    const sigs = groupBy((await c.query(`SELECT requisition_id, stage, signer_name, signed_at, decision, note, recorded_by_name,
      (signature_image IS NOT NULL) AS drawn FROM requisition_signatures`)).rows, "requisition_id");
    const atts = await attachmentsByParent(c, "requisition_attachments", "requisition_id");
    return r.rows.map(q => {
      const sig = stage => {
        const s = (sigs.get(q.id) || []).find(x => x.stage === stage);
        if (!s) return null;
        const o = { name: s.signer_name, date: iso(s.signed_at), decision: s.decision, note: s.note };
        if (s.recorded_by_name) o.recordedBy = s.recorded_by_name;
        if (s.drawn) o.drawn = true;           // the picture: GET /api/req-signature/:id/:stage
        return o;
      };
      const o = {
        id: q.id, division: q.division, category: q.category, title: q.title,
        vendor: q.vendor, vendorId: q.vendor_id, description: q.description, contractual: q.contractual,
        frequency: q.frequency, amount: Number(q.amount),
        lineItems: (lines.get(q.id) || []).map(li => ({
          id: li.id, description: li.description, amount: Number(li.amount), frequency: li.frequency,
        })),
        invoiceNumber: str(q.invoice_number), paymentMethod: str(q.payment_method),
        cardLast4: str(q.card_last4), cardholderName: str(q.cardholder_name),
        // The requisition's own date (local, no time zone); enteredAt is when it was typed in
        requestedBy: q.requested_by_name, createdAt: `${q.req_day}T12:00:00`, enteredAt: iso(q.created_at),
        status: q.status,
        auth1: sig("auth1"), auth2: sig("auth2"), chief: sig("chief"),
        paidDate: iso(q.paid_at), rejectedReason: q.rejected_reason, attachments: atts.get(q.id) || [],
      };
      if (q.quote_id) o.quoteId = q.quote_id;
      if (q.next_signer_id && STAGE_FOR_STATUS[q.status]) {
        o.nextSignerId = q.next_signer_id; o.nextSignerName = q.next_signer_name;
      }
      if (q.repeated_from) o.repeatedFrom = q.repeated_from;
      return o;
    });
  },

  async upsert(ctx, q) {
    const c = ctx.c, a = ctx.actor;
    const card = q.paymentMethod === "Credit card";
    const data = {
      division_id: await divisionId(ctx, q.division),
      category_id: await categoryId(ctx, q.category),
      title: str(q.title).trim() || "(untitled)",
      vendor_id: await ensureVendor(ctx, q.vendorId, q.vendor),
      description: str(q.description),
      contractual: !!q.contractual,
      frequency: pick(q.frequency, FREQUENCIES, "one_time"),
      amount: num(q.amount),
      invoice_number: nz(q.invoiceNumber),
      payment_method: nz(q.paymentMethod),
      card_last4: card ? nz(q.cardLast4) : null,
      cardholder_name: card ? nz(q.cardholderName) : null,
      status: q.status || "pending_auth1",
      rejected_reason: nz(q.rejectedReason),
    };

    const prev = (await c.query(
      `SELECT r.*, r.req_date::text AS req_day, d.name AS division, cat.name AS category, v.name AS vendor_name
         FROM requisitions r
         JOIN divisions d ON d.id = r.division_id
         JOIN categories cat ON cat.id = r.category_id
         JOIN vendors v ON v.id = r.vendor_id
        WHERE r.id = $1`, [q.id])).rows[0];

    // ---------- New requisition ----------
    if (!prev) {
      const finalized = data.status !== "pending_auth1";   // historical entry with signatures already on paper
      if (finalized && !canRecordPaper(a)) forbid("New requisitions start at the purchaser's signature.");
      if (!isMaster(a) && !canRecordPaper(a) && !(await actorCovers(ctx, q.division))) {
        forbid("You can only submit requisitions for your own division.");
      }
      const onBehalf = canRecordPaper(a) && q.requestedBy && q.requestedBy !== a.name;
      const quoteId = isUuid(q.quoteId) && (await rowExists(c, "quotes", q.quoteId)) ? q.quoteId : null;
      const repeatedFrom = isUuid(q.repeatedFrom) && (await rowExists(c, "requisitions", q.repeatedFrom)) ? q.repeatedFrom : null;
      const paidDay = localDate(q.paidDate);
      await upsert(c, "requisitions", { id: q.id }, {
        ...data,
        req_date: localDate(q.createdAt) || today(),
        paid_at: data.status === "paid" ? (paidDay ? noonISO(paidDay) : new Date().toISOString()) : null,
      }, {
        requested_by: onBehalf ? await userIdByName(ctx, q.requestedBy) : a.id,
        requested_by_name: onBehalf ? str(q.requestedBy) : a.name,
        created_at: new Date().toISOString(),
        imported: finalized,
        quote_id: quoteId,
        repeated_from: repeatedFrom,
        next_signer_id: finalized ? null : await validNextSigner(c, q.nextSignerId, "auth1", q.division),
      });
      if (!finalized && isUuid(q.nextSignerId)) await noteRouted(ctx, q.nextSignerId, "auth1", data.title);
      if (!finalized) {
        const routed = await validNextSigner(c, q.nextSignerId, "auth1", q.division);
        notify(ctx, routed ? [routed] : await stageSigners(c, "auth1", q.division), `Requisition to sign: ${data.title}`,
          `${a.name} submitted a requisition for your purchaser's signature:\n\n${data.title}\n${q.vendor || ""} · ${usd(data.amount)} · ${q.division}\n\n` +
          `Open Procurement > Requisitions > Waiting for me to sign it.`);
      }
      if (finalized) await setImporting(c, true);
      for (const stage of ["auth1", "auth2", "chief"]) {
        const sg = q[stage];
        if (!sg) continue;
        if (finalized) {
          await c.query(
            `INSERT INTO requisition_signatures
               (requisition_id, stage, signer_id, signer_name, decision, note, signed_at, recorded_by, recorded_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [q.id, stage, await userIdByName(ctx, sg.name), sg.name || "Unknown",
             sg.decision === "rejected" ? "rejected" : "approved", str(sg.note),
             momentFrom(sg.date) ?? new Date().toISOString(),
             sg.name !== a.name ? a.id : null, sg.name !== a.name ? a.name : null]);
        }
      }
      await syncChildren(c, "requisition_line_items", "requisition_id", q.id, q.lineItems || [], (li, i) => ({
        position: i, description: str(li.description), amount: num(li.amount),
        frequency: pick(li.frequency, FREQUENCIES, "one_time"),
      }));
      await syncAttachments(c, "requisition_attachments", "requisition_id", q.id, q.attachments);
      if (finalized) await setImporting(c, false);
      return;
    }

    // ---------- Existing requisition ----------
    const pending = prev.status.startsWith("pending");

    // What details (not status, signatures or dates) are being changed?
    const changes = [];
    const fmtMoney = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const same = (x, y) => String(x ?? "") === String(y ?? "");
    const cmp = (label, before, after, show = v => v) => {
      if (!same(before, after)) changes.push(`${label}: "${show(before) ?? ""}" → "${show(after) ?? ""}"`);
    };
    cmp("Title", prev.title, data.title);
    if (data.vendor_id !== prev.vendor_id) {
      const vn = (await c.query("SELECT name FROM vendors WHERE id = $1", [data.vendor_id])).rows[0]?.name;
      changes.push(`Vendor: "${prev.vendor_name}" → "${vn}"`);
    }
    if (data.division_id !== prev.division_id) changes.push(`Division: "${prev.division}" → "${q.division}"`);
    if (data.category_id !== prev.category_id) changes.push(`Category: "${prev.category}" → "${q.category}"`);
    cmp("Description", prev.description, data.description);
    cmp("Contractual", prev.contractual ? "yes" : "no", data.contractual ? "yes" : "no");
    cmp("Frequency", prev.frequency, data.frequency);
    if (Number(prev.amount) !== Number(data.amount)) changes.push(`Amount: ${fmtMoney(prev.amount)} → ${fmtMoney(data.amount)}`);
    cmp("Invoice #", prev.invoice_number, data.invoice_number);
    cmp("Payment method", prev.payment_method, data.payment_method);
    cmp("Card last 4", prev.card_last4, data.card_last4);
    cmp("Cardholder", prev.cardholder_name, data.cardholder_name);
    if (!same(prev.rejected_reason, data.rejected_reason) && data.status === prev.status) cmp("Rejection reason", prev.rejected_reason, data.rejected_reason);
    const prevLines = (await c.query(
      "SELECT description, amount, frequency FROM requisition_line_items WHERE requisition_id = $1 ORDER BY position", [q.id])).rows;
    const lineText = rows => rows.map(li => `${li.description} ${fmtMoney(li.amount)} ${li.frequency}`).join("; ") || "none";
    const wantLines = (q.lineItems || []).map(li => ({ description: str(li.description), amount: num(li.amount), frequency: pick(li.frequency, FREQUENCIES, "one_time") }));
    if (lineText(prevLines) !== lineText(wantLines)) changes.push(`Line items: ${lineText(prevLines)} → ${lineText(wantLines)}`);

    let masterEdit = false;
    if (changes.length) {
      if (pending) {
        if (!(isMaster(a) || a.role === "accounting" || prev.requested_by === a.id)) {
          forbid("Only the requester, accounting or a master admin can edit this requisition.");
        }
      } else {
        if (!isMaster(a)) forbid("This requisition is finalized. Only a master admin can edit it.");
        if (data.status !== prev.status) forbid("Edit the details and change the status in separate steps.");
        masterEdit = true;
      }
    }
    const corrections = [];
    const canFixDates = isMaster(a) || (pending && (canRecordPaper(a) || prev.requested_by === a.id));
    const dateDenied = what => forbid(`You can't change the ${what} on this requisition` +
      (pending ? "." : " now that it's finalized. Ask a master admin."));

    // Requisition date
    const wantDay = localDate(q.createdAt);
    if (wantDay && wantDay !== prev.req_day) {
      if (!canFixDates) dateDenied("date");
      data.req_date = wantDay;
      corrections.push(`Requisition date ${prettyDay(prev.req_day)} → ${prettyDay(wantDay)}`);
    }

    // Paid date
    const prevPaidDay = prev.paid_at ? localDate(prev.paid_at) : null;
    if (data.status === "paid" && prev.status !== "paid") {
      await checkCanMarkPaid(ctx, prev.division);
      data.paid_at = new Date().toISOString();   // the server's clock, not the browser's
    } else if (prev.status === "paid") {
      const wantPaid = localDate(q.paidDate);
      data.paid_at = new Date(prev.paid_at).toISOString();
      if (wantPaid && wantPaid !== prevPaidDay) {
        if (!isMaster(a)) dateDenied("paid date");
        data.paid_at = noonISO(wantPaid);
        corrections.push(`Paid date ${prettyDay(prevPaidDay)} → ${prettyDay(wantPaid)}`);
      }
    } else {
      data.paid_at = null;
    }

    // Signatures: new ones, and date corrections to existing ones
    const existing = new Map((await c.query(
      "SELECT stage, signed_at FROM requisition_signatures WHERE requisition_id = $1", [q.id])).rows.map(r => [r.stage, r]));
    const sigDateFixes = [];
    for (const stage of ["auth1", "auth2", "chief"]) {
      const sg = q[stage];
      if (!sg) continue;
      const have = existing.get(stage);
      if (have) {
        const wantSig = localDate(sg.date), haveSig = localDate(have.signed_at);
        if (wantSig && wantSig !== haveSig) {
          if (!(isMaster(a) || (pending && canRecordPaper(a)))) dateDenied(`${STAGE_NAME[stage]} date`);
          sigDateFixes.push([stage, noonISO(wantSig)]);
          corrections.push(`${STAGE_NAME[stage]} date ${prettyDay(haveSig)} → ${prettyDay(wantSig)}`);
        }
        continue;
      }
      const decision = sg.decision === "rejected" ? "rejected" : "approved";
      if (sg.recorded && sg.name && sg.name !== a.name) {
        // A signature given on paper, entered by a master admin or accounting
        if (!canRecordPaper(a)) forbid("Only accounting or a master admin can record a paper signature.");
        const expected = { auth1: "pending_auth1", auth2: "pending_auth2", chief: "pending_chief" }[stage];
        if (prev.status !== expected) forbid("This requisition isn't waiting for that signature.");
        await c.query(
          `INSERT INTO requisition_signatures
             (requisition_id, stage, signer_id, signer_name, decision, note, signed_at, recorded_by, recorded_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [q.id, stage, await userIdByName(ctx, sg.name), sg.name, decision, str(sg.note),
           momentFrom(sg.date) ?? new Date().toISOString(), a.id, a.name]);
        await auditInTx(ctx, "Procurement", `Recorded paper signature (${STAGE_NAME[stage]})`,
          `${prev.title}: ${sg.name}, ${prettyDay(localDate(sg.date) || today())}`);
      } else {
        // A live signature is always recorded as the signed-in person, right now
        await checkCanSign(ctx, q.id, stage);
        await c.query(
          `INSERT INTO requisition_signatures (requisition_id, stage, signer_id, signer_name, decision, note, signature_image)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [q.id, stage, a.id, a.name, decision, str(sg.note), signatureImage(sg.signature)]);
      }
    }

    // Routing: who the current stage is sent to (others who may sign still can)
    const stageNow = STAGE_FOR_STATUS[data.status];
    const prevNext = prev.next_signer_id || null;
    let wantNext = isUuid(q.nextSignerId) ? q.nextSignerId : null;
    if (!stageNow) {
      data.next_signer_id = null;
    } else if (data.status !== prev.status) {
      if (wantNext === prevNext) wantNext = null;     // left over from the stage just signed
      data.next_signer_id = await validNextSigner(c, wantNext, stageNow, prev.division);
      if (data.next_signer_id) await noteRouted(ctx, data.next_signer_id, stageNow, prev.title);
    } else if (wantNext !== prevNext) {
      const mayRoute = isMaster(a) || a.role === "accounting" || prev.requested_by === a.id ||
        (await eligibleSigner(c, a.id, stageNow, prev.division));
      if (!mayRoute) forbid("You can't change who this requisition is sent to.");
      data.next_signer_id = await validNextSigner(c, wantNext, stageNow, prev.division);
      if (data.next_signer_id) await noteRouted(ctx, data.next_signer_id, stageNow, prev.title);
      else await auditInTx(ctx, "Procurement", "Cleared who it's sent to", prev.title);
    } else {
      data.next_signer_id = prevNext;
    }

    if (corrections.length) await setDateCorrection(c, true);
    if (masterEdit) await c.query("SELECT set_config('sgfd.master_edit', 'on', true)");
    for (const [stage, at] of sigDateFixes) {
      await c.query("UPDATE requisition_signatures SET signed_at = $3 WHERE requisition_id = $1 AND stage = $2", [q.id, stage, at]);
    }
    await syncChildren(c, "requisition_line_items", "requisition_id", q.id, q.lineItems || [], (li, i) => ({
      position: i, description: str(li.description), amount: num(li.amount),
      frequency: pick(li.frequency, FREQUENCIES, "one_time"),
    }));
    await syncAttachments(c, "requisition_attachments", "requisition_id", q.id, q.attachments);
    // Signatures go in before the status moves, as the database requires
    await upsert(c, "requisitions", { id: q.id }, data);
    if (data.status !== prev.status) {
      const what = `${prev.title}\n${prev.vendor_name} · ${usd(data.amount)} · ${prev.division}`;
      if (stageNow) {
        notify(ctx, data.next_signer_id ? [data.next_signer_id] : await stageSigners(c, stageNow, prev.division),
          `Requisition to sign: ${prev.title}`,
          `This requisition is ready for your ${STAGE_NAME[stageNow].toLowerCase()}:\n\n${what}\n\nOpen Procurement > Requisitions > Waiting for me to sign it.`);
      } else if (data.status === "approved") {
        notify(ctx, [prev.requested_by], `Requisition approved: ${prev.title}`, `Your requisition has final approval (${a.name}):\n\n${what}`);
        notify(ctx, await roleIds(c, ["accounting"]), `Ready to pay: ${prev.title}`,
          `This requisition has final approval and is ready to be paid:\n\n${what}\n\nOpen Procurement > Requisitions > Approved.`);
      } else if (data.status === "rejected") {
        notify(ctx, [prev.requested_by], `Requisition not approved: ${prev.title}`,
          `${a.name} didn't approve your requisition:\n\n${what}${data.rejected_reason ? `\n\nReason: ${data.rejected_reason}` : ""}`);
      } else if (data.status === "paid") {
        notify(ctx, [prev.requested_by], `Requisition paid: ${prev.title}`, `Your requisition was marked paid by ${a.name}:\n\n${what}`);
      }
    }
    if (masterEdit) await c.query("SELECT set_config('sgfd.master_edit', 'off', true)");
    if (corrections.length) {
      await setDateCorrection(c, false);
      await auditInTx(ctx, "Procurement", "Corrected dates", `${prev.title}: ${corrections.join("; ")}`);
    }
    if (changes.length) {
      await auditInTx(ctx, "Procurement", masterEdit ? `Edited ${prev.status} requisition` : "Edited requisition",
        `${prev.title}: ${changes.join("; ")}`);
    }
  },

  async remove(ctx, id) {
    const c = ctx.c, a = ctx.actor;
    const r = (await c.query(
      `SELECT r.*, r.req_date::text AS req_day, v.name AS vendor_name, d.name AS division
         FROM requisitions r JOIN vendors v ON v.id = r.vendor_id JOIN divisions d ON d.id = r.division_id
        WHERE r.id = $1`, [id])).rows[0];
    if (!r) return;
    const pending = r.status.startsWith("pending");
    if (pending) {
      if (!isMaster(a) && r.requested_by !== a.id) forbid("Only the requester or a master admin can delete a requisition.");
    } else if (!isMaster(a)) {
      forbid("This requisition is finalized. Only a master admin can delete it.");
    }
    // A snapshot of what's being removed goes in the audit log
    const sigs = (await c.query(
      "SELECT stage, signer_name, signed_at FROM requisition_signatures WHERE requisition_id = $1 ORDER BY signed_at", [id])).rows;
    const files = (await c.query("SELECT file_id FROM requisition_attachments WHERE requisition_id = $1", [id])).rows.map(x => x.file_id);
    const snapshot = [
      `${r.title} — ${r.vendor_name}, ${r.division}`,
      `$${Number(r.amount).toFixed(2)} (${r.frequency})`,
      `dated ${prettyDay(r.req_day)}`,
      `status ${r.status}`,
      r.invoice_number ? `invoice ${r.invoice_number}` : null,
      `requested by ${r.requested_by_name}`,
      ...sigs.map(sg => `${STAGE_NAME[sg.stage]}: ${sg.signer_name} ${prettyDay(localDate(sg.signed_at))}`),
      r.paid_at ? `paid ${prettyDay(localDate(r.paid_at))}` : null,
      files.length ? `${files.length} attachment(s)` : null,
    ].filter(Boolean).join("; ");
    // Later copies made with "Repeat" just lose their pointer back to this one
    await c.query("SELECT set_config('sgfd.master_edit', 'on', true)");
    await c.query("UPDATE requisitions SET repeated_from = NULL WHERE repeated_from = $1", [id]);
    if (pending) await c.query("SELECT set_config('sgfd.master_edit', 'off', true)");
    await c.query("DELETE FROM requisitions WHERE id = $1", [id]);
    await c.query("SELECT set_config('sgfd.master_edit', 'off', true)");
    // Remove the attached files too, unless something else uses them
    for (const f of files) await queueFileCleanup(c, f);
    await auditInTx(ctx, "Procurement", pending ? "Deleted requisition" : `Deleted ${r.status} requisition`, snapshot);
  },
};

// Remove a file's record (and later its bytes) once nothing links to it
async function queueFileCleanup(c, fileId) {
  const used = await c.query(
    `SELECT 1 FROM requisition_attachments WHERE file_id = $1
     UNION ALL SELECT 1 FROM reimbursement_attachments WHERE file_id = $1
     UNION ALL SELECT 1 FROM ticket_attachments WHERE file_id = $1
     UNION ALL SELECT 1 FROM quote_attachments WHERE file_id = $1
     UNION ALL SELECT 1 FROM contracts WHERE file_id = $1
     UNION ALL SELECT 1 FROM certifications WHERE file_id = $1
     UNION ALL SELECT 1 FROM gear_items WHERE file_id = $1 LIMIT 1`, [fileId]);
  if (!used.rowCount) markFileForDeletion(fileId);
}

// ---- Quotes ----------------------------------------------------------
const canDecideQuote = async (ctx, division) =>
  ["master", "fire_chief", "accounting"].includes(ctx.actor.role) ||
  (["approver1", "approver2"].includes(ctx.actor.role) && (await actorCovers(ctx, division)));

const quotes = {
  async read(c) {
    const r = await c.query(
      `SELECT q.*, q.quote_date::text AS quote_day, q.expires_on::text AS expires_day,
              v.name AS vendor, d.name AS division, u.full_name AS created_by_name
         FROM quotes q
         JOIN vendors v ON v.id = q.vendor_id
         JOIN divisions d ON d.id = q.division_id
         LEFT JOIN users u ON u.id = q.created_by
        ORDER BY q.quote_date DESC, q.created_at DESC`);
    const atts = await attachmentsByParent(c, "quote_attachments", "quote_id");
    const linked = groupBy((await c.query(
      "SELECT id, quote_id FROM requisitions WHERE quote_id IS NOT NULL ORDER BY req_date")).rows, "quote_id");
    return r.rows.map(x => ({
      id: x.id, vendor: x.vendor, vendorId: x.vendor_id, division: x.division, title: x.title,
      amount: Number(x.amount), quoteNumber: str(x.quote_number), quoteDate: x.quote_day,
      expiresOn: x.expires_day || "", notes: x.notes, status: x.status,
      decidedBy: x.decided_by_name || "", decidedAt: iso(x.decided_at), declineReason: x.decline_reason || "",
      createdBy: str(x.created_by_name), createdAt: iso(x.created_at),
      attachments: atts.get(x.id) || [],
      requisitionIds: (linked.get(x.id) || []).map(l => l.id),
    }));
  },
  async upsert(ctx, x) {
    const c = ctx.c, a = ctx.actor;
    const prev = (await c.query(
      `SELECT q.status, q.created_by, q.decided_at, q.decided_by, q.decided_by_name, d.name AS division
         FROM quotes q JOIN divisions d ON d.id = q.division_id WHERE q.id = $1`, [x.id])).rows[0];
    const status = pick(x.status, ["pending", "accepted", "declined"], "pending");
    const details = {
      vendor_id: await ensureVendor(ctx, x.vendorId, x.vendor),
      division_id: await divisionId(ctx, x.division),
      title: str(x.title).trim() || "(untitled)",
      amount: num(x.amount),
      quote_number: nz(x.quoteNumber),
      quote_date: localDate(x.quoteDate) || today(),
      expires_on: localDate(x.expiresOn),
      notes: str(x.notes),
    };
    if (!prev) {
      if (status !== "pending") forbid("New quotes start as pending.");
      if (!GLOBAL_ROLES.includes(a.role) && !(await actorCovers(ctx, x.division))) forbid("You can only add quotes for your own divisions.");
      await upsert(c, "quotes", { id: x.id }, { ...details, status: "pending" },
        { created_by: a.id, created_at: new Date().toISOString() });
      await syncAttachments(c, "quote_attachments", "quote_id", x.id, x.attachments);
      return;
    }
    let decided = { decided_by: prev.decided_by, decided_by_name: prev.decided_by_name, decided_at: prev.decided_at ? iso(prev.decided_at) : null };
    if (status !== prev.status) {
      if (!(await canDecideQuote(ctx, prev.division))) forbid("You don't have permission to accept or decline quotes.");
      decided = status === "pending"
        ? { decided_by: null, decided_by_name: null, decided_at: null }
        : { decided_by: a.id, decided_by_name: a.name, decided_at: new Date().toISOString() };
    }
    // Details can be edited by whoever added it, or a master admin
    const before = (await c.query(
      `SELECT q.title, q.amount, q.quote_number, q.quote_date::text AS qd, q.expires_on::text AS ed, q.notes,
              v.name AS vendor, d.name AS division
         FROM quotes q JOIN vendors v ON v.id = q.vendor_id JOIN divisions d ON d.id = q.division_id WHERE q.id = $1`, [x.id])).rows[0];
    const qchanges = [];
    const qcmp = (label, b, n) => { if (String(b ?? "") !== String(n ?? "")) qchanges.push(`${label}: "${b ?? ""}" → "${n ?? ""}"`); };
    qcmp("Title", before.title, details.title);
    if (Number(before.amount) !== details.amount) qchanges.push(`Cost: $${Number(before.amount).toFixed(2)} → $${details.amount.toFixed(2)}`);
    qcmp("Quote #", before.quote_number, details.quote_number);
    qcmp("Quote date", before.qd, details.quote_date);
    qcmp("Good until", before.ed, details.expires_on);
    qcmp("Notes", before.notes, details.notes);
    qcmp("Division", before.division, x.division);
    if (str(x.vendor).trim().toLowerCase() !== before.vendor.trim().toLowerCase()) qcmp("Vendor", before.vendor, str(x.vendor).trim());
    const mayEdit = isMaster(a) || prev.created_by === a.id;
    if (qchanges.length && !mayEdit) forbid("Only the person who added this quote or a master admin can edit it.");
    const data = qchanges.length ? { ...details } : {};
    if (qchanges.length) await auditInTx(ctx, "Procurement", "Edited quote", `${before.title}: ${qchanges.join("; ")}`);
    await upsert(c, "quotes", { id: x.id }, {
      ...data, status, ...decided,
      decline_reason: status === "declined" ? nz(x.declineReason) : null,
    });
    await syncAttachments(c, "quote_attachments", "quote_id", x.id, x.attachments);
  },
  async remove(ctx, id) {
    const c = ctx.c;
    const r = (await c.query(
      `SELECT q.*, v.name AS vendor_name FROM quotes q JOIN vendors v ON v.id = q.vendor_id WHERE q.id = $1`, [id])).rows[0];
    if (!r) return;
    if (!isMaster(ctx.actor) && !(r.created_by === ctx.actor.id && r.status === "pending")) {
      forbid("Only the person who added a pending quote, or a master admin, can delete it.");
    }
    const linked = (await c.query("SELECT count(*)::int AS n FROM requisitions WHERE quote_id = $1", [id])).rows[0].n;
    if (linked) forbid(`This quote has ${linked} requisition${linked === 1 ? "" : "s"} made from it. Delete ${linked === 1 ? "that requisition" : "those"} first.`);
    const files = (await c.query("SELECT file_id FROM quote_attachments WHERE quote_id = $1", [id])).rows.map(x => x.file_id);
    await c.query("DELETE FROM quotes WHERE id = $1", [id]);
    for (const f of files) await queueFileCleanup(c, f);
    await auditInTx(ctx, "Procurement", "Deleted quote",
      `${r.title} — ${r.vendor_name}, $${Number(r.amount).toFixed(2)}, ${r.status}${r.quote_number ? `, #${r.quote_number}` : ""}`);
  },
};

const contracts = {
  async read(c) {
    const r = await c.query(
      `SELECT ct.*, v.name AS vendor_name, d.name AS division, up.full_name AS uploader_name,
              f.id AS file_id, f.original_name, f.size_bytes, f.mime_type, f.uploaded_at AS file_uploaded_at,
              fu.full_name AS uploader
         FROM contracts ct
         JOIN files f ON f.id = ct.file_id
         LEFT JOIN users fu ON fu.id = f.uploaded_by
         LEFT JOIN vendors v ON v.id = ct.vendor_id
         LEFT JOIN divisions d ON d.id = ct.division_id
         LEFT JOIN users up ON up.id = ct.uploaded_by
        ORDER BY ct.uploaded_at DESC`);
    return r.rows.map(x => ({
      id: x.id, title: x.title, vendorId: x.vendor_id, vendorName: str(x.vendor_name),
      division: str(x.division), notes: x.notes,
      file: fileMetaFromRow({ ...x, uploaded_at: x.file_uploaded_at }),
      uploadedBy: str(x.uploader_name), uploadedAt: iso(x.uploaded_at),
    }));
  },
  async upsert(ctx, x) {
    if (!x.file || !isUuid(x.file.id)) throw new HttpError(409, "The contract file is missing");
    await updateFileMeta(ctx.c, x.file);
    await upsert(ctx.c, "contracts", { id: x.id }, {
      title: str(x.title).trim() || "(untitled)",
      vendor_id: isUuid(x.vendorId) ? x.vendorId : null,
      division_id: x.division ? await divisionId(ctx, x.division) : null,
      notes: str(x.notes),
      file_id: x.file.id,
    }, {
      uploaded_by: ctx.actor.id,
      uploaded_at: new Date().toISOString(),
    });
  },
  async remove(ctx, id) {
    const r = (await ctx.c.query("SELECT uploaded_by FROM contracts WHERE id = $1", [id])).rows[0];
    if (r && !isMaster(ctx.actor) && r.uploaded_by !== ctx.actor.id) forbid("Only the person who uploaded a contract or a master admin can remove it.");
    await ctx.c.query("DELETE FROM contracts WHERE id = $1", [id]);
  },
};

// Certifications and gear share the same shape on disk
function personRecords(table, toData, fromRow) {
  return {
    async read(c) {
      const r = await c.query(
        `SELECT x.*, u.full_name AS person_name, d.name AS division, ab.full_name AS added_by_name,
                f.id AS file_id, f.original_name, f.size_bytes, f.mime_type, f.uploaded_at, fu.full_name AS uploader
           FROM ${table} x
           JOIN users u ON u.id = x.user_id
           JOIN divisions d ON d.id = u.division_id
           LEFT JOIN users ab ON ab.id = x.added_by
           LEFT JOIN files f ON f.id = x.file_id
           LEFT JOIN users fu ON fu.id = f.uploaded_by
          ORDER BY x.added_at DESC`);
      return r.rows.map(x => ({
        id: x.id, personId: x.user_id, personName: x.person_name, division: x.division,
        ...fromRow(x),
        file: x.file_id ? fileMetaFromRow(x) : null,
        addedBy: str(x.added_by_name), addedAt: iso(x.added_at),
      }));
    },
    async upsert(ctx, x) {
      if (!isUuid(x.personId)) throw new HttpError(409, "Choose a person");
      if (x.file) await updateFileMeta(ctx.c, x.file);
      await upsert(ctx.c, table, { id: x.id }, {
        user_id: x.personId,
        ...toData(x),
        file_id: x.file && isUuid(x.file.id) ? x.file.id : null,
      }, {
        added_by: ctx.actor.id,
        added_at: new Date().toISOString(),
      });
    },
    async remove(ctx, id) {
      const r = (await ctx.c.query(`SELECT added_by FROM ${table} WHERE id = $1`, [id])).rows[0];
      if (r && !isMaster(ctx.actor) && r.added_by !== ctx.actor.id) forbid("Only the person who added this or a master admin can remove it.");
      await ctx.c.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    },
  };
}

const certifications = personRecords(
  "certifications",
  x => ({
    cert_name: str(x.certName).trim(), issuing_org: str(x.issuingOrg),
    completion_date: x.completionDate, expiration_date: nz(x.expirationDate),
  }),
  x => ({
    certName: x.cert_name, issuingOrg: x.issuing_org,
    completionDate: x.completion_date, expirationDate: x.expiration_date || "",
  }));

const gear = personRecords(
  "gear_items",
  x => ({
    gear_type: x.gearType, item_name: str(x.itemName).trim(), serial_number: str(x.serialNumber),
    issued_date: x.completionDate, expiration_date: nz(x.expirationDate),
  }),
  x => ({
    gearType: x.gear_type, itemName: x.item_name, serialNumber: x.serial_number,
    completionDate: x.issued_date, expirationDate: x.expiration_date || "",
  }));

// Reimbursements: master admins, the Fire Chief and accounting see all; approvers see their divisions; everyone sees their own
const reimbursements = {
  async read(c, actor) {
    const scope = actor && ["approver1", "approver2"].includes(actor.role) ? await reqScope(c, actor) : null;
    const all = !actor || GLOBAL_ROLES.includes(actor.role);
    const r = await c.query(
      `SELECT r.*, u.full_name AS requester_name, d.name AS division
         FROM reimbursements r
         JOIN users u ON u.id = r.requester_id
         JOIN divisions d ON d.id = r.division_id
        ORDER BY r.created_at DESC`);
    if (!all) r.rows = r.rows.filter(x => x.requester_id === actor.id || (scope && scope.has(x.division)));
    const lines = groupBy((await c.query("SELECT * FROM reimbursement_line_items ORDER BY position")).rows, "reimbursement_id");
    const atts = await attachmentsByParent(c, "reimbursement_attachments", "reimbursement_id");
    return r.rows.map(x => ({
      id: x.id, type: x.type, requesterId: x.requester_id, requesterName: x.requester_name, division: x.division,
      staffId: str(x.staff_id), position: str(x.position), supervisor: str(x.supervisor), reason: x.reason,
      payPeriodFrom: x.period_from || "", payPeriodTo: x.period_to || "", advances: Number(x.advances),
      lineItems: (lines.get(x.id) || []).map(li => x.type === "travel"
        ? { id: li.id, date: li.item_date || "", description: li.description, lodging: Number(li.lodging),
            miles: Number(li.miles), mealsPerDiem: Number(li.meals), parking: Number(li.parking), other: Number(li.other) }
        : { id: li.id, date: li.item_date || "", description: li.description, qty: Number(li.qty), unitPrice: Number(li.unit_price) }),
      status: x.status,
      approval: ["approved", "paid"].includes(x.status) && x.decided_at
        ? { name: x.decided_by_name, date: iso(x.decided_at), decision: "approved" } : null,
      rejectedReason: x.rejected_reason, paidDate: iso(x.paid_at),
      attachments: atts.get(x.id) || [], createdAt: iso(x.created_at),
    }));
  },
  async upsert(ctx, x) {
    const c = ctx.c;
    const prev = (await c.query(
      `SELECT r.status, r.decided_at, r.decided_by, r.decided_by_name, r.paid_at, r.requester_id, r.reason, d.name AS division
         FROM reimbursements r JOIN divisions d ON d.id = r.division_id WHERE r.id = $1`, [x.id])).rows[0];
    // Someone else's request: only approvers / accounting moving its status (no other changes)
    if (prev && prev.requester_id !== ctx.actor.id && !isMaster(ctx.actor)) {
      const mayDecide = ["fire_chief", "approver1", "approver2", "accounting"].includes(ctx.actor.role);
      if (!mayDecide) forbid("You can only change your own reimbursement requests.");
    }
    const status = pick(x.status, ["pending_approval", "approved", "rejected", "paid"], "pending_approval");
    const a = ctx.actor;

    // Approvals, rejections and payments are recorded as the signed-in person, now
    let decided = prev
      ? { id: prev.decided_by, name: prev.decided_by_name, at: iso(prev.decided_at) }
      : { id: null, name: null, at: null };
    let paidAt = prev ? iso(prev.paid_at) : null;
    if (prev && status !== prev.status) {
      if (prev.status === "pending_approval" && ["approved", "rejected"].includes(status)) {
        const ok = ["master", "fire_chief"].includes(a.role) ||
          (["approver1", "approver2"].includes(a.role) && (await actorCovers(ctx, prev.division)));
        if (!ok) forbid("You don't have permission to approve this request.");
        decided = { id: a.id, name: a.name, at: new Date().toISOString() };
      } else if (prev.status === "approved" && status === "paid") {
        if (!["master", "accounting"].includes(a.role)) forbid("Only accounting or a master admin can mark this paid.");
        paidAt = new Date().toISOString();
      }
    }

    const data = {
      type: x.type === "non_travel" ? "non_travel" : "travel",
      division_id: await divisionId(ctx, x.division),
      staff_id: nz(x.staffId), position: nz(x.position), supervisor: nz(x.supervisor),
      reason: str(x.reason).trim() || "(no reason given)",
      period_from: nz(x.payPeriodFrom), period_to: nz(x.payPeriodTo),
      advances: num(x.advances), status,
      decided_by: decided.id, decided_by_name: decided.name, decided_at: decided.at,
      rejected_reason: nz(x.rejectedReason), paid_at: paidAt,
    };
    const children = async () => {
      await syncChildren(c, "reimbursement_line_items", "reimbursement_id", x.id, x.lineItems || [], (li, i) => ({
        position: i, item_date: nz(li.date), description: str(li.description),
        lodging: num(li.lodging), miles: num(li.miles), meals: num(li.mealsPerDiem),
        parking: num(li.parking), other: num(li.other), qty: num(li.qty), unit_price: num(li.unitPrice),
      }));
      await syncAttachments(c, "reimbursement_attachments", "reimbursement_id", x.id, x.attachments);
    };

    if (!prev) {
      if (status !== "pending_approval") forbid("New requests start as awaiting approval.");
      if (!GLOBAL_ROLES.includes(a.role) && x.division !== a.division) {
        forbid("You can only submit requests for your own division.");
      }
      const rate = await mileageRate.read(c);
      await upsert(c, "reimbursements", { id: x.id }, data, {
        requester_id: a.id,                  // always the signed-in person
        mileage_rate: rate ?? 0.7,           // locked in at submission
        created_at: new Date().toISOString(),
      });
      await children();
      const approvers = [];
      for (const u of await activeUsers(c, "u.role::text IN ('approver1', 'approver2')")) if (await covers(c, u.id, u.division, x.division)) approvers.push(u.id);
      notify(ctx, approvers.length ? approvers : await roleIds(c, ["fire_chief"]), `Reimbursement to approve: ${data.reason}`,
        `${a.name} submitted a ${data.type === "travel" ? "travel" : "non-travel"} reimbursement request for approval (${x.division}):\n\n${data.reason}\n\nOpen Reimbursements > Awaiting approval.`);
    } else {
      await children();
      await upsert(c, "reimbursements", { id: x.id }, data);
      if (status !== prev.status) {
        if (status === "approved") {
          notify(ctx, [prev.requester_id], `Reimbursement approved: ${prev.reason}`, `Your reimbursement request was approved by ${a.name}:\n\n${prev.reason}`);
          notify(ctx, await roleIds(c, ["accounting"]), `Reimbursement ready to pay: ${prev.reason}`,
            `This reimbursement request is approved and ready to be paid:\n\n${prev.reason}\n\nOpen Reimbursements > Approved.`);
        } else if (status === "rejected") {
          notify(ctx, [prev.requester_id], `Reimbursement not approved: ${prev.reason}`,
            `${a.name} didn't approve your reimbursement request:\n\n${prev.reason}${data.rejected_reason ? `\n\nReason: ${data.rejected_reason}` : ""}`);
        } else if (status === "paid") {
          notify(ctx, [prev.requester_id], `Reimbursement paid: ${prev.reason}`, `Your reimbursement request was marked paid by ${a.name}:\n\n${prev.reason}`);
        }
      }
    }
  },
  async remove(ctx, id) {
    const r = (await ctx.c.query("SELECT requester_id, status, reason FROM reimbursements WHERE id = $1", [id])).rows[0];
    if (!r) return;
    if (!isMaster(ctx.actor) && !(r.requester_id === ctx.actor.id && r.status === "pending_approval")) {
      forbid("Only the person who asked (while it's awaiting approval) or a master admin can delete a reimbursement request.");
    }
    await ctx.c.query("DELETE FROM reimbursements WHERE id = $1", [id]);
    await auditInTx(ctx, "Reimbursements", "Deleted request", r.reason);
  },
};

// Tickets on two desks. Help Desk: techs (Technology, master admins, Help Desk: Edit) work every ticket; Gear: master admins and
// Gear tickets: Edit. View sees them all. Only the desk's team works a ticket (status updates, assignee, due date). The person
// who opens it may "send it to" groups and/or people: they're notified and can see and follow it (watchers), along with the
// desk's team. Everyone else sees and comments on their own.
async function helpdeskLevel(c, actor) {
  if (!actor) return "none";
  if (isMaster(actor) || actor.division === "Technology") return "edit";
  const { hasAccess } = await import("./access.js");
  if (await hasAccess(c, actor, "helpdesk", "edit")) return "edit";
  if (await hasAccess(c, actor, "helpdesk", "view")) return "view";
  return "none";
}
async function deskLevel(c, actor, desk) {
  if (desk !== "gear") return helpdeskLevel(c, actor);
  if (!actor) return "none";
  if (isMaster(actor)) return "edit";
  const { hasAccess } = await import("./access.js");
  if (await hasAccess(c, actor, "gear", "edit")) return "edit";
  if (await hasAccess(c, actor, "gear", "view")) return "view";
  return "none";
}
async function helpdeskTechs(c) {
  const { hasAccess } = await import("./access.js");
  const out = [];
  for (const u of await activeUsers(c, "u.role <> 'master'")) {
    if (u.division === "Technology" || (await hasAccess(c, u, "helpdesk", "edit"))) out.push(u.id);
  }
  return out;
}
// Who gets a ticket nobody was picked for
async function deskTeam(c, desk) {
  if (desk !== "gear") return helpdeskTechs(c);
  const { hasAccess } = await import("./access.js");
  const out = [];
  for (const u of await activeUsers(c, "u.role <> 'master'")) if (await hasAccess(c, u, "gear", "edit")) out.push(u.id);
  return out.length ? out : (await activeUsers(c, "u.role = 'master'")).map(u => u.id);
}
// "Send to": groups and/or people -> [{kind, id, name}] and the people it reaches
async function resolveSentTo(c, list) {
  const { groupMembers } = await import("./access.js");
  const sentTo = [], ids = new Set();
  for (const x of (Array.isArray(list) ? list : []).slice(0, 40)) {
    if (!x || !isUuid(x.id)) continue;
    if (x.kind === "group") {
      const g = await groupMembers(c, x.id);
      if (!g) continue;
      sentTo.push({ kind: "group", id: x.id, name: g.name });
      for (const id of g.ids) ids.add(id);
    } else {
      const u = (await c.query("SELECT id, full_name FROM users WHERE id = $1 AND active AND account_status = 'approved'", [x.id])).rows[0];
      if (!u) continue;
      sentTo.push({ kind: "user", id: u.id, name: u.full_name });
      ids.add(u.id);
    }
  }
  return { sentTo, ids: [...ids] };
}
// For the New ticket form: groups anyone may send a ticket to
export async function ticketRouting() {
  return tx(async c => {
    const { allGroupMembers } = await import("./access.js");
    return { groups: (await allGroupMembers(c)).map(g => ({ id: g.id, name: g.name, count: g.ids.length })).sort((a, b) => a.name.localeCompare(b.name)) };
  });
}
export const TICKET_STATUS_NAME = { open: "Open", acknowledged: "Acknowledged", in_progress: "Being worked on", on_hold: "On hold",
  awaiting_delivery: "Awaiting delivery", resolved: "Resolved", closed: "Closed" };
const tickets = {
  async read(c, actor) {
    const levels = { helpdesk: await deskLevel(c, actor, "helpdesk"), gear: await deskLevel(c, actor, "gear") };
    const r = await c.query(
      `SELECT t.*, d.name AS division, a.full_name AS assignee_name
         FROM tickets t
         JOIN divisions d ON d.id = t.division_id
         LEFT JOIN users a ON a.id = t.assignee_id
        ORDER BY t.created_at DESC`);
    const watchers = new Map();
    for (const h of (await c.query("SELECT ticket_id, user_id FROM ticket_watchers")).rows) {
      if (!watchers.has(h.ticket_id)) watchers.set(h.ticket_id, []);
      watchers.get(h.ticket_id).push(h.user_id);
    }
    r.rows = r.rows.filter(t => levels[t.desk] !== "none" || t.requester_id === actor.id || (watchers.get(t.id) || []).includes(actor.id));
    const comments = groupBy((await c.query("SELECT * FROM ticket_comments ORDER BY created_at")).rows, "ticket_id");
    const updates = groupBy((await c.query("SELECT * FROM ticket_updates ORDER BY created_at")).rows, "ticket_id");
    const atts = await attachmentsByParent(c, "ticket_attachments", "ticket_id");
    return r.rows.map(t => {
      const ws = watchers.get(t.id) || [];
      const o = {
        id: t.id, desk: t.desk, subject: t.subject, category: t.category, priority: t.priority, division: t.division,
        location: t.location, description: t.description,
        requesterId: t.requester_id, requesterName: t.requester_name,
        assigneeId: t.assignee_id, assigneeName: t.assignee_name || null,
        status: t.status, dueDate: t.due_date || "",
        sentTo: Array.isArray(t.sent_to) ? t.sent_to : [], watching: ws.includes(actor.id),
        canWork: levels[t.desk] === "edit",
        updates: (updates.get(t.id) || []).map(u => ({ id: u.id, status: u.status, note: u.note, author: u.author_name, createdAt: iso(u.created_at) })),
        comments: (comments.get(t.id) || []).map(cm => ({
          id: cm.id, author: cm.author_name, body: cm.body, createdAt: iso(cm.created_at),
        })),
        attachments: atts.get(t.id) || [],
        createdAt: iso(t.created_at), updatedAt: iso(t.updated_at),
      };
      if (t.spiceworks_id) o.spiceworksId = t.spiceworks_id;
      if (t.resolved_at) o.resolvedAt = iso(t.resolved_at);
      if (t.closed_at) o.closedAt = iso(t.closed_at);
      return o;
    });
  },
  async upsert(ctx, t) {
    const c = ctx.c, a = ctx.actor;
    const prev = (await c.query(
      `SELECT t.*, d.name AS division FROM tickets t JOIN divisions d ON d.id = t.division_id WHERE t.id = $1`, [t.id])).rows[0];
    const desk = prev ? prev.desk : (t.desk === "gear" ? "gear" : "helpdesk");
    const deskName = DESKS[desk].name;
    const tech = (await deskLevel(c, a, desk)) === "edit";
    const watcherIds = prev ? (await c.query("SELECT user_id FROM ticket_watchers WHERE ticket_id = $1", [t.id])).rows.map(r => r.user_id) : [];
    const worker = tech;
    if (prev && !worker) {
      const watcher = watcherIds.includes(a.id);
      if (prev.requester_id !== a.id && !watcher) forbid(`Only ${desk === "gear" ? "the people who handle gear tickets" : "the Help Desk"} can change someone else's ticket.`);
      // People it was sent to may add comments and files only
      const own = prev.status === "open" && prev.requester_id === a.id;
      t = { ...t, assigneeId: prev.assignee_id, status: prev.status, dueDate: prev.due_date || "",
        resolvedAt: prev.resolved_at, closedAt: prev.closed_at, priority: own ? t.priority : prev.priority,
        subject: own ? t.subject : prev.subject, category: own ? t.category : prev.category, location: own ? t.location : prev.location,
        description: own ? t.description : prev.description, division: own ? t.division : prev.division,
        requesterId: prev.requester_id, requesterName: prev.requester_name };
    }
    if (!prev && !(tech && t.spiceworksId)) {
      // A new ticket starts open; only the desk's team assigns it or sets a due date
      t = { ...t, requesterId: a.id, requesterName: a.name, status: "open", resolvedAt: null, closedAt: null, ...(tech ? {} : { assigneeId: null, dueDate: "" }) };
    }
    // Comments: existing ones stay as they are; new ones are by whoever is signed in (imports keep their authors)
    const haveComments = prev ? new Map((await c.query("SELECT * FROM ticket_comments WHERE ticket_id = $1", [t.id])).rows.map(r => [r.id, r])) : new Map();
    const newComments = (t.comments || []).filter(cm => !haveComments.has(String(cm.id)));
    if (prev) {
      const keep = tech ? (t.comments || []).filter(cm => haveComments.has(String(cm.id))) : [...haveComments.values()].map(r => ({ id: r.id, author: r.author_name, body: r.body, createdAt: iso(r.created_at) }));
      t = { ...t, comments: [...keep, ...newComments.map(cm => ({ ...cm, author: a.name, createdAt: new Date().toISOString() }))] };
    }
    const cats = desk === "gear" ? GEAR_TICKET_CATEGORIES : TICKET_CATEGORIES;
    const data = {
      subject: str(t.subject).trim() || "(no subject)",
      category: pick(t.category, cats, "Other"),
      priority: pick(t.priority, TICKET_PRIORITIES, "Medium"),
      division_id: await divisionId(ctx, t.division),
      location: str(t.location), description: str(t.description),
      requester_id: isUuid(t.requesterId) ? t.requesterId : null,
      requester_name: str(t.requesterName) || "Unknown",
      assignee_id: isUuid(t.assigneeId) ? t.assigneeId : null,
      status: pick(t.status, TICKET_STATUSES, "open"),
      due_date: nz(t.dueDate), resolved_at: nz(t.resolvedAt), closed_at: nz(t.closedAt),
    };
    if (data.status === "resolved" && !data.resolved_at) data.resolved_at = new Date().toISOString();
    if (data.status === "closed" && !data.closed_at) data.closed_at = new Date().toISOString();
    // Status updates: only people working the ticket post them; each status change gets one even if no note was written
    const haveUpdates = prev ? new Set((await c.query("SELECT id FROM ticket_updates WHERE ticket_id = $1", [t.id])).rows.map(r => r.id)) : new Set();
    let newUpdates = worker && prev ? (t.updates || []).filter(u => u && !haveUpdates.has(String(u.id)))
      .map(u => ({ status: pick(u.status, TICKET_STATUSES, data.status), note: str(u.note).trim().slice(0, 2000) })) : [];
    if (prev && worker && data.status !== prev.status && !newUpdates.some(u => u.status === data.status)) newUpdates.push({ status: data.status, note: "" });
    const children = async () => {
      await syncChildren(c, "ticket_comments", "ticket_id", t.id, t.comments || [], async cm => ({
        author_id: await userIdByName(ctx, cm.author), author_name: str(cm.author) || "Unknown",
        body: str(cm.body), created_at: nz(cm.createdAt) ?? new Date().toISOString(),
      }));
      await syncAttachments(c, "ticket_attachments", "ticket_id", t.id, t.attachments);
      for (const u of newUpdates) await c.query("INSERT INTO ticket_updates (ticket_id, status, note, author_id, author_name) VALUES ($1, $2, $3, $4, $5)",
        [t.id, u.status, u.note, a.id, a.name]);
    };

    if (!prev) {
      const routed = t.spiceworksId ? { sentTo: [], ids: [] } : await resolveSentTo(c, t.sentTo);
      await upsert(c, "tickets", { id: t.id }, data, {
        desk, sent_to: JSON.stringify(routed.sentTo),
        spiceworks_id: t.spiceworksId ? String(t.spiceworksId) : null,
        created_at: nz(t.createdAt) ?? new Date().toISOString(),
        updated_at: nz(t.updatedAt) ?? nz(t.createdAt) ?? new Date().toISOString(),
      });
      for (const uid of routed.ids) await c.query("INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [t.id, uid]);
      if (data.status === "closed") await setImporting(c, true);
      await children();
      if (data.status === "closed") await setImporting(c, false);
      if (!t.spiceworksId) {
        // The desk's team always hears about a new ticket; the people it was sent to too. Assigning stays with the team.
        const to = [...new Set([...(data.assignee_id ? [data.assignee_id] : await deskTeam(c, desk)), ...routed.ids])];
        const sentWords = routed.sentTo.length ? `\nSent to: ${routed.sentTo.map(x => x.name).join(", ")}` : "";
        notify(ctx, to, `New ${desk === "gear" ? "gear" : "Help Desk"} ticket: ${data.subject}`,
          `${data.requester_name} opened a ${data.priority.toLowerCase()} priority ticket (${data.category}, ${t.division}${data.location ? `, ${data.location}` : ""}):${sentWords}\n\n` +
          `${data.subject}\n\n${data.description.slice(0, 1500)}\n\nOpen ${desk === "gear" ? "PPE & Gear > Gear tickets" : "Help Desk"} to take it.`);
      }
    } else if (prev.status === "closed" && data.status !== "closed") {
      await upsert(c, "tickets", { id: t.id }, data);   // reopen first, then add updates
      await children();
    } else {
      await children();
      await upsert(c, "tickets", { id: t.id }, data);
    }
    if (prev) {
      const title = `"${data.subject}"`;
      const where = desk === "gear" ? "PPE & Gear > Gear tickets" : "Help Desk";
      if (data.assignee_id && data.assignee_id !== prev.assignee_id) {
        notify(ctx, [data.assignee_id], `Ticket assigned to you: ${data.subject}`,
          `${a.name} assigned you the ${deskName} ticket ${title} from ${data.requester_name} (${data.priority} priority).\n\nOpen ${where}.`);
      }
      const notes = [];
      for (const u of newUpdates) notes.push(`Status: ${TICKET_STATUS_NAME[u.status]}${u.note ? `\n${u.note}` : ""}`);
      for (const cm of newComments) notes.push(`${a.name} wrote: ${str(cm.body).slice(0, 1500)}`);
      if (notes.length) {
        const team = prev.assignee_id ? [prev.assignee_id] : await deskTeam(c, desk);
        if (!worker) {
          if (newComments.length) notify(ctx, [...team, ...watcherIds, ...(a.id !== prev.requester_id ? [prev.requester_id] : [])], `Ticket update: ${data.subject}`,
            `${notes.join("\n\n")}\n\nOpen ${where} to see the ticket.`);
        } else {
          notify(ctx, [prev.requester_id], `Your ${desk === "gear" ? "gear" : "Help Desk"} ticket: ${data.subject}`, `Update on your ticket ${title} from ${a.name}:\n\n${notes.join("\n\n")}\n\nOpen ${where} to see it.`);
          notify(ctx, watcherIds.filter(id => id !== prev.requester_id), `Ticket update: ${data.subject}`,
            `Update on the ${deskName} ticket ${title} from ${data.requester_name}, sent to you:\n\n${notes.join("\n\n")}\n\nOpen ${where} to see it.`);
          if (newComments.length && prev.assignee_id && prev.assignee_id !== a.id) notify(ctx, [prev.assignee_id], `Ticket update: ${data.subject}`, `${notes.join("\n\n")}`);
        }
      }
    }
  },
  async remove(ctx, id) {
    const t = (await ctx.c.query("SELECT subject, requester_id, status, desk FROM tickets WHERE id = $1", [id])).rows[0];
    if (!t) return;
    const tech = (await deskLevel(ctx.c, ctx.actor, t.desk)) === "edit";
    if (!tech && !(t.requester_id === ctx.actor.id && t.status === "open")) forbid(`Only ${t.desk === "gear" ? "gear ticket workers" : "the Help Desk"} (or you, while your ticket is still open) can delete a ticket.`);
    await ctx.c.query("DELETE FROM tickets WHERE id = $1", [id]);
    await auditInTx(ctx, DESKS[t.desk]?.name || "Help Desk", "Deleted ticket", t.subject);
  },
};

const meetings = {
  async read(c) {
    const r = await c.query(
      `SELECT m.*, o.full_name AS organizer_name,
              to_char(m.starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS local_date,
              to_char(m.starts_at AT TIME ZONE $1, 'HH24:MI')    AS local_time
         FROM meetings m JOIN users o ON o.id = m.organizer_id
        ORDER BY m.starts_at`, [TIMEZONE]);
    const inv = groupBy((await c.query(
      `SELECT mi.*, u.full_name FROM meeting_invitees mi JOIN users u ON u.id = mi.user_id
        ORDER BY u.full_name`)).rows, "meeting_id");
    return r.rows.map(m => ({
      id: m.id, subject: m.subject, organizerId: m.organizer_id, organizerName: m.organizer_name,
      date: m.local_date, time: m.local_time, duration: m.duration_minutes,
      location: m.location, agenda: m.agenda,
      responses: (inv.get(m.id) || []).map(i => ({
        inviteeId: i.user_id, inviteeName: i.full_name, status: i.status,
        respondedAt: iso(i.responded_at), note: i.note,
      })),
      cancelled: m.cancelled, createdAt: iso(m.created_at),
    }));
  },
  async upsert(ctx, m) {
    const c = ctx.c;
    const ts = await c.query("SELECT (($1::date + $2::time) AT TIME ZONE $3) AS ts", [m.date, m.time || "00:00", TIMEZONE]);
    await upsert(c, "meetings", { id: m.id }, {
      subject: str(m.subject).trim() || "(no subject)",
      starts_at: iso(ts.rows[0].ts),
      duration_minutes: parseInt(m.duration, 10) || 30,
      location: str(m.location), agenda: str(m.agenda), cancelled: !!m.cancelled,
    }, {
      organizer_id: ctx.actor.id,
      created_at: nz(m.createdAt) ?? new Date().toISOString(),
    });
    const responses = (m.responses || []).filter(x => isUuid(x.inviteeId));
    const existing = await c.query("SELECT user_id FROM meeting_invitees WHERE meeting_id = $1", [m.id]);
    const want = new Set(responses.map(x => x.inviteeId));
    for (const row of existing.rows) {
      if (!want.has(row.user_id)) {
        await c.query("DELETE FROM meeting_invitees WHERE meeting_id = $1 AND user_id = $2", [m.id, row.user_id]);
      }
    }
    for (const x of responses) {
      await upsert(c, "meeting_invitees", { meeting_id: m.id, user_id: x.inviteeId }, {
        status: pick(x.status, ["pending", "accepted", "declined"], "pending"),
        responded_at: nz(x.respondedAt), note: str(x.note),
      });
    }
  },
  async remove(ctx, id) { await ctx.c.query("DELETE FROM meetings WHERE id = $1", [id]); },
};

const announcements = {
  async read(c) {
    const r = await c.query(
      `SELECT a.*, u.full_name, u.role FROM announcements a JOIN users u ON u.id = a.author_id
        ORDER BY a.created_at DESC`);
    return r.rows.map(a => ({
      id: a.id, title: a.title, body: a.body, priority: a.priority, pinned: a.pinned,
      author: a.full_name, authorRole: ROLE_LABEL[a.role] || a.role, createdAt: iso(a.created_at),
    }));
  },
  async upsert(ctx, a) {
    const prev = (await ctx.c.query("SELECT author_id FROM announcements WHERE id = $1", [a.id])).rows[0];
    const canPost = ["master", "fire_chief"].includes(ctx.actor.role);
    if (!prev && !canPost) forbid("Only fire chiefs and master admins can post announcements.");
    if (prev && !canPost && prev.author_id !== ctx.actor.id) return;
    const authorId = ctx.actor.id;
    await upsert(ctx.c, "announcements", { id: a.id }, {
      title: str(a.title).trim() || "(untitled)", body: str(a.body),
      priority: pick(a.priority, ANNOUNCEMENT_PRIORITIES, "Normal"), pinned: !!a.pinned,
    }, {
      author_id: authorId,
      created_at: nz(a.createdAt) ?? new Date().toISOString(),
    });
  },
  async remove(ctx, id) {
    const r = (await ctx.c.query("SELECT author_id FROM announcements WHERE id = $1", [id])).rows[0];
    if (r && !["master", "fire_chief"].includes(ctx.actor.role) && r.author_id !== ctx.actor.id) forbid("You can't remove that announcement.");
    await ctx.c.query("DELETE FROM announcements WHERE id = $1", [id]);
  },
};

// Append-only: new entries are inserted; edits and deletes are ignored
const auditLog = {
  async read(c, actor) {
    if (!isMaster(actor)) {
      // Others only ever load the log to append to it; give them nothing to read
      return [];
    }
    const r = await c.query("SELECT * FROM audit_log ORDER BY id DESC LIMIT 2000");
    return r.rows.map(e => ({
      id: String(e.id), timestamp: iso(e.occurred_at), actor: e.actor_name, role: e.actor_role,
      module: e.module, action: e.action, detail: e.detail,
    }));
  },
  async upsert(ctx, e) {
    if (/^\d+$/.test(String(e.id))) return;   // already stored
    await ctx.c.query(
      `INSERT INTO audit_log (actor_id, actor_name, actor_role, module, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ctx.actor.id, ctx.actor.name, ROLE_LABEL[ctx.actor.role] || ctx.actor.role,
       str(e.module) || "—", str(e.action) || "—", str(e.detail)]);
  },
  async remove() { /* never */ },
};

// ---------------------------------------------------------------------
// Time punches: private to the person, master admins, and anyone granted
// "view time punches" for the person's division. Only the person edits them.
// ---------------------------------------------------------------------
const TIME_KINDS = ["regular", "vacation", "comp", "sick", "swap"];
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function punchHours(start, end) {
  const [h1, m1] = start.split(":").map(Number), [h2, m2] = end.split(":").map(Number);
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (mins <= 0) mins += 24 * 60;          // ends the next day (equal times = a 24-hour shift)
  return Math.round(mins / 60 * 100) / 100;
}

const timeEntries = {
  async read(c, actor) {
    let where = "WHERE t.user_id = $1", params = [actor.id];
    if (isMaster(actor)) { where = ""; params = []; }
    else {
      const scope = await permissionScope(c, actor.id, "time_view");
      if (scope.all) { where = ""; params = []; }
      else if (scope.divisions.size) {
        where = "WHERE t.user_id = $1 OR d.name = ANY(string_to_array($2, '|'))";
        params = [actor.id, [...scope.divisions].join("|")];
      }
    }
    const r = await c.query(
      `SELECT t.*, t.work_date::text AS day, to_char(t.start_time, 'HH24:MI') AS st, to_char(t.end_time, 'HH24:MI') AS et,
              u.full_name, d.name AS division
         FROM time_entries t JOIN users u ON u.id = t.user_id JOIN divisions d ON d.id = u.division_id
         ${where}
        ORDER BY t.work_date, t.start_time NULLS LAST, t.created_at`, params);
    return r.rows.map(t => ({
      id: t.id, userId: t.user_id, userName: t.full_name, division: t.division,
      date: t.day, start: t.st || "", end: t.et || "", hours: Number(t.hours), kind: t.kind, note: t.note,
    }));
  },
  async upsert(ctx, x) {
    const c = ctx.c, a = ctx.actor;
    if (!isUuid(x.id)) throw new HttpError(400, "Bad entry id");
    const prev = (await c.query("SELECT user_id FROM time_entries WHERE id = $1", [x.id])).rows[0];
    if (prev && prev.user_id !== a.id) forbid("You can only change your own time punches.");
    if (!DAY.test(str(x.date))) throw new HttpError(400, "Choose the date.");
    const start = str(x.start), end = str(x.end);
    let hours;
    if (start || end) {
      if (!HHMM.test(start) || !HHMM.test(end)) throw new HttpError(400, "Enter times as 24-hour HH:MM, like 07:00 or 17:30.");
      hours = punchHours(start, end);
    } else {
      hours = Math.round(Number(x.hours) * 100) / 100;
      if (!(hours > 0 && hours <= 48)) throw new HttpError(400, "Enter the in and out times, or the number of hours.");
    }
    await upsert(c, "time_entries", { id: x.id }, {
      work_date: x.date, start_time: start || null, end_time: end || null, hours,
      kind: pick(x.kind, TIME_KINDS, "regular"), note: str(x.note).slice(0, 500), updated_at: new Date().toISOString(),
    }, { user_id: a.id, created_at: new Date().toISOString() });
  },
  async remove(ctx, id) {
    const r = await ctx.c.query("SELECT user_id FROM time_entries WHERE id = $1", [id]);
    if (!r.rowCount) return;
    if (r.rows[0].user_id !== ctx.actor.id) forbid("You can only delete your own time punches.");
    await ctx.c.query("DELETE FROM time_entries WHERE id = $1", [id]);
  },
};

// ---------------------------------------------------------------------
// Call-out schedule: everyone can see it. A division's schedule is edited by
// people in that division, anyone granted "edit call-out schedule" for it,
// and master admins.
// ---------------------------------------------------------------------
async function canEditCallout(ctx, division) {
  const a = ctx.actor;
  if (isMaster(a) || a.division === division) return true;
  const scope = await permissionScope(ctx.c, a.id, "callout_edit");
  return scope.all || scope.divisions.has(division);
}

const callouts = {
  async read(c) {
    const r = await c.query(
      `SELECT e.*, e.start_date::text AS sd, e.end_date::text AS ed, d.name AS division, cb.full_name AS created_by_name
         FROM callout_entries e JOIN divisions d ON d.id = e.division_id
         LEFT JOIN users cb ON cb.id = e.created_by
        ORDER BY e.start_date, d.name, e.position`);
    return r.rows.map(e => ({
      id: e.id, division: e.division, startDate: e.sd, endDate: e.ed, position: e.position,
      userId: e.user_id, personName: e.person_name, phone: e.phone, notes: e.notes,
      createdBy: e.created_by_name || "",
    }));
  },
  async upsert(ctx, x) {
    const c = ctx.c;
    if (!isUuid(x.id)) throw new HttpError(400, "Bad entry id");
    const prev = (await c.query(
      `SELECT e.*, e.start_date::text AS sd, e.end_date::text AS ed, d.name AS division
         FROM callout_entries e JOIN divisions d ON d.id = e.division_id WHERE e.id = $1`, [x.id])).rows[0];
    if (prev && !(await canEditCallout(ctx, prev.division))) forbid(`You can't change ${prev.division}'s call-out schedule.`);
    if (!(await canEditCallout(ctx, x.division))) forbid(`You can't change ${x.division}'s call-out schedule.`);
    if (!DAY.test(str(x.startDate)) || !DAY.test(str(x.endDate))) throw new HttpError(400, "Choose the dates.");
    if (x.endDate < x.startDate) throw new HttpError(400, "The end date is before the start date.");
    const user = isUuid(x.userId) ? (await c.query("SELECT id, full_name FROM users WHERE id = $1", [x.userId])).rows[0] : null;
    const name = user ? user.full_name : str(x.personName).trim();
    if (!name) throw new HttpError(400, "Choose who is on call.");
    const data = {
      division_id: await divisionId(ctx, x.division), start_date: x.startDate, end_date: x.endDate,
      position: Math.min(99, Math.max(1, parseInt(x.position, 10) || 1)),
      user_id: user ? user.id : null, person_name: name, phone: str(x.phone).slice(0, 60), notes: str(x.notes).slice(0, 500),
    };
    const result = await upsert(c, "callout_entries", { id: x.id }, data, { created_by: ctx.actor.id, created_at: new Date().toISOString() });
    if (result !== "same") {
      const when = x.startDate === x.endDate ? prettyDay(x.startDate) : `${prettyDay(x.startDate)} – ${prettyDay(x.endDate)}`;
      await auditInTx(ctx, "Call-Out Schedule", result === "inserted" ? "Added to call-out schedule" : "Changed call-out schedule",
        `${x.division}: ${name}${data.position > 1 ? ` (#${data.position})` : ""}, ${when}`);
    }
  },
  async remove(ctx, id) {
    const e = (await ctx.c.query(
      `SELECT e.person_name, e.start_date::text AS sd, d.name AS division
         FROM callout_entries e JOIN divisions d ON d.id = e.division_id WHERE e.id = $1`, [id])).rows[0];
    if (!e) return;
    if (!(await canEditCallout(ctx, e.division))) forbid(`You can't change ${e.division}'s call-out schedule.`);
    await ctx.c.query("DELETE FROM callout_entries WHERE id = $1", [id]);
    await auditInTx(ctx, "Call-Out Schedule", "Removed from call-out schedule", `${e.division}: ${e.person_name}, ${prettyDay(e.sd)}`);
  },
};

export const COLLECTIONS = {
  roster, divisions, categories, "mileage-rate": mileageRate, vendors, requisitions, contracts,
  certifications, gear, reimbursements, tickets, meetings, announcements, "audit-log": auditLog, quotes,
  "time-entries": timeEntries, callouts,
};

// ---------------------------------------------------------------------
// Entry points used by the HTTP server
// ---------------------------------------------------------------------

// Personnel File: the requisitions and reimbursements a person asked for. They see their own; master admins,
// the Fire Chief and accounting see anyone's.
export async function purchasesFor(actor, userId) {
  const id = isUuid(userId) ? userId : actor.id;
  if (id !== actor.id && !GLOBAL_ROLES.includes(actor.role)) throw new HttpError(403, "Only master admins, the Fire Chief and accounting can see other people's requisitions here.");
  return tx(async c => {
    const mine = new Set((await c.query("SELECT id FROM requisitions WHERE requested_by = $1", [id])).rows.map(r => r.id));
    const reqs = (await requisitions.read(c, { ...actor, role: "master" })).filter(r => mine.has(r.id));
    const reimb = (await reimbursements.read(c, { ...actor, role: "master" })).filter(r => r.requesterId === id);
    const rate = await mileageRate.read(c);
    return { requisitions: reqs, reimbursements: reimb, mileageRate: rate ?? 0.7 };
  });
}

export async function readCollection(key, actor) {
  const def = COLLECTIONS[key];
  if (!def) throw new HttpError(404, `Unknown collection "${key}"`);
  return tx(c => def.read(c, actor));
}

export async function saveCollection(key, body, actor) {
  const def = COLLECTIONS[key];
  if (!def) throw new HttpError(404, `Unknown collection "${key}"`);
  const after = [];          // messages to send once the save has committed
  await tx(async c => {
    const ctx = { c, actor, cache: new Map(), after };
    if (def.saveValue) {
      await def.saveValue(ctx, body.value);
      return;
    }
    for (const item of body.upserts || []) {
      if (!item || item.id === undefined || item.id === null) continue;
      await def.upsert(ctx, item);
    }
    for (const id of body.deletes || []) {
      if (isUuid(id)) await def.remove(ctx, id);
    }
  });
  await flushPendingFileDeletes();
  for (const f of after) await f();
}

// Turn database errors into messages a person can act on
export function friendlyError(err) {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  switch (err.code) {
    case "23503": return { status: 409, message: "That record is still in use elsewhere, so it can't be removed or changed that way." };
    case "23505": return { status: 409, message: "A record with that name already exists." };
    case "23514": return { status: 409, message: `Some required information is missing or invalid (${err.constraint || "check"}).` };
    case "22P02": return { status: 400, message: "Some information wasn't in the expected format." };
    case "P0001": return { status: 409, message: err.message };
    default:      return { status: 500, message: "Something went wrong saving to the database. Details are in the server window." };
  }
}
