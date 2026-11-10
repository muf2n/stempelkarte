// node --test test/journal-core.test.mjs
// Update 11 – Reisetagebuch: Normalisierung, Sortierung, Tag-Beschriftung, Datumsvorschlag, Fotos, Export, Zeitleiste.
import test from "node:test";
import assert from "node:assert/strict";
import * as J from "../js/alltag/journal-core.js";
import * as T from "../js/timeline-core.js";

const trip = { id: "t1", title: "Caorle", dest: "Italien", from: "2026-07-10", to: "2026-07-14" };

test("normEntry + forTrip", () => {
  const e = J.normEntry({ id: "a", tripId: "t1", day: "2026-07-11", mood: "💩", photoIds: ["p1", "p1", "", "p2"] });
  assert.equal(e.mood, "");
  assert.deepEqual(e.photoIds, ["p1", "p2"]);
  const list = J.forTrip([
    { id: "b", tripId: "t1", day: "2026-07-12", created: 1 }, { id: "a", tripId: "t1", day: "2026-07-11", created: 5 },
    { id: "c", tripId: "t2", day: "2026-07-11" }, { id: "d", tripId: "t1", day: "kaputt" },
  ], "t1");
  assert.deepEqual(list.map((x) => x.id), ["a", "b"]);
});

test("dayLabel und suggestDay", () => {
  assert.equal(J.dayLabel("2026-07-12", "2026-07-10"), "Tag 3 · Sonntag, 12.07.");
  assert.equal(J.dayLabel("2026-07-12", ""), "Sonntag, 12.07.");
  assert.equal(J.suggestDay(trip, [], "2026-07-12"), "2026-07-12", "während der Reise: heute");
  assert.equal(J.suggestDay(trip, [{ day: "2026-07-10" }], "2026-08-01"), "2026-07-11", "danach: erster Tag ohne Eintrag");
  assert.equal(J.suggestDay({}, [], "2026-08-01"), "2026-08-01");
});

test("Fotos verknüpfen/entfernen und Export", () => {
  let e = J.normEntry({ id: "a", tripId: "t1", day: "2026-07-10", mood: "🤩", title: "Ankunft", text: "Endlich Meer!" });
  e = J.addPhotoId(J.addPhotoId(e, "p1"), "p1");
  assert.deepEqual(e.photoIds, ["p1"]);
  assert.deepEqual(J.removePhotoId(e, "p1").photoIds, []);
  const txt = J.exportText(trip, [e]);
  assert.match(txt, /Reisetagebuch – Caorle \(Italien\)/);
  assert.match(txt, /Tag 1 · Freitag, 10\.07\. 🤩 – Ankunft\nEndlich Meer!\n📷 1 Foto/);
});

test("Zeitleiste zeigt Tagebuch-Einträge unter Reisen", () => {
  const ev = T.build({ now: new Date(2026, 7, 1).getTime(), cols: { travel_trips: [trip], travel_journal: [{ id: "a", tripId: "t1", day: "2026-07-11", mood: "😊", text: "Strand", photoIds: ["p"] }] } });
  const j = ev.find((x) => x.id === "j:a");
  assert.ok(j);
  assert.equal(j.cat, "reisen");
  assert.equal(j.title, "Reisetagebuch · Caorle");
  assert.equal(j.sub, "Strand · 📷 1");
});
