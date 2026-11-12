// Update 17 – „Wie lange war ich wo?“ – reine Logik (kein DOM). Genutzt von Heute, Einträge und Übersicht.
// Aus Einträgen (entries mit segments) werden Blöcke gebaut: { kind: work|drive|act, label, icon, placeKey, start, end, min }.
// Ort eines Abschnitts: gespeicherter Ort (placeId) > Ortsname am Abschnitt > Ort des Eintrags > Adresse > „Ohne Ort“.
// Pausen sind nur als Summe gespeichert (pauseMin) – sie werden pro Eintrag angezeigt und von der Arbeitszeit am
// längsten Arbeitsblock dieses Eintrags abgezogen (so stimmt die Summe pro Ort mit der Nettozeit überein).
import { isDriving } from "./travel.js";

const WORK = /^(arbeiten|arbeit)$/i;
const s = (v) => (v == null ? "" : String(v)).trim();

export const PALETTE = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#0f766e", "#9333ea"];

function placeOf(seg, e, places) {
  const pid = (seg && seg.placeId) || (e && e.placeId) || null;
  const p = pid && (places || []).find((x) => x && x.id === pid);
  if (p) { const n = s(p.name); return { key: "p:" + p.id, label: n || "Ort", icon: /\b(firma|werkstatt|betrieb|büro|buero|lager|zentrale)\b/i.test(n) ? "🏢" : /\b(schule|berufsschule|lbs)\b/i.test(n) ? "🏫" : /\b(zuhause|daheim|home)\b/i.test(n) ? "🏠" : "🏗️" }; }
  const name = s(seg && seg.place) || s(e && e.place) || s(seg && seg.loc && seg.loc.addr) || s(e && e.inLoc && e.inLoc.addr);
  return name ? { key: "n:" + name.toLowerCase(), label: name.split(",")[0].slice(0, 60), icon: "📍" } : { key: "none", label: "Ohne Ort", icon: "❔" };
}

/** Blöcke eines Eintrags. `now` für laufende Schichten (end fehlt). */
export function entryBlocks(e, places, now = Date.now()) {
  if (!e || !Number.isFinite(Number(e.start))) return [];
  if (e.kind && e.kind !== "work") return [];
  const end = Number.isFinite(Number(e.end)) ? Number(e.end) : now;
  const segs = (Array.isArray(e.segments) ? e.segments : []).filter((x) => x && Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  const raw = segs.length ? segs.map((x, i) => ({ seg: x, start: Math.max(x.start, Number(e.start)), end: Math.min(Number.isFinite(x.end) ? x.end : (segs[i + 1] ? segs[i + 1].start : end), end) }))
    : [{ seg: { activity: "Arbeiten" }, start: Number(e.start), end }];
  const out = [];
  for (const r of raw) {
    if (!(r.end > r.start)) continue;
    const act = s(r.seg.activity) || "Arbeiten";
    const pl = placeOf(r.seg, e, places);
    const kind = isDriving(r.seg) ? "drive" : WORK.test(act) ? "work" : "act";
    const b = { kind, label: kind === "drive" ? "Fahrt" : pl.label, act: kind === "act" ? act : "", icon: kind === "drive" ? "🚗" : pl.icon, placeKey: kind === "drive" ? "drive" : pl.key,
      start: r.start, end: r.end, min: (r.end - r.start) / 60000, entryId: e.id, running: !Number.isFinite(Number(e.end)) };
    const last = out[out.length - 1];
    if (last && last.kind === b.kind && last.placeKey === b.placeKey && last.act === b.act && Math.abs(last.end - b.start) < 60000) { last.end = b.end; last.min += b.min; }
    else out.push(b);
  }
  // Pause vom längsten Nicht-Fahrt-Block abziehen
  const pause = Math.max(0, Number(e.pauseMin) || 0);
  if (pause && out.length) {
    const tgt = out.filter((b) => b.kind !== "drive").sort((a, b) => b.min - a.min)[0] || out[0];
    tgt.pauseMin = Math.min(pause, tgt.min); tgt.min = Math.max(0, tgt.min - pause);
  }
  return out;
}

/** Tag: alle Blöcke (chronologisch) + Summen je Ort. */
export function dayline(entries, places, now = Date.now()) {
  const blocks = (entries || []).flatMap((e) => entryBlocks(e, places, now)).sort((a, b) => a.start - b.start);
  const pauseMin = (entries || []).filter((e) => e && (!e.kind || e.kind === "work")).reduce((n, e) => n + (Number(e.pauseMin) || 0), 0);
  return { blocks, totals: totals(blocks), pauseMin, first: blocks[0] ? blocks[0].start : null, last: blocks.length ? blocks[blocks.length - 1].end : null };
}

/** Summen je Ort (Fahrt als eigener Posten), absteigend nach Zeit. */
export function totals(blocks) {
  const m = new Map();
  for (const b of blocks) {
    const k = b.placeKey;
    const cur = m.get(k) || { key: k, label: b.kind === "drive" ? "Fahrten" : b.label, icon: b.icon, min: 0, days: new Set(), drive: b.kind === "drive" };
    cur.min += b.min;
    cur.days.add(new Date(b.start).toDateString());
    m.set(k, cur);
  }
  return [...m.values()].map((x) => ({ ...x, days: x.days.size })).sort((a, b) => Number(a.drive) - Number(b.drive) || b.min - a.min);
}

/** Summen je Ort für einen Zeitraum [from, to) (ms). */
export function placeTotals(entries, places, from, to, now = Date.now()) {
  const es = (entries || []).filter((e) => e && Number(e.start) >= from && Number(e.start) < to);
  return totals(es.flatMap((e) => entryBlocks(e, places, now)));
}

/** Farbe je Ort – stabil über den Schlüssel (gleicher Ort = gleiche Farbe überall). */
export function colorFor(key) {
  if (key === "drive") return "#64748b";
  if (key === "none") return "#94a3b8";
  let h = 0; for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** „4 h 30“ / „45 min“ – gut lesbar. */
export function dur(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${String(r).padStart(2, "0")}` : ""}` : `${r} min`;
}
