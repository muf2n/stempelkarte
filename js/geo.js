// Standort: Position ermitteln, Berechtigung prüfen, Entfernungen berechnen, Adressen (Nominatim) und Maps-Links.

const IOS_HINT = " Am iPhone: Einstellungen → Datenschutz → Ortungsdienste → Safari-Websites → „Beim Verwenden der App“.";

const MESSAGES = {
  denied: "Standortzugriff ist blockiert. Erlaube ihn in den Browser-Einstellungen für diese Seite." + IOS_HINT,
  unavailable: "Standort konnte nicht ermittelt werden. Ist die Ortung (GPS) am Gerät eingeschaltet?",
  timeout: "Standort hat zu lange gedauert. Versuch es im Freien oder gleich noch einmal.",
  unsupported: "Dieses Gerät oder dieser Browser kann keinen Standort ermitteln.",
  insecure: "Standort geht nur über eine sichere Verbindung (https://). Öffne die App über ihre https-Adresse.",
};

function geoError(code) {
  return { code, message: MESSAGES[code] || MESSAGES.unavailable };
}

export function isSupported() {
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export async function permission() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    const st = await navigator.permissions.query({ name: "geolocation" });
    const s = st && st.state;
    return s === "granted" || s === "denied" || s === "prompt" ? s : "unknown";
  } catch {
    return "unknown";
  }
}

function attempt(highAccuracy, timeout, maxAge) {
  return new Promise((resolve, reject) => {
    let done = false;
    // Eigener Sicherheits-Timer, falls der Browser den Callback nie aufruft
    const guard = setTimeout(() => {
      if (!done) { done = true; reject(geoError("timeout")); }
    }, timeout + 2000);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (done) return;
          done = true; clearTimeout(guard);
          const c = pos.coords;
          resolve({
            lat: c.latitude,
            lng: c.longitude,
            acc: Math.round(c.accuracy || 0),
            ts: pos.timestamp || Date.now(),
          });
        },
        (err) => {
          if (done) return;
          done = true; clearTimeout(guard);
          const code = err && err.code === 1 ? "denied" : err && err.code === 3 ? "timeout" : "unavailable";
          reject(geoError(code));
        },
        { enableHighAccuracy: highAccuracy, timeout, maximumAge: maxAge }
      );
    } catch {
      if (!done) { done = true; clearTimeout(guard); reject(geoError("unavailable")); }
    }
  });
}

export function getPosition({ timeout = 12000, maxAge = 30000 } = {}) {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return Promise.reject(geoError("insecure"));
  }
  if (!isSupported()) return Promise.reject(geoError("unsupported"));
  return attempt(true, timeout, maxAge).catch((e) => {
    if (e && (e.code === "timeout" || e.code === "unavailable")) {
      const t2 = Math.max(3000, Math.min(6000, Math.round(timeout / 2)));
      return attempt(false, t2, Math.max(maxAge, 60000));
    }
    throw e;
  });
}

export function distanceM(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- Reverse Geocoding (Nominatim) ----------

const CACHE_KEY = "stempelkarte.geocache";
const CACHE_MAX = 200;
const MIN_GAP_MS = 1100;
let cache = null; // Map key → addr
let queue = Promise.resolve();
let lastRequest = 0;

function loadCache() {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) if (typeof v === "string") cache.set(k, v);
    }
  } catch { /* egal */ }
  return cache;
}

function storeCache(key, value) {
  const c = loadCache();
  c.delete(key);
  c.set(key, value);
  while (c.size > CACHE_MAX) c.delete(c.keys().next().value);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(c)));
  } catch { /* egal */ }
}

function formatAddress(data) {
  const a = (data && data.address) || {};
  const street = a.road || a.pedestrian || a.footway || a.path || a.square || a.neighbourhood || "";
  const first = [street, a.house_number].filter(Boolean).join(" ").trim();
  const place = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || "";
  const second = [a.postcode, place].filter(Boolean).join(" ").trim();
  const short = [first, second].filter(Boolean).join(", ");
  if (short && (first || place)) return short;
  if (data && typeof data.display_name === "string" && data.display_name.trim()) {
    return data.display_name.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(", ");
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAddress(lat, lng) {
  const wait = lastRequest + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
      "&lat=" + encodeURIComponent(lat) + "&lon=" + encodeURIComponent(lng) +
      "&accept-language=de&zoom=18";
    const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = await res.json();
    return formatAddress(data);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    lastRequest = Date.now();
  }
}

export async function reverseGeocode(lat, lng) {
  try {
    lat = Number(lat); lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const key = lat.toFixed(4) + "," + lng.toFixed(4);
    const c = loadCache();
    if (c.has(key)) return c.get(key);
    const job = queue.then(async () => {
      if (c.has(key)) return c.get(key);
      const addr = await fetchAddress(lat, lng);
      if (addr) storeCache(key, addr);
      return addr;
    });
    queue = job.catch(() => null);
    return await job;
  } catch {
    return null;
  }
}

// ---------- Maps-Links ----------

export function mapsUrl(lat, lng) {
  return "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lng;
}

export function placeMapsUrl(place) {
  if (!place) return null;
  const link = typeof place.link === "string" ? place.link.trim() : "";
  if (/^https:\/\//i.test(link)) return link;
  if (typeof place.lat === "number" && typeof place.lng === "number" &&
      Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    return mapsUrl(place.lat, place.lng);
  }
  const addr = typeof place.addr === "string" ? place.addr.trim() : "";
  if (addr) return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
  return null;
}
