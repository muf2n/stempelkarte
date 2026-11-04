// Register der „Alltag“-Bereiche. Jeder Bereich ist ein Modul mit
//   export function mount(el, ctx) → cleanup-Funktion
// el = leerer Container (Vollbild-Bereich unter der Kopfzeile „← Alltag · <Titel>“), ctx = App-Kontext (wie bei anderen Views: ctx.store, ctx.ui …).
// Kacheln erscheinen in dieser Reihenfolge auf der Alltag-Seite.
export const MODULES = [
  { id: "geld",   title: "Geld",            sub: "Einnahmen, Budget, Sparziele, Abos", icon: "wallet", color: "#3fae7a", load: () => import("./money.js") },
  { id: "schule", title: "Schule & Lernen", sub: "Stundenplan, Prüfungen, Noten, Lernen", icon: "book", color: "#5b7cfa", load: () => import("./school.js") },
];
