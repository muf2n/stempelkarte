// Update 7 (Agent Q): Einstellungs-Karte „Einfacher bedienen“ (#comfort-panel).
// settings.comfort = { bigText, compact } → <html data-big="1"> / <html data-compact="1">.
import { icon } from "../icons.js";
import { readComfort, applyComfort } from "./day.js";

let ctx = null;
let root = null;
let snap = null;

const $ = (sel) => root.querySelector(sel);

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "cf");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico">${icon("heart", 20)}</span>
      <div><div class="rm-title">Einfacher bedienen</div>
      <p class="note">Größere Schrift und eine ruhige Ansicht mit nur dem Wichtigsten.</p></div>
    </div>
    <div class="rm-opt">
      <label class="switch"><span>Große Schrift</span><input type="checkbox" id="cf-big"></label>
    </div>
    <div class="rm-opt">
      <label class="switch"><span>Einfache Ansicht</span><input type="checkbox" id="cf-compact"></label>
      <p class="note cf-note">Im Reiter Heute nur Uhr, große Knöpfe und „Mein Tag“. Notiz, Tätigkeiten und Kennzahlen werden ausgeblendet – du stempelst als „Arbeiten“ ein.</p>
    </div>
    <div class="cf-tip">${icon("sparkle", 18)}<p><b>App-Schnellstart:</b> Lange auf das App-Symbol drücken → Einstempeln / Pause.</p></div>`;

  const onChange = (field) => async (ev) => {
    const cur = readComfort(snap && snap.settings);
    const next = { ...cur, [field]: ev.target.checked };
    applyComfort(next);   // sofort sichtbar, auch bevor der Store antwortet
    try {
      await ctx.store.saveSettings({ comfort: next });
      ctx.ui.toast(field === "bigText"
        ? (next.bigText ? "Große Schrift ist an." : "Große Schrift ist aus.")
        : (next.compact ? "Einfache Ansicht ist an." : "Einfache Ansicht ist aus."));
    } catch { /* Toast kommt vom Store */ }
  };
  $("#cf-big").addEventListener("change", onChange("bigText"));
  $("#cf-compact").addEventListener("change", onChange("compact"));
  if (ctx.store && ctx.store.get) { try { const s = ctx.store.get(); if (s) update(s); } catch { /* egal */ } }
}

export function update(s) {
  snap = s;
  if (!root || !s) return;
  const c = readComfort(s.settings);
  const b = $("#cf-big"), k = $("#cf-compact");
  if (b && b.checked !== c.bigText) b.checked = c.bigText;
  if (k && k.checked !== c.compact) k.checked = c.compact;
}
