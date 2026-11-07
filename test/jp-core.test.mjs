// node --test test/jp-core.test.mjs
// Alltag › Japanisch: SRS, Kana-Normalisierung/-Vergleich, Quiz-Erzeugung, Statistik.
import test from "node:test";
import assert from "node:assert/strict";
import {
  dayKey, addDays, newCard, review, isDue, isLearned, isMastered, buildQueue,
  toKatakana, toHiragana, kanaList, kanaToRomaji, looseKey, compareSpeech, checkRomaji,
  rng, makeKanaQuiz, meaningChoices, bump, streak, todayCount,
} from "../js/alltag/jp-core.js";
import { VOCAB, KANA_ROWS, READINGS, TOPIC_LIST } from "../js/alltag/jp-data.js";

const T = "2026-11-07";

test("Datum: dayKey/addDays über Monats- und Jahresgrenzen", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30"); // Sommerzeit
});

test("SM-2: Intervalle 1 → 6 → ×EF, Fehler setzt zurück und bleibt heute fällig", () => {
  let c = newCard(T);
  assert.ok(isDue(c, T));
  c = review(c, 4, T);
  assert.equal(c.reps, 1); assert.equal(c.interval, 1); assert.equal(c.due, "2026-11-08");
  assert.ok(isLearned(c)); assert.ok(!isDue(c, T)); assert.ok(isDue(c, "2026-11-08"));
  c = review(c, 4, "2026-11-08");
  assert.equal(c.interval, 6); assert.equal(c.due, "2026-11-14");
  const ef = c.ef;
  c = review(c, 4, "2026-11-14");
  assert.equal(c.interval, Math.round(6 * ef)); assert.ok(isMastered(c));
  const bad = review(c, 1, "2026-11-30");
  assert.equal(bad.reps, 0); assert.equal(bad.interval, 0); assert.equal(bad.due, "2026-11-30"); assert.equal(bad.lapses, 1);
  assert.ok(bad.ef < c.ef && bad.ef >= 1.3);
  assert.equal(bad.seen, 4);
});

test("SM-2: Leicht springt weiter, Schwer kürzer, EF nie unter 1,3, Intervall max. 365", () => {
  assert.equal(review(newCard(T), 5, T).interval, 3);
  const two = review(review(newCard(T), 4, T), 3, T);
  assert.equal(two.interval, 3);
  let c = newCard(T);
  for (let i = 0; i < 12; i++) c = review(c, 3, T);
  assert.ok(c.ef >= 1.3);
  let e = newCard(T);
  for (let i = 0; i < 20; i++) e = review(e, 5, T);
  assert.equal(e.interval, 365);
  // Eingabe ist unverändert (rein)
  const orig = newCard(T); review(orig, 5, T); assert.equal(orig.reps, 0);
});

test("Warteschlange: fällige zuerst (älteste vorn), dann neue bis Tageslimit", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const cards = new Map([
    ["a", { ...review(newCard("2026-11-01"), 4, "2026-11-01") }], // fällig 02.11.
    ["b", { ...review(newCard("2026-11-06"), 4, "2026-11-06"), due: "2026-11-05" }],
    ["c", { ...review(newCard(T), 4, T) }], // morgen
  ]);
  const q = buildQueue(items, cards, T, { newLimit: 3, newToday: 2 });
  assert.deepEqual(q.due.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(q.fresh.map((x) => x.id), ["d"]);
  assert.equal(buildQueue(items, {}, T, { newLimit: 10 }).fresh.length, 5);
});

test("Kana: Katakana-Umwandlung hin und zurück, Listen", () => {
  assert.equal(toKatakana("きゃっと"), "キャット");
  assert.equal(toHiragana("コーヒー"), "こーひー");
  const hira = kanaList("hira", ["basis"]);
  assert.equal(hira.length, 46);
  assert.equal(kanaList("kata").length, 46 + 25 + 33);
  assert.ok(kanaList("kata", ["basis"]).some((k) => k.kana === "ア" && k.romaji === "a"));
  assert.equal(KANA_ROWS.length, 10);
});

test("Kana → Romaji: Yōon, kleines っ, ー, Katakana-Lehnwörter", () => {
  assert.equal(kanaToRomaji("こんにちは"), "konnichiha");
  assert.equal(kanaToRomaji("きょう"), "kyou");
  assert.equal(kanaToRomaji("がっこう"), "gakkou");
  assert.equal(kanaToRomaji("まっちゃ"), "matcha");
  assert.equal(kanaToRomaji("コーヒー"), "koohii");
  assert.equal(kanaToRomaji("パーティー"), "paatii");
});

test("Lockerer Schlüssel: Längen, Varianten, Satzzeichen, Kana ↔ Romaji gleich", () => {
  assert.equal(looseKey("こんにちは"), looseKey("Konnichiwa!"));
  assert.equal(looseKey("コーヒー"), looseKey("kōhī"));
  assert.equal(looseKey("コーヒー"), looseKey("こーひー"));
  assert.equal(looseKey("ありがとうございます。"), looseKey("arigato gozaimasu"));
  assert.equal(looseKey("しゃしん"), looseKey("syasin"));
  assert.equal(looseKey("ちず"), looseKey("tizu"));
  assert.equal(looseKey("つくえ"), looseKey("tukue"));
  assert.equal(looseKey("ふね"), looseKey("hune"));
  assert.equal(looseKey("しゅくだい"), looseKey("shukudai"));
  assert.equal(looseKey("きんようび"), looseKey("kin'yōbi"));
  assert.notEqual(looseKey("いぬ"), looseKey("ねこ"));
});

test("Sprechen-Vergleich: Kanji-Erkennung, Kana/Katakana, fast richtig, falsch, mehrere Alternativen", () => {
  const mizu = { kana: "みず", kanji: "水", romaji: "mizu" };
  assert.equal(compareSpeech("水", mizu).result, "ok");
  assert.equal(compareSpeech("水。", mizu).result, "ok");
  assert.equal(compareSpeech("ミズ", mizu).result, "ok");
  assert.equal(compareSpeech(["見ず嫌い", "みず"], mizu).result, "ok");
  const ari = { kana: "ありがとうございます", romaji: "arigatō gozaimasu" };
  assert.equal(compareSpeech("ありがとうございます!", ari).result, "ok");
  assert.equal(compareSpeech("ありがとございます", ari).result, "ok"); // Länge egal
  const close = compareSpeech("ありがとうござます", ari);
  assert.equal(close.result, "close"); assert.ok(close.score >= 0.75 && close.score < 1);
  const w = compareSpeech("さようなら", ari);
  assert.equal(w.result, "wrong");
  assert.equal(compareSpeech("", ari).result, "wrong");
  assert.equal(compareSpeech([], ari).best, "");
});

test("Romaji für einzelne Kana: Varianten erlaubt, sonst streng", () => {
  assert.ok(checkRomaji("shi", "SHI"));
  assert.ok(checkRomaji("shi", "si"));
  assert.ok(checkRomaji("tsu", " tu "));
  assert.ok(checkRomaji("n", "nn"));
  assert.ok(!checkRomaji("shi", "chi"));
  assert.ok(!checkRomaji("ka", ""));
});

test("Kana-Quiz: Anzahl, 4 eindeutige Optionen inkl. Lösung, keine gleich klingenden Distraktoren, deterministisch", () => {
  const pool = kanaList("hira");
  const a = makeKanaQuiz(pool, { dir: "k2r", count: 30, rand: rng(42) });
  const b = makeKanaQuiz(pool, { dir: "k2r", count: 30, rand: rng(42) });
  assert.deepEqual(a, b);
  assert.equal(a.length, 30);
  for (const q of a) {
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.includes(q.answer));
    assert.equal(q.prompt, q.kana);
  }
  for (let i = 1; i < a.length; i++) assert.notEqual(a[i].kana, a[i - 1].kana, "nie zweimal hintereinander");
  // じ/ぢ klingen gleich → nie beide in einer Frage
  const r2k = makeKanaQuiz(kanaList("hira", ["daku"]), { dir: "r2k", count: 40, rand: rng(7) });
  for (const q of r2k) {
    assert.ok(q.options.includes(q.answer));
    if (q.romaji === "ji") assert.ok(!(q.options.includes("じ") && q.options.includes("ぢ")));
  }
  // kleine Auswahl → weniger Optionen, aber nie Duplikate
  const tiny = makeKanaQuiz([{ kana: "あ", romaji: "a" }, { kana: "い", romaji: "i" }], { count: 3, rand: rng(1) });
  assert.equal(tiny[0].options.length, 2);
  assert.deepEqual(makeKanaQuiz([], {}), []);
});

test("Kana-Quiz: Fehler (Gewichte) kommen öfter dran", () => {
  const pool = kanaList("hira", ["basis"]);
  const qs = makeKanaQuiz(pool, { count: 460, rand: rng(3), weights: { "ぬ": 4 } });
  const n = qs.filter((q) => q.kana === "ぬ").length;
  const m = qs.filter((q) => q.kana === "め").length;
  assert.ok(n > m * 2, `ぬ ${n}× vs め ${m}×`);
});

test("Bedeutungs-Auswahl: Lösung enthalten, eindeutig, 4 Stück", () => {
  const it = VOCAB.find((v) => v.kana === "みず");
  const ch = meaningChoices(it, VOCAB, { rand: rng(5) });
  assert.equal(ch.length, 4); assert.equal(new Set(ch).size, 4); assert.ok(ch.includes("Wasser"));
});

test("Statistik: Tagesziel-Zähler, Serie 🔥 bis heute bzw. gestern, Begrenzung", () => {
  let s = bump(null, "2026-11-05", "fresh");
  s = bump(s, "2026-11-05", "n", 1, true);
  s = bump(s, "2026-11-06", "kana", 3);
  assert.equal(todayCount(s, "2026-11-06"), 3);
  assert.equal(s.days["2026-11-05"].ok, 1);
  assert.equal(streak(s, "2026-11-06"), 2);
  assert.equal(streak(s, "2026-11-07"), 2, "heute noch nichts → Serie bleibt bis gestern");
  assert.equal(streak(s, "2026-11-08"), 0);
  let big = null;
  for (let i = 0; i < 420; i++) big = bump(big, addDays("2025-01-01", i), "n");
  assert.equal(Object.keys(big.days).length, 400);
});

test("Inhalte: ~600 Wörter mit Kana/Romaji/Deutsch, eindeutige IDs, Lesetexte vollständig", () => {
  assert.ok(VOCAB.length >= 580 && VOCAB.length <= 720, `Wörter: ${VOCAB.length}`);
  assert.equal(new Set(VOCAB.map((v) => v.id)).size, VOCAB.length);
  for (const v of VOCAB) {
    assert.ok(v.kana && v.romaji && v.de, v.id);
    assert.match(v.kana, /^[぀-ヿー]+$/, v.kana);
  }
  assert.ok(TOPIC_LIST.some((t) => /Arbeit/.test(t.topic)));
  // Kana und Romaji passen grob zusammen
  for (const v of VOCAB) {
    const k = looseKey(v.kana), r = looseKey(v.romaji);
    assert.ok(k === r || 1 - (lev(k, r) / Math.max(k.length, r.length)) >= 0.7, `${v.kana} ≠ ${v.romaji} (${k}/${r})`);
  }
  for (const r of READINGS) for (const l of r.lines) assert.ok(l.ja.length && l.ro && l.de, r.id);
});
import { lev } from "../js/alltag/jp-core.js";
