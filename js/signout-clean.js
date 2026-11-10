// L3 (Audit 2): Beim Abmelden private Daten von diesem Gerät entfernen – das Familienkonto kann sich auf demselben
// Gerät anmelden. Gerätebezogene Einstellungen (Akzentfarbe, Tabs, Ansichten, Stimme, Server-Adresse …) bleiben.
// Der lokale Modus ist NICHT betroffen (dessen Daten liegen absichtlich nur auf dem Gerät).

/** localStorage-Schlüssel mit privaten Inhalten (Antworten, Tokens, Orte, Verlauf). */
export const PRIVATE_KEYS = [
  "stempelkarte.ai.history",   // Claude-Chatverlauf (inkl. Geld-/Mail-Antworten, Foto-Vorschauen)
  "sk-jp-sensei",              // Japanisch-Sensei-Verlauf
  "sk-weather", "sk-weather-cache", // Wetter: Standort + Vorhersage
  "sk-brief-morning", "sk-brief-week", // Briefing-Stand
  "sk-search-recent",          // letzte Suchen
  "stempelkarte.geocache",     // nachgeschlagene Adressen
  "stempelkarte.gmail.tok", "stempelkarte.gmail.server", "stempelkarte.gmail.hint", // Gmail-Zugriff
  "stempelkarte.gcal.tok", "stempelkarte.gcal.ids", "stempelkarte.gcal.v1", "stempelkarte.gcalConnected", // Google-Kalender-Zugriff + Kopie
  "stempelkarte.bank.status", "stempelkarte.bank.flash", // Bank-Status
  "sk-karte-recent", "sk-karte-geo", // Karte & Route: letzte Ziele + gesuchte Adressen
];
/** Präfixe: Kalender-Abo-Kopien des Cloud-Kontos (Schlüssel enthalten "cloud:<uid>"). */
const PRIVATE_PREFIXES = ["stempelkarte.ical.list.cloud:", "stempelkarte.ical.data.cloud:"];
/** sessionStorage: Entsperr-Sitzungen (Geld-Sperre). Fehlversuch-Zähler bleiben absichtlich. */
const SESSION_KEYS = ["sk-money-lock-sess"];

/** Entfernt die Schlüssel synchron. → Liste der entfernten Schlüssel (für Tests). */
export function clearPrivateStorage(ls = globalThis.localStorage, ss = globalThis.sessionStorage) {
  const removed = [];
  try {
    for (const k of PRIVATE_KEYS) if (ls.getItem(k) != null) { ls.removeItem(k); removed.push(k); }
    const all = [];
    for (let i = 0; i < ls.length; i++) all.push(ls.key(i));
    for (const k of all) if (k && PRIVATE_PREFIXES.some((p) => k.startsWith(p))) { ls.removeItem(k); removed.push(k); }
  } catch { /* Speicher gesperrt – egal */ }
  try { for (const k of SESSION_KEYS) if (ss.getItem(k) != null) { ss.removeItem(k); removed.push(k); } } catch { /* egal */ }
  return removed;
}

/** Kalender-Abo-Daten des Cloud-Kontos aus IndexedDB „stempelkarte-ical“ entfernen (lokale bleiben). */
function clearIcalIdb() {
  return new Promise((ok) => {
    try {
      if (typeof indexedDB === "undefined") { ok(); return; }
      const r = indexedDB.open("stempelkarte-ical", 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore("data"); } catch { /* egal */ } };
      r.onerror = r.onblocked = () => ok();
      r.onsuccess = () => {
        const db = r.result;
        try {
          const tx = db.transaction("data", "readwrite");
          const st = tx.objectStore("data");
          const q = st.getAllKeys();
          q.onsuccess = () => { for (const k of q.result || []) if (String(k).startsWith("cloud:")) st.delete(k); };
          tx.oncomplete = tx.onerror = tx.onabort = () => { db.close(); ok(); };
        } catch { db.close(); ok(); }
      };
    } catch { ok(); }
  });
}

/**
 * Alles Private vom Gerät entfernen (nach dem Abmelden eines Google-Kontos).
 * fb: {fs, db} aus getFirebase() – dann wird auch der Firestore-Offline-Cache geleert (danach muss die Seite neu laden).
 * → { cleared: string[], firestoreCleared: boolean }
 */
export async function clearPrivateDeviceData(fb = null) {
  const cleared = clearPrivateStorage();
  await clearIcalIdb();
  try {
    const V = await import("./alltag/vault-session.js");
    V.lock("signout");
  } catch { /* egal */ }
  let firestoreCleared = false;
  if (fb && fb.fs && fb.db && typeof fb.fs.clearIndexedDbPersistence === "function") {
    try {
      await fb.fs.terminate(fb.db);
      await fb.fs.clearIndexedDbPersistence(fb.db);
      firestoreCleared = true;
    } catch { /* anderer Tab offen o. Ä. – Cache bleibt, ist aber an das Konto gebunden */ }
  }
  return { cleared, firestoreCleared };
}
