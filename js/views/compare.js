// Update 10 – 📊 Vergleichsmodus: Karte in der Übersicht (#compare-panel). Diese Woche ↔ letzte Woche, dieser Monat ↔ letzter Monat
// mit maßstabsgetreuen Balken (inline SVG, Farben aus den Theme-Variablen) und ▲/▼-Deltas. Geld nur ohne Geld-Sperre.
// Logik: js/compare-core.js
import * as C from "../compare-core.js";
import { collection } from "../alltag/db.js";
import * as lockState from "../alltag/money-lock-state.js";
import { eurS } from "../alltag/money-core.js";
import { netMs } from "../timer.js";

const KIND_KEY = "sk-cmp-kind";
let root = null, snap = null, ctx = null, kind = "week", queued = false;
const subs = new Map(), data = new Map();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ensureCss() {
  if (document.getElementById("css-compare")) return;
  const l = document.createElement("link");
  l.id = "css-compare"; l.rel = "stylesheet";
  l.href = new URL("../../css/compare.css", import.meta.url).href;
  document.head.appendChild(l);
}

function need(name) {
  if (subs.has(name)) return;
  subs.set(name, () => {});
  try { subs.set(name, collection(name).watch((list) => { data.set(name, list || []); schedule(); })); } catch (e) { console.error(e); }
}
function drop(name) { const off = subs.get(name); if (!off) return; try { off(); } catch { /* egal */ } subs.delete(name); data.delete(name); }
const moneyOk = () => { try { return lockState.isLoaded() && !lockState.isLocked(); } catch { return false; } };

export function mount(el, c) {
  root = el; ctx = c;
  if (!root) return;
  ensureCss();
  try { const k = localStorage.getItem(KIND_KEY); if (k === "month") kind = "month"; } catch { /* egal */ }
  root.classList.add("cmp");
  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-cmp]");
    if (!b) return;
    kind = b.dataset.cmp === "month" ? "month" : "week";
    try { localStorage.setItem(KIND_KEY, kind); } catch { /* egal */ }
    render();
  });
  try { lockState.onChange(schedule); } catch { /* egal */ }
  need("freizeit");
}

export function update(s) { snap = s; schedule(); }

function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; try { render(); } catch (e) { console.error("Vergleich:", e); } }); }

function bars(row, cur, prev) {
  const [a, b] = C.barScale(cur, prev);
  const W = 100;
  const w = (x) => (x > 0 ? Math.max(1.5, x * W) : 0);
  // zwei Balken, gemeinsame Skala (längster = volle Breite); viewBox in %, damit es überall maßstabsgetreu bleibt
  return `<svg class="cmp-svg" viewBox="0 0 100 22" preserveAspectRatio="none" role="img" aria-label="${esc(row.t)}: jetzt ${esc(C.fmt(row, cur, eurS))}, vorher ${esc(C.fmt(row, prev, eurS))}">
    <rect class="cmp-track" x="0" y="1" width="${W}" height="8" rx="1"></rect>
    <rect class="cmp-cur${cur < 0 ? " neg" : ""}" x="0" y="1" width="${w(a).toFixed(2)}" height="8" rx="1"></rect>
    <rect class="cmp-track" x="0" y="13" width="${W}" height="8" rx="1"></rect>
    <rect class="cmp-prev${prev < 0 ? " neg" : ""}" x="0" y="13" width="${w(b).toFixed(2)}" height="8" rx="1"></rect>
  </svg>`;
}

function render() {
  if (!root || !snap || !snap.ready) return;
  const mOk = moneyOk();
  if (mOk) need("money_tx"); else drop("money_tx");
  const running = snap.running;
  let runningNetMin = 0;
  try { runningNetMin = running ? Math.round(netMs(running) / 60000) : 0; } catch { runningNetMin = 0; }
  const res = C.compare({
    entries: snap.entries || [], running, runningNetMin, settings: snap.settings || {}, todos: snap.todos || [],
    money: mOk && subs.has("money_tx") && collection("money_tx").loaded ? data.get("money_tx") || [] : null,
    moneyLocked: !mOk, freizeit: data.get("freizeit") || [],
  }, kind, Date.now());
  const rows = res.rows.filter((r) => !(r.money && (r.cur == null)));
  root.innerHTML = `
    <div class="cmp-head"><h3>📊 Vergleich</h3>
      <div class="cmp-seg" role="tablist" aria-label="Zeitraum">
        <button type="button" role="tab" data-cmp="week" aria-selected="${kind === "week"}">Woche</button>
        <button type="button" role="tab" data-cmp="month" aria-selected="${kind === "month"}">Monat</button>
      </div></div>
    <div class="cmp-legend"><span><i class="cmp-dot cur"></i>${esc(kind === "month" ? res.cur.label + " (bis jetzt)" : res.cur.label)}</span><span><i class="cmp-dot prev"></i>${esc(res.prev.label)}</span></div>
    <ul class="cmp-rows">${rows.map((r) => `<li class="cmp-row" data-row="${r.id}">
      <div class="cmp-rh"><span class="cmp-t"><span aria-hidden="true">${r.e}</span> ${esc(r.t)}</span>
        <span class="cmp-v"><b>${esc(C.fmt(r, r.cur, eurS))}</b> <small>vorher ${esc(C.fmt(r, r.prev, eurS))}</small></span>
        <span class="cmp-d ${r.mood}" data-dir="${r.dir}">${esc(C.fmtDelta(r, r.delta, eurS))}</span></div>
      ${bars(r, r.cur, r.prev)}
    </li>`).join("")}</ul>
    ${mOk ? "" : `<p class="note cmp-lock">🔐 Einnahmen &amp; Ausgaben sind wegen der Geld-Sperre ausgeblendet.</p>`}`;
}
