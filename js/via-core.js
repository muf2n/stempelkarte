// 📍 Zwischenstopps (Update 10): reine Logik ohne DOM.
// Während der laufende Abschnitt „Autofahren“ ist, merkt sich die App beim Öffnen/Zurückkehren den Standort
// als Zwischenstopp am Abschnitt: seg.via = [{lat, lng, at, acc}] (optional, höchstens VIA_MAX).
// Regeln: Genauigkeit ≤ 150 m, > 300 m vom vorigen Punkt (Start oder letzter Zwischenstopp),
// ≥ 2 min seit dem letzten Zwischenstopp (gilt nicht beim manuellen „📍 Hier merken“).
import { haversineM, viaPoints, VIA_MAX } from "./travel.js";

export const VIA_ACC_MAX = 150;
export const VIA_MIN_DIST = 300;
export const VIA_MIN_GAP = 2 * 60000;

function ll(p) {
  return !!p && typeof p.lat === "number" && typeof p.lng === "number" &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0);
}

/** Darf `pos` ({lat,lng,acc}) als Zwischenstopp an `seg`? → {ok:true} | {ok:false, reason}
 *  reason: "pos" | "acc" | "max" | "near" | "soon". */
export function viaCheck(seg, pos, { now = Date.now(), manual = false } = {}) {
  if (!seg || !ll(pos)) return { ok: false, reason: "pos" };
  const acc = Number(pos.acc);
  if (!Number.isFinite(acc) || acc > VIA_ACC_MAX) return { ok: false, reason: "acc" };
  const via = viaPoints(seg);
  if (via.length >= VIA_MAX) return { ok: false, reason: "max" };
  const prev = via.length ? via[via.length - 1] : (ll(seg.loc) ? seg.loc : null);
  if (prev && haversineM(prev, pos) <= VIA_MIN_DIST) return { ok: false, reason: "near" };
  if (!manual && via.length) {
    const t = Number(via[via.length - 1].at);
    if (Number.isFinite(t) && now - t < VIA_MIN_GAP) return { ok: false, reason: "soon" };
  }
  return { ok: true };
}

/** Abschnitt mit neuem Zwischenstopp (neues Objekt). Entfernt veraltete Straßen-km nicht – roadKm() prüft den Schlüssel. */
export function withVia(seg, pos, now = Date.now()) {
  const p = { lat: Math.round(pos.lat * 1e6) / 1e6, lng: Math.round(pos.lng * 1e6) / 1e6, at: now, acc: Math.round(Number(pos.acc) || 0) };
  return { ...seg, via: [...viaPoints(seg), p] };
}

/** Abschnitt ohne den Zwischenstopp Nr. `j` (Feld fällt weg, wenn keiner übrig ist). */
export function withoutVia(seg, j) {
  const via = viaPoints(seg).filter((_, i) => i !== j);
  const out = { ...seg };
  if (via.length) out.via = via; else delete out.via;
  delete out.kmRoad; delete out.kmRoadAt; delete out.kmRoadFor;
  return out;
}

/** Kurztext eines Zwischenstopps: Adresse (falls bekannt) sonst gerundete Koordinaten. */
export function viaLabel(v, addr = "") {
  if (addr) return addr;
  if (!ll(v)) return "?";
  return `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`;
}

/** „1 Zwischenstopp“ / „3 Zwischenstopps“. */
export function viaCountText(n) {
  return `${n} Zwischenstopp${n === 1 ? "" : "s"}`;
}

const X_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

/** Liste der Zwischenstopps als HTML (Uhrzeit + Kurzadresse/Koordinaten + ✕ zum Entfernen).
 *  `attr` = Name des data-Attributs am ✕-Knopf (Wert = Index), `pre` = Präfix für den Wert (z. B. "2:"). */
export function viaListHTML(via, { esc, clock }, { attr = "viadel", pre = "" } = {}) {
  if (!via || !via.length) return "";
  return `<ul class="via-list">${via.map((v, j) => {
    const t = Number.isFinite(Number(v.at)) ? clock(Number(v.at)) : "";
    return `<li><span>${t ? `<b>${esc(t)}</b>` : ""}<span data-via-lat="${v.lat}" data-via-lng="${v.lng}">📍 ${esc(viaLabel(v))}</span></span>` +
      `<button type="button" class="via-del" data-${attr}="${esc(pre + j)}" aria-label="Zwischenstopp ${j + 1}${t ? " um " + esc(t) : ""} entfernen">${X_SVG}</button></li>`;
  }).join("")}</ul>`;
}

/** Kurzadressen nachtragen (Adress-Cache von js/geo.js, sonst bleiben die Koordinaten stehen). */
export function fillViaAddrs(host, geo) {
  if (!host || !geo || !geo.reverseGeocode) return;
  host.querySelectorAll("[data-via-lat]").forEach((el) => {
    const lat = Number(el.dataset.viaLat), lng = Number(el.dataset.viaLng);
    geo.reverseGeocode(lat, lng).then((a) => {
      if (a && el.isConnected) el.textContent = "📍 " + String(a).split(",").slice(0, 2).join(",").trim();
    }).catch(() => {});
  });
}
