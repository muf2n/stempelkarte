// node --test test/briefing-core.test.mjs – Update 10 F: Morgen-Briefing & Wochenrückblick (reine Logik) + Morgen-Push (decide.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../js/briefing-core.js";
import { expandTodo } from "../js/cal-core.js";
import { decideBriefing, briefingDue, viennaToTs } from "../tools/reminders/decide.mjs";
import * as N from "../js/notify-core.js";

const at = (y, m, d, h = 7, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const MON7 = at(2026, 11, 9, 7);   // Montag 09.11.2026, 07:00
const SUN18 = at(2026, 11, 8, 18); // Sonntag

test("Fenster: Morgen 5–11 Uhr einmal pro Tag, Wochenrückblick So ab 15 / Mo bis 12, Einstellungen", () => {
  assert.equal(B.shouldOfferMorning(MON7, null), true);
  assert.equal(B.shouldOfferMorning(MON7, "2026-11-09"), false, "heute schon gesehen");
  assert.equal(B.shouldOfferMorning(at(2026, 11, 9, 12), null), false);
  assert.equal(B.shouldOfferMorning(MON7, null, { offer: false }), false);
  assert.deepEqual(B.reviewWeek(SUN18), { from: "2026-11-02", to: "2026-11-08" }, "Sonntag → diese Woche");
  assert.deepEqual(B.reviewWeek(MON7), { from: "2026-11-02", to: "2026-11-08" }, "Montag → letzte Woche");
  assert.equal(B.shouldOfferWeekly(SUN18, null), true);
  assert.equal(B.shouldOfferWeekly(SUN18, "2026-11-02"), false);
  assert.equal(B.shouldOfferWeekly(at(2026, 11, 10, 9), null), false, "Dienstag nicht");
  assert.deepEqual(B.readBriefing({}), { offer: true, push: false, time: "06:30" }, "Push standardmäßig AUS");
  assert.deepEqual(B.readBriefing({ briefing: { offer: false, push: true, time: "5:45" } }), { offer: false, push: true, time: "05:45" });
  assert.equal(B.readBriefing({ briefing: { time: "25:00" } }).time, "06:30");
});

const TODOS = [
  { id: "t1", kind: "termin", title: "Baubesprechung", date: "2026-11-09", time: "09:30", location: "Büro" },
  { id: "t2", kind: "termin", title: "Zahnarzt", date: "2026-11-09", time: "15:30" },
  { id: "t3", kind: "termin", title: "Morgen", date: "2026-11-10", time: "08:00" },
  { id: "t4", kind: "termin", title: "Training", date: "2026-11-02", time: "18:00", rrule: "FREQ=WEEKLY" },
  { id: "a1", title: "Rechnung zahlen", date: "2026-11-05" },
  { id: "a2", title: "Zimmer aufräumen" },
  { id: "a3", title: "Später", date: "2026-11-20" },
  { id: "a4", title: "Erledigt", done: true, doneAt: at(2026, 11, 6, 12) },
  { id: "e1", kind: "einsatz", title: "Einsatz", date: "2026-11-09", dateTo: "2026-11-13", placeId: "p1", people: ["Max"] },
  { id: "g1", kind: "geburtstag", title: "Oma Test", bday: "11-09" },
];
const PLACES = [{ id: "p1", name: "Baustelle Musterstraße" }];

test("Hilfen: Termine (inkl. Wiederholung), offene Aufgaben, Einsatz", () => {
  const t = B.termineBetween(TODOS, "2026-11-09", "2026-11-09", expandTodo);
  assert.deepEqual(t.map((x) => [x.title, x.time]), [["Baubesprechung", "09:30"], ["Zahnarzt", "15:30"], ["Training", "18:00"]]);
  const o = B.openTasks(TODOS, "2026-11-09");
  assert.equal(o.open, 2);
  assert.equal(o.overdue, 1);
  assert.deepEqual(o.top, ["Rechnung zahlen", "Zimmer aufräumen"]);
  const s = B.einsatzSite(TODOS, "2026-11-10", PLACES);
  assert.equal(s.place, "Baustelle Musterstraße");
  assert.deepEqual(s.people, ["Max"]);
  assert.equal(B.einsatzSite(TODOS, "2026-11-14", PLACES), null);
});

test("Morgen-Briefing: Abschnitte aus echten Daten, Material, Schule, Geburtstag, Sprechtext", () => {
  const b = B.buildMorning({
    now: MON7, name: "Florian Test",
    weather: { emoji: "🌧️", text: "Regen", temp: 4.2, max: 6, min: 1, rainProb: 80, hints: [{ e: "💨", when: "Heute", t: "Sturmböen bis 70 km/h" }] },
    termine: B.termineBetween(TODOS, "2026-11-09", "2026-11-09", expandTodo),
    tasks: B.openTasks(TODOS, "2026-11-09"),
    site: B.einsatzSite(TODOS, "2026-11-09", PLACES),
    material: [{ name: "Schuko-Steckdose", qty: 4, unit: "Stk" }, { name: "NYM-J 3x1,5", qty: 25, unit: "m" }],
    school: { today: null, tomorrow: "Berufsschule", exams: [{ title: "Test Mathe", days: 1 }, { title: "Fern", days: 20 }], homework: 1 },
    birthdays: [{ name: "Oma Test", days: 0, age: null }],
    reminders: [{ e: "🎌", t: "Feiertag", when: "morgen" }],
  });
  assert.equal(b.title, "Guten Morgen, Florian ☀️");
  assert.equal(b.date, "Montag, 9. November");
  assert.deepEqual(b.sections.map((x) => x.id), ["weather", "site", "termine", "tasks", "school", "reminders"]);
  const site = b.sections.find((x) => x.id === "site");
  assert.match(site.lines[0].sub, /Einsatzplan · mit Max/);
  assert.match(site.lines[1].t, /Mitnehmen: 2 Materialien/);
  assert.match(site.lines[1].sub, /4 Stk Schuko-Steckdose, 25 m NYM-J 3x1,5/);
  assert.equal(b.sections.find((x) => x.id === "weather").lines[1].hot, true, "Warnung hervorgehoben");
  assert.equal(b.sections.find((x) => x.id === "school").lines.length, 3, "Prüfung in 20 Tagen nicht im Briefing");
  assert.deepEqual(b.counts, { termine: 3, tasks: 2, overdue: 1, birthdays: 1, material: 2 });
  assert.doesNotMatch(b.speech, /\p{Extended_Pictographic}/u, "Sprechtext ohne Emojis");
  assert.match(b.speech, /Termine heute: Baubesprechung, 09:30 · Büro/);
  const ai = B.summaryForAi(b);
  assert.match(ai, /^MORGEN-BRIEFING/);
  assert.match(ai, /## Heute auf der Baustelle\n- Baustelle Musterstraße/);
  assert.ok(ai.length <= 4000);
});

test("Morgen-Briefing leer: freundliche Leertexte, kein Wetter-/Baustellenabschnitt", () => {
  const b = B.buildMorning({ now: at(2026, 11, 9, 12, 30) });
  assert.equal(b.title, "Mahlzeit ☀️");
  assert.deepEqual(b.sections.map((x) => x.id), ["termine", "tasks"]);
  assert.match(b.sections[0].empty, /keine Termine/);
  assert.match(b.sections[1].empty, /Keine offenen Aufgaben/);
});

test("Push-Zeile: nur Zahlen + Baustelle", () => {
  assert.equal(B.pushLine({ termine: 3, tasks: 2, site: "Musterstraße" }), "☀️ 3 Termine, 2 Aufgaben – Baustelle Musterstraße");
  assert.equal(B.pushLine({ termine: 1, tasks: 0, site: "Baustelle Hauptstraße" }), "☀️ 1 Termin – Baustelle Hauptstraße");
  assert.equal(B.pushLine({ termine: 0, tasks: 1, birthdays: 1 }), "☀️ keine Termine, 1 Aufgabe, 1 🎂");
});

test("Wochenrückblick: Stunden, Überstunden, Erledigtes, Geld-Sperre, Lernen, nächste Woche", () => {
  const util = { creditOf: (e) => Math.max(0, (e.end - e.start) / 60000 - (e.pauseMin || 0)), targetOf: (k) => ([1, 2, 3, 4, 5].includes(new Date(k + "T12:00").getDay()) ? 462 : 0), dayOf: (t) => B.keyOf(new Date(t)) };
  const entries = [
    { start: at(2026, 11, 2, 7), end: at(2026, 11, 2, 16), pauseMin: 30 },
    { start: at(2026, 11, 3, 7), end: at(2026, 11, 3, 17), pauseMin: 30 },
    { start: at(2026, 11, 9, 7), end: at(2026, 11, 9, 8) }, // nächste Woche → zählt nicht
  ];
  const w = B.weekWork(entries, "2026-11-02", "2026-11-08", util);
  assert.deepEqual(w, { workedMin: 1080, targetMin: 2310, workDays: 2 });
  const lap = { days: { "2026-11-07": { n: 5 }, "2026-11-08": { n: 3 }, "2026-11-01": { n: 2 } } };
  const r = B.buildWeekly({
    from: "2026-11-02", to: "2026-11-08", ...w, balanceMin: 125,
    done: B.doneInWeek(TODOS, "2026-11-02", "2026-11-08", util.dayOf),
    money: { locked: true },
    lap: { streak: 3, days: B.practiceDays(lap, "2026-11-02", "2026-11-08") }, jp: null,
    exams: [{ title: "Test Mathe", days: 2 }],
    nextWeek: B.termineBetween(TODOS, "2026-11-09", "2026-11-15", expandTodo),
  });
  assert.equal(r.date, "KW 45 · Mo 02.11. – So 08.11.");
  const work = r.sections.find((x) => x.id === "work");
  assert.equal(work.lines[0].t, "18:00 h gearbeitet");
  assert.equal(work.lines[1].t, "Überstunden −20:30 h");
  assert.equal(work.lines[3].t, "Konto gesamt +2:05 h");
  assert.match(r.sections.find((x) => x.id === "done").lines[0].t, /1 Aufgabe erledigt/);
  assert.match(r.sections.find((x) => x.id === "money").lines[0].t, /gesperrt/, "keine Beträge bei Geld-Sperre");
  assert.match(r.sections.find((x) => x.id === "learn").lines[0].t, /LAP: 2 Lerntage/);
  assert.deepEqual(r.sections.find((x) => x.id === "next").lines.map((l) => l.t), ["Baubesprechung", "Zahnarzt", "Training", "Morgen"]);
  const m = B.buildWeekly({ from: "2026-11-02", to: "2026-11-08", money: B.moneyWeek([{ type: "out", amount: 12.5, date: "2026-11-03" }, { type: "in", amount: 100, date: "2026-11-04" }, { type: "out", amount: 9, date: "2026-11-09" }], "2026-11-02", "2026-11-08") });
  assert.deepEqual(m.sections.find((x) => x.id === "money").lines.map((l) => l.t), ["Ausgaben 12,50 €", "Einnahmen 100,00 €"]);
  assert.equal(B.hmText(0, true), "±0:00 h");
});

test("Benachrichtigungszentrale: Briefing nur mit briefingOffer, abschaltbar, eigene Kategorie", () => {
  const base = { now: MON7, settings: {}, todos: [] };
  assert.equal(N.collect(base).some((i) => i.kind === "briefing"), false, "ohne briefingOffer nichts (bestehende Tests)");
  const it = N.collect({ ...base, briefingOffer: true }).find((i) => i.kind === "briefing");
  assert.equal(it.target, "briefing:morning");
  assert.equal(N.collect({ ...base, now: SUN18, briefingOffer: true }).find((i) => i.kind === "briefing").target, "briefing:weekly");
  assert.equal(N.collect({ ...base, briefingOffer: true, settings: { notify: { off: ["briefing"] } } }).some((i) => i.kind === "briefing"), false);
  assert.equal(N.collect({ ...base, briefingOffer: true, settings: { briefing: { offer: false } } }).some((i) => i.kind === "briefing"), false);
});

test("Morgen-Push (decide.mjs): Standard aus, Zeitfenster, einmal pro Tag, nur Zahlen", () => {
  const now = viennaToTs(2026, 11, 9, 6, 45);
  const s = { briefing: { push: true, time: "06:30" } };
  assert.deepEqual(decideBriefing(now, {}, {}, TODOS, PLACES), [], "Standard aus");
  assert.equal(briefingDue(viennaToTs(2026, 11, 9, 6, 0), s, {}), false, "vor der Zeit");
  assert.equal(briefingDue(viennaToTs(2026, 11, 9, 9, 31), s, {}), false, "nach 3 Stunden");
  assert.equal(briefingDue(now, { ...s, reminders: { enabled: false } }, {}), false, "Erinnerungen aus");
  const out = decideBriefing(now, s, {}, TODOS, PLACES);
  assert.equal(out.length, 1);
  assert.equal(out[0].body, "☀️ 3 Termine, 2 Aufgaben, 1 🎂 – Baustelle Musterstraße");
  assert.deepEqual(out[0].log, [[["briefSent"], "2026-11-09"]]);
  assert.doesNotMatch(out[0].body, /Zahnarzt|Rechnung|Oma/, "keine Titel in der Push-Nachricht");
  assert.deepEqual(decideBriefing(now, s, { briefSent: "2026-11-09" }, TODOS, PLACES), [], "schon gesendet");
});
