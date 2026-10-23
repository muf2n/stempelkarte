// Firebase-Zugangsdaten der App und Prüfung, ob sie schon eingetragen sind.
//
// SO TRÄGST DU DEINE WERTE EIN:
// 1. Öffne https://console.firebase.google.com und wähle dein Projekt.
// 2. Zahnrad (Projekteinstellungen) → „Allgemein“ → unten bei „Meine Apps“ deine Web-App (</>) auswählen.
// 3. Dort steht ein Block „const firebaseConfig = { … }“.
// 4. Kopiere die Werte (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId)
//    und ersetze unten die Platzhalter. Die Anführungszeichen bleiben stehen!
// Solange hier noch „DEIN_…“ steht, läuft die App nur lokal auf diesem Gerät (ohne Sync).

export const firebaseConfig = {
  apiKey: "AIzaSyAUELkAEbK5GKLl3X-PyOI6JFZjqGoUw1w",
  authDomain: "stempelkarte-40682.firebaseapp.com",
  projectId: "stempelkarte-40682",
  storageBucket: "stempelkarte-40682.firebasestorage.app",
  messagingSenderId: "902289522163",
  appId: "1:902289522163:web:86503d91a4de36d3152686",
};

// Web-Push-Zertifikat (VAPID, öffentlicher Schlüssel) für Erinnerungen per Benachrichtigung.
// Firebase-Konsole → Projekteinstellungen → Cloud Messaging → Web-Push-Zertifikate → „Schlüsselpaar generieren“.
// Leer = Erinnerungen werden in der App als „wird noch eingerichtet“ angezeigt.
export const vapidKey = "";

// false, solange apiKey leer ist oder noch mit "DEIN" beginnt
export function isConfigured() {
  const k = (firebaseConfig.apiKey || "").trim();
  return k !== "" && !k.startsWith("DEIN");
}
