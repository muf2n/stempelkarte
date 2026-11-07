// node --test test/weather-core.test.mjs – 🌦️ Wetter: URL (gerundet), Antwort lesen, Warnungen, Cache, Einstellungen.
import test from "node:test";
import assert from "node:assert/strict";
import * as W from "../js/weather-core.js";

const SAMPLE = {
  current: { temperature_2m: 7.4, weather_code: 2, wind_speed_10m: 12 },
  daily: {
    time: ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"],
    weather_code: [2, 63, 71, 0],
    temperature_2m_max: [9.6, 8, 2, 5],
    temperature_2m_min: [3.1, 4, -2.4, -1],
    precipitation_sum: [0, 24.5, 3, 0],
    precipitation_probability_max: [10, 95, 60, 0],
    wind_gusts_10m_max: [30, 72, 40, 20],
  },
};

test("URL: Koordinaten auf 2 Nachkommastellen, 4 Tage, nur api.open-meteo.com", () => {
  const u = new URL(W.forecastUrl(47.070712, 15.439504));
  assert.equal(u.origin, "https://api.open-meteo.com");
  assert.equal(u.searchParams.get("latitude"), "47.07");
  assert.equal(u.searchParams.get("longitude"), "15.44");
  assert.equal(u.searchParams.get("forecast_days"), "4");
  assert.equal(W.forecastUrl(NaN, 1), null);
  assert.equal(W.forecastUrl(0, 0), null);
  assert.equal(W.cacheKey(47.071, 15.4449), "47.07,15.44");
});

test("parse + Warnungen (Wind, Starkregen, Frost)", () => {
  const p = W.parse(SAMPLE);
  assert.equal(p.days.length, 4);
  assert.equal(p.current.temp, 7.4);
  assert.equal(p.days[1].text, "Regen");
  assert.deepEqual(p.days[1].warnings.map((w) => w.id), ["wind", "rain"]);
  assert.deepEqual(p.days[2].warnings.map((w) => w.id), ["frost"]);
  const h = W.hints(p, "2026-11-06");
  assert.deepEqual(h.map((x) => [x.id, x.when]), [["wind", "Morgen"], ["rain", "Morgen"], ["frost", "So"]]);
  assert.equal(W.parse({}), null);
  assert.equal(W.parse({ daily: { time: [] } }), null);
});

test("Cache 1 h, Einstellungen bereinigt", () => {
  const now = 1_000_000_000_000;
  assert.equal(W.cacheFresh({ key: "a", at: now - 10 * 60e3, data: {} }, "a", now), true);
  assert.equal(W.cacheFresh({ key: "a", at: now - 61 * 60e3, data: {} }, "a", now), false);
  assert.equal(W.cacheFresh({ key: "b", at: now, data: {} }, "a", now), false);
  assert.deepEqual(W.normPrefs({ src: "geo", lat: 47.0789, lon: 15.4321 }), { src: "geo", city: "", lat: 47.08, lon: 15.43 });
  assert.equal(W.normPrefs({ src: "city", city: "Graz" }).src, "", "ohne Koordinaten nicht gültig");
  assert.equal(W.normPrefs({ src: "off" }).src, "off");
  assert.equal(W.normPrefs({ src: "hack" }).src, "");
  assert.deepEqual(W.codeInfo(95), ["⛈️", "Gewitter"]);
  assert.equal(W.tempText(-0.4), "-0°".replace("-0", "0"));
});
