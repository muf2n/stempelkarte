# Stempelkarte als Claude-Connector (MCP-Server)

Mit diesem kleinen Server kannst du in deinem normalen Claude-Chat (claude.ai, Handy-App) direkt mit der
Stempelkarte reden: „Bin ich eingestempelt?“, „Stempel mich auf der Baustelle Huber ein“, „Mach mir aus
letzter Woche einen Berichtsheft-Text“, „Trag 12,50 € Billa ein“, „Was steht nächste Woche an?“ …

Er läuft kostenlos als **Cloudflare Worker** und liest/schreibt dieselben Firestore-Daten wie die Web-App
(`users/{uid}/…`) – mit demselben Dienstkonto wie die Push-Erinnerungen. Zusätzlich gibt es den Endpunkt
`/chat` für einen Assistenten direkt in der App.

## Was Claude damit kann

| Werkzeug | Was es macht |
|---|---|
| `status_heute` | eingestempelt? seit wann, Ort, Abschnitt, Pause, heutige Stunden, Woche Ist/Soll, Überstundenkonto, Modus Arbeit/Privat |
| `modus_setzen` | Privat / Arbeit umschalten (`modus`: "privat" \| "arbeit", optional `bis`: "1h", "abend", "morgen", HH:MM) – eingestempelt wird nicht umgeschaltet |
| `eintraege_lesen` | Arbeitszeiten im Zeitraum (Zeiten, Ort, Abschnitte, Personen, Notizen, Urlaub/Krank …) |
| `wochen_zusammenfassung` | Daten fürs Berichtsheft (wie die Berichtsheft-Ansicht der App) |
| `einstempeln`, `ausstempeln`, `pause`, `abschnitt_wechseln` | Stempeluhr – gleiche Logik wie die App (`js/timer.js`) |
| `eintrag_nachtragen` | vergessene Arbeitszeit, Urlaub, Krank, Zeitausgleich, Schule (auch Zeiträume) |
| `orte_lesen` | gespeicherte Orte |
| `todos_lesen`, `todo_anlegen`, `termin_anlegen`, `einsatz_anlegen`, `todo_erledigt`, `planer_lesen` | Planer |
| `geld_lesen`, `ausgabe_eintragen` | Alltag → Geld |
| `schule_lesen`, `hausaufgabe_anlegen`, `pruefung_anlegen` | Alltag → Schule & Lernen |

**Löschen geht absichtlich nicht.** Alles, was Claude anlegt, bekommt das Feld `src: "claude"`.

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
- **Erlaubte Herkunft (CORS):** `https://muf2n.github.io`, `http://localhost:<port>`, `http://127.0.0.1:<port>`
- **Body:** `{"messages":[{"role":"user","content":"Bin ich eingestempelt?"}, …]}` – ganzer Verlauf,
  abwechselnd `user`/`assistant`, nur Text, letzte Nachricht vom Nutzer, max. 40 Nachrichten / 40.000 Zeichen.
- **Antwort 200:** `{"reply":"…","actions":["einstempeln"],"usage":{"month":"2026-11","inTok":…,"outTok":…,"usd":…,"capUsd":3}}`
  – `actions` = verwendete Schreib-Werkzeuge (App sollte danach ggf. neu laden; Firestore-Listener tun das ohnehin).
- **Fehler:** JSON `{"error":"…"}` mit deutschem Text – 400 (ungültige Nachrichten), 401 (Token fehlt/ungültig/
  falsches Konto), 403 (fremde Herkunft), 413 (Verlauf zu lang), 429 (Monatsbudget aufgebraucht, zusätzlich
  `reply` mit freundlichem Text), 502 (KI-Dienst nicht erreichbar), 503 (nicht eingerichtet).
- Geprüft wird: Signatur gegen Googles securetoken-Schlüssel, `aud`/`iss` = Projekt `stempelkarte-40682`,
  `exp`, E-Mail = `lippa.florian@gmail.com` und `email_verified`. Die UID kommt aus dem Token.
- **Kostendeckel:** Verbrauch pro Monat in `users/{uid}/meta/ai_usage` (`month, inTok, outTok, usd`);
  über `AI_MONTHLY_USD` (Standard 3 $) wird abgelehnt. Modell über `CLAUDE_MODEL` (Standard `claude-haiku-4-5`,
  geschätzt 1 $ / 5 $ pro Mio. Eingabe-/Ausgabe-Tokens). Beides lässt sich als Variable in `wrangler.toml`
  (`[vars]`) ändern.

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

## Sicherheit & Datenschutz

- Kein Geheimnis im Code – alles kommt aus Cloudflare-Secrets. Das Repo ist öffentlich, das ist so in Ordnung.
- Das Token wird in konstanter Zeit verglichen; ohne gesetztes `STEMPEL_TOKEN` (mind. 16 Zeichen) wird alles abgelehnt.
- Protokolliert wird nur der Werkzeugname, keine Inhalte. Cloudflare-Observability ist ausgeschaltet.
- Das Dienstkonto hat Vollzugriff auf Firestore – den Schlüssel nie weitergeben.
- Variante mit `?key=` in der URL: Die URL ist dann selbst das Passwort – nicht teilen, nicht in Screenshots zeigen.
