// Lädt das Firebase-SDK (CDN) bei Bedarf und initialisiert App, Auth und Firestore genau einmal.

import { firebaseConfig, isConfigured } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
let promise = null;

async function init() {
  const [fapp, fa, fs] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-firestore.js"),
  ]);
  const app = fapp.initializeApp(firebaseConfig);
  const auth = fa.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn("Firestore-Offline-Cache nicht verfügbar, nutze Standard:", err);
    db = fs.getFirestore(app);
  }
  return { app, auth, db, fs, fa };
}

// → {app, auth, db, fs, fa} oder null, wenn Firebase nicht konfiguriert ist
export async function getFirebase() {
  if (!isConfigured()) return null;
  if (!promise) {
    promise = init().catch((err) => {
      promise = null; // nächster Aufruf darf es erneut versuchen (z. B. nach Offline-Start)
      throw err;
    });
  }
  return promise;
}
