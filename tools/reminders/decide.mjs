// Reine Entscheidungslogik für Push-Erinnerungen (ohne Firebase) – testbar mit node.
// Alle Uhrzeiten/Tage werden in Europe/Vienna berechnet, nicht in der Server-Zeit.

import { dueReminders, reminderText } from "../../js/cal-core.js";
import { effectiveMode } from "../../js/privat-core.js"; // Update 9 – Privat / Arbeit

export const TZ = "Europe/Vienna";
const HOUR = 3600000;

const fmt = new Intl.DateTimeFormat("de-AT", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const WDMAP = { So: 0, Mo: 1, Di: 2, Mi: 3, Do: 4, Fr: 5, Sa: 6 };

const pad = (n) => String(n).padStart(2, "0");

/** Zeitstempel → Wiener Kalenderdaten {y, m (1–12), d, hh, mm, wd (0=So), key "YYYY-MM-DD"}. */
export function vienna(ts) {
  const p = {};
  for (const x of fmt.formatToParts(new Date(ts))) p[x.type] = x.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day);
  const hh = Number(p.hour) % 24, mm = Number(p.minute);
  let wd = WDMAP[String(p.weekday || "").replace(".", "").slice(0, 2)];
  if (wd == null) wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hh, mm, wd, key: `${y}-${pad(m)}-${pad(d)}` };
}

export function dayKeyVienna(ts) { return vienna(ts).key; }

/** Wiener Ortszeit (y, m 1–12, d, hh, mm) → Zeitstempel (berücksichtigt Sommer-/Winterzeit). */
export function viennaToTs(y, m, d, hh, mm) {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let ts = want;
  for (let i = 0; i < 3; i++) {
    const v = vienna(ts);
    const diff = Date.UTC(v.y, v.m - 1, v.d, v.hh, v.mm) - want;
    if (diff === 0) break;
    ts -= diff;
  }
  return ts;
}

/** Gilt dieser Plan am Wiener Tag v? (aktiv; Wochentag in days bzw. einmaliges Datum) */
export function planAppliesOn(plan, v) {
  if (!plan || !plan.id || plan.enabled === false) return false;
  if (!/^\d{1,2}:\d{2}$/.test(String(plan.time || ""))) return false;
  const days = Array.isArray(plan.days) ? plan.days.map(Number) : [];
  if (days.length) return days.includes(v.wd);
  return !!plan.date && plan.date === v.key;
}

/* ---- Feiertage Österreich (gleiche Berechnung wie js/util.js) ---- */
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
  return { m: month - 1, d: day };
}
const holCache = new Map();
export function holidaysOf(y) {
  if (holCache.has(y)) return holCache.get(y);
  const map = new Map();
  const add = (m, d, name) => {
    const t = new Date(Date.UTC(y, m, d));
    map.set(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, name);
  };
  const e = easter(y);
  const rel = (off, name) => add(e.m, e.d + off, name);
  add(0, 1, "Neujahr");
  add(0, 6, "Heilige Drei Könige");
  rel(0, "Ostersonntag");
  rel(1, "Ostermontag");
  add(4, 1, "Staatsfeiertag");
  rel(39, "Christi Himmelfahrt");
  rel(49, "Pfingstsonntag");
  rel(50, "Pfingstmontag");
  rel(60, "Fronleichnam");
  add(7, 15, "Mariä Himmelfahrt");
  add(9, 26, "Nationalfeiertag");
  add(10, 1, "Allerheiligen");
  add(11, 8, "Mariä Empfängnis");
  add(11, 25, "Christtag");
  add(11, 26, "Stefanitag");
  holCache.set(y, map);
  return map;
}

/* ---- Berufsschule (gleiche Regeln wie js/util.js schoolLabel) ---- */
/** Ist am Wiener Tag v Berufsschule? Wöchentliche Schultage oder Schulblock (nur an Arbeitstagen); Feiertag hat Vorrang. */
export function isSchoolDayVienna(settings, v) {
  const s = settings || {};
  const sc = s.school && typeof s.school === "object" ? s.school : null;
  if (!sc) return false;
  if (s.holidays !== false && holidaysOf(v.y).has(v.key)) return false;
  const days = Array.isArray(sc.days) ? sc.days.map(Number) : [];
  if (days.includes(v.wd)) return true;
  const workDays = Array.isArray(s.workDays) ? s.workDays.map(Number) : [1, 2, 3, 4, 5];
  if (!workDays.includes(v.wd) && !(v.wd >= 1 && v.wd <= 5)) return false; // Blockschule: Mo–Fr immer
  const re = /^\d{4}-\d{2}-\d{2}$/;
  return (Array.isArray(sc.blocks) ? sc.blocks : []).some((b) =>
    b && re.test(String(b.from || "")) && re.test(String(b.to || "")) && b.from <= v.key && v.key <= b.to);
}

/* ---- Update 9: Privat-Modus (settings.mode / settings.modeSchedule) ---- */
/** Kalender-Sicht in Wiener Zeit für js/privat-core.js. */
export function viennaCal(ts, settings) {
  const v = vienna(ts);
  const s = settings || {};
  return { key: v.key, wd: v.wd, min: v.hh * 60 + v.mm, holiday: s.holidays !== false && holidaysOf(v.y).has(v.key) };
}
/** Ist jetzt Privat (selbst gewählt oder laut Zeitplan) und nicht eingestempelt? */
export function isPrivatVienna(now, settings, running) {
  return effectiveMode(settings || {}, now, { running, calOf: (t) => viennaCal(t, settings) }).privat;
}

/* ---- Einstellungen ---- */
export const DEFAULT_REMINDERS = Object.freeze({
  enabled: true,
  start: { enabled: true, time: "07:30" },
  end: { enabled: true, afterHours: 10 },
  pause: { enabled: false },
});

export function normReminders(r) {
  const x = r && typeof r === "object" ? r : {};
  const st = x.start && typeof x.start === "object" ? x.start : {};
  const en = x.end && typeof x.end === "object" ? x.end : {};
  const pa = x.pause && typeof x.pause === "object" ? x.pause : {};
  const time = /^\d{1,2}:\d{2}$/.test(String(st.time || "")) ? String(st.time) : DEFAULT_REMINDERS.start.time;
  let h = Number(en.afterHours);
  if (!Number.isFinite(h) || h <= 0) h = DEFAULT_REMINDERS.end.afterHours;
  return {
    enabled: x.enabled !== false,
    start: { enabled: st.enabled !== false, time },
    end: { enabled: en.enabled !== false, afterHours: Math.min(24, Math.max(1, h)) },
    pause: { enabled: pa.enabled === true },
  };
}

function fmtHours(ms) {
  const h = Math.floor((ms / HOUR) * 2) / 2; // auf halbe Stunden abrunden
  return String(h).replace(".", ",");
}

/**
 * Welche Erinnerungen sind jetzt fällig?
 * @param now          Zeitstempel (ms)
 * @param settings     users/{uid}/meta/settings (oder null)
 * @param running      laufende Schicht ({start, pauseMs, pauseStart}) oder null
 * @param todayEntries Einträge mit Beginn am heutigen Wiener Tag
 * @param pushlog      users/{uid}/meta/pushlog ({startSent, endSentFor, pauseSentFor, planSent{}, snooze{}, snoozeSent{}, todoSent{}}) oder null
 * @param todos        users/{uid}/todos (Aufgaben/Termine; optional)
 * @returns Array von {type, title, body, tag, url, log: [[Feldpfad[], Wert], …]} (für pushlog-update)
 */
export function decide(now, settings, running, todayEntries, pushlog, todos = []) {
  const s = settings || {};
  const log = pushlog || {};
  const rem = normReminders(s.reminders);
  const out = [];
  if (!rem.enabled) return out;
  const v = vienna(now);

  const isHoliday = s.holidays !== false && holidaysOf(v.y).has(v.key);
  const isSchool = isSchoolDayVienna(s, v); // Berufsschule wie Feiertag: keine Start-/Plan-Erinnerung
  const list = (Array.isArray(todayEntries) ? todayEntries : []).filter((e) => e && dayKeyVienna(Number(e.start)) === v.key);
  const absent = list.some((e) => e.kind && e.kind !== "work");
  const plans = (Array.isArray(s.plans) ? s.plans : []).filter((p) => planAppliesOn(p, v));
  const planEndSent = (log.planEndSent && typeof log.planEndSent === "object") ? log.planEndSent : {};
  const planSent = (log.planSent && typeof log.planSent === "object") ? log.planSent : {};
  const snooze = (log.snooze && typeof log.snooze === "object") ? log.snooze : {};
  const snoozeSent = (log.snoozeSent && typeof log.snoozeSent === "object") ? log.snoozeSent : {};
  const privat = !running && isPrivatVienna(now, s, running); // Update 9: Privat → keine „nicht eingestempelt“-Erinnerung

  // Geplante Schichten: Push zur Planzeit (nachholen höchstens bis +60 min) und bei „Später erinnern“
  if (!running && !privat && !isHoliday && !isSchool && !absent) {
    for (const p of plans) {
      const k = `${p.id}:${v.key}`;
      const [ph, pm] = String(p.time).split(":").map(Number);
      const due = viennaToTs(v.y, v.m, v.d, ph, pm);
      const sz = Number(snooze[k]);
      if (sz === -1) continue; // „Heute nicht“
      const place = String(p.place || "").trim() || "deinem Arbeitsort";
      const msg = {
        title: `Schicht bei ${place}`,
        tag: `plan-${p.id}`,
        url: `./?plan=${encodeURIComponent(p.id)}&due=${due}#heute`,
      };
      if (now >= due && now < due + HOUR && !planSent[k]) {
        out.push({ type: "plan", ...msg, body: `Es ist ${pad(ph)}:${pad(pm)} – tippe, um einzustempeln.`,
          log: [[["planSent", k], due]] });
      } else if (sz > 0 && now >= sz && now < sz + HOUR && Number(snoozeSent[k]) !== sz) {
        out.push({ type: "plan-snooze", ...msg, body: `Erinnerung: Schicht um ${pad(ph)}:${pad(pm)} – tippe, um einzustempeln.`,
          log: [[["snoozeSent", k], sz]] });
      }
    }
  }

  // Start-Erinnerung (entfällt an Tagen mit geplanter Schicht – dann übernimmt der Plan)
  if (rem.start.enabled && !running && !privat && plans.length === 0) {
    const days = Array.isArray(s.workDays) ? s.workDays.map(Number) : [1, 2, 3, 4, 5];
    const isWorkDay = days.includes(v.wd);
    const [th, tm] = rem.start.time.split(":").map(Number);
    const nowMin = v.hh * 60 + v.mm;
    const startMin = th * 60 + tm;
    if (isWorkDay && !isHoliday && !isSchool && list.length === 0 &&
        nowMin >= startMin && nowMin < startMin + 240 && log.startSent !== v.key) {
      out.push({
        type: "start",
        title: "Noch nicht eingestempelt",
        body: `Es ist ${pad(v.hh)}:${pad(v.mm)} – tippe hier, um einzustempeln.`,
        tag: "stempel-start",
        url: "./#heute",
        log: [[["startSent"], v.key]],
      });
    }
  }

  if (running && Number(running.start) > 0) {
    const start = Number(running.start);
    // Plan-Ende: heute gültiger Plan mit endTime, Uhrzeit ≥ Ende (bis +60 min), einmal pro Plan/Tag.
    // Über Mitternacht (Ende ≤ Beginn): Plan von gestern, Ende heute.
    const cands = [];
    if (!isHoliday && !isSchool && !absent) for (const p of plans) cands.push([p, v]);
    const vy = vienna(viennaToTs(v.y, v.m, v.d, 12, 0) - 24 * HOUR);
    const yHoliday = s.holidays !== false && holidaysOf(vy.y).has(vy.key);
    if (!yHoliday && !isSchoolDayVienna(s, vy)) {
      for (const p of (Array.isArray(s.plans) ? s.plans : []).filter((p) => planAppliesOn(p, vy))) cands.push([p, vy]);
    }
    for (const [p, pv] of cands) {
      if (!/^\d{1,2}:\d{2}$/.test(String(p.endTime || ""))) continue;
      const [sh, sm] = String(p.time).split(":").map(Number);
      const [eh, em] = String(p.endTime).split(":").map(Number);
      const overnight = eh * 60 + em <= sh * 60 + sm;
      if (overnight !== (pv !== v)) continue; // gestriger Plan nur, wenn er über Mitternacht geht
      const ev = overnight ? v : pv;
      const endAt = viennaToTs(ev.y, ev.m, ev.d, eh, em);
      const k = `${p.id}:${pv.key}`;
      if (now >= endAt && now < endAt + HOUR && start < endAt && !planEndSent[k]) {
        const et = `${pad(eh)}:${pad(em)}`;
        out.push({
          type: "plan-end",
          title: `Schichtende ${et}`,
          body: `Tippe, um mit ${et} auszustempeln.`,
          tag: `planend-${p.id}`,
          url: `./?endplan=${encodeURIComponent(p.id)}&end=${endAt}#heute`,
          log: [[["planEndSent", k], endAt]],
        });
      }
    }
    const gross = now - start;
    // End-Erinnerung (einmal pro Schicht)
    if (rem.end.enabled && gross >= rem.end.afterHours * HOUR && log.endSentFor !== start) {
      out.push({
        type: "end",
        title: "Noch eingestempelt?",
        body: `Du bist seit ${fmtHours(gross)} h eingestempelt. Ausstempeln vergessen?`,
        tag: "stempel-end",
        url: "./#heute",
        log: [[["endSentFor"], start]],
      });
    }
    // Pausen-Erinnerung (einmal pro Schicht): netto > 6 h ohne Pause
    const hadPause = (Number(running.pauseMs) || 0) > 0 || running.pauseStart != null;
    if (rem.pause.enabled && !hadPause && gross > 6 * HOUR && log.pauseSentFor !== start) {
      out.push({
        type: "pause",
        title: "Zeit für eine Pause",
        body: "Du arbeitest seit über 6 Stunden ohne Pause.",
        tag: "stempel-pause",
        url: "./#heute",
        log: [[["pauseSentFor"], start]],
      });
    }
  }

  out.push(...decideTodos(now, todos, log));
  return out;
}

/**
 * Termin-/Aufgaben-Erinnerungen (Logik in js/cal-core.js, auch für die lokale Ersatz-Benachrichtigung der App):
 * - einmalig mit genau einer Erinnerung (wie bisher): fällig ab (Uhrzeit − remindMin) bis Uhrzeit + 60 min,
 *   einmal pro Todo und Zeitpunkt (pushlog.todoSent[id] = "YYYY-MM-DD HH:MM").
 * - Update 9 – Kalender: wiederkehrende Termine (rrule, exdates, overrides) und mehrere Vorläufe (reminders [Min.]):
 *   pro Instanz und Vorlauf ein Schlüssel todoSent["id~Tag~Minuten"] = "YYYY-MM-DD HH:MM"; fällig ab Vorlaufzeit für 60 min;
 *   sind mehrere Vorläufe gleichzeitig fällig, kommt eine Nachricht (alle werden gemerkt).
 */
export function decideTodos(now, todos, pushlog) {
  const out = [];
  const sentMap = (pushlog && pushlog.todoSent && typeof pushlog.todoSent === "object") ? pushlog.todoSent : {};
  const list = Array.isArray(todos) ? todos : [];
  for (const t of list) {
    if (!t || !t.id || !t.remind || t.done || t.kind !== "geburtstag") continue;
    const b = decideBirthday(now, t, sentMap);
    if (b) out.push(b);
  }
  for (const d of dueReminders(now, list.filter((t) => t && t.kind !== "geburtstag"), sentMap, TZ)) {
    const { title, body } = reminderText(d, now, TZ);
    const rec = d.inst && d.inst.recurring;
    out.push({
      type: "todo",
      title,
      body,
      tag: rec ? `todo-${d.t.id}-${d.inst.key}` : `todo-${d.t.id}`,
      url: "./#agenda",
      log: d.log.map(([k, v]) => [["todoSent", k], v]),
    });
  }
  return out;
}

/* ---- Update 9: Geburtstage (jährlich) ---- */
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** Geburtstag {m, d, y|null} aus bday "MM-DD" (+ byear) oder date "YYYY-MM-DD"; sonst null. */
export function parseBirthday(t) {
  let m, d, y = null;
  const b = /^(\d{1,2})-(\d{1,2})$/.exec(String((t && t.bday) || ""));
  if (b) { m = Number(b[1]); d = Number(b[2]); }
  else if (/^\d{4}-\d{2}-\d{2}$/.test(String((t && t.date) || ""))) [y, m, d] = t.date.split("-").map(Number);
  else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const by = Number(t.byear);
  if (Number.isInteger(by) && by > 1850 && by < 2200) y = by;
  return { m, d, y };
}

/** Geburtstag im Jahr y als {y, m, d}; 29.2. → 28.2. in Nicht-Schaltjahren. */
export function birthdayIn(b, y) {
  let d = b.d;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  if (b.m === 2 && d === 29 && !leap) d = 28;
  const last = new Date(Date.UTC(y, b.m, 0)).getUTCDate();
  return { y, m: b.m, d: Math.min(d, last) };
}

/**
 * Geburtstags-Erinnerung: jedes Jahr remindDays (Standard 1) Tage vorher um time (Standard 09:00, Wiener Zeit),
 * nachholen bis 3 h danach; einmal pro Jahr (pushlog.todoSent[id] = "YYYY-MM-DD HH:MM" des Geburtstags).
 */
export function decideBirthday(now, t, sentMap = {}) {
  const b = parseBirthday(t);
  if (!b) return null;
  const time = /^\d{1,2}:\d{2}$/.test(String(t.time || "")) ? String(t.time) : "09:00";
  const [hh, mm] = time.split(":").map(Number);
  let before = Number(t.remindDays);
  if (!Number.isFinite(before) || before < 0) before = 1;
  before = Math.min(60, Math.round(before));
  const v = vienna(now);
  for (const y of [v.y - 1, v.y, v.y + 1]) {
    const o = birthdayIn(b, y);
    const r = new Date(Date.UTC(o.y, o.m - 1, o.d - before));
    const at = viennaToTs(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate(), hh, mm);
    if (now < at || now >= at + 3 * HOUR) continue;
    const key = `${o.y}-${pad(o.m)}-${pad(o.d)}`;
    const stamp = `${key} ${pad(hh)}:${pad(mm)}`;
    if (sentMap[t.id] === stamp) return null;
    const name = String(t.title || "").trim() || "Jemand";
    const age = b.y && o.y >= b.y ? o.y - b.y : null;
    const wd = WD_SHORT[new Date(Date.UTC(o.y, o.m - 1, o.d)).getUTCDay()];
    const when = before === 0 ? "Heute" : before === 1 ? `Morgen (${wd}, ${o.d}.${o.m}.)` : `In ${before} Tagen (${wd}, ${o.d}.${o.m}.)`;
    return {
      type: "birthday",
      title: `🎂 Geburtstag: ${name}`,
      body: `${when}${age != null ? ` – wird ${age}` : ""}`,
      tag: `todo-${t.id}`,
      url: "./#agenda",
      log: [[["todoSent", t.id], stamp]],
    };
  }
  return null;
}
