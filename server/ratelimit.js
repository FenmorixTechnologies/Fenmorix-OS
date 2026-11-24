// Simple in-memory rate limits per key (an IP address, an email). Fixed windows; the map is trimmed so it can't grow
// without bound. Used on the routes anyone can reach without signing in.
const buckets = new Map();
// Requests from the server itself (tests, scripts on the box) aren't limited unless RATE_LIMIT_LOOPBACK=on. If Nexus is
// ever put behind a reverse proxy on the same computer, set RATE_LIMIT_LOOPBACK=on (every request would look local).
const LOOP = /:(127\.0\.0\.1|::1)$/;
export function allow(key, max, windowMs) {
  if (LOOP.test(key) && process.env.RATE_LIMIT_LOOPBACK !== "on") return true;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
  b.n += 1;
  if (buckets.size > 20000) for (const [k, v] of buckets) { if (now - v.start > 3600_000) buckets.delete(k); if (buckets.size <= 10000) break; }
  return b.n <= max;
}
export const ipOf = req => String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
