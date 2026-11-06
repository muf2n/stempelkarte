// Fachlogik der Web-App, 1:1 übertragen (ohne DOM, Zeitzone fest Europe/Vienna):
//  - js/util.js       netMin, creditMin, Feiertage, Tagessoll, Berufsschule, newId
//  - js/timer.js      clockIn, togglePause, addSegment, clockOut (rein, ohne Speichern)
//  - js/store.js      normTodo, DEFAULT_SETTINGS, mergeSettings, rev-Regel
//  - js/views/overview.js  Überstundenkonto, Wochen-Soll/Ist
//  - js/einsatz.js    einsatzFor
//  - js/views/report.js    buildWeek (Berichtsheft), readApprentice, apprenticeYear
import {
  dayKey, keyToTs, addDays, wdOf, keyOfYMD, parseKey, mondayOf, pad, isKey,
} from "./time.js";
import { isPrivateTrip } from "./privat.js"; // Update 9 – Privatfahrten zählen nie als Arbeitszeit
export { isPrivateTrip };

/* ---------- store.js ---------- */

export const DEFAULT_SETTINGS = Object.freeze({ weeklyTarget: 38.5, autoLocate: true, defaultRadius: 150 });

export function mergeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (s && typeof s === "object") {
    for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** Wie store.js normTodo. */
export function normTodo(t, id, now = Date.now()) {
  const kind = t?.kind === "termin" || t?.kind === "einsatz" || t?.kind === "geburtstag" ? t.kind : "todo"; // Update 9: Geburtstage bleiben Geburtstage
  const rm = Number(t?.remindMin);
  return {
    ...t,
    id,
    title: String(t?.title ?? ""),
    kind,
    date: t?.date || null,
    time: t?.time || null,
    remind: !!t?.remind,
    remindMin: Number.isFinite(rm) && rm >= 0 ? rm : 30,
    done: !!t?.done,
    doneAt: t?.doneAt ?? null,
    note: String(t?.note ?? ""),
    createdAt: Number(t?.createdAt) || now,
  };
}

/** Entfernt undefined rekursiv (wie store.js clean). */
export function clean(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(clean);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x);
    return out;
  }
  return v;
}

/** rev-Regel aus store.js/lock-core.js: max(jetzt, alter rev + 1). */
export function nextRev(oldRev, now) {
  return Math.max(Number(now) || Date.now(), (Number(oldRev) || 0) + 1);
}

/** ID wie util.js newId: Präfix + Zeit (base36, 9 Stellen) + 8 Zufallszeichen. */
export function newId(prefix = "", now = Date.now()) {
  const t = Number(now).toString(36).padStart(9, "0");
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + t + Array.from(a, (b) => (b % 36).toString(36)).join("");
}

/** ID wie js/alltag/db.js newId (Alltag-Sammlungen). */
export function alltagId(now = Date.now()) {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Number(now).toString(36) + Array.from(a, (b) => (b % 36).toString(36)).join("");
}

/* ---------- util.js ---------- */

export function netMin(entry) {
  if (!entry) return 0;
  if (isPrivateTrip(entry)) return 0;
  const dur = ((Number(entry.end) || 0) - (Number(entry.start) || 0)) / 60000;
  return Math.max(0, dur - (Number(entry.pauseMin) || 0));
}

export function creditMin(entry) {
  if (!entry) return 0;
  if (!entry.kind || entry.kind === "work") return netMin(entry);
  return Math.max(0, Number(entry.creditMin ?? 0) || 0);
}

const KIND_LABELS = { work: "Arbeit", urlaub: "Urlaub", krank: "Krank", feiertag: "Feiertag", zeitausgleich: "Zeitausgleich", schule: "Schule" };
export function kindLabel(kind) { return KIND_LABELS[kind || "work"] || "Arbeit"; }

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day }; // m = 1–12
}

const holCache = new Map();
export function holidaysOf(y) {
  if (holCache.has(y)) return holCache.get(y);
  const map = new Map();
  const add = (m, d, name) => map.set(keyOfYMD(y, m, d), name);
  const e = easter(y);
  const rel = (off, name) => add(e.m, e.d + off, name);
  add(1, 1, "Neujahr");
  add(1, 6, "Heilige Drei Könige");
  rel(0, "Ostersonntag");
  rel(1, "Ostermontag");
  add(5, 1, "Staatsfeiertag");
  rel(39, "Christi Himmelfahrt");
  rel(49, "Pfingstsonntag");
  rel(50, "Pfingstmontag");
  rel(60, "Fronleichnam");
  add(8, 15, "Mariä Himmelfahrt");
  add(10, 26, "Nationalfeiertag");
  add(11, 1, "Allerheiligen");
  add(12, 8, "Mariä Empfängnis");
  add(12, 25, "Christtag");
  add(12, 26, "Stefanitag");
  holCache.set(y, map);
  return map;
}

/** Feiertagsname am Tag k ("YYYY-MM-DD") oder null. */
export function holidayName(k) {
  return holidaysOf(parseKey(k).y).get(k) || null;
}

function workDaysOf(s) {
  return Array.isArray(s?.workDays) ? s.workDays : [1, 2, 3, 4, 5];
}

/** Tagessoll ohne Berufsschule (util.js baseTargetMin). */
export function baseTargetMin(k, settings) {
  const s = settings || {};
  const days = workDaysOf(s);
  if (!days.length) return 0;
  if (!days.includes(wdOf(k))) return 0;
  if (s.holidays !== false && holidayName(k)) return 0;
  return weekdayTargetMin(wdOf(k), s);
}

/** Update 10c – Soll je Wochentag (wie js/util.js readDayHours/weekdayTargetMin). */
export function readDayHours(settings) {
  const s = settings || {};
  const out = new Map();
  const dh = s.dayHours && typeof s.dayHours === "object" ? s.dayHours : null;
  if (!dh) return out;
  for (const wd of workDaysOf(s)) {
    const v = dh[String(wd)];
    if (v == null || v === "") continue;
    const h = Number(v);
    if (Number.isFinite(h) && h >= 0 && h <= 24) out.set(Number(wd), Math.round(h * 60));
  }
  return out;
}

export function weekdayTargetMin(wd, settings) {
  const s = settings || {};
  const days = workDaysOf(s);
  if (!days.length || !days.includes(wd)) return 0;
  const own = readDayHours(s);
  if (own.has(wd)) return own.get(wd);
  const weekly = Number(s.weeklyTarget ?? 38.5);
  if (!Number.isFinite(weekly) || weekly <= 0) return 0;
  const rest = days.length - own.size;
  if (rest <= 0) return 0;
  let used = 0;
  for (const m of own.values()) used += m;
  return Math.max(0, weekly * 60 - used) / rest;
}

/** util.js dailyTargetMin: 0 an Berufsschultagen. */
export function dailyTargetMin(k, settings) {
  const base = baseTargetMin(k, settings);
  if (base > 0 && isSchoolDay(k, settings)) return 0;
  return base;
}

export function readSchool(settings) {
  const sc = settings && settings.school;
  if (!sc || typeof sc !== "object") return null;
  const days = Array.isArray(sc.days)
    ? [...new Set(sc.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const blocks = Array.isArray(sc.blocks)
    ? sc.blocks.filter((b) => b && re.test(String(b.from || "")) && re.test(String(b.to || "")) && b.from <= b.to) : [];
  if (!days.length && !blocks.length) return null;
  return { days, blocks };
}

export function schoolLabel(k, settings) {
  const sc = readSchool(settings);
  if (!sc) return null;
  const s = settings || {};
  if (s.holidays !== false && holidayName(k)) return null;
  const wd = wdOf(k);
  if (workDaysOf(s).includes(wd) || (wd >= 1 && wd <= 5)) { // Blockschule: Mo–Fr immer Schule
    const b = sc.blocks.find((x) => x.from <= k && k <= x.to);
    if (b) return String(b.label || "").trim() || "Blockschule";
  }
  if (sc.days.includes(wd)) return "Berufsschule";
  return null;
}

export function isSchoolDay(k, settings) { return schoolLabel(k, settings) != null; }
export function schoolCreditMin(k, settings) { return isSchoolDay(k, settings) ? baseTargetMin(k, settings) : 0; }

/* ---------- timer.js ---------- */

export const DEFAULT_ACTIVITY = "Arbeiten";
export const DEFAULT_ACTS = ["Arbeiten", "Autofahren", "Material holen", "Büro"]; // views/today.js

export function activitiesOf(settings) {
  const a = settings && settings.activities;
  const list = Array.isArray(a) && a.length ? a.filter((x) => typeof x === "string" && x.trim()) : DEFAULT_ACTS;
  return list.length ? list : DEFAULT_ACTS;
}

export function pauseMsNow(running, now) {
  if (!running) return 0;
  const base = Number(running.pauseMs) || 0;
  const open = running.pauseStart != null ? Math.max(0, now - running.pauseStart) : 0;
  return base + open;
}

export function netMs(running, now) {
  if (!running) return 0;
  const ref = running.pauseStart ?? now;
  return Math.max(0, ref - running.start - (Number(running.pauseMs) || 0));
}

export function segmentsOf(running) {
  if (!running) return [];
  if (Array.isArray(running.segments) && running.segments.length) return running.segments;
  return [{
    start: running.start,
    activity: DEFAULT_ACTIVITY,
    placeId: running.placeId ?? null,
    place: running.place || "",
    loc: running.inLoc ?? null,
  }];
}

export function cleanPeople(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const v = String(x == null ? "" : x).trim();
    if (v && !out.some((y) => y.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

export class UserError extends Error {}

/** timer.clockIn → neues running-Objekt. */
export function clockIn(current, { placeId = null, place = "", note = "", inLoc = null, activity = DEFAULT_ACTIVITY, people = [] } = {}, now) {
  if (current) throw new UserError("Du bist schon eingestempelt.");
  const start = now;
  return {
    start,
    segments: [{
      start,
      activity: activity || DEFAULT_ACTIVITY,
      placeId: placeId ?? null,
      place: place || "",
      loc: inLoc ?? null,
    }],
    placeId: placeId ?? null,
    place: place || "",
    note: note || "",
    people: cleanPeople(people),
    pauseStart: null,
    pauseMs: 0,
    inLoc: inLoc ?? null,
  };
}

/** timer.togglePause → neues running-Objekt. */
export function togglePause(r, now) {
  if (!r) throw new UserError("Du bist nicht eingestempelt.");
  if (r.pauseStart != null) {
    return { ...r, pauseMs: (Number(r.pauseMs) || 0) + Math.max(0, now - r.pauseStart), pauseStart: null };
  }
  return { ...r, pauseStart: now };
}

function endPlaceOf(place, loc) { return place || (loc && loc.addr) || ""; }

/** timer.addSegment → {running, seg}. */
export function addSegment(r, { activity = DEFAULT_ACTIVITY, placeId = null, place = "", loc = null } = {}, now) {
  if (!r) throw new UserError("Du bist nicht eingestempelt.");
  const segs = segmentsOf(r);
  const last = segs[segs.length - 1];
  const start = Math.max(now, (last && last.start) || 0);
  const seg = { start, activity: activity || DEFAULT_ACTIVITY, placeId: placeId ?? null, place: place || "", loc: loc ?? null };
  const prev = segs.slice(0, -1);
  if (last) prev.push({ ...last, endLoc: loc ?? null, endPlace: endPlaceOf(place, loc) });
  return { running: { ...r, segments: [...prev, seg] }, seg };
}

function closeSegments(r, end, outLoc = null, outPlace = "") {
  const all = segmentsOf(r);
  const segs = all.filter((s, i) => i === 0 || s.start < end);
  return segs.map((s, i) => {
    const isLast = i + 1 === segs.length;
    let endLoc = s.endLoc ?? null;
    let endPlace = s.endPlace || "";
    if (isLast) {
      if (outLoc) {
        endLoc = outLoc;
        endPlace = endPlaceOf(outPlace, outLoc);
      } else if (segs.length < all.length || !endLoc) {
        endLoc = null;
        endPlace = "";
      }
    }
    return { ...s, start: i === 0 ? r.start : s.start, end: isLast ? end : segs[i + 1].start, endLoc, endPlace };
  });
}

/** timer.clockOut → Eintrag (ohne Speichern). `end` optional (ms), sonst jetzt. */
export function clockOut(r, { outLoc = null, end = null, outPlace = "" } = {}, now, id) {
  if (!r) throw new UserError("Du bist nicht eingestempelt.");
  const t = Number.isFinite(end) && end > r.start ? Math.min(end, now) : now;
  return {
    id,
    start: r.start,
    end: t,
    pauseMin: Math.round(pauseMsNow(r, t) / 60000),
    placeId: r.placeId ?? null,
    place: r.place || "",
    note: r.note || "",
    people: cleanPeople(r.people),
    inLoc: r.inLoc ?? null,
    outLoc: outLoc ?? null,
    segments: closeSegments(r, t, outLoc ?? null, outPlace || ""),
  };
}

/* ---------- overview.js: Überstundenkonto ---------- */

/** Stücke inkl. laufender Schicht: [{start, min (Gutschrift), net, pauseMin, place, kind}] */
export function items(entries, running, now) {
  const out = (entries || []).filter((e) => e && Number.isFinite(e.start) && !isPrivateTrip(e)).map((e) => {
    const kind = e.kind || "work";
    return {
      start: e.start,
      min: creditMin(e),
      net: kind === "work" ? netMin(e) : 0,
      pauseMin: kind === "work" ? (e.pauseMin || 0) : 0,
      place: e.place || (e.inLoc && e.inLoc.addr) || "",
      kind,
    };
  });
  if (running) {
    const net = Math.max(0, netMs(running, now) / 60000);
    out.push({
      start: running.start, min: net, net,
      pauseMin: pauseMsNow(running, now) / 60000,
      place: running.place || (running.inLoc && running.inLoc.addr) || "",
      kind: "work",
    });
  }
  return out;
}

export function creditByDay(entries, running, now) {
  const map = new Map();
  for (const it of items(entries, running, now)) {
    const k = dayKey(it.start);
    map.set(k, (map.get(k) || 0) + it.min);
  }
  return map;
}

/** Saldo (Gutschrift − Soll) von fromKey bis heute; heutiges Soll zählt erst ab morgen. */
export function balanceBetween(fromKey, credits, todayKey, settings) {
  let sum = 0;
  let k = fromKey;
  for (let i = 0; i < 40000 && k <= todayKey; i++) {
    sum += credits.get(k) || 0;
    if (k !== todayKey) sum -= dailyTargetMin(k, settings);
    k = addDays(k, 1);
  }
  return sum;
}

export function balanceStartKey(settings, entries, running) {
  const bs = settings && settings.balanceStart;
  if (isKey(bs)) return bs;
  let min = Infinity;
  for (const e of entries || []) if (e && Number.isFinite(e.start) && e.start < min) min = e.start;
  if (running && running.start < min) min = running.start;
  return Number.isFinite(min) ? dayKey(min) : null;
}

export function balanceNumbers(settings, entries, running, now) {
  const credits = creditByDay(entries, running, now);
  const start = balanceStartKey(settings, entries, running);
  const offset = Number(settings?.balanceOffsetMin) || 0;
  const today = dayKey(now);
  const total = offset + (start ? balanceBetween(start, credits, today, settings) : 0);
  const clip = (k) => (start && k < start ? start : k);
  const ws = mondayOf(today);
  const ms = today.slice(0, 8) + "01";
  return {
    total, offset, start,
    week: start ? balanceBetween(clip(ws), credits, today, settings) : 0,
    month: start ? balanceBetween(clip(ms), credits, today, settings) : 0,
  };
}

/** overview.js weekData: Tage Mo–So mit Gutschrift und Soll. */
export function weekData(settings, entries, running, now, offset = 0) {
  const holOn = settings?.holidays !== false;
  const ws = addDays(mondayOf(dayKey(now)), offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(ws, i);
    days.push({ key: k, min: 0, target: dailyTargetMin(k, settings), hol: holOn ? holidayName(k) : null });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const it of items(entries, running, now)) {
    const d = byKey.get(dayKey(it.start));
    if (d) d.min += it.min;
  }
  const total = days.reduce((a, d) => a + d.min, 0);
  const targetMin = days.reduce((a, d) => a + d.target, 0);
  return { ws, days, total, targetMin };
}

/* ---------- einsatz.js ---------- */

export function einsatzCovers(e, k) {
  if (!e || e.kind !== "einsatz" || !e.date || !k) return false;
  const to = e.dateTo && e.dateTo >= e.date ? e.dateTo : e.date;
  return k >= e.date && k <= to;
}

export function einsatzFor(k, todos) {
  let best = null;
  for (const t of (todos || []).filter((x) => x && x.kind === "einsatz")) {
    if (!einsatzCovers(t, k)) continue;
    if (!best || (Number(t.createdAt) || 0) >= (Number(best.createdAt) || 0)) best = t;
  }
  return best;
}

/* ---------- report.js: Berichtsheft ---------- */

export function readApprentice(settings) {
  const a = (settings && settings.apprentice) || {};
  const years = [2, 3, 3.5, 4].includes(Number(a.years)) ? Number(a.years) : 3;
  return {
    start: isKey(a.start) ? a.start : null,
    years,
    trade: String(a.trade || ""),
    company: String(a.company || ""),
    name: String(a.name || ""),
    notes: a.notes && typeof a.notes === "object" ? { ...a.notes } : {},
  };
}

function addMonthsKey(k, n) {
  const { y, m, d } = parseKey(k);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth() + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return keyOfYMD(yy, mm, Math.min(d, last));
}

export function apprenticeYear(ap, k) {
  if (!ap.start || k < ap.start) return 0;
  const max = Math.ceil(ap.years);
  let n = 0;
  while (n < max - 1 && addMonthsKey(ap.start, 12 * (n + 1)) <= k) n++;
  return n + 1;
}

function placeText(x) {
  if (!x) return "";
  if (x.place) return String(x.place);
  const l = x.inLoc || x.loc;
  return (l && l.addr) || "";
}
function endPlaceText(x) {
  if (!x) return "";
  if (x.endPlace) return String(x.endPlace);
  return (x.endLoc && x.endLoc.addr) || "";
}
function addUniq(list, v) {
  const s = String(v || "").trim();
  if (s && !list.some((x) => x.toLowerCase() === s.toLowerCase())) list.push(s);
}

/** report.js buildWeek: Zeilen Mo–So ab Montag ws ("YYYY-MM-DD"). */
export function buildWeek(settings, entries, ws) {
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(ws, i);
    const acts = [], places = [], tags = [];
    let min = 0;
    const hol = settings.holidays !== false ? holidayName(k) : null;
    if (hol) tags.push({ kind: "feiertag", text: `Feiertag: ${hol}` });
    const sch = schoolLabel(k, settings);
    if (sch) {
      if (sch !== "Berufsschule") addUniq(acts, sch);
      tags.push({ kind: "schule", text: "Berufsschule" });
      min += schoolCreditMin(k, settings);
    }
    const list = (entries || []).filter((e) => e && Number.isFinite(e.start) && dayKey(e.start) === k && !isPrivateTrip(e)).sort((a, b) => a.start - b.start);
    const notes = [], segActs = [], people = [];
    let workCount = 0, noteCount = 0;
    for (const e of list) {
      min += creditMin(e);
      for (const n of Array.isArray(e.people) ? e.people : []) addUniq(people, n);
      if (e.kind && e.kind !== "work") {
        const lbl = e.kind === "schule" ? "Berufsschule" : kindLabel(e.kind);
        if (e.kind !== "schule") tags.push({ kind: e.kind, text: lbl });
        else if (!tags.some((t) => t.kind === "schule")) tags.push({ kind: "schule", text: lbl });
        if (e.note) addUniq(notes, e.note);
        continue;
      }
      workCount++;
      if (String(e.note || "").trim()) { noteCount++; addUniq(notes, e.note); }
      const segs = Array.isArray(e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
      for (const x of segs) {
        const a = x.activity || DEFAULT_ACTIVITY;
        if (a !== DEFAULT_ACTIVITY) addUniq(segActs, a);
        addUniq(places, placeText(x));
        addUniq(places, endPlaceText(x));
      }
      addUniq(places, placeText(e));
    }
    for (const n of notes) addUniq(acts, n);
    for (const a of segActs) addUniq(acts, a);
    if (workCount && !acts.length) addUniq(acts, DEFAULT_ACTIVITY);
    const noNote = workCount > 0 && noteCount === 0;
    rows.push({ key: k, acts, places, people, tags, min, hol, noNote, empty: !list.length && !sch && !hol });
  }
  return rows;
}

/** Default-Gutschrift einer Abwesenheit (entries.js defaultCredit). */
export function defaultCreditMin(kind, k, settings) {
  if (kind === "zeitausgleich") return 0;
  if (kind === "schule") return baseTargetMin(k, settings);
  return dailyTargetMin(k, settings);
}

/** Tage eines Abwesenheits-Zeitraums wie entries.js absenceDays (nur Arbeitstage, ohne Feiertag/Schultag). */
export function absenceRangeDays(fromK, toK, settings) {
  const wds = workDaysOf(settings);
  const out = [];
  for (let k = fromK, i = 0; k <= toK && i < 400; k = addDays(k, 1), i++) {
    if (!wds.includes(wdOf(k))) continue;
    if (holidayName(k)) continue;
    if (isSchoolDay(k, settings)) continue;
    out.push(k);
  }
  return out;
}

export { keyToTs, pad };
