// Update 10 – ⚡ Automationszentrum: reine Logik ohne DOM (Node-testbar, test/automation-core.test.mjs).
// Regeln „WENN → (BEDINGUNG) → DANN“ aus einem FESTEN Katalog – kein eigener Code, kein eval.
//   Regel  { id, name, emoji, enabled, enabledAt, trigger: { type, ...param }, conds: [{ type, ... }], actions: [{ type, ... }],
//            maxPerDay, seen: [Schlüssel], runs, lastRun, tpl? }  (Alltag-Sammlung „automations“)
//   Verlauf { id (= aus dem Schlüssel), ruleId, key, ts, ok, error, name, emoji, done: [Text], hints: [{ emoji, title, sub, target }] }
//            (Alltag-Sammlung „automation_log“, höchstens LOG_MAX Einträge)
// plan() bewertet alle Regeln gegen den aktuellen Stand und liefert, was JETZT laufen soll. Jede Regel läuft pro
// Anlass (Schlüssel Regel|Anlass) höchstens einmal und höchstens maxPerDay-mal am Tag. Die Ausführung macht js/automation.js.
// Geld-Sperre aktiv → Budget-Auslöser werden gar nicht ausgewertet; Texte enthalten nie Beträge.

import { expandTodo } from "./cal-core.js";
import { budgetStatus, levelRank, DEFAULT_CATS } from "./alltag/money-core.js";

export const LOG_MAX = 100;
export const SEEN_MAX = 60;
export const DEFAULT_MAX_PER_DAY = 3;
export const MAX_PER_DAY_LIMIT = 20;
export const EVENT_WINDOW_MS = 3 * 3600e3;   // Ein-/Ausstempeln & Co. zählen nur, wenn's höchstens 3 h her ist
export const OVERDUE_DAYS = 14;               // überfällige Aufgaben nur der letzten 14 Tage
export const NAME_MAX = 60;
export const TEXT_MAX = 200;

const pad = (n) => String(n).padStart(2, "0");
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const RE_T = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const s = (v) => String(v ?? "").trim();
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addKey = (k, n) => { const d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
const diffDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);
const toMin = (t) => { const m = RE_T.exec(s(t)); return m ? +m[1] * 60 + +m[2] : null; };
const tsAt = (k, time) => { const d = dateOf(k); const m = toMin(time); if (m != null) d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.getTime(); };
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const clampInt = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const cleanTime = (t, def) => (RE_T.test(s(t)) ? s(t).padStart(5, "0") : def);
export const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const fmtKey = (k) => { const d = dateOf(k); return `${WD_SHORT[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };

/* ---------- Katalog ---------- */

/** Auslöser (fresh = nur Anlässe ab dem Einschalten der Regel). */
export const TRIGGERS = Object.freeze([
  { id: "clock_in", e: "▶️", t: "Arbeitsbeginn", d: "wenn du einstempelst", fresh: true },
  { id: "clock_out", e: "⏹️", t: "Arbeitsende", d: "wenn du ausstempelst", fresh: true },
  { id: "site", e: "📍", t: "Baustelle erkannt", d: "wenn du an einem Ort einstempelst", fresh: true },
  { id: "termin", e: "📅", t: "Termin steht an", d: "kurz bevor ein Termin beginnt" },
  { id: "overdue", e: "⏰", t: "Aufgabe überfällig", d: "wenn eine Aufgabe liegen bleibt" },
  { id: "material", e: "🧰", t: "Material fehlt", d: "wenn Material auf „brauche“ steht", fresh: true },
  { id: "budget", e: "💶", t: "Budget-Grenze erreicht", d: "wenn ein Budget knapp wird (nur ohne Geld-Sperre)" },
  { id: "month_end", e: "📆", t: "Monatsende", d: "am Ende des Monats", fresh: true },
  { id: "month_start", e: "🌱", t: "Monatsanfang", d: "am 1. des Monats", fresh: true },
  { id: "weekly", e: "🗓️", t: "Wochentag & Uhrzeit", d: "zu einer festen Zeit", fresh: true },
  { id: "exam", e: "🎓", t: "Prüfung steht an", d: "N Tage vor einer Prüfung" },
  { id: "vacation", e: "🌴", t: "Urlaub beginnt", d: "vor Urlaub oder Reise" },
]);
export const TRIGGER_IDS = TRIGGERS.map((x) => x.id);
export const triggerById = (id) => TRIGGERS.find((x) => x.id === id) || null;

export const CONDS = Object.freeze([
  { id: "weekday", e: "📅", t: "Nur an bestimmten Wochentagen" },
  { id: "time", e: "🕐", t: "Nur in einem Uhrzeit-Fenster" },
  { id: "place", e: "📍", t: "Nur an einem Ort / einer Baustelle" },
  { id: "mode", e: "🏠", t: "Nur im Arbeits- oder Privat-Modus" },
]);
export const COND_IDS = CONDS.map((x) => x.id);

export const ACTIONS = Object.freeze([
  { id: "hint", e: "🔔", t: "Hinweis in den Mitteilungen" },
  { id: "task", e: "✅", t: "Aufgabe anlegen" },
  { id: "einkauf", e: "🛒", t: "Material auf die Einkaufsliste „Baustelle“", only: ["material"] },
  { id: "open", e: "🧭", t: "Seite vorschlagen (z. B. Baustelle)" },
  { id: "mode", e: "🔁", t: "Privat-/Arbeitsmodus umschalten" },
  { id: "report", e: "📒", t: "Wochen-/Monatsbericht vorbereiten" },
  { id: "learn", e: "📚", t: "Lernplan vorschlagen" },
]);
export const ACTION_IDS = ACTIONS.map((x) => x.id);
export const actionById = (id) => ACTIONS.find((x) => x.id === id) || null;
/** Passt die Aktion zum Auslöser? */
export const actionFits = (actionId, triggerId) => { const a = actionById(actionId); return !!a && (!a.only || a.only.includes(triggerId)); };

export const OPEN_TARGETS = Object.freeze([
  ["auto", "✨ Passende Seite (Baustelle, Planer …)"],
  ["#alltag/material", "🧰 Material"],
  ["#alltag/einkauf", "🛒 Einkaufsliste"],
  ["#agenda", "📅 Planer"],
  ["#alltag/werkzeug", "🔧 Werkzeug"],
  ["#alltag/galerie", "📸 Galerie"],
  ["#uebersicht", "📊 Übersicht"],
  ["#alltag/zeitleiste", "🕰️ Zeitleiste"],
]);
const TARGET_IDS = OPEN_TARGETS.map((x) => x[0]);

/* ---------- Normalisieren ---------- */

function normTrigger(t) {
  const type = TRIGGER_IDS.includes(t && t.type) ? t.type : "clock_in";
  const o = { type };
  if (type === "site") o.placeId = s(t.placeId);
  if (type === "termin") { o.amount = clampInt(t.amount, 1, 999, 30); o.unit = t.unit === "h" ? "h" : "min"; }
  if (type === "budget") o.level = t.level === "limit" ? "limit" : "warn";
  if (type === "month_end") { o.days = clampInt(t.days, 0, 7, 0); o.time = cleanTime(t.time, "16:00"); }
  if (type === "month_start") o.time = cleanTime(t.time, "08:00");
  if (type === "weekly") {
    const d = Array.isArray(t.days) ? [...new Set(t.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : [];
    o.days = d.length ? d : [5];
    o.time = cleanTime(t.time, "12:00");
  }
  if (type === "exam") o.days = clampInt(t.days, 0, 60, 7);
  if (type === "vacation") o.days = clampInt(t.days, 0, 14, 1);
  return o;
}

function normCond(c) {
  if (!c || !COND_IDS.includes(c.type)) return null;
  if (c.type === "weekday") {
    const d = Array.isArray(c.days) ? [...new Set(c.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : [];
    return d.length ? { type: "weekday", days: d } : null;
  }
  if (c.type === "time") return { type: "time", from: cleanTime(c.from, "06:00"), to: cleanTime(c.to, "18:00") };
  if (c.type === "place") return s(c.placeId) ? { type: "place", placeId: s(c.placeId) } : null;
  if (c.type === "mode") return { type: "mode", mode: c.mode === "privat" ? "privat" : "arbeit" };
  return null;
}

function normAction(a, triggerType) {
  if (!a || !ACTION_IDS.includes(a.type) || !actionFits(a.type, triggerType)) return null;
  if (a.type === "hint") return { type: "hint", text: s(a.text).slice(0, TEXT_MAX) };
  if (a.type === "task") return { type: "task", text: s(a.text).slice(0, TEXT_MAX), when: a.when === "tomorrow" ? "tomorrow" : "today" };
  if (a.type === "einkauf") return { type: "einkauf" };
  if (a.type === "open") return { type: "open", target: TARGET_IDS.includes(a.target) ? a.target : "auto" };
  if (a.type === "mode") return { type: "mode", mode: a.mode === "arbeit" ? "arbeit" : "privat" };
  if (a.type === "report") return { type: "report", kind: a.kind === "month" ? "month" : "week" };
  if (a.type === "learn") return { type: "learn", to: a.to === "lap" ? "lap" : "schule" };
  return null;
}

/** Regel mit Standardwerten (unbekannte Typen fliegen raus). */
export function normRule(x = {}) {
  const trigger = normTrigger(x.trigger || {});
  const actions = (Array.isArray(x.actions) ? x.actions : []).map((a) => normAction(a, trigger.type)).filter(Boolean).slice(0, 6);
  const conds = (Array.isArray(x.conds) ? x.conds : []).map(normCond).filter(Boolean).slice(0, 4);
  return {
    ...x,
    id: s(x.id),
    name: s(x.name).slice(0, NAME_MAX) || defaultName(trigger),
    emoji: s(x.emoji).slice(0, 8) || (triggerById(trigger.type) || {}).e || "⚡",
    enabled: x.enabled !== false,
    enabledAt: Number(x.enabledAt) || Number(x.created) || 0,
    trigger, conds, actions,
    maxPerDay: clampInt(x.maxPerDay, 1, MAX_PER_DAY_LIMIT, DEFAULT_MAX_PER_DAY),
    seen: (Array.isArray(x.seen) ? x.seen : []).map(String).slice(-SEEN_MAX),
    runs: Number(x.runs) || 0,
    lastRun: Number(x.lastRun) || 0,
  };
}

function defaultName(trigger) { const t = triggerById(trigger.type); return t ? t.t : "Automation"; }

/** Fehler einer Regel (leer = ok). */
export function validateRule(r) {
  const n = normRule(r);
  const err = [];
  if (!n.actions.length) err.push("Mindestens eine Aktion („DANN“) auswählen.");
  for (const a of n.actions) {
    if ((a.type === "hint" || a.type === "task") && !a.text) err.push(a.type === "hint" ? "Bitte einen Text für den Hinweis eingeben." : "Bitte einen Text für die Aufgabe eingeben.");
  }
  if (n.trigger.type === "weekly" && !n.trigger.days.length) err.push("Mindestens einen Wochentag wählen.");
  for (const c of Array.isArray(r && r.conds) ? r.conds : []) {
    if (c && c.type === "weekday" && !(Array.isArray(c.days) && c.days.length)) err.push("Bei „Wochentage“ mindestens einen Tag wählen.");
    if (c && c.type === "place" && !s(c.placeId)) err.push("Bei „Ort“ bitte einen Ort auswählen.");
  }
  return err;
}

/** Für eine Kopie: neue Regel ohne Verlauf. */
export function duplicateRule(r, now = Date.now()) {
  const n = normRule(r);
  return { ...n, id: "", name: (n.name + " (Kopie)").slice(0, NAME_MAX), enabled: false, enabledAt: 0, seen: [], runs: 0, lastRun: 0, created: now, tpl: undefined };
}

/* ---------- Texte ---------- */

/** {name} / {ort} / {datum} im Text ersetzen. */
export function renderText(tpl, data = {}, now = Date.now()) {
  const map = { name: s(data.name), ort: s(data.place), datum: fmtKey(keyOf(new Date(now))) };
  return s(tpl).replace(/\{(name|ort|datum)\}/g, (_, k) => map[k] || "").replace(/\s{2,}/g, " ").replace(/\s+([.,!?:])/g, "$1").trim().slice(0, TEXT_MAX);
}

const unitText = (tr) => (tr.unit === "h" ? `${tr.amount} ${tr.amount === 1 ? "Stunde" : "Stunden"}` : `${tr.amount} Min`);
const daysText = (days) => (days.length === 7 ? "täglich" : days.join(",") === "1,2,3,4,5" ? "Mo–Fr" : days.map((d) => WD_SHORT[d]).join(", "));

/** „WENN …“ als Satz. places = [{ id, name }] */
export function triggerText(tr, places = []) {
  const pn = (id) => s((places.find((p) => p && p.id === id) || {}).name) || "einem Ort";
  switch (tr.type) {
    case "clock_in": return "Du stempelst ein";
    case "clock_out": return "Du stempelst aus";
    case "site": return tr.placeId ? `Du stempelst bei „${pn(tr.placeId)}“ ein` : "Du stempelst an einer Baustelle ein";
    case "termin": return `Ein Termin beginnt in ${unitText(tr)}`;
    case "overdue": return "Eine Aufgabe ist überfällig";
    case "material": return "Material steht auf „brauche“";
    case "budget": return tr.level === "limit" ? "Ein Budget ist aufgebraucht" : "Ein Budget ist fast aufgebraucht";
    case "month_end": return tr.days ? `${tr.days} ${tr.days === 1 ? "Tag" : "Tage"} vor Monatsende um ${tr.time}` : `Am letzten Tag des Monats um ${tr.time}`;
    case "month_start": return `Am 1. des Monats um ${tr.time}`;
    case "weekly": return `${daysText(tr.days)} um ${tr.time}`;
    case "exam": return tr.days ? `Eine Prüfung ist in ${tr.days} ${tr.days === 1 ? "Tag" : "Tagen"}` : "Heute ist eine Prüfung";
    case "vacation": return tr.days ? `${tr.days === 1 ? "Am Tag" : `${tr.days} Tage`} vor Urlaub oder Reise` : "Urlaub oder Reise beginnt heute";
    default: return "?";
  }
}

export function condText(c, places = []) {
  if (c.type === "weekday") return daysText(c.days);
  if (c.type === "time") return `zwischen ${c.from} und ${c.to}`;
  if (c.type === "place") return `bei „${s((places.find((p) => p && p.id === c.placeId) || {}).name) || "?"}“`;
  if (c.type === "mode") return c.mode === "privat" ? "im Privat-Modus" : "im Arbeitsmodus";
  return "";
}

export function actionText(a) {
  switch (a.type) {
    case "hint": return `🔔 Hinweis: „${a.text}“`;
    case "task": return `✅ Aufgabe ${a.when === "tomorrow" ? "für morgen" : "für heute"}: „${a.text}“`;
    case "einkauf": return "🛒 Auf die Einkaufsliste „Baustelle“";
    case "open": return `🧭 ${a.target === "auto" ? "Passende Seite vorschlagen" : (OPEN_TARGETS.find((x) => x[0] === a.target) || [0, "Seite"])[1] + " vorschlagen"}`;
    case "mode": return a.mode === "privat" ? "🏡 In den Privat-Modus wechseln" : "🔧 In den Arbeitsmodus wechseln";
    case "report": return a.kind === "month" ? "📊 Monatsbericht vorbereiten" : "📒 Wochenbericht vorbereiten";
    case "learn": return a.to === "lap" ? "🎓 Lernplan LAP vorschlagen" : "📚 Lernplan Schule vorschlagen";
    default: return "";
  }
}

/* ---------- Bedingungen ---------- */

/** Erfüllt? S = { now, privat, running }, data = Anlass-Daten (placeId …). */
export function condOk(c, S, data = {}) {
  const now = new Date(Number(S.now) || Date.now());
  if (c.type === "weekday") return c.days.includes(now.getDay());
  if (c.type === "time") {
    const m = now.getHours() * 60 + now.getMinutes();
    const a = toMin(c.from), b = toMin(c.to);
    if (a == null || b == null) return true;
    return a <= b ? m >= a && m < b : m >= a || m < b; // über Mitternacht
  }
  if (c.type === "place") {
    const pid = s(data.placeId) || s(S.running && (curSegment(S.running) || {}).placeId) || s(S.running && S.running.placeId);
    return !!pid && pid === c.placeId;
  }
  if (c.type === "mode") return c.mode === "privat" ? !!S.privat : !S.privat;
  return true;
}

function curSegment(running) {
  if (!running) return null;
  const seg = Array.isArray(running.segments) && running.segments.length ? running.segments[running.segments.length - 1] : null;
  return seg || running;
}

/* ---------- Anlässe je Auslöser ---------- */

const isWork = (e) => e && (!e.kind || e.kind === "work") && !e.privateTrip && Number.isFinite(e.start);

/**
 * Anlässe [{ occ, at, data }] für einen Auslöser. S = {
 *   now, running, entries, todos, places, privat, moneyLocked,
 *   cols: { material_items, school_exams, travel_trips, money_tx, money_budget, money_cats } }
 */
export function occurrences(tr, S) {
  const now = Number(S.now) || Date.now();
  const today = keyOf(new Date(now));
  const cols = S.cols || {};
  const placeName = (id) => s(((S.places || []).find((p) => p && p.id === id) || {}).name);
  const out = [];
  switch (tr.type) {
    case "clock_in": {
      const r = S.running;
      if (r && Number.isFinite(r.start) && now - r.start <= EVENT_WINDOW_MS && r.start <= now) {
        const seg = curSegment(r);
        out.push({ occ: `in:${r.start}`, at: r.start, data: { placeId: s(seg.placeId) || null, place: s(seg.place) || placeName(seg.placeId), name: s(seg.place) || placeName(seg.placeId) } });
      }
      break;
    }
    case "clock_out": {
      if (S.running) break;
      let last = null;
      for (const e of S.entries || []) if (isWork(e) && Number.isFinite(e.end) && (!last || e.end > last.end)) last = e;
      if (last && now - last.end <= EVENT_WINDOW_MS && last.end <= now) out.push({ occ: `out:${last.id || last.start}`, at: last.end, data: { placeId: s(last.placeId) || null, place: s(last.place) || placeName(last.placeId), name: s(last.place) || placeName(last.placeId) } });
      break;
    }
    case "site": {
      const r = S.running;
      if (!r) break;
      const segs = Array.isArray(r.segments) && r.segments.length ? r.segments : [r];
      for (const seg of segs) {
        const pid = s(seg.placeId);
        const st = Number(seg.start) || Number(r.start);
        if (!pid || !Number.isFinite(st) || now - st > EVENT_WINDOW_MS || st > now) continue;
        if (tr.placeId && pid !== tr.placeId) continue;
        out.push({ occ: `site:${pid}:${st}`, at: st, data: { placeId: pid, place: s(seg.place) || placeName(pid), name: s(seg.place) || placeName(pid) } });
      }
      break;
    }
    case "termin": {
      const lead = tr.amount * (tr.unit === "h" ? 3600e3 : 60e3);
      const to = keyOf(new Date(now + lead + 86400000));
      for (const t of S.todos || []) {
        if (!t || t.kind !== "termin" || t.done) continue;
        let inst = [];
        try { inst = expandTodo(t, today, to); } catch { inst = []; }
        for (const i of inst) {
          if (i.done || i.allDay || !RE_T.test(s(i.time))) continue;
          const start = tsAt(i.date, i.time);
          if (now >= start - lead && now < start) out.push({ occ: `termin:${t.id}:${i.date}:${i.time}`, at: start - lead, data: { name: s(i.title || t.title) || "Termin", place: s(i.location || t.location), todoId: t.id } });
        }
      }
      break;
    }
    case "overdue": {
      const min = addKey(today, -OVERDUE_DAYS);
      for (const t of S.todos || []) {
        if (!t || t.done || t.kind !== "todo" || !RE_KEY.test(s(t.date)) || t.date >= today || t.date < min) continue;
        out.push({ occ: `todo:${t.id}:${t.date}`, at: dateOf(addKey(t.date, 1)).getTime(), data: { name: s(t.title) || "Aufgabe", todoId: t.id } });
      }
      break;
    }
    case "material": {
      for (const m of cols.material_items || []) {
        if (!m || !m.id || m.deleted || (m.status || "brauche") !== "brauche" || !s(m.name)) continue;
        const at = Number(m.updated) || Number(m.created) || 0;
        out.push({ occ: `mat:${m.id}`, at, data: { name: s(m.name), material: { id: m.id, name: s(m.name), qty: m.qty, unit: s(m.unit) }, placeId: s(m.placeId) || null, place: s(m.place) || placeName(m.placeId) } });
      }
      break;
    }
    case "budget": {
      if (S.moneyLocked) break; // Geld-Sperre: gar nicht auswerten
      const budgets = cols.money_budget || [];
      if (!budgets.length) break;
      const mk = monthKey(new Date(now));
      const cats = (cols.money_cats || []).length ? [...cols.money_cats, ...DEFAULT_CATS] : DEFAULT_CATS;
      let rows = [];
      try { rows = budgetStatus(cols.money_tx || [], budgets, mk, cats); } catch { rows = []; }
      const need = tr.level === "limit" ? 2 : 1;
      for (const r of rows) {
        const lv = levelRank(r);
        if (lv < need) continue;
        out.push({ occ: `budget:${r.id}:${mk}:${need}`, at: now, data: { name: r.id === "total" ? "Gesamtbudget" : `Budget ${r.name}` } });
      }
      break;
    }
    case "month_end": {
      const d = new Date(now);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const day = new Date(last.getFullYear(), last.getMonth(), last.getDate() - tr.days);
      const at = tsAt(keyOf(day), tr.time);
      if (keyOf(day) === today && now >= at) out.push({ occ: `me:${monthKey(d)}`, at, data: { name: monthName(d) } });
      break;
    }
    case "month_start": {
      const d = new Date(now);
      const at = tsAt(keyOf(new Date(d.getFullYear(), d.getMonth(), 1)), tr.time);
      if (d.getDate() === 1 && now >= at) out.push({ occ: `ms:${monthKey(d)}`, at, data: { name: monthName(d) } });
      break;
    }
    case "weekly": {
      const d = new Date(now);
      const at = tsAt(today, tr.time);
      if (tr.days.includes(d.getDay()) && now >= at) out.push({ occ: `wk:${today}`, at, data: { name: fmtKey(today) } });
      break;
    }
    case "exam": {
      for (const e of cols.school_exams || []) {
        if (!e || !RE_KEY.test(s(e.date)) || e.date < today) continue;
        const d = diffDays(today, e.date);
        if (d > tr.days) continue;
        out.push({ occ: `exam:${e.id}:${e.date}`, at: now, data: { name: `${s(e.kind) || "Prüfung"}${s(e.subject) ? " " + s(e.subject) : ""}`.trim(), date: e.date } });
      }
      break;
    }
    case "vacation": {
      for (const v of vacationStarts(S.entries || [], cols.travel_trips || [])) {
        const d = diffDays(today, v.date);
        if (d < 0 || d > tr.days) continue;
        out.push({ occ: `vac:${v.id}`, at: now, data: { name: v.name, date: v.date } });
      }
      break;
    }
    default: break;
  }
  return out;
}

const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function monthName(d) { return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

/** Urlaubsbeginne: Urlaubs-Einträge (Block-Anfang, Wochenenden überbrückt) + Reisen (travel_trips.from). */
export function vacationStarts(entries, trips) {
  const days = new Set();
  for (const e of entries || []) if (e && e.kind === "urlaub" && Number.isFinite(e.start)) days.add(keyOf(new Date(e.start)));
  const out = [];
  for (const k of [...days].sort()) {
    let p = addKey(k, -1);
    while ([0, 6].includes(dateOf(p).getDay())) p = addKey(p, -1); // Wochenende dazwischen zählt nicht als Lücke
    if (!days.has(p)) out.push({ id: `u:${k}`, date: k, name: "Urlaub" });
  }
  for (const t of trips || []) if (t && t.id && RE_KEY.test(s(t.from))) out.push({ id: `t:${t.id}:${t.from}`, date: t.from, name: s(t.title) || s(t.dest) || "Reise" });
  return out;
}

/* ---------- Verlauf / Duplikate ---------- */

export const runKey = (ruleId, occ) => `${ruleId}|${occ}`;
/** Firestore-taugliche, feste ID je Schlüssel (gleicher Anlass auf zwei Geräten → dasselbe Dokument). */
export function logDocId(key) {
  const str = String(key);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2246822519) >>> 0; }
  return "al_" + h1.toString(36) + h2.toString(36);
}

/** { seen: Set(Schlüssel), today: Map(ruleId → Läufe heute) } aus Verlauf + Regeln. */
export function buildHistory(logDocs = [], rules = [], now = Date.now()) {
  const seen = new Set();
  const today = new Map();
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  for (const r of rules) for (const k of (r && Array.isArray(r.seen) ? r.seen : [])) seen.add(String(k));
  for (const l of logDocs) {
    if (!l || !l.key) continue;
    seen.add(String(l.key));
    if (Number(l.ts) >= t0.getTime() && !l.skipped) today.set(l.ruleId, (today.get(l.ruleId) || 0) + 1);
  }
  return { seen, today };
}

/**
 * Was soll jetzt laufen? → [{ rule, occ, key, at, data }]
 * history = buildHistory(…) – wird hier mitgezählt (mehrere Anlässe derselben Regel in einem Durchgang).
 */
export function plan(rules, S, history = { seen: new Set(), today: new Map() }) {
  const out = [];
  const seen = history.seen || new Set();
  const today = history.today || new Map();
  for (const raw of rules || []) {
    const r = normRule(raw);
    if (!r.id || !r.enabled || !r.actions.length) continue;
    const meta = triggerById(r.trigger.type);
    let occs = [];
    try { occs = occurrences(r.trigger, S); } catch { occs = []; }
    occs.sort((a, b) => a.at - b.at);
    for (const o of occs) {
      const key = runKey(r.id, o.occ);
      if (seen.has(key)) continue;
      if (meta.fresh && r.enabledAt && o.at < r.enabledAt - 60000) continue; // vor dem Einschalten passiert → nicht nachholen
      if (!r.conds.every((c) => condOk(c, S, o.data))) continue;
      const n = today.get(r.id) || 0;
      if (n >= r.maxPerDay) break;
      seen.add(key);
      today.set(r.id, n + 1);
      out.push({ rule: r, occ: o.occ, key, at: o.at, data: o.data || {} });
    }
  }
  return out;
}

/**
 * Aktionen eines Laufs als Beschreibung der Nebenwirkungen (ohne sie auszuführen):
 *   { kind: "hint", hint } | { kind: "task", todo } | { kind: "einkauf", item } | { kind: "mode", privat }
 * siteHashOf(placeId) → "#orte/baustelle/<id>" (von außen, damit der Kern ohne DOM bleibt).
 */
export function effects(run, { now = Date.now(), siteHashOf = null } = {}) {
  const { rule, data } = run;
  const today = keyOf(new Date(now));
  const out = [];
  const name = rule.name;
  for (const a of rule.actions) {
    if (a.type === "hint") out.push({ kind: "hint", hint: { emoji: rule.emoji, title: renderText(a.text, data, now) || name, sub: `⚡ ${name}`, target: autoTarget(rule.trigger.type, data, siteHashOf) } });
    else if (a.type === "task") {
      const date = a.when === "tomorrow" ? addKey(today, 1) : today;
      out.push({ kind: "task", todo: { id: "au_" + logDocId(run.key).slice(3), kind: "todo", title: renderText(a.text, data, now) || name, date, time: "", remind: false, remindMin: 30, done: false, doneAt: null, note: `⚡ Automatisch angelegt von „${name}“`, src: "automation" } });
    } else if (a.type === "einkauf") {
      const m = data.material;
      if (!m) { out.push({ kind: "error", error: "Diese Aktion passt nur zu „Material fehlt“." }); continue; }
      out.push({ kind: "einkauf", item: { listId: "baustelle", name: s(m.name), qty: m.qty ?? null, unit: s(m.unit) || "Stk", matId: m.id, note: data.place ? `🏗️ ${data.place}` : "" } });
    } else if (a.type === "open") {
      const target = a.target === "auto" ? autoTarget(rule.trigger.type, data, siteHashOf) : a.target;
      const title = data.placeId && a.target === "auto" ? `${data.place || "Baustelle"} öffnen?` : `${targetLabel(target, data)} öffnen?`;
      out.push({ kind: "hint", hint: { emoji: "🧭", title, sub: `⚡ ${name} – tipp zum Öffnen`, target } });
    } else if (a.type === "mode") out.push({ kind: "mode", privat: a.mode === "privat" });
    else if (a.type === "report") {
      out.push({ kind: "hint", hint: a.kind === "month"
        ? { emoji: "📊", title: "Monatsbericht vorbereiten", sub: `⚡ ${name} – Stunden & Abschluss in der Übersicht`, target: "jump:month-panel" }
        : { emoji: "📒", title: "Wochenbericht vorbereiten", sub: `⚡ ${name} – mit Vorschlag vorausgefüllt ✨`, target: "weekreport" } });
    } else if (a.type === "learn") {
      out.push({ kind: "hint", hint: { emoji: a.to === "lap" ? "🎓" : "📚", title: `Lernplan${data.name && rule.trigger.type === "exam" ? " für " + data.name : ""}`, sub: `⚡ ${name} – ein bisserl jeden Tag reicht 💪`, target: a.to === "lap" ? "#alltag/lap" : "#alltag/schule" } });
    }
  }
  return out;
}

const TARGET_LABEL = { "#agenda": "Planer", "#alltag/material": "Material", "#alltag/einkauf": "Einkaufsliste", "#alltag/werkzeug": "Werkzeug", "#alltag/galerie": "Galerie",
  "#alltag/geld": "Geld", "#alltag/schule": "Schule", "#uebersicht": "Übersicht", "#alltag/zeitleiste": "Zeitleiste", "jump:month-panel": "Monatsübersicht" };
function targetLabel(target, data) {
  if (String(target).startsWith("todo:")) return `„${s(data && data.name) || "Aufgabe"}“`;
  return TARGET_LABEL[target] || "Seite";
}

function autoTarget(type, data, siteHashOf) {
  if (data && data.placeId && typeof siteHashOf === "function") return siteHashOf(data.placeId);
  if (data && data.todoId) return `todo:${data.todoId}`;
  return ({ material: "#alltag/material", budget: "#alltag/geld", exam: "#alltag/schule", termin: "#agenda", overdue: "#agenda", vacation: "#agenda", month_end: "jump:month-panel", month_start: "#uebersicht" })[type] || "#agenda";
}

/** Verlauf-Einträge, die weg können (älteste über max). */
export function pruneLog(logDocs, max = LOG_MAX) {
  const list = (logDocs || []).filter((x) => x && x.id).sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
  return list.slice(max).map((x) => x.id);
}

/** Regel nach einem Lauf: Zähler + gemerkte Schlüssel. */
export function afterRun(rule, key, now = Date.now()) {
  const seen = [...(Array.isArray(rule.seen) ? rule.seen : []).filter((k) => k !== key), key].slice(-SEEN_MAX);
  return { seen, runs: (Number(rule.runs) || 0) + 1, lastRun: now };
}

/** Welche Alltag-Sammlungen brauchen die eingeschalteten Regeln? */
export function neededCollections(rules) {
  const need = new Set();
  for (const raw of rules || []) {
    const r = normRule(raw);
    if (!r.enabled) continue;
    if (r.trigger.type === "material") need.add("material_items");
    if (r.trigger.type === "exam") need.add("school_exams");
    if (r.trigger.type === "vacation") need.add("travel_trips");
    if (r.trigger.type === "budget") { need.add("money_budget"); need.add("money_tx"); need.add("money_cats"); }
    if (r.actions.some((a) => a.type === "einkauf")) need.add("einkauf");
  }
  return [...need];
}

/** Hinweise für die Mitteilungen (js/notify-core.js) aus dem Verlauf – nur die letzten `days` Tage. */
export function notifyItems(logDocs, now = Date.now(), days = 3) {
  const out = [];
  const cut = now - days * 86400000;
  for (const l of logDocs || []) {
    if (!l || !l.id || !(Number(l.ts) >= cut) || !Array.isArray(l.hints)) continue;
    l.hints.forEach((h, i) => {
      if (!h || !s(h.title)) return;
      out.push({ id: `auto:${l.id}:${i}`, kind: "automation", emoji: s(h.emoji) || "⚡", title: s(h.title), sub: s(h.sub), when: Number(l.ts), prio: 1, target: s(h.target) || "#alltag/automationen" });
    });
  }
  return out;
}

/* ---------- Vorlagen (ein Tipp → aktiv) ---------- */

export const TEMPLATES = Object.freeze([
  { tpl: "site", emoji: "📍", name: "Baustelle angekommen", d: "Beim Einstempeln an einer Baustelle schlägt die App gleich deren Projektseite vor.",
    trigger: { type: "site", placeId: "" }, conds: [], actions: [{ type: "open", target: "auto" }, { type: "hint", text: "Servus auf {ort}! 👷 Denk an Fotos und Material." }] },
  { tpl: "material", emoji: "🧰", name: "Material → Einkaufsliste", d: "Fehlendes Material landet automatisch auf der Einkaufsliste „Baustelle“.",
    trigger: { type: "material" }, conds: [], actions: [{ type: "einkauf" }], maxPerDay: 10 },
  { tpl: "weekreport", emoji: "📒", name: "Freitags Wochenbericht", d: "Jeden Freitag zu Mittag kommt der Wochenbericht vorausgefüllt in die Mitteilungen.",
    trigger: { type: "weekly", days: [5], time: "12:00" }, conds: [], actions: [{ type: "report", kind: "week" }] },
  { tpl: "monthend", emoji: "📆", name: "Monatsende: Stunden checken", d: "Am letzten Tag des Monats: Stunden kontrollieren und den Monat abschließen.",
    trigger: { type: "month_end", days: 0, time: "16:00" }, conds: [], actions: [{ type: "report", kind: "month" }, { type: "task", text: "Stunden für {name} kontrollieren ✔️", when: "today" }] },
  { tpl: "exam", emoji: "🎓", name: "Prüfung in 7 Tagen", d: "Eine Woche vor jeder Prüfung gibt's einen Lernplan-Vorschlag.",
    trigger: { type: "exam", days: 7 }, conds: [], actions: [{ type: "learn", to: "schule" }] },
  { tpl: "feierabend", emoji: "🏡", name: "Feierabend = Privat", d: "Nach dem Ausstempeln (Mo–Fr) schaltet die App in den Privat-Modus.",
    trigger: { type: "clock_out" }, conds: [{ type: "weekday", days: [1, 2, 3, 4, 5] }], actions: [{ type: "mode", mode: "privat" }, { type: "hint", text: "Feierabend! 🎉 Arbeit ist ausgeblendet – genieß den Abend." }] },
]);

/** Regel aus einer Vorlage (eingeschaltet ab now). */
export function fromTemplate(tplId, now = Date.now()) {
  const t = TEMPLATES.find((x) => x.tpl === tplId);
  if (!t) return null;
  const { d, ...rest } = t;
  return normRule({ ...JSON.parse(JSON.stringify(rest)), enabled: true, enabledAt: now, created: now });
}
