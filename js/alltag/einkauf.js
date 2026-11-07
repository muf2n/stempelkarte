// Update 10 – Alltag › 🛒 Einkaufsliste (#alltag/einkauf).
// Listen (Privat, Baustelle, eigene), Artikel mit Menge/Einheit und Kategorie, abhaken (Erledigtes rutscht nach unten),
// „Erledigte löschen“ zweistufig, Schnell-Eingabe („2 kg Äpfel“) mit Vorschlägen aus dem Verlauf, Teilen als Text.
// „🧰 Material fehlt“: Material mit Status „brauche“ (Alltag › Material) erscheint live – keine Kopie; Abhaken setzt dort „besorgt“.
// Sammlungen: einkauf (Artikel), einkauf_lists (Listen + Dokument "history"). Reine Logik: ./einkauf-core.js
import { collection } from "./db.js";
import * as E from "./einkauf-core.js";
import * as ui from "../ui.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";

const LIST_KEY = "sk-ek-list";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function injectCSS() {
  if (document.getElementById("ek-css")) return;
  const l = document.createElement("link");
  l.id = "ek-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-einkauf.css", import.meta.url).href;
  document.head.appendChild(l);
}

const safe = (p) => Promise.resolve(p).catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); });

export function mount(el) {
  injectCSS();
  const items = collection("einkauf");
  const listsCol = collection("einkauf_lists");
  const mat = collection("material_items");
  const S = { list: lsGet(LIST_KEY) || "privat", q: "", cat: "", focus: false, showDone: true };
  let alive = true, queued = false;
  const queue = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  };

  el.innerHTML =
    `<div class="ek">
      <div class="ek-lists" role="tablist" aria-label="Einkaufslisten"></div>
      <div class="ek-page"></div>
    </div>`;
  const listsEl = el.querySelector(".ek-lists");
  const page = el.querySelector(".ek-page");

  const lists = () => E.listsOf(listsCol.all());
  const history = () => E.historyOf(listsCol.all());
  const itemsOf = (id) => items.all().map((x) => E.normItem(x)).filter((x) => x.listId === id && x.name);
  const matRows = () => E.materialRows(mat.all());
  const curList = () => {
    const ls = lists();
    if (S.list === E.MATERIAL_LIST) return { id: E.MATERIAL_LIST, name: "Material fehlt", e: "🧰", virtual: true };
    return ls.find((l) => l.id === S.list) || ls[0];
  };

  /* ---------- Anzeige ---------- */

  function renderLists() {
    const cur = curList();
    const ls = lists();
    const mOpen = E.openCount(matRows());
    listsEl.innerHTML = ls.map((l) => {
      const n = E.openCount(itemsOf(l.id));
      return `<button type="button" role="tab" class="ek-lt" data-list="${esc(l.id)}" aria-selected="${l.id === cur.id}"><span aria-hidden="true">${esc(l.e)}</span><span>${esc(l.name)}</span>${n ? `<span class="ek-lt-n">${n}</span>` : ""}</button>`;
    }).join("") +
      `<button type="button" role="tab" class="ek-lt ek-lt-mat" data-list="${E.MATERIAL_LIST}" aria-selected="${cur.id === E.MATERIAL_LIST}"><span aria-hidden="true">🧰</span><span>Material fehlt</span>${mOpen ? `<span class="ek-lt-n">${mOpen}</span>` : ""}</button>` +
      `<button type="button" class="ek-lt ek-lt-add" data-x="newlist" aria-label="Neue Liste anlegen">＋ Liste</button>`;
  }

  function rowHTML(it) {
    const c = E.catById(it.cat);
    const q = E.qtyText(it.qty, it.unit);
    return `<li class="ek-row${it.done ? " done" : ""}" data-id="${esc(it.id)}">
      <button type="button" class="ek-check" data-x="toggle" aria-pressed="${it.done}" aria-label="${esc(it.name)} ${it.done ? "wieder offen" : "abhaken"}"><span aria-hidden="true">${it.done ? "✓" : ""}</span></button>
      <button type="button" class="ek-txt" data-x="edit" aria-label="${esc(it.name)} bearbeiten">
        <span class="ek-name">${q ? `<b class="ek-q">${esc(q)}</b> ` : ""}${esc(it.name)}</span>
        ${it.note ? `<small>${esc(it.note)}</small>` : ""}
      </button>
      ${it.done ? "" : `<span class="ek-cat-e" title="${esc(c.label)}" aria-hidden="true">${c.e}</span>`}
    </li>`;
  }

  function addFormHTML() {
    const catOpts = [`<option value="">✨ Automatisch</option>`, ...E.CATS.map((c) => `<option value="${c.id}"${S.cat === c.id ? " selected" : ""}>${c.e} ${esc(c.label)}</option>`)].join("");
    return `<form class="ek-add card" autocomplete="off">
      <label class="ek-add-row">
        <span class="sr">Artikel hinzufügen</span>
        <input type="text" class="ek-in" id="ek-in" placeholder="Was brauchst du? z. B. 2 kg Äpfel" enterkeyhint="done" maxlength="120" value="${esc(S.q)}">
        <button type="submit" class="btn primary ek-go" aria-label="Hinzufügen">${icon("plus", 20)}</button>
      </label>
      <div class="ek-add-opts">
        <label class="ek-cat-sel"><span class="sr">Kategorie</span><select id="ek-cat">${catOpts}</select></label>
        <span class="ek-guess note" aria-live="polite"></span>
      </div>
      <div class="ek-sugg" aria-label="Vorschläge"></div>
    </form>`;
  }

  function renderSugg() {
    const box = page.querySelector(".ek-sugg");
    if (!box) return;
    const list = curList();
    const sugg = E.suggest(S.q, history().names, itemsOf(list.id), 8);
    box.innerHTML = sugg.length ? (S.q ? "" : `<span class="ek-sugg-h note">Oft gekauft:</span>`) +
      sugg.map((x) => `<button type="button" class="ek-chip" data-sugg="${esc(x.name)}" data-cat="${esc(x.cat)}" data-unit="${esc(x.unit)}">${E.catById(x.cat).e} ${esc(x.name)}</button>`).join("") : "";
    const g = page.querySelector(".ek-guess");
    if (g) {
      const p = E.parseQuick(S.q);
      g.textContent = p.name && !S.cat ? `→ ${E.catById(E.guessCat(p.name, history())).e} ${E.catById(E.guessCat(p.name, history())).label}` : "";
    }
  }

  function listHTML(list) {
    const all = E.sortItems(itemsOf(list.id));
    const open = all.filter((x) => !x.done);
    const done = all.filter((x) => x.done);
    const groups = E.groupOpen(all);
    const head = `<div class="ek-head">
      <h3 class="ek-h"><span aria-hidden="true">${esc(list.e)}</span> ${esc(list.name)} <span class="ek-sum">${open.length ? `${open.length} offen` : "alles erledigt ✨"}</span></h3>
      <button type="button" class="ek-ib" data-x="share" aria-label="Liste teilen">${icon("share", 18)}</button>
      <button type="button" class="ek-ib" data-x="editlist" aria-label="Liste bearbeiten">${icon("pencil", 18)}</button>
    </div>`;
    const body = !all.length
      ? `<div class="empty ek-empty"><div class="ek-empty-emo">🛒</div><h3>Noch leer</h3><p>Tipp oben einfach rein, was du brauchst – „2 kg Äpfel“, „Milch“, „3x Wago 221“. Die Kategorie errät die App für dich.</p></div>`
      : groups.map((g) => `<section class="ek-group"><h4 class="ek-gh"><span aria-hidden="true">${g.cat.e}</span> ${esc(g.cat.label)} <span class="ek-gn">${g.items.length}</span></h4><ul class="ek-ul">${g.items.map(rowHTML).join("")}</ul></section>`).join("") +
        (done.length ? `<section class="ek-group ek-done"><div class="ek-gh ek-gh-done"><span>✅ Erledigt</span> <span class="ek-gn">${done.length}</span>
            <button type="button" class="chip sm ek-clear" data-x="cleardone">🗑️ Erledigte löschen</button></div>
            <ul class="ek-ul">${done.map(rowHTML).join("")}</ul></section>` : "") +
        (!open.length && done.length ? `<p class="note ek-tip">Alles im Wagerl? 🎉 Erledigtes kannst du unten wegräumen.</p>` : "");
    return head + addFormHTML() + body;
  }

  function matHTML() {
    const rows = matRows();
    const open = rows.filter((x) => !x.done);
    const head = `<div class="ek-head">
      <h3 class="ek-h"><span aria-hidden="true">🧰</span> Material fehlt <span class="ek-sum">${open.length ? `${open.length} offen` : "nichts offen 👍"}</span></h3>
      ${rows.length ? `<button type="button" class="ek-ib" data-x="share" aria-label="Liste teilen">${icon("share", 18)}</button>` : ""}
    </div>
    <p class="note ek-mat-note">Kommt automatisch aus <b>Alltag › Material</b> (Status „Brauche ich“). Abhaken = <b>besorgt</b> – im Material-Bereich geht's dann weiter mit „vor Ort“ und „verbaut“.</p>`;
    if (!mat.loaded && !rows.length) return head + `<p class="note">Material wird geladen …</p>`;
    if (!rows.length) return head + `<div class="empty ek-empty"><div class="ek-empty-emo">🧰</div><h3>Alles da</h3><p>Sobald du im Material-Bereich etwas als „Brauche ich“ einträgst, steht es hier.</p><a class="btn sm" href="#alltag/material">🧰 Zum Material</a></div>`;
    const byPlace = new Map();
    for (const r of rows.filter((x) => !x.done)) { const k = r.place || "Ohne Baustelle"; if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(r); }
    const doneRows = rows.filter((x) => x.done);
    const line = (r) => `<li class="ek-row${r.done ? " done" : ""}" data-mid="${esc(r.id)}">
        <button type="button" class="ek-check" data-x="mtoggle" aria-pressed="${r.done}" aria-label="${esc(r.name)} ${r.done ? "wieder auf brauche" : "als besorgt abhaken"}"><span aria-hidden="true">${r.done ? "✓" : ""}</span></button>
        <span class="ek-txt ek-txt-static"><span class="ek-name"><b class="ek-q">${esc(E.fmtNum(r.qty))} ${esc(r.unit)}</b> ${esc(r.name)}</span>${r.done ? `<small>besorgt ✓</small>` : ""}</span>
      </li>`;
    return head +
      [...byPlace.entries()].map(([pl, list]) => `<section class="ek-group"><h4 class="ek-gh"><span aria-hidden="true">📍</span> ${esc(pl)} <span class="ek-gn">${list.length}</span></h4><ul class="ek-ul">${list.map(line).join("")}</ul></section>`).join("") +
      (doneRows.length ? `<section class="ek-group ek-done"><div class="ek-gh ek-gh-done"><span>✅ Gerade besorgt</span> <span class="ek-gn">${doneRows.length}</span></div><ul class="ek-ul">${doneRows.map(line).join("")}</ul></section>` : "") +
      `<a class="btn sm ghost ek-mat-link" href="#alltag/material">🧰 Zum Material ›</a>`;
  }

  function render() {
    const active = document.activeElement;
    const hadFocus = active && active.id === "ek-in";
    const selStart = hadFocus ? active.selectionStart : null;
    const scrollLeft = listsEl.scrollLeft;
    renderLists();
    listsEl.scrollLeft = scrollLeft;
    const list = curList();
    if (list.id !== S.list) S.list = list.id;
    page.innerHTML = list.virtual ? matHTML() : listHTML(list);
    if (!list.virtual) {
      renderSugg();
      const input = page.querySelector("#ek-in");
      if (hadFocus) { input.focus({ preventScroll: true }); try { input.setSelectionRange(selStart, selStart); } catch { /* egal */ } }
    }
  }

  /* ---------- Aktionen ---------- */

  async function addItem(text, opts = {}) {
    const list = curList();
    if (list.virtual) return;
    const p = E.parseQuick(text);
    if (!p.name) { ui.toast("Was soll auf die Liste? ✍️"); return; }
    const hist = history();
    const h = hist.names[E.norm(p.name)];
    const cat = opts.cat || S.cat || E.guessCat(p.name, hist);
    const unit = p.qty ? p.unit : (opts.unit || (h && h.unit) || "Stk");
    const dupe = itemsOf(list.id).find((x) => !x.done && E.norm(x.name) === E.norm(p.name));
    if (dupe) {
      // gleicher Artikel offen → Menge zusammenzählen statt doppelt
      if (p.qty && (dupe.unit === unit || !dupe.qty)) await safe(items.patch(dupe.id, { qty: (dupe.qty || 0) + p.qty, unit }));
      ui.toast(`${p.name} steht schon drauf${p.qty ? " – Menge erhöht" : ""} 👍`);
    } else {
      const it = E.normItem({ listId: list.id, name: p.name, qty: p.qty, unit, cat, done: false, note: "" });
      await safe(items.put(it));
    }
    safe(listsCol.put({ ...hist, names: E.addToHistory(hist.names, [{ name: p.name, cat, unit }]) }));
    S.q = "";
    S.cat = "";
    render();
    const input = page.querySelector("#ek-in");
    if (input) input.focus({ preventScroll: true });
  }

  function toggle(id) {
    const it = items.get(id);
    if (!it) return;
    const done = !it.done;
    safe(items.patch(id, { done, doneAt: done ? Date.now() : null }));
  }

  function mToggle(id) {
    const m = mat.get(id);
    if (!m) return;
    if (m.status === "brauche") { safe(mat.patch(id, { status: "besorgt", doneAt: null })); ui.toast(`${m.name} → besorgt ✓`); }
    else if (m.status === "besorgt") safe(mat.patch(id, { status: "brauche", doneAt: null }));
  }

  async function share() {
    const list = curList();
    const text = list.virtual ? E.shareText({ name: "Material fehlt", e: "🧰" }, [], matRows()) : E.shareText(list, itemsOf(list.id));
    try {
      if (navigator.share) { await navigator.share({ title: list.name, text }); return; }
    } catch (err) { if (err && err.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); ui.toast("Liste kopiert 📋 – jetzt einfach einfügen."); }
    catch { ui.toast("Kopieren ging nicht – bitte manuell markieren."); }
  }

  function openItemSheet(it) {
    const ls = lists();
    const { close } = ui.openSheet({
      title: "Artikel bearbeiten ✏️",
      bodyHTML: `<form class="fields ek-form">
        <label>Was<input type="text" name="name" maxlength="${E.NAME_MAX}" value="${esc(it.name)}" required></label>
        <div class="ek-form-row">
          <label>Menge<input type="text" name="qty" inputmode="decimal" placeholder="–" value="${it.qty ? esc(E.fmtNum(it.qty)) : ""}"></label>
          <label>Einheit<select name="unit">${E.UNITS.map((u) => `<option${u === it.unit ? " selected" : ""}>${u}</option>`).join("")}</select></label>
        </div>
        <div><div class="lbl">Kategorie</div><div class="chips ek-catchips" role="radiogroup">${E.CATS.map((c) => `<button type="button" class="chip" role="radio" data-c="${c.id}" aria-checked="${c.id === it.cat}">${c.e} ${esc(c.label)}</button>`).join("")}</div></div>
        <label>Notiz<input type="text" name="note" maxlength="300" placeholder="z. B. Marke, Größe …" value="${esc(it.note)}"></label>
        ${ls.length > 1 ? `<label>Liste<select name="list">${ls.map((l) => `<option value="${esc(l.id)}"${l.id === it.listId ? " selected" : ""}>${esc(l.e)} ${esc(l.name)}</option>`).join("")}</select></label>` : ""}
        <div class="ek-form-btns">
          <button type="button" class="btn ghost danger" data-del>Löschen</button>
          <button type="submit" class="btn primary">Speichern</button>
        </div>
      </form>`,
      onMount(sheet) {
        let cat = it.cat;
        const f = sheet.querySelector("form");
        sheet.querySelector(".ek-catchips").addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-c]");
          if (!b) return;
          cat = b.dataset.c;
          sheet.querySelectorAll("[data-c]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        });
        ui.confirmButton(sheet.querySelector("[data-del]"), "Wirklich löschen?", async () => { close(); await safe(items.remove(it.id)); ui.toast("Gelöscht 🗑️"); });
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = String(f.name.value || "").trim();
          if (!name) { ui.toast("Bitte einen Namen angeben."); return; }
          const patch = { name: name.slice(0, E.NAME_MAX), qty: E.cleanQty(f.qty.value), unit: f.unit.value, cat, note: String(f.note.value || "").trim().slice(0, 300) };
          if (f.list) patch.listId = f.list.value;
          close();
          await safe(items.patch(it.id, patch));
        });
      },
    });
  }

  function openListSheet(list = null) {
    const isNew = !list;
    const isDefault = list && E.DEFAULT_LISTS.some((d) => d.id === list.id);
    let emo = (list && list.e) || "🛒";
    const { close } = ui.openSheet({
      title: isNew ? "Neue Liste 🛒" : "Liste bearbeiten",
      bodyHTML: `<form class="fields ek-form">
        <label>Name<input type="text" name="name" maxlength="40" placeholder="z. B. Party, Wocheneinkauf" value="${esc((list && list.name) || "")}" required></label>
        <div><div class="lbl">Symbol</div><div class="chips ek-emo" role="radiogroup">${E.LIST_EMOJIS.map((e) => `<button type="button" class="chip" role="radio" data-e="${e}" aria-checked="${e === emo}">${e}</button>`).join("")}</div></div>
        <div class="ek-form-btns">
          ${isNew ? "" : `<button type="button" class="btn ghost danger" data-del>Liste löschen</button>`}
          <button type="submit" class="btn primary">${isNew ? "Anlegen" : "Speichern"}</button>
        </div>
      </form>`,
      onMount(sheet) {
        const f = sheet.querySelector("form");
        sheet.querySelector(".ek-emo").addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-e]");
          if (!b) return;
          emo = b.dataset.e;
          sheet.querySelectorAll("[data-e]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Mit allen Artikeln löschen?", async () => {
          close();
          for (const x of itemsOf(list.id)) safe(items.remove(x.id));
          if (isDefault) await safe(listsCol.put({ id: list.id, name: list.name, e: list.e, order: list.order, deleted: true }));
          else await safe(listsCol.remove(list.id));
          S.list = (lists().find((l) => l.id !== list.id) || E.DEFAULT_LISTS[0]).id;
          lsSet(LIST_KEY, S.list);
          ui.toast("Liste gelöscht 🗑️");
          render();
        });
        setTimeout(() => { try { f.name.focus(); } catch { /* egal */ } }, 50);
        f.addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = String(f.name.value || "").trim().slice(0, 40);
          if (!name) { ui.toast("Bitte einen Namen angeben."); return; }
          close();
          if (isNew) {
            const order = Math.max(1, ...lists().map((l) => l.order)) + 1;
            const id = await safe(listsCol.put({ name, e: emo, order }));
            if (id) { S.list = id; lsSet(LIST_KEY, id); }
            ui.toast(`Liste „${name}“ angelegt ✨`);
          } else {
            await safe(listsCol.put({ ...list, id: list.id, name, e: emo, deleted: false }));
          }
          render();
        });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  listsEl.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-list]");
    if (b) { S.list = b.dataset.list; lsSet(LIST_KEY, S.list); S.q = ""; render(); window.scrollTo({ top: 0 }); return; }
    if (ev.target.closest('[data-x="newlist"]')) openListSheet();
  });

  page.addEventListener("submit", (ev) => {
    if (!ev.target.classList.contains("ek-add")) return;
    ev.preventDefault();
    addItem(S.q);
  });
  page.addEventListener("input", (ev) => {
    if (ev.target.id === "ek-in") { S.q = ev.target.value; renderSugg(); }
  });
  page.addEventListener("change", (ev) => {
    if (ev.target.id === "ek-cat") { S.cat = ev.target.value; renderSugg(); }
  });
  page.addEventListener("click", (ev) => {
    const sg = ev.target.closest("[data-sugg]");
    if (sg) {
      const p = E.parseQuick(S.q);
      addItem(`${p.qty ? E.fmtNum(p.qty) + " " + (p.unit !== "Stk" ? p.unit + " " : "") : ""}${sg.dataset.sugg}`, { cat: sg.dataset.cat, unit: sg.dataset.unit });
      return;
    }
    const b = ev.target.closest("[data-x]");
    if (!b) return;
    const row = b.closest("[data-id]");
    const mrow = b.closest("[data-mid]");
    switch (b.dataset.x) {
      case "toggle": if (row) { row.classList.toggle("done"); toggle(row.dataset.id); } break;
      case "mtoggle": if (mrow) mToggle(mrow.dataset.mid); break;
      case "edit": { const it = row && items.get(row.dataset.id); if (it) openItemSheet(E.normItem(it)); break; }
      case "share": share(); break;
      case "editlist": openListSheet(curList()); break;
      case "cleardone": {
        if (b.dataset.armed) {
          const done = itemsOf(curList().id).filter((x) => x.done);
          for (const x of done) safe(items.remove(x.id));
          ui.toast(`${done.length} erledigte weggeräumt 🧹`);
        } else {
          b.dataset.armed = "1";
          b.textContent = "Wirklich alle löschen?";
          setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "🗑️ Erledigte löschen"; } }, 4000);
        }
        break;
      }
      default: break;
    }
  });

  const offs = [items.watch(queue), listsCol.watch(queue), mat.watch(queue)];
  render();
  return () => { alive = false; for (const off of offs) { try { off(); } catch { /* egal */ } } };
}
