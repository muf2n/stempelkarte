// Einstellungen „Sperrbildschirm“ (Update 6): Status-Benachrichtigung mit Knöpfen während einer Schicht.
// Wird im Einstellungs-Panel der Übersicht (#lock-panel) eingehängt.
import { icon } from "../icons.js";
import * as lockscreen from "../lockscreen.js";

let ctx = null;
let root = null;
let snap = null;
let statusKey = "";

const $ = (sel) => root.querySelector(sel);

export function mount(el, c) {
  if (!el) return;
  ctx = c;
  root = el;
  root.classList.add("rm", "lk");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("pause", 20)}</span>
      <div><div class="rm-title">Sperrbildschirm</div>
      <p class="note">Während einer Schicht zeigt eine Benachrichtigung die Uhr – mit Knöpfen für Pause und Autofahren, ohne die App zu öffnen.</p></div>
    </div>
    <label class="switch rm-main">
      <input type="checkbox" id="lk-on">
      <span>Steuerung am Sperrbildschirm</span>
    </label>
    <div class="rm-status" id="lk-status" aria-live="polite"></div>
    <div class="rm-actions">
      <button class="btn primary" type="button" id="lk-allow" hidden>${icon("check", 18)}<span>Benachrichtigungen erlauben</span></button>
    </div>
    <details class="lk-help">
      <summary>Knöpfe am Sperrbildschirm nicht sichtbar?</summary>
      <p class="note">Damit die Knöpfe am Sperrbildschirm sichtbar sind: Android-Einstellungen → Benachrichtigungen → Sperrbildschirm → ‚Alle Inhalte anzeigen‘. Auf manchen Handys muss man zum Antippen kurz entsperren.</p>
      <p class="note">Antippen der Benachrichtigung öffnet die App (dort z.&nbsp;B. Ausstempeln). Funktioniert auch ohne Einrichtung der Erinnerungen.</p>
    </details>`;

  $("#lk-on").addEventListener("change", (ev) => {
    const enabled = ev.target.checked;
    Promise.resolve(ctx.store.saveSettings({ lockscreen: { enabled } })).catch(() => {});
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") onAllow();
  });
  $("#lk-allow").addEventListener("click", onAllow);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") renderStatus(); });
}

export function update(s) {
  snap = s;
  if (!root || !snap) return;
  const l = lockscreen.readLock(snap.settings);
  const on = $("#lk-on");
  if (on.checked !== l.enabled) on.checked = l.enabled;
  on.disabled = !lockscreen.isSupported();
  renderStatus();
}

async function onAllow() {
  if (!lockscreen.isSupported()) return;
  let p = Notification.permission;
  if (p === "default") {
    try { p = await Notification.requestPermission(); } catch { p = Notification.permission; }
  }
  statusKey = "";
  renderStatus();
  if (p === "granted") {
    lockscreen.refresh();
    if (ctx && ctx.ui) ctx.ui.toast(snap && snap.running ? "Steuerung ist jetzt in den Benachrichtigungen" : "Erlaubt – beim nächsten Einstempeln erscheint die Steuerung", 3000);
  }
}

function renderStatus() {
  if (!root) return;
  const box = $("#lk-status");
  const allow = $("#lk-allow");
  const supported = lockscreen.isSupported();
  const perm = supported ? Notification.permission : "unsupported";
  const enabled = lockscreen.readLock(snap && snap.settings).enabled;
  const running = !!(snap && snap.running);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent || "");
  const key = [supported, perm, enabled, running, ios].join("|");
  if (key === statusKey) return;
  statusKey = key;

  let cls = "info", html = "", showAllow = false;
  if (!supported) {
    html = `${icon("note", 18)}<span>Dieser Browser kann keine Benachrichtigungen anzeigen.${ios ? " Am iPhone geht das nur in der installierten App (Teilen → „Zum Home-Bildschirm“)." : ""}</span>`;
  } else if (!enabled) {
    html = `${icon("note", 18)}<span>Aus – es wird keine Status-Benachrichtigung angezeigt.</span>`;
  } else if (perm === "denied") {
    cls = "bad";
    html = `${icon("note", 18)}<span><b>Blockiert.</b> Erlaube Benachrichtigungen in den Website-Einstellungen (Schloss-Symbol neben der Adresse) bzw. in der installierten App: Handy-Einstellungen → Apps → Stempelkarte → Benachrichtigungen.</span>`;
  } else if (perm !== "granted") {
    html = `${icon("note", 18)}<span>Noch nicht erlaubt. Tippe auf „Benachrichtigungen erlauben“.</span>`;
    showAllow = true;
  } else {
    cls = "ok";
    html = `${icon("check", 18)}<span><b>Aktiv</b> – ${running ? "die Steuerung ist gerade in deinen Benachrichtigungen." : "beim Einstempeln erscheint die Steuerung in deinen Benachrichtigungen."}${ios ? " Am iPhone zeigt die Benachrichtigung keine Knöpfe." : ""}</span>`;
  }
  box.className = "rm-status " + cls;
  box.innerHTML = html;
  allow.hidden = !showAllow;
}
