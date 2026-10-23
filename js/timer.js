// Stempeluhr-Logik: Einstempeln, Pause, Ausstempeln, Zeitberechnung und Doppeltipp-Sperre.
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

/** Schicht beginnen. Wirft, wenn bereits eine Schicht läuft. */
export async function clockIn({ placeId = null, place = "", note = "", inLoc = null } = {}) {
  if (store.get().running) throw new Error("Du bist schon eingestempelt.");
  const running = {
    start: Date.now(),
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

/** Schicht beenden: ERST setRunning(null), DANN Eintrag speichern. Gibt den Eintrag zurück. */
export async function clockOut({ outLoc = null } = {}) {
  const r = store.get().running;
  if (!r) throw new Error("Du bist nicht eingestempelt.");
  const now = Date.now();
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
  };
  await store.setRunning(null);
  await store.saveEntry(entry);
  return entry;
}
