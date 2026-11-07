// Update 10 E – 📦 Inventar: reine Logik ohne DOM (Node-testbar).
// Sammlung „inventar“ (users/{uid}/a_inventar): Dinge mit Kaufdatum, Kaufpreis, Händler, Seriennummer, Garantie, Raum/Ort, Foto.
// Foto in der Unterwegs-Bildablage (travel_images, ID "inv_<id>") wie beim Werkzeug; Rechnung = Dokument-Verknüpfung (dokumente.links).
import { isKey, addDays, daysBetween, fmtDate, round2 } from "./money-core.js";
import { addMonths } from "./subs-core.js";

export const CATS = [
  { id: "elektronik", e: "💻", label: "Elektronik" },
  { id: "haushalt", e: "🍳", label: "Haushaltsgerät" },
  { id: "moebel", e: "🛋️", label: "Möbel" },
  { id: "werkzeug", e: "🔧", label: "Werkzeug & Garten" },
  { id: "sport", e: "🚲", label: "Sport & Freizeit" },
  { id: "kleidung", e: "🧥", label: "Kleidung & Schmuck" },
  { id: "sonstiges", e: "📦", label: "Sonstiges" },
];
export const ROOMS = ["Wohnzimmer", "Küche", "Schlafzimmer", "Bad", "Büro", "Keller", "Garage", "Auto"];
export const catById = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
export const SOON_DAYS = 30;
const s = (v) => String(v ?? "").trim();
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function normItem(x) {
  const c = x && typeof x === "object" ? x : {};
  return {
    id: s(c.id), name: s(c.name).slice(0, 120), cat: catById(c.cat).id, room: s(c.room).slice(0, 60),
    brand: s(c.brand).slice(0, 120), serial: s(c.serial).slice(0, 80), shop: s(c.shop).slice(0, 120),
    boughtOn: isKey(c.boughtOn) ? c.boughtOn : "", price: num(c.price) != null && num(c.price) >= 0 ? round2(c.price) : null,
    warrantyUntil: isKey(c.warrantyUntil) ? c.warrantyUntil : "", photoId: s(c.photoId), notes: s(c.notes).slice(0, 4000),
    remind: c.remind !== false, created: Number(c.created) || 0, updated: Number(c.updated) || 0,
  };
}

/** Garantie-Ende aus Kaufdatum + Monate (z. B. 24 → zwei Jahre, letzter Tag davor). */
export function warrantyFrom(boughtOn, months) {
  const m = Math.round(Number(months) || 0);
  if (!isKey(boughtOn) || m <= 0) return "";
  return addDays(addMonths(boughtOn, m), -1);
}

/** Garantie-Status → { state: "none"|"ok"|"bald"|"ab", due, days, label, e } */
export function warrantyStatus(raw, today, soonDays = SOON_DAYS) {
  const it = normItem(raw);
  if (!it.warrantyUntil) return { state: "none", due: "", days: null, label: "keine Garantie eingetragen", e: "" };
  const days = daysBetween(today, it.warrantyUntil);
  if (days < 0) return { state: "ab", due: it.warrantyUntil, days, label: `Garantie abgelaufen (${fmtDate(it.warrantyUntil)})`, e: "⌛" };
  if (days <= soonDays) return { state: "bald", due: it.warrantyUntil, days, label: days === 0 ? "Garantie endet heute" : days === 1 ? "Garantie endet morgen" : `Garantie endet in ${days} Tagen`, e: "⏰" };
  return { state: "ok", due: it.warrantyUntil, days, label: `Garantie bis ${fmtDate(it.warrantyUntil)}`, e: "🛡️" };
}

/** Bald ablaufende Garantien (Benachrichtigung „garantie“). */
export function dueWarranties(list, today, soonDays = SOON_DAYS) {
  return (list || []).map(normItem).filter((it) => it.id && it.name && it.remind)
    .map((it) => ({ it, w: warrantyStatus(it, today, soonDays) }))
    .filter((x) => x.w.state === "bald")
    .sort((a, b) => a.w.days - b.w.days)
    .map(({ it, w }) => ({ id: it.id, name: it.name, e: catById(it.cat).e, due: w.due, days: w.days, text: `${catById(it.cat).e} ${it.name}: ${w.label}`, hash: itemHash(it.id) }));
}

/** Gesamtwert je Raum → [{ room, n, value }] (größter Wert zuerst; ohne Raum = „Ohne Ort“). */
export function totalsByRoom(list) {
  const m = new Map();
  for (const raw of list || []) {
    const it = normItem(raw);
    if (!it.id) continue;
    const k = it.room || "Ohne Ort";
    const r = m.get(k) || { room: k, n: 0, value: 0 };
    r.n++; r.value = round2(r.value + (it.price || 0));
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.value - a.value || a.room.localeCompare(b.room, "de"));
}
export const totalValue = (list) => round2((list || []).reduce((a, x) => a + (normItem(x).price || 0), 0));

export function filterItems(list, { q = "", room = "", view = "alle" } = {}, today) {
  const f = s(q).toLowerCase();
  return (list || []).map(normItem).filter((it) => it.id && it.name)
    .filter((it) => !room || (it.room || "Ohne Ort") === room)
    .filter((it) => view !== "garantie" || ["bald", "ok"].includes(warrantyStatus(it, today).state))
    .filter((it) => !f || searchText(it).toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export const itemHash = (id) => `#alltag/inventar/${encodeURIComponent(s(id))}`;
export const itemUrl = (base, id) => s(base).replace(/[?#].*$/, "") + itemHash(id);
export function routeId(hash) {
  const m = /#?alltag\/inventar\/([^?/]+)/.exec(String(hash || ""));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
export function searchText(raw) {
  const it = normItem(raw);
  return [it.name, it.brand, it.serial, it.serial.replace(/[^A-Za-z0-9]/g, ""), it.shop, it.room, catById(it.cat).label, it.notes, "Inventar Garantie"].join(" ");
}
