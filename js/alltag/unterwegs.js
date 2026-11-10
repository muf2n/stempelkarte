// Alltag › Unterwegs: Reisen · Packlisten · Parkplatz · Tanken · Adressen.
// Sammlungen (js/alltag/db.js): travel_trips, travel_packing, travel_parking, travel_fuel, travel_places;
// Bilder einzeln in travel_images (siehe unterwegs-shared.js, nur bei Bedarf geladen).
// Reise: { id, title, dest, from, to, budget, notes, docs, imageId?, plan:[{id,day,time,place,note}],
//          expenses:[{id,date,amount,note,booked}] }
import { collection } from "./db.js";
import * as C from "./unterwegs-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as ui from "../ui.js";
import { createPack } from "./unterwegs-pack.js";
import { createPark } from "./unterwegs-park.js";
import { createFuel } from "./unterwegs-fuel.js";
import { createPlaces } from "./unterwegs-places.js";
import { createJournal } from "./unterwegs-journal.js"; // Update 11 – Reisetagebuch
import { putImage, getImage, cachedImage, delImage, shrinkImage, dataBytes, bookMoney, unbookMoney, safeWrite } from "./unterwegs-shared.js";

const TABS = [
  ["reisen", "Reisen", "plane"],
  ["packen", "Packlisten", "suitcase"],
  ["parken", "Parkplatz", "parking"],
  ["tanken", "Tanken", "fuel"],
  ["adressen", "Adressen", "phone"],
];
const TAB_KEY = "sk-uw-tab";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const expTx = (id) => "uw_exp_" + id;
const TRIP_EMOJI = ["✈️", "🏖️", "⛷️", "🏔️", "🚗", "🚆", "🧰", "🏕️", "🏙️", "🎉"];

function injectCSS() {
  if (document.getElementById("uw-css")) return;
  const l = document.createElement("link");
  l.id = "uw-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-unterwegs.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el, ctx) {
  injectCSS();
  const col = {
    trips: collection("travel_trips"),
    packing: collection("travel_packing"),
    parking: collection("travel_parking"),
    fuel: collection("travel_fuel"),
    places: collection("travel_places"),
    journal: collection("travel_journal"), // Update 11
  };
  const S = {
    tab: TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "reisen",
    trip: null,  // geöffnete Reise
    list: null,  // geöffnete Packliste (Reiter Packlisten)
  };
  let alive = true;
  let queued = false;
  const queue = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  };
  const trips = () => col.trips.all();

  const pack = createPack({ col: col.packing, trips, ui, queue });
  const park = createPark({ col: col.parking, ui, queue, isVisible: () => alive && S.tab === "parken" });
  const fuel = createFuel({ col: col.fuel, ui, queue });
  const places = createPlaces({ col: col.places, ui, queue });
  const journal = createJournal({ col: col.journal, ui, queue, todayKey: C.todayKey });

  el.innerHTML =
    `<div class="uw">` +
      `<div class="uw-tabs" role="tablist" aria-label="Unterwegs-Bereiche">` +
        TABS.map(([id, label, ic]) => `<button type="button" role="tab" class="uw-tab" data-tab="${id}" aria-selected="${id === S.tab}">${icon(ic, 18)}<span>${label}</span></button>`).join("") +
      `</div>` +
      `<div class="uw-page"></div>` +
      `<button type="button" class="uw-fab" data-uw="fab" aria-label="Hinzufügen">${icon("plus", 26)}</button>` +
    `</div>`;
  const page = el.querySelector(".uw-page");
  const tabsEl = el.querySelector(".uw-tabs");
  const fab = el.querySelector(".uw-fab");

  /* ---------- Rendern ---------- */

  function render() {
    tabsEl.querySelectorAll(".uw-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab)));
    if (S.tab !== "parken") park.hide();
    const a = document.activeElement;
    const keep = a && page.contains(a) && a.id ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
    page.dataset.tab = S.tab;
    let h;
    if (S.tab === "reisen") h = S.trip && col.trips.get(S.trip) ? tripDetailHTML(col.trips.get(S.trip)) : tripsHTML();
    else if (S.tab === "packen") h = S.list && col.packing.get(S.list) ? listPageHTML(col.packing.get(S.list)) : packOverviewHTML();
    else if (S.tab === "parken") h = park.html();
    else if (S.tab === "tanken") h = fuel.html();
    else h = places.html();
    page.innerHTML = h;
    if (keep) {
      const n = page.querySelector("#" + CSS.escape(keep.id));
      if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(keep.s, keep.e); } catch { /* egal */ } }
    }
    pack.afterRender(page);
    if (S.tab === "reisen" && S.trip) journal.afterRender(page);
    const showFab = (S.tab === "reisen" && !S.trip) || S.tab === "tanken" || S.tab === "adressen";
    fab.hidden = !showFab;
    fab.setAttribute("aria-label", S.tab === "tanken" ? "Tankung eintragen" : S.tab === "adressen" ? "Adresse hinzufügen" : "Reise hinzufügen");
  }

  function coverStyle(trip) {
    if (!trip.imageId) return "";
    const img = cachedImage(trip.imageId);
    if (!img) { getImage(trip.imageId).then((v) => { if (v) queue(); }); return ""; }
    return ` style="--uw-img:url('${img}')"`;
  }

  /* ---------- Reisen ---------- */

  function tripCardHTML(t) {
    const st = C.tripStatus(t);
    const l = col.packing.all().find((x) => x.tripId === t.id);
    const p = l ? C.packProgress(l) : null;
    const n = C.nights(t);
    const cs = coverStyle(t);
    return `<button type="button" class="uw-trip ${st.kind}${cs ? " has-img" : ""}" data-uw="opentrip" data-id="${esc(t.id)}"${cs}>` +
      `<span class="uw-trip-cover" aria-hidden="true">${cs ? "" : esc(t.emoji || "✈️")}</span>` +
      `<span class="uw-trip-body">` +
        `<span class="uw-pill ${st.kind}">${esc(st.label)}</span>` +
        `<b>${esc(t.title || t.dest || "Reise")}</b>` +
        `<small>${esc(C.dateRange(t))}${n ? ` · ${n} ${n === 1 ? "Nacht" : "Nächte"}` : ""}</small>` +
        (p && p.total ? `<span class="uw-mini-prog"><span><i style="width:${p.pct}%"></i></span><em>${p.pct} % gepackt</em></span>` : "") +
      `</span>` +
    `</button>`;
  }

  function tripsHTML() {
    const list = C.sortTrips(trips());
    if (!list.length) {
      return `<div class="empty uw-empty"><div class="uw-empty-emo">🧳</div><h3>🧳 Noch keine Reisen</h3>` +
        `<p>Urlaub, Wochenende oder Montage – leg eine Reise an und hab Packliste, Budget und Plan an einem Ort.</p>` +
        `<button type="button" class="btn primary sm" data-uw="newtrip">+ Reise hinzufügen</button></div>`;
    }
    const upcoming = list.filter((t) => C.tripStatus(t).kind !== "past");
    const past = list.filter((t) => C.tripStatus(t).kind === "past");
    return (upcoming.length ? `<div class="uw-trips">${upcoming.map(tripCardHTML).join("")}</div>` : `<p class="note">Keine geplante Reise – tipp auf + für eine neue.</p>`) +
      (past.length ? `<h3 class="uw-h uw-h-out">Vergangene Reisen</h3><div class="uw-trips past">${past.map(tripCardHTML).join("")}</div>` : "");
  }

  function tripDetailHTML(t) {
    const st = C.tripStatus(t);
    const n = C.nights(t);
    const list = col.packing.all().find((x) => x.tripId === t.id);
    const cs = coverStyle(t);
    const spent = C.spent(t);
    const budget = Number(t.budget) || 0;
    const ratio = budget ? spent / budget : 0;
    const T = esc(t.id);

    const hero = `<section class="uw-hero${cs ? " has-img" : ""}"${cs}>` +
      `<div class="uw-hero-top">` +
        `<button type="button" class="uw-hero-btn" data-uw="closetrip" aria-label="Alle Reisen">${icon("chevron-left", 20)}<span>Reisen</span></button>` +
        `<button type="button" class="uw-hero-btn" data-uw="edittrip" data-id="${T}" aria-label="Reise bearbeiten">${icon("pencil", 18)}</button>` +
      `</div>` +
      (cs ? "" : `<div class="uw-hero-emo" aria-hidden="true">${esc(t.emoji || "✈️")}</div>`) +
      `<div class="uw-hero-txt">` +
        `<span class="uw-pill ${st.kind}">${esc(st.label)}</span>` +
        `<h2>${esc(t.title || "Reise")}</h2>` +
        `<p>${t.dest ? `<span class="uw-hero-dest">${icon("pin", 15)}${esc(t.dest)}</span> · ` : ""}${esc(C.dateRange(t))}${n ? ` (${n} ${n === 1 ? "Nacht" : "Nächte"})` : ""}</p>` +
      `</div>` +
      (list ? `<div class="uw-hero-prog">${pack.progressHTML(list)}</div>` : "") +
    `</section>`;

    const packSec = `<section class="card uw-card uw-trip-pack"><h3 class="uw-h">${icon("suitcase", 18)} Packliste</h3>` +
      (list ? pack.listHTML(list, { embedded: true })
        : `<p class="note">Wähl eine Vorlage – du kannst danach alles anpassen.</p>${pack.templatePickerHTML("fortrip", ` data-trip="${T}"`)}`) +
    `</section>`;

    const budgetSec = `<section class="card uw-card uw-budget"><div class="uw-h-row"><h3 class="uw-h">${icon("wallet", 18)} Reisebudget</h3>` +
        `<button type="button" class="chip sm" data-uw="newexp" data-id="${T}">${icon("plus", 15)} Ausgabe</button></div>` +
      `<div class="uw-bud-top"><span><small>Ausgegeben</small><b>${esc(C.eur(spent))}</b></span>` +
        `<span><small>Geplant</small><b>${budget ? esc(C.eur(budget)) : `<button type="button" class="linkbtn" data-uw="edittrip" data-id="${T}">festlegen</button>`}</b></span>` +
        (budget ? `<span class="${spent > budget ? "over" : ""}"><small>${spent > budget ? "Drüber" : "Übrig"}</small><b>${esc(C.eur(Math.abs(budget - spent)))}</b></span>` : "") +
      `</div>` +
      (budget ? `<div class="uw-bud-bar ${ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : ""}"><div style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></div></div>` : "") +
      ((t.expenses || []).length
        ? `<ul class="uw-exps">${[...t.expenses].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((e) =>
            `<li><button type="button" data-uw="editexp" data-id="${T}" data-exp="${esc(e.id)}">` +
              `<span class="uw-exp-t"><b>${esc(e.note || "Ausgabe")}</b><small>${esc(C.fmtDate(e.date))}${e.booked ? " · in Geld" : ""}</small></span>` +
              `<b class="uw-exp-a">${esc(C.eur(e.amount))}</b></button></li>`).join("")}</ul>`
        : `<p class="note">Noch keine Ausgaben – Unterkunft, Tickets, Essen …</p>`) +
    `</section>`;

    const days = C.planByDay(t);
    const planSec = `<section class="card uw-card uw-plan"><div class="uw-h-row"><h3 class="uw-h">${icon("calendar", 18)} Reiseplan</h3>` +
        `<button type="button" class="chip sm" data-uw="newplan" data-id="${T}">${icon("plus", 15)} Punkt</button></div>` +
      (days.length ? days.map((d, i) => `<div class="uw-day">` +
          `<div class="uw-day-h${d.items.length ? "" : " free"}"><span class="uw-day-n">${d.day && C.isKey(t.from) ? "Tag " + (C.daysBetween(t.from, d.day) + 1) : "–"}</span><b>${d.day ? esc(C.fmtDay(d.day)) : "Ohne Datum"}</b>${d.items.length ? "" : `<small class="uw-day-free">frei</small>`}` +
            `<button type="button" class="uw-ib" data-uw="newplan" data-id="${T}" data-day="${esc(d.day)}" aria-label="Punkt an diesem Tag">${icon("plus", 16)}</button></div>` +
          (d.items.length ? `<ul class="uw-plan-list">${d.items.map((p) => `<li>` +
              `<button type="button" class="uw-plan-it" data-uw="editplan" data-id="${T}" data-pid="${esc(p.id)}">` +
                `<span class="uw-plan-time">${esc(p.time || "")}</span>` +
                `<span class="uw-plan-t"><b>${esc(p.place || p.note || "Programmpunkt")}</b>${p.place && p.note ? `<small>${esc(p.note)}</small>` : ""}</span>` +
              `</button>` +
              (p.place ? `<a class="uw-maps" href="${esc(C.mapsSearch(p.place))}" target="_blank" rel="noopener" aria-label="${esc(p.place)} in Google Maps öffnen">${icon("pin", 15)}<span>In Google Maps öffnen</span></a>` : "") +
            `</li>`).join("")}</ul>` : "") +
        `</div>`).join("")
        : `<p class="note">Leg Datum fest, dann erscheint jeder Tag hier.</p>`) +
    `</section>`;

    const docsSec = `<section class="card uw-card uw-docs"><h3 class="uw-h">${icon("file", 18)} Dokumente &amp; Notizen</h3>` +
      `<label class="field">Dokumente-Hinweis<textarea id="uw-t-docs" rows="3" data-trip="${T}" data-field="docs" placeholder="z. B. Pass liegt in der Schreibtischlade, Buchungsnr. ABC123, Versicherungsnr. …">${esc(t.docs || "")}</textarea></label>` +
      `<label class="field">Notizen<textarea id="uw-t-notes" rows="3" data-trip="${T}" data-field="notes" placeholder="Alles andere …">${esc(t.notes || "")}</textarea></label>` +
      `<small class="note">Wird beim Verlassen des Feldes gespeichert.</small>` +
    `</section>`;

    return `<div class="uw-detail">${hero}<div class="uw-detail-grid"><div class="uw-col">${packSec}</div><div class="uw-col">${budgetSec}${planSec}${journal.sectionHTML(t)}${docsSec}</div></div></div>`;
  }

  /* ---------- Packlisten-Reiter ---------- */

  function packOverviewHTML() {
    const all = col.packing.all();
    const forTrips = all.filter((l) => l.kind !== "template").sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const own = all.filter((l) => l.kind === "template");
    const tripOf = (l) => (l.tripId ? col.trips.get(l.tripId) : null);
    const row = (l) => {
      const p = C.packProgress(l); const t = tripOf(l);
      return `<button type="button" class="uw-listrow" data-uw="openlist" data-id="${esc(l.id)}">` +
        `<span class="uw-listrow-emo" aria-hidden="true">${esc(l.emoji || "🧳")}</span>` +
        `<span class="uw-listrow-t"><b>${esc(t ? t.title : l.title)}</b><small>${l.kind === "template" ? "Vorlage · " + p.total + " Dinge" : `${t ? "Reise · " : ""}${p.done}/${p.total} gepackt`}</small>` +
          (l.kind !== "template" ? `<span class="uw-mini-prog"><span><i style="width:${p.pct}%"></i></span><em>${p.pct} %</em></span>` : "") + `</span>` +
        `<span aria-hidden="true">${icon("chevron-right", 18)}</span></button>`;
    };
    return (forTrips.length ? `<section class="uw-sec"><h3 class="uw-h">Meine Packlisten</h3><div class="uw-lists">${forTrips.map(row).join("")}</div></section>` : "") +
      (own.length ? `<section class="uw-sec"><h3 class="uw-h">Eigene Vorlagen</h3><div class="uw-lists">${own.map(row).join("")}</div></section>` : "") +
      `<section class="uw-sec"><h3 class="uw-h">Neue Packliste aus Vorlage</h3>${pack.templatePickerHTML("fromtpl")}</section>`;
  }

  function listPageHTML(l) {
    return `<button type="button" class="al-back uw-back" data-uw="closelist">${icon("chevron-left", 20)}<span>Packlisten</span></button>` +
      `<section class="card uw-card">${pack.listHTML(l)}</section>` +
      (l.tripId && col.trips.get(l.tripId) ? `<button type="button" class="btn ghost sm" data-uw="opentrip" data-id="${esc(l.tripId)}">Zur Reise „${esc(col.trips.get(l.tripId).title)}“</button>` : "");
  }

  /* ---------- Formulare ---------- */

  function openTrip(trip = null) {
    const isNew = !trip;
    const t = trip || { title: "", dest: "", from: "", to: "", budget: "", emoji: "✈️" };
    let image; // undefined = unverändert, null = entfernen, string = neu
    const cur = t.imageId ? cachedImage(t.imageId) : null;
    ui.openSheet({
      title: isNew ? "Neue Reise" : "Reise bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<label>Titel<input id="uw-t-title" maxlength="50" placeholder="z. B. Sommer in Kroatien" value="${esc(t.title)}"></label>` +
        `<label>Reiseziel<input id="uw-t-dest" maxlength="60" placeholder="z. B. Split" value="${esc(t.dest || "")}"></label>` +
        `<div class="row"><label>Von<input id="uw-t-from" type="date" value="${esc(t.from || "")}"></label>` +
        `<label>Bis<input id="uw-t-to" type="date" value="${esc(t.to || "")}"></label></div>` +
        `<p class="note uw-t-nights" aria-live="polite"></p>` +
        `<label>Budget (€, optional)<input id="uw-t-budget" inputmode="decimal" placeholder="z. B. 800" value="${esc(C.numIn(t.budget))}"></label>` +
        `<div><p class="lbl" style="margin-bottom:6px">Symbol</p><div class="chips uw-emos">${TRIP_EMOJI.map((e) => `<button type="button" class="chip sm" data-emo="${e}" aria-pressed="${e === (t.emoji || "✈️")}">${e}</button>`).join("")}</div></div>` +
        `<div class="uw-photo-pick"><div class="uw-photo-prev wide">${cur ? `<img src="${esc(cur)}" alt="">` : "🖼️"}</div>` +
          `<label class="btn ghost sm uw-file">${icon("upload", 16)} Titelbild wählen<input id="uw-t-img" type="file" accept="image/*" hidden></label>` +
          (t.imageId ? `<button type="button" class="btn ghost sm" data-noimg>Bild entfernen</button>` : "") +
          `<small class="note uw-img-info"></small></div>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        let emoji = t.emoji || "✈️";
        const showN = () => {
          const f = $("#uw-t-from").value, to = $("#uw-t-to").value;
          const n = C.isKey(f) && C.isKey(to) ? C.daysBetween(f, to) : null;
          $(".uw-t-nights").textContent = n == null ? "" : n < 0 ? "⚠️ „Bis“ liegt vor „Von“" : `${n} ${n === 1 ? "Nacht" : "Nächte"}`;
        };
        $("#uw-t-from").addEventListener("change", () => { if (!$("#uw-t-to").value || $("#uw-t-to").value < $("#uw-t-from").value) $("#uw-t-to").value = $("#uw-t-from").value; showN(); });
        $("#uw-t-to").addEventListener("change", showN);
        showN();
        sheet.addEventListener("click", (ev) => {
          const b = ev.target.closest("[data-emo]");
          if (!b) return;
          emoji = b.dataset.emo;
          sheet.querySelectorAll("[data-emo]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        });
        $("#uw-t-img").addEventListener("change", async (ev) => {
          const f = ev.target.files && ev.target.files[0];
          if (!f) return;
          $(".uw-img-info").textContent = "Wird verkleinert …";
          try {
            const r = await shrinkImage(f, { maxSide: 1280, maxBytes: 300 * 1024 });
            image = r.data;
            $(".uw-photo-prev").innerHTML = `<img src="${esc(r.data)}" alt="">`;
            $(".uw-img-info").textContent = `${r.w}×${r.h} px · ${Math.round(r.bytes / 1024)} kB`;
            $(".uw-img-info").dataset.w = r.w; $(".uw-img-info").dataset.h = r.h; $(".uw-img-info").dataset.bytes = r.bytes;
          } catch (err) { $(".uw-img-info").textContent = ""; ui.toast(err.message || String(err), 3500); }
        });
        const ni = $("[data-noimg]");
        if (ni) ni.addEventListener("click", () => { image = null; $(".uw-photo-prev").textContent = "🖼️"; });
        $("[data-save]").addEventListener("click", async () => {
          const title = $("#uw-t-title").value.trim(), dest = $("#uw-t-dest").value.trim();
          const from = $("#uw-t-from").value, to = $("#uw-t-to").value;
          const braw = $("#uw-t-budget").value.trim();
          const budget = braw ? C.parseNum(braw) : "";
          if (!title && !dest) { ui.toast("Bitte einen Titel oder ein Reiseziel eingeben."); return; }
          if (C.isKey(from) && C.isKey(to) && to < from) { ui.toast("„Bis“ liegt vor „Von“."); return; }
          if (braw && !(budget >= 0)) { ui.toast("Das Budget ist ungültig."); return; }
          const item = { ...(trip || { plan: [], expenses: [], notes: "", docs: "" }), title: title || dest, dest, from: C.isKey(from) ? from : "", to: C.isKey(to) ? to : (C.isKey(from) ? from : ""), budget: budget === "" ? "" : C.round2(budget), emoji };
          close();
          try {
            if (image) {
              const tid = item.id || (item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
              const imgId = "trip_" + tid;
              await putImage(imgId, image);
              item.imageId = imgId;
            } else if (image === null && item.imageId) { await delImage(item.imageId).catch(() => {}); item.imageId = null; }
            const nid = await col.trips.put(item);
            ui.toast(isNew ? "Reise angelegt ✓" : "Gespeichert ✓");
            if (isNew) { S.trip = nid; window.scrollTo({ top: 0 }); queue(); }
          } catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Reise wirklich löschen?", async () => {
          close();
          const l = col.packing.all().find((x) => x.tripId === trip.id);
          if (l) await col.packing.remove(l.id).catch(() => {});
          if (trip.imageId) await delImage(trip.imageId).catch(() => {});
          S.trip = null;
          await safeWrite(ui, col.trips.remove(trip.id), "Reise gelöscht – Buchungen in Geld bleiben");
        });
      },
    });
  }

  async function mutateTrip(id, fn) {
    const cur = col.trips.get(id);
    if (!cur) return null;
    const next = JSON.parse(JSON.stringify(cur));
    fn(next);
    await col.trips.put(next);
    return next;
  }

  function openExpense(trip, exp = null) {
    const isNew = !exp;
    const e = exp || { date: C.todayKey() >= trip.from && trip.from ? C.todayKey() : (trip.from || C.todayKey()), amount: "", note: "", booked: lsGet("sk-uw-exp-book") === "1" };
    ui.openSheet({
      title: isNew ? "Ausgabe eintragen" : "Ausgabe bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<div class="row"><label>Betrag (€)<input id="uw-e-amt" inputmode="decimal" placeholder="0,00" value="${esc(C.numIn(e.amount))}"></label>` +
        `<label>Datum<input id="uw-e-date" type="date" value="${esc(e.date)}"></label></div>` +
        `<label>Wofür?<input id="uw-e-note" maxlength="60" placeholder="z. B. Hotel, Fähre, Abendessen" value="${esc(e.note || "")}"></label>` +
        `<div class="chips">${["Unterkunft", "Anreise", "Essen", "Eintritt", "Mietauto", "Souvenirs"].map((x) => `<button type="button" class="chip sm" data-q="${x}">${x}</button>`).join("")}</div>` +
        `<label class="uw-switch"><input id="uw-e-book" type="checkbox"${e.booked ? " checked" : ""}><span>Auch in Geld buchen</span><small>Als Ausgabe in der Kategorie „Reisen“</small></label>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        sheet.addEventListener("click", (ev) => { const b = ev.target.closest("[data-q]"); if (b) $("#uw-e-note").value = b.dataset.q; });
        $("[data-save]").addEventListener("click", async () => {
          const amount = C.parseNum($("#uw-e-amt").value);
          const date = $("#uw-e-date").value;
          if (!(amount > 0)) { ui.toast("Bitte einen Betrag eingeben."); return; }
          if (!C.isKey(date)) { ui.toast("Bitte ein Datum wählen."); return; }
          const note = $("#uw-e-note").value.trim();
          const booked = $("#uw-e-book").checked;
          lsSet("sk-uw-exp-book", booked ? "1" : "0");
          const item = { ...(exp || { id: C.sid("e") }), amount: C.round2(amount), date, note, booked };
          close();
          try {
            await mutateTrip(trip.id, (t) => {
              t.expenses = (t.expenses || []).filter((x) => x.id !== item.id);
              t.expenses.push(item);
            });
            if (booked) await bookMoney(expTx(item.id), { date, amount: item.amount, category: "reisen", note: `${note || "Reise"} (${trip.title})` });
            else if (exp && exp.booked) await unbookMoney(expTx(item.id));
            ui.toast(booked ? "Gespeichert ✓ – auch in Geld gebucht" : "Gespeichert ✓");
          } catch (err) { console.error(err); ui.toast("Speichern fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          close();
          if (exp.booked) await unbookMoney(expTx(exp.id)).catch(() => {});
          await mutateTrip(trip.id, (t) => { t.expenses = (t.expenses || []).filter((x) => x.id !== exp.id); });
          ui.toast(exp.booked ? "Gelöscht – auch aus Geld entfernt" : "Gelöscht");
        });
      },
    });
  }

  function openPlan(trip, point = null, day = "") {
    const isNew = !point;
    const p = point || { day: day || trip.from || C.todayKey(), time: "", place: "", note: "" };
    ui.openSheet({
      title: isNew ? "Programmpunkt" : "Programmpunkt bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<div class="row"><label>Tag<input id="uw-p-day" type="date" value="${esc(p.day || "")}"${trip.from ? ` min="${esc(trip.from)}"` : ""}${trip.to ? ` max="${esc(trip.to)}"` : ""}></label>` +
        `<label>Uhrzeit<input id="uw-p-time" type="time" value="${esc(p.time || "")}"></label></div>` +
        `<label>Ort<input id="uw-p-place" maxlength="80" placeholder="z. B. Diokletianpalast, Split" value="${esc(p.place || "")}"></label>` +
        `<label>Notiz<input id="uw-p-note" maxlength="120" placeholder="z. B. Tickets online gekauft" value="${esc(p.note || "")}"></label>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        $("[data-save]").addEventListener("click", async () => {
          const item = { ...(point || { id: C.sid("p") }), day: $("#uw-p-day").value, time: $("#uw-p-time").value, place: $("#uw-p-place").value.trim(), note: $("#uw-p-note").value.trim() };
          if (!item.place && !item.note) { ui.toast("Bitte einen Ort oder eine Notiz eingeben."); return; }
          close();
          await safeWrite(ui, mutateTrip(trip.id, (t) => { t.plan = (t.plan || []).filter((x) => x.id !== item.id); t.plan.push(item); }), "Gespeichert ✓");
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          close();
          await safeWrite(ui, mutateTrip(trip.id, (t) => { t.plan = (t.plan || []).filter((x) => x.id !== point.id); }), "Gelöscht");
        });
      },
    });
  }

  /* ---------- Ereignisse ---------- */

  function goTab(tab) {
    S.tab = tab; lsSet(TAB_KEY, tab);
    render();
  }

  async function onClick(ev) {
    const t = ev.target.closest("[data-tab], [data-uw], [data-pk], [data-pa], [data-fu], [data-pl], [data-jr]");
    if (!t || !el.contains(t)) return;
    if (t.classList.contains("uw-tab")) {
      if (S.tab === t.dataset.tab) { S.trip = null; S.list = null; }
      goTab(t.dataset.tab);
      t.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      return;
    }
    if (t.dataset.pa) { if (park.onClick(t)) ev.preventDefault(); return; }
    if (t.dataset.fu) { fuel.onClick(t); return; }
    if (t.dataset.pl) { places.onClick(t); return; }
    if (t.dataset.jr) { journal.onClick(t, col.trips.get(t.dataset.id)); return; }
    if (t.dataset.pk) {
      if (pack.onClick(t, { onDeleted: (id) => { if (S.list === id) { S.list = null; queue(); } } })) return;
      if (t.dataset.pk === "fromtpl") {
        const id = await pack.createFrom(t, { title: "" });
        S.list = id; queue(); window.scrollTo({ top: 0 });
        return;
      }
      if (t.dataset.pk === "fortrip") {
        const trip = col.trips.get(t.dataset.trip);
        if (!trip) return;
        await pack.createFrom(t, { tripId: trip.id, title: "Packliste " + (trip.title || "") });
        ui.toast("Packliste angelegt ✓");
        return;
      }
      return;
    }
    const id = t.dataset.id;
    switch (t.dataset.uw) {
      case "fab":
        if (S.tab === "tanken") fuel.openNew();
        else if (S.tab === "adressen") places.openNew();
        else openTrip();
        break;
      case "newtrip": openTrip(); break;
      case "opentrip": S.tab = "reisen"; lsSet(TAB_KEY, "reisen"); S.trip = id; render(); window.scrollTo({ top: 0 }); break;
      case "closetrip": S.trip = null; render(); break;
      case "edittrip": openTrip(col.trips.get(id)); break;
      case "newexp": { const tr = col.trips.get(id); if (tr) openExpense(tr); break; }
      case "editexp": { const tr = col.trips.get(id); const e = tr && (tr.expenses || []).find((x) => x.id === t.dataset.exp); if (e) openExpense(tr, e); break; }
      case "newplan": { const tr = col.trips.get(id); if (tr) openPlan(tr, null, t.dataset.day || ""); break; }
      case "editplan": { const tr = col.trips.get(id); const p = tr && (tr.plan || []).find((x) => x.id === t.dataset.pid); if (p) openPlan(tr, p); break; }
      case "openlist": S.list = id; render(); window.scrollTo({ top: 0 }); break;
      case "closelist": S.list = null; render(); break;
      default: break;
    }
  }
  function onInput(ev) { places.onInput(ev); }
  function onChange(ev) {
    if (pack.onChange(ev)) return;
    const ta = ev.target.closest("textarea[data-trip]");
    if (ta) {
      const id = ta.dataset.trip, f = ta.dataset.field, v = ta.value;
      const cur = col.trips.get(id);
      if (cur && (cur[f] || "") !== v) safeWrite(ui, col.trips.patch(id, { [f]: v }), "Gespeichert ✓");
    }
  }
  function onSubmit(ev) { pack.onSubmit(ev); }

  el.addEventListener("click", onClick);
  el.addEventListener("input", onInput);
  el.addEventListener("change", onChange);
  el.addEventListener("submit", onSubmit);

  const offs = Object.values(col).map((c) => c.watch(queue));
  render();

  // Zeitabhängiges (Parkschein, Countdown) regelmäßig auffrischen
  const tick = setInterval(() => { if (S.tab === "parken") park.tick(); }, 15000);
  const onVis = () => { if (document.visibilityState === "visible") queue(); };
  document.addEventListener("visibilitychange", onVis);

  // Test-Haken (nur localhost)
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__uwTest = { park: park.test, C };

  return () => {
    alive = false;
    park.hide();
    clearInterval(tick);
    offs.forEach((off) => off());
    el.removeEventListener("click", onClick);
    el.removeEventListener("input", onInput);
    el.removeEventListener("change", onChange);
    el.removeEventListener("submit", onSubmit);
    document.removeEventListener("visibilitychange", onVis);
    el.innerHTML = "";
  };
}
