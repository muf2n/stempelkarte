// Update 9 – Fahrtenbuch: reine Logik ohne DOM (Kurzadressen, Gruppierung nach Tag, Rückfahrten,
// Fahrzeuge, Kilometerstand-Kette, Monatssummen, Filter, Zeilen für CSV/Druck).
// settings.vehicles = [{ id, name, plate, type: "firma" | "privat", odoStart?: { "YYYY-MM": km } }]
// settings.trips    = { roadKm (Standard true), defaultVehicleId }
import { haversineM, readAllowance, fmtKm } from "./travel.js";

export const PURPOSE_CHIPS = ["Baustelle", "Material holen", "Kunde", "Büro", "Berufsschule", "Privat"];
export const VEHICLE_TYPES = { firma: "Firmenauto", privat: "Privatauto" };

const pad = (n) => String(n).padStart(2, "0");

/* ---------- Einstellungen ---------- */

/** Fahrtenbuch-Einstellungen mit Standardwerten. */
export function readTripSettings(settings) {
  const t = (settings && settings.trips && typeof settings.trips === "object") ? settings.trips : {};
  return {
    roadKm: t.roadKm !== false,
    defaultVehicleId: typeof t.defaultVehicleId === "string" && t.defaultVehicleId ? t.defaultVehicleId : null,
  };
}

/** Gültige Fahrzeuge (ohne doppelte IDs). */
export function readVehicles(settings) {
  const list = settings && Array.isArray(settings.vehicles) ? settings.vehicles : [];
  const seen = new Set();
  const out = [];
  for (const v of list) {
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    const odo = {};
    if (v.odoStart && typeof v.odoStart === "object") {
      for (const [k, n] of Object.entries(v.odoStart)) {
        const x = Number(n);
        if (/^\d{4}-\d{2}$/.test(k) && Number.isFinite(x) && x >= 0) odo[k] = x;
      }
    }
    out.push({
      id: v.id,
      name: String(v.name || "").trim() || "Fahrzeug",
      plate: String(v.plate || "").trim().toUpperCase(),
      type: v.type === "privat" ? "privat" : "firma",
      odoStart: odo,
    });
  }
  return out;
}

/** Standard-Fahrzeug: eingestelltes, sonst das einzige vorhandene, sonst null. */
export function defaultVehicle(settings) {
  const vs = readVehicles(settings);
  const id = readTripSettings(settings).defaultVehicleId;
  return vs.find((v) => v.id === id) || (vs.length === 1 ? vs[0] : null);
}

/** Fahrzeug einer Fahrt (am Abschnitt gewählt, sonst Standard) oder null. */
export function tripVehicle(t, settings) {
  const vs = readVehicles(settings);
  if (t && t.vehicleId) { const v = vs.find((x) => x.id === t.vehicleId); if (v) return v; }
  return defaultVehicle(settings);
}

export function vehicleLabel(v) {
  if (!v) return "";
  return v.plate ? `${v.name} (${v.plate})` : v.name;
}

/* ---------- Adressen ---------- */

/** "Musterstraße 1, 8000 Musterstadt" → {main: "Musterstraße 1", sub: "8000 Musterstadt"}.
 *  Ohne PLZ-Teil: erster Teil = main, Rest = sub. */
export function shortAddr(addr) {
  const s = String(addr || "").replace(/\s+/g, " ").trim();
  if (!s) return { main: "", sub: "" };
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) {
    // "8000 Musterstadt" oder "Musterstraße 1 8000 Musterstadt" (ohne Komma)
    const m = s.match(/^(.*?\S)\s+((?:A-)?\d{4}\s+\S.*)$/);
    if (m && /\D/.test(m[1])) return { main: m[1], sub: m[2] };
    return { main: s, sub: "" };
  }
  const plzI = parts.findIndex((x, i) => i > 0 && /^(?:A-|AT-)?\d{4}\b/.test(x));
  if (plzI > 0) {
    const sub = parts[plzI].replace(/^(?:A-|AT-)/, "");
    return { main: parts.slice(0, plzI).join(", "), sub };
  }
  return { main: parts[0], sub: parts.slice(1).filter((x) => !/^(österreich|austria)$/i.test(x)).join(", ") };
}

/** Anzeige eines Orts: gespeicherter Name bevorzugt, sonst Kurzadresse. → {main, sub, full}. */
export function placeLabel(name, addr, saved) {
  const a = String(addr || "").trim();
  const n = String(name || "").trim();
  if (saved && n) {
    const s = a ? shortAddr(a) : { sub: "" };
    return { main: n, sub: s.sub || "", full: a ? `${n} · ${a}` : n };
  }
  const src = a || n;
  if (!src) return { main: "?", sub: "", full: "" };
  const s = shortAddr(src);
  return { main: s.main || src, sub: s.sub, full: src };
}

export function fromLabel(t) { return placeLabel(t.from, t.fromAddr, t.fromSaved); }
export function toLabel(t) { return placeLabel(t.to, t.toAddr, t.toSaved); }

/* ---------- Gruppierung / Rückfahrten ---------- */

function samePlace(nameA, locA, nameB, locB) {
  if (locA && locB) return haversineM(locA, locB) <= 300;
  const a = String(nameA || "").trim().toLowerCase();
  const b = String(nameB || "").trim().toLowerCase();
  return !!a && a === b;
}

/** Markiert Rückfahrten: Fahrt endet dort, wo eine frühere Fahrt desselben Tages begonnen hat,
 *  und beginnt dort, wo diese hingefahren ist. Setzt t.isReturn (true/false). */
export function markReturns(trips, dayKey) {
  const byDay = new Map();
  for (const t of trips) {
    const k = dayKey(t.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a.start - b.start);
    list.forEach((t, i) => {
      t.isReturn = false;
      for (let j = i - 1; j >= 0; j--) {
        const o = list[j];
        if (samePlace(t.to, t.toLoc, o.from, o.fromLoc) && samePlace(t.from, t.fromLoc, o.to, o.toLoc)) { t.isReturn = true; break; }
      }
    });
  }
  return trips;
}

/** Fahrten nach Tag gruppieren → [{key, ts, trips, km, count}] (chronologisch). */
export function groupByDay(trips, dayKey) {
  const map = new Map();
  for (const t of [...trips].sort((a, b) => a.start - b.start)) {
    const k = dayKey(t.start);
    if (!map.has(k)) {
      const d = new Date(t.start);
      map.set(k, { key: k, ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), trips: [], km: 0, count: 0, approx: false });
    }
    const g = map.get(k);
    g.trips.push(t);
    g.count++;
    g.km += t.km || 0;
    if (t.est) g.approx = true;
  }
  return [...map.values()];
}

/** km mit einer Nachkommastelle unter 100 ("28,4"), darüber ganzzahlig ("1.234"). */
export function fmtKmD(km) {
  const v = Math.max(0, Number(km) || 0);
  if (v >= 100) return fmtKm(v);
  return (Math.round(v * 10) / 10).toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Tageskopf: "Mo, 02.11. · 4 Fahrten · 28,4 km". */
export function dayHeader(g, WD) {
  const d = new Date(g.ts);
  return `${WD[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}. · ${g.count} ${g.count === 1 ? "Fahrt" : "Fahrten"} · ${g.approx ? "≈ " : ""}${fmtKmD(g.km)} km`;
}

/* ---------- Filter ---------- */

function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
}

/** Filtert nach Ort/Adresse/Zweck/Fahrzeug (alle Wörter müssen vorkommen). */
export function filterTrips(trips, q, settings = null) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return trips;
  return trips.filter((t) => {
    const v = tripVehicle(t, settings);
    const hay = fold([t.from, t.to, t.fromAddr, t.toAddr, t.purpose, t.private ? "privat" : "beruflich", v ? `${v.name} ${v.plate}` : ""].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/* ---------- Summen ---------- */

/** Monatssummen: km gesamt/beruflich/privat, Quellen, Kilometergeld (nur berufliche Fahrten mit Privatauto;
 *  ohne Fahrzeug zählt der Schalter „Eigenes Auto“). */
export function totals(trips, settings) {
  const a = readAllowance(settings);
  const r = { km: 0, count: trips.length, bizKm: 0, privKm: 0, bizN: 0, privN: 0, kmgeldKm: 0, kmgeld: 0,
    manualN: 0, roadN: 0, estN: 0, unknownN: 0, approx: false, kmRate: a.kmRate, ownCar: a.ownCar };
  for (const t of trips) {
    const km = t.km || 0;
    r.km += km;
    if (t.private) { r.privKm += km; r.privN++; } else { r.bizKm += km; r.bizN++; }
    if (t.source === "manual") r.manualN++;
    else if (t.source === "road") r.roadN++;
    else if (t.source === "est") { r.estN++; r.approx = true; }
    else r.unknownN++;
    if (!t.private) {
      const v = tripVehicle(t, settings);
      if (v ? v.type === "privat" : a.ownCar) r.kmgeldKm += km;
    }
  }
  r.kmgeld = r.kmgeldKm * a.kmRate;
  r.showKmgeld = r.kmgeldKm > 0 || a.ownCar || readVehicles(settings).some((v) => v.type === "privat");
  return r;
}

/* ---------- Kilometerstand ---------- */

function monthKeyOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function monthStart(key) { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).getTime(); }

/** Kilometerstand je Fahrt: Map trip.key → {begin, end, vehicleId}.
 *  Für jedes Fahrzeug mit `odoStart[YYYY-MM]` wird ab dem jüngsten Monatsanfang ≤ Fahrt fortlaufend gezählt
 *  (Ende = Beginn + km, nächste Fahrt beginnt beim Ende der vorigen). Werte auf ganze km gerundet, lückenlos.
 *  `allTrips` = alle Fahrten (mindestens ab dem Startmonat) chronologisch. */
export function odometer(allTrips, settings) {
  const out = new Map();
  const vs = readVehicles(settings);
  for (const v of vs) {
    const months = Object.keys(v.odoStart).sort();
    if (!months.length) continue;
    const mine = allTrips.filter((t) => { const x = tripVehicle(t, settings); return x && x.id === v.id; })
      .sort((a, b) => a.start - b.start);
    let mi = -1; // aktueller Startmonat
    let run = 0;
    for (const t of mine) {
      const mk = monthKeyOf(t.start);
      // jüngsten Startmonat ≤ Fahrt finden; neuer Startwert setzt die Kette zurück
      let ni = mi;
      while (ni + 1 < months.length && months[ni + 1] <= mk) ni++;
      if (ni < 0) continue; // vor dem ersten bekannten Stand
      if (ni !== mi) { mi = ni; run = v.odoStart[months[mi]]; }
      if (t.start < monthStart(months[mi])) continue;
      const begin = Math.round(run);
      run += t.km || 0;
      out.set(t.key, { begin, end: Math.round(run), vehicleId: v.id });
    }
  }
  return out;
}

/* ---------- Zeilen für Export / Druck ---------- */

function fmtDate(ts) { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; }
function fmtClock(ts) { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function km1(v) { return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1).replace(".", ","); }

export const LOG_HEAD = ["Datum", "Abfahrt", "Ankunft", "Ausgangsort", "Zielort", "Zweck", "gefahrene km",
  "Kilometerstand Beginn", "Kilometerstand Ende", "Fahrzeug", "Kennzeichen", "beruflich/privat", "km-Quelle"];

const SRC_TXT = { manual: "manuell", road: "Straße", est: "Luftlinie (geschätzt)" };

/** Volle Ortsangabe für Export: "Büro (Musterweg 1, 8010 Graz)" bzw. Adresse. */
function fullPlace(name, addr, saved) {
  const n = String(name || "").trim(), a = String(addr || "").trim();
  if (saved && n && a && n !== a) return `${n} (${a})`;
  return a || n;
}

/** Fahrtenbuch-Zeilen (Arrays wie LOG_HEAD) für CSV/Druck. */
export function logRows(trips, settings, odo = new Map()) {
  return trips.map((t) => {
    const v = tripVehicle(t, settings);
    const o = odo.get(t.key);
    return [
      fmtDate(t.start), fmtClock(t.start), Number.isFinite(t.end) ? fmtClock(t.end) : "",
      fullPlace(t.from, t.fromAddr, t.fromSaved), fullPlace(t.to, t.toAddr, t.toSaved),
      t.purpose || "", t.km == null ? "" : km1(t.km),
      o ? String(o.begin) : "", o ? String(o.end) : "",
      v ? v.name : "", v ? v.plate : "", t.private ? "privat" : "beruflich",
      t.source ? SRC_TXT[t.source] : "",
    ];
  });
}

/** Google-Maps-Routenlink oder "" (ohne Koordinaten: Adresse/Name als Text). */
export function mapsDirUrl(t) {
  const enc = (loc, name, addr) => (loc ? `${loc.lat},${loc.lng}` : encodeURIComponent(addr || name || ""));
  const o = enc(t.fromLoc, t.from, t.fromAddr), d = enc(t.toLoc, t.to, t.toAddr);
  if (!o || !d) return "";
  // Update 10 – 📍 Zwischenstopps als Wegpunkte (Google erlaubt bis zu 9 in der URL)
  const via = Array.isArray(t.via) ? t.via.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, 9) : [];
  const wp = via.length ? `&waypoints=${via.map((p) => `${p.lat},${p.lng}`).join("%7C")}` : "";
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}${wp}&travelmode=driving`;
}

/** Abschnitt-Index im Roh-Array `entry.segments` → aktualisierte Abschnitte mit `patch` (null-Werte löschen das Feld). */
export function patchSegment(entry, rawIndex, patch) {
  const segs = (Array.isArray(entry && entry.segments) ? entry.segments : []).map((x) => (x ? { ...x } : x));
  const s = segs[rawIndex];
  if (!s) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete s[k]; else s[k] = v;
  }
  return segs;
}

/** Manuelle Fahrt in einen Arbeitseintrag einfügen: der Abschnitt, in dem die Fahrt liegt, wird geteilt.
 *  → neue segments oder null (Fahrt liegt nicht vollständig in EINEM Abschnitt). */
export function insertTrip(entry, drive) {
  const raw = Array.isArray(entry.segments) && entry.segments.length ? entry.segments : [{
    start: entry.start, end: entry.end, activity: "Arbeiten", placeId: entry.placeId ?? null, place: entry.place || "", loc: entry.inLoc ?? null,
  }];
  const segs = raw.filter((x) => x && Number.isFinite(x.start)).map((x, i, arr) => ({
    ...x, end: Number.isFinite(x.end) ? x.end : (arr[i + 1] ? arr[i + 1].start : entry.end),
  }));
  if (drive.start < entry.start || drive.end > entry.end || drive.end <= drive.start) return null;
  const i = segs.findIndex((s) => drive.start >= s.start && drive.start < s.end);
  if (i < 0) return null;
  const s = segs[i];
  if (drive.end > s.end) return null;
  const out = segs.slice(0, i);
  if (drive.start > s.start) out.push({ ...s, end: drive.start, endLoc: drive.loc ?? null, endPlace: drive.place || "" });
  out.push({ ...drive });
  if (drive.end < s.end) {
    const rest = { ...s, start: drive.end };
    if (!rest.place && drive.endPlace) rest.place = drive.endPlace;
    out.push(rest);
  }
  out.push(...segs.slice(i + 1));
  return out;
}
