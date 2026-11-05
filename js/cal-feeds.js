// Update 9 – Kalender dauerhaft verbinden über iCal-Link (kein OAuth, kein Ablauf).
// Adressen liegen in users/{uid}/meta/ical_feeds = {feeds:[{id, name, color, url, visible}]} (NICHT in settings →
// nicht im Snapshot/Export). Abgeholt wird über den eigenen Server (GET <server>/ics?id=…, Firebase-ID-Token),
// der die Adresse selbst aus Firestore liest. Geparste Termine: Speicher + IndexedDB (Offline), Liste ohne Adressen
// in localStorage. Aktualisierung alle 15 Min. und beim Zurückkehren in die App.
// Lokaler Modus: Liste in localStorage (nur mit Test-Haken abrufbar – ohne Anmeldung kein Server-Zugang).
import * as store from "./store.js";
import { getFirebase } from "./firebase.js";
import { serverUrl, idToken } from "./alltag/ai-client.js";
import { parseFeed, expandFeed, checkFeedUrl, maskUrl, googleCalId, isHolidayFeed, suggestName } from "./cal-feed-core.js";
import { holidayName } from "./util.js";

export { checkFeedUrl, maskUrl, suggestName };

const REFRESH_MS = 15 * 60 * 1000;
const STALE_MS = 3 * 60 * 1000;     // beim Start/Zurückkehren neu holen, wenn älter
const LOCAL_KEY = "stempelkarte.ical.local";
const LIST_KEY = "stempelkarte.ical.list.";
const DATA_KEY = "stempelkarte.ical.data.";
const IDB = "stempelkarte-ical";

let ident = null;      // "local" | "cloud:<uid>" | null
let feeds = [];        // [{id, name, color, url?, visible, gcal, holiday, mask}]
let hasUrls = false;   // true, sobald die Liste mit Adressen geladen ist (Cloud: aus Firestore)
const data = new Map();   // feedId → {at, events}
const fstate = new Map(); // feedId → {loading, error}
const listeners = new Set();
let ver = 0;
const memo = new Map();
export const state = { loaded: false, error: null };

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* egal */ } };
const newId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function fail(code, msg) { const e = new Error(msg); e.code = code; return e; }

/* ---------- Ereignisse ---------- */

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
let emitQ = false;
function emit() {
  ver++; memo.clear();
  if (emitQ) return;
  emitQ = true;
  setTimeout(() => { emitQ = false; for (const cb of [...listeners]) { try { cb(state); } catch (e) { console.error(e); } } }, 30);
}

/* ---------- Abgeleitete Felder ---------- */

function derive(f) {
  const url = typeof f.url === "string" ? f.url : "";
  return {
    id: String(f.id), name: String(f.name || "Kalender").slice(0, 40), color: f.color || "pfau", visible: f.visible !== false,
    ...(url ? { url } : {}),
    gcal: url ? googleCalId(url) : f.gcal || null,
    holiday: url ? isHolidayFeed(url) : !!f.holiday,
    mask: url ? maskUrl(url) : f.mask || "…",
  };
}
const publicOf = (f) => ({ id: f.id, name: f.name, color: f.color, visible: f.visible, gcal: f.gcal, holiday: f.holiday, mask: f.mask });
const storedOf = (f) => ({ id: f.id, name: f.name, color: f.color, url: f.url, visible: f.visible });

/* ---------- Offline-Zwischenspeicher (IndexedDB, sonst localStorage) ---------- */

let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise((ok) => {
    try {
      if (typeof indexedDB === "undefined") { ok(null); return; }
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore("data"); } catch { /* egal */ } };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
      r.onblocked = () => ok(null);
    } catch { ok(null); }
  });
  return idbP;
}
async function idbDo(mode, fn) {
  const db = await idb();
  if (!db) return null;
  return new Promise((ok) => {
    try {
      const tx = db.transaction("data", mode);
      const req = fn(tx.objectStore("data"));
      tx.oncomplete = () => ok(req ? req.result : true);
      tx.onerror = () => ok(null);
      tx.onabort = () => ok(null);
    } catch { ok(null); }
  });
}
async function saveData(id, d) {
  const key = `${ident}|${id}`;
  const ok = await idbDo("readwrite", (s) => s.put(d, key));
  if (ok) { lsDel(DATA_KEY + key); return; }
  const raw = JSON.stringify(d);
  if (raw.length < 1_500_000) lsSet(DATA_KEY + key, raw);
}
async function loadData(id) {
  const key = `${ident}|${id}`;
  const v = await idbDo("readonly", (s) => s.get(key));
  if (v && Array.isArray(v.events)) return v;
  try { const x = JSON.parse(lsGet(DATA_KEY + key) || "null"); return x && Array.isArray(x.events) ? x : null; } catch { return null; }
}
async function dropData(id) {
  const key = `${ident}|${id}`;
  await idbDo("readwrite", (s) => s.delete(key));
  lsDel(DATA_KEY + key);
}

/* ---------- Liste laden / speichern ---------- */

function identOf(s) {
  if (!s || !s.mode) return null;
  if (s.mode === "local") return "local";
  return s.user && s.user.uid ? "cloud:" + s.user.uid : null;
}

function cacheList() {
  if (!ident || ident === "local") return;
  lsSet(LIST_KEY + ident, JSON.stringify(feeds.map(publicOf)));
}

async function feedDoc() {
  const s = store.get();
  const f = await getFirebase();
  if (!f || !s.user) throw fail("auth", "Nicht angemeldet.");
  return { f, ref: f.fs.doc(f.db, "users", s.user.uid, "meta", "ical_feeds") };
}

async function switchTo(k) {
  ident = k;
  feeds = []; hasUrls = false; data.clear(); fstate.clear();
  state.loaded = false; state.error = null;
  emit();
  if (!k) return;
  if (k === "local") {
    try { feeds = (JSON.parse(lsGet(LOCAL_KEY) || "[]") || []).filter((x) => x && x.id).map(derive); } catch { feeds = []; }
    hasUrls = true;
  } else {
    try { feeds = (JSON.parse(lsGet(LIST_KEY + k) || "[]") || []).filter((x) => x && x.id).map(derive); } catch { feeds = []; }
  }
  for (const f of feeds) { const d = await loadData(f.id); if (ident !== k) return; if (d) data.set(f.id, d); }
  state.loaded = true;
  emit();
  if (k !== "local") {
    try {
      const { f, ref } = await feedDoc();
      const snap = await f.fs.getDoc(ref);
      if (ident !== k) return;
      const list = snap.exists() && Array.isArray(snap.data().feeds) ? snap.data().feeds : [];
      feeds = list.filter((x) => x && x.id && x.url).map(derive);
      hasUrls = true;
      cacheList();
      for (const x of feeds) if (!data.has(x.id)) { const d = await loadData(x.id); if (d) data.set(x.id, d); }
      emit();
    } catch (e) {
      // offline: zwischengespeicherte Liste bleibt
      if (ident === k) state.error = e;
      console.warn("iCal-Liste:", e && e.message);
    }
  }
  refreshStale();
}

async function persist() {
  if (!ident) throw fail("auth", "Nicht angemeldet.");
  if (ident === "local") { lsSet(LOCAL_KEY, JSON.stringify(feeds.map(storedOf))); return; }
  if (!hasUrls) throw fail("offline", "Die Kalender-Links konnten noch nicht geladen werden – bitte online nochmal probieren.");
  const { f, ref } = await feedDoc();
  await f.fs.setDoc(ref, { feeds: feeds.map(storedOf), updated: Date.now() });
  cacheList();
}

/* ---------- Abrufen ---------- */

async function fetchFeed(f, { fresh = false } = {}) {
  const st = fstate.get(f.id) || {};
  if (st.loading) return st.loading;
  const p = (async () => {
    await Promise.resolve(); // erst „lädt“ setzen (unten), dann arbeiten
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw fail("offline", "Offline – es werden die zuletzt geladenen Termine gezeigt.");
      const token = await idToken();
      let res;
      try {
        res = await fetch(`${serverUrl()}/ics?id=${encodeURIComponent(f.id)}${fresh ? "&fresh=1" : ""}`, { headers: { Authorization: "Bearer " + token, Accept: "text/calendar" } });
      } catch { throw fail("net", "Server nicht erreichbar – es werden die zuletzt geladenen Termine gezeigt."); }
      if (!res.ok) {
        let msg = "";
        try { msg = (await res.json()).error || ""; } catch { /* egal */ }
        // 5xx außer 502 (Link abgelehnt) = Server kurz weg → nur dezent (alte Termine bleiben)
        const transient = res.status >= 500 && res.status !== 502;
        throw fail(res.status === 401 ? "auth" : transient ? "net" : "http", msg && !transient ? msg : transient ? "Server gerade nicht erreichbar – es werden die zuletzt geladenen Termine gezeigt." : `Kalender konnte nicht geladen werden (HTTP ${res.status}).`);
      }
      const text = await res.text();
      const events = parseFeed(text);
      const at = Number(res.headers.get("x-ics-fetched-at")) || Date.now();
      const d = { at: Math.min(at, Date.now()), checked: Date.now(), events };
      data.set(f.id, d);
      fstate.set(f.id, { error: null });
      emit();
      saveData(f.id, d);
      return d;
    } catch (e) {
      fstate.set(f.id, { error: e });
      if (e.code !== "offline" && e.code !== "local") console.warn("iCal-Kalender:", e.message);
      emit();
      return null;
    }
  })();
  fstate.set(f.id, { ...st, loading: p, error: st.error || null });
  emit();
  return p;
}

/** Alle (sichtbaren) Feeds neu holen. */
export function refresh({ fresh = false, all = false } = {}) {
  return Promise.all(feeds.filter((f) => all || f.visible).map((f) => fetchFeed(f, { fresh })));
}
function refreshStale() {
  const now = Date.now();
  for (const f of feeds) {
    if (!f.visible) continue;
    const d = data.get(f.id);
    if (!d || now - (d.checked || d.at) > STALE_MS) fetchFeed(f);
  }
}

/* ---------- Öffentliche Abfragen ---------- */

export const list = () => feeds.map(publicOf);
export const hasFeeds = () => feeds.length > 0;
/** Google-Kalender-IDs, die schon über iCal-Link kommen (OAuth-Doppel ausblenden). */
export function coveredGoogleIds() { return new Set(feeds.map((f) => f.gcal).filter(Boolean)); }

/** Für die Kalenderliste. */
export function calendars() {
  return feeds.map((f) => ({ id: "f:" + f.id, feedId: f.id, name: f.name, color: f.color, visible: f.visible, kind: "feed", readOnly: true, hint: f.gcal ? "iCal-Link (Google)" : "iCal-Link" }));
}

let holOn = true;
export function setBuiltinHolidays(on) { if (holOn !== (on !== false)) { holOn = on !== false; memo.clear(); } }
function skipHoliday(key) {
  if (!holOn) return false;
  try { return !!holidayName(new Date(key + "T12:00:00").getTime()); } catch { return false; }
}

/** Instanzen der sichtbaren Feeds in [from, to] (sofort aus dem Zwischenspeicher). */
export function instancesFor(from, to, visible = () => true) {
  const out = [];
  for (const f of feeds) {
    if (!f.visible || !visible("f:" + f.id)) continue;
    const d = data.get(f.id);
    if (!d) continue;
    const mk = `${f.id}|${from}|${to}|${holOn}|${ver}`;
    let res = memo.get(mk);
    if (!res) {
      try { res = expandFeed(d.events, f, from, to, { skipHoliday }); } catch (e) { console.error(e); res = []; }
      if (memo.size > 60) memo.clear();
      memo.set(mk, res);
    }
    for (const i of res) out.push(i);
  }
  return out;
}

export function find(uid) {
  const m = /^f:([^|]+)\|/.exec(String(uid || ""));
  if (!m) return null;
  const f = feeds.find((x) => x.id === m[1]);
  const d = data.get(m[1]);
  if (!f || !d) return null;
  const key = String(uid).split("|").pop();
  // gezielt den Tag aufklappen, an dem die Instanz liegt (±40 Tage wegen mehrtägiger Termine)
  const from = new Date(Date.parse(key + "T12:00:00Z") - 40 * 864e5).toISOString().slice(0, 10);
  const to = new Date(Date.parse(key + "T12:00:00Z") + 40 * 864e5).toISOString().slice(0, 10);
  return expandFeed(d.events, f, from, to).find((i) => i.uid === uid) || null;
}
export function calName(calId) { const f = feeds.find((x) => "f:" + x.id === calId); return f ? f.name : "Kalender"; }

/** „vor 3 Min.“ */
export function ago(ts, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

/** Statuszeile eines Feeds: {text, bad}. */
export function status(id) {
  const st = fstate.get(id) || {};
  const d = data.get(id);
  if (st.loading && !d) return { text: "Wird zum ersten Mal geladen …", bad: false };
  const when = d ? ` · aktualisiert ${ago(d.at)}` : "";
  if (st.error) return { text: `${st.error.message}${d ? ` (Stand ${ago(d.at)})` : ""}`, bad: st.error.code === "http" || st.error.code === "auth" };
  if (st.loading) return { text: `Verbunden über iCal-Link${when} · lädt …`, bad: false };
  if (d) return { text: `Verbunden über iCal-Link${when}`, bad: false };
  return { text: "Noch nicht geladen", bad: false };
}
export const isLoading = () => [...fstate.values()].some((s) => s.loading);

/* ---------- Ändern ---------- */

/** Neuen Feed anlegen. → Feed (öffentlich) oder wirft Error mit deutscher Meldung. */
export async function addFeed({ url, name, color }) {
  const chk = checkFeedUrl(url);
  if (!chk.ok) throw fail("invalid", chk.error);
  if (feeds.some((f) => f.url && f.url === chk.url)) throw fail("dup", "Diesen Kalender-Link hast du schon eingetragen.");
  if (feeds.length >= 20) throw fail("limit", "Höchstens 20 Kalender-Links.");
  const f = derive({ id: newId(), name: String(name || "").trim() || suggestName(chk.url), color: color || "pfau", url: chk.url, visible: true });
  const before = feeds;
  feeds = [...feeds, f];
  try { await persist(); } catch (e) { feeds = before; throw e; }
  emit();
  fetchFeed(f, { fresh: true });
  return publicOf(f);
}

export async function updateFeed(id, patch) {
  const i = feeds.findIndex((f) => f.id === id);
  if (i < 0) return;
  const before = feeds;
  const cur = feeds[i];
  const next = derive({ ...cur, ...(patch.name != null ? { name: String(patch.name).trim() || cur.name } : {}), ...(patch.color ? { color: patch.color } : {}), ...(patch.visible != null ? { visible: !!patch.visible } : {}) });
  feeds = feeds.map((f, n) => (n === i ? next : f));
  emit();
  try { await persist(); } catch (e) { feeds = before; emit(); throw e; }
  if (next.visible && !data.has(id)) fetchFeed(next);
}

export async function removeFeed(id) {
  const before = feeds;
  feeds = feeds.filter((f) => f.id !== id);
  emit();
  try { await persist(); } catch (e) { feeds = before; emit(); throw e; }
  data.delete(id); fstate.delete(id);
  dropData(id);
  emit();
}

/* ---------- Start ---------- */

store.subscribe((s) => { const k = identOf(s); if (k !== ident) switchTo(k); });
try { const k = identOf(store.get()); if (k !== ident) switchTo(k); } catch { /* Store noch nicht bereit */ }

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshStale(); });
  setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, REFRESH_MS);
  window.addEventListener("online", () => refreshStale());
}
