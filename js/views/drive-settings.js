// Einstellungen „Fahrerkennung“ (Update 6): automatisch zu „Autofahren“ wechseln, wenn die App eine Fahrt erkennt.
// Wird im Einstellungs-Panel der Übersicht (#drive-panel) eingehängt.
import { icon } from "../icons.js";
import { readAutoDrive } from "../motion.js";

let ctx = null;
let root = null;
let snap = null;
let kmhTimer = null;

const $ = (sel) => root.querySelector(sel);

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "dv");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("car", 20)}</span>
      <div><div class="rm-title">Fahrerkennung</div>
      <p class="note">Erkennt eine Autofahrt am Standort und wechselt zum Abschnitt „Autofahren“ – bei der Ankunft zurück.</p></div>
    </div>
    <label class="switch rm-main">
      <input type="checkbox" id="dv-on">
      <span>Fahrten erkennen</span>
    </label>
    <div class="rm-opts" id="dv-opts">
      <div class="rm-opt">
        <div class="dv-seg" role="radiogroup" aria-label="Wenn eine Fahrt erkannt wird">
          <label class="dv-radio"><input type="radio" name="dv-mode" value="auto"><span>Automatisch wechseln</span></label>
          <label class="dv-radio"><input type="radio" name="dv-mode" value="ask"><span>Nur fragen</span></label>
        </div>
        <p class="note">Automatisch: mit „Rückgängig“ für 10 Sekunden. Nur fragen: ein Hinweis-Kärtchen auf „Heute“.</p>
      </div>
      <div class="rm-opt">
        <label class="dv-range">Mindestgeschwindigkeit <b id="dv-kmh-v">20 km/h</b>
          <input type="range" id="dv-kmh" min="10" max="60" step="5">
        </label>
      </div>
      <div class="rm-opt">
        <label class="switch">
          <input type="checkbox" id="dv-wake">
          <span>Bildschirm während der Fahrt anlassen</span>
        </label>
      </div>
    </div>
    <div class="rm-status dv-note">${icon("pin", 18)}<span>Funktioniert, solange die App geöffnet ist. Bei gesperrtem Bildschirm kann eine Web-App den Standort nicht abfragen – dann wechselst du über die Benachrichtigung am Sperrbildschirm.</span></div>`;

  $("#dv-on").addEventListener("change", (ev) => save({ enabled: ev.target.checked }));
  root.querySelectorAll('input[name="dv-mode"]').forEach((r) =>
    r.addEventListener("change", (ev) => { if (ev.target.checked) save({ mode: ev.target.value }); }));
  const k = $("#dv-kmh");
  k.addEventListener("input", () => {
    $("#dv-kmh-v").textContent = k.value + " km/h";
    clearTimeout(kmhTimer);
    kmhTimer = setTimeout(() => save({ minKmh: Number(k.value) }), 500);
  });
  k.addEventListener("change", () => { clearTimeout(kmhTimer); save({ minKmh: Number(k.value) }); });
  $("#dv-wake").addEventListener("change", (ev) => save({ keepAwake: ev.target.checked }));

  try { snap = ctx.store.get(); } catch { snap = null; }
  if (snap) update(snap);
}

export function update(s) {
  snap = s;
  if (!root || !snap || !root.querySelector("#dv-on")) return;
  const a = readAutoDrive(snap.settings);
  setChecked("#dv-on", a.enabled);
  setChecked("#dv-wake", a.keepAwake);
  root.querySelectorAll('input[name="dv-mode"]').forEach((r) => { if (r.checked !== (r.value === a.mode)) r.checked = r.value === a.mode; });
  const k = $("#dv-kmh");
  if (document.activeElement !== k && !kmhTimer) {
    k.value = String(a.minKmh);
    $("#dv-kmh-v").textContent = a.minKmh + " km/h";
  }
  root.querySelectorAll("#dv-opts input").forEach((i) => { i.disabled = !a.enabled; });
  $("#dv-opts").classList.toggle("off", !a.enabled);
}

function setChecked(sel, v) {
  const el = $(sel);
  if (el && el.checked !== v) el.checked = v;
}

async function save(partial) {
  kmhTimer = null;
  const cur = readAutoDrive((ctx.store.get() || snap || {}).settings);
  const next = { ...cur, ...partial };
  try { await ctx.store.saveSettings({ autoDrive: next }); } catch { /* Toast kommt vom Store */ }
}
