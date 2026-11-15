// ♟️ Schach-Coach: erklärt in der Partie-Analyse, WARUM ein Zug gut oder schlecht war (regelbasiert, offline).
// Eingabe: Züge (UCI), Bewertungen ev[k] (Sicht Weiß, nach k Halbzügen), beste Züge best[k], Analyse-Ergebnis (schach-core.analyse).
import { Chess } from "../../vendor/chess/chess.js";
import { MATE_CP, fmtEval } from "./schach-core.js";
import { search } from "../chess-engine.js";

export const PIECE = { p: "Bauer", n: "Springer", b: "Läufer", r: "Turm", q: "Dame", k: "König" };
const ART = { p: "den", n: "den", b: "den", r: "den", q: "die", k: "den" };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const uci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
const isMate = (cp) => Math.abs(cp) > MATE_CP - 1000;
const mateIn = (cp) => Math.ceil((MATE_CP - Math.abs(cp)) / 2);

/** Stellung nach k Halbzügen */
function posAt(moves, k, start) { const c = start ? new Chess(start) : new Chess(); for (let j = 0; j < k; j++) c.move(uci(moves[j])); return c; }
/** Wird die Figur auf sq vom Gegner angegriffen und ist sie schlecht verteidigt? (einfacher Austausch-Check) */
function hanging(ch, sq) {
  const p = ch.get(sq); if (!p) return false;
  const opp = p.color === "w" ? "b" : "w";
  const att = ch.attackers ? ch.attackers(sq, opp) : [];
  if (!att.length) return false;
  const def = ch.attackers ? ch.attackers(sq, p.color) : [];
  const cheapest = Math.min(...att.map((s) => VAL[ch.get(s).type] || 9));
  return !def.length || cheapest < VAL[p.type];
}

/** Kurze Hauptvariante: erster Zug + n weitere beste Züge (eigene Engine, flach & schnell) */
function pvLine(ch, first, n = 4) {
  const c = new Chess(ch.fen()), out = [];
  try { out.push(c.move(uci(first))); } catch { return out; }
  for (let i = 0; i < n && !c.isGameOver(); i++) {
    const r = search(c.fen(), { depth: 4, timeMs: 150 }); if (!r.best || r.best === "null") break;
    try { out.push(c.move(uci(r.best))); } catch { break; }
  }
  return out;
}
/** Gabel: greift die gezogene Figur danach ≥2 wertvolle Figuren (oder König + Figur) an? */
function forkAfter(line, i) {
  const c = new Chess(line[0].before); for (let j = 0; j <= i; j++) c.move(line[j].san);
  const m = line[i], vic = m.color === "w" ? "b" : "w", hit = [];
  for (const row of c.board()) for (const x of row) if (x && x.color === vic && (VAL[x.type] >= 3 || x.type === "k") && c.attackers(x.square, m.color).includes(m.to)) hit.push(x.type);
  return hit.filter((t) => t !== "k").length >= 2 || (hit.includes("k") && hit.length >= 2) ? hit.sort((a, b) => (VAL[b] || 99) - (VAL[a] || 99)) : null;
}
const sans = (l) => l.map((m) => m.san).join(" ");

/**
 * Erklärung für Halbzug k. who(side) → "Du" | Bot-Name. Liefert { lines: [Text…], tags: [kurz…] }.
 */
export function explain({ moves, ev, best, an, k, who, start }) {
  const lines = [], tags = []; let forker = null;
  const before = posAt(moves, k, start), side = before.turn(), sg = side === "w" ? 1 : -1;
  const played = before.move(uci(moves[k])); // before ist jetzt die Stellung danach
  const after = before;
  const mover = who(side), opp = who(side === "w" ? "b" : "w");
  const cls = an.moves[k].cls;
  const evB = sg * ev[k], evA = sg * ev[k + 1];
  const b0 = posAt(moves, k, start);
  const bm = best[k] ? b0.move(uci(best[k])) : null;
  const bestSan = bm ? bm.san : "";
  const isBest = best[k] && moves[k].slice(0, 4) === best[k].slice(0, 4);
  const reply = best[k + 1] ? (() => { const c = posAt(moves, k + 1, start); try { return c.move(uci(best[k + 1])); } catch { return null; } })() : null;

  if (after.isCheckmate()) { lines.push(`Schachmatt! ${mover === "Du" ? "Stark gespielt 🎉" : "Da war nichts mehr zu machen."}`); return { lines, tags: ["Matt"] }; }

  // 1) Matt verpasst / Matt zugelassen
  if (isMate(evB) && evB > 0 && !isBest && !(isMate(evA) && evA > 0)) lines.push(`Hier war **Matt in ${mateIn(evB)}** möglich – mit **${bestSan}**!`), tags.push("Matt verpasst");
  else if (isMate(evA) && evA < 0 && !(isMate(evB) && evB < 0)) lines.push(`Dieser Zug erlaubt ${opp === "Du" ? "dir" : opp} ein **Matt in ${mateIn(evA)}**${reply ? ` (beginnt mit ${reply.san})` : ""}.`), tags.push("Matt zugelassen");

  // 2) Figur eingestellt: beste Antwort schlägt etwas und die Bewertung kippt
  const drop = evB - evA;
  if (!lines.length && reply && reply.captured && drop >= 150 && cls !== "best" && cls !== "good") {
    const sq = reply.to, pc = PIECE[reply.captured];
    if (reply.to === played.to && played.captured && VAL[played.captured] < VAL[played.piece]) {
      lines.push(`Figurenopfer: ${mover === "Du" ? "du gibst" : `${mover} gibt`} den ${PIECE[played.piece]} für ${ART[played.captured]} ${PIECE[played.captured]} – nach **${reply.san}** fehlt die Fortsetzung, das Opfer lohnt sich hier nicht.`);
      tags.push("Opfer geht nicht auf");
    } else {
      // Wirklich hängend nur, wenn danach nicht zurückgeschlagen wird – sonst die ganze Abfolge erklären
      const ln = pvLine(after, best[k + 1], 4), back = ln[1] && ln[1].to === sq && ln[1].captured;
      const fi = back ? ln.findIndex((m, i) => i >= 2 && i % 2 === 0 && forkAfter(ln, i)) : -1;
      if (!back) {
        // Gibt es ein Zurückschlagen, das nur scheinbar geht? (z. B. danach Gabel)
        const c1 = new Chess(after.fen()); c1.move(reply.san);
        const rc = c1.moves({ verbose: true }).filter((m) => m.to === sq && m.captured).sort((a, b) => VAL[a.piece] - VAL[b.piece])[0];
        const l2 = rc ? pvLine(c1, rc.from + rc.to + (rc.promotion || ""), 1) : [], f2 = l2.length > 1 ? forkAfter(l2, 1) : null;
        lines.push(`**${reply.san}** gewinnt ${mover === "Du" ? "deinen" : `${mover}s`} ${pc} auf **${sq}**${rc ? "" : " – er ist nicht gedeckt"}.`);
        if (rc && f2) forker = l2[1].from;
        if (rc && f2) lines.push(`Zurückschlagen mit **${rc.san}** geht nicht: danach greift **${l2[1].san}** ${f2.slice(0, 2).map((t) => `${ART[t]} ${PIECE[t]}`).join(" und ")} gleichzeitig an (**Gabel**).`), tags.push("Gabel");
        else if (rc) lines.push(`Zurückschlagen mit **${rc.san}** hilft nicht – danach verliert ${mover === "Du" ? "du" : mover} noch mehr.`);
        tags.push(`${pc} verloren`);
      }
      else if (fi >= 0) { const f = forkAfter(ln, fi), m = ln[fi]; lines.push(`Nach **${sans(ln.slice(0, fi + 1))}** greift ${ART[m.piece]} ${PIECE[m.piece]} auf ${m.to} ${f.slice(0, 2).map((t) => `${ART[t]} ${PIECE[t]}`).join(" und ")} gleichzeitig an – eine **Gabel**, ${mover === "Du" ? "du verlierst" : `${mover} verliert`} Material.`); tags.push("Gabel"); }
      else { lines.push(`${PIECE[reply.captured]} gegen ${PIECE[ln[1].captured]} getauscht – aber nach **${sans(ln)}** steht ${opp === "Du" ? "du" : opp} klar besser.`); tags.push("schlechter Tausch"); }
    }
  }
  // 2b) Drohung ohne Schlagen (z. B. Gabel im nächsten Zug)
  if (!lines.length && reply && !reply.captured && drop >= 150 && cls !== "best" && cls !== "good") {
    const ln = pvLine(after, best[k + 1], 2), f = forkAfter(ln, 0);
    if (f) { lines.push(`Das erlaubt **${reply.san}** – ${ART[reply.piece]} ${PIECE[reply.piece]} greift ${f.slice(0, 2).map((t) => `${ART[t]} ${PIECE[t]}`).join(" und ")} gleichzeitig an (**Gabel**).`); tags.push("Gabel"); }
  }
  // 3) Material verpasst: bester Zug hätte geschlagen
  if (!isBest && bm && bm.captured && !played.captured && (cls === "inacc" || cls === "mist" || cls === "blund"))
    lines.push(`Mit **${bestSan}** hätte${mover === "Du" ? "st du" : ""} ${ART[bm.captured]} ${PIECE[bm.captured]} auf ${bm.to} schlagen können${forker === bm.to ? " – dann hätte es diese Gabel gar nicht gegeben" : ""}.`), tags.push("Material verpasst");
  // 4) eigene Figur nach dem Zug ungedeckt (ohne dass die Antwort sie sofort nimmt)
  if (!lines.length && cls !== "best" && hanging(after, played.to) && VAL[played.piece] >= 3)
    lines.push(`Der ${PIECE[played.piece]} auf ${played.to} steht jetzt ungeschützt im Angriff.`), tags.push("ungeschützt");

  // 5) Positive Gründe
  const pos = [], bad = !["best", "good", "great", "exc"].includes(cls);
  if (played.flags.includes("k") || played.flags.includes("q")) pos.push(bad ? "Die Rochade an sich ist gut – aber hier gab es etwas Dringenderes zu tun." : "Rochade bringt den König in Sicherheit und aktiviert den Turm.");
  if (played.captured) pos.push(`Schlägt ${ART[played.captured]} ${PIECE[played.captured]} auf ${played.to}.`);
  if (played.promotion) pos.push(`Bauer wird zur ${PIECE[played.promotion]}!`);
  if (after.inCheck()) pos.push("Gibt Schach – der Gegner muss reagieren.");
  if (!bad && k < 16 && (played.piece === "n" || played.piece === "b") && /[18]$/.test(played.from)) pos.push("Entwickelt eine Leichtfigur – genau richtig in der Eröffnung.");
  if (!bad && k < 10 && played.piece === "p" && /^[de][45]$/.test(played.to)) pos.push("Besetzt das Zentrum.");
  if (k < 14 && played.piece === "q" && !played.captured && !after.inCheck()) pos.push("Die Dame so früh zu ziehen ist oft riskant – sie kann gejagt werden.");
  if (k < 20 && played.piece === "k" && !played.flags.includes("k") && !played.flags.includes("q") && !played.captured && !posAt(moves, k, start).inCheck()) pos.push("Ein Königszug ohne Rochade kostet das Rochaderecht.");
  if (played.piece === "p" && /^[a-h]$/.test(played.from[0]) && k < 14 && /^[fgh]/.test(played.from) && /[g][34]|[h][34]|[f][34]|[f][65]|[g][65]|[h][65]/.test(played.to) && !played.captured) pos.push("Bauernzüge vor dem eigenen König können ihn schwächen.");

  if (cls === "best" || cls === "good") {
    lines.push(cls === "best" ? (isBest ? "Das ist der stärkste Zug in dieser Stellung." : "Praktisch genauso gut wie der beste Zug.") : `Solider Zug${!isBest && bestSan ? ` – ${bestSan} war nur minimal besser` : ""}.`);
  } else if (!lines.length) {
    lines.push(`${cls === "inacc" ? "Etwas ungenau" : cls === "mist" ? "Ein Fehler" : "Ein schwerer Fehler"}: **${bestSan || "ein anderer Zug"}** war deutlich stärker.`);
  }
  lines.push(...pos.slice(0, 2));
  // 6) Bewertung vorher → nachher
  lines.push(`Bewertung: ${fmtEval(ev[k])} → ${fmtEval(ev[k + 1])}${reply && cls !== "best" ? ` · ${opp === "Du" ? "Deine" : "Beste"} Antwort: ${reply.san}` : ""}`);
  return { lines, tags };
}

/** Kurze Zusammenfassung der Partie (Schlüsselmomente) */
export function summary({ moves, ev, an, who }) {
  const out = [];
  const big = an.moves.filter((m) => m.cls === "blund" || m.cls === "mist").sort((a, b) => b.loss - a.loss).slice(0, 3);
  for (const m of big) out.push({ ply: m.ply, text: `${Math.floor(m.ply / 2) + 1}.${m.side === "b" ? ".." : ""} ${who(m.side)}: ${m.cls === "blund" ? "Patzer" : "Fehler"} (−${Math.round(m.loss)} % Gewinnchance)` });
  let swing = 0; for (let i = 1; i < ev.length; i++) if (Math.sign(ev[i]) !== Math.sign(ev[i - 1]) && Math.abs(ev[i] - ev[i - 1]) > 150) swing++;
  return { key: out, swings: swing };
}
