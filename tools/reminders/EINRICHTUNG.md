# Erinnerungen per Push – Einrichtung (2 Schritte)

Bis beides erledigt ist, zeigt die App unter „Einstellungen → Erinnerungen“ nur
„Wird noch eingerichtet“ und der GitHub-Job beendet sich ohne Fehler.

1. **VAPID-Schlüssel (Web-Push-Zertifikat) erzeugen → Claude trägt ihn ein**
   Firebase-Konsole → Projekt *stempelkarte-40682* → Zahnrad → Projekteinstellungen →
   Reiter **Cloud Messaging** → ganz unten „Web-Konfiguration“ → **Web-Push-Zertifikate** →
   „Schlüsselpaar generieren“. Den angezeigten Schlüssel (beginnt meist mit „B…“) an Claude
   schicken – er kommt in `js/firebase-config.js` als `vapidKey`.
   (Der Schlüssel ist öffentlich, das ist unbedenklich.)

2. **Dienstkonto-Schlüssel als GitHub-Secret hinterlegen (machst du selbst)**
   Firebase-Konsole → Projekteinstellungen → Reiter **Dienstkonten** →
   „Neuen privaten Schlüssel generieren“ → JSON-Datei wird heruntergeladen.
   Auf GitHub im Repository: **Settings → Secrets and variables → Actions → New repository secret**,
   Name `FIREBASE_SERVICE_ACCOUNT`, Wert = kompletter Inhalt der JSON-Datei. Speichern.
   Die Datei danach löschen und **niemandem schicken** (auch nicht Claude) – sie ist ein Generalschlüssel.

Danach in der App (angemeldet) unter Einstellungen → Erinnerungen auf
„Benachrichtigungen erlauben“ tippen. Am iPhone geht das nur, wenn die App über
„Zum Home-Bildschirm“ installiert ist (iOS 16.4+). Test: auf GitHub unter **Actions → Erinnerungen →
Run workflow** einen Lauf von Hand starten.
