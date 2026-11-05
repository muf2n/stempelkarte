// Gmail (nur lesen) für die Abo-Erkennung – läuft ausschließlich im Browser/in der App.
// Das OAuth-Zugriffstoken (≈ 55 Min. gültig) liegt im Speicher und bis zum Ablauf in local-/sessionStorage
// (damit ein Neuladen keine neue Freigabe braucht); bei 401/403 oder „Trennen“ wird es sofort verworfen.
// In Firestore/lokal landet nur money_gmail/meta = {connected, lastScan, found, handled:[…]} (über db.js).
//
//   await connectGmail()              // MUSS direkt aus einem Tipp heraus aufgerufen werden (Popup-Blocker)
//   const mails = await fetchMails({ onProgress })  // [{id, date, from, subject, text}]
//
// Fehler haben err.code: "scope" | "popup" | "offline" | "auth" | "cancel" | "local" | "net"

import { getFirebase } from "../firebase.js";
import { firebaseConfig, isConfigured } from "../firebase-config.js";
import { isNative, plugin } from "../native.js";
import { mailFromGmail } from "./subs-detect.js";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const TOKEN_MS = 55 * 60 * 1000;
const MAX_MAILS = 150;
const BATCH = 10;

export const QUERY = 'newer_than:400d (subject:(abo OR abonnement OR subscription OR mitgliedschaft OR "your receipt" OR rechnung OR beleg OR bestellbestätigung OR "trial" OR testzeitraum OR gekündigt OR kündigung OR cancelled OR verlängert OR renewal) OR from:(googleplay-noreply@google.com OR no_reply@email.apple.com OR netflix OR spotify OR amazon OR disneyplus OR youtube OR paypal))';

const TOK_KEY = "stempelkarte.gmail.tok";
let tok = null; // { token, exp }

/** Token bis zum Ablauf merken (Neuladen innerhalb der Stunde ohne neue Freigabe). */
function saveTok() {
  const v = tok ? JSON.stringify(tok) : null;
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
tok = loadTok();
if (!tok) saveTok();

const isLocalHost = () => {
  try { return ["localhost", "127.0.0.1"].includes(location.hostname); } catch { return false; }
};

/** Test-Haken: nur auf localhost wird window.__gmailTestToken gelesen (Playwright). */
function testToken() {
  if (!isLocalHost()) return null;
  try { return typeof window.__gmailTestToken === "string" && window.__gmailTestToken ? window.__gmailTestToken : null; } catch { return null; }
}

export function hasToken() {
  if (testToken()) return true;
  return !!(tok && tok.exp > Date.now());
}

export function forgetToken() { tok = null; saveTok(); }

function gErr(code, message, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

export const ERR_TEXT = {
  scope: "Gmail-Zugriff noch nicht freigegeben – siehe Anleitung.",
  popup: "Das Anmelde-Fenster wurde blockiert. Bitte Pop-ups für diese Seite erlauben und nochmal tippen.",
  offline: "Keine Internetverbindung – Mails können gerade nicht geprüft werden.",
  auth: "Die Gmail-Freigabe ist abgelaufen. Bitte nochmal „Mails prüfen“ tippen.",
  cancel: "Abgebrochen.",
  mismatch: "Bitte dasselbe Google-Konto wählen, mit dem du in der App angemeldet bist.",
  local: "Im lokalen Modus ohne Firebase-Einrichtung ist kein Gmail-Zugriff möglich.",
  net: "Gmail ist gerade nicht erreichbar. Bitte später nochmal probieren.",
};

function mapAuthError(err) {
  const code = String((err && err.code) || "");
  const msg = String((err && err.message) || "");
  if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return gErr("popup", ERR_TEXT.popup, err);
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled" || /cancel|abgebrochen|12501/i.test(msg)) return gErr("cancel", ERR_TEXT.cancel, err);
  if (code === "auth/network-request-failed") return gErr("offline", ERR_TEXT.offline, err);
  if (code === "auth/user-mismatch") return gErr("mismatch", ERR_TEXT.mismatch, err);
  if (/access_denied|scope|insufficient/i.test(msg + code)) return gErr("scope", ERR_TEXT.scope, err);
  return gErr("net", "Gmail-Verbindung fehlgeschlagen" + (code ? " (" + code + ")" : "") + ".", err);
}

let warm = null;
/** Firebase vorab laden, damit das Popup beim Tippen sofort (ohne Netz-Wartezeit) aufgeht. */
export function prepare() {
  if (warm || isNative() || !isConfigured()) return warm;
  warm = getFirebase().then(async (f) => {
    if (f && !f.auth.currentUser) await secondaryAuth(f);
    return f;
  }).catch(() => { warm = null; return null; });
  return warm;
}

let secondary = null;
// UNSICHER: Im lokalen Modus (ohne Anmeldung) wird eine zweite Firebase-App-Instanz nur für das Gmail-Popup benutzt,
// damit die eigentliche App nicht angemeldet wird. Nicht mit einem echten Konto getestet.
async function secondaryAuth(f) {
  if (secondary) return secondary;
  const fapp = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const app = fapp.getApps().find((a) => a.name === "gmail") || fapp.initializeApp(firebaseConfig, "gmail");
  const auth = f.fa.getAuth(app);
  try { await f.fa.setPersistence(auth, f.fa.inMemoryPersistence); } catch { /* egal */ }
  secondary = auth;
  return auth;
}

/**
 * Zugriffstoken holen (Popup). email = login_hint. Direkt aus dem Klick-Handler aufrufen!
 * → Token-String
 */
export async function connectGmail(email = "") {
  const t = testToken();
  if (t) return t;
  if (hasToken()) return tok.token;
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw gErr("offline", ERR_TEXT.offline);

  if (isNative()) {
    // UNSICHER: @capacitor-firebase/authentication – signInWithGoogle({scopes}) soll credential.accessToken mit Gmail-Scope liefern.
    // Ob die native Google-Anmeldung zusätzliche Scopes anfragt, hängt von Plugin-Version/Konfiguration ab (nicht am Gerät getestet).
    const FA = plugin("FirebaseAuthentication");
    if (!FA) throw gErr("net", "Anmelde-Modul der App fehlt.");
    let res;
    try { res = await FA.signInWithGoogle({ scopes: [GMAIL_SCOPE], customParameters: email ? [{ key: "login_hint", value: email }] : undefined }); }
    catch (err) { throw mapAuthError(err); }
    const at = res && res.credential && res.credential.accessToken;
    if (!at) throw gErr("cancel", ERR_TEXT.cancel);
    tok = { token: at, exp: Date.now() + TOKEN_MS };
    saveTok();
    return at;
  }

  if (!isConfigured()) throw gErr("local", ERR_TEXT.local);
  let f;
  try { f = await (warm || getFirebase()); }
  catch (err) { throw gErr(navigator.onLine === false ? "offline" : "net", navigator.onLine === false ? ERR_TEXT.offline : "Google-Anmeldung konnte nicht geladen werden – bitte Internetverbindung prüfen.", err); }
  if (!f) throw gErr("local", ERR_TEXT.local);
  const { auth, fa } = f;
  const provider = new fa.GoogleAuthProvider();
  provider.addScope(GMAIL_SCOPE);
  const hint = email || (auth.currentUser && auth.currentUser.email) || "";
  // prompt=consent: Google fragt die Gmail-Freigabe sicher neu ab (sonst bleibt ein früher nicht gesetztes Häkchen „hängen“)
  provider.setCustomParameters(hint ? { login_hint: hint, prompt: "consent" } : { prompt: "consent select_account" });

  let res = null;
  try {
    if (auth.currentUser) {
      try { res = await fa.reauthenticateWithPopup(auth.currentUser, provider); }
      catch (err) {
        const c = String(err && err.code || "");
        if (c === "auth/no-such-provider" || c === "auth/provider-not-linked" || c === "auth/user-not-found") res = await fa.linkWithPopup(auth.currentUser, provider);
        else throw err;
      }
    } else {
      let a2;
      try { a2 = await secondaryAuth(f); }
      catch (err) { throw Object.assign(new Error("load"), { code: "auth/network-request-failed", cause: err }); }
      res = await fa.signInWithPopup(a2, provider);
    }
  } catch (err) { throw mapAuthError(err); }
  const cred = fa.GoogleAuthProvider.credentialFromResult(res);
  const at = cred && cred.accessToken;
  if (!at) throw gErr("scope", ERR_TEXT.scope);
  tok = { token: at, exp: Date.now() + TOKEN_MS };
  saveTok();
  return at;
}

async function api(path, token) {
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      r = await fetch(API + path, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
    } catch (err) {
      throw gErr(navigator.onLine === false ? "offline" : "net", navigator.onLine === false ? ERR_TEXT.offline : ERR_TEXT.net, err);
    }
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1))); continue; }
    break;
  }
  if (r.ok) return r.json();
  let body = null;
  try { body = await r.json(); } catch { /* egal */ }
  const reason = JSON.stringify(body || "");
  if (r.status === 401) { forgetToken(); throw gErr("auth", ERR_TEXT.auth); }
  if (r.status === 403 || /insufficient|PERMISSION_DENIED|ACCESS_TOKEN_SCOPE/i.test(reason)) {
    forgetToken();
    // genauer sagen, was fehlt
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) {
      throw gErr("scope", "Die Gmail API ist im Google-Projekt „stempelkarte-40682“ noch nicht aktiviert (Schritt 1 der Anleitung). Nach dem Aktivieren ein paar Minuten warten.");
    }
    if (/insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i.test(reason)) {
      throw gErr("scope", "Google hat den Gmail-Zugriff nicht mitgegeben. Tippe „Trennen“, dann „Mit Gmail verbinden“ – und setz im Google-Fenster unbedingt das Häkchen bei „E-Mails ansehen“.");
    }
    const msg = body && body.error && body.error.message ? String(body.error.message).slice(0, 160) : "";
    throw gErr("scope", ERR_TEXT.scope + (msg ? " (Google: " + msg + ")" : ""));
  }
  throw gErr("net", ERR_TEXT.net + " (HTTP " + r.status + ")");
}

/**
 * Passende Mails laden (max. 150, je 10 parallel). onProgress(done, total).
 * → [{id, date, from, subject, text}] – nur im Speicher.
 */
export async function fetchMails({ onProgress, token } = {}) {
  const at = token || testToken() || (hasToken() && tok.token);
  if (!at) throw gErr("auth", ERR_TEXT.auth);
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw gErr("offline", ERR_TEXT.offline);
  const ids = [];
  let pageToken = "";
  do {
    const q = "messages?maxResults=" + Math.min(100, MAX_MAILS - ids.length) + "&q=" + encodeURIComponent(QUERY) + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    const res = await api(q, at);
    for (const m of res.messages || []) if (m && m.id && ids.length < MAX_MAILS) ids.push(m.id);
    pageToken = res.nextPageToken || "";
  } while (pageToken && ids.length < MAX_MAILS);

  const mails = [];
  let done = 0;
  if (onProgress) onProgress(0, ids.length);
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const got = await Promise.all(chunk.map((id) => api("messages/" + encodeURIComponent(id) + "?format=full", at).then(mailFromGmail).catch((err) => {
      if (err && (err.code === "auth" || err.code === "scope" || err.code === "offline")) throw err;
      console.warn("Gmail-Nachricht übersprungen:", id, err && err.message);
      return null;
    })));
    for (const m of got) if (m) mails.push(m);
    done += chunk.length;
    if (onProgress) onProgress(done, ids.length);
  }
  return mails;
}
