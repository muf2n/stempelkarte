// Abos – reine Logik ohne DOM (Vertragsart, „Wie lange noch“, Kündigungsfristen, Erinnerungen).
// Wird von money.js (Web-App) und tools/mcp (Claude-Werkzeuge abos_lesen / abo_bearbeiten) benutzt.
// Tests: test/subs.test.mjs
//
// Zusätzliche (optionale) Felder in money_subs – alte Abos ohne diese Felder funktionieren weiter:
//   what, startDate, contractType ("monatlich kündbar" | "Mindestlaufzeit" | "Testzeitraum" | "Prepaid"),
//   minTermEnd, contractEnd, noticeDays, noticeText, autoRenew, trialEnd,
//   cancelUrl, manageUrl, cancelHow, cancelledOn, account, remind (Erinnerung an Kündigungsfrist, Standard an),
//   remindedFor (Frist, für die schon eine Planer-Erinnerung angelegt wurde).
//   ended = letzter Tag, an dem das Abo noch läuft (danach keine automatische Buchung mehr).

import { isKey, dateOf, keyOf, addDays, daysBetween, fmtDate, eur, INTERVALS, monthlyCost, yearlyCost, nextDue } from "./money-core.js";

export const CONTRACT_TYPES = ["monatlich kündbar", "Mindestlaufzeit", "Testzeitraum", "Prepaid"];

/** Felder, die abo_bearbeiten / das Formular ändern dürfen (keine Löschung, keine Passwörter). */
export const EDIT_FIELDS = [
  "name", "what", "amount", "interval", "next", "category", "startDate", "contractType", "minTermEnd", "contractEnd",
  "noticeDays", "noticeText", "autoRenew", "trialEnd", "cancelUrl", "manageUrl", "cancelHow", "cancelledOn", "ended",
  "account", "remind", "paused",
];

/* ---------- Datum ---------- */

const pad = (n) => String(n).padStart(2, "0");
const lastDayOf = (y, m0) => new Date(y, m0 + 1, 0).getDate();

/** Monate addieren; ist der Tag im Zielmonat zu groß, wird auf das Monatsende gekürzt (31.01. + 1 → 28./29.02.). */
export function addMonths(key, n) {
  const [y, m, d] = String(key).split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1, 12);
  const day = Math.min(d, lastDayOf(t.getFullYear(), t.getMonth()));
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(day)}`;
}

export function endOfMonth(key) {
  const [y, m] = String(key).split("-").map(Number);
  return `${y}-${pad(m)}-${pad(lastDayOf(y, m - 1))}`;
}

export const isMonthEnd = (key) => isKey(key) && endOfMonth(key) === key;

/** Ganze Monate von a bis b (b ≥ a), angefangene zählen nicht. */
export function monthsBetween(a, b) {
  if (!isKey(a) || !isKey(b) || b < a) return 0;
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  let n = (y2 - y1) * 12 + (m2 - m1);
  // Monatsende → Monatsende zählt als ganzer Monat (30.11. → 31.12. = 1 Monat)
  if (d2 < d1 && !isMonthEnd(b)) n -= 1;
  return Math.max(0, n);
}

/** TT.MM. (kurz, für Erinnerungen) */
export const fmtShort = (key) => (isKey(key) ? fmtDate(key).slice(0, 6) : "");

/** „in 3 Tagen“ / „morgen“ / „heute“ / „vor 2 Tagen“ */
export function inDays(today, key) {
  const n = daysBetween(today, key);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}

/* ---------- Kündigungsfrist ---------- */

const NUM_WORDS = { ein: 1, eine: 1, einen: 1, einem: 1, zwei: 2, drei: 3, vier: 4, sechs: 6, zwölf: 12, zwoelf: 12 };

/**
 * Kündigungsfrist lesen: noticeDays (Zahl) hat Vorrang, sonst noticeText
 * („1 Monat zum Monatsende“, „3 Monate“, „14 Tage“, „4 Wochen“, „zum Quartalsende“).
 * → { days, months, toMonthEnd, text } | null
 */
export function parseNotice(sub) {
  const s = sub || {};
  const txt = String(s.noticeText || "").toLowerCase().trim();
  const toMonthEnd = /monatsende|monatsletzt|ende (des|eines) (kalender)?monats|zum letzten/.test(txt);
  const nd = Number(s.noticeDays);
  if (s.noticeDays != null && s.noticeDays !== "" && Number.isFinite(nd) && nd >= 0) {
    return { days: Math.round(nd), months: 0, toMonthEnd, text: s.noticeText || `${Math.round(nd)} Tage` };
  }
  if (!txt) return null;
  const m = /(\d+|ein(?:e[nm]?)?|zwei|drei|vier|sechs|zw(?:ö|oe)lf)\s*-?\s*(monat|monate|monaten|mon\b|woche|wochen|tag|tage|tagen)/.exec(txt);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]] || 1;
    if (/^mon/.test(m[2])) return { days: 0, months: n, toMonthEnd, text: s.noticeText };
    if (/^woche/.test(m[2])) return { days: n * 7, months: 0, toMonthEnd, text: s.noticeText };
    return { days: n, months: 0, toMonthEnd, text: s.noticeText };
  }
  if (/quartal/.test(txt)) return { days: 0, months: 3, toMonthEnd: true, text: s.noticeText };
  if (/jederzeit|täglich|sofort|keine/.test(txt)) return { days: 0, months: 0, toMonthEnd: false, text: s.noticeText };
  return null;
}

/** Spätester Tag, an dem die Kündigung ankommen muss, damit der Vertrag zum Tag endKey endet. */
export function cancelDeadline(endKey, notice) {
  if (!isKey(endKey)) return null;
  if (!notice) return endKey;
  let k = endKey;
  if (notice.months) k = addMonths(endKey, -notice.months);
  if (notice.months && isMonthEnd(endKey)) k = endOfMonth(k); // 31.03. − 1 Monat → 28./29.02.
  if (notice.days) k = addDays(k, -notice.days);
  return k;
}

/** Frühestes Vertragsende, wenn heute (oder am Tag fromKey) gekündigt wird – nur aus der Frist. */
export function earliestEnd(fromKey, notice) {
  if (!isKey(fromKey)) return null;
  if (!notice) return fromKey;
  let k = fromKey;
  if (notice.months) k = addMonths(k, notice.months);
  if (notice.days) k = addDays(k, notice.days);
  if (notice.toMonthEnd) k = endOfMonth(k);
  return k;
}

/* ---------- Vertragsart ---------- */

/** Vertragsart aus dem Feld oder aus den vorhandenen Angaben erraten (alte Abos). */
export function contractTypeOf(sub) {
  const s = sub || {};
  if (CONTRACT_TYPES.includes(s.contractType)) return s.contractType;
  if (isKey(s.trialEnd)) return "Testzeitraum";
  if (isKey(s.minTermEnd)) return "Mindestlaufzeit";
  return "monatlich kündbar";
}

const PERIOD_MONTHS = { week: 1, month: 1, quarter: 3, year: 12 };

/**
 * Aktuelles Vertragsende eines Mindestlaufzeit-Vertrags (oder Prepaid).
 * Ist die Mindestlaufzeit vorbei und verlängert sich der Vertrag automatisch, rollt das Ende um
 * jeweils eine Abrechnungsperiode weiter (Jahresabo → 12 Monate, sonst 1 Monat), bis es ≥ heute ist.
 */
export function termEnd(sub, today) {
  const s = sub || {};
  const base = isKey(s.contractEnd) ? s.contractEnd : isKey(s.minTermEnd) ? s.minTermEnd : null;
  if (!base) return null;
  if (base >= today || s.autoRenew === false || contractTypeOf(s) === "Prepaid") return base;
  const step = PERIOD_MONTHS[s.interval] || 1;
  const monthEnd = isMonthEnd(base);
  let k = base, guard = 0, i = 0;
  while (k < today && guard++ < 600) {
    i += step;
    k = addMonths(base, i);
    if (monthEnd) k = endOfMonth(k);
  }
  return k;
}

/** Nächste Abbuchung ab heute (überspringt Vergangenes; null wenn keine mehr). */
export function nextCharge(sub, today) {
  const s = sub || {};
  if (s.paused || !isKey(s.next)) return null;
  let k = s.next, guard = 0;
  const anchor = s.interval === "week" ? null : s.day || dateOf(s.next).getDate();
  while (k < today && guard++ < 600) k = nextDue(k, s.interval, anchor);
  if (isKey(s.ended) && k > s.ended) return null;
  return k;
}

/** Ist das Abo zum Stichtag (noch) aktiv und kostet Geld? */
export function isActive(sub, today) {
  const s = sub || {};
  if (s.paused) return false;
  if (isKey(s.ended) && s.ended < today) return false;
  return true;
}

/**
 * Wann endet das Abo, wenn heute gekündigt wird? (Vorschlag für „Als gekündigt markieren“)
 * Ergebnis = letzter Tag, an dem es noch läuft.
 */
export function cancelEndDate(sub, today) {
  const s = sub || {};
  const type = contractTypeOf(s);
  const notice = parseNotice(s);
  const nc = nextCharge(s, today);
  if (type === "Testzeitraum" && isKey(s.trialEnd) && s.trialEnd >= today) {
    // nie über die erste Abbuchung hinaus
    if (nc && nc <= s.trialEnd) { const k = addDays(nc, -1); return k < today ? today : k; }
    return s.trialEnd;
  }
  if (type === "Mindestlaufzeit" || type === "Prepaid") {
    const end = termEnd(s, today);
    if (end) {
      const dl = cancelDeadline(end, notice);
      if (type === "Prepaid" || s.autoRenew === false || !dl || today <= dl) return end;
      // Frist für dieses Ende verpasst → nächste Periode
      const step = PERIOD_MONTHS[s.interval] || 1;
      let k = addMonths(end, step);
      if (isMonthEnd(end)) k = endOfMonth(k);
      return k;
    }
  }
  // monatlich kündbar: mit Frist ab heute, sonst bis zum Tag vor der nächsten Abbuchung
  if (notice && (notice.months || notice.days || notice.toMonthEnd)) return earliestEnd(today, notice);
  if (nc) return addDays(nc, -1) < today ? today : addDays(nc, -1);
  return today;
}

/* ---------- „Wie lange noch“ ---------- */

function monthsLeftText(today, end) {
  const n = monthsBetween(today, end);
  if (n >= 1) return `noch ${n} ${n === 1 ? "Monat" : "Monate"}`;
  const d = daysBetween(today, end);
  return d === 0 ? "endet heute" : d === 1 ? "noch 1 Tag" : `noch ${d} Tage`;
}

/**
 * Statuszeile und Fristen eines Abos.
 * → { kind: "monthly"|"term"|"trial"|"prepaid"|"cancelled"|"ended"|"paused",
 *     line, end?, deadline?, next?, daysToDeadline?, urgent }
 */
export function subStatus(sub, today) {
  const s = sub || {};
  const iv = INTERVALS[s.interval] || "monatlich";
  const nc = nextCharge(s, today);
  if (isKey(s.cancelledOn) || (isKey(s.ended) && !s.paused)) {
    const end = isKey(s.ended) ? s.ended : null;
    const parts = [isKey(s.cancelledOn) ? `gekündigt am ${fmtDate(s.cancelledOn)}` : "gekündigt"];
    if (end) parts.push(end >= today ? `läuft aus am ${fmtDate(end)}` : `ausgelaufen am ${fmtDate(end)}`);
    return { kind: end && end < today ? "ended" : "cancelled", line: parts.join(", "), end, next: nc, urgent: false };
  }
  if (s.paused) {
    if (isKey(s.ended)) return { kind: "ended", line: `beendet am ${fmtDate(s.ended)}`, end: s.ended, urgent: false };
    return { kind: "paused", line: "pausiert – wird nicht gebucht", urgent: false };
  }
  const type = contractTypeOf(s);
  const notice = parseNotice(s);
  if (type === "Testzeitraum" && isKey(s.trialEnd)) {
    const d = daysBetween(today, s.trialEnd);
    if (d >= 0) {
      const deadline = addDays(s.trialEnd, -1) < today ? today : addDays(s.trialEnd, -1);
      const when = d === 0 ? "endet heute" : d === 1 ? "endet morgen" : `endet in ${d} Tagen`;
      const after = Number(s.amount) > 0 ? ` – danach ${eur(s.amount)} ${iv}` : "";
      return { kind: "trial", line: `Testzeitraum ${when} (${fmtDate(s.trialEnd)})${after}`, end: s.trialEnd, deadline, next: nc, daysToDeadline: daysBetween(today, deadline), urgent: d <= 3 };
    }
    // Testzeitraum vorbei → normal weiter
  }
  if (type === "Prepaid") {
    const end = termEnd(s, today) || nc;
    if (!end) return { kind: "prepaid", line: "Prepaid – kein Ablaufdatum eingetragen", urgent: false };
    const renew = s.autoRenew ? ", verlängert sich automatisch" : ", keine automatische Verlängerung";
    return { kind: "prepaid", line: `Prepaid – bezahlt bis ${fmtDate(end)} (${monthsLeftText(today, end)})${renew}`, end, next: s.autoRenew ? nc : null, urgent: false };
  }
  if (type === "Mindestlaufzeit") {
    const end = termEnd(s, today);
    if (end) {
      const deadline = cancelDeadline(end, notice);
      const dd = deadline ? daysBetween(today, deadline) : null;
      let line = `Vertrag bis ${fmtDate(end)} (${monthsLeftText(today, end)})`;
      if (deadline && dd >= 0) line += ` · spätestens kündigen bis ${fmtDate(deadline)}`;
      else if (deadline && dd < 0) line += ` · Kündigungsfrist dafür vorbei (${fmtDate(deadline)})${s.autoRenew === false ? "" : " – verlängert sich"}`;
      if (s.autoRenew === false) line += " · endet automatisch";
      return { kind: "term", line, end, deadline: deadline && dd >= 0 ? deadline : null, next: nc, daysToDeadline: dd, urgent: dd != null && dd >= 0 && dd <= 14 };
    }
  }
  // monatlich kündbar (oder Mindestlaufzeit ohne Datum)
  let line = `läuft ${iv}`;
  if (nc) line += `, nächste Abbuchung am ${fmtDate(nc)}`;
  let deadline = null;
  if (notice && (notice.months || notice.days || notice.toMonthEnd)) {
    const end = earliestEnd(today, notice);
    line += ` – kündbar mit ${notice.text || "Frist"} (frühestens zum ${fmtDate(end)})`;
  } else if (nc) {
    deadline = addDays(nc, -1) < today ? today : addDays(nc, -1);
    line += ` – jederzeit kündbar bis ${fmtDate(deadline)}`;
  } else line += " – jederzeit kündbar";
  return { kind: "monthly", line, next: nc, deadline, daysToDeadline: deadline ? daysBetween(today, deadline) : null, urgent: false };
}

/* ---------- Übersicht ---------- */

/** Summen und Listen für den Kopf der Abo-Seite. */
export function subsSummary(subs, today, { horizon = 45 } = {}) {
  const list = (subs || []).filter((s) => s && !s.deleted);
  // laufende Testzeiträume kosten (noch) nichts → nicht in den Summen, eigene Liste
  const inTrial = (s) => contractTypeOf(s) === "Testzeitraum" && isKey(s.trialEnd) && s.trialEnd >= today;
  const active = list.filter((s) => isActive(s, today) && !inTrial(s));
  const perMonth = active.reduce((a, s) => a + monthlyCost(s), 0);
  const perYear = active.reduce((a, s) => a + yearlyCost(s), 0);
  const deadlines = [], trials = [];
  for (const s of list) {
    const st = subStatus(s, today);
    if (st.kind === "term" && st.deadline && st.daysToDeadline <= horizon) deadlines.push({ sub: s, date: st.deadline, end: st.end, days: st.daysToDeadline });
    if (st.kind === "trial") trials.push({ sub: s, date: st.end, deadline: st.deadline, days: daysBetween(today, st.end) });
  }
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { active, perMonth: Math.round(perMonth * 100) / 100, perYear: Math.round(perYear * 100) / 100, deadlines: deadlines.sort(byDate), trials: trials.sort(byDate) };
}

/* ---------- Erinnerungen (Planer) ---------- */

export const REMIND_DAYS_BEFORE = 3;
/** Ab wie vielen Tagen vor der Frist die Erinnerung angelegt wird. */
export const REMIND_LEAD = 31;

/** Planer-ID für die Erinnerung (gleiche ID auf allen Geräten → nie doppelt). */
export const reminderId = (subId, deadline) => `abo_${String(subId).replace(/[^\w-]/g, "")}_${String(deadline).replace(/-/g, "")}`;

/**
 * Soll für dieses Abo jetzt eine Erinnerung angelegt werden?
 * Nur für Mindestlaufzeit-Verträge (Kündigungsfrist) und Testzeiträume, einmal pro Frist (remindedFor).
 * → { id, deadline, date, title, note } | null
 */
export function reminderFor(sub, today) {
  const s = sub || {};
  if (s.remind === false || s.paused || isKey(s.cancelledOn) || (isKey(s.ended) && !s.paused)) return null;
  const st = subStatus(s, today);
  if (!(st.kind === "term" || st.kind === "trial") || !st.deadline) return null;
  if (s.remindedFor === st.deadline) return null;
  const dd = daysBetween(today, st.deadline);
  if (dd < 0 || dd > REMIND_LEAD) return null;
  const date = addDays(st.deadline, -REMIND_DAYS_BEFORE) < today ? today : addDays(st.deadline, -REMIND_DAYS_BEFORE);
  const name = s.name || "Abo";
  const title = `${name} kündigen bis ${fmtShort(st.deadline)}`;
  const bits = [];
  if (st.kind === "trial") bits.push(`Testzeitraum endet am ${fmtDate(st.end)}${Number(s.amount) > 0 ? ` – danach ${eur(s.amount)} ${INTERVALS[s.interval] || "monatlich"}` : ""}.`);
  else bits.push(`Vertrag bis ${fmtDate(st.end)} – sonst verlängert er sich.`);
  bits.push("Nur kündigen, wenn du es nicht mehr brauchst.");
  if (s.cancelUrl) bits.push(`Kündigen: ${s.cancelUrl}`);
  return { id: reminderId(s.id, st.deadline), deadline: st.deadline, date, title, note: bits.join(" ") };
}

/* ---------- Text für Claude / Teilen ---------- */

export function priceText(sub) {
  const a = Number(sub && sub.amount) || 0;
  const iv = INTERVALS[sub && sub.interval] || "monatlich";
  let t = `${eur(a)} ${iv}`;
  if (sub && sub.interval && sub.interval !== "month") t += ` (≈ ${eur(monthlyCost(sub))}/Monat)`;
  return t;
}

/** Mehrzeilige Beschreibung eines Abos (für abos_lesen). */
export function describeSub(sub, today) {
  const s = sub || {};
  const st = subStatus(s, today);
  const out = [`${s.name || "Abo"}${s.what ? ` – ${s.what}` : ""}`];
  out.push(`  Preis: ${priceText(s)}`);
  out.push(`  Vertragsart: ${contractTypeOf(s)}${s.autoRenew === true ? ", verlängert sich automatisch" : s.autoRenew === false ? ", verlängert sich nicht" : ""}`);
  out.push(`  Wie lange noch: ${st.line}`);
  if (st.deadline && (st.kind === "term" || st.kind === "trial")) out.push(`  Kündigen spätestens bis: ${fmtDate(st.deadline)} (${inDays(today, st.deadline)})`);
  if (isKey(s.startDate)) out.push(`  Seit: ${fmtDate(s.startDate)}`);
  const notice = parseNotice(s);
  if (notice) out.push(`  Kündigungsfrist: ${notice.text || (notice.days ? notice.days + " Tage" : "")}`);
  if (s.account) out.push(`  Konto/Login: ${s.account} (Passwort steht ggf. im Passwort-Tresor der App)`);
  if (s.cancelUrl) out.push(`  Kündigungslink: ${s.cancelUrl}`);
  if (s.manageUrl && s.manageUrl !== s.cancelUrl) out.push(`  Verwalten: ${s.manageUrl}`);
  if (s.cancelHow) out.push(`  So kündigst du: ${String(s.cancelHow).replace(/\s*\n\s*/g, " / ")}`);
  return out;
}

/** Datumsschlüssel (Hilfe für Tests/Aufrufer). */
export const keyFromDate = keyOf;
