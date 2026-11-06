// Einstellungen „Uhr (Bangle.js 2)“ (Update 7): verbinden, App auf die Uhr spielen, abgleichen.
// Wird im Einstellungs-Panel der Übersicht (#watch-panel) eingehängt.
import { icon } from "../icons.js";
import * as watch from "../watch.js";

let ctx = null;
let root = null;
let snap = null;
let unsub = null;

const $ = (sel) => root.querySelector(sel);

const WATCH_ICO = '<svg class="ico ico-watch" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3M12 9.5V12l1.6 1"/></svg>';

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pad(n) { return (n < 10 ? "0" : "") + n; }
function whenText(ts) {
  if (!ts) return "noch nie";
  const d = new Date(ts), now = new Date();
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "heute " + hm;
  if (d.toDateString() === y.toDateString()) return "gestern " + hm;
  return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + ". " + hm;
}

export function mount(el, c) {
  if (!el) return;
  ctx = c;
  root = el;
  root.classList.add("rm", "wt");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${WATCH_ICO}</span>
      <div><div class="rm-title">Uhr (Bangle.js 2)</div>
      <p class="note">Stempeln am Handgelenk – und deine Schritte und Höhenmeter landen in „Mein Tag“.
      <a href="${watch.SHOP_URL}" target="_blank" rel="noopener">Uhr kaufen (Espruino-Shop)</a></p></div>
    </div>
    <div class="rm-status" id="wt-status" aria-live="polite"></div>
    <div class="wt-progress" id="wt-progress" hidden><span></span></div>
    <div class="wt-btns">
      <button class="btn" type="button" id="wt-pair">${WATCH_ICO}<span>Uhr verbinden</span></button>
      <button class="btn" type="button" id="wt-install">${icon("box", 18)}<span>Stempelkarte-App auf die Uhr spielen</span></button>
      <button class="btn primary" type="button" id="wt-sync">${icon("swap", 18)}<span>Jetzt abgleichen</span></button>
    </div>
    <p class="note wt-last" id="wt-last"></p>
    <label class="switch rm-main">
      <input type="checkbox" id="wt-auto">
      <span>Beim Öffnen der App automatisch abgleichen</span>
    </label>
    <details class="lk-help wt-help">
      <summary>So klappt's</summary>
      <p class="note">1. Uhr in die Nähe, Bluetooth am Handy an. Ist die Uhr mit Gadgetbridge oder einer anderen App verbunden, dort kurz trennen – die Uhr kann nur eine Verbindung gleichzeitig.</p>
      <p class="note">2. „Uhr verbinden“ und die Bangle.js aus der Liste wählen. Danach einmal „App auf die Uhr spielen“ (dauert etwa eine Minute).</p>
      <p class="note">3. Auf der Uhr die App „Stempelkarte“ öffnen. Einstempeln, Pause und Autofahren gehen dort per Tipp; Ausstempeln mit zwei Tipps. Beim nächsten Abgleich übernimmt das Handy alles mit der richtigen Uhrzeit.</p>
      <p class="note">Für Schritte und Puls braucht die Uhr die App „Health“ (ist normalerweise schon drauf). In den Uhr-Einstellungen muss unter Bluetooth „Programmierbar“ an sein.</p>
    </details>`;

  $("#wt-pair").addEventListener("click", () => run(() => watch.pair(ctx), "Uhr verbunden"));
  $("#wt-install").addEventListener("click", () => run(() => watch.installApp(null, ctx), "App ist auf der Uhr"));
  $("#wt-sync").addEventListener("click", () => run(() => watch.sync(ctx, { interactive: true }), null));
  $("#wt-auto").addEventListener("change", (ev) => { watch.savePrefs({ autoSync: ev.target.checked }); });
  if (unsub) unsub();
  unsub = watch.onStatus(render);
  render(watch.getStatus());
}

async function run(fn, okToast) {
  try {
    await fn();
    if (okToast && ctx && ctx.ui) ctx.ui.toast(okToast, 2200);
  } catch (e) {
    if (ctx && ctx.ui) ctx.ui.toast(e && e.message ? e.message : "Hat nicht geklappt.", 4000);
  }
}

export function update(s) {
  snap = s;
  if (root) render(watch.getStatus());
}

function render(st) {
  if (!root) return;
  const busy = ["connecting", "syncing", "installing"].includes(st.state);
  const box = $("#wt-status");
  let cls = "info", html = "";
  if (!st.supported) {
    const ios = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent || "");
    html = `${icon("note", 18)}<span>Dein Browser kann kein Web Bluetooth. ${ios ? "Am iPhone geht das leider nicht." : "Am Android-Handy klappt es mit Chrome (App vom Startbildschirm)."}</span>`;
  } else if (busy) {
    cls = "wait";
    html = `${icon("clock", 18)}<span>${esc(st.msg || "Bitte warten …")}</span>`;
  } else if (st.state === "error") {
    cls = "bad";
    html = `${icon("note", 18)}<span>${esc(st.msg)}</span>`;
  } else if (st.msg) {
    cls = "ok";
    html = `${icon("check", 18)}<span>${esc(st.msg)}</span>`;
  } else if (st.paired) {
    cls = "ok";
    html = `${icon("check", 18)}<span>Uhr bekannt: <b>${esc(st.deviceName || "Bangle.js")}</b>${st.installedAt ? "" : " – App noch nicht aufgespielt?"}</span>`;
  } else {
    html = `${icon("note", 18)}<span>⌚ Noch keine Uhr verbunden.</span>`;
  }
  box.className = "rm-status " + cls;
  box.innerHTML = html;

  const prog = $("#wt-progress");
  prog.hidden = !(st.state === "installing" && st.progress != null);
  prog.firstElementChild.style.width = Math.round((st.progress || 0) * 100) + "%";

  for (const id of ["#wt-pair", "#wt-install", "#wt-sync"]) $(id).disabled = !st.supported || busy;
  $("#wt-pair").querySelector("span").textContent = st.paired ? "Andere Uhr verbinden" : "Uhr verbinden";
  $("#wt-last").textContent = st.paired ? "Letzter Abgleich: " + whenText(st.lastSync) : "";
  $("#wt-last").hidden = !st.paired;
  const auto = $("#wt-auto");
  auto.checked = st.autoSync !== false;
  auto.disabled = !st.supported || !st.paired;
  auto.closest("label").classList.toggle("wt-off", !st.paired);
}
