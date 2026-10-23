// Reine Entscheidungslogik für Push-Erinnerungen (ohne Firebase) – testbar mit node.
// Alle Uhrzeiten/Tage werden in Europe/Vienna berechnet, nicht in der Server-Zeit.

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
 * @param pushlog      users/{uid}/meta/pushlog ({startSent, endSentFor, pauseSentFor}) oder null
 * @returns Array von {type, title, body, tag, url, log}
 */
export function decide(now, settings, running, todayEntries, pushlog) {
  const s = settings || {};
  const log = pushlog || {};
  const rem = normReminders(s.reminders);
  const out = [];
  if (!rem.enabled) return out;
  const v = vienna(now);

  // Start-Erinnerung
  if (rem.start.enabled && !running) {
    const days = Array.isArray(s.workDays) ? s.workDays.map(Number) : [1, 2, 3, 4, 5];
    const isWorkDay = days.includes(v.wd);
    const isHoliday = s.holidays !== false && holidaysOf(v.y).has(v.key);
    const list = (Array.isArray(todayEntries) ? todayEntries : []).filter((e) => e && dayKeyVienna(Number(e.start)) === v.key);
    const [th, tm] = rem.start.time.split(":").map(Number);
    const nowMin = v.hh * 60 + v.mm;
    const startMin = th * 60 + tm;
    if (isWorkDay && !isHoliday && list.length === 0 &&
        nowMin >= startMin && nowMin < startMin + 240 && log.startSent !== v.key) {
      out.push({
        type: "start",
        title: "Noch nicht eingestempelt",
        body: `Es ist ${pad(v.hh)}:${pad(v.mm)} – tippe hier, um einzustempeln.`,
        tag: "stempel-start",
        url: "./#heute",
        log: { startSent: v.key },
      });
    }
  }

  if (running && Number(running.start) > 0) {
    const start = Number(running.start);
    const gross = now - start;
    // End-Erinnerung (einmal pro Schicht)
    if (rem.end.enabled && gross >= rem.end.afterHours * HOUR && log.endSentFor !== start) {
      out.push({
        type: "end",
        title: "Noch eingestempelt?",
        body: `Du bist seit ${fmtHours(gross)} h eingestempelt. Ausstempeln vergessen?`,
        tag: "stempel-end",
        url: "./#heute",
        log: { endSentFor: start },
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
        log: { pauseSentFor: start },
      });
    }
  }
  return out;
}
