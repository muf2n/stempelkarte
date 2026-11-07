// node --test test/weekreport-core.test.mjs
// Automatischer Wochenbericht (Update 10): Woche sammeln, Entwurf, Speichern, Claude-Antwort zerlegen, Export.
import test from "node:test";
import assert from "node:assert/strict";
import * as W from "../js/weekreport-core.js";

const at = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h, min);
const kOf = (ts) => new Date(ts).toISOString().slice(0, 10);
const WEEK = "2026-W45"; // Mo 02.11. – So 08.11.2026
const P = [{ id: "p1", name: "Baustelle Muster", addr: "Musterstraße 1, 8000 Musterstadt" }, { id: "p2", name: "Firma Beispiel" }];

function row(key, extra = {}) { return { key, acts: [], places: [], people: [], tags: [], min: 0, hol: null, ...extra }; }
function fixture() {
  const entries = [
    { id: "e1", start: at(2026, 11, 2, 7), end: at(2026, 11, 2, 15, 30), pauseMin: 30, placeId: "p1", place: "Baustelle Muster", people: ["Max Muster"], note: "Verteiler gesetzt" },
    { id: "e2", start: at(2026, 11, 3, 6, 30), end: at(2026, 11, 3, 11), pauseMin: 0, placeId: "p1", place: "Baustelle Muster",
      segments: [{ start: at(2026, 11, 3, 6, 30), activity: "Autofahren" }, { start: at(2026, 11, 3, 7), activity: "Arbeiten", placeId: "p1" }] },
    { id: "e3", kind: "krank", start: at(2026, 11, 5, 0), end: at(2026, 11, 5, 0), creditMin: 462 },
    { id: "pv", start: at(2026, 11, 3, 18), end: at(2026, 11, 3, 19), privateTrip: true, place: "Privat" },
    { id: "old", start: at(2026, 10, 20, 7), end: at(2026, 10, 20, 15), place: "Andere Woche", note: "nicht diese Woche" },
  ];
  const rows = [
    row("2026-11-02", { min: 480, people: ["Max Muster"] }),
    row("2026-11-03", { min: 270 }),
    row("2026-11-04", { min: 462, tags: [{ kind: "schule", text: "Berufsschule" }] }),
    row("2026-11-05", { min: 462, tags: [{ kind: "krank", text: "Krank" }] }),
    row("2026-11-06", { min: 0, tags: [{ kind: "urlaub", text: "Urlaub" }] }),
    row("2026-11-07"), row("2026-11-08"),
  ];
  const siteLog = [
    { id: "l1", placeId: "p1", ts: at(2026, 11, 2, 9), text: "Leitungen im OG verlegt" },
    { id: "l2", placeId: "p1", ts: at(2026, 10, 1, 9), text: "alt" },
  ];
  const material = [
    { id: "m1", name: "NYM-J 3×1,5", qty: 25, unit: "m", status: "verbaut", placeId: "p1", dayKey: "2026-11-02" },
    { id: "m2", name: "Schuko-Steckdose", qty: 2, unit: "Stk", status: "verbaut", placeId: "p1", dayKey: "2026-11-02" },
    { id: "m3", name: "Schuko-Steckdose", qty: 1, unit: "Stk", status: "verbaut", placeId: "p1", dayKey: "2026-11-02" },
    { id: "m4", name: "FI-Schalter", qty: 1, unit: "Stk", status: "brauche", placeId: "p1", dayKey: "2026-11-02" },
  ];
  const photos = [
    { id: "f1", ts: at(2026, 11, 2, 10), dayKey: "2026-11-02", placeId: "p1", note: "Verteiler vorher" },
    { id: "f2", ts: at(2026, 11, 2, 14), dayKey: "2026-11-02", placeId: "p1", note: "" },
    { id: "f3", ts: at(2026, 11, 9, 14), dayKey: "2026-11-09", placeId: "p1", note: "nächste Woche" },
  ];
  return { week: WEEK, rows, entries, dayKeyOf: kOf, places: P, siteLog, material, photos };
}

test("Woche: Schlüssel, Montag, Tage, Verschieben (auch über den Jahreswechsel)", () => {
  assert.equal(W.weekKeyOf("2026-11-07"), "2026-W45");
  assert.equal(W.mondayOfWeek("2026-W45"), "2026-11-02");
  assert.deepEqual(W.weekDays("2026-W45"), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(W.weekKeyOf("2027-01-01"), "2026-W53");
  assert.equal(W.mondayOfWeek("2026-W01"), "2025-12-29");
  assert.equal(W.shiftWeek("2026-W53", 1), "2027-W01");
  assert.equal(W.shiftWeek("2026-W45", -1), "2026-W44");
  assert.ok(W.isWeekKey("2026-W45") && W.isWeekKey("2026-W53"));
  assert.ok(!W.isWeekKey("2025-W53") && !W.isWeekKey("2026-W00") && !W.isWeekKey("2026-45") && !W.isWeekKey("prefs"));
});

test("buildWeekReport: echte Daten je Tag – Stunden, Baustellen, Abschnitte, Notizen, Tagebuch, Material, Fotos", () => {
  const r = W.buildWeekReport(fixture());
  assert.equal(r.kw, 45);
  assert.equal(r.from, "2026-11-02");
  assert.equal(r.to, "2026-11-08");
  const [mo, di, mi, dO, fr, sa] = r.days;
  assert.equal(mo.type, "arbeit");
  assert.equal(mo.min, 480);
  assert.deepEqual(mo.sites, [{ name: "Baustelle Muster", min: 480 }]);
  assert.deepEqual(mo.notes, ["Verteiler gesetzt"]);
  assert.deepEqual(mo.people, ["Max Muster"]);
  assert.deepEqual(mo.log, [{ site: "Baustelle Muster", text: "Leitungen im OG verlegt" }]);
  assert.deepEqual(mo.material.map((x) => x.line), ["25 m NYM-J 3×1,5", "3× Schuko-Steckdose"], "nur verbaut, summiert");
  assert.deepEqual(mo.photos, { count: 2, notes: ["Verteiler vorher"] });
  // Abschnitte: 30 min Autofahren + 4 h Arbeiten; Fahrt zählt nicht zur Baustelle
  assert.deepEqual(di.segments, [{ activity: "Autofahren", min: 30, drive: true }, { activity: "Arbeiten", min: 240, drive: false }]);
  assert.deepEqual(di.sites, [{ name: "Baustelle Muster", min: 240 }]);
  assert.ok(!di.notes.includes("Privat"), "Privatfahrten zählen nicht");
  assert.equal(mi.type, "schule");
  assert.ok(mi.school && mi.schoolLabel === "Berufsschule");
  assert.equal(dO.type, "krank");
  assert.equal(fr.type, "urlaub");
  assert.ok(sa.empty && sa.weekend);
  assert.deepEqual(r.totals, { min: 1674, workDays: 2, schoolDays: 1, leaveDays: 1, zaDays: 0, sickDays: 1, holidays: 0, driveMin: 30, photos: 2, material: 2, log: 1 });
  assert.deepEqual(r.sites, [{ name: "Baustelle Muster", min: 720, days: 2, photos: 2 }]);
});

test("buildWeekReport: Pause anteilig auf Abschnitte, Abschnitt-Ort vor Eintrags-Ort, Feiertag", () => {
  const f = fixture();
  f.entries = [{ start: at(2026, 11, 2, 7), end: at(2026, 11, 2, 17), pauseMin: 60, placeId: "p2",
    segments: [{ start: at(2026, 11, 2, 7), activity: "Arbeiten", placeId: "p1" }, { start: at(2026, 11, 2, 12), activity: "Kundendienst", place: "Beispielgasse 2" }] }];
  f.rows = [row("2026-11-02", { min: 540 }), row("2026-11-03", { hol: "Testfeiertag", tags: [{ kind: "feiertag", text: "Feiertag: Testfeiertag" }] })];
  f.siteLog = []; f.material = []; f.photos = [];
  const r = W.buildWeekReport(f);
  assert.deepEqual(r.days[0].segments, [{ activity: "Arbeiten", min: 270, drive: false }, { activity: "Kundendienst", min: 270, drive: false }]);
  assert.deepEqual(r.days[0].sites.map((x) => x.name).sort(), ["Baustelle Muster", "Beispielgasse 2"]);
  assert.equal(r.days[1].type, "feiertag");
  assert.equal(r.days[1].holiday, "Testfeiertag");
  assert.throws(() => W.buildWeekReport({ week: "kaputt" }));
});

test("draftDay: Berichtsheft-Text nur aus vorhandenen Daten (neutral + Ich-Form)", () => {
  const r = W.buildWeekReport(fixture());
  const mo = W.draftDay(r.days[0]);
  assert.equal(mo, "Baustelle Muster: Verteiler gesetzt; Leitungen im OG verlegt. Verbautes Material: 25 m NYM-J 3×1,5, 3× Schuko-Steckdose. Fotodokumentation: 2 Fotos (Verteiler vorher). Gemeinsam mit Max Muster.");
  assert.match(W.draftDay(r.days[0], "ich"), /^Vor Ort \(Baustelle Muster\) habe ich mitgearbeitet: Verteiler gesetzt; Leitungen im OG verlegt\. Verbaut habe ich: /);
  assert.equal(W.draftDay(r.days[1]), "Mitarbeit vor Ort (Baustelle Muster). Fahrten zur Baustelle/zum Material (0:30 h).");
  assert.equal(W.draftDay(r.days[2]), "Berufsschule: Unterricht laut Stundenplan.");
  assert.equal(W.draftDay(r.days[2], "ich"), "Ich war in der Berufsschule.");
  assert.equal(W.draftDay(r.days[3]), "Krankenstand.");
  assert.equal(W.draftDay(r.days[4], "ich"), "Ich hatte Urlaub.");
  assert.equal(W.draftDay(r.days[5]), "", "leerer Tag bleibt leer – nichts erfunden");
  const all = W.draftWeek(r);
  assert.equal(Object.keys(all).length, 7);
  assert.ok(!Object.values(all).join(" ").includes("nicht diese Woche"));
});

test("normDoc/mergeTexts: gespeicherter Text gewinnt, nur Tage der Woche, Status", () => {
  const d = W.normDoc({ week: WEEK, days: { "2026-11-02": "Eigener Text", "2026-12-01": "fremd", "2026-11-03": 5 }, src: { "2026-11-02": "edit", "2026-11-04": "böse" }, status: "abgegeben", submittedAt: 7 });
  assert.deepEqual(d.days, { "2026-11-02": "Eigener Text" });
  assert.deepEqual(d.src, { "2026-11-02": "edit" });
  assert.equal(d.status, "abgegeben");
  assert.equal(W.normDoc(null, WEEK).status, "entwurf");
  assert.equal(W.normDoc(null, WEEK).saved, false);
  const m = W.mergeTexts(d, { "2026-11-02": "auto", "2026-11-03": "auto 2" });
  assert.deepEqual(m, { "2026-11-02": "Eigener Text", "2026-11-03": "auto 2" });
  assert.equal(W.normDoc({ days: { "2026-11-02": "x".repeat(5000) } }, WEEK).days["2026-11-02"].length, W.TEXT_MAX);
});

test("summaryForAi: nur strukturierte Daten, keine Bilddaten; parseAiDays zerlegt die Antwort", () => {
  const f = fixture();
  f.photos[0].thumb = "data:image/jpeg;base64,GEHEIM";
  const r = W.buildWeekReport(f);
  const t = W.summaryForAi(r, { style: "ich", trade: "Elektrotechnik", year: 1 });
  assert.match(t, /Woche: KW 45\/2026 \(02\.11\.2026 – 08\.11\.2026\)/);
  assert.match(t, /Form: Ich-Form/);
  assert.match(t, /### 2026-11-02 \(Mo 02\.11\.\)\nArt: Arbeit · 8:00 h\nBaustellen: Baustelle Muster \(8:00 h\)/);
  assert.match(t, /Tagebuch: Leitungen im OG verlegt/);
  assert.match(t, /Verbaut: 25 m NYM-J 3×1,5, 3× Schuko-Steckdose/);
  assert.match(t, /Fotos: 2 \(Notizen: Verteiler vorher\)/);
  assert.match(t, /### 2026-11-07 \(Sa 07\.11\.\)\nArt: Frei · 0:00 h\n\(keine Daten\)/);
  assert.doesNotMatch(t, /GEHEIM|base64/);

  const reply = "Hier dein Bericht:\n### 2026-11-02 (Mo 02.11.)\nVerteiler gesetzt und Leitungen im OG verlegt.\n- 25 m NYM-J verbaut\n\n### 2026-11-03: Mitarbeit auf der Baustelle.\n**2026-11-07**\n(keine Daten)\n### 2026-12-24\nfremd";
  const p = W.parseAiDays(reply, WEEK);
  assert.deepEqual(p, { "2026-11-02": "Verteiler gesetzt und Leitungen im OG verlegt.\n– 25 m NYM-J verbaut", "2026-11-03": "Mitarbeit auf der Baustelle.", "2026-11-07": "" });
});

test("reportText: Kopf, Tage mit Stunden, Summe, Ergänzungen, Status", () => {
  const r = W.buildWeekReport(fixture());
  const texts = W.draftWeek(r);
  texts["2026-11-02"] = "Verteiler gesetzt.";
  const t = W.reportText(r, texts, { name: "Max Muster", trade: "Elektrotechnik", company: "Muster GmbH", year: 2 }, { status: "abgegeben", notes: "FI geprüft" });
  assert.match(t, /^Ausbildungsnachweis – KW 45 \(02\.11\.2026 – 08\.11\.2026\)\nName: Max Muster\nLehrberuf: Elektrotechnik\nLehrbetrieb: Muster GmbH\nLehrjahr: 2\./);
  assert.match(t, /Montag, 02\.11\.2026 \(8:00 h\):\nVerteiler gesetzt\./);
  assert.match(t, /Donnerstag, 05\.11\.2026 \(7:42 h\):\nKrankenstand\./);
  assert.doesNotMatch(t, /Samstag/, "leere Tage ohne Text fallen weg");
  assert.match(t, /Wochensumme: 27:54 h\n\nErgänzungen:\nFI geprüft\n\nStatus: abgegeben ✅$/);
});

test("wantsFridayTip: Freitag ab 12 Uhr oder Samstag, nur wenn gearbeitet und nicht abgegeben", () => {
  const fri = (h) => new Date(2026, 10, 6, h, 0);
  assert.equal(W.wantsFridayTip(fri(13), { workedDays: 3 }), true);
  assert.equal(W.wantsFridayTip(fri(10), { workedDays: 3 }), false);
  assert.equal(W.wantsFridayTip(fri(13), { workedDays: 3, submitted: true }), false);
  assert.equal(W.wantsFridayTip(fri(13), { workedDays: 0 }), false);
  assert.equal(W.wantsFridayTip(new Date(2026, 10, 7, 9), { workedDays: 2 }), true);
  assert.equal(W.wantsFridayTip(new Date(2026, 10, 4, 15), { workedDays: 2 }), false);
});
