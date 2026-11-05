// Update 9 (Agent C): Foto-Oberfläche – Kamera-Knopf („Heute“), Galerie (Tag/Ort), Vollbild mit Notiz,
// Löschen, Teilen, Tages-Blatt „Fotos am …“ und kleiner Streifen in „Mein Tag“.
import * as photos from "../photos.js";
import { esc, dayKey as toDayKey, clock, fmtDate } from "../util.js";
import * as albumsMod from "../gallery-albums.js"; // Update 9 – Galerie (automatische Alben)
import { mountActiveChip, savedToast } from "../gallery-active.js"; // Update 9 (Agent U) – aktive Kategorie

const GRID_SVG = '<svg class="ico" width="SZ" height="SZ" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>';
/** Update 9 – Galerie öffnen (Alltag › Galerie), optional direkt ein Album. */
export function openGalleryPage(albumId) {
  location.hash = albumId ? `alltag/galerie/a/${encodeURIComponent(albumId)}` : "alltag/galerie";
}
function galleryBtn(cls, label = "Galerie", size = 18) {
  return `<button type="button" class="${cls}" data-ph-gal aria-label="Galerie öffnen" title="Galerie">${GRID_SVG.replace(/SZ/g, String(size))}<span>${esc(label)}</span></button>`;
}

/** Update 9 – nach dem Speichern: Position + Album anhängen (blockiert das Speichern nicht). */
export function fileAfterSave(photo, ctx, posP, opts = {}) {
  albumsMod.autoFile(photo, { pos: posP, auto: opts.auto, placeId: photo && photo.placeId }).then((r) => {
    if (r && r.album && opts.toast !== false) savedToast(r, photo); // „In „Kategorie › Album“ gespeichert“ + Ändern
  }).catch((e) => console.error("Foto einsortieren:", e));
}

const CAM_SVG = '<svg class="ico ico-camera" width="SZ" height="SZ" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.6"/></svg>';
export const camIcon = (size = 20) => CAM_SVG.replace(/SZ/g, String(size));

function keyToDate(k) {
  const [y, m, d] = String(k).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function shiftKey(k, n) {
  const d = keyToDate(k);
  return toDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}
/** Modus + Nutzer (Fotos neu laden, wenn sich das Konto ändert). */
function ownerKey(s) { return s ? `${s.mode}:${(s.user && s.user.uid) || ""}:${s.ready ? 1 : 0}` : ""; }
function errMsg(e, fb) { return (e && e.message) || fb; }

/** Verstecktes Datei-Feld (Kamera) in einem Label-Knopf. */
function camLabel(cls, text, size = 20) {
  return `<label class="${cls}">${camIcon(size)}<span>${esc(text)}</span>` +
    `<input type="file" accept="image/*" capture="environment" class="ph-file" tabindex="-1"></label>`;
}
function wireFile(host, onFile) {
  host.addEventListener("change", (ev) => {
    const inp = ev.target.closest && ev.target.closest("input.ph-file");
    if (!inp) return;
    const f = inp.files && inp.files[0];
    inp.value = "";
    if (f) onFile(f);
  });
  // Tastatur: Enter/Leertaste auf dem Label öffnet die Auswahl
  host.addEventListener("keydown", (ev) => {
    const lab = ev.target.closest && ev.target.closest("label[data-ph-cam]");
    if (!lab || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    const inp = lab.querySelector("input.ph-file");
    if (inp) inp.click();
  });
}

/* ---------- Aufnahme: Vorschau + Notiz ---------- */

/** Nach der Auswahl/Aufnahme: Vorschau, Notiz, Speichern. meta = { dayKey, placeId, place, entryId } */
export function openCapture(file, ctx, meta = {}, opts = {}) {
  const work = photos.processImage(file);
  work.catch(() => {});
  // Update 9 – Galerie: Position gleich bei der Aufnahme anfragen (frisch < 60 s wird wiederverwendet)
  const posP = opts.file === false ? null : albumsMod.currentPosition();
  if (posP) posP.catch(() => {});
  const where = [meta.place || "", meta.dayKey ? fmtDate(keyToDate(meta.dayKey)) : ""].filter(Boolean).join(" · ");
  // Update 9 (Agent U) – Chip „Neue Fotos gehen nach …“ nur, wenn automatisch einsortiert wird
  const showActive = !!posP && opts.auto !== false && albumsMod.settings().auto;
  ctx.ui.openSheet({
    title: "Foto speichern",
    bodyHTML:
      `<div class="ph-cap">` +
        `<div class="ph-cap-img" data-ph="prev"><span class="note">Bild wird vorbereitet …</span></div>` +
        (where ? `<p class="note ph-cap-where">${camIcon(16)}<span>${esc(where)}</span></p>` : "") +
        (showActive ? `<div class="ph-cap-active" data-ph="active"></div>` : "") +
        `<div class="fields"><label>Notiz (optional)<input type="text" data-ph="note" maxlength="300" autocomplete="off" placeholder="z. B. Verteiler vor dem Anschließen"></label></div>` +
        `<div class="row"><button type="button" class="btn ghost" data-ph="cancel">Verwerfen</button>` +
        `<button type="button" class="btn primary" data-ph="save" disabled>Speichern</button></div>` +
      `</div>`,
    onMount(sheet, close) {
      const $ = (s) => sheet.querySelector(`[data-ph="${s}"]`);
      const save = $("save");
      let img = null;
      if (showActive) { try { mountActiveChip($("active")); } catch (e) { console.error(e); } }
      work.then((r) => {
        img = r;
        const box = $("prev");
        box.innerHTML = `<img alt="Vorschau" src="${r.data}">`;
        save.disabled = false;
      }).catch((e) => {
        $("prev").innerHTML = `<span class="note">${esc(errMsg(e, "Das Bild konnte nicht gelesen werden."))}</span>`;
      });
      $("cancel").addEventListener("click", close);
      const go = async () => {
        if (!img || save.disabled) return;
        ctx.ui.setBusy(save, true, "Speichert …");
        try {
          const r = await photos.addPhoto(null, { ...meta, processed: img, note: $("note").value });
          close();
          ctx.ui.toast(r.queued ? "Foto gespeichert – wird hochgeladen, sobald du Netz hast." : "Foto gespeichert.", r.queued ? 3600 : 2400);
          if (posP) fileAfterSave(r.photo, ctx, posP, { auto: opts.auto });
          if (opts.onSaved) { try { opts.onSaved(r.photo); } catch (e) { console.error(e); } }
        } catch (e) {
          console.error(e);
          ctx.ui.setBusy(save, false);
          ctx.ui.toast(errMsg(e, "Foto konnte nicht gespeichert werden."), 4000);
        }
      };
      save.addEventListener("click", go);
      $("note").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    },
  });
}

/* ---------- Vollbild ---------- */

let viewer = null;

function closeViewer(fromPop = false) {
  if (!viewer) return;
  const v = viewer;
  viewer = null;
  document.removeEventListener("keydown", v.onKey, true);
  window.removeEventListener("popstate", v.onPop);
  if (v.unsub) v.unsub();
  v.el.remove();
  if (v.onClose) { try { v.onClose(); } catch { /* egal */ } }
  document.body.style.overflow = v.prevOverflow;
  if (!fromPop && v.pushed && history.state && history.state.phv) history.back();
  if (v.prevFocus && document.contains(v.prevFocus)) { try { v.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

export async function sharePhoto(p, ctx) {
  const file = photos.photoFile(p);
  const text = [p.note, p.place, fmtDate(p.ts) + " " + clock(p.ts)].filter(Boolean).join(" · ");
  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "Foto", text });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  // Fallback: herunterladen
  try {
    const a = document.createElement("a");
    a.href = p.data;
    a.download = (file && file.name) || "Foto.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    ctx.ui.toast("Teilen geht hier nicht – Foto wird heruntergeladen.");
  } catch {
    ctx.ui.toast("Teilen geht hier nicht.");
  }
}

/** Foto als Datei herunterladen (Handy: landet in „Downloads“/Galerie). */
export function downloadPhoto(p, ctx) {
  const file = photos.photoFile(p);
  try {
    const a = document.createElement("a");
    a.href = p.data || p.thumb;
    a.download = (file && file.name) || "Foto.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (ctx) ctx.ui.toast("Foto wird gespeichert …");
  } catch {
    if (ctx) ctx.ui.toast("Speichern geht hier nicht.");
  }
}

/**
 * Foto im Vollbild zeigen; list = alle Fotos der Galerie (Wischen/Pfeile).
 * Update 9 – opts: { resolve(item) → Promise<volles Foto> (Liste enthält nur Vorschaubilder),
 *   extra(photo, host) (z. B. Album-Chips), onClose() }
 */
export function openViewer(list, index, ctx, opts = {}) {
  closeViewer();
  const items = (list || []).slice();
  if (!items.length) return;
  let i = Math.max(0, Math.min(items.length - 1, index || 0));
  const el = document.createElement("div");
  el.className = "ph-view";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Foto");
  el.tabIndex = -1;
  el.innerHTML =
    `<div class="ph-v-bar">` +
      `<span class="ph-v-n" data-v="n"></span>` +
      `<button type="button" class="ph-v-x" data-v="close" aria-label="Schließen">✕</button>` +
    `</div>` +
    `<div class="ph-v-stage" data-v="stage">` +
      `<button type="button" class="ph-v-arr ph-v-prev" data-v="prev" aria-label="Vorheriges Foto">‹</button>` +
      `<img data-v="img" alt="">` +
      `<button type="button" class="ph-v-arr ph-v-next" data-v="next" aria-label="Nächstes Foto">›</button>` +
    `</div>` +
    `<div class="ph-v-panel">` +
      `<div class="ph-v-meta" data-v="meta"></div>` +
      `<div class="ph-v-extra" data-v="extra" hidden></div>` +
      `<label class="ph-v-note"><span class="ph-sr">Notiz</span><textarea data-v="note" rows="2" maxlength="500" placeholder="Notiz hinzufügen …"></textarea></label>` +
      `<div class="ph-v-acts">` +
        `<button type="button" class="btn sm ghost" data-v="save" hidden>Notiz speichern</button>` +
        `<button type="button" class="btn sm ghost" data-v="share">Teilen</button>` +
        `<button type="button" class="btn sm ghost" data-v="dl" title="In Galerie des Handys speichern" aria-label="In Galerie des Handys speichern">Aufs Handy</button>` +
        `<button type="button" class="btn sm danger" data-v="del">Löschen</button>` +
      `</div>` +
    `</div>`;
  const $ = (s) => el.querySelector(`[data-v="${s}"]`);
  const v = {
    el, pushed: false, prevOverflow: document.body.style.overflow || "", prevFocus: document.activeElement,
    onKey: (ev) => {
      if (ev.target && ev.target.tagName === "TEXTAREA") { if (ev.key === "Escape") ev.target.blur(); return; }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeViewer(); }
      else if (ev.key === "ArrowLeft") { ev.preventDefault(); show(i - 1); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); show(i + 1); }
    },
    onPop: () => { if (viewer === v) closeViewer(true); },
  };
  viewer = v;

  const note = $("note"), saveBtn = $("save");
  let showSeq = 0;
  function drawExtra() {
    const host = $("extra");
    if (!opts.extra) return;
    host.hidden = false;
    try { opts.extra(items[i], host); } catch (e) { console.error(e); }
  }
  v.redrawExtra = () => { if (viewer === v) { drawMeta(); drawExtra(); } };
  v.items = items;
  function drawMeta() {
    const p = items[i];
    const where = [p.place, p.addr && p.addr !== p.place ? p.addr : ""].filter(Boolean).join(" · ");
    $("meta").innerHTML = `<b>${esc(fmtDate(p.ts))}, ${esc(clock(p.ts))}</b>${where ? ` · ${esc(where)}` : ""}`;
  }
  function show(n) {
    if (n < 0 || n >= items.length) return;
    i = n;
    const p = items[i];
    const my = ++showSeq;
    $("img").src = p.data || p.thumb;
    if (!p.data && opts.resolve) {
      Promise.resolve(opts.resolve(p)).then((full) => {
        if (my !== showSeq || viewer !== v || !full) return;
        if (full.data) { p.data = full.data; $("img").src = full.data; }
      }).catch((e) => console.error(e));
    }
    $("img").alt = p.note ? `Foto: ${p.note}` : `Foto vom ${fmtDate(p.ts)}`;
    $("n").textContent = items.length > 1 ? `${i + 1} / ${items.length}` : "";
    drawMeta();
    drawExtra();
    note.value = p.note || "";
    saveBtn.hidden = true;
    $("prev").hidden = i === 0;
    $("next").hidden = i === items.length - 1;
    resetDel();
  }

  // Löschen mit Bestätigung (zweimal tippen)
  const del = $("del");
  let armT = null;
  function resetDel() { clearTimeout(armT); del.textContent = "Löschen"; delete del.dataset.armed; }
  del.addEventListener("click", async () => {
    if (!del.dataset.armed) {
      del.dataset.armed = "1";
      del.textContent = "Wirklich löschen?";
      armT = setTimeout(resetDel, 4000);
      return;
    }
    resetDel();
    const p = items[i];
    del.disabled = true;
    try {
      await photos.deletePhoto(p.id);
      ctx.ui.toast("Foto gelöscht.");
      items.splice(i, 1);
      if (!items.length) { closeViewer(); return; }
      show(Math.min(i, items.length - 1));
    } catch (e) {
      ctx.ui.toast(errMsg(e, "Löschen hat nicht geklappt."), 3600);
    } finally {
      del.disabled = false;
    }
  });

  note.addEventListener("input", () => { saveBtn.hidden = note.value.trim() === String(items[i].note || "").trim(); });
  const saveNote = async () => {
    const p = items[i];
    const text = note.value.trim();
    if (text === String(p.note || "").trim()) { saveBtn.hidden = true; return; }
    try {
      await photos.updateNote(p.id, text);
      p.note = text;
      saveBtn.hidden = true;
      ctx.ui.toast("Notiz gespeichert.");
    } catch (e) {
      ctx.ui.toast(errMsg(e, "Notiz konnte nicht gespeichert werden."), 3600);
    }
  };
  saveBtn.addEventListener("click", saveNote);
  note.addEventListener("blur", (ev) => { if (ev.relatedTarget !== saveBtn) saveNote(); });

  const full = async (p) => (p.data || !opts.resolve) ? p : ({ ...p, ...((await opts.resolve(p)) || {}) });
  $("share").addEventListener("click", async () => sharePhoto(await full(items[i]), ctx));
  $("dl").addEventListener("click", async () => downloadPhoto(await full(items[i]), ctx));
  $("close").addEventListener("click", () => closeViewer());
  $("prev").addEventListener("click", () => show(i - 1));
  $("next").addEventListener("click", () => show(i + 1));
  // Hintergrund (nicht das Bild) schließt
  $("stage").addEventListener("click", (ev) => { if (ev.target === $("stage")) closeViewer(); });

  // Wischen
  let sx = null, sy = 0;
  $("stage").addEventListener("touchstart", (ev) => { const t = ev.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  $("stage").addEventListener("touchend", (ev) => {
    if (sx === null) return;
    const t = ev.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) show(dx < 0 ? i + 1 : i - 1);
  }, { passive: true });

  // Update 9 – Änderungen (Alben, Notiz von anderswo) übernehmen
  v.onClose = opts.onClose || null;
  v.unsub = photos.onChange((info) => {
    if (info.type !== "update" || viewer !== v) return;
    const x = items.find((y) => y.id === info.id);
    if (!x) return;
    Object.assign(x, info.patch || {});
    if (items[i] === x) { drawMeta(); drawExtra(); }
  });
  document.body.appendChild(el);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", v.onKey, true);
  try {
    history.pushState({ ...(history.state || {}), phv: 1 }, "", location.href);
    v.pushed = true;
    window.addEventListener("popstate", v.onPop);
  } catch { /* egal */ }
  show(i);
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
}

/* ---------- Galerie ---------- */

/**
 * Galerie in host zeichnen. q = { dayKey } oder { placeId }.
 * opts: { title, addMeta: () => meta | null (zeigt „+ Foto“), empty, onCount(n) }
 * Räumt sich selbst auf, sobald host nicht mehr im Dokument ist.
 */
export function mountGallery(host, ctx, q, opts = {}) {
  let list = [];
  let seq = 0;
  let unsub = null;
  host.classList.add("ph-gal");
  host.innerHTML =
    `<div class="ph-gal-h"><span class="ph-gal-t">${camIcon(18)}<span data-g="t">${esc(opts.title || "Fotos")}</span></span>` +
    (opts.addMeta ? camLabel("btn sm ghost ph-add", "Foto", 18).replace("<label ", '<label data-ph-cam tabindex="0" role="button" ') : "") +
    `</div><div class="ph-grid" data-g="grid"><span class="note">Fotos werden geladen …</span></div>`;
  const grid = host.querySelector('[data-g="grid"]');
  const tEl = host.querySelector('[data-g="t"]');

  const matches = (p) => p && (q.dayKey ? p.dayKey === q.dayKey : p.placeId === q.placeId);

  function draw() {
    tEl.textContent = (opts.title || "Fotos") + (list.length ? ` (${list.length})` : "");
    if (!list.length) {
      grid.innerHTML = `<span class="note ph-empty">${esc(opts.empty || "Noch keine Fotos.")}</span>`;
    } else {
      grid.innerHTML = list.map((p, n) =>
        `<button type="button" class="ph-th" data-n="${n}" aria-label="${esc(p.note ? "Foto: " + p.note : "Foto " + clock(p.ts))}">` +
        `<img src="${p.thumb || p.data}" alt="" loading="lazy" decoding="async">` +
        (p.note ? `<span class="ph-th-n" aria-hidden="true">✎</span>` : "") + `</button>`).join("");
    }
    if (opts.onCount) { try { opts.onCount(list.length); } catch { /* egal */ } }
  }

  async function load() {
    const my = ++seq;
    try {
      const r = q.dayKey ? await photos.listByDay(q.dayKey) : await photos.listByPlace(q.placeId);
      if (my !== seq) return;
      list = r;
      draw();
    } catch (e) {
      if (my !== seq) return;
      console.error(e);
      grid.innerHTML = `<span class="note ph-empty">Fotos konnten nicht geladen werden${navigator.onLine === false ? " (offline)" : ""}.</span>`;
    }
  }

  grid.addEventListener("click", (ev) => {
    const b = ev.target.closest(".ph-th");
    if (b) openViewer(list, Number(b.dataset.n) || 0, ctx);
  });
  if (opts.addMeta) {
    wireFile(host, (file) => {
      const meta = opts.addMeta();
      if (meta) openCapture(file, ctx, meta);
    });
  }
  unsub = photos.onChange((info) => {
    if (!host.isConnected) { destroy(); return; }
    const p = info.photo;
    if (info.type === "add" && !matches(p)) return;
    if (info.type === "delete" && !list.some((x) => x.id === info.id)) return;
    if (info.type === "note") {
      const x = list.find((y) => y.id === info.id);
      if (x) { x.note = info.note; draw(); }
      return;
    }
    if (info.type === "update") { // Update 9 – Galerie: Album/Position geändert → nur übernehmen
      const x = list.find((y) => y.id === info.id);
      if (x) Object.assign(x, info.patch || {});
      return;
    }
    load();
  });
  function destroy() { if (unsub) { unsub(); unsub = null; } seq++; }
  load();
  return { refresh: load, destroy, get count() { return list.length; } };
}

/* ---------- Tages-Blatt ---------- */

/** Blatt „Fotos“ für einen Tag (mit Tag vor/zurück). */
export function openDayPhotos(dayKey, ctx) {
  let k = dayKey || toDayKey(Date.now());
  ctx.ui.openSheet({
    title: "Fotos",
    bodyHTML:
      `<div class="nav ph-daynav">` +
        `<button type="button" class="btn ghost sm" data-d="prev" aria-label="Vorheriger Tag">‹</button>` +
        `<b data-d="label"></b>` +
        `<button type="button" class="btn ghost sm" data-d="next" aria-label="Nächster Tag">›</button>` +
      `</div><div data-d="gal"></div>` +
      galleryBtn("btn ghost ph-day-gal", "Alle Fotos in der Galerie", 18), // Update 9 – Galerie
    onMount(sheet, close) {
      let g = null;
      const today = toDayKey(Date.now());
      const render = () => {
        sheet.querySelector('[data-d="label"]').textContent = fmtDate(keyToDate(k));
        sheet.querySelector('[data-d="next"]').disabled = k >= today;
        if (g) g.destroy();
        g = mountGallery(sheet.querySelector('[data-d="gal"]'), ctx, { dayKey: k }, {
          title: "Fotos an diesem Tag",
          empty: k === today ? "Heute noch keine Fotos – während du eingestempelt bist, kannst du in „Heute“ welche machen." : "An diesem Tag gibt es keine Fotos.",
        });
      };
      sheet.querySelector("[data-ph-gal]").addEventListener("click", () => { close(); openGalleryPage(); });
      sheet.querySelector('[data-d="prev"]').addEventListener("click", () => { k = shiftKey(k, -1); render(); });
      sheet.querySelector('[data-d="next"]').addEventListener("click", () => { if (k < today) { k = shiftKey(k, 1); render(); } });
      render();
    },
  });
}

/* ---------- Kamera-Knopf in „Heute“ ---------- */

/** Meta für ein Foto aus der laufenden Schicht (aktueller Abschnitt → Ort). */
export function runningMeta(snap, ctx) {
  const r = snap && snap.running;
  if (!r) return null;
  let segs = [];
  try { segs = ctx.timer.segmentsOf ? ctx.timer.segmentsOf(r) : (r.segments || []); } catch { segs = []; }
  const s = segs[segs.length - 1] || {};
  const placeId = s.placeId || r.placeId || null;
  const pl = placeId ? ((snap.places || []).find((p) => p.id === placeId) || null) : null;
  const place = (pl && pl.name) || s.place || r.place || (s.loc && s.loc.addr) || (r.inLoc && r.inLoc.addr) || "";
  return { dayKey: toDayKey(Date.now()), placeId: placeId || null, place, entryId: null };
}

/** Kamera-Leiste: nur sichtbar, solange eingestempelt. → { update(snap) } */
export function mountPhotoBar(host, ctx) {
  let snap = null;
  let dayK = "";
  let own = "";
  let count = 0;
  let seq = 0;
  host.classList.add("ph-bar");
  host.hidden = true;
  host.innerHTML =
    camLabel("btn ghost ph-cam", "Foto aufnehmen", 22).replace("<label ", '<label data-ph-cam tabindex="0" role="button" ') +
    `<button type="button" class="btn ghost ph-count" data-pb="count" hidden></button>`;
  const cBtn = host.querySelector('[data-pb="count"]');
  wireFile(host, (file) => {
    const meta = runningMeta(snap || ctx.store.get(), ctx);
    if (!meta) { ctx.ui.toast("Fotos gehen nur, während du eingestempelt bist."); return; }
    openCapture(file, ctx, meta);
  });
  cBtn.addEventListener("click", () => openDayPhotos(dayK, ctx));

  function drawCount() {
    cBtn.hidden = !count;
    cBtn.innerHTML = `<span>📷 ${count}</span><span class="ph-count-l">heute</span>`;
    cBtn.setAttribute("aria-label", `${count} ${count === 1 ? "Foto" : "Fotos"} heute ansehen`);
  }
  async function loadCount() {
    const my = ++seq;
    try {
      const r = await photos.countByDays([dayK]);
      if (my === seq) { count = r[dayK] || 0; drawCount(); }
    } catch { /* egal */ }
  }
  photos.onChange((info) => {
    if (!host.isConnected || host.hidden) return;
    if (info.type === "note" || info.type === "update") return;
    if (info.type === "add" && info.photo && info.photo.dayKey !== dayK) return;
    loadCount();
  });

  return {
    update(s) {
      snap = s;
      const on = !!(s && s.running);
      host.hidden = !on;
      if (!on) return;
      const k = toDayKey(Date.now());
      const o = ownerKey(s);
      if (k !== dayK || o !== own) { dayK = k; own = o; count = 0; drawCount(); loadCount(); }
    },
  };
}

/* ---------- Streifen in „Mein Tag“ ---------- */

/** Kleine Vorschau der Fotos eines Tages (versteckt, wenn keine). → { update(dayKey) } */
export function mountDayStrip(host, ctx) {
  let k = "";
  let own = "";
  let list = [];
  let seq = 0;
  host.hidden = true;
  host.classList.add("ph-strip");
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ps]");
    if (!b) return;
    if (b.dataset.ps === "all") openDayPhotos(k, ctx);
    else if (b.dataset.ps === "gal") openGalleryPage(); // Update 9 – Galerie
    else openViewer(list, Number(b.dataset.ps) || 0, ctx);
  });
  function draw() {
    host.hidden = !list.length;
    if (!list.length) { host.innerHTML = ""; return; }
    const max = 3; // Update 9 – Platz für den „Galerie“-Knopf
    const shown = list.slice(-max);
    const off = list.length - shown.length;
    host.innerHTML =
      `<button type="button" class="ph-strip-l" data-ps="all" aria-label="Alle Fotos von heute ansehen">${camIcon(16)}<span>${list.length} ${list.length === 1 ? "Foto" : "Fotos"}</span></button>` +
      `<div class="ph-strip-row">` +
      shown.map((p, n) => `<button type="button" class="ph-th ph-th-s" data-ps="${off + n}" aria-label="Foto ${esc(clock(p.ts))}"><img src="${p.thumb || p.data}" alt="" decoding="async"></button>`).join("") +
      `</div>` +
      galleryBtn("ph-strip-gal", "Galerie", 16).replace("data-ph-gal", 'data-ps="gal"');
  }
  async function load() {
    const my = ++seq;
    try {
      const r = await photos.listByDay(k);
      if (my === seq) { list = r; draw(); }
    } catch { /* still */ }
  }
  photos.onChange((info) => {
    if (!host.isConnected) return;
    if (info.type === "add" && info.photo && info.photo.dayKey !== k) return;
    if (info.type === "note" || info.type === "update") return;
    load();
  });
  return {
    update(dayKey, s) {
      const o = ownerKey(s);
      if (dayKey === k && o === own) return;
      k = dayKey;
      own = o;
      list = [];
      draw();
      load();
    },
    refresh: load,
  };
}
