// Unterwegs › Packlisten: Ansicht einer Liste (Fortschritt, aufklappbare Kategorien mit x/y, Häkchen, Menge,
// Hinzufügen/Entfernen, Umsortieren per Pfeil-Knöpfen), Vorlagen, Zurücksetzen, Teilen.
// Sammlung travel_packing: { id, kind: "trip"|"template", tripId?, title, emoji?, cats: [{id,key,name,emoji,items:[{id,name,qty,done}]}] }
import * as C from "./unterwegs-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import { shareText, safeWrite } from "./unterwegs-shared.js";

const OPEN_KEY = "sk-uw-open";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export function createPack({ col, trips, ui, queue }) {
  let open;
  try { open = new Set(JSON.parse(lsGet(OPEN_KEY) || "[]")); } catch { open = new Set(); }
  const editing = new Set();
  let refocus = null; // { list, cat } – nach Hinzufügen wieder ins Feld

  const saveOpen = () => lsSet(OPEN_KEY, JSON.stringify([...open].slice(-200)));

  async function mutate(listId, fn, msg) {
    const cur = col.get(listId);
    if (!cur) return;
    const next = JSON.parse(JSON.stringify(cur));
    fn(next);
    await safeWrite(ui, col.put(next), msg);
  }
  const findCat = (l, cid) => (l.cats || []).find((c) => c.id === cid);

  /* ---------- Rendern ---------- */

  function progressHTML(list) {
    const p = C.packProgress(list);
    return `<div class="uw-prog" data-pct="${p.pct}">` +
      `<span class="uw-prog-n"><b>${p.total}</b> ${p.total === 1 ? "Gegenstand" : "Gegenstände"}</span>` +
      `<div class="uw-prog-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}" aria-label="Gepackt"><div style="width:${p.pct}%"></div></div>` +
      `<span class="uw-prog-p">${p.pct} %</span>` +
    `</div>`;
  }

  function itemHTML(list, c, it, i, n, edit) {
    const L = esc(list.id), K = esc(c.id), I = esc(it.id);
    if (edit) {
      return `<li class="uw-it edit">` +
        `<input class="uw-it-name" data-pk-name data-list="${L}" data-cat="${K}" data-item="${I}" value="${esc(it.name)}" aria-label="Name">` +
        `<input class="uw-it-qty" type="number" inputmode="numeric" min="1" max="99" data-pk-qty data-list="${L}" data-cat="${K}" data-item="${I}" value="${it.qty || 1}" aria-label="Menge">` +
        `<span class="uw-it-tools">` +
          `<button type="button" class="uw-ib" data-pk="iup" data-list="${L}" data-cat="${K}" data-item="${I}" aria-label="Nach oben"${i === 0 ? " disabled" : ""}>▲</button>` +
          `<button type="button" class="uw-ib" data-pk="idown" data-list="${L}" data-cat="${K}" data-item="${I}" aria-label="Nach unten"${i === n - 1 ? " disabled" : ""}>▼</button>` +
          `<button type="button" class="uw-ib del" data-pk="idel" data-list="${L}" data-cat="${K}" data-item="${I}" aria-label="Entfernen">${icon("trash", 16)}</button>` +
        `</span>` +
      `</li>`;
    }
    return `<li class="uw-it${it.done ? " done" : ""}">` +
      `<button type="button" class="uw-it-check" role="checkbox" aria-checked="${!!it.done}" data-pk="check" data-list="${L}" data-cat="${K}" data-item="${I}">` +
        `<span class="uw-box" aria-hidden="true">${it.done ? icon("check", 14) : ""}</span>` +
        `<span class="uw-it-t">${esc(it.name)}</span>` +
      `</button>` +
      `<span class="uw-it-q">` +
        `<button type="button" class="uw-ib" data-pk="qminus" data-list="${L}" data-cat="${K}" data-item="${I}" aria-label="Menge weniger"${(it.qty || 1) <= 1 ? " disabled" : ""}>−</button>` +
        `<b aria-label="Menge">×${it.qty || 1}</b>` +
        `<button type="button" class="uw-ib" data-pk="qplus" data-list="${L}" data-cat="${K}" data-item="${I}" aria-label="Menge mehr">+</button>` +
      `</span>` +
    `</li>`;
  }

  function catHTML(list, c, ci, nc, edit) {
    const cp = C.catProgress(c);
    const isOpen = open.has(c.id);
    const complete = cp.total > 0 && cp.done === cp.total;
    const L = esc(list.id), K = esc(c.id);
    const items = c.items || [];
    return `<section class="uw-pc${isOpen ? " open" : ""}${complete ? " complete" : ""}" data-cat="${K}">` +
      `<div class="uw-pc-headrow">` +
        `<button type="button" class="uw-pc-head" data-pk="toggle" data-list="${L}" data-cat="${K}" aria-expanded="${isOpen}">` +
          `<span class="uw-pc-emo" aria-hidden="true">${esc(c.emoji || "📦")}</span>` +
          `<b class="uw-pc-name">${esc(c.name)}</b>` +
          `<span class="uw-pc-cnt">${complete ? icon("check", 13) : ""}${cp.done}/${cp.total}</span>` +
          `<span class="uw-pc-chev" aria-hidden="true">${icon("chevron-right", 18)}</span>` +
        `</button>` +
        (edit ? `<span class="uw-pc-tools">` +
          `<button type="button" class="uw-ib" data-pk="cup" data-list="${L}" data-cat="${K}" aria-label="Kategorie nach oben"${ci === 0 ? " disabled" : ""}>▲</button>` +
          `<button type="button" class="uw-ib" data-pk="cdown" data-list="${L}" data-cat="${K}" aria-label="Kategorie nach unten"${ci === nc - 1 ? " disabled" : ""}>▼</button>` +
          `<button type="button" class="uw-ib" data-pk="cren" data-list="${L}" data-cat="${K}" aria-label="Kategorie umbenennen">${icon("pencil", 15)}</button>` +
          `<button type="button" class="uw-ib del" data-pk="cdel" data-list="${L}" data-cat="${K}" aria-label="Kategorie löschen">${icon("trash", 15)}</button>` +
        `</span>` : "") +
      `</div>` +
      (isOpen ? `<div class="uw-pc-body">` +
        (items.length ? `<ul class="uw-items">${items.map((it, i) => itemHTML(list, c, it, i, items.length, edit)).join("")}</ul>` : `<p class="note uw-pc-empty">Noch nichts in „${esc(c.name)}“.</p>`) +
        `<form class="uw-add" data-pk-add data-list="${L}" data-cat="${K}">` +
          `<span class="uw-add-ic" aria-hidden="true">${icon("plus", 16)}</span>` +
          `<input id="pk-add-${K}" name="n" placeholder="Gegenstand hinzufügen" autocomplete="off" enterkeyhint="done" aria-label="Neuer Gegenstand in ${esc(c.name)}">` +
          `<input name="q" class="uw-add-q" type="number" inputmode="numeric" min="1" max="99" placeholder="1" aria-label="Menge">` +
          `<button type="submit" class="uw-add-go" aria-label="Hinzufügen">${icon("check", 16)}</button>` +
        `</form>` +
      `</div>` : "") +
    `</section>`;
  }

  /** Volle Listenansicht. opts.embedded → ohne Titelzeile (in der Reise). */
  function listHTML(list, { embedded = false } = {}) {
    const edit = editing.has(list.id);
    const cats = list.cats || [];
    const trip = list.tripId ? trips().find((t) => t.id === list.tripId) : null;
    const L = esc(list.id);
    return `<div class="uw-pack" data-list="${L}">` +
      (embedded ? "" : `<div class="uw-pack-head">` +
        `<div class="uw-pack-t"><h3>${esc(list.emoji ? list.emoji + " " : "")}${esc(list.title || "Packliste")}</h3>` +
        `<small>${list.kind === "template" ? "Eigene Vorlage" : trip ? esc(trip.title) + (trip.from ? " · " + esc(C.dateRange(trip)) : "") : "Packliste"}</small></div>` +
      `</div>`) +
      progressHTML(list) +
      `<div class="uw-pack-tools">` +
        `<button type="button" class="chip${edit ? " on" : ""}" data-pk="edit" data-list="${L}" aria-pressed="${edit}">${icon("pencil", 15)} ${edit ? "Fertig" : "Bearbeiten"}</button>` +
        `<button type="button" class="chip" data-pk="share" data-list="${L}">${icon("share", 15)} Teilen</button>` +
        `<button type="button" class="chip" data-pk="reset" data-list="${L}">${icon("repeat", 15)} Alles zurücksetzen</button>` +
        (list.kind !== "template" ? `<button type="button" class="chip" data-pk="savetpl" data-list="${L}">${icon("copy", 15)} Als Vorlage</button>` : "") +
      `</div>` +
      `<div class="uw-cats">${cats.map((c, i) => catHTML(list, c, i, cats.length, edit)).join("")}</div>` +
      `<button type="button" class="uw-addcat" data-pk="addcat" data-list="${L}">${icon("plus", 16)} Kategorie hinzufügen</button>` +
      (edit ? `<button type="button" class="btn danger sm uw-dellist" data-pk="dellist" data-list="${L}">Liste löschen</button>` : "") +
    `</div>`;
  }

  function templatePickerHTML(act = "fromtpl", extra = "") {
    const own = col.all().filter((l) => l.kind === "template");
    return `<div class="uw-tpls">` +
      C.TEMPLATE_KEYS.map((k) => {
        const m = C.templateMeta(k);
        return `<button type="button" class="uw-tpl" data-pk="${act}" data-tpl="${esc(k)}"${extra}>` +
          `<span class="uw-tpl-emo" aria-hidden="true">${m.emoji}</span><span class="uw-tpl-t"><b>${esc(m.title)}</b><small>${esc(m.sub)} · ${m.count} Dinge</small></span></button>`;
      }).join("") +
      own.map((l) => `<button type="button" class="uw-tpl own" data-pk="${act}" data-own="${esc(l.id)}"${extra}>` +
        `<span class="uw-tpl-emo" aria-hidden="true">${esc(l.emoji || "📋")}</span><span class="uw-tpl-t"><b>${esc(l.title)}</b><small>Eigene Vorlage · ${C.packProgress(l).total} Dinge</small></span></button>`).join("") +
      `<button type="button" class="uw-tpl blank" data-pk="${act}" data-tpl=""${extra}><span class="uw-tpl-emo" aria-hidden="true">📝</span><span class="uw-tpl-t"><b>Leere Liste</b><small>Selbst zusammenstellen</small></span></button>` +
    `</div>`;
  }

  function catsFrom(t) {
    if (t.dataset.own) { const src = col.get(t.dataset.own); return src ? C.cloneCats(src.cats) : []; }
    if (t.dataset.tpl) return C.templateCats(t.dataset.tpl);
    return [C.newCat("wichtig"), C.newCat("kleidung"), C.newCat("hygiene")];
  }

  /** Neue Liste aus Vorlage-Knopf t anlegen → id */
  async function createFrom(t, { tripId = null, title = "", kind = "trip" } = {}) {
    const cats = catsFrom(t);
    const meta = t.dataset.tpl ? C.templateMeta(t.dataset.tpl) : null;
    const src = t.dataset.own ? col.get(t.dataset.own) : null;
    const item = {
      kind, tripId, cats,
      title: title || (meta ? meta.title : src ? src.title : "Neue Packliste"),
      emoji: meta ? meta.emoji : src ? src.emoji || "" : "🧳",
    };
    if (cats[0]) open.add(cats[0].id), saveOpen();
    return col.put(item);
  }

  /* ---------- Sheets ---------- */

  function openAddCat(listId) {
    const list = col.get(listId);
    if (!list) return;
    const have = new Set((list.cats || []).map((c) => c.key));
    ui.openSheet({
      title: "Kategorie hinzufügen",
      bodyHTML: `<div class="fields">` +
        `<div class="chips uw-catchips">${C.PACK_CATS.map((c) => `<button type="button" class="chip" data-key="${c.key}"${have.has(c.key) && c.key !== "sonstiges" ? " disabled" : ""}>${c.emoji} ${esc(c.name)}</button>`).join("")}</div>` +
        `<div class="row"><label style="flex:0 0 84px">Symbol<input id="uw-cat-emo" maxlength="4" placeholder="📦"></label>` +
        `<label>Eigener Name<input id="uw-cat-name" maxlength="30" placeholder="z. B. Camping"></label></div>` +
        `<button type="button" class="btn primary" data-save>Eigene Kategorie anlegen</button>` +
      `</div>`,
      onMount(sheet, close) {
        const add = async (c) => { close(); open.add(c.id); saveOpen(); await mutate(listId, (l) => { (l.cats = l.cats || []).push(c); }); };
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-key]");
          if (b && !b.disabled) add(C.newCat(b.dataset.key));
        });
        sheet.querySelector("[data-save]").addEventListener("click", () => {
          const name = sheet.querySelector("#uw-cat-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          add(C.newCat("sonstiges", name, sheet.querySelector("#uw-cat-emo").value.trim() || "📦"));
        });
      },
    });
  }

  function openRenameCat(listId, catId) {
    const list = col.get(listId);
    const c = list && findCat(list, catId);
    if (!c) return;
    ui.openSheet({
      title: "Kategorie umbenennen",
      bodyHTML: `<div class="fields"><div class="row"><label style="flex:0 0 84px">Symbol<input id="uw-rc-emo" maxlength="4" value="${esc(c.emoji || "")}"></label>` +
        `<label>Name<input id="uw-rc-name" maxlength="30" value="${esc(c.name)}"></label></div>` +
        `<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const name = sheet.querySelector("#uw-rc-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          const emoji = sheet.querySelector("#uw-rc-emo").value.trim();
          close();
          await mutate(listId, (l) => { const x = findCat(l, catId); if (x) { x.name = name; x.emoji = emoji || x.emoji; } });
        });
      },
    });
  }

  function openSaveTemplate(listId) {
    const list = col.get(listId);
    if (!list) return;
    ui.openSheet({
      title: "Als Vorlage speichern",
      bodyHTML: `<div class="fields"><p class="note" style="margin:0">Die Liste wird ohne Häkchen als eigene Vorlage gespeichert und kann für weitere Reisen verwendet werden.</p>` +
        `<label>Name der Vorlage<input id="uw-tpl-name" maxlength="40" value="${esc(list.title || "Meine Vorlage")}"></label>` +
        `<button type="button" class="btn primary" data-save>Vorlage speichern</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const title = sheet.querySelector("#uw-tpl-name").value.trim() || "Meine Vorlage";
          close();
          await safeWrite(ui, col.put({ kind: "template", tripId: null, title, emoji: list.emoji || "📋", cats: C.cloneCats(list.cats) }), "Vorlage gespeichert ✓");
        });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  function armed(t, label) {
    if (t.dataset.armed === "1") return true;
    const orig = t.innerHTML;
    t.dataset.armed = "1"; t.textContent = label;
    setTimeout(() => { if (t.isConnected && t.dataset.armed === "1") { delete t.dataset.armed; t.innerHTML = orig; } }, 4000);
    return false;
  }

  /** Klick auf [data-pk] → true, wenn behandelt. Gibt bei Bedarf onCreated(id) weiter. */
  function onClick(t, { onDeleted } = {}) {
    const a = t.dataset.pk;
    if (!a) return false;
    const L = t.dataset.list, K = t.dataset.cat, I = t.dataset.item;
    const itemOp = (fn) => mutate(L, (l) => { const c = findCat(l, K); if (!c) return; const i = (c.items || []).findIndex((x) => x.id === I); if (i >= 0) fn(c, i); });
    const catOp = (fn) => mutate(L, (l) => { const i = (l.cats || []).findIndex((x) => x.id === K); if (i >= 0) fn(l, i); });
    switch (a) {
      case "toggle":
        if (open.has(K)) open.delete(K); else open.add(K);
        saveOpen(); queue(); return true;
      case "check": itemOp((c, i) => { c.items[i].done = !c.items[i].done; }); return true;
      case "qplus": itemOp((c, i) => { c.items[i].qty = Math.min(99, (c.items[i].qty || 1) + 1); }); return true;
      case "qminus": itemOp((c, i) => { c.items[i].qty = Math.max(1, (c.items[i].qty || 1) - 1); }); return true;
      case "iup": itemOp((c, i) => { c.items = C.moveIn(c.items, i, -1); }); return true;
      case "idown": itemOp((c, i) => { c.items = C.moveIn(c.items, i, 1); }); return true;
      case "idel": itemOp((c, i) => { c.items.splice(i, 1); }); return true;
      case "cup": catOp((l, i) => { l.cats = C.moveIn(l.cats, i, -1); }); return true;
      case "cdown": catOp((l, i) => { l.cats = C.moveIn(l.cats, i, 1); }); return true;
      case "cren": openRenameCat(L, K); return true;
      case "cdel": {
        const l = col.get(L); const c = l && findCat(l, K);
        if (c && (c.items || []).length && !armed(t, "Sicher?")) return true;
        catOp((l2, i) => { l2.cats.splice(i, 1); });
        return true;
      }
      case "edit": if (editing.has(L)) editing.delete(L); else editing.add(L); queue(); return true;
      case "addcat": openAddCat(L); return true;
      case "reset":
        if (!armed(t, "Wirklich alle Häkchen entfernen?")) return true;
        { const l = col.get(L); if (l) safeWrite(ui, col.put(C.resetList(l)), "Alles zurückgesetzt"); }
        return true;
      case "share": {
        const l = col.get(L); if (!l) return true;
        const trip = l.tripId ? trips().find((x) => x.id === l.tripId) : null;
        shareText(ui, l.title || "Packliste", C.packText(l, trip));
        return true;
      }
      case "savetpl": openSaveTemplate(L); return true;
      case "dellist":
        if (!armed(t, "Wirklich löschen?")) return true;
        editing.delete(L);
        safeWrite(ui, col.remove(L), "Liste gelöscht").then(() => onDeleted && onDeleted(L));
        return true;
      default: return false;
    }
  }

  function onSubmit(ev) {
    const f = ev.target.closest("[data-pk-add]");
    if (!f) return false;
    ev.preventDefault();
    const name = f.elements.n.value.trim();
    if (!name) { f.elements.n.focus(); return true; }
    const qty = Number(f.elements.q.value) || 1;
    const L = f.dataset.list, K = f.dataset.cat;
    refocus = "pk-add-" + K;
    mutate(L, (l) => { const c = findCat(l, K); if (c) (c.items = c.items || []).push(C.newItem(name, qty)); });
    return true;
  }

  function onChange(ev) {
    const t = ev.target;
    if (t.matches("[data-pk-qty]")) {
      const q = Math.max(1, Math.min(99, Math.round(Number(t.value) || 1)));
      mutate(t.dataset.list, (l) => { const c = findCat(l, t.dataset.cat); const it = c && c.items.find((x) => x.id === t.dataset.item); if (it) it.qty = q; });
      return true;
    }
    if (t.matches("[data-pk-name]")) {
      const n = t.value.trim();
      if (!n) { queue(); return true; }
      mutate(t.dataset.list, (l) => { const c = findCat(l, t.dataset.cat); const it = c && c.items.find((x) => x.id === t.dataset.item); if (it) it.name = n; });
      return true;
    }
    return false;
  }

  /** Nach dem Neuzeichnen: Fokus ins Hinzufügen-Feld zurück. */
  function afterRender(root) {
    if (!refocus) return;
    const n = root.querySelector("#" + CSS.escape(refocus));
    if (n) { refocus = null; n.focus({ preventScroll: true }); }
  }

  return { listHTML, progressHTML, templatePickerHTML, createFrom, onClick, onSubmit, onChange, afterRender, open, saveOpen };
}
