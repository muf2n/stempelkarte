// Gemeinsame Lern-Logik (ohne DOM) für Alltag-Lernmodule (🇯🇵 Japanisch, 🎓 LAP Elektrotechnik):
// SRS (SM-2, Tagesauflösung), Lern-Warteschlange, Zufall, Tages-/Serien-Statistik.
// Unit-Tests: test/jp-core.test.mjs (über jp-core.js) und test/lap-core.test.mjs

/* ---------- Datum ---------- */
const pad = (n) => String(n).padStart(2, "0");
/** Lokaler Tagesschlüssel "JJJJ-MM-TT". */
export function dayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export function addDays(key, n) {
  const [y, m, d] = String(key).split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

/* ---------- SRS (SM-2, Tagesauflösung) ---------- */
// Karte: { ef, reps, interval (Tage), due ("JJJJ-MM-TT"), lapses, seen, last }
// Bewertung q: 1 = Nochmal, 3 = Schwer, 4 = Gut, 5 = Leicht
export const GRADES = [
  { q: 1, label: "Nochmal", emoji: "🔁" },
  { q: 3, label: "Schwer", emoji: "😅" },
  { q: 4, label: "Gut", emoji: "🙂" },
  { q: 5, label: "Leicht", emoji: "😎" },
];
export function newCard(today) {
  return { ef: 2.5, reps: 0, interval: 0, due: today, lapses: 0, seen: 0, last: null };
}
/** Neue SRS-Werte nach Bewertung q (0–5). Rein – gibt ein neues Objekt zurück. */
export function review(card, q, today) {
  const c = { ...newCard(today), ...(card || {}) };
  q = Math.max(0, Math.min(5, Math.round(Number(q) || 0)));
  const ef = Math.max(1.3, Math.round((c.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)) * 1000) / 1000);
  let reps, interval, lapses = c.lapses;
  if (q < 3) {
    reps = 0; interval = 0; lapses += 1; // heute nochmal
  } else {
    reps = c.reps + 1;
    if (reps === 1) interval = q === 5 ? 3 : 1;
    else if (reps === 2) interval = q === 3 ? 3 : 6;
    else interval = Math.round(Math.max(1, c.interval) * (q === 3 ? 1.2 : ef) * (q === 5 ? 1.3 : 1));
    interval = Math.min(365, Math.max(1, interval));
  }
  return { ...c, ef, reps, interval, lapses, due: addDays(today, interval), seen: c.seen + 1, last: today };
}
export const isDue = (card, today) => !!card && (!card.due || card.due <= today);
/** Als „gelernt“ gilt eine Karte, die mindestens einmal richtig gewusst wurde und nicht gerade zurückgefallen ist. */
export const isLearned = (card) => !!card && card.reps >= 1;
/** Kana gilt als „gemeistert“ ab 3 richtigen Wiederholungen in Folge (Intervall ≥ 6 Tage). */
export const isMastered = (card) => !!card && card.reps >= 3;

/**
 * Lern-Warteschlange: zuerst fällige Karten (älteste zuerst), dann bis zu `newLimit` neue Karten (in Deck-Reihenfolge).
 * @param {{id:string}[]} items  alle Lernobjekte (Starter-Deck + eigene Wörter, ggf. Kana)
 * @param {Map<string,object>|object} cards  SRS-Stand je id
 */
export function buildQueue(items, cards, today, { newLimit = 10, newToday = 0 } = {}) {
  const get = (id) => (cards instanceof Map ? cards.get(id) : cards[id]);
  const due = [], fresh = [];
  for (const it of items) {
    const c = get(it.id);
    if (c && c.seen > 0) { if (isDue(c, today)) due.push(it); }
    else fresh.push(it);
  }
  due.sort((a, b) => String(get(a.id).due).localeCompare(String(get(b.id).due)));
  return { due, fresh: fresh.slice(0, Math.max(0, newLimit - newToday)) };
}

/** Kleiner, deterministischer Zufallsgenerator (für Tests). */
export function rng(seed = Date.now()) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- Statistik ---------- */
// Stats-Dokument: { id:"me", goal, newPerDay, days: { "JJJJ-MM-TT": { n, ok, fresh, <Bereich>: Anzahl } } }
export const DEFAULT_STATS = { id: "me", goal: 20, newPerDay: 10, days: {} };
/** Übung zählen. defaults: Standardwerte des jeweiligen Moduls (z. B. anderes Tagesziel). */
export function bump(stats, today, field, by = 1, ok = null, defaults = DEFAULT_STATS) {
  const s = { ...defaults, ...(stats || {}), days: { ...((stats && stats.days) || {}) } };
  const d = { ...(s.days[today] || {}) };
  d[field] = (d[field] || 0) + by;
  if (field !== "n" && field !== "ok" && field !== "fresh") d.n = (d.n || 0) + by; // jede Übung zählt fürs Tagesziel
  if (ok) d.ok = (d.ok || 0) + 1;
  s.days[today] = d;
  // auf ~400 Tage begrenzen
  const keys = Object.keys(s.days).sort();
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete s.days[k];
  return s;
}
/** Serie (🔥): aufeinanderfolgende Tage mit Übung, bis heute (oder bis gestern, wenn heute noch nichts war). */
export function streak(stats, today) {
  const days = (stats && stats.days) || {};
  const active = (k) => (days[k] && days[k].n) > 0;
  let k = active(today) ? today : addDays(today, -1);
  let n = 0;
  while (active(k)) { n++; k = addDays(k, -1); if (n > 3660) break; }
  return n;
}
export const todayCount = (stats, today) => ((stats && stats.days && stats.days[today]) || {}).n || 0;
