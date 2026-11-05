// Alltag › Material (Update 9): Offen (zu besorgen · besorgt · auf der Baustelle) · Verbaut · Nach Baustelle · Katalog.
// Sammlungen (js/alltag/db.js): material_items (eine Zeile pro Material), material_catalog (eigene Einträge,
// Favoriten, Zähler). Reine Logik in material-core.js (auch vom Claude-Server genutzt).
// Außerdem exportiert: openQuickAdd (Schnell-Erfassen), mountTodayButton („Heute“), mountPlaceMaterial (Ort-Blatt).
import { collection } from "./db.js";
import * as M from "./material-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import * as timer from "../timer.js";
import * as photos from "../photos.js";
import { icon } from "../icons.js";
import { esc, WD } from "../util.js";
import { download } from "../export.js";
import { runningMeta, openViewer, camIcon } from "../views/gallery.js";

const TABS = [
  ["offen", "Offen", "list"],
  ["verbaut", "Verbaut", "check"],
  ["orte", "Nach Baustelle", "building"],
  ["katalog", "Katalog", "search"],
];
const TAB_KEY = "sk-mt-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

let itemsCol = null, catCol = null;
function cols() {
  if (!itemsCol) { itemsCol = collection("material_items"); catCol = collection("material_catalog"); }
  return { items: itemsCol, cat: catCol };
}
const todayKey = () => M.keyOf(new Date());
const places = () => (store.get().places || []);
const appCtx = () => ({ ui, store, timer });

export function injectCSS() {
  if (document.getElementById("mt-css")) return;
  const l = document.createElement("link");
  l.id = "mt-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-material.css", import.meta.url).href;
  document.head.appendChild(l);
}

function fmtDay(k) {
  const [y, m, d] = String(k).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const t = todayKey();
  const pre = k === t ? "Heute · " : "";
  return `${pre}${WD[dt.getDay()]}, ${M.fmtKeyDate(k)}`;
}

function safe(p) {
  return Promise.resolve(p).catch((err) => { console.error(err); ui.toast("Speichern fehlgeschlagen – bitte nochmal versuchen."); });
}

/* ---------- Daten ändern ---------- */

export function catalogList() { return M.mergeCatalog(cols().cat.all()); }

async function bumpCatalog(name, unit, catalogId) {
  const { cat } = cols();
  const list = catalogList();
  let c = catalogId ? list.find((x) => x.id === catalogId) : null;
  if (!c) c = list.find((x) => M.norm(x.name) === M.norm(name));
  if (c) {
    const cur = cat.get(c.docId) || {};
    await cat.put({ ...cur, id: c.docId, own: c.own, ...(c.own ? { name: c.name, unit: c.unit, group: M.OWN_GROUP } : {}), fav: !!cur.fav, count: (Number(cur.count) || 0) + 1, lastUsed: Date.now() });
    return c.id;
  }
  // unbekanntes Material → als eigener Katalog-Eintrag merken
  const id = "own_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await cat.put({ id, own: true, name: String(name).trim(), unit, group: M.OWN_GROUP, fav: false, count: 1, lastUsed: Date.now() });
  return id;
}

export async function setStatus(id, status) {
  const { items } = cols();
  const it = items.get(id);
  if (!it || it.status === status) return;
  const patch = { status, doneAt: status === "verbaut" ? Date.now() : null };
  if (status === "verbaut" && it.status !== "verbaut") patch.dayKey = todayKey(); // verbaut = heute
  await items.patch(id, patch);
}

const NEXT = M.NEXT_STATUS; // brauche → besorgt → baustelle → verbaut
const PREV = M.PREV_STATUS;
const OPEN_SECTIONS = [["brauche", "Zu besorgen"], ["besorgt", "Besorgt"], ["baustelle", "Auf der Baustelle"]];
// Sammel-Aktionen im Reiter „Offen“ (pro Baustelle): [Knopftext, Rückfrage, Meldung]
const BULK = {
  baustelle: ["Alles Besorgte auf Baustelle", (n) => `${n} wirklich auf die Baustelle?`, (n) => `${n} auf der Baustelle.`],
  verbaut: ["Alles vor Ort als verbaut markieren", (n) => `${n} wirklich als verbaut markieren?`, (n) => `${n} als verbaut markiert.`],
};

/* ---------- Schnell-Erfassen ---------- */

/**
 * Sheet „Material erfassen“. opts: { item?, name?, unit?, catalogId?, qty?, status?, placeId?, place?, dayKey?, keepOpen? }
 * Ohne Ort → eingestempelt: aktueller Ort; sonst leer (aus Orten wählen oder frei eingeben).
 */
export function openQuickAdd(opts = {}) {
  injectCSS();
  const { items } = cols();
  const edit = opts.item || null;
  const snap = store.get();
  const run = runningMeta(snap, appCtx());
  const st = {
    name: edit ? edit.name : (opts.name || ""),
    unit: edit ? edit.unit : (opts.unit || "Stk"),
    catalogId: edit ? edit.catalogId : (opts.catalogId || null),
    qty: edit ? edit.qty : (M.cleanQty(opts.qty) || 1),
    status: edit ? edit.status : (opts.status || "brauche"),
    placeId: edit ? edit.placeId : (opts.placeId !== undefined ? opts.placeId : (run ? run.placeId : null)),
    place: edit ? edit.place : (opts.place !== undefined ? opts.place : (run ? run.place : "")),
    dayKey: edit ? edit.dayKey : (opts.dayKey || todayKey()),
    photoId: edit ? edit.photoId : null,
    img: null,
  };
  const pl = places();
  const known = st.placeId && pl.some((p) => p.id === st.placeId);
  const placeOpts =
    `<option value="">Ohne Baustelle</option>` +
    pl.map((p) => `<option value="${esc(p.id)}"${known && p.id === st.placeId ? " selected" : ""}>${esc(p.name || "Ort")}</option>`).join("") +
    `<option value="__free"${!known && st.place ? " selected" : ""}>Andere (frei eingeben) …</option>`;

  ui.openSheet({
    title: edit ? "Material bearbeiten" : "Material erfassen",
    bodyHTML:
      `<div class="mt-qa">` +
        `<label class="mt-q-l"><span>Was?</span><span class="mt-q-wrap">${icon("search", 18)}<input type="search" id="mt-q" autocomplete="off" enterkeyhint="next" placeholder="z. B. 3x1,5 · Schuko · Wago 413" value="${esc(st.name)}" aria-describedby="mt-q-h"></span></label>` +
        `<div class="mt-sugg" data-m="sugg" role="listbox" aria-label="Vorschläge"></div>` +
        `<div class="mt-qa-row">` +
          `<div class="mt-step" role="group" aria-label="Menge">` +
            `<button type="button" data-m="minus" aria-label="Weniger">−</button>` +
            `<input id="mt-qty" inputmode="decimal" autocomplete="off" aria-label="Menge" value="${esc(M.fmtNum(st.qty))}">` +
            `<button type="button" data-m="plus" aria-label="Mehr">+</button>` +
          `</div>` +
          `<div class="mt-units" role="group" aria-label="Einheit">${M.UNITS.map((u) => `<button type="button" class="mt-unit" data-unit="${u}" aria-pressed="${u === st.unit}">${u}</button>`).join("")}</div>` +
        `</div>` +
        `<div class="mt-seg" role="group" aria-label="Status">${M.STATUSES.map((s) => `<button type="button" class="seg-${s}" data-status="${s}" aria-pressed="${s === st.status}" title="${esc(M.STATUS_LABEL[s])}">${esc(M.STATUS_SHORT[s])}</button>`).join("")}</div>` +
        `<div class="fields">` +
          `<div class="row">` +
            `<label>Baustelle<select id="mt-place">${placeOpts}</select></label>` +
            `<label>Tag<input type="date" id="mt-day" value="${esc(st.dayKey)}"></label>` +
          `</div>` +
          `<label data-m="freewrap" hidden>Baustelle (frei)<input type="text" id="mt-free" maxlength="160" autocomplete="off" placeholder="z. B. Teststraße 15" value="${esc(known ? "" : st.place || "")}"></label>` +
          `<label>Notiz (optional)<input type="text" id="mt-note" maxlength="300" autocomplete="off" placeholder="z. B. für Küche, Farbe blau" value="${esc(edit ? edit.note || "" : "")}"></label>` +
        `</div>` +
        `<div class="mt-photo" data-m="photo">` +
          `<label class="btn sm ghost mt-cam" data-m="camlabel">${camIcon(18)}<span>${st.photoId ? "Foto ersetzen" : "Foto (optional)"}</span><input type="file" accept="image/*" capture="environment" data-m="file" tabindex="-1"></label>` +
          `<div class="mt-photo-prev" data-m="prev"${st.photoId ? "" : " hidden"}>${st.photoId ? `<span class="note">📷 Foto gespeichert</span>` : ""}</div>` +
        `</div>` +
        `<div class="row mt-qa-acts">` +
          (edit ? `<button type="button" class="btn danger sm" data-m="del">Löschen</button>` : `<button type="button" class="btn ghost" data-m="more">Speichern &amp; weiter</button>`) +
          `<button type="button" class="btn primary" data-m="save">${edit ? "Speichern" : "Hinzufügen"}</button>` +
        `</div>` +
      `</div>`,
    onMount(sheet, close) {
      const $ = (s) => sheet.querySelector(s);
      const q = $("#mt-q"), qty = $("#mt-qty"), sugg = $('[data-m="sugg"]');
      const selPlace = $("#mt-place"), free = $("#mt-free"), freeWrap = $('[data-m="freewrap"]');
      const showFree = () => { freeWrap.hidden = selPlace.value !== "__free"; };
      showFree();
      selPlace.addEventListener("change", () => { showFree(); if (!freeWrap.hidden) free.focus(); });

      const setUnit = (u) => {
        st.unit = u;
        sheet.querySelectorAll(".mt-unit").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.unit === u)));
      };
      const setStatusBtn = (s) => {
        st.status = s;
        sheet.querySelectorAll("[data-status]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.status === s)));
      };
      sheet.querySelector(".mt-units").addEventListener("click", (ev) => { const b = ev.target.closest("[data-unit]"); if (b) setUnit(b.dataset.unit); });
      sheet.querySelector(".mt-seg").addEventListener("click", (ev) => { const b = ev.target.closest("[data-status]"); if (b) setStatusBtn(b.dataset.status); });

      const stepVal = (d) => {
        const cur = M.cleanQty(qty.value) || 0;
        const step = st.unit === "m" && cur >= 10 ? 5 : 1;
        const n = Math.max(st.unit === "Stk" ? 1 : 0.5, Math.round((cur + d * step) * 100) / 100);
        qty.value = M.fmtNum(n);
      };
      $('[data-m="minus"]').addEventListener("click", () => stepVal(-1));
      $('[data-m="plus"]').addEventListener("click", () => stepVal(1));

      // Vorschläge
      let picked = st.catalogId ? st.name : null;
      const drawSugg = () => {
        const txt = q.value.trim();
        if (picked && txt === picked) { sugg.innerHTML = ""; return; }
        const list = M.searchCatalog(txt, catalogList(), txt ? 6 : 8);
        const exact = list.some((x) => M.norm(x.name) === M.norm(txt));
        let h = list.map((x) =>
          `<button type="button" class="mt-sg" role="option" data-cid="${esc(x.id)}">` +
            `<span class="mt-sg-n">${x.fav ? "★ " : ""}${esc(x.name)}</span><small>${esc(x.group)} · ${esc(x.unit)}${x.count ? ` · ${x.count}×` : ""}</small></button>`).join("");
        if (txt && !exact) h += `<button type="button" class="mt-sg mt-sg-own" data-own="1"><span class="mt-sg-n">„${esc(txt)}“ übernehmen</span><small>eigenes Material</small></button>`;
        sugg.innerHTML = txt || list.length ? (txt ? "" : `<div class="mt-sg-h">Häufig &amp; Favoriten</div>`) + h : "";
      };
      const pick = (c) => {
        q.value = c.name; picked = c.name; st.catalogId = c.id; setUnit(c.unit);
        drawSugg();
        try { qty.focus(); qty.select(); } catch { /* egal */ }
      };
      q.addEventListener("input", () => { if (q.value.trim() !== picked) { picked = null; st.catalogId = null; } drawSugg(); });
      q.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          const first = sugg.querySelector("[data-cid]");
          if (first && !picked) { const c = catalogList().find((x) => x.id === first.dataset.cid); if (c) { pick(c); return; } }
          qty.focus();
        }
      });
      sugg.addEventListener("click", (ev) => {
        const b = ev.target.closest(".mt-sg");
        if (!b) return;
        if (b.dataset.own) { picked = q.value.trim(); st.catalogId = null; drawSugg(); qty.focus(); return; }
        const c = catalogList().find((x) => x.id === b.dataset.cid);
        if (c) pick(c);
      });
      drawSugg();

      // Foto
      const prev = $('[data-m="prev"]');
      $('[data-m="file"]').addEventListener("change", async (ev) => {
        const f = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!f) return;
        prev.hidden = false;
        prev.innerHTML = `<span class="note">Bild wird vorbereitet …</span>`;
        try {
          st.img = await photos.processImage(f);
          prev.innerHTML = `<img alt="Vorschau" src="${st.img.thumb}"><button type="button" class="mt-x" data-m="rmimg" aria-label="Foto entfernen">✕</button>`;
        } catch (e) {
          st.img = null;
          prev.innerHTML = `<span class="note">${esc((e && e.message) || "Bild konnte nicht gelesen werden.")}</span>`;
        }
      });
      prev.addEventListener("click", (ev) => { if (ev.target.closest('[data-m="rmimg"]')) { st.img = null; prev.hidden = true; prev.innerHTML = ""; } });

      const collect = () => {
        const name = q.value.trim();
        if (!name) { ui.toast("Bitte eintragen, welches Material."); q.focus(); return null; }
        const n = M.cleanQty(qty.value);
        if (!n) { ui.toast("Bitte eine Menge größer 0 eingeben."); qty.focus(); return null; }
        let placeId = null, place = "";
        if (selPlace.value === "__free") place = free.value.trim();
        else if (selPlace.value) { placeId = selPlace.value; place = (pl.find((p) => p.id === placeId) || {}).name || ""; }
        const dk = /^\d{4}-\d{2}-\d{2}$/.test($("#mt-day").value) ? $("#mt-day").value : st.dayKey;
        if (!st.catalogId) {
          const ex = catalogList().find((x) => M.norm(x.name) === M.norm(name));
          if (ex) st.catalogId = ex.id;
        }
        return { name, qty: n, unit: st.unit, status: st.status, placeId, place, dayKey: dk, note: $("#mt-note").value.trim() };
      };

      const save = async (keep) => {
        const v = collect();
        if (!v) return;
        const btn = keep ? $('[data-m="more"]') : $('[data-m="save"]');
        ui.setBusy(btn, true, "Speichert …");
        try {
          let photoId = st.photoId;
          if (st.img) {
            try {
              const r = await photos.addPhoto(null, { processed: st.img, dayKey: v.dayKey, placeId: v.placeId, place: v.place, entryId: null, note: `Material: ${v.name}` });
              photoId = r.photo.id;
            } catch (e) { console.error(e); ui.toast("Foto konnte nicht gespeichert werden – Material wird ohne Foto gespeichert.", 3600); }
          }
          const isNew = !edit;
          const catalogId = isNew || (edit && edit.name !== v.name) ? await bumpCatalog(v.name, v.unit, st.catalogId).catch(() => st.catalogId) : st.catalogId;
          const base = edit ? { ...edit } : { entryId: opts.entryId || null };
          const doc = M.normItem({ ...base, ...v, photoId: photoId || null, catalogId: catalogId || null, doneAt: edit && edit.status === "verbaut" && v.status === "verbaut" ? edit.doneAt : null });
          await items.put(doc);
          if (keep) {
            ui.setBusy(btn, false);
            ui.toast(`${M.lineText(doc)} gespeichert.`);
            q.value = ""; picked = null; st.catalogId = null; qty.value = "1"; st.img = null; prev.hidden = true; prev.innerHTML = "";
            $("#mt-note").value = "";
            drawSugg(); q.focus();
          } else {
            close();
            ui.toast(edit ? "Gespeichert." : `${M.lineText(doc)} · ${M.STATUS_LABEL[doc.status]}`);
          }
        } catch (e) {
          console.error(e);
          ui.setBusy(btn, false);
          ui.toast("Speichern fehlgeschlagen – bitte nochmal versuchen.");
        }
      };
      $('[data-m="save"]').addEventListener("click", () => save(false));
      const more = $('[data-m="more"]');
      if (more) more.addEventListener("click", () => save(true));
      qty.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(false); } });
      const del = $('[data-m="del"]');
      if (del) ui.confirmButton(del, "Wirklich löschen?", async () => { await safe(items.remove(edit.id)); close(); ui.toast("Gelöscht."); });
      if (!edit && !st.name) setTimeout(() => { try { q.focus(); } catch { /* egal */ } }, 60);
    },
  });
}

/* ---------- Teilen & Export ---------- */

async function copyText(txt) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(txt); return true; }
  } catch { /* Fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

export async function shareOrCopy(text, title = "Materialliste") {
  if (!text) { ui.toast("Nichts zum Teilen."); return; }
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  const ok = await copyText(text);
  ui.toast(ok ? "Liste kopiert – jetzt einfügen, wo du willst." : "Kopieren hat nicht geklappt.");
}

/** Teilen-Blatt mit Filter. f = { mode, day, placeKey } */
export function openShare(f = {}) {
  injectCSS();
  const { items } = cols();
  const mode0 = ["brauche", "baustelle", "tag", "woche"].includes(f.mode) ? f.mode : "brauche";
  const st = { mode: mode0, vmode: mode0 === "tag" ? "tag" : "woche", day: f.day || todayKey(), placeKey: f.placeKey || "" };
  const kind = () => (st.mode === "tag" || st.mode === "woche" ? "verbaut" : st.mode);
  const groups = M.byPlace(items.all(), places());
  ui.openSheet({
    title: "Liste teilen",
    bodyHTML:
      `<div class="mt-share">` +
        `<div class="mt-seg mt-seg-share" role="group" aria-label="Was teilen?">` +
          [["brauche", "Was fehlt noch"], ["baustelle", "Was liegt auf der Baustelle"], ["verbaut", "Verbaut"]].map(([m, l]) => `<button type="button" data-kind="${m}" aria-pressed="${m === kind()}">${l}</button>`).join("") +
        `</div>` +
        `<div class="mt-seg mt-seg-sm" role="group" aria-label="Zeitraum" data-s="vwrap">` +
          [["tag", "Tag"], ["woche", "Woche"]].map(([m, l]) => `<button type="button" data-mode="${m}" aria-pressed="${m === st.mode}">${l}</button>`).join("") +
        `</div>` +
        `<div class="fields"><div class="row">` +
          `<label data-s="daywrap">Tag<input type="date" id="mt-sh-day" value="${esc(st.day)}"></label>` +
          `<label>Baustelle<select id="mt-sh-place"><option value="">Alle Baustellen</option>${groups.map((g) => `<option value="${esc(g.key)}"${g.key === st.placeKey ? " selected" : ""}>${esc(g.place)}</option>`).join("")}</select></label>` +
        `</div></div>` +
        `<pre class="mt-preview" data-s="prev" aria-live="polite"></pre>` +
        `<div class="row"><button type="button" class="btn ghost" data-s="copy">${icon("copy", 18)}<span>Kopieren</span></button>` +
        `<button type="button" class="btn primary" data-s="share">${icon("share", 18)}<span>Teilen</span></button></div>` +
      `</div>`,
    onMount(sheet) {
      const $ = (s) => sheet.querySelector(s);
      let text = "";
      const draw = () => {
        sheet.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind())));
        sheet.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === st.mode)));
        $('[data-s="vwrap"]').hidden = $('[data-s="daywrap"]').hidden = kind() !== "verbaut";
        const sel = M.shareSelection(items.all(), st, todayKey());
        text = M.shareText(sel, places());
        $('[data-s="prev"]').textContent = text || "Für diese Auswahl gibt es kein Material.";
        $('[data-s="share"]').disabled = $('[data-s="copy"]').disabled = !text;
      };
      sheet.querySelector(".mt-seg-share").addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-kind]");
        if (b) { st.mode = b.dataset.kind === "verbaut" ? st.vmode : b.dataset.kind; draw(); }
      });
      $('[data-s="vwrap"]').addEventListener("click", (ev) => { const b = ev.target.closest("[data-mode]"); if (b) { st.mode = st.vmode = b.dataset.mode; draw(); } });
      $("#mt-sh-day").addEventListener("change", (ev) => { if (ev.target.value) { st.day = ev.target.value; draw(); } });
      $("#mt-sh-place").addEventListener("change", (ev) => { st.placeKey = ev.target.value; draw(); });
      $('[data-s="share"]').addEventListener("click", () => shareOrCopy(text, st.mode === "brauche" ? "Materialliste" : st.mode === "baustelle" ? "Material vor Ort" : "Verbautes Material"));
      $('[data-s="copy"]').addEventListener("click", async () => { const ok = await copyText(text); ui.toast(ok ? "Liste kopiert." : "Kopieren hat nicht geklappt."); });
      draw();
    },
  });
}

export function exportMonthCSV(ym) {
  const csv = M.monthCSV(cols().items.all(), ym, places());
  const n = csv.split("\r\n").length - 2;
  if (n <= 0) { ui.toast("In diesem Monat ist nichts als verbaut eingetragen."); return null; }
  download(`Material-verbaut-${ym}.csv`, csv);
  ui.toast(`CSV mit ${n} ${n === 1 ? "Zeile" : "Zeilen"} erstellt.`);
  return csv;
}

async function showPhoto(it) {
  try {
    const list = await photos.listByDay(it.dayKey);
    const i = list.findIndex((p) => p.id === it.photoId);
    if (i < 0) { ui.toast("Foto nicht gefunden."); return; }
    openViewer([list[i]], 0, appCtx());
  } catch (e) { console.error(e); ui.toast("Foto konnte nicht geladen werden."); }
}

/* ---------- Zeilen ---------- */

function lineHTML(it, { stepper = false, showPlace = false } = {}) {
  const s = it.status;
  const sub = [showPlace ? M.placeLabel(it, places()) : "", it.note || ""].filter(Boolean).join(" · ");
  const nx = NEXT[s] && s !== "brauche" ? NEXT[s] : null; // brauche → besorgt läuft über den Haken
  return `<li class="mt-line st-${esc(s)}" data-id="${esc(it.id)}">` +
    `<div class="mt-swipe-bg" aria-hidden="true"><span class="l">${PREV[s] ? "↩ " + esc(M.STATUS_LABEL[PREV[s]]) : ""}</span><span class="r">${NEXT[s] ? esc(M.STATUS_LABEL[NEXT[s]]) + " →" : ""}</span></div>` +
    `<div class="mt-line-in">` +
      (s === "brauche" || s === "besorgt"
        ? `<button type="button" class="mt-check" data-a="toggle" role="checkbox" aria-checked="${s === "besorgt"}" aria-label="${esc(it.name)} besorgt">${icon("check", 18)}</button>`
        : s === "baustelle"
          ? `<span class="mt-site-ic" title="Auf der Baustelle" aria-hidden="true">${icon("pin", 16)}</span>`
          : `<span class="mt-done-ic" aria-hidden="true">${icon("check", 16)}</span>`) +
      `<button type="button" class="mt-l-main" data-a="edit"><b>${!(stepper && s === "brauche") ? `<span class="mt-q">${esc(M.qtyText(it.qty, it.unit))}</span> ` : ""}${esc(it.name)}</b>${sub || it.photoId ? `<small>${esc(sub)}${it.photoId ? " 📷" : ""}</small>` : ""}</button>` +
      (it.photoId ? `<button type="button" class="mt-ib" data-a="photo" aria-label="Foto ansehen">${camIcon(16)}</button>` : "") +
      (stepper && s === "brauche"
        ? `<span class="mt-step sm" role="group" aria-label="Menge ${esc(it.name)}"><button type="button" data-a="minus" aria-label="Weniger">−</button><span class="mt-step-v">${esc(M.qtyText(it.qty, it.unit))}</span><button type="button" data-a="plus" aria-label="Mehr">+</button></span>`
        : "") +
      (nx ? `<button type="button" class="mt-go go-${nx}" data-a="next" aria-label="${esc(it.name)}: ${esc(M.STATUS_LABEL[nx])}">${esc(M.STATUS_SHORT[nx])}</button>` : "") +
      (s === "verbaut" ? `<button type="button" class="mt-ib" data-a="prev" aria-label="Zurück auf die Baustelle">↩</button>` : "") +
    `</div>` +
  `</li>`;
}

/** Klicks + Wischen auf Material-Zeilen in host. */
function wireLines(host) {
  const { items } = cols();
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-a]");
    const li = ev.target.closest(".mt-line");
    if (!b || !li || !host.contains(li)) return;
    if (li.dataset.swiped) { delete li.dataset.swiped; return; }
    const it = items.get(li.dataset.id);
    if (!it) return;
    const a = b.dataset.a;
    if (a === "toggle") safe(setStatus(it.id, it.status === "besorgt" ? "brauche" : "besorgt"));
    else if (a === "next" && NEXT[it.status]) safe(setStatus(it.id, NEXT[it.status]));
    else if (a === "prev" && PREV[it.status]) safe(setStatus(it.id, PREV[it.status]));
    else if (a === "plus" || a === "minus") {
      const step = it.unit === "m" && it.qty >= 10 ? 5 : 1;
      const n = Math.round((Number(it.qty) + (a === "plus" ? step : -step)) * 100) / 100;
      if (n <= 0) { ui.toast("Weniger geht nicht – zum Entfernen antippen und löschen."); return; }
      safe(items.patch(it.id, { qty: n }));
    } else if (a === "edit") openQuickAdd({ item: it });
    else if (a === "photo") showPhoto(it);
  });
  // Wischen: rechts → nächster Status, links → zurück
  let drag = null;
  host.addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest(".mt-line");
    if (!li || ev.button > 0 || ev.target.closest(".mt-step")) return;
    drag = { li, x: ev.clientX, y: ev.clientY, dx: 0, on: false, id: ev.pointerId };
  });
  host.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 14) return;
      drag.on = true;
      drag.li.classList.add("dragging");
      try { drag.li.setPointerCapture(ev.pointerId); } catch { /* egal */ }
    }
    const it = items.get(drag.li.dataset.id);
    const lim = (dx > 0 && it && NEXT[it.status]) || (dx < 0 && it && PREV[it.status]) ? 140 : 24;
    drag.dx = Math.max(-lim, Math.min(lim, dx));
    drag.li.style.setProperty("--dx", drag.dx + "px");
    drag.li.classList.toggle("sw-r", drag.dx > 0);
    drag.li.classList.toggle("sw-l", drag.dx < 0);
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.on) return;
    d.li.dataset.swiped = "1";
    setTimeout(() => { delete d.li.dataset.swiped; }, 350);
    d.li.classList.remove("dragging");
    d.li.style.setProperty("--dx", "0px");
    const it = items.get(d.li.dataset.id);
    if (!it) return;
    if (d.dx > 80 && NEXT[it.status]) { safe(setStatus(it.id, NEXT[it.status])); ui.toast(`${it.name} → ${M.STATUS_LABEL[NEXT[it.status]]}`); }
    else if (d.dx < -80 && PREV[it.status]) { safe(setStatus(it.id, PREV[it.status])); ui.toast(`${it.name} ↩ ${M.STATUS_LABEL[PREV[it.status]]}`); }
  };
  host.addEventListener("pointerup", end);
  host.addEventListener("pointercancel", end);
}

function totalsHTML(list, cls = "") {
  return `<ul class="mt-totals ${cls}">${list.map((t) => `<li><b>${esc(M.qtyText(t.qty, t.unit))}</b><span>${esc(t.name)}</span></li>`).join("")}</ul>`;
}

/* ---------- Modulseite ---------- */

export function mount(el) {
  injectCSS();
  const { items, cat } = cols();
  const S = {
    tab: (() => { const t = lsGet(TAB_KEY) === "brauche" ? "offen" : lsGet(TAB_KEY); return TABS.some((x) => x[0] === t) ? t : "offen"; })(), // „brauche“ = alter Reitername
    q: "", favOnly: false,
    month: todayKey().slice(0, 7),
  };
  let alive = true, queued = false;
  const queue = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  };

  el.innerHTML =
    `<div class="mt">` +
      `<div class="mt-tabs" role="tablist" aria-label="Material-Bereiche">` +
        TABS.map(([id, label, ic]) => `<button type="button" role="tab" class="mt-tab" data-tab="${id}" aria-selected="${id === S.tab}">${icon(ic, 18)}<span>${label}</span></button>`).join("") +
      `</div>` +
      `<div class="mt-page"></div>` +
      `<button type="button" class="mt-fab" data-x="add" aria-label="Material erfassen">${icon("plus", 26)}</button>` +
    `</div>`;
  const page = el.querySelector(".mt-page");
  const tabsEl = el.querySelector(".mt-tabs");

  function emptyHTML(emo, h, p, btn = "+ Material erfassen") {
    return `<div class="empty mt-empty"><div class="mt-empty-emo">${emo}</div><h3>${h}</h3><p>${p}</p>${btn ? `<button type="button" class="btn primary sm" data-x="add">${btn}</button>` : ""}</div>`;
  }

  function offenHTML() {
    const open = items.all().filter((x) => M.OPEN_STATUSES.includes(x.status));
    const n = (st, list = open) => list.filter((x) => x.status === st).length;
    const nB = n("brauche"), nG = n("besorgt"), nO = n("baustelle");
    const head = `<div class="mt-bar"><p class="mt-bar-t"><b>${nB}</b> zu besorgen${nG ? ` · <b>${nG}</b> besorgt` : ""}${nO ? ` · <b>${nO}</b> vor Ort` : ""}</p>` +
      (open.length ? `<button type="button" class="chip sm" data-x="share" data-mode="${nB || !nO ? "brauche" : "baustelle"}">${icon("share", 16)} Teilen</button>` : "") + `</div>`;
    if (!open.length) return emptyHTML("🛒", "Nichts offen", "Trag ein, was du für die Baustelle noch brauchst – abhaken, sobald du es hast, „Vor Ort“, sobald es auf der Baustelle liegt.");
    const groups = M.byPlace(open, places());
    const byName = (a, b) => String(a.name).localeCompare(String(b.name), "de", { numeric: true });
    return head + `<div class="mt-cards">` + groups.map((g) => {
      const pk = esc(g.key);
      return `<section class="card mt-card" data-pk="${pk}">` +
        `<div class="mt-card-h"><h3>${icon("pin", 17)}<span>${esc(g.place)}</span></h3><span class="mt-n">${g.items.length}</span>` +
          `<button type="button" class="mt-ib" data-x="share" data-mode="${n("brauche", g.items) || !n("baustelle", g.items) ? "brauche" : "baustelle"}" data-pk="${pk}" aria-label="Liste ${esc(g.place)} teilen">${icon("share", 16)}</button>` +
          `<button type="button" class="mt-ib" data-x="addat" data-pk="${pk}" aria-label="Material für ${esc(g.place)} hinzufügen">${icon("plus", 16)}</button></div>` +
        OPEN_SECTIONS.map(([st, label]) => {
          const list = g.items.filter((x) => x.status === st).sort(byName);
          if (!list.length) return "";
          const to = NEXT[st];
          const bulk = BULK[to] && list.length >= 2
            ? `<button type="button" class="btn sm ghost mt-allin to-${to}" data-x="bulk" data-from="${st}" data-to="${to}" data-pk="${pk}">${icon(to === "verbaut" ? "check" : "pin", 16)}<span>${esc(BULK[to][0])}</span></button>` : "";
          return `<div class="mt-sub mt-sec sec-${st}" data-sec="${st}"><div class="mt-sub-h"><span class="mt-dot" aria-hidden="true"></span><span>${esc(label)}</span><span class="mt-sec-n">${list.length}</span></div>` +
            `<ul class="mt-lines">${list.map((it) => lineHTML(it, { stepper: true })).join("")}</ul>${bulk}</div>`;
        }).join("") +
      `</section>`;
    }).join("") + `</div>` +
    `<p class="note mt-tip">Tipp: Zeile nach rechts wischen = nächster Schritt (besorgt → vor Ort → verbaut), nach links = zurück.</p>`;
  }

  function verbautHTML() {
    const done = items.all().filter((x) => x.status === "verbaut");
    const m = Number(S.month.split("-")[1]);
    const tools = `<div class="mt-bar mt-bar-v">` +
      `<label class="mt-month"><span class="sr">Monat</span><input type="month" id="mt-month" value="${esc(S.month)}"></label>` +
      `<button type="button" class="chip sm" data-x="csv">${icon("download", 16)} CSV ${esc(MONTHS[m - 1] || "")}</button>` +
      (done.length ? `<button type="button" class="chip sm" data-x="share" data-mode="woche">${icon("share", 16)} Woche teilen</button>` : "") +
    `</div>`;
    if (!done.length) return tools + emptyHTML("🧰", "Noch nichts verbaut", "Was du eingebaut hast, landet hier – nach Tag und Baustelle. Praktisch fürs Berichtsheft.");
    const byDay = new Map();
    for (const it of done) { const k = it.dayKey || ""; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(it); }
    const days = [...byDay.keys()].sort().reverse();
    return tools + `<div class="mt-days">` + days.map((k) => {
      const groups = M.byPlace(byDay.get(k), places());
      return `<section class="card mt-card mt-day">` +
        `<div class="mt-card-h"><h3>${icon("calendar", 17)}<span>${esc(fmtDay(k))}</span></h3><span class="mt-n">${byDay.get(k).length}</span>` +
          `<button type="button" class="mt-ib" data-x="share" data-mode="tag" data-day="${esc(k)}" aria-label="Tag teilen">${icon("share", 16)}</button></div>` +
        groups.map((g) => `<div class="mt-sub"><div class="mt-sub-h">${icon("pin", 14)}<span>${esc(g.place)}</span></div>` +
          `<ul class="mt-lines">${g.items.sort((a, b) => String(a.name).localeCompare(String(b.name), "de", { numeric: true })).map((it) => lineHTML(it)).join("")}</ul></div>`).join("") +
      `</section>`;
    }).join("") + `</div>`;
  }

  function orteHTML() {
    const all = items.all();
    if (!all.length) return emptyHTML("🏗️", "Noch kein Material", "Pro Baustelle siehst du hier, was verbaut wurde und was noch fehlt.");
    const sum = M.summarize(all, places()).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
    return `<div class="mt-cards mt-sum">` + sum.map((g) =>
      `<section class="card mt-card">` +
        `<div class="mt-card-h"><h3>${icon("building", 17)}<span>${esc(g.place)}</span></h3>` +
          `<button type="button" class="mt-ib" data-x="share" data-mode="woche" data-pk="${esc(g.key)}" aria-label="Teilen">${icon("share", 16)}</button></div>` +
        `<p class="note">${[g.last ? `zuletzt ${esc(M.fmtKeyDate(g.last))}` : "", M.openCountText(g) ? `<span class="mt-open">${esc(M.openCountText(g))}</span>` : ""].filter(Boolean).join(" · ")}</p>` +
        (g.verbaut.length ? `<h4 class="mt-h4">Verbaut gesamt</h4>${totalsHTML(g.verbaut)}` : `<p class="note">Noch nichts verbaut.</p>`) +
        (g.vorOrt.length ? `<h4 class="mt-h4 site">Auf der Baustelle</h4>${totalsHTML(g.vorOrt, "site")}` : "") +
        (g.brauche || g.besorgt ? `<h4 class="mt-h4">Noch offen</h4>${totalsHTML(M.totals(all.filter((x) => M.placeKey(x) === g.key && (x.status === "brauche" || x.status === "besorgt"))), "open")}` : "") +
      `</section>`).join("") + `</div>`;
  }

  function katalogHTML() {
    const list = catalogList();
    const hits = S.q.trim() ? M.searchCatalog(S.q, list, 60) : list;
    const shown = S.favOnly ? hits.filter((x) => x.fav) : hits;
    const favs = list.filter((x) => x.fav);
    const row = (c) => `<li class="mt-cat" data-cid="${esc(c.id)}">` +
      `<button type="button" class="mt-star" data-c="fav" aria-pressed="${c.fav}" aria-label="${c.fav ? "Favorit entfernen" : "Als Favorit merken"}">${icon("star", 18)}</button>` +
      `<button type="button" class="mt-cat-n" data-c="add"><b>${esc(c.name)}</b><small>${esc(c.unit)}${c.count ? ` · ${c.count}× benutzt` : ""}</small></button>` +
      (c.own ? `<button type="button" class="mt-ib" data-c="del" aria-label="${esc(c.name)} aus dem Katalog löschen">${icon("trash", 16)}</button>` : "") +
      `<button type="button" class="mt-ib mt-plus" data-c="add" aria-label="${esc(c.name)} erfassen">${icon("plus", 16)}</button>` +
    `</li>`;
    let body;
    if (S.q.trim() || S.favOnly) {
      body = shown.length ? `<ul class="mt-cats card">${shown.map(row).join("")}</ul>` : `<p class="note">Nichts gefunden. ${S.q.trim() ? `<button type="button" class="linkbtn" data-x="own">„${esc(S.q.trim())}“ als eigenes Material anlegen</button>` : ""}</p>`;
    } else {
      body = M.GROUPS.map((gname) => {
        const g = list.filter((x) => x.group === gname);
        if (!g.length) return "";
        return `<details class="mt-grp card"${gname === M.OWN_GROUP || gname === "Kabel & Leitungen" ? " open" : ""}><summary><b>${esc(gname)}</b><span class="mt-n">${g.length}</span></summary><ul class="mt-cats">${g.map(row).join("")}</ul></details>`;
      }).join("");
    }
    return `<div class="mt-bar mt-cat-bar">` +
        `<label class="mt-q-wrap mt-cat-q">${icon("search", 18)}<span class="sr">Katalog durchsuchen</span><input type="search" id="mt-cat-q" autocomplete="off" placeholder="Suchen, z. B. 5x2,5 oder FI" value="${esc(S.q)}"></label>` +
        `<button type="button" class="chip sm" data-x="favonly" aria-pressed="${S.favOnly}">${icon("star", 16)} Favoriten${favs.length ? ` (${favs.length})` : ""}</button>` +
        `<button type="button" class="chip sm add" data-x="own">${icon("plus", 16)} Eigenes</button>` +
      `</div>` +
      `<div class="mt-cat-list">${body}</div>`;
  }

  function render() {
    tabsEl.querySelectorAll(".mt-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    const a = document.activeElement;
    const keep = a && page.contains(a) && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    page.dataset.tab = S.tab;
    page.innerHTML = S.tab === "verbaut" ? verbautHTML() : S.tab === "orte" ? orteHTML() : S.tab === "katalog" ? katalogHTML() : offenHTML();
    if (keep) {
      const n = page.querySelector("#" + CSS.escape(keep.id));
      if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.e); } catch { /* egal */ } }
    }
  }

  function placeOfKey(pk) {
    const g = M.byPlace(items.all(), places()).find((x) => x.key === pk);
    if (!g) return {};
    return { placeId: g.placeId, place: g.placeId ? g.place : (g.key === "-" ? "" : g.place) };
  }

  function openOwnForm(name = "") {
    ui.openSheet({
      title: "Eigenes Material",
      bodyHTML: `<div class="fields">` +
        `<label>Name<input type="text" id="mt-own-n" maxlength="120" autocomplete="off" placeholder="z. B. Gira E2 Steckdose reinweiß" value="${esc(name)}"></label>` +
        `<label>Einheit<select id="mt-own-u">${M.UNITS.map((u) => `<option>${u}</option>`).join("")}</select></label>` +
        `<label>Suchbegriffe (optional)<input type="text" id="mt-own-t" maxlength="200" autocomplete="off" placeholder="z. B. gira e2 weiß"></label>` +
        `<button type="button" class="btn primary" id="mt-own-s">Im Katalog speichern</button></div>`,
      onMount(sheet, close) {
        const n = sheet.querySelector("#mt-own-n");
        setTimeout(() => { try { n.focus(); } catch { /* egal */ } }, 60);
        sheet.querySelector("#mt-own-s").addEventListener("click", async () => {
          const v = n.value.trim();
          if (!v) { ui.toast("Bitte einen Namen eingeben."); n.focus(); return; }
          if (catalogList().some((x) => M.norm(x.name) === M.norm(v))) { ui.toast("Das gibt es im Katalog schon."); return; }
          const id = "own_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          await safe(cat.put({ id, own: true, name: v, unit: sheet.querySelector("#mt-own-u").value, terms: sheet.querySelector("#mt-own-t").value.trim(), group: M.OWN_GROUP, fav: false, count: 0 }));
          close();
          ui.toast("Im Katalog gespeichert.");
        });
      },
    });
  }

  tabsEl.addEventListener("click", (ev) => {
    const b = ev.target.closest(".mt-tab");
    if (!b) return;
    S.tab = b.dataset.tab; lsSet(TAB_KEY, S.tab);
    render();
    window.scrollTo(0, 0);
  });
  wireLines(page);
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-x]");
    if (b) {
      const x = b.dataset.x;
      if (x === "add") openQuickAdd({});
      else if (x === "addat") openQuickAdd({ ...placeOfKey(b.dataset.pk), status: "brauche" });
      else if (x === "share") openShare({ mode: b.dataset.mode, day: b.dataset.day, placeKey: b.dataset.pk || "" });
      else if (x === "csv") exportMonthCSV(S.month);
      else if (x === "favonly") { S.favOnly = !S.favOnly; render(); }
      else if (x === "own") openOwnForm(S.q.trim());
      else if (x === "bulk") {
        const { from, to, pk } = b.dataset;
        const L = BULK[to];
        if (!L) return;
        const list = items.all().filter((it) => it.status === from && M.placeKey(it) === pk);
        if (b.dataset.armed) {
          delete b.dataset.armed;
          Promise.all(list.map((it) => setStatus(it.id, to))).then(() => ui.toast(L[2](list.length))).catch(() => ui.toast("Speichern fehlgeschlagen."));
        } else {
          b.dataset.armed = "1";
          b.querySelector("span").textContent = L[1](list.length);
          setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.querySelector("span").textContent = L[0]; } }, 4000);
        }
      }
      return;
    }
    const c = ev.target.closest("[data-c]");
    const li = ev.target.closest(".mt-cat");
    if (c && li) {
      const item = catalogList().find((x) => x.id === li.dataset.cid);
      if (!item) return;
      if (c.dataset.c === "fav") {
        const cur = cat.get(item.docId) || {};
        safe(cat.put({ ...cur, id: item.docId, own: item.own, ...(item.own ? { name: item.name, unit: item.unit, group: M.OWN_GROUP } : {}), fav: !item.fav, count: Number(cur.count) || 0 }));
      } else if (c.dataset.c === "del") {
        if (c.dataset.armed) safe(cat.remove(item.docId));
        else { c.dataset.armed = "1"; c.classList.add("armed"); c.setAttribute("aria-label", "Nochmal tippen zum Löschen"); ui.toast("Nochmal tippen zum Löschen."); }
      } else openQuickAdd({ name: item.name, unit: item.unit, catalogId: item.id });
    }
  });
  el.addEventListener("input", (ev) => {
    if (ev.target.id === "mt-cat-q") { S.q = ev.target.value; render(); }
  });
  el.addEventListener("change", (ev) => {
    if (ev.target.id === "mt-month" && ev.target.value) { S.month = ev.target.value; render(); }
  });

  const offs = [items.watch(queue), cat.watch(queue), store.subscribe(queue)];
  render();
  return () => { alive = false; for (const f of offs) { try { f(); } catch { /* egal */ } } };
}

/* ---------- „Heute“: Knopf neben dem Foto-Knopf ---------- */

/** Hängt den Material-Knopf an die Foto-Leiste (nur eingestempelt sichtbar, weil die Leiste dann sichtbar ist). */
export function mountTodayButton(host) {
  injectCSS();
  const { items } = cols();
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn ghost mt-today";
  b.dataset.mt = "today";
  host.appendChild(b);
  const draw = () => {
    const k = todayKey();
    const n = items.all().filter((x) => x.dayKey === k).length;
    b.innerHTML = n ? `<span aria-hidden="true">🧰</span> <span>${n}</span> <span class="mt-today-l">heute</span>` : `<span aria-hidden="true">🧰</span> <span>Material</span>`;
    b.setAttribute("aria-label", n ? `Material erfassen – ${n} heute` : "Material erfassen");
  };
  b.addEventListener("click", () => {
    const meta = runningMeta(store.get(), appCtx());
    openQuickAdd(meta ? { placeId: meta.placeId, place: meta.place, dayKey: meta.dayKey, status: "verbaut" } : { status: "verbaut" });
  });
  let off = items.watch(() => { if (!b.isConnected && off) { off(); off = null; return; } draw(); });
  draw();
  return { update: draw };
}

/* ---------- Ort-Blatt: „Material hier“ ---------- */

export function mountPlaceMaterial(host, place) {
  injectCSS();
  const { items } = cols();
  host.classList.add("mt-place");
  const draw = () => {
    const mine = items.all().filter((x) => x.placeId === place.id);
    const sum = M.summarize(mine, places())[0];
    host.innerHTML =
      `<div class="mt-place-h"><h3>🧰 Material hier</h3>` +
        (mine.length ? `<button type="button" class="mt-ib" data-p="share" aria-label="Material dieser Baustelle teilen">${icon("share", 16)}</button>` : "") +
        `<button type="button" class="btn sm ghost" data-p="add">${icon("plus", 16)}<span>Material</span></button></div>` +
      (!sum ? `<p class="note">Noch kein Material für diesen Ort. In „Heute“ während der Arbeit auf „🧰 Material“ tippen.</p>`
        : (sum.verbaut.length ? `<p class="mt-place-s">Verbaut gesamt</p>${totalsHTML(sum.verbaut)}` : `<p class="note">Noch nichts verbaut.</p>`) +
          (sum.vorOrt.length ? `<p class="mt-place-s site">Auf der Baustelle</p>${totalsHTML(sum.vorOrt, "site")}` : "") +
          (sum.brauche || sum.besorgt ? `<p class="note mt-open">Offen: ${esc(M.openCountText({ ...sum, baustelle: 0 }))} – ${esc(M.totals(mine.filter((x) => x.status === "brauche" || x.status === "besorgt")).map(M.lineText).join(", "))}</p>` : ""));
  };
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-p]");
    if (!b) return;
    if (b.dataset.p === "add") openQuickAdd({ placeId: place.id, place: place.name || "", status: "brauche" });
    else {
      const mine = items.all().filter((x) => x.placeId === place.id);
      const text = M.shareText({ items: mine.filter((x) => x.status === "verbaut"), title: "Verbautes Material", when: `Stand ${M.fmtKeyDate(todayKey())}` }, places())
        || M.shareText(M.shareSelection(mine, { mode: "baustelle" }, todayKey()), places())
        || M.shareText(M.shareSelection(mine, { mode: "brauche" }, todayKey()), places());
      shareOrCopy(text, "Material " + (place.name || ""));
    }
  });
  let off = items.watch(() => { if (!host.isConnected && off) { off(); off = null; return; } draw(); });
  draw();
}
