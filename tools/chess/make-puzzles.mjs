// Erzeugt Taktikaufgaben für ♟️ Schach (js/alltag/schach-puzzles.js) mit der eigenen Engine – offline, reproduzierbar.
// Vorgehen: Partien zwischen fehleranfälligen Bots; nach jedem Zug prüfen, ob die Gegenseite jetzt EINEN klar
// gewinnenden Zug hat (Matt oder ≥ 2,5 Bauern Gewinn, zweitbester Zug deutlich schlechter). Lösung = bis zu 3 Züge
// (eigener Zug, beste Antwort, eigener Zug – nur wenn auch der wieder eindeutig ist). Schwierigkeit aus der Suchtiefe.
//   node tools/chess/make-puzzles.mjs 420 > js/alltag/schach-puzzles.js
import { Pos, search, MATE_SCORE } from "../../js/chess-engine.js";
const WANT = Number(process.argv[2]) || 300;
let s = Number(process.argv[3]) || 12345; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const isMate = (v) => Math.abs(v) > MATE_SCORE - 100;
const out = [], seen = new Set();
function unique(fen, deep = 5) {
  const r = search(fen, { depth: deep, timeMs: 900, noise: 1e-9, rnd: () => 0.5 }); // volles Fenster → echte Werte aller Züge
  if (!r.list || r.list.length < 2) return r.list && r.list.length === 1 ? null : null;
  const [b, v] = r.list[0], v2 = r.list[1][1];
  if (v <= 0) return null;
  if (isMate(v)) { if (isMate(v2) && v2 > 0) return null; return { move: b, v, mate: MATE_SCORE - v }; }
  if (v < 250 || v - v2 < 220) return null;
  return { move: b, v };
}
function difficulty(fen, best) { for (let d = 1; d <= 6; d++) { const r = search(fen, { depth: d, timeMs: 300 }); if (r.best === best && (r.bestScore >= 200 || isMate(r.bestScore))) return d; } return 7; }
let games = 0;
while (out.length < WANT && games < 4000) {
  games++;
  const pos = new Pos();
  const noise = [60, 90, 130, 180][Math.floor(rnd() * 4)];
  for (let ply = 0; ply < 120; ply++) {
    const fen = pos.fen();
    const r = search(fen, { depth: 2, timeMs: 200, noise: ply < 8 ? 120 : noise, rnd });
    const evalBefore = r.bestScore; // Sicht der Seite, die jetzt zieht (= späterer „Verlierer“)
    if (!r.move) break;
    const before = fen;
    pos.play(r.move);
    if (ply < 6) continue;
    const after = pos.fen(), key = after.split(" ").slice(0, 2).join(" ");
    if (seen.has(key)) continue;
    const quick = search(after, { depth: 3, timeMs: 150 }); // Vorfilter: nur wenn es schnell nach Gewinn aussieht
    if (!quick.move || quick.bestScore < 250) continue; // nur wenn die Seite am Zug klar gewinnt (Matt zählt nur positiv)
    if (evalBefore < -150) continue; // war schon vorher klar verloren → kein echter Wendepunkt
    const u = unique(after);
    if (!u) continue;
    seen.add(key);
    // Lösung verlängern: Antwort + nächster eindeutiger Zug
    const sol = [u.move], p2 = new Pos(after); p2.play(u.move);
    if (!(u.mate === 1)) {
      const rep = search(p2.fen(), { depth: 5, timeMs: 800 });
      if (rep.move) {
        p2.play(rep.move);
        const u2 = unique(p2.fen(), 5);
        if (u2) { sol.push(rep.move, u2.move); }
      }
    }
    const d = difficulty(after, u.move);
    const mateN = u.mate ? Math.ceil(u.mate / 2) : 0; // u.mate = Halbzüge bis Matt
    const theme = mateN ? `Matt in ${mateN}` : u.v >= 800 ? "Dame gewinnen" : u.v >= 450 ? "Figur gewinnen" : "Material gewinnen";
    const rating = Math.round(Math.min(2200, 500 + d * 220 + (sol.length > 1 ? 150 : 0) + (mateN > 1 ? 200 : 0) + rnd() * 120));
    out.push({ id: out.length + 1, fen: before, first: r.move, sol, r: rating, t: theme });
    if (out.length % 20 === 0) process.stderr.write(`${out.length} Aufgaben aus ${games} Partien\n`);
    break; // pro Partie höchstens eine Aufgabe (mehr Vielfalt)
  }
}
out.sort((a, b) => a.r - b.r).forEach((p, i) => { p.id = i + 1; });
process.stdout.write(`// ♟️ Taktikaufgaben – automatisch erzeugt mit tools/chess/make-puzzles.mjs (eigene Engine, eindeutige Lösungen geprüft).\n// fen = Stellung VOR dem Zug des Gegners (first), danach bist du am Zug: sol = [dein Zug, Antwort, dein Zug …] (UCI).\nexport const PUZZLES = ${JSON.stringify(out)};\n`);
