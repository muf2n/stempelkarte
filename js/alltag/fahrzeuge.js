// Update 10 – Alltag › 🚗 Fahrzeuge (#alltag/fahrzeuge, Detail: #alltag/fahrzeuge/<id>).
// Baut auf den Fahrzeugen des Fahrtenbuchs auf (settings.vehicles: Name, Kennzeichen, Art, km-Stand am Monatsanfang) –
// keine zweite Liste. Zusatzangaben (Marke/Modell, km-Stände, Service, §57a-Pickerl, Versicherung, Notizen) liegen in der
// Alltag-Sammlung „fahrzeug_info“ (Dokument-ID = Fahrzeug-ID). Tankbuch = Unterwegs › Tanken (travel_fuel, vehicleId).
// Reine Logik: ./fahrzeug-core.js
import { collection } from "./db.js";
import * as F from "./fahrzeug-core.js";
import { createFuel } from "./unterwegs-fuel.js";
import { num, eur, parseNum } from "./unterwegs-core.js";
import * as ui from "../ui.js";
import * as store from "../store.js";
import { icon } from "../icons.js";
import { esc, newId } from "../util.js";
import { readVehicles, defaultVehicle, readTripSettings, VEHICLE_TYPES } from "../trip-core.js";

function injectCSS() {
  if (document.getElementById("fzg-css")) return;
  const l = document.createElement("link");
  l.id = "fzg-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-fahrzeuge.css", import.meta.url).href;
  document.head.appendChild(l);
}

const settings = () => { try { return store.get().settings || {}; } catch { return {}; } };
const vehicles = () => readVehicles(settings());
const defId = () => { const d = defaultVehicle(settings()); return d ? d.id : null; };
const today = () => F.todayKey();
const safe = (p, ok) => Promise.resolve(p).then(() => { if (ok) ui.toast(ok); return true; })
  .catch((err) => { console.error(err); ui.toast("Speichern hat nicht geklappt – bitte nochmal probieren."); return false; });
const kmIn = (v) => (v == null ? "" : String(v));
const STATE_CLS = { ok: "ok", bald: "warn", jetzt: "warn", toleranz: "bad", abgelaufen: "bad", ueber: "bad", none: "none" };
const SRC_E = { eintrag: "📝", tanken: "⛽", fahrtenbuch: "📒" };

/** Für Benachrichtigungen/Dashboard: Pickerl/Service/Versicherung, die bald fällig sind. */
export async function dueVehicles(at = Date.now()) {
  const wait = (col) => (col.loaded ? Promise.resolve() : new Promise((res) => {
    let off = null;
    const t = setTimeout(() => { if (off) off(); res(); }, 4000);
    off = col.watch(() => { if (col.loaded) { clearTimeout(t); queueMicrotask(() => { if (off) off(); }); res(); } });
  }));
  const info = collection("fahrzeug_info"), fuel = collection("travel_fuel");
  await Promise.all([wait(info), wait(fuel)]);
  return F.dueVehicles(vehicles(), info.all(), fuel.all(), at, { defaultId: defId() });
}

export function mount(el) {
  injectCSS();
  const info = collection("fahrzeug_info");
  const fuelCol = collection("travel_fuel");
  const S = { id: F.routeId(location.hash) || null };
  let alive = true, queued = false;
  const queue = () => {
    if (queued || !alive) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (alive) render(); });
  };
  const fuel = createFuel({ col: fuelCol, ui, queue });

  el.innerHTML = `<div class="fzg"></div>`;
  const root = el.querySelector(".fzg");

  const infoOf = (id) => F.normInfo(info.get(id), id);
  const fillsOf = (id) => F.vehicleFills(fuelCol.all(), id, defId());
  const label = (v) => (v.plate ? `${v.name} (${v.plate})` : v.name);
  const plate = (v) => (v.plate ? `<span class="fzg-plate" aria-label="Kennzeichen ${esc(v.plate)}"><i aria-hidden="true">A</i>${esc(v.plate)}</span>` : "");
  const badge = (st, text) => `<span class="fzg-b fzg-b-${STATE_CLS[st] || "none"}">${text}</span>`;

  function facts(v) {
    const inf = infoOf(v.id);
    const fills = fillsOf(v.id);
    const reads = F.odoReadings(inf, fills, v);
    const km = F.currentKm(reads);
    const d = today();
    return { inf, fills, reads, km, kmYear: F.kmPerYear(reads), cons: F.consumption(fills),
      pk: F.pickerlStatus(inf, d), sv: F.serviceStatus(inf, km, d), ins: F.insuranceStatus(inf, d) };
  }

  function pkBadge(pk) {
    if (pk.state === "none") return "";
    const e = pk.state === "ok" ? "🔖" : pk.state === "abgelaufen" ? "⛔" : pk.state === "toleranz" ? "⚠️" : "⏰";
    return badge(pk.state, `${e} Pickerl ${esc(pk.state === "ok" || pk.state === "bald" ? F.monthLabel(pk.month) : pk.state === "jetzt" ? "jetzt fällig" : pk.state === "toleranz" ? "in Toleranzfrist" : "abgelaufen")}`);
  }
  function svBadge(sv) {
    if (sv.state === "none") return "";
    return badge(sv.state, `🔧 Service ${sv.state === "ueber" ? "überfällig" : sv.state === "bald" ? "bald" : "ok"}`);
  }

  /* ---------- Übersicht ---------- */

  function renderList() {
    const vs = vehicles();
    if (!vs.length) {
      root.innerHTML = `<div class="empty fzg-empty"><div class="fzg-empty-emo">🚗</div><h3>Noch kein Fahrzeug</h3>` +
        `<p>Leg dein Firmenauto oder dein eigenes Auto an – dann behältst du Pickerl, Service, Tankbuch und Kilometerstand im Blick. Die Fahrzeuge gelten auch fürs Fahrtenbuch. 🛣️</p>` +
        `<button type="button" class="btn primary sm" data-f="new">＋ Fahrzeug anlegen</button></div>`;
      return;
    }
    const def = defId();
    root.innerHTML = `<div class="fzg-head"><p class="note">Deine Fahrzeuge – dieselben wie im Fahrtenbuch.</p><button type="button" class="btn primary sm" data-f="new">${icon("plus", 16)}<span>Fahrzeug</span></button></div>` +
      `<ul class="fzg-list">${vs.map((v) => {
        const x = facts(v);
        return `<li><button type="button" class="fzg-card" data-f="open" data-id="${esc(v.id)}">` +
          `<span class="fzg-card-ic" aria-hidden="true">${v.type === "privat" ? "🚗" : "🚐"}</span>` +
          `<span class="fzg-card-t"><span class="fzg-card-n"><b>${esc(v.name)}</b>${plate(v)}</span>` +
            `<small>${esc([x.inf.make, VEHICLE_TYPES[v.type], v.id === def && vs.length > 1 ? "Standard" : ""].filter(Boolean).join(" · "))}</small>` +
            `<small>${x.km ? `🛣️ ${esc(F.fmtKm(x.km))}` : "🛣️ km-Stand noch offen"}${x.cons.l100 != null ? ` · ⛽ ${esc(num(x.cons.l100, 1))} l/100 km` : ""}</small>` +
            `<span class="fzg-badges">${pkBadge(x.pk)}${svBadge(x.sv)}${x.ins.state === "bald" || x.ins.state === "ueber" ? badge(x.ins.state, "🛡️ Versicherung") : ""}</span></span>` +
          `<span class="fzg-go" aria-hidden="true">${icon("chevron-right", 18)}</span></button></li>`;
      }).join("")}</ul>`;
  }

  /* ---------- Detail ---------- */

  function renderDetail() {
    const v = vehicles().find((x) => x.id === S.id);
    const back = `<button type="button" class="btn ghost sm fzg-back" data-f="back">${icon("chevron-left", 16)}<span>Alle Fahrzeuge</span></button>`;
    if (!v) { root.innerHTML = back + `<div class="empty fzg-empty"><div class="fzg-empty-emo">🔍</div><h3>Fahrzeug nicht gefunden</h3><p>Vielleicht wurde es im Fahrtenbuch entfernt.</p></div>`; return; }
    const x = facts(v);
    const { inf, pk, sv, ins, cons } = x;
    const lastFills = x.fills.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (Number(b.km) || 0) - (Number(a.km) || 0)).slice(0, 5);
    const reads = x.reads.slice().reverse().slice(0, 6);
    const kpi = (lbl, val, sub = "") => `<div class="fzg-kpi"><small>${lbl}</small><b>${val}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    root.innerHTML = back +
      `<section class="card fzg-hero">` +
        `<span class="fzg-hero-ic" aria-hidden="true">${v.type === "privat" ? "🚗" : "🚐"}</span>` +
        `<div class="fzg-hero-t"><h3>${esc(v.name)}</h3>${plate(v)}<p>${esc([inf.make, VEHICLE_TYPES[v.type]].filter(Boolean).join(" · "))}</p></div>` +
        `<button type="button" class="btn ghost sm" data-f="edit">${icon("pencil", 16)}<span>Bearbeiten</span></button>` +
      `</section>` +
      `<div class="fzg-grid">` +
      // Pickerl
      `<section class="card fzg-sec fzg-pk"><h4>🔖 Pickerl (§57a)</h4>` +
        (pk.state === "none" ? `<p class="note">Trag den gelochten Monat von deiner Plakette ein – die App erinnert dich rechtzeitig. 🗓️</p>`
          : `<div class="fzg-big">${esc(F.monthLabel(pk.month))}</div>${pk.state === "ok" ? "" : `<p>${pkBadge(pk)}</p>`}<p class="fzg-sub">${esc(pk.label)}</p>`) +
        `<div class="fzg-btns"><button type="button" class="btn ghost sm" data-f="pickerl">${pk.state === "none" ? "Monat eintragen" : "Ändern"}</button>` +
        (pk.state !== "none" ? `<button type="button" class="btn primary sm" data-f="pkdone">✅ Erledigt</button>` : "") + `</div>` +
        `<details class="fzg-hint"><summary>ℹ️ Wie war das nochmal?</summary><p>${esc(F.PICKERL_HINT)}</p></details>` +
      `</section>` +
      // Service
      `<section class="card fzg-sec"><h4>🔧 Service</h4>` +
        (sv.state === "none" && !sv.label ? `<p class="note">Wann war das letzte Service? Mit Intervall (z. B. 12 Monate / 15.000 km) rechnet die App das nächste aus.</p>`
          : `<p>${svBadge(sv) || badge("warn", "🔧 Letztes Service fehlt")}</p><p class="fzg-sub">${esc(sv.label)}</p>`) +
        (inf.service.lastDate || inf.service.lastKm ? `<p class="fzg-sub">Zuletzt: ${esc([inf.service.lastDate ? F.fmtKey(inf.service.lastDate) : "", inf.service.lastKm ? F.fmtKm(inf.service.lastKm) : ""].filter(Boolean).join(" · "))}` +
          `${inf.service.everyMonths || inf.service.everyKm ? ` · alle ${esc([inf.service.everyMonths ? inf.service.everyMonths + " Monate" : "", inf.service.everyKm ? F.fmtKm(inf.service.everyKm) : ""].filter(Boolean).join(" / "))}` : ""}</p>` : "") +
        `<div class="fzg-btns"><button type="button" class="btn ghost sm" data-f="service">Service eintragen</button></div>` +
      `</section>` +
      // Tankbuch
      `<section class="card fzg-sec fzg-fuel"><h4>⛽ Tankbuch</h4>` +
        `<div class="fzg-kpis">${kpi("Ø Verbrauch", cons.l100 != null ? `${esc(num(cons.l100, 1))} <i>l/100 km</i>` : "–", cons.km ? `über ${esc(F.fmtKm(cons.km))}` : "ab 2 Volltankungen")}` +
          `${kpi("Spritkosten", cons.eur100 != null ? `${esc(eur(cons.eur100))} <i>/100 km</i>` : "–", `${x.fills.length} Tankung${x.fills.length === 1 ? "" : "en"}`)}</div>` +
        (lastFills.length ? `<ul class="fzg-fills">${lastFills.map((f) => {
          const r = cons.rows.get(f.id);
          return `<li><button type="button" class="fzg-fill" data-f="fill" data-id="${esc(f.id)}"><span>${esc(F.fmtKey(f.date))}${f.full ? "" : " · teil"}</span>` +
            `<span>${esc(num(f.liters, 1))} l · ${esc(eur(f.total))}</span>${r ? `<em>${esc(num(r.l100, 1))} l/100</em>` : "<em></em>"}</button></li>`;
        }).join("")}</ul>` : `<p class="note">Noch keine Tankung für dieses Fahrzeug.</p>`) +
        `<div class="fzg-btns"><button type="button" class="btn primary sm" data-f="newfill">＋ Tankung</button><a class="btn ghost sm" href="#alltag/unterwegs" data-f="tankbuch">Ganzes Tankbuch</a></div>` +
      `</section>` +
      // Kilometerstand
      `<section class="card fzg-sec"><h4>🛣️ Kilometerstand</h4>` +
        `<div class="fzg-big">${x.km ? esc(F.fmtKm(x.km)) : "–"}</div>` +
        (x.kmYear ? `<p class="fzg-sub">≈ ${esc(F.fmtKm(x.kmYear))} pro Jahr</p>` : "") +
        (reads.length ? `<ul class="fzg-reads">${reads.map((r) => `<li><span aria-hidden="true">${SRC_E[r.src] || "•"}</span><span>${esc(F.fmtKey(r.date))}</span><b>${esc(F.fmtKm(r.km))}</b></li>`).join("")}</ul>` : "") +
        `<div class="fzg-btns"><button type="button" class="btn ghost sm" data-f="odo">＋ km-Stand</button></div>` +
        `<p class="note fzg-legend">📝 eingetragen · ⛽ beim Tanken · 📒 Fahrtenbuch (Monatsanfang)</p>` +
      `</section>` +
      // Versicherung
      `<section class="card fzg-sec"><h4>🛡️ Versicherung</h4>` +
        (inf.insurance.company || inf.insurance.policy || inf.insurance.until
          ? `<dl class="fzg-dl">${inf.insurance.company ? `<div><dt>Gesellschaft</dt><dd>${esc(inf.insurance.company)}</dd></div>` : ""}` +
            `${inf.insurance.policy ? `<div><dt>Polizzennummer</dt><dd class="fzg-mono">${esc(inf.insurance.policy)}</dd></div>` : ""}` +
            `${inf.insurance.until ? `<div><dt>Läuft bis</dt><dd>${badge(ins.state, esc(ins.label))}</dd></div>` : ""}</dl>`
          : `<p class="note">Gesellschaft, Polizzennummer und Ablauf – nur das Nötigste, keine Zugangsdaten.</p>`) +
        `<div class="fzg-btns"><button type="button" class="btn ghost sm" data-f="ins">${inf.insurance.company || inf.insurance.until ? "Ändern" : "Eintragen"}</button></div>` +
      `</section>` +
      // Dokumente
      `<section class="card fzg-sec fzg-docs"><h4>📄 Dokumente</h4>` +
        `<p class="note">Zulassungsschein, Polizze, Pickerl-Gutachten &amp; Co. legst du am besten verschlüsselt im <b>Passwort-Tresor › Dokumente</b> ab. 🔐</p>` +
        `<div class="fzg-btns"><a class="btn ghost sm" href="#alltag/tresor">🔐 Zum Tresor</a></div>` +
      `</section>` +
      (inf.notes ? `<section class="card fzg-sec"><h4>📝 Notizen</h4><p class="fzg-pre">${esc(inf.notes)}</p></section>` : "") +
      `</div>`;
  }

  function render() {
    if (!alive) return;
    if (S.id) renderDetail(); else renderList();
  }

  /* ---------- Speichern ---------- */

  const saveInfo = (id, patch, ok) => {
    const cur = info.get(id) || { id };
    return safe(info.put({ ...cur, ...patch, id, updated: Date.now() }), ok);
  };
  const saveVehicles = async (list, trips) => {
    const p = { vehicles: list };
    if (trips) p.trips = { ...readTripSettings(settings()), ...trips };
    return safe(store.saveSettings(p));
  };

  function sheetForm(title, body, onSave, onMount = null) {
    ui.openSheet({
      title, bodyHTML: `<div class="fields">${body}</div><div class="row"><button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        $("[data-save]").addEventListener("click", async () => {
          const r = await onSave($);
          if (r !== false) close();
        });
        if (onMount) onMount($);
      },
    });
  }

  function openBasics(v = null) {
    const isNew = !v;
    const inf = v ? infoOf(v.id) : F.normInfo({});
    let type = v ? v.type : "firma";
    ui.openSheet({
      title: isNew ? "🚗 Neues Fahrzeug" : "Fahrzeug bearbeiten",
      bodyHTML: `<div class="fields">` +
        `<div class="row"><label>Name<input id="fzg-n" maxlength="40" placeholder="z. B. Firmenbus" value="${esc(v ? v.name : "")}"></label>` +
        `<label>Kennzeichen<input id="fzg-p" maxlength="14" autocapitalize="characters" placeholder="z. B. XX-123AB" value="${esc(v ? v.plate : "")}"></label></div>` +
        `<label>Marke / Modell<input id="fzg-m" maxlength="60" placeholder="z. B. Marke Modell, Baujahr" value="${esc(inf.make)}"></label>` +
        `<div class="chips" role="group" aria-label="Fahrzeugart">` +
          `<button type="button" class="chip" data-vt="firma" aria-pressed="${type === "firma"}">🚐 Firmenauto</button>` +
          `<button type="button" class="chip" data-vt="privat" aria-pressed="${type === "privat"}">🚗 Privatauto (Kilometergeld)</button></div>` +
        `<label>Notizen<textarea id="fzg-no" rows="3" maxlength="1000" placeholder="z. B. Reifengröße, Werkstatt">${esc(inf.notes)}</textarea></label>` +
        (isNew ? `<p class="note">Das Fahrzeug erscheint auch im Fahrtenbuch.</p>` : "") +
      `</div><div class="row">${isNew ? "" : `<button type="button" class="btn danger sm" data-del>Entfernen</button>`}<button type="button" class="btn primary" data-save>Speichern</button></div>`,
      onMount(sheet, close) {
        const $ = (q) => sheet.querySelector(q);
        sheet.querySelectorAll("[data-vt]").forEach((b) => b.addEventListener("click", () => {
          type = b.dataset.vt; sheet.querySelectorAll("[data-vt]").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
        }));
        $("[data-save]").addEventListener("click", async () => {
          const name = $("#fzg-n").value.trim(), pl = $("#fzg-p").value.trim().toUpperCase();
          if (!name && !pl) { ui.toast("Bitte Name oder Kennzeichen eingeben."); return; }
          close();
          const vs = vehicles();
          let id = v && v.id;
          if (isNew) {
            id = newId("v");
            await saveVehicles([...vs, { id, name: name || pl, plate: pl, type, odoStart: {} }], vs.length ? null : { defaultVehicleId: id });
          } else {
            await saveVehicles(vs.map((x) => (x.id === id ? { ...x, name: name || pl, plate: pl, type } : x)));
          }
          await saveInfo(id, { make: $("#fzg-m").value.trim(), notes: $("#fzg-no").value.trim() }, isNew ? `🚗 ${name || pl} angelegt` : "Gespeichert ✓");
          if (isNew) location.hash = F.vehicleHash(id).slice(1);
        });
        const del = $("[data-del]");
        if (del) ui.confirmButton(del, "Wirklich entfernen?", async () => {
          close();
          const ts = readTripSettings(settings());
          await saveVehicles(vehicles().filter((x) => x.id !== v.id), ts.defaultVehicleId === v.id ? { defaultVehicleId: null } : null);
          await info.remove(v.id).catch(() => {});
          ui.toast("Fahrzeug entfernt – Tankungen bleiben im Tankbuch.");
          location.hash = "alltag/fahrzeuge";
        });
      },
    });
  }

  function openPickerl(v) {
    const inf = infoOf(v.id);
    sheetForm("🔖 Pickerl (§57a)",
      `<label>Gelochter Monat auf der Plakette<input id="fzg-pm" type="month" value="${esc(inf.pickerl.month || "")}"></label>` +
      `<div class="lbl">Danach alle</div><div class="chips" data-r="yrs">${[1, 2, 3].map((y) => `<button type="button" class="chip" data-y="${y}" aria-pressed="${inf.pickerl.years === y}">${y} Jahr${y > 1 ? "e" : ""}</button>`).join("")}</div>` +
      `<p class="note">${esc(F.PICKERL_HINT)}</p>`,
      async ($) => {
        const m = $("#fzg-pm").value;
        if (m && !F.isMonth(m)) { ui.toast("Bitte einen Monat wählen."); return false; }
        const yb = $('[data-r="yrs"] [aria-pressed="true"]');
        const y = yb ? Number(yb.dataset.y) || 1 : 1;
        await saveInfo(v.id, { pickerl: { month: m || null, years: y } }, m ? `🔖 Pickerl ${F.monthLabel(m)} gespeichert` : "Pickerl entfernt");
      },
      ($) => {
        const box = $('[data-r="yrs"]');
        box.addEventListener("click", (ev) => { const b = ev.target.closest("[data-y]"); if (b) box.querySelectorAll("[data-y]").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); });
      });
  }

  function pickerlDone(v) {
    const inf = infoOf(v.id);
    const next = F.nextPickerlMonth(inf.pickerl.month, inf.pickerl.years);
    if (!next) return;
    saveInfo(v.id, { pickerl: { ...inf.pickerl, month: next } }, `✅ Pickerl erledigt – nächstes ${F.monthLabel(next)} 🎉`);
  }

  function openService(v) {
    const inf = infoOf(v.id);
    const km = facts(v).km;
    sheetForm("🔧 Service",
      `<div class="row"><label>Letztes Service am<input id="fzg-sd" type="date" value="${esc(inf.service.lastDate || today())}"></label>` +
      `<label>bei km-Stand<input id="fzg-sk" inputmode="numeric" placeholder="${km ? esc(String(km)) : "z. B. 45000"}" value="${esc(kmIn(inf.service.lastKm))}"></label></div>` +
      `<div class="lbl">Intervall</div>` +
      `<div class="row"><label>alle … Monate<input id="fzg-sm" inputmode="numeric" placeholder="z. B. 12" value="${esc(kmIn(inf.service.everyMonths))}"></label>` +
      `<label>oder alle … km<input id="fzg-skm" inputmode="numeric" placeholder="z. B. 15000" value="${esc(kmIn(inf.service.everyKm))}"></label></div>` +
      `<p class="note">Was zuerst kommt, zählt. Steht meist im Serviceheft. 🔧</p>`,
      async ($) => {
        const n = (sel, max) => { const raw = $(sel).value.trim(); if (!raw) return null; const x = parseNum(raw); return Number.isFinite(x) && x > 0 && x <= max ? Math.round(x) : NaN; };
        const lastKm = n("#fzg-sk", 9999999), everyMonths = n("#fzg-sm", 120), everyKm = n("#fzg-skm", 200000);
        if ([lastKm, everyMonths, everyKm].some((x) => Number.isNaN(x))) { ui.toast("Bitte gültige Zahlen eingeben."); return false; }
        const lastDate = $("#fzg-sd").value || null;
        await saveInfo(v.id, { service: { ...inf.service, lastDate, lastKm, everyMonths, everyKm } }, "🔧 Service gespeichert");
      });
  }

  function openOdo(v) {
    const km = facts(v).km;
    sheetForm("🛣️ Kilometerstand",
      `<div class="row"><label>Datum<input id="fzg-od" type="date" value="${today()}"></label>` +
      `<label>km-Stand<input id="fzg-ok" inputmode="numeric" placeholder="${km ? esc(String(km)) : "z. B. 45000"}"></label></div>` +
      `<label>Notiz (optional)<input id="fzg-on" maxlength="120" placeholder="z. B. Reifenwechsel"></label>`,
      async ($) => {
        const date = $("#fzg-od").value, k = parseNum($("#fzg-ok").value);
        if (!F.isKey(date)) { ui.toast("Bitte ein Datum wählen."); return false; }
        if (!(k > 0 && k < 10000000)) { ui.toast("Bitte den Kilometerstand eingeben."); return false; }
        const inf = infoOf(v.id);
        const note = $("#fzg-on").value.trim();
        await saveInfo(v.id, { odo: [...inf.odo, { date, km: Math.round(k), ...(note ? { note } : {}) }].slice(-200) }, km && k < km ? `Gespeichert – Hinweis: kleiner als der bisher höchste Stand (${F.fmtKm(km)}) 🤔` : `🛣️ ${F.fmtKm(k)} gespeichert`);
      });
  }

  function openInsurance(v) {
    const inf = infoOf(v.id);
    sheetForm("🛡️ Versicherung",
      `<label>Gesellschaft<input id="fzg-ic" maxlength="60" value="${esc(inf.insurance.company)}"></label>` +
      `<div class="row"><label>Polizzennummer<input id="fzg-ip" maxlength="40" value="${esc(inf.insurance.policy)}"></label>` +
      `<label>Läuft bis<input id="fzg-iu" type="date" value="${esc(inf.insurance.until || "")}"></label></div>` +
      `<p class="note">Bitte keine Passwörter oder Zugangsdaten hier – die gehören in den Tresor. 🔐</p>`,
      async ($) => {
        await saveInfo(v.id, { insurance: { company: $("#fzg-ic").value.trim(), policy: $("#fzg-ip").value.trim(), until: $("#fzg-iu").value || null } }, "🛡️ Versicherung gespeichert");
      });
  }

  /* ---------- Ereignisse ---------- */

  root.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-f]");
    if (!b) return;
    const a = b.dataset.f;
    const v = S.id ? vehicles().find((x) => x.id === S.id) : null;
    if (a === "new") { openBasics(); return; }
    if (a === "open") { location.hash = F.vehicleHash(b.dataset.id).slice(1); return; }
    if (a === "back") { location.hash = "alltag/fahrzeuge"; return; }
    if (a === "tankbuch") { try { localStorage.setItem("sk-uw-tab", "tanken"); } catch { /* egal */ } return; } // Link folgt
    if (!v) return;
    if (a === "edit") openBasics(v);
    else if (a === "pickerl") openPickerl(v);
    else if (a === "pkdone") pickerlDone(v);
    else if (a === "service") openService(v);
    else if (a === "odo") openOdo(v);
    else if (a === "ins") openInsurance(v);
    else if (a === "newfill") fuel.openNew({ vehicleId: v.id });
    else if (a === "fill") { const f = fuelCol.get(b.dataset.id); if (f) fuel.openEdit(f); }
  });

  const onHash = () => {
    const id = F.routeId(location.hash);
    if (id === null) return;
    const next = id || null;
    if (next !== S.id) { S.id = next; render(); window.scrollTo(0, 0); }
  };
  window.addEventListener("hashchange", onHash);
  const offs = [info.watch(queue), fuelCol.watch(queue)];
  let unsub = null;
  try { unsub = store.subscribe(queue); } catch { /* egal */ }
  render();

  return () => {
    alive = false;
    window.removeEventListener("hashchange", onHash);
    for (const o of offs) { try { o(); } catch { /* egal */ } }
    if (typeof unsub === "function") try { unsub(); } catch { /* egal */ }
  };
}
