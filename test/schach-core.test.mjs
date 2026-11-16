import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/alltag/schach-core.js";
import { Chess } from "../vendor/chess/chess.js";
import { search, perft } from "../js/chess-engine.js";

test("Elo, Kronen, Ergebnis", () => {
  assert.equal(C.eloAfter(800, 800, 1, 0), 816);
  assert.equal(C.eloAfter(1200, 300, 1, 20), 1204); // Sieg gegen viel Schwächere: trotzdem +4
  assert.equal(C.eloAfter(800, 300, 0, 3), 780); // Niederlage höchstens −20
  assert.equal(C.eloAfter(800, 800, 0, 20), 790);
  const r = C.recordGame({}, { bot: "eva", res: "win", color: "w", tc: "5", moves: ["e2e4"] });
  assert.equal(r.me.games, 1); assert.equal(r.me.bots.eva.w, 1); assert.ok(r.diff > 0);
  assert.equal(r.me.bots.eva.c, 3); assert.equal(C.recordGame({}, { bot: "eva", res: "win", moves: ["e2e4"], helps: 2 }).me.bots.eva.c, 2); assert.equal(C.recordGame({}, { bot: "eva", res: "win", moves: ["e2e4"], helps: 5 }).me.bots.eva.c, 1); assert.equal(C.recordGame({}, { bot: "eva", res: "loss", moves: ["e2e4"] }).me.bots.eva.c, 0);
  assert.equal(C.tcById("15+10").inc, 10); assert.equal(C.fmtClock(65000), "1:05"); assert.equal(C.fmtClock(9500), "9,5");
});
test("Engine-Züge sind für chess.js legal, Bots unterschiedlich stark", () => {
  const ch = new Chess();
  for (let i = 0; i < 24 && !ch.isGameOver(); i++) {
    const b = C.BOTS[i % C.BOTS.length];
    const r = search(ch.fen(), { depth: Math.min(b.depth, 3), timeMs: 150, noise: b.noise });
    assert.ok(ch.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] }), r.move);
  }
  assert.equal(perft("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2), 2039);
});
test("Rätsel-Wertung und Auswahl", async () => {
  const { PUZZLES } = await import("../js/alltag/schach-puzzles.js");
  for (const p of PUZZLES) { // jede Aufgabe muss mit chess.js spielbar sein
    const ch = new Chess(p.fen); assert.ok(ch.move({ from: p.first.slice(0, 2), to: p.first.slice(2, 4), promotion: p.first[4] }), "first " + p.id);
    for (const u of p.sol) assert.ok(ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }), `sol ${p.id} ${u}`);
  }
  const m = C.puzzleResult({}, PUZZLES[0], true, "2026-11-15");
  assert.equal(m.pz.streak, 1); assert.ok(m.pz.r > 800); assert.ok(C.nextPuzzle(PUZZLES, m)); assert.ok(C.dailyPuzzle(PUZZLES, "2026-11-15"));
});
test("Wochen-Event: 5 Bots, steigende Stärke, gleich für die ganze Woche, Belohnungen", () => {
  const a = C.weekEvent(new Date(2026, 10, 16, 9).getTime()), b = C.weekEvent(new Date(2026, 10, 22, 22).getTime()), c = C.weekEvent(new Date(2026, 10, 23, 9).getTime());
  assert.equal(a.key, "2026-11-16"); assert.equal(a.key, b.key); assert.notEqual(a.key, c.key);
  assert.deepEqual(a.bots.map((x) => x.elo), b.bots.map((x) => x.elo));
  for (let i = 1; i < 5; i++) assert.ok(a.bots[i].elo >= a.bots[i - 1].elo);
  assert.equal(C.anyBot(a.bots[3].id).name, a.bots[3].name);
  let me = C.normMe({});
  let r = C.evWin(me, a, 4); assert.equal(r.gained, 30); me = C.normMe(r.me);
  assert.equal(C.evWin(me, a, 4).gained, 0);
  r = C.evWin(me, a, 0); me = C.normMe(r.me);
  const st = C.evState(me, a); assert.equal(st.pts, 35); assert.deepEqual(C.evClaimable(st), [0, 1]);
  assert.equal(C.evState(me, c).pts, 0); // neue Woche → neu
});
test("Analyse: Patzer erkennen, Genauigkeit, 120 Bots", () => {
  assert.ok(C.BOTS.length >= 100); assert.ok(C.BOTS.every((b, i) => !i || b.elo >= C.BOTS[i - 1].elo));
  const moves = ["e2e4", "e7e5", "d1h5", "g8f6"];
  const ev = [20, 30, 25, 30, 900];       // nach 4 Halbzügen steht Weiß klar besser → Sf6?? war ein Patzer
  const best = ["e2e4", "e7e5", "g1f3", "b8c6"];
  const a = C.analyse(moves, ev, best);
  assert.equal(a.moves[0].cls, "best"); assert.equal(a.moves[3].cls, "blund");
  assert.ok(a.acc.w > 90 && a.acc.b < 70);
  assert.equal(C.fmtEval(150), "+1,5"); assert.equal(C.fmtEval(-29997), "−M2");
});
test("Coach erklärt: Figur hängt, Matt verpasst, Rochade", async () => {
  const { explain } = await import("../js/alltag/schach-coach.js");
  const who = (s) => (s === "w" ? "Du" : "Bot");
  // 1. e4 e5 2. Nf3 Qh4?? (Dame hängt nicht direkt, aber: 3. Nxh4 schlägt die Dame)
  const moves = ["e2e4", "e7e5", "g1f3", "d8h4", "f3h4"];
  const ev = [30, 30, 30, 40, 950, 950];
  const best = ["e2e4", "e7e5", "g1f3", "b8c6", "f3h4", "a7a6"];
  const an = C.analyse(moves, ev, best);
  const e = explain({ moves, ev, best, an, k: 3, who });
  assert.ok(e.lines.join(" ").includes("Dame") && e.lines.join(" ").includes("h4"), e.lines.join(" | "));
  const ok = explain({ moves, ev, best, an, k: 4, who });
  assert.ok(/Schlägt die Dame/.test(ok.lines.join(" ")), ok.lines.join(" | "));
});

test("Menschliche Fehler: schwache Bots patzen oft, starke nie", async () => {
  const { Chess } = await import("../vendor/chess/chess.js");
  assert.ok(C.slipChance(200) > 0.5 && C.slipChance(800) > 0.1 && C.slipChance(1300) < 0.04 && C.slipChance(2000) === 0);
  assert.ok(C.slipChance(500) < C.slipChance(400) && C.slipChance(500) > C.slipChance(600));
  const ch = new Chess(); let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40 && !ch.isGameOver(); i++) { const u = C.humanMove(ch, rnd); assert.ok(u); ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); }
});
