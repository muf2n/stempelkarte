// Update 10d – Baustellen-Projektseite (Vollbild über dem Reiter „Orte“, Adresse #orte/baustelle/<id>).
// Projektdaten (Ansprechpartner, Telefon, Beginn/Ende, Status, Notizen, Team) liegen als optionale Felder am Ort.
// Verknüpft echte Daten: Arbeitszeiten, Material, Fotos (Galerie-Index), Fahrten, Aufgaben/Einsätze,
// Zeitleiste (+ eigene Tagebuch-Einträge in der Alltag-Sammlung „site_log“), Vorher/Nachher, QR-Code, Bericht (Drucken/PDF).
import * as S from "../site-core.js";
import * as M from "../alltag/material-core.js";
import { collection } from "../alltag/db.js";
import { mountPlaceMaterial } from "../alltag/material.js";
import { qrSVG } from "../alltag/qr.js";
import * as photos from "../photos.js";
import * as galleryAlbums from "../gallery-albums.js";
import { openViewer } from "./gallery.js";
import { tripsBetween } from "../travel.js";
import { icon } from "../icons.js";
import { linkedDocsHTML, watchDocs, injectCSS as injectAktenCSS } from "../alltag/akten-ui.js"; // Update 10 E – 📎 Dokumente
import { customerOfPlace, displayName, telHref, typeById, contactHash } from "../alltag/kontakte-core.js"; // Update 10 E – 👤 Kunde

const ROOT_ID = "site-root";
const REPORT_ID = "sr-root";
let cur = null;       // { id, el, ctx, unsubs: [], pushed, prevFocus, prevOverflow, state }
let report = null;

let logCol = null, matCol = null, ktCol = null, dkCol = null, ppCol = null; // ppCol: Update 14 – Prüfprotokolle
const cols = () => {
  if (!logCol) { logCol = collection("site_log"); matCol = collection("material_items"); ktCol = collection("kontakte"); dkCol = collection("dokumente"); ppCol = collection("pruefungen"); }
  return { log: logCol, mat: matCol, kt: ktCol, dk: dkCol, pp: ppCol };
};

/* Update 10 E – 👤 Kunde (Kontakte, optional place.customerId) + 📎 Dokumente */
function customerHTML(place) {
  const c = customerOfPlace(place, cols().kt.all());
  if (!c) return `<section class="st-card" id="st-customer"><header class="st-h"><h2>👤 Kunde</h2><a class="btn sm ghost" href="#alltag/kontakte">Kontakte</a></header>
    <p class="note">Noch kein Kunde verknüpft – in Alltag › 👤 Kunden &amp; Kontakte kannst du diese Baustelle einem Kontakt zuordnen.</p></section>`;
  const tel = telHref(c.phone);
  return `<section class="st-card" id="st-customer"><header class="st-h"><h2>👤 Kunde</h2>${tel ? `<a class="btn sm primary" href="${esc(tel)}">📞 Anrufen</a>` : ""}</header>
    <a class="st-cust" href="${esc(contactHash(c.id))}"><span aria-hidden="true">${typeById(c.type).e}</span><span><b>${esc(displayName(c))}</b><small>${esc([c.person, c.phone].filter(Boolean).join(" · "))}</small></span></a></section>`;
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayKey = () => S.keyOf(Date.now());
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const dayLabel = (k) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)); return `${WD[d.getDay()]}, ${S.fmtKey(k)}`; };
const kmText = (km) => `${String(Math.round((Number(km) || 0) * 10) / 10).replace(".", ",")} km`;

/** sites.css einmal einhängen (Liste in „Orte“ + Projektseite). */
export function injectSiteCSS() {
  if (document.getElementById("st-css")) return;
  const l = document.createElement("link");
  l.id = "st-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/sites.css", import.meta.url).href;
  document.head.appendChild(l);
}

/** Ist die Projektseite für diesen Ort gerade offen? */
export function isOpen(id) { return !!cur && (!id || cur.id === id); }

/* ---------- Daten sammeln ---------- */

function gather(ctx, place) {
  const snap = ctx.store.get() || {};
  const st = cur ? cur.state : { photoIdx: [], albums: [] };
  const entries = snap.entries || [];
  const work = S.workSummary(entries, place);
  const mat = S.siteMaterial(cols().mat.all(), place);
  const ph = S.sitePhotos(st.photoIdx, place, st.albums);
  let trips = { list: [], km: 0 };
  try { trips = S.siteTrips(tripsBetween(entries, 0, Date.now() + 864e5, snap.settings || {}, snap.places || []), place); } catch (e) { console.error(e); }
  const todos = S.siteTodos(snap.todos || [], place);
  const log = cols().log.all().map(S.normLog).filter((x) => x && x.placeId === place.id);
  const timeline = S.buildTimeline({ place, entries, running: snap.running, photos: ph, material: mat.items, log, todos: [...todos.aufgaben, ...todos.einsaetze] });
  return { snap, work, mat, ph, trips, todos, log, timeline, status: S.siteStatus(place, todayKey()), running: S.runningHere(snap.running, place) };
}

function placeOf(ctx, id) { return ((ctx.store.get() || {}).places || []).find((p) => p && p.id === id) || null; }

/* ---------- Rendern ---------- */

function heroHTML(place, d) {
  const meta = S.STATUS_META[d.status];
  const tel = S.telHref(place.phone);
  const dates = place.siteStart || place.siteEnd
    ? `${place.siteStart ? S.fmtKey(place.siteStart) : "offen"} – ${place.siteEnd ? S.fmtKey(place.siteEnd) : "offen"}` : "";
  const crew = Array.isArray(place.crew) ? place.crew : [];
  return `<section class="st-hero" data-status="${d.status}">
    <div class="st-hero-top">
      <span class="st-badge" data-st="status" role="button" tabindex="0" aria-label="Status ändern: ${esc(meta.l)}">${meta.e} ${esc(meta.l)}</span>
      ${d.running ? `<span class="st-live">● Du bist gerade hier eingestempelt</span>` : ""}
    </div>
    <h1 class="st-name">🏗️ ${esc(place.name || "Baustelle")}</h1>
    ${place.addr ? `<p class="st-addr">📍 <span class="st-sel">${esc(place.addr)}</span></p>` : ""}
    <dl class="st-facts">
      ${dates ? `<div><dt>Zeitraum</dt><dd>🗓️ ${esc(dates)}</dd></div>` : ""}
      ${place.contact ? `<div><dt>Ansprechpartner</dt><dd class="st-sel">👤 ${esc(place.contact)}</dd></div>` : ""}
      ${place.phone ? `<div><dt>Telefon</dt><dd><span class="st-sel st-phone">${esc(place.phone)}</span>${tel ? ` <a class="btn sm ghost st-call" href="${esc(tel)}">📞 Anrufen</a>` : ""}</dd></div>` : ""}
      ${crew.length ? `<div><dt>Team</dt><dd class="st-crew">${crew.map((n) => `<span class="chip st-chip">👷 ${esc(n)}</span>`).join("")}</dd></div>` : ""}
    </dl>
    ${place.siteNotes ? `<div class="st-notes"><b>📝 Notizen</b><p class="st-sel">${esc(place.siteNotes)}</p></div>` : ""}
    ${!dates && !place.contact && !place.phone && !crew.length && !place.siteNotes ? `<p class="note">Tipp: Trag Ansprechpartner, Telefon, Zeitraum und Team ein – tipp auf „✏️ Projektdaten“. 😊</p>` : ""}
    <div class="st-actions">
      ${(Number.isFinite(place.lat) && Number.isFinite(place.lng)) || place.addr ? `<button type="button" class="btn sm ghost" data-st="route">🗺️ Route</button>` : ""}
      <button type="button" class="btn sm ghost" data-st="edit">✏️ Projektdaten</button>
      <button type="button" class="btn sm ghost" data-st="qr">🔳 QR-Code</button>
      <button type="button" class="btn sm ghost" data-st="report">📄 Bericht</button>
      <button type="button" class="btn sm ghost" data-st="place">⚙️ Ort & Erkennung</button>
    </div>
  </section>`;
}

function statsHTML(d) {
  const tile = (e, v, l, go) => `<button type="button" class="st-stat" data-st="jump" data-to="${go}"><span class="st-stat-e" aria-hidden="true">${e}</span><b>${esc(v)}</b><small>${esc(l)}</small></button>`;
  return `<div class="st-stats">
    ${tile("⏱️", S.hm(d.work.totalMin) + " h", `${d.work.days} ${d.work.days === 1 ? "Tag" : "Tage"}`, "st-work")}
    ${tile("🧰", String(d.mat.open), d.mat.fehlt.length ? `offen · ${d.mat.fehlt.length} fehlt` : "offen", "st-mat")}
    ${tile("📷", String(d.ph.length), d.ph.length === 1 ? "Foto" : "Fotos", "st-photos")}
    ${tile("🚗", kmText(d.trips.km), `${d.trips.list.length} ${d.trips.list.length === 1 ? "Fahrt" : "Fahrten"}`, "st-trips")}
  </div>`;
}

function workHTML(d) {
  const all = cur && cur.state.allWork;
  const list = all ? d.work.list : d.work.list.slice(0, 8);
  const rows = list.map((x) => {
    const e = x.entry;
    const who = Array.isArray(e.people) && e.people.length ? ` · mit ${e.people.map(esc).join(", ")}` : "";
    return `<li><button type="button" class="st-row" data-st="entry" data-id="${esc(e.id || "")}">
      <span class="st-row-d">${esc(dayLabel(x.dayKey))}</span>
      <span class="st-row-t">${S.clockOf(e.start)}–${S.clockOf(e.end)}${who}${e.note ? ` · ${esc(e.note)}` : ""}</span>
      <b class="st-row-h">${S.hm(x.min)} h</b></button></li>`;
  }).join("");
  return `<section class="st-card" id="st-work"><header class="st-h"><h2>⏱️ Arbeitszeiten</h2><span class="st-sum">${S.hm(d.work.totalMin)} h gesamt</span></header>
    ${d.work.list.length ? `<p class="note">${d.work.first ? `Seit ${esc(S.fmtKey(S.keyOf(d.work.first)))}` : ""}${d.work.people.length ? ` · gemeinsam mit ${esc(d.work.people.join(", "))}` : ""}</p>
      <ul class="st-list">${rows}</ul>
      ${d.work.list.length > 8 ? `<button type="button" class="btn sm ghost" data-st="allwork">${all ? "Weniger anzeigen" : `Alle ${d.work.list.length} anzeigen`}</button>` : ""}`
      : `<p class="note">Noch keine Arbeitszeit hier. Stempel dich hier ein, dann taucht sie automatisch auf. ⏱️</p>`}
  </section>`;
}

function matHTML(d) {
  const fehlt = d.mat.fehlt;
  return `<section class="st-card" id="st-mat"><header class="st-h"><h2>🧰 Material</h2>
      <button type="button" class="btn sm ghost" data-st="matlist">Zur Materialliste ›</button></header>
    ${fehlt.length ? `<div class="st-fehlt"><b>⚠️ Fehlt noch (${fehlt.length})</b><ul>${M.totals(fehlt).map((t) => `<li>${esc(M.lineText(t))}</li>`).join("")}</ul></div>` : ""}
    <div class="st-mat-host" data-st-host="mat"></div>
  </section>`;
}

function photoTile(p, n) {
  const ph = p.phase === "vorher" ? `<span class="st-ph-tag">Vorher</span>` : p.phase === "nachher" ? `<span class="st-ph-tag after">Nachher</span>` : "";
  return `<button type="button" class="st-th" data-st="photo" data-n="${n}" aria-label="Foto vom ${esc(S.fmtKey(S.keyOf(p.ts)))}${p.note ? ": " + esc(p.note) : ""}">
    ${p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy" decoding="async">` : `<span class="st-th-x">📷</span>`}${ph}</button>`;
}

function photosHTML(d) {
  const loading = cur && !cur.state.photosLoaded;
  const ba = S.beforeAfter(d.ph);
  const total = Math.max(1, ba.vorher.length, ba.nachher.length);
  const k = (cur ? cur.state.pair || 0 : 0) % total;
  let cmp = "";
  if (ba.vorher.length && ba.nachher.length) {
    const v = ba.vorher[Math.min(k, ba.vorher.length - 1)], n = ba.nachher[Math.min(k, ba.nachher.length - 1)];
    const many = total > 1;
    cmp = `<div class="st-ba">
      <div class="st-ba-h"><b>↔️ Vorher / Nachher</b>${many ? `<span class="st-ba-nav">
        <button type="button" class="btn sm ghost" data-st="pair" data-d="-1" aria-label="Voriges Paar">‹</button>
        <span>${k + 1}/${total}</span>
        <button type="button" class="btn sm ghost" data-st="pair" data-d="1" aria-label="Nächstes Paar">›</button></span>` : ""}</div>
      <div class="st-ba-grid">
        <figure><img data-full="${esc(v.id)}" src="${esc(v.thumb || "")}" alt="Vorher"><figcaption>Vorher · ${esc(S.fmtKey(S.keyOf(v.ts)))}</figcaption></figure>
        <figure><img data-full="${esc(n.id)}" src="${esc(n.thumb || "")}" alt="Nachher"><figcaption>Nachher · ${esc(S.fmtKey(S.keyOf(n.ts)))}</figcaption></figure>
      </div></div>`;
  } else if (d.ph.length) {
    cmp = `<p class="note">Tipp: Tipp ein Foto an und markier es als <b>Vorher</b> oder <b>Nachher</b> – dann siehst du hier den Vergleich. ✨</p>`;
  }
  return `<section class="st-card" id="st-photos"><header class="st-h"><h2>📷 Fotos</h2><span class="st-sum">${d.ph.length}</span></header>
    ${loading ? `<p class="note">Fotos werden geladen …</p>` : d.ph.length ? `<div class="st-thumbs">${d.ph.slice().reverse().map((p) => photoTile(p, d.ph.indexOf(p))).join("")}</div>`
      : `<p class="note">Noch keine Fotos von hier. In „Heute“ während der Arbeit auf „Foto aufnehmen“ tippen. 📸</p>`}
    ${cmp}
  </section>`;
}

function tripsHTML(d) {
  const list = d.trips.list.slice().reverse().slice(0, 10);
  return `<section class="st-card" id="st-trips"><header class="st-h"><h2>🚗 Fahrten</h2><span class="st-sum">${esc(kmText(d.trips.km))}</span></header>
    ${list.length ? `<ul class="st-list">${list.map((t) => `<li><div class="st-row static">
        <span class="st-row-d">${esc(dayLabel(S.keyOf(t.start)))}</span>
        <span class="st-row-t">${S.clockOf(t.start)} · ${esc(t.from || t.fromAddr || "?")} → ${esc(t.to || t.toAddr || "?")}</span>
        <b class="st-row-h">${t.km != null ? esc(kmText(t.km)) : "–"}</b></div></li>`).join("")}</ul>
      ${d.trips.list.length > 10 ? `<p class="note">… und ${d.trips.list.length - 10} weitere im Fahrtenbuch.</p>` : ""}`
      : `<p class="note">Noch keine Fahrten zu dieser Baustelle erfasst.</p>`}
  </section>`;
}

function todosHTML(d) {
  const { aufgaben, einsaetze } = d.todos;
  const open = aufgaben.filter((t) => !t.done), done = aufgaben.filter((t) => t.done);
  const tRow = (t) => `<li><button type="button" class="st-row" data-st="todo" data-id="${esc(t.id)}">
    <span class="st-row-d">${t.done ? "✅" : "⬜"}</span><span class="st-row-t${t.done ? " st-done" : ""}">${esc(t.title || "Aufgabe")}</span>
    <b class="st-row-h">${t.date ? esc(S.fmtKey(t.date)) : ""}</b></button></li>`;
  const eRow = (t) => `<li><button type="button" class="st-row" data-st="todo" data-id="${esc(t.id)}">
    <span class="st-row-d">📌</span><span class="st-row-t">Einsatz ${esc(S.fmtKey(t.date))}${t.dateTo && t.dateTo !== t.date ? ` – ${esc(S.fmtKey(t.dateTo))}` : ""}${Array.isArray(t.people) && t.people.length ? ` · mit ${esc(t.people.join(", "))}` : ""}</span></button></li>`;
  return `<section class="st-card" id="st-todos"><header class="st-h"><h2>✅ Aufgaben & Einsätze</h2>
      <button type="button" class="btn sm ghost" data-st="addtodo">+ Aufgabe</button></header>
    ${einsaetze.length ? `<ul class="st-list">${einsaetze.map(eRow).join("")}</ul>` : ""}
    ${open.length || done.length ? `<ul class="st-list">${[...open, ...done.slice(0, 5)].map(tRow).join("")}</ul>`
      : `<p class="note">Keine offenen Aufgaben für diese Baustelle. 🎉 Im Planer kannst du Aufgaben einer Baustelle zuordnen.</p>`}
  </section>`;
}

function timelineHTML(d) {
  const groups = S.groupByDay(d.timeline);
  const max = cur && cur.state.allTimeline ? groups.length : 7;
  return `<section class="st-card" id="st-timeline"><header class="st-h"><h2>📜 Zeitleiste</h2>
      <button type="button" class="btn sm primary" data-st="addlog">+ Eintrag</button></header>
    ${groups.length ? `<ol class="st-tl">${groups.slice(0, max).map((g) => `<li class="st-tl-day"><h3>${esc(dayLabel(g.dayKey))}</h3><ul>${g.events.map((e) =>
      `<li class="st-ev k-${e.kind}">${e.kind === "log" ? `<button type="button" class="st-ev-b" data-st="log" data-id="${esc(e.ref || "")}">` : `<div class="st-ev-b">`}
        <span class="st-ev-t">${S.clockOf(e.ts)}</span><span class="st-ev-i" aria-hidden="true">${e.icon}</span><span class="st-ev-x">${esc(e.text)}</span>
      ${e.kind === "log" ? `</button>` : `</div>`}</li>`).join("")}</ul></li>`).join("")}</ol>
      ${groups.length > max ? `<button type="button" class="btn sm ghost" data-st="alltl">Ältere Tage anzeigen (${groups.length - max})</button>` : ""}`
      : `<p class="note">Noch nichts passiert. Mit „+ Eintrag“ hältst du fest, was du gemacht hast – z. B. „08:15 Leitungen verlegt“. 📝</p>`}
  </section>`;
}

/** Update 14 – ⚡ Prüfprotokolle dieser Baustelle (Alltag › Prüfprotokoll). */
function pruefHTML(place) {
  const list = cols().pp.all().filter((p) => p && p.placeId === place.id);
  return `<section class="card st-card"><h3>⚡ Prüfprotokolle</h3>${list.length ? `<ul class="st-pp">${list.map((p) => `<li>${p.status === "fertig" ? "✅" : "📝"} ${esc(p.date ? p.date.split("-").reverse().join(".") : "")} · ${esc(p.kunde || "Protokoll")} · ${(p.circuits || []).length} Stromkreise</li>`).join("")}</ul>` : `<p class="note">Noch keine Prüfung für diese Baustelle.</p>`}
    <a class="btn ghost sm" href="#alltag/pruefung">⚡ Zu den Prüfprotokollen</a></section>`;
}

function render() {
  if (!cur) return;
  const place = placeOf(cur.ctx, cur.id);
  const main = cur.el.querySelector(".st-main");
  if (!place) {
    main.innerHTML = `<div class="empty"><h3>🤔 Baustelle nicht gefunden</h3><p class="note">Vielleicht wurde der Ort gelöscht – oder er ist noch nicht geladen.</p></div>`;
    cur.el.querySelector(".st-title").textContent = "Baustelle";
    return;
  }
  const d = gather(cur.ctx, place);
  cur.last = { place, d };
  cur.el.querySelector(".st-title").textContent = place.name || "Baustelle";
  const scroll = cur.el.scrollTop;
  // Material-Bereich (fremdes Modul) nicht bei jedem Neuzeichnen neu einhängen
  const matHost = main.querySelector('[data-st-host="mat"]');
  main.innerHTML = heroHTML(place, d) + statsHTML(d) +
    `<div class="st-cols"><div class="st-col">${timelineHTML(d)}${todosHTML(d)}</div>` +
    `<div class="st-col">${customerHTML(place)}${workHTML(d)}${matHTML(d)}${photosHTML(d)}${tripsHTML(d)}${pruefHTML(place)}${linkedDocsHTML("place", place.id, { cls: "st-docs" })}</div></div>`;
  const newHost = main.querySelector('[data-st-host="mat"]');
  if (matHost && matHost.dataset.pid === place.id) newHost.replaceWith(matHost);
  else { newHost.dataset.pid = place.id; try { mountPlaceMaterial(newHost, place); } catch (e) { console.error(e); } }
  cur.el.scrollTop = scroll;
  loadFullBA();
}

/** Vorher/Nachher in voller Auflösung nachladen. */
function loadFullBA() {
  if (!cur) return;
  cur.el.querySelectorAll(".st-ba img[data-full]").forEach((img) => {
    const id = img.dataset.full;
    photos.getPhoto(id).then((p) => { if (p && p.data && img.isConnected && img.dataset.full === id) img.src = p.data; }).catch(() => {});
  });
}

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; render(); });
}

async function loadPhotos() {
  if (!cur) return;
  const c = cur;
  try {
    await galleryAlbums.albumsReady().catch(() => {});
    const idx = await photos.listIndex();
    if (c !== cur) return;
    c.state.photoIdx = idx;
    c.state.albums = galleryAlbums.albums();
  } catch (e) { console.warn("Fotos für Baustelle:", e); }
  if (c !== cur) return;
  c.state.photosLoaded = true;
  queueRender();
}

/* ---------- Aktionen ---------- */

function openEdit() {
  const ctx = cur.ctx, place = placeOf(ctx, cur.id);
  if (!place) return;
  const known = Array.isArray((ctx.store.get().settings || {}).people) ? ctx.store.get().settings.people : [];
  const crew0 = Array.isArray(place.crew) ? place.crew : [];
  const people = [...new Set([...known, ...crew0].map((n) => String(n || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const st = { status: S.normStatus(place.siteStatus) || S.siteStatus(place, todayKey()), crew: crew0.slice() };
  ctx.ui.openSheet({
    title: "✏️ Projektdaten",
    bodyHTML: `<div class="fields st-form">
      <div><div class="lbl">Status</div><div class="chips st-stchips" data-f="status">${S.STATUSES.map((k) =>
        `<button type="button" class="chip" data-v="${k}" aria-pressed="${k === st.status}">${S.STATUS_META[k].e} ${S.STATUS_META[k].l}</button>`).join("")}</div></div>
      <label>Ansprechpartner<input id="st-contact" type="text" maxlength="120" autocomplete="off" placeholder="z. B. Bauleiter Herr Muster" value="${esc(place.contact || "")}"></label>
      <label>Telefon<input id="st-phone" type="tel" inputmode="tel" maxlength="40" autocomplete="off" placeholder="+43 …" value="${esc(place.phone || "")}"></label>
      <div class="row"><label>Beginn<input id="st-start" type="date" value="${esc(place.siteStart || "")}"></label>
        <label>Ende<input id="st-end" type="date" value="${esc(place.siteEnd || "")}"></label></div>
      <div><div class="lbl">Wer arbeitet mit? 👷</div><div class="chips" data-f="crew">${people.length ? people.map((n) =>
        `<button type="button" class="chip" data-n="${esc(n)}" aria-pressed="${st.crew.includes(n)}">${esc(n)}</button>`).join("")
        : `<span class="note">Noch keine Kolleg:innen gespeichert – die kommen aus „Mit wem?“ beim Einstempeln.</span>`}</div></div>
      <label>Notizen<textarea id="st-notes" rows="4" maxlength="4000" placeholder="z. B. Schlüssel beim Hausmeister, Zählerkasten im Keller">${esc(place.siteNotes || "")}</textarea></label>
    </div>
    <div class="stack" style="margin-top:14px"><button type="button" class="btn primary" data-f="save">Speichern</button></div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      $('[data-f="status"]').addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-v]"); if (!b) return;
        st.status = b.dataset.v;
        sheet.querySelectorAll('[data-f="status"] [data-v]').forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === st.status)));
      });
      $('[data-f="crew"]').addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-n]"); if (!b) return;
        const n = b.dataset.n;
        st.crew = st.crew.includes(n) ? st.crew.filter((x) => x !== n) : [...st.crew, n];
        b.setAttribute("aria-pressed", String(st.crew.includes(n)));
      });
      const save = $('[data-f="save"]');
      save.addEventListener("click", async () => {
        const f = S.cleanSiteFields({
          contact: $("#st-contact").value, phone: $("#st-phone").value, siteStatus: st.status,
          siteStart: $("#st-start").value, siteEnd: $("#st-end").value, siteNotes: $("#st-notes").value, crew: st.crew,
        });
        const fresh = placeOf(ctx, place.id) || place;
        ctx.ui.setBusy(save, true, "Speichert …");
        try {
          await ctx.store.savePlace({ ...fresh, ...f });
          close();
          ctx.ui.toast(f.siteStatus === "abgeschlossen" ? "✅ Baustelle abgeschlossen – super Arbeit! 🎉" : "Projektdaten gespeichert 👍", 2200);
        } catch { ctx.ui.setBusy(save, false); }
      });
    },
  });
}

function openStatus() {
  const ctx = cur.ctx, place = placeOf(ctx, cur.id);
  if (!place) return;
  const now = S.siteStatus(place, todayKey());
  ctx.ui.openSheet({
    title: "Status der Baustelle",
    bodyHTML: `<div class="stack st-stpick">${S.STATUSES.map((k) =>
      `<button type="button" class="btn ${k === now ? "primary" : "ghost"}" data-v="${k}">${S.STATUS_META[k].e} ${S.STATUS_META[k].l}</button>`).join("")}</div>`,
    onMount(sheet, close) {
      sheet.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-v]"); if (!b) return;
        try {
          await ctx.store.savePlace({ ...(placeOf(ctx, place.id) || place), siteStatus: b.dataset.v });
          close();
          ctx.ui.toast(`Status: ${S.statusLabel(b.dataset.v)}`, 1800);
        } catch { /* Toast vom Store */ }
      });
    },
  });
}

function openLogForm(entry = null) {
  const ctx = cur.ctx, pid = cur.id;
  const k0 = entry ? S.keyOf(entry.ts) : todayKey();
  const t0 = entry ? S.clockOf(entry.ts) : S.clockOf(Date.now());
  ctx.ui.openSheet({
    title: entry ? "📝 Eintrag bearbeiten" : "📝 Neuer Eintrag",
    bodyHTML: `<div class="fields">
      <label>Was hast du gemacht?<textarea id="sl-text" rows="3" maxlength="${S.LOG_MAX}" placeholder="z. B. 08:15 Leitungen verlegt">${esc(entry ? entry.text : "")}</textarea></label>
      <div class="row"><label>Tag<input id="sl-day" type="date" value="${esc(k0)}"></label><label>Uhrzeit<input id="sl-time" type="time" value="${esc(t0)}"></label></div>
      <p class="note">Tipp: Schreibst du die Uhrzeit vorne hin („08:15 …“), wird sie automatisch übernommen. ⏰</p>
    </div>
    <div class="stack" style="margin-top:14px">
      <button type="button" class="btn primary" data-l="save">Speichern</button>
      ${entry ? `<button type="button" class="btn danger" data-l="del">Eintrag löschen</button>` : ""}
    </div>`,
    onMount(sheet, close) {
      const $ = (q) => sheet.querySelector(q);
      const txt = $("#sl-text");
      txt.addEventListener("input", () => { const p = S.splitLogText(txt.value); if (p.time) $("#sl-time").value = p.time; });
      const save = $('[data-l="save"]');
      save.addEventListener("click", async () => {
        const p = S.splitLogText(txt.value);
        if (!p.text) { ctx.ui.toast("Schreib kurz, was passiert ist. 🙂"); txt.focus(); return; }
        const ts = S.logTs($("#sl-day").value, p.time || $("#sl-time").value) || Date.now();
        const doc = S.normLog({ ...(entry || {}), placeId: pid, ts, text: p.text });
        if (!doc) { ctx.ui.toast("Das konnte ich nicht speichern."); return; }
        ctx.ui.setBusy(save, true, "Speichert …");
        try { await cols().log.put(doc); close(); ctx.ui.toast("📝 Eintrag gespeichert", 1600); }
        catch (e) { console.error(e); ctx.ui.setBusy(save, false); ctx.ui.toast("Speichern fehlgeschlagen – bitte nochmal probieren."); }
      });
      const del = $('[data-l="del"]');
      if (del) ctx.ui.confirmButton(del, "Wirklich löschen?", async () => {
        try { await cols().log.remove(entry.id); close(); ctx.ui.toast("Eintrag gelöscht."); } catch (e) { console.error(e); }
      });
      setTimeout(() => { try { txt.focus(); } catch { /* egal */ } }, 60);
    },
  });
}

function openPhoto(n) {
  const ctx = cur.ctx;
  const list = cur.last ? cur.last.d.ph : [];
  const p = list[n];
  if (!p) return;
  const phaseBtns = (cur) => [["vorher", "⬅️ Vorher"], ["nachher", "➡️ Nachher"], ["", "Keins"]].map(([v, l]) =>
    `<button type="button" class="chip" data-ph="${v}" aria-pressed="${(cur || "") === v}">${l}</button>`).join("");
  ctx.ui.openSheet({
    title: "📷 Foto",
    bodyHTML: `<div class="st-phsheet">
      <img class="st-ph-big" src="${esc(p.thumb || "")}" alt="${esc(p.note ? "Foto: " + p.note : "Foto")}">
      <p class="note">${esc(dayLabel(S.keyOf(p.ts)))}, ${S.clockOf(p.ts)}${p.note ? ` · ${esc(p.note)}` : ""}</p>
      <div><div class="lbl">Für den Vergleich markieren</div><div class="chips" data-r="phase">${phaseBtns(p.phase)}</div></div>
      <button type="button" class="btn ghost" data-r="view">🔍 Groß ansehen</button>
    </div>`,
    onMount(sheet, close) {
      const img = sheet.querySelector(".st-ph-big");
      photos.getPhoto(p.id).then((f) => { if (f && f.data && img.isConnected) img.src = f.data; }).catch(() => {});
      sheet.querySelector('[data-r="phase"]').addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-ph]"); if (!b) return;
        const phase = b.dataset.ph || null;
        try {
          await photos.updatePhoto(p.id, { phase });
          p.phase = phase;
          sheet.querySelectorAll("[data-ph]").forEach((x) => x.setAttribute("aria-pressed", String((x.dataset.ph || null) === phase)));
          ctx.ui.toast(phase ? `Als „${phase === "vorher" ? "Vorher" : "Nachher"}“ markiert ✨` : "Markierung entfernt", 1600);
          queueRender();
        } catch (e) { console.error(e); ctx.ui.toast("Das hat nicht geklappt."); }
      });
      sheet.querySelector('[data-r="view"]').addEventListener("click", () => {
        close();
        openViewer(list, n, ctx, { resolve: (x) => photos.getPhoto(x.id) });
      });
    },
  });
}

function openQR() {
  const ctx = cur.ctx, place = placeOf(ctx, cur.id);
  if (!place) return;
  const url = S.siteUrl(location.href, place.id);
  let svg = "";
  try { svg = qrSVG(url, { label: `QR-Code ${place.name || "Baustelle"}` }); } catch (e) { console.error(e); }
  ctx.ui.openSheet({
    title: "🔳 QR-Code der Baustelle",
    bodyHTML: `<div class="st-qr">
      <div class="st-qr-box">${svg}</div>
      <p class="note">Druck ihn aus und kleb ihn in den Verteiler oder Baucontainer – Scannen öffnet direkt diese Baustellen-Seite. 📱</p>
      <p class="st-qr-url st-sel">${esc(url)}</p>
      <div class="row"><button type="button" class="btn ghost" data-q="copy">🔗 Link kopieren</button>
        <button type="button" class="btn ghost" data-q="print">🖨️ Drucken</button></div>
    </div>`,
    onMount(sheet) {
      sheet.querySelector('[data-q="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(url); ctx.ui.toast("Link kopiert 📋", 1600); }
        catch { ctx.ui.toast("Kopieren geht hier nicht – halt den Link gedrückt."); }
      });
      sheet.querySelector('[data-q="print"]').addEventListener("click", () => openReport({ qrOnly: true }));
    },
  });
}

/* ---------- Bericht (Drucken / als PDF speichern) ---------- */

function reportHTML(place, d, { qrOnly = false } = {}) {
  const url = S.siteUrl(location.href, place.id);
  let qr = "";
  try { qr = qrSVG(url, { label: "QR-Code Baustelle" }); } catch { /* egal */ }
  if (qrOnly) {
    return `<article class="rp-paper sr-paper sr-qr"><header class="rp-title"><h1>🏗️ ${esc(place.name || "Baustelle")}</h1><span>${esc(place.addr || "")}</span></header>
      <div class="sr-qrbig">${qr}</div><p class="sr-center">Scannen → Baustellen-Seite in der Stempelkarte</p></article>`;
  }
  const period = d.work.first ? `${S.fmtKey(S.keyOf(d.work.first))} – ${S.fmtKey(S.keyOf(d.work.last))}` : "–";
  const f = (l, v) => `<div class="rp-f"><span>${esc(l)}</span><b>${esc(v || "–")}</b></div>`;
  const verbaut = M.totals(d.mat.by.verbaut);
  const offen = M.totals([...d.mat.by.brauche, ...d.mat.by.besorgt, ...d.mat.by.baustelle]);
  const ba = S.beforeAfter(d.ph);
  const logEv = d.timeline.filter((e) => e.kind === "log" || e.kind === "photo" || e.kind === "matdone" || e.kind === "todo");
  return `<article class="rp-paper sr-paper">
    <header class="rp-title"><h1>Baustellenbericht</h1><span>Stand ${esc(S.fmtKey(todayKey()))}</span></header>
    <div class="rp-fields">
      ${f("Baustelle", place.name)}${f("Adresse", place.addr)}${f("Status", S.STATUS_META[d.status].l)}
      ${f("Zeitraum (geplant)", place.siteStart || place.siteEnd ? `${place.siteStart ? S.fmtKey(place.siteStart) : "offen"} – ${place.siteEnd ? S.fmtKey(place.siteEnd) : "offen"}` : "")}
      ${f("Gearbeitet", period)}${f("Ansprechpartner", place.contact)}${f("Telefon", place.phone)}
      ${f("Team", [...new Set([...(place.crew || []), ...d.work.people])].join(", "))}
    </div>
    <section><h2 class="sr-h">Arbeitszeiten · ${S.hm(d.work.totalMin)} h an ${d.work.days} ${d.work.days === 1 ? "Tag" : "Tagen"}</h2>
      ${d.work.list.length ? `<table class="rp-table sr-table"><thead><tr><th>Datum</th><th>Zeit</th><th>Mit wem / Notiz</th><th class="rp-h">h</th></tr></thead><tbody>
        ${d.work.list.slice().reverse().map((x) => `<tr><td>${esc(dayLabel(x.dayKey))}</td><td>${S.clockOf(x.entry.start)}–${S.clockOf(x.entry.end)}</td>
          <td>${esc([Array.isArray(x.entry.people) ? x.entry.people.join(", ") : "", x.entry.note || ""].filter(Boolean).join(" · "))}</td><td class="rp-h">${S.hm(x.min)}</td></tr>`).join("")}
        </tbody><tfoot><tr><td colspan="3">Summe</td><td class="rp-h">${S.hm(d.work.totalMin)}</td></tr></tfoot></table>` : `<p>Keine Arbeitszeiten erfasst.</p>`}
    </section>
    <section><h2 class="sr-h">Material</h2>
      <p><b>Verbaut:</b> ${verbaut.length ? esc(verbaut.map(M.lineText).join(", ")) : "–"}</p>
      ${offen.length ? `<p><b>Offen / fehlt:</b> ${esc(offen.map(M.lineText).join(", "))}</p>` : ""}
    </section>
    <section><h2 class="sr-h">Fahrten</h2><p>${d.trips.list.length} ${d.trips.list.length === 1 ? "Fahrt" : "Fahrten"} · ${esc(kmText(d.trips.km))}</p></section>
    ${d.todos.aufgaben.length ? `<section><h2 class="sr-h">Aufgaben</h2><ul class="sr-ul">${d.todos.aufgaben.map((t) => `<li>${t.done ? "☑" : "☐"} ${esc(t.title)}</li>`).join("")}</ul></section>` : ""}
    ${logEv.length ? `<section><h2 class="sr-h">Bautagebuch</h2><table class="rp-table sr-table"><tbody>
      ${logEv.map((e) => `<tr><td class="sr-when">${esc(S.fmtKey(S.keyOf(e.ts)))} ${S.clockOf(e.ts)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table></section>` : ""}
    ${ba.pairs ? `<section class="sr-ba"><h2 class="sr-h">Vorher / Nachher</h2>${Array.from({ length: Math.min(ba.pairs, 3) }, (_, i) =>
      `<div class="sr-ba-row"><figure><img data-full="${esc(ba.vorher[i].id)}" src="${esc(ba.vorher[i].thumb || "")}" alt="Vorher"><figcaption>Vorher · ${esc(S.fmtKey(S.keyOf(ba.vorher[i].ts)))}</figcaption></figure>
        <figure><img data-full="${esc(ba.nachher[i].id)}" src="${esc(ba.nachher[i].thumb || "")}" alt="Nachher"><figcaption>Nachher · ${esc(S.fmtKey(S.keyOf(ba.nachher[i].ts)))}</figcaption></figure></div>`).join("")}</section>` : ""}
    ${place.siteNotes ? `<section><h2 class="sr-h">Notizen</h2><p class="sr-pre">${esc(place.siteNotes)}</p></section>` : ""}
    <footer class="sr-foot"><div class="rp-sign"><div><span class="rp-line"></span><span>Datum, Unterschrift</span></div><div><span class="rp-line"></span><span>Datum, Unterschrift Auftraggeber/in</span></div></div>
      <div class="sr-qrsmall">${qr}</div></footer>
  </article>`;
}

function closeReport(fromPop = false) {
  if (!report) return;
  const r = report;
  report = null;
  window.removeEventListener("popstate", r.onPop);
  r.el.remove();
  document.body.classList.remove("sr-open");
  if (!fromPop && r.pushed && history.state && history.state.sr) history.back();
}

function openReport(opts = {}) {
  if (!cur) return;
  const place = placeOf(cur.ctx, cur.id);
  if (!place) return;
  closeReport();
  const sheetClose = document.querySelector("#sheet-root .sheet .close");
  if (sheetClose) sheetClose.click();
  const d = gather(cur.ctx, place);
  const el = document.createElement("div");
  el.id = REPORT_ID;
  el.className = "rp sr";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", opts.qrOnly ? "QR-Code drucken" : "Baustellenbericht");
  el.tabIndex = -1;
  el.innerHTML = `<div class="rp-bar"><button type="button" class="btn ghost sm rp-close" data-sr="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>${opts.qrOnly ? "QR-Code drucken" : "Baustellenbericht"}</h2></div>
    ${reportHTML(place, d, opts)}
    <div class="rp-actions"><button type="button" class="btn primary" data-sr="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button>
      ${opts.qrOnly ? "" : `<button type="button" class="btn ghost" data-sr="share">${icon("swap", 20)}<span>Als Text teilen</span></button>`}</div>`;
  document.body.appendChild(el);
  document.body.classList.add("sr-open");
  const ctx = cur.ctx;
  el.querySelectorAll("img[data-full]").forEach((img) => {
    photos.getPhoto(img.dataset.full).then((p) => { if (p && p.data && img.isConnected) img.src = p.data; }).catch(() => {});
  });
  el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-sr]");
    if (!b) return;
    if (b.dataset.sr === "close") closeReport();
    else if (b.dataset.sr === "print") {
      const prev = document.title;
      document.title = `Baustellenbericht ${place.name || ""} ${todayKey()}`.trim();
      try { window.print(); } catch { ctx.ui.toast("Drucken geht hier nicht."); }
      setTimeout(() => { document.title = prev; }, 1000);
    } else if (b.dataset.sr === "share") {
      const text = reportText(place, d);
      try {
        if (navigator.share) await navigator.share({ title: `Baustellenbericht ${place.name || ""}`, text });
        else { await navigator.clipboard.writeText(text); ctx.ui.toast("Bericht kopiert 📋", 1600); }
      } catch (e) { if (!e || e.name !== "AbortError") ctx.ui.toast("Teilen hat nicht geklappt."); }
    }
  });
  const r = { el, pushed: false, onPop: () => closeReport(true) };
  try { history.pushState({ ...(history.state || {}), sr: 1 }, "", location.href); r.pushed = true; window.addEventListener("popstate", r.onPop); } catch { /* egal */ }
  report = r;
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
}

export function reportText(place, d) {
  const out = [`🏗️ Baustellenbericht – ${place.name || "Baustelle"}`, place.addr ? `📍 ${place.addr}` : "", `Status: ${S.statusLabel(d.status)}`,
    `⏱️ ${S.hm(d.work.totalMin)} h an ${d.work.days} ${d.work.days === 1 ? "Tag" : "Tagen"}`];
  const v = M.totals(d.mat.by.verbaut);
  if (v.length) out.push(`🧰 Verbaut: ${v.map(M.lineText).join(", ")}`);
  if (d.mat.fehlt.length) out.push(`⚠️ Fehlt: ${M.totals(d.mat.fehlt).map(M.lineText).join(", ")}`);
  if (d.trips.list.length) out.push(`🚗 ${d.trips.list.length} Fahrten · ${kmText(d.trips.km)}`);
  const log = d.timeline.filter((e) => e.kind === "log");
  if (log.length) out.push("", "📝 Tagebuch:", ...log.map((e) => `${S.fmtKey(S.keyOf(e.ts))} ${S.clockOf(e.ts)} ${e.text}`));
  return out.filter((x, i) => x !== "" || i > 0).join("\n");
}

/* ---------- Öffnen / Schließen ---------- */

function onKey(ev) {
  if (ev.key !== "Escape" || !cur) return;
  if (report) { closeReport(); return; }
  if (document.querySelector("#sheet-root .sheet, .ph-view")) return;
  closeSite();
}

/** Projektseite schließen; Adresse zurück auf #orte. */
export function closeSite({ fromHash = false } = {}) {
  if (!cur) return;
  const c = cur;
  cur = null;
  closeReport();
  for (const u of c.unsubs) { try { u(); } catch { /* egal */ } }
  document.removeEventListener("keydown", onKey);
  c.el.remove();
  document.body.classList.remove("st-open");
  document.body.style.overflow = c.prevOverflow;
  if (!fromHash && S.parseSiteHash(location.hash)) {
    if (c.pushed) history.back();
    else location.hash = "orte";
  }
  if (c.prevFocus && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

/** Projektseite für Ort id anzeigen (wird vom Hash-Router in places.js aufgerufen). */
export function showSite(id, ctx, { pushed = false } = {}) {
  if (cur && cur.id === id) { render(); return; }
  if (cur) closeSite({ fromHash: true });
  injectSiteCSS();
  injectAktenCSS(); // Update 10 E – 📎 Dokumente
  const el = document.createElement("div");
  el.id = ROOT_ID;
  el.className = "rp st";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Baustelle");
  el.tabIndex = -1;
  el.innerHTML = `<div class="rp-bar st-bar"><button type="button" class="btn ghost sm rp-close" data-st="close">${icon("chevron-left", 18)}<span>Orte</span></button>
      <h2 class="st-title">Baustelle</h2></div><div class="st-main"></div>`;
  cur = { id, el, ctx, unsubs: [], pushed, prevFocus: document.activeElement, prevOverflow: document.body.style.overflow || "",
    state: { photoIdx: [], albums: [], photosLoaded: false, allWork: false, allTimeline: false, pair: 0 }, last: null };
  document.body.appendChild(el);
  document.body.classList.add("st-open");
  document.body.style.overflow = "hidden";
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest('[data-st="status"]')) { ev.preventDefault(); openStatus(); }
  });
  document.addEventListener("keydown", onKey);
  const c = cur;
  c.unsubs.push(ctx.store.subscribe(() => { if (cur === c) queueRender(); }));
  c.unsubs.push(cols().log.watch(() => { if (cur === c) queueRender(); }));
  c.unsubs.push(cols().mat.watch(() => { if (cur === c) queueRender(); }));
  c.unsubs.push(cols().kt.watch(() => { if (cur === c) queueRender(); })); // Update 10 E
  c.unsubs.push(cols().dk.watch(() => { if (cur === c) queueRender(); })); // Update 10 E
  c.unsubs.push(cols().pp.watch(() => { if (cur === c) queueRender(); })); // Update 14
  c.unsubs.push(watchDocs(() => { if (cur === c) queueRender(); })); // Update 10 – 🔒 Entsperren/Sperren
  c.unsubs.push(photos.onChange(() => { if (cur === c) { c.state.photosLoaded = false; loadPhotos(); } }));
  render();
  loadPhotos();
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
}

function onClick(ev) {
  const b = ev.target.closest("[data-st]");
  if (!b || !cur) return;
  const a = b.dataset.st, ctx = cur.ctx;
  const place = placeOf(ctx, cur.id);
  switch (a) {
    case "close": closeSite(); break;
    case "status": openStatus(); break;
    case "edit": openEdit(); break;
    case "qr": openQR(); break;
    case "report": openReport(); break;
    case "place": if (place) ctx.openPlaceForm(place); break;
    case "matlist": closeSite({ fromHash: true }); location.hash = "alltag/material"; break;
    case "route": if (place) { closeSite({ fromHash: true }); location.hash = "alltag/karte?place=" + encodeURIComponent(place.id); } break; // Update 10 – Karte & Route
    case "addlog": openLogForm(); break;
    case "log": { const l = cols().log.get(b.dataset.id); if (l) openLogForm(l); break; }
    case "addtodo": ctx.openTodoForm(null, { kind: "todo", placeId: cur.id, title0: `Neue Aufgabe · ${place ? place.name : "Baustelle"}` }); break;
    case "todo": { const t = (ctx.store.get().todos || []).find((x) => x.id === b.dataset.id); if (t) ctx.openTodoForm(t); break; }
    case "entry": { const e = (ctx.store.get().entries || []).find((x) => x.id === b.dataset.id); if (e) ctx.openEntryForm(e); break; }
    case "photo": openPhoto(Number(b.dataset.n)); break;
    case "pair": { const ba = S.beforeAfter(cur.last ? cur.last.d.ph : []); const n = Math.max(ba.vorher.length, ba.nachher.length) || 1;
      cur.state.pair = ((cur.state.pair || 0) + Number(b.dataset.d) + n) % n; render(); break; }
    case "allwork": cur.state.allWork = !cur.state.allWork; render(); break;
    case "alltl": cur.state.allTimeline = true; render(); break;
    case "jump": { const t = cur.el.querySelector("#" + b.dataset.to); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); break; }
    default: break;
  }
}
