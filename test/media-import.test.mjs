// node --test test/media-import.test.mjs
// Kamera-Fotos übernehmen: Regel (in/außerhalb Einträgen, laufende Schicht, privat, Orte-Radius), Doppelte, App-Regel.
import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/media-import-core.js";

const H = 3600e3;
const T0 = new Date(2026, 10, 4, 7, 0).getTime();   // 04.11.2026 07:00
const FIRMA = { id: "pF", name: "Firma", lat: 47.0402, lng: 15.4089, radius: 150 };
const move = (p, dLatM) => ({ lat: p.lat + dLatM / 111320, lng: p.lng });
const entries = [
  { id: "e1", start: T0, end: T0 + 8 * H, placeId: "pF", place: "Firma",
    segments: [
      { start: T0, end: T0 + H, activity: "Autofahren", placeId: null, place: "", loc: { lat: 47.1, lng: 15.5 } },
      { start: T0 + H, end: T0 + 8 * H, activity: "Arbeiten", placeId: "pF", place: "Firma", loc: null },
    ] },
  { id: "u1", kind: "urlaub", start: T0 + 24 * H, end: T0 + 32 * H },
];
const ctx = (over = {}) => ({ entries, running: null, places: [FIRMA], settings: {}, now: T0 + 48 * H, ...over });

test("Standard-Regel ist „Nur während der Arbeitszeit“", () => {
  assert.equal(M.normSettings({}).rule, "work");
  assert.equal(M.normSettings({ mediaImport: { rule: "quatsch" } }).rule, "work");
  assert.equal(M.normSettings({ mediaImport: { rule: "ask" } }).rule, "ask");
  assert.equal(M.normSettings({}).auto, false);
  assert.equal(M.normSettings({}).notify, true);
});

test("Foto im Arbeits-Eintrag → Arbeitsfoto mit Ort des Abschnitts", () => {
  const r = M.classify({ ts: T0 + 3 * H }, ctx());
  assert.equal(r.ok, true); assert.equal(r.reason, "work");
  assert.equal(r.placeId, "pF"); assert.equal(r.entryId, "e1");
  assert.deepEqual([r.loc.lat, r.loc.lng], [FIRMA.lat, FIRMA.lng], "Position vom Ort (Abschnitt ohne loc)");
  const r2 = M.classify({ ts: T0 + 0.5 * H }, ctx());
  assert.equal(r2.placeId, null); assert.equal(r2.loc.lat, 47.1, "Fahrt-Abschnitt: dessen Startposition");
});

test("Kulanz 5 min am Rand, danach außerhalb", () => {
  assert.equal(M.classify({ ts: T0 + 8 * H + 4 * 60e3 }, ctx()).ok, true);
  assert.equal(M.classify({ ts: T0 + 8 * H + 6 * 60e3 }, ctx()).reason, "outside");
  assert.equal(M.classify({ ts: T0 - 20 * 60e3 }, ctx()).reason, "outside");
});

test("Urlaub zählt nicht als Arbeitszeit", () => {
  assert.equal(M.classify({ ts: T0 + 26 * H }, ctx()).reason, "outside");
});

test("laufende Schicht zählt bis jetzt", () => {
  const running = { start: T0 + 47 * H, segments: [{ start: T0 + 47 * H, activity: "Arbeiten", placeId: "pF", place: "Firma" }] };
  const r = M.classify({ ts: T0 + 47.5 * H }, ctx({ running }));
  assert.equal(r.ok, true); assert.equal(r.running, true); assert.equal(r.placeId, "pF"); assert.equal(r.entryId, null);
  assert.equal(M.classify({ ts: T0 + 49 * H }, ctx({ running })).reason, "outside", "nach jetzt nicht");
});

test("ohne Aufnahmezeit → nicht vorausgewählt", () => {
  assert.equal(M.classify({ ts: 0 }, ctx()).reason, "nodate");
});

test("Orte-Radius nur bei „Arbeitszeit oder an meinen Orten“ / „fragen“", () => {
  const p = { ts: T0 + 30 * H, ...move(FIRMA, 100) };
  assert.equal(M.classify(p, ctx()).reason, "outside");
  const r = M.classify(p, ctx({ rule: "work_or_place" }));
  assert.equal(r.ok, true); assert.equal(r.reason, "place"); assert.equal(r.placeId, "pF");
  assert.equal(M.classify(p, ctx({ settings: { mediaImport: { rule: "ask" } } })).reason, "place");
  assert.equal(M.classify({ ts: T0 + 30 * H, ...move(FIRMA, 200) }, ctx({ rule: "work_or_place" })).reason, "outside", "außerhalb 150 m");
});

test("Privatmodus: Zeitraum, ohne Zeit (laufende Schicht + außerhalb), fehlt → egal", () => {
  const running = { start: T0 + 47 * H, segments: [{ start: T0 + 47 * H, activity: "Arbeiten" }] };
  const inRun = { ts: T0 + 47.5 * H };
  assert.equal(M.classify(inRun, ctx({ running, settings: { mode: { privat: true } } })).reason, "privat");
  assert.equal(M.classify({ ts: T0 + 3 * H }, ctx({ settings: { mode: { privat: true } } })).reason, "work", "abgeschlossener Eintrag bleibt Arbeit");
  assert.equal(M.classify({ ts: T0 + 30 * H, ...move(FIRMA, 50) }, ctx({ rule: "work_or_place", settings: { mode: { privat: true } } })).reason, "privat");
  const win = { mode: { privat: { on: true, since: T0 + 2 * H, until: T0 + 3 * H } } };
  assert.equal(M.classify({ ts: T0 + 2.5 * H }, ctx({ settings: win })).reason, "privat");
  assert.equal(M.classify({ ts: T0 + 4 * H }, ctx({ settings: win })).reason, "work");
  assert.equal(M.classify(inRun, ctx({ running, settings: { mode: { privat: { on: false } } } })).reason, "work");
  assert.equal(M.classify(inRun, ctx({ running, settings: { mode: {} } })).reason, "work");
});

test("Privatfahrt: Abschnitt private/privateTrip, Eintrag privateTrip", () => {
  const e = [{ id: "e2", start: T0, end: T0 + 4 * H, segments: [
    { start: T0, end: T0 + H, activity: "Autofahren", private: true },
    { start: T0 + H, end: T0 + 4 * H, activity: "Arbeiten" }] }];
  assert.equal(M.classify({ ts: T0 + 0.5 * H }, ctx({ entries: e })).reason, "privat");
  assert.equal(M.classify({ ts: T0 + 2 * H }, ctx({ entries: e })).reason, "work");
  const e3 = [{ id: "e3", start: T0, end: T0 + H, privateTrip: true }];
  assert.equal(M.classify({ ts: T0 + 0.5 * H }, ctx({ entries: e3 })).reason, "privat");
  const running = { start: T0 + 47 * H, privateTrip: true };
  assert.equal(M.classify({ ts: T0 + 47.5 * H }, ctx({ running })).reason, "privat");
});

test("Fingerabdrücke: Web (Größe+Zeit+Hash), nativ (_ID+DATE_TAKEN), Doppelte", () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 5]);
  assert.equal(M.hashBytes(a), M.hashBytes(new Uint8Array([1, 2, 3, 4])));
  assert.notEqual(M.hashBytes(a), M.hashBytes(b));
  assert.equal(M.hashBytes(new Uint8Array()), "811c9dc5");
  const f1 = M.fpWeb({ size: 1000, ts: T0, head: a });
  assert.match(f1, /^w:1000:\d+:[0-9a-f]{8}$/);
  assert.notEqual(f1, M.fpWeb({ size: 1000, ts: T0 + 1000, head: a }), "andere Aufnahmezeit");
  assert.notEqual(f1, M.fpWeb({ size: 1001, ts: T0, head: a }), "andere Größe");
  assert.equal(M.fpNative(42, T0), `n:42:${T0}`);
  assert.equal(M.importDocId("n:4/2:1"), "n:4_2:1");
  const known = M.knownSet([{ fp: f1 }, { fp: "n:1:1" }, null, {}]);
  const { fresh, dupes } = M.splitDupes([{ fp: f1 }, { fp: "n:2:2" }, { fp: "n:2:2" }, { fp: "n:1:1" }], known);
  assert.deepEqual(fresh.map((x) => x.fp), ["n:2:2"]);
  assert.equal(dupes.length, 3, "bekannt + doppelt in derselben Auswahl");
});

test("App-Regel (nativeConfig): letzte Tage, laufend, privat, Orte", () => {
  const now = T0 + 10 * H;
  const old = { id: "x", start: T0 - 10 * 24 * H, end: T0 - 10 * 24 * H + H };
  const e = [...entries, old, { id: "p", start: T0 + 8.5 * H, end: T0 + 9 * H, privateTrip: true }];
  const c = M.nativeConfig({ entries: e, running: { start: T0 + 9.5 * H }, places: [FIRMA, { id: "x" }], settings: { mediaImport: { rule: "work_or_place" } }, now });
  assert.deepEqual(c.work, [[T0, T0 + 8 * H]], "alter Eintrag und Urlaub weg, Privatfahrt nicht als Arbeit");
  assert.deepEqual(c.privat, [[T0 + 8.5 * H, T0 + 9 * H]]);
  assert.equal(c.running, T0 + 9.5 * H);
  assert.equal(c.rule, "work_or_place");
  assert.deepEqual(c.places, [{ lat: FIRMA.lat, lng: FIRMA.lng, r: 150 }]);
  const c2 = M.nativeConfig({ entries, running: { start: T0 + 9.5 * H }, settings: { mode: { privat: true } }, now });
  assert.equal(c2.running, 0); assert.equal(c2.privatAll, true);
});
