// Kleine Hilfsfunktionen: Zeit-/Datumsformatierung, Wochen-/Monatsgrenzen, HTML-Escaping, IDs.

export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const DAY = 86400000;

function toDate(dateOrTs) {
  if (dateOrTs instanceof Date) return new Date(dateOrTs.getTime());
  if (dateOrTs == null || dateOrTs === "") return new Date();
  const d = new Date(dateOrTs);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Zweistellig mit führender Null: 7 → "07". */
export function pad(n) {
  return String(Math.trunc(Number(n) || 0)).padStart(2, "0");
}

/** Minuten → "7:45"; negativ → "-0:30". */
export function hm(min) {
  let m = Math.round(Number(min) || 0);
  const neg = m < 0;
  m = Math.abs(m);
  return (neg ? "-" : "") + Math.floor(m / 60) + ":" + pad(m % 60);
}

/** Millisekunden → "7:45:03" (negativ wird als 0 behandelt). */
export function hms(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
}

/** Zeitstempel → Uhrzeit "08:05" (lokal). */
export function clock(ts) {
  const d = toDate(ts);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/** Zeitstempel → "2026-10-23" (lokale Zeit). */
export function dayKey(ts) {
  const d = toDate(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/** Beginn des Tages (00:00 lokal) als Date. */
export function startOfDay(dateOrTs) {
  const d = toDate(dateOrTs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Beginn der Woche (Montag 00:00 lokal) als Date. */
export function startOfWeek(dateOrTs) {
  const d = startOfDay(dateOrTs);
  const back = (d.getDay() + 6) % 7; // Mo=0 … So=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** Erster Tag des Monats (m = 0…11, Überlauf wird von Date korrigiert). */
export function startOfMonth(y, m) {
  return new Date(y, m, 1);
}

/** Netto-Minuten eines Eintrags: max(0, Dauer − Pause). */
export function netMin(entry) {
  if (!entry) return 0;
  const dur = ((Number(entry.end) || 0) - (Number(entry.start) || 0)) / 60000;
  return Math.max(0, dur - (Number(entry.pauseMin) || 0));
}

/** HTML-Escaping für Benutzertext. */
export function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Zufällige, zeitlich sortierbare ID: Präfix + Zeit (base36, 9 Stellen) + Zufall. */
export function newId(prefix = "") {
  const t = Date.now().toString(36).padStart(9, "0");
  let r = "";
  try {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    r = Array.from(a, (b) => (b % 36).toString(36)).join("");
  } catch {
    r = Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  }
  return prefix + t + r;
}

/** Zeitstempel → "Fr, 23.10.2026". */
export function fmtDate(ts) {
  const d = toDate(ts);
  return WD[d.getDay()] + ", " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear();
}

/** Entfernung in Metern → "40 m" / "1,2 km". */
export function fmtDist(m) {
  const v = Math.max(0, Number(m) || 0);
  if (Math.round(v) < 1000) return Math.round(v) + " m";
  const km = v / 1000;
  return (km < 10 ? km.toFixed(1) : String(Math.round(km))).replace(".", ",") + " km";
}
