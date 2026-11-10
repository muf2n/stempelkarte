// Update 10 – 🕰️ Persönliche Zeitleiste: reine Logik ohne DOM (Node-testbar, test/timeline-core.test.mjs).
// Sammelt echte Ereignisse aus allen Bereichen in einen Zeitraum [from, to) und sortiert sie neueste zuerst:
//   Arbeit/Schichten (+ Krank/ZA/Feiertag), Schule (Schultage, Prüfungen), Termine, Baustellen-Tagebuch, Fahrten,
//   Fotos (pro Tag & Ort gebündelt, mit Vorschaubildern), erledigte Aufgaben, Reisen & Urlaub, Freizeit.
// Eintrag: { id, cat, ts, dayKey, emoji, title, sub, thumbs?, target }  target = "entry:<id>" | "todo:<id>" | "#hash" | "trip:<key>" | "photos:<gruppe>"
// Nur Vergangenes (ts ≤ now). Keine Beträge (Geld kommt hier nicht vor).

import { expandTodo } from "./cal-core.js";

export const CATS = Object.freeze([
  { id: "arbeit", e: "🔧", t: "Arbeit" },
  { id: "schule", e: "🎒", t: "Schule" },
  { id: "termine", e: "📅", t: "Termine" },
  { id: "baustelle", e: "🏗️", t: "Baustellen" },
  { id: "fahrten", e: "🚗", t: "Fahrten" },
  { id: "fotos", e: "📸", t: "Fotos" },
  { id: "aufgaben", e: "✅", t: "Erledigt" },
  { id: "reisen", e: "🌴", t: "Reisen & Urlaub" },
  { id: "freizeit", e: "💪", t: "Freizeit" },
]);
export const CAT_IDS = CATS.map((c) => c.id);
export const catById = (id) => CATS.find((c) => c.id === id) || null;

const pad = (n) => String(n).padStart(2, "0");
const RE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const s = (v) => String(v ?? "").trim();
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const keyTs = (ts) => keyOf(new Date(ts));
const dateOf = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tsAt = (k, time) => { const d = dateOf(k); const m = /^(\d{1,2}):(\d{2})/.exec(s(time)); if (m) d.setHours(+m[1], +m[2]); return d.getTime(); };
const dur = (min) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)}:${pad(m % 60)} h` : `${m} min`; };
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const KIND = { krank: ["🤒", "Krankenstand"], zeitausgleich: ["⚖️", "Zeitausgleich"], feiertag: ["🎉", "Feiertag"], urlaub: ["🌴", "Urlaub"], schule: ["🎒", "Berufsschule"] };

/** Monat "JJJJ-MM" → { from, to } (ms, to exklusiv). */
export function monthRange(mk) {
  const [y, m] = String(mk).split("-").map(Number);
  return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime() };
}
export const monthKeyOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export function prevMonth(mk) { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
export function monthLabel(mk) { const [y, m] = mk.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; }

/**
 * Ereignisse im Zeitraum. input = {
 *   now, entries, todos, places, photos (Foto-Index), trips ([{ id, start, end, from, to, km, private }]),
 *   cols: { site_log, travel_trips, freizeit, school_exams } }
 */
export function build(input = {}, { from = 0, to = Infinity } = {}) {
  const now = Number(input.now) || Date.now();
  const end = Math.min(to, now + 1);
  const cols = input.cols || {};
  const placeName = new Map((input.places || []).filter((p) => p && p.id).map((p) => [p.id, s(p.name)]));
  const out = [];
  const inRange = (ts) => Number.isFinite(ts) && ts >= from && ts < end;
  const add = (x) => { if (inRange(x.ts)) out.push({ sub: "", ...x, dayKey: keyTs(x.ts) }); };

  /* Arbeit, Schule, Abwesenheit, Urlaub */
  for (const e of input.entries || []) {
    if (!e || !Number.isFinite(e.start) || e.privateTrip) continue;
    const kind = e.kind || "work";
    if (kind === "work") {
      const endTs = Number.isFinite(e.end) ? e.end : null;
      const net = endTs ? (endTs - e.start) / 60000 - (Number(e.pauseMin) || 0) : 0;
      const where = s(e.place) || placeName.get(e.placeId) || "";
      add({ id: "e:" + (e.id || e.start), cat: "arbeit", ts: e.start, emoji: "🔧", title: where ? `Arbeit · ${where}` : "Arbeit",
        sub: endTs ? `${clock(e.start)}–${clock(endTs)} · ${dur(net)}${s(e.note) ? " · " + s(e.note).slice(0, 60) : ""}` : `seit ${clock(e.start)}`, target: "entry:" + e.id });
    } else if (KIND[kind]) {
      const [emoji, label] = KIND[kind];
      const cat = kind === "schule" ? "schule" : kind === "urlaub" ? "reisen" : "arbeit";
      add({ id: "e:" + (e.id || e.start), cat, ts: e.start, emoji, title: label, sub: s(e.note).slice(0, 80), target: "entry:" + e.id });
    }
  }

  /* Prüfungen */
  for (const x of cols.school_exams || []) {
    if (!x || !RE_KEY.test(s(x.date))) continue;
    const ts = tsAt(x.date, x.time || "08:00");
    add({ id: "x:" + x.id, cat: "schule", ts, emoji: "📝", title: `${s(x.kind) || "Prüfung"}${s(x.subject) ? " " + s(x.subject) : ""}`, sub: s(x.grade) ? `Note ${s(x.grade)}` : s(x.topics).split("\n")[0].slice(0, 60), target: "#alltag/schule" });
  }

  /* Termine (auch Serien) und erledigte Aufgaben */
  const fromK = Number.isFinite(from) && from > 0 ? keyTs(from) : "1970-01-01";
  const toK = keyTs(Math.min(end, now + 1) - 1);
  for (const t of input.todos || []) {
    if (!t) continue;
    if (t.kind === "termin") {
      let inst = [];
      try { inst = expandTodo(t, fromK, toK); } catch { inst = []; }
      for (const i of inst) {
        const ts = tsAt(i.date, i.allDay ? "" : i.time);
        add({ id: `t:${t.id}:${i.date}`, cat: "termine", ts, emoji: "📅", title: s(i.title || t.title) || "Termin", sub: [i.allDay || !i.time ? "ganztägig" : i.time, s(i.location || t.location)].filter(Boolean).join(" · "), target: "todo:" + t.id });
      }
    } else if (t.done && Number.isFinite(Number(t.doneAt)) && Number(t.doneAt) > 0) {
      add({ id: "d:" + t.id, cat: "aufgaben", ts: Number(t.doneAt), emoji: "✅", title: s(t.title) || "Aufgabe", sub: `erledigt um ${clock(Number(t.doneAt))}`, target: "todo:" + t.id });
    }
  }

  /* Baustellen-Tagebuch */
  for (const l of cols.site_log || []) {
    if (!l || !Number.isFinite(Number(l.ts)) || !s(l.text)) continue;
    const pn = placeName.get(l.placeId) || "Baustelle";
    add({ id: "l:" + l.id, cat: "baustelle", ts: Number(l.ts), emoji: "🏗️", title: pn, sub: s(l.text).slice(0, 120), target: l.placeId ? `#orte/baustelle/${l.placeId}` : "#orte" });
  }

  /* Fahrten */
  for (const t of input.trips || []) {
    if (!t || !Number.isFinite(t.start)) continue;
    const km = Number.isFinite(t.km) ? `${String(Math.round(t.km * 10) / 10).replace(".", ",")} km` : "";
    add({ id: "f:" + t.id, cat: "fahrten", ts: t.start, emoji: t.private ? "🏡" : "🚗", title: `${s(t.from) || "?"} → ${s(t.to) || "?"}`, sub: [clock(t.start), km, t.private ? "privat" : ""].filter(Boolean).join(" · "), target: "trip:" + t.id });
  }

  /* Fotos: pro Tag + Ort/Adresse gebündelt */
  const groups = new Map();
  for (const p of input.photos || []) {
    if (!p || !p.id || !inRange(Number(p.ts))) continue;
    const where = s(p.place) || placeName.get(p.placeId) || s(p.addr).split(",")[0] || "";
    const g = `${p.dayKey || keyTs(p.ts)}|${where}`;
    if (!groups.has(g)) groups.set(g, { where, list: [] });
    groups.get(g).list.push(p);
  }
  for (const [g, { where, list }] of groups) {
    list.sort((a, b) => a.ts - b.ts);
    add({ id: "p:" + g, cat: "fotos", ts: list[list.length - 1].ts, emoji: "📸", title: `${list.length} ${list.length === 1 ? "Foto" : "Fotos"}${where ? " · " + where : ""}`,
      sub: list.length > 1 ? `${clock(list[0].ts)}–${clock(list[list.length - 1].ts)}` : clock(list[0].ts), thumbs: list.slice(-4).reverse().map((p) => ({ id: p.id, thumb: p.thumb || "" })), photoIds: list.map((p) => p.id), target: "photos:" + g });
  }

  /* Reisen */
  for (const t of cols.travel_trips || []) {
    if (!t || !RE_KEY.test(s(t.from))) continue;
    const nights = RE_KEY.test(s(t.to)) ? Math.round((dateOf(t.to) - dateOf(t.from)) / 86400000) : 0;
    add({ id: "r:" + t.id, cat: "reisen", ts: tsAt(t.from, "09:00"), emoji: s(t.emoji) || "✈️", title: s(t.title) || s(t.dest) || "Reise", sub: [s(t.dest) && s(t.dest) !== s(t.title) ? s(t.dest) : "", nights ? `${nights} ${nights === 1 ? "Nacht" : "Nächte"}` : ""].filter(Boolean).join(" · "), target: "#alltag/unterwegs" });
  }

  /* Update 11 – 📔 Reisetagebuch (Kategorie „reisen“) */
  const tripTitle = new Map((cols.travel_trips || []).filter((t) => t && t.id).map((t) => [t.id, s(t.title) || s(t.dest) || "Reise"]));
  for (const j of cols.travel_journal || []) {
    if (!j || !j.id || !RE_KEY.test(s(j.day))) continue;
    const text = s(j.text).replace(/\s+/g, " ");
    add({ id: "j:" + j.id, cat: "reisen", ts: tsAt(j.day, "12:00"), emoji: s(j.mood) || "📔", title: s(j.title) || `Reisetagebuch · ${tripTitle.get(s(j.tripId)) || "Reise"}`,
      sub: [text.length > 90 ? text.slice(0, 89) + "…" : text, Array.isArray(j.photoIds) && j.photoIds.length ? `📷 ${j.photoIds.length}` : ""].filter(Boolean).join(" · "), target: "#alltag/unterwegs" });
  }

  /* Freizeit */
  for (const f of cols.freizeit || []) {
    if (!f || !Number.isFinite(Number(f.start))) continue;
    const st = Number(f.start), en = Number(f.end);
    add({ id: "z:" + f.id, cat: "freizeit", ts: st, emoji: s(f.emoji) || (f.cat === "sport" ? "💪" : "🏡"), title: s(f.label) || (f.cat === "sport" ? "Sport" : "Freizeit"), sub: [Number.isFinite(en) && en > st ? `${clock(st)}–${clock(en)} · ${dur((en - st) / 60000)}` : `seit ${clock(st)}`, Number(f.km) > 0 ? `${String(f.km).replace(".", ",")} km` : ""].filter(Boolean).join(" · "), target: "#heute" });
  }

  return out.sort((a, b) => b.ts - a.ts || a.id.localeCompare(b.id));
}

/** Nur bestimmte Kategorien (leere Menge = alle). */
export function filterCats(items, cats) {
  const set = cats instanceof Set ? cats : new Set(cats || []);
  return set.size ? items.filter((x) => set.has(x.cat)) : items;
}

/** Zählung je Kategorie. */
export function countByCat(items) {
  const m = Object.fromEntries(CAT_IDS.map((c) => [c, 0]));
  for (const x of items) if (x.cat in m) m[x.cat]++;
  return m;
}

/** Tages-Gruppen (neueste zuerst) mit Überschrift „Heute“, „Gestern“, „Fr 06.11.“. */
export function groupByDay(items, now = Date.now()) {
  const today = keyTs(now);
  const yest = keyOf(new Date(dateOf(today).getTime() - 86400000 + 3600e3));
  const out = [];
  let cur = null;
  for (const x of items) {
    if (!cur || cur.dayKey !== x.dayKey) {
      const d = dateOf(x.dayKey);
      const label = x.dayKey === today ? "Heute" : x.dayKey === yest ? "Gestern" : `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear() !== new Date(now).getFullYear() ? d.getFullYear() : ""}`;
      cur = { dayKey: x.dayKey, label, items: [] };
      out.push(cur);
    }
    cur.items.push(x);
  }
  return out;
}

/** Ältester Zeitpunkt mit Daten (für „weiter zurück gibt's nichts“). */
export function earliest(input = {}) {
  let min = Infinity;
  const take = (ts) => { const n = Number(ts); if (Number.isFinite(n) && n > 0 && n < min) min = n; };
  for (const e of input.entries || []) if (e) take(e.start);
  for (const t of input.todos || []) if (t) { if (t.done) take(t.doneAt); if (t.kind === "termin" && RE_KEY.test(s(t.date))) take(dateOf(t.date).getTime()); }
  for (const p of input.photos || []) if (p) take(p.ts);
  const c = input.cols || {};
  for (const l of c.site_log || []) if (l) take(l.ts);
  for (const f of c.freizeit || []) if (f) take(f.start);
  for (const t of c.travel_trips || []) if (t && RE_KEY.test(s(t.from))) take(dateOf(t.from).getTime());
  for (const x of c.school_exams || []) if (x && RE_KEY.test(s(x.date))) take(dateOf(x.date).getTime());
  return Number.isFinite(min) ? min : null;
}
