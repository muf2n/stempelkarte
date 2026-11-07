// Alltag › Japanisch: reine Logik (ohne DOM) – SRS (SM-2), Kana/Romaji-Normalisierung und -Vergleich,
// Quiz-Erzeugung, Tages-/Serien-Statistik. Unit-Tests: test/jp-core.test.mjs
import { KANA_GROUPS } from "./jp-data.js";

/* ---------- Datum, SRS, Zufall, Statistik: gemeinsam mit anderen Lernmodulen (./srs-core.js) ---------- */
export {
  dayKey, addDays, GRADES, newCard, review, isDue, isLearned, isMastered, buildQueue,
  rng, shuffle, DEFAULT_STATS, bump, streak, todayCount,
} from "./srs-core.js";
import { shuffle } from "./srs-core.js";

/* ---------- Kana ---------- */
export function toKatakana(s) {
  return String(s || "").replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}
export function toHiragana(s) {
  return String(s || "").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
/** Alle Kana einer Gruppe als flache Liste [{kana, romaji, row, group}] (script: "hira" | "kata"). */
export function kanaList(script = "hira", groups = null) {
  const out = [];
  for (const [gid, , rows] of KANA_GROUPS) {
    if (groups && !groups.includes(gid)) continue;
    for (const [rid, , cells] of rows) for (const c of cells) if (c) {
      out.push({ kana: script === "kata" ? toKatakana(c[0]) : c[0], romaji: c[1], row: rid, group: gid, script });
    }
  }
  return out;
}

// Hiragana → Romaji (Hepburn). Längste Treffer zuerst (Yōon vor Einzelzeichen).
const H2R = new Map();
for (const [, , rows] of KANA_GROUPS) for (const [, , cells] of rows) for (const c of cells) if (c) H2R.set(c[0], c[1]);
Object.entries({ "ぁ": "a", "ぃ": "i", "ぅ": "u", "ぇ": "e", "ぉ": "o", "ゔ": "vu", "ゃ": "ya", "ゅ": "yu", "ょ": "yo", "ゎ": "wa", "ゐ": "i", "ゑ": "e" })
  .forEach(([k, v]) => { if (!H2R.has(k)) H2R.set(k, v); });
// Katakana-Lautkombinationen für Lehnwörter (nach Umwandlung in Hiragana)
Object.entries({ "てぃ": "ti", "でぃ": "di", "ふぁ": "fa", "ふぃ": "fi", "ふぇ": "fe", "ふぉ": "fo", "うぃ": "wi", "うぇ": "we", "うぉ": "wo", "しぇ": "she", "じぇ": "je", "ちぇ": "che", "ゔぁ": "va", "ゔぃ": "vi", "ゔぇ": "ve", "ゔぉ": "vo", "とぅ": "tu", "どぅ": "du" })
  .forEach(([k, v]) => H2R.set(k, v));

/** Kana (Hiragana/Katakana) → Romaji. Nicht-Kana bleibt stehen. */
export function kanaToRomaji(s) {
  const h = toHiragana(String(s || "").normalize("NFKC"));
  let out = "";
  for (let i = 0; i < h.length; i++) {
    const two = h.slice(i, i + 2);
    if (two.length === 2 && H2R.has(two)) { out += H2R.get(two); i++; continue; }
    const ch = h[i];
    if (ch === "っ") { // Doppelkonsonant
      const nx = h.slice(i + 1, i + 3);
      const r = H2R.get(nx) || H2R.get(h[i + 1]) || "";
      out += r ? (r.startsWith("ch") ? "t" : r[0]) : "";
      continue;
    }
    if (ch === "ー") { const m = /[aeiou]$/.exec(out); out += m ? m[0] : ""; continue; }
    out += H2R.has(ch) ? H2R.get(ch) : ch;
  }
  return out;
}

const hasKana = (s) => /[぀-ヿ]/.test(s);
const PUNCT = /[\s　、。！？!?,.・「」『』（）()\-–—~〜…:：;；"'’“”]/g;

/**
 * Lockerer Vergleichsschlüssel (Romaji, ohne Längen, Satzzeichen, Leerzeichen; Varianten wie si/shi, wo/o, ha/wa vereinheitlicht).
 * Kanji bleiben als Kanji erhalten (können nicht gelesen werden).
 */
export function looseKey(s) {
  let x = String(s || "").normalize("NFKC").toLowerCase();
  if (hasKana(x)) x = kanaToRomaji(x);
  x = x.normalize("NFD").replace(/[̀-ͯ]/g, ""); // ō → o
  x = x.replace(/n'/g, "n").replace(PUNCT, "");
  const rep = [
    [/sy([aiueo])/g, "sh$1"], [/si/g, "shi"], [/ty([aiueo])/g, "ch$1"], [/cy([aiueo])/g, "ch$1"],
    [/ti/g, "chi"], [/tu/g, "tsu"], [/(?<![sc])hu/g, "fu"], [/zy([aiueo])/g, "j$1"], [/jy([aiueo])/g, "j$1"],
    [/zi/g, "ji"], [/di/g, "ji"], [/du/g, "zu"], [/dzu/g, "zu"], [/wo/g, "o"], [/(?<![sc])ha/g, "wa"], [/m([bp])/g, "n$1"],
    [/([bcdfghjklmprstvwz])\1/g, "$1"], [/tch/g, "ch"], [/nn/g, "n"],
    [/ou/g, "o"], [/ei/g, "e"], [/([aeiou])\1+/g, "$1"],
  ];
  for (const [re, to] of rep) x = x.replace(re, to);
  return x;
}

/** Levenshtein-Distanz (für „fast richtig“). */
export function lev(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const strip = (s) => String(s || "").normalize("NFKC").replace(PUNCT, "");

/**
 * Gesagtes/Getipptes mit dem Ziel vergleichen.
 * @param {string|string[]} heard  eine oder mehrere Erkennungs-Alternativen
 * @param {{kana:string, kanji?:string, romaji?:string, alt?:string[]}} target
 * @returns {{result:"ok"|"close"|"wrong", score:number, best:string}}
 */
export function compareSpeech(heard, target) {
  const list = (Array.isArray(heard) ? heard : [heard]).map((h) => String(h || "").trim()).filter(Boolean);
  const forms = [target.kana, target.kanji, target.romaji, ...(target.alt || [])].filter(Boolean);
  const keys = forms.map(looseKey);
  const raw = forms.map(strip);
  let best = { result: "wrong", score: 0, best: list[0] || "" };
  for (const h of list) {
    const hs = strip(h);
    if (raw.includes(hs)) return { result: "ok", score: 1, best: h };
    const hk = looseKey(h);
    for (const k of keys) {
      if (!k || !hk) continue;
      if (hk === k) return { result: "ok", score: 1, best: h };
      const score = 1 - lev(hk, k) / Math.max(hk.length, k.length);
      if (score > best.score) best = { result: score >= 0.75 ? "close" : "wrong", score: Math.round(score * 100) / 100, best: h };
    }
  }
  return best;
}

// Romaji-Schreibweisen, die bei einzelnen Kana auch gelten
const ROMA_ALT = { shi: ["si"], chi: ["ti"], tsu: ["tu"], fu: ["hu"], ji: ["zi", "di"], zu: ["du"], wo: ["o"], n: ["nn", "n'"],
  sha: ["sya"], shu: ["syu"], sho: ["syo"], cha: ["tya", "cya"], chu: ["tyu", "cyu"], cho: ["tyo", "cyo"], ja: ["zya", "jya"], ju: ["zyu", "jyu"], jo: ["zyo", "jyo"] };
/** Getippte Romaji für EIN Kana prüfen (streng, aber Varianten wie si/shi erlaubt). */
export function checkRomaji(expected, input) {
  const x = String(input || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!x) return false;
  return x === expected || (ROMA_ALT[expected] || []).includes(x);
}

/* ---------- Quiz ---------- */
/**
 * Kana-Quiz erzeugen.
 * @param {{kana:string, romaji:string}[]} pool  Auswahl (z. B. gewählte Reihen)
 * @param {{dir?:"k2r"|"r2k", count?:number, choices?:number, rand?:()=>number, weights?:Record<string,number>}} opts
 *   weights: Kana → Gewicht (Fehler öfter abfragen). Distraktoren haben nie dieselbe Romaji-Lesung wie die Lösung.
 * @returns {{kana, romaji, dir, prompt, answer, options:string[]}[]}
 */
export function makeKanaQuiz(pool, { dir = "k2r", count = 10, choices = 4, rand = Math.random, weights = {} } = {}) {
  const uniq = [...new Map(pool.map((p) => [p.kana, p])).values()];
  if (!uniq.length) return [];
  const qs = [];
  let bag = [];
  const refill = () => {
    bag = [];
    for (const p of uniq) { const w = Math.max(1, Math.min(4, Math.round(weights[p.kana] || 1))); for (let i = 0; i < w; i++) bag.push(p); }
    bag = shuffle(bag, rand);
  };
  let last = null;
  while (qs.length < count) {
    if (!bag.length) refill();
    let p = bag.pop();
    if (last && p.kana === last && uniq.length > 1) { bag.unshift(p); p = bag.pop(); }
    last = p.kana;
    const others = shuffle(uniq.filter((o) => o.romaji !== p.romaji), rand);
    const seen = new Set([p.romaji]);
    const distract = [];
    for (const o of others) { if (distract.length >= choices - 1) break; if (!seen.has(o.romaji)) { seen.add(o.romaji); distract.push(o); } }
    const opts = shuffle([p, ...distract], rand);
    qs.push(dir === "r2k"
      ? { kana: p.kana, romaji: p.romaji, dir, prompt: p.romaji, answer: p.kana, options: opts.map((o) => o.kana) }
      : { kana: p.kana, romaji: p.romaji, dir, prompt: p.kana, answer: p.romaji, options: opts.map((o) => o.romaji) });
  }
  return qs;
}

/** Multiple-Choice für Bedeutungen: Lösung + (n-1) andere deutsche Bedeutungen (bevorzugt gleiches Thema). */
export function meaningChoices(item, all, { n = 4, rand = Math.random } = {}) {
  const same = shuffle(all.filter((x) => x.id !== item.id && x.de !== item.de && x.topic === item.topic), rand);
  const rest = shuffle(all.filter((x) => x.id !== item.id && x.de !== item.de && x.topic !== item.topic), rand);
  const picked = [];
  const seen = new Set([item.de]);
  for (const x of [...same, ...rest]) { if (picked.length >= n - 1) break; if (!seen.has(x.de)) { seen.add(x.de); picked.push(x.de); } }
  return shuffle([item.de, ...picked], rand);
}
