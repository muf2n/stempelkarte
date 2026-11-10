// node --test test/via.test.mjs
// 📍 Zwischenstopps: coordKey über Punktlisten, segmentKm mit via, Regeln fürs Merken, Entfernen.
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/travel.js";
import * as V from "../js/via-core.js";

const A = { lat: 47.0920, lng: 15.4040 };
const B = { lat: 47.0170, lng: 15.4190 };
const X = { lat: 47.0600, lng: 15.3700 };
const Y = { lat: 47.0400, lng: 15.3900 };
const S = { allowance: { kmFactor: 1.3 } };
const seg = (extra = {}) => ({ start: 0, end: 1, activity: "Autofahren", loc: A, endLoc: B, ...extra });

test("coordKey: zwei Punkte wie bisher, Liste über alle Punkte", () => {
  assert.equal(T.coordKey(A, B), "47.09200,15.40400;47.01700,15.41900");
  assert.equal(T.coordKey([A, B]), T.coordKey(A, B));
  assert.equal(T.coordKey([A, X, B]), "47.09200,15.40400;47.06000,15.37000;47.01700,15.41900");
  assert.equal(T.coordKey([A]), "");
  assert.equal(T.coordKey([A, { lat: 0, lng: 0 }, B]), "");
  assert.equal(T.coordKey(A, null), "");
});

test("segmentKm: Luftlinie = Summe der Teilstrecken × Faktor", () => {
  const plain = T.segmentKm(seg(), S);
  const via = T.segmentKm(seg({ via: [{ ...X, at: 1, acc: 10 }, { ...Y, at: 2, acc: 10 }] }), S);
  const legs = (T.haversineM(A, X) + T.haversineM(X, Y) + T.haversineM(Y, B)) / 1000 * 1.3;
  assert.equal(via.source, "est");
  assert.ok(Math.abs(via.km - legs) < 1e-9);
  assert.ok(via.km > plain.km);
  // ungültige via-Punkte werden ignoriert
  assert.ok(Math.abs(T.segmentKm(seg({ via: [null, { lat: "x" }] }), S).km - plain.km) < 1e-9);
});

test("segmentKm: Straßen-km gelten nur für den passenden Schlüssel über alle Punkte", () => {
  const via = [{ ...X, at: 1, acc: 10 }];
  const ckAll = T.coordKey([A, X, B]);
  assert.equal(T.segmentKm(seg({ via, kmRoad: 21.5, kmRoadFor: ckAll }), S).source, "road");
  assert.equal(T.segmentKm(seg({ via, kmRoad: 21.5, kmRoadFor: ckAll }), S).km, 21.5);
  // alter Schlüssel (nur Start/Ziel) passt nicht mehr, sobald ein Zwischenstopp dazukommt
  assert.equal(T.segmentKm(seg({ via, kmRoad: 12, kmRoadFor: T.coordKey(A, B) }), S).source, "est");
  // alte Daten ohne Schlüssel: mit via ungültig, ohne via weiterhin gültig
  assert.equal(T.segmentKm(seg({ via, kmRoad: 12 }), S).source, "est");
  assert.equal(T.segmentKm(seg({ kmRoad: 12 }), S).source, "road");
  // manuell gewinnt immer
  assert.equal(T.segmentKm(seg({ via, kmRoad: 21.5, kmRoadFor: ckAll, km: 30 }), S).km, 30);
  assert.deepEqual(T.routePoints(seg({ via })).length, 3);
  assert.deepEqual(T.routePoints({ loc: A }), []);
});

test("tripsBetween reicht via durch", () => {
  const e = { id: "e1", start: 10, end: 100, segments: [seg({ start: 10, end: 100, via: [{ ...X, at: 1, acc: 5 }] })] };
  const t = T.tripsBetween([e], 0, 1000, S)[0];
  assert.equal(t.via.length, 1);
});

test("viaCheck: Genauigkeit, Abstand, 2 min, Höchstzahl, manuell", () => {
  const now = 10 * 60000;
  const run = { activity: "Autofahren", loc: A, start: 0 };
  assert.equal(V.viaCheck(run, { ...X, acc: 200 }, { now }).reason, "acc");
  assert.equal(V.viaCheck(run, { lat: A.lat + 0.001, lng: A.lng, acc: 20 }, { now }).reason, "near"); // ~111 m
  assert.equal(V.viaCheck(run, { ...X, acc: 20 }, { now }).ok, true);
  const one = V.withVia(run, { ...X, acc: 20 }, now);
  assert.equal(one.via.length, 1);
  assert.deepEqual(Object.keys(one.via[0]).sort(), ["acc", "at", "lat", "lng"]);
  assert.equal(V.viaCheck(one, { ...Y, acc: 20 }, { now: now + 60000 }).reason, "soon");
  assert.equal(V.viaCheck(one, { ...Y, acc: 20 }, { now: now + 60000, manual: true }).ok, true);
  assert.equal(V.viaCheck(one, { ...Y, acc: 20 }, { now: now + 121000 }).ok, true);
  assert.equal(V.viaCheck(one, { ...X, acc: 20 }, { now: now + 600000, manual: true }).reason, "near");
  assert.equal(V.viaCheck(one, { ...Y, acc: 151 }, { now: now + 600000, manual: true }).reason, "acc");
  const full = { ...run, via: Array.from({ length: 25 }, (_, i) => ({ lat: 46 + i * 0.01, lng: 15, at: 0, acc: 5 })) };
  assert.equal(V.viaCheck(full, { ...X, acc: 5 }, { now, manual: true }).reason, "max");
});

test("withoutVia entfernt Stopp + veraltete Straßen-km", () => {
  const s = seg({ via: [{ ...X, at: 1, acc: 5 }, { ...Y, at: 2, acc: 5 }], kmRoad: 20, kmRoadFor: "x", kmRoadAt: 1 });
  const a = V.withoutVia(s, 0);
  assert.deepEqual(a.via.map((v) => v.lat), [Y.lat]);
  assert.equal(a.kmRoad, undefined);
  const b = V.withoutVia(a, 0);
  assert.equal("via" in b, false);
  assert.equal(V.viaCountText(1), "1 Zwischenstopp");
  assert.equal(V.viaCountText(3), "3 Zwischenstopps");
  assert.equal(V.viaLabel({ lat: 47.123456, lng: 15.5 }), "47.1235, 15.5000");
});
