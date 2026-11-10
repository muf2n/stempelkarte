// node --test test/hausextra-core.test.mjs
// Update 11 – Müllkalender (Rhythmus, Zusatztermine, Ausfall/Verschiebung, Erinnerung) und Vorrat (knapp, MHD, Einkaufsliste).
import test from "node:test";
import assert from "node:assert/strict";
import * as X from "../js/alltag/hausextra-core.js";

const bin = { id: "r", kind: "rest", start: "2026-11-04", every: 2 }; // Mi 04.11., alle 2 Wochen

test("pickups: Rhythmus ab Startdatum, auch rückwirkend gerechnet", () => {
  assert.deepEqual(X.pickups(bin, "2026-11-10", "2026-12-10"), ["2026-11-18", "2026-12-02"]);
  assert.deepEqual(X.pickups(bin, "2026-11-04", "2026-11-04"), ["2026-11-04"]);
  assert.deepEqual(X.pickups(bin, "2026-10-01", "2026-11-10"), ["2026-11-04"], "vor dem Start keine Termine");
  assert.equal(X.nextPickup(bin, "2026-11-19"), "2026-12-02");
});

test("Zusatztermine, Ausfall und Verschieben", () => {
  const only = X.normBin({ id: "s", kind: "sperr", every: 0, dates: ["2026-11-20", "2026-11-12", "kaputt"] });
  assert.deepEqual(only.dates, ["2026-11-12", "2026-11-20"]);
  assert.deepEqual(X.pickups(only, "2026-11-01", "2026-12-31"), ["2026-11-12", "2026-11-20"]);
  const sk = X.skipDate(bin, "2026-11-18");
  assert.deepEqual(X.pickups(sk, "2026-11-10", "2026-12-10"), ["2026-12-02"]);
  const mv = X.moveDate(bin, "2026-11-18", "2026-11-19");
  assert.deepEqual(X.pickups(mv, "2026-11-10", "2026-12-10"), ["2026-11-19", "2026-12-02"]);
});

test("upcoming gruppiert nach Tag", () => {
  const g = X.upcoming([bin, { id: "p", kind: "papier", start: "2026-11-18", every: 4 }], "2026-11-10", 14);
  assert.equal(g.length, 1);
  assert.equal(g[0].day, "2026-11-18");
  assert.deepEqual(g[0].bins.map((b) => b.kind).sort(), ["papier", "rest"]);
});

test("dueBins: Vorabend ab 14 Uhr, am Tag bis 12 Uhr, ohne Erinnerung nie", () => {
  const at = (d, h) => new Date(2026, 10, d, h).getTime();
  assert.equal(X.dueBins([bin], at(17, 13)).length, 0);
  assert.equal(X.dueBins([bin], at(17, 18))[0].when, "morgen");
  assert.equal(X.dueBins([bin], at(18, 7))[0].when, "heute");
  assert.equal(X.dueBins([bin], at(18, 13)).length, 0);
  assert.equal(X.dueBins([{ ...bin, remind: false }], at(17, 18)).length, 0);
});

test("Vorrat: Zustände, Menge ändern, Einkaufsliste ohne Dubletten", () => {
  const today = "2026-11-10";
  assert.deepEqual(X.stockState({ name: "Milch", qty: 1, min: 1, best: "2026-11-12" }, today), ["knapp", "bald"]);
  assert.deepEqual(X.stockState({ name: "Joghurt", qty: 2, best: "2026-11-09" }, today), ["abgelaufen"]);
  assert.deepEqual(X.stockState({ name: "Reis", qty: 0, best: "2026-11-01" }, today), ["leer"], "leer → kein MHD-Alarm");
  assert.deepEqual(X.stockState({ name: "Nudeln", qty: 5, min: 2 }, today), []);
  assert.equal(X.bump({ name: "a", qty: 0.5 }, -1).qty, 0);
  assert.equal(X.buyQty({ name: "Milch", qty: 1, min: 2 }), 3);
  const add = X.toShopping([
    { id: "1", name: "Milch", qty: 1, min: 2, unit: "l" },
    { id: "2", name: "Klopapier", qty: 0, place: "bad", unit: "Rolle" },
    { id: "3", name: "Nudeln", qty: 5, min: 1 },
    { id: "4", name: "Butter", qty: 0 },
  ], [{ name: "butter", done: false }]);
  assert.deepEqual(add.map((a) => a.name), ["Milch", "Klopapier"]);
  assert.equal(add[0].qty, 3);
  assert.equal(add[1].cat, "drogerie");
  assert.equal(add[0].listId, "privat");
  assert.equal(X.sortStock([{ id: "a", name: "A", qty: 5 }, { id: "b", name: "B", qty: 1, best: "2026-11-01" }], today)[0].id, "b");
  assert.equal(X.dueStock([{ id: "j", name: "Joghurt", qty: 1, best: "2026-11-11" }], today).length, 1);
});
