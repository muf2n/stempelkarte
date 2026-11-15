// ♟️ Schach (#alltag/schach) – komplett offline: Bots mit Persönlichkeit, Bedenkzeiten, Farbwahl, Elo, Taktikaufgaben,
// tägliches Rätsel, Partien nachspielen. Regeln/SAN: vendor/chess (chess.js, BSD-2), Engine: ../chess-engine.js (Worker).
// Gespeichert: Sammlung „spiel“, Dokument "schach" (Logik: ./schach-core.js). Laufende Partie zusätzlich lokal (sk-schach-cur).
import { Chess } from "../../vendor/chess/chess.js";
import { collection } from "./db.js";
import * as C from "./schach-core.js";
import * as Coach from "./schach-coach.js";
import { askClaude, aiAvailable } from "./ai-client.js";
import * as ui from "../ui.js";
import { esc } from "../util.js";

const CUR_KEY = "sk-schach-cur", TAB_KEY = "sk-schach-tab";
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* egal */ } };
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function loadCss() {
  if (document.querySelector('link[data-css="schach"]')) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.dataset.css = "schach";
  l.href = new URL("../../css/alltag-schach.css", import.meta.url).href; document.head.appendChild(l);
}

/* ---------- Engine (Worker, sonst im Hauptthread) ---------- */
let worker = null, wid = 0;
const pending = new Map();
function engine(fen, opts) {
  return new Promise((resolve) => {
    try {
      if (!worker) {
        worker = new Worker(new URL("../chess-worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
        worker.onerror = () => { worker = null; };
      }
      const id = ++wid; pending.set(id, resolve); worker.postMessage({ id, fen, opts });
    } catch {
      import("../chess-engine.js").then((E) => setTimeout(() => resolve(E.search(fen, opts)), 20));
    }
  });
}
const uciToMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });

export function mount(el) {
  loadCss();
  const sp = collection("spiel");
  sp.get("schach");
  const S = { tab: ["bots", "taktik", "partien"].includes(lsGet(TAB_KEY)) ? lsGet(TAB_KEY) : "bots", g: null, pz: null, sel: null, alive: true, tcOpen: false, review: null, puzzles: null };
  const me = () => C.normMe(sp.get("schach") || {});
  const saveMe = (m) => { try { const p = sp.put({ ...m, id: "schach" }); if (p && p.catch) p.catch(() => {}); } catch { /* egal */ } };
  const loadPuzzles = () => S.puzzles ? Promise.resolve(S.puzzles) : import("./schach-puzzles.js").then((m) => (S.puzzles = m.PUZZLES));

  /* ---------- Brett ---------- */
  function boardHTML(ch, { flip, sel, targets = [], last, hint, check, lock, badge, arrows = [] }) {
    const files = "abcdefgh", rows = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const r = flip ? i + 1 : 8 - i, f = flip ? 7 - j : j, sq = files[f] + r, p = ch.get(sq);
        const dark = (f + r) % 2 === 1 ? "" : " d";
        const cls = ["sq" + dark, last && (last.from === sq || last.to === sq) ? "last" : "", sel === sq ? "sel" : "", hint && (hint.from === sq || hint.to === sq) ? "hint" : "", check === sq ? "chk" : ""].filter(Boolean).join(" ");
        const tg = targets.find((t) => t.to === sq);
        rows.push(`<button type="button" class="${cls}" data-sq="${sq}"${lock ? " tabindex=\"-1\"" : ""} aria-label="${sq}${p ? " " + p.color + p.type : ""}">${p ? `<span class="pc ${p.color}">${GLYPH[p.type]}︎</span>` : ""}${tg ? `<i class="${p ? "cap" : "dot"}"></i>` : ""}${j === 0 ? `<em class="rk">${r}</em>` : ""}${i === 7 ? `<em class="fl">${files[f]}</em>` : ""}</button>`);
      }
    }
    const cen = (sq) => { const f = "abcdefgh".indexOf(sq[0]), r = Number(sq[1]); return [flip ? 7 - f + 0.5 : f + 0.5, flip ? r - 0.5 : 8 - r + 0.5]; };
    const arr = arrows.filter((a) => a && a.from && a.to).map((a) => { const [x1, y1] = cen(a.from), [x2, y2] = cen(a.to), dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ex = x2 - (dx / L) * 0.32, ey = y2 - (dy / L) * 0.32; return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${a.color || "#81b64c"}" stroke-width=".2" stroke-linecap="round" opacity=".88" marker-end="url(#sc-ah-${(a.color || "#81b64c").slice(1)})"/>`; }).join("");
    const mk = [...new Set(arrows.map((a) => (a.color || "#81b64c")))].map((c) => `<marker id="sc-ah-${c.slice(1)}" viewBox="0 0 10 10" refX="3" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${c}"/></marker>`).join("");
    const bd = badge && badge.sq ? (() => { const [x, y] = cen(badge.sq); return `<span class="sc-badge" style="left:${(x + 0.5) / 8 * 100}%;top:${(y - 0.5) / 8 * 100}%;--c:${badge.c}">${badge.e}</span>`; })() : "";
    return `<div class="sc-bwrap"><div class="sc-board${lock ? " lock" : ""}">${rows.join("")}</div>${arr ? `<svg class="sc-arrows" viewBox="0 0 8 8" aria-hidden="true"><defs>${mk}</defs>${arr}</svg>` : ""}${bd}</div>`;
  }
  const kingSq = (ch) => { if (!ch.inCheck()) return null; const t = ch.turn(); for (const row of ch.board()) for (const x of row) if (x && x.type === "k" && x.color === t) return x.square; return null; };

  /* ---------- Startseite ---------- */
  function homeHTML() {
    const m = me(), tabs = [["bots", "🤖", "Bots"], ["taktik", "🧩", "Taktik"], ["partien", "📜", "Partien"]];
    const cur = lsGet(CUR_KEY);
    return `<div class="sc">
      <section class="sc-top"><div><b>♟️ Schach</b><small>offline · gegen Bots & Rätsel</small></div>
        <div class="sc-elo"><span>Deine Elo</span><b>${m.elo}</b></div><div class="sc-elo pz"><span>🧩 Taktik</span><b>${m.pz.r}</b></div></section>
      ${cur ? `<button type="button" class="sc-resume" data-a="resume">▶️ <b>Laufende Partie fortsetzen</b><small>gegen ${esc((C.anyBot(JSON.parse(cur).bot) || C.botById("eva")).name)}</small></button>` : ""}
      <div class="sc-tabs" role="tablist">${tabs.map(([id, e, l]) => `<button type="button" role="tab" aria-selected="${S.tab === id}" class="${S.tab === id ? "on" : ""}" data-a="tab" data-v="${id}">${e} ${l}</button>`).join("")}</div>
      ${S.tab === "taktik" ? taktikHTML(m) : S.tab === "partien" ? gamesHTML(m) : botsHTML(m)}
    </div>`;
  }
  function eventHTML(m) {
    const ev = C.weekEvent(), st = C.evState(m, ev), left = ev.ends - Date.now();
    const d = Math.floor(left / 864e5), h = Math.floor((left % 864e5) / 36e5);
    const can = C.evClaimable(st), maxPts = C.EV_TRACK[C.EV_TRACK.length - 1].at;
    return `<section class="sc-ev"><div class="sc-evh"><b>${ev.e} Wochen-Event: ${esc(ev.theme)}</b><span class="sc-evt">⏱ ${d ? `${d} T ` : ""}${h} h</span></div>
      <div class="sc-evbots">${ev.bots.map((b, i) => `<button type="button" class="sc-evbot${S.sel === b.id ? " on" : ""}${st.won.includes(i) ? " won" : ""}" data-a="bot" data-v="${b.id}"><span class="sc-ava" aria-hidden="true">${b.e}</span><small>${b.elo}</small><em>${st.won.includes(i) ? "✓" : `💵 ${b.reward}`}</em></button>`).join("")}</div>
      <div class="sc-evtrack"><span class="sc-evbar"><i style="width:${Math.min(100, (st.pts / maxPts) * 100)}%"></i></span>${C.EV_TRACK.map((x, i) => `<span class="sc-evm${st.claimed.includes(i) ? " got" : st.pts >= x.at ? " ready" : ""}" style="left:${(x.at / maxPts) * 100}%" title="${esc(x.t)}">${x.e}</span>`).join("")}</div>
      <div class="sc-evf"><span>💵 <b>${st.pts}</b>/${maxPts} gesammelt · links leicht → rechts schwer</span>${can.length ? `<button type="button" class="btn primary sm" data-a="evclaim">🎁 ${can.length} Belohnung${can.length > 1 ? "en" : ""} abholen</button>` : ""}</div>
      <small>Belohnungen gehen in deinen ⚡ Strom-Tycoon. Jeden Montag kommen 5 neue Gegner.</small></section>`;
  }
  function botsHTML(m) {
    const L = m.last, sel0 = C.anyBot(S.sel || L.bot), sel = sel0 && (!sel0.ev || sel0.id.startsWith("ev-" + C.weekEvent().key)) ? sel0 : C.botById("eva"), tc = C.tcById(L.tc);
    return `${eventHTML(m)}<section class="sc-pick"><div class="sc-bubble-row"><span class="sc-ava big" aria-hidden="true">${sel.e}</span><div class="sc-bubble">${esc(sel.hi)}</div></div>
        <h2>${esc(sel.name)} <small>${sel.elo}</small>${sel.ev ? ` <span class="sc-evtag">Event · 💵 ${sel.reward}</span>` : ""}</h2></section>
      ${C.CATS.map((cat) => { const all = C.BOTS.filter((b) => b.cat === cat), open = S.open === cat, bs = open ? all : all.slice(0, 10); return all.length ? `<h3 class="sc-cat">${cat} <small>${all.length}</small>${all.length > 10 ? `<button type="button" class="sc-more" data-a="catopen" data-v="${cat}">${open ? "weniger" : "alle anzeigen"}</button>` : ""}</h3><div class="sc-bots">${bs.map((b) => { const cr = C.crowns(m.bots[b.id]); return `<button type="button" class="sc-bot${b.id === sel.id ? " on" : ""}" data-a="bot" data-v="${b.id}"><span class="sc-ava" aria-hidden="true">${b.e}</span><small>${esc(b.name.split(" ").slice(-1)[0])} · ${b.elo}</small><span class="sc-cr" aria-label="${cr} von 3 Kronen">${"👑".repeat(cr)}${"<i>👑</i>".repeat(3 - cr)}</span></button>`; }).join("")}</div>` : ""; }).join("")}
      <div class="sc-opts">
        <button type="button" class="sc-tcbtn" data-a="tcopen">⏱️ <b>${esc(tc.label)}</b> <small>${tc.cat}</small><span>${S.tcOpen ? "▲" : "▼"}</span></button>
        <div class="sc-color" role="group" aria-label="Farbe">${[["w", "♔", "Weiß"], ["r", "?", "Zufall"], ["b", "♚", "Schwarz"]].map(([v, g, l]) => `<button type="button" data-a="color" data-v="${v}" aria-pressed="${L.color === v}" aria-label="${l}" class="c-${v}">${g}︎</button>`).join("")}</div>
      </div>
      ${S.tcOpen ? `<div class="sc-tcs">${C.TCS.map((c) => `<div class="sc-tcg"><b>${c.e} ${c.cat}</b><div>${c.list.map(([id, , , lab]) => `<button type="button" data-a="tc" data-v="${id}" aria-pressed="${L.tc === id}">${lab}</button>`).join("")}</div></div>`).join("")}</div>` : ""}
      <button type="button" class="sc-play" data-a="play">Spielen</button>`;
  }
  function taktikHTML(m) {
    const today = dayKey(), done = m.pz.day === today && m.pz.dayDone;
    return `<section class="sc-card sc-daily"><span aria-hidden="true">📅</span><div><b>Tägliches Rätsel</b><small>${done ? "Heute schon gelöst ✓ – morgen gibt's ein neues." : "Ein neues Rätsel jeden Tag."}</small></div><button type="button" class="btn${done ? "" : " primary"}" data-a="daily">${done ? "Nochmal" : "Lösen!"}</button></section>
      <section class="sc-card sc-pzhead"><div class="sc-pzr"><span>🧩</span><b>${m.pz.r}</b><small>Taktik-Wertung</small></div>
        <ul><li>🔥 Serie <b>${m.pz.streak}</b></li><li>🏆 Beste Serie <b>${m.pz.best}</b></li><li>✅ Gelöst <b>${m.pz.ok}/${m.pz.n}</b></li></ul>
        <button type="button" class="sc-play" data-a="puzzle">Taktikaufgaben lösen!</button></section>
      <p class="note">Die Aufgaben passen sich deiner Wertung an. Sie wurden aus echten Partien erzeugt und haben genau eine gewinnende Lösung.</p>`;
  }
  function gamesHTML(m) {
    const h = m.hist.slice().reverse(); const bn = (id) => C.anyBot(id) || C.botById("eva");
    return `<section class="sc-card"><div class="sc-stat"><span>🎮 <b>${m.games}</b> Partien</span><span>✅ ${m.wins}</span><span>🤝 ${m.draws}</span><span>❌ ${m.losses}</span></div></section>
      ${h.length ? `<ul class="sc-hist">${h.map((x, i) => { const B = bn(x.bot); return `<li><button type="button" data-a="review" data-i="${m.hist.length - 1 - i}"><span class="sc-ava" aria-hidden="true">${B.e}</span><span><b>${x.res === "win" ? "✅ Sieg" : x.res === "draw" ? "🤝 Remis" : "❌ Niederlage"}</b> gegen ${esc(B.name)}<small>${new Date(x.date).toLocaleDateString("de-AT")} · ${esc(C.tcById(x.tc).label)} · ${(x.moves || []).length} Halbzüge · Elo ${x.elo}</small></span><em>${x.an ? "🔍" : "▶"}</em></button></li>`; }).join("")}</ul>` : `<p class="note">Noch keine Partien. Fordere einen Bot heraus!</p>`}`;
  }

  /* ---------- Partie ---------- */
  function newGame() {
    const m = me(), L = m.last, b0 = C.anyBot(S.sel || L.bot), bot = b0 && (!b0.ev || b0.id.startsWith("ev-" + C.weekEvent().key)) ? b0 : C.botById("eva"), tc = C.tcById(L.tc);
    const color = L.color === "r" ? (Math.random() < 0.5 ? "w" : "b") : L.color;
    S.g = { ch: new Chess(), bot, tc, color, moves: [], clock: tc.min ? { w: tc.min * 60e3, b: tc.min * 60e3 } : null, turnAt: Date.now(), sel: null, targets: [], last: null, hint: null,
      over: null, flip: color === "b", say: bot.hi, thinking: false, undos: 0, helps: 0 };
    persist(); render(); maybeBot();
  }
  function persist() {
    const g = S.g; if (!g || g.over) { lsSet(CUR_KEY, null); return; }
    lsSet(CUR_KEY, JSON.stringify({ bot: g.bot.id, tc: g.tc.id, color: g.color, moves: g.moves, clock: g.clock, helps: g.helps || 0, at: Date.now() }));
  }
  function resume() {
    try {
      const x = JSON.parse(lsGet(CUR_KEY)), ch = new Chess();
      for (const u of x.moves) ch.move(uciToMove(u));
      const last = ch.history({ verbose: true }).slice(-1)[0];
      S.g = { ch, bot: C.anyBot(x.bot) || C.botById("eva"), tc: C.tcById(x.tc), color: x.color, moves: x.moves, clock: x.clock, turnAt: Date.now(), sel: null, targets: [], last: last ? { from: last.from, to: last.to } : null, hint: null, over: null, flip: x.color === "b", say: "Weiter geht's!", thinking: false, undos: 0, helps: Number(x.helps) || 0 };
      render(); maybeBot();
    } catch { lsSet(CUR_KEY, null); render(); }
  }
  /** Geschlagene Figuren je Seite + Materialvorsprung */
  function material(ch) {
    const V = { p: 1, n: 3, b: 3, r: 5, q: 9 }, START = { p: 8, n: 2, b: 2, r: 2, q: 1 }, have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const row of ch.board()) for (const x of row) if (x && x.type !== "k") have[x.color][x.type]++;
    const lost = (c) => Object.keys(START).flatMap((t) => Array(Math.max(0, START[t] - have[c][t])).fill(t));
    const pts = (c) => Object.keys(V).reduce((a, t) => a + V[t] * have[c][t], 0);
    return { took: { w: lost("b"), b: lost("w") }, diff: pts("w") - pts("b") };
  }
  const capsHTML = (mat, c) => { const d = c === "w" ? mat.diff : -mat.diff, oc = c === "w" ? "b" : "w"; return `<span class="sc-caps">${mat.took[c].map((t) => `<i class="pc ${oc}">${GLYPH[t]}\uFE0E</i>`).join("")}${d > 0 ? `<b>+${d}</b>` : ""}</span>`; };
  function gameHTML() {
    const g = S.g, ch = g.ch, myTurn = ch.turn() === g.color && !g.over, mat = material(ch);
    const opp = g.color === "w" ? "b" : "w", m = me();
    const hist = ch.history(), pairs = [];
    for (let i = 0; i < hist.length; i += 2) pairs.push(`<span><em>${i / 2 + 1}.</em> ${esc(hist[i])} ${hist[i + 1] ? esc(hist[i + 1]) : ""}</span>`);
    const clock = (c) => g.clock ? `<b class="sc-clock${ch.turn() === c && !g.over ? " run" : ""}" data-clock="${c}">${C.fmtClock(g.clock[c])}</b>` : "";
    return `<div class="sc sc-game">
      <div class="sc-pl"><span class="sc-ava${g.thinking ? " think" : ""}" aria-hidden="true">${g.bot.e}</span><div><b>${esc(g.bot.name)} <small>${g.bot.elo}</small></b>${capsHTML(mat, opp)}</div>${clock(opp)}</div>
      ${g.say ? `<div class="sc-say bubble" aria-live="polite">${esc(g.say)}</div>` : ""}
      ${boardHTML(ch, { flip: g.flip, sel: g.sel, targets: g.targets, last: g.last, hint: g.hint, check: kingSq(ch), lock: !myTurn })}
      <div class="sc-pl me"><span class="sc-ava" aria-hidden="true">🧑‍🔧</span><div><b>Du <small>${m.elo}</small></b>${capsHTML(mat, g.color)}</div>${clock(g.color)}</div>
      <div class="sc-moves${S.showMoves === false ? " off" : ""}" aria-label="Züge">${pairs.join("") || "<small>Noch keine Züge</small>"}</div>
      ${!g.over ? `<div class="sc-abar">
        <button type="button" data-a="opts"><span>☰</span>Optionen</button>
        <button type="button" data-a="resign"><span>⚑</span>Aufgeben</button>
        <button type="button" data-a="hint"${!myTurn ? " disabled" : ""}><span>💡</span>Hinweis</button>
        <button type="button" data-a="undo"${g.clock || g.moves.length < 1 || g.thinking ? " disabled" : ""}><span>↶</span>Rückgängig</button>
      </div>` : `<div class="sc-abar"><button type="button" data-a="home"><span>🏠</span>Bots</button><button type="button" data-a="rematch"><span>🔁</span>Revanche</button><button type="button" class="next" data-a="analyse"${g.moves.length >= 2 ? "" : " disabled"}>Partie-Analyse</button></div>`}
      ${g.over ? `<div class="sc-over ${g.over.res}"><b>${g.over.res === "win" ? "🏆 Gewonnen!" : g.over.res === "draw" ? "🤝 Remis" : "😵 Verloren"}</b><small>${esc(g.over.why)}${g.over.diff != null ? ` · Elo ${g.over.diff >= 0 ? "+" : ""}${g.over.diff}` : ""}</small></div>` : ""}
    </div>`;
  }
  function finish(res, why) {
    const g = S.g; if (g.over) return;
    g.over = { res, why };
    const pgnHdr = `[White "${g.color === "w" ? "Du" : g.bot.name}"]\n[Black "${g.color === "b" ? "Du" : g.bot.name}"]\n`;
    if (g.moves.length >= 2) {
      const r = C.recordGame(me(), { bot: g.bot.id, res, color: g.color, tc: g.tc.id, moves: g.moves, pgn: pgnHdr + g.ch.pgn(), helps: g.helps || 0 });
      let m2 = r.me;
      if (g.bot.ev && res === "win") {
        const ev = C.weekEvent(), i = Number(g.bot.id.slice(-1));
        if (g.bot.id.startsWith("ev-" + ev.key)) { const w = C.evWin(m2, ev, i); m2 = w.me; if (w.gained) { g.over.why += ` · +💵 ${w.gained}`; setTimeout(() => ui.toast(`🎪 +💵 ${w.gained} fürs Wochen-Event!`, 2400), 300); } }
      }
      saveMe(m2); g.over.diff = r.diff;
    } else g.over.why += " (zu kurz – zählt nicht)";
    g.say = res === "win" ? g.bot.lose : res === "loss" ? g.bot.win : "Remis – fair ist fair.";
    lsSet(CUR_KEY, null); render();
    setTimeout(() => {
      if (S.g !== g) return;
      const title = res === "win" ? "Du hast gewonnen! 🏆" : res === "draw" ? "Remis 🤝" : `${g.bot.name} hat gewonnen`;
      ui.openSheet({ title, bodyHTML: `<div class="sc-endm"><div class="sc-endav"><span>🧑‍🔧</span><b>${res === "win" ? "1" : res === "draw" ? "½" : "0"} – ${res === "loss" ? "1" : res === "draw" ? "½" : "0"}</b><span>${g.bot.e}</span></div>
        <p>durch ${esc(g.over.why.split(" ·")[0])}</p>${g.over.diff != null ? `<p class="sc-endelo ${g.over.diff >= 0 ? "up" : "down"}">Elo ${me().elo} <b>${g.over.diff >= 0 ? "+" : ""}${g.over.diff}</b></p>` : ""}
        ${res === "win" ? `<p class="sc-endcr">${"👑".repeat(C.crownsForWin(g.helps || 0))}<span>${"👑".repeat(3 - C.crownsForWin(g.helps || 0))}</span><br><small>${(g.helps || 0) ? `${g.helps}× Hilfe genutzt – ohne Hinweis & Rückgängig gibt's 3 Kronen` : "Ohne Hilfe gewonnen – 3 Kronen!"}</small></p>` : ""}
        ${/💵/.test(g.over.why) ? `<p class="sc-endev">🎪 ${esc(g.over.why.split("·").pop().trim())} fürs Wochen-Event</p>` : ""}
        <button type="button" class="sc-play" data-e="an"${g.moves.length >= 2 ? "" : " disabled"}>🔍 Partie-Analyse</button>
        <div class="row" style="gap:8px;margin-top:8px"><button type="button" class="btn" data-e="new">Neuer Bot</button><button type="button" class="btn" data-e="re">Revanche</button></div></div>`,
        onMount(sh, close) { sh.addEventListener("click", (ev) => { const x = ev.target.closest("[data-e]"); if (!x || x.disabled) return; close(); if (x.dataset.e === "an") runAnalysis(me().hist.length - 1); else if (x.dataset.e === "re") newGame(); else { S.g = null; render(); } }); } });
    }, 900);
  }
  function checkEnd() {
    const ch = S.g.ch;
    if (ch.isCheckmate()) { finish(ch.turn() === S.g.color ? "loss" : "win", "Schachmatt"); return true; }
    if (ch.isStalemate()) { finish("draw", "Patt"); return true; }
    if (ch.isInsufficientMaterial()) { finish("draw", "Zu wenig Material"); return true; }
    if (ch.isThreefoldRepetition()) { finish("draw", "Dreifache Wiederholung"); return true; }
    if (ch.isDraw()) { finish("draw", "50-Züge-Regel"); return true; }
    return false;
  }
  function applyMove(u, byBot) {
    const g = S.g, now = Date.now(), side = g.ch.turn();
    const mv = g.ch.move(uciToMove(u));
    if (!mv) return false;
    if (g.clock) { g.clock[side] -= now - g.turnAt; g.clock[side] += g.tc.inc * 1000; }
    g.turnAt = now; g.moves.push(u); g.last = { from: mv.from, to: mv.to }; S.anim = { from: mv.from, to: mv.to }; g.sel = null; g.targets = []; g.hint = null;
    g.say = chatter(g, mv, byBot) || (byBot ? g.say : g.say);
    persist();
    if (!checkEnd()) { render(); maybeBot(); }
    return true;
  }
  /** Bot-Kommentare wie ein echter Gegner (Reaktion auf deinen Zug und die Lage) */
  const CH = {
    good: ["Exzellenter Zug. Das hast du schon mal gemacht.", "Das ist ein guter Zug. Respekt.", "Oha, stark gespielt!", "Schlau. Wie bist du nur so schlau?", "Hmm, das gefällt mir gar nicht."],
    blunder: ["Danke für das Geschenk!", "Das hast du nicht wirklich gewollt, oder?", "Ich tu so, als hätte ich das nicht gesehen … nein, doch nicht.", "Uuups. Das wird teuer.", "Heute ist mein Glückstag!"],
    take: ["Das gehört jetzt mir. Keine Sorge, ich pass gut darauf auf.", "Mmh, lecker!", "Jede Figur hat ihren Tag. Heute war nicht ihrer.", "Eingesackt."],
    lost: ["Autsch. Den hab ich gern gehabt.", "Na warte!", "Das war nur ein Warnschuss.", "Gut gesehen."],
    check: ["Ah, ein Schach.", "Hoppla, mein König!", "Ruhig bleiben …"],
    gcheck: ["Schach! ⚡", "Pass auf deinen König auf!", "Schach – und jetzt?"],
    castle: ["König in Sicherheit – vernünftig.", "Rochade. Sehr ordentlich."],
    open: ["Ein guter Anfang. Ruhig, vernünftig.", "Springer raus – sehr gut.", "Klassisch!", "So fängt man an."],
    ahead: ["Der Vorteil ist meiner. Noch.", "Läuft bei mir!"],
    behind: ["Der Vorteil ist deiner. Trotzdem ist noch nichts vorbei.", "Ich geb nicht auf!"],
  };
  const pickL = (a) => a[Math.floor(Math.random() * a.length)];
  function chatter(g, mv, byBot) {
    if (!byBot) {
      if (g.ch.inCheck()) return pickL(CH.check);
      if (mv.flags.includes("k") || mv.flags.includes("q")) return Math.random() < 0.6 ? pickL(CH.castle) : null;
      if (mv.captured && Math.random() < 0.5) return pickL(CH.lost);
      if (g.moves.length <= 8 && Math.random() < 0.35) return pickL(CH.open);
      return null;
    }
    if (g.react) { const r = g.react; g.react = null; return r; }
    if (g.ch.inCheck()) return pickL(CH.gcheck);
    if (mv.captured && Math.random() < 0.55) return pickL(CH.take);
    if (Math.random() < 0.12) return pickL(g.bot.talk);
    return null;
  }
  async function maybeBot() {
    const g = S.g; if (!g || g.over || g.ch.turn() === g.color || g.thinking) return;
    g.thinking = true; render();
    const t0 = Date.now(), ply = g.moves.length, B = g.bot;
    const ms = C.thinkMs(B, g.clock ? g.clock[g.ch.turn()] : null, g.tc.inc);
    const r = await engine(g.ch.fen(), { depth: B.depth, timeMs: ms, noise: ply < 10 ? Math.max(B.noise, 18) : B.noise });
    if (S.g !== g || g.over) return;
    if (r.bestScore != null && g.prevScore != null) {
      const d = r.bestScore - g.prevScore;
      if (d >= 180 && Math.abs(r.bestScore) < 20000) g.react = pickL(CH.blunder);
      else if (d <= -110) g.react = pickL(CH.good);
      else if (Math.random() < 0.08) g.react = pickL(r.bestScore > 200 ? CH.ahead : r.bestScore < -200 ? CH.behind : g.bot.talk);
    }
    g.prevScore = r.bestScore;
    const minThink = g.clock && g.clock[g.ch.turn()] < 60e3 ? 250 : g.tc.min && g.tc.min <= 2 ? 400 : 700 + Math.random() * 900;
    const wait = Math.max(0, minThink - (Date.now() - t0));
    setTimeout(() => { if (S.g !== g || g.over) return; g.thinking = false; if (!r.move || !applyMove(r.move, true)) { g.thinking = false; render(); } }, wait);
  }

  /* ---------- Rätsel ---------- */
  async function startPuzzle(p, daily = false) {
    const ch = new Chess(p.fen), first = ch.move(uciToMove(p.first));
    const color = ch.turn();
    S.pz = { p, ch: new Chess(p.fen), color, step: 0, daily, failed: false, solved: false, last: null, sel: null, targets: [], flip: color === "b", msg: "", first };
    render();
    setTimeout(() => { if (!S.pz || S.pz.p !== p) return; S.pz.ch.move(uciToMove(p.first)); S.pz.last = { from: first.from, to: first.to }; S.anim = { from: first.from, to: first.to }; S.pz.msg = `${color === "w" ? "Weiß" : "Schwarz"} am Zug – finde den besten Zug!`; render(); }, 700);
  }
  function puzzleHTML() {
    const z = S.pz, m = me(), myTurn = z.ch.turn() === z.color && !z.solved && z.last;
    return `<div class="sc sc-game">
      <div class="sc-pzbar"><span>🧩 ${z.daily ? "Tägliches Rätsel" : `Aufgabe · ${esc(z.p.t)}`}</span><b>${z.daily ? esc(z.p.t) : `Wertung ${m.pz.r}`}</b></div>
      <div class="sc-say${z.solved ? " ok" : z.failed ? " bad" : ""}">${esc(z.msg || "Schau dir den letzten Zug an …")}</div>
      ${boardHTML(z.ch, { flip: z.flip, sel: z.sel, targets: z.targets, last: z.last, check: kingSq(z.ch), lock: !myTurn })}
      <div class="sc-ctl">${z.solved || z.failed ? `<button type="button" class="btn primary" data-a="pznext">➡️ Nächste Aufgabe</button>${z.failed && !z.solved ? `<button type="button" class="btn" data-a="pzshow">👀 Lösung zeigen</button>` : ""}` : `<button type="button" class="btn" data-a="pzhint">💡 Tipp</button><button type="button" class="btn" data-a="flip">🔄</button>`}<button type="button" class="btn" data-a="home">🏠</button></div>
      <p class="note">Aufgabe ${z.p.id} · Schwierigkeit ${z.p.r}${m.pz.streak ? ` · 🔥 Serie ${m.pz.streak}` : ""}</p></div>`;
  }
  function puzzleMove(u) {
    const z = S.pz, want = z.p.sol[z.step];
    const mv = z.ch.move(uciToMove(u)); if (!mv) return;
    z.last = { from: mv.from, to: mv.to }; z.sel = null; z.targets = [];
    const okMove = u === want || (want && u.slice(0, 4) === want.slice(0, 4) && !want[4]) || z.ch.isCheckmate();
    if (!okMove) {
      z.msg = "❌ Nicht ganz. Das war nicht der stärkste Zug.";
      if (!z.failed) { z.failed = true; if (!z.daily) saveMe(C.puzzleResult(me(), z.p, false, dayKey())); }
      render(); setTimeout(() => { if (S.pz !== z) return; z.ch.undo(); z.last = null; render(); }, 900);
      return;
    }
    z.step++;
    if (z.step >= z.p.sol.length || z.ch.isCheckmate()) {
      z.solved = true; z.msg = z.failed ? "✅ Gelöst – beim zweiten Versuch." : "✅ Richtig! Stark gespielt.";
      if (!z.failed) {
        let m2 = z.daily ? me() : C.puzzleResult(me(), z.p, true, dayKey());
        if (z.daily) m2 = { ...m2, pz: { ...m2.pz, day: dayKey(), dayDone: true } };
        saveMe(m2);
        if (z.daily) ui.toast("📅 Tägliches Rätsel geschafft! 🎉", 2200);
      }
      render(); return;
    }
    z.msg = "👍 Gut! Weiter …"; render();
    setTimeout(() => { if (S.pz !== z) return; const r = z.p.sol[z.step]; const mv2 = z.ch.move(uciToMove(r)); z.last = { from: mv2.from, to: mv2.to }; S.anim = { from: mv2.from, to: mv2.to }; z.step++; z.msg = "Und jetzt?"; render(); }, 600);
  }

  /* ---------- 🔍 Partie-Analyse ---------- */
  /** Zusatzinfos je Zug: Opfer (für „Großartig“) und Endspiel-Phase */
  function capsOf(moves) {
    const V = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }, c = new Chess(), out = [];
    for (const u of moves) {
      const mv = c.move(uciToMove(u)); if (!mv) { out.push({}); continue; }
      const opp = c.turn(), att = c.attackers ? c.attackers(mv.to, opp) : [];
      const sac = V[mv.piece] >= 3 && att.length > 0 && (mv.captured ? V[mv.captured] : 0) < V[mv.piece] && Math.min(...att.map((sq) => V[c.get(sq).type] || 9)) < V[mv.piece];
      let mat = 0; for (const row of c.board()) for (const x of row) if (x && x.type !== "k" && x.type !== "p") mat += V[x.type];
      out.push({ sac, endgame: mat <= 13 });
    }
    return out;
  }
  async function runAnalysis(i) {
    const m = me(), h = m.hist[i]; if (!h || !h.moves || h.moves.length < 2) return;
    S.g = null; S.review = null;
    const open = (ev, best) => { S.an = { i, ply: 0, step: false, show: false, retry: null, data: C.analyse(h.moves, ev, best, capsOf(h.moves)) }; render(); };
    if (h.an && Array.isArray(h.an.ev) && h.an.ev.length === h.moves.length + 1) { open(h.an.ev, h.an.best); return; }
    const ch = new Chess(), fens = [ch.fen()];
    for (const u of h.moves) { ch.move(uciToMove(u)); fens.push(ch.fen()); }
    const tok = (S.anTok = Symbol());
    const ev = [], best = [];
    for (let k = 0; k < fens.length; k++) {
      if (S.anTok !== tok || !S.alive) return;
      el.innerHTML = `<div class="sc sc-game"><div class="sc-anprog"><span aria-hidden="true">🧑‍🏫</span><b>Der Coach schaut sich deine Partie an …</b><small>Zug ${Math.ceil(k / 2)} von ${Math.ceil(h.moves.length / 2)}</small><span class="sc-anbar"><i style="width:${(k / fens.length) * 100}%"></i></span><button type="button" class="btn" data-a="home">Abbrechen</button></div></div>`;
      const c2 = new Chess(fens[k]);
      if (c2.isGameOver()) { ev.push(c2.isCheckmate() ? (c2.turn() === "w" ? -C.MATE_CP + 1 : C.MATE_CP - 1) : 0); best.push(""); continue; }
      const r = await engine(fens[k], { depth: 9, timeMs: 380 });
      const sc = r.bestScore != null ? r.bestScore : r.score;
      ev.push(c2.turn() === "w" ? sc : -sc); best.push(r.best || r.move || "");
    }
    if (S.anTok !== tok) return;
    const m2 = me(), hist = m2.hist.slice(); hist[i] = { ...hist[i], an: { ev, best } };
    saveMe({ ...m2, hist });
    open(ev, best);
  }
  function evalGraph(ev, ply, D) {
    const W = 300, H = 64, n = ev.length - 1 || 1, y = (cp) => H / 2 - ((C.winPct(cp) - 50) / 50) * (H / 2 - 2);
    const pts = ev.map((cp, k) => `${((k / n) * W).toFixed(1)},${y(cp).toFixed(1)}`).join(" ");
    const dots = D.moves.filter((x) => ["blund", "mist", "miss", "great"].includes(x.cls)).map((x) => `<circle cx="${(((x.ply + 1) / n) * W).toFixed(1)}" cy="${y(ev[x.ply + 1]).toFixed(1)}" r="3.2" fill="${C.classOf(x.cls).c}" stroke="#111" stroke-width=".8"/>`).join("");
    return `<svg class="sc-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Bewertungsverlauf"><rect width="${W}" height="${H}" fill="#3c3a38"/><polygon points="0,${H} ${pts} ${W},${H}" fill="#f8f8f6"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#8b8987" stroke-width=".6"/>${dots}${ply != null ? `<line x1="${(ply / n) * W}" y1="0" x2="${(ply / n) * W}" y2="${H}" stroke="#81b64c" stroke-width="2"/>` : ""}</svg>`;
  }
  const PH = { good: ["✓", "#81b64c"], inacc: ["?!", "#f7c631"], bad: ["?", "#ffa459"] };
  function analysisHTML() {
    const A = S.an, h = me().hist[A.i], B = C.anyBot(h.bot) || C.botById("eva"), D = A.data, ev = h.an.ev;
    const mine = h.color, opp = mine === "w" ? "b" : "w";
    const who = (side) => (side === mine ? "Du" : B.name);
    const sanAt = (k, u) => { const c = new Chess(); for (let j = 0; j < k; j++) c.move(uciToMove(h.moves[j])); const mv = u ? c.move(uciToMove(u)) : null; return mv ? mv.san : ""; };
    if (!A.step) {
      const icon = (k) => { const c = C.classOf(k); return `<span class="sc-ci" style="--c:${c.c}">${c.e}</span>`; };
      const phase = (side, ph) => { const v = D.phase[side][ph]; return v ? `<span class="sc-ci sm" style="--c:${PH[v][1]}">${PH[v][0]}</span>` : `<span class="sc-dash">–</span>`; };
      return `<div class="sc sc-game sc-rev">
        <div class="sc-revtop"><div class="sc-revp"><span class="sc-ava">🧑‍🔧</span><b>Du</b><em>${D.acc[mine]}</em><small>Genauigkeit</small></div><div class="sc-revvs">${h.res === "win" ? "1 – 0" : h.res === "draw" ? "½ – ½" : "0 – 1"}</div><div class="sc-revp"><span class="sc-ava">${B.e}</span><b>${esc(B.name)}</b><em>${D.acc[opp]}</em><small>Genauigkeit</small></div></div>
        ${evalGraph(ev, null, D)}
        <table class="sc-revtab">${C.CLASSES.map((c) => `<tr><th>${c.t}</th><td style="color:${c.c}">${D.count[mine][c.k]}</td><td>${icon(c.k)}</td><td style="color:${c.c}">${D.count[opp][c.k]}</td></tr>`).join("")}</table>
        <table class="sc-revtab sc-revph"><tr><th>Spielbewertung</th><td><b class="sc-rate">${D.rating[mine]}</b></td><td></td><td><b class="sc-rate">${D.rating[opp]}</b></td></tr>
          ${[["open", "Eröffnung"], ["mid", "Mittelspiel"], ["end", "Endspiel"]].map(([k, l]) => `<tr><th>${l}</th><td>${phase(mine, k)}</td><td></td><td>${phase(opp, k)}</td></tr>`).join("")}</table>
        <button type="button" class="sc-play" data-a="anstep">Partie-Analyse starten</button>
        <div class="sc-ctl"><button type="button" class="btn" data-a="rematch2">🔁 Revanche</button><button type="button" class="btn" data-a="home">🏠 Übersicht</button></div>
      </div>`;
    }
    // Schritt-Modus mit Coach
    const ch = new Chess(); let last = null;
    for (let k = 0; k < A.ply; k++) { const mv = ch.move(uciToMove(h.moves[k])); last = { from: mv.from, to: mv.to }; }
    const k = A.ply - 1, cur = k >= 0 ? D.moves[k] : null, cls = cur && C.classOf(cur.cls);
    const arrows = [];
    if (cur && !["best", "great"].includes(cur.cls) && h.an.best[k]) arrows.push({ from: h.an.best[k].slice(0, 2), to: h.an.best[k].slice(2, 4), color: "#81b64c" });
    if (A.show && h.an.best[A.ply]) arrows.push({ from: h.an.best[A.ply].slice(0, 2), to: h.an.best[A.ply].slice(2, 4), color: "#3b82f6" });
    let bubble;
    if (A.retry) bubble = `<div class="sc-cbh"><b>${A.retry.msg || "Finde einen besseren Zug!"}</b></div><p>Zieh selbst – wer ist am Zug: <b>${A.retry.side === "w" ? "Weiß" : "Schwarz"}</b>.</p>`;
    else if (cur) {
      const x = Coach.explain({ moves: h.moves, ev, best: h.an.best, an: D, k, who });
      const ai = (A.ai || {})[A.ply];
      bubble = `<div class="sc-cbh"><span class="sc-ci" style="--c:${cls.c}">${cls.e}</span><b>${esc(sanAt(k, h.moves[k]))} ist ${cls.k === "best" ? "der beste Zug" : cls.k === "great" ? "großartig!" : cls.k === "miss" ? "eine verpasste Chance" : cls.t.toLowerCase().replace(/^gut$/, "gut").replace(/^exzellent$/, "exzellent").replace(/^ungenau$/, "ungenau").replace(/^fehler$/, "ein Fehler").replace(/^patzer$/, "ein Patzer")}</b><em>${C.fmtEval(ev[k + 1])}</em></div>
        <ul class="sc-coach">${x.lines.map((l) => `<li>${esc(l).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</li>`).join("")}</ul>
        ${ai ? `<div class="sc-ai${ai.busy ? " busy" : ""}">${ai.busy ? "🤖 Claude denkt nach …" : esc(ai.text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>")}</div>` : `<button type="button" class="sc-askai" data-a="ancoach">🤖 Claude fragen</button>`}`;
    } else {
      const sm = Coach.summary({ moves: h.moves, ev, an: D, who });
      bubble = `<div class="sc-cbh"><b>Los geht's! Wir gehen die Partie gemeinsam durch.</b></div>${sm.key.length ? `<ul class="sc-coach">${sm.key.map((x) => `<li><button type="button" class="sc-keymv" data-a="an" data-v="p${x.ply + 1}">🔎 ${esc(x.text)}</button></li>`).join("")}</ul>` : "<p>Keine groben Fehler – saubere Partie! 👏</p>"}`;
    }
    const e = ev[A.ply], wp = C.winPct(e);
    const board = A.retry ? boardHTML(A.retry.ch, { flip: mine === "b", sel: A.retry.sel, targets: A.retry.targets || [], last: A.retry.last, check: kingSq(A.retry.ch) })
      : boardHTML(ch, { flip: mine === "b", last, check: kingSq(ch), lock: true, arrows, badge: cur ? { sq: h.moves[k].slice(2, 4), e: cls.e, c: cls.c } : null });
    return `<div class="sc sc-game sc-rev">
      <div class="sc-coachrow"><span class="sc-ava coach">🧑‍🏫</span><div class="sc-cbubble" style="--c:${cls ? cls.c : "#81b64c"}">${bubble}</div></div>
      <div class="sc-anboard"><div class="sc-evalbar" aria-label="Bewertung ${C.fmtEval(e)}"><i style="height:${mine === "b" ? wp : 100 - wp}%"></i><b>${C.fmtEval(e)}</b></div>${board}</div>
      <div class="sc-strip"><button type="button" class="sc-arr" data-a="an" data-v="-1" aria-label="Zurück">‹</button><div class="sc-anlist">${D.moves.map((x, j) => `<button type="button" class="${A.ply === j + 1 ? "on" : ""}" data-a="an" data-v="p${j + 1}" style="--c:${C.classOf(x.cls).c}">${j % 2 === 0 ? `<em>${j / 2 + 1}.</em>` : ""}${["blund", "mist", "miss", "inacc", "great"].includes(x.cls) ? `<i class="sc-ci xs" style="--c:${C.classOf(x.cls).c}">${C.classOf(x.cls).e}</i>` : ""}${esc(sanAt(j, h.moves[j]))}</button>`).join("")}</div><button type="button" class="sc-arr" data-a="an" data-v="1" aria-label="Weiter">›</button></div>
      ${evalGraph(ev, A.ply, D)}
      <div class="sc-abar">
        <button type="button" data-a="anshow" aria-pressed="${!!A.show}"><span>💡</span>Anzeigen</button>
        <button type="button" data-a="anretry"${cur && !["best", "great"].includes(cur.cls) ? "" : " disabled"}><span>🔄</span>Wiederholen</button>
        <button type="button" data-a="anover"><span>📊</span>Übersicht</button>
        <button type="button" class="next" data-a="an" data-v="1"${A.ply >= h.moves.length ? " disabled" : ""}>Nächste</button>
      </div>
    </div>`;
  }
  /** Wiederholen: Spieler sucht selbst einen besseren Zug in der Stellung vor dem Zug */
  function retryMove(u) {
    const A = S.an, h = me().hist[A.i], R = A.retry, k = A.ply - 1;
    const mv = R.ch.move(uciToMove(u)); if (!mv) return;
    R.last = { from: mv.from, to: mv.to }; R.sel = null; R.targets = [];
    const best = h.an.best[k];
    if (best && u.slice(0, 4) === best.slice(0, 4)) { R.msg = "★ Richtig! Das ist der beste Zug. 🎉"; R.done = true; }
    else { R.msg = "Nicht ganz – versuch's nochmal (oder 💡 Anzeigen)."; setTimeout(() => { if (S.an === A && A.retry === R) { R.ch.undo(); R.last = null; render(); } }, 900); }
    S.anim = { from: mv.from, to: mv.to }; render();
    if (R.done) setTimeout(() => { if (S.an === A && A.retry === R) { A.retry = null; render(); } }, 1600);
  }

  /* ---------- Partie nachspielen ---------- */
  function reviewHTML() {
    const R = S.review, h = me().hist[R.i], B = C.anyBot(h.bot) || C.botById("eva"), ch = new Chess();
    let last = null; for (let k = 0; k < R.ply; k++) { const mv = ch.move(uciToMove(h.moves[k])); last = { from: mv.from, to: mv.to }; }
    return `<div class="sc sc-game"><div class="sc-pzbar"><span>📜 ${h.res === "win" ? "Sieg" : h.res === "draw" ? "Remis" : "Niederlage"} gegen ${B.e} ${esc(B.name)}</span><b>${R.ply}/${h.moves.length}</b></div>
      ${boardHTML(ch, { flip: h.color === "b", last, check: kingSq(ch), lock: true })}
      <div class="sc-ctl"><button type="button" class="btn" data-a="rv" data-v="0">⏮</button><button type="button" class="btn" data-a="rv" data-v="-1">◀</button><button type="button" class="btn primary" data-a="rv" data-v="1">▶</button><button type="button" class="btn" data-a="rv" data-v="999">⏭</button><button type="button" class="btn" data-a="analyse" data-i="${R.i}">🔍</button><button type="button" class="btn" data-a="home">🏠</button></div></div>`;
  }

  function render() {
    if (!S.alive) return;
    el.innerHTML = S.an ? analysisHTML() : S.pz ? puzzleHTML() : S.review ? reviewHTML() : S.g ? gameHTML() : homeHTML();
    if (S.anim) { const a = S.anim; S.anim = null; slide(a.from, a.to); }
    if (S.an) { const on = el.querySelector(".sc-anlist .on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  }
  /** Figur gleitet vom Start- aufs Zielfeld (statt zu springen) */
  function slide(from, to) {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const f = el.querySelector(`[data-sq="${from}"]`), t = el.querySelector(`[data-sq="${to}"]`), pc = t && t.querySelector(".pc");
      if (!f || !pc) return;
      const fr = f.getBoundingClientRect(), tr = t.getBoundingClientRect();
      pc.style.transition = "none"; pc.style.transform = `translate(${fr.left - tr.left}px, ${fr.top - tr.top}px)`; pc.style.zIndex = "5";
      requestAnimationFrame(() => requestAnimationFrame(() => { pc.style.transition = "transform .28s cubic-bezier(.3,.7,.4,1)"; pc.style.transform = "translate(0,0)"; setTimeout(() => { pc.style.zIndex = ""; }, 320); }));
    } catch { /* egal */ }
  }

  /* ---------- Bedienung ---------- */
  function onSquare(sq) {
    if (S.an && S.an.retry) {
      const R = S.an.retry, t = (R.targets || []).find((x) => x.to === sq);
      if (R.sel && t) { retryMove(R.sel + sq + (t.promotion ? "q" : "")); return; }
      const p = R.ch.get(sq); if (p && p.color === R.ch.turn()) { R.sel = sq; R.targets = R.ch.moves({ square: sq, verbose: true }); } else { R.sel = null; R.targets = []; }
      render(); return;
    }
    const ctx = S.pz || S.g; if (!ctx) return;
    const ch = ctx.ch;
    if (S.g && !S.pz && (S.g.over || ch.turn() !== S.g.color || S.g.thinking)) return;
    if (S.pz && (S.pz.solved || ch.turn() !== S.pz.color)) return;
    const t = ctx.targets.find((x) => x.to === sq);
    if (ctx.sel && t) {
      const go = (promo) => { const u = ctx.sel + sq + (promo || ""); if (S.pz) puzzleMove(u); else applyMove(u, false); };
      if (t.promotion) {
        ui.openSheet({ title: "Umwandeln in …", bodyHTML: `<div class="sc-promo">${["q", "r", "b", "n"].map((x) => `<button type="button" data-p="${x}"><span class="pc ${ch.turn()}">${GLYPH[x]}︎</span></button>`).join("")}</div>`,
          onMount(sh, close) { sh.addEventListener("click", (ev) => { const b = ev.target.closest("[data-p]"); if (!b) return; close(); go(b.dataset.p); }); } });
      } else go("");
      return;
    }
    const p = ch.get(sq);
    if (p && p.color === ch.turn()) { ctx.sel = sq; ctx.targets = ch.moves({ square: sq, verbose: true }); }
    else { ctx.sel = null; ctx.targets = []; }
    render();
  }
  el.addEventListener("click", async (ev) => {
    const sqb = ev.target.closest("[data-sq]");
    if (sqb && !sqb.closest(".lock")) { onSquare(sqb.dataset.sq); return; }
    const b = ev.target.closest("[data-a]"); if (!b || b.disabled) return;
    const m = me();
    switch (b.dataset.a) {
      case "tab": S.tab = b.dataset.v; lsSet(TAB_KEY, S.tab); render(); break;
      case "bot": S.sel = b.dataset.v; saveMe({ ...m, last: { ...m.last, bot: S.sel } }); render(); break;
      case "tcopen": S.tcOpen = !S.tcOpen; render(); break;
      case "catopen": S.open = S.open === b.dataset.v ? null : b.dataset.v; render(); break;
      case "anstep": S.an.step = true; S.an.ply = 0; render(); break;
      case "anover": S.an.step = false; S.an.retry = null; render(); break;
      case "anshow": S.an.show = !S.an.show; render(); break;
      case "rematch2": { const h = me().hist[S.an.i]; S.an = null; S.sel = h.bot; newGame(); break; }
      case "anretry": { const A = S.an, h = me().hist[A.i], c = new Chess(); for (let j = 0; j < A.ply - 1; j++) c.move(uciToMove(h.moves[j])); A.retry = { ch: c, side: c.turn(), sel: null, targets: [], last: null, msg: "" }; render(); break; }
      case "ancoach": {
        const A = S.an, h = me().hist[A.i], k = A.ply - 1; if (k < 0) break;
        if (!aiAvailable()) { ui.toast("Claude braucht die Anmeldung mit Google – im lokalen Modus geht das nicht.", 2600); break; }
        const B = C.anyBot(h.bot) || C.botById("eva"), c = new Chess(); for (let j = 0; j < k; j++) c.move(uciToMove(h.moves[j]));
        const fen = c.fen(), mv = c.move(uciToMove(h.moves[k])), bc = new Chess(fen), bm = h.an.best[k] ? bc.move(uciToMove(h.an.best[k])) : null;
        const who = (sd) => (sd === h.color ? "ich (der Spieler)" : `der Bot ${B.name}`), D = A.data;
        const x = Coach.explain({ moves: h.moves, ev: h.an.ev, best: h.an.best, an: D, k, who: (sd) => (sd === h.color ? "Du" : B.name) });
        const prompt = `Du bist ein freundlicher Schach-Coach für einen Lehrling (ca. ${me().elo} Elo). Erkläre auf Deutsch, kurz (max. 6 Sätze) und konkret, warum dieser Zug ${C.classOf(D.moves[k].cls).t.toLowerCase()} war, welche Idee der bessere Zug hat und was man daraus allgemein lernen kann.\n\nStellung vor dem Zug (FEN): ${fen}\nGezogen hat ${who(D.moves[k].side)}: ${mv.san}\nEngine-Bester Zug: ${bm ? bm.san : "?"}\nBewertung vorher/nachher (Sicht Weiß, Bauerneinheiten): ${C.fmtEval(h.an.ev[k])} / ${C.fmtEval(h.an.ev[k + 1])}\nHinweise der Engine: ${x.lines.join(" ").replace(/\*\*/g, "")}`;
        A.ai = { ...(A.ai || {}), [A.ply]: { busy: true } }; render();
        try { const out = await askClaude([{ role: "user", content: prompt }], { body: { mode: "lehrer" }, timeoutMs: 60000 }); A.ai[A.ply + 0] = { text: String(out.reply || "").trim() || "Keine Antwort – nochmal probieren." }; }
        catch (err) { A.ai[A.ply] = { text: "⚠️ " + ((err && err.message) || String(err)) }; }
        if (S.an === A) render();
        break;
      }
      case "analyse": { const hi = b.dataset.i != null ? Number(b.dataset.i) : me().hist.length - 1; runAnalysis(hi); break; }
      case "an": { const A = S.an, n = me().hist[A.i].moves.length, v = b.dataset.v; const prev = A.ply; A.retry = null; A.ply = v === "0" ? 0 : v === "end" ? n : v.startsWith("p") ? Number(v.slice(1)) : Math.max(0, Math.min(n, A.ply + Number(v))); if (A.ply === prev + 1) { const u = me().hist[A.i].moves[prev]; S.anim = { from: u.slice(0, 2), to: u.slice(2, 4) }; } render(); break; }
      case "tc": S.tcOpen = false; saveMe({ ...m, last: { ...m.last, tc: b.dataset.v } }); setTimeout(render, 30); break;
      case "color": saveMe({ ...m, last: { ...m.last, color: b.dataset.v } }); setTimeout(render, 30); break;
      case "play": if (lsGet(CUR_KEY)) { ui.openSheet({ title: "Neue Partie?", bodyHTML: `<p>Die laufende Partie wird dann als Niederlage gewertet … nein, keine Sorge: sie wird einfach verworfen.</p><div class="row" style="gap:8px"><button type="button" class="btn" data-no>Abbrechen</button><button type="button" class="btn primary" data-yes>Neue Partie</button></div>`, onMount(sh, close) { sh.querySelector("[data-no]").onclick = close; sh.querySelector("[data-yes]").onclick = () => { close(); lsSet(CUR_KEY, null); newGame(); }; } }); } else newGame(); break;
      case "resume": resume(); break;
      case "evclaim": {
        const ev = C.weekEvent(), st = C.evState(m, ev), can = C.evClaimable(st);
        if (!can.length) break;
        const ty = sp.get("tycoon") || {}, inv = { ...(ty.inv || {}) }; let fuses = Number(ty.fuses ?? 5) || 0, cups = m.cups;
        for (const i of can) { const x = C.EV_TRACK[i]; if (x.fuses) fuses += x.fuses; if (x.inv) inv[x.inv] = (inv[x.inv] || 0) + 1; if (x.cup) cups++; }
        try { const p = sp.put({ ...ty, id: "tycoon", fuses, inv }); if (p && p.catch) p.catch(() => {}); } catch { /* egal */ }
        saveMe({ ...m, cups, ev: { key: ev.key, won: st.won, claimed: [...st.claimed, ...can] } });
        ui.toast(`🎁 ${can.map((i) => C.EV_TRACK[i].e + " " + C.EV_TRACK[i].t).join(" · ")} → Strom-Tycoon`, 3200);
        setTimeout(render, 50); break;
      }
      case "home": S.g = null; S.pz = null; S.review = null; S.an = null; render(); break;
      case "rematch": newGame(); break;
      case "opts": ui.openSheet({ title: "Optionen", bodyHTML: `<div class="sc-optl"><button type="button" class="btn" data-o="flip">🔄 Brett drehen</button><button type="button" class="btn" data-o="moves">📜 Zugliste ${S.showMoves ? "ausblenden" : "einblenden"}</button></div>`, onMount(sh, close) { sh.addEventListener("click", (ev) => { const o = ev.target.closest("[data-o]"); if (!o) return; close(); if (o.dataset.o === "flip") { S.g.flip = !S.g.flip; } else S.showMoves = !S.showMoves; render(); }); } }); break;
      case "flip": { const c = S.pz || S.g; c.flip = !c.flip; render(); break; }
      case "undo": { const g = S.g; if (g.thinking) break; const n = g.ch.turn() === g.color ? 2 : 1; for (let k = 0; k < n && g.moves.length; k++) { g.ch.undo(); g.moves.pop(); } const l = g.ch.history({ verbose: true }).slice(-1)[0]; g.last = l ? { from: l.from, to: l.to } : null; g.sel = null; g.targets = []; g.undos++; g.helps = (g.helps || 0) + 1; persist(); render(); maybeBot(); break; }
      case "hint": { const g = S.g; b.disabled = true; g.helps = (g.helps || 0) + 1; persist(); const r = await engine(g.ch.fen(), { depth: 6, timeMs: 1200 }); if (S.g === g && r.move) { g.hint = { from: r.move.slice(0, 2), to: r.move.slice(2, 4) }; g.say = "💡 Schau dir die markierten Felder an."; render(); } break; }
      case "resign": ui.openSheet({ title: "Aufgeben?", bodyHTML: `<div class="row" style="gap:8px"><button type="button" class="btn" data-no>Weiterspielen</button><button type="button" class="btn primary" data-yes>🏳️ Aufgeben</button></div>`, onMount(sh, close) { sh.querySelector("[data-no]").onclick = close; sh.querySelector("[data-yes]").onclick = () => { close(); finish("loss", "Aufgegeben"); }; } }); break;
      case "puzzle": { const P = await loadPuzzles(); startPuzzle(C.nextPuzzle(P, me())); break; }
      case "daily": { const P = await loadPuzzles(); startPuzzle(C.dailyPuzzle(P, dayKey()), true); break; }
      case "pznext": { const P = await loadPuzzles(); const d = S.pz && S.pz.daily; if (d) { S.pz = null; render(); } else startPuzzle(C.nextPuzzle(P, me())); break; }
      case "pzhint": { const z = S.pz, u = z.p.sol[z.step]; z.sel = u.slice(0, 2); z.targets = z.ch.moves({ square: z.sel, verbose: true }); z.msg = "💡 Mit dieser Figur geht's."; if (!z.failed) { z.failed = true; if (!z.daily) saveMe(C.puzzleResult(me(), z.p, false, dayKey())); } render(); break; }
      case "pzshow": { const z = S.pz; z.ch = new Chess(z.p.fen); z.ch.move(uciToMove(z.p.first)); let k = 0; const step = () => { if (S.pz !== z || k >= z.p.sol.length) { z.solved = true; z.msg = "👀 Das war die Lösung."; render(); return; } const mv = z.ch.move(uciToMove(z.p.sol[k++])); z.last = { from: mv.from, to: mv.to }; render(); setTimeout(step, 800); }; step(); break; }
      case "review": S.review = { i: Number(b.dataset.i), ply: 0 }; render(); break;
      case "rv": { const R = S.review, n = me().hist[R.i].moves.length, v = Number(b.dataset.v); R.ply = v === 0 ? 0 : v === 999 ? n : Math.max(0, Math.min(n, R.ply + v)); render(); break; }
    }
  });

  /* ---------- Uhr ---------- */
  const clockLoop = setInterval(() => {
    const g = S.g; if (!g || !g.clock || g.over || document.hidden) return;
    const side = g.ch.turn(), left = g.clock[side] - (Date.now() - g.turnAt);
    const elc = el.querySelector(`[data-clock="${side}"]`); if (elc) { elc.textContent = C.fmtClock(left); elc.classList.toggle("low", left < 20e3); }
    if (left <= 0) { g.clock[side] = 0; finish(side === g.color ? "loss" : "win", "Zeit abgelaufen"); }
  }, 100);
  const offSp = sp.watch(() => { if (!S.g && !S.pz && !S.review) render(); });

  render();
  return () => { S.alive = false; clearInterval(clockLoop); try { offSp(); } catch { /* egal */ } if (S.g && !S.g.over) persist(); };
}
