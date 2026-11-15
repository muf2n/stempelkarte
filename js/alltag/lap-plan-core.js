// Update 21 – 🎓 LAP-Countdown mit Lernplan – reine Logik (kein DOM). Gespeichert in lap_stats "me": { examDate: "JJJJ-MM-TT" }
// Ziel: bis 7 Tage vor der LAP jede Karte mindestens einmal gelernt; letzte Woche = Endspurt (Probeprüfungen + Schwächen).
import { isLearned, isMastered, isDue } from "./srs-core.js";

const day = (k) => { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); };
export const daysBetween = (a, b) => Math.round((day(b) - day(a)) / 864e5);
export const isKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ""));
export const BUFFER = 7;

/** cards: [{id, topic}], states: Map(id → SRS-Stand) */
export function lapPlan({ examDate, today, cards, states, topics }) {
  if (!isKey(examDate)) return null;
  const left = daysBetween(today, examDate);
  let learned = 0, mastered = 0, due = 0;
  const byTopic = new Map(topics.map((t) => [t.id, { ...t, n: 0, score: 0 }]));
  for (const c of cards) {
    const s = states.get(c.id), t = byTopic.get(c.topic);
    const L = isLearned(s), M = isMastered(s);
    if (L) learned++; if (M) mastered++; if (s && isDue(s, today) && L) due++;
    if (t) { t.n++; t.score += M ? 1 : L ? 0.5 : 0; }
  }
  const total = cards.length, unseen = total - learned;
  const studyDays = left > BUFFER ? left - BUFFER : Math.max(1, left);
  const newPerDay = left < 0 ? 0 : Math.ceil(unseen / Math.max(1, studyDays));
  const minutes = Math.round(newPerDay * 1.5 + due * 0.5);
  const phase = left < 0 ? "vorbei" : left === 0 ? "heute" : left <= BUFFER ? "endspurt" : "lernen";
  const pace = newPerDay <= 15 ? "gut" : newPerDay <= 30 ? "sportlich" : "eng";
  const topicsOut = [...byTopic.values()].filter((t) => t.n).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, n: t.n, pct: Math.round((t.score / t.n) * 100) })).sort((a, b) => a.pct - b.pct);
  return { left, total, learned, mastered, unseen, due, newPerDay, minutes, phase, pace, studyDays, topics: topicsOut, readiness: total ? Math.round(((mastered + (learned - mastered) * 0.5) / total) * 100) : 0 };
}
export const fmtDate = (k) => { const d = new Date(day(k)); return d.toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }); };
