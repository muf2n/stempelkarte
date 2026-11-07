// node --test test/compare-core.test.mjs – 📊 Vergleichsmodus: Zeiträume, Soll/Ist, Aufgaben, Geld-Sperre, Freizeit, Skala.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/compare-core.js";

const NOW = new Date(2026, 10, 6, 15, 0).getTime(); // Fr 06.11.2026
const at = (d, h = 7, m = 0, mo = 10) => new Date(2026, mo, d, h, m).getTime();
const settings = { weeklyTarget: 40, workDays: [1, 2, 3, 4, 5], holidays: false };
const shift = (d, hours, mo = 10) => ({ id: `e${mo}-${d}`, start: at(d, 7, 0, mo), end: at(d, 7 + hours, 0, mo), pauseMin: 0 });

function input(extra = {}) {
  return {
    settings,
    entries: [shift(2, 9), shift(3, 9), shift(4, 8), shift(5, 8), shift(6, 4), shift(26, 8, 9), shift(27, 8, 9), shift(28, 8, 9), shift(29, 8, 9), shift(30, 6, 9)],
    todos: [
      { id: "a", kind: "todo", date: "2026-11-03", done: true, doneAt: at(3, 18) },
      { id: "b", kind: "todo", date: "2026-11-05" },
      { id: "c", kind: "todo", date: "2026-10-28", done: true, doneAt: at(28, 12, 0, 9) },
      { id: "d", kind: "termin", date: "2026-11-04" },
    ],
    money: [{ date: "2026-11-02", amount: 50, type: "out" }, { date: "2026-11-05", amount: 1200, type: "in" }, { date: "2026-10-27", amount: 80, type: "out" }],
    freizeit: [{ cat: "sport", start: at(4, 18), end: at(4, 19) }, { cat: "sport", start: at(29, 18, 0, 9), end: at(29, 18, 30, 9) }, { cat: "zuhause", start: at(5, 20), end: at(5, 21) }],
    moneyLocked: false,
    ...extra,
  };
}

test("periods: Woche Mo–So, Monat", () => {
  const w = C.periods("week", NOW);
  assert.equal(w.cur.fromK, "2026-11-02");
  assert.equal(w.cur.toK, "2026-11-08");
  assert.equal(w.prev.fromK, "2026-10-26");
  assert.equal(w.prev.toK, "2026-11-01");
  const m = C.periods("month", NOW);
  assert.equal(m.cur.fromK, "2026-11-01");
  assert.equal(m.prev.toK, "2026-10-31");
  assert.equal(m.cur.label, "November");
});

test("Woche: Ist, Soll nur vergangene Tage, Überstunden, Aufgaben, Geld, Sport", () => {
  const r = C.compare(input(), "week", NOW);
  const v = Object.fromEntries(r.rows.map((x) => [x.id, x]));
  assert.equal(v.ist.cur, (9 + 9 + 8 + 8 + 4) * 60);
  assert.equal(v.soll.cur, 4 * 8 * 60, "Mo–Do, heute zählt nicht zum Soll");
  assert.equal(v.over.cur, 6 * 60);
  assert.equal(v.ist.prev, 38 * 60);
  assert.equal(v.soll.prev, 40 * 60);
  assert.equal(v.over.prev, -120);
  assert.equal(v.done.cur, 1); assert.equal(v.planned.cur, 2); assert.equal(v.done.prev, 1);
  assert.equal(v.income.cur, 1200); assert.equal(v.expense.cur, 50); assert.equal(v.expense.prev, 80);
  assert.equal(v.expense.mood, "good", "weniger ausgegeben");
  assert.equal(v.sport.cur, 60); assert.equal(v.sport.prev, 30); assert.equal(v.sport.dir, "up"); assert.equal(v.sport.mood, "good");
  assert.equal(v.zuhause.cur, 60);
  assert.equal(v.ist.mood, "neutral");
});

test("Soll erst ab Kontobeginn (erster Eintrag bzw. settings.balanceStart)", () => {
  const r = C.compare(input(), "month", NOW);
  const soll = r.rows.find((x) => x.id === "soll");
  assert.equal(soll.prev, 5 * 8 * 60, "Oktober: erst ab 26.10. (erster Eintrag)");
  const r2 = C.compare(input({ settings: { ...settings, balanceStart: "2026-10-01" } }), "month", NOW);
  assert.equal(r2.rows.find((x) => x.id === "soll").prev, 22 * 8 * 60, "mit Kontobeginn 01.10. ganzer Oktober");
});

test("Geld-Sperre: keine Geld-Zeilen", () => {
  const r = C.compare(input({ moneyLocked: true }), "month", NOW);
  assert.ok(!r.rows.some((x) => x.money));
  assert.ok(!r.rows.some((x) => x.id === "income" || x.id === "expense"));
});

test("Skala und Formatierung", () => {
  assert.deepEqual(C.barScale(50, 100), [0.5, 1]);
  assert.deepEqual(C.barScale(0, 0), [0, 0]);
  assert.deepEqual(C.barScale(-60, 30), [1, 0.5]);
  const over = C.ROWS.find((x) => x.id === "over");
  assert.equal(C.fmt(over, 90), "+1:30 h");
  assert.equal(C.fmt(over, -120), "−2:00 h");
  assert.equal(C.fmtDelta(over, -30), "▼ 0:30 h");
  assert.equal(C.fmtDelta(C.ROWS[3], 2), "▲ 2");
  assert.equal(C.fmtDelta(C.ROWS[3], 0), "±0");
});
