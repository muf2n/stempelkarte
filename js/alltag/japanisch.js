// Alltag › 🇯🇵 Japanisch: Kana · Vokabeln (SRS) · Hören · Sprechen · Schreiben · Lesen · Sensei (KI-Tutor).
// Sammlungen (js/alltag/db.js):
//   jp_cards  – SRS-Stand je Lernobjekt { id, kind:"vocab"|"kana"|"own", ef, reps, interval, due, lapses, seen, last }
//               id: "v_<Starter-ID>" | "k_<Codepoint>" | "u_<zufällig>" (eigene Wörter tragen zusätzlich kana, kanji, romaji, de, topic)
//   jp_stats  – ein Dokument "me": { goal, newPerDay, days: { "JJJJ-MM-TT": { n, ok, fresh, kana, listen, speak, write, read } } }
// Reine Logik in ./jp-core.js, Inhalte in ./jp-data.js, Sprache in ./jp-speech.js.
import { collection } from "./db.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import { VOCAB } from "./jp-data.js";
import { dayKey, review, isLearned, isMastered, bump, streak, todayCount, DEFAULT_STATS, kanaList } from "./jp-core.js";
import { speak, voiceStatus, stopSpeaking } from "./jp-speech.js";
import { createKana } from "./jp-kana.js";
import { createVocab } from "./jp-vocab.js";
import { createListen, createSpeak } from "./jp-practice.js";
import { createWrite } from "./jp-write.js";
import { createRead } from "./jp-read.js";
import { createSensei } from "./jp-sensei.js";
import { createJpPath } from "./jp-path.js"; // Update 10 – 🛤️ Lernpfad

const TABS = [
  ["pfad", "🛤️", "Lernpfad"], // Update 10 – wie Duolingo (./path-ui.js)
  ["ueben", "🏋️", "Üben"], // Update 10c – frei üben, alle Fragen, gratis (./path-ui.js trainer)
  ["kana", "🔤", "Kana"],
  ["vokabeln", "🃏", "Vokabeln"],
  ["grammatik", "📐", "Grammatik"], // Update 10b – 20 Lektionen (./jp-grammar.js, nachgeladen)
  ["hoeren", "👂", "Hören"],
  ["sprechen", "🗣️", "Sprechen"],
  ["schreiben", "✍️", "Schreiben"],
  ["lesen", "📖", "Lesen"],
  ["sensei", "🎌", "Sensei"],
];
const TAB_KEY = "sk-jp-tab";
const RATE_KEY = "sk-jp-rate";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* egal */ } };
const ALL_KANA = kanaList("hira").length + kanaList("kata").length;

function injectCSS() {
  if (document.getElementById("jp-css")) return;
  const l = document.createElement("link");
  l.id = "jp-css"; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-japanisch.css", import.meta.url).href;
  document.head.appendChild(l);
  // Japanische Schrift: zuerst Systemschriften (Hiragino, Noto CJK, Yu Gothic); Noto Sans JP von Google Fonts als Ergänzung (CSP erlaubt fonts.googleapis/gstatic).
  if (!document.getElementById("jp-font")) {
    const f = document.createElement("link");
    f.id = "jp-font"; f.rel = "stylesheet";
    f.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap";
    document.head.appendChild(f);
  }
}

/** ID für ein Kana-Zeichen (Firestore-taugliche ASCII-ID). */
export const kanaId = (k) => "k_" + [...String(k)].map((c) => c.codePointAt(0).toString(16)).join("_");

/** Bereich erst beim ersten Öffnen laden (spart Startzeit). */
function lazySection(load) {
  let inst = null, pending = null, cur = null;
  return {
    show(el) {
      cur = el;
      if (inst) { inst.show(el); return; }
      el.innerHTML = `<div class="jp-card jp-center"><p class="jp-muted">⏳ Einen Moment …</p></div>`;
      (pending ||= load()).then((s) => { inst = s; if (cur === el) { el.innerHTML = ""; inst.show(el); } })
        .catch((err) => { console.error(err); if (cur === el) el.innerHTML = `<div class="jp-card"><p class="jp-muted">😕 Konnte nicht laden – bitte nochmal probieren.</p></div>`; pending = null; });
    },
    hide() { cur = null; if (inst && inst.hide) inst.hide(); },
    destroy() { if (inst && inst.destroy) inst.destroy(); },
  };
}

export function mount(el) {
  injectCSS();
  const cardsCol = collection("jp_cards");
  const statsCol = collection("jp_stats");
  let alive = true;
  let stats = null;        // lokaler Stand (wird verzögert gespeichert)
  let statsTimer = null;
  let tab = TABS.some((t) => t[0] === lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "pfad";

  el.innerHTML =
    `<div class="jp">` +
      `<div class="jp-head" aria-live="polite"></div>` +
      `<div class="jp-tabs" role="tablist" aria-label="Japanisch-Bereiche">` +
        TABS.map(([id, em, label]) => `<button type="button" role="tab" class="jp-tab" data-tab="${id}" aria-selected="${id === tab}"><span aria-hidden="true">${em}</span><span>${label}</span></button>`).join("") +
      `</div>` +
      `<div class="jp-voicehint" hidden></div>` +
      `<div class="jp-page" role="tabpanel"></div>` +
    `</div>`;
  const headEl = el.querySelector(".jp-head");
  const pageEl = el.querySelector(".jp-page");
  const hintEl = el.querySelector(".jp-voicehint");

  /* ---------- gemeinsamer Kontext für die Bereiche ---------- */
  const today = () => dayKey();
  const cardMap = () => new Map(cardsCol.all().map((c) => [c.id, c]));
  const curStats = () => stats || { ...DEFAULT_STATS, ...(statsCol.get("me") || {}) };
  function saveStatsSoon() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(flushStats, 700);
  }
  function flushStats() {
    clearTimeout(statsTimer); statsTimer = null;
    if (!stats) return;
    const s = stats;
    statsCol.put(s).catch((err) => console.warn("Japanisch-Statistik speichern:", err));
  }
  const J = {
    ui, esc, today, cards: cardMap,
    card: (id) => cardsCol.get(id),
    stats: curStats,
    rate: () => Math.max(0.5, Math.min(1.3, Number(lsGet(RATE_KEY)) || 0.9)),
    setRate: (r) => lsSet(RATE_KEY, String(r)),
    speak: (text, opts = {}) => speak(text, { rate: J.rate(), ...opts }),
    /** Lernobjekte fürs Deck: Starter-Wörter + eigene Wörter. */
    items: () => {
      const own = cardsCol.all().filter((c) => c.kind === "own" && c.kana && c.de)
        .sort((a, b) => String(a.created || "").localeCompare(String(b.created || "")))
        .map((c) => ({ id: c.id, topic: "Eigene Wörter", emoji: "⭐", kana: c.kana, kanji: c.kanji || "", romaji: c.romaji || "", de: c.de, own: true }));
      return [...VOCAB.map((v) => ({ ...v, id: "v_" + v.id })), ...own];
    },
    /** SRS-Bewertung speichern. meta: zusätzliche Felder (kind, Wortdaten bei eigenen Wörtern). */
    async grade(id, q, meta = {}) {
      const cur = cardsCol.get(id) || {};
      const next = review(cur, q, today());
      const doc = { ...cur, ...meta, ...next, id };
      try { await cardsCol.put(doc); } catch (err) { console.warn("Japanisch-Karte speichern:", err); ui.toast("Konnte nicht speichern 😕"); }
      return doc;
    },
    async putOwn(word) { return cardsCol.put({ kind: "own", created: new Date().toISOString(), ...word }); },
    async removeOwn(id) { return cardsCol.remove(id); },
    /** Übung zählen (fürs Tagesziel und die Serie). */
    count(field, ok = null, by = 1) {
      const before = streak(curStats(), today());
      const goal = curStats().goal || 20;
      const wasDone = todayCount(curStats(), today()) >= goal;
      stats = bump(curStats(), today(), field, by, ok);
      saveStatsSoon();
      renderHead();
      if (!wasDone && todayCount(stats, today()) >= goal) ui.toast("🎯 Tagesziel geschafft – すごい！ (sugoi!)", 3200);
      else if (streak(stats, today()) > before && before > 0) ui.toast(`🔥 ${streak(stats, today())} Tage in Folge!`);
    },
    setGoal(goal, newPerDay) {
      stats = { ...curStats(), ...(goal ? { goal } : {}), ...(newPerDay ? { newPerDay } : {}) };
      flushStats();
      renderHead();
    },
    kanaId,
    refresh: () => renderHead(),
  };

  const sections = {
    kana: createKana(J), vokabeln: createVocab(J), hoeren: createListen(J), sprechen: createSpeak(J),
    schreiben: createWrite(J), lesen: createRead(J), sensei: createSensei(J), pfad: createJpPath(J),
    get ueben() { return this.pfad.trainer; },
    grammatik: lazySection(() => import("./jp-grammar.js").then((m) => m.createGrammar(J))),
  };
  let active = null;

  function renderHead() {
    if (!alive) return;
    const s = curStats();
    const t = today();
    const cards = cardsCol.all();
    const learned = cards.filter((c) => c.kind !== "kana" && isLearned(c)).length;
    const kana = cards.filter((c) => c.kind === "kana" && isMastered(c)).length;
    const n = todayCount(s, t), goal = s.goal || 20;
    const pct = Math.min(100, Math.round((n / goal) * 100));
    const st = streak(s, t);
    headEl.innerHTML =
      `<div class="jp-stat" title="Tage in Folge geübt"><b>🔥 ${st}</b><small>${st === 1 ? "Tag" : "Tage"} Serie</small></div>` +
      `<div class="jp-stat jp-goal" title="Übungen heute"><b>🎯 ${n}<i>/${goal}</i></b><small>heute</small><span class="jp-bar"><span style="width:${pct}%"></span></span></div>` +
      `<div class="jp-stat" title="Wörter mindestens einmal gewusst"><b>🃏 ${learned}</b><small>Wörter gelernt</small></div>` +
      `<div class="jp-stat" title="Kana sicher gemeistert (3× richtig in Folge)"><b>🔤 ${kana}<i>/${ALL_KANA}</i></b><small>Kana gemeistert</small></div>`;
  }

  function show(id) {
    if (!sections[id]) id = "pfad";
    if (active && active.hide) { try { active.hide(); } catch (err) { console.error(err); } }
    stopSpeaking();
    tab = id; lsSet(TAB_KEY, id);
    el.querySelector(".jp").dataset.tab = id; // Lernpfad hat eigene Kopfzeile
    el.querySelectorAll(".jp-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
    const btn = el.querySelector(`.jp-tab[data-tab="${id}"]`);
    if (btn && btn.scrollIntoView) { try { btn.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch { /* egal */ } }
    active = sections[id];
    pageEl.innerHTML = "";
    active.show(pageEl);
  }

  el.querySelector(".jp-tabs").addEventListener("click", (ev) => {
    const b = ev.target.closest(".jp-tab");
    if (b) show(b.dataset.tab);
  });

  // Daten-Abos: Kopfzeile + aktiver Bereich (falls er auf Daten reagiert)
  const offCards = cardsCol.watch(() => { if (!alive) return; renderHead(); if (active && active.onData) active.onData(); });
  const offStats = statsCol.watch(() => { if (!alive) return; if (!statsTimer) { stats = null; renderHead(); } }); // fremde Änderung übernehmen, wenn nichts offen ist

  voiceStatus().then((st) => {
    if (!alive || st === "ok" || lsGet("sk-jp-voicehint") === st) return;
    hintEl.hidden = false;
    hintEl.innerHTML = `<button type="button" class="jp-x" aria-label="Hinweis ausblenden">✕</button>` + (st === "none"
      ? `🔇 Dein Browser kann leider nicht vorlesen. Zum Hören nimm am besten Chrome am Handy oder PC.`
      : `🔈 Keine japanische Stimme gefunden. Am Android: <b>Einstellungen › Sprachausgabe › Google › Sprachdaten</b> „Japanisch“ installieren. Ich probier's trotzdem 🙂`);
    hintEl.querySelector(".jp-x").addEventListener("click", () => { hintEl.hidden = true; lsSet("sk-jp-voicehint", st); });
  });

  renderHead();
  show(tab);

  return () => {
    alive = false;
    if (active && active.hide) { try { active.hide(); } catch { /* egal */ } }
    for (const s of Object.values(sections)) if (s.destroy) { try { s.destroy(); } catch { /* egal */ } }
    stopSpeaking();
    flushStats();
    offCards && offCards();
    offStats && offStats();
  };
}
