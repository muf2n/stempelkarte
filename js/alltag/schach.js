// ♟️ Schach (#alltag/schach) – komplett offline: Bots mit Persönlichkeit, Bedenkzeiten, Farbwahl, Elo, Taktikaufgaben,
// tägliches Rätsel, Partien nachspielen. Regeln/SAN: vendor/chess (chess.js, BSD-2), Engine: ../chess-engine.js (Worker).
// Gespeichert: Sammlung „spiel“, Dokument "schach" (Logik: ./schach-core.js). Laufende Partie zusätzlich lokal (sk-schach-cur).
import { Chess } from "../../vendor/chess/chess.js";
import { collection } from "./db.js";
import * as C from "./schach-core.js";
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
  function boardHTML(ch, { flip, sel, targets = [], last, hint, check, lock }) {
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
    return `<div class="sc-board${lock ? " lock" : ""}">${rows.join("")}</div>`;
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
      over: null, flip: color === "b", say: bot.hi, thinking: false, undos: 0 };
    persist(); render(); maybeBot();
  }
  function persist() {
    const g = S.g; if (!g || g.over) { lsSet(CUR_KEY, null); return; }
    lsSet(CUR_KEY, JSON.stringify({ bot: g.bot.id, tc: g.tc.id, color: g.color, moves: g.moves, clock: g.clock, at: Date.now() }));
  }
  function resume() {
    try {
      const x = JSON.parse(lsGet(CUR_KEY)), ch = new Chess();
      for (const u of x.moves) ch.move(uciToMove(u));
      const last = ch.history({ verbose: true }).slice(-1)[0];
      S.g = { ch, bot: C.anyBot(x.bot) || C.botById("eva"), tc: C.tcById(x.tc), color: x.color, moves: x.moves, clock: x.clock, turnAt: Date.now(), sel: null, targets: [], last: last ? { from: last.from, to: last.to } : null, hint: null, over: null, flip: x.color === "b", say: "Weiter geht's!", thinking: false, undos: 0 };
      render(); maybeBot();
    } catch { lsSet(CUR_KEY, null); render(); }
  }
  function gameHTML() {
    const g = S.g, ch = g.ch, myTurn = ch.turn() === g.color && !g.over;
    const opp = g.color === "w" ? "b" : "w", m = me();
    const hist = ch.history(), pairs = [];
    for (let i = 0; i < hist.length; i += 2) pairs.push(`<span><em>${i / 2 + 1}.</em> ${esc(hist[i])} ${hist[i + 1] ? esc(hist[i + 1]) : ""}</span>`);
    const clock = (c) => g.clock ? `<b class="sc-clock${ch.turn() === c && !g.over ? " run" : ""}" data-clock="${c}">${C.fmtClock(g.clock[c])}</b>` : "";
    return `<div class="sc sc-game">
      <div class="sc-pl"><span class="sc-ava" aria-hidden="true">${g.bot.e}</span><div><b>${esc(g.bot.name)}</b><small>${g.bot.elo}${g.thinking ? " · denkt nach …" : ""}</small></div>${clock(opp)}</div>
      ${g.say ? `<div class="sc-say">${esc(g.say)}</div>` : ""}
      ${boardHTML(ch, { flip: g.flip, sel: g.sel, targets: g.targets, last: g.last, hint: g.hint, check: kingSq(ch), lock: !myTurn })}
      <div class="sc-pl me"><span class="sc-ava" aria-hidden="true">🧑‍🔧</span><div><b>Du</b><small>${m.elo}</small></div>${clock(g.color)}</div>
      <div class="sc-moves" aria-label="Züge">${pairs.join("") || "<small>Noch keine Züge</small>"}</div>
      <div class="sc-ctl">
        ${!g.over ? `${!g.clock ? `<button type="button" class="btn" data-a="undo"${g.moves.length < 1 || g.thinking ? " disabled" : ""}>↩️ Zurück</button>` : ""}
        <button type="button" class="btn" data-a="hint"${!myTurn ? " disabled" : ""}>💡 Tipp</button>
        <button type="button" class="btn" data-a="flip">🔄</button>
        <button type="button" class="btn" data-a="resign">🏳️ Aufgeben</button>` : `<button type="button" class="btn primary" data-a="rematch">🔁 Revanche</button>${g.moves.length >= 2 ? `<button type="button" class="btn" data-a="analyse">🔍 Analyse</button>` : ""}<button type="button" class="btn" data-a="home">🏠</button>`}
      </div>
      ${g.over ? `<div class="sc-over ${g.over.res}"><b>${g.over.res === "win" ? "🏆 Gewonnen!" : g.over.res === "draw" ? "🤝 Remis" : "😵 Verloren"}</b><small>${esc(g.over.why)}${g.over.diff != null ? ` · Elo ${g.over.diff >= 0 ? "+" : ""}${g.over.diff}` : ""}</small></div>` : ""}
    </div>`;
  }
  function finish(res, why) {
    const g = S.g; if (g.over) return;
    g.over = { res, why };
    const pgnHdr = `[White "${g.color === "w" ? "Du" : g.bot.name}"]\n[Black "${g.color === "b" ? "Du" : g.bot.name}"]\n`;
    if (g.moves.length >= 2) {
      const r = C.recordGame(me(), { bot: g.bot.id, res, color: g.color, tc: g.tc.id, moves: g.moves, pgn: pgnHdr + g.ch.pgn() });
      let m2 = r.me;
      if (g.bot.ev && res === "win") {
        const ev = C.weekEvent(), i = Number(g.bot.id.slice(-1));
        if (g.bot.id.startsWith("ev-" + ev.key)) { const w = C.evWin(m2, ev, i); m2 = w.me; if (w.gained) { g.over.why += ` · +💵 ${w.gained}`; setTimeout(() => ui.toast(`🎪 +💵 ${w.gained} fürs Wochen-Event!`, 2400), 300); } }
      }
      saveMe(m2); g.over.diff = r.diff;
    } else g.over.why += " (zu kurz – zählt nicht)";
    g.say = res === "win" ? g.bot.lose : res === "loss" ? g.bot.win : "Remis – fair ist fair.";
    lsSet(CUR_KEY, null); render();
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
    if (byBot) {
      const talk = g.ch.inCheck() ? "Schach! ⚡" : mv.captured && Math.random() < 0.5 ? g.bot.talk[Math.floor(Math.random() * g.bot.talk.length)] : Math.random() < 0.12 ? g.bot.talk[Math.floor(Math.random() * g.bot.talk.length)] : null;
      if (talk) g.say = talk;
    }
    persist();
    if (!checkEnd()) { render(); maybeBot(); }
    return true;
  }
  async function maybeBot() {
    const g = S.g; if (!g || g.over || g.ch.turn() === g.color || g.thinking) return;
    g.thinking = true; render();
    const t0 = Date.now(), ply = g.moves.length, B = g.bot;
    const ms = C.thinkMs(B, g.clock ? g.clock[g.ch.turn()] : null, g.tc.inc);
    const r = await engine(g.ch.fen(), { depth: B.depth, timeMs: ms, noise: ply < 10 ? Math.max(B.noise, 18) : B.noise });
    if (S.g !== g || g.over) return;
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
  async function runAnalysis(i) {
    const m = me(), h = m.hist[i]; if (!h || !h.moves || h.moves.length < 2) return;
    S.g = null; S.review = null;
    if (h.an && Array.isArray(h.an.ev) && h.an.ev.length === h.moves.length + 1) { S.an = { i, ply: 0, data: C.analyse(h.moves, h.an.ev, h.an.best) }; render(); return; }
    const ch = new Chess(), fens = [ch.fen()];
    for (const u of h.moves) { ch.move(uciToMove(u)); fens.push(ch.fen()); }
    const tok = (S.anTok = Symbol());
    const ev = [], best = [];
    for (let k = 0; k < fens.length; k++) {
      if (S.anTok !== tok || !S.alive) return;
      el.innerHTML = `<div class="sc sc-game"><div class="sc-anprog"><span aria-hidden="true">🔍</span><b>Partie wird analysiert …</b><small>Zug ${Math.ceil(k / 2)} von ${Math.ceil(h.moves.length / 2)}</small><span class="sc-anbar"><i style="width:${(k / fens.length) * 100}%"></i></span><button type="button" class="btn" data-a="home">Abbrechen</button></div></div>`;
      const c2 = new Chess(fens[k]);
      if (c2.isGameOver()) { ev.push(c2.isCheckmate() ? (c2.turn() === "w" ? -C.MATE_CP + 1 : C.MATE_CP - 1) : 0); best.push(""); continue; }
      const r = await engine(fens[k], { depth: 9, timeMs: 380 });
      const sc = r.bestScore != null ? r.bestScore : r.score;
      ev.push(c2.turn() === "w" ? sc : -sc); best.push(r.best || r.move || "");
    }
    if (S.anTok !== tok) return;
    const m2 = me(), hist = m2.hist.slice(); hist[i] = { ...hist[i], an: { ev, best } };
    saveMe({ ...m2, hist });
    S.an = { i, ply: 0, data: C.analyse(h.moves, ev, best) }; render();
  }
  function evalGraph(ev, ply) {
    const W = 300, H = 70, n = ev.length - 1 || 1, y = (cp) => H / 2 - ((C.winPct(cp) - 50) / 50) * (H / 2 - 2);
    const pts = ev.map((cp, k) => `${((k / n) * W).toFixed(1)},${y(cp).toFixed(1)}`).join(" ");
    return `<svg class="sc-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Bewertungsverlauf"><rect width="${W}" height="${H}" fill="#1f2937"/><polygon points="0,${H} ${pts} ${W},${H}" fill="#f1f5f9"/><line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#94a3b8" stroke-width=".6"/><line x1="${(ply / n) * W}" y1="0" x2="${(ply / n) * W}" y2="${H}" stroke="#22c55e" stroke-width="2"/></svg>`;
  }
  function analysisHTML() {
    const A = S.an, h = me().hist[A.i], B = C.anyBot(h.bot) || C.botById("eva"), D = A.data, ev = h.an.ev;
    const ch = new Chess(); let last = null;
    for (let k = 0; k < A.ply; k++) { const mv = ch.move(uciToMove(h.moves[k])); last = { from: mv.from, to: mv.to }; }
    const cur = A.ply ? D.moves[A.ply - 1] : null, cls = cur && C.classOf(cur.cls);
    const bestNext = h.an.best[A.ply], hint = bestNext ? { from: bestNext.slice(0, 2), to: bestNext.slice(2, 4) } : null;
    const san = (k) => { const c = new Chess(); for (let j = 0; j < k; j++) c.move(uciToMove(h.moves[j])); const mv = c.move(uciToMove(h.moves[k])); return mv ? mv.san : h.moves[k]; };
    const sanBest = (k) => { if (!h.an.best[k]) return ""; const c = new Chess(); for (let j = 0; j < k; j++) c.move(uciToMove(h.moves[j])); const mv = c.move(uciToMove(h.an.best[k])); return mv ? mv.san : ""; };
    const me1 = h.color, opp = me1 === "w" ? "b" : "w";
    const e = ev[A.ply], wp = C.winPct(e);
    const row = (side, name, emoji) => `<tr><td>${emoji} ${esc(name)}</td><td><b>${D.acc[side]} %</b></td>${C.CLASSES.map((c) => `<td>${D.count[side][c.k]}</td>`).join("")}</tr>`;
    return `<div class="sc sc-game">
      <div class="sc-pzbar"><span>🔍 Analyse · gegen ${B.e} ${esc(B.name)}</span><b>${h.res === "win" ? "Sieg" : h.res === "draw" ? "Remis" : "Niederlage"}</b></div>
      <table class="sc-antab"><thead><tr><th></th><th>Genauigkeit</th>${C.CLASSES.map((c) => `<th title="${c.t}">${c.e}</th>`).join("")}</tr></thead><tbody>${row(me1, "Du", "🧑‍🔧")}${row(opp, B.name, B.e)}</tbody></table>
      ${evalGraph(ev, A.ply)}
      <div class="sc-anboard"><div class="sc-evalbar" aria-label="Bewertung ${C.fmtEval(e)}"><i style="height:${h.color === "b" ? wp : 100 - wp}%"></i><b>${C.fmtEval(e)}</b></div>${boardHTML(ch, { flip: h.color === "b", last, hint: A.ply < h.moves.length ? hint : null, check: kingSq(ch), lock: true })}</div>
      <div class="sc-anmove" style="--c:${cls ? cls.c : "#64748b"}">${cur ? `<b>${Math.floor((A.ply - 1) / 2) + 1}.${cur.side === "b" ? ".." : ""} ${esc(san(A.ply - 1))}</b> <span>${cls.e} ${cls.t}</span>${cur.cls !== "best" && sanBest(A.ply - 1) ? `<small>Besser war <b>${esc(sanBest(A.ply - 1))}</b></small>` : ""}` : `<b>Ausgangsstellung</b><small>Tippe ▶ oder einen Zug unten</small>`}${A.ply < h.moves.length && bestNext ? `<small>💡 Bester Zug jetzt (blau): <b>${esc(sanBest(A.ply))}</b></small>` : ""}</div>
      <div class="sc-ctl"><button type="button" class="btn" data-a="an" data-v="0">⏮</button><button type="button" class="btn" data-a="an" data-v="-1">◀</button><button type="button" class="btn primary" data-a="an" data-v="1">▶</button><button type="button" class="btn" data-a="an" data-v="end">⏭</button><button type="button" class="btn" data-a="home">🏠</button></div>
      <div class="sc-anlist">${D.moves.map((x, k) => `<button type="button" class="${A.ply === k + 1 ? "on" : ""}" data-a="an" data-v="p${k + 1}" style="--c:${C.classOf(x.cls).c}">${k % 2 === 0 ? `<em>${k / 2 + 1}.</em>` : ""}${esc(san(k))}${x.cls === "best" || x.cls === "good" ? "" : C.classOf(x.cls).e}</button>`).join("")}</div>
    </div>`;
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
      case "analyse": { const hi = b.dataset.i != null ? Number(b.dataset.i) : me().hist.length - 1; runAnalysis(hi); break; }
      case "an": { const A = S.an, n = me().hist[A.i].moves.length, v = b.dataset.v; A.ply = v === "0" ? 0 : v === "end" ? n : v.startsWith("p") ? Number(v.slice(1)) : Math.max(0, Math.min(n, A.ply + Number(v))); A.animFrom = Number(v) === 1; render(); break; }
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
      case "flip": { const c = S.pz || S.g; c.flip = !c.flip; render(); break; }
      case "undo": { const g = S.g; if (g.thinking) break; const n = g.ch.turn() === g.color ? 2 : 1; for (let k = 0; k < n && g.moves.length; k++) { g.ch.undo(); g.moves.pop(); } const l = g.ch.history({ verbose: true }).slice(-1)[0]; g.last = l ? { from: l.from, to: l.to } : null; g.sel = null; g.targets = []; g.undos++; persist(); render(); maybeBot(); break; }
      case "hint": { const g = S.g; b.disabled = true; const r = await engine(g.ch.fen(), { depth: 6, timeMs: 1200 }); if (S.g === g && r.move) { g.hint = { from: r.move.slice(0, 2), to: r.move.slice(2, 4) }; g.say = "💡 Schau dir die markierten Felder an."; render(); } break; }
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
