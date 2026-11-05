// Update 9 (Agent S) – Galerie: reine Logik ohne DOM (auch in Node testbar).
//   Alben-Zuordnung (Ort vor Adresse, Radius per Haversine), Album-Namen aus Nominatim-Antworten,
//   winziger EXIF-Leser (Aufnahmezeit + GPS), Index-Dokumente, Gruppieren/Filtern.

export const DEFAULT_RADIUS = 80;
export const RADIUS_CHOICES = [50, 80, 150, 300];
export const PLACE_RADIUS = 150;          // Standard-Radius gespeicherter Orte (wie places.js)
export const OHNE_ORT = "__ohne_ort";     // virtuelles Album: Fotos ohne Standort/Adresse
export const KINDS = ["address", "custom", "place"];
export const EMOJIS = ["📁", "🏠", "🏗️", "⚡", "🔌", "💡", "🧰", "🔧", "📦", "🚧", "🏢", "🏭", "🏫", "⭐", "❤️", "📷"];

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Luftlinie in Metern (Haversine). a, b = { lat, lng } */
export function distanceM(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function hasPos(o) { return !!o && fin(o.lat) && fin(o.lng) && !(o.lat === 0 && o.lng === 0); }

export function cleanRadius(r, fb = DEFAULT_RADIUS) {
  const n = Math.round(Number(r));
  return Number.isFinite(n) && n >= 10 && n <= 5000 ? n : fb;
}

/** Album normalisieren (unbekannte Felder bleiben erhalten). */
export function normAlbum(a) {
  if (!a || typeof a !== "object" || !a.id) return null;
  const kind = KINDS.includes(a.kind) ? a.kind : "custom";
  const out = { ...a, id: String(a.id), kind, name: String(a.name || "").trim() || (kind === "address" ? "Adresse" : "Album") };
  const lat = num(a.lat), lng = num(a.lng);
  out.lat = lat; out.lng = lng;
  out.radius = cleanRadius(a.radius);
  out.addr = String(a.addr || "");
  out.placeId = a.placeId ? String(a.placeId) : null;
  out.folderId = a.folderId ? String(a.folderId) : null;
  out.cover = a.cover ? String(a.cover) : null;
  out.emoji = typeof a.emoji === "string" ? a.emoji.slice(0, 8) : "";
  out.created = Number(a.created) || 0;
  return out;
}

/**
 * Wohin gehört ein Foto an Position pos?
 *   1. gespeicherter Ort (store.places), dessen Radius pos enthält (der nächste) → { type:"place", place, album? }
 *   2. Adress-Album, dessen Radius pos enthält (das nächste)                    → { type:"address", album }
 *   3. sonst                                                                  → { type:"new" }
 * Ohne gültige Position → { type:"none" }.
 */
export function matchLocation(pos, { places = [], albums = [], defaultRadius = DEFAULT_RADIUS } = {}) {
  if (!hasPos(pos)) return { type: "none" };
  let best = null;
  for (const p of places || []) {
    if (!p || !hasPos(p)) continue;
    const d = distanceM(pos, p);
    const r = cleanRadius(p.radius, PLACE_RADIUS);
    if (d <= r && (!best || d < best.d)) best = { d, place: p };
  }
  if (best) {
    const album = (albums || []).find((a) => a && a.kind === "place" && a.placeId === best.place.id) || null;
    return { type: "place", place: best.place, album, distance: Math.round(best.d) };
  }
  let bestA = null;
  for (const a of albums || []) {
    if (!a || a.kind !== "address" || !hasPos(a)) continue;
    const d = distanceM(pos, a);
    if (d <= cleanRadius(a.radius, defaultRadius) && (!bestA || d < bestA.d)) bestA = { d, album: a };
  }
  if (bestA) return { type: "address", album: bestA.album, distance: Math.round(bestA.d) };
  return { type: "new" };
}

/** Ort aus einer Nominatim-Adresse (Stadt vor Markt vor Dorf vor Gemeinde …). */
export function localityOf(a) {
  a = a || {};
  return String(a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || "").trim();
}

/**
 * Album-Name aus einer Nominatim-Antwort (format=jsonv2, addressdetails):
 *   „Straße Nr, Ort“ → ohne Hausnummer „Straße, Ort“ → nur Ort → Anfang von display_name → null.
 */
export function albumNameFrom(data) {
  if (!data || typeof data !== "object") return null;
  const a = data.address || {};
  const street = String(a.road || a.pedestrian || a.footway || a.path || a.square || a.residential || a.cycleway || "").trim();
  const hn = String(a.house_number || "").trim();
  const loc = localityOf(a);
  const first = street ? (hn ? `${street} ${hn}` : street) : "";
  if (first && loc && first !== loc) return `${first}, ${loc}`;
  if (first) return first;
  if (loc) {
    const sub = String(a.suburb || a.neighbourhood || a.quarter || "").trim();
    return sub && sub !== loc && (a.city || a.town) ? `${sub}, ${loc}` : loc;
  }
  if (typeof data.display_name === "string" && data.display_name.trim()) {
    return data.display_name.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2).join(", ") || null;
  }
  return null;
}

/** Ausgeschriebene Adresse „Straße Nr, PLZ Ort“ (für Anzeige/Suche). */
export function fullAddrFrom(data) {
  if (!data || typeof data !== "object") return "";
  const a = data.address || {};
  const street = String(a.road || a.pedestrian || a.footway || a.path || a.square || a.residential || "").trim();
  const first = [street, a.house_number].filter(Boolean).join(" ").trim();
  const second = [a.postcode, localityOf(a)].filter(Boolean).join(" ").trim();
  const s = [first, second].filter(Boolean).join(", ");
  if (s) return s;
  return typeof data.display_name === "string" ? data.display_name.split(",").slice(0, 3).map((x) => x.trim()).join(", ") : "";
}

/** Fallback-Name ohne Adresse: Koordinaten. */
export function coordName(pos) {
  return hasPos(pos) ? `Standort ${pos.lat.toFixed(4).replace(".", ",")} / ${pos.lng.toFixed(4).replace(".", ",")}` : "Unbekannter Ort";
}

/* ---------- albumIds ---------- */

export function cleanIds(ids) {
  const out = [];
  for (const x of Array.isArray(ids) ? ids : []) {
    const s = String(x || "");
    if (s && s !== OHNE_ORT && !out.includes(s)) out.push(s);
  }
  return out;
}
/** albumIds ändern: add/remove sind einzelne IDs oder Listen. */
export function changeIds(ids, add = [], remove = []) {
  const rm = new Set([].concat(remove || []).map(String));
  return cleanIds([...cleanIds(ids).filter((x) => !rm.has(x)), ...[].concat(add || []).map(String)]);
}

/**
 * Zusammenführen: alle Fotos aus `fromId` kommen nach `intoId`.
 * Gibt die nötigen Änderungen zurück: [{ id, albumIds }].
 */
export function mergePlan(items, fromId, intoId) {
  const out = [];
  if (!fromId || !intoId || fromId === intoId) return out;
  for (const it of items || []) {
    const ids = cleanIds(it.albumIds);
    if (!ids.includes(fromId)) continue;
    out.push({ id: it.id, albumIds: changeIds(ids, intoId, fromId) });
  }
  return out;
}

/* ---------- Index-Dokumente (nur Vorschaubild + Metadaten, nie das große Bild) ---------- */

export const INDEX_FIELDS = ["id", "ts", "dayKey", "thumb", "albumIds", "addr", "placeId", "place", "note", "lat", "lng", "w", "h", "albMig"];

/** Foto (voll) → Index-Dokument. */
export function indexDoc(p) {
  if (!p || !p.id) return null;
  const o = {
    id: String(p.id),
    ts: Number(p.ts) || 0,
    dayKey: String(p.dayKey || ""),
    thumb: typeof p.thumb === "string" ? p.thumb : "",
    albumIds: cleanIds(p.albumIds),
    addr: String(p.addr || ""),
    placeId: p.placeId ? String(p.placeId) : null,
    place: String(p.place || ""),
    note: String(p.note || ""),
    lat: fin(p.lat) ? p.lat : null,
    lng: fin(p.lng) ? p.lng : null,
    w: Number(p.w) || 0,
    h: Number(p.h) || 0,
  };
  if (p.albMig) o.albMig = true;
  return o;
}

/** Hat sich am Index-relevanten Teil etwas geändert? (für sparsames Schreiben) */
export function indexDiffers(a, b) {
  if (!a || !b) return true;
  for (const k of INDEX_FIELDS) {
    const x = a[k], y = b[k];
    if (Array.isArray(x) || Array.isArray(y)) {
      if (JSON.stringify(cleanIds(x)) !== JSON.stringify(cleanIds(y))) return true;
    } else if ((x ?? null) !== (y ?? null) && !(k === "albMig" && !x && !y)) return true;
  }
  return false;
}

/** Backfill-Plan: welche Fotos haben keinen Index, welche Index-Einträge kein Foto mehr? */
export function planBackfill(photoIds, indexIds) {
  const P = new Set((photoIds || []).map(String));
  const I = new Set((indexIds || []).map(String));
  return { missing: [...P].filter((x) => !I.has(x)), orphans: [...I].filter((x) => !P.has(x)) };
}

/**
 * Lazy-Migration alter Fotos: Foto mit placeId → Ort-Album dieses Orts.
 * Gibt [{ id, placeId }] der Fotos zurück, die (noch) zugeordnet werden müssen.
 */
export function migrationPlan(items, albums) {
  const byPlace = new Map();
  for (const a of albums || []) if (a && a.kind === "place" && a.placeId) byPlace.set(a.placeId, a.id);
  const out = [];
  for (const it of items || []) {
    if (!it || it.albMig || !it.placeId) continue;
    const aid = byPlace.get(it.placeId);
    if (aid && cleanIds(it.albumIds).includes(aid)) continue;
    out.push({ id: it.id, placeId: it.placeId });
  }
  return out;
}

/** Gehört das Foto ins virtuelle Album „Ohne Ort“? (keine Position und in keinem Orts-/Adress-Album) */
export function isOhneOrt(it, albumsById) {
  if (!it) return false;
  if (hasPos(it)) return false;
  for (const id of cleanIds(it.albumIds)) {
    const a = albumsById && (albumsById.get ? albumsById.get(id) : albumsById[id]);
    if (a && (a.kind === "address" || a.kind === "place")) return false;
  }
  return true;
}

/** Fotos eines Albums (inkl. virtuellem „Ohne Ort“). */
export function itemsOfAlbum(items, albumId, albumsById) {
  if (albumId === OHNE_ORT) return (items || []).filter((it) => isOhneOrt(it, albumsById));
  return (items || []).filter((it) => cleanIds(it.albumIds).includes(albumId));
}

/** Album-Statistik: { count, last (ts), coverItem } – Cover = gewähltes Foto, sonst das neueste. */
export function albumStats(items, album, albumsById) {
  const list = itemsOfAlbum(items, album.id, albumsById);
  let last = 0, newest = null;
  for (const it of list) if (it.ts >= last) { last = it.ts; newest = it; }
  const chosen = album.cover ? list.find((x) => x.id === album.cover) : null;
  return { count: list.length, last, coverItem: chosen || newest };
}

/* ---------- Gruppieren, Filtern, Suchen ---------- */

export const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Neueste zuerst; → [{ key:"YYYY-MM", label:"November 2026", days:[{ dayKey, items }] }] */
export function groupByMonthDay(items) {
  const sorted = (items || []).slice().sort((a, b) => b.ts - a.ts);
  const months = [];
  let m = null, d = null;
  for (const it of sorted) {
    const dk = it.dayKey || "";
    const mk = dk.slice(0, 7);
    if (!m || m.key !== mk) {
      const [y, mo] = mk.split("-").map(Number);
      m = { key: mk, label: y && mo ? `${MONTHS[mo - 1]} ${y}` : "Ohne Datum", days: [] };
      months.push(m);
      d = null;
    }
    if (!d || d.dayKey !== dk) { d = { dayKey: dk, items: [] }; m.days.push(d); }
    d.items.push(it);
  }
  return months;
}

/** Kleinbuchstaben, Umlaute/ß vereinheitlicht, Akzente weg. */
export function fold(s) {
  return String(s || "").toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/str\./g, "strasse");
}

/**
 * Filtern: f = { folderId?, albumId?, from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", q? }.
 * Suche über Notiz, Adresse, Ort und Album-Namen; alle Wörter müssen vorkommen.
 */
export function filterItems(items, f = {}, albumsById = new Map(), folderIds = null) {
  let list = (items || []).slice();
  if (f.folderId) {
    const als = albumsById.values ? [...albumsById.values()] : Object.values(albumsById);
    list = itemsOfFolder(list, f.folderId, als, folderIds || new Set());
  }
  if (f.albumId) list = itemsOfAlbum(list, f.albumId, albumsById);
  if (f.from) list = list.filter((it) => it.dayKey >= f.from);
  if (f.to) list = list.filter((it) => it.dayKey <= f.to);
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  if (words.length) {
    const get = (id) => (albumsById.get ? albumsById.get(id) : albumsById[id]);
    list = list.filter((it) => {
      const hay = fold([it.note, it.addr, it.place, ...cleanIds(it.albumIds).map((id) => (get(id) || {}).name || "")].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }
  return list;
}

/* ---------- EXIF (DateTimeOriginal + GPS) ---------- */

/**
 * Liest aus einem JPEG (ArrayBuffer/Uint8Array) die Aufnahmezeit und GPS-Position.
 * → { ts?: number (lokale Zeit), lat?: number, lng?: number } – {} wenn nichts gefunden.
 */
export function readExif(buf) {
  const out = {};
  try {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xFFD8) return out;
    let off = 2;
    while (off + 4 <= dv.byteLength) {
      if (dv.getUint8(off) !== 0xFF) break;
      const marker = dv.getUint8(off + 1);
      if (marker === 0xD9 || marker === 0xDA) break; // Ende / Bilddaten
      const len = dv.getUint16(off + 2);
      if (len < 2) break;
      if (marker === 0xE1 && off + 10 <= dv.byteLength &&
          dv.getUint32(off + 4) === 0x45786966 && dv.getUint16(off + 8) === 0) { // "Exif\0\0"
        parseTiff(dv, off + 10, Math.min(dv.byteLength, off + 2 + len), out);
        break;
      }
      off += 2 + len;
    }
  } catch { /* kaputtes EXIF → ignorieren */ }
  return out;
}

function parseTiff(dv, t0, end, out) {
  const bo = dv.getUint16(t0);
  const le = bo === 0x4949;
  if (!le && bo !== 0x4D4D) return;
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  if (u16(t0 + 2) !== 42) return;
  const ifd = (rel) => {
    const tags = new Map();
    const o = t0 + rel;
    if (rel < 8 || o + 2 > end) return tags;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12;
      if (e + 12 > end) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), valOff: e + 8 });
    }
    return tags;
  };
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  const dataAt = (tag) => {
    const bytes = (size[tag.type] || 1) * tag.count;
    return bytes <= 4 ? tag.valOff : t0 + u32(tag.valOff);
  };
  const ascii = (tag) => {
    if (!tag || tag.type !== 2) return "";
    const p = dataAt(tag);
    let s = "";
    for (let i = 0; i < tag.count && p + i < end; i++) { const c = dv.getUint8(p + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  };
  const rationals = (tag) => {
    if (!tag || (tag.type !== 5 && tag.type !== 10)) return null;
    const p = dataAt(tag);
    const r = [];
    for (let i = 0; i < tag.count; i++) {
      const q = p + i * 8;
      if (q + 8 > end) return null;
      const a = tag.type === 10 ? dv.getInt32(q, le) : u32(q);
      const b = tag.type === 10 ? dv.getInt32(q + 4, le) : u32(q + 4);
      r.push(b ? a / b : 0);
    }
    return r;
  };
  const ptr = (tags, id) => { const t = tags.get(id); return t ? u32(t.valOff) : 0; };

  const ifd0 = ifd(u32(t0 + 4));
  const exifP = ptr(ifd0, 0x8769);
  const gpsP = ptr(ifd0, 0x8825);
  let dt = "";
  if (exifP) { const ex = ifd(exifP); dt = ascii(ex.get(0x9003)) || ascii(ex.get(0x9004)); }
  if (!dt) dt = ascii(ifd0.get(0x0132));
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dt);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!isNaN(d.getTime()) && +m[1] > 1990) out.ts = d.getTime();
  }
  if (gpsP) {
    const g = ifd(gpsP);
    const la = rationals(g.get(2)), lo = rationals(g.get(4));
    const laRef = ascii(g.get(1)) || "N", loRef = ascii(g.get(3)) || "E";
    const dms = (r) => (r && r.length >= 1 ? r[0] + (r[1] || 0) / 60 + (r[2] || 0) / 3600 : NaN);
    let lat = dms(la), lng = dms(lo);
    if (/S/i.test(laRef)) lat = -lat;
    if (/W/i.test(loRef)) lng = -lng;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      out.lat = Math.round(lat * 1e7) / 1e7;
      out.lng = Math.round(lng * 1e7) / 1e7;
    }
  }
}

/**
 * Baut ein APP1-EXIF-Segment (Big-Endian) mit DateTimeOriginal und GPS – für Tests/Fixtures.
 * opts = { date: "YYYY:MM:DD HH:MM:SS", lat, lng } → Uint8Array (beginnt mit FF E1).
 */
export function buildExifSegment({ date, lat, lng } = {}) {
  // TIFF-Aufbau: Header(8) · IFD0 · ExifIFD · GPS-IFD · Daten
  const tiff = [];
  const w16 = (a, v) => { a.push((v >> 8) & 255, v & 255); };
  const w32 = (a, v) => { a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); };
  const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
  const n0 = 1 + (hasGps ? 1 : 0);
  const ifd0Size = 2 + n0 * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = 2 + 12 + 4;
  const gpsOff = exifOff + exifSize;
  const gpsSize = hasGps ? 2 + 4 * 12 + 4 : 0;
  const dataOff = gpsOff + gpsSize;
  const data = [];
  const dateStr = (date || "2026:01:01 00:00:00").slice(0, 19);
  const dateOff = dataOff; for (const c of dateStr) data.push(c.charCodeAt(0)); data.push(0);
  const dmsOf = (v) => { v = Math.abs(v); const d = Math.floor(v); const mf = (v - d) * 60; const m = Math.floor(mf); const s = Math.round((mf - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };
  let latOff = 0, lngOff = 0;
  if (hasGps) {
    latOff = dataOff + data.length; for (const [a, b] of dmsOf(lat)) { w32(data, a); w32(data, b); }
    lngOff = dataOff + data.length; for (const [a, b] of dmsOf(lng)) { w32(data, a); w32(data, b); }
  }
  // Header
  tiff.push(0x4D, 0x4D); w16(tiff, 42); w32(tiff, 8);
  // IFD0
  w16(tiff, n0);
  w16(tiff, 0x8769); w16(tiff, 4); w32(tiff, 1); w32(tiff, exifOff);
  if (hasGps) { w16(tiff, 0x8825); w16(tiff, 4); w32(tiff, 1); w32(tiff, gpsOff); }
  w32(tiff, 0);
  // Exif-IFD
  w16(tiff, 1);
  w16(tiff, 0x9003); w16(tiff, 2); w32(tiff, dateStr.length + 1); w32(tiff, dateOff);
  w32(tiff, 0);
  if (hasGps) {
    w16(tiff, 4);
    w16(tiff, 1); w16(tiff, 2); w32(tiff, 2); tiff.push(lat < 0 ? 83 : 78, 0, 0, 0);
    w16(tiff, 2); w16(tiff, 5); w32(tiff, 3); w32(tiff, latOff);
    w16(tiff, 3); w16(tiff, 2); w32(tiff, 2); tiff.push(lng < 0 ? 87 : 69, 0, 0, 0);
    w16(tiff, 4); w16(tiff, 5); w32(tiff, 3); w32(tiff, lngOff);
    w32(tiff, 0);
  }
  tiff.push(...data);
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xFF, 0xE1, (len >> 8) & 255, len & 255, ...body]);
}

/** EXIF-Segment direkt nach SOI in ein JPEG einfügen. */
export function injectExif(jpeg, seg) {
  const u8 = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  const out = new Uint8Array(u8.length + seg.length);
  out.set(u8.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(u8.subarray(2), 2 + seg.length);
  return out;
}

/** Google-Maps-Link für ein Album. */
export function albumMapsUrl(a, place) {
  const src = hasPos(a) ? a : (place && hasPos(place) ? place : null);
  if (src) return `https://www.google.com/maps/search/?api=1&query=${src.lat},${src.lng}`;
  const q = (a && (a.addr || a.name)) || "";
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/* ---------- Hauptkategorien (Update 9, Agent T) ----------
 *   Sammlung a_photo_folders: { id, name, emoji, color, order, created }. Alben haben optional folderId.
 *   Album ohne (gültige) Kategorie → virtuelle Kategorie „Ohne Kategorie“ (OHNE_KAT).
 */

export const OHNE_KAT = "__ohne_kat";
export const BAU_ID = "f_bau";
export const SCHULE_ID = "f_schule";
export const PRIVAT_ID = "f_privat";
export const FOLDER_COLORS = ["#d97706", "#2563eb", "#16a34a", "#dc2626", "#7c3aed", "#0d9488", "#db2777", "#475569"];
export const FOLDER_EMOJIS = ["🏗️", "🏫", "🏠", "🔧", "🧰", "⚡", "🔌", "💡", "📦", "🚧", "🏢", "🏭", "🚗", "📚", "📝", "⭐", "❤️", "🎉", "🌳", "📷"];
/** Feste IDs, damit zwei Geräte beim ersten Start nicht doppelt anlegen. */
export const DEFAULT_FOLDERS = [
  { id: BAU_ID, name: "Baustellen", emoji: "🏗️", color: "#d97706", order: 0 },
  { id: SCHULE_ID, name: "Berufsschule", emoji: "🏫", color: "#2563eb", order: 1 },
  { id: PRIVAT_ID, name: "Privat", emoji: "🏠", color: "#16a34a", order: 2 },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Kategorie normalisieren (unbekannte Felder bleiben). */
export function normFolder(f) {
  if (!f || typeof f !== "object" || !f.id) return null;
  return {
    ...f,
    id: String(f.id),
    name: String(f.name || "").trim() || "Kategorie",
    emoji: typeof f.emoji === "string" && f.emoji ? f.emoji.slice(0, 8) : "📁",
    color: HEX.test(String(f.color || "")) ? String(f.color) : FOLDER_COLORS[7],
    order: Number.isFinite(Number(f.order)) ? Number(f.order) : 0,
    created: Number(f.created) || 0,
  };
}

/** Nach order, dann Anlagezeit, dann Name. */
export function sortFolders(list) {
  return (list || []).filter(Boolean).slice().sort((a, b) =>
    (a.order - b.order) || ((a.created || 0) - (b.created || 0)) || String(a.name).localeCompare(String(b.name), "de"));
}

/** Ist das ein Berufsschul-Name? („Landesberufsschule Graz“, „LBS Fürstenfeld“, „Schule“) */
export function isSchoolName(s) {
  const t = String(s || "");
  return /schule/i.test(t) || /(^|[^a-z0-9äöüß])lbs($|[^a-z0-9äöüß])/i.test(t);
}

const byId = (folders, id) => (folders || []).find((f) => f && f.id === id) || null;
/** Kategorie „Berufsschule“: feste ID, sonst eine mit „schule“ im Namen. */
export function schoolFolder(folders) { return byId(folders, SCHULE_ID) || (folders || []).find((f) => f && /schule/i.test(f.name)) || null; }
/** Kategorie „Baustellen“: feste ID, sonst eine mit „baustelle“ im Namen. */
export function bauFolder(folders) { return byId(folders, BAU_ID) || (folders || []).find((f) => f && /baustelle/i.test(f.name)) || null; }

/**
 * Einstellung „Neue Adress-Alben automatisch in Kategorie …“ auflösen.
 *   setting undefined/null → Standard „Baustellen“ (falls vorhanden); "" → keine; ID → diese, falls es sie gibt.
 * → folderId | null
 */
export function resolveAutoFolder(folders, setting) {
  if (setting === "" ) return null;
  if (setting === undefined || setting === null) { const b = bauFolder(folders); return b ? b.id : null; }
  return byId(folders, String(setting)) ? String(setting) : null;
}

/**
 * Kategorie für ein neu angelegtes Album.
 *   Eigene Alben → keine. Adress-/Ort-Alben: Berufsschule (Name/Ort enthält „schule“/„LBS“) → Berufsschul-Kategorie,
 *   sonst die eingestellte Auto-Kategorie.
 * opts = { folders, autoFolder (Einstellungswert), place? }
 */
export function folderForNewAlbum(album, { folders = [], autoFolder, activeFolderId, place = null } = {}) {
  if (!album || (album.kind !== "address" && album.kind !== "place")) return null;
  // Update 9 (Agent U): Ort mit eigener „Foto-Kategorie“ → dessen Ort-Album kommt dorthin
  if (album.kind === "place" && place && place.photoFolderId && byId(folders, String(place.photoFolderId))) return String(place.photoFolderId);
  if (album.kind === "place" && (isSchoolName(album.name) || (place && isSchoolName(place.name)))) {
    const s = schoolFolder(folders);
    if (s) return s.id;
  }
  // Update 9 (Agent U): aufgelöste aktive Kategorie hat Vorrang (null = keine); sonst die alte Einstellung
  if (activeFolderId !== undefined) return activeFolderId && byId(folders, String(activeFolderId)) ? String(activeFolderId) : null;
  return resolveAutoFolder(folders, autoFolder);
}

/**
 * Erster Start der Hauptkategorien (nur einmal – danach Flag gesetzt, gelöschte Standard-Kategorien kommen nie wieder).
 *   initialized → null (nichts tun)
 *   keine Kategorien → Standard-Kategorien anlegen
 *   bestehende Adress-/Ort-Alben ohne Kategorie → Baustellen (Berufsschul-Orte → Berufsschule)
 * → { create: [folder…], assign: [{ id, folderId }] } | null
 */
export function folderMigration({ initialized = false, folders = [], albums = [], places = [] } = {}) {
  if (initialized) return null;
  const create = (folders || []).length ? [] : DEFAULT_FOLDERS.map((f) => ({ ...f }));
  const all = [...(folders || []), ...create];
  const ids = new Set(all.map((f) => f.id));
  const bau = bauFolder(all), schule = schoolFolder(all);
  const assign = [];
  for (const a of albums || []) {
    if (!a || (a.kind !== "address" && a.kind !== "place")) continue;
    if (a.folderId && ids.has(a.folderId)) continue;
    const pl = a.kind === "place" ? (places || []).find((p) => p && p.id === a.placeId) : null;
    const school = a.kind === "place" && (isSchoolName(a.name) || (pl && isSchoolName(pl.name)));
    const target = school && schule ? schule : bau;
    if (target) assign.push({ id: a.id, folderId: target.id });
  }
  return { create, assign };
}

/** Gültige Kategorie eines Albums oder OHNE_KAT. folderIds = Set der vorhandenen Kategorie-IDs. */
export function albumFolderId(album, folderIds) {
  const f = album && album.folderId;
  return f && folderIds && folderIds.has(f) ? f : OHNE_KAT;
}

/** Alben einer Kategorie (OHNE_KAT = ohne gültige Kategorie). */
export function albumsInFolder(albums, folderId, folderIds) {
  return (albums || []).filter((a) => a && albumFolderId(a, folderIds) === folderId);
}

/** Fotos einer Kategorie: in mindestens einem ihrer Alben. OHNE_KAT: in keinem Album mit Kategorie. */
export function itemsOfFolder(items, folderId, albums, folderIds) {
  if (folderId === OHNE_KAT) {
    const withF = new Set((albums || []).filter((a) => albumFolderId(a, folderIds) !== OHNE_KAT).map((a) => a.id));
    return (items || []).filter((it) => !cleanIds(it.albumIds).some((id) => withF.has(id)));
  }
  const ids = new Set(albumsInFolder(albums, folderId, folderIds).map((a) => a.id));
  return (items || []).filter((it) => cleanIds(it.albumIds).some((id) => ids.has(id)));
}

/**
 * Kategorie-Statistik: { albums, count (Fotos, jedes nur einmal), last (ts), covers: [item ≤ 4] }.
 *   Mosaik: Titelbilder der zuletzt benutzten Alben, mit den neuesten anderen Fotos aufgefüllt.
 */
export function folderStats(items, folderId, albums, folderIds, albumsById) {
  const als = albumsInFolder(albums, folderId, folderIds);
  const list = itemsOfFolder(items, folderId, albums, folderIds);
  const per = als.map((a) => albumStats(items, a, albumsById)).filter((s) => s.count).sort((x, y) => y.last - x.last);
  const covers = [];
  for (const s of per) { if (covers.length >= 4) break; if (s.coverItem && !covers.includes(s.coverItem)) covers.push(s.coverItem); }
  if (covers.length < 4) {
    for (const it of list.slice().sort((a, b) => b.ts - a.ts)) { if (covers.length >= 4) break; if (!covers.includes(it)) covers.push(it); }
  }
  let last = 0;
  for (const it of list) if (it.ts > last) last = it.ts;
  return { albums: als.length, count: list.length, last, covers };
}

/** Reihenfolge ändern: dir = -1 (hoch) / +1 (runter) → [{ id, order }] (nur geänderte). */
export function moveFolderPlan(folders, id, dir) {
  const list = sortFolders(folders);
  const i = list.findIndex((f) => f.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((f, k) => ({ id: f.id, order: k, was: f.order })).filter((x) => x.was !== x.order).map(({ id: fid, order }) => ({ id: fid, order }));
}

/** Neue order ans Ende. */
export function nextFolderOrder(folders) {
  return (folders || []).reduce((m, f) => Math.max(m, Number(f && f.order) || 0), -1) + 1;
}

/** Kategorie löschen: Alben wandern nach target (null = Ohne Kategorie). → [{ id, folderId }] */
export function deleteFolderPlan(albums, folderId, target = null) {
  const t = target && target !== folderId && target !== OHNE_KAT ? target : null;
  return (albums || []).filter((a) => a && a.folderId === folderId).map((a) => ({ id: a.id, folderId: t }));
}

/* ---------- Aktive Kategorie „Neue Fotos gehen nach …“ (Update 9, Agent U) ----------
 *   settings.gallery.activeFolderId: ID | "" (keine) | fehlt (→ alte Einstellung autoFolder, sonst „Baustellen“).
 *   Eingestempelt an einem Ort mit photoFolderId → dieser überschreibt vorübergehend (source "place").
 */

/** Rohwert der aktiven Kategorie aus settings.gallery (undefined = Standard). */
export function activeSetting(g) {
  g = g || {};
  if (typeof g.activeFolderId === "string") return g.activeFolderId;
  if (typeof g.autoFolder === "string") return g.autoFolder;
  return undefined;
}

/**
 * Aktive Kategorie auflösen.
 *   opts = { folders, gallery (settings.gallery), placeId (Ort der laufenden Schicht), places, ignorePlace }
 * → { id: folderId|null, source: "place"|"manual"|"default"|"none", place: Ort|null, manualId }
 */
export function resolveActiveFolder({ folders = [], gallery = {}, placeId = null, places = [], ignorePlace = false } = {}) {
  const raw = activeSetting(gallery);
  const manualId = resolveAutoFolder(folders, raw);
  if (placeId && !ignorePlace) {
    const pl = (places || []).find((p) => p && p.id === placeId) || null;
    if (pl && pl.photoFolderId && byId(folders, String(pl.photoFolderId))) {
      return { id: String(pl.photoFolderId), source: "place", place: pl, manualId };
    }
  }
  if (!manualId) return { id: null, source: "none", place: null, manualId: null };
  return { id: manualId, source: raw === undefined ? "default" : "manual", place: null, manualId };
}

/** Ort der laufenden Schicht (letzter Abschnitt vor der Schicht selbst) oder null. */
export function runningPlaceId(running) {
  if (!running) return null;
  const segs = Array.isArray(running.segments) ? running.segments : [];
  const s = segs[segs.length - 1];
  return (s && s.placeId) || running.placeId || null;
}

/**
 * Einsatz-Titel enthält einen Kategorie-Namen? → längste passende Kategorie oder null.
 *   „Wohnungen Gries“ → 🏠 Wohnungen. Treffer nur am Wortanfang, Namen ab 3 Zeichen, Groß/Klein + Umlaute egal.
 */
export function einsatzFolderSuggestion(title, folders) {
  const t = fold(title);
  if (!t) return null;
  let best = null;
  for (const f of folders || []) {
    if (!f) continue;
    const n = fold(f.name).trim();
    if (n.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (re.test(t) && (!best || n.length > best.len)) best = { f, len: n.length };
  }
  return best ? best.f : null;
}

/** „Wohnungen › Musterstraße 5, Graz“ (ohne Kategorie nur der Album-Name). */
export function destLabel(album, folder) {
  const a = album && album.name ? album.name : "";
  return folder && folder.name ? (a ? `${folder.name} › ${a}` : folder.name) : a;
}

/**
 * Alben aus ANDEREN Kategorien, die in den letzten `days` Tagen benutzt wurden (neuestes Foto oder angelegt).
 * → [{ album, last, folderId }] neueste zuerst.
 */
export function recentAlbumsElsewhere(albums, items, folderId, folderIds, { now = Date.now(), days = 14 } = {}) {
  const since = now - days * 86400000;
  const lastBy = new Map();
  for (const it of items || []) {
    for (const id of cleanIds(it && it.albumIds)) if ((Number(it.ts) || 0) > (lastBy.get(id) || 0)) lastBy.set(id, Number(it.ts) || 0);
  }
  const out = [];
  for (const a of albums || []) {
    if (!a || a.kind === "virtual") continue;
    const fid = albumFolderId(a, folderIds);
    if (fid === folderId) continue;
    const last = Math.max(lastBy.get(a.id) || 0, Number(a.created) || 0);
    if (last >= since) out.push({ album: a, last, folderId: fid });
  }
  return out.sort((x, y) => y.last - x.last);
}
