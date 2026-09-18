/**
 * CLENQO Cleaner service worker (Change 7; design §9; BD-C5).
 *
 * App-shell/static caching ONLY: precached static assets + an offline
 * fallback shell. NEVER caches API responses or any customer/job data
 * (fetch handler bypasses cache for everything under /cleaner API calls
 * and server actions). Update strategy: new SW activates immediately and
 * posts a message the UI surfaces as an update prompt (client.js listens).
 */
const VERSION = "cleaner-v1";
const SHELL_CACHE = `${VERSION}-shell`;

const SHELL_ASSETS = ["/cleaner/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.postMessage({ type: "SW_UPDATED", version: VERSION });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return; // server actions / mutations: never intercepted
  if (url.origin !== self.location.origin) return;

  // Static assets: cache-first (app shell only).
  if (SHELL_ASSETS.includes(url.pathname) || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (pages, RSC payloads, API): network passthrough, no caching.
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match("/cleaner/icon.svg").then((fallback) => fallback ?? new Response("Offline", { status: 503 })),
    ),
  );
});
