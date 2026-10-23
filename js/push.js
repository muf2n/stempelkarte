// Push-Erinnerungen: Berechtigung anfragen, FCM-Token holen und in users/{uid}/meta/push ablegen.
// Ohne vapidKey (js/firebase-config.js) bleibt alles still – die Einstellungen zeigen dann „wird noch eingerichtet“.
import { getFirebase } from "./firebase.js";
import { vapidKey } from "./firebase-config.js";

const MESSAGING_SDK = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
const TOKEN_KEY = "stempelkarte.pushToken";
const TZ = "Europe/Vienna";

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }

/** Unterstützt dieser Browser Benachrichtigungen + Push? */
export function isSupported() {
  return typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
}

/** Ist das Web-Push-Zertifikat eingetragen? */
export function isConfigured() {
  return typeof vapidKey === "string" && vapidKey.trim().length > 20;
}

/** iPhone/iPad ohne installierte App (dort gibt es Push nur als Home-Bildschirm-App). */
export function needsInstallIOS() {
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  return ios && !standalone;
}

/** → { supported, configured, permission: "granted"|"denied"|"default"|"unsupported", token, iosInstall } */
export async function pushStatus() {
  const supported = isSupported();
  return {
    supported,
    configured: isConfigured(),
    permission: supported ? Notification.permission : "unsupported",
    token: lsGet(TOKEN_KEY) || null,
    iosInstall: !supported && needsInstallIOS(),
  };
}

async function swRegistration() {
  if (!("serviceWorker" in navigator)) throw new Error("Service Worker nicht verfügbar.");
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register("sw.js", { updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

async function fetchAndStoreToken(uid) {
  const f = await getFirebase();
  if (!f) throw new Error("Firebase ist nicht eingerichtet.");
  const m = await import(MESSAGING_SDK);
  if (typeof m.isSupported === "function" && !(await m.isSupported())) {
    throw new Error("Dieser Browser unterstützt keine Push-Nachrichten.");
  }
  const messaging = m.getMessaging(f.app);
  const token = await m.getToken(messaging, {
    vapidKey: vapidKey.trim(),
    serviceWorkerRegistration: await swRegistration(),
  });
  if (!token) throw new Error("Kein Push-Token erhalten.");
  const { db, fs } = f;
  await fs.setDoc(fs.doc(db, "users", uid, "meta", "push"), {
    tokens: { [token]: { ua: (navigator.userAgent || "").slice(0, 120), updatedAt: Date.now() } },
    tz: TZ,
  }, { merge: true });
  lsSet(TOKEN_KEY, token);
  return token;
}

/**
 * Fragt die Berechtigung an und registriert dieses Gerät für Erinnerungen.
 * ctx: { store } (oder ein Store-Snapshot) – benötigt Cloud-Modus mit angemeldetem Nutzer.
 * → { ok, permission, token?, reason? }
 */
export async function enablePush(ctx) {
  if (!isSupported()) return { ok: false, permission: "unsupported", reason: "unsupported" };
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); } catch { permission = Notification.permission; }
  }
  if (permission !== "granted") return { ok: false, permission, reason: permission };
  if (!isConfigured()) return { ok: false, permission, reason: "not-configured" };
  const snap = ctx && ctx.store && typeof ctx.store.get === "function" ? ctx.store.get() : ctx;
  const uid = snap && snap.mode === "cloud" && snap.user ? snap.user.uid : null;
  if (!uid) return { ok: false, permission, reason: "no-user" };
  const token = await fetchAndStoreToken(uid);
  return { ok: true, permission, token };
}

let refreshedFor = null;
/** Beim App-Start still auffrischen (nur wenn schon erlaubt und eingerichtet). Wirft nie. */
export async function refreshPush(uid) {
  try {
    if (!uid || refreshedFor === uid) return;
    if (!isSupported() || !isConfigured() || Notification.permission !== "granted") return;
    refreshedFor = uid;
    await fetchAndStoreToken(uid);
  } catch (err) {
    console.warn("Push-Token konnte nicht aufgefrischt werden:", err);
  }
}

/** Zeigt sofort eine Benachrichtigung über die SW-Registration (fragt ggf. die Berechtigung an). */
export async function testNotification() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return { ok: false, reason: "unsupported" };
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); } catch { permission = Notification.permission; }
  }
  if (permission !== "granted") return { ok: false, reason: permission };
  const reg = await swRegistration();
  await reg.showNotification("Stempelkarte", {
    body: "So sehen deine Erinnerungen aus.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "stempel-test",
    data: { url: "./#heute" },
  });
  return { ok: true };
}
