// Update 10 – 🗺️ Karte & Route: reine Logik (OSRM lesen, deutsche Anweisungen, Formate, Links, Hash, Zuletzt).
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../js/alltag/route-core.js";

const A = { lat: 47.0707, lng: 15.4395 }, B = { lat: 47.0667, lng: 15.4500 };

test("osrmUrl: FOSSGIS-Server je Modus, lng,lat-Reihenfolge, Parameter", () => {
  assert.equal(R.osrmUrl("car", A, B), "https://routing.openstreetmap.de/routed-car/route/v1/driving/15.4395,47.0707;15.45,47.0667?overview=full&geometries=geojson&steps=true");
  assert.match(R.osrmUrl("foot", A, B), /\/routed-foot\/route\/v1\/foot\//);
  assert.match(R.osrmUrl("bike", A, B), /\/routed-bike\/route\/v1\/bike\//);
  assert.equal(R.osrmUrl("transit", A, B), "");
  assert.equal(R.osrmUrl("car", A, { lat: 0, lng: 0 }), "");
});

test("instruction: deutsche Sätze für die wichtigsten Manöver", () => {
  const s = (type, modifier, extra = {}) => R.instruction({ maneuver: { type, modifier, ...(extra.mv || {}) }, name: extra.name || "", ref: extra.ref || "", destinations: extra.destinations || "" }, extra.mode);
  assert.equal(s("turn", "left", { name: "Hauptstraße" }), "Links abbiegen auf Hauptstraße");
  assert.equal(s("turn", "slight right", { name: "Ringstraße" }), "Leicht rechts abbiegen auf Ringstraße");
  assert.equal(s("turn", "sharp left"), "Scharf links abbiegen");
  assert.equal(s("turn", "uturn"), "Wenden");
  assert.equal(s("roundabout", "right", { name: "Bahnhofstraße", mv: { exit: 2 } }), "Im Kreisverkehr die 2. Ausfahrt nehmen auf Bahnhofstraße");
  assert.equal(s("rotary", "", { mv: { exit: 3 } }), "Im Kreisverkehr die 3. Ausfahrt nehmen");
  assert.equal(s("exit roundabout", "right", { name: "B17" }), "Kreisverkehr verlassen auf B17");
  assert.equal(s("depart", "", { name: "Lendplatz", mv: { bearing_after: 92 } }), "Losfahren Richtung Osten auf Lendplatz");
  assert.equal(s("depart", "", { mv: { bearing_after: 0 }, mode: "foot" }), "Losgehen Richtung Norden");
  assert.equal(s("depart", "", { mode: "bike" }), "Losradeln");
  assert.equal(s("arrive", "right"), "Ziel erreicht – es liegt rechts 🏁");
  assert.equal(s("arrive", ""), "Ziel erreicht 🏁");
  assert.equal(s("new name", "straight", { name: "Annenstraße" }), "Weiter auf Annenstraße");
  assert.equal(s("continue", "slight left", { name: "A2" }), "Leicht links halten auf A2");
  assert.equal(s("off ramp", "slight right", { destinations: "Graz-West, Zentrum" }), "Ausfahrt rechts nehmen Richtung Graz-West");
  assert.equal(s("on ramp", "right", { ref: "A2" }), "Auffahrt rechts nehmen auf A2");
  assert.equal(s("fork", "left", { name: "A9" }), "An der Gabelung links halten auf A9");
  assert.equal(s("end of road", "right", { name: "Triester Straße" }), "Am Ende der Straße rechts abbiegen auf Triester Straße");
  assert.equal(s("merge", "left", { name: "A2" }), "Links einfädeln auf A2");
  assert.equal(s("roundabout turn", "left"), "Im Kreisverkehr links abbiegen");
  assert.equal(s("notification", ""), "Weiter der Route folgen");
  assert.equal(R.roadName({ name: "Grazer Straße", ref: "B67" }), "Grazer Straße (B67)");
  assert.equal(R.roadName({ name: "", ref: "A2;E59" }), "A2");
});

test("parseOsrm: Geometrie [lat,lng], Schritte deutsch, Fehlercodes", () => {
  const json = { code: "Ok", routes: [{ distance: 1834.2, duration: 312.5, geometry: { type: "LineString", coordinates: [[15.4395, 47.0707], [15.445, 47.069], [15.45, 47.0667]] },
    legs: [{ steps: [
      { distance: 400, duration: 60, name: "Lendplatz", maneuver: { type: "depart", bearing_after: 90, location: [15.4395, 47.0707] } },
      { distance: 0, duration: 0, name: "Mariahilferstraße", maneuver: { type: "new name", modifier: "straight", location: [15.44, 47.07] } },
      { distance: 1400, duration: 250, name: "Hauptplatz", maneuver: { type: "turn", modifier: "left", location: [15.445, 47.069] } },
      { distance: 0, duration: 0, name: "", maneuver: { type: "arrive", modifier: "left", location: [15.45, 47.0667] } },
    ] }] }] };
  const r = R.parseOsrm(json, "car");
  assert.equal(r.ok, true);
  assert.equal(r.distance, 1834.2);
  assert.deepEqual(r.coords[0], [47.0707, 15.4395]);
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[2].text, "Links abbiegen auf Hauptplatz");
  assert.equal(r.steps[2].icon, "⬅️");
  assert.deepEqual(r.steps[2].loc, [47.069, 15.445]);
  assert.equal(r.steps[3].icon, "🏁");
  assert.equal(R.parseOsrm({ code: "NoRoute", routes: [] }).ok, false);
  assert.match(R.parseOsrm({ code: "NoRoute" }).error, /Keine Route/);
  assert.equal(R.parseOsrm(null).ok, false);
});

test("Formate: Dauer, Strecke, Ankunft", () => {
  assert.equal(R.fmtDuration(20), "1 Min");
  assert.equal(R.fmtDuration(14 * 60), "14 Min");
  assert.equal(R.fmtDuration(3600), "1 Std");
  assert.equal(R.fmtDuration(72 * 60), "1 Std 12 Min");
  assert.equal(R.fmtDuration(26 * 3600), "1 T 2 Std");
  assert.equal(R.fmtDurationShort(65 * 60), "1:05 h");
  assert.equal(R.fmtDurationShort(9 * 60), "9 Min");
  assert.equal(R.fmtDistance(12), "12 m");
  assert.equal(R.fmtDistance(847), "850 m");
  assert.equal(R.fmtDistance(1834), "1,8 km");
  assert.equal(R.fmtDistance(23456), "23 km");
  const now = new Date(2026, 10, 10, 13, 20, 10).getTime();
  assert.equal(R.arrivalText(now, 22 * 60), "Ankunft ca. 13:42");
  assert.equal(R.arrivalText(new Date(2026, 10, 10, 23, 0).getTime(), 3 * 3600), "Ankunft ca. 11.11. 02:00");
  assert.equal(R.arrivalText(now, NaN), "");
});

test("Google-Maps-Links: Öffis + Navigation", () => {
  assert.equal(R.gmapsDirUrl({ from: A, to: B, mode: "transit" }), "https://www.google.com/maps/dir/?api=1&origin=47.0707,15.4395&destination=47.0667,15.45&travelmode=transit");
  assert.equal(R.gmapsDirUrl({ to: B, mode: "car", navigate: true }), "https://www.google.com/maps/dir/?api=1&destination=47.0667,15.45&travelmode=driving&dir_action=navigate");
  assert.match(R.gmapsDirUrl({ to: B, mode: "foot", navigate: true }), /travelmode=walking&dir_action=navigate$/);
  assert.match(R.gmapsDirUrl({ to: B, mode: "bike", navigate: true }), /travelmode=bicycling&dir_action=navigate$/);
  assert.equal(R.gmapsDirUrl({ to: null }), "");
});

test("cacheKey: ~10 m gerundet, je Modus getrennt", () => {
  assert.equal(R.cacheKey("car", A, B), R.cacheKey("car", { lat: 47.07071, lng: 15.43951 }, B));
  assert.notEqual(R.cacheKey("car", A, B), R.cacheKey("foot", A, B));
  assert.notEqual(R.cacheKey("car", A, B), R.cacheKey("car", { lat: 47.0717, lng: 15.4395 }, B));
});

test("Hash: Baustelle, Text, Koordinaten – hin und zurück", () => {
  assert.deepEqual(R.parseKarteHash("#alltag/karte?place=p1"), { place: "p1", q: "", to: null, name: "" });
  assert.equal(R.parseKarteHash("#alltag/karte?q=Hauptplatz%201%2C%20Graz").q, "Hauptplatz 1, Graz");
  const h = R.karteHash({ to: B, name: "Kunde Huber" });
  assert.equal(h, "#alltag/karte?to=47.0667%2C15.45&name=Kunde+Huber");
  assert.deepEqual(R.parseKarteHash(h).to, B);
  assert.equal(R.parseKarteHash("#alltag/geld?q=x").q, "");
  assert.equal(R.karteHash({ q: " Wien " }), "#alltag/karte?q=Wien");
  assert.equal(R.karteHash({}), "#alltag/karte");
});

test("addRecent: vorne, ohne Doppelte, max 10", () => {
  let l = [];
  for (let i = 0; i < 12; i++) l = R.addRecent(l, { name: "Ziel " + i, lat: 47 + i / 100, lng: 15 });
  assert.equal(l.length, 10);
  assert.equal(l[0].name, "Ziel 11");
  l = R.addRecent(l, { name: "Ziel 5 neu", lat: 47.05, lng: 15 });
  assert.equal(l[0].name, "Ziel 5 neu");
  assert.equal(l.filter((x) => x.lat === 47.05).length, 1);
  assert.deepEqual(R.addRecent(l, { name: "kaputt" }).length, 10);
});

test("Nominatim: URL + Treffer lesen", () => {
  const u = R.nominatimUrl("Hauptplatz Graz", A);
  assert.match(u, /^https:\/\/nominatim\.openstreetmap\.org\/search\?format=jsonv2/);
  assert.match(u, /q=Hauptplatz%20Graz/);
  assert.match(u, /viewbox=/);
  const r = R.parseNominatim([
    { lat: "47.0707", lon: "15.4386", name: "Hauptplatz", display_name: "Hauptplatz, Innere Stadt, Graz, Steiermark, 8010, Österreich", address: { road: "Hauptplatz", postcode: "8010", city: "Graz" } },
    { lat: "47.07071", lon: "15.43861", name: "Hauptplatz", display_name: "doppelt" },
    { lat: "x", lon: "1" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Hauptplatz");
  assert.equal(r[0].sub, "8010 Graz");
});

test("nextStepIndex: nächster Abbiegepunkt, erreicht → weiter", () => {
  const steps = [{ loc: [47.0707, 15.4395] }, { loc: [47.0700, 15.4420] }, { loc: [47.0690, 15.4450] }];
  assert.equal(R.nextStepIndex(steps, { lat: 47.07065, lng: 15.4396 }, 0), 1);
  assert.equal(R.nextStepIndex(steps, { lat: 47.0698, lng: 15.4430 }, 1), 1);
  assert.equal(R.nextStepIndex(steps, { lat: 47.0690, lng: 15.4450 }, 1), 2);
  assert.ok(R.matches({ name: "Baustelle Müller", sub: "Grazer Straße 5" }, "muller graz"));
  assert.ok(!R.matches({ name: "Werkstatt" }, "graz"));
});
