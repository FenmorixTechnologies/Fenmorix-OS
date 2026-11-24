// The visitor's address. Behind Cloudflare (a Cloudflare Tunnel on this computer, or Cloudflare's proxy in front of the server) every
// request reaches Nexus from cloudflared (127.0.0.1) or a Cloudflare address, so with TRUST_PROXY=cloudflare the real address comes
// from the CF-Connecting-IP header, but only when the request really came through Cloudflare (or the local tunnel): anyone else
// can't fake it. Sign-in limits, sessions and the audit log use this.
import net from "node:net";

const CF = new net.BlockList();
for (const c of ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20",
  "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"])
  CF.addSubnet(c.split("/")[0], Number(c.split("/")[1]), "ipv4");
for (const c of ["2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"])
  CF.addSubnet(c.split("/")[0], Number(c.split("/")[1]), "ipv6");

const peerOf = req => String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
const loopback = a => a === "127.0.0.1" || a === "::1";
const fromCloudflare = a => { try { return CF.check(a, net.isIPv6(a) ? "ipv6" : "ipv4"); } catch { return false; } };
export const trustCloudflare = () => String(process.env.TRUST_PROXY || "").toLowerCase() === "cloudflare";

export function clientIp(req) {
  const peer = peerOf(req);
  if (trustCloudflare() && (loopback(peer) || fromCloudflare(peer))) {
    const h = String(req.headers["cf-connecting-ip"] || "").trim();
    if (net.isIP(h)) return h;
  }
  return peer;
}
// "On the server itself": the first-run setup page. A request passed along by a proxy or tunnel never counts, whatever the settings.
export function isLocalRequest(req) {
  const h = req.headers || {};
  return loopback(peerOf(req)) && !h["cf-connecting-ip"] && !h["cf-ray"] && !h["x-forwarded-for"] && !h["x-real-ip"];
}
