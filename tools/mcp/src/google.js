// Google-Dienstkonto: Schlüssel tolerant einlesen (wie tools/reminders/send.mjs), JWT mit RS256
// über WebCrypto signieren, OAuth2-Zugriffstoken holen und ~50 Minuten zwischenspeichern,
// Firebase-UID des Nutzers per Identity Toolkit (accounts:lookup) ermitteln.
// Nie Schlüssel, Tokens oder Inhalte protokollieren.

export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPES = [
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/identitytoolkit",
  "https://www.googleapis.com/auth/cloud-platform",
].join(" ");
export const DEFAULT_PROJECT = "stempelkarte-40682";
export const DEFAULT_EMAIL = "lippa.florian@gmail.com";

/** Wie send.mjs parseAccount: „schöne“ Anführungszeichen, unsichtbare Zeichen, echte Umbrüche. */
export function parseAccount(text) {
  const tries = [];
  let t = String(text ?? "").replace(/^﻿/, "").trim();
  tries.push(t);
  t = t.replace(/[​-‍⁠­]/g, "")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/ /g, " ");
  tries.push(t);
  tries.push(t.replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\r?\n/g, "\\n")));
  let lastErr;
  for (const c of tries) {
    try { return JSON.parse(c); } catch (e) { lastErr = e; }
  }
  const m = /position (\d+)/.exec((lastErr && lastErr.message) || "");
  // Bewusst NICHT lastErr.message weitergeben: kann einen Ausschnitt des Geheimnisses enthalten.
  throw new Error(`FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON (Lesefehler an Stelle ${m ? m[1] : "?"}, Länge ${t.length}).`);
}

/** Wie send.mjs repairPem: Schlüssel aus „MII…“ bis „END“ neu zusammensetzen. */
export function repairPem(k) {
  const t = String(k).replace(/\\n/g, "\n").replace(/[‐-―−]/g, "-");
  const b = t.indexOf("BEGIN"), e = t.lastIndexOf("END");
  const start = b >= 0 ? t.indexOf("MII", b) : -1;
  if (!(start >= 0 && e > start)) return t;
  const body = t.slice(start, e).replace(/[^A-Za-z0-9+/=]/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/** Dienstkonto aus env lesen und prüfen. */
export function loadAccount(raw) {
  if (!String(raw || "").trim()) throw new Error("FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt.");
  const acc = parseAccount(raw);
  if (acc.type !== "service_account" || !acc.private_key || !acc.client_email) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein Dienstkonto-Schlüssel (type/private_key/client_email fehlt).");
  }
  return { ...acc, private_key: repairPem(acc.private_key) };
}

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyCache = new Map(); // client_email → CryptoKey

async function importKey(acc) {
  const k = acc.client_email + "|" + acc.private_key.length;
  if (keyCache.has(k)) return keyCache.get(k);
  let key;
  try {
    key = await crypto.subtle.importKey("pkcs8", pemToDer(acc.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Error("Privater Schlüssel des Dienstkontos ist ungültig (PKCS#8 erwartet).");
  }
  keyCache.set(k, key);
  return key;
}

/** Signiertes JWT (RS256) für den Token-Austausch. */
export async function signJwt(acc, { scope = SCOPES, now = Date.now(), aud = TOKEN_URL } = {}) {
  const iat = Math.floor(now / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  if (acc.private_key_id) header.kid = acc.private_key_id;
  const claims = { iss: acc.client_email, sub: acc.client_email, scope, aud, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await importKey(acc);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

const tokenCache = new Map(); // client_email → {token, exp}
const CACHE_MS = 50 * 60 * 1000;

export function clearCaches() { tokenCache.clear(); keyCache.clear(); uidCache.clear(); }

/** OAuth2-Zugriffstoken (zwischengespeichert, höchstens 50 min bzw. bis kurz vor Ablauf). */
export async function getAccessToken(acc, fetchImpl = fetch, now = Date.now()) {
  const c = tokenCache.get(acc.client_email);
  if (c && c.exp > now) return c.token;
  const assertion = await signJwt(acc, { now });
  const res = await fetchImpl(acc.token_uri && /^https:\/\/oauth2\.googleapis\.com\//.test(acc.token_uri) ? acc.token_uri : TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok || !data || !data.access_token) {
    throw new Error(`Google-Anmeldung des Dienstkontos fehlgeschlagen (${res.status}${data && data.error ? " " + data.error : ""}).`);
  }
  const life = Math.max(60, Number(data.expires_in) || 3600) * 1000;
  tokenCache.set(acc.client_email, { token: data.access_token, exp: now + Math.min(CACHE_MS, life - 5 * 60 * 1000) });
  return data.access_token;
}

const uidCache = new Map();

/**
 * Firebase-UID ermitteln: env STEMPEL_UID, sonst Identity Toolkit accounts:lookup per (genau passender) E-Mail.
 * L8 (Audit 2): KEINE Notlösung „einziger Nutzer unter users/“ mehr – mit dem Familienkonto könnte das sonst
 * fremde Daten treffen. Ohne STEMPEL_UID und ohne Lookup-Rechte → Fehler (fail closed).
 */
export async function resolveUid({ env, projectId, getToken, fetchImpl = fetch, fs }) {
  const fixed = String(env.STEMPEL_UID || "").trim();
  if (fixed) return fixed;
  const email = String(env.STEMPEL_EMAIL || DEFAULT_EMAIL).trim().toLowerCase();
  const ck = projectId + "|" + email;
  if (uidCache.has(ck)) return uidCache.get(ck);
  let uid = null;
  try {
    const token = await getToken();
    const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ email: [email] }),
    });
    if (res.ok) {
      const data = await res.json();
      const u = (data.users || []).find((x) => String(x.email || "").toLowerCase() === email);
      if (u && u.localId) uid = u.localId;
    }
  } catch { /* → Fehler unten */ }
  if (!uid) throw new Error(`Kein Firebase-Konto für ${email} gefunden. Bitte STEMPEL_UID als Secret setzen.`);
  uidCache.set(ck, uid);
  return uid;
}
