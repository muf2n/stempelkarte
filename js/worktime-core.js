// Update 10c – Arbeitszeit-Pro: reine Logik ohne DOM (auch für node --test und den MCP-Server).
// Prognose (Soll/Ist Woche & Monat, Saldo bis Monatsende), Was-wäre-wenn, Änderungsprotokoll (entry.history),
// Monatsabschluss (settings.closedMonths), Konten, vergessene Stempelungen, Pausenhinweis.
// Alle Rechnungen benutzen js/util.js (Tagessoll, Feiertage, Berufsschule) – dieselben Regeln wie das Überstundenkonto:
// vergangene Tage Gutschrift − Soll, heute nur die Gutschrift (Soll erst ab morgen).
import { dayKey, startOfDay, dailyTargetMin, creditMin, netMin, isPrivateTrip, clock, hm, WD, MONTHS } from "./util.js";

const RE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_MONTH = /^\d{4}-\d{2}$/;
export const HISTORY_CAP = 30;
export const LONG_SHIFT_MIN = 12 * 60;

/** "YYYY-MM-DD" → Date (00:00 lokal) oder null. */
export function keyDate(k) {
  const m = RE_KEY.exec(String(k || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function addDayKey(k, n) {
  const d = keyDate(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
function eachKey(fromK, toK, fn) {
  for (let k = fromK, i = 0; k <= toK && i < 4000; k = addDayKey(k, 1), i++) fn(k, keyDate(k));
}
export function monthKeyOf(ts) {
  const d = ts instanceof Date ? ts : new Date(Number(ts));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function monthBounds(mk) {
  const [y, m] = mk.split("-").map(Number);
  const from = new Date(y, m - 1, 1), last = new Date(y, m, 0);
  return { from, last, fromK: dayKey(from), lastK: dayKey(last) };
}
function mondayKey(k) {
  const d = keyDate(k);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d);
}

/* ---------- Grundlagen ---------- */

const isWork = (e) => !e.kind || e.kind === "work";
const valid = (e) => e && Number.isFinite(e.start) && !isPrivateTrip(e);

/** Gutschrift je Tag (dayKey → Minuten) inkl. laufender Schicht (runningNetMin). */
export function creditsByDay(entries, running = null, runningNetMin = 0) {
  const m = new Map();
  for (const e of entries || []) {
    if (!valid(e)) continue;
    const k = dayKey(e.start);
    m.set(k, (m.get(k) || 0) + creditMin(e));
  }
  if (running && Number.isFinite(running.start)) {
    const k = dayKey(running.start);
    m.set(k, (m.get(k) || 0) + Math.max(0, Number(runningNetMin) || 0));
  }
  return m;
}

/** Tage mit Abwesenheit (Urlaub/Krank/ZA/Feiertag/Schule) → Set der dayKeys. */
function absenceDays(entries) {
  const s = new Set();
  for (const e of entries || []) if (valid(e) && !isWork(e)) s.add(dayKey(e.start));
  return s;
}

/** Kontobeginn wie overview.js: settings.balanceStart oder erster Eintrag. */
export function balanceStartKey(settings, entries, running = null) {
  const bs = settings && settings.balanceStart;
  if (RE_KEY.test(String(bs || ""))) return bs;
  let min = Infinity;
  for (const e of entries || []) if (e && Number.isFinite(e.start) && e.start < min) min = e.start;
  if (running && Number.isFinite(running.start) && running.start < min) min = running.start;
  return Number.isFinite(min) ? dayKey(min) : null;
}

/** Saldo von fromK bis todayK (heute nur Gutschrift). */
export function balanceBetween(fromK, todayK, credits, settings) {
  let sum = 0;
  eachKey(fromK, todayK, (k, d) => {
    sum += credits.get(k) || 0;
    if (k !== todayK) sum -= dailyTargetMin(d.getTime(), settings);
  });
  return sum;
}

/** Aktueller Kontostand (gleich wie Übersicht): {total, offset, start}. */
export function currentBalance({ entries, settings, running = null, runningNetMin = 0, now = Date.now() }) {
  const credits = creditsByDay(entries, running, runningNetMin);
  const start = balanceStartKey(settings, entries, running);
  const offset = Number(settings && settings.balanceOffsetMin) || 0;
  const todayK = dayKey(now);
  return { total: offset + (start && start <= todayK ? balanceBetween(start, todayK, credits, settings) : 0), offset, start, credits };
}

/* ---------- 1. Prognose ---------- */

/**
 * Hochrechnung ab heute bis endK (inklusive): jeder kommende Arbeitstag ohne Abwesenheit wird mit seinem Soll
 * (+ optional adjust(k, date, target) Minuten) gearbeitet; eingetragene Zukunfts-Gutschriften (z. B. Urlaub) zählen,
 * Feiertage/Schultage haben kein Soll. Heute: was zum Tagessoll noch fehlt, wird als „noch geplant“ angenommen.
 * → { end, plannedMin, futureCredit, targetMin, adjustMin, delta, workDays }
 */
export function projectTo(m, endK, adjust = null) {
  const { settings, credits, todayK } = m;
  const abs = m.absent;
  let plannedMin = 0, futureCredit = 0, targetMin = 0, adjustMin = 0, workDays = 0;
  if (endK < todayK) return { end: endK, plannedMin, futureCredit, targetMin, adjustMin, delta: 0, workDays };
  eachKey(todayK, endK, (k, d) => {
    const t = dailyTargetMin(d.getTime(), settings);
    const c = credits.get(k) || 0;
    targetMin += t;
    if (k === todayK) {
      // heutige Gutschrift steckt schon im Kontostand
      if (t > 0 && !abs.has(k)) { plannedMin += Math.max(0, t - c); workDays++; }
    } else {
      futureCredit += c;
      if (t > 0 && !abs.has(k) && c < t) { plannedMin += t - c; workDays++; }
    }
    if (adjust && t > 0 && !abs.has(k)) {
      const a = Number(adjust(k, d, t)) || 0;
      adjustMin += a;
    }
  });
  // heutige Gutschrift ist schon gebucht → nur Soll heute + kommende Tage abziehen
  const delta = plannedMin + futureCredit + adjustMin - targetMin;
  return { end: endK, plannedMin, futureCredit, targetMin, adjustMin, delta, workDays };
}

/** Modell für Prognose/Was-wäre-wenn. */
export function model({ entries = [], settings = {}, running = null, runningNetMin = 0, now = Date.now() } = {}) {
  const bal = currentBalance({ entries, settings, running, runningNetMin, now });
  return { settings, entries, credits: bal.credits, todayK: dayKey(now), balance: bal.total, start: bal.start, absent: absenceDays(entries) };
}

/** Soll/Ist eines Zeitraums [fromK, toK]: Ist = Gutschrift, Soll = Summe Tagessoll, sollBisHeute ohne heute. */
function sollIst(m, fromK, toK) {
  let ist = 0, soll = 0, sollPast = 0, sollToday = 0;
  eachKey(fromK, toK, (k, d) => {
    const t = dailyTargetMin(d.getTime(), m.settings);
    soll += t;
    if (k < m.todayK) sollPast += t;
    if (k === m.todayK) sollToday = t;
    if (k <= m.todayK) ist += m.credits.get(k) || 0;
  });
  return { ist, soll, sollPast, sollToday, open: Math.max(0, soll - ist) };
}

/**
 * Prognose für die Übersicht: Woche (Mo–So) und Monat mit Soll/Ist, offen,
 * sowie der erwartete Kontostand am Monatsende, wenn du ab jetzt nach Soll arbeitest.
 */
export function forecast(input) {
  const m = model(input);
  const ws = mondayKey(m.todayK), we = addDayKey(ws, 6);
  const mk = m.todayK.slice(0, 7);
  const { fromK, lastK } = monthBounds(mk);
  const week = sollIst(m, ws, we);
  const month = sollIst(m, fromK, lastK);
  const proj = projectTo(m, lastK);
  // Monatssaldo bisher (wie Übersicht „Diesen Monat“) → am Monatsende
  const clip = (k) => (m.start && k < m.start ? m.start : k);
  const monthSoFar = m.start ? balanceBetween(clip(fromK), m.todayK, m.credits, m.settings) : 0;
  return {
    today: m.todayK, balance: m.balance,
    week: { from: ws, to: we, ...week },
    month: { key: mk, from: fromK, to: lastK, ...month, soFar: monthSoFar, endDiff: monthSoFar + proj.delta },
    endOfMonth: { key: lastK, balance: m.balance + proj.delta, delta: proj.delta, workDays: proj.workDays, futureCredit: proj.futureCredit },
  };
}

/* ---------- 2. Was-wäre-wenn ---------- */

/**
 * rule = { weekdays: [0..6] (leer = alle Arbeitstage), deltaMin (± Minuten pro Tag), until: "YYYY-MM-DD", from? }
 * → { until, base, result, diff, days } – base = Prognose ohne Änderung, result = mit Änderung.
 */
export function whatIf(input, rule) {
  const m = model(input);
  const until = RE_KEY.test(String(rule && rule.until || "")) ? rule.until : null;
  if (!until) return { error: "Bitte ein gültiges Datum wählen." };
  if (until < m.todayK) return { error: "Das Datum liegt in der Vergangenheit." };
  const from = RE_KEY.test(String(rule.from || "")) && rule.from > m.todayK ? rule.from : m.todayK;
  const wds = Array.isArray(rule.weekdays) ? rule.weekdays.map(Number).filter((x) => x >= 0 && x <= 6) : [];
  const dm = Math.round(Number(rule.deltaMin) || 0);
  let days = 0;
  const base = projectTo(m, until);
  const adj = projectTo(m, until, (k, d) => {
    if (k < from) return 0;
    if (wds.length && !wds.includes(d.getDay())) return 0;
    days++;
    return dm;
  });
  return { until, from, base: m.balance + base.delta, result: m.balance + adj.delta, diff: adj.adjustMin, days, deltaMin: dm, weekdays: wds };
}

/** Kurztext einer Regel: "jeden Fr +0:30 h bis 31.12.2026". */
export function whatIfLabel(rule) {
  const wds = Array.isArray(rule.weekdays) ? rule.weekdays : [];
  const dm = Math.round(Number(rule.deltaMin) || 0);
  const d = keyDate(rule.until);
  const when = wds.length ? "jeden " + [...wds].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => WD[x]).join(", ") : "jeden Arbeitstag";
  return `${when} ${dm < 0 ? "−" : "+"}${hm(Math.abs(dm))} h bis ${d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "?"}`;
}

/* ---------- 3. Änderungsprotokoll ---------- */

export const HISTORY_BY = ["manuell", "gps", "assistent", "import"];
export const BY_LABEL = { manuell: "✍️ von dir", gps: "📍 GPS/Automatik", assistent: "✨ Assistent", import: "📥 Import" };
const FIELDS = [
  ["kind", "Art"], ["start", "Beginn"], ["end", "Ende"], ["pauseMin", "Pause"], ["place", "Ort"],
  ["creditMin", "Gutschrift"], ["note", "Notiz"], ["people", "Mit wem"],
];
export const FIELD_LABEL = Object.fromEntries(FIELDS);

function normVal(f, v) {
  if (v == null || v === "") return null;
  if (f === "people") return Array.isArray(v) ? v.filter(Boolean).map(String).join(", ") || null : String(v);
  if (f === "start" || f === "end" || f === "pauseMin" || f === "creditMin") { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; }
  if (f === "note") return String(v).slice(0, 120);
  return String(v);
}

/** Geänderte Felder prev → next: [{field, from, to}] (nur bekannte Felder, Notiz gekürzt). */
export function diffEntry(prev, next) {
  const out = [];
  for (const [f] of FIELDS) {
    const a = normVal(f, prev ? prev[f] : null), b = normVal(f, next ? next[f] : null);
    if (f === "kind" && (a || "work") === (b || "work")) continue;
    if (a !== b) out.push({ field: f, from: a, to: b });
  }
  return out;
}

/**
 * Hängt einen Protokolleintrag an (höchstens HISTORY_CAP, älteste fallen weg). Gibt eine neue Eintragskopie zurück.
 * opts = { by, at, reason, op: "neu"|"edit"|"delete", prev }. Bei "edit" ohne Änderung und ohne Grund: unverändert.
 */
export function withHistory(next, opts = {}) {
  const by = HISTORY_BY.includes(opts.by) ? opts.by : "manuell";
  const op = ["neu", "edit", "delete"].includes(opts.op) ? opts.op : "edit";
  const prev = opts.prev || null;
  const reason = String(opts.reason || "").trim().slice(0, 140);
  const base = Array.isArray(prev && prev.history) ? prev.history : Array.isArray(next && next.history) ? next.history : [];
  const changes = op === "edit" ? diffEntry(prev, next) : [];
  if (op === "edit" && !changes.length && !reason) return { ...next, history: base.slice(-HISTORY_CAP) };
  const rec = { at: Number(opts.at) || Date.now(), by, op };
  if (changes.length) rec.changes = changes;
  if (reason) rec.reason = reason;
  const history = [...base, rec].slice(-HISTORY_CAP);
  return { ...next, history };
}

function fmtVal(f, v) {
  if (v == null) return "–";
  if (f === "start" || f === "end") return clock(v);
  if (f === "pauseMin") return v + " min";
  if (f === "creditMin") return hm(v) + " h";
  if (f === "kind") return ({ work: "Arbeit", urlaub: "Urlaub", krank: "Krank", feiertag: "Feiertag", zeitausgleich: "Zeitausgleich", schule: "Schule" })[v] || v;
  return String(v);
}
/** "Beginn 07:00 → 07:30" */
export function fmtChange(c) {
  return `${FIELD_LABEL[c.field] || c.field} ${fmtVal(c.field, c.from)} → ${fmtVal(c.field, c.to)}`;
}
/** Protokoll für die Anzeige (neueste zuerst): [{when, by, text, reason}] */
export function historyRows(entry) {
  const h = Array.isArray(entry && entry.history) ? entry.history : [];
  return h.slice().reverse().map((r) => {
    const d = new Date(Number(r.at) || 0);
    const when = `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()} ${clock(d.getTime())}`;
    const text = r.op === "neu" ? "angelegt" : r.op === "delete" ? "gelöscht" : (Array.isArray(r.changes) && r.changes.length ? r.changes.map(fmtChange).join(" · ") : "bearbeitet");
    return { when, by: BY_LABEL[r.by] || BY_LABEL.manuell, byId: r.by || "manuell", text, reason: r.reason || "" };
  });
}

/** Stammt der Eintrag (zuletzt) von dir? true, wenn ein manueller Protokolleintrag existiert oder kein Protokoll. */
export function isManual(e) {
  const h = Array.isArray(e && e.history) ? e.history : [];
  if (!h.length) return !(e && e.src === "gps");
  return h.some((r) => r && (r.by === "manuell" || r.by === "import" || r.by === "assistent"));
}

/**
 * Schutz vor GPS-Automatik: überschneidet sich [start, end] mit einem vorhandenen Eintrag (Arbeit oder Abwesenheit
 * am selben Tag)? → { ok, start (ggf. nach hinten verschoben), conflict: Eintrag|null, reason }
 * Ein Eintrag, der jetzt noch läuft (end > now) bzw. eine Abwesenheit heute → nicht automatisch einstempeln.
 */
export function guardAutoStart(entries, start, now = Date.now()) {
  let s = Number(start);
  const dk = dayKey(now);
  let conflict = null;
  for (const e of entries || []) {
    if (!valid(e)) continue;
    if (!isWork(e)) {
      if (dayKey(e.start) === dk) return { ok: false, start: s, conflict: e, reason: "abwesend" };
      continue;
    }
    const en = Number(e.end);
    if (!Number.isFinite(en)) continue;
    if (e.start <= now && en > now) return { ok: false, start: s, conflict: e, reason: "laeuft" };
    if (e.start < now && en > s) { s = Math.max(s, en); conflict = e; }
  }
  if (s > now) return { ok: false, start: s, conflict, reason: "laeuft" };
  return { ok: true, start: s, conflict, reason: conflict ? "verschoben" : "" };
}

/* ---------- 4. Monatsabschluss ---------- */

/** settings.closedMonths → Map "YYYY-MM" → {at, totals} (null/false = wieder offen). */
export function readClosed(settings) {
  const c = settings && settings.closedMonths;
  const out = new Map();
  if (!c || typeof c !== "object") return out;
  for (const [k, v] of Object.entries(c)) if (RE_MONTH.test(k) && v && typeof v === "object") out.set(k, v);
  return out;
}
export function isClosedMonth(settings, tsOrKey) {
  const mk = typeof tsOrKey === "string" ? tsOrKey.slice(0, 7) : monthKeyOf(tsOrKey);
  return readClosed(settings).has(mk);
}

/** Summen eines Monats (für Abschluss und Anzeige). */
export function monthTotals({ entries = [], settings = {} } = {}, mk) {
  const { fromK, lastK } = monthBounds(mk);
  let credit = 0, net = 0, pause = 0, target = 0;
  const work = new Set(), urlaub = new Set(), krank = new Set(), za = new Set();
  for (const e of entries) {
    if (!valid(e)) continue;
    const k = dayKey(e.start);
    if (k < fromK || k > lastK) continue;
    credit += creditMin(e);
    if (isWork(e)) { const n = netMin(e); net += n; pause += Number(e.pauseMin) || 0; if (n > 0) work.add(k); }
    else if (e.kind === "urlaub") urlaub.add(k);
    else if (e.kind === "krank") krank.add(k);
    else if (e.kind === "zeitausgleich") za.add(k);
  }
  eachKey(fromK, lastK, (k, d) => { target += dailyTargetMin(d.getTime(), settings); });
  const r = (x) => Math.round(x);
  return { ist: r(credit), soll: r(target), diff: r(credit - target), net: r(net), pause: r(pause), workDays: work.size, urlaub: urlaub.size, krank: krank.size, za: za.size };
}

/** Neuer Wert für settings.closedMonths nach Abschluss (ganze Map, damit lokal und in Firestore gleich). */
export function closeMonth(settings, mk, totals, at = Date.now(), balance = null) {
  const cur = settings && settings.closedMonths && typeof settings.closedMonths === "object" ? settings.closedMonths : {};
  const rec = { at, totals };
  if (Number.isFinite(balance)) rec.balance = Math.round(balance);
  return { ...cur, [mk]: rec };
}
/** Monat wieder öffnen: Wert null (Firestore-merge überschreibt so den alten Eintrag). */
export function reopenMonth(settings, mk) {
  const cur = settings && settings.closedMonths && typeof settings.closedMonths === "object" ? settings.closedMonths : {};
  return { ...cur, [mk]: null };
}
/** Kontostand am Ende eines Monats (letzter Tag inkl. Soll). */
export function balanceAtMonthEnd({ entries = [], settings = {} } = {}, mk) {
  const { lastK } = monthBounds(mk);
  const credits = creditsByDay(entries);
  const start = balanceStartKey(settings, entries);
  const offset = Number(settings && settings.balanceOffsetMin) || 0;
  if (!start || start > lastK) return offset;
  return offset + balanceBetween(start, addDayKey(lastK, 1), credits, settings) - (credits.get(addDayKey(lastK, 1)) || 0);
}
export function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/* ---------- 5. Konten ---------- */

/** Überstunden/Minusstunden aus dem Kontostand. */
export function hourAccounts(balance) {
  const b = Math.round(Number(balance) || 0);
  return { plus: Math.max(0, b), minus: Math.max(0, -b) };
}

/* ---------- 7. Vergessene Stempelungen ---------- */

/**
 * Lücken der letzten `days` Tage (ohne heute): Arbeitstage mit Soll ohne jeden Eintrag, Schichten über 12 h,
 * Einträge ohne gültiges Ende; dazu eine laufende Schicht über 12 h.
 * → [{ key, type: "leer"|"lang"|"offen"|"laeuft", entry?, min? }] (neueste zuerst)
 */
export function missingStamps({ entries = [], settings = {}, running = null, now = Date.now(), days = 21 } = {}) {
  const todayK = dayKey(now);
  let fromK = addDayKey(todayK, -Math.max(1, Math.min(120, Math.round(days) || 21)));
  const bs = balanceStartKey(settings, entries, running);
  if (bs && bs > fromK) fromK = bs;
  const dismissed = new Set(Array.isArray(settings.worktime && settings.worktime.ignoreGaps) ? settings.worktime.ignoreGaps : []);
  const out = [];
  const byDay = new Map();
  for (const e of entries || []) {
    if (!e || !Number.isFinite(e.start)) continue;
    const k = dayKey(e.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
    if (k < fromK || k > todayK || isPrivateTrip(e)) continue;
    if (isWork(e)) {
      const en = Number(e.end);
      if (!Number.isFinite(en) || en <= e.start) out.push({ key: k, type: "offen", entry: e });
      else if (netMin(e) > LONG_SHIFT_MIN || (en - e.start) / 60000 > LONG_SHIFT_MIN) out.push({ key: k, type: "lang", entry: e, min: Math.round((en - e.start) / 60000) });
    }
  }
  const yesterday = addDayKey(todayK, -1);
  if (fromK <= yesterday) {
    eachKey(fromK, yesterday, (k, d) => {
      if (byDay.has(k)) return;
      if (dailyTargetMin(d.getTime(), settings) <= 0) return; // frei, Feiertag, Schule
      if (dismissed.has(k)) return;
      out.push({ key: k, type: "leer" });
    });
  }
  if (running && Number.isFinite(running.start) && (now - running.start) / 60000 > LONG_SHIFT_MIN) {
    out.push({ key: dayKey(running.start), type: "laeuft", min: Math.round((now - running.start) / 60000) });
  }
  return out.filter((x) => !(x.type !== "leer" && x.entry && dismissed.has(x.entry.id))).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/* ---------- 8. Pause ---------- */

export const PAUSE_HINT = "Laut AZG gibt's ab mehr als 6 h Arbeitszeit 30 Min Pause – prüf deinen Kollektivvertrag.";

/** Hinweis für einen Eintrag: netto > 6 h und Pause < 30 min → Text, sonst "". Nie eine sichere Rechtsauskunft. */
export function pauseHint(durMin, pauseMin) {
  const dur = Number(durMin) || 0, p = Number(pauseMin) || 0;
  if (dur - p > 360 && p < 30) return "☕ " + PAUSE_HINT;
  return "";
}
/** Minuten ohne Pause, ab denen erinnert wird (settings.pauseAfterMin, 240–600, Standard 360). */
export function pauseAfterMin(settings) {
  const v = Math.round(Number(settings && settings.pauseAfterMin));
  return Number.isFinite(v) && v >= 240 && v <= 600 ? v : 360;
}

/* ---------- Einstellungen ---------- */

/** settings.worktime = { leaveLabel, gapDays, ignoreGaps[] } mit Standardwerten. */
export function readWorktime(settings) {
  const w = settings && settings.worktime && typeof settings.worktime === "object" ? settings.worktime : {};
  const gd = Math.round(Number(w.gapDays));
  return {
    leaveLabel: String(w.leaveLabel || "").trim().slice(0, 30) || "Urlaub",
    gapDays: Number.isFinite(gd) && gd >= 7 && gd <= 120 ? gd : 21,
    ignoreGaps: Array.isArray(w.ignoreGaps) ? w.ignoreGaps.filter((x) => typeof x === "string").slice(-200) : [],
  };
}

export { startOfDay };
