// Alltag › Galerie (Update 9, Agent S): alle Fotos nach Baustelle & Adresse.
//   Reiter: Alben · Alle Fotos · Karte.  Album-Ansicht über den Hash #alltag/galerie/a/<id> (Handy-Zurück schließt sie).
//   Daten: Index-Liste aus photos.listIndex() (nur Vorschaubilder), Alben aus gallery-albums.js,
//   großes Bild erst im Vollbild (photos.getPhoto).
import * as photos from "../photos.js";
import * as A from "../gallery-albums.js";
import * as G from "../gallery-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import * as timer from "../timer.js";
import { icon } from "../icons.js";
import { esc, WD, clock, dayKey as toDayKey } from "../util.js";
import { openViewer, openCapture, runningMeta, sharePhoto, camIcon } from "../views/gallery.js";

const TABS = [["alben", "Alben", "grid"], ["alle", "Alle Fotos", "image"], ["karte", "Karte", "map"]];
const TAB_KEY = "sk-gl-tab";
const PAGE = 90; // so viele Vorschaubilder auf einmal zeichnen, mehr beim Scrollen
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

export function injectCSS() {
  if (document.getElementById("gl-css")) return;
  const l = document.createElement("link");
  l.id = "gl-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-galerie.css", import.meta.url).href;
  document.head.appendChild(l);
}

/* ---------- Hilfen ---------- */

const pad = (n) => String(n).padStart(2, "0");
function keyDate(k) { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function fmtKey(k) { const d = keyDate(k); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }
function dayLabel(k) {
  const t = toDayKey(Date.now());
  const y = toDayKey(Date.now() - 86400000);
  const d = keyDate(k);
  const pre = k === t ? "Heute · " : k === y ? "Gestern · " : "";
  return `${pre}${WD[d.getDay()]}, ${fmtKey(k)}`;
}
const nFotos = (n) => `${n} ${n === 1 ? "Foto" : "Fotos"}`;
function fmtM(m) { return m >= 1000 ? `${String(Math.round(m / 100) / 10).replace(".", ",")} km` : `${Math.round(m)} m`; }

const OHNE = { id: G.OHNE_ORT, kind: "virtual", name: "Ohne Ort", emoji: "", radius: 0, lat: null, lng: null };

function albumGlyph(a, size = 20) {
  if (a.emoji) return `<span class="gl-emo" aria-hidden="true">${esc(a.emoji)}</span>`;
  if (a.kind === "address") return `<span class="gl-emo" aria-hidden="true">📍</span>`;
  if (a.kind === "place") return `<span class="gl-ic">${icon("building", size)}</span>`;
  if (a.kind === "virtual") return `<span class="gl-ic gl-ic-mute">${icon("pin", size)}</span>`;
  return `<span class="gl-emo" aria-hidden="true">📁</span>`;
}
const KIND_LABEL = { address: "Adresse", place: "Gespeicherter Ort", custom: "Eigenes Album", virtual: "Fotos ohne Standort" };

/* ---------- Zustand ---------- */

let S = null;

function freshState(el, ctx) {
  return {
    el, ctx, tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "alben",
    albumId: null, pushed: false,
    items: [], loaded: false, error: "",
    sel: new Set(), selecting: false,
    f: { albumId: "", from: "", to: "", q: "" },
    limit: PAGE, ordered: [], io: null, unsubs: [], map: null, rT: 0,
  };
}

function albumsAll() { return A.albums(); }
function amap() { return new Map(albumsAll().map((a) => [a.id, a])); }
function curAlbum() {
  if (!S.albumId) return null;
  if (S.albumId === G.OHNE_ORT) return OHNE;
  return A.albumById(S.albumId);
}

function routeFromHash() {
  const h = (location.hash || "").replace(/^#/, "");
  const m = /^alltag\/galerie\/a\/(.+)$/.exec(h);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------- Einhängen ---------- */

export function mount(el, ctx) {
  injectCSS();
  S = freshState(el, ctx);
  const my = S;
  el.innerHTML =
    `<div class="gl">` +
      `<div class="gl-tabs" role="tablist" aria-label="Galerie">` +
        TABS.map(([id, t, ic]) => `<button type="button" class="gl-tab" role="tab" data-tab="${id}" aria-selected="${id === S.tab}">${icon(ic, 18)}<span>${t}</span></button>`).join("") +
        `<button type="button" class="gl-gear" data-g="settings" aria-label="Galerie-Einstellungen" title="Einstellungen">${icon("gear", 20)}</button>` +
      `</div>` +
      `<div class="gl-page" data-g="page"></div>` +
      `<div class="gl-selbar" data-g="selbar" hidden></div>` +
    `</div>`;
  const root = el.querySelector(".gl");
  root.querySelector(".gl-tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tab]");
    if (b) { setTab(b.dataset.tab); return; }
    if (ev.target.closest('[data-g="settings"]')) openSettings();
  });
  wireGrid(root);
  root.querySelector('[data-g="selbar"]').addEventListener("click", onSelBar);

  S.albumId = routeFromHash();
  const onHash = () => {
    if (S !== my) return;
    const h = (location.hash || "").replace(/^#/, "");
    if (!h.startsWith("alltag/galerie")) return;
    const id = routeFromHash();
    if (id !== S.albumId) { S.albumId = id; if (!id) S.pushed = false; clearSel(); S.limit = PAGE; render(); window.scrollTo(0, 0); }
  };
  window.addEventListener("hashchange", onHash);
  S.unsubs.push(() => window.removeEventListener("hashchange", onHash));
  S.unsubs.push(A.albumsCol().watch(() => { if (S === my) schedule(); }));
  S.unsubs.push(photos.onChange(() => { if (S === my) reload(false); }));

  render();
  reload(true).then(() => A.migrate()).then((n) => { if (S === my && n) reload(false); }).catch((e) => console.error("Galerie-Migration:", e));

  return () => {
    if (S !== my) return;
    for (const u of S.unsubs) { try { u(); } catch { /* egal */ } }
    if (S.io) S.io.disconnect();
    if (S.map) { try { S.map.remove(); } catch { /* egal */ } }
    S = null;
  };
}

async function reload(refresh) {
  const my = S;
  try {
    const list = await photos.listIndex({ refresh });
    if (S !== my) return;
    S.items = list;
    S.loaded = true;
    S.error = "";
    for (const id of [...S.sel]) if (!list.some((x) => x.id === id)) S.sel.delete(id);
  } catch (e) {
    console.error(e);
    if (S !== my) return;
    S.loaded = true;
    S.error = navigator.onLine === false ? "Du bist offline – Fotos konnten nicht geladen werden." : "Fotos konnten nicht geladen werden.";
  }
  schedule();
}

function schedule() {
  if (!S || S.rT) return;
  S.rT = requestAnimationFrame(() => { if (!S) return; S.rT = 0; render(true); });
}

function setTab(t) {
  if (!TABS.some((x) => x[0] === t)) return;
  S.tab = t;
  lsSet(TAB_KEY, t);
  clearSel();
  S.limit = PAGE;
  if (S.albumId) { closeAlbum(); return; }
  render();
}

function openAlbum(id) {
  S.pushed = true;
  location.hash = `alltag/galerie/a/${encodeURIComponent(id)}`;
}
function closeAlbum() {
  if (S.pushed && history.length > 1) history.back();
  else location.hash = "alltag/galerie";
}

/* ---------- Zeichnen ---------- */

function page() { return S.el.querySelector('[data-g="page"]'); }

/** soft = nur Daten geändert → Eingabefelder (Suche) nicht neu aufbauen */
function render(soft = false) {
  if (!S) return;
  S.el.querySelectorAll(".gl-tab").forEach((b) => b.setAttribute("aria-selected", String(!S.albumId && b.dataset.tab === S.tab)));
  S.el.querySelector(".gl").classList.toggle("in-album", !!S.albumId);
  if (S.albumId) renderAlbum(soft);
  else if (S.tab === "alle") renderAll(soft);
  else if (S.tab === "karte") renderMap(soft);
  else renderAlbums();
  drawSelBar();
}

function statusHTML() {
  if (!S.loaded) return `<div class="gl-empty"><span class="gl-spin" aria-hidden="true"></span><p>Fotos werden geladen …</p></div>`;
  if (S.error) return `<div class="gl-empty"><p>${esc(S.error)}</p></div>`;
  return "";
}

function addButtons(albumIdForImport = "") {
  return `<div class="gl-adds">` +
    `<label class="btn sm primary gl-cam" tabindex="0" role="button" data-gl-cam>${camIcon(18)}<span>Foto</span><input type="file" accept="image/*" capture="environment" class="ph-file" data-in="cam" tabindex="-1"></label>` +
    `<label class="btn sm ghost" tabindex="0" role="button" data-gl-imp>${icon("upload", 18)}<span>Importieren</span><input type="file" accept="image/*" multiple class="ph-file" data-in="imp" data-imp-album="${esc(albumIdForImport)}" tabindex="-1"></label>` +
  `</div>`;
}

/* --- Alben --- */

function sortedAlbums() {
  const items = S.items;
  const m = amap();
  const list = albumsAll().map((a) => ({ a, st: G.albumStats(items, a, m) }));
  const ohne = G.albumStats(items, OHNE, m);
  list.sort((x, y) => (y.st.last || y.a.created) - (x.st.last || x.a.created));
  if (ohne.count) list.push({ a: OHNE, st: ohne });
  return list;
}

function albumCard({ a, st }) {
  const cov = st.coverItem && st.coverItem.thumb;
  return `<button type="button" class="gl-acard" data-album="${esc(a.id)}">` +
    `<span class="gl-acov">${cov ? `<img src="${cov}" alt="" loading="lazy" decoding="async">` : `<span class="gl-acov-e">${albumGlyph(a, 34)}</span>`}` +
      `<span class="gl-abadge">${albumGlyph(a, 16)}</span></span>` +
    `<span class="gl-atxt"><b>${esc(a.name)}</b><small>${esc(nFotos(st.count))}${st.last ? ` · ${esc(fmtKey(toDayKey(st.last)))}` : ""}</small></span>` +
  `</button>`;
}

function renderAlbums() {
  const pg = page();
  const st = statusHTML();
  const list = sortedAlbums();
  const total = S.items.length;
  const set = A.settings();
  pg.innerHTML =
    `<div class="gl-head">` +
      `<div class="gl-sum"><b>${list.filter((x) => x.a.kind !== "virtual").length} Alben</b><span>${esc(nFotos(total))}</span></div>` +
      addButtons() +
    `</div>` +
    (st || (!list.length
      ? `<div class="gl-empty"><div class="gl-empty-ic">📷</div><h3>Noch keine Fotos</h3><p>Mach ein Foto – ${set.auto ? "es landet automatisch im Album der Adresse, an der du gerade bist" : "und ordne es dann einem Album zu"}. Z. B. in „Heute“ während der Arbeit.</p></div>`
      : `<div class="gl-agrid">${list.map(albumCard).join("")}` +
        `<button type="button" class="gl-acard gl-anew" data-g="newalbum"><span class="gl-acov"><span class="gl-acov-e">${icon("plus", 30)}</span></span><span class="gl-atxt"><b>Neues Album</b><small>z. B. „Verteiler“, „Vorher/Nachher“</small></span></button>` +
        `</div>`)) +
    (list.length || st ? "" : `<button type="button" class="btn ghost gl-newbtn" data-g="newalbum">${icon("plus", 18)}<span>Neues Album</span></button>`) +
    (set.auto ? `<p class="gl-hint">📍 Neue Fotos werden automatisch nach Adresse einsortiert (Umkreis ${set.radius} m).</p>` : "");
}

/* --- Gitter (Alle Fotos / Album) --- */

function thumbHTML(it) {
  const sel = S.sel.has(it.id);
  const lab = (it.note ? `Foto: ${it.note}` : `Foto ${clock(it.ts)}`) + (it.addr ? `, ${it.addr}` : "");
  return `<button type="button" class="gl-th${sel ? " is-sel" : ""}" data-id="${esc(it.id)}" aria-label="${esc(lab)}"${S.selecting ? ` aria-pressed="${sel}"` : ""}>` +
    (it.thumb ? `<img src="${it.thumb}" alt="" loading="lazy" decoding="async" draggable="false">` : `<span class="gl-th-x">${camIcon(22)}</span>`) +
    (it.note ? `<span class="gl-th-n" aria-hidden="true">✎</span>` : "") +
    `<span class="gl-th-chk" aria-hidden="true">${icon("check", 16)}</span>` +
  `</button>`;
}

function gridHTML(list, { months = true } = {}) {
  const groups = G.groupByMonthDay(list);
  S.ordered = [];
  let n = 0, out = "";
  for (const m of groups) {
    if (n >= S.limit) break;
    if (months) out += `<h3 class="gl-mh">${esc(m.label)}</h3>`;
    for (const d of m.days) {
      if (n >= S.limit) break;
      const slice = d.items.slice(0, S.limit - n);
      n += slice.length;
      S.ordered.push(...slice);
      out += `<div class="gl-day"><div class="gl-dh"><b>${esc(d.dayKey ? dayLabel(d.dayKey) : "Ohne Datum")}</b><span>${esc(nFotos(d.items.length))}</span>` +
        (S.selecting ? `<button type="button" class="gl-dsel" data-day="${esc(d.dayKey)}">Tag wählen</button>` : "") +
        `</div><div class="gl-grid">${slice.map(thumbHTML).join("")}</div></div>`;
    }
  }
  // Viewer bekommt immer die ganze (gefilterte) Liste in Anzeige-Reihenfolge
  S.ordered = groups.flatMap((m) => m.days.flatMap((d) => d.items));
  if (n < list.length) out += `<div class="gl-more" data-g="more">Weitere Fotos werden geladen …</div>`;
  return out;
}

function watchMore() {
  if (S.io) { S.io.disconnect(); S.io = null; }
  const more = page().querySelector('[data-g="more"]');
  if (!more || typeof IntersectionObserver === "undefined") return;
  const my = S;
  S.io = new IntersectionObserver((ents) => {
    if (S !== my || !ents.some((e) => e.isIntersecting)) return;
    S.io.disconnect(); S.io = null;
    S.limit += PAGE;
    render(true);
  }, { rootMargin: "600px 0px" });
  S.io.observe(more);
}

function visibleList() {
  const m = amap();
  if (S.albumId) return G.itemsOfAlbum(S.items, S.albumId, m).sort((a, b) => b.ts - a.ts);
  return G.filterItems(S.items, S.f, m).sort((a, b) => b.ts - a.ts);
}

function selectHead(n) {
  return S.selecting
    ? `<button type="button" class="btn sm ghost" data-g="selall">Alle (${n})</button>`
    : `<button type="button" class="btn sm ghost" data-g="select"${n ? "" : " disabled"}>${icon("check2", 18)}<span>Auswählen</span></button>`;
}

function renderAll(soft) {
  const pg = page();
  if (!soft || !pg.querySelector(".gl-filters")) {
    pg.innerHTML =
      `<div class="gl-filters">` +
        `<label class="gl-search">${icon("search", 18)}<span class="sr">Suchen</span><input type="search" data-g="q" placeholder="Suchen: Notiz, Adresse, Ort …" autocomplete="off" value="${esc(S.f.q)}"></label>` +
        `<div class="gl-chips" data-g="achips" role="group" aria-label="Album-Filter"></div>` +
        `<div class="gl-range" role="group" aria-label="Zeitraum">` +
          `<label>Von<input type="date" data-g="from" value="${esc(S.f.from)}"></label>` +
          `<label>Bis<input type="date" data-g="to" value="${esc(S.f.to)}"></label>` +
          `<button type="button" class="gl-clear" data-g="clear" aria-label="Filter zurücksetzen" hidden>✕ Filter</button>` +
        `</div>` +
      `</div>` +
      `<div class="gl-bar"><span data-g="count"></span><span class="gl-bar-r" data-g="selhead"></span></div>` +
      `<div class="gl-list" data-g="grid"></div>`;
    const q = pg.querySelector('[data-g="q"]');
    let t = 0;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { if (!S) return; S.f.q = q.value; S.limit = PAGE; render(true); }, 180); });
    for (const k of ["from", "to"]) {
      pg.querySelector(`[data-g="${k}"]`).addEventListener("change", (ev) => { S.f[k] = ev.target.value; S.limit = PAGE; render(true); });
    }
  }
  const m = amap();
  const chips = [{ id: "", name: "Alle" }, ...sortedAlbums().map((x) => x.a)];
  pg.querySelector('[data-g="achips"]').innerHTML = chips.map((a) =>
    `<button type="button" class="gl-chip" data-fa="${esc(a.id)}" aria-pressed="${S.f.albumId === a.id}">${a.id ? albumGlyph(a, 15) : ""}<span>${esc(a.name)}</span></button>`).join("");
  if (S.f.albumId && S.f.albumId !== G.OHNE_ORT && !m.has(S.f.albumId)) S.f.albumId = "";
  const list = visibleList();
  const filtered = !!(S.f.albumId || S.f.from || S.f.to || S.f.q.trim());
  pg.querySelector('[data-g="clear"]').hidden = !filtered;
  pg.querySelector('[data-g="count"]').textContent = S.loaded ? (filtered ? `${nFotos(list.length)} gefunden` : nFotos(list.length)) : "";
  pg.querySelector('[data-g="selhead"]').innerHTML = selectHead(list.length);
  const st = statusHTML();
  pg.querySelector('[data-g="grid"]').innerHTML = st || (list.length ? gridHTML(list) :
    `<div class="gl-empty"><p>${filtered ? "Keine Fotos für diesen Filter." : "Noch keine Fotos."}</p>${filtered ? "" : addButtons()}</div>`);
  watchMore();
}

function renderAlbum() {
  const pg = page();
  const a = curAlbum();
  if (!a) {
    pg.innerHTML = `<div class="gl-albar"><button type="button" class="gl-back" data-g="back">${icon("chevron-left", 20)}<span>Alben</span></button></div>` +
      (A.albumsCol().loaded ? `<div class="gl-empty"><p>Dieses Album gibt es nicht mehr.</p></div>` : statusHTML() || `<div class="gl-empty"><p>Album wird geladen …</p></div>`);
    return;
  }
  const list = visibleList();
  const virtual = a.kind === "virtual";
  const sub = [KIND_LABEL[a.kind] || "", a.kind === "address" ? `Umkreis ${a.radius} m` : "", a.addr && a.addr !== a.name ? a.addr : ""].filter(Boolean).join(" · ");
  const maps = virtual ? null : G.albumMapsUrl(a, a.placeId ? (store.get().places || []).find((p) => p.id === a.placeId) : null);
  pg.innerHTML =
    `<div class="gl-albar">` +
      `<button type="button" class="gl-back" data-g="back" aria-label="Zurück zu den Alben">${icon("chevron-left", 20)}<span>Alben</span></button>` +
      (virtual ? "" : `<button type="button" class="btn sm ghost gl-more-btn" data-g="amenu" aria-label="Album bearbeiten">${icon("pencil", 18)}<span>Bearbeiten</span></button>`) +
    `</div>` +
    `<div class="gl-ahead">` +
      `<span class="gl-ahead-ic">${albumGlyph(a, 26)}</span>` +
      `<div class="gl-ahead-t"><h3 data-g="aname">${esc(a.name)}</h3><small>${esc(sub)}</small></div>` +
    `</div>` +
    `<div class="gl-aacts">` +
      addButtons(virtual ? "" : a.id) +
      (maps ? `<a class="btn sm ghost" href="${esc(maps)}" target="_blank" rel="noopener" data-g="maps">${icon("map", 18)}<span>In Google Maps öffnen</span></a>` : "") +
    `</div>` +
    `<div class="gl-bar"><span>${esc(nFotos(list.length))}</span><span class="gl-bar-r">${selectHead(list.length)}</span></div>` +
    (statusHTML() || (list.length ? gridHTML(list, { months: false }) :
      `<div class="gl-empty"><p>${virtual ? "Alle Fotos haben einen Ort. 👍" : "Noch keine Fotos in diesem Album."}</p></div>`));
  watchMore();
}

/* --- Karte (Leaflet, wie im Reiter „Orte“) --- */

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
let leafletP = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((resolve, reject) => {
    if (!document.querySelector("link[data-leaflet]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = LEAFLET_CSS; link.dataset.leaflet = "1";
      document.head.appendChild(link);
    }
    const sc = document.createElement("script");
    sc.src = LEAFLET_JS; sc.async = true; sc.dataset.leaflet = "1";
    sc.onload = () => (window.L ? resolve(window.L) : reject(new Error("Leaflet fehlt")));
    sc.onerror = () => { sc.remove(); reject(new Error("Leaflet konnte nicht geladen werden")); };
    document.head.appendChild(sc);
  }).catch((e) => { leafletP = null; throw e; });
  return leafletP;
}

function renderMap(soft) {
  const pg = page();
  const pts = sortedAlbums().filter((x) => x.a.kind !== "virtual" && G.hasPos(x.a));
  const listHTML = pts.length
    ? `<div class="gl-mlist">${pts.map(({ a, st }) => `<button type="button" class="gl-mrow" data-album="${esc(a.id)}">${albumGlyph(a, 18)}<span><b>${esc(a.name)}</b><small>${esc(nFotos(st.count))}</small></span>${icon("chevron-right", 18)}</button>`).join("")}</div>`
    : `<div class="gl-empty"><p>Noch keine Alben mit Standort.</p></div>`;
  if (soft && S.map && pg.querySelector(".gl-map")) { drawMarkers(pts); pg.querySelector('[data-g="mlist"]').innerHTML = listHTML; return; }
  if (S.map) { try { S.map.remove(); } catch { /* egal */ } S.map = null; }
  pg.innerHTML = `<div class="gl-map" data-g="map"><p class="gl-mapnote" data-g="mapnote">Karte wird geladen …</p></div><div data-g="mlist">${listHTML}</div>`;
  if (!pts.length) { pg.querySelector('[data-g="mapnote"]').textContent = "Sobald Fotos mit Standort da sind, erscheinen ihre Alben hier."; return; }
  const my = S;
  loadLeaflet().then((L) => {
    if (S !== my || S.tab !== "karte" || S.albumId) return;
    const box = pg.querySelector('[data-g="map"]');
    if (!box) return;
    box.innerHTML = "";
    S.map = L.map(box, { zoomControl: true, attributionControl: true }).setView([47.07, 15.44], 9);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
    drawMarkers(pts, true);
  }).catch(() => {
    const n = pg.querySelector('[data-g="mapnote"]');
    if (n) n.textContent = navigator.onLine === false ? "Karte geht nur mit Internet – unten die Alben als Liste." : "Karte konnte nicht geladen werden – unten die Alben als Liste.";
  });
}

function drawMarkers(pts, fit) {
  if (!S.map || !window.L) return;
  const L = window.L;
  S.layer.clearLayers();
  const ll = [];
  for (const { a, st } of pts) {
    ll.push([a.lat, a.lng]);
    L.circleMarker([a.lat, a.lng], { radius: 9, color: "#fff", weight: 2, fillColor: a.kind === "place" ? "#4F46E5" : "#0284c7", fillOpacity: 1 })
      .bindTooltip(`${a.name} · ${nFotos(st.count)}`)
      .on("click", () => openAlbum(a.id))
      .addTo(S.layer);
  }
  if (fit && ll.length) S.map.fitBounds(ll, { padding: [30, 30], maxZoom: 15 });
}

/* ---------- Bedienung im Gitter ---------- */

function wireGrid(root) {
  let lp = null; // langes Drücken
  let lpFired = false;
  root.addEventListener("pointerdown", (ev) => {
    const th = ev.target.closest(".gl-th");
    if (!th || ev.button > 0) return;
    lpFired = false;
    const x = ev.clientX, y = ev.clientY;
    clearTimeout(lp && lp.t);
    lp = { x, y, id: th.dataset.id, t: setTimeout(() => {
      lpFired = true;
      if (!S.selecting) { S.selecting = true; S.sel.clear(); }
      S.sel.add(th.dataset.id);
      try { navigator.vibrate && navigator.vibrate(15); } catch { /* egal */ }
      render(true);
    }, 480) };
  });
  const cancel = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  root.addEventListener("pointermove", (ev) => { if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 10) cancel(); });
  root.addEventListener("pointerup", cancel);
  root.addEventListener("pointercancel", cancel);
  root.addEventListener("contextmenu", (ev) => { if (ev.target.closest(".gl-th")) ev.preventDefault(); });

  root.addEventListener("click", (ev) => {
    const t = ev.target;
    const th = t.closest(".gl-th");
    if (th) {
      if (lpFired) { lpFired = false; ev.preventDefault(); return; }
      const id = th.dataset.id;
      if (S.selecting) { toggleSel(id); return; }
      const i = S.ordered.findIndex((x) => x.id === id);
      showViewer(i < 0 ? 0 : i);
      return;
    }
    const card = t.closest("[data-album]");
    if (card) { openAlbum(card.dataset.album); return; }
    const fa = t.closest("[data-fa]");
    if (fa) { S.f.albumId = S.f.albumId === fa.dataset.fa ? "" : fa.dataset.fa; S.limit = PAGE; render(true); return; }
    const dsel = t.closest("[data-day]");
    if (dsel) {
      const ids = visibleList().filter((x) => x.dayKey === dsel.dataset.day).map((x) => x.id);
      const all = ids.every((id) => S.sel.has(id));
      for (const id of ids) all ? S.sel.delete(id) : S.sel.add(id);
      render(true); return;
    }
    const g = t.closest("[data-g]");
    if (!g) return;
    switch (g.dataset.g) {
      case "back": closeAlbum(); break;
      case "newalbum": newAlbumSheet().then((a) => { if (a) openAlbum(a.id); }); break;
      case "select": S.selecting = true; S.sel.clear(); render(true); break;
      case "selall": { const ids = visibleList().map((x) => x.id); const all = ids.every((id) => S.sel.has(id)); S.sel = new Set(all ? [] : ids); render(true); break; }
      case "clear": S.f = { albumId: "", from: "", to: "", q: "" }; S.limit = PAGE; render(false); break;
      case "amenu": albumMenu(); break;
      default: break;
    }
  });
  // Kamera / Import
  root.addEventListener("change", (ev) => {
    const inp = ev.target.closest && ev.target.closest("input.ph-file");
    if (!inp) return;
    const files = [...(inp.files || [])];
    inp.value = "";
    if (!files.length) return;
    if (inp.dataset.in === "cam") takePhoto(files[0]);
    else importFiles(files, inp.dataset.impAlbum || (S.albumId && S.albumId !== G.OHNE_ORT ? S.albumId : ""));
  });
  root.addEventListener("keydown", (ev) => {
    const lab = ev.target.closest && ev.target.closest("label[data-gl-cam], label[data-gl-imp]");
    if (!lab || (ev.key !== "Enter" && ev.key !== " ")) return;
    ev.preventDefault();
    const inp = lab.querySelector("input.ph-file");
    if (inp) inp.click();
  });
}

function toggleSel(id) {
  if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
  const th = S.el.querySelector(`.gl-th[data-id="${CSS.escape(id)}"]`);
  if (th) { th.classList.toggle("is-sel", S.sel.has(id)); th.setAttribute("aria-pressed", String(S.sel.has(id))); }
  drawSelBar();
}
function clearSel() { if (!S) return; S.selecting = false; S.sel.clear(); }

/* ---------- Auswahl-Leiste ---------- */

function drawSelBar() {
  const bar = S.el.querySelector('[data-g="selbar"]');
  if (!S.selecting) { bar.hidden = true; bar.innerHTML = ""; S.el.querySelector(".gl").classList.remove("selecting"); return; }
  S.el.querySelector(".gl").classList.add("selecting");
  const n = S.sel.size;
  const a = curAlbum();
  const inAlbum = a && a.kind !== "virtual";
  const dis = n ? "" : " disabled";
  bar.hidden = false;
  bar.innerHTML =
    `<div class="gl-sel-top"><b data-g="selcount">${n} ausgewählt</b><button type="button" class="gl-sel-x" data-s="done" aria-label="Auswahl beenden">✕</button></div>` +
    `<div class="gl-sel-acts">` +
      `<button type="button" data-s="share"${dis}>${icon("share", 20)}<span>Teilen</span></button>` +
      `<button type="button" data-s="add"${dis}>${icon("plus", 20)}<span>Zu Album</span></button>` +
      (inAlbum ? `<button type="button" data-s="move"${dis}>${icon("swap", 20)}<span>Verschieben</span></button>` +
        `<button type="button" data-s="remove"${dis}>${icon("layers", 20)}<span>Aus Album</span></button>` : "") +
      `<button type="button" class="is-danger" data-s="del"${dis}>${icon("trash", 20)}<span>Löschen</span></button>` +
    `</div>`;
}

async function onSelBar(ev) {
  const b = ev.target.closest("[data-s]");
  if (!b || b.disabled) return;
  const ids = [...S.sel];
  const a = curAlbum();
  const ctx = S.ctx;
  const done = () => { clearSel(); render(true); };
  switch (b.dataset.s) {
    case "done": done(); break;
    case "share": await shareMany(ids); break;
    case "add": {
      const aid = await pickAlbum({ title: `${nFotos(ids.length)} zu Album hinzufügen`, exclude: a ? [a.id] : [] });
      if (!aid) return;
      await A.addToAlbum(ids, aid);
      ctx.ui.toast(`${nFotos(ids.length)} zu „${(A.albumById(aid) || {}).name || "Album"}“ hinzugefügt.`);
      done(); break;
    }
    case "move": {
      const aid = await pickAlbum({ title: `${nFotos(ids.length)} verschieben nach …`, exclude: [a.id] });
      if (!aid) return;
      await A.moveToAlbum(ids, a.id, aid);
      ctx.ui.toast(`${nFotos(ids.length)} nach „${(A.albumById(aid) || {}).name || "Album"}“ verschoben.`);
      done(); break;
    }
    case "remove":
      await A.removeFromAlbum(ids, a.id);
      ctx.ui.toast(`${nFotos(ids.length)} aus „${a.name}“ entfernt – sie bleiben in „Alle Fotos“.`, 3200);
      done(); break;
    case "del":
      confirmSheet({
        title: `${nFotos(ids.length)} löschen?`,
        text: `${ids.length === 1 ? "Das Foto wird" : `Die ${ids.length} Fotos werden`} endgültig gelöscht – auch aus allen Alben, „Heute“ und dem Ort. Das kann man nicht rückgängig machen.`,
        ok: `${nFotos(ids.length)} löschen`,
        onOk: async () => { await A.deletePhotos(ids); ctx.ui.toast(`${nFotos(ids.length)} gelöscht.`); done(); },
      });
      break;
    default: break;
  }
}

async function shareMany(ids) {
  const ctx = S.ctx;
  ctx.ui.toast(ids.length > 1 ? "Fotos werden vorbereitet …" : "Foto wird vorbereitet …", 1600);
  const full = [];
  for (const id of ids) { try { const p = await photos.getPhoto(id); if (p) full.push(p); } catch (e) { console.error(e); } }
  if (!full.length) { ctx.ui.toast("Fotos konnten nicht geladen werden."); return; }
  if (full.length === 1) { await sharePhoto(full[0], ctx); return; }
  const files = full.map((p) => photos.photoFile(p)).filter(Boolean);
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({ files, title: `${files.length} Fotos` });
      return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  // Fallback: einzeln herunterladen
  for (let i = 0; i < full.length; i++) {
    const a = document.createElement("a");
    a.href = full[i].data; a.download = (files[i] && files[i].name) || `Foto_${i + 1}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise((r) => setTimeout(r, 250));
  }
  ctx.ui.toast(`Teilen geht hier nicht – ${full.length} Fotos werden heruntergeladen.`, 3200);
}

/* ---------- Vollbild ---------- */

function showViewer(i) {
  const list = S.ordered.map((x) => ({ ...x })); // Kopie, Viewer ergänzt data
  openViewer(list, i, S.ctx, {
    resolve: (p) => photos.getPhoto(p.id),
    extra: (p, host) => viewerChips(p, host),
  });
}

function viewerChips(p, host) {
  const m = amap();
  const ids = G.cleanIds(p.albumIds).filter((id) => m.has(id));
  host.innerHTML =
    `<div class="gl-vchips" role="group" aria-label="Alben">` +
      ids.map((id) => { const a = m.get(id); return `<span class="gl-vchip">${albumGlyph(a, 14)}<button type="button" class="gl-vchip-go" data-va="${esc(id)}">${esc(a.name)}</button><button type="button" class="gl-vchip-x" data-vx="${esc(id)}" aria-label="Aus „${esc(a.name)}“ entfernen">✕</button></span>`; }).join("") +
      `<button type="button" class="gl-vchip gl-vchip-add" data-vadd>＋ Album</button>` +
    `</div>`;
  host.onclick = async (ev) => {
    const x = ev.target.closest("[data-vx]");
    if (x) {
      await photos.updatePhoto(p.id, { albumIds: G.changeIds(p.albumIds, [], x.dataset.vx) });
      return;
    }
    if (ev.target.closest("[data-vadd]")) {
      const aid = await pickAlbum({ title: "Zu Album hinzufügen", exclude: ids, above: true });
      if (aid) await photos.updatePhoto(p.id, { albumIds: G.changeIds(p.albumIds, aid) });
      return;
    }
    const go = ev.target.closest("[data-va]");
    if (go) {
      // Vollbild schließen (history.back) und erst danach ins Album wechseln
      const id = go.dataset.va;
      let fired = false;
      const next = () => { if (fired) return; fired = true; window.removeEventListener("popstate", next); setTimeout(() => { if (S) openAlbum(id); }, 0); };
      window.addEventListener("popstate", next);
      setTimeout(next, 400);
      const v = document.querySelector(".ph-v-x");
      if (v) v.click();
    }
  };
}

/* ---------- Fotos aufnehmen / importieren ---------- */

function takePhoto(file) {
  const ctx = S.ctx;
  const a = curAlbum();
  const snap = store.get();
  const run = runningMeta(snap, { ui, store, timer });
  const meta = run || { dayKey: toDayKey(Date.now()), placeId: null, place: "", entryId: null };
  if (a && a.kind !== "virtual") {
    meta.albumIds = [a.id];
    if (a.kind === "place") { meta.placeId = a.placeId; meta.place = a.name; }
  }
  // In ein Adress-/Ort-Album gezielt aufnehmen → nur Position merken, nicht noch woanders einsortieren
  openCapture(file, ctx, meta, { auto: !(a && (a.kind === "address" || a.kind === "place")) });
}

async function readExifOf(file) {
  try {
    if (!/jpe?g/i.test(file.type || "") && !/\.jpe?g$/i.test(file.name || "")) return {};
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    return G.readExif(buf);
  } catch { return {}; }
}

async function importFiles(files, albumId) {
  const ctx = S.ctx;
  const a = albumId ? A.albumById(albumId) : null;
  let ok = 0, fail = 0;
  const imgs = files.filter((f) => !f.type || /^image\//i.test(f.type));
  if (!imgs.length) { ctx.ui.toast("Bitte Bilder auswählen."); return; }
  for (let i = 0; i < imgs.length; i++) {
    const f = imgs[i];
    if (imgs.length > 1) ctx.ui.toast(`Importiere ${i + 1} von ${imgs.length} …`, 1800);
    try {
      const ex = await readExifOf(f);
      const processed = await photos.processImage(f);
      const ts = ex.ts || Date.now();
      const exPos = Number.isFinite(ex.lat) ? { lat: ex.lat, lng: ex.lng } : null;
      const pos = exPos || (a && G.hasPos(a) ? { lat: a.lat, lng: a.lng } : null);
      const r = await photos.addPhoto(null, {
        processed, ts, dayKey: toDayKey(ts),
        placeId: a && a.kind === "place" ? a.placeId : null,
        place: a && a.kind === "place" ? a.name : "",
        entryId: null, note: "",
        albumIds: a ? [a.id] : [],
        lat: pos ? pos.lat : null, lng: pos ? pos.lng : null,
        addr: !exPos && a ? (a.addr || "") : "",
        albMig: true,
      });
      ok++;
      // EXIF-GPS → Adresse nachschlagen und (ohne festes Adress-Album) automatisch einsortieren
      if (exPos) A.autoFile(r.photo, { pos: exPos, auto: !a || a.kind === "custom" }).catch((e) => console.error(e));
    } catch (e) {
      console.error(e);
      fail++;
    }
  }
  ctx.ui.toast(fail ? `${nFotos(ok)} importiert, ${fail} nicht lesbar.` : `${nFotos(ok)} importiert${a ? ` in „${a.name}“` : ""}.`, 3000);
}

/* ---------- Blätter ---------- */

function sheet(opts) {
  const r = ui.openSheet(opts);
  if (opts.above && r && r.el) r.el.style.zIndex = "57"; // über dem Vollbild (55)
  return r;
}

function confirmSheet({ title, text, ok, onOk, above }) {
  sheet({
    title, above,
    bodyHTML: `<div class="gl-sheet"><p>${esc(text)}</p><div class="row"><button type="button" class="btn ghost" data-c="no">Abbrechen</button><button type="button" class="btn danger confirm" data-c="ok">${esc(ok)}</button></div></div>`,
    onMount(el, close) {
      el.querySelector('[data-c="no"]').addEventListener("click", close);
      const b = el.querySelector('[data-c="ok"]');
      b.addEventListener("click", async () => {
        ui.setBusy(b, true, "Bitte warten …");
        try { await onOk(); close(); } catch (e) { console.error(e); ui.setBusy(b, false); ui.toast("Das hat nicht geklappt."); }
      });
    },
  });
}

/** Album wählen (oder neu anlegen) → Promise<albumId|null> */
function pickAlbum({ title = "Album wählen", exclude = [], above = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const list = sortedAlbums().filter((x) => x.a.kind !== "virtual" && !exclude.includes(x.a.id));
    sheet({
      title, above,
      bodyHTML:
        `<div class="gl-sheet gl-pick">` +
          `<div class="gl-newrow"><input type="text" data-p="name" maxlength="60" placeholder="Neues Album, z. B. Verteiler" autocomplete="off" aria-label="Name für neues Album"><button type="button" class="btn sm primary" data-p="create">Anlegen</button></div>` +
          (list.length ? `<div class="gl-plist">${list.map(({ a, st }) => `<button type="button" class="gl-prow" data-pick="${esc(a.id)}">${albumGlyph(a, 18)}<span><b>${esc(a.name)}</b><small>${esc(nFotos(st.count))}</small></span></button>`).join("")}</div>` : `<p class="note">Noch keine anderen Alben – leg oben eins an.</p>`) +
        `</div>`,
      onMount(el, close) {
        el.addEventListener("click", async (ev) => {
          const p = ev.target.closest("[data-pick]");
          if (p) { finish(p.dataset.pick); close(); return; }
          if (ev.target.closest('[data-p="create"]')) {
            const inp = el.querySelector('[data-p="name"]');
            const name = inp.value.trim();
            if (!name) { inp.focus(); ui.toast("Bitte einen Namen eingeben."); return; }
            const a = await A.createAlbum({ kind: "custom", name, emoji: "📁" });
            finish(a.id); close();
          }
        });
        el.querySelector('[data-p="name"]').addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); el.querySelector('[data-p="create"]').click(); } });
        // Schließen ohne Auswahl
        new MutationObserver((_, mo) => { if (!el.isConnected) { mo.disconnect(); finish(null); } }).observe(el.parentNode || document.body, { childList: true });
      },
    });
  });
}

function emojiPicker(cur) {
  return `<div class="gl-emojis" role="group" aria-label="Symbol">` +
    G.EMOJIS.map((e) => `<button type="button" class="gl-emoji" data-emoji="${e}" aria-pressed="${e === cur}">${e}</button>`).join("") +
  `</div>`;
}

function newAlbumSheet() {
  return new Promise((resolve) => {
    let emoji = "📁";
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    sheet({
      title: "Neues Album",
      bodyHTML:
        `<div class="gl-sheet"><div class="fields"><label>Name<input type="text" data-n="name" maxlength="60" placeholder="z. B. Verteiler, Vorher/Nachher" autocomplete="off"></label></div>` +
        `<div class="lbl">Symbol</div>${emojiPicker(emoji)}` +
        `<div class="row"><button type="button" class="btn ghost" data-n="no">Abbrechen</button><button type="button" class="btn primary" data-n="ok">Anlegen</button></div></div>`,
      onMount(el, close) {
        const name = el.querySelector('[data-n="name"]');
        setTimeout(() => { try { name.focus(); } catch { /* egal */ } }, 50);
        el.querySelector(".gl-emojis").addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-emoji]");
          if (!b) return;
          emoji = b.dataset.emoji;
          el.querySelectorAll("[data-emoji]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        el.querySelector('[data-n="no"]').addEventListener("click", () => { finish(null); close(); });
        const go = async () => {
          const n = name.value.trim();
          if (!n) { ui.toast("Bitte einen Namen eingeben."); name.focus(); return; }
          const a = await A.createAlbum({ kind: "custom", name: n, emoji });
          finish(a); close();
        };
        el.querySelector('[data-n="ok"]').addEventListener("click", go);
        name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
        new MutationObserver((_, mo) => { if (!el.isConnected) { mo.disconnect(); finish(null); } }).observe(el.parentNode || document.body, { childList: true });
      },
    });
  });
}

function albumMenu() {
  const a = curAlbum();
  if (!a || a.kind === "virtual") return;
  const ctx = S.ctx;
  let emoji = a.emoji || "";
  let radius = a.radius;
  const count = G.itemsOfAlbum(S.items, a.id, amap()).length;
  sheet({
    title: "Album bearbeiten",
    bodyHTML:
      `<div class="gl-sheet">` +
        `<div class="fields"><label>Name<input type="text" data-m="name" maxlength="80" value="${esc(a.name)}" autocomplete="off"></label></div>` +
        `<div class="lbl">Symbol</div>` +
        `<div class="gl-emojis" role="group" aria-label="Symbol"><button type="button" class="gl-emoji gl-emoji-auto" data-emoji="" aria-pressed="${!emoji}" title="Standard">${a.kind === "address" ? "📍" : a.kind === "place" ? "🏢" : "📁"}<small>Std.</small></button>` +
          G.EMOJIS.map((e) => `<button type="button" class="gl-emoji" data-emoji="${e}" aria-pressed="${e === emoji}">${e}</button>`).join("") + `</div>` +
        (a.kind === "address" ? `<div class="lbl">Umkreis für neue Fotos</div><div class="gl-rads" role="group" aria-label="Umkreis">${G.RADIUS_CHOICES.map((r) => `<button type="button" class="gl-chip" data-rad="${r}" aria-pressed="${r === radius}">${r} m</button>`).join("")}</div>` : "") +
        `<div class="row"><button type="button" class="btn primary" data-m="save">Speichern</button></div>` +
        `<div class="gl-menu">` +
          `<button type="button" class="gl-mi" data-m="merge">${icon("layers", 20)}<span><b>Mit anderem Album zusammenführen</b><small>z. B. zwei Adressen derselben Baustelle</small></span></button>` +
          `<button type="button" class="gl-mi" data-m="cover"${count ? "" : " disabled"}>${icon("image", 20)}<span><b>Titelbild: neuestes Foto</b><small>${a.cover ? "Gewähltes Titelbild zurücksetzen" : "Wird automatisch gewählt"}</small></span></button>` +
          `<button type="button" class="gl-mi is-danger" data-m="del">${icon("trash", 20)}<span><b>Album löschen …</b><small>Du kannst wählen, ob die Fotos bleiben</small></span></button>` +
        `</div>` +
      `</div>`,
    onMount(el, close) {
      el.addEventListener("click", async (ev) => {
        const e = ev.target.closest("[data-emoji]");
        if (e) { emoji = e.dataset.emoji; el.querySelectorAll("[data-emoji]").forEach((x) => x.setAttribute("aria-pressed", String(x === e))); return; }
        const r = ev.target.closest("[data-rad]");
        if (r) { radius = Number(r.dataset.rad); el.querySelectorAll("[data-rad]").forEach((x) => x.setAttribute("aria-pressed", String(x === r))); return; }
        const m = ev.target.closest("[data-m]");
        if (!m) return;
        if (m.dataset.m === "save") {
          const name = el.querySelector('[data-m="name"]').value.trim();
          if (!name) { ui.toast("Bitte einen Namen eingeben."); return; }
          await A.patchAlbum(a.id, { name, emoji, radius });
          close(); ctx.ui.toast("Album gespeichert.");
        } else if (m.dataset.m === "merge") { close(); mergeSheet(a); }
        else if (m.dataset.m === "cover") { await A.patchAlbum(a.id, { cover: null }); close(); ctx.ui.toast("Titelbild: neuestes Foto."); }
        else if (m.dataset.m === "del") { close(); deleteAlbumSheet(a); }
      });
    },
  });
}

function mergeSheet(a) {
  const ctx = S.ctx;
  const others = sortedAlbums().filter((x) => x.a.kind !== "virtual" && x.a.id !== a.id)
    .map((x) => ({ ...x, d: G.hasPos(a) && G.hasPos(x.a) ? G.distanceM(a, x.a) : Infinity }))
    .sort((x, y) => x.d - y.d);
  let pick = null;
  sheet({
    title: "Alben zusammenführen",
    bodyHTML:
      `<div class="gl-sheet"><p>Welches Album soll in <b>„${esc(a.name)}“</b> aufgehen? Seine Fotos kommen hierher, das andere Album wird entfernt.</p>` +
      (others.length ? `<div class="gl-plist">${others.map(({ a: o, st, d }) => `<button type="button" class="gl-prow" data-pick="${esc(o.id)}" aria-pressed="false">${albumGlyph(o, 18)}<span><b>${esc(o.name)}</b><small>${esc(nFotos(st.count))}${Number.isFinite(d) ? ` · ${fmtM(d)} entfernt` : ""}</small></span></button>`).join("")}</div>` : `<p class="note">Es gibt kein anderes Album.</p>`) +
      `<div class="row"><button type="button" class="btn ghost" data-c="no">Abbrechen</button><button type="button" class="btn primary" data-c="ok" disabled>Zusammenführen</button></div></div>`,
    onMount(el, close) {
      const ok = el.querySelector('[data-c="ok"]');
      el.querySelector('[data-c="no"]').addEventListener("click", close);
      el.addEventListener("click", (ev) => {
        const p = ev.target.closest("[data-pick]");
        if (!p) return;
        pick = p.dataset.pick;
        el.querySelectorAll("[data-pick]").forEach((x) => x.setAttribute("aria-pressed", String(x === p)));
        ok.disabled = false;
        const o = A.albumById(pick);
        ok.textContent = `„${o ? o.name : "Album"}“ hierher holen`;
      });
      ok.addEventListener("click", async () => {
        if (!pick) return;
        ui.setBusy(ok, true, "Führt zusammen …");
        const o = A.albumById(pick);
        const n = await A.mergeAlbums(pick, a.id);
        close();
        ctx.ui.toast(`„${o ? o.name : "Album"}“ zusammengeführt – ${nFotos(n)} verschoben.`, 3000);
      });
    },
  });
}

function deleteAlbumSheet(a) {
  const ctx = S.ctx;
  const n = G.itemsOfAlbum(S.items, a.id, amap()).length;
  sheet({
    title: "Album löschen?",
    bodyHTML:
      `<div class="gl-sheet"><p><b>„${esc(a.name)}“</b> · ${esc(nFotos(n))}</p>` +
      `<div class="gl-radio" role="radiogroup" aria-label="Was passiert mit den Fotos?">` +
        `<label><input type="radio" name="gl-del" value="keep" checked><span><b>Fotos behalten</b><small>Sie bleiben in „Alle Fotos“ (und anderen Alben).</small></span></label>` +
        `<label class="is-danger"><input type="radio" name="gl-del" value="all"${n ? "" : " disabled"}><span><b>Fotos auch löschen</b><small>${esc(nFotos(n))} endgültig löschen – auch aus „Heute“ und dem Ort.</small></span></label>` +
      `</div>` +
      `<div class="row"><button type="button" class="btn ghost" data-c="no">Abbrechen</button><button type="button" class="btn danger" data-c="ok">Album löschen</button></div></div>`,
    onMount(el, close) {
      el.querySelector('[data-c="no"]').addEventListener("click", close);
      const ok = el.querySelector('[data-c="ok"]');
      const mode = () => (el.querySelector('input[name="gl-del"]:checked') || {}).value;
      el.addEventListener("change", () => { ok.textContent = mode() === "all" ? `Album + ${nFotos(n)} löschen` : "Album löschen"; });
      // immer bestätigen: zweiter Tipp
      let armed = false, t = 0;
      ok.addEventListener("click", async () => {
        if (!armed) { armed = true; ok.dataset.armed = "1"; ok.textContent = "Wirklich löschen?"; clearTimeout(t); t = setTimeout(() => { armed = false; delete ok.dataset.armed; el.dispatchEvent(new Event("change")); }, 4000); return; }
        clearTimeout(t);
        const withPhotos = mode() === "all";
        ui.setBusy(ok, true, "Löscht …");
        await A.deleteAlbum(a.id, { withPhotos });
        close();
        ctx.ui.toast(withPhotos ? `Album und ${nFotos(n)} gelöscht.` : "Album gelöscht – die Fotos sind noch in „Alle Fotos“.", 3200);
        if (S && S.albumId === a.id) closeAlbum();
      });
    },
  });
}

function openSettings() {
  const ctx = S.ctx;
  const set = A.settings();
  let radius = set.radius;
  sheet({
    title: "Galerie-Einstellungen",
    bodyHTML:
      `<div class="gl-sheet">` +
        `<label class="gl-switch"><input type="checkbox" data-s="auto"${set.auto ? " checked" : ""}><span><b>Fotos automatisch nach Adresse sortieren</b><small>Beim Fotografieren wird der Standort gemerkt. Bist du an einem gespeicherten Ort, kommt das Foto in dessen Album, sonst in ein Album mit der Adresse (z. B. „Hauptstraße 1, Grambach“).</small></span></label>` +
        `<div class="lbl">Umkreis für dieselbe Adresse</div>` +
        `<div class="gl-rads" role="group" aria-label="Umkreis">${G.RADIUS_CHOICES.map((r) => `<button type="button" class="gl-chip" data-rad="${r}" aria-pressed="${r === radius}">${r} m</button>`).join("")}</div>` +
        `<p class="note">Gilt für neue Adress-Alben. Bestehende Alben: im Album unter „Bearbeiten“. Adressen kommen von OpenStreetMap (Nominatim).</p>` +
        `<div class="row"><button type="button" class="btn primary" data-s="save">Speichern</button></div>` +
      `</div>`,
    onMount(el, close) {
      el.addEventListener("click", async (ev) => {
        const r = ev.target.closest("[data-rad]");
        if (r) { radius = Number(r.dataset.rad); el.querySelectorAll("[data-rad]").forEach((x) => x.setAttribute("aria-pressed", String(x === r))); return; }
        if (ev.target.closest('[data-s="save"]')) {
          try {
            await A.saveSettings({ auto: el.querySelector('[data-s="auto"]').checked, radius });
            close(); ctx.ui.toast("Gespeichert.");
            if (S) render();
          } catch (e) { console.error(e); }
        }
      });
    },
  });
}
