// Datenspeicher der App: hält Einträge, Orte, laufende Schicht und Einstellungen –
// entweder synchron in Firestore (Cloud-Modus) oder nur im localStorage (lokaler Modus).
// Änderungen werden sofort (optimistisch) sichtbar gemacht und danach gespeichert.

import { getFirebase } from "./firebase.js";
import { toast } from "./ui.js";
import { newId } from "./util.js";

const LS_KEY = "stempelkarte.local.v1";
const SAVE_DELAY_MS = 250;
const FAIL_MSG = "Speichern fehlgeschlagen – bitte nochmal versuchen.";

const DEFAULT_SETTINGS = Object.freeze({ weeklyTarget: 38.5, autoLocate: true, defaultRadius: 150 });

// ---------- Zustand ----------
let mode = "local";
let ready = false;
let user = null;
let entries = new Map(); // id → Entry
let places = new Map();  // id → Place
let running = null;
let rev = 0;             // rev des zuletzt übernommenen state
let lastLocalRev = 0;    // rev des zuletzt lokal geschriebenen state
let settings = { ...DEFAULT_SETTINGS };

let started = false;
let gen = 0;             // erhöht bei jedem start/stop – verwirft verspätete Antworten
let unsubs = [];         // Firestore-Listener bzw. Fenster-Listener
let fb = null;           // {db, fs} im Cloud-Modus

const subscribers = new Set();
let snap = null;         // zwischengespeicherte Momentaufnahme
let notifyQueued = false;

// lokaler Modus: entprelltes Speichern
let saveTimer = null;
let savePending = null;  // {promise, resolve, reject}

// ---------- Hilfen ----------

/** Entfernt undefined-Werte rekursiv (Firestore lehnt sie ab); null bleibt erhalten. */
function clean(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
    return out;
  }
  return v;
}

function withoutId(obj) {
  const { id, ...rest } = obj || {};
  return rest;
}

function mergeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function nextRev() {
  const r = Math.max(Date.now(), lastLocalRev + 1, rev + 1);
  lastLocalRev = r;
  return r;
}

function fail(err) {
  console.error("Speicherfehler:", err);
  try { toast(FAIL_MSG); } catch { /* UI evtl. nicht bereit */ }
  return err instanceof Error ? err : new Error(String(err));
}

function buildSnapshot() {
  const sortedPlaces = [...places.values()].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base" }));
  return {
    mode, ready, user,
    entries: [...entries.values()],
    places: sortedPlaces,
    running,
    settings: { ...settings },
  };
}

function changed() {
  snap = null;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    const s = get();
    for (const cb of [...subscribers]) {
      try { cb(s); } catch (err) { console.error("Store-Abonnent fehlgeschlagen:", err); }
    }
  });
}

function resetState(newMode) {
  mode = newMode;
  ready = false;
  user = null;
  entries = new Map();
  places = new Map();
  running = null;
  rev = 0;
  lastLocalRev = 0;
  settings = { ...DEFAULT_SETTINGS };
  fb = null;
}

/** Übernimmt einen eingehenden state ({running, rev}) unter Beachtung des Rev-Schutzes. */
function applyState(data) {
  const r = Number(data?.rev) || 0;
  if (r < lastLocalRev) return false; // veralteter Stand – ignorieren
  rev = r;
  running = data?.running ?? null;
  return true;
}

// ---------- Lokaler Modus: localStorage ----------

function readLocal() {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Lokale Daten nicht lesbar:", err);
    return null;
  }
}

function writeLocalNow() {
  const data = {
    entries: [...entries.values()],
    places: [...places.values()],
    running,
    rev,
    settings,
  };
  globalThis.localStorage.setItem(LS_KEY, JSON.stringify(clean(data)));
}

function flushLocal() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const p = savePending;
  savePending = null;
  if (!p) return;
  try {
    writeLocalNow();
    p.resolve();
  } catch (err) {
    p.reject(fail(err));
  }
}

/** Plant das Speichern ein; das Promise erfüllt sich, sobald tatsächlich geschrieben wurde. */
function scheduleLocalSave() {
  if (!savePending) {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    savePending = { promise, resolve, reject };
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushLocal, SAVE_DELAY_MS);
  return savePending.promise;
}

function loadLocalInto(data) {
  entries = new Map((Array.isArray(data?.entries) ? data.entries : [])
    .filter((e) => e && e.id).map((e) => [e.id, e]));
  places = new Map((Array.isArray(data?.places) ? data.places : [])
    .filter((p) => p && p.id).map((p) => [p.id, p]));
  applyState({ running: data?.running ?? null, rev: data?.rev ?? 0 });
  settings = mergeSettings(data?.settings);
}

// ---------- Start / Stopp ----------

export function startLocal() {
  stop();
  const myGen = gen;
  resetState("local");
  started = true;
  loadLocalInto(readLocal());
  ready = true;

  if (typeof window !== "undefined" && window.addEventListener) {
    // Änderungen aus einem anderen Tab übernehmen
    const onStorage = (ev) => {
      if (myGen !== gen || ev.key !== LS_KEY) return;
      let data = null;
      try { data = ev.newValue ? JSON.parse(ev.newValue) : null; } catch { return; }
      loadLocalInto(data);
      changed();
    };
    // Beim Verlassen/Verstecken der Seite sofort speichern
    const onHide = () => { if (savePending) flushLocal(); };
    const onVis = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    unsubs.push(() => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    });
  }
  changed();
}

export async function startCloud(u) {
  stop();
  const myGen = gen;
  resetState("cloud");
  started = true;
  user = u ? { uid: u.uid, name: u.name ?? null, photo: u.photo ?? null, email: u.email ?? null } : null;
  changed();

  const f = await getFirebase();
  if (myGen !== gen) return; // inzwischen gestoppt/neu gestartet
  if (!f) throw new Error("Firebase ist nicht konfiguriert.");
  if (!user?.uid) throw new Error("Kein Nutzer angemeldet.");
  const { db, fs } = f;
  fb = { db, fs };
  const uid = user.uid;

  const seen = { entries: false, places: false, state: false, settings: false };
  const markSeen = (k) => {
    seen[k] = true;
    if (!ready && seen.entries && seen.places && seen.state && seen.settings) ready = true;
  };
  const onErr = (k) => (err) => {
    console.error(`Firestore-Listener „${k}“ fehlgeschlagen:`, err);
    if (myGen !== gen) return;
    if (err && err.code === "permission-denied" && !onErr.shown) {
      onErr.shown = true;
      toast("Dieses Google-Konto hat keinen Zugriff. Melde dich unter „Übersicht“ ab und mit deinem eigenen Konto an.", 8000);
    }
    markSeen(k);
    changed();
  };

  unsubs.push(fs.onSnapshot(fs.collection(db, "users", uid, "entries"), (qs) => {
    if (myGen !== gen) return;
    const m = new Map();
    qs.forEach((d) => m.set(d.id, { ...d.data(), id: d.id }));
    entries = m;
    markSeen("entries");
    changed();
  }, onErr("entries")));

  unsubs.push(fs.onSnapshot(fs.collection(db, "users", uid, "places"), (qs) => {
    if (myGen !== gen) return;
    const m = new Map();
    qs.forEach((d) => m.set(d.id, { ...d.data(), id: d.id }));
    places = m;
    markSeen("places");
    changed();
  }, onErr("places")));

  unsubs.push(fs.onSnapshot(fs.doc(db, "users", uid, "meta", "state"), (ds) => {
    if (myGen !== gen) return;
    // Auch bei hasPendingWrites gilt: veraltete revs werden ignoriert.
    applyState(ds.exists() ? ds.data() : { running: null, rev: 0 });
    markSeen("state");
    changed();
  }, onErr("state")));

  unsubs.push(fs.onSnapshot(fs.doc(db, "users", uid, "meta", "settings"), (ds) => {
    if (myGen !== gen) return;
    settings = mergeSettings(ds.exists() ? ds.data() : null);
    markSeen("settings");
    changed();
  }, onErr("settings")));
}

export function stop() {
  gen++;
  if (savePending) flushLocal(); // ausstehende lokale Änderungen nicht verlieren
  for (const u of unsubs) {
    try { u(); } catch (err) { console.warn("Listener-Abmeldung fehlgeschlagen:", err); }
  }
  unsubs = [];
  if (started) {
    started = false;
    resetState(mode);
    changed();
  }
}

// ---------- Abonnieren ----------

export function subscribe(cb) {
  subscribers.add(cb);
  try { cb(get()); } catch (err) { console.error("Store-Abonnent fehlgeschlagen:", err); }
  return () => { subscribers.delete(cb); };
}

export function get() {
  if (!snap) snap = buildSnapshot();
  return snap;
}

// ---------- Schreiben ----------

function requireStarted() {
  if (!started) throw fail(new Error("Datenspeicher ist nicht gestartet."));
}

/** Schreibt im Cloud-Modus per Firestore, im lokalen Modus entprellt in localStorage. */
async function persist(cloudWrite) {
  if (mode === "local") return scheduleLocalSave();
  if (!fb) throw fail(new Error("Noch nicht mit dem Server verbunden."));
  try {
    await cloudWrite(fb.db, fb.fs, user.uid);
  } catch (err) {
    throw fail(err);
  }
}

export async function saveEntry(entry) {
  requireStarted();
  const id = entry?.id || newId("e");
  const data = clean(withoutId(entry));
  entries.set(id, { ...data, id });
  changed();
  await persist((db, fs, uid) => fs.setDoc(fs.doc(db, "users", uid, "entries", id), data));
  return id;
}

export async function deleteEntry(id) {
  requireStarted();
  if (!id) return;
  entries.delete(id);
  changed();
  await persist((db, fs, uid) => fs.deleteDoc(fs.doc(db, "users", uid, "entries", id)));
}

export async function savePlace(place) {
  requireStarted();
  const id = place?.id || newId("p");
  const data = clean(withoutId(place));
  places.set(id, { ...data, id });
  changed();
  await persist((db, fs, uid) => fs.setDoc(fs.doc(db, "users", uid, "places", id), data));
  return id;
}

export async function deletePlace(id) {
  requireStarted();
  if (!id) return;
  places.delete(id);
  changed();
  await persist((db, fs, uid) => fs.deleteDoc(fs.doc(db, "users", uid, "places", id)));
}

export async function setRunning(r) {
  requireStarted();
  const value = r ? clean(r) : null;
  const myRev = nextRev();
  running = value;
  rev = myRev;
  changed();
  await persist((db, fs, uid) =>
    fs.setDoc(fs.doc(db, "users", uid, "meta", "state"), { running: value, rev: myRev }));
}

export async function saveSettings(partial) {
  requireStarted();
  const p = clean(partial || {});
  settings = mergeSettings({ ...settings, ...p });
  changed();
  await persist((db, fs, uid) =>
    fs.setDoc(fs.doc(db, "users", uid, "meta", "settings"), p, { merge: true }));
}
