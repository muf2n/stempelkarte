// Zeit- und Formatierungs-Hilfen. Cloudflare Workers laufen in UTC – alle Kalendertage,
// Uhrzeiten und Wochen werden hier ausdrücklich in Europe/Vienna berechnet (wie die Web-App
// im Browser des Nutzers bzw. tools/reminders/decide.mjs).

export const TZ = "Europe/Vienna";
export const DAY = 86400000;
export const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export const pad = (n) => String(Math.trunc(Number(n) || 0)).padStart(2, "0");

/** Zeitstempel → Wiener Kalenderdaten {y, m (1–12), d, hh, mm, ss, wd (0=So), key "YYYY-MM-DD"}. */
export function vienna(ts) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(Number(ts)))) p[x.type] = x.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const hh = Number(p.hour) % 24, mm = Number(p.minute), ss = Number(p.second);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hh, mm, ss, wd, key: `${y}-${pad(m)}-${pad(d)}` };
}

/** Wiener Ortszeit → Zeitstempel (Sommer-/Winterzeit berücksichtigt). */
export function viennaToTs(y, m, d, hh = 0, mm = 0) {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let ts = want;
  for (let i = 0; i < 4; i++) {
    const v = vienna(ts);
    const diff = Date.UTC(v.y, v.m - 1, v.d, v.hh, v.mm) - want;
    if (diff === 0) break;
    ts -= diff;
  }
  return ts;
}

export const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const isKey = (k) => RE_KEY.test(String(k || ""));

/** Zeitstempel → "YYYY-MM-DD" (Wien). */
export function dayKey(ts) { return vienna(ts).key; }

export function parseKey(k) {
  const [y, m, d] = String(k).split("-").map(Number);
  return { y, m, d };
}

/** "YYYY-MM-DD" → Zeitstempel 00:00 Wien. */
export function keyToTs(k, hh = 0, mm = 0) {
  const { y, m, d } = parseKey(k);
  return viennaToTs(y, m, d, hh, mm);
}

/** Kalender-Arithmetik auf Tagesschlüsseln (ohne Zeitzonen-Probleme). */
export function addDays(k, n) {
  const { y, m, d } = parseKey(k);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function keyOfYMD(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function wdOf(k) {
  const { y, m, d } = parseKey(k);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
export function diffDays(a, b) { // b − a in Tagen
  const pa = parseKey(a), pb = parseKey(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY);
}
/** Montag der Woche von k. */
export function mondayOf(k) { return addDays(k, -((wdOf(k) + 6) % 7)); }

/** ISO-Kalenderwoche → {year, week}. */
export function isoWeek(k) {
  const { y, m, d } = parseKey(k);
  const t = new Date(Date.UTC(y, m - 1, d));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const yy = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(yy, 0, 1)) / DAY + 1) / 7);
  return { year: yy, week };
}
/** Montag der ISO-Woche (Jahr, KW). */
export function isoWeekMonday(year, week) {
  const jan4 = keyOfYMD(year, 1, 4);
  return addDays(mondayOf(jan4), (week - 1) * 7);
}
export function weekKey(k) {
  const { year, week } = isoWeek(k);
  return `${year}-W${pad(week)}`;
}

/* ---------- Formatierung (österreichisch) ---------- */

/** Zeitstempel → "07:05" (Wien, 24 h). */
export function clock(ts) {
  const v = vienna(ts);
  return `${pad(v.hh)}:${pad(v.mm)}`;
}
/** "YYYY-MM-DD" → "04.11.2026". */
export function fmtKey(k) {
  if (!isKey(k)) return "";
  const { y, m, d } = parseKey(k);
  return `${pad(d)}.${pad(m)}.${y}`;
}
/** "YYYY-MM-DD" → "Mi, 04.11.2026". */
export function fmtKeyWd(k) {
  if (!isKey(k)) return "";
  return `${WD[wdOf(k)]}, ${fmtKey(k)}`;
}
/** Zeitstempel → "04.11.2026". */
export function fmtDate(ts) { return fmtKey(dayKey(ts)); }
/** Zeitstempel → "04.11.2026, 07:05". */
export function fmtDateTime(ts) { return `${fmtDate(ts)}, ${clock(ts)}`; }

/** Minuten → "7:45" (negativ: "-0:30"). */
export function hm(min) {
  let m = Math.round(Number(min) || 0);
  const neg = m < 0;
  m = Math.abs(m);
  return (neg ? "-" : "") + Math.floor(m / 60) + ":" + pad(m % 60);
}
/** Minuten mit Vorzeichen: "+12:30 h" / "−3:15 h" (wie overview.js). */
export function signedH(min) {
  const m = Math.round(Number(min) || 0);
  return (m < 0 ? "−" : "+") + hm(Math.abs(m)) + " h";
}

/** Betrag → "1.234,56 €" (negativ mit echtem Minus). */
export function eur(v, { sign = false } = {}) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  let [int, dec] = abs.toFixed(2).split(".");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = `${int},${dec} €`;
  if (n < 0 && abs >= 0.005) return "−" + s;
  if (sign && n > 0) return "+" + s;
  return s;
}

/** Zahl mit Komma: 2.5 → "2,5". */
export function dec(v, digits = 2) {
  return (Math.round((Number(v) || 0) * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", ",");
}

/* ---------- Eingaben verstehen ---------- */

const WD_WORDS = { sonntag: 0, so: 0, montag: 1, mo: 1, dienstag: 2, di: 2, mittwoch: 3, mi: 3, donnerstag: 4, do: 4, freitag: 5, fr: 5, samstag: 6, sa: 6 };

/**
 * Datumseingabe → "YYYY-MM-DD" oder null. Versteht "heute", "gestern", "morgen", "vorgestern",
 * "übermorgen", "2026-11-04", "04.11.2026", "4.11.26", "4.11.", Wochentage ("Montag" = letzter
 * bzw. heutiger Montag; "nächsten Montag" = kommender).
 */
export function parseDate(input, todayK) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  const rel = { heute: 0, gestern: -1, vorgestern: -2, morgen: 1, "übermorgen": 2, uebermorgen: 2 };
  if (s in rel) return addDays(todayK, rel[s]);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\.\s?(\d{1,2})\.?\s?(\d{2,4})?$/.exec(s);
  if (m) {
    let y = m[3] ? +m[3] : parseKey(todayK).y;
    if (y < 100) y += 2000;
    return validYMD(y, +m[2], +m[1]);
  }
  m = /^(nächsten|naechsten|kommenden|letzten|vorigen)?\s?([a-zäöü]+)$/.exec(s);
  if (m && m[2] in WD_WORDS) {
    const want = WD_WORDS[m[2]];
    const cur = wdOf(todayK);
    if (m[1] && /^(n|k)/.test(m[1])) { let n = (want - cur + 7) % 7; if (n === 0) n = 7; return addDays(todayK, n); }
    if (m[1]) { let n = (cur - want + 7) % 7; if (n === 0) n = 7; return addDays(todayK, -n); }
    return addDays(todayK, -((cur - want + 7) % 7));
  }
  return null;
}
function validYMD(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1970 && y <= 2200)) return null;
  const k = keyOfYMD(y, m, d);
  return parseKey(k).d === d ? k : null;
}

/** Uhrzeit "7", "7:30", "07.30", "7h30", "730", "7 Uhr" → {h, mi} oder null. */
export function parseTime(input) {
  const s = String(input ?? "").trim().toLowerCase().replace(/\s*uhr$/, "");
  let m = /^(\d{1,2})(?:[:.h](\d{2}))?$/.exec(s);
  if (!m) m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return h === 24 && mi === 0 ? { h: 24, mi: 0 } : null;
  return { h, mi };
}
export const fmtTime = (t) => `${pad(t.h)}:${pad(t.mi)}`;

/** Monat "2026-11", "11.2026", "11/2026", "November", "November 2025", "letzter", "diesen" → "YYYY-MM". */
export function parseMonth(input, todayK) {
  const { y, m } = parseKey(todayK);
  const s = String(input ?? "").trim().toLowerCase();
  if (!s || /^(dies|aktuell|jetzt)/.test(s)) return `${y}-${pad(m)}`;
  if (/^(letzt|vorig|vormonat)/.test(s)) return shiftMonth(`${y}-${pad(m)}`, -1);
  if (/^(nächst|naechst)/.test(s)) return shiftMonth(`${y}-${pad(m)}`, 1);
  let r = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (r && +r[2] >= 1 && +r[2] <= 12) return `${r[1]}-${pad(+r[2])}`;
  r = /^(\d{1,2})[./ ](\d{4})$/.exec(s);
  if (r && +r[1] >= 1 && +r[1] <= 12) return `${r[2]}-${pad(+r[1])}`;
  r = /^([a-zäöü]+)\.?\s*(\d{4})?$/.exec(s);
  if (r) {
    const names = ["jän", "feb", "mär", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"];
    const w = r[1].replace("jan", "jän").replace("maer", "mär").replace("mar", "mär");
    const i = names.findIndex((n) => w.startsWith(n));
    if (i >= 0) return `${r[2] || y}-${pad(i + 1)}`;
  }
  return null;
}
export function shiftMonth(mk, n) {
  const [y, m] = mk.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
export function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
