// Einstellungen „Erinnerungen“: Push-Benachrichtigungen, wenn man vergisst ein- oder auszustempeln.
// Wird im Einstellungs-Panel der Übersicht (#reminders-panel) eingehängt.
import { icon } from "../icons.js";
import * as push from "../push.js";

const DEF = { enabled: true, start: { enabled: true, time: "07:30" }, end: { enabled: true, afterHours: 10 }, pause: { enabled: false } };

let ctx = null;
let root = null;
let snap = null;
let hoursTimer = null;
let statusKey = "";
let busy = false;

const $ = (sel) => root.querySelector(sel);

/** settings.reminders mit Standardwerten auffüllen. */
export function readReminders(settings) {
  const r = (settings && settings.reminders) || {};
  const st = r.start || {}, en = r.end || {}, pa = r.pause || {};
  const h = Number(en.afterHours);
  return {
    enabled: r.enabled !== false,
    start: { enabled: st.enabled !== false, time: /^\d{1,2}:\d{2}$/.test(String(st.time || "")) ? String(st.time) : DEF.start.time },
    end: { enabled: en.enabled !== false, afterHours: Number.isFinite(h) && h > 0 ? h : DEF.end.afterHours },
    pause: { enabled: pa.enabled === true },
  };
}

export function mount(el, c) {
  ctx = c;
  root = el;
  root.classList.add("rm");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("clock", 20)}</span>
      <div><div class="rm-title">Erinnerungen</div>
      <p class="note">Benachrichtigung, wenn du das Stempeln vergisst – auch bei geschlossener App.</p></div>
    </div>
    <label class="switch rm-main">
      <input type="checkbox" id="rm-on">
      <span>Erinnerungen einschalten</span>
    </label>
    <div class="rm-opts" id="rm-opts">
      <div class="rm-opt">
        <label class="switch">
          <input type="checkbox" id="rm-start-on">
          <span>Erinnern, wenn ich nicht eingestempelt bin</span>
        </label>
        <label class="rm-inline">bis
          <input type="time" id="rm-start-time" step="300">
          <span>Uhr</span>
        </label>
        <p class="note">Nur an Arbeitstagen – nicht an Feiertagen, im Urlaub oder Krankenstand.</p>
      </div>
      <div class="rm-opt">
        <label class="switch">
          <input type="checkbox" id="rm-end-on">
          <span>Erinnern, wenn ich lange eingestempelt bin</span>
        </label>
        <label class="rm-inline">länger als
          <input type="number" id="rm-end-hours" inputmode="decimal" min="1" max="24" step="0.5">
          <span>Stunden</span>
        </label>
        <p class="note">Falls du das Ausstempeln vergessen hast.</p>
      </div>
      <div class="rm-opt">
        <label class="switch">
          <input type="checkbox" id="rm-pause-on">
          <span>Pausen-Erinnerung nach 6 h ohne Pause</span>
        </label>
      </div>
    </div>
    <div class="rm-status" id="rm-status" aria-live="polite"></div>
    <div class="rm-actions">
      <button class="btn primary" type="button" id="rm-allow">${icon("check", 18)}<span>Benachrichtigungen erlauben</span></button>
      <button class="btn ghost sm" type="button" id="rm-test">Test-Benachrichtigung</button>
    </div>`;

  $("#rm-on").addEventListener("change", (ev) => saveRem({ enabled: ev.target.checked }));
  $("#rm-start-on").addEventListener("change", (ev) => saveRem({ start: { enabled: ev.target.checked } }));
  $("#rm-start-time").addEventListener("change", (ev) => {
    const v = String(ev.target.value || "");
    if (/^\d{1,2}:\d{2}$/.test(v)) saveRem({ start: { time: v } });
  });
  $("#rm-end-on").addEventListener("change", (ev) => saveRem({ end: { enabled: ev.target.checked } }));
  const hrs = $("#rm-end-hours");
  hrs.addEventListener("input", () => { clearTimeout(hoursTimer); hoursTimer = setTimeout(saveHours, 800); });
  hrs.addEventListener("change", () => { clearTimeout(hoursTimer); saveHours(); });
  $("#rm-pause-on").addEventListener("change", (ev) => saveRem({ pause: { enabled: ev.target.checked } }));

  $("#rm-allow").addEventListener("click", onAllow);
  $("#rm-test").addEventListener("click", onTest);
}

export function update(s) {
  snap = s;
  if (!root || !snap) return;
  const r = readReminders(snap.settings);
  const cloud = isCloud();
  setChecked("#rm-on", r.enabled);
  setChecked("#rm-start-on", r.start.enabled);
  setChecked("#rm-end-on", r.end.enabled);
  setChecked("#rm-pause-on", r.pause.enabled);
  const t = $("#rm-start-time");
  if (document.activeElement !== t) t.value = r.start.time.padStart(5, "0");
  const h = $("#rm-end-hours");
  if (document.activeElement !== h) h.value = String(r.end.afterHours);

  const off = !cloud || !r.enabled;
  root.querySelectorAll("#rm-opts input").forEach((i) => { i.disabled = off; });
  $("#rm-on").disabled = !cloud;
  $("#rm-opts").classList.toggle("off", off);
  t.disabled = off || !r.start.enabled;
  h.disabled = off || !r.end.enabled;

  if (cloud) push.refreshPush(snap.user.uid);
  renderStatus();
}

/* ---------- Hilfen ---------- */

function isCloud() {
  return !!(snap && snap.mode === "cloud" && snap.user && snap.user.uid);
}

function setChecked(sel, v) {
  const el = $(sel);
  if (el && el.checked !== v) el.checked = v;
}

function saveRem(partial) {
  if (!isCloud()) return;
  const cur = readReminders(snap.settings);
  const next = {
    ...cur,
    ...("enabled" in partial ? { enabled: partial.enabled } : {}),
    start: { ...cur.start, ...(partial.start || {}) },
    end: { ...cur.end, ...(partial.end || {}) },
    pause: { ...cur.pause, ...(partial.pause || {}) },
  };
  Promise.resolve(ctx.store.saveSettings({ reminders: next })).catch(() => {});
}

function saveHours() {
  const v = parseFloat(String($("#rm-end-hours").value).replace(",", "."));
  if (!Number.isFinite(v) || v < 1 || v > 24) return;
  const cur = readReminders(snap && snap.settings);
  if (cur.end.afterHours === v) return;
  saveRem({ end: { afterHours: v } });
}

async function renderStatus() {
  const box = $("#rm-status");
  const allow = $("#rm-allow");
  const test = $("#rm-test");
  const st = await push.pushStatus();
  const cloud = isCloud();
  const key = [cloud, st.supported, st.configured, st.permission, !!st.token, st.iosInstall, busy].join("|");
  if (key === statusKey) return;
  statusKey = key;

  let cls = "", html = "";
  let showAllow = true, showTest = cloud && st.supported && st.permission !== "denied";
  if (!cloud) {
    cls = "info";
    html = `${icon("user", 18)}<span>Erinnerungen gibt es nur mit Anmeldung (Google), weil sie vom Server kommen. Melde dich unten bei „Konto“ an.</span>`;
    showAllow = false;
  } else if (!st.configured) {
    cls = "wait";
    html = `${icon("sparkle", 18)}<span><b>Wird noch eingerichtet</b> – Claude schaltet das frei. Deine Einstellungen werden schon gespeichert.</span>`;
    showAllow = false;
  } else if (st.iosInstall) {
    cls = "info";
    html = `${icon("home", 18)}<span>Am iPhone gehen Benachrichtigungen nur in der installierten App: im Teilen-Menü „Zum Home-Bildschirm“ wählen und die App von dort öffnen.</span>`;
    showAllow = false;
  } else if (!st.supported) {
    cls = "info";
    html = `${icon("note", 18)}<span>Dieser Browser kann keine Benachrichtigungen empfangen.</span>`;
    showAllow = false;
  } else if (st.permission === "denied") {
    cls = "bad";
    html = `${icon("note", 18)}<span><b>Blockiert.</b> Erlaube Benachrichtigungen in den Website-Einstellungen: auf das Schloss-Symbol neben der Adresse tippen → Benachrichtigungen → Zulassen. In der installierten App: Handy-Einstellungen → Apps → Stempelkarte → Benachrichtigungen.</span>`;
    showAllow = false;
  } else if (st.permission === "granted" && st.token) {
    cls = "ok";
    html = `${icon("check", 18)}<span><b>Erlaubt</b> – dieses Gerät bekommt Erinnerungen.</span>`;
    showAllow = false;
  } else if (st.permission === "granted") {
    cls = "info";
    html = `${icon("check", 18)}<span>Benachrichtigungen sind erlaubt – noch einmal tippen, um dieses Gerät anzumelden.</span>`;
  } else {
    cls = "info";
    html = `${icon("note", 18)}<span>Noch nicht erlaubt. Tippe auf „Benachrichtigungen erlauben“, damit dieses Gerät Erinnerungen bekommt.</span>`;
  }
  box.className = "rm-status " + cls;
  box.innerHTML = html;
  allow.hidden = !showAllow;
  test.hidden = !showTest;
}

async function onAllow() {
  const b = $("#rm-allow");
  if (busy) return;
  busy = true;
  const orig = b.innerHTML;
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  b.innerHTML = `<span>Einen Moment …</span>`;
  try {
    const res = await push.enablePush(ctx);
    if (res.ok) ctx.ui.toast("Erinnerungen sind auf diesem Gerät aktiv.");
    else if (res.reason === "denied") ctx.ui.toast("Benachrichtigungen wurden blockiert.", 3500);
    else if (res.reason === "not-configured") ctx.ui.toast("Wird noch eingerichtet – Claude schaltet das frei.", 3500);
    else if (res.reason === "no-user") ctx.ui.toast("Bitte zuerst anmelden.", 3000);
  } catch (err) {
    console.error(err);
    ctx.ui.toast("Anmelden für Erinnerungen fehlgeschlagen – bitte später nochmal.", 4000);
  } finally {
    busy = false;
    b.innerHTML = orig;
    b.disabled = false;
    b.removeAttribute("aria-busy");
    statusKey = "";
    renderStatus();
  }
}

async function onTest() {
  try {
    const res = await push.testNotification();
    if (!res.ok) ctx.ui.toast(res.reason === "denied" ? "Benachrichtigungen sind blockiert." : "Benachrichtigung nicht möglich.", 3500);
  } catch (err) {
    console.error(err);
    ctx.ui.toast("Test-Benachrichtigung fehlgeschlagen.", 3500);
  }
  statusKey = "";
  renderStatus();
}
