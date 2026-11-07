// Update 10 – 🏡 Haushalt: reine Logik ohne DOM (Node-testbar, test/haushalt-core.test.mjs).
// Putzplan (wiederkehrende Aufgaben) und Wartung (z. B. Rauchmelder testen, Filter wechseln) in EINER Sammlung „haushalt“:
//   { id, kind: "putz"|"wartung", title, room, unit: "d"|"w"|"m", n, last: "JJJJ-MM-TT"|null, start: "JJJJ-MM-TT",
//     notes, paused, history: [{ ts, day, note? }] (neueste hinten, max. 60) }
// Fällig = zuletzt erledigt + Intervall; noch nie erledigt → ab dem Startdatum fällig.

const pad = (n) => String(n).padStart(2, "0");
const s = (v) => (v == null ? "" : String(v).trim());
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (now = Date.now()) => keyOf(new Date(now));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const isKey = (k) => RE_KEY.test(s(k));
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export function addMonths(k, n) {
  const [y, m, d] = k.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(d, last));
  return keyOf(t);
}
export const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);

export const MAX_HISTORY = 60;
export const KINDS = [
  { id: "putz", e: "🧽", label: "Putzplan" },
  { id: "wartung", e: "🛠️", label: "Wartung" },
];
export const ROOMS = ["Küche", "Bad", "WC", "Wohnzimmer", "Schlafzimmer", "Vorzimmer", "Balkon", "Keller", "Garten", "Ganze Wohnung"];
const ROOM_E = { "küche": "🍳", bad: "🛁", wc: "🚽", wohnzimmer: "🛋️", schlafzimmer: "🛏️", vorzimmer: "🚪", balkon: "🌿", keller: "📦", garten: "🌳", "ganze wohnung": "🏠", auto: "🚗" };
export const roomEmoji = (room) => ROOM_E[s(room).toLowerCase()] || "🏡";

/** Intervall-Auswahl im Formular: [id, Einheit, n, Text] – „tage“/„monate“ mit eigener Zahl. */
export const INTERVALS = [
  ["taeglich", "d", 1, "täglich"],
  ["woechentlich", "w", 1, "wöchentlich"],
  ["tage", "d", 3, "alle N Tage"],
  ["monatlich", "m", 1, "monatlich"],
  ["monate", "m", 3, "alle N Monate"],
];

/** Vorschläge zum schnellen Anlegen (keine Daten – nur Vorlagen fürs Formular). */
export const PRESETS = {
  putz: [
    { title: "Staubsaugen", room: "Ganze Wohnung", unit: "w", n: 1, e: "🧹" },
    { title: "Bad putzen", room: "Bad", unit: "w", n: 1, e: "🛁" },
    { title: "Müll rausbringen", room: "Küche", unit: "d", n: 3, e: "🗑️" },
    { title: "Bettwäsche wechseln", room: "Schlafzimmer", unit: "d", n: 14, e: "🛏️" },
    { title: "Pflanzen gießen", room: "Wohnzimmer", unit: "d", n: 4, e: "🪴" },
    { title: "Fenster putzen", room: "Ganze Wohnung", unit: "m", n: 3, e: "🪟" },
  ],
  wartung: [
    { title: "Rauchmelder testen", room: "Ganze Wohnung", unit: "m", n: 1, e: "🚨" },
    { title: "Dunstabzug-Filter wechseln", room: "Küche", unit: "m", n: 3, e: "🍳" },
    { title: "Kaffeemaschine entkalken", room: "Küche", unit: "m", n: 1, e: "☕" },
    { title: "Waschmaschine reinigen", room: "Bad", unit: "m", n: 2, e: "🧺" },
    { title: "Heizkörper entlüften", room: "Ganze Wohnung", unit: "m", n: 12, e: "🔥" },
    { title: "Kühlschrank abtauen", room: "Küche", unit: "m", n: 6, e: "🧊" },
  ],
};

function clampN(unit, n) {
  const v = Math.round(Number(n));
  const max = unit === "m" ? 36 : unit === "w" ? 52 : 365;
  return Number.isFinite(v) && v >= 1 ? Math.min(v, max) : 1;
}

/** Aufgabe mit Standardwerten. */
export function normTask(x = {}, now = Date.now()) {
  const unit = ["d", "w", "m"].includes(x.unit) ? x.unit : "w";
  const hist = Array.isArray(x.history) ? x.history.filter((h) => h && isKey(h.day)).map((h) => ({ ts: Number(h.ts) || 0, day: h.day, ...(s(h.note) ? { note: s(h.note).slice(0, 200) } : {}) })) : [];
  return {
    ...x,
    id: s(x.id),
    kind: x.kind === "wartung" ? "wartung" : "putz",
    title: s(x.title).slice(0, 80),
    room: s(x.room).slice(0, 40),
    unit, n: clampN(unit, x.n),
    last: isKey(x.last) ? x.last : null,
    start: isKey(x.start) ? x.start : todayKey(now),
    notes: s(x.notes).slice(0, 1000),
    paused: !!x.paused,
    history: hist.slice(-MAX_HISTORY),
  };
}

export function intervalLabel(unit, n) {
  n = clampN(unit, n);
  if (unit === "d") return n === 1 ? "täglich" : n === 7 ? "wöchentlich" : n === 14 ? "alle 2 Wochen" : `alle ${n} Tage`;
  if (unit === "w") return n === 1 ? "wöchentlich" : `alle ${n} Wochen`;
  return n === 1 ? "monatlich" : n === 12 ? "jährlich" : `alle ${n} Monate`;
}
/** Intervall-Auswahl (id aus INTERVALS) für eine Aufgabe. */
export function intervalChoice(unit, n) {
  if (unit === "d" && n === 1) return "taeglich";
  if ((unit === "w" && n === 1) || (unit === "d" && n === 7)) return "woechentlich";
  if (unit === "m" && n === 1) return "monatlich";
  return unit === "m" ? "monate" : unit === "w" ? "tage" : "tage";
}
/** Wochen in Tage umrechnen, wenn „alle N Tage“ gewählt ist. */
export function toDays(unit, n) { return unit === "w" ? clampN("w", n) * 7 : clampN(unit, n); }

export function addInterval(k, unit, n) {
  n = clampN(unit, n);
  if (unit === "m") return addMonths(k, n);
  return addDays(k, unit === "w" ? n * 7 : n);
}

/** Nächster Termin. */
export function nextDue(t) {
  const x = normTask(t);
  return x.last ? addInterval(x.last, x.unit, x.n) : x.start;
}

/** Wie lange „bald“ gilt: Wartung 7 Tage vorher, Putzplan nur „morgen“. */
const soonDays = (x) => (x.kind === "wartung" ? 7 : 1);

/**
 * Status → { state: "ueber"|"heute"|"bald"|"ok"|"pause", due, days, label, e }
 * days = Tage bis fällig (negativ = überfällig)
 */
export function taskStatus(t, today = todayKey()) {
  const x = normTask(t);
  const due = nextDue(x);
  const days = diffDays(today, due);
  if (x.paused) return { state: "pause", due, days, label: "pausiert", e: "⏸️" };
  if (days < 0) return { state: "ueber", due, days, label: days === -1 ? "seit gestern fällig" : `seit ${-days} Tagen fällig`, e: "⏰" };
  if (days === 0) return { state: "heute", due, days, label: "heute fällig", e: "📌" };
  if (days <= soonDays(x)) return { state: "bald", due, days, label: days === 1 ? "morgen fällig" : `in ${days} Tagen fällig`, e: "🔜" };
  return { state: "ok", due, days, label: days < 7 ? `in ${days} Tagen` : `am ${fmtShort(due)}`, e: "✅" };
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function fmtShort(k) { const d = dateOf(k); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; }
export function fmtDay(k) { const [y, m, d] = k.split("-"); return `${d}.${m}.${y}`; }

/** „zuletzt erledigt“ als Text. */
export function lastLabel(t, today = todayKey()) {
  const x = normTask(t);
  if (!x.last) return "noch nie erledigt";
  const d = diffDays(x.last, today);
  if (d <= 0) return "heute erledigt";
  if (d === 1) return "gestern erledigt";
  return d < 14 ? `vor ${d} Tagen erledigt` : `zuletzt am ${fmtDay(x.last)}`;
}

/** Abhaken: neue Fassung (last = Tag, Verlauf ergänzt). */
export function tick(t, ts = Date.now(), note = "") {
  const x = normTask(t, ts);
  const day = todayKey(ts);
  const h = { ts, day, ...(s(note) ? { note: s(note).slice(0, 200) } : {}) };
  return { ...x, last: !x.last || day >= x.last ? day : x.last, history: [...x.history, h].slice(-MAX_HISTORY) };
}

/** Letztes Abhaken zurücknehmen. */
export function untick(t) {
  const x = normTask(t);
  if (!x.history.length) return { ...x, last: null };
  const hist = x.history.slice(0, -1);
  const prev = hist.length ? hist.map((h) => h.day).sort().pop() : null;
  return { ...x, history: hist, last: prev };
}

const RANK = { ueber: 0, heute: 1, bald: 2, ok: 3, pause: 4 };
/** Sortiert nach Dringlichkeit, dann Termin, dann Titel. */
export function sortTasks(tasks, today = todayKey()) {
  return tasks.map((t) => ({ t: normTask(t), st: taskStatus(t, today) }))
    .sort((a, b) => RANK[a.st.state] - RANK[b.st.state] || (a.st.due < b.st.due ? -1 : a.st.due > b.st.due ? 1 : 0) || a.t.title.localeCompare(b.t.title, "de"))
    .map((x) => x.t);
}

export function counts(tasks, today = todayKey()) {
  const c = { all: 0, faellig: 0, putz: 0, wartung: 0 };
  for (const t of tasks) {
    const x = normTask(t);
    if (!x.id || !x.title) continue;
    c.all++; c[x.kind]++;
    const st = taskStatus(x, today).state;
    if (st === "ueber" || st === "heute") c.faellig++;
  }
  return c;
}

export const taskHash = () => "#alltag/haushalt";

/**
 * Für Benachrichtigungen/Dashboard: überfällige + heute fällige Aufgaben, Wartung auch 7 Tage vorher.
 * → [{ id, kind, title, room, due, state, days, text, e, hash }]
 */
export function dueChores(tasks, now = Date.now()) {
  const today = todayKey(now);
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const x = normTask(t, now);
    if (!x.id || !x.title || x.paused) continue;
    const st = taskStatus(x, today);
    if (st.state !== "ueber" && st.state !== "heute" && !(st.state === "bald" && x.kind === "wartung")) continue;
    const e = x.kind === "wartung" ? "🛠️" : roomEmoji(x.room);
    out.push({ id: x.id, kind: x.kind, title: x.title, room: x.room, due: st.due, state: st.state, days: st.days,
      text: `${e} ${x.title}${x.room ? ` (${x.room})` : ""} – ${st.label}`, e, hash: taskHash() });
  }
  return out.sort((a, b) => a.days - b.days || a.title.localeCompare(b.title, "de"));
}

/** Verlauf über alle Aufgaben (neueste zuerst). */
export function recentLog(tasks, limit = 40) {
  const out = [];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const x = normTask(t);
    if (!x.id) continue;
    for (const h of x.history) out.push({ ...h, taskId: x.id, title: x.title, room: x.room, kind: x.kind });
  }
  return out.sort((a, b) => b.ts - a.ts || (a.day < b.day ? 1 : -1)).slice(0, limit);
}

/** Text für die globale Suche. */
export function searchText(t) {
  const x = normTask(t);
  return [x.title, x.room, x.notes, x.kind === "wartung" ? "Wartung" : "Putzplan Haushalt putzen"].join(" ");
}
