import test from "node:test";
import assert from "node:assert/strict";
import { evaluate as e, format } from "../js/alltag/calc-core.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
test("Grundrechnen und Präzedenz", () => {
  near(e("2+3×4"), 14);
  near(e("(2+3)×4"), 20);
  near(e("10÷4"), 2.5);
  near(e("1,5+1.5"), 3);
  near(e("2^3^2"), 512);
  near(e("-3+5"), 2);
  near(e("2×-3"), -6);
  near(e("√16+1"), 5);
  near(e("2(3+1)"), 8);
  near(e("2π"), 2 * Math.PI);
});
test("Prozent wie am Taschenrechner", () => {
  near(e("200+10%"), 220);
  near(e("200-10%"), 180);
  near(e("200×10%"), 20);
  near(e("50%"), 0.5);
  near(e("230×16+5%"), 230 * 16 * 1.05);
});
test("Fehler", () => {
  assert.throws(() => e("1÷0"), /Division/);
  assert.throws(() => e("(1+2"), /Klammer/);
  assert.throws(() => e("1+"), /Unvollständig/);
  assert.throws(() => e("abc"), /Unbekannt/);
  assert.throws(() => e("√-4"), /Wurzel/);
});
test("Format de-AT ohne Rundungsfehler", () => {
  assert.equal(format(0.1 + 0.2), "0,3");
  assert.equal(format(1234.5), "1.234,5");
  assert.equal(format(-2), "-2");
});
