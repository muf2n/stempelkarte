// Update 9 – Kalender: lokale Ersatz-Erinnerung, solange die App offen ist und Push auf diesem Gerät nicht aktiv ist
// (lokaler Modus, keine Berechtigung oder kein Push-Token). Gleiche Fälligkeitslogik wie der Server (cal-core.dueReminders).
import { dueReminders, reminderText } from "./cal-core.js";
import { isNative } from "./native.js";

const SENT_KEY = "stempelkarte.localReminders";
const TOKEN_KEY = "stempelkarte.pushToken";
let timer = null;

function readSent() { try { return JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {}; } catch { return {}; } }
function writeSent(m) {
  try {
    const limit = new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10);
    for (const [k, v] of Object.entries(m)) if (String(v).slice(0, 10) < limit) delete m[k];
    localStorage.setItem(SENT_KEY, JSON.stringify(m));
  } catch { /* egal */ }
}

/** Kommt für dieses Gerät eine Push-Nachricht vom Server? */
export function pushActive(snap) {
  if (isNative()) return true; // Android-App: native Benachrichtigungen
  if (!snap || snap.mode !== "cloud") return false;
  const rem = snap.settings && snap.settings.reminders;
  if (rem && rem.enabled === false) return true; // bewusst aus → auch lokal nicht erinnern
  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* egal */ }
  return !!token && typeof Notification !== "undefined" && Notification.permission === "granted";
}

async function show(title, body, tag, ctx) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) { await reg.showNotification(title, { body, tag, data: { url: "./#agenda" }, icon: "icons/icon-192.png" }); return; }
      new Notification(title, { body, tag, icon: "icons/icon-192.png" });
      return;
    } catch { /* weiter mit Toast */ }
  }
  ctx.ui.toast(`🔔 ${title} – ${body}`, 8000);
}

/** Prüft jetzt (und dann alle 30 s). ctx = {store, ui}. now() kann für Tests ersetzt werden. */
export function start(ctx, { now = () => Date.now(), interval = 30000 } = {}) {
  stop();
  const tick = () => {
    try {
      const snap = ctx.store.get();
      if (!snap || !snap.ready || pushActive(snap)) return;
      const sent = readSent();
      const t = now();
      const due = dueReminders(t, snap.todos || [], sent);
      if (!due.length) return;
      for (const d of due) {
        for (const [k, v] of d.log) sent[k] = v;
        const { title, body } = reminderText(d, t);
        show(title, body, `todo-${d.t.id}`, ctx);
      }
      writeSent(sent);
    } catch (e) { console.warn("Lokale Erinnerung:", e); }
  };
  timer = setInterval(tick, interval);
  setTimeout(tick, 1500);
  return tick;
}
export function stop() { if (timer) clearInterval(timer); timer = null; }
