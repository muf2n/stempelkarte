// Brücke zur Android-App (Capacitor). Im Browser ist alles hier ein No-op.
// Die App lädt diese Web-Seite direkt von GitHub Pages; window.Capacitor wird vom nativen Teil eingespielt.

const APK_LATEST = "https://github.com/muf2n/stempelkarte-android/releases/latest";

export function isNative() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch { return false; }
}

export function plugin(name) {
  if (!isNative()) return null;
  const C = window.Capacitor;
  try { return (C.Plugins && C.Plugins[name]) || (C.registerPlugin ? C.registerPlugin(name) : null); }
  catch { return null; }
}

// Native Google-Anmeldung → Token an das Web-Firebase weiterreichen
export async function nativeGoogleCredential(fa) {
  const FA = plugin("FirebaseAuthentication");
  if (!FA) throw new Error("Anmelde-Modul der App fehlt.");
  const res = await FA.signInWithGoogle();
  const idToken = res && res.credential && res.credential.idToken;
  if (!idToken) return null; // abgebrochen
  return fa.GoogleAuthProvider.credential(idToken, res.credential.accessToken || null);
}

export async function nativeSignOut() {
  const FA = plugin("FirebaseAuthentication");
  if (FA) { try { await FA.signOut(); } catch {} }
}

// Prüft, ob eine neuere APK da ist (Web-Teil aktualisiert sich ohnehin selbst)
export async function checkApkUpdate(toast) {
  if (!isNative()) return;
  const App = plugin("App");
  if (!App) return;
  try {
    const [info, r] = await Promise.all([
      App.getInfo(),
      fetch("./android-version.json?t=" + Date.now(), { cache: "no-store" }),
    ]);
    if (!r.ok) return;
    const latest = await r.json();
    const have = parseInt(info.build, 10) || 0;
    if (latest.versionCode > have) {
      let snoozed = 0;
      try { snoozed = +localStorage.getItem("apk-snooze-" + latest.versionCode) || 0; } catch {}
      if (Date.now() - snoozed < 24 * 3600e3) return;
      showUpdateBanner(latest, toast);
    }
  } catch (err) { console.warn("APK-Update-Prüfung:", err); }
}

function showUpdateBanner(latest, toast) {
  if (document.getElementById("apk-update")) return;
  const el = document.createElement("div");
  el.id = "apk-update";
  el.setAttribute("role", "status");
  el.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:9999;" +
    "background:var(--card,#fff);color:var(--text,#222);border-radius:16px;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.25);" +
    "display:flex;gap:10px;align-items:center;font-size:.95rem";
  el.innerHTML = `<div style="flex:1"><b>App-Update ${latest.versionName}</b><br><small>Neue Android-Version zum Installieren</small></div>
    <button type="button" data-a="later" style="background:none;border:0;padding:8px;color:inherit;opacity:.7">Später</button>
    <button type="button" data-a="get" style="border:0;border-radius:12px;padding:10px 14px;background:var(--accent,#e86a5c);color:#fff;font-weight:600">Laden</button>`;
  el.addEventListener("click", async (e) => {
    const a = e.target.closest("button")?.dataset.a;
    if (!a) return;
    if (a === "later") {
      try { localStorage.setItem("apk-snooze-" + latest.versionCode, String(Date.now())); } catch {}
    } else {
      const B = plugin("Browser");
      if (B) await B.open({ url: APK_LATEST }); else window.open(APK_LATEST, "_blank");
      if (toast) toast("APK laden, öffnen und „Aktualisieren“ tippen");
    }
    el.remove();
  });
  document.body.appendChild(el);
}
