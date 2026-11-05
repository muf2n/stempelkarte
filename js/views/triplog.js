// Update 9 – Fahrtenbuch (Vollbild): Monat mit Summen, Suche, Fahrten nach Tag gruppiert in kompakten Zeilen,
// Detail-Blatt (Zweck, beruflich/privat, Fahrzeug, km manuell, Route in Google Maps), „+ Fahrt nachtragen“,
// Fahrzeuge + Kilometerstand, CSV-Export und Druckansicht (A4, Unterschrift).
// Straßen-km: sichtbare Fahrten ohne gespeicherte Straßen-km werden über js/road-km.js (OSRM) nachgeladen.
//
// Datenmodell (keine neue Sammlung):
// - Fahrt = Abschnitt „Autofahren“ eines Arbeitseintrags (entries/{id}.segments[i]);
//   Zusatzfelder am Abschnitt: purpose, private, vehicleId, km (manuell), kmRoad/kmRoadAt/kmRoadFor.
// - Nachgetragene Fahrt: liegt sie innerhalb einer Arbeitszeit desselben Tages (in EINEM Abschnitt),
//   wird dieser Abschnitt geteilt und die Fahrt dort eingefügt (Arbeitszeit bleibt gleich).
//   Sonst entsteht ein eigener Arbeitseintrag mit genau diesem Abschnitt (`tripOnly: true`):
//   beruflich → zählt als Arbeitszeit, privat → `privateTrip: true` (util.netMin = 0; pauseMin = Dauer bleibt für ältere Stände).
import { icon } from "../icons.js";
import { tripsBetween, segmentKm, fmtKm, fmtEur, parseNum, KM_SOURCE } from "../travel.js";
import {
  PURPOSE_CHIPS, VEHICLE_TYPES, readTripSettings, readVehicles, defaultVehicle, tripVehicle, vehicleLabel,
  fromLabel, toLabel, markReturns, groupByDay, dayHeader, filterTrips, totals, odometer, logRows, LOG_HEAD,
  mapsDirUrl, patchSegment, insertTrip, fmtKmD,
} from "../trip-core.js";
import * as road from "../road-km.js";
import { readApprentice } from "./report.js";

const pad = (n) => String(n).padStart(2, "0");
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const fmtOdo = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); // 45.210

let cur = null; // { ctx, from, el, q, unsub, io, pushed, prevOverflow, prevFocus, trips }

function snapOf(ctx) { try { return ctx.store.get(); } catch { return null; } }

/** Fahrten eines Monats (mit Ortsnamen, Rückfahrt-Markierung). */
export function monthTrips(snap, from) {
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const s = snap.settings || {};
  const trips = tripsBetween(snap.entries, from.getTime(), to.getTime(), s, snap.places);
  return markReturns(trips, (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; });
}

/** Kilometerstand-Map für die Fahrten bis Monatsende (Kette ab dem frühesten Startwert). */
export function monthOdometer(snap, from) {
  const s = snap.settings || {};
  const vs = readVehicles(s);
  const starts = vs.flatMap((v) => Object.keys(v.odoStart)).sort();
  if (!starts.length) return new Map();
  const [y, m] = starts[0].split("-").map(Number);
  const f = new Date(y, m - 1, 1).getTime();
  const t = new Date(from.getFullYear(), from.getMonth() + 1, 1).getTime();
  return odometer(tripsBetween(snap.entries, f, t, s, snap.places), s);
}

function srcBadge(t, size = 13) {
  if (t.source === "road") return `<i class="fb-src fb-src-road" title="Straßen-km (Routing)">${icon("route", size)}</i>`;
  if (t.source === "manual") return `<i class="fb-src fb-src-man" title="manuell eingetragen">${icon("pencil", size)}</i>`;
  if (t.source === "est") return `<i class="fb-src fb-src-est" title="Luftlinie × Umwegfaktor (geschätzt)">≈</i>`;
  return "";
}
function kmValue(t) {
  if (t.km == null) return "?";
  return `${t.source === "est" ? "≈ " : ""}${fmtKmD(t.km)}`;
}

/* ---------------- Vollbild ---------------- */

function render() {
  if (!cur) return;
  const { ctx, el } = cur;
  const snap = snapOf(ctx);
  if (!snap) return;
  const u = ctx.util;
  const esc = u.esc;
  const s = snap.settings || {};
  const all = monthTrips(snap, cur.from);
  // Update 9 – Privat: Filter „alle / nur beruflich / nur privat“
  const list = filterTrips(all, cur.q, s).filter((t) => cur.art === "biz" ? !t.private : cur.art === "priv" ? t.private : true);
  cur.trips = new Map(all.map((t) => [t.key, t]));
  const tot = totals(all, s);
  const ts = readTripSettings(s);

  el.querySelector(".fb-mo").textContent = `${u.MONTHS[cur.from.getMonth()]} ${cur.from.getFullYear()}`;

  // Kopf mit Summen
  const days = new Set(all.map((t) => u.dayKey(t.start))).size;
  const bizP = tot.km > 0 ? Math.round((tot.bizKm / tot.km) * 100) : 0;
  const srcBits = [];
  if (tot.roadN) srcBits.push(`${icon("route", 13)} ${tot.roadN} Straße`);
  if (tot.manualN) srcBits.push(`${icon("pencil", 13)} ${tot.manualN} manuell`);
  if (tot.estN) srcBits.push(`≈ ${tot.estN} Luftlinie`);
  if (tot.unknownN) srcBits.push(`${tot.unknownN} ohne km`);
  el.querySelector(".fb-sum").innerHTML = `
    <div class="fb-sum-top">
      <div class="fb-big"><strong data-fb="km">${tot.approx ? "≈ " : ""}${esc(fmtKmD(tot.km))}</strong><span>km</span></div>
      <div class="fb-cnt"><span><b data-fb="n">${tot.count}</b> ${tot.count === 1 ? "Fahrt" : "Fahrten"}</span><small>an ${days} ${days === 1 ? "Tag" : "Tagen"}</small></div>
    </div>
    ${tot.count ? `<div class="fb-split" role="img" aria-label="beruflich ${bizP} %, privat ${100 - bizP} %">
      <i class="fb-biz" style="width:${bizP}%"></i><i class="fb-priv" style="width:${100 - bizP}%"></i></div>
    <div class="fb-split-l">
      <span class="fb-l-biz">beruflich <b data-fb="biz">${esc(fmtKmD(tot.bizKm))} km</b> <small>(${tot.bizN})</small></span>
      <span class="fb-l-priv">privat <b data-fb="priv">${esc(fmtKmD(tot.privKm))} km</b> <small>(${tot.privN})</small></span>
    </div>` : ""}
    ${tot.showKmgeld ? `<div class="kv fb-kmg"><span>Kilometergeld <small>${esc(fmtKmD(tot.kmgeldKm))} km × ${esc(fmtEur(tot.kmRate))}</small></span><b data-fb="kmg">${esc(fmtEur(tot.kmgeld))}</b></div>` : ""}
    ${srcBits.length ? `<p class="fb-srcs">${srcBits.join(" · ")}</p>` : ""}
    <p class="fb-status" data-fb="status" aria-live="polite"></p>`;

  // Liste
  const host = el.querySelector(".fb-list");
  if (!all.length) {
    host.innerHTML = `<div class="fb-empty"><p><b>Keine Fahrten in diesem Monat.</b></p>
      <p class="note">Fahrten entstehen aus Abschnitten „Autofahren“ beim Stempeln – oder du trägst sie nach.</p>
      <button type="button" class="btn primary sm" data-fb="add">${icon("plus", 18)}<span>Fahrt nachtragen</span></button></div>`;
  } else if (!list.length) {
    host.innerHTML = cur.q ? `<p class="note fb-none">Keine Fahrt passt zu „${esc(cur.q)}“.</p>`
      : `<p class="note fb-none">Keine ${cur.art === "priv" ? "privaten" : "beruflichen"} Fahrten in diesem Monat.</p>`;
  } else {
    const groups = groupByDay(list, u.dayKey);
    host.innerHTML = groups.map((g) => {
      const d = new Date(g.ts);
      const head = dayHeader(g, u.WD);
      return `<section class="fb-day" aria-label="${esc(head)}">
        <h3 class="fb-dh"><span class="fb-dd">${esc(u.WD[d.getDay()])}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span>
          <span class="fb-dm">${g.count} ${g.count === 1 ? "Fahrt" : "Fahrten"} · ${g.approx ? "≈ " : ""}${esc(fmtKmD(g.km))} km</span></h3>
        <ul class="fb-rows">${g.trips.map((t) => rowHTML(t, s, esc, u)).join("")}</ul>
      </section>`;
    }).join("");
  }
  observeRows();
  status();
}

function rowHTML(t, s, esc, u) {
  const a = fromLabel(t), b = toLabel(t);
  const v = tripVehicle(t, s);
  const sub = [b.sub, t.purpose !== b.main && !(t.private && t.purpose === "Privat") ? t.purpose : ""].filter(Boolean);
  if (t.private) sub.push("privat");
  const title = `${a.full || a.main} → ${b.full || b.main}`;
  return `<li><button type="button" class="fb-row${t.isReturn ? " is-ret" : ""}${t.private ? " is-priv" : ""}" data-key="${esc(t.key)}" title="${esc(title)}">
    <span class="fb-t"><b>${esc(u.clock(t.start))}</b><small>${Number.isFinite(t.end) ? esc(u.clock(t.end)) : ""}</small></span>
    <span class="fb-r">
      <span class="fb-l1">${t.isReturn ? `<i class="fb-ret" title="Rückfahrt" aria-label="Rückfahrt">↩</i>` : ""}<span class="fb-from">${esc(a.main)}</span><span class="fb-arr" aria-hidden="true">→</span><span class="fb-to">${esc(b.main)}</span></span>
      <span class="fb-l2">${esc(sub.join(" · "))}${v && readVehicles(s).length > 1 ? ` <span class="fb-veh">· ${esc(v.name)}</span>` : ""}</span>
    </span>
    <span class="fb-km${t.km == null ? " none" : ""}"><b>${esc(kmValue(t))}</b><small>${srcBadge(t)}km</small></span>
  </button></li>`;
}

function status() {
  if (!cur) return;
  const st = cur.el.querySelector('[data-fb="status"]');
  if (!st) return;
  const s = (snapOf(cur.ctx) || {}).settings || {};
  const n = road.pending();
  if (!readTripSettings(s).roadKm) st.textContent = "Straßen-km aus – km sind Luftlinie × Umwegfaktor (Einstellungen).";
  else st.textContent = n ? `Straßen-km werden berechnet … (${n})` : "";
}

function observeRows() {
  if (!cur) return;
  if (cur.io) cur.io.disconnect();
  const rows = cur.el.querySelectorAll(".fb-row[data-key]");
  const ask = (key) => { const t = cur && cur.trips.get(key); if (t && road.request(t)) status(); };
  if (typeof IntersectionObserver === "undefined") { rows.forEach((r) => ask(r.dataset.key)); return; }
  cur.io = new IntersectionObserver((list) => {
    for (const en of list) if (en.isIntersecting) ask(en.target.dataset.key);
  }, { root: cur.el, rootMargin: "80px 0px" });
  rows.forEach((r) => cur.io.observe(r));
}

function onKey(ev) {
  if (!cur || document.getElementById("fbp-root")) return;
  if (ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.preventDefault(); closeTripLog(); }
}
let skipPop = false; // history.back() der Druckansicht soll das Fahrtenbuch nicht schließen
function onPop() {
  if (skipPop) { skipPop = false; return; }
  if (cur && !document.getElementById("fbp-root")) closeTripLog(true);
}

export function closeTripLog(fromPop = false) {
  if (!cur) return;
  const c = cur;
  cur = null;
  try { c.unsub && c.unsub(); } catch { /* egal */ }
  try { c.unroad && c.unroad(); } catch { /* egal */ }
  if (c.io) c.io.disconnect();
  clearInterval(c.tick);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("popstate", onPop);
  c.el.remove();
  document.body.classList.remove("fb-open");
  document.body.style.overflow = c.prevOverflow;
  if (!fromPop && c.pushed && history.state && history.state.fb) history.back();
  if (c.prevFocus && document.contains(c.prevFocus)) { try { c.prevFocus.focus({ preventScroll: true }); } catch { /* egal */ } }
}

/** Fahrtenbuch öffnen; year/month (0–11) optional. */
export function openTripLog(ctx, { year, month } = {}) {
  if (cur) closeTripLog();
  road.init(ctx.store);
  const now = new Date();
  const from = new Date(Number.isFinite(year) ? year : now.getFullYear(), Number.isFinite(month) ? month : now.getMonth(), 1);
  const el = document.createElement("div");
  el.id = "fb-root";
  el.className = "rp fb";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Fahrtenbuch");
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="rp-bar">
      <button type="button" class="btn ghost sm rp-close" data-fb="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>Fahrtenbuch</h2>
      <button type="button" class="btn primary sm fb-addtop" data-fb="add" title="Fahrt nachtragen" aria-label="Fahrt nachtragen">${icon("plus", 18)}<span>Fahrt</span></button>
    </div>
    <div class="rp-nav">
      <button type="button" class="btn ghost sm rp-arrow" data-fb="prev" aria-label="Voriger Monat">${icon("chevron-left", 20)}</button>
      <div class="rp-wk fb-mo" aria-live="polite"></div>
      <button type="button" class="btn ghost sm rp-arrow" data-fb="next" aria-label="Nächster Monat">${icon("chevron-right", 20)}</button>
      <button type="button" class="btn ghost sm rp-now" data-fb="now">Dieser Monat</button>
    </div>
    <div class="fb-main">
      <aside class="fb-side">
        <div class="fb-sum card"></div>
        <label class="fb-search">${icon("search", 18)}<input type="search" data-fb="q" placeholder="Suchen: Ort, Zweck, Fahrzeug" aria-label="Fahrten durchsuchen" autocomplete="off"></label>
        <div class="chips fb-artf" role="group" aria-label="Fahrten zeigen">
          <button type="button" class="chip" data-fbart="all" aria-pressed="true">Alle</button>
          <button type="button" class="chip" data-fbart="biz" aria-pressed="false">nur beruflich</button>
          <button type="button" class="chip" data-fbart="priv" aria-pressed="false">nur privat</button>
        </div>
        <div class="fb-tools">
          <button type="button" class="btn ghost sm" data-fb="veh">${icon("car", 18)}<span>Fahrzeuge</span></button>
          <button type="button" class="btn ghost sm" data-fb="csv">${icon("download", 18)}<span>CSV</span></button>
          <button type="button" class="btn ghost sm" data-fb="print">${icon("file", 18)}<span>Drucken</span></button>
        </div>
      </aside>
      <div class="fb-list"></div>
    </div>`;

  cur = { ctx, from, el, q: "", art: "all", unsub: null, io: null, pushed: false, trips: new Map(),
    prevOverflow: document.body.style.overflow || "", prevFocus: document.activeElement };
  document.body.appendChild(el);
  document.body.classList.add("fb-open");
  document.body.style.overflow = "hidden";

  const shift = (n) => {
    const f = cur.from;
    cur.from = n === 0 ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(f.getFullYear(), f.getMonth() + n, 1);
    render();
  };
  el.addEventListener("click", (ev) => {
    if (!cur) return;
    const row = ev.target.closest(".fb-row[data-key]");
    if (row) { const t = cur.trips.get(row.dataset.key); if (t) openTripDetail(ctx, t); return; }
    const af = ev.target.closest("[data-fbart]");
    if (af) {
      cur.art = af.dataset.fbart;
      el.querySelectorAll("[data-fbart]").forEach((c) => c.setAttribute("aria-pressed", String(c === af)));
      render();
      return;
    }
    const b = ev.target.closest("[data-fb]");
    if (!b) return;
    const a = b.dataset.fb;
    if (a === "close") closeTripLog();
    else if (a === "prev") shift(-1);
    else if (a === "next") shift(1);
    else if (a === "now") shift(0);
    else if (a === "add") openManualTrip(ctx, { from: cur.from });
    else if (a === "veh") openVehicles(ctx, { month: cur.from });
    else if (a === "csv") downloadCSV(ctx, cur.from);
    else if (a === "print") openTripPrint(ctx, { from: cur.from });
  });
  el.querySelector('[data-fb="q"]').addEventListener("input", (ev) => { cur.q = ev.target.value; render(); });

  document.addEventListener("keydown", onKey);
  try {
    history.pushState({ ...(history.state || {}), fb: 1 }, "", location.href);
    cur.pushed = true;
    window.addEventListener("popstate", onPop);
  } catch { /* egal */ }

  render();
  try { cur.unsub = ctx.store.subscribe(() => { if (cur) render(); }); } catch { /* egal */ }
  cur.unroad = road.onUpdate(() => status());
  cur.tick = setInterval(status, 1200);
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
  return { close: () => closeTripLog() };
}

/* ---------------- Speichern am Abschnitt ---------------- */

async function saveSeg(ctx, t, patch) {
  const e = ctx.store.get().entries.find((x) => x.id === t.entry.id);
  if (!e) throw new Error("Eintrag nicht gefunden");
  const segs = patchSegment(e, t.rawIndex, patch);
  if (!segs) throw new Error("Abschnitt nicht gefunden");
  const next = { ...e, segments: segs };
  // Update 9 – Privat: eigene Fahrt-Einträge (tripOnly) folgen der Art: privat = 0 h, beruflich = Arbeitszeit
  if (e.tripOnly && "private" in patch && segs.length === 1) {
    const priv = patch.private === true;
    if (priv !== ctx.util.isPrivateTrip(e)) {
      next.privateTrip = priv;
      next.pauseMin = priv ? Math.max(0, Math.round((e.end - e.start) / 60000)) : 0;
    }
  }
  await ctx.store.saveEntry(next);
}

function vehicleOptions(s, selId, esc) {
  const vs = readVehicles(s);
  const def = defaultVehicle(s);
  return [`<option value="">${def ? `Standard: ${esc(vehicleLabel(def))}` : "– kein Fahrzeug –"}</option>`]
    .concat(vs.map((v) => `<option value="${esc(v.id)}"${v.id === selId ? " selected" : ""}>${esc(vehicleLabel(v))} · ${esc(VEHICLE_TYPES[v.type])}</option>`))
    .join("");
}

function purposeFieldHTML(val, esc) {
  return `<div class="lbl">Zweck</div>
    <div class="chips fb-pchips" role="group" aria-label="Zweck schnell wählen">
      ${PURPOSE_CHIPS.map((p) => `<button type="button" class="chip" data-pchip="${esc(p)}" aria-pressed="${String(val === p)}">${esc(p)}</button>`).join("")}
    </div>
    <input type="text" data-r="purpose" value="${esc(val)}" placeholder="z. B. Baustelle Hauptplatz" maxlength="120" aria-label="Zweck (frei)">`;
}
function artFieldHTML(priv) {
  return `<div class="lbl">Art</div>
    <div class="chips fb-art" role="group" aria-label="Art der Fahrt">
      <button type="button" class="chip" data-art="biz" aria-pressed="${String(!priv)}">beruflich</button>
      <button type="button" class="chip" data-art="priv" aria-pressed="${String(!!priv)}">privat</button>
    </div>`;
}
function bindPurposeArt(box, state) {
  const inp = box.querySelector('[data-r="purpose"]');
  const syncChips = () => box.querySelectorAll("[data-pchip]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.pchip === inp.value.trim())));
  const setArt = (priv) => { state.private = priv; box.querySelectorAll("[data-art]").forEach((c) => c.setAttribute("aria-pressed", String((c.dataset.art === "priv") === priv))); };
  box.querySelectorAll("[data-pchip]").forEach((c) => c.addEventListener("click", () => {
    inp.value = c.dataset.pchip; syncChips();
    if (c.dataset.pchip === "Privat") setArt(true);
    else if (state.private && inp.value !== "Privat") setArt(false);
  }));
  inp.addEventListener("input", syncChips);
  box.querySelectorAll("[data-art]").forEach((c) => c.addEventListener("click", () => setArt(c.dataset.art === "priv")));
  return { purpose: () => inp.value.trim() };
}

/* ---------------- Detail-Blatt ---------------- */

export function openTripDetail(ctx, t) {
  const u = ctx.util, esc = u.esc;
  const snap = ctx.store.get();
  const s = snap.settings || {};
  const a = fromLabel(t), b = toLabel(t);
  const d = new Date(t.start);
  const dur = Number.isFinite(t.end) ? Math.max(0, Math.round((t.end - t.start) / 60000)) : null;
  const seg = (t.entry.segments || [])[t.rawIndex] || t.seg;
  const auto = segmentKm({ ...seg, km: null }, s);
  const odo = monthOdometer(snap, new Date(d.getFullYear(), d.getMonth(), 1)).get(t.key);
  const url = mapsDirUrl(t);
  const manVal = seg.km === null || seg.km === undefined || seg.km === "" ? "" : String(seg.km).replace(".", ",");
  const srcTxt = t.source ? KM_SOURCE[t.source].label : "unbekannt";
  const state = { private: t.private };

  const body = `
    <div class="fields fb-det">
      <div class="fb-det-when">
        <b>${esc(u.fmtDate(t.start))}</b>
        <span>${esc(u.clock(t.start))} – ${Number.isFinite(t.end) ? esc(u.clock(t.end)) : "?"}${dur != null ? ` · ${esc(u.hm(dur))} h` : ""}${t.isReturn ? ` · <span class="fb-ret-tag">↩ Rückfahrt</span>` : ""}</span>
      </div>
      <ol class="fb-route">
        <li><small>Von</small><b>${esc(a.main)}</b>${a.full && a.full !== a.main ? `<span>${esc(t.fromAddr || a.full)}</span>` : (a.sub ? `<span>${esc(a.sub)}</span>` : "")}</li>
        <li><small>Nach</small><b>${esc(b.main)}</b>${b.full && b.full !== b.main ? `<span>${esc(t.toAddr || b.full)}</span>` : (b.sub ? `<span>${esc(b.sub)}</span>` : "")}</li>
      </ol>
      <div class="fb-det-km">
        <div><strong data-r="kmv">${esc(kmValue(t))} km</strong><span class="fb-det-src">${srcBadge(t, 15)} ${esc(srcTxt)}</span></div>
        ${auto && t.source === "manual" ? `<small>automatisch: ${auto.source === "est" ? "≈ " : ""}${esc(fmtKmD(auto.km))} km (${esc(KM_SOURCE[auto.source].label)})</small>` : ""}
        ${odo ? `<small class="fb-det-odo">Kilometerstand ${esc(fmtOdo(odo.begin))} → ${esc(fmtOdo(odo.end))}</small>` : ""}
      </div>
      ${url ? `<a class="btn ghost sm fb-maps" href="${esc(url)}" target="_blank" rel="noopener">${icon("route", 18)}<span>Route in Google Maps</span></a>` : ""}
      <div>${purposeFieldHTML(t.purpose, esc)}</div>
      <div>${artFieldHTML(t.private)}</div>
      <label>Fahrzeug
        <select data-r="veh">${vehicleOptions(s, t.vehicleId, esc)}</select>
      </label>
      <label>km selbst eintragen
        <input type="text" inputmode="decimal" data-r="km" value="${esc(manVal)}" placeholder="${auto ? `${auto.source === "est" ? "≈ " : ""}${esc(fmtKmD(auto.km))} (leer = automatisch)` : "z. B. 12,5"}">
      </label>
      <div class="row"><button type="button" class="btn primary" data-r="save">Speichern</button></div>
      <div class="row fb-det-more">
        <button type="button" class="btn ghost sm" data-r="entry">${icon("pencil", 16)}<span>Eintrag öffnen</span></button>
        ${t.entry.tripOnly ? `<button type="button" class="btn danger sm" data-r="del">Fahrt löschen</button>` : ""}
      </div>
    </div>`;
  const sheet = ctx.ui.openSheet({ title: "Fahrt", bodyHTML: body });
  const box = sheet.el;
  const pa = bindPurposeArt(box, state);
  box.querySelector('[data-r="save"]').addEventListener("click", async () => {
    const kmT = box.querySelector('[data-r="km"]').value;
    const n = parseNum(kmT);
    if (Number.isNaN(n) || (n != null && (n < 0 || n >= 10000))) { ctx.ui.toast("Bitte gültige km eingeben (z. B. 12,5)."); return; }
    const p = pa.purpose();
    const vid = box.querySelector('[data-r="veh"]').value || null;
    try {
      await saveSeg(ctx, t, {
        purpose: p || null,
        private: state.private ? true : null,
        vehicleId: vid,
        km: n == null ? null : Math.round(n * 10) / 10,
      });
      sheet.close();
      ctx.ui.toast("Fahrt gespeichert");
    } catch (err) { if (err && !/Speichern/.test(err.message)) ctx.ui.toast("Fahrt konnte nicht gespeichert werden."); }
  });
  box.querySelector('[data-r="entry"]').addEventListener("click", () => {
    const e = ctx.store.get().entries.find((x) => x.id === t.entry.id) || t.entry;
    sheet.close();
    ctx.openEntryForm(e);
  });
  const del = box.querySelector('[data-r="del"]');
  if (del) ctx.ui.confirmButton(del, "Wirklich löschen?", async () => {
    try { await ctx.store.deleteEntry(t.entry.id); sheet.close(); ctx.ui.toast("Fahrt gelöscht"); } catch { /* Toast */ }
  });
  return sheet;
}

/* ---------------- Fahrt nachtragen ---------------- */

function placeSelect(id, places, esc) {
  return `<select data-r="${id}">
    <option value="">– Ort wählen –</option>
    ${places.map((p) => `<option value="${esc(p.id)}">${esc(p.name || "Ort")}</option>`).join("")}
    <option value="__free">Andere Adresse …</option>
  </select>
  <input type="text" data-r="${id}-free" placeholder="z. B. Wiener Straße 286, 8051 Graz" maxlength="160" hidden aria-label="Adresse">`;
}

function readPlace(box, id, places) {
  const v = box.querySelector(`[data-r="${id}"]`).value;
  if (v === "__free") {
    const txt = box.querySelector(`[data-r="${id}-free"]`).value.trim();
    return txt ? { placeId: null, place: "", loc: { addr: txt }, label: txt } : null;
  }
  const p = places.find((x) => x.id === v);
  if (!p) return null;
  const loc = typeof p.lat === "number" && typeof p.lng === "number" ? { lat: p.lat, lng: p.lng, addr: p.addr || "" } : (p.addr ? { addr: p.addr } : null);
  return { placeId: p.id, place: p.name || "", loc, label: p.name || "" };
}

export function openManualTrip(ctx, { from } = {}) {
  const u = ctx.util, esc = u.esc;
  const snap = ctx.store.get();
  const s = snap.settings || {};
  const places = snap.places || [];
  const now = new Date();
  const base = from && (from.getMonth() !== now.getMonth() || from.getFullYear() !== now.getFullYear()) ? from : now;
  const state = { private: false };
  const body = `
    <div class="fields fb-man">
      <label>Datum <input type="date" data-r="date" value="${esc(u.dayKey(base))}" required></label>
      <div class="row">
        <label>Abfahrt <input type="time" data-r="t1" value="07:00" required></label>
        <label>Ankunft <input type="time" data-r="t2" value="07:30" required></label>
      </div>
      <label>Von ${placeSelect("from", places, esc)}</label>
      <label>Nach ${placeSelect("to", places, esc)}</label>
      <label>Gefahrene km <input type="text" inputmode="decimal" data-r="km" placeholder="leer = automatisch (bei gespeicherten Orten)"></label>
      <div>${purposeFieldHTML("", esc)}</div>
      <div>${artFieldHTML(false)}</div>
      <label>Fahrzeug <select data-r="veh">${vehicleOptions(s, null, esc)}</select></label>
      <p class="note">Liegt die Fahrt in deiner Arbeitszeit an diesem Tag, wird sie dort als Abschnitt „Autofahren“ eingefügt. Sonst entsteht ein eigener Eintrag: beruflich zählt als Arbeitszeit, privat mit 0 h.</p>
      <p class="hint" data-r="err" aria-live="polite"></p>
      <div class="row"><button type="button" class="btn primary" data-r="save">Fahrt speichern</button></div>
    </div>`;
  const sheet = ctx.ui.openSheet({ title: "Fahrt nachtragen", bodyHTML: body });
  const box = sheet.el;
  const pa = bindPurposeArt(box, state);
  for (const id of ["from", "to"]) {
    const sel = box.querySelector(`[data-r="${id}"]`);
    sel.addEventListener("change", () => {
      const free = box.querySelector(`[data-r="${id}-free"]`);
      free.hidden = sel.value !== "__free";
      if (!free.hidden) free.focus();
    });
  }
  const err = (m) => { box.querySelector('[data-r="err"]').textContent = m; ctx.ui.toast(m, 3500); };
  box.querySelector('[data-r="save"]').addEventListener("click", async () => {
    const dv = box.querySelector('[data-r="date"]').value;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dv);
    if (!m) return err("Bitte ein Datum wählen.");
    const tm = (v) => { const x = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
    const a1 = tm(box.querySelector('[data-r="t1"]').value), a2 = tm(box.querySelector('[data-r="t2"]').value);
    if (a1 == null || a2 == null) return err("Bitte Abfahrt und Ankunft eingeben.");
    if (a2 <= a1) return err("Die Ankunft muss nach der Abfahrt liegen.");
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const start = day.getTime() + a1 * 60000, end = day.getTime() + a2 * 60000;
    const fp = readPlace(box, "from", places), tp = readPlace(box, "to", places);
    if (!fp || !tp) return err("Bitte „Von“ und „Nach“ angeben.");
    const n = parseNum(box.querySelector('[data-r="km"]').value);
    if (Number.isNaN(n) || (n != null && (n < 0 || n >= 10000))) return err("Bitte gültige km eingeben (z. B. 12,5).");
    const vid = box.querySelector('[data-r="veh"]').value || null;
    const purpose = pa.purpose();
    const drive = {
      start, end, activity: "Autofahren",
      placeId: fp.placeId, place: fp.place, loc: fp.loc,
      endLoc: tp.loc, endPlace: tp.place || (tp.loc && tp.loc.addr) || "", endPlaceId: tp.placeId,
      manualTrip: true,
    };
    if (purpose) drive.purpose = purpose;
    if (state.private) drive.private = true;
    if (vid) drive.vehicleId = vid;
    if (n != null) drive.km = Math.round(n * 10) / 10;

    const st = ctx.store.get();
    const host = st.entries.find((e) => (!e.kind || e.kind === "work") && Number.isFinite(e.start) && Number.isFinite(e.end) &&
      e.start <= start && e.end >= end && !e.tripOnly);
    try {
      if (host) {
        const segs = insertTrip(host, drive);
        if (!segs) return err("Die Fahrt überschneidet mehrere Abschnitte dieses Eintrags – bitte Zeiten anpassen.");
        await ctx.store.saveEntry({ ...host, segments: segs });
        ctx.ui.toast("Fahrt im Eintrag des Tages eingefügt");
      } else {
        const overlap = st.entries.some((e) => (!e.kind || e.kind === "work") && Number.isFinite(e.start) && Number.isFinite(e.end) && e.start < end && e.end > start);
        if (overlap) return err("Die Fahrt überschneidet sich mit einem Eintrag – sie muss ganz in einem Eintrag oder ganz außerhalb liegen.");
        await ctx.store.saveEntry({
          kind: "work", start, end,
          pauseMin: state.private ? Math.round((end - start) / 60000) : 0,
          placeId: tp.placeId, place: tp.place || tp.label || "",
          note: state.private ? "Privatfahrt (nachgetragen)" : "Fahrt (nachgetragen)",
          people: [], inLoc: fp.loc && fp.loc.lat != null ? fp.loc : null, outLoc: tp.loc && tp.loc.lat != null ? tp.loc : null,
          segments: [drive], tripOnly: true, ...(state.private ? { privateTrip: true } : {}), // Update 9 – Privat: zählt nie als Arbeitszeit
        });
        ctx.ui.toast("Fahrt gespeichert");
      }
      sheet.close();
      if (cur && (cur.from.getMonth() !== day.getMonth() || cur.from.getFullYear() !== day.getFullYear())) {
        cur.from = new Date(day.getFullYear(), day.getMonth(), 1); render();
      }
    } catch { /* Store zeigt Toast */ }
  });
  return sheet;
}

/* ---------------- Fahrzeuge ---------------- */

export function openVehicles(ctx, { month } = {}) {
  const u = ctx.util, esc = u.esc;
  const m0 = month || new Date();
  const mk = monthKey(m0);
  const mName = `${u.MONTHS[m0.getMonth()]} ${m0.getFullYear()}`;
  const sheet = ctx.ui.openSheet({ title: "Fahrzeuge", bodyHTML: `<div class="fields fb-veh-sheet" data-r="host"></div>` });
  const host = sheet.el.querySelector('[data-r="host"]');
  const save = async (vehicles, trips) => {
    const s = ctx.store.get().settings || {};
    const p = { vehicles };
    if (trips) p.trips = { ...readTripSettings(s), ...trips };
    try { await ctx.store.saveSettings(p); return true; } catch { return false; }
  };
  const draw = () => {
    const s = ctx.store.get().settings || {};
    const vs = readVehicles(s);
    const def = defaultVehicle(s);
    host.innerHTML = `
      ${vs.length ? `<ul class="fb-vlist">${vs.map((v) => `<li class="fb-v" data-vid="${esc(v.id)}">
        <div class="fb-v-h"><b>${esc(v.name)}</b>${v.plate ? `<span class="fb-plate">${esc(v.plate)}</span>` : ""}<small>${esc(VEHICLE_TYPES[v.type])}</small></div>
        <div class="fb-v-a">
          <label class="fb-def"><input type="radio" name="fb-def" value="${esc(v.id)}"${def && def.id === v.id ? " checked" : ""}> Standard</label>
          <label class="rm-inline fb-odo"><span>km-Stand 1. ${esc(mName)}</span><input type="text" inputmode="numeric" data-odo="${esc(v.id)}" value="${v.odoStart[mk] != null ? esc(String(v.odoStart[mk])) : ""}" placeholder="optional"></label>
          <button type="button" class="btn ghost sm fb-vdel" data-vdel="${esc(v.id)}" aria-label="${esc(v.name)} löschen">${icon("trash", 16)}</button>
        </div>
      </li>`).join("")}</ul>` : `<p class="note">Noch kein Fahrzeug. Lege dein Firmenauto oder dein eigenes Auto an – dann stehen Fahrzeug und Kennzeichen im Fahrtenbuch.</p>`}
      <p class="note">Mit dem Kilometerstand am Monatsanfang rechnet das Fahrtenbuch für jede Fahrt den Stand bei Beginn/Ende aus (weiter bis zum nächsten eingetragenen Stand).</p>
      <div class="fb-vadd">
        <div class="lbl">Neues Fahrzeug</div>
        <div class="row">
          <label>Name <input type="text" data-r="vn" placeholder="z. B. VW Caddy" maxlength="40"></label>
          <label>Kennzeichen <input type="text" data-r="vp" placeholder="z. B. G-123AB" maxlength="14" autocapitalize="characters"></label>
        </div>
        <div class="chips" role="group" aria-label="Fahrzeugart">
          <button type="button" class="chip" data-vt="firma" aria-pressed="true">Firmenauto</button>
          <button type="button" class="chip" data-vt="privat" aria-pressed="false">Privatauto (Kilometergeld)</button>
        </div>
        <div class="row"><button type="button" class="btn primary sm" data-r="vadd">${icon("plus", 16)}<span>Hinzufügen</span></button></div>
      </div>`;
  };
  draw();
  let vt = "firma";
  host.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-vt]");
    if (t) { vt = t.dataset.vt; host.querySelectorAll("[data-vt]").forEach((c) => c.setAttribute("aria-pressed", String(c === t))); return; }
    const del = ev.target.closest("[data-vdel]");
    if (del) {
      const s = ctx.store.get().settings || {};
      const left = readVehicles(s).filter((v) => v.id !== del.dataset.vdel);
      const ts = readTripSettings(s);
      if (await save(left, ts.defaultVehicleId === del.dataset.vdel ? { defaultVehicleId: null } : null)) { draw(); ctx.ui.toast("Fahrzeug entfernt"); }
      return;
    }
    if (ev.target.closest('[data-r="vadd"]')) {
      const name = host.querySelector('[data-r="vn"]').value.trim();
      const plate = host.querySelector('[data-r="vp"]').value.trim().toUpperCase();
      if (!name && !plate) { ctx.ui.toast("Bitte Name oder Kennzeichen eingeben."); return; }
      const s = ctx.store.get().settings || {};
      const vs = readVehicles(s);
      const v = { id: u.newId("v"), name: name || plate, plate, type: vt, odoStart: {} };
      if (await save([...vs, v], vs.length ? null : { defaultVehicleId: v.id })) { vt = "firma"; draw(); ctx.ui.toast("Fahrzeug gespeichert"); }
    }
  });
  host.addEventListener("change", async (ev) => {
    const r = ev.target.closest('input[name="fb-def"]');
    if (r) { await save(readVehicles(ctx.store.get().settings), { defaultVehicleId: r.value }); ctx.ui.toast("Standard-Fahrzeug gesetzt"); return; }
    const o = ev.target.closest("[data-odo]");
    if (o) {
      const n = parseNum(o.value);
      if (Number.isNaN(n) || (n != null && (n < 0 || n > 9999999))) { ctx.ui.toast("Bitte einen gültigen Kilometerstand eingeben."); return; }
      const vs = readVehicles(ctx.store.get().settings).map((v) => {
        if (v.id !== o.dataset.odo) return v;
        const odoStart = { ...v.odoStart };
        if (n == null) delete odoStart[mk]; else odoStart[mk] = Math.round(n);
        return { ...v, odoStart };
      });
      if (await save(vs)) ctx.ui.toast(n == null ? "Kilometerstand entfernt" : `Kilometerstand ${fmtOdo(n)} gespeichert`);
    }
  });
  return sheet;
}

/* ---------------- Export ---------------- */

function exportData(snap, from) {
  const s = snap.settings || {};
  const trips = monthTrips(snap, from);
  const odo = monthOdometer(snap, from);
  const rows = logRows(trips, s, odo);
  const tot = totals(trips, s);
  return { trips, odo, rows, tot, s };
}

const nF = (n) => `${n} ${n === 1 ? "Fahrt" : "Fahrten"}`;
function km1(v) { return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1).replace(".", ","); }

export function downloadCSV(ctx, from) {
  const snap = ctx.store.get();
  const { rows, tot } = exportData(snap, from);
  if (!rows.length) { ctx.ui.toast("Keine Fahrten in diesem Monat."); return; }
  const sums = [
    ["Summe", "", "", "", "", nF(tot.count), km1(tot.km)],
    ["davon beruflich", "", "", "", "", nF(tot.bizN), km1(tot.bizKm)],
    ["davon privat", "", "", "", "", nF(tot.privN), km1(tot.privKm)],
  ];
  if (tot.showKmgeld) sums.push(["Kilometergeld", "", "", "", "", `${km1(tot.kmgeldKm)} km × ${fmtEur(tot.kmRate)}`, fmtEur(tot.kmgeld)]);
  const csv = ctx.exporter.fahrtenbuchCSV(LOG_HEAD, rows, sums);
  ctx.exporter.download(`Fahrtenbuch-${from.getFullYear()}-${pad(from.getMonth() + 1)}.csv`, csv);
}

/* ---------------- Druckansicht ---------------- */

let pr = null;

function renderPrint() {
  if (!pr) return;
  const { ctx, el } = pr;
  const esc = ctx.util.esc;
  const snap = ctx.store.get();
  const { trips, rows, tot, s } = exportData(snap, pr.from);
  const ap = readApprentice(s);
  const name = `${ctx.util.MONTHS[pr.from.getMonth()]} ${pr.from.getFullYear()}`;
  const used = [...new Map(trips.map((t) => tripVehicle(t, s)).filter(Boolean).map((v) => [v.id, v])).values()];
  const last = new Date(pr.from.getFullYear(), pr.from.getMonth() + 1, 0);
  el.querySelector(".fbp-mo").textContent = name;
  const field = (l, v) => `<div class="rp-f"><span>${l}</span><b>${v ? esc(v) : "&nbsp;"}</b></div>`;
  el.querySelector(".fbp-head").innerHTML = `
    <div class="rp-title"><h1>Fahrtenbuch</h1><span>${esc(name)}</span></div>
    <div class="rp-fields">
      ${field("Fahrer/in", ap.name)}
      ${field("Fahrzeug / Kennzeichen", used.map(vehicleLabel).join(", "))}
      ${field("Zeitraum", `01.${pad(pr.from.getMonth() + 1)}. – ${pad(last.getDate())}.${pad(last.getMonth() + 1)}.${last.getFullYear()}`)}
    </div>`;
  el.querySelector(".fbp-tbody").innerHTML = rows.length ? rows.map((r, i) => `<tr class="${trips[i].private ? "fbp-priv" : ""}">
      <td class="fbp-d">${esc(r[0].slice(0, 6))}</td><td class="fbp-t">${esc(r[1])}</td><td class="fbp-t">${esc(r[2])}</td>
      <td class="fbp-pl">${esc(r[3])}</td><td class="fbp-pl">${esc(r[4])}</td><td class="fbp-z">${esc(r[5])}</td>
      <td class="fbp-n">${esc(r[6])}</td><td class="fbp-o">${esc(r[7])}</td><td class="fbp-o">${esc(r[8])}</td>
      <td class="fbp-v">${esc(r[10] || r[9])}</td><td class="fbp-a">${r[11] === "privat" ? "P" : "B"}</td>
    </tr>`).join("") : `<tr><td colspan="11" class="fbp-none">Keine Fahrten in diesem Monat.</td></tr>`;
  el.querySelector(".fbp-sum").textContent = km1(tot.km);
  const kv = (l, v) => `<div class="ts-kv"><span>${l}</span><b>${esc(v)}</b></div>`;
  el.querySelector(".fbp-totals").innerHTML = `
    <div class="ts-box">
      ${kv("Fahrten", String(tot.count))}
      ${kv("Gefahrene km gesamt", `${km1(tot.km)} km`)}
      ${kv("davon beruflich (B)", `${km1(tot.bizKm)} km · ${nF(tot.bizN)}`)}
      ${kv("davon privat (P)", `${km1(tot.privKm)} km · ${nF(tot.privN)}`)}
    </div>
    <div class="ts-box">
      ${tot.showKmgeld ? kv(`Kilometergeld (${fmtEur(tot.kmRate)}/km)`, `${km1(tot.kmgeldKm)} km = ${fmtEur(tot.kmgeld)}`) : ""}
      ${kv("km-Quelle", [tot.roadN && `${tot.roadN}× Straße`, tot.manualN && `${tot.manualN}× manuell`, tot.estN && `${tot.estN}× geschätzt`].filter(Boolean).join(", ") || "–")}
      <p class="note fbp-note">Geschätzte km = Luftlinie × Umwegfaktor. Kilometerstand nur, wenn am Monatsanfang eingetragen.</p>
    </div>`;
}

function onPrintPop() { if (pr) closeTripPrint(true); }

export function closeTripPrint(fromPop = false) {
  if (!pr) return;
  const c = pr;
  pr = null;
  try { c.unsub && c.unsub(); } catch { /* egal */ }
  window.removeEventListener("popstate", onPrintPop);
  c.el.remove();
  document.body.classList.remove("fbp-open");
  if (!document.getElementById("fb-root")) document.body.style.overflow = c.prevOverflow;
  if (!fromPop && c.pushed && history.state && history.state.fbp) { skipPop = !!cur; history.back(); }
}

export function openTripPrint(ctx, { from } = {}) {
  if (pr) closeTripPrint();
  const now = new Date();
  const el = document.createElement("div");
  el.id = "fbp-root";
  el.className = "rp ts fbp";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Fahrtenbuch drucken");
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="rp-bar">
      <button type="button" class="btn ghost sm rp-close" data-fbp="close">${icon("chevron-left", 18)}<span>Zurück</span></button>
      <h2>Fahrtenbuch drucken</h2>
    </div>
    <div class="rp-nav">
      <button type="button" class="btn ghost sm rp-arrow" data-fbp="prev" aria-label="Voriger Monat">${icon("chevron-left", 20)}</button>
      <div class="rp-wk fbp-mo" aria-live="polite"></div>
      <button type="button" class="btn ghost sm rp-arrow" data-fbp="next" aria-label="Nächster Monat">${icon("chevron-right", 20)}</button>
    </div>
    <article class="rp-paper fbp-paper">
      <header class="rp-head fbp-head"></header>
      <div class="fbp-scroll">
        <table class="fbp-table">
          <thead><tr>
            <th class="fbp-d">Datum</th><th class="fbp-t">Abfahrt</th><th class="fbp-t">Ankunft</th>
            <th class="fbp-pl">Ausgangsort</th><th class="fbp-pl">Zielort</th><th class="fbp-z">Zweck</th>
            <th class="fbp-n">km</th><th class="fbp-o">km-Stand Beginn</th><th class="fbp-o">km-Stand Ende</th>
            <th class="fbp-v">Kennz.</th><th class="fbp-a">B/P</th>
          </tr></thead>
          <tbody class="fbp-tbody"></tbody>
          <tfoot><tr><td colspan="6">Monatssumme</td><td class="fbp-n fbp-sum"></td><td colspan="4"></td></tr></tfoot>
        </table>
      </div>
      <section class="ts-totals fbp-totals"></section>
      <footer class="rp-sign">
        <div><span class="rp-line"></span><span>Datum, Unterschrift Fahrer/in</span></div>
        <div><span class="rp-line"></span><span>Datum, Unterschrift Arbeitgeber</span></div>
      </footer>
    </article>
    <div class="rp-actions">
      <button type="button" class="btn primary" data-fbp="print">${icon("file", 20)}<span>Drucken / als PDF speichern</span></button>
      <button type="button" class="btn ghost" data-fbp="csv">${icon("download", 20)}<span>CSV</span></button>
    </div>`;
  pr = { ctx, from: from || new Date(now.getFullYear(), now.getMonth(), 1), el, pushed: false, unsub: null,
    prevOverflow: document.body.style.overflow || "" };
  document.body.appendChild(el);
  document.body.classList.add("fbp-open");
  document.body.style.overflow = "hidden";
  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-fbp]");
    if (!b || !pr) return;
    const a = b.dataset.fbp;
    if (a === "close") closeTripPrint();
    else if (a === "prev" || a === "next") { pr.from = new Date(pr.from.getFullYear(), pr.from.getMonth() + (a === "next" ? 1 : -1), 1); renderPrint(); }
    else if (a === "csv") downloadCSV(ctx, pr.from);
    else if (a === "print") {
      const prev = document.title;
      document.title = `Fahrtenbuch ${pr.from.getFullYear()}-${pad(pr.from.getMonth() + 1)}`;
      try { window.print(); } catch { ctx.ui.toast("Drucken geht hier nicht."); }
      setTimeout(() => { document.title = prev; }, 1000);
    }
  });
  el.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !document.querySelector("#sheet-root .sheet")) { ev.stopPropagation(); closeTripPrint(); } });
  try {
    history.pushState({ ...(history.state || {}), fbp: 1 }, "", location.href);
    pr.pushed = true;
    window.addEventListener("popstate", onPrintPop);
  } catch { /* egal */ }
  renderPrint();
  try { pr.unsub = ctx.store.subscribe(() => { if (pr) renderPrint(); }); } catch { /* egal */ }
  try { el.focus({ preventScroll: true }); } catch { /* egal */ }
  return { close: () => closeTripPrint() };
}
