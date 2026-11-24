// 🎲 Formel-Trainer – reine Logik (offline, ohne KI): Formeln, Zufallswerte, Umformen, Prüfen.
// Die meisten Formeln sind „Produktformeln“: LHS = Π Faktor^Exponent (z. B. P = I² · R, R = ρ · l / A).
// Daraus lässt sich jede Größe automatisch umstellen und berechnen – auch für falsche Antwortmöglichkeiten.

/* ---------- Größen ---------- */
const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
const series = (lo, hi, base = E12) => { const out = []; for (let d = 1e-12; d <= hi * 10; d *= 10) for (const b of base) { const v = +(b * d).toPrecision(3); if (v >= lo && v <= hi) out.push(v); } return out; };
const range = (lo, hi, step) => { const out = []; for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6)); return out; };
// Größe: n = Name, u = Einheit, p = mögliche Werte (Zufall), pre = Vorsätze erlaubt
export const Q = {
  U: { n: "Spannung", u: "V", p: [1.5, 4.5, 5, 6, 9, 12, 24, 48, 110, 230, 400], pre: true },
  U2: { n: "Teilspannung", u: "V", p: [] , pre: true },
  I: { n: "Strom", u: "A", p: [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 4, 5, 6, 8, 10, 13, 16], pre: true },
  R: { n: "Widerstand", u: "Ω", p: series(10, 4700), pre: true },
  R1: { n: "Widerstand R1", u: "Ω", p: series(10, 4700), pre: true },
  R2: { n: "Widerstand R2", u: "Ω", p: series(10, 4700), pre: true },
  P: { n: "Leistung", u: "W", p: [5, 10, 25, 40, 60, 100, 150, 500, 750, 1000, 1500, 2000, 2300, 3000], pre: true },
  Pab: { n: "abgegebene Leistung", u: "W", p: [400, 750, 1100, 1500, 2200, 3000, 4000], pre: true },
  Pzu: { n: "zugeführte Leistung", u: "W", p: [500, 900, 1300, 1800, 2600, 3600, 5000], pre: true },
  eta: { n: "Wirkungsgrad", u: "", sym: "η", p: [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95], max: 0.98 },
  W: { n: "Arbeit / Energie", u: "kWh", p: [0.5, 1, 2, 3.5, 5, 12, 20, 45] },
  Pk: { n: "Leistung", u: "kW", sym: "P", p: [0.06, 0.1, 0.5, 0.75, 1, 1.5, 2, 2.3, 3] },
  t: { n: "Zeit", u: "h", p: [0.5, 1, 1.5, 2, 3, 4, 5, 8, 10, 24] },
  k: { n: "Strompreis", u: "€/kWh", p: [0.18, 0.22, 0.25, 0.28, 0.3, 0.35] },
  K: { n: "Kosten", u: "€", p: [] },
  rho: { n: "spez. Widerstand", u: "Ω·mm²/m", sym: "ρ", p: [0.0178, 0.0286, 0.0178, 0.0178] },
  l: { n: "Leitungslänge", u: "m", p: [5, 10, 15, 20, 25, 30, 40, 50, 75, 100] },
  A: { n: "Querschnitt", u: "mm²", p: [0.75, 1, 1.5, 2.5, 4, 6, 10, 16] },
  f: { n: "Frequenz", u: "Hz", p: [50, 60, 100, 400, 1000, 2000, 5000, 10000], pre: true },
  T: { n: "Periodendauer", u: "s", p: [0.02, 0.01, 0.001, 0.0025, 0.0002], pre: true },
  C: { n: "Kapazität", u: "F", p: series(1e-9, 1e-3, [1, 2.2, 4.7]), pre: true },
  L: { n: "Induktivität", u: "H", p: series(1e-3, 2, [1, 2.2, 4.7]), pre: true },
  XC: { n: "kapazitiver Blindwiderstand", u: "Ω", sym: "X_C", p: [], pre: true },
  XL: { n: "induktiver Blindwiderstand", u: "Ω", sym: "X_L", p: [], pre: true },
  Qc: { n: "Ladung", u: "C", sym: "Q", p: [], pre: true },
  tau: { n: "Zeitkonstante", u: "s", sym: "τ", p: [], pre: true },
  Ul: { n: "Leiterspannung", u: "V", sym: "U", p: [400, 690, 230] },
  Us: { n: "Strangspannung", u: "V", sym: "U_Str", p: [230, 400, 133] },
  Il: { n: "Leiterstrom", u: "A", sym: "I", p: [2, 4, 6.3, 10, 16, 25, 32] },
  cos: { n: "Leistungsfaktor", u: "", sym: "cos φ", p: [0.75, 0.8, 0.85, 0.9, 0.95, 1] },
  Ub: { n: "Betriebsspannung", u: "V", sym: "U", p: [5, 9, 12, 24] },
  Id: { n: "LED-Strom", u: "A", sym: "I", p: [0.005, 0.01, 0.015, 0.02, 0.025, 0.03], pre: true },
  Iz: { n: "Strom", u: "A", sym: "I", p: [6, 10, 13, 16, 20, 25, 32] },
  UF: { n: "LED-Durchlassspannung", u: "V", sym: "U_F", p: [1.8, 2, 2.1, 3, 3.2] },
  Rv: { n: "Vorwiderstand", u: "Ω", sym: "R_V", p: [], pre: true },
  dU: { n: "Spannungsfall", u: "V", sym: "ΔU", p: [], pre: true },
  gam: { n: "Leitfähigkeit", u: "m/(Ω·mm²)", sym: "γ", p: [56, 35] },
  LE: { n: "Monatseinkommen", u: "€", p: [676, 850, 950, 1120, 1250, 1400] },
  m: { n: "Monate", u: "", p: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  SZ: { n: "aliquote Sonderzahlung", u: "€", p: [] },
  Kap: { n: "Kapital", u: "€", sym: "K", p: [500, 1000, 1500, 2000, 2500, 5000, 10000] },
  pz: { n: "Zinssatz", u: "%", sym: "p", p: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5] },
  ty: { n: "Jahre", u: "", sym: "t", p: [1, 2, 3, 4, 5] },
  Z: { n: "Zinsen", u: "€", p: [] },
  G: { n: "Grundwert", u: "€", p: range(50, 2000, 50) },
  E: { n: "Endwert", u: "€", p: [] },
  Br: { n: "Bruttopreis", u: "€", sym: "Brutto", p: [] }, Ne: { n: "Nettopreis", u: "€", sym: "Netto", p: [12, 25, 49.9, 80, 120, 199, 350, 899] },
  alt: { n: "alter Wert", u: "€", p: [800, 900, 1000, 1120, 1250, 1500, 2000] }, neu: { n: "neuer Wert", u: "€", p: [850, 960, 1050, 1180, 1300, 1600, 2100] },
  pv: { n: "Veränderung", u: "%", sym: "p", p: [] },
  ps: { n: "Prozentsatz", u: "%", sym: "p", p: [2, 3, 5, 10, 12, 15, 20, 25, 30] },
  PW: { n: "Prozentwert", u: "€", sym: "W", p: [] },
  a: { n: "Kathete a", u: "m", p: [3, 4, 5, 6, 8, 12] }, b: { n: "Kathete b", u: "m", p: [4, 5, 8, 9, 12, 15] }, c: { n: "Hypotenuse c", u: "m", p: [] },
};
// Konstanten (Schlüssel bewusst nicht rein numerisch – sonst sortiert JS sie im Objekt nach vorne)
const CONST = { "√3": Math.sqrt(3), "2π": 2 * Math.PI, c100: 100, c12: 12, c2: 2 };
const CTXT = { c100: "100", c12: "12", c2: "2" };
export const sym = (k) => (CONST[k] != null ? CTXT[k] || k : (Q[k] && Q[k].sym) || k);

/* ---------- Formeln ---------- */
// mono: lhs = Π f[x]^e   ·  custom: solve[x](v) und show[x]
export const FORMULAS = [
  { id: "ohm", g: "Grundlagen", name: "Ohmsches Gesetz", lhs: "U", f: { R: 1, I: 1 } },
  { id: "pui", g: "Grundlagen", name: "Leistung P = U · I", lhs: "P", f: { U: 1, I: 1 } },
  { id: "pi2r", g: "Grundlagen", name: "Leistung P = I² · R", lhs: "P", f: { I: 2, R: 1 } },
  { id: "pu2r", g: "Grundlagen", name: "Leistung P = U² / R", lhs: "P", f: { U: 2, R: -1 } },
  { id: "arbeit", g: "Grundlagen", name: "Elektrische Arbeit W = P · t", lhs: "W", f: { Pk: 1, t: 1 } },
  { id: "kosten", g: "Grundlagen", name: "Energiekosten K = W · k", lhs: "K", f: { W: 1, k: 1 } },
  { id: "eta", g: "Grundlagen", name: "Wirkungsgrad η = Pab / Pzu", lhs: "eta", f: { Pab: 1, Pzu: -1 } },
  { id: "reihe", g: "Schaltungen", name: "Reihenschaltung R = R1 + R2", custom: true, vars: ["R", "R1", "R2"],
    solve: { R: (v) => v.R1 + v.R2, R1: (v) => v.R - v.R2, R2: (v) => v.R - v.R1 }, show: { R: "R = R1 + R2", R1: "R1 = R − R2", R2: "R2 = R − R1" },
    wrong: { R: ["R = R1 · R2", "R = R1 − R2", "R = (R1 · R2) / (R1 + R2)"], R1: ["R1 = R + R2", "R1 = R / R2", "R1 = R2 − R"], R2: ["R2 = R + R1", "R2 = R / R1", "R2 = R1 − R"] } },
  { id: "parallel", g: "Schaltungen", name: "Parallelschaltung (2 Widerstände)", custom: true, vars: ["R", "R1", "R2"],
    solve: { R: (v) => (v.R1 * v.R2) / (v.R1 + v.R2), R2: (v) => (v.R * v.R1) / (v.R1 - v.R) }, show: { R: "R = (R1 · R2) / (R1 + R2)", R2: "R2 = (R · R1) / (R1 − R)" },
    wrong: { R: ["R = R1 + R2", "R = (R1 + R2) / (R1 · R2)", "R = R1 · R2"], R2: ["R2 = R − R1", "R2 = (R1 − R) / (R · R1)", "R2 = (R · R1) / (R + R1)"] } },
  { id: "teiler", g: "Schaltungen", name: "Spannungsteiler (unbelastet)", custom: true, vars: ["U2", "U", "R1", "R2"],
    solve: { U2: (v) => (v.U * v.R2) / (v.R1 + v.R2), U: (v) => (v.U2 * (v.R1 + v.R2)) / v.R2 }, show: { U2: "U2 = U · R2 / (R1 + R2)", U: "U = U2 · (R1 + R2) / R2" },
    wrong: { U2: ["U2 = U · R1 / (R1 + R2)", "U2 = U · (R1 + R2) / R2", "U2 = U · R2 / R1"], U: ["U = U2 · R2 / (R1 + R2)", "U = U2 · R1 / R2", "U = U2 / (R1 + R2)"] } },
  { id: "led", g: "Elektronik", name: "LED-Vorwiderstand", custom: true, vars: ["Rv", "Ub", "UF", "Id"],
    solve: { Rv: (v) => (v.Ub - v.UF) / v.Id, Id: (v) => (v.Ub - v.UF) / v.Rv }, show: { Rv: "R_V = (U − U_F) / I", Id: "I = (U − U_F) / R_V" },
    wrong: { Rv: ["R_V = U / I", "R_V = (U + U_F) / I", "R_V = I / (U − U_F)"], Id: ["I = R_V / (U − U_F)", "I = U / R_V", "I = (U + U_F) / R_V"] } },
  { id: "freq", g: "Wechselstrom", name: "Frequenz f = 1 / T", custom: true, vars: ["f", "T"],
    solve: { f: (v) => 1 / v.T, T: (v) => 1 / v.f }, show: { f: "f = 1 / T", T: "T = 1 / f" },
    wrong: { f: ["f = T", "f = 2π · T", "f = 1 / T²"], T: ["T = f", "T = 2π · f", "T = f / 2π"] } },
  { id: "xl", g: "Wechselstrom", name: "Induktiver Blindwiderstand X_L = 2π · f · L", lhs: "XL", f: { "2π": 1, f: 1, L: 1 } },
  { id: "xc", g: "Wechselstrom", name: "Kapazitiver Blindwiderstand X_C = 1 / (2π · f · C)", lhs: "XC", f: { "2π": -1, f: -1, C: -1 } },
  { id: "ladung", g: "Elektronik", name: "Ladung Q = C · U", lhs: "Qc", f: { C: 1, U: 1 } },
  { id: "tau", g: "Elektronik", name: "Zeitkonstante τ = R · C", lhs: "tau", f: { R: 1, C: 1 } },
  { id: "dreh", g: "Drehstrom", name: "Drehstromleistung P = √3 · U · I · cos φ", lhs: "P", f: { "√3": 1, Ul: 1, Il: 1, cos: 1 } },
  { id: "stern", g: "Drehstrom", name: "Sternschaltung U_Str = U / √3", lhs: "Us", f: { Ul: 1, "√3": -1 } },
  { id: "ltgr", g: "Installation", name: "Leitungswiderstand R = ρ · l / A", lhs: "R", f: { rho: 1, l: 1, A: -1 }, targets: ["R", "l", "A"] },
  { id: "dU", g: "Installation", name: "Spannungsfall ΔU = 2 · l · I / (γ · A)", lhs: "dU", f: { c2: 1, l: 1, Iz: 1, gam: -1, A: -1 }, targets: ["dU", "l", "Iz", "A"] },
  { id: "sz", g: "AWL", name: "Aliquote Sonderzahlung", lhs: "SZ", f: { LE: 1, m: 1, c12: -1 } },
  { id: "zins", g: "AWL", name: "Zinsen Z = K · p · t / 100", lhs: "Z", f: { Kap: 1, pz: 1, ty: 1, c100: -1 } },
  { id: "prozent", g: "Prozent", name: "Prozentwert W = G · p / 100", lhs: "PW", f: { G: 1, ps: 1, c100: -1 } },
  { id: "rabatt", g: "Prozent", name: "Rabatt / Skonto: Endpreis = G · (1 − p / 100)", custom: true, vars: ["E", "G", "ps"],
    solve: { E: (v) => v.G * (1 - v.ps / 100), G: (v) => v.E / (1 - v.ps / 100), ps: (v) => (1 - v.E / v.G) * 100 },
    show: { E: "E = G · (1 − p / 100)", G: "G = E / (1 − p / 100)", ps: "p = (1 − E / G) · 100" },
    wrong: { E: ["E = G · p / 100", "E = G · (1 + p / 100)", "E = G − p"], G: ["G = E · (1 − p / 100)", "G = E / (1 + p / 100)", "G = E + p"], ps: ["p = E / G · 100", "p = (G − E) · 100", "p = (1 + E / G) · 100"] } },
  { id: "aufschlag", g: "Prozent", name: "Erhöhung / Aufschlag: neu = G · (1 + p / 100)", custom: true, vars: ["E", "G", "ps"],
    solve: { E: (v) => v.G * (1 + v.ps / 100), G: (v) => v.E / (1 + v.ps / 100), ps: (v) => (v.E / v.G - 1) * 100 },
    show: { E: "neu = G · (1 + p / 100)", G: "G = neu / (1 + p / 100)", ps: "p = (neu / G − 1) · 100" },
    wrong: { E: ["neu = G · p / 100", "neu = G · (1 − p / 100)", "neu = G + p"], G: ["G = neu · (1 + p / 100)", "G = neu / (1 − p / 100)", "G = neu − p"], ps: ["p = neu / G · 100", "p = (neu − G) · 100", "p = (1 − neu / G) · 100"] } },
  { id: "mwst", g: "Prozent", name: "Umsatzsteuer 20 %: Brutto = Netto · 1,2", custom: true, vars: ["Br", "Ne"],
    solve: { Br: (v) => v.Ne * 1.2, Ne: (v) => v.Br / 1.2 }, show: { Br: "Brutto = Netto · 1,2", Ne: "Netto = Brutto / 1,2" },
    wrong: { Br: ["Brutto = Netto · 0,2", "Brutto = Netto / 1,2", "Brutto = Netto + 20"], Ne: ["Netto = Brutto · 0,8", "Netto = Brutto · 1,2", "Netto = Brutto − 20"] } },
  { id: "aend", g: "Prozent", name: "Prozentuale Veränderung p = (neu − alt) / alt · 100", custom: true, vars: ["pv", "alt", "neu"],
    solve: { pv: (v) => ((v.neu - v.alt) / v.alt) * 100 }, show: { pv: "p = (neu − alt) / alt · 100" },
    wrong: { pv: ["p = (neu − alt) / neu · 100", "p = neu / alt · 100", "p = (alt − neu) · 100"] } },
  { id: "pyth", g: "Mathe", name: "Pythagoras c² = a² + b²", custom: true, vars: ["c", "a", "b"],
    solve: { c: (v) => Math.hypot(v.a, v.b), a: (v) => Math.sqrt(v.c ** 2 - v.b ** 2) }, show: { c: "c = √(a² + b²)", a: "a = √(c² − b²)" },
    wrong: { c: ["c = a + b", "c = √(a² − b²)", "c = a² + b²"], a: ["a = √(c² + b²)", "a = c − b", "a = c² − b²"] } },
];
export const GROUPS = [...new Set(FORMULAS.map((f) => f.g))];
export const varsOf = (F) => (F.custom ? F.vars : [F.lhs, ...Object.keys(F.f).filter((k) => CONST[k] == null)]);
export const targetsOf = (F) => F.targets || (F.custom ? Object.keys(F.solve) : varsOf(F));

/* ---------- Umstellen (Produktformeln) ---------- */
const sup = (e) => (e === 2 ? "²" : e === 3 ? "³" : "");
const term = (k, e) => sym(k) + sup(Math.abs(e));
/** Formel nach x umgestellt als Text. Für LHS: Originalformel. expo: Exponenten-Tabelle (für falsche Varianten änderbar). */
export function formText(F, x, expo = null) {
  if (F.custom) return F.show[x];
  const f = expo || F.f;
  // alle Faktoren als „lhs = Π“ → für x:  x^ex = lhs · Π (andere)^(−e)
  const all = { [F.lhs]: -1, ...f }; // 1 = lhs^-1 · Π f  → umgestellt: x^(ex) = Π (andere)^(−e)
  const ex = all[x]; const num = [], den = [];
  for (const [k, e] of Object.entries(all)) { if (k !== x && -e / ex > 0) num.push(term(k, -e / ex)); }                 // Zähler: lhs zuerst
  for (const [k, e] of Object.entries({ ...f, [F.lhs]: -1 })) { if (k !== x && -e / ex < 0) den.push(term(k, -e / ex)); } // Nenner: lhs zuletzt
  const root = Math.abs(ex) === 2;
  const n = num.length ? num.join(" · ") : "1", d = den.length > 1 ? `(${den.join(" · ")})` : den[0];
  let rhs = d ? `${n} / ${d}` : n;
  if (root) rhs = `√(${rhs})`;
  return `${sym(x)} = ${rhs}`;
}
/** Wert von x aus den anderen Werten */
export function solve(F, x, v) {
  if (F.custom) return F.solve[x](v);
  const all = { [F.lhs]: -1, ...F.f }, ex = all[x];
  let r = 1;
  for (const [k, e] of Object.entries(all)) { if (k === x) continue; const val = CONST[k] != null ? CONST[k] : v[k]; r *= val ** (-e / ex); } // Exponent −e/ex enthält schon die Wurzel
  return r;
}
/** Plausible falsche Umstellungen (Exponenten-Vorzeichen vertauscht, Wurzel vergessen). */
export function wrongForms(F, x, rnd = Math.random) {
  const right = formText(F, x), out = new Set();
  if (F.custom) { for (const w of F.wrong[x] || []) if (w !== right) out.add(w); return shuffle([...out], rnd).slice(0, 3); }
  const keys = Object.keys(F.f), tries = [];
  for (const k of keys) tries.push({ ...F.f, [k]: -F.f[k] });                                   // ein Faktor auf die falsche Seite
  tries.push(Object.fromEntries(keys.map((k) => [k, -F.f[k]])));                               // alles verkehrt
  for (const k of keys) if (Math.abs(F.f[k]) === 2) tries.push({ ...F.f, [k]: Math.sign(F.f[k]) }); // Quadrat vergessen
  for (const t of shuffle(tries, rnd)) { const s = formText({ ...F, f: t }, x); if (s !== right) out.add(s); if (out.size >= 3) break; }
  if (Math.abs(({ [F.lhs]: -1, ...F.f })[x]) === 2 && out.size < 3) out.add(right.replace(/^(.+?) = √\((.*)\)$/, "$1 = $2"));
  return [...out].slice(0, 3);
}
export function shuffle(a, rnd = Math.random) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/* ---------- Einheiten & Zahlen ---------- */
const PRE = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
/** Wert → { n: Zahl, p: Vorsatz, f: Faktor } (1 ≤ n < 1000) */
export function prefixOf(v) { const a = Math.abs(v); if (!a) return { n: 0, p: "", f: 1 }; for (const [f, p] of PRE) if (a >= f * 0.9995) return { n: v / f, p, f }; return { n: v / 1e-12, p: "p", f: 1e-12 }; }
export const sig = (v, d = 3) => (v === 0 ? 0 : +v.toPrecision(d));
export const fmt = (v, maxDec = 4) => Number(v).toLocaleString("de-AT", { maximumFractionDigits: maxDec, useGrouping: true });
/** Größe mit Einheit (mit/ohne Vorsatz) */
export function show(k, v, pre = true) {
  const q = Q[k] || { u: "" };
  if (pre && q.pre) { const p = prefixOf(v); return `${fmt(sig(p.n, 4))} ${p.p}${q.u}`.trim(); }
  return `${fmt(sig(v, 4), 5)} ${q.u}`.trim();
}

/* ---------- Aufgaben ---------- */
/** settings: { ids: [...], mode: "rechnen"|"umformen"|"mix", pre: true } */
export function makeTask(settings, rnd = Math.random) {
  const pool = FORMULAS.filter((F) => !settings.ids || settings.ids.includes(F.id));
  if (!pool.length) return null;
  for (let tries = 0; tries < 60; tries++) {
    const F = pool[Math.floor(rnd() * pool.length)], tg = targetsOf(F), x = tg[Math.floor(rnd() * tg.length)];
    const kind = settings.mode === "umformen" ? "form" : settings.mode === "rechnen" ? "calc" : rnd() < 0.5 ? "form" : "calc";
    if (kind === "form") {
      const right = formText(F, x), wrong = wrongForms(F, x, rnd); if (wrong.length < 2) continue;
      const choices = shuffle([right, ...wrong], rnd);
      return { kind: "form", fid: F.id, x, q: `Stelle „${F.custom ? Object.values(F.show)[0] : formText(F, F.lhs)}“ nach ${sym(x)} um.`, choices, answer: choices.indexOf(right) };
    }
    // Rechnen: alle anderen Größen zufällig
    const v = {};
    const base = F.custom ? F.vars : varsOf(F);
    let ok = true;
    // Bei Formeln mit Ausgangsgröße (lhs/1. Variable) als Eingabe: erst aus Basisvariablen rechnen
    const first = F.custom ? F.vars[0] : F.lhs, inputs = base.filter((k) => k !== first);
    for (const k of inputs) { const p = Q[k].p; if (!p.length) { ok = false; break; } v[k] = p[Math.floor(rnd() * p.length)]; }
    if (!ok) continue;
    v[first] = F.custom ? F.solve[first](v) : solve(F, first, v);
    if (!Number.isFinite(v[first]) || v[first] <= 0) continue;
    v[first] = sig(v[first], 3);                       // „schöne“ gegebene Größe
    if (Q[first].max != null && v[first] > Q[first].max) continue;
    const res = F.custom ? F.solve[x](v) : solve(F, x, v);
    if (!Number.isFinite(res) || res <= 0) continue;
    if (k99(res)) continue;
    const given = base.filter((k) => k !== x);
    const unitPre = settings.pre && Q[x].pre ? prefixOf(res) : { n: res, p: "", f: 1 };
    return {
      kind: "calc", fid: F.id, x, answer: res, unit: `${unitPre.p}${Q[x].u}`, f: unitPre.f, base: Q[x].u,
      q: `${F.name}: Berechne ${Q[x].n} ${sym(x)}.`, given: given.map((k) => `${sym(k)} = ${show(k, v[k], settings.pre)}`),
      steps: explainSteps(F, x, v, res, unitPre), v: { ...v },
    };
  }
  return null;
}
const k99 = (v) => v > 1e12 || v < 1e-12;
const base = (k, v) => show(k, v, false);

/** Rechenweg Schritt für Schritt, so wie man ihn auf Papier schreibt. */
export function explainSteps(F, x, v, res, unitPre = { p: "", f: 1 }) {
  const steps = [];
  const right = formText(F, x);
  steps.push(F.custom || x === F.lhs ? `Formel: ${right}` : `Formel nach ${sym(x)} umstellen: ${right}`);
  // 1. Vorsätze weg: alles in Grundeinheiten
  const conv = Object.keys(v).filter((k) => k !== x && Q[k] && Q[k].pre && prefixOf(v[k]).p).map((k) => `${sym(k)} = ${show(k, v[k], true)} = ${base(k, v[k])}`);
  if (conv.length) steps.push(`In Grundeinheiten umrechnen: ${conv.join(" · ")}`);
  // 2. Einsetzen (mit Klammern bei Quadrat)
  steps.push(`Einsetzen: ${sym(x)} = ${subst(F, x, v, false)}`);
  // 3. Zwischenschritte bei Produktformeln: Quadrate ausrechnen, Zähler/Nenner
  if (!F.custom) {
    const all = { [F.lhs]: -1, ...F.f }, ex = all[x], num = [], den = [], sq = [];
    for (const [k, e] of Object.entries(all)) {
      if (k === x) continue;
      const val = CONST[k] != null ? CONST[k] : v[k], q = -e * Math.sign(ex), p = Math.abs(q); // für x^|ex| = …
      if (p === 2) sq.push(`${sym(k)}² = ${fmt(sig(val, 4), 6)}² = ${fmt(sig(val * val, 4), 8)}`);
      (q > 0 ? num : den).push(val ** p);
    }
    if (sq.length) steps.push(`Quadrat zuerst: ${sq.join(" · ")}`);
    const N = num.reduce((a, b) => a * b, 1), D = den.reduce((a, b) => a * b, 1);
    if (den.length && (num.length > 1 || den.length > 1)) steps.push(`Oben: ${fmt(sig(N, 4), 6)} · unten: ${fmt(sig(D, 4), 8)}`);
    const raw = N / D;
    if (Math.abs(ex) === 2) steps.push(`Wurzel ziehen: ${sym(x)} = √${fmt(sig(raw, 4), 6)} = ${fmt(sig(Math.sqrt(raw), 4), 6)} ${Q[x].u}`);
    else if (den.length) steps.push(`Rechnen: ${sym(x)} = ${fmt(sig(N, 4), 6)} / ${fmt(sig(D, 4), 8)} = ${fmt(sig(raw, 4), 6)} ${Q[x].u}`);
  }
  steps.push(`Ergebnis: ${sym(x)} ≈ ${fmt(sig(res / unitPre.f, 4))} ${unitPre.p}${Q[x].u}`.trim() + (unitPre.p ? ` (= ${base(x, res)})` : ""));
  return steps;
}

/** Was hat man wahrscheinlich falsch gemacht? Vergleicht die Eingabe mit typischen Fehlern. */
export function diagnose(task, raw) {
  if (!task || task.kind !== "calc" || !task.v) return null;
  let s = String(raw || "").trim().replace(/\s+/g, "");
  if (/,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, "");
  const got = Number(s) * (task.f || 1); if (!Number.isFinite(got) || !got) return null;
  const F = FORMULAS.find((y) => y.id === task.fid), x = task.x, v = task.v, want = task.answer;
  const near = (a) => Number.isFinite(a) && a !== 0 && Math.abs(got - a) <= Math.abs(a) * 0.01;
  const tips = [];
  // Vorsatz / Einheit
  for (const [f, t] of [[1000, "1000-mal zu groß"], [1e-3, "1000-mal zu klein"], [1e6, "1 Million-mal zu groß"], [1e-6, "1 Million-mal zu klein"]])
    if (near(want * f)) tips.push(`Dein Ergebnis ist genau ${t} – da ist ein Vorsatz (m, k, µ …) verrutscht. Rechne zuerst alles in Grundeinheiten um (z. B. 200 mA = 0,2 A) und gib das Ergebnis in ${task.unit || "der angegebenen Einheit"} ein.`);
  if (F && !F.custom && x !== F.lhs) {
    const all = { [F.lhs]: -1, ...F.f }, ex = all[x];
    const calcWith = (mut, root = Math.abs(ex) === 2) => { let r = 1; for (const [k, e] of Object.entries(mut)) { if (k === x) continue; const val = CONST[k] != null ? CONST[k] : v[k]; r *= val ** (-e * Math.sign(ex)); } return root ? Math.sqrt(r) : r; };
    for (const k of Object.keys(all)) if (k !== x && Math.abs(all[k]) === 2) {
      const m = { ...all, [k]: Math.sign(all[k]) };
      if (near(calcWith(m))) tips.push(`Du hast ${sym(k)} nicht quadriert. In der Formel steht ${sym(k)}² – also zuerst ${sym(k)} · ${sym(k)} rechnen (${fmt(sig(v[k], 4), 6)} · ${fmt(sig(v[k], 4), 6)} = ${fmt(sig(v[k] * v[k], 4), 8)}), dann weiter.`);
    }
    if (Math.abs(ex) === 2 && near(calcWith(all, false))) tips.push(`Fast! Du hast nur die Wurzel vergessen: ${sym(x)} steht in der Formel im Quadrat, also am Ende noch √ ziehen.`);
    for (const k of Object.keys(all)) if (k !== x) {
      const m = { ...all, [k]: -all[k] };
      if (near(calcWith(m))) tips.push(`${sym(k)} steht auf der falschen Seite des Bruchstrichs. Richtig umgestellt: ${formText(F, x)}.`);
    }
    if (near(1 / want)) tips.push(`Du hast den Bruch verkehrt herum gerechnet (oben und unten vertauscht). Richtig: ${formText(F, x)}.`);
  }
  if (!tips.length) {
    const r = got / want;
    tips.push(r > 1.01 && r < 1.2 || r < 0.99 && r > 0.8 ? "Knapp daneben – wahrscheinlich zu früh gerundet. Rechne mit allen Kommastellen und runde erst am Ende." : `Schau dir den Rechenweg unten Schritt für Schritt an und vergleiche mit deinem Zettel – wo weicht deine Rechnung ab?`);
  }
  return [...new Set(tips)].slice(0, 2);
}
function subst(F, x, v, pre) {
  let s = formText(F, x).replace(/^.*? = /, "");
  const keys = Object.keys(Q).sort((a, b) => sym(b).length - sym(a).length);
  const done = [];
  for (const k of keys) {
    if (k === x || v[k] == null) continue;
    const name = sym(k), re = new RegExp(`(^|[^A-Za-z_])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z_0-9])`, "g");
    s = s.replace(new RegExp(re.source + "(²?)", "g"), (m, a, sq) => { const tok = `§${done.length}§`; const val = show(k, v[k], pre); done.push(sq ? `(${val})²` : val); return a + tok; });
  }
  return s.replace(/§(\d+)§/g, (m, i) => done[Number(i)]);
}

/** Ergebnis mit (evtl. anderer) Einheit prüfen, z. B. „0,22“ + „A“ statt „223“ mA. */
const PF = { G: 1e9, M: 1e6, k: 1e3, "": 1, m: 1e-3, "µ": 1e-6, u: 1e-6, n: 1e-9, p: 1e-12 };
export function checkUnit(task, raw, unit = "") {
  if (task.kind !== "calc") return check(task, raw);
  const u = String(unit || "").replace(/\s+/g, ""), b = task.base || "";
  if (b && u.endsWith(b) && PF[u.slice(0, u.length - b.length)] != null) {
    const f = PF[u.slice(0, u.length - b.length)];
    return check({ ...task, f: 1, answer: task.answer / f }, raw);
  }
  return check(task, raw);
}
/** Eingabe prüfen: 1 % Abweichung ist ok (Rundung von Zwischenergebnissen). Eingabe in der angegebenen Einheit. */
export function check(task, raw) {
  if (task.kind === "form") return Number(raw) === task.answer;
  let s = String(raw || "").trim().replace(/\s+/g, "");
  if (/,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/,/g, "");
  const n = Number(s); if (!Number.isFinite(n)) return false;
  const want = task.answer / task.f; return Math.abs(n - want) <= Math.abs(want) * 0.01 + 1e-12;
}

/** Umformen erklärt: was wandert wohin? (Produktformeln) */
export function formSteps(F, x) {
  const right = formText(F, x);
  if (F.custom) return [`Ausgangsformel: ${Object.values(F.show)[0]}`, `Nach ${sym(x)} umgestellt: ${right}`];
  const start = formText(F, F.lhs);
  if (x === F.lhs) return [`${sym(x)} steht schon allein: ${start}`];
  const out = [`Ausgangsformel: ${start}`, `Ziel: ${sym(x)} soll allein auf einer Seite stehen.`];
  for (const [k, e] of Object.entries(F.f)) {
    if (k === x) continue;
    const t = sym(k) + (Math.abs(e) === 2 ? "²" : "");
    out.push(e > 0 ? `„· ${t}“ steht bei ${sym(x)} → kommt auf die andere Seite als „/ ${t}“ (unter den Bruchstrich).` : `„/ ${t}“ steht bei ${sym(x)} → kommt auf die andere Seite als „· ${t}“ (über den Bruchstrich).`);
  }
  const ex = F.f[x];
  if (ex < 0) out.push(`${sym(x)} steht unten im Bruch → beide Seiten umdrehen (Kehrwert), dann ist ${sym(x)} oben.`);
  if (Math.abs(ex) === 2) out.push(`Gesucht ist ${sym(x)}, in der Formel steht aber ${sym(x)}² → am Ende die Wurzel ziehen.`);
  out.push(`Ergebnis: ${right}`);
  return out;
}
