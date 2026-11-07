// Update 10 – 🛤️ Lernpfad („wie Duolingo“): gemeinsame Oberfläche für 🇯🇵 Japanisch und 🎓 LAP Elektrotechnik.
// Logik in ./path-core.js. Pro Modul ein Adapter M (siehe jp-path.js / lap-path.js):
//   M = { module:"jp"|"lap", name, units(), lessonCtx(), check(ex, value) → bool|null, fmtNum?, speak?, stop?,
//         listen?() → {done, stop}, grade(ref, ok, ex), countStats(n, ok), practiceItems(units, mod), calc?(onTake), go?(tab) }
// Daten: Alltag-Sammlung "learn_progress" (Dokumente "jp", "lap", "me"); 🔥 Serie zählt auch jp_stats/lap_stats mit.
import { collection } from "./db.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";
import * as P from "./path-core.js";

const CSS_ID = "lp-css";
function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const l = document.createElement("link");
  l.id = CSS_ID; l.rel = "stylesheet";
  l.href = new URL("../../css/alltag-path.css", import.meta.url).href;
  document.head.appendChild(l);
}
const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/* ---------- ⚡ Funki – das Maskottchen (eigene Figur: kleiner Funke mit Glühbirnen-Bauch) ---------- */
export function mascot(mood = "happy", size = 96) {
  const arms = mood === "cheer"
    ? `<path d="M22 58 L8 40" /><path d="M78 58 L92 40" />`
    : mood === "calm" ? `<path d="M24 66 L12 74" /><path d="M76 66 L88 74" />` : `<path d="M23 62 L10 56" /><path d="M77 62 L90 56" />`;
  const mouth = mood === "calm" ? `<path d="M42 62 Q50 66 58 62" class="lpm-line" />` : `<path d="M40 60 Q50 72 60 60 Z" class="lpm-mouth" />`;
  return `<svg class="lp-mascot lp-mascot-${mood}" viewBox="0 0 100 110" width="${size}" height="${Math.round(size * 1.1)}" aria-hidden="true" focusable="false">` +
    `<g class="lpm-arms">${arms}</g>` +
    `<path class="lpm-spark" d="M50 2 L56 14 L50 11 L44 14 Z" />` +
    `<circle class="lpm-body" cx="50" cy="54" r="34" />` +
    `<path class="lpm-bolt" d="M53 70 L45 84 L49 84 L46 96 L57 80 L52 80 L56 70 Z" />` +
    `<rect class="lpm-base" x="40" y="86" width="20" height="12" rx="4" />` +
    `<circle class="lpm-eye" cx="39" cy="48" r="5" /><circle class="lpm-eye" cx="61" cy="48" r="5" />` +
    `<circle class="lpm-shine" cx="41" cy="46" r="1.6" /><circle class="lpm-shine" cx="63" cy="46" r="1.6" />` +
    `<circle class="lpm-cheek" cx="31" cy="58" r="4" /><circle class="lpm-cheek" cx="69" cy="58" r="4" />` +
    mouth + `</svg>`;
}

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
  let page = null;
  let sideOpen = false;
  let openNode = null;     // id des Knotens mit offener Info-Karte
  let player = null;       // laufende Lektion
  let tick = null;
  let pending = null;      // lokaler Stand, bis gespeichert
  let unitsCache = null, unitsKey = null;

  /* ---------- Daten ---------- */
  const today = () => P.dayKey();
  const getMe = () => (pending && pending.me) || P.readMe(col.get("me"));
  const getMod = (id = M.module) => (pending && pending[id]) || P.readMod(col.get(id), id);
  const mods = () => [getMod("jp"), getMod("lap")];
  const stats = () => [jpStats.get("me"), lapStats.get("me")].filter(Boolean);
  const src = () => ({ mods: mods(), stats: stats(), me: getMe() });
  const units = () => { const k = M.unitsKey ? M.unitsKey() : "1"; if (!unitsCache || unitsKey !== k) { unitsCache = M.units(); unitsKey = k; } return unitsCache; };
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
  }

  /* ---------- Pfad-Ansicht ---------- */
  function headHTML() {
    const s = src();
    const me = s.me;
    const st = P.learnStreak(s, today());
    const active = P.activeToday(s, today());
    const h = P.heartsNow(me.hearts);
    const xp = P.xpOn(s.mods, today());
    const goal = me.goal ? P.goalXp(me.goal) : 0;
    const pct = goal ? Math.min(100, Math.round((xp / goal) * 100)) : 0;
    return `<div class="lp-top" role="group" aria-label="Dein Lernstand">` +
      `<div class="lp-chip lp-streak${active ? " on" : ""}" title="Lern-Serie (Japanisch + LAP)"><span aria-hidden="true">🔥</span><b>${st}</b><small>${st === 1 ? "Tag" : "Tage"}</small></div>` +
      `<div class="lp-chip lp-gems" title="Edelsteine"><span aria-hidden="true">💎</span><b>${me.gems || 0}</b></div>` +
      `<div class="lp-chip lp-hearts${h.n === 0 ? " empty" : ""}" title="${h.n < P.MAX_HEARTS ? `Nächstes Herz in ${fmtMin(h.nextIn)}` : "Herzen voll"}"><span aria-hidden="true">❤️</span><b>${h.n}</b>${h.n < P.MAX_HEARTS ? `<small>+1 in ${fmtMin(h.nextIn)}</small>` : ""}</div>` +
      `<div class="lp-chip lp-xp" title="XP heute${goal ? ` · Tagesziel ${goal} XP` : ""}"><span aria-hidden="true">⚡</span><b>${xp}${goal ? `<i>/${goal}</i>` : ""}</b>${goal ? `<span class="lp-mini"><span style="width:${pct}%"></span></span>` : "<small>XP heute</small>"}</div>` +
      `<button type="button" class="lp-chip lp-morebtn" data-lp="side" aria-expanded="${sideOpen}" aria-label="Fortschritt, Laden und Abzeichen">📊</button>` +
    `</div>`;
  }

  function goalPickHTML() {
    return `<div class="lp-card lp-goalpick">${mascot("happy", 64)}<div class="lp-goalpick-in"><h3 class="lp-h3">🎯 Wie viel magst du am Tag lernen?</h3>` +
      `<p class="lp-muted">Such dir ein Tagesziel aus – du kannst es später in 📊 ändern.</p>` +
      `<div class="lp-goals">${P.GOALS.map((g) => `<button type="button" class="lp-goalbtn" data-goal="${g.id}"><span aria-hidden="true">${g.emoji}</span><b>${g.name}</b><small>${g.xp} XP</small></button>`).join("")}</div></div></div>`;
  }

  function pathHTML() {
    const us = units();
    const mod = getMod();
    const st = P.nodeStates(us, mod);
    let seg = null, i = 0;
    let html = "";
    for (const u of us) {
      if (u.seg !== seg) { seg = u.seg; html += `<h3 class="lp-seg">${esc(u.seg)}</h3>`; }
      const pr = P.unitProgress(u, mod);
      html += `<section class="lp-unit lp-c${u.color}" aria-label="Einheit ${u.no}: ${esc(u.title)}">` +
        `<header class="lp-uhead"><div class="lp-uhead-t"><small>Einheit ${u.no}</small><b>${esc(u.emoji)} ${esc(u.title)}</b></div>` +
        `<span class="lp-uprog" title="${pr.done} von ${pr.total} geschafft">${pr.complete ? "✅" : `${pr.done}/${pr.total}`}</span></header>` +
        `<ol class="lp-nodes">`;
      u.nodes.forEach((n, k) => {
        const s = st[n.id];
        const crown = P.crownOf(mod, n.id);
        const off = P.nodeOffset(i++);
        const icon = n.type === "chest" ? (s === "done" ? "📭" : "🎁") : n.type === "check" ? (s === "done" ? "🏆" : "🏁") : s === "locked" ? "🔒" : s === "done" ? "⭐" : n.kind === "calc" ? "🔢" : "★";
        const label = `${n.type === "chest" ? "Schatzkiste" : n.type === "check" ? "Prüfung der Einheit" : n.title} – ${({ done: "geschafft", current: "jetzt dran", open: "frei", locked: "gesperrt", jump: "zum Überspringen" })[s]}`;
        html += `<li class="lp-li" style="--x:${off}">` +
          (s === "current" ? `<span class="lp-start" aria-hidden="true">START</span>` : "") +
          `<button type="button" class="lp-node lp-n-${n.type} is-${s}" data-node="${esc(n.id)}" aria-label="${esc(label)}" aria-expanded="${openNode === n.id}">` +
            `<span class="lp-node-i${n.type === "lesson" && s !== "locked" && s !== "done" && n.kind !== "calc" ? " jp-ja" : ""}" aria-hidden="true">${esc(n.type === "lesson" && s !== "locked" && s !== "done" && n.kind === "kana" ? n.emoji : icon)}</span>` +
            (crown && n.type === "lesson" ? `<span class="lp-crown c${crown}" aria-hidden="true">👑<i>${crown}</i></span>` : "") +
          `</button>` +
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
    let body = "";
    if (s === "locked") body = `<p>🔒 Schaff zuerst die Lektion davor – dann geht's hier weiter.</p>`;
    else if (n.type === "chest") body = s === "done" ? `<p>📭 Schon geöffnet – da war was Feines drin.</p>` : `<p>Eine Schatzkiste! 🎁 Mach sie auf.</p><button type="button" class="lp-btn lp-go" data-lp="chest" data-id="${esc(n.id)}">🎁 ÖFFNEN</button>`;
    else if (n.type === "check") body = `<p>${s === "jump" ? "Kannst du das schon? Schaff die Prüfung und überspring die ganze Einheit 🚀" : s === "done" ? "Prüfung geschafft 🏆 – nochmal zum Auffrischen?" : "Alles aus dieser Einheit gemischt. Du schaffst das! 💪"}</p>` +
      `<button type="button" class="lp-btn lp-go" data-lp="start" data-id="${esc(n.id)}">${s === "jump" ? "🚀 ÜBERSPRINGEN" : s === "done" ? "🔁 WIEDERHOLEN" : "🏁 PRÜFUNG STARTEN"}</button>`;
    else body = `<p class="lp-pop-sub">Lektion ${no} von ${lessons.length}${crown ? ` · 👑 Stufe ${crown}/3` : ""}</p>` +
      (s === "done" && crown < 3 ? `<p>Eine perfekte Runde (ohne Fehler) bringt die nächste Kronen-Stufe 👑</p>` : "") +
      `<button type="button" class="lp-btn lp-go" data-lp="start" data-id="${esc(n.id)}">${s === "done" ? "🔁 WIEDERHOLEN · +XP" : "START ▶"}</button>`;
    return `<div class="lp-pop lp-c${u.color}" role="region" aria-label="${esc(n.title)}"><b class="lp-pop-t">${esc(n.type === "chest" ? "🎁 Schatzkiste" : n.type === "check" ? `🏁 Prüfung · ${u.title}` : n.title)}</b>${body}</div>`;
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

  function sideHTML() {
    const s = src();
    const me = s.me;
    const goal = me.goal ? P.goalXp(me.goal) : 0;
    const xp = P.xpOn(s.mods, today());
    const week = P.weekXp(s.mods, today());
    const lg = P.weekLeague(s.mods, today());
    const h = P.heartsNow(me.hearts);
    const pct = goal ? Math.min(100, Math.round((xp / goal) * 100)) : 0;
    const ring = `<svg class="lp-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" class="lp-ring-bg"/><circle cx="22" cy="22" r="18" class="lp-ring-fg" stroke-dasharray="${(pct * 1.131).toFixed(1)} 200"/></svg>`;
    const got = P.ACHIEVEMENTS.filter((a) => me.ach[a.id]).length;
    return `<div class="lp-card lp-goalcard"><div class="lp-row">${ring}<div><b class="lp-h4">⚡ Tagesziel</b><p class="lp-muted">${goal ? (xp >= goal ? `Geschafft – ${xp} XP heute! 🎉` : `${xp} von ${goal} XP – noch ${goal - xp} XP`) : "Noch kein Tagesziel gewählt"}</p></div></div>` +
        `<label class="lp-set"><span>Ziel</span><select data-lp="goal" aria-label="Tagesziel">${P.GOALS.map((g) => `<option value="${g.id}"${me.goal === g.id ? " selected" : ""}>${g.emoji} ${g.name} · ${g.xp} XP</option>`).join("")}${me.goal ? "" : `<option value="" selected>– wählen –</option>`}</select></label></div>` +
      `<div class="lp-card"><b class="lp-h4">📈 Deine Woche</b>${weekSVG(week, goal)}` +
        `<p class="lp-muted lp-league">📆 Diese Woche: <b>${lg.now} XP</b>${lg.best ? ` · Rekord der letzten 4 Wochen ${lg.best} XP${lg.now > lg.best ? " – neuer Rekord! 🥳" : ""}` : ""}</p></div>` +
      `<div class="lp-card"><b class="lp-h4">💎 Laden <small>${me.gems || 0} 💎</small></b>` +
        `<div class="lp-shop"><button type="button" class="lp-shopbtn" data-lp="buy-freeze" ${me.gems >= P.FREEZE_COST && me.freezes < P.MAX_FREEZES ? "" : "disabled"}><span aria-hidden="true">🧊</span><span><b>Serien-Schutz</b><small>${me.freezes ? `${me.freezes} bereit · ` : ""}rettet 1 verpassten Tag</small></span><i>${P.FREEZE_COST} 💎</i></button>` +
        `<button type="button" class="lp-shopbtn" data-lp="buy-hearts" ${me.gems >= P.HEARTS_COST && h.n < P.MAX_HEARTS ? "" : "disabled"}><span aria-hidden="true">❤️</span><span><b>Herzen auffüllen</b><small>${h.n}/${P.MAX_HEARTS} – sofort wieder voll</small></span><i>${P.HEARTS_COST} 💎</i></button></div></div>` +
      `<div class="lp-card"><b class="lp-h4">🏆 Abzeichen <small>${got}/${P.ACHIEVEMENTS.length}</small></b><ul class="lp-shelf">` +
        P.ACHIEVEMENTS.map((a) => `<li class="lp-badge${me.ach[a.id] ? " got" : ""}" title="${esc(a.t)} – ${esc(a.d)}${me.ach[a.id] ? " ✔" : ""}"><span aria-hidden="true">${me.ach[a.id] ? a.e : "🔒"}</span><small>${esc(a.t)}</small></li>`).join("") +
      `</ul></div>` +
      `<div class="lp-card"><b class="lp-h4">⚙️ Einstellungen</b><label class="lp-switch"><input type="checkbox" data-lp="sound" ${me.sound !== false ? "checked" : ""}><span>🔊 Töne bei richtig/falsch</span></label></div>`;
  }

  function render() {
    if (!page) return;
    const me = getMe();
    const keepY = window.scrollY;
    page.innerHTML = `<div class="lp${sideOpen ? " side-open" : ""}">` + headHTML() +
      `<div class="lp-grid"><div class="lp-main">` +
        (me.goal ? "" : goalPickHTML()) +
        `<div class="lp-card lp-practice"><span class="lp-practice-i" aria-hidden="true">🏋️</span><div><b>Üben</b><small>Deine Fehler wiederholen – kostet keine Herzen und bringt ❤️ +1</small></div><button type="button" class="lp-btn sm" data-lp="practice">ÜBEN</button></div>` +
        `<div class="lp-path">${pathHTML()}</div>` +
      `</div><aside class="lp-side" aria-label="Fortschritt">${sideHTML()}</aside></div></div>`;
    window.scrollTo(0, keepY);
  }
  function renderHead() {
    if (!page) return;
    const top = page.querySelector(".lp-top");
    if (top) top.outerHTML = headHTML();
  }
  function scrollToCurrent(smooth = false) {
    if (!page) return;
    const el = page.querySelector(".lp-node.is-current") || page.querySelector(".lp-node.is-open");
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "center", behavior: smooth && !reduceMotion() ? "smooth" : "auto" }); } catch { /* egal */ } }
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
    ui.toast(`🎁 +${r.gems} 💎 und +${r.xp} XP – juhu!`, 2600);
    if (getMe().sound !== false) beep("end");
  }
  function onPageClick(ev) {
    const n = ev.target.closest("[data-node]");
    if (n) { openNode = openNode === n.dataset.node ? null : n.dataset.node; render(); const el = page.querySelector(".lp-pop"); if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest" }); } catch { /* egal */ } } return; }
    const b = ev.target.closest("[data-lp],[data-goal]");
    if (!b) { if (openNode && !ev.target.closest(".lp-pop")) { openNode = null; render(); } return; }
    if (b.dataset.goal) { save({ me: { ...getMe(), goal: b.dataset.goal } }).then(render); ui.toast(`🎯 Tagesziel: ${P.goalXp(b.dataset.goal)} XP – los geht's!`); return; }
    const k = b.dataset.lp;
    if (k === "side") { sideOpen = !sideOpen; render(); if (sideOpen) { const s = page.querySelector(".lp-side"); if (s && s.scrollIntoView) { try { s.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }); } catch { /* egal */ } } } return; }
    if (k === "start") { const f = findNode(b.dataset.id); if (f) startLesson(f.n, f.u); return; }
    if (k === "chest") { chest(b.dataset.id); return; }
    if (k === "practice") { startPractice(); return; }
    if (k === "buy-freeze") { const r = P.buyFreeze(getMe()); if (r.ok) { save({ me: r.me }).then(render); ui.toast("🧊 Serien-Schutz gekauft – deine Serie ist abgesichert!"); } return; }
    if (k === "buy-hearts") { const r = P.buyHearts(getMe()); if (r.ok) { save({ me: r.me }).then(render); ui.toast("❤️ Herzen wieder voll!"); } return; }
  }
  function onPageChange(ev) {
    const t = ev.target;
    if (t.dataset.lp === "goal" && t.value) { save({ me: { ...getMe(), goal: t.value } }).then(render); }
    if (t.dataset.lp === "sound") { save({ me: { ...getMe(), sound: t.checked } }); }
  }

  /* ================= Lektion (Vollbild) ================= */
  function startPractice() {
    const items = M.practiceItems(units(), getMod());
    if (!items.length) { ui.toast("Noch nix zu üben – mach zuerst eine Lektion 🙂"); return; }
    startLesson({ type: "practice", id: "practice", title: "Üben", items, pool: items }, null);
  }
  function startLesson(node, unit) {
    const me = getMe();
    const practice = node.type === "practice";
    if (!practice && P.heartsNow(me.hearts).n <= 0) { openPlayer({ node, unit, ex: [], out: true }); return; }
    const ex = P.buildLesson(node, { ...M.lessonCtx(), module: M.module, seed: Date.now() });
    if (!ex.length) { ui.toast("Für diese Lektion gibt's gerade keine Übungen 😕"); return; }
    const st = P.nodeStates(units(), getMod());
    openPlayer({ node, unit, ex, jump: node.type === "check" && st[node.id] === "jump" });
  }

  function openPlayer({ node, unit, ex, out = false, jump = false }) {
    closePlayer();
    const practice = node.type === "practice";
    const root = document.createElement("div");
    root.className = "lp-player";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", practice ? "Üben" : node.type === "check" ? "Prüfung" : `Lektion: ${node.title}`);
    document.body.appendChild(root);
    document.documentElement.classList.add("lp-lock");
    player = {
      root, node, unit, practice, jump,
      run: P.startRun(ex, { mode: practice ? "practice" : "lesson" }),
      t0: Date.now(), checked: null, sel: null, tiles: [], match: { l: null, r: null, done: [], bad: 0 }, out, endInfo: null,
      calc: M.calc ? M.calc((text) => { const i = root.querySelector(".lp-numin"); if (i) { i.value = text; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus({ preventScroll: true }); } }) : null,
      rec: null,
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
    document.documentElement.classList.remove("lp-lock");
  }

  const exNow = () => P.runCurrent(player.run);
  function topHTML() {
    const r = player.run;
    const h = P.heartsNow(getMe().hearts);
    const pct = Math.round(P.runProgress(r) * 100);
    return `<div class="lp-ptop"><button type="button" class="lp-x" data-p="quit" aria-label="Lektion beenden">✕</button>` +
      `<div class="lp-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Fortschritt"><span style="width:${Math.max(pct, 3)}%"></span></div>` +
      (r.combo >= 3 ? `<span class="lp-combo" title="${r.combo} richtig in Folge">🔥<b>${r.combo}</b></span>` : "") +
      `<span class="lp-phearts${player.practice ? " inf" : ""}" title="${player.practice ? "Üben kostet keine Herzen" : "Herzen"}">❤️<b>${player.practice ? "∞" : h.n}</b></span></div>`;
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
    if (!ok && !player.practice) {
      const hearts = P.loseHeart(me.hearts);
      await save({ me: { ...me, hearts } });
    }
    if (me.sound !== false) beep(ok ? "ok" : "no");
    if (!ok) vibrate(60);
    renderEx();
    if (!ok) { const s = player.root.querySelector(".lp-ex"); if (s && !reduceMotion()) s.classList.add("lp-shake"); }
  }
  function next() {
    if (!player) return;
    if (!player.practice && P.heartsNow(getMe().hearts).n <= 0) { player.out = true; renderOut(); return; }
    player.run = P.nextRun(player.run);
    player.checked = null; player.sel = null; player.tiles = []; player.match = { l: null, r: null, done: [], bad: 0 }; player.heard = "";
    if (player.calc) player.calc.reset();
    renderEx();
    const b = player.root.querySelector(".lp-pbody");
    if (b) b.scrollTop = 0;
  }

  function renderOut() {
    const h = P.heartsNow(getMe().hearts);
    const me = getMe();
    player.root.innerHTML = `<div class="lp-ptop"><button type="button" class="lp-x" data-p="close" aria-label="Schließen">✕</button></div>` +
      `<div class="lp-pbody lp-center lp-out">${mascot("calm", 120)}<h2 class="lp-q">Keine Herzen mehr ❤️‍🩹</h2>` +
      `<p class="lp-lead">Mach eine kurze Pause oder übe Fehler 💪</p>` +
      `<p class="lp-muted">${h.n < P.MAX_HEARTS ? `Nächstes Herz in ${fmtMin(h.nextIn)} – der Rest der App geht natürlich ganz normal weiter.` : ""}</p>` +
      `<div class="lp-outbtns"><button type="button" class="lp-btn" data-p="practice">🏋️ FEHLER ÜBEN (+1 ❤️)</button>` +
      `<button type="button" class="lp-btn ghost" data-p="buy" ${me.gems >= P.HEARTS_COST ? "" : "disabled"}>❤️ Auffüllen · ${P.HEARTS_COST} 💎 <small>(du hast ${me.gems || 0})</small></button>` +
      `<button type="button" class="lp-btn ghost" data-p="close">Später weiter</button></div></div>`;
  }

  async function finish() {
    const p = player;
    const r = p.run;
    const kind = p.practice ? "practice" : p.node.type === "check" ? "check" : "lesson";
    const rewards = P.lessonRewards({ mistakes: r.mistakes, maxCombo: r.maxCombo, kind });
    const before = P.learnStreak(src(), today());
    const wasActive = P.activeToday(src(), today());
    const goal = getMe().goal ? P.goalXp(getMe().goal) : 0;
    const xpBefore = P.xpOn(mods(), today());
    const applied = P.applyLesson(getMod(), getMe(), { node: p.node, unit: p.unit, rewards, ok: r.ok, day: today(), jump: p.jump });
    let me = applied.me;
    if (p.practice) me = { ...me, hearts: P.gainHeart(me.hearts) };
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
        `<p>💎 +${e.rewards.gems} Edelsteine${player.practice ? " · ❤️ +1 Herz" : ""}</p>` +
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
    if (k === "quit") { if (!player.checked && player.run.solved.length && !confirmQuit()) return; closePlayer(); render(); return; }
    if (k === "close") { closePlayer(); render(); return; }
    if (k === "practice") { closePlayer(); startPractice(); return; }
    if (k === "buy") { const r = P.buyHearts(getMe()); if (r.ok) { save({ me: r.me }).then(() => { closePlayer(); render(); ui.toast("❤️ Herzen wieder voll – weiter geht's!"); }); } return; }
    if (k === "done") { closePlayer(); openNode = null; render(); scrollToCurrent(true); const e = page && page.querySelector(".lp-node.is-current"); if (e) e.classList.add("lp-pop-anim"); return; }
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
    if (ev.key === "Escape") { ev.preventDefault(); closePlayer(); render(); return; }
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
    offCol = col.watch(() => { if (first) { first = false; checkFreeze(); } if (page && !pending && !player) render(); });
    offJ = jpStats.watch(() => { if (page && !player) renderHead(); });
    offL = lapStats.watch(() => { if (page && !player) renderHead(); });
  }
  return {
    show(el) {
      page = el;
      watchAll();
      page.addEventListener("click", onPageClick);
      page.addEventListener("change", onPageChange);
      render();
      requestAnimationFrame(() => scrollToCurrent(false));
      clearInterval(tick);
      tick = setInterval(() => { if (page && !player) renderHead(); }, 30000);
    },
    hide() {
      clearInterval(tick); tick = null;
      if (page) { page.removeEventListener("click", onPageClick); page.removeEventListener("change", onPageChange); }
      closePlayer();
      page = null;
    },
    destroy() { this.hide(); offCol && offCol(); offJ && offJ(); offL && offL(); offCol = offJ = offL = null; },
    onData() { if (page && !player) renderHead(); },
    onYear() { unitsCache = null; openNode = null; if (page && !player) { render(); scrollToCurrent(false); } },
    /** Für Tests/Debug: läuft gerade eine Lektion? */
    get playing() { return !!player; },
  };
}
