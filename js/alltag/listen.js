// Update 11 – Alltag › 🎬 Freizeit-Listen (#alltag/listen[/<typ>]): Serien, Filme, Bücher, Games, Musik, Hobbys,
// Ausflüge, persönliche Projekte und Geschenkideen (je Person). Status Idee → dabei → fertig, Sterne, Fortschritt, Notiz.
// Daten: Sammlung „freizeit_listen“. Reine Logik: ./listen-core.js
import { collection } from "./db.js";
import * as L from "./listen-core.js";
import * as A from "./akten-ui.js";
import { confirmButton } from "../ui.js";
import { esc } from "../util.js";

const TYPE_KEY = "sk-listen-type";
function loadCss() {
  if (document.querySelector('link[data-css="listen"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.css = "listen";
  l.href = new URL("../../css/alltag-listen.css", import.meta.url).href;
  document.head.appendChild(l);
}
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export function mount(el) {
  loadCss();
  const col = collection("freizeit_listen");
  const S = { type: L.routeType(location.hash) || lsGet(TYPE_KEY) || "serie", status: "", q: "", edit: null };
  if (!L.TYPES.some((t) => t.id === S.type)) S.type = "serie";
  let items = [];

  const off = col.watch((arr) => { items = arr.map(L.normItem).filter((i) => i.id && i.title); render(); });
  const offRoute = A.onRoute((h) => { const t = L.routeType(h); if (t && t !== S.type) { S.type = t; S.edit = null; render(); } });

  function formHTML(it) {
    const t = L.typeById(it ? it.type : S.type);
    const v = it || { title: "", status: "idee", rating: 0, progress: "", note: "", person: "", occasion: "", date: "", price: 0, link: "" };
    const gift = t.id === "geschenk";
    return `<form class="ls-form card" data-ls="form">
      <h3>${it ? "✏️ Bearbeiten" : `➕ ${esc(t.one)} hinzufügen`}</h3>
      <label>Titel<input name="title" maxlength="120" required value="${esc(v.title)}" placeholder="${gift ? "z. B. Kopfhörer" : "Name"}" autocomplete="off"></label>
      ${gift ? `<div class="ls-row"><label>👤 Für wen<input name="person" maxlength="60" value="${esc(v.person)}" placeholder="z. B. Mama" autocomplete="off"></label>
        <label>🎉 Anlass<input name="occasion" maxlength="60" value="${esc(v.occasion)}" placeholder="Geburtstag, Weihnachten …" autocomplete="off"></label></div>
        <div class="ls-row"><label>📅 Datum<input type="date" name="date" value="${esc(v.date)}"></label>
        <label>💶 Preis ca.<input name="price" inputmode="decimal" value="${v.price ? A.amountIn(v.price) : ""}" placeholder="0,00" autocomplete="off"></label></div>`
      : `${t.id === "ausflug" ? `<label>📅 Datum (optional)<input type="date" name="date" value="${esc(v.date)}"></label>` : ""}
        ${t.progress ? `<label>📍 Fortschritt<input name="progress" maxlength="40" value="${esc(v.progress)}" placeholder="${esc(t.progress)}" autocomplete="off"></label>` : ""}`}
      <label>Status<select name="status">${["idee", "laeuft", "fertig"].map((s) => `<option value="${s}"${v.status === s ? " selected" : ""}>${esc(L.statusLabel(t.id, s))}</option>`).join("")}</select></label>
      ${gift ? "" : `<fieldset class="ls-stars"><legend>Bewertung</legend>${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}"${v.rating === n ? " checked" : ""}><span aria-label="${n} Sterne">★</span></label>`).join("")}<label class="ls-nostar"><input type="radio" name="rating" value="0"${!v.rating ? " checked" : ""}><span>keine</span></label></fieldset>`}
      <label>📝 Notiz<textarea name="note" maxlength="500" rows="2" placeholder="optional">${esc(v.note)}</textarea></label>
      <label>🔗 Link (optional)<input name="link" type="url" maxlength="300" value="${esc(v.link)}" placeholder="https://…" autocomplete="off"></label>
      <div class="ls-btns"><button type="submit" class="btn primary">💾 Speichern</button><button type="button" class="btn ghost" data-ls="cancel">Abbrechen</button></div>
    </form>`;
  }

  function itemHTML(i) {
    const gift = i.type === "geschenk";
    const meta = [i.progress && `📍 ${esc(i.progress)}`, i.occasion && `🎉 ${esc(i.occasion)}`, i.date && `📅 ${A.fmtKey(i.date)}`, i.price && `💶 ${esc(L.fmtPrice(i.price))}`].filter(Boolean).join(" · ");
    return `<li class="ls-item st-${i.status}">
      <button type="button" class="ls-st" data-cycle="${esc(i.id)}" title="Status weiterschalten">${esc(L.statusLabel(i.type, i.status))}</button>
      <div class="ls-main"><b>${esc(i.title)}</b>
        ${!gift && i.rating ? `<span class="ls-rate" aria-label="${i.rating} von 5 Sternen">${L.stars(i.rating)}</span>` : ""}
        ${meta ? `<small>${meta}</small>` : ""}${i.note ? `<small class="ls-note">${esc(i.note)}</small>` : ""}
        ${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer" class="ls-link">🔗 Link öffnen</a>` : ""}</div>
      <div class="ls-acts"><button type="button" class="btn ghost sm" data-edit="${esc(i.id)}" aria-label="${esc(i.title)} bearbeiten">✏️</button>
        <button type="button" class="btn ghost sm" data-del="${esc(i.id)}" aria-label="${esc(i.title)} löschen">🗑️</button></div>
    </li>`;
  }

  function render() {
    if (!col.loaded && !items.length) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ae.closest('[data-ls="form"]')) return; // beim Tippen nicht neu zeichnen
    const c = L.counts(items);
    const t = L.typeById(S.type);
    const list = L.sortItems(L.filterItems(items, { type: S.type, status: S.status, q: S.q }));
    let h = `<div class="ls">
      <div class="ls-hero"><span aria-hidden="true">🎬</span><div><b>Deine Freizeit-Listen</b><small>${c.running ? `${c.running} gerade dabei · ` : ""}${c.doneThisYear} dieses Jahr geschafft 🎉</small></div></div>
      <div class="ls-tabs" role="tablist">${L.TYPES.map((x) => `<button type="button" role="tab" aria-selected="${x.id === S.type}" class="ls-tab${x.id === S.type ? " on" : ""}" data-type="${x.id}"><span aria-hidden="true">${x.e}</span>${esc(x.label)}${c.by[x.id].all ? `<i>${c.by[x.id].all}</i>` : ""}</button>`).join("")}</div>
      <div class="ls-bar"><input type="search" data-ls="q" placeholder="🔍 In ${esc(t.label)} suchen" value="${esc(S.q)}" aria-label="Suchen">
        <select data-ls="status" aria-label="Status filtern"><option value="">Alle</option>${["laeuft", "idee", "fertig"].map((s) => `<option value="${s}"${S.status === s ? " selected" : ""}>${esc(L.statusLabel(S.type, s))}</option>`).join("")}</select>
        <button type="button" class="btn primary sm" data-ls="add" aria-label="Neu hinzufügen">➕ Neu</button></div>`;
    if (S.edit) h += formHTML(S.edit === "new" ? null : items.find((i) => i.id === S.edit) || null);
    if (S.type === "geschenk" && !S.status && !S.q && list.length) {
      h += L.giftsByPerson(list).map((g) => `<section class="ls-group"><h4>👤 ${esc(g.person)}${g.open ? ` <small>offen ca. ${esc(L.fmtPrice(g.open))}</small>` : ""}</h4><ul class="ls-list">${L.sortItems(g.items).map(itemHTML).join("")}</ul></section>`).join("");
    } else if (list.length) {
      h += `<ul class="ls-list">${list.map(itemHTML).join("")}</ul>`;
    } else if (!S.edit) {
      h += A.emptyHTML(t.e, S.q || S.status ? "Nichts gefunden" : `Noch keine ${t.label}`,
        S.q || S.status ? "Probier einen anderen Filter." : "Sammle hier alles, was du anschauen, lesen, spielen oder machen willst – und hak es ab, wenn's erledigt ist. 😊",
        S.q || S.status ? "" : `➕ ${t.one} hinzufügen`, "add");
    }
    el.innerHTML = h + `</div>`;
    el.querySelectorAll("[data-del]").forEach((b) => confirmButton(b, "Löschen?", () => A.safe(col.remove(b.dataset.del), "Gelöscht 🗑️")));
    const on = el.querySelector(".ls-tab.on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center" });
    const f = el.querySelector('[data-ls="form"] input[name="title"]');
    if (f && !f.value) f.focus();
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !el.contains(b)) return;
    if (b.dataset.type) { S.type = b.dataset.type; S.status = ""; S.edit = null; lsSet(TYPE_KEY, S.type); history.replaceState(null, "", L.listHash(S.type)); return render(); }
    if (b.dataset.cycle) { const it = items.find((i) => i.id === b.dataset.cycle); if (it) { const n = L.cycle(it, Date.now()); A.safe(col.put(n), n.status === "fertig" ? "Geschafft! 🎉" : null); } return; }
    if (b.dataset.edit) { S.edit = b.dataset.edit; render(); el.querySelector('[data-ls="form"]')?.scrollIntoView({ block: "nearest" }); return; }
    if (b.dataset.ls === "add" || b.dataset.ak === "add") { S.edit = "new"; return render(); }
    if (b.dataset.ls === "cancel") { S.edit = null; document.activeElement?.blur(); return render(); }
  });
  el.addEventListener("input", (e) => { if (e.target.dataset.ls === "q") { S.q = e.target.value; const p = e.target.selectionStart; render(); const q = el.querySelector('[data-ls="q"]'); if (q) { q.focus(); try { q.setSelectionRange(p, p); } catch { /* egal */ } } } });
  el.addEventListener("change", (e) => { if (e.target.dataset.ls === "status") { S.status = e.target.value; render(); } });
  el.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const fields = Object.fromEntries(fd.entries());
    const now = Date.now();
    const old = S.edit && S.edit !== "new" ? items.find((i) => i.id === S.edit) : null;
    let doc;
    try {
      doc = old ? L.normItem({ ...old, ...fields, price: fields.price != null ? A.num(fields.price) : old.price, updated: now,
        doneAt: fields.status === "fertig" ? (old.doneAt || now) : 0 })
        : L.makeItem({ ...fields, type: S.type, price: A.num(fields.price) }, now);
      if (!doc.title) throw new Error("Bitte einen Titel eingeben.");
    } catch (err) { A.safe(Promise.reject(err)); return; }
    document.activeElement?.blur();
    S.edit = null;
    if (await A.safe(col.put(doc), old ? "Gespeichert ✓" : `${L.typeById(doc.type).e} Hinzugefügt!`)) render();
  });

  render();
  return () => { off(); offRoute(); };
}
