// Update 9 – Kalender: Ansichten Tag · 3 Tage · Woche (Zeitraster), Monat (Balken), Jahr (Mini-Monate), Termine (Liste).
// Reine HTML-Erzeugung; Ereignisse/Drag & Drop in agenda.js bzw. cal-dnd.js.
import { icon } from "../icons.js";
import { buildIndex, hhmm, TYPES, DOT_ORDER } from "../planer-core.js";
import { addDays, diffDays, isoWeek, mondayOf, layoutDay, layoutBars, parseKey, wdOf } from "../cal-core.js";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD_MO = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad = (n) => String(n).padStart(2, "0");
export const H_BY_N = { 1: 56, 3: 52, 7: 44 };

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const dd = (k) => parseKey(k).d;
export function dayLong(k) {
  const { y, m, d } = parseKey(k);
  return `${WD_LONG[wdOf(k)]}, ${d}. ${MONTHS[m - 1]}${y !== new Date().getFullYear() ? " " + y : ""}`;
}
function styleC(it) {
  const p = [];
  if (it.color) p.push(`--c:${it.color}`);
  if (it.hue != null) p.push(`--h:${it.hue}`);
  return p.length ? ` style="${p.join(";")}"` : "";
}
const typeCls = (it) => `pl-t-${it.type}${it.cls ? " " + it.cls : ""}${it.ext ? " is-ext" : ""}`;
const baseUid = (it) => (it.inst ? it.inst.uid : it.uid);

/* ---------- Kopf: Navigation + Werkzeuge ---------- */

export function navHTML(title, sub, isNow, label) {
  return `<div class="pl-nav">` +
    `<button type="button" class="icon-btn ag-mnav" data-pnav="-1" aria-label="${label} zurück" title="${label} zurück (←)">${icon("chevron-left", 20)}</button>` +
    `<div class="pl-nav-t"><b class="ag-mname">${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>` +
    `<button type="button" class="btn sm ghost ez-today" data-pnav="0"${isNow ? " disabled" : ""} title="Heute (T)">Heute</button>` +
    `<button type="button" class="icon-btn ag-mnav" data-pnav="1" aria-label="${label} weiter" title="${label} weiter (→)">${icon("chevron-right", 20)}</button>` +
  `</div>`;
}

export function toolsHTML(dateVal, gState) {
  const g = gState && gState.connected
    ? (gState.loading ? `<span class="pl-gstat" aria-live="polite">Google lädt …</span>` : gState.error ? `<button type="button" class="btn sm ghost pl-gstat bad" data-pact="gerr">Google: Problem</button>` : "")
    : gState && gState.wasConnected ? `<button type="button" class="btn sm ghost pl-gstat pl-greconnect" data-pact="gconnect" title="Die Google-Freigabe ist abgelaufen – oder unter „Kalender“ dauerhaft per iCal-Link verbinden">${icon("repeat", 14)}<span>Google neu verbinden</span></button>`
    : gState && gState.loading ? `<span class="pl-gstat" aria-live="polite">Kalender lädt …</span>` : "";
  const f = gState && gState.feedErr ? `<button type="button" class="btn sm ghost pl-gstat bad" data-pact="cals">Kalender-Link: Problem</button>` : "";
  return `<div class="pl-tools">` +
    `<button type="button" class="btn sm ghost pl-tool" data-pact="search" title="Suchen (/)">${icon("search", 16)}<span>Suchen</span></button>` +
    `<label class="btn sm ghost pl-tool pl-jump" title="Datum wählen">${icon("calendar", 16)}<span>Datum</span><input type="date" data-pjump value="${esc(dateVal)}" aria-label="Zu Datum springen"></label>` +
    `<button type="button" class="btn sm ghost pl-tool" data-pact="cals" title="Kalender, Import/Export, Google">${icon("layers", 16)}<span>Kalender</span></button>` +
    g + f + `</div>`;
}

/* ---------- Bausteine ---------- */

function chipHTML(it) {
  return `<div class="pl-ad ${typeCls(it)}${it.done ? " done" : ""}"${styleC(it)}>` +
    (it.check ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
    (it.open ? `<button type="button" class="pl-ad-m" data-popen="${esc(it.open)}">` : `<span class="pl-ad-m">`) +
    `<span aria-hidden="true">${it.emoji}</span><b>${esc(it.title)}</b><span class="pl-ad-s">${esc(it.sub)}</span>` +
    (it.open ? `</button>` : `</span>`) + `</div>`;
}

function blockHTML(it, H, compact, day, showCheck = !compact) {
  const top = (it.start / 60) * H;
  const h = Math.max(compact ? 18 : 24, ((it.end - it.start) / 60) * H - 2);
  const w = 100 / (it.cols || 1);
  const span = Math.max(1, it.span || 1);
  const style = `top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${(w * (it.col || 0)).toFixed(3)}% + 1px);width:calc(${(w * span).toFixed(3)}% - 3px);` +
    `${it.hue != null ? `--h:${it.hue};` : ""}${it.color ? `--c:${it.color};` : ""}`;
  const tiny = h < 34;
  const lbl = `${TYPES[it.type] ? TYPES[it.type].label : ""}: ${it.title}, ${it.sub}${it.done ? ", erledigt" : ""}`;
  const drag = it.editable && !it.dayPart && it.inst
    ? ` data-ev="${esc(it.inst.id)}|${esc(it.inst.key)}" data-day="${day}" data-s="${it.start}" data-e="${it.end}"` : "";
  return `<div class="pl-blk ${typeCls(it)}${it.done ? " done" : ""}${tiny ? " tiny" : ""}${it.running ? " run" : ""}${drag ? " can-drag" : ""}" style="${style}"${drag}>` +
    (it.open ? `<button type="button" class="pl-blk-m" data-popen="${esc(it.open)}" aria-label="${esc(lbl)}">` : `<div class="pl-blk-m" role="img" aria-label="${esc(lbl)}">`) +
      `<span class="pl-blk-t"><span class="pl-blk-e" aria-hidden="true">${it.emoji}</span>${esc(it.title)}</span>` +
      (tiny ? "" : `<span class="pl-blk-s">${esc(it.sub)}</span>`) +
    (it.open ? `</button>` : `</div>`) +
    (it.check && showCheck ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
    (drag ? `<span class="pl-rsz" data-rsz aria-hidden="true"></span>` : "") +
  `</div>`;
}

function slotsHTML(day, H, focusable) {
  let s = "";
  for (let h = 0; h < 24; h++) {
    s += `<button type="button" class="pl-slot" data-pslot="${day}" data-h="${h}" style="top:${h * H}px;height:${H}px"${focusable ? "" : ` tabindex="-1"`} aria-label="Termin am ${esc(dayLong(day))} um ${h}:00 anlegen"></button>`;
  }
  return s;
}
function hoursHTML(H) {
  let s = "";
  for (let h = 0; h < 24; h++) s += `<div class="pl-hr" style="top:${h * H}px;height:${H}px"><span>${h ? pad(h) + ":00" : ""}</span></div>`;
  return `<div class="pl-hours" aria-hidden="true">${s}</div>`;
}
function nowLineHTML(H) {
  const m = nowMin();
  return `<div class="pl-now" data-pnow style="top:${((m / 60) * H).toFixed(1)}px" aria-hidden="true"><span>Jetzt ${hhmm(m)}</span></div>`;
}
function dotsHTML(types) {
  if (!types || !types.size) return `<span class="pl-dots" aria-hidden="true"></span>`;
  return `<span class="pl-dots" aria-hidden="true">${DOT_ORDER.filter((t) => types.has(t)).map((t) => `<i class="pl-t-${t}"></i>`).join("")}</span>`;
}
const typesText = (types) => DOT_ORDER.filter((t) => types && types.has(t)).map((t) => TYPES[t].label).join(", ");

/* ---------- Zeitraster: Tag · 3 Tage · Woche ---------- */

/** Ganztags-Balken für n Spalten ab startKey → HTML (Raster mit Zeilen). */
function allDayBarsHTML(idx, startKey, n, maxLanes, expanded) {
  const bars = [];
  const seen = new Set();
  for (let c = 0; c < n; c++) {
    const k = addDays(startKey, c);
    for (const it of idx.get(k).allDay) {
      const u = baseUid(it);
      if (seen.has(u)) continue;
      seen.add(u);
      const c0 = it.spanFrom ? Math.max(0, diffDays(startKey, it.spanFrom)) : c;
      const c1 = it.spanTo ? Math.min(n - 1, diffDays(startKey, it.spanTo)) : c;
      bars.push({ it, c0, c1, order: bars.length, cont0: it.spanFrom && it.spanFrom < startKey, cont1: it.spanTo && diffDays(startKey, it.spanTo) > n - 1 });
    }
  }
  if (!bars.length) return "";
  const lanes = layoutBars(bars);
  const L = expanded ? lanes : Math.min(lanes, maxLanes);
  const perCol = Array.from({ length: n }, () => ({ all: 0, shown: 0 }));
  const over = (b) => { for (let c = b.c0; c <= b.c1; c++) if (perColAll(c) > L) return true; return false; };
  const perColAll = (c) => bars.filter((b) => b.c0 <= c && b.c1 >= c).length;
  let html = "";
  for (const b of bars) {
    const show = b.lane < L - 1 || (b.lane === L - 1 && !over(b));
    for (let c = b.c0; c <= b.c1; c++) { perCol[c].all++; if (show) perCol[c].shown++; }
    if (!show) continue;
    const it = b.it;
    html += `<button type="button" class="pl-adb ${typeCls(it)}${it.done ? " done" : ""}${b.cont0 ? " c0" : ""}${b.cont1 ? " c1" : ""}" style="grid-column:${b.c0 + 1}/${b.c1 + 2};grid-row:${b.lane + 1};${it.color ? `--c:${it.color}` : ""}"` +
      ` ${it.open ? `data-popen="${esc(it.open)}"` : `data-pday="${addDays(startKey, b.c0)}"`} aria-label="${esc(it.sub + ": " + it.title)}"><span aria-hidden="true">${it.emoji}</span>${esc(it.title)}</button>`;
  }
  for (let c = 0; c < n; c++) {
    const hidden = perCol[c].all - perCol[c].shown;
    if (hidden > 0) html += `<button type="button" class="pl-adb more" style="grid-column:${c + 1};grid-row:${L}" data-pact="adexp">+${hidden}</button>`;
  }
  return `<div class="pl-wrow pl-walld"><div class="pl-gut"><span>ganzt.</span></div>` +
    `<div class="pl-adg" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${html}</div></div>` +
    (lanes > maxLanes && expanded ? `<div class="pl-wrow"><div class="pl-gut"></div><button type="button" class="btn sm ghost pl-adless" data-pact="adexp">Weniger</button></div>` : "");
}

/**
 * Zeitraster für n Tage (1, 3 oder 7) ab startKey.
 * opts: {expanded} – alle Ganztags-Zeilen zeigen
 */
export function gridViewHTML(snap, startKey, n, deps, opts = {}) {
  const H = H_BY_N[n] || 48;
  const endKey = addDays(startKey, n - 1);
  const idx = buildIndex(snap, startKey, endKey, deps);
  const tK = todayKey();
  const kw = isoWeek(startKey);
  const s = parseKey(startKey), e = parseKey(endKey);
  let title, sub, label;
  if (n === 1) {
    const d = idx.get(startKey);
    const rel = startKey === tK ? "Heute" : startKey === addDays(tK, 1) ? "Morgen" : startKey === addDays(tK, -1) ? "Gestern" : "";
    const cnt = d.allDay.length + d.timed.length;
    title = `${WD[wdOf(startKey)]}, ${s.d}. ${MONTHS[s.m - 1]}${s.y !== new Date().getFullYear() ? " " + s.y : ""}`;
    sub = [rel, `KW ${kw}`, cnt ? `${cnt} ${cnt === 1 ? "Eintrag" : "Einträge"}` : "nichts geplant"].filter(Boolean).join(" · ");
    label = "Tag";
  } else {
    title = s.m === e.m ? `${s.d}.–${e.d}. ${MONTHS[e.m - 1]}` : `${s.d}. ${MONTHS[s.m - 1].slice(0, 3)} – ${e.d}. ${MONTHS[e.m - 1].slice(0, 3)}`;
    const kw2 = isoWeek(endKey);
    sub = `KW ${kw}${kw2 !== kw ? "/" + kw2 : ""} · ${e.y}`;
    label = n === 3 ? "3 Tage" : "Woche";
  }
  const isNow = tK >= startKey && tK <= endKey;
  let head = "", cols = "", allday = "";
  if (n === 1) {
    const d = idx.get(startKey);
    if (d.allDay.length) allday = `<div class="pl-allday" aria-label="Ganztägig">${d.allDay.map(chipHTML).join("")}</div>`;
  } else {
    for (let i = 0; i < n; i++) {
      const k = addDays(startKey, i);
      const d = idx.get(k);
      const we = wdOf(k) === 0 || wdOf(k) === 6;
      head += `<button type="button" class="pl-wh${k === tK ? " today" : ""}${we ? " we" : ""}${d.types.has("feiertag") ? " hol" : ""}" data-pday="${k}" aria-label="${esc(dayLong(k))} öffnen${d.types.size ? " – " + esc(typesText(d.types)) : ""}">` +
        `<span>${WD[wdOf(k)]}</span><b>${dd(k)}</b>${dotsHTML(d.types)}</button>`;
    }
    allday = allDayBarsHTML(idx, startKey, n, n === 7 ? 3 : 4, !!opts.expanded);
  }
  for (let i = 0; i < n; i++) {
    const k = addDays(startKey, i);
    const d = idx.get(k);
    const we = wdOf(k) === 0 || wdOf(k) === 6;
    const timed = layoutDay(d.timed.map((it) => ({ ...it })));
    cols += `<div class="pl-col${k === tK ? " today" : ""}${we && n > 1 ? " we" : ""}" data-pcol="${k}">` + slotsHTML(k, H, n === 1) +
      timed.map((it) => blockHTML(it, H, n === 7, k, n === 1)).join("") + (k === tK ? nowLineHTML(H) : "") + `</div>`;
  }
  const scrollName = n === 1 ? "day" : n === 7 ? "week" : "three";
  return navHTML(title, sub, isNow, label) +
    (n === 1 ? allday : `<div class="pl-week" data-n="${n}"><div class="pl-wrow pl-whead"><div class="pl-gut"></div>${head}</div>${allday}`) +
    `<div class="pl-tl-scroll" data-pscroll="${scrollName}" data-h="${H}" tabindex="-1">` +
      `<div class="pl-tl" style="height:${24 * H}px">${hoursHTML(H)}<div class="pl-cols">${cols}</div></div>` +
    `</div>` + (n === 1 ? "" : `</div>`) +
    `<p class="note pl-tip">${n === 1 ? "Freie Stelle antippen legt einen Termin an. Termin lange drücken und ziehen verschiebt ihn, unten am Rand ziehen ändert die Dauer." : "Tag oben antippen öffnet die Tagesansicht. Lange drücken + ziehen verschiebt einen Termin."}</p>`;
}

/* ---------- Monat ---------- */

export function monthGridHTML(snap, ym, sel, deps, maxLanes = 3) {
  const { y, m } = ym;
  const first = `${y}-${pad(m + 1)}-01`;
  const n = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${pad(m + 1)}-${pad(n)}`;
  const from = mondayOf(first);
  const weeks = Math.ceil((diffDays(from, last) + 1) / 7);
  const to = addDays(from, weeks * 7 - 1);
  const idx = buildIndex(snap, from, to, deps);
  const tK = todayKey();
  const L = maxLanes;
  let rows = "";
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(from, w * 7);
    const bars = [];
    const seen = new Set();
    let cells = "";
    for (let c = 0; c < 7; c++) {
      const k = addDays(ws, c);
      const d = idx.get(k);
      const inM = k >= first && k <= last;
      const cls = ["pl-mc"];
      if (!inM) cls.push("out");
      if (k === tK) cls.push("today");
      if (c >= 5) cls.push("we");
      if (d.types.has("feiertag")) cls.push("hol");
      const n2 = d.allDay.length + d.timed.length;
      const lbl = `${dayLong(k)}${d.types.size ? " – " + typesText(d.types) : ""}${n2 ? `, ${n2} ${n2 === 1 ? "Eintrag" : "Einträge"}` : ""}`;
      cells += `<button type="button" class="${cls.join(" ")}" style="grid-column:${c + 1}" data-psel="${k}" aria-pressed="${k === sel}" aria-label="${esc(lbl)}">` +
        `<span class="pl-mc-n">${dd(k)}</span></button>`;
      for (const it of d.allDay) {
        const u = baseUid(it);
        if (seen.has(u)) continue;
        seen.add(u);
        const c0 = it.spanFrom ? Math.max(0, diffDays(ws, it.spanFrom)) : c;
        const c1 = it.spanTo ? Math.min(6, diffDays(ws, it.spanTo)) : c;
        bars.push({ it, c0, c1, order: bars.length, cont0: it.spanFrom && it.spanFrom < ws, cont1: it.spanTo && diffDays(ws, it.spanTo) > 6 });
      }
      for (const it of d.timed) {
        if (it.type === "arbeit") continue; // Arbeitszeit nur im Zeitraster
        bars.push({ it, c0: c, c1: c, order: 1000 + bars.length, timed: true });
      }
    }
    layoutBars(bars);
    const all = (c) => bars.filter((b) => b.c0 <= c && b.c1 >= c).length;
    const over = (b) => { for (let c = b.c0; c <= b.c1; c++) if (all(c) > L) return true; return false; };
    const shown = Array(7).fill(0);
    let bh = "";
    for (const b of bars) {
      const show = b.lane < L - 1 || (b.lane === L - 1 && !over(b));
      if (!show) continue;
      for (let c = b.c0; c <= b.c1; c++) shown[c]++;
      const it = b.it;
      const time = b.timed && it.start != null ? `<i>${hhmm(it.start)}</i>` : "";
      bh += `<button type="button" class="pl-mbar ${typeCls(it)}${b.timed ? " timed" : ""}${it.done ? " done" : ""}${b.cont0 ? " c0" : ""}${b.cont1 ? " c1" : ""}"` +
        ` style="grid-column:${b.c0 + 1}/${b.c1 + 2};grid-row:${b.lane + 2};${it.color ? `--c:${it.color};` : ""}${it.hue != null ? `--h:${it.hue}` : ""}"` +
        ` ${it.open ? `data-popen="${esc(it.open)}"` : `data-psel="${addDays(ws, b.c0)}"`} aria-label="${esc(it.title + ", " + it.sub)}">${time}<span>${esc(it.title)}</span></button>`;
    }
    for (let c = 0; c < 7; c++) {
      const hidden = all(c) - shown[c];
      if (hidden > 0) bh += `<button type="button" class="pl-mmore" style="grid-column:${c + 1};grid-row:${L + 1}" data-psel="${addDays(ws, c)}" aria-label="${hidden} weitere am ${esc(dayLong(addDays(ws, c)))}">+${hidden} weitere</button>`;
    }
    rows += `<div class="pl-mw" style="--lanes:${L}"><span class="pl-kw" aria-hidden="true">${isoWeek(ws)}</span>${cells}${bh}</div>`;
  }
  const isCur = (() => { const d = new Date(); return d.getFullYear() === y && d.getMonth() === m; })();
  const head = WD_MO.map((w, i) => `<div class="ez-wh${i >= 5 ? " we" : ""}" aria-hidden="true">${w}</div>`).join("");
  let selHTML = "";
  if (sel) selHTML = scheduleHTML(sel, idx.has(sel) ? idx.get(sel) : buildIndex(snap, sel, sel, deps).get(sel));
  return navHTML(`${MONTHS[m]} ${y}`, `KW ${isoWeek(first)}–${isoWeek(last)}`, isCur, "Monat") +
    `<div class="pl-mgrid2"><div class="pl-mhead">${head}</div>${rows}</div>` + selHTML;
}

/** Tagesliste (unter dem Monat). */
export function scheduleHTML(k, d) {
  const items = [...d.allDay, ...d.timed];
  const body = items.length
    ? `<ol class="pl-sched">${items.map((it) =>
      `<li class="${typeCls(it)}${it.done ? " done" : ""}"${styleC(it)}><span class="pl-sched-i" aria-hidden="true">${it.emoji}</span>` +
      `<span class="pl-sched-time">${it.start != null ? hhmm(it.start) : "ganzt."}</span>` +
      (it.open ? `<button type="button" class="pl-sched-m" data-popen="${esc(it.open)}">` : `<span class="pl-sched-m">`) +
      `<b>${esc(it.title)}</b><span>${esc(it.sub)}</span>` + (it.open ? `</button>` : `</span>`) +
      (it.check ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
      `</li>`).join("")}</ol>`
    : `<p class="note ag-none">Nichts geplant.</p>`;
  return `<div class="pl-selday"><div class="pl-selh"><b>${esc(dayLong(k))}</b>` +
    `<button type="button" class="btn sm ghost" data-pday="${k}">Tag öffnen</button></div>${body}</div>`;
}

/* ---------- Jahr ---------- */

const HEAT_TYPES = new Set(["termin", "aufgabe", "event", "geburtstag", "einsatz"]);

export function yearViewHTML(snap, year, deps) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const idx = buildIndex(snap, from, to, { ...deps, yearOnly: true });
  const tK = todayKey();
  let html = "";
  let total = 0;
  for (let m = 0; m < 12; m++) {
    const first = `${year}-${pad(m + 1)}-01`;
    const n = new Date(year, m + 1, 0).getDate();
    const lead = (wdOf(first) + 6) % 7;
    let cells = WD_MO.map((w) => `<i class="pl-yh" aria-hidden="true">${w[0]}</i>`).join("");
    for (let i = 0; i < lead; i++) cells += `<i class="pl-yp" aria-hidden="true"></i>`;
    for (let d = 1; d <= n; d++) {
      const k = `${year}-${pad(m + 1)}-${pad(d)}`;
      const day = idx.get(k);
      const items = [...day.allDay, ...day.timed].filter((it) => HEAT_TYPES.has(it.type));
      const cnt = new Set(items.map(baseUid)).size;
      total += cnt;
      const heat = cnt === 0 ? 0 : cnt === 1 ? 1 : cnt <= 3 ? 2 : cnt <= 5 ? 3 : 4;
      const cls = ["pl-yd"];
      if (heat) cls.push("h" + heat);
      if (k === tK) cls.push("today");
      if (day.types.has("feiertag")) cls.push("hol");
      if (day.types.has("schule")) cls.push("sch");
      const lbl = `${dayLong(k)}${cnt ? `, ${cnt} ${cnt === 1 ? "Eintrag" : "Einträge"}` : ""}${day.types.has("feiertag") ? ", Feiertag" : ""}`;
      cells += `<button type="button" class="${cls.join(" ")}" data-pday="${k}" aria-label="${esc(lbl)}">${d}</button>`;
    }
    html += `<section class="pl-ym${new Date().getFullYear() === year && new Date().getMonth() === m ? " cur" : ""}"><button type="button" class="pl-ymh" data-pmonth="${year}-${m}">${MONTHS[m]}</button><div class="pl-ygrid">${cells}</div></section>`;
  }
  return navHTML(String(year), `${total} Einträge`, new Date().getFullYear() === year, "Jahr") +
    `<div class="pl-year">${html}</div>` +
    `<div class="pl-yleg" aria-hidden="true"><span>weniger</span><i class="pl-yd"></i><i class="pl-yd h1"></i><i class="pl-yd h2"></i><i class="pl-yd h3"></i><i class="pl-yd h4"></i><span>mehr</span><i class="pl-yd hol">1</i><span>Feiertag</span></div>`;
}

/* ---------- Termine (Liste) ---------- */

export function agendaListHTML(snap, fromKey, days, deps) {
  const to = addDays(fromKey, days - 1);
  const idx = buildIndex(snap, fromKey, to, deps);
  const tK = todayKey();
  let html = "";
  let lastKw = null;
  let count = 0;
  for (let k = fromKey; k <= to; k = addDays(k, 1)) {
    const d = idx.get(k);
    const items = [...d.allDay, ...d.timed].filter((it) => it.type !== "arbeit");
    if (!items.length) continue;
    const kw = isoWeek(k);
    if (kw !== lastKw) { html += `<li class="pl-agkw" aria-hidden="true">KW ${kw}</li>`; lastKw = kw; }
    const { m } = parseKey(k);
    html += `<li class="pl-agday${k === tK ? " today" : ""}"><button type="button" class="pl-agd" data-pday="${k}" aria-label="${esc(dayLong(k))} öffnen"><b>${dd(k)}</b><span>${WD[wdOf(k)]}</span><small>${MONTHS[m - 1].slice(0, 3)}</small></button><ol>` +
      items.map((it) => {
        count++;
        const time = it.start != null ? `${hhmm(it.start)}${it.end != null ? "–" + (it.end >= 1440 ? "24:00" : hhmm(it.end)) : ""}` : "ganztägig";
        return `<li class="${typeCls(it)}${it.done ? " done" : ""}"${styleC(it)}>` +
          (it.open ? `<button type="button" class="pl-agi" data-popen="${esc(it.open)}">` : `<span class="pl-agi">`) +
          `<i aria-hidden="true"></i><span class="pl-agt">${esc(time)}</span><b>${it.emoji ? `<span aria-hidden="true">${it.emoji}</span> ` : ""}${esc(it.title)}</b>` +
          `<small>${esc(String(it.sub || "").replace(/^(\d{2}:\d{2}(–\d{2}:\d{2})?|ganztägig) · /, ""))}</small>` + (it.open ? `</button>` : `</span>`) + `</li>`;
      }).join("") + `</ol></li>`;
  }
  const s = parseKey(fromKey), e = parseKey(to);
  return navHTML(`ab ${s.d}. ${MONTHS[s.m - 1]}`, `bis ${e.d}. ${MONTHS[e.m - 1]} ${e.y} · ${count} Einträge`, fromKey === tK, "Zeitraum") +
    (html ? `<ol class="pl-ag">${html}</ol>` : `<p class="note ag-none">In diesem Zeitraum ist nichts geplant.</p>`) +
    `<button type="button" class="btn sm ghost pl-agmore" data-pact="agmore">Weitere 30 Tage anzeigen</button>`;
}
