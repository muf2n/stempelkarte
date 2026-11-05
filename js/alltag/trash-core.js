// Papierkorb für Löschungen durch Claude – reine Logik ohne DOM (Browser UND Worker/node importierbar).
// Sammlung users/{uid}/a_trash/{id} = {
//   path:      Pfad relativ zu users/{uid}/, z. B. "entries/e1", "todos/t1", "places/p1", "a_money_tx/x"
//   data:      Dokument VOR der Löschung (ohne id)
//   op:        "delete" (ganzes Dokument gelöscht) | "exdate" (eine Termin-Wiederholung ausgelassen, Feld date)
//              | "items" (einzelne Packlisten-Einträge entfernt, Feld itemIds)
//   date?, itemIds?, type (z. B. "termin"), label (Anzeige), deletedAt (ms), by: "claude", batchId
//   photoIds? (nur Album: Fotos, die beim Löschen aus dem Album genommen wurden – die Fotos selbst bleiben)
// }
// Wiederherstellen (restoreDoc) ändert möglichst wenig am aktuellen Stand: Ausnahme wieder entfernen,
// fehlende Packlisten-Einträge wieder einfügen, gelöschte Dokumente neu anlegen.

export const TRASH_DAYS = 30;
export const TRASH_MS = TRASH_DAYS * 86400000;

/** Sammlungen, die Claude löschen darf (relativ zu users/{uid}/). Tresor, Fotos, Einstellungen NIE. */
export const DELETABLE = ["entries", "todos", "places", "a_material_items", "a_money_tx", "a_money_subs",
  "a_school_tasks", "a_school_exams", "a_school_grades", "a_travel_packing", "a_photo_albums"];

/** "entries/e1" → {coll:"entries", id:"e1"} oder null (nur genau zwei Teile, erlaubte Sammlung). */
export function splitPath(path) {
  const parts = String(path || "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!DELETABLE.includes(parts[0])) return null;
  return { coll: parts[0], id: parts[1] };
}

export function isExpired(t, now) {
  return !(Number(t && t.deletedAt) > now - TRASH_MS);
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/**
 * Was beim Wiederherstellen geschrieben wird. cur = aktuelles Dokument (ohne id) oder null.
 * → {data} (komplett setzen) | {skip: "Grund"}
 */
export function restoreDoc(t, cur) {
  if (!t || !splitPath(t.path) || !t.data || typeof t.data !== "object") return { skip: "ungültig" };
  const op = t.op || "delete";
  if (op === "exdate") {
    if (!cur) return { data: clone(t.data) };
    const n = clone(cur);
    const left = (Array.isArray(n.exdates) ? n.exdates : []).filter((k) => k !== t.date);
    if (left.length === (n.exdates || []).length) return { skip: "schon wieder da" };
    n.exdates = left; // leer lassen statt löschen: saveTodo der App führt Felder zusammen
    const prevOv = t.data.overrides && t.data.overrides[t.date];
    if (prevOv) n.overrides = { ...(n.overrides || {}), [t.date]: prevOv };
    return { data: n };
  }
  if (op === "items") {
    if (!cur) return { data: clone(t.data) };
    const n = clone(cur);
    const ids = new Set(Array.isArray(t.itemIds) ? t.itemIds : []);
    const have = new Set();
    for (const c of n.cats || []) for (const it of c.items || []) have.add(it && it.id);
    let added = 0;
    n.cats = Array.isArray(n.cats) ? n.cats : [];
    for (const oc of t.data.cats || []) {
      (oc.items || []).forEach((it, idx) => {
        if (!it || !ids.has(it.id) || have.has(it.id)) return;
        let c = n.cats.find((x) => x && x.id === oc.id);
        if (!c) { c = { ...clone(oc), items: [] }; n.cats.push(c); }
        c.items = Array.isArray(c.items) ? c.items : [];
        c.items.splice(Math.min(idx, c.items.length), 0, clone(it));
        added++;
      });
    }
    return added ? { data: n } : { skip: "schon wieder da" };
  }
  if (cur) return { skip: "existiert schon wieder" };
  return { data: clone(t.data) };
}

/** Papierkorb-Dokumente → Stapel [{batchId, deletedAt, items: [...], by}] (neueste zuerst). */
export function groupBatches(docs) {
  const m = new Map();
  for (const t of docs || []) {
    if (!t || !t.batchId) continue;
    if (!m.has(t.batchId)) m.set(t.batchId, { batchId: t.batchId, deletedAt: 0, by: t.by || "claude", items: [] });
    const b = m.get(t.batchId);
    b.items.push(t);
    b.deletedAt = Math.max(b.deletedAt, Number(t.deletedAt) || 0);
  }
  for (const b of m.values()) b.items.sort((a, c) => String(a.label || "").localeCompare(String(c.label || ""), "de"));
  return [...m.values()].sort((a, b) => b.deletedAt - a.deletedAt);
}

const TYPE_LABELS = {
  termin: "Termin", aufgabe: "Aufgabe", geburtstag: "Geburtstag", einsatz: "Einsatz", eintrag: "Eintrag",
  material: "Material", ausgabe: "Buchung", hausaufgabe: "Hausaufgabe", pruefung: "Prüfung", note: "Note",
  packliste: "Packliste", abo: "Abo", ort: "Ort", album: "Album",
};
export function typeLabel(t) { return TYPE_LABELS[t] || "Eintrag"; }
