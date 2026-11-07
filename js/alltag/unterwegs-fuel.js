// Unterwegs › Tanken & Fahrtkosten: Tankungen (Datum, Liter, Betrag, km-Stand, Tankstelle, voll getankt),
// Verbrauch l/100 km zwischen Volltankungen, €/km, Monatskosten, SVG-Diagramme (ohne Bibliothek),
// optional Buchung in Geld (money_tx, Kategorie „Auto & Tanken“), Fahrtenbuch-km aus js/travel.js nur zur Info.
// Sammlung travel_fuel: { id, date, liters, total, km, station, full, booked, vehicleId? }
// Update 10: vehicleId (settings.vehicles) – ohne Angabe zählt die Tankung zum Standard-Fahrzeug (Alltag › 🚗 Fahrzeuge).
import * as C from "./unterwegs-core.js";
import { icon } from "../icons.js";
import { esc } from "../util.js";
import * as store from "../store.js";
import { kmBetween } from "../travel.js";
import { readVehicles, defaultVehicle } from "../trip-core.js"; // Update 10 – Fahrzeuge: Tankung je Fahrzeug
import { bookMoney, unbookMoney, safeWrite } from "./unterwegs-shared.js";

const BOOK_KEY = "sk-uw-fuel-book";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const txId = (id) => "uw_fuel_" + id;

export function createFuel({ col, ui, queue }) {
  let mk = C.monthOf(C.todayKey());

  const fills = () => col.all().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (Number(b.km) || 0) - (Number(a.km) || 0));

  function driveKm(m) {
    try {
      const s = store.get();
      if (!s || !Array.isArray(s.entries) || !s.entries.length) return null;
      const [y, mo] = m.split("-").map(Number);
      const from = new Date(y, mo - 1, 1).getTime(), to = new Date(y, mo, 1).getTime();
      const km = kmBetween(s.entries, from, to, s.settings);
      return km > 0 ? km : null;
    } catch { return null; }
  }

  /* ---------- Diagramme (SVG) ---------- */

  function costChart(months) {
    const W = 320, H = 150, pl = 6, pr = 6, pt = 22, pb = 24;
    const max = Math.max(1, ...months.map((m) => m.sum));
    const bw = (W - pl - pr) / months.length;
    const barW = Math.min(30, bw * 0.56);
    const iMax = months.reduce((bi, m, i, a) => (m.sum > a[bi].sum ? i : bi), 0);
    const bars = months.map((m, i) => {
      const h = m.sum > 0 ? Math.max(4, ((H - pt - pb) * m.sum) / max) : 0;
      const x = pl + bw * i + (bw - barW) / 2, y = H - pb - h;
      const cur = m.mk === mk;
      const lbl = (cur || i === iMax) && m.sum > 0 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" class="uw-ch-v">${esc(C.eur(m.sum, { cents: false }))}</text>` : "";
      return `<g class="uw-ch-bar${cur ? " cur" : ""}"><title>${esc(C.monthLabel(m.mk))}: ${esc(C.eur(m.sum))}${m.liters ? ` · ${esc(C.num(m.liters, 1))} l` : ""}</title>` +
        `<rect x="${(pl + bw * i).toFixed(1)}" y="${pt - 16}" width="${bw.toFixed(1)}" height="${H - pt + 16}" fill="transparent"/>` +
        (h ? `<path d="M${x.toFixed(1)} ${(H - pb).toFixed(1)}V${(y + 4).toFixed(1)}q0 -4 4 -4h${(barW - 8).toFixed(1)}q4 0 4 4V${(H - pb).toFixed(1)}z" class="uw-ch-fill"/>` : "") +
        lbl +
        `<text x="${(pl + bw * i + bw / 2).toFixed(1)}" y="${H - 6}" class="uw-ch-x">${esc(C.monthLabel(m.mk, true))}</text></g>`;
    }).join("");
    return `<svg class="uw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tankkosten pro Monat">` +
      `<line x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}" class="uw-ch-base"/>${bars}</svg>`;
  }

  function consChart(points) {
    if (points.length < 2) return "";
    const W = 320, H = 130, pl = 30, pr = 10, pt = 14, pb = 22;
    const vals = points.map((p) => p.l100);
    let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 2) { lo -= 1; hi += 1; }
    const X = (i) => pl + ((W - pl - pr) * i) / (points.length - 1);
    const Y = (v) => pt + ((H - pt - pb) * (hi - v)) / (hi - lo);
    const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.l100).toFixed(1)}`).join("");
    const grid = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="uw-ch-grid"/><text x="${pl - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="uw-ch-y">${esc(C.num(v, v % 1 ? 1 : 0))}</text>`).join("");
    const last = points[points.length - 1];
    const dots = points.map((p, i) => `<g><title>${esc(C.fmtDate(p.date))}: ${esc(C.num(p.l100, 1))} l/100 km</title>` +
      `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.l100).toFixed(1)}" r="10" fill="transparent"/>` +
      `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.l100).toFixed(1)}" r="4" class="uw-ch-dot"/></g>`).join("");
    return `<svg class="uw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verbrauch zwischen Volltankungen">${grid}` +
      `<path d="${d}" class="uw-ch-line"/>${dots}` +
      `<text x="${X(points.length - 1).toFixed(1)}" y="${(Y(last.l100) - 9).toFixed(1)}" class="uw-ch-v" text-anchor="end">${esc(C.num(last.l100, 1))}</text>` +
      `<text x="${pl}" y="${H - 6}" class="uw-ch-x" text-anchor="start">${esc(C.fmtDate(points[0].date).slice(0, 6))}</text>` +
      `<text x="${W - pr}" y="${H - 6}" class="uw-ch-x" text-anchor="end">${esc(C.fmtDate(last.date).slice(0, 6))}</text></svg>`;
  }

  /* ---------- Seite ---------- */

  function html() {
    const all = fills();
    const st = C.fuelStats(all);
    const months = C.fuelMonths(all, mk, 6);
    const mCur = months[months.length - 1];
    const dkm = driveKm(mk);
    const cur = C.monthOf(C.todayKey());
    const consPts = all.filter((f) => st.rows.has(f.id)).map((f) => ({ date: f.date, l100: st.rows.get(f.id).l100 }))
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-12);
    const monthFills = all.filter((f) => C.monthOf(f.date) === mk);

    if (!all.length) {
      return `<div class="empty uw-empty"><div class="uw-empty-emo">⛽</div><h3>⛽ Noch keine Tankungen</h3>` +
        `<p>Trag beim Tanken Liter, Betrag und Kilometerstand ein – ab der zweiten Volltankung rechnet die App deinen Verbrauch aus.</p>` +
        `<button type="button" class="btn primary sm" data-fu="new">+ Tankung eintragen</button></div>` +
        (dkm ? `<p class="note uw-drivekm">${icon("car", 15)} Fahrtenbuch ${esc(C.monthLabel(mk))}: ≈ ${esc(C.num(dkm, 0))} km (aus deinen Arbeitsfahrten)</p>` : "");
    }

    const kpi = (lbl, val, unit, sub = "") => `<div class="uw-kpi"><small>${lbl}</small><b>${val}<i>${unit}</i></b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    return `<div class="uw-fuel">` +
      `<section class="card uw-fuel-hero">` +
        kpi("Ø Verbrauch", st.avgL100 != null ? esc(C.num(st.avgL100, 1)) : "–", " l/100 km", st.km ? `über ${esc(C.num(st.km, 0))} km` : "ab 2 Volltankungen") +
        kpi("Kosten pro km", st.eurKm != null ? esc(C.num(st.eurKm, 3).replace(/0$/, "")) : "–", " €/km", "nur Sprit") +
        kpi("Tanken " + esc(C.monthLabel(mk, true)), esc(C.eur(mCur.sum)), "", mCur.n ? `${mCur.n}× · ${esc(C.num(mCur.liters, 1))} l` : "nichts getankt") +
      `</section>` +
      `<div class="nav uw-nav"><button type="button" data-fu="mprev" aria-label="Voriger Monat">${icon("chevron-left", 20)}</button>` +
        `<b>${esc(C.monthLabel(mk))}</b><button type="button" data-fu="mnext" aria-label="Nächster Monat"${mk >= cur ? " disabled" : ""}>${icon("chevron-right", 20)}</button></div>` +
      (dkm ? `<p class="note uw-drivekm">${icon("car", 15)} Fahrtenbuch: ≈ <b>${esc(C.num(dkm, 0))} km</b> Arbeitsfahrten im ${esc(C.monthLabel(mk, true))}` +
        (st.eurKm != null ? ` · ≈ ${esc(C.eur(dkm * st.eurKm))} Sprit` : "") + `</p>` : "") +
      `<div class="uw-fuel-grid">` +
        `<section class="card uw-card"><h3 class="uw-h">Tankkosten pro Monat</h3>${costChart(months)}</section>` +
        (consPts.length >= 2 ? `<section class="card uw-card"><h3 class="uw-h">Verbrauch (l/100 km)</h3>${consChart(consPts)}</section>` : "") +
      `</div>` +
      `<section class="uw-sec"><h3 class="uw-h">Tankungen ${esc(C.monthLabel(mk))}</h3>` +
        (monthFills.length ? `<ul class="uw-fills">${monthFills.map((f) => {
          const r = st.rows.get(f.id);
          const ppl = C.pricePerL(f);
          return `<li><button type="button" class="uw-fill" data-fu="edit" data-id="${esc(f.id)}">` +
            `<span class="uw-fill-ic${f.full ? " full" : ""}" aria-hidden="true">⛽</span>` +
            `<span class="uw-fill-t"><b>${esc(f.station || "Tankung")}</b>` +
              `<small>${esc(C.fmtDate(f.date))} · ${esc(C.num(f.liters, 2))} l${ppl ? ` · ${esc(C.num(ppl, 3))} €/l` : ""} · ${esc(C.num(f.km, 0))} km${f.full ? " · voll" : ""}${f.booked ? " · in Geld" : ""}</small></span>` +
            `<span class="uw-fill-r"><b>${esc(C.eur(f.total))}</b>${r ? `<em class="uw-cons" data-l100="${r.l100.toFixed(2)}">${esc(C.num(r.l100, 1))} l/100</em>` : ""}</span>` +
          `</button></li>`;
        }).join("")}</ul>` : `<p class="note">In diesem Monat keine Tankungen.</p>`) +
      `</section>` +
      `<p class="note">Verbrauch = getankte Liter seit der letzten Volltankung ÷ gefahrene km. Teil-Tankungen zählen zur nächsten Volltankung.</p>` +
    `</div>`;
  }

  function openFill(fill = null, preset = {}) {
    const isNew = !fill;
    let vs = [], dv = null;
    try { const st = store.get().settings; vs = readVehicles(st); dv = defaultVehicle(st); } catch { /* egal */ }
    const presetV = preset && preset.vehicleId ? preset.vehicleId : null;
    const last = fills().find((x) => !presetV || (x.vehicleId || (dv && dv.id)) === presetV) || fills()[0];
    const f = fill || { date: C.todayKey(), liters: "", total: "", km: "", station: last ? last.station : "", full: true, booked: lsGet(BOOK_KEY) === "1", vehicleId: presetV || (last && last.vehicleId) || null };
    const vSel = f.vehicleId || (dv ? dv.id : "");
    ui.openSheet({
      title: isNew ? "Tankung eintragen" : "Tankung bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<div class="row"><label>Datum<input id="uw-f-date" type="date" value="${esc(f.date)}"></label>` +
        `<label>Kilometerstand<input id="uw-f-km" inputmode="numeric" placeholder="${last ? esc(String(last.km)) : "z. B. 84.250"}" value="${esc(C.numIn(f.km))}"></label></div>` +
        `<div class="row"><label>Liter<input id="uw-f-l" inputmode="decimal" placeholder="38,5" value="${esc(C.numIn(f.liters))}"></label>` +
        `<label>Betrag (€)<input id="uw-f-e" inputmode="decimal" placeholder="62,30" value="${esc(C.numIn(f.total))}"></label></div>` +
        `<p class="note uw-f-ppl" aria-live="polite"></p>` +
        (vs.length > 1 || (vs.length === 1 && f.vehicleId && f.vehicleId !== vs[0].id) ? `<label>Fahrzeug<select id="uw-f-veh">${vs.map((v) => `<option value="${esc(v.id)}"${v.id === vSel ? " selected" : ""}>🚗 ${esc(v.plate ? `${v.name} (${v.plate})` : v.name)}</option>`).join("")}</select></label>` : "") +
        `<label>Tankstelle<input id="uw-f-st" maxlength="40" placeholder="z. B. OMV Wels" value="${esc(f.station || "")}"></label>` +
        `<label class="uw-switch"><input id="uw-f-full" type="checkbox"${f.full ? " checked" : ""}><span>Voll getankt</span><small>Nötig für die Verbrauchsberechnung</small></label>` +
        `<label class="uw-switch"><input id="uw-f-book" type="checkbox"${f.booked ? " checked" : ""}><span>In Geld buchen</span><small>Als Ausgabe „Auto &amp; Tanken“</small></label>` +
      `</div>` +
      `<div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Löschen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (s) => sheet.querySelector(s);
        const ppl = () => {
          const l = C.parseNum($("#uw-f-l").value), e = C.parseNum($("#uw-f-e").value);
          $(".uw-f-ppl").textContent = l > 0 && e > 0 ? `= ${C.num(e / l, 3)} €/l` : "";
        };
        $("#uw-f-l").addEventListener("input", ppl); $("#uw-f-e").addEventListener("input", ppl); ppl();
        $("[data-save]").addEventListener("click", async () => {
          const date = $("#uw-f-date").value;
          const liters = C.parseNum($("#uw-f-l").value), total = C.parseNum($("#uw-f-e").value), km = C.parseNum($("#uw-f-km").value);
          if (!C.isKey(date)) { ui.toast("Bitte ein Datum wählen."); return; }
          if (!(liters > 0)) { ui.toast("Bitte die Liter eingeben."); return; }
          if (!(total > 0)) { ui.toast("Bitte den Betrag eingeben."); return; }
          if (!(km > 0)) { ui.toast("Bitte den Kilometerstand eingeben."); return; }
          const booked = $("#uw-f-book").checked;
          lsSet(BOOK_KEY, booked ? "1" : "0");
          const station = $("#uw-f-st").value.trim();
          const vEl = $("#uw-f-veh");
          const vehicleId = vEl ? vEl.value || null : (vs.length === 1 ? vs[0].id : (fill && fill.vehicleId) || null);
          const item = { ...(fill || {}), vehicleId, date, liters: Math.round(liters * 100) / 100, total: C.round2(total), km: Math.round(km), station, full: $("#uw-f-full").checked, booked };
          close();
          mk = C.monthOf(date);
          const id = await col.put(item);
          try {
            if (booked) await bookMoney(txId(id), { date, amount: item.total, category: "auto", note: `Tanken${station ? " " + station : ""} (${C.num(item.liters, 1)} l)` });
            else if (fill && fill.booked) await unbookMoney(txId(id));
            ui.toast(booked ? "Gespeichert ✓ – auch in Geld gebucht" : "Gespeichert ✓");
          } catch (err) { ui.toast("In Geld buchen fehlgeschlagen: " + (err.message || err), 4000); }
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich löschen?", async () => {
          close();
          if (fill.booked) await unbookMoney(txId(fill.id)).catch(() => {});
          await safeWrite(ui, col.remove(fill.id), fill.booked ? "Gelöscht – auch aus Geld entfernt" : "Gelöscht");
        });
      },
    });
  }

  function onClick(t) {
    const a = t.dataset.fu;
    if (!a) return false;
    if (a === "new") openFill();
    else if (a === "edit") openFill(col.get(t.dataset.id));
    else if (a === "mprev") { mk = C.shiftMonth(mk, -1); queue(); }
    else if (a === "mnext") { mk = C.shiftMonth(mk, 1); queue(); }
    return true;
  }

  return { html, onClick, openNew: (preset) => openFill(null, preset), openEdit: (f) => openFill(f) };
}
