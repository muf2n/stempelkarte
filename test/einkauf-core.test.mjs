// node --test test/einkauf-core.test.mjs
// Einkaufsliste: Schnell-Eingabe, Kategorie raten, Verlauf/Vorschläge, Sortierung, Material „fehlt“, Teilen-Text, Listen.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/alltag/einkauf-core.js";

const NOW = new Date(2026, 10, 7, 12).getTime();

test("parseQuick: Menge/Einheit vorne oder hinten, sonst nur Name", () => {
  assert.deepEqual(E.parseQuick("2 kg Äpfel"), { name: "Äpfel", qty: 2, unit: "kg" });
  assert.deepEqual(E.parseQuick("3x Brot"), { name: "Brot", qty: 3, unit: "Stk" });
  assert.deepEqual(E.parseQuick("500g Faschiertes"), { name: "Faschiertes", qty: 500, unit: "g" });
  assert.deepEqual(E.parseQuick("1,5 l Milch"), { name: "Milch", qty: 1.5, unit: "l" });
  assert.deepEqual(E.parseQuick("Milch 2"), { name: "Milch", qty: 2, unit: "Stk" });
  assert.deepEqual(E.parseQuick("  Brot  "), { name: "Brot", qty: null, unit: "Stk" });
  assert.deepEqual(E.parseQuick("3 Wago 221-413"), { name: "Wago 221-413", qty: 3, unit: "Stk" });
  assert.deepEqual(E.parseQuick("7"), { name: "7", qty: null, unit: "Stk" });
});

test("qtyText/lineText", () => {
  assert.equal(E.qtyText(2, "kg"), "2 kg");
  assert.equal(E.qtyText(3, "Stk"), "3×");
  assert.equal(E.qtyText(null, "kg"), "");
  assert.equal(E.lineText({ name: "Milch", qty: 1.5, unit: "l" }), "1,5 l Milch");
  assert.equal(E.lineText({ name: "Brot" }), "Brot");
});

test("guessCat: Stichwörter, Verlauf gewinnt, sonst Sonstiges", () => {
  assert.equal(E.guessCat("Vollmilch"), "lebensmittel");
  assert.equal(E.guessCat("Äpfel"), "lebensmittel");
  assert.equal(E.guessCat("Zahnpasta"), "drogerie");
  assert.equal(E.guessCat("Wago Klemmen"), "baumarkt");
  assert.equal(E.guessCat("NYM 3x1,5"), "baumarkt");
  assert.equal(E.guessCat("Geschenkpapier"), "sonstiges");
  assert.equal(E.guessCat("Milch", { names: { milch: { cat: "drogerie" } } }), "drogerie");
});

test("normItem: Standardwerte und Grenzen", () => {
  const it = E.normItem({ name: "  Brot ", qty: "2,5", unit: "kg", cat: "falsch", done: true }, NOW);
  assert.equal(it.name, "Brot");
  assert.equal(it.qty, 2.5);
  assert.equal(it.cat, "sonstiges");
  assert.equal(it.listId, "privat");
  assert.equal(it.doneAt, NOW);
  assert.equal(E.normItem({ name: "x", unit: "Fass", qty: -1 }).unit, "Stk");
  assert.equal(E.normItem({ name: "x", qty: -1 }).qty, null);
});

test("listsOf: Standardlisten, eigene Listen, gelöschte Standardliste, Verlauf zählt nicht", () => {
  assert.deepEqual(E.listsOf([]).map((l) => l.id), ["privat", "baustelle"]);
  const docs = [{ id: "history", kind: "history", names: {} }, { id: "p1", name: "Party", e: "🎉", order: 5 }, { id: "baustelle", deleted: true }];
  assert.deepEqual(E.listsOf(docs).map((l) => l.id), ["privat", "p1"]);
  assert.equal(E.listsOf([{ id: "privat", name: "Daheim", e: "🏠", order: 0 }])[0].name, "Daheim");
  assert.equal(E.findList("part", E.listsOf(docs)).id, "p1");
  assert.equal(E.findList("PRIVAT", E.listsOf(docs)).id, "privat");
  assert.equal(E.findList("xyz", E.listsOf(docs)), null);
});

test("Verlauf + Vorschläge: Wortanfang, häufig zuerst, offene raus, begrenzt", () => {
  let n = {};
  n = E.addToHistory(n, [{ name: "Milch", cat: "lebensmittel" }], NOW - 1000);
  n = E.addToHistory(n, [{ name: "Milch", cat: "lebensmittel" }, { name: "Mehl", cat: "lebensmittel" }, { name: "Vollkornbrot" }], NOW);
  assert.equal(n.milch.count, 2);
  assert.deepEqual(E.suggest("m", n).map((x) => x.name), ["Milch", "Mehl"]);
  assert.deepEqual(E.suggest("brot", n).map((x) => x.name), ["Vollkornbrot"]);
  assert.deepEqual(E.suggest("2 kg mi", n).map((x) => x.name), ["Milch"], "Menge vorne wird ignoriert");
  assert.deepEqual(E.suggest("m", n, [{ name: "Milch", done: false }]).map((x) => x.name), ["Mehl"], "schon offen → kein Vorschlag");
  assert.equal(E.suggest("", n)[0].name, "Milch", "leer → die häufigsten");
  let big = {};
  for (let i = 0; i < E.MAX_HISTORY + 20; i++) big = E.addToHistory(big, [{ name: "Artikel " + i }], NOW + i);
  assert.equal(Object.keys(big).length, E.MAX_HISTORY);
  assert.ok(big["artikel " + (E.MAX_HISTORY + 19)] && !big["artikel 0"], "älteste fliegen raus");
});

test("sortItems/groupOpen: offen nach Kategorie, erledigt unten (zuletzt abgehakt zuerst)", () => {
  const items = [
    { id: "1", name: "Seife", cat: "drogerie", done: false, created: 1 },
    { id: "2", name: "Brot", cat: "lebensmittel", done: true, doneAt: 5 },
    { id: "3", name: "Milch", cat: "lebensmittel", done: false, created: 2 },
    { id: "4", name: "Käse", cat: "lebensmittel", done: true, doneAt: 9 },
  ];
  assert.deepEqual(E.sortItems(items).map((x) => x.id), ["3", "1", "4", "2"]);
  assert.deepEqual(E.groupOpen(items).map((g) => [g.cat.id, g.items.map((x) => x.id)]), [["lebensmittel", ["3"]], ["drogerie", ["1"]]]);
  assert.equal(E.openCount(items), 2);
});

test("materialRows: brauche = offen, besorgt der letzten 12 h = abgehakt, Rest nicht", () => {
  const rows = E.materialRows([
    { id: "a", name: "FI-Schalter", qty: 1, unit: "Stk", status: "brauche", place: "Huber", created: 1 },
    { id: "b", name: "NYM", qty: 50, unit: "m", status: "besorgt", updated: NOW - 3600e3 },
    { id: "c", name: "Alt", status: "besorgt", updated: NOW - 13 * 3600e3 },
    { id: "d", name: "Dose", status: "verbaut" },
    { id: "e", name: "Vor Ort", status: "baustelle" },
  ], NOW);
  assert.deepEqual(rows.map((r) => [r.id, r.done]), [["a", false], ["b", true]]);
});

test("shareText: nur offene, nach Kategorie, Material dazu, leer = erledigt", () => {
  const list = { name: "Privat", e: "🏠" };
  const t = E.shareText(list, [
    { name: "Milch", qty: 2, unit: "l", cat: "lebensmittel", done: false },
    { name: "Seife", cat: "drogerie", done: false, note: "Lavendel" },
    { name: "Brot", cat: "lebensmittel", done: true },
  ], [{ name: "FI-Schalter", qty: 1, unit: "Stk", place: "Huber", done: false }]);
  assert.equal(t, "🏠 Privat\n\n🥕 Lebensmittel\n• 2 l Milch\n\n🧴 Drogerie\n• Seife (Lavendel)\n\n🧰 Material fehlt\n• 1 Stk FI-Schalter – Huber");
  assert.equal(E.shareText(list, []), "🏠 Privat\n\nAlles erledigt ✅");
});
