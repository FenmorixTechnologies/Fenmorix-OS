// Outgoing email (password reset links) through the district's own mail server, with no extra packages.
// .env:
//   SMTP_HOST=smtp.office365.com        the mail server (Microsoft 365, Google Workspace, or an internal relay)
//   SMTP_PORT=587                       587 = STARTTLS (default), 465 = TLS from the start (set SMTP_SECURE=true), 25 = relay
//   SMTP_SECURE=false
//   SMTP_USER=nexus@stgeorgefire.com    sign-in for the mail server (leave blank for a relay that doesn't need one)
//   SMTP_PASS=…
//   SMTP_FROM=SGFD Nexus <nexus@stgeorgefire.com>
//   SMTP_TLS_CHECK=true                 check the mail server's certificate (only turn off for an internal relay with its own)
// Not configured = mailConfigured() false: the sign-in page says to ask an admin instead.
import net from "node:net";
import tls from "node:tls";
import os from "node:os";
import crypto from "node:crypto";

function config() {
  const e = process.env;
  const port = Number(e.SMTP_PORT || 587);
  return { host: String(e.SMTP_HOST || "").trim(), port, secure: String(e.SMTP_SECURE || (port === 465 ? "true" : "false")).toLowerCase() === "true",
    user: e.SMTP_USER || "", pass: e.SMTP_PASS || "", from: e.SMTP_FROM || e.SMTP_USER || "",
    rejectUnauthorized: String(e.SMTP_TLS_CHECK || "true").toLowerCase() !== "false" };
}
export const mailConfigured = () => { const c = config(); return !!(c.host && /@/.test(c.from)); };
const addrOf = s => (/<([^<>\s]+@[^<>\s]+)>/.exec(s) || [null, String(s).trim()])[1];
const clean = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;

// One SMTP conversation: replies are read line by line ("250-…" continues, "250 …" ends)
function session(socket) {
  let buf = "", waiting = null, sock = socket;
  const lines = [];
  const feed = d => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\r\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 2); } flush(); };
  const flush = () => {
    if (!waiting) return;
    const end = lines.findIndex(l => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end < 0) return;
    const reply = lines.splice(0, end + 1);
    const w = waiting; waiting = null;
    w({ code: Number(reply[reply.length - 1].slice(0, 3)), text: reply.map(l => l.slice(4)).join("\n") });
  };
  const attach = s => { sock = s; s.on("data", feed); };
  attach(socket);
  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The mail server stopped answering.")), 20_000);
    waiting = r => { clearTimeout(t); resolve(r); };
    sock.once("error", e => { clearTimeout(t); reject(e); });
    flush();
  });
  // `label` names what was sent when the line itself is secret (the user name / password during AUTH LOGIN): never put those in errors or logs
  const cmd = async (line, ok, label) => {
    sock.write(`${line}\r\n`);
    const r = await read();
    if (ok && !ok.includes(r.code)) throw new Error(`Mail server said ${r.code} to ${label || line.split(" ")[0]}: ${r.text.slice(0, 160)}`);
    return r;
  };
  return { read, cmd, get socket() { return sock; }, upgrade(s) { sock.removeAllListeners("data"); attach(s); } };
}

export async function sendMail({ to, subject, text }) {
  const c = config();
  if (!mailConfigured()) throw new Error("Email isn't set up (SMTP_HOST / SMTP_FROM in .env).");
  const toAddr = addrOf(clean(to)), fromAddr = addrOf(clean(c.from));
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(toAddr)) throw new Error("Bad recipient address.");
  const raw = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: c.rejectUnauthorized })
    : net.connect({ host: c.host, port: c.port });
  raw.setTimeout(30_000, () => raw.destroy(new Error("The mail server timed out.")));
  await new Promise((res, rej) => { raw.once(c.secure ? "secureConnect" : "connect", res); raw.once("error", rej); });
  const s = session(raw);
  try {
    let r = await s.read();
    if (r.code !== 220) throw new Error(`Mail server greeting: ${r.code}`);
    const me = clean(os.hostname()) || "sgfd-nexus";
    r = await s.cmd(`EHLO ${me}`, [250]);
    if (!c.secure && /STARTTLS/i.test(r.text)) {
      await s.cmd("STARTTLS", [220]);
      const secured = tls.connect({ socket: s.socket, servername: c.host, rejectUnauthorized: c.rejectUnauthorized });
      await new Promise((res, rej) => { secured.once("secureConnect", res); secured.once("error", rej); });
      s.upgrade(secured);
      r = await s.cmd(`EHLO ${me}`, [250]);
    } else if (!c.secure && c.user) throw new Error("The mail server doesn't offer encryption (STARTTLS); not sending a password over it.");
    if (c.user) {
      await s.cmd("AUTH LOGIN", [334]);
      await s.cmd(Buffer.from(c.user).toString("base64"), [334], "the user name");
      await s.cmd(Buffer.from(c.pass).toString("base64"), [235], "the password");
    }
    await s.cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    await s.cmd(`RCPT TO:<${toAddr}>`, [250, 251]);
    await s.cmd("DATA", [354]);
    const body = Buffer.from(String(text).replace(/\r?\n/g, "\r\n")).toString("base64").replace(/.{1,76}/g, "$&\r\n");
    const msg = [
      `From: ${clean(c.from)}`, `To: <${toAddr}>`, `Subject: ${encHeader(clean(subject))}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
      `Message-ID: <${crypto.randomUUID()}@${fromAddr.split("@")[1]}>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64", "Auto-Submitted: auto-generated", "", body,
    ].join("\r\n");
    s.socket.write(msg.replace(/\r\n\./g, "\r\n.."));
    await s.cmd("\r\n.", [250]);
    await s.cmd("QUIT").catch(() => {});
  } finally { s.socket.destroy(); }
}
