// Update 10 – 💾 Backups: reine Logik ohne DOM (Node-testbar, auch vom Worker in tools/mcp benutzt).
// Format (Datei .json bzw. verschlüsselt .skbackup, Server-Snapshot in users/{uid}/backups):
//   { format: "stempelkarte-backup", v: 1, created, source: "manual"|"auto"|"safety", app,
//     collections: { entries: [{id,…}], todos: […], a_money_tx: […], … },   // Firestore-Sammlungsnamen
//     meta: { settings: {…}, ical_feeds: {…}, money_lock: {…}, budget_alerts: {…} },
//     counts: { entries: 12, … } }
// Verschlüsselt: { format: "stempelkarte-backup-enc", v: 1, kdf: "PBKDF2-SHA256", iter, salt, iv, ct } (base64, AES-256-GCM).
// NIE enthalten: Tresor (a_vault*, vault*), Bild-Bytes (photos, a_school_files, a_doc_files, a_travel_images, Vorschaubilder im
// Foto-Index), Server-Dokumente in meta/ (KI-Deckel, Gmail-/Bank-Zugänge, Push-Geräte) und die Backups selbst.

import { deriveKek, randomBytes, b64, unb64 } from "./alltag/vault-crypto.js";

export const FORMAT = "stempelkarte-backup";
export const ENC_FORMAT = "stempelkarte-backup-enc";
export const VERSION = 1;
export const ITER = 600000;      // PBKDF2-Runden beim Verschlüsseln (wie der Tresor)
export const MIN_ITER = 310000;  // weniger wird beim Öffnen abgelehnt (OWASP-Empfehlung für PBKDF2-SHA256)
let minIter = MIN_ITER;
/** Nur für Tests: schnellere Schlüsselableitung erlauben. */
export function _setMinIterForTests(n) { minIter = Number.isInteger(n) && n >= 1 ? n : MIN_ITER; }

export const CHUNK_CHARS = 900000; // Server-Snapshot: base64-Text je Teil-Dokument (≤ 900 KB)
export const KEEP_AUTO = 4;        // so viele automatische Backups bleiben
export const REMIND_DAYS = 14;     // Erinnerung, wenn so lange kein Backup
export const MAX_DOCS = 200000;    // Plausibilitätsgrenze beim Einlesen

/** Haupt-Sammlungen (store.js). meta/state (laufende Schicht) bewusst nicht – das ist ein Momentzustand. */
export const MAIN = ["entries", "places", "todos", "days"];
/** Erlaubte Dokumente in users/{uid}/meta (keine Server-Dokumente, keine Push-Geräte). */
export const META_DOCS = ["settings", "ical_feeds", "money_lock", "budget_alerts"];
/** Bekannte Alltag-Sammlungen (js/alltag/db.js → a_<name>). Neue Module bitte hier ergänzen. */
export const ALLTAG = [
  "money_tx", "money_cats", "money_subs", "money_split", "money_rules", "money_goals", "money_gmail", "money_budget",
  "school_timetable", "school_tasks", "school_exams", "school_grades", "school_plan", "school_sessions", "school_projects", "school_docs", "school_meta",
  "travel_trips", "travel_places", "travel_parking", "travel_packing", "travel_fuel",
  "material_items", "material_catalog", "site_log", "einkauf", "einkauf_lists", "freizeit", "berichtsheft", "werkzeug", "fahrzeug_info",
  "photo_index", "photo_albums", "photo_folders", "photo_imports",
  "lap_cards", "lap_stats", "lap_exams", "lap_own", "jp_cards", "jp_stats", "trash",
  "haushalt", "habits", "routines", "goals", "notes", "ai_memory", "notfall", // Update 10 C
  "automations", "automation_log", // Update 10 – ⚡ Automationen
  "dokumente", "vertraege", "inventar", "kontakte", "money_wishes", // Update 10 E (Datei-Inhalte a_doc_files bewusst nicht)
  "learn_progress", // Update 10 – 🛤️ Lernpfad (Japanisch + LAP)
];
/** Nie sichern/zurückspielen (exakt). */
export const EXCLUDE_EXACT = ["a_school_files", "a_travel_images", "a_doc_files", "photos", "backups", "meta"];
/** Nie sichern/zurückspielen (Anfang des Namens) – der Tresor hat seine eigene verschlüsselte Sicherung. */
export const EXCLUDE_PREFIX = ["a_vault", "vault"];
/** Felder, die nicht ins Backup kommen (Bild-Bytes). */
const STRIP = { a_photo_index: ["thumb"] };

const NAME_RE = /^[a-z0-9_]{1,60}$/;
const ID_RE = /^(?!\.\.?$)(?!__.*__$)[^/]{1,700}$/;

export class BackupError extends Error {
  /** code: "format" | "version" | "wrong-password" | "weak-kdf" | "empty" | "no-crypto" */
  constructor(code, message) { super(message); this.name = "BackupError"; this.code = code; }
}

export function isVaultName(name) { return EXCLUDE_PREFIX.some((p) => String(name).startsWith(p)); }

/** Darf diese Firestore-Sammlung (users/{uid}/<name>) ins Backup? */
export function allowedCollection(name) {
  const n = String(name || "");
  if (!NAME_RE.test(n)) return false;
  if (EXCLUDE_EXACT.includes(n) || isVaultName(n)) return false;
  return MAIN.includes(n) || n.startsWith("a_");
}

/** Alle Sammlungen, die die App kennt (Firestore-Namen). extra = weitere Alltag-Namen ohne „a_“. */
export function knownCollections(extra = []) {
  const set = new Set([...MAIN, ...ALLTAG.map((n) => "a_" + n), ...(extra || []).map((n) => "a_" + n)]);
  return [...set].filter(allowedCollection);
}

/* ---------- Werte säubern ---------- */

/** Macht einen Wert JSON-tauglich: Firestore-Timestamps/Date → ms, Bytes/Referenzen weg, undefined weg. */
export function sanitize(v, depth = 0) {
  if (depth > 40) return null;
  if (v === null || v === undefined) return v === null ? null : undefined;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") return Number.isFinite(v) ? v : null;
  if (t === "bigint") return Number(v);
  if (t !== "object") return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch { return null; } }
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return undefined;
  if (Array.isArray(v)) return v.map((x) => sanitize(x, depth + 1)).filter((x) => x !== undefined);
  if (v.__fs && typeof v.__fs === "object") { // REST-Werte aus tools/mcp/src/firestore.js
    if (v.__fs.timestampValue) { const ms = Date.parse(v.__fs.timestampValue); return Number.isFinite(ms) ? ms : null; }
    if (v.__fs.geoPointValue) return { lat: Number(v.__fs.geoPointValue.latitude) || 0, lng: Number(v.__fs.geoPointValue.longitude) || 0 };
    return undefined;
  }
  if (typeof v.toBase64 === "function" || (v.firestore && typeof v.path === "string")) return undefined; // SDK-Bytes / Referenz
  if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
    if (typeof v.latitude === "number" && typeof v.longitude === "number") return { lat: v.latitude, lng: v.longitude }; // SDK-GeoPoint
    return undefined;
  }
  const out = {};
  for (const k of Object.keys(v)) {
    const x = sanitize(v[k], depth + 1);
    if (x !== undefined) out[k] = x;
  }
  return out;
}

/** Ein Dokument fürs Backup: gesäubert, mit id, ohne Bild-Bytes. */
export function exportDoc(coll, id, data) {
  const d = sanitize({ ...(data || {}) }) || {};
  for (const f of STRIP[coll] || []) delete d[f];
  d.id = String(id);
  return d;
}

/* ---------- Bauen ---------- */

/** Backup-Objekt aus {collections: {name: [docs]}, meta: {id: obj}}. Unerlaubtes fliegt raus. */
export function buildBackup({ collections = {}, meta = {}, created = Date.now(), source = "manual", app = "" } = {}) {
  const cols = {};
  const counts = {};
  for (const [name, docs] of Object.entries(collections || {})) {
    if (!allowedCollection(name) || !Array.isArray(docs)) continue;
    const seen = new Set();
    const list = [];
    for (const d of docs) {
      if (!d || typeof d !== "object" || d.id == null) continue;
      const id = String(d.id);
      if (!ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      list.push(exportDoc(name, id, d));
    }
    cols[name] = list;
    counts[name] = list.length;
  }
  const m = {};
  for (const k of META_DOCS) if (meta && meta[k] && typeof meta[k] === "object") m[k] = sanitize(meta[k]);
  return { format: FORMAT, v: VERSION, created: Number(created) || Date.now(), source: String(source || "manual"), app: String(app || ""), collections: cols, meta: m, counts };
}

/* ---------- Prüfen ---------- */

/**
 * Prüft ein eingelesenes Backup streng. Unbekannte/ausgeschlossene Sammlungen werden ignoriert (nie Tresor).
 * → { backup, ignored: [namen], vaultSkipped: bool } – wirft BackupError bei kaputtem Format.
 */
export function validateBackup(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new BackupError("format", "Das ist keine Stempelkarte-Sicherung.");
  if (obj.format === ENC_FORMAT) throw new BackupError("format", "Die Sicherung ist verschlüsselt – bitte zuerst das Passwort eingeben.");
  if (obj.format !== FORMAT) throw new BackupError("format", "Das ist keine Stempelkarte-Sicherung.");
  if (obj.v !== VERSION) throw new BackupError("version", `Diese Sicherung hat Version ${esc(obj.v)} – die App kennt nur Version ${VERSION}. Bitte die App aktualisieren.`);
  const created = Number(obj.created);
  if (!Number.isFinite(created) || created < Date.UTC(2020, 0, 1) || created > Date.now() + 7 * 86400000) throw new BackupError("format", "Das Datum der Sicherung ist ungültig.");
  if (!obj.collections || typeof obj.collections !== "object" || Array.isArray(obj.collections)) throw new BackupError("format", "Die Sicherung enthält keine Daten.");
  const cols = {};
  const ignored = [];
  let vaultSkipped = false;
  let total = 0;
  for (const [name, docs] of Object.entries(obj.collections)) {
    if (!allowedCollection(name)) { ignored.push(name); if (isVaultName(name)) vaultSkipped = true; continue; }
    if (!Array.isArray(docs)) throw new BackupError("format", `Sammlung „${name}“ ist beschädigt.`);
    const list = [];
    const seen = new Set();
    for (const d of docs) {
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new BackupError("format", `Ein Eintrag in „${name}“ ist beschädigt.`);
      const id = typeof d.id === "string" ? d.id : typeof d.id === "number" ? String(d.id) : "";
      if (!ID_RE.test(id)) throw new BackupError("format", `Ein Eintrag in „${name}“ hat keine gültige ID.`);
      if (seen.has(id)) continue;
      seen.add(id);
      const clean = sanitize(d);
      clean.id = id;
      for (const f of STRIP[name] || []) delete clean[f];
      list.push(clean);
    }
    total += list.length;
    if (total > MAX_DOCS) throw new BackupError("format", "Die Sicherung ist unplausibel groß.");
    cols[name] = list;
  }
  const meta = {};
  if (obj.meta != null) {
    if (typeof obj.meta !== "object" || Array.isArray(obj.meta)) throw new BackupError("format", "Die Einstellungen in der Sicherung sind beschädigt.");
    for (const [k, v] of Object.entries(obj.meta)) {
      if (!META_DOCS.includes(k)) { ignored.push("meta/" + k); continue; }
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new BackupError("format", `„${k}“ in der Sicherung ist beschädigt.`);
      meta[k] = sanitize(v);
    }
  }
  const counts = Object.fromEntries(Object.entries(cols).map(([k, v]) => [k, v.length]));
  return { backup: { format: FORMAT, v: VERSION, created, source: String(obj.source || "manual"), app: String(obj.app || ""), collections: cols, meta, counts }, ignored, vaultSkipped };
}

function esc(v) { return String(v).replace(/[^\w.-]/g, "").slice(0, 12) || "?"; }

/* ---------- Übersicht ---------- */

const SECTIONS = [
  ["eintraege", "⏱️", "Arbeitszeit-Einträge", (n) => n === "entries" || n === "days"],
  ["planer", "📅", "Planer (Aufgaben, Termine, Geburtstage)", (n) => n === "todos"],
  ["orte", "📍", "Orte & Baustellen", (n) => n === "places" || n === "a_site_log"],
  ["geld", "💶", "Geld (Buchungen, Abos, Budgets, Ziele)", (n) => n.startsWith("a_money_")],
  ["schule", "🏫", "Schule", (n) => n.startsWith("a_school_")],
  ["lernen", "🧠", "Lernen (LAP, Japanisch)", (n) => n.startsWith("a_lap_") || n.startsWith("a_jp_") || n === "a_learn_progress"],
  ["material", "🧰", "Material & Einkauf", (n) => n.startsWith("a_material_") || n.startsWith("a_einkauf")],
  ["unterwegs", "🧳", "Unterwegs", (n) => n.startsWith("a_travel_")],
  ["galerie", "🖼️", "Galerie (nur Infos, keine Bilder)", (n) => n.startsWith("a_photo_")],
  ["bericht", "📒", "Berichtsheft", (n) => n === "a_berichtsheft"],
];

/** Zählung je Bereich → [{key, emoji, label, n}] (nur Bereiche mit Daten, „Sonstiges“ zuletzt, Einstellungen extra). */
export function sectionCounts(backup) {
  const sums = new Map();
  for (const [name, docs] of Object.entries((backup && backup.collections) || {})) {
    const s = SECTIONS.find((x) => x[3](name));
    const key = s ? s[0] : "sonst";
    sums.set(key, (sums.get(key) || 0) + (Array.isArray(docs) ? docs.length : 0));
  }
  const out = [];
  for (const [key, emoji, label] of SECTIONS) if (sums.get(key)) out.push({ key, emoji, label, n: sums.get(key) });
  if (sums.get("sonst")) out.push({ key: "sonst", emoji: "🧩", label: "Sonstiges (Freizeit, Papierkorb …)", n: sums.get("sonst") });
  const mk = Object.keys((backup && backup.meta) || {}).length;
  if (mk) out.push({ key: "einstellungen", emoji: "⚙️", label: "Einstellungen", n: mk });
  return out;
}

export function totalDocs(backup) {
  return Object.values((backup && backup.collections) || {}).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
}

/* ---------- Zurückspielen planen ---------- */

/** Zeitstempel eines Dokuments (für „neuer gewinnt“). 0 = unbekannt. */
export function docStamp(d) {
  if (!d || typeof d !== "object") return 0;
  let best = 0;
  for (const k of ["updated", "updatedAt", "modified", "editedAt", "doneAt", "createdAt", "created"]) {
    const v = Number(d[k]);
    if (Number.isFinite(v) && v > best) best = v;
  }
  return best;
}

/** Sammlungen, bei denen beim Zurückspielen nur Felder ergänzt werden (z. B. Foto-Index: Vorschaubild bleibt). */
export const PATCH_ONLY = ["a_photo_index"];

/**
 * Plan fürs Zurückspielen.
 *  mode "merge":   fehlende Einträge anlegen, vorhandene nur ersetzen, wenn der aus dem Backup neuer ist.
 *                  Einstellungen: nur fehlende Schlüssel ergänzen.
 *  mode "replace": alles aus dem Backup schreiben; Einträge in den gesicherten Sammlungen, die im Backup
 *                  fehlen, löschen (Foto-Index nie löschen). Einstellungen komplett ersetzen.
 * current = { collections: {name: [docs]}, meta: {id: obj} }
 * → { writes: [{coll, id, data, merge}], deletes: [{coll, id}], meta: [{id, data, merge}], stats: {add, update, keep, del} }
 */
export function planRestore(current, backup, mode = "merge") {
  const replace = mode === "replace";
  const writes = [], deletes = [], meta = [];
  const stats = { add: 0, update: 0, keep: 0, del: 0 };
  const curCols = (current && current.collections) || {};
  for (const [coll, docs] of Object.entries((backup && backup.collections) || {})) {
    if (!allowedCollection(coll)) continue;
    const cur = new Map((curCols[coll] || []).filter((d) => d && d.id != null).map((d) => [String(d.id), d]));
    const patch = PATCH_ONLY.includes(coll);
    const inIds = new Set();
    for (const d of docs) {
      const id = String(d.id);
      inIds.add(id);
      const { id: _i, ...data } = d;
      const have = cur.get(id);
      if (!have) { writes.push({ coll, id, data, merge: patch }); stats.add++; continue; }
      if (replace || docStamp(d) > docStamp(have)) {
        if (!replace && sameData(have, d)) { stats.keep++; continue; }
        writes.push({ coll, id, data, merge: patch }); stats.update++;
      } else stats.keep++;
    }
    if (replace && !patch) {
      for (const id of cur.keys()) if (!inIds.has(id)) { deletes.push({ coll, id }); stats.del++; }
    }
  }
  const curMeta = (current && current.meta) || {};
  for (const [id, data] of Object.entries((backup && backup.meta) || {})) {
    if (!META_DOCS.includes(id) || !data) continue;
    if (replace) { meta.push({ id, data, merge: false }); continue; }
    const have = curMeta[id] || {};
    const add = {};
    for (const [k, v] of Object.entries(data)) if (!(k in have)) add[k] = v;
    if (Object.keys(add).length) meta.push({ id, data: add, merge: true });
  }
  return { writes, deletes, meta, stats };
}

function sameData(a, b) {
  const strip = (x) => { const { id, ...r } = x || {}; return r; };
  try { return JSON.stringify(sortKeys(strip(a))) === JSON.stringify(sortKeys(strip(b))); } catch { return false; }
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/* ---------- Verschlüsselung ---------- */

const te = new TextEncoder();
const td = new TextDecoder();
const AAD = te.encode("stempelkarte:backup:v1");

/** JSON-Text → verschlüsseltes Datei-Objekt. */
export async function encryptBackup(text, password, { iter = ITER } = {}) {
  if (typeof password !== "string" || password.length < 8) throw new BackupError("wrong-password", "Das Passwort braucht mindestens 8 Zeichen.");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKek(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, te.encode(text)));
  return { format: ENC_FORMAT, v: VERSION, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Verschlüsseltes Datei-Objekt → JSON-Text. Wirft BackupError("wrong-password"), wenn es nicht passt. */
export async function decryptBackup(obj, password) {
  if (!obj || obj.format !== ENC_FORMAT || obj.v !== VERSION || obj.kdf !== "PBKDF2-SHA256") throw new BackupError("format", "Das ist keine verschlüsselte Stempelkarte-Sicherung.");
  const iter = Number(obj.iter);
  if (!Number.isInteger(iter) || iter > 10000000) throw new BackupError("format", "Die Sicherung ist beschädigt.");
  if (iter < minIter) throw new BackupError("weak-kdf", "Die Sicherung verwendet zu wenige Schlüssel-Runden – sie wird aus Sicherheitsgründen nicht geöffnet.");
  let salt, iv, ct;
  try { salt = unb64(obj.salt); iv = unb64(obj.iv); ct = unb64(obj.ct); } catch { throw new BackupError("format", "Die Sicherung ist beschädigt."); }
  if (salt.length !== 16 || iv.length !== 12 || ct.length < 17) throw new BackupError("format", "Die Sicherung ist beschädigt.");
  const key = await deriveKek(String(password || "") || " ", salt, iter);
  try {
    return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, ct));
  } catch {
    throw new BackupError("wrong-password", "Falsches Passwort – oder die Datei wurde verändert.");
  }
}

/** Dateiinhalt → { encrypted, obj }. Wirft BackupError bei Unlesbarem. */
export function parseFile(text) {
  let obj;
  try { obj = JSON.parse(String(text || "")); } catch { throw new BackupError("format", "Die Datei ist keine gültige Sicherung (kein JSON)."); }
  if (!obj || typeof obj !== "object") throw new BackupError("format", "Die Datei ist keine gültige Sicherung.");
  if (obj.format === ENC_FORMAT) return { encrypted: true, obj };
  if (obj.format === FORMAT) return { encrypted: false, obj };
  throw new BackupError("format", "Das ist keine Stempelkarte-Sicherung.");
}

/* ---------- Komprimieren & Teilen (Server-Snapshot) ---------- */

export const canGzip = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream("gzip"));

/** Text in Teile ≤ n Zeichen. */
export function chunkText(s, n = CHUNK_CHARS) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out.length ? out : [""];
}

/** Backup-Objekt → { meta, chunks: [base64-Teile], size } für users/{uid}/backups. */
export async function packSnapshot(backup, { date, chunkChars = CHUNK_CHARS } = {}) {
  const raw = te.encode(JSON.stringify(backup));
  const gz = canGzip();
  const body = gz ? await gzip(raw) : raw;
  const chunks = chunkText(b64(body), chunkChars);
  return {
    meta: { kind: "meta", v: VERSION, date, created: backup.created, size: raw.length, stored: body.length, gz, chunks: chunks.length, counts: backup.counts || {} },
    chunks,
  };
}

/** Teile wieder zusammensetzen → Backup-Objekt (ungeprüft). */
export async function unpackSnapshot(meta, chunks) {
  if (!meta || meta.kind !== "meta" || !Array.isArray(chunks) || chunks.length !== Number(meta.chunks)) throw new BackupError("format", "Das automatische Backup ist unvollständig.");
  let bytes = unb64(chunks.join(""));
  if (meta.gz) {
    if (!canGzip()) throw new BackupError("format", "Dieses Gerät kann das komprimierte Backup nicht entpacken.");
    bytes = await gunzip(bytes);
  }
  try { return JSON.parse(td.decode(bytes)); } catch { throw new BackupError("format", "Das automatische Backup ist beschädigt."); }
}

export const chunkId = (date, i) => `${date}_c${i}`;

/** Welche automatischen Backups (Datum) bleiben/fliegen raus – neueste zuerst. */
export function retention(dates, keep = KEEP_AUTO) {
  const sorted = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  return { keep: sorted.slice(0, keep), drop: sorted.slice(keep) };
}

/* ---------- Kleinkram ---------- */

const pad = (n) => String(n).padStart(2, "0");
export function dateKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export function fileName(created, encrypted) {
  const d = new Date(created);
  return `stempelkarte-backup-${dateKey(created)}-${pad(d.getHours())}${pad(d.getMinutes())}${encrypted ? ".skbackup" : ".json"}`;
}

/** „heute“, „gestern“, „vor 5 Tagen“, „noch nie“. */
export function agoText(ts, now = Date.now()) {
  if (!(Number(ts) > 0)) return "noch nie";
  const days = Math.floor((startOfDay(now) - startOfDay(ts)) / 86400000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function sizeText(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Letztes Backup (manuell oder automatisch) → Zeitstempel oder 0. */
export function lastBackupAt(settings, autoList = []) {
  const s = settings && settings.backup && typeof settings.backup === "object" ? settings.backup : {};
  const auto = (autoList || []).reduce((a, b) => Math.max(a, Number(b && b.created) || 0), 0);
  return Math.max(Number(s.lastManual) || 0, auto);
}

/** Braucht's eine Erinnerung? (kein Backup in REMIND_DAYS Tagen) */
export function needsReminder(last, now = Date.now(), days = REMIND_DAYS) {
  return !(Number(last) > 0) || now - Number(last) > days * 86400000;
}
