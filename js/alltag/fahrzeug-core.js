// Update 10 – Alltag › 🚗 Fahrzeuge: reine Logik ohne DOM (in Node ladbar, Tests: test/fahrzeug-core.test.mjs).
// Die Fahrzeuge selbst (id, Name, Kennzeichen, Art, km-Stand am Monatsanfang) bleiben in settings.vehicles
// (js/trip-core.js, Fahrtenbuch) – hier nur die Zusatzangaben je Fahrzeug, KEINE zweite Fahrzeugliste:
//
// Sammlung „fahrzeug_info“ (js/alltag/db.js), Dokument-ID = Fahrzeug-ID: {
//   id, make (Marke/Modell), odo: [{ date, km, note? }],
//   service: { lastDate?, lastKm?, everyMonths?, everyKm?, note? },
//   pickerl: { month: "JJJJ-MM" (gelochter Monat), years: 1|2|3 },
//   insurance: { company, policy, until: "JJJJ-MM-TT" }   (nur unkritische Felder, keine Zugangsdaten)
//   notes }
// Tankungen: Sammlung travel_fuel (Unterwegs › Tanken) mit optionalem vehicleId. Ohne vehicleId zählen sie
// zum Standard-Fahrzeug (settings.trips.defaultVehicleId bzw. dem einzigen Fahrzeug).
import { fuelStats } from "./unterwegs-core.js";
import { addMonths, daysBetween, isKey, fmtKey, todayKey } from "./werkzeug-core.js";

export { isKey, fmtKey, todayKey, daysBetween, addMonths };
export const SOON_DAYS = 30;
export const SOON_KM = 1000;
const s = (v) => (v == null ? "" : String(v).trim());
const pad = (n) => String(n).padStart(2, "0");
const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
export const isMonth = (m) => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monthLabel = (m) => (isMonth(m) ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "");
export function shiftMonth(m, n) {
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1 + n;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  return `${y}-${pad(mo + 1)}`;
}
const lastDayOf = (m) => `${m}-${pad(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate())}`;

/** Zusatzangaben mit Standardwerten. */
export function normInfo(x, id = "") {
  const d = x && typeof x === "object" ? x : {};
  const sv = d.service && typeof d.service === "object" ? d.service : {};
  const pk = d.pickerl && typeof d.pickerl === "object" ? d.pickerl : {};
  const ins = d.insurance && typeof d.insurance === "object" ? d.insurance : {};
  const odo = (Array.isArray(d.odo) ? d.odo : [])
    .filter((r) => r && isKey(r.date) && posNum(r.km))
    .map((r) => ({ date: r.date, km: Math.round(Number(r.km)), ...(s(r.note) ? { note: s(r.note).slice(0, 120) } : {}) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
  const years = [1, 2, 3].includes(Number(pk.years)) ? Number(pk.years) : 1;
  return {
    ...d,
    id: s(d.id) || s(id),
    make: s(d.make),
    odo,
    service: {
      lastDate: isKey(sv.lastDate) ? sv.lastDate : null,
      lastKm: posNum(sv.lastKm) ? Math.round(Number(sv.lastKm)) : null,
      everyMonths: posNum(sv.everyMonths) ? Math.round(Number(sv.everyMonths)) : null,
      everyKm: posNum(sv.everyKm) ? Math.round(Number(sv.everyKm)) : null,
      note: s(sv.note),
    },
    pickerl: { month: isMonth(pk.month) ? pk.month : null, years },
    insurance: { company: s(ins.company), policy: s(ins.policy), until: isKey(ins.until) ? ins.until : null },
    notes: s(d.notes),
  };
}

/* ---------- Tankbuch ---------- */

/** Tankungen eines Fahrzeugs. Ohne vehicleId → Standard-Fahrzeug (defaultId). */
export function vehicleFills(fills, vehicleId, defaultId = null) {
  return (fills || []).filter((f) => f && (f.vehicleId ? f.vehicleId === vehicleId : !!defaultId && defaultId === vehicleId));
}

/** Verbrauch aus Volltankungen → { l100, eur100, km, liters, cost, n } (null-Werte, solange < 2 Volltankungen). */
export function consumption(fills) {
  const st = fuelStats(fills || []);
  return {
    l100: st.avgL100,
    eur100: st.eurKm != null ? st.eurKm * 100 : null,
    km: st.km, liters: st.liters, cost: st.cost, n: (fills || []).length, rows: st.rows,
  };
}

/* ---------- Kilometerstand ---------- */

/**
 * Alle bekannten km-Stände (eigene Einträge, Tankungen, km-Stand am Monatsanfang aus dem Fahrtenbuch),
 * nach Datum sortiert → [{ date, km, src: "eintrag"|"tanken"|"fahrtenbuch", note? }]
 */
export function odoReadings(info, fills = [], vehicle = null) {
  const out = [];
  for (const r of normInfo(info).odo) out.push({ ...r, src: "eintrag" });
  for (const f of fills || []) if (f && isKey(f.date) && posNum(f.km)) out.push({ date: f.date, km: Math.round(Number(f.km)), src: "tanken" });
  const os = vehicle && vehicle.odoStart && typeof vehicle.odoStart === "object" ? vehicle.odoStart : {};
  for (const [m, km] of Object.entries(os)) if (isMonth(m) && posNum(km)) out.push({ date: `${m}-01`, km: Math.round(Number(km)), src: "fahrtenbuch" });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.km - b.km);
}
/** Aktueller km-Stand (höchster bekannter – ein Tacho läuft nicht zurück) oder null. */
export function currentKm(readings) {
  const ks = (readings || []).map((r) => r.km).filter((k) => k > 0);
  return ks.length ? Math.max(...ks) : null;
}
/** Grob: km pro Jahr aus erstem und letztem Stand (mind. 30 Tage Abstand), sonst null. */
export function kmPerYear(readings) {
  const r = (readings || []).filter((x) => x.km > 0);
  if (r.length < 2) return null;
  const a = r[0], b = r[r.length - 1];
  const d = daysBetween(a.date, b.date);
  if (d < 30 || b.km <= a.km) return null;
  return Math.round(((b.km - a.km) / d) * 365);
}

/* ---------- Service ---------- */

/**
 * Nächstes Service nach Datum ODER km (was zuerst kommt).
 * → { state: "none"|"ok"|"bald"|"ueber", dueDate, days, dueKm, kmLeft, label }
 */
export function serviceStatus(info, kmNow, today, { soonDays = SOON_DAYS, soonKm = SOON_KM } = {}) {
  const sv = normInfo(info).service;
  const dueDate = sv.everyMonths && sv.lastDate ? addMonths(sv.lastDate, sv.everyMonths) : null;
  const dueKm = sv.everyKm && sv.lastKm ? sv.lastKm + sv.everyKm : null;
  if (!dueDate && !dueKm) return { state: "none", dueDate: null, days: null, dueKm: null, kmLeft: null, label: sv.everyMonths || sv.everyKm ? "Letztes Service eintragen" : "" };
  const days = dueDate ? daysBetween(today, dueDate) : null;
  const kmLeft = dueKm && kmNow ? dueKm - kmNow : null;
  const over = (days != null && days < 0) || (kmLeft != null && kmLeft < 0);
  const soon = (days != null && days <= soonDays) || (kmLeft != null && kmLeft <= soonKm);
  const bits = [];
  if (dueDate) bits.push(days < 0 ? `seit ${fmtKey(dueDate)}` : `bis ${fmtKey(dueDate)}`);
  if (dueKm) bits.push(kmLeft != null ? (kmLeft < 0 ? `${fmtKm(-kmLeft)} drüber` : `noch ${fmtKm(kmLeft)}`) : `bei ${fmtKm(dueKm)}`);
  return { state: over ? "ueber" : soon ? "bald" : "ok", dueDate, days, dueKm, kmLeft, label: bits.join(" · ") };
}
export function fmtKm(n) {
  const v = Math.round(Number(n) || 0);
  return `${String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} km`;
}

/* ---------- §57a-Begutachtung („Pickerl“) ---------- */

export const PICKERL_HINT = "Faustregel für Österreich (§57a KFG): Die Begutachtung ist ab einem Monat vor dem gelochten Monat " +
  "bis vier Monate danach möglich (Toleranzfrist). Bei Pkw meist 3 – 2 – 1 Jahre (neu nach 3 Jahren, dann nach 2, dann jährlich). " +
  "Nur ein Hinweis – verbindlich ist, was auf deiner Plakette und beim Prüfer steht.";

/**
 * Status zur Plakette mit gelochtem Monat M:
 *   "ok" (noch weit weg) | "bald" (≤ 30 Tage bis Fenster) | "jetzt" (Monat vor M oder M) | "toleranz" (M+1 … M+4) | "abgelaufen" (danach) | "none"
 * → { state, month, windowStart, graceEnd, days (bis Fensterbeginn bzw. Ende der Frist), label }
 */
export function pickerlStatus(info, today, { soonDays = SOON_DAYS } = {}) {
  const pk = normInfo(info).pickerl;
  if (!pk.month) return { state: "none", month: null, windowStart: null, graceEnd: null, days: null, label: "" };
  const windowStart = `${shiftMonth(pk.month, -1)}-01`;
  const graceEnd = lastDayOf(shiftMonth(pk.month, 4));
  const monthEnd = lastDayOf(pk.month);
  const base = { month: pk.month, windowStart, graceEnd };
  if (today < windowStart) {
    const days = daysBetween(today, windowStart);
    return { ...base, state: days <= soonDays ? "bald" : "ok", days, label: `möglich ab ${fmtKey(windowStart)}` };
  }
  if (today <= monthEnd) return { ...base, state: "jetzt", days: daysBetween(today, graceEnd), label: `Jetzt fällig (${monthLabel(pk.month)}) – Termin ausmachen` };
  if (today <= graceEnd) return { ...base, state: "toleranz", days: daysBetween(today, graceEnd), label: `Toleranzfrist bis ${fmtKey(graceEnd)}` };
  return { ...base, state: "abgelaufen", days: daysBetween(today, graceEnd), label: `Frist seit ${fmtKey(graceEnd)} vorbei` };
}
/** Nach erledigter Begutachtung: nächster gelochter Monat = bisheriger Monat + years Jahre (der Monat bleibt gleich). */
export function nextPickerlMonth(month, years = 1) {
  if (!isMonth(month)) return null;
  return shiftMonth(month, 12 * ([1, 2, 3].includes(Number(years)) ? Number(years) : 1));
}

/* ---------- Versicherung ---------- */

export function insuranceStatus(info, today, { soonDays = SOON_DAYS } = {}) {
  const ins = normInfo(info).insurance;
  if (!ins.until) return { state: "none", until: null, days: null, label: "" };
  const days = daysBetween(today, ins.until);
  if (days < 0) return { state: "ueber", until: ins.until, days, label: `abgelaufen am ${fmtKey(ins.until)}` };
  return { state: days <= soonDays ? "bald" : "ok", until: ins.until, days, label: `bis ${fmtKey(ins.until)}` };
}

/* ---------- Fälligkeiten (für Benachrichtigungen/Dashboard) ---------- */

/**
 * vehicles = settings.vehicles (normalisiert), infos = Dokumente aus fahrzeug_info, fills = travel_fuel
 * → [{ vehicleId, label, kind: "pickerl"|"service"|"versicherung", state, e, text, days, hash }], dringendste zuerst.
 */
export function dueVehicles(vehicles, infos, fills = [], now = Date.now(), { defaultId = null, soonDays = SOON_DAYS } = {}) {
  const today = todayKey(now);
  const byId = new Map((infos || []).filter((x) => x && x.id).map((x) => [x.id, x]));
  const out = [];
  const pri = { abgelaufen: 0, ueber: 0, toleranz: 1, jetzt: 2, bald: 3 };
  for (const v of vehicles || []) {
    if (!v || !v.id) continue;
    const info = normInfo(byId.get(v.id), v.id);
    const label = v.plate ? `${s(v.name) || "Fahrzeug"} (${v.plate})` : s(v.name) || "Fahrzeug";
    const base = { vehicleId: v.id, label, hash: vehicleHash(v.id) };
    const p = pickerlStatus(info, today, { soonDays });
    if (["bald", "jetzt", "toleranz", "abgelaufen"].includes(p.state)) out.push({ ...base, kind: "pickerl", state: p.state, e: p.state === "abgelaufen" ? "⛔" : "🔖", days: p.days, text: `🔖 Pickerl ${label}: ${p.label}` });
    const km = currentKm(odoReadings(info, vehicleFills(fills, v.id, defaultId), v));
    const sv = serviceStatus(info, km, today, { soonDays });
    if (sv.state === "bald" || sv.state === "ueber") out.push({ ...base, kind: "service", state: sv.state, e: "🔧", days: sv.days, text: `🔧 Service ${label}: ${sv.state === "ueber" ? "überfällig" : "bald fällig"} (${sv.label})` });
    const ins = insuranceStatus(info, today, { soonDays });
    if (ins.state === "bald" || ins.state === "ueber") out.push({ ...base, kind: "versicherung", state: ins.state, e: "🛡️", days: ins.days, text: `🛡️ Versicherung ${label}: ${ins.label}` });
  }
  return out.sort((a, b) => (pri[a.state] ?? 9) - (pri[b.state] ?? 9) || (a.days ?? 0) - (b.days ?? 0));
}

export const vehicleHash = (id) => `#alltag/fahrzeuge/${encodeURIComponent(s(id))}`;
export function routeId(hash) {
  const h = s(hash).replace(/^#/, "").split("?")[0];
  if (h === "alltag/fahrzeuge") return "";
  const m = /^alltag\/fahrzeuge\/(.+)$/.exec(h);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}
