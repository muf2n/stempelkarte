// Update 12 – 📊 Life Analytics & Digital Twin – reine Logik (kein DOM). Wird auch von der Spielwelt (spiel-core.js) genutzt.
// Aus den vorhandenen Daten wird eine Liste „Aktivitäten“ gebaut – nichts davon wird extra gespeichert:
//   { day: "YYYY-MM-DD", area, kind, n (Anzahl), min (Minuten) }
// Bereiche: arbeit, lernen, sport, haushalt, freizeit, orga, reisen. (Finanzen nur als Kennzahl, nie als Aktivität.)
// Eingabe (alles optional): { entries, todos, freizeit, haushalt, habits, goals, learn (learn_progress-Dokumente), lists (freizeit_listen),
//   trips (travel_trips), journal (travel_journal), plan (essensplan), money (money_tx), moneyLocked, now }

import { netMin } from "./util.js";

const pad = (n) => String(n).padStart(2, "0");
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const keyTs = (ts) => keyOf(new Date(ts));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }

export const AREAS = [
  { id: "arbeit", e: "🛠️", t: "Arbeit", color: "#2563eb", target: 18 },
  { id: "lernen", e: "📚", t: "Lernen", color: "#7c3aed", target: 12 },
  { id: "sport", e: "💪", t: "Sport & Bewegung", color: "#16a34a", target: 8 },
  { id: "haushalt", e: "🏡", t: "Haushalt", color: "#0f766e", target: 8 },
  { id: "freizeit", e: "🎬", t: "Freizeit & Hobbys", color: "#db2777", target: 8 },
  { id: "orga", e: "✅", t: "Organisation", color: "#ea580c", target: 12 },
  { id: "reisen", e: "✈️", t: "Reisen & Erlebnisse", color: "#0891b2", target: 2 },
];
export const areaBy = (id) => AREAS.find((a) => a.id === id) || null;

/** Alle Aktivitäten aus den App-Daten. */
export function activities(inp = {}) {
  const out = [];
  const push = (day, area, kind, n = 1, min = 0) => { if (RE_KEY.test(String(day || ""))) out.push({ day, area, kind, n, min }); };
  const workDays = new Map();
  for (const e of inp.entries || []) {
    if (!e || !Number.isFinite(Number(e.start)) || !Number.isFinite(Number(e.end))) continue;
    if (e.kind && e.kind !== "work") continue;
    const k = keyTs(Number(e.start));
    workDays.set(k, (workDays.get(k) || 0) + netMin(e));
  }
  for (const [k, min] of workDays) if (min > 0) push(k, "arbeit", "arbeitstag", 1, Math.round(min));
  for (const t of inp.todos || []) if (t && t.done && Number(t.doneAt) > 0 && (t.kind || "todo") === "todo") push(keyTs(Number(t.doneAt)), "orga", "aufgabe");
  for (const f of inp.freizeit || []) {
    if (!f || !Number(f.start) || !Number(f.end) || Number(f.end) <= Number(f.start)) continue;
    push(keyTs(Number(f.start)), f.cat === "sport" ? "sport" : "haushalt", f.cat === "sport" ? "sport" : "zuhause", 1, Math.round((Number(f.end) - Number(f.start)) / 60000));
  }
  for (const h of inp.haushalt || []) for (const x of (h && Array.isArray(h.history) ? h.history : [])) push(x.day, "haushalt", "hausarbeit");
  for (const h of inp.habits || []) if (h && h.log && typeof h.log === "object") for (const [k, v] of Object.entries(h.log)) if (Number(v) > 0) push(k, /sport|lauf|lauf|gym|fitness|rad|schwimm|yoga|schritt/i.test(String(h.title || "")) ? "sport" : "orga", "gewohnheit", Number(v));
  for (const g of inp.goals || []) {
    for (const m of (g && Array.isArray(g.milestones) ? g.milestones : [])) if (m && m.done && Number(m.doneAt) > 0) push(keyTs(Number(m.doneAt)), "orga", "meilenstein");
    if (g && g.done && Number(g.doneAt || g.updated) > 0) push(keyTs(Number(g.doneAt || g.updated)), "orga", "ziel");
  }
  for (const d of inp.learn || []) if (d && d.id !== "me" && d.xp && typeof d.xp === "object") for (const [k, v] of Object.entries(d.xp)) if (Number(v) > 0) push(k, "lernen", "lern-xp", Number(v), Math.round(Number(v) / 2));
  for (const l of inp.lists || []) if (l && l.status === "fertig" && Number(l.doneAt) > 0) push(keyTs(Number(l.doneAt)), l.type === "ausflug" ? "reisen" : "freizeit", "liste");
  for (const t of inp.trips || []) {
    if (!t || !RE_KEY.test(String(t.from || ""))) continue;
    const to = RE_KEY.test(String(t.to || "")) ? t.to : t.from;
    for (let k = t.from, i = 0; k <= to && i < 60; k = addDays(k, 1), i++) push(k, "reisen", "reisetag");
  }
  for (const j of inp.journal || []) if (j && RE_KEY.test(String(j.day || ""))) push(j.day, "reisen", "tagebuch");
  for (const p of inp.plan || []) if (p && RE_KEY.test(String(p.id || "")) && p.meals) for (const m of Object.values(p.meals)) if (m && m.recipeId) push(p.id, "haushalt", "gekocht");
  return out;
}

/** Zeitraum: kind week|month|year, offset 0 = aktuell, −1 = davor … → { from, to (inkl.), label } */
export function range(kind, todayKey, offset = 0) {
  const d = dateOf(todayKey);
  if (kind === "year") { const y = d.getFullYear() + offset; return { from: `${y}-01-01`, to: `${y}-12-31`, label: String(y) }; }
  if (kind === "month") {
    const a = new Date(d.getFullYear(), d.getMonth() + offset, 1, 12), b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 12);
    return { from: keyOf(a), to: keyOf(b), label: a.toLocaleDateString("de-AT", { month: "long", year: "numeric" }) };
  }
  const mon = addDays(todayKey, -((d.getDay() + 6) % 7) + 7 * offset);
  const sun = addDays(mon, 6);
  return { from: mon, to: sun, label: `${mon.slice(8)}.${mon.slice(5, 7)}. – ${sun.slice(8)}.${sun.slice(5, 7)}.` };
}

/** Kennzahlen je Bereich in [from, to]. → { [area]: { min, n, days } } */
export function byArea(acts, from, to) {
  const out = Object.fromEntries(AREAS.map((a) => [a.id, { min: 0, n: 0, days: 0 }]));
  const seen = new Set();
  for (const x of acts) {
    if (x.day < from || x.day > to || !out[x.area]) continue;
    out[x.area].min += x.min || 0;
    out[x.area].n += x.n || 1;
    const k = x.area + x.day;
    if (!seen.has(k)) { seen.add(k); out[x.area].days++; }
  }
  return out;
}

/** Vergleich zweier Zeiträume (aktuell vs. vorher) je Bereich. */
export function compareAreas(acts, cur, prev) {
  const a = byArea(acts, cur.from, cur.to), b = byArea(acts, prev.from, prev.to);
  return AREAS.map((ar) => ({ ...ar, cur: a[ar.id], prev: b[ar.id], delta: a[ar.id].days - b[ar.id].days }));
}

/** Digital Twin: Wert 0–100 je Bereich aus den letzten 28 Tagen (aktive Tage im Verhältnis zum Richtwert). */
export function twin(acts, todayKey, enabled = null) {
  const from = addDays(todayKey, -27);
  const st = byArea(acts, from, todayKey);
  const prevSt = byArea(acts, addDays(from, -28), addDays(from, -1));
  return AREAS.filter((a) => !enabled || enabled.includes(a.id)).map((a) => {
    const score = Math.min(100, Math.round((st[a.id].days / a.target) * 100));
    const before = Math.min(100, Math.round((prevSt[a.id].days / a.target) * 100));
    return { ...a, score, before, trend: score - before, days: st[a.id].days };
  });
}

/** Finanzen (nur ohne Geld-Sperre): Einnahmen, Ausgaben, Sparquote im Zeitraum. */
export function money(inp, from, to) {
  if (inp.moneyLocked || !Array.isArray(inp.money)) return null;
  let inc = 0, exp = 0;
  for (const t of inp.money) {
    if (!t || !RE_KEY.test(String(t.date || "")) || t.date < from || t.date > to) continue;
    const a = Math.abs(Number(t.amount) || 0);
    if (t.type === "in") inc += a; else exp += a;
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { income: r(inc), expense: r(exp), saved: r(inc - exp), rate: inc > 0 ? Math.round(((inc - exp) / inc) * 100) : null };
}

/** Verlauf pro Monat (12 Monate bis inkl. aktuellem) je Bereich: aktive Tage. */
export function monthly(acts, todayKey, months = 12) {
  const d = dateOf(todayKey);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const a = new Date(d.getFullYear(), d.getMonth() - i, 1, 12), b = new Date(a.getFullYear(), a.getMonth() + 1, 0, 12);
    const st = byArea(acts, keyOf(a), keyOf(b));
    out.push({ month: keyOf(a).slice(0, 7), label: a.toLocaleDateString("de-AT", { month: "short" }), areas: Object.fromEntries(AREAS.map((x) => [x.id, st[x.id].days])) });
  }
  return out;
}

/** Jahresrückblick. */
export function yearReview(inp, year) {
  const acts = activities(inp);
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const st = byArea(acts, from, to);
  const inYear = (k) => k >= from && k <= to;
  const workMin = st.arbeit.min;
  const busiest = Object.entries(acts.filter((x) => inYear(x.day)).reduce((m, x) => { m[x.day] = (m[x.day] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1])[0];
  const months = {};
  for (const x of acts) if (inYear(x.day)) months[x.day.slice(0, 7)] = (months[x.day.slice(0, 7)] || 0) + 1;
  const topMonth = Object.entries(months).sort((a, b) => b[1] - a[1])[0];
  const lists = (inp.lists || []).filter((l) => l && l.status === "fertig" && Number(l.doneAt) > 0 && inYear(keyTs(Number(l.doneAt))));
  const count = (type) => lists.filter((l) => l.type === type).length;
  return {
    year, workHours: Math.round(workMin / 60), workDays: st.arbeit.days, learnXp: st.lernen.n, learnDays: st.lernen.days,
    sportHours: Math.round(st.sport.min / 60), sportDays: st.sport.days, chores: acts.filter((x) => inYear(x.day) && x.kind === "hausarbeit").length,
    todos: acts.filter((x) => inYear(x.day) && x.kind === "aufgabe").length, travelDays: st.reisen.days,
    series: count("serie"), films: count("film"), books: count("buch"), games: count("spiel"),
    busiestDay: busiest ? busiest[0] : null, topMonth: topMonth ? topMonth[0] : null, money: money(inp, from, to),
  };
}

/** CSV-Export (Semikolon, für Excel in Österreich). */
export function csv(acts) {
  const rows = [["Datum", "Bereich", "Art", "Anzahl", "Minuten"]];
  for (const x of [...acts].sort((a, b) => a.day.localeCompare(b.day))) rows.push([x.day, (areaBy(x.area) || {}).t || x.area, x.kind, x.n, x.min]);
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
}

export const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`; };
