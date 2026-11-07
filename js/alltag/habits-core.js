// Update 10 – 🎯 Routinen & Ziele: reine Logik ohne DOM (Node-testbar, test/habits-core.test.mjs).
// Sammlungen (js/alltag/db.js):
//   habits   { id, title, emoji, freq: "daily"|"weekly", target, log: { "JJJJ-MM-TT": Anzahl }, archived }
//            daily: target = wie oft pro Tag (meist 1) · weekly: target = an wie vielen Tagen pro Woche (1–7)
//   routines { id: "morgen"|"abend", title, items: [{ id, text }], doneDay, doneIds: [], log: { Tag: 1 } } – setzt sich täglich zurück
//   goals    { id, title, emoji, due, milestones: [{ id, text, done, doneAt }], progress (0–100, ohne Meilensteine), done, notes }

const pad = (n) => String(n).padStart(2, "0");
const s = (v) => (v == null ? "" : String(v).trim());
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const isKey = (k) => RE_KEY.test(s(k));
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (now = Date.now()) => keyOf(new Date(now));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
/** Montag der Woche (JJJJ-MM-TT). */
export function mondayOf(k) { const d = dateOf(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return keyOf(d); }

export const KEEP_DAYS = 400;
let seq = 0;
export const newItemId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

/* ---------------- Gewohnheiten ---------------- */

export function normHabit(x = {}) {
  const freq = x.freq === "weekly" ? "weekly" : "daily";
  const tRaw = Math.round(Number(x.target));
  const target = freq === "weekly" ? (tRaw >= 1 && tRaw <= 7 ? tRaw : 3) : (tRaw >= 1 && tRaw <= 20 ? tRaw : 1);
  const log = {};
  if (x.log && typeof x.log === "object") for (const [k, v] of Object.entries(x.log)) { const n = Math.round(Number(v)); if (isKey(k) && n > 0) log[k] = Math.min(n, 99); }
  return { ...x, id: s(x.id), title: s(x.title).slice(0, 60), emoji: s(x.emoji).slice(0, 8) || "⭐", freq, target, log, archived: !!x.archived };
}

const count = (h, k) => Number(h.log[k]) || 0;
/** An dem Tag erledigt? (weekly: mindestens einmal abgehakt) */
export function doneOn(h, k) { const x = normHabit(h); return x.freq === "daily" ? count(x, k) >= x.target : count(x, k) > 0; }
/** Abgehakte Tage in der Woche von k. */
export function weekCount(h, k) {
  const x = normHabit(h);
  const mo = mondayOf(k);
  let n = 0;
  for (let i = 0; i < 7; i++) if (count(x, addDays(mo, i)) > 0) n++;
  return n;
}

/**
 * Streak 🔥 → { current, best, unit: "Tage"|"Wochen", today: bool (heute/diese Woche schon geschafft) }
 * daily: zusammenhängende erledigte Tage bis heute; ist heute noch offen, zählt die Serie bis gestern (noch nicht gerissen).
 * weekly: zusammenhängende Wochen mit erreichtem Ziel; die laufende Woche zählt mit, sobald sie geschafft ist.
 */
export function streak(h, today = todayKey()) {
  const x = normHabit(h);
  const keys = Object.keys(x.log).sort();
  if (x.freq === "weekly") {
    const ok = (mo) => weekCount(x, mo) >= x.target;
    const thisMo = mondayOf(today);
    const doneNow = ok(thisMo);
    let cur = 0;
    let mo = doneNow ? thisMo : addDays(thisMo, -7);
    while (ok(mo)) { cur++; mo = addDays(mo, -7); }
    let best = 0, run = 0;
    if (keys.length) {
      let m = mondayOf(keys[0]);
      while (m <= thisMo) { if (ok(m)) { run++; best = Math.max(best, run); } else run = 0; m = addDays(m, 7); }
    }
    return { current: cur, best: Math.max(best, cur), unit: "Wochen", today: doneNow };
  }
  const ok = (k) => count(x, k) >= x.target;
  const doneNow = ok(today);
  let cur = 0;
  let k = doneNow ? today : addDays(today, -1);
  while (ok(k)) { cur++; k = addDays(k, -1); }
  let best = 0, run = 0, prev = null;
  for (const d of keys) {
    if (!ok(d) || d > today) { continue; }
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    prev = d;
    best = Math.max(best, run);
  }
  return { current: cur, best: Math.max(best, cur), unit: "Tage", today: doneNow };
}

/** Heute noch zu tun? */
export function openToday(h, today = todayKey()) {
  const x = normHabit(h);
  if (x.archived) return false;
  if (x.freq === "daily") return count(x, today) < x.target;
  return count(x, today) === 0 && weekCount(x, today) < x.target;
}

/** Fortschritt-Text für heute/diese Woche. */
export function progressLabel(h, today = todayKey()) {
  const x = normHabit(h);
  if (x.freq === "weekly") return `${weekCount(x, today)}/${x.target} diese Woche`;
  return x.target > 1 ? `${count(x, today)}/${x.target} heute` : count(x, today) ? "heute erledigt ✓" : "heute offen";
}

/** Antippen: daily mit Ziel 1 und weekly → an/aus; daily mit Ziel > 1 → +1, bei erreichtem Ziel zurück auf 0. → neues log */
export function tap(h, k) {
  const x = normHabit(h);
  const c = count(x, k);
  const log = { ...x.log };
  const cap = x.freq === "daily" ? x.target : 1;
  const n = c >= cap ? 0 : c + 1;
  if (n) log[k] = n; else delete log[k];
  return prune(log, k);
}

/** Alte Tage (> 400) entfernen. */
export function prune(log, today) {
  const cut = addDays(today, -KEEP_DAYS);
  const out = {};
  for (const [k, v] of Object.entries(log || {})) if (k >= cut) out[k] = v;
  return out;
}

/**
 * Kalender-Heatmap der letzten Wochen (Mo–So, älteste zuerst):
 * → [{ week: Montag, days: [{ key, count, level 0–4, future, today }] }]
 */
export function heatmap(h, today = todayKey(), weeks = 8) {
  const x = normHabit(h);
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  const cap = x.freq === "daily" ? x.target : 1;
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const mo = addDays(start, w * 7);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(mo, i);
      const c = count(x, key);
      const level = c <= 0 ? 0 : c >= cap ? 4 : Math.max(1, Math.min(3, Math.round((c / cap) * 4)));
      days.push({ key, count: c, level, future: key > today, today: key === today });
    }
    out.push({ week: mo, days });
  }
  return out;
}

/** Quote der letzten n Tage (0–100), für Statistik. */
export function rate(h, today = todayKey(), n = 28) {
  const x = normHabit(h);
  if (x.freq === "weekly") {
    let ok = 0;
    for (let w = 1; w <= 4; w++) if (weekCount(x, addDays(mondayOf(today), -7 * w)) >= x.target) ok++;
    return Math.round((ok / 4) * 100);
  }
  let ok = 0;
  for (let i = 0; i < n; i++) if (count(x, addDays(today, -i)) >= x.target) ok++;
  return Math.round((ok / n) * 100);
}

/** Für Mitteilungen: Serie (≥ 2) in Gefahr – heute noch nicht erledigt, ab 18 Uhr. */
export function habitsAtRisk(habits, now = Date.now()) {
  const d = new Date(now);
  if (d.getHours() < 18) return [];
  const today = todayKey(now);
  const out = [];
  for (const h of Array.isArray(habits) ? habits : []) {
    const x = normHabit(h);
    if (!x.id || !x.title || x.archived || x.freq !== "daily" || !openToday(x, today)) continue;
    const st = streak(x, today);
    if (st.current >= 2) out.push({ id: x.id, title: x.title, emoji: x.emoji, streak: st.current, text: `${x.emoji} ${x.title} – ${st.current} Tage 🔥 nicht abreißen lassen!` });
  }
  return out.sort((a, b) => b.streak - a.streak);
}

/** Für das Dashboard: heute offene Gewohnheiten. */
export function openHabits(habits, today = todayKey()) {
  return (Array.isArray(habits) ? habits : []).map(normHabit).filter((x) => x.id && x.title && openToday(x, today));
}

/* ---------------- Morgen-/Abendroutine ---------------- */

export const ROUTINES = [
  { id: "morgen", title: "Morgenroutine", e: "🌅" },
  { id: "abend", title: "Abendroutine", e: "🌙" },
];
export function normRoutine(x = {}, id = "") {
  const rid = s(x.id) || id;
  const meta = ROUTINES.find((r) => r.id === rid) || { title: "Routine", e: "📋" };
  const items = Array.isArray(x.items) ? x.items.filter((i) => i && s(i.text)).map((i) => ({ id: s(i.id) || newItemId(), text: s(i.text).slice(0, 80) })) : [];
  const log = {};
  if (x.log && typeof x.log === "object") for (const [k, v] of Object.entries(x.log)) if (isKey(k) && v) log[k] = 1;
  return { ...x, id: rid, title: s(x.title) || meta.title, e: meta.e, items, doneDay: isKey(x.doneDay) ? x.doneDay : null, doneIds: Array.isArray(x.doneIds) ? x.doneIds.map(s) : [], log };
}
/** Heute abgehakte Punkte (gestern Abgehaktes zählt nicht – tägliches Zurücksetzen). */
export function checkedToday(r, today = todayKey()) {
  const x = normRoutine(r);
  if (x.doneDay !== today) return [];
  const ids = new Set(x.items.map((i) => i.id));
  return x.doneIds.filter((id) => ids.has(id));
}
/** Punkt umschalten → Teil-Änderung { doneDay, doneIds, log } */
export function toggleItem(r, itemId, today = todayKey()) {
  const x = normRoutine(r);
  const cur = new Set(checkedToday(x, today));
  if (cur.has(itemId)) cur.delete(itemId); else cur.add(itemId);
  const doneIds = x.items.map((i) => i.id).filter((id) => cur.has(id));
  const log = { ...x.log };
  if (x.items.length && doneIds.length === x.items.length) log[today] = 1; else delete log[today];
  return { doneDay: today, doneIds, log: prune(log, today) };
}
/** Routinen-Serie (komplett erledigte Tage). */
export function routineStreak(r, today = todayKey()) {
  const x = normRoutine(r);
  return streak({ id: x.id, title: x.title, freq: "daily", target: 1, log: x.log }, today);
}

/* ---------------- Ziele ---------------- */

export function normGoal(x = {}) {
  const ms = Array.isArray(x.milestones) ? x.milestones.filter((m) => m && s(m.text)).map((m) => ({ id: s(m.id) || newItemId(), text: s(m.text).slice(0, 100), done: !!m.done, doneAt: Number(m.doneAt) || null })) : [];
  const p = Math.round(Number(x.progress));
  return { ...x, id: s(x.id), title: s(x.title).slice(0, 80), emoji: s(x.emoji).slice(0, 8) || "🎯", due: isKey(x.due) ? x.due : null,
    milestones: ms, progress: Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0, done: !!x.done, notes: s(x.notes).slice(0, 1000) };
}
/** Fortschritt in % – mit Meilensteinen: Anteil erledigter, sonst der eingestellte Wert. Erledigtes Ziel = 100. */
export function goalProgress(g) {
  const x = normGoal(g);
  if (x.done) return 100;
  if (x.milestones.length) return Math.round((x.milestones.filter((m) => m.done).length / x.milestones.length) * 100);
  return x.progress;
}
export function toggleMilestone(g, msId, ts = Date.now()) {
  const x = normGoal(g);
  const milestones = x.milestones.map((m) => (m.id === msId ? { ...m, done: !m.done, doneAt: m.done ? null : ts } : m));
  return { milestones };
}
/** Text zur Frist. */
export function goalDueLabel(g, today = todayKey()) {
  const x = normGoal(g);
  if (!x.due) return "";
  const d = diffDays(today, x.due);
  if (x.done) return "geschafft 🎉";
  if (d < 0) return `Frist vorbei (${-d} Tage)`;
  if (d === 0) return "Frist heute";
  return d === 1 ? "noch 1 Tag" : `noch ${d} Tage`;
}
export function sortGoals(goals) {
  return goals.map(normGoal).filter((g) => g.id && g.title)
    .sort((a, b) => (a.done - b.done) || ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0) || a.title.localeCompare(b.title, "de"));
}
