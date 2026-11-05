// Register der „Alltag“-Bereiche. Jeder Bereich ist ein Modul mit
//   export function mount(el, ctx) → cleanup-Funktion
// el = leerer Container (Vollbild-Bereich unter der Kopfzeile „← Alltag · <Titel>“), ctx = App-Kontext (wie bei anderen Views: ctx.store, ctx.ui …).
// Kacheln erscheinen in dieser Reihenfolge auf der Alltag-Seite.
// Optional subFn() → Untertitel zur Laufzeit (z. B. eigener Name des Assistenten), sonst sub.
import * as store from "../store.js";

function aiName() {
  let n = null;
  try { n = localStorage.getItem("stempelkarte.ai.name"); } catch { n = null; }
  if (n == null) n = store.get()?.settings?.ai?.name;
  return String(n || "").replace(/[^\p{L} -]+/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
}

export const MODULES = [
  { id: "claude", title: "Claude-Assistent", sub: "Frag Claude – plant, fasst zusammen, trägt ein", icon: "sparkle", color: "#d97757", load: () => import("./assistant.js"),
    subFn: () => { const n = aiName(); return n ? `${n} – plant, fasst zusammen, trägt ein` : null; } },
  { id: "geld",   title: "Geld",            sub: "Einnahmen, Budget, Sparziele, Abos", icon: "wallet", color: "#3fae7a", load: () => import("./money.js") },
  { id: "schule", title: "Schule & Lernen", sub: "Stundenplan, Prüfungen, Noten, Lernen", icon: "book", color: "#5b7cfa", load: () => import("./school.js") },
  { id: "unterwegs", title: "Unterwegs", sub: "Reisen, Packlisten, Parkplatz, Tanken", icon: "suitcase", color: "#0d9488", load: () => import("./unterwegs.js") },
  { id: "material", title: "Material", sub: "Brauche ich · verbaut · pro Baustelle", icon: "toolbox", color: "#ea580c", load: () => import("./material.js") },
  { id: "tresor", title: "Passwort-Tresor", sub: "Passwörter, PINs, WLAN, Notizen – verschlüsselt", icon: "lock", color: "#6b7280", load: () => import("./vault.js") },
];
