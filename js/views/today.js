// Reiter „Heute“: große Uhr, Stempel-Knöpfe, Ort-Auswahl, Notiz, Kennzahlen, heutige Einträge
// und kurze Hinweis-Kärtchen (Orts-Vorschlag, vergessenes Ausstempeln, Pausen-Erinnerung).

import { icon } from "../icons.js";
import { leaves, sparkles, emptyClipboard } from "../deco.js";

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
let locating = false;
let lockTimer = null;
let tipsKey = "";         // zuletzt gezeichnetes Hinweis-Kärtchen
let progKey = "";
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

/** Gewählter Ort, nur wenn er noch existiert. */
function selPlace() { return findPlace(getSel()); }

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
  <div class="card clock" data-r="clock">
    <div class="clock-deco" aria-hidden="true">${sparkles()}${leaves("left")}${leaves("right")}</div>
    <span class="pill" data-r="pill">Nicht eingestempelt</span>
    <div class="big" data-r="big">0:00:00</div>
    <div class="dayprog" data-r="prog">
      <div class="progress" data-r="progwrap"><div data-r="progbar" style="width:0%"></div></div>
      <span data-r="progtxt"></span>
    </div>
    <div class="seg-now" data-r="segnow" hidden></div>
    <div class="meta" data-r="meta"></div>
    <div class="meta" data-r="locline" hidden></div>
    <ol class="seg-list" data-r="seglist" hidden></ol>
    <button type="button" class="linkbtn" data-r="editstart" hidden>Beginn ändern</button>
  </div>
  <div class="stack" data-r="tips" hidden></div>
  <div class="row" data-r="btns"></div>
  <div class="stack" data-r="pre">
    <div class="lbl lbl-ico">${icon("briefcase", 20)}<span>Tätigkeit</span></div>
    <div class="chips" data-r="acts"></div>
    <div class="lbl lbl-ico">${icon("pin", 20)}<span>Arbeitsort</span></div>
    <div class="hint" data-r="near" hidden></div>
    <div class="chips" data-r="chips"></div>
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && root && !root.hidden) refreshNear();
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
    pill.textContent = "Nicht eingestempelt";
    metaHTML = `<span>Tippe auf „Einstempeln“, wenn du anfängst.</span>`;
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
    if (r.note) metaHTML += `<span>${util.esc(r.note)}</span>`;
  } else {
    pill.textContent = `Ausgestempelt um ${util.clock(e.end)}`;
    placeObj = findPlace(e.placeId);
    placeName = placeLabel(e.place || (placeObj && placeObj.name) || "", e.inLoc);
    loc = e.inLoc;
    metaHTML = `<span><b>${util.clock(e.start)} – ${util.clock(e.end)}</b></span>` +
      `<span>Pause <b>${util.hm(e.pauseMin || 0)}</b></span>`;
    if (e.note) metaHTML += `<span>${util.esc(e.note)}</span>`;
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
          `<span class="seg-act">${util.esc(g.activity || "Arbeiten")}</span> – <span class="seg-route">${route}</span></li>`;
      }).join("");
    }
  }

  const key = metaHTML + "|" + locHTML + "|" + segHTML + "|" + listHTML;
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
    $("meta").innerHTML = metaHTML;
    const ll = $("locline");
    ll.innerHTML = locHTML;
    ll.hidden = !locHTML;
  }
  const es = $("editstart");
  const showEdit = st === "running" || st === "paused";
  if (es.hidden === showEdit) es.hidden = !showEdit;
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
  if (target <= 0) {
    free = true;
    const h = holiday(now);
    txt = h ? `Heute frei (Feiertag: ${h})` : "Heute frei";
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
    const p = findPlace(curSeg.placeId);
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
    // Direkt nach dem Ausstempeln nicht gleich wieder zum Einstempeln drängen
    const e = st === "done" ? doneEntry() : null;
    if (e && Date.now() - e.end < 15 * 60000) return null;
    if (!locFresh(e ? e.end : 0)) return null;
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
  } else if (act === "tip-out") {
    doClockOut(btn);
  } else if (act === "tip-forgot") {
    doForgotOut(btn);
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

  lockNow();
  busyOp = "out";
  disableAllButtons();
  ui.setBusy(btn, true, "Wird gespeichert …");
  const pauseMs = (Number(r.pauseMs) || 0) + (r.pauseStart != null && end > r.pauseStart ? end - r.pauseStart : 0);
  done = {
    id: null, start: r.start, end,
    pauseMin: Math.round(pauseMs / 60000),
    placeId: r.placeId ?? null, place: r.place || "", note: r.note || "",
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
    try { ui.setBusy(btn, false); } catch { /* egal */ }
    snap = store.get() || snap;
    if (snap.running) done = null;
    if (!saved) done = null;
    metaKey = "";
    tipsKey = "";
    forceButtons();
    renderAll();
  }
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

async function doClockIn(btn, forcedPlace = null) {
  const { store, timer, geo, geofence, ui } = ctx;
  if (snap && snap.running) return;
  lockNow();
  busyOp = "in";
  disableAllButtons();
  const set = settings();
  let inLoc = null;
  try {
    if (set.autoLocate && forcedPlace && lastLoc && Date.now() - lastLocAt < 120000) {
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
    try {
      await timer.clockIn({
        placeId: place ? place.id : null,
        place: place ? place.name : "",
        note,
        inLoc,
        activity: getAct(),
      });
      noteEl.value = "";
      done = null;
      buzz(40);
      ui.toast(place ? `Eingestempelt · ${place.name}` : (inLoc ? "Eingestempelt · Adresse wird ermittelt …" : "Eingestempelt · Ort unbekannt"));
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
        outLoc = await withTimeout(geo.getPosition({ timeout: 8000, maxAge: 5000 }), 8000);
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

  const sel = getSel();
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
        loc = await withTimeout(geo.getPosition({ timeout: 10000, maxAge: 0 }), 10000);
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
  setSel(getSel() === id ? null : id);
  // direkt umschalten, ohne alles neu zu zeichnen
  $("chips").querySelectorAll("button.chip[data-id]").forEach((c) => {
    c.setAttribute("aria-pressed", c.dataset.id === getSel() ? "true" : "false");
  });
  chipsKey = JSON.stringify([getSel(), locating, places().map((p) => [p.id, p.name])]);
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
  const key = JSON.stringify(list.map((e) => [e.id, e.start, e.end, e.pauseMin, e.place, e.note, e.kind, e.creditMin]));
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
    if (e.place) bits.push(`<span class="tag">${util.esc(e.place)}</span>`);
    if (e.pauseMin) bits.push(`Pause ${util.hm(e.pauseMin)}`);
    if (e.note) bits.push(util.esc(e.note));
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
  renderTips();      // zeichnet nur, wenn sich das passende Kärtchen ändert
  renderButtons();   // zeichnet nur bei Zustandswechsel (z. B. Sperre abgelaufen)
  if (state() === "idle" || state() === "done") renderList(); // Tageswechsel
}

export function onShow() {
  if (!root || !ctx) return;
  if (snap) renderAll();
  refreshNear();
}
