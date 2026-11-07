// node --test test/habits-core.test.mjs
// Routinen & Ziele: Streaks (täglich/wöchentlich), offen heute, Antippen, Heatmap, Gefahr ab 18 Uhr, Routinen-Reset, Ziele in %.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../js/alltag/habits-core.js";

const T = "2026-11-07"; // Samstag
const log = (...days) => Object.fromEntries(days.map((d) => [d, 1]));

test("Wochenbeginn und Tage", () => {
  assert.equal(R.mondayOf(T), "2026-11-02");
  assert.equal(R.mondayOf("2026-11-02"), "2026-11-02");
  assert.equal(R.mondayOf("2026-11-08"), "2026-11-02");
  assert.equal(R.addDays("2026-12-31", 1), "2027-01-01");
});

test("Täglicher Streak: heute offen zählt bis gestern, Lücke beendet, bester Lauf", () => {
  const h = { id: "h", title: "Wasser", freq: "daily", log: log("2026-11-04", "2026-11-05", "2026-11-06", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04") };
  let st = R.streak(h, T);
  assert.equal(st.current, 3);
  assert.equal(st.today, false);
  assert.equal(st.best, 4);
  assert.equal(st.unit, "Tage");
  st = R.streak({ ...h, log: { ...h.log, [T]: 1 } }, T);
  assert.equal(st.current, 4);
  assert.equal(st.today, true);
  assert.equal(R.streak({ ...h, log: log("2026-11-05") }, T).current, 0); // vorgestern → gerissen
  assert.equal(R.openToday(h, T), true);
});

test("Ziel mehrmals pro Tag + Antippen", () => {
  let h = R.normHabit({ id: "h", title: "Glas Wasser", freq: "daily", target: 3 });
  h.log = R.tap(h, T); assert.equal(h.log[T], 1);
  assert.equal(R.doneOn(h, T), false);
  h.log = R.tap(h, T); h.log = R.tap(h, T);
  assert.equal(R.doneOn(h, T), true);
  assert.equal(R.progressLabel(h, T), "3/3 heute");
  h.log = R.tap(h, T); assert.equal(h.log[T], undefined); // zurück auf 0
  const one = R.normHabit({ id: "x", title: "Lesen" });
  assert.equal(R.tap(one, T)[T], 1);
  assert.deepEqual(R.tap({ ...one, log: { [T]: 1 } }, T), {});
  assert.ok(!("2025-01-01" in R.prune({ "2025-01-01": 1, [T]: 1 }, T)));
});

test("Wöchentlicher Streak und offen", () => {
  const h = { id: "w", title: "Sport", freq: "weekly", target: 2, log: log("2026-10-20", "2026-10-22", "2026-10-26", "2026-10-29", "2026-11-03") };
  let st = R.streak(h, T);
  assert.equal(st.unit, "Wochen");
  assert.equal(st.current, 2); // Wochen 19.10. und 26.10., diese Woche erst 1/2
  assert.equal(st.today, false);
  assert.equal(R.weekCount(h, T), 1);
  assert.equal(R.openToday(h, T), true);
  assert.equal(R.progressLabel(h, T), "1/2 diese Woche");
  const done = { ...h, log: { ...h.log, "2026-11-05": 1 } };
  assert.equal(R.streak(done, T).current, 3);
  assert.equal(R.openToday(done, T), false);
  assert.equal(R.normHabit({ freq: "weekly", target: 9 }).target, 3);
});

test("Heatmap: 8 Wochen à 7 Tage, Stufen, Zukunft", () => {
  const hm = R.heatmap({ id: "h", title: "x", freq: "daily", target: 2, log: { [T]: 2, "2026-11-06": 1 } }, T, 8);
  assert.equal(hm.length, 8);
  assert.ok(hm.every((w) => w.days.length === 7));
  assert.equal(hm[0].week, "2026-09-14");
  const last = hm[7].days;
  assert.equal(last[5].key, T);
  assert.equal(last[5].level, 4);
  assert.equal(last[5].today, true);
  assert.equal(last[4].level, 2);
  assert.equal(last[6].future, true);
  assert.equal(R.rate({ id: "h", title: "x", log: log(T) }, T, 4), 25);
});

test("Serie in Gefahr erst ab 18 Uhr, offene Gewohnheiten", () => {
  const habits = [
    { id: "a", title: "Lesen", emoji: "📖", log: log("2026-11-05", "2026-11-06") },
    { id: "b", title: "Neu", log: log("2026-11-06") },
    { id: "c", title: "Fertig", log: log("2026-11-06", "2026-11-05", T) },
  ];
  assert.deepEqual(R.habitsAtRisk(habits, new Date(2026, 10, 7, 12).getTime()), []);
  const r = R.habitsAtRisk(habits, new Date(2026, 10, 7, 19).getTime());
  assert.deepEqual(r.map((x) => x.id), ["a"]);
  assert.match(r[0].text, /2 Tage 🔥/);
  assert.deepEqual(R.openHabits(habits, T).map((x) => x.id), ["a", "b"]);
});

test("Routine setzt sich täglich zurück, Serie bei komplett erledigt", () => {
  let r = R.normRoutine({ id: "morgen", items: [{ id: "i1", text: "Zähne putzen" }, { id: "i2", text: "Bett machen" }], doneDay: "2026-11-06", doneIds: ["i1", "i2"], log: log("2026-11-06") });
  assert.equal(r.title, "Morgenroutine");
  assert.deepEqual(R.checkedToday(r, T), []); // gestern abgehakt → heute leer
  r = { ...r, ...R.toggleItem(r, "i1", T) };
  assert.deepEqual(R.checkedToday(r, T), ["i1"]);
  assert.equal(r.log[T], undefined);
  r = { ...r, ...R.toggleItem(r, "i2", T) };
  assert.equal(r.log[T], 1);
  assert.equal(R.routineStreak(r, T).current, 2);
  r = { ...r, ...R.toggleItem(r, "i1", T) };
  assert.equal(r.log[T], undefined);
});

test("Ziele: Fortschritt aus Meilensteinen oder manuell, Frist, Sortierung", () => {
  let g = R.normGoal({ id: "g", title: "Führerschein", milestones: [{ id: "m1", text: "Theorie" }, { id: "m2", text: "Fahrstunden" }, { id: "m3", text: "Prüfung" }], due: "2026-11-17" });
  assert.equal(R.goalProgress(g), 0);
  g = { ...g, ...R.toggleMilestone(g, "m1", 5) };
  assert.equal(R.goalProgress(g), 33);
  assert.equal(g.milestones[0].doneAt, 5);
  assert.equal(R.goalDueLabel(g, T), "noch 10 Tage");
  assert.equal(R.goalProgress({ id: "x", title: "Sparen", progress: 140 }), 100);
  assert.equal(R.goalProgress({ id: "x", title: "Sparen", progress: 40 }), 40);
  assert.equal(R.goalProgress({ id: "x", title: "Sparen", progress: 40, done: true }), 100);
  const sorted = R.sortGoals([{ id: "a", title: "B", done: true }, { id: "b", title: "Z" }, { id: "c", title: "A", due: "2026-12-01" }]);
  assert.deepEqual(sorted.map((x) => x.id), ["c", "b", "a"]);
});
