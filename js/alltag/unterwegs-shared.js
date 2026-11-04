// Unterwegs – gemeinsame Helfer mit DOM/Netz: Bildablage (travel_images), Bild verkleinern, Buchung in Geld, Teilen.
//
// Bilder (Reise-Titelbild, Parkplatz-Foto) liegen in einer EIGENEN Ablage und werden nur bei Bedarf einzeln gelesen:
//   Cloud → users/{uid}/a_travel_images/{id} = { id, data }   (getDoc, kein Listener)
//   lokal → IndexedDB „stempelkarte-unterwegs“, Store „images“ (localStorage wäre zu klein)
import { getFirebase } from "../firebase.js";
import * as store from "../store.js";
import { collection } from "./db.js";
import { esc } from "../util.js";

/* ---------- Bildablage ---------- */

let idbP = null;
function idb() {
  if (!idbP) {
    idbP = new Promise((res, rej) => {
      const r = indexedDB.open("stempelkarte-unterwegs", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("images", { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { idbP = null; rej(r.error); };
    });
  }
  return idbP;
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction("images", mode);
    const req = fn(tx.objectStore("images"));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("abgebrochen"));
  });
}
function where() {
  const s = store.get();
  if (s.mode === "local") return { local: true, key: "local" };
  if (s.user && s.user.uid) return { uid: s.user.uid, key: s.user.uid };
  throw new Error("Nicht angemeldet.");
}
const cache = new Map(); // key+id → dataURL | Promise

export async function putImage(id, data) {
  const w = where();
  cache.set(w.key + ":" + id, data);
  if (w.local) return idbDo("readwrite", (st) => st.put({ id, data }));
  const f = await getFirebase();
  if (!f) throw new Error("Keine Verbindung.");
  return f.fs.setDoc(f.fs.doc(f.db, "users", w.uid, "a_travel_images", id), { id, data, updated: Date.now() });
}
export function getImage(id) {
  if (!id) return Promise.resolve(null);
  let w;
  try { w = where(); } catch { return Promise.resolve(null); }
  const k = w.key + ":" + id;
  if (cache.has(k)) return Promise.resolve(cache.get(k));
  const p = (async () => {
    try {
      if (w.local) { const r = await idbDo("readonly", (st) => st.get(id)); return r ? r.data : null; }
      const f = await getFirebase();
      if (!f) return null;
      const d = await f.fs.getDoc(f.fs.doc(f.db, "users", w.uid, "a_travel_images", id));
      return d.exists() ? d.data().data : null;
    } catch (err) { console.warn("Bild laden:", err); return null; }
  })();
  cache.set(k, p);
  p.then((v) => { if (v) cache.set(k, v); else cache.delete(k); });
  return p;
}
/** Synchron, falls schon im Speicher. */
export function cachedImage(id) {
  try { const v = cache.get(where().key + ":" + id); return typeof v === "string" ? v : null; } catch { return null; }
}
export async function delImage(id) {
  if (!id) return;
  const w = where();
  cache.delete(w.key + ":" + id);
  if (w.local) return idbDo("readwrite", (st) => st.delete(id));
  const f = await getFirebase();
  if (!f) return;
  return f.fs.deleteDoc(f.fs.doc(f.db, "users", w.uid, "a_travel_images", id));
}

/* ---------- Bild verkleinern ---------- */

export const dataBytes = (u) => Math.floor(((u.length - u.indexOf(",") - 1) * 3) / 4);
function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Das Bild konnte nicht gelesen werden.")); };
    im.src = url;
  });
}
function draw(im, max, q) {
  const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;
  const s = Math.min(1, max / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(W * s)); c.height = Math.max(1, Math.round(H * s));
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = "high";
  g.drawImage(im, 0, 0, c.width, c.height);
  return { data: c.toDataURL("image/jpeg", q), w: c.width, h: c.height };
}
/** Datei → { data, w, h, bytes } als JPEG, längste Seite ≤ maxSide, möglichst < maxBytes. */
export async function shrinkImage(file, { maxSide = 1280, maxBytes = 300 * 1024, quality = 0.8 } = {}) {
  if (!file) throw new Error("Kein Bild gewählt.");
  if (file.type && !/^image\//i.test(file.type)) throw new Error("Das ist kein Bild.");
  const im = await loadImg(file);
  let side = maxSide, q = quality, out = draw(im, side, q);
  for (let i = 0; i < 10 && dataBytes(out.data) > maxBytes; i++) {
    if (q > 0.56) q = Math.round((q - 0.08) * 100) / 100;
    else side = Math.round(side * 0.82);
    out = draw(im, side, q);
  }
  return { ...out, bytes: dataBytes(out.data) };
}

/* ---------- In Geld buchen ---------- */

const MONEY_CATS = {
  reisen: { id: "reisen", name: "Reisen", emoji: "✈️", color: "#0d9488", type: "out" },
  auto: { id: "auto", name: "Auto & Tanken", emoji: "⛽", color: "#0ea5e9", type: "out" },
};

/** Fehlt die Kategorie in money_cats (eigene Kategorien schon angelegt), wird sie ergänzt. */
async function ensureMoneyCat(catId) {
  const cats = collection("money_cats");
  const all = cats.all();
  if (!cats.loaded || !all.length || cats.get(catId)) return; // leer → Geld legt Standard-Kategorien (inkl. Reisen) selbst an
  const c = MONEY_CATS[catId];
  if (c) await cats.put({ ...c, order: catId === "reisen" ? 13.5 : 2 });
}

/** Legt/aktualisiert eine Buchung in Geld (money_tx) an. Feste ID → nie doppelt. */
export async function bookMoney(id, { date, amount, category, note }) {
  await ensureMoneyCat(category);
  const tx = collection("money_tx");
  const cur = tx.get(id) || {};
  await tx.put({ ...cur, id, date, amount: Math.round(Number(amount) * 100) / 100, type: "out", category, note, src: "unterwegs" });
  return id;
}
export async function unbookMoney(id) {
  if (!id) return;
  const tx = collection("money_tx");
  tx.all(); // laden
  await tx.remove(id);
}

/* ---------- Teilen ---------- */

export async function shareText(ui, title, text) {
  try {
    if (navigator.share) { await navigator.share({ title, text }); return; }
  } catch (err) { if (err && err.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); ui.toast("Text kopiert – jetzt z. B. in WhatsApp einfügen"); }
  catch {
    ui.openSheet({ title: "Zum Kopieren", bodyHTML: `<textarea readonly rows="12" style="font-family:var(--f-mono);font-size:.85rem">${esc(text)}</textarea>`, onMount(s) { const t = s.querySelector("textarea"); t.focus(); t.select(); } });
  }
}

export async function safeWrite(ui, p, okMsg) {
  try { await p; if (okMsg) ui.toast(okMsg); return true; }
  catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err && err.message || err), 4000); return false; }
}
