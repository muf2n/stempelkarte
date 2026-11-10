// Update 10 – 📍 Zwischenstopps: fahrtenbuch_lesen rechnet km über alle Punkte (gleiche Logik wie js/travel.js).
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";
import * as TR from "../src/trip.js";

const A = { lat: 48.17, lng: 14.0 }, X = { lat: 48.20, lng: 14.05 }, B = { lat: 48.16, lng: 14.03 };

test("fahrtenbuch_lesen: Zwischenstopps zählen (Straße über alle Punkte, sonst Teilstrecken)", async () => {
  const t = await setup({ now: vt(2026, 11, 4, 10, 0) });
  const b = t.base;
  t.g.set(`${b}/meta/settings`, { weeklyTarget: 38.5, allowance: { kmFactor: 1.3 } });
  t.g.set(`${b}/meta/state`, { running: null, rev: 1 });
  const via = [{ ...X, at: vt(2026, 11, 2, 7, 10), acc: 12 }];
  t.g.set(`${b}/entries/e1`, {
    kind: "work", start: vt(2026, 11, 2, 7, 0), end: vt(2026, 11, 2, 9, 0), pauseMin: 0, people: [],
    segments: [
      { start: vt(2026, 11, 2, 7, 0), end: vt(2026, 11, 2, 7, 30), activity: "Autofahren", place: "Firma", endPlace: "Huber", loc: A, endLoc: B, via,
        kmRoad: 17.4, kmRoadFor: TR.coordKey([A, X, B]) },
      { start: vt(2026, 11, 2, 7, 30), end: vt(2026, 11, 2, 9, 0), activity: "Arbeiten", place: "Huber" },
    ],
  });
  t.g.set(`${b}/entries/e2`, {
    kind: "work", start: vt(2026, 11, 3, 7, 0), end: vt(2026, 11, 3, 9, 0), pauseMin: 0, people: [],
    segments: [
      { start: vt(2026, 11, 3, 7, 0), end: vt(2026, 11, 3, 7, 30), activity: "Autofahren", place: "Firma", endPlace: "Huber", loc: A, endLoc: B, via,
        kmRoad: 3, kmRoadFor: TR.coordKey(A, B) }, // alter Wert ohne Zwischenstopp → ungültig
      { start: vt(2026, 11, 3, 7, 30), end: vt(2026, 11, 3, 9, 0), activity: "Arbeiten", place: "Huber" },
    ],
  });
  const r = await t.tool("fahrtenbuch_lesen", { monat: "2026-11" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /07:00–07:30 · Firma → Huber · 17,4 km \(Straße\) · .*📍 1 Zwischenstopp/);
  const est = (TR.haversineM(A, X) + TR.haversineM(X, B)) / 1000 * 1.3;
  assert.match(r.text, new RegExp(`≈ ${TR.fmtKmD(est).replace(".", "\\.")} km \\(≈ Luftlinie\\)`));
});
