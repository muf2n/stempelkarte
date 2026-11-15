// ♟️ Schach-Coach: erklärt in der Partie-Analyse, WARUM ein Zug gut oder schlecht war (regelbasiert, offline).
// Eingabe: Züge (UCI), Bewertungen ev[k] (Sicht Weiß, nach k Halbzügen), beste Züge best[k], Analyse-Ergebnis (schach-core.analyse).
import { Chess } from "../../vendor/chess/chess.js";
import { MATE_CP, fmtEval } from "./schach-core.js";

export const PIECE = { p: "Bauer", n: "Springer", b: "Läufer", r: "Turm", q: "Dame", k: "König" };
const ART = { p: "den", n: "den", b: "den", r: "den", q: "die", k: "den" };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const uci = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
const isMate = (cp) => Math.abs(cp) > MATE_CP - 1000;
const mateIn = (cp) => Math.ceil((MATE_CP - Math.abs(cp)) / 2);

/** Stellung nach k Halbzügen */
function posAt(moves, k) { const c = new Chess(); for (let j = 0; j < k; j++) c.move(uci(moves[j])); return c; }
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

/**
 * Erklärung für Halbzug k. who(side) → "Du" | Bot-Name. Liefert { lines: [Text…], tags: [kurz…] }.
 */
export function explain({ moves, ev, best, an, k, who }) {
  const lines = [], tags = [];
  const before = posAt(moves, k), side = before.turn(), sg = side === "w" ? 1 : -1;
  const played = before.move(uci(moves[k])); // before ist jetzt die Stellung danach
  const after = before;
  const mover = who(side), opp = who(side === "w" ? "b" : "w");
  const cls = an.moves[k].cls;
  const evB = sg * ev[k], evA = sg * ev[k + 1];
  const b0 = posAt(moves, k);
  const bm = best[k] ? b0.move(uci(best[k])) : null;
  const bestSan = bm ? bm.san : "";
  const isBest = best[k] && moves[k].slice(0, 4) === best[k].slice(0, 4);
  const reply = best[k + 1] ? (() => { const c = posAt(moves, k + 1); try { return c.move(uci(best[k + 1])); } catch { return null; } })() : null;

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
      lines.push(`${mover === "Du" ? "Dein" : `${mover}s`} ${pc} auf **${sq}** ist danach nicht genug geschützt – **${reply.san}** gewinnt ihn.`);
      tags.push(`${pc} hängt`);
    }
  }
  // 3) Material verpasst: bester Zug hätte geschlagen
  if (!isBest && bm && bm.captured && !played.captured && (cls === "inacc" || cls === "mist" || cls === "blund"))
    lines.push(`Mit **${bestSan}** hätte${mover === "Du" ? "st du" : ""} ${ART[bm.captured]} ${PIECE[bm.captured]} auf ${bm.to} schlagen können.`), tags.push("Material verpasst");
  // 4) eigene Figur nach dem Zug ungedeckt (ohne dass die Antwort sie sofort nimmt)
  if (!lines.length && cls !== "best" && hanging(after, played.to) && VAL[played.piece] >= 3)
    lines.push(`Der ${PIECE[played.piece]} auf ${played.to} steht jetzt ungeschützt im Angriff.`), tags.push("ungeschützt");

  // 5) Positive Gründe
  const pos = [];
  if (played.flags.includes("k") || played.flags.includes("q")) pos.push("Rochade bringt den König in Sicherheit und aktiviert den Turm.");
  if (played.captured) pos.push(`Schlägt ${ART[played.captured]} ${PIECE[played.captured]} auf ${played.to}.`);
  if (played.promotion) pos.push(`Bauer wird zur ${PIECE[played.promotion]}!`);
  if (after.inCheck()) pos.push("Gibt Schach – der Gegner muss reagieren.");
  if (k < 16 && (played.piece === "n" || played.piece === "b") && /[18]$/.test(played.from)) pos.push("Entwickelt eine Leichtfigur – genau richtig in der Eröffnung.");
  if (k < 10 && played.piece === "p" && /^[de][45]$/.test(played.to)) pos.push("Besetzt das Zentrum.");
  if (k < 14 && played.piece === "q" && !played.captured && !after.inCheck()) pos.push("Die Dame so früh zu ziehen ist oft riskant – sie kann gejagt werden.");
  if (k < 20 && played.piece === "k" && !played.flags.includes("k") && !played.flags.includes("q") && !played.captured && !posAt(moves, k).inCheck()) pos.push("Ein Königszug ohne Rochade kostet das Rochaderecht.");
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
