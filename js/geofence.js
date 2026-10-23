// Geofence: ordnet einen Standort dem nächsten gespeicherten Arbeitsort zu und beschreibt ihn als kurzen Text.
import { distanceM } from "./geo.js";
import { fmtDist } from "./util.js";

function hasCoords(p) {
  return p && typeof p.lat === "number" && typeof p.lng === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

function validLoc(loc) {
  return hasCoords(loc);
}

// Alle Orte mit Koordinaten samt Entfernung, aufsteigend sortiert
function withDistances(loc, places) {
  if (!validLoc(loc) || !Array.isArray(places)) return [];
  return places
    .filter(hasCoords)
    .map((place) => ({ place, distance: distanceM(loc, place) }))
    .sort((a, b) => a.distance - b.distance);
}

export function matchPlace(loc, places, defaultRadius = 150) {
  const acc = Number.isFinite(loc?.acc) && loc.acc > 0 ? Math.min(loc.acc, 100) : 0;
  for (const m of withDistances(loc, places)) {
    const r = Number.isFinite(m.place.radius) && m.place.radius > 0 ? m.place.radius : defaultRadius;
    if (m.distance <= r + acc) return m;
  }
  return null;
}

export function nearby(loc, places, limit = 3) {
  return withDistances(loc, places).slice(0, Math.max(0, limit));
}

export function describe(loc, match) {
  if (match && match.place) {
    return `Bei ${match.place.name || "Ort"} (${fmtDist(match.distance)})`;
  }
  if (!loc) return "Unbekannter Ort";
  if (loc.addr) return `Unbekannter Ort · ${loc.addr}`;
  if (Number.isFinite(loc.acc)) return `Unbekannter Ort · ±${fmtDist(Math.round(loc.acc))}`;
  return "Unbekannter Ort";
}
