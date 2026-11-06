// Update 9 (Agent C): Fotos pro Baustelle.
// Firebase Storage gibt es nicht → Fotos werden verkleinert als JPEG-dataURL gespeichert:
//   Cloud-Modus: Firestore users/{uid}/photos/{id} (NICHT im Haupt-Snapshot, nur gezielte Abfragen)
//   Lokaler Modus: IndexedDB „stempelkarte-photos“
// Form: { id, ts, dayKey, placeId|null, place, entryId|null, note, w, h, data, thumb }
// Update 9 (Agent S, Galerie): optional { albumIds: [], lat, lng, acc, addr, albMig } und ein schlanker
// Index je Foto (nur Vorschaubild + Metadaten, nie das große Bild):
//   Cloud: users/{uid}/a_photo_index/{id}   Lokal: IndexedDB-Store „index“
// Der Index wird bei add/update/delete mitgeschrieben und für alte Fotos bei Bedarf nachgetragen (ensureIndex).
import * as store from "./store.js";
import { getFirebase } from "./firebase.js";
import { newId, dayKey as toDayKey } from "./util.js";
import { indexDoc, indexDiffers, planBackfill, cleanIds } from "./gallery-core.js";

const MAX_SIDE = 1280;
const THUMB_SIDE = 240;
const QUALITY = 0.7;
const TARGET_CHARS = 350000;   // Ziel für data (Länge der dataURL ≈ Bytes in Firestore)
const NET_WAIT_MS = 5000;      // so lange auf den Server warten, dann Offline-Cache / Warteschlange

const IDB_NAME = "stempelkarte-photos";
const IDB_STORE = "photos";
const IDB_INDEX = "index";      // Update 9 – Galerie
const CLOUD_INDEX = "a_photo_index";

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
    // Update 9 – Galerie (optional, alte Fotos haben das nicht)
    albumIds: cleanIds(p.albumIds),
    lat: fnum(p.lat),
    lng: fnum(p.lng),
    acc: fnum(p.acc),
    addr: String(p.addr || ""),
    albMig: !!p.albMig,
    phase: p.phase === "vorher" || p.phase === "nachher" ? p.phase : null, // Update 10d – Vorher/Nachher (optional)
  };
}
function fnum(v) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
const byTs = (a, b) => a.ts - b.ts;

/* ---------- IndexedDB (lokaler Modus) ---------- */

let idbPromise = null;
function idb() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Kein Speicher für Fotos verfügbar.")); return; }
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const os = db.createObjectStore(IDB_STORE, { keyPath: "id" });
        os.createIndex("dayKey", "dayKey");
        os.createIndex("placeId", "placeId");
      }
      if (!db.objectStoreNames.contains(IDB_INDEX)) db.createObjectStore(IDB_INDEX, { keyPath: "id" }); // Update 9 – Galerie
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Fotospeicher konnte nicht geöffnet werden."));
    req.onblocked = () => reject(new Error("Fotospeicher ist blockiert – bitte andere Tabs schließen."));
  }).catch((e) => { idbPromise = null; throw e; });
  return idbPromise;
}

function idbReq(mode, fn, storeName = IDB_STORE) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const os = tx.objectStore(storeName);
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
    albumIds: meta.albumIds, lat: meta.lat, lng: meta.lng, acc: meta.acc, addr: meta.addr, albMig: !!meta.albMig,
  });
  let queued = false;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const { id, ...rest } = photo;
    const p = fs.setDoc(fs.doc(db, "users", uid, "photos", id), { id, ...rest });
    const pi = fs.setDoc(fs.doc(db, "users", uid, CLOUD_INDEX, id), indexDoc(photo)); // Update 9 – Galerie-Index
    pi.catch((e) => console.error("Foto-Index speichern fehlgeschlagen:", e));
    // Offline bestätigt Firestore erst, wenn das Netz wieder da ist – die Warteschlange sendet später.
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) { queued = true; p.catch((e) => console.error("Foto-Upload fehlgeschlagen:", e)); }
  } else {
    await idbReq("readwrite", (os) => os.put(photo));
    await idbReq("readwrite", (os) => os.put(indexDoc(photo)), IDB_INDEX);
  }
  mem.set(photo.id, photo);
  idxSet(indexDoc(photo));
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
    fs.deleteDoc(fs.doc(db, "users", uid, CLOUD_INDEX, pid)).catch((e) => console.error("Foto-Index löschen fehlgeschlagen:", e));
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) p.catch((e) => console.error("Foto löschen fehlgeschlagen:", e));
  } else {
    await idbReq("readwrite", (os) => os.delete(pid));
    await idbReq("readwrite", (os) => os.delete(pid), IDB_INDEX);
  }
  const old = mem.get(pid) || idx.get(pid) || null;
  mem.delete(pid);
  idx.delete(pid);
  deleted.add(pid);
  emit({ type: "delete", id: pid, photo: old });
}

/** Notiz eines Fotos ändern. */
export async function updateNote(id, note) {
  const text = String(note || "").trim().slice(0, 500);
  await updatePhoto(id, { note: text });
}

/* ---------- Update 9 – Galerie: Teil-Änderungen, Index, Einzel-Laden ---------- */

const UPDATABLE = ["note", "albumIds", "lat", "lng", "acc", "addr", "albMig", "placeId", "place", "phase"]; // Update 10d: phase (vorher/nachher)

/**
 * Felder eines Fotos ändern (note, albumIds, lat, lng, acc, addr, albMig, placeId, place).
 * Schreibt Foto UND Index. Ereignis: { type: "note" } wenn nur die Notiz, sonst { type: "update" }.
 */
export async function updatePhoto(id, partial) {
  syncOwner();
  const pid = String(id || "");
  if (!pid) throw new Error("Foto nicht gefunden.");
  const patch = {};
  for (const k of UPDATABLE) if (partial && Object.prototype.hasOwnProperty.call(partial, k)) patch[k] = partial[k];
  if ("note" in patch) patch.note = String(patch.note || "").trim().slice(0, 500);
  if ("albumIds" in patch) patch.albumIds = cleanIds(patch.albumIds);
  for (const k of ["lat", "lng", "acc"]) if (k in patch) patch[k] = fnum(patch[k]);
  if ("addr" in patch) patch.addr = String(patch.addr || "");
  if ("albMig" in patch) patch.albMig = !!patch.albMig;
  if ("placeId" in patch) patch.placeId = patch.placeId ? String(patch.placeId) : null;
  if ("place" in patch) patch.place = String(patch.place || "");
  if ("phase" in patch) patch.phase = patch.phase === "vorher" || patch.phase === "nachher" ? patch.phase : null; // Update 10d
  const base = mem.get(pid) || idx.get(pid) || null;
  let nextIdx = null;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const p = fs.setDoc(fs.doc(db, "users", uid, "photos", pid), patch, { merge: true });
    // Index: vollständig schreiben, wenn wir ihn kennen (sonst fehlte das Vorschaubild)
    let full = idx.get(pid) || (mem.get(pid) ? indexDoc(mem.get(pid)) : null);
    if (!full) { const ph = await getPhoto(pid).catch(() => null); full = ph ? indexDoc(ph) : null; }
    if (full) {
      nextIdx = indexDoc({ ...full, ...patch });
      fs.setDoc(fs.doc(db, "users", uid, CLOUD_INDEX, pid), nextIdx).catch((e) => console.error("Foto-Index speichern fehlgeschlagen:", e));
    }
    const r = await withTimeout(p, NET_WAIT_MS);
    if (r === TIMEOUT) p.catch((e) => console.error("Foto ändern fehlgeschlagen:", e));
  } else {
    const cur = await idbReq("readonly", (os) => os.get(pid));
    if (!cur) throw new Error("Foto nicht gefunden.");
    const next = norm({ ...cur, ...patch });
    await idbReq("readwrite", (os) => os.put(next));
    nextIdx = indexDoc(next);
    await idbReq("readwrite", (os) => os.put(nextIdx), IDB_INDEX);
  }
  const m = mem.get(pid);
  if (m) Object.assign(m, patch);
  if (nextIdx) idxSet(nextIdx);
  else if (idx.get(pid)) Object.assign(idx.get(pid), patch);
  const onlyNote = Object.keys(patch).length === 1 && "note" in patch;
  if (onlyNote) emit({ type: "note", id: pid, note: patch.note });
  emit({ type: "update", id: pid, patch, photo: idx.get(pid) || m || (base && { ...base, ...patch }) || null });
}

/** Ein Foto vollständig (mit großem Bild) laden – aus dem Speicher, Firestore bzw. IndexedDB. */
export async function getPhoto(id) {
  syncOwner();
  const pid = String(id || "");
  if (!pid) return null;
  const m = mem.get(pid);
  if (m && m.data) return m;
  let p = null;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const ref = fs.doc(db, "users", uid, "photos", pid);
    let d = null;
    try { d = await withTimeout(fs.getDoc(ref), NET_WAIT_MS); } catch (e) { if (e && e.code === "permission-denied") throw e; d = TIMEOUT; }
    if (d === TIMEOUT) { try { d = await fs.getDocFromCache(ref); } catch { d = null; } }
    if (d && d.exists && d.exists()) p = norm({ ...d.data(), id: d.id });
  } else {
    const raw = await idbReq("readonly", (os) => os.get(pid));
    p = raw ? norm(raw) : null;
  }
  if (p) mem.set(pid, p);
  return p;
}

/* Index-Cache */
const idx = new Map(); // id → Index-Dokument
let idxOwner = "";
let idxLoaded = false;
function idxSync() { const o = owner(); if (o !== idxOwner) { idx.clear(); idxOwner = o; idxLoaded = false; } }
function idxSet(d) { idxSync(); if (d && d.id && !deleted.has(d.id)) idx.set(d.id, d); }

/**
 * Alle Fotos als schlanke Index-Liste (neueste zuerst) – lädt NIE die großen Bilder.
 * opts.refresh = true → neu vom Server/aus IndexedDB.
 */
export async function listIndex(opts = {}) {
  syncOwner(); idxSync();
  if (idxLoaded && !opts.refresh) return [...idx.values()].filter((x) => !deleted.has(x.id)).sort((a, b) => b.ts - a.ts);
  const own = idxOwner;
  let list = [];
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const col = fs.collection(db, "users", uid, CLOUD_INDEX);
    let qs = null;
    try { qs = await withTimeout(fs.getDocs(col), NET_WAIT_MS * 2); } catch (e) { if (e && e.code === "permission-denied") throw e; qs = TIMEOUT; }
    if (qs === TIMEOUT) { try { qs = await fs.getDocsFromCache(col); } catch { qs = null; } }
    if (qs) qs.forEach((d) => { const x = indexDoc({ ...d.data(), id: d.id }); if (x) list.push(x); });
  } else {
    list = ((await idbReq("readonly", (os) => os.getAll(), IDB_INDEX)) || []).map(indexDoc).filter(Boolean);
  }
  if (own !== owner()) return [];
  idx.clear();
  for (const x of list) if (!deleted.has(x.id)) idx.set(x.id, x);
  for (const p of mem.values()) if (!idx.has(p.id) && !deleted.has(p.id)) idx.set(p.id, indexDoc(p)); // frisch aufgenommen, Index noch unterwegs
  idxLoaded = true;
  return [...idx.values()].sort((a, b) => b.ts - a.ts);
}

/**
 * Fehlende Index-Einträge alter Fotos nachtragen (einmal pro Gerät/Konto, danach nur bei Abweichung).
 * Cloud: vergleicht zuerst die Anzahl (Zähl-Abfrage, lädt keine Bilder); nur wenn sie abweicht,
 * werden die Fotos einmal vollständig gelesen. → Anzahl nachgetragener Einträge.
 */
export async function ensureIndex() {
  syncOwner(); idxSync();
  const own = owner();
  let added = 0;
  if (store.get().mode === "cloud") {
    const { db, fs, uid } = await cloud();
    const pc = fs.collection(db, "users", uid, "photos");
    const ic = fs.collection(db, "users", uid, CLOUD_INDEX);
    let nP = null, nI = null;
    try {
      const [a, b] = await Promise.all([withTimeout(fs.getCountFromServer(pc), NET_WAIT_MS), withTimeout(fs.getCountFromServer(ic), NET_WAIT_MS)]);
      if (a !== TIMEOUT && b !== TIMEOUT) { nP = a.data().count; nI = b.data().count; }
    } catch { nP = null; }
    if (nP === null || nP === nI) return 0; // offline oder schon vollständig
    const [qp, qi] = await Promise.all([withTimeout(fs.getDocs(pc), 30000), withTimeout(fs.getDocs(ic), 15000)]);
    if (qp === TIMEOUT || qi === TIMEOUT) return 0;
    const photosById = new Map();
    qp.forEach((d) => { const p = norm({ ...d.data(), id: d.id }); if (p) photosById.set(p.id, p); });
    const iIds = []; qi.forEach((d) => iIds.push(d.id));
    const plan = planBackfill([...photosById.keys()], iIds);
    for (const id of plan.missing) {
      const d = indexDoc(photosById.get(id));
      fs.setDoc(fs.doc(db, "users", uid, CLOUD_INDEX, id), d).catch((e) => console.error("Index nachtragen:", e));
      if (own === owner()) idxSet(d);
      added++;
    }
    for (const id of plan.orphans) {
      fs.deleteDoc(fs.doc(db, "users", uid, CLOUD_INDEX, id)).catch(() => {});
      idx.delete(id);
    }
  } else {
    const pIds = (await idbReq("readonly", (os) => os.getAllKeys())) || [];
    const iIds = (await idbReq("readonly", (os) => os.getAllKeys(), IDB_INDEX)) || [];
    const plan = planBackfill(pIds, iIds);
    for (const id of plan.missing) {
      const raw = await idbReq("readonly", (os) => os.get(id));
      const d = raw ? indexDoc(norm(raw)) : null;
      if (!d) continue;
      await idbReq("readwrite", (os) => os.put(d), IDB_INDEX);
      idxSet(d);
      added++;
    }
    for (const id of plan.orphans) { await idbReq("readwrite", (os) => os.delete(id), IDB_INDEX); idx.delete(id); }
  }
  return added;
}

/** Interner Prüfer: weicht der Index vom Foto ab? (für Tests/Reparatur) */
export function indexOutdated(photo) { return indexDiffers(indexDoc(photo), idx.get(photo && photo.id)); }

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
