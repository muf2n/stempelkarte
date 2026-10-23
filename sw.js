// Service Worker der Stempelkarte: sorgt für automatische Updates und Offline-Nutzung.
// Eigene Dateien (HTML, JS, CSS, Manifest): zuerst Netz (neue Version kommt sofort an), sonst Cache.
// Icons und Schriftdateien (fonts.gstatic.com): cache-first.
// Alle anderen fremden Domains (Firebase, Google APIs, Nominatim, OSM, unpkg) werden nicht angefasst.

const VERSION = "20261024-0144"; // wird beim Veröffentlichen automatisch ersetzt
const CACHE = "stempelkarte-" + VERSION;
const FONT_CACHE = "stempelkarte-fonts"; // versionsunabhängig, bleibt erhalten
const NET_TIMEOUT_MS = 4000; // bei schlechtem Netz nach dieser Zeit auf den Cache ausweichen

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
  "js/views/reminders.js",
  "js/push.js",
  "js/app.js"
];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

// Cache-Schlüssel ohne ?v=… usw., damit Offline-Treffer unabhängig vom Query-String sind
function plainUrl(url) {
  const u = new URL(url);
  return u.origin + u.pathname;
}

self.addEventListener("install", (event) => {
  // Neue Version soll nicht warten, bis alle Fenster geschlossen sind
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
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
    const keep = new Set([CACHE, FONT_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k.startsWith("stempelkarte") && !keep.has(k)) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

// Abwärtskompatibel: ältere Seiten schicken evtl. noch diese Nachricht
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Schriftdateien: cache-first
  if (url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(req, FONT_CACHE, req));
    return;
  }

  // Alle anderen fremden Domains durchlassen
  if (url.origin !== self.location.origin) return;

  // Nur Dateien innerhalb des App-Bereichs
  if (!req.url.startsWith(self.registration.scope)) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirstNav(event, req));
    return;
  }

  // Icons: cache-first
  if (url.pathname.startsWith(new URL(scopeUrl("icons/")).pathname)) {
    event.respondWith(cacheFirst(req, CACHE, plainUrl(req.url)));
    return;
  }

  event.respondWith(networkFirst(event, req));
});

// Wartet höchstens ms auf das Netz; liefert null bei Zeitüberschreitung
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
}

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  const key = plainUrl(req.url);
  // "no-cache": beim Server nachfragen (ETag), damit der Browser-HTTP-Cache keine alte Datei liefert
  const network = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res && res.ok && res.type === "basic") {
      const copy = res.clone();
      event.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    return res;
  });
  network.catch(() => {}); // unbehandelte Ablehnung vermeiden

  const cached = await cache.match(key) || await cache.match(req, { ignoreSearch: true });
  if (cached) {
    const res = await withTimeout(network, NET_TIMEOUT_MS);
    if (res && (res.ok || res.status < 500)) return res;
    return cached;
  }
  try {
    return await network;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirstNav(event, req) {
  const cache = await caches.open(CACHE);
  const indexUrl = scopeUrl("index.html");
  const rootUrl = scopeUrl("./");
  const plain = plainUrl(req.url);
  const isShell = plain === indexUrl || plain === rootUrl;

  let netReq = req;
  try { netReq = new Request(req, { cache: "no-cache" }); } catch (e) { netReq = req; }
  const network = fetch(netReq).then((res) => {
    if (res && res.ok && res.type === "basic" && isShell) {
      const copy = res.clone();
      event.waitUntil(cache.put(indexUrl, copy).catch(() => {}));
    }
    return res;
  });
  network.catch(() => {});

  const cached = (await cache.match(indexUrl)) ||
                 (await cache.match(rootUrl)) ||
                 (await cache.match(req, { ignoreSearch: true }));
  if (cached) {
    const res = await withTimeout(network, NET_TIMEOUT_MS);
    if (res && res.status < 500) return res;
    return cached;
  }
  try {
    return await network;
  } catch (e) {
    return new Response("<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Offline</title><p style=\"font-family:sans-serif;padding:16px\">Du bist offline. Bitte versuche es gleich noch einmal.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

// ---------- Erinnerungen per Push ----------
// Der Server schickt „data-only“-Nachrichten (FCM/webpush): {data:{title, body, url, tag}}.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {
    try { payload = { data: { body: event.data ? event.data.text() : "" } }; } catch (e2) { payload = {}; }
  }
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = d.title || n.title || payload.title || "Stempelkarte";
  const body = d.body || n.body || payload.body || "";
  const url = d.url || payload.url || (payload.fcmOptions && payload.fcmOptions.link) || "./#heute";
  const tag = d.tag || n.tag || payload.tag || "stempelkarte";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag,
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rel = (event.notification.data && event.notification.data.url) || "./#heute";
  const target = new URL(rel, self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try {
        await c.focus();
        if ("navigate" in c && c.url !== target) await c.navigate(target).catch(() => {});
        return;
      } catch (e) { /* nächstes Fenster probieren */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
