// Update 10 – 🧠 Notizbuch & KI-Gedächtnis: reine Logik ohne DOM (Node-testbar, test/notes-core.test.mjs).
// Sammlungen: notes { id, title, text, tags: [], fav, pinned, coll (Sammlung/Ordner), created, updated }
//             ai_memory { id, text, area, allowed (Claude darf lesen), created, updated }
// Markdown-light: **fett**, *kursiv*, # Überschrift, - Liste, 1. Liste, [Text](https://…), nackte https-Links, [[Titel]] → Notiz-Link.
// Alles wird zuerst als Text behandelt und escaped – es entsteht nie fremdes HTML, Links nur mit https.
// Wird auch vom Server (tools/mcp/src/memory.js) verwendet.

const s = (v) => (v == null ? "" : String(v).trim());

export function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Klein, ohne Akzente, ß→ss (für Suche und Titel-Vergleich). */
export function fold(t) {
  return String(t ?? "").toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/* ---------------- Notizen ---------------- */

export function parseTags(v) {
  const arr = Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]+/);
  const out = [];
  for (const t of arr) {
    const x = s(t).replace(/^#+/, "").replace(/\s+/g, "-").slice(0, 30);
    if (x && !out.some((o) => fold(o) === fold(x))) out.push(x);
  }
  return out.slice(0, 12);
}

export function normNote(x = {}) {
  return { ...x, id: s(x.id), title: s(x.title).slice(0, 120), text: String(x.text ?? "").slice(0, 20000), tags: parseTags(x.tags),
    fav: !!x.fav, pinned: !!x.pinned, coll: s(x.coll).slice(0, 40), created: Number(x.created) || 0, updated: Number(x.updated) || 0 };
}

/** Titel einer Notiz (Fallback: erste Zeile). */
export function noteTitle(n) {
  const x = normNote(n);
  return x.title || s(x.text.split("\n")[0]).replace(/^#+\s*/, "").slice(0, 60) || "Ohne Titel";
}

/** [[Titel]]-Verweise im Text (in Reihenfolge, ohne Doppelte). */
export function linksIn(text) {
  const out = [];
  const re = /\[\[([^\[\]\n]{1,120})\]\]/g;
  let m;
  while ((m = re.exec(String(text ?? "")))) { const t = s(m[1]); if (t && !out.some((o) => fold(o) === fold(t))) out.push(t); }
  return out;
}

/** Notiz zu einem Titel (unabhängig von Groß/Klein und Akzenten). */
export function findByTitle(notes, title) {
  const f = fold(title);
  return (notes || []).map(normNote).find((n) => n.id && fold(noteTitle(n)) === f) || null;
}

/** Rückverweise: Notizen, die per [[…]] auf diese Notiz zeigen. */
export function backlinks(notes, note) {
  const f = fold(noteTitle(note));
  return (notes || []).map(normNote).filter((n) => n.id && n.id !== note.id && linksIn(n.text).some((t) => fold(t) === f));
}

const SAFE_URL = /^https:\/\/[^\s<>"'`]+$/i;
/** Nur https-Adressen, ohne Satzzeichen am Ende. */
export function safeUrl(u) {
  const t = s(u).replace(/[.,;:!?)\]]+$/, "");
  return SAFE_URL.test(t) ? t : null;
}

/**
 * Inline-Formatierung eines rohen Textstücks → sicheres HTML.
 * opts.resolve(title) → id|null (für [[Titel]])
 */
export function inline(raw, opts = {}) {
  const src = String(raw ?? "");
  const re = /\[\[([^\[\]\n]{1,120})\]\]|\[([^\[\]\n]{1,200})\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<>"'`]+)|\*\*([^*\n]+)\*\*|(?<![\w*])\*([^*\n]+)\*(?![\w*])/g;
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1] != null) {
      const t = s(m[1]);
      const id = opts.resolve ? opts.resolve(t) : null;
      out += id ? `<a href="#" class="nb-wl" data-note="${esc(id)}">${esc(t)}</a>`
        : `<a href="#" class="nb-wl nb-wl-new" data-newnote="${esc(t)}" title="Noch keine Notiz – antippen zum Anlegen">${esc(t)}</a>`;
    } else if (m[2] != null) {
      const u = safeUrl(m[3]);
      out += u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(m[2])}</a>` : esc(m[0]);
    } else if (m[4] != null) {
      const u = safeUrl(m[4]);
      if (u) {
        out += `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u)}</a>` + esc(m[4].slice(u.length));
      } else out += esc(m[4]);
    } else if (m[5] != null) out += `<strong>${inline(m[5], opts)}</strong>`;
    else if (m[6] != null) out += `<em>${esc(m[6])}</em>`;
  }
  return out + esc(src.slice(last));
}

/** Markdown-light → sicheres HTML (Absätze, Überschriften, Listen, Checkboxen als Zeichen). */
export function render(text, opts = {}) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let list = null; // "ul" | "ol"
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(l, opts)).join("<br>")}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const t = line.trimEnd();
    let m;
    if (!t.trim()) { flushPara(); closeList(); continue; }
    if ((m = /^\s*(#{1,3})\s+(.+)$/.exec(t))) {
      flushPara(); closeList();
      const lv = Math.min(3 + m[1].length - 1, 5);
      out.push(`<h${lv}>${inline(m[2], opts)}</h${lv}>`);
    } else if ((m = /^\s*[-*•]\s+(\[( |x|X)\]\s+)?(.*)$/.exec(t))) {
      flushPara();
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      const box = m[1] ? (m[2].toLowerCase() === "x" ? "☑️ " : "⬜ ") : "";
      out.push(`<li>${box}${inline(m[3], opts)}</li>`);
    } else if ((m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(t))) {
      flushPara();
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1], opts)}</li>`);
    } else if (/^\s*(-{3,}|_{3,})\s*$/.test(t)) {
      flushPara(); closeList(); out.push("<hr>");
    } else { closeList(); para.push(t); }
  }
  flushPara(); closeList();
  return out.join("");
}

/** Klartext ohne Formatierungszeichen (Vorschau, Suche). */
export function plain(text) {
  return String(text ?? "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*#{1,3}\s+/gm, "").replace(/^\s*[-*•]\s+(\[[ xX]\]\s+)?/gm, "").replace(/^\s*\d{1,3}[.)]\s+/gm, "")
    .replace(/\s+/g, " ").trim();
}
export function excerpt(text, n = 140) { const p = plain(text); return p.length > n ? p.slice(0, n - 1) + "…" : p; }

/** Volltextsuche: alle Wörter müssen vorkommen (Titel, Text, Schlagworte, Sammlung). Titel-Treffer zuerst. */
export function searchNotes(notes, q) {
  const words = fold(q).split(/\s+/).map((w) => w.replace(/^#/, "")).filter(Boolean);
  const list = (notes || []).map(normNote).filter((n) => n.id);
  if (!words.length) return list;
  const scored = [];
  for (const n of list) {
    const title = fold(noteTitle(n));
    const hay = `${title} ${fold(plain(n.text))} ${n.tags.map(fold).join(" ")} ${fold(n.coll)}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const sc = words.reduce((a, w) => a + (title.includes(w) ? 3 : 0) + (n.tags.some((t) => fold(t) === w) ? 2 : 0), 0);
    scored.push({ n, sc });
  }
  return scored.sort((a, b) => b.sc - a.sc || b.n.updated - a.n.updated).map((x) => x.n);
}

/** Angepinnte zuerst, dann zuletzt geändert. */
export function sortNotes(notes) {
  return (notes || []).map(normNote).filter((n) => n.id).sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated) || noteTitle(a).localeCompare(noteTitle(b), "de"));
}

/** Filter: { view: "alle"|"fav"|"tag"|"coll", tag, coll } */
export function filterNotes(notes, { view = "alle", tag = "", coll = "" } = {}) {
  let list = sortNotes(notes);
  if (view === "fav") list = list.filter((n) => n.fav);
  if (tag) list = list.filter((n) => n.tags.some((t) => fold(t) === fold(tag)));
  if (coll) list = list.filter((n) => fold(n.coll) === fold(coll));
  return list;
}

/** Alle Schlagworte / Sammlungen mit Anzahl (häufigste zuerst). */
export function tagCounts(notes) {
  const m = new Map();
  for (const n of (notes || []).map(normNote)) for (const t of n.tags) { const k = fold(t); const c = m.get(k) || { tag: t, n: 0 }; c.n++; m.set(k, c); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "de"));
}
export function collections(notes) {
  const m = new Map();
  for (const n of (notes || []).map(normNote)) if (n.coll) { const k = fold(n.coll); const c = m.get(k) || { coll: n.coll, n: 0 }; c.n++; m.set(k, c); }
  return [...m.values()].sort((a, b) => a.coll.localeCompare(b.coll, "de"));
}

/** Route: "#alltag/notizen/<id>" → id, "#alltag/notizen" → "", sonst null. */
export function routeId(hash) {
  const h = s(hash).replace(/^#/, "").split("?")[0];
  if (h === "alltag/notizen") return "";
  const m = /^alltag\/notizen\/(.+)$/.exec(h);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
export const noteHash = (id) => `#alltag/notizen/${encodeURIComponent(id)}`;

/* ---------------- KI-Gedächtnis ---------------- */

export const AREAS = [
  { id: "allgemein", e: "💬", label: "Allgemein" },
  { id: "arbeit", e: "🔧", label: "Arbeit & Baustelle" },
  { id: "schule", e: "🎒", label: "Schule & Lernen" },
  { id: "privat", e: "🏡", label: "Privat & Familie" },
  { id: "vorlieben", e: "⭐", label: "Vorlieben" },
];
export const areaById = (id) => AREAS.find((a) => a.id === id) || AREAS[0];
export const MEMORY_MAX = 300;
export const MEMORY_LIMIT = 200;

function luhn(d) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return d.length >= 13 && sum % 10 === 0;
}
/** Sieht ein Text nach Geheimnis aus (Passwort, PIN, IBAN, Kartennummer, Schlüssel)? → Grund oder "" */
export function looksSecret(text) {
  const t = String(text ?? "");
  const f = fold(t);
  if (/\b(passwort|password|passwd|kennwort|pin|puk|tan|cvv|cvc|api[- ]?key|apikey|token|secret|geheimzahl|zugangsdaten|login[- ]?daten|pass ?code)\b/.test(f)) return "Passwörter, PINs, Schlüssel und Zugangsdaten gehören in den 🔐 Passwort-Tresor – nicht ins Gedächtnis.";
  if (/(AT|DE|CH|LI|IT)\d{2}[A-Z0-9]{12,30}/i.test(t.replace(/[\s-]+/g, ""))) return "Das sieht nach einer IBAN aus – Bankdaten speichere ich nicht im Gedächtnis.";
  for (const m of t.match(/\d(?:[ -]?\d){12,18}/g) || []) if (luhn(m.replace(/\D/g, ""))) return "Das sieht nach einer Kartennummer aus – solche Nummern speichere ich nicht im Gedächtnis.";
  return "";
}

export function normMemory(x = {}) {
  return { ...x, id: s(x.id), text: s(x.text).replace(/\s+/g, " ").slice(0, MEMORY_MAX), area: areaById(s(x.area)).id, allowed: x.allowed !== false,
    created: Number(x.created) || 0, updated: Number(x.updated) || 0 };
}

/** Gruppiert nach Bereich (in AREAS-Reihenfolge): [{ area, items, allowed: alle erlaubt? }] */
export function memoryGroups(items) {
  const list = (items || []).map(normMemory).filter((m) => m.id && m.text);
  return AREAS.map((a) => {
    const its = list.filter((m) => m.area === a.id).sort((x, y) => (y.updated || y.created) - (x.updated || x.created));
    return { area: a, items: its, allowed: its.length ? its.every((m) => m.allowed) : true };
  }).filter((g) => g.items.length);
}

/** Was Claude lesen darf (nur allowed). */
export const readable = (items) => (items || []).map(normMemory).filter((m) => m.id && m.text && m.allowed);

/** Fast gleicher Eintrag schon da? */
export function isDuplicate(items, text) {
  const f = fold(text);
  return (items || []).map(normMemory).some((m) => fold(m.text) === f);
}
