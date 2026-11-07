// Update 10 – 🛒 Einkaufsliste: reine Logik (ohne DOM/Firebase), gemeinsam für Web-App und MCP-Server (tools/mcp/src/einkauf.js).
// Sammlungen (js/alltag/db.js): einkauf (Artikel) · einkauf_lists (Listen + ein Dokument "history" mit den zuletzt gekauften Namen).
// Artikel: { id, listId, name, qty|null, unit, cat, done, doneAt|null, note, created, updated }
// Material mit Status „brauche“ (Alltag › Material) erscheint live in der Liste „🧰 Material fehlt“ – keine Kopie,
// Abhaken setzt dort den Material-Status auf „besorgt“ (nächster Schritt im Material-Modul).

export const CATS = Object.freeze([
  { id: "lebensmittel", label: "Lebensmittel", e: "🥕" },
  { id: "drogerie", label: "Drogerie", e: "🧴" },
  { id: "baumarkt", label: "Baumarkt/Elektro", e: "🔌" },
  { id: "sonstiges", label: "Sonstiges", e: "📦" },
]);
export const CAT_IDS = CATS.map((c) => c.id);
export const catById = (id) => CATS.find((c) => c.id === id) || CATS[CATS.length - 1];
export const UNITS = Object.freeze(["Stk", "g", "kg", "ml", "l", "Pkg", "m", "Rolle"]);
export const LIST_EMOJIS = Object.freeze(["🏠", "🏗️", "🛒", "🎉", "🍳", "🐾", "🎁", "🧰"]);
export const DEFAULT_LISTS = Object.freeze([
  { id: "privat", name: "Privat", e: "🏠", order: 0 },
  { id: "baustelle", name: "Baustelle", e: "🏗️", order: 1 },
]);
export const MATERIAL_LIST = "material"; // virtuelle Liste „🧰 Material fehlt“
export const HISTORY_ID = "history";
export const NAME_MAX = 80;
export const MAX_HISTORY = 200;

const s = (v) => (v == null ? "" : String(v).trim());

/** Vergleichsform: klein, ohne Akzente, ä→a, ß→ss, Satzzeichen weg. */
export function norm(v) {
  return s(v).toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function cleanQty(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(100000, Math.round(n * 1000) / 1000);
}

export function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/** „2 kg“, „3×“, „“ (ohne Menge). */
export function qtyText(qty, unit) {
  const q = cleanQty(qty);
  if (!q) return "";
  const u = s(unit);
  return !u || u === "Stk" ? `${fmtNum(q)}×` : `${fmtNum(q)} ${u}`;
}

export function lineText(it) {
  const q = qtyText(it && it.qty, it && it.unit);
  return `${q ? q + " " : ""}${s(it && it.name)}`;
}

const UNIT_ALIAS = {
  stk: "Stk", stück: "Stk", stueck: "Stk", st: "Stk", x: "Stk", "×": "Stk",
  g: "g", gramm: "g", kg: "kg", kilo: "kg", ml: "ml", l: "l", liter: "l",
  pkg: "Pkg", packung: "Pkg", packungen: "Pkg", pack: "Pkg", pk: "Pkg", m: "m", meter: "m", rolle: "Rolle", rollen: "Rolle",
};
export function unitOf(v) { const t = s(v).toLowerCase().replace(/\.$/, ""); return UNIT_ALIAS[t] || null; }

/**
 * Schnell-Eingabe zerlegen: „2 kg Äpfel“, „3x Brot“, „Milch 2“, „500g Faschiertes“, „Brot“.
 * → { name, qty|null, unit }
 */
export function parseQuick(text) {
  let t = s(text).replace(/\s+/g, " ").slice(0, 200);
  let qty = null, unit = "Stk";
  let m = /^(\d+(?:[.,]\d+)?)\s*(?:(x|×|stk\.?|stück|stueck|g|gramm|kg|kilo|ml|l|liter|pkg\.?|packung(?:en)?|pack|m|meter|rollen?)(?=\s|$))?\s*(.*)$/i.exec(t);
  if (m && m[3]) {
    qty = cleanQty(m[1]);
    unit = unitOf(m[2]) || "Stk";
    t = m[3];
  } else {
    m = /^(.*\S)\s+(\d+(?:[.,]\d+)?)\s*(x|×|stk\.?|g|kg|ml|l|pkg\.?|m)?$/i.exec(t);
    if (m) { t = m[1]; qty = cleanQty(m[2]); unit = unitOf(m[3]) || "Stk"; }
  }
  return { name: t.slice(0, NAME_MAX).trim(), qty, unit };
}

// Stichwörter für die automatische Kategorie (Vergleichsform, Wortanfang reicht)
const KW = {
  lebensmittel: "milch brot semmel gebäck kase käse butter joghurt topfen eier ei apfel äpfel banane birne obst gemuse gemüse tomate gurke salat paprika zwiebel knoblauch kartoffel erdapfel nudel spaghetti reis mehl zucker salz pfeffer ol öl essig kaffee tee wasser saft bier wein limo cola fleisch faschiert wurst schinken huhn hendl fisch thunfisch pizza chips schokolade kekse müsli musli honig marmelade senf ketchup mayo sahne obers rahm schlag hafer tofu linsen bohnen mais orangen zitrone beeren trauben",
  drogerie: "zahnpasta zahnburste zahnbürste shampoo duschgel seife deo deodorant creme klopapier toilettenpapier taschentuch küchenrolle kuchenrolle waschmittel weichspüler spülmittel spulmittel geschirrtabs tabs müllsack mullsack müllbeutel rasier binden tampon windel pflaster parfum lotion wattepads abschmink haargel sonnencreme putzmittel reiniger schwamm",
  baumarkt: "kabel nym schuko steckdose schalter dose wago klemme sicherung fi ls leitung rohr dübel dubel schraube nagel bohrer bit akku batterie lampe leuchtmittel glühbirne gluhbirne led silikon kleber isolierband panzerband kabelbinder werkzeug zange säge sage farbe pinsel spachtel gips montage verteiler abzweig stecker verlängerung verlangerung",
};
const KW_SETS = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, [...new Set(v.split(" ").map(norm).filter(Boolean))]]));

/** Kategorie raten (Verlauf gewinnt, dann Stichwörter, sonst Sonstiges). */
export function guessCat(name, history = null) {
  const n = norm(name);
  if (!n) return "sonstiges";
  const h = history && history.names && history.names[n];
  if (h && CAT_IDS.includes(h.cat)) return h.cat;
  const words = n.split(" ");
  for (const [cat, list] of Object.entries(KW_SETS)) {
    for (const w of words) if (w.length >= 2 && list.some((k) => w === k || (k.length >= 4 && (w.startsWith(k) || w.endsWith(k))) || (w.length >= 5 && k.startsWith(w)))) return cat;
  }
  return "sonstiges";
}

export function normItem(x, now = Date.now()) {
  const done = !!(x && x.done);
  return {
    ...x,
    listId: s(x && x.listId) || "privat",
    name: s(x && x.name).slice(0, NAME_MAX),
    qty: cleanQty(x && x.qty),
    unit: UNITS.includes(x && x.unit) ? x.unit : "Stk",
    cat: CAT_IDS.includes(x && x.cat) ? x.cat : "sonstiges",
    done,
    doneAt: done ? (Number(x && x.doneAt) || now) : null,
    note: s(x && x.note).slice(0, 300),
  };
}

export function normList(x, i = 0) {
  return {
    ...x,
    id: s(x && x.id),
    name: s(x && x.name).slice(0, 40) || "Liste",
    e: s(x && x.e) || "🛒",
    order: Number.isFinite(Number(x && x.order)) ? Number(x.order) : 100 + i,
  };
}

/** Listen aus der Sammlung (ohne Verlauf-Dokument); ohne eigene Listen → Standardlisten Privat + Baustelle. */
export function listsOf(docs) {
  const own = (Array.isArray(docs) ? docs : []).filter((d) => d && d.id && d.id !== HISTORY_ID && d.kind !== "history" && !d.deleted);
  const map = new Map(DEFAULT_LISTS.map((l) => [l.id, { ...l }]));
  for (const d of own) map.set(d.id, normList(d));
  // gelöschte Standardlisten bleiben weg
  for (const d of Array.isArray(docs) ? docs : []) if (d && d.deleted && map.has(d.id)) map.delete(d.id);
  const out = [...map.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "de"));
  return out.length ? out : DEFAULT_LISTS.map((l) => ({ ...l }));
}

export function historyOf(docs) {
  const h = (Array.isArray(docs) ? docs : []).find((d) => d && d.id === HISTORY_ID);
  return { id: HISTORY_ID, kind: "history", names: (h && h.names && typeof h.names === "object") ? h.names : {} };
}

/** Verlauf um Artikel ergänzen → neues names-Objekt (begrenzt auf MAX_HISTORY, älteste fliegen raus). */
export function addToHistory(names, items, now = Date.now()) {
  const out = { ...(names || {}) };
  for (const it of items || []) {
    const n = norm(it && it.name);
    if (!n) continue;
    const cur = out[n] || {};
    out[n] = { name: s(it.name).slice(0, NAME_MAX), cat: CAT_IDS.includes(it.cat) ? it.cat : (cur.cat || "sonstiges"), unit: UNITS.includes(it.unit) ? it.unit : "Stk", count: (Number(cur.count) || 0) + 1, last: now };
  }
  const keys = Object.keys(out);
  if (keys.length > MAX_HISTORY) {
    keys.sort((a, b) => (out[b].last || 0) - (out[a].last || 0));
    for (const k of keys.slice(MAX_HISTORY)) delete out[k];
  }
  return out;
}

/**
 * Vorschläge beim Tippen: Verlauf (häufig/zuletzt), ohne Namen, die schon offen auf der Liste stehen.
 * Leere Eingabe → die häufigsten. → [{ name, cat, unit }]
 */
export function suggest(q, names, openItems = [], limit = 6) {
  const nq = norm(parseQuick(q).name || q);
  const open = new Set((openItems || []).filter((x) => x && !x.done).map((x) => norm(x.name)));
  const list = Object.entries(names || {}).filter(([k]) => !open.has(k));
  const scored = [];
  for (const [k, v] of list) {
    let sc;
    if (!nq) sc = 1;
    else if (k === nq) continue; // genau das steht schon im Feld
    else if (k.startsWith(nq)) sc = 3;
    else if (k.split(" ").some((w) => w.startsWith(nq))) sc = 2;
    else if (nq.length >= 3 && k.includes(nq)) sc = 1;
    else continue;
    scored.push({ sc, count: Number(v.count) || 0, last: Number(v.last) || 0, name: v.name, cat: v.cat, unit: v.unit });
  }
  scored.sort((a, b) => b.sc - a.sc || b.count - a.count || b.last - a.last);
  return scored.slice(0, limit).map(({ name, cat, unit }) => ({ name, cat, unit }));
}

/** Offene zuerst (nach Kategorie, dann Anlage), erledigte nach unten (zuletzt abgehakt oben). */
export function sortItems(items) {
  const order = (c) => { const i = CAT_IDS.indexOf(c); return i < 0 ? 99 : i; };
  return [...(items || [])].sort((a, b) =>
    (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
    (a.done ? (b.doneAt || 0) - (a.doneAt || 0) : order(a.cat) - order(b.cat) || (a.created || 0) - (b.created || 0)));
}

/** Offene Artikel nach Kategorie gruppiert → [{ cat, items }] (in CATS-Reihenfolge). */
export function groupOpen(items) {
  const open = sortItems(items).filter((x) => !x.done);
  return CATS.map((c) => ({ cat: c, items: open.filter((x) => x.cat === c.id) })).filter((g) => g.items.length);
}

/** Material „brauche“ = fehlt → Einkauf; „besorgt“ der letzten 12 h als abgehakt (zum Zurücknehmen). */
export const MAT_RECENT_MS = 12 * 3600 * 1000;
export function materialRows(matItems, now = Date.now()) {
  const out = [];
  for (const m of matItems || []) {
    if (!m || !s(m.name)) continue;
    if (m.status === "brauche") out.push({ id: m.id, name: s(m.name), qty: Number(m.qty) || 1, unit: s(m.unit) || "Stk", place: s(m.place), done: false, created: Number(m.created) || 0 });
    else if (m.status === "besorgt" && now - (Number(m.updated) || 0) < MAT_RECENT_MS) out.push({ id: m.id, name: s(m.name), qty: Number(m.qty) || 1, unit: s(m.unit) || "Stk", place: s(m.place), done: true, doneAt: Number(m.updated) || 0 });
  }
  return out.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.done ? b.doneAt - a.doneAt : a.created - b.created));
}

export function openCount(items) { return (items || []).filter((x) => x && !x.done).length; }

/** Text zum Teilen (WhatsApp, Notizen …) – nur offene Artikel. */
export function shareText(list, items, mat = []) {
  const head = `${list && list.e ? list.e + " " : "🛒 "}${(list && list.name) || "Einkauf"}`;
  const lines = [head];
  for (const g of groupOpen(items)) {
    lines.push("", `${g.cat.e} ${g.cat.label}`);
    for (const it of g.items) lines.push(`• ${lineText(it)}${it.note ? ` (${it.note})` : ""}`);
  }
  const m = (mat || []).filter((x) => !x.done);
  if (m.length) {
    lines.push("", "🧰 Material fehlt");
    for (const it of m) lines.push(`• ${fmtNum(it.qty)} ${it.unit} ${it.name}${it.place ? ` – ${it.place}` : ""}`);
  }
  if (lines.length === 1) lines.push("", "Alles erledigt ✅");
  return lines.join("\n");
}

/** Liste per Name finden (unscharf: genau, Wortanfang, enthält). */
export function findList(q, lists) {
  const n = norm(q);
  if (!n) return null;
  return lists.find((l) => norm(l.name) === n || l.id === n) ||
    lists.find((l) => norm(l.name).startsWith(n)) ||
    lists.find((l) => n.length >= 3 && norm(l.name).includes(n)) || null;
}
