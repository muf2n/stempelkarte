// Update 10 – Alltag › 🕰️ Zeitleiste (#alltag/zeitleiste): chronologischer Feed deiner echten Ereignisse aus allen Bereichen
// (Arbeit, Schule, Termine, Baustellen-Tagebuch, Fahrten, Fotos, erledigte Aufgaben, Reisen, Freizeit).
// Filter-Chips je Kategorie, Tages-Überschriften, beim Runterscrollen Monat für Monat weiter zurück, Tipp → Eintrag.
// Reine Logik: js/timeline-core.js
import { collection } from "./db.js";
import * as T from "../timeline-core.js";
import * as store from "../store.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { tripsBetween } from "../travel.js";
import { fromLabel, toLabel } from "../trip-core.js";

const FILTER_KEY = "sk-tl-cats";
const COLS = ["site_log", "travel_trips", "travel_journal", "freizeit", "school_exams"]; // Update 11: + Reisetagebuch
const STEP = 18;        // so viele neue Einträge pro Nachladen (mindestens)
const MAX_EMPTY = 24;   // höchstens so viele leere Monate am Stück durchsuchen
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function injectCSS() {
  if (document.getElementById("tl-css")) return;
  const l = document.createElement("link");
  l.id = "tl-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-zeitleiste.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el, ctx) {
  injectCSS();
  let cats = new Set();
  try { const v = JSON.parse(lsGet(FILTER_KEY) || "[]"); if (Array.isArray(v)) cats = new Set(v.filter((c) => T.CAT_IDS.includes(c))); } catch { /* egal */ }
  const data = new Map();
  let photos = null;
  let months = [T.monthKeyOf(Date.now())];
  let byId = new Map();
  let tripsRaw = new Map();
  let alive = true, queued = false, io = null, busyMore = false;

  el.innerHTML = `<div class="tl">
      <div class="tl-head">
        <p class="note">Dein Leben in Stempeln, Fotos &amp; Erinnerungen ✨ – tipp auf einen Eintrag, um ihn zu öffnen.</p>
        <div class="tl-chips" role="group" aria-label="Kategorien filtern" data-tl="chips"></div>
      </div>
      <div class="tl-feed" data-tl="feed" aria-live="polite"></div>
    </div>`;
  const feed = el.querySelector('[data-tl="feed"]');
  const chipsEl = el.querySelector('[data-tl="chips"]');

  const snap = () => store.get() || {};
  function inputFor(range) {
    const s = snap();
    let trips = [];
    try {
      trips = tripsBetween(s.entries || [], range.from, range.to, s.settings || {}, s.places || []).map((t) => {
        tripsRaw.set(t.key, t);
        return { id: t.key, start: t.start, end: t.end, from: fromLabel(t), to: toLabel(t), km: t.km, private: t.private };
      });
    } catch (err) { console.warn("Zeitleiste: Fahrten", err); }
    return { now: Date.now(), entries: s.entries || [], todos: s.todos || [], places: s.places || [], photos: photos || [], trips, cols: Object.fromEntries(COLS.map((n) => [n, data.get(n) || []])) };
  }
  function allLoaded() { return photos !== null && COLS.every((n) => { try { return collection(n).loaded; } catch { return true; } }); }
  function earliestTs() { return T.earliest(inputFor({ from: 0, to: 0 })); }

  function itemsFor(mk) { return T.filterCats(T.build(inputFor(T.monthRange(mk)), T.monthRange(mk)), cats); }

  function drawChips(counts) {
    chipsEl.innerHTML = `<button type="button" class="chip tl-chip" data-cat="" aria-pressed="${!cats.size}">✨ Alles</button>` +
      T.CATS.map((c) => `<button type="button" class="chip tl-chip" data-cat="${c.id}" aria-pressed="${cats.has(c.id)}"><span aria-hidden="true">${c.e}</span> ${esc(c.t)}${counts && counts[c.id] ? ` <small>${counts[c.id]}</small>` : ""}</button>`).join("");
  }

  function itemHTML(x) {
    const thumbs = (x.thumbs || []).filter((t) => t.thumb);
    return `<li><button type="button" class="tl-item tl-${x.cat}" data-item="${esc(x.id)}">
      <span class="tl-dot" aria-hidden="true">${esc(x.emoji)}</span>
      <span class="tl-tx"><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}
        ${thumbs.length ? `<span class="tl-thumbs">${thumbs.map((t) => `<img src="${esc(t.thumb)}" alt="" loading="lazy" decoding="async">`).join("")}</span>` : ""}</span>
      <span class="tl-chev" aria-hidden="true">›</span></button></li>`;
  }

  function render() {
    if (!alive) return;
    if (!allLoaded()) { feed.innerHTML = `<div class="tl-load"><span class="tl-spin" aria-hidden="true"></span><p class="note">Ich sammle deine Erinnerungen …</p></div>`; drawChips(null); return; }
    byId = new Map();
    const counts = Object.fromEntries(T.CAT_IDS.map((c) => [c, 0]));
    let html = "", total = 0;
    for (const mk of months) {
      const all = T.build(inputFor(T.monthRange(mk)), T.monthRange(mk));
      for (const [c, n] of Object.entries(T.countByCat(all))) counts[c] += n;
      const list = T.filterCats(all, cats);
      if (!list.length) continue;
      total += list.length;
      for (const x of list) byId.set(x.id, x);
      html += `<section class="tl-month"><h3 class="tl-mh">${esc(T.monthLabel(mk))}</h3>` +
        T.groupByDay(list).map((d) => `<div class="tl-day"><h4 class="tl-dh">${esc(d.label)}</h4><ul class="tl-list">${d.items.map(itemHTML).join("")}</ul></div>`).join("") + `</section>`;
    }
    drawChips(counts);
    const first = earliestTs();
    const oldest = months[months.length - 1];
    const done = first == null || T.monthRange(oldest).from <= first;
    if (!total && done) {
      html = `<div class="tl-empty"><div class="tl-empty-ic" aria-hidden="true">🌱</div><b>${cats.size ? "Für diesen Filter gibt's noch nichts" : "Hier entsteht deine Zeitleiste"}</b><p class="note">${cats.size ? "Probier eine andere Kategorie." : "Sobald du stempelst, Fotos machst oder Aufgaben erledigst, taucht hier alles auf. 📸"}</p></div>`;
    } else if (done) html += `<p class="tl-end note">🌱 Das war's – weiter zurück gibt's nichts.</p>`;
    else html += `<div class="tl-more" data-tl="more"><span class="tl-spin" aria-hidden="true"></span> Ältere Einträge werden geladen …</div>`;
    const y = window.scrollY;
    feed.innerHTML = html;
    window.scrollTo(0, y);
    watchMore();
  }

  function loadMore() {
    if (busyMore) return;
    busyMore = true;
    const first = earliestTs();
    let added = 0, empty = 0;
    while (added < STEP && empty < MAX_EMPTY) {
      const oldest = months[months.length - 1];
      if (first == null || T.monthRange(oldest).from <= first) break;
      const mk = T.prevMonth(oldest);
      months.push(mk);
      const n = itemsFor(mk).length;
      added += n;
      empty = n ? 0 : empty + 1;
    }
    busyMore = false;
    render();
  }

  function watchMore() {
    if (io) { io.disconnect(); io = null; }
    const more = feed.querySelector('[data-tl="more"]');
    if (!more) return;
    if (typeof IntersectionObserver === "undefined") { more.addEventListener("click", loadMore); return; }
    io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); io = null; setTimeout(loadMore, 30); } }, { rootMargin: "500px 0px" });
    io.observe(more);
  }

  function schedule() { if (queued || !alive) return; queued = true; setTimeout(() => { queued = false; render(); }, 60); }

  function open(x) {
    const t = String(x.target || "");
    if (t.startsWith("entry:")) {
      const e = (snap().entries || []).find((y) => y.id === t.slice(6));
      if (e && ctx.openEntryForm) ctx.openEntryForm(e); else ui.toast("Eintrag nicht gefunden.");
    } else if (t.startsWith("todo:")) {
      const td = (snap().todos || []).find((y) => y.id === t.slice(5));
      if (td && ctx.openTodoForm) ctx.openTodoForm(td); else ui.toast("Aufgabe nicht gefunden.");
    } else if (t.startsWith("trip:")) {
      const raw = tripsRaw.get(t.slice(5));
      if (raw) import("../views/triplog.js").then((m) => m.openTripDetail(ctx, raw)).catch((err) => { console.error(err); ui.toast("Fahrt konnte nicht geöffnet werden."); });
    } else if (t.startsWith("photos:")) {
      const ids = new Set(x.photoIds || []);
      const list = (photos || []).filter((p) => ids.has(p.id)).sort((a, b) => a.ts - b.ts).map((p) => ({ ...p }));
      if (!list.length) return;
      Promise.all([import("../views/gallery.js"), import("../photos.js")])
        .then(([gal, ph]) => gal.openViewer(list, 0, ctx, { resolve: (p) => ph.getPhoto(p.id) }))
        .catch((err) => { console.error(err); ui.toast("Fotos konnten nicht geöffnet werden."); });
    } else if (t.startsWith("#")) location.hash = t;
  }

  el.addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-cat]");
    if (c && chipsEl.contains(c)) {
      const id = c.dataset.cat;
      if (!id) cats = new Set();
      else if (cats.has(id)) cats.delete(id); else cats.add(id);
      lsSet(FILTER_KEY, JSON.stringify([...cats]));
      months = [T.monthKeyOf(Date.now())];
      render();
      if (feed.querySelector('[data-tl="more"]') && !byId.size) loadMore();
      return;
    }
    const b = ev.target.closest("[data-item]");
    if (b) { const x = byId.get(b.dataset.item); if (x) open(x); }
  });

  const offs = COLS.map((n) => collection(n).watch((list) => { data.set(n, list || []); schedule(); }));
  offs.push(store.subscribe(() => schedule()));
  const loadPhotos = (refresh) => import("../photos.js").then((m) => m.listIndex(refresh ? { refresh: true } : {})).then((list) => { photos = list || []; schedule(); })
    .catch((err) => { console.warn("Zeitleiste: Fotos", err); photos = photos || []; schedule(); });
  import("../photos.js").then((m) => { const off = m.onChange(() => loadPhotos(false)); offs.push(off); }).catch(() => { /* egal */ });
  loadPhotos(true);
  render();
  return () => { alive = false; if (io) io.disconnect(); for (const o of offs) { try { if (typeof o === "function") o(); } catch { /* egal */ } } };
}
