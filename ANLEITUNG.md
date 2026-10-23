# Stempelkarte – Anleitung zum Einrichten

Diese Anleitung führt dich Schritt für Schritt zu deiner eigenen Arbeitszeit-App.
Du musst **nicht programmieren können**. Du kopierst nur ein paar Werte und klickst dich durch zwei Webseiten.

> **Tipp:** Die Webseiten von Firebase und GitHub sehen manchmal leicht anders aus als hier beschrieben,
> oder sind auf Englisch statt Deutsch. Die Knöpfe heißen dann ähnlich. Wo es hilft, steht der
> englische Text in Klammern dahinter, z. B. „Projekt erstellen“ (*Create project*).

---

## 1. Was du bekommst – und was du brauchst

**Du bekommst:**
- Eine App für Handy und PC, mit der du dich ein- und ausstempelst, Pausen machst und deine Stunden siehst.
- Deine Daten werden automatisch zwischen Handy und PC abgeglichen.
- Die App merkt sich beim Stempeln deinen Standort und erkennt deine Arbeitsorte.

**Du brauchst:**
- ein **Google-Konto** (z. B. deine Gmail-Adresse),
- ein **GitHub-Konto** (kostenlos, legen wir unten an),
- einen **PC mit Browser** (Chrome, Edge oder Firefox) und den **entpackten Ordner „stempelkarte“**,
- ungefähr **20–30 Minuten**.

**Zwei Begriffe kurz erklärt:**
- **Firebase** = ein kostenloser Dienst von Google. Dort werden deine Arbeitszeiten sicher gespeichert, und dort meldest du dich an.
- **GitHub** = eine Webseite, auf der du die App-Dateien ablegst. GitHub stellt die App dann als Internetseite bereit („GitHub Pages“).

---

## 2. Firebase-Projekt anlegen

1. Öffne **https://console.firebase.google.com** und melde dich mit deinem Google-Konto an.
2. Klicke auf **„Projekt erstellen“** bzw. **„Firebase-Projekt erstellen“** (*Create a project* / *Get started*).
3. Gib als Namen **stempelkarte** ein. Bedingungen ggf. anhaken → **„Weiter“** (*Continue*).
4. Falls nach **Gemini / KI-Unterstützung** gefragt wird: einfach ausgeschaltet lassen → **„Weiter“**.
5. Bei **Google Analytics**: den Schalter **ausschalten** → **„Projekt erstellen“** (*Create project*).
6. Kurz warten, dann **„Weiter“** (*Continue*). Du landest in der **Projektübersicht**.

---

## 3. Web-App registrieren und Werte kopieren

1. In der Projektübersicht siehst du runde Symbole. Klicke auf das Symbol **`</>`** (Web).
   *(Wenn du es nicht siehst: oben links auf das Zahnrad ⚙ → „Projekteinstellungen“ → ganz unten bei „Meine Apps“ auf `</>` klicken.)*
2. Als App-Namen **Stempelkarte** eingeben. Das Häkchen bei **„Firebase Hosting“ NICHT** setzen.
3. **„App registrieren“** (*Register app*) klicken.
4. Jetzt erscheint ein Kasten mit Text, der so ähnlich aussieht:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyB1c2D3e4F5g6H7i8J9k0LmNoPqRsTuVwX",
     authDomain: "stempelkarte-1a2b3.firebaseapp.com",
     projectId: "stempelkarte-1a2b3",
     storageBucket: "stempelkarte-1a2b3.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456"
   };
   ```
5. **Lass dieses Fenster offen** oder kopiere den Kasten in ein leeres Textdokument (Editor/Notepad). Du brauchst die Werte in Schritt 6.
6. Klicke **„Weiter zur Konsole“** (*Continue to console*).

> Du findest die Werte jederzeit wieder unter: Zahnrad ⚙ → **„Projekteinstellungen“** → unten bei **„Meine Apps“**.

---

## 4. Anmeldung mit Google einschalten

1. Links im Menü: **„Authentication“** (evtl. erst unter **„Build“ / „Erstellen“** oder **„Sicherheit“** aufklappen).
2. Klicke **„Los geht's“** (*Get started*), falls der Knopf erscheint.
3. Oben den Reiter **„Sign-in method“** (*Anmeldemethode*) wählen.
4. In der Liste auf **„Google“** klicken.
5. Schalter **„Aktivieren“** (*Enable*) einschalten.
6. Bei **„Support-E-Mail-Adresse für das Projekt“** deine E-Mail-Adresse auswählen.
7. **„Speichern“** (*Save*). Neben „Google“ steht jetzt „Aktiviert“.

---

## 5. Datenbank (Firestore) anlegen und absichern

1. Links im Menü: **„Firestore Database“** (evtl. unter **„Build“ / „Erstellen“** oder **„Datenbanken & Speicher“**).
2. **„Datenbank erstellen“** (*Create database*) klicken.
3. Falls nach einer **Edition** gefragt wird: **„Standard“** wählen → **„Weiter“**.
4. Falls nach einer **Datenbank-ID** gefragt wird: **„(default)“** so lassen.
5. **Standort** wählen: **`europe-west3 (Frankfurt)`** – oder **`eur3 (Europe)`**. → **„Weiter“**.
   ⚠️ Der Standort lässt sich später nicht mehr ändern.
6. **„Im Produktionsmodus starten“** (*Start in production mode*) wählen → **„Erstellen“** (*Create*).
7. Wenn die Datenbank fertig ist, oben den Reiter **„Regeln“** (*Rules*) anklicken.
8. Öffne auf deinem PC im Ordner „stempelkarte“ die Datei **`firestore.rules`** mit dem Editor
   (Rechtsklick → „Öffnen mit“ → „Editor“ bzw. „TextEdit“). Alles markieren (**Strg + A**, am Mac **Cmd + A**) und kopieren (**Strg + C**).
9. Zurück in Firebase: im Regeln-Textfeld **alles markieren und löschen**, dann deinen kopierten Text einfügen (**Strg + V**).
10. **„Veröffentlichen“** (*Publish*) klicken.

> Diese Regeln sorgen dafür, dass **nur du** die App nutzen kannst: Erlaubt ist ausschließlich das Google-Konto **lippa.florian@gmail.com**. Meldet sich jemand anderes an, sieht er nichts und kann nichts speichern.
> Willst du ein anderes Konto verwenden, ändere die E-Mail-Adresse in `firestore.rules` (Zeile mit `email in [...]`) und veröffentliche die Regeln erneut.

---

## 6. Deine Werte in die App eintragen (`firebase-config.js`)

1. Öffne im Ordner „stempelkarte“ den Unterordner **`js`** und dort die Datei **`firebase-config.js`** mit dem Editor.
2. Suche diesen Abschnitt:
   ```js
   export const firebaseConfig = {
     apiKey: "DEIN_API_KEY",
     authDomain: "DEIN_PROJEKT.firebaseapp.com",
     projectId: "DEIN_PROJEKT",
     storageBucket: "DEIN_PROJEKT.appspot.com",
     messagingSenderId: "…",
     appId: "…",
   };
   ```
3. Ersetze in **jeder der sechs Zeilen** nur den Text **zwischen den Anführungszeichen** durch deinen Wert aus Schritt 3.
   Die Anführungszeichen `"` und das Komma am Ende bleiben stehen!
4. Fertig sieht es z. B. so aus:
   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSyB1c2D3e4F5g6H7i8J9k0LmNoPqRsTuVwX",
     authDomain: "stempelkarte-1a2b3.firebaseapp.com",
     projectId: "stempelkarte-1a2b3",
     storageBucket: "stempelkarte-1a2b3.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456",
   };
   ```
5. **Speichern** (Strg + S). Achte darauf, dass der Dateiname **`firebase-config.js`** bleibt (nicht `.txt`).

> **Ist das geheim?** Nein. Diese Werte sind nur die „Adresse“ deines Firebase-Projekts und dürfen öffentlich sein.
> Geschützt werden deine Daten durch die Regeln aus Schritt 5 und die Google-Anmeldung.

---

## 7. Dateien auf GitHub hochladen

1. Öffne **https://github.com**. Noch kein Konto? **„Sign up“** klicken und den Anweisungen folgen.
   Merke dir deinen **Benutzernamen** – er kommt später in die App-Adresse.
2. Angemeldet: oben rechts auf **„+“** → **„New repository“** (*Neues Repository* = ein Ablage-Ordner auf GitHub).
3. Bei **„Repository name“** genau **`stempelkarte`** eintragen (klein geschrieben).
4. **„Public“** (öffentlich) auswählen. Sonst nichts ankreuzen.
5. Unten **„Create repository“** klicken.
6. Auf der nächsten Seite den Link **„uploading an existing file“** anklicken
   (steht im Satz „…or create a new file or **upload an existing file**“).
7. Öffne auf deinem PC den Ordner **„stempelkarte“**, sodass du **seinen Inhalt** siehst (`index.html`, `sw.js`, Ordner `js`, `css`, `icons` …).
8. Markiere dort **alles** (Strg + A) und **ziehe es mit der Maus** in das GitHub-Fenster auf die Fläche „Drag files here“.
   - ✅ Richtig: den **Inhalt** des Ordners hineinziehen.
   - ❌ Falsch: den Ordner „stempelkarte“ selbst hineinziehen (dann liegt alles eine Ebene zu tief und die Seite zeigt „404“).
   - Die Unterordner (`js`, `js/views`, `css`, `icons`) müssen erhalten bleiben – beim Ziehen klappt das automatisch
     (am besten mit Chrome oder Edge).
9. Warte, bis alle Dateien in der Liste erscheinen. Prüfe kurz, ob `index.html` und der Ordner `js` dabei sind.
10. Unten auf den grünen Knopf **„Commit changes“** (*Änderungen speichern*) klicken.

---

## 8. GitHub Pages einschalten (App ins Internet stellen)

1. In deinem Repository oben auf **„Settings“** (Zahnrad) klicken.
2. Links im Menü **„Pages“** anklicken.
3. Bei **„Source“** → **„Deploy from a branch“** auswählen.
4. Bei **„Branch“** → **`main`** und daneben **`/ (root)`** auswählen → **„Save“**.
5. **1–2 Minuten warten**, dann die Seite neu laden. Oben erscheint: „Your site is live at …“.
6. Deine App-Adresse lautet:
   **`https://BENUTZERNAME.github.io/stempelkarte/`**
   (statt BENUTZERNAME deinen GitHub-Benutzernamen, z. B. `https://maxmuster.github.io/stempelkarte/`).

---

## 9. Deine Adresse bei Firebase freigeben

Damit die Google-Anmeldung auf deiner Seite funktioniert, musst du Firebase sagen, dass deine Adresse erlaubt ist.

1. Zurück zu **https://console.firebase.google.com** → dein Projekt.
2. Links **„Authentication“** → oben den Reiter **„Einstellungen“** (*Settings*).
3. Links bzw. in der Liste **„Autorisierte Domains“** (*Authorized domains*) wählen.
4. **„Domain hinzufügen“** (*Add domain*) klicken.
5. Eintragen: **`BENUTZERNAME.github.io`** (nur das – **ohne** `https://` und **ohne** `/stempelkarte/`).
6. **„Hinzufügen“** (*Add*) klicken.

---

## 10. Am Handy einrichten

1. Öffne am Handy die Adresse **`https://BENUTZERNAME.github.io/stempelkarte/`**
   – am **iPhone mit Safari**, am **Android-Handy mit Chrome**.
2. Tippe **„Mit Google anmelden“** und wähle dein Google-Konto.
3. Wenn die App nach dem **Standort** fragt: **„Erlauben“** tippen.
4. Als App auf den Startbildschirm legen:
   - **iPhone (Safari):** unten auf das **Teilen-Symbol** (Quadrat mit Pfeil nach oben) → nach unten scrollen → **„Zum Home-Bildschirm“** → **„Hinzufügen“**.
   - **Android (Chrome):** oben rechts auf **⋮** (drei Punkte) → **„App installieren“** oder **„Zum Startbildschirm hinzufügen“** → bestätigen.
5. Ab jetzt öffnest du die Stempelkarte einfach über das neue Symbol auf deinem Startbildschirm.

---

## 11. Am PC nachschauen

1. Öffne am PC im Browser **dieselbe Adresse**.
2. Melde dich mit **demselben Google-Konto** an wie am Handy.
3. Du siehst dieselben Einträge. Änderungen am einen Gerät erscheinen nach wenigen Sekunden am anderen.

---

## 12. So funktioniert der Standort

- Der Standort wird **genau einmal beim Einstempeln** und **einmal beim Ausstempeln** erfasst – und nur, solange die App geöffnet ist.
- Es gibt **kein Verfolgen im Hintergrund**. Das können Web-Apps technisch nicht, und es ist auch nicht gewollt.
- **Arbeitsorte anlegen:** Stell dich an deinen Arbeitsort, öffne den Reiter **„Orte“** und tippe
  **„Aktuellen Standort als Ort speichern“**. Namen eingeben (z. B. „Baustelle Linz“) → Speichern.
- Ab dann erkennt die App den Ort beim Einstempeln **automatisch**.
- Der **Radius** (z. B. 150 m) legt fest, wie nah du sein musst, damit der Ort erkannt wird. Du kannst ihn pro Ort mit dem Schieberegler ändern.
- Ausschalten kannst du die Standorterfassung im Reiter **„Übersicht“** → „Standort beim Stempeln erfassen“.

---

## 13. Änderungen und Updates

Wenn du eine neue Version einer Datei bekommst:

1. Auf GitHub in dein Repository **stempelkarte** gehen.
2. **„Add file“** → **„Upload files“** klicken.
3. Die neue Datei hineinziehen. Liegt sie in einem Unterordner (z. B. `js`), öffne vorher auf GitHub diesen Ordner und lade sie dort hoch –
   oder ziehe wie in Schritt 7 den **ganzen Inhalt** des neuen Ordners hinein (gleichnamige Dateien werden ersetzt).
4. **„Commit changes“** klicken.
5. 1–2 Minuten warten. Dann die App am Handy **schließen und neu öffnen – ggf. zweimal**, damit die neue Version geladen wird.

> Achtung: Wenn du die Datei `js/firebase-config.js` ersetzt, müssen deine Werte aus Schritt 6 wieder drinstehen.

---

## 14. Probleme & Lösungen

| Problem | Lösung |
|---|---|
| **Anmeldefenster geht nicht auf** oder Meldung **„unauthorized domain“** | Schritt 9 prüfen: Steht `BENUTZERNAME.github.io` bei den autorisierten Domains? Genau so geschrieben, ohne `https://`? Außerdem Schritt 4: Ist Google als Anmeldung aktiviert? Pop-up-Blocker im Browser ggf. für die Seite ausschalten. |
| **Standort wird blockiert** (iPhone) | **Einstellungen** → **Datenschutz & Sicherheit** → **Ortungsdienste** → einschalten → **Safari-Websites** → **„Beim Verwenden der App“** wählen. Danach die App neu öffnen. |
| **Standort wird blockiert** (Android) | **Chrome** öffnen → **⋮** → **Einstellungen** → **Website-Einstellungen** → **Standort** → deine Seite auf **„Zulassen“** stellen. Auch prüfen, ob der Standort am Handy überhaupt eingeschaltet ist. |
| **Seite zeigt „404“** | Noch 2–3 Minuten warten (GitHub Pages braucht etwas). Sonst prüfen: Liegt `index.html` auf GitHub **direkt** im Repository und nicht in einem Unterordner „stempelkarte“? Falls doch: Dateien neu hochladen wie in Schritt 7 (Inhalt, nicht den Ordner). Und Schritt 8 prüfen (Branch `main`, `/ (root)`). |
| **Daten erscheinen am PC nicht** | Am PC und Handy mit **demselben Google-Konto** angemeldet? (Siehe Reiter „Übersicht“ → Konto.) Beide Geräte mit dem Internet verbunden? Seite einmal neu laden. |
| **Oben steht „Nur dieses Gerät“** | Die Datei `js/firebase-config.js` ist noch nicht ausgefüllt (es steht noch „DEIN_…“ drin) oder die ausgefüllte Version wurde nicht auf GitHub hochgeladen. Schritt 6 und 13 wiederholen. |
| **Oben steht „Offline“** | Das Handy hat gerade kein Internet. Du kannst trotzdem stempeln – die Daten werden nachgeschickt, sobald wieder Netz da ist. |

---

## 15. Kosten

- **Firebase:** Der Tarif **„Spark“** ist **kostenlos**. Für eine Person bleibst du weit unter den Grenzen.
  Du musst **keine Kreditkarte** hinterlegen.
- **GitHub Pages:** **kostenlos**.
- **Gut zu wissen:** Dein Repository ist öffentlich. Das heißt, **der Programmcode** ist für andere sichtbar –
  **deine Arbeitszeiten aber NICHT**. Die liegen geschützt in Firebase, und nur du kommst mit deinem Google-Konto daran.
