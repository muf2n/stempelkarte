# Update 10 – Plan (Master-Prompt „Complete Upgrade & Polish“)

Grundregel: **nichts entfernen**, nur verbessern und ergänzen. Jede Welle wird in eigenen Worktrees gebaut
(`/home/claude/skweb-<x>`, Branch `u10-<x>`), getestet, in `update9` zusammengeführt und erst dann veröffentlicht.

## Gemeinsame Regeln für alle Wellen
- Vanilla JS-Module, kein Build. Strenge CSP: keine Inline-Skripte, kein eval, neue Hosts nur in `connect-src` eintragen, wenn wirklich nötig.
- Neue JS/CSS-Dateien in `sw.js` ASSETS aufnehmen. Version erst beim Release hochzählen (macht der Hauptstrang).
- Daten: bestehende Strukturen nicht umbauen; neue Felder optional mit Standardwerten; Alltag-Daten über `js/alltag/db.js`.
- Ton: freundlich, Du-Form, österreichisch, **gemütlich mit passenden Emojis** (aber nicht überladen).
- Keine Platzhalter-Buttons, keine Beispieldaten in echten Funktionen, keine privaten Daten in Tests.
- Tests: bestehende behalten und erweitern (`node --test test/*.mjs`, `cd tools/mcp && npm test`, Playwright in `tests/*.cjs`, eigener Port).
- Prüfen bei 390 px und 1440 px, hell und dunkel.

## Wellen
| Welle | Inhalt | Status |
|---|---|---|
| 1a | Gemütliches Design: Emojis, wärmere Texte, Akzentfarben wählbar, einheitliche Karten | läuft |
| 1b | Smart Dashboard (Heute): kontextabhängig, Widgets ein/aus/verschiebbar | läuft |
| 1c | Arbeitszeit-Pro: Prognose, Was-wäre-wenn, Änderungsprotokoll, Monatsabschluss, Konten, CSV/Excel, vergessene Stempelung, Pausenerinnerung | läuft |
| 1d | Baustellen-Projektseiten: Status, Zeitleiste, Material/Fotos/Fahrten/Aufgaben verknüpft, QR, Bericht | läuft |
| 2 | Finanzen (Finanzkalender, Prognose, Jahresübersicht, Wunschliste, Rückerstattungen, Ampel, „Was kostet mein Alltag“), Universale Suche, Automationen | offen |
| 3 | Ausbildung (Portfolio, Lernkarten mit Wiederholung, Formelsammlung, Lexikon, Prüfungssimulation, Elektrotechnik-KI), Galerie (Markierungen, Vorher/Nachher, PDF, Favoriten, Duplikate) | offen |
| 4 | Alltag-Module optional: Fahrzeuge (Pickerl, Service), Haushalt (Einkaufsliste, Routinen), Fitness; Reisebudget/Reservierungen | offen |
| 5 | Sync-Status, Offline-Warteschlange sichtbar, Konflikte; Sicherheit: Geräte/Sitzungen (soweit Firebase es erlaubt), Datenexport, Datenschutz-Übersicht, Tresor-Wiederherstellungsschlüssel, Sicherheitsprotokoll | offen |
| 6 | Android: Widgets, Hintergrund-Sync, Akku, Berechtigungen | offen |
| 7 | KI: proaktive Vorschläge, Wochen-/Baustellenberichte, Sprachmodus (unterbrechbar, Aktionsanzeige) | offen |

Bekannte Grenzen (ehrlich): „Aktive Sitzungen/einzelne Geräte abmelden“ geht mit Firebase nur eingeschränkt
(Server kann alle Sitzungen widerrufen, nicht einzelne Browser auflisten); OCR braucht eine KI-Anfrage pro Bild.
