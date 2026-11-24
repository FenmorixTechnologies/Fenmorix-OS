// System audit log (/api/audit): every section's audit entries in one place, with filters, paging and CSV.
// Master admins, and anyone given "Audit log: View" (User Management > Permissions).
import { pool } from "./db.js";
import { brand, brandText, brandDeep } from "./brand.js";
import { hasAccess } from "./access.js";

const err = (status, message) => Object.assign(new Error(message), { status });
const isDay = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

const TZ = /^[A-Za-z_]+\/[A-Za-z_]+$/.test(process.env.APP_TIMEZONE || "") ? process.env.APP_TIMEZONE : "America/Chicago";
function where(p) {
  const w = [], v = [];
  const add = (sql, val) => { v.push(val); w.push(sql.replace("?", `$${v.length}`)); };
  if (isDay(p.get("from"))) add(`occurred_at >= ((?::date)::timestamp AT TIME ZONE '${TZ}')`, p.get("from"));
  if (isDay(p.get("to"))) add(`occurred_at < ((?::date + 1)::timestamp AT TIME ZONE '${TZ}')`, p.get("to"));
  if (txt(p.get("module"), 80)) add("module = ?", txt(p.get("module"), 80));
  if (txt(p.get("actor"), 120)) add("actor_name = ?", txt(p.get("actor"), 120));
  const q = txt(p.get("q"), 200);
  if (q) add("(action ILIKE ? OR detail ILIKE $X OR actor_name ILIKE $X OR module ILIKE $X)".replace(/\$X/g, `$${v.length + 1}`), `%${q.replace(/[%_\\]/g, m => "\\" + m)}%`);
  return { sql: w.length ? `WHERE ${w.join(" AND ")}` : "", v };
}

export async function handleAudit(req, res, parts, user, send, url) {
  if (req.method !== "GET") throw err(404, "Not found");
  if (!(await hasAccess(pool, user, "audit", "view"))) throw err(403, "The system audit log needs the Audit log: View permission.");
  const p = url.searchParams;
  if (parts[2] === "meta") {
    const modules = (await pool.query("SELECT module, count(*)::int AS n FROM audit_log GROUP BY 1 ORDER BY 1")).rows;
    const people = (await pool.query("SELECT actor_name AS name, count(*)::int AS n FROM audit_log GROUP BY 1 ORDER BY 1")).rows;
    const range = (await pool.query("SELECT min(occurred_at) AS first, max(occurred_at) AS last, count(*)::int AS n FROM audit_log")).rows[0];
    return send(res, 200, { modules, people, ...range });
  }
  const w = where(p);
  if (parts[2] === "export.csv") {
    const rows = (await pool.query(`SELECT id, occurred_at, actor_name, actor_role, module, action, detail FROM audit_log ${w.sql} ORDER BY id DESC LIMIT 100000`, w.v)).rows;
    const q = s => { s = String(s ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["When", "Person", "Role", "Section", "Action", "Detail"].join(",")]
      .concat(rows.map(r => [new Date(r.occurred_at).toLocaleString("en-US", { timeZone: TZ }), r.actor_name, r.actor_role, r.module, r.action, r.detail].map(q).join(",")));
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="${brand().app.replace(/[^A-Za-z0-9]+/g, "-")}-audit-log.csv"` });
    return res.end("﻿" + lines.join("\r\n") + "\r\n");
  }
  const size = Math.min(500, Math.max(10, Number(p.get("size")) || 50));
  const page = Math.max(1, Number(p.get("page")) || 1);
  const total = (await pool.query(`SELECT count(*)::int AS n FROM audit_log ${w.sql}`, w.v)).rows[0].n;
  const rows = (await pool.query(`SELECT id, occurred_at, actor_name, actor_role, module, action, detail FROM audit_log ${w.sql}
    ORDER BY id DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, w.v)).rows;
  return send(res, 200, { total, page, size, rows: rows.map(r => ({ id: String(r.id), at: r.occurred_at, actor: r.actor_name, role: r.actor_role, module: r.module, action: r.action, detail: r.detail })) });
}
