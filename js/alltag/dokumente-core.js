// Update 10 E – 📁 Dokumente: reine Logik ohne DOM (Node-testbar).
// Metadaten in der Sammlung „dokumente“ (users/{uid}/a_dokumente), Dateiinhalt getrennt in Stücken (js/alltag/doc-files.js,
// Cloud a_doc_files – NICHT im Backup, wie die Schul-Dateien). Unverschlüsselt – Geheimes gehört in den 🔐 Tresor.
//
// Felder: title, folder (Ordner-ID oder eigener Name), tags [], fav, type (MIME), size, name (Dateiname), chunks, thumb (kleines JPEG),
//   date (JJJJ-MM-TT), expires (Ablaufdatum), remindDays (Vorlauf, Standard 30), remind (Standard an),
//   links: [{ k: "place"|"tx"|"todo"|"vertrag"|"inventar"|"kontakt", id }], ocr (bestätigter erkannter Text), notes
import { isKey, daysBetween, fmtDate } from "./money-core.js";

export const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB pro Datei (nach dem Verkleinern)
export const CHUNK_CHARS = 700000;           // base64-Zeichen pro Firestore-Stück (< 1 MiB)
export const FOLDERS = [
  { id: "rechnungen", e: "🧾", label: "Rechnungen" },
  { id: "vertraege", e: "📜", label: "Verträge" },
  { id: "garantie", e: "🛡️", label: "Garantie" },
  { id: "schule", e: "🎒", label: "Schule" },
  { id: "arbeit", e: "👷", label: "Arbeit" },
  { id: "sonstiges", e: "📂", label: "Sonstiges" },
];
export const LINK_KINDS = {
  place: { e: "🏗️", label: "Baustelle" },
  tx: { e: "💶", label: "Buchung" },
  todo: { e: "✅", label: "Aufgabe" },
  vertrag: { e: "📜", label: "Vertrag" },
  inventar: { e: "📦", label: "Inventar" },
  kontakt: { e: "👤", label: "Kontakt" },
};
export const DEFAULT_REMIND_DAYS = 30;
const s = (v) => String(v ?? "").trim();

export const folderOf = (id) => FOLDERS.find((f) => f.id === id) || (s(id) ? { id: s(id), e: "🗂️", label: s(id), own: true } : FOLDERS[FOLDERS.length - 1]);

export function cleanTags(v) {
  const arr = Array.isArray(v) ? v : String(v || "").split(/[,;#]+/);
  const out = [];
  for (const t of arr) {
    const x = s(t).replace(/^#/, "").replace(/\s+/g, " ").slice(0, 30);
    if (x && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  }
  return out.slice(0, 12);
}
export function cleanLinks(v) {
  const out = [];
  for (const l of Array.isArray(v) ? v : []) {
    if (!l || !LINK_KINDS[l.k] || !s(l.id)) continue;
    if (!out.some((o) => o.k === l.k && o.id === s(l.id))) out.push({ k: l.k, id: s(l.id).slice(0, 200) });
  }
  return out.slice(0, 30);
}

export function normDoc(x) {
  const d = x && typeof x === "object" ? x : {};
  return {
    id: s(d.id), title: s(d.title).slice(0, 140) || s(d.name).slice(0, 140) || "Dokument",
    folder: s(d.folder) || "sonstiges", tags: cleanTags(d.tags), fav: !!d.fav,
    type: s(d.type) || "application/octet-stream", size: Number(d.size) || 0, name: s(d.name).slice(0, 200),
    chunks: Math.max(0, Math.round(Number(d.chunks) || 0)), thumb: typeof d.thumb === "string" && d.thumb.startsWith("data:image/") ? d.thumb : "",
    date: isKey(d.date) ? d.date : "", expires: isKey(d.expires) ? d.expires : "",
    remind: d.remind !== false, remindDays: Math.max(1, Math.min(365, Math.round(Number(d.remindDays) || DEFAULT_REMIND_DAYS))),
    links: cleanLinks(d.links), ocr: s(d.ocr).slice(0, 20000), notes: s(d.notes).slice(0, 4000),
    created: Number(d.created) || 0, updated: Number(d.updated) || 0,
  };
}

export const isImage = (d) => /^image\//.test(d.type || "");
export const isPdf = (d) => d.type === "application/pdf";
export const kindIcon = (d) => (isPdf(d) ? "📄" : isImage(d) ? "🖼️" : /word|document/.test(d.type || "") ? "📝" : /sheet|excel/.test(d.type || "") ? "📊" : "📎");
export const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round((Number(n) || 0) / 1024))} kB`);

/** Ablauf-Status → { state: "none"|"ok"|"bald"|"ab", days, label } */
export function expiryStatus(raw, today) {
  const d = raw && raw.links ? raw : normDoc(raw);
  if (!d.expires) return { state: "none", days: null, label: "" };
  const days = daysBetween(today, d.expires);
  if (days < 0) return { state: "ab", days, label: `abgelaufen seit ${fmtDate(d.expires)}` };
  if (days <= d.remindDays) return { state: "bald", days, label: days === 0 ? "läuft heute ab" : days === 1 ? "läuft morgen ab" : `läuft in ${days} Tagen ab` };
  return { state: "ok", days, label: `gültig bis ${fmtDate(d.expires)}` };
}

/** Bald (innerhalb remindDays) oder seit höchstens 7 Tagen abgelaufene Dokumente – für die Benachrichtigungen. */
export function dueDocs(list, today) {
  return (list || []).map(normDoc).filter((d) => d.id && d.remind && d.expires)
    .map((d) => ({ d, x: expiryStatus(d, today) }))
    .filter(({ x }) => x.state === "bald" || (x.state === "ab" && x.days >= -7))
    .sort((a, b) => a.x.days - b.x.days)
    .map(({ d, x }) => ({ id: d.id, title: d.title, expires: d.expires, days: x.days, state: x.state, text: `${folderOf(d.folder).e} ${d.title} ${x.label}`, hash: docHash(d.id) }));
}

/** Ordner mit Anzahl (feste zuerst, dann eigene alphabetisch). */
export function folderCounts(list) {
  const m = new Map(FOLDERS.map((f) => [f.id, 0]));
  for (const raw of list || []) { const f = normDoc(raw).folder; m.set(f, (m.get(f) || 0) + 1); }
  const own = [...m.keys()].filter((k) => !FOLDERS.some((f) => f.id === k)).sort((a, b) => a.localeCompare(b, "de"));
  return [...FOLDERS.map((f) => ({ ...f, n: m.get(f.id) || 0 })), ...own.map((k) => ({ ...folderOf(k), n: m.get(k) }))];
}
export function allTags(list) {
  const m = new Map();
  for (const raw of list || []) for (const t of normDoc(raw).tags) m.set(t.toLowerCase(), { t, n: ((m.get(t.toLowerCase()) || {}).n || 0) + 1 });
  return [...m.values()].sort((a, b) => b.n - a.n || a.t.localeCompare(b.t, "de")).map((x) => x.t);
}

export function searchText(raw) {
  const d = normDoc(raw);
  return [d.title, d.name, folderOf(d.folder).label, d.tags.join(" "), d.notes, d.ocr].join(" ");
}

/** Liste filtern: { q, folder, tag, fav, view: "alle"|"ablauf" } – Favoriten zuerst, dann neueste. */
export function filterDocs(list, { q = "", folder = "", tag = "", fav = false, view = "alle" } = {}, today = "") {
  const f = s(q).toLowerCase();
  return (list || []).map(normDoc).filter((d) => d.id)
    .filter((d) => !folder || d.folder === folder)
    .filter((d) => !tag || d.tags.some((t) => t.toLowerCase() === tag.toLowerCase()))
    .filter((d) => !fav || d.fav)
    .filter((d) => view !== "ablauf" || (d.expires && ["bald", "ab"].includes(expiryStatus(d, today).state)))
    .filter((d) => !f || searchText(d).toLowerCase().includes(f))
    .sort((a, b) => (b.fav - a.fav) || (b.date > a.date ? 1 : b.date < a.date ? -1 : 0) || (b.created - a.created));
}

/** Dokumente, die mit {k, id} verknüpft sind. */
export const linkedTo = (list, k, id) => (list || []).map(normDoc).filter((d) => d.id && d.links.some((l) => l.k === k && l.id === String(id)));

/** OCR-Antwort aufräumen (Markdown-Zäune weg, Länge begrenzen). */
export function cleanOcr(text) {
  let t = String(text || "").replace(/\r/g, "");
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
  if (/^\s*\(?\s*kein(en)? (lesbarer )?text/i.test(t)) return "";
  return t.trim().slice(0, 20000);
}

/** base64-Text in Stücke für Firestore teilen. */
export function splitChunks(b64, size = CHUNK_CHARS) {
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out.length ? out : [""];
}

export const docHash = (id) => `#alltag/dokumente/${encodeURIComponent(s(id))}`;
export function routeId(hash) {
  const m = /#?alltag\/dokumente\/([^?/]+)/.exec(String(hash || ""));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
