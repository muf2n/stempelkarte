// Update 10 – 💡 App-Wünsche: reine Logik ohne DOM (Node-testbar, auch vom Worker in tools/mcp benutzt).
// Sammlung „app_wishes“ (Cloud users/{uid}/a_app_wishes, lokal sk-a-app_wishes):
//   { id, text, area?, prio: "normal"|"wichtig", status: "offen"|"umgesetzt"|"verworfen", created, updated, source: "app"|"assistent" }
// Idee: Änderungswünsche an der App sammeln (in der App oder per Claude-Assistent) – umgesetzt werden sie später mit Claude Code.
export const TEXT_MAX = 500;
export const AREA_MAX = 40;
export const PRIOS = [{ id: "normal", e: "💡", label: "Normal" }, { id: "wichtig", e: "❗", label: "Wichtig" }];
export const STATUS = [
  { id: "offen", e: "📝", label: "Offen" },
  { id: "umgesetzt", e: "✅", label: "Umgesetzt" },
  { id: "verworfen", e: "🗑️", label: "Verworfen" },
];
export const AREAS = ["Arbeitszeit", "Planer", "Alltag", "Geld", "Schule", "Dokumente", "Galerie", "Unterwegs", "Assistent", "Design", "Einstellungen", "Sonstiges"];
const s = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const statusById = (id) => STATUS.find((x) => x.id === id) || STATUS[0];
export const prioById = (id) => PRIOS.find((x) => x.id === id) || PRIOS[0];

export function normWish(x) {
  const w = x && typeof x === "object" ? x : {};
  return {
    id: String(w.id || ""),
    text: s(w.text).slice(0, TEXT_MAX),
    area: s(w.area).slice(0, AREA_MAX),
    prio: w.prio === "wichtig" ? "wichtig" : "normal",
    status: STATUS.some((x) => x.id === w.status) ? w.status : "offen",
    created: Number(w.created) || 0,
    updated: Number(w.updated) || Number(w.created) || 0,
    source: w.source === "assistent" ? "assistent" : "app",
  };
}

/** Prüfen + aufräumen → { ok, wish?, error? } */
export function validate(x) {
  const w = normWish(x);
  if (!w.text) return { ok: false, error: "Bitte beschreib kurz, was sich an der App ändern soll." };
  if (s(x && x.text).length > TEXT_MAX) return { ok: false, error: `Bitte kürzer fassen (höchstens ${TEXT_MAX} Zeichen).` };
  return { ok: true, wish: w };
}

const fold = (t) => s(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Schon ein offener Wunsch mit (fast) gleichem Text? */
export const isDuplicate = (list, text) => (list || []).map(normWish).some((w) => w.status === "offen" && fold(w.text) === fold(text));

/** Sortiert: offen vor erledigt, wichtig zuerst, dann neueste. Filter: "offen"|"umgesetzt"|"verworfen"|"alle". */
export function sortWishes(list, filter = "offen") {
  const rank = { offen: 0, umgesetzt: 1, verworfen: 2 };
  return (list || []).map(normWish).filter((w) => w.id && w.text)
    .filter((w) => filter === "alle" || w.status === filter)
    .sort((a, b) => (rank[a.status] - rank[b.status]) || ((b.prio === "wichtig") - (a.prio === "wichtig")) || (b.created - a.created));
}

export function counts(list) {
  const c = { offen: 0, umgesetzt: 0, verworfen: 0, alle: 0 };
  for (const w of (list || []).map(normWish)) if (w.id && w.text) { c[w.status]++; c.alle++; }
  return c;
}

/** Saubere Liste aller offenen Wünsche zum Einfügen in Claude Code. */
export function copyText(list) {
  const open = sortWishes(list, "offen");
  if (!open.length) return "";
  return [`Offene App-Wünsche für die Stempelkarte (${open.length}):`, "",
    ...open.map((w, i) => `${i + 1}. ${w.prio === "wichtig" ? "[WICHTIG] " : ""}${w.area ? `[${w.area}] ` : ""}${w.text}`)].join("\n");
}
