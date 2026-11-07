// node --test test/notes-core.test.mjs
// Notizbuch: sichere Darstellung (Escape, **fett**, Listen, nur https-Links, [[Titel]]), Suche, Rückverweise, Filter; KI-Gedächtnis.
import test from "node:test";
import assert from "node:assert/strict";
import * as N from "../js/alltag/notes-core.js";
import * as F from "../js/alltag/notfall-core.js";

test("render escaped HTML und kennt keine gefährlichen Links", () => {
  const h = N.render("<script>alert(1)</script> **fett** und *kursiv*\n[klick](javascript:alert(1)) http://x.at <img src=x onerror=1>");
  assert.ok(!h.includes("<script"));
  assert.ok(!h.includes("<img"));
  assert.ok(h.includes("&lt;script&gt;"));
  assert.ok(h.includes("<strong>fett</strong>"));
  assert.ok(h.includes("<em>kursiv</em>"));
  assert.ok(!/href="(javascript|http:)/.test(h));
  const l = N.render("Siehe https://example.org/a?b=1&c=2. und [Doku](https://example.org/d)");
  assert.ok(l.includes('href="https://example.org/a?b=1&amp;c=2"'));
  assert.ok(l.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(l.includes(">Doku</a>"));
  assert.ok(l.includes("</a>. und"));
  assert.ok(!N.render('[x](https://a.at" onclick="y)').includes('onclick="'));
});

test("render: Listen, Überschriften, Checkboxen, Absätze", () => {
  const h = N.render("# Titel\n- eins\n- [x] zwei\n\n1. a\n2. b\nText\nZeile 2\n---");
  assert.ok(h.startsWith("<h3>Titel</h3><ul><li>eins</li><li>☑️ zwei</li></ul><ol><li>a</li><li>b</li></ol>"));
  assert.ok(h.includes("<p>Text<br>Zeile 2</p>"));
  assert.ok(h.endsWith("<hr>"));
});

test("[[Titel]]-Links: auflösen, neue Notiz anbieten, Rückverweise", () => {
  const notes = [
    { id: "n1", title: "Einkauf Baumarkt", text: "Siehe [[Werkstatt]] und [[werkstatt]] und [[Neu]]", updated: 2 },
    { id: "n2", title: "Werkstatt", text: "Regal bauen", updated: 1 },
  ];
  assert.deepEqual(N.linksIn(notes[0].text), ["Werkstatt", "Neu"]);
  const h = N.render(notes[0].text, { resolve: (t) => (N.findByTitle(notes, t) || {}).id || null });
  assert.ok(h.includes('data-note="n2"'));
  assert.ok(h.includes('data-newnote="Neu"'));
  assert.deepEqual(N.backlinks(notes, notes[1]).map((n) => n.id), ["n1"]);
  assert.equal(N.noteTitle({ text: "# Erste Zeile\nmehr" }), "Erste Zeile");
});

test("Suche, Sortierung, Filter, Schlagworte, Route", () => {
  const notes = [
    { id: "a", title: "Rezept Gulasch", text: "Zwiebeln **anrösten**", tags: "Kochen, #rezept", updated: 1 },
    { id: "b", title: "Prüfung", text: "Ohmsches Gesetz: U = R · I", tags: ["Schule"], fav: true, updated: 3, coll: "LAP" },
    { id: "c", title: "Ideen", text: "Gulasch fürs Grillfest", pinned: true, updated: 2 },
  ];
  assert.deepEqual(N.normNote(notes[0]).tags, ["Kochen", "rezept"]);
  assert.deepEqual(N.searchNotes(notes, "gulasch").map((n) => n.id), ["a", "c"]);
  assert.deepEqual(N.searchNotes(notes, "ohmsches gesetz").map((n) => n.id), ["b"]);
  assert.deepEqual(N.searchNotes(notes, "#schule").map((n) => n.id), ["b"]);
  assert.deepEqual(N.searchNotes(notes, "anrosten").map((n) => n.id), ["a"]);
  assert.deepEqual(N.sortNotes(notes).map((n) => n.id), ["c", "b", "a"]);
  assert.deepEqual(N.filterNotes(notes, { view: "fav" }).map((n) => n.id), ["b"]);
  assert.deepEqual(N.filterNotes(notes, { coll: "lap" }).map((n) => n.id), ["b"]);
  assert.deepEqual(N.filterNotes(notes, { tag: "kochen" }).map((n) => n.id), ["a"]);
  assert.equal(N.tagCounts(notes).length, 3);
  assert.deepEqual(N.collections(notes), [{ coll: "LAP", n: 1 }]);
  assert.equal(N.excerpt("**Hallo** [[Welt]]"), "Hallo Welt");
  assert.equal(N.routeId("#alltag/notizen/abc"), "abc");
  assert.equal(N.routeId("#alltag/notizen"), "");
  assert.equal(N.routeId("#alltag/geld"), null);
});

test("KI-Gedächtnis: Geheimnisse erkennen, Gruppen, nur Erlaubtes lesbar", () => {
  assert.ok(N.looksSecret("Mein Passwort ist hallo123"));
  assert.ok(N.looksSecret("PIN 1234"));
  assert.ok(N.looksSecret("IBAN AT61 1904 3002 3457 3201"));
  assert.ok(N.looksSecret("Karte 4111 1111 1111 1111"));
  assert.equal(N.looksSecret("Ich arbeite bei einer Elektrofirma und mag Pinsel"), "");
  assert.equal(N.looksSecret("Handy +43 664 1234567"), "");
  const items = [
    { id: "1", text: "Mag kein Koriander", area: "vorlieben", allowed: true, created: 1 },
    { id: "2", text: "Berufsschule in Graz", area: "schule", allowed: false, created: 2 },
    { id: "3", text: "Lehrjahr 2", area: "schule", created: 3 },
    { id: "4", text: "", area: "x" },
  ];
  const g = N.memoryGroups(items);
  assert.deepEqual(g.map((x) => x.area.id), ["schule", "vorlieben"]);
  assert.equal(g[0].allowed, false);
  assert.deepEqual(N.readable(items).map((m) => m.id), ["1", "3"]);
  assert.equal(N.normMemory({ area: "zzz" }).area, "allgemein");
  assert.ok(N.isDuplicate(items, "mag kein koriander "));
});

test("Notfallkarte: Normalisieren, tel:-Links, Text", () => {
  const c = F.normCard({ blood: "0-", allergies: " Penicillin ", contacts: [{ name: "Mama", phone: "0043 664 123 45 67", rel: "Mutter" }, {}], claudeAllowed: "ja" });
  assert.equal(c.blood, "0−");
  assert.equal(c.contacts.length, 1);
  assert.equal(c.claudeAllowed, false);
  assert.equal(F.telHref("0043 664 123 45 67"), "tel:+436641234567");
  assert.equal(F.telHref("0664/1234567"), "tel:06641234567");
  assert.equal(F.telHref("javascript:alert(1)"), "");
  assert.equal(F.isEmpty({}), true);
  assert.equal(F.isEmpty(c), false);
  assert.match(F.cardText(c), /Allergien: Penicillin\n/);
  assert.match(F.cardText(c), /- Mama \(Mutter\): 0043 664 123 45 67/);
});
