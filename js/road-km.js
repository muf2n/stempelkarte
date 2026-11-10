// Update 9 – Fahrtenbuch: Straßen-km über den öffentlichen OSRM-Routing-Dienst (router.project-osrm.org).
// Höchstens 1 Anfrage pro Sekunde, nacheinander, nur für sichtbare Fahrten ohne gespeicherte Straßen-km.
// Ergebnis wird am Abschnitt gespeichert (kmRoad, kmRoadAt, kmRoadFor) – über store.saveEntry, also nur einmal.
// 📍 Zwischenstopps (seg.via): eine Anfrage über alle Punkte (start;via…;ziel), kmRoadFor = coordKey(alle Punkte).
// Abschaltbar: settings.trips.roadKm === false → keine Anfragen (gespeicherte Werte gelten weiter).
import { coordKey, roadKm, hasCoords, manualKm, routePoints, pathM } from "./travel.js";
import { readTripSettings } from "./trip-core.js";

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const GAP_MS = 1000;

let store = null;
const queue = [];          // [{entryId, rawIndex, key}]
const queued = new Set();  // trip.key|coordKey
const failed = new Map();  // coordKey → Zeitpunkt (nicht sofort wiederholen)
let busy = false;
let lastAt = 0;
let pauseUntil = 0;
const listeners = new Set();

export function init(s) { store = s; }

/** Benachrichtigung, wenn eine Strecke gespeichert wurde (cb(tripKey)). */
export function onUpdate(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Anzahl wartender Anfragen. */
export function pending() { return queue.length + (busy ? 1 : 0); }

/** Braucht diese Fahrt eine Straßen-km-Abfrage? (Koordinaten da, nichts gespeichert, nicht manuell) */
export function needsRoad(seg) {
  if (!seg || !hasCoords(seg)) return false;
  if (manualKm(seg) != null || roadKm(seg) != null) return false;
  return pathM(routePoints(seg)) >= 50; // gleicher Punkt → keine Abfrage
}

/** Fahrt (aus tripsBetween) zur Abfrage vormerken. Gibt true zurück, wenn neu eingereiht. */
export function request(trip) {
  if (!store || !trip || !trip.entry || !trip.entry.id) return false;
  const s = store.get();
  if (!readTripSettings(s.settings).roadKm) return false;
  const seg = trip.entry.segments && trip.entry.segments[trip.rawIndex];
  if (!needsRoad(seg)) return false;
  const ck = coordKey(routePoints(seg));
  const f = failed.get(ck);
  if (f && Date.now() - f < 10 * 60000) return false;
  const id = `${trip.key}|${ck}`;
  if (queued.has(id)) return false;
  queued.add(id);
  queue.push({ entryId: trip.entry.id, rawIndex: trip.rawIndex, ck, id });
  pump();
  return true;
}

/** Alle wartenden Anfragen verwerfen (z. B. beim Ausschalten). */
export function clear() { queue.length = 0; queued.clear(); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Straßen-Distanz in km zwischen zwei Punkten – fetchRoadKm(a, b) – oder über eine Punktliste
 *  – fetchRoadKm([a, via…, b]) – oder null. */
export async function fetchRoadKm(a, b) {
  const pts = Array.isArray(a) ? a : [a, b];
  if (pts.length < 2) return null;
  const url = `${OSRM}${pts.map((p) => `${p.lng},${p.lat}`).join(";")}?overview=false`;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  try {
    const res = await fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: "application/json" } });
    if (res.status === 429) { pauseUntil = Date.now() + 60000; return null; }
    if (!res.ok) return null;
    const data = await res.json();
    const d = data && Array.isArray(data.routes) && data.routes[0] ? Number(data.routes[0].distance) : NaN;
    return Number.isFinite(d) && d >= 0 ? d / 1000 : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      if (!readTripSettings(store.get().settings).roadKm) { clear(); break; }
      const wait = Math.max(lastAt + GAP_MS, pauseUntil) - Date.now();
      if (wait > 0) await sleep(wait);
      const job = queue.shift();
      const e0 = store.get().entries.find((x) => x.id === job.entryId);
      const seg0 = e0 && e0.segments && e0.segments[job.rawIndex];
      if (!seg0 || !needsRoad(seg0) || coordKey(routePoints(seg0)) !== job.ck) { queued.delete(job.id); continue; }
      lastAt = Date.now();
      const km = await fetchRoadKm(routePoints(seg0));
      lastAt = Date.now();
      queued.delete(job.id);
      if (km == null) { failed.set(job.ck, Date.now()); continue; }
      // frisch aus dem Store lesen – zwischenzeitliche Änderungen nicht überschreiben
      const e = store.get().entries.find((x) => x.id === job.entryId);
      const seg = e && Array.isArray(e.segments) ? e.segments[job.rawIndex] : null;
      if (!seg || coordKey(routePoints(seg)) !== job.ck) continue;
      const segs = e.segments.map((x, i) => (i === job.rawIndex
        ? { ...x, kmRoad: Math.round(km * 100) / 100, kmRoadAt: Date.now(), kmRoadFor: job.ck } : x));
      try {
        await store.saveEntry({ ...e, segments: segs });
        for (const cb of [...listeners]) { try { cb(job.id.split("|")[0]); } catch { /* egal */ } }
      } catch { /* Store zeigt Toast */ }
    }
  } finally {
    busy = false;
  }
}
