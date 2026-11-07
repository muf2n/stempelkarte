// Update 10 – 🔒 Dokumente: entschlüsselter Arbeitsstand (nur im Speicher, nur solange der Tresor entsperrt ist).
// Wird von 📁 Dokumente, der globalen Suche, den 📎-Listen (Baustelle/Vertrag/Inventar/Kontakt) gemeinsam genutzt.
// Beim Sperren: Cache weg, alle Object-URLs widerrufen. Nach dem Entsperren: alte Klartext-Dokumente automatisch umstellen
// (dokumente-crypt.migrateOne – erst verschlüsselt schreiben, prüfen, dann Klartext löschen; wiederholbar über enc: 1).
import { collection } from "./db.js";
import * as Sess from "./vault-session.js";
import * as V from "./vault-crypto.js";
import * as E from "./dokumente-crypt.js";
import * as F from "./doc-files.js";

let col = null;
let cache = new Map();      // id → { sig, doc }
let ready = false, broken = 0, tok = 0;
const subs = new Set();
const urls = new Set();
export const mig = { running: false, done: 0, total: 0, failed: 0, missing: 0 };

function emit() { for (const cb of [...subs]) { try { cb(); } catch (e) { console.error(e); } } }

function ensure() {
  if (col) return;
  col = collection("dokumente");
  col.watch(() => { sync(); });
  Sess.onChange(() => {
    if (!Sess.isUnlocked()) clear();
    sync();
  });
}
function clear() {
  tok++;
  cache = new Map();
  ready = false;
  broken = 0;
  for (const u of urls) { try { URL.revokeObjectURL(u); } catch { /* egal */ } }
  urls.clear();
}

export function watch(cb) { ensure(); subs.add(cb); return () => subs.delete(cb); }
export const coll = () => { ensure(); return col; };
export const loaded = () => { ensure(); return !!col.loaded; };
export const raw = () => { ensure(); return col.all().filter((x) => x && x.id); };
export const unlocked = () => Sess.isUnlocked();
export const isReady = () => Sess.isUnlocked() && ready;
export const brokenCount = () => broken;
/** Entschlüsselte Dokumente (Array) – oder null, solange gesperrt / noch nicht fertig entschlüsselt. */
export function docs() { ensure(); return isReady() ? [...cache.values()].map((c) => c.doc) : null; }
export function get(id) { ensure(); const c = isReady() && cache.get(String(id)); return c ? c.doc : null; }
/** Gesperrte Form (Ordner, Ablauf, Größe) – auch ohne Schlüssel. */
export const lockedList = () => raw().map(E.lockedShape);
/** Alte Klartext-Dokumente (noch nicht umgestellt). */
export const plainCount = () => raw().filter((r) => !E.isEnc(r)).length;

async function sync() {
  const key = Sess.getKey();
  if (!key) { ready = false; emit(); return; }
  const t = ++tok;
  const next = new Map();
  let bad = 0;
  for (const r of raw()) {
    const sig = E.isEnc(r) ? `e:${r.ct}:${r.chunks}:${r.fileId}:${r.updated}:${r.folder}:${r.expires}:${r.oldChunks || 0}:${r.remind}:${r.remindDays}` : `p:${JSON.stringify(r)}`;
    const c = cache.get(r.id);
    if (c && c.sig === sig) { next.set(r.id, c); continue; }
    try {
      next.set(r.id, { sig, doc: E.isEnc(r) ? await E.openDoc(key, r) : E.legacyDoc(r) });
    } catch { bad++; }
    if (t !== tok || Sess.getKey() !== key) return;
  }
  cache = next;
  broken = bad;
  ready = true;
  emit();
  migrate();
}

/* ---------- Umstellung ---------- */

const io = {
  getPlain: (id, n) => F.getB64(id, n),
  putEnc: async (chunks) => { const r = await F.putEnc(chunks); await r.upload; },
  getEnc: (fileId, n) => F.getEnc(fileId, n),
  delEnc: (fileId, n) => F.delEnc(fileId, n),
  delPlain: (id, n) => F.delFile(id, n),
  put: (rec) => col.put(rec),
  newFileId: () => V.newFileId(),
};

/** Alle noch nicht (fertig) umgestellten Dokumente verschlüsseln. Läuft nur einmal gleichzeitig. */
export async function migrate() {
  const key = Sess.getKey();
  if (!key || mig.running) return;
  const todo = raw().filter((r) => !E.isEnc(r) || Number(r.oldChunks) > 0);
  if (!todo.length) return;
  Object.assign(mig, { running: true, done: 0, total: todo.length, failed: 0, missing: 0 });
  emit();
  try {
    for (const r of todo) {
      if (Sess.getKey() !== key) break;
      const cur = col.get(r.id);
      if (!cur) { mig.done++; continue; }
      try {
        const res = await E.migrateOne(key, cur, io);
        if (res === "missing") mig.missing++;
      } catch (e) {
        console.warn("Dokument verschlüsseln:", e);
        if (e && (e.code === "unavailable" || /offline/i.test(String(e.message)))) mig.missing++; else mig.failed++;
      }
      mig.done++;
      emit();
    }
  } finally {
    mig.running = false;
    emit();
  }
}

/* ---------- Speichern / Lesen ---------- */

function needKey() {
  const key = Sess.getKey();
  if (!key) { const e = new Error("🔒 Dokumente sind gesperrt – bitte zuerst entsperren."); e.code = "locked"; throw e; }
  return key;
}

/** Neues Dokument: Datei (Uint8Array) + Angaben verschlüsselt speichern → { id, upload }. */
export async function create(doc, bytes) {
  ensure();
  const key = needKey();
  const fileId = V.newFileId();
  const chunks = await V.encryptFile(key, fileId, bytes);
  const r = await F.putEnc(chunks);
  const rec = await E.sealDoc(key, { ...doc, created: doc.created || Date.now(), updated: Date.now() }, { fileId, chunks: chunks.length });
  await col.put(rec);
  return { id: rec.id, upload: r.upload };
}

/** Angaben ändern (wird neu versiegelt). Alte Klartext-Dokumente werden dabei gleich umgestellt. */
export async function update(id, changes) {
  ensure();
  const key = needKey();
  let cur = col.get(id);
  if (!cur) throw new Error("Dokument nicht gefunden.");
  if (!E.isEnc(cur)) {
    const res = await E.migrateOne(key, cur, io);
    if (res === "missing") throw new Error("Datei gerade nicht erreichbar – bitte später nochmal.");
    cur = col.get(id);
  }
  const doc = await E.openDoc(key, cur);
  const rec = await E.sealDoc(key, { ...doc, ...changes, id: doc.id, created: doc.created, updated: Date.now() }, { fileId: cur.fileId, chunks: cur.chunks });
  if (Number(cur.oldChunks) > 0) rec.oldChunks = cur.oldChunks;
  return col.put(rec);
}

export async function remove(doc) {
  ensure();
  const cur = col.get(doc.id) || {};
  if (E.isEnc(cur)) {
    F.delEnc(cur.fileId, cur.chunks).catch((e) => console.warn("Datei löschen:", e));
    if (Number(cur.oldChunks) > 0) F.delFile(cur.id, cur.oldChunks).catch(() => {});
  } else F.delFile(doc.id, doc.chunks).catch((e) => console.warn("Datei löschen:", e));
  return col.remove(doc.id);
}

/** Datei-Inhalt → Blob (nur im Speicher) oder null, wenn (noch) nicht da. */
export async function blob(doc) {
  ensure();
  const cur = col.get(doc.id) || doc;
  const key = E.isEnc(cur) || Sess.hasVault() ? needKey() : null; // alte Klartext-Dokumente ohne Tresor: wie bisher lesbar
  let bytes;
  if (E.isEnc(cur)) {
    if (!cur.fileId || !cur.chunks) return null;
    const ch = await F.getEnc(cur.fileId, cur.chunks);
    if (!ch) return null;
    bytes = await V.decryptFile(key, cur.fileId, ch, cur.chunks);
  } else {
    const b64 = await F.getB64(cur.id, cur.chunks);
    if (b64 == null) return null;
    bytes = E.b64ToBytes(b64);
  }
  if (key && Sess.getKey() !== key) return null;
  return new Blob([bytes], { type: doc.type || "application/octet-stream" });
}

/** Object-URL anlegen, die beim Sperren automatisch widerrufen wird. */
export function url(b) {
  const u = URL.createObjectURL(b);
  if (Sess.hasVault() && !Sess.isUnlocked()) { URL.revokeObjectURL(u); return ""; }
  urls.add(u);
  return u;
}
export function revoke(u) { if (u && urls.delete(u)) URL.revokeObjectURL(u); }
