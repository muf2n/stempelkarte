// TZ=Europe/Vienna node --test test/privat.test.mjs
// Update 9 – Privat / Arbeit: Modus-Regeln (Zeitplan, Wochenende, Feiertag, „Privat bis …“, Überstimmen),
// Privatfahrten zählen 0 h (netMin/creditMin, Überstundenkonto, Stundenzettel, Taggeld, Fahrtenbuch/Kilometergeld),
// Erinnerungen (decide.mjs) entfallen im Privat-Modus, Galerie → Kategorie „Privat“.
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/privat-core.js";
import * as util from "../js/util.js";
import * as timer from "../js/timer.js";
import * as T from "../js/travel.js";
import * as F from "../js/trip-core.js";
import * as G from "../js/gallery-core.js";
import { decide, viennaCal, isPrivatVienna, viennaToTs } from "../tools/reminders/decide.mjs";

const overview = await import("../js/views/overview.js").catch(() => null);
const timesheet = await import("../js/views/timesheet.js").catch(() => null);

const at = (m, d, h = 0, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();
const cal = (ts) => {
  const d = new Date(ts);
  return { key: util.dayKey(d), wd: d.getDay(), min: d.getHours() * 60 + d.getMinutes(), holiday: !!util.holidayName(d) };
};
const tsOfFrom = (now) => (off, hh, mm) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + off, hh, mm).getTime(); };
const SCHED = { workDays: [1, 2, 3, 4, 5], modeSchedule: { enabled: true, from: "06:00", to: "17:00" } };
const eff = (s, now, running = null) => P.effectiveMode(s, now, { running, calOf: cal });

/* ---------- Zeitplan ---------- */

test("Zeitplan: Arbeitstag innen/außen, Wochenende, Feiertag, aus = nie privat", () => {
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 10)), SCHED), false, "Mi 10:00 Arbeit");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 5, 59)), SCHED), true, "Mi 05:59 privat");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 6, 0)), SCHED), false, "Mi 06:00 Arbeit");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 17, 0)), SCHED), true, "Mi 17:00 privat");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 7, 10)), SCHED), true, "Sa privat");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 8, 10)), SCHED), true, "So privat");
  assert.equal(P.scheduleIsPrivat(cal(at(12, 8, 10)), SCHED), true, "Di 08.12. Mariä Empfängnis privat");
  assert.equal(P.scheduleIsPrivat(cal(at(12, 8, 10)), { ...SCHED, holidays: false }), false, "Feiertage ausgeschaltet → Arbeit");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 7, 10)), { ...SCHED, workDays: [1, 2, 3, 4, 5, 6] }), false, "Sa als Arbeitstag");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 7, 10)), { modeSchedule: { enabled: false } }), false, "Zeitplan aus");
  assert.equal(P.scheduleIsPrivat(cal(at(11, 7, 10)), {}), false, "Standard aus");
  // Nachtschicht 22:00–06:00
  const night = { modeSchedule: { enabled: true, from: "22:00", to: "06:00" } };
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 23)), night), false);
  assert.equal(P.scheduleIsPrivat(cal(at(11, 4, 12)), night), true);
  // ungültige Zeiten → Standard 06:00–17:00
  assert.deepEqual([P.readModeSchedule({ modeSchedule: { from: "25:00", to: "x" } }).from, P.readModeSchedule({}).to], ["06:00", "17:00"]);
});

test("Zeitplan: nächster Wechsel (Fr-Abend → Mo 06:00, Feiertag überspringen)", () => {
  assert.equal(P.nextScheduleChange(SCHED, at(11, 6, 18), cal), at(11, 9, 6, 0), "Fr 18:00 → Mo 06:00");
  assert.equal(P.nextScheduleChange(SCHED, at(11, 4, 10), cal), at(11, 4, 17, 0), "Mi 10:00 → 17:00");
  assert.equal(P.nextScheduleChange(SCHED, at(12, 7, 18), cal), at(12, 9, 6, 0), "Mo 07.12. 18:00 → Mi 09.12. 06:00 (08.12. Feiertag)");
  const e = eff(SCHED, at(11, 7, 11));
  assert.deepEqual([e.privat, e.source, e.until], [true, "schedule", at(11, 9, 6, 0)]);
});

/* ---------- Wirksamer Modus ---------- */

test("Modus: selbst gewählt Privat (bis …), Ablauf, eingestempelt = Arbeit", () => {
  const now = at(11, 4, 10);
  assert.deepEqual(eff({}, now), { privat: false, source: "none", until: null, blocked: false });
  const s1 = { mode: P.modeValue(true, now, now + 3600000) };
  assert.deepEqual(eff(s1, now + 1000), { privat: true, source: "manual", until: now + 3600000, blocked: false });
  assert.equal(eff(s1, now + 3600000).privat, false, "nach 1 h wieder Arbeit");
  const s2 = { mode: P.modeValue(true, now, null) };
  assert.equal(eff(s2, now + 30 * 86400000).privat, true, "bis ich es ausschalte");
  const r = eff(s2, now, { start: now - 1000 });
  assert.deepEqual([r.privat, r.source, r.blocked], [false, "running", true], "eingestempelt → Arbeit");
  // selbst gewähltes Privat überstimmt den Zeitplan während der Arbeitszeit
  assert.equal(eff({ ...SCHED, mode: P.modeValue(true, now, null) }, now).privat, true);
});

test("Modus: „Arbeit“ überstimmt den Zeitplan nur bis zum nächsten Wechsel", () => {
  const sat = at(11, 7, 10);
  const s = { ...SCHED, mode: P.modeValue(false, sat, null) };
  assert.equal(eff(s, sat + 1000).privat, false, "Sa: selbst Arbeit gewählt");
  assert.equal(eff(s, at(11, 8, 22)).privat, false, "So abends noch Arbeit (kein Wechsel seit Sa)");
  assert.equal(eff(s, at(11, 9, 10)).privat, false, "Mo 10:00 Arbeit (Zeitplan sagt ohnehin Arbeit)");
  assert.equal(eff(s, at(11, 9, 18)).privat, true, "Mo 18:00: Zeitplan wieder privat (Überstimmen abgelaufen)");
  // Abend: Arbeit gewählt um 18:00 → am nächsten Morgen um 06:00 wechselt der Plan → Abend danach wieder privat
  const s2 = { ...SCHED, mode: P.modeValue(false, at(11, 4, 18), null) };
  assert.equal(eff(s2, at(11, 4, 23)).privat, false);
  assert.equal(eff(s2, at(11, 5, 18)).privat, true);
});

test("„Privat bis …“: 1 h, heute Abend, morgen früh, bis ich es ausschalte", () => {
  const now = at(11, 4, 14, 0);
  const tsOf = tsOfFrom(now);
  assert.deepEqual(P.untilFor("1h", now, {}, tsOf), { ok: true, until: now + 3600000 });
  assert.deepEqual(P.untilFor("abend", now, {}, tsOf), { ok: true, until: at(11, 4, 20, 0) });
  assert.deepEqual(P.untilFor("morgen", now, {}, tsOf), { ok: true, until: at(11, 5, 6, 0) });
  assert.deepEqual(P.untilFor("morgen", now, { modeSchedule: { from: "07:15" } }, tsOf), { ok: true, until: at(11, 5, 7, 15) });
  assert.deepEqual(P.untilFor("aus", now, {}, tsOf), { ok: true, until: null });
  const late = at(11, 4, 19, 58);
  assert.equal(P.untilFor("abend", late, {}, tsOfFrom(late)).ok, false, "nach 19:55 kein „heute Abend“ mehr");
  for (const id of ["1h", "abend", "morgen", "aus"]) {
    const u = P.untilFor(id, now, {}, tsOf).until;
    assert.equal(P.untilChoiceOf(P.modeValue(true, now, u), {}, tsOf), id, `gedrückte Pille ${id}`);
  }
  assert.equal(P.readMode({ mode: { privat: "ja" } }).privat, false, "nur true zählt");
  assert.equal(P.readMode({}), null);
});

/* ---------- Privatfahrten: 0 h ---------- */

const BUERO = { lat: 47.0745, lng: 15.4010, addr: "Musterstraße 41, 8020 Musterstadt" };
const HOME = { lat: 47.1093, lng: 15.4118, addr: "Erfundene Straße 286, 8051 Musterstadt" };
const work = (d, h1, h2, pause = 30) => ({ id: `w${d}`, kind: "work", start: at(11, d, h1), end: at(11, d, h2), pauseMin: pause, place: "Büro", inLoc: BUERO,
  segments: [{ start: at(11, d, h1), end: at(11, d, h2), activity: "Arbeiten", place: "Büro", loc: BUERO }] });
const ptrip = (d, h, extra = {}) => ({ id: `pt${d}`, ...P.privateTripEntry({ start: at(11, d, h), end: at(11, d, h, 40), fromLoc: BUERO, toLoc: HOME }), ...extra });

test("Privatfahrt-Eintrag: Form, isPrivateTrip, netMin/creditMin = 0 (mit und ohne Pausen-Trick, auch ältere Nachträge)", () => {
  const e = ptrip(2, 18);
  assert.equal(e.tripOnly, true);
  assert.equal(e.privateTrip, true);
  assert.equal(e.pauseMin, 40);
  assert.equal(e.segments[0].private, true);
  assert.equal(e.segments[0].activity, "Autofahren");
  assert.equal(P.isPrivateTrip(e), true);
  assert.equal(util.netMin(e), 0);
  assert.equal(util.creditMin(e), 0);
  assert.equal(util.netMin({ ...e, pauseMin: 0 }), 0, "auch ohne pauseMin = Dauer");
  const legacy = { kind: "work", start: at(11, 3, 8), end: at(11, 3, 9), pauseMin: 0, tripOnly: true, segments: [{ start: at(11, 3, 8), activity: "Autofahren", private: true }] };
  assert.equal(P.isPrivateTrip(legacy), true, "nachgetragene Privatfahrt (alt)");
  assert.equal(util.netMin(legacy), 0);
  const biz = { ...legacy, segments: [{ start: at(11, 3, 8), activity: "Autofahren" }] };
  assert.equal(P.isPrivateTrip(biz), false, "berufliche Fahrt bleibt Arbeitszeit");
  assert.equal(util.netMin(biz), 60);
  assert.equal(util.netMin(work(2, 7, 15)), 450, "normale Arbeit unverändert");
});

function balanceHTML(entries, now, settings) {
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  };
  const el = { innerHTML: "", querySelector: () => null };
  try {
    overview.renderBalanceCard(el, { ready: true, entries, settings, running: null, todos: [] }, { util, timer });
  } finally { globalThis.Date = RealDate; }
  return el.innerHTML.replace(/\s+/g, " ");
}

test("Überstundenkonto unverändert durch Privatfahrten (views/overview.js)", { skip: !overview }, () => {
  const s = { weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5], balanceStart: "2026-11-02" };
  const base = [work(2, 7, 16), work(3, 7, 15)];
  const now = at(11, 5, 12);
  const a = balanceHTML(base, now, s);
  const b = balanceHTML([...base, ptrip(2, 18), ptrip(3, 19, { pauseMin: 0 }), ptrip(4, 20)], now, s);
  assert.ok(/rb-saldo/.test(a));
  assert.equal(b, a, "gleiches Überstundenkonto");
});

test("Stundenzettel ignoriert Privatfahrten", { skip: !timesheet }, () => {
  const snap = { settings: { weeklyTarget: 38.5 }, entries: [work(2, 7, 16), ptrip(2, 18), ptrip(7, 10)] };
  const m = timesheet.buildMonth(snap, new Date(2026, 10, 1));
  const m0 = timesheet.buildMonth({ ...snap, entries: [work(2, 7, 16)] }, new Date(2026, 10, 1));
  assert.equal(m.ist, m0.ist);
  assert.equal(m.workDays, m0.workDays);
  assert.deepEqual(m.rows.map((r) => r.net), m0.rows.map((r) => r.net));
});

test("Fahrtenbuch: Privatfahrt erscheint als privat, kein Kilometergeld; Taggeld/Tages-km ignorieren sie", () => {
  const s = { allowance: { ownCar: true, kmRate: 0.5, enabled: true, minHours: 0.1, fullHours: 11 } };
  const trips = T.tripsBetween([work(2, 7, 16), ptrip(2, 18)], at(11, 1), at(12, 1), s);
  assert.equal(trips.length, 1);
  assert.equal(trips[0].private, true);
  assert.equal(trips[0].purpose, "Privat");
  const tot = F.totals(trips, s);
  assert.ok(tot.privKm > 0 && tot.bizKm === 0 && tot.kmgeld === 0, "kein Kilometergeld");
  assert.equal(T.entryKm(ptrip(2, 18), s), 0, "zählt nicht in die Tages-km");
  const tg = T.allowanceByDay({ entries: [ptrip(7, 10)], places: [], days: {}, settings: s, dayKey: util.dayKey }, at(11, 1), at(12, 1));
  assert.equal(tg.size, 0, "kein Taggeld für Privatfahrt");
});

/* ---------- Erinnerungen ---------- */

test("decide.mjs: keine „Nicht eingestempelt“-/Plan-Erinnerung im Privat-Modus (selbst gewählt oder Zeitplan)", () => {
  const now = viennaToTs(2026, 11, 4, 7, 45); // Mi
  const base = { reminders: { enabled: true, start: { enabled: true, time: "07:30" } }, workDays: [1, 2, 3, 4, 5] };
  assert.equal(decide(now, base, null, [], {}).filter((x) => x.type === "start").length, 1, "ohne Privat: Erinnerung");
  const priv = { ...base, mode: P.modeValue(true, now - 60000, null) };
  assert.equal(decide(now, priv, null, [], {}).filter((x) => x.type === "start").length, 0, "Privat: keine Erinnerung");
  const expired = { ...base, mode: P.modeValue(true, now - 7200000, now - 3600000) };
  assert.equal(decide(now, expired, null, [], {}).filter((x) => x.type === "start").length, 1, "Privat abgelaufen → wieder Erinnerung");
  // Plan-Erinnerung
  const plan = { ...base, plans: [{ id: "p1", time: "07:30", days: [3], place: "Büro" }] };
  assert.equal(decide(now, plan, null, [], {}).filter((x) => x.type === "plan").length, 1);
  assert.equal(decide(now, { ...plan, mode: P.modeValue(true, now - 1000, null) }, null, [], {}).filter((x) => x.type === "plan").length, 0);
  // Zeitplan: früher Arbeitsbeginn-Erinnerung 05:30 liegt außerhalb 06:00–17:00 → privat
  const early = viennaToTs(2026, 11, 4, 5, 40);
  const sch = { ...base, reminders: { enabled: true, start: { enabled: true, time: "05:30" } }, modeSchedule: { enabled: true, from: "06:00", to: "17:00" } };
  assert.equal(decide(early, { ...sch, modeSchedule: { enabled: false } }, null, [], {}).filter((x) => x.type === "start").length, 1);
  assert.equal(decide(early, sch, null, [], {}).filter((x) => x.type === "start").length, 0);
  // eingestempelt: End-Erinnerung kommt weiterhin (Privat zählt dann nicht)
  const run = { start: now - 11 * 3600000, pauseMs: 0, pauseStart: null };
  assert.equal(decide(now, priv, run, [], {}).filter((x) => x.type === "end").length, 1);
  // Wiener Kalender
  assert.deepEqual(viennaCal(viennaToTs(2026, 12, 8, 10, 0), {}), { key: "2026-12-08", wd: 2, min: 600, holiday: true });
  assert.equal(isPrivatVienna(viennaToTs(2026, 11, 7, 10, 0), sch, null), true, "Samstag laut Zeitplan privat");
});

/* ---------- Galerie ---------- */

test("Galerie: im Privat-Modus aktive Kategorie „Privat“ (vor Ort-Vorgabe), sonst unverändert", () => {
  const folders = G.DEFAULT_FOLDERS.map((f) => ({ ...f }));
  const places = [{ id: "pl", name: "Baustelle", photoFolderId: G.BAU_ID }];
  const r = G.resolveActiveFolder({ folders, gallery: { activeFolderId: G.SCHULE_ID }, placeId: "pl", places, privat: true });
  assert.deepEqual([r.id, r.source], [G.PRIVAT_ID, "privat"]);
  const r2 = G.resolveActiveFolder({ folders, gallery: { activeFolderId: G.SCHULE_ID }, placeId: "pl", places });
  assert.deepEqual([r2.id, r2.source], [G.BAU_ID, "place"]);
  const own = [{ id: "x1", name: "privat", emoji: "🏡", color: "#16a34a" }];
  assert.equal(G.resolveActiveFolder({ folders: own, gallery: {}, privat: true }).id, "x1", "Kategorie namens „Privat“");
  assert.equal(G.resolveActiveFolder({ folders: [folders[0]], gallery: { activeFolderId: G.BAU_ID }, privat: true }).source, "manual", "ohne Privat-Kategorie: normal");
});
