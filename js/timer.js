// Stempeluhr-Logik: Einstempeln, Pause, Abschnitte, Ausstempeln, Zeitberechnung und Doppeltipp-Sperre.
import * as store from "./store.js";
import { newId } from "./util.js";

export const TAP_LOCK_MS = 1500;

let lockedUntil = 0;

/** Doppeltipp-Sperre aktiv? */
export function isLocked() {
  return Date.now() < lockedUntil;
}

/** Sperre für TAP_LOCK_MS setzen. */
export function lock() {
  lockedUntil = Date.now() + TAP_LOCK_MS;
}

/** Bisherige Pausenzeit in ms (inkl. laufender Pause). */
export function pauseMsNow(running, now = Date.now()) {
  if (!running) return 0;
  const base = Number(running.pauseMs) || 0;
  const open = running.pauseStart != null ? Math.max(0, now - running.pauseStart) : 0;
  return base + open;
}

/** Arbeitszeit ohne Pausen in ms; während einer Pause eingefroren (Bezug = pauseStart). */
export function netMs(running, now = Date.now()) {
  if (!running) return 0;
  const ref = running.pauseStart ?? now;
  const ms = ref - running.start - (Number(running.pauseMs) || 0);
  return Math.max(0, ms);
}

export const DEFAULT_ACTIVITY = "Arbeiten";

/** Abschnitte einer laufenden Schicht; alte Schichten ohne segments → ein Abschnitt „Arbeiten“. */
export function segmentsOf(running) {
  if (!running) return [];
  if (Array.isArray(running.segments) && running.segments.length) return running.segments;
  return [{
    start: running.start,
    activity: DEFAULT_ACTIVITY,
    placeId: running.placeId ?? null,
    place: running.place || "",
    loc: running.inLoc ?? null,
  }];
}

/** Schicht beginnen (legt den ersten Abschnitt an). Wirft, wenn bereits eine Schicht läuft. */
export async function clockIn({ placeId = null, place = "", note = "", inLoc = null, activity = DEFAULT_ACTIVITY } = {}) {
  if (store.get().running) throw new Error("Du bist schon eingestempelt.");
  const start = Date.now();
  const running = {
    start,
    segments: [{
      start,
      activity: activity || DEFAULT_ACTIVITY,
      placeId: placeId ?? null,
      place: place || "",
      loc: inLoc ?? null,
    }],
    placeId: placeId ?? null,
    place: place || "",
    note: note || "",
    pauseStart: null,
    pauseMs: 0,
    inLoc: inLoc ?? null,
  };
  await store.setRunning(running);
  return running;
}

/** Pause starten bzw. beenden. Wirft, wenn keine Schicht läuft. */
export async function togglePause() {
  const r = store.get().running;
  if (!r) throw new Error("Du bist nicht eingestempelt.");
  const now = Date.now();
  let next;
  if (r.pauseStart != null) {
    next = { ...r, pauseMs: (Number(r.pauseMs) || 0) + Math.max(0, now - r.pauseStart), pauseStart: null };
  } else {
    next = { ...r, pauseStart: now };
  }
  await store.setRunning(next);
  return next;
}

/** Neuen Abschnitt in der laufenden Schicht beginnen (z. B. „Autofahren“ → „Arbeiten“). */
export async function addSegment({ activity = DEFAULT_ACTIVITY, placeId = null, place = "", loc = null } = {}) {
  const r = store.get().running;
  if (!r) throw new Error("Du bist nicht eingestempelt.");
  const segs = segmentsOf(r);
  const last = segs[segs.length - 1];
  const start = Math.max(Date.now(), (last && last.start) || 0);
  const seg = { start, activity: activity || DEFAULT_ACTIVITY, placeId: placeId ?? null, place: place || "", loc: loc ?? null };
  const next = { ...r, segments: [...segs, seg] };
  await store.setRunning(next);
  return seg;
}

/** Abschnitte mit Ende für den Eintrag (nur Abschnitte, die vor dem Schichtende beginnen). */
function closeSegments(r, end) {
  const segs = segmentsOf(r).filter((s, i) => i === 0 || s.start < end);
  return segs.map((s, i) => ({
    ...s,
    start: i === 0 ? r.start : s.start,
    end: i + 1 < segs.length ? segs[i + 1].start : end,
  }));
}

/** Schicht beenden: ERST setRunning(null), DANN Eintrag speichern. Gibt den Eintrag zurück.
 *  Optional `end` (ms) für eine nachträglich gewählte Endzeit (Standard: jetzt). */
export async function clockOut({ outLoc = null, end = null } = {}) {
  const r = store.get().running;
  if (!r) throw new Error("Du bist nicht eingestempelt.");
  const now = Number.isFinite(end) && end > r.start ? Math.min(end, Date.now()) : Date.now();
  const entry = {
    id: newId("e"),
    start: r.start,
    end: now,
    pauseMin: Math.round(pauseMsNow(r, now) / 60000),
    placeId: r.placeId ?? null,
    place: r.place || "",
    note: r.note || "",
    inLoc: r.inLoc ?? null,
    outLoc: outLoc ?? null,
    segments: closeSegments(r, now),
  };
  await store.setRunning(null);
  await store.saveEntry(entry);
  return entry;
}
