// 🧾 Steuer-Helfer (Arbeitnehmerveranlagung Österreich) – reine Logik (kein DOM). SCHÄTZUNG, keine Steuerberatung.
// Werte geprüft am 15.11.2026 (Quellen: bmf.gv.at Absetzbeträge/Negativsteuer, usp.gv.at Tarifstufen, wko.at Pendlerpauschale,
// oesterreich.gv.at Pendlereuro, FinanzOnline L1 Kennzahlen). Unsichere Werte sind mit est: true markiert.
// Sammlung „steuer“, Dokument je Jahr: { id: "2025", kz245, sv, lst, km, gross, inAG, gew, extra: [{ name, amt, kz }], skip: [txId] }

export const YEARS = {
  2025: { tarif: [[13308, 0], [21617, 0.2], [35836, 0.3], [69166, 0.4], [103072, 0.48], [1e6, 0.5], [Infinity, 0.55]],
    vab: 487, vabErh: 838, vabErhFull: 14820, vabErhEnd: 15281, erhEst: true, // Grenzen ≈ (vorläufige Werte hochgerechnet)
    zus: 790, zusFull: 19424, zusEnd: 29743, svMax: 487, svMaxPP: 608, pe: 2 },
  2026: { tarif: [[13539, 0], [21992, 0.2], [36458, 0.3], [70365, 0.4], [104859, 0.48], [1e6, 0.5], [Infinity, 0.55]],
    vab: 496, vabErh: 853, vabErhFull: 15069, vabErhEnd: 16056,
    zus: 804, zusFull: 19761, zusEnd: 30259, svMax: 496, svMaxPP: 619, svMaxPPEst: true, pe: 6 },
};
export const WK_PAUSCHALE = 132;
/** Pendlerpauschale pro Monat (seit Jahren unverändert): klein ab 20 km, groß ab 2 km */
export const PP = { klein: [[20, 58], [40, 113], [60, 168]], gross: [[2, 31], [20, 123], [40, 214], [60, 306]] };
export const KZ = { 718: "Pendlerpauschale", 916: "Pendlereuro", 717: "Gewerkschaftsbeiträge", 719: "Arbeitsmittel (Werkzeug, Arbeitskleidung)", 720: "Fachliteratur", 721: "Reisekosten", 722: "Aus- und Fortbildung", 724: "Sonstige Werbungskosten" };

/** Zahl aus Eingabe: 1.234,56 / 1234,56 / 49.9 / Zahl */
const n = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").trim().replace(/[€\s]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const x = Number(t); return Number.isFinite(x) ? x : 0;
};
export const num = n;
const r2 = (x) => Math.round(x * 100) / 100;

export function tarif(year, E) {
  const T = YEARS[year].tarif; let tax = 0, lo = 0;
  for (const [hi, rate] of T) { if (E > lo) tax += (Math.min(E, hi) - lo) * rate; lo = hi; }
  return r2(tax);
}
/** Monatsbetrag laut Tabelle (0 = kein Anspruch) */
export function ppMonth(km, gross) {
  let v = 0; for (const [from, amt] of PP[gross ? "gross" : "klein"]) if (km >= from) v = amt;
  return v;
}
/** Anteil je Monat aus der Zahl der Pendeltage: ab 11 voll, 8–10 = 2/3, 4–7 = 1/3 */
export const dayFraction = (d) => (d >= 11 ? 1 : d >= 8 ? 2 / 3 : d >= 4 ? 1 / 3 : 0);
const dk = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Pendeltage je Monat aus den Einträgen: Arbeitstage (+ Urlaub/Krankenstand), ohne Berufsschule */
export function pendelDays(entries, year) {
  const sets = Array.from({ length: 12 }, () => new Set());
  for (const e of entries || []) {
    if (!e || !Number.isFinite(Number(e.start))) continue;
    const k = e.kind || "work";
    if (!["work", "urlaub", "krank"].includes(k)) continue;
    const d = new Date(Number(e.start)); if (d.getFullYear() !== Number(year)) continue;
    sets[d.getMonth()].add(dk(e.start));
  }
  return sets.map((s) => s.size);
}
export function pendler(year, km, gross, days) {
  const m = ppMonth(km, gross), Y = YEARS[year];
  const fr = days.map(dayFraction);
  const pp = r2(fr.reduce((a, f) => a + f * m, 0));
  const pe = pp > 0 ? r2(Y.pe * Math.round(km) * fr.reduce((a, f) => a + f, 0) / 12) : 0;
  return { pp, pe, perMonth: m, fractions: fr };
}
/** Werbungskosten-Vorschläge aus „Geld“: Werkzeug & Arbeit → 719, Schule (Berufsschule) → 722 */
export function wkFromMoney(tx, year) {
  const y = String(year);
  return (tx || []).filter((t) => t && t.type === "out" && String(t.date || "").startsWith(y) && ["werkzeug", "schule"].includes(t.category) && !t.transfer)
    .map((t) => ({ id: t.id, date: t.date, name: t.note || t.name || (t.category === "schule" ? "Schule" : "Werkzeug"), amt: Math.abs(n(t.amount)), kz: t.category === "schule" ? 722 : 719 }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
const lin = (E, full, end, max, min = 0) => (E <= full ? max : E >= end ? min : r2(max - (max - min) * (E - full) / (end - full)));

/** Schätzung der Gutschrift. inp: { year, kz245, sv, lst, pp, pe, wk (Summe 719–724), gew, ppDone (Arbeitgeber berücksichtigt PP/PE schon) } */
export function estimate(inp) {
  const Y = YEARS[inp.year], wk = Math.max(0, n(inp.wk)), gew = Math.max(0, n(inp.gew)), pp = Math.max(0, n(inp.pp)), pe = Math.max(0, n(inp.pe));
  const wkUsed = Math.max(WK_PAUSCHALE, wk);
  const ppSub = inp.ppDone ? 0 : pp, peCred = inp.ppDone ? 0 : pe; // schon im Lohnzettel/Lohnsteuer enthalten
  const E = Math.max(0, r2(n(inp.kz245) - wkUsed - gew - ppSub));
  const t = tarif(inp.year, E);
  const vab = pp > 0 ? lin(E, Y.vabErhFull, Y.vabErhEnd, Y.vabErh, Y.vab) : Y.vab;
  const zus = lin(E, Y.zusFull, Y.zusEnd, Y.zus);
  const credits = r2(vab + zus + peCred);
  const raw = r2(t - credits);
  const sv = Math.max(0, n(inp.sv)), lst = Math.max(0, n(inp.lst));
  let tax = Math.max(0, raw), refundSV = 0;
  if (raw < 0) { const cap = (pp > 0 ? Y.svMaxPP : Y.svMax) + zus; refundSV = r2(Math.min(-raw, 0.55 * sv, cap)); }
  const gut = r2(lst - tax + refundSV);
  return { E, t, vab, zus, pe: peCred, credits, tax, refundSV, gut, wkUsed, wkBonus: Math.max(0, wk - WK_PAUSCHALE), pauschaleOnly: wk <= WK_PAUSCHALE,
    est: !!(Y.erhEst && pp > 0) || !!(Y.svMaxPPEst && pp > 0 && raw < 0) };
}
export const eur = (v) => `${(Math.round(v * 100) / 100).toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
