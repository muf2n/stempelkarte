// Update 10 E – 📜 Verträge: reine Logik ohne DOM (Node-testbar, auch von Benachrichtigungen/Suche/Finanz-Planung benutzt).
// Sammlung „vertraege“ (users/{uid}/a_vertraege). Verträge = längerfristige Dinge (Handy, Strom, Versicherung, Miete, Fitness …)
// mit Laufzeit, Mindestlaufzeit, Kündigungsfrist und automatischer Verlängerung. Abos (money_subs) bleiben, wo sie sind –
// ein Vertrag kann mit einem Abo verknüpft sein (subId), dann zählen die Kosten nur einmal (beim Abo).
//
// Felder (alle optional außer name):
//   name, provider, kind, customerNo, start (JJJJ-MM-TT), minMonths (Mindestlaufzeit in Monaten), end (festes Ende),
//   autoRenew (Standard true), renewMonths (Verlängerung, Standard 12), noticeText / noticeDays (Kündigungsfrist),
//   amount, interval ("month"|"quarter"|"year"|"week"), prices: [{from, amount, note}], cancelledOn, endsOn (gekündigt zum),
//   remind (Standard an), remindDays (Vorlauf, Standard 30), notes, subId, contactId, created, updated
import { isKey, addDays, daysBetween, fmtDate, round2, monthlyCost, yearlyCost, INTERVALS } from "./money-core.js";
import { addMonths, endOfMonth, isMonthEnd, parseNotice, cancelDeadline, earliestEnd } from "./subs-core.js";

export const KINDS = [
  { id: "handy", e: "📱", label: "Handy" },
  { id: "internet", e: "🌐", label: "Internet & TV" },
  { id: "strom", e: "⚡", label: "Strom & Gas" },
  { id: "versicherung", e: "🛡️", label: "Versicherung" },
  { id: "miete", e: "🏠", label: "Miete & Wohnen" },
  { id: "fitness", e: "🏋️", label: "Fitness & Verein" },
  { id: "kredit", e: "🏦", label: "Kredit & Leasing" },
  { id: "sonstiges", e: "📜", label: "Sonstiges" },
];
export const kindById = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];
export const DEFAULT_REMIND_DAYS = 30;
const s = (v) => String(v ?? "").trim();
const num = (v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Gespeicherten Vertrag mit Standardwerten auffüllen. */
export function normContract(x) {
  const c = x && typeof x === "object" ? x : {};
  const interval = INTERVALS[c.interval] ? c.interval : "month";
  const prices = (Array.isArray(c.prices) ? c.prices : [])
    .filter((p) => p && isKey(p.from) && Number.isFinite(Number(p.amount)))
    .map((p) => ({ from: p.from, amount: round2(p.amount), note: s(p.note).slice(0, 120) }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return {
    id: s(c.id), name: s(c.name).slice(0, 120), provider: s(c.provider).slice(0, 120), kind: kindById(c.kind).id,
    customerNo: s(c.customerNo).slice(0, 80),
    start: isKey(c.start) ? c.start : "", end: isKey(c.end) ? c.end : "",
    minMonths: Math.max(0, Math.min(240, Math.round(num(c.minMonths) || 0))),
    autoRenew: c.autoRenew !== false,
    renewMonths: Math.max(1, Math.min(120, Math.round(num(c.renewMonths) || 12))),
    noticeText: s(c.noticeText).slice(0, 80), noticeDays: num(c.noticeDays) != null && num(c.noticeDays) >= 0 ? Math.round(num(c.noticeDays)) : null,
    amount: num(c.amount) != null ? round2(c.amount) : 0, interval, prices,
    cancelledOn: isKey(c.cancelledOn) ? c.cancelledOn : "", endsOn: isKey(c.endsOn) ? c.endsOn : "",
    remind: c.remind !== false, remindDays: Math.max(1, Math.min(180, Math.round(num(c.remindDays) || DEFAULT_REMIND_DAYS))),
    notes: s(c.notes).slice(0, 4000), subId: s(c.subId), contactId: s(c.contactId),
    created: Number(c.created) || 0, updated: Number(c.updated) || 0,
  };
}

/** Frist-Objekt für subs-core (noticeDays hat Vorrang vor noticeText). */
export const noticeOf = (c) => parseNotice({ noticeDays: c.noticeDays, noticeText: c.noticeText });

/** Erstes Vertragsende laut Mindestlaufzeit bzw. festem Ende (letzter Tag, an dem er läuft) – oder null (unbefristet). */
export function firstEnd(c) {
  if (isKey(c.end)) return c.end;
  if (isKey(c.start) && c.minMonths > 0) return addDays(addMonths(c.start, c.minMonths), -1);
  return null;
}

/**
 * Laufzeit-Stand am Tag today.
 * → { state: "laeuft"|"unbefristet"|"gekuendigt"|"beendet", end (aktuelles Laufzeitende|null), deadline (spätester Kündigungstag|null),
 *     daysToDeadline, daysToEnd, renewed (wie oft schon verlängert), canEndOn (frühestes Ende bei Kündigung heute) }
 */
export function termStatus(raw, today) {
  const c = raw && raw.interval ? raw : normContract(raw);
  const notice = noticeOf(c);
  if (c.cancelledOn) {
    const end = c.endsOn || firstEnd(c) || null;
    if (end && end < today) return { state: "beendet", end, deadline: null, daysToDeadline: null, daysToEnd: daysBetween(today, end), renewed: 0, canEndOn: null };
    return { state: "gekuendigt", end, deadline: null, daysToDeadline: null, daysToEnd: end ? daysBetween(today, end) : null, renewed: 0, canEndOn: end };
  }
  const base = firstEnd(c);
  if (!base) {
    const canEndOn = earliestEnd(today, notice);
    return { state: "unbefristet", end: null, deadline: null, daysToDeadline: null, daysToEnd: null, renewed: 0, canEndOn };
  }
  if (!c.autoRenew) {
    if (base < today) return { state: "beendet", end: base, deadline: null, daysToDeadline: null, daysToEnd: daysBetween(today, base), renewed: 0, canEndOn: null };
    const dl = cancelDeadline(base, notice);
    return { state: "laeuft", end: base, deadline: dl, daysToDeadline: dl ? daysBetween(today, dl) : null, daysToEnd: daysBetween(today, base), renewed: 0, canEndOn: base, noRenew: true };
  }
  // Automatisch verlängernd: so lange um renewMonths weiterrollen, bis die Kündigungsfrist fürs Ende noch nicht vorbei ist.
  const monthEnd = isMonthEnd(base);
  const startOfTerm = addDays(base, 1); // Verlängerungen werden vom ersten Tag nach dem Ende gerechnet
  let end = base, i = 0, guard = 0;
  while (guard++ < 600) {
    const dl = cancelDeadline(end, notice);
    if (dl >= today) break;
    i++;
    end = addDays(addMonths(startOfTerm, i * c.renewMonths), -1);
    if (monthEnd) end = endOfMonth(end);
  }
  const deadline = cancelDeadline(end, notice);
  return { state: "laeuft", end, deadline, daysToDeadline: daysBetween(today, deadline), daysToEnd: daysBetween(today, end), renewed: i, canEndOn: end };
}

/** Preis am Stichtag (letzte Preisänderung ≤ heute, sonst amount). */
export function priceAt(raw, today) {
  const c = raw && raw.interval ? raw : normContract(raw);
  let a = c.amount;
  for (const p of c.prices) if (p.from <= today) a = p.amount;
  return round2(a);
}
/** Preisverlauf inkl. Ausgangspreis: [{from, amount, note, diff}] (neueste zuletzt). */
export function priceHistory(raw) {
  const c = raw && raw.interval ? raw : normContract(raw);
  const out = [];
  let prev = null;
  const first = c.prices.length && (!c.start || c.prices[0].from > c.start) ? { from: c.start || "", amount: c.amount, note: "Start" } : null;
  for (const p of first ? [first, ...c.prices] : c.prices) {
    out.push({ ...p, diff: prev == null ? 0 : round2(p.amount - prev) });
    prev = p.amount;
  }
  return out;
}
/** Kosten pro Monat/Jahr zum aktuellen Preis. */
export const contractMonthly = (raw, today) => { const c = normContract(raw); return monthlyCost({ amount: priceAt(c, today), interval: c.interval }); };
export const contractYearly = (raw, today) => { const c = normContract(raw); return yearlyCost({ amount: priceAt(c, today), interval: c.interval }); };

/** Kostet der Vertrag (noch) Geld? (beendet → nein) */
export function isRunning(raw, today) {
  const st = termStatus(raw, today);
  return st.state !== "beendet";
}

/** Kurze Statuszeile ohne Beträge. */
export function statusLine(raw, today) {
  const c = normContract(raw);
  const st = termStatus(c, today);
  if (st.state === "beendet") return `✔️ Beendet${st.end ? ` seit ${fmtDate(st.end)}` : ""}`;
  if (st.state === "gekuendigt") return `✉️ Gekündigt${st.end ? ` – läuft bis ${fmtDate(st.end)}` : ""}`;
  if (st.state === "unbefristet") return `♾️ Unbefristet${st.canEndOn ? ` – bei Kündigung heute frühestens zum ${fmtDate(st.canEndOn)}` : ""}`;
  const d = st.daysToDeadline;
  const when = d === 0 ? "heute" : d === 1 ? "morgen" : `in ${d} Tagen`;
  if (st.noRenew) return `⏳ Endet am ${fmtDate(st.end)} (keine Verlängerung)`;
  return `${d <= 14 ? "⏰" : "📆"} Kündigen bis ${fmtDate(st.deadline)} (${when}) – sonst Verlängerung bis ${fmtDate(addDays(addMonths(addDays(st.end, 1), c.renewMonths), -1))}`;
}

/**
 * Fällige Hinweise (Benachrichtigungen): Kündigungsfrist innerhalb remindDays, Vertragsende ohne Verlängerung bald.
 * → [{ id, name, e, kind: "frist"|"ende", date, days, text, hash }]
 */
export function dueContracts(list, today) {
  const out = [];
  for (const raw of list || []) {
    const c = normContract(raw);
    if (!c.id || !c.name || !c.remind) continue;
    const st = termStatus(c, today);
    const e = kindById(c.kind).e;
    if (st.state === "laeuft" && !st.noRenew && st.deadline && st.daysToDeadline >= 0 && st.daysToDeadline <= c.remindDays) {
      out.push({ id: c.id, name: c.name, e, kind: "frist", date: st.deadline, days: st.daysToDeadline,
        text: `${e} ${c.name}: Kündigungsfrist ${st.daysToDeadline === 0 ? "endet heute" : st.daysToDeadline === 1 ? "endet morgen" : `in ${st.daysToDeadline} Tagen`} (${fmtDate(st.deadline)})`, hash: contractHash(c.id) });
    } else if ((st.state === "laeuft" && st.noRenew) || st.state === "gekuendigt") {
      if (st.end && st.daysToEnd >= 0 && st.daysToEnd <= c.remindDays) {
        out.push({ id: c.id, name: c.name, e, kind: "ende", date: st.end, days: st.daysToEnd,
          text: `${e} ${c.name}: endet ${st.daysToEnd === 0 ? "heute" : st.daysToEnd === 1 ? "morgen" : `in ${st.daysToEnd} Tagen`} – Ersatz schon geklärt?`, hash: contractHash(c.id) });
      }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Abo mit gleichem Anbieter/Namen finden (für „als Vertrag verwalten“ statt kopieren). */
export function matchSub(c, subs) {
  const norm = (t) => s(t).toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim();
  const keys = [norm(c.provider), norm(c.name)].filter((k) => k.length >= 3);
  if (!keys.length) return null;
  for (const sub of subs || []) {
    if (!sub || !sub.id || sub.ended) continue;
    const n = norm(sub.name);
    if (n.length < 3) continue;
    if (keys.some((k) => k === n || k.includes(n) || n.includes(k))) return sub;
  }
  return null;
}
/** Felder aus einem Abo übernehmen (Betrag, Intervall, Frist, Laufzeit) – nur leere Felder. */
export function fillFromSub(c, sub) {
  const out = {};
  if (!c.amount && Number(sub.amount)) { out.amount = round2(sub.amount); out.interval = INTERVALS[sub.interval] ? sub.interval : "month"; }
  if (!c.noticeText && c.noticeDays == null && (sub.noticeText || sub.noticeDays != null)) { out.noticeText = s(sub.noticeText); if (sub.noticeDays != null) out.noticeDays = sub.noticeDays; }
  if (!c.start && isKey(sub.startDate)) out.start = sub.startDate;
  if (!c.end && !c.minMonths && isKey(sub.minTermEnd)) out.end = sub.minTermEnd;
  if (!c.provider && sub.name) out.provider = s(sub.name);
  return out;
}

/** Summen der laufenden Verträge (ohne die mit Abo verknüpften – die zählen beim Abo). */
export function contractTotals(list, today) {
  let month = 0, year = 0, n = 0;
  for (const raw of list || []) {
    const c = normContract(raw);
    if (!c.id || c.subId || !isRunning(c, today)) continue;
    month += contractMonthly(c, today); year += contractYearly(c, today); n++;
  }
  return { month: round2(month), year: round2(year), n };
}

export const contractHash = (id) => `#alltag/vertraege/${encodeURIComponent(s(id))}`;
export function routeId(hash) {
  const m = /#?alltag\/vertraege\/([^?/]+)/.exec(String(hash || ""));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
export function searchText(raw) {
  const c = normContract(raw);
  return [c.name, c.provider, c.customerNo, kindById(c.kind).label, c.notes, "Vertrag Laufzeit Kündigung"].join(" ");
}
