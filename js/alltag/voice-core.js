// Alltag › Claude-Assistent › Sprache: reine Hilfsfunktionen (ohne DOM, in Node testbar).
//   speakable(text)  – Antworttext so umformen, dass ihn speechSynthesis gut vorliest
//   matchWake(text)  – „Hey Claude …“ erkennen (unscharf), Rest des Satzes liefern
//   isStopPhrase(t)  – „Stopp“, „Danke“, „Tschüss“ … beendet den Gesprächsmodus
//   rankVoices(list) – deutsche Stimmen sortiert (natürlich/neural/Google zuerst)
//   splitChunks(t)   – lange Texte in Sätze zerlegen (Chrome bricht lange Äußerungen ab)

export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WD = { Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch", Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag" };

export const VOICE_DEFAULTS = Object.freeze({
  voiceURI: "", rate: 1.05, pitch: 1, readAloud: false, short: true, wake: false, wakeGranted: false,
});

/** Gespeicherte Werte prüfen und auf erlaubte Bereiche begrenzen. */
export function normVoice(v) {
  const o = v && typeof v === "object" ? v : {};
  const num = (x, lo, hi, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    voiceURI: typeof o.voiceURI === "string" ? o.voiceURI.slice(0, 300) : "",
    rate: num(o.rate, 0.6, 1.6, VOICE_DEFAULTS.rate),
    pitch: num(o.pitch, 0.5, 1.5, VOICE_DEFAULTS.pitch),
    readAloud: o.readAloud === true,
    short: o.short !== false,
    wake: o.wake === true,
    wakeGranted: o.wakeGranted === true,
  };
}

/* ---------- Vorlesetext ---------- */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function sayDuration(sign, h, m) {
  const H = Number(h), M = Number(m);
  const parts = [];
  if (H) parts.push(plural(H, "Stunde", "Stunden"));
  if (M || !H) parts.push(plural(M, "Minute", "Minuten"));
  const pre = sign === "+" ? "plus " : sign ? "minus " : "";
  return pre + parts.join(" ");
}

function sayTime(h, m) {
  const H = Number(h), M = Number(m);
  return M ? `${H} Uhr ${M}` : `${H} Uhr`;
}

function sayMoney(sign, int, dec, cur) {
  const big = cur === "€" ? "Euro" : "Dollar";
  const I = Number(String(int).replace(/[.\s ]/g, ""));
  const C = dec ? Number((dec + "0").slice(0, 2)) : 0;
  const pre = sign ? "minus " : "";
  if (!I && C) return `${pre}${C} Cent`;
  return pre + (C ? `${I} ${big} ${C}` : `${I} ${big}`);
}

/** Antworttext → gut vorlesbarer Fließtext (ohne Markdown, Listen als kurze Sätze, Zahlen ausgeschrieben). */
export function speakable(text) {
  let s = String(text == null ? "" : text).replace(/\r/g, "");
  // Markdown
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1");
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
  s = s.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s*>\s?/gm, "");
  s = s.replace(/^\s*(?:[-*_]\s*){3,}$/gm, "");
  s = s.replace(/\|/g, ", ");
  // Emojis, Häkchen, Pfeile
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}✓✔✗✘]/gu, "");
  s = s.replace(/\s*(?:→|=>|->)\s*/g, ", dann ");
  s = s.replace(/≈\s*/g, "ungefähr ");
  s = s.replace(/\s&\s/g, " und ");

  // Zeilen / Aufzählungen → Sätze
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    l = l.replace(/^(?:[-•*+–]|\d{1,2}[.)])\s+/, "");
    l = l.replace(/[\s:;,]+$/, "");
    if (!l) return "";
    return /[.!?…]$/.test(l) ? l : l + ".";
  }).filter(Boolean);
  s = lines.join(" ");

  // Abkürzungen
  const ABBR = [[/\bz\.\s?B\./g, "zum Beispiel"], [/\bu\.\s?a\./g, "unter anderem"], [/\bd\.\s?h\./g, "das heißt"],
    [/\bbzw\./g, "beziehungsweise"], [/\busw\./g, "und so weiter"], [/\bca\./g, "circa"], [/\binkl\./g, "inklusive"],
    [/\bexkl\./g, "exklusive"], [/\bggf\./g, "gegebenenfalls"], [/\bevtl\./g, "eventuell"], [/\bNr\./g, "Nummer"],
    [/\bStk\./g, "Stück"], [/\bvs\./g, "gegen"], [/\bmax\./g, "maximal"], [/\bmin\.(?=\s)/g, "mindestens"]];
  for (const [re, w] of ABBR) s = s.replace(re, w);

  // Geld: „1.234,56 €“, „€ 12,50“, „-5 €“, „0,42 $“
  s = s.replace(/(^|[\s(:–-])([-−])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}|-{1,2}))?\s?(€|\$|EUR\b|Euro\b)/g,
    (_, pre, sg, i, d, c) => pre + sayMoney(sg, i, d && /\d/.test(d) ? d : "", c === "$" ? "$" : "€"));
  s = s.replace(/(€|EUR)\s?([-−])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, (_, c, sg, i, d) => sayMoney(sg, i, d, "€"));

  // Dauer: „4:30 h“, „+2:15 h“, „−0:45 Std.“
  s = s.replace(/(^|[^\d:])([+\-−]?)(\d{1,4}):([0-5]\d)\s?(?:h|Std\.?|Stunden)(?![a-zäöüß])/gi,
    (_, pre, sg, h, m) => pre + sayDuration(sg === "+" ? "+" : sg ? "-" : "", h, m));
  // „38,5 h“, „1 h“, „30 min“
  s = s.replace(/(\d+(?:,\d+)?)\s?(?:h|Std\.?)(?![a-zäöüß])/g, (_, n) => (n === "1" ? "1 Stunde" : `${n} Stunden`));
  s = s.replace(/(\d+)\s?(?:min|Min\.?)(?![a-zäöüß])/g, (_, n) => (n === "1" ? "1 Minute" : `${n} Minuten`));

  // Uhrzeiten: „7:00–15:30“, „um 7:30 Uhr“, „14:05“
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?Uhr)?\s?[–—-]\s?([01]?\d|2[0-3]):([0-5]\d)(?:\s?Uhr)?/g,
    (_, a, b, c, d) => `${sayTime(a, b)} bis ${sayTime(c, d)}`);
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?:\s?Uhr\b)?/g, (_, h, m) => sayTime(h, m));

  // Datum: „Mo, 05.11.2026“, „5.11.“
  s = s.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\.?,?\s+(?=\d{1,2}\.\d{1,2}\.)/g, (_, w) => WD[w] + ", ");
  s = s.replace(/\b(\d{1,2})\.(\d{1,2})\.(?:(\d{4})\b)?/g, (all, d, m, y, off, str) => {
    const D = Number(d), M = Number(m);
    if (D < 1 || D > 31 || M < 1 || M > 12) return all;
    // „ab 2.1.“ am Satzende: der Punkt war auch das Satzende
    const after = str.slice(off + all.length);
    const end = !y && (after === "" || /^\s+[A-ZÄÖÜ]/.test(after)) ? "." : "";
    return `${D}. ${MONTHS[M - 1]}${y ? " " + y : ""}${end}`;
  });

  // Einheiten
  s = s.replace(/(\d)\s?%/g, "$1 Prozent");
  s = s.replace(/(\d)\s?km\b/g, "$1 Kilometer");
  s = s.replace(/(\d)\s?kWh\b/g, "$1 Kilowattstunden");
  s = s.replace(/(\d)\s?°C?(?![\p{L}])/gu, "$1 Grad");

  // Aufräumen
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\s+([.,!?;:])/g, "$1");
  s = s.replace(/([.!?])\.+/g, "$1");
  s = s.replace(/,\s*,/g, ",");
  s = s.replace(/\s{2,}/g, " ").trim();
  return s && !/[.!?…]$/.test(s) ? s + "." : s;
}

/** Text in vorlesbare Stücke (je ≤ max Zeichen, an Satzgrenzen). */
export function splitChunks(text, max = 180) {
  const sentences = String(text || "").match(/[^.!?…]+[.!?…]*\s*/g) || [];
  const out = [];
  let cur = "";
  for (let sn of sentences) {
    sn = sn.trim();
    if (!sn) continue;
    while (sn.length > max) {
      let cut = sn.lastIndexOf(",", max);
      if (cut < max / 3) cut = sn.lastIndexOf(" ", max);
      if (cut < 1) cut = max;
      if (cur) { out.push(cur); cur = ""; }
      out.push(sn.slice(0, cut + 1).trim());
      sn = sn.slice(cut + 1).trim();
    }
    if (cur && (cur + " " + sn).length > max) { out.push(cur); cur = sn; }
    else cur = cur ? cur + " " + sn : sn;
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------- Erkennen ---------- */

/** Kleinbuchstaben, ohne Satzzeichen, einfache Leerzeichen. */
export function norm(t) {
  return String(t || "").toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/* ---------- Name des Assistenten & Weckwort ---------- */

export const DEFAULT_NAME = "Claude";

/** Nur Buchstaben, Leerzeichen, Bindestriche; max. 24 Zeichen; leer → "" */
export function sanitizeName(n) {
  return String(n == null ? "" : n).normalize("NFC").replace(/[^\p{L} -]+/gu, "").replace(/\s+/g, " ")
    .replace(/^[\s-]+|[\s-]+$/g, "").slice(0, 24).trim();
}

/** Kleinbuchstaben, Umlaute ausgeschrieben, Akzente weg. */
export function fold(w) {
  return String(w || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

/** grobe Lautform: c/ck/q→k, w→v, y→i, ou/ow→au, Doppelbuchstaben, End-e weg, d→t am Ende */
export function phon(w) {
  return fold(w).replace(/ph/g, "f").replace(/ck|c|q/g, "k").replace(/w/g, "v").replace(/y/g, "i")
    .replace(/ou|ow/g, "au").replace(/(.)\1+/g, "$1").replace(/(.{3,})e$/, "$1").replace(/d$/, "t");
}

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// typische Fehlerkennungen von „Claude“ durch die deutsche Spracherkennung
const CLAUDE_ALIASES = new Set(["claude", "claud", "klaud", "klaude", "clode", "klode", "clod", "klod", "cloud", "clowd", "kloud",
  "klaut", "claut", "glaud", "glaude", "clyde", "claudi", "klodt"].map(phon));
const GREET = new Set(["hey", "hei", "hej", "hay", "he", "hallo", "halo", "ok", "okay", "okey", "oke"]);

/** Passt das (zusammengezogene) Wort zum Namen? Unscharf: Lautform gleich, ab 5 Zeichen Abstand ≤ 1. */
export function nameMatches(word, name = DEFAULT_NAME) {
  const w = phon(word), n = phon(name);
  if (!w || !n) return false;
  if (w === n) return true;
  if (fold(name) === "claude" && CLAUDE_ALIASES.has(w)) return true;
  return fold(name).length >= 5 && lev(w, n) <= 1;
}

/** → { rest } wenn „hey/hallo/ok <Name>“ vorkommt (rest = Text danach, evtl. ""), sonst null. */
export function matchWake(text, name = DEFAULT_NAME) {
  const s = String(text || "");
  name = sanitizeName(name) || DEFAULT_NAME;
  const nWords = Math.max(1, name.split(/[\s-]+/).filter(Boolean).length);
  const toks = [...s.matchAll(/[\p{L}\p{N}']+/gu)].map((m) => ({ w: m[0], i: m.index, end: m.index + m[0].length }));
  for (let k = 0; k < toks.length - 1; k++) {
    let g = fold(toks[k].w);
    let first = k + 1;
    // „o. k.“ → ok
    if (g === "o" && toks[k + 1] && fold(toks[k + 1].w) === "k") { g = "ok"; first = k + 2; }
    if (!GREET.has(g)) continue;
    // Name aus nWords Wörtern (auch eins mehr/weniger, falls die Erkennung trennt/zusammenzieht)
    for (const len of [nWords, nWords + 1, nWords - 1]) {
      if (len < 1 || first + len > toks.length) continue;
      const part = toks.slice(first, first + len);
      if (!nameMatches(part.map((t) => t.w).join(""), name)) continue;
      const rest = s.slice(part[part.length - 1].end).trim().replace(/^[,.!?:;\s-]+/, "");
      return { rest: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "" };
    }
  }
  return null;
}

const STOP_RE = /^(?:(?:ok|okay|passt|super|gut|nein|na|alles klar|ja)\s+)?(?:stopp?|halt|danke(?:\s+(?:schön|sehr|dir|vielmals))?|vielen dank|tschüss?|tschau|ciao|baba|pfiat di|servus|auf wiedersehen|bis später|das wars?|das war's|das war es|ende|beenden|aufhören|hör auf|fertig|nichts mehr)(?:\s+(?:danke|tschüss|baba))?$/;

/** true, wenn die ganze Äußerung „Stopp/Danke/Tschüss …“ ist (nicht „Danke, und wie …?“). Name am Ende darf dabei sein. */
export function isStopPhrase(text, name = DEFAULT_NAME) {
  const words = norm(text).split(" ").filter(Boolean);
  if (words.length > 1 && nameMatches(words[words.length - 1], sanitizeName(name) || DEFAULT_NAME)) words.pop();
  return STOP_RE.test(words.join(" "));
}

/* ---------- Stimmen ---------- */

/** Deutsche Stimmen, beste zuerst. voices: [{name, lang, voiceURI, localService}] */
export function rankVoices(voices) {
  const list = Array.from(voices || []).filter((v) => v && /^de([-_]|$)/i.test(String(v.lang || "")));
  const score = (v) => {
    const n = String(v.name || "");
    let s = 0;
    if (/natural|neural|online|premium|enhanced|wavenet|studio/i.test(n)) s += 6;
    if (/^google\s+deutsch/i.test(n)) s += 5; else if (/google/i.test(n)) s += 3;
    if (/de[-_]AT/i.test(v.lang)) s += 2; else if (/de[-_]DE/i.test(v.lang)) s += 1;
    if (/compact|eloquence|espeak/i.test(n)) s -= 4;
    return s;
  };
  return list.map((v, i) => ({ v, s: score(v), i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.v);
}

export function pickVoice(voices, uri) {
  const ranked = rankVoices(voices);
  return (uri && ranked.find((v) => v.voiceURI === uri || v.name === uri)) || ranked[0] || null;
}
