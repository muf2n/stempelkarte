import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, sameLesson, clashes } from "../js/alltag/school-photo-core.js";

test("Stundenplan vom Foto: Antwort prüfen", () => {
  const r = parsePlan('Hier:\n```json\n{"lessons":[{"weekday":2,"period":3,"periods":2,"subject":"AET","room":"E 204","teacher":"Hr. Huber"},{"weekday":1,"period":1,"subject":"Deutsch","from":"7:45","to":"08:35"},{"weekday":9,"period":1,"subject":"X"},{"weekday":1,"period":2,"subject":""},{"weekday":1,"period":12,"periods":4,"subject":"Spät","week":"C"}],"note":"Raum Mi unklar"}\n```');
  assert.equal(r.lessons.length, 3);
  assert.deepEqual(r.lessons[0], { weekday: 1, period: 1, periods: 1, from: "07:45", to: "08:35", subject: "Deutsch", room: "", teacher: "", week: "" });
  assert.equal(r.lessons[1].periods, 1); assert.equal(r.lessons[1].to, "19:00"); // auf Stunde 12 begrenzt
  assert.equal(r.lessons[2].from, "09:55"); assert.equal(r.lessons[2].to, "11:35");
  assert.equal(r.note, "Raum Mi unklar");
  assert.equal(parsePlan("Kein JSON").lessons.length, 0);
  assert.ok(sameLesson({ weekday: 1, period: 1, subject: "deutsch" }, r.lessons[0]));
  assert.ok(clashes({ weekday: 2, period: 4, periods: 1 }, r.lessons[2]) && !clashes({ weekday: 2, period: 5 }, r.lessons[2]));
});

test("WebUntis-Kalender → Stunden (doppelte Wochen zusammengefasst, Entfall weg)", async () => {
  const { lessonsFromEvents, periodOf } = await import("../js/alltag/school-photo-core.js");
  const ev = (date, time, endTime, title, location = "", note = "") => ({ date, time, endTime, title, location, note });
  const L = lessonsFromEvents([
    ev("2026-11-16", "08:00", "09:40", "AET", "E 204", "Lehrer: HUB"), ev("2026-11-23", "08:00", "09:40", "AET", "E 204"),
    ev("2026-11-17", "09:55", "10:45", "Deutsch"), ev("2026-11-17", "11:45", "12:35", "Englisch (entfällt)"),
    { date: "2026-11-18", allDay: true, title: "Wandertag" }, ev("2026-11-22", "10:00", "11:00", "Sonntag?"),
  ]);
  assert.equal(L.length, 2);
  assert.deepEqual(L[0], { weekday: 1, period: 1, periods: 2, from: "08:00", to: "09:40", subject: "AET", room: "E 204", teacher: "HUB", week: "" });
  assert.equal(L[1].period, 3);
  assert.equal(periodOf("07:45"), 1); assert.equal(periodOf("13:45"), 7);
});

test("WebUntis-Kürzel: Vorsilbe PG_/FG_/UÜ_ wird entfernt", async () => {
  const { parsePlan } = await import("../js/alltag/school-photo-core.js");
  const r = parsePlan(JSON.stringify({ lessons: [{ weekday: 3, period: 1, subject: "PG_DUK", from: "07:45", to: "08:30", teacher: "UKH", room: "LS6" }, { weekday: 2, period: 7, subject: "UÜ_BSP" }] }));
  assert.deepEqual(r.lessons.map((l) => l.subject), ["BSP", "DUK"]);
  assert.equal(r.lessons[1].from, "07:45");
});
