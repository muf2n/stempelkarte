// node --test test/elektro-core.test.mjs – Update 10 F: Einheiten, AWG, Widerstands-Farbcode (IEC 60062), E-Reihe, Lexikon & Schaltzeichen.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../js/alltag/elektro-core.js";
import { LEXIKON, LEX_CATS } from "../js/alltag/elektro-data.js";
import { SYMBOLS } from "../js/alltag/elektro-symbols.js";

test("Einheiten: Strom, Spannung, Leistung, Energie, Widerstand – auch mit Komma", () => {
  assert.equal(E.convert("1500", "strom", "mA", "A"), 1.5);
  assert.equal(E.convert("0,25", "strom", "A", "mA"), 250);
  assert.equal(E.convert(1.2, "strom", "kA", "A"), 1200);
  assert.equal(E.convert(230, "spannung", "V", "kV"), 0.23);
  assert.equal(E.convert(400, "spannung", "mV", "V"), 0.4);
  assert.equal(E.convert(2.2, "leistung", "kW", "W"), 2200);
  assert.equal(E.convert(0.3, "energie", "kWh", "Wh"), 300);
  assert.equal(E.convert(1, "energie", "kWh", "J (Ws)"), 3.6e6);
  assert.equal(E.convert(4.7, "widerstand", "kΩ", "Ω"), 4700);
  assert.equal(E.convert(1, "widerstand", "MΩ", "kΩ"), 1000);
  assert.equal(E.convert(100, "kapazitaet", "nF", "µF"), 0.1);
  assert.ok(Number.isNaN(E.convert("abc", "strom", "mA", "A")));
  assert.ok(Number.isNaN(E.convert(1, "strom", "mA", "V")));
  const all = E.convertAll("1", "leistung", "kW");
  assert.deepEqual(all.map((x) => x.value), [1e6, 1000, 1, 0.001]);
});

test("AWG ↔ mm² (ASTM B258): bekannte Werte, 4/0, Näherungshinweis", () => {
  assert.ok(Math.abs(E.awgToMm2(10) - 5.26) < 0.01);
  assert.ok(Math.abs(E.awgToMm2(12) - 3.31) < 0.01);
  assert.ok(Math.abs(E.awgToMm2(14) - 2.08) < 0.01);
  assert.ok(Math.abs(E.awgToMm2("4/0") - 107.2) < 0.1);
  assert.equal(E.parseAwg("0000"), -3);
  assert.equal(E.parseAwg("1/0"), 0);
  assert.equal(E.mm2ToAwg(2.5), 13);
  assert.equal(E.mm2ToAwg(1.5), 15);
  assert.equal(E.mm2ToAwg("6"), 9); // 6 mm² liegt zwischen AWG 10 (5,26) und AWG 9 (6,63) – näher an 9
  assert.equal(E.awgLabel(-3), "4/0");
  assert.equal(E.convert("2,5", "querschnitt", "mm²", "AWG"), 13);
  assert.match(E.AWG_NOTE, /Näherung/);
});

test("Farbcode → Wert: 4 und 5 Ringe, Gold/Silber als Multiplikator, ungültig", () => {
  assert.deepEqual(E.decodeBands(["gelb", "violett", "rot", "gold"]), { ohm: 4700, tol: 5, text: "4,7 kΩ ±5 %" });
  assert.deepEqual(E.decodeBands(["braun", "schwarz", "orange", "silber"]), { ohm: 10000, tol: 10, text: "10 kΩ ±10 %" });
  assert.deepEqual(E.decodeBands(["rot", "rot", "schwarz", "keine"]), { ohm: 22, tol: 20, text: "22 Ω ±20 %" });
  assert.equal(E.decodeBands(["gelb", "violett", "gold", "gold"]).ohm, 4.7);
  assert.equal(E.decodeBands(["braun", "schwarz", "schwarz", "braun", "braun"]).text, "1 kΩ ±1 %");
  assert.equal(E.decodeBands(["orange", "orange", "weiss", "schwarz", "braun"]).ohm, 339);
  assert.equal(E.decodeBands(["gold", "violett", "rot", "gold"]), null, "Gold ist keine Ziffer");
  assert.equal(E.decodeBands(["gelb", "violett", "rot", "weiss"]), null, "Weiß ist keine Toleranz");
  assert.equal(E.decodeBands(["gelb", "violett", "rot"]), null);
});

test("Wert → Farbcode und Eingabe-Formate (RKM)", () => {
  assert.equal(E.parseOhm("4k7"), 4700);
  assert.equal(E.parseOhm("4,7 kΩ"), 4700);
  assert.equal(E.parseOhm("470R"), 470);
  assert.equal(E.parseOhm("R47"), 0.47);
  assert.equal(E.parseOhm("2M2"), 2.2e6);
  assert.ok(Number.isNaN(E.parseOhm("abc")));
  assert.deepEqual(E.encodeOhm(4700).bands, ["gelb", "violett", "rot", "gold"]);
  assert.deepEqual(E.encodeOhm(220, 4, 5).bands, ["rot", "rot", "braun", "gold"]);
  assert.deepEqual(E.encodeOhm(10, 4, 5).bands, ["braun", "schwarz", "schwarz", "gold"]);
  assert.deepEqual(E.encodeOhm(0.47).bands, ["gelb", "violett", "silber", "gold"]);
  assert.deepEqual(E.encodeOhm(10000, 5).bands, ["braun", "schwarz", "schwarz", "rot", "braun"]);
  assert.deepEqual(E.encodeOhm(0).bands, ["schwarz", "schwarz", "schwarz", "gold"]);
  const r = E.encodeOhm(4750, 4);
  assert.equal(r.exact, false);
  for (const ohm of [1, 33, 470, 1500, 68000, 2.2e6]) { // Hin und zurück
    for (const n of [4, 5]) assert.equal(E.decodeBands(E.encodeOhm(ohm, n).bands).ohm, ohm, `${ohm} Ω / ${n} Ringe`);
  }
  assert.equal(E.ohmText(1500000), "1,5 MΩ");
  assert.equal(E.nearestE(4600), 4700);
  assert.equal(E.nearestE(1050, E.E12), 1000);
});

test("Lexikon (~150 Begriffe, eindeutig, Kategorien gültig) und Schaltzeichen (gültiges SVG)", () => {
  assert.ok(LEXIKON.length >= 140, `nur ${LEXIKON.length} Begriffe`);
  const names = LEXIKON.map((x) => x.t.toLowerCase());
  assert.equal(new Set(names).size, names.length, "keine doppelten Begriffe");
  const cats = new Set(LEX_CATS.map((c) => c[0]));
  for (const x of LEXIKON) { assert.ok(cats.has(x.c), x.t); assert.ok(x.d.length > 15 && x.d.length < 260, x.t); }
  assert.ok(LEXIKON.some((x) => /5 Sicherheitsregeln/.test(x.t) && /Freischalten/.test(x.d)));
  const ids = SYMBOLS.map((s) => s.id);
  for (const need of ["widerstand", "schliesser", "taster", "lampe", "steckdose", "schuko", "sicherung", "fi", "ls", "motor", "trafo", "erde", "pe", "kondensator", "spule", "diode", "led", "relais"]) assert.ok(ids.includes(need), need);
  for (const s of SYMBOLS) { assert.match(s.s, /^<svg viewBox="0 0 120 70"[^>]*>.*<\/svg>$/s, s.id); assert.doesNotMatch(s.s, /<script|on\w+=/i); }
});
