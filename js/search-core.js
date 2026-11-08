// Update 10 – 🔍 Universale Suche: reine Logik (ohne DOM) – Normalisierung, Datums-Erkennung, Treffer-Bewertung,
// Gruppierung, Hervorhebung und „Zuletzt gesucht“. Die Daten sammelt js/views/search.js (nur eigene Daten, nie der Tresor).
//
// Eintrag im Index: { id, cat, title, sub?, text?, dates?: ["JJJJ-MM-TT"], ts?, … }
//   title/sub werden angezeigt und hervorgehoben, text wird nur durchsucht.

/** Gruppen in Anzeige-Reihenfolge: [id, Emoji, Titel] */
export const GROUPS = Object.freeze([
  ["einstellungen", "⚙️", "Einstellungen"],
  ["eintraege", "🕒", "Einträge"],
  ["planer", "📅", "Planer"],
  ["orte", "📍", "Orte & Baustellen"],
  ["einkauf", "🛒", "Einkauf"],
  ["material", "🧰", "Material"],
  ["werkzeug", "🧰", "Werkzeug"], // Update 10 – Werkzeug-Register
  ["dokumente", "📁", "Dokumente"], // Update 10 E
  ["vertraege", "📜", "Verträge"], // Update 10 E
  ["inventar", "📦", "Inventar"], // Update 10 E
  ["kontakte", "👤", "Kunden & Kontakte"], // Update 10 E
  ["buchhaltung", "💼", "Buchhaltung"], // Update 10 – Belege & Rechnungen
  ["fotos", "📷", "Fotos & Alben"],
  ["fahrten", "🚗", "Fahrten"],
  ["fahrzeuge", "🚙", "Fahrzeuge"], // Update 10 – Fahrzeuge
  ["haushalt", "🏡", "Haushalt"], // Update 10 C
  ["routinen", "🎯", "Routinen & Ziele"], // Update 10 C
  ["notizen", "🧠", "Notizbuch"], // Update 10 C – Notizen + KI-Gedächtnis
  ["geld", "💶", "Geld & Abos"],
  ["schule", "🎒", "Schule"],
  ["unterwegs", "🧳", "Unterwegs"],
  ["lernen", "🃏", "Japanisch & LAP"],
  ["bericht", "📋", "Wochenbericht"],
  ["automationen", "⚡", "Automationen"], // Update 10
  ["wuensche", "💡", "App-Wünsche"], // Update 10 – 💡 App-Wünsche
]);
export const groupMeta = (id) => GROUPS.find((g) => g[0] === id) || [id, "🔎", id];

/**
 * Zeichenweise falten (klein, ohne Akzente, ß→ss) – mit Zuordnung zur Original-Position (für die Hervorhebung).
 * → { s: gefalteter Text, map: [Index im Original je gefaltetem Zeichen] }
 */
export function foldMap(text) {
  const src = String(text ?? "");
  let out = "";
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    let f = ch.toLowerCase();
    if (f === "ß") f = "ss";
    else f = f.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (let k = 0; k < f.length; k++) { out += f[k]; map.push(i); }
  }
  return { s: out, map };
}

export function fold(text) { return foldMap(text).s; }

/** Suchwörter (gefaltet); zusätzlich Umschreibung ae/oe/ue → a/o/u („Mueller“ findet „Müller“). */
export function tokens(q) {
  return [...new Set(fold(q).split(/[\s,;]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, ""))
    .map((t) => (parseDateToken(t) ? t : t.replace(/\.+$/, "")))
    .filter(Boolean))];
}
const alt = (t) => t.replace(/ae/g, "a").replace(/oe/g, "o").replace(/ue/g, "u");

/**
 * Datum im Suchtext erkennen: „12.11.“, „12.11“, „12.11.2026“, „12.11.26“, „2026-11-12“.
 * → { d, m, y|null } oder null
 */
export function parseDateToken(t) {
  const x = String(t || "").trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.?(\d{2}|\d{4})?$/.exec(x);
  if (m) {
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = m[3] ? +m[3] : null;
    if (y != null && y < 100) y += 2000;
    return { d, m: mo, y };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  if (m) return { d: +m[3], m: +m[2], y: +m[1] };
  return null;
}

export function dateMatches(dt, key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ""));
  if (!m || !dt) return false;
  return +m[3] === dt.d && +m[2] === dt.m && (dt.y == null || +m[1] === dt.y);
}

/** Bewertung eines Suchworts in einem gefalteten Feld: 100 ganzes Wort, 80 Wortanfang, 60 Feldanfang, 40 irgendwo. */
function scoreIn(field, t) {
  if (!field || !t) return 0;
  let idx = field.indexOf(t);
  if (idx < 0) {
    const a = alt(t);
    if (a === t) return 0;
    idx = field.indexOf(a);
    if (idx < 0) return 0;
    t = a;
  }
  let best = 0;
  while (idx >= 0) {
    const before = idx === 0 ? "" : field[idx - 1];
    const after = field[idx + t.length] || "";
    const wordStart = idx === 0 || !/[\p{L}\p{N}]/u.test(before);
    const wordEnd = !after || !/[\p{L}\p{N}]/u.test(after);
    const sc = wordStart && wordEnd ? 100 : idx === 0 ? 80 : wordStart ? 70 : 40;
    if (sc > best) best = sc;
    if (best === 100) break;
    idx = field.indexOf(t, idx + 1);
  }
  // sehr kurze Wörter nur am Wortanfang (sonst findet „e“ alles)
  if (t.length < 2 && best < 70) return 0;
  return best;
}

/**
 * Ein Eintrag gegen die Suche bewerten → Zahl (0 = kein Treffer). Alle Suchwörter müssen passen (UND).
 * Datumswörter passen auf item.dates; Titel zählt mehr als Untertitel/Text.
 */
export function scoreItem(item, toks, now = Date.now()) {
  if (!item || !toks.length) return 0;
  const ft = fold(item.title), fs = fold(item.sub), fx = fold(item.text);
  let total = 0;
  for (const t of toks) {
    const dt = parseDateToken(t);
    if (dt) {
      if ((item.dates || []).some((k) => dateMatches(dt, k))) { total += 90; continue; }
      if (!/\d{4}/.test(t) && fold([item.title, item.sub, item.text].join(" ")).includes(t)) { total += 40; continue; }
      return 0;
    }
    const a = scoreIn(ft, t), b = scoreIn(fs, t) * 0.7, c = scoreIn(fx, t) * 0.5;
    const sc = Math.max(a, b, c);
    if (!sc) return 0;
    total += sc;
  }
  let sc = total / toks.length;
  if (ft === toks.join(" ")) sc += 30; // genau der Titel
  if (item.boost) sc += item.boost;
  // Neueres leicht bevorzugen (bis +8, verblasst über ~1 Jahr)
  const ts = Number(item.ts) || 0;
  if (ts > 0) sc += Math.max(0, 8 - Math.abs(now - ts) / (45 * 86400000));
  return Math.round(sc * 10) / 10;
}

/**
 * Suche über den ganzen Index → [{ id, emoji, title, items: [{ item, score }], total, more }] in GROUPS-Reihenfolge.
 * perGroup = sichtbare Treffer je Gruppe; expanded = Set von Gruppen, die alles zeigen.
 */
export function search(index, q, { perGroup = 4, expanded = null, now = Date.now(), max = 200 } = {}) {
  const toks = tokens(q);
  if (!toks.length) return [];
  const byGroup = new Map();
  for (const it of index || []) {
    const sc = scoreItem(it, toks, now);
    if (!sc) continue;
    if (!byGroup.has(it.cat)) byGroup.set(it.cat, []);
    byGroup.get(it.cat).push({ item: it, score: sc });
  }
  const order = GROUPS.map((g) => g[0]);
  const ids = [...byGroup.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return ids.map((id) => {
    const all = byGroup.get(id).sort((a, b) => b.score - a.score || (Number(b.item.ts) || 0) - (Number(a.item.ts) || 0) || String(a.item.title).localeCompare(String(b.item.title), "de"));
    const [, emoji, title] = groupMeta(id);
    const n = expanded && expanded.has(id) ? Math.min(all.length, max) : perGroup;
    return { id, emoji, title, items: all.slice(0, n), total: all.length, more: Math.max(0, all.length - n) };
  });
}

/** Beste Gruppe zuerst? Nein – feste Reihenfolge ist ruhiger. Gesamtzahl der Treffer: */
export function totalHits(groups) { return (groups || []).reduce((n, g) => n + g.total, 0); }

/**
 * Hervorhebung: Bereiche [start, end) im Original-Text, wo Suchwörter vorkommen (zusammengeführt).
 */
export function highlightRanges(text, q) {
  const src = String(text ?? "");
  if (!src) return [];
  const { s, map } = foldMap(src);
  const ranges = [];
  for (const t0 of tokens(q)) {
    if (parseDateToken(t0) && !/\./.test(src)) continue;
    for (const t of new Set([t0, alt(t0)])) {
      if (t.length < 1) continue;
      let i = s.indexOf(t);
      while (i >= 0) {
        const a = map[i], b = map[i + t.length - 1] + 1;
        ranges.push([a, b]);
        i = s.indexOf(t, i + t.length);
      }
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Text in Stücke teilen → [{ t, hit }] (die Oberfläche maskiert und setzt <mark>). */
export function highlightParts(text, q) {
  const src = String(text ?? "");
  const parts = [];
  let pos = 0;
  for (const [a, b] of highlightRanges(src, q)) {
    if (a > pos) parts.push({ t: src.slice(pos, a), hit: false });
    parts.push({ t: src.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < src.length) parts.push({ t: src.slice(pos), hit: false });
  return parts;
}

/** Ausschnitt rund um den ersten Treffer (für lange Notizen). */
export function snippet(text, q, len = 90) {
  const src = String(text ?? "").replace(/\s+/g, " ").trim();
  if (src.length <= len) return src;
  const r = highlightRanges(src, q)[0];
  if (!r) return src.slice(0, len - 1) + "…";
  const start = Math.max(0, Math.min(r[0] - Math.floor(len / 3), src.length - len));
  return (start > 0 ? "…" : "") + src.slice(start, start + len).trim() + (start + len < src.length ? "…" : "");
}

/** „Zuletzt gesucht“: neuester Begriff vorne, ohne Doppelte (gefaltet verglichen), höchstens max. */
export function pushRecent(list, q, max = 8) {
  const t = String(q || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const arr = Array.isArray(list) ? list.filter((x) => typeof x === "string" && x.trim()) : [];
  if (fold(t).length < 2) return arr.slice(0, max);
  return [t, ...arr.filter((x) => fold(x) !== fold(t))].slice(0, max);
}

/** Datum „JJJJ-MM-TT“ → „TT.MM.JJJJ“ */
export function fmtKey(k) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(k || ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}
