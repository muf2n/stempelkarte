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

/* ---------- Update 2: Feiertage (Österreich), Tagessoll, Gutschriften ---------- */

const holidayCache = new Map();

/** Ostersonntag (Gauß/Meeus, gregorianisch) → {m: 0–11, d}. */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month - 1, d: day };
}

function holidaysOf(year) {
  const y = Math.trunc(Number(year));
  if (holidayCache.has(y)) return holidayCache.get(y);
  const map = new Map();
  const add = (m, d, name) => map.set(dayKey(new Date(y, m, d)), name);
  const e = easter(y);
  const rel = (off, name) => add(e.m, e.d + off, name); // Date korrigiert Überlauf
  add(0, 1, "Neujahr");
  add(0, 6, "Heilige Drei Könige");
  rel(0, "Ostersonntag");
  rel(1, "Ostermontag");
  add(4, 1, "Staatsfeiertag");
  rel(39, "Christi Himmelfahrt");
  rel(49, "Pfingstsonntag");
  rel(50, "Pfingstmontag");
  rel(60, "Fronleichnam");
  add(7, 15, "Mariä Himmelfahrt");
  add(9, 26, "Nationalfeiertag");
  add(10, 1, "Allerheiligen");
  add(11, 8, "Mariä Empfängnis");
  add(11, 25, "Christtag");
  add(11, 26, "Stefanitag");
  const sorted = new Map([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  holidayCache.set(y, sorted);
  return sorted;
}

/** Gesetzliche Feiertage in Österreich: Map dayKey → Name. */
export function atHolidays(year) {
  return new Map(holidaysOf(year));
}

/** Name des Feiertags an diesem Tag oder null. */
export function holidayName(ts) {
  const d = toDate(ts);
  return holidaysOf(d.getFullYear()).get(dayKey(d)) || null;
}

/** Soll-Minuten für diesen Tag (0 an Nicht-Arbeitstagen und ggf. Feiertagen). */
export function dailyTargetMin(ts, settings) {
  const s = settings || {};
  const days = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
  if (!days.length) return 0;
  const d = toDate(ts);
  if (!days.includes(d.getDay())) return 0;
  if (s.holidays !== false && holidayName(d)) return 0;
  const weekly = Number(s.weeklyTarget ?? 38.5);
  if (!Number.isFinite(weekly) || weekly <= 0) return 0;
  return (weekly * 60) / days.length;
}

/** Gutgeschriebene Minuten: Arbeit → netMin, Abwesenheit → entry.creditMin. */
export function creditMin(entry) {
  if (!entry) return 0;
  if (!entry.kind || entry.kind === "work") return netMin(entry);
  return Math.max(0, Number(entry.creditMin ?? 0) || 0);
}

const KIND_LABELS = { work: "Arbeit", urlaub: "Urlaub", krank: "Krank", feiertag: "Feiertag", zeitausgleich: "Zeitausgleich" };

/** Anzeigename einer Eintragsart. */
export function kindLabel(kind) {
  return KIND_LABELS[kind || "work"] || "Arbeit";
}

/* ---------- Update 5: Feiertage sichtbar machen ---------- */

const HOLIDAY_SHORT = {
  "Neujahr": "Neujahr",
  "Heilige Drei Könige": "Hl. 3 Kön.",
  "Ostersonntag": "Ostern",
  "Ostermontag": "Ostermo.",
  "Staatsfeiertag": "Staatsf.",
  "Christi Himmelfahrt": "Chr. Himmelf.",
  "Pfingstsonntag": "Pfingsten",
  "Pfingstmontag": "Pfingstmo.",
  "Fronleichnam": "Fronl.",
  "Mariä Himmelfahrt": "Mariä Himmelf.",
  "Nationalfeiertag": "Nationalf.",
  "Allerheiligen": "Allerh.",
  "Mariä Empfängnis": "Mariä Empf.",
  "Christtag": "Christtag",
  "Stefanitag": "Stefanitag",
};

/** Kurzform eines Feiertagsnamens für Kalenderzellen. */
export function holidayShort(name) {
  if (!name) return "";
  const s = String(name);
  return HOLIDAY_SHORT[s] || (s.length > 11 ? s.slice(0, 10) + "." : s);
}

/** Die nächsten `count` Feiertage ab dem Tag von fromTs (inklusive) → [{ts, name}]. */
export function upcomingHolidays(fromTs, count = 3) {
  const from = startOfDay(fromTs);
  const fromKey = dayKey(from);
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  const out = [];
  for (let y = from.getFullYear(); out.length < n && y <= from.getFullYear() + 2; y++) {
    for (const [k, name] of holidaysOf(y)) {
      if (k < fromKey) continue;
      const [yy, mm, dd] = k.split("-").map(Number);
      out.push({ ts: new Date(yy, mm - 1, dd).getTime(), name });
      if (out.length >= n) break;
    }
  }
  return out;
}
