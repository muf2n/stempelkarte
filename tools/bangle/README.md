# Stempelkarte auf der Bangle.js 2

Uhr kaufen: https://shop.espruino.com/banglejs2

## Einrichten (am Handy, Chrome unter Android)
1. Übersicht → Einstellungen → **Uhr (Bangle.js 2)** → „Uhr verbinden“ und die Bangle aus der Liste wählen.
   Ist die Uhr mit Gadgetbridge o. Ä. verbunden, dort kurz trennen (nur eine Verbindung gleichzeitig).
   In den Uhr-Einstellungen muss unter Bluetooth „Programmable“ an sein.
2. „Stempelkarte-App auf die Uhr spielen“ (ca. 1 Minute). Die Uhr startet danach kurz neu.
3. Auf der Uhr die App **Stempelkarte** öffnen.

## Dateien auf der Uhr
| Datei | Inhalt |
|---|---|
| `stempel.app.js` | App (aus `stempelkarte.app.js`): Uhrzeit, Status, Arbeitszeit, Schritte, Höhenmeter, Touch-Knöpfe |
| `stempel.boot.js` | Hintergrund (aus `stempelkarte.boot.js`): Barometer alle 60 s kurz an, Höhenmeter mit 3-m-Hysterese |
| `stempel.img`, `stempel.info` | Symbol und Launcher-Eintrag |
| `stempel.queue.json` | Warteschlange `[{t, a:"in"\|"pause"\|"resume"\|"act"\|"out", v}]` – das Handy holt sie ab und leert sie |
| `stempel.state.json` | Zustand vom Handy `{start, p, pm, act, done, dk, at}` |
| `stempel.days.json` | Höhenmeter je Tag `{"YYYY-MM-DD": {u, d}}`, max. 30 Tage |

Schritte und Puls kommen aus der Health-App der Uhr (`require("health")`).

## Abgleich (js/watch.js)
Web Bluetooth → Nordic UART → Espruino-REPL. Jeder Befehl ist `\x10` + JS + `\n`, die Antwort eine Zeile
`{"sk":id,"r":…}`. Reihenfolge: Uhrzeit/Warteschlange lesen (Uhrzeit stellen, wenn > 1 min daneben) →
Ereignisse mit Original-Zeit anwenden (lock-core.js) → Warteschlange leeren → 14 Tage Schritte/Puls/Höhenmeter
→ `store.saveDay` → Zustand an die Uhr.

## Tests
Ohne echte Uhr getestet (node): reine Funktionen beider Uhr-Dateien, die App im Grafik-Mock und `js/watch.js`
gegen eine simulierte Uhr (UART-Mock, Befehle laufen in `vm`). Auf echter Hardware noch nicht geprüft.
