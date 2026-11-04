// Fahrerkennung: Standort fortlaufend beobachten (nur solange die App offen ist) und aus den
// Proben erkennen, ob gerade gefahren wird ("driving"), man steht ("stopped") oder es unklar ist.
// classify()/driveStart() sind reine Funktionen (mit node testbar).

const R_EARTH = 6371008.8;
const MAX_ACC = 100;          // Proben mit schlechterer Genauigkeit verwerfen (m)
const DRIVE_MIN_SPAN = 45000; // mindestens so viel Zeit muss überblickt werden (ms)
const DRIVE_WINDOW = 120000;  // Durchschnitt über höchstens die letzten 2 Minuten (Ampel-Stopps verkraften)
const DRIVE_MIN_DIST = 300;   // m
const STOP_SPAN = 180000;     // ms
const STOP_KMH = 5;
const STOP_DIST = 80;         // m
const KEEP_MS = 15 * 60000;   // so lange Proben aufheben

export const DEFAULTS = Object.freeze({ enabled: true, mode: "auto", minKmh: 20, keepAwake: false });

/** settings.autoDrive mit Standardwerten auffüllen. */
export function readAutoDrive(settings) {
  const a = (settings && settings.autoDrive) || {};
  const k = Number(a.minKmh);
  return {
    enabled: a.enabled !== false,
    mode: a.mode === "ask" ? "ask" : "auto",
    minKmh: Number.isFinite(k) ? Math.min(60, Math.max(10, Math.round(k))) : DEFAULTS.minKmh,
    keepAwake: a.keepAwake === true,
  };
}

export function distM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Weg entlang der Proben, GPS-Zittern unterdrückt: nur Sprünge über max(20 m, Genauigkeit) zählen. */
function pathLen(list) {
  if (list.length < 2) return 0;
  let anchor = list[0];
  let sum = 0;
  for (let i = 1; i < list.length; i++) {
    const p = list[i];
    const d = distM(anchor, p);
    const thr = Math.max(20, Math.min(60, ((anchor.acc || 0) + (p.acc || 0)) / 2));
    if (d >= thr) { sum += d; anchor = p; }
  }
  // Rest bis zur letzten Probe (kleiner als die Schwelle) noch mitnehmen, wenn er nicht nur Zittern ist
  const tail = distM(anchor, list[list.length - 1]);
  if (tail >= 20) sum += tail;
  return sum;
}

function valid(samples) {
  return (Array.isArray(samples) ? samples : [])
    .filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng) && Number.isFinite(s.ts) &&
      !(Number(s.acc) > MAX_ACC))
    .sort((a, b) => a.ts - b.ts);
}

/** Proben ab (now - ms); `minSpan`: nur zurückgeben, wenn sie mindestens so viel Zeit abdecken. */
function windowOf(list, now, ms, minSpan) {
  const from = now - ms;
  let i = list.length - 1;
  while (i > 0 && list[i - 1].ts >= from) i--;
  // eine Probe vor dem Fenster dazunehmen, damit die Spanne ≥ minSpan erreicht wird
  if (i > 0 && now - list[i].ts < minSpan) i--;
  const w = list.slice(i);
  if (!w.length || now - w[0].ts < minSpan) return null;
  return w;
}

/**
 * Bewegungszustand aus Standortproben.
 * driving = Ø-Geschwindigkeit der letzten ≥ 45 s (höchstens 120 s) > minKmh UND ≥ 300 m zurückgelegt (und ≥ 150 m Luftlinie).
 * stopped = in den letzten ≥ 180 s < 5 km/h bzw. < 80 m Bewegung.
 * opts: { minKmh = 20, now = Zeit der letzten Probe }
 */
export function classify(samples, opts = {}) {
  const list = valid(samples);
  if (list.length < 2) return "unknown";
  const minKmh = Number(opts.minKmh) > 0 ? Number(opts.minKmh) : DEFAULTS.minKmh;
  const now = Number.isFinite(opts.now) ? opts.now : list[list.length - 1].ts;
  const last = list[list.length - 1];
  if (now - last.ts > 60000) return "unknown"; // keine frischen Proben

  const w = windowOf(list, now, DRIVE_WINDOW, DRIVE_MIN_SPAN);
  if (w) {
    const dist = pathLen(w);
    const secs = (now - w[0].ts) / 1000;
    const kmh = secs > 0 ? (dist / secs) * 3.6 : 0;
    const net = distM(w[0], last); // gegen GPS-Zittern im Stand: man muss auch wirklich woanders sein
    if (kmh > minKmh && dist >= DRIVE_MIN_DIST && net >= DRIVE_MIN_DIST / 2) return "driving";
  }

  const ws = windowOf(list, now, STOP_SPAN, STOP_SPAN);
  if (ws) {
    let maxD = 0;
    for (const p of ws) maxD = Math.max(maxD, distM(p, last));
    const secs = (now - ws[0].ts) / 1000;
    const kmh = secs > 0 ? (pathLen(ws) / secs) * 3.6 : 0;
    if (maxD < STOP_DIST || kmh < STOP_KMH) return "stopped";
  }
  return "unknown";
}

/**
 * Beginn der aktuellen Fahrt: die erste Probe der zusammenhängenden Bewegung bis jetzt
 * (Stopps bis 90 s, z. B. Ampeln, unterbrechen die Fahrt nicht). Gibt die Probe zurück oder null.
 */
export function driveStart(samples, opts = {}) {
  const list = valid(samples);
  if (list.length < 2) return null;
  const minKmh = Number(opts.minKmh) > 0 ? Number(opts.minKmh) : DEFAULTS.minKmh;
  const moveMs = (minKmh / 2) / 3.6; // m/s – ab hier gilt ein Stück als „in Bewegung“
  let start = null;
  let stillSince = null;           // ts des jüngsten Stillstands (rückwärts gesehen)
  for (let i = list.length - 1; i > 0; i--) {
    const a = list[i - 1], b = list[i];
    const dt = (b.ts - a.ts) / 1000;
    if (dt <= 0) continue;
    const v = distM(a, b) / dt;
    const moving = v >= moveMs || (Number.isFinite(b.speed) && b.speed >= moveMs && distM(a, b) > 5);
    if (moving) {
      start = a;
      stillSince = null;
    } else {
      if (stillSince == null) stillSince = b.ts;
      if (start && stillSince - a.ts > 90000) break;
      if (dt > 90 && start) break;
    }
  }
  return start;
}

/* ---------------- Beobachtung (Browser) ---------------- */

let watchId = null;
let prev = null;

/** Standort beobachten; onSample({lat,lng,acc,speed,ts}) für jede brauchbare Probe. */
export function startWatch(onSample) {
  if (watchId != null) return true;
  if (typeof navigator === "undefined" || !navigator.geolocation) return false;
  prev = null;
  try {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos && pos.coords;
        if (!c) return;
        const acc = Math.round(c.accuracy || 0);
        if (acc > MAX_ACC) return; // Ausreißer
        const s = { lat: c.latitude, lng: c.longitude, acc, speed: null, ts: pos.timestamp || Date.now() };
        if (Number.isFinite(c.speed) && c.speed >= 0) s.speed = c.speed;
        else if (prev && s.ts > prev.ts) s.speed = distM(prev, s) / ((s.ts - prev.ts) / 1000);
        prev = s;
        try { onSample(s); } catch (e) { console.error(e); }
      },
      () => { /* still – nächster Versuch kommt vom Browser */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    return true;
  } catch {
    watchId = null;
    return false;
  }
}

export function stopWatch() {
  if (watchId != null) {
    try { navigator.geolocation.clearWatch(watchId); } catch { /* egal */ }
  }
  watchId = null;
  prev = null;
}

export function watching() { return watchId != null; }

/** Alte Proben wegwerfen (Liste wird verändert). */
export function prune(samples, now = Date.now()) {
  while (samples.length && now - samples[0].ts > KEEP_MS) samples.shift();
  return samples;
}
