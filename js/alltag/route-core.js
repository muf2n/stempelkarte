// Update 10 – Alltag › 🗺️ Karte & Route: reine Logik ohne DOM (Node-testbar).
// OSRM-Antworten (FOSSGIS routing.openstreetmap.de) lesen, deutsche Abbiege-Texte, Dauer/Strecke/Ankunft formatieren,
// Links zu Google Maps (Öffis + Navigation), Cache-Schlüssel, „Zuletzt“-Liste, Hash-Parameter und Nominatim-Treffer.

export const MODES = Object.freeze([
  { id: "car", e: "🚗", l: "Auto", osrm: "routed-car", profile: "driving", gm: "driving" },
  { id: "foot", e: "🚶", l: "Zu Fuß", osrm: "routed-foot", profile: "foot", gm: "walking" },
  { id: "bike", e: "🚲", l: "Rad", osrm: "routed-bike", profile: "bike", gm: "bicycling" },
  { id: "transit", e: "🚆", l: "Öffis", osrm: null, profile: null, gm: "transit" },
]);
export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];
export const ROUTED_MODES = MODES.filter((m) => m.osrm).map((m) => m.id);
export const OSRM_BASE = "https://routing.openstreetmap.de";
export const RECENT_KEY = "sk-karte-recent";
export const GEO_KEY = "sk-karte-geo";
export const RECENT_MAX = 10;

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
export function validPoint(p) {
  if (!p) return false;
  const lat = num(p.lat), lng = num(p.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}
const r6 = (x) => Math.round(num(x) * 1e6) / 1e6;
const r4 = (x) => (Math.round(num(x) * 1e4) / 1e4).toFixed(4);

/** OSRM-Abfrage-URL (lng,lat-Reihenfolge!). */
export function osrmUrl(modeId, from, to) {
  const m = modeById(modeId);
  if (!m.osrm || !validPoint(from) || !validPoint(to)) return "";
  return `${OSRM_BASE}/${m.osrm}/route/v1/${m.profile}/${r6(from.lng)},${r6(from.lat)};${r6(to.lng)},${r6(to.lat)}` +
    "?overview=full&geometries=geojson&steps=true";
}

/** Cache-Schlüssel – auf ~10 m gerundet, damit kleines GPS-Zittern keine neue Abfrage auslöst. */
export function cacheKey(modeId, from, to) {
  return `${modeId}|${r4(from && from.lat)},${r4(from && from.lng)}|${r4(to && to.lat)},${r4(to && to.lng)}`;
}

/* ---------- Deutsche Anweisungen ---------- */

const DIR = {
  uturn: "wenden", "sharp right": "scharf rechts", right: "rechts", "slight right": "leicht rechts",
  straight: "geradeaus", "slight left": "leicht links", left: "links", "sharp left": "scharf links",
};
const ICON = {
  uturn: "↩️", "sharp right": "↘️", right: "➡️", "slight right": "↗️", straight: "⬆️", "slight left": "↖️", left: "⬅️", "sharp left": "↙️",
};
const COMPASS = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function compass(bearing) {
  const b = num(bearing);
  if (!Number.isFinite(b)) return "";
  return COMPASS[Math.round((((b % 360) + 360) % 360) / 45) % 8];
}

/** Straßenname für die Anzeige: „Hauptstraße (B17)“, nur Nummer oder leer. */
export function roadName(step) {
  const n = String((step && step.name) || "").trim();
  const ref = String((step && step.ref) || "").trim().split(";")[0].trim();
  if (n && ref && !n.includes(ref)) return `${n} (${ref})`;
  return n || ref;
}

function turnPhrase(mod) {
  if (mod === "uturn") return "Wenden";
  if (mod === "straight" || !mod) return "Geradeaus weiter";
  return `${cap(DIR[mod] || mod)} abbiegen`;
}

/**
 * OSRM-Schritt → deutscher Satz, z. B. „Links abbiegen auf Hauptstraße“, „Im Kreisverkehr die 2. Ausfahrt nehmen“.
 * step = { maneuver: { type, modifier, exit, bearing_after }, name, ref, destinations, rotary_name }
 */
export function instruction(step, modeId = "car") {
  const mv = (step && step.maneuver) || {};
  const type = String(mv.type || "");
  const mod = String(mv.modifier || "");
  const name = roadName(step);
  const on = name ? ` auf ${name}` : "";
  const dest = String((step && step.destinations) || "").split(",")[0].trim();
  const toward = dest ? ` Richtung ${dest}` : "";
  const exitN = Number.isInteger(mv.exit) && mv.exit > 0 ? mv.exit : 0;
  const side = mod.includes("left") ? "links" : mod.includes("right") ? "rechts" : "";
  switch (type) {
    case "depart": {
      const c = compass(mv.bearing_after);
      const verb = modeId === "foot" ? "Losgehen" : modeId === "bike" ? "Losradeln" : "Losfahren";
      return `${verb}${c ? " Richtung " + c : ""}${on}`;
    }
    case "arrive":
      return side ? `Ziel erreicht – es liegt ${side} 🏁` : "Ziel erreicht 🏁";
    case "turn":
      return turnPhrase(mod) + on;
    case "new name":
      return `Weiter${on || " geradeaus"}`;
    case "continue":
      if (mod === "uturn") return "Wenden" + on;
      if (!mod || mod === "straight") return `Geradeaus weiter${on}`;
      return `${cap(DIR[mod])} halten${on}`;
    case "merge":
      return `${side ? cap(side) + " e" : "E"}infädeln${on}`;
    case "on ramp":
      return `Auffahrt${side ? " " + side : ""} nehmen${on}${toward}`;
    case "off ramp":
      return `Ausfahrt${side ? " " + side : ""} nehmen${toward || on}`;
    case "fork":
      return `An der Gabelung ${side || "geradeaus"} halten${on}${toward}`;
    case "end of road":
      return `Am Ende der Straße ${side || "weiter"} abbiegen${on}`.replace("weiter abbiegen", "weiterfahren");
    case "use lane":
      return `${mod && mod !== "straight" ? cap(DIR[mod]) + " einordnen" : "Spur halten, geradeaus"}${on}`;
    case "roundabout":
    case "rotary": {
      const rn = type === "rotary" && step && step.rotary_name ? ` „${step.rotary_name}“` : "";
      return exitN ? `Im Kreisverkehr${rn} die ${exitN}. Ausfahrt nehmen${on}` : `In den Kreisverkehr${rn} fahren${on}`;
    }
    case "roundabout turn":
      return `Im Kreisverkehr ${DIR[mod] || "weiter"}${mod === "straight" ? " weiter" : mod && mod !== "uturn" ? " abbiegen" : ""}${on}`;
    case "exit roundabout":
    case "exit rotary":
      return `Kreisverkehr verlassen${on}`;
    default:
      return `Weiter${on || " der Route folgen"}`;
  }
}

export function stepIcon(step) {
  const mv = (step && step.maneuver) || {};
  if (mv.type === "depart") return "🟢";
  if (mv.type === "arrive") return "🏁";
  if (/roundabout|rotary/.test(mv.type || "") && mv.type !== "roundabout turn") return "🔄";
  return ICON[mv.modifier] || "⬆️";
}

/** OSRM-JSON → { ok, distance (m), duration (s), coords [[lat,lng]], steps [{ text, icon, distance, duration, loc [lat,lng] }] } */
export function parseOsrm(json, modeId = "car") {
  if (!json || typeof json !== "object") return { ok: false, error: "Keine Antwort vom Routenserver." };
  if (json.code !== "Ok" || !Array.isArray(json.routes) || !json.routes.length) {
    const msg = json.code === "NoRoute" ? "Keine Route gefunden – ist das Ziel erreichbar? 🤔"
      : json.code === "NoSegment" ? "Start oder Ziel liegt zu weit weg von einer Straße/einem Weg."
      : "Route konnte nicht berechnet werden.";
    return { ok: false, error: msg, code: json.code || "" };
  }
  const r = json.routes[0];
  const g = r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : [];
  const coords = g.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[1], c[0]]);
  const steps = [];
  for (const leg of Array.isArray(r.legs) ? r.legs : []) {
    for (const st of Array.isArray(leg.steps) ? leg.steps : []) {
      const loc = st.maneuver && Array.isArray(st.maneuver.location) ? [st.maneuver.location[1], st.maneuver.location[0]] : null;
      steps.push({ text: instruction(st, modeId), icon: stepIcon(st), distance: Math.max(0, num(st.distance) || 0), duration: Math.max(0, num(st.duration) || 0), loc, type: (st.maneuver && st.maneuver.type) || "" });
    }
  }
  // „Weiter auf …“ ohne Strecke dazwischen (gleiche Straße) zusammenlegen
  const merged = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    if (prev && s.type === "new name" && prev.distance < 1 && prev.type !== "depart") { merged[merged.length - 1] = { ...s }; continue; }
    merged.push(s);
  }
  return { ok: true, distance: Math.max(0, num(r.distance) || 0), duration: Math.max(0, num(r.duration) || 0), coords, steps: merged };
}

/* ---------- Formatieren ---------- */

export function fmtDuration(sec) {
  const s = num(sec);
  if (!Number.isFinite(s) || s < 0) return "–";
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 24) { const d = Math.floor(h / 24), hh = h % 24; return `${d} T${hh ? ` ${hh} Std` : ""}`; }
  return m ? `${h} Std ${m} Min` : `${h} Std`;
}
/** Kurzform für die Reiter: „12 Min“, „1:05 h“. */
export function fmtDurationShort(sec) {
  const s = num(sec);
  if (!Number.isFinite(s) || s < 0) return "–";
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} Min`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${String(m).padStart(2, "0")} h`;
}

export function fmtDistance(m) {
  const d = num(m);
  if (!Number.isFinite(d) || d < 0) return "–";
  if (d < 50) return `${Math.round(d)} m`;
  if (d < 1000) return `${Math.round(d / 10) * 10} m`;
  const km = d / 1000;
  return `${(km < 10 ? km.toFixed(1) : String(Math.round(km))).replace(".", ",")} km`;
}

const pad = (n) => String(n).padStart(2, "0");
/** „Ankunft ca. 13:42“ (bei > 1 Tag mit Datum). */
export function arrivalText(nowMs, sec) {
  const s = num(sec);
  if (!Number.isFinite(s) || s < 0 || !Number.isFinite(num(nowMs))) return "";
  const now = new Date(num(nowMs));
  const d = new Date(num(nowMs) + Math.round(s / 60) * 60000);
  const sameDay = d.toDateString() === now.toDateString();
  const day = sameDay ? "" : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. `;
  return `Ankunft ca. ${day}${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- Links nach außen ---------- */

const ll = (p) => `${r6(p.lat)},${r6(p.lng)}`;

/** Google Maps Routen-Link (offizielles „Maps URLs“-Format). navigate → dir_action=navigate (startet Navigation). */
export function gmapsDirUrl({ from = null, to, mode = "car", navigate = false } = {}) {
  if (!validPoint(to)) return "";
  const m = modeById(mode);
  let u = "https://www.google.com/maps/dir/?api=1";
  if (validPoint(from)) u += `&origin=${ll(from)}`;
  u += `&destination=${ll(to)}&travelmode=${m.gm}`;
  if (navigate && m.id !== "transit") u += "&dir_action=navigate";
  return u;
}
/** ÖBB Scotty Web-Fahrplan (ohne Vorbelegung – es gibt kein dokumentiertes Deep-Link-Format). */
export const SCOTTY_URL = "https://fahrplan.oebb.at/webapp/";

/* ---------- Hash ---------- */

/** #alltag/karte?place=<id> | ?q=<Text> | ?to=lat,lng&name=… → { place, q, to, name } */
export function parseKarteHash(hash) {
  const h = String(hash || "");
  const i = h.indexOf("?");
  const out = { place: "", q: "", to: null, name: "" };
  if (!/^#?alltag\/karte\b/.test(h) || i < 0) return out;
  let sp;
  try { sp = new URLSearchParams(h.slice(i + 1)); } catch { return out; }
  out.place = String(sp.get("place") || "").slice(0, 80);
  out.q = String(sp.get("q") || "").trim().slice(0, 200);
  out.name = String(sp.get("name") || "").trim().slice(0, 120);
  const to = String(sp.get("to") || "").split(",");
  if (to.length === 2) { const p = { lat: Number(to[0]), lng: Number(to[1]) }; if (validPoint(p)) out.to = p; }
  return out;
}
export function karteHash({ place = "", q = "", to = null, name = "" } = {}) {
  const sp = new URLSearchParams();
  if (place) sp.set("place", place);
  else if (validPoint(to)) { sp.set("to", ll(to)); if (name) sp.set("name", name); }
  else if (String(q || "").trim()) { sp.set("q", String(q).trim()); if (name) sp.set("name", name); }
  const s = sp.toString();
  return "#alltag/karte" + (s ? "?" + s : "");
}

/* ---------- Ziele ---------- */

/** Ziel normalisieren → { name, sub, lat, lng } | null */
export function normDest(d) {
  if (!d || !validPoint(d)) return null;
  return { name: String(d.name || "Ziel").trim().slice(0, 120) || "Ziel", sub: String(d.sub || "").trim().slice(0, 200), lat: r6(d.lat), lng: r6(d.lng) };
}
const sameSpot = (a, b) => Math.abs(a.lat - b.lat) < 2e-4 && Math.abs(a.lng - b.lng) < 2e-4;
/** Neues Ziel vorne einreihen (ohne Doppelte), max. RECENT_MAX. */
export function addRecent(list, dest, max = RECENT_MAX) {
  const d = normDest(dest);
  const arr = (Array.isArray(list) ? list : []).map(normDest).filter(Boolean);
  if (!d) return arr.slice(0, max);
  return [d, ...arr.filter((x) => !sameSpot(x, d))].slice(0, max);
}

/** Nominatim-Such-URL (jsonv2, deutsch, Österreich bevorzugt; mit Standort → viewbox ohne Begrenzung). */
export function nominatimUrl(q, near = null, limit = 6) {
  let u = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=de" +
    `&limit=${Math.max(1, Math.min(10, limit))}&countrycodes=at,de,ch,it,si,hu,sk,cz&q=${encodeURIComponent(String(q || "").trim())}`;
  if (validPoint(near)) {
    const d = 0.6;
    u += `&viewbox=${(near.lng - d).toFixed(3)},${(near.lat + d).toFixed(3)},${(near.lng + d).toFixed(3)},${(near.lat - d).toFixed(3)}`;
  }
  return u;
}
/** Nominatim-Treffer → [{ name, sub, lat, lng }] */
export function parseNominatim(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    const p = { lat: Number(x && x.lat), lng: Number(x && x.lon) };
    if (!validPoint(p)) continue;
    const a = (x && x.address) || {};
    const street = [a.road || a.pedestrian || a.footway || "", a.house_number || ""].join(" ").trim();
    const town = a.city || a.town || a.village || a.municipality || "";
    const disp = String((x && x.display_name) || "").split(",").map((s) => s.trim()).filter(Boolean);
    const name = String((x && x.name) || "").trim() || street || disp[0] || "Ort";
    const sub = [name === street ? "" : street, [a.postcode, town].filter(Boolean).join(" ")].filter(Boolean).join(", ") || disp.slice(1, 3).join(", ");
    const d = normDest({ name, sub, ...p });
    if (d && !out.some((o) => sameSpot(o, d))) out.push(d);
  }
  return out;
}

/** Gefaltete Kleinschreibung für die lokale Vorschlags-Suche. */
export function fold(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
}
export function matches(item, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${item.name} ${item.sub || ""}`);
  return words.every((w) => hay.includes(w));
}

/* ---------- Mitlaufen ---------- */

export function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
/**
 * Nächster Schritt beim Mitlaufen: ab dem aktuellen Index der nächstgelegene Abbiegepunkt; ist man näher als
 * `reach` Meter dran, gilt er als erreicht und der folgende ist dran. → Index (oder steps.length-1).
 */
export function nextStepIndex(steps, pos, current = 0, reach = 25) {
  if (!Array.isArray(steps) || !steps.length || !validPoint(pos)) return Math.max(0, Math.min(current, (steps || []).length - 1));
  let best = Math.max(0, current), bestD = Infinity;
  for (let i = Math.max(0, current); i < Math.min(steps.length, current + 6); i++) {
    const l = steps[i].loc;
    if (!l) continue;
    const d = distanceM(pos, { lat: l[0], lng: l[1] });
    if (d < bestD) { bestD = d; best = i; }
  }
  if (bestD <= reach && best < steps.length - 1) best += 1;
  return best;
}
