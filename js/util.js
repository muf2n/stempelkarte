// Kleine Hilfsfunktionen: Zeit-/Datumsformatierung, Wochen-/Monatsgrenzen, HTML-Escaping, IDs.
import { isPrivateTrip } from "./privat-core.js"; // Update 9 – Privat: private Fahrten zählen nie als Arbeitszeit
export { isPrivateTrip };

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
  if (isPrivateTrip(entry)) return 0; // Update 9 – Privatfahrt (eigener Eintrag) = 0 h
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

/** Soll-Minuten für diesen Tag (0 an Nicht-Arbeitstagen, ggf. Feiertagen und – Update 6 – Berufsschultagen). */
export function dailyTargetMin(ts, settings) {
  const base = baseTargetMin(ts, settings);
  if (base > 0 && isSchoolDay(ts, settings)) return 0; // Schulzeit = Arbeitszeit → Soll gilt als erfüllt
  return base;
}

/** Tagessoll ohne Berücksichtigung der Berufsschule. */
function baseTargetMin(ts, settings) {
  const s = settings || {};
  const days = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
  if (!days.length) return 0;
  const d = toDate(ts);
  if (!days.includes(d.getDay())) return 0;
  if (s.holidays !== false && holidayName(d)) return 0;
  return weekdayTargetMin(d.getDay(), s);
}

/* ---------- Update 10c: Soll je Wochentag (optional) ----------
 * settings.dayHours = { "1": 8.5, "5": 6 } (Stunden, Schlüssel 0 = So … 6 = Sa). Nur Arbeitstage zählen.
 * Tage mit eigenem Wert bekommen genau diesen; die übrigen Arbeitstage teilen sich den Rest des Wochensolls
 * (weeklyTarget − Summe der eigenen Werte, nie unter 0). Ohne dayHours: gleichmäßig wie bisher.
 * Gleiche Regel in tools/mcp/src/logic.js und tools/reminders/decide.mjs (Test vergleicht). */

/** Gültige eigene Tagesstunden je Wochentag (nur Arbeitstage) → Map wd → Minuten. */
export function readDayHours(settings) {
  const s = settings || {};
  const days = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
  const out = new Map();
  const dh = s.dayHours && typeof s.dayHours === "object" ? s.dayHours : null;
  if (!dh) return out;
  for (const wd of days) {
    const v = dh[String(wd)];
    if (v == null || v === "") continue;
    const h = Number(v);
    if (Number.isFinite(h) && h >= 0 && h <= 24) out.set(Number(wd), Math.round(h * 60));
  }
  return out;
}

/** Soll eines Arbeitstags mit Wochentag wd (ohne Feiertag/Schule; 0 bei Nicht-Arbeitstag). */
export function weekdayTargetMin(wd, settings) {
  const s = settings || {};
  const days = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
  if (!days.length || !days.includes(wd)) return 0;
  const own = readDayHours(s);
  if (own.has(wd)) return own.get(wd);
  const weekly = Number(s.weeklyTarget ?? 38.5);
  if (!Number.isFinite(weekly) || weekly <= 0) return 0;
  const rest = days.length - own.size;
  if (rest <= 0) return 0;
  let used = 0;
  for (const m of own.values()) used += m;
  return Math.max(0, weekly * 60 - used) / rest;
}

/** Gutgeschriebene Minuten: Arbeit → netMin, Abwesenheit → entry.creditMin. */
export function creditMin(entry) {
  if (!entry) return 0;
  if (!entry.kind || entry.kind === "work") return netMin(entry);
  return Math.max(0, Number(entry.creditMin ?? 0) || 0);
}

const KIND_LABELS = { work: "Arbeit", urlaub: "Urlaub", krank: "Krank", feiertag: "Feiertag", zeitausgleich: "Zeitausgleich", schule: "Schule" };

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

/* ---------- Update 6: Berufsschule (Lehrlinge) ---------- */
// settings.school = { days:number[] (0..6), blocks:[{id, from:"YYYY-MM-DD", to:"YYYY-MM-DD", label}] }
// Schulzeit zählt als Arbeitszeit. Feiertage haben Vorrang. Blockschule zählt nur an Arbeitstagen.

/** Gültige Schuleinstellungen ({days, blocks}) oder null. */
export function readSchool(settings) {
  const sc = settings && settings.school;
  if (!sc || typeof sc !== "object") return null;
  const days = Array.isArray(sc.days)
    ? [...new Set(sc.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const blocks = Array.isArray(sc.blocks)
    ? sc.blocks.filter((b) => b && re.test(String(b.from || "")) && re.test(String(b.to || "")) && b.from <= b.to) : [];
  if (!days.length && !blocks.length) return null;
  return { days, blocks };
}

/** Bezeichnung des Schultags ("Berufsschule" bzw. Block-Label) oder null. */
export function schoolLabel(ts, settings) {
  const sc = readSchool(settings);
  if (!sc) return null;
  const d = toDate(ts);
  const s = settings || {};
  if (s.holidays !== false && holidayName(d)) return null;
  const k = dayKey(d);
  const workDays = Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5];
  // Blockschule: Mo–Fr ist Schule, auch wenn ein Wochentag kein eigener Arbeitstag ist (z. B. 4-Tage-Woche)
  const wd = d.getDay();
  if (workDays.includes(wd) || (wd >= 1 && wd <= 5)) {
    const b = sc.blocks.find((x) => x.from <= k && k <= x.to);
    if (b) return String(b.label || "").trim() || "Blockschule";
  }
  if (sc.days.includes(d.getDay())) return "Berufsschule";
  return null;
}

/** Ist an diesem Tag Berufsschule (wöchentlich oder Block, kein Feiertag)? */
export function isSchoolDay(ts, settings) {
  return schoolLabel(ts, settings) != null;
}

/** Gutschrift eines Schultags: Tagessoll (ohne Schul-Abzug) an Schultagen, sonst 0. */
export function schoolCreditMin(ts, settings) {
  return isSchoolDay(ts, settings) ? baseTargetMin(ts, settings) : 0;
}
