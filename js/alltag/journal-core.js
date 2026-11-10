// Update 11 – 🧳 Unterwegs › 📔 Reisetagebuch – reine Logik (kein DOM).
// Sammlung „travel_journal“, ein Dokument je Eintrag:
//   { id, tripId, day (YYYY-MM-DD), mood (Emoji aus MOODS), title, text, photoIds: [Foto-IDs aus js/photos.js], created, updated }
// Fotos liegen in der normalen Galerie (Tag = day) – das Tagebuch merkt sich nur ihre IDs.

export const MOODS = ["🤩", "😊", "😌", "😴", "🥵", "🥶", "🌧️", "😕"];
const s = (v) => (v == null ? "" : String(v)).trim();
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(s(k));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function normEntry(x = {}) {
  return {
    id: s(x.id), tripId: s(x.tripId), day: isKey(x.day) ? x.day : "", mood: MOODS.includes(x.mood) ? x.mood : "",
    title: s(x.title).slice(0, 80), text: s(x.text).slice(0, 4000),
    photoIds: [...new Set((Array.isArray(x.photoIds) ? x.photoIds : []).map(s).filter(Boolean))].slice(0, 24),
    created: Number(x.created) || 0, updated: Number(x.updated) || 0,
  };
}

/** Einträge einer Reise, chronologisch (gleicher Tag: älterer zuerst). */
export function forTrip(all, tripId) {
  return (all || []).map(normEntry).filter((e) => e.id && e.tripId === tripId && e.day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.created - b.created);
}

/** „Tag 3 · Mittwoch, 12.11.“ – Tag-Nummer nur, wenn die Reise ein Startdatum hat. */
export function dayLabel(day, from) {
  const d = dateOf(day);
  const n = isKey(from) ? Math.round((d - dateOf(from)) / 86400000) + 1 : 0;
  const date = `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
  return n >= 1 ? `Tag ${n} · ${date}` : date;
}

/** Vorschlag fürs Datum eines neuen Eintrags: heute, wenn innerhalb der Reise, sonst der erste Reisetag ohne Eintrag. */
export function suggestDay(trip, entries, today) {
  const from = isKey(trip && trip.from) ? trip.from : "", to = isKey(trip && trip.to) ? trip.to : from;
  if (!from) return today;
  if (today >= from && today <= to) return today;
  const used = new Set(entries.map((e) => e.day));
  for (let d = dateOf(from), i = 0; i < 60; i++, d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (k > to) break;
    if (!used.has(k)) return k;
  }
  return from;
}

export function addPhotoId(e, id) { const x = normEntry(e); return { ...x, photoIds: [...new Set([...x.photoIds, s(id)])].filter(Boolean).slice(0, 24) }; }
export function removePhotoId(e, id) { const x = normEntry(e); return { ...x, photoIds: x.photoIds.filter((p) => p !== id) }; }

/** Tagebuch als Text (zum Teilen/Kopieren). */
export function exportText(trip, entries) {
  const lines = [`📔 Reisetagebuch – ${s(trip && trip.title) || "Reise"}${trip && trip.dest ? ` (${s(trip.dest)})` : ""}`, ""];
  for (const e of entries) {
    lines.push(`${dayLabel(e.day, trip && trip.from)}${e.mood ? " " + e.mood : ""}${e.title ? " – " + e.title : ""}`);
    if (e.text) lines.push(e.text);
    if (e.photoIds.length) lines.push(`📷 ${e.photoIds.length} ${e.photoIds.length === 1 ? "Foto" : "Fotos"}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
