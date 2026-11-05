// node --test test/planer-birthday.test.mjs
// Update 9 – Geburtstage: Jahreswiederholung (Planer-Logik + Push-Entscheidung).
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/planer-core.js";
import { decide, decideTodos, decideBirthday, viennaToTs } from "../tools/reminders/decide.mjs";

const bd = (o) => ({ id: "t1", kind: "geburtstag", title: "Max", bday: "01-03", byear: 2008, time: "09:00", remind: true, remindDays: 1, ...o });

test("nextBirthday: über den Jahreswechsel, mit Alter", () => {
  const n = P.nextBirthday(bd(), "2026-12-30");
  assert.deepEqual(n, { key: "2027-01-03", days: 4, age: 19 });
  assert.equal(P.nextBirthday(bd(), "2027-01-03").days, 0);
  assert.equal(P.nextBirthday(bd(), "2027-01-04").key, "2028-01-03");
  assert.equal(P.nextBirthday(bd({ byear: null }), "2026-12-30").age, null);
});

test("29. Februar → 28. Februar in Nicht-Schaltjahren", () => {
  const t = bd({ bday: "02-29", byear: 2004 });
  assert.equal(P.nextBirthday(t, "2026-11-05").key, "2027-02-28");
  assert.equal(P.nextBirthday(t, "2027-03-01").key, "2028-02-29");
});

test("buildIndex zeigt Geburtstag jedes Jahr (auch über Jahresgrenze)", () => {
  const snap = { todos: [bd()], entries: [], settings: {} };
  const idx = P.buildIndex(snap, "2026-12-28", "2027-01-10", {});
  const it = idx.get("2027-01-03").allDay.find((x) => x.type === "geburtstag");
  assert.ok(it);
  assert.match(it.sub, /wird 19/);
  assert.ok(idx.get("2027-01-03").types.has("geburtstag"));
  const idx2 = P.buildIndex(snap, "2030-01-01", "2030-01-31", {});
  assert.match(idx2.get("2030-01-03").allDay[0].sub, /wird 22/);
});

test("Countdowns: nur offen, mit Datum ab heute, sortiert", () => {
  const todos = [
    { id: "a", kind: "termin", title: "Urlaub Kroatien", date: "2026-11-17", countdown: true, cat: "urlaub" },
    { id: "b", kind: "termin", title: "Alt", date: "2026-11-01", countdown: true },
    { id: "c", kind: "todo", title: "LAP", date: "2026-11-10", countdown: true, cat: "pruefung" },
    { id: "d", kind: "termin", title: "Ohne", date: "2026-11-10" },
    { id: "e", kind: "termin", title: "Erledigt", date: "2026-11-10", countdown: true, done: true },
  ];
  const c = P.countdowns(todos, "2026-11-05");
  assert.deepEqual(c.map((x) => x.t.id), ["c", "a"]);
  assert.equal(c[1].days, 12);
  assert.equal(c[1].emoji, "🏖️");
  assert.equal(P.countdownText(12), "Noch 12 Tage");
});

test("layoutColumns: Überlappungen nebeneinander", () => {
  const items = [{ start: 540, end: 600 }, { start: 570, end: 630 }, { start: 700, end: 720 }];
  P.layoutColumns(items);
  assert.equal(items[0].cols, 2);
  assert.equal(items[1].col, 1);
  assert.equal(items[2].cols, 1);
});

test("Push: Geburtstag 1 Tag vorher um 09:00 Wiener Zeit, über Jahreswechsel", () => {
  const t = bd();
  const at = viennaToTs(2027, 1, 2, 9, 0);
  assert.equal(decideBirthday(at - 60000, t, {}), null);
  const m = decideBirthday(at + 5 * 60000, t, {});
  assert.ok(m);
  assert.equal(m.title, "🎂 Geburtstag: Max");
  assert.match(m.body, /Morgen \(So, 3\.1\.\) – wird 19/);
  assert.deepEqual(m.log, [[["todoSent", "t1"], "2027-01-03 09:00"]]);
  assert.equal(decideBirthday(at + 5 * 60000, t, { t1: "2027-01-03 09:00" }), null, "nicht doppelt");
  assert.equal(decideBirthday(at + 4 * 3600000, t, {}), null, "nach 3 h nicht mehr");
  // Vorjahres-Stempel blockiert nicht
  assert.ok(decideBirthday(at + 60000, t, { t1: "2026-01-03 09:00" }));
  // nächstes Jahr wieder
  const at2 = viennaToTs(2028, 1, 2, 9, 0);
  assert.match(decideBirthday(at2 + 60000, t, { t1: "2027-01-03 09:00" }).body, /wird 20/);
});

test("Push: am Tag selbst, eigene Uhrzeit; über decide()/decideTodos", () => {
  const t = bd({ remindDays: 0, time: "07:30", byear: null });
  const at = viennaToTs(2027, 1, 3, 7, 30);
  const out = decideTodos(at + 60000, [t], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].body, "Heute");
  const all = decide(at + 60000, { reminders: { start: { enabled: false } } }, null, [], {}, [t]);
  assert.equal(all.filter((x) => x.type === "birthday").length, 1);
  assert.equal(decideTodos(at + 60000, [{ ...t, remind: false }], {}).length, 0);
});

test("Bestehende Termin-Erinnerung unverändert", () => {
  const t = { id: "x", kind: "termin", title: "Zahnarzt", date: "2026-11-06", time: "14:30", remind: true, remindMin: 30 };
  const at = viennaToTs(2026, 11, 6, 14, 30);
  const out = decideTodos(at - 20 * 60000, [t], {});
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Termin: Zahnarzt");
});
