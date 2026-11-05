// Update 9 – Privat-Modus: Fahrten erkennen, solange die App offen ist (Standortproben aus js/motion.js),
// und als eigene Privatfahrt (tripOnly, privateTrip, 0 h) ins Fahrtenbuch schreiben.
// Die Beobachtung selbst startet today.js (driveWatchTick) – hier nur Zustand + Auswertung.
// In der Android-App mit Anmeldung übernimmt das der native Teil (ActivityTransitions) → hier aus.
import * as motion from "./motion.js";
import * as store from "./store.js";
import * as P from "./privat-core.js";
import { isPrivatNow } from "./privat.js";
import { isNative, plugin } from "./native.js";

const LS = "stempelkarte.privDrive"; // laufende Privatfahrt { start, from, last } (überlebt Neuladen)
const MIN_MS = 2 * 60000;            // kürzere „Fahrten“ verwerfen
const MIN_M = 300;
const STALE_MS = 20 * 60000;         // ohne frische Proben so lange → Fahrt mit letzter Probe beenden

let samples = [];
let cur = load();                    // { start, from: {lat,lng,acc,ts}, last }
let writing = false;
let onSaved = null;

function load() {
  try { const o = JSON.parse(localStorage.getItem(LS) || "null"); return o && Number.isFinite(o.start) ? o : null; } catch { return null; }
}
function persist() {
  try { if (cur) localStorage.setItem(LS, JSON.stringify(cur)); else localStorage.removeItem(LS); } catch { /* egal */ }
}
const plain = (s) => (s ? { lat: s.lat, lng: s.lng, acc: Math.round(s.acc || 0), ts: s.ts } : null);

/** Nimmt der native Teil (Android-App, angemeldet) die Privatfahrten auf? */
function nativeHandles(snap) {
  try { return isNative() && snap && snap.mode === "cloud" && !!plugin("StempelNative"); } catch { return false; }
}

/** Soll der Standort beobachtet werden (Privat-Modus, aufzeichnen an, Fahrerkennung an)? */
export function wantWatch(snap) {
  if (!snap || !snap.ready || snap.running) return false;
  const s = snap.settings || {};
  if (!P.recordPrivateTrips(s) || !motion.readAutoDrive(s).enabled) return false;
  if (nativeHandles(snap)) return false;
  return isPrivatNow(snap);
}

/** Callback nach dem Speichern (für einen Hinweis). */
export function onTripSaved(cb) { onSaved = cb; }

export function active() { return cur; }

function matchPlace(loc, snap, geofence) {
  if (!loc || !geofence) return null;
  try { const m = geofence.matchPlace(loc, snap.places || [], (snap.settings || {}).defaultRadius || 150); return m ? m.place : null; } catch { return null; }
}

/** Neue Probe (nur im Privat-Modus aufgerufen). ctx = App-ctx (geofence, geo, ui). */
export function onSample(s, ctx) {
  samples.push(s);
  motion.prune(samples);
  const snap = store.get();
  const ad = motion.readAutoDrive(snap.settings || {});
  const cls = motion.classify(samples, { minKmh: ad.minKmh, now: s.ts });
  if (!cur) {
    if (cls !== "driving") return;
    const first = motion.driveStart(samples, { minKmh: ad.minKmh }) || samples[0];
    cur = { start: first.ts, from: plain(first), last: plain(s) };
    persist();
    try { ctx && ctx.ui && ctx.ui.toast("🏠 Privatfahrt erkannt – zählt nicht als Arbeit", 3500); } catch { /* egal */ }
    return;
  }
  cur.last = plain(s);
  persist();
  if (cls === "stopped") finish(ctx, arrivalOf(samples, s));
}

/** Ankunft: erste Probe, ab der man sich nicht mehr als 80 m vom Stillstandsort entfernt hat. */
function arrivalOf(list, last) {
  let a = last;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.ts < cur.start) break;
    if (motion.distM(p, last) > 80) break;
    a = p;
  }
  return a;
}

/** Laufende Privatfahrt beenden (Stillstand, Modus vorbei, zu alt). end = Probe am Ziel. */
export async function finish(ctx, end = null) {
  if (!cur || writing) return null;
  const c = cur;
  const e = end ? plain(end) : c.last;
  cur = null;
  samples = [];
  persist();
  if (!e || !c.from) return null;
  const dur = e.ts - c.start;
  if (dur < MIN_MS || motion.distM(c.from, e) < MIN_M) return null;
  const snap = store.get();
  // nie doppelt: überschneidet sich schon eine Fahrt/ein Eintrag?
  if ((snap.entries || []).some((x) => x && Number.isFinite(x.start) && Number.isFinite(x.end) && x.start < e.ts && x.end > c.start)) return null;
  const geofence = ctx && ctx.geofence;
  const entry = P.privateTripEntry({
    start: c.start, end: e.ts, fromLoc: c.from, toLoc: e,
    fromPlace: matchPlace(c.from, snap, geofence), toPlace: matchPlace(e, snap, geofence), src: "privat-web",
  });
  writing = true;
  let id = null;
  try { id = await store.saveEntry(entry); } catch (err) { console.error(err); } finally { writing = false; }
  if (id) {
    try { if (onSaved) onSaved({ ...entry, id }); } catch { /* egal */ }
    fillAddrs(id, ctx);
  }
  return id;
}

/** Adressen nachtragen (Fahrtenbuch zeigt sonst nur Koordinaten). */
async function fillAddrs(id, ctx) {
  const geo = ctx && ctx.geo;
  if (!geo || !geo.reverseGeocode) return;
  const e0 = store.get().entries.find((x) => x.id === id);
  if (!e0) return;
  const seg = { ...e0.segments[0] };
  try {
    if (seg.loc && !seg.loc.addr) { const a = await geo.reverseGeocode(seg.loc.lat, seg.loc.lng); if (a) seg.loc = { ...seg.loc, addr: a }; }
    if (seg.endLoc && !seg.endLoc.addr) {
      const a = await geo.reverseGeocode(seg.endLoc.lat, seg.endLoc.lng);
      if (a) { seg.endLoc = { ...seg.endLoc, addr: a }; if (!seg.endPlace) seg.endPlace = a; }
    }
  } catch { return; }
  const e = store.get().entries.find((x) => x.id === id);
  if (!e) return;
  try { await store.saveEntry({ ...e, inLoc: seg.loc || e.inLoc, outLoc: seg.endLoc || e.outLoc, segments: [seg] }); } catch { /* egal */ }
}

/** Sekundentakt (aus today.js): beendet eine hängende Fahrt (eingestempelt, Privat vorbei, zu lange keine Probe). */
export function tick(ctx) {
  if (!cur) return;
  const snap = store.get();
  if (!snap.ready) return;
  const last = cur.last && cur.last.ts;
  const stale = !!last && Date.now() - last > STALE_MS;
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  if (snap.running || stale || (visible && !wantWatch(snap))) finish(ctx, null);
}

/** Nur für Tests: Zustand zurücksetzen. */
export function _reset() { samples = []; cur = null; persist(); }
