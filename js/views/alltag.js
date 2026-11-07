// Reiter „Alltag“: Kachel-Raster aller Bereiche (js/alltag/modules.js) und Vollbild-Bereich mit Kopfzeile „← Alltag“.
// Routing über den Hash: #alltag → Kacheln, #alltag/<id> → Bereich <id> (mount/cleanup beim Wechsel).
import { MODULES } from "../alltag/modules.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as store from "../store.js";
import { modulesOff, toggleModule } from "../profiles-core.js"; // Update 10 F – Module ein/aus

let C = null;
let root = null;
let current = null;   // { id, cleanup }
let routeToken = 0;

function subRoute() {
  const h = (location.hash || "").replace(/^#/, "");
  if (h !== "alltag" && !h.startsWith("alltag/")) return null; // anderer Reiter
  return h.split("?")[0].split("/")[1] || ""; // Update 9 (Agent W3): #alltag/galerie?import=native
}

function unmountModule() {
  if (current && typeof current.cleanup === "function") {
    try { current.cleanup(); } catch (err) { console.error("Alltag-Modul cleanup:", err); }
  }
  current = null;
}

function gridHTML() {
  const off = modulesOff((store.get() || {}).settings);
  const tiles = MODULES.filter((m) => !off.has(m.id)).map((m, i) =>
    `<a class="al-tile" href="#alltag/${esc(m.id)}" style="--al-c:${esc(m.color || "#4F46E5")};--i:${i}" data-id="${esc(m.id)}">` +
      `<span class="al-tile-ic">${icon(m.icon, 30) || icon("grid", 30)}</span>` +
      `<span class="al-tile-txt"><b>${esc(m.title)}</b><small>${esc((m.subFn && m.subFn()) || m.sub || "")}</small></span>` +
      `<span class="al-tile-go" aria-hidden="true">${icon("chevron-right", 20)}</span>` +
    `</a>`).join("");
  return `<div class="al-home">` +
    `<div class="al-hero"><h2>Alltag</h2><p>Geld, Schule &amp; Lernen – alles an einem Ort.</p></div>` +
    `<div class="al-grid">${tiles}</div>` +
  `</div>`;
}

function renderGrid() {
  unmountModule();
  root.innerHTML = gridHTML();
}

async function renderModule(id) {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) { renderGrid(); return; }
  if (current && current.id === id) return; // schon offen
  unmountModule();
  if (modulesOff((store.get() || {}).settings).has(id)) { offHTML(mod); return; } // Update 10 F – ausgeschaltet (Daten bleiben)
  const token = ++routeToken;
  root.innerHTML =
    `<div class="al-mod" style="--al-c:${esc(mod.color || "#4F46E5")}">` +
      `<div class="al-bar">` +
        `<a class="al-back" href="#alltag" aria-label="Zurück zu Alltag">${icon("chevron-left", 20)}<span>Alltag</span></a>` +
        `<h2 class="al-title"><span class="al-title-ic">${icon(mod.icon, 20)}</span>${esc(mod.short || mod.title)}</h2>` +
      `</div>` +
      `<div class="al-body"><div class="al-loading">Lade …</div></div>` +
    `</div>`;
  current = { id, cleanup: null };
  const body = root.querySelector(".al-body");
  let m;
  try {
    m = await mod.load();
  } catch (err) {
    console.error("Alltag-Modul laden:", err);
    if (token !== routeToken) return;
    body.innerHTML = `<div class="empty"><h3>Konnte nicht geladen werden</h3><p>${navigator.onLine ? "Bitte später nochmal probieren." : "Du bist offline – der Bereich wurde noch nicht gespeichert."}</p></div>`;
    return;
  }
  if (token !== routeToken || !current || current.id !== id) return;
  body.innerHTML = "";
  try {
    const cleanup = m.mount(body, C);
    current.cleanup = typeof cleanup === "function" ? cleanup : null;
  } catch (err) {
    console.error("Alltag-Modul mount:", err);
    body.innerHTML = `<div class="empty"><h3>Fehler im Bereich</h3><p>${esc(err && err.message || String(err))}</p></div>`;
  }
}

/** Update 10 F: ausgeschaltetes Modul – freundlich erklären, mit einem Tipp wieder einschalten. */
function offHTML(mod) {
  root.innerHTML =
    `<div class="al-mod" style="--al-c:${esc(mod.color || "#4F46E5")}">` +
      `<div class="al-bar"><a class="al-back" href="#alltag" aria-label="Zurück zu Alltag">${icon("chevron-left", 20)}<span>Alltag</span></a>` +
      `<h2 class="al-title"><span class="al-title-ic">${icon(mod.icon, 20)}</span>${esc(mod.short || mod.title)}</h2></div>` +
      `<div class="al-body"><div class="empty al-off"><span class="al-off-e" aria-hidden="true" style="font-size:2.4rem">🙈</span><h3>Dieser Bereich ist ausgeschaltet</h3>` +
      `<p>Deine Daten sind noch da – du hast ihn nur unter Einstellungen › Profile &amp; Module ausgeblendet.</p>` +
      `<button type="button" class="btn primary" data-al-on="${esc(mod.id)}">✅ Wieder einschalten</button></div></div></div>`;
  current = null;
  const b = root.querySelector("[data-al-on]");
  b.addEventListener("click", async () => {
    try { await store.saveSettings({ modules: toggleModule((store.get() || {}).settings, mod.id, true) }); }
    catch (e) { console.error(e); return; }
    root.innerHTML = "";
    renderModule(mod.id);
  });
}

function route() {
  if (!root) return;
  const before = current ? current.id : (root.querySelector(".al-home") ? "" : null);
  const sub = subRoute();
  if (sub === null) { routeToken++; unmountModule(); root.innerHTML = ""; return; }
  if (!sub) {
    routeToken++;
    if (!current && root.querySelector(".al-home")) return; // schon da
    renderGrid();
    if (before !== null) window.scrollTo(0, 0);
    return;
  }
  if (before !== sub) window.scrollTo(0, 0);
  renderModule(sub);
}

export function mount(el, ctx) {
  C = ctx;
  root = el;
  window.addEventListener("hashchange", route);
}

let offSig = null;
export function update(snap) { // Bereiche abonnieren ihre Daten selbst; hier nur: Update 10 F – Module ein/aus neu zeichnen
  const sig = [...modulesOff((snap || store.get() || {}).settings)].sort().join(",");
  if (offSig !== null && sig !== offSig && root && !current && root.querySelector(".al-home")) renderGrid();
  offSig = sig;
}

export function onShow() { route(); }
