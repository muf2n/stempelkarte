// Update 11 – 🏡 Haushalt › 🗑️ Müll und 🥫 Vorrat (als Tabs im Haushalt-Bereich, eingebunden aus ./haushalt.js).
// Müll: Tonnen mit Rhythmus (jede/alle n Wochen) + Zusatztermine + ausgefallene Termine, Erinnerung am Vorabend.
// Vorrat: Artikel mit Menge, Mindestmenge, Ort und MHD; knappe Artikel mit einem Tipp auf die Einkaufsliste.
// Daten: Sammlungen „muell“, „vorrat“ (und „einkauf“ beim Übertragen). Reine Logik: ./hausextra-core.js
import { collection } from "./db.js";
import * as X from "./hausextra-core.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });

/** Bindet den Tab in `el` ein → Abmelde-Funktion. */
export function mountTab(tab, el) {
  return tab === "muell" ? mountMuell(el) : mountVorrat(el);
}

/* ================================================================== Müll */
function mountMuell(el) {
  const col = collection("muell");
  let alive = true;
  const bins = () => col.all().map(X.normBin).filter((b) => b.id);

  function render() {
    if (!alive) return;
    const today = X.todayKey();
    const list = bins();
    if (!col.loaded && !list.length) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const next = X.upcoming(list, today, 35);
    let h = `<div class="hx">`;
    if (!list.length) {
      h += `<div class="empty hx-empty"><div class="hx-emo" aria-hidden="true">🗑️</div><h3>Müllkalender</h3>
        <p>Trag deine Tonnen mit dem Abholrhythmus ein – die App erinnert dich am Vorabend, was rausmuss. 🚛</p>
        <div class="chips">${X.BINS.slice(0, 5).map((b) => `<button type="button" class="chip" data-hx="newbin" data-kind="${b.kind}">${b.e} ${esc(b.name)}</button>`).join("")}</div></div>`;
    } else {
      const first = next[0];
      if (first) {
        const d = X.diffDays(today, first.day);
        h += `<div class="hx-next card"><span class="hx-truck" aria-hidden="true">🚛</span><div><small>${d === 0 ? "Heute" : d === 1 ? "Morgen" : `In ${d} Tagen`} · ${X.fmtShort(first.day)}</small>
          <b>${first.bins.map((b) => `${b.e} ${esc(b.name)}`).join(" · ")}</b></div></div>`;
      }
      h += `<h4 class="hx-h">📅 Die nächsten 5 Wochen</h4><ul class="hx-days">${next.map((g) => `<li><span class="hx-day${g.day === today ? " today" : ""}">${X.fmtShort(g.day)}</span><span class="hx-bins">${g.bins.map((b) =>
        `<button type="button" class="hx-pill" style="--c:${b.color}" data-hx="date" data-id="${esc(b.id)}" data-day="${g.day}" title="Termin ändern">${b.e} ${esc(b.name)}</button>`).join("")}</span></li>`).join("") || `<li class="note">Keine Termine – prüf den Rhythmus deiner Tonnen.</li>`}</ul>`;
      h += `<h4 class="hx-h">🗑️ Deine Tonnen</h4><ul class="hx-list">${list.map((b) => {
        const n = X.nextPickup(b, today);
        return `<li class="hx-item" style="--c:${b.color}"><span class="hx-dot" aria-hidden="true">${b.e}</span><div><b>${esc(b.name)}</b><small>${esc((X.EVERY.find(([v]) => v === b.every) || [, ""])[1])}${n ? ` · nächstes Mal ${X.fmtShort(n)}` : ""}${b.remind ? "" : " · 🔕"}</small></div>
          <button type="button" class="btn ghost sm" data-hx="editbin" data-id="${esc(b.id)}" aria-label="${esc(b.name)} bearbeiten">✏️</button></li>`;
      }).join("")}</ul>
      <button type="button" class="btn primary sm" data-hx="newbin">➕ Tonne hinzufügen</button>
      <p class="note">💡 Termin verschoben (z. B. wegen Feiertag)? Tipp oben auf den Termin.</p>`;
    }
    el.innerHTML = h + `</div>`;
  }

  function binForm(bin, kind) {
    const isNew = !bin;
    const b = X.normBin(bin || { kind: kind || "rest", start: X.todayKey() });
    ui.openSheet({
      title: isNew ? "🗑️ Neue Tonne" : `${b.e} ${b.name}`,
      bodyHTML: `<div class="fields hx-form">
        <div class="lbl">Art</div><div class="chips" data-r="kind">${X.BINS.map((x) => `<button type="button" class="chip" data-fkind="${x.kind}" aria-pressed="${b.kind === x.kind}">${x.e} ${esc(x.name)}</button>`).join("")}</div>
        <label>Name<input id="hx-name" maxlength="40" value="${esc(bin ? b.name : "")}" placeholder="${esc(b.name)}"></label>
        <label>Wie oft?<select id="hx-every">${X.EVERY.map(([n, l]) => `<option value="${n}"${b.every === n ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Ein Abholtag (Startdatum)<input id="hx-start" type="date" value="${esc(b.start)}"></label>
        <label>Zusätzliche Termine (TT.MM.JJJJ, durch Komma)<input id="hx-dates" placeholder="z. B. 14.11.2026, 28.11.2026" value="${esc(b.dates.map(X.fmtDay).join(", "))}"></label>
        <label class="switch"><span>🔔 Am Vorabend erinnern</span><input type="checkbox" id="hx-remind"${b.remind ? " checked" : ""}></label>
        <p class="note">Den Abfuhrkalender bekommst du von deiner Gemeinde oder dem Abfallverband – meist reicht ein Termin und der Rhythmus.</p>
      </div>
      <div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        let kindSel = b.kind;
        $('[data-r="kind"]').addEventListener("click", (ev) => {
          const c = ev.target.closest("[data-fkind]"); if (!c) return;
          kindSel = c.dataset.fkind;
          sheet.querySelectorAll("[data-fkind]").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
          $("#hx-name").placeholder = X.binByKind(kindSel).name;
        });
        $("[data-save]").addEventListener("click", async () => {
          const every = Number($("#hx-every").value);
          const start = $("#hx-start").value;
          const dates = $("#hx-dates").value.split(/[,;\s]+/).map((t) => { const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; }).filter(X.isKey);
          if (every > 0 && !X.isKey(start)) { ui.toast("Bitte einen Abholtag als Startdatum wählen."); return; }
          if (every === 0 && !dates.length) { ui.toast("Bitte mindestens einen Termin eintragen."); return; }
          const doc = X.normBin({ ...b, kind: kindSel, name: $("#hx-name").value.trim() || X.binByKind(kindSel).name, every, start, dates, remind: $("#hx-remind").checked, updated: Date.now() });
          close();
          await safe(col.put(doc), isNew ? `${doc.e} ${doc.name} ist im Kalender ✓` : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", () => { close(); safe(col.remove(b.id), "Gelöscht 🗑️"); });
      },
    });
  }

  function dateForm(bin, day) {
    const b = X.normBin(bin);
    ui.openSheet({
      title: `${b.e} ${b.name} · ${X.fmtShort(day)}`,
      bodyHTML: `<div class="fields"><p>Fällt dieser Termin aus oder wird er verschoben (z. B. wegen eines Feiertags)?</p>
        <label>Neuer Tag (leer = fällt aus)<input id="hx-move" type="date" value=""></label></div>
        <div class="row"><button type="button" class="btn ghost" data-skip>🚫 Fällt aus</button><button type="button" class="btn primary" data-move>📅 Verschieben</button></div>`,
      onMount(sheet, close) {
        sheet.querySelector("[data-skip]").addEventListener("click", () => { close(); safe(col.put({ ...X.skipDate(b, day), updated: Date.now() }), "Termin gestrichen ✓"); });
        sheet.querySelector("[data-move]").addEventListener("click", () => {
          const to = sheet.querySelector("#hx-move").value;
          if (!X.isKey(to)) { ui.toast("Bitte einen neuen Tag wählen – oder „Fällt aus“."); return; }
          close(); safe(col.put({ ...X.moveDate(b, day, to), updated: Date.now() }), `Verschoben auf ${X.fmtShort(to)} ✓`);
        });
      },
    });
  }

  const onClick = (ev) => {
    const btn = ev.target.closest("[data-hx]"); if (!btn || !el.contains(btn)) return;
    const a = btn.dataset.hx, bin = btn.dataset.id ? col.get(btn.dataset.id) : null;
    if (a === "newbin") binForm(null, btn.dataset.kind);
    else if (a === "editbin" && bin) binForm(bin);
    else if (a === "date" && bin) dateForm(bin, btn.dataset.day);
  };
  el.addEventListener("click", onClick);
  const off = col.watch(() => queueMicrotask(render));
  render();
  return () => { alive = false; el.removeEventListener("click", onClick); try { off(); } catch { /* egal */ } };
}

/* ================================================================== Vorrat */
function mountVorrat(el) {
  const col = collection("vorrat");
  const shop = collection("einkauf");
  let alive = true, place = "";
  const items = () => col.all().map(X.normStock).filter((x) => x.id && x.name);
  const FLAG = { leer: "🚫 leer", knapp: "⚠️ knapp", abgelaufen: "⌛ abgelaufen", bald: "⏰ MHD bald" };

  function render() {
    if (!alive) return;
    const today = X.todayKey();
    const all = items();
    if (!col.loaded && !all.length) { el.innerHTML = `<p class="note">Lade …</p>`; return; }
    const low = all.filter(X.needsBuying);
    const places = X.PLACES.filter(([id]) => all.some((x) => x.place === id));
    if (place && !places.some(([id]) => id === place)) place = "";
    const list = X.sortStock(place ? all.filter((x) => x.place === place) : all, today);
    let h = `<div class="hx">`;
    if (!all.length) {
      h += `<div class="empty hx-empty"><div class="hx-emo" aria-hidden="true">🥫</div><h3>Was hast du daheim?</h3>
        <p>Trag deine Vorräte ein – mit Mindestmenge und Ablaufdatum. Wird etwas knapp, kommt es mit einem Tipp auf die Einkaufsliste. 🛒</p>
        <button type="button" class="btn primary sm" data-hx="new">➕ Erster Artikel</button></div>`;
    } else {
      h += `<div class="hx-bar">${low.length ? `<button type="button" class="btn primary sm" data-hx="toshop">🛒 ${low.length} knapp → Einkaufsliste</button>` : `<span class="note">✨ Alles da</span>`}
        <button type="button" class="btn ghost sm" data-hx="new">➕ Artikel</button></div>`;
      if (places.length > 1) h += `<div class="chips"><button type="button" class="chip" data-place="" aria-pressed="${!place}">Alle</button>${places.map(([id, e, l]) => `<button type="button" class="chip" data-place="${id}" aria-pressed="${place === id}">${e} ${esc(l)}</button>`).join("")}</div>`;
      h += `<ul class="hx-list">${list.map((x) => {
        const f = X.stockState(x, today);
        return `<li class="hx-item hx-stock${f.length ? " warn" : ""}"><span class="hx-dot" aria-hidden="true">${X.placeBy(x.place)[1]}</span>
          <div><b>${esc(x.name)}</b><small>${f.map((k) => FLAG[k]).join(" · ")}${f.length ? " · " : ""}${x.min ? `min. ${String(x.min).replace(".", ",")} · ` : ""}${x.best ? `MHD ${X.fmtDay(x.best)}` : ""}</small></div>
          <div class="hx-qty"><button type="button" class="btn ghost sm" data-hx="minus" data-id="${esc(x.id)}" aria-label="${esc(x.name)} weniger">−</button>
          <button type="button" class="hx-q" data-hx="edit" data-id="${esc(x.id)}" aria-label="${esc(x.name)} bearbeiten">${esc(X.fmtQty(x))}</button>
          <button type="button" class="btn ghost sm" data-hx="plus" data-id="${esc(x.id)}" aria-label="${esc(x.name)} mehr">+</button></div></li>`;
      }).join("")}</ul>`;
    }
    el.innerHTML = h + `</div>`;
  }

  function form(it) {
    const isNew = !it;
    const x = X.normStock(it || { place: place || "speis" });
    ui.openSheet({
      title: isNew ? "🥫 Neuer Vorrat" : x.name,
      bodyHTML: `<div class="fields">
        <label>Was?<input id="hv-name" maxlength="60" value="${esc(x.name)}" placeholder="z. B. Nudeln"></label>
        <div class="row"><label>Menge<input id="hv-qty" inputmode="decimal" value="${isNew ? "1" : String(x.qty).replace(".", ",")}"></label>
          <label>Einheit<select id="hv-unit">${X.VUNITS.map((u) => `<option${x.unit === u ? " selected" : ""}>${u}</option>`).join("")}</select></label></div>
        <div class="row"><label>Knapp ab<input id="hv-min" inputmode="decimal" value="${x.min ? String(x.min).replace(".", ",") : ""}" placeholder="z. B. 1"></label>
          <label>Haltbar bis (MHD)<input id="hv-best" type="date" value="${esc(x.best)}"></label></div>
        <label>Wo?<select id="hv-place">${X.PLACES.map(([id, e, l]) => `<option value="${id}"${x.place === id ? " selected" : ""}>${e} ${esc(l)}</option>`).join("")}</select></label>
        <label>Notiz (optional)<input id="hv-note" maxlength="200" value="${esc(x.note)}"></label></div>
        <div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        if (isNew) $("#hv-name").focus();
        $("[data-save]").addEventListener("click", async () => {
          const name = $("#hv-name").value.trim();
          if (!name) { ui.toast("Bitte eintragen, was es ist."); return; }
          const doc = X.normStock({ ...x, name, qty: $("#hv-qty").value, unit: $("#hv-unit").value, min: $("#hv-min").value, best: $("#hv-best").value, place: $("#hv-place").value, note: $("#hv-note").value, updated: Date.now() });
          close();
          await safe(col.put(doc), isNew ? `🥫 ${name} im Vorrat ✓` : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", () => { close(); safe(col.remove(x.id), "Gelöscht 🗑️"); });
      },
    });
  }

  async function toShopping() {
    const add = X.toShopping(items(), shop.all());
    if (!add.length) { ui.toast("Steht schon alles auf der Einkaufsliste 👍"); return; }
    const now = Date.now();
    const ok = await safe(Promise.all(add.map((a) => shop.put({ ...a, created: now }))));
    if (ok) ui.toast(`🛒 ${add.length} ${add.length === 1 ? "Artikel" : "Artikel"} auf die Einkaufsliste (Privat) gesetzt`);
  }

  const onClick = (ev) => {
    const pb = ev.target.closest("[data-place]");
    if (pb && el.contains(pb)) { place = pb.dataset.place; render(); return; }
    const btn = ev.target.closest("[data-hx]"); if (!btn || !el.contains(btn)) return;
    const a = btn.dataset.hx, it = btn.dataset.id ? col.get(btn.dataset.id) : null;
    if (a === "new") form(null);
    else if (a === "edit" && it) form(it);
    else if ((a === "plus" || a === "minus") && it) safe(col.put(X.bump(it, a === "plus" ? 1 : -1)));
    else if (a === "toshop") toShopping();
  };
  el.addEventListener("click", onClick);
  const off = col.watch(() => queueMicrotask(render));
  const off2 = shop.watch(() => {});
  render();
  return () => { alive = false; el.removeEventListener("click", onClick); try { off(); off2(); } catch { /* egal */ } };
}
