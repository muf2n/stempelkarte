// Update 11 – Unterwegs › Reise › 📔 Reisetagebuch: ein Eintrag pro Tag (oder mehrere) mit Stimmung, Text und Fotos.
// Fotos landen in der normalen Galerie (Tag des Eintrags, Notiz „Reisetagebuch: <Reise>“) – hier nur verknüpft.
// Sammlung travel_journal. Logik: ./journal-core.js
import * as J from "./journal-core.js";
import { esc } from "../util.js";
import { safeWrite, shareText } from "./unterwegs-shared.js";

const thumbs = new Map(); // Foto-ID → Vorschaubild (dataURL) oder "" (fehlt)

export function createJournal({ col, ui, queue, todayKey }) {
  let photosMod = null;
  const loadPhotos = () => (photosMod ? Promise.resolve(photosMod) : import("../photos.js").then((m) => (photosMod = m)));

  function sectionHTML(trip) {
    const list = J.forTrip(col.all(), trip.id);
    const T = esc(trip.id);
    return `<section class="card uw-card uw-journal"><div class="uw-h-row"><h3 class="uw-h">📔 Reisetagebuch</h3>` +
      `<span class="uw-jr-acts">${list.length ? `<button type="button" class="chip sm" data-jr="share" data-id="${T}">📤 Teilen</button>` : ""}` +
      `<button type="button" class="chip sm" data-jr="new" data-id="${T}">✍️ Eintrag</button></span></div>` +
      (list.length ? `<ol class="uw-jr">${list.map((e) => `<li class="uw-jr-e">` +
          `<button type="button" class="uw-jr-head" data-jr="edit" data-id="${T}" data-eid="${esc(e.id)}">` +
            `<span class="uw-jr-day">${esc(J.dayLabel(e.day, trip.from))}</span>${e.mood ? `<span class="uw-jr-mood" aria-label="Stimmung">${e.mood}</span>` : ""}</button>` +
          (e.title ? `<b class="uw-jr-t">${esc(e.title)}</b>` : "") +
          (e.text ? `<p class="uw-jr-text">${esc(e.text)}</p>` : "") +
          (e.photoIds.length ? `<div class="uw-jr-ph">${e.photoIds.map((pid) => `<span class="uw-jr-img" data-ph="${esc(pid)}">${thumbs.get(pid) ? `<img src="${esc(thumbs.get(pid))}" alt="" loading="lazy">` : ""}</span>`).join("")}</div>` : "") +
        `</li>`).join("")}</ol>`
        : `<p class="note">Halte fest, was du erlebt hast – ein paar Sätze, die Stimmung und Fotos pro Tag. Später schön zum Nachlesen. 🌅</p>`) +
    `</section>`;
  }

  /** Nach dem Zeichnen fehlende Vorschaubilder nachladen. */
  function afterRender(root) {
    const missing = [...root.querySelectorAll(".uw-jr-img[data-ph]")].map((x) => x.dataset.ph).filter((id) => !thumbs.has(id));
    if (!missing.length) return;
    for (const id of missing) thumbs.set(id, ""); // nur einmal versuchen
    loadPhotos().then(async (P) => {
      let any = false;
      for (const id of missing) {
        try { const p = await P.getPhoto(id); if (p && (p.thumb || p.data)) { thumbs.set(id, p.thumb || p.data); any = true; } } catch { /* fehlt */ }
      }
      if (any) queue();
    }).catch(() => {});
  }

  function openEntry(trip, entry) {
    const isNew = !entry;
    const e = J.normEntry(entry || { tripId: trip.id, day: J.suggestDay(trip, J.forTrip(col.all(), trip.id), todayKey()) });
    let mood = e.mood, photoIds = [...e.photoIds];
    const phHTML = () => photoIds.map((pid) => `<span class="uw-jr-img" data-ph="${esc(pid)}">${thumbs.get(pid) ? `<img src="${esc(thumbs.get(pid))}" alt="">` : "📷"}<button type="button" class="uw-jr-x" data-rmph="${esc(pid)}" aria-label="Foto entfernen">✕</button></span>`).join("");
    ui.openSheet({
      title: isNew ? "📔 Neuer Tagebuch-Eintrag" : "📔 Eintrag bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Tag<input id="jr-day" type="date" value="${esc(e.day)}"${trip.from ? ` min="${esc(trip.from)}"` : ""}${trip.to ? ` max="${esc(trip.to)}"` : ""}></label>` +
        `<div class="lbl">Stimmung</div><div class="chips" data-r="mood">${J.MOODS.map((m) => `<button type="button" class="chip" data-mood="${m}" aria-pressed="${mood === m}">${m}</button>`).join("")}</div>` +
        `<label>Überschrift (optional)<input id="jr-title" maxlength="80" value="${esc(e.title)}" placeholder="z. B. Strandtag in Caorle"></label>` +
        `<label>Was hast du erlebt?<textarea id="jr-text" rows="6" maxlength="4000" placeholder="Wo warst du, was hast du gegessen, was war das Highlight?">${esc(e.text)}</textarea></label>` +
        `<div class="lbl">📷 Fotos</div><div class="uw-jr-ph" data-r="ph">${phHTML()}</div>` +
        `<label class="btn ghost sm uw-jr-add">➕ Fotos hinzufügen<input id="jr-file" type="file" accept="image/*" multiple hidden></label>` +
        `<small class="note">Fotos landen auch in deiner Galerie (am selben Tag).</small>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        const drawPh = () => { $('[data-r="ph"]').innerHTML = phHTML(); };
        $('[data-r="mood"]').addEventListener("click", (ev) => {
          const c = ev.target.closest("[data-mood]"); if (!c) return;
          mood = mood === c.dataset.mood ? "" : c.dataset.mood;
          sheet.querySelectorAll("[data-mood]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mood === mood)));
        });
        $('[data-r="ph"]').addEventListener("click", (ev) => {
          const r = ev.target.closest("[data-rmph]"); if (!r) return;
          photoIds = photoIds.filter((p) => p !== r.dataset.rmph); drawPh();
        });
        $("#jr-file").addEventListener("change", async (ev) => {
          const files = [...(ev.target.files || [])].slice(0, 12);
          ev.target.value = "";
          if (!files.length) return;
          const day = $("#jr-day").value || e.day;
          ui.toast(`📷 ${files.length} ${files.length === 1 ? "Foto wird" : "Fotos werden"} gespeichert …`, 1500);
          try {
            const P = await loadPhotos();
            for (const f of files) {
              const { photo } = await P.addPhoto(f, { dayKey: day, note: `Reisetagebuch: ${trip.title || "Reise"}` });
              thumbs.set(photo.id, photo.thumb || photo.data);
              photoIds.push(photo.id);
            }
            drawPh();
          } catch (err) { console.error(err); ui.toast("Foto konnte nicht gespeichert werden."); }
        });
        $("[data-save]").addEventListener("click", async () => {
          const day = $("#jr-day").value;
          if (!day) { ui.toast("Bitte einen Tag wählen."); return; }
          const text = $("#jr-text").value.trim(), title = $("#jr-title").value.trim();
          if (!text && !title && !photoIds.length && !mood) { ui.toast("Schreib etwas oder füg ein Foto hinzu 🙂"); return; }
          const now = Date.now();
          const doc = J.normEntry({ ...e, day, mood, title, text, photoIds, created: e.created || now, updated: now });
          close();
          await safeWrite(ui, col.put(doc), isNew ? "📔 Eingetragen – schöne Erinnerung!" : "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Eintrag löschen? (Fotos bleiben in der Galerie)", () => { close(); safeWrite(ui, col.remove(e.id), "Gelöscht 🗑️"); });
      },
    });
  }

  /** Klick-Weiche für [data-jr] → true, wenn behandelt. */
  function onClick(t, trip) {
    const a = t.dataset.jr;
    if (!a || !trip) return false;
    if (a === "new") openEntry(trip, null);
    else if (a === "edit") { const e = col.get(t.dataset.eid); if (e) openEntry(trip, e); }
    else if (a === "share") shareText(ui, `Reisetagebuch ${trip.title || ""}`.trim(), J.exportText(trip, J.forTrip(col.all(), trip.id)));
    return true;
  }

  return { sectionHTML, afterRender, onClick };
}
