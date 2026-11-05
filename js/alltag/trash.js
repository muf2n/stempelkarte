// Papierkorb: was Claude gelöscht hat (users/{uid}/a_trash bzw. lokal "sk-a-trash"), 30 Tage lang.
// Wiederherstellen schreibt über dieselben Wege wie die App (store.saveEntry/saveTodo/savePlace, db.collection().put),
// „Endgültig löschen“ entfernt nur die Papierkorb-Kopie. Reine Logik in ./trash-core.js (auch vom Worker benutzt).
//   import("./alltag/trash.js").then((m) => m.openTrash());
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";
import { collection } from "./db.js";
import { splitPath, restoreDoc, groupBatches, isExpired, TRASH_MS } from "./trash-core.js";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const pad = (n) => String(n).padStart(2, "0");
const SHOW = 6;

export function injectCSS() {
  if (document.getElementById("pk-css")) return;
  const l = document.createElement("link");
  l.id = "pk-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-trash.css", import.meta.url).href;
  document.head.appendChild(l);
}

const trashCol = () => collection("trash");

function fmtWhen(ts) {
  const d = new Date(Number(ts) || 0);
  return `${WD[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function daysLeft(ts) {
  return Math.max(0, Math.ceil((Number(ts) + TRASH_MS - Date.now()) / 86400000));
}

/** Wartet (max. ~4 s), bis eine Alltag-Sammlung ihren ersten echten Stand hat. */
function loaded(col) {
  if (col.all() && col.loaded) return Promise.resolve();
  return new Promise((res) => {
    let off = null;
    const done = () => { clearTimeout(t); if (off) off(); res(); };
    const t = setTimeout(done, 4000);
    off = col.watch(() => { if (col.loaded) setTimeout(done, 0); });
  });
}

function withoutId(o) { if (!o) return null; const { id: _i, ...r } = o; return r; }

async function current(path) {
  const sp = splitPath(path);
  if (!sp) return null;
  const s = store.get();
  if (sp.coll === "entries") return withoutId((s.entries || []).find((x) => x.id === sp.id));
  if (sp.coll === "todos") return withoutId((s.todos || []).find((x) => x.id === sp.id));
  if (sp.coll === "places") return withoutId((s.places || []).find((x) => x.id === sp.id));
  const col = collection(sp.coll.slice(2));
  await loaded(col);
  return withoutId(col.get(sp.id));
}

async function write(path, data) {
  const { coll, id } = splitPath(path);
  const doc = { ...data, id };
  if (coll === "entries") return store.saveEntry(doc);
  if (coll === "todos") return store.saveTodo(doc);
  if (coll === "places") return store.savePlace(doc);
  return collection(coll.slice(2)).put(doc);
}

/** Einen Stapel wiederherstellen → Anzahl wiederhergestellter Elemente. */
export async function restoreBatch(batch) {
  const items = [...batch.items].sort((a, b) => String(a.id).localeCompare(String(b.id), "en", { numeric: true }));
  const state = new Map();
  let n = 0;
  for (const t of items) {
    if (splitPath(t.path)) {
      const cur = state.has(t.path) ? state.get(t.path) : await current(t.path);
      const r = restoreDoc(t, cur);
      if (r.data) { await write(t.path, r.data); state.set(t.path, r.data); n++; }
    }
    await trashCol().remove(t.id);
  }
  return n;
}

export async function purgeBatch(batch) {
  for (const t of batch.items) await trashCol().remove(t.id);
}

function batchHTML(b) {
  const n = b.items.length;
  const shown = b.items.slice(0, SHOW).map((t) => `<li>${esc(t.label || t.path)}</li>`).join("");
  const more = n > SHOW ? `<details class="pk-more"><summary>und ${n - SHOW} weitere</summary><ul>${b.items.slice(SHOW).map((t) => `<li>${esc(t.label || t.path)}</li>`).join("")}</ul></details>` : "";
  const left = daysLeft(b.deletedAt);
  return `<li class="pk-batch" data-b="${esc(b.batchId)}">
    <div class="pk-head">
      <span class="pk-ic" aria-hidden="true">${icon("trash", 18)}</span>
      <div class="pk-ht"><b>${n} ${n === 1 ? "Element" : "Elemente"}</b><small>${esc(fmtWhen(b.deletedAt))} · von ${b.by === "claude" ? "Claude" : esc(b.by)}</small></div>
      <span class="pk-left" title="Wird danach endgültig entfernt">noch ${left} ${left === 1 ? "Tag" : "Tage"}</span>
    </div>
    <ul class="pk-items">${shown}</ul>${more}
    <div class="pk-acts">
      <button type="button" class="btn primary sm" data-pk="restore">Wiederherstellen</button>
      <button type="button" class="btn ghost sm pk-del" data-pk="purge">Endgültig löschen</button>
    </div>
  </li>`;
}

/** Papierkorb als Blatt öffnen. */
export function openTrash() {
  injectCSS();
  const col = trashCol();
  ui.openSheet({
    title: "Papierkorb",
    bodyHTML: `<div class="pk">
      <p class="note pk-intro">Was Claude gelöscht hat, liegt hier ${TRASH_MS / 86400000} Tage – danach wird es endgültig entfernt.</p>
      <ul class="pk-list" aria-live="polite"></ul>
    </div>`,
    onMount(sheet) {
      const list = sheet.querySelector(".pk-list");
      let busy = false;
      let off = null;
      const batchesNow = () => groupBatches(col.all().filter((t) => !isExpired(t, Date.now())));
      function render() {
        if (!list.isConnected) { if (off) off(); return; }
        if (busy) return;
        // abgelaufene still entfernen
        for (const t of col.all()) if (isExpired(t, Date.now())) col.remove(t.id).catch(() => {});
        const bs = batchesNow();
        if (!bs.length) {
          list.innerHTML = `<li class="pk-empty"><span aria-hidden="true">${icon("trash", 28)}</span><b>Der Papierkorb ist leer</b><small>Wenn Claude etwas löscht, kannst du es hier zurückholen.</small></li>`;
          return;
        }
        list.innerHTML = bs.map(batchHTML).join("");
        list.querySelectorAll(".pk-batch").forEach((li) => {
          const b = bs.find((x) => x.batchId === li.dataset.b);
          li.querySelector('[data-pk="restore"]').addEventListener("click", async (ev) => {
            const btn = ev.currentTarget;
            busy = true; ui.setBusy(btn, true, "Stelle wieder her …");
            try {
              const n = await restoreBatch(b);
              ui.toast(n ? `${n} ${n === 1 ? "Element" : "Elemente"} wiederhergestellt ✓` : "War schon wieder da.");
            } catch (err) { console.error(err); ui.toast("Wiederherstellen fehlgeschlagen."); }
            finally { busy = false; render(); }
          });
          ui.confirmButton(li.querySelector('[data-pk="purge"]'), "Wirklich endgültig?", async () => {
            busy = true;
            try { await purgeBatch(b); ui.toast("Endgültig gelöscht."); }
            catch (err) { console.error(err); ui.toast("Löschen fehlgeschlagen."); }
            finally { busy = false; render(); }
          });
        });
      }
      off = col.watch(render);
    },
  });
}
