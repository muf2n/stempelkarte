// Update 9 (Agent C): Fotos pro Baustelle.
// Firebase Storage gibt es nicht → Fotos werden verkleinert als JPEG-dataURL gespeichert:
//   Cloud-Modus: Firestore users/{uid}/photos/{id} (NICHT im Haupt-Snapshot, nur gezielte Abfragen)
//   Lokaler Modus: IndexedDB „stempelkarte-photos“
// Form: { id, ts, dayKey, placeId|null, place, entryId|null, note, w, h, data, thumb }
import * as store from "./store.js";
import { getFirebase } from "./firebase.js";
import { newId, dayKey as toDayKey } from "./util.js";

const MAX_SIDE = 1280;
const THUMB_SIDE = 240;
const QUALITY = 0.7;
const TARGET_CHARS = 350000;   // Ziel für data (Länge der dataURL ≈ Bytes in Firestore)
const NET_WAIT_MS = 5000;      // so lange auf den Server warten, dann Offline-Cache / Warteschlange

const IDB_NAME = "stempelkarte-photos";
const IDB_STORE = "photos";

/* ---------- Änderungs-Benachrichtigung ---------- */

const listeners = new Set();
/** cb(info) bei jeder Änderung (add/delete/note); gibt eine Abmeldefunktion zurück. */
export function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(info) {
  for (const cb of [...listeners]) { try { cb(info); } catch (e) { console.error(e); } }
}

/* ---------- Speicher-Cache (vermeidet erneutes Laden großer Dokumente) ---------- */

const mem = new Map(); // id → photo (aktueller Modus/Nutzer)
let memOwner = "";

function owner() {
  const s = store.get();
  return s.mode === "cloud" ? "c:" + ((s.user && s.user.uid) || "") : "local";
}
function syncOwner() {
  const o = owner();
  if (o !== memOwner) { mem.clear(); memOwner = o; }
}

/* ---------- Normalisieren ---------- */

function norm(p) {
  if (!p || typeof p !== "object") return null;
  const ts = Number(p.ts) || 0;
  return {
    id: String(p.id || ""),
    ts,
    dayKey: /^\d{4}-\d{2}-\d{2}$/.test(String(p.dayKey || "")) ? p.dayKey : (ts ? toDayKey(ts) : ""),
    placeId: p.placeId ? String(p.placeId) : null,
    place: String(p.place || ""),
    entryId: p.entryId ? String(p.entryId) : null,
    note: String(p.note || ""),
    w: Number(p.w) || 0,
    h: Number(p.h) || 0,
    data: typeof p.data === "string" ? p.data : "",
    thumb: typeof p.thumb === "string" ? p.thumb : "",
  };
}
const byTs = (a, b) => a.ts - b.ts;

/* ---------- IndexedDB (lokaler Modus) ---------- */

let idbPromise = null;
function idb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Kein Speicher für Fotos verfügbar.")); return; }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const os = db.createObjectStore(IDB_STORE, { keyPath: "id" });
        os.createIndex("dayKey", "dayKey");
        os.createIndex("placeId", "placeId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Fotospeicher konnte nicht geöffnet werden."));
    req.onblocked = () => reject(new Error("Fotospeicher ist blockiert – bitte andere Tabs schließen."));
  }).catch((e) => { idbPromise = null; throw e; });
  return idbPromise;
}

function idbReq(mode, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const os = tx.objectStore(IDB_STORE);
    let out;
    const r = fn(os);
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error || new Error("Fotospeicher-Fehler"));
    tx.onabort = () => reject(tx.error || new Error("Fotospeicher-Fehler (Speicher voll?)"));
  }));
}

/* ---------- Firestore (Cloud-Modus) ---------- */

async function cloud() {
  const s = store.get();
  const uid = s.user && s.user.uid;
  if (!uid) throw new Error("Nicht angemeldet.");
  const f = await getFirebase();
  if (!f) throw new Error("Firebase ist nicht konfiguriert.");
  return { db: f.db, fs: f.fs, uid };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((res) => setTimeout(() => res(TIMEOUT), ms))]);
}
const TIMEOUT = Symbol("timeout");

async function cloudQuery(field, op, value, op2, value2) {
  const { db, fs, uid } = await cloud();
  const col = fs.collection(db, "users", uid, "photos");
  const cons = [fs.where(field, op, value)];
  if (op2) cons.push(fs.where(field, op2, value2));
  const q = fs.query(col, ...cons);
  let qs = null;
  try {
    qs = await withTimeout(fs.getDocs(q), NET_WAIT_MS);
  } catch (e) {
    if (e && e.code === "permission-denied") throw e;
    qs = TIMEOUT;
  }
  if (qs === TIMEOUT) {
    try { qs = await fs.getDocsFromCache(q); } catch { qs = null; }
  }
  const out = [];
  if (qs) qs.forEach((d) => { const p = norm({ ...d.data(), id: d.id }); if (p) out.push(p); });
  return out;
}

/* ---------- Bild verkleinern ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Das Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}

function draw(img, srcW, srcH, maxSide, quality) {
  const k = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * k));
  const h = Math.max(1, Math.round(srcH * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";            // transparente PNGs nicht schwarz werden lassen
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  return { data: cv.toDataURL("image/jpeg", quality), w, h };
}

/** Datei → { data, thumb, w, h } (JPEG, längste Seite ≤ 1280 px, data möglichst < 350 kB). */
export async function processImage(file) {
  if (!file) throw new Error("Kein Bild gewählt.");
  if (file.type && !/^image\//i.test(file.type)) throw new Error("Das ist kein Bild.");
  const { img, url } = await loadImage(file);
  try {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (!W || !H) throw new Error("Das Bild ist leer.");
    let side = MAX_SIDE, q = QUALITY;
    let out = draw(img, W, H, side, q);
    for (let i = 0; i < 8 && out.data.length > TARGET_CHARS; i++) {
      if (q > 0.55) q = Math.round((q - 0.1) * 100) / 100;
      else side = Math.round(side * 0.82);
      out = draw(img, W, H, side, q);
    }
    const th = draw(img, W, H, THUMB_SIDE, 0.7);
    return { data: out.data, w: out.w, h: out.h, thumb: th.data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- öffentliche Funktionen ---------- */

/**
 * Foto speichern. meta: { dayKey?, placeId?, place?, entryId?, note?, ts? } – oder bereits verarbeitet
 * ({ processed: {data, thumb, w, h} }). Gibt { photo, queued } zurück (queued = wartet auf Netz).
 */
export async function addPhoto(file, meta = {}) {
  syncOwner();
  const img = meta.processed || await processImage(file);
  const ts = Number(meta.ts) || Date.now();
  const photo = norm({
    id: newId("ph"),
    ts,
    dayKey: meta.dayKey || toDayKey(ts),
    placeId: meta.placeId || null,
    place: meta.place || "",
    entryId: meta.entryId || null,
    note: String(meta.note || "").trim().slice(0, 500),
    w: img.w, h: img.h, data: img.data, thumb: img.thumb,
  });
  let queued = false;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const { id, ...rest } = photo;
    const p = fs.setDoc(fs.doc(db, "users", uid, "photos", id), { id, ...rest });
    // Offline bestätigt Firestore erst, wenn das Netz wieder da ist – die Warteschlange sendet später.
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) { queued = true; p.catch((e) => console.error("Foto-Upload fehlgeschlagen:", e)); }
  } else {
    await idbReq("readwrite", (os) => os.put(photo));
  }
  mem.set(photo.id, photo);
  emit({ type: "add", photo });
  return { photo, queued };
}

function mergeMem(list, pred) {
  const map = new Map(list.map((p) => [p.id, p]));
  for (const p of mem.values()) if (pred(p) && !map.has(p.id)) map.set(p.id, p);
  for (const p of map.values()) mem.set(p.id, p);
  return [...map.values()].filter((p) => !deleted.has(p.id)).sort(byTs);
}
const deleted = new Set();

/** Fotos eines Tages (dayKey "YYYY-MM-DD"), älteste zuerst. */
export async function listByDay(dayKey) {
  syncOwner();
  const k = String(dayKey || "");
  let list;
  if (store.get().mode === "cloud") list = await cloudQuery("dayKey", "==", k);
  else list = ((await idbReq("readonly", (os) => os.index("dayKey").getAll(k))) || []).map(norm);
  return mergeMem(list, (p) => p.dayKey === k);
}

/** Fotos eines gespeicherten Orts, älteste zuerst. */
export async function listByPlace(placeId) {
  syncOwner();
  const id = String(placeId || "");
  if (!id) return [];
  let list;
  if (store.get().mode === "cloud") list = await cloudQuery("placeId", "==", id);
  else list = ((await idbReq("readonly", (os) => os.index("placeId").getAll(id))) || []).map(norm);
  return mergeMem(list, (p) => p.placeId === id);
}

/**
 * Foto-Anzahl je Tag für eine Liste von dayKeys → { dayKey: n } (nur Tage mit Fotos).
 * Cloud: Zähl-Abfrage je Tag (lädt keine Bilder); offline nur, was schon bekannt ist.
 */
export async function countByDays(dayKeys) {
  syncOwner();
  const keys = [...new Set((dayKeys || []).map(String))];
  const out = {};
  if (store.get().mode === "cloud") {
    let c = null;
    try { c = await cloud(); } catch { c = null; }
    await Promise.all(keys.map(async (k) => {
      let n = null;
      if (c && c.fs.getCountFromServer) {
        try {
          const q = c.fs.query(c.fs.collection(c.db, "users", c.uid, "photos"), c.fs.where("dayKey", "==", k));
          const r = await withTimeout(c.fs.getCountFromServer(q), NET_WAIT_MS);
          if (r !== TIMEOUT) n = r.data().count;
        } catch { n = null; }
      }
      if (n === null) n = [...mem.values()].filter((p) => p.dayKey === k && !deleted.has(p.id)).length;
      if (n) out[k] = n;
    }));
  } else {
    await Promise.all(keys.map(async (k) => {
      const n = await idbReq("readonly", (os) => os.index("dayKey").count(k));
      if (n) out[k] = n;
    }));
  }
  return out;
}

/** Foto löschen. */
export async function deletePhoto(id) {
  syncOwner();
  const pid = String(id || "");
  if (!pid) return;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const p = fs.deleteDoc(fs.doc(db, "users", uid, "photos", pid));
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) p.catch((e) => console.error("Foto löschen fehlgeschlagen:", e));
  } else {
    await idbReq("readwrite", (os) => os.delete(pid));
  }
  const old = mem.get(pid) || null;
  mem.delete(pid);
  deleted.add(pid);
  emit({ type: "delete", id: pid, photo: old });
}

/** Notiz eines Fotos ändern. */
export async function updateNote(id, note) {
  syncOwner();
  const pid = String(id || "");
  const text = String(note || "").trim().slice(0, 500);
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const p = fs.setDoc(fs.doc(db, "users", uid, "photos", pid), { note: text }, { merge: true });
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) p.catch((e) => console.error("Foto-Notiz speichern fehlgeschlagen:", e));
  } else {
    const cur = await idbReq("readonly", (os) => os.get(pid));
    if (!cur) throw new Error("Foto nicht gefunden.");
    await idbReq("readwrite", (os) => os.put({ ...cur, note: text }));
  }
  const m = mem.get(pid);
  if (m) m.note = text;
  emit({ type: "note", id: pid, note: text });
}

/** dataURL → File (zum Teilen). */
export function photoFile(photo) {
  const src = (photo && (photo.data || photo.thumb)) || "";
  const m = src.match(/^data:([^;,]+);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const d = new Date(photo.ts || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  const name = `Foto_${photo.dayKey || "x"}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
  try { return new File([arr], name, { type: m[1] }); } catch { return null; }
}
