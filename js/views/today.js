// Reiter „Heute“: große Uhr, Stempel-Knöpfe, Ort-Auswahl, Notiz, Kennzahlen und heutige Einträge.

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

const SEL_KEY = "stempelkarte.selPlace";

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

function places() { return (snap && snap.places) || []; }
function settings() {
  return Object.assign({ weeklyTarget: 38.5, autoLocate: true, defaultRadius: 150 }, (snap && snap.settings) || {});
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
  lockTimer = setTimeout(() => renderButtons(), ms + 40);
  // Knöpfe sofort sperren, ohne sie zu ersetzen (der getippte Knopf zeigt evtl. gleich „Standort …“)
  if (root) $("btns").querySelectorAll("button").forEach((b) => { b.disabled = true; });
}

/* ---------------- Markup ---------------- */

export function mount(el, c) {
  ctx = c;
  root = el;
  el.innerHTML = `
<div class="stack">
  <div class="card clock" data-r="clock">
    <span class="pill" data-r="pill">Nicht eingestempelt</span>
    <div class="big" data-r="big">0:00:00</div>
    <div class="meta" data-r="meta"></div>
    <div class="meta" data-r="locline" hidden></div>
  </div>
  <div class="row" data-r="btns"></div>
  <div class="stack" data-r="pre">
    <div class="lbl">Arbeitsort</div>
    <div class="hint" data-r="near" hidden></div>
    <div class="chips" data-r="chips"></div>
    <div class="fields">
      <label>Notiz (optional)
        <input type="text" data-r="note" maxlength="300" placeholder="z. B. Aufgabe, Kunde …" autocomplete="off">
      </label>
    </div>
  </div>
  <div class="stats" data-r="stats">
    <div class="stat"><span>Heute</span><strong data-r="s-day">0:00</strong></div>
    <div class="stat"><span>Woche</span><strong data-r="s-week">0:00</strong></div>
    <div class="stat"><span>Monat</span><strong data-r="s-month">0:00</strong></div>
  </div>
  <div class="section-h">
    <h2>Heute erfasst</h2>
    <button type="button" class="btn sm ghost" data-r="add">+ Nachtragen</button>
  </div>
  <div class="stack" data-r="list"></div>
</div>`;

  $("btns").addEventListener("click", onButton);
  $("chips").addEventListener("click", onChip);
  $("list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button.entry");
    if (!b || !snap) return;
    const e = snap.entries.find((x) => x.id === b.dataset.id);
    if (e) ctx.openEntryForm(e);
  });
  $("add").addEventListener("click", () => ctx.openEntryForm(null));

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
    placeObj = findPlace(r.placeId);
    placeName = r.place || (placeObj && placeObj.name) || "";
    loc = r.inLoc;
    const pm = timer.pauseMsNow(r);
    metaHTML = `<span>seit <b>${util.clock(r.start)}</b></span>` +
      `<span>Pause <b data-r="pause">${util.hm(Math.floor(pm / 60000))}</b></span>`;
    if (r.note) metaHTML += `<span>${util.esc(r.note)}</span>`;
  } else {
    pill.textContent = `Ausgestempelt um ${util.clock(e.end)}`;
    placeObj = findPlace(e.placeId);
    placeName = e.place || (placeObj && placeObj.name) || "";
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
      desc = geofence.describe(loc, m);
    } catch { desc = ""; }
    const parts = [];
    if (desc) parts.push(util.esc(desc));
    if (loc.addr) parts.push(util.esc(loc.addr));
    locHTML = `<span>${parts.join(" · ") || "Standort erfasst"}</span>` +
      ` <a href="${util.esc(geo.mapsUrl(loc.lat, loc.lng))}" target="_blank" rel="noopener">Standort</a>`;
  }

  // Nur neu schreiben, wenn sich etwas geändert hat (Links bleiben tippbar)
  const key = metaHTML + "|" + locHTML;
  if (key !== metaKey) {
    metaKey = key;
    $("meta").innerHTML = metaHTML;
    const ll = $("locline");
    ll.innerHTML = locHTML;
    ll.hidden = !locHTML;
  }
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
  } else if (st === "done") {
    const e = doneEntry();
    ms = e ? util.netMin(e) * 60000 : 0;
  }
  const t = util.hms(ms);
  const big = $("big");
  if (big.textContent !== t) big.textContent = t;
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
    html = `<button type="button" class="btn go" data-act="in"${dis}>Einstempeln</button>`;
  } else if (st === "done") {
    html = `<button type="button" class="btn go" data-act="in"${dis}>Neue Schicht starten</button>`;
  } else {
    html = `<button type="button" class="btn pause" data-act="pause"${dis}>${st === "paused" ? "Pause beenden" : "Pause"}</button>` +
      `<button type="button" class="btn stop" data-act="out"${dis}>Ausstempeln</button>`;
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
}

function errText(e) {
  return (e && e.message) ? e.message : "Standort nicht verfügbar";
}

async function doClockIn(btn) {
  const { store, timer, geo, geofence, ui } = ctx;
  if (snap && snap.running) return;
  lockNow();
  busyOp = "in";
  disableAllButtons();
  const set = settings();
  let inLoc = null;
  try {
    if (set.autoLocate) {
      ui.setBusy(btn, true, "Standort wird ermittelt …");
      try {
        inLoc = await geo.getPosition({ timeout: 10000 });
        lastLoc = inLoc; lastLocAt = Date.now();
      } catch (e) {
        ui.toast("Ohne Standort eingestempelt: " + errText(e), 3500);
      }
    }
    // Ort: Auswahl des Nutzers hat Vorrang, sonst automatisch per Geofence
    let place = selPlace();
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
      });
      noteEl.value = "";
      done = null;
      ui.toast(place ? `Eingestempelt · ${place.name}` : "Eingestempelt");
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
    forceButtons();
    renderAll();
  }
  if (inLoc) fillRunningAddr(inLoc);
}

/** Adresse der laufenden Schicht nachträglich ergänzen – nur wenn es noch dieselbe Schicht ist. */
async function fillRunningAddr(inLoc) {
  const { store, geo } = ctx;
  const r0 = store.get().running;
  if (!r0) return;
  const start = r0.start;
  let addr = null;
  try { addr = await geo.reverseGeocode(inLoc.lat, inLoc.lng); } catch { addr = null; }
  if (!addr) return;
  const r = store.get().running;
  if (!r || r.start !== start || !r.inLoc || r.inLoc.addr) return;
  try { await store.setRunning({ ...r, inLoc: { ...r.inLoc, addr } }); } catch { /* Toast kommt vom Store */ }
}

async function doPause() {
  const { timer, ui } = ctx;
  lockNow();
  busyOp = "pause";
  disableAllButtons();
  try {
    await timer.togglePause();
  } catch (e) {
    ui.toast("Pause konnte nicht gespeichert werden" + (e && e.message ? ": " + e.message : ""), 3500);
  } finally {
    busyOp = null;
    snap = ctx.store.get() || snap;
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
        outLoc = await withTimeout(geo.getPosition({ timeout: 8000 }), 8000);
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
      entry = await timer.clockOut({ outLoc });
      if (entry) done = entry;
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
    if (e.inLoc && !e.inLoc.addr) inAddr = await geo.reverseGeocode(e.inLoc.lat, e.inLoc.lng);
  } catch { /* nie kritisch */ }
  if (!outAddr && !inAddr) return;
  e = cur();
  if (!e) return; // inzwischen gelöscht
  const next = { ...e };
  if (outAddr && e.outLoc && !e.outLoc.addr) next.outLoc = { ...e.outLoc, addr: outAddr };
  if (inAddr && e.inLoc && !e.inLoc.addr) next.inLoc = { ...e.inLoc, addr: inAddr };
  if (next.outLoc === e.outLoc && next.inLoc === e.inLoc) return;
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
  nearEl.hidden = !near;

  const sel = getSel();
  const ps = places();
  const key = JSON.stringify([sel, locating, ps.map((p) => [p.id, p.name])]);
  if (key === chipsKey) return;
  chipsKey = key;
  let html = ps.map((p) =>
    `<button type="button" class="chip" data-id="${util.esc(p.id)}" aria-pressed="${p.id === sel ? "true" : "false"}">${util.esc(p.name)}</button>`
  ).join("");
  html += `<button type="button" class="chip add" data-act="addplace"${locating ? " disabled" : ""}>` +
    `${locating ? "Standort wird ermittelt …" : "+ Ort hier speichern"}</button>`;
  $("chips").innerHTML = html;
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
    loc = await geo.getPosition({ timeout: 12000 });
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
  if (Date.now() - lastLocAt < 60000) { renderPre(); return; }
  if (!settings().autoLocate) return;
  if (!places().some((p) => typeof p.lat === "number" && typeof p.lng === "number")) return;
  try {
    if (!geo.isSupported()) return;
    if ((await geo.permission()) !== "granted") return;
    const loc = await geo.getPosition({ timeout: 10000, maxAge: 60000 });
    lastLoc = loc; lastLocAt = Date.now();
    renderPre();
  } catch { /* still ignorieren */ }
}

/* ---------------- Kennzahlen & Liste ---------------- */

function sumSince(fromTs) {
  const { util, timer } = ctx;
  let min = 0;
  const entries = (snap && snap.entries) || [];
  for (const e of entries) if (e.start >= fromTs) min += util.netMin(e);
  // vorläufige beendete Schicht, deren Eintrag noch nicht im Store ist
  if (done && done.start >= fromTs && !entries.some((e) => (done.id ? e.id === done.id : e.start === done.start))) {
    min += util.netMin(done);
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
  const key = JSON.stringify(list.map((e) => [e.id, e.start, e.end, e.pauseMin, e.place, e.note]));
  if (key === listKey) return;
  listKey = key;
  if (!list.length) {
    $("list").innerHTML = `<div class="empty"><h3>Heute noch nichts erfasst</h3>` +
      `<p class="note">Stempel ein oder trag eine Zeit mit „+ Nachtragen“ nach.</p></div>`;
    return;
  }
  $("list").innerHTML = list.map((e) => {
    const bits = [];
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
  renderButtons();   // zeichnet nur bei Zustandswechsel (z. B. Sperre abgelaufen)
  if (state() === "idle" || state() === "done") renderList(); // Tageswechsel
}

export function onShow() {
  if (!root || !ctx) return;
  if (snap) renderAll();
  refreshNear();
}
