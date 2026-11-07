// Update 10 E – 💶 Finanz-Planung im Geld-Bereich: „Was bleibt am Monatsende?“, Jahreskosten aller Abos & Verträge,
// „Wie wirkt sich eine Ausgabe von X € aus?“ (nutzt affordCheck aus money-core) und die 🎁 Wunschliste.
// Reine Logik ohne DOM (Node-testbar). Wunschliste: Sammlung „money_wishes“ { name, price, prio 1–3, saved, goalId, plan (JJJJ-MM), url, note, done }.
import { monthOf, shiftMonth, monthTx, round2, monthEndKey, daysBetween, upcoming, monthlyCost, yearlyCost, affordCheck, isKey } from "./money-core.js";
import { isActive } from "./subs-core.js";
import { normContract, contractMonthly, contractYearly, isRunning, kindById } from "./vertraege-core.js";

const s = (v) => String(v ?? "").trim();

/** Durchschnittliches Einkommen der letzten n vollen Monate (nur Monate mit Einnahmen). */
export function avgIncome(txs, mk, n = 3) {
  const vals = [];
  for (let i = 1; i <= n; i++) {
    const m = shiftMonth(mk, -i);
    const sum = monthTx(txs, m).filter((t) => t.type === "in").reduce((a, t) => a + (Number(t.amount) || 0), 0);
    if (sum > 0) vals.push(sum);
  }
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

/**
 * „Was bleibt am Monatsende?“
 * input: { today, txs, subs, contracts, wishes, extra (geplante Ausgabe), income (feste Angabe, optional) }
 * → { income, incomeSoFar, incomeAvg, incomeSource, spent, subsLeft, subsList, contracts, contractList, planned, plannedList, extra, rest, daysLeft, lines }
 */
export function monthEnd(input = {}) {
  const today = input.today;
  const mk = monthOf(today);
  const txs = input.txs || [];
  const mt = monthTx(txs, mk);
  const incomeSoFar = round2(mt.filter((t) => t.type === "in").reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const incomeAvg = avgIncome(txs, mk);
  let income = incomeSoFar, incomeSource = "bisher";
  const fixed = Number(input.income);
  if (Number.isFinite(fixed) && fixed > 0) { income = round2(Math.max(fixed, incomeSoFar)); incomeSource = "angegeben"; }
  else if (incomeAvg > incomeSoFar) { income = incomeAvg; incomeSource = "schnitt"; }
  const spent = round2(mt.filter((t) => t.type !== "in").reduce((a, t) => a + (Number(t.amount) || 0), 0));
  const end = monthEndKey(today);
  const ups = upcoming((input.subs || []).filter((x) => x && isActive(x, today)), today, daysBetween(today, end)).filter((u) => u.date <= end);
  // schon heute gebuchte Abo-Zahlungen nicht doppelt zählen
  const booked = new Set(mt.map((t) => t.id));
  const subsList = ups.filter((u) => !booked.has(`sub_${u.sub.id}_${u.date.replace(/-/g, "")}`)).map((u) => ({ name: s(u.sub.name) || "Abo", date: u.date, amount: round2(u.sub.amount) }));
  const subsLeft = round2(subsList.reduce((a, x) => a + x.amount, 0));
  const contractList = (input.contracts || []).map(normContract).filter((c) => c.id && !c.subId && isRunning(c, today))
    .map((c) => ({ name: c.name, e: kindById(c.kind).e, amount: contractMonthly(c, today) })).filter((x) => x.amount > 0);
  const contracts = round2(contractList.reduce((a, x) => a + x.amount, 0));
  const plannedList = (input.wishes || []).map((w) => normWish(w)).filter((w) => w.id && !w.done && w.plan === mk)
    .map((w) => ({ name: w.name, amount: round2(Math.max(0, w.price - w.saved)) })).filter((x) => x.amount > 0);
  const planned = round2(plannedList.reduce((a, x) => a + x.amount, 0));
  const extra = Math.max(0, round2(input.extra));
  const rest = round2(income - spent - subsLeft - contracts - planned - extra);
  return { mk, income, incomeSoFar, incomeAvg, incomeSource, spent, subsLeft, subsList, contracts, contractList, planned, plannedList, extra, rest,
    daysLeft: daysBetween(today, end) + 1 };
}

/** Ampel für den Rest: "gut" (≥ 10 % vom Einkommen), "knapp" (≥ 0), "minus". */
export function restLevel(r) {
  if (r.rest < 0) return "minus";
  if (r.income > 0 && r.rest < r.income * 0.1) return "knapp";
  return "gut";
}

/** Jahreskosten aller laufenden Abos und Verträge (Verträge mit Abo-Verknüpfung zählen beim Abo). */
export function yearlyFixed({ subs = [], contracts = [], today } = {}) {
  const rows = [];
  for (const x of subs || []) {
    if (!x || !s(x.name) || !isActive(x, today)) continue;
    rows.push({ id: "s_" + x.id, src: "abo", e: "🔁", name: s(x.name), month: monthlyCost(x), year: yearlyCost(x) });
  }
  for (const raw of contracts || []) {
    const c = normContract(raw);
    if (!c.id || !c.name || c.subId || !isRunning(c, today)) continue;
    rows.push({ id: "c_" + c.id, src: "vertrag", e: kindById(c.kind).e, name: c.name, month: contractMonthly(c, today), year: contractYearly(c, today) });
  }
  rows.sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, "de"));
  const year = round2(rows.reduce((a, r) => a + r.year, 0));
  return { rows, year, month: round2(year / 12), abos: round2(rows.filter((r) => r.src === "abo").reduce((a, r) => a + r.year, 0)), vertraege: round2(rows.filter((r) => r.src === "vertrag").reduce((a, r) => a + r.year, 0)) };
}

/**
 * „Wie wirkt sich eine Ausgabe von X € aus?“ – Monatsrest vorher/nachher + das bekannte „Kann ich mir das leisten?“.
 * input wie monthEnd + affordCheck-Felder { amount, cat, note, budgets, cats, rules, goals, bank }
 */
export function simulate(input = {}) {
  const amount = Math.max(0, round2(input.amount));
  const before = monthEnd({ ...input, extra: 0 });
  const after = monthEnd({ ...input, extra: amount });
  const afford = affordCheck({ ...input, amount, subs: (input.subs || []).filter((x) => x && isActive(x, input.today)) });
  // wie viele Stunden Arbeit? (nur wenn ein Stundenlohn bekannt ist)
  const wage = Number(input.hourly);
  const hours = wage > 0 ? Math.round((amount / wage) * 10) / 10 : null;
  return { amount, before, after, afford, hours, level: restLevel(after) };
}

/* ---------- 🎁 Wunschliste ---------- */

export const PRIOS = [{ id: 1, e: "🔥", label: "Hoch" }, { id: 2, e: "⭐", label: "Mittel" }, { id: 3, e: "💭", label: "Irgendwann" }];
export const prioById = (id) => PRIOS.find((p) => p.id === Number(id)) || PRIOS[1];

export function normWish(x, goals = null) {
  const w = x && typeof x === "object" ? x : {};
  const goal = goals && w.goalId ? (goals || []).find((g) => g && g.id === w.goalId) : null;
  const saved = goal ? Number(goal.saved) || 0 : Number(w.saved) || 0;
  return {
    id: s(w.id), name: s(w.name).slice(0, 120), price: Math.max(0, round2(w.price)), prio: prioById(w.prio).id,
    saved: Math.max(0, round2(saved)), goalId: s(w.goalId), goalName: goal ? s(goal.name) : "",
    plan: /^\d{4}-\d{2}$/.test(String(w.plan || "")) ? w.plan : "", url: /^https?:\/\//i.test(s(w.url)) ? s(w.url).slice(0, 500) : "",
    note: s(w.note).slice(0, 1000), done: !!w.done, created: Number(w.created) || 0,
  };
}
export function wishProgress(w) {
  const left = round2(Math.max(0, w.price - w.saved));
  const pct = w.price > 0 ? Math.min(100, Math.round((w.saved / w.price) * 100)) : 0;
  return { left, pct, ready: w.price > 0 && left <= 0 };
}
/** Sortiert: offen vor erledigt, dann Priorität, dann am weitesten angespart. */
export function sortWishes(list, goals = []) {
  return (list || []).map((x) => normWish(x, goals)).filter((w) => w.id && w.name)
    .sort((a, b) => (a.done - b.done) || (a.prio - b.prio) || (wishProgress(b).pct - wishProgress(a).pct) || a.name.localeCompare(b.name, "de"));
}
/** Sparziel-Vorschlag aus einem Wunsch (für money_goals). */
export function goalFromWish(w) {
  return { name: w.name, target: w.price, saved: w.saved, emoji: "🎁", date: "" };
}
export const isMonth = (m) => /^\d{4}-\d{2}$/.test(String(m || ""));
export { isKey };
