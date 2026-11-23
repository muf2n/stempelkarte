// Stundenplan vom Foto – reine Logik (ohne DOM): Claude-Antwort prüfen und in Stunden umwandeln.
// Die App zeigt das Ergebnis immer zur Kontrolle an, bevor etwas gespeichert wird.
export const PHOTO_PERIODS = [
  null, ["08:00", "08:50"], ["08:50", "09:40"], ["09:55", "10:45"], ["10:45", "11:35"], ["11:45", "12:35"], ["12:35", "13:25"],
  ["13:45", "14:35"], ["14:35", "15:25"], ["15:35", "16:25"], ["16:25", "17:15"], ["17:20", "18:10"], ["18:10", "19:00"],
];
const RE_T = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const t = (v) => { const m = RE_T.exec(String(v || "").trim()); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : ""; };
const txt = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

/** JSON aus der Antwort holen (auch wenn Claude doch einen Codeblock oder Text drumherum schreibt). */
export function extractJson(reply) {
  const s = String(reply || ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Antwort → { lessons: [...geprüft], note } */
export function parsePlan(reply) {
  const j = extractJson(reply);
  if (!j || !Array.isArray(j.lessons)) return { lessons: [], note: "Ich konnte den Stundenplan nicht lesen. Bitte nochmal mit mehr Licht und gerade von oben fotografieren." };
  const out = [];
  for (const x of j.lessons.slice(0, 80)) {
    if (!x || typeof x !== "object") continue;
    const weekday = int(x.weekday, 1, 6), period = int(x.period, 1, 12), subject = txt(String(x.subject || "").replace(/^(PG|FG|UÜ|UU|WPG|FÜ)_/i, ""), 40);
    if (!weekday || !period || !subject) continue;
    const periods = Math.min(int(x.periods, 1, 6) || 1, 13 - period);
    const from = t(x.from) || PHOTO_PERIODS[period][0], to = t(x.to) || PHOTO_PERIODS[period + periods - 1][1];
    const week = x.week === "A" || x.week === "B" ? x.week : "";
    out.push({ weekday, period, periods, from, to, subject, room: txt(x.room, 20), teacher: txt(x.teacher, 40), week });
  }
  out.sort((a, b) => a.weekday - b.weekday || a.period - b.period);
  return { lessons: out, note: txt(j.note, 200) };
}

/** Gibt es diese Stunde schon genau so? (dann nicht doppelt eintragen) */
export const sameLesson = (a, b) => Number(a.weekday) === b.weekday && Number(a.period) === b.period && String(a.subject || "").toLowerCase() === b.subject.toLowerCase() && (a.week || "") === b.week;
/** Überschneidet sich mit einer anderen Stunde? */
export const clashes = (a, b) => Number(a.weekday) === b.weekday && (!a.week || !b.week || a.week === b.week)
  && Number(a.period) < b.period + b.periods && b.period < Number(a.period) + Math.max(1, Number(a.periods) || 1);

/* ---------- WebUntis-Kalender (iCal) → Stunden ---------- */
const toM = (t) => { const m = RE_T.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Nummer der Stunde aus der Uhrzeit (nächster Beginn im Raster, sonst grob 50 min ab 08:00). */
export function periodOf(from) {
  const f = toM(from); if (f == null) return 1;
  let best = 1, d = Infinity;
  for (let i = 1; i < PHOTO_PERIODS.length; i++) { const x = Math.abs(toM(PHOTO_PERIODS[i][0]) - f); if (x < d) { d = x; best = i; } }
  return d <= 20 ? best : Math.max(1, Math.min(12, 1 + Math.round((f - 480) / 50)));
}
/** Kalender-Termine (mehrere Wochen) → wiederkehrende Stunden: gleiche Wochentag/Zeit/Fach nur einmal. */
export function lessonsFromEvents(evs) {
  const map = new Map();
  for (const e of evs || []) {
    if (!e || e.allDay || !e.date || !e.time) continue;
    const wd = new Date(e.date + "T12:00:00").getDay(); if (wd < 1 || wd > 6) continue;
    const subject = txt(String(e.title || "").replace(/\s*\((?:entfällt|Entfall|cancelled)\)\s*/i, ""), 40); if (!subject) continue;
    if (/entf(ä|ae)llt|cancel/i.test(String(e.title) + " " + String(e.note || ""))) continue;
    const from = t(e.time), to = t(e.endTime) || "", key = `${wd}|${from}|${subject.toLowerCase()}`;
    if (map.has(key)) { map.get(key).n++; continue; }
    const len = to ? Math.max(1, Math.round((toM(to) - toM(from)) / 50)) : 1, period = periodOf(from);
    const teacher = txt((/(?:Lehrer|Lehrkraft|Teacher)\s*:?\s*([^\n,;]+)/i.exec(String(e.note || "")) || [])[1], 40);
    map.set(key, { n: 1, l: { weekday: wd, period, periods: Math.min(len, 13 - period, 6), from, to: to || PHOTO_PERIODS[period][1], subject, room: txt(e.location, 20), teacher, week: "" } });
  }
  return [...map.values()].map((x) => x.l).sort((a, b) => a.weekday - b.weekday || a.from.localeCompare(b.from));
}

/** Stunden-Nummern aus den echten Uhrzeiten neu bestimmen (wie in WebUntis: jede Beginn-Zeit = eine Stunde). */
export function normalizePeriods(lessons) {
  const starts = [...new Set(lessons.map((l) => l.from).filter(Boolean))].sort();
  if (!starts.length) return lessons;
  return lessons.map((l) => {
    if (!l.from) return l;
    const p = starts.indexOf(l.from) + 1, to = l.to || l.from;
    const n = Math.max(1, starts.filter((s) => s >= l.from && s < to).length);
    return { ...l, period: Math.min(12, p), periods: Math.min(n, 13 - Math.min(12, p)) };
  });
}
/** Parallele Stunden (Gruppenteilung) gleichen Tags und Beginns zusammenfassen → für Nebeneinander-Anzeige */
export function groupParallel(lessons) {
  const m = new Map();
  for (const l of lessons) { const k = `${l.weekday}|${l.period}`; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return [...m.values()];
}
