// Update 10 (Welle 1a): wählbare Akzentfarbe. settings.accent = "lila" | "blau" | … → <html data-accent="…">.
// "lila" ist der bisherige Standard (kein Attribut). Die Farben selbst stehen in css/styles.css (:root[data-accent=…]).
// Zuletzt gewählter Wert liegt zusätzlich in localStorage, damit js/appbar-settings.js ihn schon vor dem ersten Bild setzt.

export const ACCENT_KEY = "stempelkarte.accent";

export const ACCENTS = [
  { id: "lila", name: "Lila", sw: "#6D4AE8" },
  { id: "blau", name: "Blau", sw: "#2563EB" },
  { id: "tuerkis", name: "Türkis", sw: "#0F766E" },
  { id: "gruen", name: "Grün", sw: "#15803D" },
  { id: "orange", name: "Orange", sw: "#C2410C" },
  { id: "pink", name: "Pink", sw: "#BE185D" },
  { id: "grau", name: "Anthrazit", sw: "#334155" },
];

const IDS = new Set(ACCENTS.map((a) => a.id));

/** settings.accent mit Standardwert ("lila"). */
export function readAccent(settings) {
  const a = settings && settings.accent;
  return typeof a === "string" && IDS.has(a) ? a : "lila";
}

/** Auf <html> anwenden und für den nächsten Start merken. */
export function applyAccent(id) {
  const a = IDS.has(id) ? id : "lila";
  const de = document.documentElement;
  if (a === "lila") delete de.dataset.accent; else if (de.dataset.accent !== a) de.dataset.accent = a;
  try { localStorage.setItem(ACCENT_KEY, a); } catch { /* egal */ }
  return a;
}
