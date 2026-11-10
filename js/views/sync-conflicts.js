// Update 11 – 🔄 Sync-Konflikte anzeigen und lösen. Ein Konflikt entsteht, wenn ein anderes Gerät (z. B. offline) einen
// Eintrag geändert hat, ohne deine neuere Änderung zu kennen – deine Version wurde dabei überschrieben.
// „Meine Version wiederherstellen“ schreibt sie erneut (dann gilt sie wieder), „Neue behalten“ verwirft den Hinweis.
import * as guard from "../sync-guard.js";
import * as G from "../sync-guard-core.js";
import * as store from "../store.js";
import { collection } from "../alltag/db.js";
import { esc } from "../util.js";

const FIELD = { title: "Titel", name: "Name", text: "Text", note: "Notiz", start: "Beginn", end: "Ende", pauseMin: "Pause", place: "Ort", placeId: "Ort",
  date: "Datum", time: "Uhrzeit", done: "Erledigt", qty: "Menge", amount: "Betrag", status: "Status", segments: "Abschnitte", kind: "Art" };
const fname = (k) => FIELD[k] || k;

async function restore(c) {
  const doc = G.strip(c.mine || {});
  if (!doc.id) throw new Error("Keine Kopie vorhanden");
  if (c.col === "entries") await store.saveEntry(doc);
  else if (c.col === "todos") await store.saveTodo(doc);
  else if (c.col.startsWith("a:")) await collection(c.col.slice(2)).put(doc);
  else throw new Error("Unbekannter Bereich");
}

export function openConflicts(ctx) {
  const ui = ctx.ui;
  ui.openSheet({
    title: "🔄 Sync-Konflikte",
    bodyHTML: `<div class="sc" data-sc="list"></div>`,
    onMount(sheet, close) {
      const box = sheet.querySelector('[data-sc="list"]');
      const draw = () => {
        const list = guard.conflicts();
        if (!list.length) { box.innerHTML = `<p class="note">✅ Keine Konflikte – alles synchron.</p>`; return; }
        box.innerHTML = `<p class="note">Ein anderes Gerät hat diese Einträge geändert, ohne deine neuere Änderung zu kennen (z. B. weil es offline war). Gerade gilt die <b>neue</b> Version. Du entscheidest:</p>` +
          list.map((c, i) => {
            const fields = G.diffFields(c.mine, c.theirs);
            return `<article class="card sc-c"><b>${esc(G.colName(c.col))}: ${esc(G.label(c.theirs || c.mine))}</b>` +
              `<small>${new Date(c.at).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}${fields.length ? ` · anders: ${esc(fields.slice(0, 6).map(fname).join(", "))}` : ""}</small>` +
              (c.mine && G.label(c.mine) !== G.label(c.theirs) ? `<small>Deine Version: „${esc(G.label(c.mine))}“</small>` : "") +
              `<div class="row">${c.mine ? `<button type="button" class="btn ghost sm" data-sc-restore="${i}">↩️ Meine Version wiederherstellen</button>` : `<small class="note">Deine Version war zu groß zum Aufheben.</small>`}` +
              `<button type="button" class="btn primary sm" data-sc-keep="${i}">✓ Neue behalten</button></div></article>`;
          }).join("");
      };
      box.addEventListener("click", async (ev) => {
        const r = ev.target.closest("[data-sc-restore]"), k = ev.target.closest("[data-sc-keep]");
        const list = guard.conflicts();
        if (k) { const c = list[+k.dataset.scKeep]; if (c) guard.dismiss(c.key); draw(); return; }
        if (r) {
          const c = list[+r.dataset.scRestore]; if (!c) return;
          try { await restore(c); guard.dismiss(c.key); ui.toast("↩️ Deine Version gilt wieder"); }
          catch (err) { console.error(err); ui.toast("Wiederherstellen hat nicht geklappt."); }
          draw();
        }
      });
      const off = guard.onChange(draw);
      const obs = new MutationObserver(() => { if (!document.contains(sheet)) { off(); obs.disconnect(); } });
      obs.observe(document.body, { childList: true, subtree: true });
      draw();
    },
  });
}
