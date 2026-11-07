// Update 10 E – 📁 Dokumente: Ablage der Datei-Inhalte.
//   🔒 Neu (verschlüsselt): Cloud → users/{uid}/a_doc_files/{fileId}_{n} = { id, n, total, iv, ct }  (putEnc/getEnc/delEnc;
//      Chiffretext aus vault-crypto.encryptFile, fileId zufällig). Klartext-Bytes landen hier nie mehr.
//   Alt (Klartext, nur noch lesen + löschen für die Umstellung): {docId}_{n} = { id, n, total, data } (base64-Stücke)
//   lokal → IndexedDB „stempelkarte-docs“, Store „chunks“ (gleiches Format)
// Nicht im Backup (backup-core EXCLUDE_EXACT) – genau wie a_school_files. Bilder werden vor dem Speichern verkleinert.
import * as store from "../store.js";
import { getFirebase } from "../firebase.js";
import { MAX_BYTES, splitChunks, fmtSize } from "./dokumente-core.js";

const COL = "a_doc_files";
const IDB_NAME = "stempelkarte-docs";
const IDB_STORE = "chunks";

let idbP = null;
function idb() {
  if (!idbP) {
    idbP = new Promise((res, rej) => {
      if (typeof indexedDB === "undefined") { rej(new Error("Kein Gerätespeicher für Dateien verfügbar.")); return; }
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("Dateispeicher konnte nicht geöffnet werden."));
    }).catch((e) => { idbP = null; throw e; });
  }
  return idbP;
}
function idbTx(mode, fn) {
  return idb().then((db) => new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, mode);
    const out = [];
    fn(tx.objectStore(IDB_STORE), out);
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error || new Error("Dateispeicher-Fehler"));
    tx.onabort = () => rej(tx.error || new Error("Dateispeicher voll?"));
  }));
}
const isLocal = () => store.get().mode === "local";
async function cloud() {
  const s = store.get();
  const uid = s.user && s.user.uid;
  if (!uid) throw new Error("Nicht angemeldet.");
  const f = await getFirebase();
  if (!f) throw new Error("Keine Verbindung.");
  return { db: f.db, fs: f.fs, uid };
}
const chunkId = (id, n) => `${id}_${n}`;

/* ---------- 🔒 verschlüsselte Stücke ---------- */
const encClean = (c) => ({ id: String(c.id), n: c.n, total: c.total, iv: String(c.iv), ct: String(c.ct) });
/** Verschlüsselte Stücke speichern (nur Ausgaben von vault-crypto.encryptFile). Cloud: { upload } läuft im Hintergrund. */
export async function putEnc(chunks) {
  if (isLocal()) { await idbTx("readwrite", (os) => { for (const c of chunks) os.put(encClean(c)); }); return { upload: Promise.resolve() }; }
  const { db, fs, uid } = await cloud();
  return { upload: Promise.all(chunks.map((c) => fs.setDoc(fs.doc(db, "users", uid, COL, c.id), encClean(c)))) };
}
/** → Stücke (Chiffretext) oder null, wenn welche fehlen. */
export async function getEnc(fileId, total) {
  const n = Math.max(1, Number(total) || 1);
  if (isLocal()) {
    const got = await idbTx("readonly", (os, out) => { for (let i = 0; i < n; i++) { const r = os.get(chunkId(fileId, i)); r.onsuccess = () => { out[i] = r.result; }; } });
    return got.length < n || got.some((x) => !x || !x.ct) ? null : got;
  }
  const { db, fs, uid } = await cloud();
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) => fs.getDoc(fs.doc(db, "users", uid, COL, chunkId(fileId, i)))));
  if (snaps.some((x) => !x.exists())) return null;
  return snaps.map((x) => x.data());
}
export const delEnc = (fileId, total) => (fileId ? delFile(fileId, total) : Promise.resolve());

/** ALT (Klartext) – nur noch für Tests/Altbestand. dataURL speichern → Anzahl Stücke. Cloud: lokal sofort zurück, Upload läuft im Hintergrund (offline: später). */
export async function putFile(id, dataURL) {
  const b64 = String(dataURL).slice(String(dataURL).indexOf(",") + 1);
  const parts = splitChunks(b64);
  const docs = parts.map((data, n) => ({ id: chunkId(id, n), n, total: parts.length, data }));
  if (isLocal()) {
    await idbTx("readwrite", (os) => { for (const d of docs) os.put(d); });
    return { chunks: docs.length, upload: Promise.resolve() };
  }
  const { db, fs, uid } = await cloud();
  const upload = Promise.all(docs.map((d) => fs.setDoc(fs.doc(db, "users", uid, COL, d.id), d)));
  return { chunks: docs.length, upload };
}

/** → base64 (ohne Kopf) oder null. */
export async function getB64(id, total) {
  const n = Math.max(1, Number(total) || 1);
  if (isLocal()) {
    const got = await idbTx("readonly", (os, out) => { for (let i = 0; i < n; i++) { const r = os.get(chunkId(id, i)); r.onsuccess = () => { out[i] = r.result; }; } });
    if (got.length < n || got.some((x) => !x)) return null;
    return got.map((x) => x.data).join("");
  }
  const { db, fs, uid } = await cloud();
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) => fs.getDoc(fs.doc(db, "users", uid, COL, chunkId(id, i)))));
  if (snaps.some((s) => !s.exists())) return null;
  return snaps.map((s) => s.data().data).join("");
}

export async function delFile(id, total) {
  const n = Math.max(1, Number(total) || 1);
  if (isLocal()) { await idbTx("readwrite", (os) => { for (let i = 0; i < n; i++) os.delete(chunkId(id, i)); }); return; }
  const { db, fs, uid } = await cloud();
  await Promise.all(Array.from({ length: n }, (_, i) => fs.deleteDoc(fs.doc(db, "users", uid, COL, chunkId(id, i)))));
}

export function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: type || "application/octet-stream" });
}

/* ---------- Dateien vorbereiten ---------- */

const readDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
export const dataBytes = (u) => Math.floor(((u.length - u.indexOf(",") - 1) * 3) / 4);
function loadImg(src) {
  return new Promise((res, rej) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const im = new Image();
    im.onload = () => { if (typeof src !== "string") URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { if (typeof src !== "string") URL.revokeObjectURL(url); rej(new Error("Bild konnte nicht gelesen werden.")); };
    im.src = url;
  });
}
function draw(im, max, q) {
  const sc = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}
const IMG_MAX_BYTES = 2.5 * 1024 * 1024; // Fotos: gut lesbar, aber nicht riesig

/** File → { data (dataURL), type, size, thumb? } oder Error mit freundlichem Text. */
export async function prepareFile(file) {
  if (/^image\//.test(file.type) && !/svg/.test(file.type)) {
    const im = await loadImg(file);
    let max = 2400, q = 0.85, data = draw(im, max, q);
    while (dataBytes(data) > IMG_MAX_BYTES && max > 600) { max = Math.round(max * 0.8); q = Math.max(0.55, q - 0.05); data = draw(im, max, q); }
    return { data, type: "image/jpeg", size: dataBytes(data), thumb: draw(im, 200, 0.7) };
  }
  if (file.size > MAX_BYTES) throw new Error(`Die Datei ist ${fmtSize(file.size)} groß – erlaubt sind höchstens ${fmtSize(MAX_BYTES)}. Tipp: PDF verkleinern oder Seiten als Fotos speichern. 📸`);
  if (!file.size) throw new Error("Die Datei ist leer.");
  const data = await readDataURL(file);
  return { data, type: file.type || "application/octet-stream", size: file.size };
}

/** Für „🤖 Text erkennen“: Bild auf ≤ 1600 px / ≈ 1 MB JPEG → { type, data (base64) } */
export async function ocrImage(dataURL) {
  const im = await loadImg(dataURL);
  let max = 1600, q = 0.82, data = draw(im, max, q);
  while (data.length > 1_400_000 && max > 600) { max = Math.round(max * 0.8); data = draw(im, max, q); }
  return { type: "image/jpeg", data: data.replace(/^data:[^,]*,/, "") };
}
