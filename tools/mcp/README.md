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
| `status_heute` | eingestempelt? seit wann, Ort, Abschnitt, Pause, heutige Stunden, Woche Ist/Soll, Überstundenkonto |
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
