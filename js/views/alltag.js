// Reiter „Alltag“: Kachel-Raster aller Bereiche (js/alltag/modules.js) und Vollbild-Bereich mit Kopfzeile „← Alltag“.
// Routing über den Hash: #alltag → Kacheln, #alltag/<id> → Bereich <id> (mount/cleanup beim Wechsel).
import { MODULES } from "../alltag/modules.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";

let C = null;
let root = null;
let current = null;   // { id, cleanup }
let routeToken = 0;

function subRoute() {
  const h = (location.hash || "").replace(/^#/, "");
  if (h !== "alltag" && !h.startsWith("alltag/")) return null; // anderer Reiter
  return h.split("/")[1] || "";
}

function unmountModule() {
  if (current && typeof current.cleanup === "function") {
    try { current.cleanup(); } catch (err) { console.error("Alltag-Modul cleanup:", err); }
  }
  current = null;
}

function gridHTML() {
  const tiles = MODULES.map((m, i) =>
    `<a class="al-tile" href="#alltag/${esc(m.id)}" style="--al-c:${esc(m.color || "#4F46E5")};--i:${i}" data-id="${esc(m.id)}">` +
      `<span class="al-tile-ic">${icon(m.icon, 30) || icon("grid", 30)}</span>` +
      `<span class="al-tile-txt"><b>${esc(m.title)}</b><small>${esc(m.sub || "")}</small></span>` +
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
  const token = ++routeToken;
  root.innerHTML =
    `<div class="al-mod" style="--al-c:${esc(mod.color || "#4F46E5")}">` +
      `<div class="al-bar">` +
        `<a class="al-back" href="#alltag" aria-label="Zurück zu Alltag">${icon("chevron-left", 20)}<span>Alltag</span></a>` +
        `<h2 class="al-title"><span class="al-title-ic">${icon(mod.icon, 20)}</span>${esc(mod.title)}</h2>` +
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

export function update() { /* Bereiche abonnieren ihre Daten selbst */ }

export function onShow() { route(); }
