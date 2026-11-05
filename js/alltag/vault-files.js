// Alltag › Passwort-Tresor › Dokumente: Ablage der VERSCHLÜSSELTEN Datei-Stücke + Bild-Verkleinerung.
//   Cloud → users/{uid}/a_vault_files/{fileId}_{n} = { id, n, total, iv, ct }   (einzeln gelesen, kein Listener)
//   lokal → IndexedDB „stempelkarte-vault“, Store „chunks“ (gleiches Format)
// Hier landet NIE Klartext: putChunks bekommt nur Ausgaben von vault-crypto.encryptFile.
// Entschlüsselte Bytes leben nur im Speicher (Blob/Object-URL), nie in IndexedDB, Cache Storage oder dem Service Worker.
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import { IMG_MAX_SIDE, IMG_QUALITY, THUMB_SIDE, THUMB_QUALITY, PDF_MAX, fitSize, fmtSize } from "./vault-docs-core.js";

const COL = "a_vault_files";
const IDB_NAME = "stempelkarte-vault";
const IDB_STORE = "chunks";
const NET_WAIT_MS = 5000;
const TIMEOUT = Symbol("timeout");
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(TIMEOUT), ms))]);

/* ---------- IndexedDB (lokaler Modus) ---------- */

let idbP = null;
function idb() {
  if (!idbP) {
    idbP = new Promise((res, rej) => {
      if (typeof indexedDB === "undefined") { rej(new Error("Kein Gerätespeicher für Dateien verfügbar.")); return; }
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("Dateispeicher konnte nicht geöffnet werden."));
      r.onblocked = () => rej(new Error("Dateispeicher ist blockiert – bitte andere Tabs schließen."));
    }).catch((e) => { idbP = null; throw e; });
  }
  return idbP;
}
function idbTx(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, mode);
    const os = tx.objectStore(IDB_STORE);
    const out = [];
    fn(os, out);
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error || new Error("Dateispeicher-Fehler"));
    tx.onabort = () => rej(tx.error || new Error("Dateispeicher-Fehler (Speicher voll?)"));
  }));
}

/* ---------- Firestore (Cloud) ---------- */

async function cloud() {
  const s = store.get();
  const uid = s.user && s.user.uid;
  if (!uid) throw new Error("Nicht angemeldet.");
  const f = await getFirebase();
  if (!f) throw new Error("Keine Verbindung.");
  return { db: f.db, fs: f.fs, uid };
}
const isLocal = () => store.get().mode === "local";
const clean = (c) => ({ id: String(c.id), n: c.n, total: c.total, iv: String(c.iv), ct: String(c.ct) });

/** Verschlüsselte Stücke speichern. → { queued } (Cloud offline: Firestore sendet später). */
export async function putChunks(chunks) {
  if (isLocal()) {
    await idbTx("readwrite", (os) => { for (const c of chunks) os.put(clean(c)); });
    return { queued: false };
  }
  const { db, fs, uid } = await cloud();
  const ps = chunks.map((c) => fs.setDoc(fs.doc(db, "users", uid, COL, c.id), clean(c)));
  const all = Promise.all(ps);
  const r = await withTimeout(all, NET_WAIT_MS * 2);
  if (r === TIMEOUT) { all.catch((e) => console.error("Tresor-Datei hochladen:", e)); return { queued: true }; }
  return { queued: false };
}

/** Stücke einer Datei lesen (Chiffretext) – nur beim Öffnen. */
export async function getChunks(fileId, total) {
  const ids = Array.from({ length: total }, (_, n) => `${fileId}_${n}`);
  if (isLocal()) {
    return idbTx("readonly", (os, out) => { for (const id of ids) { const r = os.get(id); r.onsuccess = () => { if (r.result) out.push(r.result); }; } });
  }
  const { db, fs, uid } = await cloud();
  const docs = await Promise.all(ids.map(async (id) => {
    const ref = fs.doc(db, "users", uid, COL, id);
    let d;
    try { d = await withTimeout(fs.getDoc(ref), NET_WAIT_MS * 2); } catch (e) { if (e && e.code === "permission-denied") throw e; d = TIMEOUT; }
    if (d === TIMEOUT) { try { d = await fs.getDocFromCache(ref); } catch { d = null; } }
    return d && d.exists && d.exists() ? d.data() : null;
  }));
  return docs.filter(Boolean);
}

export async function deleteChunks(fileId, total) {
  if (!fileId) return;
  const ids = Array.from({ length: Math.max(1, total || 1) }, (_, n) => `${fileId}_${n}`);
  if (isLocal()) { await idbTx("readwrite", (os) => { for (const id of ids) os.delete(id); }); return; }
  const { db, fs, uid } = await cloud();
  const all = Promise.all(ids.map((id) => fs.deleteDoc(fs.doc(db, "users", uid, COL, id))));
  const r = await withTimeout(all, NET_WAIT_MS);
  if (r === TIMEOUT) all.catch((e) => console.error("Tresor-Datei löschen:", e));
}

/** Alle Datei-Stücke löschen (Tresor löschen/neu anlegen). Cloud: liest die Sammlung einmal. */
export async function wipeAll() {
  if (isLocal()) { await idbTx("readwrite", (os) => { os.clear(); }); return; }
  const { db, fs, uid } = await cloud();
  const qs = await withTimeout(fs.getDocs(fs.collection(db, "users", uid, COL)), 20000);
  if (qs === TIMEOUT) return;
  const ps = [];
  qs.forEach((d) => ps.push(fs.deleteDoc(d.ref)));
  await withTimeout(Promise.all(ps), NET_WAIT_MS);
}

/* ---------- Dateien vorbereiten (nur im Speicher) ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Das Bild konnte nicht gelesen werden.")); };
    img.src = url;
  });
}

function toBytes(canvas, q) {
  return new Promise((res, rej) => canvas.toBlob((b) => {
    if (!b) { rej(new Error("Bild konnte nicht umgewandelt werden.")); return; }
    b.arrayBuffer().then((ab) => res(new Uint8Array(ab)), rej);
  }, "image/jpeg", q));
}

async function draw(img, W, H, max, q) {
  const { w, h } = fitSize(W, H, max);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, w, h);
  const bytes = await toBytes(cv, q);
  cv.width = cv.height = 0;
  return { bytes, w, h };
}

/**
 * Datei → { kind: "image"|"pdf", name, mime, bytes, size, w, h, thumb? (Uint8Array) }.
 * Bilder: JPEG, längste Seite 2000 px, Qualität 0,85 (neu gezeichnet → EXIF/GPS fallen weg). PDFs: max. 5 MB, unverändert.
 */
export async function prepareFile(file) {
  const type = String(file.type || "").toLowerCase();
  const isPdf = type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (isPdf) {
    if (file.size > PDF_MAX) throw new Error(`„${file.name}“ ist ${fmtSize(file.size)} groß – PDFs dürfen höchstens 5 MB haben. Tipp: „PDF komprimieren“ oder die Seiten fotografieren.`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new Error(`„${file.name}“ ist kein gültiges PDF.`);
    return { kind: "pdf", name: file.name || "Dokument.pdf", mime: "application/pdf", bytes, size: bytes.length, w: 0, h: 0, thumb: null };
  }
  if (!/^image\//.test(type) || /svg/.test(type)) throw new Error(`„${file.name || "Datei"}“: nur Fotos (JPEG, PNG, …) und PDFs.`);
  const { img, url } = await loadImage(file);
  try {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    if (!W || !H) throw new Error("Das Bild ist leer.");
    const big = await draw(img, W, H, IMG_MAX_SIDE, IMG_QUALITY);
    const th = await draw(img, W, H, THUMB_SIDE, THUMB_QUALITY);
    const base = String(file.name || "Foto").replace(/\.[^.]+$/, "") || "Foto";
    return { kind: "image", name: base + ".jpg", mime: "image/jpeg", bytes: big.bytes, size: big.bytes.length, w: big.w, h: big.h, thumb: th.bytes };
  } finally {
    URL.revokeObjectURL(url);
  }
}
