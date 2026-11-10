// Update 11 – 🔄 Konflikt-Erkennung beim Synchronisieren (reine Logik, kein DOM/Firebase).
//
// Problem: Firestore nimmt bei gleichzeitigen Offline-Änderungen einfach die zuletzt hochgeladene („last write wins“).
// Lösung: Jede Änderung trägt zwei Zusatzfelder:
//   _dev  – Kennung des Geräts, das geschrieben hat
//   _base – `updated` der Version, die dieses Gerät beim Bearbeiten kannte (0 = neu angelegt)
// Jedes Gerät merkt sich seine eigenen letzten Änderungen (mine: key → { u, doc }). Kommt später eine Fremd-Version
// an, deren _base ÄLTER ist als meine Änderung, hat das andere Gerät meine Änderung nie gesehen und sie überschrieben
// → Konflikt. Meine Version wird aufbewahrt und kann mit einem Tipp wiederhergestellt werden.

export const MAX_MINE = 150;      // so viele eigene Änderungen merken
export const MAX_CONFLICTS = 30;  // so viele offene Konflikte aufheben
export const MINE_DAYS = 30;      // eigene Änderungen älter als das vergessen

const n = (v) => Number(v) || 0;
export const keyOf = (col, id) => `${col}/${id}`;

/** Zusatzfelder für eine Änderung. known = Version, die das Gerät gerade kennt (oder null). */
export function stamp(doc, known, dev, now) {
  return { ...doc, updated: n(doc.updated) || now, _dev: dev, _base: known ? n(known.updated) : 0 };
}

/** Eigene Änderung merken (neues mine-Objekt). Große Dokumente werden ohne Inhalt gemerkt (nur Erkennung). */
export function remember(mine, col, doc, now, maxBytes = 20000) {
  const out = { ...mine };
  let copy = null;
  try { const j = JSON.stringify(doc); copy = j.length <= maxBytes ? JSON.parse(j) : null; } catch { copy = null; }
  out[keyOf(col, doc.id)] = { u: n(doc.updated), at: now, doc: copy };
  return prune(out, now);
}

export function prune(mine, now) {
  const minAt = now - MINE_DAYS * 864e5;
  const arr = Object.entries(mine || {}).filter(([, v]) => v && n(v.at) >= minAt).sort((a, b) => n(b[1].at) - n(a[1].at)).slice(0, MAX_MINE);
  return Object.fromEntries(arr);
}

/**
 * Eingehende (vom Server bestätigte) Version prüfen.
 * → { mine, conflict|null }: conflict = { key, col, id, mine: meine Version, theirs: neue Version, at }
 */
export function check(mine, col, doc, dev, now) {
  if (!doc || !doc.id) return { mine, conflict: null };
  const key = keyOf(col, doc.id);
  const my = mine && mine[key];
  if (!my) return { mine, conflict: null };
  if (doc._dev === dev || n(doc.updated) === my.u) return { mine, conflict: null }; // meine eigene Version
  const next = { ...mine };
  delete next[key]; // so oder so erledigt
  if (!doc._dev || !("_base" in doc)) return { mine: next, conflict: null }; // alte App-Version ohne Kennung → nicht beurteilbar
  if (n(doc._base) >= my.u) return { mine: next, conflict: null };          // das andere Gerät kannte meine Änderung
  return { mine: next, conflict: { key, col, id: doc.id, mine: my.doc, theirs: strip(doc), at: now } };
}

/** Konfliktliste ergänzen (gleicher Schlüssel → ersetzen, neueste zuerst, begrenzt). */
export function addConflict(list, c) {
  if (!c) return list || [];
  return [c, ...(list || []).filter((x) => x.key !== c.key)].slice(0, MAX_CONFLICTS);
}

export function strip(doc) { const { _dev, _base, ...rest } = doc || {}; return rest; }

/** Kurzer Name für die Anzeige. */
export function label(doc) {
  const d = doc || {};
  for (const k of ["title", "name", "label", "text", "note", "place"]) if (typeof d[k] === "string" && d[k].trim()) return d[k].trim().slice(0, 60);
  if (Number.isFinite(Number(d.start))) { const t = new Date(Number(d.start)); return `Eintrag ${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}. ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`; }
  return "Eintrag";
}

/** Welche sichtbaren Felder sich unterscheiden (für die Anzeige „was ist anders“). */
export function diffFields(a, b) {
  const skip = new Set(["id", "updated", "created", "_dev", "_base", "history"]);
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].filter((k) => !skip.has(k) && JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k])).sort();
}

const COL_NAMES = { entries: "Arbeitszeit", todos: "Aufgaben & Termine", places: "Orte" };
export function colName(col) {
  if (COL_NAMES[col]) return COL_NAMES[col];
  return col.replace(/^a:/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
