// Einsatzplan – Helfer: welcher Einsatz gilt an einem Tag?
// Einsatz = Planer-Eintrag mit kind:"einsatz", gilt von date bis dateTo (inkl.).

/** true, wenn der Planer-Eintrag ein Einsatz ist. */
export function isEinsatz(t) {
  return !!t && t.kind === "einsatz";
}

/** true, wenn der Einsatz am Tag dayKey ("YYYY-MM-DD") gilt. */
export function einsatzCovers(e, dayKey) {
  if (!isEinsatz(e) || !e.date || !dayKey) return false;
  const to = e.dateTo && e.dateTo >= e.date ? e.dateTo : e.date;
  return dayKey >= e.date && dayKey <= to;
}

/** Alle Einsätze (kind "einsatz") aus einer Planer-Liste. */
export function einsaetze(todos) {
  return (Array.isArray(todos) ? todos : []).filter(isEinsatz);
}

/** Einsatz für dayKey oder null; bei mehreren gewinnt der zuletzt erstellte. */
export function einsatzFor(dayKey, todos) {
  let best = null;
  for (const t of einsaetze(todos)) {
    if (!einsatzCovers(t, dayKey)) continue;
    if (!best || (Number(t.createdAt) || 0) >= (Number(best.createdAt) || 0)) best = t;
  }
  return best;
}
