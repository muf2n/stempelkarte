// node --test test/lap-core.test.mjs
// Alltag › LAP Elektrotechnik: Formeln, Rechenaufgaben, Antwortprüfung, Prüfung, Schwächen, Inhalte, SRS-Wiederverwendung.
import test from "node:test";
import assert from "node:assert/strict";
import {
  fmt, fmtAuto, parseNum, checkAnswer, solveOhm, solvePUI, solvePI2R, wireR, seriesR, parallelR, voltageDrop, energyCost, power3,
  PROBLEM_TYPES, makeProblem, buildExam, scoreExam, examVerdict, topicStats, weakTopics, explainPrompt, EXAM_SIZE, PASS_PCT,
} from "../js/alltag/lap-core.js";
import { CARDS, TOPICS, FORMULAS, NORM_NOTE } from "../js/alltag/lap-data.js";
import * as srs from "../js/alltag/srs-core.js";
import * as jp from "../js/alltag/jp-core.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("Zahlen: deutsch formatieren und einlesen", () => {
  assert.equal(fmt(1.5), "1,5");
  assert.equal(fmt(2.0), "2");
  assert.equal(fmt(-0.0001), "0");
  assert.equal(fmtAuto(0.01234), "0,0123");
  assert.equal(fmtAuto(1234.56), "1234,6");
  assert.equal(parseNum("1,5"), 1.5);
  assert.equal(parseNum(" 2.25 A"), 2.25);
  assert.equal(parseNum("-0,5Ω"), -0.5);
  assert.equal(parseNum(",5"), 0.5);
  assert.ok(Number.isNaN(parseNum("abc")));
  assert.ok(Number.isNaN(parseNum("")));
});

test("Antwort mit Toleranz prüfen", () => {
  assert.equal(checkAnswer("8,7", 8.6957).ok, true);
  assert.equal(checkAnswer("8,5", 8.6957).ok, false);
  assert.equal(checkAnswer("5 A", 5).ok, true);
  assert.equal(checkAnswer("", 5).empty, true);
  assert.equal(checkAnswer("x", 5).ok, false);
  assert.equal(checkAnswer(0.0, 0).ok, true);
});

test("Rechner: U = R · I, P = U · I, P = I² · R lösen jeweils die fehlende Größe", () => {
  assert.deepEqual(solveOhm({ U: 230, R: 46 }), { U: 230, R: 46, I: 5, solved: "I" });
  assert.equal(solveOhm({ R: 10, I: 2 }).U, 20);
  assert.equal(solveOhm({ U: "12", I: "0,5" }).R, 24);
  assert.equal(solveOhm({ U: 230 }), null, "nur ein Wert");
  assert.equal(solveOhm({ U: 1, R: 2, I: 3 }), null, "drei Werte");
  assert.equal(solvePUI({ U: 230, I: 10 }).P, 2300);
  near(solvePUI({ P: 2000, U: 230 }).I, 8.695652, 1e-5);
  assert.equal(solvePUI({ P: 920, I: 4 }).U, 230);
  assert.equal(solvePI2R({ I: 2, R: 10 }).P, 40);
  assert.equal(solvePI2R({ P: 40, R: 10 }).I, 2);
  assert.equal(solvePI2R({ P: 40, I: 2 }).R, 10);
});

test("Rechner: Leitungswiderstand, Reihe/Parallel", () => {
  near(wireR({ l: 28, A: 1.5, kappa: 56 }), 1 / 3);
  near(wireR({ l: 28, A: 1.5, kappa: 56, twoWay: true }), 2 / 3);
  assert.equal(wireR({ l: 0, A: 1.5 }), null);
  assert.equal(seriesR([10, 20, 30]), 60);
  assert.equal(seriesR(["10", "", "5"]), 15);
  assert.equal(parallelR([100, 100]), 50);
  near(parallelR([30, 60]), 20);
  assert.equal(parallelR([10, 0]), null);
  assert.equal(seriesR([]), null);
});

test("Rechner: Spannungsfall 1-/3-phasig in V und %", () => {
  // 2 · 20 m · 10 A · 1 / (56 · 1,5) = 4,7619 V → 2,07 %
  const r1 = voltageDrop({ phases: 1, l: 20, I: 10, A: 1.5, kappa: 56 });
  near(r1.dU, 400 / 84, 1e-9);
  near(r1.pct, (400 / 84) / 230 * 100, 1e-9);
  assert.equal(r1.U, 230);
  const r3 = voltageDrop({ phases: 3, l: 50, I: 16, A: 4, kappa: 56, cosphi: 0.85 });
  near(r3.dU, Math.sqrt(3) * 50 * 16 * 0.85 / (56 * 4), 1e-9);
  assert.equal(r3.U, 400);
  assert.equal(voltageDrop({ phases: 1, l: 20, I: 10, A: 1.5, cosphi: 1.2 }), null);
});

test("Rechner: Energie/Kosten, Drehstromleistung", () => {
  const e = energyCost({ P: 2000, h: 3, priceCt: 30 });
  near(e.kWh, 6); near(e.euro, 1.8);
  near(energyCost({ P: 100, h: 5, days: 30, priceCt: 25 }).euro, 3.75);
  assert.equal(energyCost({ P: 100, h: 1 }).euro, null);
  near(power3({ U: 400, I: 10, cosphi: 0.85 }), Math.sqrt(3) * 4000 * 0.85);
});

test("Rechenaufgaben: jede Art erzeugt lösbare Aufgaben mit Lösungsweg, Ergebnis passt zur Formel", () => {
  const rand = srs.rng(42);
  for (const { id } of PROBLEM_TYPES) {
    for (let i = 0; i < 25; i++) {
      const p = makeProblem(id, rand);
      assert.equal(p.type, id);
      assert.ok(Number.isFinite(p.answer) && p.answer > 0, `${id}: Ergebnis ${p.answer}`);
      assert.ok(p.text.length > 20 && p.unit && p.steps.length >= 3, `${id}: Text/Einheit/Schritte`);
      assert.match(p.steps[0], /^Gesucht/);
      assert.match(p.steps.at(-1), /Ergebnis/);
      // gerundeter Wert aus dem Lösungsweg wird als richtig akzeptiert
      assert.equal(checkAnswer(fmtAuto(p.answer), p.answer, p.tol).ok, true, `${id}: gerundete Lösung ok`);
      assert.equal(checkAnswer(String(p.answer * 1.2), p.answer, p.tol).ok, false, `${id}: 20 % daneben ist falsch`);
    }
  }
  // stichprobenartig nachrechnen
  const r = srs.rng(7);
  for (let i = 0; i < 40; i++) {
    const p = makeProblem("ohm", r);
    const nums = [...p.text.matchAll(/(\d+(?:,\d+)?) (Ω|V|A)/g)].map((m) => [parseNum(m[1]), m[2]]);
    const v = Object.fromEntries(nums.map(([n, unit]) => [unit === "Ω" ? "R" : unit === "V" ? "U" : "I", n]));
    const s = solveOhm(v);
    assert.equal(checkAnswer(s[p.ask], p.answer, 0.02).ok, true, p.text);
  }
  assert.ok(PROBLEM_TYPES.some((t) => t.id === makeProblem("gemischt", srs.rng(1)).type), "unbekannt → zufällige Art");
});

test("Inhalte: ~200 Karten, alle Themen, eindeutige IDs, 3 eindeutige Falschantworten, Normhinweis-Themen", () => {
  assert.ok(CARDS.length >= 190 && CARDS.length <= 230, `Anzahl ${CARDS.length}`);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, CARDS.length);
  for (const t of TOPICS) assert.ok(CARDS.filter((c) => c.topic === t.id).length >= 20, `Thema ${t.id}`);
  for (const c of CARDS) {
    assert.ok(TOPICS.some((t) => t.id === c.topic), c.id);
    assert.ok(c.q.endsWith("?") || c.q.endsWith("…") || c.q.endsWith("= ?"), `${c.id}: Frage endet mit ?`);
    assert.equal(c.x.length, 3, `${c.id}: 3 Falschantworten`);
    assert.equal(new Set([c.a, ...c.x]).size, 4, `${c.id}: Antworten eindeutig`);
  }
  assert.deepEqual(TOPICS.filter((t) => t.norm).map((t) => t.id).sort(), ["inst", "leit", "mess", "schutz"]);
  assert.match(NORM_NOTE, /Berufsschule/);
  // 5 Sicherheitsregeln in richtiger Reihenfolge
  const rules = CARDS.filter((c) => c.topic === "sich").slice(0, 5).map((c) => c.a);
  assert.deepEqual(rules.map((r) => r.split(" ")[0]), ["Freischalten", "Gegen", "Spannungsfreiheit", "Erden", "Benachbarte,"]);
  // Formelsammlung: alle Rechner-Schlüssel bekannt
  const calcs = new Set(["ohm", "pui", "pi2r", "energy", "series", "parallel", "wire", "wire2", "du1", "du3", "p3"]);
  for (const f of FORMULAS) if (f.calc) assert.ok(calcs.has(f.calc), f.id);
  assert.ok(FORMULAS.length >= 20);
});

test("Prüfung: 20 Fragen, gemischte Themen, keine Doppelten, Auswertung inkl. Themen und Fehlern", () => {
  const rand = srs.rng(3);
  const ex = buildExam(CARDS, { rand });
  assert.equal(ex.length, EXAM_SIZE);
  assert.equal(new Set(ex.map((q) => q.id)).size, EXAM_SIZE);
  const topics = new Set(ex.map((q) => q.topic));
  assert.equal(topics.size, TOPICS.length, "alle 8 Themen vertreten");
  for (const q of ex) { assert.equal(q.options.length, 4); assert.ok(q.options.includes(q.a)); }
  const answers = {};
  ex.forEach((q, i) => { answers[q.id] = i < 15 ? q.a : q.options.find((o) => o !== q.a); });
  delete answers[ex[19].id]; // unbeantwortet = falsch
  const s = scoreExam(ex, answers);
  assert.equal(s.right, 15); assert.equal(s.n, 20); assert.equal(s.pct, 75); assert.equal(s.passed, true);
  assert.equal(s.wrong.length, 5);
  assert.equal(s.wrong.find((w) => w.id === ex[19].id).picked, null);
  assert.equal(Object.values(s.byTopic).reduce((a, b) => a + b.n, 0), 20);
  assert.equal(scoreExam(ex, {}).pct, 0);
  assert.equal(scoreExam([], {}).pct, 0);
  assert.ok(PASS_PCT > 0 && /Geschafft/.test(examVerdict(PASS_PCT)));
  // nur gewählte Themen, kleiner Pool
  const only = buildExam(CARDS, { rand, topics: ["sich"], n: 50 });
  assert.equal(only.length, CARDS.filter((c) => c.topic === "sich").length);
  assert.ok(only.every((q) => q.topic === "sich"));
  // Gewichte: schwaches Thema kommt öfter dran
  const w = buildExam(CARDS, { rand: srs.rng(9), weights: { schutz: 3 } });
  assert.ok(w.filter((q) => q.topic === "schutz").length > w.filter((q) => q.topic === "grund").length);
});

test("Schwächen: Quote je Thema aus SRS und Prüfungen", () => {
  const cards = [
    { id: "schutz-01", seen: 4, lapses: 3 }, { id: "schutz-02", seen: 2, lapses: 1 },
    { id: "grund-01", seen: 5, lapses: 0 }, { id: "mess-01", seen: 1, lapses: 1 }, { id: "ac-01", seen: 0 },
  ];
  const exams = [{ byTopic: { schutz: { n: 2, ok: 0 }, grund: { n: 3, ok: 3 } } }];
  const st = topicStats(cards, exams);
  assert.equal(st[0].topic, "mess", "schwächstes zuerst");
  const sch = st.find((x) => x.topic === "schutz");
  assert.equal(sch.n, 8); assert.equal(sch.ok, 2);
  assert.equal(st.at(-1).topic, "grund");
  assert.ok(!st.some((s) => s.topic === "ac"), "ungesehen zählt nicht");
  assert.deepEqual(weakTopics(cards, exams), ["schutz"], "mess hat zu wenig Versuche");
  assert.deepEqual(weakTopics([], []), []);
  // Prüfungsfehler, die ins SRS übernommen wurden (ex), zählen nicht doppelt
  const fromExam = [{ id: "ac-01", seen: 1, lapses: 1, ex: 1 }, { id: "ac-02", seen: 1, lapses: 1, ex: 1 }];
  const st2 = topicStats(fromExam, [{ byTopic: { ac: { n: 2, ok: 0 } } }]);
  assert.equal(st2.find((x) => x.topic === "ac").n, 2);
  assert.deepEqual(weakTopics(fromExam, [{ byTopic: { ac: { n: 2, ok: 0 } } }]), []);
});

test("Erklär-Prompt enthält Frage, Lösung und falsche Antwort", () => {
  const p = explainPrompt({ topic: "Schutzmaßnahmen", q: "Was ist ein FI?", a: "Ein RCD", picked: "Ein LS" });
  assert.match(p, /Schutzmaßnahmen/); assert.match(p, /Was ist ein FI\?/); assert.match(p, /Richtige Antwort: Ein RCD/); assert.match(p, /Ich hatte geantwortet: Ein LS/);
  assert.doesNotMatch(explainPrompt({ topic: "x", q: "q", a: "a", picked: "a" }), /hatte geantwortet/);
});

test("SRS wird wiederverwendet: srs-core und jp-core liefern dieselben Funktionen", () => {
  assert.equal(jp.review, srs.review);
  assert.equal(jp.streak, srs.streak);
  assert.equal(jp.buildQueue, srs.buildQueue);
  const T = "2026-11-07";
  let c = srs.review(null, 4, T);
  assert.equal(c.reps, 1); assert.equal(c.due, "2026-11-08");
  c = srs.review(c, 1, "2026-11-08");
  assert.equal(c.reps, 0); assert.equal(c.lapses, 1);
  const LAP_DEF = { id: "me", goal: 15, newPerDay: 8, days: {} };
  let s = srs.bump(null, T, "cards", 1, true, LAP_DEF);
  assert.equal(s.goal, 15); assert.equal(s.days[T].n, 1); assert.equal(s.days[T].ok, 1);
  s = srs.bump(s, srs.addDays(T, -1), "calc", 1, null, LAP_DEF);
  assert.equal(srs.streak(s, T), 2);
  assert.equal(jp.bump(null, T, "kana").goal, 20, "Japanisch behält seine Standardwerte");
  const q = srs.buildQueue(CARDS.slice(0, 30), new Map([["grund-01", { seen: 1, due: T }]]), T, { newLimit: 10 });
  assert.equal(q.due.length, 1); assert.equal(q.fresh.length, 10);
});
