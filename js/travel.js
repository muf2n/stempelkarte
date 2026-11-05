// Update 9 (Agent B): Kilometer (Fahrtenbuch) und Taggeld – reine Rechenlogik ohne DOM.
// settings.allowance = { enabled, minHours, fullHours, ratePart, rateFull, homePlaceIds,
//                        kmRate, ownCar, kmFactor }
// Segment-Feld `km` (Zahl) = manuell eingetragene Kilometer (Vorrang vor der Berechnung).
// Update 9 (Fahrtenbuch): `kmRoad` (+ `kmRoadAt`, `kmRoadFor` = Koordinaten-Schlüssel) = Straßen-km
// vom Routing-Dienst (OSRM), einmal abgefragt und am Abschnitt gespeichert.
// Vorrang überall (Übersicht, Taggeld, CSV, Unterwegs): manuell `km` > `kmRoad` > Luftlinie × Faktor.
// Weitere Abschnitt-Felder fürs Fahrtenbuch: `purpose` (Zweck), `private` (true = Privatfahrt), `vehicleId`.
// days/{dayKey}.allowance = "none" | "part" | "full" (manuell; null/fehlt = automatisch).
// Update 9 – Privat: Privatfahrt-Einträge (privateTrip) stehen im Fahrtenbuch, zählen aber nicht für Taggeld/Tages-km.
import { isPrivateTrip } from "./privat-core.js";

export const DEFAULT_ALLOWANCE = Object.freeze({
  enabled: false,
  minHours: 3,
  fullHours: 11,
  ratePart: null,
  rateFull: null,
  homePlaceIds: [],
  kmRate: 0.5,
  ownCar: false,
  kmFactor: 1.3,
});

export const LEVELS = ["none", "part", "full"];
export const LEVEL_LABELS = { none: "kein Taggeld", part: "teilweise", full: "volles Taggeld" };

function numOr(v, def, min = 0, max = Infinity) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

/** Gültige Taggeld-/Kilometer-Einstellungen mit Standardwerten. */
export function readAllowance(settings) {
  const a = (settings && settings.allowance && typeof settings.allowance === "object") ? settings.allowance : {};
  const minHours = numOr(a.minHours, DEFAULT_ALLOWANCE.minHours, 0, 24);
  let fullHours = numOr(a.fullHours, DEFAULT_ALLOWANCE.fullHours, 0, 24);
  if (fullHours < minHours) fullHours = minHours;
  return {
    enabled: a.enabled === true,
    minHours,
    fullHours,
    ratePart: numOr(a.ratePart, null, 0, 10000),
    rateFull: numOr(a.rateFull, null, 0, 10000),
    homePlaceIds: Array.isArray(a.homePlaceIds) ? [...new Set(a.homePlaceIds.filter((x) => typeof x === "string" && x))] : [],
    kmRate: numOr(a.kmRate, DEFAULT_ALLOWANCE.kmRate, 0, 100),
    ownCar: a.ownCar === true,
    kmFactor: numOr(a.kmFactor, DEFAULT_ALLOWANCE.kmFactor, 1, 3),
  };
}

/* ---------------- Kilometer ---------------- */

function hasLL(p) {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

/** Luftlinie in Metern (Haversine). */
export function haversineM(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ist der Abschnitt eine Fahrt (Tätigkeit „Autofahren“)? */
export function isDriving(seg) {
  const a = String((seg && seg.activity) || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return a === "autofahren";
}

/** Manuell eingetragene km eines Abschnitts oder null. */
export function manualKm(seg) {
  if (!seg || seg.km === null || seg.km === undefined || seg.km === "") return null;
  const n = Number(seg.km);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Schlüssel für ein Koordinatenpaar (5 Nachkommastellen ≈ 1 m) – erkennt geänderte Start/Ziel-Punkte. */
export function coordKey(a, b) {
  if (!hasLL(a) || !hasLL(b)) return "";
  const f = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  return `${f(a)};${f(b)}`;
}

/** Gespeicherte Straßen-km eines Abschnitts oder null (fehlt / passt nicht mehr zu den Koordinaten). */
export function roadKm(seg) {
  if (!seg || seg.kmRoad === null || seg.kmRoad === undefined || seg.kmRoad === "") return null;
  const n = Number(seg.kmRoad);
  if (!Number.isFinite(n) || n < 0) return null;
  if (seg.kmRoadFor && hasLL(seg.loc) && hasLL(seg.endLoc) && seg.kmRoadFor !== coordKey(seg.loc, seg.endLoc)) return null;
  return n;
}

/** Hat der Abschnitt Start- und Zielkoordinaten? */
export function hasCoords(seg) { return !!seg && hasLL(seg.loc) && hasLL(seg.endLoc); }

/** Kilometer eines Fahrt-Abschnitts: {km, manual, road, est, source} oder null (unbekannt).
 *  Vorrang: manuell (source "manual") > Straße (source "road") > Luftlinie × Umwegfaktor (source "est"). */
export function segmentKm(seg, settings) {
  if (!seg) return null;
  const m = manualKm(seg);
  if (m != null) return { km: m, manual: true, road: false, est: false, source: "manual" };
  const r = roadKm(seg);
  if (r != null) return { km: r, manual: false, road: true, est: false, source: "road" };
  if (hasLL(seg.loc) && hasLL(seg.endLoc)) {
    const f = readAllowance(settings).kmFactor;
    return { km: (haversineM(seg.loc, seg.endLoc) / 1000) * f, manual: false, road: false, est: true, source: "est" };
  }
  return null;
}

/** Kurzzeichen der km-Quelle: "✎" manuell, "🛣️" Straße, "≈" Luftlinie. */
export const KM_SOURCE = Object.freeze({
  manual: { sym: "✎", label: "manuell" },
  road: { sym: "🛣️", label: "Straße" },
  est: { sym: "≈", label: "Luftlinie" },
});

/** Abschnitte eines Eintrags mit Ende (wie in der Einträge-Liste). */
export function segmentsWithEnd(e) {
  const segs = Array.isArray(e && e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
  return segs.map((x, i) => ({
    ...x,
    end: Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : e.end),
  }));
}

function isWork(e) { return !!e && (!e.kind || e.kind === "work"); }

/** Summe der Fahrt-km eines Eintrags (nur bekannte Strecken). */
export function entryKm(e, settings) {
  if (!isWork(e) || isPrivateTrip(e)) return 0;
  let sum = 0;
  for (const s of segmentsWithEnd(e)) {
    if (!isDriving(s)) continue;
    const k = segmentKm(s, settings);
    if (k) sum += k.km;
  }
  return sum;
}

function placeName(x) {
  if (!x) return "";
  if (x.place) return x.place;
  return (x.loc && x.loc.addr) || (x.inLoc && x.inLoc.addr) || "";
}
function endName(x) {
  if (!x) return "";
  return x.endPlace || (x.endLoc && x.endLoc.addr) || "";
}

/** Gespeicherter Ort in der Nähe eines Punkts (innerhalb Radius + 100 m) oder null. */
function placeNear(loc, places) {
  if (!hasLL(loc) || !Array.isArray(places)) return null;
  let best = null, bestD = Infinity;
  for (const p of places) {
    if (!p || !hasLL(p)) continue;
    const d = haversineM(loc, p);
    if (d <= Math.max(50, Number(p.radius) || 150) + 100 && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Standard-Zweck einer Fahrt: Name des gespeicherten Zielorts, sonst „Baustelle“. */
export function defaultPurpose(t) {
  return (t && t.toSaved && t.to) ? t.to : "Baustelle";
}

/** Fahrtenbuch: alle Fahrt-Abschnitte im Zeitraum [from, to) →
 *  [{entry, index, rawIndex, key, start, end, from, to, fromAddr, toAddr, fromLoc, toLoc, fromSaved, toSaved,
 *    purpose, purposeSet, private, vehicleId, km, manual, road, est, source}] (km null = unbekannt).
 *  `places` (optional) ergänzt Ortsnamen, wenn nur Koordinaten/Adressen bekannt sind. */
export function tripsBetween(entries, from, to, settings, places = null) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isWork(e) || !Number.isFinite(e.start) || e.start < from || e.start >= to) continue;
    const raw = Array.isArray(e.segments) ? e.segments : [];
    const rawIdx = [];
    raw.forEach((x, j) => { if (x && Number.isFinite(x.start)) rawIdx.push(j); });
    const segs = segmentsWithEnd(e);
    segs.forEach((s, i) => {
      if (!isDriving(s)) return;
      const k = segmentKm(s, settings);
      // Zielort: Ende der Fahrt, sonst nächster Nicht-Fahrt-Abschnitt, sonst Eintragsort
      let nextPlace = null;
      for (let j = i + 1; j < segs.length && !nextPlace; j++) if (!isDriving(segs[j])) nextPlace = segs[j];
      const fromAddr = (s.loc && s.loc.addr) || "";
      const toAddr = (s.endLoc && s.endLoc.addr) || (nextPlace && nextPlace.loc && nextPlace.loc.addr) || "";
      let fromN = placeName(s);
      let toN = endName(s) || (nextPlace ? placeName(nextPlace) : "") || "";
      let fromSaved = !!(s.placeId || (s.place && s.place !== fromAddr));
      let toSaved = !!((s.endPlace && s.endPlace !== toAddr) || (!s.endPlace && nextPlace && (nextPlace.placeId || (nextPlace.place && nextPlace.place !== toAddr))));
      if (!fromSaved) { const p = placeNear(s.loc, places); if (p && p.name) { fromN = p.name; fromSaved = true; } }
      if (!toSaved) { const p = placeNear(s.endLoc, places); if (p && p.name) { toN = p.name; toSaved = true; } }
      const t = {
        entry: e, index: i, rawIndex: rawIdx[i] ?? i, key: `${e.id || ""}#${rawIdx[i] ?? i}`,
        start: s.start, end: s.end,
        from: fromN, to: toN, fromAddr, toAddr,
        fromLoc: hasLL(s.loc) ? s.loc : null, toLoc: hasLL(s.endLoc) ? s.endLoc : null,
        fromSaved, toSaved,
        private: s.private === true,
        vehicleId: typeof s.vehicleId === "string" && s.vehicleId ? s.vehicleId : null,
        km: k ? k.km : null, manual: !!(k && k.manual), road: !!(k && k.road), est: !!(k && k.est),
        source: k ? k.source : null,
        seg: s,
      };
      const p = typeof s.purpose === "string" ? s.purpose.trim() : "";
      t.purposeSet = !!p;
      t.purpose = p || defaultPurpose(t);
      out.push(t);
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Summe km eines Zeitraums. */
export function kmBetween(entries, from, to, settings) {
  return tripsBetween(entries, from, to, settings).reduce((s, t) => s + (t.km || 0), 0);
}

/* ---------------- Taggeld ---------------- */

function norm(s) { return String(s || "").trim().toLowerCase(); }

/** Liegt ein Ort-/Standort-Bezug an einem Heim-Ort? → true | false | null (unbekannt). */
function atHome({ placeId, place, loc }, home, homeById) {
  if (placeId) return homeById.has(placeId);
  const n = norm(place);
  if (n && home.some((p) => norm(p.name) === n)) return true;
  if (hasLL(loc)) {
    for (const p of home) {
      if (hasLL(p) && haversineM(loc, p) <= Math.max(50, Number(p.radius) || 150) + 100) return true;
    }
    return false;
  }
  if (n) return false;
  return null;
}

/** Zeitspannen [{start,end}] eines Arbeitstags, in denen man NICHT an einem Heim-Ort ist. */
function awaySpans(e, home, homeById) {
  const segs = segmentsWithEnd(e);
  const list = segs.length ? segs : [{ start: e.start, end: e.end, placeId: e.placeId ?? null, place: e.place || "", loc: e.inLoc || null }];
  const out = [];
  for (const s of list) {
    if (!Number.isFinite(s.end) || s.end <= s.start) continue;
    const startHome = atHome({ placeId: s.placeId, place: s.place, loc: s.loc }, home, homeById);
    let away;
    if (isDriving(s)) {
      // Fahrt zählt als Abwesenheit, außer sie beginnt UND endet an einem Heim-Ort
      const eh = atHome({ placeId: null, place: s.endPlace, loc: s.endLoc }, home, homeById);
      away = !((startHome !== false) && (eh !== false));
    } else {
      away = startHome === false; // unbekannter Ort zählt vorsichtshalber nicht
    }
    if (away) out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Stufe zu Abwesenheitsstunden. */
export function levelForHours(h, a) {
  if (h >= a.fullHours && h > 0) return "full";
  if (h >= a.minHours && h > 0) return "part";
  return "none";
}

/** Betrag einer Stufe in Euro (null = Betrag nicht eingetragen). */
export function amountFor(level, a) {
  if (level === "full") return a.rateFull;
  if (level === "part") return a.ratePart;
  return 0;
}

/** Manuelle Taggeld-Stufe eines Tages oder null. */
export function dayOverride(days, key) {
  const d = days && days[key];
  const v = d && d.allowance;
  return LEVELS.includes(v) ? v : null;
}

/** Taggeld je Tag im Zeitraum [from, to): Map dayKey → {key, hours, auto, level, manual, amount}.
 *  Nur Tage mit Arbeitseinträgen (oder manueller Stufe). Leer, wenn Taggeld ausgeschaltet. */
export function allowanceByDay({ entries, places, days, settings, dayKey }, from, to) {
  const a = readAllowance(settings);
  const out = new Map();
  if (!a.enabled) return out;
  const homeById = new Set(a.homePlaceIds);
  const home = (Array.isArray(places) ? places : []).filter((p) => p && homeById.has(p.id));
  const spans = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isWork(e) || isPrivateTrip(e) || !Number.isFinite(e.start) || e.start < from || e.start >= to) continue;
    const k = dayKey(e.start);
    if (!spans.has(k)) spans.set(k, []);
    spans.get(k).push(...awaySpans(e, home, homeById));
  }
  for (const k of Object.keys(days || {})) {
    if (!dayOverride(days, k) || spans.has(k)) continue;
    const [y, m, d] = k.split("-").map(Number);
    const ts = new Date(y, m - 1, d).getTime();
    if (ts >= from && ts < to) spans.set(k, []);
  }
  for (const [k, sp] of spans) {
    let hours = 0;
    if (sp.length) {
      const s = Math.min(...sp.map((x) => x.start));
      const e = Math.max(...sp.map((x) => x.end));
      hours = Math.max(0, (e - s) / 3600000);
    }
    const auto = levelForHours(hours, a);
    const man = dayOverride(days, k);
    const level = man || auto;
    out.set(k, { key: k, hours, auto, level, manual: !!man, amount: amountFor(level, a) });
  }
  return out;
}

/** Zusammenfassung: {part, full, sum, missingRate} über eine allowanceByDay-Map. */
export function allowanceSummary(map) {
  let part = 0, full = 0, sum = 0, missingRate = false;
  for (const d of map.values()) {
    if (d.level === "part") part++;
    if (d.level === "full") full++;
    if (d.level !== "none") {
      if (d.amount == null) missingRate = true; else sum += d.amount;
    }
  }
  return { part, full, sum, missingRate };
}

/* ---------------- Formate ---------------- */

/** km → "23" / "2,4" / "1.234". */
export function fmtKm(km) {
  const v = Math.max(0, Number(km) || 0);
  if (v < 10) return (Math.round(v * 10) / 10).toLocaleString("de-AT", { maximumFractionDigits: 1 });
  return Math.round(v).toLocaleString("de-AT");
}

/** Euro → "9,90 €". */
export function fmtEur(v) {
  const n = Number(v) || 0;
  return n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/** Deutsche Zahl ("0,50", "12.5") → Zahl oder null (leer) oder NaN (ungültig). */
export function parseNum(str) {
  const t = String(str == null ? "" : str).trim().replace(/\s|€|km/gi, "");
  if (t === "") return null;
  const n = Number(t.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
