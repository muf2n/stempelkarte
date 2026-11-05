// node --test test/budget.test.mjs
// Update 9 – Budget-Warnungen: Monatssummen, Schwellen 80/100/über, Tempo, Zustand pro Monat,
// Push-Entscheidung (tools/reminders/decide.mjs) und „Kann ich mir das leisten?“ (money-core.js).
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/alltag/money-core.js";
import { decideBudget, applyBudgetAlerts, viennaToTs, BUDGET_QUIET } from "../tools/reminders/decide.mjs";

const tx = (id, date, amount, category, extra = {}) => ({ id, date, amount, type: "out", category, note: id, created: Date.parse(date), ...extra });
const sp = (x) => String(x).replace(/\u00a0/g, " "); // eur() nutzt geschütztes Leerzeichen vor €
const BUD = [{ id: "essen", amount: 200 }, { id: "total", amount: 600 }];

test("budgetSpend/budgetStatus: nur Ausgaben des Monats, Sparen/Umbuchung nicht im Gesamt", () => {
  const txs = [
    tx("a", "2026-11-02", 100, "essen"), tx("b", "2026-11-10", 62, "essen"),
    tx("c", "2026-10-30", 500, "essen"), // Vormonat
    { id: "d", date: "2026-11-05", amount: 900, type: "in", category: "einkommen" },
    tx("e", "2026-11-06", 150, "sparen"), tx("f", "2026-11-07", 40, "freizeit", { goalId: "g1" }),
    tx("g", "2026-11-08", 30, "freizeit"),
  ];
  const sp = M.budgetSpend(txs, "2026-11");
  assert.equal(sp.total, 192);
  assert.equal(sp.byCat.get("essen"), 162);
  assert.equal(sp.lastId.get("essen"), "b");
  const rows = M.budgetStatus(txs, BUD, "2026-11");
  assert.deepEqual(rows.map((r) => [r.id, r.spent, r.left, r.level]), [["total", 192, 408, "ok"], ["essen", 162, 38, "warn"]]);
  assert.equal(rows[1].name, "Essen & Einkauf");
});

test("Texte: 80 %, 100 %, überschritten, Tempo", () => {
  const today = "2026-11-19"; // noch 12 Tage
  const row = M.budgetStatus([tx("a", "2026-11-02", 162, "essen")], [{ id: "essen", amount: 200 }], "2026-11")[0];
  assert.equal(sp(M.budgetAlertText({ ...row, name: "Essen" }, "80", today)), "⚠️ Budget Essen fast aufgebraucht: 162 € von 200 € – noch 38 € bis Monatsende (12 Tage)");
  assert.equal(sp(M.budgetAlertText({ ...row, name: "Essen" }, "100", today)), "🛑 Budget Essen erreicht – STOPP, nichts mehr für Essen ausgeben diesen Monat");
  assert.equal(sp(M.budgetAlertText({ ...row, name: "Essen", spent: 224, left: -24 }, "over", today)), "🛑 Budget Essen überschritten um 24 €");
  assert.equal(M.daysLeftInMonth("2026-11-30"), 1);
  assert.equal(M.daysLeftInMonth("2026-02-01"), 28);
  // Tempo: 70 € in 7 Tagen bei 200 € → 10 €/Tag → am 20. weg
  assert.equal(M.paceOverDay(70, 200, "2026-11-07"), 20);
  assert.equal(M.paceOverDay(20, 200, "2026-11-07"), null);
  assert.match(sp(M.budgetAlertText({ id: "essen", name: "Essen", spent: 70, limit: 200 }, "pace", "2026-11-07")), /Bei diesem Tempo bist du am 20\. über dem Budget/);
});

test("budgetAlerts: jede Schwelle einmal pro Monat, danach jede neue Ausgabe „überschritten“", () => {
  let state = null;
  const run = (txs, today) => {
    const list = M.budgetAlerts(M.budgetStatus(txs, [{ id: "essen", amount: 200 }], M.monthOf(today)), state, today, {});
    state = M.applyAlerts(state, today, list);
    return list.map((a) => a.kind);
  };
  const txs = [tx("a", "2026-11-17", 120, "essen")];
  assert.deepEqual(run(txs, "2026-11-17"), []); // 60 %, nach Monatsmitte kein Tempo
  txs.push(tx("b", "2026-11-18", 42, "essen"));
  assert.deepEqual(run(txs, "2026-11-18"), ["80"]);
  assert.deepEqual(run(txs, "2026-11-18"), [], "nicht doppelt");
  assert.equal(state.sent.essen.lastTxId, "b");
  txs.push(tx("c", "2026-11-19", 38, "essen"));
  assert.deepEqual(run(txs, "2026-11-19"), ["100"]);
  txs.push(tx("d", "2026-11-19", 24, "essen"));
  const l = M.budgetAlerts(M.budgetStatus(txs, [{ id: "essen", amount: 200 }], "2026-11"), state, "2026-11-19", {});
  assert.equal(l[0].kind, "over");
  assert.equal(sp(l[0].text), "🛑 Budget Essen & Einkauf überschritten um 24 €");
  state = M.applyAlerts(state, "2026-11-19", l);
  assert.deepEqual(run(txs, "2026-11-20"), [], "ohne neue Ausgabe nichts");
  txs.push(tx("e", "2026-11-21", 5, "essen"));
  assert.deepEqual(run(txs, "2026-11-21"), ["over"]);
  // neuer Monat → alles wieder frei
  const dec = [tx("x", "2026-12-02", 170, "essen")];
  assert.deepEqual(run(dec, "2026-12-02"), ["80"]);
  assert.equal(state.month, "2026-12");
  assert.deepEqual(Object.keys(state.sent), ["essen"]);
});

test("budgetAlerts: Sprung über 100 % in einem Schritt, Budget geändert, Schalter aus, Tempo", () => {
  const rows = (txs, lim = 200) => M.budgetStatus(txs, [{ id: "essen", amount: lim }], "2026-11");
  let l = M.budgetAlerts(rows([tx("a", "2026-11-03", 230, "essen")]), null, "2026-11-20", {});
  assert.equal(l.length, 1);
  assert.equal(l[0].kind, "100");
  assert.match(sp(l[0].text), /^🛑 Budget Essen & Einkauf überschritten um 30 € – STOPP/);
  assert.ok(l[0].mark["80"] && l[0].mark["100"]);
  const st = M.applyAlerts(null, "2026-11-20", l);
  // Budget erhöht → Zustand der Kategorie verfällt
  l = M.budgetAlerts(rows([tx("a", "2026-11-03", 230, "essen")], 280), st, "2026-11-20", {});
  assert.deepEqual(l.map((a) => a.kind), ["80"]);
  // Schalter
  assert.equal(M.budgetAlerts(rows([tx("a", "2026-11-03", 170, "essen")]), null, "2026-11-20", { on: false }).length, 0);
  assert.equal(M.budgetAlerts(rows([tx("a", "2026-11-03", 170, "essen")]), null, "2026-11-20", { at80: false }).length, 0);
  // Tempo nur in der ersten Monatshälfte (ab dem 3.), einmal
  l = M.budgetAlerts(rows([tx("a", "2026-11-03", 70, "essen")]), null, "2026-11-07", {});
  assert.deepEqual(l.map((a) => a.kind), ["pace"]);
  const st2 = M.applyAlerts(null, "2026-11-07", l);
  assert.equal(M.budgetAlerts(rows([tx("a", "2026-11-03", 75, "essen")]), st2, "2026-11-08", {}).length, 0);
  assert.equal(M.budgetAlerts(rows([tx("a", "2026-11-03", 70, "essen")]), null, "2026-11-16", {}).length, 0);
  assert.equal(M.budgetAlerts(rows([tx("a", "2026-11-03", 70, "essen")]), null, "2026-11-07", { pace: false }).length, 0);
});

test("decideBudget (Push): Ruhezeit, Erinnerungen aus, ohne Budget nichts; Nachricht + Zustand", () => {
  const txs = [tx("a", "2026-11-02", 100, "essen"), tx("b", "2026-11-10", 62, "essen")];
  const at = viennaToTs(2026, 11, 19, 10, 0);
  const out = decideBudget(at, {}, txs, BUD, [], null);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "budget");
  assert.equal(out[0].title, "⚠️ Budget fast aufgebraucht");
  assert.equal(sp(out[0].body), "⚠️ Budget Essen & Einkauf fast aufgebraucht: 162 € von 200 € – noch 38 € bis Monatsende (12 Tage)");
  assert.equal(out[0].tag, "budget-essen");
  assert.equal(out[0].url, "./#alltag/geld?tab=budget");
  const st = applyBudgetAlerts(null, "2026-11-19", out[0].alerts);
  assert.deepEqual(st.sent.essen, { "80": true, limit: 200, spent: 162, lastTxId: "b" });
  assert.equal(decideBudget(at, {}, txs, BUD, [], st).length, 0, "einmal pro Monat");
  assert.equal(decideBudget(viennaToTs(2026, 11, 19, BUDGET_QUIET.from, 30), {}, txs, BUD, [], null).length, 0, "nachts nicht");
  assert.equal(decideBudget(viennaToTs(2026, 11, 19, 6, 59), {}, txs, BUD, [], null).length, 0);
  assert.equal(decideBudget(at, { reminders: { enabled: false } }, txs, BUD, [], null).length, 0, "Push allgemein aus");
  assert.equal(decideBudget(at, { money: { alerts: { on: false } } }, txs, BUD, [], null).length, 0);
  assert.equal(decideBudget(at, {}, txs, [], [], null).length, 0, "ohne Budget");
  // eigene Kategorien-Namen
  const own = decideBudget(at, {}, txs, BUD, [{ id: "essen", name: "Essen", type: "out", emoji: "🛒" }], null);
  assert.match(sp(own[0].body), /^⚠️ Budget Essen fast aufgebraucht: 162 € von 200 €/);
});

test("splitNoteAmount + affordCheck: Ja / Knapp / Nein", () => {
  assert.deepEqual(M.splitNoteAmount("Pizza 12 €"), { amount: 12, note: "Pizza" });
  assert.deepEqual(M.splitNoteAmount("Handy um 300,50"), { amount: 300.5, note: "Handy" });
  assert.deepEqual(M.splitNoteAmount("Kino"), { amount: NaN, note: "Kino" });
  const base = { today: "2026-11-19", txs: [tx("a", "2026-11-05", 62, "essengehen")], budgets: [{ id: "essengehen", amount: 100 }] };
  let r = M.affordCheck({ ...base, amount: 12, note: "Pizza" });
  assert.equal(r.verdict, "ja");
  assert.equal(r.cat, "essengehen");
  assert.equal(sp(r.headline), "✅ Ja – danach noch 26 € im Budget Essen gehen");
  r = M.affordCheck({ ...base, amount: 35, cat: "essengehen" });
  assert.equal(r.verdict, "knapp");
  assert.match(sp(r.headline), /^⚠️ Knapp – danach nur noch 3 €/);
  r = M.affordCheck({ ...base, amount: 52, note: "Döner" });
  assert.equal(r.verdict, "nein");
  assert.equal(sp(r.headline), "🛑 Nein – damit wärst du 14 € über dem Budget Essen gehen (noch 12 Tage im Monat)");
  // Abo in derselben Kategorie bis Monatsende zählt mit
  r = M.affordCheck({ ...base, amount: 12, note: "Pizza", subs: [{ id: "s", name: "Mjam-Plus", amount: 20, interval: "month", next: "2026-11-28", category: "essengehen" }] });
  assert.equal(r.verdict, "knapp");
  assert.equal(r.after, 6);
  // Gesamtbudget schlägt zu, auch wenn die Kategorie passt
  r = M.affordCheck({ ...base, amount: 30, note: "Pizza", budgets: [...base.budgets, { id: "total", amount: 80 }] });
  assert.equal(r.verdict, "nein");
  assert.match(sp(r.headline), /über deinem Gesamtbudget/);
  // ohne Budget, aber Kontostand
  r = M.affordCheck({ today: "2026-11-19", txs: [], budgets: [], amount: 50, note: "Jacke", bank: { linked: true, balance: { amount: 40 } } });
  assert.equal(r.verdict, "nein");
  assert.equal(r.cat, "kleidung");
  assert.match(sp(r.headline), /Konto wäre danach mit 10 € im Minus/);
  // Sparziel
  r = M.affordCheck({ today: "2026-11-19", txs: [{ id: "i", date: "2026-11-10", amount: 600, type: "in", category: "einkommen" }], budgets: [], amount: 400, note: "Konzert",
    goals: [{ id: "g", name: "Moped", emoji: "🏍️", target: 1500, saved: 0, date: "2027-04-30" }] });
  assert.equal(r.verdict, "knapp");
  assert.ok(r.reasons.some((x) => /Sparziel 🏍️ Moped bekäme diesen Monat dann weniger/.test(sp(x))));
  assert.match(sp(M.affordText(r)), /^⚠️ Knapp/);
});
