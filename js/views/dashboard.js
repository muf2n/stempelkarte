// Update 10b – Smart Dashboard im Reiter Heute (unter der Stempelkarte).
// Kompakte Widgets aus ECHTEN Daten (keine Beispieldaten): Überstunden, Termine/Aufgaben, nächste Tage, Baustelle + Material,
// Finanzen (respektiert die Geld-Sperre), Schule, Erinnerungen, Sync-Status, Tipp (regelbasiert, keine KI).
// Reihenfolge je Kontext (js/dashboard-core.js), „✏️ Anpassen“: ein/aus, hoch/runter, „Automatisch sortieren“.
// Gespeichert über store.saveSettings({ dashboard: { order, hidden, auto } }).
// Alltag-Sammlungen (Material, Geld, Schule) werden erst abonniert, wenn ihr Widget sichtbar ist.
import * as D from "../dashboard-core.js";
import { buildIndex, upcomingBirthdays, countdowns, countdownText } from "../planer-core.js";
import { nextInstance } from "../cal-core.js";
import { einsatzFor } from "../einsatz.js";
import { balanceSummary } from "./overview.js";
import { collection } from "../alltag/db.js";
import * as MAT from "../alltag/material-core.js";
import * as WRC from "../weekreport-core.js"; // Update 10 – Wochenbericht-Tipp
import * as MON from "../alltag/money-core.js";
import * as WZ from "../alltag/werkzeug-core.js"; // Update 10 – fällige Prüfungen
import * as FZ from "../alltag/fahrzeug-core.js"; // Update 10 – Pickerl/Service/Versicherung
import { readVehicles, defaultVehicle } from "../trip-core.js";
import * as lockState from "../alltag/money-lock-state.js";

let ctx = null;
let root = null;
let snap = null;
let editing = false;
let queued = false;
let lastSig = "";
const subs = new Map();   // Sammlungsname → Abmelde-Funktion
const data = new Map();   // Sammlungsname → Array

// Widget → benötigte Alltag-Sammlungen
const NEEDS = {
  site: ["material_items"],
  money: ["money_tx", "money_budget"],
  school: ["school_exams", "school_tasks"],
  tip: ["school_exams"],
  einkauf: ["einkauf", "material_items"], // Update 10 – Einkaufsliste
  faellig: ["werkzeug", "fahrzeug_info", "travel_fuel"], // Update 10 – Werkzeug & Fahrzeuge
};

function u() { return ctx.util; }
const esc = (s) => u().esc(s);
function settings() { return (snap && snap.settings) || {}; }
function todos() { return (snap && Array.isArray(snap.todos)) ? snap.todos : []; }
function places() { return (snap && snap.places) || []; }
function tKey(now = Date.now()) { return u().dayKey(now); }
function addKey(k, n) { const [y, m, d] = k.split("-").map(Number); return u().dayKey(new Date(y, m - 1, d + n)); }
function keyDate(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function dayName(k, today) {
  if (k === today) return "Heute";
  if (k === addKey(today, 1)) return "Morgen";
  const d = keyDate(k);
  return `${u().WD[d.getDay()]} ${u().pad(d.getDate())}.${u().pad(d.getMonth() + 1)}.`;
}
function cfg() { return D.readDashboard(settings()); }
function viewVisible() {
  if (!root) return false;
  const v = root.closest(".view") || document.getElementById("view-heute");
  return !(v && v.hidden) && !root.hidden;
}

/* ---------------- Mount / Update ---------------- */

function ensureCss() {
  if (document.getElementById("css-dashboard")) return;
  const l = document.createElement("link");
  l.id = "css-dashboard";
  l.rel = "stylesheet";
  l.href = new URL("../../css/dashboard.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el, c) {
  ctx = c;
  root = el;
  if (!root) return;
  ensureCss();
  root.classList.add("dash");
  root.innerHTML = `
    <div class="dash-head">
      <h2 class="dash-title">Dein Überblick <span aria-hidden="true">✨</span></h2>
      <span class="dash-ctx" data-d="ctx"></span>
      <button type="button" class="btn sm ghost dash-editbtn" data-d="edit" aria-expanded="false">✏️ <span>Anpassen</span></button>
    </div>
    <div class="dash-grid" data-d="grid"></div>
    <div class="dash-edit card" data-d="editor" hidden></div>`;
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  window.addEventListener("online", schedule);
  window.addEventListener("offline", schedule);
  try { lockState.onChange(() => schedule()); } catch (e) { console.error(e); }
  document.addEventListener("sk:dashboard-edit", () => { setEditing(true); try { root.scrollIntoView({ block: "start", behavior: "smooth" }); } catch { /* egal */ } });
  setInterval(() => { if (viewVisible() && document.visibilityState !== "hidden") { lastSig = ""; schedule(); } }, 60000);
}

export function update(s) {
  snap = s;
  schedule();
}

export function onShow() { lastSig = ""; schedule(); }

function schedule() {
  if (queued || !root) return;
  queued = true;
  queueMicrotask(() => { queued = false; try { render(); } catch (e) { console.error(e); } });
}

/* ---------------- Alltag-Sammlungen (lazy) ---------------- */

function need(name) {
  if (subs.has(name)) return;
  let off = null;
  try {
    off = collection(name).watch((list) => { data.set(name, list || []); lastSig = ""; schedule(); });
  } catch (e) { console.error(e); return; }
  subs.set(name, off);
}
function drop(name) {
  const off = subs.get(name);
  if (!off) return;
  try { off(); } catch { /* egal */ }
  subs.delete(name);
  data.delete(name);
}
function col(name) { return data.get(name) || []; }
function loaded(name) { try { return subs.has(name) && collection(name).loaded; } catch { return false; } }

/* ---------------- Fakten ---------------- */

function facts(now) {
  const s = settings();
  const today = tKey(now);
  const tomorrow = addKey(today, 1);
  const ts = (k) => keyDate(k).getTime();
  let schoolToday = null, schoolTomorrow = null, holToday = null, holTomorrow = null;
  try { schoolToday = u().schoolLabel(ts(today), s); schoolTomorrow = u().schoolLabel(ts(tomorrow), s); } catch { /* egal */ }
  if (s.holidays !== false) { try { holToday = u().holidayName(ts(today)); holTomorrow = u().holidayName(ts(tomorrow)); } catch { /* egal */ } }
  return {
    now, today, tomorrow, running: !!(snap && snap.running),
    workDays: Array.isArray(s.workDays) ? s.workDays : [1, 2, 3, 4, 5],
    schoolToday, schoolTomorrow, holToday, holTomorrow,
  };
}

/** Welche Widgets haben überhaupt eine Datenquelle? (sonst ausblenden) */
function available(f) {
  const av = new Set(["balance", "agenda", "calendar", "reminders", "tip", "sync"]);
  if (sitePlace()) av.add("site");
  av.add("money");
  if (col("einkauf").some((x) => x && !x.done) || col("material_items").some((x) => x && x.status === "brauche")) av.add("einkauf"); // Update 10
  if (dueItems().length) av.add("faellig"); // Update 10
  const hasSchool = !!(f.schoolToday || f.schoolTomorrow || (u().readSchool && u().readSchool(settings())));
  if (hasSchool || col("school_exams").length || col("school_tasks").length || !loaded("school_exams")) av.add("school");
  return av;
}

/* ---------------- Rendern ---------------- */

function render() {
  if (!root || !snap || snap.ready === false) { if (root) root.hidden = !snap || snap.ready === false; return; }
  root.hidden = false;
  if (!viewVisible()) return; // erst rendern (und abonnieren), wenn Heute sichtbar ist
  const now = Date.now();
  const f = facts(now);
  const c = cfg();
  const context = D.detectContext({ now, running: f.running, workDays: f.workDays, schoolToday: !!f.schoolToday, schoolTomorrow: !!f.schoolTomorrow, holidayToday: !!f.holToday });
  // Sammlungen: nur für eingeschaltete Widgets
  for (const [w, names] of Object.entries(NEEDS)) {
    const on = !c.hidden.includes(w) && (w !== "money" || canShowMoney());
    for (const n of names) {
      const usedElsewhere = Object.entries(NEEDS).some(([w2, ns]) => w2 !== w && ns.includes(n) && !c.hidden.includes(w2));
      if (on) need(n); else if (!usedElsewhere) drop(n);
    }
  }
  const ids = D.arrange(c, context, available(f));
  const html = ids.map((id) => widgetHTML(id, f)).filter(Boolean).join("");
  const ctxEl = root.querySelector('[data-d="ctx"]');
  const label = c.auto ? D.CONTEXT_LABEL[context] : "📐 Eigene Reihenfolge";
  if (ctxEl.textContent !== label) ctxEl.textContent = label;
  root.dataset.context = context;
  const grid = root.querySelector('[data-d="grid"]');
  const sig = context + "|" + html;
  if (sig !== lastSig) {
    lastSig = sig;
    grid.innerHTML = html || `<p class="dash-none">Alle Widgets sind ausgeblendet – tipp auf „✏️ Anpassen“, um welche einzuschalten.</p>`;
  }
  grid.hidden = editing;
  if (editing) renderEditor(c);
}

function card(id, body, { go = "", hash = "", jump = "", more = "" } = {}) {
  const w = D.widgetById(id);
  const nav = go ? ` data-go="${esc(go)}"` : hash ? ` data-hash="${esc(hash)}"` : jump ? ` data-jump="${esc(jump)}"` : "";
  const moreBtn = nav ? `<button type="button" class="dw-more"${nav} aria-label="${esc(w.t)} öffnen">${esc(more || "Öffnen")} ›</button>` : "";
  return `<article class="dw" data-w="${id}">
    <header class="dw-h"><span class="dw-e" aria-hidden="true">${w.e}</span><h3>${esc(w.t)}</h3>${moreBtn}</header>
    <div class="dw-b">${body}</div></article>`;
}
const empty = (txt) => `<p class="dw-empty">${txt}</p>`;

function widgetHTML(id, f) {
  try {
    switch (id) {
      case "balance": return wBalance();
      case "agenda": return wAgenda(f);
      case "calendar": return wCalendar(f);
      case "site": return wSite();
      case "money": return wMoney(f);
      case "school": return wSchool(f);
      case "reminders": return wReminders(f);
      case "tip": return wTip(f);
      case "sync": return wSync();
      case "einkauf": return wEinkauf();
      case "faellig": return wFaellig();
      default: return "";
    }
  } catch (e) { console.error("Dashboard-Widget " + id, e); return ""; }
}

/* ---- Überstundenstand (gleiche Rechnung wie die Übersicht) ---- */
function wBalance() {
  const b = balanceSummary(snap, ctx);
  if (!b) return "";
  if (!b.start && !b.offset) return card("balance", empty("Noch keine Einträge – dein Konto startet mit dem ersten Stempel ⏱️"), { jump: "balance-panel", more: "Details" });
  const cls = (m) => (Math.round(m) < 0 ? "minus" : "plus");
  return card("balance", `
    <div class="dw-big ${cls(b.total)}" data-dv="balance">${esc(b.text)}</div>
    <div class="dw-kv"><span>Diese Woche</span><b class="${cls(b.week)}">${esc(b.weekText)}</b></div>
    <div class="dw-kv"><span>Diesen Monat</span><b class="${cls(b.month)}">${esc(b.monthText)}</b></div>`, { jump: "balance-panel", more: "Details" });
}

/* ---- Nächster Termin + Aufgaben heute ---- */
function nextTermin(today, nowHM) {
  const list = [];
  for (const t of todos()) {
    if (!t || t.done || t.kind !== "termin") continue;
    let n = null;
    try { n = t.rrule ? nextInstance(t, today) : (t.date ? { date: t.date, time: t.time } : null); } catch { n = null; }
    if (!n || !n.date) continue;
    if (n.date < today || (n.date === today && n.time && n.time < nowHM)) continue;
    list.push({ t, date: n.date, time: n.time || "" });
  }
  list.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  return list[0] || null;
}
function openTasks(today) {
  return todos().filter((t) => t && !t.done && t.kind !== "termin" && t.kind !== "geburtstag" && t.kind !== "einsatz" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date || "")) || t.date <= today)) // ohne Datum (To-do-Liste) oder heute/überfällig
    .sort((a, b) => ((a.date || "9999") + (a.time || "99")).localeCompare((b.date || "9999") + (b.time || "99")));
}
function wAgenda(f) {
  const nowHM = u().clock(f.now);
  const n = nextTermin(f.today, nowHM);
  const tasks = openTasks(f.today);
  let html = "";
  if (n) {
    html += `<button type="button" class="dw-row dw-next" data-todo="${esc(n.t.id)}"><span class="dw-when">${esc(dayName(n.date, f.today))}${n.time ? " · " + esc(n.time) : ""}</span><b>${esc(n.t.title || "Termin")}</b></button>`;
  } else html += empty("Kein Termin in Sicht – Zeit für dich 🌿");
  if (tasks.length) {
    html += `<div class="dw-sub">Offene Aufgaben <span class="dw-count">${tasks.length}</span></div><ul class="dw-list">` +
      tasks.slice(0, 5).map((t) => `<li class="dw-task"><button type="button" class="dw-tick" data-tick="${esc(t.id)}" aria-label="${esc(t.title || "Aufgabe")} erledigt"></button><button type="button" class="dw-row" data-todo="${esc(t.id)}"><span>${esc(t.title || "Aufgabe")}</span>${t.date && t.date < f.today ? `<small class="dw-late">überfällig</small>` : t.time ? `<small>${esc(t.time)}</small>` : ""}</button></li>`).join("") +
      (tasks.length > 5 ? `<li class="dw-more-n">+ ${tasks.length - 5} weitere</li>` : "") + "</ul>";
  } else html += `<p class="dw-note">Keine offenen Aufgaben 🎉</p>`;
  return card("agenda", html, { go: "agenda", more: "Planer" });
}

/* ---- Kalender-Vorschau (nächste 4 Tage) ---- */
function wCalendar(f) {
  const from = f.tomorrow, to = addKey(f.today, 4);
  let map = null;
  try { map = buildIndex(snap, from, to, { util: u(), einsatzFor, now: f.now }); } catch (e) { console.error(e); map = null; }
  if (!map) return "";
  const rows = [];
  for (const [k, d] of map) {
    const items = [...d.allDay, ...d.timed].filter((it) => it && !it.done && it.type !== "arbeit" && it.type !== "abwesend");
    if (!items.length) continue;
    const shown = items.slice(0, 3).map((it) => `<span class="dw-chip" data-type="${esc(it.type)}"><span aria-hidden="true">${esc(it.emoji || "•")}</span>${it.start != null && it.type !== "einsatz" ? `<small>${esc(u().pad(Math.floor(it.start / 60)) + ":" + u().pad(it.start % 60))}</small>` : ""}${esc(it.title)}</span>`).join("");
    rows.push(`<li><span class="dw-day">${esc(dayName(k, f.today))}</span><span class="dw-chips">${shown}${items.length > 3 ? `<small class="dw-more-n">+${items.length - 3}</small>` : ""}</span></li>`);
  }
  return card("calendar", rows.length ? `<ul class="dw-days">${rows.join("")}</ul>` : empty("Die nächsten Tage sind noch frei ☀️"), { go: "eintraege", more: "Kalender" });
}

/* ---- Aktuelle Baustelle + offenes Material ---- */
function sitePlace() {
  const r = snap && snap.running;
  const byId = (id) => (id ? places().find((p) => p.id === id) || null : null);
  if (r) {
    const segs = Array.isArray(r.segments) && r.segments.length ? r.segments : [];
    const seg = segs.length ? segs[segs.length - 1] : null;
    const cand = [seg, r].filter(Boolean);
    for (const x of cand) {
      const p = byId(x.placeId);
      if (p) return { placeId: p.id, place: p.name, running: true };
      if (String(x.place || "").trim()) return { placeId: null, place: String(x.place).trim(), running: true };
    }
  }
  let last = null;
  for (const e of (snap && snap.entries) || []) {
    if (!e || (e.kind && e.kind !== "work") || !(e.placeId || String(e.place || "").trim())) continue;
    if (!last || e.start > last.start) last = e;
  }
  if (!last) return null;
  const p = byId(last.placeId);
  return { placeId: p ? p.id : null, place: p ? p.name : String(last.place || "").trim(), running: false, when: last.start };
}
function siteOpen(site) {
  if (!site) return [];
  const pk = MAT.placeKey({ placeId: site.placeId, place: site.place });
  return col("material_items").filter((x) => x && MAT.OPEN_STATUSES.includes(x.status) &&
    (MAT.placeKey(x) === pk || (site.placeId && MAT.placeKey(x) === MAT.placeKey({ place: site.place }))));
}
function wSite() {
  const site = sitePlace();
  if (!site) return "";
  const sub = site.running ? `<span class="dw-live">● läuft gerade</span>` : `<span class="dw-note">zuletzt am ${esc(u().fmtDate(site.when))}</span>`;
  let mat = "";
  if (!loaded("material_items")) mat = `<p class="dw-note">Material wird geladen …</p>`;
  else {
    const open = siteOpen(site);
    if (!open.length) mat = `<p class="dw-note">Kein offenes Material – alles da 👍</p>`;
    else {
      const sum = MAT.summarize(open, places())[0] || null;
      const lines = MAT.totals(open).slice(0, 3).map((t) => `<li>${esc(MAT.qtyText(t.qty, t.unit))} ${esc(t.name)}</li>`).join("");
      mat = `<div class="dw-sub">Offenes Material <span class="dw-count">${open.length}</span></div>
        ${sum ? `<p class="dw-note">${esc(MAT.openCountText(sum))}</p>` : ""}<ul class="dw-list dw-mat">${lines}</ul>`;
    }
  }
  // Update 10d – Baustellen-Projektseite: gespeicherter Ort → Seite öffnen, Material bleibt als eigener Knopf erreichbar
  if (site.placeId) {
    const matBtn = `<button type="button" class="dw-more dw-site-mat" data-hash="#alltag/material">🧰 Materialliste ›</button>`;
    return card("site", `<div class="dw-place"><b>📍 ${esc(site.place)}</b>${sub}</div>${mat}${matBtn}`, { hash: "#orte/baustelle/" + site.placeId, more: "Baustelle" });
  }
  return card("site", `<div class="dw-place"><b>📍 ${esc(site.place)}</b>${sub}</div>${mat}`, { hash: "#alltag/material", more: "Material" });
}

/* ---- 🛒 Einkauf (Update 10): offene Artikel aller Listen + fehlendes Material; nichts offen → ausgeblendet ---- */
function wEinkauf() {
  if (!loaded("einkauf")) return "";
  const open = col("einkauf").filter((x) => x && !x.done && String(x.name || "").trim());
  const mat = loaded("material_items") ? col("material_items").filter((x) => x && x.status === "brauche").length : 0;
  if (!open.length && !mat) return "";
  const names = open.slice().sort((a, b) => (a.created || 0) - (b.created || 0)).slice(0, 3).map((x) => `<li>${esc(String(x.name).trim())}</li>`).join("");
  return card("einkauf", `<div class="dw-big">${open.length} <small class="dw-note">offen</small></div>` +
    (names ? `<ul class="dw-list">${names}</ul>` : "") +
    (mat ? `<p class="dw-note">🧰 ${mat} Material fehlt noch</p>` : ""), { hash: "#alltag/einkauf", more: "Liste" });
}

/* ---- Werkzeug & Auto fällig (Update 10) ---- */
function dueItems() {
  const out = [];
  const now = Date.now();
  if (loaded("werkzeug")) for (const t of WZ.dueTools(col("werkzeug"), now)) out.push({ e: t.state === "ueber" ? "⛔" : t.e, text: t.text, hash: t.hash, bad: t.state === "ueber" });
  if (loaded("fahrzeug_info") && loaded("travel_fuel")) {
    const s = settings();
    const dv = defaultVehicle(s);
    for (const v of FZ.dueVehicles(readVehicles(s), col("fahrzeug_info"), col("travel_fuel"), now, { defaultId: dv ? dv.id : null })) {
      out.push({ e: v.e, text: v.text.replace(/^\S+\s/, ""), hash: v.hash, bad: ["abgelaufen", "ueber", "toleranz"].includes(v.state) });
    }
  }
  return out.sort((a, b) => b.bad - a.bad);
}
function wFaellig() {
  const list = dueItems();
  if (!list.length) return "";
  const first = list[0];
  return card("faellig", `<ul class="dw-list">${list.slice(0, 4).map((x) => `<li><span aria-hidden="true">${x.e}</span><span>${esc(x.text)}</span></li>`).join("")}</ul>` +
    (list.length > 4 ? `<p class="dw-note">+ ${list.length - 4} weitere</p>` : ""), { hash: first.hash, more: list.length === 1 ? "Ansehen" : "Erstes ansehen" });
}

/* ---- Finanzen (Geld-Sperre!) ---- */
function canShowMoney() {
  try { return lockState.isLoaded() && !lockState.isLocked(); } catch { return false; }
}
function wMoney(f) {
  if (!canShowMoney()) {
    return card("money", `<p class="dw-lock">🔒 Geld gesperrt</p><p class="dw-note">Beträge siehst du nach dem Entsperren in Alltag › Geld.</p>`, { hash: "#alltag/geld", more: "Entsperren" });
  }
  if (!loaded("money_tx") || !loaded("money_budget")) return card("money", `<p class="dw-note">Wird geladen …</p>`, { hash: "#alltag/geld", more: "Geld" });
  const mk = MON.monthOf(f.today);
  const txs = col("money_tx");
  const sp = MON.budgetSpend(txs, mk);
  const rows = MON.budgetStatus(txs, col("money_budget"), mk);
  const monthName = MON.MONTHS[Number(mk.slice(5, 7)) - 1] || MON.monthLabel(mk);
  if (!rows.length && !sp.total) return card("money", empty(`Im ${esc(monthName)} noch keine Ausgaben 🌱`), { hash: "#alltag/geld", more: "Geld" });
  const row = rows.find((r) => r.id === "total") || rows.slice().sort((a, b) => b.ratio - a.ratio)[0] || null;
  let html = `<div class="dw-kv"><span>Ausgaben ${esc(monthName)}</span><b class="mm-amt" data-dv="spent">${esc(MON.eurS(sp.total))}</b></div>`;
  if (row) {
    const pct = Math.max(0, Math.min(100, Math.round(row.ratio * 100)));
    const lvl = row.ratio >= 1 ? "over" : row.ratio >= 0.8 ? "warn" : "ok";
    html += `<div class="dw-budget" data-level="${lvl}">
      <div class="dw-kv"><span>${esc(row.emoji || "")} Budget ${esc(row.name)}</span><b class="mm-amt">${esc(MON.eurS(row.spent))} / ${esc(MON.eurS(row.limit))}</b></div>
      <div class="dw-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Budget ${esc(row.name)} ${pct} Prozent"><i style="width:${pct}%"></i></div>
      <p class="dw-note">${row.left >= 0 ? `Noch <b class="mm-amt">${esc(MON.eurS(row.left))}</b> übrig – ${lvl === "ok" ? "läuft gut 👌" : "langsam sparsam 🙂"}` : `<b class="mm-amt">${esc(MON.eurS(-row.left))}</b> drüber – halb so wild, nächster Monat 💪`}</p></div>`;
  } else html += `<p class="dw-note">Kein Budget gesetzt – geht in Alltag › Geld.</p>`;
  return card("money", html, { hash: "#alltag/geld", more: "Geld" });
}

/* ---- Prüfungen / Hausaufgaben ---- */
function upcomingExams(today) {
  return col("school_exams").filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
function daysTo(today, k) { return Math.round((keyDate(k) - keyDate(today)) / 86400000); }
function wSchool(f) {
  let html = "";
  if (f.schoolTomorrow) html += `<p class="dw-pill">🎒 Morgen ${esc(f.schoolTomorrow)}</p>`;
  else if (f.schoolToday) html += `<p class="dw-pill">📚 Heute ${esc(f.schoolToday)}</p>`;
  if (!loaded("school_exams") || !loaded("school_tasks")) return card("school", html + `<p class="dw-note">Wird geladen …</p>`, { hash: "#alltag/schule", more: "Schule" });
  const exams = upcomingExams(f.today).slice(0, 2);
  const tasks = col("school_tasks").filter((t) => t && !t.done)
    .sort((a, b) => String(a.due || "9999").localeCompare(String(b.due || "9999"))).slice(0, 3);
  if (exams.length) {
    html += `<div class="dw-sub">Nächste Prüfungen</div><ul class="dw-list">` + exams.map((e) => {
      const n = daysTo(f.today, e.date);
      return `<li><span aria-hidden="true">📝</span><span>${esc(e.kind || "Prüfung")}${e.subject ? " " + esc(e.subject) : ""}</span><small class="${n <= 2 ? "dw-late" : ""}">${esc(countdownText(n))}</small></li>`;
    }).join("") + "</ul>";
  }
  if (tasks.length) {
    html += `<div class="dw-sub">Hausaufgaben</div><ul class="dw-list">` + tasks.map((t) => {
      const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due || "") ? daysTo(f.today, t.due) : null;
      const late = due != null && due < 0;
      return `<li><span aria-hidden="true">✏️</span><span>${esc(t.title || "Aufgabe")}${t.subject ? ` <small>· ${esc(t.subject)}</small>` : ""}</span>${due != null ? `<small class="${late || due <= 1 ? "dw-late" : ""}">${late ? "überfällig" : esc(countdownText(due))}</small>` : ""}</li>`;
    }).join("") + "</ul>";
  }
  if (!exams.length && !tasks.length) html += empty("Keine Prüfungen & Hausaufgaben offen – stark! 🎉");
  return card("school", html, { hash: "#alltag/schule", more: "Schule" });
}

/* ---- Erinnerungen ---- */
function wReminders(f) {
  const items = [];
  try {
    for (const b of upcomingBirthdays(todos(), f.today)) {
      if (b.days > 7) break;
      items.push({ e: "🎂", t: `${b.t.title || "Geburtstag"}${b.age != null ? ` (wird ${b.age})` : ""}`, w: b.days <= 1 ? countdownText(b.days) : `in ${b.days} Tagen`, hot: b.days <= 1 });
    }
  } catch { /* egal */ }
  if (f.holTomorrow) items.push({ e: "🎌", t: f.holTomorrow, w: "Morgen", hot: true });
  try {
    for (const c of countdowns(todos(), f.today)) {
      if (c.days > 7) break;
      items.push({ e: c.emoji, t: c.t.title || "Countdown", w: countdownText(c.days), hot: c.days <= 1 });
    }
  } catch { /* egal */ }
  const html = items.length
    ? `<ul class="dw-list">${items.slice(0, 4).map((x) => `<li${x.hot ? ' class="hot"' : ""}><span aria-hidden="true">${esc(x.e)}</span><span>${esc(x.t)}</span><small>${esc(x.w)}</small></li>`).join("")}</ul>`
    : empty("Keine Erinnerungen in den nächsten Tagen – alles im Lot 😌");
  return card("reminders", html, { go: "agenda", more: "Planer" });
}

/* ---- Tipp (regelbasiert) ---- */
function wTip(f) {
  const r = snap.running;
  let netMs = 0;
  try { netMs = r ? ctx.timer.netMs(r) : 0; } catch { netMs = 0; }
  let bday = null;
  try { const b = upcomingBirthdays(todos(), f.today)[0]; if (b && b.days === 0) bday = String(b.t.title || "").trim() || null; } catch { /* egal */ }
  const ex = upcomingExams(f.today)[0];
  const bal = balanceSummary(snap, ctx);
  const site = r ? sitePlace() : null;
  const tips = D.pickTips({
    now: f.now, running: r, netMs,
    schoolTomorrow: f.schoolTomorrow, holidayTomorrow: f.holTomorrow,
    examSoon: ex ? { title: `${ex.kind || "Prüfung"}${ex.subject ? " " + ex.subject : ""}`, days: daysTo(f.today, ex.date) } : null,
    tasksOverdue: openTasks(f.today).filter((t) => t.date < f.today).length,
    birthdayToday: bday, balanceMin: bal && (bal.start || bal.offset) ? bal.total : null,
    offline: typeof navigator !== "undefined" && navigator.onLine === false,
    openMaterial: site && loaded("material_items") ? siteOpen(site).length : 0,
    weekend: !f.workDays.includes(new Date(f.now).getDay()),
    weekReportDue: weekReportDue(f.now),
  }, 2);
  if (!tips.length) return card("tip", empty("Gerade kein Tipp – du hast alles im Griff 😊"));
  return card("tip", `<ul class="dw-tips">${tips.map((t) => `<li data-tip="${esc(t.id)}"><span aria-hidden="true">${t.e}</span><span>${esc(t.text)}</span>${t.act === "wr" ? `<button type="button" class="btn ghost sm dw-tip-go" data-d="wr">Los geht's</button>` : ""}</li>`).join("")}</ul>`);
}

/** Update 10: Freitagnachmittag/Samstag, Woche mit Arbeitstagen, Wochenbericht noch nicht abgegeben. */
function weekReportDue(now) {
  try {
    const today = ctx.util.dayKey(now);
    const week = WRC.weekKeyOf(today);
    const mon = WRC.mondayOfWeek(week);
    const worked = new Set((snap.entries || []).filter((e) => e && (!e.kind || e.kind === "work") && !e.privateTrip)
      .map((e) => ctx.util.dayKey(e.start)).filter((k) => k >= mon && k <= today)).size;
    if (!WRC.wantsFridayTip(now, { workedDays: worked })) return false;
    need(WRC.COLLECTION);
    if (!loaded(WRC.COLLECTION)) return false;
    const doc = col(WRC.COLLECTION).find((x) => x && x.id === week);
    if (doc && doc.status === "abgegeben") return false;
    if (!document.getElementById("wr-css")) { // Knopf-Stil (weekreport.css)
      const l = document.createElement("link");
      l.id = "wr-css"; l.rel = "stylesheet"; l.href = new URL("../../css/weekreport.css", import.meta.url).href;
      document.head.appendChild(l);
    }
    return true;
  } catch { return false; }
}

/* ---- Sync-Status ---- */
function wSync() {
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const cloud = snap.mode === "cloud";
  let st = "ok", txt = "✅ Alles gespeichert", note = "Deine Daten sind in der Cloud gesichert.";
  if (!online) { st = "off"; txt = "📴 Offline – wird später synchronisiert"; note = "Du kannst ganz normal weiterstempeln."; }
  else if (!cloud) { st = "local"; txt = "💾 Gespeichert auf diesem Gerät"; note = "Melde dich an, um geräteübergreifend zu synchronisieren."; }
  return card("sync", `<p class="dw-sync" data-sync="${st}">${txt}</p><p class="dw-note">${note}</p>`);
}

/* ---------------- Anpassen ---------------- */

function setEditing(on) {
  editing = !!on;
  const btn = root.querySelector('[data-d="edit"]');
  btn.setAttribute("aria-expanded", editing ? "true" : "false");
  btn.innerHTML = editing ? "✔️ <span>Fertig</span>" : "✏️ <span>Anpassen</span>";
  root.querySelector('[data-d="editor"]').hidden = !editing;
  root.classList.toggle("editing", editing);
  lastSig = "";
  render();
}

function renderEditor(c) {
  const ed = root.querySelector('[data-d="editor"]');
  const focus = document.activeElement && ed.contains(document.activeElement)
    ? (document.activeElement.dataset.mv ? `[data-mv="${document.activeElement.dataset.mv}"][data-id="${document.activeElement.dataset.id}"]` : document.activeElement.id ? "#" + document.activeElement.id : "") : "";
  const list = c.order.map((id, i) => {
    const w = D.widgetById(id);
    const on = !c.hidden.includes(id);
    return `<li class="de-row${on ? "" : " off"}" data-id="${id}">
      <label class="de-on"><input type="checkbox" data-tg="${id}"${on ? " checked" : ""} aria-label="${esc(w.t)} anzeigen"><span class="de-e" aria-hidden="true">${w.e}</span><span class="de-t">${esc(w.t)}</span></label>
      <span class="de-mv">
        <button type="button" class="de-btn" data-mv="up" data-id="${id}" aria-label="${esc(w.t)} nach oben"${c.auto || i === 0 ? " disabled" : ""}>▲</button>
        <button type="button" class="de-btn" data-mv="down" data-id="${id}" aria-label="${esc(w.t)} nach unten"${c.auto || i === c.order.length - 1 ? " disabled" : ""}>▼</button>
      </span></li>`;
  }).join("");
  ed.innerHTML = `
    <h3 class="de-h">✏️ Dein Überblick anpassen</h3>
    <label class="switch de-auto"><input type="checkbox" id="dash-auto"${c.auto ? " checked" : ""}><span>Automatisch sortieren <small>(Arbeit, Schule, Freizeit – je nach Tageszeit)</small></span></label>
    ${c.auto ? `<p class="note">Zum selbst Ordnen „Automatisch sortieren“ ausschalten.</p>` : ""}
    <ol class="de-list">${list}</ol>
    <div class="de-foot"><button type="button" class="btn sm ghost" data-d="reset">↺ Standard</button><button type="button" class="btn sm" data-d="done">✔️ Fertig</button></div>`;
  if (focus) { const el = ed.querySelector(focus); if (el && !el.disabled) el.focus(); }
}

async function save(next) {
  const dash = D.dashboardForSave(next);
  try { await ctx.store.saveSettings({ dashboard: dash }); }
  catch (e) { console.error(e); try { ctx.ui.toast("Konnte nicht speichern – bitte nochmal probieren."); } catch { /* egal */ } }
  lastSig = "";
  schedule();
}

function onChange(ev) {
  const t = ev.target;
  if (!(t instanceof HTMLInputElement)) return;
  const c = cfg();
  if (t.id === "dash-auto") save({ ...c, auto: t.checked });
  else if (t.dataset.tg) save({ ...c, hidden: D.toggleHidden(c.hidden, t.dataset.tg, !t.checked) });
}

function onClick(ev) {
  const b = ev.target.closest("button");
  if (!b || !root.contains(b)) return;
  const d = b.dataset;
  if (d.d === "edit") { setEditing(!editing); return; }
  if (d.d === "done") { setEditing(false); root.querySelector('[data-d="edit"]').focus(); return; }
  if (d.d === "wr") { // Update 10 – ✨ Wochenbericht
    import("./weekreport.js").then((m) => m.openWeekReport(ctx, {})).catch((err) => { console.error(err); ctx.ui.toast("Wochenbericht konnte nicht geladen werden."); });
    return;
  }
  if (d.d === "reset") { save({ order: D.DEFAULT_ORDER, hidden: [], auto: true }); return; }
  if (d.mv) { const c = cfg(); save({ ...c, order: D.moveWidget(c.order, d.id, d.mv === "up" ? -1 : 1) }); return; }
  if (d.tick) {
    const t = todos().find((x) => x.id === d.tick);
    if (!t || b.dataset.busy) return;
    b.dataset.busy = "1";
    b.classList.add("on");
    setTimeout(async () => {
      try {
        await ctx.store.saveTodo({ ...t, done: true, doneAt: Date.now() });
        ctx.ui.toast(`✅ „${t.title || "Aufgabe"}“ erledigt – stark! 💪`, 2200);
      } catch { b.classList.remove("on"); delete b.dataset.busy; }
    }, 250);
    return;
  }
  if (d.todo) {
    const t = todos().find((x) => x.id === d.todo);
    if (t && ctx.openTodoForm) ctx.openTodoForm(t);
    return;
  }
  if (d.go) { ctx.go(d.go); return; }
  if (d.hash) { location.hash = d.hash; return; }
  if (d.jump && ctx.jump) ctx.jump(d.jump);
}
