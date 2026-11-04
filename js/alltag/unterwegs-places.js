// Unterwegs › Wichtige Adressen: Name, Adresse, Telefon, Notiz, Kategorie (Familie, Arbeit, Arzt, Werkstatt …),
// Tippen zum Anrufen (tel:), „Route“ (Google Maps), Suche + Kategorie-Filter.
// Sammlung travel_places: { id, name, address, phone, notes, cat, fav }
import * as C from "./unterwegs-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import { safeWrite } from "./unterwegs-shared.js";

export function createPlaces({ col, ui, queue }) {
  let q = "", cat = "";

  function html() {
    const all = col.all();
    const list = C.searchPlaces(all, q, cat);
    const used = new Set(all.map((p) => p.cat || "sonstiges"));
    const chips = C.PLACE_CATS.filter((c) => used.has(c.key));
    return `<div class="uw-places">` +
      `<div class="uw-search"><span class="uw-search-ic">${icon("search", 18)}</span>` +
        `<input id="uw-pl-q" type="search" placeholder="Suchen (Name, Adresse, Telefon)" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></div>` +
      (chips.length > 1 ? `<div class="chips uw-filter">` +
        `<button type="button" class="chip sm" data-pl="cat" data-cat="" aria-pressed="${!cat}">Alle</button>` +
        chips.map((c) => `<button type="button" class="chip sm" data-pl="cat" data-cat="${c.key}" aria-pressed="${cat === c.key}">${c.emoji} ${esc(c.name)}</button>`).join("") +
      `</div>` : "") +
      (!all.length
        ? `<div class="empty uw-empty"><div class="uw-empty-emo">📇</div><h3>Noch keine Adressen</h3><p>Hausarzt, Werkstatt, Firma, Oma … – mit einem Tipp anrufen oder hinnavigieren.</p>` +
          `<button type="button" class="btn primary sm" data-pl="new">+ Adresse hinzufügen</button></div>`
        : list.length
          ? `<p class="note uw-count">${list.length} ${list.length === 1 ? "Adresse" : "Adressen"}${q ? ` für „${esc(q)}“` : ""}</p><div class="uw-place-grid">${list.map(cardHTML).join("")}</div>`
          : `<div class="empty uw-empty"><h3>Nichts gefunden</h3><p>Probier ein anderes Suchwort.</p></div>`) +
    `</div>`;
  }

  function cardHTML(p) {
    const c = C.placeCat(p.cat);
    return `<article class="card uw-place" data-id="${esc(p.id)}">` +
      `<button type="button" class="uw-place-head" data-pl="edit" data-id="${esc(p.id)}">` +
        `<span class="uw-place-emo" aria-hidden="true">${c.emoji}</span>` +
        `<span class="uw-place-t"><b>${p.fav ? "★ " : ""}${esc(p.name)}</b><small>${esc(c.name)}</small></span>` +
        `<span class="uw-place-ed" aria-hidden="true">${icon("pencil", 16)}</span>` +
      `</button>` +
      (p.address ? `<p class="uw-place-addr">${icon("pin", 15)} <span>${esc(p.address)}</span></p>` : "") +
      (p.phone ? `<p class="uw-place-tel">${icon("user", 15)} <span>${esc(p.phone)}</span></p>` : "") +
      (p.notes ? `<p class="uw-place-note">${esc(p.notes)}</p>` : "") +
      `<div class="uw-place-act">` +
        (p.phone ? `<a class="btn sm primary" href="${esc(C.telHref(p.phone))}">${icon("phone", 16)} Anrufen</a>` : "") +
        (p.address ? `<a class="btn sm ghost" href="${esc(C.mapsRoute(p.address))}" target="_blank" rel="noopener">${icon("route", 16)} Route</a>` : "") +
      `</div>` +
    `</article>`;
  }

  function openPlace(place = null) {
    const isNew = !place;
    const p = place || { name: "", address: "", phone: "", notes: "", cat: cat || "familie", fav: false };
    ui.openSheet({
      title: isNew ? "Neue Adresse" : "Adresse bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Name<input id="uw-a-name" maxlength="60" placeholder="z. B. Hausarzt Dr. Huber" value="${esc(p.name)}"></label>` +
        `<div><p class="lbl" style="margin-bottom:6px">Kategorie</p><div class="chips uw-catpick">${C.PLACE_CATS.map((c) => `<button type="button" class="chip sm" data-k="${c.key}" aria-pressed="${(p.cat || "sonstiges") === c.key}">${c.emoji} ${esc(c.name)}</button>`).join("")}</div></div>` +
        `<label>Adresse<input id="uw-a-addr" maxlength="120" placeholder="Straße Nr, PLZ Ort" value="${esc(p.address || "")}" autocomplete="street-address"></label>` +
        `<label>Telefon<input id="uw-a-tel" type="tel" maxlength="30" placeholder="+43 …" value="${esc(p.phone || "")}"></label>` +
        `<label>Notiz<textarea id="uw-a-notes" rows="2" maxlength="300" placeholder="z. B. Ordination Mo–Fr 8–12">${esc(p.notes || "")}</textarea></label>` +
        `<label class="uw-switch"><input id="uw-a-fav" type="checkbox"${p.fav ? " checked" : ""}><span>Favorit</span><small>Steht oben in der Liste</small></label>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        let k = p.cat || "sonstiges";
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-k]");
          if (!b) return;
          k = b.dataset.k;
          sheet.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        sheet.querySelector("[data-save]").addEventListener("click", async () => {
          const name = sheet.querySelector("#uw-a-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          close();
          await safeWrite(ui, col.put({
            ...(place || {}), name, cat: k,
            address: sheet.querySelector("#uw-a-addr").value.trim(),
            phone: sheet.querySelector("#uw-a-tel").value.trim(),
            notes: sheet.querySelector("#uw-a-notes").value.trim(),
            fav: sheet.querySelector("#uw-a-fav").checked,
          }), "Gespeichert ✓");
        });
        const del = sheet.querySelector("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { close(); await safeWrite(ui, col.remove(place.id), "Gelöscht"); });
      },
    });
  }

  function onClick(t) {
    const a = t.dataset.pl;
    if (!a) return false;
    if (a === "new") openPlace();
    else if (a === "edit") openPlace(col.get(t.dataset.id));
    else if (a === "cat") { cat = t.dataset.cat; queue(); }
    return true;
  }
  function onInput(ev) {
    if (ev.target.id !== "uw-pl-q") return false;
    q = ev.target.value; queue();
    return true;
  }

  return { html, onClick, onInput, openNew: () => openPlace() };
}
