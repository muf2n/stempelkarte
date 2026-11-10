// 📍 Zwischenstopps (Update 10): Während der laufende Abschnitt „Autofahren“ ist, merkt sich die App beim Öffnen
// (App-Start, visibilitychange → sichtbar, Capacitor App „resume“) den Standort als Zwischenstopp am Abschnitt
// (seg.via, siehe js/via-core.js). Manuell über „📍 Hier merken“ (ohne 2-min-Regel).
// Nur mit Standort-Funktionen an (settings.autoLocate !== false), nie im Privat-Modus, automatisch nur,
// wenn die Standort-Berechtigung schon erteilt ist (keine Nachfrage beim Öffnen).
import { viaCheck, withVia } from "./via-core.js";
import { isDriving } from "./travel.js";
import { isPrivatNow } from "./privat.js";
import { isNative, plugin } from "./native.js";

let ctx = null;
let busy = false;
let lastTry = 0;
let started = false;

function snapNow() { try { return ctx.store.get(); } catch { return null; } }

/** Laufender Fahrt-Abschnitt (Index im Roh-Array) oder null. */
export function currentDrive(s) {
  const r = s && s.running;
  if (!r || r.pauseStart != null || !Array.isArray(r.segments) || !r.segments.length) return null;
  const i = r.segments.length - 1;
  const seg = r.segments[i];
  return seg && isDriving(seg) ? { r, i, seg } : null;
}

/** Sind Zwischenstopps gerade erlaubt (Standort an, kein Privat-Modus)? */
export function allowed(s) {
  if (!s) return false;
  if (s.settings && s.settings.autoLocate === false) return false;
  if (isPrivatNow(s)) return false;
  return true;
}

async function permOk() {
  try {
    const p = await ctx.geo.permission();
    return p === "granted" || (p === "unknown" && isNative());
  } catch { return false; }
}

/** Standort holen und ggf. als Zwischenstopp speichern. → true, wenn gespeichert. */
export async function capture({ manual = false } = {}) {
  if (!ctx || busy) return false;
  const s0 = snapNow();
  if (!allowed(s0) || !currentDrive(s0)) return false;
  if (!manual) {
    if (Date.now() - lastTry < 20000) return false;
    if (!(await permOk())) return false;
  }
  lastTry = Date.now();
  busy = true;
  try {
    let pos;
    try { pos = await ctx.geo.getPosition({ timeout: 12000, maxAge: manual ? 5000 : 20000 }); }
    catch (err) { if (manual) ctx.ui.toast((err && err.message) || "Standort nicht verfügbar 😕", 3500); return false; }
    // frisch lesen – inzwischen könnte die Fahrt beendet sein
    const s = snapNow();
    const cd = currentDrive(s);
    if (!cd || !allowed(s)) return false;
    const now = Date.now();
    const chk = viaCheck(cd.seg, pos, { now, manual });
    if (!chk.ok) {
      if (manual) {
        const msg = {
          acc: `Standort zu ungenau (± ${Math.round(pos.acc || 0)} m) – versuch's gleich nochmal 🛰️`,
          near: "Hier bist du schon gemerkt – fahr ein Stück weiter 😉",
          max: "Maximal 25 Zwischenstopps pro Fahrt 🙈",
        }[chk.reason] || "Zwischenstopp nicht gemerkt";
        ctx.ui.toast(msg, 3500);
      }
      return false;
    }
    const list = cd.r.segments.slice();
    list[cd.i] = withVia(cd.seg, pos, now);
    await ctx.store.setRunning({ ...cd.r, segments: list });
    ctx.ui.toast("📍 Zwischenstopp gemerkt", 2500);
    return true;
  } catch (err) {
    console.warn("Zwischenstopp:", err);
    return false;
  } finally {
    busy = false;
  }
}

/** Beim ersten Store-Stand mit laufender Fahrt (App-Start) einmal versuchen. */
export function onSnap(s) {
  if (started || !ctx || !s || s.ready === false) return;
  if (!currentDrive(s)) return;
  started = true;
  capture().catch(() => {});
}

export function init(c) {
  if (ctx) return;
  ctx = c;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") capture().catch(() => {});
  });
  const App = plugin("App");
  if (App && App.addListener) {
    try { App.addListener("resume", () => { capture().catch(() => {}); }); } catch { /* egal */ }
  }
}
