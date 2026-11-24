// Push notifications on this device (phone, tablet or computer). See server/push.js.
// iPhone / iPad: only works after Nexus is added to the Home Screen (iOS 16.4 or newer) and
// opened from there.
import { PN } from "./brand.js";
const post = async (path, body) => {
  const r = await fetch(`/api/push/${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-SGFD": "1" }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
};
const get = async path => {
  const r = await fetch(`/api/push/${path}`, { credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work.");
  return j;
};

export const isApple = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export const isInstalled = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined" && window.isSecureContext;

// Why push can't be turned on here, in plain words (or "" when it can)
export function pushBlocker() {
  if (typeof window === "undefined") return "unsupported";
  if (isApple() && !isInstalled()) return "apple-install";
  if (!window.isSecureContext) return "insecure";
  if (!pushSupported()) return "unsupported";
  return "";
}

const b64ToBytes = s => { const p = (s + "===".slice((s.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p), c => c.charCodeAt(0)); };
const remember = on => { try { on ? localStorage.setItem("sgfd-push-on", "1") : localStorage.removeItem("sgfd-push-on"); } catch (e) { /* private window */ } };
export const pushOnHere = () => { try { return localStorage.getItem("sgfd-push-on") === "1"; } catch (e) { return false; } };

export async function registration() {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register("/sw.js", { scope: "/" }); } catch (e) { return null; }
}
export async function currentSubscription() {
  const reg = await registration();
  if (!reg) return null;
  try { return await reg.pushManager.getSubscription(); } catch (e) { return null; }
}

// "Registration failed - push service error" = the browser couldn't reach its own push service (Google's for Chrome/Edge/Brave,
// Mozilla's for Firefox). It's often a one-time hiccup or a leftover registration, so clear it and try once more; if it still
// fails, say what usually causes it.
const isBrave = async () => { try { return !!(navigator.brave && await navigator.brave.isBrave()); } catch (e) { return false; } };
async function subscribeWithRetry(reg, key) {
  const once = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try { return await once(); } catch (first) {
    try { const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe(); } catch (e) { /* none */ }
    await new Promise(r => setTimeout(r, 1500));
    try { return await once(); } catch (e) {
      if (!/push service|Registration failed|AbortError/i.test(`${e.name} ${e.message}`)) throw e;
      if (await isBrave()) throw new Error("Brave turns push off by default. Open brave://settings/privacy, turn on \"Use Google services for push messaging\", restart Brave, and try again.");
      throw new Error("This browser couldn't reach its push service (" + (e.message || "push service error") + "). Try again in a minute; if it keeps failing, the network may be blocking it (some work firewalls and VPNs do), or try Chrome, Edge or Firefox. On a phone, try with Wi-Fi off.");
    }
  }
}

export async function enablePush(importantOnly = false) {
  const why = pushBlocker();
  if (why === "apple-install") throw new Error("On iPhone and iPad, add " + PN + " to the Home Screen first (Share button, then Add to Home Screen), open it from there, and turn this on again.");
  if (why) throw new Error("This browser can't get push notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied"
    ? "Notifications are blocked for " + PN + " on this device. Allow them in the browser's or phone's settings for this site, then try again."
    : "Notifications weren't allowed.");
  const reg = await registration();
  if (!reg) throw new Error("Couldn't start notifications in this browser.");
  await navigator.serviceWorker.ready;
  const { key } = await get("key");
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different server key has to be replaced
  if (sub && sub.options?.applicationServerKey) {
    const have = new Uint8Array(sub.options.applicationServerKey), want = b64ToBytes(key);
    if (have.length !== want.length || have.some((v, i) => v !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await subscribeWithRetry(reg, b64ToBytes(key));
  const r = await post("subscribe", { subscription: sub.toJSON(), importantOnly });
  remember(true);
  return { endpoint: sub.endpoint, devices: r.devices };
}

export async function disablePush() {
  const sub = await currentSubscription();
  let devices = null;
  if (sub) {
    try { devices = (await post("unsubscribe", { endpoint: sub.endpoint })).devices; } catch (e) { /* still turn it off here */ }
    try { await sub.unsubscribe(); } catch (e) { /* already gone */ }
  }
  remember(false);
  return devices;
}

export const pushDevices = () => get("devices").then(r => r.devices);
export const removeDevice = endpoint => post("unsubscribe", { endpoint }).then(r => r.devices);
export const setDeviceImportantOnly = (endpoint, importantOnly) => post("device", { endpoint, importantOnly }).then(r => r.devices);
export const testPush = endpoint => post("test", endpoint ? { endpoint } : {});

// On each visit: keep the service worker up to date. A device stays with the person who turned
// push on (someone else signing in on the same browser doesn't take it over).
export async function refreshPush() {
  if (!pushOnHere() || !pushSupported()) return;
  const sub = await currentSubscription();
  if (!sub) remember(false);
}
