// Update 9 – Planer-Ansichten: reine Logik ohne DOM (mit node testbar).
// Geburtstage (jährlich), Countdowns und das Sammeln aller Einträge pro Tag
// (Termine, Aufgaben, Geburtstage, Feiertage, Berufsschule, Einsatz, Arbeitszeit).

const pad = (n) => String(n).padStart(2, "0");
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^\d{1,2}:\d{2}$/;

export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function dateOf(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(key, n) {
  const [y, m, d] = String(key).split("-").map(Number);
  return keyOf(new Date(y, m - 1, d + n));
}
/** Ganze Kalendertage von a nach b (b − a). */
export function daysBetween(a, b) {
  const [y1, m1, d1] = String(a).split("-").map(Number);
  const [y2, m2, d2] = String(b).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** "HH:MM" → Minuten seit Mitternacht oder null. */
export function toMin(t) {
  if (!RE_TIME.test(String(t || ""))) return null;
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + m;
}
export const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/** Kategorien für Termine/Aufgaben (Feld `cat`). */
export const CATS = {
  event: { label: "Event", emoji: "🎉" },
  pruefung: { label: "Prüfung", emoji: "📝" },
  urlaub: { label: "Urlaub", emoji: "🏖️" },
  erinnerung: { label: "Erinnerung", emoji: "⏰" },
};
/** Typen im Kalender (Farbe + Symbol). */
export const TYPES = {
  termin: { label: "Termin", emoji: "📅" },
  aufgabe: { label: "Aufgabe", emoji: "✅" },
  geburtstag: { label: "Geburtstag", emoji: "🎂" },
  event: { label: "Event", emoji: "🎉" },
  feiertag: { label: "Feiertag", emoji: "🎌" },
  schule: { label: "Schule", emoji: "📚" },
  einsatz: { label: "Einsatz", emoji: "🔧" },
  arbeit: { label: "Arbeitszeit", emoji: "⏱️" },
  abwesend: { label: "Abwesend", emoji: "🌴" },
};
export const DOT_ORDER = ["termin", "aufgabe", "event", "geburtstag", "feiertag", "schule", "einsatz"];

/* ---------- Geburtstage ---------- */

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Geburtstag eines Planer-Eintrags → {m (1–12), d, y|null} oder null. */
export function parseBday(t) {
  if (!t || t.kind !== "geburtstag") return null;
  let m = null, d = null, y = null;
  const b = /^(\d{1,2})-(\d{1,2})$/.exec(String(t.bday || ""));
  if (b) { m = Number(b[1]); d = Number(b[2]); }
  else if (RE_KEY.test(String(t.date || ""))) { const p = t.date.split("-").map(Number); y = p[0]; m = p[1]; d = p[2]; }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const by = Number(t.byear);
  if (Number.isInteger(by) && by > 1850 && by < 2200) y = by;
  return { m, d, y };
}

/** Datum des Geburtstags im Jahr `year` (29. Februar → 28. Februar in Nicht-Schaltjahren). */
export function bdayKeyIn(b, year) {
  let { m, d } = b;
  if (m === 2 && d === 29 && !isLeap(year)) d = 28;
  const last = new Date(year, m, 0).getDate();
  return `${year}-${pad(m)}-${pad(Math.min(d, last))}`;
}

/** Nächster Geburtstag ab fromKey (inkl.) → {key, days, age|null}. */
export function nextBirthday(t, fromKey) {
  const b = parseBday(t);
  if (!b) return null;
  const y0 = Number(String(fromKey).slice(0, 4));
  for (let y = y0; y <= y0 + 1; y++) {
    const key = bdayKeyIn(b, y);
    if (key >= fromKey) return { key, days: daysBetween(fromKey, key), age: b.y && y >= b.y ? y - b.y : null };
  }
  return null;
}

/** Alter am Geburtstag im Jahr von key (oder null, wenn Jahr unbekannt). */
export function ageIn(b, year) { return b && b.y && year >= b.y ? year - b.y : null; }

/** Kommende Geburtstage sortiert. */
export function upcomingBirthdays(todos, fromKey) {
  const out = [];
  for (const t of todos || []) {
    const n = nextBirthday(t, fromKey);
    if (n) out.push({ t, ...n });
  }
  return out.sort((a, b) => a.days - b.days || String(a.t.title).localeCompare(String(b.t.title), "de"));
}

/* ---------- Countdowns ---------- */

export function emojiOf(t) {
  if (!t) return "⏳";
  if (t.emoji) return String(t.emoji);
  if (t.cat && CATS[t.cat]) return CATS[t.cat].emoji;
  if (t.kind === "geburtstag") return "🎂";
  return t.kind === "termin" ? "📅" : "⏳";
}

/** Offene Einträge mit countdown:true, Datum heute oder später – nächster zuerst. */
export function countdowns(todos, tKey) {
  return (todos || [])
    .filter((t) => t && t.countdown && !t.done && t.kind !== "einsatz" && t.kind !== "geburtstag" && RE_KEY.test(String(t.date || "")) && t.date >= tKey)
    .map((t) => ({ t, days: daysBetween(tKey, t.date), emoji: emojiOf(t) }))
    .sort((a, b) => a.days - b.days || String(a.t.time || "").localeCompare(String(b.t.time || "")));
}

/** "Noch 12 Tage", "Morgen", "Heute". */
export function countdownText(days) {
  if (days <= 0) return "Heute";
  if (days === 1) return "Morgen";
  return `Noch ${days} Tage`;
}

/* ---------- Alles pro Tag sammeln ---------- */

function slug(s) {
  return String(s || "").toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function hueOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
const KNOWN_ACTS = ["arbeiten", "autofahren", "material-holen", "buro", "buero"];

/** Tätigkeit → {cls, hue}. */
export function actStyle(activity) {
  const s = slug(activity || "Arbeiten") || "arbeiten";
  return KNOWN_ACTS.includes(s) ? { cls: `pl-a-${s === "buero" ? "buro" : s}`, hue: null } : { cls: "pl-a-x", hue: hueOf(s) };
}

function planApplies(p, key, wd) {
  if (!p || !p.id || p.enabled === false || !RE_TIME.test(String(p.time || ""))) return false;
  const days = Array.isArray(p.days) ? p.days.map(Number) : [];
  if (days.length) return days.includes(wd);
  return p.date === key;
}

/**
 * Alle Einträge für die Tage [fromKey, toKey] → Map dayKey → {allDay: Item[], timed: Item[], types: Set}.
 * Item = {uid, type, title, sub, emoji, start, end (Minuten), done, open: "todo:ID"|"entry:ID"|"einsatz:ID"|"bday:ID"|"", check: ID|null, cls, hue}
 * deps = {util, einsatzFor, now}
 */
export function buildIndex(snap, fromKey, toKey, deps = {}) {
  const u = deps.util || {};
  const now = Number(deps.now) || Date.now();
  const s = (snap && snap.settings) || {};
  const todos = Array.isArray(snap && snap.todos) ? snap.todos : [];
  const map = new Map();
  for (let k = fromKey; k <= toKey; k = addDays(k, 1)) map.set(k, { allDay: [], timed: [], types: new Set(), work: false });
  const add = (k, it, timed) => {
    const d = map.get(k);
    if (!d) return;
    (timed ? d.timed : d.allDay).push(it);
    if (it.type === "event") d.types.add("event");
    else if (DOT_ORDER.includes(it.type)) d.types.add(it.type);
    if (it.type === "arbeit") d.work = true;
  };

  // Termine, Aufgaben, Geburtstage
  const bdays = [];
  for (const t of todos) {
    if (!t || !t.id) continue;
    if (t.kind === "einsatz") continue;
    if (t.kind === "geburtstag") { const b = parseBday(t); if (b) bdays.push([t, b]); continue; }
    if (!RE_KEY.test(String(t.date || "")) || !map.has(t.date)) continue;
    const st = toMin(t.time);
    const type = t.cat && t.cat !== "erinnerung" && CATS[t.cat] ? "event" : t.kind === "termin" ? "termin" : "aufgabe";
    const it = {
      uid: "t" + t.id, type, title: String(t.title || "Ohne Titel"), emoji: t.cat && CATS[t.cat] ? CATS[t.cat].emoji : (type === "termin" ? "📅" : "✅"),
      start: st, end: null, done: !!t.done, open: "todo:" + t.id, check: t.id, cls: "", hue: null,
      sub: t.cat && CATS[t.cat] ? CATS[t.cat].label : (type === "termin" ? "Termin" : "Aufgabe"),
    };
    if (st != null) {
      let en = toMin(t.endTime);
      if (en == null || en <= st) en = Math.min(24 * 60, st + (type === "aufgabe" ? 30 : 60));
      it.end = en;
      it.sub = `${hhmm(st)}${toMin(t.endTime) > st ? "–" + hhmm(en) : ""} · ${it.sub}`;
    }
    add(t.date, it, st != null);
  }
  if (bdays.length) {
    const y1 = Number(fromKey.slice(0, 4)), y2 = Number(toKey.slice(0, 4));
    for (const [t, b] of bdays) {
      for (let y = y1; y <= y2; y++) {
        const k = bdayKeyIn(b, y);
        if (!map.has(k)) continue;
        const age = ageIn(b, y);
        add(k, {
          uid: "b" + t.id + y, type: "geburtstag", title: String(t.title || "Geburtstag"), emoji: "🎂",
          sub: age != null ? `Geburtstag · wird ${age}` : "Geburtstag", start: null, end: null, done: false,
          open: "bday:" + t.id, check: null, cls: "", hue: null,
        }, false);
      }
    }
  }

  // Feiertag, Berufsschule, Einsatz, geplante Schicht – pro Tag
  const plans = Array.isArray(s.plans) ? s.plans : [];
  for (const [k, d] of map) {
    const dt = dateOf(k);
    const ts = dt.getTime();
    let hol = null, school = null;
    if (s.holidays !== false && u.holidayName) { try { hol = u.holidayName(ts); } catch { hol = null; } }
    if (u.schoolLabel) { try { school = u.schoolLabel(ts, s); } catch { school = null; } }
    if (hol) add(k, { uid: "h" + k, type: "feiertag", title: hol, sub: "Feiertag", emoji: "🎌", start: null, end: null, done: false, open: "", check: null, cls: "", hue: null }, false);
    if (school) add(k, { uid: "s" + k, type: "schule", title: school, sub: "Berufsschule", emoji: "📚", start: null, end: null, done: false, open: "", check: null, cls: "", hue: null }, false);
    let e = null;
    if (deps.einsatzFor) { try { e = deps.einsatzFor(k, todos); } catch { e = null; } }
    const place = e ? String((e.placeId && (snap.places || []).find((p) => p.id === e.placeId) || {}).name || e.place || e.title || "Einsatz") : "";
    const who = e && Array.isArray(e.people) && e.people.length ? " · mit " + e.people.join(", ") : "";
    const dayPlans = hol || school ? [] : plans.filter((p) => planApplies(p, k, dt.getDay()));
    d._plans = dayPlans;
    d._einsatz = e ? { id: e.id, title: place, who } : null;
  }

  // Arbeitszeit (Einträge + laufende Schicht), über Mitternacht aufgeteilt
  const fromTs = dateOf(fromKey).getTime() - 36 * 3600000;
  const toTs = dateOf(toKey).getTime() + 36 * 3600000;
  const pieces = (id, segs) => {
    for (const sg of segs) {
      let a = sg.s;
      while (a < sg.e) {
        const da = new Date(a);
        const k = keyOf(da);
        const mid = new Date(da.getFullYear(), da.getMonth(), da.getDate() + 1).getTime();
        const b = Math.min(sg.e, mid);
        const sMin = da.getHours() * 60 + da.getMinutes();
        const eMin = b === mid ? 24 * 60 : new Date(b).getHours() * 60 + new Date(b).getMinutes();
        if (map.has(k) && eMin > sMin) {
          const st = actStyle(sg.act);
          add(k, {
            uid: `w${id}${a}`, type: "arbeit", title: sg.act || "Arbeiten", emoji: /fahr/i.test(sg.act) ? "🚗" : "⏱️",
            sub: `${hhmm(sMin)}–${eMin >= 1440 ? "24:00" : hhmm(eMin)}${sg.running ? " · läuft" : ""}${sg.place ? " · " + sg.place : ""}`,
            start: sMin, end: Math.max(eMin, sMin + 1), done: false, open: id ? "entry:" + id : "", check: null, cls: st.cls, hue: st.hue, running: !!sg.running,
          }, true);
        }
        a = b;
      }
    }
  };
  const segsOf = (e, endTs, running) => {
    const segs = Array.isArray(e.segments) && e.segments.length ? e.segments : [{ start: e.start, end: endTs, activity: "Arbeiten" }];
    return segs.map((x, i) => {
      const s0 = Number(x.start) || (i === 0 ? Number(e.start) : 0);
      const nx = segs[i + 1];
      const e0 = Number(x.end) || (nx ? Number(nx.start) : endTs);
      return { s: s0, e: Math.min(e0, endTs), act: x.activity || "Arbeiten", place: String(x.place || e.place || ""), running: running && i === segs.length - 1 };
    }).filter((x) => x.s > 0 && x.e > x.s);
  };
  for (const e of (snap && snap.entries) || []) {
    const st = Number(e.start), en = Number(e.end);
    if (!(st > 0) || st > toTs || (en && en < fromTs)) continue;
    if (e.kind && e.kind !== "work") {
      const k = keyOf(new Date(st));
      const lbl = u.kindLabel ? u.kindLabel(e.kind) : e.kind;
      add(k, { uid: "x" + e.id, type: "abwesend", title: lbl, sub: e.note ? String(e.note).split("\n")[0] : "Eintrag", emoji: e.kind === "krank" ? "🤒" : e.kind === "schule" ? "📚" : "🌴", start: null, end: null, done: false, open: "entry:" + e.id, check: null, cls: "", hue: null }, false);
      continue;
    }
    if (!(en > st)) continue;
    pieces(e.id, segsOf(e, en, false));
  }
  const r = snap && snap.running;
  if (r && Number(r.start) > 0 && Number(r.start) < toTs) pieces("", segsOf(r, now, true));

  // Einsatz: mit Planzeit als Block, sonst ganztägig
  for (const [k, d] of map) {
    const e = d._einsatz;
    const ps = d.work ? [] : d._plans;
    if (ps.length) {
      for (const p of ps) {
        const a = toMin(p.time);
        let b = toMin(p.endTime);
        if (b == null || b <= a) b = Math.min(1440, a + 8 * 60);
        add(k, {
          uid: `p${p.id}${k}`, type: "einsatz", title: e ? e.title : (String(p.place || "").trim() || "Geplante Schicht"),
          sub: `${hhmm(a)}${toMin(p.endTime) != null ? "–" + hhmm(b) : ""} · ${e ? "Einsatz" + e.who : "Geplante Schicht"}`,
          emoji: "🔧", start: a, end: b, done: false, open: e ? "einsatz:" + e.id : "einsatzday:" + k, check: null, cls: "", hue: null,
        }, true);
      }
    } else if (e) {
      add(k, { uid: "e" + e.id + k, type: "einsatz", title: e.title, sub: "Einsatz" + e.who, emoji: "🔧", start: null, end: null, done: false, open: "einsatz:" + e.id, check: null, cls: "", hue: null }, false);
    }
    delete d._plans; delete d._einsatz;
    d.timed.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  return map;
}

/** Überlappende Blöcke nebeneinander legen: setzt it.col / it.cols. */
export function layoutColumns(items) {
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = Math.max(it.end, it.start + 20);
      it.col = c;
    }
    for (const it of cluster) it.cols = cols.length;
    cluster = [];
  };
  for (const it of [...items].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end, it.start + 20);
  }
  if (cluster.length) flush();
  return items;
}
