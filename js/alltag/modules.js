// Register der „Alltag“-Bereiche. Jeder Bereich ist ein Modul mit
//   export function mount(el, ctx) → cleanup-Funktion
// el = leerer Container (Vollbild-Bereich unter der Kopfzeile „← Alltag · <Titel>“), ctx = App-Kontext (wie bei anderen Views: ctx.store, ctx.ui …).
// Kacheln erscheinen in dieser Reihenfolge auf der Alltag-Seite.
// Optional subFn() → Untertitel zur Laufzeit (z. B. eigener Name des Assistenten), sonst sub. Optional short → kürzerer Titel in der Kopfzeile.
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
  { id: "einkauf", title: "🛒 Einkaufsliste", short: "Einkaufsliste", sub: "Listen, abhaken, teilen – fehlendes Material inklusive", icon: "cart", color: "#16a34a", load: () => import("./einkauf.js") },
  { id: "material", title: "Material", sub: "Offen · vor Ort · verbaut · pro Baustelle", icon: "toolbox", color: "#ea580c", load: () => import("./material.js") },
  { id: "werkzeug", title: "🧰 Werkzeug", short: "Werkzeug", sub: "Register, Prüftermine, Verleih – mit QR-Sticker", icon: "wrench", color: "#c2410c", load: () => import("./werkzeug.js") }, // Update 10
  { id: "fahrzeuge", title: "🚗 Fahrzeuge", short: "Fahrzeuge", sub: "Pickerl, Service, Tankbuch, Kilometerstand", icon: "car", color: "#2563eb", load: () => import("./fahrzeuge.js") }, // Update 10
  { id: "haushalt", title: "🏡 Haushalt", short: "Haushalt", sub: "Putzplan, Wartung & was heute dran ist", icon: "home", color: "#0f766e", load: () => import("./haushalt.js") }, // Update 10 C
  { id: "routinen", title: "🎯 Routinen & Ziele", short: "Routinen & Ziele", sub: "Gewohnheiten 🔥, Morgen-/Abendroutine, Ziele", icon: "target", color: "#ea580c", load: () => import("./routinen.js") }, // Update 10 C
  { id: "notizen", title: "🧠 Notizbuch", short: "Notizbuch", sub: "Notizen, Verknüpfungen & was Claude sich merkt", icon: "note", color: "#7c3aed", load: () => import("./notizen.js") }, // Update 10 C
  { id: "notfall", title: "🆘 Notfallkarte", short: "Notfallkarte", sub: "Blutgruppe, Allergien, Medikamente, Kontakte", icon: "heart", color: "#dc2626", load: () => import("./notfall.js") }, // Update 10 C
  { id: "dokumente", title: "📁 Dokumente", short: "Dokumente", sub: "Rechnungen, Verträge, Garantie – mit Ablauf-Erinnerung", icon: "file", color: "#0369a1", load: () => import("./dokumente.js") }, // Update 10 E
  { id: "vertraege", title: "📜 Verträge", short: "Verträge", sub: "Laufzeit, Kündigungsfrist & Preisänderungen", icon: "briefcase", color: "#7c2d12", load: () => import("./vertraege.js") }, // Update 10 E
  { id: "inventar", title: "📦 Inventar", short: "Inventar", sub: "Was du hast: Kaufpreis, Garantie, Seriennummer, QR", icon: "box", color: "#a16207", load: () => import("./inventar.js") }, // Update 10 E
  { id: "kontakte", title: "👤 Kunden & Kontakte", short: "Kontakte", sub: "Kunden, Firmen, Gesprächsnotizen & Aufträge", icon: "users", color: "#0e7490", load: () => import("./kontakte.js") }, // Update 10 E
  { id: "rechner", title: "🧮 Taschenrechner", sub: "Rechnen mit Prozent, Wurzel & Verlauf", icon: "hash", color: "#475569", load: () => import("./calc.js") },
  { id: "japanisch", title: "🇯🇵 Japanisch", sub: "Kana, Vokabeln, Hören, Sprechen, Schreiben – mit Sensei", icon: "torii", color: "#dc2626", load: () => import("./japanisch.js") },
  { id: "lap", title: "🎓 LAP Elektrotechnik", short: "LAP Elektrotechnik", sub: "Lernkarten, Formeln, Rechnen, Prüfung – mit KI-Lehrer", icon: "bolt", color: "#ca8a04", load: () => import("./lap.js") },
  { id: "elektro", title: "⚡ Elektro-Tools", short: "Elektro-Tools", sub: "Umrechnen, Farbcode, Lexikon, Schaltzeichen", icon: "bolt", color: "#d97706", load: () => import("./elektro.js") }, // Update 10 F
  { id: "automationen", title: "⚡ Automationen", short: "Automationen", sub: "Wenn → dann: die App erledigt Kleinkram für dich", icon: "bolt", color: "#7c3aed", load: () => import("./automationen.js") }, // Update 10
  { id: "zeitleiste", title: "🕰️ Zeitleiste", short: "Zeitleiste", sub: "Arbeit, Fotos, Termine & Erlebtes – alles chronologisch", icon: "clock", color: "#0891b2", load: () => import("./zeitleiste.js") }, // Update 10
  { id: "galerie", title: "Galerie", sub: "Fotos nach Baustelle & Adresse", icon: "image", color: "#0284c7", load: () => import("./galerie.js") },
  { id: "tresor", title: "Passwort-Tresor", sub: "Passwörter, PINs, WLAN, Notizen – verschlüsselt", icon: "lock", color: "#6b7280", load: () => import("./vault.js") },
];
