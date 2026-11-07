// Update 10 F – ⚡ Elektro-Werkzeugkasten › 🔣 Schaltzeichen (vereinfacht nach EN 60617 / IEC 60617), als Inline-SVG.
// Alle Zeichen: viewBox 0 0 120 70, Linien in currentColor (hell/dunkel automatisch). Leitungsanschlüsse links/rechts bzw. oben/unten.
const svg = (inner, label) => `<svg viewBox="0 0 120 70" role="img" aria-label="${label}" class="es-svg" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const T = (x, y, t, size = 14) => `<text x="${x}" y="${y}" fill="currentColor" stroke="none" font-size="${size}" font-family="system-ui,sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">${t}</text>`;
const leads = `<path d="M8 35H40M80 35H112"/>`;
// Schließer: fester Kontakt rechts bei x=80, beweglicher Kontakt schräg von x=40
const noContact = `<path d="M8 40H40L78 22M80 40H112"/>`;

export const SYMBOLS = [
  { id: "widerstand", t: "Widerstand", sub: "allgemein (Rechteck)", s: svg(`${leads}<rect x="40" y="26" width="40" height="18" rx="1"/>`, "Widerstand") },
  { id: "poti", t: "Einstellbarer Widerstand", sub: "Potentiometer mit Schleifer", s: svg(`${leads}<rect x="40" y="30" width="40" height="16" rx="1"/><path d="M60 8V27M54 20L60 28L66 20"/>`, "Potentiometer") },
  { id: "schliesser", t: "Schalter (Schließer)", sub: "Kontakt in Ruhelage offen", s: svg(noContact, "Schließer") },
  { id: "oeffner", t: "Öffner", sub: "Kontakt in Ruhelage geschlossen", s: svg(`<path d="M8 40H40L84 30M80 40H112M80 40V26"/>`, "Öffner") },
  { id: "wechsler", t: "Wechsler (Umschalter)", sub: "z. B. Wechselschalter", s: svg(`<path d="M8 40H40L80 26M82 22H112M82 52H112M82 52V44"/>`, "Wechsler") },
  { id: "taster", t: "Taster (Schließer)", sub: "handbetätigt durch Drücken", s: svg(`${noContact}<path d="M59 31V12" stroke-dasharray="4 4"/><path d="M49 16V8H69V16"/>`, "Taster") },
  { id: "lampe", t: "Lampe / Leuchtmelder", sub: "Kreis mit Kreuz", s: svg(`<path d="M8 35H42M78 35H112"/><circle cx="60" cy="35" r="18"/><path d="M47.3 22.3L72.7 47.7M72.7 22.3L47.3 47.7"/>`, "Lampe") },
  { id: "steckdose", t: "Steckdose", sub: "Installationsplan, allgemein", s: svg(`<path d="M60 66V50"/><path d="M40 30A20 20 0 0 0 80 30"/>`, "Steckdose") },
  { id: "schuko", t: "Schutzkontakt-Steckdose", sub: "Installationsplan, mit Schutzkontakt", s: svg(`<path d="M60 66V50"/><path d="M40 30A20 20 0 0 0 80 30"/><path d="M36 30H84"/>`, "Schutzkontakt-Steckdose") },
  { id: "sicherung", t: "Sicherung", sub: "Schmelzsicherung, allgemein", s: svg(`${leads}<rect x="40" y="26" width="40" height="18" rx="1"/><path d="M40 35H80"/>`, "Sicherung") },
  { id: "ls", t: "Leitungsschutzschalter (LS)", sub: "Schaltfunktion + Überstromauslöser", s: svg(`<path d="M8 50H40L78 32M80 50H112"/><path d="M76 46L84 54M84 46L76 54"/><path d="M59 41V20" stroke-dasharray="4 4"/><rect x="44" y="4" width="30" height="16" rx="1"/>${T(59, 12, "I&gt;", 12)}`, "Leitungsschutzschalter") },
  { id: "fi", t: "Fehlerstrom-Schutzschalter (FI/RCD)", sub: "Auslösung bei Differenzstrom IΔ", s: svg(`<path d="M8 50H40L78 32M80 50H112"/><path d="M59 41V20" stroke-dasharray="4 4"/><rect x="42" y="4" width="34" height="16" rx="1"/>${T(59, 12, "IΔ", 12)}`, "Fehlerstrom-Schutzschalter") },
  { id: "motor", t: "Motor", sub: "Drehstrommotor", s: svg(`<path d="M8 35H40M80 35H112"/><circle cx="60" cy="35" r="20"/>${T(60, 29, "M", 16)}${T(60, 45, "3~", 11)}`, "Motor") },
  { id: "generator", t: "Generator", sub: "allgemein", s: svg(`<path d="M8 35H40M80 35H112"/><circle cx="60" cy="35" r="20"/>${T(60, 35, "G", 18)}`, "Generator") },
  { id: "trafo", t: "Transformator", sub: "zwei Wicklungen", s: svg(`<path d="M8 35H34M86 35H112"/><circle cx="50" cy="35" r="16"/><circle cx="70" cy="35" r="16"/>`, "Transformator") },
  { id: "erde", t: "Erde", sub: "Erdung, allgemein", s: svg(`<path d="M60 6V36M42 36H78M48 46H72M54 56H66"/>`, "Erde") },
  { id: "pe", t: "Schutzerde (PE)", sub: "Schutzleiteranschluss", s: svg(`<circle cx="60" cy="36" r="27"/><path d="M60 14V36M46 36H74M51 45H69M56 54H64"/>`, "Schutzerde") },
  { id: "kondensator", t: "Kondensator", sub: "allgemein", s: svg(`<path d="M8 35H54M66 35H112M54 16V54M66 16V54"/>`, "Kondensator") },
  { id: "elko", t: "Elektrolytkondensator", sub: "gepolt (+)", s: svg(`<path d="M8 35H54M66 35H112M54 16V54"/><path d="M66 16Q60 35 66 54"/><path d="M40 16V26M35 21H45"/>`, "Elektrolytkondensator") },
  { id: "spule", t: "Spule (Induktivität)", sub: "Wicklung", s: svg(`<path d="M8 35H30M90 35H112"/><path d="M30 35A7.5 7.5 0 0 1 45 35A7.5 7.5 0 0 1 60 35A7.5 7.5 0 0 1 75 35A7.5 7.5 0 0 1 90 35"/>`, "Spule") },
  { id: "diode", t: "Diode", sub: "Durchlass von links nach rechts", s: svg(`<path d="M8 35H46M74 35H112"/><path d="M46 20V50L74 35Z"/><path d="M74 20V50"/>`, "Diode") },
  { id: "led", t: "Leuchtdiode (LED)", sub: "Pfeile = Lichtaustritt", s: svg(`<path d="M8 40H46M74 40H112"/><path d="M46 26V54L74 40Z"/><path d="M74 26V54"/><path d="M66 20L78 8M71 8H78V15M78 24L90 12M83 12H90V19"/>`, "Leuchtdiode") },
  { id: "zdiode", t: "Z-Diode", sub: "Spannungsstabilisierung", s: svg(`<path d="M8 35H46M74 35H112"/><path d="M46 20V50L74 35Z"/><path d="M68 20H74V50H80"/>`, "Z-Diode") },
  { id: "relais", t: "Relais-/Schützspule", sub: "Antrieb, allgemein", s: svg(`<path d="M60 4V22M60 48V66"/><rect x="40" y="22" width="40" height="26" rx="1"/>`, "Relaisspule") },
  { id: "batterie", t: "Spannungsquelle / Zelle", sub: "langer Strich = Pluspol", s: svg(`<path d="M8 35H54M66 35H112M54 12V58M66 24V46"/>${T(42, 14, "+", 14)}`, "Batterie") },
  { id: "voltmeter", t: "Spannungsmesser", sub: "Voltmeter", s: svg(`<path d="M8 35H42M78 35H112"/><circle cx="60" cy="35" r="18"/>${T(60, 35, "V", 18)}`, "Voltmeter") },
  { id: "amperemeter", t: "Strommesser", sub: "Amperemeter", s: svg(`<path d="M8 35H42M78 35H112"/><circle cx="60" cy="35" r="18"/>${T(60, 35, "A", 18)}`, "Amperemeter") },
  { id: "verbindung", t: "Leiterverbindung", sub: "Punkt = leitend verbunden", s: svg(`<path d="M8 35H112M60 6V35"/><circle cx="60" cy="35" r="4" fill="currentColor"/>`, "Leiterverbindung") },
  { id: "kreuzung", t: "Kreuzung ohne Verbindung", sub: "Leitungen kreuzen sich nur", s: svg(`<path d="M8 35H112M60 6V64"/>`, "Kreuzung ohne Verbindung") },
];
export const SYMBOL_NOTE = "🔣 Vereinfachte Darstellung nach EN 60617. In Plänen können Größe und Ausrichtung abweichen – maßgeblich sind die Unterlagen der Berufsschule.";
