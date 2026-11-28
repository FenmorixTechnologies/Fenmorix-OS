// Serves worker.js locally (node tools/serve.mjs [port]) so the site can be checked in a browser before deploying.
import http from "node:http";
const w = (await import(new URL("../worker.js", import.meta.url))).default;
const port = Number(process.argv[2] || 8787);
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const host = req.headers["x-host"] || "fenmorix.com", proto = req.headers["x-proto"] || "https";
  const r = await w.fetch(new Request(`${proto}://${host}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), {});
  const h = Object.fromEntries(r.headers); delete h["content-security-policy"]; // the CSP pins https://fenmorix.com; locally it would block nothing important
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log("listening " + port));
