// ♟️ Schach-Engine (eigene, ohne Bibliothek): 0x88-Brett, Zuggenerator, Alpha-Beta mit Ruhesuche, Zugsortierung,
// Transpositionstabelle, Wiederholungserkennung. Läuft im Browser (Worker) und in node (Tests, Rätsel-Erzeugung).
// Bewertung: Material + Feldtabellen (Mittel-/Endspiel überblendet). Stärke der Bots über Tiefe, Zeit und Zufall.
// Regeln/SAN in der App macht chess.js (vendor/chess) – diese Engine liefert nur den Zug (from/to/promo, z. B. "e7e8q").

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const VAL = [0, 100, 320, 330, 500, 900, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const N_OFF = [-33, -31, -18, -14, 14, 18, 31, 33], K_OFF = [-17, -16, -15, -1, 1, 15, 16, 17];
const B_OFF = [-17, -15, 15, 17], R_OFF = [-16, -1, 1, 16];
const FILES = "abcdefgh";

// Feldtabellen aus Sicht von Weiß, Index 0 = a8 … 63 = h1 (vereinfachte, bewährte Werte)
const PST_MG = {
  [P]: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  [N]: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  [B]: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  [R]: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  [Q]: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  [K]: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
};
const PST_EG = { ...PST_MG,
  [P]: [0,0,0,0,0,0,0,0, 80,80,80,80,80,80,80,80, 50,50,50,50,50,50,50,50, 30,30,30,30,30,30,30,30, 20,20,20,20,20,20,20,20, 10,10,10,10,10,10,10,10, 10,10,10,10,10,10,10,10, 0,0,0,0,0,0,0,0],
  [K]: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
};
const idx64 = (sq, white) => { const f = sq & 7, r = sq >> 4; return white ? (7 - r) * 8 + f : r * 8 + f; }; // r: 0 = Reihe 1

// Zobrist (32 Bit reicht für Wiederholung/TT mit Prüfung)
let seed = 0x9e3779b9;
const rnd32 = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
const ZP = Array.from({ length: 13 }, () => Array.from({ length: 128 }, rnd32));
const ZSIDE = rnd32(), ZCAST = Array.from({ length: 16 }, rnd32), ZEP = Array.from({ length: 128 }, rnd32);
const zi = (pc) => pc + 6;

export class Pos {
  constructor(fen) { this.load(fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); }
  load(fen) {
    const [board, side, cast, ep, half] = fen.trim().split(/\s+/);
    this.b = new Int8Array(128); let r = 7, f = 0;
    for (const ch of board) {
      if (ch === "/") { r--; f = 0; continue; }
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const t = "pnbrqk".indexOf(ch.toLowerCase()) + 1;
      this.b[r * 16 + f] = ch === ch.toUpperCase() ? t : -t; f++;
    }
    this.w = side !== "b";
    this.c = (cast.includes("K") ? 1 : 0) | (cast.includes("Q") ? 2 : 0) | (cast.includes("k") ? 4 : 0) | (cast.includes("q") ? 8 : 0);
    this.ep = ep && ep !== "-" ? (Number(ep[1]) - 1) * 16 + FILES.indexOf(ep[0]) : -1;
    this.half = Number(half) || 0;
    this.stack = []; this.hist = [];
    this.kings = [0, 0];
    for (let s = 0; s < 128; s++) { if (s & 0x88) continue; if (this.b[s] === K) this.kings[0] = s; if (this.b[s] === -K) this.kings[1] = s; }
    this.hash = this.computeHash();
  }
  computeHash() {
    let h = 0;
    for (let s = 0; s < 128; s++) if (!(s & 0x88) && this.b[s]) h ^= ZP[zi(this.b[s])][s];
    if (!this.w) h ^= ZSIDE; h ^= ZCAST[this.c]; if (this.ep >= 0) h ^= ZEP[this.ep];
    return h >>> 0;
  }
  attacked(sq, byWhite) {
    const b = this.b, s = byWhite ? 1 : -1;
    const pr = byWhite ? [sq - 15, sq - 17] : [sq + 15, sq + 17];
    for (const x of pr) if (!(x & 0x88) && b[x] === s * P) return true;
    for (const o of N_OFF) { const x = sq + o; if (!(x & 0x88) && b[x] === s * N) return true; }
    for (const o of K_OFF) { const x = sq + o; if (!(x & 0x88) && b[x] === s * K) return true; }
    for (const o of B_OFF) { let x = sq + o; while (!(x & 0x88)) { const p = b[x]; if (p) { if (p === s * B || p === s * Q) return true; break; } x += o; } }
    for (const o of R_OFF) { let x = sq + o; while (!(x & 0x88)) { const p = b[x]; if (p) { if (p === s * R || p === s * Q) return true; break; } x += o; } }
    return false;
  }
  inCheck(white = this.w) { return this.attacked(this.kings[white ? 0 : 1], !white); }
  /** Pseudo-legale Züge: Zahl = from | to<<7 | promo<<14 | flag<<17 (flag: 1 Doppelschritt, 2 e. p., 3 Rochade) */
  gen(capsOnly = false) {
    const b = this.b, w = this.w, s = w ? 1 : -1, out = [];
    const add = (f, t, pr = 0, fl = 0) => out.push(f | (t << 7) | (pr << 14) | (fl << 17));
    for (let f = 0; f < 128; f++) {
      if (f & 0x88) { f += 7; continue; }
      const pc = b[f]; if (!pc || (pc > 0) !== w) continue;
      const t = pc * s;
      if (t === P) {
        const dir = w ? 16 : -16, start = w ? 1 : 6, last = w ? 7 : 0, one = f + dir;
        const promo = (to) => { for (const pr of [Q, N, R, B]) add(f, to, pr); };
        if (!capsOnly && !(one & 0x88) && !b[one]) {
          if ((one >> 4) === last) promo(one); else { add(f, one); const two = one + dir; if ((f >> 4) === start && !b[two]) add(f, two, 0, 1); }
        } else if (capsOnly && !(one & 0x88) && !b[one] && (one >> 4) === last) add(f, one, Q);
        for (const c of [dir - 1, dir + 1]) {
          const to = f + c; if (to & 0x88) continue;
          if (b[to] && (b[to] > 0) !== w) { if ((to >> 4) === last) promo(to); else add(f, to); }
          else if (to === this.ep) add(f, to, 0, 2);
        }
      } else if (t === N || t === K) {
        for (const o of t === N ? N_OFF : K_OFF) { const to = f + o; if (to & 0x88) continue; const q = b[to]; if (q && (q > 0) === w) continue; if (capsOnly && !q) continue; add(f, to); }
        if (t === K && !capsOnly) {
          const r0 = w ? 0 : 112, kc = w ? 1 : 4, qc = w ? 2 : 8;
          if (f === r0 + 4 && (this.c & kc) && !b[r0 + 5] && !b[r0 + 6] && b[r0 + 7] === s * R && !this.attacked(r0 + 4, !w) && !this.attacked(r0 + 5, !w) && !this.attacked(r0 + 6, !w)) add(f, r0 + 6, 0, 3);
          if (f === r0 + 4 && (this.c & qc) && !b[r0 + 3] && !b[r0 + 2] && !b[r0 + 1] && b[r0] === s * R && !this.attacked(r0 + 4, !w) && !this.attacked(r0 + 3, !w) && !this.attacked(r0 + 2, !w)) add(f, r0 + 2, 0, 3);
        }
      } else {
        const offs = t === B ? B_OFF : t === R ? R_OFF : K_OFF;
        for (const o of offs) { let to = f + o; while (!(to & 0x88)) { const q = b[to]; if (q) { if ((q > 0) !== w) add(f, to); break; } if (!capsOnly) add(f, to); to += o; } }
      }
    }
    return out;
  }
  make(m) {
    const b = this.b, f = m & 127, t = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17, w = this.w, s = w ? 1 : -1;
    const pc = b[f], cap = fl === 2 ? -s * P : b[t];
    this.stack.push([m, cap, this.c, this.ep, this.half, this.hash]);
    this.hist.push(this.hash);
    let h = this.hash ^ ZCAST[this.c] ^ (this.ep >= 0 ? ZEP[this.ep] : 0);
    h ^= ZP[zi(pc)][f];
    if (cap) { const cs = fl === 2 ? t - 16 * s : t; h ^= ZP[zi(cap)][cs]; b[cs] = 0; }
    const np = pr ? s * pr : pc; b[t] = np; b[f] = 0; h ^= ZP[zi(np)][t];
    if (fl === 3) { const r0 = w ? 0 : 112, ks = t === r0 + 6; const rf = ks ? r0 + 7 : r0, rt = ks ? r0 + 5 : r0 + 3; b[rt] = b[rf]; b[rf] = 0; h ^= ZP[zi(s * R)][rf] ^ ZP[zi(s * R)][rt]; }
    if (pc * s === K) this.kings[w ? 0 : 1] = t;
    const lose = (sq) => (sq === 0 ? 2 : sq === 7 ? 1 : sq === 112 ? 8 : sq === 119 ? 4 : sq === 4 ? 3 : sq === 116 ? 12 : 0);
    this.c &= ~(lose(f) | lose(t));
    this.ep = fl === 1 ? (f + t) >> 1 : -1;
    this.half = pc * s === P || cap ? 0 : this.half + 1;
    this.w = !w;
    h ^= ZSIDE ^ ZCAST[this.c] ^ (this.ep >= 0 ? ZEP[this.ep] : 0);
    this.hash = h >>> 0;
    if (this.inCheck(w)) { this.unmake(); return false; }
    return true;
  }
  unmake() {
    const [m, cap, c, ep, half, hash] = this.stack.pop(); this.hist.pop();
    const b = this.b, f = m & 127, t = (m >> 7) & 127, pr = (m >> 14) & 7, fl = m >> 17;
    this.w = !this.w; const w = this.w, s = w ? 1 : -1;
    const pc = pr ? s * P : b[t];
    b[f] = pc; b[t] = 0;
    if (cap) b[fl === 2 ? t - 16 * s : t] = cap;
    if (fl === 3) { const r0 = w ? 0 : 112, ks = t === r0 + 6; const rf = ks ? r0 + 7 : r0, rt = ks ? r0 + 5 : r0 + 3; b[rf] = b[rt]; b[rt] = 0; }
    if (pc * s === K) this.kings[w ? 0 : 1] = f;
    this.c = c; this.ep = ep; this.half = half; this.hash = hash;
  }
  fen() {
    let out = "";
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) { const pc = this.b[r * 16 + f]; if (!pc) { e++; continue; } if (e) { out += e; e = 0; } const ch = "pnbrqk"[Math.abs(pc) - 1]; out += pc > 0 ? ch.toUpperCase() : ch; }
      if (e) out += e; if (r) out += "/";
    }
    const c = (this.c & 1 ? "K" : "") + (this.c & 2 ? "Q" : "") + (this.c & 4 ? "k" : "") + (this.c & 8 ? "q" : "") || "-";
    const ep = this.ep >= 0 ? FILES[this.ep & 7] + ((this.ep >> 4) + 1) : "-";
    return `${out} ${this.w ? "w" : "b"} ${c} ${ep} ${this.half} 1`;
  }
  /** Zug aus UCI ("e2e4", "e7e8q") ausführen; false wenn illegal. */
  play(uci) { const m = this.legal().find((x) => toUci(x) === uci); return m ? this.make(m) : false; }
  legal() { const out = []; for (const m of this.gen()) if (this.make(m)) { this.unmake(); out.push(m); } return out; }
  repeated() { let n = 0; for (let i = this.hist.length - 2; i >= 0 && i >= this.hist.length - this.half - 1; i -= 2) if (this.hist[i] === this.hash && ++n >= 1) return true; return false; }
  evaluate() {
    let mg = 0, eg = 0, ph = 0;
    const b = this.b;
    let wb = 0, bb = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const pc = b[s]; if (!pc) continue;
      const t = Math.abs(pc), white = pc > 0, i = idx64(s, white), sg = white ? 1 : -1;
      mg += sg * (VAL[t] + PST_MG[t][i]); eg += sg * (VAL[t] + PST_EG[t][i]); ph += PHASE[t];
      if (t === B) { if (white) wb++; else bb++; }
    }
    if (wb >= 2) { mg += 30; eg += 50; } if (bb >= 2) { mg -= 30; eg -= 50; }
    ph = Math.min(24, ph);
    const v = (mg * ph + eg * (24 - ph)) / 24;
    return (this.w ? v : -v) | 0;
  }
}

export const toUci = (m) => { const f = m & 127, t = (m >> 7) & 127, pr = (m >> 14) & 7; const sq = (x) => FILES[x & 7] + ((x >> 4) + 1); return sq(f) + sq(t) + (pr ? " pnbrqk"[pr] : ""); };
const MATE = 30000;

/** Suche. opts: { depth, timeMs, noise (cp), rnd } → { move (uci), score (cp aus Sicht der Seite am Zug), depth, nodes, pv } */
export function search(fen, { depth = 4, timeMs = 1500, noise = 0, rnd = Math.random, history = [] } = {}) {
  const pos = new Pos(fen);
  pos.hist = history.slice(); // Hashes der Partie (für Wiederholung) – optional
  const t0 = Date.now(); let nodes = 0, stop = false;
  const TT = new Map();
  const killers = [];
  const hist = new Int32Array(128 * 128);
  const root = pos.legal();
  if (!root.length) return { move: null, score: pos.inCheck() ? -MATE : 0, depth: 0, nodes: 0 };
  const scoreMove = (m, ttm, ply) => {
    if (m === ttm) return 1e7;
    const t = (m >> 7) & 127, cap = pos.b[t], pr = (m >> 14) & 7;
    if (cap) return 1e6 + VAL[Math.abs(cap)] * 10 - VAL[Math.abs(pos.b[m & 127])] / 10;
    if (pr) return 9e5 + VAL[pr];
    if (killers[ply] && (killers[ply][0] === m || killers[ply][1] === m)) return 8e5;
    return hist[(m & 127) * 128 + t];
  };
  function qs(alpha, beta, ply) {
    nodes++;
    const stand = pos.evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 30) return stand;
    const ms = pos.gen(true).sort((a, b) => scoreMove(b, 0, ply) - scoreMove(a, 0, ply));
    for (const m of ms) {
      if (!pos.make(m)) continue;
      const v = -qs(-beta, -alpha, ply + 1);
      pos.unmake();
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  function ab(d, alpha, beta, ply) {
    if ((nodes & 2047) === 0 && Date.now() - t0 > timeMs) stop = true;
    if (stop) return 0;
    if (ply && (pos.half >= 100 || pos.repeated())) return 0;
    const check = pos.inCheck();
    if (check) d++;
    if (d <= 0) return qs(alpha, beta, ply);
    nodes++;
    const key = pos.hash, tt = TT.get(key);
    if (tt && tt.d >= d && ply) {
      if (tt.f === 0) return tt.v;
      if (tt.f === 1 && tt.v >= beta) return tt.v;
      if (tt.f === 2 && tt.v <= alpha) return tt.v;
    }
    const ttm = tt ? tt.m : 0;
    const ms = pos.gen().map((m) => [m, scoreMove(m, ttm, ply)]).sort((a, b) => b[1] - a[1]);
    let best = -MATE - 1, bm = 0, legal = 0, a0 = alpha;
    for (const [m] of ms) {
      if (!pos.make(m)) continue;
      legal++;
      let v;
      if (legal > 4 && d >= 3 && !check && !pos.b[(m >> 7) & 127] && !((m >> 14) & 7) && !pos.inCheck()) {
        v = -ab(d - 2, -alpha - 1, -alpha, ply + 1); // späte, ruhige Züge flacher prüfen
        if (v > alpha) v = -ab(d - 1, -beta, -alpha, ply + 1);
      } else v = -ab(d - 1, -beta, -alpha, ply + 1);
      pos.unmake();
      if (stop) return 0;
      if (v > best) { best = v; bm = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!pos.b[(m >> 7) & 127]) { killers[ply] = [m, (killers[ply] || [])[0]]; hist[(m & 127) * 128 + ((m >> 7) & 127)] += d * d; }
        break;
      }
    }
    if (!legal) return check ? -MATE + ply : 0;
    TT.set(key, { d, v: best, m: bm, f: best <= a0 ? 2 : best >= beta ? 1 : 0 });
    if (TT.size > 400000) TT.clear();
    return best;
  }
  let bestMove = root[0], bestScore = 0, done = 0, scores = [];
  for (let d = 1; d <= depth; d++) {
    const res = [];
    let alpha = -MATE - 1;
    const order = root.slice().sort((a, b) => (a === bestMove ? -1 : b === bestMove ? 1 : 0));
    for (const m of order) {
      pos.make(m);
      const lo = noise ? -MATE - 1 : alpha; // mit Zufall echte Werte aller Züge (volles Fenster)
      const v = -ab(d - 1, -MATE - 1, -lo, 1);
      pos.unmake();
      if (stop) break;
      res.push([m, v]);
      if (v > alpha) alpha = v;
    }
    if (stop && res.length < order.length) { if (res.length && res[0][0] === bestMove) { /* behalte */ } break; }
    res.sort((a, b) => b[1] - a[1]);
    bestMove = res[0][0]; bestScore = res[0][1]; done = d; scores = res;
    if (Math.abs(bestScore) > MATE - 100) break;
    if (Date.now() - t0 > timeMs * 0.55) break;
  }
  // Schwächere Bots: Zufall auf die Wertung (nie absichtlich ein Matt übersehen, wenn es sicher ist)
  let pick = bestMove, pickScore = bestScore;
  if (noise > 0 && scores.length > 1 && bestScore < MATE - 100) {
    let top = -Infinity;
    for (const [m, v] of scores) { const nv = v + (rnd() * 2 - 1) * noise; if (nv > top) { top = nv; pick = m; pickScore = v; } }
  }
  return { move: toUci(pick), score: pickScore, best: toUci(bestMove), bestScore, depth: done, nodes, list: scores.map(([m, v]) => [toUci(m), v]) };
}
export const MATE_SCORE = MATE;
/** Perft (nur für Tests der Zugerzeugung). */
export function perft(fen, d) {
  const pos = new Pos(fen);
  const go = (n) => { if (!n) return 1; let c = 0; for (const m of pos.gen()) if (pos.make(m)) { c += go(n - 1); pos.unmake(); } return c; };
  return go(d);
}
