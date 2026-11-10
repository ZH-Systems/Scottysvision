const CACHE = "vision-react-d3755f14fd61b5b9";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/vision-icon.svg",
  "/vision-icon-192.png",
  "/vision-icon-512.png",
  "/ingredient-cache.json",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
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
    u.pathname.startsWith("/signin") ||
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
          const r = await c.match("/");
          return r || Response.error();
        }
      })(),
    );
  else if (
    u.pathname.startsWith("/_next/static/") ||
    (SHELL.includes(u.pathname) && u.pathname !== "/")
  )
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE),
          old = await c.match(event.request);
        if (old && u.pathname.startsWith("/_next/static/")) return old;
        try {
          const r = await fetch(event.request);
          if (r.ok && !r.redirected) await c.put(event.request, r.clone());
          return r;
        } catch {
          return old || Response.error();
        }
      })(),
    );
});
