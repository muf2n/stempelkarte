// Google-Anmeldung über Firebase Auth: Anmelden (Popup, sonst Weiterleitung), Abmelden, Statusänderungen melden.

import { getFirebase } from "./firebase.js";

function toUser(u) {
  if (!u) return null;
  return { uid: u.uid, name: u.displayName || u.email || "", photo: u.photoURL || null, email: u.email || null };
}

function germanError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/unauthorized-domain":
      "Diese Adresse ist in Firebase noch nicht freigegeben – siehe Anleitung Schritt „Domain freigeben“ (Authentication → Einstellungen → Autorisierte Domains).",
    "auth/network-request-failed": "Keine Internetverbindung. Bitte später nochmal versuchen.",
    "auth/operation-not-allowed":
      "Die Google-Anmeldung ist in Firebase noch nicht aktiviert – siehe Anleitung (Authentication → Anmeldemethode → Google).",
    "auth/too-many-requests": "Zu viele Versuche. Bitte kurz warten und nochmal probieren.",
    "auth/user-disabled": "Dieses Konto wurde gesperrt.",
    "auth/invalid-api-key": "Der API-Schlüssel in firebase-config.js stimmt nicht – bitte prüfen.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      "Der API-Schlüssel in firebase-config.js stimmt nicht – bitte prüfen.",
    "auth/internal-error": "Anmeldung fehlgeschlagen (interner Fehler). Bitte nochmal versuchen.",
  };
  const e = new Error(map[code] || "Anmeldung fehlgeschlagen" + (code ? " (" + code + ")" : "") + ".");
  e.code = code;
  e.cause = err;
  return e;
}

// onUser(user|null) bei jeder Änderung; gibt die Abmelde-Funktion des Listeners zurück
export async function initAuth(onUser) {
  const fb = await getFirebase();
  if (!fb) { onUser(null); return () => {}; }
  const { auth, fa } = fb;
  try { await fa.setPersistence(auth, fa.browserLocalPersistence); }
  catch (err) { console.warn("setPersistence fehlgeschlagen:", err); }
  try { await fa.getRedirectResult(auth); }
  catch (err) { console.warn("Anmeldung per Weiterleitung fehlgeschlagen:", err && err.code, err); }
  return fa.onAuthStateChanged(auth, (u) => onUser(toUser(u)));
}

export async function signIn() {
  const fb = await getFirebase();
  if (!fb) throw new Error("Firebase ist noch nicht eingerichtet – siehe Anleitung.");
  const { auth, fa } = fb;
  const provider = new fa.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const res = await fa.signInWithPopup(auth, provider);
    return toUser(res.user);
  } catch (err) {
    const code = err && err.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      try { await fa.signInWithRedirect(auth, provider); return null; }
      catch (err2) { throw germanError(err2); }
    }
    throw germanError(err);
  }
}

export async function signOut() {
  const fb = await getFirebase();
  if (!fb) return;
  await fb.fa.signOut(fb.auth);
}
