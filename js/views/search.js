// Update 10 – 🔍 Universale Suche: Vollbild-Ebene über der App (wie die Einstellungs-Zentrale).
// Öffnen: Lupe in der Kopfzeile (appbar-settings.js → „sk:open-search“), Lupe in der PC-Kopfzeile, Taste „/“ oder Strg/⌘+K.
// Schließen: ←, Escape, Android-Zurück (history.pushState). Durchsucht NUR deine eigenen Daten, die ohnehin im Browser liegen;
// Alltag-Sammlungen werden erst beim Öffnen geladen und beim Schließen wieder abgemeldet. Der Passwort-Tresor wird NIE durchsucht.
// Geld: bei aktiver Geld-Sperre nur eine Zeile „🔒 Geld gesperrt – entsperren“ (keine Beträge, keine Texte).
// Reine Logik (Normalisierung, Bewertung, Hervorhebung): ../search-core.js
import * as SC from "../search-core.js";
import { collection } from "../alltag/db.js";
import * as lockState from "../alltag/money-lock-state.js";
import * as EK from "../alltag/einkauf-core.js";
import * as WZ from "../alltag/werkzeug-core.js"; // Update 10 – Werkzeug-Register
import * as FZ from "../alltag/fahrzeug-core.js"; // Update 10 – Fahrzeuge
import * as HHC from "../alltag/haushalt-core.js"; // Update 10 C – Haushalt
import * as HBC from "../alltag/habits-core.js"; // Update 10 C – Routinen & Ziele
import * as NBC from "../alltag/notes-core.js"; // Update 10 C – Notizbuch
import * as DKC from "../alltag/dokumente-core.js"; // Update 10 E
import * as VTC from "../alltag/vertraege-core.js"; // Update 10 E
import * as INC from "../alltag/inventar-core.js"; // Update 10 E
import * as KTC from "../alltag/kontakte-core.js"; // Update 10 E
import { prioById as wishPrio } from "../alltag/finanz-core.js"; // Update 10 E
import { tripsBetween } from "../travel.js";
import { fromLabel, toLabel, readVehicles } from "../trip-core.js";
import { siteHash } from "../site-core.js";
import { searchIndex as settingsIndex } from "./settings-hub.js";
import * as PF from "../profiles-core.js"; // Update 10 F – Module ein/aus

const RECENT_KEY = "sk-search-recent";
const PER_GROUP = 4;
const COLS = ["material_items", "einkauf", "einkauf_lists", "photo_albums", "school_exams", "school_tasks", "school_timetable", "school_grades",
  "travel_trips", "travel_packing", "travel_places", "jp_cards", "berichtsheft", "werkzeug", "fahrzeug_info",
  "haushalt", "habits", "goals", "notes", "ai_memory", "automations", "dokumente", "vertraege", "inventar", "kontakte"]; // Update 10 C + Automationen + E
const MONEY_COLS = ["money_tx", "money_subs", "money_wishes"]; // Update 10 E: + Wunschliste
const KIND = { termin: "📅 Termin", aufgabe: "✅ Aufgabe", geburtstag: "🎂 Geburtstag", einsatz: "🛠️ Einsatz" };
const WD_L = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

let ctx = null;
let layer = null;
let open = false;
let token = "";
let pendingAfterClose = null;
let q = "";
let expanded = new Set();
let active = -1;
const subs = new Map();      // Sammlung → Abmelden
const data = new Map();      // Sammlung → Array
let moneyOn = false;
let lockOff = null;
let photoList = null;        // Foto-Index (ohne große Bilder)
let statics = null;          // { vocab, cards, formulas }
let index = [];
let byKey = new Map();
let dirty = true;
let renderQueued = false;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const s = (v) => (v == null ? "" : String(v).trim());
const esc = (v) => ctx.util.esc(v);
const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
const fmtKeyWd = (k) => { if (!isKey(k)) return ""; const [y, m, d] = k.split("-").map(Number); return `${WD_L[new Date(y, m - 1, d).getDay()]}, ${SC.fmtKey(k)}`; };

function ensureCss() {
  if (document.getElementById("srch-css")) return;
  const l = document.createElement("link");
  l.id = "srch-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/search.css", import.meta.url).href;
  document.head.appendChild(l);
}

function readRecent() { try { const a = JSON.parse(lsGet(RECENT_KEY) || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; } catch { return []; } }
function saveRecent(text) { lsSet(RECENT_KEY, JSON.stringify(SC.pushRecent(readRecent(), text))); }

/* ---------- Einhängen ---------- */

export function mount(c) {
  ctx = c;
  if (layer) return layer;
  ensureCss();
  layer = document.createElement("div");
  layer.id = "search-layer";
  layer.className = "srch";
  layer.hidden = true;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "Suche");
  layer.innerHTML =
    `<div class="srch-box">
      <header class="srch-head">
        <button type="button" class="srch-back" data-s="close" aria-label="Suche schließen">←</button>
        <div class="srch-field">
          <span class="srch-ic" aria-hidden="true">🔍</span>
          <input type="search" id="srch-q" placeholder="Suchen in deiner Stempelkarte …" aria-label="Alles durchsuchen" autocomplete="off" enterkeyhint="search" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="srch-body">
          <button type="button" class="srch-clear" data-s="clear" aria-label="Suchtext löschen" hidden>✕</button>
        </div>
      </header>
      <div class="srch-body" id="srch-body" role="listbox" aria-label="Suchergebnisse"></div>
      <p class="srch-status note" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(layer);
  const input = layer.querySelector("#srch-q");
  input.addEventListener("input", () => { q = input.value; expanded = new Set(); active = -1; layer.querySelector(".srch-clear").hidden = !q; queueRender(); });
  input.addEventListener("keydown", onInputKey);
  layer.addEventListener("click", onClick);
  window.addEventListener("sk:open-search", (ev) => openSearch(ev.detail && ev.detail.q));
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onGlobalKey);
  const pc = document.getElementById("pc-search");
  if (pc) pc.addEventListener("click", () => openSearch());
  return layer;
}

export function isOpen() { return open; }

function typingIn(el) {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || el.isContentEditable;
}

function onGlobalKey(ev) {
  if (open) {
    if (ev.key === "Escape") {
      if (document.querySelector("#sheet-root .sheet")) return;
      ev.preventDefault();
      const input = layer.querySelector("#srch-q");
      if (input.value) { input.value = ""; q = ""; layer.querySelector(".srch-clear").hidden = true; queueRender(); input.focus(); return; }
      close();
    }
    return;
  }
  const k = (ev.key || "").toLowerCase();
  const combo = (ev.ctrlKey || ev.metaKey) && !ev.altKey && k === "k";
  const slash = ev.key === "/" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !typingIn(document.activeElement);
  if (!combo && !slash) return;
  if (document.querySelector("#sheet-root .sheet") || document.body.classList.contains("sh-open") || document.querySelector(".lock-screen:not([hidden])")) return;
  if (!document.getElementById("tabbar") || document.getElementById("tabbar").hidden) return; // App noch nicht offen (Anmeldung)
  ev.preventDefault();
  openSearch();
}

/* ---------- Öffnen / Schließen ---------- */

export function openSearch(text) {
  if (!layer) return;
  if (!open) {
    open = true;
    layer.hidden = false;
    document.body.classList.add("srch-open");
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const base = { ...(history.state || {}) };
    delete base.srch;
    try { history.pushState({ ...base, srch: token }, "", location.href); } catch { /* egal */ }
    startSources();
  }
  const input = layer.querySelector("#srch-q");
  input.value = typeof text === "string" ? text : "";
  q = input.value;
  expanded = new Set();
  active = -1;
  layer.querySelector(".srch-clear").hidden = !q;
  render();
  setTimeout(() => { try { input.focus({ preventScroll: true }); } catch { /* egal */ } }, 30);
}

export function close(then) {
  if (!open) { if (then) then(); return; }
  pendingAfterClose = then || null;
  if ((history.state || {}).srch === token) { history.back(); return; } // onPop schließt
  finishClose();
}

function finishClose() {
  open = false;
  layer.hidden = true;
  document.body.classList.remove("srch-open");
  stopSources();
  const t = pendingAfterClose;
  pendingAfterClose = null;
  if (t) { try { t(); } catch (err) { console.error(err); } }
}

function onPop(ev) {
  if (!open) return;
  const st = ev.state || {};
  if (st.srch !== token) finishClose();
}

/* ---------- Datenquellen (nur während die Suche offen ist) ---------- */

function watchCol(name) {
  if (subs.has(name)) return;
  try {
    const off = collection(name).watch((list) => { data.set(name, list || []); dirty = true; queueRender(); });
    subs.set(name, off);
  } catch (err) { console.warn("Suche: Sammlung " + name, err); }
}

function unwatch(name) {
  const off = subs.get(name);
  if (off) { try { off(); } catch { /* egal */ } }
  subs.delete(name);
  data.delete(name);
}

function moneyAllowed() {
  try { return lockState.isLoaded() && !lockState.isLocked(); } catch { return false; }
}

function syncMoney() {
  const want = open && moneyAllowed();
  if (want && !moneyOn) { moneyOn = true; for (const n of MONEY_COLS) watchCol(n); }
  else if (!want && moneyOn) { moneyOn = false; for (const n of MONEY_COLS) unwatch(n); }
  dirty = true;
  queueRender();
}

function startSources() {
  for (const n of COLS) watchCol(n);
  syncMoney();
  try { lockOff = lockState.onChange(syncMoney); } catch { lockOff = null; }
  photoList = null;
  import("../photos.js").then((m) => m.listIndex()).then((list) => { if (!open) return; photoList = list || []; dirty = true; queueRender(); })
    .catch((err) => { console.warn("Suche: Fotos", err); photoList = []; dirty = true; queueRender(); });
  if (!statics) {
    Promise.all([import("../alltag/jp-data.js"), import("../alltag/lap-data.js"), import("../alltag/elektro-data.js").catch(() => ({}))])
      .then(([jp, lap, el]) => { statics = { vocab: jp.VOCAB || [], cards: lap.CARDS || [], formulas: lap.FORMULAS || [], lex: el.LEXIKON || [] }; dirty = true; queueRender(); })
      .catch((err) => { console.warn("Suche: Lerndaten", err); statics = { vocab: [], cards: [], formulas: [], lex: [] }; });
  }
  dirty = true;
}

function stopSources() {
  for (const n of [...subs.keys()]) unwatch(n);
  moneyOn = false;
  if (lockOff) { try { lockOff(); } catch { /* egal */ } }
  lockOff = null;
  photoList = null;
  index = [];
  byKey = new Map();
  dirty = true;
}

/** Wird von app.js bei jeder Store-Änderung aufgerufen (Einträge, Planer, Orte …). */
export function update() { if (open) { dirty = true; queueRender(); } }

/* ---------- Index bauen ---------- */

function add(it) {
  it.key = it.cat + ":" + it.id;
  index.push(it);
  byKey.set(it.key, it);
}

function buildIndex() {
  index = [];
  byKey = new Map();
  const snap = ctx.store.get() || {};
  const u = ctx.util;
  const places = snap.places || [];
  const placeById = new Map(places.map((p) => [p.id, p]));
  const D = (n) => data.get(n) || [];

  // ⚙️ Einstellungen
  for (const c of settingsIndex()) add({ cat: "einstellungen", id: c.id, emoji: c.e, title: c.t, text: c.k, go: { t: "setting", id: c.id } });

  // 🕒 Einträge
  for (const e of snap.entries || []) {
    if (!e || !Number.isFinite(e.start)) continue;
    const k = u.dayKey(e.start);
    const work = !e.kind || e.kind === "work";
    const pl = s(e.place) || s(placeById.get(e.placeId) && placeById.get(e.placeId).name);
    const when = work ? `${u.clock(e.start)}${Number.isFinite(e.end) ? "–" + u.clock(e.end) : " · läuft"}` : u.kindLabel(e.kind);
    const segs = Array.isArray(e.segments) ? e.segments : [];
    add({
      cat: "eintraege", id: e.id, emoji: work ? "🕒" : e.kind === "urlaub" ? "🌴" : e.kind === "krank" ? "🤒" : "📌",
      title: pl || (work ? "Arbeitstag" : u.kindLabel(e.kind)), sub: `${fmtKeyWd(k)} · ${when}${s(e.note) ? " · " + s(e.note) : ""}`,
      text: [e.note, ...(Array.isArray(e.people) ? e.people : []), ...segs.map((x) => x && [x.place, x.activity, x.endPlace].join(" "))].join(" "),
      dates: [k], ts: e.start, go: { t: "entry", id: e.id },
    });
  }

  // 📅 Planer
  for (const t of snap.todos || []) {
    if (!t) continue;
    const kind = t.kind || "aufgabe";
    const title = s(t.title) || s(t.place) || KIND[kind] || "Aufgabe";
    const date = isKey(t.date) ? t.date : "";
    const ts = date ? new Date(date + "T12:00").getTime() : Number(t.createdAt) || 0;
    add({
      cat: "planer", id: t.id, emoji: (KIND[kind] || "✅").split(" ")[0], title,
      sub: [KIND[kind] ? KIND[kind].split(" ").slice(1).join(" ") : "Aufgabe", date ? (kind === "geburtstag" ? SC.fmtKey(date).slice(0, 6) : fmtKeyWd(date)) + (t.time ? " " + t.time : "") : "", t.done ? "erledigt ✓" : "", s(t.location) || s(t.place)].filter(Boolean).join(" · "),
      text: [t.note, t.location, t.place].join(" "), dates: date ? [date] : [], ts, boost: t.done ? -5 : 0, go: { t: "todo", id: t.id },
    });
  }

  // 📍 Orte & Baustellen
  for (const p of places) {
    if (!p || !p.id) continue;
    add({ cat: "orte", id: p.id, emoji: "📍", title: s(p.name) || "Ort", sub: s(p.addr), text: [p.note, p.notes, p.client, p.customer, p.status].join(" "), go: { t: "place", id: p.id } });
  }

  // 🛒 Einkauf
  const lists = EK.listsOf(D("einkauf_lists"));
  const listName = new Map(lists.map((l) => [l.id, l]));
  for (const x of D("einkauf")) {
    if (!x || !s(x.name)) continue;
    const it = EK.normItem(x);
    const l = listName.get(it.listId);
    add({ cat: "einkauf", id: x.id, emoji: it.done ? "☑️" : EK.catById(it.cat).e, title: EK.lineText(it), sub: `${l ? l.e + " " + l.name : "Liste"}${it.done ? " · erledigt" : ""}`, text: it.note, ts: Number(x.created) || 0, boost: it.done ? -10 : 0, go: { t: "einkauf", id: x.id, list: it.listId } });
  }

  // 🧰 Material
  const MSTAT = { brauche: "fehlt noch", besorgt: "besorgt", baustelle: "auf der Baustelle", verbaut: "verbaut" };
  for (const m of D("material_items")) {
    if (!m || !s(m.name)) continue;
    const pl = s(m.place) || s(placeById.get(m.placeId) && placeById.get(m.placeId).name);
    add({ cat: "material", id: m.id, emoji: m.status === "verbaut" ? "✅" : "🧰", title: `${Number(m.qty) || 1} ${s(m.unit) || "Stk"} ${s(m.name)}`,
      sub: [MSTAT[m.status] || s(m.status), pl, isKey(m.dayKey) ? SC.fmtKey(m.dayKey) : ""].filter(Boolean).join(" · "), text: s(m.note),
      dates: isKey(m.dayKey) ? [m.dayKey] : [], ts: Number(m.updated) || 0, go: { t: "material", id: m.id, status: m.status } });
  }

  // 🧰 Werkzeug (Update 10)
  const vehicles = readVehicles(snap.settings || {});
  for (const x of D("werkzeug")) {
    const t = WZ.normTool(x);
    if (!t.id || !t.name) continue;
    const st = WZ.toolState(t);
    const c = WZ.checkStatus(t, u.dayKey(Date.now()));
    add({ cat: "werkzeug", id: t.id, emoji: WZ.catById(t.cat).e, title: t.name,
      sub: [t.brand, t.serial ? "SN " + t.serial : "", st.id !== "da" ? st.label : WZ.locLabel(t, places, vehicles), c.state === "ueber" || c.state === "bald" ? c.label : ""].filter(Boolean).join(" · "),
      text: WZ.searchText(t), ts: Number(x.updated) || 0, boost: t.defect ? -2 : 0, go: { t: "werkzeug", id: t.id } });
  }

  // 🚙 Fahrzeuge (Update 10) – aus settings.vehicles + Zusatzangaben
  const vInfo = new Map(D("fahrzeug_info").map((x) => [x.id, FZ.normInfo(x, x.id)]));
  for (const v of vehicles) {
    const inf = vInfo.get(v.id) || FZ.normInfo({}, v.id);
    const pk = FZ.pickerlStatus(inf, u.dayKey(Date.now()));
    add({ cat: "fahrzeuge", id: v.id, emoji: v.type === "privat" ? "🚗" : "🚐", title: v.plate ? `${v.name} · ${v.plate}` : v.name,
      sub: [inf.make, pk.state !== "none" ? `Pickerl ${FZ.monthLabel(pk.month)}` : "", inf.insurance.company].filter(Boolean).join(" · "),
      text: [v.plate, v.plate.replace(/[^A-Z0-9]/g, ""), inf.make, inf.notes, inf.insurance.company, inf.insurance.policy, "Auto Fahrzeug Pickerl Service"].join(" "), go: { t: "fahrzeug", id: v.id } });
  }

  // 🏡 Haushalt, 🎯 Routinen & Ziele, 🧠 Notizbuch (Update 10 C)
  const tk = u.dayKey(Date.now());
  for (const x of D("haushalt")) {
    const t = HHC.normTask(x);
    if (!t.id || !t.title) continue;
    const st = HHC.taskStatus(t, tk);
    add({ cat: "haushalt", id: t.id, emoji: t.kind === "wartung" ? "🛠️" : HHC.roomEmoji(t.room), title: t.title,
      sub: [t.room, HHC.intervalLabel(t.unit, t.n), st.label].filter(Boolean).join(" · "), text: HHC.searchText(t), ts: Number(x.updated) || 0, go: { t: "hash", h: "#alltag/haushalt" } });
  }
  for (const x of D("habits")) {
    const h = HBC.normHabit(x);
    if (!h.id || !h.title || h.archived) continue;
    const st = HBC.streak(h, tk);
    add({ cat: "routinen", id: h.id, emoji: h.emoji, title: h.title, sub: `Gewohnheit · ${HBC.progressLabel(h, tk)}${st.current ? ` · 🔥 ${st.current} ${st.unit}` : ""}`,
      text: "Gewohnheit Habit Streak", ts: Number(x.updated) || 0, go: { t: "rt", tab: "habits" } });
  }
  for (const x of D("goals")) {
    const g = HBC.normGoal(x);
    if (!g.id || !g.title) continue;
    add({ cat: "routinen", id: g.id, emoji: g.emoji, title: g.title, sub: `Ziel · ${HBC.goalProgress(g)} %${g.due ? ` · bis ${SC.fmtKey(g.due)}` : ""}`,
      text: [g.notes, g.milestones.map((m) => m.text).join(" "), "Ziel Meilenstein"].join(" "), dates: g.due ? [g.due] : [], ts: Number(x.updated) || 0, go: { t: "rt", tab: "goals" } });
  }
  for (const x of D("notes")) {
    const n = NBC.normNote(x);
    if (!n.id) continue;
    add({ cat: "notizen", id: n.id, emoji: n.pinned ? "📌" : n.fav ? "⭐" : "📝", title: NBC.noteTitle(n),
      sub: [n.coll && `📁 ${n.coll}`, n.tags.map((t) => "#" + t).join(" "), NBC.excerpt(n.text, 70)].filter(Boolean).join(" · "),
      text: [NBC.plain(n.text), n.tags.join(" "), n.coll].join(" "), ts: n.updated, boost: n.pinned ? 1 : 0, go: { t: "hash", h: NBC.noteHash(n.id) } });
  }
  // Update 10 E – 📁 Dokumente, 📜 Verträge, 📦 Inventar, 👤 Kontakte (Ziele per Hash)
  for (const x of D("dokumente")) {
    const d = DKC.normDoc(x);
    if (!d.id) continue;
    add({ cat: "dokumente", id: d.id, emoji: d.fav ? "⭐" : DKC.folderOf(d.folder).e, title: d.title,
      sub: [DKC.folderOf(d.folder).label, d.tags.map((t) => "#" + t).join(" "), d.expires ? `läuft ab ${SC.fmtKey(d.expires)}` : ""].filter(Boolean).join(" · "),
      text: DKC.searchText(d), dates: [d.date, d.expires].filter(isKey), ts: d.updated || d.created, boost: d.fav ? 1 : 0, go: { t: "hash", h: DKC.docHash(d.id) } });
  }
  for (const x of D("vertraege")) {
    const c = VTC.normContract(x);
    if (!c.id || !c.name) continue;
    add({ cat: "vertraege", id: c.id, emoji: VTC.kindById(c.kind).e, title: c.name, sub: [c.provider, VTC.statusLine(c, u.dayKey(Date.now()))].filter(Boolean).join(" · "),
      text: VTC.searchText(c), ts: c.updated, go: { t: "hash", h: VTC.contractHash(c.id) } });
  }
  for (const x of D("inventar")) {
    const it = INC.normItem(x);
    if (!it.id || !it.name) continue;
    add({ cat: "inventar", id: it.id, emoji: INC.catById(it.cat).e, title: it.name, sub: [it.brand, it.room, it.serial ? "SN " + it.serial : ""].filter(Boolean).join(" · "),
      text: INC.searchText(it), dates: [it.boughtOn, it.warrantyUntil].filter(isKey), ts: it.updated, go: { t: "hash", h: INC.itemHash(it.id) } });
  }
  for (const x of D("kontakte")) {
    const c = KTC.normContact(x);
    if (!c.id || !KTC.displayName(c)) continue;
    add({ cat: "kontakte", id: c.id, emoji: KTC.typeById(c.type).e, title: KTC.displayName(c), sub: [c.person, c.phone, c.email].filter(Boolean).join(" · "),
      text: KTC.searchText(c), ts: c.updated, go: { t: "hash", h: KTC.contactHash(c.id) } });
  }
  for (const x of D("ai_memory")) {
    const m = NBC.normMemory(x);
    if (!m.id || !m.text) continue;
    add({ cat: "notizen", id: "mem_" + m.id, emoji: "🤖", title: m.text, sub: `Was Claude sich merkt · ${NBC.areaById(m.area).label}`, text: "Gedächtnis Claude merken", ts: m.updated, go: { t: "mem" } });
  }

  // 📷 Fotos & Alben
  for (const a of D("photo_albums")) {
    if (!a || !s(a.name)) continue;
    add({ cat: "fotos", id: "a_" + a.id, emoji: s(a.emoji) || "📁", title: s(a.name), sub: `Album${s(a.addr) ? " · " + s(a.addr) : ""}`, text: s(a.note), go: { t: "album", id: a.id } });
  }
  const albumName = new Map(D("photo_albums").map((a) => [a.id, s(a.name)]));
  for (const p of photoList || []) {
    if (!p || !p.id) continue;
    const albums = (p.albumIds || []).map((id) => albumName.get(id)).filter(Boolean);
    const where = s(p.place) || s(p.addr);
    add({ cat: "fotos", id: p.id, emoji: "📷", thumb: p.thumb || "", photo: p, title: s(p.note) || where || "Foto",
      sub: [p.ts ? `${fmtKeyWd(p.dayKey || u.dayKey(p.ts))} ${u.clock(p.ts)}` : "", s(p.note) ? where : "", albums.join(", ")].filter(Boolean).join(" · "),
      text: [p.addr, albums.join(" "), ...(Array.isArray(p.tags) ? p.tags.map((x) => "#" + x + " " + x) : []), p.fav ? "favorit favoriten ⭐" : ""].join(" "), dates: isKey(p.dayKey) ? [p.dayKey] : [], ts: Number(p.ts) || 0, go: { t: "photo", id: p.id } });
  }

  // ⚡ Automationen (Update 10)
  for (const r of D("automations")) {
    if (!r || !s(r.name)) continue;
    add({ cat: "automationen", id: "au_" + r.id, emoji: s(r.emoji) || "⚡", title: s(r.name), sub: r.enabled === false ? "💤 pausiert" : "aktiv", text: "automation regel wenn dann", go: { t: "hash", hash: "#alltag/automationen" } });
  }

  // 🚗 Fahrten
  try {
    for (const t of tripsBetween(snap.entries || [], 0, Number.MAX_SAFE_INTEGER, snap.settings || {}, places)) {
      const k = u.dayKey(t.start);
      add({ cat: "fahrten", id: t.key, emoji: t.private ? "🏡" : "🚗", title: `${fromLabel(t) || "?"} → ${toLabel(t) || "?"}`,
        sub: [fmtKeyWd(k) + " " + u.clock(t.start), t.km != null ? String(Math.round(t.km * 10) / 10).replace(".", ",") + " km" : "", s(t.purpose)].filter(Boolean).join(" · "),
        text: [t.fromAddr, t.toAddr].join(" "), dates: [k], ts: t.start, trip: t, go: { t: "trip", id: t.key } });
    }
  } catch (err) { console.warn("Suche: Fahrten", err); }

  // 💶 Geld & Abos (Geld-Sperre!)
  if (moneyAllowed()) {
    const eur = (n) => (Number(n) || 0).toLocaleString("de-AT", { style: "currency", currency: "EUR" });
    for (const x of D("money_tx")) {
      if (!x) continue;
      const txt = s(x.note) || s(x.counterparty) || (x.type === "in" ? "Einnahme" : "Ausgabe");
      add({ cat: "geld", id: x.id, emoji: x.type === "in" ? "💰" : "💸", title: txt, sub: [`${x.type === "in" ? "+" : "−"}${eur(Math.abs(Number(x.amount) || 0))}`, isKey(x.date) ? fmtKeyWd(x.date) : "", s(x.cat) || s(x.category)].filter(Boolean).join(" · "),
        text: [x.counterparty, x.note].join(" "), dates: isKey(x.date) ? [x.date] : [], ts: isKey(x.date) ? new Date(x.date + "T12:00").getTime() : 0, go: { t: "geld", tab: "buchungen" } });
    }
    for (const x of D("money_subs")) {
      if (!x || !s(x.name)) continue;
      add({ cat: "geld", id: "s_" + x.id, emoji: "🔁", title: s(x.name), sub: `Abo · ${eur(x.amount)}`, text: s(x.what), boost: 5, go: { t: "geld", tab: "abos" } });
    }
    for (const x of D("money_wishes")) { // Update 10 E – 🎁 Wunschliste
      if (!x || !s(x.name)) continue;
      add({ cat: "geld", id: "w_" + x.id, emoji: x.done ? "✅" : "🎁", title: s(x.name), sub: `Wunsch · ${wishPrio(x.prio).label} · ${eur(x.price)}`, text: [x.note, "Wunschliste Wunsch"].join(" "), go: { t: "geld", tab: "planen" } });
    }
  } else if (safeLoaded()) {
    add({ cat: "geld", id: "locked", emoji: "🔒", title: "Geld gesperrt – entsperren", sub: "Buchungen und Abos werden erst nach dem Entsperren durchsucht", text: "geld gesperrt entsperren buchung abo ausgabe einnahme konto budget", always: true, go: { t: "geld", tab: "" } });
  }

  // 🎒 Schule
  const subjSeen = new Map();
  for (const n of ["school_timetable", "school_tasks", "school_exams", "school_grades"]) for (const x of D(n)) { const sj = s(x && x.subject); if (sj) subjSeen.set(sj.toLowerCase(), sj); }
  for (const sj of subjSeen.values()) add({ cat: "schule", id: "f_" + sj.toLowerCase(), emoji: "📚", title: sj, sub: "Fach", boost: 6, go: { t: "school", tab: "faecher" } });
  for (const x of D("school_exams")) {
    if (!x) continue;
    add({ cat: "schule", id: "e_" + x.id, emoji: "🎯", title: `${s(x.kind) || "Prüfung"} ${s(x.subject)}`.trim(), sub: [isKey(x.date) ? fmtKeyWd(x.date) : "", s(x.topics)].filter(Boolean).join(" · "),
      text: s(x.note), dates: isKey(x.date) ? [x.date] : [], ts: isKey(x.date) ? new Date(x.date + "T12:00").getTime() : 0, go: { t: "school", tab: "pruefungen" } });
  }
  for (const x of D("school_tasks")) {
    if (!x || !s(x.title)) continue;
    add({ cat: "schule", id: "t_" + x.id, emoji: x.done ? "☑️" : "📝", title: s(x.title), sub: ["Hausaufgabe", s(x.subject), isKey(x.due) ? "fällig " + SC.fmtKey(x.due) : "", x.done ? "erledigt" : ""].filter(Boolean).join(" · "),
      text: s(x.note), dates: isKey(x.due) ? [x.due] : [], ts: isKey(x.due) ? new Date(x.due + "T12:00").getTime() : 0, boost: x.done ? -5 : 0, go: { t: "school", tab: "aufgaben" } });
  }

  // 🧳 Unterwegs
  for (const x of D("travel_trips")) {
    if (!x) continue;
    add({ cat: "unterwegs", id: "r_" + x.id, emoji: "✈️", title: s(x.title) || s(x.dest) || "Reise", sub: [s(x.dest) !== s(x.title) ? s(x.dest) : "", isKey(x.from) ? "ab " + SC.fmtKey(x.from) : ""].filter(Boolean).join(" · "),
      text: s(x.notes), dates: isKey(x.from) ? [x.from] : [], ts: isKey(x.from) ? new Date(x.from + "T12:00").getTime() : 0, go: { t: "uw", tab: "reisen" } });
  }
  for (const l of D("travel_packing")) {
    if (!l) continue;
    add({ cat: "unterwegs", id: "p_" + l.id, emoji: "🎒", title: s(l.title) || "Packliste", sub: "Packliste", go: { t: "uw", tab: "packen" } });
    for (const c of l.cats || []) for (const it of (c && c.items) || []) {
      if (!it || !s(it.name)) continue;
      add({ cat: "unterwegs", id: "pi_" + l.id + "_" + (it.id || it.name), emoji: it.done ? "☑️" : "▫️", title: s(it.name), sub: `Packliste „${s(l.title)}“`, boost: -3, go: { t: "uw", tab: "packen" } });
    }
  }
  for (const x of D("travel_places")) {
    if (!x || !s(x.name)) continue;
    add({ cat: "unterwegs", id: "a_" + x.id, emoji: "📇", title: s(x.name), sub: [s(x.address), s(x.phone)].filter(Boolean).join(" · "), text: s(x.notes), go: { t: "uw", tab: "adressen" } });
  }

  // 🃏 Japanisch & LAP
  if (statics) {
    for (const v of statics.vocab) add({ cat: "lernen", id: "jv_" + v.id, emoji: "🇯🇵", title: `${v.kanji && v.kanji !== v.kana ? v.kanji + " · " : ""}${v.kana} – ${v.de}`, sub: `${v.romaji} · ${v.topic}`, text: v.romaji, boost: -4, go: { t: "jp" } });
    for (const c of statics.cards) add({ cat: "lernen", id: "lc_" + c.id, emoji: "⚡", title: c.q, sub: `LAP · ${c.a}`, text: c.e, boost: -6, go: { t: "lap", tab: "karten" } });
    for (const x of statics.lex || []) add({ cat: "lernen", id: "el_" + x.id, emoji: "📖", title: x.t, sub: `Elektro-Lexikon · ${x.d}`, boost: -5, go: { t: "hash", hash: `#alltag/elektro?tab=lexikon&q=${encodeURIComponent(x.t.replace(/\s*\(.*$/, ""))}` } }); // Update 10 F
    for (const f of statics.formulas) add({ cat: "lernen", id: "lf_" + f.id, emoji: "📐", title: `${f.name}: ${f.f}`, sub: `LAP-Formel · ${f.units || ""}`, text: f.m, boost: -2, go: { t: "lap", tab: "formeln" } });
  }
  for (const x of D("jp_cards")) {
    if (!x || x.kind !== "own" || !(s(x.kana) || s(x.de))) continue;
    add({ cat: "lernen", id: "jo_" + x.id, emoji: "🇯🇵", title: `${s(x.kanji) ? s(x.kanji) + " · " : ""}${s(x.kana)} – ${s(x.de)}`, sub: `${s(x.romaji)} · eigenes Wort`, text: s(x.topic), go: { t: "jp" } });
  }

  // 📋 Wochenbericht
  for (const doc of D("berichtsheft")) {
    if (!doc || !/^\d{4}-W\d{2}$/.test(String(doc.week || doc.id))) continue;
    const wk = String(doc.week || doc.id);
    for (const [k, txt] of Object.entries(doc.days || {})) {
      if (!isKey(k) || !s(txt)) continue;
      add({ cat: "bericht", id: wk + "_" + k, emoji: "📋", title: s(txt), sub: `KW ${+wk.slice(6)} · ${fmtKeyWd(k)}${doc.status === "abgegeben" ? " · abgegeben ✓" : ""}`, dates: [k], ts: new Date(k + "T12:00").getTime(), go: { t: "bericht", week: wk } });
    }
  }
  const notes = (snap.settings && snap.settings.apprentice && snap.settings.apprentice.notes) || {};
  for (const [wk, txt] of Object.entries(notes)) {
    if (!s(txt)) continue;
    add({ cat: "bericht", id: "n_" + wk, emoji: "📝", title: s(txt), sub: `Ergänzung zur ${wk.replace(/^(\d{4})-W(\d{2})$/, "KW $2/$1")}`, go: { t: "bericht", week: wk } });
  }
  // Update 10 F – ausgeschaltete Module nicht durchsuchen (Daten bleiben)
  const pst = snap.settings || {};
  if (PF.modulesOff(pst).size) { index = index.filter((it) => PF.searchAllowed(pst, it.go)); byKey = new Map(index.map((it) => [it.key, it])); }
  dirty = false;
}

function safeLoaded() { try { return lockState.isLoaded(); } catch { return false; } }

/* ---------- Anzeige ---------- */

function queueRender() {
  if (!open || renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; if (open) render(); });
}

function hl(text) {
  return SC.highlightParts(text, q).map((p) => (p.hit ? `<mark>${esc(p.t)}</mark>` : esc(p.t))).join("");
}

function pendingNames() {
  const out = [];
  if (photoList == null) out.push("Fotos");
  if (!statics) out.push("Lernkarten");
  const notLoaded = [...subs.keys()].filter((n) => { try { return !collection(n).loaded; } catch { return false; } });
  if (notLoaded.length) out.push("Alltag");
  return out;
}

function render() {
  if (!layer) return;
  const body = layer.querySelector("#srch-body");
  const status = layer.querySelector(".srch-status");
  const input = layer.querySelector("#srch-q");
  const pend = pendingNames();
  status.textContent = pend.length ? `⏳ Lade noch: ${pend.join(", ")} …` : "";
  if (!s(q) || SC.fold(q).trim().length < 1) {
    input.setAttribute("aria-expanded", "false");
    const rec = readRecent();
    body.innerHTML =
      (rec.length ? `<section class="srch-group"><h3 class="srch-gh"><span aria-hidden="true">🕘</span> Zuletzt gesucht <button type="button" class="srch-link" data-s="clear-recent">Löschen</button></h3>
        <div class="srch-chips">${rec.map((r) => `<button type="button" class="srch-chip" data-recent="${esc(r)}">${esc(r)}</button>`).join("")}</div></section>` : "") +
      `<div class="srch-hint">
        <p class="srch-hint-big">🔍 Was suchst du?</p>
        <p>Einträge, Termine, Baustellen, Material, Fotos, Fahrten, Schule, Einkauf … alles an einem Ort.</p>
        <ul>
          <li>📅 Ein Datum wie <b>12.11.</b> zeigt alles von diesem Tag</li>
          <li>🔤 Groß/klein und Umlaute sind egal – „mueller“ findet „Müller“</li>
          <li>⌨️ Am PC: <kbd>/</kbd> oder <kbd>Strg</kbd>+<kbd>K</kbd> öffnet die Suche</li>
          <li>🔐 Der Passwort-Tresor wird nie durchsucht</li>
        </ul>
      </div>`;
    return;
  }
  if (dirty) buildIndex();
  const groups = SC.search(index.filter((x) => !x.always), q, { perGroup: PER_GROUP, expanded });
  // Gesperrtes Geld: Buchungen sind nicht geladen → bei jeder Suche nur die Zeile „🔒 Geld gesperrt – entsperren“ (ohne Beträge/Texte)
  const lockRow = index.find((x) => x.always);
  if (lockRow) {
    const [, emoji, title] = SC.groupMeta("geld");
    const g = { id: "geld", emoji, title, items: [{ item: lockRow, score: 1 }], total: 1, more: 0 };
    const order = SC.GROUPS.map((x) => x[0]);
    const at = groups.findIndex((x) => order.indexOf(x.id) > order.indexOf("geld"));
    if (at < 0) groups.push(g); else groups.splice(at, 0, g);
  }
  input.setAttribute("aria-expanded", groups.length ? "true" : "false");
  if (!groups.length) {
    body.innerHTML = `<div class="srch-empty"><p class="srch-hint-big">🤔 Nichts gefunden</p><p>Zu „${esc(q)}“ gibt's nichts – probier ein anderes Wort oder ein Datum wie 12.11.</p></div>`;
    return;
  }
  let n = 0;
  body.innerHTML = `${SC.totalHits(groups) - (lockRow ? 1 : 0) ? `<p class="srch-count note">${SC.totalHits(groups) - (lockRow ? 1 : 0)} Treffer</p>` : ""}` + groups.map((g) =>
    `<section class="srch-group" data-group="${g.id}"><h3 class="srch-gh"><span aria-hidden="true">${g.emoji}</span> ${esc(g.title)} <span class="srch-n">${g.total}</span></h3>
      <div class="srch-rows">${g.items.map(({ item }) => {
        const idx = n++;
        const ic = item.thumb ? `<img class="srch-thumb" src="${esc(item.thumb)}" alt="" loading="lazy">` : `<span class="srch-ic2" aria-hidden="true">${esc(item.emoji || g.emoji)}</span>`;
        const title = SC.snippet(item.title, q, 110);
        const sub = item.sub ? SC.snippet(item.sub, q, 120) : "";
        return `<button type="button" class="srch-row${idx === active ? " on" : ""}" role="option" data-k="${esc(item.key)}" data-i="${idx}" aria-selected="${idx === active}">${ic}<span class="srch-lb"><b>${hl(title)}</b>${sub ? `<small>${hl(sub)}</small>` : ""}</span><span class="srch-chev" aria-hidden="true">›</span></button>`;
      }).join("")}</div>
      ${g.more ? `<button type="button" class="srch-more" data-more="${g.id}">${g.more} mehr ${esc(g.title)} anzeigen ▾</button>` : ""}
    </section>`).join("");
}

/* ---------- Bedienung ---------- */

function rows() { return [...layer.querySelectorAll(".srch-row")]; }

function setActive(i) {
  const r = rows();
  if (!r.length) { active = -1; return; }
  active = (i + r.length) % r.length;
  r.forEach((b, j) => { b.classList.toggle("on", j === active); b.setAttribute("aria-selected", String(j === active)); });
  r[active].scrollIntoView({ block: "nearest" });
}

function onInputKey(ev) {
  if (ev.key === "ArrowDown") { ev.preventDefault(); setActive(active + 1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive(active - 1); }
  else if (ev.key === "Enter") {
    const r = rows();
    const b = r[active >= 0 ? active : 0];
    if (b) { ev.preventDefault(); pick(b.dataset.k); }
    else if (s(q)) saveRecent(q);
  }
}

function onClick(ev) {
  if (ev.target === layer) { close(); return; } // PC: Klick neben das Fenster
  const b = ev.target.closest("[data-s]");
  if (b) {
    const a = b.dataset.s;
    if (a === "close") close();
    else if (a === "clear") { const i = layer.querySelector("#srch-q"); i.value = ""; q = ""; b.hidden = true; render(); i.focus(); }
    else if (a === "clear-recent") { lsSet(RECENT_KEY, "[]"); render(); }
    return;
  }
  const r = ev.target.closest("[data-recent]");
  if (r) { const i = layer.querySelector("#srch-q"); i.value = r.dataset.recent; q = i.value; layer.querySelector(".srch-clear").hidden = false; render(); i.focus(); return; }
  const m = ev.target.closest("[data-more]");
  if (m) { expanded.add(m.dataset.more); render(); return; }
  const row = ev.target.closest(".srch-row");
  if (row) pick(row.dataset.k);
}

function toHash(h) {
  const target = h.replace(/^#/, "");
  if (location.hash.replace(/^#/, "") === target) {
    location.hash = "alltag"; // Bereich schon offen → neu laden, damit der gewählte Reiter greift
    setTimeout(() => { location.hash = target; }, 30);
  } else location.hash = target;
}

function pick(key) {
  const it = byKey.get(key);
  if (!it) return;
  if (s(q)) saveRecent(q);
  const g = it.go || {};
  const snap = ctx.store.get() || {};
  const fail = (what) => (err) => { console.error(err); ctx.ui.toast(`${what} konnte nicht geöffnet werden.`); };
  close(() => {
    switch (g.t) {
      case "setting": window.dispatchEvent(new CustomEvent("sk:open-settings", { detail: { cat: g.id } })); break;
      case "entry": { const e = (snap.entries || []).find((x) => x.id === g.id); ctx.go("eintraege"); if (e) setTimeout(() => ctx.openEntryForm(e), 60); break; }
      case "todo": {
        const t = (snap.todos || []).find((x) => x.id === g.id);
        ctx.go("agenda");
        if (!t) break;
        if (t.kind === "geburtstag") import("./planer-cal.js").then((m) => m.openBirthdayForm(t, ctx)).catch(fail("Geburtstag"));
        else if (t.kind === "einsatz") import("./agenda.js").then((m) => m.openEinsatzForm(t.date, t, ctx)).catch(fail("Einsatz"));
        else setTimeout(() => ctx.openTodoForm(t), 60);
        break;
      }
      case "place": location.hash = siteHash(g.id).slice(1); break;
      case "einkauf": lsSet("sk-ek-list", g.list || ""); toHash("#alltag/einkauf"); break;
      case "werkzeug": toHash(WZ.toolHash(g.id)); break; // Update 10
      case "hash": toHash(g.hash || g.h); break; // Update 10 – Automationen (hash) + Phase C (h)
      case "fahrzeug": toHash(FZ.vehicleHash(g.id)); break; // Update 10
      case "rt": lsSet("sk-rt-tab", g.tab); toHash("#alltag/routinen"); break; // Update 10 C
      case "mem": lsSet("sk-nb-tab", "memory"); toHash("#alltag/notizen"); break; // Update 10 C
      case "material": lsSet("sk-mt-tab", g.status === "verbaut" ? "verbaut" : "offen"); toHash("#alltag/material"); break;
      case "album": location.hash = `alltag/galerie/a/${encodeURIComponent(g.id)}`; break;
      case "photo": {
        const p = it.photo || null;
        Promise.all([import("./gallery.js"), import("../photos.js")])
          .then(([gal, ph]) => gal.openViewer([{ ...(p || { id: g.id }) }], 0, ctx, { resolve: (x) => ph.getPhoto(x.id) })).catch(fail("Foto"));
        break;
      }
      case "trip": import("./triplog.js").then((m) => m.openTripDetail(ctx, it.trip)).catch(fail("Fahrt")); break;
      case "geld": toHash(g.tab ? `#alltag/geld?tab=${g.tab}` : "#alltag/geld"); break;
      case "school": lsSet("sk-school-tab", g.tab); toHash("#alltag/schule"); break;
      case "uw": lsSet("sk-uw-tab", g.tab); toHash("#alltag/unterwegs"); break;
      case "jp": lsSet("sk-jp-tab", "vokabeln"); toHash("#alltag/japanisch"); break;
      case "lap": lsSet("sk-lap-tab", g.tab || "karten"); toHash("#alltag/lap"); break;
      case "bericht": import("./weekreport.js").then((m) => m.openWeekReport(ctx, { week: g.week })).catch(fail("Wochenbericht")); break;
      default: break;
    }
  });
}
