// Alltag › 🎓 LAP Elektrotechnik: reine Logik (ohne DOM) – Formel-Rechner, Rechenaufgaben-Generator,
// Antwortprüfung mit Toleranz, Prüfungssimulation (Fragen ziehen, auswerten), Schwächen je Thema.
// SRS/Serie kommen aus ./srs-core.js (gemeinsam mit Japanisch). Unit-Tests: test/lap-core.test.mjs
import { shuffle } from "./srs-core.js";

/* ---------- Zahlen ---------- */
/** Zahl auf deutsch formatieren (Komma, ohne Tausenderpunkte), höchstens `dec` Nachkommastellen, ohne überflüssige Nullen. */
export function fmt(x, dec = 2) {
  if (!Number.isFinite(x)) return "–";
  const f = 10 ** dec;
  let r = Math.round(x * f) / f;
  if (Object.is(r, -0)) r = 0;
  return String(r).replace(".", ",");
}
/** Für sehr kleine/große Werte sinnvolle Stellen wählen (3 signifikante Stellen, mind. 0, max. 4 Nachkommastellen). */
export function fmtAuto(x) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x);
  const dec = a === 0 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  return fmt(x, dec);
}
/** Eingabe wie „1,5“, „1.5 A“, „ -0,25 Ω “ → Zahl (oder NaN). */
export function parseNum(s) {
  const m = String(s ?? "").replace(/\s+/g, "").match(/^[-+]?(\d+(?:[.,]\d*)?|[.,]\d+)/);
  if (!m) return NaN;
  return Number(m[0].replace(",", "."));
}
/** Antwort mit relativer Toleranz prüfen (Standard 2 %, damit Rundungen in Zwischenschritten passen). */
export function checkAnswer(input, expected, tol = 0.02) {
  const v = typeof input === "number" ? input : parseNum(input);
  if (!Number.isFinite(v)) return { ok: false, value: NaN, empty: String(input ?? "").trim() === "" };
  const lim = Math.max(Math.abs(expected) * tol, 1e-9);
  return { ok: Math.abs(v - expected) <= lim, value: v, empty: false };
}

/* ---------- Formel-Rechner ---------- */
const num = (v) => (v === "" || v == null ? NaN : typeof v === "number" ? v : parseNum(v));
const given = (o, keys) => keys.filter((k) => Number.isFinite(num(o[k])));

/** Aus genau zwei bekannten Größen die dritte berechnen. rel: { a: [b, c, (b,c)=>a], … } */
function solve3(vals, rel) {
  const keys = Object.keys(rel);
  const g = given(vals, keys);
  if (g.length !== 2) return null;
  const miss = keys.find((k) => !g.includes(k));
  const v = rel[miss](num(vals[g[0]]), num(vals[g[1]]), g);
  if (!Number.isFinite(v) || v < 0) return null;
  const out = {};
  for (const k of keys) out[k] = k === miss ? v : num(vals[k]);
  out.solved = miss;
  return out;
}
const pick = (g, a, b, name) => (g[0] === name ? a : b);

/** U = R · I – zwei Werte angeben, der dritte wird berechnet. */
export function solveOhm(v) {
  return solve3(v, {
    U: (a, b, g) => pick(g, a, b, "R") * pick(g, a, b, "I"),
    R: (a, b, g) => pick(g, a, b, "U") / pick(g, a, b, "I"),
    I: (a, b, g) => pick(g, a, b, "U") / pick(g, a, b, "R"),
  });
}
/** P = U · I */
export function solvePUI(v) {
  return solve3(v, {
    P: (a, b, g) => pick(g, a, b, "U") * pick(g, a, b, "I"),
    U: (a, b, g) => pick(g, a, b, "P") / pick(g, a, b, "I"),
    I: (a, b, g) => pick(g, a, b, "P") / pick(g, a, b, "U"),
  });
}
/** P = I² · R */
export function solvePI2R(v) {
  return solve3(v, {
    P: (a, b, g) => pick(g, a, b, "I") ** 2 * pick(g, a, b, "R"),
    I: (a, b, g) => Math.sqrt(pick(g, a, b, "P") / pick(g, a, b, "R")),
    R: (a, b, g) => pick(g, a, b, "P") / pick(g, a, b, "I") ** 2,
  });
}
/** Leiterwiderstand R = l / (κ · A); twoWay: Hin- und Rückleiter (2 · l). */
export function wireR({ l, A, kappa = 56, twoWay = false }) {
  l = num(l); A = num(A); kappa = num(kappa);
  if (!(l > 0 && A > 0 && kappa > 0)) return null;
  return ((twoWay ? 2 : 1) * l) / (kappa * A);
}
export function seriesR(list) {
  const r = (list || []).map(num).filter((x) => Number.isFinite(x));
  if (!r.length || r.some((x) => x < 0)) return null;
  return r.reduce((s, x) => s + x, 0);
}
export function parallelR(list) {
  const r = (list || []).map(num).filter((x) => Number.isFinite(x));
  if (!r.length || r.some((x) => x <= 0)) return null;
  return 1 / r.reduce((s, x) => s + 1 / x, 0);
}
/** Spannungsfall: 1-phasig ΔU = 2·l·I·cosφ/(κ·A), 3-phasig ΔU = √3·l·I·cosφ/(κ·A). → { dU (V), pct (%) } */
export function voltageDrop({ phases = 1, l, I, A, kappa = 56, cosphi = 1, U }) {
  l = num(l); I = num(I); A = num(A); kappa = num(kappa); cosphi = num(cosphi);
  U = Number.isFinite(num(U)) ? num(U) : phases === 3 ? 400 : 230;
  if (!(l > 0 && I > 0 && A > 0 && kappa > 0 && cosphi > 0 && cosphi <= 1 && U > 0)) return null;
  const k = phases === 3 ? Math.sqrt(3) : 2;
  const dU = (k * l * I * cosphi) / (kappa * A);
  return { dU, pct: (dU / U) * 100, U, k };
}
/** Energie & Kosten: P in W, Laufzeit h (pro Tag) · Tage, Preis in Cent/kWh → { kWh, euro } */
export function energyCost({ P, h, days = 1, priceCt }) {
  P = num(P); h = num(h); days = num(days); priceCt = num(priceCt);
  if (!(P >= 0 && h >= 0 && days >= 0)) return null;
  const kWh = (P / 1000) * h * days;
  return { kWh, euro: Number.isFinite(priceCt) && priceCt >= 0 ? (kWh * priceCt) / 100 : null };
}
/** Drehstrom-Wirkleistung P = √3 · U · I · cos φ */
export function power3({ U = 400, I, cosphi = 1 }) {
  U = num(U); I = num(I); cosphi = num(cosphi);
  if (!(U > 0 && I >= 0 && cosphi > 0 && cosphi <= 1)) return null;
  return Math.sqrt(3) * U * I * cosphi;
}

/* ---------- Rechenaufgaben ---------- */
const between = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));
const oneOf = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const u = (x, unit) => `${fmtAuto(x)} ${unit}`;

export const PROBLEM_TYPES = [
  { id: "ohm", name: "Ohmsches Gesetz", emoji: "⚡" },
  { id: "power", name: "Leistung P = U · I", emoji: "💡" },
  { id: "pi2r", name: "Leistung P = I² · R", emoji: "🔥" },
  { id: "series", name: "Reihenschaltung", emoji: "➖" },
  { id: "parallel", name: "Parallelschaltung", emoji: "🟰" },
  { id: "wire", name: "Leitungswiderstand", emoji: "🧵" },
  { id: "du1", name: "Spannungsfall 1-phasig", emoji: "📉" },
  { id: "du3", name: "Spannungsfall Drehstrom", emoji: "🌀" },
  { id: "energy", name: "Energie & Kosten", emoji: "💶" },
  { id: "p3", name: "Drehstromleistung", emoji: "🏭" },
];

/**
 * Eine Rechenaufgabe mit Zufallswerten erzeugen.
 * @returns {{type, text, ask, unit, answer:number, tol:number, steps:string[]}}
 */
export function makeProblem(type, rand = Math.random) {
  const T = PROBLEM_TYPES.some((t) => t.id === type) ? type : oneOf(rand, PROBLEM_TYPES).id;
  const A_LIST = [1.5, 2.5, 4, 6];
  switch (T) {
    case "ohm": {
      const variant = oneOf(rand, ["I", "U", "R"]);
      const U = oneOf(rand, [12, 24, 48, 230]);
      const R = oneOf(rand, U === 230 ? [23, 46, 92, 115, 230, 460] : [2, 4, 6, 8, 12, 24, 48]);
      const I = U / R;
      if (variant === "I") return { type: T, text: `An einem Widerstand mit ${u(R, "Ω")} liegt eine Spannung von ${u(U, "V")}. Wie groß ist der Strom?`, ask: "I", unit: "A", answer: I, tol: 0.02,
        steps: ["Gesucht: Strom I", "Formel: I = U / R", `Einsetzen: I = ${u(U, "V")} / ${u(R, "Ω")}`, `Ergebnis: I = ${u(I, "A")}`] };
      if (variant === "U") return { type: T, text: `Durch einen Widerstand mit ${u(R, "Ω")} fließt ein Strom von ${u(I, "A")}. Wie groß ist die Spannung?`, ask: "U", unit: "V", answer: U, tol: 0.02,
        steps: ["Gesucht: Spannung U", "Formel: U = R · I", `Einsetzen: U = ${u(R, "Ω")} · ${u(I, "A")}`, `Ergebnis: U = ${u(U, "V")}`] };
      return { type: T, text: `Ein Verbraucher nimmt an ${u(U, "V")} einen Strom von ${u(I, "A")} auf. Wie groß ist sein Widerstand?`, ask: "R", unit: "Ω", answer: R, tol: 0.02,
        steps: ["Gesucht: Widerstand R", "Formel: R = U / I", `Einsetzen: R = ${u(U, "V")} / ${u(I, "A")}`, `Ergebnis: R = ${u(R, "Ω")}`] };
    }
    case "power": {
      const variant = oneOf(rand, ["I", "P"]);
      const U = 230;
      if (variant === "I") {
        const [dev, P] = oneOf(rand, [["Wasserkocher", 2000], ["Föhn", 1800], ["Heizlüfter", 2300], ["Bohrmaschine", 750], ["Kaffeemaschine", 1400], ["Staubsauger", 900]]);
        const I = P / U;
        return { type: T, text: `Ein ${dev} hat eine Leistung von ${u(P, "W")} an ${u(U, "V")}. Welcher Strom fließt?`, ask: "I", unit: "A", answer: I, tol: 0.02,
          steps: ["Gesucht: Strom I", "Formel: P = U · I  →  I = P / U", `Einsetzen: I = ${u(P, "W")} / ${u(U, "V")}`, `Ergebnis: I ≈ ${u(I, "A")}`] };
      }
      const I = oneOf(rand, [0.5, 2, 4, 6.5, 8, 10, 13]);
      const P = U * I;
      return { type: T, text: `Ein Gerät an ${u(U, "V")} nimmt ${u(I, "A")} auf. Wie groß ist seine Leistung (ohmsche Last)?`, ask: "P", unit: "W", answer: P, tol: 0.02,
        steps: ["Gesucht: Leistung P", "Formel: P = U · I", `Einsetzen: P = ${u(U, "V")} · ${u(I, "A")}`, `Ergebnis: P = ${u(P, "W")}`] };
    }
    case "pi2r": {
      const variant = oneOf(rand, ["P", "I"]);
      const R = oneOf(rand, [2, 5, 10, 20, 47, 100]);
      const I = oneOf(rand, [0.5, 1, 1.5, 2, 3]);
      const P = I * I * R;
      if (variant === "P") return { type: T, text: `Durch einen Widerstand mit ${u(R, "Ω")} fließen ${u(I, "A")}. Welche Leistung wird in Wärme umgesetzt?`, ask: "P", unit: "W", answer: P, tol: 0.02,
        steps: ["Gesucht: Leistung P", "Formel: P = I² · R", `Einsetzen: P = (${u(I, "A")})² · ${u(R, "Ω")} = ${fmtAuto(I * I)} A² · ${u(R, "Ω")}`, `Ergebnis: P = ${u(P, "W")}`] };
      return { type: T, text: `Ein Widerstand mit ${u(R, "Ω")} setzt ${u(P, "W")} um. Welcher Strom fließt?`, ask: "I", unit: "A", answer: I, tol: 0.02,
        steps: ["Gesucht: Strom I", "Formel: P = I² · R  →  I = √(P / R)", `Einsetzen: I = √(${u(P, "W")} / ${u(R, "Ω")}) = √${fmtAuto(P / R)}`, `Ergebnis: I = ${u(I, "A")}`] };
    }
    case "series": {
      const n = between(rand, 2, 4);
      const rs = Array.from({ length: n }, () => oneOf(rand, [10, 15, 22, 33, 47, 56, 68, 100, 150, 220]));
      const R = seriesR(rs);
      return { type: T, text: `${n} Widerstände (${rs.map((r) => u(r, "Ω")).join(", ")}) sind in Reihe geschaltet. Wie groß ist der Gesamtwiderstand?`, ask: "Rges", unit: "Ω", answer: R, tol: 0.01,
        steps: ["Gesucht: Gesamtwiderstand Rges", "Formel: Rges = R1 + R2 + …", `Einsetzen: Rges = ${rs.map((r) => fmtAuto(r)).join(" + ")} Ω`, `Ergebnis: Rges = ${u(R, "Ω")}`] };
    }
    case "parallel": {
      const n = between(rand, 2, 3);
      const rs = Array.from({ length: n }, () => oneOf(rand, [10, 20, 30, 40, 60, 100, 120, 200]));
      const R = parallelR(rs);
      const inv = rs.map((r) => `1/${fmtAuto(r)}`).join(" + ");
      const steps = ["Gesucht: Gesamtwiderstand Rges", "Formel: 1 / Rges = 1 / R1 + 1 / R2 + …", `Einsetzen: 1 / Rges = ${inv} = ${fmt(1 / R, 4)} 1/Ω`, `Ergebnis: Rges = 1 / ${fmt(1 / R, 4)} ≈ ${u(R, "Ω")}`];
      if (n === 2) steps.splice(2, 0, `(Für zwei Widerstände kürzer: Rges = R1 · R2 / (R1 + R2) = ${fmtAuto(rs[0] * rs[1])} / ${fmtAuto(rs[0] + rs[1])})`);
      return { type: T, text: `${n} Widerstände (${rs.map((r) => u(r, "Ω")).join(", ")}) sind parallel geschaltet. Wie groß ist der Gesamtwiderstand?`, ask: "Rges", unit: "Ω", answer: R, tol: 0.02, steps };
    }
    case "wire": {
      const l = oneOf(rand, [10, 15, 20, 25, 30, 40, 50]);
      const A = oneOf(rand, A_LIST);
      const R = wireR({ l, A, kappa: 56, twoWay: true });
      return { type: T, text: `Eine Kupferleitung (κ = 56 m/(Ω·mm²)) mit ${u(A, "mm²")} ist ${u(l, "m")} lang (einfache Länge, Wechselstrom). Wie groß ist der Leitungswiderstand für Hin- und Rückleiter?`, ask: "RL", unit: "Ω", answer: R, tol: 0.02,
        steps: ["Gesucht: Leitungswiderstand RL (Hin + Rück)", "Formel: RL = 2 · l / (κ · A)", `Einsetzen: RL = 2 · ${u(l, "m")} / (56 m/(Ω·mm²) · ${u(A, "mm²")})`, `= ${fmtAuto(2 * l)} / ${fmtAuto(56 * A)} Ω`, `Ergebnis: RL ≈ ${u(R, "Ω")}`] };
    }
    case "du1": {
      const l = oneOf(rand, [15, 20, 25, 30, 35, 40]);
      const A = oneOf(rand, [1.5, 2.5, 4]);
      const I = oneOf(rand, [6, 8, 10, 13, 16]);
      const r = voltageDrop({ phases: 1, l, I, A, kappa: 56, cosphi: 1, U: 230 });
      return { type: T, text: `Ein ohmscher Verbraucher (cos φ = 1) an 230 V nimmt ${u(I, "A")} auf. Die Kupferleitung (κ = 56) hat ${u(A, "mm²")} und ist ${u(l, "m")} lang. Wie groß ist der Spannungsfall in Prozent?`, ask: "ΔU", unit: "%", answer: r.pct, tol: 0.03,
        steps: ["Gesucht: Spannungsfall ΔU in %", "Formel: ΔU = 2 · l · I · cos φ / (κ · A)", `Einsetzen: ΔU = 2 · ${fmtAuto(l)} m · ${fmtAuto(I)} A · 1 / (56 · ${fmtAuto(A)} mm²)`, `ΔU ≈ ${u(r.dU, "V")}`, `In Prozent: ΔU% = ΔU / U · 100 = ${fmtAuto(r.dU)} V / 230 V · 100`, `Ergebnis: ΔU ≈ ${u(r.pct, "%")}`] };
    }
    case "du3": {
      const l = oneOf(rand, [20, 30, 40, 50, 60]);
      const A = oneOf(rand, [2.5, 4, 6, 10]);
      const I = oneOf(rand, [10, 16, 20, 25]);
      const cos = oneOf(rand, [0.8, 0.85, 0.9, 1]);
      const r = voltageDrop({ phases: 3, l, I, A, kappa: 56, cosphi: cos, U: 400 });
      return { type: T, text: `Ein Drehstrommotor (400 V, cos φ = ${fmt(cos)}) nimmt ${u(I, "A")} je Außenleiter auf. Die Kupferleitung (κ = 56) hat ${u(A, "mm²")} und ist ${u(l, "m")} lang. Wie groß ist der Spannungsfall in Prozent?`, ask: "ΔU", unit: "%", answer: r.pct, tol: 0.03,
        steps: ["Gesucht: Spannungsfall ΔU in %", "Formel: ΔU = √3 · l · I · cos φ / (κ · A)", `Einsetzen: ΔU = 1,732 · ${fmtAuto(l)} m · ${fmtAuto(I)} A · ${fmt(cos)} / (56 · ${fmtAuto(A)} mm²)`, `ΔU ≈ ${u(r.dU, "V")}`, `In Prozent: ΔU% = ${fmtAuto(r.dU)} V / 400 V · 100`, `Ergebnis: ΔU ≈ ${u(r.pct, "%")}`] };
    }
    case "energy": {
      const [dev, P] = oneOf(rand, [["Heizlüfter", 2000], ["PC", 150], ["Kühlschrank", 120], ["Fernseher", 100], ["Waschmaschine", 800], ["LED-Lampe", 10]]);
      const h = oneOf(rand, [1, 2, 3, 4, 5, 8]);
      const days = oneOf(rand, [7, 30, 365]);
      const ct = oneOf(rand, [20, 25, 30, 35]);
      const r = energyCost({ P, h, days, priceCt: ct });
      return { type: T, text: `Ein ${dev} (${u(P, "W")}) läuft ${h} h pro Tag, ${days} Tage lang. Strom kostet ${ct} Cent/kWh. Was kostet das in Euro?`, ask: "Kosten", unit: "€", answer: r.euro, tol: 0.02,
        steps: ["Gesucht: Kosten in €", "Formel: W = P · t, Kosten = W · Preis", `Leistung in kW: ${u(P, "W")} = ${fmtAuto(P / 1000)} kW`, `Zeit: ${h} h · ${days} Tage = ${h * days} h`, `W = ${fmtAuto(P / 1000)} kW · ${h * days} h = ${u(r.kWh, "kWh")}`, `Kosten = ${fmtAuto(r.kWh)} kWh · ${fmt(ct / 100)} €/kWh`, `Ergebnis: ≈ ${fmt(r.euro, 2)} €`] };
    }
    case "p3":
    default: {
      const I = oneOf(rand, [5, 8, 10, 16, 20]);
      const cos = oneOf(rand, [0.8, 0.85, 0.9]);
      const P = power3({ U: 400, I, cosphi: cos });
      return { type: "p3", text: `Ein Drehstrommotor am 400-V-Netz nimmt ${u(I, "A")} auf (cos φ = ${fmt(cos)}). Wie groß ist die aufgenommene Wirkleistung in kW?`, ask: "P", unit: "kW", answer: P / 1000, tol: 0.02,
        steps: ["Gesucht: Wirkleistung P", "Formel: P = √3 · U · I · cos φ", `Einsetzen: P = 1,732 · 400 V · ${fmtAuto(I)} A · ${fmt(cos)}`, `P ≈ ${u(P, "W")}`, `Ergebnis: P ≈ ${u(P / 1000, "kW")}`] };
    }
  }
}

/* ---------- Prüfungssimulation ---------- */
export const EXAM_SIZE = 20;
export const EXAM_SECONDS = 30 * 60;
export const PASS_PCT = 60; // Übungsziel der App (kein offizieller Wert)

/**
 * Prüfung zusammenstellen: Fragen gleichmäßig über die Themen verteilt (reihum), Antworten gemischt.
 * @param {{id,topic,q,a,x}[]} cards
 * @param {{n?:number, rand?:()=>number, topics?:string[], weights?:Record<string,number>}} opts  weights: Thema → Gewicht (Schwächen öfter)
 */
export function buildExam(cards, { n = EXAM_SIZE, rand = Math.random, topics = null, weights = {} } = {}) {
  const pool = cards.filter((c) => c && c.a && Array.isArray(c.x) && c.x.length >= 2 && (!topics || topics.includes(c.topic)));
  const by = new Map();
  for (const c of shuffle(pool, rand)) { if (!by.has(c.topic)) by.set(c.topic, []); by.get(c.topic).push(c); }
  let order = [];
  for (const t of by.keys()) { const w = Math.max(1, Math.min(3, Math.round(weights[t] || 1))); for (let i = 0; i < w; i++) order.push(t); }
  order = shuffle(order, rand);
  const out = [];
  while (out.length < Math.min(n, pool.length)) {
    let added = false;
    for (const t of order) {
      if (out.length >= n) break;
      const list = by.get(t);
      if (list && list.length) { out.push(list.pop()); added = true; }
    }
    if (!added) break;
  }
  return shuffle(out, rand).map((c) => ({ id: c.id, topic: c.topic, q: c.q, a: c.a, options: shuffle([c.a, ...c.x.slice(0, 3)], rand) }));
}

/** Prüfung auswerten. answers: { [id]: gewählte Option } */
export function scoreExam(questions, answers = {}) {
  const byTopic = {};
  const wrong = [];
  let right = 0;
  for (const q of questions) {
    const t = (byTopic[q.topic] = byTopic[q.topic] || { n: 0, ok: 0 });
    t.n++;
    const picked = answers[q.id];
    if (picked === q.a) { right++; t.ok++; }
    else wrong.push({ id: q.id, picked: picked ?? null });
  }
  const n = questions.length;
  const pct = n ? Math.round((right / n) * 100) : 0;
  return { n, right, pct, passed: pct >= PASS_PCT, byTopic, wrong };
}
export function examVerdict(pct) {
  if (pct >= 90) return "🏆 Hervorragend – du bist prüfungsfit!";
  if (pct >= 75) return "🎉 Sehr gut gemacht!";
  if (pct >= PASS_PCT) return "👍 Geschafft – mit ein bisserl Übung wird's noch sicherer.";
  if (pct >= 40) return "💪 Knapp daneben – schau dir die Fehler an und probier's nochmal.";
  return "🌱 Noch ein Stück Weg – üb die Lernkarten, dann klappt's!";
}

/* ---------- Schwächen ---------- */
/**
 * Trefferquote je Thema aus SRS-Stand (Fehler = lapses) und den letzten Prüfungen.
 * @param {Iterable<{id,seen,lapses,ex?}>} cardStates  SRS-Dokumente (id "thema-nr"; ex = aus Prüfungen übernommene Fehler)
 * @param {{byTopic:Record<string,{n,ok}>}[]} exams  neueste zuerst
 * @returns {{topic, n, ok, rate}[]}  nach Quote aufsteigend (schwächstes zuerst); nur Themen mit Daten
 */
export function topicStats(cardStates, exams = [], { lastExams = 5 } = {}) {
  const acc = {};
  const add = (t, n, ok) => { const a = (acc[t] = acc[t] || { topic: t, n: 0, ok: 0 }); a.n += n; a.ok += ok; };
  for (const c of cardStates || []) {
    if (!c || !c.id || !(c.seen > 0)) continue;
    const t = String(c.id).split("-")[0];
    const ex = Math.max(0, c.ex || 0); // Fehler aus Prüfungen stecken schon in exams → nicht doppelt zählen
    const seen = Math.max(0, c.seen - ex);
    const lapses = Math.min(Math.max(0, (c.lapses || 0) - ex), seen);
    if (seen > 0) add(t, seen, seen - lapses);
  }
  for (const e of (exams || []).slice(0, lastExams)) for (const [t, v] of Object.entries((e && e.byTopic) || {})) add(t, v.n || 0, v.ok || 0);
  return Object.values(acc).filter((a) => a.n > 0).map((a) => ({ ...a, rate: a.ok / a.n })).sort((a, b) => a.rate - b.rate || b.n - a.n);
}
/** Schwache Themen: genug Versuche (≥ minN) und Quote unter `below`. */
export function weakTopics(cardStates, exams, { minN = 4, below = 0.7 } = {}) {
  return topicStats(cardStates, exams).filter((s) => s.n >= minN && s.rate < below).map((s) => s.topic);
}

/** Frage für „🤖 Erklär mir das“ zusammenbauen. */
export function explainPrompt({ topic, q, a, e, picked }) {
  return [
    `LAP-Lernfrage zum Thema „${topic}“:`,
    `Frage: ${q}`,
    `Richtige Antwort: ${a}`,
    ...(e ? [`Kurze Erklärung aus der Lernkarte: ${e}`] : []),
    ...(picked && picked !== a ? [`Ich hatte geantwortet: ${picked}`, "Erklär mir bitte, warum meine Antwort falsch ist und die richtige stimmt."] : ["Erklär mir das bitte einfach, mit einem Beispiel aus der Praxis."]),
  ].join("\n");
}
