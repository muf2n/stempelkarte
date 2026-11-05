// Update 9 – Planer: Ansichten Tag · Woche · Monat, „Neu erstellen“, Countdowns, Geburtstage.
// Wird von agenda.js eingebunden; Logik in ../planer-core.js.
import { icon } from "../icons.js";
import {
  addDays, dateOf, keyOf, daysBetween, hhmm, toMin, TYPES, DOT_ORDER, CATS,
  buildIndex, layoutColumns, upcomingBirthdays, countdowns, countdownText, parseBday,
} from "../planer-core.js";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD_MO = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const H_DAY = 56;   // px je Stunde in „Tag“
export const H_WEEK = 44;  // px je Stunde in „Woche“
const BDAYS_SHOW = 6;

const pad = (n) => String(n).padStart(2, "0");
export const todayKey = () => keyOf(new Date());
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
/** Montag der Woche von key. */
export function mondayOf(key) { const wd = dateOf(key).getDay(); return addDays(key, -((wd + 6) % 7)); }

/* ---------- Symbole (nur hier gebraucht) ---------- */
const SV = (p, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;
const ICONS = {
  termin: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="1.6" fill="currentColor"/>',
  aufgabe: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12.2l2.4 2.4 4.8-5"/>',
  geburtstag: '<path d="M5 20.5h14M6 20.5v-6.5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v6.5"/><path d="M6 16c1.5 1 3 1 4 0s3-1 4 0 3 1 4 0"/><path d="M12 12.5V9M12 6.5c-.9-.8-.9-1.9 0-3 .9 1.1.9 2.2 0 3z"/>',
  event: '<path d="M4.5 20l4-11 6.5 6.5z"/><path d="M14 4.5c.3 1.6-.2 2.8-1.5 3.5M18 9c1.4-.7 2.6-.5 3.5.3M16.5 3.5l.5 1M20 6l1-.5M19.5 13l1 .5"/>',
  einsatz: '<path d="M14.5 5.5a4 4 0 0 0-5.2 5.2L4 16l4 4 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.6-.7-.7-2.6z"/>',
  erinnerung: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
};
export const typeIcon = (k, size = 24) => SV(ICONS[k] || ICONS.termin, size);

/* ---------- Neu erstellen ---------- */

const QUICK = [
  ["termin", "Termin"], ["aufgabe", "Aufgabe"], ["geburtstag", "Geburtstag"],
  ["event", "Event"], ["einsatz", "Einsatz"], ["erinnerung", "Erinnerung"],
];
export function quickCreateHTML() {
  return `<div class="pl-qc" role="group" aria-labelledby="pl-qc-h"><div class="pl-qc-h" id="pl-qc-h">Neu erstellen</div>` +
    `<div class="pl-qc-row">${QUICK.map(([k, l]) =>
      `<button type="button" class="pl-qc-b" data-pnew="${k}"><span class="pl-qc-i pl-t-${k}">${typeIcon(k, 24)}</span><span class="pl-qc-l">${l}</span></button>`).join("")}</div></div>`;
}

/* ---------- Countdown-Karte ---------- */

export function countdownHTML(todos, tKey) {
  const list = countdowns(todos, tKey);
  if (!list.length) return "";
  const [first, ...rest] = list;
  const big = first.days <= 0 ? "Heute" : String(first.days);
  const unit = first.days <= 0 ? "ist es so weit!" : first.days === 1 ? "Tag" : "Tage";
  const when = (k) => { const d = dateOf(k); return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
  const lbl = `${countdownText(first.days)} – ${first.t.title}`;
  return `<section class="card pl-cd" aria-label="Countdown">` +
    `<button type="button" class="pl-cd-main" data-popen="todo:${esc(first.t.id)}" aria-label="${esc(lbl)}, ${esc(when(first.t.date))}">` +
      `<span class="pl-cd-emo" aria-hidden="true">${esc(first.emoji)}</span>` +
      `<span class="pl-cd-txt"><span class="pl-cd-k">Countdown${first.days > 0 ? " · noch" : ""}</span>` +
        `<span class="pl-cd-num"><b>${big}</b> <small>${unit}</small></span>` +
        `<span class="pl-cd-t">${esc(first.t.title)}</span><span class="pl-cd-d">${esc(when(first.t.date))}${first.t.time ? " · " + esc(first.t.time) : ""}</span></span>` +
    `</button>` +
    (rest.length ? `<ul class="pl-cd-more">${rest.slice(0, 4).map((c) =>
      `<li><button type="button" data-popen="todo:${esc(c.t.id)}"><span aria-hidden="true">${esc(c.emoji)}</span><b>${esc(c.t.title)}</b><span class="pl-cd-pill">${esc(c.days === 1 ? "morgen" : c.days <= 0 ? "heute" : "noch " + c.days + " Tage")}</span></button></li>`).join("")}</ul>` : "") +
  `</section>`;
}

/* ---------- Geburtstage ---------- */

export function birthdaysHTML(todos, tKey, showAll) {
  const all = upcomingBirthdays(todos, tKey);
  const list = showAll ? all : all.slice(0, BDAYS_SHOW);
  const rows = list.map(({ t, key, days, age }) => {
    const d = dateOf(key);
    const pill = days === 0 ? "Heute 🎉" : days === 1 ? "Morgen" : `in ${days} Tagen`;
    const meta = `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${d.getFullYear() !== dateOf(tKey).getFullYear() ? " " + d.getFullYear() : ""}${age != null ? ` · wird ${age}` : ""}`;
    return `<li><button type="button" class="pl-bd${days === 0 ? " is-today" : ""}" data-popen="bday:${esc(t.id)}" aria-label="${esc(t.title)}: ${esc(meta)}, ${esc(pill)}">` +
      `<span class="pl-bd-i" aria-hidden="true">🎂</span><span class="pl-bd-m"><b>${esc(t.title)}</b><span>${esc(meta)}</span></span>` +
      `<span class="pl-bd-pill">${esc(pill)}</span></button></li>`;
  }).join("");
  return `<section class="ag-sec pl-bds"><h3 class="ag-h">Geburtstage${all.length ? ` <span class="ag-count">${all.length}</span>` : ""}` +
    `<button type="button" class="btn sm ghost pl-bd-add" data-pnew="geburtstag">+ Geburtstag</button></h3>` +
    (all.length ? `<ul class="pl-bd-list">${rows}</ul>` +
      (all.length > BDAYS_SHOW ? `<button type="button" class="btn sm ghost pl-bd-all" data-pact="bdall">${showAll ? "Weniger anzeigen" : `Alle anzeigen (${all.length})`}</button>` : "")
      : `<p class="note ag-none">Noch keine Geburtstage. Trag Familie und Freunde ein – du wirst rechtzeitig erinnert.</p>`) +
  `</section>`;
}

/* ---------- Gemeinsame Bausteine ---------- */

/** Farbpunkte für die Typen eines Tages. */
export function dotsHTML(types) {
  if (!types || !types.size) return `<span class="pl-dots" aria-hidden="true"></span>`;
  return `<span class="pl-dots" aria-hidden="true">${DOT_ORDER.filter((t) => types.has(t)).map((t) => `<i class="pl-t-${t}"></i>`).join("")}</span>`;
}
export function typesText(types) {
  return DOT_ORDER.filter((t) => types && types.has(t)).map((t) => TYPES[t].label).join(", ");
}

function styleOf(it) { return it.hue != null ? ` style="--h:${it.hue}"` : ""; }
function typeCls(it) { return `pl-t-${it.type}${it.cls ? " " + it.cls : ""}`; }

function chipHTML(it) {
  return `<div class="pl-ad ${typeCls(it)}${it.done ? " done" : ""}"${styleOf(it)}>` +
    (it.check ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
    (it.open ? `<button type="button" class="pl-ad-m" data-popen="${esc(it.open)}">` : `<span class="pl-ad-m">`) +
    `<span aria-hidden="true">${it.emoji}</span><b>${esc(it.title)}</b><span class="pl-ad-s">${esc(it.sub)}</span>` +
    (it.open ? `</button>` : `</span>`) + `</div>`;
}

function blockHTML(it, H, compact) {
  const top = (it.start / 60) * H;
  const h = Math.max(compact ? 18 : 26, ((it.end - it.start) / 60) * H - 2);
  const w = 100 / (it.cols || 1);
  const style = `top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;left:calc(${(w * (it.col || 0)).toFixed(3)}% + 1px);width:calc(${w.toFixed(3)}% - 3px);${it.hue != null ? `--h:${it.hue};` : ""}`;
  const tiny = h < 34;
  const lbl = `${TYPES[it.type] ? TYPES[it.type].label : ""}: ${it.title}, ${it.sub}${it.done ? ", erledigt" : ""}`;
  return `<div class="pl-blk ${typeCls(it)}${it.done ? " done" : ""}${tiny ? " tiny" : ""}${it.running ? " run" : ""}" style="${style}">` +
    (it.open ? `<button type="button" class="pl-blk-m" data-popen="${esc(it.open)}" aria-label="${esc(lbl)}">` : `<div class="pl-blk-m" role="img" aria-label="${esc(lbl)}">`) +
      `<span class="pl-blk-t"><span class="pl-blk-e" aria-hidden="true">${it.emoji}</span>${esc(it.title)}</span>` +
      (compact || tiny ? "" : `<span class="pl-blk-s">${esc(it.sub)}</span>`) +
    (it.open ? `</button>` : `</div>`) +
    (it.check && !compact ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
  `</div>`;
}

function slotsHTML(day, H, focusable) {
  let s = "";
  for (let h = 0; h < 24; h++) {
    s += `<button type="button" class="pl-slot" data-pslot="${day}" data-h="${h}" style="top:${h * H}px;height:${H}px"${focusable ? "" : ` tabindex="-1"`} aria-label="Termin am ${esc(dayLong(day))} um ${h}:00 anlegen"></button>`;
  }
  return s;
}

function nowLineHTML(H) {
  const m = nowMin();
  return `<div class="pl-now" data-pnow style="top:${((m / 60) * H).toFixed(1)}px" aria-hidden="true"><span>Jetzt ${hhmm(m)}</span></div>`;
}

function hoursHTML(H) {
  let s = "";
  for (let h = 0; h < 24; h++) s += `<div class="pl-hr" style="top:${h * H}px;height:${H}px"><span>${h ? pad(h) + ":00" : ""}</span></div>`;
  return `<div class="pl-hours" aria-hidden="true">${s}</div>`;
}

export function dayLong(k) {
  const d = dateOf(k);
  return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
}

function navHTML(title, sub, isNow, label) {
  return `<div class="pl-nav">` +
    `<button type="button" class="icon-btn ag-mnav" data-pnav="-1" aria-label="${label} zurück">${icon("chevron-left", 20)}</button>` +
    `<div class="pl-nav-t"><b class="ag-mname">${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>` +
    `<button type="button" class="btn sm ghost ez-today" data-pnav="0"${isNow ? " disabled" : ""}>Heute</button>` +
    `<button type="button" class="icon-btn ag-mnav" data-pnav="1" aria-label="${label} weiter">${icon("chevron-right", 20)}</button>` +
  `</div>`;
}

/* ---------- Tag ---------- */

export function dayViewHTML(snap, day, deps) {
  const idx = buildIndex(snap, day, day, deps);
  const d = idx.get(day);
  const tK = todayKey();
  const timed = layoutColumns(d.timed);
  const rel = day === tK ? "Heute" : day === addDays(tK, 1) ? "Morgen" : day === addDays(tK, -1) ? "Gestern" : "";
  const n = d.allDay.length + d.timed.length;
  const dd0 = dateOf(day);
  const navT = `${WD[dd0.getDay()]}, ${dd0.getDate()}. ${MONTHS[dd0.getMonth()]}${dd0.getFullYear() !== new Date().getFullYear() ? " " + dd0.getFullYear() : ""}`;
  return navHTML(navT, rel ? `${rel} · ${n ? n + (n === 1 ? " Eintrag" : " Einträge") : "nichts geplant"}` : (n ? `${n} ${n === 1 ? "Eintrag" : "Einträge"}` : "nichts geplant"), day === tK, "Tag") +
    (d.allDay.length ? `<div class="pl-allday" aria-label="Ganztägig">${d.allDay.map(chipHTML).join("")}</div>` : "") +
    `<div class="pl-tl-scroll" data-pscroll="day" tabindex="-1">` +
      `<div class="pl-tl" style="height:${24 * H_DAY}px">${hoursHTML(H_DAY)}` +
        `<div class="pl-cols"><div class="pl-col${day === tK ? " today" : ""}" data-pcol="${day}">` +
          slotsHTML(day, H_DAY, true) + timed.map((it) => blockHTML(it, H_DAY, false)).join("") +
          (day === tK ? nowLineHTML(H_DAY) : "") +
        `</div></div>` +
      `</div>` +
    `</div>` +
    `<p class="note pl-tip">Tippe auf eine freie Stelle, um dort einen Termin anzulegen. Wischen wechselt den Tag.</p>`;
}

/* ---------- Woche ---------- */

export function weekViewHTML(snap, anyDay, deps) {
  const mon = mondayOf(anyDay);
  const sun = addDays(mon, 6);
  const idx = buildIndex(snap, mon, sun, deps);
  const tK = todayKey();
  const dm = dateOf(mon), ds = dateOf(sun);
  const kw = isoWeek(dm);
  const title = dm.getMonth() === ds.getMonth()
    ? `${dm.getDate()}.–${ds.getDate()}. ${MONTHS[ds.getMonth()]}`
    : `${dm.getDate()}. ${MONTHS[dm.getMonth()].slice(0, 3)} – ${ds.getDate()}. ${MONTHS[ds.getMonth()].slice(0, 3)}`;
  let head = "", allday = "", cols = "";
  let anyAll = false;
  for (let i = 0; i < 7; i++) {
    const k = addDays(mon, i);
    const d = idx.get(k);
    const dd = dateOf(k);
    head += `<button type="button" class="pl-wh${k === tK ? " today" : ""}${i >= 5 ? " we" : ""}" data-pday="${k}" aria-label="${esc(dayLong(k))} öffnen${d.types.size ? " – " + esc(typesText(d.types)) : ""}">` +
      `<span>${WD_MO[i]}</span><b>${dd.getDate()}</b>${dotsHTML(d.types)}</button>`;
    if (d.allDay.length) anyAll = true;
    allday += `<div class="pl-wad">${d.allDay.slice(0, 3).map((it) =>
      `<button type="button" class="pl-wad-i ${typeCls(it)}"${styleOf(it)} ${it.open ? `data-popen="${esc(it.open)}"` : `data-pday="${k}"`} aria-label="${esc(it.sub + ": " + it.title)}"><span aria-hidden="true">${it.emoji}</span>${esc(it.title)}</button>`).join("")}` +
      (d.allDay.length > 3 ? `<button type="button" class="pl-wad-more" data-pday="${k}">+${d.allDay.length - 3}</button>` : "") + `</div>`;
    const timed = layoutColumns(d.timed);
    cols += `<div class="pl-col${k === tK ? " today" : ""}${i >= 5 ? " we" : ""}" data-pcol="${k}">` + slotsHTML(k, H_WEEK, false) +
      timed.map((it) => blockHTML(it, H_WEEK, true)).join("") + (k === tK ? nowLineHTML(H_WEEK) : "") + `</div>`;
  }
  return navHTML(title, `KW ${kw} · ${ds.getFullYear()}`, tK >= mon && tK <= sun, "Woche") +
    `<div class="pl-week">` +
      `<div class="pl-wrow pl-whead"><div class="pl-gut"></div>${head}</div>` +
      (anyAll ? `<div class="pl-wrow pl-walld"><div class="pl-gut"><span>ganzt.</span></div>${allday}</div>` : "") +
      `<div class="pl-tl-scroll" data-pscroll="week" tabindex="-1"><div class="pl-tl" style="height:${24 * H_WEEK}px">${hoursHTML(H_WEEK)}<div class="pl-cols">${cols}</div></div></div>` +
    `</div>` +
    `<p class="note pl-tip">Tag oben antippen öffnet die Tagesansicht. Freie Stelle antippen legt einen Termin an.</p>`;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/* ---------- Monat ---------- */

export function monthViewHTML(snap, ym, sel, deps) {
  const { y, m } = ym;
  const first = `${y}-${pad(m + 1)}-01`;
  const n = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${pad(m + 1)}-${pad(n)}`;
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const from = addDays(first, -lead);
  const cellsN = Math.ceil((lead + n) / 7) * 7;
  const to = addDays(from, cellsN - 1);
  const idx = buildIndex(snap, from, to, deps);
  const tK = todayKey();
  let cells = WD_MO.map((w, i) => `<div class="ez-wh${i >= 5 ? " we" : ""}" aria-hidden="true">${w}</div>`).join("");
  for (let i = 0; i < cellsN; i++) {
    const k = addDays(from, i);
    const d = idx.get(k);
    const inM = k >= first && k <= last;
    const dd = dateOf(k);
    const hol = d.types.has("feiertag");
    const cls = ["pl-mc"];
    if (!inM) cls.push("out");
    if (k === tK) cls.push("today");
    if (i % 7 >= 5) cls.push("we");
    if (hol) cls.push("hol");
    const n2 = d.allDay.length + d.timed.length;
    const lbl = `${dayLong(k)}${d.types.size ? " – " + typesText(d.types) : ""}${n2 ? `, ${n2} ${n2 === 1 ? "Eintrag" : "Einträge"}` : ""}`;
    cells += `<button type="button" class="${cls.join(" ")}" data-psel="${k}" aria-pressed="${k === sel}" aria-label="${esc(lbl)}">` +
      `<span class="pl-mc-n">${dd.getDate()}</span>${dotsHTML(d.types)}</button>`;
  }
  const isCur = (() => { const d = new Date(); return d.getFullYear() === y && d.getMonth() === m; })();
  const legend = DOT_ORDER.map((t) => `<span><i class="pl-t-${t}"></i>${TYPES[t].label}</span>`).join("");
  let selHTML = "";
  if (sel && idx.has(sel)) selHTML = scheduleHTML(sel, idx.get(sel));
  else if (sel) selHTML = scheduleHTML(sel, buildIndex(snap, sel, sel, deps).get(sel));
  return navHTML(`${MONTHS_DE[m]} ${y}`, "", isCur, "Monat") +
    `<div class="ez-grid pl-mgrid">${cells}</div>` +
    `<div class="pl-legend" aria-label="Legende">${legend}</div>` +
    selHTML;
}

/** Tagesliste mit Symbolen (Zeitleiste). */
export function scheduleHTML(k, d) {
  const items = [...d.allDay, ...d.timed];
  const body = items.length
    ? `<ol class="pl-sched">${items.map((it) =>
      `<li class="${typeCls(it)}${it.done ? " done" : ""}"${styleOf(it)}><span class="pl-sched-i" aria-hidden="true">${it.emoji}</span>` +
      `<span class="pl-sched-time">${it.start != null ? hhmm(it.start) : "ganzt."}</span>` +
      (it.open ? `<button type="button" class="pl-sched-m" data-popen="${esc(it.open)}">` : `<span class="pl-sched-m">`) +
      `<b>${esc(it.title)}</b><span>${esc(it.sub)}</span>` + (it.open ? `</button>` : `</span>`) +
      (it.check ? `<button type="button" class="pl-chk" data-pcheck="${esc(it.check)}" aria-pressed="${it.done}" aria-label="${it.done ? "Wieder offen" : "Erledigt"}: ${esc(it.title)}">${icon("check", 14)}</button>` : "") +
      `</li>`).join("")}</ol>`
    : `<p class="note ag-none">Nichts geplant.</p>`;
  return `<div class="pl-selday"><div class="pl-selh"><b>${esc(dayLong(k))}</b>` +
    `<button type="button" class="btn sm ghost" data-pday="${k}">Tag öffnen</button></div>${body}</div>`;
}

/* ---------- Zeitleiste scrollen / Jetzt-Linie ---------- */

/** Scrollt auf ca. 6:00 – ist „jetzt“ weiter unten, so dass die Jetzt-Linie sichtbar bleibt. */
export function scrollToMorning(sc, H, showsToday) {
  if (!sc) return;
  let target = 6 * H - 8;
  if (showsToday) {
    const nowY = (nowMin() / 60) * H;
    if (nowY > target + sc.clientHeight - H) target = nowY - 2 * H;
  }
  sc.scrollTop = Math.max(0, target);
}

/** Jetzt-Linie ohne Neuzeichnen verschieben. */
export function moveNowLine(root) {
  const m = nowMin();
  root.querySelectorAll("[data-pnow]").forEach((el) => {
    const sc = el.closest("[data-pscroll]");
    const H = (sc && Number(sc.dataset.h)) || (el.closest("[data-pscroll=week]") ? H_WEEK : H_DAY);
    el.style.top = `${((m / 60) * H).toFixed(1)}px`;
    const s = el.querySelector("span");
    if (s) s.textContent = `Jetzt ${hhmm(m)}`;
  });
}

/* ---------- Wischen ---------- */

export function attachSwipe(el, onSwipe) {
  let x0 = 0, y0 = 0, t0 = 0, on = false;
  el.addEventListener("touchstart", (ev) => {
    if (ev.touches.length !== 1) { on = false; return; }
    const t = ev.touches[0];
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); on = true;
  }, { passive: true });
  el.addEventListener("touchend", (ev) => {
    if (!on) return;
    on = false;
    const t = ev.changedTouches[0];
    const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy) && Date.now() - t0 < 800) onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
  el.addEventListener("touchcancel", () => { on = false; }, { passive: true });
}

/* ---------- Formular „Geburtstag“ ---------- */

const RDAYS = [[0, "Am Tag selbst"], [1, "1 Tag vorher"], [2, "2 Tage vorher"], [3, "3 Tage vorher"], [7, "1 Woche vorher"], [14, "2 Wochen vorher"]];

export function openBirthdayForm(todo, c, preset = null) {
  const isNew = !todo;
  const b = todo ? parseBday(todo) : null;
  const pre = preset || {};
  let pm = b ? b.m : null, pd = b ? b.d : null;
  if (!b && /^\d{4}-\d{2}-\d{2}$/.test(String(pre.date || ""))) { const p = pre.date.split("-").map(Number); pm = p[1]; pd = p[2]; }
  const rd = todo && Number.isFinite(Number(todo.remindDays)) ? Number(todo.remindDays) : 1;
  const rdOpts = RDAYS.some(([v]) => v === rd) ? RDAYS : [...RDAYS, [rd, `${rd} Tage vorher`]].sort((a, z) => a[0] - z[0]);
  const remind = todo ? !!todo.remind : true;
  const rtime = todo && /^\d{1,2}:\d{2}$/.test(String(todo.time || "")) ? String(todo.time).padStart(5, "0") : "09:00";
  const bodyHTML =
    `<div class="fields ag-form pl-bform">` +
      `<label>Name<input type="text" data-r="name" maxlength="80" enterkeyhint="next" placeholder="z. B. Oma Hilde" value="${esc(todo ? todo.title : "")}"></label>` +
      `<div class="row pl-bdate">` +
        `<label>Tag<select data-r="d"><option value="">–</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${pd === i + 1 ? " selected" : ""}>${i + 1}.</option>`).join("")}</select></label>` +
        `<label>Monat<select data-r="m"><option value="">–</option>${MONTHS.map((n, i) => `<option value="${i + 1}"${pm === i + 1 ? " selected" : ""}>${n}</option>`).join("")}</select></label>` +
        `<label>Jahr <small>(optional)</small><input type="number" inputmode="numeric" data-r="y" min="1900" max="${new Date().getFullYear()}" placeholder="z. B. 2008" value="${b && b.y ? b.y : ""}"></label>` +
      `</div>` +
      `<p class="hint" data-r="age" hidden></p>` +
      `<div class="ag-rem">` +
        `<label class="switch"><input type="checkbox" data-r="remind"${remind ? " checked" : ""}><span>${typeIcon("erinnerung", 18)} Erinnern</span></label>` +
        `<div class="row pl-brem" data-r="remwrap"><label>Wann?<select data-r="rd">${rdOpts.map(([v, l]) => `<option value="${v}"${v === rd ? " selected" : ""}>${l}</option>`).join("")}</select></label>` +
        `<label>Uhrzeit<input type="time" data-r="rt" step="300" value="${rtime}"></label></div>` +
      `</div>` +
      `<label>Notiz<textarea data-r="note" rows="2" placeholder="optional, z. B. Geschenkidee">${esc(todo ? todo.note || "" : "")}</textarea></label>` +
    `</div>` +
    `<div class="stack" style="margin-top:14px"><button type="button" class="btn primary" data-r="save">Speichern</button>` +
      (isNew ? "" : `<button type="button" class="btn danger" data-r="del">Löschen</button>`) + `</div>`;

  return c.ui.openSheet({
    title: isNew ? "Neuer Geburtstag" : `Geburtstag: ${todo.title || ""}`,
    bodyHTML,
    onMount(sheet, close) {
      const $ = (r) => sheet.querySelector(`[data-r="${r}"]`);
      const read = () => {
        const d = Number($("d").value), m = Number($("m").value);
        const y = Number($("y").value);
        return { d, m, y: Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear() ? y : null };
      };
      const draw = () => {
        $("remwrap").hidden = !$("remind").checked;
        const v = read();
        const el = $("age");
        if (v.d && v.m) {
          const n = nextBday({ kind: "geburtstag", bday: `${pad(v.m)}-${pad(v.d)}`, byear: v.y });
          el.textContent = n ? `Nächster Geburtstag: ${dayLong(n.key)}${n.days === 0 ? " (heute)" : n.days === 1 ? " (morgen)" : ` (in ${n.days} Tagen)`}${n.age != null ? ` – wird ${n.age}` : ""}` : "";
          el.hidden = !n;
        } else el.hidden = true;
      };
      draw();
      ["d", "m", "y"].forEach((r) => $(r).addEventListener("input", draw));
      $("remind").addEventListener("change", draw);
      if (isNew) setTimeout(() => { try { $("name").focus(); } catch { /* egal */ } }, 60);
      const save = $("save");
      save.addEventListener("click", async () => {
        const name = $("name").value.trim();
        const v = read();
        if (!name) { c.ui.toast("Bitte einen Namen eingeben."); $("name").focus(); return; }
        if (!v.d || !v.m) { c.ui.toast("Bitte Tag und Monat wählen."); return; }
        if (v.d > new Date(2024, v.m, 0).getDate()) { c.ui.toast("Dieses Datum gibt es nicht."); return; }
        const rt = /^\d{1,2}:\d{2}$/.test($("rt").value) ? $("rt").value : "09:00";
        const data = {
          ...(todo || {}),
          kind: "geburtstag", title: name, bday: `${pad(v.m)}-${pad(v.d)}`, byear: v.y,
          date: null, time: rt, remind: $("remind").checked, remindDays: Number($("rd").value) || 0, remindMin: 0,
          note: $("note").value.trim(), done: false, doneAt: null,
        };
        c.ui.setBusy(save, true, "Speichert …");
        try { await c.store.saveTodo(data); close(); c.ui.toast(isNew ? "Geburtstag gespeichert 🎂" : "Gespeichert", 1800); } catch { c.ui.setBusy(save, false); }
      });
      const del = $("del");
      if (del) c.ui.confirmButton(del, "Wirklich löschen?", async () => {
        try { await c.store.deleteTodo(todo.id); close(); c.ui.toast("Gelöscht."); } catch { /* Toast vom Store */ }
      });
    },
  });
}

function nextBday(t) {
  const tK = todayKey();
  const list = upcomingBirthdays([t], tK);
  return list[0] || null;
}

export { CATS, daysBetween, toMin };
