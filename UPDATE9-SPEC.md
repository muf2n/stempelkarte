# Update 9 – Alltag (verbindlich für alle Agenten)

Nutzer: Elektriker-Lehrling in Österreich, Xiaomi-Handy, nutzt die Web-App (GitHub Pages, Vanilla-ES-Module ohne Build, Firebase Auth + Firestore `users/{uid}/…`) am Handy (390×844) und PC. Alles auf Deutsch (österreichisch), Design wie bestehende Karten/Sheets (css/styles.css, Variablen, hell+dunkel). Vorher lesen: js/store.js (Datenformen, save*-Funktionen, normalisierer), js/util.js (netMin, creditMin, kindLabel, dayKey, KIND_LABELS), js/views/overview.js (Panels, Überstundenkonto, weeklyTarget), js/views/report.js (Berichtsheft-Vollbild + Drucken), js/export.js, js/timer.js (segments mit activity "Autofahren"/"Arbeiten", loc {lat,lng,addr}, endLoc), js/einsatz.js, UPDATE8-SPEC.md (Stil der letzten Specs).

## Allgemeine Regeln
- Jeder Agent arbeitet in SEINEM git-Worktree (siehe unten) und committet dort lokal (git -c user.name=muf2n -c user.email=muf2n@users.noreply.github.com commit; Nachricht endet mit den zwei Zeilen `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01TKAK97YsC6uZ6PpatzwaxW`). NICHT pushen, NICHT mergen.
- Neue Dateien → in sw.js-ASSETS eintragen. VERSION/`?v=` nicht ändern (macht der Koordinator).
- Gemeinsame Dateien (overview.js, app.js, styles.css, store.js, util.js, sw.js, index.html) nur minimal und an klar abgegrenzten Stellen ändern (eigener CSS-Block mit Kommentar `/* Update 9 – <Thema> */` am Dateiende), damit der Koordinator mergen kann.
- Neue Einstellungen unter einem eigenen Schlüssel in `settings` speichern (über store.saveSettings), Normalisierer in store.js ergänzen, falls dort Felder sonst verworfen werden.
- Lokaler Modus (#btn-local) muss alles können. Ohne Netz robust.
- Test: node --check aller geänderten Dateien; Playwright (require('playwright')) gegen `python3 -m http.server <PORT>` im eigenen Worktree, #btn-local klicken, fremde Domains abfangen; Testdaten über die UI oder localStorage anlegen; Screenshots 390×844 hell+dunkel und 1440×900 SELBST ansehen; keine Konsolenfehler. Bestehende Funktionen dürfen sich nicht verändern.
- Abschlussantwort kurz: Commit-Hash, Dateien, was geändert, Testergebnis, offene Punkte.

## Agent A – Stundenzettel als PDF + Urlaubs-/Krankenstandskonto (Worktree /home/claude/skweb-a, Port 8841)
1. **Stundenzettel**: In der Monatsauswertung (Übersicht) Knopf „Stundenzettel (PDF)“ → Vollbild-Ansicht wie report.js (eigene Datei `js/views/timesheet.js`): Kopf (Name, Lehrbetrieb aus settings.apprentice falls vorhanden, Monat/Jahr), Tabelle pro Tag (Datum, Wochentag, Art, Beginn, Ende, Pause, Netto h, Ort, Tätigkeit/Notiz; Wochenenden/Feiertage dezent), Wochen-Zwischensummen, Monatssumme, Soll/Ist/Saldo, Urlaub/Krank/ZA-Tage im Monat, Unterschriftsfelder (Lehrling/Ausbilder). Knöpfe „Drucken / als PDF speichern“ (window.print mit sauberem @media print: A4 hoch, nur der Zettel, schwarz/weiß-tauglich) und „Teilen“ (navigator.share mit Text-Zusammenfassung, Fallback Kopieren). Monat vor/zurück wählbar.
2. **Urlaubskonto & Krankenstand**: Karte in der Übersicht (neben/unter Überstundenkonto): Urlaubsanspruch pro Jahr (Einstellung, Standard 25 Arbeitstage = 5 Wochen; Urlaubsjahr ab Monat einstellbar, Standard Jänner; Resturlaub aus Vorjahr eintragbar), verbraucht (Einträge kind "urlaub", Arbeitstage zählen, halbe Tage wenn Eintrag < halber Soll-Tag), geplant (zukünftige Urlaubseinträge), übrig. Krankenstand: Tage dieses Jahr + Liste. Zeitausgleich: verbrauchte ZA-Stunden. Klick → Liste der betreffenden Tage. Einstellungen in `settings.leave = { daysPerYear, yearStartMonth, carryOver }`.

## Agent B – Taggeld & Kilometer (Worktree /home/claude/skweb-b, Port 8842)
1. **Kilometer**: Für jeden Abschnitt „Autofahren“ mit Start-loc und End-loc/endLoc Strecke berechnen (Luftlinie Haversine × Umwegfaktor, Standard 1,3, einstellbar), Anzeige im Eintrag/Tag („≈ 23 km“), manuell überschreibbar (Feld `km` am Segment; manuell hat Vorrang). Monats-/Jahressumme in der Übersicht, „Fahrtenbuch“-Liste (Datum, von → nach, km, Zweck=Ort). Optional Kilometerstand-Eingabe nicht nötig.
2. **Taggeld / Spesen**: Einstellungen `settings.allowance = { enabled, minHours (Standard 3 – ab wie vielen Stunden Abwesenheit Taggeld zählt), fullHours (Standard 11 für volles Taggeld), ratePart, rateFull (Euro, Standard leer → Nutzer trägt laut seinem Kollektivvertrag ein, Hinweis „Beträge laut deinem Kollektivvertrag / Lohnzettel eintragen“), homePlaceIds (Orte, an denen KEIN Taggeld zählt, z. B. Firma/Büro/Berufsschule), kmRate (Kilometergeld, Standard 0,50 €/km nur wenn eigenes Auto – Schalter „Eigenes Auto (Kilometergeld)“, Standard aus) }`. Pro Arbeitstag automatisch berechnen: Abwesenheitsdauer an Nicht-Heim-Orten → kein/teilweise/volles Taggeld; Monatssumme in der Übersicht + Spalte im CSV-Export (export.js um Spalten „km“ und „Taggeld €“ ergänzen, nur anhängen). Pro Tag manuell überschreibbar (`days/{dayKey}.allowance` = "none"|"part"|"full").
Keine Rechtsberatung: dezenter Hinweis, dass die Regeln vom Kollektivvertrag abhängen.

## Agent C – Fotos pro Baustelle (Worktree /home/claude/skweb-c, Port 8843)
Firebase Storage ist NICHT verfügbar (kostenpflichtig) → Fotos verkleinert in Firestore: Sammlung `users/{uid}/photos/{id}` = `{ id, ts, dayKey, placeId|null, place, entryId|null, note, w, h, data (JPEG-dataURL, längste Seite 1280 px, Qualität ~0.7, Ziel < 350 kB; wenn größer, weiter verkleinern), thumb (dataURL 240 px) }`. NICHT in den Haupt-Snapshot laden (store.js-Listener nicht erweitern!) – eigenes Modul `js/photos.js` mit Abfragen nach dayKey / placeId (Firestore-Query über getFirebase(); lokaler Modus: IndexedDB „stempelkarte-photos“). Funktionen: addPhoto(file, meta), listByDay, listByPlace, deletePhoto, updateNote.
UI: In „Heute“ während eingestempelt ein Kamera-Knopf (input type=file accept=image/* capture=environment) → Foto + optionale Notiz, automatisch mit aktuellem Ort/Tag verknüpft. Im Tag-Blatt (day.js) und im Ort-Blatt (places.js) Galerie (Thumbnails, Tippen → Vollbild mit Notiz, Löschen mit Bestätigung, Teilen über navigator.share mit Datei). Im Berichtsheft (report.js) optional pro Tag kleine Foto-Anzahl „📷 3“ (nur Anzeige). Datenschutz-Hinweis nicht nötig (nur eigenes Konto).

## Agent Y (Android, Wecker) – siehe Prompt.

# Update 9b – Tab „Alltag“ (Geld, Schule & Lernen)

Neuer Tab **„Alltag“** mit Kacheln; jeder Bereich ist ein eigenes Modul. Grundlage existiert schon (NICHT umbauen, nur nutzen; Bugs darin dürfen behoben werden):
- `js/alltag/db.js` – gemeinsamer Speicher: `collection("<name>")` → `watch(cb)`, `put(item)`, `patch(id, partial)`, `remove(id)`, `all()`, `get(id)`. Cloud: `users/{uid}/a_<name>/{id}`, lokal: localStorage. Sammlungsnamen mit Bereichs-Präfix (`money_tx`, `school_exams` …). Firestore-Regeln erlauben `users/{uid}/**` bereits.
- `js/alltag/modules.js` – Register; jedes Modul exportiert `mount(el, ctx) → cleanup`.
Gestaltung: modern, farbig wie die bestehende App (Karten, Pillen, Sheets aus css/styles.css wiederverwenden: .card, .sheet, ui.openSheet o. ä. – in js/ui.js nachsehen), Handy zuerst, PC breiter (2–3 Spalten). Zahlen in € österreichisch (1.234,56 €), Datum TT.MM.JJJJ. Leere Zustände freundlich mit „+ Hinzufügen“.

## Agent D – Alltag-Seite + Geld (Worktree /home/claude/skweb-d, Port 8845)
1. **Tab „Alltag“**: in index.html Tabbar ein neuer Knopf „Alltag“ (Symbol passend, Reihenfolge nach „Planer“/agenda), View `#view-alltag`, Routing in app.js wie die anderen Tabs (Hash `#alltag`, `#alltag/geld`). `js/views/alltag.js`: Kachel-Raster aus MODULES (Titel, Untertitel, Farbe, Icon aus icons.js – fehlende Icons „wallet“, „book“ dort ergänzen), Tippen → Modul laden (load()), Kopfzeile „← Alltag“ + Titel, `mount`/cleanup beim Wechsel. Handy: Tabbar darf nicht überlaufen – wenn zu eng, Beschriftungen kürzen oder „Orte“ in „Übersicht“ verschieben NICHT; stattdessen prüfen, wie viele Tabs passen (390 px) und notfalls Icon-only kleiner. Screenshot prüfen!
2. **`js/alltag/money.js` – Geld**: Unterreiter Übersicht · Buchungen · Budget · Sparziele · Abos · Teilen.
   - Buchungen (`money_tx`: {id, date, amount (positiv), type "in"|"out", category, note, recurringId?}): schnelles Eintragen (Betrag-Tastatur, Ein/Aus, Kategorie-Chips), Liste nach Monat, Suche.
   - **Automatische Kategorien**: Vorschlag aus Notiz per Stichwort-Regeln (Spar/Billa/Hofer/Lidl → Essen, OMV/BP/Shell/Tanken → Auto, Netflix/Spotify → Abos, Lehrlingsentschädigung/Lohn → Einkommen, McDonald's/Döner → Essen gehen …) + lernt aus eigenen Zuordnungen (`money_rules`). Kategorien mit Farbe/Emoji, editierbar.
   - Monatliches Budget pro Kategorie + gesamt (`money_budget`), Fortschrittsbalken, Warnung bei 80 %/100 %.
   - Sparziele (`money_goals`: Ziel, Betrag, Stand, Datum; Einzahlen-Knopf, „noch X € pro Monat“).
   - Abos & wiederkehrende Zahlungen (`money_subs`: Name, Betrag, Intervall monatlich/jährlich/wöchentlich, nächster Termin, Kategorie): Liste mit Monats-/Jahreskosten, „nächste Zahlungen“, automatisch als Buchung eintragen wenn fällig (beim Öffnen nachholen, nie doppelt).
   - Übersicht: Monat Einnahmen/Ausgaben/Saldo, Ringdiagramm „Wofür gebe ich mein Geld aus?“ (SVG selbst zeichnen, keine Bibliothek), Verlauf 6 Monate (Balken).
   - Teilen mit Freunden (`money_split`: Gruppe/Personen, Ausgaben „wer hat bezahlt, für wen“, Ausgleich-Rechnung „Max schuldet dir 12,50 €“, als Text teilen, „Beglichen“).
## Agent E – Schule & Lernen (Worktree /home/claude/skweb-e, Port 8846)
`js/alltag/school.js` (+ ggf. Untermodule `js/alltag/school-*.js`) mit Unterreitern Heute · Stundenplan · Aufgaben · Prüfungen · Noten · Lernen · Projekte · Dokumente.
- Vorher js/views/school-settings.js und js/views/apprentice.js lesen: Berufsschul-Tage/Blockwochen existieren schon (settings.school) – Stundenplan baut darauf auf (zeigt an Schultagen), nicht doppelt.
- Stundenplan (`school_timetable`: Wochentag, Stunde/Zeit von–bis, Fach, Raum, Lehrer, Farbe; A/B-Wochen optional) als Wochenraster.
- Hausaufgaben & Abgabefristen (`school_tasks`: Fach, Titel, fällig, erledigt, Priorität) mit „überfällig/heute/diese Woche“.
- Prüfungen & Schularbeiten (`school_exams`: Fach, Art, Datum, Stoff, Lernfortschritt) mit Countdown „noch 5 Tage“.
- Notenübersicht (`school_grades`: Fach, Note 1–5, Gewicht, Art, Datum) mit Schnitt pro Fach und gesamt (österr. Noten 1 = Sehr gut … 5 = Nicht genügend).
- Lernplan: aus Prüfungsdatum + Stoff automatisch Lerneinheiten auf die Tage davor verteilen (`school_plan`), abhakbar.
- Lern-Timer Pomodoro (25/5, einstellbar, Zähler pro Fach in `school_sessions`, Ton/Vibration am Ende, läuft bei Tab-Wechsel weiter über Zeitstempel).
- Projekte (`school_projects`: Titel, Fälligkeit, Schritte-Checkliste, Fortschritt).
- Dokumente & PDFs (`school_docs`: Titel, Fach, Datei als dataURL in eigener Sammlung, Limit 700 kB pro Datei – größere ablehnen mit Hinweis; Bilder vorher verkleinern; öffnen/teilen/löschen).
- „Heute“-Unterreiter: heutige Stunden, fällige Aufgaben, nächste Prüfung.
Da Agent D parallel die Alltag-Seite baut: zum Testen eine eigene Testseite `tests/school-harness.html` anlegen, die nach Start (#btn-local-Logik nicht nötig: store.startLocal() direkt aufrufen) `mount()` in einen Container ruft. In modules.js steht der Eintrag schon.
