// Steuerung am Sperrbildschirm (Update 6): dauerhafte Status-Benachrichtigung mit Knöpfen
// („Pause“/„Weiter“, „Autofahren“/„Arbeiten“). Die Knöpfe verarbeitet sw.js ohne die App zu öffnen;
// hier: Benachrichtigung aktuell halten, Zustand + Firebase-Daten für den SW ablegen,
// Warteschlange (lokal/offline) mit Original-Zeitstempeln anwenden und Standort nachtragen.
import "./lock-core.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { isNative } from "./native.js";

const Core = globalThis.LockCore;
const LOC_WINDOW_MS = 15 * 60 * 1000;

let ctx = null;
let snap = null;
let shownKey = "";
let lastSaved = "";
let drainWanted = true;
let draining = false;
let rendering = false;
let renderAgain = false;
let holdKey = "";
let holdUntil = 0;
const HOLD_MS = 8000;
const locTried = new Set();

/** settings.lockscreen mit Standard auffüllen. */
export function readLock(settings) {
  const l = (settings && settings.lockscreen) || {};
  return { enabled: l.enabled !== false };
}

export function isSupported() {
  if (isNative()) return false;
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

function permission() {
  return isSupported() ? Notification.permission : "unsupported";
}

function maxActions() {
  const m = isSupported() ? Number(Notification.maxActions) : NaN;
  return Number.isFinite(m) && m > 0 ? m : 2;
}

async function registration() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) return null; // app.js registriert den SW beim Laden – nicht doppelt
    return await navigator.serviceWorker.ready;
  } catch { return null; }
}

function ident(s) {
  return { mode: s && s.mode === "cloud" ? "cloud" : "local", uid: (s && s.mode === "cloud" && s.user && s.user.uid) || null };
}

/** Beim Start: Firebase-Daten für den SW ablegen, Nachrichten/Sichtbarkeit beobachten. */
export function init(c) {
  ctx = c;
  if (!Core) { console.warn("lock-core.js fehlt"); return; }
  if (isConfigured()) {
    const cfg = { apiKey: firebaseConfig.apiKey, projectId: firebaseConfig.projectId };
    Core.configSet("firebase", cfg).catch(() => {});
    const send = (w) => { try { if (w) w.postMessage({ type: "lock-config", config: cfg }); } catch { /* egal */ } };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((reg) => send(reg.active)).catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => send(navigator.serviceWorker.controller));
    }
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (ev) => {
      const t = ev.data && ev.data.type;
      if (t === "lock-queue" || t === "lock-changed") {
        drainWanted = true;
        // Der SW zeigt schon den neuen Zustand mit Rückmeldung. Bis der Store ihn auch hat (Warteschlange
        // bzw. Firestore-Snapshot), den älteren Stand NICHT darüber anzeigen.
        try {
          if (ev.data.running) {
            shownKey = holdKey = Core.statusKey(ev.data.running, maxActions());
            holdUntil = Date.now() + HOLD_MS;
            setTimeout(render, HOLD_MS + 50);
          }
        } catch { /* egal */ }
        kick();
      }
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { drainWanted = true; kick(); }
  });
}

function kick() {
  if (snap) sync(ctx && ctx.store ? ctx.store.get() : snap);
}

/** Bei jedem Store-Snapshot aufrufen. */
export function sync(s) {
  snap = s;
  if (!Core || !s || !s.ready) return;
  saveLast(s);
  if (drainWanted || draining) {
    // Erst die Warteschlange anwenden, dann anzeigen – sonst blitzt kurz der alte Stand auf
    drain().then(render, render);
  } else {
    render();
  }
  fillLocation();
}

/** Benachrichtigung sofort neu aufbauen (z. B. nach dem Erlauben in den Einstellungen). */
export function refresh() {
  shownKey = "";
  if (snap) render();
}

// ---------- Zustand für den SW ----------

function saveLast(s) {
  const id = ident(s);
  const last = { ...id, running: s.running || null, enabled: readLock(s.settings).enabled };
  const key = JSON.stringify(last);
  if (key === lastSaved) return;
  lastSaved = key;
  Core.configSet("last", { ...last, at: Date.now() }).catch(() => { lastSaved = ""; });
}

// ---------- Benachrichtigung ----------

/** Zeigt/schließt die Status-Benachrichtigung passend zum aktuellen Snapshot. Läuft nie parallel. */
async function render() {
  if (!snap || !Core) return;
  if (rendering) { renderAgain = true; return; }
  rendering = true;
  try {
    do {
      renderAgain = false;
      await renderOnce();
    } while (renderAgain);
  } finally {
    rendering = false;
  }
}

async function renderOnce() {
  const s = snap;
  if (!s || !s.ready || draining) return;
  const want = !!s.running && readLock(s.settings).enabled && permission() === "granted";
  const key = want ? Core.statusKey(s.running, maxActions()) : "none";
  if (key === shownKey) { if (key === holdKey) holdUntil = 0; return; }
  if (Date.now() < holdUntil && key !== holdKey) return; // SW-Stand abwarten (siehe message)
  holdUntil = 0;
  const reg = await registration();
  if (!reg) return;
  try {
    if (want) {
      const n = Core.statusNotification(s.running, { maxActions: maxActions() });
      await reg.showNotification(n.title, n.options);
    } else if (typeof reg.getNotifications === "function") {
      const list = await reg.getNotifications({ tag: Core.TAG });
      list.forEach((n) => n.close());
    }
    shownKey = key;
  } catch (err) {
    console.warn("Status-Benachrichtigung nicht möglich:", err);
  }
  if (snap !== s) renderAgain = true; // inzwischen neuer Stand
}

// ---------- Warteschlange vom Sperrbildschirm ----------

let drainPromise = null;
function drain() {
  if (draining && drainPromise) return drainPromise;
  draining = true;
  drainPromise = drainNow();
  return drainPromise;
}

async function drainNow() {
  drainWanted = false;
  try {
    const s = ctx.store.get();
    if (!s.ready) { drainWanted = true; return; }
    const id = ident(s);
    const all = await Core.queueAll();
    if (!all.length) return;
    const now = Date.now();
    const mine = all.filter((q) => q.mode === id.mode && (q.uid || null) === id.uid);
    const stale = all.filter((q) => !mine.includes(q) && now - q.ts > Core.QUEUE_MAX_AGE_MS);
    const cur = ctx.store.get().running;
    const res = Core.applyQueue(cur, mine);
    if (res.changed) await ctx.store.setRunning(res.running);
    const after = ctx.store.get();
    const last = { ...id, running: after.running || null, enabled: readLock(after.settings).enabled, at: Date.now() };
    lastSaved = JSON.stringify({ mode: last.mode, uid: last.uid, running: last.running, enabled: last.enabled });
    await Core.queueRemove([...mine, ...stale].map((q) => q.id), last);
    if (res.changed && mine.length && ctx.ui) {
      ctx.ui.toast(mine.length === 1 ? "Aktion vom Sperrbildschirm übernommen" : `${mine.length} Aktionen vom Sperrbildschirm übernommen`, 2600);
    }
  } catch (err) {
    console.warn("Warteschlange vom Sperrbildschirm nicht angewendet:", err);
  } finally {
    draining = false;
  }
}

// ---------- Standort für Abschnitte vom Sperrbildschirm nachtragen ----------

async function fillLocation() {
  const s = snap;
  const r = s && s.running;
  if (!r || !Array.isArray(r.segments) || !r.segments.length) return;
  if (document.visibilityState !== "visible") return;
  const i = r.segments.length - 1;
  const g = r.segments[i];
  if (!g || g.via !== "lock" || g.loc) return;
  if (Date.now() - g.start > LOC_WINDOW_MS || locTried.has(g.start)) return;
  if (s.settings && s.settings.autoLocate === false) return;
  const { geo, geofence, store } = ctx;
  if (!geo || !geo.isSupported || !geo.isSupported()) return;
  locTried.add(g.start);
  try {
    if ((await geo.permission()) !== "granted") return; // nie ungefragt fragen
    const loc = await geo.getPosition({ timeout: 10000, maxAge: 30000 });
    let place = null;
    try {
      const m = geofence.matchPlace(loc, store.get().places || [], (s.settings && s.settings.defaultRadius) || 150);
      if (m) place = m.place;
    } catch { /* ohne */ }
    // Erst Standort (+ gespeicherten Ort) eintragen, die Adresse folgt danach (Nominatim ist langsam)
    if (!(await patchSegment(g.start, loc, place))) return;
    if (!place) {
      let addr = null;
      try { addr = await geo.reverseGeocode(loc.lat, loc.lng); } catch { addr = null; }
      if (addr) await patchSegment(g.start, { ...loc, addr }, null, true);
    }
  } catch (err) {
    console.warn("Standort für Abschnitt vom Sperrbildschirm nicht ermittelt:", err);
  }
}

/** Trägt loc/place im Abschnitt mit diesem Start (und endLoc/endPlace im vorigen) ein. */
async function patchSegment(segStart, loc, place, addrOnly = false) {
  const { store } = ctx;
  const r = store.get().running;
  if (!r || !Array.isArray(r.segments)) return false;
  const j = r.segments.findIndex((x) => x.start === segStart);
  if (j < 0) return false;
  const cur = r.segments[j];
  const list = r.segments.slice();
  if (addrOnly) {
    if (!cur.loc || cur.loc.ts !== loc.ts) return false;
    list[j] = { ...cur, loc: { ...cur.loc, addr: cur.loc.addr || loc.addr }, place: (cur.place || cur.placeId) ? cur.place : loc.addr };
    if (j > 0) {
      const p = list[j - 1];
      if (p.endLoc && p.endLoc.ts === loc.ts) list[j - 1] = { ...p, endLoc: { ...p.endLoc, addr: p.endLoc.addr || loc.addr }, endPlace: p.endPlace || loc.addr };
    }
  } else {
    if (cur.loc) return false;
    const { via, ...rest } = cur;
    const name = place ? place.name || "" : "";
    list[j] = { ...rest, loc, placeId: place ? place.id : null, place: name };
    if (j > 0) {
      const p = list[j - 1];
      if (!p.endLoc) list[j - 1] = { ...p, endLoc: loc, endPlace: p.endPlace || name };
    }
  }
  try { await store.setRunning({ ...r, segments: list }); } catch { return false; }
  return true;
}
