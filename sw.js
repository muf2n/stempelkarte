// Service Worker der Stempelkarte: sorgt für automatische Updates und Offline-Nutzung.
// Eigene Dateien (HTML, JS, CSS, Manifest): zuerst Netz (neue Version kommt sofort an), sonst Cache.
// Icons und Schriftdateien (fonts.gstatic.com): cache-first.
// Alle anderen fremden Domains (Firebase, Google APIs, Nominatim, OSM, unpkg) werden nicht angefasst.

const VERSION = "20261105-2030"; // wird beim Veröffentlichen automatisch ersetzt
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
  "js/views/plans.js",
  "js/views/school-settings.js",
  "js/icons.js",
  "js/deco.js",
  "js/lock-core.js",
  "js/lockscreen.js",
  "js/native.js",
  "js/views/lock-settings.js",
  "js/motion.js",
  "js/views/drive-settings.js",
  "js/views/agenda.js",
  "js/einsatz.js",
  "js/planer-core.js",
  "js/views/planer-cal.js",
  "js/cal-core.js",
  "js/cal-google.js",
  "js/cal-feeds.js",
  "js/cal-feed-core.js",
  "js/cal-notify.js",
  "js/views/cal-views.js",
  "js/views/cal-dnd.js",
  "js/views/cal-editor.js",
  "js/views/cal-tools.js",
  "js/views/apprentice.js",
  "js/views/comfort-settings.js",
  "js/views/day.js",
  "js/views/report.js",
  "js/views/timesheet.js",
  "js/views/leave.js",
  "js/watch.js",
  "js/views/watch-settings.js",
  "js/travel.js",
  "js/views/trips.js",
  "js/views/allowance-settings.js",
  // Update 9 – Fahrtenbuch
  "js/trip-core.js",
  "js/road-km.js",
  "js/views/triplog.js",
  "js/photos.js",
  "js/views/gallery.js",
  // Update 9b – Schule & Lernen
  "js/alltag/school.js",
  "js/alltag/school-core.js",
  "js/alltag/school-timetable.js",
  "js/alltag/school-tasks.js",
  "js/alltag/school-exams.js",
  "js/alltag/school-learn.js",
  "js/alltag/school-docs.js",
  "js/alltag/school-subjects.js",
  "js/alltag/school-planner.js",
  "js/alltag/ai-client.js",
  "css/alltag-school.css",
  "js/native-sync.js",
  "js/views/android-settings.js",
  "icons/wecker-192.png",
  "js/views/alltag.js",
  "js/alltag/db.js",
  "js/alltag/modules.js",
  "js/alltag/money-core.js",
  "js/alltag/money.js",
  "js/alltag/assistant.js",
  "js/alltag/trash.js", // Papierkorb (Claude-Löschungen)
  "js/alltag/trash-core.js",
  "css/alltag-trash.css",
  // Update 9 – Claude-Sprachmodus
  "js/alltag/voice.js",
  "js/alltag/voice-core.js",
  // Update 9 – Abos aus Gmail
  "js/alltag/gmail.js",
  "js/alltag/subs-detect.js",
  "js/alltag/money-gmail.js",
  // Update 9 – Abos (Kündigen, Fristen, Katalog)
  "js/alltag/money-subs.js",
  "js/alltag/money-budget.js",
  "js/alltag/subs-core.js",
  "js/alltag/subs-catalog.js",
  // Update 9 – Bankverbindung (BAWAG über Enable Banking)
  "js/alltag/money-bank.js",
  "js/alltag/money-savings.js",
  "bank-callback.html",
  // Update 9 – Passwort-Tresor
  "js/alltag/vault.js",
  "js/alltag/vault-crypto.js",
  "js/alltag/vault-core.js",
  "js/alltag/vault-docs.js",
  "js/alltag/vault-docs-core.js",
  "js/alltag/vault-files.js",
  "css/alltag-vault-docs.css",
  "js/alltag/qr.js",
  // Update 9 – Unterwegs
  "js/alltag/unterwegs.js",
  "js/alltag/unterwegs-core.js",
  "js/alltag/unterwegs-shared.js",
  "js/alltag/unterwegs-pack.js",
  "js/alltag/unterwegs-park.js",
  "js/alltag/unterwegs-fuel.js",
  "js/alltag/unterwegs-places.js",
  "css/alltag-unterwegs.css",
  // Update 9 – Material
  "js/alltag/material.js",
  "js/alltag/material-core.js",
  "css/alltag-material.css",
  // Update 9 – Galerie
  "js/gallery-core.js",
  "js/gallery-albums.js",
  "js/alltag/galerie.js",
  "css/alltag-galerie.css",
  "js/gallery-active.js", // Update 9 (Agent U) – aktive Kategorie
  "css/gallery-active.css",
  "js/media-import-core.js", // Update 9 (Agent W3) – Kamera-Fotos übernehmen
  "js/media-import.js",
  "css/media-import.css",
  // Update 9 – Privat / Arbeit
  "js/privat-core.js",
  "js/privat.js",
  "js/privat-drive.js",
  "js/views/privat-mode.js",
  "css/privat.css",
  "js/app.js"
];

// Gemeinsamer Kern für die Sperrbildschirm-Steuerung (Codec + Aktionslogik).
// Fehlertolerant: fehlt die Datei, funktionieren Updates, Offline und Erinnerungen trotzdem.
try { importScripts("js/lock-core.js"); } catch (e) { /* ohne Sperrbildschirm-Knöpfe */ }

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

  // Rückkehr von der Bank (Update 9): nie durch index.html ersetzen, sonst geht ?code=… verloren
  if (req.mode === "navigate" && url.pathname.endsWith("/bank-callback.html")) return;

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
  // Update 6: Knöpfe der Status-Benachrichtigung („Pause“, „Weiter“, „Autofahren“ …) ohne App-Öffnen.
  // Antippen der Benachrichtigung selbst (ohne Knopf) und alle anderen Benachrichtigungen: alter Weg.
  const nd = event.notification.data || {};
  if (nd.kind === "status" && event.action && self.LockCore) {
    const p = handleStatusAction(event.action).catch((e) => console.error(e));
    try { event.waitUntil(p); } catch (e) { /* synthetisches Ereignis (Tests) */ }
    return;
  }
  event.notification.close();
  const rel = (event.notification.data && event.notification.data.url) || "./#heute";
  const target = new URL(rel, self.registration.scope).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Bestehendes App-Fenster auf genau diese url schicken (z. B. ./?plan=…&due=…#heute) und fokussieren
    for (const c of list) {
      if (!c.url.startsWith(self.registration.scope)) continue;
      try {
        let win = c;
        if (c.url !== target && "navigate" in c) win = (await c.navigate(target)) || null;
        if (win) { await win.focus().catch(() => {}); return; }
      } catch (e) { /* nächstes Fenster probieren */ }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// ---------- Steuerung am Sperrbildschirm (Update 6) ----------
// Die App schickt beim Start {apiKey, projectId} (postMessage) und legt sie zusätzlich in IndexedDB
// "stempelkarte-sw"/"config" ab ("firebase"); bei jedem Zustand schreibt sie "last" = {mode, uid, running, rev, enabled}.
// Cloud-Modus: Token aus der Firebase-Auth-IndexedDB, Firestore per REST lesen/schreiben.
// Lokaler Modus oder Fehler: Aktion mit Zeitstempel in die Warteschlange "queue" – die App holt sie nach.

let lockConfig = null;

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === "lock-config" && d.config && d.config.apiKey && d.config.projectId) {
    lockConfig = { apiKey: String(d.config.apiKey), projectId: String(d.config.projectId) };
  }
});

const AUTH_DB = "firebaseLocalStorageDb";
const AUTH_STORE = "firebaseLocalStorage";

function readAuthUser(apiKey) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(AUTH_DB); } catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (e) { /* egal */ } };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUTH_STORE)) { db.close(); resolve(null); return; }
      try {
        const all = db.transaction(AUTH_STORE, "readonly").objectStore(AUTH_STORE).getAll();
        all.onsuccess = () => {
          db.close();
          const prefix = "firebase:authUser:" + apiKey + ":";
          const row = (all.result || []).find((r) => r && typeof r.fbase_key === "string" && r.fbase_key.startsWith(prefix));
          resolve(row ? row.value : null);
        };
        all.onerror = () => { db.close(); resolve(null); };
      } catch (e) { db.close(); resolve(null); }
    };
  });
}

function lockError(code, msg) { const e = new Error(msg || code); e.code = code; return e; }

async function idToken(cfg, uid) {
  const user = await readAuthUser(cfg.apiKey);
  if (!user || !user.stsTokenManager) throw lockError("no-auth", "Nicht angemeldet");
  if (uid && user.uid && user.uid !== uid) throw lockError("no-auth", "Anderes Konto");
  const tm = user.stsTokenManager;
  if (tm.accessToken && Number(tm.expirationTime) > Date.now() + 60000) return { token: tm.accessToken, uid: user.uid };
  // Zuvor selbst erneuertes Token (in eigener DB, nicht in der Auth-DB) wiederverwenden
  try {
    const t = await LockCore.configGet("token");
    if (t && t.uid === user.uid && t.exp > Date.now() + 60000) return { token: t.idToken, uid: user.uid };
  } catch (e) { /* egal */ }
  if (!tm.refreshToken) throw lockError("no-auth", "Kein Refresh-Token");
  const res = await fetch("https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(cfg.apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(tm.refreshToken),
  });
  if (!res.ok) throw lockError("token", "Token-Erneuerung fehlgeschlagen (" + res.status + ")");
  const j = await res.json();
  if (!j.id_token) throw lockError("token", "Kein Token erhalten");
  const exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  LockCore.configSet("token", { uid: user.uid, idToken: j.id_token, exp }).catch(() => {});
  return { token: j.id_token, uid: user.uid };
}

/** Cloud: Zustand lesen, Aktion anwenden, mit rev zurückschreiben (Vorbedingung updateTime, 1 Wiederholung). */
async function cloudApply(cfg, uid, action, ts) {
  const auth = await idToken(cfg, uid);
  const docUrl = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(cfg.projectId) +
    "/databases/(default)/documents/users/" + encodeURIComponent(auth.uid) + "/meta/state";
  const headers = { Authorization: "Bearer " + auth.token };
  for (let attempt = 0; attempt < 2; attempt++) {
    const g = await fetch(docUrl, { headers, cache: "no-store" });
    let doc = null;
    if (g.status === 404) doc = { fields: {} };
    else if (g.ok) doc = await g.json();
    else throw lockError("http", "Lesen fehlgeschlagen (" + g.status + ")");
    const data = LockCore.decodeFields(doc.fields || {});
    const res = LockCore.applyAction(data.running || null, action, ts); // wirft not-running
    const rev = LockCore.nextRev(data.rev, Date.now());
    let url = docUrl + "?updateMask.fieldPaths=running&updateMask.fieldPaths=rev";
    if (doc.updateTime) url += "&currentDocument.updateTime=" + encodeURIComponent(doc.updateTime);
    const p = await fetch(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: LockCore.encodeFields({ running: res.running, rev }) }),
    });
    if (p.ok) return { running: res.running, rev, uid: auth.uid };
    if ((p.status === 400 || p.status === 409) && attempt === 0) continue; // inzwischen geändert → neu lesen
    throw lockError("http", "Speichern fehlgeschlagen (" + p.status + ")");
  }
  throw lockError("http", "Speichern fehlgeschlagen");
}

function maxNotifActions() {
  const m = self.Notification && Number(self.Notification.maxActions);
  return Number.isFinite(m) && m > 0 ? m : 2;
}

async function showStatus(running, note) {
  if (!running) return closeStatus();
  const n = LockCore.statusNotification(running, { note, maxActions: maxNotifActions() });
  await self.registration.showNotification(n.title, n.options);
}

async function closeStatus() {
  const list = await self.registration.getNotifications({ tag: LockCore.TAG });
  list.forEach((n) => n.close());
}

async function showLockMessage(body) {
  await self.registration.showNotification("Stempelkarte", {
    tag: LockCore.TAG, body, icon: LockCore.ICON, badge: LockCore.ICON,
    silent: true, renotify: false, requireInteraction: false,
    data: { kind: "status-info", url: "./#heute" },
  });
}

async function tellClients(msg) {
  try {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    list.forEach((c) => c.postMessage(msg));
  } catch (e) { /* egal */ }
}

async function handleStatusAction(actionStr) {
  const action = LockCore.parseAction(actionStr);
  if (!action) return;
  const ts = Date.now();
  let last = null;
  try { last = await LockCore.configGet("last"); } catch (e) { last = null; }
  let cfg = lockConfig;
  if (!cfg) { try { cfg = await LockCore.configGet("firebase"); } catch (e) { cfg = null; } }

  // 1./2. Cloud: direkt in Firestore
  if (last && last.mode === "cloud" && last.uid && cfg && cfg.apiKey && cfg.projectId) {
    try {
      const r = await cloudApply(cfg, last.uid, action, ts);
      LockCore.configSet("last", { ...last, running: r.running, rev: r.rev, at: Date.now() }).catch(() => {});
      await showStatus(r.running, LockCore.feedback(action, ts));
      await tellClients({ type: "lock-changed", running: r.running });
      return;
    } catch (e) {
      if (e && e.code === "not-running") { await showLockMessage("Du bist nicht (mehr) eingestempelt."); return; }
      console.warn("Sperrbildschirm: Cloud-Speichern fehlgeschlagen, nutze Warteschlange:", e);
    }
  }

  // 3. Lokal/offline: Warteschlange; angezeigter Zustand = letzter bekannter Zustand + Warteschlange
  try {
    const queued = (await LockCore.queueAll()).filter((q) => q.mode === (last && last.mode) && q.uid === (last && last.uid));
    const base = LockCore.applyQueue(last ? last.running : null, queued).running;
    if (!base) { await showLockMessage("Du bist nicht eingestempelt – öffne die App."); return; }
    const res = LockCore.applyAction(base, action, ts);
    await LockCore.queueAdd({ ts, action: LockCore.actionString(action), mode: last.mode, uid: last.uid || null });
    const note = LockCore.feedback(action, ts) + (last.mode === "cloud" ? " · wird beim Öffnen der App gespeichert" : "");
    await showStatus(res.running, note);
    await tellClients({ type: "lock-queue", running: res.running });
  } catch (e) {
    console.error("Sperrbildschirm: Aktion nicht gespeichert:", e);
    try { await showLockMessage("Konnte nicht speichern – öffne die App"); } catch (e2) { /* egal */ }
  }
}
