// node --test test/sync-guard-core.test.mjs
// Update 11 – Konflikt-Erkennung: gleiche Gerät, Fremdgerät kannte meine Änderung, Fremdgerät überschreibt (Konflikt), alte App.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../js/sync-guard-core.js";

const NOW = 1_800_000_000_000;

test("stamp setzt Gerät und Basis-Version", () => {
  const d = G.stamp({ id: "a", title: "x", updated: 5 }, { updated: 3 }, "A", NOW);
  assert.equal(d._dev, "A"); assert.equal(d._base, 3); assert.equal(d.updated, 5);
  assert.equal(G.stamp({ id: "a" }, null, "A", NOW)._base, 0);
});

test("Szenario: B ändert offline auf alter Basis und überschreibt A → Konflikt bei A", () => {
  // A schreibt Version 200 auf Basis 100
  const a = G.stamp({ id: "e1", title: "A-Titel", updated: 200 }, { updated: 100 }, "A", NOW);
  let mine = G.remember({}, "entries", a, NOW);
  // eigenes Echo → nichts
  let r = G.check(mine, "entries", a, "A", NOW);
  assert.equal(r.conflict, null); assert.ok(r.mine["entries/e1"], "eigene Änderung bleibt gemerkt");
  // B war offline, kannte nur Version 100, schreibt 250
  const b = G.stamp({ id: "e1", title: "B-Titel", updated: 250 }, { updated: 100 }, "B", NOW);
  r = G.check(mine, "entries", b, "A", NOW + 1);
  assert.ok(r.conflict);
  assert.equal(r.conflict.mine.title, "A-Titel");
  assert.equal(r.conflict.theirs.title, "B-Titel");
  assert.ok(!("_dev" in r.conflict.theirs));
  assert.ok(!r.mine["entries/e1"], "danach vergessen");
});

test("kein Konflikt, wenn das andere Gerät meine Änderung kannte oder es eine alte App ist", () => {
  const a = G.stamp({ id: "e1", updated: 200 }, null, "A", NOW);
  const mine = G.remember({}, "a:notes", a, NOW);
  assert.equal(G.check(mine, "a:notes", G.stamp({ id: "e1", updated: 300 }, { updated: 200 }, "B", NOW), "A", NOW).conflict, null);
  const old = G.check(mine, "a:notes", { id: "e1", updated: 300 }, "A", NOW);
  assert.equal(old.conflict, null); assert.ok(!old.mine["a:notes/e1"]);
  assert.equal(G.check({}, "a:notes", G.stamp({ id: "zz", updated: 1 }, null, "B", NOW), "A", NOW).conflict, null, "nie selbst geändert → egal");
});

test("remember begrenzt, vergisst Altes und hebt große Dokumente nicht auf", () => {
  let m = {};
  for (let i = 0; i < G.MAX_MINE + 20; i++) m = G.remember(m, "c", { id: "x" + i, updated: i }, NOW + i);
  assert.equal(Object.keys(m).length, G.MAX_MINE);
  assert.equal(Object.keys(G.prune(m, NOW + 40 * 864e5)).length, 0);
  const big = G.remember({}, "c", { id: "b", updated: 1, text: "x".repeat(30000) }, NOW);
  assert.equal(big["c/b"].doc, null);
});

test("addConflict, label, diffFields", () => {
  let l = G.addConflict([], { key: "a", at: 1 });
  l = G.addConflict(l, { key: "a", at: 2 });
  assert.equal(l.length, 1); assert.equal(l[0].at, 2);
  assert.equal(G.label({ title: "Bad putzen" }), "Bad putzen");
  assert.match(G.label({ start: new Date(2026, 10, 7, 7, 5).getTime() }), /^Eintrag 07\.11\. 07:05$/);
  assert.deepEqual(G.diffFields({ title: "a", updated: 1, n: 1 }, { title: "b", updated: 2, n: 1 }), ["title"]);
  assert.equal(G.colName("a:money_tx"), "Money tx");
  assert.equal(G.colName("entries"), "Arbeitszeit");
});
