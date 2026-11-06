/*global self caches fetch Response URL */
 /**
 * Unvibe app-shell service worker (PRD §14).
 *
 * Caches ONLY the app shell (start page, offline page, manifest, icons,
 * hashed /assets/* bundles). It NEVER caches API responses or anything
 * containing review data:
 * - `/api/*` requests are never intercepted (network only);
 * - URLs carrying `token=` are never cached or served from cache.
 *
 * When the service isn't running, navigations fall back to the cached
 * offline "Start Unvibe" page (`/start.html`), which links to
 * `unvibe://start` and reloads the app once the service answers.
 */
const VERSION = "unvibe-shell-v2";
const SHELL_URLS = [
  "/start.html",
  "/start.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];
const SHELL_PATHS = new Set(SHELL_URLS);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => Promise.all(SHELL_URLS.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Review data and the token stay on the network, always.
  if (url.pathname.startsWith("/api/")) return;
  if (url.search.includes("token=")) return;

  if (request.mode === "navigate") {
    // App shell is network-first; when the service is down (fetch throws),
    // show the cached offline "Start Unvibe" page instead of an error.
    // Note: HTTP errors (e.g. the 401 missing-token page) are real
    // responses and pass through untouched.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/start.html").then((page) => page || Response.error()),
      ),
    );
    return;
  }

  // Shell files + hashed assets: cache-first, populate on first load.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && (url.pathname.startsWith("/assets/") || SHELL_PATHS.has(url.pathname))) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    }),
  );
});
