// node --test test/fahrzeug-core.test.mjs
// Fahrzeuge: Tankbuch je Fahrzeug, Verbrauch, km-Stände, Service (Datum/km), §57a-Pickerl mit Toleranzfrist, Versicherung, dueVehicles.
import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../js/alltag/fahrzeug-core.js";

const T = "2026-11-07";
const NOW = new Date(2026, 10, 7, 12).getTime();

const FILLS = [
  { id: "f1", date: "2026-09-01", km: 10000, liters: 40, total: 64, full: true, vehicleId: "v1" },
  { id: "f2", date: "2026-09-20", km: 10500, liters: 20, total: 32, full: false, vehicleId: "v1" },
  { id: "f3", date: "2026-10-05", km: 11000, liters: 15, total: 24, full: true, vehicleId: "v1" },
  { id: "f4", date: "2026-10-10", km: 50000, liters: 30, total: 50, full: true, vehicleId: "v2" },
  { id: "f5", date: "2026-10-20", km: 11600, liters: 36, total: 54, full: true }, // ohne Fahrzeug → Standard
];

test("vehicleFills: eigenes Fahrzeug + Tankungen ohne Fahrzeug fürs Standard-Fahrzeug", () => {
  assert.deepEqual(F.vehicleFills(FILLS, "v1", "v1").map((f) => f.id), ["f1", "f2", "f3", "f5"]);
  assert.deepEqual(F.vehicleFills(FILLS, "v1", "v2").map((f) => f.id), ["f1", "f2", "f3"]);
  assert.deepEqual(F.vehicleFills(FILLS, "v2", "v1").map((f) => f.id), ["f4"]);
});

test("consumption: l/100 km und €/100 km aus Volltankungen (Teil-Tankung zählt zur nächsten)", () => {
  const c = F.consumption(F.vehicleFills(FILLS, "v1", "v1"));
  // 10000→11000: 35 l, 56 € ; 11000→11600: 36 l, 54 € → 71 l / 1600 km
  assert.equal(c.km, 1600);
  assert.equal(Math.round(c.l100 * 100) / 100, 4.44);
  assert.equal(Math.round(c.eur100 * 100) / 100, 6.88);
  assert.equal(F.consumption([FILLS[3]]).l100, null);
});

test("odoReadings/currentKm/kmPerYear: Einträge, Tankungen, Fahrtenbuch-Monatsstand", () => {
  const info = { odo: [{ date: "2026-11-01", km: 11800 }, { date: "bad", km: 5 }] };
  const r = F.odoReadings(info, F.vehicleFills(FILLS, "v1", "v1"), { odoStart: { "2026-08": 9500 } });
  assert.deepEqual(r.map((x) => [x.date, x.src]).slice(0, 2), [["2026-08-01", "fahrtenbuch"], ["2026-09-01", "tanken"]]);
  assert.equal(F.currentKm(r), 11800);
  assert.equal(F.kmPerYear(r), Math.round(((11800 - 9500) / 92) * 365));
  assert.equal(F.currentKm([]), null);
});

test("serviceStatus: nach Datum oder km – was zuerst kommt", () => {
  assert.equal(F.serviceStatus({}, 1000, T).state, "none");
  const ok = F.serviceStatus({ service: { lastDate: "2026-06-01", everyMonths: 12, lastKm: 5000, everyKm: 15000 } }, 8000, T);
  assert.equal(ok.state, "ok"); assert.equal(ok.dueDate, "2027-06-01"); assert.equal(ok.kmLeft, 12000);
  const km = F.serviceStatus({ service: { lastDate: "2026-06-01", everyMonths: 12, lastKm: 5000, everyKm: 15000 } }, 19500, T);
  assert.equal(km.state, "bald"); assert.match(km.label, /noch 500 km/);
  const over = F.serviceStatus({ service: { lastDate: "2025-10-01", everyMonths: 12 } }, null, T);
  assert.equal(over.state, "ueber"); assert.match(over.label, /seit 01\.10\.2026/);
  assert.equal(F.fmtKm(123456), "123.456 km");
});

test("pickerlStatus: Fenster ab Monat davor, Toleranz 4 Monate, danach abgelaufen", () => {
  const st = (m, today) => F.pickerlStatus({ pickerl: { month: m } }, today);
  assert.equal(st("2027-06", T).state, "ok");
  assert.equal(st("2027-01", T).state, "bald");        // Fenster ab 01.12.2026 → 24 Tage
  assert.equal(st("2027-01", T).windowStart, "2026-12-01");
  assert.equal(st("2026-12", T).state, "jetzt");       // Monat davor
  assert.equal(st("2026-11", T).state, "jetzt");
  const tol = st("2026-08", T);
  assert.equal(tol.state, "toleranz"); assert.equal(tol.graceEnd, "2026-12-31");
  assert.equal(st("2026-06", T).state, "abgelaufen");  // Frist bis 31.10.2026
  assert.equal(st("2026-07", T).state, "toleranz");    // Frist bis 30.11.2026
  assert.equal(F.pickerlStatus({}, T).state, "none");
  assert.equal(F.nextPickerlMonth("2026-11", 2), "2028-11");
  assert.equal(F.nextPickerlMonth("2026-11", 9), "2027-11");
  assert.match(F.PICKERL_HINT, /vier Monate/);
});

test("insuranceStatus und normInfo (nur unkritische Felder)", () => {
  assert.equal(F.insuranceStatus({ insurance: { until: "2026-11-30" } }, T).state, "bald");
  assert.equal(F.insuranceStatus({ insurance: { until: "2026-01-01" } }, T).state, "ueber");
  const n = F.normInfo({ pickerl: { month: "2026-13", years: 7 }, insurance: { company: " Muster Versicherung " } }, "v9");
  assert.equal(n.id, "v9"); assert.equal(n.pickerl.month, null); assert.equal(n.pickerl.years, 1);
  assert.equal(n.insurance.company, "Muster Versicherung");
});

test("dueVehicles: Pickerl, Service, Versicherung – dringendste zuerst", () => {
  const vehicles = [{ id: "v1", name: "Caddy", plate: "XX-1AB" }, { id: "v2", name: "Golf" }];
  const infos = [
    { id: "v1", pickerl: { month: "2026-11" }, service: { lastKm: 1000, everyKm: 10000 } },
    { id: "v2", pickerl: { month: "2026-06" }, insurance: { until: "2026-11-20" } },
  ];
  const d = F.dueVehicles(vehicles, infos, FILLS, NOW, { defaultId: "v1" });
  assert.deepEqual(d.map((x) => [x.vehicleId, x.kind, x.state]), [
    ["v2", "pickerl", "abgelaufen"], ["v1", "service", "ueber"], ["v1", "pickerl", "jetzt"], ["v2", "versicherung", "bald"],
  ]);
  assert.match(d[2].text, /Pickerl Caddy \(XX-1AB\)/);
  assert.equal(d[0].hash, "#alltag/fahrzeuge/v2");
  assert.equal(F.routeId("#alltag/fahrzeuge/v2"), "v2");
});
