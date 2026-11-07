// Japanisch: Selbstprüfung aller Lerninhalte (Wortschatz, Grammatik, Beispielsätze, Lesetexte).
// Kana ↔ Romaji wird mit romajiMatches (Hepburn, jp-core.js) für JEDEN Eintrag geprüft.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VOCAB, TOPIC_LIST, READINGS } from "../js/alltag/jp-data.js";
import { GRAMMAR, PATH_ORDER } from "../js/alltag/jp-data-grammar.js";
import { SENTENCES } from "../js/alltag/jp-data-sentences.js";
import { MORE_READINGS } from "../js/alltag/jp-data-read.js";
import { romajiMatches, toKatakana } from "../js/alltag/jp-core.js";
import { parseJa, tileAnswers } from "../js/alltag/jp-text.js";
import * as P from "../js/alltag/path-core.js";
import { KANA_GROUPS } from "../js/alltag/jp-data.js";

const KANA_ONLY = /^[぀-ヿー\s　、。！？「」・]+$/;
const LEVELS = new Set(["N5", "N4", "N3"]);

test("Romaji-Prüfer: Hepburn-Regeln", () => {
  for (const [k, r] of [["おとうさん", "otōsan"], ["おおきい", "ōkii"], ["おもう", "omou"], ["コーヒー", "kōhī"], ["きんようび", "kin'yōbi"],
    ["まっちゃ", "matcha"], ["わたしは がくせいです。", "Watashi wa gakusei desu."], ["パンを たべます", "Pan o tabemasu"], ["にほんへ", "Nihon e"], ["えっ、ほんとう", "E, hontō"]]) {
    assert.ok(romajiMatches(k, r), `${k} = ${r}`);
  }
  for (const [k, r] of [["きって", "kite"], ["がくせい", "gakuse"], ["すし", "shushi"], ["ほん", "hon o"]]) assert.ok(!romajiMatches(k, r), `${k} ≠ ${r}`);
});

test("Wortschatz: ~600 Wörter, Pflichtfelder, eindeutig, Kana ↔ Romaji passt", () => {
  assert.ok(VOCAB.length >= 580 && VOCAB.length <= 720, `Wörter: ${VOCAB.length}`);
  assert.equal(new Set(VOCAB.map((v) => v.id)).size, VOCAB.length, "IDs eindeutig");
  const keys = new Set();
  const bad = [];
  for (const v of VOCAB) {
    assert.ok(v.kana && v.romaji && v.de && v.topic && LEVELS.has(v.level), v.id);
    assert.match(v.kana, /^[぀-ヿー]+$/, v.kana);
    const key = v.kana + "|" + v.kanji;
    assert.ok(!keys.has(key), "doppelt: " + key);
    keys.add(key);
    if (!romajiMatches(v.kana, v.romaji)) bad.push(`${v.kana} ≠ ${v.romaji}`);
    if (v.pos === "verb") {
      assert.ok([1, 2, 3].includes(v.group) && v.masu && v.dict, v.id);
      assert.match(v.masu, /ます$/, v.id);
      if (!romajiMatches(v.masu, v.masuRo)) bad.push(`${v.masu} ≠ ${v.masuRo}`);
      if (!romajiMatches(v.dict, v.dictRo)) bad.push(`${v.dict} ≠ ${v.dictRo}`);
      if (v.group === 2) assert.match(v.dict, /[えけげせぜてでねへべぺめれいきぎしじちぢにひびぴみり]る$/, "ru-Verb " + v.dict);
      if (v.group === 1) assert.match(v.dict, /[うくぐすつぬぶむる]$/, "u-Verb " + v.dict);
    }
    if (v.pos === "i") assert.match(v.kana, /い$/, "い-Adjektiv " + v.kana);
  }
  assert.deepEqual(bad, []);
  // alte IDs bleiben (Lernstand!): erstes und letztes Wort der ursprünglichen 160
  assert.equal(VOCAB.find((v) => v.id === "s0_0").kana, "こんにちは");
  assert.equal(VOCAB.find((v) => v.id === "s9_11").kana, "やま");
  for (const t of ["Körper & Gesundheit", "Kleidung", "Wohnung & Haus", "Stadt & Verkehr", "Einkaufen & Geld", "Wetter & Jahreszeiten", "Freizeit & Hobbys",
    "Schule & Lernen", "Gefühle & Adjektive", "Häufige Verben", "Zeitangaben", "Fragewörter", "Natur & Tiere"]) assert.ok(TOPIC_LIST.some((x) => x.topic === t), t);
  assert.ok(VOCAB.filter((v) => v.pos === "i").length >= 30 && VOCAB.filter((v) => v.pos === "na").length >= 15);
  assert.ok(VOCAB.some((v) => v.kanji === "工具"));
});

const checkSentence = (src, ro, where) => {
  const p = parseJa(src);
  assert.ok(p.tokens.length >= 1, where);
  assert.ok(KANA_ONLY.test(p.kana), `${where}: Lesung nur Kana – ${p.kana}`);
  return romajiMatches(p.kana, ro) ? null : `${where}: ${p.kana} ≠ ${ro}`;
};

test("Grammatik: 20 Lektionen, Beispiele + Übungen gültig", () => {
  assert.equal(GRAMMAR.length, 20);
  assert.equal(new Set(GRAMMAR.map((g) => g.id)).size, 20);
  const bad = [];
  for (const g of GRAMMAR) {
    assert.ok(g.title && g.emoji && g.explain.length >= 2 && g.table.length >= 2, g.id);
    assert.ok(g.examples.length >= 3 && g.examples.length <= 6, g.id + " Beispiele");
    assert.ok(g.ex.length >= 4 && g.ex.length <= 6, g.id + " Übungen");
    g.examples.forEach(([src, ro, de], i) => { assert.ok(de, g.id); const e = checkSentence(src, ro, `${g.id} Beispiel ${i}`); if (e) bad.push(e); });
    for (const [i, e] of g.ex.entries()) {
      const w = `${g.id} Übung ${i}`;
      assert.ok(["mc", "build", "pick", "pickja"].includes(e.t), w);
      if (e.t === "mc") {
        assert.equal(e.s.split("＿").length, 2, w + ": genau eine Lücke");
        assert.ok(e.opts.includes(e.a) && new Set(e.opts).size === e.opts.length && e.opts.length >= 3, w);
        assert.ok(KANA_ONLY.test(e.s.replace("＿", e.a)), w);
        if (!romajiMatches(e.s.replace("＿", e.a), e.ro)) bad.push(`${w}: ${e.s.replace("＿", e.a)} ≠ ${e.ro}`);
        // keine andere Option ergibt dieselbe Lesung
        for (const o of e.opts) if (o !== e.a) assert.ok(!romajiMatches(e.s.replace("＿", o), e.ro), w + " zweideutig: " + o);
      } else if (e.t === "build") {
        const r = checkSentence(e.src, e.ro, w); if (r) bad.push(r);
        assert.ok(parseJa(e.src).tokens.filter((x) => !x.punct).length >= 2, w);
      } else if (e.t === "pick") {
        assert.ok(e.opts.includes(e.a) && new Set(e.opts).size === e.opts.length, w);
        if (!romajiMatches(e.s, e.ro)) bad.push(`${w}: ${e.s} ≠ ${e.ro}`);
      } else {
        assert.ok(e.opts.includes(e.a) && new Set(e.opts).size === e.opts.length && e.de, w);
        if (!romajiMatches(e.a, e.ro)) bad.push(`${w}: ${e.a} ≠ ${e.ro}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  // Reihenfolge im Lernpfad: alle Grammatik-Lektionen und Themen bekannt
  const topics = new Set(VOCAB.map((v) => v.topic));
  for (const k of PATH_ORDER) {
    const [kind, name] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
    if (kind === "g") assert.ok(GRAMMAR.some((g) => g.id === name), k);
    else assert.ok(topics.has(name), k);
  }
  for (const g of GRAMMAR) assert.ok(PATH_ORDER.includes("g:" + g.id), g.id);
});

test("Beispielsätze: ~150, getaggt, Kana ↔ Romaji, Kacheln lösbar", () => {
  assert.ok(SENTENCES.length >= 140, `Sätze: ${SENTENCES.length}`);
  const gids = new Set([...GRAMMAR.map((g) => g.id), "basis"]);
  const topics = new Set(VOCAB.map((v) => v.topic));
  const bad = [];
  const seen = new Set();
  SENTENCES.forEach(([g, topic, src, ro, de, fixed], i) => {
    assert.ok(gids.has(g), `Satz ${i}: Grammatik ${g}`);
    assert.ok(topics.has(topic), `Satz ${i}: Thema ${topic}`);
    assert.ok(de, `Satz ${i}`);
    const e = checkSentence(src, ro, `Satz ${i}`); if (e) bad.push(e);
    const p = parseJa(src);
    assert.ok(!seen.has(p.text), "doppelt: " + p.text); seen.add(p.text);
    const ans = tileAnswers(p.phrases, { fixed });
    assert.ok(ans.length >= 1 && ans[0] === p.tokens.filter((x) => !x.punct).map((x) => x.r).join(""), `Satz ${i}`);
  });
  assert.deepEqual(bad, []);
  for (const g of GRAMMAR) assert.ok(SENTENCES.filter((s) => s[0] === g.id).length >= 6, g.id + " hat genug Sätze");
});

test("Lesetexte: 30 Texte, jede Zeile Kana ↔ Romaji", () => {
  const all = [...READINGS.map((r) => r.id), ...MORE_READINGS.map((r) => r[0])];
  assert.equal(all.length, 30);
  assert.equal(new Set(all).size, 30);
  const bad = [];
  for (const [id, level, emoji, title, lines] of MORE_READINGS) {
    assert.ok([1, 2, 3].includes(level) && emoji && title && lines.length >= 4, id);
    lines.forEach(([, src, ro, de], i) => { assert.ok(de, id); const e = checkSentence(src, ro, `${id}/${i}`); if (e) bad.push(e); });
  }
  for (const r of READINGS) r.lines.forEach((l, i) => { const k = l.ja.map(([t, rd]) => rd || t).join(""); if (!romajiMatches(k, l.ro)) bad.push(`${r.id}/${i}: ${k} ≠ ${l.ro}`); });
  assert.deepEqual(bad, []);
});

test("Lernpfad: Grammatik-Lektionen bauen gültige Übungen, jede Kachel-Aufgabe ist lösbar", () => {
  const units = P.jpUnits({ groups: KANA_GROUPS, vocab: VOCAB, toKata: toKatakana, grammar: GRAMMAR, sentences: SENTENCES, order: PATH_ORDER });
  const gUnits = units.filter((u) => u.kind === "grammar");
  assert.equal(gUnits.length, 20);
  let tiles = 0;
  for (const n of P.allNodes(units)) {
    if (n.type === "chest") continue;
    for (const seed of [1, 2, 3]) {
      const ex = P.buildLesson(n, { module: "jp", seed, canListen: true });
      assert.ok(ex.length >= 4, n.id);
      for (const e of ex) {
        if (e.type === "mc") { assert.ok(e.options.includes(e.answer), n.id + " " + e.q); assert.equal(new Set(e.options).size, e.options.length, n.id + " " + e.q); }
        if (e.type === "tiles") {
          tiles++;
          // lösbar: die Lösung lässt sich aus den Kacheln legen
          const bank = e.tiles.slice();
          const words = e.words || [...e.answer];
          for (const w of words) { const k = bank.indexOf(w); assert.ok(k >= 0, `${n.id}: Kachel „${w}“ fehlt (${e.answer})`); bank.splice(k, 1); }
          assert.ok(P.checkBasic(e, words), n.id + " " + e.answer);
          for (const a of e.answers || []) assert.ok(P.checkBasic(e, a), n.id);
        }
      }
    }
  }
  assert.ok(tiles > 100, "Kachel-Aufgaben: " + tiles);
});
