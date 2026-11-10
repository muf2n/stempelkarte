// node --test test/path-core.test.mjs
// Update 10 – 🛤️ Lernpfad (Japanisch + LAP): Einheiten, Freischalten, 🔋 Energie, XP/Edelsteine/Serien-Schutz, Lektionen, Fehler-Wiederholung.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/alltag/path-core.js";
import { KANA_GROUPS, VOCAB } from "../js/alltag/jp-data.js";
import { toKatakana } from "../js/alltag/jp-core.js";
import { CARDS, TOPICS, FORMULAS } from "../js/alltag/lap-data.js";
import { PROBLEM_TYPES, makeProblem } from "../js/alltag/lap-core.js";
import { GRAMMAR, PATH_ORDER } from "../js/alltag/jp-data-grammar.js";
import { SENTENCES } from "../js/alltag/jp-data-sentences.js";

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

/* ================= Update 10c – 🔋 Prozent & Energie-Modus, 🏋️ freies Üben ================= */
test("🔋 Prozent-Anzeige: 19/25 → 76 %, Grenzen, energyView", () => {
  assert.equal(P.energyPct(19), 76); assert.equal(P.fmtEnergyPct(19), "76 %");
  assert.equal(P.energyPct(25), 100); assert.equal(P.energyPct(0), 0); assert.equal(P.energyPct(-3), 0); assert.equal(P.energyPct(99), 100);
  assert.equal(P.energyPct(1), 4);
  const t0 = new Date(2026, 10, 7, 10).getTime();
  const v = P.energyView({ energy: { n: 19, at: t0, day: T } }, t0);
  assert.deepEqual([v.inf, v.text, v.sub, v.pct, v.low], [false, "76 %", "19/25", 76, false]);
  assert.equal(P.energyView({ energy: { n: 3, at: t0, day: T } }, t0).low, true);
  const inf = P.energyView({ energyMode: "unbegrenzt", energy: { n: 3, at: t0, day: T } }, t0);
  assert.equal(inf.inf, true); assert.equal(inf.text, "∞");
});

test("🔋 Modi: Normal / Entspannt (Fehler −1, +1 je 10 min) / Unbegrenzt (kein Verbrauch, nie leer)", () => {
  const t0 = new Date(2026, 10, 7, 10).getTime();
  const e = { n: 10, at: t0, day: T };
  assert.equal(P.readMe({}).energyMode, "normal", "Standard für bestehende Nutzer: Normal");
  assert.equal(P.readMe({ energyMode: "quatsch" }).energyMode, "normal");
  assert.equal(P.modeOf({ energyMode: "entspannt" }), "entspannt");
  // Normal
  assert.equal(P.spendEnergy(e, { correct: false }, t0).cost, 2);
  // Entspannt
  let r = P.spendEnergy(e, { correct: false, mode: "entspannt" }, t0);
  assert.equal(r.cost, 1); assert.equal(r.energy.n, 9);
  assert.equal(P.energyNow({ n: 10, at: t0, day: T }, t0 + 10 * 60e3, "entspannt").n, 11, "+1 nach 10 min");
  assert.equal(P.energyNow({ n: 10, at: t0, day: T }, t0 + 10 * 60e3, "normal").n, 10, "Normal: erst nach 30 min");
  assert.equal(P.energyNow({ n: 10, at: t0, day: T }, t0 + 25 * 60e3, "entspannt").nextIn, 5 * 60e3);
  r = P.spendEnergy(e, { correct: true, combo: 5, mode: "entspannt" }, t0);
  assert.equal(r.bonus, 2, "Combo gilt auch im Entspannt-Modus");
  // Unbegrenzt
  r = P.spendEnergy({ n: 0, at: t0, day: T }, { correct: false, mode: "unbegrenzt" }, t0);
  assert.equal(r.cost, 0); assert.equal(r.bonus, 0); assert.equal(r.energy.n, 0, "gespeicherte Energie bleibt unverändert");
  r = P.spendEnergy(e, { correct: true, combo: 5, mode: "unbegrenzt" }, t0);
  assert.equal(r.bonus, 0); assert.equal(r.energy.n, 10);
  assert.equal(P.canStart({ n: 0, at: t0, day: T }, t0, "unbegrenzt"), true);
  assert.equal(P.canStart({ n: 4, at: t0, day: T }, t0, "normal"), false);
  assert.equal(P.isOut({ n: 0, at: t0, day: T }, t0, "unbegrenzt"), false, "Unbegrenzt: nie „keine Energie“");
  assert.equal(P.isOut({ n: 0, at: t0, day: T }, t0, "normal"), true);
  assert.equal(P.isOut({ n: 0, at: t0, day: T }, t0 + 10 * 60e3, "entspannt"), false, "Entspannt lädt schneller nach");
  assert.equal(P.practiceGain({ n: 3, at: t0, day: T }, 0, t0, "unbegrenzt").add, 0, "Üben lädt bei ∞ nichts (nicht nötig)");
  assert.equal(P.practiceGain({ n: 3, at: t0, day: T }, 0, t0, "entspannt").add, 1);
  // Schatzkiste & Laden im Modus Unbegrenzt
  const k = P.openChest({ id: "jp" }, { energyMode: "unbegrenzt", energy: { n: 8, at: t0, day: T } }, { id: "jp-x-k3" }, T, t0);
  assert.equal(k.energy, 0); assert.equal(k.gems, P.GEMS.chest);
  assert.equal(P.buyEnergy({ energyMode: "unbegrenzt", gems: 999, energy: { n: 1, at: t0, day: T } }, t0).why, "unlimited");
  assert.equal(P.setEnergyMode({}, "unbegrenzt").energyMode, "unbegrenzt");
  assert.equal(P.setEnergyMode({}, "xx").energyMode, "normal");
});

test("🔋 Jetzt auffüllen (gratis): Normal 1× am Tag, Entspannt jederzeit, Unbegrenzt nicht nötig", () => {
  const t0 = new Date(2026, 10, 7, 10).getTime();
  const low = { energy: { n: 4, at: t0, day: T } };
  let r = P.freeRefill(low, t0);
  assert.ok(r.ok); assert.equal(r.me.energy.n, 25); assert.equal(r.me.freeRefillDay, T);
  const used = { ...r.me, energy: { n: 2, at: t0, day: T } };
  assert.deepEqual(P.canFreeRefill(used, t0), { ok: false, why: "used" });
  assert.equal(P.freeRefill(used, t0).ok, false, "zweites Mal am selben Tag nicht");
  const next = new Date(2026, 10, 8, 10).getTime();
  assert.ok(P.freeRefill({ ...used, energy: { n: 2, at: next, day: "2026-11-08" } }, next).ok, "am nächsten Tag wieder");
  assert.equal(P.canFreeRefill({ energy: { n: 25, at: 0, day: T } }, t0).why, "full");
  const relaxed = { energyMode: "entspannt", freeRefillDay: T, energy: { n: 2, at: t0, day: T } };
  r = P.freeRefill(relaxed, t0);
  assert.ok(r.ok, "Entspannt: jederzeit"); assert.ok(P.freeRefill({ ...r.me, energy: { n: 1, at: t0, day: T } }, t0).ok);
  assert.equal(P.canFreeRefill({ energyMode: "unbegrenzt", energy: { n: 2, at: t0, day: T } }, t0).why, "unlimited");
});

const JUG = P.jpUnits({ groups: KANA_GROUPS, vocab: VOCAB, toKata: toKatakana, grammar: GRAMMAR, sentences: SENTENCES, order: PATH_ORDER });
test("🏋️ Üben – Quellen: Alles, Einheit (auch gesperrt), Thema, Meine Fehler, Zufall", () => {
  const mod = { nodes: {} };
  const st = P.nodeStates(JUG, mod);
  const locked = JUG.find((u) => u.kind === "vocab" && u.nodes.every((n) => st[n.id] === "locked")) || JUG.find((u) => u.nodes.every((n) => st[n.id] === "locked"));
  assert.ok(locked, "es gibt gesperrte Einheiten");
  const un = P.trainSource({ kind: "unit", id: locked.id }, { units: JUG });
  assert.ok(un.nodes.length >= 1 && un.nodes.every((n) => n.unit === locked.id && n.type === "lesson"), "gesperrte Einheit: ihre Lektionen");
  assert.deepEqual(new Set(P.trainItems(un.nodes).map((x) => x.id)), new Set(locked.items.filter((x) => un.nodes.some((n) => n.items.includes(x))).map((x) => x.id)));
  const all = P.trainSource({ kind: "all" }, { units: JUG });
  assert.equal(all.nodes.length, P.allNodes(JUG).filter((n) => n.type === "lesson").length, "Alles = alle Lektionen, egal ob frei");
  // Themen
  const tps = P.jpTrainTopics(JUG);
  assert.deepEqual(tps.map((g) => g.id), ["hira", "kata", "voc", "gr"]);
  const row = tps[0].items[0];
  assert.ok(row.nodes[0].items.every((x) => x.kind === "kana" && x.script === "hira"));
  const voc = tps[2].items.find((t) => t.nodes.length >= 2) || tps[2].items[0];
  const tp = P.trainSource({ kind: "topic", id: voc.id }, { units: JUG, topics: tps });
  assert.ok(P.trainItems(tp.nodes).every((x) => x.kind === "vocab" && x.topic === voc.label), "Wortschatz-Thema: nur Wörter dieses Themas");
  const gr = P.trainSource({ kind: "topic", id: tps[3].items[0].id }, { topics: tps });
  assert.ok(gr.nodes.length === 2 && gr.nodes[0].hint, "Grammatik-Punkt mit Regel 💡");
  // Fehler
  const weak = JUG[0].items.slice(0, 11);
  const wk = P.trainSource({ kind: "weak" }, { weak });
  assert.equal(wk.nodes.length, 2); assert.equal(P.trainItems(wk.nodes).length, 11);
  assert.equal(P.trainSource({ kind: "weak" }, { weak: [] }).nodes.length, 0);
  // Zufall: genau eine Einheit, deterministisch
  const z1 = P.trainSource({ kind: "random" }, { units: JUG, seed: 7 }), z2 = P.trainSource({ kind: "random" }, { units: JUG, seed: 7 });
  assert.equal(z1.unit, z2.unit); assert.ok(z1.nodes.every((n) => n.unit === z1.unit));
  // LAP: Lehrjahr & Thema über alle Jahre
  const lt = P.lapTrainTopics({ cards: CARDS, topics: TOPICS, problemTypes: PROBLEM_TYPES, formulas: FORMULAS });
  const y2 = lt[0].items.find((t) => t.id === "y2");
  assert.ok(y2 && P.trainItems(y2.nodes).every((c) => (Number(c.year) || 1) === 2));
  const grund = lt[1].items.find((t) => t.id === "t:grund");
  const gi = P.trainItems(grund.nodes);
  assert.equal(gi.length, CARDS.filter((c) => c.topic === "grund" && c.x && c.x.length).length, "Thema: alle Karten aller Lehrjahre");
  assert.ok(grund.nodes.some((n) => n.kind === "calc"), "Thema enthält passende Rechenaufgaben");
});

test("🏋️ Üben – Set bauen: Länge 10/20/50, gleiche Übungsarten, deterministisch; endlos nachlegen; Fehler nochmal", () => {
  const ctx = { module: "jp", canListen: true, canSpeak: false };
  const nodes = P.trainSource({ kind: "unit", id: JUG[3].id }, { units: JUG }).nodes;
  for (const n of [10, 20, 50]) {
    const ex = P.buildTraining(nodes, ctx, { size: n, seed: 3 });
    assert.equal(ex.length, n, `${n} Übungen`);
  }
  const a = P.buildTraining(nodes, ctx, { size: 10, seed: 5 }), b = P.buildTraining(nodes, ctx, { size: 10, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(new Set(a.map((e) => e.type)).size >= 2, "verschiedene Übungsarten");
  const lapEx = P.buildTraining(P.lapTrainTopics({ cards: CARDS, topics: TOPICS, problemTypes: PROBLEM_TYPES, formulas: FORMULAS })[0].items[0].nodes, { module: "lap", makeProblem, formulas: FORMULAS }, { size: 20, seed: 9 });
  assert.equal(lapEx.length, 20);
  assert.ok(lapEx.every((e) => ["mc", "tf", "match", "num"].includes(e.type)));
  assert.equal(P.buildTraining([], ctx, { size: 10 }).length, 0);
  // endlos: Lauf verlängern
  let run = P.startRun(a, { mode: "train" });
  for (let i = 0; i < 9; i++) { run = P.answerRun(run, i !== 2); run = P.nextRun(run); }
  assert.equal(run.queue.length, 10, "freies Üben: Fehler werden nicht hinten angehängt");
  run = P.extendRun(run, P.buildTraining(nodes, ctx, { size: P.TRAIN_BATCH, seed: 11 }));
  assert.equal(run.total, 20); assert.deepEqual(run.queue.slice(-10).map((e) => e.key), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], "neue, eindeutige Schlüssel");
  assert.ok(!P.runDone(run));
  // Fehler nochmal üben
  const mx = P.mistakeExercises(run, 1);
  assert.equal(mx.length, 1); assert.equal(mx[0].q, a[2].q); assert.ok(!("key" in mx[0]));
  if (mx[0].options) assert.deepEqual([...mx[0].options].sort(), [...a[2].options].sort());
});

test("🏋️ Üben – XP: +1 je richtiger Antwort, max. 50 am Tag, zählt fürs Tagesziel, kein Kronen-/Knoten-Fortschritt", () => {
  let r = P.applyTraining({ id: "jp" }, {}, { ok: 8, day: T });
  assert.equal(r.xp, 8); assert.equal(r.mod.xp[T], 8); assert.equal(r.me.ok, 8); assert.deepEqual(r.mod.nodes, {});
  assert.equal(r.me.lessons, 0, "zählt nicht als Lektion");
  r = P.applyTraining(r.mod, r.me, { ok: 45, day: T });
  assert.equal(r.xp, 42); assert.ok(r.capped); assert.equal(r.mod.xp[T], 50);
  assert.equal(P.trainXpLeft(r.me, T), 0);
  r = P.applyTraining(r.mod, r.me, { ok: 5, day: T });
  assert.equal(r.xp, 0); assert.equal(r.me.ok, 58, "richtige Antworten zählen trotzdem fürs Abzeichen");
  assert.equal(P.trainXpLeft(r.me, "2026-11-08"), 50, "neuer Tag – neues Limit");
});
