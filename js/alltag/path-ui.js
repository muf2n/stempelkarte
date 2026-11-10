// Update 10 – 🛤️ Lernpfad („wie Duolingo“): gemeinsame Oberfläche für 🇯🇵 Japanisch und 🎓 LAP Elektrotechnik.
// Logik in ./path-core.js. Pro Modul ein Adapter M (siehe jp-path.js / lap-path.js):
//   M = { module:"jp"|"lap", name, units(), lessonCtx(), check(ex, value) → bool|null, fmtNum?, speak?, stop?,
//         listen?() → {done, stop}, grade(ref, ok, ex), countStats(n, ok), practiceItems(units, mod), calc?(onTake), go?(tab),
//         flag (🇯🇵/🎓), prop ("fan"/"tool" – Funki-Deko), weakItems() (SRS-Fehler/fällig), trainTopics(), trainAll?() (alle Einheiten fürs Üben) }
// Rückgabe: Lernpfad-Bereich + .trainer (Reiter 🏋️ Üben – gleicher Player, kostet keine Energie).
// Daten: Alltag-Sammlung "learn_progress" (Dokumente "jp", "lap", "me"); 🔥 Serie zählt auch jp_stats/lap_stats mit.
import { collection } from "./db.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import * as P from "./path-core.js";

const CSS_ID = "lp-css";
let cssReady = null; // erst scrollen, wenn das Stylesheet da ist (sonst stimmt die Höhe nicht)
function injectCSS() {
  const old = document.getElementById(CSS_ID);
  if (old) { cssReady = cssReady || Promise.resolve(); return; }
  const l = document.createElement("link");
  l.id = CSS_ID; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-path.css", import.meta.url).href;
  cssReady = new Promise((res) => { l.addEventListener("load", res, { once: true }); l.addEventListener("error", res, { once: true }); setTimeout(res, 3000); });
  document.head.appendChild(l);
}
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/* ---------- ⚡ Funki – das Maskottchen (eigene Figur: kleiner Funke mit Glühbirnen-Bauch) ---------- */
const PROPS = {
  // 🪛 Schraubendreher (LAP)
  tool: `<g class="lpm-prop"><rect class="lpm-shaft" x="88.5" y="18" width="3.5" height="22" rx="1" /><path class="lpm-shaft" d="M88.5 18 L90.25 12 L92 18 Z" /><rect class="lpm-handle" x="85" y="38" width="10.5" height="17" rx="4" /><rect class="lpm-grip" x="87" y="42" width="6.5" height="2.4" rx="1" /><rect class="lpm-grip" x="87" y="47" width="6.5" height="2.4" rx="1" /></g>`,
  // 🪭 Fächer (Japanisch, runder Uchiwa)
  fan: `<g class="lpm-prop"><line class="lpm-stick" x1="88" y1="52" x2="96" y2="30" /><circle class="lpm-fan" cx="99" cy="21" r="14" /><path class="lpm-fanl" d="M99 21 L99 7 M99 21 L87 14 M99 21 L111 14 M99 21 L86 25 M99 21 L112 25" /><circle class="lpm-fandot" cx="99" cy="21" r="4.5" /></g>`,
};
export function mascot(mood = "happy", size = 96, prop = "") {
  const arms = mood === "cheer"
    ? `<path d="M22 58 L8 40" /><path d="M78 58 L92 40" />`
    : mood === "calm" ? `<path d="M24 66 L12 74" /><path d="M76 66 L88 74" />`
    : mood === "wave" ? `<path d="M23 62 L10 56" /><path d="M77 58 L92 36" />`
    : mood === "hold" ? `<path d="M23 62 L10 56" /><path d="M77 62 L89 52" />` : `<path d="M23 62 L10 56" /><path d="M77 62 L90 56" />`;
  const mouth = mood === "calm" ? `<path d="M42 62 Q50 66 58 62" class="lpm-line" />` : `<path d="M40 60 Q50 72 60 60 Z" class="lpm-mouth" />`;
  const wide = !!PROPS[prop];
  return `<svg class="lp-mascot lp-mascot-${mood}" viewBox="${wide ? "-6 -2 124 112" : "0 0 100 110"}" width="${wide ? Math.round(size * 1.24) : size}" height="${Math.round(size * 1.1)}" aria-hidden="true" focusable="false">` +
    `<g class="lpm-arms">${arms}</g>` +
    `<path class="lpm-spark" d="M50 2 L56 14 L50 11 L44 14 Z" />` +
    `<circle class="lpm-body" cx="50" cy="54" r="34" />` +
    `<path class="lpm-bolt" d="M53 70 L45 84 L49 84 L46 96 L57 80 L52 80 L56 70 Z" />` +
    `<rect class="lpm-base" x="40" y="86" width="20" height="12" rx="4" />` +
    `<circle class="lpm-eye" cx="39" cy="48" r="5" /><circle class="lpm-eye" cx="61" cy="48" r="5" />` +
    `<circle class="lpm-shine" cx="41" cy="46" r="1.6" /><circle class="lpm-shine" cx="63" cy="46" r="1.6" />` +
    `<circle class="lpm-cheek" cx="31" cy="58" r="4" /><circle class="lpm-cheek" cx="69" cy="58" r="4" />` +
    mouth + (wide ? PROPS[prop] : "") + `</svg>`;
}
const STAR = `<svg class="lp-star" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>`;

/* ---------- 🔊 kurze Töne (WebAudio) ---------- */
let actx = null;
function beep(kind) {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    actx = actx || new C();
    if (actx.state === "suspended") actx.resume();
    const t0 = actx.currentTime;
    const notes = kind === "ok" ? [[660, 0, 0.09], [990, 0.09, 0.14]] : kind === "end" ? [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.18]] : [[220, 0, 0.12], [185, 0.12, 0.16]];
    for (const [f, at, d] of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === "no" ? "triangle" : "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + d);
      o.connect(g).connect(actx.destination);
      o.start(t0 + at); o.stop(t0 + at + d + 0.02);
    }
  } catch { /* kein Ton – egal */ }
}
const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* egal */ } };

const PRAISE = ["Super! 🎉", "Klasse! ⭐", "Genau so! 💪", "Stark! ⚡", "Bravo! 🙌", "Passt! 👌"];
const fmtMin = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Lernpfad-Bereich für ein Modul.
 * @returns {{show(el), hide(), destroy(), onData(), onYear()}}
 */
export function createPath(M) {
  injectCSS();
  const col = collection("learn_progress");
  const jpStats = collection("jp_stats"), lapStats = collection("lap_stats");
  let page = null;         // Lernpfad-Seite
  let tpage = null;        // 🏋️ Üben-Seite
  let sideOpen = false;
  let openNode = null;     // id des Knotens mit offener Info-Karte
  let player = null;       // laufende Lektion
  let guide = null;        // offener 📒 Guide
  let io = null;           // IntersectionObserver fürs Banner
  let tick = null;
  let pending = null;      // lokaler Stand, bis gespeichert
  let unitsCache = null, unitsKey = null;
  const TR_KEY = `sk-lp-train-${M.module}`;
  const tr = (() => { try { return { src: "all", unit: null, topic: null, len: 10, ...JSON.parse(localStorage.getItem(TR_KEY) || "{}") }; } catch { return { src: "all", unit: null, topic: null, len: 10 }; } })();
  const saveTr = () => { try { localStorage.setItem(TR_KEY, JSON.stringify(tr)); } catch { /* egal */ } };

  /* ---------- Daten ---------- */
  const today = () => P.dayKey();
  const getMe = () => (pending && pending.me) || P.readMe(col.get("me"));
  const getMod = (id = M.module) => (pending && pending[id]) || P.readMod(col.get(id), id);
  const mods = () => [getMod("jp"), getMod("lap")];
  const stats = () => [jpStats.get("me"), lapStats.get("me")].filter(Boolean);
  const src = () => ({ mods: mods(), stats: stats(), me: getMe() });
  const units = () => { const k = M.unitsKey ? M.unitsKey() : "1"; if (!unitsCache || unitsKey !== k) { unitsCache = M.units(); unitsKey = k; } return unitsCache; };
  const mode = () => P.modeOf(getMe());
  async function save(docs) {
    pending = { ...(pending || {}), ...docs };
    try { for (const d of Object.values(docs)) await col.put(d); }
    catch (err) { console.warn("Lernpfad speichern:", err); ui.toast("Konnte den Fortschritt nicht speichern 😕"); }
    finally { pending = null; }
  }
  // 🧊 Serien-Schutz automatisch einlösen
  function checkFreeze() {
    if (!col.loaded) return;
    const r = P.applyFreezes(src(), today());
    if (r.used) { save({ me: r.me }); ui.toast(`🧊 Dein Serien-Schutz hat die Serie gerettet${r.used > 1 ? ` (${r.used} Tage)` : ""}!`, 3200); }
    // 🌅 Erster Besuch an einem neuen Tag → Energie gratis wieder voll
    if (col.get("me")) {
      const d = P.dailyRefill(getMe());
      if (d.me.energy.day !== P.readMe(col.get("me")).energy.day) save({ me: d.me });
      if (d.refilled && !r.used) ui.toast("🌅 Neuer Tag – deine Energie ist wieder voll 🔋", 3000);
    }
  }
  /** 🔋 Energie-Anzeige: Mini-Balken */
  const energyBar = (pct) => `<span class="lp-ebar" aria-hidden="true"><span style="width:${pct}%"></span></span>`;
  const energyTitle = (v) => v.inf ? "Energie-Modus Unbegrenzt – kein Verbrauch" : `Energie ${v.sub} (${v.pct} %)${v.n < P.MAX_ENERGY ? ` · +1 in ${fmtMin(v.nextIn)}` : " · voll"}${v.mode === "entspannt" ? " · Modus Entspannt" : ""}`;

  /* ---------- Kopfzeile (kompakt, eine Reihe) ---------- */
  function headHTML(withSide = true) {
    const s = src();
    const me = s.me;
    const st = P.learnStreak(s, today());
    const active = P.activeToday(s, today());
    const v = P.energyView(me);
    const xp = P.xpOn(s.mods, today());
    const goal = me.goal ? P.goalXp(me.goal) : 0;
    const pct = goal ? Math.min(100, Math.round((xp / goal) * 100)) : 0;
    return `<div class="lp-top" role="group" aria-label="Dein Lernstand">` +
      `<span class="lp-chip lp-flag" title="${esc(M.name)}" role="img" aria-label="${esc(M.name)}">${esc(M.flag || "🛤️")}</span>` +
      `<div class="lp-chip lp-streak${active ? " on" : ""}" title="Lern-Serie (Japanisch + LAP): ${st} ${st === 1 ? "Tag" : "Tage"}" aria-label="Serie ${st} ${st === 1 ? "Tag" : "Tage"}"><span aria-hidden="true">🔥</span><b>${st}</b></div>` +
      `<div class="lp-chip lp-gems" title="Edelsteine" aria-label="${me.gems || 0} Edelsteine"><span aria-hidden="true">💎</span><b>${me.gems || 0}</b></div>` +
      (v.inf
        ? `<div class="lp-chip lp-energy inf" title="${energyTitle(v)}" aria-label="Energie unbegrenzt"><span aria-hidden="true">🔋</span><b>∞</b></div>`
        : `<div class="lp-chip lp-energy${v.low ? " low" : ""}" title="${energyTitle(v)}" aria-label="Energie ${v.pct} Prozent, ${v.n} von ${P.MAX_ENERGY}"><span aria-hidden="true">🔋</span><span class="lp-eval"><b>${v.text}</b>${energyBar(v.pct)}</span><small>${v.sub}</small></div>`) +
      `<div class="lp-chip lp-xp" title="XP heute${goal ? ` · Tagesziel ${goal} XP` : ""}"><span aria-hidden="true">⚡</span><span class="lp-eval"><b>${xp}${goal ? `<i>/${goal}</i>` : ""}</b>${goal ? `<span class="lp-mini"><span style="width:${pct}%"></span></span>` : ""}</span></div>` +
      (withSide ? `<button type="button" class="lp-chip lp-morebtn" data-lp="side" aria-expanded="${sideOpen}" aria-label="Fortschritt, Energie-Modus, Laden und Abzeichen">📊</button>` : "") +
    `</div>`;
  }

  function goalPickHTML() {
    return `<div class="lp-card lp-goalpick">${mascot("happy", 64)}<div class="lp-goalpick-in"><h3 class="lp-h3">🎯 Wie viel magst du am Tag lernen?</h3>` +
      `<p class="lp-muted">Such dir ein Tagesziel aus – du kannst es später in 📊 ändern.</p>` +
      `<div class="lp-goals">${P.GOALS.map((g) => `<button type="button" class="lp-goalbtn" data-goal="${g.id}"><span aria-hidden="true">${g.emoji}</span><b>${g.name}</b><small>${g.xp} XP</small></button>`).join("")}</div></div></div>`;
  }

  /* ---------- Pfad-Ansicht ---------- */
  /** „HIRAGANA · EINHEIT 2“ + Titel fürs Banner */
  function unitMeta(u) {
    const us = units().filter((x) => x.seg === u.seg);
    const seg = String(u.seg || "").replace(/^[^\p{L}\d]+/u, "").trim();
    return { kicker: `${seg} · Einheit ${us.indexOf(u) + 1}`.toLocaleUpperCase("de"), title: u.title };
  }
  function bannerHTML(u) {
    if (!u) return "";
    const m = unitMeta(u);
    return `<div class="lp-banner lp-c${u.color}" data-unit="${esc(u.id)}">` +
      `<div class="lp-banner-t"><small>${esc(m.kicker)}</small><b>${esc(m.title)}</b></div>` +
      `<span class="lp-banner-div" aria-hidden="true"></span>` +
      `<button type="button" class="lp-guidebtn" data-lp="guide" aria-label="Guide zur Einheit ${esc(m.title)}: Tipps und Überblick"><span aria-hidden="true">📒</span><small>GUIDE</small></button></div>`;
  }
  const poses = () => (M.prop === "fan" ? [["hold", "fan"], ["wave", ""], ["cheer", ""]] : M.prop === "tool" ? [["hold", "tool"], ["wave", ""], ["cheer", ""]] : [["wave", ""], ["cheer", ""]]);
  function pathHTML() {
    const us = units();
    const mod = getMod();
    const st = P.nodeStates(us, mod);
    const ps = poses();
    let seg = null, i = 0, art = 0;
    let html = "";
    for (const u of us) {
      if (u.seg !== seg) { seg = u.seg; html += `<h3 class="lp-seg">${esc(u.seg)}</h3>`; }
      const pr = P.unitProgress(u, mod);
      const locked = u.nodes.every((n) => st[n.id] === "locked");
      html += `<section class="lp-unit lp-c${u.color}${locked ? " is-locked" : ""}" data-unit="${esc(u.id)}" aria-label="Einheit ${u.no}: ${esc(u.title)}">` +
        `<header class="lp-uhead"><span class="lp-uline" aria-hidden="true"></span><div class="lp-uhead-t"><small>Einheit ${u.no}</small><b>${esc(u.emoji)} ${esc(u.title)}</b></div>` +
        `<span class="lp-uprog" title="${pr.done} von ${pr.total} geschafft">${pr.complete ? "✅" : `${pr.done}/${pr.total}`}</span><span class="lp-uline" aria-hidden="true"></span></header>` +
        `<ol class="lp-nodes">`;
      u.nodes.forEach((n, k) => {
        const s = st[n.id];
        const crown = P.crownOf(mod, n.id);
        const gi = i++;
        const off = P.nodeOffset(gi);
        if (n.type === "chest") html += `<li class="lp-stars" style="--x:${P.nodeOffset(gi - 1) / 2 + off / 2}" aria-hidden="true">${STAR}${STAR}${STAR}</li>`;
        const icon = n.type === "chest" ? (s === "done" ? "📭" : "🎁") : n.type === "check" ? "🏆" : s === "locked" ? "🔒" : s === "done" ? "✔" : n.kind === "calc" ? "🔢" : "★";
        const label = `${n.type === "chest" ? "Schatzkiste" : n.type === "check" ? "Prüfung der Einheit" : n.title} – ${({ done: "geschafft", current: "jetzt dran", open: "frei", locked: "gesperrt", jump: "zum Überspringen" })[s]}`;
        const ringPct = Math.max(6, Math.round((pr.done / pr.total) * 100));
        const deco = k > 0 && (gi % 16 === 2 || gi % 16 === 14) ? (() => { const [mood, prop] = ps[art++ % ps.length]; return `<span class="lp-art" style="--ax:${off > 0 ? -1 : 1}" aria-hidden="true">${mascot(mood, 78, prop)}</span>`; })() : "";
        const glyph = n.type === "lesson" && s !== "locked" && s !== "done" && n.kind === "kana" ? n.emoji : icon;
        html += `<li class="lp-li" style="--x:${off}">` + deco +
          (s === "current" ? `<span class="lp-start" aria-hidden="true">START</span>` : "") +
          `<span class="lp-nwrap${s === "current" ? " ring" : ""}">` +
          (s === "current" ? `<svg class="lp-nring" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle class="bg" cx="50" cy="50" r="45" /><circle class="fg" cx="50" cy="50" r="45" pathLength="100" stroke-dasharray="${ringPct} 100" /></svg>` : "") +
          `<button type="button" class="lp-node lp-n-${n.type} is-${s}${crown >= 3 ? " gold" : ""}" data-node="${esc(n.id)}" aria-label="${esc(label)}" aria-expanded="${openNode === n.id}">` +
            `<span class="lp-node-i${n.type === "lesson" && s !== "locked" && s !== "done" && n.kind !== "calc" ? " jp-ja" : ""}" aria-hidden="true">${esc(glyph)}</span>` +
            (crown && n.type === "lesson" ? `<span class="lp-crown c${crown}" aria-hidden="true">👑<i>${crown}</i></span>` : "") +
          `</button></span>` +
          (openNode === n.id ? popHTML(n, u, s, crown, k) : "") +
        `</li>`;
      });
      html += `</ol></section>`;
    }
    return html;
  }

  function popHTML(n, u, s, crown) {
    const lessons = u.nodes.filter((x) => x.type === "lesson");
    const no = lessons.indexOf(n) + 1;
    const redo = `<button type="button" class="lp-btn lp-go ghostw" data-lp="redo" data-id="${esc(n.id)}">🏋️ NOCHMAL ÜBEN (GRATIS)</button>`;
    let body = "";
    if (s === "locked") body = `<p>🔒 Schaff zuerst die Lektion davor – dann geht's hier weiter.</p><p class="lp-pop-sub">Üben kannst du sie trotzdem schon im Reiter 🏋️ Üben.</p>`;
    else if (n.type === "chest") body = s === "done" ? `<p>📭 Schon geöffnet – da war was Feines drin.</p>` : `<p>Eine Schatzkiste! 🎁 Mach sie auf.</p><button type="button" class="lp-btn lp-go" data-lp="chest" data-id="${esc(n.id)}">🎁 ÖFFNEN</button>`;
    else if (n.type === "check") body = `<p>${s === "jump" ? "Kannst du das schon? Schaff die Prüfung und überspring die ganze Einheit 🚀" : s === "done" ? "Prüfung geschafft 🏆 – nochmal zum Auffrischen?" : "Alles aus dieser Einheit gemischt. Du schaffst das! 💪"}</p>` +
      `<button type="button" class="lp-btn lp-go" data-lp="start" data-id="${esc(n.id)}">${s === "jump" ? "🚀 ÜBERSPRINGEN" : s === "done" ? "🔁 WIEDERHOLEN" : "🏁 PRÜFUNG STARTEN"}</button>`;
    else body = `<p class="lp-pop-sub">Lektion ${no} von ${lessons.length}${crown ? ` · 👑 Stufe ${crown}/3` : ""}</p>` +
      (s === "done" && crown < 3 ? `<p>Eine perfekte Runde (ohne Fehler) bringt die nächste Kronen-Stufe 👑</p>` : "") +
      `<button type="button" class="lp-btn lp-go" data-lp="start" data-id="${esc(n.id)}">${s === "done" ? "🔁 WIEDERHOLEN · +XP" : "START ▶"}</button>` +
      (s === "done" ? redo : "");
    return `<div class="lp-pop lp-c${u.color}" role="region" aria-label="${esc(n.title)}"><b class="lp-pop-t">${esc(n.type === "chest" ? "🎁 Schatzkiste" : n.type === "check" ? `🏆 Prüfung · ${u.title}` : n.title)}</b>${body}</div>`;
  }

  /* ---------- 📒 Guide: Überblick & Tipps zur Einheit (vorhandene Inhalte) ---------- */
  function formulasFor(u) {
    const all = (u.nodes.find((n) => n.formulas) || {}).formulas || [];
    return all.filter((f) => f.topic === u.topic || (u.calc || []).some((t) => P.CALC_FORMULA[t] === f.id)).slice(0, 10);
  }
  function guideHTML(u) {
    const m = unitMeta(u);
    const st = P.nodeStates(units(), getMod());
    const lessons = u.nodes.filter((n) => n.type === "lesson");
    let body = "";
    if (u.kind === "kana") {
      body = `<h3 class="lp-gh">🔤 Zeichen dieser Einheit</h3><div class="lp-gkana">${u.items.map((it) => `<span><b class="jp-ja">${esc(it.kana)}</b><small>${esc(it.romaji)}</small></span>`).join("")}</div>` +
        `<p class="lp-gtip">💡 Sag die Lesung laut mit, wenn du ein Zeichen siehst – so merkst du es dir doppelt.</p>`;
    } else if (u.kind === "vocab") {
      body = `<h3 class="lp-gh">🃏 Wörter (${u.items.length})</h3><ul class="lp-glist">${u.items.slice(0, 60).map((w) => `<li><span class="jp-ja">${esc(w.kana)}${w.kanji ? `（${esc(w.kanji)}）` : ""}</span><small>${esc(w.romaji)}</small><b>${esc(w.de)}</b></li>`).join("")}</ul>`;
    } else if (u.kind === "grammar" && u.hint) {
      const h = u.hint;
      const ex = u.items.filter((x) => x.kind === "gx").slice(0, 4);
      body = `<h3 class="lp-gh">📐 ${esc(h.title)} <span class="jp-ja">${esc(h.short)}</span></h3>` + h.explain.map((t) => `<p>${esc(t)}</p>`).join("") +
        (h.table && h.table.length ? `<table class="lp-gtable">${h.table.map(([a, b]) => `<tr><td class="jp-ja">${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>` : "") +
        (ex.length ? `<h3 class="lp-gh">📖 Beispiele</h3><ul class="lp-glist">${ex.map((x) => `<li><span class="jp-ja">${esc(x.spaced)}</span><small>${esc(x.ro)}</small><b>${esc(x.de)}</b></li>`).join("")}</ul>` : "");
    } else {
      const fs = formulasFor(u);
      body = (fs.length ? `<h3 class="lp-gh">📐 Wichtige Formeln</h3><ul class="lp-gform">${fs.map((f) => `<li><b>${esc(f.name)}</b><code>${esc(f.f)}</code>${f.units ? `<small>${esc(f.units)}</small>` : ""}</li>`).join("")}</ul>` : "") +
        (u.items.length ? `<h3 class="lp-gh">💡 Das Wichtigste</h3><ul class="lp-gfacts">${u.items.slice(0, 8).map((c) => `<li><span>${esc(c.q)}</span><b>${esc(c.a)}</b></li>`).join("")}</ul>` : "");
    }
    const li = lessons.map((n) => `<li class="is-${st[n.id]}"><span aria-hidden="true">${st[n.id] === "done" ? "✔" : st[n.id] === "locked" ? "🔒" : "★"}</span>${esc(n.title)}</li>`).join("");
    return `<div class="lp-guide-in" role="document"><header class="lp-guide-h lp-c${u.color}"><div><small>${esc(m.kicker)}</small><b>📒 ${esc(m.title)}</b></div>` +
      `<button type="button" class="lp-x" data-g="close" aria-label="Guide schließen">✕</button></header>` +
      `<div class="lp-guide-b">${body}<h3 class="lp-gh">🛤️ Lektionen</h3><ol class="lp-glessons">${li}</ol></div>` +
      `<div class="lp-guide-f"><button type="button" class="lp-btn" data-g="train">🏋️ Diese Einheit üben (gratis)</button></div></div>`;
  }
  function openGuide(id) {
    const u = units().find((x) => x.id === id);
    if (!u) return;
    closeGuide();
    const root = document.createElement("div");
    root.className = "lp-guide";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", `Guide: ${u.title}`);
    root.innerHTML = guideHTML(u);
    document.body.appendChild(root);
    document.documentElement.classList.add("lp-lock");
    guide = { root, u, back: document.activeElement };
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-g]");
      if (!b && ev.target === root) { closeGuide(); return; }
      if (!b) return;
      if (b.dataset.g === "close") closeGuide();
      if (b.dataset.g === "train") { const unit = guide.u; closeGuide(); startTraining({ nodes: P.trainSource({ kind: "unit", id: unit.id }, { units: units() }).nodes, label: `${unit.emoji} ${unit.title}`, size: 10 }); }
    });
    document.addEventListener("keydown", onGuideKey);
    const x = root.querySelector(".lp-x");
    if (x) x.focus({ preventScroll: true });
  }
  function onGuideKey(ev) { if (ev.key === "Escape" && guide) { ev.preventDefault(); closeGuide(); } }
  function closeGuide() {
    if (!guide) return;
    document.removeEventListener("keydown", onGuideKey);
    guide.root.remove();
    const back = guide.back;
    guide = null;
    if (!player) document.documentElement.classList.remove("lp-lock");
    if (back && back.focus && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch { /* egal */ } }
  }

  /* ---------- Banner folgt der Einheit beim Scrollen (IntersectionObserver) ---------- */
  function setBanner(id) {
    const b = page && page.querySelector(".lp-banner");
    if (!b || b.dataset.unit === id) return;
    const u = units().find((x) => x.id === id);
    if (!u) return;
    const m = unitMeta(u);
    b.className = `lp-banner lp-c${u.color} lp-banner-swap`;
    b.dataset.unit = u.id;
    b.querySelector("small").textContent = m.kicker;
    b.querySelector("b").textContent = m.title;
    b.querySelector(".lp-guidebtn").setAttribute("aria-label", `Guide zur Einheit ${m.title}: Tipps und Überblick`);
  }
  function setupBanner() {
    if (io) { io.disconnect(); io = null; }
    const b = page && page.querySelector(".lp-banner");
    if (!b) return;
    const bar = document.querySelector(".appbar");
    const barH = bar && getComputedStyle(bar).position === "sticky" ? Math.round(bar.getBoundingClientRect().height) : 0;
    page.style.setProperty("--lp-sticky", `${barH}px`);
    if (typeof IntersectionObserver === "undefined") return;
    const line = barH + Math.round(b.getBoundingClientRect().height) + 8;
    const vis = new Set();
    io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) vis.add(e.target); else vis.delete(e.target); }
      const first = [...page.querySelectorAll(".lp-unit")].find((x) => vis.has(x));
      if (first) setBanner(first.dataset.unit);
    }, { rootMargin: `-${line}px 0px -55% 0px` });
    page.querySelectorAll(".lp-unit").forEach((x) => io.observe(x));
  }

  function weekSVG(week, goal) {
    const W = 280, H = 110, pad = 18, bw = 26;
    const max = Math.max(goal || 0, ...week.map((d) => d.xp), 10);
    const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    const step = (W - pad * 2) / 7;
    const y = (v) => H - 22 - (v / max) * (H - 40);
    let bars = "";
    week.forEach((d, i) => {
      const x = pad + i * step + (step - bw) / 2;
      const top = y(d.xp);
      const [yy, mm, dd] = d.day.split("-").map(Number);
      const wd = WD[new Date(yy, mm - 1, dd, 12).getDay()];
      const isToday = i === week.length - 1;
      bars += `<rect class="lp-bar${isToday ? " today" : ""}${goal && d.xp >= goal ? " hit" : ""}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw}" height="${Math.max(0, H - 22 - top).toFixed(1)}" rx="6"><title>${wd}: ${d.xp} XP</title></rect>` +
        (d.xp ? `<text class="lp-bar-v" x="${(x + bw / 2).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle">${d.xp}</text>` : "") +
        `<text class="lp-bar-l${isToday ? " today" : ""}" x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${wd}</text>`;
    });
    const gl = goal ? `<line class="lp-goalline" x1="${pad}" x2="${W - pad}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}" /><text class="lp-goal-t" x="${W - pad}" y="${(y(goal) - 4).toFixed(1)}" text-anchor="end">🎯 ${goal}</text>` : "";
    return `<svg class="lp-week" viewBox="0 0 ${W} ${H}" role="img" aria-label="XP der letzten 7 Tage: ${week.map((d) => d.xp).join(", ")}">${gl}${bars}</svg>`;
  }

  /** 🔋 Energie-Modus + gratis Auffüllen + Erklärung */
  function energyCardHTML(me) {
    const v = P.energyView(me);
    const md = P.modeOf(me);
    const fr = P.canFreeRefill(me);
    const sub = md === "unbegrenzt" ? "nicht nötig – Energie ist unbegrenzt" : fr.why === "full" ? `schon voll${md === "normal" ? " · 1× täglich gratis auffüllen" : ""}` : md === "normal" ? (fr.why === "used" ? "1× täglich gratis – heute schon genutzt, morgen wieder" : "1× täglich gratis auffüllen") : "im Modus Entspannt jederzeit gratis";
    return `<div class="lp-card lp-emode"><b class="lp-h4">🔋 Energie-Modus <small>${v.inf ? "∞ unbegrenzt" : `${v.text} · ${v.sub}`}</small></b>` +
      `<div class="lp-modes" role="radiogroup" aria-label="Energie-Modus">${P.ENERGY_MODES.map((m) => `<button type="button" class="lp-modebtn" role="radio" aria-checked="${md === m.id}" data-mode="${m.id}"><span aria-hidden="true">${m.emoji}</span><span><b>${m.name}</b><small>${esc(m.d)}</small></span></button>`).join("")}</div>` +
      `<button type="button" class="lp-shopbtn" data-lp="free-refill" ${fr.ok ? "" : "disabled"}><span aria-hidden="true">🔋</span><span><b>Jetzt auffüllen (gratis)</b><small>${sub}</small></span></button>` +
      `<details class="lp-faq"><summary>❓ Verliert man wirklich Energie?</summary>` +
        `<p>Nur im 🛤️ Lernpfad – und du verlierst dabei nie Fortschritt, XP oder deine Serie. Ist die Energie leer, pausiert nur die Lektion.</p>` +
        `<p><b>🔋 Normal:</b> jede beantwortete Übung kostet ${P.ENERGY_COST}, ein Fehler ${P.ENERGY_WRONG}. Alle ${P.COMBO_EVERY} richtigen in Folge gibt's +${P.COMBO_ENERGY} zurück. Sie lädt alle 30 min um 1 nach, ist jeden Tag wieder voll und du kannst sie 1× am Tag gratis auffüllen.</p>` +
        `<p><b>🌿 Entspannt:</b> Fehler kosten nur 1, sie lädt alle 10 min nach und „Jetzt auffüllen“ geht jederzeit.</p>` +
        `<p><b>♾️ Unbegrenzt:</b> gar kein Verbrauch. XP, Tagesziel, Kronen und Abzeichen zählen trotzdem.</p>` +
        `<p>🏋️ Üben (eigener Reiter) und „Fehler üben“ kosten nie Energie. Lektion starten geht ab ${P.ENERGY_START} 🔋.</p></details></div>`;
  }

  function sideHTML() {
    const s = src();
    const me = s.me;
    const goal = me.goal ? P.goalXp(me.goal) : 0;
    const xp = P.xpOn(s.mods, today());
    const week = P.weekXp(s.mods, today());
    const lg = P.weekLeague(s.mods, today());
    const v = P.energyView(me);
    const pct = goal ? Math.min(100, Math.round((xp / goal) * 100)) : 0;
    const ring = `<svg class="lp-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="lp-ring-bg"/><circle cx="22" cy="22" r="18" class="lp-ring-fg" stroke-dasharray="${(pct * 1.131).toFixed(1)} 200"/></svg>`;
    const got = P.ACHIEVEMENTS.filter((a) => me.ach[a.id]).length;
    return `<div class="lp-card lp-goalcard"><div class="lp-row">${ring}<div><b class="lp-h4">⚡ Tagesziel</b><p class="lp-muted">${goal ? (xp >= goal ? `Geschafft – ${xp} XP heute! 🎉` : `${xp} von ${goal} XP – noch ${goal - xp} XP`) : "Noch kein Tagesziel gewählt"}</p></div></div>` +
        `<label class="lp-set"><span>Ziel</span><select data-lp="goal" aria-label="Tagesziel">${P.GOALS.map((g) => `<option value="${g.id}"${me.goal === g.id ? " selected" : ""}>${g.emoji} ${g.name} · ${g.xp} XP</option>`).join("")}${me.goal ? "" : `<option value="" selected>– wählen –</option>`}</select></label></div>` +
      energyCardHTML(me) +
      `<div class="lp-card"><b class="lp-h4">📈 Deine Woche</b>${weekSVG(week, goal)}` +
        `<p class="lp-muted lp-league">📆 Diese Woche: <b>${lg.now} XP</b>${lg.best ? ` · Rekord der letzten 4 Wochen ${lg.best} XP${lg.now > lg.best ? " – neuer Rekord! 🥳" : ""}` : ""}</p></div>` +
      `<div class="lp-card"><b class="lp-h4">💎 Laden <small>${me.gems || 0} 💎</small></b>` +
        `<div class="lp-shop"><button type="button" class="lp-shopbtn" data-lp="buy-freeze" ${me.gems >= P.FREEZE_COST && me.freezes < P.MAX_FREEZES ? "" : "disabled"}><span aria-hidden="true">🧊</span><span><b>Serien-Schutz</b><small>${me.freezes ? `${me.freezes} bereit · ` : ""}rettet 1 verpassten Tag</small></span><i>${P.FREEZE_COST} 💎</i></button>` +
        `<button type="button" class="lp-shopbtn" data-lp="buy-energy" ${me.gems >= P.ENERGY_GEMS && !v.inf && v.n < P.MAX_ENERGY ? "" : "disabled"}><span aria-hidden="true">🔋</span><span><b>Energie auffüllen</b><small>${v.inf ? "Modus Unbegrenzt – nicht nötig" : `${v.text} (${v.sub}) – sofort wieder voll`}</small></span><i>${P.ENERGY_GEMS} 💎</i></button></div></div>` +
      `<div class="lp-card"><b class="lp-h4">🏆 Abzeichen <small>${got}/${P.ACHIEVEMENTS.length}</small></b><ul class="lp-shelf">` +
        P.ACHIEVEMENTS.map((a) => `<li class="lp-badge${me.ach[a.id] ? " got" : ""}" title="${esc(a.t)} – ${esc(a.d)}${me.ach[a.id] ? " ✔" : ""}"><span aria-hidden="true">${me.ach[a.id] ? a.e : "🔒"}</span><small>${esc(a.t)}</small></li>`).join("") +
      `</ul></div>` +
      `<div class="lp-card"><b class="lp-h4">⚙️ Einstellungen</b><label class="lp-switch"><input type="checkbox" data-lp="sound" ${me.sound !== false ? "checked" : ""}><span>🔊 Töne bei richtig/falsch</span></label></div>`;
  }

  /** Beide Ansichten neu zeichnen (nur die gerade sichtbare existiert). */
  function render() { renderPath(); renderTrain(); }
  function renderPath() {
    if (!page) return;
    const me = getMe();
    const keepY = window.scrollY;
    const us = units();
    const cur = P.currentNode(us, getMod());
    const bu = (cur && us.find((u) => u.id === cur.unit)) || us[0];
    const prevBanner = page.querySelector(".lp-banner");
    const keepUnit = prevBanner && prevBanner.dataset.unit;
    page.innerHTML = `<div class="lp lp-m-${M.module}${sideOpen ? " side-open" : ""}">` + headHTML() +
      `<div class="lp-grid"><div class="lp-main">` +
        (me.goal ? "" : goalPickHTML()) +
        `<div class="lp-card lp-practice"><span class="lp-practice-i" aria-hidden="true">🏋️</span><div><b>Fehler üben</b><small>Deine Fehler wiederholen – gratis und lädt 🔋 auf</small></div><button type="button" class="lp-btn sm" data-lp="practice">ÜBEN</button></div>` +
        bannerHTML((keepUnit && us.find((u) => u.id === keepUnit)) || bu) +
        `<div class="lp-path">${pathHTML()}</div>` +
      `</div><aside class="lp-side" aria-label="Fortschritt">${sideHTML()}</aside></div></div>`;
    window.scrollTo(0, keepY);
    setupBanner();
  }
  function renderHead() {
    for (const [el, side] of [[page, true], [tpage, false]]) {
      if (!el) continue;
      const top = el.querySelector(".lp-top");
      if (top) top.outerHTML = headHTML(side);
    }
  }
  function scrollToCurrent(smooth = false) {
    if (!page) return;
    const el = page.querySelector(".lp-node.is-current") || page.querySelector(".lp-node.is-open");
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "center", behavior: smooth && !reduceMotion() ? "smooth" : "auto" }); } catch { /* egal */ } }
  }

  /* ================= 🏋️ Üben-Reiter ================= */
  const trainTopics = () => (M.trainTopics ? M.trainTopics() : []);
  const trainAll = () => (M.trainAll ? M.trainAll() : units());
  const weakItems = () => { try { return M.weakItems ? M.weakItems() : []; } catch { return []; } };
  function trainChoice() {
    const s = { kind: tr.src, id: tr.src === "unit" ? tr.unit : tr.src === "topic" ? tr.topic : null };
    return P.trainSource(s, { units: units(), all: trainAll(), topics: trainTopics(), weak: weakItems(), seed: Date.now() });
  }
  function renderTrain() {
    if (!tpage) return;
    const keepY = window.scrollY;
    const us = units();
    const mod = getMod();
    const st = P.nodeStates(us, mod);
    const tps = trainTopics();
    const weak = weakItems();
    const left = P.trainXpLeft(getMe(), today());
    if (tr.src === "unit" && !us.some((u) => u.id === tr.unit)) { const c = P.currentNode(us, mod); tr.unit = c ? c.unit : us[0] && us[0].id; }
    if (tr.src === "topic" && !tps.some((g) => g.items.some((t) => t.id === tr.topic))) tr.topic = tps[0] && tps[0].items[0] ? tps[0].items[0].id : null;
    const allN = P.trainItems(P.trainSource({ kind: "all" }, { units: us, all: trainAll() }).nodes).length;
    const nTopics = tps.reduce((a, g) => a + g.items.length, 0);
    const srcBtn = (id, emoji, label, sub) => `<button type="button" class="lp-srcbtn" role="radio" aria-checked="${tr.src === id}" data-tr-src="${id}"><span aria-hidden="true">${emoji}</span><b>${label}</b><small>${sub}</small></button>`;
    let pick = "";
    if (tr.src === "unit") {
      let seg = null;
      pick = `<div class="lp-ulist" role="radiogroup" aria-label="Einheit wählen">` + us.map((u) => {
        const pr = P.unitProgress(u, mod);
        const pct = Math.round((pr.done / pr.total) * 100);
        const locked = u.nodes.every((n) => st[n.id] === "locked");
        const head = u.seg !== seg ? `<p class="lp-ulist-seg">${esc(seg = u.seg)}</p>` : "";
        return head + `<button type="button" class="lp-uitem lp-c${u.color}${locked ? " is-locked" : ""}" role="radio" aria-checked="${tr.unit === u.id}" data-tr-unit="${esc(u.id)}" aria-label="Einheit ${u.no}: ${esc(u.title)}, ${pct} Prozent${locked ? ", im Pfad noch gesperrt" : ""}">` +
          `<span class="lp-uitem-i" aria-hidden="true">${esc(u.emoji)}</span><span class="lp-uitem-t"><b>${esc(u.title)}</b><small>Einheit ${u.no}${locked ? " · 🔒 im Pfad gesperrt – üben geht" : pr.complete ? " · ✅ geschafft" : ""}</small></span>` +
          `<span class="lp-uitem-p"><b>${pct} %</b><span class="lp-mini"><span style="width:${pct}%"></span></span></span></button>`;
      }).join("") + `</div>`;
    } else if (tr.src === "topic") {
      pick = tps.map((g, gi) => `<details class="lp-tgroup"${g.items.some((t) => t.id === tr.topic) || (!tr.topic && gi === 0) ? " open" : ""}><summary>${esc(g.title)} <small>${g.items.length}</small></summary><div class="lp-tchips" role="radiogroup" aria-label="${esc(g.title)}">` +
        g.items.map((t) => `<button type="button" class="lp-tchip" role="radio" aria-checked="${tr.topic === t.id}" data-tr-topic="${esc(t.id)}"><span aria-hidden="true"${t.jp ? ' class="jp-ja"' : ""}>${esc(t.emoji)}</span><span${t.jp ? ' class="jp-ja"' : ""}>${esc(t.label)}</span></button>`).join("") + `</div></details>`).join("");
    } else if (tr.src === "weak") {
      pick = weak.length ? `<p class="lp-muted">🩹 ${weak.length} ${weak.length === 1 ? "Sache ist" : "Sachen sind"} gerade falsch oder fällig – die üben wir.</p>` : `<p class="lp-muted">Gerade keine Fehler offen – super! 🎉 Nimm „Alles“ oder eine Einheit.</p>`;
    } else if (tr.src === "random") pick = `<p class="lp-muted">🎲 Ich such dir eine Einheit aus – lass dich überraschen.</p>`;
    const ch = trainChoice();
    const can = ch.nodes.length > 0;
    tpage.innerHTML = `<div class="lp lp-train lp-m-${M.module}">` + headHTML(false) +
      `<div class="lp-card lp-tr-hero">${mascot("hold", 64, M.prop || "")}<div><h2 class="lp-h3">🏋️ Frei üben</h2>` +
        `<p class="lp-muted">Alle Fragen – egal wie weit du im Lernpfad bist. Kostet <b>keine 🔋 Energie</b>, deine Antworten helfen auch den Lernkarten. +1 XP je richtiger Antwort${left ? ` (heute noch ${left} von ${P.TRAIN_XP_DAY} XP)` : ` – heutiges Übe-Limit von ${P.TRAIN_XP_DAY} XP erreicht`}.</p></div></div>` +
      `<div class="lp-card"><b class="lp-h4">1 · Was willst du üben?</b>` +
        `<div class="lp-srcs" role="radiogroup" aria-label="Was üben">` +
          srcBtn("all", "🌈", "Alles", `${allN} Fragen`) + srcBtn("unit", "🛤️", "Einheit", `${us.length} Einheiten`) + srcBtn("topic", "🏷️", "Thema", `${nTopics} Themen`) +
          srcBtn("weak", "🩹", "Meine Fehler", `${weak.length} offen`) + srcBtn("random", "🎲", "Zufall", "Überraschung") +
        `</div>${pick}</div>` +
      `<div class="lp-card"><b class="lp-h4">2 · Wie viele?</b><div class="lp-lens" role="radiogroup" aria-label="Wie viele Fragen">` +
        P.TRAIN_LENGTHS.map((n) => `<button type="button" class="lp-lenbtn" role="radio" aria-checked="${tr.len === n}" data-tr-len="${n}"><b>${n || "∞"}</b><small>${n ? "Fragen" : "endlos"}</small></button>`).join("") + `</div>` +
        (tr.len ? "" : `<p class="lp-muted">Endlos: so lange du magst – tipp auf „Fertig“, wenn du aufhören willst.</p>`) + `</div>` +
      `<button type="button" class="lp-btn lp-trgo" data-tr="go" ${can ? "" : "disabled"}>🏋️ LOS GEHT'S${can && tr.src !== "random" ? ` · ${esc(ch.label)}` : ""}</button>` +
    `</div>`;
    window.scrollTo(0, keepY);
  }
  function onTrainClick(ev) {
    const b = ev.target.closest("button");
    if (!b || !tpage || !tpage.contains(b)) return;
    if (b.dataset.trSrc) { tr.src = b.dataset.trSrc; saveTr(); renderTrain(); return; }
    if (b.dataset.trUnit) { tr.unit = b.dataset.trUnit; saveTr(); renderTrain(); return; }
    if (b.dataset.trTopic) { tr.topic = b.dataset.trTopic; saveTr(); renderTrain(); return; }
    if (b.dataset.trLen != null) { tr.len = Number(b.dataset.trLen); saveTr(); renderTrain(); return; }
    if (b.dataset.tr === "go") { const ch = trainChoice(); startTraining({ nodes: ch.nodes, label: ch.label, size: tr.len }); }
  }
  const lessonCtx = () => ({ ...M.lessonCtx(), module: M.module });
  /** Freies Üben starten. size 0 = endlos. retry = fertige Übungen („Fehler nochmal üben“). */
  function startTraining({ nodes, label, size = 10, retry = null }) {
    const endless = !size && !retry;
    const ex = retry || P.buildTraining(nodes, lessonCtx(), { size: endless ? P.TRAIN_BATCH : size, seed: Date.now() });
    if (!ex.length) { ui.toast("Dafür gibt's gerade keine Übungen 😕"); return; }
    openPlayer({ node: { type: "train", id: "train", title: label || "Üben", nodes, size: retry ? ex.length : size, endless }, unit: null, ex });
  }

  /* ---------- Aktionen im Pfad ---------- */
  const findNode = (id) => { for (const u of units()) for (const n of u.nodes) if (n.id === id) return { n, u }; return null; };
  async function chest(id) {
    const f = findNode(id);
    if (!f) return;
    const r = P.openChest(getMod(), getMe(), f.n, today());
    if (!r.gems) return;
    openNode = null;
    await save({ [M.module]: r.mod, me: r.me });
    render();
    const el = page && page.querySelector(`[data-node="${CSS.escape(id)}"]`);
    if (el) el.classList.add("lp-pop-anim");
    ui.toast(`🎁 +${r.gems} 💎${r.energy ? `, +${r.energy} 🔋` : ""} und +${r.xp} XP – juhu!`, 2600);
    if (getMe().sound !== false) beep("end");
  }
  function doFreeRefill(after) {
    const r = P.freeRefill(getMe());
    if (!r.ok) { ui.toast(r.why === "used" ? "Heute schon gratis aufgefüllt – morgen wieder 🙂" : r.why === "full" ? "Deine Energie ist schon voll 🔋" : "Im Modus Unbegrenzt brauchst du das nicht ♾️"); return; }
    save({ me: r.me }).then(() => { if (after) after(); else render(); ui.toast("🔋 Energie gratis aufgefüllt – weiter geht's!"); });
  }
  function onPageClick(ev) {
    const n = ev.target.closest("[data-node]");
    if (n) { openNode = openNode === n.dataset.node ? null : n.dataset.node; render(); const el = page.querySelector(".lp-pop"); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest" }); } catch { /* egal */ } } return; }
    const mb = ev.target.closest("[data-mode]");
    if (mb) {
      const m = mb.dataset.mode;
      if (m === mode()) return;
      save({ me: P.setEnergyMode(getMe(), m) }).then(render);
      ui.toast(m === "unbegrenzt" ? "♾️ Energie unbegrenzt – üb so viel du willst!" : m === "entspannt" ? "🌿 Entspannt: Fehler kosten nur 1, lädt alle 10 min" : "🔋 Energie-Modus Normal");
      return;
    }
    const b = ev.target.closest("[data-lp],[data-goal]");
    if (!b) { if (openNode && !ev.target.closest(".lp-pop")) { openNode = null; render(); } return; }
    if (b.dataset.goal) { save({ me: { ...getMe(), goal: b.dataset.goal } }).then(render); ui.toast(`🎯 Tagesziel: ${P.goalXp(b.dataset.goal)} XP – los geht's!`); return; }
    const k = b.dataset.lp;
    if (k === "side") { sideOpen = !sideOpen; render(); if (sideOpen) { const s = page.querySelector(".lp-side"); if (s && s.scrollIntoView) { try { s.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }); } catch { /* egal */ } } } return; }
    if (k === "start") { const f = findNode(b.dataset.id); if (f) startLesson(f.n, f.u); return; }
    if (k === "redo") { const f = findNode(b.dataset.id); if (f) startTraining({ nodes: [f.n], label: `🔁 ${f.n.title}`, size: 10 }); return; }
    if (k === "guide") { const bn = b.closest(".lp-banner"); if (bn) openGuide(bn.dataset.unit); return; }
    if (k === "chest") { chest(b.dataset.id); return; }
    if (k === "practice") { startPractice(); return; }
    if (k === "free-refill") { doFreeRefill(); return; }
    if (k === "buy-freeze") { const r = P.buyFreeze(getMe()); if (r.ok) { save({ me: r.me }).then(render); ui.toast("🧊 Serien-Schutz gekauft – deine Serie ist abgesichert!"); } return; }
    if (k === "buy-energy") { const r = P.buyEnergy(getMe()); if (r.ok) { save({ me: r.me }).then(render); ui.toast("🔋 Energie wieder voll!"); } return; }
  }
  function onPageChange(ev) {
    const t = ev.target;
    if (t.dataset.lp === "goal" && t.value) { save({ me: { ...getMe(), goal: t.value } }).then(render); }
    if (t.dataset.lp === "sound") { save({ me: { ...getMe(), sound: t.checked } }); }
  }

  /* ================= Lektion (Vollbild) ================= */
  function startPractice() {
    let items = M.practiceItems(units(), getMod());
    if (!items.length) {
      // Noch nichts falsch/geschafft (z. B. Energie in der allerersten Lektion aufgebraucht) → mit der aktuellen Lektion aufwärmen,
      // damit man nie festhängt.
      const mod = getMod();
      const cur = units().flatMap((u) => u.nodes).find((n) => n.type === "lesson" && Array.isArray(n.items) && n.items.length && !mod.nodes[n.id]);
      items = cur ? cur.items.slice(0, 8) : [];
    }
    if (!items.length) { ui.toast("Noch nix zu üben – mach zuerst eine Lektion 🙂"); return; }
    startLesson({ type: "practice", id: "practice", title: "Üben", items, pool: items }, null);
  }
  function startLesson(node, unit) {
    const me = getMe();
    const practice = node.type === "practice";
    if (!practice && !P.canStart(me.energy, Date.now(), P.modeOf(me))) { openPlayer({ node, unit, ex: [], out: true }); return; }
    const ex = P.buildLesson(node, { ...lessonCtx(), seed: Date.now() });
    if (!ex.length) { ui.toast("Für diese Lektion gibt's gerade keine Übungen 😕"); return; }
    const st = P.nodeStates(units(), getMod());
    openPlayer({ node, unit, ex, jump: node.type === "check" && st[node.id] === "jump" });
  }
  function openPlayer({ node, unit, ex, out = false, jump = false }) {
    closePlayer();
    closeGuide();
    const practice = node.type === "practice";
    const train = node.type === "train";
    const root = document.createElement("div");
    root.className = "lp-player";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", practice || train ? "Üben" : node.type === "check" ? "Prüfung" : `Lektion: ${node.title}`);
    document.body.appendChild(root);
    document.documentElement.classList.add("lp-lock");
    player = {
      root, node, unit, practice, train, free: practice || train, jump,
      run: P.startRun(ex, { mode: train ? "train" : practice ? "practice" : "lesson" }),
      t0: Date.now(), checked: null, sel: null, tiles: [], match: { l: null, r: null, done: [], bad: 0 }, out, endInfo: null,
      calc: M.calc ? M.calc((text) => { const i = root.querySelector(".lp-numin"); if (i) { i.value = text; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus({ preventScroll: true }); } }) : null,
      rec: null, gained: 0,
    };
    root.addEventListener("click", onPlayerClick);
    root.addEventListener("input", onPlayerInput);
    document.addEventListener("keydown", onPlayerKey);
    root.addEventListener("submit", (e) => { e.preventDefault(); if (!player.checked) check(); });
    if (out) renderOut(); else renderEx(true);
    const f = root.querySelector(".lp-x");
    if (f) f.focus({ preventScroll: true });
  }
  function closePlayer() {
    if (!player) return;
    try { if (player.rec) player.rec.stop(); } catch { /* egal */ }
    if (M.stop) M.stop();
    document.removeEventListener("keydown", onPlayerKey);
    player.root.remove();
    player = null;
    if (!guide) document.documentElement.classList.remove("lp-lock");
  }

  const exNow = () => P.runCurrent(player.run);
  /** 🔋 oben im Player: „76 %“ + Balken + „19/25“ (bzw. ∞ / gratis) */
  function penergyHTML(v, { free = false, low = null } = {}) {
    if (v.inf) return `<span class="lp-penergy inf${free ? " free" : ""}" title="${energyTitle(v)}"><span aria-hidden="true">🔋</span><b>∞</b>${free ? `<small>gratis</small>` : `<small>unbegrenzt</small>`}</span>`;
    const isLow = low == null ? v.low : low;
    return `<span class="lp-penergy${free ? " free" : isLow ? " low" : ""}" title="${free ? "Üben kostet keine Energie · " : ""}${energyTitle(v)}"><span aria-hidden="true">🔋</span><b>${v.text}</b>${energyBar(v.pct)}<small>${free ? "gratis" : v.sub}</small></span>`;
  }
  function topHTML() {
    const r = player.run;
    const v = P.energyView(getMe());
    const pct = Math.round(P.runProgress(r) * 100);
    const answered = r.ok + r.mistakes;
    return `<div class="lp-ptop"><button type="button" class="lp-x" data-p="quit" aria-label="${player.train ? "Üben beenden" : "Lektion beenden"}">✕</button>` +
      `<div class="lp-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Fortschritt"><span style="width:${Math.max(pct, 3)}%"></span></div>` +
      (r.combo >= 3 ? `<span class="lp-combo" title="${r.combo} richtig in Folge">🔥<b>${r.combo}</b></span>` : "") +
      (player.train ? `<span class="lp-score" role="status" aria-label="${r.ok} richtig, ${r.mistakes} falsch${player.node.endless ? "" : ` von ${player.node.size}`}"><b class="ok">✔ ${r.ok}</b><b class="no">✖ ${r.mistakes}</b><small>${player.node.endless ? `${answered} · ∞` : `${Math.min(answered, player.node.size)}/${player.node.size}`}</small></span>` : "") +
      (player.train && player.node.endless ? `<button type="button" class="lp-stop" data-p="quit">Fertig</button>` : penergyHTML(v, { free: player.free })) + `</div>`;
  }

  function exHTML(ex) {
    const jp = (s) => `<span class="jp-ja">${esc(s)}</span>`;
    const txt = (s) => (ex.jp ? jp(s) : esc(s));
    const sayBtn = ex.say && M.speak ? `<button type="button" class="lp-say" data-p="say" aria-label="Vorlesen">🔊</button>` : "";
    const hint = ex.hint ? `<details class="lp-hint"${ex.hintOpen ? " open" : ""}><summary>💡 <b>${esc(ex.hint.title)}</b> <span class="jp-ja">${esc(ex.hint.short)}</span></summary>` +
      ex.hint.explain.map((t) => `<p>${esc(t)}</p>`).join("") +
      (ex.hint.table && ex.hint.table.length ? `<table>${ex.hint.table.map(([a, b]) => `<tr><td class="jp-ja">${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</table>` : "") + `</details>` : "";
    const head = (label) => hint + `<p class="lp-kind">${label}</p><h2 class="lp-q">${esc(ex.q)}</h2>`;
    const big = ex.big ? `<div class="lp-big${ex.small ? " small" : [...String(ex.big)].length > 9 ? " sent" : [...String(ex.big)].length > 4 ? " long" : ""}${/[぀-ヿ一-鿿]/.test(ex.big) ? " jp-ja" : ""}">${esc(ex.big)}${sayBtn}</div>${ex.sub ? `<p class="lp-sub">${esc(ex.sub)}</p>` : ""}` : "";
    switch (ex.type) {
      case "mc": {
        const long = ex.options.some((o) => String(o).length > 18);
        const listen = ex.mode === "listen";
        return head(listen ? "👂 Hören" : ex.mode === "formula" ? "📐 Formel" : ex.mode === "card" ? "🃏 Frage" : ex.mode === "gram" ? "📐 Grammatik" : ex.mode === "read" ? "📖 Lesen" : "✨ Wähle") +
          (listen ? `<div class="lp-listen"><button type="button" class="lp-bigsay" data-p="say" aria-label="Nochmal anhören">🔊</button><button type="button" class="lp-slowsay" data-p="slow" aria-label="Langsam anhören">🐢</button></div>` : big) +
          `<div class="lp-opts${long ? " long" : ""}" role="radiogroup" aria-label="Antworten">` +
          ex.options.map((o, i) => `<button type="button" class="lp-opt" role="radio" aria-checked="${player.sel === o}" data-opt="${i}"><kbd>${i + 1}</kbd><span>${txt(o)}</span></button>`).join("") + `</div>`;
      }
      case "tf":
        return head("🤔 Stimmt das?") + `<blockquote class="lp-claim">„${esc(ex.claim)}“</blockquote>` +
          `<div class="lp-opts lp-tf" role="radiogroup" aria-label="Stimmt das?">` +
          `<button type="button" class="lp-opt ok" role="radio" aria-checked="${player.sel === true}" data-tf="1"><kbd>1</kbd><span>✔️ Stimmt</span></button>` +
          `<button type="button" class="lp-opt no" role="radio" aria-checked="${player.sel === false}" data-tf="0"><kbd>2</kbd><span>✖️ Stimmt nicht</span></button></div>`;
      case "tiles": {
        const used = new Set(player.tiles);
        return head("🧩 Bauen") + (ex.sub ? `<p class="lp-sub">Tipp: ${esc(ex.sub)}</p>` : "") + (ex.kind === "sent" && ex.say && M.speak ? `<div class="lp-center"><button type="button" class="lp-say inline" data-p="say" aria-label="Satz vorlesen">🔊</button></div>` : "") +
          `<div class="lp-answer" aria-label="Deine Antwort" aria-live="polite">${player.tiles.length ? player.tiles.map((i, k) => `<button type="button" class="lp-tile jp-ja" data-untile="${k}">${esc(ex.tiles[i])}</button>`).join("") : `<span class="lp-muted">Tipp die Kacheln unten an 👇</span>`}</div>` +
          `<div class="lp-bank">${ex.tiles.map((t, i) => `<button type="button" class="lp-tile jp-ja" data-tile="${i}" ${used.has(i) ? "disabled" : ""}>${esc(t)}</button>`).join("")}</div>`;
      }
      case "match": {
        const m = player.match;
        const done = new Set(m.done);
        const col = (list, side) => list.map((v) => {
          const isDone = side === "l" ? done.has(v) : ex.pairs.some((p) => p.r === v && done.has(p.l));
          const sel = side === "l" ? m.l === v : m.r === v;
          return `<button type="button" class="lp-mt${isDone ? " done" : ""}${sel ? " sel" : ""}${ex.kind === "pairs" || ex.kind === "formula" ? " long" : ""}" data-m${side}="${esc(v)}" ${isDone ? "disabled" : ""} aria-pressed="${sel}"><span${/[぀-ヿ]/.test(v) ? ' class="jp-ja"' : ""}>${esc(v)}</span></button>`;
        }).join("");
        return head("🔗 Paare") + `<div class="lp-match"><div class="lp-mcol">${col(ex.left, "l")}</div><div class="lp-mcol">${col(ex.right, "r")}</div></div>`;
      }
      case "type":
        return head("⌨️ Tippen") + big + `<form class="lp-typeform" autocomplete="off"><input class="lp-typein" type="text" inputmode="latin" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Deine Antwort in Romaji" placeholder="z. B. ka" ${player.checked ? "disabled" : ""}></form>`;
      case "num":
        return head("🔢 Rechnen") +
          `<form class="lp-numform" autocomplete="off"><label class="lp-numlbl"><span>Dein Ergebnis für ${esc(ex.ask)}</span><span class="lp-numwrap"><input class="lp-numin" inputmode="decimal" aria-label="Ergebnis" placeholder="z. B. 2,5" ${player.checked ? "disabled" : ""}><i>${esc(ex.unit)}</i></span></label></form>` +
          (player.calc && !player.checked ? player.calc.html({ take: true }) : "") +
          `<p class="lp-muted">Komma oder Punkt passt. Ein bisserl Rundung ist erlaubt (±${Math.round(ex.tol * 100)} %).</p>`;
      case "speak":
        return head("🗣️ Sprechen") + big + `<div class="lp-listen"><button type="button" class="lp-bigsay mic${player.rec ? " on" : ""}" data-p="mic" aria-label="Aufnehmen">${player.rec ? "👂" : "🎤"}</button></div>` +
          `<p class="lp-muted lp-center lp-heard" aria-live="polite">${player.heard ? `Gehört: <span class="jp-ja">${esc(player.heard)}</span>` : "Tipp aufs Mikro und sag das Wort."}</p>` +
          `<button type="button" class="lp-link" data-p="skip">Kann gerade nicht sprechen</button>`;
      default: return "";
    }
  }
  const canCheck = (ex) => {
    if (!ex) return false;
    if (ex.type === "mc") return player.sel != null;
    if (ex.type === "tf") return player.sel === true || player.sel === false;
    if (ex.type === "tiles") return player.tiles.length > 0;
    if (ex.type === "type" || ex.type === "num") return true;
    return false;
  };
  function footHTML(ex) {
    if (player.checked) {
      const c = player.checked;
      const extra = c.ok ? (ex.e && (ex.kind === "card" || ex.kind === "gram" || ex.kind === "sent") ? `<p class="lp-fb-e">💡 ${esc(ex.e)}</p>` : "") :
        (ex.type === "num" && ex.steps ? `<ol class="lp-fb-steps">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ex.e ? `<p class="lp-fb-e">💡 ${esc(ex.e)}</p>` : "");
      return `<div class="lp-sheet ${c.ok ? "ok" : "no"}" role="status" aria-live="assertive">` +
        `<div class="lp-sheet-in"><div class="lp-fb-head"><span class="lp-fb-i" aria-hidden="true">${c.ok ? "✔" : "✖"}</span><div><b class="lp-fb-t">${c.ok ? esc(c.praise) : "Nicht ganz 💛"}</b>` +
        (c.ok ? (c.near ? `<p class="lp-fb-r">Fast perfekt – genau: <b>${ex.jp ? `<span class="jp-ja">${esc(c.solution)}</span>` : esc(c.solution)}</b></p>` : "") : `<p class="lp-fb-r">Richtig wäre: <b>${ex.jp || ex.type === "speak" ? `<span class="jp-ja">${esc(c.solution)}</span>` : esc(c.solution)}</b></p>`) +
        (c.bonus ? `<p class="lp-fb-en">🔋 +${c.bonus} Combo-Bonus – ${P.COMBO_EVERY} richtig in Folge!</p>` : c.gain ? `<p class="lp-fb-en">🔋 +${c.gain} Energie</p>` : "") +
        `</div></div>${extra}<button type="button" class="lp-btn lp-cont ${c.ok ? "ok" : "no"}" data-p="next">WEITER</button></div></div>`;
    }
    if (ex.type === "match" || ex.type === "speak") return `<div class="lp-foot"></div>`;
    return `<div class="lp-foot"><button type="button" class="lp-btn lp-check" data-p="check" ${canCheck(ex) ? "" : "disabled"}>PRÜFEN</button></div>`;
  }
  function renderEx(first = false) {
    if (!player) return;
    const ex = exNow();
    if (!ex) { finish(); return; }
    player.root.innerHTML = topHTML() + `<div class="lp-pbody"><div class="lp-ex" data-type="${ex.type}">${exHTML(ex)}</div></div>` + footHTML(ex);
    if (window.__skLpTest && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__skLpTest.ex = ex; // nur für die Playwright-Tests
    if (!player.checked) {
      const inp = player.root.querySelector(".lp-typein, .lp-numin");
      if (inp && (!first || window.matchMedia("(hover: hover)").matches)) inp.focus({ preventScroll: true });
      if (ex.say && (ex.mode === "listen") && M.speak) M.speak(ex.say);
    } else {
      const b = player.root.querySelector(".lp-cont");
      if (b) b.focus({ preventScroll: true });
    }
  }
  function refreshFoot() {
    const ex = exNow();
    const f = player.root.querySelector(".lp-foot .lp-check");
    if (f) f.disabled = !canCheck(ex);
  }

  /** Antwort auswerten. */
  async function check(forced) {
    const ex = exNow();
    if (!ex || player.checked) return;
    let ok = false, near = false;
    if (forced != null) ok = forced;
    else if (ex.type === "mc") ok = P.checkBasic(ex, player.sel);
    else if (ex.type === "tf") ok = P.checkBasic(ex, player.sel);
    else if (ex.type === "tiles") ok = P.checkBasic(ex, player.tiles.map((i) => ex.tiles[i]));
    else if (ex.type === "type" || ex.type === "num") {
      const inp = player.root.querySelector(".lp-typein, .lp-numin");
      const v = inp ? inp.value : "";
      if (!String(v).trim()) { ui.toast(ex.type === "num" ? "Bitte eine Zahl eingeben 🙂" : "Tipp zuerst deine Antwort 🙂"); return; }
      const r = M.check(ex, v);
      if (r == null) { ui.toast("Bitte eine Zahl eingeben 🙂"); return; }
      ok = r === true || r === "near"; near = r === "near";
    }
    player.checked = { ok, near, praise: PRAISE[Math.floor(Math.random() * PRAISE.length)], solution: P.solutionText(ex, M.fmtNum) };
    player.run = P.answerRun(player.run, ok);
    const me = getMe();
    const md = P.modeOf(me);
    if (player.train || (player.free && P.isUnlimited(md))) { /* 🏋️ freies Üben / Unbegrenzt: keine Energie */ }
    else if (!player.practice) {
      const r = P.spendEnergy(me.energy, { correct: ok, combo: player.run.combo, mode: md });
      player.checked.cost = r.cost; player.checked.bonus = r.bonus;
      if (r.cost || r.bonus) await save({ me: { ...me, energy: r.energy } });
    } else if (ok) {
      const r = P.practiceGain(me.energy, player.gained, Date.now(), md);
      if (r.add) { player.gained += r.add; player.checked.gain = r.add; await save({ me: { ...me, energy: r.energy } }); }
    }
    if (me.sound !== false) beep(ok ? "ok" : "no");
    if (!ok) vibrate(60);
    renderEx();
    if (!ok) { const s = player.root.querySelector(".lp-ex"); if (s && !reduceMotion()) s.classList.add("lp-shake"); }
  }
  async function next() {
    if (!player) return;
    if (!player.free && P.isOut(getMe().energy, Date.now(), mode())) {
      // Fehler auch bei abgebrochener Lektion merken → „Fehler üben“ hat etwas zu tun
      try { for (const [ref, good] of Object.entries(player.run.refs || {})) await M.grade(ref, good); } catch (err) { console.warn(err); }
      player.out = true; renderOut(); return;
    }
    // ∞ endlos üben: rechtzeitig neue Übungen nachlegen
    if (player.train && player.node.endless && player.run.queue.length - player.run.pos <= 2) {
      player.run = P.extendRun(player.run, P.buildTraining(player.node.nodes, lessonCtx(), { size: P.TRAIN_BATCH, seed: Date.now() }));
    }
    player.run = P.nextRun(player.run);
    player.checked = null; player.sel = null; player.tiles = []; player.match = { l: null, r: null, done: [], bad: 0 }; player.heard = "";
    if (player.calc) player.calc.reset();
    renderEx();
    const b = player.root.querySelector(".lp-pbody");
    if (b) b.scrollTop = 0;
  }

  function renderOut() {
    const me = getMe();
    const v = P.energyView(me);
    if (v.inf) { closePlayer(); render(); return; } // ♾️ Unbegrenzt: nie „keine Energie“
    const h = P.energyNow(me.energy, Date.now(), P.modeOf(me));
    const empty = h.n <= 0;
    const fr = P.canFreeRefill(me);
    player.root.innerHTML = `<div class="lp-ptop"><button type="button" class="lp-x" data-p="close" aria-label="Schließen">✕</button>` +
      `<span class="lp-flex"></span>${penergyHTML(v, { low: true })}</div>` +
      `<div class="lp-pbody lp-center lp-out">${mascot("calm", 120)}<h2 class="lp-q">${empty ? "Keine Energie mehr 🪫" : "Zu wenig Energie 🪫"}</h2>` +
      `<p class="lp-lead">${empty ? "Funki braucht eine kleine Ladepause – üb kurz oder lade auf 💪" : `Für eine Lektion brauchst du mindestens ${P.ENERGY_START} 🔋 – üb kurz, das lädt auf 💪`}</p>` +
      `<p class="lp-muted">+1 🔋 in ${fmtMin(h.nextIn)} · morgen ist sie wieder voll – der Rest der App geht natürlich ganz normal weiter.</p>` +
      `<div class="lp-outbtns">` + (fr.ok ? `<button type="button" class="lp-btn lp-free" data-p="free">🔋 Jetzt auffüllen (gratis)${P.modeOf(me) === "normal" ? " · 1× täglich" : ""}</button>` : "") +
      `<button type="button" class="lp-btn${fr.ok ? " ghost" : ""}" data-p="practice">🏋️ Üben (gratis, lädt Energie)</button>` +
      `<button type="button" class="lp-btn ghost" data-p="buy" ${me.gems >= P.ENERGY_GEMS ? "" : "disabled"}>🔋 Auffüllen · ${P.ENERGY_GEMS} 💎 <small>(du hast ${me.gems || 0})</small></button>` +
      `<button type="button" class="lp-btn ghost" data-p="close">Später weiter</button></div>` +
      `<p class="lp-muted">💡 Lieber ohne Pause? In 📊 kannst du den 🔋 Energie-Modus auf „Entspannt“ oder „Unbegrenzt“ stellen.</p></div>`;
  }

  async function finish() {
    const p = player;
    const r = p.run;
    if (p.train) { await finishTrain(p); return; }
    const kind = p.practice ? "practice" : p.node.type === "check" ? "check" : "lesson";
    const rewards = P.lessonRewards({ mistakes: r.mistakes, maxCombo: r.maxCombo, kind });
    const before = P.learnStreak(src(), today());
    const wasActive = P.activeToday(src(), today());
    const goal = getMe().goal ? P.goalXp(getMe().goal) : 0;
    const xpBefore = P.xpOn(mods(), today());
    const applied = P.applyLesson(getMod(), getMe(), { node: p.node, unit: p.unit, rewards, ok: r.ok, day: today(), jump: p.jump });
    let me = applied.me;
    pending = { ...(pending || {}), [M.module]: applied.mod, me };
    const after = P.learnStreak(src(), today());
    const tags = [...P.completedTags(units(), applied.mod), ...(M.module === "lap" ? P.lapTags(units(), applied.mod) : [])];
    const fresh = P.newAchievements(me, { lessons: me.lessons, streak: after, ok: me.ok, perfect: me.perfect, xp: P.totalXp(mods()), crown3: P.hasCrown3(mods()), tags });
    if (fresh.length) { me = { ...me, ach: { ...me.ach } }; for (const id of fresh) me.ach[id] = Date.now(); }
    await save({ [M.module]: applied.mod, me });
    // SRS + klassische Statistik
    try {
      for (const [ref, good] of Object.entries(r.refs)) await M.grade(ref, good);
      M.countStats(r.ok + r.mistakes, r.ok);
    } catch (err) { console.warn("Lernpfad → SRS:", err); }
    const secs = Math.round((Date.now() - p.t0) / 1000);
    const xpNow = P.xpOn(mods(), today());
    p.endInfo = { rewards, acc: P.runAccuracy(r), secs, streak: after, streakUp: !wasActive && after > before, crown: applied.crown, first: applied.first, fresh, goalHit: goal && xpBefore < goal && xpNow >= goal };
    if (getMe().sound !== false) beep("end");
    renderEnd();
  }

  /** 🏋️ freies Üben fertig (oder mit ✕/Fertig beendet): XP klein, SRS, Statistik → Ergebnis mit „Fehler nochmal üben“. */
  async function finishTrain(p) {
    const r = p.run;
    const answered = r.ok + r.mistakes;
    if (!answered) { closePlayer(); render(); return; }
    p.done = true;
    const before = P.learnStreak(src(), today());
    const wasActive = P.activeToday(src(), today());
    const goal = getMe().goal ? P.goalXp(getMe().goal) : 0;
    const xpBefore = P.xpOn(mods(), today());
    const a = P.applyTraining(getMod(), getMe(), { ok: r.ok, day: today() });
    let me = a.me;
    pending = { ...(pending || {}), [M.module]: a.mod, me };
    const after = P.learnStreak(src(), today());
    const fresh = P.newAchievements(me, { lessons: me.lessons, streak: after, ok: me.ok, perfect: me.perfect, xp: P.totalXp(mods()), crown3: P.hasCrown3(mods()), tags: [] });
    if (fresh.length) { me = { ...me, ach: { ...me.ach } }; for (const id of fresh) me.ach[id] = Date.now(); }
    await save({ [M.module]: a.mod, me });
    try {
      for (const [ref, good] of Object.entries(r.refs)) await M.grade(ref, good);
      M.countStats(answered, r.ok);
    } catch (err) { console.warn("Üben → SRS:", err); }
    if (!player || player !== p) return;
    p.retry = P.mistakeExercises(r, Date.now());
    p.endInfo = { train: true, xp: a.xp, capped: a.capped, acc: P.runAccuracy(r), secs: Math.round((Date.now() - p.t0) / 1000), ok: r.ok, answered, streak: after, streakUp: !wasActive && after > before, fresh, goalHit: goal && xpBefore < goal && P.xpOn(mods(), today()) >= goal };
    if (getMe().sound !== false) beep("end");
    renderEndTrain();
  }
  function renderEndTrain() {
    const e = player.endInfo;
    const nr = player.retry.length;
    const ach = e.fresh.map((id) => P.ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
    player.root.innerHTML = (e.acc >= 80 ? confetti() : "") +
      `<div class="lp-pbody lp-center lp-end lp-trend">${mascot(e.acc >= 80 ? "cheer" : "hold", 120, e.acc >= 80 ? "" : M.prop || "")}<h2 class="lp-endt">${e.acc === 100 ? "Fehlerfrei geübt! ✨" : "Fein geübt! 🏋️"}</h2>` +
      `<p class="lp-lead">${esc(player.node.title)} · <b>${e.ok} von ${e.answered}</b> richtig</p>` +
      `<div class="lp-tiles">` +
        `<div class="lp-tile-s acc"><small>Genauigkeit</small><b>${e.acc} %</b><span>🎯 ${e.ok}/${e.answered}</span></div>` +
        `<div class="lp-tile-s xp"><small>XP</small><b>+${e.xp}</b><span>⚡${e.capped ? " Tageslimit" : ""}</span></div>` +
        `<div class="lp-tile-s time"><small>Zeit</small><b>${fmtTime(e.secs)}</b><span>⏱️</span></div>` +
      `</div>` +
      `<div class="lp-endlist">` +
        `<p class="lp-streakline${e.streakUp ? " up" : ""}"><span class="lp-flame" aria-hidden="true">🔥</span> ${e.streak} ${e.streak === 1 ? "Tag" : "Tage"} Serie${e.streakUp ? " – weiter so!" : ""}</p>` +
        `<p>🔋 Keine Energie verbraucht · 🃏 Ergebnisse sind in deinen Lernkarten</p>` +
        (e.capped ? `<p>⚡ Übe-Limit erreicht (${P.TRAIN_XP_DAY} XP am Tag) – für mehr XP geht's im 🛤️ Lernpfad weiter.</p>` : "") +
        (e.goalHit ? `<p>🎯 Tagesziel geschafft!</p>` : "") +
        ach.map((a) => `<p class="lp-achnew">🏆 Neues Abzeichen: <b>${a.e} ${esc(a.t)}</b></p>`).join("") +
      `</div>` +
      `<div class="lp-outbtns">${nr ? `<button type="button" class="lp-btn lp-retry" data-p="retry">🔁 Fehler nochmal üben (${nr})</button>` : ""}` +
        (player.node.nodes && player.node.nodes.length ? `<button type="button" class="lp-btn ghost" data-p="again">🏋️ Nochmal – neue Fragen</button>` : "") + `</div></div>` +
      `<div class="lp-foot"><button type="button" class="lp-btn lp-done" data-p="done">FERTIG</button></div>`;
    const b = player.root.querySelector(".lp-retry, .lp-done");
    if (b) b.focus({ preventScroll: true });
  }

  function confetti() {
    if (reduceMotion()) return "";
    const C = ["#f59e0b", "#10b981", "#6366f1", "#ec4899", "#06b6d4", "#facc15"];
    let s = "";
    for (let i = 0; i < 28; i++) s += `<i style="--l:${(i * 37) % 100}%;--d:${(i % 7) * 0.12}s;--c:${C[i % C.length]};--r:${(i * 53) % 360}deg"></i>`;
    return `<div class="lp-confetti" aria-hidden="true">${s}</div>`;
  }
  function renderEnd() {
    const e = player.endInfo;
    const title = player.practice ? "Fein geübt! 🏋️" : player.node.type === "check" ? (player.jump ? "Einheit übersprungen! 🚀" : "Prüfung geschafft! 🏆") : e.rewards.perfect ? "Perfekte Lektion! ✨" : "Lektion geschafft! 🎉";
    const crownTxt = !player.practice && player.node.type === "lesson" ? (e.first ? "👑 Krone Stufe 1 freigeschaltet" : e.crown >= 3 && e.rewards.perfect ? "👑 Goldkrone – Stufe 3!" : e.rewards.perfect ? `👑 Krone Stufe ${e.crown}` : "") : "";
    const ach = e.fresh.map((id) => P.ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
    player.root.innerHTML = confetti() +
      `<div class="lp-pbody lp-center lp-end">${mascot("cheer", 130)}<h2 class="lp-endt">${title}</h2>` +
      `<p class="lp-lead">${e.rewards.perfect ? "Kein einziger Fehler – Funki ist stolz auf dich! ⚡" : "Fehler gehören dazu – die kommen bald nochmal dran 💪"}</p>` +
      `<div class="lp-tiles">` +
        `<div class="lp-tile-s xp"><small>XP</small><b>+${e.rewards.xp}</b><span>⚡${e.rewards.combo ? ` inkl. Combo +${e.rewards.combo}` : ""}</span></div>` +
        `<div class="lp-tile-s acc"><small>Genauigkeit</small><b>${e.acc} %</b><span>🎯</span></div>` +
        `<div class="lp-tile-s time"><small>Zeit</small><b>${fmtTime(e.secs)}</b><span>⏱️</span></div>` +
      `</div>` +
      `<div class="lp-endlist">` +
        `<p class="lp-streakline${e.streakUp ? " up" : ""}"><span class="lp-flame" aria-hidden="true">🔥</span> ${e.streak} ${e.streak === 1 ? "Tag" : "Tage"} Serie${e.streakUp ? " – weiter so!" : ""}</p>` +
        `<p>💎 +${e.rewards.gems} Edelsteine${player.practice && player.gained ? ` · 🔋 +${player.gained} Energie` : ""}</p>` +
        (crownTxt ? `<p>${crownTxt}</p>` : "") +
        (e.goalHit ? `<p>🎯 Tagesziel geschafft!</p>` : "") +
        ach.map((a) => `<p class="lp-achnew">🏆 Neues Abzeichen: <b>${a.e} ${esc(a.t)}</b></p>`).join("") +
      `</div></div>` +
      `<div class="lp-foot"><button type="button" class="lp-btn lp-done" data-p="done">WEITER</button></div>`;
    const b = player.root.querySelector(".lp-done");
    if (b) b.focus({ preventScroll: true });
  }

  /* ---------- Eingaben im Player ---------- */
  async function speakNow(slow) { const ex = exNow(); if (ex && ex.say && M.speak) M.speak(ex.say, slow ? { rate: 0.55 } : {}); }
  async function mic() {
    const ex = exNow();
    if (!ex || !M.listen || player.rec) return;
    const rec = M.listen((t) => { const h = player && player.root.querySelector(".lp-heard"); if (h) h.textContent = "…" + t; });
    player.rec = rec;
    renderEx();
    const res = await rec.done;
    if (!player || player.rec !== rec) return;
    player.rec = null;
    if (res.error && !res.alts.length) { player.heard = ""; renderEx(); ui.toast(M.srError ? M.srError(res.error) : "Hat nicht geklappt – probier's nochmal 🙂"); return; }
    player.heard = res.alts[0] || "";
    const r = M.check(ex, res.alts);
    check(r === true || r === "near");
  }
  function onPlayerClick(ev) {
    if (!player) return;
    if (player.calc && player.calc.click(ev)) return;
    const ex = exNow();
    const b = ev.target.closest("button");
    if (!b || !player.root.contains(b)) return;
    const k = b.dataset.p;
    if (k === "quit") {
      if (player.train) { if (player.done) { closePlayer(); render(); } else finishTrain(player); return; } // Üben: ✕ / Fertig → Ergebnis
      if (!player.checked && player.run.solved.length && !confirmQuit()) return; closePlayer(); render(); return;
    }
    if (k === "retry") { const node = player.node, ex = player.retry; closePlayer(); startTraining({ nodes: node.nodes, label: "🔁 Fehler nochmal", retry: ex }); return; }
    if (k === "again") { const node = player.node; closePlayer(); startTraining({ nodes: node.nodes, label: node.title.replace(/^🔁 Fehler nochmal$/, "🏋️ Üben"), size: node.endless ? 0 : node.size || 10 }); return; }
    if (k === "free") { doFreeRefill(() => { closePlayer(); render(); }); return; }
    if (k === "close") { closePlayer(); render(); return; }
    if (k === "practice") { closePlayer(); startPractice(); return; }
    if (k === "buy") { const r = P.buyEnergy(getMe()); if (r.ok) { save({ me: r.me }).then(() => { closePlayer(); render(); ui.toast("🔋 Energie wieder voll – weiter geht's!"); }); } return; }
    if (k === "done") { const wasTrain = player.train; closePlayer(); openNode = null; render(); if (wasTrain) return; scrollToCurrent(true); const e = page && page.querySelector(".lp-node.is-current"); if (e) e.classList.add("lp-pop-anim"); return; }
    if (k === "next") { next(); return; }
    if (k === "check") { check(); return; }
    if (k === "say") { speakNow(false); return; }
    if (k === "slow") { speakNow(true); return; }
    if (k === "mic") { mic(); return; }
    if (k === "skip") { player.run = P.skipRun(player.run); player.checked = null; renderEx(); return; }
    if (player.checked || !ex) return;
    if (b.dataset.opt != null) { player.sel = ex.options[Number(b.dataset.opt)]; selectIn(b); return; }
    if (b.dataset.tf != null) { player.sel = b.dataset.tf === "1"; selectIn(b); return; }
    if (b.dataset.tile != null) { player.tiles.push(Number(b.dataset.tile)); renderEx(); return; }
    if (b.dataset.untile != null) { player.tiles.splice(Number(b.dataset.untile), 1); renderEx(); return; }
    if (b.dataset.ml != null || b.dataset.mr != null) { matchTap(ex, b); return; }
  }
  function confirmQuit() { try { return window.confirm("Lektion wirklich abbrechen? Dein Fortschritt in dieser Lektion geht verloren."); } catch { return true; } }
  function selectIn(btn) {
    player.root.querySelectorAll(".lp-opt").forEach((o) => o.setAttribute("aria-checked", String(o === btn)));
    refreshFoot();
  }
  async function matchTap(ex, b) {
    const m = player.match;
    if (b.dataset.ml != null) m.l = m.l === b.dataset.ml ? null : b.dataset.ml;
    else m.r = m.r === b.dataset.mr ? null : b.dataset.mr;
    if (m.l != null && m.r != null) {
      if (P.matchPair(ex, m.l, m.r)) {
        m.done.push(m.l);
        if (getMe().sound !== false) beep("ok");
        m.l = m.r = null;
        if (m.done.length === ex.pairs.length) { renderEx(); setTimeout(() => { if (player && exNow() === ex) check(m.bad === 0); }, 250); return; }
      } else {
        m.bad++;
        const L = m.l, R = m.r;
        m.l = m.r = null;
        renderEx();
        vibrate(40);
        for (const el of player.root.querySelectorAll(".lp-mt")) if (el.dataset.ml === L || el.dataset.mr === R) el.classList.add("bad");
        if (getMe().sound !== false) beep("no");
        return;
      }
    }
    renderEx();
  }
  function onPlayerInput(ev) {
    if (player && player.calc && player.calc.input(ev)) return;
  }
  function onPlayerKey(ev) {
    if (!player) return;
    if (player.calc && player.calc.key(ev)) return;
    if (ev.key === "Escape") { ev.preventDefault(); if (player.train && !player.done && player.run.ok + player.run.mistakes) { finishTrain(player); return; } closePlayer(); render(); return; }
    const ex = exNow();
    const inField = ev.target.matches && ev.target.matches("input, textarea, select");
    if (ev.key === "Enter" && !inField) {
      const btn = player.root.querySelector(".lp-cont, .lp-done, .lp-check:not([disabled])");
      if (btn) { ev.preventDefault(); btn.click(); }
      return;
    }
    if (!inField && !player.checked && ex && /^[1-9]$/.test(ev.key)) {
      const i = Number(ev.key) - 1;
      const o = player.root.querySelectorAll(".lp-opt")[i];
      if (o) { ev.preventDefault(); o.click(); }
    }
  }

  /* ---------- Lebenszyklus ---------- */
  let offCol = null, offJ = null, offL = null;
  function watchAll() {
    if (offCol) return;
    let first = true;
    offCol = col.watch(() => { if (first) { first = false; checkFreeze(); } if ((page || tpage) && !pending && !player) render(); });
    offJ = jpStats.watch(() => { if ((page || tpage) && !player) renderHead(); });
    offL = lapStats.watch(() => { if ((page || tpage) && !player) renderHead(); });
  }
  const startTick = () => { clearInterval(tick); tick = setInterval(() => { if ((page || tpage) && !player) renderHead(); }, 30000); };
  const trainer = {
    show(el) {
      tpage = el;
      watchAll();
      tpage.addEventListener("click", onTrainClick);
      renderTrain();
      startTick();
    },
    hide() {
      clearInterval(tick); tick = null;
      if (tpage) tpage.removeEventListener("click", onTrainClick);
      closePlayer(); closeGuide();
      tpage = null;
    },
    destroy() { this.hide(); },
    onData() { if (tpage && !player) renderTrain(); },
    onYear() { unitsCache = null; if (tpage && !player) renderTrain(); },
    get playing() { return !!player; },
  };
  return {
    show(el) {
      page = el;
      watchAll();
      page.addEventListener("click", onPageClick);
      page.addEventListener("change", onPageChange);
      render();
      const shown = page;
      (cssReady || Promise.resolve()).then(() => requestAnimationFrame(() => { if (page === shown && !player) { setupBanner(); scrollToCurrent(true); } }));
      startTick();
    },
    hide() {
      clearInterval(tick); tick = null;
      if (io) { io.disconnect(); io = null; }
      if (page) { page.removeEventListener("click", onPageClick); page.removeEventListener("change", onPageChange); }
      closePlayer(); closeGuide();
      page = null;
    },
    destroy() { this.hide(); trainer.hide(); offCol && offCol(); offJ && offJ(); offL && offL(); offCol = offJ = offL = null; },
    onData() { if (page && !player) renderHead(); },
    onYear() { unitsCache = null; openNode = null; if (page && !player) { render(); scrollToCurrent(false); } },
    /** 🏋️ Reiter „Üben“ (gleicher Player, gleiche Daten) */
    trainer,
    /** Für Tests/Debug: läuft gerade eine Lektion? */
    get playing() { return !!player; },
  };
}
