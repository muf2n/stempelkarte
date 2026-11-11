// node --test test/pruef-core.test.mjs
// Update 14 – Prüfprotokoll: Grenzwerte (Isolation, Zs = U0/Ia, RCD, UB, TT-RA), Gesamtergebnis, Schnelleingabe.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/alltag/pruef-core.js";

test("Zs-Grenzwert aus Ia = k · In", () => {
  assert.equal(P.zsMax({ schutz: "B", in: 16 }), 2.88);   // 230 / 80
  assert.equal(P.zsMax({ schutz: "C", in: 16 }), 1.44);   // 230 / 160
  assert.equal(P.zsMax({ schutz: "B", in: 10 }), 4.6);
  assert.equal(P.zsMax({ schutz: "gG", in: 16, ia: 107 }), 2.15);
  assert.equal(P.zsMax({ schutz: "", in: 16 }), null);
});

test("Stromkreis-Bewertung", () => {
  const ok = P.evalCircuit({ schutz: "B", in: 16, riso: 200, rpe: 0.3, zs: 0.8, rcd: "30", rcdT: 24, rcdI: 22, ub: 1.2 });
  assert.equal(ok.state, "ok");
  const knapp = P.evalCircuit({ schutz: "B", in: 16, riso: 200, rpe: 0.3, zs: 2.2 });
  assert.equal(knapp.state, "knapp", "über 2/3 von 2,88 Ω");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 0.8, rpe: 0.3, zs: 0.5 }).state, "fehler", "Isolation < 1 MΩ");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 0.6, uiso: 250, rpe: 0.3, zs: 0.5 }).state, "ok", "SELV 250 V: ≥ 0,5 MΩ");
  assert.equal(P.evalCircuit({ schutz: "C", in: 16, riso: 50, rpe: 0.3, zs: 1.6 }).state, "fehler", "Zs > 1,44 Ω");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 50, rpe: 0.3, zs: 0.5, rcd: "30", rcdT: 320 }).state, "fehler", "RCD > 300 ms");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 50, rpe: 0.3, zs: 0.5, rcd: "300", rcdS: true, rcdT: 100 }).state, "fehler", "selektiv < 130 ms");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 50, rpe: 0.3, zs: 0.5, rcd: "30", rcdT: 20, rcdI: 12 }).state, "fehler", "Auslösestrom < IΔn/2");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16, riso: 50, rpe: 0.3, zs: 0.5, rcd: "30", rcdT: 20, ub: 60 }).state, "fehler", "UB > 50 V");
  assert.equal(P.evalCircuit({ schutz: "B", in: 16 }).state, "offen");
  const ac = { schutz: "B", in: 16, riso: 50, rpe: 0.3, zs: 0.5, rcd: "30", rcdTyp: "AC", rcdT: 20 };
  assert.equal(P.evalCircuit(ac, { art: "neu" }).state, "fehler", "Typ AC in Neuanlage unzulässig");
  assert.equal(P.evalCircuit(ac, { art: "wiederholung" }).state, "knapp", "Typ AC im Bestand: Hinweis");
  assert.ok(!P.evalCircuit({ schutz: "B", in: 16, riso: 50, rpe: 0.2 }, { netz: "TT" }).checks.some((c) => c.key === "zs"), "TT ohne Zs-Prüfung");
});

test("TT-Erdungswiderstand und Gesamtergebnis", () => {
  const p = { netz: "TT", ra: 120, circuits: [{ schutz: "B", in: 16, riso: 50, rpe: 0.2, rcd: "30", rcdT: 25 }, { schutz: "B", in: 10, riso: 50, rpe: 0.2, rcd: "300", rcdT: 40 }] };
  assert.deepEqual(P.evalRa(p), { value: 120, limit: 167, state: "ok" });
  assert.equal(P.evalRa({ ...p, ra: 200 }).state, "fehler");
  assert.equal(P.evalProt(p).state, "ok");
  assert.equal(P.evalProt({ ...p, drehfeld: "links" }).state, "fehler");
  assert.equal(P.evalProt({ circuits: [] }).state, "offen");
  const r = P.evalProt({ besichtigung: { schutzart: true, quatsch: true }, circuits: [{ schutz: "B", in: 16, riso: 50, rpe: 0.2, zs: 2.5 }] });
  assert.equal(r.visOk, 1); assert.equal(r.warn, 1); assert.equal(r.state, "ok");
});

test("Schnelleingabe von Stromkreisen", () => {
  const a = P.parseCircuitLine("1 Licht Küche B10 1,5");
  assert.deepEqual([a.nr, a.name, a.schutz, a.in, a.mm2, a.rcd], ["1", "Licht Küche", "B", 10, 1.5, ""]);
  const b = P.parseCircuitLine("F2 Steckdosen Bad C16 2,5 FI30");
  assert.deepEqual([b.nr, b.name, b.schutz, b.in, b.mm2, b.rcd], ["F2", "Steckdosen Bad", "C", 16, 2.5, "30"]);
  const c = P.parseCircuitLine("Herd gG 16");
  assert.deepEqual([c.name, c.schutz, c.in], ["Herd", "gG", 16]);
  assert.equal(P.parseCircuitLine(""), null);
});
