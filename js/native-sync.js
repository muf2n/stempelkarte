// Android-App (Agent X): Schritte vom Handy, native Push-Erinnerungen, Orte an die App melden.
// Läuft nur in der nativen Hülle (Capacitor); im Browser ist alles hier ein No-op.
// Plugins: StempelHealth (eigene App), StempelNative (Agent W), PushNotifications (@capacitor/push-notifications).
import { isNative, plugin } from "./native.js";
import { getFirebase } from "./firebase.js";

const DAYS_BACK = 14;
const MIN_GAP_MS = 60 * 1000;
const PUSH_TOKEN_KEY = "stempelkarte.nativePushToken";
const PUSH_ASKED_KEY = "stempelkarte.nativePushAsked";
const TZ = "Europe/Vienna";

let ctx = null;
let started = false;
let lastStepSync = 0;
let stepBusy = null;
let lastPlacesSig = null;
let placesTimer = null;
let pushListeners = false;
let pushUid = null;
let lastStepResult = null;
let stepsQueuedFor = null; // Modus/Nutzer, für den der Start-Abgleich schon lief
const listeners = new Set();

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }

function pad(n) { return (n < 10 ? "0" : "") + n; }
export function dayKeyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

/** Hat das native Plugin diese Methode? (Ältere APKs kennen neue Methoden noch nicht.) */
export function hasMethod(name, method) {
  if (!isNative()) return false;
  try {
    const headers = window.Capacitor && window.Capacitor.PluginHeaders;
    if (Array.isArray(headers) && headers.length) {
      const h = headers.find((x) => x && x.name === name);
      return !!(h && Array.isArray(h.methods) && h.methods.some((m) => m && m.name === method));
    }
  } catch { /* weiter unten prüfen */ }
  const P = plugin(name);
  return !!(P && typeof P[method] === "function");
}

/** Methode aufrufen; → Ergebnis oder wirft. Fehlt sie, Fehler mit code "missing". */
export async function call(name, method, args) {
  if (!hasMethod(name, method)) { const e = new Error("kommt mit dem nächsten App-Update"); e.code = "missing"; throw e; }
  const P = plugin(name);
  try {
    return await P[method](args || {});
  } catch (err) {
    if (err && (err.code === "UNIMPLEMENTED" || /not implemented/i.test(String(err.message)))) {
      const e = new Error("kommt mit dem nächsten App-Update"); e.code = "missing"; throw e;
    }
    throw err;
  }
}

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { for (const cb of [...listeners]) { try { cb(); } catch (e) { console.error(e); } } }
export function lastSteps() { return lastStepResult; }

// ---------- Schritte ----------

function sameVals(a, b) {
  if (!a) return false;
  return ["steps", "altUp", "floors"].every((k) => (a[k] ?? null) === (b[k] ?? null)) && a.source === b.source;
}

/**
 * Liest die letzten 14 Tage aus StempelHealth und speichert sie per store.saveDay.
 * Tage mit Werten der Uhr (source "bangle") bleiben unangetastet.
 * → { days, saved, source } oder null (nicht möglich)
 */
export async function syncSteps(c = ctx, { force = false } = {}) {
  if (!isNative() || !c || !c.store) return null;
  if (stepBusy) return stepBusy;
  if (!force && Date.now() - lastStepSync < MIN_GAP_MS) return null;
  const snap = c.store.get && c.store.get();
  if (!snap || !snap.ready || typeof c.store.saveDay !== "function") return null;
  if (!hasMethod("StempelHealth", "readDays")) return null;
  lastStepSync = Date.now();
  stepBusy = (async () => {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (DAYS_BACK - 1));
    const res = await call("StempelHealth", "readDays", { fromDayKey: dayKeyOf(from), toDayKey: dayKeyOf(to) });
    const list = (res && Array.isArray(res.days)) ? res.days : [];
    const have = (c.store.get().days) || {};
    let saved = 0;
    const now = Date.now();
    for (const d of list) {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.dayKey))) continue;
      const vals = {
        steps: Number.isFinite(Number(d.steps)) && d.steps !== null ? Math.round(Number(d.steps)) : null,
        altUp: Number.isFinite(Number(d.altUp)) && d.altUp !== null ? Math.round(Number(d.altUp)) : null,
        floors: Number.isFinite(Number(d.floors)) && d.floors !== null ? Math.round(Number(d.floors) * 10) / 10 : null,
        source: "phone",
      };
      if (vals.steps == null && vals.altUp == null && vals.floors == null) continue;
      const cur = have[d.dayKey];
      if (cur && cur.source === "bangle" && (cur.steps != null || cur.altUp != null)) continue; // Uhr hat Vorrang
      if (sameVals(cur, vals)) continue;
      const out = { source: "phone", syncedAt: now };
      for (const k of ["steps", "altUp", "floors"]) if (vals[k] != null) out[k] = vals[k];
      await c.store.saveDay(d.dayKey, out);
      saved++;
    }
    lastStepResult = { at: now, days: list.length, saved, source: (res && res.source) || "none" };
    emit();
    return lastStepResult;
  })();
  try { return await stepBusy; }
  catch (err) { console.warn("Schritte vom Handy:", err); return null; }
  finally { stepBusy = null; }
}

// ---------- Orte → Geofences (StempelNative, Agent W) ----------

function placesSig(places) {
  return (places || []).map((p) => [p.id, p.name, p.lat, p.lng, p.radius].join("|")).sort().join(";");
}

export async function syncPlacesNow(c = ctx) {
  if (!hasMethod("StempelNative", "syncPlaces")) return false;
  const snap = c && c.store && c.store.get ? c.store.get() : null;
  const places = (snap && Array.isArray(snap.places) ? snap.places : [])
    .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ id: p.id, name: p.name || "", lat: Number(p.lat), lng: Number(p.lng), radius: Number(p.radius) || null }));
  try {
    // UNSICHER: Agent W liest die Orte selbst aus Firestore; die mitgeschickte Liste ist nur ein Zusatz.
    await call("StempelNative", "syncPlaces", { places });
    return true;
  } catch (err) {
    if (!err || err.code !== "missing") console.warn("Orte an die App melden:", err);
    return false;
  }
}

function watchPlaces(snap) {
  if (!snap || !snap.ready) return;
  const sig = placesSig(Array.isArray(snap.places) ? snap.places : []);
  if (sig === lastPlacesSig) return;
  const first = lastPlacesSig === null;
  lastPlacesSig = sig;
  clearTimeout(placesTimer);
  placesTimer = setTimeout(() => syncPlacesNow(), first ? 3000 : 1500);
}

// ---------- Push-Erinnerungen (nativ) ----------

function cloudUid(c = ctx) {
  const s = c && c.store && c.store.get ? c.store.get() : null;
  return s && s.mode === "cloud" && s.user ? s.user.uid : null;
}

async function saveToken(token) {
  const uid = cloudUid();
  if (!uid || !token) return;
  const f = await getFirebase();
  if (!f) return;
  const { db, fs } = f;
  const ref = fs.doc(db, "users", uid, "meta", "push");
  await fs.setDoc(ref, {
    tokens: { [token]: { platform: "android", ua: (navigator.userAgent || "").slice(0, 120), updatedAt: Date.now() } },
    tz: TZ,
  }, { merge: true });
  const old = lsGet(PUSH_TOKEN_KEY);
  if (old && old !== token) {
    // Token hat sich erneuert → alten Eintrag entfernen, damit nichts doppelt kommt
    try { await fs.updateDoc(ref, new fs.FieldPath("tokens", old), fs.deleteField()); } catch { /* Server räumt ungültige Tokens selbst auf */ }
  }
  lsSet(PUSH_TOKEN_KEY, token);
  emit();
}

async function ensurePushListeners() {
  const P = plugin("PushNotifications");
  if (!P || pushListeners) return P;
  pushListeners = true;
  try {
    await P.addListener("registration", (t) => {
      saveToken(t && t.value).catch((err) => console.warn("Push-Token speichern:", err));
    });
    await P.addListener("registrationError", (e) => console.warn("Push-Anmeldung fehlgeschlagen:", e && e.error));
    await P.addListener("pushNotificationActionPerformed", (a) => {
      const url = a && a.notification && a.notification.data && a.notification.data.url;
      if (!url) return;
      let target = null;
      try { target = new URL(String(url), location.href); } catch { return; }
      if (target.origin !== location.origin) return;
      // ?plan=…/?endplan=… wertet app.js nur beim Laden aus → dann neu laden, sonst nur den Reiter wechseln
      if (target.search) { location.assign(target.href); return; }
      if (/^#[a-z-]+$/.test(target.hash)) location.hash = target.hash;
    });
  } catch (err) { console.warn("Push-Listener:", err); }
  try {
    if (typeof P.createChannel === "function") {
      await P.createChannel({ id: "erinnerungen", name: "Erinnerungen", description: "Erinnerungen ans Stempeln", importance: 5, visibility: 1 });
    }
  } catch { /* Kanal legt die App auch selbst an */ }
  return P;
}

/** → { available, permission: "granted"|"denied"|"prompt"|…, token } */
export async function pushStatus() {
  const P = plugin("PushNotifications");
  if (!P || typeof P.checkPermissions !== "function") return { available: false, permission: "unsupported", token: null };
  let permission = "prompt";
  try { permission = (await P.checkPermissions()).receive || "prompt"; } catch { /* egal */ }
  return { available: true, permission, token: lsGet(PUSH_TOKEN_KEY) };
}

/** Berechtigung anfragen und Gerät anmelden. interactive=false: nur, wenn schon erlaubt. */
export async function enablePush({ interactive = true } = {}) {
  const P = await ensurePushListeners();
  if (!P) return { ok: false, reason: "unsupported" };
  if (!cloudUid()) return { ok: false, reason: "no-user" };
  let st = "prompt";
  try { st = (await P.checkPermissions()).receive; } catch { /* egal */ }
  if (st !== "granted" && interactive) {
    try { st = (await P.requestPermissions()).receive; } catch { /* egal */ }
  }
  emit();
  if (st !== "granted") return { ok: false, reason: st || "denied" };
  await P.register();
  return { ok: true };
}

async function autoPush() {
  const uid = cloudUid();
  if (!uid || pushUid === uid) return;
  pushUid = uid;
  try {
    const st = await pushStatus();
    if (!st.available) return;
    if (st.permission === "granted") await enablePush({ interactive: false });
    else if (st.permission !== "denied" && !lsGet(PUSH_ASKED_KEY)) {
      lsSet(PUSH_ASKED_KEY, "1"); // nur einmal von selbst fragen, danach über die Karte „Android-App“
      await enablePush({ interactive: true });
    }
  } catch (err) { console.warn("Push (App):", err); }
}

// ---------- Start ----------

/** Einmal beim App-Start aufrufen. Im Browser: nichts. */
export function start(c) {
  if (!isNative() || started || !c || !c.store) return;
  started = true;
  ctx = c;
  c.store.subscribe((snap) => {
    if (!snap || !snap.ready) return;
    watchPlaces(snap);
    autoPush();
    const who = snap.mode + ":" + (snap.user ? snap.user.uid : "");
    if (stepsQueuedFor !== who) { stepsQueuedFor = who; setTimeout(() => syncSteps(c, { force: true }), 1500); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncSteps(c);
  });
}
