// Update 10 F – 👤 Profile & 🧩 Module (Einstellungen › App-Einstellungen › „Profile & Module“ + Chip im Überblick).
// Logik in ../profiles-core.js. Wechsel speichert settings.profiles + settings.dashboard + settings.notify (+ settings.mode bei Privat/Arbeit).
import * as P from "../profiles-core.js";
import { modeValue } from "../privat-core.js";
import { MODULES } from "../alltag/modules.js";

function ensureCss() {
  if (document.getElementById("css-profiles")) return;
  const l = document.createElement("link");
  l.id = "css-profiles"; l.rel = "stylesheet";
  l.href = new URL("../../css/profiles.css", import.meta.url).href;
  document.head.appendChild(l);
}
const settingsOf = (ctx) => ((ctx.store.get() || {}).settings) || {};

/** Aktives Profil (für Chip/Liste). */
export function activeProfile(settings) { return P.profileById(P.readProfiles(settings).active); }

export async function applyProfile(ctx, id) {
  const s = settingsOf(ctx);
  if (P.readProfiles(s).active === id) return false;
  const patch = P.switchProfile(s, id, { modeFn: (privat) => modeValue(privat, Date.now(), null, "manual") });
  if (patch.mode && (ctx.store.get() || {}).running && patch.mode.privat) delete patch.mode; // eingestempelt bleibt Arbeit
  await ctx.store.saveSettings(patch);
  const p = P.profileById(id);
  ctx.ui.toast(`${p.e} Profil „${p.t}“ ist aktiv`, 2000);
  return true;
}

function profilesHTML(ctx) {
  const esc = ctx.util.esc;
  const act = P.readProfiles(settingsOf(ctx)).active;
  return `<div class="pf-list" role="radiogroup" aria-label="Profil wählen">${P.PROFILES.map((p) =>
    `<button type="button" class="pf-item" role="radio" data-pf="${p.id}" aria-checked="${p.id === act}">
      <span class="pf-e" aria-hidden="true">${p.e}</span><span class="pf-t"><b>${esc(p.t)}</b><small>${esc(p.sub)}</small></span>
      <span class="pf-dot" aria-hidden="true"></span></button>`).join("")}</div>`;
}

/** Profil-Auswahl als Blatt (Chip im Überblick). */
export function openSwitcher(ctx) {
  ensureCss();
  const sh = ctx.ui.openSheet({
    title: "👤 Profil wählen",
    bodyHTML: `<p class="note">Ein Profil stellt deinen Überblick und die Mitteilungen passend ein. Was du darin anpasst, merkt es sich 💡</p>
      <div data-pf-wrap>${profilesHTML(ctx)}</div>
      <button type="button" class="btn ghost sm pf-more" data-pf-more>⚙️ Profile &amp; Module verwalten</button>`,
  });
  sh.el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-pf]");
    if (b) {
      try { await applyProfile(ctx, b.dataset.pf); } catch (e) { console.error(e); ctx.ui.toast("Konnte nicht speichern – bitte nochmal probieren."); return; }
      sh.close();
      return;
    }
    if (ev.target.closest("[data-pf-more]")) { sh.close(); window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: "profile" } })); }
  });
  return sh;
}

/** Inhalt der Einstellungsseite. Rendert neu bei jedem Aufruf (update). */
export function mountPanel(el, ctx) {
  ensureCss();
  if (!el) return;
  if (!el.dataset.pfInit) {
    el.dataset.pfInit = "1";
    el.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-pf]");
      if (b) {
        try { await applyProfile(ctx, b.dataset.pf); } catch (e) { console.error(e); ctx.ui.toast("Konnte nicht speichern – bitte nochmal probieren."); }
        render(); return;
      }
      const r = ev.target.closest("[data-pf-reset]");
      if (r) {
        try { await ctx.store.saveSettings(P.resetProfile(settingsOf(ctx), P.readProfiles(settingsOf(ctx)).active)); ctx.ui.toast("↺ Profil auf Vorgabe zurückgesetzt", 1800); }
        catch (e) { console.error(e); ctx.ui.toast("Konnte nicht speichern."); }
        render();
      }
    });
    el.addEventListener("change", async (ev) => {
      const t = ev.target.closest("[data-mod]");
      if (!t) return;
      try {
        await ctx.store.saveSettings({ modules: P.toggleModule(settingsOf(ctx), t.dataset.mod, t.checked) });
        const m = MODULES.find((x) => x.id === t.dataset.mod);
        ctx.ui.toast(t.checked ? `✅ ${m ? m.short || m.title : "Bereich"} ist wieder da` : `🙈 ${m ? m.short || m.title : "Bereich"} ausgeblendet – deine Daten bleiben`, 2200);
      } catch (e) { console.error(e); ctx.ui.toast("Konnte nicht speichern."); t.checked = !t.checked; }
      render();
    });
  }
  function render() {
    const esc = ctx.util.esc;
    const s = settingsOf(ctx);
    const off = P.modulesOff(s);
    const act = activeProfile(s);
    el.innerHTML = `
      <div class="sh-card"><div class="lbl">👤 Profil</div>
        <p class="note">Wechsel mit einem Tipp – auch über den Chip im Heute-Überblick. Profile stellen Widgets, Mitteilungen und bei 🏡 Privat/🌴 Urlaub/💼 Arbeit den Privat-Modus ein.</p>
        ${profilesHTML(ctx)}
        ${act.id !== "standard" ? `<button type="button" class="btn ghost sm" data-pf-reset>↺ „${esc(act.t)}“ auf Vorgabe zurücksetzen</button>` : ""}
      </div>
      <div class="sh-card"><div class="lbl">🧩 Module ein/aus</div>
        <p class="note">Ausgeschaltete Bereiche verschwinden aus Alltag, Suche, Mitteilungen und dem Überblick. Deine Daten bleiben gespeichert 🔒</p>
        <ul class="pf-mods">${MODULES.map((m) => `<li><label class="switch"><input type="checkbox" data-mod="${esc(m.id)}"${off.has(m.id) ? "" : " checked"}><span>${esc(m.title)}</span></label></li>`).join("")}</ul>
      </div>`;
  }
  render();
  return render;
}
