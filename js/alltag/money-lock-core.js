// Update 9 – Geld-Sperre: reine Logik ohne DOM (auch in node testbar, WebCrypto über globalThis.crypto).
//  - PIN: PBKDF2-SHA256 (200.000 Runden, 16 Byte Salt) → nur {salt, hash, iter, len} wird gespeichert, nie die PIN.
//  - WebAuthn: Prüfung einer Assertion (Signatur über authenticatorData || SHA-256(clientDataJSON),
//    Challenge, Origin, rpIdHash, UP/UV-Flags, Zähler). ES256 (DER → r||s) und RS256.
//  - Ablauf der Entsperrung (Inaktivität, App im Hintergrund).
// WICHTIG: Das alles läuft im Browser – es schützt die ANZEIGE in der App, nicht die Daten am Server.

export const PIN_ITER = 200000;
export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const AUTOLOCK_CHOICES = [1, 5, 15];
export const DEFAULT_AUTOLOCK = 5;
export const HIDDEN_MS = 60000;
export const ALG_ES256 = -7;
export const ALG_RS256 = -257;

const te = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

/* ---------- Bytes / Base64 ---------- */

export function bytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === "string") return te.encode(x);
  throw new TypeError("Bytes erwartet");
}

export function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

export function b64(buf) {
  const a = bytes(buf);
  let s = "";
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(str) {
  const s = atob(String(str || ""));
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

export const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function unb64url(str) {
  let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return unb64(s);
}

export function concat(...parts) {
  const arrs = parts.map(bytes);
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

export function equalBytes(a, b) {
  a = bytes(a); b = bytes(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function sha256(data) {
  return new Uint8Array(await subtle().digest("SHA-256", bytes(data)));
}

/* ---------- PIN ---------- */

/** "1234" → true, wenn 4–8 Ziffern. */
export function validPin(pin) {
  return typeof pin === "string" && new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

async function pbkdf2(pin, salt, iter) {
  const base = await subtle().importKey("raw", te.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, 256));
}

/** → { salt, hash, iter, len } (base64) – nur das wird gespeichert. */
export async function hashPin(pin, iter = PIN_ITER) {
  if (!validPin(pin)) throw new Error("Die PIN muss 4 bis 8 Ziffern haben.");
  const salt = randomBytes(16);
  const hash = await pbkdf2(pin, salt, iter);
  return { salt: b64(salt), hash: b64(hash), iter, len: pin.length };
}

export async function verifyPin(pin, rec) {
  if (!rec || !rec.salt || !rec.hash || !validPin(pin)) return false;
  const iter = Number(rec.iter) || PIN_ITER;
  const got = await pbkdf2(pin, unb64(rec.salt), iter);
  return equalBytes(got, unb64(rec.hash));
}

/** Wartezeit in Sekunden nach n Fehlversuchen: ab dem 5. Fehler 5 s, 10 s, 20 s … max. 5 Min. */
export function failDelay(n) {
  if (!(n >= 5)) return 0;
  return Math.min(300, 5 * 2 ** (n - 5));
}

/* ---------- Ablauf der Entsperrung ---------- */

export function autoLockMs(cfg) {
  const m = Number(cfg && cfg.autoLockMin);
  return (AUTOLOCK_CHOICES.includes(m) ? m : DEFAULT_AUTOLOCK) * 60000;
}

/** Sitzung { ident, until } gültig für diesen Nutzer? */
export function sessionValid(sess, ident, now = Date.now()) {
  return !!(sess && ident && sess.ident === ident && Number(sess.until) > now);
}

/** Aktivität: Ablauf nach vorne schieben (nur solange noch entsperrt). */
export function touch(sess, ident, ms, now = Date.now()) {
  if (!sessionValid(sess, ident, now)) return null;
  return { ident, until: now + ms };
}

/** App geht in den Hintergrund: spätestens nach hiddenMs sperren. */
export function onHidden(sess, ident, hiddenMs = HIDDEN_MS, now = Date.now()) {
  if (!sessionValid(sess, ident, now)) return null;
  return { ident, until: Math.min(Number(sess.until), now + hiddenMs), hiddenAt: now };
}

/* ---------- WebAuthn ---------- */

/**
 * DER-kodierte ECDSA-Signatur (SEQUENCE { INTEGER r, INTEGER s }) → r||s mit fester Länge (P-256: 2×32 Byte).
 */
export function derToRaw(der, size = 32) {
  const d = bytes(der);
  let p = 0;
  const fail = () => { throw new Error("Ungültige DER-Signatur"); };
  const len = () => {
    if (p >= d.length) fail();
    let l = d[p++];
    if (l & 0x80) {
      const n = l & 0x7f;
      if (n < 1 || n > 2) fail();
      l = 0;
      for (let i = 0; i < n; i++) { if (p >= d.length) fail(); l = (l << 8) | d[p++]; }
    }
    return l;
  };
  if (d[p++] !== 0x30) fail();
  const seqLen = len();
  if (p + seqLen !== d.length) fail();
  const out = new Uint8Array(size * 2);
  for (let k = 0; k < 2; k++) {
    if (d[p++] !== 0x02) fail();
    const l = len();
    if (l < 1 || p + l > d.length) fail();
    let v = d.subarray(p, p + l);
    p += l;
    while (v.length > 1 && v[0] === 0) v = v.subarray(1); // Vorzeichen-Null weg
    if (v.length > size) fail();
    out.set(v, k * size + (size - v.length));
  }
  if (p !== d.length) fail();
  return out;
}

/** Gegenstück (nur für Tests/Werkzeuge): r||s → DER. */
export function rawToDer(raw) {
  const r = bytes(raw);
  const half = r.length / 2;
  const int = (v) => {
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    v = v.subarray(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(r.subarray(0, half)), int(r.subarray(half)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

/** authenticatorData → { rpIdHash, flags, up, uv, counter } */
export function parseAuthData(ad) {
  const a = bytes(ad);
  if (a.length < 37) throw new Error("authenticatorData zu kurz");
  const flags = a[32];
  const counter = ((a[33] << 24) >>> 0) + (a[34] << 16) + (a[35] << 8) + a[36];
  return { rpIdHash: a.subarray(0, 32), flags, up: !!(flags & 0x01), uv: !!(flags & 0x04), counter };
}

async function importPub(spkiB64, alg) {
  const spki = unb64(spkiB64);
  if (alg === ALG_RS256) return subtle().importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  return subtle().importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
}

/**
 * Prüft eine WebAuthn-Assertion lokal.
 * cred = { id, publicKey (SPKI base64), alg, counter }
 * a = { authenticatorData, clientDataJSON, signature } (ArrayBuffer/Uint8Array)
 * expect = { challenge (Bytes), origin, rpId }
 * → { ok: true, counter } oder { ok: false, reason }
 */
export async function verifyAssertion(cred, a, expect) {
  const no = (reason) => ({ ok: false, reason });
  if (!cred || !cred.publicKey) return no("cred");
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(bytes(a.clientDataJSON))); } catch { return no("clientData"); }
  if (!cd || cd.type !== "webauthn.get") return no("type");
  if (cd.challenge !== b64url(expect.challenge)) return no("challenge");
  if (cd.origin !== expect.origin) return no("origin");
  let ad;
  try { ad = parseAuthData(a.authenticatorData); } catch { return no("authData"); }
  if (!equalBytes(ad.rpIdHash, await sha256(expect.rpId))) return no("rpId");
  if (!ad.up) return no("up");
  if (!ad.uv) return no("uv");
  const stored = Number(cred.counter) || 0;
  if ((stored > 0 || ad.counter > 0) && !(ad.counter > stored)) return no("counter");
  const alg = Number(cred.alg) || ALG_ES256;
  if (alg !== ALG_ES256 && alg !== ALG_RS256) return no("alg");
  const signed = concat(a.authenticatorData, await sha256(a.clientDataJSON));
  let ok = false;
  try {
    const key = await importPub(cred.publicKey, alg);
    ok = alg === ALG_RS256
      ? await subtle().verify("RSASSA-PKCS1-v1_5", key, bytes(a.signature), signed)
      : await subtle().verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(a.signature), signed);
  } catch { ok = false; }
  return ok ? { ok: true, counter: ad.counter } : no("signature");
}

/** Prüft die Antwort von credentials.create grob (Typ, Challenge, Origin). */
export function checkCreateClientData(clientDataJSON, expect) {
  let cd;
  try { cd = JSON.parse(new TextDecoder().decode(bytes(clientDataJSON))); } catch { return false; }
  return !!cd && cd.type === "webauthn.create" && cd.challenge === b64url(expect.challenge) && cd.origin === expect.origin;
}

/* ---------- Konfiguration ---------- */

/** Gespeichertes Dokument (meta/money_lock) mit Standardwerten auffüllen. */
export function normalizeCfg(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const pin = r.pin && r.pin.salt && r.pin.hash ? { salt: String(r.pin.salt), hash: String(r.pin.hash), iter: Number(r.pin.iter) || PIN_ITER, len: Number(r.pin.len) || 0 } : null;
  const creds = Array.isArray(r.creds) ? r.creds.filter((c) => c && c.id && c.publicKey).map((c) => ({
    id: String(c.id), publicKey: String(c.publicKey), alg: Number(c.alg) || ALG_ES256, counter: Number(c.counter) || 0,
    label: String(c.label || ""), created: Number(c.created) || 0,
  })) : [];
  const m = Number(r.autoLockMin);
  return {
    enabled: !!r.enabled && !!pin,
    pin,
    creds,
    autoLockMin: AUTOLOCK_CHOICES.includes(m) ? m : DEFAULT_AUTOLOCK,
    maskElsewhere: !!r.maskElsewhere,
    bannerDismissed: !!r.bannerDismissed,
  };
}
