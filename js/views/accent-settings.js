// Update 10 (Welle 1a): Einstellungs-Karte „Deine Farbe“ (#accent-panel) – Akzentfarbe wählen.
// settings.accent (wird mit dem Konto synchronisiert) → <html data-accent="…">, siehe js/accent.js.
import { ACCENTS, readAccent, applyAccent } from "../accent.js";

let ctx = null;
let root = null;
let snap = null;

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "acc");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico acc-ico" aria-hidden="true">🎨</span>
      <div><div class="rm-title">Deine Farbe</div>
      <p class="note">Such dir aus, in welcher Farbe die App leuchtet – gilt für hell und dunkel.</p></div>
    </div>
    <div class="acc-grid" role="radiogroup" aria-label="Akzentfarbe">
      ${ACCENTS.map((a) => `<button type="button" class="acc-sw" role="radio" aria-checked="false" data-accent-pick="${a.id}" style="--sw:${a.sw}">` +
        `<span class="acc-dot" aria-hidden="true"></span><span class="acc-name">${a.name}</span></button>`).join("")}
    </div>`;

  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-accent-pick]");
    if (!b || !root.contains(b)) return;
    const id = b.dataset.accentPick;
    if (b.classList.contains("on")) return;
    applyAccent(id);   // sofort sichtbar
    mark(id);
    const a = ACCENTS.find((x) => x.id === id);
    try {
      if (ctx.store && ctx.store.saveSettings) await ctx.store.saveSettings({ accent: id });
      ctx.ui.toast(`🎨 ${a ? a.name : "Farbe"} – schaut gut aus!`);
    } catch { /* Toast kommt vom Store */ }
  });
  mark(document.documentElement.dataset.accent || "lila");
  if (ctx.store && ctx.store.get) { try { const s = ctx.store.get(); if (s) update(s); } catch { /* egal */ } }
}

function mark(id) {
  if (!root) return;
  root.querySelectorAll("[data-accent-pick]").forEach((b) => {
    const on = b.dataset.accentPick === id;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.classList.toggle("on", on);
  });
}

export function update(s) {
  snap = s;
  if (!root || !s || !s.settings) return;
  const id = readAccent(s.settings);
  mark(id);
}
