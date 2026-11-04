// Schule & Lernen – gemeinsame Hilfen: Sammlungen, Datum, Fächer, Farben, Formulare.
// Sammlungen (über ../alltag/db.js): school_timetable, school_tasks, school_exams, school_grades,
// school_plan, school_sessions, school_projects, school_docs, school_meta (Dokumente "prefs", "timer").
// Dateiinhalte der Dokumente liegen NICHT hier, sondern in school-docs.js (eigene Ablage).
import { collection } from "./db.js";
import { esc } from "../util.js";

export const COLS = ["timetable", "tasks", "exams", "grades", "plan", "sessions", "projects", "docs", "meta"];
export const col = (n) => collection("school_" + n);

export const DEFAULT_PREFS = {
  focusMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4,
  sound: true, vibrate: true,
  abWeeks: false, abRef: null, // abRef = Montag ("YYYY-MM-DD") einer A-Woche
};
export function prefs(data) {
  const p = (data.meta || []).find((x) => x.id === "prefs") || {};
  return { ...DEFAULT_PREFS, ...p };
}
export function savePrefs(data, partial) {
  return safeWrite(col("meta").put({ ...prefs(data), ...partial, id: "prefs" }));
}

/** Schreibvorgang nicht blockieren (offline hängt Firestore bis zum Sync) – Fehler melden. */
let toastFn = null;
export function setToast(fn) { toastFn = fn; }
export function safeWrite(p) {
  Promise.resolve(p).catch((err) => {
    console.error("Schule speichern:", err);
    if (toastFn) toastFn("Speichern fehlgeschlagen – bitte nochmal versuchen.");
  });
  return p;
}

/* ---------- Datum ---------- */
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export { WD };
export const pad = (n) => String(n).padStart(2, "0");
export const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function todayKey() { return keyOf(new Date()); }
export function dateOf(k) { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(k, n) { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); }
export function diffDays(a, b) { return Math.round((dateOf(b) - dateOf(a)) / 86400000); } // b − a
export function mondayOf(k) { const d = dateOf(k); return addDays(k, -((d.getDay() + 6) % 7)); }
export function fmtDate(k) { if (!RE_DATE.test(k || "")) return ""; const [y, m, d] = k.split("-"); return `${d}.${m}.${y}`; }
export function fmtDay(k) { if (!RE_DATE.test(k || "")) return ""; const d = dateOf(k); return `${WD[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; }
export function fmtDayY(k) { if (!RE_DATE.test(k || "")) return ""; return `${WD[dateOf(k).getDay()]}, ${fmtDate(k)}`; }
export function nowMin() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
export function toMin(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
export function fromMin(m) { return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; }

/** „heute“, „morgen“, „noch 5 Tage“, „vor 2 Tagen“ … */
export function countdown(k, { past = "vorbei" } = {}) {
  const n = diffDays(todayKey(), k);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === 2) return "übermorgen";
  if (n > 0) return `noch ${n} Tage`;
  if (past === "overdue") return n === -1 ? "seit gestern" : `seit ${-n} Tagen`;
  return n === -1 ? "gestern" : `vor ${-n} Tagen`;
}

/* ---------- Schultage (settings.school, Update 6) ---------- */
export function schoolDayLabel(ctx, k) {
  try {
    const s = ctx.store.get();
    const u = ctx.util;
    if (u && u.schoolLabel) return u.schoolLabel(dateOf(k).getTime(), s && s.settings);
  } catch { /* egal */ }
  return null;
}
export function hasSchoolSettings(ctx) {
  try { return !!(ctx.util.readSchool && ctx.util.readSchool(ctx.store.get().settings)); } catch { return false; }
}
/** A/B-Woche eines Tages ("A"|"B") – null, wenn A/B-Wochen aus. */
export function abWeek(p, k) {
  if (!p.abWeeks) return null;
  const ref = RE_DATE.test(p.abRef || "") ? p.abRef : mondayOf(todayKey());
  const w = Math.round(diffDays(mondayOf(ref), mondayOf(k)) / 7);
  return ((w % 2) + 2) % 2 === 0 ? "A" : "B";
}
/** Stunden eines Tages (Wochentag + A/B), sortiert. */
export function lessonsOn(data, p, k) {
  const wd = dateOf(k).getDay();
  const ab = abWeek(p, k);
  return (data.timetable || [])
    .filter((l) => Number(l.weekday) === wd && (!ab || !l.week || l.week === ab))
    .sort((a, b) => (toMin(a.from) ?? a.period * 60) - (toMin(b.from) ?? b.period * 60));
}

/* ---------- Fächer & Farben ---------- */
export const PALETTE = ["#5b7cfa", "#3fae7a", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#ec4899", "#f97316", "#0ea5e9", "#64748b"];
export const DEFAULT_SUBJECTS = [
  "Angewandte Mathematik", "Elektrotechnik", "Fachkunde", "Laborübungen", "Fachzeichnen",
  "Deutsch und Kommunikation", "Englisch", "Politische Bildung", "Wirtschaftskunde", "Religion",
];
export function subjects(data) {
  const seen = new Map();
  for (const n of ["timetable", "tasks", "exams", "grades", "projects", "docs", "sessions"]) {
    for (const x of data[n] || []) {
      const s = String(x.subject || "").trim();
      if (s) seen.set(s.toLowerCase(), s);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "de"));
}
function hash(s) { let h = 0; for (const c of String(s).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export function subjectColor(data, s) {
  const key = String(s || "").trim().toLowerCase();
  if (!key) return "#64748b";
  const l = (data.timetable || []).filter((x) => String(x.subject || "").trim().toLowerCase() === key && x.color)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  return l ? l.color : PALETTE[hash(key) % PALETTE.length];
}
/* ---------- Fach-Symbole (Emoji) – Auswahl in prefs.subjectEmoji { "fach klein": "⚡" } ---------- */
const EMOJI_RULES = [
  [/elektrotechn|elektronik|^et$/, "⚡"], [/installation/, "🔌"], [/mathe|^am$|rechnen/, "📐"],
  [/informatik|digital|edv|computer/, "💻"], [/deutsch|kommunikation/, "📝"], [/englisch|english/, "🇬🇧"],
  [/politisch|geschichte|^pb$/, "🏛️"], [/wirtschaft|rechnungswesen|^wk$/, "💶"], [/sport|bewegung/, "🏃"],
  [/werkst|labor|praxis/, "🛠️"], [/zeichn|cad/, "✏️"], [/fachkunde|gebäudetechn|anlagentechn/, "🏠"],
  [/religion|ethik/, "🕊️"], [/physik/, "🧲"], [/chemie/, "🧪"], [/sicherheit|schutz/, "🦺"],
];
export const EMOJI_CHOICES = [
  "⚡", "🔌", "💡", "🔋", "🧲", "📐", "🧮", "💻", "🖥️", "📟", "📝", "📖", "🇬🇧", "🗣️", "🏛️", "⚖️",
  "💶", "📊", "🏃", "⚽", "🛠️", "🔧", "🪛", "🔩", "🏠", "🦺", "✏️", "📏", "🧪", "🌍", "🕊️", "🎨", "🎵", "📚", "🎯", "⭐",
];
export function defaultSubjectEmoji(s) {
  const k = String(s || "").trim().toLowerCase();
  for (const [re, e] of EMOJI_RULES) if (re.test(k)) return e;
  return "📚";
}
export function subjectEmoji(data, s) {
  const map = prefs(data).subjectEmoji || {};
  return map[String(s || "").trim().toLowerCase()] || defaultSubjectEmoji(s);
}
export const sameSubj = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** Kürzel: „Angewandte Mathematik“ → „AM“, „Elektrotechnik“ → „Elek“. */
export function abbr(s) {
  const w = String(s || "").trim().split(/\s+/).filter((x) => /^[A-ZÄÖÜ]/.test(x));
  if (w.length >= 2) return w.map((x) => x[0]).join("").slice(0, 4);
  return String(s || "").trim().slice(0, 4);
}

/* ---------- Noten (Österreich) ---------- */
export const GRADE_NAMES = { 1: "Sehr gut", 2: "Gut", 3: "Befriedigend", 4: "Genügend", 5: "Nicht genügend" };
export const GRADE_COLORS = { 1: "#16a34a", 2: "#65a30d", 3: "#ca8a04", 4: "#ea580c", 5: "#dc2626" };
export function gradeColor(avg) { return GRADE_COLORS[Math.min(5, Math.max(1, Math.round(avg)))] || "#64748b"; }
export const fmtAvg = (x) => (x == null ? "–" : x.toFixed(2).replace(".", ","));

/* ---------- HTML-Bausteine ---------- */
export { esc };
export const dot = (c) => `<i class="ss-dot" style="--c:${esc(c)}" aria-hidden="true"></i>`;
/** Freundlicher Leer-Zustand mit „+ Hinzufügen“. */
export function emptyHTML(emoji, title, text, addLabel, act) {
  return `<div class="ss-empty"><div class="ss-empty-e" aria-hidden="true">${emoji}</div><h3>${esc(title)}</h3>
    <p class="note">${esc(text)}</p>${addLabel ? `<button type="button" class="btn primary sm" data-act="${esc(act)}">+ ${esc(addLabel)}</button>` : ""}</div>`;
}
export function subjectInputHTML(data, id, value = "") {
  const list = [...new Set([...subjects(data), ...DEFAULT_SUBJECTS])];
  const recent = subjects(data).slice(0, 8);
  return `<label>Fach<input type="text" id="${id}" list="${id}-dl" maxlength="50" value="${esc(value)}" placeholder="z. B. Elektrotechnik" autocomplete="off">
    <datalist id="${id}-dl">${list.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist></label>
    ${recent.length ? `<div class="chips ss-subj-chips" data-for="${id}">${recent.map((s) => `<button type="button" class="chip ss-chip-s" data-subj="${esc(s)}">${dot(subjectColor(data, s))}${esc(s)}</button>`).join("")}</div>` : ""}`;
}
/** Fach-Chips im Formular füllen das Eingabefeld. */
export function wireSubjectChips(root) {
  root.querySelectorAll(".ss-subj-chips").forEach((box) => {
    box.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-subj]");
      if (!b) return;
      const inp = root.querySelector("#" + box.dataset.for);
      if (inp) { inp.value = b.dataset.subj; inp.dispatchEvent(new Event("input", { bubbles: true })); }
    });
  });
}
/** Lösch-Knopf mit Zweifach-Tipp. */
export function armDelete(btn, onConfirm) {
  if (!btn) return;
  const orig = btn.textContent;
  let t = null;
  btn.addEventListener("click", () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1"; btn.textContent = "Wirklich löschen?";
      t = setTimeout(() => { delete btn.dataset.armed; btn.textContent = orig; }, 4000);
      return;
    }
    clearTimeout(t);
    onConfirm();
  });
}
export function prioLabel(p) { return p === "high" ? "Wichtig" : p === "low" ? "Niedrig" : "Normal"; }
