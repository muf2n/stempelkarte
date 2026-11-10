// Update 11 – 🏡 Haushalt › 🗑️ Müllkalender und 🥫 Vorrat – reine Logik (kein DOM).
//
// Sammlung „muell“ – je Tonne ein Dokument:
//   { id, kind: rest|bio|papier|gelb|glas|metall|sperr|eigen, name, e, start (YYYY-MM-DD, ein Abholtag),
//     every (Wochen, 0 = nur einzelne Termine), dates: [YYYY-MM-DD] (Zusatztermine), skip: [YYYY-MM-DD] (fällt aus/verschoben),
//     remind (Erinnerung am Vorabend, Standard an), updated }
// Sammlung „vorrat“ – je Artikel ein Dokument:
//   { id, name, qty, min (ab dieser Menge „wird knapp“), unit, place (Kühlschrank, Speis …), best (MHD YYYY-MM-DD), note, updated }

const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");
const s = (v) => (v == null ? "" : String(v)).trim();
export const isKey = (k) => RE_KEY.test(s(k));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = (now = Date.now()) => keyOf(new Date(now));
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const fmtShort = (k) => { const d = dateOf(k); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
export const fmtDay = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;

/* ------------------------------------------------------------------ Müll */

export const BINS = [
  { kind: "rest", name: "Restmüll", e: "⚫", color: "#4b5563" },
  { kind: "bio", name: "Biomüll", e: "🟤", color: "#92400e" },
  { kind: "papier", name: "Altpapier", e: "🔴", color: "#dc2626" },
  { kind: "gelb", name: "Gelber Sack / Gelbe Tonne", e: "🟡", color: "#ca8a04" },
  { kind: "glas", name: "Altglas", e: "🟢", color: "#16a34a" },
  { kind: "metall", name: "Metall", e: "🔵", color: "#2563eb" },
  { kind: "sperr", name: "Sperrmüll / Problemstoffe", e: "🛋️", color: "#7c3aed" },
  { kind: "eigen", name: "Eigene", e: "🗑️", color: "#0f766e" },
];
export const binByKind = (k) => BINS.find((b) => b.kind === k) || BINS[BINS.length - 1];
export const EVERY = [[1, "jede Woche"], [2, "alle 2 Wochen"], [3, "alle 3 Wochen"], [4, "alle 4 Wochen"], [6, "alle 6 Wochen"], [8, "alle 8 Wochen"], [0, "nur einzelne Termine"]];
const keys = (a) => [...new Set((Array.isArray(a) ? a : []).filter(isKey))].sort();

export function normBin(x = {}) {
  const b = binByKind(x.kind);
  const every = Math.round(Number(x.every));
  return {
    id: s(x.id), kind: b.kind, name: s(x.name).slice(0, 40) || b.name, e: b.e, color: b.color,
    start: isKey(x.start) ? x.start : "", every: EVERY.some(([n]) => n === every) ? every : 2,
    dates: keys(x.dates).slice(-120), skip: keys(x.skip).slice(-120), remind: x.remind !== false, updated: Number(x.updated) || 0,
  };
}

/** Abholtermine im Bereich [from, to] (inkl.), sortiert. */
export function pickups(bin, from, to) {
  const b = normBin(bin);
  const out = new Set(b.dates.filter((k) => k >= from && k <= to));
  if (b.start && b.every > 0) {
    const step = b.every * 7;
    let k = b.start;
    const gap = diffDays(b.start, from);
    if (gap > 0) k = addDays(b.start, Math.floor(gap / step) * step);
    for (let i = 0; i < 400 && k <= to; i++, k = addDays(k, step)) if (k >= from) out.add(k);
  }
  for (const k of b.skip) out.delete(k);
  return [...out].sort();
}
export const nextPickup = (bin, today, horizon = 120) => pickups(bin, today, addDays(today, horizon))[0] || "";

/** Nächste Termine aller Tonnen, nach Datum gruppiert: [{ day, bins:[…] }] */
export function upcoming(bins, today, days = 35) {
  const end = addDays(today, days);
  const map = new Map();
  for (const raw of bins) {
    const b = normBin(raw);
    if (!b.id) continue;
    for (const k of pickups(b, today, end)) { if (!map.has(k)) map.set(k, []); map.get(k).push(b); }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, list]) => ({ day, bins: list }));
}

/** Was rausmuss: heute (bis 12 Uhr) oder morgen (ab 14 Uhr) → für Mitteilungen. */
export function dueBins(bins, now = Date.now()) {
  const today = todayKey(now);
  const h = new Date(now).getHours();
  const out = [];
  for (const raw of bins) {
    const b = normBin(raw);
    if (!b.id || !b.remind) continue;
    const ps = pickups(b, today, addDays(today, 1));
    if (h < 12 && ps.includes(today)) out.push({ ...b, day: today, when: "heute" });
    else if (h >= 14 && ps.includes(addDays(today, 1))) out.push({ ...b, day: addDays(today, 1), when: "morgen" });
  }
  return out;
}

/** Einen Termin ausfallen lassen bzw. verschieben (z. B. wegen Feiertag). */
export function skipDate(bin, k) { const b = normBin(bin); return { ...b, skip: keys([...b.skip, k]), dates: b.dates.filter((d) => d !== k) }; }
export function moveDate(bin, from, to) {
  const b = skipDate(bin, from);
  return isKey(to) ? { ...b, dates: keys([...b.dates, to]), skip: b.skip.filter((d) => d !== to) } : b;
}

/* ------------------------------------------------------------------ Vorrat */

export const PLACES = [["kuehl", "🧊", "Kühlschrank"], ["tk", "❄️", "Tiefkühler"], ["speis", "🥫", "Speis/Vorratsschrank"], ["bad", "🧴", "Bad/Drogerie"], ["keller", "📦", "Keller"], ["sonst", "🏠", "Sonstiges"]];
export const placeBy = (id) => PLACES.find((p) => p[0] === id) || PLACES[PLACES.length - 1];
export const VUNITS = ["Stk", "Pkg", "g", "kg", "ml", "l", "Dose", "Flasche", "Rolle"];
const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

export function normStock(x = {}) {
  return {
    id: s(x.id), name: s(x.name).slice(0, 60), qty: Math.max(0, r2(num(x.qty))), min: Math.max(0, r2(num(x.min))),
    unit: VUNITS.includes(x.unit) ? x.unit : "Stk", place: placeBy(x.place)[0], best: isKey(x.best) ? x.best : "",
    note: s(x.note).slice(0, 200), updated: Number(x.updated) || 0,
  };
}

/** Zustand eines Artikels: leer, knapp, abgelaufen, bald (MHD ≤ 3 Tage), ok. */
export function stockState(it, today) {
  const x = normStock(it);
  const flags = [];
  if (x.qty <= 0) flags.push("leer");
  else if (x.min > 0 && x.qty <= x.min) flags.push("knapp");
  if (x.best && x.qty > 0) {
    const d = diffDays(today, x.best);
    if (d < 0) flags.push("abgelaufen");
    else if (d <= 3) flags.push("bald");
  }
  return flags;
}
export const needsBuying = (it) => { const x = normStock(it); return x.qty <= 0 || (x.min > 0 && x.qty <= x.min); };

/** Menge ändern (nicht unter 0). */
export function bump(it, delta, now = Date.now()) { const x = normStock(it); return { ...x, qty: Math.max(0, r2(x.qty + delta)), updated: now }; }

/** Wie viel auf die Einkaufsliste soll: auf das Doppelte der Mindestmenge auffüllen (mind. 1). */
export function buyQty(it) { const x = normStock(it); return Math.max(1, r2((x.min > 0 ? x.min * 2 : 1) - x.qty)); }

/** Einkaufslisten-Einträge für knappe Artikel, ohne Dubletten zu schon offenen Einträgen (gleicher Name). */
export function toShopping(stock, openShopping, listId = "privat") {
  const open = new Set((openShopping || []).filter((i) => i && !i.done).map((i) => s(i.name).toLowerCase()));
  const unitMap = { Stk: "Stk", Pkg: "Pkg", g: "g", kg: "kg", ml: "ml", l: "l", Rolle: "Rolle" };
  return stock.map(normStock).filter((x) => x.name && needsBuying(x) && !open.has(x.name.toLowerCase()))
    .map((x) => ({ listId, name: x.name, qty: buyQty(x), unit: unitMap[x.unit] || "Stk", cat: x.place === "bad" ? "drogerie" : "lebensmittel", done: false, note: "aus dem Vorrat" }));
}

export function sortStock(arr, today) {
  const rank = (x) => { const f = stockState(x, today); return f.includes("abgelaufen") ? 0 : f.includes("bald") ? 1 : f.includes("leer") ? 2 : f.includes("knapp") ? 3 : 4; };
  return arr.map(normStock).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "de"));
}

/** Für Mitteilungen: MHD abgelaufen/bald (nur vorhandene Artikel). */
export function dueStock(stock, today) {
  return stock.map(normStock).filter((x) => x.id && x.name).map((x) => ({ ...x, flags: stockState(x, today) }))
    .filter((x) => x.flags.includes("abgelaufen") || x.flags.includes("bald"));
}

export const fmtQty = (x) => `${String(x.qty).replace(".", ",")} ${x.unit}`;
