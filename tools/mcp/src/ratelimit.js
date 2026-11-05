// M6: einfache Ratenbegrenzung pro IP (Token-Bucket im Speicher des Isolats) für Endpunkte, die ohne
// Anmeldung teure Arbeit auslösen (/gmail/callback, /bank/finish, /ics, fehlgeschlagene /mcp-Anmeldungen).
// Nur „pro Isolat“: Cloudflare kann mehrere Isolate betreiben – das ist eine Bremse gegen Dauerbeschuss,
// kein exakter Zähler. Für harte Grenzen zusätzlich eine Cloudflare-Rate-Limit-Regel einrichten.

/** Grenzen je Bereich: capacity = Anfragen am Stück, perMin = Nachfüllung pro Minute. */
export const LIMITS = {
  "gmail-callback": { capacity: 10, perMin: 10 },
  "bank-finish": { capacity: 10, perMin: 10 },
  ics: { capacity: 60, perMin: 60 },
  "mcp-auth": { capacity: 20, perMin: 10 },
};

const MAX_KEYS = 5000;
let buckets = new Map();
export function clearRateLimits() { buckets = new Map(); }

/** IP des Aufrufers (Cloudflare setzt cf-connecting-ip immer; ohne Header – lokal/Tests – keine Begrenzung). */
export function clientIp(request) {
  const ip = String(request.headers.get("cf-connecting-ip") || "").trim();
  return ip && ip.length <= 64 ? ip : null;
}

function bucketOf(scope, ip, now) {
  const lim = LIMITS[scope];
  const key = `${scope}|${ip}`;
  let b = buckets.get(key);
  if (!b) {
    if (buckets.size >= MAX_KEYS) {
      // Speicher begrenzen: älteste Einträge verwerfen (Map hält die Einfüge-Reihenfolge)
      for (const k of buckets.keys()) { buckets.delete(k); if (buckets.size < MAX_KEYS * 0.9) break; }
    }
    b = { tokens: lim.capacity, at: now };
    buckets.set(key, b);
  }
  const refill = ((now - b.at) / 60000) * lim.perMin;
  if (refill > 0) { b.tokens = Math.min(lim.capacity, b.tokens + refill); b.at = now; }
  return b;
}

/** Ist noch etwas übrig? (ohne zu verbrauchen) */
export function rateOk(scope, request, now = Date.now()) {
  const ip = clientIp(request);
  if (!ip || !LIMITS[scope]) return true;
  return bucketOf(scope, ip, now).tokens >= 1;
}

/** Eine Anfrage verbuchen. → true = erlaubt, false = zu viele. */
export function rateTake(scope, request, now = Date.now()) {
  const ip = clientIp(request);
  if (!ip || !LIMITS[scope]) return true;
  const b = bucketOf(scope, ip, now);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/** Sekunden bis zur nächsten freien Anfrage (für Retry-After). */
export function retryAfter(scope) {
  const lim = LIMITS[scope];
  return lim ? Math.max(1, Math.ceil(60 / lim.perMin)) : 60;
}

/** OAuth-/Bank-state aus /gmail/start bzw. /bank/start: 32 Zufallsbytes base64url = genau 43 Zeichen. */
export const STATE_RE = /^[A-Za-z0-9_-]{43}$/;
export const validState = (s) => typeof s === "string" && STATE_RE.test(s);
/** Autorisierungs-Code: nicht leer, begrenzt, nur URL-sichere Zeichen (Google: 4/0A…, Enable Banking: UUID). */
export const validCode = (c) => typeof c === "string" && c.length >= 1 && c.length <= 1024 && /^[A-Za-z0-9._~\/+=-]+$/.test(c);
