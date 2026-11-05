// Update 9 – Geld-Sperre: Zustand (Konfiguration, Entsperr-Sitzung, Auto-Sperre, „Beträge ausblenden“).
// Konfiguration: Cloud → users/{uid}/meta/money_lock (eigenes Dokument, NICHT settings – der Assistent ändert
// settings, soll die Sperre aber nicht abschalten können), lokal → localStorage "sk-money-lock".
// Entsperrt-Zustand: im Speicher + sessionStorage { ident, until } – Tab-/Bereichswechsel innerhalb der Zeit fragen nicht neu.
// Wird früh von app.js gestartet (für das Ausblenden von Beträgen) und von money-lock.js genutzt.
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import * as L from "./money-lock-core.js";

const LOCAL_KEY = "sk-money-lock";
const CACHE_KEY = "sk-money-lock-cache";
const SESS_KEY = "sk-money-lock-sess";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const ssGet = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k, v) => { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* egal */ } };

/** Test-Haken (nur localhost): window.__moneyLockTest = { autoLockMs, hiddenMs, iter, reauth } */
export function testHook() {
  try { return ["localhost", "127.0.0.1"].includes(location.hostname) && window.__moneyLockTest || null; } catch { return null; }
}

const st = {
  started: false,
  ident: null,       // "local" | "cloud:<uid>" | null
  uid: null,
  cfg: L.normalizeCfg(null),
  loaded: false,
  sess: null,        // { ident, until }
  reason: "",
  unsub: null,
  tick: null,
  lastTouch: 0,
};
const listeners = new Set();

function identOf(s) {
  if (!s || !s.mode) return null;
  if (s.mode === "local") return "local";
  return s.user && s.user.uid ? "cloud:" + s.user.uid : null;
}

const autoMs = () => (testHook() && testHook().autoLockMs) || L.autoLockMs(st.cfg);
const hiddenMs = () => (testHook() && testHook().hiddenMs) || L.HIDDEN_MS;

function readSess() {
  try { const s = JSON.parse(ssGet(SESS_KEY) || "null"); return s && typeof s === "object" ? s : null; } catch { return null; }
}
function writeSess(s) {
  st.sess = s;
  ssSet(SESS_KEY, s ? JSON.stringify(s) : null);
}

/* ---------- Abfragen ---------- */

export function getCfg() { return st.cfg; }
export function isLoaded() { return st.loaded; }
export function ident() { return st.ident; }
export function isLocal() { return st.ident === "local"; }
export function lockReason() { return st.reason; }
/** true, wenn die Sperre aktiv ist und gerade nicht entsperrt. */
export function isLocked() {
  return !!(st.cfg.enabled && !L.sessionValid(st.sess, st.ident));
}

export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  applyMask();
  syncTick();
  for (const cb of listeners) { try { cb(); } catch (err) { console.error("Geld-Sperre:", err); } }
}

function applyMask() {
  try { document.documentElement.classList.toggle("mm-mask", !!(st.loaded && st.cfg.enabled && st.cfg.maskElsewhere && isLocked())); } catch { /* egal */ }
}

/* ---------- Entsperren / Sperren ---------- */

export function unlock() {
  st.reason = "";
  writeSess({ ident: st.ident, until: Date.now() + autoMs() });
  st.lastTouch = Date.now();
  emit();
}

export function lock(reason = "") {
  const was = !isLocked();
  writeSess(null);
  st.reason = reason;
  if (was || reason) emit();
}

function syncTick() {
  const want = st.cfg.enabled && !isLocked();
  if (want && !st.tick) st.tick = setInterval(check, 500);
  else if (!want && st.tick) { clearInterval(st.tick); st.tick = null; }
}

function check() {
  if (!st.cfg.enabled || !st.sess) return;
  if (!L.sessionValid(st.sess, st.ident)) {
    const bg = st.sess.hiddenAt;
    const ms = testHook() && testHook().autoLockMs;
    lock(bg ? "Gesperrt, weil die App im Hintergrund war." : `Automatisch gesperrt (${ms ? "Test" : st.cfg.autoLockMin + " Min. ohne Aktivität"}).`);
  }
}

function bump() {
  if (!st.cfg.enabled || !st.sess || document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - st.lastTouch < 1000) return;
  st.lastTouch = now;
  const n = L.touch(st.sess, st.ident, autoMs(), now);
  if (n) writeSess(n); else check();
}

function onVis() {
  if (!st.cfg.enabled) return;
  if (document.visibilityState === "hidden") {
    const n = L.onHidden(st.sess, st.ident, hiddenMs());
    if (n) writeSess(n);
  } else {
    if (st.sess && !L.sessionValid(st.sess, st.ident)) { check(); return; }
    if (st.sess) { st.lastTouch = 0; const n = L.touch(st.sess, st.ident, autoMs()); if (n) writeSess(n); }
  }
}

/* ---------- Konfiguration laden / speichern ---------- */

function setCfg(raw, fromServer) {
  st.cfg = L.normalizeCfg(raw);
  st.loaded = true;
  if (fromServer && st.ident && st.ident !== "local") lsSet(CACHE_KEY + ":" + st.ident, JSON.stringify(raw || {}));
  emit();
}

function stopWatch() {
  if (st.unsub) { try { st.unsub(); } catch { /* egal */ } }
  st.unsub = null;
}

function sync(s) {
  const k = identOf(s);
  if (k === st.ident) return;
  stopWatch();
  st.ident = k;
  st.uid = s && s.user ? s.user.uid : null;
  st.loaded = false;
  st.cfg = L.normalizeCfg(null);
  const sess = readSess();
  st.sess = L.sessionValid(sess, k) ? sess : null;
  if (!k) { emit(); return; }
  if (k === "local") {
    let raw = null;
    try { raw = JSON.parse(lsGet(LOCAL_KEY) || "null"); } catch { raw = null; }
    setCfg(raw, false);
    const onStorage = (ev) => { if (ev.key === LOCAL_KEY) { try { setCfg(JSON.parse(ev.newValue || "null"), false); } catch { /* egal */ } } };
    window.addEventListener("storage", onStorage);
    st.unsub = () => window.removeEventListener("storage", onStorage);
    return;
  }
  // Cloud: zuerst den zuletzt bekannten Stand (sofort, auch offline), dann Firestore
  const cached = lsGet(CACHE_KEY + ":" + k);
  if (cached) { try { setCfg(JSON.parse(cached), false); } catch { /* egal */ } }
  else emit();
  const myKey = k;
  getFirebase().then((f) => {
    if (!f || st.ident !== myKey) return;
    const { db, fs } = f;
    st.unsub = fs.onSnapshot(fs.doc(db, "users", st.uid, "meta", "money_lock"),
      (d) => { if (st.ident === myKey) setCfg(d.exists() ? d.data() : null, true); },
      (err) => { console.warn("Geld-Sperre laden:", err); if (st.ident === myKey && !st.loaded) setCfg(null, false); });
  }).catch((err) => { console.warn("Geld-Sperre: Firebase", err); if (st.ident === myKey && !st.loaded) setCfg(null, false); });
}

/** Ganze Konfiguration ersetzen (partial wird über den aktuellen Stand gelegt). */
export async function saveCfg(partial) {
  const next = { ...st.cfg, ...partial, v: 1, updated: Date.now() };
  delete next.loaded;
  const clean = JSON.parse(JSON.stringify(next));
  if (st.ident === "local") {
    lsSet(LOCAL_KEY, JSON.stringify(clean));
    setCfg(clean, false);
    return;
  }
  if (!st.uid) throw new Error("Nicht angemeldet.");
  setCfg(clean, true); // sofort anzeigen (auch offline)
  const f = await getFirebase();
  if (!f) throw new Error("Firebase nicht verfügbar.");
  const p = f.fs.setDoc(f.fs.doc(f.db, "users", st.uid, "meta", "money_lock"), clean);
  // offline bestätigt Firestore erst später – nicht ewig warten (bleibt in der Warteschlange)
  p.catch((err) => console.error("Geld-Sperre speichern:", err));
  await Promise.race([p, new Promise((r) => setTimeout(r, 2500))]);
}

/** Einmal starten (idempotent). */
export function start() {
  if (st.started || typeof document === "undefined") return;
  st.started = true;
  ["pointerdown", "keydown", "input", "wheel", "touchstart", "scroll"].forEach((t) => document.addEventListener(t, bump, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", onVis);
  store.subscribe(sync);
}
