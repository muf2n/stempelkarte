// Update 9 – Kalender: reine Logik ohne DOM (Browser UND node importierbar).
// Termine = Planer-Einträge mit kind:"termin". Rückwärtskompatible Zusatzfelder:
//   date "YYYY-MM-DD", time "HH:MM"|null, endDate "YYYY-MM-DD"|null (inkl.), endTime "HH:MM"|null, allDay bool,
//   location, note, color (Palette-Schlüssel), calendarId, reminders [Minuten vorher],
//   rrule "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;UNTIL=20270131" (UNTIL = letzter Tag, inkl.) | COUNT=n,
//   exdates ["YYYY-MM-DD" (ursprünglicher Tag)], overrides {"YYYY-MM-DD": {date,time,endDate,endTime,allDay,title,location,note,color,done}},
//   icsUid (Import-Kennung). remind/remindMin bleiben gesetzt (Push-Abfrage, alte Clients).
// Alle Datumsrechnungen laufen auf Kalendertagen (UTC-Arithmetik) mit Wanduhrzeit → sommerzeitsicher.
// Echte Zeitpunkte nur für Erinnerungen (zonedToTs, Europe/Vienna).

export const TZ = "Europe/Vienna";
const pad = (n) => String(n).padStart(2, "0");
export const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const RE_TIME = /^\d{1,2}:\d{2}$/;
export const isKey = (k) => RE_KEY.test(String(k || ""));
export const isTime = (t) => RE_TIME.test(String(t || ""));
const normTime = (t) => (isTime(t) ? String(t).padStart(5, "0") : null);

/* ---------- Kalendertage ---------- */

export function parseKey(k) { const [y, m, d] = String(k).split("-").map(Number); return { y, m, d }; }
export function ymd(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function addDays(k, n) { const { y, m, d } = parseKey(k); return ymd(y, m, d + n); }
/** b − a in Kalendertagen. */
export function diffDays(a, b) {
  const A = parseKey(a), B = parseKey(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
/** Wochentag 0 = So … 6 = Sa. */
export function wdOf(k) { const { y, m, d } = parseKey(k); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
export function mondayOf(k) { return addDays(k, -((wdOf(k) + 6) % 7)); }
export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
/** ISO-Kalenderwoche (KW). */
export function isoWeek(k) {
  const { y, m, d } = parseKey(k);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
export function toMin(t) {
  if (!isTime(t)) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}
export const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
/** "TT.MM.JJJJ" */
export function fmtKey(k) { const { y, m, d } = parseKey(k); return `${pad(d)}.${pad(m)}.${y}`; }

/* ---------- Zeitzone (Erinnerungen, ICS) ---------- */

const fmts = new Map();
function fmtFor(tz) {
  if (!fmts.has(tz)) {
    fmts.set(tz, new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return fmts.get(tz);
}
export function validTz(tz) { try { fmtFor(tz); return true; } catch { return false; } }
/** Zeitstempel → Wanduhr in tz {y,m,d,hh,mm,ss,key,time}. */
export function zoned(ts, tz = TZ) {
  const p = {};
  for (const x of fmtFor(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const hh = Number(p.hour) % 24, mm = Number(p.minute), ss = Number(p.second) || 0;
  return { y, m, d, hh, mm, ss, key: `${y}-${pad(m)}-${pad(d)}`, time: `${pad(hh)}:${pad(mm)}` };
}
/** Wanduhr in tz → Zeitstempel (Sommer-/Winterzeit; nicht existierende Zeiten werden nach vorn verschoben). */
export function zonedToTs(y, m, d, hh = 0, mm = 0, tz = TZ, ss = 0) {
  const want = Date.UTC(y, m - 1, d, hh, mm, ss);
  let ts = want;
  for (let i = 0; i < 4; i++) {
    const v = zoned(ts, tz);
    const diff = Date.UTC(v.y, v.m - 1, v.d, v.hh, v.mm, v.ss) - want;
    if (diff === 0) break;
    ts -= diff;
  }
  // doppelte Stunde (Herbst): die frühere (Sommerzeit) nehmen
  const e = zoned(ts - 3600000, tz);
  if (Date.UTC(e.y, e.m - 1, e.d, e.hh, e.mm, e.ss) === want) ts -= 3600000;
  return ts;
}
export function keyTimeToTs(k, time = "00:00", tz = TZ) {
  const { y, m, d } = parseKey(k);
  const t = toMin(time) ?? 0;
  return zonedToTs(y, m, d, Math.floor(t / 60), t % 60, tz);
}

/* ---------- RRULE ---------- */

export const RDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** "YYYYMMDD" | "YYYYMMDDTHHMMSS[Z]" | "YYYY-MM-DD" → Tag (Wien) oder null. */
export function untilKey(v) {
  const s = String(v || "").trim();
  if (isKey(s)) return s;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(s);
  if (!m) return null;
  if (m[7]) return zoned(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).key;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** RRULE-Text (Teilmenge) → {freq, interval, count, until, byday:[{wd,n}], bymonthday:[], bymonth:[]} oder null. */
export function parseRRule(src) {
  if (!src) return null;
  if (typeof src === "object") return src.freq ? { interval: 1, count: null, until: null, byday: [], bymonthday: [], bymonth: [], ...src } : null;
  const s = String(src).trim().replace(/^RRULE:/i, "");
  const kv = {};
  for (const part of s.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim();
  }
  const freq = String(kv.FREQ || "").toUpperCase();
  if (!FREQS.includes(freq)) return null;
  const interval = Math.max(1, Math.min(999, parseInt(kv.INTERVAL, 10) || 1));
  const cnt = parseInt(kv.COUNT, 10);
  const count = Number.isFinite(cnt) && cnt > 0 ? Math.min(cnt, 5000) : null;
  const until = kv.UNTIL ? untilKey(kv.UNTIL) : null;
  let setpos = parseInt(kv.BYSETPOS, 10);
  if (!Number.isFinite(setpos) || setpos === 0) setpos = null;
  const byday = [];
  for (const x of String(kv.BYDAY || "").split(",")) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(x.trim());
    if (!m) continue;
    const n = m[1] ? parseInt(m[1], 10) : (setpos && freq !== "WEEKLY" ? setpos : 0);
    if (n < -5 || n > 5) continue;
    byday.push({ wd: RDAYS.indexOf(m[2].toUpperCase()), n: freq === "WEEKLY" ? 0 : n });
  }
  const bymonthday = String(kv.BYMONTHDAY || "").split(",").map((x) => parseInt(x, 10))
    .filter((x) => Number.isFinite(x) && x !== 0 && x >= -31 && x <= 31);
  const bymonth = String(kv.BYMONTH || "").split(",").map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 12);
  return { freq, interval, count: until ? null : count, until, byday, bymonthday, bymonth };
}

/** Regel → RRULE-Text (UNTIL als Tag YYYYMMDD). */
export function formatRRule(r) {
  const x = parseRRule(r);
  if (!x) return null;
  const parts = [`FREQ=${x.freq}`];
  if (x.interval > 1) parts.push(`INTERVAL=${x.interval}`);
  if (x.byday && x.byday.length) parts.push(`BYDAY=${x.byday.map((b) => (b.n ? b.n : "") + RDAYS[b.wd]).join(",")}`);
  if (x.bymonthday && x.bymonthday.length) parts.push(`BYMONTHDAY=${x.bymonthday.join(",")}`);
  if (x.bymonth && x.bymonth.length) parts.push(`BYMONTH=${x.bymonth.join(",")}`);
  if (x.until) parts.push(`UNTIL=${x.until.replace(/-/g, "")}`);
  else if (x.count) parts.push(`COUNT=${x.count}`);
  return parts.join(";");
}

/** n-ter Wochentag wd (0=So) im Monat (n<0: von hinten) → Tag oder null. */
export function nthWeekday(y, m, wd, n) {
  const dim = daysInMonth(y, m);
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const d = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return d <= dim ? d : null;
  }
  const last = new Date(Date.UTC(y, m - 1, dim)).getUTCDay();
  const d = dim - ((last - wd + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

/** Der wievielte Wochentag im Monat ist k? → {n (1–5), last (bool)} */
export function weekdayPos(k) {
  const { y, m, d } = parseKey(k);
  return { n: Math.floor((d - 1) / 7) + 1, last: d + 7 > daysInMonth(y, m), wd: wdOf(k) };
}

function monthDays(y, m, r, startD) {
  const dim = daysInMonth(y, m);
  const out = [];
  if (r.byday && r.byday.length) {
    for (const b of r.byday) {
      if (b.n) { const d = nthWeekday(y, m, b.wd, b.n); if (d) out.push(d); }
      else for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) out.push(d);
    }
  } else {
    const list = r.bymonthday && r.bymonthday.length ? r.bymonthday : [startD];
    // wie Google/RFC 5545: Monate ohne diesen Tag (z. B. 31.) werden übersprungen
    for (const md of list) { const d = md > 0 ? md : dim + md + 1; if (d >= 1 && d <= dim) out.push(d); }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Anfangstage der Serie (aufsteigend) im Bereich [fromKey, toKey]. COUNT/UNTIL werden beachtet.
 * Springt bei Bedarf direkt an den Bereichsanfang (keine Iteration ab Serienbeginn).
 */
export function occurrenceKeys(startKey, rule, fromKey, toKey, limit = 20000) {
  const r = parseRRule(rule);
  const out = [];
  if (!isKey(startKey) || !isKey(fromKey) || !isKey(toKey) || toKey < startKey) return out;
  if (!r) { if (startKey >= fromKey && startKey <= toKey) out.push(startKey); return out; }
  const iv = r.interval || 1;
  const until = r.until && r.until < toKey ? r.until : toKey;
  const count = r.count || Infinity;
  const from = fromKey > startKey ? fromKey : startKey;
  const S = parseKey(startKey);
  let guard = 0;
  const take = (k, idx) => {
    if (idx >= count || k > until) return false;
    if (k >= from) out.push(k);
    return out.length < limit;
  };

  if (r.freq === "DAILY") {
    let i = from > startKey ? Math.floor(diffDays(startKey, from) / iv) : 0;
    for (; ; i++) { const k = addDays(startKey, i * iv); if (!take(k, i)) break; }
    return out;
  }

  if (r.freq === "WEEKLY") {
    const wds = (r.byday && r.byday.length ? r.byday.map((b) => b.wd) : [wdOf(startKey)]);
    const offs = [...new Set(wds.map((wd) => (wd + 6) % 7))].sort((a, b) => a - b);
    const mon0 = mondayOf(startKey);
    const n0 = offs.filter((o) => addDays(mon0, o) >= startKey).length;
    const nb = offs.length;
    let j = from > startKey ? Math.max(0, Math.floor(diffDays(mon0, from) / (7 * iv))) : 0;
    let idx = j === 0 ? 0 : n0 + (j - 1) * nb;
    for (; guard++ < 100000; j++) {
      const wk = addDays(mon0, 7 * iv * j);
      if (wk > until) break;
      for (const o of offs) {
        const k = addDays(wk, o);
        if (k < startKey) continue;
        if (!take(k, idx)) return out;
        idx++;
      }
    }
    return out;
  }

  if (r.freq === "MONTHLY") {
    let j = 0, idx = 0;
    if (count === Infinity && from > startKey) {
      const F = parseKey(from);
      j = Math.max(0, Math.floor(((F.y - S.y) * 12 + (F.m - S.m)) / iv) - 1);
    }
    for (; guard++ < 30000; j++) {
      const mi = S.m - 1 + j * iv;
      const y = S.y + Math.floor(mi / 12), m = (mi % 12) + 1;
      if (ymd(y, m, 1) > until) break;
      for (const d of monthDays(y, m, r, S.d)) {
        const k = ymd(y, m, d);
        if (k < startKey) continue;
        if (!take(k, idx)) return out;
        idx++;
      }
    }
    return out;
  }

  // YEARLY
  let j = 0, idx = 0;
  if (count === Infinity && from > startKey) j = Math.max(0, Math.floor((parseKey(from).y - S.y) / iv) - 1);
  const months = r.bymonth && r.bymonth.length ? [...r.bymonth].sort((a, b) => a - b) : [S.m];
  for (; guard++ < 3000; j++) {
    const y = S.y + j * iv;
    if (ymd(y, 1, 1) > until) break;
    for (const m of months) {
      const rr = r.byday && r.byday.length ? r : { ...r, bymonthday: r.bymonthday && r.bymonthday.length ? r.bymonthday : [S.d] };
      for (const d of monthDays(y, m, rr, S.d)) {
        const k = ymd(y, m, d);
        if (k < startKey) continue;
        if (!take(k, idx)) return out;
        idx++;
      }
    }
  }
  return out;
}

/** Ist k ein Termin der Serie (ohne EXDATE-Prüfung)? */
export function isOccurrence(startKey, rule, k) {
  return occurrenceKeys(startKey, rule, k, k).length === 1;
}

/** Anzahl Termine der Serie vor Tag k. */
export function countBefore(startKey, rule, k) {
  if (!isKey(k) || k <= startKey) return 0;
  return occurrenceKeys(startKey, rule, startKey, addDays(k, -1)).length;
}

/* ---------- Termine normalisieren / aufklappen ---------- */

export function isEventTodo(t) { return !!t && t.kind === "termin"; }

/** Erinnerungen in Minuten vorher (sortiert, ohne Doppelte). */
export function reminderOffsets(t) {
  if (!t) return [];
  let list;
  if (Array.isArray(t.reminders)) list = t.reminders;
  else if (t.remind) list = [Number.isFinite(Number(t.remindMin)) && Number(t.remindMin) >= 0 ? Number(t.remindMin) : 30];
  else list = [];
  return [...new Set(list.map((x) => Math.round(Number(x))).filter((x) => Number.isFinite(x) && x >= 0 && x <= 40320))].sort((a, b) => a - b);
}

/** Planer-Termin → normalisierte Termindaten (oder null ohne gültiges Datum). */
export function eventOf(t) {
  if (!t || !isKey(t.date)) return null;
  const time = normTime(t.time);
  const allDay = t.allDay === true || !time;
  const ev = {
    id: t.id, date: t.date, allDay,
    time: allDay ? null : time,
    rule: parseRRule(t.rrule),
    exdates: new Set(Array.isArray(t.exdates) ? t.exdates.filter(isKey) : []),
    overrides: t.overrides && typeof t.overrides === "object" ? t.overrides : {},
  };
  const endDate = isKey(t.endDate) && t.endDate >= t.date ? t.endDate : t.date;
  if (allDay) {
    ev.spanDays = diffDays(t.date, endDate) + 1;
    ev.startMin = 0;
    ev.durMin = ev.spanDays * 1440;
  } else {
    const st = toMin(time);
    const et = toMin(t.endTime);
    let dur = et == null ? null : diffDays(t.date, endDate) * 1440 + et - st;
    if (dur == null || dur <= 0) dur = endDate > t.date && et == null ? diffDays(t.date, endDate) * 1440 : Math.min(60, Math.max(15, 1440 - st));
    ev.startMin = st;
    ev.durMin = dur;
    ev.spanDays = Math.floor((st + dur - 1) / 1440) + 1;
  }
  return ev;
}

function instFrom(t, ev, k, ov) {
  const src = ov ? { ...t, ...ov, rrule: null } : null;
  const e = ov ? eventOf({ ...src, date: isKey(ov.date) ? ov.date : k }) || ev : ev;
  const date = ov ? (isKey(ov.date) ? ov.date : k) : k;
  const s = ov ? src : t;
  const endAbs = e.startMin + e.durMin;
  const inst = {
    uid: `${t.id}@${k}`, id: t.id, key: k, recurring: !!ev.rule, overridden: !!ov,
    title: String(s.title || ""), date, allDay: e.allDay, time: e.time,
    startMin: e.startMin, durMin: e.durMin, endAbs,
    location: String(s.location || ""), note: String(s.note || ""), color: s.color || null,
    calendarId: t.calendarId || null, cat: t.cat || null, done: ov ? !!ov.done : !!t.done, t,
  };
  if (e.allDay) { inst.endDate = addDays(date, e.spanDays - 1); inst.endTime = null; }
  else {
    const endDays = Math.floor(endAbs / 1440);
    const rem = endAbs % 1440;
    inst.endDate = rem === 0 && endDays > 0 ? addDays(date, endDays - 1) : addDays(date, endDays);
    inst.endTime = rem === 0 && endDays > 0 ? "24:00" : hhmm(rem);
  }
  inst.lastDay = inst.endDate;
  return inst;
}

/**
 * Termine (Instanzen) eines Planer-Eintrags, die [fromKey, toKey] berühren.
 * Instanz = {uid, id, key (ursprünglicher Tag), date, time, endDate, endTime ("24:00" möglich), allDay,
 *   startMin, durMin, endAbs, title, location, note, color, calendarId, recurring, overridden, done, t}
 */
export function expandTodo(t, fromKey, toKey) {
  const ev = eventOf(t);
  if (!ev) return [];
  const out = [];
  const hit = (i) => i.date <= toKey && i.lastDay >= fromKey;
  if (!ev.rule) {
    const i = instFrom(t, ev, t.date, null);
    if (hit(i)) out.push(i);
    return out;
  }
  const back = Math.max(0, ev.spanDays - 1);
  const ovs = ev.overrides;
  for (const k of occurrenceKeys(t.date, ev.rule, addDays(fromKey, -back), toKey)) {
    if (ev.exdates.has(k) || ovs[k]) continue;
    const i = instFrom(t, ev, k, null);
    if (hit(i)) out.push(i);
  }
  for (const k of Object.keys(ovs)) {
    if (!isKey(k) || ev.exdates.has(k) || !ovs[k] || typeof ovs[k] !== "object") continue;
    if (!isOccurrence(t.date, ev.rule, k)) continue;
    const i = instFrom(t, ev, k, ovs[k]);
    if (hit(i)) out.push(i);
  }
  return out.sort(cmpInst);
}

export function cmpInst(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.startMin - b.startMin) || (b.durMin - a.durMin) || String(a.title).localeCompare(String(b.title));
}

/** Alle Termin-Instanzen aus todos im Bereich. */
export function expandAll(todos, fromKey, toKey, filter = null) {
  const out = [];
  for (const t of todos || []) {
    if (!isEventTodo(t) || (filter && !filter(t))) continue;
    for (const i of expandTodo(t, fromKey, toKey)) out.push(i);
  }
  return out.sort(cmpInst);
}

/** Nächste Instanz ab fromKey (inkl.) oder null – sucht max. 3 Jahre voraus. */
export function nextInstance(t, fromKey, days = 1100) {
  if (!isEventTodo(t)) return null;
  const ev = eventOf(t);
  if (!ev) return null;
  if (!ev.rule) return expandTodo(t, fromKey, addDays(fromKey, 36500))[0] || null;
  for (let a = fromKey; diffDays(fromKey, a) < days; a = addDays(a, 120)) {
    const list = expandTodo(t, a, addDays(a, 119)).filter((i) => i.lastDay >= fromKey);
    if (list.length) return list[0];
  }
  return null;
}

/* ---------- Wiederholung als Text ---------- */

const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const ORD = { 1: "1.", 2: "2.", 3: "3.", 4: "4.", 5: "5.", "-1": "letzten" };

/** Kurztext „Wöchentlich am Montag“, „Alle 2 Wochen …“, „Monatlich am 2. Dienstag“. */
export function describeRule(rule, startKey) {
  const r = parseRRule(rule);
  if (!r) return "Einmalig";
  const iv = r.interval || 1;
  let s;
  if (r.freq === "DAILY") s = iv === 1 ? "Täglich" : `Alle ${iv} Tage`;
  else if (r.freq === "WEEKLY") {
    const wds = r.byday && r.byday.length ? r.byday.map((b) => b.wd) : [wdOf(startKey)];
    const sorted = [...new Set(wds)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const isWork = sorted.length === 5 && [1, 2, 3, 4, 5].every((x) => sorted.includes(x));
    const days = isWork ? "Mo–Fr" : sorted.length === 1 ? WD_LONG[sorted[0]] : sorted.map((x) => WD_SHORT[x]).join(", ");
    s = `${iv === 1 ? "Wöchentlich" : `Alle ${iv} Wochen`} am ${days}`;
  } else if (r.freq === "MONTHLY") {
    const pre = iv === 1 ? "Monatlich" : `Alle ${iv} Monate`;
    if (r.byday && r.byday.length && r.byday[0].n) s = `${pre} am ${ORD[r.byday[0].n] || r.byday[0].n + "."} ${WD_LONG[r.byday[0].wd]}`;
    else s = `${pre} am ${(r.bymonthday && r.bymonthday.length ? r.bymonthday : [parseKey(startKey).d]).map((d) => (d === -1 ? "letzten Tag" : d + ".")).join(", ")}`;
  } else {
    const { m, d } = parseKey(startKey);
    s = `${iv === 1 ? "Jährlich" : `Alle ${iv} Jahre`} am ${r.bymonthday && r.bymonthday.length ? r.bymonthday[0] : d}. ${MONTHS[(r.bymonth && r.bymonth[0] ? r.bymonth[0] : m) - 1]}`;
    if (r.byday && r.byday.length && r.byday[0].n) s = `${iv === 1 ? "Jährlich" : `Alle ${iv} Jahre`} am ${ORD[r.byday[0].n] || r.byday[0].n + "."} ${WD_LONG[r.byday[0].wd]} im ${MONTHS[(r.bymonth && r.bymonth[0] ? r.bymonth[0] : m) - 1]}`;
  }
  if (r.until) s += `, bis ${fmtKey(r.until)}`;
  else if (r.count) s += `, ${r.count}×`;
  return s;
}

/** Vorschläge für „Wiederholen“ zum Starttag → [[id, Text, rrule|null]]. */
export function repeatPresets(startKey) {
  const wd = wdOf(startKey);
  const p = weekdayPos(startKey);
  const { d, m } = parseKey(startKey);
  const list = [
    ["none", "Nie", null],
    ["daily", "Täglich", "FREQ=DAILY"],
    ["weekly", `Wöchentlich am ${WD_LONG[wd]}`, `FREQ=WEEKLY;BYDAY=${RDAYS[wd]}`],
    ["biweekly", `Alle 2 Wochen am ${WD_LONG[wd]}`, `FREQ=WEEKLY;INTERVAL=2;BYDAY=${RDAYS[wd]}`],
    ["workdays", "Jeden Werktag (Mo–Fr)", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
    ["monthday", `Monatlich am ${d}.`, `FREQ=MONTHLY;BYMONTHDAY=${d}`],
  ];
  if (p.n <= 4) list.push(["monthnth", `Monatlich am ${p.n}. ${WD_LONG[wd]}`, `FREQ=MONTHLY;BYDAY=${p.n}${RDAYS[wd]}`]);
  if (p.last) list.push(["monthlast", `Monatlich am letzten ${WD_LONG[wd]}`, `FREQ=MONTHLY;BYDAY=-1${RDAYS[wd]}`]);
  list.push(["yearly", `Jährlich am ${d}. ${MONTHS[m - 1]}`, "FREQ=YEARLY"]);
  list.push(["custom", "Benutzerdefiniert …", null]);
  return list;
}

/** Welcher Vorschlag passt zur Regel (ohne Ende)? → id oder "custom"/"none". */
export function presetOf(rule, startKey) {
  const r = parseRRule(rule);
  if (!r) return "none";
  const bare = formatRRule({ ...r, until: null, count: null });
  for (const [id, , rr] of repeatPresets(startKey)) if (rr && formatRRule(rr) === bare) return id;
  if (bare === "FREQ=WEEKLY" && r.freq === "WEEKLY") return "weekly";
  if (bare === "FREQ=MONTHLY") return "monthday";
  return "custom";
}

/* ---------- Serien bearbeiten (Nur diesen / Diesen und alle folgenden / Alle) ---------- */

const INST_FIELDS = ["date", "time", "endDate", "endTime", "allDay", "title", "location", "note", "color", "done"];

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Serie vor Tag k beenden (für „alle folgenden“). → geänderte Serie oder null (wenn nichts übrig bleibt). */
export function truncateSeries(t, k) {
  const r = parseRRule(t.rrule);
  if (!r) return clone(t);
  const before = countBefore(t.date, r, k);
  if (before === 0) return null;
  const n = clone(t);
  const nr = r.count ? { ...r, count: before, until: null } : { ...r, until: addDays(k, -1), count: null };
  n.rrule = formatRRule(nr);
  if (Array.isArray(n.exdates)) n.exdates = n.exdates.filter((x) => x < k);
  if (n.overrides) n.overrides = Object.fromEntries(Object.entries(n.overrides).filter(([x]) => x < k));
  return n;
}

/** Felder einer Instanz, wie sie gespeichert werden. */
export function instanceFields(i) {
  const o = {};
  for (const f of INST_FIELDS) if (i[f] !== undefined) o[f] = i[f];
  if (o.endTime === "24:00") { o.endTime = "00:00"; o.endDate = addDays(o.endDate, 1); }
  return o;
}

/**
 * Änderung einer (wiederkehrenden) Instanz anwenden.
 * t = gespeicherte Serie, instKey = ursprünglicher Tag, changes = neue Felder (date,time,endDate,endTime,allDay,title,… und optional rrule).
 * scope: "one" | "following" | "all".  → {save: [todo…], create: [todo ohne id…], remove: [id…]}
 */
export function applyEdit(t, instKey, changes, scope = "all") {
  const res = { save: [], create: [], remove: [] };
  const r = parseRRule(t.rrule);
  const ch = { ...changes };
  if (!r || !instKey) { res.save.push({ ...clone(t), ...ch }); return res; }
  const inst = expandTodo(t, instKey, instKey).find((i) => i.key === instKey) ||
    instFrom(t, eventOf(t), instKey, (t.overrides || {})[instKey] || null);
  if (scope === "one") {
    const n = clone(t);
    const cur = instanceFields(inst);
    const next = { ...cur };
    for (const f of INST_FIELDS) if (ch[f] !== undefined) next[f] = ch[f];
    if (next.allDay) { next.time = null; next.endTime = null; }
    n.overrides = { ...(n.overrides || {}), [instKey]: next };
    res.save.push(n);
    return res;
  }
  // Verschiebung der Instanz → gleiche Verschiebung des Serienanfangs
  const shiftDays = isKey(ch.date) ? diffDays(inst.date, ch.date) : 0;
  const first = occurrenceKeys(t.date, r, t.date, addDays(t.date, 3700), 1)[0] || t.date;
  if (scope === "following" && instKey > first) {
    const head = truncateSeries(t, instKey);
    const tail = clone(t);
    delete tail.id; delete tail.icsUid; delete tail.createdAt;
    const before = countBefore(t.date, r, instKey);
    const tr = r.count ? { ...r, count: Math.max(1, r.count - before) } : r;
    tail.rrule = formatRRule(ch.rrule !== undefined ? (parseRRule(ch.rrule) || null) : tr) || null;
    if (Array.isArray(tail.exdates)) tail.exdates = tail.exdates.filter((x) => x >= instKey).map((x) => addDays(x, shiftDays));
    if (tail.overrides) tail.overrides = Object.fromEntries(Object.entries(tail.overrides).filter(([x]) => x > instKey).map(([x, v]) => [addDays(x, shiftDays), v]));
    const cur = instanceFields(inst);
    const startDate = isKey(ch.date) ? ch.date : cur.date;
    const spanEnd = isKey(ch.endDate) ? ch.endDate : addDays(startDate, diffDays(cur.date, cur.endDate));
    const { rrule: _r, ...rest } = ch;
    Object.assign(tail, cur, rest, { date: startDate, endDate: spanEnd > startDate ? spanEnd : null });
    delete tail.done;
    tail.done = false;
    if (tail.allDay) { tail.time = null; tail.endTime = null; }
    if (!tail.rrule) { tail.rrule = null; delete tail.exdates; delete tail.overrides; }
    if (head) res.save.push(head); else res.remove.push(t.id);
    res.create.push(tail);
    return res;
  }
  // alle
  const n = clone(t);
  const rr = ch.rrule;
  for (const [f, v] of Object.entries(ch)) if (f !== "date" && f !== "endDate" && f !== "rrule") n[f] = v;
  if (shiftDays) {
    n.date = addDays(t.date, shiftDays);
    const ev = eventOf(t);
    n.endDate = addDays(n.date, Math.max(0, diffDays(t.date, isKey(t.endDate) ? t.endDate : t.date)));
    if (isKey(ch.endDate) && isKey(ch.date)) n.endDate = addDays(n.date, diffDays(ch.date, ch.endDate));
    if (ev && ev.rule && ev.rule.freq === "WEEKLY" && ev.rule.byday.length === 1) {
      n.rrule = formatRRule({ ...ev.rule, byday: [{ wd: wdOf(n.date), n: 0 }] });
    }
    if (Array.isArray(n.exdates)) n.exdates = n.exdates.map((x) => addDays(x, shiftDays));
    if (n.overrides) n.overrides = Object.fromEntries(Object.entries(n.overrides).map(([x, v]) => [addDays(x, shiftDays), v]));
  } else if (isKey(ch.endDate) && isKey(ch.date)) {
    n.endDate = addDays(n.date, diffDays(ch.date, ch.endDate));
  }
  if (rr !== undefined) n.rrule = rr ? formatRRule(rr) : null;
  if (!n.rrule) { delete n.exdates; delete n.overrides; n.rrule = null; }
  if (n.allDay) { n.time = null; n.endTime = null; }
  res.save.push(n);
  return res;
}

/** Instanz löschen. → {save, create, remove} wie applyEdit. */
export function applyDelete(t, instKey, scope = "all") {
  const res = { save: [], create: [], remove: [] };
  const r = parseRRule(t.rrule);
  if (!r || !instKey || scope === "all") { res.remove.push(t.id); return res; }
  if (scope === "one") {
    const n = clone(t);
    n.exdates = [...new Set([...(n.exdates || []), instKey])].sort();
    if (n.overrides && n.overrides[instKey]) { n.overrides = { ...n.overrides }; delete n.overrides[instKey]; }
    // nichts mehr übrig? → ganz löschen
    const left = occurrenceKeys(n.date, r, n.date, addDays(n.date, 366 * 30), 50).filter((k) => !n.exdates.includes(k));
    if (!left.length) res.remove.push(t.id); else res.save.push(n);
    return res;
  }
  const head = truncateSeries(t, instKey);
  if (head) res.save.push(head); else res.remove.push(t.id);
  return res;
}

/** Termin für die Speicherung aufbereiten: remind/remindMin aus reminders, Ganztägig ohne Uhrzeit. */
export function finalizeEvent(t) {
  const n = { ...t };
  const offs = reminderOffsets({ reminders: Array.isArray(n.reminders) ? n.reminders : (n.remind ? [n.remindMin] : []) });
  n.reminders = offs;
  n.remind = offs.length > 0;
  n.remindMin = offs.length ? offs[0] : (Number.isFinite(Number(n.remindMin)) ? Number(n.remindMin) : 30);
  if (n.allDay) { n.time = null; n.endTime = null; }
  if (!isKey(n.endDate) || n.endDate <= n.date) n.endDate = null;
  if (!n.rrule) { n.rrule = null; delete n.exdates; delete n.overrides; }
  return n;
}

/* ---------- Überlappung (Zeitraster) ---------- */

/**
 * Überlappende Blöcke eines Tages: setzt col, cols, span (Spalten, in die sich ein Block nach rechts ausdehnen darf).
 * items: {start, end} in Minuten.
 */
export function layoutDay(items) {
  const MIN = 20;
  const sorted = [...items].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const endOf = (it) => Math.max(it.end, it.start + MIN);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((list) => endOf(list[list.length - 1]) <= it.start);
      if (c < 0) { c = cols.length; cols.push([]); }
      cols[c].push(it);
      it.col = c;
    }
    for (const it of cluster) {
      it.cols = cols.length;
      let span = 1;
      for (let c = it.col + 1; c < cols.length; c++) {
        if (cols[c].some((o) => o.start < endOf(it) && endOf(o) > it.start)) break;
        span++;
      }
      it.span = span;
    }
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, endOf(it));
  }
  if (cluster.length) flush();
  return items;
}

/** Balken (mehrtägig) in Zeilen legen. bars: {c0, c1} (inkl. Spalten). Setzt lane; → Anzahl Zeilen. */
export function layoutBars(bars) {
  const lanes = [];
  const sorted = [...bars].sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0) || (a.order || 0) - (b.order || 0));
  for (const b of sorted) {
    let l = lanes.findIndex((end) => end < b.c0);
    if (l < 0) { l = lanes.length; lanes.push(-1); }
    lanes[l] = b.c1;
    b.lane = l;
  }
  return lanes.length;
}

/* ---------- Suche ---------- */

function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
}

/** Suche in Titel/Ort/Notiz über Termin-Instanzen (±days um centerKey) und Aufgaben. → Instanzen (sortiert, max limit). */
export function searchEvents(todos, query, centerKey, { days = 366, limit = 200, filter = null } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const match = (o) => { const h = fold(`${o.title || ""} ${o.location || ""} ${o.note || ""}`); return words.every((w) => h.includes(w)); };
  const from = addDays(centerKey, -days), to = addDays(centerKey, days);
  const out = [];
  for (const t of todos || []) {
    if (!t || (filter && !filter(t))) continue;
    if (isEventTodo(t)) {
      const ovHit = t.overrides && Object.values(t.overrides).some((o) => o && match(o));
      if (!match(t) && !ovHit) continue;
      for (const i of expandTodo(t, from, to)) if (match(i)) out.push(i);
    } else if (t.kind === "todo" && match(t)) {
      out.push({ uid: "t" + t.id, id: t.id, key: t.date || "", date: t.date || "", time: t.time || null, allDay: !t.time, title: t.title, location: "", note: t.note || "", task: true, done: !!t.done, t, startMin: toMin(t.time) || 0, durMin: 0 });
    }
  }
  out.sort((a, b) => {
    const da = a.date ? Math.abs(diffDays(centerKey, a.date)) : 1e9, db = b.date ? Math.abs(diffDays(centerKey, b.date)) : 1e9;
    const fa = a.date && a.date >= centerKey ? 0 : 1, fb = b.date && b.date >= centerKey ? 0 : 1;
    return fa - fb || da - db || (a.startMin - b.startMin);
  });
  return out.slice(0, limit);
}

/* ---------- Erinnerungen (Server-Push UND lokale Ersatz-Benachrichtigung) ---------- */

export const ALLDAY_REMIND_AT = 9 * 60; // ganztägig: Bezugszeit 09:00 am Tag
const HOUR = 3600000;

/**
 * Fällige Termin-/Aufgaben-Erinnerungen.
 * Einmalig + genau eine Erinnerung (wie bisher): Schlüssel = id, Wert "YYYY-MM-DD HH:MM", fällig von (Zeit − vorher) bis Zeit + 60 min.
 * Wiederkehrend oder mehrere Erinnerungen: Schlüssel "id~Tag~Minuten" pro Instanz und Vorlauf, fällig ab Vorlaufzeit für 60 min.
 * → [{t, inst, off, at (Terminbeginn ms), log: [[key, stamp], …]}]
 */
export function dueReminders(now, todos, sentMap = {}, tz = TZ) {
  const sent = sentMap && typeof sentMap === "object" ? sentMap : {};
  const out = [];
  const today = zoned(now, tz).key;
  for (const t of todos || []) {
    if (!t || !t.id || t.done || t.kind === "einsatz" || t.kind === "geburtstag") continue;
    const offs = reminderOffsets(t);
    if (!offs.length) continue;
    const ev = eventOf(t);
    if (!ev) continue;
    if (ev.allDay && t.allDay !== true) continue; // alte Einträge ohne Uhrzeit: keine Erinnerung (wie bisher)
    if (!ev.rule && offs.length === 1 && !ev.allDay) {
      const at = keyTimeToTs(t.date, ev.time, tz);
      const stamp = `${t.date} ${ev.time}`;
      if (now >= at - offs[0] * 60000 && now < at + HOUR && sent[t.id] !== stamp && sent[t.id] !== String(t.time) && sent[t.id] !== `${t.date} ${t.time}`) {
        out.push({ t, inst: expandTodo(t, t.date, t.date)[0] || null, off: offs[0], at, log: [[t.id, stamp]] });
      }
      continue;
    }
    if (t.kind !== "termin" && ev.rule) continue;
    const maxOff = offs[offs.length - 1];
    const from = addDays(today, -2);
    const to = addDays(today, Math.ceil(maxOff / 1440) + 2);
    const insts = ev.rule ? expandTodo(t, from, to) : expandTodo(t, t.date, t.date);
    for (const inst of insts) {
      if (inst.done) continue;
      const at = keyTimeToTs(inst.date, inst.allDay ? hhmm(ALLDAY_REMIND_AT) : inst.time, tz);
      if (now >= at + HOUR) continue;
      const stamp = `${inst.date} ${inst.allDay ? "ganztags" : inst.time}`;
      const due = [];
      for (const off of offs) {
        const fire = at - off * 60000;
        const key = `${t.id}~${inst.key}~${off}`;
        if (now >= fire && now < fire + HOUR && sent[key] !== stamp) due.push([off, key]);
      }
      if (!due.length) continue;
      out.push({ t, inst, off: due[0][0], at, log: due.map(([, key]) => [key, stamp]) });
    }
  }
  return out;
}

/** Text für eine Erinnerung → {title, body}. */
export function reminderText(d, now, tz = TZ) {
  const t = d.t;
  const i = d.inst || { date: t.date, time: t.time, allDay: !t.time, location: t.location || "", title: t.title };
  const label = t.kind === "termin" ? "Termin" : "Aufgabe";
  const title = `${label}: ${String((i && i.title) || t.title || "").trim() || label}`;
  const today = zoned(now, tz).key;
  const day = i.date === today ? "" : i.date === addDays(today, 1) ? "Morgen" : `${WD_SHORT[wdOf(i.date)]}, ${parseKey(i.date).d}.${parseKey(i.date).m}.`;
  let body;
  if (i.allDay) body = `${day || "Heute"} (ganztägig)`;
  else body = `${day ? day + " " : ""}um ${i.time}`;
  if (i.location) body += ` · ${i.location}`;
  return { title, body };
}

/* ---------- Kalender (settings.calendars) ---------- */

/** Farbpalette (Schlüssel → Name); CSS-Variablen --cal-<schlüssel> in css/styles.css (hell/dunkel). */
export const PALETTE = [
  ["tomate", "Tomate"], ["flamingo", "Flamingo"], ["mandarine", "Mandarine"], ["banane", "Banane"],
  ["salbei", "Salbei"], ["basilikum", "Basilikum"], ["pfau", "Pfau"], ["heidelbeere", "Heidelbeere"],
  ["lavendel", "Lavendel"], ["traube", "Traube"], ["rose", "Rose"], ["graphit", "Graphit"],
];
export const PALETTE_HEX = {
  tomate: "#D93025", flamingo: "#E67C73", mandarine: "#EA580C", banane: "#D99A00", salbei: "#33B679", basilikum: "#0B8043",
  pfau: "#0E8A8A", heidelbeere: "#2563EB", lavendel: "#7986CB", traube: "#6D4AE8", rose: "#DB2777", graphit: "#616161",
};
/** Eingebaute Kalender. kind: "user" (Termine), "layer" (aus anderen Bereichen, nur lesen). */
export const BUILTIN_CALS = [
  { id: "privat", name: "Privat", color: "traube", kind: "user" },
  { id: "arbeit", name: "Arbeit", color: "mandarine", kind: "user", hint: "Termine + Einsatzplan" },
  { id: "berufsschule", name: "Berufsschule", color: "pfau", kind: "user", hint: "Termine + Schultage" },
  { id: "geburtstage", name: "Geburtstage", color: "rose", kind: "layer" },
  { id: "feiertage", name: "Feiertage", color: "tomate", kind: "layer", readOnly: true },
  { id: "aufgaben", name: "Aufgaben", color: "heidelbeere", kind: "layer" },
  { id: "arbeitszeit", name: "Arbeitszeit", color: "basilikum", kind: "layer", hint: "Stempeleinträge" },
];
export const DEFAULT_CAL = "privat";

/** settings.calendars (Array) → vollständige Liste: eingebaute + eigene + Google-Einstellungen. */
export function normCalendars(list) {
  const saved = Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string" && c.id) : [];
  const byId = new Map(saved.map((c) => [c.id, c]));
  const colorOk = (c) => (PALETTE_HEX[c] || /^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : null);
  const out = BUILTIN_CALS.map((b) => {
    const s = byId.get(b.id) || {};
    return { ...b, name: String(s.name || "").trim().slice(0, 40) || b.name, color: colorOk(s.color) || b.color, visible: s.visible !== false, builtin: true };
  });
  for (const s of saved) {
    if (BUILTIN_CALS.some((b) => b.id === s.id)) continue;
    if (s.id.startsWith("g:")) { out.push({ id: s.id, name: String(s.name || "Google"), color: colorOk(s.color) || "graphit", visible: s.visible !== false, kind: "google", readOnly: true }); continue; }
    if (s.deleted) continue;
    out.push({ id: s.id, name: String(s.name || "Kalender").trim().slice(0, 40) || "Kalender", color: colorOk(s.color) || "graphit", visible: s.visible !== false, kind: "user" });
  }
  return out;
}

/** Kalenderliste → speicherbares Array (nur Abweichungen + eigene). */
export function calendarsForSave(list) {
  return (list || []).filter((c) => c && c.id).map((c) => {
    const o = { id: c.id, name: c.name, color: c.color, visible: c.visible !== false };
    if (c.deleted) o.deleted = true;
    return o;
  });
}

/** Kalender-ID eines Termins (alte Einträge: Privat). */
export function calOf(t, cals) {
  const id = t && t.calendarId;
  if (id && (!cals || cals.some((c) => c.id === id && c.kind === "user"))) return id;
  return DEFAULT_CAL;
}

/* ---------- ICS (iCalendar) ---------- */

function unescapeText(s) {
  return String(s || "").replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}
function escapeText(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen entfalten und in {name, params, value} zerlegen. */
export function icsLines(text) {
  const raw = String(text || "").replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  for (const line of raw) {
    if (!line.trim()) continue;
    let i = 0, inQ = false;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ":" && !inQ) break;
    }
    const head = line.slice(0, i), value = line.slice(i + 1);
    const segs = [];
    let cur = "", q = false;
    for (const c of head) {
      if (c === '"') { q = !q; continue; }
      if (c === ";" && !q) { segs.push(cur); cur = ""; } else cur += c;
    }
    segs.push(cur);
    const params = {};
    for (const p of segs.slice(1)) { const j = p.indexOf("="); if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1); }
    out.push({ name: segs[0].toUpperCase(), params, value });
  }
  return out;
}

/** ICS-Datum → {date, time|null} in Wiener Wanduhr. */
export function icsDate(value, params = {}) {
  const v = String(value || "").trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || String(params.VALUE || "").toUpperCase() === "DATE") return { date, time: null };
  const [y, mo, d, hh, mi, ss] = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)];
  let ts = null;
  if (m[7]) ts = Date.UTC(y, mo - 1, d, hh, mi, ss);
  else if (params.TZID) {
    const tz = String(params.TZID).replace(/^\//, "");
    if (tz !== TZ && validTz(tz)) ts = zonedToTs(y, mo, d, hh, mi, tz, ss);
  }
  if (ts == null) return { date, time: `${pad(hh)}:${pad(mi)}` }; // Wien oder „floating“
  const z = zoned(ts, TZ);
  return { date: z.key, time: z.time };
}

/** "-PT15M", "-P1D", "-P1DT2H", "PT0S" → Minuten vorher (positiv) oder null. */
export function icsDurationMin(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(s || "").trim());
  if (!m) return null;
  const min = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0)) + Math.round((+(m[6] || 0)) / 60);
  return m[1] === "-" ? min : -min;
}

/**
 * .ics-Text → {events: [{uid, title, date, time, endDate, endTime, allDay, location, note, rrule, exdates, overrides, reminders}], skipped}
 */
export function parseICS(text) {
  const lines = icsLines(text);
  const raw = [];
  let cur = null, alarm = null, depth = [];
  let skipped = 0;
  for (const l of lines) {
    if (l.name === "BEGIN") {
      const what = l.value.toUpperCase();
      depth.push(what);
      if (what === "VEVENT") cur = { props: [], alarms: [] };
      else if (what === "VALARM" && cur) alarm = {};
      continue;
    }
    if (l.name === "END") {
      const what = l.value.toUpperCase();
      depth.pop();
      if (what === "VEVENT" && cur) { raw.push(cur); cur = null; }
      else if (what === "VALARM" && cur && alarm) { cur.alarms.push(alarm); alarm = null; }
      continue;
    }
    if (alarm) { alarm[l.name] = l; continue; }
    if (cur && depth[depth.length - 1] === "VEVENT") cur.props.push(l);
  }
  const masters = new Map();
  const extras = [];
  const events = [];
  for (const r of raw) {
    const get = (n) => r.props.find((p) => p.name === n);
    const all = (n) => r.props.filter((p) => p.name === n);
    const ds = get("DTSTART");
    const s = ds && icsDate(ds.value, ds.params);
    if (!s) { skipped++; continue; }
    const de = get("DTEND");
    let e = de ? icsDate(de.value, de.params) : null;
    const allDay = !s.time;
    let endDate = null, endTime = null;
    if (allDay) {
      if (e && e.date > s.date) endDate = addDays(e.date, -1);
      else {
        const du = get("DURATION");
        const dm = du ? -icsDurationMin(du.value) : null;
        if (dm && dm >= 2880) endDate = addDays(s.date, Math.ceil(dm / 1440) - 1);
      }
    } else {
      if (!e) {
        const du = get("DURATION");
        const dm = du ? -icsDurationMin(du.value) : null;
        if (dm && dm > 0) { const abs = toMin(s.time) + dm; e = { date: addDays(s.date, Math.floor(abs / 1440)), time: hhmm(abs % 1440) }; }
      }
      if (e && e.time) { endTime = e.time; if (e.date > s.date) endDate = e.date; }
    }
    if (endDate && endDate <= s.date) endDate = null;
    const status = String((get("STATUS") || {}).value || "").toUpperCase();
    const ev = {
      uid: String((get("UID") || {}).value || "").trim(),
      title: unescapeText((get("SUMMARY") || {}).value || "").trim() || "Ohne Titel",
      date: s.date, time: s.time, endDate, endTime: allDay ? null : endTime, allDay,
      location: unescapeText((get("LOCATION") || {}).value || "").trim(),
      note: unescapeText((get("DESCRIPTION") || {}).value || "").trim(),
      rrule: null, exdates: [], overrides: {}, reminders: [],
    };
    const urlProp = get("URL");
    if (urlProp && /^https:\/\//i.test(urlProp.value.trim())) ev.url = urlProp.value.trim();
    const rr = get("RRULE");
    if (rr) {
      const p = parseRRule(rr.value);
      if (p) ev.rrule = formatRRule(p);
      else skipped++;
    }
    for (const x of all("EXDATE")) {
      for (const v of x.value.split(",")) { const d = icsDate(v, x.params); if (d) ev.exdates.push(d.date); }
    }
    for (const a of r.alarms) {
      const tr = a.TRIGGER;
      if (!tr) continue;
      let min = null;
      if (String(tr.params.VALUE || "").toUpperCase() === "DATE-TIME") {
        const d = icsDate(tr.value, tr.params);
        if (d && d.time && s.time) min = diffDays(d.date, s.date) * 1440 + toMin(s.time) - toMin(d.time);
      } else min = icsDurationMin(tr.value);
      if (min != null && min >= 0 && min <= 40320) ev.reminders.push(min);
    }
    ev.reminders = [...new Set(ev.reminders)].sort((a, b) => a - b);
    const rid = get("RECURRENCE-ID");
    if (rid) {
      const k = icsDate(rid.value, rid.params);
      extras.push({ uid: ev.uid, key: k && k.date, ev, cancelled: status === "CANCELLED" });
      continue;
    }
    if (status === "CANCELLED") { skipped++; continue; }
    if (ev.uid) masters.set(ev.uid, ev);
    events.push(ev);
  }
  for (const x of extras) {
    const m = x.uid && masters.get(x.uid);
    if (!m || !x.key) { if (!x.cancelled) { events.push({ ...x.ev, uid: x.ev.uid ? `${x.ev.uid}#${x.key}` : "" }); } continue; }
    if (x.cancelled) { m.exdates.push(x.key); continue; }
    const o = x.ev;
    m.overrides[x.key] = { date: o.date, time: o.time, endDate: o.endDate, endTime: o.endTime, allDay: o.allDay, title: o.title, location: o.location, note: o.note };
  }
  for (const e of events) e.exdates = [...new Set(e.exdates)].sort();
  return { events, skipped };
}

function foldLine(line) {
  // max. 75 Oktette pro Zeile (UTF-8), Fortsetzung mit Leerzeichen
  const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const len = (s) => (enc ? enc.encode(s).length : s.length);
  if (len(line) <= 75) return line;
  const parts = [];
  let cur = "";
  for (const ch of line) {
    if (len(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const icsDay = (k) => k.replace(/-/g, "");
const icsLocal = (k, t) => `${icsDay(k)}T${String(t || "00:00").replace(":", "")}00`;
function icsUtc(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const VTZ = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Vienna",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

function veventLines(t, now, extra = {}) {
  const ev = eventOf(t);
  if (!ev) return [];
  const uid = t.icsUid || `${t.id}@stempelkarte`;
  const L = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsUtc(now)}`];
  if (extra.recurrenceId) L.push(ev.allDay ? `RECURRENCE-ID;VALUE=DATE:${icsDay(extra.recurrenceId)}` : `RECURRENCE-ID;TZID=${TZ}:${icsLocal(extra.recurrenceId, extra.recTime || ev.time)}`);
  if (ev.allDay) {
    L.push(`DTSTART;VALUE=DATE:${icsDay(ev.date)}`, `DTEND;VALUE=DATE:${icsDay(addDays(ev.date, ev.spanDays))}`);
  } else {
    const endAbs = ev.startMin + ev.durMin;
    L.push(`DTSTART;TZID=${TZ}:${icsLocal(ev.date, ev.time)}`, `DTEND;TZID=${TZ}:${icsLocal(addDays(ev.date, Math.floor(endAbs / 1440)), hhmm(endAbs % 1440))}`);
  }
  L.push(`SUMMARY:${escapeText(t.title || "Ohne Titel")}`);
  if (t.location) L.push(`LOCATION:${escapeText(t.location)}`);
  if (t.note) L.push(`DESCRIPTION:${escapeText(t.note)}`);
  if (ev.rule && !extra.recurrenceId) {
    const r = { ...ev.rule };
    let rr = formatRRule({ ...r, until: null });
    if (r.until) rr += ev.allDay ? `;UNTIL=${icsDay(r.until)}` : `;UNTIL=${icsUtc(keyTimeToTs(r.until, "23:59") + 59000)}`;
    L.push(`RRULE:${rr}`);
    if (ev.exdates.size) {
      const xs = [...ev.exdates].sort();
      L.push(ev.allDay ? `EXDATE;VALUE=DATE:${xs.map(icsDay).join(",")}` : `EXDATE;TZID=${TZ}:${xs.map((k) => icsLocal(k, ev.time)).join(",")}`);
    }
  }
  for (const off of reminderOffsets(t)) {
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(t.title || "Erinnerung")}`, `TRIGGER:${off ? "-PT" + off + "M" : "PT0S"}`, "END:VALARM");
  }
  L.push("END:VEVENT");
  return L;
}

/** Planer-Termine → .ics-Text (CRLF, gefaltet). */
export function toICS(todos, { name = "Stempelkarte", now = Date.now() } = {}) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stempelkarte//Planer//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(name)}`, `X-WR-TIMEZONE:${TZ}`, ...VTZ];
  for (const t of todos || []) {
    if (!t) continue;
    if (t.kind === "geburtstag") {
      const b = /^(\d{1,2})-(\d{1,2})$/.exec(String(t.bday || ""));
      if (!b) continue;
      const y = Number(t.byear) > 1850 ? Number(t.byear) : 2000;
      const k = ymd(y, Number(b[1]), Number(b[2]));
      L.push(...veventLines({ id: t.id, kind: "termin", title: `🎂 ${t.title}`, date: k, allDay: true, rrule: "FREQ=YEARLY", note: t.note || "" }, now));
      continue;
    }
    if (!isEventTodo(t)) continue;
    L.push(...veventLines(t, now));
    const ev = eventOf(t);
    if (ev && ev.rule) {
      for (const [k, o] of Object.entries(ev.overrides)) {
        if (!o || ev.exdates.has(k)) continue;
        L.push(...veventLines({ ...t, ...o, rrule: null, id: t.id, icsUid: t.icsUid, date: isKey(o.date) ? o.date : k }, now, { recurrenceId: k, recTime: ev.time }));
      }
    }
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}

/** Import-Ereignis → Planer-Termin (ohne id). */
export function todoFromIcs(e, calendarId) {
  return finalizeEvent({
    kind: "termin", title: e.title, date: e.date, time: e.allDay ? null : e.time, endDate: e.endDate, endTime: e.allDay ? null : e.endTime,
    allDay: !!e.allDay, location: e.location || "", note: e.note || "", calendarId: calendarId || DEFAULT_CAL,
    rrule: e.rrule || null, exdates: e.exdates && e.exdates.length ? e.exdates : undefined,
    overrides: e.overrides && Object.keys(e.overrides).length ? e.overrides : undefined,
    reminders: e.reminders || [], icsUid: e.uid || undefined, done: false, doneAt: null,
  });
}
