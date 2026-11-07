// node --test test/search-core.test.mjs
// Universale Suche: Normalisierung (Groß/klein, Umlaute, ß), Wortanfang/Teilwort, Datum „12.11.“, Gruppen + „mehr“, Hervorhebung, Verlauf.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/search-core.js";

const NOW = new Date(2026, 10, 7, 12).getTime();

test("fold: klein, ohne Akzente, ß → ss, mit Positions-Zuordnung", () => {
  assert.equal(S.fold("Straße Müller ÉCOLE"), "strasse muller ecole");
  const m = S.foldMap("aßb");
  assert.equal(m.s, "assb");
  assert.deepEqual(m.map, [0, 1, 1, 2]);
});

test("tokens: Satzzeichen weg, Datum bleibt, doppelte raus", () => {
  assert.deepEqual(S.tokens("  Huber, huber.  12.11. "), ["huber", "12.11."]);
});

test("parseDateToken: 12.11. / 12.11 / 12.11.2026 / 12.11.26 / ISO / Unsinn", () => {
  assert.deepEqual(S.parseDateToken("12.11."), { d: 12, m: 11, y: null });
  assert.deepEqual(S.parseDateToken("1.2"), { d: 1, m: 2, y: null });
  assert.deepEqual(S.parseDateToken("12.11.2026"), { d: 12, m: 11, y: 2026 });
  assert.deepEqual(S.parseDateToken("12.11.26"), { d: 12, m: 11, y: 2026 });
  assert.deepEqual(S.parseDateToken("2026-11-12"), { d: 12, m: 11, y: 2026 });
  assert.equal(S.parseDateToken("32.11."), null);
  assert.equal(S.parseDateToken("12.13."), null);
  assert.equal(S.parseDateToken("huber"), null);
  assert.ok(S.dateMatches({ d: 12, m: 11, y: null }, "2025-11-12"));
  assert.ok(!S.dateMatches({ d: 12, m: 11, y: 2026 }, "2025-11-12"));
});

test("scoreItem: ganzes Wort > Wortanfang > Teilwort; Titel > Untertitel; alle Wörter müssen passen", () => {
  const t = (title, sub = "", text = "") => ({ id: "x", cat: "orte", title, sub, text });
  const whole = S.scoreItem(t("Baustelle Huber"), ["huber"], NOW);
  const prefix = S.scoreItem(t("Huberhof"), ["huber"], NOW);
  const inner = S.scoreItem(t("Oberhuber"), ["huber"], NOW);
  assert.ok(whole > prefix && prefix > inner && inner > 0, `${whole} ${prefix} ${inner}`);
  assert.ok(S.scoreItem(t("Huber"), ["huber"]) > S.scoreItem(t("X", "Huber"), ["huber"]));
  assert.ok(S.scoreItem(t("X", "", "huber"), ["huber"]) > 0, "verstecktes Suchfeld zählt");
  assert.equal(S.scoreItem(t("Baustelle Huber"), ["huber", "wien"]), 0, "UND-Verknüpfung");
  assert.equal(S.scoreItem(t("Hallo"), ["e"]), 0, "ein Zeichen nur am Wortanfang");
});

test("Umlaute/ß in beide Richtungen: mueller ↔ Müller, strasse ↔ Straße", () => {
  const it = { id: "1", cat: "orte", title: "Familie Müller", sub: "Hauptstraße 3" };
  assert.ok(S.scoreItem(it, S.tokens("MÜLLER")) > 0);
  assert.ok(S.scoreItem(it, S.tokens("muller")) > 0);
  assert.ok(S.scoreItem(it, S.tokens("mueller")) > 0);
  assert.ok(S.scoreItem(it, S.tokens("hauptstrasse")) > 0);
  assert.ok(S.scoreItem(it, S.tokens("Straße")) > 0);
});

test("Datumssuche: 12.11. findet Einträge des Tages (jedes Jahr), mit Jahr nur genau das", () => {
  const a = { id: "a", cat: "eintraege", title: "Huber", dates: ["2026-11-12"] };
  const b = { id: "b", cat: "eintraege", title: "Maier", dates: ["2025-11-12"] };
  const c = { id: "c", cat: "eintraege", title: "Huber", dates: ["2026-11-13"] };
  const r = S.search([a, b, c], "12.11.", { now: NOW });
  assert.deepEqual(r[0].items.map((x) => x.item.id).sort(), ["a", "b"]);
  assert.deepEqual(S.search([a, b, c], "12.11.2026 huber", { now: NOW })[0].items.map((x) => x.item.id), ["a"]);
  const note = { id: "n", cat: "planer", title: "Abgabe bis 12.11." };
  assert.equal(S.search([note], "12.11.", { now: NOW })[0].items[0].item.id, "n", "Datum im Text");
});

test("search: Gruppen in fester Reihenfolge, max. N je Gruppe + „mehr“, aufklappbar", () => {
  const idx = [];
  for (let i = 0; i < 7; i++) idx.push({ id: "m" + i, cat: "material", title: `Wago Klemme ${i}` });
  idx.push({ id: "o", cat: "orte", title: "Wagner Baustelle" });
  idx.push({ id: "s", cat: "einstellungen", title: "Wagen & Fahrten" });
  const r = S.search(idx, "wag", { perGroup: 4, now: NOW });
  assert.deepEqual(r.map((g) => g.id), ["einstellungen", "orte", "material"]);
  const mat = r.find((g) => g.id === "material");
  assert.equal(mat.items.length, 4);
  assert.equal(mat.total, 7);
  assert.equal(mat.more, 3);
  assert.equal(mat.emoji, "🧰");
  const r2 = S.search(idx, "wag", { perGroup: 4, expanded: new Set(["material"]), now: NOW });
  assert.equal(r2.find((g) => g.id === "material").items.length, 7);
  assert.equal(S.totalHits(r), 9);
  assert.deepEqual(S.search(idx, "   "), []);
});

test("search: neuere Treffer leicht vorne, boost wirkt", () => {
  const old = { id: "old", cat: "eintraege", title: "Huber", ts: NOW - 400 * 86400000 };
  const neu = { id: "new", cat: "eintraege", title: "Huber", ts: NOW - 86400000 };
  assert.equal(S.search([old, neu], "huber", { now: NOW })[0].items[0].item.id, "new");
  const done = { id: "d", cat: "planer", title: "Zahnarzt", boost: -5 };
  const open = { id: "o", cat: "planer", title: "Zahnarzt" };
  assert.equal(S.search([done, open], "zahnarzt", { now: NOW })[0].items[0].item.id, "o");
});

test("highlightRanges/Parts: Treffer im Original (auch über ß und Umlaute)", () => {
  assert.deepEqual(S.highlightRanges("Baustelle Huber", "huber"), [[10, 15]]);
  assert.deepEqual(S.highlightRanges("Große Straße", "strasse"), [[6, 12]]);
  assert.deepEqual(S.highlightRanges("Müller", "mueller"), [[0, 6]]);
  assert.deepEqual(S.highlightRanges("abcabc", "b c"), [[1, 3], [4, 6]]);
  assert.deepEqual(S.highlightParts("Hallo Welt", "welt"), [{ t: "Hallo ", hit: false }, { t: "Welt", hit: true }]);
  assert.deepEqual(S.highlightParts("x", ""), [{ t: "x", hit: false }]);
});

test("snippet: Ausschnitt rund um den Treffer", () => {
  const long = "a ".repeat(80) + "Verteiler gesetzt " + "b ".repeat(80);
  const sn = S.snippet(long, "verteiler", 60);
  assert.ok(sn.includes("Verteiler") && sn.startsWith("…") && sn.endsWith("…") && sn.length <= 62, sn);
  assert.equal(S.snippet("kurz", "x"), "kurz");
});

test("pushRecent: neu vorne, ohne Doppelte (umlaut-unabhängig), höchstens 8, zu kurz ignoriert", () => {
  let r = [];
  for (const q of ["huber", "Müller", "x", "HUBER", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]) r = S.pushRecent(r, q);
  assert.equal(r.length, 8);
  assert.equal(r[0], "a7");
  assert.equal(r.filter((x) => S.fold(x) === "huber").length, 1);
  assert.ok(!r.includes("x"));
  assert.deepEqual(S.pushRecent(["Müller"], "muller"), ["muller"]);
  assert.deepEqual(S.pushRecent(null, "ok"), ["ok"]);
});
