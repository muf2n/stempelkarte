// Update 9 (Agent U) – Galerie: aktive Kategorie „Neue Fotos gehen nach …“.
//   mountActiveChip(host)  – Chip „📂 Kategorie: 🏠 Wohnungen ▾“ (+ Einsatz-Vorschlag), im Aufnahme-Blatt und in der Galerie.
//   openActivePicker()     – Blatt: alle Hauptkategorien + „Neue Hauptkategorie“ direkt anlegen.
//   savedToast(r, photo)   – „In „Wohnungen › Musterstraße 5, Graz“ gespeichert“ mit „Ändern“.
//   openChangeSheet(…)     – neues Album in andere Kategorie / Foto in anderes Album.
// Die Regel selbst steht in gallery-core.js (resolveActiveFolder, folderForNewAlbum), angewendet in gallery-albums.js.
import * as A from "./gallery-albums.js";
import * as G from "./gallery-core.js";
import * as store from "./store.js";
import * as photos from "./photos.js";
import * as ui from "./ui.js";
import { esc, dayKey as toDayKey } from "./util.js";
import { einsatzFor } from "./einsatz.js";

const EZ_KEY = "sk-ga-ez"; // Einsatz-Vorschlag erledigt: "<dayKey>|<einsatzId>"
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const OHNE = { id: G.OHNE_KAT, name: "Keine Kategorie", emoji: "🗂️", color: "#64748b" };

export function injectCSS() {
  if (document.getElementById("ga-css")) return;
  const l = document.createElement("link");
  l.id = "ga-css"; l.rel = "stylesheet";
  l.href = new URL("../css/gallery-active.css", import.meta.url).href;
  document.head.appendChild(l);
}

const fst = (f) => `style="--fc:${esc((f && f.color) || OHNE.color)}"`;

/* ---------- Einsatz-Vorschlag (einmal pro Tag) ---------- */

/** → { einsatz, folder, key } | null */
export function einsatzSuggestion() {
  let ez = null;
  const k = toDayKey(Date.now());
  try { ez = einsatzFor(k, store.get().todos || []); } catch { ez = null; }
  if (!ez || !ez.title) return null;
  const key = `${k}|${ez.id || ez.title}`;
  if (lsGet(EZ_KEY) === key) return null;
  const act = A.activeFolder();
  if (act.source === "place") return null;
  const f = G.einsatzFolderSuggestion(ez.title, A.folders());
  if (!f || f.id === act.id) return null;
  return { einsatz: ez, folder: f, key };
}

/* ---------- Chip ---------- */

function chipHTML() {
  const a = A.activeFolder();
  const f = a.folder;
  const src = a.source === "place" && a.place ? `<small class="ga-src">(von Ort ${esc(a.place.name || "Ort")})</small>` : "";
  return `<button type="button" class="ga-chip${f ? "" : " is-none"}" data-ga="chip" ${fst(f)} aria-haspopup="dialog" aria-label="Neue Fotos gehen nach ${esc(f ? f.name : "keine Kategorie")} – ändern">` +
    `<span class="ga-lbl" aria-hidden="true">📂 Kategorie:</span>` +
    `<b class="ga-val"><span aria-hidden="true">${esc(f ? f.emoji : "🗂️")}</span> ${esc(f ? f.name : "keine")}</b>${src}` +
    `<span class="ga-caret" aria-hidden="true">▾</span></button>`;
}

function bannerHTML(s) {
  return `<div class="ga-ez" role="note" ${fst(s.folder)}>` +
    `<span class="ga-ez-t">Heute Einsatz „${esc(s.einsatz.title)}“ – Fotos nach <b>${esc(s.folder.emoji)} ${esc(s.folder.name)}</b>?</span>` +
    `<span class="ga-ez-b"><button type="button" class="btn sm primary" data-ga="ezyes">Ja</button>` +
    `<button type="button" class="ga-ez-x" data-ga="ezno" aria-label="Vorschlag ausblenden">✕</button></span></div>`;
}

/**
 * Chip „Neue Fotos gehen nach …“ (+ Einsatz-Vorschlag) in host. opts = { label: Text vor dem Chip }
 * Räumt sich selbst auf, sobald host aus dem Dokument ist. → { destroy, refresh }
 */
export function mountActiveChip(host, opts = {}) {
  injectCSS();
  host.classList.add("ga-host");
  let unsub = null;
  let last = "";
  const draw = () => {
    if (!host.isConnected && last) { destroy(); return; }
    const s = einsatzSuggestion();
    const html = (opts.label ? `<span class="ga-pre">${esc(opts.label)}</span>` : "") + chipHTML() + (s ? bannerHTML(s) : "");
    if (html === last) return;
    last = html;
    host.innerHTML = html;
  };
  host.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-ga]");
    if (!b) return;
    if (b.dataset.ga === "chip") openActivePicker();
    else if (b.dataset.ga === "ezyes" || b.dataset.ga === "ezno") {
      const s = einsatzSuggestion();
      if (!s) { draw(); return; }
      lsSet(EZ_KEY, s.key);
      if (b.dataset.ga === "ezyes") {
        await A.setActiveFolder(s.folder.id);
        ui.toast(`Neue Fotos gehen nach ${s.folder.emoji} ${s.folder.name}`);
      }
      last = ""; draw();
    }
  });
  function destroy() { if (unsub) { unsub(); unsub = null; } }
  draw();
  unsub = A.onActiveChange(() => draw());
  try { A.ensureFolders().catch(() => {}); } catch { /* egal */ }
  return { destroy, refresh: () => { last = ""; draw(); } };
}

/* ---------- Auswahl-Blatt ---------- */

function topSheet(opts) {
  const r = ui.openSheet(opts);
  // über dem Vollbild
  if (r && r.el && document.querySelector(".ph-view")) r.el.style.zIndex = "57";
  return r;
}

/** Blatt „Neue Fotos gehen nach …“ → Promise<folderId|""|null (abgebrochen)> */
export function openActivePicker() {
  injectCSS();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let emoji = "🏠";
    topSheet({
      title: "Neue Fotos gehen nach …",
      bodyHTML: `<div class="ga-pick" data-gp="box"></div>`,
      onMount(el, close) {
        const box = el.querySelector('[data-gp="box"]');
        const draw = () => {
          const act = A.activeFolder();
          const fs = A.folders();
          const ids = new Set(fs.map((f) => f.id));
          const albs = A.albums();
          const nA = (fid) => albs.filter((a) => G.albumFolderId(a, ids) === fid).length;
          const ign = A.ignoredPlace();
          const row = (f, n) => {
            const on = f.id === G.OHNE_KAT ? !act.id : act.id === f.id;
            return `<button type="button" class="ga-row" data-gpick="${esc(f.id)}" aria-pressed="${on}" ${fst(f)}>` +
              `<span class="ga-emo" aria-hidden="true">${esc(f.emoji)}</span>` +
              `<span class="ga-row-t"><b>${esc(f.name)}</b><small>${f.id === G.OHNE_KAT ? "Neue Adress-Alben ohne Kategorie" : `${n} ${n === 1 ? "Album" : "Alben"}`}</small></span>` +
              `<span class="ga-tick" aria-hidden="true">${on ? "✓" : ""}</span></button>`;
          };
          box.innerHTML =
            `<p class="note ga-why">Jede neue Adresse bekommt ihr eigenes Album – es landet in der Kategorie, die hier aktiv ist. Fotos an einer schon bekannten Adresse bleiben in deren Album.</p>` +
            (act.source === "place" && act.place ? `<div class="ga-info" ${fst(act.folder)}>📍 Eingestempelt bei <b>${esc(act.place.name || "Ort")}</b> – dort gilt ${esc(act.folder.emoji)} ${esc(act.folder.name)}. Wählst du hier etwas anderes, gilt das für diese Schicht.</div>` : "") +
            (ign ? `<div class="ga-info">Die Foto-Kategorie von <b>${esc(ign.name || "Ort")}</b> ist für diese Schicht aus. <button type="button" class="linkbtn" data-gp="useplace">Wieder einschalten</button></div>` : "") +
            `<div class="ga-list" role="group" aria-label="Hauptkategorien">${fs.map((f) => row(f, nA(f.id))).join("")}${row(OHNE, 0)}</div>` +
            `<button type="button" class="ga-new" data-gp="new" aria-expanded="false">＋ Neue Hauptkategorie</button>` +
            `<div class="ga-form" data-gp="form" hidden>` +
              `<div class="ga-newrow"><span class="ga-emo ga-emo-prev" data-gp="pemo" aria-hidden="true">${esc(emoji)}</span>` +
                `<input type="text" data-gp="name" maxlength="40" placeholder="z. B. Wohnungen" autocomplete="off" aria-label="Name der neuen Hauptkategorie"></div>` +
              `<div class="ga-emojis" role="group" aria-label="Symbol">${G.FOLDER_EMOJIS.map((e) => `<button type="button" class="ga-emoji" data-gemo="${e}" aria-pressed="${e === emoji}">${e}</button>`).join("")}</div>` +
              `<button type="button" class="btn primary" data-gp="create">Anlegen &amp; auswählen</button>` +
            `</div>`;
        };
        draw();
        const pickAndClose = async (fid) => {
          await A.setActiveFolder(fid === G.OHNE_KAT ? "" : fid);
          const f = fid === G.OHNE_KAT ? null : A.folderById(fid);
          ui.toast(f ? `Neue Fotos gehen nach ${f.emoji} ${f.name}` : "Neue Adress-Alben ohne Kategorie");
          finish(fid === G.OHNE_KAT ? "" : fid); close();
        };
        const create = async () => {
          const inp = box.querySelector('[data-gp="name"]');
          const name = inp.value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); inp.focus(); return; }
          const btn = box.querySelector('[data-gp="create"]');
          ui.setBusy(btn, true, "Legt an …");
          const have = A.folders().find((f) => G.fold(f.name) === G.fold(name));
          const used = new Set(A.folders().map((f) => f.color));
          const f = have || await A.createFolder({ name, emoji, color: G.FOLDER_COLORS.find((c) => !used.has(c)) || G.FOLDER_COLORS[0] });
          await pickAndClose(f.id);
        };
        box.addEventListener("click", async (ev) => {
          const p = ev.target.closest("[data-gpick]");
          if (p) { await pickAndClose(p.dataset.gpick); return; }
          const e = ev.target.closest("[data-gemo]");
          if (e) {
            emoji = e.dataset.gemo;
            box.querySelectorAll("[data-gemo]").forEach((x) => x.setAttribute("aria-pressed", String(x === e)));
            box.querySelector('[data-gp="pemo"]').textContent = emoji;
            return;
          }
          const g = ev.target.closest("[data-gp]");
          if (!g) return;
          if (g.dataset.gp === "new") {
            const form = box.querySelector('[data-gp="form"]');
            form.hidden = !form.hidden;
            g.setAttribute("aria-expanded", String(!form.hidden));
            if (!form.hidden) setTimeout(() => { try { box.querySelector('[data-gp="name"]').focus(); } catch { /* egal */ } }, 30);
          } else if (g.dataset.gp === "create") create();
          else if (g.dataset.gp === "useplace") { A.usePlaceFolder(); draw(); }
        });
        box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches('[data-gp="name"]')) { ev.preventDefault(); create(); } });
        new MutationObserver((_, mo) => { if (!el.isConnected) { mo.disconnect(); finish(null); } }).observe(el.parentNode || document.body, { childList: true });
      },
    });
  });
}

/* ---------- Toast nach dem Einsortieren ---------- */

let toastT = null;
/** Toast mit Knopf. */
export function actionToast(msg, label, onAct, ms = 7000) {
  injectCSS();
  let el = document.getElementById("ga-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "ga-toast";
    el.className = "toast ga-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  const base = document.getElementById("toast");
  if (base) base.hidden = true;
  clearTimeout(toastT);
  el.innerHTML = `<span class="ga-toast-t">${esc(msg)}</span><button type="button" class="ga-toast-b">${esc(label)}</button>`;
  el.hidden = false;
  // läuft gerade der „Rückgängig“-Toast der Fahrterkennung → darüber anzeigen statt ihn zu verdecken
  const drive = document.getElementById("drive-toast");
  el.classList.toggle("ga-up", !!(drive && !drive.hidden));
  const hide = () => { clearTimeout(toastT); toastT = null; el.hidden = true; };
  el.querySelector("button").addEventListener("click", () => { hide(); onAct(); }, { once: true });
  toastT = setTimeout(hide, ms);
  return hide;
}

/** Nach autoFile: „In „Wohnungen › Musterstraße 5, Graz“ gespeichert“ + „Ändern“. r = { album, created } */
export function savedToast(r, photo) {
  if (!r || !r.album) return;
  const a = A.albumById(r.album.id) || r.album;
  const ids = new Set(A.folders().map((f) => f.id));
  const fid = G.albumFolderId(a, ids);
  const f = fid === G.OHNE_KAT ? null : A.folderById(fid);
  actionToast(`In „${G.destLabel(a, f)}“ gespeichert`, "Ändern", () => openChangeSheet(photo, a, { created: !!r.created }));
}

/** Blatt „Foto einsortieren“: neues Album in andere Kategorie, Foto in anderes Album. */
export function openChangeSheet(photo, album, { created = false } = {}) {
  injectCSS();
  if (!photo || !album) return;
  topSheet({
    title: "Foto einsortieren",
    bodyHTML: `<div class="ga-pick ga-change" data-gc="box"></div>`,
    onMount(el, close) {
      const box = el.querySelector('[data-gc="box"]');
      let albumId = album.id;
      const draw = () => {
        const a = A.albumById(albumId) || album;
        const fs = A.folders();
        const ids = new Set(fs.map((f) => f.id));
        const fid = G.albumFolderId(a, ids);
        const f = fid === G.OHNE_KAT ? null : A.folderById(fid);
        const others = A.albums().filter((x) => x.id !== a.id).sort((x, y) => (y.created || 0) - (x.created || 0)).slice(0, 8);
        box.innerHTML =
          `<div class="ga-cur">${photo.thumb ? `<img src="${photo.thumb}" alt="">` : ""}<span><small>Gespeichert in</small><b data-gc="dest">${esc(G.destLabel(a, f))}</b></span></div>` +
          (created ? `<div class="ga-h">Neues Album <b>„${esc(a.name)}“</b> gehört zu …</div>` +
            `<div class="ga-fchips" role="group" aria-label="Kategorie des Albums">${[...fs, OHNE].map((x) => `<button type="button" class="ga-fchip" data-gcf="${esc(x.id)}" aria-pressed="${x.id === fid}" ${fst(x)}><span aria-hidden="true">${esc(x.emoji)}</span>${esc(x.name)}</button>`).join("")}</div>` : "") +
          `<div class="ga-h">Oder Foto in ein anderes Album:</div>` +
          `<div class="ga-list">${others.map((o) => { const of = G.albumFolderId(o, ids); const oo = of === G.OHNE_KAT ? null : A.folderById(of); return `<button type="button" class="ga-row" data-gca="${esc(o.id)}" ${fst(oo)}><span class="ga-emo" aria-hidden="true">${esc(o.emoji || (o.kind === "address" ? "📍" : o.kind === "place" ? "🏢" : "📁"))}</span><span class="ga-row-t"><b>${esc(o.name)}</b><small>${esc(oo ? `${oo.emoji} ${oo.name}` : "Ohne Kategorie")}</small></span></button>`; }).join("") || `<p class="note">Noch keine anderen Alben.</p>`}</div>` +
          `<div class="ga-newrow"><input type="text" data-gc="name" maxlength="60" placeholder="Neues Album, z. B. Verteiler" autocomplete="off" aria-label="Neues Album"><button type="button" class="btn sm primary" data-gc="create">Anlegen</button></div>` +
          `<div class="row"><button type="button" class="btn ghost" data-gc="ok">Fertig</button></div>`;
      };
      draw();
      const moveTo = async (toId) => {
        const from = A.albumById(albumId);
        await A.moveToAlbum([photo.id], albumId, toId);
        // frisch angelegtes Album ist jetzt leer → wieder weg
        let removed = false;
        if (created && from) {
          const list = await photos.listIndex({ refresh: true });
          if (!G.itemsOfAlbum(list, albumId, A.albumsMap()).length) { await A.deleteAlbum(albumId); removed = true; }
        }
        const to = A.albumById(toId);
        close();
        ui.toast(`Foto → „${to ? to.name : "Album"}“${removed ? ` (leeres Album „${from.name}“ entfernt)` : ""}`, 3200);
      };
      box.addEventListener("click", async (ev) => {
        const cf = ev.target.closest("[data-gcf]");
        if (cf) {
          await A.setAlbumsFolder([albumId], cf.dataset.gcf);
          const f = cf.dataset.gcf === G.OHNE_KAT ? null : A.folderById(cf.dataset.gcf);
          ui.toast(`„${(A.albumById(albumId) || album).name}“ → ${f ? `${f.emoji} ${f.name}` : "Ohne Kategorie"}`);
          draw(); return;
        }
        const ca = ev.target.closest("[data-gca]");
        if (ca) { await moveTo(ca.dataset.gca); return; }
        const g = ev.target.closest("[data-gc]");
        if (!g) return;
        if (g.dataset.gc === "ok") close();
        else if (g.dataset.gc === "create") {
          const inp = box.querySelector('[data-gc="name"]');
          const name = inp.value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); inp.focus(); return; }
          const a = await A.createAlbum({ kind: "custom", name, emoji: "📁" });
          await moveTo(a.id);
        }
      });
      box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.matches('[data-gc="name"]')) { ev.preventDefault(); box.querySelector('[data-gc="create"]').click(); } });
    },
  });
}
