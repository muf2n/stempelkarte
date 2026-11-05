// Alltag › Passwort-Tresor: reine Krypto-Funktionen (WebCrypto, Browser + Node 22).
// Zero-Knowledge: alles wird im Gerät verschlüsselt, der Server (Firestore) sieht nur Chiffretext.
//
//  Master-Passwort ──PBKDF2-SHA256 (600.000 Runden, 16 Byte Salt)──► KEK (AES-256-GCM, nicht exportierbar)
//  Zufälliger Daten-Schlüssel (DEK, 256 Bit) ──AES-GCM mit KEK──► meta.wrappedKey
//  Jeder Eintrag (JSON) ──AES-GCM mit DEK, AAD = Eintrags-ID──► {id, iv, ct}
//
// Passwort ändern = nur den DEK neu einpacken; die Einträge bleiben unverändert.
// Der entpackte DEK ist ein nicht exportierbarer CryptoKey und existiert nur im Speicher.
//
// Meta-Dokument (a_vault_meta/main):
//   { v:1, kdf:"PBKDF2-SHA256", iter, salt, wrappedKey, wrapIv, verifier:{iv, ct} }   (alles base64)
// Eintrag (a_vault_items/{id}): { id, iv, ct } (+ updated/created von db.js)

export const ITER = 600000;
/** L12: Untergrenze für gespeicherte PBKDF2-Runden. Ein Meta-Dokument mit weniger Runden (z. B. von jemandem
 *  mit Schreibzugriff ausgetauscht, um Passwort-Rateversuche zu erleichtern) wird beim Entsperren abgelehnt. */
export const MIN_ITER = 100000;
let minIter = MIN_ITER;
/** Nur für Tests (Node-Unit-Tests bzw. localhost-Test-Haken in vault.js): schnellere Schlüsselableitung erlauben. */
export function _setMinIterForTests(n) { minIter = Number.isInteger(n) && n >= 1 ? Math.min(n, MIN_ITER) : MIN_ITER; }
export const VERSION = 1;
export const KDF = "PBKDF2-SHA256";
export const BACKUP_FORMAT = "stempelkarte-tresor";
const VERIFIER_TEXT = "stempelkarte-tresor-ok";
const AAD_WRAP = "tresor:dek:v1";
const AAD_VERIFIER = "tresor:verifier:v1";
const aadItem = (id) => "tresor:item:v1:" + id;

const te = new TextEncoder();
const td = new TextDecoder();

export class VaultError extends Error {
  /** code: "wrong-password" | "tampered" | "format" | "no-crypto" */
  constructor(code, message) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new VaultError("no-crypto", "Verschlüsselung nicht verfügbar (nur über HTTPS oder localhost).");
  return c.subtle;
}

export function randomBytes(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(a.subarray(i, Math.min(n, i + 65536)));
  return a;
}

/* ---------- base64 ---------- */

export function b64(u8) {
  const a = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new VaultError("format", "Ungültige Daten (base64).");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- Bausteine ---------- */

export async function deriveKek(password, salt, iter) {
  if (typeof password !== "string" || !password) throw new VaultError("wrong-password", "Kein Passwort.");
  const base = await subtle().importKey("raw", te.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function importDek(raw) {
  return subtle().importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(key, bytes, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad), tagLength: 128 }, key, bytes));
  return { iv: b64(iv), ct: b64(ct) };
}

async function open(key, ivB64, ctB64, aad) {
  const iv = unb64(ivB64);
  const ct = unb64(ctB64);
  if (iv.length !== 12 || ct.length < 16) throw new VaultError("format", "Ungültige Daten.");
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad), tagLength: 128 }, key, ct));
}

const thousands = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
function weakIter(iter) {
  return new VaultError("weak-kdf", `Der Tresor verwendet zu wenige Schlüssel-Runden (${thousands(iter)} statt mindestens ${thousands(MIN_ITER)}). ` +
    "Aus Sicherheitsgründen wird er so nicht entsperrt – die Tresor-Daten könnten manipuliert worden sein. Stell ihn aus einer Sicherung wieder her.");
}

export function checkMeta(meta) {
  const ok = meta && typeof meta === "object" && meta.v === VERSION && meta.kdf === KDF &&
    Number.isInteger(meta.iter) && meta.iter >= 1 && meta.iter <= 10000000 &&
    typeof meta.salt === "string" && typeof meta.wrappedKey === "string" && typeof meta.wrapIv === "string" &&
    meta.verifier && typeof meta.verifier.iv === "string" && typeof meta.verifier.ct === "string";
  if (!ok) throw new VaultError("format", "Tresor-Daten sind beschädigt oder haben ein unbekanntes Format.");
  if (meta.iter < minIter) throw weakIter(meta.iter);
  return meta;
}

/** Nur die Felder, die ins Meta-Dokument gehören (z. B. ohne id/updated aus db.js). */
export function pickMeta(m) {
  return { v: m.v, kdf: m.kdf, iter: m.iter, salt: m.salt, wrappedKey: m.wrappedKey, wrapIv: m.wrapIv, verifier: { iv: m.verifier.iv, ct: m.verifier.ct } };
}

async function unwrapRaw(meta, password) {
  checkMeta(meta);
  const kek = await deriveKek(password, unb64(meta.salt), meta.iter);
  try {
    return await open(kek, meta.wrapIv, meta.wrappedKey, AAD_WRAP);
  } catch (err) {
    if (err instanceof VaultError && err.code === "format") throw err;
    throw new VaultError("wrong-password", "Falsches Passwort.");
  }
}

async function wrapRaw(raw, password, iter) {
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt, iter);
  const w = await seal(kek, raw, AAD_WRAP);
  return { salt: b64(salt), wrappedKey: w.ct, wrapIv: w.iv };
}

/* ---------- Öffentliche Funktionen ---------- */

/** Neuen Tresor anlegen → { meta, key } (key = nicht exportierbarer DEK). */
export async function createVault(password, { iter = ITER } = {}) {
  if (!Number.isInteger(iter) || iter < 1) throw new VaultError("format", "Ungültige Rundenzahl.");
  if (iter < minIter) throw weakIter(iter);
  const raw = randomBytes(32);
  try {
    const w = await wrapRaw(raw, password, iter);
    const key = await importDek(raw);
    const verifier = await seal(key, te.encode(VERIFIER_TEXT), AAD_VERIFIER);
    return { meta: { v: VERSION, kdf: KDF, iter, ...w, verifier }, key };
  } finally {
    raw.fill(0);
  }
}

/** Tresor entsperren → DEK. Wirft VaultError("wrong-password") bei falschem Passwort. */
export async function unlockVault(password, meta) {
  const raw = await unwrapRaw(meta, password);
  let key;
  try { key = await importDek(raw); } finally { raw.fill(0); }
  try {
    const v = td.decode(await open(key, meta.verifier.iv, meta.verifier.ct, AAD_VERIFIER));
    if (v !== VERIFIER_TEXT) throw new Error("verifier");
  } catch {
    throw new VaultError("tampered", "Prüfwert stimmt nicht – Tresor-Daten wurden verändert.");
  }
  return key;
}

/** Master-Passwort ändern: DEK mit neuem Passwort/Salt neu einpacken → neues Meta. Einträge bleiben gleich. */
export async function changePassword(meta, oldPassword, newPassword, { iter = meta && meta.iter || ITER } = {}) {
  if (!Number.isInteger(iter) || iter < minIter) throw weakIter(iter);
  const raw = await unwrapRaw(meta, oldPassword);
  try {
    const w = await wrapRaw(raw, newPassword, iter);
    return { v: VERSION, kdf: KDF, iter, ...w, verifier: { ...meta.verifier } };
  } finally {
    raw.fill(0);
  }
}

/** Eintrag verschlüsseln → { id, iv, ct }. data = beliebiges JSON-Objekt (Titel, Passwort, …). */
export async function encryptItem(key, id, data) {
  if (!id || typeof id !== "string") throw new VaultError("format", "Eintrag ohne ID.");
  const s = await seal(key, te.encode(JSON.stringify(data)), aadItem(id));
  return { id, iv: s.iv, ct: s.ct };
}

/** Eintrag entschlüsseln. Wirft VaultError("tampered"), wenn Daten oder ID verändert wurden. */
export async function decryptItem(key, rec) {
  if (!rec || !rec.id || typeof rec.iv !== "string" || typeof rec.ct !== "string") throw new VaultError("format", "Ungültiger Eintrag.");
  let bytes;
  try { bytes = await open(key, rec.iv, rec.ct, aadItem(rec.id)); }
  catch { throw new VaultError("tampered", "Eintrag kann nicht entschlüsselt werden (verändert oder falscher Schlüssel)."); }
  try { return JSON.parse(td.decode(bytes)); }
  catch { throw new VaultError("tampered", "Eintrag ist beschädigt."); }
}

/* ---------- Sicherung (verschlüsselt, gleiches Format) ---------- */

export function makeBackup(meta, records, now = new Date()) {
  return {
    format: BACKUP_FORMAT,
    v: VERSION,
    exported: now.toISOString(),
    meta: pickMeta(checkMeta(meta)),
    items: (records || []).filter((r) => r && r.id && r.iv && r.ct)
      .map((r) => ({ id: r.id, iv: r.iv, ct: r.ct, created: r.created || null, updated: r.updated || null })),
  };
}

export function parseBackup(input) {
  let o = input;
  if (typeof input === "string") {
    try { o = JSON.parse(input); } catch { throw new VaultError("format", "Datei ist keine Tresor-Sicherung (kein JSON)."); }
  }
  if (!o || o.format !== BACKUP_FORMAT || o.v !== VERSION || !Array.isArray(o.items)) throw new VaultError("format", "Datei ist keine Tresor-Sicherung.");
  checkMeta(o.meta);
  for (const it of o.items) {
    if (!it || typeof it.id !== "string" || typeof it.iv !== "string" || typeof it.ct !== "string") throw new VaultError("format", "Sicherung enthält ungültige Einträge.");
  }
  return { meta: o.meta, items: o.items, exported: o.exported || null };
}

/** Sicherung mit ihrem (damaligen) Master-Passwort öffnen → { key, meta, entries:[{id, data, created, updated}], failed } */
export async function openBackup(input, password) {
  const b = parseBackup(input);
  const key = await unlockVault(password, b.meta);
  const entries = [];
  let failed = 0;
  for (const it of b.items) {
    try { entries.push({ id: it.id, data: await decryptItem(key, it), created: it.created || null, updated: it.updated || null }); }
    catch { failed++; }
  }
  return { key, meta: b.meta, entries, failed };
}
