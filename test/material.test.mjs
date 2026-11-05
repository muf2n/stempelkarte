// node --test test/material.test.mjs
// Material: Katalog-Suche (unscharf, umlaut-unabhängig), Mengen-Text, Zusammenfassung, Teilen-Text, CSV.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/alltag/material-core.js";

const CAT = M.mergeCatalog([]);
const top = (q) => (M.searchCatalog(q, CAT, 5)[0] || {}).name;

test("Katalog: alle Einträge mit Einheit, eindeutige IDs, Gruppen", () => {
  assert.ok(M.CATALOG.length >= 70);
  const ids = new Set(M.CATALOG.map((c) => c.id));
  assert.equal(ids.size, M.CATALOG.length);
  for (const c of M.CATALOG) {
    assert.ok(M.UNITS.includes(c.unit), c.name);
    assert.ok(M.GROUPS.includes(c.group), c.group);
  }
  assert.equal(M.CATALOG.find((c) => c.name === "NYM-J 3×1,5").unit, "m");
  assert.equal(M.CATALOG.find((c) => c.name === "Schuko-Steckdose").unit, "Stk");
  assert.equal(M.CATALOG.find((c) => c.name === "Isolierband").unit, "Rolle");
});

test("Suche: Schreibweisen, Umlaute, Tippfehler", () => {
  assert.equal(top("3x1,5"), "NYM-J 3×1,5");
  assert.equal(top("3×1.5"), "NYM-J 3×1,5");
  assert.equal(top("nym 5x2,5"), "NYM-J 5×2,5");
  assert.equal(top("5x6"), "NYM-J 5×6");
  assert.equal(top("schuko"), "Schuko-Steckdose");
  assert.equal(top("lusterklemme"), "Lüsterklemme");
  assert.equal(top("luesterklemme"), "Lüsterklemme");
  assert.equal(top("Ueberspannung"), "Überspannungsschutz");
  assert.equal(top("wago 413"), "Wago 221-413");
  assert.equal(top("ls b16"), "LS-Schalter B16");
  assert.equal(top("fi 4p"), "FI/RCD 40A 30mA 4-polig");
  assert.equal(top("leerrohr 20"), "Flexrohr M20");
  assert.equal(top("aderendhulse 2,5"), "Aderendhülsen 2,5");
  assert.equal(top("rauchmeldr"), "Rauchmelder");
  assert.equal(top("wechselschalter"), "Wechselschalter");
  // Zahlen nicht unscharf: 3x1,5 darf 3×2,5 nicht finden
  assert.deepEqual(M.searchCatalog("3x1,5", CAT).map((x) => x.name), ["NYM-J 3×1,5"]);
  assert.deepEqual(M.searchCatalog("qqqzzz", CAT), []);
});

test("Suche: Favoriten/Häufige oben, leere Suche zeigt sie", () => {
  const cat = M.mergeCatalog([
    { id: "b_doppelsteckdose", fav: true, count: 0 },
    { id: "b_feuchtraumsteckdose", count: 30 },
    { id: "own_1", own: true, name: "Gira E2 Steckdose", unit: "Stk", count: 2 },
    { id: "own_2", own: true, name: "Weg", unit: "Stk", deleted: true },
  ]);
  assert.equal(cat.filter((x) => x.own).length, 1);
  assert.equal(cat.find((x) => x.own).group, M.OWN_GROUP);
  const empty = M.searchCatalog("", cat).map((x) => x.name);
  assert.deepEqual(empty, ["Doppelsteckdose", "Feuchtraumsteckdose", "Gira E2 Steckdose"]);
  const hits = M.searchCatalog("steckdose", cat).map((x) => x.name);
  assert.ok(hits.indexOf("Feuchtraumsteckdose") < hits.indexOf("Schuko-Steckdose"));
  assert.ok(hits.includes("Gira E2 Steckdose"));
  assert.equal(M.bestCatalogMatch("gira e2", cat).item.name, "Gira E2 Steckdose");
  assert.equal(M.bestCatalogMatch("irgendwas ganz anderes", cat), null);
});

test("Mengen-Text", () => {
  assert.equal(M.qtyText(2, "Stk"), "2×");
  assert.equal(M.qtyText(25, "m"), "25 m");
  assert.equal(M.qtyText(2.5, "m"), "2,5 m");
  assert.equal(M.qtyText(1, "Rolle"), "1 Rolle");
  assert.equal(M.qtyText(3, "Rolle"), "3 Rollen");
  assert.equal(M.cleanQty("2,5"), 2.5);
  assert.equal(M.cleanQty("-1"), 0);
  assert.equal(M.cleanQty("abc"), 0);
});

const PLACES = [{ id: "p1", name: "Teststraße 15" }, { id: "p2", name: "Firma" }];
const I = [
  { id: "a", name: "Schuko-Steckdose", qty: 2, unit: "Stk", status: "verbaut", placeId: "p1", dayKey: "2026-11-05" },
  { id: "b", name: "NYM-J 3×1,5", qty: 15, unit: "m", status: "verbaut", placeId: "p1", dayKey: "2026-11-05" },
  { id: "c", name: "NYM-J 3x1,5", qty: 10, unit: "m", status: "verbaut", placeId: "p1", dayKey: "2026-11-05" },
  { id: "d", name: "Wago 221-413", qty: 1, unit: "Pkg", status: "brauche", placeId: "p1", dayKey: "2026-11-05" },
  { id: "e", name: "Isolierband", qty: 1, unit: "Rolle", status: "besorgt", placeId: null, place: "Oma Huber", dayKey: "2026-11-04" },
  { id: "f", name: "Dübel 6", qty: 1, unit: "Pkg", status: "verbaut", placeId: "p2", dayKey: "2026-11-02" },
  { id: "g", name: "Rauchmelder", qty: 3, unit: "Stk", status: "brauche", placeId: null, place: "", dayKey: "2026-11-05" },
  { id: "h", name: "Dübel 6", qty: 2, unit: "Pkg", status: "verbaut", placeId: "p2", dayKey: "2026-10-28" },
];

test("Summen und Zusammenfassung pro Baustelle", () => {
  const t = M.totals(I.filter((x) => x.placeId === "p1" && x.status === "verbaut"));
  assert.deepEqual(t.map(M.lineText), ["25 m NYM-J 3×1,5", "2× Schuko-Steckdose"]);
  const sum = M.summarize(I, PLACES);
  assert.deepEqual(sum.map((g) => g.place), ["Firma", "Oma Huber", "Teststraße 15", "Ohne Baustelle"]);
  const ts = sum.find((g) => g.place === "Teststraße 15");
  assert.deepEqual(ts.verbaut.map(M.lineText), ["25 m NYM-J 3×1,5", "2× Schuko-Steckdose"]);
  assert.deepEqual(ts.offen.map(M.lineText), ["1 Pkg Wago 221-413"]);
  assert.equal(ts.brauche, 1);
  assert.equal(ts.last, "2026-11-05");
  const firma = sum.find((g) => g.place === "Firma");
  assert.deepEqual(firma.verbaut.map(M.lineText), ["3 Pkg Dübel 6"]);
  assert.equal(sum.find((g) => g.place === "Oma Huber").besorgt, 1);
  assert.equal(M.shortLine(M.verbautOn(I, "2026-11-05")), "25 m NYM-J 3×1,5, 2× Schuko-Steckdose");
  assert.equal(M.shortLine(M.verbautOn(I, "2026-11-05"), 1), "25 m NYM-J 3×1,5 … (+1)");
  assert.equal(M.shortLine(M.verbautOn(I, "2026-11-06")), "");
});

test("Teilen-Text: brauche, Tag, Woche, Baustellen-Filter", () => {
  const today = "2026-11-05";
  let sel = M.shareSelection(I, { mode: "tag", day: today, placeKey: "p:p1" }, today);
  assert.equal(M.shareText(sel, PLACES), "Verbautes Material Teststraße 15 (05.11.2026):\n• 25 m NYM-J 3×1,5\n• 2× Schuko-Steckdose");
  sel = M.shareSelection(I, { mode: "brauche" }, today);
  assert.equal(M.shareText(sel, PLACES), "Materialliste (05.11.2026):\n\nTeststraße 15:\n• 1 Pkg Wago 221-413\n\nOhne Baustelle:\n• 3× Rauchmelder");
  sel = M.shareSelection(I, { mode: "brauche", placeKey: "p:p1" }, today);
  assert.equal(M.shareText(sel, PLACES), "Materialliste Teststraße 15 (05.11.2026):\n• 1 Pkg Wago 221-413");
  sel = M.shareSelection(I, { mode: "woche", day: today }, today);
  assert.equal(sel.when, "02.11.–08.11.2026");
  assert.match(M.shareText(sel, PLACES), /^Verbautes Material \(02\.11\.–08\.11\.2026\):\n\nFirma:\n• 1 Pkg Dübel 6\n\nTeststraße 15:/);
  assert.equal(M.shareText(M.shareSelection(I, { mode: "tag", day: "2026-01-01" }, today), PLACES), "");
  assert.deepEqual(M.weekRange("2026-11-08"), { from: "2026-11-02", to: "2026-11-08" });
  assert.equal(M.placeKey({ place: " Oma  Hüber " }), "t:oma hueber");
});

test("CSV: verbaut eines Monats", () => {
  const csv = M.monthCSV([...I, { id: "x", name: 'Kabel "rot"; dick', qty: 1.5, unit: "m", status: "verbaut", placeId: "p1", dayKey: "2026-11-03", note: "Küche" }], "2026-11", PLACES);
  assert.ok(csv.startsWith("﻿Datum;Baustelle;Material;Menge;Einheit;Status;Notiz\r\n"));
  const rows = csv.trim().split("\r\n");
  assert.equal(rows.length, 1 + 5);
  assert.equal(rows[1], "02.11.2026;Firma;Dübel 6;1;Pkg;Verbaut;");
  assert.equal(rows[2], '03.11.2026;Teststraße 15;"Kabel ""rot""; dick";1,5;m;Verbaut;Küche');
  assert.ok(!csv.includes("28.10.2026"));
});

test("normItem: Standardwerte und Status", () => {
  const now = new Date(2026, 10, 5, 10).getTime();
  const x = M.normItem({ name: "  Taster ", qty: "0", unit: "Eimer", status: "x" }, now);
  assert.deepEqual({ name: x.name, qty: x.qty, unit: x.unit, status: x.status, dayKey: x.dayKey, doneAt: x.doneAt, placeId: x.placeId, photoId: x.photoId },
    { name: "Taster", qty: 1, unit: "Stk", status: "brauche", dayKey: "2026-11-05", doneAt: null, placeId: null, photoId: null });
  assert.equal(M.normItem({ name: "a", status: "verbaut" }, now).doneAt, now);
});
