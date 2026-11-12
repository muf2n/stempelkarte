// node --test test/dayline-core.test.mjs
// Update 17 – Wie lange war ich wo: Blöcke je Abschnitt, Zusammenfassen, Pausen, Summen je Ort.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/dayline-core.js";

const T = (h, m = 0) => new Date(2026, 10, 12, h, m).getTime();
const places = [{ id: "jauk", name: "Jauk grambach" }, { id: "firma", name: "Firma Büro" }];

test("Tagesablauf mit Fahrt, Baustelle, Pause und Zusammenfassen", () => {
  const e = { id: "e1", start: T(7), end: T(15, 30), pauseMin: 30, segments: [
    { start: T(7), activity: "Arbeiten", placeId: "firma" },
    { start: T(7, 20), activity: "Autofahren" },
    { start: T(7, 45), activity: "Arbeiten", placeId: "jauk" },
    { start: T(10), activity: "Arbeiten", placeId: "jauk" }, // gleicher Ort → zusammen
    { start: T(14, 50), activity: "Autofahren" },
    { start: T(15, 15), activity: "Material holen", placeId: "firma" },
  ] };
  const d = D.dayline([e], places);
  assert.deepEqual(d.blocks.map((b) => [b.kind, b.label, Math.round(b.min)]), [
    ["work", "Firma Büro", 20], ["drive", "Fahrt", 25], ["work", "Jauk grambach", 395], ["drive", "Fahrt", 25], ["act", "Firma Büro", 15]]);
  assert.equal(d.blocks[2].pauseMin, 30);
  assert.equal(d.blocks[0].icon, "🏢");
  const t = d.totals;
  assert.deepEqual(t.map((x) => [x.label, Math.round(x.min)]), [["Jauk grambach", 395], ["Firma Büro", 35], ["Fahrten", 50]]);
  const sum = t.reduce((n, x) => n + x.min, 0);
  assert.equal(Math.round(sum), 8 * 60 + 30 - 30, "Summe = Nettozeit");
});

test("Ohne Abschnitte, laufende Schicht, Urlaub ignoriert, Ort per Name", () => {
  assert.deepEqual(D.entryBlocks({ start: T(8), end: T(12), place: "Kunde Maier, Graz" }, places).map((b) => [b.label, b.min]), [["Kunde Maier", 240]]);
  const run = D.entryBlocks({ start: T(8), segments: [{ start: T(8), activity: "Arbeiten", placeId: "jauk" }] }, places, T(9, 30));
  assert.equal(run[0].min, 90); assert.ok(run[0].running);
  assert.deepEqual(D.entryBlocks({ kind: "urlaub", start: T(0), end: T(23) }, places), []);
  assert.equal(D.entryBlocks({ start: T(8), end: T(9) }, places)[0].label, "Ohne Ort");
});

test("Summen über einen Zeitraum, Farben, Dauer-Text", () => {
  const es = [
    { start: T(7), end: T(11), placeId: "jauk" },
    { start: new Date(2026, 10, 13, 7).getTime(), end: new Date(2026, 10, 13, 9).getTime(), placeId: "jauk" },
    { start: new Date(2026, 10, 20, 7).getTime(), end: new Date(2026, 10, 20, 9).getTime(), placeId: "firma" },
  ];
  const t = D.placeTotals(es, places, T(0), new Date(2026, 10, 16).getTime());
  assert.deepEqual(t.map((x) => [x.label, x.min, x.days]), [["Jauk grambach", 360, 2]]);
  assert.equal(D.colorFor("p:jauk"), D.colorFor("p:jauk"));
  assert.equal(D.colorFor("drive"), "#64748b");
  assert.equal(D.dur(270), "4 h 30"); assert.equal(D.dur(45), "45 min"); assert.equal(D.dur(120), "2 h"); assert.equal(D.dur(65), "1 h 05");
});
