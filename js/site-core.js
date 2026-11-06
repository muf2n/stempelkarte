// Update 10d – Baustellen-Projektseiten: reine Logik (keine DOM-/Firebase-Zugriffe), auch vom MCP-Server genutzt.
// Neue, optionale Felder am Ort (users/{uid}/places/{id}), ohne Migration:
//   contact (Ansprechpartner), phone, siteStatus ("geplant"|"aktiv"|"pausiert"|"abgeschlossen"),
//   siteStart / siteEnd ("YYYY-MM-DD"), siteNotes, crew (Namen aus settings.people)
// Baustellen-Tagebuch (Alltag-Sammlung „site_log“): { id, placeId, ts, text }
// Fotos: optional phase "vorher" | "nachher"; Aufgaben/Einsätze: optional placeId.

export const STATUSES = ["geplant", "aktiv", "pausiert", "abgeschlossen"];
export const STATUS_META = Object.freeze({
  geplant: { e: "🗓️", l: "Geplant" },
  aktiv: { e: "🔨", l: "Aktiv" },
  pausiert: { e: "⏸️", l: "Pausiert" },
  abgeschlossen: { e: "✅", l: "Abgeschlossen" },
});
export const PHASES = ["vorher", "nachher"];
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const LOG_MAX = 500;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const s = (v) => (v == null ? "" : String(v).trim());
const pad = (n) => String(n).padStart(2, "0");
export const isKey = (k) => KEY_RE.test(String(k || ""));
export function keyOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function clockOf(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fmtKey(k) { return isKey(k) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : ""; }
export function hm(min) { const m = Math.max(0, Math.round(Number(min) || 0)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; }

/** Text für Vergleiche: klein, ohne Akzente/ß, nur Buchstaben/Ziffern. */
export function fold(v) {
  return s(v).toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/* ---------- Felder am Ort ---------- */

/** Telefonnummer → tel:-Link (nur Ziffern und führendes +), sonst "". */
export function telHref(phone) {
  const raw = s(phone);
  if (!raw) return "";
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 3 ? `tel:${plus}${digits}` : "";
}

export function normStatus(v) { return STATUSES.includes(v) ? v : null; }

/** Status einer Baustelle: gesetzt → dieser; sonst Beginn in der Zukunft → geplant, Ende vorbei → abgeschlossen, sonst aktiv. */
export function siteStatus(place, today) {
  const st = normStatus(place && place.siteStatus);
  if (st) return st;
  const t = isKey(today) ? today : keyOf(Date.now());
  if (place && isKey(place.siteStart) && place.siteStart > t) return "geplant";
  if (place && isKey(place.siteEnd) && place.siteEnd < t) return "abgeschlossen";
  return "aktiv";
}
export function statusLabel(st) { const m = STATUS_META[st] || STATUS_META.aktiv; return `${m.e} ${m.l}`; }

/** Formulareingaben säubern → Patch für den Ort (leere Felder werden null/leer, nie undefined). */
export function cleanSiteFields(x = {}) {
  const crew = [...new Set((Array.isArray(x.crew) ? x.crew : []).map(s).filter(Boolean).map((n) => n.slice(0, 60)))];
  let start = isKey(x.siteStart) ? x.siteStart : null;
  let end = isKey(x.siteEnd) ? x.siteEnd : null;
  if (start && end && end < start) [start, end] = [end, start];
  return {
    contact: s(x.contact).slice(0, 120),
    phone: s(x.phone).replace(/[^\d+()\/ .-]/g, "").slice(0, 40),
    siteStatus: normStatus(x.siteStatus),
    siteStart: start,
    siteEnd: end,
    siteNotes: s(x.siteNotes).slice(0, 4000),
    crew: crew.slice(0, 30),
  };
}

/* ---------- Zuordnung echter Daten zur Baustelle ---------- */

function sameText(a, b) { const x = fold(a), y = fold(b); return !!x && x === y; }
/** Passt ein Text (Ortsname/Adresse) zur Baustelle? */
export function textMatches(place, text) {
  if (!place || !s(text)) return false;
  return sameText(text, place.name) || (!!s(place.addr) && sameText(text, place.addr));
}

function isWork(e) { return !!e && (!e.kind || e.kind === "work"); }
function isPrivTrip(e) {
  return !!e && (e.privateTrip === true || (e.tripOnly === true && Array.isArray(e.segments) && e.segments.length > 0 && e.segments.every((x) => x && x.private === true)));
}
export function netMinOf(e) {
  if (!e || isPrivTrip(e)) return 0;
  const dur = ((Number(e.end) || 0) - (Number(e.start) || 0)) / 60000;
  return Math.max(0, dur - (Number(e.pauseMin) || 0));
}
function segsWithEnd(e) {
  const segs = Array.isArray(e && e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
  return segs.map((x, i) => ({ ...x, end: Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : e.end) }));
}
const isDrive = (x) => /fahr/i.test(s(x && x.activity));

/** Minuten eines Eintrags auf dieser Baustelle (ganzer Eintrag oder nur passende Abschnitte), 0 = gehört nicht dazu. */
export function entryMinutesAt(e, place) {
  if (!isWork(e) || !place || isPrivTrip(e)) return 0;
  const here = (x) => x.placeId === place.id || (!x.placeId && textMatches(place, x.place));
  const segs = segsWithEnd(e).filter((x) => Number.isFinite(x.end) && x.end > x.start);
  if (segs.length <= 1) return here(e) ? netMinOf(e) : 0;
  // mehrere Abschnitte: nur die Zeit der Abschnitte hier (ohne Ort → Ort des Eintrags), Pause anteilig
  let total = 0, mine = 0;
  for (const x of segs) {
    const d = (x.end - x.start) / 60000;
    total += d;
    if (isDrive(x)) continue;
    const own = x.placeId || s(x.place);
    if (own ? here(x) : here(e)) mine += d;
  }
  if (!mine || !total) return 0;
  return mine >= total ? netMinOf(e) : mine * (netMinOf(e) / total);
}

/** Arbeitszeiten: { totalMin, days, first, last, list: [{entry, min, dayKey}] (neueste zuerst), people } */
export function workSummary(entries, place) {
  const list = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !Number.isFinite(e.start) || !Number.isFinite(e.end)) continue;
    const min = entryMinutesAt(e, place);
    if (min > 0) list.push({ entry: e, min, dayKey: keyOf(e.start) });
  }
  list.sort((a, b) => b.entry.start - a.entry.start);
  const days = new Set(list.map((x) => x.dayKey));
  const people = new Set();
  for (const x of list) for (const n of Array.isArray(x.entry.people) ? x.entry.people : []) if (s(n)) people.add(s(n));
  return {
    totalMin: Math.round(list.reduce((a, x) => a + x.min, 0)),
    days: days.size,
    first: list.length ? list[list.length - 1].entry.start : null,
    last: list.length ? list[0].entry.start : null,
    list,
    people: [...people].sort((a, b) => a.localeCompare(b, "de")),
  };
}

/** Läuft gerade eine Schicht auf dieser Baustelle? */
export function runningHere(running, place) {
  if (!running || !place) return false;
  if (running.placeId === place.id || (!running.placeId && textMatches(place, running.place))) return true;
  const segs = Array.isArray(running.segments) ? running.segments : [];
  const last = segs[segs.length - 1];
  return !!last && (last.placeId === place.id || (!last.placeId && textMatches(place, last.place)));
}

/** Material dieser Baustelle → { items, by: {status: [...]}, fehlt: [...] (= „brauche“), open, verbaut } */
export function siteMaterial(items, place) {
  const mine = (Array.isArray(items) ? items : []).filter((x) => x && s(x.name) &&
    (x.placeId === place.id || (!x.placeId && textMatches(place, x.place))));
  const by = { brauche: [], besorgt: [], baustelle: [], verbaut: [] };
  for (const x of mine) (by[x.status] || by.brauche).push(x);
  return { items: mine, by, fehlt: by.brauche, open: by.brauche.length + by.besorgt.length + by.baustelle.length, verbaut: by.verbaut.length };
}

/** Fotos (Index-Einträge) der Baustelle: placeId, Album des Orts oder gleiche Adresse. Älteste zuerst. */
export function sitePhotos(items, place, albums = []) {
  const albumIds = new Set((Array.isArray(albums) ? albums : []).filter((a) => a && a.placeId === place.id).map((a) => a.id));
  return (Array.isArray(items) ? items : []).filter((p) => p && p.id && (
    p.placeId === place.id ||
    (Array.isArray(p.albumIds) && p.albumIds.some((id) => albumIds.has(id))) ||
    (!p.placeId && !!s(place.addr) && sameText(p.addr, place.addr))
  )).sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
}

/** Vorher/Nachher-Paare (älteste „vorher“ zu jüngste „nachher“ usw.). */
export function beforeAfter(photos) {
  const v = (photos || []).filter((p) => p && p.phase === "vorher");
  const n = (photos || []).filter((p) => p && p.phase === "nachher");
  return { vorher: v, nachher: n, pairs: Math.min(v.length, n.length) };
}

/** Fahrten (aus travel.tripsBetween) zu/von der Baustelle → { list, km } */
export function siteTrips(trips, place) {
  const list = (Array.isArray(trips) ? trips : []).filter((t) => t && !t.private && (
    (t.seg && t.seg.placeId === place.id) ||
    textMatches(place, t.to) || textMatches(place, t.from) ||
    (!!s(place.addr) && (sameText(t.toAddr, place.addr) || sameText(t.fromAddr, place.addr)))
  ));
  const km = list.reduce((a, t) => a + (Number(t.km) || 0), 0);
  return { list, km: Math.round(km * 10) / 10 };
}

/** Aufgaben und Einsätze, die der Baustelle zugeordnet sind (placeId). */
export function siteTodos(todos, place) {
  const mine = (Array.isArray(todos) ? todos : []).filter((t) => t && t.placeId === place.id);
  return {
    einsaetze: mine.filter((t) => t.kind === "einsatz").sort((a, b) => s(a.date).localeCompare(s(b.date))),
    aufgaben: mine.filter((t) => t.kind !== "einsatz" && t.kind !== "geburtstag"),
  };
}

/* ---------- Baustellen-Tagebuch ---------- */

/** "08:15" an Tag dayKey → Zeitstempel (lokal) oder null. */
export function logTs(dayKey, time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s(time));
  if (!isKey(dayKey) || !m || +m[1] > 23 || +m[2] > 59) return null;
  return new Date(+dayKey.slice(0, 4), +dayKey.slice(5, 7) - 1, +dayKey.slice(8, 10), +m[1], +m[2]).getTime();
}
/** „08:15 Leitungen verlegt“ → { time: "08:15", text } (Uhrzeit vorne optional). */
export function splitLogText(raw) {
  const t = s(raw);
  const m = /^(\d{1,2})[:.](\d{2})\s+(.+)$/s.exec(t);
  if (m && +m[1] <= 23 && +m[2] <= 59) return { time: `${pad(+m[1])}:${m[2]}`, text: m[3].trim() };
  return { time: null, text: t };
}
export function normLog(x) {
  if (!x || !ID_RE.test(s(x.placeId))) return null;
  const text = s(x.text).slice(0, LOG_MAX);
  const ts = Number(x.ts);
  if (!text || !Number.isFinite(ts) || ts <= 0) return null;
  return { ...x, placeId: s(x.placeId), ts, text };
}

/* ---------- Zeitleiste ---------- */

/**
 * Chronologische Ereignisse aus echten Daten + Tagebuch.
 * → [{ ts, kind, icon, text, ref? }] aufsteigend nach Zeit.
 * kinds: in, seg, out, run, photo, mat, matdone, todo, log, start, end
 */
export function buildTimeline({ place, entries = [], running = null, photos = [], material = [], log = [], todos = [] } = {}) {
  const ev = [];
  const push = (ts, kind, icon, text, ref = null) => { if (Number.isFinite(ts) && ts > 0) ev.push({ ts, kind, icon, text, ref }); };
  const atPlace = (x) => x && (x.placeId === place.id || (!x.placeId && textMatches(place, x.place)));
  for (const e of entries) {
    if (!isWork(e) || !Number.isFinite(e.start)) continue;
    const whole = atPlace(e);
    const segs = segsWithEnd(e);
    if (!whole && !segs.some((x) => atPlace(x))) continue;
    const who = Array.isArray(e.people) && e.people.length ? ` · mit ${e.people.join(", ")}` : "";
    push(e.start, "in", "🟢", `Eingestempelt${who}`, e.id || null);
    segs.forEach((x, i) => { if (i > 0) push(x.start, "seg", isDrive(x) ? "🚗" : "🔧", `Abschnitt: ${s(x.activity) || "Arbeiten"}${s(x.place) && !atPlace(x) ? ` (${s(x.place)})` : ""}`, e.id || null); });
    if (Number.isFinite(e.end)) push(e.end, "out", "🔴", `Ausgestempelt · ${hm(entryMinutesAt(e, place))} h hier`, e.id || null);
  }
  if (running && Number.isFinite(running.start) && (atPlace(running) || (running.segments || []).some(atPlace))) {
    push(running.start, "run", "🟢", "Eingestempelt (läuft gerade)");
    (running.segments || []).forEach((x, i) => { if (i > 0 && x && Number.isFinite(x.start)) push(x.start, "seg", isDrive(x) ? "🚗" : "🔧", `Abschnitt: ${s(x.activity) || "Arbeiten"}`); });
  }
  for (const p of photos) {
    const ph = p.phase === "vorher" ? " (Vorher)" : p.phase === "nachher" ? " (Nachher)" : "";
    push(Number(p.ts), "photo", "📷", `Foto${ph}${s(p.note) ? `: ${s(p.note)}` : ""}`, p.id);
  }
  for (const m of material) {
    const line = `${fmtQty(m.qty)} ${s(m.unit) || "Stk"} ${s(m.name)}`.trim();
    push(Number(m.created), "mat", "🧰", `Material erfasst: ${line}${m.status === "brauche" ? " (fehlt noch)" : ""}`, m.id || null);
    if (m.status === "verbaut" && Number(m.doneAt) && Number(m.doneAt) !== Number(m.created)) push(Number(m.doneAt), "matdone", "✅", `Verbaut: ${line}`, m.id || null);
  }
  for (const t of todos) if (t && t.done && Number(t.doneAt)) push(Number(t.doneAt), "todo", "☑️", `Erledigt: ${s(t.title)}`, t.id || null);
  for (const l of log) { const x = normLog(l); if (x && x.placeId === place.id) push(x.ts, "log", "📝", x.text, x.id || null); }
  if (isKey(place.siteStart)) push(logTs(place.siteStart, "00:00"), "start", "🚩", "Baustellen-Beginn");
  if (isKey(place.siteEnd)) push(logTs(place.siteEnd, "23:59"), "end", "🏁", "Baustellen-Ende");
  const order = { start: 0, in: 1, run: 1, seg: 2, photo: 3, mat: 3, matdone: 3, todo: 3, log: 3, out: 4, end: 5 };
  return ev.sort((a, b) => a.ts - b.ts || (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
}
function fmtQty(q) { const n = Number(q) || 1; return String(Math.round(n * 100) / 100).replace(".", ","); }

/** Ereignisse nach Tag gruppieren → [{ dayKey, events }] (neuester Tag zuerst, innerhalb des Tags chronologisch). */
export function groupByDay(events) {
  const m = new Map();
  for (const e of events || []) { const k = keyOf(e.ts); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([dayKey, evs]) => ({ dayKey, events: evs }));
}

/* ---------- Listen / Navigation ---------- */

/** Abgeschlossene Baustellen, zuletzt beendete zuerst. */
export function closedSites(places, today) {
  return (Array.isArray(places) ? places : []).filter((p) => siteStatus(p, today) === "abgeschlossen")
    .sort((a, b) => s(b.siteEnd).localeCompare(s(a.siteEnd)) || s(a.name).localeCompare(s(b.name), "de"));
}

/** Hash der Projektseite. */
export function siteHash(id) { return ID_RE.test(s(id)) ? `#orte/baustelle/${s(id)}` : "#orte"; }
/** Projektseiten-ID aus einem Hash (#orte/baustelle/<id>) oder null. */
export function parseSiteHash(hash) {
  const m = /^#?orte\/baustelle\/([^/?#]+)$/.exec(s(hash));
  if (!m) return null;
  let id = m[1];
  try { id = decodeURIComponent(id); } catch { return null; }
  return ID_RE.test(id) ? id : null;
}
/** Vollständige Adresse für den QR-Code (ohne Such-/Hash-Teil der aktuellen Seite). */
export function siteUrl(base, id) {
  const b = s(base).replace(/[?#].*$/, "");
  return b + siteHash(id);
}

/** Kurzfassung für Liste/Dashboard: „🔨 Aktiv · 12:30 h · 3 Tage“. */
export function summaryLine(place, work, today) {
  const bits = [statusLabel(siteStatus(place, today))];
  if (work && work.totalMin) bits.push(`${hm(work.totalMin)} h`);
  if (work && work.days) bits.push(`${work.days} ${work.days === 1 ? "Tag" : "Tage"}`);
  return bits.join(" · ");
}
