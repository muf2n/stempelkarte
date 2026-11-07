// Update 10 – 🎓 LAP Elektrotechnik › 🛤️ Lernpfad: Adapter für die gemeinsame Lernpfad-Oberfläche (./path-ui.js).
// Einheiten je gewähltem Lehrjahr → Thema → Lektionen zu ~8 Karten, dazwischen Rechen-Lektionen aus dem Aufgaben-Generator.
// Paare zum Zuordnen: Lexikon-Begriffe (Elektro-Tools) bzw. Formelname ↔ Formel – nur vorhandene Inhalte.
import { createPath } from "./path-ui.js";
import * as P from "./path-core.js";
import { CARDS, TOPICS, FORMULAS } from "./lap-data.js";
import { PROBLEM_TYPES, makeProblem, checkAnswer, fmt, fmtAuto, filterYear } from "./lap-core.js";
import { createCalc } from "./lap-calc.js";
import { LEXIKON } from "./elektro-data.js";

/** Lexikon-Kategorie → LAP-Thema */
const LEX_TOPIC = { grund: ["grund"], install: ["inst"], schutz: ["schutz", "sich"], mess: ["mess"], masch: ["motor"] };
function buildPairs() {
  const out = {};
  for (const t of TOPICS) {
    const lex = LEXIKON.filter((x) => (LEX_TOPIC[x.c] || []).includes(t.id)).map((x) => ({ l: x.t, r: x.d }));
    const fs = FORMULAS.filter((f) => f.topic === t.id).map((f) => ({ l: f.name, r: f.f }));
    out[t.id] = lex.length >= 4 ? lex : fs;
  }
  return out;
}

export function createLapPath(L) {
  const pairs = buildPairs();
  const cards = CARDS;
  const ids = new Set(cards.map((c) => c.id));
  const units = () => P.lapUnits({ cards, topics: TOPICS, problemTypes: PROBLEM_TYPES, year: L.year(), formulas: FORMULAS, pairs });
  const fmtNum = (x, ex) => (ex && ex.unit === "€" ? fmt(x, 2) : fmtAuto(x));

  return createPath({
    module: "lap",
    name: "LAP",
    units,
    unitsKey: () => String(L.year()),
    lessonCtx: () => ({ makeProblem, formulas: FORMULAS }),
    check(ex, value) {
      if (ex.type === "num") {
        const r = checkAnswer(value, ex.answer, ex.tol);
        if (r.empty || !Number.isFinite(r.value)) return null;
        return r.ok;
      }
      return false;
    },
    fmtNum,
    calc: (onTake) => createCalc({ onTake }),
    async grade(ref, ok) {
      if (!ids.has(ref)) return;
      const cur = L.cards().get(ref);
      if (!ok) return L.grade(ref, 1);
      if (!cur || !cur.seen || (cur.due && cur.due <= L.today())) return L.grade(ref, 4);
    },
    countStats(n) { if (n > 0) L.count("path", null, n); },
    practiceItems(us, mod) {
      const today = L.today();
      const map = L.cards();
      const pool = filterYear(cards, L.year(), "upto");
      const weak = pool.filter((c) => { const s = map.get(c.id); return s && s.seen > 0 && (s.reps === 0 || (s.due && s.due <= today)); })
        .sort((a, b) => ((map.get(b.id).lapses || 0) - (map.get(a.id).lapses || 0)));
      const out = weak.slice(0, 8);
      if (out.length < 5) {
        const done = us.flatMap((u) => u.nodes).filter((n) => n.type === "lesson" && n.kind === "cards" && mod.nodes[n.id]).flatMap((n) => n.items);
        for (const c of done.slice().reverse()) { if (out.length >= 8) break; if (!out.includes(c)) out.push(c); }
      }
      return out;
    },
  });
}
