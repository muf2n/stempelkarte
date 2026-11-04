// Register der „Alltag“-Bereiche. Jeder Bereich ist ein Modul mit
//   export function mount(el, ctx) → cleanup-Funktion
// el = leerer Container (Vollbild-Bereich unter der Kopfzeile „← Alltag · <Titel>“), ctx = App-Kontext (wie bei anderen Views: ctx.store, ctx.ui …).
// Kacheln erscheinen in dieser Reihenfolge auf der Alltag-Seite.
export const MODULES = [
  { id: "claude", title: "Claude-Assistent", sub: "Frag Claude – plant, fasst zusammen, trägt ein", icon: "sparkle", color: "#d97757", load: () => import("./assistant.js") },
  { id: "geld",   title: "Geld",            sub: "Einnahmen, Budget, Sparziele, Abos", icon: "wallet", color: "#3fae7a", load: () => import("./money.js") },
  { id: "schule", title: "Schule & Lernen", sub: "Stundenplan, Prüfungen, Noten, Lernen", icon: "book", color: "#5b7cfa", load: () => import("./school.js") },
  { id: "tresor", title: "Passwort-Tresor", sub: "Passwörter, PINs, WLAN, Notizen – verschlüsselt", icon: "lock", color: "#6b7280", load: () => import("./vault.js") },
];
