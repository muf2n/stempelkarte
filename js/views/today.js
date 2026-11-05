// Reiter „Heute“: große Uhr, Stempel-Knöpfe, Ort-Auswahl, Notiz, Kennzahlen, heutige Einträge
// und kurze Hinweis-Kärtchen (Orts-Vorschlag, vergessenes Ausstempeln, Pausen-Erinnerung).

import { icon } from "../icons.js";
import { leaves, sparkles, emptyClipboard } from "../deco.js";
import { readPlans, plansToday, dueTs, planKey } from "./plans.js";
import { getFirebase } from "../firebase.js";
import * as motion from "../motion.js";
import * as myday from "./day.js";
import { peoplePicker, cleanPeople, peopleText, rememberPeople, privTripRow } from "./entries.js";
import { mountPhotoBar } from "./gallery.js"; // Update 9 – Fotos
import { mountTodayButton as mountMaterialBtn } from "../alltag/material.js"; // Update 9 – Material
import * as privatUi from "./privat-mode.js"; // Update 9 – Privat / Arbeit
import * as privDrive from "../privat-drive.js";
import { isPrivatNow } from "../privat.js";

// Einsatzplan-Helfer (js/einsatz.js, Agent T) – dynamisch, mit Fallback (null)
let einsatzForFn = null;
import("../einsatz.js").then((m) => {
  einsatzForFn = typeof m.einsatzFor === "function" ? m.einsatzFor : null;
  if (root && snap) { chipsKey = ""; renderPre(); }
}).catch(() => { einsatzForFn = null; });

let ctx = null;
let root = null;
let snap = null;

// Lokale Zustände
let done = null;          // beendete Schicht (Entry oder vorläufig), bis „Neue Schicht starten“
let pendingOut = false;   // Ausstempeln läuft gerade (running wird null, Entry kommt gleich)
let busyOp = null;        // "in" | "out" | "pause" | null
let btnKey = "";          // zuletzt gezeichneter Knopf-Zustand
let chipsKey = "";
let listKey = "";
let metaKey = "";
let lastLoc = null;       // zuletzt bekannter Standort (für „In der Nähe“)
let lastLocAt = 0;
/** Zuletzt gemessene Position, wenn sie frisch und genau genug ist (z. B. von der Fahrerkennung). */
function freshLoc(maxAgeMs = 20000) {
  if (!lastLoc || Date.now() - lastLocAt > maxAgeMs) return null;
  if (Number.isFinite(lastLoc.acc) && lastLoc.acc > 100) return null;
  return { ...lastLoc, ts: Date.now() };
}
let locating = false;
let lockTimer = null;
let tipsKey = "";         // zuletzt gezeichnetes Hinweis-Kärtchen
let progKey = "";
let pplPick = null;       // Personen-Auswahl vor dem Einstempeln
let pplKey = "";          // zuletzt gezeichnete gemerkte Personen
let pplTouched = "";      // dayKey, an dem der Nutzer die Personen selbst gewählt hat
let pplPrefill = "";      // zuletzt übernommene Einsatz-Vorauswahl (JSON)
let placeTouched = "";    // dayKey, an dem der Nutzer den Ort selbst gewählt hat
let photoBar = null;      // Update 9 – Kamera-Knopf (nur eingestempelt)
const dismissed = new Set(); // in dieser Sitzung ausgeblendete Vorschläge
const addrPending = new Set(); // Standorte (loc.ts), deren Adresse gerade geladen wird

const SEL_KEY = "stempelkarte.selPlace";
const ACT_KEY = "stempelkarte.activity";
const DEFAULT_ACTS = ["Arbeiten", "Autofahren", "Material holen", "Büro"];
const PAUSE_HINT_KEY = "stempelkarte.pauseHintOff";
const LOC_FRESH_MS = 10 * 60000;   // so lange gilt ein Standort als aktuell
const H = 3600000;

const $ = (r) => root.querySelector(`[data-r="${r}"]`);

function getSel() {
  try { return localStorage.getItem(SEL_KEY) || null; } catch { return null; }
}
function setSel(id) {
  try {
    if (id) localStorage.setItem(SEL_KEY, id);
    else localStorage.removeItem(SEL_KEY);
  } catch { /* egal */ }
}

function getAct() {
  try { return localStorage.getItem(ACT_KEY) || "Arbeiten"; } catch { return "Arbeiten"; }
}
function setAct(a) {
  try { localStorage.setItem(ACT_KEY, a); } catch { /* egal */ }
}
/** Einfache Ansicht (settings.comfort.compact): Tätigkeits-Chips sind ausgeblendet → Standard „Arbeiten“. */
function isCompact() {
  const c = settings().comfort;
  return !!(c && c.compact === true);
}
function clockInAct() {
  if (!isCompact()) return getAct();
  const list = activities();
  return list.includes("Arbeiten") ? "Arbeiten" : list[0];
}
function activities() {
  const a = settings().activities;
  const list = Array.isArray(a) && a.length ? a.filter((x) => typeof x === "string" && x.trim()) : DEFAULT_ACTS;
  return list.length ? list : DEFAULT_ACTS;
}
/** Abschnitte der laufenden Schicht (Fallback für alte Schichten ohne segments). */
function segs(r) {
  if (!r) return [];
  if (ctx.timer.segmentsOf) return ctx.timer.segmentsOf(r);
  if (Array.isArray(r.segments) && r.segments.length) return r.segments;
  return [{ start: r.start, activity: "Arbeiten", placeId: r.placeId ?? null, place: r.place || "", loc: r.inLoc ?? null }];
}
/** Anzeigename eines Orts: gespeicherter Ort → Name, sonst Adresse, sonst „wird ermittelt“ / „Ort unbekannt“. */
function placeLabel(name, loc) {
  if (name) return name;
  if (loc && loc.addr) return loc.addr;
  if (loc && typeof loc.lat === "number" && addrPending.has(loc.ts)) return "Standort wird ermittelt …";
  return "Ort unbekannt";
}

/* ---- Tätigkeitsfarben & „von → bis“ ---- */

/** Slug einer Tätigkeit (für data-act) nach UPDATE3-SPEC, z. B. „Material holen“ → „material-holen“. */
function actSlug(name) {
  return String(name || "Arbeiten").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
/** Einfacher String-Hash → Farbton 0–359 (eigene Tätigkeiten; CSS überschreibt die bekannten). */
function actHue(name) {
  const str = String(name || "Arbeiten");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
/** Attribute für ein Element, das eine Tätigkeit darstellt. */
function actAttrs(name) {
  return ` data-act="${ctx.util.esc(actSlug(name))}" style="--act-hue:${actHue(name)}"`;
}
function isDrive(activity) { return actSlug(activity) === "autofahren"; }

/** Luftlinie zwischen zwei Standorten als „ca. 12 km“ (oder null). */
function airDist(a, b) {
  if (!a || !b || typeof a.lat !== "number" || typeof b.lat !== "number") return null;
  let m = 0;
  try { m = ctx.geo.distanceM(a, b); } catch { return null; }
  if (!Number.isFinite(m)) return null;
  if (m < 1000) return `ca. ${Math.max(100, Math.round(m / 100) * 100)} m`;
  return `ca. ${Math.round(m / 1000)} km`;
}

/** Ortsangabe eines Abschnitts als HTML: „von A → nach B“ (+ Luftlinie, Dauer) oder nur „A“.
 *  `end` = Endzeit (ms) für die Dauer; `current` = laufender Abschnitt. */
function routeHTML(g, { current = false, end = null } = {}) {
  const { util } = ctx;
  const from = placeLabel(g.place || ((findPlace(g.placeId) || {}).name) || "", g.loc);
  if (current) {
    if (isDrive(g.activity)) return `von ${util.esc(from)} → <i>unterwegs …</i>`;
    return util.esc(from);
  }
  const hasEnd = !!(g.endLoc || g.endPlace);
  const to = hasEnd ? placeLabel(g.endPlace || "", g.endLoc) : "";
  const knownTo = g.endPlace || (g.endLoc && g.endLoc.addr) || "";
  if (!hasEnd || !(isDrive(g.activity) || (knownTo && knownTo !== from))) return util.esc(from);
  let html = `von ${util.esc(from)} → nach ${util.esc(to)}`;
  const d = airDist(g.loc, g.endLoc);
  if (d) html += ` · <span class="seg-dist">${util.esc(d)} <small>Luftlinie</small></span>`;
  if (Number.isFinite(end) && end > g.start) html += ` · <span class="seg-dur">${util.hm(Math.floor((end - g.start) / 60000))} h</span>`;
  return html;
}

function places() { return (snap && snap.places) || []; }
function settings() {
  return Object.assign({
    weeklyTarget: 38.5, autoLocate: true, defaultRadius: 150,
    workDays: [1, 2, 3, 4, 5], pauseReminder: true, holidays: true,
  }, (snap && snap.settings) || {});
}

/* ---- util-Funktionen aus Update 2 mit Fallback (falls util.js sie noch nicht hat) ---- */

function isWork(e) { return !e.kind || e.kind === "work"; }
function credit(e) {
  const u = ctx.util;
  if (u.creditMin) return u.creditMin(e);
  return isWork(e) ? u.netMin(e) : (Number(e.creditMin) || 0);
}
function kindName(k) {
  if (ctx.util.kindLabel) return ctx.util.kindLabel(k);
  return ({ urlaub: "Urlaub", krank: "Krank", feiertag: "Feiertag", zeitausgleich: "Zeitausgleich" })[k] || "Arbeit";
}
function holiday(ts) {
  if (settings().holidays === false || !ctx.util.holidayName) return null;
  try { return ctx.util.holidayName(ts) || null; } catch { return null; }
}
/** Durchschnittliches Tagessoll eines Arbeitstags (Minuten). */
function avgDayMin() {
  const s = settings();
  const wd = Array.isArray(s.workDays) && s.workDays.length ? s.workDays : [1, 2, 3, 4, 5];
  return (Number(s.weeklyTarget) || 0) * 60 / wd.length;
}
function targetMin(ts) {
  const s = settings();
  if (ctx.util.dailyTargetMin) {
    try { return ctx.util.dailyTargetMin(ts, s); } catch { /* Fallback */ }
  }
  const wd = Array.isArray(s.workDays) && s.workDays.length ? s.workDays : [1, 2, 3, 4, 5];
  if (!wd.includes(new Date(ts).getDay())) return 0;
  return avgDayMin();
}

function buzz(p) {
  try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* egal */ }
}

function pauseHintOff(start) {
  try { return localStorage.getItem(PAUSE_HINT_KEY) === String(start); } catch { return false; }
}
function setPauseHintOff(start) {
  try { localStorage.setItem(PAUSE_HINT_KEY, String(start)); } catch { /* egal */ }
}
function findPlace(id) { return id ? places().find((p) => p.id === id) || null : null; }

/** Einsatz (Einsatzplan) für heute oder null. */
function todayEinsatz() {
  if (!einsatzForFn || !snap) return null;
  try { return einsatzForFn(ctx.util.dayKey(Date.now()), snap.todos || []) || null; } catch { return null; }
}
/** Ort-Auswahl: eigene Wahl von heute hat Vorrang, sonst Ort aus dem Einsatzplan, sonst gemerkte Wahl. */
function effSel() {
  const today = ctx.util.dayKey(Date.now());
  if (placeTouched !== today) {
    const ez = todayEinsatz();
    if (ez && ez.placeId && findPlace(ez.placeId)) return ez.placeId;
  }
  return getSel();
}

/** Gewählter Ort, nur wenn er noch existiert. */
function selPlace() { return findPlace(effSel()); }

/** Beendete Schicht: aktuelle Version aus dem Store bevorzugen (z. B. mit nachgetragener Adresse). */
function doneEntry() {
  if (!done) return null;
  if (done.id && snap) {
    const e = snap.entries.find((x) => x.id === done.id);
    if (e) return e;
  }
  return done;
}

function state() {
  const r = snap && snap.running;
  if (r) return r.pauseStart ? "paused" : "running";
  if (done) return "done";
  return "idle";
}

function lockNow() {
  ctx.timer.lock();
  clearTimeout(lockTimer);
  const ms = Number(ctx.timer.TAP_LOCK_MS) || 1500;
  lockTimer = setTimeout(() => {
    renderButtons();
    if (!busyOp && root) $("tips").querySelectorAll("button[data-act]").forEach((b) => { b.disabled = false; });
  }, ms + 40);
  // Knöpfe sofort sperren, ohne sie zu ersetzen (der getippte Knopf zeigt evtl. gleich „Standort …“)
  if (root) {
    $("btns").querySelectorAll("button").forEach((b) => { b.disabled = true; });
    $("tips").querySelectorAll("button[data-act]").forEach((b) => { b.disabled = true; });
  }
}

/* ---------------- Markup ---------------- */

export function mount(el, c) {
  ctx = c;
  root = el;
  el.innerHTML = `
<div class="stack">
  <section data-r="privat"></section>
  <section data-r="myday"></section>
  <div class="card clock" data-r="clock">
    <div class="clock-deco" aria-hidden="true">${sparkles()}${leaves("left")}${leaves("right")}</div>
    <span class="pill" data-r="pill">Nicht eingestempelt</span>
    <div class="hol-today" data-r="hol" hidden></div>
    <div class="big" data-r="big">0:00:00</div>
    <div class="dayprog" data-r="prog">
      <div class="progress" data-r="progwrap"><div data-r="progbar" style="width:0%"></div></div>
      <span data-r="progtxt"></span>
    </div>
    <div class="seg-now" data-r="segnow" hidden></div>
    <div class="meta" data-r="meta"></div>
    <div class="meta" data-r="locline" hidden></div>
    <ol class="seg-list" data-r="seglist" hidden></ol>
    <div class="meta ppl-note" data-r="pplnote" hidden></div>
    <div class="edit-links"><button type="button" class="linkbtn" data-r="editnote" hidden>Notiz &amp; Personen ändern</button><button type="button" class="linkbtn" data-r="editstart" hidden>Beginn ändern</button>
    <button type="button" class="linkbtn" data-r="editend" hidden>Ausstempeln um …</button></div>
  </div>
  <div class="stack" data-r="tips" hidden></div>
  <div class="row" data-r="btns"></div>
  <div data-r="photo" hidden></div>
  <div class="stack" data-r="pre">
    <div class="lbl lbl-ico">${icon("briefcase", 20)}<span>Tätigkeit</span></div>
    <div class="chips" data-r="acts"></div>
    <div class="lbl lbl-ico">${icon("pin", 20)}<span>Arbeitsort</span></div>
    <div class="hint" data-r="near" hidden></div>
    <div class="hint ez-hint" data-r="ezhint" hidden></div>
    <div class="chips" data-r="chips"></div>
    <div class="lbl lbl-ico">${icon("user", 20)}<span>Mit wem?</span></div>
    <div data-r="ppl"></div>
    <div class="fields">
      <label class="note-field"><span class="lbl-ico lbl-note">${icon("note", 20)}<span>Notiz (optional)</span></span>
        <span class="input-ico">${icon("pencil", 20)}<input type="text" data-r="note" maxlength="300" placeholder="z. B. Aufgabe, Kunde …" autocomplete="off"></span>
      </label>
    </div>
  </div>
  <div class="stats" data-r="stats">
    <div class="stat stat-ico">${icon("calendar", 24)}<span>Heute</span><strong data-r="s-day">0:00</strong></div>
    <div class="stat stat-ico">${icon("chart", 24)}<span>Woche</span><strong data-r="s-week">0:00</strong></div>
    <div class="stat stat-ico">${icon("pie", 24)}<span>Monat</span><strong data-r="s-month">0:00</strong></div>
  </div>
  <div class="card today-list" data-r="todaycard">
    <div class="section-h">
      <h2 class="h-ico">${icon("list", 24)}<span>Heute erfasst</span></h2>
      <button type="button" class="btn sm ghost" data-r="add">${icon("plus", 18)}<span>Nachtragen</span></button>
    </div>
    <div class="stack" data-r="list"></div>
  </div>
</div>`;

  try { myday.mount($("myday"), ctx); } catch (e) { console.error(e); }
  try { // Update 9 – Privat / Arbeit
    privatUi.mount($("privat"), ctx, {
      clockOutNow: () => clockOutAt(Date.now()),
      startWork: (place) => doClockIn(null, place),
    });
  } catch (e) { console.error(e); }
  try { photoBar = mountPhotoBar($("photo"), ctx); } catch (e) { console.error(e); }
  try { mountMaterialBtn($("photo")); } catch (e) { console.error(e); } // Update 9 – Material neben dem Foto-Knopf
  $("btns").addEventListener("click", onButton);
  $("chips").addEventListener("click", onChip);
  $("acts").addEventListener("click", onActChip);
  $("list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button.entry");
    if (!b || !snap) return;
    const e = snap.entries.find((x) => x.id === b.dataset.id);
    if (e) ctx.openEntryForm(e);
  });
  $("add").addEventListener("click", () => ctx.openEntryForm(null));
  $("tips").addEventListener("click", onTip);
  $("editstart").addEventListener("click", openStartSheet);
  $("editend").addEventListener("click", openEndSheet);
  $("editnote").addEventListener("click", openNoteEditSheet);
  pplPick = peoplePicker($("ppl"), ctx, {
    selected: [],
    onChange: () => { pplTouched = ctx.util.dayKey(Date.now()); },
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && root && !root.hidden) refreshNear();
    try { driveWatchTick(); } catch (e) { console.error(e); }
  });

  if (ctx.store && ctx.store.get) {
    try { snap = ctx.store.get(); } catch { snap = null; }
  }
  if (snap) update(snap);
  else renderButtons();
}

/* ---------------- Store-Update ---------------- */

export function update(s) {
  snap = s;
  if (!root) return;
  try { myday.update(s); } catch (e) { console.error(e); }
  try { privatUi.update(s); } catch (e) { console.error(e); }
  try { if (photoBar) photoBar.update(s); } catch (e) { console.error(e); }
  if (s.running) {
    done = null;              // neue/andere Schicht läuft
  }
  renderAll();
}

function renderAll() {
  renderClock();
  renderTips();
  renderButtons();
  renderPre();
  renderList();
  renderStats();
}

/* ---------------- Uhr ---------------- */

function renderClock() {
  const { util, geo, geofence, timer } = ctx;
  const st = state();
  const card = $("clock");
  card.classList.toggle("running", st === "running");
  card.classList.toggle("paused", st === "paused");
  card.classList.toggle("done", st === "done");
  {
    const rr = snap && snap.running;
    const ca = rr ? segs(rr)[segs(rr).length - 1].activity || "Arbeiten" : "";
    const slug = ca ? actSlug(ca) : "";
    if ((card.dataset.act || "") !== slug) {
      if (slug) {
        card.dataset.act = slug;
        card.style.setProperty("--act-hue", String(actHue(ca)));
      } else {
        delete card.dataset.act;
        card.style.removeProperty("--act-hue");
      }
    }
  }

  const r = snap && snap.running;
  const e = st === "done" ? doneEntry() : null;
  const pill = $("pill");

  let metaHTML = "";
  let loc = null;
  let placeObj = null;
  let placeName = "";

  if (st === "idle") {
    const priv = isPrivatNow(snap); // Update 9 – Privat
    pill.textContent = priv ? "Privat-Modus" : "Nicht eingestempelt";
    metaHTML = priv ? `<span>Nichts zählt als Arbeit. Zum Arbeiten oben auf „Arbeit“ tippen oder einstempeln.</span>`
      : `<span>Tippe auf „Einstempeln“, wenn du anfängst.</span>`;
  } else if (st === "running" || st === "paused") {
    pill.textContent = st === "paused" ? `Pause seit ${util.clock(r.pauseStart)}` : "Bei der Arbeit";
    // Ort/Standort des aktuellen Abschnitts
    const cur = segs(r)[segs(r).length - 1];
    placeObj = findPlace(cur.placeId);
    placeName = placeLabel(cur.place || (placeObj && placeObj.name) || "", cur.loc);
    loc = cur.loc;
    const pm = timer.pauseMsNow(r);
    metaHTML = `<span>Schicht seit <b>${util.clock(r.start)}</b></span>` +
      `<span>Pause <b data-r="pause">${util.hm(Math.floor(pm / 60000))}</b></span>`;
  } else {
    pill.textContent = `Ausgestempelt um ${util.clock(e.end)}`;
    placeObj = findPlace(e.placeId);
    placeName = placeLabel(e.place || (placeObj && placeObj.name) || "", e.inLoc);
    loc = e.inLoc;
    metaHTML = `<span><b>${util.clock(e.start)} – ${util.clock(e.end)}</b></span>` +
      `<span>Pause <b>${util.hm(e.pauseMin || 0)}</b></span>`;
  }

  if (placeName) {
    const url = placeObj ? geo.placeMapsUrl(placeObj) : null;
    metaHTML += `<span><b>${util.esc(placeName)}</b>` +
      (url ? ` <a href="${util.esc(url)}" target="_blank" rel="noopener">Karte</a>` : "") + `</span>`;
  }

  let locHTML = "";
  if (loc && typeof loc.lat === "number") {
    let desc = "";
    try {
      const m = geofence.matchPlace(loc, places(), settings().defaultRadius);
      desc = m ? geofence.describe(loc, m) : "";
    } catch { desc = ""; }
    const parts = [];
    if (desc) parts.push(util.esc(desc));
    if (loc.addr && loc.addr !== placeName) parts.push(util.esc(loc.addr));
    locHTML = (parts.length ? `<span>${parts.join(" · ")}</span> ` : "") +
      `<a href="${util.esc(geo.mapsUrl(loc.lat, loc.lng))}" target="_blank" rel="noopener">Auf Karte zeigen</a>`;
  }

  // Nur neu schreiben, wenn sich etwas geändert hat (Links bleiben tippbar)
  // Aktueller Abschnitt + Abschnittsliste (nur während der Schicht)
  let segHTML = "", listHTML = "";
  if (r) {
    const ss = segs(r);
    const cur = ss[ss.length - 1];
    segHTML = `<b${actAttrs(cur.activity)}>${util.esc(cur.activity || "Arbeiten")}</b>` +
      `<span>seit ${util.clock(cur.start)} · <span data-r="segdur">0:00</span> h</span>`;
    if (isDrive(cur.activity)) segHTML += `<span class="seg-route">${routeHTML(cur, { current: true })}</span>`;
    if (ss.length > 1) {
      listHTML = ss.map((g, i) => {
        const last = i + 1 === ss.length;
        const route = routeHTML(g, { current: last, end: last ? null : ss[i + 1].start });
        return `<li${actAttrs(g.activity)}><b>${util.clock(g.start)}</b> ` +
          `<span class="seg-act">${util.esc(g.activity || "Arbeiten")}</span> – <span class="seg-route">${route}</span>` +
          `<button type="button" class="seg-del" data-segdel="${i}" aria-label="Abschnitt ${util.esc(g.activity || "Arbeiten")} um ${util.clock(g.start)} löschen">${segDelIcon()}</button></li>`;
      }).join("");
    }
  }

  // „mit Max, Anna · Notiz: …“ (laufende bzw. beendete Schicht)
  let pnHTML = "";
  {
    const src = r || e;
    if (src) {
      const bits = [];
      const pt = peopleText(src.people);
      if (pt) bits.push(`<span>${util.esc(pt)}</span>`);
      if (src.note) bits.push(`<span>Notiz: ${util.esc(src.note)}</span>`);
      pnHTML = bits.join("");
    }
  }
  const key = metaHTML + "|" + locHTML + "|" + segHTML + "|" + listHTML + "|" + pnHTML;
  if (key !== metaKey) {
    metaKey = key;
    const sn = $("segnow");
    sn.innerHTML = segHTML;
    sn.hidden = !segHTML;
    if (r) {
      const ca = segs(r)[segs(r).length - 1].activity || "Arbeiten";
      sn.dataset.act = actSlug(ca);
      sn.style.setProperty("--act-hue", String(actHue(ca)));
    } else {
      delete sn.dataset.act;
      sn.style.removeProperty("--act-hue");
    }
    const sl = $("seglist");
    sl.innerHTML = listHTML;
    sl.hidden = !listHTML;
    sl.querySelectorAll("[data-segdel]").forEach((b) => b.addEventListener("click", () => askRemoveSegment(Number(b.dataset.segdel))));
    $("meta").innerHTML = metaHTML;
    const pn = $("pplnote");
    pn.innerHTML = pnHTML;
    pn.hidden = !pnHTML;
    const ll = $("locline");
    ll.innerHTML = locHTML;
    ll.hidden = !locHTML;
  }
  const es = $("editstart");
  const showEdit = st === "running" || st === "paused";
  if (es.hidden === showEdit) es.hidden = !showEdit;
  const ee = $("editend");
  if (ee && ee.hidden === showEdit) ee.hidden = !showEdit;
  const en = $("editnote");
  if (en && en.hidden === showEdit) en.hidden = !showEdit;
  updateClockText();
}

/** Nur Textinhalte: große Zeit und Pausenzeit. */
function updateClockText() {
  const { util, timer } = ctx;
  const st = state();
  const r = snap && snap.running;
  let ms = 0;
  if (st === "running" || st === "paused") {
    ms = timer.netMs(r);        // während Pause eingefroren
    const p = $("pause");
    if (p) p.textContent = util.hm(Math.floor(timer.pauseMsNow(r) / 60000));
    const sd = $("segdur");
    if (sd) {
      const ss = segs(r);
      const v = util.hm(Math.floor(Math.max(0, Date.now() - ss[ss.length - 1].start) / 60000));
      if (sd.textContent !== v) sd.textContent = v;
    }
  } else if (st === "done") {
    const e = doneEntry();
    ms = e ? util.netMin(e) * 60000 : 0;
  }
  const t = util.hms(ms);
  const big = $("big");
  if (big.textContent !== t) big.textContent = t;
  renderProgress();
}

/** Dünner Tagesfortschritt unter der Uhr: „heute x von y h“ bzw. „Heute frei“. */
function renderProgress() {
  const { util } = ctx;
  const now = Date.now();
  const target = Math.round(targetMin(now));
  const doneMin = Math.floor(sumSince(util.startOfDay(now).getTime()));
  let txt, pct = 0, free = false;
  renderHoliday(now);
  if (target <= 0) {
    free = true;
    let school = null;
    try { school = util.schoolLabel ? util.schoolLabel(now, settings()) : null; } catch { school = null; }
    txt = school ? `Heute ${school} – zählt als Arbeitszeit` : "Heute frei"; // Feiertagsname steht im Hinweis darüber
    if (doneMin > 0) txt += ` · ${util.hm(doneMin)} h erfasst`;
  } else {
    txt = `heute ${util.hm(doneMin)} von ${util.hm(target)} h`;
    pct = Math.min(100, Math.round((doneMin / target) * 1000) / 10);
  }
  const key = txt + "|" + pct;
  if (key === progKey) return;
  progKey = key;
  $("progtxt").textContent = txt;
  $("progwrap").hidden = free;
  $("progbar").style.width = pct + "%";
  $("prog").classList.toggle("full", pct >= 100);
}

/** Feiertags-Hinweis in der Uhr-Karte: heute Feiertag oder nächster in ≤ 7 Tagen (nur Anzeige). */
let holKey = null;
function renderHoliday(now) {
  const { util } = ctx;
  const el = $("hol");
  if (!el) return;
  let html = "", mode = "";
  const h = holiday(now);
  if (h) {
    mode = "today";
    html = `${icon("calendar", 20)}<span>Heute ist <b>${util.esc(h)}</b> – arbeitsfrei</span>`;
  } else if (settings().holidays !== false && util.upcomingHolidays) {
    let next = null;
    try { next = util.upcomingHolidays(now, 1)[0] || null; } catch { next = null; }
    const days = next ? Math.round((next.ts - util.startOfDay(now).getTime()) / 86400000) : 99;
    if (next && days <= 7) {
      const d = new Date(next.ts);
      mode = "next";
      html = `${icon("calendar", 16)}<span>Nächster Feiertag: <b>${util.WD[d.getDay()]}, ${util.pad(d.getDate())}.${util.pad(d.getMonth() + 1)}.</b> – ${util.esc(next.name)}</span>`;
    }
  }
  const key = mode + "|" + html;
  if (key === holKey) return;
  holKey = key;
  el.innerHTML = html;
  el.className = "hol-today" + (mode ? " hol-is-" + mode : "");
  el.hidden = !html;
  $("clock").classList.toggle("is-holiday", mode === "today");
}

/* ---------------- Hinweis-Kärtchen ---------------- */

function locFresh(minTs = 0) {
  return lastLoc && Date.now() - lastLocAt < LOC_FRESH_MS && lastLocAt > minTs;
}

/** Läuft die Schicht verdächtig lange (> 12 h oder seit einem früheren Tag)? */
function isForgotten(r, now = Date.now()) {
  if (!r) return false;
  return now - r.start > 12 * H || ctx.util.dayKey(r.start) !== ctx.util.dayKey(now);
}

/** Welches Kärtchen gilt gerade? Höchstens eines, nach Wichtigkeit. */
function currentTip() {
  const { geo } = ctx;
  const st = state();
  const r = snap && snap.running;
  const set = settings();
  if (r) {
    if (isForgotten(r)) return { kind: "forgot", id: "forgot|" + r.start };
    // Weg vom Ort der laufenden Schicht?
    const ss = segs(r);
    const curSeg = ss[ss.length - 1];
    // Fahrerkennung (Update 6): Fahrt erkannt / angekommen
    if (driveTip && r.pauseStart == null && driveTip.seg === curSeg.start && !dismissed.has(driveTip.id)) return driveTip;
    const p = isDrive(curSeg.activity) ? null : findPlace(curSeg.placeId);
    if (p && typeof p.lat === "number" && typeof p.lng === "number" && locFresh(curSeg.start)) {
      const rad = Number(p.radius) > 0 ? Number(p.radius) : set.defaultRadius;
      let d = 0;
      try { d = geo.distanceM(lastLoc, p); } catch { d = 0; }
      const id = "away|" + curSeg.start + "|" + p.id;
      if (d > rad + 200 && !dismissed.has(id)) return { kind: "away", id, place: p };
    }
    if (set.pauseReminder !== false && !r.pauseStart && !(Number(r.pauseMs) > 0) &&
        ctx.timer.netMs(r) > 6 * H && !pauseHintOff(r.start)) {
      return { kind: "pause", id: "pause|" + r.start };
    }
    return null;
  }
  if (st === "idle" || st === "done") {
    if (isPrivatNow(snap)) return null; // Update 9 – Privat: keine Einstempel-Vorschläge
    // Direkt nach dem Ausstempeln nicht gleich wieder zum Einstempeln drängen
    const e = st === "done" ? doneEntry() : null;
    if (e && Date.now() - e.end < 15 * 60000) return null;
    if (!locFresh(e ? e.end : 0)) return null;
    const early = earlyPlanTip();
    if (early) return early;
    const m = nearMatch();
    if (!m) return null;
    const id = "here|" + m.place.id;
    if (dismissed.has(id)) return null;
    return { kind: "here", id, place: m.place };
  }
  return null;
}

/** Vorschlag fürs „Ende um“-Feld: Beginn + Tagessoll + Pause, höchstens 23:59 des Starttags, nicht in der Zukunft. */
function suggestEnd(r) {
  const tgt = targetMin(r.start) || avgDayMin() || 462;
  let end = r.start + tgt * 60000 + (Number(r.pauseMs) || 0);
  const eod = new Date(r.start); eod.setHours(23, 59, 0, 0);
  end = Math.min(end, eod.getTime(), Date.now());
  if (end <= r.start) end = Math.min(eod.getTime(), Date.now());
  return end;
}

function closeX() {
  return `<button type="button" class="tip-x" data-act="tip-close" aria-label="Hinweis ausblenden">✕</button>`;
}

function renderTips() {
  const { util } = ctx;
  const box = $("tips");
  const tip = busyOp ? null : currentTip();
  if (busyOp) return;                 // während Stempelvorgang nichts umbauen
  const key = tip ? tip.id : "";
  if (key === tipsKey) return;
  tipsKey = key;
  if (!tip) {
    box.innerHTML = "";
    box.hidden = true;
    return;
  }
  const r = snap && snap.running;
  const dis = ctx.timer.isLocked() ? " disabled" : "";
  let html = "";
  if (tip.kind === "here") {
    html = `<div class="card tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">Du bist bei <b>${util.esc(tip.place.name)}</b>. Jetzt einstempeln?</p>` +
      `<button type="button" class="btn go" data-act="tip-in" data-place="${util.esc(tip.place.id)}"${dis}>Hier einstempeln</button></div>`;
  } else if (tip.kind === "plan-early") {
    html = `<div class="card tip plan-tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">Du bist schon bei <b>${util.esc(tip.place.name)}</b> – jetzt einstempeln?</p>` +
      `<p class="note">Geplant um ${util.esc(tip.plan.time)} · ${util.esc(tip.plan.activity || "Arbeiten")}. Sonst stempelt die App dich um ${util.esc(tip.plan.time)} automatisch ein.</p>` +
      `<button type="button" class="btn go" data-act="tip-plan-in" data-plan="${util.esc(tip.plan.id)}"${dis}>Jetzt einstempeln</button></div>`;
  } else if (tip.kind === "away") {
    html = `<div class="card tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">Du bist nicht mehr bei <b>${util.esc(tip.place.name)}</b>. Ausstempeln?</p>` +
      `<button type="button" class="btn stop" data-act="tip-out"${dis}>Jetzt ausstempeln</button></div>`;
  } else if (tip.kind === "forgot") {
    const end = suggestEnd(r);
    const sameDay = util.dayKey(r.start) === util.dayKey(Date.now());
    const since = sameDay ? `heute ${util.clock(r.start)}` : `${util.fmtDate(r.start)}, ${util.clock(r.start)}`;
    html = `<div class="card tip warn" data-id="${util.esc(tip.id)}">` +
      `<p class="tip-t"><b>Hast du vergessen auszustempeln?</b></p>` +
      `<p class="note">Deine Schicht läuft seit ${util.esc(since)}.</p>` +
      `<div class="fields"><label>Ende um` +
      `<input type="time" data-r="fend" value="${util.clock(end)}" required></label></div>` +
      `<button type="button" class="btn stop" data-act="tip-forgot"${dis}>Mit dieser Endzeit ausstempeln</button></div>`;
  } else if (tip.kind === "drive-ask") {
    html = `<div class="card tip drive-tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">${icon("car", 22)} Du fährst gerade – zu <b>Autofahren</b> wechseln?</p>` +
      `<button type="button" class="btn go" data-act="tip-drive"${dis}>${icon("car", 20)}<span>Zu Autofahren wechseln</span></button></div>`;
  } else if (tip.kind === "arrive") {
    const where = tip.place ? tip.place.name : (tip.loc && tip.loc.addr) || "";
    html = `<div class="card tip drive-tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">${where ? `Angekommen bei <b>${util.esc(where)}</b>?` : "Angekommen?"}</p>` +
      `<button type="button" class="btn go drive-big" data-act="tip-arrive"${dis}>${icon("play", 20)}<span>Weiter mit ${util.esc(tip.act)}</span></button></div>`;
  } else if (tip.kind === "pause") {
    html = `<div class="card tip" data-id="${util.esc(tip.id)}">${closeX()}` +
      `<p class="tip-t">Nach 6 Stunden steht dir eine Pause von 30 Minuten zu.</p></div>`;
  }
  box.innerHTML = html;
  box.hidden = false;
}

function onTip(ev) {
  const btn = ev.target.closest("button[data-act]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  if (act === "tip-close") {
    const card = btn.closest(".tip");
    const id = card ? card.dataset.id : "";
    if (id.startsWith("pause|")) setPauseHintOff(id.slice(6));
    else if (id) dismissed.add(id);
    tipsKey = "";
    renderTips();
    return;
  }
  if (busyOp || ctx.timer.isLocked()) return;
  if (act === "tip-in") {
    const p = findPlace(btn.dataset.place);
    doClockIn(btn, p);
  } else if (act === "tip-plan-in") {
    const plan = readPlans(settings()).find((p) => p.id === btn.dataset.plan);
    if (!plan) return;
    const p = findPlace(plan.placeId);
    doClockIn(btn, p, {
      activity: plan.activity || "Arbeiten",
      inLoc: lastLoc && Date.now() - lastLocAt < 120000 ? lastLoc : null,
      planKey: planKey(plan.id, Date.now()),
    });
  } else if (act === "tip-out") {
    doClockOut(btn);
  } else if (act === "tip-forgot") {
    doForgotOut(btn);
  } else if (act === "tip-drive" && driveTip && driveTip.kind === "drive-ask") {
    const t = driveTip;
    driveTip = null;
    driveSwitch("Autofahren", { loc: t.loc, start: t.start });
  } else if (act === "tip-arrive" && driveTip && driveTip.kind === "arrive") {
    const t = driveTip;
    driveTip = null;
    driveSwitch(t.act, { place: t.place, loc: t.loc });
  }
}

/** Vergessene Schicht mit gewählter Endzeit abschließen (Reihenfolge wie timer.clockOut). */
async function doForgotOut(btn) {
  const { store, ui, util } = ctx;
  const r = store.get().running;
  if (!r) return;
  const inp = $("fend");
  const v = (inp && inp.value) || "";
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) { ui.toast("Bitte eine Endzeit eingeben."); return; }
  const d = new Date(r.start);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const end = d.getTime();
  if (end <= r.start) { ui.toast(`Das Ende muss nach dem Beginn (${util.clock(r.start)}) liegen.`, 3500); return; }
  if (end > Date.now()) { ui.toast("Das Ende darf nicht in der Zukunft liegen.", 3500); return; }
  await clockOutAt(end, btn);
}

/** Schicht mit einer bestimmten Endzeit abschließen (Ausstempeln um …, Plan-Ende, vergessen). */
export async function clockOutAt(end, btn = null) {
  const { store, ui, util } = ctx;
  const r = store.get().running;
  if (!r) return;
  end = Math.min(end, Date.now());
  if (end <= r.start) { ui.toast(`Das Ende muss nach dem Beginn (${util.clock(r.start)}) liegen.`, 3500); return; }
  lockNow();
  busyOp = "out";
  disableAllButtons();
  if (btn) ui.setBusy(btn, true, "Wird gespeichert …");
  const pauseMs = (Number(r.pauseMs) || 0) + (r.pauseStart != null && end > r.pauseStart ? end - r.pauseStart : 0);
  done = {
    id: null, start: r.start, end,
    pauseMin: Math.round(pauseMs / 60000),
    placeId: r.placeId ?? null, place: r.place || "", note: r.note || "",
    people: cleanPeople(r.people),
    inLoc: r.inLoc ?? null, outLoc: null,
  };
  pendingOut = true;
  let saved = false;
  try {
    // timer.clockOut: erst Uhr stoppen (setRunning(null)), dann Eintrag mit dieser Endzeit speichern
    const entry = await ctx.timer.clockOut({ outLoc: null, end });
    if (entry) done = entry;
    saved = true;
    buzz([40, 60, 40]);
    ui.toast(`Ausgestempelt um ${util.clock(end)} · ${util.hm(util.netMin(done))} h`, 3000);
  } catch (e) {
    ui.toast("Ausstempeln fehlgeschlagen" + (e && e.message ? ": " + e.message : ""), 3500);
    done = null;
  } finally {
    pendingOut = false;
    busyOp = null;
    try { if (btn) ui.setBusy(btn, false); } catch { /* egal */ }
    snap = store.get() || snap;
    if (snap.running) done = null;
    if (!saved) done = null;
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
  if (saved && done && done.id) askNoteAfterOut(done.id);
}

/* ---------------- Beginn ändern ---------------- */

function openStartSheet() {
  const { ui, util, store } = ctx;
  const r0 = snap && snap.running;
  if (!r0) return;
  const sameDay = util.dayKey(r0.start) === util.dayKey(Date.now());
  const dayTxt = sameDay ? "heute" : util.fmtDate(r0.start);
  ui.openSheet({
    title: "Beginn ändern",
    bodyHTML:
      `<div class="fields">` +
      `<p class="note">Wann hast du ${util.esc(dayTxt)} angefangen?</p>` +
      `<label>Beginn um<input type="time" data-f="t" value="${util.clock(r0.start)}" required></label>` +
      `<button type="button" class="btn primary" data-f="save">Speichern</button>` +
      `</div>`,
    onMount(el, close) {
      el.querySelector('[data-f="save"]').addEventListener("click", async () => {
        const r = store.get().running;
        if (!r) { close(); return; }
        const v = el.querySelector('[data-f="t"]').value || "";
        const m = /^(\d{1,2}):(\d{2})/.exec(v);
        if (!m) { ui.toast("Bitte eine Uhrzeit eingeben."); return; }
        const d = new Date(r.start);
        d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        const ns = d.getTime();
        const now = Date.now();
        if (ns > now) { ui.toast("Der Beginn darf nicht in der Zukunft liegen.", 3500); return; }
        if (r.pauseStart != null && ns >= r.pauseStart) {
          ui.toast(`Der Beginn muss vor deiner Pause (${util.clock(r.pauseStart)}) liegen.`, 3500); return;
        }
        if (ns + (Number(r.pauseMs) || 0) > (r.pauseStart ?? now)) {
          ui.toast("So früh passt das nicht zu deinen Pausen.", 3500); return;
        }
        if (ns === r.start) { close(); return; }
        try {
          await store.setRunning({ ...r, start: ns });
          ui.toast(`Beginn auf ${util.clock(ns)} geändert`);
          close();
        } catch { /* Toast kommt vom Store */ }
        snap = store.get() || snap;
        metaKey = "";
        renderAll();
      });
    },
  });
}

/* ---------------- Knöpfe ---------------- */

function renderButtons() {
  if (!root || !ctx) return;
  if (busyOp) return;                 // Knopf zeigt gerade „Standort wird ermittelt …“
  const st = state();
  const locked = ctx.timer.isLocked();
  const key = st + "|" + (locked ? 1 : 0);
  if (key === btnKey) return;
  btnKey = key;
  const dis = locked ? " disabled" : "";
  let html = "";
  if (st === "idle") {
    html = `<button type="button" class="btn go" data-act="in"${dis}>${icon("play", 22)}<span>Einstempeln</span></button>`;
  } else if (st === "done") {
    html = `<button type="button" class="btn go" data-act="in"${dis}>${icon("play", 22)}<span>Neue Schicht starten</span></button>`;
  } else {
    html = `<button type="button" class="btn pause" data-act="pause"${dis}>${icon(st === "paused" ? "play" : "pause", 20)}<span>${st === "paused" ? "Pause beenden" : "Pause"}</span></button>` +
      `<button type="button" class="btn stop" data-act="out"${dis}>${icon("stop", 20)}<span>Ausstempeln</span></button>` +
      `<button type="button" class="btn ghost seg-btn" data-act="seg"${dis}>${icon("swap", 20)}<span>Abschnitt wechseln</span></button>`;
  }
  $("btns").innerHTML = html;
}

function forceButtons() {
  btnKey = "";
  renderButtons();
}

function disableAllButtons() {
  $("btns").querySelectorAll("button").forEach((b) => { b.disabled = true; });
}

function onButton(ev) {
  const btn = ev.target.closest("button[data-act]");
  if (!btn || btn.disabled) return;
  if (busyOp || ctx.timer.isLocked()) return;
  const act = btn.dataset.act;
  if (act === "in") doClockIn(btn);
  else if (act === "out") doClockOut(btn);
  else if (act === "pause") doPause();
  else if (act === "seg") openSegSheet();
}

function errText(e) {
  return (e && e.message) ? e.message : "Standort nicht verfügbar";
}

/** opts (geplante Schichten): { activity, inLoc, start, msg, planKey } – ohne opts unverändertes Verhalten. */
async function doClockIn(btn, forcedPlace = null, opts = null) {
  const { store, timer, geo, geofence, ui } = ctx;
  if (snap && snap.running) return;
  lockNow();
  busyOp = "in";
  disableAllButtons();
  const set = settings();
  let inLoc = null;
  try {
    if (opts && opts.inLoc) {
      inLoc = opts.inLoc;       // Standort wurde schon für den Plan geholt
    } else if (set.autoLocate && forcedPlace && lastLoc && Date.now() - lastLocAt < 120000) {
      inLoc = lastLoc;          // frischer Standort vom Vorschlag – nicht nochmal warten
    } else if (set.autoLocate) {
      ui.setBusy(btn, true, "Standort wird ermittelt …");
      try {
        inLoc = await geo.getPosition({ timeout: 10000, maxAge: 5000 });
        lastLoc = inLoc; lastLocAt = Date.now();
      } catch (e) {
        ui.toast("Ohne Standort eingestempelt: " + errText(e), 3500);
      }
    }
    // Ort: Auswahl des Nutzers hat Vorrang, sonst automatisch per Geofence
    let place = forcedPlace || selPlace();
    if (!place && inLoc) {
      try {
        const m = geofence.matchPlace(inLoc, places(), set.defaultRadius);
        if (m) place = m.place;
      } catch { /* ohne Ort */ }
    }
    const noteEl = $("note");
    const note = (noteEl.value || "").trim();
    const people = currentPeople();
    try {
      await timer.clockIn({
        placeId: place ? place.id : null,
        place: place ? place.name : "",
        note,
        people,
        inLoc,
        activity: (opts && opts.activity) || clockInAct(),
      });
      // Geplante Schicht: Beginn auf die Planzeit zurücksetzen (nur wenn noch dieselbe Schicht)
      if (opts && Number.isFinite(opts.start)) {
        const r = store.get().running;
        if (r && opts.start < r.start) {
          const sg = Array.isArray(r.segments) && r.segments.length
            ? [{ ...r.segments[0], start: opts.start }, ...r.segments.slice(1)] : r.segments;
          await store.setRunning({ ...r, start: opts.start, segments: sg });
        }
      }
      if (opts && opts.planKey) markPlanDone(opts.planKey);
      noteEl.value = "";
      if (people.length) rememberPeople(store, people);
      pplTouched = ""; pplPrefill = "";
      done = null;
      if (opts && opts.msg) {
        buzz([60, 80, 60]);
        ui.toast(opts.msg(place), 4500);
      } else {
        buzz(40);
        ui.toast(place ? `Eingestempelt · ${place.name}` : (inLoc ? "Eingestempelt · Adresse wird ermittelt …" : "Eingestempelt · Ort unbekannt"));
      }
    } catch (e) {
      ui.toast("Einstempeln fehlgeschlagen" + (e && e.message ? ": " + e.message : ""), 3500);
      inLoc = null;
    }
  } finally {
    busyOp = null;
    try { ui.setBusy(btn, false); } catch { /* Knopf evtl. schon ersetzt */ }
    snap = store.get() || snap;
    if (snap.running) done = null;
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
  if (inLoc && !inLoc.addr) fillRunningAddr(inLoc);
}

/** Adresse holen; solange zeigt die Uhr „Standort wird ermittelt …“. Nie werfen. */
async function lookupAddr(loc) {
  if (!loc || typeof loc.lat !== "number") return null;
  if (loc.addr) return loc.addr;
  addrPending.add(loc.ts);
  metaKey = "";
  if (root) renderClock();
  let addr = null;
  try { addr = await ctx.geo.reverseGeocode(loc.lat, loc.lng); } catch { addr = null; }
  addrPending.delete(loc.ts);
  metaKey = "";
  if (root) renderClock();
  return addr || null;
}

/** Adresse der laufenden Schicht nachträglich ergänzen – nur wenn es noch dieselbe Schicht ist. */
async function fillRunningAddr(inLoc) {
  const { store } = ctx;
  const r0 = store.get().running;
  if (!r0) return;
  const start = r0.start;
  const addr = await lookupAddr(inLoc);
  if (!addr) return;
  const r = store.get().running;
  if (!r || r.start !== start) return;
  const next = { ...r };
  let changed = false;
  if (r.inLoc && !r.inLoc.addr) { next.inLoc = { ...r.inLoc, addr }; changed = true; }
  // Kein gespeicherter Ort → Adresse als Ort verwenden
  if (!r.placeId && !r.place) { next.place = addr; changed = true; }
  if (Array.isArray(r.segments) && r.segments.length) {
    const s0 = r.segments[0];
    if (s0.start === r.start && ((!s0.placeId && !s0.place) || (s0.loc && !s0.loc.addr))) {
      next.segments = [{
        ...s0,
        place: (!s0.placeId && !s0.place) ? addr : s0.place,
        loc: s0.loc ? { ...s0.loc, addr: s0.loc.addr || addr } : s0.loc,
      }, ...r.segments.slice(1)];
      changed = true;
    }
  }
  if (!changed) return;
  try { await store.setRunning(next); } catch { /* Toast kommt vom Store */ }
}

async function doPause() {
  const { timer, ui } = ctx;
  lockNow();
  busyOp = "pause";
  disableAllButtons();
  try {
    await timer.togglePause();
    buzz(25);
  } catch (e) {
    ui.toast("Pause konnte nicht gespeichert werden" + (e && e.message ? ": " + e.message : ""), 3500);
  } finally {
    busyOp = null;
    snap = ctx.store.get() || snap;
    tipsKey = "";
    forceButtons();
    renderAll();
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej({ code: "timeout", message: "Standort hat zu lange gedauert" }), ms)),
  ]);
}

async function doClockOut(btn) {
  const { store, timer, geo, ui, util } = ctx;
  const r = snap && snap.running;
  if (!r) return;
  lockNow();
  busyOp = "out";
  disableAllButtons();
  const set = settings();
  let outLoc = null;
  let entry = null;
  try {
    if (set.autoLocate) {
      ui.setBusy(btn, true, "Standort wird ermittelt …");
      try {
        outLoc = freshLoc() || await withTimeout(geo.getPosition({ timeout: 8000, maxAge: 15000 }), 8000);
        lastLoc = outLoc; lastLocAt = Date.now();
      } catch (e) {
        ui.toast("Ohne Standort ausgestempelt: " + errText(e), 3500);
        outLoc = null;
      }
    }
    // Vorläufige Anzeige, damit die Uhr sofort steht (running wird vor dem Entry null)
    const cur = store.get().running || r;
    const now = Date.now();
    done = {
      id: null, start: cur.start, end: now,
      pauseMin: Math.round(timer.pauseMsNow(cur, now) / 60000),
      placeId: cur.placeId || null, place: cur.place || "", note: cur.note || "",
      people: cleanPeople(cur.people),
      inLoc: cur.inLoc || null, outLoc,
    };
    pendingOut = true;
    try {
      let outPlace = "";
      if (outLoc) {
        try {
          const m = ctx.geofence.matchPlace(outLoc, places(), set.defaultRadius);
          if (m) outPlace = m.place.name;
        } catch { /* ohne Ort */ }
      }
      entry = await timer.clockOut({ outLoc, outPlace });
      if (entry) done = entry;
      buzz([40, 60, 40]);
      ui.toast(`Ausgestempelt · ${util.hm(util.netMin(done))} h`);
    } catch (e) {
      ui.toast("Ausstempeln fehlgeschlagen" + (e && e.message ? ": " + e.message : ""), 3500);
      done = null;
      entry = null;
    }
  } finally {
    pendingOut = false;
    busyOp = null;
    try { ui.setBusy(btn, false); } catch { /* egal */ }
    snap = store.get() || snap;
    if (snap.running) done = null;   // Ausstempeln hat nicht geklappt
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
  if (entry && entry.id) fillEntryAddrs(entry.id);
  if (entry && entry.id) askNoteAfterOut(entry.id);
}

/** Adressen der beendeten Schicht (Ende, ggf. auch Beginn) nachträglich im Eintrag ergänzen. */
async function fillEntryAddrs(id) {
  const { store, geo } = ctx;
  const cur = () => (store.get().entries || []).find((x) => x.id === id);
  let e = cur();
  if (!e) return;
  let outAddr = null, inAddr = null;
  try {
    if (e.outLoc && !e.outLoc.addr) outAddr = await geo.reverseGeocode(e.outLoc.lat, e.outLoc.lng);
    if (e.inLoc && !e.inLoc.addr) inAddr = await lookupAddr(e.inLoc);
  } catch { /* nie kritisch */ }
  if (!outAddr && !inAddr) return;
  e = cur();
  if (!e) return; // inzwischen gelöscht
  const next = { ...e };
  if (outAddr && e.outLoc && !e.outLoc.addr) next.outLoc = { ...e.outLoc, addr: outAddr };
  if (inAddr && e.inLoc && !e.inLoc.addr) next.inLoc = { ...e.inLoc, addr: inAddr };
  if (inAddr && !e.placeId && !e.place) next.place = inAddr;
  // Abschnitte: Ende des letzten (Ausstempel-Ort) bzw. Beginn des ersten ergänzen
  if (Array.isArray(e.segments) && e.segments.length) {
    const list = e.segments.slice();
    let segChanged = false;
    const li = list.length - 1;
    const lg = list[li];
    if (outAddr && lg.endLoc && e.outLoc && lg.endLoc.ts === e.outLoc.ts) {
      list[li] = { ...lg, endLoc: { ...lg.endLoc, addr: lg.endLoc.addr || outAddr }, endPlace: lg.endPlace || outAddr };
      segChanged = true;
    }
    const g0 = list[0];
    if (inAddr && g0.loc && e.inLoc && g0.loc.ts === e.inLoc.ts && (!g0.loc.addr || (!g0.placeId && !g0.place))) {
      list[0] = { ...g0, loc: { ...g0.loc, addr: g0.loc.addr || inAddr }, place: (!g0.placeId && !g0.place) ? inAddr : g0.place };
      segChanged = true;
    }
    if (segChanged) next.segments = list;
  }
  if (next.outLoc === e.outLoc && next.inLoc === e.inLoc && next.place === e.place && next.segments === e.segments) return;
  try { await store.saveEntry(next); } catch { /* Toast kommt vom Store */ }
}

/* ---------------- Ort-Auswahl & Notiz ---------------- */

function nearMatch() {
  if (!lastLoc) return null;
  try { return ctx.geofence.matchPlace(lastLoc, places(), settings().defaultRadius); } catch { return null; }
}

function renderPre() {
  const { util } = ctx;
  const st = state();
  const pre = $("pre");
  const show = st === "idle" || st === "done";
  if (pre.hidden === show) pre.hidden = !show;
  if (!show) return;

  const near = nearMatch();
  const nearEl = $("near");
  const nearText = near ? `In der Nähe: ${near.place.name} (${util.fmtDist(near.distance)})` : "";
  if (nearEl.textContent !== nearText) nearEl.textContent = nearText;
  nearEl.hidden = !near || tipsKey.startsWith("here|");

  renderActs();
  renderPeoplePre();

  const sel = effSel();
  const ps = places();
  const key = JSON.stringify([sel, locating, ps.map((p) => [p.id, p.name])]);
  if (key === chipsKey) return;
  chipsKey = key;
  let html = ps.map((p) =>
    `<button type="button" class="chip" data-id="${util.esc(p.id)}" aria-pressed="${p.id === sel ? "true" : "false"}">${util.esc(p.name)}</button>`
  ).join("");
  html += `<button type="button" class="chip add" data-act="addplace"${locating ? " disabled" : ""}>` +
    `${locating ? "Standort wird ermittelt …" : `${icon("plus", 18)}<span>Ort hier speichern</span>`}</button>`;
  $("chips").innerHTML = html;
}

/** Personen vor dem Einstempeln: Vorauswahl aus dem Einsatzplan, Hinweis „Laut Einsatzplan: …“. */
function renderPeoplePre() {
  const { util } = ctx;
  const ez = todayEinsatz();
  const hint = $("ezhint");
  const where = ez ? String(ez.place || ez.title || ((findPlace(ez.placeId) || {}).name) || "").trim() : "";
  const ht = ez ? `Laut Einsatzplan: ${where || "Einsatz"}` + (peopleText(ez.people) ? ` · ${peopleText(ez.people)}` : "") : "";
  if (hint.textContent !== ht) hint.textContent = ht;
  hint.hidden = !ht;
  if (!pplPick) return;
  const today = util.dayKey(Date.now());
  const pre = JSON.stringify([today, ez ? ez.id : "", ez ? cleanPeople(ez.people) : []]);
  if (pplTouched !== today && pre !== pplPrefill) {
    pplPrefill = pre;
    pplPick.set(ez ? ez.people : []);
    pplKey = JSON.stringify(cleanPeople(settings().people));
    return;
  }
  const k = JSON.stringify(cleanPeople(settings().people));
  if (k !== pplKey) { pplKey = k; pplPick.redraw(); }
}

/** Personen für das Einstempeln (Einfache Ansicht: Vorauswahl aus dem Einsatzplan). */
function currentPeople() {
  if (pplPick) return cleanPeople(pplPick.get());
  const ez = todayEinsatz();
  return ez ? cleanPeople(ez.people) : [];
}

/* ---------------- Notiz & Personen (Update 8) ---------------- */

/** Letzte 10 verschiedenen Notizen (neueste zuerst). */
function recentNotes(exclude = "") {
  const out = [];
  const list = ((snap && snap.entries) || []).slice().sort((a, b) => b.start - a.start);
  for (const e of list) {
    const n = String(e.note || "").trim();
    if (!n || n === exclude || out.some((x) => x.toLowerCase() === n.toLowerCase())) continue;
    out.push(n);
    if (out.length >= 10) break;
  }
  return out;
}

/** Während der Schicht: Notiz und Personen ändern → setRunning. */
function openNoteEditSheet() {
  const { ui, util, store } = ctx;
  const r0 = store.get().running;
  if (!r0) return;
  let pick = null;
  ui.openSheet({
    title: "Notiz & Personen",
    bodyHTML:
      `<div class="fields ppl-sheet">` +
      `<label>Notiz<textarea data-f="note" rows="3" maxlength="300" placeholder="z. B. Steckdosen gesetzt, Verteiler angeschlossen …">${util.esc(r0.note || "")}</textarea></label>` +
      `<div><div class="lbl">Mit wem?</div><div data-f="ppl"></div></div>` +
      `<button type="button" class="btn primary" data-f="save">Speichern</button>` +
      `</div>`,
    onMount(el, close) {
      pick = peoplePicker(el.querySelector('[data-f="ppl"]'), ctx, { selected: r0.people || [] });
      el.querySelector('[data-f="save"]').addEventListener("click", async () => {
        const r = store.get().running;
        if (!r || r.start !== r0.start) { close(); return; }
        const note = (el.querySelector('[data-f="note"]').value || "").trim();
        const people = cleanPeople(pick.get());
        try {
          await store.setRunning({ ...r, note, people });
          rememberPeople(store, people);
          ui.toast("Gespeichert");
          close();
        } catch { /* Toast kommt vom Store */ }
        snap = store.get() || snap;
        metaKey = "";
        renderAll();
      });
    },
  });
}

/** Nach dem Ausstempeln: „Was hast du heute gemacht?“ (abschaltbar über settings.askNoteOnOut). */
function askNoteAfterOut(entryId) {
  const { ui, util, store } = ctx;
  if (settings().askNoteOnOut === false) return;
  const e0 = ((store.get() || {}).entries || []).find((x) => x.id === entryId);
  if (!e0) return;
  const compact = isCompact();
  const sugg = recentNotes(String(e0.note || "").trim()).slice(0, compact ? 5 : 10);
  let pick = null;
  ui.openSheet({
    title: "Was hast du heute gemacht?",
    bodyHTML:
      `<div class="fields ppl-sheet note-ask">` +
      `<label>Kurz notieren<textarea data-f="note" rows="3" maxlength="300" placeholder="z. B. Kabel eingezogen, Schalter montiert …">${util.esc(e0.note || "")}</textarea></label>` +
      (sugg.length ? `<div><div class="lbl">Vorschläge</div><div class="chips note-sugg" data-f="sugg">${sugg.map((n) =>
        `<button type="button" class="chip" data-n="${util.esc(n)}">${util.esc(n)}</button>`).join("")}</div></div>` : "") +
      `<div><div class="lbl">Mit wem?</div><div data-f="ppl"></div></div>` +
      `<div class="row"><button type="button" class="btn ghost" data-f="skip">Überspringen</button>` +
      `<button type="button" class="btn primary" data-f="save">Speichern</button></div>` +
      `<label class="switch note-off"><span>Nicht mehr fragen</span><input type="checkbox" data-f="off"></label>` +
      `</div>`,
    onMount(el, close) {
      const ta = el.querySelector('[data-f="note"]');
      pick = peoplePicker(el.querySelector('[data-f="ppl"]'), ctx, { selected: e0.people || [] });
      const sg = el.querySelector('[data-f="sugg"]');
      if (sg) sg.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-n]");
        if (!b) return;
        ta.value = b.dataset.n;
        try { ta.focus(); } catch { /* egal */ }
      });
      const off = el.querySelector('[data-f="off"]');
      const saveOff = async () => {
        if (off.checked) {
          try { await store.saveSettings({ askNoteOnOut: false }); } catch { /* Toast kommt vom Store */ }
          ui.toast("Okay – die Notiz kannst du jederzeit in den Einträgen ändern.", 3500);
        }
      };
      el.querySelector('[data-f="skip"]').addEventListener("click", async () => { close(); await saveOff(); });
      el.querySelector('[data-f="save"]').addEventListener("click", async () => {
        const btn = el.querySelector('[data-f="save"]');
        const cur = ((store.get() || {}).entries || []).find((x) => x.id === entryId);
        if (!cur) { close(); return; }
        const note = (ta.value || "").trim();
        const people = cleanPeople(pick.get());
        ui.setBusy(btn, true, "Speichern …");
        try {
          await store.saveEntry({ ...cur, note, people });
          rememberPeople(store, people);
          close();
          if (!off.checked) ui.toast("Notiz gespeichert");
        } catch {
          try { ui.setBusy(btn, false); } catch { /* egal */ }
          return;
        }
        await saveOff();
        snap = store.get() || snap;
        if (done && done.id === entryId) done = { ...done, note, people };
        metaKey = "";
        renderAll();
      });
    },
  });
}

let actsKey = "";
function renderActs() {
  const { util } = ctx;
  const list = activities();
  let cur = getAct();
  if (!list.includes(cur)) cur = list[0];
  const key = JSON.stringify([cur, list]);
  if (key === actsKey) return;
  actsKey = key;
  $("acts").innerHTML = list.map((a) =>
    `<button type="button" class="chip" data-act-name="${util.esc(a)}"${actAttrs(a)} aria-pressed="${a === cur ? "true" : "false"}">${util.esc(a)}</button>`
  ).join("");
}

function onActChip(ev) {
  const b = ev.target.closest("button.chip[data-act-name]");
  if (!b) return;
  setAct(b.dataset.actName);
  actsKey = "";
  renderActs();
}

/* ---------------- Abschnitt wechseln ---------------- */

function openSegSheet() {
  const { ui, util, store } = ctx;
  if (!(snap && snap.running) || busyOp || ctx.timer.isLocked()) return;
  const ss = segs(snap.running);
  const curAct = ss[ss.length - 1].activity || "Arbeiten";
  const chipsHTML = () => activities().map((a) =>
    `<button type="button" class="chip" data-a="${util.esc(a)}"${actAttrs(a)} aria-pressed="${a === curAct ? "true" : "false"}">${util.esc(a)}</button>`
  ).join("");
  ui.openSheet({
    title: "Abschnitt wechseln",
    bodyHTML:
      `<div class="fields">` +
      `<p class="note">Was machst du jetzt? Antippen – der Ort wird automatisch erfasst.</p>` +
      `<div class="chips seg-chips" data-f="chips">${chipsHTML()}</div>` +
      `<div class="seg-own">` +
      `<input type="text" data-f="own" maxlength="40" placeholder="+ Eigene Tätigkeit" autocomplete="off">` +
      `<button type="button" class="btn sm primary" data-f="add">Starten</button>` +
      `</div></div>`,
    onMount(el, close) {
      el.querySelector('[data-f="chips"]').addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-a]");
        if (!b) return;
        close();
        startSegment(b.dataset.a);
      });
      const own = el.querySelector('[data-f="own"]');
      const go = async () => {
        const name = (own.value || "").trim().replace(/\s+/g, " ");
        if (!name) { own.focus(); return; }
        const list = activities();
        if (!list.some((a) => a.toLowerCase() === name.toLowerCase())) {
          try { await store.saveSettings({ activities: [...list, name] }); } catch { /* Toast kommt vom Store */ }
        }
        close();
        startSegment(list.find((a) => a.toLowerCase() === name.toLowerCase()) || name);
      };
      el.querySelector('[data-f="add"]').addEventListener("click", go);
      own.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    },
  });
}

async function startSegment(activity) {
  const { store, timer, geo, geofence, ui } = ctx;
  if (!(snap && snap.running) || busyOp || timer.isLocked()) return;
  if (!timer.addSegment) { ui.toast("Abschnitte werden noch nicht unterstützt."); return; }
  lockNow();
  busyOp = "seg";
  disableAllButtons();
  const btn = $("btns").querySelector('[data-act="seg"]');
  const set = settings();
  let loc = null;
  let segStart = 0;
  try {
    if (set.autoLocate) {
      if (btn) ui.setBusy(btn, true, "Standort wird ermittelt …");
      try {
        // Frische Position der Fahrerkennung nutzen (sonst wartet ein neuer GPS-Abruf bis zu 10 s)
        loc = freshLoc() || await withTimeout(geo.getPosition({ timeout: 8000, maxAge: 15000 }), 8000);
        lastLoc = loc; lastLocAt = Date.now();
      } catch (e) {
        ui.toast("Ohne Standort gewechselt: " + errText(e), 3500);
      }
    }
    let place = null;
    if (loc) {
      try { const m = geofence.matchPlace(loc, places(), set.defaultRadius); if (m) place = m.place; } catch { /* ohne */ }
    }
    try {
      const seg = await timer.addSegment({
        activity, placeId: place ? place.id : null, place: place ? place.name : "", loc,
      });
      segStart = seg && seg.start;
      setAct(activity);
      actsKey = "";
      buzz(30);
      ui.toast(`${activity}` + (place ? ` · ${place.name}` : ""));
    } catch (e) {
      ui.toast("Wechsel fehlgeschlagen" + (e && e.message ? ": " + e.message : ""), 3500);
    }
  } finally {
    busyOp = null;
    try { if (btn) ui.setBusy(btn, false); } catch { /* egal */ }
    snap = store.get() || snap;
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
  if (segStart && loc) fillSegmentAddr(segStart, loc);
}

/** Adresse eines Abschnitts nachträglich ergänzen (und als Ort nutzen, wenn kein gespeicherter Ort passt). */
async function fillSegmentAddr(segStart, loc) {
  const { store } = ctx;
  const addr = await lookupAddr(loc);
  if (!addr) return;
  const r = store.get().running;
  if (!r || !Array.isArray(r.segments)) return;
  const i = r.segments.findIndex((g) => g.start === segStart);
  if (i < 0) return;
  const g = r.segments[i];
  const ng = { ...g, loc: g.loc ? { ...g.loc, addr: g.loc.addr || addr } : g.loc };
  if (!g.placeId && !g.place) ng.place = addr;
  const list = r.segments.slice();
  list[i] = ng;
  // Der vorige Abschnitt endet hier → sein Ziel (endPlace) ebenso ergänzen
  if (i > 0) {
    const p = list[i - 1];
    if (p.endLoc && loc.ts != null && p.endLoc.ts === loc.ts) {
      list[i - 1] = { ...p, endLoc: { ...p.endLoc, addr: p.endLoc.addr || addr }, endPlace: p.endPlace || addr };
    }
  }
  try { await store.setRunning({ ...r, segments: list }); } catch { /* Toast kommt vom Store */ }
}

async function onChip(ev) {
  const b = ev.target.closest("button.chip");
  if (!b || b.disabled) return;
  if (b.dataset.act === "addplace") {
    addPlaceHere();
    return;
  }
  const id = b.dataset.id;
  setSel(effSel() === id ? null : id);
  placeTouched = ctx.util.dayKey(Date.now());
  // direkt umschalten, ohne alles neu zu zeichnen
  $("chips").querySelectorAll("button.chip[data-id]").forEach((c) => {
    c.setAttribute("aria-pressed", c.dataset.id === effSel() ? "true" : "false");
  });
  chipsKey = JSON.stringify([effSel(), locating, places().map((p) => [p.id, p.name])]);
}

async function addPlaceHere() {
  const { geo, ui } = ctx;
  if (locating) return;
  locating = true;
  chipsKey = "";
  renderPre();
  let loc = null;
  try {
    loc = await geo.getPosition({ timeout: 12000, maxAge: 5000 });
    lastLoc = loc; lastLocAt = Date.now();
  } catch (e) {
    ui.toast(errText(e) + " – du kannst die Adresse von Hand eintragen.", 3500);
  } finally {
    locating = false;
    chipsKey = "";
    renderPre();
  }
  ctx.openPlaceForm(null, loc);
}

/** Beim Öffnen des Reiters: Standort einmal holen, wenn schon erlaubt (für „In der Nähe“). */
async function refreshNear() {
  const { geo } = ctx;
  if (locating || busyOp) return;
  if (Date.now() - lastLocAt < 60000) { renderTips(); renderPre(); return; }
  if (!settings().autoLocate) return;
  if (!places().some((p) => typeof p.lat === "number" && typeof p.lng === "number")) return;
  try {
    if (!geo.isSupported()) return;
    if ((await geo.permission()) !== "granted") return;
    const loc = await geo.getPosition({ timeout: 10000, maxAge: 60000 });
    lastLoc = loc; lastLocAt = Date.now();
    renderTips();
    renderPre();
  } catch { /* still ignorieren */ }
}

/* ---------------- Kennzahlen & Liste ---------------- */

function sumSince(fromTs) {
  const { util, timer } = ctx;
  let min = 0;
  const entries = (snap && snap.entries) || [];
  for (const e of entries) if (e.start >= fromTs) min += credit(e);
  // vorläufige beendete Schicht, deren Eintrag noch nicht im Store ist
  if (done && done.start >= fromTs && !entries.some((e) => (done.id ? e.id === done.id : e.start === done.start))) {
    min += credit(done);
  }
  const r = snap && snap.running;
  if (r && r.start >= fromTs) min += timer.netMs(r) / 60000;
  return min;
}

function renderStats() {
  const { util } = ctx;
  const now = new Date();
  const vals = [
    ["s-day", util.startOfDay(now).getTime()],
    ["s-week", util.startOfWeek(now).getTime()],
    ["s-month", util.startOfMonth(now.getFullYear(), now.getMonth()).getTime()],
  ];
  for (const [r, from] of vals) {
    const t = util.hm(Math.floor(sumSince(from)));
    const el = $(r);
    if (el.textContent !== t) el.textContent = t;
  }
}

function renderList() {
  const { util } = ctx;
  const today = util.dayKey(Date.now());
  const list = ((snap && snap.entries) || [])
    .filter((e) => util.dayKey(e.start) === today)
    .sort((a, b) => b.start - a.start);
  const key = JSON.stringify(list.map((e) => [e.id, e.start, e.end, e.pauseMin, e.place, e.note, e.kind, e.creditMin, e.people]));
  if (key === listKey) return;
  listKey = key;
  if (!list.length) {
    $("list").innerHTML = `<div class="empty empty-illu">${emptyClipboard()}<h3>Noch keine Einträge für heute</h3>` +
      `<p class="note">Deine Arbeitszeiten werden hier angezeigt, sobald du eingestempelt hast.</p></div>`;
    return;
  }
  $("list").innerHTML = list.map((e) => {
    const bits = [];
    if (!isWork(e)) {
      if (e.note) bits.push(util.esc(e.note));
      return `<button type="button" class="entry" data-id="${util.esc(e.id)}">` +
        `<span class="t">${util.esc(kindName(e.kind))}</span>` +
        `<span class="d">${util.hm(credit(e))} h</span>` +
        `<span class="p">${bits.join(" · ")}</span></button>`;
    }
    if (util.isPrivateTrip && util.isPrivateTrip(e)) return privTripRow(e, util, settings()); // Update 9 – Privatfahrt
    if (e.place) bits.push(`<span class="tag">${util.esc(e.place)}</span>`);
    if (e.pauseMin) bits.push(`Pause ${util.hm(e.pauseMin)}`);
    if (e.note) bits.push(util.esc(e.note));
    if (peopleText(e.people)) bits.push(util.esc(peopleText(e.people)));
    return `<button type="button" class="entry" data-id="${util.esc(e.id)}">` +
      `<span class="t">${util.clock(e.start)} – ${util.clock(e.end)}</span>` +
      `<span class="d">${util.hm(util.netMin(e))} h</span>` +
      `<span class="p">${bits.join(" · ")}</span></button>`;
  }).join("");
}

/* ---------------- Sekundentakt & Sichtbarkeit ---------------- */

export function tick() {
  if (!root || !ctx || !snap) return;
  // Beendete Schicht vom Vortag nicht ewig anzeigen
  if (done && !pendingOut && !busyOp && ctx.util.dayKey(done.end) !== ctx.util.dayKey(Date.now())) {
    done = null;
    renderAll();
    return;
  }
  updateClockText();
  renderStats();
  try { myday.tick(); } catch (e) { console.error(e); }
  renderTips();      // zeichnet nur, wenn sich das passende Kärtchen ändert
  renderButtons();   // zeichnet nur bei Zustandswechsel (z. B. Sperre abgelaufen)
  if (state() === "idle" || state() === "done") renderList(); // Tageswechsel
  try { planTick(); } catch (e) { console.error(e); }
  try { driveWatchTick(); } catch (e) { console.error(e); }
  try { privatUi.tick(); privDrive.tick(ctx); } catch (e) { console.error(e); } // Update 9 – Privat
}

export function onShow() {
  if (!root || !ctx) return;
  if (snap) renderAll();
  refreshNear();
}

/* ---------------- Geplante Schichten (Auto-Stempeln) ---------------- */

const PLAN_DONE_KEY = "stempelkarte.planDone";     // { "planId:YYYY-MM-DD": ts } – erledigt/übersprungen
const PLAN_SNOOZE_KEY = "stempelkarte.planSnooze"; // { key: ts } – lokale Wiederholung, solange die App offen ist
let planLocBusy = false;
let planLocTry = 0;
let planHandling = false;

function lsObj(k) {
  try { const o = JSON.parse(localStorage.getItem(k) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function lsObjSet(k, o) {
  // nur heutige Schlüssel behalten
  const today = ctx.util.dayKey(Date.now());
  const out = {};
  for (const [kk, v] of Object.entries(o)) if (kk.endsWith(":" + today)) out[kk] = v;
  try { localStorage.setItem(k, JSON.stringify(out)); } catch { /* egal */ }
}
function planDone(key) { return key in lsObj(PLAN_DONE_KEY); }
function markPlanDone(key) {
  const o = lsObj(PLAN_DONE_KEY); o[key] = Date.now(); lsObjSet(PLAN_DONE_KEY, o);
  const s = lsObj(PLAN_SNOOZE_KEY); if (key in s) { delete s[key]; lsObjSet(PLAN_SNOOZE_KEY, s); }
}

function planPlace(plan) { return findPlace(plan && plan.placeId); }
function hasXY(p) { return !!p && typeof p.lat === "number" && typeof p.lng === "number"; }
function atPlace(loc, place) {
  if (!loc || !hasXY(place)) return null;
  try { return ctx.geofence.matchPlace(loc, [place], settings().defaultRadius); } catch { return null; }
}
/** Beginn für das Plan-Einstempeln: Planzeit, wenn höchstens 60 min vorbei; sonst jetzt. */
function planStart(due, now = Date.now()) {
  return Number.isFinite(due) && due <= now && now - due <= H ? due : now;
}
function autoMsg(start) {
  return (place) => `Automatisch eingestempelt um ${ctx.util.clock(start)}` + (place ? ` – ${place.name}` : "");
}

/** „Früher da“: zwischen Planzeit − 60 min und Planzeit, Standort im Radius. */
function earlyPlanTip() {
  if (!lastLoc || Date.now() - lastLocAt > LOC_FRESH_MS) return null;
  const now = Date.now();
  for (const plan of plansToday(snap, ctx.util, now)) {
    const key = planKey(plan.id, now);
    if (planDone(key)) continue;
    const due = dueTs(plan, now);
    if (now < due - H || now >= due) continue;
    const place = planPlace(plan);
    if (!atPlace(lastLoc, place)) continue;
    const id = "plan|" + key;
    if (dismissed.has(id)) continue;
    return { kind: "plan-early", id, plan, place };
  }
  return null;
}

/** Im Sekundentakt: Standort (max. alle 60 s) nahe der Planzeit, ggf. automatisch einstempeln. */
function planTick() {
  if (!snap || !snap.ready || snap.running || busyOp || planHandling || ctx.timer.isLocked()) return;
  if (document.visibilityState !== "visible") return;
  if (isPrivatNow(snap)) return; // Update 9 – Privat: nie automatisch einstempeln
  const now = Date.now();
  const list = plansToday(snap, ctx.util, now).filter((p) => !planDone(planKey(p.id, now)));
  if (!list.length) return;

  // Lokales „Später erinnern“ (solange die App offen ist)
  const sn = lsObj(PLAN_SNOOZE_KEY);
  for (const plan of list) {
    const key = planKey(plan.id, now);
    if (Number(sn[key]) > 0 && now >= Number(sn[key])) {
      delete sn[key]; lsObjSet(PLAN_SNOOZE_KEY, sn);
      handlePlan({ planId: plan.id, due: dueTs(plan, now) }, ctx);
      return;
    }
  }

  const active = list.filter((p) => { const d = dueTs(p, now); return now >= d - H && now < d + H && hasXY(planPlace(p)); });
  if (!active.length) return;
  if (now - lastLocAt > 60000) {
    if (planLocBusy || now - planLocTry < 60000) return;
    planLocBusy = true;
    planLocTry = now;
    (async () => {
      try {
        if (!ctx.geo.isSupported() || ["denied", "prompt"].includes(await ctx.geo.permission())) return; // nie ungefragt nachfragen
        const loc = await ctx.geo.getPosition({ timeout: 10000, maxAge: 30000 });
        lastLoc = loc; lastLocAt = Date.now();
        renderTips(); renderPre();
      } catch { /* in 60 s erneut */ }
      finally { planLocBusy = false; }
    })();
    return;
  }
  if (!lastLoc || now - lastLocAt > 90000) return;
  for (const plan of active) {
    const due = dueTs(plan, now);
    if (now < due) continue;
    const place = planPlace(plan);
    if (!atPlace(lastLoc, place)) continue;
    const start = planStart(due, now);
    doClockIn(null, place, { activity: plan.activity || "Arbeiten", inLoc: lastLoc, start, planKey: planKey(plan.id, now), msg: autoMsg(start) });
    return;
  }
}

/** „Später erinnern“ / „Heute nicht“ für den Server merken (pushlog.snooze), lokal zusätzlich. */
async function writeSnooze(key, value) {
  if (value > 0) { const s = lsObj(PLAN_SNOOZE_KEY); s[key] = value; lsObjSet(PLAN_SNOOZE_KEY, s); }
  const s = ctx.store.get();
  if (!s || s.mode !== "cloud" || !s.user || !s.user.uid) return false;
  try {
    const f = await getFirebase();
    if (!f) return false;
    await f.fs.setDoc(f.fs.doc(f.db, "users", s.user.uid, "meta", "pushlog"), { snooze: { [key]: value } }, { merge: true });
    return true;
  } catch (e) {
    console.warn("Snooze nicht gespeichert:", e);
    return false;
  }
}

function waitReady(ms = 10000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const check = () => {
      const s = ctx.store.get();
      if ((s && s.ready) || Date.now() - t0 > ms) resolve(s);
      else setTimeout(check, 150);
    };
    check();
  });
}

/** Aufruf über die Benachrichtigung (?plan=<id>&due=<ms>). */
export async function handlePlan({ planId, due } = {}, c = ctx) {
  if (c) ctx = c;
  if (!ctx || !planId || planHandling) return;
  const { ui, geo, util } = ctx;
  planHandling = true;
  try {
    const s = await waitReady();
    snap = s || snap;
    const plan = readPlans((s && s.settings) || {}).find((p) => p.id === planId);
    if (!plan) { ui.toast("Diese geplante Schicht gibt es nicht mehr.", 3500); return; }
    if (s.running) { ui.toast("Du bist schon eingestempelt.", 3000); return; }
    if (isPrivatNow(s)) { ui.toast("🏠 Privat-Modus – du wirst nicht automatisch eingestempelt.", 3500); return; } // Update 9
    const now = Date.now();
    let dueMs = Number(due);
    if (!Number.isFinite(dueMs) || dueMs <= 0) dueMs = dueTs(plan, now);
    const key = planKey(plan.id, dueMs);
    const place = planPlace(plan);
    const name = (place && place.name) || plan.place || "deinem Ort";
    let loc = null, err = null;
    if (hasXY(place)) {
      ui.toast(`Standort wird geprüft – ${name} …`, 10000);
      try {
        loc = await geo.getPosition({ timeout: 12000, maxAge: 0 });
        lastLoc = loc; lastLocAt = Date.now();
      } catch (e) { err = errText(e); }
    }
    snap = ctx.store.get() || snap;
    if (snap.running) { ui.toast("Du bist schon eingestempelt.", 3000); return; }
    const m = atPlace(loc, place);
    if (m) {
      const start = planStart(dueMs, Date.now());
      while (busyOp) await new Promise((r) => setTimeout(r, 100));
      await doClockIn(null, place, { activity: plan.activity || "Arbeiten", inLoc: loc, start, planKey: key, msg: autoMsg(start) });
      return;
    }
    { const t = document.getElementById("toast"); if (t) t.hidden = true; }
    openNotHereSheet({ plan, place, name, loc, err, key, dueMs });
  } finally {
    planHandling = false;
  }
}

function openNotHereSheet({ plan, place, name, loc, err, key, dueMs }) {
  const { ui, util } = ctx;
  let why = "";
  if (!place) why = "Der geplante Ort wurde gelöscht.";
  else if (!hasXY(place)) why = `Für „${place.name}“ ist noch keine Position gespeichert – öffne den Ort einmal vor Ort und tippe „Meinen Standort übernehmen“.`;
  else if (err) why = err;
  else if (loc) {
    const d = airDist(loc, place);
    why = d ? `Dein Standort ist ${d} entfernt.` : "Dein Standort liegt außerhalb des Orts.";
  }
  const cloud = snap && snap.mode === "cloud";
  ui.openSheet({
    title: `Du bist nicht bei ${name}`,
    bodyHTML:
      `<div class="fields plan-sheet">` +
      `<p class="note">Geplant um <b>${util.esc(plan.time)}</b> · ${util.esc(plan.activity || "Arbeiten")}. ${util.esc(why)}</p>` +
      `<div><div class="lbl">Später erinnern</div>` +
      `<div class="chips plan-snooze"><button type="button" class="chip" data-min="15">15 Min</button>` +
      `<button type="button" class="chip" data-min="30">30 Min</button><button type="button" class="chip" data-min="60">60 Min</button></div>` +
      (cloud ? "" : `<p class="hint">Ohne Anmeldung erinnert dich die App nur, solange sie geöffnet ist.</p>`) +
      `</div>` +
      `<button type="button" class="btn go" data-f="here">${icon("play", 20)}<span>Trotzdem hier einstempeln</span></button>` +
      `<button type="button" class="btn ghost" data-f="skip">Heute nicht</button>` +
      `</div>`,
    onMount(el, close) {
      el.querySelector(".plan-snooze").addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-min]");
        if (!b) return;
        const at = Date.now() + Number(b.dataset.min) * 60000;
        close();
        await writeSnooze(key, at);
        ui.toast(`Ich erinnere dich um ${util.clock(at)} nochmal.`, 3000);
      });
      el.querySelector('[data-f="here"]').addEventListener("click", async () => {
        close();
        snap = ctx.store.get() || snap;
        if (snap.running) { ui.toast("Du bist schon eingestempelt."); return; }
        while (busyOp) await new Promise((r) => setTimeout(r, 100));
        const fresh = loc && Date.now() - (loc.ts || 0) < 120000 ? loc : null;
        await doClockIn(null, null, { activity: plan.activity || "Arbeiten", inLoc: fresh, planKey: key });
      });
      el.querySelector('[data-f="skip"]').addEventListener("click", async () => {
        close();
        markPlanDone(key);
        await writeSnooze(key, -1);
        ui.toast("Okay – heute keine Erinnerung mehr für diese Schicht.", 3000);
      });
    },
  });
}

/* ---------------- Fahrerkennung (Update 6) ---------------- */

const AUTO_GAP_MS = 5 * 60000;     // höchstens ein automatischer Wechsel pro 5 Minuten
const UNDO_MS = 10000;
let samples = [];                  // Standortproben der laufenden Beobachtung
let geoPerm = "unknown";
let geoPermAt = 0;
let permBusy = false;
let lastAutoAt = 0;
let driveSuppressed = false;       // nach „Rückgängig“: bis zum nächsten Stillstand nicht erneut
let arriveSuppressed = "";         // nach „Rückgängig“ der Ankunft: Ort-ID, bis man ihn verlässt
let driveSeg = null;               // { start, startPid, left } – Fahrt-Abschnitt, für die Ankunft
let driveTip = null;               // { kind: "drive-ask"|"arrive", id, seg, … }
let wakeLock = null;
let wakeBusy = false;
let undoTimer = null;

function plainLoc(s) {
  return s ? { lat: s.lat, lng: s.lng, acc: Math.round(s.acc || 0), ts: s.ts } : null;
}

async function checkPerm() {
  if (permBusy) return;
  permBusy = true;
  try { geoPerm = ctx.geo.isSupported() ? await ctx.geo.permission() : "unsupported"; } catch { geoPerm = "unknown"; }
  geoPermAt = Date.now();
  permBusy = false;
}

/** Im Sekundentakt und bei Sichtbarkeitswechsel: Beobachtung starten/stoppen, Wake Lock pflegen. */
function driveWatchTick() {
  if (!ctx || !snap) return;
  const r = snap.running;
  const ad = motion.readAutoDrive(settings());
  const visible = document.visibilityState === "visible";
  const wantPriv = !r && visible && privDrive.wantWatch(snap); // Update 9 – Privatfahrten
  const want = (!!r && r.pauseStart == null && ad.enabled && visible) || wantPriv;
  if (!r) { driveTip = null; driveSeg = null; driveSuppressed = false; arriveSuppressed = ""; }
  else if (r.pauseStart != null) driveTip = null;
  if (want) {
    if (Date.now() - geoPermAt > (geoPerm === "granted" ? 30000 : 10000)) checkPerm();
    if (geoPerm === "granted" && !motion.watching()) {
      samples = [];
      motion.startWatch(onDriveSample);   // Berechtigung liegt schon vor → keine Nachfrage
    } else if (geoPerm !== "granted" && motion.watching()) {
      motion.stopWatch();
    }
  } else if (motion.watching()) {
    motion.stopWatch();
    samples = [];
  }
  // Bildschirm während der Fahrt wach halten (optional)
  const cur = r ? segs(r)[segs(r).length - 1] : null;
  const wantWake = want && ad.keepAwake && cur && isDrive(cur.activity);
  if (wantWake && !wakeLock && !wakeBusy && navigator.wakeLock && navigator.wakeLock.request) {
    wakeBusy = true;
    navigator.wakeLock.request("screen").then((l) => {
      wakeLock = l;
      try { l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; }); } catch { /* egal */ }
    }).catch(() => { /* nicht erlaubt – egal */ }).finally(() => { wakeBusy = false; });
  } else if (!wantWake && wakeLock) {
    const l = wakeLock;
    wakeLock = null;
    try { l.release(); } catch { /* egal */ }
  }
}

function onDriveSample(s) {
  if (!snap || !snap.running) { // Update 9 – Privat-Modus: Fahrt als Privatfahrt aufzeichnen
    lastLoc = plainLoc(s); lastLocAt = Date.now();
    try { privDrive.onSample(s, ctx); } catch (e) { console.error(e); }
    return;
  }
  samples.push(s);
  motion.prune(samples);
  lastLoc = plainLoc(s); lastLocAt = Date.now();
  try { driveEval(); } catch (e) { console.error(e); }
  renderTips();
}

function setDriveTip(t) {
  driveTip = t;   // renderTips zeichnet neu, sobald sich die Kärtchen-ID ändert
}

/** Vorige Tätigkeit vor der Fahrt (Standard „Arbeiten“). */
function actBeforeDrive(ss) {
  for (let i = ss.length - 2; i >= 0; i--) if (!isDrive(ss[i].activity)) return ss[i].activity || "Arbeiten";
  return "Arbeiten";
}

function matchLoc(loc) {
  if (!loc) return null;
  try { return ctx.geofence.matchPlace(loc, places(), settings().defaultRadius); } catch { return null; }
}

function driveEval() {
  const r = snap && snap.running;
  if (!r || r.pauseStart != null || !samples.length) return;
  const ad = motion.readAutoDrive(settings());
  if (!ad.enabled) return;
  const ss = segs(r);
  const cur = ss[ss.length - 1];
  const now = Date.now();
  const last = samples[samples.length - 1];
  const cls = motion.classify(samples, { minKmh: ad.minKmh, now });
  if (cls === "stopped") driveSuppressed = false;

  if (!isDrive(cur.activity)) {
    driveSeg = null;
    if (cls !== "driving" || driveSuppressed) {
      if (driveTip && (driveTip.kind !== "drive-ask" || cls === "stopped" || driveTip.seg !== cur.start)) setDriveTip(null);
      return;
    }
    const first = motion.driveStart(samples, { minKmh: ad.minKmh }) || samples[0];
    const from = first.ts >= cur.start ? first : (samples.find((x) => x.ts >= cur.start) || last);
    const start = Math.max(cur.start, first.ts);
    if (ad.mode === "auto" && now - lastAutoAt >= AUTO_GAP_MS && !busyOp && !ctx.timer.isLocked()) {
      setDriveTip(null);
      driveSwitch("Autofahren", { loc: plainLoc(from), start, auto: true });
      return;
    }
    if (!driveTip || driveTip.kind !== "drive-ask" || driveTip.seg !== cur.start) {
      setDriveTip({ kind: "drive-ask", id: "drive|" + cur.start, seg: cur.start, loc: plainLoc(from), start });
    }
    return;
  }

  // Während „Autofahren“: Ankunft an gespeichertem Ort oder Stillstand
  if (!driveSeg || driveSeg.start !== cur.start) {
    const m0 = cur.placeId ? { place: findPlace(cur.placeId) } : matchLoc(cur.loc);
    driveSeg = { start: cur.start, startPid: (m0 && m0.place && m0.place.id) || null, left: false };
  }
  if (last.ts < cur.start) return;
  const m = matchLoc(last);
  const pid = m ? m.place.id : null;
  if (pid !== driveSeg.startPid) driveSeg.left = true;
  if (arriveSuppressed && pid !== arriveSuppressed) arriveSuppressed = "";
  const act = actBeforeDrive(ss);
  const arrived = m && driveSeg.left && pid !== arriveSuppressed;
  if (arrived) {
    if (ad.mode === "auto" && now - lastAutoAt >= AUTO_GAP_MS && !busyOp && !ctx.timer.isLocked()) {
      setDriveTip(null);
      driveSwitch(act, { place: m.place, loc: plainLoc(last), auto: true });
      return;
    }
    const id = "arrive|" + cur.start + "|" + pid;
    if (!driveTip || driveTip.id !== id) setDriveTip({ kind: "arrive", id, seg: cur.start, place: m.place, loc: plainLoc(last), act });
    return;
  }
  const since = samples.filter((x) => x.ts >= cur.start);
  if (motion.classify(since, { minKmh: ad.minKmh, now }) === "stopped") {
    if (driveTip && driveTip.kind === "arrive") return;
    const loc = plainLoc(last);
    const t = { kind: "arrive", id: "arrive|" + cur.start + "|stop", seg: cur.start, place: null, loc, act };
    setDriveTip(t);
    ctx.geo.reverseGeocode(loc.lat, loc.lng).then((addr) => {
      if (addr && driveTip === t) { t.loc = { ...loc, addr }; tipsKey = ""; renderTips(); }
    }).catch(() => { /* ohne Adresse */ });
  } else if (driveTip && driveTip.kind === "arrive" && cls === "driving") {
    setDriveTip(null);
  }
}

/** Abschnitt wechseln wie „Abschnitt wechseln“ (timer.addSegment), aber mit bekanntem Standort.
 *  `start` (ms): früherer Beginn (erkannter Fahrtbeginn), frühestens Start des aktuellen Abschnitts.
 *  `auto`: automatisch ausgelöst → Toast mit „Rückgängig“. */
async function driveSwitch(activity, { place = null, loc = null, start = null, auto = false } = {}) {
  const { store, timer, ui } = ctx;
  const r0 = store.get().running;
  if (!r0 || r0.pauseStart != null || busyOp || timer.isLocked() || !timer.addSegment) return false;
  const ss0 = segs(r0);
  const prevLast = ss0[ss0.length - 1];
  const shiftStart = r0.start;
  lockNow();
  busyOp = "seg";
  disableAllButtons();
  let segStart = 0;
  let ok = false;
  try {
    if (!place && loc) { const m = matchLoc(loc); if (m) place = m.place; }
    const seg = await timer.addSegment({ activity, placeId: place ? place.id : null, place: place ? place.name : "", loc });
    segStart = seg && seg.start;
    if (Number.isFinite(start) && segStart && start < segStart) {
      const ns = Math.max(start, (prevLast.start || 0) + 1000);
      const r = store.get().running;
      if (ns < segStart && r && Array.isArray(r.segments)) {
        const list = r.segments.map((g) => (g.start === segStart ? { ...g, start: ns } : g));
        await store.setRunning({ ...r, segments: list });
        segStart = ns;
      }
    }
    ok = true;
    if (auto) lastAutoAt = Date.now();
    buzz(30);
    const where = place ? ` · ${place.name}` : "";
    if (auto) {
      const msg = isDrive(activity)
        ? "Fahrt erkannt – Abschnitt „Autofahren“ gestartet"
        : `Angekommen${where} – weiter mit „${activity}“`;
      const mySeg = segStart;
      undoToast(msg, () => undoSwitch({ shiftStart, segStart: mySeg, prevLast, drive: isDrive(activity), placeId: place ? place.id : "" }));
    } else {
      ui.toast(`${activity}` + where);
    }
  } catch (e) {
    ui.toast("Wechsel fehlgeschlagen" + (e && e.message ? ": " + e.message : ""), 3500);
  } finally {
    busyOp = null;
    snap = store.get() || snap;
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
  if (ok && segStart && loc && !place) fillSegmentAddr(segStart, loc);
  return ok;
}

/** Automatisch angelegten Abschnitt wieder entfernen (der vorige läuft weiter wie zuvor). */
async function undoSwitch({ shiftStart, segStart, prevLast, drive, placeId }) {
  const { store, ui } = ctx;
  const r = store.get().running;
  if (!r || r.start !== shiftStart) return;
  const list = segs(r);
  if (!list.length || list[list.length - 1].start !== segStart || list.length < 2) {
    ui.toast("Das lässt sich nicht mehr rückgängig machen.", 3000);
    return;
  }
  const rest = list.slice(0, -1);
  const pl = rest[rest.length - 1];
  rest[rest.length - 1] = { ...pl, endLoc: prevLast.endLoc ?? null, endPlace: prevLast.endPlace || "" };
  if (!("endLoc" in prevLast)) { delete rest[rest.length - 1].endLoc; delete rest[rest.length - 1].endPlace; }
  lastAutoAt = 0;                 // rückgängig gemachter Wechsel zählt nicht
  if (drive) driveSuppressed = true;
  else arriveSuppressed = placeId || "";
  try {
    await store.setRunning({ ...r, segments: rest });
    ui.toast("Rückgängig gemacht");
  } catch { /* Toast kommt vom Store */ }
  snap = store.get() || snap;
  metaKey = "";
  tipsKey = "";
  renderAll();
}

/** Toast mit „Rückgängig“-Knopf (10 s). */
function undoToast(msg, onUndo) {
  let el = document.getElementById("drive-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "drive-toast";
    el.className = "toast drive-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.hidden = true;
    document.body.appendChild(el);
  }
  const base = document.getElementById("toast");
  if (base) base.hidden = true;
  clearTimeout(undoTimer);
  el.innerHTML = `<span>${ctx.util.esc(msg)}</span><button type="button" class="drive-undo">Rückgängig</button>`;
  el.hidden = false;
  const hide = () => { clearTimeout(undoTimer); undoTimer = null; el.hidden = true; };
  el.querySelector("button").addEventListener("click", () => { hide(); onUndo(); }, { once: true });
  undoTimer = setTimeout(hide, UNDO_MS);
}


/* ---------- Abschnitt löschen (versehentlich gewählt) ---------- */
function segDelIcon() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
}

function askRemoveSegment(index) {
  const { util, ui, timer, store } = ctx;
  const r = snap && snap.running;
  if (!r) return;
  const ss = segs(r);
  const g = ss[index];
  if (!g) return;
  const name = g.activity || "Arbeiten";
  const until = index + 1 < ss.length ? util.clock(ss[index + 1].start) : "jetzt";
  const target = index + 1 < ss.length
    ? `Die Zeit geht an „${util.esc(ss[index + 1].activity || "Arbeiten")}“ (danach gewählt), das dann schon ab ${util.clock(index === 0 ? r.start : g.start)} zählt.`
    : `„${util.esc(ss[index - 1].activity || "Arbeiten")}“ läuft dann einfach weiter.`;
  const sheet = ui.openSheet({
    title: "Abschnitt löschen?",
    bodyHTML: `<p>„<b>${util.esc(name)}</b>“ von ${util.clock(g.start)} bis ${until} wird entfernt.</p>
      <p class="note">${target}</p>
      <div class="row"><button type="button" class="btn ghost" data-r="sd-no">Abbrechen</button>
      <button type="button" class="btn danger" data-r="sd-yes">Löschen</button></div>`,
    onMount(el, close) {
      el.querySelector('[data-r="sd-no"]').addEventListener("click", close);
      el.querySelector('[data-r="sd-yes"]').addEventListener("click", async () => {
        const cur = store.get().running;
        if (!cur || cur.start !== r.start) { close(); return; }
        const next = timer.removeSegment(cur, index);
        if (!next) { ui.toast("Ein einzelner Abschnitt kann nicht gelöscht werden – wechsle stattdessen den Abschnitt."); close(); return; }
        try { await store.setRunning(next); ui.toast(`„${name}“ gelöscht`); } catch { /* Toast kommt vom Store */ }
        close();
      });
    },
  });
  return sheet;
}


/* ---------- Ausstempeln um … (Uhrzeit selbst wählen) ---------- */
export function openEndSheet() {
  const { ui, util, store } = ctx;
  const r = store.get().running;
  if (!r) return;
  const pad = util.pad || ((n) => String(n).padStart(2, "0"));
  const now = new Date();
  const val = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  ui.openSheet({
    title: "Ausstempeln um …",
    bodyHTML: `<p class="note">Schicht seit ${util.clock(r.start)}. Wähle, wann du aufgehört hast (nicht in der Zukunft).</p>
      <div class="fields"><label>Ende<input type="time" id="end-at" value="${val}"></label></div>
      <p class="hint" data-r="end-at-info"></p>
      <div class="row"><button type="button" class="btn ghost" data-r="end-no">Abbrechen</button>
      <button type="button" class="btn stop" data-r="end-yes">Ausstempeln</button></div>`,
    onMount(el, close) {
      const inp = el.querySelector("#end-at");
      const info = el.querySelector('[data-r="end-at-info"]');
      const toTs = () => {
        const m = /^(\d{1,2}):(\d{2})/.exec(inp.value || "");
        if (!m) return null;
        const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        let t = d.getTime();
        if (t > Date.now() + 60000) t -= 86400000;           // Uhrzeit von gestern (Nachtschicht)
        return t;
      };
      const upd = () => {
        const t = toTs();
        if (t == null) { info.textContent = ""; return; }
        if (t <= r.start) { info.textContent = `Muss nach dem Beginn (${util.clock(r.start)}) liegen.`; return; }
        const pauseMs = (Number(r.pauseMs) || 0) + (r.pauseStart != null && t > r.pauseStart ? t - r.pauseStart : 0);
        info.textContent = `Netto ${util.hm(Math.max(0, (t - r.start - pauseMs) / 60000))} h`;
      };
      inp.addEventListener("input", upd); upd();
      el.querySelector('[data-r="end-no"]').addEventListener("click", close);
      el.querySelector('[data-r="end-yes"]').addEventListener("click", async () => {
        const t = toTs();
        if (t == null || t <= r.start) { upd(); return; }
        close();
        await clockOutAt(t);
      });
    },
  });
}

/** Aufruf aus der Plan-Ende-Benachrichtigung (?endplan=<id>&end=<ms>). */
export async function handleEndPlan({ planId, end } = {}) {
  const { ui, util, store } = ctx;
  const r = store.get().running;
  if (!r) { ui.toast("Du bist bereits ausgestempelt."); return; }
  if (!Number.isFinite(end) || end <= r.start) { openEndSheet(); return; }
  ui.openSheet({
    title: "Schichtende",
    bodyHTML: `<p>Mit <b>${util.clock(Math.min(end, Date.now()))}</b> ausstempeln (geplantes Ende)?</p>
      <div class="row"><button type="button" class="btn ghost" data-r="ep-other">Andere Uhrzeit</button>
      <button type="button" class="btn stop" data-r="ep-yes">Ausstempeln</button></div>`,
    onMount(el, close) {
      el.querySelector('[data-r="ep-other"]').addEventListener("click", () => { close(); openEndSheet(); });
      el.querySelector('[data-r="ep-yes"]').addEventListener("click", async () => { close(); await clockOutAt(end); });
    },
  });
}

/* ---------------- App-Schnellstart (Update 7, manifest shortcuts ?action=) ---------------- */

/** Aktion vom Startbildschirm-Symbol: "in" | "pause" | "seg" | "add". Wartet kurz auf die Daten. */
export async function handleAction(name, c = ctx) {
  if (c && !ctx) ctx = c;
  if (!ctx) return;
  const a = String(name || "").toLowerCase();
  if (a === "add") { ctx.openEntryForm(null); return; }
  if (!["in", "pause", "seg"].includes(a)) return;
  const s = await waitReady();
  if (s) snap = s;
  if (!root) return;
  // Doppeltipp-Sperre bzw. laufender Vorgang: kurz warten statt verwerfen
  for (let i = 0; i < 20 && (busyOp || ctx.timer.isLocked()); i++) await new Promise((r) => setTimeout(r, 100));
  if (busyOp) return;
  const r = snap && snap.running;
  const btnOf = (act) => $("btns").querySelector(`button[data-act="${act}"]`);
  if (a === "in") {
    if (r) { ctx.ui.toast(r.pauseStart ? "Du bist schon eingestempelt (Pause)." : "Du bist schon eingestempelt."); return; }
    forceButtons();
    doClockIn(btnOf("in"));
  } else if (a === "pause") {
    if (!r) { ctx.ui.toast("Du bist nicht eingestempelt."); return; }
    doPause();
  } else if (a === "seg") {
    if (!r) { ctx.ui.toast("Du bist nicht eingestempelt."); return; }
    openSegSheet();
  }
}
