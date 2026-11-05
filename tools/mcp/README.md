# Stempelkarte als Claude-Connector (MCP-Server)

Mit diesem kleinen Server kannst du in deinem normalen Claude-Chat (claude.ai, Handy-App) direkt mit der
Stempelkarte reden: „Bin ich eingestempelt?“, „Stempel mich auf der Baustelle Huber ein“, „Mach mir aus
letzter Woche einen Berichtsheft-Text“, „Trag 12,50 € Billa ein“, „Was steht nächste Woche an?“ …

Er läuft kostenlos als **Cloudflare Worker** und liest/schreibt dieselben Firestore-Daten wie die Web-App
(`users/{uid}/…`) – mit demselben Dienstkonto wie die Push-Erinnerungen. Zusätzlich gibt es den Endpunkt
`/chat` für einen Assistenten direkt in der App.

## Was Claude damit kann

Claude sieht (fast) alles in der App und darf vieles ändern – Löschen und Einstellungen aber nur in zwei Schritten.
Insgesamt 49 Werkzeuge (verwandte Lese-Bereiche sind über `bereich`/`aktion` zusammengefasst).

**Lesen**

| Werkzeug | Was es macht |
|---|---|
| `status_heute` | eingestempelt? seit wann, Ort, Abschnitt, Pause, heutige Stunden, Woche Ist/Soll, Überstundenkonto, Modus Arbeit/Privat |
| `eintraege_lesen` | Arbeitszeiten im Zeitraum (Zeiten, Ort, Abschnitte, Personen, Notizen, Urlaub/Krank …) |
| `wochen_zusammenfassung` | Berichtsheft einer Woche (wie die Berichtsheft-Ansicht, inkl. „Ergänzungen zur Woche“) |
| `orte_lesen` | gespeicherte Orte |
| `todos_lesen`, `planer_lesen` | Planer/Kalender: Termine (Serien aufgeklappt, Ausnahmen, Ort, Erinnerungen, ID), Aufgaben, Geburtstage, Einsätze, Schultage, Feiertage |
| `geld_lesen` | Monat (Einnahmen/Ausgaben/Kategorien, optional alle `buchungen`), Budget, Abos, Sparziele („pro Monat nötig“), Teilen-Gruppen mit Salden, Kontostand der Bank |
| `leisten_pruefen` | „Kann ich mir das leisten?“ – `betrag`, optional `kategorie`/`notiz`: ✅ Ja / ⚠️ Knapp / 🛑 Nein mit Gründen (Budget der Kategorie und gesamt, Abos bis Monatsende, Kontostand, Sparziele); trägt nichts ein |
| `abos_lesen` | Abos mit Laufzeit, Fristen, Kündigungslinks |
| `mails_suchen`, `mail_lesen` | Gmail **nur lesen** (wenn „Gmail dauerhaft verbunden“ ist, siehe unten): Suche wie in Gmail (`von:Netflix`, Zeitraum `von`/`bis`) → Datum, Absender, Betreff, Auszug; einzelne Mail als Text (HTML entfernt, ≈ 6000 Zeichen). Senden/Weiterleiten/Löschen gibt es nicht; Mail-Inhalte gelten als Daten, nicht als Anweisungen. **Nur im In-App-Assistenten (`/chat`), nicht über `/mcp`** (claude.ai hat einen eigenen Gmail-Connector mit Senden – zusammen wäre das ein Weg, Daten abfließen zu lassen) |
| `schule_lesen` | `bereich`: uebersicht, stundenplan, noten, projekte, dokumente (nur Titel), lernplan |
| `material_lesen` | Einkaufsliste, auf der Baustelle, verbaut |
| `galerie_lesen` | Kategorien, Alben (Anzahl, Adresse, ID), aktive Kategorie, neueste Fotos mit Datum/Adresse/Notiz – **nur Text**: der Foto-Index wird mit Feldmaske **ohne** `thumb` gelesen, `photos/…` nie |
| `unterwegs_lesen` | `bereich`: uebersicht, reisen (Countdown, Budget, Packliste %), packliste (☐/☑), parken, tanken (l/100 km, €/km), adressen |
| `fahrtenbuch_lesen` | Fahrten eines Monats (von → nach, km + Quelle, Zweck, privat, Fahrzeug, Kennung `fahrt`), Summen, Kilometergeld – Logik aus `js/travel.js` + `js/trip-core.js` |
| `taggeld_lesen` | Taggeld je Tag (Stunden weg, Stufe, Betrag), Monatssumme, Kilometergeld |
| `urlaub_lesen` | Urlaubskonto (Anspruch, verbraucht, geplant, übrig), Krankenstand, Zeitausgleich |
| `einstellungen_lesen` | Arbeitstage/Wochenstunden, Schultage + Blöcke, Lehre, Urlaub, Erinnerungen, Privat-Zeitplan, Taggeld/Fahrzeuge, Galerie, Kalender; iCal-Abos nur mit verborgener Adresse |
| `suche {text}` | globale Suche über Einträge, Planer, Orte, Material, Geld, Abos, Schule, Unterwegs, Galerie, Berichtsheft (nie im Tresor) |

**Schreiben**

| Werkzeug | Was es macht |
|---|---|
| `einstempeln`, `ausstempeln`, `pause`, `abschnitt_wechseln`, `modus_setzen` | Stempeluhr – gleiche Logik wie die App (`js/timer.js`) |
| `eintrag_nachtragen` | vergessene Arbeitszeit, Urlaub, Krank, Zeitausgleich, Schule (auch Zeiträume) |
| `eintrag_bearbeiten` | abgeschlossenen Eintrag ändern: Beginn/Ende/Pause/Ort/Notiz/Personen bzw. Gutschrift – nie die laufende Schicht |
| `todo_anlegen` (auch `art: "geburtstag"`), `termin_anlegen`, `einsatz_anlegen`, `todo_erledigt` | Planer; `countdown: true` zeigt „noch X Tage“ |
| `planer_bearbeiten` | Termin/Aufgabe/Geburtstag ändern oder verschieben – Serien: `umfang` alle / nur_diese / ab_diesem (wie der Kalender, `applyEdit` + `finalizeEvent` aus `js/cal-core.js`), Wiederholung, Erinnerungen, Kalender, Countdown |
| `fahrt_bearbeiten` | Zweck, beruflich/privat, Fahrzeug, km einer Fahrt |
| `ausgabe_eintragen`, `abo_bearbeiten` | Buchungen, Abo-Details |
| `geld_eintragen` | `aktion`: budget, sparziel, einzahlung, teilen (Ausgabe in einer Gruppe) |
| `hausaufgabe_anlegen`, `pruefung_anlegen`, `schule_eintragen` | Schule; `schule_eintragen` `aktion`: note, stunde (Stundenplan), projekt_schritt |
| `material_anlegen`, `material_status` | Material eintragen bzw. Status ändern (brauche → besorgt → baustelle → verbaut) |
| `unterwegs_eintragen` | `aktion`: reise_anlegen, packliste_hinzufuegen, packliste_abhaken, parkplatz_merken (nach Adresse), tanken (optional in Geld buchen), adresse_speichern |
| `berichtsheft_notiz` | Ergänzung zu einer Berichtsheft-Woche (`settings.apprentice.notes`) |
| `galerie_bearbeiten` | `aktion`: album_umbenennen, album_kategorie, foto_notiz (schreibt nur `note` in Foto + Index) |
| `einstellung_aendern` → `einstellung_bestaetigen` | **zweistufig** – siehe unten |
| `loeschen_vorschlagen` → `loeschen_bestaetigen`, `rueckgaengig` | **zweistufig** Löschen + Papierkorb |

Jede Änderung antwortet mit einer kurzen deutschen Bestätigung; im In-App-Assistenten landet der Werkzeugname in `actions`
(Löschen als `loeschen`, Einstellungen als `einstellung`).

### Einstellungen ändern (zweistufig, nur Freigabeliste)

`einstellung_aendern {bereich, werte}` rechnet vorher → nachher aus und legt den Vorschlag mit einem
Bestätigungscode (10 Minuten) in `users/{uid}/meta/ai_pending_settings` ab – gespeichert wird noch nichts.
Erst nach deinem **Ja** in der nächsten Nachricht speichert `einstellung_bestaetigen {bestaetigungs_code}` (in `/chat` lehnt
der Server die Bestätigung im selben Zug ab – genau wie beim Löschen). Wurde die Einstellung inzwischen in der App
geändert, wird nichts gespeichert. Erlaubt sind nur:

| `bereich` | Felder |
|---|---|
| `arbeitszeit` | `arbeitstage`, `wochenstunden` |
| `schule` | `schultage`, `block_hinzufuegen {von, bis, name}`, `block_entfernen` |
| `lehre` | `lehrbeginn`, `lehrdauer`, `lehrberuf`, `lehrbetrieb`, `name` |
| `urlaub` | `anspruch`, `urlaubsjahr_ab_monat`, `rest_vorjahr` |
| `erinnerungen` | `an`, `einstempeln_an`, `einstempeln_um`, `ausstempeln_an`, `ausstempeln_nach_h`, `pause_an` |
| `privat` | `zeitplan_an`, `arbeit_von`, `arbeit_bis`, `privatfahrten_aufzeichnen` |
| `galerie` | `aktive_kategorie` (neue Fotos gehen nach …), `automatisch` |
| `taggeld` | `an`, `ab_stunden_teilweise`, `ab_stunden_voll`, `betrag_teilweise`, `betrag_voll`, `kilometergeld`, `eigenes_auto`, `umwegfaktor` |

### Nie erlaubt

Passwort-Tresor (verschlüsselt, nicht lesbar), API-Schlüssel/Tokens/App-Sperre, Adressen der Kalender-Abos (werden nur
als `host/… (Adresse verborgen)` gezeigt), Bankverbindung einrichten/trennen (Kontostand lesen geht, ohne Sitzungs-IDs),
Nachrichten oder E-Mails senden, Löschen ohne die zwei Schritte, Google-Konto/Anmeldung ändern. Fragt man danach,
erklärt Claude freundlich warum und wo es in der App geht.

Alles, was Claude anlegt, bekommt das Feld `src: "claude"`.

### Sicheres Löschen

„Lösch meine Termine im Dezember“, „Lösch die Schul-Einträge, die nicht in meinen Schulblöcken liegen“,
„Nimm die Sonnencreme von der Packliste Kroatien“ – Claude kann löschen, aber **immer in zwei Schritten**:

1. `loeschen_vorschlagen {was, suche?, von?, bis?, id?}` sucht die Elemente und antwortet mit einer Liste
   (Datum, Art, Titel) und einem **Bestätigungscode** (6 Zeichen, 10 Minuten gültig, höchstens 200 Elemente).
   Der Vorschlag liegt in `users/{uid}/meta/ai_pending_delete`. Claude zeigt dir die Liste und fragt
   „Soll ich diese X löschen?“.
2. Erst nach deinem ausdrücklichen **Ja** ruft Claude `loeschen_bestaetigen {bestaetigungs_code}` auf.
   Ohne gültigen Code (falsch, abgelaufen, schon benutzt) wird nichts gelöscht. Im In-App-Assistenten (`/chat`)
   lehnt der Server eine Bestätigung im selben Zug wie den Vorschlag ab – du musst also wirklich vorher antworten.
   In der Claude-App fragt Claude zusätzlich selbst nach, bevor das Werkzeug läuft.

| `was` | Sammlung | Suche in | Datum |
|---|---|---|---|
| `termin` (auch `event`), `aufgabe`, `geburtstag`, `einsatz` | `todos` | Titel, Notiz, Ort | Datum (Serien aufgeklappt) |
| `eintrag` (auch `urlaub`, `krank`, `zeitausgleich`, `schule`) | `entries` | Notiz, Ort, Art | Tag des Eintrags |
| `material` | `a_material_items` | Name, Notiz, Baustelle | Tag |
| `ausgabe` (Buchung, auch Einnahmen) | `a_money_tx` | Notiz, Kategorie | Datum |
| `hausaufgabe`, `pruefung`, `note` | `a_school_tasks`, `a_school_exams`, `a_school_grades` | Titel/Fach/Stoff | Fälligkeit/Datum |
| `packliste` (einzelne Gegenstände, `liste` = Name der Liste) | `a_travel_packing` | Gegenstand | – |
| `abo` | `a_money_subs` | Name | – |
| `ort` | `places` | Name, Adresse | – (Einträge behalten den Ortsnamen als Text) |
| `album` | `a_photo_albums` | Name, Adresse | – **„Album löschen, Fotos behalten“**: die Album-ID wird aus `albumIds` der Fotos (Foto + Index) entfernt; `rueckgaengig` legt sie wieder hinein |

- **Zeiträume:** `von`/`bis` verstehen TT.MM.JJJJ, JJJJ-MM-TT, „24.12.“, „heute“, „Dezember“, „im Dezember“,
  „nächste Woche“, „letzte Woche“. Alles andere rechnet Claude selbst in ein Datum um.
- **Serientermine:** Claude fragt zuerst „ganze Serie oder nur am Datum X?“ (`serie: "ganz"` bzw. `"nur_datum"`).
  „Nur am Datum“ setzt – wie der Kalender der App – eine Ausnahme (`exdates`) am Termin.
- **Schule außerhalb der Blöcke:** `was: "eintrag", nur_ausserhalb_schulblock: true` findet „Schule“-Einträge, die
  weder an einem wöchentlichen Schultag noch in einem Schulblock liegen.
- **Nie löschbar:** Passwort-Tresor, Fotos, Einstellungen und die laufende Schicht (zuerst ausstempeln). Alben schon – die Fotos bleiben.
  Ganz ohne Suchtext/Zeitraum/ID löscht Claude nichts.

**Papierkorb / Rückgängig:** Vor dem Löschen wird jedes Dokument nach `users/{uid}/a_trash/{id}` kopiert
(`{path, data, op, deletedAt, by: "claude", batchId}`; `path` relativ zu `users/{uid}/`). `rueckgaengig` stellt den
letzten (oder mit `batch` einen bestimmten) Stapel wieder her – Ausnahmen von Serien und Packlisten-Gegenstände
werden dabei einzeln zurückgesetzt, spätere Änderungen bleiben erhalten. Einträge älter als 30 Tage werden beim
nächsten Zugriff entfernt. In der App: **Übersicht → Einstellungen → Papierkorb** oder im Assistenten unten
**Papierkorb** – mit „Wiederherstellen“ und „Endgültig löschen“.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Cloudflare-Konto

1. Kostenloses Konto auf <https://dash.cloudflare.com/sign-up> anlegen.
2. Links **Workers & Pages** öffnen und einmal eine `workers.dev`-Subdomain wählen (z. B. `florian`).
   Daraus wird später die Adresse `https://stempelkarte-mcp.<subdomain>.workers.dev`.
3. **Account-ID** kopieren: steht rechts auf der Übersicht von „Workers & Pages“ (bzw. in der Adresszeile
   `dash.cloudflare.com/<ACCOUNT-ID>/…`).
4. **API-Token** erstellen: Profil (oben rechts) → **My Profile → API Tokens → Create Token** → Vorlage
   **„Edit Cloudflare Workers“** → *Use template* → bei *Account Resources* dein Konto wählen → *Continue* →
   *Create Token*. Token kopieren (wird nur einmal angezeigt).

### 2. Zugangs-Token für den Connector erzeugen

Ein langes Zufalls-Passwort – wer es kennt, kann deine Stempelkarte bedienen. Erzeugen mit **einem** von:

```bash
openssl rand -hex 32
# oder
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

(Am Handy geht auch ein Passwort-Manager mit 64 zufälligen Zeichen aus Buchstaben und Ziffern.)

### 3. GitHub-Secrets anlegen

Im Repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Inhalt |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API-Token aus Schritt 1.4 |
| `CLOUDFLARE_ACCOUNT_ID` | Account-ID aus Schritt 1.3 |
| `STEMPEL_TOKEN` | Zufalls-Token aus Schritt 2 |
| `FIREBASE_SERVICE_ACCOUNT` | **gibt es schon** (Erinnerungen) – nichts tun |
| `ANTHROPIC_API_KEY` | *optional*, nur für den In-App-Assistenten (`/chat`): API-Schlüssel von <https://console.anthropic.com> |
| `STEMPEL_UID` | *optional*: deine Firebase-UID, falls die automatische Suche per E-Mail nicht klappt |
| `ENABLEBANKING_APP_ID` | *optional*, Bankverbindung: Application-ID aus dem Enable-Banking-Control-Panel (siehe unten) |
| `ENABLEBANKING_KEY` | *optional*, Bankverbindung: kompletter Inhalt der heruntergeladenen `.pem`-Datei |

Danach **Actions → „MCP-Connector veröffentlichen“ → Run workflow** (oder einfach etwas unter `tools/mcp/`
auf `main` pushen). Der Workflow testet, veröffentlicht den Worker und überträgt die Secrets.
Ohne `CLOUDFLARE_API_TOKEN` wird er nur mit einem Hinweis übersprungen.

Kontrolle: `https://stempelkarte-mcp.<subdomain>.workers.dev/` zeigt „MCP-Server läuft“.

### 4. In Claude hinzufügen

claude.ai (am PC oder im Browser) → **Customize → Connectors → Add custom connector**:

- **Name:** `Stempelkarte`
- **URL** – eine der beiden Varianten:
  - **Einfach (funktioniert überall):** `https://stempelkarte-mcp.<subdomain>.workers.dev/mcp?key=<STEMPEL_TOKEN>`
    und bei *Authentication* **No sign-in**.
  - **Mit Header** (nur wenn der Dialog den Abschnitt *Request headers* zeigt – das ist noch Beta):
    URL `https://stempelkarte-mcp.<subdomain>.workers.dev/mcp`, **No sign-in**, unter *Request headers*
    `authorization` mit dem Wert `Bearer <STEMPEL_TOKEN>` (das Wort `Bearer` und das Leerzeichen mit eintippen).
- **Add** klicken. Im Chat über **„+“ → Connectors** einschalten. Der Connector steht danach auch in der
  Claude-Handy-App zur Verfügung.

Tipp: Unter *Customize → Connectors → Stempelkarte* kannst du einzelne Werkzeuge auf „Immer fragen“ stellen
(z. B. `ausstempeln`), wenn Claude vor jeder Änderung nachfragen soll.

**Token geändert/geleakt?** Neues `STEMPEL_TOKEN` erzeugen, GitHub-Secret ändern, Workflow neu starten,
Connector in Claude entfernen und mit der neuen URL wieder hinzufügen.

## In-App-Assistent: `POST /chat`

Für einen Chat direkt in der Web-App. Anmeldung mit dem Firebase-ID-Token der App (kein STEMPEL_TOKEN).

- **URL:** `https://stempelkarte-mcp.<subdomain>.workers.dev/chat`
- **Header:** `Authorization: Bearer <Firebase-ID-Token>` (`await auth.currentUser.getIdToken()`),
  `Content-Type: application/json`
- **Erlaubte Herkunft (CORS):** `https://muf2n.github.io`; `http://localhost:<port>`/`http://127.0.0.1:<port>` nur, wenn die Variable `ALLOW_LOCALHOST_CORS = "1"` gesetzt ist (lokale Entwicklung, z. B. `wrangler dev --var ALLOW_LOCALHOST_CORS:1`)
- **Inhalte von Dritten:** Mail-Texte und Bank-Verwendungszwecke/Gegenkonten kommen als `<untrusted_content source="email|bank">…</untrusted_content>` zurück. Hat der Assistent in einer `/chat`-Runde solche Inhalte gelesen, lehnt der Server in derselben Runde jedes Schreib-Werkzeug ab (der Assistent muss erst nachfragen).
- **Ratenbegrenzung:** `/gmail/callback`, `/bank/finish` (je 10/min), `/ics` (60/min) und fehlgeschlagene `/mcp`-Anmeldungen (10/min, 20 am Stück) pro IP und Isolat → 429
- **Body:** `{"messages":[{"role":"user","content":"Bin ich eingestempelt?"}, …]}` – ganzer Verlauf,
  abwechselnd `user`/`assistant`, nur Text, letzte Nachricht vom Nutzer, max. 40 Nachrichten / 40.000 Zeichen.
- **Antwort 200:** `{"reply":"…","actions":["einstempeln"],"usage":{"month":"2026-11","inTok":…,"outTok":…,"usd":…,"capUsd":3}}`
  – `actions` = verwendete Schreib-Werkzeuge (App sollte danach ggf. neu laden; Firestore-Listener tun das ohnehin).
  Die Werkzeug-Liste wird mit `cache_control` zwischengespeichert (Prompt-Caching); die Kosten rechnen Cache-Schreiben ×1,25 und Cache-Lesen ×0,1.
- **Fehler:** JSON `{"error":"…"}` mit deutschem Text – 400 (ungültige Nachrichten), 401 (Token fehlt/ungültig/
  falsches Konto), 403 (fremde Herkunft), 413 (Verlauf zu lang), 429 (Monatsbudget aufgebraucht, zusätzlich
  `reply` mit freundlichem Text), 502 (KI-Dienst nicht erreichbar), 503 (nicht eingerichtet).
- Geprüft wird: Signatur gegen Googles securetoken-Schlüssel, `aud`/`iss` = Projekt `stempelkarte-40682`,
  `exp`, E-Mail = `lippa.florian@gmail.com` und `email_verified`. Die UID kommt aus dem Token.
- **Kostendeckel:** Verbrauch pro Monat in `users/{uid}/meta/ai_usage` (`month, inTok, outTok, usd`);
  über `AI_MONTHLY_USD` (Standard 3 $) wird abgelehnt. Modell über `CLAUDE_MODEL` (Standard `claude-haiku-4-5`,
  geschätzt 1 $ / 5 $ pro Mio. Eingabe-/Ausgabe-Tokens). Beides lässt sich als Variable in `wrangler.toml`
  (`[vars]`) ändern.

## Kalender-Links (iCal): `GET /ics?id=<feedId>`

Für „Google Kalender dauerhaft verbinden“ in der App (Kalender → iCal-Link). Die App speichert die geheime
iCal-Adresse in `users/{uid}/meta/ical_feeds` (`{feeds:[{id, name, color, url, visible}]}`); der Worker liest sie
von dort (nie aus der Anfrage → kein offener Proxy), holt den Kalender mit 10 s Zeitlimit und max. 2 MB ab und
antwortet mit `text/calendar` (Kopfzeile `x-ics-fetched-at`). Anmeldung mit Firebase-ID-Token wie bei `/chat`,
gleiche CORS-Regeln. Zwischenspeicher 10 Minuten je Nutzer+Feed (`caches.default`, sonst Speicher); `&fresh=1`
holt frühestens nach 1 Minute neu. Erlaubt sind nur https-Adressen von `calendar.google.com/calendar/ical/…`
oder mit Pfad auf `.ics` (keine IP-Adressen, Weiterleitungen werden erneut geprüft). Keine Einrichtung nötig.

## Bankkonto (BAWAG) automatisch abgleichen: `/bank/*`

Die App holt deine Kontobewegungen von BAWAG automatisch nach **Alltag › Geld** (Buchungen mit 🏦).
Dafür wird **Enable Banking** benutzt – ein in der EU zugelassener Kontoinformationsdienst (PSD2-AISP).
Du meldest dich dabei **auf der Seite von BAWAG** an; die App und der Server sehen dein Passwort nie.
Die Application läuft im **Restricted Mode**: Sie sieht ausschließlich die Konten, die du selbst im Control
Panel verknüpfst. Die Zustimmung gilt höchstens 180 Tage, danach einmal neu verbinden (die App legt eine
Aufgabe „Bankverbindung erneuern“ an, wenn weniger als 7 Tage übrig sind).

### Einrichtung (einmalig, ca. 10 Minuten)

1. **Konto anlegen:** <https://enablebanking.com/> → *Sign up* / Control Panel → mit
   `lippa.florian@gmail.com` registrieren und die Bestätigungsmail anklicken (kann ein paar Minuten dauern).
2. **Application anlegen:** Control Panel → **API applications** → **Register new application**
   (bzw. „Add application“):
   - **Environment:** **Production** (nicht Sandbox – Sandbox kennt keine echten Banken).
   - **Name:** `Stempelkarte`, Beschreibung z. B. „Private Haushaltsbuch-App, nur eigene Konten“.
   - **Allowed redirect URLs:** genau `https://muf2n.github.io/stempelkarte/bank-callback.html`
     (für lokale Tests zusätzlich z. B. `http://localhost:8848/bank-callback.html`).
   - Weitere Pflicht-Felder (Datenschutz-/AGB-Link, E-Mail) mit `https://muf2n.github.io/stempelkarte/` bzw.
     deiner E-Mail ausfüllen.
   - **Private key:** „Generate in the browser“ lassen → **Register**. Der Browser lädt jetzt eine Datei
     `<Application-ID>.pem` herunter – **gut aufheben, sie wird nur dieses eine Mal angezeigt.**
3. **Eigenes BAWAG-Konto verknüpfen (Restricted Mode aktivieren):** In der Liste der Applications bei
   „Stempelkarte“ auf **Activate by linking accounts** (bzw. „Link accounts“) → Land **Österreich** → Bank
   **BAWAG** (nicht „easybank“ – das sind andere Zugangsdaten) → auf der BAWAG-Seite anmelden und freigeben →
   das Girokonto auswählen. Danach steht die Application auf *active (restricted)*.
   Nur verknüpfte Konten liefern Daten – ein neues Konto muss hier ebenfalls verknüpft werden.
4. **Application-ID kopieren:** steht bei der Application (Format `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
   gleich wie der Dateiname der `.pem`).
5. **GitHub-Secrets** (Repository → Settings → Secrets and variables → Actions → New repository secret):
   - `ENABLEBANKING_APP_ID` = die Application-ID
   - `ENABLEBANKING_KEY` = den **ganzen Inhalt** der `.pem`-Datei (mit Texteditor öffnen, alles von
     `-----BEGIN …-----` bis `-----END …-----` kopieren). `BEGIN PRIVATE KEY` (PKCS#8) und
     `BEGIN RSA PRIVATE KEY` (PKCS#1) gehen beide.
6. **Actions → „MCP-Connector veröffentlichen“ → Run workflow.** Der Workflow überträgt die Secrets und
   richtet den Zeitplan (4× täglich) ein.
7. In der App: **Alltag › Geld › Übersicht → Karte „Bankkonto (BAWAG)“ → „Mit BAWAG verbinden“** → auf der
   BAWAG-Seite anmelden und bestätigen → du landest wieder in der App; die letzten 90 Tage werden geladen.

Die Bank-Anmeldung in Schritt 7 ist die eigentliche Zustimmung für die App (Schritt 3 schaltet nur die
Application frei) – beides ist nötig.

### Was passiert

- `POST /bank/start` `{aspsp?}` → `{url}`: sucht die Bank in `GET /aspsps?country=AT`, fordert eine Zustimmung
  für max. 180 Tage an (bzw. `maximum_consent_validity` der Bank), merkt sich einen zufälligen `state`
  (nur als Hash, 15 Minuten gültig) in `users/{uid}/meta/bank_pending`.
- `bank-callback.html` (Web-App) schickt `code` + `state` an `POST /bank/finish` → Sitzung bei Enable Banking
  anlegen, `users/{uid}/meta/bank` speichern (nur die **letzten 4 Stellen** der IBAN) und sofort 90 Tage abgleichen.
- `POST /bank/sync` (Knopf „Jetzt aktualisieren“), `GET /bank/status`, `POST /bank/unlink` (Sitzung bei
  Enable Banking schließen; importierte Buchungen bleiben).
- **Zeitplan** (`[triggers]` in `wrangler.toml`): 05/11/16/21 Uhr UTC. Abgleich ab letztem Abgleich − 3 Tage,
  `continuation_key` wird verfolgt, nur **gebuchte** Umsätze (`status: BOOK`).
- Buchungen landen in `users/{uid}/a_money_tx/bk_<hash>` – gleiche Felder wie in der App plus `src: "bank"`,
  `bankRef`, `counterparty`. Kategorie über dieselben Stichwort-Regeln wie die App und deine gelernten
  Zuordnungen (`money_rules`). Von dir geänderte Buchungen werden nie überschrieben, gelöschte nicht wieder
  angelegt. Gleiche Beträge, die du schon von Hand oder als Abo gebucht hast (±5 Tage), werden verknüpft statt
  doppelt eingetragen.
- Viele Banken erlauben nur **4 automatische Abrufe pro Tag**. Bei `ASPSP_RATE_LIMIT_EXCEEDED` pausiert der
  Zeitplan 6 Stunden; bei `EXPIRED_SESSION` zeigt die App „neu verbinden“.
- Kosten: Laut Drittanbieter-Anleitungen ist der Restricted Mode für eigene Konten kostenlos; Enable Banking
  selbst schreibt nur „Our pricing is volume based“ (<https://enablebanking.com/docs/faq/>) – im Control Panel
  prüfen, ob ein Zahlungsmittel verlangt wird.

## Gmail dauerhaft verbinden (Server): `/gmail/*`

Statt sich bei jedem Prüfen neu bei Google anzumelden (Browser-Modus in `js/alltag/gmail.js`), kann der Server
**dauerhaft und nur lesend** auf Gmail zugreifen: täglich um 06:30 UTC (≈ 07:30 Wien) sucht er neue Abo-Mails,
und der Assistent kann auf Nachfrage Mails suchen/lesen (`mails_suchen`, `mail_lesen`).

**Bewusste Abwägung:** Dafür liegt ein langlebiges Google-**Refresh-Token** (Bereich `gmail.readonly`) auf dem
eigenen Cloudflare-Worker – **verschlüsselt** (AES-256-GCM, Schlüssel per HKDF/SHA-256 aus `GMAIL_ENC_KEY`) in
`users/{uid}/meta/gmail_server`. Wer Firestore *und* das Secret hätte, könnte die Mails lesen. Widerrufen geht
jederzeit mit „Trennen“ in der App oder unter <https://myaccount.google.com/permissions>.

### Einrichtung (einmalig, ca. 10 Minuten)

Voraussetzung wie beim Browser-Modus: In <https://console.cloud.google.com/> (Projekt **stempelkarte-40682**) ist die
**Gmail API** aktiviert und unter *Google Auth Platform → Datenzugriff* der Bereich `…/auth/gmail.readonly` eingetragen.

1. **APIs & Dienste → Anmeldedaten** → OAuth-2.0-Client **„Web client (auto created by Google Service)“** öffnen
   (oder *+ Anmeldedaten erstellen → OAuth-Client-ID → Webanwendung*, Name „Stempelkarte Server“).
2. Unter **Autorisierte Weiterleitungs-URIs** → *+ URI hinzufügen* →
   `https://stempelkarte-mcp.lippa-florian.workers.dev/gmail/callback` → **Speichern**.
3. **Client-ID** und **Clientschlüssel** kopieren (zeigt Google keinen Schlüssel mehr an: *Secret hinzufügen*) und als
   GitHub-Secrets anlegen (Repository → Settings → Secrets and variables → Actions):
   `GOOGLE_OAUTH_CLIENT_ID` und `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Secret **`GMAIL_ENC_KEY`** anlegen: beliebiger Zufallstext mit **40+ Zeichen**, z. B. aus
   `openssl rand -base64 48`. Nicht mehr ändern – sonst muss Gmail neu verbunden werden.
5. **Actions → „MCP-Connector veröffentlichen“ → Run workflow** (überträgt die Secrets, richtet den täglichen Zeitplan ein).
6. In der App: **Alltag › Geld › Abos → „Gmail dauerhaft verbinden“** → bei Google `lippa.florian@gmail.com` wählen,
   „Google hat diese App nicht überprüft“ → *Erweitert* → *Weiter*, **Häkchen bei „E-Mails ansehen“** setzen → Weiter.
   Es erscheint „Gmail dauerhaft verbunden ✓“; die erste Prüfung läuft sofort.

**Wichtig (UNSICHER, Google-Regel):** Steht die App unter *Google Auth Platform → Zielgruppe* auf **„Testen“**, laufen
Refresh-Tokens nach **7 Tagen** ab. Für eine dauerhafte Verbindung dort **„App veröffentlichen“** (In Produktion)
wählen – für den eigenen Gebrauch bleibt nur der Warnhinweis „nicht überprüft“. Läuft die Freigabe trotzdem ab
(`invalid_grant`), legt der Server einmalig die Aufgabe **„Gmail neu verbinden“** im Planer an.

### Was passiert

- `POST /gmail/start` (Firebase-ID-Token) → `{url}`: zufälliger `state` (nur als Hash, 15 Minuten) in
  `users/{uid}/meta/gmail_pending`; Google-URL mit `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`,
  `login_hint`. Weiterleitungs-Adresse per Var `GMAIL_REDIRECT_URL` änderbar.
- `GET /gmail/callback?code&state` (ohne Anmeldung, der `state` ist der Nachweis): Code tauschen, prüfen, dass
  `gmail.readonly` gewährt wurde (sonst Seite „Häkchen fehlt“, Freigabe wird zurückgezogen) und das Postfach
  `lippa.florian@gmail.com` ist (`users/me/profile`); Refresh-Token verschlüsselt speichern, kleine HTML-Seite mit Link zurück.
- `GET /gmail/status`, `POST /gmail/scan` („Jetzt prüfen“), `POST /gmail/disconnect` (Widerruf bei
  `oauth2.googleapis.com/revoke`, Schlüssel löschen).
- Zugriffstokens nur im Speicher (≈ 55 Minuten). Tokens, Codes und Mail-Inhalte werden nie protokolliert oder gespeichert.
- **Täglicher Scan** (`"30 6 * * *"`): dieselbe Suche wie im Browser, ab letztem Scan − 1 Tag (`after:`), höchstens 100 Mails,
  je 3 gleichzeitig (`format=full`), bei 429/5xx/403 „quota/rateLimit“ mit wachsenden Pausen. Ausgewertet mit
  `js/alltag/subs-detect.js` (gemeinsame Datei). Gespeichert werden **nur** die erkannten Felder + Mail-ID/Datum/Betreff
  (≤ 120 Zeichen) in `users/{uid}/a_money_gmail/meta.serverDets` – die App zeigt sie wie gewohnt als
  „Neues Abo erkannt“, „Preis geändert“, „Gekündigt erkannt“, „Testzeitraum endet“ (Übernehmen/Ignorieren wie bisher, `handled`).
- UNSICHER: Auf dem kostenlosen Workers-Plan gilt ein knappes CPU-Limit je Aufruf; 100 Mails auszuwerten sollte reichen,
  ist aber nicht am echten Konto gemessen.

## Entwicklung

```bash
cd tools/mcp
npm install
npm test                                   # node --test, Firestore/Google/Anthropic werden simuliert
npx wrangler deploy --dry-run --outdir dist   # Bündeln prüfen
npx wrangler dev                           # lokal; Secrets in .dev.vars (nicht einchecken!)
```

Die Tests vergleichen die Ergebnisse mit dem echten Code der Web-App (`js/timer.js`, `js/util.js`,
`js/views/overview.js`, `js/views/report.js`): Stempel-Ablauf, Überstundenkonto, Feiertage, Berichtsheft.

**Wichtig:** Ändert sich in der App die Logik (Zeitberechnung, Datenformen, Alltag-Kategorien), bitte
`src/logic.js` bzw. `src/money.js` nachziehen – die Tests schlagen dann meist von selbst an.
Gemeinsam (keine Kopie, von wrangler mitgebündelt, im Deploy-Workflow als Pfad eingetragen): `js/cal-core.js`,
`js/travel.js` + `js/trip-core.js` (Fahrtenbuch/Taggeld), `js/alltag/unterwegs-core.js`, `js/gallery-core.js`,
`js/alltag/money-core.js` (Teilen/Sparziele), `js/alltag/material-core.js`, `js/alltag/subs-*.js`, `js/privat-core.js`,
`js/alltag/trash-core.js`.

## Sicherheit & Datenschutz

- Kein Geheimnis im Code – alles kommt aus Cloudflare-Secrets. Das Repo ist öffentlich, das ist so in Ordnung.
- Das Token wird in konstanter Zeit verglichen; ohne gesetztes `STEMPEL_TOKEN` (mind. 16 Zeichen) wird alles abgelehnt.
- Protokolliert wird nur der Werkzeugname, keine Inhalte. Cloudflare-Observability ist ausgeschaltet.
- Claude bekommt nie Bilddaten: Fotos/Dokumente werden nur über Feldmasken (ohne `thumb`/`data`) gelesen, der Tresor gar nicht.
  Geheimnisse (iCal-Adressen, Bank-Sitzung, PIN, API-Schlüssel) tauchen in keiner Werkzeug-Antwort auf (Tests prüfen das).
- Das Dienstkonto hat Vollzugriff auf Firestore – den Schlüssel nie weitergeben.
- Gmail: Refresh-Token nur AES-256-GCM-verschlüsselt (an die UID gebunden), `GMAIL_ENC_KEY` nur als Secret. Mail-Inhalte
  werden nicht gespeichert; der Assistent liest Mails nur auf Nachfrage und behandelt sie als Daten, nicht als Anweisungen.
- Variante mit `?key=` in der URL: Die URL ist dann selbst das Passwort – nicht teilen, nicht in Screenshots zeigen.
