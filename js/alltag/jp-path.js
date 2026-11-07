// Update 10 – 🇯🇵 Japanisch › 🛤️ Lernpfad: Adapter für die gemeinsame Lernpfad-Oberfläche (./path-ui.js).
// Einheiten: Hiragana-Reihen → Dakuten → Yōon → Katakana (gleich) → Basis-Wörter → abwechselnd 📐 Grammatik und Wortschatz-Themen
// (./jp-data.js, ./jp-data-grammar.js, ./jp-data-sentences.js).
// Fehler landen im bestehenden SRS (jp_cards), damit Kana/Vokabeln/Hören weiter passen.
import { createPath } from "./path-ui.js";
import * as P from "./path-core.js";
import { KANA_GROUPS, VOCAB } from "./jp-data.js";
import { GRAMMAR, PATH_ORDER } from "./jp-data-grammar.js";
import { SENTENCES } from "./jp-data-sentences.js";
import { toKatakana, checkRomaji, compareSpeech } from "./jp-core.js";
import { ttsSupported, srSupported, listenOnce, SR_ERRORS, stopSpeaking } from "./jp-speech.js";

export function createJpPath(J) {
  let cache = null, byId = null;
  const units = () => {
    if (!cache) {
      cache = P.jpUnits({ groups: KANA_GROUPS, vocab: VOCAB, toKata: toKatakana, kanaId: J.kanaId, grammar: GRAMMAR, sentences: SENTENCES, order: PATH_ORDER });
      byId = new Map(); // nur Kana & Wörter landen im SRS (Grammatik/Sätze nicht – sonst zählen sie als „Wörter gelernt“)
      for (const u of cache) for (const it of u.items) if (it.kind === "kana" || it.kind === "vocab") byId.set(it.id, it);
    }
    return cache;
  };
  const meta = (id) => { const it = byId && byId.get(id); return it && it.kind === "kana" ? { kind: "kana", kana: it.kana, romaji: it.romaji } : { kind: "vocab" }; };

  return createPath({
    module: "jp",
    name: "Japanisch",
    units,
    lessonCtx: () => ({ canListen: ttsSupported(), canSpeak: srSupported() }),
    /** Tippen/Sprechen prüfen → true | "near" (kleiner Tippfehler) | false */
    check(ex, value) {
      if (ex.type === "type") {
        if (ex.mode === "kana") return checkRomaji(ex.answer, value);
        const r = compareSpeech(String(value || ""), { kana: ex.big, romaji: ex.answer });
        return r.result === "ok" ? true : r.result === "close" && r.score >= 0.85 ? "near" : false;
      }
      if (ex.type === "speak") {
        const r = compareSpeech(value, ex.target);
        return r.result === "ok" ? true : r.result === "close" ? "near" : false;
      }
      return false;
    },
    speak: (text, opts) => J.speak(text, opts),
    stop: stopSpeaking,
    listen: (onInterim) => listenOnce({ onInterim }),
    srError: (e) => SR_ERRORS[e] || "Hat nicht geklappt – probier's nochmal 🙂",
    /** Fehler → „heute nochmal“, richtig → nur neue/fällige Karten weiterschieben (gute Karten nicht zurücksetzen). */
    async grade(ref, ok) {
      units();
      if (!byId.has(ref)) return;
      const cur = J.card(ref);
      if (!ok) return J.grade(ref, 1, meta(ref));
      if (!cur || !cur.seen || (cur.due && cur.due <= J.today())) return J.grade(ref, 4, meta(ref));
    },
    countStats(n) { if (n > 0) J.count("path", null, n); },
    /** 🏋️ Üben: zuletzt falsche/fällige Kana & Wörter, sonst aus geschafften Lektionen. */
    practiceItems(us, mod) {
      units();
      const today = J.today();
      const weak = [...J.cards().values()]
        .filter((c) => byId.has(c.id) && c.seen > 0 && (c.reps === 0 || (c.due && c.due <= today)))
        .sort((a, b) => (b.lapses || 0) - (a.lapses || 0) || String(a.due).localeCompare(String(b.due)))
        .map((c) => byId.get(c.id));
      const out = weak.slice(0, 10);
      if (out.length < 6) {
        const done = us.flatMap((u) => u.nodes).filter((n) => n.type === "lesson" && mod.nodes[n.id]).flatMap((n) => n.items);
        for (const it of done.slice().reverse()) { if (out.length >= 8) break; if (!out.includes(it)) out.push(it); }
      }
      return out;
    },
  });
}
