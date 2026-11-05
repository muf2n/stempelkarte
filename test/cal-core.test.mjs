// node --test test/cal-core.test.mjs
// Update 9 – Kalender: Wiederholungen (RRULE-Teilmenge), Ausnahmen, Serien bearbeiten, ICS, Überlappung, Erinnerungen.
import test from "node:test";
import assert from "node:assert/strict";
import * as K from "../js/cal-core.js";

const ev = (o) => ({ id: "e1", kind: "termin", title: "Training", date: "2026-03-23", time: "18:00", endTime: "19:30", ...o });
const keys = (t, a, b) => K.expandTodo(t, a, b).map((i) => i.date);

test("Datumshelfer: KW, Wochentag, Monatslänge", () => {
  assert.equal(K.isoWeek("2026-11-05"), 45);
  assert.equal(K.isoWeek("2027-01-01"), 53);
  assert.equal(K.isoWeek("2026-01-01"), 1);
  assert.equal(K.wdOf("2026-11-05"), 4);
  assert.equal(K.mondayOf("2026-11-08"), "2026-11-02");
  assert.equal(K.daysInMonth(2028, 2), 29);
  assert.equal(K.addDays("2026-03-28", 2), "2026-03-30");
  assert.equal(K.diffDays("2026-03-28", "2026-03-30"), 2);
});

test("RRULE parsen/formatieren", () => {
  const r = K.parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270131T225959Z");
  assert.deepEqual([r.freq, r.interval, r.byday.map((b) => b.wd), r.until], ["WEEKLY", 2, [1, 3], "2027-01-31"]);
  assert.equal(K.formatRRule(r), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270131");
  assert.deepEqual(K.parseRRule("FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2").byday, [{ wd: 2, n: 2 }]);
  assert.equal(K.parseRRule("FREQ=HOURLY"), null);
  assert.equal(K.parseRRule(""), null);
});

test("Täglich über die Zeitumstellung (März + Oktober): Wanduhrzeit bleibt 18:00", () => {
  const t = ev({ rrule: "FREQ=DAILY;COUNT=10" });
  const list = K.expandTodo(t, "2026-03-20", "2026-04-10");
  assert.deepEqual(list.map((i) => i.date), ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01"]);
  assert.ok(list.every((i) => i.time === "18:00" && i.endTime === "19:30"));
  // echte Zeitpunkte: Winterzeit 17:00 UTC, Sommerzeit 16:00 UTC
  assert.equal(new Date(K.keyTimeToTs("2026-03-28", "18:00")).toISOString(), "2026-03-28T17:00:00.000Z");
  assert.equal(new Date(K.keyTimeToTs("2026-03-29", "18:00")).toISOString(), "2026-03-29T16:00:00.000Z");
  assert.equal(new Date(K.keyTimeToTs("2026-10-25", "02:30")).getUTCHours(), 0, "doppelte Stunde: erste (Sommerzeit)");
  const oct = K.expandTodo(ev({ date: "2026-10-20", rrule: "FREQ=DAILY" }), "2026-10-24", "2026-10-26");
  assert.deepEqual(oct.map((i) => [i.date, i.time]), [["2026-10-24", "18:00"], ["2026-10-25", "18:00"], ["2026-10-26", "18:00"]]);
  // 02:30 am 29.3. existiert nicht → wird nach vorn geschoben (03:30 Sommerzeit = 01:30 UTC)
  assert.equal(new Date(K.keyTimeToTs("2026-03-29", "02:30")).toISOString(), "2026-03-29T01:30:00.000Z");
});

test("Wöchentlich mit BYDAY, INTERVAL und Sprung direkt in den Bereich", () => {
  const t = ev({ date: "2026-01-05", rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH" });
  assert.deepEqual(keys(t, "2026-01-01", "2026-01-31"), ["2026-01-05", "2026-01-08", "2026-01-19", "2026-01-22"]);
  assert.deepEqual(keys(t, "2030-06-01", "2030-06-14"), K.occurrenceKeys("2026-01-05", t.rrule, "2026-01-05", "2030-06-14").filter((k) => k >= "2030-06-01"));
  // COUNT zählt ab Serienbeginn (Start an einem Donnerstag → Montag derselben Woche zählt nicht)
  const c = ev({ date: "2026-01-08", rrule: "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=4" });
  assert.deepEqual(keys(c, "2026-01-01", "2026-03-01"), ["2026-01-08", "2026-01-12", "2026-01-15", "2026-01-19"]);
  assert.deepEqual(keys(c, "2026-01-14", "2026-03-01"), ["2026-01-15", "2026-01-19"], "COUNT auch beim Sprung korrekt");
});

test("Monatlich: n-ter Wochentag (2. Dienstag, letzter Freitag)", () => {
  const t = ev({ date: "2026-01-13", rrule: "FREQ=MONTHLY;BYDAY=2TU" });
  assert.deepEqual(keys(t, "2026-01-01", "2026-06-30"), ["2026-01-13", "2026-02-10", "2026-03-10", "2026-04-14", "2026-05-12", "2026-06-09"]);
  const l = ev({ date: "2026-01-30", rrule: "FREQ=MONTHLY;BYDAY=-1FR;COUNT=4" });
  assert.deepEqual(keys(l, "2026-01-01", "2026-12-31"), ["2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"]);
  assert.equal(K.describeRule(t.rrule, t.date), "Monatlich am 2. Dienstag");
  const p = K.weekdayPos("2026-01-13");
  assert.deepEqual([p.n, p.last], [2, false]);
});

test("Monatlich am 31.: Monate ohne 31. werden übersprungen (wie Google)", () => {
  const t = ev({ date: "2026-01-31", rrule: "FREQ=MONTHLY" });
  assert.deepEqual(keys(t, "2026-01-01", "2026-12-31"), ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31", "2026-10-31", "2026-12-31"]);
  const c = ev({ date: "2026-01-31", rrule: "FREQ=MONTHLY;COUNT=3" });
  assert.deepEqual(keys(c, "2026-01-01", "2027-12-31"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
  const last = ev({ date: "2026-01-31", rrule: "FREQ=MONTHLY;BYMONTHDAY=-1" });
  assert.deepEqual(keys(last, "2026-01-01", "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("Jährlich (inkl. 29. Februar nur in Schaltjahren) und UNTIL", () => {
  const t = ev({ date: "2024-02-29", allDay: true, time: null, endTime: null, rrule: "FREQ=YEARLY" });
  assert.deepEqual(keys(t, "2024-01-01", "2032-12-31"), ["2024-02-29", "2028-02-29", "2032-02-29"]);
  const u = ev({ date: "2026-11-05", rrule: "FREQ=YEARLY;UNTIL=20281105" });
  assert.deepEqual(keys(u, "2026-01-01", "2035-12-31"), ["2026-11-05", "2027-11-05", "2028-11-05"]);
});

test("EXDATE und verschobene Einzeltermine (overrides)", () => {
  const t = ev({ date: "2026-11-02", rrule: "FREQ=DAILY;COUNT=5", exdates: ["2026-11-03"],
    overrides: { "2026-11-04": { date: "2026-11-10", time: "08:00", endTime: "09:00", title: "Training verschoben" } } });
  const list = K.expandTodo(t, "2026-11-01", "2026-11-30");
  assert.deepEqual(list.map((i) => [i.date, i.time, i.key]), [
    ["2026-11-02", "18:00", "2026-11-02"], ["2026-11-05", "18:00", "2026-11-05"], ["2026-11-06", "18:00", "2026-11-06"], ["2026-11-10", "08:00", "2026-11-04"]]);
  assert.equal(list[3].title, "Training verschoben");
  assert.ok(list[3].overridden);
  // verschobener Termin taucht im Zielbereich auf, auch wenn der ursprüngliche Tag außerhalb liegt
  assert.deepEqual(keys(t, "2026-11-09", "2026-11-11"), ["2026-11-10"]);
});

test("Mehrtägig und ganztägig: Instanz berührt Bereich", () => {
  const t = ev({ date: "2026-11-05", time: "20:00", endDate: "2026-11-07", endTime: "10:00" });
  const [i] = K.expandTodo(t, "2026-11-06", "2026-11-06");
  assert.equal(i.durMin, 2 * 1440 + 600 - 1200);
  assert.deepEqual([i.endDate, i.endTime], ["2026-11-07", "10:00"]);
  const a = ev({ date: "2026-12-30", allDay: true, time: null, endTime: null, endDate: "2027-01-02", rrule: "FREQ=YEARLY" });
  assert.deepEqual(keys(a, "2027-01-01", "2027-01-01"), ["2026-12-30"]);
  // alter Termin ohne endTime: 1 Std., ohne Uhrzeit: ganztägig
  assert.equal(K.expandTodo({ id: "x", kind: "termin", date: "2026-11-05", time: "14:30" }, "2026-11-05", "2026-11-05")[0].endTime, "15:30");
  assert.equal(K.expandTodo({ id: "x", kind: "termin", date: "2026-11-05", time: null }, "2026-11-05", "2026-11-05")[0].allDay, true);
});

test("Serie bearbeiten: nur diesen / diesen und alle folgenden / alle", () => {
  const t = ev({ date: "2026-11-02", rrule: "FREQ=WEEKLY;BYDAY=MO;COUNT=6", reminders: [10] });
  // nur diesen
  let r = K.applyEdit(t, "2026-11-16", { time: "17:00", endTime: "18:00" }, "one");
  assert.equal(r.save.length, 1);
  assert.deepEqual(K.expandTodo(r.save[0], "2026-11-16", "2026-11-16").map((i) => i.time), ["17:00"]);
  assert.deepEqual(K.expandTodo(r.save[0], "2026-11-09", "2026-11-09").map((i) => i.time), ["18:00"]);
  // diesen und alle folgenden: COUNT wird aufgeteilt (2 + 4)
  r = K.applyEdit(t, "2026-11-16", { title: "Training neu", time: "19:00", endTime: "20:00" }, "following");
  assert.equal(r.save.length, 1);
  assert.equal(r.create.length, 1);
  assert.equal(r.save[0].rrule, "FREQ=WEEKLY;BYDAY=MO;COUNT=2");
  assert.equal(r.create[0].rrule, "FREQ=WEEKLY;BYDAY=MO;COUNT=4");
  assert.equal(r.create[0].date, "2026-11-16");
  assert.ok(!r.create[0].id);
  assert.deepEqual(keys(r.save[0], "2026-01-01", "2027-12-31"), ["2026-11-02", "2026-11-09"]);
  assert.deepEqual(K.expandTodo(r.create[0], "2026-01-01", "2027-12-31").map((i) => `${i.date} ${i.time} ${i.title}`),
    ["2026-11-16 19:00 Training neu", "2026-11-23 19:00 Training neu", "2026-11-30 19:00 Training neu", "2026-12-07 19:00 Training neu"]);
  // ohne COUNT: UNTIL = Vortag
  const u = K.applyEdit({ ...t, rrule: "FREQ=WEEKLY;BYDAY=MO" }, "2026-11-16", { title: "X" }, "following");
  assert.equal(u.save[0].rrule, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261115");
  // „folgende“ ab dem ersten Termin = alle
  r = K.applyEdit(t, "2026-11-02", { title: "Alle" }, "following");
  assert.deepEqual([r.save.length, r.create.length, r.save[0].title], [1, 0, "Alle"]);
  // alle: Verschieben einer Instanz um +1 Tag verschiebt den Serienanfang (Wochentag passt mit)
  r = K.applyEdit(t, "2026-11-16", { date: "2026-11-17", endDate: "2026-11-17", time: "18:00" }, "all");
  assert.equal(r.save[0].date, "2026-11-03");
  assert.equal(r.save[0].rrule, "FREQ=WEEKLY;BYDAY=TU;COUNT=6");
  assert.deepEqual(keys(r.save[0], "2026-11-01", "2026-11-20"), ["2026-11-03", "2026-11-10", "2026-11-17"]);
});

test("Serie löschen: nur diesen (EXDATE) / folgende / alle", () => {
  const t = ev({ date: "2026-11-02", rrule: "FREQ=DAILY;UNTIL=20261106" });
  let r = K.applyDelete(t, "2026-11-04", "one");
  assert.deepEqual(keys(r.save[0], "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"]);
  r = K.applyDelete(t, "2026-11-04", "following");
  assert.deepEqual(keys(r.save[0], "2026-11-01", "2026-11-30"), ["2026-11-02", "2026-11-03"]);
  r = K.applyDelete(t, "2026-11-02", "following");
  assert.deepEqual(r.remove, ["e1"]);
  r = K.applyDelete(t, "2026-11-04", "all");
  assert.deepEqual(r.remove, ["e1"]);
  // letzter verbleibender Termin gelöscht → ganze Serie weg
  const one = ev({ date: "2026-11-02", rrule: "FREQ=DAILY;COUNT=1" });
  assert.deepEqual(K.applyDelete(one, "2026-11-02", "one").remove, ["e1"]);
});

test("Überlappung: Spalten und Ausdehnung nach rechts", () => {
  const a = { start: 540, end: 720 }, b = { start: 540, end: 600 }, c = { start: 540, end: 600 }, d = { start: 630, end: 660 }, e = { start: 800, end: 860 };
  K.layoutDay([a, b, c, d, e]);
  assert.deepEqual([a.col, b.col, c.col, d.col].sort(), [0, 1, 1, 2]);
  assert.equal(a.cols, 3);
  assert.equal(a.col, 0);
  assert.equal(d.col, 1);
  assert.equal(d.span, 2, "D darf sich in die freie dritte Spalte ausdehnen");
  assert.equal(b.span, 1);
  assert.deepEqual([e.col, e.cols, e.span], [0, 1, 1]);
  const bars = [{ c0: 0, c1: 2 }, { c0: 1, c1: 1 }, { c0: 3, c1: 6 }, { c0: 2, c1: 4 }];
  assert.equal(K.layoutBars(bars), 2);
  assert.deepEqual(bars.map((x) => x.lane), [0, 1, 0, 1]);
});

const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN",
  "BEGIN:VTIMEZONE", "TZID:Europe/Vienna", "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:abc-1@test", "DTSTART;TZID=Europe/Vienna:20261110T143000", "DTEND;TZID=Europe/Vienna:20261110T153000",
  "SUMMARY:Zahnarzt\\, Kontrolle", "LOCATION:Hauptplatz 1\\, 4020 Linz", "DESCRIPTION:Zeile 1\\nZeile 2 mit einem sehr langen Text der über die 75 Zeichen hin",
  " ausgeht und gefaltet ist", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "END:VALARM", "BEGIN:VALARM", "TRIGGER;RELATED=START:-P1D", "END:VALARM", "END:VEVENT",
  "BEGIN:VEVENT", "UID:abc-2@test", "DTSTART:20261201T080000Z", "DTEND:20261201T090000Z", "SUMMARY:UTC-Termin", "END:VEVENT",
  "BEGIN:VEVENT", "UID:abc-3@test", "DTSTART:20260701T080000Z", "DURATION:PT90M", "SUMMARY:Sommer UTC", "END:VEVENT",
  "BEGIN:VEVENT", "UID:abc-4@test", "DTSTART;VALUE=DATE:20261224", "DTEND;VALUE=DATE:20261227", "SUMMARY:Weihnachten", "END:VEVENT",
  "BEGIN:VEVENT", "UID:abc-5@test", "DTSTART:20261105T190000", "DTEND:20261105T200000", "SUMMARY:Floating", "END:VEVENT",
  "BEGIN:VEVENT", "UID:ser@test", "DTSTART;TZID=Europe/Vienna:20261102T180000", "DTEND;TZID=Europe/Vienna:20261102T193000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130T225959Z", "EXDATE;TZID=Europe/Vienna:20261109T180000", "SUMMARY:Training", "END:VEVENT",
  "BEGIN:VEVENT", "UID:ser@test", "RECURRENCE-ID;TZID=Europe/Vienna:20261116T180000", "DTSTART;TZID=Europe/Vienna:20261117T170000",
  "DTEND;TZID=Europe/Vienna:20261117T180000", "SUMMARY:Training (Di)", "END:VEVENT",
  "BEGIN:VEVENT", "UID:ny@test", "DTSTART;TZID=America/New_York:20261110T090000", "DTEND;TZID=America/New_York:20261110T100000", "SUMMARY:New York", "END:VEVENT",
  "END:VCALENDAR", "",
].join("\r\n");

test("ICS lesen: TZID Wien, UTC, floating, DATE, DURATION, RRULE, EXDATE, RECURRENCE-ID, VALARM", () => {
  const { events } = K.parseICS(ICS);
  const by = (u) => events.find((e) => e.uid === u);
  const z = by("abc-1@test");
  assert.deepEqual([z.title, z.date, z.time, z.endTime, z.location], ["Zahnarzt, Kontrolle", "2026-11-10", "14:30", "15:30", "Hauptplatz 1, 4020 Linz"]);
  assert.match(z.note, /^Zeile 1\nZeile 2 .*hinausgeht und gefaltet ist$/);
  assert.deepEqual(z.reminders, [15, 1440]);
  assert.deepEqual([by("abc-2@test").date, by("abc-2@test").time], ["2026-12-01", "09:00"], "UTC → Winterzeit +1");
  assert.deepEqual([by("abc-3@test").time, by("abc-3@test").endTime], ["10:00", "11:30"], "UTC → Sommerzeit +2, DURATION");
  const x = by("abc-4@test");
  assert.deepEqual([x.allDay, x.date, x.endDate], [true, "2026-12-24", "2026-12-26"], "DTEND bei DATE exklusiv");
  assert.equal(by("abc-5@test").time, "19:00");
  assert.equal(by("ny@test").time, "15:00", "New York 09:00 → Wien 15:00");
  const s = by("ser@test");
  assert.equal(s.rrule, "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130");
  assert.deepEqual(s.exdates, ["2026-11-09"]);
  assert.equal(s.overrides["2026-11-16"].date, "2026-11-17");
  const t = { id: "i1", ...K.todoFromIcs(s, "privat") };
  assert.deepEqual(K.expandTodo(t, "2026-11-01", "2026-12-31").map((i) => `${i.date} ${i.time}`),
    ["2026-11-02 18:00", "2026-11-17 17:00", "2026-11-23 18:00", "2026-11-30 18:00"]);
});

test("ICS schreiben und wieder lesen (Round-Trip)", () => {
  const todos = [
    { id: "a", kind: "termin", title: "Zahnarzt; Kontrolle, jährlich", date: "2026-11-10", time: "14:30", endTime: "15:15", location: "Linz, Hauptplatz", note: "Mitbringen:\nE-Card", reminders: [10, 60], remind: true, remindMin: 10 },
    { id: "b", kind: "termin", title: "Urlaub", date: "2026-12-24", allDay: true, endDate: "2026-12-31", reminders: [] },
    { id: "c", kind: "termin", title: "Berufsschule Blockwoche Elektrotechnik mit einem wirklich sehr langen Titel über 75 Zeichen ÄÖÜ", date: "2026-11-02", time: "07:45", endTime: "13:00",
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261201", exdates: ["2026-11-10"], overrides: { "2026-11-16": { date: "2026-11-16", time: "09:00", endTime: "12:00", title: "Später" } } },
    { id: "d", kind: "geburtstag", title: "Oma", bday: "03-14", byear: 1950 },
    { id: "e", kind: "todo", title: "keine Aufgabe exportieren", date: "2026-11-10" },
  ];
  const txt = K.toICS(todos, { now: Date.UTC(2026, 10, 5) });
  assert.ok(txt.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "Zeilen gefaltet");
  assert.match(txt, /BEGIN:VTIMEZONE/);
  assert.match(txt, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261201T225959Z/);
  const { events } = K.parseICS(txt);
  assert.equal(events.length, 4);
  const a = events.find((e) => e.uid === "a@stempelkarte");
  assert.deepEqual([a.title, a.date, a.time, a.endTime, a.location, a.note, a.reminders], ["Zahnarzt; Kontrolle, jährlich", "2026-11-10", "14:30", "15:15", "Linz, Hauptplatz", "Mitbringen:\nE-Card", [10, 60]]);
  const b = events.find((e) => e.uid === "b@stempelkarte");
  assert.deepEqual([b.allDay, b.date, b.endDate], [true, "2026-12-24", "2026-12-31"]);
  const c = events.find((e) => e.uid === "c@stempelkarte");
  assert.equal(c.title, todos[2].title);
  assert.equal(c.rrule, "FREQ=WEEKLY;BYDAY=MO,TU;UNTIL=20261201");
  assert.deepEqual(c.exdates, ["2026-11-10"]);
  assert.equal(c.overrides["2026-11-16"].time, "09:00");
  const orig = K.expandTodo(todos[2], "2026-10-01", "2027-01-31").map((i) => `${i.date} ${i.time} ${i.title}`);
  const back = K.expandTodo({ id: "c", ...K.todoFromIcs(c) }, "2026-10-01", "2027-01-31").map((i) => `${i.date} ${i.time} ${i.title}`);
  assert.deepEqual(back, orig);
  const o = events.find((e) => e.title === "🎂 Oma");
  assert.equal(o.rrule, "FREQ=YEARLY");
});

test("Erinnerungen: alte Form unverändert, mehrere Vorläufe, Wiederholung pro Instanz", () => {
  const legacy = { id: "x", kind: "termin", title: "Zahnarzt", date: "2026-11-06", time: "14:30", remind: true, remindMin: 30 };
  const at = K.keyTimeToTs("2026-11-06", "14:30");
  let d = K.dueReminders(at - 20 * 60000, [legacy], {});
  assert.deepEqual(d.map((x) => x.log), [[["x", "2026-11-06 14:30"]]]);
  assert.equal(K.dueReminders(at - 20 * 60000, [legacy], { x: "2026-11-06 14:30" }).length, 0);
  assert.equal(K.dueReminders(at - 40 * 60000, [legacy], {}).length, 0);

  const multi = { id: "m", kind: "termin", title: "LAP", date: "2026-11-10", time: "08:00", reminders: [10, 1440], remind: true, remindMin: 10 };
  const at2 = K.keyTimeToTs("2026-11-10", "08:00");
  d = K.dueReminders(at2 - 1440 * 60000 + 60000, [multi], {});
  assert.deepEqual(d.map((x) => [x.off, x.log]), [[1440, [["m~2026-11-10~1440", "2026-11-10 08:00"]]]]);
  assert.equal(K.dueReminders(at2 - 1440 * 60000 + 60000, [multi], { "m~2026-11-10~1440": "2026-11-10 08:00" }).length, 0, "Dedupe pro Vorlauf");
  d = K.dueReminders(at2 - 5 * 60000, [multi], { "m~2026-11-10~1440": "2026-11-10 08:00" });
  assert.deepEqual(d.map((x) => x.off), [10]);
  assert.equal(K.reminderText(d[0], at2 - 5 * 60000).body, "Morgen um 08:00".replace("Morgen ", ""), "am selben Tag nur „um 08:00“");

  const rec = { id: "r", kind: "termin", title: "Training", date: "2026-03-02", time: "18:00", rrule: "FREQ=WEEKLY;BYDAY=MO", reminders: [60], remind: true, remindMin: 60, location: "Sportplatz" };
  const at3 = K.keyTimeToTs("2026-03-30", "18:00"); // nach der Zeitumstellung
  d = K.dueReminders(at3 - 59 * 60000, [rec], {});
  assert.deepEqual(d.map((x) => x.log[0][0]), ["r~2026-03-30~60"]);
  assert.equal(new Date(at3).toISOString(), "2026-03-30T16:00:00.000Z");
  assert.equal(K.dueReminders(at3 - 61 * 60000, [rec], {}).length, 0);
  assert.deepEqual(K.reminderText(d[0], at3 - 59 * 60000), { title: "Termin: Training", body: "um 18:00 · Sportplatz" });
  // Ausnahme (EXDATE) → keine Erinnerung
  assert.equal(K.dueReminders(at3 - 59 * 60000, [{ ...rec, exdates: ["2026-03-30"] }], {}).length, 0);
  // ganztägig: Bezug 09:00, 1 Tag vorher
  const ad = { id: "g", kind: "termin", title: "Urlaub", date: "2026-11-20", allDay: true, reminders: [1440], remind: true };
  d = K.dueReminders(K.keyTimeToTs("2026-11-19", "09:05"), [ad], {});
  assert.equal(d.length, 1);
  assert.equal(K.reminderText(d[0], K.keyTimeToTs("2026-11-19", "09:05")).body, "Morgen (ganztägig)");
  // alter Termin ohne Uhrzeit: wie bisher keine Erinnerung
  assert.equal(K.dueReminders(K.keyTimeToTs("2026-11-20", "09:05"), [{ id: "o", kind: "termin", date: "2026-11-20", time: null, remind: true, remindMin: 0 }], {}).length, 0);
});

test("Suche: Titel/Ort/Notiz inkl. Wiederholungen im ±1-Jahres-Fenster", () => {
  const todos = [
    ev({ id: "s1", title: "Fußballtraining", location: "Sportplatz Wels", date: "2026-01-05", rrule: "FREQ=WEEKLY;BYDAY=MO" }),
    ev({ id: "s2", title: "Zahnarzt", note: "E-Card mitnehmen", date: "2026-11-10" }),
    { id: "s3", kind: "todo", title: "Fussball kaufen", date: null },
    ev({ id: "s4", title: "Alt", location: "Sportplatz", date: "2020-01-01" }),
  ];
  const r = K.searchEvents(todos, "sportplatz", "2026-11-05");
  assert.ok(r.length >= 94 && r.length <= 97, "wöchentliche Instanzen im Fenster (Jän. 2026 – Nov. 2027): " + r.length);
  assert.equal(r[0].date, "2026-11-09", "nächster kommender Termin zuerst");
  assert.ok(!r.some((x) => x.id === "s4"), "außerhalb ±1 Jahr");
  assert.equal(K.searchEvents(todos, "e-card", "2026-11-05")[0].id, "s2");
  assert.ok(K.searchEvents(todos, "fussball", "2026-11-05").some((x) => x.id === "s3"), "ß/ss gleich");
});

test("Leistung: 1000 Termine, Monat aufklappen < 150 ms", () => {
  const todos = [];
  for (let i = 0; i < 1000; i++) {
    todos.push(ev({ id: "p" + i, date: K.addDays("2020-01-01", i * 3), rrule: ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "FREQ=MONTHLY;BYDAY=2TU", null][i % 4] }));
  }
  const t0 = performance.now();
  const list = K.expandAll(todos, "2026-11-01", "2026-12-06");
  const ms = performance.now() - t0;
  assert.ok(list.length > 1000);
  assert.ok(ms < 150, `${ms.toFixed(1)} ms`);
});

test("Vorschläge „Wiederholen“ und Kalenderliste", () => {
  const p = K.repeatPresets("2026-11-10");
  assert.deepEqual(p.map((x) => x[1]).slice(0, 7), ["Nie", "Täglich", "Wöchentlich am Dienstag", "Alle 2 Wochen am Dienstag", "Jeden Werktag (Mo–Fr)", "Monatlich am 10.", "Monatlich am 2. Dienstag"]);
  assert.equal(K.presetOf("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=5", "2026-11-10"), "biweekly");
  assert.equal(K.presetOf("FREQ=DAILY;INTERVAL=3", "2026-11-10"), "custom");
  assert.equal(K.describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231", "2026-11-10"), "Wöchentlich am Mo–Fr, bis 31.12.2026");
  const cals = K.normCalendars([{ id: "privat", color: "salbei" }, { id: "c1", name: "Fußball", color: "#123456" }, { id: "g:x", name: "Google", visible: false }, { id: "c2", deleted: true }]);
  assert.equal(cals.find((c) => c.id === "privat").color, "salbei");
  assert.ok(cals.find((c) => c.id === "feiertage").readOnly);
  assert.equal(cals.find((c) => c.id === "c1").kind, "user");
  assert.equal(cals.find((c) => c.id === "g:x").visible, false);
  assert.ok(!cals.some((c) => c.id === "c2"));
  assert.equal(K.calOf({ calendarId: "c1" }, cals), "c1");
  assert.equal(K.calOf({ calendarId: "weg" }, cals), "privat");
  const f = K.finalizeEvent({ kind: "termin", date: "2026-11-10", time: "10:00", reminders: [60, 10, 10], rrule: "" });
  assert.deepEqual([f.reminders, f.remind, f.remindMin, f.rrule], [[10, 60], true, 10, null]);
});
