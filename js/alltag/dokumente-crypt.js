// Update 10 – 🔒 Dokumente verschlüsseln: reine Logik ohne DOM (Node-testbar, Web Crypto über vault-crypto.js).
// Schlüssel = Tresor-Datenschlüssel (DEK aus vault_meta/main, entsperrt mit dem Tresor-Passwort).
//
// Gespeicherter Datensatz (Sammlung „dokumente“, Cloud a_dokumente / lokal sk-a-dokumente):
//   KLARTEXT (nur was ohne Entsperren gebraucht wird):
//     id, folder (feste Ordner-ID wie „rechnungen“ – für Ordner + Anzahl im gesperrten Zustand; eigene Ordner-Namen nur als „eigen“),
//     created, updated,
//     expires, remind, remindDays (Ablauf-Erinnerung in der Benachrichtigungszentrale – ohne Titel),
//     size (Speicher-Anzeige), chunks + fileId (welche verschlüsselten Datei-Stücke dazugehören; fileId ist zufällig),
//     enc: 1 (Merker „verschlüsselt“ – macht die Umstellung wiederholbar), oldChunks (nur kurz während der Umstellung:
//     wie viele alte Klartext-Stücke noch zu löschen sind).
//   VERSCHLÜSSELT (iv + ct, AES-256-GCM, AAD „tresor:item:v1:dok:<id>“ → nicht mit Tresor-Einträgen vertauschbar):
//     folder (inkl. eigenem Ordner-Namen), title, tags, fav, type, name, thumb, date, links, ocr, notes
// Datei-Inhalt: vault-crypto.encryptFile (Stücke ≤ 512 KiB, AAD = fileId/n/total) in a_doc_files/{fileId}_{n} = { id, n, total, iv, ct }.
import * as V from "./vault-crypto.js";
import { normDoc, FOLDERS } from "./dokumente-core.js";

export const PLAIN_KEYS = ["id", "folder", "created", "updated", "expires", "remind", "remindDays", "size", "chunks", "fileId", "enc", "oldChunks"];
export const SECRET_KEYS = ["folder", "title", "tags", "fav", "type", "name", "thumb", "date", "links", "ocr", "notes"];
const aadId = (id) => `dok:${id}`;
export const OWN_FOLDER = "eigen";
/** Klartext-Ordner: feste Ordner-ID oder „eigen“ (eigene Namen bleiben verschlüsselt). */
export const plainFolder = (f) => (FOLDERS.some((x) => x.id === f) ? f : OWN_FOLDER);

export const isEnc = (r) => !!(r && r.enc === 1 && typeof r.iv === "string" && typeof r.ct === "string");

/** Geheime Felder eines (normalisierten) Dokuments. */
export function secretOf(doc) {
  const d = normDoc(doc);
  const out = {};
  for (const k of SECRET_KEYS) out[k] = d[k];
  return out;
}

/** Dokument (+ Datei-Angaben) verschlüsseln → Datensatz zum Speichern. */
export async function sealDoc(key, doc, { fileId = "", chunks = 0 } = {}) {
  if (!key) throw new V.VaultError("locked", "Tresor ist gesperrt.");
  const d = normDoc(doc);
  if (!d.id) throw new V.VaultError("format", "Dokument ohne ID.");
  const rec = await V.encryptItem(key, aadId(d.id), secretOf(d));
  return {
    id: d.id, folder: plainFolder(d.folder), created: d.created || Date.now(), updated: d.updated || Date.now(),
    expires: d.expires, remind: d.remind, remindDays: d.remindDays, size: d.size,
    chunks: Math.max(0, Number(chunks) || 0), fileId: String(fileId || ""), enc: 1, iv: rec.iv, ct: rec.ct,
  };
}

/** Datensatz entschlüsseln → normalisiertes Dokument + { fileId, enc: 1 }. Wirft VaultError("tampered") bei falschem Schlüssel. */
export async function openDoc(key, rec) {
  if (!isEnc(rec)) throw new V.VaultError("format", "Kein verschlüsseltes Dokument.");
  const sec = await V.decryptItem(key, { id: aadId(rec.id), iv: rec.iv, ct: rec.ct });
  const plain = {};
  for (const k of PLAIN_KEYS) if (rec[k] !== undefined) plain[k] = rec[k];
  return { ...normDoc({ ...sec, ...plain, folder: (sec && sec.folder) || plain.folder }), fileId: String(rec.fileId || ""), enc: 1, oldChunks: Number(rec.oldChunks) || 0 };
}

/** Altes Klartext-Dokument (vor der Umstellung) → gleiche Form wie openDoc. */
export const legacyDoc = (rec) => ({ ...normDoc(rec), fileId: "", enc: 0, oldChunks: 0 });

/** Gesperrte Ansicht: nur Ordner, Zeiten, Ablauf, Größe – nie Titel/Tags/Notizen/Text/Links (auch nicht bei alten Klartext-Dokumenten). */
export function lockedShape(rec) {
  const d = normDoc(rec);
  return { id: d.id, folder: d.folder, created: d.created, updated: d.updated, expires: d.expires, remind: d.remind, remindDays: d.remindDays, size: d.size, enc: isEnc(rec) ? 1 : 0, locked: true };
}

/* ---------- Bytes ---------- */

export function b64ToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
export function dataUrlBytes(u) { const s = String(u || ""); return b64ToBytes(s.slice(s.indexOf(",") + 1)); }
export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/* ---------- Umstellung alter Klartext-Dokumente ---------- */
/**
 * Ein Dokument umstellen – sicher und wiederholbar:
 *   1. Klartext-Datei lesen → verschlüsselt speichern → zurücklesen + entschlüsseln + vergleichen
 *   2. Metadaten versiegeln → entschlüsseln + vergleichen → Datensatz ersetzen (enc: 1, oldChunks = alte Stückzahl)
 *   3. alte Klartext-Stücke löschen → oldChunks entfernen
 * Bricht es irgendwo ab, bleibt immer eine lesbare Fassung übrig; der nächste Lauf macht dort weiter.
 * io = { getPlain(id, n) → base64|null, putEnc(chunks), getEnc(fileId, n) → chunks, delEnc(fileId, n), delPlain(id, n), put(rec), newFileId() }
 * → "skip" | "cleaned" | "migrated" | "missing" (Datei gerade nicht lesbar → später nochmal)
 */
export async function migrateOne(key, rec, io) {
  if (!key) throw new V.VaultError("locked", "Tresor ist gesperrt.");
  if (!rec || !rec.id) return "skip";
  if (isEnc(rec)) {
    if (!(Number(rec.oldChunks) > 0)) return "skip";
    await io.delPlain(rec.id, Number(rec.oldChunks));
    const { oldChunks, ...rest } = rec; // eslint-disable-line no-unused-vars
    await io.put(rest);
    return "cleaned";
  }
  const doc = normDoc(rec);
  let fileId = "", n = 0;
  if (doc.chunks > 0) {
    const b64 = await io.getPlain(rec.id, doc.chunks);
    if (b64 == null) return "missing";
    const bytes = b64ToBytes(b64);
    fileId = io.newFileId();
    const enc = await V.encryptFile(key, fileId, bytes);
    await io.putEnc(enc);
    let ok = false;
    try {
      const back = await io.getEnc(fileId, enc.length);
      ok = sameBytes(await V.decryptFile(key, fileId, back, enc.length), bytes);
    } catch { ok = false; }
    if (!ok) { await io.delEnc(fileId, enc.length).catch(() => {}); throw new Error("Prüfung der verschlüsselten Datei fehlgeschlagen – Original bleibt erhalten."); }
    n = enc.length;
  }
  const sealed = await sealDoc(key, doc, { fileId, chunks: n });
  const check = await openDoc(key, sealed);
  if (JSON.stringify(secretOf(check)) !== JSON.stringify(secretOf(doc))) {
    if (fileId) await io.delEnc(fileId, n).catch(() => {});
    throw new Error("Prüfung der verschlüsselten Angaben fehlgeschlagen – Original bleibt erhalten.");
  }
  if (doc.chunks > 0) {
    await io.put({ ...sealed, oldChunks: doc.chunks });
    await io.delPlain(rec.id, doc.chunks);
  }
  await io.put(sealed);
  return "migrated";
}
