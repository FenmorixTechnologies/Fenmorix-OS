// Applies database changes in db/migrations/ automatically at startup,
// each in its own transaction, and records them in schema_migrations.
import fs from "node:fs/promises";
import path from "node:path";
import { pool, tx } from "./db.js";

const DIR = path.resolve(import.meta.dirname, "..", "db", "migrations");

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);

  // A database set up by hand from schema.sql already has the first migration
  const applied = new Set((await pool.query("SELECT version FROM schema_migrations")).rows.map(r => r.version));
  if (!applied.size) {
    const hasTables = await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS yes");
    if (hasTables.rows[0].yes) {
      await pool.query("INSERT INTO schema_migrations (version) VALUES ('001_initial')");
      applied.add("001_initial");
    }
  }

  const files = (await fs.readdir(DIR)).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await fs.readFile(path.join(DIR, file), "utf8");
    await tx(async c => {
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
    console.log(`Database updated: ${version}`);
  }
}
