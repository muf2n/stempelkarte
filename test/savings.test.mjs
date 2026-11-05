// node --test test/savings.test.mjs
// Update 9 – Sparziele: echtes Konto, Lohn-Erinnerung (Zahltag), Aufrunden + Push-Entscheidung.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/alltag/money-core.js";
import { decideSavings, savingsWanted, viennaToTs } from "../tools/reminders/decide.mjs";

const bank = {
  accounts: [
    { uid: "g1", iban_last4: "3201", name: "Konto Florian", hash: "hg" },
    { uid: "s1", iban_last4: "8901", name: "Online Sparen", hash: "hs" },
  ],
  balances: { g1: { amount: 1234.56, currency: "EUR", date: "2026-11-05", at: 1 }, s1: { amount: 600, currency: "EUR", date: "2026-11-05", at: 2 } },
  balanceHistory: {
    s1: [{ d: "2026-08-05", a: 300 }, { d: "2026-09-05", a: 400 }, { d: "2026-10-05", a: 500 }, { d: "2026-11-05", a: 600 }],
  },
};
const sp = (x) => String(x).replace(/\u00a0/g, " ");
const goal = (o = {}) => ({ id: "moped", name: "Moped", emoji: "🏍️", target: 1500, saved: 650, created: 1, ...o });

test("goalCurrent: nicht verbunden = saved, verbunden = Kontostand (− Startbetrag)", () => {
  assert.deepEqual(M.goalCurrent(goal()), { amount: 650, linked: false });
  const g = goal({ bank: { uid: "s1", mode: "all" } });
  const c = M.goalCurrent(g, [g], bank);
  assert.equal(c.amount, 600);
  assert.equal(c.linked, true);
  assert.equal(c.account.name, "Online Sparen");
  assert.equal(M.goalCurrent(goal({ bank: { uid: "s1", mode: "all", offset: 100 } }), [], bank).amount, 500);
  // neue Sitzung → andere uid, gefunden über hash bzw. IBAN-Ende
  assert.equal(M.goalCurrent(goal({ bank: { uid: "alt", hash: "hs" } }), [], bank).amount, 600);
  assert.equal(M.goalCurrent(goal({ bank: { uid: "alt", last4: "8901" } }), [], bank).amount, 600);
  const miss = M.goalCurrent(goal({ bank: { uid: "weg" } }), [], bank);
  assert.equal(miss.missing, true);
  assert.equal(M.goalCurrent(goal({ bank: { uid: "s1" } }), [], { accounts: bank.accounts }).unknown, true);
});

test("goalCurrent: feste Anteile mehrerer Ziele am selben Konto + Rest", () => {
  const a = goal({ id: "a", created: 1, bank: { uid: "s1", mode: "fixed", alloc: 250 } });
  const b = goal({ id: "b", created: 2, bank: { uid: "s1", mode: "fixed", alloc: 500 } });
  const all = [a, b];
  assert.equal(M.goalCurrent(a, all, bank).amount, 250);
  assert.equal(M.goalCurrent(b, all, bank).amount, 350, "nur was nach dem früheren Anteil übrig ist");
  assert.equal(M.accountFree(bank.accounts[1], all, bank), -150);
  const c = goal({ id: "c", created: 3, bank: { uid: "s1", mode: "all" } });
  assert.equal(M.goalCurrent(c, [...all, c], bank).amount, 0, "Rest nach festen Anteilen");
  assert.equal(M.accountFree(bank.accounts[1], [...all, c], bank), null, "Rest gehört dem „ganzer Kontostand“-Ziel");
  assert.equal(M.accountFree(bank.accounts[1], [a], bank), 350);
});

test("monthlyInflow aus dem Verlauf (3 Monate) und Monate bis zum Ziel", () => {
  const f = M.monthlyInflow(bank.balanceHistory.s1, "2026-11-05");
  assert.equal(f.days, 92);
  assert.ok(Math.abs(f.perMonth - 99.26) < 0.05, String(f.perMonth));
  assert.equal(M.monthsToGoal(900, f.perMonth), 10);
  assert.equal(M.monthsToGoal(900, 0), null);
  assert.equal(M.monthsToGoal(0, 10), 0);
  assert.equal(M.monthlyInflow([{ d: "2026-11-01", a: 1 }, { d: "2026-11-05", a: 2 }], "2026-11-05"), null, "zu kurz");
  assert.equal(M.monthlyInflow([], "2026-11-05"), null);
});

const tx = (o) => ({ id: o.id || Math.random().toString(36).slice(2), type: "out", amount: 10, category: "sonstiges", note: "", ...o });

test("detectPayday: Stichwort/Kategorie, sonst regelmäßiger größter Eingang", () => {
  const txs = [
    tx({ date: "2026-11-02", type: "in", amount: 120, note: "Taschengeld von Oma", category: "geschenkt" }),
    tx({ date: "2026-11-04", type: "in", amount: 873.4, note: "Elektro Muster GmbH", bankText: "Lehrlingsentschädigung 11/2026", category: "einkommen" }),
    tx({ date: "2026-11-04", type: "out", amount: 50, note: "Lohnsteuer? nein, Ausgabe" }),
  ];
  assert.deepEqual(M.detectPayday(txs, "2026-11-05"), { date: "2026-11-04", amount: 873.4, id: txs[1].id, source: "lohn" });
  assert.equal(M.detectPayday(txs, "2026-11-03"), null, "noch nicht da");
  assert.equal(M.detectPayday(txs, "2026-12-01"), null, "neuer Monat");
  assert.ok(M.isSalaryTx({ type: "in", amount: 900, date: "2026-11-01", note: "GEHALT 10/26" }));
  assert.ok(!M.isSalaryTx({ type: "in", amount: 30, date: "2026-11-01", note: "Lohn" }), "zu klein");
  assert.ok(!M.isSalaryTx({ type: "in", amount: 300, date: "2026-11-01", note: "Finanzamt Rückerstattung Lohnsteuer", category: "einkommen" }));
  // ohne Stichwort: regelmäßig gleich hoher Eingang
  const reg = [
    tx({ date: "2026-09-28", type: "in", amount: 820, note: "MUSTER GMBH", category: "sonstein" }),
    tx({ date: "2026-10-28", type: "in", amount: 830, note: "MUSTER GMBH", category: "sonstein" }),
    tx({ date: "2026-11-03", type: "in", amount: 1500, note: "Verkauf willhaben", category: "sonstein" }),
    tx({ date: "2026-11-04", type: "in", amount: 835, note: "MUSTER GMBH", category: "sonstein" }),
  ];
  const p = M.detectPayday(reg, "2026-11-05");
  assert.equal(p.date, "2026-11-04");
  assert.equal(p.source, "regel");
  assert.equal(M.detectPayday(reg.slice(2, 3), "2026-11-05"), null, "einmaliger Eingang ist kein Lohn");
});

test("reminderDue: payday / day, erledigt, Ziel erreicht, Betrag begrenzt", () => {
  const txs = [tx({ date: "2026-11-04", type: "in", amount: 873.4, note: "Lehrlingsentschädigung" })];
  const g = goal({ reminder: { on: true, amount: 50, mode: "payday" } });
  const d = M.reminderDue(g, "2026-11-05", { txs });
  assert.deepEqual({ ...d, payday: !!d.payday }, { mk: "2026-11", date: "2026-11-04", kind: "payday", amount: 50, rest: 850, payday: true, linked: false });
  assert.equal(sp(M.reminderMessage(g, d).text), "💰 Lohn ist da! Leg diesen Monat 50,00 € für 🏍️ Moped zur Seite (noch 850,00 € bis zum Ziel)");
  assert.equal(M.reminderDue({ ...g, remindAck: "2026-11" }, "2026-11-05", { txs }), null);
  assert.ok(M.reminderDue({ ...g, remindAck: "2026-10" }, "2026-11-05", { txs }));
  assert.equal(M.reminderDue({ ...g, reminder: { ...g.reminder, on: false } }, "2026-11-05", { txs }), null);
  assert.equal(M.reminderDue({ ...g, saved: 1500 }, "2026-11-05", { txs }), null);
  assert.equal(M.reminderDue({ ...g, saved: 1480 }, "2026-11-05", { txs }).amount, 20, "nicht mehr als fehlt");
  const day = goal({ reminder: { on: true, amount: 30, mode: "day", day: 31 } });
  assert.equal(M.reminderDue(day, "2026-11-29", {}), null);
  assert.equal(M.reminderDue(day, "2026-11-30", {}).date, "2026-11-30", "31. → Monatsende");
  // verbundenes Ziel: Rest aus dem Kontostand
  const lg = goal({ bank: { uid: "s1" }, reminder: { on: true, amount: 50 } });
  assert.equal(M.reminderDue(lg, "2026-11-05", { txs, goals: [lg], bank }).rest, 900);
});

test("Aufrunden: auf 1 € und 5 €, nur Ausgaben dieser Woche, ohne Sparen", () => {
  assert.equal(M.roundUpOf(12.4), 0.6);
  assert.equal(M.roundUpOf(3), 0);
  assert.equal(M.roundUpOf(0.01), 0.99);
  assert.equal(M.roundUpOf(12.4, 5), 2.6);
  assert.equal(M.roundUpOf(15, 5), 0);
  assert.equal(M.weekStart("2026-11-08"), "2026-11-02"); // So → Mo
  assert.equal(M.weekStart("2026-11-02"), "2026-11-02");
  const txs = [
    tx({ date: "2026-11-01", amount: 9.5 }), // Vorwoche
    tx({ date: "2026-11-02", amount: 12.4 }), // 0,60
    tx({ date: "2026-11-03", amount: 3.1 }), // 0,90
    tx({ date: "2026-11-04", amount: 7.2 }), // 0,80
    tx({ date: "2026-11-05", amount: 23 }), // glatt → 0
    tx({ date: "2026-11-06", amount: 4.5 }), // 0,50
    tx({ date: "2026-11-06", amount: 2.5 }), // 0,50
    tx({ date: "2026-11-06", amount: 1.3, category: "sparen" }), // zählt nicht
    tx({ date: "2026-11-06", amount: 0.5, type: "in" }), // Eingang zählt nicht
    tx({ date: "2026-11-07", amount: 18.3, goalId: "x" }), // Sparziel-Buchung zählt nicht
    tx({ date: "2026-11-07", amount: 4.1 }), // 0,90
    tx({ date: "2026-11-08", amount: 7.9 }), // 0,10
    tx({ date: "2026-11-09", amount: 1.5 }), // nächste Woche
  ];
  assert.deepEqual(M.roundUpWeek(txs, "2026-11-08", 1), { from: "2026-11-02", to: "2026-11-08", total: 4.3, count: 7 });
  assert.equal(M.roundUpWeek(txs, "2026-11-04", 1).total, 2.3, "nur bis heute");
  assert.equal(M.roundUpWeek(txs, "2026-11-08", 5).total, 15.3);
  assert.deepEqual(M.roundupSettings({ money: { roundup: { on: true, step: 5, booked: { "2026-11-02": 3.3, bad: 1 } } } }), { on: true, step: 5, push: false, goalId: "", booked: { "2026-11-02": 3.3 } });
  assert.deepEqual(M.roundupSettings({}), { on: false, step: 1, push: false, goalId: "", booked: {} });
});

/* ---------- Push (decide.mjs) ---------- */

const salary = tx({ id: "sal", date: "2026-11-04", type: "in", amount: 873.4, note: "Lehrlingsentschädigung", category: "einkommen" });
const remGoal = goal({ reminder: { on: true, amount: 50, mode: "payday" } });

test("decideSavings: Zahltag-Push einmal pro Monat und Ziel", () => {
  const now = viennaToTs(2026, 11, 4, 14, 5);
  const money = { goals: [remGoal], txs: [salary] };
  const r = decideSavings(now, {}, {}, money);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "💰 Lohn ist da!");
  assert.equal(sp(r[0].body), "Leg diesen Monat 50,00 € für 🏍️ Moped zur Seite (noch 850,00 € bis zum Ziel)");
  assert.deepEqual(r[0].log, [[["savingsSent", "moped"], "2026-11"]]);
  // schon gesendet → nichts (auch am nächsten Tag)
  assert.equal(decideSavings(now, {}, { savingsSent: { moped: "2026-11" } }, money).length, 0);
  assert.equal(decideSavings(viennaToTs(2026, 11, 5, 10, 0), {}, { savingsSent: { moped: "2026-11" } }, money).length, 0);
  // nächster Monat, neuer Lohn → wieder
  const dec = { goals: [remGoal], txs: [salary, { ...salary, id: "sal2", date: "2026-12-03" }] };
  assert.equal(decideSavings(viennaToTs(2026, 12, 3, 12, 0), {}, { savingsSent: { moped: "2026-11" } }, dec).length, 1);
  // nachts nicht, und nicht mehr Tage später
  assert.equal(decideSavings(viennaToTs(2026, 11, 4, 6, 0), {}, {}, money).length, 0);
  assert.equal(decideSavings(viennaToTs(2026, 11, 9, 12, 0), {}, {}, money).length, 0);
  // in der App erledigt → kein Push
  assert.equal(decideSavings(now, {}, {}, { goals: [{ ...remGoal, remindAck: "2026-11" }], txs: [salary] }).length, 0);
  // Erinnerungen ganz aus → nichts
  assert.equal(decideSavings(now, { reminders: { enabled: false } }, {}, money).length, 0);
  // vor dem Lohn → nichts
  assert.equal(decideSavings(viennaToTs(2026, 11, 3, 12, 0), {}, {}, money).length, 0);
});

test("decideSavings: fixer Tag um 09:00, verbundenes Ziel mit Überweisungs-Hinweis", () => {
  const g = goal({ reminder: { on: true, amount: 40, mode: "day", day: 15 }, bank: { uid: "s1" } });
  const money = { goals: [g], txs: [], bank };
  assert.equal(decideSavings(viennaToTs(2026, 11, 15, 8, 59), {}, {}, money).length, 0);
  const r = decideSavings(viennaToTs(2026, 11, 15, 9, 0), {}, {}, money);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, "💰 Zeit zum Sparen");
  assert.match(sp(r[0].body), /40,00 € für .*noch 900,00 € bis zum Ziel.*BAWAG-App/);
  assert.equal(decideSavings(viennaToTs(2026, 11, 16, 9, 0), {}, {}, money).length, 0, "nur am Tag selbst");
});

test("decideSavings: Aufrunden Sonntag 18:00, einmal pro Woche, Standard aus", () => {
  const txs = [tx({ date: "2026-11-02", amount: 12.4 }), tx({ date: "2026-11-05", amount: 3.7 })];
  const sun = viennaToTs(2026, 11, 8, 18, 0);
  const st = { money: { roundup: { on: true, push: true, step: 1, goalId: "moped" } } };
  assert.equal(decideSavings(sun, {}, {}, { txs }).length, 0, "Standard aus");
  assert.equal(decideSavings(sun, { money: { roundup: { on: true } } }, {}, { txs }).length, 0, "Push extra einschalten");
  const r = decideSavings(sun, st, {}, { txs, goals: [goal()] });
  assert.equal(r.length, 1);
  assert.equal(sp(r[0].body), "Diese Woche hättest du durch Aufrunden 0,90 € sparen können – für 🏍️ Moped.");
  assert.deepEqual(r[0].log, [[["roundupSent"], "2026-11-02"]]);
  assert.equal(decideSavings(sun + 3600e3, st, { roundupSent: "2026-11-02" }, { txs }).length, 0);
  assert.equal(decideSavings(viennaToTs(2026, 11, 8, 17, 59), st, {}, { txs }).length, 0);
  assert.equal(decideSavings(viennaToTs(2026, 11, 7, 18, 0), st, {}, { txs }).length, 0, "nur sonntags");
  assert.ok(savingsWanted(st, []));
  assert.ok(!savingsWanted({}, [goal()]));
  assert.ok(savingsWanted({}, [remGoal]));
});
