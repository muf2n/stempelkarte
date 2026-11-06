// node --test test/site-core.test.mjs
// Baustellen-Projektseiten (Update 10d): Status, Zuordnung, Aggregation, Zeitleiste, Hash/QR-Adresse.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/site-core.js";

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const P = { id: "p1", name: "Baustelle Muster", addr: "Musterstraße 1, 8000 Musterstadt", radius: 150 };
const OTHER = { id: "p2", name: "Firma" };

test("Status: gesetzt, sonst aus Beginn/Ende abgeleitet", () => {
  assert.equal(S.siteStatus({ siteStatus: "pausiert" }, "2026-11-06"), "pausiert");
  assert.equal(S.siteStatus({ siteStatus: "quatsch" }, "2026-11-06"), "aktiv");
  assert.equal(S.siteStatus({ siteStart: "2026-12-01" }, "2026-11-06"), "geplant");
  assert.equal(S.siteStatus({ siteEnd: "2026-10-01" }, "2026-11-06"), "abgeschlossen");
  assert.equal(S.siteStatus({}, "2026-11-06"), "aktiv");
  assert.equal(S.statusLabel("abgeschlossen"), "✅ Abgeschlossen");
  assert.equal(S.statusLabel("geplant"), "🗓️ Geplant");
});

test("Felder säubern + tel:-Link", () => {
  const f = S.cleanSiteFields({ contact: "  Frau Muster ", phone: "+43 (660) 123 45<script>", siteStatus: "aktiv", siteStart: "2026-11-10", siteEnd: "2026-11-01", siteNotes: " x ", crew: ["Max", "Max", " ", "Eva"] });
  assert.equal(f.contact, "Frau Muster");
  assert.equal(f.phone, "+43 (660) 123 45");
  assert.equal(f.siteStart, "2026-11-01");
  assert.equal(f.siteEnd, "2026-11-10");
  assert.deepEqual(f.crew, ["Max", "Eva"]);
  assert.equal(S.cleanSiteFields({ siteStatus: "x", siteStart: "morgen" }).siteStatus, null);
  assert.equal(S.cleanSiteFields({ siteStart: "morgen" }).siteStart, null);
  assert.equal(S.telHref("+43 (660) 123 45"), "tel:+4366012345");
  assert.equal(S.telHref("0316/123"), "tel:0316123");
  assert.equal(S.telHref("ab"), "");
});

const ENTRIES = [
  { id: "e1", start: at(2026, 11, 2, 7), end: at(2026, 11, 2, 15, 30), pauseMin: 30, placeId: "p1", place: "Baustelle Muster", people: ["Max"] },
  { id: "e2", start: at(2026, 11, 3, 7), end: at(2026, 11, 3, 12), pauseMin: 0, placeId: "p2", place: "Firma",
    segments: [{ start: at(2026, 11, 3, 7), activity: "Arbeiten", placeId: "p2" }, { start: at(2026, 11, 3, 9), activity: "Autofahren" }, { start: at(2026, 11, 3, 10), activity: "Arbeiten", placeId: "p1", place: "Baustelle Muster" }] },
  { id: "e3", start: at(2026, 11, 4, 7), end: at(2026, 11, 4, 9), place: "baustelle  MUSTER" }, // ohne placeId, nur Name
  { id: "e4", kind: "urlaub", start: at(2026, 11, 5, 7), end: at(2026, 11, 5, 15), placeId: "p1" },
  { id: "e5", start: at(2026, 11, 5, 7), end: at(2026, 11, 5, 9), placeId: "p2" },
];

test("Arbeitszeiten: ganzer Eintrag, passende Abschnitte, Name ohne placeId; Urlaub/fremde Orte nicht", () => {
  const w = S.workSummary(ENTRIES, P);
  assert.equal(w.list.length, 3);
  assert.deepEqual(w.list.map((x) => x.entry.id), ["e3", "e2", "e1"]);
  assert.equal(w.list.find((x) => x.entry.id === "e2").min, 120); // nur 10–12 Uhr
  assert.equal(w.totalMin, 480 + 120 + 120);
  assert.equal(w.days, 3);
  assert.deepEqual(w.people, ["Max"]);
  assert.equal(w.first, ENTRIES[0].start);
  assert.equal(S.summaryLine(P, w, "2026-11-06"), "🔨 Aktiv · 12:00 h · 3 Tage");
  assert.equal(S.workSummary(ENTRIES, OTHER).totalMin, 120 + 120);
});

test("Läuft gerade hier?", () => {
  assert.equal(S.runningHere({ start: 1, placeId: "p1" }, P), true);
  assert.equal(S.runningHere({ start: 1, placeId: "p2", segments: [{ start: 1, placeId: "p2" }, { start: 2, placeId: "p1" }] }, P), true);
  assert.equal(S.runningHere({ start: 1, placeId: "p2" }, P), false);
  assert.equal(S.runningHere(null, P), false);
});

test("Material, Fotos, Fahrten, Aufgaben werden zugeordnet", () => {
  const mat = S.siteMaterial([
    { id: "m1", name: "NYM-J 3×1,5", status: "brauche", placeId: "p1" },
    { id: "m2", name: "Schuko", status: "verbaut", place: "Baustelle Muster" },
    { id: "m3", name: "Wago", status: "baustelle", placeId: "p2" },
    { id: "m4", name: "FI", status: "besorgt", placeId: "p1" },
  ], P);
  assert.deepEqual(mat.items.map((x) => x.id), ["m1", "m2", "m4"]);
  assert.deepEqual(mat.fehlt.map((x) => x.id), ["m1"]);
  assert.equal(mat.open, 2);
  assert.equal(mat.verbaut, 1);

  const ph = S.sitePhotos([
    { id: "f3", ts: 30, placeId: null, albumIds: ["a1"] },
    { id: "f1", ts: 10, placeId: "p1" },
    { id: "f2", ts: 20, addr: "Musterstraße 1, 8000 Musterstadt" },
    { id: "f4", ts: 40, placeId: "p2" },
  ], P, [{ id: "a1", placeId: "p1" }, { id: "a2", placeId: "p2" }]);
  assert.deepEqual(ph.map((x) => x.id), ["f1", "f2", "f3"]);
  const ba = S.beforeAfter([{ id: "a", phase: "vorher" }, { id: "b", phase: "nachher" }, { id: "c" }, { id: "d", phase: "vorher" }]);
  assert.deepEqual([ba.vorher.length, ba.nachher.length, ba.pairs], [2, 1, 1]);

  const tr = S.siteTrips([
    { to: "Baustelle Muster", km: 12.34 }, { from: "Baustelle Muster", to: "Firma", km: 10 },
    { to: "", toAddr: "Musterstraße 1, 8000 Musterstadt", km: 1 }, { to: "Firma", km: 50 }, { to: "Baustelle Muster", km: 7, private: true },
  ], P);
  assert.equal(tr.list.length, 3);
  assert.equal(tr.km, 23.3);

  const td = S.siteTodos([
    { id: "t1", kind: "todo", placeId: "p1", title: "Verteiler beschriften" },
    { id: "t2", kind: "einsatz", placeId: "p1", date: "2026-11-10" },
    { id: "t3", kind: "einsatz", placeId: "p1", date: "2026-11-02" },
    { id: "t4", kind: "todo", placeId: "p2" }, { id: "t5", kind: "todo" },
  ], P);
  assert.deepEqual(td.aufgaben.map((x) => x.id), ["t1"]);
  assert.deepEqual(td.einsaetze.map((x) => x.id), ["t3", "t2"]);
});

test("Tagebuch: Uhrzeit vorne erkennen, normalisieren", () => {
  assert.deepEqual(S.splitLogText("8:15 Leitungen verlegt"), { time: "08:15", text: "Leitungen verlegt" });
  assert.deepEqual(S.splitLogText("08.15 Leitungen"), { time: "08:15", text: "Leitungen" });
  assert.deepEqual(S.splitLogText("25:00 nix"), { time: null, text: "25:00 nix" });
  assert.equal(S.logTs("2026-11-06", "08:15"), at(2026, 11, 6, 8, 15));
  assert.equal(S.logTs("2026-11-06", "24:00"), null);
  assert.equal(S.normLog({ placeId: "p1", ts: 5, text: "  " }), null);
  assert.equal(S.normLog({ placeId: "../x", ts: 5, text: "a" }), null);
  assert.equal(S.normLog({ placeId: "p1", ts: 5, text: "x".repeat(900) }).text.length, S.LOG_MAX);
});

test("Zeitleiste: echte Daten + Tagebuch chronologisch, nach Tag gruppiert", () => {
  const ev = S.buildTimeline({
    place: { ...P, siteStart: "2026-11-02" },
    entries: ENTRIES,
    photos: [{ id: "f1", ts: at(2026, 11, 2, 9), note: "Verteiler", phase: "vorher" }],
    material: [{ id: "m1", name: "Schuko", qty: 2, unit: "Stk", status: "verbaut", created: at(2026, 11, 2, 8), doneAt: at(2026, 11, 2, 14) }],
    log: [{ id: "l1", placeId: "p1", ts: at(2026, 11, 2, 8, 15), text: "Leitungen verlegt" }, { id: "l2", placeId: "p2", ts: at(2026, 11, 2, 8), text: "fremd" }],
    todos: [{ id: "t1", title: "Abnahme", done: true, doneAt: at(2026, 11, 4, 8) }],
    running: { start: at(2026, 11, 6, 7), placeId: "p1", segments: [{ start: at(2026, 11, 6, 7), placeId: "p1" }] },
  });
  const day2 = ev.filter((e) => S.keyOf(e.ts) === "2026-11-02").map((e) => e.kind);
  assert.deepEqual(day2, ["start", "in", "mat", "log", "photo", "matdone", "out"]);
  assert.ok(!ev.some((e) => e.text === "fremd"));
  assert.ok(ev.find((e) => e.kind === "photo").text.includes("(Vorher): Verteiler"));
  assert.ok(ev.find((e) => e.kind === "out" && e.ref === "e1").text.includes("8:00 h hier"));
  assert.ok(ev.some((e) => e.kind === "seg" && e.text.includes("Autofahren")));
  assert.equal(ev[ev.length - 1].kind, "run");
  for (let i = 1; i < ev.length; i++) assert.ok(ev[i].ts >= ev[i - 1].ts);
  const g = S.groupByDay(ev);
  assert.equal(g[0].dayKey, "2026-11-06");
  assert.equal(g[g.length - 1].dayKey, "2026-11-02");
});

test("Abgeschlossene Baustellen, Hash und QR-Adresse", () => {
  const list = S.closedSites([
    { id: "a", name: "A", siteStatus: "abgeschlossen", siteEnd: "2026-09-01" },
    { id: "b", name: "B", siteEnd: "2026-10-01" },
    { id: "c", name: "C", siteStatus: "aktiv", siteEnd: "2026-10-01" },
    { id: "d", name: "D" },
  ], "2026-11-06");
  assert.deepEqual(list.map((x) => x.id), ["b", "a"]);
  assert.equal(S.siteHash("p1"), "#orte/baustelle/p1");
  assert.equal(S.siteHash("bad id"), "#orte");
  assert.equal(S.parseSiteHash("#orte/baustelle/p1"), "p1");
  assert.equal(S.parseSiteHash("orte/baustelle/p_1-x"), "p_1-x");
  assert.equal(S.parseSiteHash("#orte/baustelle/%3Cx%3E"), null);
  assert.equal(S.parseSiteHash("#orte"), null);
  assert.equal(S.siteUrl("https://example.org/app/?a=1#heute", "p1"), "https://example.org/app/#orte/baustelle/p1");
});
