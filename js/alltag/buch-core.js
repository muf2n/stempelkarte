// Update 10 – 💼 Buchhaltung: reine Logik ohne DOM (Node-testbar).
// Beträge IMMER in ganzen Cent (Integer) – nie mit Kommazahlen rechnen. Gerundet wird kaufmännisch (ab ,5 weg von 0).
//
// Sammlungen (js/alltag/db.js → users/{uid}/a_<name>):
//   buch_settings  { id: "main", firm, address, uid, email, phone, web, kleinunternehmer, iban, bic, bank, logo, numFormat,
//                    counters: { "<JJJJ>"|"all": letzte Nummer }, dueDays, footer, lockWithMoney (Standard true) }
//   buch_belege    { id, type: "in"|"out", date (Zahlungsdatum JJJJ-MM-TT), gross (Cent), rate (%), cat, pay, partner, note,
//                    invoiceId?, docIds: [], created, updated }
//   buch_rechnungen { id, kind: "rechnung"|"storno", status: "entwurf"|"offen"|"bezahlt"|"storniert", number, seq, numKey,
//                    date (Rechnungsdatum), serviceFrom, serviceTo, dueDays, dueDate, customer: { contactId, name, address, uid, email },
//                    items: [{ qty, unit, text, price (Cent netto), rate }], note, ku (beim Abschließen eingefroren),
//                    seller (Kopie der Firmendaten beim Abschließen), paidOn, pay, refId/refNumber (Storno), stornoId, created, updated }
// Das ist eine Gedächtnisstütze – keine zertifizierte Buchhaltungssoftware und keine Steuerberatung.
import { RULES, rule } from "./buch-rules.js";

const s = (v) => String(v ?? "").trim();
const pad = (n, w = 2) => String(n).padStart(w, "0");
export function isKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export const yearOf = (k) => Number(String(k || "").slice(0, 4)) || 0;
export const monthOf = (k) => Number(String(k || "").slice(5, 7)) || 0;
export const quarterOf = (k) => Math.ceil(monthOf(k) / 3) || 0;
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(k, n) {
  const [y, m, d] = String(k).split("-").map(Number);
  return keyOf(new Date(y, m - 1, d + (Number(n) || 0)));
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export const fmtKey = (k) => (isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "");

/* ---------- Geld in Cent ---------- */

/** Ganzzahlige Division mit kaufmännischer Rundung (Hälfte weg von 0). b > 0. */
export function roundDiv(a, b) {
  const neg = a < 0;
  const x = Math.abs(a);
  const q = Math.floor((2 * x + b) / (2 * b));
  return neg ? -q : q;
}

/** "1.234,56" · "12,5" · "12.50" · 12.5 · "-3" → Cent (Integer) oder NaN. Nie über Float-Multiplikation. */
export function toCents(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return NaN;
    return toCents(v.toFixed(6));
  }
  let t = s(v).replace(/[€\s ]/g, "").replace(/^−/, "-");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 1.234 → 1234
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return NaN;
  const frac = (m[3] || "").padEnd(3, "0");
  let c = Number(m[2] || "0") * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) c += 1; // dritte Nachkommastelle rundet kaufmännisch (12,345 → 12,35; 12,3449 → 12,34)
  return m[1] ? -c : c;
}

/** Cent → "1.234,56 €" (negativ mit echtem Minus). */
export function eur(c, { sign = false } = {}) {
  const n = Math.round(Number(c) || 0);
  const abs = Math.abs(n);
  const int = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const out = `${int},${pad(abs % 100)} €`;
  if (n < 0) return "−" + out;
  return sign && n > 0 ? "+" + out : out;
}
/** Cent → "1234,56" (für CSV/Excel-Import, ohne Tausenderpunkt). */
export function plain(c) {
  const n = Math.round(Number(c) || 0);
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}${Math.floor(abs / 100)},${pad(abs % 100)}`;
}
/** Cent → Eingabefeld-Text "12,50". */
export const centsIn = (c) => (c == null || c === "" || !Number.isFinite(Number(c)) ? "" : plain(c));

/* ---------- USt ---------- */

export const RATES = rule("vatRates");
/** Satz normalisieren (eine Nachkommastelle, 0–100) – unbekannt → null. */
export function normRate(r) {
  const n = typeof r === "string" ? Number(r.replace(",", ".").replace("%", "").trim()) : Number(r);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 10;
}
const r10 = (r) => Math.round((normRate(r) || 0) * 10);
export const fmtRate = (r) => `${String(normRate(r) ?? 0).replace(".", ",")} %`;

/** Brutto (Cent) → { gross, net, vat } für Satz r (%). net = brutto / (1 + r) kaufmännisch gerundet, vat = Rest. */
export function splitGross(gross, rate) {
  const g = Math.round(Number(gross) || 0);
  const k = r10(rate);
  const net = k ? roundDiv(g * 1000, 1000 + k) : g;
  return { gross: g, net, vat: g - net };
}
/** USt auf einen Netto-Betrag (Cent). */
export const vatOfNet = (net, rate) => roundDiv(Math.round(Number(net) || 0) * r10(rate), 1000);
/** Netto (Cent) → { net, vat, gross }. */
export function fromNet(net, rate) { const n = Math.round(Number(net) || 0); const v = vatOfNet(n, rate); return { net: n, vat: v, gross: n + v }; }

/** Menge (bis 3 Nachkommastellen) × Einzelpreis (Cent) → Zeilen-Netto (Cent), kaufmännisch gerundet. */
export function lineNet(qty, price) {
  const q = Math.round((Number(String(qty).replace(",", ".")) || 0) * 1000);
  return roundDiv(q * Math.round(Number(price) || 0), 1000);
}

/* ---------- Stammdaten ---------- */

export const CATS = [
  { id: "erloese", e: "💶", label: "Erlöse (Verkauf/Leistung)", type: "in" },
  { id: "sonst_ein", e: "➕", label: "Sonstige Einnahme", type: "in" },
  { id: "wareneinkauf", e: "📦", label: "Wareneinkauf", type: "out" },
  { id: "material", e: "🧱", label: "Material", type: "out" },
  { id: "buero", e: "🖇️", label: "Büro", type: "out" },
  { id: "fahrzeug", e: "🚗", label: "Fahrzeug", type: "out" },
  { id: "telefon", e: "📱", label: "Telefon/Internet", type: "out" },
  { id: "miete", e: "🏠", label: "Miete", type: "out" },
  { id: "werbung", e: "📣", label: "Werbung", type: "out" },
  { id: "versicherung", e: "🛡️", label: "Versicherung", type: "out" },
  { id: "reise", e: "🧳", label: "Reise", type: "out" },
  { id: "gwg", e: "🧰", label: "GWG (geringwertig)", type: "out" },
  { id: "fortbildung", e: "🎓", label: "Fortbildung", type: "out" },
  { id: "bank", e: "🏦", label: "Bankspesen", type: "out" },
  { id: "sonstiges", e: "🗂️", label: "Sonstiges", type: "out" },
];
export const catById = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
export const catsFor = (type) => CATS.filter((c) => c.type === (type === "in" ? "in" : "out"));
export const PAYS = [
  { id: "bank", label: "Überweisung" }, { id: "bar", label: "Bar" }, { id: "karte", label: "Karte" },
  { id: "paypal", label: "PayPal" }, { id: "lastschrift", label: "Lastschrift" }, { id: "sonst", label: "Sonstiges" },
];
export const payById = (id) => PAYS.find((p) => p.id === id) || PAYS[0];
export const UNITS = ["Stk", "Std", "m", "m²", "kg", "Pausch.", "km", "Tag"];
export const STATUS = {
  entwurf: { e: "📝", label: "Entwurf" }, offen: { e: "⏳", label: "Offen" }, ueberfaellig: { e: "⚠️", label: "Überfällig" },
  bezahlt: { e: "✅", label: "Bezahlt" }, storniert: { e: "🚫", label: "Storniert" }, storno: { e: "↩️", label: "Stornorechnung" },
};

export const DEFAULT_FORMAT = "{JJJJ}-{NNN}";
export function normSettings(x) {
  const d = x && typeof x === "object" ? x : {};
  const counters = {};
  if (d.counters && typeof d.counters === "object") for (const [k, v] of Object.entries(d.counters)) if (/^(\d{4}|all)$/.test(k) && Number.isInteger(v) && v >= 0) counters[k] = v;
  return {
    id: "main", firm: s(d.firm).slice(0, 120), address: s(d.address).slice(0, 300), uid: s(d.uid).toUpperCase().replace(/\s+/g, "").slice(0, 20),
    email: s(d.email).slice(0, 120), phone: s(d.phone).slice(0, 40), web: s(d.web).slice(0, 120),
    kleinunternehmer: d.kleinunternehmer !== false, // Standard: Kleinunternehmer (häufigster Fall bei Kleinstbetrieben)
    iban: s(d.iban).toUpperCase().replace(/\s+/g, "").slice(0, 34), bic: s(d.bic).toUpperCase().replace(/\s+/g, "").slice(0, 11), bank: s(d.bank).slice(0, 80),
    logo: typeof d.logo === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(d.logo) && d.logo.length < 200000 ? d.logo : "",
    numFormat: validFormat(d.numFormat) ? s(d.numFormat) : DEFAULT_FORMAT,
    counters, dueDays: Number.isInteger(d.dueDays) && d.dueDays >= 0 && d.dueDays <= 365 ? d.dueDays : 14,
    footer: s(d.footer).slice(0, 400), lockWithMoney: d.lockWithMoney !== false, setupDone: !!d.setupDone,
  };
}
/** IBAN mit Leerzeichen in Vierergruppen. */
export const fmtIban = (v) => s(v).replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
/** IBAN-Prüfsumme (ISO 13616, mod 97). Leer = ok (optional). */
export function ibanOk(v) {
  const t = s(v).replace(/\s+/g, "").toUpperCase();
  if (!t) return true;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(t)) return false;
  const r = (t.slice(4) + t.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + Number(ch)) % 97;
  return m === 1;
}
/** Österreichische UID ATU + 8 Ziffern (andere EU-UIDs: grob 2 Buchstaben + 2–13 Zeichen). Leer = ok. */
export function uidOk(v) {
  const t = s(v).toUpperCase().replace(/\s+/g, "");
  if (!t) return true;
  if (t.startsWith("AT")) return /^ATU\d{8}$/.test(t);
  return /^[A-Z]{2}[0-9A-Z+*]{2,13}$/.test(t);
}

/* ---------- Belege ---------- */

export function normBeleg(x) {
  const d = x && typeof x === "object" ? x : {};
  const type = d.type === "in" ? "in" : "out";
  const rate = normRate(d.rate);
  const cat = CATS.some((c) => c.id === d.cat && c.type === type) ? d.cat : type === "in" ? "erloese" : "sonstiges";
  return {
    id: s(d.id), type, date: isKey(d.date) ? d.date : "", gross: Number.isInteger(d.gross) ? d.gross : 0, rate: rate == null ? 0 : rate,
    cat, pay: PAYS.some((p) => p.id === d.pay) ? d.pay : "bank", partner: s(d.partner).slice(0, 120), note: s(d.note).slice(0, 1000),
    invoiceId: s(d.invoiceId), docIds: Array.isArray(d.docIds) ? d.docIds.map(s).filter(Boolean).slice(0, 20) : [],
    created: Number(d.created) || 0, updated: Number(d.updated) || 0,
  };
}
/** Beleg → Netto/USt (Kleinunternehmer: Einnahmen ohne USt, Ausgaben ohne Vorsteuerabzug → alles brutto). */
export function belegAmounts(b, ku = false) {
  const x = splitGross(b.gross, b.rate);
  if (ku) return { gross: x.gross, net: x.gross, vat: 0, vatShown: x.vat };
  return { ...x, vatShown: x.vat };
}
/** Hinweis, wenn eine GWG-Ausgabe über der Grenze liegt (dann AfA statt Sofortabzug). */
export function gwgWarn(b, ku = false) {
  if (b.type !== "out" || b.cat !== "gwg") return "";
  const limit = rule("gwgLimit") * 100;
  const base = ku ? b.gross : splitGross(b.gross, b.rate).net;
  return base > limit ? `Über ${eur(limit)} ${ku ? "brutto" : "netto"}: kein GWG mehr – das wird über die Nutzungsdauer abgeschrieben (AfA). Am besten mit der Steuerberatung klären.` : "";
}

/* ---------- Rechnungsnummern ---------- */

export function validFormat(f) {
  const t = s(f);
  if (!t || t.length > 40) return false;
  if (!/\{N+\}/.test(t) || (t.match(/\{N+\}/g) || []).length !== 1) return false;
  const rest = t.replace(/\{(JJJJ|JJ|N+)\}/g, "");
  return /^[A-Za-z0-9 ._/#-]*$/.test(rest);
}
const hasYear = (f) => /\{JJ(JJ)?\}/.test(f);
/** Zähler-Schlüssel: pro Jahr, wenn das Format ein Jahr enthält – sonst durchgehend („all“), damit nie eine Nummer doppelt vorkommt. */
export const counterKey = (fmt, year) => (hasYear(fmt) ? String(year) : "all");
export function formatNumber(fmt, year, seq) {
  const f = validFormat(fmt) ? fmt : DEFAULT_FORMAT;
  return f.replace("{JJJJ}", String(year)).replace("{JJ}", pad(year % 100)).replace(/\{(N+)\}/, (_, n) => pad(seq, n.length));
}
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** Laufende Nummer aus einer Rechnungsnummer lesen (passend zu Format + Jahr) – sonst 0. */
export function parseSeq(number, fmt, year) {
  const f = validFormat(fmt) ? fmt : DEFAULT_FORMAT;
  const parts = f.split(/(\{JJJJ\}|\{JJ\}|\{N+\})/).filter((x) => x !== "");
  const re = parts.map((p) => p === "{JJJJ}" ? String(year) : p === "{JJ}" ? pad(year % 100) : /^\{N+\}$/.test(p) ? "(\\d+)" : reEsc(p)).join("");
  const m = new RegExp("^" + re + "$").exec(s(number));
  return m ? Number(m[1]) : 0;
}
/**
 * Nächste Nummer – fortlaufend, ohne Lücke und NIE wiederverwendet: max(Zähler, höchste schon vergebene Nummer) + 1.
 * → { number, seq, key }
 */
export function nextNumber(settings, invoices, year) {
  const st = normSettings(settings);
  const key = counterKey(st.numFormat, year);
  let max = st.counters[key] || 0;
  for (const raw of invoices || []) {
    const inv = raw || {};
    if (!s(inv.number)) continue;
    if (inv.numKey === key && Number.isInteger(inv.seq)) max = Math.max(max, inv.seq);
    else max = Math.max(max, parseSeq(inv.number, st.numFormat, year));
  }
  const seq = max + 1;
  return { number: formatNumber(st.numFormat, year, seq), seq, key };
}
/** Lücken/Doppelte in den vergebenen Nummern finden (für den Prüf-Hinweis). → { gaps: [seq], dups: [number] } */
export function numberAudit(invoices, key) {
  const seqs = (invoices || []).filter((i) => i && i.numKey === key && Number.isInteger(i.seq)).map((i) => i.seq).sort((a, b) => a - b);
  const gaps = [], dups = [];
  for (let i = 1; i < seqs.length; i++) {
    if (seqs[i] === seqs[i - 1]) dups.push(seqs[i]);
    for (let g = seqs[i - 1] + 1; g < seqs[i]; g++) gaps.push(g);
  }
  if (seqs.length && seqs[0] > 1) for (let g = 1; g < seqs[0]; g++) gaps.unshift(g);
  return { gaps: [...new Set(gaps)].sort((a, b) => a - b), dups: [...new Set(dups)] };
}

/* ---------- Rechnungen ---------- */

export function normItem(x) {
  const d = x && typeof x === "object" ? x : {};
  const q = Number(String(d.qty ?? 1).replace(",", "."));
  return { qty: Number.isFinite(q) ? Math.round(q * 1000) / 1000 : 1, unit: s(d.unit).slice(0, 12), text: s(d.text).slice(0, 300),
    price: Number.isInteger(d.price) ? d.price : 0, rate: normRate(d.rate) ?? 20 };
}
export function normInvoice(x) {
  const d = x && typeof x === "object" ? x : {};
  const c = d.customer && typeof d.customer === "object" ? d.customer : {};
  const kind = d.kind === "storno" ? "storno" : "rechnung";
  const status = ["entwurf", "offen", "bezahlt", "storniert"].includes(d.status) ? d.status : "entwurf";
  return {
    id: s(d.id), kind, status, number: s(d.number), seq: Number.isInteger(d.seq) ? d.seq : null, numKey: s(d.numKey),
    date: isKey(d.date) ? d.date : "", serviceFrom: isKey(d.serviceFrom) ? d.serviceFrom : "", serviceTo: isKey(d.serviceTo) ? d.serviceTo : "",
    dueDays: Number.isInteger(d.dueDays) && d.dueDays >= 0 ? d.dueDays : 14, dueDate: isKey(d.dueDate) ? d.dueDate : "",
    customer: { contactId: s(c.contactId), name: s(c.name).slice(0, 160), address: s(c.address).slice(0, 300), uid: s(c.uid).toUpperCase().replace(/\s+/g, "").slice(0, 20),
      email: s(c.email).slice(0, 120), business: c.business !== false },
    items: (Array.isArray(d.items) ? d.items : []).map(normItem).slice(0, 100), note: s(d.note).slice(0, 1000),
    ku: typeof d.ku === "boolean" ? d.ku : null, seller: d.seller && typeof d.seller === "object" ? d.seller : null,
    paidOn: isKey(d.paidOn) ? d.paidOn : "", pay: s(d.pay), refId: s(d.refId), refNumber: s(d.refNumber), stornoId: s(d.stornoId),
    created: Number(d.created) || 0, updated: Number(d.updated) || 0,
  };
}
/** Gilt die Kleinunternehmerregelung für diese Rechnung? (abgeschlossen: eingefroren, Entwurf: aktuelle Einstellung) */
export const invKu = (inv, settings) => (typeof inv.ku === "boolean" ? inv.ku : normSettings(settings).kleinunternehmer);

/** Summen: Zeilen-Netto, je Satz Netto + USt (USt je Satz auf die Netto-Summe), gesamt. Kleinunternehmer → 0 % USt. */
export function invoiceTotals(invRaw, settings = null) {
  const inv = normInvoice(invRaw);
  const ku = invKu(inv, settings);
  const lines = inv.items.map((it) => ({ ...it, rate: ku ? 0 : it.rate, net: lineNet(it.qty, it.price) }));
  const by = new Map();
  for (const l of lines) by.set(l.rate, (by.get(l.rate) || 0) + l.net);
  const groups = [...by.entries()].sort((a, b) => b[0] - a[0]).map(([rate, net]) => ({ rate, ...fromNet(net, rate) }));
  const sum = (k) => groups.reduce((a, g) => a + g[k], 0);
  return { ku, lines, groups, net: sum("net"), vat: sum("vat"), gross: sum("gross") };
}

/** Status inkl. „überfällig“ (offen + Zahlungsziel vorbei). Stornorechnungen: „storno“. */
export function invoiceStatus(invRaw, today) {
  const inv = normInvoice(invRaw);
  if (inv.kind === "storno") return "storno";
  if (inv.status === "offen" && inv.dueDate && today && inv.dueDate < today) return "ueberfaellig";
  return inv.status;
}

/**
 * Pflichtangaben prüfen (vor dem Abschließen). → { errors: [..], warnings: [..], small }
 * errors = fehlt sicher (blockiert), warnings = bitte prüfen (Abschließen trotzdem möglich).
 */
export function checkInvoice(invRaw, settingsRaw) {
  const inv = normInvoice(invRaw);
  const st = normSettings(settingsRaw);
  const t = invoiceTotals(inv, st);
  const small = Math.abs(t.gross) <= rule("smallInvoice") * 100;
  const big = Math.abs(t.gross) > rule("bigInvoice") * 100;
  const errors = [], warnings = [];
  if (!st.firm) errors.push("Dein Firmenname fehlt (Einrichtung).");
  if (!st.address) errors.push("Deine Anschrift fehlt (Einrichtung).");
  if (!inv.items.length) errors.push("Mindestens eine Position (Menge + Bezeichnung) eintragen.");
  inv.items.forEach((it, i) => {
    if (!it.text) errors.push(`Position ${i + 1}: Bezeichnung fehlt.`);
    if (!(it.qty > 0) && inv.kind !== "storno") errors.push(`Position ${i + 1}: Menge muss größer als 0 sein.`);
    if (it.price === 0) warnings.push(`Position ${i + 1}: Preis ist 0 €.`);
  });
  if (!inv.date) errors.push("Rechnungsdatum fehlt.");
  if (!inv.serviceFrom) errors.push("Leistungsdatum bzw. -zeitraum fehlt.");
  if (inv.serviceTo && inv.serviceFrom && inv.serviceTo < inv.serviceFrom) errors.push("Leistungszeitraum: „bis“ liegt vor „von“.");
  if (!inv.customer.name) (small ? warnings : errors).push(small ? "Kein Empfänger – bei Kleinbetragsrechnungen (bis 400 €) erlaubt, aber empfehlenswert." : "Name des Empfängers fehlt.");
  else if (!inv.customer.address && !small) errors.push("Anschrift des Empfängers fehlt.");
  if (!t.ku && !st.uid && !small) warnings.push("Deine UID-Nummer fehlt – über 400 € gehört sie auf die Rechnung, wenn du eine hast.");
  if (big && inv.customer.business && !inv.customer.uid) warnings.push("Über 10.000 € brutto an ein Unternehmen: UID-Nummer des Empfängers angeben.");
  if (inv.customer.uid && !uidOk(inv.customer.uid)) warnings.push("UID-Nummer des Empfängers sieht nicht gültig aus.");
  if (st.uid && !uidOk(st.uid)) warnings.push("Deine UID-Nummer sieht nicht gültig aus (Österreich: ATU + 8 Ziffern).");
  if (st.iban && !ibanOk(st.iban)) warnings.push("Deine IBAN hat eine falsche Prüfziffer.");
  if (!st.iban) warnings.push("Keine Bankverbindung hinterlegt – wie soll bezahlt werden?");
  if (t.gross <= 0 && inv.kind !== "storno") errors.push("Rechnungsbetrag muss größer als 0 € sein.");
  return { errors, warnings, small, totals: t };
}

/** Fälligkeit = Rechnungsdatum + Zahlungsziel. */
export const dueDateOf = (date, days) => (isKey(date) ? addDays(date, Math.max(0, Number(days) || 0)) : "");

/** Abschließen: Nummer vergeben, Firmendaten + Kleinunternehmer-Status einfrieren. → { invoice, counters } */
export function finalize(invRaw, settingsRaw, allInvoices, today) {
  const st = normSettings(settingsRaw);
  const inv = normInvoice(invRaw);
  if (inv.status !== "entwurf" || inv.number) throw new Error("Nur Entwürfe können abgeschlossen werden.");
  const date = inv.date || today;
  const n = nextNumber(st, allInvoices, yearOf(date));
  const out = { ...inv, date, status: "offen", number: n.number, seq: n.seq, numKey: n.key, ku: st.kleinunternehmer,
    dueDate: dueDateOf(date, inv.dueDays), seller: sellerOf(st) };
  return { invoice: out, counters: { ...st.counters, [n.key]: n.seq } };
}
export const sellerOf = (st) => ({ firm: st.firm, address: st.address, uid: st.uid, email: st.email, phone: st.phone, web: st.web, iban: st.iban, bic: st.bic, bank: st.bank, footer: st.footer });

/** Bezahlt → Einnahme-Belege (ein Beleg je USt-Satz, damit die USt stimmt). */
export function paidBookings(invRaw, settings, { date, pay = "bank", newId }) {
  const inv = normInvoice(invRaw);
  const t = invoiceTotals(inv, settings);
  return t.groups.filter((g) => g.gross !== 0).map((g) => normBeleg({
    id: newId(), type: "in", date, gross: g.gross, rate: g.rate, cat: "erloese", pay, partner: inv.customer.name,
    note: `Rechnung ${inv.number}${t.groups.length > 1 ? ` (${fmtRate(g.rate)})` : ""}`, invoiceId: inv.id, created: Date.now(), updated: Date.now(),
  }));
}

/** Stornorechnung: gleiche Positionen mit negativer Menge, eigene fortlaufende Nummer, Verweis auf das Original. */
export function stornoOf(origRaw, settingsRaw, allInvoices, today, newId) {
  const orig = normInvoice(origRaw);
  if (orig.kind === "storno" || !orig.number || orig.status === "entwurf" || orig.status === "storniert") throw new Error("Diese Rechnung kann nicht storniert werden.");
  const st = normSettings(settingsRaw);
  const n = nextNumber(st, allInvoices, yearOf(today));
  const storno = normInvoice({
    ...orig, id: newId(), kind: "storno", status: "offen", number: n.number, seq: n.seq, numKey: n.key, date: today, dueDate: "",
    items: orig.items.map((it) => ({ ...it, qty: -it.qty })), refId: orig.id, refNumber: orig.number, paidOn: "", pay: "", stornoId: "",
    note: `Storno zu Rechnung ${orig.number} vom ${fmtKey(orig.date)}.`, created: Date.now(), updated: Date.now(),
  });
  storno.ku = invKu(orig, st); storno.seller = orig.seller || sellerOf(st);
  return { storno, orig: { ...orig, status: "storniert", stornoId: storno.id, updated: Date.now() }, counters: { ...st.counters, [n.key]: n.seq } };
}

/** Offene/überfällige Rechnungen (für Übersicht + Mitteilungen). */
export function dueInvoices(list, today, soonDays = 3) {
  const out = [];
  for (const raw of list || []) {
    const inv = normInvoice(raw);
    if (inv.kind !== "rechnung" || inv.status !== "offen" || !inv.dueDate) continue;
    const days = daysBetween(today, inv.dueDate);
    out.push({ id: inv.id, number: inv.number, customer: inv.customer.name, gross: invoiceTotals(inv).gross, dueDate: inv.dueDate, days, overdue: days < 0, soon: days >= 0 && days <= soonDays, hash: invoiceHash(inv.id) });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* ---------- Auswertungen (E/A-Rechnung) ---------- */

/** Summen über Belege (nach Zahlungsdatum!). Kleinunternehmer: Bruttosystem, sonst Nettosystem. */
export function sums(belege, { ku = false, from = "", to = "" } = {}) {
  const r = { inGross: 0, inNet: 0, inVat: 0, outGross: 0, outNet: 0, outVat: 0, count: 0 };
  for (const raw of belege || []) {
    const b = normBeleg(raw);
    if (!b.date || (from && b.date < from) || (to && b.date > to)) continue;
    const a = belegAmounts(b, ku);
    const p = b.type === "in" ? "in" : "out";
    r[p + "Gross"] += a.gross; r[p + "Net"] += a.net; r[p + "Vat"] += a.vat; r.count++;
  }
  r.income = ku ? r.inGross : r.inNet;
  r.expense = ku ? r.outGross : r.outNet;
  r.profit = r.income - r.expense;
  r.zahllast = ku ? 0 : r.inVat - r.outVat; // positiv = ans Finanzamt, negativ = Gutschrift (Orientierung!)
  return r;
}
const lastDay = (y, m) => new Date(y, m, 0).getDate();
/** Zeitraum → { from, to, label } für „month“ (n=1–12), „quarter“ (1–4), „year“. */
export function periodRange(year, by, n = 1) {
  if (by === "year") return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  if (by === "quarter") { const m1 = (n - 1) * 3 + 1, m3 = m1 + 2; return { from: `${year}-${pad(m1)}-01`, to: `${year}-${pad(m3)}-${lastDay(year, m3)}`, label: `Q${n} ${year}` }; }
  return { from: `${year}-${pad(n)}-01`, to: `${year}-${pad(n)}-${lastDay(year, n)}`, label: `${MONTHS[n - 1]} ${year}` };
}
export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
/** Jahresbericht: Zeilen je Monat oder Quartal + Summe. */
export function report(belege, year, { ku = false, by = "month" } = {}) {
  const n = by === "quarter" ? 4 : 12;
  const rows = [];
  for (let i = 1; i <= n; i++) { const p = periodRange(year, by, i); rows.push({ ...p, n: i, ...sums(belege, { ku, from: p.from, to: p.to }) }); }
  const y = periodRange(year, "year");
  return { rows, total: { ...y, ...sums(belege, { ku, from: y.from, to: y.to }) }, ku, by, year };
}
/** Ausgaben je Kategorie (Jahr). */
export function byCategory(belege, year, ku = false) {
  const m = new Map();
  for (const raw of belege || []) {
    const b = normBeleg(raw);
    if (yearOf(b.date) !== year) continue;
    const a = belegAmounts(b, ku);
    const k = b.type + ":" + b.cat;
    m.set(k, (m.get(k) || 0) + (ku ? a.gross : a.net));
  }
  return [...m.entries()].map(([k, sum]) => { const [type, cat] = k.split(":"); return { type, cat, sum, ...catById(cat) }; }).sort((a, b) => b.sum - a.sum);
}

/**
 * Kleinunternehmer-Grenze (Orientierung): Einnahmen brutto des Jahres (Zahlungsdatum) + noch offene Rechnungen des Jahres.
 * → { sum, limit, tolLimit, pct, state: "ok"|"near"|"tolerance"|"over" }
 */
export function kuProgress(belege, invoices, year) {
  const limit = rule("kuLimit") * 100;
  const tolLimit = roundDiv(limit * (100 + rule("kuTolerancePct")), 100);
  let sum = 0;
  for (const raw of belege || []) { const b = normBeleg(raw); if (b.type === "in" && yearOf(b.date) === year) sum += b.gross; }
  for (const raw of invoices || []) {
    const inv = normInvoice(raw);
    if (inv.kind === "rechnung" && inv.status === "offen" && yearOf(inv.date) === year) sum += invoiceTotals(inv).gross;
  }
  const pct = limit ? Math.round((sum / limit) * 1000) / 10 : 0;
  const state = sum > tolLimit ? "over" : sum > limit ? "tolerance" : sum >= limit * 0.85 ? "near" : "ok";
  return { sum, limit, tolLimit, pct, state };
}

/** Aufbewahren bis (31.12. des Jahres + 7). */
export const keepUntil = (k) => (isKey(k) ? `31.12.${yearOf(k) + rule("keepYears")}` : "");

/* ---------- Export ---------- */

function cell(v) {
  let t = v == null ? "" : String(v);
  if (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && !/^-\d+(,\d+)?$/.test(t))) t = "'" + t; // CSV-Formel-Schutz (Excel)
  return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
/** Zeilen → CSV mit ; + UTF-8-BOM + CRLF (Excel-tauglich in Österreich). */
export const csv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
const rateTxt = (r) => String(r).replace(".", ",");

export const BELEG_HEAD = ["Datum (Zahlung)", "Art", "Kategorie", "Partner", "Notiz", "Brutto €", "USt-Satz %", "Netto €", "USt/VSt €", "Zahlungsart", "Rechnung", "Belege (Dokumente)", "Aufbewahren bis"];
export function belegRows(belege, { ku = false, invoices = [], docRefs = null, year = 0 } = {}) {
  const invNo = new Map((invoices || []).map((i) => [i.id, i.number]));
  return (belege || []).map(normBeleg).filter((b) => b.date && (!year || yearOf(b.date) === year)).sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => { const a = belegAmounts(b, ku); return [fmtKey(b.date), b.type === "in" ? "Einnahme" : "Ausgabe", catById(b.cat).label, b.partner, b.note,
      plain(b.gross), rateTxt(b.rate), plain(a.net), plain(a.vat), payById(b.pay).label, invNo.get(b.invoiceId) || "", (docRefs ? docRefs(b) : b.docIds).join(", "), keepUntil(b.date)]; });
}
export const belegeCSV = (belege, opts = {}) => csv([BELEG_HEAD, ...belegRows(belege, opts)]);

export const INVOICE_HEAD = ["Nummer", "Art", "Rechnungsdatum", "Leistung von", "Leistung bis", "Kunde", "Kunden-UID", "Netto €", "USt €", "Brutto €", "Status", "Fällig am", "Bezahlt am", "Bezug (Storno)"];
export function invoiceRows(invoices, { year = 0, today = "" } = {}) {
  return (invoices || []).map(normInvoice).filter((i) => i.number && (!year || yearOf(i.date) === year)).sort((a, b) => (a.numKey + pad(a.seq || 0, 6)).localeCompare(b.numKey + pad(b.seq || 0, 6)))
    .map((i) => { const t = invoiceTotals(i); return [i.number, i.kind === "storno" ? "Stornorechnung" : "Rechnung", fmtKey(i.date), fmtKey(i.serviceFrom), fmtKey(i.serviceTo), i.customer.name, i.customer.uid,
      plain(t.net), plain(t.vat), plain(t.gross), STATUS[invoiceStatus(i, today)].label, fmtKey(i.dueDate), fmtKey(i.paidOn), i.refNumber]; });
}
export const invoicesCSV = (invoices, opts = {}) => csv([INVOICE_HEAD, ...invoiceRows(invoices, opts)]);

/** Belege-Liste für die Steuerberatung: welcher Beleg hat welches abgelegte Dokument – und wo fehlt eines. */
export const BELEGLIST_HEAD = ["Nr.", "Datum (Zahlung)", "Art", "Partner", "Brutto €", "Kategorie", "Rechnung", "Dokument-Referenzen", "Status"];
export function belegListRows(belege, { invoices = [], docRefs = null, year = 0 } = {}) {
  const invNo = new Map((invoices || []).map((i) => [i.id, i.number]));
  return (belege || []).map(normBeleg).filter((b) => b.date && (!year || yearOf(b.date) === year)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((b, i) => { const refs = docRefs ? docRefs(b) : b.docIds; const inv = invNo.get(b.invoiceId) || "";
      return [String(i + 1), fmtKey(b.date), b.type === "in" ? "Einnahme" : "Ausgabe", b.partner, plain(b.gross), catById(b.cat).label, inv, refs.join(", "),
        refs.length ? "abgelegt" : inv ? "Ausgangsrechnung (Nr. " + inv + ")" : "Beleg fehlt"]; });
}
export const belegListCSV = (belege, opts = {}) => csv([BELEGLIST_HEAD, ...belegListRows(belege, opts)]);

/** Zusammenfassung als Zeilen (Excel-Blatt / Jahres-PDF). */
export function summaryRows(rep) {
  const head = ["Zeitraum", "Einnahmen €", "Ausgaben €", "Gewinn (E/A) €", ...(rep.ku ? [] : ["USt €", "Vorsteuer €", "Zahllast (Orientierung) €"])];
  const line = (r) => [r.label, plain(r.income), plain(r.expense), plain(r.profit), ...(rep.ku ? [] : [plain(r.inVat), plain(r.outVat), plain(r.zahllast)])];
  return [head, ...rep.rows.map(line), line({ ...rep.total, label: "Summe " + rep.year })];
}

/* ---------- Belegscanner (KI-Antwort) ---------- */

export const SCAN_PROMPT = "Lies diesen Kassenbon/diese Rechnung. Antworte NUR mit striktem JSON ohne Text davor oder danach, genau so: " +
  '{"datum":"JJJJ-MM-TT","betrag_brutto":12.34,"ust_satz":20,"haendler":"Name","kategorie_vorschlag":"' + CATS.filter((c) => c.type === "out").map((c) => c.id).join("|") + '"}. ' +
  "ust_satz ist einer von 20, 13, 10, 4.9 oder 0 (bei mehreren Sätzen den mit dem größten Anteil). Unbekanntes als null.";
/** KI-Antwort → { date, gross (Cent), rate, partner, cat } – alles geprüft; Unbrauchbares wird leer/null. null = kein JSON gefunden. */
export function parseScan(reply) {
  const t = String(reply || "");
  const m = /\{[\s\S]*\}/.exec(t.replace(/```(json)?/g, ""));
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  let date = "";
  const ds = s(o.datum);
  if (isKey(ds)) date = ds;
  else { const d = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(ds); if (d) { const y = d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3]); const k = `${y}-${pad(d[2])}-${pad(d[1])}`; if (isKey(k)) date = k; } }
  const g = o.betrag_brutto == null ? NaN : toCents(o.betrag_brutto);
  const r = o.ust_satz == null ? null : normRate(o.ust_satz);
  const cs = s(o.kategorie_vorschlag).toLowerCase();
  const cat = (CATS.find((c) => c.type === "out" && (c.id === cs || c.label.toLowerCase() === cs)) || {}).id || "";
  return { date, gross: Number.isFinite(g) && g > 0 && g < 1e10 ? g : null, rate: r != null && RATES.includes(r) ? r : null, partner: s(o.haendler).slice(0, 120), cat };
}

/* ---------- Suche / Ziele ---------- */
export const belegHash = (id) => `#alltag/buchhaltung/beleg/${encodeURIComponent(s(id))}`;
export const invoiceHash = (id) => `#alltag/buchhaltung/rechnung/${encodeURIComponent(s(id))}`;
/** #alltag/buchhaltung/<tab>[/<id>] → { tab, id } */
export function route(hash) {
  const m = /^#?alltag\/buchhaltung(?:\/([a-z]+))?(?:\/([^?#]+))?/.exec(String(hash || ""));
  if (!m) return { tab: "", id: "" };
  let id = "";
  try { id = m[2] ? decodeURIComponent(m[2]) : ""; } catch { id = ""; }
  return { tab: m[1] || "", id };
}
export const belegSearchText = (b) => [b.partner, b.note, catById(b.cat).label, b.type === "in" ? "Einnahme" : "Ausgabe Beleg"].join(" ");
export const invoiceSearchText = (i) => [i.number, i.customer.name, i.customer.address, i.note, ...i.items.map((x) => x.text), "Rechnung"].join(" ");

export { RULES };
