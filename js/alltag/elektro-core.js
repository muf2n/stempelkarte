// Update 10 F – ⚡ Elektro-Werkzeugkasten: reine Rechenlogik ohne DOM (Node-testbar, test/elektro-core.test.mjs).
// Einheiten umrechnen (SI-Vorsätze), mm² ↔ AWG (Näherung nach der AWG-Definitionsformel), Widerstands-Farbcode (IEC 60062) in beide Richtungen.
import { parseNum, fmtAuto } from "./lap-core.js";

export { parseNum, fmtAuto };

/* ---------------- Einheiten ---------------- */

// Gruppen: Faktor relativ zur Basiseinheit
export const UNIT_GROUPS = [
  { id: "strom", e: "🔌", t: "Strom", units: [["µA", 1e-6], ["mA", 1e-3], ["A", 1], ["kA", 1e3]] },
  { id: "spannung", e: "⚡", t: "Spannung", units: [["µV", 1e-6], ["mV", 1e-3], ["V", 1], ["kV", 1e3]] },
  { id: "leistung", e: "💡", t: "Leistung", units: [["mW", 1e-3], ["W", 1], ["kW", 1e3], ["MW", 1e6]] },
  { id: "energie", e: "🔋", t: "Energie", units: [["Wh", 1], ["kWh", 1e3], ["MWh", 1e6], ["J (Ws)", 1 / 3600], ["kJ", 1000 / 3600]] },
  { id: "widerstand", e: "🟫", t: "Widerstand", units: [["mΩ", 1e-3], ["Ω", 1], ["kΩ", 1e3], ["MΩ", 1e6]] },
  { id: "kapazitaet", e: "🔲", t: "Kapazität", units: [["pF", 1e-12], ["nF", 1e-9], ["µF", 1e-6], ["mF", 1e-3], ["F", 1]] },
  { id: "induktivitaet", e: "🌀", t: "Induktivität", units: [["µH", 1e-6], ["mH", 1e-3], ["H", 1]] },
  { id: "frequenz", e: "〰️", t: "Frequenz", units: [["Hz", 1], ["kHz", 1e3], ["MHz", 1e6], ["GHz", 1e9]] },
  { id: "querschnitt", e: "🧵", t: "Querschnitt", units: [["mm²", 1], ["AWG", null]] },
];
export const groupById = (id) => UNIT_GROUPS.find((g) => g.id === id) || null;

/** Wert von Einheit a nach b (gleiche Gruppe). → Zahl oder NaN */
export function convert(value, groupId, from, to) {
  const g = groupById(groupId);
  const v = typeof value === "number" ? value : parseNum(value);
  if (!g || !Number.isFinite(v)) return NaN;
  if (groupId === "querschnitt") {
    if (from === to) return v;
    if (from === "mm²" && to === "AWG") return mm2ToAwg(v);
    if (from === "AWG" && to === "mm²") return awgToMm2(v);
    return NaN;
  }
  const fa = (g.units.find((u) => u[0] === from) || [])[1];
  const fb = (g.units.find((u) => u[0] === to) || [])[1];
  if (!fa || !fb) return NaN;
  return clean(v * fa / fb);
}
/** Alle Einheiten der Gruppe auf einmal → [{ unit, value }] */
export function convertAll(value, groupId, from) {
  const g = groupById(groupId);
  if (!g) return [];
  return g.units.map(([u]) => ({ unit: u, value: convert(value, groupId, from, u) }));
}
// Gleitkomma-Rauschen glätten (0.1 * 3 → 0.3)
function clean(x) { if (!Number.isFinite(x) || x === 0) return x; const p = 10 ** (12 - Math.ceil(Math.log10(Math.abs(x)))); return Math.round(x * p) / p; }

/* ---------------- AWG ↔ mm² ----------------
 * Definition (ASTM B258): d(n) = 0,127 mm · 92^((36 − n) / 39); AWG 0 = „1/0“, 00 = −1, 000 = −2, 0000 = −3.
 * Querschnitt A = π/4 · d². Nur Näherung für Einzeldraht – Litzen und Normquerschnitte (1,5 / 2,5 / 4 mm²) passen nie genau. */
export const AWG_NOTE = "≈ Näherung für massiven Einzeldraht (ASTM B258). Metrische Normquerschnitte entsprechen keinem AWG genau – im Zweifel den größeren Querschnitt nehmen.";
export function awgDiameter(n) { return 0.127 * 92 ** ((36 - n) / 39); }
export function awgToMm2(n) {
  const x = typeof n === "number" ? n : parseAwg(n);
  if (!Number.isFinite(x) || x < -3 || x > 40) return NaN;
  const d = awgDiameter(x);
  return Math.round((Math.PI / 4) * d * d * 10000) / 10000;
}
/** mm² → nächste AWG-Zahl (gerundet, −3 = 4/0). */
export function mm2ToAwg(a) {
  const x = typeof a === "number" ? a : parseNum(a);
  if (!Number.isFinite(x) || x <= 0) return NaN;
  const d = Math.sqrt((4 * x) / Math.PI);
  const n = 36 - 39 * Math.log(d / 0.127) / Math.log(92);
  return Math.round(n);
}
/** "4/0", "0000", "00", "12" → Zahl */
export function parseAwg(s) {
  const t = String(s ?? "").trim();
  const m = /^(\d)\/0$/.exec(t);
  if (m) return 1 - Number(m[1]);
  if (/^0{2,4}$/.test(t)) return 1 - t.length;
  return parseNum(t);
}
export const awgLabel = (n) => (n <= 0 ? `${1 - n}/0` : String(n));

/** Formatierung mit Vorsatz-tauglicher Genauigkeit. */
export function fmtVal(x) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  if (a !== 0 && (a >= 1e9 || a < 1e-4)) return x.toExponential(3).replace(".", ",").replace("e", " · 10^").replace("+", "");
  if (a >= 1000) return String(Math.round(x * 100) / 100).replace(".", ",");
  return fmtAuto(x);
}

/* ---------------- Widerstands-Farbcode (IEC 60062) ---------------- */

export const COLORS = [
  { id: "schwarz", t: "Schwarz", hex: "#1b1b1b", digit: 0, mult: 1, tc: 250 },
  { id: "braun", t: "Braun", hex: "#7a4a24", digit: 1, mult: 10, tol: 1, tc: 100 },
  { id: "rot", t: "Rot", hex: "#d42020", digit: 2, mult: 100, tol: 2, tc: 50 },
  { id: "orange", t: "Orange", hex: "#f07c12", digit: 3, mult: 1e3, tol: 0.05, tc: 15 },
  { id: "gelb", t: "Gelb", hex: "#f4d21f", digit: 4, mult: 1e4, tol: 0.02, tc: 25 },
  { id: "gruen", t: "Grün", hex: "#1f9d48", digit: 5, mult: 1e5, tol: 0.5, tc: 20 },
  { id: "blau", t: "Blau", hex: "#2463d6", digit: 6, mult: 1e6, tol: 0.25, tc: 10 },
  { id: "violett", t: "Violett", hex: "#8a3fd1", digit: 7, mult: 1e7, tol: 0.1, tc: 5 },
  { id: "grau", t: "Grau", hex: "#8c8c8c", digit: 8, mult: 1e8, tol: 0.01, tc: 1 },
  { id: "weiss", t: "Weiß", hex: "#f6f6f6", digit: 9, mult: 1e9 },
  { id: "gold", t: "Gold", hex: "#c9a227", mult: 0.1, tol: 5 },
  { id: "silber", t: "Silber", hex: "#c0c0c0", mult: 0.01, tol: 10 },
  { id: "keine", t: "Keine", hex: "transparent", tol: 20 },
];
export const colorById = (id) => COLORS.find((c) => c.id === id) || null;
export const DIGIT_COLORS = COLORS.filter((c) => c.digit != null).map((c) => c.id);
export const MULT_COLORS = COLORS.filter((c) => c.mult != null).map((c) => c.id);
export const TOL_COLORS = COLORS.filter((c) => c.tol != null).map((c) => c.id);

/** Bänder → { ohm, tol, text } oder null. bands: 4 (Ziffer, Ziffer, Multiplikator, Toleranz) oder 5 (3 Ziffern, Mult., Tol.). */
export function decodeBands(bands) {
  const b = (bands || []).map(colorById);
  if (!(b.length === 4 || b.length === 5) || b.some((x) => !x)) return null;
  const nd = b.length - 2;
  const digits = b.slice(0, nd);
  if (digits.some((x) => x.digit == null)) return null;
  if (digits[0].digit === 0 && nd === 2 && digits[1].digit === 0) { /* 0 Ω mit zwei schwarzen Ringen ist erlaubt (Nullohm) */ }
  const mult = b[nd], tol = b[nd + 1];
  if (mult.mult == null || tol.tol == null) return null;
  const base = digits.reduce((a, x) => a * 10 + x.digit, 0);
  const ohm = clean(base * mult.mult);
  return { ohm, tol: tol.tol, text: `${ohmText(ohm)} ±${String(tol.tol).replace(".", ",")} %` };
}

/** 4700 → "4,7 kΩ" */
export function ohmText(ohm) {
  if (!Number.isFinite(ohm)) return "–";
  const a = Math.abs(ohm);
  const [d, u] = a >= 1e9 ? [1e9, "GΩ"] : a >= 1e6 ? [1e6, "MΩ"] : a >= 1e3 ? [1e3, "kΩ"] : [1, "Ω"];
  return `${String(clean(ohm / d)).replace(".", ",")} ${u}`;
}

/** Eingabe wie "4k7", "4,7k", "470R", "2M2", "1,5 MΩ", "100" → Ohm (oder NaN). k = Kilo, M/m = Mega, G = Giga (RKM-Code). */
export function parseOhm(s) {
  const t = String(s ?? "").trim().replace(/\s+/g, "").replace(/Ω|ohm/gi, "").replace(",", ".");
  const fac = (c) => ({ "": 1, r: 1, k: 1e3, m: 1e6, g: 1e9 })[String(c || "").toLowerCase()];
  let m = /^(\d+(?:\.\d+)?|\.\d+)([rkmg]?)$/i.exec(t);
  if (m) return clean(Number(m[1]) * fac(m[2]));
  m = /^(\d*)([rkmg])(\d+)$/i.exec(t); // RKM: 4k7, R47, 2M2
  if (m) return clean(Number(`${m[1] || "0"}.${m[3]}`) * fac(m[2]));
  return NaN;
}

/**
 * Wert → Farbringe. bands = 4 → 2 Ziffern, 5 → 3 Ziffern. tol in %.
 * → { bands: [ids], exact: bool, ohm (dargestellter Wert) } oder null (außerhalb 0,1 Ω … 99,9 GΩ).
 */
export function encodeOhm(ohm, bands = 4, tol = bands === 5 ? 1 : 5) {
  const v = typeof ohm === "number" ? ohm : parseOhm(ohm);
  if (!Number.isFinite(v) || v < 0) return null;
  const nd = bands === 5 ? 3 : 2;
  const tc = COLORS.find((c) => c.tol === tol) || null;
  if (!tc) return null;
  if (v === 0) return { bands: [...Array(nd).fill("schwarz"), "schwarz", tc.id], exact: true, ohm: 0 };
  let exp = Math.floor(Math.log10(v)) - (nd - 1);
  let sig = Math.round(v / 10 ** exp);
  if (sig >= 10 ** nd) { sig = Math.round(sig / 10); exp += 1; }
  const mc = COLORS.find((c) => c.mult != null && Math.abs(Math.log10(c.mult) - exp) < 1e-9);
  if (!mc) return null;
  const digits = String(sig).padStart(nd, "0").split("").map(Number);
  const ids = digits.map((d) => COLORS.find((c) => c.digit === d).id);
  const shown = clean(sig * 10 ** exp);
  return { bands: [...ids, mc.id, tc.id], exact: Math.abs(shown - v) <= Math.abs(v) * 1e-9, ohm: shown };
}

/* ---------------- E-Reihen (nächster Normwert) ---------------- */
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
export const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
/** Nächster Wert der E-Reihe (logarithmisch nächster). */
export function nearestE(ohm, series = E24) {
  if (!(ohm > 0)) return NaN;
  const exp = Math.floor(Math.log10(ohm));
  let best = NaN, bd = Infinity;
  for (const e of [exp - 1, exp, exp + 1]) for (const m of series) {
    const c = clean(m * 10 ** e);
    const d = Math.abs(Math.log(c / ohm));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
