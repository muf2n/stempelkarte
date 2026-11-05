// Update 9 – Privat / Arbeit (Browser): wirksamer Modus aus dem Store (lokale Zeit), Modus speichern, Abonnenten.
// Reine Regeln: js/privat-core.js.
import * as store from "./store.js";
import { dayKey, holidayName } from "./util.js";
import * as P from "./privat-core.js";

export { P as core };

/** Kalender-Sicht in lokaler Zeit (für privat-core). */
export function localCal(ts) {
  const d = new Date(ts);
  let hol = false;
  try { hol = !!holidayName(d); } catch { hol = false; }
  return { key: dayKey(d), wd: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), holiday: hol };
}

/** Lokale Uhrzeit heute + tage → Zeitstempel. */
export function localTs(days, hh, mm) {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hh, mm, 0, 0).getTime();
}

/** Wirksamer Modus (siehe privat-core effectiveMode). */
export function modeNow(snap = null, now = Date.now()) {
  let s = snap;
  if (!s) { try { s = store.get(); } catch { s = null; } }
  const settings = (s && s.settings) || {};
  return P.effectiveMode(settings, now, { running: s ? s.running : null, calOf: localCal });
}

/** Gerade privat (nicht eingestempelt und Privat-Modus aktiv)? */
export function isPrivatNow(snap = null, now = Date.now()) {
  try { return modeNow(snap, now).privat; } catch { return false; }
}

/** Modus speichern. privat=true + until (ts|null). */
export async function setMode(privat, until = null) {
  const v = P.modeValue(privat, Date.now(), until, "manual");
  await store.saveSettings({ mode: v });
  return v;
}

/** Teil-Einstellungen für Zeitplan / Fahrten speichern. */
export async function saveModeSchedule(partial) {
  const cur = P.readModeSchedule(store.get().settings || {});
  await store.saveSettings({ modeSchedule: { enabled: cur.enabled, from: cur.from, to: cur.to, ...partial } });
}
export async function saveRecordTrips(on) {
  await store.saveSettings({ privatTrips: { record: !!on } });
}
