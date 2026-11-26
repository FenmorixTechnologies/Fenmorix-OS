// Plain words instead of the browser's "Failed to fetch". When a request to this app's own /api can't get through, find out why:
//   - the device is offline -> "No internet connection"
//   - a sign-in in front of the app (Cloudflare Access, a company proxy) has ended: the server answers with a redirect to another
//     site, which the browser refuses for a background request -> banner "Your secure sign-in has ended" + Reload
//   - the server is restarting or down -> "Can't reach the server"
// The error each screen shows (toasts) gets that message too. Loaded once from main.jsx.
const ORIGINAL = window.fetch.bind(window);
let banner = null, checking = null;

function showBanner(text) {
  if (banner) { banner.querySelector("span").textContent = text; return; }
  banner = document.createElement("div");
  banner.setAttribute("role", "alert");
  banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#B42318;color:#fff;font:600 15px/1.35 system-ui,sans-serif;" +
    "padding:12px 16px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.25)";
  const span = document.createElement("span"); span.textContent = text;
  const b = document.createElement("button"); b.type = "button"; b.textContent = "Reload and sign in";
  b.style.cssText = "background:#fff;color:#B42318;border:0;border-radius:6px;padding:7px 14px;font:700 14px system-ui,sans-serif;cursor:pointer";
  b.onclick = () => window.location.reload();
  banner.append(span, b);
  document.body.appendChild(banner);
}
const hideBanner = () => { banner?.remove(); banner = null; };

async function diagnose() {
  if (navigator.onLine === false) return { kind: "offline", message: "No internet connection. Check the connection, then try again." };
  try {
    const r = await ORIGINAL("/api/health", { redirect: "manual", cache: "no-store", credentials: "same-origin" });
    if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400))
      return { kind: "signin", message: "Your secure sign-in has ended (it times out after a while). Reload the page to sign in again; then repeat what you were doing." };
    if (r.ok) return { kind: "blip", message: "The connection dropped for a moment. Try again." };
    return { kind: "down", message: "The server isn't answering right now (it may be restarting). Wait a minute and try again." };
  } catch {
    return { kind: "down", message: "Can't reach the server right now (it may be restarting, or the connection dropped). Wait a minute and try again." };
  }
}

window.fetch = async function guardedFetch(input, init) {
  try {
    const r = await ORIGINAL(input, init);
    if (banner && r.ok) hideBanner();
    return r;
  } catch (e) {
    const url = typeof input === "string" ? input : input?.url || "";
    const own = url.startsWith("/") || url.startsWith(window.location.origin);
    if (e?.name === "AbortError" || !own) throw e;
    const d = await (checking || (checking = diagnose().finally(() => setTimeout(() => { checking = null; }, 3000))));
    if (d.kind === "signin" || d.kind === "offline") showBanner(d.message);
    const err = new TypeError(d.message); err.cause = e; err.netKind = d.kind;
    throw err;
  }
};
window.addEventListener("online", () => { if (banner && /internet/.test(banner.textContent)) hideBanner(); });
