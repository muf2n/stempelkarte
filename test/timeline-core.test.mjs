// node --test test/timeline-core.test.mjs – 🕰️ Zeitleiste: Quellen, Zeitraum, Sortierung, Foto-Bündel, Filter, Tagesgruppen.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/timeline-core.js";

const NOW = new Date(2026, 10, 6, 15, 0).getTime(); // Fr 06.11.2026 15:00
const at = (d, h = 8, m = 0, mo = 10) => new Date(2026, mo, d, h, m).getTime();

function input() {
  return {
    now: NOW,
    places: [{ id: "p1", name: "Baustelle Nord" }],
    entries: [
      { id: "e1", start: at(6, 7), end: at(6, 15, 30), pauseMin: 30, placeId: "p1" },
      { id: "e2", kind: "krank", start: at(4, 0), end: at(4, 23) },
      { id: "e3", kind: "schule", start: at(3, 8), end: at(3, 16) },
      { id: "e4", kind: "urlaub", start: at(20, 8, 0, 9), end: at(20, 16, 0, 9) },
      { id: "e5", start: at(5, 7), end: at(5, 8), privateTrip: true },
    ],
    todos: [
      { id: "t1", kind: "termin", title: "Zahnarzt", date: "2026-11-05", time: "10:00" },
      { id: "t2", kind: "termin", title: "Zukunft", date: "2026-11-20", time: "10:00" },
      { id: "t3", kind: "todo", title: "Rechnung zahlen", date: "2026-11-05", done: true, doneAt: at(5, 18) },
      { id: "t4", kind: "todo", title: "Offen", date: "2026-11-05" },
    ],
    photos: [
      { id: "f1", ts: at(6, 9), dayKey: "2026-11-06", placeId: "p1", place: "Baustelle Nord", thumb: "data:a" },
      { id: "f2", ts: at(6, 11), dayKey: "2026-11-06", placeId: "p1", place: "Baustelle Nord", thumb: "data:b" },
      { id: "f3", ts: at(6, 12), dayKey: "2026-11-06", addr: "Hauptplatz 1, Graz", thumb: "data:c" },
    ],
    trips: [{ id: "e1#0", start: at(6, 6, 30), from: "Zuhause", to: "Baustelle Nord", km: 12.34 }],
    cols: {
      site_log: [{ id: "l1", placeId: "p1", ts: at(6, 10), text: "Verteiler gesetzt" }, { id: "l2", placeId: "p1", ts: at(6, 10), text: "" }],
      travel_trips: [{ id: "r1", title: "Split", dest: "Kroatien", from: "2026-10-10", to: "2026-10-14", emoji: "✈️" }],
      freizeit: [{ id: "z1", kind: "laufen", label: "Laufen", emoji: "🏃", cat: "sport", start: at(5, 18), end: at(5, 18, 45), km: 5.2 }],
      school_exams: [{ id: "x1", kind: "Schularbeit", subject: "Mathe", date: "2026-11-02", grade: "2" }],
    },
  };
}

test("build: alle Quellen im Monat, nur Vergangenes, neueste zuerst", () => {
  const items = T.build(input(), T.monthRange("2026-11"));
  const cats = T.countByCat(items);
  assert.equal(cats.arbeit, 2); // Schicht + Krank (private Fahrt zählt nicht)
  assert.equal(cats.schule, 2); // Schultag + Prüfung
  assert.equal(cats.termine, 1, "Zukunft fehlt");
  assert.equal(cats.aufgaben, 1, "nur erledigte");
  assert.equal(cats.baustelle, 1, "leere Tagebuch-Einträge nicht");
  assert.equal(cats.fahrten, 1);
  assert.equal(cats.fotos, 2, "2 Gruppen: Baustelle + Adresse");
  assert.equal(cats.freizeit, 1);
  assert.equal(cats.reisen, 0, "Reise war im Oktober");
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].ts >= items[i].ts, "sortiert");
  assert.ok(items.every((x) => x.ts <= NOW));
});

test("Texte und Ziele", () => {
  const items = T.build(input(), T.monthRange("2026-11"));
  const work = items.find((x) => x.id === "e:e1");
  assert.equal(work.title, "Arbeit · Baustelle Nord");
  assert.equal(work.sub, "07:00–15:30 · 8:00 h");
  assert.equal(work.target, "entry:e1");
  const ph = items.find((x) => x.cat === "fotos" && x.title.includes("Nord"));
  assert.equal(ph.title, "2 Fotos · Baustelle Nord");
  assert.deepEqual(ph.thumbs.map((t) => t.id), ["f2", "f1"]);
  assert.deepEqual(ph.photoIds, ["f1", "f2"]);
  assert.ok(items.find((x) => x.cat === "fotos" && x.title === "1 Foto · Hauptplatz 1"));
  assert.equal(items.find((x) => x.cat === "fahrten").sub, "06:30 · 12,3 km");
  assert.equal(items.find((x) => x.cat === "baustelle").target, "#orte/baustelle/p1");
  assert.equal(items.find((x) => x.cat === "aufgaben").target, "todo:t3");
  assert.match(items.find((x) => x.cat === "freizeit").sub, /0:45|45 min/);
  assert.equal(items.find((x) => x.id === "x:x1").sub, "Note 2");
});

test("Oktober: Reise + Urlaub, Monatswechsel", () => {
  const items = T.build(input(), T.monthRange("2026-10"));
  assert.deepEqual(items.map((x) => x.cat).sort(), ["reisen", "reisen"]);
  assert.equal(items.find((x) => x.id === "r:r1").sub, "Kroatien · 4 Nächte");
  assert.equal(T.prevMonth("2026-01"), "2025-12");
  assert.equal(T.monthLabel("2026-03"), "März 2026");
  assert.equal(T.monthKeyOf(NOW), "2026-11");
});

test("Filter, Tagesgruppen, ältester Eintrag", () => {
  const items = T.build(input(), T.monthRange("2026-11"));
  assert.ok(T.filterCats(items, new Set(["fotos"])).every((x) => x.cat === "fotos"));
  assert.equal(T.filterCats(items, new Set()).length, items.length);
  const g = T.groupByDay(items, NOW);
  assert.equal(g[0].label, "Heute");
  assert.equal(g[1].label, "Gestern");
  assert.equal(g[2].label, "Mi 04.11.");
  assert.equal(g.reduce((n, d) => n + d.items.length, 0), items.length);
  assert.equal(T.earliest(input()), new Date(2026, 9, 10).getTime()); // Reise am 10.10.
  assert.equal(T.earliest({}), null);
});
