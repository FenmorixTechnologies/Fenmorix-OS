// Postgres connection pool.
// Connection settings come from the standard PG* variables in .env
// (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD).
import pg from "pg";

// Return numbers as JS numbers and calendar dates as plain "YYYY-MM-DD"
// strings, which is what the app's screens expect.
pg.types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // numeric
pg.types.setTypeParser(1082, v => v);                                     // date

export const pool = new pg.Pool({ max: 10 });
// An idle connection that Postgres closes (a restart, an update of PostgreSQL, a restore) must not take the whole app down:
// without this listener pg-pool's "error" event is unhandled and Node exits. The pool drops that connection and opens a new one.
if (typeof pool.on === "function") pool.on("error", e => console.warn(`[db] an idle database connection was closed (${e.code || e.message}); a new one will be opened.`));

// Run fn(client) inside one transaction; roll back on any error.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
