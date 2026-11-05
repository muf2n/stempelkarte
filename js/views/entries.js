// Reiter „Einträge“: Monatsliste aller Einträge nach Tagen gruppiert, plus Formular zum Nachtragen/Bearbeiten.

import { icon } from "../icons.js";
import { leaves, sparkles, emptyClipboard } from "../deco.js";
import { segmentKm, isDriving, fmtKm, fmtEur, entryKm, allowanceByDay, LEVEL_LABELS } from "../travel.js"; // Update 9
import { openAllowanceDay } from "./trips.js"; // Update 9

const SEL_KEY = "stempelkarte.selPlace";

let root = null;
let C = null;          // ctx
let lastSnap = null;
let curY = 0, curM = 0; // angezeigter Monat (m: 0–11)
let selKey = null;     // im Kalender gewählter Tag ("YYYY-MM-DD") oder null

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function mount(el, ctx) {
  root = el;
  C = ctx;
  const now = new Date();
  curY = now.getFullYear();
  curM = now.getMonth();

  el.innerHTML = `
    <div class="stack ek-wrap">
      <div class="section-h ek-head">
        <h2>Einträge</h2>
        <button type="button" class="btn primary sm" data-act="add">+ Nachtragen</button>
      </div>
      <div class="ek-calcard">
        <span class="ek-deco" aria-hidden="true">${leaves("left")}${leaves("right")}</span>
        <div class="nav ek-nav">
          <button type="button" class="btn ghost sm" data-act="prev" aria-label="Vorheriger Monat">${icon("chevron-left", 18)}</button>
          <b data-ref="label"></b>
          <button type="button" class="btn ghost sm" data-act="next" aria-label="Nächster Monat">${icon("chevron-right", 18)}</button>
          <button type="button" class="btn ghost sm ek-today" data-act="today">${icon("calendar", 18)}<span>Heute</span></button>
        </div>
        <div class="cal" data-ref="cal"></div>
      </div>
      <div class="ek-uphol" data-ref="uphol" hidden></div>
      <p class="note" data-ref="sum"></p>
      <div class="stack" data-ref="list"></div>
    </div>`;

  el.addEventListener("click", (ev) => {
    const dayBtn = ev.target.closest("button.cal-day[data-day], button.cal-day-link[data-day]");
    if (dayBtn && el.contains(dayBtn)) {
      const k = dayBtn.dataset.day;
      if (selKey === k) {
        selKey = null;
      } else {
        selKey = k;
        const d = parseDate(k);
        if (d && (d.y !== curY || d.mo !== curM)) { curY = d.y; curM = d.mo; }
      }
      render();
      return;
    }
    const tgBtn = ev.target.closest("[data-tgday]"); // Update 9: Taggeld des Tages festlegen
    if (tgBtn && el.contains(tgBtn)) { openAllowanceDay(tgBtn.dataset.tgday, C); return; }
    const actEl = ev.target.closest("[data-act]");
    if (actEl && el.contains(actEl)) {
      const act = actEl.dataset.act;
      if (act === "add") { openEntryForm(null, C, selKey ? { date: selKey } : null); return; }
      if (act === "prev") { shiftMonth(-1); return; }
      if (act === "next") { shiftMonth(1); return; }
      if (act === "all-days") { selKey = null; render(); return; }
      if (act === "sch-hint-x") { lsSet(SCH_HINT_KEY, "1"); actEl.closest(".ek-schhint")?.remove(); return; }
      if (act === "today") {
        const n = new Date();
        curY = n.getFullYear(); curM = n.getMonth(); selKey = null;
        render();
        return;
      }
    }
    const row = ev.target.closest("button.entry[data-id]");
    if (row && el.contains(row)) {
      const snap = lastSnap || C.store.get();
      const entry = (snap?.entries || []).find((e) => e.id === row.dataset.id);
      if (entry) C.openEntryForm(entry);
    }
  });

  // aufgeklappte Schulwochen merken (toggle blubbert nicht → capture)
  el.addEventListener("toggle", (ev) => {
    const d = ev.target;
    if (!d || !d.matches || !d.matches("details.ek-schweek")) return;
    if (d.open) openWeeks.add(d.dataset.wk); else openWeeks.delete(d.dataset.wk);
  }, true);

  update(C.store.get());
}

function shiftMonth(delta) {
  const d = new Date(curY, curM + delta, 1);
  curY = d.getFullYear();
  curM = d.getMonth();
  selKey = null;
  render();
}

export function update(snap) {
  lastSnap = snap;
  render();
}

export function tick() {}

export function onShow() {
  render();
}

// ---------- Personen „Mit wem“ (Update 8; auch für today.js) ----------

/** Personen-Liste säubern (Text, ohne Leere/Doppelte). */
export function cleanPeople(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const v = String(x == null ? "" : x).trim().replace(/\s+/g, " ");
    if (v && !out.some((y) => y.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/** „mit Max, Anna“ bzw. "". */
export function peopleText(list) {
  const p = cleanPeople(list);
  return p.length ? `mit ${p.join(", ")}` : "";
}

/** Neue Namen alphabetisch in settings.people übernehmen (nie werfen). */
export async function rememberPeople(store, list) {
  try {
    const s = (store.get() && store.get().settings) || {};
    const known = cleanPeople(s.people);
    const add = cleanPeople(list).filter((n) => !known.some((k) => k.toLowerCase() === n.toLowerCase()));
    if (!add.length) return;
    const next = [...known, ...add].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
    await store.saveSettings({ people: next });
  } catch { /* Toast kommt vom Store */ }
}

/** Personen-Chips (Mehrfachauswahl) + „+ Person“ in host zeichnen.
 *  Gibt { get(), set(list) } zurück; onChange(list) bei jeder Änderung. */
export function peoplePicker(host, ctx, { selected = [], onChange = null } = {}) {
  const { util, store } = ctx;
  const esc = util.esc;
  let sel = cleanPeople(selected);
  let adding = false;
  const all = () => {
    const known = cleanPeople(((store.get() || {}).settings || {}).people);
    for (const n of sel) if (!known.some((k) => k.toLowerCase() === n.toLowerCase())) known.push(n);
    return known.sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
  };
  const isSel = (n) => sel.some((x) => x.toLowerCase() === n.toLowerCase());
  const draw = () => {
    host.classList.add("chips", "ppl-chips");
    host.innerHTML = all().map((n) =>
      `<button type="button" class="chip ppl-chip" data-ppl="${esc(n)}" aria-pressed="${isSel(n)}">${esc(n)}</button>`).join("") +
      (adding
        ? `<span class="ppl-add"><input type="text" maxlength="40" placeholder="Name" autocomplete="off" aria-label="Name der Person">` +
          `<button type="button" class="btn sm primary" data-ppl-ok>Dazu</button></span>`
        : `<button type="button" class="chip add" data-ppl-add>${icon("plus", 18)}<span>Person</span></button>`);
    if (adding) {
      const inp = host.querySelector(".ppl-add input");
      try { inp.focus(); } catch { /* egal */ }
      inp.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(); }
        else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); adding = false; draw(); }
      });
    }
  };
  const changed = () => { if (onChange) { try { onChange(sel.slice()); } catch (e) { console.error(e); } } };
  const commit = () => {
    const inp = host.querySelector(".ppl-add input");
    const name = cleanPeople([inp ? inp.value : ""])[0];
    adding = false;
    if (name) {
      if (!isSel(name)) sel.push(name);
      rememberPeople(store, [name]);
      changed();
    }
    draw();
  };
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !host.contains(b)) return;
    if (b.hasAttribute("data-ppl-add")) { adding = true; draw(); return; }
    if (b.hasAttribute("data-ppl-ok")) { commit(); return; }
    const n = b.dataset.ppl;
    if (n == null) return;
    sel = isSel(n) ? sel.filter((x) => x.toLowerCase() !== n.toLowerCase()) : [...sel, n];
    b.setAttribute("aria-pressed", String(isSel(n)));
    changed();
  });
  draw();
  return {
    get: () => {
      // halb eingetippten Namen nicht verlieren
      const inp = adding ? host.querySelector(".ppl-add input") : null;
      const extra = inp ? cleanPeople([inp.value])[0] : null;
      return extra && !isSel(extra) ? [...sel, extra] : sel.slice();
    },
    set: (list) => { sel = cleanPeople(list); if (!adding) draw(); },
    redraw: () => { if (!adding) draw(); },
  };
}

// ---------- Tätigkeitsfarben ----------

export function actSlug(name) {
  return String(name || "Arbeiten").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function actHue(name) {
  const s = String(name || "Arbeiten");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
function actAttrs(name, esc) {
  return `data-act="${esc(actSlug(name))}" style="--act-hue:${actHue(name)}"`;
}

// ---------- Kalender ----------

const CAL_KINDS = ["urlaub", "krank", "feiertag", "zeitausgleich", "schule"];

// Update 6: automatischer Schultag (Berufsschule/Block) oder null
function schoolOf(util, ts, settings) {
  if (!util.schoolLabel) return null;
  try { return util.schoolLabel(ts, settings); } catch { return null; }
}
function hasSchool(util, settings) {
  return !!(util.readSchool && util.readSchool(settings));
}

function calendarHTML(snap, util, holidaysOn) {
  const { esc, hm, dayKey, startOfWeek } = util;
  const creditMin = util.creditMin || util.netMin;
  const kindLabel = util.kindLabel || ((k) => k);
  const holidayName = util.holidayName || (() => null);
  const holidayShort = util.holidayShort || ((n) => n);

  const first = startOfWeek(new Date(curY, curM, 1));
  const lastOfMonth = new Date(curY, curM + 1, 0);
  const weeks = Math.ceil((Math.round((lastOfMonth - first) / 86400000) + 1) / 7);
  const from = first.getTime();
  const to = new Date(first.getFullYear(), first.getMonth(), first.getDate() + weeks * 7).getTime();

  // Tage im sichtbaren Bereich: Minuten + Arten
  const days = new Map();
  for (const e of snap.entries || []) {
    if (!(e.start >= from && e.start < to)) continue;
    const k = dayKey(e.start);
    let d = days.get(k);
    if (!d) days.set(k, (d = { min: 0, kinds: new Set() }));
    d.min += creditMin(e);
    d.kinds.add(isWork(e) ? "work" : e.kind);
  }
  const todayKey = dayKey(Date.now());

  const head = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
    .map((w, i) => `<span class="${i >= 5 ? "we" : ""}">${w}</span>`).join("") +
    `<span class="cal-week" aria-hidden="true">Σ</span>`;

  let grid = "";
  for (let w = 0; w < weeks; w++) {
    let weekMin = 0;
    for (let i = 0; i < 7; i++) {
      const dt = new Date(first.getFullYear(), first.getMonth(), first.getDate() + w * 7 + i);
      const k = dayKey(dt);
      const info = days.get(k);
      const hol = holidaysOn ? holidayName(dt.getTime()) : null;
      const sch = hol ? null : schoolOf(util, dt.getTime(), snap.settings);
      const cls = ["cal-day"];
      if (dt.getMonth() !== curM) cls.push("out");
      if (i >= 5) cls.push("we");
      if (k === todayKey) cls.push("today");
      if (k === selKey) cls.push("sel");
      const labels = [];
      if (info) {
        weekMin += info.min;
        if (info.kinds.has("work")) { cls.push("k-work"); labels.push(kindLabel("work")); }
        for (const kd of CAL_KINDS) if (info.kinds.has(kd)) { cls.push(`k-${kd}`); labels.push(kindLabel(kd)); }
      }
      if (hol && !cls.includes("k-feiertag")) cls.push("k-feiertag");
      if (hol) cls.push("hol");
      if (sch) { if (!cls.includes("k-schule")) cls.push("k-schule"); cls.push("schul"); }
      const aria = [util.fmtDate(dt.getTime())];
      if (hol) aria.push(hol);
      if (sch) aria.push(`${sch} – zählt als Arbeitszeit`);
      if (labels.length) aria.push(labels.join(", "));
      if (info && info.min > 0) aria.push(`${hm(info.min)} h`);
      grid += `<button type="button" class="${cls.join(" ")}" data-day="${k}"` +
        `${hol ? ` title="${esc(hol)}"` : sch ? ` title="${esc(sch)}"` : ""} aria-label="${esc(aria.join(" · "))}" aria-pressed="${k === selKey}">` +
        `<span class="cal-num">${dt.getDate()}</span>` +
        `${hol ? `<span class="cal-hn" aria-hidden="true">${esc(holidayShort(hol))}</span>` : ""}` +
        `${sch ? `<span class="cal-sn" aria-hidden="true">${esc(sch === "Berufsschule" ? "Schule" : sch)}</span>` : ""}` +
        `<span class="cal-h">${info && info.min > 0 ? esc(hm(info.min)) : ""}</span>` +
        `${hol || (info && info.kinds.has("feiertag")) ? `<span class="cal-dot" aria-hidden="true"></span>` : ""}` +
        `${dotsHTML(info)}` +
        `</button>`;
    }
    grid += `<span class="cal-week" title="Wochensumme">${weekMin > 0 ? esc(hm(weekMin)) : ""}</span>`;
  }

  const schoolOn = hasSchool(util, snap.settings);
  const legend = ["work", ...CAL_KINDS]
    .map((k) => `<span class="k-${k}">${esc(k === "feiertag" && holidaysOn ? "Feiertag (automatisch)"
      : k === "schule" && schoolOn ? "Schule (automatisch)" : kindLabel(k))}</span>`).join("");

  return `<div class="cal-head" aria-hidden="true">${head}</div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend">${legend}</div>`;
}

// Tagesarten als farbige Punkte (Feiertag steckt in .cal-dot oben rechts)
function dotsHTML(info) {
  if (!info) return "";
  const ks = ["work", "urlaub", "krank", "zeitausgleich", "schule"].filter((k) => info.kinds.has(k));
  return ks.length ? `<span class="cal-dots" aria-hidden="true">${ks.map((k) => `<i class="d-${k}"></i>`).join("")}</span>` : "";
}

// ---------- Liste ----------

function render() {
  if (!root || !C) return;
  const { util, geo } = C;
  const { esc, hm, clock, dayKey, fmtDate, netMin, MONTHS } = util;
  const creditMin = util.creditMin || netMin;
  const kindLabel = util.kindLabel || (() => "Arbeit");
  const holidayName = util.holidayName || (() => null);

  root.querySelector('[data-ref="label"]').textContent = `${MONTHS[curM]} ${curY}`;
  const calEl = root.querySelector('[data-ref="cal"]');
  const listEl = root.querySelector('[data-ref="list"]');
  const sumEl = root.querySelector('[data-ref="sum"]');

  const snap = lastSnap;
  if (!snap || snap.ready === false) {
    sumEl.textContent = "";
    calEl.innerHTML = "";
    listEl.innerHTML = `<div class="empty"><h3>Lade Einträge …</h3></div>`;
    return;
  }
  const holidaysOn = (snap.settings || {}).holidays !== false;
  calEl.innerHTML = calendarHTML(snap, util, holidaysOn);
  renderUpcoming(util, holidaysOn);

  const from = new Date(curY, curM, 1).getTime();
  const to = new Date(curY, curM + 1, 1).getTime();
  const monthList = (snap.entries || []).filter((e) => e.start >= from && e.start < to);
  const list = selKey ? monthList.filter((e) => dayKey(e.start) === selKey) : monthList;
  // Update 9: Taggeld je Tag des Monats
  let tgMap = new Map();
  try { tgMap = allowanceByDay({ entries: monthList, places: snap.places, days: snap.days, settings: snap.settings, dayKey }, from, to); } catch { tgMap = new Map(); }

  // gesetzliche Feiertage des Monats (bzw. des gewählten Tags): dayKey → Name
  const monthHols = new Map();
  if (holidaysOn) {
    const last = new Date(curY, curM + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const dt = new Date(curY, curM, d);
      const k = dayKey(dt);
      if (selKey && k !== selKey) continue;
      const n = holidayName(dt.getTime());
      if (n) monthHols.set(k, n);
    }
  }
  // Update 6: automatische Schultage des Monats (bzw. des gewählten Tags): dayKey → Bezeichnung
  const monthSchool = new Map();
  {
    const last = new Date(curY, curM + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const dt = new Date(curY, curM, d);
      const k = dayKey(dt);
      if (selKey && k !== selKey) continue;
      if (monthHols.has(k)) continue;
      const n = schoolOf(util, dt.getTime(), snap.settings);
      if (n) monthSchool.set(k, n);
    }
  }
  const keyTs = (k) => { const d = parseDate(k); return new Date(d.y, d.mo, d.d).getTime(); };
  const SD = schoolDayKit(util, snap.settings, keyTs, creditMin);
  const holRow = (name) => `
        <div class="entry ek-holrow" role="note">
          <span class="t"><span class="ek-holico" aria-hidden="true">${icon("calendar", 18)}</span>${esc(name)}</span>
          <span class="d">frei</span>
          <span class="p">${selKey
            ? "Gesetzlicher Feiertag – arbeitsfrei, zählt nicht als Fehlstunden"
            : "Gesetzlicher Feiertag · arbeitsfrei · automatisch eingetragen"}</span>
        </div>`;
  const holDayHTML = (k, name) => {
    const d = parseDate(k);
    const ts = new Date(d.y, d.mo, d.d).getTime();
    return `
      <div class="day ek-holday">
        <div class="day-h"><span>${esc(fmtDate(ts))} <span class="ek-hol">${esc(name)}</span></span></div>
        ${holRow(name)}
      </div>`;
  };

  const resetBtn = `<div class="row"><button type="button" class="btn ghost sm" data-act="all-days">Alle Tage zeigen</button></div>`;

  if (!list.length) {
    sumEl.textContent = "";
    if (selKey && monthHols.has(selKey)) {
      listEl.innerHTML = holDayHTML(selKey, monthHols.get(selKey)) +
        `<p class="note ek-holnote">${esc(monthHols.get(selKey))} – arbeitsfrei, zählt nicht als Fehlstunden. Du musst nichts eintragen.</p>${resetBtn}`;
    } else if (selKey && monthSchool.has(selKey)) {
      sumEl.textContent = "";
      listEl.innerHTML = SD.dayHTML(selKey, monthSchool.get(selKey), [], "", true) +
        `<p class="note ek-holnote">${SD.creditOf(selKey) > 0 ? "Berufsschule zählt als Arbeitszeit, das Tagessoll ist damit erfüllt. Du musst nichts eintragen."
          : "Berufsschule an einem Tag ohne Soll – es wird nichts gutgeschrieben. Du musst nichts eintragen."}</p>${resetBtn}`;
      return;
    } else if (selKey) {
      const d = parseDate(selKey);
      const ts = d ? new Date(d.y, d.mo, d.d).getTime() : Date.now();
      const hol = holidaysOn ? holidayName(ts) : null;
      listEl.innerHTML = `<div class="empty"><h3>Keine Einträge am ${esc(fmtDate(ts))}</h3>
        ${hol ? `<p class="note">Feiertag: ${esc(hol)}</p>` : ""}
        <p class="note">Tippe auf „+ Nachtragen“, um für diesen Tag etwas einzutragen.</p></div>${resetBtn}`;
    } else {
      const holsHTML = SD.assemble([...new Set([...monthHols.keys(), ...monthSchool.keys()])].sort().reverse()
        .map((k) => (monthHols.has(k) ? { k, html: holDayHTML(k, monthHols.get(k)) } : SD.day(k, monthSchool.get(k), [], ""))), false);
      const sp = [];
      if (monthHols.size) sp.push(`${monthHols.size} ${monthHols.size === 1 ? "Feiertag" : "Feiertage"}`);
      if (monthSchool.size) sp.push(`${monthSchool.size} ${monthSchool.size === 1 ? "Schultag" : "Schultage"}`);
      if (sp.length) sumEl.textContent = `${sp.join(" · ")} · automatisch eingetragen`;
      listEl.innerHTML = holsHTML + `<div class="empty ek-empty">
        <span class="ek-empty-deco" aria-hidden="true">${leaves("left")}${sparkles()}</span>
        <div class="ek-empty-ill">${emptyClipboard()}</div>
        <div class="ek-empty-txt">
          <h3>Keine Einträge in diesem Monat</h3>
          <p class="note">Tippe auf „Nachtragen“, um Arbeitszeit, Urlaub oder Krankenstand einzutragen.</p>
          <button type="button" class="btn primary" data-act="add">${icon("plus", 18)}<span>Eintrag nachtragen</span></button>
        </div></div>`;
    }
    return;
  }

  // nach Tagen gruppieren
  const groups = new Map();
  for (const e of list) {
    const k = dayKey(e.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const k of monthHols.keys()) if (!groups.has(k)) groups.set(k, []);
  for (const k of monthSchool.keys()) if (!groups.has(k)) groups.set(k, []);
  const keys = [...groups.keys()].sort().reverse();

  let total = 0;
  let planned = 0;
  let workDays = 0;
  const absCount = new Map();
  const dayObjs = keys.map((k) => {
    const items = groups.get(k).sort((a, b) => a.start - b.start);
    const sch = monthSchool.get(k) || null;
    if (!items.length && !sch) return { k, html: holDayHTML(k, monthHols.get(k)) };
    const merged = sch ? SD.mergeable(items) : null; // manueller „Schule“-Eintrag → in die Schulkarte
    const rowItems = merged ? items.filter((e) => e !== merged) : items;
    const daySum = items.reduce((s, e) => s + creditMin(e), 0) + (sch ? SD.creditOf(k) : 0);
    const planSch = sch && k > dayKey(Date.now()) ? SD.creditOf(k) : 0; // geplante Schulzeit nicht in „Gesamt“
    total += daySum - planSch;
    planned += planSch;
    if (items.some((e) => isWork(e) && netMin(e) > 0)) workDays++;
    const rows = rowItems.map((e) => {
      if (!isWork(e)) {
        absCount.set(e.kind, (absCount.get(e.kind) || 0) + 1);
        const p = [`<span class="tag ek-tag ek-${esc(e.kind)}">${esc(kindLabel(e.kind))}</span>`];
        if (e.note) p.push(esc(e.note));
        return `
        <button type="button" class="entry ek-abs" data-id="${esc(e.id)}">
          <span class="t">${esc(kindLabel(e.kind))}</span>
          <span class="d">${esc(hm(creditMin(e)))} h</span>
          <span class="p">${p.join(" · ")}</span>
        </button>`;
      }
      if (util.isPrivateTrip && util.isPrivateTrip(e)) return privTripRow(e, util, snap.settings); // Update 9 – Privatfahrt
      const p = [];
      const pl = placeText(e);
      if (pl) p.push(`<span class="tag">${esc(pl)}</span>`);
      if (e.pauseMin > 0) p.push(`Pause ${esc(e.pauseMin)} Min.`);
      if (e.note) p.push(esc(e.note));
      { const pt = peopleText(e.people); if (pt) p.push(`<span class="ppl-line">${esc(pt)}</span>`); }
      const multi = dayKey(e.end) !== dayKey(e.start) ? " (+1 Tag)" : "";
      const links = [];
      if (e.inLoc && e.inLoc.lat != null) {
        links.push(`<a href="${esc(geo.mapsUrl(e.inLoc.lat, e.inLoc.lng))}" target="_blank" rel="noopener"${e.inLoc.addr ? ` title="${esc(e.inLoc.addr)}"` : ""}>Start-Standort</a>`);
      }
      if (e.outLoc && e.outLoc.lat != null) {
        links.push(`<a href="${esc(geo.mapsUrl(e.outLoc.lat, e.outLoc.lng))}" target="_blank" rel="noopener"${e.outLoc.addr ? ` title="${esc(e.outLoc.addr)}"` : ""}>End-Standort</a>`);
      }
      return `
        <button type="button" class="entry" data-id="${esc(e.id)}">
          <span class="t">${esc(clock(e.start))} – ${esc(clock(e.end))}${multi}</span>
          <span class="d">${esc(hm(netMin(e)))} h</span>
          <span class="p">${p.join(" · ")}</span>
        </button>
        ${segmentsHTML(e, util, geo)}
        ${links.length ? `<div class="links">${links.join(" · ")}</div>` : ""}`;
    }).join("");
    if (sch) return SD.day(k, sch, items, rows, dayExtraHTML(k, items, tgMap, snap.settings, esc), !!selKey);
    const hol = holidaysOn ? holidayName(items[0].start) : null;
    return { k, html: `
      <div class="day${hol ? " ek-holday" : ""}">
        <div class="day-h"><span>${esc(fmtDate(items[0].start))}${hol ? ` <span class="ek-hol">${esc(hol)}</span>` : ""}</span><span class="sum">${esc(hm(daySum))} h</span></div>
        ${dayExtraHTML(k, items, tgMap, snap.settings, esc)}
        ${hol ? holRow(hol) : ""}
        ${rows}
      </div>` };
  });
  const html = SD.assemble(dayObjs, !!selKey);

  if (selKey) {
    sumEl.textContent = "";
    listEl.innerHTML = html + resetBtn;
    return;
  }
  const parts = [`Gesamt ${hm(total)} h${planned > 0 ? ` (+${hm(planned)} h Schule geplant)` : ""}`, `${workDays} ${workDays === 1 ? "Arbeitstag" : "Arbeitstage"}`];
  for (const kind of ["urlaub", "krank", "feiertag", "zeitausgleich", "schule"]) {
    const n = absCount.get(kind);
    if (n) parts.push(`${n}× ${kindLabel(kind)}`);
  }
  if (monthHols.size) parts.push(`${monthHols.size} ${monthHols.size === 1 ? "Feiertag" : "Feiertage"} (automatisch)`);
  if (monthSchool.size) parts.push(`${monthSchool.size} ${monthSchool.size === 1 ? "Schultag" : "Schultage"} (automatisch)`);
  sumEl.textContent = parts.join(" · ");
  listEl.innerHTML = html;
}

// ---------- Berufsschule in der Liste (Update 9, Agent R) ----------
// Eine Karte je Schultag (🎓 + Gutschrift). Ein manueller „Schule“-Eintrag am selben Tag wird in die Karte
// übernommen (Notiz als kleine Zeile, antippbar zum Bearbeiten). Tageskopf = Schul-Gutschrift + Einträge,
// genauso wie im Überstundenkonto (Schultag: Soll 0, eigene Einträge zählen zusätzlich).
// Zukünftige Schultage: gestrichelt „geplant“; reine Schulwochen in der Zukunft als eine aufklappbare Zeile.

const SCH_HINT_KEY = "stempelkarte.hint.schoolNoSoll";
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const openWeeks = new Set(); // aufgeklappte Schulwochen (Wochen-Schlüssel), überlebt Neuzeichnen

function lsSet(key, v) {
  try { localStorage.setItem(key, v); } catch { /* egal */ }
}

// „Berufschule“, „Blockschule“, „Schule“ … = allgemeine Bezeichnung (kein eigener Chip)
function genericSchoolLabel(name) {
  const n = String(name || "").toLowerCase().replace(/[^a-zäöüß]/g, "");
  if (!n) return true;
  if (/^(berufs?schule|blockschule|schule|bs|lbs|berufsschulblock|schulblock)$/.test(n)) return true;
  // Tippfehler-tolerant: Abstand ≤ 2 zu „berufsschule“/„blockschule“
  return ["berufsschule", "blockschule"].some((w) => editDist(n, w) <= 2);
}
function editDist(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function schoolDayKit(util, settings, keyTs, creditMin) {
  const { esc, hm, fmtDate, dayKey, startOfWeek, pad, WD } = util;
  const todayKey = dayKey(Date.now());
  let hintDone = lsGet(SCH_HINT_KEY) === "1";
  const creditOf = (k) => (util.schoolCreditMin ? util.schoolCreditMin(keyTs(k), settings) : 0);
  const short = (k) => { const d = new Date(keyTs(k)); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
  // Titel: eigene Bezeichnung so, wie eingetragen, wenn sie nur „Berufsschule“ meint; sonst „Berufsschule“ + Chip
  const titleOf = (name) => (genericSchoolLabel(name) ? String(name || "").trim() || "Berufsschule" : "Berufsschule");
  const chipOf = (name) => (genericSchoolLabel(name) ? "" : `<span class="ek-schchip">${esc(name)}</span>`);
  const cap = (name) => `<span class="ek-schico" aria-hidden="true">🎓</span><span class="ek-schname">${esc(titleOf(name))}</span>${chipOf(name)}`;

  const PLAN = `<span class="ek-plan">geplant</span>`;
  const mergeable = (items) => items.find((e) => e && e.kind === "schule") || null;

  const card = (k, name, manual) => {
    const cm = creditOf(k);
    const extra = manual ? creditMin(manual) : 0;
    const future = k > todayKey;
    const sub = [];
    if (cm <= 0) sub.push(`<span>kein Arbeitstag – keine Gutschrift</span>`);
    if (manual && manual.note) sub.push(`<span class="ek-schnote">${icon("pencil", 14)}${esc(manual.note)}</span>`);
    if (extra > 0) sub.push(`<span class="ek-schextra">+${esc(hm(extra))} h eigener Eintrag</span>`);
    const tot = cm + extra;
    const cls = `entry ek-schcard${future ? " plan" : ""}${tot <= 0 ? " zero" : ""}`;
    const inner = `
          <span class="t">${cap(name)}${future ? PLAN : ""}</span>
          <span class="d">${tot > 0 ? `${esc(hm(tot))} h` : "–"}</span>
          ${sub.length ? `<span class="p">${sub.join("")}</span>` : ""}`;
    return manual
      ? `<button type="button" class="${cls}" data-id="${esc(manual.id)}" data-day="${esc(k)}" aria-label="${esc(`${titleOf(name)} ${fmtDate(keyTs(k))} – eigenen Schuleintrag bearbeiten`)}">${inner}</button>`
      : `<div class="${cls}" data-day="${esc(k)}" role="note">${inner}</div>`;
  };

  const hintHTML = (k) => {
    const wd = WD_LONG[new Date(keyTs(k)).getDay()];
    return `<div class="ek-schhint" role="note"><span>💡</span><p><b>${esc(wd)} ist bei dir kein Arbeitstag</b> – Schulzeit wird nicht gutgeschrieben (Einstellungen → Arbeitstage).</p>` +
      `<button type="button" class="ek-schhint-x" data-act="sch-hint-x" aria-label="Hinweis ausblenden">✕</button></div>`;
  };

  /** Tag mit Schule → {k, html, school, onlySchool, future, total, zero, name}. */
  const day = (k, name, items, rowsHTML, extraHTML = "", sel = false) => {
    const manual = mergeable(items);
    const cm = creditOf(k);
    const total = cm + items.reduce((s, e) => s + creditMin(e), 0);
    const future = k > todayKey;
    const onlySchool = items.every((e) => e === manual);
    const pill = total > 0
      ? `<span class="sum${future ? " plan" : ""}">${esc(hm(total))} h</span>`
      : `<span class="sum ek-schpill">Schule</span>`;
    const html = `
      <div class="day ek-schoolday${future ? " plan" : ""}" data-sday="${esc(k)}">
        <div class="day-h"><span>${esc(fmtDate(keyTs(k)))}</span>${pill}</div>
        ${extraHTML || ""}
        ${card(k, name, manual)}
        ${rowsHTML || ""}
      </div>`;
    return { k, html, school: true, onlySchool, future, total, zero: cm <= 0, name, sel };
  };

  /** Tage (absteigend) zusammensetzen: Hinweis einmal, reine Zukunfts-Schulwochen einklappen. */
  const assemble = (days, sel) => {
    const wk = (k) => dayKey(startOfWeek(keyTs(k)));
    const out = [];
    const hint = (grp) => {
      if (hintDone) return "";
      const z = grp.find((d) => d.school && d.zero);
      if (!z) return "";
      hintDone = true;
      return hintHTML(z.k);
    };
    for (let i = 0; i < days.length;) {
      const d = days[i];
      if (!sel && d.school && d.onlySchool && d.future) {
        let j = i + 1;
        while (j < days.length && days[j].school && days[j].onlySchool && days[j].future && wk(days[j].k) === wk(d.k)) j++;
        if (j - i >= 2) {
          const grp = days.slice(i, j);
          const w = wk(d.k);
          const sum = grp.reduce((s, x) => s + Math.round(x.total), 0); // wie die einzelnen Tagesköpfe gerundet
          const first = grp[grp.length - 1].k, last = grp[0].k;
          const n = grp.length;
          out.push(hint(grp) + `
      <details class="ek-schweek"${openWeeks.has(w) ? " open" : ""} data-wk="${esc(w)}">
        <summary class="entry ek-schcard plan">
          <span class="t">${cap(d.name)}${PLAN}</span>
          <span class="d">${sum > 0 ? `${esc(hm(sum))} h` : "–"}</span>
          <span class="p"><span class="ek-schrange">${esc(short(first))}–${esc(short(last))}</span><span>· ${n} Tage</span><span class="ek-schmore" aria-hidden="true">${icon("chevron-right", 16)}</span></span>
        </summary>
        <div class="ek-schweek-days">${grp.map((x) => x.html).join("")}</div>
      </details>`);
          i = j;
          continue;
        }
      }
      out.push(hint([d]) + d.html);
      i++;
    }
    return out.join("");
  };

  return { creditOf, mergeable, day, assemble, dayHTML: (k, name, items, rows, s) => day(k, name, items, rows, "", s).html };
}

// Karte „Kommende Feiertage“ unter dem Kalender (nächste 3 ab heute)
function renderUpcoming(util, holidaysOn) {
  const el = root.querySelector('[data-ref="uphol"]');
  if (!el) return;
  if (!holidaysOn || !util.upcomingHolidays) { el.hidden = true; el.innerHTML = ""; return; }
  const { esc, WD, pad, dayKey } = util;
  let next = [];
  try { next = util.upcomingHolidays(Date.now(), 3); } catch { next = []; }
  if (!next.length) { el.hidden = true; return; }
  const today = dayKey(Date.now());
  el.innerHTML = `<div class="ek-uphol-h">${icon("calendar", 18)}<span>Kommende Feiertage</span><small>automatisch eingetragen</small></div>
    <ul>${next.map((h) => {
      const d = new Date(h.ts);
      const k = dayKey(h.ts);
      return `<li><button type="button" class="cal-day-link" data-day="${esc(k)}">` +
        `<span class="ek-uphol-d">${esc(WD[d.getDay()])}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span>` +
        `<span class="ek-uphol-n">${esc(h.name)}</span>` +
        `${k === today ? `<span class="ek-uphol-t">heute</span>` : ""}</button></li>`;
    }).join("")}</ul>`;
  el.hidden = false;
}

// Ortsname eines Eintrags/Abschnitts: gespeicherter Name, sonst Adresse des Start-Standorts
// Update 9 – Privat: Privatfahrt gedämpft mit 🏠-Chip, 0 h (zählt nicht in die Tagessumme)
export function privTripRow(e, util, settings) {
  const { esc, clock } = util;
  const sg = (Array.isArray(e.segments) && e.segments[0]) || {};
  const from = sg.place || (sg.loc && sg.loc.addr) || "";
  const to = sg.endPlace || (sg.endLoc && sg.endLoc.addr) || e.place || "";
  const k = segmentKm({ ...sg, end: Number.isFinite(sg.end) ? sg.end : e.end }, settings || {});
  const p = [`<span class="tag pm-chip">🏠 Privat</span>`, "Privatfahrt"];
  if (from || to) p.push(esc(`${from || "?"} → ${to || "?"}`));
  if (k) p.push(esc(`${k.est ? "≈ " : ""}${fmtKm(k.km)} km`));
  return `
        <button type="button" class="entry ek-priv" data-id="${esc(e.id)}" title="Privatfahrt – zählt nicht als Arbeitszeit">
          <span class="t">${esc(clock(e.start))} – ${esc(clock(e.end))}</span>
          <span class="d">privat</span>
          <span class="p">${p.join(" · ")}</span>
        </button>`;
}

function placeText(e) {
  if (!e) return "";
  if (e.place) return e.place;
  const l = e.inLoc || e.loc;
  return (l && l.addr) || "";
}

// Abschnitte eines Eintrags (mit Ende); ohne segments → leer
function segList(e) {
  const segs = Array.isArray(e && e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
  return segs.map((x, i) => ({
    ...x,
    end: Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : e.end),
  }));
}

// nur zeigen, wenn mehr als ein Abschnitt oder Tätigkeit ≠ „Arbeiten“
function showSegments(segs) {
  return segs.length > 1 || (segs.length === 1 && (segs[0].activity || "Arbeiten") !== "Arbeiten");
}

// Ort am Ende eines Abschnitts (gespeicherter Ort oder Adresse)
function endPlaceText(x) {
  if (!x) return "";
  if (x.endPlace) return x.endPlace;
  return (x.endLoc && x.endLoc.addr) || "";
}

function segmentsHTML(e, util, geo) {
  const segs = segList(e);
  if (!showSegments(segs)) return "";
  const { esc, clock, hm } = util;
  const g = geo || (C && C.geo);
  const fmtDist = util.fmtDist || ((m) => `${Math.round(m / 1000)} km`);
  return `<ul class="ek-segs">${segs.map((x) => {
    const act = x.activity || "Arbeiten";
    const parts = [esc(`${clock(x.start)}–${clock(x.end)}`), esc(act)];
    const pl = placeText(x);
    const ep = endPlaceText(x);
    const driving = actSlug(act) === "autofahren";
    const sk = driving ? segmentKm(x, C && C.store ? C.store.get().settings : null) : null; // Update 9
    if ((x.endLoc || ep) && ep && (driving || ep !== pl)) {
      parts.push(`von ${esc(pl || "?")} → nach ${esc(ep)}`);
      const a = x.loc, b = x.endLoc;
      if (!sk && g && g.distanceM && a && b && a.lat != null && b.lat != null) {
        parts.push(`ca. ${esc(fmtDist(g.distanceM(a, b)))} <small>Luftlinie</small>`);
      }
    } else if (pl) {
      parts.push(esc(pl));
    }
    if (sk) parts.push(`<b class="tg-km">${sk.est ? "≈ " : ""}${esc(fmtKm(sk.km))} km</b>${sk.manual ? " <small>manuell</small>" : sk.road ? " <small>Straße</small>" : ""}`); // Update 9: Straßen-km
    parts.push(esc(`${hm(Math.max(0, (x.end - x.start) / 60000))} h`));
    return `<li ${actAttrs(act, esc)}>${parts.join(" · ")}</li>`;
  }).join("")}</ul>`;
}

function isWork(e) {
  return !e || !e.kind || e.kind === "work";
}

// Update 9: Zeile unter dem Tageskopf: Fahrt-km und Taggeld (antippbar)
function dayExtraHTML(k, items, tgMap, settings, esc) {
  const work = items.filter((e) => isWork(e));
  if (!work.length) return "";
  const km = work.reduce((s, e) => s + entryKm(e, settings), 0);
  const tg = tgMap && tgMap.get(k);
  if (km <= 0 && !tg) return "";
  const bits = [];
  if (km > 0) bits.push(`<span class="tg-dkm">${icon("car", 16)}≈ ${esc(fmtKm(km))} km</span>`);
  if (tg) {
    const amt = tg.level === "none" ? "" : (tg.amount == null ? "" : ` · ${fmtEur(tg.amount)}`);
    bits.push(`<button type="button" class="tg-dbtn lvl-${esc(tg.level)}" data-tgday="${esc(k)}" aria-label="Taggeld für diesen Tag ändern">` +
      `Taggeld: ${esc({ none: "keins", part: "teilweise", full: "voll" }[tg.level] || LEVEL_LABELS[tg.level])}${esc(amt)}${tg.manual ? " <small>manuell</small>" : ""}</button>`);
  }
  return `<div class="tg-dayline">${bits.join("")}</div>`;
}

// ---------- Formular ----------

function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || "");
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
}
function parseTime(str) {
  const m = /^(\d{1,2}):(\d{2})/.exec(str || "");
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

// liest die Felder und gibt {start,end,pauseMin} oder {error} zurück
function readTimes(box) {
  const d = parseDate(box.querySelector("#ef-date").value);
  if (!d) return { error: "Bitte ein Datum wählen." };
  const f = parseTime(box.querySelector("#ef-from").value);
  if (!f) return { error: "Bitte eine Uhrzeit für den Beginn eingeben." };
  const t = parseTime(box.querySelector("#ef-to").value);
  if (!t) return { error: "Bitte eine Uhrzeit für das Ende eingeben." };
  const pRaw = String(box.querySelector("#ef-pause").value || "").trim().replace(",", ".");
  const pauseMin = pRaw === "" ? 0 : Math.round(Number(pRaw));
  if (!Number.isFinite(pauseMin) || pauseMin < 0) return { error: "Die Pause muss 0 oder mehr Minuten sein." };

  const start = new Date(d.y, d.mo, d.d, f.h, f.mi).getTime();
  let endD = new Date(d.y, d.mo, d.d, t.h, t.mi);
  const overnight = endD.getTime() < start; // nur Ende < Beginn = über Mitternacht; gleich = 0 Min.
  if (overnight) endD = new Date(d.y, d.mo, d.d + 1, t.h, t.mi); // über Mitternacht
  const end = endD.getTime();
  const durMin = Math.round((end - start) / 60000);
  if (durMin > 0 ? pauseMin >= durMin : pauseMin > 0) {
    return { error: `Die Pause (${pauseMin} Min.) ist länger als die Arbeitszeit (${C ? C.util.hm(durMin) : durMin} h).` };
  }
  return { start, end, pauseMin, overnight };
}

const KINDS = ["work", "urlaub", "krank", "feiertag", "zeitausgleich", "schule"];

// Stunden-Text ("7,5" / "7:30") → Minuten oder null
function parseHours(str) {
  const t = String(str || "").trim();
  if (t === "") return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (hm) return +hm[1] * 60 + Math.min(59, +hm[2]);
  const v = Number(t.replace(",", "."));
  if (!Number.isFinite(v) || v < 0 || v > 24) return null;
  return Math.round(v * 60);
}
function fmtHours(min) {
  const v = Math.round((Number(min) || 0) / 60 * 100) / 100;
  return String(v).replace(".", ",");
}

export function openEntryForm(entry, ctx, prefill = null) {
  const c = ctx || C;
  const { store, ui, util } = c;
  const { esc, hm, clock, dayKey, netMin } = util;
  const snap = store.get() || {};
  const settings = snap.settings || {};
  const places = snap.places || [];
  const isNew = !entry;
  const kindLabel = util.kindLabel || ((k) => k);
  const dailyTarget = (ts) => (util.dailyTargetMin ? util.dailyTargetMin(ts, settings) : 0);
  const holidayName = (ts) => (settings.holidays !== false && util.holidayName ? util.holidayName(ts) : null);
  const schoolName = (ts) => schoolOf(util, ts, settings);
  // Tagessoll ohne Schul-Abzug (Gutschrift für einen zusätzlichen Schultag)
  const baseTarget = (ts) => (util.dailyTargetMin ? util.dailyTargetMin(ts, { ...settings, school: null }) : 0);
  const workDays = Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4, 5];
  const nominalMin = workDays.length ? (Number(settings.weeklyTarget ?? 38.5) || 0) * 60 / workDays.length : 0;

  let kind = isNew
    ? (prefill && KINDS.includes(prefill.kind) ? prefill.kind : "work")
    : (KINDS.includes(entry.kind) ? entry.kind : "work");
  let creditTouched = !isNew && kind !== "work"; // bestehende Gutschrift nicht überschreiben

  let selPlaceId;
  if (isNew) {
    const last = lsGet(SEL_KEY);
    selPlaceId = last && places.some((p) => p.id === last) ? last : "";
  } else {
    selPlaceId = entry.placeId || "";
  }

  // Ort eines bestehenden Eintrags, der nicht mehr existiert, trotzdem anbieten
  const orphan = !isNew && entry.placeId && !places.some((p) => p.id === entry.placeId)
    ? { id: entry.placeId, name: entry.place || "Unbekannter Ort" } : null;
  // kein gespeicherter Ort, aber Name/Adresse vorhanden → als eigene Option anbieten
  const freePlace = !isNew && !entry.placeId ? placeText(entry) : "";

  const opts = [freePlace
    ? `<option value="" selected>${esc(freePlace)}</option><option value="__none">Ohne Ort</option>`
    : `<option value="">Ohne Ort</option>`]
    .concat(places.map((p) => `<option value="${esc(p.id)}"${p.id === selPlaceId ? " selected" : ""}>${esc(p.name)}</option>`))
    .concat(orphan ? [`<option value="${esc(orphan.id)}" selected>${esc(orphan.name)} (gelöscht)</option>`] : [])
    .join("");

  const wasWork = !isNew && kind === "work";
  const vDate = isNew ? (prefill && parseDate(prefill.date) ? prefill.date : dayKey(Date.now())) : dayKey(entry.start);
  const vFrom = wasWork ? clock(entry.start) : "08:00";
  const vTo = wasWork ? clock(entry.end) : "16:30";
  const vPause = wasWork ? (entry.pauseMin || 0) : 30;
  const vNote = isNew ? "" : (entry.note || "");
  const vCredit = !isNew && kind !== "work" ? fmtHours(entry.creditMin ?? 0) : "";

  const chips = KINDS.map((k) =>
    `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === kind}">${esc(kindLabel(k))}</button>`).join("");

  const bodyHTML = `
    <div class="fields">
      <div class="lbl">Art</div>
      <div class="chips ek-kinds" role="group" aria-label="Art des Eintrags">${chips}</div>
      <p class="note ek-sch-hint" hidden>Deine festen Schultage und Schulblöcke (Übersicht → Einstellungen → Berufsschule) sind schon automatisch eingetragen. „Schule“ hier nur für <b>zusätzliche</b> Schultage verwenden – zählt als Arbeitszeit.</p>
      <p class="note ek-fei-hint" hidden>Gesetzliche Feiertage sind schon automatisch eingetragen. „Feiertag“ hier nur für <b>zusätzliche</b> freie Tage verwenden (z. B. 24.12. oder Betriebsfeiertag).</p>
      <div class="row">
        <label>Datum
          <input type="date" id="ef-date" value="${esc(vDate)}" required>
        </label>
        ${isNew ? `<label class="ek-only-abs">bis Datum (optional)
          <input type="date" id="ef-until" value="">
        </label>` : ""}
      </div>
      <div class="row ek-only-work">
        <label>Beginn
          <input type="time" id="ef-from" value="${esc(vFrom)}" required>
        </label>
        <label>Ende
          <input type="time" id="ef-to" value="${esc(vTo)}" required>
        </label>
      </div>
      <label class="ek-only-work">Pause (Min.)
        <input type="number" id="ef-pause" inputmode="numeric" min="0" step="5" value="${esc(vPause)}">
      </label>
      <label class="ek-only-work">Arbeitsort
        <select id="ef-place">${opts}</select>
      </label>
      ${!isNew && segList(entry).length ? `<div class="ek-only-work">
        <div class="lbl">Abschnitte</div>
        <div data-r="ef-segs"></div>
        <p class="note">Versehentlich gewählt? Tippe auf ✕ – die Zeit geht an den nächsten Abschnitt (beim letzten an den vorigen). Wirksam nach „Speichern“.</p>
      </div>` : ""}
      <div class="ek-only-work">
        <div class="lbl">Mit wem</div>
        <div data-r="ef-ppl"></div>
      </div>
      <label class="ek-only-abs">Gutschrift (Stunden pro Tag)
        <input type="text" id="ef-credit" inputmode="decimal" placeholder="z. B. 7,7" value="${esc(vCredit)}">
      </label>
      <label>Notiz (optional)
        <textarea id="ef-note" rows="2" placeholder="z. B. Montage Küche">${esc(vNote)}</textarea>
      </label>
      <p class="hint" id="ef-net" aria-live="polite"></p>
      <div class="row">
        <button type="button" class="btn primary" id="ef-save">Speichern</button>
      </div>
      ${isNew ? "" : `<div class="row"><button type="button" class="btn danger sm" id="ef-del">Eintrag löschen</button></div>`}
    </div>`;

  const sheet = ui.openSheet({ title: isNew ? "Eintrag nachtragen" : "Eintrag bearbeiten", bodyHTML });
  const box = sheet.el;
  // Abschnitte im Formular: Kopie, in der man versehentliche Abschnitte löschen kann
  let segEdit = entry && Array.isArray(entry.segments) ? segList(entry) : null;
  const renderSegEdit = () => {
    const host = box.querySelector('[data-r="ef-segs"]');
    if (!host || !segEdit) return;
    const { esc, clock, hm } = util;
    if (segEdit.length < 2) {
      host.innerHTML = `<p class="note">Ein Abschnitt: ${esc((segEdit[0] && segEdit[0].activity) || "Arbeiten")}</p>` + kmEditHTML(0);
      bindKm();
      return;
    }
    host.innerHTML = `<ul class="ek-segs ek-segs-edit">${segEdit.map((x, i) => {
      const act = x.activity || "Arbeiten";
      const pl = placeText(x);
      return `<li ${actAttrs(act, esc)}>${esc(`${clock(x.start)}–${clock(x.end)}`)} · ${esc(act)}${pl ? " · " + esc(pl) : ""} · ${esc(hm(Math.max(0, (x.end - x.start) / 60000)))} h` +
        `<button type="button" class="seg-del" data-segdel="${i}" aria-label="Abschnitt ${esc(act)} löschen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` +
        kmEditHTML(i) + `</li>`;
    }).join("")}</ul>`;
    bindKm();
    host.querySelectorAll("[data-segdel]").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.dataset.segdel);
      const next = c.timer.removeEntrySegment({ ...entry, segments: segEdit }, i);
      if (!next) return;
      const gone = segEdit[i];
      segEdit = next.segments;
      renderSegEdit();
      ui.toast(`„${gone.activity || "Arbeiten"}“ entfernt – mit „Speichern“ übernehmen`);
    }));
  };
  // Update 9: km je Fahrt-Abschnitt (manuell, leer = Schätzung)
  function kmEditHTML(i) {
    const x = segEdit && segEdit[i];
    if (!x || !isDriving(x)) return "";
    const est = segmentKm({ ...x, km: null }, store.get().settings);
    const v = x.km === null || x.km === undefined || x.km === "" ? "" : String(x.km).replace(".", ",");
    return `<label class="rm-inline tg-kmedit"><span>km</span><input type="text" inputmode="decimal" data-segkm="${i}" value="${util.esc(v)}" placeholder="${est ? (est.est ? "≈ " : "") + util.esc(fmtKm(est.km)) : "z. B. 23"}"><span>${est ? (est.road ? "leer = Straßen-km" : "leer = Schätzung") : "selbst eintragen"}</span></label>`;
  }
  function bindKm() {
    box.querySelectorAll("[data-segkm]").forEach((inp) => inp.addEventListener("input", () => {
      const i = Number(inp.dataset.segkm);
      if (!segEdit || !segEdit[i]) return;
      const t = inp.value.trim().replace(",", ".");
      const n = Number(t);
      if (t === "") delete segEdit[i].km;
      else if (Number.isFinite(n) && n >= 0 && n < 10000) segEdit[i].km = Math.round(n * 10) / 10;
    }));
  }
  renderSegEdit();
  const pplPick = peoplePicker(box.querySelector('[data-r="ef-ppl"]'), c, { selected: entry ? entry.people : [] });
  const netEl = box.querySelector("#ef-net");
  const saveBtn = box.querySelector("#ef-save");
  const creditInp = box.querySelector("#ef-credit");
  const untilInp = box.querySelector("#ef-until");

  // Tage einer Abwesenheit bestimmen: [{ts}] oder {error}
  const absenceDays = () => {
    const d = parseDate(box.querySelector("#ef-date").value);
    if (!d) return { error: "Bitte ein Datum wählen." };
    const first = new Date(d.y, d.mo, d.d);
    const u = untilInp ? parseDate(untilInp.value) : null;
    if (!u) return { days: [first.getTime()], range: false };
    const last = new Date(u.y, u.mo, u.d);
    if (last < first) return { error: "„bis Datum“ liegt vor dem Datum." };
    const days = [];
    for (let i = 0; i < 400; i++) {
      const x = new Date(d.y, d.mo, d.d + i);
      if (x > last) break;
      if (!workDays.includes(x.getDay())) continue;
      if (holidayName(x.getTime())) continue;
      if (schoolName(x.getTime())) continue; // Schultag ist schon gutgeschrieben
      days.push(x.getTime());
    }
    if (days.length > 366) return { error: "Bitte höchstens ein Jahr auf einmal eintragen." };
    if (!days.length) return { error: "In diesem Zeitraum gibt es keine Arbeitstage." };
    return { days, range: true };
  };

  const defaultCredit = (ts) => (kind === "zeitausgleich" ? 0 : kind === "schule" ? baseTarget(ts) : dailyTarget(ts));

  const applyKind = () => {
    box.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    const work = kind === "work";
    box.querySelectorAll(".ek-only-work").forEach((n) => { n.hidden = !work; });
    box.querySelectorAll(".ek-only-abs").forEach((n) => { n.hidden = work; });
    const fh = box.querySelector(".ek-fei-hint");
    if (fh) fh.hidden = kind !== "feiertag";
    const sh = box.querySelector(".ek-sch-hint");
    if (sh) sh.hidden = kind !== "schule";
    if (!work && !creditTouched) {
      const r = absenceDays();
      const ts = r.days ? r.days[0] : Date.now();
      creditInp.value = fmtHours(r.range && kind !== "zeitausgleich" ? nominalMin : defaultCredit(ts));
    }
  };

  const refresh = () => {
    if (kind === "work") {
      const r = readTimes(box);
      if (r.error) {
        netEl.textContent = r.error;
      } else {
        const n = netMin({ start: r.start, end: r.end, pauseMin: r.pauseMin });
        netEl.textContent = `Netto ${hm(n)} h` + (r.overnight ? " · endet am nächsten Tag" : "");
      }
      return;
    }
    if (!creditTouched) applyKind();
    const r = absenceDays();
    if (r.error) { netEl.textContent = r.error; return; }
    const cm = parseHours(creditInp.value);
    if (cm == null) { netEl.textContent = "Bitte die Gutschrift in Stunden eingeben (z. B. 7,7)."; return; }
    const parts = [];
    if (r.range) parts.push(`${r.days.length} ${r.days.length === 1 ? "Arbeitstag" : "Arbeitstage"}`);
    parts.push(`Gutschrift ${hm(cm * r.days.length)} h`);
    if (kind === "zeitausgleich") parts.push("verbraucht Überstunden");
    if (!r.range) {
      const hol = holidayName(r.days[0]);
      const sch = schoolName(r.days[0]);
      if (hol) parts.push(`Feiertag: ${hol}`);
      else if (sch) parts.push(`${sch} ist an diesem Tag schon automatisch gutgeschrieben`);
      else if (kind === "schule") parts.push("zählt als Arbeitszeit");
      else if (dailyTarget(r.days[0]) === 0) parts.push("an diesem Tag kein Soll");
    } else {
      parts.push(hasSchool(util, settings) ? "Wochenenden, Feiertage und Schultage werden übersprungen" : "Wochenenden und Feiertage werden übersprungen");
    }
    netEl.textContent = parts.join(" · ");
  };

  box.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.kind === kind) return;
    const prev = kind;
    kind = b.dataset.kind;
    if (prev === "zeitausgleich" || kind === "zeitausgleich" || prev === "work") creditTouched = false;
    applyKind();
    refresh();
  }));
  creditInp.addEventListener("input", () => { creditTouched = true; refresh(); });
  for (const id of ["#ef-date", "#ef-until", "#ef-from", "#ef-to", "#ef-pause"]) {
    const inp = box.querySelector(id);
    if (!inp) continue;
    inp.addEventListener("input", refresh);
    inp.addEventListener("change", refresh);
  }
  applyKind();
  refresh();

  const note = () => box.querySelector("#ef-note").value.trim();

  const saveWork = async () => {
    const r = readTimes(box);
    if (r.error) { netEl.textContent = r.error; ui.toast(r.error, 3500); return null; }
    const sel = box.querySelector("#ef-place").value;
    const pid = sel && sel !== "__none" ? sel : null;
    // freier Ortsname (z. B. Adresse) bleibt erhalten, außer „Ohne Ort“ wurde gewählt
    let placeName = !pid && sel !== "__none" ? (entry && !entry.placeId ? (entry.place || "") : "") : "";
    if (pid) {
      const pl = places.find((p) => p.id === pid);
      placeName = pl ? pl.name : (orphan && orphan.id === pid ? (entry.place || "") : "");
    }
    const data = {
      ...(entry || {}),
      kind: "work",
      start: r.start,
      end: r.end,
      pauseMin: r.pauseMin,
      placeId: pid,
      place: placeName,
      note: note(),
      people: cleanPeople(pplPick.get()),
      inLoc: entry ? (entry.inLoc ?? null) : null,
      outLoc: entry ? (entry.outLoc ?? null) : null,
    };
    if (segEdit) {
      // Zeiten an geänderte Beginn/Ende anpassen: erster Abschnitt beginnt mit dem Eintrag, letzter endet mit ihm
      const sg = segEdit.map((x) => ({ ...x }));
      if (sg.length) { sg[0].start = r.start; sg[sg.length - 1].end = r.end; }
      data.segments = sg.filter((x) => x.start < r.end);
      if (data.segments.length) data.segments[data.segments.length - 1].end = r.end;
    }
    delete data.creditMin;
    if (entry && entry.id) data.id = entry.id;
    await store.saveEntry(data);
    rememberPeople(store, data.people);
    return { ts: r.start, msg: isNew ? "Eintrag gespeichert" : "Änderung gespeichert" };
  };

  const saveAbsence = async () => {
    const r = absenceDays();
    if (r.error) { netEl.textContent = r.error; ui.toast(r.error, 3500); return null; }
    const cm = parseHours(creditInp.value);
    if (cm == null) {
      const msg = "Bitte die Gutschrift in Stunden eingeben (z. B. 7,7).";
      netEl.textContent = msg; ui.toast(msg, 3500); return null;
    }
    const base = (ts) => ({
      kind,
      start: ts,
      end: ts,
      pauseMin: 0,
      creditMin: cm,
      placeId: null,
      place: "",
      note: note(),
      inLoc: null,
      outLoc: null,
    });
    if (!isNew) {
      await store.saveEntry({ ...entry, ...base(r.days[0]), id: entry.id });
    } else {
      for (const ts of r.days) await store.saveEntry(base(ts));
    }
    const n = r.days.length;
    return { ts: r.days[0], msg: n > 1 ? `${n} Tage ${kindLabel(kind)} gespeichert` : `${kindLabel(kind)} gespeichert` };
  };

  saveBtn.addEventListener("click", async () => {
    ui.setBusy(saveBtn, true, "Speichern …");
    try {
      const res = kind === "work" ? await saveWork() : await saveAbsence();
      if (!res) { ui.setBusy(saveBtn, false); return; }
      const d = new Date(res.ts);
      curY = d.getFullYear();
      curM = d.getMonth();
      sheet.close();
      ui.toast(res.msg);
      render();
    } catch {
      ui.setBusy(saveBtn, false);
    }
  });

  const delBtn = box.querySelector("#ef-del");
  if (delBtn) {
    ui.confirmButton(delBtn, "Wirklich löschen?", async () => {
      try {
        await store.deleteEntry(entry.id);
        sheet.close();
        ui.toast("Eintrag gelöscht");
      } catch { /* Store zeigt Toast */ }
    });
  }

  return sheet;
}
