// Update 10 – 🌦️ Wetter im Heute-Überblick: reine Logik ohne DOM (Node-testbar, test/weather-core.test.mjs).
// Quelle: Open-Meteo (https://api.open-meteo.com, ohne Schlüssel). Ort bleibt NUR auf dem Gerät und wird vor der
// Anfrage auf 2 Nachkommastellen (≈ 1 km) gerundet. Zwischenspeicher 1 Stunde, offline gilt der letzte Stand.

export const API = "https://api.open-meteo.com/v1/forecast";
export const CACHE_MS = 3600e3;
export const DAYS = 4; // heute + 3
export const WIND_WARN_KMH = 60;  // Böen
export const RAIN_WARN_MM = 20;   // Tagessumme
export const FROST_C = 0;

export const round2 = (x) => Math.round(Number(x) * 100) / 100;
export function validCoords(lat, lon) {
  const a = Number(lat), b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

/** Anfrage-URL (Koordinaten gerundet). */
export function forecastUrl(lat, lon) {
  if (!validCoords(lat, lon)) return null;
  const q = new URLSearchParams({
    latitude: round2(lat).toFixed(2), longitude: round2(lon).toFixed(2),
    current: "temperature_2m,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max",
    timezone: "auto", forecast_days: String(DAYS),
  });
  return `${API}?${q}`;
}
export const cacheKey = (lat, lon) => `${round2(lat).toFixed(2)},${round2(lon).toFixed(2)}`;
export const cacheFresh = (c, key, now = Date.now()) => !!(c && c.key === key && c.data && now - Number(c.at) < CACHE_MS && now >= Number(c.at));

/** WMO-Wettercode → [Emoji, Text] */
export function codeInfo(code) {
  const c = Number(code);
  if (c === 0) return ["☀️", "Sonnig"];
  if (c === 1) return ["🌤️", "Heiter"];
  if (c === 2) return ["⛅", "Teils bewölkt"];
  if (c === 3) return ["☁️", "Bewölkt"];
  if (c === 45 || c === 48) return ["🌫️", "Nebel"];
  if (c >= 51 && c <= 57) return ["🌦️", "Nieselregen"];
  if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return ["🌧️", c >= 65 || c === 82 ? "Starker Regen" : "Regen"];
  if (c === 66 || c === 67) return ["🧊", "Eisregen"];
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return ["🌨️", "Schnee"];
  if (c >= 95) return ["⛈️", "Gewitter"];
  return ["🌡️", "Wetter"];
}

const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Open-Meteo-Antwort → { current, days: [{ date, code, emoji, text, max, min, rain, rainProb, gust, warnings }] } oder null. */
export function parse(json) {
  if (!json || typeof json !== "object" || !json.daily || !Array.isArray(json.daily.time)) return null;
  const d = json.daily;
  const days = d.time.slice(0, DAYS).map((date, i) => {
    const code = num(d.weather_code && d.weather_code[i]);
    const [emoji, text] = codeInfo(code);
    const day = {
      date: String(date), code, emoji, text,
      max: num(d.temperature_2m_max && d.temperature_2m_max[i]),
      min: num(d.temperature_2m_min && d.temperature_2m_min[i]),
      rain: num(d.precipitation_sum && d.precipitation_sum[i]),
      rainProb: num(d.precipitation_probability_max && d.precipitation_probability_max[i]),
      gust: num(d.wind_gusts_10m_max && d.wind_gusts_10m_max[i]),
    };
    day.warnings = warningsOf(day);
    return day;
  }).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date));
  if (!days.length) return null;
  const c = json.current || {};
  const cc = num(c.weather_code);
  const current = num(c.temperature_2m) == null ? null : { temp: num(c.temperature_2m), code: cc, emoji: codeInfo(cc)[0], text: codeInfo(cc)[1], wind: num(c.wind_speed_10m) };
  return { current, days };
}

/** Warnungen eines Tages → [{ id, e, t }] */
export function warningsOf(day) {
  const out = [];
  if (day.gust != null && day.gust >= WIND_WARN_KMH) out.push({ id: "wind", e: "💨", t: `Starker Wind (Böen bis ${Math.round(day.gust)} km/h)` });
  if (day.rain != null && day.rain >= RAIN_WARN_MM) out.push({ id: "rain", e: "🌧️", t: `Starkregen (${Math.round(day.rain)} mm)` });
  if (day.min != null && day.min <= FROST_C) out.push({ id: "frost", e: "🥶", t: `Frost (bis ${Math.round(day.min)} °C)` });
  return out;
}

/** Hinweise für die nächsten Tage (je Art nur der früheste), mit Tagesname. */
export function hints(parsed, todayKey) {
  const out = [];
  const seen = new Set();
  for (const d of (parsed && parsed.days) || []) {
    for (const w of d.warnings) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      out.push({ ...w, date: d.date, when: dayName(d.date, todayKey) });
    }
  }
  return out;
}

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function dayName(k, todayKey) {
  const [y, m, d] = k.split("-").map(Number);
  const [ty, tm, td] = String(todayKey).split("-").map(Number);
  const diff = Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  return WD[new Date(y, m - 1, d).getDay()];
}

export const tempText = (t) => (t == null ? "–" : `${Math.round(t)}°`);

/** Einstellungen (localStorage) bereinigen: { src: ""|"geo"|"city"|"off", city, lat, lon } */
export function normPrefs(x) {
  const src = ["geo", "city", "off"].includes(x && x.src) ? x.src : "";
  const ok = validCoords(x && x.lat, x && x.lon);
  return { src: (src === "geo" || src === "city") && !ok ? "" : src, city: String((x && x.city) || "").trim().slice(0, 60), lat: ok ? round2(x.lat) : null, lon: ok ? round2(x.lon) : null };
}
