// Freizeit-Stempeluhr (Privat): Sport & Zuhause. Reine Logik, ohne DOM – getestet in test/freizeit-core.test.mjs.
// Daten: Alltag-Sammlung "freizeit" → { id, kind, label, emoji, cat: "sport"|"zuhause", start, end|null, note?, km? }

export const ACTIVITIES = [
  { kind: "rad", label: "Radfahren", emoji: "🚴", cat: "sport", km: true },
  { kind: "laufen", label: "Laufen", emoji: "🏃", cat: "sport", km: true },
  { kind: "fitness", label: "Fitness", emoji: "🏋️", cat: "sport" },
  { kind: "fussball", label: "Fußball", emoji: "⚽", cat: "sport" },
  { kind: "schwimmen", label: "Schwimmen", emoji: "🏊", cat: "sport" },
  { kind: "wandern", label: "Wandern", emoji: "🥾", cat: "sport", km: true },
  { kind: "spazieren", label: "Spazieren", emoji: "🚶", cat: "sport", km: true },
  { kind: "aufraeumen", label: "Aufräumen", emoji: "🧹", cat: "zuhause" },
  { kind: "kochen", label: "Kochen", emoji: "🍳", cat: "zuhause" },
  { kind: "heimwerken", label: "Heimwerken", emoji: "🔨", cat: "zuhause" },
  { kind: "garten", label: "Garten", emoji: "🌱", cat: "zuhause" },
  { kind: "waesche", label: "Wäsche", emoji: "🧺", cat: "zuhause" },
  { kind: "lernen", label: "Lernen", emoji: "📚", cat: "zuhause" },
];

export const CATS = { sport: { label: "Sport", emoji: "💪" }, zuhause: { label: "Zuhause", emoji: "🏡" } };

export function activity(kind) {
  return ACTIVITIES.find((a) => a.kind === kind) || null;
}

/** Eintrag für einen Start bauen (eigene Aktivität: kind "eigen" + label). */
export function startItem(kind, now, custom) {
  const a = activity(kind);
  if (a) return { kind: a.kind, label: a.label, emoji: a.emoji, cat: a.cat, start: now, end: null };
  const label = String((custom && custom.label) || "").trim().slice(0, 40);
  if (!label) return null;
  const cat = custom && custom.cat === "sport" ? "sport" : "zuhause";
  return { kind: "eigen", label, emoji: cat === "sport" ? "💪" : "🏡", cat, start: now, end: null };
}

export function running(items) {
  return (items || []).filter((i) => i && !i.end && Number.isFinite(i.start)).sort((a, b) => b.start - a.start)[0] || null;
}

export function durMs(i, now) {
  if (!i || !Number.isFinite(i.start)) return 0;
  const end = Number.isFinite(i.end) ? i.end : now;
  return Math.max(0, end - i.start);
}

/** Montag 00:00 der Woche von ts (lokal). */
export function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function dayStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Zusammenfassung ab `from`: Summe je Kategorie + je Aktivität (absteigend), km-Summe. */
export function summary(items, from, now) {
  const cats = { sport: 0, zuhause: 0 };
  const by = new Map();
  let km = 0;
  for (const i of items || []) {
    if (!i || !Number.isFinite(i.start) || i.start < from || i.start > now) continue;
    const ms = durMs(i, now);
    const cat = i.cat === "sport" ? "sport" : "zuhause";
    cats[cat] += ms;
    const key = i.kind === "eigen" ? "eigen:" + i.label : i.kind;
    const cur = by.get(key) || { key, label: i.label, emoji: i.emoji, cat, ms: 0, n: 0 };
    cur.ms += ms; cur.n += 1;
    by.set(key, cur);
    if (Number.isFinite(i.km) && i.km > 0) km += i.km;
  }
  return { cats, total: cats.sport + cats.zuhause, list: [...by.values()].sort((a, b) => b.ms - a.ms), km: Math.round(km * 10) / 10 };
}

/** "1:05 h" / "42 Min" */
export function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return m + " Min";
  return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") + " h";
}

/** Live-Uhr "0:42:10" */
export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 3600) + ":" + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/** km-Eingabe "12,5" → 12.5 (oder null) */
export function parseKm(v) {
  const n = Number(String(v || "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 10) / 10 : null;
}
