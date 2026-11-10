import { backgroundSync } from "./background-worker.js";
const CACHE = "vision-react-__BUILD_HASH__";
const SHELL = __PRECACHE__;
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      for (const path of SHELL) {
        const r = await fetch(path, { cache: "reload" });
        if (!r.ok || r.redirected)
          throw Error("Offline setup could not fetch " + path);
        await c.put(path, r);
      }
      self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys())
        if (
          (k.startsWith("vision-react-") && k !== CACHE) ||
          k.startsWith("scottys-vision-")
        )
          await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    u.origin !== self.location.origin ||
    u.pathname.startsWith("/api/") ||
    u.searchParams.has("_rsc")
  )
    return;
  if (event.request.mode === "navigate" && u.pathname === "/")
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE);
        try {
          const r = await fetch(event.request);
          if (
            r.ok &&
            !r.redirected &&
            r.headers.get("Content-Type")?.includes("text/html")
          )
            await c.put("/", r.clone());
          return r;
        } catch {
          return (await c.match("/")) || Response.error();
        }
      })(),
    );
  else if (
    SHELL.includes(u.pathname) ||
    u.pathname.startsWith("/_next/static/")
  )
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE),
          old = await c.match(u.pathname);
        if (old) return old;
        const r = await fetch(event.request);
        if (r.ok && !r.redirected) await c.put(u.pathname, r.clone());
        return r;
      })(),
    );
});
self.addEventListener("sync", (event) => {
  if (event.tag === "vision-backup") event.waitUntil(backgroundSync());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "VISION_SYNC") event.waitUntil(backgroundSync());
  if (event.data?.type === "VISION_OFFLINE_STATUS")
    event.source?.postMessage({
      type: "VISION_OFFLINE_READY",
      assets: SHELL.length,
    });
});
self.addEventListener("push", (event) =>
  event.waitUntil(
    (async () => {
      let x = {};
      try {
        x = event.data?.json() || {};
      } catch {}
      await self.registration.showNotification(x.title || "Vision Kitchen", {
        body: x.body || "A kitchen check is due.",
        tag: x.tag || "vision-reminder",
        icon: "/vision-icon-192.png",
        data: { url: "/#wings" },
      });
    })(),
  ),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window" });
      if (clients[0]) {
        await clients[0].focus();
        clients[0].postMessage({ type: "VISION_OPEN_WINGS" });
      } else await self.clients.openWindow("/#wings");
    })(),
  );
});
