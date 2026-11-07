// Update 10 – 📸 Galerie-Extras: reine Logik ohne DOM (Node-testbar, test/gallery-extras.test.mjs).
// Favoriten (photo.fav), Schlagwörter (photo.tags), Duplikat-Erkennung und welches Foto bei Duplikaten bleibt.
// Duplikate: (a) gleiche Abmessungen + Aufnahmezeit auf ±2 s, oder (b) gleiche Abmessungen/Seitenverhältnis und fast gleicher
// Bild-Fingerabdruck (dHash 8×8 aus dem kleinen Vorschaubild, Hamming-Abstand ≤ HASH_MAX).

export const TAG_MAX = 24;
export const TAGS_MAX = 12;
export const HASH_MAX = 4;
export const TIME_EPS_MS = 2000;

const s = (v) => String(v ?? "").trim();
const fold = (t) => s(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

/** Ein Schlagwort säubern: ohne #, Leerzeichen zu einem, max. 24 Zeichen; leer → "". */
export function cleanTag(t) {
  return s(t).replace(/^#+/, "").replace(/[\s,;]+/g, " ").replace(/[<>"]/g, "").trim().slice(0, TAG_MAX);
}
/** Liste säubern (ohne Doppelte, Groß/klein egal, höchstens 12). */
export function cleanTags(list) {
  const out = [], seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    const t = cleanTag(x);
    const k = fold(t);
    if (!t || seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= TAGS_MAX) break;
  }
  return out;
}
/** Eingabe „Verteiler, #Keller  Bad“ → ["Verteiler", "Keller", "Bad"] (Komma/Raute trennt, sonst ein Wort-Tag je Leerzeichen-Block nur bei #). */
export function parseTagInput(text) {
  const raw = s(text);
  if (!raw) return [];
  const parts = raw.includes(",") || raw.includes(";") ? raw.split(/[,;]+/) : raw.includes("#") ? raw.split("#") : [raw];
  return cleanTags(parts);
}
export const addTags = (tags, more) => cleanTags([...(tags || []), ...(Array.isArray(more) ? more : [more])]);
export const removeTag = (tags, t) => cleanTags((tags || []).filter((x) => fold(x) !== fold(t)));
export const hasTag = (p, t) => (p && Array.isArray(p.tags) ? p.tags.some((x) => fold(x) === fold(t)) : false);

/** Alle Schlagwörter mit Anzahl, häufigste zuerst. */
export function allTags(items) {
  const m = new Map();
  for (const p of items || []) for (const t of cleanTags(p && p.tags)) {
    const k = fold(t);
    const cur = m.get(k) || { tag: t, n: 0 };
    cur.n++; m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "de"));
}

/** Filter: { fav: bool, tag: "" } */
export function filterExtras(items, f = {}) {
  let list = items || [];
  if (f.fav) list = list.filter((p) => p && p.fav === true);
  if (s(f.tag)) list = list.filter((p) => hasTag(p, f.tag));
  return list;
}

/* ---------- Fingerabdruck (dHash) ---------- */

/** Graustufen 9×8 (72 Werte, Zeile für Zeile) → 64-Bit-Hash als 16-stelliger Hex-Text. */
export function dHash(gray) {
  if (!gray || gray.length < 72) return "";
  let hex = "";
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}
/** RGBA-Pixel (9×8) → Graustufen. */
export function grayOf(rgba) {
  const out = new Array(72);
  for (let i = 0; i < 72; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return out;
}
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

const ratio = (p) => (p.w > 0 && p.h > 0 ? p.w / p.h : 0);
const sameDims = (a, b) => a.w > 0 && a.h > 0 && a.w === b.w && a.h === b.h;
const similarShape = (a, b) => sameDims(a, b) || (ratio(a) > 0 && Math.abs(ratio(a) - ratio(b)) < 0.02);

/**
 * Duplikat-Gruppen: [[foto, foto, …], …] (jede Gruppe ≥ 2, älteste zuerst). hashes = Map(id → dHash) (optional).
 * Zeitgleich: gleiche Abmessungen und Aufnahmezeit ±2 s. Ähnlich: ähnliche Form und dHash-Abstand ≤ HASH_MAX.
 */
export function findDuplicates(items, hashes = new Map()) {
  const list = (items || []).filter((p) => p && p.id).slice().sort((a, b) => (a.ts - b.ts) || a.id.localeCompare(b.id));
  const parent = new Map(list.map((p) => [p.id, p.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const ha = hashes.get(a.id) || "";
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dt = Math.abs((b.ts || 0) - (a.ts || 0));
      if (a.ts > 0 && dt <= TIME_EPS_MS && sameDims(a, b)) { union(a.id, b.id); continue; }
      const hb = hashes.get(b.id) || "";
      if (ha && hb && similarShape(a, b) && hamming(ha, hb) <= HASH_MAX) union(a.id, b.id);
    }
  }
  const groups = new Map();
  for (const p of list) { const r = find(p.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Welches Foto einer Gruppe bleibt? Favorit > mit Notiz > mit Schlagwörtern > mit Alben > ältestes. */
export function keepOf(group) {
  const score = (p) => (p.fav ? 8 : 0) + (s(p.note) ? 4 : 0) + ((p.tags || []).length ? 2 : 0) + ((p.albumIds || []).length ? 1 : 0);
  return [...group].sort((a, b) => score(b) - score(a) || (a.ts - b.ts) || a.id.localeCompare(b.id))[0];
}

/** Vorschlag zum Löschen: alle außer keepOf je Gruppe. */
export function deletionPlan(groups) {
  const out = [];
  for (const g of groups || []) { const k = keepOf(g); for (const p of g) if (p.id !== k.id) out.push(p.id); }
  return out;
}

/** Text fürs „🤖 Bild beschreiben“: Antwort säubern (kein Markdown-Fett, max. 500 Zeichen wie die Notiz). */
export function cleanDescription(reply) {
  return s(reply).replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 500);
}
