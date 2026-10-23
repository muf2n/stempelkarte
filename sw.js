// Service Worker der Stempelkarte: cacht die App-Shell für Offline-Nutzung.
// Navigation: zuerst Netz, sonst index.html aus dem Cache. Eigene Dateien: stale-while-revalidate.
// Fremde Domains (Firebase, Google APIs, Nominatim, OSM, unpkg) werden nicht angefasst –
// einzige Ausnahme: Schriftdateien von fonts.gstatic.com (cache-first).

const VERSION = "stempelkarte-v1";
const FONT_CACHE = "stempelkarte-fonts-v1";

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "css/styles.css",
  "js/util.js",
  "js/ui.js",
  "js/firebase-config.js",
  "js/firebase.js",
  "js/auth.js",
  "js/store.js",
  "js/geo.js",
  "js/geofence.js",
  "js/timer.js",
  "js/export.js",
  "js/views/today.js",
  "js/views/entries.js",
  "js/views/overview.js",
  "js/views/places.js",
  "js/app.js"
];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Einzeln und fehlertolerant: eine fehlende Datei bricht die Installation nicht ab.
    await Promise.all(SHELL.map(async (path) => {
      try {
        const res = await fetch(new Request(scopeUrl(path), { cache: "reload" }));
        if (res.ok) await cache.put(scopeUrl(path), res);
      } catch (e) { /* ignorieren */ }
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([VERSION, FONT_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith("stempelkarte-") && !keep.has(k)) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Schriftdateien: cache-first
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }

  // Alle anderen fremden Domains durchlassen
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNav(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, req));
});

async function networkFirstNav(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const u = new URL(req.url);
      const indexUrl = scopeUrl("index.html");
      const scopeRoot = scopeUrl("./");
      const plain = u.origin + u.pathname;
      if (plain === indexUrl || plain === scopeRoot) cache.put(indexUrl, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = (await cache.match(scopeUrl("index.html"))) ||
                   (await cache.match(scopeUrl("./"))) ||
                   (await cache.match(req, { ignoreSearch: true }));
    if (cached) return cached;
    return new Response("<!doctype html><meta charset=utf-8><title>Offline</title><p>Du bist offline.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res && res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || new Response("", { status: 504, statusText: "Offline" });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}
