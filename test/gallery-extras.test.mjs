// node --test test/gallery-extras.test.mjs – 📸 Galerie-Extras: Schlagwörter, Favoriten-Filter, dHash, Duplikate, was bleibt.
import test from "node:test";
import assert from "node:assert/strict";
import * as X from "../js/gallery-extras-core.js";
import { indexDoc, filterItems } from "../js/gallery-core.js";

test("Schlagwörter säubern, hinzufügen, entfernen", () => {
  assert.deepEqual(X.parseTagInput("Verteiler, #Keller ; bad"), ["Verteiler", "Keller", "bad"]);
  assert.deepEqual(X.parseTagInput("#Keller #Bad"), ["Keller", "Bad"]);
  assert.deepEqual(X.parseTagInput("Fertig montiert"), ["Fertig montiert"]);
  assert.deepEqual(X.cleanTags(["Keller", "keller", "KELLER", "", "<b>x"]), ["Keller", "bx"]);
  assert.equal(X.cleanTag("x".repeat(40)).length, X.TAG_MAX);
  assert.equal(X.cleanTags(Array.from({ length: 20 }, (_, i) => "t" + i)).length, X.TAGS_MAX);
  assert.deepEqual(X.addTags(["A"], "a"), ["A"]);
  assert.deepEqual(X.removeTag(["Keller", "Bad"], "keller"), ["Bad"]);
});

test("Index trägt fav/tags, Filter und Suche", () => {
  const d = indexDoc({ id: "1", ts: 1, fav: true, tags: ["Keller"] });
  assert.equal(d.fav, true);
  assert.deepEqual(d.tags, ["Keller"]);
  assert.ok(!("fav" in indexDoc({ id: "2", ts: 1 })));
  const items = [{ id: "1", fav: true, tags: ["Keller"] }, { id: "2", tags: ["Bad"] }, { id: "3" }];
  assert.deepEqual(X.filterExtras(items, { fav: true }).map((x) => x.id), ["1"]);
  assert.deepEqual(X.filterExtras(items, { tag: "bad" }).map((x) => x.id), ["2"]);
  assert.deepEqual(X.allTags([...items, { id: "4", tags: ["keller"] }]).map((x) => [x.tag, x.n]), [["Keller", 2], ["Bad", 1]]);
  assert.deepEqual(filterItems(items, { q: "#keller" }).map((x) => x.id), ["1"], "Schlagwort ist Suchquelle");
});

test("dHash + Hamming", () => {
  const grad = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
  const inv = grad.map((v) => 255 - v);
  const h1 = X.dHash(grad), h2 = X.dHash(inv);
  assert.equal(h1, "0000000000000000");
  assert.equal(h2, "ffffffffffffffff");
  assert.equal(X.hamming(h1, h2), 64);
  assert.equal(X.hamming(h1, h1), 0);
  assert.equal(X.dHash([1, 2]), "");
  const rgba = new Array(72 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 128));
  assert.ok(X.grayOf(rgba).every((v) => Math.abs(v - 128) < 0.01));
});

test("Duplikate: gleiche Zeit+Maße oder ähnlicher Fingerabdruck; was bleibt", () => {
  const items = [
    { id: "a", ts: 1000, w: 1280, h: 960 },
    { id: "b", ts: 2500, w: 1280, h: 960, note: "Verteiler" },  // 1,5 s später, gleiche Maße → Duplikat von a
    { id: "c", ts: 90000, w: 1280, h: 960 },                     // gleicher Hash wie d
    { id: "d", ts: 500000, w: 960, h: 720 },                     // gleiches Seitenverhältnis
    { id: "e", ts: 600000, w: 1280, h: 960 },                     // anderer Hash
    { id: "f", ts: 1200, w: 720, h: 1280 },                       // gleiche Zeit, andere Maße → kein Duplikat
  ];
  const hashes = new Map([["c", "00ff00ff00ff00ff"], ["d", "00ff00ff00ff00fe"], ["e", "ff00ff00ff00ff00"]]);
  const groups = X.findDuplicates(items, hashes);
  assert.deepEqual(groups.map((g) => g.map((p) => p.id)), [["a", "b"], ["c", "d"]]);
  assert.equal(X.keepOf(groups[0]).id, "b", "mit Notiz bleibt");
  assert.equal(X.keepOf(groups[1]).id, "c", "sonst das älteste");
  assert.deepEqual(X.deletionPlan(groups).sort(), ["a", "d"]);
  assert.equal(X.keepOf([{ id: "x", ts: 1 }, { id: "y", ts: 2, fav: true }]).id, "y", "Favorit bleibt");
  assert.deepEqual(X.findDuplicates([{ id: "q", ts: 1 }]), []);
});

test("Beschreibung säubern", () => {
  assert.equal(X.cleanDescription("**Verteiler** im Keller.\n\n\n\nOffen."), "Verteiler im Keller.\n\nOffen.");
  assert.equal(X.cleanDescription("x".repeat(900)).length, 500);
});
