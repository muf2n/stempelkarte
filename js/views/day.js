// Update 7 (Agent Q): Karte „Mein Tag“ oben im Reiter Heute – Datum + Hinweis, Arbeitszeit, Schritte,
// Höhenmeter (Uhr), nächster Termin + offene To-dos, kleine Wochenleiste (Mo–So).
// Wendet außerdem „Einfacher bedienen“ (settings.comfort) auf <html> an.
import { icon } from "../icons.js";
import { plansToday } from "./plans.js";
import { einsatzFor } from "../einsatz.js";
import { showEinsatzplan } from "./agenda.js";
import { mountDayStrip, openDayPhotos } from "./gallery.js"; // Update 9 – Fotos

/** Update 9: Fotos eines Tages als Blatt (mit Tag vor/zurück). */
export function openDayPhotoSheet(dayKey, c) { openDayPhotos(dayKey, c || ctx); }

const COMFORT_KEY = "stempelkarte.comfort";
const WD_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAYS_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

let ctx = null;
let root = null;
let snap = null;
let lastKey = "";
let photoStrip = null; // Update 9 – Fotos von heute

/* ---------------- Einfacher bedienen ---------------- */

/** settings.comfort mit Standardwerten. */
export function readComfort(settings) {
  const c = (settings && settings.comfort) || {};
  return { bigText: c.bigText === true, compact: c.compact === true };
}

/** Schalter auf <html> setzen (data-big / data-compact) und für den nächsten Start merken. */
export function applyComfort(c) {
  const de = document.documentElement;
  if (c.bigText) de.dataset.big = "1"; else delete de.dataset.big;
  if (c.compact) de.dataset.compact = "1"; else delete de.dataset.compact;
  try { localStorage.setItem(COMFORT_KEY, JSON.stringify(c)); } catch { /* egal */ }
}

// Sofort beim Laden (vor dem ersten Snapshot) den zuletzt bekannten Stand anwenden – kein Springen.
try {
  const c = JSON.parse(localStorage.getItem(COMFORT_KEY) || "null");
  if (c && typeof c === "object") applyComfort(readComfort({ comfort: c }));
} catch { /* egal */ }

/* ---------------- Hilfen ---------------- */

function util() { return ctx.util; }
function settings() { return (snap && snap.settings) || {}; }
function todos() { return (snap && Array.isArray(snap.todos)) ? snap.todos : []; }
function days() { return (snap && snap.days && typeof snap.days === "object") ? snap.days : {}; }

function credit(e) {
  const u = util();
  if (u.creditMin) return u.creditMin(e);
  return (!e.kind || e.kind === "work") ? u.netMin(e) : (Number(e.creditMin) || 0);
}

/** Erfasste Minuten je Tag (dayKey → Minuten) im Bereich [from, to). Laufende Schicht zählt mit. */
function minutesByDay(from, to) {
  const u = util();
  const out = {};
  for (const e of (snap && snap.entries) || []) {
    if (!(e.start >= from && e.start < to)) continue;
    const k = u.dayKey(e.start);
    out[k] = (out[k] || 0) + credit(e);
  }
  const r = snap && snap.running;
  if (r && r.start >= from && r.start < to) {
    const k = u.dayKey(r.start);
    let ms = 0;
    try { ms = ctx.timer.netMs(r); } catch { ms = 0; }
    out[k] = (out[k] || 0) + ms / 60000;
  }
  return out;
}

function num(v) { return Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null; }
function fmtInt(n) { return Math.round(n).toLocaleString("de-AT"); }

/** Wurde die Uhr schon einmal verbunden/abgeglichen? (Daten von Agent P, mit Fallback) */
function watchEverUsed() {
  if (Object.keys(days()).length) return true;
  const w = settings().watch;
  if (w && (w.lastSync || w.deviceId || w.paired || w.connected)) return true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (/watch|bangle/i.test(k)) return true;
    }
  } catch { /* egal */ }
  return false;
}

/** Hinweis zum heutigen Tag: Feiertag, Berufsschule oder geplante Schicht. */
function dayHint(now) {
  const u = util();
  const s = settings();
  if (s.holidays !== false && u.holidayName) {
    try { const h = u.holidayName(now); if (h) return { kind: "hol", text: `Feiertag: ${h}` }; } catch { /* egal */ }
  }
  if (u.schoolLabel) {
    try { const sc = u.schoolLabel(now, s); if (sc) return { kind: "school", text: sc }; } catch { /* egal */ }
  }
  let plans = [];
  try { plans = plansToday(snap, u, now); } catch { plans = []; }
  if (plans.length) {
    const p = plans.slice().sort((a, b) => String(a.time).localeCompare(String(b.time)))[0];
    return { kind: "plan", text: `Geplant ab ${p.time}${p.activity && p.activity !== "Arbeiten" ? " · " + p.activity : ""}` };
  }
  return null;
}

/** Nächster offener Termin (ab jetzt) und Zahl der offenen Aufgaben. */
function agendaInfo(now) {
  const u = util();
  const today = u.dayKey(now);
  const nowHM = u.clock(now);
  const open = todos().filter((t) => t && !t.done && t.kind !== "einsatz");
  const termine = open.filter((t) => t.kind === "termin" && t.date &&
    (t.date > today || (t.date === today && (!t.time || t.time >= nowHM))));
  termine.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const next = termine[0] || null;
  const openTodos = open.filter((t) => t.kind !== "termin").length;
  let when = "";
  if (next) {
    if (next.date === today) when = next.time ? next.time : "heute";
    else {
      const [y, m, d] = next.date.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const tomorrow = u.dayKey(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + 1));
      const dayTxt = next.date === tomorrow ? "morgen" : `${u.WD[dt.getDay()]} ${u.pad(d)}.${u.pad(m)}.`;
      when = dayTxt + (next.time ? " " + next.time : "");
    }
  }
  return { next, when, openTodos };
}

/** Heutiger Einsatz laut Einsatzplan: { place, people } oder null. */
function einsatzInfo(todayK) {
  let e = null;
  try { e = einsatzFor(todayK, todos()); } catch { e = null; }
  if (!e) return null;
  const p = e.placeId ? ((snap && snap.places) || []).find((x) => x.id === e.placeId) : null;
  const place = String((p && p.name) || e.place || e.title || "").trim() || "Einsatz";
  return { place, people: Array.isArray(e.people) ? e.people.filter(Boolean) : [] };
}

/* ---------------- Markup ---------------- */

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  root.classList.add("card", "myday");
  root.setAttribute("aria-label", "Mein Tag");
  root.innerHTML = `
    <div class="md-head">
      <div class="md-title"><span class="md-ico">${icon("sun", 18)}</span><span class="md-h">Mein Tag</span><span class="md-date" data-md="date"></span></div>
      <div class="md-hint" data-md="hint" hidden></div>
    </div>
    <button type="button" class="md-ez" data-md="ez" data-md-ez="1" hidden></button>
    <div class="md-tiles" data-md="tiles"></div>
    <div data-md="photos" hidden></div>
    <div class="md-watch" data-md="watch" hidden></div>
    <div class="md-week" data-md="week" aria-label="Diese Woche"></div>`;
  root.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-md-ez]")) {
      try { showEinsatzplan(); } catch { /* egal */ }
      ctx.go("agenda");
      return;
    }
    const b = ev.target.closest("[data-md-go]");
    if (b) ctx.go(b.dataset.mdGo);
  });
  try { photoStrip = mountDayStrip(root.querySelector('[data-md="photos"]'), ctx); } catch (e) { console.error(e); }
}

export function update(s) {
  snap = s;
  if (snap && snap.settings) applyComfort(readComfort(snap.settings));
  render();
}

/** Sekundentakt (vom Reiter Heute): nur neu zeichnen, wenn sich die Anzeige ändert. */
export function tick() { render(); }

function render() {
  if (!root || !ctx || !snap) return;
  const u = util();
  const now = Date.now();
  const d = new Date(now);
  const todayK = u.dayKey(now);
  const wk = u.startOfWeek(now);
  const wkFrom = wk.getTime();
  const wkTo = new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + 7).getTime();
  const mins = minutesByDay(wkFrom, wkTo);
  const dv = days()[todayK] || null;
  const steps = dv ? num(dv.steps) : null;
  const up = dv ? num(dv.altUp) : null;
  const hint = dayHint(now);
  const ag = agendaInfo(now);
  const workMin = Math.floor(mins[todayK] || 0);
  const showWatchHint = steps === null && up === null && !watchEverUsed();
  const ez = einsatzInfo(todayK);
  try { if (photoStrip) photoStrip.update(todayK, snap); } catch (e) { console.error(e); }

  // Wochenleiste
  const week = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + i);
    const k = u.dayKey(dt);
    const dd = days()[k];
    week.push({ k, label: WD_SHORT[i], min: Math.floor(mins[k] || 0), steps: dd ? num(dd.steps) : null, today: k === todayK, future: k > todayK });
  }

  const key = JSON.stringify([todayK, hint, workMin, steps, up, ag.when, ag.next && ag.next.title, ag.openTodos, showWatchHint, week, ez]);
  if (key === lastKey) return;
  lastKey = key;

  root.querySelector('[data-md="date"]').textContent = `${DAYS_LONG[d.getDay()]}, ${d.getDate()}. ${u.MONTHS[d.getMonth()]}`;
  const hEl = root.querySelector('[data-md="hint"]');
  hEl.hidden = !hint;
  hEl.className = "md-hint" + (hint ? " md-hint-" + hint.kind : "");
  hEl.textContent = hint ? hint.text : "";

  const ezEl = root.querySelector('[data-md="ez"]');
  ezEl.hidden = !ez;
  ezEl.innerHTML = ez
    ? `<span class="md-ez-ico">${icon("pin", 16)}</span><span class="md-ez-t"><b>Heute: ${u.esc(ez.place)}</b>` +
      `${ez.people.length ? ` · mit ${u.esc(ez.people.join(", "))}` : ""}</span>`
    : "";
  if (ez) ezEl.setAttribute("aria-label", `Einsatzplan öffnen: heute ${ez.place}${ez.people.length ? " mit " + ez.people.join(", ") : ""}`);

  const dash = `<span class="md-none">–</span>`;
  // Wert: Uhrzeit (sonst Tag); Unterzeile: Tag + Titel
  const agTime = ag.next && ag.next.time ? ag.next.time : "";
  const agDay = ag.next ? (agTime ? ag.when.slice(0, -agTime.length).trim() : ag.when) : "";
  const agVal = ag.next ? u.esc(agTime || agDay) : (ag.openTodos ? String(ag.openTodos) : "–");
  const agSub = ag.next
    ? `${agTime && agDay ? u.esc(agDay) + " · " : ""}${u.esc(ag.next.title || "Termin")}${ag.openTodos ? ` · ${ag.openTodos} offen` : ""}`
    : (ag.openTodos ? (ag.openTodos === 1 ? "Aufgabe offen" : "Aufgaben offen") : "nichts offen");
  root.querySelector('[data-md="tiles"]').innerHTML =
    `<div class="md-tile md-t-work"><span class="md-l">Arbeit</span><strong>${u.hm(workMin)}<small> h</small></strong></div>` +
    `<div class="md-tile md-t-steps"><span class="md-l">Schritte</span><strong>${steps === null ? dash : fmtInt(steps)}</strong></div>` +
    `<div class="md-tile md-t-alt"><span class="md-l" title="Höhenmeter aufwärts">Höhe</span><strong>${up === null ? dash : `↑${fmtInt(up)}<small> m</small>`}</strong></div>` +
    `<button type="button" class="md-tile md-t-agenda" data-md-go="agenda" aria-label="Planer öffnen: ${ag.next ? "nächster Termin " + u.esc(ag.when) + " " + u.esc(ag.next.title || "") : "keine Termine"}, ${ag.openTodos} Aufgaben offen">` +
    `<span class="md-l">${ag.next ? "Termin" : "To-dos"}</span><strong class="md-ag">${agVal}</strong><span class="md-sub">${agSub}</span></button>`;

  const wEl = root.querySelector('[data-md="watch"]');
  wEl.hidden = !showWatchHint;
  wEl.textContent = showWatchHint ? "Schritte und Höhenmeter: mit Uhr verbinden (Übersicht → Einstellungen)" : "";

  const maxMin = Math.max(60, ...week.map((x) => x.min));
  const maxSteps = Math.max(1, ...week.map((x) => x.steps || 0));
  const anySteps = week.some((x) => x.steps);
  root.querySelector('[data-md="week"]').innerHTML = week.map((x) => {
    const hp = Math.round((x.min / maxMin) * 100);
    const sp = x.steps ? Math.round((x.steps / maxSteps) * 100) : 0;
    const title = `${x.label}: ${u.hm(x.min)} h${x.steps ? `, ${fmtInt(x.steps)} Schritte` : ""}`;
    return `<div class="md-day${x.today ? " is-today" : ""}${x.future ? " is-future" : ""}" title="${u.esc(title)}" aria-label="${u.esc(title)}">` +
      `<div class="md-bars"><i class="md-b-h" style="height:${x.min ? Math.max(6, hp) : 0}%"></i>` +
      (anySteps ? `<i class="md-b-s" style="height:${x.steps ? Math.max(6, sp) : 0}%"></i>` : "") + `</div>` +
      `<span class="md-wd">${x.label}</span></div>`;
  }).join("") +
    `<div class="md-legend"><span><i class="md-b-h"></i>Stunden</span>${anySteps ? `<span><i class="md-b-s"></i>Schritte</span>` : ""}</div>`;
}
