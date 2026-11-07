// Alltag › Japanisch: kompakte Satz-Schreibweise der Inhaltsdateien lesen (rein, ohne Abhängigkeiten).
//   "私{わたし} は / 学生{がくせい} です 。"
//   • Leerzeichen trennen Wörter (= 🧩 Kacheln), " / " trennt Satzglieder (dürfen beim Bauen umgestellt werden),
//   • Kanji{Lesung} = Furigana für die Kanji direkt davor, Satzzeichen sind eigene Wörter.
const KANJI_READ = /([一-龯々〆ヵヶ]+)\{([^}]+)\}/g;
export const PUNCT_TOKEN = /^[、。！？!?…「」『』（）・,.]+$/;

/** Ein Wort → Furigana-Teile [[text, lesung?], …] */
function wordParts(w) {
  const parts = [];
  let last = 0;
  for (const m of w.matchAll(KANJI_READ)) {
    if (m.index > last) parts.push([w.slice(last, m.index)]);
    parts.push([m[1], m[2]]);
    last = m.index + m[0].length;
  }
  if (last < w.length) parts.push([w.slice(last)]);
  return parts;
}
const plain = (parts) => parts.map((p) => p[0]).join("");
const reading = (parts) => parts.map((p) => p[1] || p[0]).join("");

/**
 * @param {string} src
 * @returns {{ phrases: {t:string, r:string}[][], tokens: {t:string, r:string, punct:boolean}[], ja: string[][], text: string, kana: string, spaced: string }}
 *   ja    = Furigana-Teile im Format der Lesetexte ([[text, lesung?], …], benachbarter Klartext zusammengefasst)
 *   text  = Satz mit Kanji (ohne Leerzeichen), kana = nur Lesung, spaced = Lesung mit Leerzeichen zwischen Satzgliedern
 */
export function parseJa(src) {
  const phrases = String(src || "").trim().split(/\s+\/\s+/).map((ph) => ph.split(/\s+/).filter(Boolean).map((w) => {
    const parts = wordParts(w);
    return { t: plain(parts), r: reading(parts), parts, punct: PUNCT_TOKEN.test(w) };
  }));
  const tokens = phrases.flat();
  const ja = [];
  for (const tk of tokens) for (const p of tk.parts) {
    const prev = ja[ja.length - 1];
    if (!p[1] && prev && !prev[1]) prev[0] += p[0]; else ja.push(p[1] ? [p[0], p[1]] : [p[0]]);
  }
  const spaced = phrases.map((ph) => ph.map((x) => x.r).join("")).join(" ").replace(/\s+([、。！？!?…」』）])/g, "$1");
  return {
    phrases: phrases.map((ph) => ph.map(({ t, r, punct }) => ({ t, r, punct }))),
    tokens: tokens.map(({ t, r, punct }) => ({ t, r, punct })),
    ja, text: tokens.map((x) => x.t).join(""), kana: tokens.map((x) => x.r).join(""), spaced,
  };
}

/** Alle erlaubten Reihenfolgen zum Satzbauen: Satzglieder vor dem letzten (Prädikat) frei umstellbar (max. 4 → 24 Varianten). */
export function tileAnswers(phrases, { fixed = false } = {}) {
  const words = (ph) => ph.filter((x) => !x.punct).map((x) => x.r);
  const ps = phrases.map(words).filter((w) => w.length);
  if (fixed || ps.length < 3 || ps.length > 5) return [ps.flat().join("")];
  const head = ps.slice(0, -1), last = ps[ps.length - 1];
  const out = new Set();
  const perm = (rest, acc) => {
    if (!rest.length) { out.add([...acc.flat(), ...last].join("")); return; }
    rest.forEach((p, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, p]));
  };
  perm(head, []);
  const canon = ps.flat().join("");
  return [canon, ...[...out].filter((x) => x !== canon)];
}
