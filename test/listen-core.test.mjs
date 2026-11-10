// node --test test/listen-core.test.mjs
// Freizeit-Listen: Normalisierung, Status-Zyklus, Sortierung, Filter, Geschenke je Person, anstehende Anlässe, Route.
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/alltag/listen-core.js";

test("normItem säubert Felder und lässt nur https-Links zu", () => {
  const i = L.normItem({ id: "a", type: "quatsch", title: "  Dark  ", status: "x", rating: 9, link: "javascript:alert(1)", price: "12,5" });
  assert.equal(i.type, "serie");
  assert.equal(i.title, "Dark");
  assert.equal(i.status, "idee");
  assert.equal(i.rating, 5);
  assert.equal(i.link, "");
  assert.equal(i.price, 0, "Preis nur bei Geschenken");
  const g = L.normItem({ type: "geschenk", title: "Buch", price: "12,5", link: "https://example.com/x", date: "2026-12-24" });
  assert.equal(g.price, 12.5);
  assert.equal(g.link, "https://example.com/x");
  assert.equal(g.date, "2026-12-24");
  assert.equal(L.normItem({ date: "24.12.2026" }).date, "");
});

test("makeItem verlangt Titel, setzt doneAt bei fertig", () => {
  assert.throws(() => L.makeItem({ title: " " }, 1));
  const f = L.makeItem({ title: "Herr der Ringe", type: "film", status: "fertig" }, 100);
  assert.equal(f.doneAt, 100);
  assert.equal(f.created, 100);
});

test("cycle: idee → laeuft → fertig → idee", () => {
  let i = L.normItem({ id: "a", title: "x" });
  i = L.cycle(i, 5); assert.equal(i.status, "laeuft"); assert.equal(i.doneAt, 0);
  i = L.cycle(i, 6); assert.equal(i.status, "fertig"); assert.equal(i.doneAt, 6);
  i = L.cycle(i, 7); assert.equal(i.status, "idee"); assert.equal(i.doneAt, 0);
});

test("sortItems: läuft vor Idee vor fertig", () => {
  const arr = [
    L.normItem({ id: "1", title: "a", status: "fertig", doneAt: 1 }),
    L.normItem({ id: "2", title: "b", status: "idee", updated: 1 }),
    L.normItem({ id: "3", title: "c", status: "laeuft" }),
    L.normItem({ id: "4", title: "d", status: "fertig", doneAt: 9 }),
  ];
  assert.deepEqual(L.sortItems(arr).map((x) => x.id), ["3", "2", "4", "1"]);
});

test("filterItems nach Typ, Status und Suche", () => {
  const arr = [L.normItem({ id: "1", type: "buch", title: "Dune", note: "Sci-Fi" }), L.normItem({ id: "2", type: "film", title: "Dune" })];
  assert.equal(L.filterItems(arr, { type: "buch" }).length, 1);
  assert.equal(L.filterItems(arr, { q: "sci" }).length, 1);
  assert.equal(L.filterItems(arr, { status: "fertig" }).length, 0);
});

test("giftsByPerson gruppiert und summiert offene Ideen", () => {
  const arr = [
    L.normItem({ id: "1", type: "geschenk", title: "Schal", person: "Mama", price: 20 }),
    L.normItem({ id: "2", type: "geschenk", title: "Tasse", person: "Mama", price: 10, status: "fertig" }),
    L.normItem({ id: "3", type: "geschenk", title: "Spiel", price: 30 }),
    L.normItem({ id: "4", type: "film", title: "x" }),
  ];
  const g = L.giftsByPerson(arr);
  assert.equal(g.length, 2);
  const mama = g.find((x) => x.person === "Mama");
  assert.equal(mama.items.length, 2);
  assert.equal(mama.open, 20);
});

test("upcomingGifts: nur offene Geschenke im Zeitfenster", () => {
  const arr = [
    L.normItem({ id: "1", type: "geschenk", title: "a", date: "2026-11-15" }),
    L.normItem({ id: "2", type: "geschenk", title: "b", date: "2026-12-30" }),
    L.normItem({ id: "3", type: "geschenk", title: "c", date: "2026-11-12", status: "fertig" }),
    L.normItem({ id: "4", type: "geschenk", title: "d", date: "2026-11-01" }),
  ];
  assert.deepEqual(L.upcomingGifts(arr, "2026-11-10", 14).map((x) => x.id), ["1"]);
});

test("counts + Route", () => {
  const c = L.counts([L.normItem({ type: "spiel", title: "x", status: "laeuft" })]);
  assert.equal(c.by.spiel.all, 1);
  assert.equal(c.running, 1);
  assert.equal(L.routeType("#alltag/listen/buch"), "buch");
  assert.equal(L.routeType("#alltag/listen/hack"), "");
  assert.equal(L.listHash("film"), "#alltag/listen/film");
  assert.equal(L.statusLabel("geschenk", "fertig"), "🎁 Verschenkt");
});
