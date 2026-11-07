// Update 10 – 📊 Vergleichsmodus (Übersicht): reine Logik ohne DOM (Node-testbar, test/compare-core.test.mjs).
// Diese Woche ↔ letzte Woche, dieser Monat ↔ letzter Monat: Arbeitsstunden, Soll/Ist, Überstunden, Aufgaben erledigt/geplant,
// Einnahmen/Ausgaben (nur ohne Geld-Sperre!) und Freizeit/Sport. Gleiche Regeln wie das Überstundenkonto (js/worktime-core.js):
// Gutschrift je Tag, Soll nur für vergangene Tage ab Kontobeginn (heute zählt nur die Gutschrift).
import { creditsByDay, balanceStartKey } from "./worktime-core.js";
import { dayKey, dailyTargetMin } from "./util.js";

const pad = (n) => String(n).padStart(2, "0");
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const fmtD = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Zeiträume: { cur: { from, to, label, fromK, toK }, prev: … } – to exklusiv (Mitternacht danach). */
export function periods(kind, now = Date.now()) {
  const d = new Date(now);
  let a, b, pa, pb, lc, lp;
  if (kind === "month") {
    a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    pa = new Date(d.getFullYear(), d.getMonth() - 1, 1); pb = a;
    lc = `${MONTHS[a.getMonth()]}`; lp = `${MONTHS[pa.getMonth()]}`;
  } else {
    a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)); b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7);
    pa = new Date(a.getFullYear(), a.getMonth(), a.getDate() - 7); pb = a;
    lc = `Diese Woche (${fmtD(a)}–${fmtD(new Date(b - 1))})`; lp = `Letzte Woche (${fmtD(pa)}–${fmtD(new Date(pb - 1))})`;
  }
  const mk = (x, y, label) => ({ from: x.getTime(), to: y.getTime(), label, fromK: dayKey(x), toK: dayKey(new Date(y.getTime() - 1)) });
  return { kind: kind === "month" ? "month" : "week", cur: mk(a, b, lc), prev: mk(pa, pb, lp) };
}

function eachDay(fromTs, toTs, fn) {
  const d = new Date(fromTs);
  for (let i = 0; i < 400 && d.getTime() < toTs; i++) { fn(dayKey(d), d.getTime()); d.setDate(d.getDate() + 1); }
}

/** Kennzahlen eines Zeitraums. */
export function measure(input, p, now = Date.now()) {
  const todayK = dayKey(now);
  const credits = input.credits || creditsByDay(input.entries || [], input.running || null, input.runningNetMin || 0);
  let ist = 0, soll = 0;
  eachDay(p.from, p.to, (k, ts) => {
    if (k > todayK) return;
    ist += credits.get(k) || 0;
    if (k < todayK && (!input.startK || k >= input.startK)) soll += dailyTargetMin(ts, input.settings || {}); // vor Kontobeginn kein Soll
  });
  let done = 0, planned = 0;
  for (const t of input.todos || []) {
    if (!t || t.kind !== "todo") continue;
    if (RE_KEY.test(String(t.date || "")) && t.date >= p.fromK && t.date <= p.toK) planned++;
    const da = Number(t.doneAt);
    if (t.done && Number.isFinite(da) && da >= p.from && da < p.to) done++;
  }
  let income = null, expense = null;
  if (!input.moneyLocked && Array.isArray(input.money)) {
    income = 0; expense = 0;
    for (const x of input.money) {
      if (!x || !RE_KEY.test(String(x.date || "")) || x.date < p.fromK || x.date > p.toK) continue;
      const a = Math.abs(Number(x.amount) || 0);
      if (x.type === "in") income += a; else expense += a;
    }
    income = Math.round(income * 100) / 100; expense = Math.round(expense * 100) / 100;
  }
  let sport = 0, zuhause = 0;
  for (const f of input.freizeit || []) {
    const st = Number(f && f.start);
    if (!Number.isFinite(st)) continue;
    const en = Number.isFinite(Number(f.end)) && Number(f.end) > st ? Number(f.end) : (f.end == null ? Math.min(now, st + 12 * 3600e3) : st);
    const a = Math.max(st, p.from), b = Math.min(en, p.to);
    if (b <= a) continue;
    const min = (b - a) / 60000;
    if (f.cat === "sport") sport += min; else zuhause += min;
  }
  const r = Math.round;
  return { ist: r(ist), soll: r(soll), over: r(ist - soll), done, planned, income, expense, sport: r(sport), zuhause: r(zuhause) };
}

/** Kennzahlen-Zeilen mit Delta (Pfeil + Stimmung). good: "up" = mehr ist gut, "down" = weniger ist gut, null = neutral */
export const ROWS = Object.freeze([
  { id: "ist", e: "⏱️", t: "Arbeitsstunden", unit: "min", good: null },
  { id: "soll", e: "🎯", t: "Soll", unit: "min", good: null },
  { id: "over", e: "⚖️", t: "Überstunden", unit: "min", good: null, signed: true },
  { id: "done", e: "✅", t: "Aufgaben erledigt", unit: "count", good: "up" },
  { id: "planned", e: "📋", t: "Aufgaben geplant", unit: "count", good: null },
  { id: "income", e: "💰", t: "Einnahmen", unit: "eur", good: "up", money: true },
  { id: "expense", e: "💸", t: "Ausgaben", unit: "eur", good: "down", money: true },
  { id: "sport", e: "💪", t: "Sport", unit: "min", good: "up" },
  { id: "zuhause", e: "🏡", t: "Freizeit zuhause", unit: "min", good: null },
]);

/** Ganzer Vergleich. → { kind, cur, prev, rows: [{ ...ROW, cur, prev, delta, dir: "up"|"down"|"same", mood: "good"|"bad"|"neutral" }] } */
export function compare(input, kind = "week", now = Date.now()) {
  const p = periods(kind, now);
  const credits = creditsByDay(input.entries || [], input.running || null, input.runningNetMin || 0);
  const inp = { ...input, credits, startK: balanceStartKey(input.settings || {}, input.entries || [], input.running || null) };
  const a = measure(inp, p.cur, now), b = measure(inp, p.prev, now);
  const rows = [];
  for (const row of ROWS) {
    if (row.money && (input.moneyLocked || a[row.id] == null)) continue;
    const cur = a[row.id], prev = b[row.id];
    const delta = Math.round((cur - prev) * 100) / 100;
    const dir = delta > 0 ? "up" : delta < 0 ? "down" : "same";
    const mood = !row.good || dir === "same" ? "neutral" : dir === row.good ? "good" : "bad";
    rows.push({ ...row, cur, prev, delta, dir, mood });
  }
  return { kind: p.kind, cur: p.cur, prev: p.prev, rows };
}

/** Balkenlängen maßstabsgetreu (0…1) für ein Paar – gemeinsame Skala, negative Werte über den Betrag. */
export function barScale(a, b) {
  const m = Math.max(Math.abs(a) || 0, Math.abs(b) || 0);
  return m > 0 ? [Math.abs(a) / m, Math.abs(b) / m] : [0, 0];
}

/** Werte formatieren. */
export function fmt(row, v, eurFn = null) {
  if (v == null) return "–";
  if (row.unit === "count") return String(v);
  if (row.unit === "eur") return eurFn ? eurFn(v) : `${(Math.round(v * 100) / 100).toFixed(2).replace(".", ",")} €`;
  const sign = row.signed ? (v > 0 ? "+" : v < 0 ? "−" : "±") : v < 0 ? "−" : "";
  const m = Math.abs(Math.round(v));
  return `${sign}${Math.floor(m / 60)}:${pad(m % 60)} h`;
}
export function fmtDelta(row, d, eurFn = null) {
  if (!d) return "±0";
  const arrow = d > 0 ? "▲" : "▼";
  if (row.unit === "count") return `${arrow} ${Math.abs(d)}`;
  if (row.unit === "eur") return `${arrow} ${eurFn ? eurFn(Math.abs(d)) : (Math.abs(d)).toFixed(2).replace(".", ",") + " €"}`;
  const m = Math.abs(Math.round(d));
  return `${arrow} ${Math.floor(m / 60)}:${pad(m % 60)} h`;
}
