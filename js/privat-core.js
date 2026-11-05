// Update 9 – Privat / Arbeit: reine Logik ohne DOM (Web-App, tools/reminders/decide.mjs, tools/mcp; Android rechnet gleich).
//   settings.mode         = { privat: bool, since: ts, until: ts|null, source: "manual"|"schedule" }
//   settings.modeSchedule = { enabled (Standard aus), from "06:00", to "17:00" }
//                           → an Arbeitstagen außerhalb von–bis, an freien Tagen und Feiertagen automatisch privat
//   settings.privatTrips  = { record (Standard an) } – Fahrten im Privat-Modus als Privatfahrt ins Fahrtenbuch
// Kalender-Sicht `cal` = { key "YYYY-MM-DD", wd 0–6 (So = 0), min (Minute des Tages), holiday: bool } liefert der
// Aufrufer über `calOf(ts)` (Web: lokale Zeit, Server: Europe/Vienna).
//
// Regeln (effectiveMode):
//   - Eingestempelt → immer Arbeit (Privat wird beim Einstempeln beendet; nie still ausstempeln).
//   - Selbst gewählt (source "manual"): Privat gilt bis `until` (null = bis ich es ausschalte).
//     Selbst gewähltes „Arbeit“ überstimmt den Zeitplan nur bis zum nächsten Wechsel des Zeitplans.
//   - Sonst Zeitplan (falls eingeschaltet), sonst Arbeit.
// Private Fahrt = eigener Eintrag `tripOnly: true, privateTrip: true` (+ pauseMin = Dauer für ältere Auswertungen)
// mit einem Abschnitt „Autofahren“ (`private: true`) – zählt nie als Arbeitszeit.

export const DEFAULT_FROM = "06:00";
export const DEFAULT_TO = "17:00";
export const EVENING = "20:00";
const DAY_MS = 86400000;
const RE_T = /^(\d{1,2}):(\d{2})$/;
const MAX_OVERRIDE_MS = 8 * DAY_MS;

const pad = (n) => String(n).padStart(2, "0");

function toMin(t) {
  const m = RE_T.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Gespeicherter Modus oder null. */
export function readMode(settings) {
  const m = settings && settings.mode;
  if (!m || typeof m !== "object") return null;
  const since = Number(m.since);
  const until = Number(m.until);
  return {
    privat: m.privat === true,
    since: Number.isFinite(since) && since > 0 ? since : 0,
    until: m.until != null && Number.isFinite(until) && until > 0 ? until : null,
    source: m.source === "schedule" ? "schedule" : "manual",
  };
}

/** Zeitplan mit Standardwerten. */
export function readModeSchedule(settings) {
  const x = (settings && settings.modeSchedule && typeof settings.modeSchedule === "object") ? settings.modeSchedule : {};
  let fromMin = toMin(x.from), toMinV = toMin(x.to);
  if (fromMin == null) fromMin = toMin(DEFAULT_FROM);
  if (toMinV == null) toMinV = toMin(DEFAULT_TO);
  if (fromMin === toMinV) { fromMin = toMin(DEFAULT_FROM); toMinV = toMin(DEFAULT_TO); }
  const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return { enabled: x.enabled === true, from: fmt(fromMin), to: fmt(toMinV), fromMin, toMin: toMinV };
}

/** Private Fahrten aufzeichnen? (Standard an) */
export function recordPrivateTrips(settings) {
  const p = settings && settings.privatTrips;
  return !(p && typeof p === "object" && p.record === false);
}

export function workDaysOf(settings) {
  const d = settings && Array.isArray(settings.workDays) ? settings.workDays.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6) : null;
  return d || [1, 2, 3, 4, 5];
}

/** Sagt der Zeitplan an diesem Zeitpunkt (cal) „privat“? Ohne eingeschalteten Zeitplan immer false. */
export function scheduleIsPrivat(cal, settings) {
  const sc = readModeSchedule(settings);
  if (!sc.enabled || !cal) return false;
  if (!workDaysOf(settings).includes(cal.wd)) return true;          // freier Tag / Wochenende
  if ((settings || {}).holidays !== false && cal.holiday) return true; // Feiertag
  const inWork = sc.fromMin < sc.toMin
    ? cal.min >= sc.fromMin && cal.min < sc.toMin
    : cal.min >= sc.fromMin || cal.min < sc.toMin;                // Nachtschicht über Mitternacht
  return !inWork;
}

/** Nächste mögliche Wechselstelle des Zeitplans nach t (Mitternacht, von, bis). */
function nextBoundary(t, cal, sc) {
  const cands = [sc.fromMin, sc.toMin, 1440].filter((m) => m > cal.min);
  const m = Math.min(...cands);
  const midnight = t - (((t % 60000) + 60000) % 60000) - cal.min * 60000;
  return midnight + m * 60000;
}

/** Erster Zeitpunkt in (a, b], an dem der Zeitplan anders entscheidet als bei a – sonst null. */
export function scheduleChangeBetween(settings, a, b, calOf) {
  const sc = readModeSchedule(settings);
  if (!sc.enabled || !calOf || !(b > a)) return null;
  const st = scheduleIsPrivat(calOf(a), settings);
  let t = a;
  for (let i = 0; i < 64; i++) {
    let n = nextBoundary(t, calOf(t), sc);
    if (!(n > t)) n = t + 60000;
    if (n > b) return null;
    if (scheduleIsPrivat(calOf(n), settings) !== st) return n;
    t = n;
  }
  return null;
}

/** Nächster Wechsel des Zeitplans ab now (höchstens 8 Tage voraus) oder null. */
export function nextScheduleChange(settings, now, calOf) {
  return scheduleChangeBetween(settings, now, now + MAX_OVERRIDE_MS, calOf);
}

/**
 * Wirksamer Modus.
 *   opts = { running (laufende Schicht oder null), calOf(ts) → cal }
 * → { privat, source: "manual"|"schedule"|"none"|"running", until: ts|null, blocked (Privat gewählt, aber eingestempelt) }
 */
export function effectiveMode(settings, now, { running = null, calOf = null } = {}) {
  const sc = readModeSchedule(settings);
  const schedPriv = !!(calOf && sc.enabled && scheduleIsPrivat(calOf(now), settings));
  const m = readMode(settings);
  let manual = null;
  if (m && m.source === "manual" && !(m.until != null && now >= m.until)) {
    if (m.privat) manual = m;
    else if (!sc.enabled || !calOf) manual = m;
    else if (m.since > 0 && now - m.since < MAX_OVERRIDE_MS && scheduleChangeBetween(settings, m.since, now, calOf) == null) manual = m;
  }
  const privat = manual ? manual.privat : schedPriv;
  const out = { privat, source: manual ? "manual" : (schedPriv ? "schedule" : "none"), until: null, blocked: false };
  if (privat) out.until = manual ? manual.until : nextScheduleChange(settings, now, calOf);
  if (running) {
    out.blocked = privat;
    out.privat = false;
    out.source = "running";
    out.until = null;
  }
  return out;
}

/* ---------- „Privat bis …“ ---------- */

export const UNTIL_CHOICES = [
  { id: "1h", label: "1 Stunde" },
  { id: "abend", label: "bis heute Abend" },
  { id: "morgen", label: "bis morgen früh" },
  { id: "aus", label: "bis ich es ausschalte" },
];

/**
 * Ende für eine Auswahl. tsOf(tageVersatz, hh, mm) → Zeitstempel (lokal bzw. Wien).
 * „abend“ = heute 20:00 (danach nicht mehr möglich → null zurück mit ok false),
 * „morgen“ = morgen zu Beginn der Arbeitszeit (Zeitplan „von“, Standard 06:00).
 * → { ok, until: ts|null }
 */
export function untilFor(id, now, settings, tsOf) {
  if (id === "aus" || id == null || id === "") return { ok: true, until: null };
  if (id === "1h") return { ok: true, until: now + 3600000 };
  if (id === "abend") {
    const [h, mi] = EVENING.split(":").map(Number);
    const t = tsOf(0, h, mi);
    return t > now + 5 * 60000 ? { ok: true, until: t } : { ok: false, until: null };
  }
  if (id === "morgen") {
    const sc = readModeSchedule(settings);
    return { ok: true, until: tsOf(1, Math.floor(sc.fromMin / 60), sc.fromMin % 60) };
  }
  return { ok: false, until: null };
}

/** Welche Auswahl passt zu einem gespeicherten Ende? (für die gedrückte Pille) */
export function untilChoiceOf(mode, settings, tsOf) {
  if (!mode || !mode.privat) return null;
  if (mode.until == null) return "aus";
  const since = mode.since || 0;
  if (Math.abs(mode.until - since - 3600000) < 60000) return "1h";
  const ab = untilFor("abend", since - 10 * 60000, settings, tsOf);
  if (ab.ok && ab.until === mode.until) return "abend";
  const mo = untilFor("morgen", since, settings, tsOf);
  if (mo.until === mode.until) return "morgen";
  return null;
}

/** Neuer Modus-Wert zum Speichern. */
export function modeValue(privat, now, until = null, source = "manual") {
  return { privat: !!privat, since: now, until: privat && Number.isFinite(until) ? until : null, source };
}

/* ---------- Private Fahrten ---------- */

/** Private Fahrt (eigener Eintrag, zählt nie als Arbeitszeit)? Auch ältere nachgetragene Privatfahrten (tripOnly, alle Abschnitte privat). */
export function isPrivateTrip(e) {
  if (!e || typeof e !== "object") return false;
  if (e.privateTrip === true) return true;
  return e.tripOnly === true && Array.isArray(e.segments) && e.segments.length > 0 &&
    e.segments.every((x) => x && x.private === true);
}

/** Eintrag für eine im Privat-Modus erkannte Fahrt (wie die nachgetragene Privatfahrt im Fahrtenbuch). */
export function privateTripEntry({ start, end, fromLoc = null, toLoc = null, fromPlace = null, toPlace = null, src = "privat" }) {
  const dur = Math.max(0, Math.round((end - start) / 60000));
  const seg = {
    start, end, activity: "Autofahren",
    placeId: (fromPlace && fromPlace.id) || null, place: (fromPlace && fromPlace.name) || "",
    loc: fromLoc || null,
    endLoc: toLoc || null, endPlace: (toPlace && toPlace.name) || (toLoc && toLoc.addr) || "",
    endPlaceId: (toPlace && toPlace.id) || null,
    private: true, purpose: "Privat", autoTrip: true,
  };
  return {
    kind: "work", start, end, pauseMin: dur,
    placeId: (toPlace && toPlace.id) || null, place: (toPlace && toPlace.name) || "",
    note: "Privatfahrt", people: [],
    inLoc: fromLoc || null, outLoc: toLoc || null,
    segments: [seg], tripOnly: true, privateTrip: true, src,
  };
}

/** Kurzer Text für Status-Zeilen (MCP, Benachrichtigung): „Privat bis 20:00“ usw. clockFn(ts) → "HH:MM". */
export function modeText(eff, clockFn, dayFn = null) {
  if (!eff) return "Arbeit";
  if (eff.source === "running") return eff.blocked ? "Arbeit (eingestempelt – Privat-Modus ruht)" : "Arbeit (eingestempelt)";
  if (!eff.privat) return eff.source === "manual" ? "Arbeit (selbst gewählt)" : "Arbeit";
  const how = eff.source === "schedule" ? "automatisch außerhalb der Arbeitszeit" : "selbst gewählt";
  const dw = eff.until != null && dayFn ? dayFn(eff.until) : "";
  const until = eff.until != null ? ` bis ${dw ? dw + " " : ""}${clockFn(eff.until)}` : (eff.source === "manual" ? " bis du es ausschaltest" : "");
  return `Privat${until} (${how})`;
}
