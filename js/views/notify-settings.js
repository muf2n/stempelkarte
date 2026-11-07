// Update 10 – 🔔 Einstellungs-Karte „Mitteilungen in der App“ (#notify-panel, Kategorie Benachrichtigungen):
// welche Arten in der Benachrichtigungszentrale (Glocke oben) auftauchen. settings.notify.off = abgeschaltete Kategorien.
// Push-Benachrichtigungen sind davon unabhängig (Karte „Erinnerungen“ darunter).
import { CATS, readPrefs, prefsForSave } from "../notify-core.js";

let ctx = null;
let root = null;

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("rm", "nts");
  root.innerHTML = `
    <div class="rm-head">
      <span class="rm-ico" aria-hidden="true">🔔</span>
      <div><div class="rm-title">Mitteilungen in der App</div>
      <p class="note">Die Glocke oben sammelt, was heute wichtig ist. Such dir aus, was dort auftauchen soll – Push-Erinnerungen bleiben, wie sie sind.</p></div>
    </div>
    <div class="nts-grid" role="group" aria-label="Arten von Mitteilungen">
      ${CATS.map((c) => `<label class="switch nts-row"><input type="checkbox" data-nts="${c.id}" checked><span><span aria-hidden="true">${c.e}</span> ${c.t}</span></label>`).join("")}
    </div>
    <button type="button" class="btn ghost sm" id="nts-open">🔔 Mitteilungen ansehen</button>`;
  root.addEventListener("change", async (ev) => {
    const cb = ev.target.closest("[data-nts]");
    if (!cb) return;
    const off = new Set([...root.querySelectorAll("[data-nts]")].filter((x) => !x.checked).map((x) => x.dataset.nts));
    try { await ctx.store.saveSettings({ notify: prefsForSave(off) }); } catch { /* Toast kommt vom Store */ }
  });
  root.querySelector("#nts-open").addEventListener("click", () => {
    import("./settings-hub.js").then((m) => m.close(() => window.dispatchEvent(new CustomEvent("sk:open-notify")))).catch(() => {});
  });
  if (ctx.store && ctx.store.get) { try { update(ctx.store.get()); } catch { /* egal */ } }
}

export function update(s) {
  if (!root || !s) return;
  const off = readPrefs(s.settings).off;
  root.querySelectorAll("[data-nts]").forEach((x) => {
    if (document.activeElement === x) return;
    const want = !off.has(x.dataset.nts);
    if (x.checked !== want) x.checked = want;
  });
}
