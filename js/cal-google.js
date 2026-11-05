// Update 9 – Google Kalender (nur lesen). Gleiches Muster wie js/alltag/gmail.js:
// Zugriffstoken per reauthenticateWithPopup mit Zusatz-Scope (≈ 55 Min. gültig). Das Token liegt bis zum Ablauf
// zusätzlich in local-/sessionStorage, damit ein Neuladen innerhalb der Stunde keine neue Freigabe braucht;
// bei 401 wird es still verworfen (kleiner Knopf „Google neu verbinden“). Dauerhaft ohne Ablauf: iCal-Link (cal-feeds.js).
// Termine werden nur im Speicher/sessionStorage zwischengespeichert, nie in Firestore.
//
//   await connect()                    // direkt aus einem Tipp heraus (Popup-Blocker)
//   instancesFor(from, to)             // → bereits geladene Instanzen (sync); lädt fehlende Monate im Hintergrund
//   onChange(cb)                       // nach dem Laden neu zeichnen
// Fehler: err.code "scope" | "popup" | "offline" | "auth" | "cancel" | "local" | "net" | "mismatch"

import { getFirebase } from "./firebase.js";
import { firebaseConfig, isConfigured } from "./firebase-config.js";
import { isNative, plugin } from "./native.js";
import { zoned, addDays, diffDays, toMin, hhmm, parseKey } from "./cal-core.js";
import { holidayName } from "./util.js";

export const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const API = "https://www.googleapis.com/calendar/v3/";
const TOKEN_MS = 55 * 60 * 1000;
const SS_KEY = "stempelkarte.gcal.v1";
const WAS_KEY = "stempelkarte.gcalConnected";
const TOK_KEY = "stempelkarte.gcal.tok";
const IDS_KEY = "stempelkarte.gcal.ids"; // zuletzt bekannte Kalender-IDs (für „schon über iCal-Link verbunden?“)
const pad = (n) => String(n).padStart(2, "0");

let tok = null;            // { token, exp }
let calList = null;        // [{id, summary, backgroundColor, primary, accessRole}]
const months = new Map();  // "calId|YYYY-MM" → [inst]
const pending = new Set();
const listeners = new Set();
export const state = { connected: false, loading: 0, error: null, wasConnected: false };
try { state.wasConnected = localStorage.getItem(WAS_KEY) === "1"; } catch { /* egal */ }

/** Token bis zum Ablauf in local- und sessionStorage (alles in try/catch – privates Fenster, voll …). */
let expTimer = null;
function saveTok() {
  clearTimeout(expTimer);
  // Ablauf: still trennen → kleiner „Google neu verbinden“-Knopf statt Fehler
  if (tok && !testToken()) expTimer = setTimeout(() => { if (tok && tok.exp <= Date.now() + 1000) { dropToken(); emit(); } }, Math.max(1000, Math.min(2147483000, tok.exp - Date.now())));
  const v = tok ? JSON.stringify({ token: tok.token, exp: tok.exp }) : null;
  for (const st of ["localStorage", "sessionStorage"]) {
    try { const s = globalThis[st]; if (!s) continue; if (v) s.setItem(TOK_KEY, v); else s.removeItem(TOK_KEY); } catch { /* egal */ }
  }
}
function loadTok() {
  for (const st of ["sessionStorage", "localStorage"]) {
    try {
      const raw = globalThis[st] && globalThis[st].getItem(TOK_KEY);
      if (!raw) continue;
      const t = JSON.parse(raw);
      if (t && typeof t.token === "string" && t.token && Number(t.exp) > Date.now() + 60000) return { token: t.token, exp: Number(t.exp) };
    } catch { /* egal */ }
  }
  return null;
}
/** Token still verwerfen (abgelaufen/401). */
function dropToken() { tok = null; saveTok(); state.connected = false; }
/** Zuletzt bekannte Google-Kalender-IDs (auch ohne gültiges Token). */
export function knownIds() {
  try { const a = JSON.parse(localStorage.getItem(IDS_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; }
}

// Standardfarben von Google für colorId 1–11 (Termin-Farben)
const EVENT_COLORS = { 1: "#7986CB", 2: "#33B679", 3: "#8E24AA", 4: "#E67C73", 5: "#F6BF26", 6: "#F4511E", 7: "#039BE5", 8: "#616161", 9: "#3F51B5", 10: "#0B8043", 11: "#D50000" };

const isLocalHost = () => { try { return ["localhost", "127.0.0.1"].includes(location.hostname); } catch { return false; } };
/** Test-Haken: nur auf localhost wird window.__gcalTestToken gelesen (Playwright). */
function testToken() {
  if (!isLocalHost()) return null;
  try { return typeof window.__gcalTestToken === "string" && window.__gcalTestToken ? window.__gcalTestToken : null; } catch { return null; }
}
export function hasToken() { return !!testToken() || !!(tok && tok.exp > Date.now()); }
function token() { return testToken() || (tok && tok.exp > Date.now() ? tok.token : null); }

function gErr(code, message, cause) { const e = new Error(message); e.code = code; if (cause) e.cause = cause; return e; }
export const ERR_TEXT = {
  scope: "Google Kalender ist noch nicht freigegeben – siehe Anleitung.",
  popup: "Das Anmelde-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben und nochmal tippen.",
  offline: "Keine Internetverbindung – Google-Termine können gerade nicht geladen werden.",
  auth: "Die Google-Freigabe ist abgelaufen. Bitte „Google neu verbinden“ tippen.",
  cancel: "Abgebrochen.",
  mismatch: "Bitte dasselbe Google-Konto wählen, mit dem du in der App angemeldet bist.",
  local: "Im lokalen Modus ohne Firebase-Einrichtung ist keine Google-Verbindung möglich.",
  net: "Google Kalender ist gerade nicht erreichbar. Bitte später nochmal probieren.",
};

function mapAuthError(err) {
  const code = String((err && err.code) || "");
  const msg = String((err && err.message) || "");
  if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return gErr("popup", ERR_TEXT.popup, err);
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled" || /cancel|abgebrochen|12501/i.test(msg)) return gErr("cancel", ERR_TEXT.cancel, err);
  if (code === "auth/network-request-failed") return gErr("offline", ERR_TEXT.offline, err);
  if (code === "auth/user-mismatch") return gErr("mismatch", ERR_TEXT.mismatch, err);
  if (/access_denied|scope|insufficient/i.test(msg + code)) return gErr("scope", ERR_TEXT.scope, err);
  return gErr("net", "Google-Verbindung fehlgeschlagen" + (code ? " (" + code + ")" : "") + ".", err);
}

let secondary = null;
// UNSICHER (wie gmail.js): im lokalen Modus eigene Firebase-App-Instanz nur für das Popup – nicht mit echtem Konto getestet.
async function secondaryAuth(f) {
  if (secondary) return secondary;
  const fapp = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const app = fapp.getApps().find((a) => a.name === "gcal") || fapp.initializeApp(firebaseConfig, "gcal");
  const auth = f.fa.getAuth(app);
  try { await f.fa.setPersistence(auth, f.fa.inMemoryPersistence); } catch { /* egal */ }
  secondary = auth;
  return auth;
}

let warm = null;
/** Firebase vorab laden, damit das Popup beim Tippen sofort aufgeht. */
export function prepare() {
  if (warm || isNative() || !isConfigured() || testToken()) return warm;
  warm = getFirebase().then(async (f) => { if (f && !f.auth.currentUser) await secondaryAuth(f); return f; }).catch(() => { warm = null; return null; });
  return warm;
}

/** Zugriffstoken holen (Popup) und Kalender laden. Direkt aus dem Klick-Handler aufrufen! */
export async function connect(email = "") {
  const tt = testToken();
  if (tt && !(tok && tok.token === tt)) { tok = { token: tt, exp: Date.now() + TOKEN_MS }; saveTok(); }
  if (!tt && !hasToken()) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw gErr("offline", ERR_TEXT.offline);
    if (isNative()) {
      // UNSICHER: wie gmail.js – Zusatz-Scope über @capacitor-firebase/authentication (nicht am Gerät getestet).
      const FA = plugin("FirebaseAuthentication");
      if (!FA) throw gErr("net", "Anmelde-Modul der App fehlt.");
      let res;
      try { res = await FA.signInWithGoogle({ scopes: [GCAL_SCOPE], customParameters: email ? [{ key: "login_hint", value: email }] : undefined }); }
      catch (err) { throw mapAuthError(err); }
      const at = res && res.credential && res.credential.accessToken;
      if (!at) throw gErr("cancel", ERR_TEXT.cancel);
      tok = { token: at, exp: Date.now() + TOKEN_MS };
      saveTok();
    } else {
      if (!isConfigured()) throw gErr("local", ERR_TEXT.local);
      let f;
      try { f = await (warm || getFirebase()); }
      catch (err) { throw gErr(navigator.onLine === false ? "offline" : "net", navigator.onLine === false ? ERR_TEXT.offline : "Google-Anmeldung konnte nicht geladen werden – bitte Internetverbindung prüfen.", err); }
      if (!f) throw gErr("local", ERR_TEXT.local);
      const { auth, fa } = f;
      const provider = new fa.GoogleAuthProvider();
      provider.addScope(GCAL_SCOPE);
      const hint = email || (auth.currentUser && auth.currentUser.email) || "";
      provider.setCustomParameters(hint ? { login_hint: hint } : { prompt: "select_account" });
      let res = null;
      try {
        if (auth.currentUser) {
          try { res = await fa.reauthenticateWithPopup(auth.currentUser, provider); }
          catch (err) {
            const c = String(err && err.code || "");
            if (c === "auth/no-such-provider" || c === "auth/provider-not-linked" || c === "auth/user-not-found") res = await fa.linkWithPopup(auth.currentUser, provider);
            else throw err;
          }
        } else res = await fa.signInWithPopup(await secondaryAuth(f), provider);
      } catch (err) { throw mapAuthError(err); }
      const cred = fa.GoogleAuthProvider.credentialFromResult(res);
      const at = cred && cred.accessToken;
      if (!at) throw gErr("scope", ERR_TEXT.scope);
      tok = { token: at, exp: Date.now() + TOKEN_MS };
      saveTok();
      saveTok();
    }
  }
  state.error = null;
  await loadCalendars();
  state.connected = true;
  state.wasConnected = true;
  try { localStorage.setItem(WAS_KEY, "1"); } catch { /* egal */ }
  emit();
  return calList;
}

export function disconnect() {
  tok = null; saveTok(); calList = null; months.clear();
  state.connected = false; state.wasConnected = false; state.error = null;
  try { localStorage.removeItem(WAS_KEY); sessionStorage.removeItem(SS_KEY); } catch { /* egal */ }
  emit();
}

async function api(path) {
  const at = token();
  if (!at) throw gErr("auth", ERR_TEXT.auth);
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { r = await fetch(API + path, { headers: { Authorization: "Bearer " + at, Accept: "application/json" } }); }
    catch (err) { throw gErr(navigator.onLine === false ? "offline" : "net", navigator.onLine === false ? ERR_TEXT.offline : ERR_TEXT.net, err); }
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 500 * (attempt + 1))); continue; }
    break;
  }
  if (r.ok) return r.json();
  let body = null;
  try { body = await r.json(); } catch { /* egal */ }
  const reason = JSON.stringify(body || "");
  if (r.status === 401) { dropToken(); throw gErr("auth", ERR_TEXT.auth); }
  if (r.status === 403 || /insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE|accessNotConfigured|SERVICE_DISABLED/i.test(reason)) {
    const e = gErr("scope", ERR_TEXT.scope);
    e.apiDisabled = /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason);
    throw e;
  }
  throw gErr("net", ERR_TEXT.net + " (HTTP " + r.status + ")");
}

async function loadCalendars() {
  const out = [];
  let pageToken = "";
  do {
    const res = await api("users/me/calendarList?maxResults=250" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""));
    for (const c of res.items || []) if (c && c.id && !c.deleted) out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, backgroundColor: c.backgroundColor || "#4285F4", primary: !!c.primary, selected: c.selected !== false });
    pageToken = res.nextPageToken || "";
  } while (pageToken);
  calList = out;
  try { localStorage.setItem(IDS_KEY, JSON.stringify(out.map((c) => c.id))); } catch { /* egal */ }
  restoreCache();
  return out;
}

/** Kalender (für die Kalenderliste) → [{id:"g:…", name, color, gid, primary}] */
export function calendars() {
  return (calList || []).map((c) => ({ id: "g:" + c.id, gid: c.id, name: c.summary, color: c.backgroundColor, primary: c.primary, defaultVisible: c.selected }));
}

/* ---------- Termine ---------- */

/** Google-Zeit → {date, time|null} in Wien. */
function gTime(t) {
  if (!t) return null;
  if (t.date) return { date: t.date, time: null };
  if (t.dateTime) { const z = zoned(Date.parse(t.dateTime)); return { date: z.key, time: z.time }; }
  return null;
}

/** Google-Termin → Instanz (gleiches Format wie cal-core expandTodo). */
export function instFromGoogle(e, cal) {
  const s = gTime(e.start), en = gTime(e.end);
  if (!s) return null;
  const allDay = !s.time;
  const inst = {
    uid: `g${cal.id}|${e.id}`, id: e.id, key: s.date, recurring: !!e.recurringEventId, overridden: false,
    title: String(e.summary || "(ohne Titel)"), date: s.date, allDay, time: s.time,
    location: String(e.location || ""), note: String(e.description || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
    color: e.colorId && EVENT_COLORS[e.colorId] ? EVENT_COLORS[e.colorId] : cal.backgroundColor, calendarId: "g:" + cal.id,
    htmlLink: e.htmlLink || "", cat: null, done: false, ext: true, t: null,
  };
  if (allDay) {
    const endEx = en && en.date > s.date ? en.date : addDays(s.date, 1);
    inst.endDate = addDays(endEx, -1);
    inst.endTime = null;
    inst.startMin = 0;
    inst.durMin = (diffDays(s.date, endEx)) * 1440;
  } else {
    const ed = en || s;
    inst.startMin = toMin(s.time);
    inst.durMin = Math.max(15, diffDays(s.date, ed.date) * 1440 + toMin(ed.time) - toMin(s.time));
    const endAbs = inst.startMin + inst.durMin;
    const rem = endAbs % 1440, days = Math.floor(endAbs / 1440);
    inst.endDate = rem === 0 && days > 0 ? addDays(s.date, days - 1) : addDays(s.date, days);
    inst.endTime = rem === 0 && days > 0 ? "24:00" : hhmm(rem);
  }
  inst.endAbs = inst.startMin + inst.durMin;
  inst.lastDay = inst.endDate;
  return inst;
}

function monthKeys(from, to) {
  const out = [];
  let { y, m } = parseKey(from);
  const e = parseKey(to);
  while (y < e.y || (y === e.y && m <= e.m)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

async function loadMonth(cal, mk) {
  const id = `${cal.id}|${mk}`;
  if (months.has(id) || pending.has(id)) return;
  pending.add(id);
  state.loading++;
  emit();
  try {
    const [y, m] = mk.split("-").map(Number);
    // eine Woche Puffer für mehrtägige Termine
    const timeMin = new Date(Date.UTC(y, m - 1, 1) - 7 * 864e5).toISOString();
    const timeMax = new Date(Date.UTC(y, m, 1) + 864e5).toISOString();
    const list = [];
    let pageToken = "";
    do {
      const res = await api(`calendars/${encodeURIComponent(cal.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500` +
        `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`);
      for (const e of res.items || []) { if (e && e.status !== "cancelled") { const i = instFromGoogle(e, cal); if (i) list.push(i); } }
      pageToken = res.nextPageToken || "";
    } while (pageToken);
    months.set(id, list);
    saveCache();
  } catch (e) {
    if (e && e.code === "auth") { state.connected = false; state.error = null; } // still: nur der kleine „neu verbinden“-Knopf
    else { state.error = e; console.warn("Google Kalender:", e && e.message); }
  } finally {
    pending.delete(id);
    state.loading--;
    emit();
  }
}

/**
 * Instanzen der sichtbaren Google-Kalender im Bereich (sofort aus dem Zwischenspeicher);
 * fehlende Monate werden im Hintergrund geladen (danach onChange).
 * visible(id) → bool
 */
export function instancesFor(from, to, visible = () => true) {
  if (!calList || !calList.length) return [];
  const out = [];
  const seen = new Set();
  for (const cal of calList) {
    if (!visible("g:" + cal.id)) continue;
    for (const mk of monthKeys(from, to)) {
      const list = months.get(`${cal.id}|${mk}`);
      if (!list) { if (hasToken() && !state.error) loadMonth(cal, mk); continue; }
      const isHolCal = /#holiday@group\.v\.calendar\.google\.com$/i.test(String(cal.id));
      for (const i of list) {
        if (seen.has(i.uid) || i.date > to || i.lastDay < from) continue;
        // Google-Feiertagskalender: gesetzliche Feiertage zeigt die App schon selbst → nicht doppelt
        if (isHolCal && i.allDay !== false && skipHoliday(i.date)) continue;
        seen.add(i.uid);
        out.push(i);
      }
    }
  }
  return out;
}

let holOn = true;
/** Eingebaute Feiertage an/aus (settings.holidays) – nur dann werden Google-Feiertage ausgeblendet. */
export function setBuiltinHolidays(on) { holOn = on !== false; }
function skipHoliday(key) {
  if (!holOn) return false;
  try { return !!holidayName(new Date(key + "T12:00:00").getTime()); } catch { return false; }
}

export function find(uid) {
  for (const list of months.values()) { const i = list.find((x) => x.uid === uid); if (i) return i; }
  return null;
}
export function calName(id) { const c = (calList || []).find((x) => "g:" + x.id === id); return c ? c.summary : "Google"; }

/** Alle geladenen Termine erneut holen. */
export function refresh() { months.clear(); state.error = null; try { sessionStorage.removeItem(SS_KEY); } catch { /* egal */ } emit(); }

export function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
let emitQueued = false;
function emit() {
  if (emitQueued) return;
  emitQueued = true;
  setTimeout(() => { emitQueued = false; for (const cb of [...listeners]) { try { cb(state); } catch (e) { console.error(e); } } }, 30);
}

function saveCache() {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify({ at: Date.now(), cals: calList, months: [...months.entries()] })); } catch { /* voll – egal */ }
}
function restoreCache() {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || Date.now() - d.at > 30 * 60000) return;
    for (const [k, v] of d.months || []) if (!months.has(k)) months.set(k, v);
  } catch { /* egal */ }
}

/* ---------- Nach dem Neuladen: gespeichertes Token weiterverwenden ---------- */

tok = loadTok();
if (!tok) saveTok(); // abgelaufenes aufräumen
let resumeP = null;
/** Mit gespeichertem Token (ohne Popup) wieder verbinden. Fehler still → kleiner Knopf. */
export function resume() {
  if (resumeP || state.connected || !hasToken()) return resumeP;
  resumeP = (async () => {
    try {
      await loadCalendars();
      state.connected = true; state.wasConnected = true; state.error = null;
      try { localStorage.setItem(WAS_KEY, "1"); } catch { /* egal */ }
    } catch (e) {
      if (e && e.code !== "auth") { state.error = e; console.warn("Google Kalender:", e && e.message); }
    } finally { resumeP = null; emit(); }
  })();
  return resumeP;
}
if (tok && state.wasConnected) setTimeout(() => { if (typeof navigator === "undefined" || navigator.onLine !== false) resume(); }, 0);
