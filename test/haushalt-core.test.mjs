// node --test test/haushalt-core.test.mjs
// Haushalt: Intervalle, nächster Termin, Status (überfällig/heute/bald), Abhaken + Verlauf, Zurücknehmen, dueChores, Sortierung.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "../js/alltag/haushalt-core.js";

const NOW = new Date(2026, 10, 7, 12).getTime(); // Sa 07.11.2026
const T = "2026-11-07";

test("Intervalle: Tage, Wochen, Monate (Monatsende), Texte", () => {
  assert.equal(H.addInterval("2026-11-01", "d", 3), "2026-11-04");
  assert.equal(H.addInterval("2026-11-01", "w", 2), "2026-11-15");
  assert.equal(H.addInterval("2026-01-31", "m", 1), "2026-02-28");
  assert.equal(H.intervalLabel("d", 1), "täglich");
  assert.equal(H.intervalLabel("w", 1), "wöchentlich");
  assert.equal(H.intervalLabel("d", 10), "alle 10 Tage");
  assert.equal(H.intervalLabel("m", 1), "monatlich");
  assert.equal(H.intervalLabel("m", 12), "jährlich");
  assert.equal(H.intervalChoice("d", 1), "taeglich");
  assert.equal(H.intervalChoice("m", 3), "monate");
  assert.equal(H.toDays("w", 2), 14);
  assert.equal(H.normTask({ unit: "x", n: -3 }).unit, "w");
  assert.equal(H.normTask({ unit: "d", n: 9999 }).n, 365);
});

test("Nächster Termin und Status", () => {
  const never = H.normTask({ id: "a", title: "Bad", unit: "w", n: 1, start: T });
  assert.equal(H.nextDue(never), T);
  assert.equal(H.taskStatus(never, T).state, "heute");
  const over = { id: "b", title: "Staubsaugen", unit: "w", n: 1, last: "2026-10-28" };
  const st = H.taskStatus(over, T);
  assert.equal(st.state, "ueber");
  assert.equal(st.days, -3);
  assert.match(st.label, /seit 3 Tagen/);
  assert.equal(H.taskStatus({ ...over, last: "2026-11-01" }, T).state, "bald"); // morgen
  assert.equal(H.taskStatus({ ...over, last: "2026-11-05" }, T).state, "ok");
  const w = { id: "c", kind: "wartung", title: "Rauchmelder", unit: "m", n: 1, last: "2026-10-12" };
  assert.equal(H.taskStatus(w, T).state, "bald"); // in 5 Tagen, Wartung 7 Tage vorher
  assert.equal(H.taskStatus({ ...w, paused: true }, T).state, "pause");
  assert.equal(H.lastLabel(over, T), "vor 10 Tagen erledigt");
  assert.equal(H.lastLabel(never, T), "noch nie erledigt");
});

test("Abhaken schreibt Verlauf, Zurücknehmen stellt den alten Stand her", () => {
  let t = H.normTask({ id: "a", title: "Bad", unit: "w", n: 1, last: "2026-10-30", history: [{ ts: 1, day: "2026-10-30" }] });
  t = H.tick(t, NOW, "gründlich");
  assert.equal(t.last, T);
  assert.equal(t.history.length, 2);
  assert.equal(t.history[1].note, "gründlich");
  assert.equal(H.taskStatus(t, T).state, "ok");
  t = H.untick(t);
  assert.equal(t.last, "2026-10-30");
  assert.equal(t.history.length, 1);
  assert.equal(H.untick(t).last, null);
  // Verlauf ist begrenzt
  let big = H.normTask({ id: "x", title: "X", unit: "d", n: 1 });
  for (let i = 0; i < 70; i++) big = H.tick(big, NOW + i);
  assert.equal(big.history.length, H.MAX_HISTORY);
});

test("dueChores, counts, sortTasks, recentLog", () => {
  const tasks = [
    { id: "a", title: "Bad putzen", room: "Bad", unit: "w", n: 1, last: "2026-10-20" },
    { id: "b", title: "Staubsaugen", unit: "w", n: 1, last: "2026-11-06" },
    { id: "c", kind: "wartung", title: "Rauchmelder testen", unit: "m", n: 1, last: "2026-10-12", history: [{ ts: 5, day: "2026-10-12" }] },
    { id: "d", title: "Pflanzen", unit: "d", n: 1, start: T },
    { id: "e", title: "Pausiert", unit: "d", n: 1, last: "2026-01-01", paused: true },
  ];
  const due = H.dueChores(tasks, NOW);
  assert.deepEqual(due.map((x) => x.id), ["a", "d", "c"]);
  assert.match(due[0].text, /Bad putzen \(Bad\) – seit 11 Tagen fällig/);
  assert.equal(due[0].hash, "#alltag/haushalt");
  const c = H.counts(tasks, T);
  assert.equal(c.all, 5);
  assert.equal(c.faellig, 2);
  assert.equal(c.wartung, 1);
  assert.deepEqual(H.sortTasks(tasks, T).map((x) => x.id), ["a", "d", "c", "b", "e"]);
  const log = H.recentLog(tasks);
  assert.equal(log.length, 1);
  assert.equal(log[0].title, "Rauchmelder testen");
  assert.match(H.searchText(tasks[2]), /Wartung/);
});
