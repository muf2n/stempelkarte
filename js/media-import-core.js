// Update 9 (Agent W3) – Kamera-Fotos übernehmen: reine Logik ohne DOM (auch in Node testbar).
//   Regel „Welche Kamera-Fotos sind Arbeitsfotos?“:
//     work          – Aufnahmezeit liegt in einem Arbeits-Eintrag oder der laufenden Schicht (Standard)
//     work_or_place – zusätzlich: GPS des Fotos im Radius eines gespeicherten Orts
//     ask           – wie work_or_place vorauswählen, aber bei JEDEM neuen Foto fragen
//   Nie als Arbeitsfoto: Privatmodus (settings.mode.privat), Privatfahrt (Abschnitt private/privateTrip, Eintrag privateTrip).
//   Doppelt-Schutz über Fingerabdrücke (Sammlung a_photo_imports): Web size+Aufnahmezeit+Hash der ersten Bytes,
//   nativ MediaStore _ID + DATE_TAKEN.
import { distanceM, hasPos, cleanRadius, PLACE_RADIUS } from "./gallery-core.js";

export const RULES = ["work", "work_or_place", "ask"];
export const RULE_LABELS = {
  work: "Nur während der Arbeitszeit",
  work_or_place: "Arbeitszeit oder an meinen Orten",
  ask: "Alle neuen Fotos fragen",
};
export const GRACE_MS = 5 * 60 * 1000;     // Foto knapp vor dem Ein- / nach dem Ausstempeln zählt noch
export const HEAD_BYTES = 64 * 1024;       // so viele Bytes gehen in den Web-Fingerabdruck
export const NATIVE_DAYS = 3;              // so viele Tage Arbeitszeiten bekommt die App für die Benachrichtigung

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** settings.mediaImport normalisieren. */
export function normSettings(s) {
  const m = (s && s.mediaImport) || {};
  return {
    rule: RULES.includes(m.rule) ? m.rule : "work",
    auto: m.auto === true,                 // „Automatisch übernehmen ohne Nachfrage“ (Standard aus)
    notify: m.notify !== false,            // Benachrichtigung bei neuen Baustellen-Fotos (Standard an)
    allBuckets: m.allBuckets === true,     // auch andere Ordner als DCIM/Kamera
  };
}

/* ---------- Privatmodus / Privatfahrt (anderer Agent; fehlt → egal) ---------- */

/** settings.mode.privat → { on, since, until } | null. Erlaubt: true | { on|active, since|start, until|end }. */
export function privatInfo(settings) {
  const p = settings && settings.mode && settings.mode.privat;
  if (!p) return null;
  if (p === true) return { on: true, since: 0, until: 0 };
  if (typeof p !== "object") return null;
  const on = p.on !== false && p.active !== false && p.enabled !== false;
  return on ? { on: true, since: num(p.since ?? p.start ?? p.from), until: num(p.until ?? p.end ?? p.to) } : null;
}

const isPrivFlag = (o) => !!(o && (o.privateTrip === true || o.private === true || o.privat === true));

/* ---------- Arbeitszeiten ---------- */

export function isWorkEntry(e) {
  return !!e && (!e.kind || e.kind === "work") && num(e.start) && num(e.end) > num(e.start);
}

/**
 * Arbeitszeit-Intervalle aus Einträgen + laufender Schicht.
 * → [{ start, end, entry|null, running:boolean, segments:[…] }] nach Beginn sortiert.
 */
export function workIntervals({ entries = [], running = null, now = Date.now() } = {}) {
  const out = [];
  for (const e of entries || []) {
    if (!isWorkEntry(e)) continue;
    out.push({ start: num(e.start), end: num(e.end), entry: e, running: false, segments: Array.isArray(e.segments) ? e.segments : [] });
  }
  if (running && num(running.start)) {
    out.push({ start: num(running.start), end: Math.max(num(running.start), now), entry: null, running: true, run: running, segments: Array.isArray(running.segments) ? running.segments : [] });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Intervall, in dem ts liegt (mit Kulanz GRACE_MS an den Rändern; genauer Treffer gewinnt). */
export function intervalAt(ts, intervals, grace = GRACE_MS) {
  let near = null;
  for (const iv of intervals || []) {
    if (ts >= iv.start && ts <= iv.end) return iv;
    if (!near && ts >= iv.start - grace && ts <= iv.end + grace) near = iv;
  }
  return near;
}

/** Abschnitt einer Schicht/eines Eintrags zum Zeitpunkt ts (letzter, der vorher begonnen hat). */
export function segmentAt(ts, iv) {
  const segs = (iv && iv.segments) || [];
  let s = null;
  for (const x of segs) if (x && num(x.start) <= ts && (!s || num(x.start) >= num(s.start))) s = x;
  return s || segs[0] || null;
}

/** Ort zum Zeitpunkt ts: { placeId, place, loc } (loc nur mit gültiger Position). */
export function placeAt(ts, iv, places = []) {
  if (!iv) return { placeId: null, place: "", loc: null };
  const seg = segmentAt(ts, iv);
  const src = iv.entry || iv.run || {};
  // Abschnitt vorhanden → dessen Ort (Fahrt-Abschnitt hat keinen); sonst der Ort der Schicht
  const placeId = (seg ? seg.placeId : src.placeId) || null;
  const pl = placeId ? (places || []).find((p) => p && p.id === placeId) : null;
  const place = (pl && pl.name) || (seg ? seg.place : src.place) || "";
  const cand = seg ? [seg.loc, pl, iv.segments[0] === seg ? src.inLoc : null] : [src.inLoc, pl];
  const loc = cand.find((c) => hasPos(c)) || null;
  return { placeId, place, loc: loc ? { lat: loc.lat, lng: loc.lng, acc: fin(loc.acc) ? loc.acc : undefined } : null };
}

/** Privat zum Zeitpunkt ts? (Privatmodus-Zeitraum, Privatfahrt-Abschnitt, als privat markierter Eintrag/Schicht) */
export function isPrivateAt(ts, iv, settings) {
  if (iv) {
    if (isPrivFlag(iv.entry) || isPrivFlag(iv.run)) return true;
    if (isPrivFlag(segmentAt(ts, iv))) return true;
  }
  const pm = privatInfo(settings);
  if (pm) {
    if (pm.since) return ts >= pm.since && (!pm.until || ts <= pm.until);
    // Privatmodus ohne Zeitangabe: gilt für die laufende Schicht und alles außerhalb abgeschlossener Einträge
    return !iv || iv.running;
  }
  return false;
}

/** Nächster gespeicherter Ort, dessen Radius pos enthält → Ort | null */
export function placeNear(pos, places = []) {
  if (!hasPos(pos)) return null;
  let best = null;
  for (const p of places || []) {
    if (!p || !hasPos(p)) continue;
    const d = distanceM(pos, p);
    if (d <= cleanRadius(p.radius, PLACE_RADIUS) && (!best || d < best.d)) best = { d, p };
  }
  return best ? best.p : null;
}

/**
 * Ein Kamera-Foto einordnen.
 *   photo = { ts, lat?, lng? }   ctx = { entries, running, places, settings, now, rule?, intervals? }
 * → { ok, reason: "work"|"place"|"outside"|"privat"|"nodate", placeId, place, loc, entryId }
 *   ok = soll vorausgewählt / automatisch übernommen werden.
 */
export function classify(photo, ctx = {}) {
  const rule = RULES.includes(ctx.rule) ? ctx.rule : normSettings(ctx.settings).rule;
  const ts = num(photo && photo.ts);
  const none = { placeId: null, place: "", loc: null, entryId: null };
  if (!ts) return { ok: false, reason: "nodate", ...none };
  const ivs = ctx.intervals || workIntervals({ entries: ctx.entries, running: ctx.running, now: ctx.now || Date.now() });
  const iv = intervalAt(ts, ivs);
  if (isPrivateAt(ts, iv, ctx.settings)) return { ok: false, reason: "privat", ...none };
  if (iv) {
    const pa = placeAt(ts, iv, ctx.places);
    return { ok: true, reason: "work", ...pa, entryId: iv.entry ? iv.entry.id || null : null, running: iv.running };
  }
  if (rule !== "work") {
    const pl = placeNear(photo, ctx.places);
    if (pl) return { ok: true, reason: "place", placeId: pl.id, place: pl.name || "", loc: null, entryId: null };
  }
  return { ok: false, reason: "outside", ...none };
}

export const REASON_LABELS = {
  work: "Arbeitszeit",
  place: "an deinem Ort",
  outside: "außerhalb der Arbeitszeit",
  privat: "privat",
  nodate: "ohne Aufnahmezeit",
  dup: "schon übernommen",
  otherday: "anderer Tag",
};

/* ---------- Fingerabdrücke / Doppelte ---------- */

/** FNV-1a (32 Bit) über Bytes → 8 Hex-Zeichen. */
export function hashBytes(u8) {
  let h = 0x811c9dc5;
  const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8 || []);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/** Web: Größe + Aufnahmezeit + Hash der ersten Bytes. */
export function fpWeb({ size, ts, head }) {
  return `w:${Math.round(Number(size) || 0)}:${Math.round(Number(ts) || 0)}:${typeof head === "string" ? head : hashBytes(head)}`;
}
/** Nativ: MediaStore _ID + DATE_TAKEN. */
export function fpNative(id, dateTaken) { return `n:${String(id)}:${Math.round(Number(dateTaken) || 0)}`; }
/** Dokument-ID für a_photo_imports (Firestore: kein „/“). */
export function importDocId(fp) { return String(fp).replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 140); }

/** Bekannte Fingerabdrücke (Set) aus den Import-Dokumenten. */
export function knownSet(docs) {
  const s = new Set();
  for (const d of docs || []) if (d && d.fp) s.add(String(d.fp));
  return s;
}

/** Liste in neu/doppelt aufteilen (auch Doppelte innerhalb der Liste selbst). items[i].fp nötig. */
export function splitDupes(items, known) {
  const seen = new Set(known || []);
  const fresh = [], dupes = [];
  for (const it of items || []) {
    if (!it || !it.fp) continue;
    if (seen.has(it.fp)) dupes.push(it); else { seen.add(it.fp); fresh.push(it); }
  }
  return { fresh, dupes };
}

/* ---------- Für die App (Benachrichtigung im Hintergrund) ---------- */

/**
 * Kompakte Regel für den nativen Teil (der hat keine Einträge): Arbeitszeiten der letzten Tage,
 * laufende Schicht, Privat-Zeiträume und Orte.
 */
export function nativeConfig({ entries = [], running = null, places = [], settings = {}, now = Date.now(), days = NATIVE_DAYS } = {}) {
  const set = normSettings(settings);
  const from = now - days * 86400000;
  const work = [];
  const priv = [];
  for (const iv of workIntervals({ entries, running: null, now })) {
    if (iv.end < from) continue;
    if (isPrivFlag(iv.entry)) { priv.push([iv.start, iv.end]); continue; }
    work.push([iv.start, iv.end]);
    for (let i = 0; i < iv.segments.length; i++) {
      const s = iv.segments[i];
      if (!isPrivFlag(s)) continue;
      const nx = iv.segments[i + 1];
      priv.push([num(s.start) || iv.start, num(s.end) || (nx && num(nx.start)) || iv.end]);
    }
  }
  const pm = privatInfo(settings);
  let run = running && num(running.start) && !isPrivFlag(running) ? num(running.start) : 0;
  if (pm && !pm.since) run = 0;
  if (pm && pm.since) priv.push([pm.since, pm.until || 0]);
  if (running && run) {
    const segs = Array.isArray(running.segments) ? running.segments : [];
    segs.forEach((s, i) => { if (isPrivFlag(s)) { const nx = segs[i + 1]; priv.push([num(s.start) || run, (nx && num(nx.start)) || 0]); } });
  }
  return {
    rule: set.rule, notify: set.notify, auto: set.auto, allBuckets: set.allBuckets,
    work, running: run || 0, privat: priv, privatAll: !!(pm && !pm.since),
    grace: GRACE_MS,
    places: (places || []).filter(hasPos).map((p) => ({ lat: p.lat, lng: p.lng, r: cleanRadius(p.radius, PLACE_RADIUS) })),
    at: now,
  };
}

/* ---------- Tage ---------- */

const pad = (n) => String(n).padStart(2, "0");
export function dayKeyOf(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function dayStart(key) { const [y, m, d] = String(key).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); }
