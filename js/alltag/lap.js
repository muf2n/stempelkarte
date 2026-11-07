// Alltag › 🎓 LAP Elektrotechnik: Lernkarten (SRS) · Formelsammlung mit Rechnern · Rechenaufgaben · Prüfungssimulation,
// überall mit „🤖 Erklär mir das“ (Server-Modus "lehrer", ohne Werkzeuge). Aufbau wie js/alltag/japanisch.js.
// Sammlungen (js/alltag/db.js):
//   lap_cards – SRS-Stand je Karte { id:"<thema>-<nr>", ef, reps, interval, due, lapses, seen, last }
//   lap_stats – ein Dokument "me": { goal, newPerDay, year (0 = alle, 1–3 = Lehrjahr), days: { "JJJJ-MM-TT": { n, ok, fresh, cards, calc, exam } } }
//   lap_own   – eigene Karten { id:"<thema>-u…", topic, year, q, a, x, e, source:"foto"|"hand" } (siehe ./lap-own.js)
//   lap_exams – Prüfungsversuche { id, at, n, right, pct, secs, byTopic:{thema:{n,ok}}, wrong:[{id,picked}] }
// Reine Logik: ./lap-core.js (+ SRS/Serie aus ./srs-core.js), Inhalte: ./lap-data.js
import { collection, newId } from "./db.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { CARDS, TOPICS, YEARS } from "./lap-data.js";
import { dayKey, review, isLearned, bump, streak, todayCount } from "./srs-core.js";
import { weakTopics, normYear } from "./lap-core.js";
import { createExplainer } from "./lap-explain.js";
import { createLearn } from "./lap-learn.js";
import { createFormulas } from "./lap-formulas.js";
import { createPractice } from "./lap-practice.js";
import { createExam } from "./lap-exam.js";
import { createOwn } from "./lap-own.js";

const TABS = [
  ["karten", "🃏", "Lernkarten"],
  ["formeln", "📐", "Formeln"],
  ["rechnen", "🔢", "Rechnen"],
  ["pruefung", "📝", "Prüfung"],
  ["eigene", "📷", "Eigene"],
];
const TAB_KEY = "sk-lap-tab";
export const LAP_DEFAULTS = { id: "me", goal: 15, newPerDay: 10, year: 0, days: {} };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };

function injectCSS() {
  if (document.getElementById("lap-css")) return;
  const l = document.createElement("link");
  l.id = "lap-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-lap.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function mount(el) {
  injectCSS();
  const cardsCol = collection("lap_cards");
  const statsCol = collection("lap_stats");
  const examsCol = collection("lap_exams");
  const ownCol = collection("lap_own");
  const TOPIC_IDS = new Set(TOPICS.map((t) => t.id));
  let ownCache = null;
  const ownCards = () => ownCache || (ownCache = ownCol.all()
    .filter((c) => c && c.id && c.q && c.a && TOPIC_IDS.has(c.topic))
    .map((c) => ({ id: c.id, topic: c.topic, year: normYear(c.year) || 1, q: c.q, a: c.a, x: Array.isArray(c.x) && c.x.length === 3 ? c.x : [], e: c.e || "", own: true, source: c.source || "hand", created: c.created || 0 }))
    .sort((a, b) => (b.created || 0) - (a.created || 0)));
  let alive = true;
  let stats = null;
  let statsTimer = null;
  let tab = TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "karten";

  el.innerHTML =
    `<div class="lap">` +
      `<div class="lap-head" aria-live="polite"></div>` +
      `<div class="lap-yearbar" role="group" aria-label="Lehrjahr"></div>` +
      `<div class="lap-weak" hidden></div>` +
      `<div class="lap-tabs" role="tablist" aria-label="LAP-Bereiche">` +
        TABS.map(([id, em, label]) => `<button type="button" role="tab" class="lap-tab" data-tab="${id}" aria-selected="${id === tab}"><span aria-hidden="true">${em}</span><span>${label}</span></button>`).join("") +
      `</div>` +
      `<div class="lap-page" role="tabpanel"></div>` +
    `</div>`;
  const headEl = el.querySelector(".lap-head");
  const weakEl = el.querySelector(".lap-weak");
  const yearEl = el.querySelector(".lap-yearbar");
  const pageEl = el.querySelector(".lap-page");

  const today = () => dayKey();
  const curStats = () => stats || { ...LAP_DEFAULTS, ...(statsCol.get("me") || {}) };
  function saveStatsSoon() { clearTimeout(statsTimer); statsTimer = setTimeout(flushStats, 700); }
  function flushStats() {
    clearTimeout(statsTimer); statsTimer = null;
    if (!stats) return;
    statsCol.put(stats).catch((err) => console.warn("LAP-Statistik speichern:", err));
  }
  const exams = () => examsCol.all().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

  const L = {
    ui, esc, today,
    cards: () => new Map(cardsCol.all().map((c) => [c.id, c])),
    /** Alle Karten: fertige + eigene. */
    allCards: () => [...CARDS, ...ownCards()],
    own: ownCards,
    /** Gewähltes Lehrjahr (0 = alle). */
    year: () => normYear(curStats().year),
    setYear(y) {
      stats = { ...curStats(), year: normYear(y) }; lastYear = normYear(y); flushStats();
      renderYear(); renderHead();
      for (const s of Object.values(sections)) if (s.onYear) { try { s.onYear(); } catch (err) { console.error(err); } }
    },
    /** Eigene Karten speichern (neu oder – mit id – eine bestehende ändern). → Anzahl oder null bei Fehler. */
    async saveOwn(list, { source = "hand", id = null } = {}) {
      try {
        let n = 0;
        for (const c of list) {
          const cur = id ? ownCol.get(id) || {} : {};
          await ownCol.put({ ...cur, ...c, id: id || `${c.topic}-u${newId()}`, source: cur.source || source });
          n++;
        }
        return n;
      } catch (err) { console.warn("LAP eigene Karte speichern:", err); ui.toast("Konnte nicht speichern 😕"); return null; }
    },
    async removeOwn(id) {
      try { await ownCol.remove(id); if (cardsCol.get(id)) await cardsCol.remove(id); }
      catch (err) { console.warn("LAP eigene Karte löschen:", err); ui.toast("Konnte nicht löschen 😕"); }
    },
    stats: curStats,
    exams,
    weak: () => weakTopics(cardsCol.all(), exams()),
    async grade(id, q) {
      const cur = cardsCol.get(id) || {};
      const doc = { ...cur, ...review(cur, q, today()), id };
      try { await cardsCol.put(doc); } catch (err) { console.warn("LAP-Karte speichern:", err); ui.toast("Konnte nicht speichern 😕"); }
      return doc;
    },
    /** Falsch beantwortete Prüfungsfragen als „heute nochmal“ ins SRS legen. */
    async relearn(ids) {
      for (const id of ids) {
        const cur = cardsCol.get(id) || {};
        // ex: aus der Prüfung übernommene Fehler – werden in den Themen-Schwächen nicht doppelt gezählt
        try { await cardsCol.put({ ...cur, ...review(cur, 1, today()), id, ex: (cur.ex || 0) + 1 }); } catch (err) { console.warn("LAP-Karte speichern:", err); }
      }
    },
    async saveExam(res) {
      try {
        await examsCol.put(res);
        const all = exams();
        for (const old of all.slice(50)) await examsCol.remove(old.id); // höchstens 50 Versuche behalten
      } catch (err) { console.warn("LAP-Prüfung speichern:", err); ui.toast("Konnte den Versuch nicht speichern 😕"); }
    },
    async clearExams() { for (const e of examsCol.all()) await examsCol.remove(e.id); },
    count(field, ok = null, by = 1) {
      const before = streak(curStats(), today());
      const goal = curStats().goal || LAP_DEFAULTS.goal;
      const wasDone = todayCount(curStats(), today()) >= goal;
      stats = bump(curStats(), today(), field, by, ok, LAP_DEFAULTS);
      saveStatsSoon();
      renderHead();
      if (!wasDone && todayCount(stats, today()) >= goal) ui.toast("🎯 Tagesziel geschafft – stark! ⚡", 3200);
      else if (streak(stats, today()) > before && before > 0) ui.toast(`🔥 ${streak(stats, today())} Tage in Folge!`);
    },
    setNewPerDay(n) { stats = { ...curStats(), newPerDay: n }; flushStats(); },
    /** zu einem Bereich springen, optional mit Thema (z. B. aus „Schwächen“). */
    go(id, opts) { show(id, opts); },
    refresh: () => renderHead(),
  };
  L.explain = createExplainer(L);

  const sections = { karten: createLearn(L), formeln: createFormulas(L), rechnen: createPractice(L), pruefung: createExam(L), eigene: createOwn(L) };

  function renderYear() {
    if (!alive) return;
    const y = L.year();
    yearEl.innerHTML = `<span class="lap-yearlabel">🎓 Lehrjahr</span><div class="lap-seg">` +
      [...YEARS, 0].map((v) => `<button type="button" data-year="${v}" aria-pressed="${y === v}">${v ? `${v}.` : "Alle"}</button>`).join("") + `</div>`;
  }
  let active = null;

  function renderHead() {
    if (!alive) return;
    const s = curStats(), t = today();
    const states = cardsCol.all();
    const all = L.allCards();
    const ids = new Set(all.map((x) => x.id));
    const learned = states.filter((c) => isLearned(c) && ids.has(c.id)).length;
    const n = todayCount(s, t), goal = s.goal || LAP_DEFAULTS.goal;
    const pct = Math.min(100, Math.round((n / goal) * 100));
    const st = streak(s, t);
    const last = exams()[0];
    headEl.innerHTML =
      `<div class="lap-stat" title="Tage in Folge geübt"><b>🔥 ${st}</b><small>${st === 1 ? "Tag" : "Tage"} Serie</small></div>` +
      `<div class="lap-stat lap-goal" title="Übungen heute"><b>🎯 ${n}<i>/${goal}</i></b><small>heute</small><span class="lap-bar"><span style="width:${pct}%"></span></span></div>` +
      `<div class="lap-stat" title="Karten mindestens einmal gewusst"><b>🃏 ${learned}<i>/${all.length}</i></b><small>Karten gelernt</small></div>` +
      `<div class="lap-stat${last ? (last.pct >= 60 ? " ok" : " no") : ""}" title="Letzte Prüfungssimulation"><b>📝 ${last ? `${last.pct}<i>%</i>` : "–"}</b><small>letzte Prüfung</small></div>`;
    const weak = L.weak();
    weakEl.hidden = !weak.length;
    weakEl.innerHTML = weak.length
      ? `<span class="lap-weak-l">💪 Da lohnt sich Üben:</span>` + weak.map((id) => { const tp = TOPICS.find((x) => x.id === id); return tp ? `<button type="button" class="chip lap-weakchip" data-weak="${tp.id}">${tp.emoji} ${esc(tp.name)}</button>` : ""; }).join("")
      : "";
  }

  function show(id, opts) {
    if (!sections[id]) id = "karten";
    if (active && active.hide) { try { active.hide(); } catch (err) { console.error(err); } }
    tab = id; lsSet(TAB_KEY, id);
    el.querySelectorAll(".lap-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    const btn = el.querySelector(`.lap-tab[data-tab="${id}"]`);
    if (btn && btn.scrollIntoView) { try { btn.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch { /* egal */ } }
    active = sections[id];
    pageEl.innerHTML = "";
    active.show(pageEl, opts);
  }

  el.querySelector(".lap-tabs").addEventListener("click", (ev) => { const b = ev.target.closest(".lap-tab"); if (b) show(b.dataset.tab); });
  yearEl.addEventListener("click", (ev) => { const b = ev.target.closest("[data-year]"); if (b && Number(b.dataset.year) !== L.year()) L.setYear(b.dataset.year); });
  weakEl.addEventListener("click", (ev) => { const b = ev.target.closest("[data-weak]"); if (b) show("karten", { topic: b.dataset.weak }); });

  const offCards = cardsCol.watch(() => { if (!alive) return; renderHead(); if (active && active.onData) active.onData(); });
  let lastYear = null;
  const offStats = statsCol.watch(() => {
    if (!alive) return;
    if (!statsTimer) { stats = null; renderHead(); }
    if (lastYear !== null && lastYear !== L.year()) { renderYear(); for (const s of Object.values(sections)) if (s.onYear) { try { s.onYear(); } catch (err) { console.error(err); } } }
    lastYear = L.year();
  });
  const offOwn = ownCol.watch(() => { ownCache = null; if (!alive) return; renderHead(); if (active && active.onData) active.onData(); });
  const offExams = examsCol.watch(() => { if (!alive) return; renderHead(); if (active && active.onData) active.onData(); });

  renderYear();
  renderHead();
  show(tab);

  return () => {
    alive = false;
    if (active && active.hide) { try { active.hide(); } catch { /* egal */ } }
    for (const s of Object.values(sections)) if (s.destroy) { try { s.destroy(); } catch { /* egal */ } }
    L.explain.destroy();
    flushStats();
    offCards && offCards(); offStats && offStats(); offExams && offExams(); offOwn && offOwn();
  };
}
