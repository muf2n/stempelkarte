import { test } from "node:test";
import assert from "node:assert/strict";
import * as F from "../js/alltag/formula-core.js";

const byId = (id) => F.FORMULAS.find((x) => x.id === id);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test("Formeln umstellen (Text)", () => {
  assert.equal(F.formText(byId("ohm"), "I"), "I = U / R");
  assert.equal(F.formText(byId("ohm"), "U"), "U = R · I");
  assert.equal(F.formText(byId("pi2r"), "I"), "I = √(P / R)");
  assert.equal(F.formText(byId("pu2r"), "U"), "U = √(P · R)");
  assert.equal(F.formText(byId("pu2r"), "R"), "R = U² / P");
  assert.equal(F.formText(byId("ltgr"), "A"), "A = ρ · l / R");
  assert.equal(F.formText(byId("xc"), "C"), "C = 1 / (2π · f · X_C)");
  assert.equal(F.formText(byId("freq"), "T"), "T = 1 / f");
  assert.equal(F.formText(byId("prozent"), "G"), "G = W · 100 / p");
  assert.equal(F.formText(byId("dreh"), "Il"), "I = P / (√3 · U · cos φ)");
  assert.equal(F.formText(byId("zins"), "pz"), "p = Z · 100 / (K · t)");
});

test("Rechnen: Umstellen stimmt mit Originalformel überein", () => {
  for (const Fm of F.FORMULAS) for (let i = 0; i < 4; i++) {
    const t = F.makeTask({ ids: [Fm.id], mode: "rechnen", pre: true }, rnd);
    assert.ok(t, Fm.id); assert.ok(t.answer > 0 && Number.isFinite(t.answer), Fm.id);
    assert.ok(F.check(t, String(t.answer / t.f).replace(".", ",")), `${Fm.id} ${t.x}`);
    assert.ok(!F.check(t, String((t.answer / t.f) * 1.05)), `${Fm.id} 5 % daneben ist falsch`);
    assert.ok(t.steps[0].includes("=") && t.given.length >= 1);
  }
  const o = byId("ohm"); assert.equal(F.solve(o, "I", { U: 230, R: 46 }), 5);
  const e = byId("eta"); for (let i = 0; i < 30; i++) { const t = F.makeTask({ ids: ["eta"], mode: "rechnen" }, rnd); if (t.x === "eta") assert.ok(t.answer < 1); }
});

test("Umformen: eine richtige, mehrere falsche, keine doppelt", () => {
  for (const Fm of F.FORMULAS) for (const x of F.targetsOf(Fm)) {
    const w = F.wrongForms(Fm, x, rnd), r = F.formText(Fm, x);
    assert.ok(w.length >= 2, `${Fm.id}/${x}: ${w}`); assert.ok(!w.includes(r)); assert.equal(new Set(w).size, w.length);
  }
  const t = F.makeTask({ ids: ["pi2r"], mode: "umformen" }, rnd);
  assert.equal(t.kind, "form"); assert.ok(F.check(t, t.answer) && !F.check(t, (t.answer + 1) % t.choices.length));
  assert.equal(F.makeTask({ ids: [] }, rnd), null);
});

test("Einheiten mit Vorsätzen", () => {
  assert.deepEqual(F.prefixOf(0.025), { n: 25, p: "m", f: 1e-3 });
  assert.equal(F.show("R", 4700), "4,7 kΩ"); assert.equal(F.show("C", 2.2e-6), "2,2 µF"); assert.match(F.show("R", 4700, false), /^4\D?700 Ω$/);
});

test("Ergebnis in anderer Einheit (vom Foto)", () => {
  const t = { kind: "calc", answer: 0.2236, f: 1e-3, unit: "mA", base: "A" };
  assert.ok(F.checkUnit(t, "223,6", "mA")); assert.ok(F.checkUnit(t, "0,2236", "A")); assert.ok(F.checkUnit(t, "223,6", ""));
  assert.ok(!F.checkUnit(t, "223,6", "A")); assert.ok(F.checkUnit({ kind: "calc", answer: 4700, f: 1e3, base: "Ω" }, "4,7", "kΩ"));
});

test("Erklären: Rechenweg Schritt für Schritt und typische Fehler erkennen", () => {
  const Fm = F.FORMULAS.find((x) => x.id === "pi2r"), v = { P: 1.56, I: 0.2 }, res = F.solve(Fm, "R", v);
  const st = F.explainSteps(Fm, "R", v, res);
  assert.ok(st.some((s) => /I = 200 mA = 0,2 A/.test(s)) && st.some((s) => /\(0,2 A\)²/.test(s)) && st.some((s) => /0,2² = 0,04/.test(s)) && st.some((s) => /1,56 \/ 0,04 = 39/.test(s)));
  const t = { kind: "calc", fid: "pi2r", x: "R", v, answer: res, f: 1, unit: "Ω" };
  assert.match(F.diagnose(t, "7,8")[0], /nicht quadriert/);
  assert.match(F.diagnose(t, "0,039")[0], /1000-mal zu klein/);
  const ti = { kind: "calc", fid: "pi2r", x: "I", v: { P: 1.56, R: 39 }, answer: 0.2, f: 1, unit: "A" };
  assert.match(F.diagnose(ti, "0,04")[0], /Wurzel vergessen/);
  assert.ok(F.formSteps(Fm, "I").some((s) => /Wurzel/.test(s)) && F.formSteps(Fm, "I").at(-1) === "Ergebnis: I = √(P / R)");
});

test("Gegenprobe: jede umgestellte Lösung erfüllt die Originalformel", () => {
  let sd = 11; const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (const Fm of F.FORMULAS) for (let i = 0; i < 8; i++) {
    const t = F.makeTask({ ids: [Fm.id], mode: "rechnen", pre: false }, r); if (!t) continue;
    const v = { ...t.v, [t.x]: t.answer };
    if (Fm.custom) { const first = Fm.vars[0], again = Fm.solve[first](v); assert.ok(Math.abs(again - v[first]) <= Math.abs(v[first]) * 0.002, `${Fm.id}/${t.x}`); }
    else { const again = F.solve(Fm, Fm.lhs, v); assert.ok(Math.abs(again - v[Fm.lhs]) <= Math.abs(v[Fm.lhs]) * 0.002, `${Fm.id}/${t.x}: ${again} ≠ ${v[Fm.lhs]}`); }
  }
  const f = F.FORMULAS.find((x) => x.id === "pi2r"); assert.ok(Math.abs(F.solve(f, "I", { P: 1.56, R: 39 }) - 0.2) < 1e-9);
});
