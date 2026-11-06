// Update 10c – Einstellungen „Arbeitszeit“ im Einstellungs-Hub (#wt-settings) und Pausen-Erinnerung (#wt-pause-settings,
// unter Benachrichtigungen – erweitert die vorhandenen Schalter statt sie zu verdoppeln).
// settings.dayHours = { "1": 8.5, … } (eigene Stunden je Wochentag), settings.leave.daysPerYear (Urlaubsanspruch),
// settings.worktime = { leaveLabel, gapDays, ignoreGaps[] }, settings.pauseAfterMin (240–600).
import { readDayHours, weekdayTargetMin, WD, hm, esc } from "../util.js";
import { readWorktime, pauseAfterMin, PAUSE_HINT } from "../worktime-core.js";
import { readLeave } from "./leave.js";

let ctx = null;
let root = null;
let pauseRoot = null;
let snap = null;
const timers = {};

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const fmtH = (min) => String(Math.round((min / 60) * 100) / 100).replace(".", ",");
const parseH = (v) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  const n = m ? Number(m[1]) + Number(m[2]) / 60 : Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 24 ? Math.round(n * 100) / 100 : NaN;
};

function save(partial, msg) {
  return ctx.store.saveSettings(partial).then(() => { if (msg) ctx.ui.toast(msg); }).catch(() => { /* Toast kommt vom Store */ });
}
function later(key, fn, ms = 800) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (root) {
    root.innerHTML = `
      <div class="fields wt-set">
        <div>
          <div class="lbl">⏱️ Soll je Wochentag <small>(optional)</small></div>
          <p class="note">Leer = gleichmäßig aus den Wochenstunden. Trägst du z. B. am Freitag 6 h ein, teilen sich die anderen Arbeitstage den Rest.</p>
          <div class="wt-dayhours" data-r="dh"></div>
          <p class="note" data-r="dh-sum" aria-live="polite"></p>
        </div>
        <div class="row">
          <label>🌴 Urlaubsanspruch (Tage/Jahr)
            <input type="text" id="wt-leave-days" inputmode="decimal" placeholder="25">
          </label>
          <label>Bezeichnung
            <input type="text" id="wt-leave-label" maxlength="30" placeholder="Urlaub">
          </label>
        </div>
        <p class="note">Standard: 25 Arbeitstage bei 5-Tage-Woche (5 Wochen). Gilt fürs Urlaubskonto und die Konten-Karte.</p>
        <label>🕵️ Vergessene Stempelungen prüfen (Tage zurück)
          <input type="number" id="wt-gapdays" inputmode="numeric" min="7" max="120" step="1">
        </label>
      </div>`;
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
  }
  pauseRoot = document.getElementById("wt-pause-settings");
  if (pauseRoot) {
    const opts = [240, 270, 300, 330, 360, 390, 420, 480].map((m) => `<option value="${m}">nach ${hm(m)} h ohne Pause</option>`).join("");
    pauseRoot.innerHTML = `
      <label>☕ Pausen-Erinnerung (App &amp; Push)
        <select id="wt-pause-after">${opts}</select>
      </label>
      <p class="note">${esc(PAUSE_HINT)} Die Erinnerung ist nur ein Hinweis, keine Rechtsauskunft.</p>`;
    pauseRoot.querySelector("#wt-pause-after").addEventListener("change", (ev) =>
      save({ pauseAfterMin: Number(ev.target.value) }, "☕ Pausen-Erinnerung angepasst"));
  }
}

export function update(s) {
  snap = s;
  if (!snap) return;
  const st = snap.settings || {};
  if (root) {
    const own = readDayHours(st);
    const days = Array.isArray(st.workDays) ? st.workDays : [1, 2, 3, 4, 5];
    const box = root.querySelector('[data-r="dh"]');
    const want = ORDER.filter((d) => days.includes(d)).join(",");
    if (box.dataset.days !== want) {
      box.dataset.days = want;
      box.innerHTML = ORDER.filter((d) => days.includes(d)).map((d) =>
        `<label class="wt-dh"><span>${WD[d]}</span><input type="text" inputmode="decimal" data-dh="${d}" aria-label="Soll ${WD[d]} in Stunden" maxlength="5"></label>`).join("")
        || `<p class="note">Wähle oben zuerst deine Arbeitstage.</p>`;
    }
    let sum = 0;
    box.querySelectorAll("[data-dh]").forEach((inp) => {
      const d = Number(inp.dataset.dh);
      const t = weekdayTargetMin(d, st);
      sum += t;
      inp.placeholder = fmtH(t);
      if (document.activeElement !== inp) inp.value = own.has(d) ? fmtH(own.get(d)) : "";
      inp.classList.toggle("is-own", own.has(d));
    });
    const sumEl = root.querySelector('[data-r="dh-sum"]');
    const wt = Number(st.weeklyTarget ?? 38.5);
    const diff = Math.abs(sum - wt * 60) > 1;
    sumEl.textContent = own.size ? `Ergibt ${fmtH(sum)} h pro Woche${diff ? ` (Wochenstunden: ${fmtH(wt * 60)} h)` : " ✅"}` : "";
    const lv = readLeave(st);
    const w = readWorktime(st);
    const ld = root.querySelector("#wt-leave-days");
    if (document.activeElement !== ld) ld.value = String(lv.daysPerYear).replace(".", ",");
    const ll = root.querySelector("#wt-leave-label");
    if (document.activeElement !== ll) ll.value = st.worktime && st.worktime.leaveLabel ? w.leaveLabel : "";
    const gd = root.querySelector("#wt-gapdays");
    if (document.activeElement !== gd) gd.value = w.gapDays;
  }
  if (pauseRoot) {
    const sel = pauseRoot.querySelector("#wt-pause-after");
    const v = String(pauseAfterMin(st));
    if (sel && sel.value !== v && document.activeElement !== sel) sel.value = v;
  }
}

function curWorktime() {
  const st = (ctx.store.get() || {}).settings || {};
  return st.worktime && typeof st.worktime === "object" ? st.worktime : {};
}

function saveDayHours(inp) {
  const st = (ctx.store.get() || {}).settings || {};
  const d = inp.dataset.dh;
  const v = parseH(inp.value);
  if (Number.isNaN(v)) { ctx.ui.toast("Bitte Stunden zwischen 0 und 24 eingeben (z. B. 8 oder 7,5)."); return; }
  const cur = st.dayHours && typeof st.dayHours === "object" ? st.dayHours : {};
  if ((cur[d] ?? null) === v) return;
  // ganze Map schreiben; null = wieder gleichmäßig (Firestore-merge überschreibt so den alten Wert)
  save({ dayHours: { ...cur, [d]: v } }, v == null ? `${WD[Number(d)]}: wieder gleichmäßig` : `${WD[Number(d)]}: ${String(v).replace(".", ",")} h Soll`);
}

function onInput(ev) {
  const t = ev.target;
  if (t.matches("[data-dh]")) later("dh" + t.dataset.dh, () => saveDayHours(t), 900);
}

function onChange(ev) {
  const t = ev.target;
  if (t.matches("[data-dh]")) { clearTimeout(timers["dh" + t.dataset.dh]); saveDayHours(t); return; }
  const st = (ctx.store.get() || {}).settings || {};
  if (t.id === "wt-leave-days") {
    const n = Number(String(t.value).trim().replace(",", "."));
    if (!t.value.trim()) return;
    if (!Number.isFinite(n) || n < 0 || n > 60) { ctx.ui.toast("Bitte 0 bis 60 Tage eingeben."); return; }
    const lv = readLeave(st);
    save({ leave: { daysPerYear: Math.round(n * 2) / 2, yearStartMonth: lv.yearStartMonth, carryOver: lv.carryOver } }, "🌴 Urlaubsanspruch gespeichert");
  } else if (t.id === "wt-leave-label") {
    save({ worktime: { ...curWorktime(), leaveLabel: t.value.trim().slice(0, 30) } }, "Bezeichnung gespeichert");
  } else if (t.id === "wt-gapdays") {
    const n = Math.round(Number(t.value));
    if (!(n >= 7 && n <= 120)) { ctx.ui.toast("Bitte 7 bis 120 Tage."); return; }
    save({ worktime: { ...curWorktime(), gapDays: n } });
  }
}
