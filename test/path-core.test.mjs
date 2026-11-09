// node --test test/path-core.test.mjs
// Update 10 – 🛤️ Lernpfad (Japanisch + LAP): Einheiten, Freischalten, 🔋 Energie, XP/Edelsteine/Serien-Schutz, Lektionen, Fehler-Wiederholung.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/alltag/path-core.js";
import { KANA_GROUPS, VOCAB } from "../js/alltag/jp-data.js";
import { toKatakana } from "../js/alltag/jp-core.js";
import { CARDS, TOPICS, FORMULAS } from "../js/alltag/lap-data.js";
import { PROBLEM_TYPES, makeProblem } from "../js/alltag/lap-core.js";

const JU = P.jpUnits({ groups: KANA_GROUPS, vocab: VOCAB, toKata: toKatakana });
const lap = (year) => P.lapUnits({ cards: CARDS, topics: TOPICS, problemTypes: PROBLEM_TYPES, year, formulas: FORMULAS });
const T = "2026-11-07";

test("JP-Einheiten: Hiragana → Katakana → Wortschatz, eindeutige IDs, Kiste + Prüfung", () => {
  assert.ok(JU.length >= 9);
  const segs = [...new Set(JU.map((u) => u.seg))];
  assert.equal(segs.length, 3);
  assert.match(segs[0], /Hiragana/); assert.match(segs[1], /Katakana/);
  assert.match(JU[0].title, /Grundreihe/);
  assert.ok(JU.findIndex((u) => /Dakuten/.test(u.title)) < JU.findIndex((u) => /Yōon/.test(u.title)));
  const ids = P.allNodes(JU).map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const u of JU) {
    assert.equal(u.nodes.at(-1).type, "check");
    assert.ok(u.nodes.some((n) => n.type === "lesson"));
  }
  assert.ok(P.allNodes(JU).some((n) => n.type === "chest"));
  // Katakana-Einheit enthält wirklich Katakana
  const kata = JU.find((u) => u.tag === "kata");
  assert.ok(kata.items.some((it) => /[゠-ヿ]/.test(it.kana)));
});

test("LAP-Einheiten: nur gewähltes Lehrjahr, ~8 Karten je Lektion, Rechen-Lektionen eingeflochten", () => {
  for (const y of [1, 2, 3]) {
    const us = lap(y);
    assert.ok(us.length > 0, "Lehrjahr " + y);
    assert.ok(us.every((u) => u.year === y));
    for (const n of P.allNodes(us)) if (n.kind === "cards") { assert.ok(n.items.length <= 8 && n.items.length >= 1); assert.ok(n.items.every((c) => (Number(c.year) || 1) === y)); }
  }
  const u1 = lap(1)[0];
  const kinds = u1.nodes.map((n) => n.kind || n.type);
  assert.ok(kinds.includes("calc"));
  assert.ok(kinds.indexOf("calc") > 0 && kinds.indexOf("calc") < kinds.lastIndexOf("cards"), "Rechnen zwischen den Karten");
  // alle Lehrjahre: Abschnitte 1 → 2 → 3
  assert.deepEqual([...new Set(lap(0).map((u) => u.year))], [1, 2, 3]);
});

test("Freischalten: erster Knoten current, Rest gesperrt, Prüfung zum Überspringen, nach Abschluss weiter", () => {
  const nodes = P.allNodes(JU);
  let st = P.nodeStates(JU, {});
  assert.equal(st[nodes[0].id], "current");
  assert.equal(st[nodes[1].id], "locked");
  assert.equal(st[JU[0].nodes.at(-1).id], "jump");
  assert.equal(st[JU[1].nodes.at(-1).id], "locked");
  // Katakana-Abschnitt startet frei
  const k0 = JU.find((u) => u.tag === "kata").nodes[0];
  assert.equal(st[k0.id], "open");
  st = P.nodeStates(JU, { nodes: { [nodes[0].id]: { c: 1 } } });
  assert.equal(st[nodes[0].id], "done");
  assert.equal(st[nodes[1].id], "current");
  assert.equal(P.currentNode(JU, { nodes: { [nodes[0].id]: { c: 1 } } }).id, nodes[1].id);
  // Einheit überspringen via Prüfung
  const r = P.applyLesson({ id: "jp" }, {}, { node: JU[0].nodes.at(-1), unit: JU[0], rewards: P.lessonRewards({ kind: "check" }), day: T, jump: true });
  assert.ok(P.unitProgress(JU[0], r.mod).complete);
  assert.equal(P.nodeStates(JU, r.mod)[JU[1].nodes[0].id], "current");
});

test("Lektion deterministisch mit Seed, 10–12 Übungen, JP ohne Sprechen wenn nicht verfügbar", () => {
  const n = JU[0].nodes[0];
  const a = P.buildLesson(n, { module: "jp", seed: 42, canListen: true, canSpeak: false });
  const b = P.buildLesson(n, { module: "jp", seed: 42, canListen: true, canSpeak: false });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, P.buildLesson(n, { module: "jp", seed: 43, canListen: true, canSpeak: false }));
  assert.ok(a.length >= 10 && a.length <= 12);
  const vocabNode = P.allNodes(JU).find((x) => x.type === "lesson" && x.kind === "vocab");
  for (let s = 1; s < 30; s++) {
    const ex = P.buildLesson(vocabNode, { module: "jp", seed: s, canListen: false, canSpeak: false });
    assert.ok(!ex.some((e) => e.type === "speak" || e.mode === "listen"));
  }
  for (const e of a) if (e.type === "mc") { assert.ok(e.options.includes(e.answer)); assert.equal(new Set(e.options).size, e.options.length); }
});

test("LAP-Lektion: MC aus Karten, Richtig/Falsch nur aus Kartenfakten, Rechnen mit Zahlen-Eingabe", () => {
  const us = lap(1);
  const cardNode = us[0].nodes[0];
  const byId = new Map(CARDS.map((c) => [c.id, c]));
  for (let s = 1; s < 20; s++) {
    const ex = P.buildLesson(cardNode, { module: "lap", seed: s, makeProblem, formulas: FORMULAS });
    assert.ok(ex.length >= 10 && ex.length <= 12);
    for (const e of ex.filter((x) => x.type === "tf")) {
      const c = byId.get(e.ref);
      assert.ok(c, "tf hat Karte");
      assert.ok([c.a, ...c.x].includes(e.claim), "Behauptung stammt aus der Karte");
      assert.equal(e.answer, e.claim === c.a);
    }
    for (const e of ex.filter((x) => x.type === "mc" && x.kind === "card")) assert.ok(e.options.includes(e.answer));
  }
  const calcNode = P.allNodes(us).find((n) => n.kind === "calc");
  const ce = P.buildLesson(calcNode, { module: "lap", seed: 3, makeProblem, formulas: FORMULAS });
  const num = ce.filter((e) => e.type === "num");
  assert.ok(num.length >= 3);
  for (const e of num) { assert.ok(Number.isFinite(e.answer)); assert.ok(e.unit); }
  assert.deepEqual(ce, P.buildLesson(calcNode, { module: "lap", seed: 3, makeProblem, formulas: FORMULAS }));
});

test("Ablauf: Fehler kommen am Ende nochmal (max. 2×), SRS-Refs, Fortschritt & Genauigkeit", () => {
  const exs = [{ type: "mc", ref: "a", answer: "x", options: ["x"] }, { type: "mc", ref: "b", answer: "y", options: ["y"] }];
  let r = P.startRun(exs);
  r = P.nextRun(P.answerRun(r, false)); // a falsch → hinten dran
  assert.equal(r.queue.length, 3);
  assert.equal(r.queue[2].ref, "a");
  assert.equal(P.runProgress(r), 0);
  r = P.nextRun(P.answerRun(r, true)); // b
  assert.equal(P.runProgress(r), 0.5);
  r = P.nextRun(P.answerRun(r, false)); // a nochmal falsch → 2. Wiederholung
  assert.equal(r.queue.length, 4);
  r = P.answerRun(r, false); // 3. Mal falsch → aufgeben
  assert.equal(r.queue.length, 4);
  r = P.nextRun(r);
  assert.ok(P.runDone(r));
  assert.equal(P.runProgress(r), 1);
  assert.deepEqual(r.refs, { a: false, b: true });
  assert.equal(r.mistakes, 3);
  assert.equal(P.runAccuracy(r), 25);
  // Combo
  let c = P.startRun([1, 2, 3].map((i) => ({ type: "mc", ref: "r" + i })));
  for (let i = 0; i < 3; i++) c = P.nextRun(P.answerRun(c, true));
  assert.equal(c.maxCombo, 3);
});

test("🔋 Energie: richtig −1, falsch −2, nie unter 0, +1 je 30 min", () => {
  const t0 = new Date(2026, 10, 9, 10, 0).getTime();
  const D = "2026-11-09";
  assert.equal(P.MAX_ENERGY, 25);
  let r = P.spendEnergy({ n: 25, at: 0, day: D }, { correct: true, combo: 1 }, t0);
  assert.deepEqual(r.energy, { n: 24, at: t0, day: D }); assert.equal(r.cost, 1);
  r = P.spendEnergy(r.energy, { correct: false }, t0);
  assert.equal(r.energy.n, 22); assert.equal(r.cost, 2);
  assert.equal(r.energy.at, t0, "Ladeuhr läuft ab der ersten Ausgabe weiter");
  assert.equal(P.spendEnergy({ n: 1, at: t0, day: D }, { correct: false }, t0).energy.n, 0, "nie unter 0");
  assert.equal(P.spendEnergy({ n: 0, at: t0, day: D }, { correct: true }, t0).cost, 0);
  // Nachladen
  const e = { n: 10, at: t0, day: D };
  assert.equal(P.energyNow(e, t0 + 10 * 60e3).nextIn, 20 * 60e3);
  assert.equal(P.energyNow(e, t0 + P.REFILL_MS).n, 11);
  assert.equal(P.energyNow(e, t0 + 2.5 * P.REFILL_MS).n, 12);
  assert.equal(P.energyNow(e, t0 + 2.5 * P.REFILL_MS).nextIn, P.REFILL_MS / 2);
  assert.equal(P.energyNow({ n: 24, at: t0, day: D }, t0 + 3 * P.REFILL_MS).n, 25, "nie über voll");
  assert.equal(P.energyNow({ n: 24, at: t0, day: D }, t0 + 3 * P.REFILL_MS).nextIn, 0);
  assert.equal(P.REFILL_MS, 30 * 60e3);
});

test("🔋 Combo-Bonus: alle 5 richtigen in Folge +2, nie über voll, kein Bonus bei 0", () => {
  const t0 = new Date(2026, 10, 9, 10, 0).getTime();
  const D = "2026-11-09";
  let r = P.spendEnergy({ n: 10, at: t0, day: D }, { correct: true, combo: 5 }, t0);
  assert.equal(r.bonus, 2); assert.equal(r.energy.n, 11);
  assert.equal(P.spendEnergy({ n: 10, at: t0, day: D }, { correct: true, combo: 4 }, t0).bonus, 0);
  assert.equal(P.spendEnergy({ n: 10, at: t0, day: D }, { correct: true, combo: 10 }, t0).bonus, 2);
  assert.equal(P.spendEnergy({ n: 10, at: t0, day: D }, { correct: false, combo: 0 }, t0).bonus, 0);
  r = P.spendEnergy({ n: 25, at: 0, day: D }, { correct: true, combo: 5 }, t0);
  assert.equal(r.energy.n, 25); assert.equal(r.bonus, 1, "nur bis voll");
  r = P.spendEnergy({ n: 1, at: t0, day: D }, { correct: true, combo: 5 }, t0);
  assert.equal(r.energy.n, 0); assert.equal(r.bonus, 0, "leer → kein Bonus");
  // Ablauf mit startRun/answerRun: combo nach der Antwort
  let run = P.startRun([1, 2, 3, 4, 5].map((i) => ({ type: "mc", ref: "r" + i })));
  let en = { n: 20, at: t0, day: D }, bonus = 0;
  for (let i = 0; i < 5; i++) { run = P.answerRun(run, true); const x = P.spendEnergy(en, { correct: true, combo: run.combo }, t0); en = x.energy; bonus += x.bonus; run = P.nextRun(run); }
  assert.equal(bonus, 2); assert.equal(en.n, 17);
});

test("🔋 Tages-Auffüllung, Start ab 5, Schatzkiste, 💎 Auffüllen, Üben, Umstieg von ❤️", () => {
  const t0 = new Date(2026, 10, 9, 10, 0).getTime();
  const tomorrow = new Date(2026, 10, 10, 7, 0).getTime();
  const D = "2026-11-09";
  // neuer Tag → gratis voll
  const low = { n: 3, at: t0, day: D };
  assert.equal(P.energyNow(low, tomorrow).n, 25);
  assert.equal(P.energyNow(low, tomorrow).fresh, true);
  const dr = P.dailyRefill({ energy: low }, tomorrow);
  assert.ok(dr.refilled); assert.deepEqual(dr.me.energy, { n: 25, at: 0, day: "2026-11-10" });
  assert.equal(P.dailyRefill(dr.me, tomorrow + 60e3).refilled, false, "nur einmal am Tag");
  assert.equal(P.dailyRefill({ energy: { n: 25, at: 0, day: D } }, tomorrow).refilled, false, "war schon voll → kein Hinweis");
  // Start-Schwelle
  assert.equal(P.ENERGY_START, 5);
  assert.equal(P.canStart({ n: 4, at: t0, day: D }, t0), false);
  assert.equal(P.canStart({ n: 5, at: t0, day: D }, t0), true);
  assert.equal(P.canStart({ n: 4, at: t0, day: D }, t0 + P.REFILL_MS), true, "nach 30 min wieder genug");
  // Schatzkiste: +5 🔋 (nur unter 20) zusätzlich zu den 💎
  const chest = JU[0].nodes.find((x) => x.type === "chest");
  let k = P.openChest({ id: "jp" }, { energy: { n: 8, at: t0, day: D } }, chest, D, t0);
  assert.equal(k.gems, P.GEMS.chest); assert.equal(k.energy, 5); assert.equal(k.me.energy.n, 13);
  k = P.openChest({ id: "jp" }, { energy: { n: 20, at: t0, day: D } }, chest, D, t0);
  assert.equal(k.energy, 0); assert.equal(k.me.energy.n, 20);
  // 💎 Auffüllen
  assert.equal(P.ENERGY_GEMS, 300);
  assert.equal(P.buyEnergy({ gems: 400, energy: { n: 25, at: 0, day: D } }, t0).why, "full");
  assert.equal(P.buyEnergy({ gems: 299, energy: { n: 2, at: t0, day: D } }, t0).why, "gems");
  const be = P.buyEnergy({ gems: 400, energy: { n: 2, at: t0, day: D } }, t0);
  assert.ok(be.ok); assert.equal(be.me.gems, 100); assert.equal(be.me.energy.n, 25);
  // 🏋️ Üben: +1 je richtiger Antwort, höchstens +5 pro Runde, nie über voll
  let en = { n: 0, at: t0, day: D }, gained = 0;
  for (let i = 0; i < 8; i++) { const g = P.practiceGain(en, gained, t0); en = g.energy; gained += g.add; }
  assert.equal(gained, P.PRACTICE_ENERGY_MAX); assert.equal(en.n, 5);
  assert.equal(P.practiceGain({ n: 25, at: 0, day: D }, 0, t0).add, 0);
  // Umstieg: altes me.hearts → volle Energie, hearts verschwindet
  const m = P.readMe({ id: "me", gems: 7, hearts: { n: 0, at: t0 } });
  assert.equal(m.hearts, undefined); assert.equal(m.gems, 7);
  assert.equal(P.energyNow(m.energy, t0).n, 25);
  assert.equal(P.readMe({ energy: { n: 9, at: t0, day: D } }).energy.n, 9, "vorhandene Energie bleibt");
});

test("XP, 💎 Edelsteine, Kronen, Schatzkiste, Laden", () => {
  const r0 = P.lessonRewards({ mistakes: 2, maxCombo: 3 });
  assert.equal(r0.xp, P.XP.lesson);
  const r1 = P.lessonRewards({ mistakes: 0, maxCombo: 10 });
  assert.equal(r1.xp, P.XP.lesson + P.XP.perfect + 4);
  assert.ok(r1.perfect && r1.gems > r0.gems);
  const n = JU[0].nodes[0];
  let a = P.applyLesson({ id: "jp" }, {}, { node: n, rewards: r0, ok: 8, day: T });
  assert.equal(a.crown, 1); assert.ok(a.first);
  assert.equal(a.mod.xp[T], 10); assert.equal(a.me.lessons, 1); assert.equal(a.me.ok, 8); assert.equal(a.me.last, "jp");
  a = P.applyLesson(a.mod, a.me, { node: n, rewards: r1, day: T });
  assert.equal(a.crown, 2);
  a = P.applyLesson(a.mod, a.me, { node: n, rewards: r1, day: T });
  a = P.applyLesson(a.mod, a.me, { node: n, rewards: r1, day: T });
  assert.equal(a.crown, 3, "höchstens 3 Kronen");
  const chest = JU[0].nodes.find((x) => x.type === "chest");
  const k = P.openChest(a.mod, a.me, chest, T);
  assert.equal(k.gems, P.GEMS.chest);
  assert.equal(P.openChest(k.mod, k.me, chest, T).gems, 0, "nur einmal");
  // Laden
  assert.equal(P.buyFreeze({ gems: 199 }).ok, false);
  const f = P.buyFreeze({ gems: 250 });
  assert.ok(f.ok); assert.equal(f.me.gems, 50); assert.equal(f.me.freezes, 1);
  assert.equal(P.buyFreeze({ gems: 999, freezes: P.MAX_FREEZES }).why, "max");
});

test("🔥 Serie über beide Module + klassische Übungen, 🧊 Serien-Schutz", () => {
  const mods = [{ id: "jp", xp: { "2026-11-05": 10 } }, { id: "lap", xp: { "2026-11-04": 20 } }];
  const stats = [{ days: { "2026-11-06": { n: 3 } } }];
  assert.equal(P.learnStreak({ mods, stats }, T), 3);
  assert.equal(P.activeToday({ mods, stats }, T), false);
  // Lücke gestern + vorgestern: zwei Schutz-Tage nötig
  const src = { mods: [{ id: "jp", xp: { "2026-11-04": 10 } }], stats: [], me: { freezes: 2 } };
  assert.equal(P.learnStreak(src, T), 0);
  const fr = P.applyFreezes(src, T);
  assert.equal(fr.used, 2); assert.equal(fr.me.freezes, 0);
  assert.equal(P.learnStreak({ ...src, me: fr.me }, T), 3);
  assert.equal(P.applyFreezes({ ...src, me: { freezes: 1 } }, T).used, 0, "Lücke zu groß");
  // Wochen-XP
  const w = P.weekXp([{ xp: { [T]: 30 } }, { xp: { [T]: 5 } }], T);
  assert.equal(w.length, 7); assert.equal(w[6].xp, 35);
  assert.equal(P.goalXp("normal") > 0, true);
});

test("Abzeichen & Erinnerung ab 18:00", () => {
  assert.deepEqual(P.newAchievements({}, { lessons: 1 }), ["first"]);
  assert.deepEqual(P.newAchievements({ ach: { first: 1 } }, { lessons: 1 }), []);
  const evening = new Date(2026, 10, 7, 19, 0).getTime();
  const morning = new Date(2026, 10, 7, 9, 0).getTime();
  const docs = [{ id: "jp", xp: { "2026-11-06": 10 } }, { id: "me", last: "jp" }];
  const r = P.learnReminder({ docs, now: evening });
  assert.ok(r && /Gefahr/.test(r.title) && r.target === "#alltag/japanisch");
  assert.equal(P.learnReminder({ docs, now: morning }), null);
  assert.equal(P.learnReminder({ docs: [...docs, { id: "lap", xp: { "2026-11-07": 5 } }], now: evening }), null);
});
