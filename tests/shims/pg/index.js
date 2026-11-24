// TEST-ONLY minimal Postgres client mimicking the parts of `pg` the app uses.
import net from "node:net";

const parsers = new Map();
const tz = s => new Date(s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
const defaults = {
  16: v => v === "t", 20: v => v, 21: v => parseInt(v, 10), 23: v => parseInt(v, 10), 26: v => parseInt(v, 10),
  700: parseFloat, 701: parseFloat, 1700: v => v, 1082: v => new Date(v + "T00:00:00"),
  1114: v => new Date(v.replace(" ", "T")), 1184: tz, 114: JSON.parse, 3802: JSON.parse, 17: v => Buffer.from(v.replace(/^\\x/, ""), "hex"), 17: v => Buffer.from(v.replace(/^\\x/, ""), "hex"),
};
const types = {
  setTypeParser(oid, fn) { parsers.set(oid, fn); },
  getTypeParser(oid) { return parsers.get(oid) || defaults[oid] || (v => v); },
};

function prepare(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Buffer.isBuffer(v)) return "\\x" + v.toString("hex");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

class Client {
  constructor() { this.buf = Buffer.alloc(0); this.waiters = []; this.chain = Promise.resolve(); }
  connect() {
    const host = process.env.PGHOST, port = process.env.PGPORT || 5432;
    this.sock = host && host.startsWith("/") ? net.connect(`${host}/.s.PGSQL.${port}`) : net.connect(port, host || "127.0.0.1");
    this.sock.on("data", d => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
    return new Promise((resolve, reject) => {
      this.sock.once("error", reject);
      this.sock.once("connect", async () => {
        const params = `user\0${process.env.PGUSER}\0database\0${process.env.PGDATABASE}\0\0`;
        const body = Buffer.concat([int32(196608), Buffer.from(params)]);
        this.sock.write(Buffer.concat([int32(body.length + 4), body]));
        try { await this.until("Z"); resolve(this); } catch (e) { reject(e); }
      });
    });
  }
  pump() {
    while (this.buf.length >= 5) {
      const len = this.buf.readInt32BE(1);
      if (this.buf.length < len + 1) return;
      const msg = { type: String.fromCharCode(this.buf[0]), body: this.buf.subarray(5, len + 1) };
      this.buf = this.buf.subarray(len + 1);
      const w = this.waiters.shift(); if (w) w(msg); else (this.pending = this.pending || []).push(msg);
    }
  }
  next() {
    if (this.pending && this.pending.length) return Promise.resolve(this.pending.shift());
    return new Promise(r => this.waiters.push(r));
  }
  async until(type) {
    const msgs = [];
    for (;;) { const m = await this.next(); msgs.push(m); if (m.type === type) return msgs; }
  }
  query(text, params = []) {
    const run = this.chain.then(() => this._query(text, params));
    this.chain = run.catch(() => {});
    return run;
  }
  async _query(text, params) {
    if (!params.length) {   // like real pg: no parameters -> simple protocol (allows multiple statements)
      this.sock.write(msg("Q", cstr(text)));
      return this.collect();
    }
    const p = params.map(prepare);
    const parse = msg("P", Buffer.concat([cstr(""), cstr(text), int16(0)]));
    const bindParts = [cstr(""), cstr(""), int16(0), int16(p.length)];
    for (const v of p) {
      if (v === null) bindParts.push(int32(-1));
      else { const b = Buffer.from(v); bindParts.push(int32(b.length), b); }
    }
    bindParts.push(int16(0));
    this.sock.write(Buffer.concat([parse, msg("B", Buffer.concat(bindParts)), msg("D", Buffer.concat([Buffer.from("P"), cstr("")])),
      msg("E", Buffer.concat([cstr(""), int32(0)])), msg("S", Buffer.alloc(0))]));
    return this.collect();
  }
  async collect() {
    const msgs = await this.until("Z");
    let fields = [], rows = [], rowCount = 0, error = null;
    for (const m of msgs) {
      if (m.type === "E") error = parseError(m.body);
      if (m.type === "T") fields = parseFields(m.body);
      if (m.type === "D") rows.push(parseRow(m.body, fields));
      if (m.type === "C") { const tag = m.body.toString().replace(/\0$/, ""); const n = parseInt(tag.split(" ").pop(), 10); rowCount = isNaN(n) ? 0 : n; }
    }
    if (error) throw error;
    return { rows, rowCount, fields };
  }
  release() { this.sock.end(); }
  end() { this.sock.end(); }
}

function parseError(body) {
  const e = new Error("db error"); let i = 0;
  while (i < body.length && body[i] !== 0) {
    const code = String.fromCharCode(body[i]); const end = body.indexOf(0, i + 1);
    const val = body.subarray(i + 1, end).toString(); i = end + 1;
    if (code === "M") e.message = val; if (code === "C") e.code = val; if (code === "n") e.constraint = val;
  }
  return e;
}
function parseFields(b) {
  const n = b.readInt16BE(0); let i = 2; const out = [];
  for (let k = 0; k < n; k++) { const end = b.indexOf(0, i); const name = b.subarray(i, end).toString(); i = end + 1;
    const oid = b.readInt32BE(i + 6); i += 18; out.push({ name, oid }); }
  return out;
}
function parseRow(b, fields) {
  const n = b.readInt16BE(0); let i = 2; const row = {};
  for (let k = 0; k < n; k++) { const len = b.readInt32BE(i); i += 4;
    if (len === -1) { row[fields[k].name] = null; continue; }
    const v = b.subarray(i, i + len).toString(); i += len; row[fields[k].name] = types.getTypeParser(fields[k].oid)(v); }
  return row;
}
const int32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const int16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const cstr = s => Buffer.from(s + "\0");
const msg = (t, body) => Buffer.concat([Buffer.from(t), int32(body.length + 4), body]);

class Pool {
  async connect() { return new Client().connect(); }
  async query(text, params) { const c = await this.connect(); try { return await c.query(text, params); } finally { c.release(); } }
}
export default { Pool, Client, types };
