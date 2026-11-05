// node --test test/cal-reminders.test.mjs
// Update 9 – Kalender: Server-Push (tools/reminders/decide.mjs) für Wiederholungen und mehrere Vorläufe.
import test from "node:test";
import assert from "node:assert/strict";
import { decide, decideTodos, viennaToTs } from "../tools/reminders/decide.mjs";

const rec = { id: "r1", kind: "termin", title: "Fußballtraining", date: "2026-10-05", time: "18:30", endTime: "20:00",
  rrule: "FREQ=WEEKLY;BYDAY=MO", reminders: [15, 120], remind: true, remindMin: 15, location: "Sportplatz" };

test("Wiederkehrender Termin: jede Instanz und jeder Vorlauf einzeln, Dedupe über pushlog.todoSent", () => {
  // Montag nach der Zeitumstellung (26.10.2026)
  const at = viennaToTs(2026, 10, 26, 18, 30);
  let out = decideTodos(at - 119 * 60000, [rec], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Termin: Fußballtraining");
  assert.equal(out[0].body, "um 18:30 · Sportplatz");
  assert.equal(out[0].tag, "todo-r1-2026-10-26");
  assert.deepEqual(out[0].log, [[["todoSent", "r1~2026-10-26~120"], "2026-10-26 18:30"]]);
  const log = { todoSent: { "r1~2026-10-26~120": "2026-10-26 18:30" } };
  assert.equal(decideTodos(at - 100 * 60000, [rec], log).length, 0, "gleicher Vorlauf nicht doppelt");
  out = decideTodos(at - 14 * 60000, [rec], log);
  assert.deepEqual(out.map((o) => o.log[0][0][1]), ["r1~2026-10-26~15"], "zweiter Vorlauf kommt extra");
  // nächste Woche: neue Instanz → neuer Schlüssel
  const at2 = viennaToTs(2026, 11, 2, 18, 30);
  assert.deepEqual(decideTodos(at2 - 10 * 60000, [rec], { todoSent: { "r1~2026-10-26~15": "2026-10-26 18:30" } }).map((o) => o.log[0][0][1]), ["r1~2026-11-02~15"]);
  // Ausnahme und verschobene Instanz
  assert.equal(decideTodos(at2 - 10 * 60000, [{ ...rec, exdates: ["2026-11-02"] }], {}).length, 0);
  const moved = { ...rec, overrides: { "2026-11-02": { date: "2026-11-03", time: "17:00", endTime: "18:00" } } };
  assert.equal(decideTodos(at2 - 10 * 60000, [moved], {}).length, 0);
  const out3 = decideTodos(viennaToTs(2026, 11, 3, 16, 50), [moved], {});
  assert.deepEqual(out3.map((o) => [o.log[0][0][1], o.body]), [["r1~2026-11-02~15", "um 17:00 · Sportplatz"]]);
});

test("Gleichzeitig fällige Vorläufe → eine Nachricht, alle gemerkt; Tag vorher mit „Morgen“", () => {
  const t = { id: "m", kind: "termin", title: "LAP", date: "2026-11-10", time: "08:00", reminders: [5, 10], remind: true, remindMin: 5 };
  const out = decideTodos(viennaToTs(2026, 11, 10, 7, 56), [t], {});
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].log.map((l) => l[0][1]), ["m~2026-11-10~5", "m~2026-11-10~10"]);
  const d1 = decideTodos(viennaToTs(2026, 11, 9, 8, 1), [{ ...t, reminders: [1440] }], {});
  assert.equal(d1[0].body, "Morgen um 08:00");
});

test("Alte Termine/Aufgaben unverändert; decide() reicht Termine durch", () => {
  const legacy = { id: "x", kind: "todo", title: "Akku laden", date: "2026-11-06", time: "14:30", remind: true, remindMin: 0 };
  const at = viennaToTs(2026, 11, 6, 14, 30);
  const out = decide(at + 60000, { reminders: { enabled: true, start: { enabled: false } } }, null, [], {}, [legacy, rec]);
  const todo = out.filter((o) => o.type === "todo");
  assert.deepEqual(todo.map((o) => [o.title, o.body, o.tag, o.log]), [["Aufgabe: Akku laden", "um 14:30", "todo-x", [[["todoSent", "x"], "2026-11-06 14:30"]]]]);
  assert.equal(decide(at + 60000, { reminders: { enabled: false } }, null, [], {}, [legacy]).length, 0);
});
