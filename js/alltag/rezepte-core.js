// Update 12 – 🍳 Rezepte & Essensplan – reine Logik (kein DOM).
//
// Sammlung „rezepte“:
//   { id, title, emoji, cat, servings, minutes, ingredients: [{ name, qty|null, unit }], steps: [text], tags: [text],
//     allergens: [id], diet: ""|"vegetarisch"|"vegan", fav, rating 0–5, note, source (nur https), created, updated }
// Sammlung „essensplan“ – ein Dokument je Tag (id = YYYY-MM-DD):
//   { id, meals: { fruehstueck|mittag|abend|snack: { recipeId?, text?, servings? } } }
// Vorrat (js/alltag/hausextra-core.js) und Einkaufsliste (js/alltag/einkauf-core.js) werden wiederverwendet.

const s = (v) => (v == null ? "" : String(v)).trim();
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(s(k));
const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export function mondayOf(k) { const d = dateOf(k); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return keyOf(d); }
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const fmtShort = (k) => { const d = dateOf(k); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };

export const CATS = [
  ["fruehstueck", "🥐", "Frühstück"], ["haupt", "🍝", "Hauptspeise"], ["suppe", "🍲", "Suppe"], ["salat", "🥗", "Salat"],
  ["snack", "🥪", "Snack"], ["dessert", "🍰", "Dessert"], ["backen", "🥖", "Backen"], ["getraenk", "🥤", "Getränk"],
];
export const catBy = (id) => CATS.find((c) => c[0] === id) || CATS[1];
export const MEALS = [["fruehstueck", "🌅", "Frühstück"], ["mittag", "☀️", "Mittag"], ["abend", "🌙", "Abend"], ["snack", "🍎", "Snack"]];
/** Die 14 EU-Hauptallergene (Kennbuchstaben wie auf österreichischen Speisekarten). */
export const ALLERGENS = [
  ["A", "Gluten"], ["B", "Krebstiere"], ["C", "Ei"], ["D", "Fisch"], ["E", "Erdnuss"], ["F", "Soja"], ["G", "Milch/Laktose"],
  ["H", "Schalenfrüchte"], ["L", "Sellerie"], ["M", "Senf"], ["N", "Sesam"], ["O", "Sulfite"], ["P", "Lupinen"], ["R", "Weichtiere"],
];
const ALLERGEN_IDS = ALLERGENS.map((a) => a[0]);
export const DIETS = [["", "Alles"], ["vegetarisch", "🥕 Vegetarisch"], ["vegan", "🌱 Vegan"]];
export const UNITS = ["", "g", "kg", "ml", "l", "EL", "TL", "Stk", "Prise", "Pkg", "Dose", "Becher", "Bund", "Zehe", "Scheibe", "Tasse"];

const UNIT_ALIAS = {
  g: "g", gr: "g", gramm: "g", kg: "kg", kilo: "kg", ml: "ml", l: "l", liter: "l", el: "EL", essl: "EL", essloffel: "EL", "esslöffel": "EL",
  tl: "TL", teel: "TL", teeloffel: "TL", "teelöffel": "TL", stk: "Stk", "stück": "Stk", stueck: "Stk", prise: "Prise", prisen: "Prise",
  pkg: "Pkg", packung: "Pkg", pck: "Pkg", dose: "Dose", dosen: "Dose", becher: "Becher", bund: "Bund", zehe: "Zehe", zehen: "Zehe",
  scheibe: "Scheibe", scheiben: "Scheibe", tasse: "Tasse", tassen: "Tasse", cl: "ml",
};
const num = (v) => { const t = s(v).replace(",", "."); if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split("/").map(Number); return b ? a / b : null; } const n = Number(t); return Number.isFinite(n) && n > 0 ? n : null; };
const FRAC = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

/** Zutatenzeile zerlegen: „200 g Mehl“, „2 EL Öl“, „1/2 TL Salz“, „3 Eier“, „Salz“, „½ Zwiebel“. */
export function parseIngredient(line) {
  let t = s(line).replace(/^[-•*·]\s*/, "").replace(/\s+/g, " ").slice(0, 120);
  for (const [k, v] of Object.entries(FRAC)) t = t.replace(new RegExp(`^${k}`), String(v));
  const m = /^(\d+(?:[.,]\d+)?(?:\/\d+)?)\s*([a-zäöüß.]+)?\s+(.+)$/i.exec(t) || /^(\d+(?:[.,]\d+)?)([a-z]+)\s+(.+)$/i.exec(t);
  if (m) {
    const u = m[2] ? UNIT_ALIAS[m[2].toLowerCase().replace(/\.$/, "")] : "";
    if (u !== undefined) return { name: m[3].trim().slice(0, 80), qty: num(m[1]), unit: u };
    return { name: `${m[2]} ${m[3]}`.trim().slice(0, 80), qty: num(m[1]), unit: "" }; // „3 große Eier“
  }
  return { name: t.slice(0, 80), qty: null, unit: "" };
}

export function normRecipe(x = {}) {
  const ings = (Array.isArray(x.ingredients) ? x.ingredients : []).map((i) => (typeof i === "string" ? parseIngredient(i) : i))
    .filter((i) => i && s(i.name)).slice(0, 60)
    .map((i) => ({ name: s(i.name).slice(0, 80), qty: num(i.qty) != null ? Math.round(num(i.qty) * 1000) / 1000 : null, unit: UNITS.includes(i.unit) ? i.unit : "" }));
  const sv = Math.round(Number(x.servings));
  const mins = Math.round(Number(x.minutes));
  return {
    id: s(x.id), title: s(x.title).slice(0, 100), emoji: s(x.emoji).slice(0, 4) || catBy(x.cat)[1], cat: catBy(x.cat)[0],
    servings: sv >= 1 && sv <= 50 ? sv : 2, minutes: mins > 0 && mins <= 1440 ? mins : 0,
    ingredients: ings, steps: (Array.isArray(x.steps) ? x.steps : []).map(s).filter(Boolean).slice(0, 40).map((t) => t.slice(0, 600)),
    tags: [...new Set((Array.isArray(x.tags) ? x.tags : []).map((t) => s(t).toLowerCase().replace(/^#/, "")).filter(Boolean))].slice(0, 12),
    allergens: (Array.isArray(x.allergens) ? x.allergens : []).filter((a) => ALLERGEN_IDS.includes(a)),
    diet: DIETS.some((d) => d[0] === x.diet) ? x.diet : "", fav: !!x.fav,
    rating: Math.max(0, Math.min(5, Math.round(Number(x.rating) || 0))), note: s(x.note).slice(0, 1000),
    source: /^https:\/\/[^\s<>"']+$/i.test(s(x.source)) ? s(x.source).slice(0, 300) : "",
    created: Number(x.created) || 0, updated: Number(x.updated) || 0,
  };
}

/** Menge für andere Portionen umrechnen (schön gerundet). */
export function scaleQty(qty, from, to) {
  if (qty == null) return null;
  const v = (qty * to) / (from || 1);
  return v >= 10 ? Math.round(v) : Math.round(v * 4) / 4 || Math.round(v * 100) / 100;
}
export function fmtQty(q) {
  if (q == null) return "";
  const f = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
  const whole = Math.floor(q), rest = Math.round((q - whole) * 100) / 100;
  if (f[rest]) return (whole ? whole : "") + f[rest];
  return String(Math.round(q * 100) / 100).replace(".", ",");
}
export const ingText = (i, from, to) => [fmtQty(scaleQty(i.qty, from, to)), i.unit, i.name].filter(Boolean).join(" ");

/** Zeiten in Schritten finden („10 Minuten köcheln“, „1 Std.“, „45 min“) → Sekunden für den Koch-Timer. */
export function stepTimers(step) {
  const out = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(?:–|-|bis)?\s*(\d+)?\s*(stunden?|std\.?|h\b|minuten|min\.?|sekunden|sek\.?)/gi;
  let m;
  while ((m = re.exec(s(step)))) {
    const v = Number((m[2] || m[1]).replace(",", "."));
    const u = m[3].toLowerCase();
    const sec = /^(stunde|std|h)/.test(u) ? v * 3600 : /^sek/.test(u) ? v : v * 60;
    if (sec > 0 && sec <= 24 * 3600) out.push({ sec: Math.round(sec), label: m[0].trim() });
  }
  return out;
}
export const fmtTimer = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`; };

/** Rezept aus eingefügtem Text (Rezeptimport): Titel = erste Zeile, Abschnitte „Zutaten“ / „Zubereitung“. */
export function parseRecipeText(text) {
  const lines = s(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const r = { title: lines[0].replace(/^#+\s*/, "").slice(0, 100), ingredients: [], steps: [], servings: 2, minutes: 0 };
  let mode = "";
  for (const l of lines.slice(1)) {
    if (/^(zutaten|ingredients)\b/i.test(l)) { mode = "z"; const sv = /(\d+)\s*(portion|person)/i.exec(l); if (sv) r.servings = +sv[1]; continue; }
    if (/^(zubereitung|anleitung|so geht'?s|schritte|instructions)\b/i.test(l)) { mode = "s"; continue; }
    const sv = /für\s+(\d+)\s*(portion|person)/i.exec(l) || /^(\d+)\s*(portionen|personen)$/i.exec(l);
    if (sv) { r.servings = +sv[1]; continue; }
    const mi = /(\d+)\s*(min|minuten)\b/i.exec(l);
    if (!mode && mi && l.length < 40) { r.minutes = +mi[1]; continue; }
    if (mode === "z" || (!mode && /^[-•*·]?\s*\d/.test(l))) r.ingredients.push(parseIngredient(l));
    else if (mode === "s") r.steps.push(l.replace(/^\d+[.)]\s*/, ""));
    else r.steps.push(l.replace(/^\d+[.)]\s*/, ""));
  }
  return normRecipe(r);
}

const norm = (t) => s(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ß ]/g, " ").replace(/\s+/g, " ").trim();
const BASICS = new Set(["salz", "pfeffer", "wasser", "ol", "zucker", "olivenol", "rapsol", "sonnenblumenol"]);
/** Passt ein Zutaten-Name zu einem Vorrats-Namen? (Wortanfang, Einzahl/Mehrzahl grob) */
export function sameFood(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const wx = x.split(" "), wy = y.split(" ");
  return wx.some((p) => p.length >= 4 && wy.some((q) => q.length >= 4 && (p.startsWith(q.slice(0, -1)) || q.startsWith(p.slice(0, -1)))));
}
const isBasic = (name) => BASICS.has(norm(name));

/** Rezeptvorschläge aus dem Vorrat: Anteil vorhandener Zutaten (Salz, Pfeffer, Öl, Wasser zählen als da). */
export function suggestFromStock(recipes, stock, { min = 0.5, limit = 8 } = {}) {
  const have = (stock || []).filter((x) => x && s(x.name) && Number(x.qty) > 0).map((x) => s(x.name));
  return (recipes || []).map(normRecipe).filter((r) => r.id && r.ingredients.length)
    .map((r) => {
      const miss = r.ingredients.filter((i) => !isBasic(i.name) && !have.some((h) => sameFood(i.name, h)));
      return { recipe: r, score: 1 - miss.length / r.ingredients.length, missing: miss.map((i) => i.name) };
    })
    .filter((x) => x.score >= min).sort((a, b) => b.score - a.score || b.recipe.rating - a.recipe.rating).slice(0, limit);
}

export function normDay(x = {}) {
  const meals = {};
  for (const [m] of MEALS) {
    const v = x.meals && x.meals[m];
    if (!v) continue;
    const sv = Math.round(Number(v.servings));
    const e = { recipeId: s(v.recipeId), text: s(v.text).slice(0, 100), servings: sv >= 1 && sv <= 50 ? sv : 0 };
    if (e.recipeId || e.text) meals[m] = e;
  }
  return { id: isKey(x.id) ? x.id : "", meals };
}

/** Einkaufsliste aus dem Essensplan [from, to]: Zutaten zusammenzählen (gleicher Name + Einheit), Vorrat abziehen. */
export function shoppingFromPlan(days, recipes, from, to, stock = []) {
  const byId = new Map((recipes || []).map(normRecipe).filter((r) => r.id).map((r) => [r.id, r]));
  const sum = new Map();
  for (const d of (days || []).map(normDay)) {
    if (!d.id || d.id < from || d.id > to) continue;
    for (const meal of Object.values(d.meals)) {
      const r = byId.get(meal.recipeId);
      if (!r) continue;
      const sv = meal.servings || r.servings;
      for (const i of r.ingredients) {
        if (isBasic(i.name)) continue;
        const k = norm(i.name) + "|" + i.unit;
        const cur = sum.get(k) || { name: i.name, unit: i.unit, qty: 0, any: false, recipes: new Set() };
        if (i.qty != null) { cur.qty += scaleQty(i.qty, r.servings, sv); cur.any = true; }
        cur.recipes.add(r.title);
        sum.set(k, cur);
      }
    }
  }
  const have = (stock || []).filter((x) => x && Number(x.qty) > 0);
  return [...sum.values()].map((x) => {
    const st = have.find((h) => sameFood(x.name, h.name) && (s(h.unit) === x.unit || (!x.unit && s(h.unit) === "Stk")));
    const rest = x.any ? Math.max(0, Math.round((x.qty - (st ? Number(st.qty) : 0)) * 100) / 100) : null;
    return { name: x.name, unit: x.unit, qty: x.any ? rest : null, inStock: !!have.find((h) => sameFood(x.name, h.name)), recipes: [...x.recipes] };
  }).filter((x) => x.qty == null ? !x.inStock : x.qty > 0).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** Einheit für die Einkaufsliste (die kennt weniger Einheiten). */
export function shopUnit(u) { return { g: "g", kg: "kg", ml: "ml", l: "l", Stk: "Stk", Pkg: "Pkg" }[u] || "Stk"; }

/** Filter fürs Rezeptbuch. */
export function filterRecipes(arr, { q = "", cat = "", diet = "", noAllergens = [], fav = false } = {}) {
  const n = norm(q);
  return arr.map(normRecipe).filter((r) => r.id && r.title)
    .filter((r) => (!cat || r.cat === cat) && (!fav || r.fav) && (!diet || r.diet === diet || (diet === "vegetarisch" && r.diet === "vegan")))
    .filter((r) => !noAllergens.some((a) => r.allergens.includes(a)))
    .filter((r) => !n || norm([r.title, r.tags.join(" "), r.ingredients.map((i) => i.name).join(" "), r.note].join(" ")).includes(n))
    .sort((a, b) => Number(b.fav) - Number(a.fav) || b.rating - a.rating || a.title.localeCompare(b.title, "de"));
}

export function shareText(r, servings) {
  const sv = servings || r.servings;
  return [`${r.emoji} ${r.title}`, `Für ${sv} ${sv === 1 ? "Portion" : "Portionen"}${r.minutes ? ` · ${r.minutes} min` : ""}`, "", "Zutaten:",
    ...r.ingredients.map((i) => "• " + ingText(i, r.servings, sv)), "", "Zubereitung:", ...r.steps.map((t, i) => `${i + 1}. ${t}`)].join("\n").trim();
}
export const recipeHash = (id) => `#alltag/kochen${id ? "/" + encodeURIComponent(id) : ""}`;
