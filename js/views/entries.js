// Reiter „Einträge“: Monatsliste aller Einträge nach Tagen gruppiert, plus Formular zum Nachtragen/Bearbeiten.

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
    <div class="stack">
      <div class="section-h">
        <h2>Einträge</h2>
        <button type="button" class="btn primary sm" data-act="add">+ Nachtragen</button>
      </div>
      <div class="nav">
        <button type="button" class="btn ghost sm" data-act="prev" aria-label="Vorheriger Monat">‹</button>
        <b data-ref="label"></b>
        <button type="button" class="btn ghost sm" data-act="next" aria-label="Nächster Monat">›</button>
      </div>
      <div class="cal" data-ref="cal"></div>
      <p class="note" data-ref="sum"></p>
      <div class="stack" data-ref="list"></div>
    </div>`;

  el.addEventListener("click", (ev) => {
    const dayBtn = ev.target.closest("button.cal-day[data-day]");
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
    const actEl = ev.target.closest("[data-act]");
    if (actEl && el.contains(actEl)) {
      const act = actEl.dataset.act;
      if (act === "add") { openEntryForm(null, C, selKey ? { date: selKey } : null); return; }
      if (act === "prev") { shiftMonth(-1); return; }
      if (act === "next") { shiftMonth(1); return; }
      if (act === "all-days") { selKey = null; render(); return; }
    }
    const row = ev.target.closest("button.entry[data-id]");
    if (row && el.contains(row)) {
      const snap = lastSnap || C.store.get();
      const entry = (snap?.entries || []).find((e) => e.id === row.dataset.id);
      if (entry) C.openEntryForm(entry);
    }
  });

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

const CAL_KINDS = ["urlaub", "krank", "feiertag", "zeitausgleich"];

function calendarHTML(snap, util, holidaysOn) {
  const { esc, hm, dayKey, startOfWeek } = util;
  const creditMin = util.creditMin || util.netMin;
  const kindLabel = util.kindLabel || ((k) => k);
  const holidayName = util.holidayName || (() => null);

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
      const aria = [util.fmtDate(dt.getTime())];
      if (hol) aria.push(hol);
      if (labels.length) aria.push(labels.join(", "));
      if (info && info.min > 0) aria.push(`${hm(info.min)} h`);
      grid += `<button type="button" class="${cls.join(" ")}" data-day="${k}"` +
        `${hol ? ` title="${esc(hol)}"` : ""} aria-label="${esc(aria.join(" · "))}" aria-pressed="${k === selKey}">` +
        `<span class="cal-num">${dt.getDate()}</span>` +
        `<span class="cal-h">${info && info.min > 0 ? esc(hm(info.min)) : ""}</span>` +
        `${hol ? `<span class="cal-dot" aria-hidden="true"></span>` : ""}` +
        `</button>`;
    }
    grid += `<span class="cal-week" title="Wochensumme">${weekMin > 0 ? esc(hm(weekMin)) : ""}</span>`;
  }

  const legend = ["work", ...CAL_KINDS]
    .map((k) => `<span class="k-${k}">${esc(kindLabel(k))}</span>`).join("");

  return `<div class="cal-head" aria-hidden="true">${head}</div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend">${legend}</div>`;
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

  const from = new Date(curY, curM, 1).getTime();
  const to = new Date(curY, curM + 1, 1).getTime();
  const monthList = (snap.entries || []).filter((e) => e.start >= from && e.start < to);
  const list = selKey ? monthList.filter((e) => dayKey(e.start) === selKey) : monthList;

  const resetBtn = `<div class="row"><button type="button" class="btn ghost sm" data-act="all-days">Alle Tage zeigen</button></div>`;

  if (!list.length) {
    sumEl.textContent = "";
    if (selKey) {
      const d = parseDate(selKey);
      const ts = d ? new Date(d.y, d.mo, d.d).getTime() : Date.now();
      const hol = holidaysOn ? holidayName(ts) : null;
      listEl.innerHTML = `<div class="empty"><h3>Keine Einträge am ${esc(fmtDate(ts))}</h3>
        ${hol ? `<p class="note">Feiertag: ${esc(hol)}</p>` : ""}
        <p class="note">Tippe auf „+ Nachtragen“, um für diesen Tag etwas einzutragen.</p></div>${resetBtn}`;
    } else {
      listEl.innerHTML = `<div class="empty"><h3>Keine Einträge in diesem Monat</h3>
        <p class="note">Tippe auf „+ Nachtragen“, um Arbeitszeit, Urlaub oder Krankenstand einzutragen.</p></div>`;
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
  const keys = [...groups.keys()].sort().reverse();

  let total = 0;
  let workDays = 0;
  const absCount = new Map();
  const html = keys.map((k) => {
    const items = groups.get(k).sort((a, b) => a.start - b.start);
    const daySum = items.reduce((s, e) => s + creditMin(e), 0);
    total += daySum;
    if (items.some((e) => isWork(e) && netMin(e) > 0)) workDays++;
    const rows = items.map((e) => {
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
      const p = [];
      const pl = placeText(e);
      if (pl) p.push(`<span class="tag">${esc(pl)}</span>`);
      if (e.pauseMin > 0) p.push(`Pause ${esc(e.pauseMin)} Min.`);
      if (e.note) p.push(esc(e.note));
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
    const hol = holidaysOn ? holidayName(items[0].start) : null;
    return `
      <div class="day">
        <div class="day-h"><span>${esc(fmtDate(items[0].start))}${hol ? ` <span class="ek-hol">${esc(hol)}</span>` : ""}</span><span class="sum">${esc(hm(daySum))} h</span></div>
        ${rows}
      </div>`;
  }).join("");

  if (selKey) {
    sumEl.textContent = "";
    listEl.innerHTML = html + resetBtn;
    return;
  }
  const parts = [`Gesamt ${hm(total)} h`, `${workDays} ${workDays === 1 ? "Arbeitstag" : "Arbeitstage"}`];
  for (const kind of ["urlaub", "krank", "feiertag", "zeitausgleich"]) {
    const n = absCount.get(kind);
    if (n) parts.push(`${n}× ${kindLabel(kind)}`);
  }
  sumEl.textContent = parts.join(" · ");
  listEl.innerHTML = html;
}

// Ortsname eines Eintrags/Abschnitts: gespeicherter Name, sonst Adresse des Start-Standorts
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
    if ((x.endLoc || ep) && ep && (driving || ep !== pl)) {
      parts.push(`von ${esc(pl || "?")} → nach ${esc(ep)}`);
      const a = x.loc, b = x.endLoc;
      if (g && g.distanceM && a && b && a.lat != null && b.lat != null) {
        parts.push(`ca. ${esc(fmtDist(g.distanceM(a, b)))} <small>Luftlinie</small>`);
      }
    } else if (pl) {
      parts.push(esc(pl));
    }
    parts.push(esc(`${hm(Math.max(0, (x.end - x.start) / 60000))} h`));
    return `<li ${actAttrs(act, esc)}>${parts.join(" · ")}</li>`;
  }).join("")}</ul>`;
}

function isWork(e) {
  return !e || !e.kind || e.kind === "work";
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

const KINDS = ["work", "urlaub", "krank", "feiertag", "zeitausgleich"];

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
  const workDays = Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4, 5];
  const nominalMin = workDays.length ? (Number(settings.weeklyTarget ?? 38.5) || 0) * 60 / workDays.length : 0;

  let kind = isNew ? "work" : (KINDS.includes(entry.kind) ? entry.kind : "work");
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
        ${segmentsHTML(entry, util) || `<p class="note">Ein Abschnitt: ${esc(segList(entry)[0].activity || "Arbeiten")}</p>`}
        <p class="note">Abschnitte werden beim Speichern unverändert übernommen.</p>
      </div>` : ""}
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
      days.push(x.getTime());
    }
    if (days.length > 366) return { error: "Bitte höchstens ein Jahr auf einmal eintragen." };
    if (!days.length) return { error: "In diesem Zeitraum gibt es keine Arbeitstage." };
    return { days, range: true };
  };

  const defaultCredit = (ts) => (kind === "zeitausgleich" ? 0 : dailyTarget(ts));

  const applyKind = () => {
    box.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
    const work = kind === "work";
    box.querySelectorAll(".ek-only-work").forEach((n) => { n.hidden = !work; });
    box.querySelectorAll(".ek-only-abs").forEach((n) => { n.hidden = work; });
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
      if (hol) parts.push(`Feiertag: ${hol}`);
      else if (dailyTarget(r.days[0]) === 0) parts.push("an diesem Tag kein Soll");
    } else {
      parts.push("Wochenenden und Feiertage werden übersprungen");
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
      inLoc: entry ? (entry.inLoc ?? null) : null,
      outLoc: entry ? (entry.outLoc ?? null) : null,
    };
    delete data.creditMin;
    if (entry && entry.id) data.id = entry.id;
    await store.saveEntry(data);
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
