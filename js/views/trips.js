// Update 9 (Agent B): Karte „Fahrten & Taggeld“ in der Übersicht – Kilometer im Monat/Jahr,
// Kilometergeld (eigenes Auto), Taggeld-Monatssumme, Fahrtenbuch- und Taggeld-Liste (Blätter).
// Wird in #trips-panel eingehängt. openAllowanceDay(key, ctx) wird auch von entries.js verwendet.
import { icon } from "../icons.js";
import {
  readAllowance, tripsBetween, allowanceByDay, allowanceSummary, dayOverride,
  fmtKm, fmtEur, LEVEL_LABELS,
} from "../travel.js";

let ctx = null;
let root = null;
let snap = null;
let monthOffset = 0;
let lastKey = "";

const $ = (sel) => root.querySelector(sel);

function monthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to };
}

function allowanceMap(s, from, to) {
  return allowanceByDay({
    entries: s.entries, places: s.places, days: s.days, settings: s.settings, dayKey: ctx.util.dayKey,
  }, from, to);
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("tg");
  root.innerHTML = `
    <div class="tg-h"><h2>${icon("car", 20)}Fahrten &amp; Taggeld</h2></div>
    <div class="nav">
      <button class="btn ghost sm" type="button" data-tgmo="-1" aria-label="Voriger Monat">${icon("chevron-left", 18)}</button>
      <b data-tg="label"></b>
      <button class="btn ghost sm" type="button" data-tgmo="1" aria-label="Nächster Monat">${icon("chevron-right", 18)}</button>
    </div>
    <div class="tg-tiles">
      <div class="tg-tile"><span class="tg-l">Kilometer</span><strong data-tg="km">0</strong><span class="tg-sub" data-tg="trips"></span></div>
      <div class="tg-tile tg-t-money"><span class="tg-l">Taggeld</span><strong data-tg="tg">–</strong><span class="tg-sub" data-tg="tgsub"></span></div>
    </div>
    <div class="kv"><span data-tg="yearl">Kilometer im Jahr</span><b data-tg="year"></b></div>
    <div class="kv" data-tg="kmgrow" hidden><span data-tg="kmgl">Kilometergeld</span><b data-tg="kmg"></b></div>
    <p class="note" data-tg="hint" hidden></p>
    <div class="tg-actions">
      <button type="button" class="btn ghost sm" data-tg-open="log">${icon("list", 18)}<span>Fahrtenbuch</span></button>
      <button type="button" class="btn ghost sm" data-tg-open="days">${icon("calendar", 18)}<span>Taggeld-Tage</span></button>
    </div>
    <p class="note tg-legal">Kilometer sind geschätzt (Luftlinie × Umwegfaktor), wenn du sie nicht selbst einträgst. Ob und wie viel Taggeld dir zusteht, regelt dein Kollektivvertrag – keine Rechtsberatung.</p>`;

  root.addEventListener("click", (ev) => {
    const mo = ev.target.closest("[data-tgmo]");
    if (mo) { monthOffset += Number(mo.dataset.tgmo); lastKey = ""; render(); return; }
    const op = ev.target.closest("[data-tg-open]");
    if (op) {
      if (op.dataset.tgOpen === "log") openLog();
      else openDays();
    }
  });
  try { snap = ctx.store.get(); } catch { snap = null; }
  render();
}

export function update(s) {
  snap = s;
  render();
}

function render() {
  if (!root || !ctx || !snap || !root.querySelector(".tg-tiles")) return;
  const u = ctx.util;
  const { from, to } = monthRange();
  const f = from.getTime(), t = to.getTime();
  const s = snap.settings || {};
  const a = readAllowance(s);
  const trips = tripsBetween(snap.entries, f, t, s);
  const y = from.getFullYear();
  const yearKm = tripsBetween(snap.entries, new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), s)
    .reduce((x, tr) => x + (tr.km || 0), 0);
  const km = trips.reduce((x, tr) => x + (tr.km || 0), 0);
  const unknown = trips.filter((tr) => tr.km == null).length;
  const am = allowanceMap(snap, f, t);
  const sum = allowanceSummary(am);

  const key = JSON.stringify([f, km, yearKm, trips.length, unknown, a, sum]);
  if (key === lastKey) return;
  lastKey = key;

  $('[data-tg="label"]').textContent = `${u.MONTHS[from.getMonth()]} ${y}`;
  $('[data-tg="km"]').innerHTML = `${km > 0 ? "≈ " : ""}${u.esc(fmtKm(km))}<small> km</small>`;
  $('[data-tg="trips"]').textContent = trips.length
    ? `${trips.length} ${trips.length === 1 ? "Fahrt" : "Fahrten"}${unknown ? ` · ${unknown} ohne km` : ""}`
    : "keine Fahrten";
  $('[data-tg="yearl"]').textContent = `Kilometer ${y} gesamt`;
  $('[data-tg="year"]').textContent = `${yearKm > 0 ? "≈ " : ""}${fmtKm(yearKm)} km`;
  const kmRow = $('[data-tg="kmgrow"]');
  kmRow.hidden = !a.ownCar;
  $('[data-tg="kmgl"]').textContent = `Kilometergeld (${fmtEur(a.kmRate)}/km, eigenes Auto)`;
  $('[data-tg="kmg"]').textContent = fmtEur(km * a.kmRate);

  const tgEl = $('[data-tg="tg"]');
  const subEl = $('[data-tg="tgsub"]');
  const hint = $('[data-tg="hint"]');
  const tile = root.querySelector(".tg-t-money");
  tile.classList.toggle("off", !a.enabled);
  if (!a.enabled) {
    tgEl.textContent = "aus";
    subEl.textContent = "in den Einstellungen";
    hint.hidden = false;
    hint.textContent = "Taggeld ist ausgeschaltet. Einschalten unter Einstellungen → „Taggeld & Kilometergeld“.";
  } else {
    tgEl.textContent = sum.part + sum.full === 0 ? fmtEur(0) : (sum.missingRate && sum.sum === 0 ? "–" : fmtEur(sum.sum));
    const p = [];
    if (sum.full) p.push(`${sum.full}× voll`);
    if (sum.part) p.push(`${sum.part}× teilw.`);
    subEl.textContent = p.length ? p.join(" · ") : "keine Taggeld-Tage";
    hint.hidden = !sum.missingRate;
    hint.textContent = sum.missingRate ? "Beträge fehlen: Trag sie unter Einstellungen → „Taggeld & Kilometergeld“ laut deinem Kollektivvertrag / Lohnzettel ein." : "";
  }
  root.querySelector('[data-tg-open="days"]').hidden = !a.enabled;
}

/* ---------------- Fahrtenbuch ---------------- */

function openLog() {
  const u = ctx.util;
  const { from, to } = monthRange();
  const s = snap.settings || {};
  const trips = tripsBetween(snap.entries, from.getTime(), to.getTime(), s);
  const total = trips.reduce((x, tr) => x + (tr.km || 0), 0);
  const rows = trips.map((tr, i) => {
    const d = new Date(tr.start);
    const kmTxt = tr.km == null ? "? km" : `${tr.manual ? "" : "≈ "}${fmtKm(tr.km)} km`;
    return `<li><button type="button" class="tg-trip" data-trip="${i}">
      <span class="tg-trip-d">${u.esc(u.WD[d.getDay()])} ${u.pad(d.getDate())}.${u.pad(d.getMonth() + 1)}.<small>${u.esc(u.clock(tr.start))}–${u.esc(u.clock(tr.end))}</small></span>
      <span class="tg-trip-r"><b>${u.esc(tr.from || "?")} → ${u.esc(tr.to || "?")}</b>${tr.purpose ? `<small>Zweck: ${u.esc(tr.purpose)}</small>` : ""}</span>
      <span class="tg-trip-km${tr.km == null ? " none" : ""}">${u.esc(kmTxt)}${tr.manual ? "<small>manuell</small>" : ""}</span>
    </button></li>`;
  }).join("");
  const body = `
    <div class="tg-sheet">
      <p class="note">${u.esc(u.MONTHS[from.getMonth()])} ${from.getFullYear()} · ${trips.length} ${trips.length === 1 ? "Fahrt" : "Fahrten"} · gesamt ${total > 0 ? "≈ " : ""}${u.esc(fmtKm(total))} km</p>
      ${trips.length ? `<ul class="tg-log">${rows}</ul>` : `<p class="note">Keine Fahrten in diesem Monat. Fahrten entstehen aus Abschnitten „Autofahren“ beim Stempeln.</p>`}
      <p class="note">Tippe auf eine Fahrt, um den Eintrag zu öffnen und die Kilometer selbst einzutragen (hat Vorrang vor der Schätzung).</p>
      ${trips.length ? `<button type="button" class="btn ghost sm" data-tg-csv="1">Fahrtenbuch als CSV</button>` : ""}
    </div>`;
  const sheet = ctx.ui.openSheet({ title: "Fahrtenbuch", bodyHTML: body });
  sheet.el.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-trip]");
    if (b) {
      const tr = trips[Number(b.dataset.trip)];
      if (tr) { sheet.close(); ctx.openEntryForm(tr.entry); }
      return;
    }
    if (ev.target.closest("[data-tg-csv]")) {
      const cell = (v) => { const x = v == null ? "" : String(v); return /[;"\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const lines = [["Datum", "Beginn", "Ende", "Von", "Nach", "Zweck", "km", "manuell"]];
      for (const tr of trips) {
        const d = new Date(tr.start);
        lines.push([`${u.pad(d.getDate())}.${u.pad(d.getMonth() + 1)}.${d.getFullYear()}`, u.clock(tr.start), u.clock(tr.end),
          tr.from, tr.to, tr.purpose, tr.km == null ? "" : (Math.round(tr.km * 10) / 10).toFixed(1).replace(".", ","), tr.manual ? "ja" : ""]);
      }
      lines.push(["Summe", "", "", "", "", "", (Math.round(total * 10) / 10).toFixed(1).replace(".", ","), ""]);
      const csv = "﻿" + lines.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
      ctx.exporter.download(`Fahrtenbuch-${from.getFullYear()}-${u.pad(from.getMonth() + 1)}.csv`, csv);
    }
  });
}

/* ---------------- Taggeld-Tage ---------------- */

function openDays() {
  const u = ctx.util;
  const { from, to } = monthRange();
  const a = readAllowance(snap.settings);
  const render = (el) => {
    const s = ctx.store.get();
    const am = [...allowanceMap(s, from.getTime(), to.getTime()).values()].sort((x, y) => (x.key < y.key ? -1 : 1));
    const sum = allowanceSummary(new Map(am.map((d) => [d.key, d])));
    el.innerHTML = `
      <p class="note">${u.esc(u.MONTHS[from.getMonth()])} ${from.getFullYear()} · ${sum.full}× voll · ${sum.part}× teilweise · ${sum.missingRate && !sum.sum ? "Beträge fehlen" : u.esc(fmtEur(sum.sum))}</p>
      <p class="note">Gezählt wird die Zeit außerhalb deiner Heim-Orte (Fahrten inklusive): ab ${u.esc(String(a.minHours).replace(".", ","))} h teilweise, ab ${u.esc(String(a.fullHours).replace(".", ","))} h voll.</p>
      ${am.length ? `<ul class="tg-days">${am.map((d) => {
        const [y, m, dd] = d.key.split("-").map(Number);
        const dt = new Date(y, m - 1, dd);
        return `<li><button type="button" class="tg-day-row lvl-${d.level}" data-tgday="${u.esc(d.key)}">
          <span class="tg-trip-d">${u.esc(u.WD[dt.getDay()])} ${u.pad(dd)}.${u.pad(m)}.<small>${u.esc(u.hm(Math.round(d.hours * 60)))} h weg</small></span>
          <span class="tg-trip-r"><b>${u.esc(LEVEL_LABELS[d.level])}</b><small>${d.manual ? "manuell" : "automatisch"}</small></span>
          <span class="tg-trip-km">${d.level === "none" ? "–" : (d.amount == null ? "? €" : u.esc(fmtEur(d.amount)))}</span>
        </button></li>`;
      }).join("")}</ul>` : `<p class="note">Keine Arbeitstage in diesem Monat.</p>`}
      <p class="note">Tippe auf einen Tag, um das Taggeld selbst festzulegen.</p>`;
  };
  const sheet = ctx.ui.openSheet({ title: "Taggeld-Tage", bodyHTML: `<div class="tg-sheet" data-tg-days></div>` });
  const host = sheet.el.querySelector("[data-tg-days]");
  render(host);
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-tgday]");
    if (b) openAllowanceDay(b.dataset.tgday, ctx, () => { if (host.isConnected) render(host); });
  });
}

/** Blatt: Taggeld eines Tages festlegen (Automatisch / kein / teilweise / voll). */
export function openAllowanceDay(key, c, onDone) {
  const cx = c || ctx;
  if (!cx || !key) return;
  const u = cx.util;
  const s = cx.store.get();
  const a = readAllowance(s.settings);
  const [y, m, d] = key.split("-").map(Number);
  const from = new Date(y, m - 1, d).getTime();
  const info = allowanceByDay({ entries: s.entries, places: s.places, days: s.days, settings: s.settings, dayKey: u.dayKey },
    from, new Date(y, m - 1, d + 1).getTime()).get(key);
  const cur = dayOverride(s.days, key);
  const auto = info ? info.auto : "none";
  const amt = (lvl) => { const v = lvl === "full" ? a.rateFull : lvl === "part" ? a.ratePart : 0; return lvl === "none" ? "" : (v == null ? " · Betrag fehlt" : ` · ${fmtEur(v)}`); };
  const opt = (val, label) => `<button type="button" class="chip" data-lvl="${val}" aria-pressed="${String((cur || "auto") === val)}">${u.esc(label)}</button>`;
  const body = `
    <div class="tg-sheet">
      <p class="note">${u.esc(u.fmtDate(from))} · ${u.esc(u.hm(Math.round((info ? info.hours : 0) * 60)))} h außerhalb der Heim-Orte → automatisch: <b>${u.esc(LEVEL_LABELS[auto])}</b>${u.esc(amt(auto))}</p>
      <div class="chips tg-lvls" role="group" aria-label="Taggeld für diesen Tag">
        ${opt("auto", "Automatisch")}${opt("none", "Kein Taggeld")}${opt("part", "Teilweise")}${opt("full", "Voll")}
      </div>
      <p class="note">Beträge laut deinem Kollektivvertrag / Lohnzettel.</p>
    </div>`;
  const sheet = cx.ui.openSheet({ title: "Taggeld für diesen Tag", bodyHTML: body });
  sheet.el.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-lvl]");
    if (!b) return;
    const v = b.dataset.lvl;
    try {
      await cx.store.saveDay(key, { allowance: v === "auto" ? null : v });
      sheet.close();
      cx.ui.toast(v === "auto" ? "Taggeld: automatisch" : `Taggeld: ${LEVEL_LABELS[v]}`);
      if (onDone) onDone();
    } catch { /* Store zeigt Toast */ }
  });
}
