// 🎬 Freizeit-Listen – reine Logik (kein DOM). Sammlung „freizeit_listen“ (js/alltag/db.js → a_freizeit_listen).
// Datenmodell:
//   { id, type, title, status: "idee"|"laeuft"|"fertig", rating 0–5, note, progress, person, occasion, date (YYYY-MM-DD),
//     price (Zahl, nur Geschenke), link (nur https), created, updated, doneAt }
// type: serie · film · buch · spiel · musik · hobby · ausflug · projekt · geschenk

export const TYPES = [
  { id: "serie", e: "📺", label: "Serien", one: "Serie", progress: "z. B. S2 E5" },
  { id: "film", e: "🎬", label: "Filme", one: "Film" },
  { id: "buch", e: "📚", label: "Bücher", one: "Buch", progress: "z. B. Seite 120" },
  { id: "spiel", e: "🎮", label: "Games", one: "Game", progress: "z. B. Level 12" },
  { id: "musik", e: "🎵", label: "Musik", one: "Musik-Favorit" },
  { id: "hobby", e: "🎨", label: "Hobbys", one: "Hobby" },
  { id: "ausflug", e: "🏞️", label: "Ausflüge", one: "Ausflug" },
  { id: "projekt", e: "🛠️", label: "Projekte", one: "Projekt", progress: "z. B. 60 %" },
  { id: "geschenk", e: "🎁", label: "Geschenkideen", one: "Geschenkidee" },
];
export const STATUS = {
  idee: { e: "💭", label: "Auf der Liste" },
  laeuft: { e: "▶️", label: "Gerade dabei" },
  fertig: { e: "✅", label: "Fertig" },
};
/** Status-Wörter je Typ (Geschenke: Idee → besorgt → verschenkt). */
export function statusLabel(type, st) {
  if (type === "geschenk") return { idee: "💡 Idee", laeuft: "🛍️ Besorgt", fertig: "🎁 Verschenkt" }[st] || "💡 Idee";
  if (type === "ausflug") return { idee: "💭 Will ich hin", laeuft: "📅 Geplant", fertig: "✅ War dort" }[st] || "💭 Will ich hin";
  return `${STATUS[st] ? STATUS[st].e : "💭"} ${STATUS[st] ? STATUS[st].label : STATUS.idee.label}`;
}
export const typeById = (id) => TYPES.find((t) => t.id === id) || TYPES[0];
const s = (v) => (v == null ? "" : String(v)).trim();
const isKey = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

export function normItem(x = {}) {
  const type = TYPES.some((t) => t.id === x.type) ? x.type : "serie";
  const status = STATUS[x.status] ? x.status : "idee";
  const r = Math.round(Number(x.rating) || 0);
  const price = Number(String(x.price ?? "").replace(",", "."));
  const link = /^https:\/\/[^\s<>"']+$/i.test(s(x.link)) ? s(x.link).slice(0, 300) : "";
  return {
    id: s(x.id), type, title: s(x.title).slice(0, 120), status,
    rating: Math.max(0, Math.min(5, r)), note: s(x.note).slice(0, 500), progress: s(x.progress).slice(0, 40),
    person: s(x.person).slice(0, 60), occasion: s(x.occasion).slice(0, 60), date: isKey(x.date) ? x.date : "",
    price: type === "geschenk" && Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0,
    link, created: Number(x.created) || 0, updated: Number(x.updated) || 0, doneAt: Number(x.doneAt) || 0,
  };
}

/** Neuer Eintrag aus Formularfeldern; wirft bei fehlendem Titel. */
export function makeItem(fields, now) {
  const it = normItem({ ...fields, created: now, updated: now });
  if (!it.title) throw new Error("Bitte einen Titel eingeben.");
  if (it.status === "fertig") it.doneAt = now;
  return it;
}

/** Nächster Status: Idee → läuft → fertig → Idee. */
export function cycle(item, now) {
  const order = ["idee", "laeuft", "fertig"];
  const next = order[(order.indexOf(item.status) + 1) % order.length];
  return { ...item, status: next, doneAt: next === "fertig" ? now : 0, updated: now };
}

/** Sortierung: läuft zuerst, dann Ideen, fertig zuletzt; innerhalb neueste zuerst (fertig: zuletzt erledigt zuerst). */
export function sortItems(arr) {
  const rank = { laeuft: 0, idee: 1, fertig: 2 };
  return [...arr].sort((a, b) => rank[a.status] - rank[b.status] ||
    (a.status === "fertig" ? b.doneAt - a.doneAt : (a.date || "9999").localeCompare(b.date || "9999") || b.updated - a.updated));
}

export function filterItems(arr, { type = "", status = "", q = "" } = {}) {
  const needle = s(q).toLowerCase();
  return arr.filter((i) => (!type || i.type === type) && (!status || i.status === status) &&
    (!needle || searchText(i).includes(needle)));
}

export const searchText = (i) => [i.title, i.note, i.progress, i.person, i.occasion].join(" ").toLowerCase();

/** Zahlen für die Kopfzeile je Typ + Gesamt. */
export function counts(arr) {
  const by = {};
  for (const t of TYPES) by[t.id] = { all: 0, laeuft: 0, idee: 0, fertig: 0 };
  for (const i of arr) { const c = by[i.type]; if (c) { c.all++; c[i.status]++; } }
  const year = new Date().getFullYear();
  const doneThisYear = arr.filter((i) => i.status === "fertig" && i.doneAt && new Date(i.doneAt).getFullYear() === year).length;
  return { by, total: arr.length, running: arr.filter((i) => i.status === "laeuft").length, doneThisYear };
}

/** Geschenkideen je Person gruppiert (für die Geschenk-Ansicht), Summe offener Ideen. */
export function giftsByPerson(arr) {
  const map = new Map();
  for (const g of arr.filter((i) => i.type === "geschenk")) {
    const k = g.person || "Ohne Person";
    if (!map.has(k)) map.set(k, { person: k, items: [], open: 0 });
    const e = map.get(k);
    e.items.push(g);
    if (g.status !== "fertig") e.open += g.price;
  }
  return [...map.values()].sort((a, b) => a.person.localeCompare(b.person, "de"));
}

/** Hinweise für Benachrichtigungen/Dashboard: Geschenk-Anlässe in den nächsten `days` Tagen, die noch nicht verschenkt sind. */
export function upcomingGifts(arr, todayKey, days = 14) {
  const end = addDaysKey(todayKey, days);
  return arr.filter((i) => i.type === "geschenk" && i.status !== "fertig" && i.date && i.date >= todayKey && i.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function addDaysKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
export const fmtPrice = (v) => v ? v.toLocaleString("de-AT", { style: "currency", currency: "EUR" }) : "";
export const listHash = (type) => `#alltag/listen${type ? "/" + encodeURIComponent(type) : ""}`;
export function routeType(hash) {
  const m = String(hash || "").match(/^#alltag\/listen\/([a-z]+)/);
  return m && TYPES.some((t) => t.id === m[1]) ? m[1] : "";
}
