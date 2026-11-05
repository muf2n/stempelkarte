// node --test test/ical-feed.test.mjs
// Update 9 – iCal-Abo (Google „Privatadresse im iCal-Format“): Parser mit Google-typischem ICS, Aufklappen, Adressen.
import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../js/cal-feed-core.js";
import { parseICS } from "../js/cal-core.js";

const CAL = "lippa.florian@gmail.com";
const URL_G = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CAL)}/private-0123456789abcdef0123456789abcdef/basic.ics`;

// So sieht ein Google-Export aus: CRLF, VTIMEZONE, gefaltete Zeilen (75 Oktette), \, \; \n, DATE-Termine, RECURRENCE-ID.
const ICS = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Florian",
  "X-WR-TIMEZONE:Europe/Vienna",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Vienna",
  "X-LIC-LOCATION:Europe/Vienna",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
  // Wöchentliches Training Di 18:30–20:00, ohne 10.11., 17.11. auf 19:00 verschoben, 24.11. abgesagt (CANCELLED)
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Vienna:20261020T183000",
  "DTEND;TZID=Europe/Vienna:20261020T200000",
  "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261222T225959Z;BYDAY=TU",
  "EXDATE;TZID=Europe/Vienna:20261110T183000",
  "DTSTAMP:20261105T090000Z",
  "UID:5k3abc9training01@google.com",
  "CREATED:20261001T100000Z",
  "DESCRIPTION:Hallenschuhe mitnehmen\\, Trinkflasche\\nTreffpunkt: Eingang Süd",
  "LAST-MODIFIED:20261001T100000Z",
  "LOCATION:Sporthalle Wiener Neustadt\\, Neunkirchner Str. 1",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Fußballtraining",
  "TRANSP:OPAQUE",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Vienna:20261117T190000",
  "DTEND;TZID=Europe/Vienna:20261117T203000",
  "DTSTAMP:20261105T090000Z",
  "UID:5k3abc9training01@google.com",
  "RECURRENCE-ID;TZID=Europe/Vienna:20261117T183000",
  "SUMMARY:Fußballtraining (später)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Vienna:20261124T183000",
  "DTEND;TZID=Europe/Vienna:20261124T200000",
  "UID:5k3abc9training01@google.com",
  "RECURRENCE-ID;TZID=Europe/Vienna:20261124T183000",
  "STATUS:CANCELLED",
  "SUMMARY:Fußballtraining",
  "END:VEVENT",
  // Ganztägig über mehrere Tage (DTEND exklusiv)
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261123",
  "DTEND;VALUE=DATE:20261126",
  "DTSTAMP:20261105T090000Z",
  "UID:7urlaub2026x@google.com",
  "SUMMARY:Skikurs Schladming",
  "END:VEVENT",
  // UTC-Zeit, lange gefaltete Beschreibung (mit Umlauten über die Faltgrenze), escaped Komma/Strichpunkt
  "BEGIN:VEVENT",
  "DTSTART:20261112T130000Z",
  "DTEND:20261112T140000Z",
  "UID:9zahnarzt77@google.com",
  "SUMMARY:Zahnarzt Dr. Huber\\, Kontrolle\\; danach Apotheke",
  "DESCRIPTION:Bitte e-card mitnehmen. Termin wurde telefonisch vereinbart – fa",
  " lls verhindert\\, mindestens 24 Stunden vorher absagen. Grüße aus der Ordi",
  " nation",
  "LOCATION:Hauptplatz 3\\, 2700 Wiener Neustadt",
  "END:VEVENT",
  // Sehr alter Einzeltermin → beim Zwischenspeichern weggelassen
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20150101",
  "DTEND;VALUE=DATE:20150102",
  "UID:alt2015@google.com",
  "SUMMARY:Uralt",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const NOW = Date.UTC(2026, 10, 5, 9, 0);
const FEED = { id: "f1", name: "Florian", color: "pfau", gcal: CAL, holiday: false };

test("Google-ICS: VTIMEZONE wird ignoriert, Ereignisse korrekt gelesen", () => {
  const { events } = parseICS(ICS);
  assert.equal(events.length, 4, "Master + Ganztag + Zahnarzt + Uralt; RECURRENCE-ID wandert in die Serie");
  const tr = events.find((e) => e.uid === "5k3abc9training01@google.com");
  assert.equal(tr.date, "2026-10-20");
  assert.equal(tr.time, "18:30");
  assert.equal(tr.endTime, "20:00");
  assert.match(tr.rrule, /FREQ=WEEKLY/);
  assert.match(tr.rrule, /UNTIL=20261222/);
  assert.deepEqual(tr.exdates, ["2026-11-10", "2026-11-24"]);
  assert.equal(tr.overrides["2026-11-17"].time, "19:00");
  assert.equal(tr.location, "Sporthalle Wiener Neustadt, Neunkirchner Str. 1");
  assert.equal(tr.note, "Hallenschuhe mitnehmen, Trinkflasche\nTreffpunkt: Eingang Süd");
});

test("Gefaltete Zeilen und escaped Zeichen", () => {
  const z = parseICS(ICS).events.find((e) => e.uid === "9zahnarzt77@google.com");
  assert.equal(z.title, "Zahnarzt Dr. Huber, Kontrolle; danach Apotheke");
  assert.equal(z.note, "Bitte e-card mitnehmen. Termin wurde telefonisch vereinbart – falls verhindert, mindestens 24 Stunden vorher absagen. Grüße aus der Ordination");
  assert.equal(z.location, "Hauptplatz 3, 2700 Wiener Neustadt");
  // 13:00Z im November = 14:00 Wien
  assert.equal(z.time, "14:00");
  assert.equal(z.endTime, "15:00");
});

test("Ganztägig über mehrere Tage: DTEND exklusiv", () => {
  const s = parseICS(ICS).events.find((e) => e.uid === "7urlaub2026x@google.com");
  assert.equal(s.allDay, true);
  assert.equal(s.date, "2026-11-23");
  assert.equal(s.endDate, "2026-11-25");
  const inst = F.expandFeed(F.parseFeed(ICS, { now: NOW }), FEED, "2026-11-24", "2026-11-24").filter((i) => i.allDay);
  assert.equal(inst.length, 1, "auch mitten im Zeitraum sichtbar");
  assert.equal(inst[0].lastDay, "2026-11-25");
});

test("parseFeed lässt sehr alte Einzeltermine weg, behält Serien", () => {
  const evs = F.parseFeed(ICS, { now: NOW });
  assert.equal(evs.length, 3);
  assert.ok(!evs.some((e) => e.title === "Uralt"));
  assert.ok(evs.some((e) => e.rrule));
});

test("expandFeed: Serie wöchentlich mit EXDATE, verschobener und abgesagter Termin, UNTIL", () => {
  const evs = F.parseFeed(ICS, { now: NOW });
  const inst = F.expandFeed(evs, FEED, "2026-11-01", "2026-12-31").filter((i) => i.title.startsWith("Fußball"));
  assert.deepEqual(inst.map((i) => i.date).sort(), ["2026-11-03", "2026-11-17", "2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22"]);
  const moved = inst.find((i) => i.date === "2026-11-17");
  assert.equal(moved.time, "19:00");
  assert.equal(moved.title, "Fußballtraining (später)");
  for (const i of inst) {
    assert.equal(i.ext, true);
    assert.equal(i.calendarId, "f:f1");
    assert.equal(i.color, "pfau");
    assert.match(i.uid, /^f:f1\|/);
  }
  assert.equal(new Set(inst.map((i) => i.uid)).size, inst.length, "eindeutige uids");
  // vor dem Start nichts
  assert.equal(F.expandFeed(evs, FEED, "2026-10-01", "2026-10-19").length, 0);
});

test("Google-Link aus UID (eid), sonst kein Link", () => {
  const evs = F.parseFeed(ICS, { now: NOW });
  const [z] = F.expandFeed(evs, FEED, "2026-11-12", "2026-11-12");
  assert.ok(z.htmlLink.startsWith("https://calendar.google.com/calendar/event?eid="));
  const eid = decodeURIComponent(z.htmlLink.split("eid=")[1]);
  assert.equal(Buffer.from(eid, "base64").toString(), "9zahnarzt77 lippa.florian@m");
  const tr = F.expandFeed(evs, FEED, "2026-11-03", "2026-11-03")[0];
  assert.equal(Buffer.from(decodeURIComponent(tr.htmlLink.split("eid=")[1]), "base64").toString(), "5k3abc9training01_20261103T173000Z lippa.florian@m");
  const other = F.expandFeed(evs, { ...FEED, gcal: null }, "2026-11-12", "2026-11-12")[0];
  assert.equal(other.htmlLink, "");
  assert.equal(F.googleLink({ uid: "abc-123@outlook.com" }, CAL), "");
});

test("Feiertags-Feed: eingebaute Feiertage werden nicht doppelt gezeigt", () => {
  const hol = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261208\r\nDTEND;VALUE=DATE:20261209\r\nUID:20261208_x@google.com\r\nSUMMARY:Mariä Empfängnis\r\nEND:VEVENT\r\n" +
    "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261224\r\nDTEND;VALUE=DATE:20261225\r\nUID:20261224_x@google.com\r\nSUMMARY:Heiliger Abend\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
  const url = "https://calendar.google.com/calendar/ical/de.austrian%23holiday%40group.v.calendar.google.com/public/basic.ics";
  assert.equal(F.isHolidayFeed(url), true);
  assert.equal(F.googleCalId(url), "de.austrian#holiday@group.v.calendar.google.com");
  const feed = { id: "h", color: "tomate", gcal: F.googleCalId(url), holiday: true };
  const builtin = new Set(["2026-12-08"]);
  const inst = F.expandFeed(F.parseFeed(hol, { now: NOW }), feed, "2026-12-01", "2026-12-31", { skipHoliday: (k) => builtin.has(k) });
  assert.deepEqual(inst.map((i) => i.title), ["Heiliger Abend"]);
  const all = F.expandFeed(F.parseFeed(hol, { now: NOW }), { ...feed, holiday: false }, "2026-12-01", "2026-12-31", { skipHoliday: (k) => builtin.has(k) });
  assert.equal(all.length, 2);
});

test("checkFeedUrl: Prüfung der eingefügten Adresse", () => {
  assert.deepEqual(F.checkFeedUrl("  " + URL_G + " "), { ok: true, url: URL_G });
  assert.equal(F.checkFeedUrl("webcal://p01-calendars.icloud.com/published/2/abc.ics").url, "https://p01-calendars.icloud.com/published/2/abc.ics");
  assert.equal(F.checkFeedUrl("https://outlook.office365.com/owa/calendar/x/y/calendar.ics").ok, true);
  assert.equal(F.checkFeedUrl("http://calendar.google.com/calendar/ical/x/private-y/basic.ics").ok, false);
  assert.equal(F.checkFeedUrl("https://calendar.google.com/calendar/u/0/r").ok, false);
  assert.match(F.checkFeedUrl("https://calendar.google.com/calendar/embed?src=x").error, /Privatadresse/);
  assert.equal(F.checkFeedUrl("https://example.com/termine").ok, false);
  assert.equal(F.checkFeedUrl("https://192.168.0.1/a.ics").ok, false);
  assert.equal(F.checkFeedUrl("").ok, false);
  assert.equal(F.checkFeedUrl("kein link").ok, false);
  assert.ok(F.checkFeedUrl("https://calendar.google.com/calendar/ical/x%40gmail.com/public/basic.ics").warn);
});

test("maskUrl zeigt nur Domain + Ende, googleCalId dekodiert", () => {
  const m = F.maskUrl(URL_G);
  assert.equal(m, "calendar.google.com/…/basic.ics");
  assert.ok(!m.includes("private"));
  assert.equal(F.googleCalId(URL_G), CAL);
  assert.equal(F.googleCalId("https://outlook.office365.com/a/calendar.ics"), null);
  assert.equal(F.suggestName(URL_G), "Google Kalender");
});
