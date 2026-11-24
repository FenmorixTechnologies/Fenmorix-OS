// SGFD Nexus service worker: shows push notifications on phones, tablets and computers.
// It doesn't cache pages (Nexus always loads fresh from the server).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

const APPLE = /iPhone|iPad|Macintosh.*Mobile/.test(self.navigator.userAgent || "");

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // When Nexus is open and in front on this device, the page makes its own alert. (Apple devices
    // must always show something for every push, so they always do.)
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (!APPLE && !d.test && wins.some(w => w.focused && w.visibilityState === "visible")) return;
    await self.registration.showNotification(d.title || "SGFD Nexus", {
      body: d.body || "You have a new message.",
      tag: d.tag || undefined, renotify: !!d.tag,
      icon: "/icon-192.png", badge: "/icon-192.png",
      requireInteraction: !!d.important,
      data: { url: d.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      w.postMessage({ type: "sgfd-open-url", url });
      return w.focus();
    }
    return self.clients.openWindow(url);
  })());
});
