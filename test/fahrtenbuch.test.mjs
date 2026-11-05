// node --test test/fahrtenbuch.test.mjs
// Fahrtenbuch: km-Vorrang (manuell > Straße > Luftlinie), Kurzadressen, Kilometerstand-Kette, Gruppierung,
// Rückfahrten, Summen, Export-Zeilen, manuelle Fahrt einfügen.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/travel.js";
import * as F from "../js/trip-core.js";

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const at = (d, h, m) => new Date(2026, 10, d, h, m).getTime();

const BUERO = { lat: 47.0920, lng: 15.4040, addr: "Puchstraße 41, 8020 Graz" };
const WIENER = { lat: 47.1060, lng: 15.4120, addr: "Wiener Straße 286, 8051 Graz" };
const KLEINOSCHEG = { lat: 47.1000, lng: 15.4300, addr: "Anton-Kleinoscheg-Straße, 8051 Graz" };
const FELD = { lat: 47.0170, lng: 15.4190, addr: "Feldkirchner Straße 11, 8054 Seiersberg-Pirka" };

function drive(start, end, loc, endLoc, extra = {}) {
  return { start, end, activity: "Autofahren", placeId: null, place: "", loc, endLoc, endPlace: endLoc ? endLoc.addr : "", ...extra };
}

test("km-Vorrang: manuell > Straße > Luftlinie", () => {
  const s = { allowance: { kmFactor: 1.3 } };
  const base = drive(0, 1, BUERO, WIENER);
  const est = T.segmentKm(base, s);
  assert.equal(est.source, "est");
  assert.ok(est.est && !est.manual && !est.road);
  const ck = T.coordKey(BUERO, WIENER);
  const road = T.segmentKm({ ...base, kmRoad: 3.2, kmRoadFor: ck }, s);
  assert.deepEqual([road.source, road.km, road.est], ["road", 3.2, false]);
  const man = T.segmentKm({ ...base, kmRoad: 3.2, kmRoadFor: ck, km: 5 }, s);
  assert.deepEqual([man.source, man.km, man.manual], ["manual", 5, true]);
  // kmRoad für andere Koordinaten wird ignoriert → Schätzung
  const stale = T.segmentKm({ ...base, kmRoad: 99, kmRoadFor: T.coordKey(BUERO, FELD) }, s);
  assert.equal(stale.source, "est");
  // ohne kmRoadFor (alte Daten) gilt kmRoad
  assert.equal(T.segmentKm({ ...base, kmRoad: 4 }, s).source, "road");
  // ohne Koordinaten, aber manuell
  assert.equal(T.segmentKm({ activity: "Autofahren", km: "7" }, s).km, 7);
  assert.equal(T.segmentKm({ activity: "Autofahren" }, s), null);
});

test("Summen nutzen überall denselben Vorrang (entryKm, kmBetween, tripsBetween)", () => {
  const ck = T.coordKey(BUERO, WIENER);
  const e = { id: "e1", start: at(2, 6, 50), end: at(2, 15, 0), segments: [
    drive(at(2, 6, 59), at(2, 7, 18), BUERO, WIENER, { kmRoad: 3.4, kmRoadFor: ck }),
    { start: at(2, 7, 18), end: at(2, 12, 10), activity: "Arbeiten", place: "", loc: WIENER },
    drive(at(2, 12, 10), at(2, 12, 28), KLEINOSCHEG, BUERO, { km: 6, endPlace: "Büro" }),
  ] };
  assert.equal(T.entryKm(e, {}), 9.4);
  assert.equal(T.kmBetween([e], at(1, 0, 0), at(30, 0, 0), {}), 9.4);
  const tr = T.tripsBetween([e], at(1, 0, 0), at(30, 0, 0), {});
  assert.deepEqual(tr.map((t) => t.source), ["road", "manual"]);
  assert.equal(tr[1].to, "Büro");
  assert.equal(tr[1].toSaved, true);
  assert.equal(tr[1].purpose, "Büro", "Standard-Zweck = gespeicherter Ort");
  assert.equal(tr[0].purpose, "Baustelle", "Standard-Zweck ohne gespeicherten Ort");
  assert.equal(tr[0].rawIndex, 0);
  assert.equal(tr[1].rawIndex, 2);
  assert.equal(tr[1].key, "e1#2");
});

test("Kurzadresse: Straße + Nummer, darunter PLZ/Ort", () => {
  assert.deepEqual(F.shortAddr("Wiener Straße 286, 8051 Graz"), { main: "Wiener Straße 286", sub: "8051 Graz" });
  assert.deepEqual(F.shortAddr("Feldkirchner Straße 11, 8054 Seiersberg-Pirka"), { main: "Feldkirchner Straße 11", sub: "8054 Seiersberg-Pirka" });
  assert.deepEqual(F.shortAddr("Anton-Kleinoscheg-Straße, 8051 Graz"), { main: "Anton-Kleinoscheg-Straße", sub: "8051 Graz" });
  assert.deepEqual(F.shortAddr("Weinholdstraße 13, 8010 Graz, Österreich"), { main: "Weinholdstraße 13", sub: "8010 Graz" });
  assert.deepEqual(F.shortAddr("Hauptplatz 1, Innere Stadt, 8010 Graz"), { main: "Hauptplatz 1, Innere Stadt", sub: "8010 Graz" });
  assert.deepEqual(F.shortAddr("Wiener Straße 286 8051 Graz"), { main: "Wiener Straße 286", sub: "8051 Graz" });
  assert.deepEqual(F.shortAddr("Graz"), { main: "Graz", sub: "" });
  assert.deepEqual(F.shortAddr(""), { main: "", sub: "" });
  // gespeicherter Name bevorzugt, Ort klein darunter
  assert.deepEqual(F.placeLabel("Büro", "Puchstraße 41, 8020 Graz", true), { main: "Büro", sub: "8020 Graz", full: "Büro · Puchstraße 41, 8020 Graz" });
  assert.equal(F.placeLabel("", "Wiener Straße 286, 8051 Graz", false).main, "Wiener Straße 286");
});

test("Gruppierung nach Tag + Tageskopf, Rückfahrten", () => {
  const trips = [
    { start: at(2, 6, 59), end: at(2, 7, 18), km: 11.2, from: "Büro", to: "Wiener Straße 286", fromLoc: BUERO, toLoc: WIENER, source: "road" },
    { start: at(2, 12, 10), end: at(2, 12, 28), km: 10, from: "Wiener Straße 286", to: "Büro", fromLoc: WIENER, toLoc: BUERO, source: "road" },
    { start: at(2, 12, 46), end: at(2, 12, 55), km: 3.2, from: "Büro", to: "Feldkirchner", fromLoc: BUERO, toLoc: FELD, source: "est", est: true },
    { start: at(2, 13, 10), end: at(2, 13, 15), km: 4, from: "Feldkirchner", to: "Büro", fromLoc: FELD, toLoc: BUERO, source: "manual" },
    { start: at(3, 6, 58), end: at(3, 7, 16), km: 5.1, from: "Büro", to: "Weinholdstraße 13", fromLoc: BUERO, toLoc: null, source: "road" },
  ];
  const g = F.groupByDay(trips, dayKey);
  assert.equal(g.length, 2);
  assert.equal(g[0].count, 4);
  assert.equal(Math.round(g[0].km * 10) / 10, 28.4);
  assert.equal(F.dayHeader(g[0], WD), "Mo, 02.11. · 4 Fahrten · ≈ 28,4 km");
  assert.equal(F.dayHeader(g[1], WD), "Di, 03.11. · 1 Fahrt · 5,1 km");
  F.markReturns(trips, dayKey);
  assert.deepEqual(trips.map((t) => t.isReturn), [false, true, false, true, false]);
});

test("Kilometerstand-Kette je Fahrzeug, lückenlos, über Monatsgrenze", () => {
  const settings = {
    vehicles: [{ id: "v1", name: "Caddy", plate: "g-123ab", type: "firma", odoStart: { "2026-11": 45210 } },
      { id: "v2", name: "Golf", plate: "", type: "privat", odoStart: {} }],
    trips: { defaultVehicleId: "v1" },
  };
  const trips = [
    { key: "a", start: at(2, 7, 0), km: 11.2 },
    { key: "b", start: at(2, 12, 0), km: 10.6 },
    { key: "c", start: at(2, 18, 0), km: 20, vehicleId: "v2" },
    { key: "d", start: at(3, 7, 0), km: 5.1, vehicleId: "v1" },
    { key: "e", start: new Date(2026, 11, 1, 7).getTime(), km: 3 },
    { key: "z", start: new Date(2026, 9, 31, 7).getTime(), km: 9 }, // vor dem ersten Stand
  ];
  const o = F.odometer(trips, settings);
  assert.deepEqual(o.get("a"), { begin: 45210, end: 45221, vehicleId: "v1" });
  assert.deepEqual(o.get("b"), { begin: 45221, end: 45232, vehicleId: "v1" });
  assert.equal(o.get("c"), undefined, "Privatauto ohne Stand");
  assert.deepEqual(o.get("d"), { begin: 45232, end: 45237, vehicleId: "v1" });
  assert.deepEqual(o.get("e"), { begin: 45237, end: 45240, vehicleId: "v1" }, "Kette läuft im Dezember weiter");
  assert.equal(o.get("z"), undefined);
  // neuer Stand im Dezember setzt die Kette neu
  settings.vehicles[0].odoStart["2026-12"] = 46000;
  assert.deepEqual(F.odometer(trips, settings).get("e"), { begin: 46000, end: 46003, vehicleId: "v1" });
  assert.equal(F.readVehicles(settings)[0].plate, "G-123AB");
});

test("Summen: beruflich/privat, Kilometergeld nur beruflich mit Privatauto", () => {
  const settings = {
    allowance: { kmRate: 0.5 },
    vehicles: [{ id: "v1", name: "Caddy", type: "firma" }, { id: "v2", name: "Golf", type: "privat" }],
    trips: { defaultVehicleId: "v1" },
  };
  const trips = [
    { km: 10, source: "road" },
    { km: 20, source: "manual", vehicleId: "v2" },
    { km: 5, source: "est", est: true, vehicleId: "v2", private: true },
    { km: null, source: null },
  ];
  const t = F.totals(trips, settings);
  assert.equal(t.km, 35);
  assert.equal(t.bizKm, 30);
  assert.equal(t.privKm, 5);
  assert.equal(t.kmgeldKm, 20);
  assert.equal(t.kmgeld, 10);
  assert.deepEqual([t.roadN, t.manualN, t.estN, t.unknownN], [1, 1, 1, 1]);
  assert.ok(t.approx && t.showKmgeld);
  // ohne Fahrzeuge: Schalter „Eigenes Auto“
  const t2 = F.totals([{ km: 10, source: "road" }], { allowance: { ownCar: true, kmRate: 0.42 } });
  assert.equal(Math.round(t2.kmgeld * 100), 420);
});

test("Filter und Export-Zeilen", () => {
  const settings = { vehicles: [{ id: "v1", name: "Caddy", plate: "G-123AB", type: "firma" }] };
  const trips = [
    { key: "a", start: at(2, 6, 59), end: at(2, 7, 18), km: 11.24, source: "road", from: "Büro", fromAddr: "Puchstraße 41, 8020 Graz", fromSaved: true,
      to: "Wiener Straße 286, 8051 Graz", toAddr: "Wiener Straße 286, 8051 Graz", toSaved: false, purpose: "Baustelle" },
    { key: "b", start: at(2, 18, 0), end: at(2, 18, 30), km: 4, source: "manual", from: "Büro", to: "Seiersberg", purpose: "Privat", private: true },
  ];
  assert.equal(F.filterTrips(trips, "wiener strasse").length, 1);
  assert.equal(F.filterTrips(trips, "privat").length, 1);
  assert.equal(F.filterTrips(trips, "caddy", settings).length, 2);
  assert.equal(F.filterTrips(trips, "").length, 2);
  const rows = F.logRows(trips, settings, new Map([["a", { begin: 45210, end: 45221 }]]));
  assert.equal(F.LOG_HEAD.length, rows[0].length);
  assert.deepEqual(rows[0], ["02.11.2026", "06:59", "07:18", "Büro (Puchstraße 41, 8020 Graz)", "Wiener Straße 286, 8051 Graz",
    "Baustelle", "11,2", "45210", "45221", "Caddy", "G-123AB", "beruflich", "Straße"]);
  assert.equal(rows[1][11], "privat");
  assert.equal(F.mapsDirUrl({ fromLoc: BUERO, toLoc: WIENER }),
    "https://www.google.com/maps/dir/?api=1&origin=47.092,15.404&destination=47.106,15.412&travelmode=driving");
});

test("Manuelle Fahrt in einen Abschnitt einfügen", () => {
  const e = { id: "e1", start: at(4, 7, 0), end: at(4, 15, 0), segments: [
    { start: at(4, 7, 0), activity: "Arbeiten", place: "Büro" },
    { start: at(4, 12, 0), activity: "Arbeiten", place: "Baustelle X" },
  ] };
  const d = { start: at(4, 9, 0), end: at(4, 9, 30), activity: "Autofahren", place: "Büro", endPlace: "Lager" };
  const segs = F.insertTrip(e, d);
  assert.deepEqual(segs.map((x) => [x.activity, new Date(x.start).getHours() * 60 + new Date(x.start).getMinutes()]),
    [["Arbeiten", 420], ["Autofahren", 540], ["Arbeiten", 570], ["Arbeiten", 720]]);
  assert.equal(segs[0].end, d.start);
  assert.equal(F.insertTrip(e, { ...d, end: at(4, 12, 30) }), null, "über zwei Abschnitte → null");
  assert.equal(F.insertTrip(e, { ...d, start: at(4, 6, 0) }), null);
  const p = F.patchSegment(e, 1, { purpose: "Kunde", private: null });
  assert.equal(p[1].purpose, "Kunde");
  assert.ok(!("private" in p[1]));
  assert.ok(!("purpose" in e.segments[1]), "Original unverändert");
});
