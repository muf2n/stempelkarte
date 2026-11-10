// Update 10 – 🛤️ Lernpfad („wie Duolingo“): reine Logik ohne DOM für 🇯🇵 Japanisch und 🎓 LAP Elektrotechnik.
//   • Einheiten/Knoten aus den vorhandenen Inhalten erzeugen (jpUnits, lapUnits) – keine erfundenen Fakten
//   • Freischalt-Regeln, Kronen, Schatzkisten, Einheiten-Prüfung (nodeStates, applyLesson, openChest)
//   • Lektionen bauen (buildLesson, deterministisch mit Seed) und ablaufen lassen (startRun/answerRun – Fehler kommen hinten nochmal)
//   • 🔋 Energie wie bei Duolingo (25 max, −1 je Übung, −2 bei Fehler, Combo-Bonus, +1 alle 30 min, täglich voll), ⚡ XP & Tagesziel, 💎 Edelsteine, 🧊 Serien-Schutz, 🏆 Abzeichen, 🔔 Erinnerung
// Gespeichert in der Alltag-Sammlung "learn_progress": Dokument je Modul ("jp", "lap") + gemeinsames Dokument "me".
//   Modul: { id, nodes: { <knoten>: { c:Krone 1–3, p:perfekt, n:gespielt, at } }, xp: { "JJJJ-MM-TT": XP } }
//   me:    { id:"me", gems, energy:{ n, at, day }, energyMode:"normal"|"entspannt"|"unbegrenzt", freeRefillDay, train:{ day, xp },
//            freezes, frozen:{ Tag:true }, goal, sound, ok, perfect, lessons, ach:{ id: ms }, last }
// Unit-Tests: test/path-core.test.mjs
import { dayKey, addDays, rng, shuffle, streak as srsStreak } from "./srs-core.js";
import { parseJa, tileAnswers } from "./jp-text.js";

export { rng, dayKey };

/* ================= Konstanten ================= */
export const MAX_ENERGY = 25;          // 🔋 volle Energie
export const ENERGY_COST = 1;          // jede beantwortete Übung
export const ENERGY_WRONG = 2;         // falsche Antwort kostet insgesamt 2
export const ENERGY_START = 5;         // Lektion starten erst ab 5 🔋
export const COMBO_EVERY = 5;          // alle 5 richtigen in Folge …
export const COMBO_ENERGY = 2;         // … +2 🔋 Bonus
export const REFILL_MS = 30 * 60 * 1000; // +1 🔋 alle 30 min (Duolingo: 1 h – hier Selbstlern-App)
export const CHEST_ENERGY = 5;         // 🎁 Schatzkiste: +5 🔋 …
export const CHEST_ENERGY_BELOW = 20;  // … wenn unter 20
export const PRACTICE_ENERGY_MAX = 5;  // 🏋️ Üben: +1 je richtiger Antwort, höchstens +5 pro Runde
export const ENERGY_GEMS = 300;        // 💎 → volle Energie
export const FREEZE_COST = 200;
export const MAX_FREEZES = 2;
export const GOALS = [
  { id: "leicht", name: "Leicht", emoji: "🌱", xp: 20 },
  { id: "normal", name: "Normal", emoji: "🙂", xp: 50 },
  { id: "ernst", name: "Ernsthaft", emoji: "💪", xp: 100 },
  { id: "intensiv", name: "Intensiv", emoji: "🔥", xp: 150 },
];
export const goalXp = (id) => (GOALS.find((g) => g.id === id) || GOALS[1]).xp;
export const XP = { train: 1, lesson: 10, perfect: 5, check: 20, practice: 5, chest: 5, comboStep: 5, comboXp: 2, comboMax: 6 };
export const GEMS = { perfect: 5, check: 10, chest: 20, lesson: 1 };
export const DEFAULT_ME = { id: "me", gems: 0, energy: { n: MAX_ENERGY, at: 0, day: null }, energyMode: "normal", freeRefillDay: null, train: { day: null, xp: 0 }, freezes: 0, frozen: {}, goal: null, sound: true, ok: 0, perfect: 0, lessons: 0, ach: {}, last: null };
export const readMe = (doc) => {
  const d = doc && typeof doc === "object" ? doc : {};
  const rest = { ...d };
  delete rest.hearts; // ❤️ Herzen (alt) → 🔋 Energie: alle starten nach dem Update mit voller Energie
  if (!ENERGY_MODES.some((m) => m.id === rest.energyMode)) rest.energyMode = "normal";
  if (!rest.train || typeof rest.train !== "object") rest.train = { day: null, xp: 0 };
  return { ...DEFAULT_ME, ...rest, energy: { ...DEFAULT_ME.energy, ...(d.energy && typeof d.energy === "object" ? d.energy : {}) }, frozen: { ...(d.frozen || {}) }, ach: { ...(d.ach || {}) } };
};
export const readMod = (doc, id) => {
  const d = doc && typeof doc === "object" ? doc : {};
  return { id, ...d, nodes: { ...(d.nodes || {}) }, xp: { ...(d.xp || {}) } };
};

const COLORS = 6;
const chunk = (list, size) => {
  if (!list.length) return [];
  const n = Math.ceil(list.length / size);
  const per = Math.ceil(list.length / n);
  const out = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
};

/** Knoten einer Einheit zusammenstellen: Lektionen, nach jeder 3. eine 🎁 Schatzkiste, am Ende die 🏁 Prüfung. */
function finishUnit(unit, lessons) {
  const nodes = [];
  lessons.forEach((l, i) => {
    nodes.push({ ...l, id: `${unit.id}-${i + 1}`, unit: unit.id });
    if ((i + 1) % 3 === 0 && i < lessons.length - 1) nodes.push({ type: "chest", id: `${unit.id}-k${i + 1}`, unit: unit.id, title: "Schatzkiste", emoji: "🎁" });
  });
  nodes.push({ type: "check", id: `${unit.id}-p`, unit: unit.id, title: "Prüfung", emoji: "🏁", items: unit.items, calc: unit.calc || [] });
  return { ...unit, nodes };
}

/* ================= Einheiten: 🇯🇵 Japanisch ================= */
const JP_SEG = "📚 Wörter & Grammatik";
/** Beispielsatz (Kompaktformat ./jp-text.js) → Lernobjekt fürs Hören/Lesen/Satzbauen. */
export function jpSentence(id, src, ro, de, extra = {}) {
  const p = parseJa(src);
  const words = p.tokens.filter((x) => !x.punct).map((x) => x.r);
  const heads = p.phrases.map((ph) => ph.find((x) => !x.punct)).filter(Boolean).map((x) => x.r);
  return { id, kind: "sent", src, text: p.text, kana: p.kana, spaced: p.spaced, words, heads, answers: tileAnswers(p.phrases, { fixed: !!extra.fixed }), ro, de, ...extra };
}
/**
 * @param {{groups:Array, vocab:Array, toKata:(s:string)=>string, kanaId:(k:string)=>string, grammar?:Array, sentences?:Array, order?:string[]}} d
 *   groups = KANA_GROUPS, vocab = VOCAB (jp-data.js), grammar = GRAMMAR / order = PATH_ORDER (jp-data-grammar.js), sentences = SENTENCES (jp-data-sentences.js)
 * Reihenfolge: Hiragana (Grundreihe 1+2, Dakuten, Yōon) → Katakana (gleich) → Basis-Wörter → abwechselnd Grammatik und Wortschatz-Themen.
 * IDs bleiben stabil: Kana "jp-hira-…", Themen "jp-w<Index>" (Erweiterungen alter Themen: "jp-w<Index>x"), Grammatik "jp-g-<id>".
 */
export function jpUnits({ groups, vocab, toKata = (s) => s, kanaId = (k) => "k_" + k, grammar = [], sentences = [], order = [] }) {
  const units = [];
  let color = 0;
  const g = Object.fromEntries(groups.map(([id, name, rows]) => [id, { name, rows }]));
  const plan = [
    ["b1", "Grundreihe", () => g.basis.rows.slice(0, 5), 1],
    ["b2", "Grundreihe 2", () => g.basis.rows.slice(5), 1],
    ["daku", "Dakuten ゛゜", () => g.daku.rows, 1],
    ["yoon", "Yōon ゃゅょ", () => g.yoon.rows, 3],
  ];
  for (const [script, label, seg] of [["hira", "Hiragana", "🎌 Hiragana"], ["kata", "Katakana", "🗾 Katakana"]]) {
    const pool = [];
    for (const [pid, pname, rowsOf, perLesson] of plan) {
      if (!g.basis || !g.daku || !g.yoon) break;
      const rows = rowsOf();
      const unitItems = [];
      const lessons = [];
      for (let i = 0; i < rows.length; i += perLesson) {
        const part = rows.slice(i, i + perLesson);
        const items = [];
        for (const [, , cells] of part) for (const c of cells) if (c) {
          const kana = script === "kata" ? toKata(c[0]) : c[0];
          items.push({ id: kanaId(kana), kind: "kana", kana, romaji: c[1], script });
        }
        unitItems.push(...items);
        pool.push(...items);
        const first = items[0] ? items[0].kana : "";
        const conv = (t) => (script === "kata" ? toKata(t) : t);
        lessons.push({ type: "lesson", kind: "kana", title: part.map((r) => conv(r[1])).join(" · "), emoji: first, items, pool: pool.slice() });
      }
      const unit = { id: `jp-${script}-${pid}`, seg, title: `${label} ${pname}`, emoji: script === "kata" ? "🗾" : "🎌", kind: "kana", tag: script, color: color++ % COLORS, items: unitItems, pool: pool.slice() };
      units.push(finishUnit(unit, lessons));
    }
  }
  const sents = sentences.map(([gid, topic, src, ro, de, fixed], i) => jpSentence("t" + i, src, ro, de, { g: gid, topic, fixed: !!fixed }));
  // Wortschatz: je Thema eine Einheit (Lektionen zu ~6 Wörtern); Erweiterungen alter Themen (wave 2) als eigene Einheit
  const later = new Map();
  const topics = [];
  for (const v of vocab) { let t = topics.find((x) => x.topic === v.topic); if (!t) topics.push(t = { topic: v.topic, emoji: v.emoji, words: [], more: [], title2: "" }); (v.wave === 2 ? t.more : t.words).push(v); if (v.wave === 2 && v.unit) t.title2 = v.unit; }
  const word = (v) => ({ id: "v_" + v.id, kind: "vocab", kana: v.kana, kanji: v.kanji || "", romaji: v.romaji, de: v.de, topic: v.topic });
  topics.forEach((t, ti) => {
    const ts = sents.filter((x) => x.topic === t.topic).slice(0, 6);
    for (const [list, key, id, title] of [[t.words, "w:", `jp-w${ti}`, t.topic], [t.more, "w+:", `jp-w${ti}x`, t.title2 || `${t.topic} 2`]]) {
      if (!list.length) continue;
      const words = list.map(word);
      const lessons = chunk(words, 6).map((items, i) => ({ type: "lesson", kind: "vocab", title: `${title} ${i + 1}`, emoji: t.emoji, items, pool: words, sents: ts }));
      const unit = { id, seg: JP_SEG, title, emoji: t.emoji, kind: "vocab", tag: "vocab", items: words, pool: words };
      later.set(key + t.topic, [unit, lessons]);
    }
  });
  // 📐 Grammatik: je Lektion eine Einheit – „Kennenlernen“ (Beispiele + erste Übungen) und „Üben“ (Rest + Sätze)
  for (const gr of grammar) {
    const hint = { title: gr.title, short: gr.short, explain: gr.explain, table: gr.table };
    const gx = gr.examples.map(([src, ro, de], i) => ({ ...jpSentence(`g_${gr.id}_x${i}`, src, ro, de), kind: "gx", g: gr.id }));
    const gex = gr.ex.map((e, i) => ({ ...e, id: `g_${gr.id}_${i}`, kind: "gex", g: gr.id, ...(e.t === "build" ? { sent: jpSentence(`g_${gr.id}_${i}`, e.src, e.ro, e.de) } : {}) }));
    const gs = sents.filter((x) => x.g === gr.id);
    const half = Math.ceil(gex.length / 2);
    const lessons = [
      { type: "lesson", kind: "grammar", title: "Kennenlernen", emoji: gr.emoji, items: [...gx, ...gex.slice(0, half), ...gs.slice(0, 2)], hint, intro: true },
      { type: "lesson", kind: "grammar", title: "Üben", emoji: gr.emoji, items: [...gex.slice(half), ...gs.slice(2)], hint },
    ];
    const items = [...gx, ...gex, ...gs];
    const unit = { id: `jp-g-${gr.id}`, seg: JP_SEG, title: `📐 ${gr.title}`, emoji: gr.emoji, kind: "grammar", tag: "grammar", items, pool: items, hint };
    later.set("g:" + gr.id, [unit, lessons]);
  }
  const keys = [...order.filter((k) => later.has(k)), ...[...later.keys()].filter((k) => !order.includes(k))];
  for (const k of keys) {
    const [unit, lessons] = later.get(k);
    units.push(finishUnit({ ...unit, color: color++ % COLORS }, lessons));
  }
  // Prüfung einer Grammatik-Einheit: weiß, dass sie Grammatik ist
  for (const u of units) if (u.kind === "grammar") { const c = u.nodes[u.nodes.length - 1]; c.kind = "grammar"; c.hint = u.hint; }
  return number(units);
}

/* ================= Einheiten: 🎓 LAP ================= */
/** Rechenaufgaben-Art → Thema, in dessen Einheit die Rechen-Lektion eingeflochten wird. */
export const CALC_TOPIC = { ohm: "grund", power: "grund", pi2r: "grund", series: "grund", parallel: "grund", energy: "grund", wire: "leit", du1: "leit", du3: "leit", pac: "ac", xl: "ac", peak: "ac", p3: "ac" };
/** Rechenaufgaben-Art → passende Formel (FORMULAS in lap-data.js). */
export const CALC_FORMULA = { ohm: "ohm", power: "pui", pi2r: "pi2r", series: "series", parallel: "parallel", energy: "work", wire: "leitung", du1: "du1", du3: "du3", p3: "p3", pac: "p1ac", xl: "xl", peak: "eff" };
const MIN_TOPIC = 6;     // kleinere Themen kommen in „Bunt gemischt“
const MAX_CARD_LESSONS = 5;

/**
 * @param {{cards:Array, topics:Array, problemTypes:Array, year:number, formulas?:Array, pairs?:Record<string,{l:string,r:string}[]>}} d
 *   year 0 = alle Lehrjahre nacheinander (1 → 2 → 3). Jedes Lehrjahr ist ein eigener Abschnitt (startet freigeschaltet).
 */
export function lapUnits({ cards, topics, problemTypes, year = 0, formulas = [], pairs = {} }) {
  const years = year ? [year] : [1, 2, 3];
  const units = [];
  let color = 0;
  for (const y of years) {
    const seg = `🎓 ${y}. Lehrjahr`;
    const ofYear = cards.filter((c) => c && (Number(c.year) || 1) === y && Array.isArray(c.x) && c.x.length >= 1);
    const types = problemTypes.filter((t) => (Number(t.year) || 1) === y).map((t) => t.id);
    const yearUnits = [];
    const small = [];
    for (const tp of topics) {
      const list = ofYear.filter((c) => c.topic === tp.id);
      if (!list.length) continue;
      if (list.length < MIN_TOPIC) { small.push(...list); continue; }
      yearUnits.push({ topic: tp, list });
    }
    if (small.length) yearUnits.push({ topic: { id: "mix", name: "Bunt gemischt", emoji: "🎲" }, list: small });
    // Rechen-Lektionen den Themen zuordnen (je 2 Aufgabenarten)
    const calcFor = {};
    const orphan = [];
    for (const t of types) {
      const tid = CALC_TOPIC[t] || "grund";
      if (yearUnits.some((u) => u.topic.id === tid)) (calcFor[tid] = calcFor[tid] || []).push(t); else orphan.push(t);
    }
    const build = (tp, list, calcTypes, part, parts) => {
      const id = `lap-y${y}-${tp.id}${parts > 1 ? "-" + part : ""}`;
      const title = parts > 1 ? `${tp.name} ${part}` : tp.name;
      const cardLessons = chunk(list, 8).map((items, i) => ({ type: "lesson", kind: "cards", title: `${title} · ${i + 1}`, emoji: tp.emoji, items, topic: tp.id }));
      const calcLessons = [];
      for (let i = 0; i < calcTypes.length; i += 2) calcLessons.push({ type: "lesson", kind: "calc", title: "Rechnen: " + calcTypes.slice(i, i + 2).map((t) => (problemTypes.find((p) => p.id === t) || {}).name || t).join(" & "), emoji: "🔢", calc: calcTypes.slice(i, i + 2), topic: tp.id });
      // nach je 2 Karten-Lektionen eine Rechen-Lektion einflechten
      const lessons = [];
      let ci = 0;
      cardLessons.forEach((l, i) => { lessons.push(l); if ((i + 1) % 2 === 0 && ci < calcLessons.length) lessons.push(calcLessons[ci++]); });
      while (ci < calcLessons.length) lessons.push(calcLessons[ci++]);
      lessons.forEach((l) => { l.pairs = pairs[tp.id] || []; l.formulas = formulas; l.pool = list; });
      const unit = { id, seg, year: y, title, emoji: tp.emoji, kind: "cards", topic: tp.id, color: color++ % COLORS, items: list, pool: list, calc: calcTypes };
      return finishUnit(unit, lessons);
    };
    for (const { topic: tp, list } of yearUnits) {
      const calcTypes = calcFor[tp.id] || [];
      const parts = Math.max(1, Math.ceil(chunk(list, 8).length / MAX_CARD_LESSONS));
      const per = Math.ceil(list.length / parts);
      for (let p = 0; p < parts; p++) {
        const slice = list.slice(p * per, (p + 1) * per);
        const ct = calcTypes.filter((_, i) => i % parts === p);
        units.push(build(tp, slice, ct, p + 1, parts));
      }
    }
    if (orphan.length) {
      const tp = { id: "calc", name: "Rechentraining", emoji: "🔢" };
      const lessons = [];
      for (let i = 0; i < orphan.length; i += 2) lessons.push({ type: "lesson", kind: "calc", title: "Rechnen: " + orphan.slice(i, i + 2).map((t) => (problemTypes.find((p) => p.id === t) || {}).name || t).join(" & "), emoji: "🔢", calc: orphan.slice(i, i + 2), topic: "calc", pairs: [], formulas, pool: [] });
      units.push(finishUnit({ id: `lap-y${y}-calc`, seg, year: y, title: tp.name, emoji: tp.emoji, kind: "calc", topic: "calc", color: color++ % COLORS, items: [], pool: [], calc: orphan }, lessons));
    }
  }
  return number(units);
}

function number(units) {
  let k = 0;
  units.forEach((u, i) => { u.no = i + 1; u.nodes.forEach((n) => { n.idx = k++; n.unitNo = u.no; }); });
  return units;
}
export const allNodes = (units) => units.flatMap((u) => u.nodes);

/* ================= Freischalten & Zustände ================= */
/**
 * Zustand je Knoten: "done" (geschafft), "current" (erster offener → START), "open" (freigeschaltet),
 * "jump" (Prüfung der aktuellen Einheit – zum Überspringen), "locked" 🔒.
 * Regel: ein Knoten ist frei, wenn der Knoten davor geschafft ist; der erste Knoten jedes Abschnitts (seg) ist immer frei.
 */
export function nodeStates(units, mod) {
  const done = (mod && mod.nodes) || {};
  const out = {};
  let prev = null, seg = null, current = null;
  for (const u of units) {
    for (const n of u.nodes) {
      const first = u.seg !== seg && n === u.nodes[0];
      if (done[n.id]) out[n.id] = "done";
      else if (first || (prev && done[prev.id])) out[n.id] = "open";
      else out[n.id] = "locked";
      if (!current && out[n.id] === "open") current = n.id;
      prev = n;
    }
    seg = u.seg;
  }
  if (current) out[current] = "current";
  // Prüfung der Einheit, in der man gerade steht, darf man zum Überspringen probieren
  for (const u of units) {
    const check = u.nodes[u.nodes.length - 1];
    if (out[check.id] === "locked" && u.nodes.some((n) => out[n.id] === "current" || out[n.id] === "open")) out[check.id] = "jump";
  }
  return out;
}
export const currentNode = (units, mod) => { const st = nodeStates(units, mod); return allNodes(units).find((n) => st[n.id] === "current") || null; };
export const crownOf = (mod, id) => ((mod && mod.nodes && mod.nodes[id]) || {}).c || 0;
/** Fortschritt einer Einheit: geschaffte Knoten / alle. */
export function unitProgress(unit, mod) {
  const done = (mod && mod.nodes) || {};
  const n = unit.nodes.filter((x) => done[x.id]).length;
  return { done: n, total: unit.nodes.length, complete: n === unit.nodes.length };
}
/** Tags vollständig geschaffter Abschnitte (z. B. "hira" wenn alle Hiragana-Einheiten fertig). */
export function completedTags(units, mod) {
  const tags = {};
  for (const u of units) if (u.tag) tags[u.tag] = (tags[u.tag] !== false) && unitProgress(u, mod).complete;
  return Object.keys(tags).filter((t) => tags[t]);
}

/** Pfad-Versatz (Schlangenlinie): -2 … 2 Schritte nach links/rechts. */
export const nodeOffset = (i) => [0, 1, 2, 1, 0, -1, -2, -1][((i % 8) + 8) % 8];

/* ================= Lektionen bauen ================= */
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
/** n verschiedene Distraktoren (nach key) aus pool, ohne Lösung. */
function distract(rand, pool, answer, key, n) {
  const seen = new Set([key(answer)]);
  const out = [];
  for (const x of shuffle(pool, rand)) { if (out.length >= n) break; const k = key(x); if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}
const opts = (rand, right, wrong) => shuffle([right, ...wrong], rand);
const short = (s, n = 120) => String(s || "").length <= n;

/* ---- Japanisch ---- */
const kanaEx = {
  k2r: (it, pool, rand) => ({ type: "mc", mode: "k2r", ref: it.id, kind: "kana", q: "Wie liest man das?", big: it.kana, answer: it.romaji, options: opts(rand, it.romaji, distract(rand, pool, it, (x) => x.romaji, 3).map((x) => x.romaji)) }),
  r2k: (it, pool, rand) => ({ type: "mc", mode: "r2k", ref: it.id, kind: "kana", q: `Welches Zeichen ist „${it.romaji}“?`, answer: it.kana, jp: true, options: opts(rand, it.kana, distract(rand, pool, it, (x) => x.romaji, 3).map((x) => x.kana)) }),
  listen: (it, pool, rand) => ({ type: "mc", mode: "listen", ref: it.id, kind: "kana", q: "Hör zu und wähle das Zeichen 👂", say: it.kana, answer: it.kana, jp: true, options: opts(rand, it.kana, distract(rand, pool, it, (x) => x.romaji, 3).map((x) => x.kana)) }),
  type: (it) => ({ type: "type", mode: "kana", ref: it.id, kind: "kana", q: "Tipp die Lesung in Romaji ⌨️", big: it.kana, answer: it.romaji }),
};
const wordLabel = (w) => w.kanji ? `${w.kana}（${w.kanji}）` : w.kana;
const vocabEx = {
  w2m: (it, pool, rand) => ({ type: "mc", mode: "w2m", ref: it.id, kind: "vocab", q: "Was heißt das?", big: it.kana, sub: [it.kanji, it.romaji].filter(Boolean).join(" · "), say: it.kana, answer: it.de,
    options: opts(rand, it.de, distract(rand, pool.filter((x) => x.topic === it.topic).length >= 4 ? pool.filter((x) => x.topic === it.topic) : pool, it, (x) => x.de, 3).map((x) => x.de)) }),
  m2w: (it, pool, rand) => ({ type: "mc", mode: "m2w", ref: it.id, kind: "vocab", q: `Wie sagt man „${it.de}“?`, answer: it.kana, jp: true, options: opts(rand, it.kana, distract(rand, pool, it, (x) => x.kana, 3).map((x) => x.kana)) }),
  listen: (it, pool, rand) => ({ type: "mc", mode: "listen", ref: it.id, kind: "vocab", q: "Hör zu – welches Wort war das? 👂", say: it.kana, answer: it.kana, jp: true, options: opts(rand, it.kana, distract(rand, pool, it, (x) => x.kana, 3).map((x) => x.kana)) }),
  tiles: (it, pool, rand) => {
    const chars = [...it.kana];
    const extra = [];
    for (const w of shuffle(pool.filter((x) => x.id !== it.id), rand)) { for (const c of w.kana) if (!chars.includes(c) && !extra.includes(c) && extra.length < 3) extra.push(c); if (extra.length >= 3) break; }
    return { type: "tiles", ref: it.id, kind: "vocab", q: `Bau das Wort für „${it.de}“ 🧩`, answer: it.kana, sub: it.romaji, tiles: shuffle([...chars, ...extra], rand), jp: true };
  },
  type: (it) => ({ type: "type", mode: "word", ref: it.id, kind: "vocab", q: `Tipp „${it.de}“ in Romaji ⌨️`, big: it.kana, sub: it.kanji || "", answer: it.romaji }),
  speak: (it) => ({ type: "speak", ref: it.id, kind: "vocab", q: "Sag es laut 🗣️", big: it.kana, sub: `${it.romaji} · ${it.de}`, say: it.kana, answer: it.kana, target: { kana: it.kana, kanji: it.kanji, romaji: it.romaji } }),
};
function matchEx(rand, list, left, right, n, kind) {
  const uniq = [];
  const seenL = new Set(), seenR = new Set();
  for (const x of shuffle(list, rand)) { const l = left(x), r = right(x); if (!l || !r || seenL.has(l) || seenR.has(r)) continue; seenL.add(l); seenR.add(r); uniq.push({ l, r, ref: x.id || null }); if (uniq.length >= n) break; }
  if (uniq.length < 3) return null;
  return { type: "match", kind, q: "Finde die Paare 🔗", pairs: uniq, left: shuffle(uniq.map((p) => p.l), rand), right: shuffle(uniq.map((p) => p.r), rand) };
}

/* ---- Sätze & Grammatik ---- */
const NOT_DISTRACT = new Set(["です", "ます", "ください", "じゃないです", "でした", "から", "まで"]);
/** Andere deutsche Bedeutungen (Sätze) als falsche Antworten. */
function otherDe(rand, s, pool, n = 3) { return distract(rand, pool.filter((x) => x.de), s, (x) => x.de, n).map((x) => x.de); }
const sentEx = {
  /** 🧩 Satz aus Wort-Kacheln (Kana) bauen; Satzglieder dürfen umgestellt werden (answers). */
  tiles: (s, pool, rand, q) => {
    const extra = [];
    for (const o of shuffle(pool.filter((x) => x.heads && x.id !== s.id), rand)) {
      for (const h of o.heads) if (h.length >= 2 && !s.words.includes(h) && !extra.includes(h) && !NOT_DISTRACT.has(h) && extra.length < 2) extra.push(h);
      if (extra.length >= 2) break;
    }
    return { type: "tiles", ref: s.id, kind: "sent", q: q || `Bau den Satz: „${s.de}“ 🧩`, answer: s.words.join(""), answers: s.answers, words: s.words, show: s.spaced, tiles: shuffle([...s.words, ...extra], rand), jp: true, say: s.kana, e: s.ro };
  },
  /** 👂 Satz hören → Bedeutung wählen */
  listen: (s, pool, rand) => ({ type: "mc", mode: "listen", ref: s.id, kind: "sent", q: "Hör zu – was bedeutet der Satz? 👂", say: s.kana, answer: s.de, options: opts(rand, s.de, otherDe(rand, s, pool)), e: `${s.spaced} · ${s.ro}` }),
  /** 📖 Satz lesen → Bedeutung wählen */
  read: (s, pool, rand) => ({ type: "mc", mode: "read", ref: s.id, kind: "sent", q: "Was bedeutet der Satz? 📖", big: s.spaced, sub: s.text !== s.kana ? s.text : "", say: s.kana, answer: s.de, options: opts(rand, s.de, otherDe(rand, s, pool)), e: s.ro }),
  /** 🇩🇪 → 🇯🇵 richtigen Satz wählen */
  pickja: (s, pool, rand) => ({ type: "mc", mode: "m2s", ref: s.id, kind: "sent", q: `Wie sagt man: „${s.de}“?`, answer: s.spaced, jp: true, options: opts(rand, s.spaced, distract(rand, pool.filter((x) => x.spaced), s, (x) => x.spaced, 3).map((x) => x.spaced)), e: s.ro }),
};
/** Grammatik-Übung aus jp-data-grammar.js → Übung für den Player. */
function gramEx(e, pool, rand) {
  if (e.t === "mc") return { type: "mc", mode: "gram", ref: e.id, kind: "gram", q: "Was passt in die Lücke? ✏️", big: e.s, sub: e.de, say: e.s.replace("＿", e.a), answer: e.a, jp: true, options: shuffle(e.opts, rand), e: `${e.s.replace("＿", e.a)} · ${e.ro}` };
  if (e.t === "build") return sentEx.tiles(e.sent, pool, rand);
  if (e.t === "pick") return { type: "mc", mode: "read", ref: e.id, kind: "gram", q: "Was bedeutet der Satz? 📖", big: e.s, say: e.s, answer: e.a, options: shuffle(e.opts, rand), e: e.ro };
  return { type: "mc", mode: "m2s", ref: e.id, kind: "gram", q: `Wie sagt man: „${e.de}“?`, answer: e.a, jp: true, options: shuffle(e.opts, rand), e: e.ro };
}
/** 📐 Grammatik-Lektion: Beispiele lesen → Lücken/Kacheln → Sätze hören & bauen. Regel als 💡 an jeder Übung. */
function grammarLesson(node, rand, { canListen = true, size = 12 } = {}, check = false) {
  const items = node.items || [];
  const gx = items.filter((x) => x.kind === "gx"), gex = items.filter((x) => x.kind === "gex"), ss = items.filter((x) => x.kind === "sent");
  const pool = [...(node.pool || []), ...items].filter((x, i, a) => a.indexOf(x) === i);
  const sentPool = pool.filter((x) => x.kind === "sent" || x.kind === "gx");
  let ex;
  if (check) {
    const mix = [...shuffle(gex, rand).map((e) => gramEx(e, sentPool, rand))];
    shuffle(ss, rand).slice(0, 6).forEach((s, i) => mix.push([sentEx.tiles, canListen ? sentEx.listen : sentEx.read, sentEx.pickja][i % 3](s, sentPool, rand)));
    for (const s of shuffle(gx, rand).slice(0, 2)) mix.push(sentEx.read(s, sentPool, rand));
    ex = shuffle(mix, rand).slice(0, 14);
  } else {
    const intro = gx.slice(0, 4).map((s) => sentEx.read(s, sentPool, rand));
    const rest = gex.map((e) => gramEx(e, sentPool, rand));
    ss.forEach((s, i) => rest.push(i % 3 === 0 ? sentEx.tiles(s, sentPool, rand) : i % 3 === 1 ? (canListen ? sentEx.listen : sentEx.read)(s, sentPool, rand) : sentEx.pickja(s, sentPool, rand)));
    if (!node.intro) for (const s of shuffle(ss, rand).slice(0, 2)) rest.push(sentEx.tiles(s, sentPool, rand, `Nochmal bauen: „${s.de}“ 🧩`));
    ex = [...intro, ...shuffle(rest, rand)].slice(0, size);
  }
  if (node.hint) ex = ex.map((e, i) => ({ ...e, hint: node.hint, hintOpen: !check && i === 0 }));
  return ex;
}

function jpLesson(node, rand, { canListen = true, canSpeak = false, size = 12 } = {}) {
  const items = node.items || [];
  const pool = (node.pool && node.pool.length >= 4 ? node.pool : items);
  const ex = [];
  if (node.kind === "kana" || (items[0] && items[0].kind === "kana")) {
    const news = shuffle(items, rand);
    news.forEach((it) => ex.push(kanaEx.k2r(it, pool, rand)));
    const rest = [];
    for (const it of shuffle(items, rand).slice(0, canListen ? 2 : 4)) rest.push(kanaEx.r2k(it, pool, rand));
    if (canListen) for (const it of shuffle(items, rand).slice(0, 2)) rest.push(kanaEx.listen(it, pool, rand));
    for (const it of shuffle(items, rand).slice(0, 2)) rest.push(kanaEx.type(it));
    const m = matchEx(rand, [...items, ...shuffle(pool.filter((p) => !items.includes(p)), rand)].slice(0, Math.max(5, items.length)), (x) => x.kana, (x) => x.romaji, 5, "kana");
    if (m) rest.push(m);
    const head = ex.slice(0, Math.min(ex.length, Math.max(5, size - rest.length)));
    return [...head, ...shuffle(rest, rand)].slice(0, size);
  }
  // Wortschatz
  const words = shuffle(items, rand);
  const intro = words.map((w) => vocabEx.w2m(w, pool, rand));
  const second = shuffle(words, rand).map((w, i) => (i % 2 ? vocabEx.type(w) : vocabEx.m2w(w, pool, rand)));
  const extra = [];
  const tileable = words.filter((w) => [...w.kana].length <= 8);
  for (const w of tileable.slice(0, 2)) extra.push(vocabEx.tiles(w, pool, rand));
  if (canListen && words[0]) extra.push(vocabEx.listen(words[words.length - 1], pool, rand));
  if (canSpeak && words[0]) extra.push(vocabEx.speak(words[0]));
  if (node.sents && node.sents.length) extra.push(sentEx.tiles(pick(rand, node.sents), node.sents, rand));
  const m = matchEx(rand, [...items, ...pool.filter((p) => !items.includes(p))].slice(0, 8), (x) => x.kana, (x) => x.de, 5, "vocab");
  if (m) extra.push(m);
  const head = intro.slice(0, Math.min(intro.length, 6));
  const fill = Math.max(0, size - head.length - extra.length);
  return [...head, ...shuffle([...second.slice(0, fill), ...extra], rand)].slice(0, size);
}

/* ---- LAP ---- */
const cardEx = {
  mc: (c, rand) => ({ type: "mc", mode: "card", ref: c.id, kind: "card", q: c.q, answer: c.a, options: opts(rand, c.a, c.x.slice(0, 3)), e: c.e || "", topic: c.topic }),
  /** Richtig/Falsch: die richtige Antwort ODER eine der falschen Antworten derselben Karte. */
  tf: (c, rand) => {
    const truth = rand() < 0.5 || !c.x.length;
    const shown = truth ? c.a : pick(rand, c.x);
    return { type: "tf", ref: c.id, kind: "card", q: c.q, claim: shown, answer: truth, right: c.a, e: c.e || "", topic: c.topic };
  },
};
function formulaEx(rand, f, all) {
  const others = distract(rand, all, f, (x) => x.f, 3);
  if (others.length < 3) return null;
  return rand() < 0.5
    ? { type: "mc", mode: "formula", kind: "formula", q: `Welche Formel gehört zu „${f.name}“? 📐`, answer: f.f, options: opts(rand, f.f, others.map((x) => x.f)), e: f.units }
    : { type: "mc", mode: "formula", kind: "formula", q: `Wofür steht diese Formel? 📐`, big: f.f, small: true, answer: f.name, options: opts(rand, f.name, distract(rand, all, f, (x) => x.name, 3).map((x) => x.name)), e: f.units };
}
function formulaTf(rand, f, all) {
  const truth = rand() < 0.5;
  const other = distract(rand, all, f, (x) => x.f, 1)[0];
  if (!other) return null;
  return { type: "tf", kind: "formula", q: `Stimmt die Formel für „${f.name}“?`, claim: truth ? f.f : other.f, answer: truth, right: f.f, e: f.units };
}
function numEx(type, rand, makeProblem) {
  const p = makeProblem(type, rand);
  return { type: "num", kind: "calc", ptype: p.type, q: p.text, ask: p.ask, unit: p.unit, answer: p.answer, tol: p.tol, steps: p.steps };
}

function lapLesson(node, rand, { makeProblem, size = 12, formulas: allF } = {}) {
  const formulas = allF || node.formulas || [];
  const ex = [];
  if (node.kind === "calc" || (node.type === "calc")) {
    const types = node.calc || [];
    if (makeProblem && types.length) for (let i = 0; i < 5; i++) ex.push(numEx(types[i % types.length], rand, makeProblem));
    const fs = types.map((t) => formulas.find((f) => f.id === CALC_FORMULA[t])).filter(Boolean);
    for (const f of fs) { const e = formulaEx(rand, f, formulas); if (e) ex.push(e); const t = formulaTf(rand, f, formulas); if (t) ex.push(t); }
    const m = matchEx(rand, [...fs, ...shuffle(formulas.filter((f) => !fs.includes(f)), rand)].slice(0, 4), (f) => f.name, (f) => f.f, 4, "formula");
    if (m) ex.push(m);
    return [ex[0], ...shuffle(ex.slice(1), rand)].filter(Boolean).slice(0, size);
  }
  const cards = shuffle(node.items || [], rand);
  cards.forEach((c) => ex.push(cardEx.mc(c, rand)));
  const extra = [];
  for (const c of shuffle(cards, rand).slice(0, 2)) extra.push(cardEx.tf(c, rand));
  const pairs = (node.pairs || []).filter((p) => short(p.l, 60) && short(p.r));
  if (pairs.length >= 4) { const m = matchEx(rand, pairs.map((p, i) => ({ ...p, id: null, k: i })), (p) => p.l, (p) => p.r, 4, "pairs"); if (m) extra.push(m); }
  const tf = formulas.filter((f) => f.topic === node.topic);
  if (tf.length) { const e = formulaEx(rand, pick(rand, tf), formulas); if (e) extra.push(e); }
  const keep = Math.max(6, size - extra.length);
  return [...ex.slice(0, 3), ...shuffle([...ex.slice(3, keep), ...extra], rand)].slice(0, size);
}

/** Einheiten-Prüfung: gemischt aus allen Inhalten der Einheit. */
function checkLesson(node, rand, ctx, isJp) {
  if (isJp && node.kind === "grammar") return grammarLesson(node, rand, ctx, true);
  const items = shuffle(node.items || [], rand);
  const size = 14;
  if (isJp) {
    const pool = items;
    const ex = [];
    items.forEach((it, i) => {
      if (it.kind === "kana") ex.push([kanaEx.k2r, kanaEx.r2k, kanaEx.type, ctx.canListen ? kanaEx.listen : kanaEx.k2r][i % 4](it, pool, rand));
      else ex.push([vocabEx.w2m, vocabEx.m2w, vocabEx.type, ctx.canListen ? vocabEx.listen : vocabEx.w2m][i % 4](it, pool, rand));
    });
    const m = items[0] && items[0].kind === "kana" ? matchEx(rand, items, (x) => x.kana, (x) => x.romaji, 5, "kana") : matchEx(rand, items, (x) => x.kana, (x) => x.de, 5, "vocab");
    return shuffle([...ex.slice(0, size - 1), ...(m ? [m] : [])], rand);
  }
  const ex = items.slice(0, 12).map((c, i) => (i % 4 === 3 ? cardEx.tf(c, rand) : cardEx.mc(c, rand)));
  const calc = node.calc || [];
  if (ctx.makeProblem) for (const t of shuffle(calc, rand).slice(0, ex.length ? 2 : 5)) ex.push(numEx(t, rand, ctx.makeProblem));
  if (!ex.length) return lapLesson({ kind: "calc", calc, formulas: ctx.formulas || [] }, rand, ctx);
  return shuffle(ex, rand).slice(0, size);
}

/**
 * Lektion bauen – deterministisch für denselben Seed.
 * @param {object} node  Knoten aus jpUnits/lapUnits (oder {type:"practice", module, items})
 * @param {{seed?:number, module:"jp"|"lap", canListen?:boolean, canSpeak?:boolean, makeProblem?:Function, formulas?:Array}} ctx
 * @returns {object[]} Übungen
 */
export function buildLesson(node, ctx = {}) {
  const rand = rng(ctx.seed == null ? Date.now() : ctx.seed);
  const isJp = ctx.module === "jp";
  if (!node) return [];
  if (node.type === "check") return checkLesson(node, rand, ctx, isJp);
  if (node.type === "practice") {
    const items = node.items || [];
    if (isJp) {
      const kana = items.filter((x) => x.kind === "kana"), words = items.filter((x) => x.kind === "vocab");
      const a = kana.length ? jpLesson({ kind: "kana", items: kana.slice(0, 8), pool: node.pool && node.pool.filter((x) => x.kind === "kana").length >= 4 ? node.pool.filter((x) => x.kind === "kana") : kana }, rand, { ...ctx, size: words.length ? 6 : 10 }) : [];
      const b = words.length ? jpLesson({ kind: "vocab", items: words.slice(0, 6), pool: node.pool && node.pool.filter((x) => x.kind === "vocab").length >= 4 ? node.pool.filter((x) => x.kind === "vocab") : words }, rand, { ...ctx, size: kana.length ? 6 : 10 }) : [];
      return shuffle([...a, ...b], rand).slice(0, 10);
    }
    return lapLesson({ kind: "cards", items: items.slice(0, 8), pairs: [], topic: null }, rand, { ...ctx, size: 10 });
  }
  if (isJp && node.kind === "grammar") return grammarLesson(node, rand, ctx);
  return isJp ? jpLesson(node, rand, ctx) : lapLesson(node, rand, ctx);
}

/* ================= Antworten prüfen (ohne Sprach-/Zahlenlogik – die kommt vom Modul) ================= */
const norm = (s) => String(s == null ? "" : s).normalize("NFKC").trim();
/** mc/tf/tiles: Antwort richtig? (type/num/speak prüft das Modul.) */
export function checkBasic(ex, value) {
  if (!ex) return false;
  if (ex.type === "mc") return norm(value) === norm(ex.answer);
  if (ex.type === "tf") return value === ex.answer || value === String(ex.answer);
  if (ex.type === "tiles") { const v = norm(Array.isArray(value) ? value.join("") : value); return v === norm(ex.answer) || (ex.answers || []).some((a) => norm(a) === v); }
  if (ex.type === "match") return true; // Paare werden einzeln geprüft (matchPair)
  return false;
}
/** Ein Paar beim Zuordnen prüfen. */
export const matchPair = (ex, l, r) => !!ex && ex.pairs.some((p) => p.l === l && p.r === r);
/** Text der richtigen Lösung (für „Richtig wäre: …“). */
export function solutionText(ex, fmtNum = (x) => String(x)) {
  if (!ex) return "";
  if (ex.type === "tf") return ex.answer ? "Stimmt ✔️" : `Stimmt nicht – richtig: ${ex.right}`;
  if (ex.type === "num") return `${fmtNum(ex.answer, ex)} ${ex.unit}`;
  if (ex.type === "type" || ex.type === "speak") return `${ex.answer}${ex.big && ex.big !== ex.answer ? ` (${ex.big})` : ""}`;
  return String(ex.show || ex.answer);
}

/* ================= Ablauf einer Lektion ================= */
export const MAX_REQUEUE = 2;
/** Lauf starten. */
export function startRun(exercises, { mode = "lesson" } = {}) {
  const queue = exercises.map((e, i) => ({ ...e, key: i }));
  return { queue, pos: 0, total: queue.length, solved: [], mistakes: 0, combo: 0, maxCombo: 0, requeued: {}, wrong: {}, refs: {}, mode, ok: 0 };
}
export const runCurrent = (run) => (run && run.pos < run.queue.length ? run.queue[run.pos] : null);
/**
 * Antwort auf die aktuelle Übung verbuchen. Falsch → dieselbe Übung kommt am Ende nochmal (höchstens MAX_REQUEUE-mal; nicht im Modus "train").
 * refs: SRS-Ergebnis je Lernobjekt (false, sobald einmal falsch).
 */
export function answerRun(run, correct) {
  const ex = runCurrent(run);
  if (!ex) return run;
  const r = { ...run, queue: run.queue.slice(), solved: run.solved.slice(), requeued: { ...run.requeued }, wrong: { ...run.wrong }, refs: { ...run.refs } };
  const refs = ex.type === "match" ? ex.pairs.map((p) => p.ref).filter(Boolean) : ex.ref ? [ex.ref] : [];
  if (correct) {
    r.combo = run.combo + 1;
    r.maxCombo = Math.max(run.maxCombo, r.combo);
    r.ok = run.ok + 1;
    if (!r.solved.includes(ex.key)) r.solved.push(ex.key);
    for (const id of refs) if (!(id in r.refs)) r.refs[id] = true;
  } else {
    r.mistakes = run.mistakes + 1;
    r.combo = 0;
    r.wrong[ex.key] = (r.wrong[ex.key] || 0) + 1;
    for (const id of refs) r.refs[id] = false;
    // 🏋️ freies Üben ("train"): kein Nachreichen – dafür „Fehler nochmal üben“ am Ende
    if (run.mode !== "train" && (r.requeued[ex.key] || 0) < MAX_REQUEUE) { r.requeued[ex.key] = (r.requeued[ex.key] || 0) + 1; r.queue.push({ ...ex }); }
    else if (!r.solved.includes(ex.key)) r.solved.push(ex.key); // aufgeben, damit die Lektion endet
  }
  return r;
}
export const nextRun = (run) => ({ ...run, pos: run.pos + 1 });
/** Übung überspringen (z. B. „Kann gerade nicht sprechen“) – zählt weder richtig noch falsch. */
export function skipRun(run) {
  const ex = runCurrent(run);
  if (!ex) return run;
  return { ...run, solved: run.solved.includes(ex.key) ? run.solved : [...run.solved, ex.key], pos: run.pos + 1 };
}
/** Endlos-Üben: weitere Übungen hinten anhängen (neue Schlüssel). */
export function extendRun(run, exercises) {
  const add = exercises.map((e, i) => { const x = { ...e }; delete x.key; return { ...x, key: run.total + i }; });
  return { ...run, queue: [...run.queue, ...add], total: run.total + add.length };
}
/** „Fehler nochmal üben“: jede falsch beantwortete Übung einmal (Antworten neu gemischt). */
export function mistakeExercises(run, seed = 1) {
  const rand = rng(seed);
  const out = [];
  const seen = new Set();
  for (const e of run.queue) {
    if (!run.wrong[e.key] || seen.has(e.key)) continue;
    seen.add(e.key);
    const x = { ...e };
    delete x.key;
    if (Array.isArray(x.options)) x.options = shuffle(x.options, rand);
    if (Array.isArray(x.tiles)) x.tiles = shuffle(x.tiles, rand);
    if (x.type === "match") { x.left = shuffle(x.left, rand); x.right = shuffle(x.right, rand); }
    out.push(x);
  }
  return out;
}
export const runDone = (run) => !!run && run.pos >= run.queue.length;
/** Fortschrittsbalken 0–1 (zählt nur gelöste Übungen, wie bei Duolingo). */
export const runProgress = (run) => (run && run.total ? Math.min(1, run.solved.length / run.total) : 0);
/** Genauigkeit in % (richtige Antworten / alle Antworten). */
export const runAccuracy = (run) => { const n = run.ok + run.mistakes; return n ? Math.round((run.ok / n) * 100) : 100; };

/* ================= Belohnungen ================= */
/** XP & Edelsteine für eine fertige Lektion. kind: "lesson" | "check" | "practice" */
export function lessonRewards({ mistakes = 0, maxCombo = 0, kind = "lesson" } = {}) {
  const perfect = mistakes === 0;
  const base = kind === "check" ? XP.check : kind === "practice" ? XP.practice : XP.lesson;
  const combo = Math.min(XP.comboMax, Math.floor(maxCombo / XP.comboStep) * XP.comboXp);
  const xp = base + (perfect ? XP.perfect : 0) + combo;
  const gems = GEMS.lesson + (perfect ? GEMS.perfect : 0) + (kind === "check" ? GEMS.check : 0);
  return { xp, gems, perfect, combo };
}

/**
 * Fertige Lektion übernehmen → { mod, me, crown, first }.
 * node.type "check" mit jump:true (Einheit überspringen) schaltet alle Knoten der Einheit frei.
 */
export function applyLesson(modDoc, meDoc, { node, unit = null, rewards, ok = 0, day, now = Date.now(), jump = false }) {
  const mod = readMod(modDoc, modDoc && modDoc.id);
  const me = readMe(meDoc);
  let crown = 0, first = false;
  if (node && node.type !== "practice") {
    const cur = mod.nodes[node.id];
    first = !cur;
    crown = cur ? (rewards.perfect ? Math.min(3, (cur.c || 1) + 1) : cur.c || 1) : 1;
    mod.nodes[node.id] = { c: crown, p: (cur ? cur.p || 0 : 0) + (rewards.perfect ? 1 : 0), n: (cur ? cur.n || 0 : 0) + 1, at: now };
    if (jump && unit) for (const n of unit.nodes) if (!mod.nodes[n.id]) mod.nodes[n.id] = { c: 1, p: 0, n: 0, at: now, skip: 1 };
  }
  mod.xp[day] = (mod.xp[day] || 0) + rewards.xp;
  trimDays(mod.xp);
  me.gems = (me.gems || 0) + rewards.gems;
  me.ok = (me.ok || 0) + ok;
  me.lessons = (me.lessons || 0) + 1;
  if (rewards.perfect) me.perfect = (me.perfect || 0) + 1;
  me.last = mod.id;
  return { mod, me, crown, first };
}
/** 🎁 Schatzkiste öffnen (einmalig). */
export function openChest(modDoc, meDoc, node, day, now = Date.now()) {
  const mod = readMod(modDoc, modDoc && modDoc.id);
  const me = readMe(meDoc);
  if (mod.nodes[node.id]) return { mod, me, xp: 0, gems: 0, energy: 0 };
  mod.nodes[node.id] = { c: 1, p: 0, n: 1, at: now };
  mod.xp[day] = (mod.xp[day] || 0) + XP.chest;
  me.gems = (me.gems || 0) + GEMS.chest;
  const e = energyNow(me.energy, now, modeOf(me));
  let energy = 0;
  if (!isUnlimited(modeOf(me)) && e.n < CHEST_ENERGY_BELOW) { me.energy = gainEnergy(me.energy, now, CHEST_ENERGY, modeOf(me)); energy = me.energy.n - e.n; }
  return { mod, me, xp: XP.chest, gems: GEMS.chest, energy };
}
function trimDays(obj, keep = 400) {
  const keys = Object.keys(obj).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete obj[k];
}

/* ================= 🔋 Energie ================= */
/** 🔋 Energie-Modus (me.energyMode): Normal wie bisher · Entspannt (Fehler nur −1, +1 alle 10 min) · Unbegrenzt (∞, kein Verbrauch). */
export const ENERGY_MODES = [
  { id: "normal", emoji: "🔋", name: "Normal", d: `Antwort −${ENERGY_COST}, Fehler −${ENERGY_WRONG}, +1 alle 30 min` },
  { id: "entspannt", emoji: "🌿", name: "Entspannt", d: "Fehler kosten nur 1, +1 alle 10 min" },
  { id: "unbegrenzt", emoji: "♾️", name: "Unbegrenzt", d: "Kein Verbrauch – üb so viel du willst" },
];
export const RELAX_REFILL_MS = 10 * 60 * 1000;
/** Gültiger Modus aus me (Standard „normal“). */
export const modeOf = (me) => { const m = me && me.energyMode; return ENERGY_MODES.some((x) => x.id === m) ? m : "normal"; };
export const refillMs = (mode = "normal") => (mode === "entspannt" ? RELAX_REFILL_MS : REFILL_MS);
export const isUnlimited = (mode) => mode === "unbegrenzt";
/** Energie in Prozent (0–100, gerundet). */
export const energyPct = (n) => Math.max(0, Math.min(100, Math.round((Number(n) || 0) / MAX_ENERGY * 100)));
/** „76 %“ */
export const fmtEnergyPct = (n) => `${energyPct(n)} %`;
/**
 * Aktueller Stand inkl. Nachladen (+1 alle 30 min bzw. 10 min im Modus Entspannt) und 🌅 Tages-Auffüllung (erster Besuch an einem neuen Tag → voll).
 * e = { n, at, day } → { n, at, day, nextIn (ms bis +1, 0 wenn voll), fresh (true = heute frisch aufgefüllt), inf (Modus Unbegrenzt) }
 */
export function energyNow(e, now = Date.now(), mode = "normal") {
  const today = dayKey(new Date(now));
  if (isUnlimited(mode)) return { ...energyNow(e, now, "normal"), n: MAX_ENERGY, nextIn: 0, inf: true };
  const R = refillMs(mode);
  if (!e || typeof e !== "object" || e.day !== today) return { n: MAX_ENERGY, at: 0, day: today, nextIn: 0, fresh: !!(e && e.day && e.day !== today && Number(e.n) < MAX_ENERGY) };
  const raw = e.n != null ? Number(e.n) : MAX_ENERGY;
  let n = Math.max(0, Math.min(MAX_ENERGY, Number.isFinite(raw) ? Math.floor(raw) : MAX_ENERGY));
  let at = Number(e.at) || 0;
  if (n >= MAX_ENERGY) return { n: MAX_ENERGY, at: 0, day: today, nextIn: 0, fresh: false };
  if (!at) at = now;
  const gained = Math.floor(Math.max(0, now - at) / R);
  n = Math.min(MAX_ENERGY, n + gained);
  at += gained * R;
  return { n, at: n >= MAX_ENERGY ? 0 : at, day: today, nextIn: n >= MAX_ENERGY ? 0 : R - (now - at), fresh: false };
}
/** Anzeige: { inf, n, pct, text:"76 %"|"∞", sub:"19/25", nextIn, low } */
export function energyView(meDoc, now = Date.now()) {
  const me = readMe(meDoc);
  const mode = modeOf(me);
  const h = energyNow(me.energy, now, mode);
  if (h.inf) return { inf: true, mode, n: MAX_ENERGY, pct: 100, text: "∞", sub: "unbegrenzt", nextIn: 0, low: false };
  return { inf: false, mode, n: h.n, pct: energyPct(h.n), text: fmtEnergyPct(h.n), sub: `${h.n}/${MAX_ENERGY}`, nextIn: h.nextIn, low: h.n < ENERGY_START };
}
/**
 * Eine beantwortete Übung verbuchen: richtig −1, falsch −2 (Entspannt: −1, Unbegrenzt: 0). combo = richtige in Folge NACH dieser Antwort;
 * alle COMBO_EVERY richtigen +COMBO_ENERGY (nie über voll, kein Bonus bei 0, nicht bei Unbegrenzt). → { energy, cost, bonus }
 */
export function spendEnergy(e, { correct = true, combo = 0, mode = "normal" } = {}, now = Date.now()) {
  if (isUnlimited(mode)) { const c = energyNow(e, now); return { energy: { n: c.n, at: c.at, day: c.day }, cost: 0, bonus: 0 }; }
  const c = energyNow(e, now, mode);
  const cost = Math.min(c.n, correct || mode === "entspannt" ? ENERGY_COST : ENERGY_WRONG);
  let n = c.n - cost;
  let bonus = 0;
  if (correct && n > 0 && combo > 0 && combo % COMBO_EVERY === 0) { bonus = Math.min(COMBO_ENERGY, MAX_ENERGY - n); n += bonus; }
  const energy = { n, at: n >= MAX_ENERGY ? 0 : c.at || now, day: c.day };
  return { energy, cost, bonus };
}
/** Energie dazugeben (Üben, Schatzkiste). */
export function gainEnergy(e, now = Date.now(), k = 1, mode = "normal") {
  const c = energyNow(e, now, isUnlimited(mode) ? "normal" : mode);
  const n = Math.min(MAX_ENERGY, c.n + Math.max(0, k));
  return { n, at: n >= MAX_ENERGY ? 0 : c.at, day: c.day };
}
/** Genug Energie, um eine Lektion zu starten? (Unbegrenzt: immer) */
export const canStart = (e, now = Date.now(), mode = "normal") => isUnlimited(mode) || energyNow(e, now, mode).n >= ENERGY_START;
/** Energie leer → „Keine Energie mehr“-Bildschirm? (Unbegrenzt: nie) */
export const isOut = (e, now = Date.now(), mode = "normal") => !isUnlimited(mode) && energyNow(e, now, mode).n <= 0;
/** 🏋️ Üben: +1 je richtiger Antwort, höchstens PRACTICE_ENERGY_MAX pro Runde. gained = bisher in dieser Runde. → { energy, add } */
export function practiceGain(e, gained = 0, now = Date.now(), mode = "normal") {
  const c = energyNow(e, now, isUnlimited(mode) ? "normal" : mode);
  const add = isUnlimited(mode) || gained >= PRACTICE_ENERGY_MAX || c.n >= MAX_ENERGY ? 0 : 1;
  return { energy: add ? gainEnergy(e, now, add, mode) : { n: c.n, at: c.at, day: c.day }, add };
}
/** 🌅 Tages-Auffüllung speichern (erster Besuch an einem neuen Tag). → { me, refilled } (refilled nur, wenn vorher nicht voll) */
export function dailyRefill(meDoc, now = Date.now()) {
  const me = readMe(meDoc);
  const today = dayKey(new Date(now));
  if (me.energy.day === today) return { me, refilled: false };
  const c = energyNow(me.energy, now);
  return { me: { ...me, energy: { n: MAX_ENERGY, at: 0, day: today } }, refilled: c.fresh && !isUnlimited(modeOf(me)) };
}
/** Energie-Modus wechseln. */
export function setEnergyMode(meDoc, mode) {
  const me = readMe(meDoc);
  return { ...me, energyMode: ENERGY_MODES.some((m) => m.id === mode) ? mode : "normal" };
}
/** „🔋 Jetzt auffüllen (gratis)“: Entspannt jederzeit, Normal 1× am Tag, Unbegrenzt nicht nötig. → { ok, why? } */
export function canFreeRefill(meDoc, now = Date.now()) {
  const me = readMe(meDoc);
  const mode = modeOf(me);
  if (isUnlimited(mode)) return { ok: false, why: "unlimited" };
  if (energyNow(me.energy, now, mode).n >= MAX_ENERGY) return { ok: false, why: "full" };
  if (mode === "normal" && me.freeRefillDay === dayKey(new Date(now))) return { ok: false, why: "used" };
  return { ok: true };
}
export function freeRefill(meDoc, now = Date.now()) {
  const me = readMe(meDoc);
  const c = canFreeRefill(me, now);
  if (!c.ok) return { me, ok: false, why: c.why };
  const today = dayKey(new Date(now));
  return { me: { ...me, energy: { n: MAX_ENERGY, at: 0, day: today }, ...(modeOf(me) === "normal" ? { freeRefillDay: today } : {}) }, ok: true };
}

/* ================= 💎 Laden ================= */
export function buyFreeze(meDoc) {
  const me = readMe(meDoc);
  if ((me.freezes || 0) >= MAX_FREEZES) return { me, ok: false, why: "max" };
  if ((me.gems || 0) < FREEZE_COST) return { me, ok: false, why: "gems" };
  return { me: { ...me, gems: me.gems - FREEZE_COST, freezes: (me.freezes || 0) + 1 }, ok: true };
}
export function buyEnergy(meDoc, now = Date.now()) {
  const me = readMe(meDoc);
  if (isUnlimited(modeOf(me))) return { me, ok: false, why: "unlimited" };
  if (energyNow(me.energy, now, modeOf(me)).n >= MAX_ENERGY) return { me, ok: false, why: "full" };
  if ((me.gems || 0) < ENERGY_GEMS) return { me, ok: false, why: "gems" };
  return { me: { ...me, gems: me.gems - ENERGY_GEMS, energy: { n: MAX_ENERGY, at: 0, day: dayKey(new Date(now)) } }, ok: true };
}

/* ================= 🏋️ Üben (eigener Reiter): frei, gratis, unabhängig vom Fortschritt ================= */
export const TRAIN_XP_DAY = 50;           // höchstens 50 XP am Tag aus dem freien Üben (+1 je richtiger Antwort)
export const TRAIN_LENGTHS = [10, 20, 50, 0]; // 0 = endlos
export const TRAIN_BATCH = 10;            // Endlos: so viele Übungen werden jeweils nachgelegt
const lessonNodes = (units) => units.flatMap((u) => u.nodes.filter((n) => n.type === "lesson"));
/** Alle Lernobjekte (eindeutig nach id) einer Knotenliste. */
export function trainItems(nodes) {
  const seen = new Set();
  const out = [];
  for (const n of nodes) for (const it of n.items || []) { const k = it.id || it; if (!seen.has(k)) { seen.add(k); out.push(it); } }
  return out;
}
/**
 * Quelle → Knoten, aus denen geübt wird (auch gesperrte Einheiten!).
 * src = { kind: "all" | "unit" | "topic" | "weak" | "random", id? }
 * units = Einheiten des Pfads, all = alle Einheiten (LAP: alle Lehrjahre), topics = [{ id, title, items:[{ id, label, emoji, nodes }] }], weak = SRS-Fehler/fällige Objekte
 * → { nodes, label, unit? }
 */
export function trainSource(src, { units = [], all = null, topics = [], weak = [], seed = 1 } = {}) {
  const pool = all || units;
  const kind = (src && src.kind) || "all";
  if (kind === "unit") {
    const u = units.find((x) => x.id === src.id) || pool.find((x) => x.id === src.id);
    return u ? { nodes: lessonNodes([u]), label: `${u.emoji} ${u.title}`, unit: u.id } : { nodes: [], label: "" };
  }
  if (kind === "topic") {
    const t = topics.flatMap((g) => g.items).find((x) => x.id === src.id);
    return t ? { nodes: t.nodes, label: `${t.emoji} ${t.label}` } : { nodes: [], label: "" };
  }
  if (kind === "weak") {
    const nodes = chunk(weak, 8).map((items, i) => ({ type: "practice", id: `weak-${i}`, title: "Meine Fehler", items, pool: weak }));
    return { nodes, label: "🩹 Meine Fehler" };
  }
  if (kind === "random") {
    const cands = pool.filter((u) => lessonNodes([u]).length);
    if (!cands.length) return { nodes: [], label: "" };
    const u = pick(rng(seed), cands);
    return { nodes: lessonNodes([u]), label: `🎲 ${u.emoji} ${u.title}`, unit: u.id };
  }
  return { nodes: lessonNodes(pool), label: "🌈 Alles gemischt" };
}
const exKey = (e) => `${e.type}|${e.mode || ""}|${e.ref || e.q}|${e.big || e.claim || ""}`;
/**
 * Übungs-Set aus Knoten bauen (gleiche Übungsarten wie im Pfad, über buildLesson): aus jedem Knoten ein paar Übungen, gemischt.
 * Deterministisch für denselben Seed. size = gewünschte Anzahl.
 */
export function buildTraining(nodes, ctx = {}, { size = 10, seed = Date.now() } = {}) {
  const rand = rng(seed);
  const list = (nodes || []).filter(Boolean);
  if (!list.length || !(size > 0)) return [];
  const order = shuffle(list, rand);
  const per = Math.max(2, Math.min(6, Math.ceil(size / order.length)));
  const out = [];
  const seen = new Set();
  const rounds = order.length * 4 + size;
  for (let i = 0; out.length < size && i < rounds; i++) {
    const n = order[i % order.length];
    const ex = buildLesson(n, { ...ctx, seed: Math.floor(rand() * 2147483647) });
    let took = 0;
    for (const e of shuffle(ex, rand)) {
      if (took >= per || out.length >= size) break;
      const k = exKey(e);
      if (seen.has(k) && i < order.length * 2) continue; // erst wiederholen, wenn es nichts Neues mehr gibt
      seen.add(k);
      out.push(e.hint ? { ...e, hintOpen: false } : e);
      took++;
    }
  }
  return shuffle(out, rand).slice(0, size);
}
/** Übrige Übe-XP heute. */
export const trainXpLeft = (meDoc, day) => { const me = readMe(meDoc); return Math.max(0, TRAIN_XP_DAY - (me.train.day === day ? Number(me.train.xp) || 0 : 0)); };
/** Freies Üben verbuchen: +1 XP je richtiger Antwort (max. 50/Tag), zählt fürs Tagesziel/Serie und „100 Fragen richtig“. → { mod, me, xp, capped } */
export function applyTraining(modDoc, meDoc, { ok = 0, day, now = Date.now() } = {}) {
  const mod = readMod(modDoc, modDoc && modDoc.id);
  const me = readMe(meDoc);
  const used = me.train.day === day ? Number(me.train.xp) || 0 : 0;
  const want = Math.max(0, ok) * XP.train;
  const xp = Math.max(0, Math.min(want, TRAIN_XP_DAY - used));
  if (xp) { mod.xp[day] = (mod.xp[day] || 0) + xp; trimDays(mod.xp); }
  me.train = { day, xp: used + xp, at: now };
  me.ok = (me.ok || 0) + Math.max(0, ok);
  me.last = mod.id;
  return { mod, me, xp, capped: want > xp };
}
/** 🇯🇵 Themen zum Üben: Kana-Reihen (Hiragana/Katakana), Wortschatz-Themen, Grammatik-Punkte. */
export function jpTrainTopics(units) {
  const rows = (tag) => units.filter((u) => u.tag === tag).flatMap((u) => u.nodes.filter((n) => n.type === "lesson")
    .map((n) => ({ id: `row:${n.id}`, label: n.title, emoji: n.emoji, nodes: [n], jp: true, count: (n.items || []).length })));
  const voc = new Map();
  for (const u of units.filter((x) => x.kind === "vocab")) {
    const topic = (u.items[0] && u.items[0].topic) || u.title;
    if (!voc.has(topic)) voc.set(topic, { id: `voc:${topic}`, label: topic, emoji: u.emoji, nodes: [], count: 0 });
    const t = voc.get(topic);
    t.nodes.push(...lessonNodes([u])); t.count += u.items.length;
  }
  const gr = units.filter((u) => u.kind === "grammar").map((u) => ({ id: `gr:${u.id}`, label: u.title.replace(/^📐\s*/, ""), emoji: u.emoji, nodes: lessonNodes([u]), count: u.items.length }));
  return [
    { id: "hira", title: "🎌 Hiragana-Reihen", items: rows("hira") },
    { id: "kata", title: "🗾 Katakana-Reihen", items: rows("kata") },
    { id: "voc", title: "📚 Wortschatz-Themen", items: [...voc.values()] },
    { id: "gr", title: "📐 Grammatik", items: gr },
  ].filter((g) => g.items.length);
}
/** 🎓 Themen zum Üben: je Lehrjahr, je LAP-Thema (alle Lehrjahre, inkl. passender Rechenaufgaben), alle Rechenaufgaben. */
export function lapTrainTopics({ cards, topics, problemTypes, formulas = [], pairs = {} }) {
  const valid = cards.filter((c) => c && Array.isArray(c.x) && c.x.length >= 1);
  const calcNodes = (types, topic) => {
    const out = [];
    for (let i = 0; i < types.length; i += 2) out.push({ type: "lesson", kind: "calc", id: `tr-calc-${topic}-${i}`, title: "Rechnen", emoji: "🔢", calc: types.slice(i, i + 2), topic, pairs: [], formulas, pool: [] });
    return out;
  };
  const years = [1, 2, 3].map((y) => {
    const us = lapUnits({ cards, topics, problemTypes, year: y, formulas, pairs });
    return { id: `y${y}`, label: `${y}. Lehrjahr`, emoji: "🎓", nodes: lessonNodes(us), count: valid.filter((c) => (Number(c.year) || 1) === y).length };
  }).filter((t) => t.nodes.length);
  const tps = topics.map((tp) => {
    const list = valid.filter((c) => c.topic === tp.id);
    const types = problemTypes.filter((t) => CALC_TOPIC[t.id] === tp.id).map((t) => t.id);
    const nodes = [
      ...chunk(list, 8).map((items, i) => ({ type: "lesson", kind: "cards", id: `tr-${tp.id}-${i}`, title: tp.name, emoji: tp.emoji, items, topic: tp.id, pairs: pairs[tp.id] || [], formulas, pool: list })),
      ...calcNodes(types, tp.id),
    ];
    return { id: `t:${tp.id}`, label: tp.name, emoji: tp.emoji, nodes, count: list.length };
  }).filter((t) => t.nodes.length);
  const calc = { id: "calc", label: "Rechenaufgaben (alle)", emoji: "🔢", nodes: calcNodes(problemTypes.map((t) => t.id), "calc"), count: problemTypes.length };
  return [
    { id: "years", title: "🎓 Lehrjahr", items: years },
    { id: "topics", title: "📚 Themen", items: tps },
    { id: "calc", title: "🔢 Rechnen", items: calc.nodes.length ? [calc] : [] },
  ].filter((g) => g.items.length);
}

/* ================= 🔥 Serie & ⚡ XP ================= */
/**
 * Lern-Tage aus allen Quellen: XP im Lernpfad (beide Module) + klassische Übungen (jp_stats/lap_stats) + 🧊 geschützte Tage.
 * → { days: { Tag: { n } } } (Format von srs-core streak)
 */
export function learnDays({ mods = [], stats = [], me = null } = {}) {
  const days = {};
  const add = (k, v) => { if (v > 0) days[k] = { n: ((days[k] && days[k].n) || 0) + v }; };
  for (const m of mods) if (m && m.xp) for (const [k, v] of Object.entries(m.xp)) add(k, Number(v) || 0);
  for (const s of stats) if (s && s.days) for (const [k, v] of Object.entries(s.days)) add(k, Number(v && v.n) || 0);
  if (me && me.frozen) for (const k of Object.keys(me.frozen)) if (me.frozen[k]) add(k, 1);
  return { days };
}
export const learnStreak = (src, today = dayKey()) => srsStreak(learnDays(src), today);
export const activeToday = (src, today = dayKey()) => !!(learnDays(src).days[today]);
/**
 * 🧊 Serien-Schutz einlösen: fehlen seit dem letzten Lern-Tag bis gestern höchstens so viele Tage, wie Schutz da ist,
 * werden diese Tage geschützt (Serie bleibt). → { me, used }
 */
export function applyFreezes(src, today = dayKey()) {
  const me = readMe(src.me);
  if (!(me.freezes > 0)) return { me, used: 0 };
  const { days } = learnDays({ ...src, me });
  const yesterday = addDays(today, -1);
  if (days[yesterday]) return { me, used: 0 };
  let k = yesterday, gap = [];
  while (!days[k] && gap.length <= me.freezes) { gap.push(k); k = addDays(k, -1); }
  if (!days[k] || gap.length > me.freezes) return { me, used: 0 }; // keine Serie da oder Lücke zu groß
  const frozen = { ...me.frozen };
  for (const g of gap) frozen[g] = true;
  return { me: { ...me, frozen, freezes: me.freezes - gap.length }, used: gap.length };
}
export function xpOn(mods, day) { return mods.reduce((s, m) => s + ((m && m.xp && Number(m.xp[day])) || 0), 0); }
/** XP der letzten 7 Tage (ältester zuerst). */
export function weekXp(mods, today = dayKey()) {
  const out = [];
  for (let i = 6; i >= 0; i--) { const day = addDays(today, -i); out.push({ day, xp: xpOn(mods, day) }); }
  return out;
}
/** Persönliche „Liga“: diese Woche (Mo–So) gegen deine letzten Wochen. → { now, best, last:[…4 Wochen] } */
export function weekLeague(mods, today = dayKey()) {
  const [y, m, d] = today.split("-").map(Number);
  const wd = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // Mo = 0
  const monday = addDays(today, -wd);
  const sumWeek = (mon) => { let s = 0; for (let i = 0; i < 7; i++) s += xpOn(mods, addDays(mon, i)); return s; };
  const last = [1, 2, 3, 4].map((w) => sumWeek(addDays(monday, -7 * w)));
  return { now: sumWeek(monday), best: Math.max(0, ...last), last };
}
export const totalXp = (mods) => mods.reduce((s, m) => s + Object.values((m && m.xp) || {}).reduce((a, b) => a + (Number(b) || 0), 0), 0);

/* ================= 🏆 Abzeichen ================= */
export const ACHIEVEMENTS = [
  { id: "first", e: "🌱", t: "Erste Lektion", d: "Deine erste Lektion geschafft", test: (c) => c.lessons >= 1 },
  { id: "streak3", e: "🔥", t: "3 Tage Serie", d: "3 Tage am Stück gelernt", test: (c) => c.streak >= 3 },
  { id: "streak7", e: "🔥", t: "7 Tage Streak", d: "Eine ganze Woche dabei", test: (c) => c.streak >= 7 },
  { id: "streak30", e: "🌋", t: "30 Tage Streak", d: "Ein Monat ohne Pause", test: (c) => c.streak >= 30 },
  { id: "ok100", e: "💯", t: "100 Fragen richtig", d: "100 richtige Antworten im Lernpfad", test: (c) => c.ok >= 100 },
  { id: "perfect10", e: "✨", t: "10 perfekte Lektionen", d: "Ohne einen Fehler – 10 Mal", test: (c) => c.perfect >= 10 },
  { id: "xp1000", e: "⚡", t: "1000 XP", d: "1000 XP gesammelt", test: (c) => c.xp >= 1000 },
  { id: "crown3", e: "👑", t: "Goldkrone", d: "Eine Lektion auf Kronen-Stufe 3", test: (c) => c.crown3 },
  { id: "hira", e: "🎌", t: "Hiragana gemeistert", d: "Alle Hiragana-Einheiten geschafft", test: (c) => c.tags.includes("hira") },
  { id: "kata", e: "🗾", t: "Katakana gemeistert", d: "Alle Katakana-Einheiten geschafft", test: (c) => c.tags.includes("kata") },
  { id: "lap1u1", e: "🎓", t: "1. Lehrjahr Einheit 1", d: "Die erste LAP-Einheit im 1. Lehrjahr geschafft", test: (c) => c.tags.includes("lap-y1-u1") },
];
/** Neu verdiente Abzeichen. ctx = { lessons, streak, ok, perfect, xp, crown3, tags[] } */
export function newAchievements(meDoc, ctx) {
  const me = readMe(meDoc);
  const c = { lessons: 0, streak: 0, ok: 0, perfect: 0, xp: 0, crown3: false, tags: [], ...ctx };
  return ACHIEVEMENTS.filter((a) => !me.ach[a.id] && a.test(c)).map((a) => a.id);
}
/** Tag für „1. Lehrjahr Einheit 1“: erste Einheit des 1. Lehrjahrs komplett. */
export function lapTags(units, mod) {
  const u = units.find((x) => x.year === 1);
  return u && unitProgress(u, mod).complete ? ["lap-y1-u1"] : [];
}
export const hasCrown3 = (mods) => mods.some((m) => m && m.nodes && Object.values(m.nodes).some((n) => n && n.c >= 3));

/* ================= 🔔 Erinnerung ================= */
/**
 * Ab 18:00: Serie in Gefahr? (Serie ≥ 1 bis gestern, heute noch nichts gelernt) → Hinweis für die Benachrichtigungszentrale, sonst null.
 * docs = learn_progress-Dokumente, stats = [jp_stats "me", lap_stats "me"]
 */
export function learnReminder({ docs = [], stats = [], now = Date.now() } = {}) {
  const d = new Date(now);
  if (d.getHours() < 18) return null;
  const today = dayKey(d);
  const me = readMe(docs.find((x) => x && x.id === "me"));
  const mods = docs.filter((x) => x && (x.id === "jp" || x.id === "lap"));
  const src = { mods, stats, me };
  if (activeToday(src, today)) return null;
  const st = learnStreak(src, today);
  if (st < 1) return null;
  const goal = me.goal ? goalXp(me.goal) : 0;
  return {
    id: `learn:${today}`, kind: "lernen", emoji: "🔥",
    title: `Deine Lern-Serie (${st} ${st === 1 ? "Tag" : "Tage"}) ist in Gefahr`,
    sub: (me.freezes > 0 ? "🧊 Serien-Schutz ist bereit – aber " : "") + `eine kurze Lektion${goal ? ` (Tagesziel ${goal} XP)` : ""} reicht 💪`,
    when: now, prio: 1, target: me.last === "jp" ? "#alltag/japanisch" : "#alltag/lap",
  };
}
