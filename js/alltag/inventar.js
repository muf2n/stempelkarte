// Update 10 E – Alltag › 📦 Inventar (#alltag/inventar, Detail #alltag/inventar/<id>).
// Dinge mit Kaufdatum, Kaufpreis, Händler, Seriennummer, Garantie (Erinnerung in der Benachrichtigungszentrale „🛡️ Garantie läuft ab“),
// Foto, Raum/Ort, Rechnung (Dokument-Verknüpfung) und QR-Sticker (gleicher Druckbogen wie beim 🧰 Werkzeug). Gesamtwert je Raum.
// Reine Logik: ./inventar-core.js. Foto in der Unterwegs-Bildablage (travel_images, ID "inv_<id>").
import { collection, newId } from "./db.js";
import * as I from "./inventar-core.js";
import * as A from "./akten-ui.js";
import { qrSVG } from "./qr.js";
import { putImage, getImage, cachedImage, delImage, shrinkImage } from "./unterwegs-shared.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { icon } from "../icons.js";

const PRINT_ID = "wz-print-root"; // gleicher Druckbogen-Stil wie das Werkzeug-Register (css/alltag-werkzeug.css)
const photoKey = (id) => "inv_" + id;
const VIEWS = [["alle", "📦", "Alle"], ["raeume", "🏠", "Räume"], ["garantie", "🛡️", "Garantie"]];
const VIEW_KEY = "sk-inv-view";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function injectWzCSS() {
  if (document.getElementById("wz-css")) return;
  const l = document.createElement("link");
  l.id = "wz-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-werkzeug.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el) {
  A.injectCSS();
  injectWzCSS();
  const col = collection("inventar");
  const S = { view: VIEWS.some((v) => v[0] === lsGet(VIEW_KEY)) ? lsGet(VIEW_KEY) : "alle", room: "", q: "", id: I.routeId(location.hash) };
  let alive = true, queued = false;
  const queue = () => { if (queued || !alive) return; queued = true; queueMicrotask(() => { queued = false; if (alive) render(); }); };

  el.innerHTML = `<div class="ak inv">
      <div class="ak-home">
        <div class="ak-top">
          <label class="ak-search"><span class="sr">Inventar suchen</span><input id="inv-q" type="search" placeholder="🔎 Name, Marke, Seriennummer, Händler …" autocomplete="off" enterkeyhint="search"></label>
          <div class="ak-acts">
            <button type="button" class="btn ghost sm" data-inv="print">🖨️ <span>QR-Bogen</span></button>
            <button type="button" class="btn primary sm" data-inv="new">${icon("plus", 16)}<span>Gegenstand</span></button>
          </div>
        </div>
        <div class="ak-sum inv-sum"></div>
        <div class="ak-views" role="tablist" aria-label="Ansicht"></div>
        <div class="ak-chips inv-rooms" role="group" aria-label="Raum"></div>
        <div class="ak-list-wrap"></div>
      </div>
      <div class="ak-detail-wrap" hidden></div>
    </div>`;
  const home = el.querySelector(".ak-home");
  const detailEl = el.querySelector(".ak-detail-wrap");
  const listEl = el.querySelector(".ak-list-wrap");
  const sumEl = el.querySelector(".inv-sum");
  const viewsEl = el.querySelector(".ak-views");
  const roomsEl = el.querySelector(".inv-rooms");
  const qIn = el.querySelector("#inv-q");
  const all = () => col.all().map(I.normItem).filter((x) => x.id && x.name);
  const byId = (id) => { const x = col.get(id); return x ? I.normItem(x) : null; };

  function thumb(it, big = false) {
    if (it.photoId) {
      const img = cachedImage(it.photoId);
      if (img) return `<img src="${img}" alt="" class="${big ? "ak-img-big" : ""}">`;
      getImage(it.photoId).then((v) => { if (v) queue(); }).catch(() => {});
    }
    return `<span class="ak-emo${big ? " big" : ""}" aria-hidden="true">${I.catById(it.cat).e}</span>`;
  }
  function wBadge(it, today) {
    const w = I.warrantyStatus(it, today);
    if (w.state === "none") return "";
    return `<span class="ak-b ak-b-${w.state === "ab" ? "ab" : w.state === "bald" ? "bald" : "ok"}">${w.e} ${esc(w.label)}</span>`;
  }

  function renderHome() {
    const today = A.todayKey();
    const items = all();
    const rooms = I.totalsByRoom(items);
    sumEl.innerHTML = items.length ? `<div class="ak-stat"><b>${items.length}</b><small>${items.length === 1 ? "Gegenstand" : "Gegenstände"}</small></div>` +
      `<div class="ak-stat"><b>${esc(A.eur(I.totalValue(items)))}</b><small>Gesamtwert</small></div>` +
      `<div class="ak-stat"><b>${I.dueWarranties(items, today).length}</b><small>Garantie läuft bald ab</small></div>` : "";
    sumEl.hidden = !items.length;
    viewsEl.innerHTML = VIEWS.map(([id, e, label]) => `<button type="button" role="tab" class="ak-vt" data-view="${id}" aria-selected="${S.view === id}"><span aria-hidden="true">${e}</span><span>${label}</span></button>`).join("");
    roomsEl.innerHTML = rooms.length > 1 && S.view !== "raeume" ? `<button type="button" class="chip" data-room="" aria-pressed="${!S.room}">Alle Räume</button>` +
      rooms.map((r) => `<button type="button" class="chip" data-room="${esc(r.room)}" aria-pressed="${S.room === r.room}">${esc(r.room)} <span class="ak-cn">${r.n}</span></button>`).join("") : "";
    if (!items.length) {
      listEl.innerHTML = col.loaded ? A.emptyHTML("📦", "Dein Inventar ist noch leer", "Fernseher, Waschmaschine, Laptop, Fahrrad … Trag ein, was dir gehört – mit Kaufpreis, Seriennummer und Garantie. Praktisch für die Haushaltsversicherung und wenn mal was kaputt geht. 🛠️", "＋ Ersten Gegenstand", "new") : `<p class="note">Lade …</p>`;
      return;
    }
    if (S.view === "raeume") {
      const max = Math.max(1, ...rooms.map((r) => r.value));
      listEl.innerHTML = `<ul class="inv-rooms-l">${rooms.map((r) => `<li><button type="button" class="ak-card inv-room" data-inv="room" data-room="${esc(r.room)}">` +
        `<span class="ak-thumb"><span class="ak-emo" aria-hidden="true">🏠</span></span><span class="ak-ct"><b>${esc(r.room)}</b><small>${r.n} ${r.n === 1 ? "Gegenstand" : "Gegenstände"}</small>` +
        `<span class="inv-bar"><span style="width:${Math.max(3, Math.round((r.value / max) * 100))}%"></span></span></span><span class="ak-amt">${esc(A.eur(r.value))}</span></button></li>`).join("")}</ul>`;
      return;
    }
    const list = I.filterItems(items, { q: S.q, room: S.room, view: S.view }, today);
    listEl.innerHTML = list.length ? `<ul class="ak-list">${list.map((it) =>
      `<li><button type="button" class="ak-card" data-inv="open" data-id="${esc(it.id)}">` +
        `<span class="ak-thumb">${thumb(it)}</span>` +
        `<span class="ak-ct"><b>${esc(it.name)}</b><small>${esc([it.brand, it.room, it.serial ? "SN " + it.serial : ""].filter(Boolean).join(" · ") || I.catById(it.cat).label)}</small>` +
        `<span class="ak-badges">${wBadge(it, today)}</span></span>` +
        `${it.price != null ? `<span class="ak-amt">${esc(A.eur(it.price))}</span>` : ""}` +
      `</button></li>`).join("")}</ul>`
      : `<div class="empty ak-empty"><p>${S.q ? `Nichts gefunden für „${esc(S.q)}“ 🤔` : S.view === "garantie" ? "Nichts mit laufender Garantie eingetragen." : "Hier ist nichts."}</p></div>`;
  }

  function renderDetail(it) {
    const today = A.todayKey();
    const w = I.warrantyStatus(it, today);
    const rows = [
      ["🏷️ Kategorie", `${I.catById(it.cat).e} ${I.catById(it.cat).label}`],
      ["🏠 Raum/Ort", it.room], ["🏭 Marke/Modell", it.brand], ["🔢 Seriennummer", it.serial],
      ["📅 Gekauft am", A.fmtKey(it.boughtOn)], ["💶 Kaufpreis", it.price != null ? A.eur(it.price) : ""], ["🛒 Händler", it.shop],
      ["🛡️ Garantie bis", A.fmtKey(it.warrantyUntil)],
    ].filter((r) => r[1]);
    detailEl.innerHTML = `<div class="ak-det">
      <div class="ak-det-bar"><button type="button" class="btn ghost sm" data-inv="back">${icon("chevron-left", 18)}<span>Inventar</span></button></div>
      <section class="ak-hero">
        <button type="button" class="ak-hero-ph" data-inv="photo" aria-label="${it.photoId ? "Foto groß ansehen" : "Foto hinzufügen"}">${thumb(it, true)}</button>
        <div class="ak-hero-t"><h2>${esc(it.name)}</h2><p class="note">${esc([it.brand, it.room].filter(Boolean).join(" · "))}</p>${w.state !== "none" ? `<p>${wBadge(it, today)}</p>` : ""}</div>
        <div class="ak-hero-acts">
          <button type="button" class="btn primary sm" data-inv="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>
          <button type="button" class="btn ghost sm" data-inv="qr">${icon("qr", 16)}<span>QR-Sticker</span></button>
        </div>
      </section>
      <section class="ak-card-s"><h3>📋 Angaben</h3><dl class="ak-dl">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join("")}</dl>
        ${it.warrantyUntil ? `<p class="note">${it.remind ? "🔔 Erinnerung 30 Tage bevor die Garantie endet." : "🔕 Keine Garantie-Erinnerung."}</p>` : ""}</section>
      ${it.notes ? `<section class="ak-card-s"><h3>📝 Notizen</h3><p class="ak-pre">${esc(it.notes)}</p></section>` : ""}
      <div class="inv-docs">${A.linkedDocsHTML("inventar", it.id, { title: "🧾 Rechnung & Dokumente" })}</div>
      <div class="ak-det-foot"><button type="button" class="btn danger sm" data-inv="del">Löschen</button></div>
    </div>`;
    ui.confirmButton(detailEl.querySelector('[data-inv="del"]'), "Wirklich löschen?", async () => {
      if (it.photoId) delImage(it.photoId).catch(() => {});
      await A.safe(col.remove(it.id), "Gelöscht 🗑️");
      A.go("#alltag/inventar");
    });
  }

  function openForm(it0 = null) {
    const it = I.normItem(it0 || { room: S.room && S.room !== "Ohne Ort" ? S.room : "" });
    const isNew = !it0;
    let photo; // undefined = unverändert, null = entfernen, string = neu
    const rooms = [...new Set([...I.ROOMS, ...all().map((x) => x.room).filter(Boolean)])];
    ui.openSheet({
      title: isNew ? "📦 Neuer Gegenstand" : "✏️ Bearbeiten",
      bodyHTML: `<form class="fields ak-form" novalidate>
        <div class="ak-chiprow" role="group" aria-label="Kategorie">${I.CATS.map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${it.cat === c.id}">${c.e} ${esc(c.label)}</button>`).join("")}</div>
        <label>Name<input id="inv-f-name" type="text" maxlength="120" value="${esc(it.name)}" placeholder="z. B. Waschmaschine" required></label>
        <div class="row2"><label>Marke/Modell<input id="inv-f-brand" type="text" maxlength="120" value="${esc(it.brand)}"></label>
          <label>Seriennummer<input id="inv-f-sn" type="text" maxlength="80" value="${esc(it.serial)}" autocapitalize="characters"></label></div>
        <div class="row2"><label>Raum/Ort<input id="inv-f-room" type="text" maxlength="60" list="inv-rooms-dl" value="${esc(it.room)}" placeholder="z. B. Küche"></label>
          <label>Händler<input id="inv-f-shop" type="text" maxlength="120" value="${esc(it.shop)}"></label></div>
        <datalist id="inv-rooms-dl">${rooms.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
        <div class="row2"><label>Gekauft am<input id="inv-f-bought" type="date" value="${esc(it.boughtOn)}"></label>
          <label>Kaufpreis (€)<input id="inv-f-price" type="text" inputmode="decimal" value="${esc(A.amountIn(it.price))}" placeholder="0,00"></label></div>
        <div class="row2"><label>Garantie bis<input id="inv-f-wu" type="date" value="${esc(it.warrantyUntil)}"></label>
          <div class="inv-wq"><span class="note">Schnell:</span> <button type="button" class="chip" data-wm="12">1 Jahr</button><button type="button" class="chip" data-wm="24">2 Jahre</button><button type="button" class="chip" data-wm="36">3 Jahre</button></div></div>
        <label class="ak-check"><input id="inv-f-remind" type="checkbox"${it.remind ? " checked" : ""}> 🔔 Erinnern, bevor die Garantie endet</label>
        <div class="inv-photo"><div class="inv-photo-prev">${it.photoId && cachedImage(it.photoId) ? `<img src="${cachedImage(it.photoId)}" alt="">` : ""}</div>
          <label class="btn ghost sm ak-filebtn">📷 <span>Foto</span><input type="file" accept="image/*" capture="environment" id="inv-f-photo"></label>
          ${it.photoId ? `<button type="button" class="btn ghost sm" data-nophoto>Foto entfernen</button>` : ""}</div>
        <label>Notizen<textarea id="inv-f-notes" rows="3" maxlength="4000">${esc(it.notes)}</textarea></label>
        <div class="row"><button type="submit" class="btn primary" data-save>Speichern</button></div>
      </form>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let cat = it.cat;
        sheet.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { cat = b.dataset.cat; sheet.querySelectorAll("[data-cat]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.cat === cat))); }));
        sheet.querySelectorAll("[data-wm]").forEach((b) => b.addEventListener("click", () => {
          const bo = $("#inv-f-bought").value;
          if (!bo) { ui.toast("Zuerst das Kaufdatum eintragen 📅"); $("#inv-f-bought").focus(); return; }
          $("#inv-f-wu").value = I.warrantyFrom(bo, Number(b.dataset.wm));
        }));
        $("#inv-f-photo").addEventListener("change", async (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          try { const r = await shrinkImage(f, { maxSide: 900, maxBytes: 110 * 1024, quality: 0.75 }); photo = r.data; $(".inv-photo-prev").innerHTML = `<img src="${r.data}" alt="">`; }
          catch (err) { ui.toast(err && err.message || "Foto ging nicht."); }
        });
        const np = $("[data-nophoto]");
        if (np) np.addEventListener("click", () => { photo = null; $(".inv-photo-prev").innerHTML = ""; np.remove(); });
        $("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          const name = $("#inv-f-name").value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); $("#inv-f-name").focus(); return; }
          const id = it.id || newId();
          const doc = {
            ...(it0 || {}), id, name, cat, brand: $("#inv-f-brand").value.trim(), serial: $("#inv-f-sn").value.trim().toUpperCase(), room: $("#inv-f-room").value.trim(),
            shop: $("#inv-f-shop").value.trim(), boughtOn: $("#inv-f-bought").value || "", price: A.num($("#inv-f-price").value),
            warrantyUntil: $("#inv-f-wu").value || "", remind: $("#inv-f-remind").checked, notes: $("#inv-f-notes").value.trim(),
            updated: Date.now(), created: it.created || Date.now(),
          };
          try {
            if (typeof photo === "string") { await putImage(photoKey(id), photo); doc.photoId = photoKey(id); }
            else if (photo === null && it.photoId) { delImage(it.photoId).catch(() => {}); doc.photoId = ""; }
          } catch (err) { console.error(err); ui.toast("Foto konnte nicht gespeichert werden."); }
          if (await A.safe(col.put(doc), isNew ? "Eingetragen 📦" : "Gespeichert ✓")) { close(); if (isNew) A.go(I.itemHash(id)); else queue(); }
        });
      },
    });
  }

  function openQR(it) {
    const url = I.itemUrl(location.href, it.id);
    let svg = "";
    try { svg = qrSVG(url, { label: `QR-Code ${it.name}` }); } catch (e) { console.error(e); }
    ui.openSheet({
      title: "🔳 QR-Sticker",
      bodyHTML: `<div class="wz-qr"><div class="wz-qr-box">${svg}</div><b>${esc(it.name)}</b>
        <p class="note">Kleb den Sticker aufs Gerät oder unter die Rechnung – Scannen öffnet direkt diese Seite mit Garantie & Rechnung. 📱</p>
        <p class="wz-qr-url">${esc(url)}</p>
        <div class="row"><button type="button" class="btn ghost" data-q="copy">🔗 Link kopieren</button><button type="button" class="btn ghost" data-q="print">🖨️ Drucken</button></div></div>`,
      onMount(sheet, close) {
        sheet.querySelector('[data-q="copy"]').addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(url); ui.toast("Link kopiert 📋", 1600); } catch { ui.toast("Kopieren geht hier nicht – halt den Link gedrückt."); }
        });
        sheet.querySelector('[data-q="print"]').addEventListener("click", () => { close(); openPrint([it.id]); });
      },
    });
  }

  /* ---------- Druckbogen (wie Werkzeug) ---------- */

  let printer = null;
  function closePrint(fromPop = false) {
    if (!printer) return;
    const p = printer; printer = null;
    window.removeEventListener("popstate", p.onPop);
    p.el.remove();
    document.body.classList.remove("wz-print-open");
    if (!fromPop && p.pushed && history.state && history.state.invp) history.back();
  }
  function openPrint(only = null) {
    closePrint();
    const items = all().sort((a, b) => a.name.localeCompare(b.name, "de"));
    if (!items.length) { ui.toast("Noch nichts zum Drucken."); return; }
    const sel = new Set(only && only.length ? only : items.map((x) => x.id));
    const root = document.createElement("div");
    root.id = PRINT_ID;
    root.className = "rp wz-pr";
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "QR-Sticker drucken");
    root.tabIndex = -1;
    const base = location.href;
    const sticker = (it) => {
      let svg = "";
      try { svg = qrSVG(I.itemUrl(base, it.id), { label: `QR-Code ${it.name}` }); } catch (e) { console.error(e); }
      return `<label class="wz-st${sel.has(it.id) ? "" : " off"}"><input type="checkbox" class="wz-st-cb" data-pick="${esc(it.id)}"${sel.has(it.id) ? " checked" : ""} aria-label="${esc(it.name)} drucken">` +
        `<span class="wz-st-qr">${svg}</span><span class="wz-st-t"><b>${I.catById(it.cat).e} ${esc(it.name)}</b>${it.serial ? `<small>SN ${esc(it.serial)}</small>` : it.room ? `<small>${esc(it.room)}</small>` : ""}<em>Scannen → Inventar</em></span></label>`;
    };
    root.innerHTML = `<div class="rp-bar"><button type="button" class="btn ghost sm rp-close" data-p="close">${icon("chevron-left", 18)}<span>Zurück</span></button><h2>🖨️ Inventar-Sticker drucken</h2></div>` +
      `<p class="note wz-pr-note">Häkchen weg = wird nicht gedruckt. Ausschneiden, aufkleben, fertig. ✂️</p>` +
      `<div class="wz-pr-tools"><button type="button" class="btn ghost sm" data-p="all">Alle</button><button type="button" class="btn ghost sm" data-p="none">Keine</button><span class="wz-pr-n"></span></div>` +
      `<article class="rp-paper wz-sheet">${items.map(sticker).join("")}</article>` +
      `<div class="rp-actions"><button type="button" class="btn primary" data-p="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button></div>`;
    document.body.appendChild(root);
    document.body.classList.add("wz-print-open");
    const count = () => { root.querySelector(".wz-pr-n").textContent = `${sel.size} von ${items.length} ausgewählt`; };
    const setAll = (on) => { root.querySelectorAll("[data-pick]").forEach((cb) => { cb.checked = on; cb.closest(".wz-st").classList.toggle("off", !on); if (on) sel.add(cb.dataset.pick); else sel.delete(cb.dataset.pick); }); count(); };
    count();
    root.addEventListener("change", (ev) => {
      const cb = ev.target.closest("[data-pick]"); if (!cb) return;
      if (cb.checked) sel.add(cb.dataset.pick); else sel.delete(cb.dataset.pick);
      cb.closest(".wz-st").classList.toggle("off", !cb.checked); count();
    });
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-p]"); if (!b) return;
      const a = b.dataset.p;
      if (a === "close") closePrint();
      else if (a === "all") setAll(true);
      else if (a === "none") setAll(false);
      else if (a === "print") {
        if (!sel.size) { ui.toast("Bitte mindestens einen Sticker auswählen."); return; }
        const prevT = document.title;
        document.title = `Inventar QR-Sticker ${A.todayKey()}`;
        try { window.print(); } catch { ui.toast("Drucken geht hier nicht."); }
        setTimeout(() => { document.title = prevT; }, 1000);
      }
    });
    const p = { el: root, pushed: false, onPop: () => closePrint(true) };
    try { history.pushState({ ...(history.state || {}), invp: 1 }, "", location.href); p.pushed = true; window.addEventListener("popstate", p.onPop); } catch { /* egal */ }
    printer = p;
    try { root.focus({ preventScroll: true }); } catch { /* egal */ }
  }

  function showPhoto(it) {
    if (!it.photoId) { openForm(col.get(it.id)); return; }
    getImage(it.photoId).then((src) => {
      if (!src) { ui.toast("Foto konnte nicht geladen werden."); return; }
      ui.openSheet({ title: `📷 ${it.name}`, bodyHTML: `<div class="ak-photo-big"><img src="${src}" alt="Foto: ${esc(it.name)}"></div>` });
    });
  }

  /* ---------- Rendern / Ereignisse ---------- */

  function render() {
    S.id = I.routeId(location.hash);
    const it = S.id ? byId(S.id) : null;
    if (S.id && !it) {
      home.hidden = true; detailEl.hidden = false;
      detailEl.innerHTML = col.loaded ? `<div class="empty ak-empty"><h3>🤔 Nicht gefunden</h3><p>Vielleicht wurde es gelöscht.</p><a class="btn ghost sm" href="#alltag/inventar">Zum Inventar</a></div>` : `<p class="note">Lade …</p>`;
      return;
    }
    if (it) { home.hidden = true; detailEl.hidden = false; renderDetail(it); return; }
    home.hidden = false; detailEl.hidden = true; detailEl.innerHTML = "";
    renderHome();
  }
  function onClick(ev) {
    const v = ev.target.closest("[data-view]");
    if (v && el.contains(v)) { S.view = v.dataset.view; lsSet(VIEW_KEY, S.view); render(); return; }
    const r = ev.target.closest("[data-room]");
    if (r && el.contains(r) && !r.dataset.inv) { S.room = r.dataset.room; render(); return; }
    const b = ev.target.closest("[data-inv], [data-ak]");
    if (!b || !el.contains(b)) return;
    const it = S.id ? byId(S.id) : null;
    switch (b.dataset.inv || b.dataset.ak) {
      case "new": openForm(); break;
      case "print": openPrint(); break;
      case "open": A.go(I.itemHash(b.dataset.id)); break;
      case "back": A.go("#alltag/inventar"); break;
      case "room": S.room = b.dataset.room; S.view = "alle"; lsSet(VIEW_KEY, "alle"); render(); break;
      case "edit": if (it) openForm(col.get(it.id)); break;
      case "qr": if (it) openQR(it); break;
      case "photo": if (it) showPhoto(it); break;
      default: break;
    }
  }
  qIn.addEventListener("input", () => { S.q = qIn.value; renderHome(); });
  el.addEventListener("click", onClick);
  const offs = [col.watch(queue), A.watchDocs(queue)];
  const offRoute = A.onRoute((h) => { if (/^#alltag\/inventar/.test(h)) { closePrint(true); queue(); window.scrollTo(0, 0); } });
  render();
  return () => {
    alive = false;
    closePrint(true);
    offs.forEach((o) => o());
    offRoute();
    el.removeEventListener("click", onClick);
    el.innerHTML = "";
  };
}
