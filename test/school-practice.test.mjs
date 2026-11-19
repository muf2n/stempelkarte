import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/alltag/school-practice-core.js";

test("Üben: sicherer Rechner und Zahleneingabe", () => {
  assert.equal(P.calc("1120*18/52"), 1120 * 18 / 52);
  assert.equal(P.calc("1.120 × 4 : 12") , 1.12 * 4 / 12); // Punkt = Dezimal im Rechenweg
  assert.equal(P.calc("(676+338)*2"), 2028); assert.equal(P.calc("-(2-5)"), 3);
  assert.equal(P.calc("alert(1)"), null); assert.equal(P.calc("2**3"), null); assert.equal(P.calc("1/0"), null);
  assert.equal(P.parseNum("1.507,69 €"), 1507.69); assert.equal(P.parseNum("387,69"), 387.69); assert.equal(P.parseNum("1.120"), 1120);
  assert.equal(P.parseNum("1507.69"), 1507.69); assert.equal(P.parseNum(""), null);
});

test("Üben: Claude-Antwort prüfen, falsches Ergebnis wird nachgerechnet", () => {
  const set = P.parseSet(JSON.stringify({ title: "Aliquote Sonderzahlungen", tasks: [
    { q: "LE 1.120 €, 18 Wochen. Aliquote SZ?", calc: "1120*18/52", answer: 387.7, unit: "€", steps: ["1120 × 18 / 52"] },
    { q: "LE 900 €, 5 Monate?", calc: "900*5/12", answer: 375, unit: "€" },
    { q: "Was heißt WR?", choices: ["Weihnachtsremuneration", "Wochenrate"], answer: 0 },
    { q: "kaputt", choices: ["a"], answer: 3 }, { q: "", answer: 1 },
  ] }));
  assert.equal(set.tasks.length, 3);
  assert.equal(set.tasks[0].answer, 387.69); assert.equal(set.tasks[0].fixed, true);
  assert.equal(set.tasks[1].fixed, false);
  assert.ok(P.isRight(set.tasks[0], "387,69") && P.isRight(set.tasks[0], "387,7") && !P.isRight(set.tasks[0], "388"));
  assert.ok(P.isRight(set.tasks[2], 0) && !P.isRight(set.tasks[2], 1));
  assert.equal(P.parseSet("nix"), null);
  const s2 = P.addResult(P.addResult({}, 3, 4), 4, 4); assert.deepEqual([s2.stats.runs, s2.stats.best, s2.stats.last], [2, 100, 100]);
});

