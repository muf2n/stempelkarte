// Update 10 – 💾 Backups: Daten einsammeln, als Datei speichern/teilen, zurückspielen, automatische Server-Backups lesen.
// Logik/Format: js/backup-core.js. Oberfläche: js/views/backup-settings.js.
// Cloud: liest users/{uid}/<sammlung> direkt (auch Bereiche, die gerade nicht geöffnet sind); lokal: localStorage.
// Der Tresor (a_vault*) wird nie gelesen oder geschrieben.

import * as store from "./store.js";
import { getFirebase } from "./firebase.js";
import { isNative } from "./native.js";
import { openedNames } from "./alltag/db.js";
import * as B from "./backup-core.js";

const LS_KEY = "stempelkarte.local.v1";
const LS_ALLTAG = "sk-a-";
const BATCH = 400;

function appVersion() {
  const l = document.querySelector('link[href*="css/styles.css"]');
  const m = l && /[?&]v=([\w.-]+)/.exec(l.getAttribute("href") || "");
  return m ? m[1] : "";
}

async function cloud() {
  const s = store.get();
  if (s.mode !== "cloud" || !s.user) return null;
  const f = await getFirebase();
  if (!f) return null;
  return { ...f, uid: s.user.uid };
}

/* ---------- Einsammeln ---------- */

/** Aktueller Stand → { collections: {name: [docs]}, meta: {id: obj} } */
export async function collectCurrent() {
  const c = await cloud();
  return c ? collectCloud(c) : collectLocal();
}

async function collectCloud({ db, fs, uid }) {
  const names = B.knownCollections(openedNames());
  const collections = {};
  await Promise.all(names.map(async (name) => {
    const qs = await fs.getDocs(fs.collection(db, "users", uid, name));
    const list = [];
    qs.forEach((d) => list.push({ ...d.data(), id: d.id }));
    collections[name] = list;
  }));
  const meta = {};
  await Promise.all(B.META_DOCS.map(async (id) => {
    const d = await fs.getDoc(fs.doc(db, "users", uid, "meta", id));
    if (d.exists()) meta[id] = d.data();
  }));
  return { collections, meta };
}

function readLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function collectLocal() {
  const main = readLS(LS_KEY, {}) || {};
  const collections = {
    entries: Array.isArray(main.entries) ? main.entries : [],
    places: Array.isArray(main.places) ? main.places : [],
    todos: Array.isArray(main.todos) ? main.todos : [],
    days: Object.entries(main.days && typeof main.days === "object" ? main.days : {}).map(([id, v]) => ({ ...(v || {}), id })),
  };
  for (const name of B.knownCollections(openedNames())) if (name.startsWith("a_")) collections[name] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(LS_ALLTAG)) continue;
    const name = "a_" + k.slice(LS_ALLTAG.length);
    if (!B.allowedCollection(name)) continue;
    const arr = readLS(k, []);
    collections[name] = Array.isArray(arr) ? arr.filter((x) => x && x.id) : [];
  }
  return { collections, meta: main.settings ? { settings: main.settings } : {} };
}

export async function makeBackup(source = "manual") {
  const cur = await collectCurrent();
  return B.buildBackup({ ...cur, source, created: Date.now(), app: appVersion() });
}

/* ---------- Speichern / Teilen ---------- */

/** Backup als Datei ausgeben (optional verschlüsselt). → { name, size, shared } */
export async function saveFile(backup, { password = "" } = {}) {
  const text = JSON.stringify(backup);
  const enc = !!password;
  const body = enc ? JSON.stringify(await B.encryptBackup(text, password)) : text;
  const name = B.fileName(backup.created, enc);
  const type = enc ? "application/octet-stream" : "application/json";
  const blob = new Blob([body], { type });
  let shared = false;
  if (isNative() && typeof navigator.share === "function" && typeof File === "function") {
    try {
      const file = new File([blob], name, { type });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Stempelkarte-Backup" });
        shared = true;
      }
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      console.warn("Teilen nicht möglich, lade herunter:", err);
    }
  }
  if (!shared) download(blob, name);
  return { name, size: blob.size, shared };
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

/** Merkt sich das letzte manuelle Backup (settings.backup.lastManual). */
export async function noteManual(ts = Date.now()) {
  const s = store.get();
  const prev = (s.settings && s.settings.backup && typeof s.settings.backup === "object") ? s.settings.backup : {};
  try { await store.saveSettings({ backup: { ...prev, lastManual: ts } }); } catch { /* Toast kommt vom Store */ }
  changedEvt();
}

function changedEvt() { try { window.dispatchEvent(new CustomEvent("sk:backup-changed")); } catch { /* egal */ } }

/* ---------- Einlesen ---------- */

/** Datei-Text → { encrypted, obj } (wirft BackupError). */
export const parseFile = (text) => B.parseFile(text);

/** Entschlüsseln (falls nötig) und streng prüfen → { backup, ignored, vaultSkipped } */
export async function openParsed(parsed, password = "") {
  const obj = parsed.encrypted ? JSON.parse(await B.decryptBackup(parsed.obj, password)) : parsed.obj;
  return B.validateBackup(obj);
}

/* ---------- Zurückspielen ---------- */

/** Spielt ein geprüftes Backup ein. mode "merge" | "replace". → stats (lokal: lädt danach neu). */
export async function restore(backup, mode = "merge") {
  const cur = await collectCurrent();
  const plan = B.planRestore(cur, backup, mode);
  const c = await cloud();
  if (c) await applyCloud(c, plan);
  else applyLocal(plan);
  return plan.stats;
}

async function applyCloud({ db, fs, uid }, plan) {
  const ops = [];
  for (const w of plan.writes) {
    const data = w.coll.startsWith("a_") ? { ...w.data, id: w.id } : w.data;
    ops.push((b) => b.set(fs.doc(db, "users", uid, w.coll, w.id), data, w.merge ? { merge: true } : {}));
  }
  for (const d of plan.deletes) ops.push((b) => b.delete(fs.doc(db, "users", uid, d.coll, d.id)));
  for (const m of plan.meta) ops.push((b) => b.set(fs.doc(db, "users", uid, "meta", m.id), m.data, m.merge ? { merge: true } : {}));
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = fs.writeBatch(db);
    for (const op of ops.slice(i, i + BATCH)) op(b);
    await b.commit();
  }
}

function applyLocal(plan) {
  try { store.stop(); } catch { /* ausstehende Änderungen werden dabei gespeichert */ }
  const main = readLS(LS_KEY, {}) || {};
  const arrs = new Map();
  const getArr = (coll) => {
    if (arrs.has(coll)) return arrs.get(coll);
    let m;
    if (coll === "days") m = new Map(Object.entries(main.days || {}).map(([id, v]) => [id, { ...(v || {}) }]));
    else if (B.MAIN.includes(coll)) m = new Map((main[coll] || []).filter((x) => x && x.id).map((x) => [String(x.id), x]));
    else m = new Map((readLS(LS_ALLTAG + coll.slice(2), []) || []).filter((x) => x && x.id).map((x) => [String(x.id), x]));
    arrs.set(coll, m);
    return m;
  };
  for (const w of plan.writes) {
    const m = getArr(w.coll);
    const prev = w.merge ? (m.get(w.id) || {}) : {};
    m.set(w.id, w.coll === "days" ? { ...prev, ...w.data } : { ...prev, ...w.data, id: w.id });
  }
  for (const d of plan.deletes) getArr(d.coll).delete(d.id);
  for (const [coll, m] of arrs) {
    if (coll === "days") main.days = Object.fromEntries(m);
    else if (B.MAIN.includes(coll)) main[coll] = [...m.values()];
    else localStorage.setItem(LS_ALLTAG + coll.slice(2), JSON.stringify([...m.values()]));
  }
  for (const mm of plan.meta) if (mm.id === "settings") main.settings = mm.merge ? { ...(main.settings || {}), ...mm.data } : { ...mm.data };
  main.rev = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(main));
}

/* ---------- Automatische Backups (Server, users/{uid}/backups) ---------- */

export const autoAvailable = () => store.get().mode === "cloud" && !!store.get().user;

/** → [{date, created, size, stored, chunks, counts}] neueste zuerst ([] lokal). */
export async function listAuto() {
  const c = await cloud();
  if (!c) return [];
  const { db, fs, uid } = c;
  const qs = await fs.getDocs(fs.query(fs.collection(db, "users", uid, "backups"), fs.where("kind", "==", "meta")));
  const out = [];
  qs.forEach((d) => { const x = d.data(); if (x && x.date) out.push({ ...x, id: d.id }); });
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  try { localStorage.setItem("stempelkarte.backup.auto", JSON.stringify(out.length ? out[0].created || 0 : 0)); } catch { /* egal */ }
  changedEvt();
  return out;
}

/** Ein automatisches Backup laden → geprüft { backup, ignored, vaultSkipped } */
export async function fetchAuto(meta) {
  const c = await cloud();
  if (!c) throw new B.BackupError("format", "Automatische Backups gibt's nur mit Google-Konto.");
  const { db, fs, uid } = c;
  const parts = await Promise.all(Array.from({ length: Number(meta.chunks) || 0 }, (_, i) =>
    fs.getDoc(fs.doc(db, "users", uid, "backups", B.chunkId(meta.date, i)))));
  const chunks = parts.map((d) => (d.exists() ? String(d.data().data || "") : null));
  if (chunks.some((x) => x == null)) throw new B.BackupError("format", "Das automatische Backup ist unvollständig.");
  return B.validateBackup(await B.unpackSnapshot(meta, chunks));
}

export async function deleteAuto(meta) {
  const c = await cloud();
  if (!c) return;
  const { db, fs, uid } = c;
  const b = fs.writeBatch(db);
  for (let i = 0; i < (Number(meta.chunks) || 0); i++) b.delete(fs.doc(db, "users", uid, "backups", B.chunkId(meta.date, i)));
  b.delete(fs.doc(db, "users", uid, "backups", meta.id || meta.date));
  await b.commit();
}

/** Zuletzt bekanntes automatisches Backup (aus dem letzten listAuto, ohne Netz). */
export function cachedAutoAt() {
  try { return Number(JSON.parse(localStorage.getItem("stempelkarte.backup.auto") || "0")) || 0; } catch { return 0; }
}
