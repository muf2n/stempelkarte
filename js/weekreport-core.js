// Update 10 – Automatischer Wochenbericht (Berichtsheft-Eintrag). Reine ESM-Datei ohne DOM:
// genutzt von der Web-App (js/views/weekreport.js) UND vom Server (tools/mcp/src/weekreport.js re-exportiert sie).
//
// Eingang sind echte Daten – nichts wird erfunden:
//   rows      Zeilen Mo–So aus buildWeek (report.js bzw. tools/mcp/src/logic.js): { key, acts, places, people, tags, min, hol }
//   entries   Arbeitszeit-Einträge (für Abschnitte „Arbeiten/Autofahren“, Orte, Notizen)
//   dayKeyOf  ts → "YYYY-MM-DD" (App: lokale Zeit, Server: Wiener Zeit)
//   places    gespeicherte Orte (Name zur placeId)
//   siteLog   Baustellen-Tagebuch (Alltag „site_log“: { placeId, ts, text })
//   material  Material (Alltag „material_items“; nur status "verbaut" mit dayKey zählt)
//   photos    Foto-Index (dayKey, placeId, place, note – nie Bilddaten)
//
// Gespeichert wird je Woche in der Alltag-Sammlung „berichtsheft“, Dokument-ID = Wochenschlüssel ("2026-W45"):
//   { id, week, days: { "2026-11-02": "Text", … }, src: { key: "auto"|"claude"|"edit" }, status: "entwurf"|"abgegeben",
//     submittedAt, updated }
// Einstellungen (Ich-Form/neutral) im Dokument „prefs“: { id: "prefs", style: "ich"|"neutral" }.

import { totals as matTotals, lineText } from "./alltag/material-core.js";

export const COLLECTION = "berichtsheft";
export const PREFS_ID = "prefs";
export const WEEK_RE = /^(\d{4})-W(\d{2})$/;
export const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const STYLES = ["neutral", "ich"];
export const TEXT_MAX = 1500;
export const WORK = "Arbeiten";
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const DAY = 86400000;

const s = (v) => String(v ?? "").trim();
const pad = (n) => String(n).padStart(2, "0");
const fold = (v) => s(v).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

/* ---------- Datum / Woche (reine Schlüssel-Rechnung, zeitzonenfrei) ---------- */

function utcOf(k) { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }
function keyOfUtc(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function addDaysKey(k, n) { return keyOfUtc(utcOf(k) + n * DAY); }
export function wdOfKey(k) { return new Date(utcOf(k)).getUTCDay(); }
export function isWeekKey(w) {
  const m = WEEK_RE.exec(s(w));
  return !!m && +m[2] >= 1 && +m[2] <= 53 && weekKeyOf(mondayOfWeek(w)) === s(w);
}

/** "YYYY-MM-DD" → ISO-Wochenschlüssel "2026-W45". */
export function weekKeyOf(k) {
  const t = new Date(utcOf(k));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${pad(week)}`;
}

/** Montag ("YYYY-MM-DD") einer ISO-Woche "2026-W45" (ohne Gültigkeitsprüfung). */
export function mondayOfWeek(w) {
  const m = WEEK_RE.exec(s(w));
  if (!m) return null;
  const jan4 = Date.UTC(+m[1], 0, 4);
  const wd = new Date(jan4).getUTCDay() || 7;
  return keyOfUtc(jan4 - (wd - 1) * DAY + (+m[2] - 1) * 7 * DAY);
}

/** Die 7 Tage (Mo–So) einer Woche. */
export function weekDays(w) {
  const mo = mondayOfWeek(w);
  return mo ? Array.from({ length: 7 }, (_, i) => addDaysKey(mo, i)) : [];
}

export function shiftWeek(w, n) { return weekKeyOf(addDaysKey(mondayOfWeek(w), 7 * n)); }
export function kwOf(w) { const m = WEEK_RE.exec(s(w)); return m ? +m[2] : 0; }
export function fmtKey(k, withYear = true) { return KEY_RE.test(s(k)) ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${withYear ? k.slice(0, 4) : ""}` : ""; }
export function hm(min) { const m = Math.max(0, Math.round(Number(min) || 0)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; }

/* ---------- Helfer ---------- */

function addUniq(list, v) {
  const t = s(v);
  if (t && !list.some((x) => fold(x) === fold(t))) list.push(t);
  return list;
}
const isDrive = (a) => /fahr/i.test(s(a));
const isWorkEntry = (e) => !!e && (!e.kind || e.kind === "work");
function isPrivTrip(e) {
  return !!e && (e.privateTrip === true || (e.tripOnly === true && Array.isArray(e.segments) && e.segments.length > 0 && e.segments.every((x) => x && x.private === true)));
}
function netOf(e) {
  const dur = ((Number(e.end) || 0) - (Number(e.start) || 0)) / 60000;
  return Math.max(0, dur - (Number(e.pauseMin) || 0));
}
function placeById(places, id) { return id ? (places || []).find((p) => p && p.id === id) || null : null; }
function siteName(places, id, text) {
  const p = placeById(places, id);
  if (p && s(p.name)) return s(p.name);
  return s(text);
}
function sentence(t) {
  const x = s(t).replace(/\s+/g, " ");
  if (!x) return "";
  const c = x[0].toUpperCase() + x.slice(1);
  return /[.!?…]$/.test(c) ? c : c + ".";
}
function joinList(list) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} und ${list[list.length - 1]}`;
}

/* ---------- Woche sammeln ---------- */

const TYPE_ORDER = ["krank", "urlaub", "zeitausgleich", "schule", "feiertag"];
export const TYPE_META = Object.freeze({
  arbeit: { e: "🔧", l: "Arbeit" },
  schule: { e: "🎒", l: "Berufsschule" },
  urlaub: { e: "🌴", l: "Urlaub" },
  krank: { e: "🤒", l: "Krankenstand" },
  zeitausgleich: { e: "⏳", l: "Zeitausgleich" },
  feiertag: { e: "🎌", l: "Feiertag" },
  frei: { e: "🌿", l: "Frei" },
});

/**
 * Strukturierte Wochen-Zusammenfassung.
 * → { week, kw, year, from, to, days: [Tag], totals, sites: [{ name, min, days, photos }] }
 * Tag = { key, wd, wdLong, date, type, school, schoolLabel, holiday, min, worked, sites: [{name, min}], segments: [{activity, min, drive}],
 *         notes, people, log: [{ site, text }], material: [{ line, site }], photos: { count, notes }, empty }
 */
export function buildWeekReport({ week, rows = [], entries = [], dayKeyOf, places = [], siteLog = [], material = [], photos = [] } = {}) {
  const keys = weekDays(week);
  if (!keys.length) throw new Error("Ungültige Woche: " + week);
  const kOf = typeof dayKeyOf === "function" ? dayKeyOf : (ts) => keyOfUtc(Number(ts));
  const inWeek = new Set(keys);
  const rowOf = new Map((rows || []).filter((r) => r && r.key).map((r) => [r.key, r]));

  const byDay = new Map(keys.map((k) => [k, { entries: [], log: [], material: [], photos: [] }]));
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !Number.isFinite(Number(e.start)) || isPrivTrip(e)) continue;
    const k = kOf(Number(e.start));
    if (inWeek.has(k)) byDay.get(k).entries.push(e);
  }
  for (const x of Array.isArray(siteLog) ? siteLog : []) {
    const ts = Number(x && x.ts);
    if (!x || !s(x.text) || !Number.isFinite(ts) || ts <= 0) continue;
    const k = kOf(ts);
    if (inWeek.has(k)) byDay.get(k).log.push({ ...x, ts });
  }
  for (const x of Array.isArray(material) ? material : []) {
    if (x && x.status === "verbaut" && s(x.name) && inWeek.has(s(x.dayKey))) byDay.get(x.dayKey).material.push(x);
  }
  for (const p of Array.isArray(photos) ? photos : []) {
    const k = p && (KEY_RE.test(s(p.dayKey)) ? p.dayKey : Number(p.ts) > 0 ? kOf(Number(p.ts)) : "");
    if (k && inWeek.has(k)) byDay.get(k).photos.push(p);
  }

  const siteAgg = new Map(); // fold(name) → { name, min, days:Set, photos }
  const agg = (name) => {
    const f = fold(name);
    if (!siteAgg.has(f)) siteAgg.set(f, { name, min: 0, days: new Set(), photos: 0 });
    return siteAgg.get(f);
  };

  const days = keys.map((k) => {
    const r = rowOf.get(k) || { key: k, acts: [], places: [], people: [], tags: [], min: 0, hol: null };
    const b = byDay.get(k);
    const tags = Array.isArray(r.tags) ? r.tags : [];
    const tagKinds = new Set(tags.map((t) => t && t.kind));
    const list = b.entries.slice().sort((a, c) => a.start - c.start);
    const work = list.filter(isWorkEntry);
    const notes = [], people = [], segAgg = new Map(), siteMin = new Map();
    for (const n of Array.isArray(r.people) ? r.people : []) addUniq(people, n);
    for (const e of list) {
      for (const n of Array.isArray(e.people) ? e.people : []) addUniq(people, n);
      if (s(e.note)) addUniq(notes, e.note);
    }
    for (const e of work) {
      const net = netOf(e);
      const segs = (Array.isArray(e.segments) ? e.segments : []).filter((x) => x && Number.isFinite(Number(x.start)) && !x.private);
      const ownSite = siteName(places, e.placeId, e.place || (e.inLoc && e.inLoc.addr));
      if (segs.length <= 1) {
        const a = s(segs[0] && segs[0].activity) || WORK;
        const site = segs[0] ? siteName(places, segs[0].placeId, segs[0].place) || ownSite : ownSite;
        segAgg.set(a, (segAgg.get(a) || 0) + net);
        if (site && !isDrive(a)) siteMin.set(site, (siteMin.get(site) || 0) + net);
        continue;
      }
      const withEnd = segs.map((x, i) => ({ ...x, start: Number(x.start), end: Number.isFinite(Number(x.end)) ? Number(x.end) : (segs[i + 1] ? Number(segs[i + 1].start) : Number(e.end)) }));
      const gross = withEnd.reduce((a, x) => a + Math.max(0, (x.end - x.start) / 60000), 0);
      const f = gross > 0 ? net / gross : 0;
      for (const x of withEnd) {
        const m = Math.max(0, (x.end - x.start) / 60000) * f;
        const a = s(x.activity) || WORK;
        segAgg.set(a, (segAgg.get(a) || 0) + m);
        const site = siteName(places, x.placeId, x.place) || ownSite;
        if (site && !isDrive(a)) siteMin.set(site, (siteMin.get(site) || 0) + m);
      }
    }
    const segments = [...segAgg.entries()].map(([activity, min]) => ({ activity, min: Math.round(min), drive: isDrive(activity) }))
      .filter((x) => x.min > 0 || !work.length);
    const sites = [...siteMin.entries()].map(([name, min]) => ({ name, min: Math.round(min) })).sort((a, c) => c.min - a.min);
    const log = b.log.sort((a, c) => a.ts - c.ts).map((x) => ({ site: siteName(places, x.placeId, x.place), text: s(x.text) }));
    for (const x of log) if (x.site && !sites.some((y) => fold(y.name) === fold(x.site))) sites.push({ name: x.site, min: 0 });
    const materialList = matTotals(b.material).map((x) => ({ line: lineText(x) }));
    const phNotes = [];
    for (const p of b.photos.slice().sort((a, c) => (Number(a.ts) || 0) - (Number(c.ts) || 0))) addUniq(phNotes, s(p.note).slice(0, 200));
    for (const p of b.photos) { const n = siteName(places, p.placeId, p.place); if (n) agg(n).photos++; }

    const school = tagKinds.has("schule");
    const schoolLabel = school ? (Array.isArray(r.acts) && r.acts.find((a) => /schule|block|lehrgang|kurs/i.test(a))) || "Berufsschule" : "";
    const worked = work.length > 0;
    let type = worked ? "arbeit" : "frei";
    if (!worked) for (const t of TYPE_ORDER) if (tagKinds.has(t)) { type = t; break; }
    for (const x of sites) { const a = agg(x.name); a.min += x.min; a.days.add(k); }
    const wd = wdOfKey(k);
    const empty = !worked && type === "frei" && !log.length && !materialList.length && !b.photos.length && !notes.length;
    return {
      key: k, wd: WD[wd], wdLong: WD_LONG[wd], date: fmtKey(k), type, school, schoolLabel, holiday: r.hol || null,
      min: Math.round(Number(r.min) || 0), worked, sites, segments, notes, people, log, material: materialList,
      photos: { count: b.photos.length, notes: phNotes.slice(0, 6) }, empty, weekend: wd === 0 || wd === 6,
    };
  });

  const totals = {
    min: days.reduce((a, d) => a + d.min, 0),
    workDays: days.filter((d) => d.worked).length,
    schoolDays: days.filter((d) => d.school).length,
    leaveDays: days.filter((d) => d.type === "urlaub").length,
    zaDays: days.filter((d) => d.type === "zeitausgleich").length,
    sickDays: days.filter((d) => d.type === "krank").length,
    holidays: days.filter((d) => d.holiday).length,
    driveMin: days.reduce((a, d) => a + d.segments.filter((x) => x.drive).reduce((b2, x) => b2 + x.min, 0), 0),
    photos: days.reduce((a, d) => a + d.photos.count, 0),
    material: days.reduce((a, d) => a + d.material.length, 0),
    log: days.reduce((a, d) => a + d.log.length, 0),
  };
  const sites = [...siteAgg.values()].map((x) => ({ name: x.name, min: Math.round(x.min), days: x.days.size, photos: x.photos }))
    .filter((x) => x.days || x.photos).sort((a, c) => c.min - a.min || c.days - a.days);
  const m = WEEK_RE.exec(week);
  return { week, kw: +m[2], year: +m[1], from: keys[0], to: keys[6], days, totals, sites };
}

/* ---------- Entwurf (Vorlagen, ohne KI) ---------- */

const PHRASES = {
  neutral: {
    krank: "Krankenstand.", urlaub: "Urlaub.", zeitausgleich: "Zeitausgleich.",
    feiertag: (h) => `Feiertag${h ? ` (${h})` : ""}.`,
    school: (l) => `${l}: Unterricht laut Stundenplan.`,
    siteWork: (site, acts) => `${site ? `${site}: ` : ""}${acts}`,
    siteOnly: (site) => `Mitarbeit vor Ort (${site}).`,
    generic: "Mitarbeit bei Elektroinstallationsarbeiten.",
    drive: (t) => `Fahrten zur Baustelle/zum Material (${t} h).`,
    material: (l) => `Verbautes Material: ${l}.`,
    photos: (n, notes) => `Fotodokumentation: ${n} ${n === 1 ? "Foto" : "Fotos"}${notes ? ` (${notes})` : ""}.`,
    people: (p) => `Gemeinsam mit ${p}.`,
    other: (acts) => `${acts}.`,
  },
  ich: {
    krank: "Ich war im Krankenstand.", urlaub: "Ich hatte Urlaub.", zeitausgleich: "Ich hatte Zeitausgleich.",
    feiertag: (h) => `Feiertag${h ? ` (${h})` : ""} – ich hatte frei.`,
    school: (l) => `Ich war in der ${l === "Berufsschule" ? "Berufsschule" : `${l} (Berufsschule)`}.`,
    siteWork: (site, acts) => `${site ? `Vor Ort (${site}) habe ich mitgearbeitet: ` : "Meine Tätigkeiten: "}${acts}`,
    siteOnly: (site) => `Ich habe vor Ort (${site}) mitgearbeitet.`,
    generic: "Ich habe bei Elektroinstallationsarbeiten mitgearbeitet.",
    drive: (t) => `Ich war ${t} h mit dem Auto unterwegs (Baustelle/Material).`,
    material: (l) => `Verbaut habe ich: ${l}.`,
    photos: (n, notes) => `Ich habe die Arbeit mit ${n} ${n === 1 ? "Foto" : "Fotos"} dokumentiert${notes ? ` (${notes})` : ""}.`,
    people: (p) => `Ich habe mit ${p} zusammengearbeitet.`,
    other: (acts) => `Außerdem: ${acts}.`,
  },
};

/** Text für einen Tag aus den echten Daten (Berichtsheft-Stil, kurz). style: "neutral" | "ich". */
export function draftDay(day, style = "neutral") {
  if (!day) return "";
  const P = PHRASES[style === "ich" ? "ich" : "neutral"];
  const out = [];
  if (!day.worked) {
    if (day.type === "krank" || day.type === "urlaub" || day.type === "zeitausgleich") out.push(P[day.type]);
    else if (day.type === "schule") out.push(P.school(day.schoolLabel || "Berufsschule"));
    else if (day.type === "feiertag") out.push(P.feiertag(day.holiday));
    for (const n of day.notes) out.push(sentence(n));
    for (const x of day.log) out.push(sentence(x.text));
    return out.filter(Boolean).join(" ");
  }
  if (day.school) out.push(P.school(day.schoolLabel || "Berufsschule"));
  const acts = [];
  for (const n of day.notes) addUniq(acts, s(n).replace(/[.\s]+$/, ""));
  for (const x of day.log) addUniq(acts, s(x.text).replace(/[.\s]+$/, ""));
  const mainSite = day.sites.length ? day.sites.map((x) => x.name).slice(0, 2).join(" und ") : "";
  if (acts.length) out.push(sentence(P.siteWork(mainSite, acts.join("; "))));
  else if (mainSite) out.push(P.siteOnly(mainSite));
  else out.push(P.generic);
  const other = day.segments.filter((x) => !x.drive && x.activity !== WORK && !acts.some((a) => fold(a) === fold(x.activity))).map((x) => x.activity);
  if (other.length) out.push(P.other(other.join(", ")));
  const drive = day.segments.filter((x) => x.drive).reduce((a, x) => a + x.min, 0);
  if (drive >= 5) out.push(P.drive(hm(drive)));
  if (day.material.length) out.push(P.material(day.material.map((x) => x.line).join(", ")));
  if (day.photos.count) out.push(P.photos(day.photos.count, day.photos.notes.slice(0, 3).join("; ")));
  if (day.people.length) out.push(P.people(joinList(day.people)));
  return out.join(" ");
}

/** Entwurf für alle Tage → { key: text } (leere Tage = ""). */
export function draftWeek(summary, style = "neutral") {
  const out = {};
  for (const d of summary.days) out[d.key] = draftDay(d, style);
  return out;
}

/* ---------- Speichern ---------- */

export function normStyle(v) { return STYLES.includes(v) ? v : "neutral"; }

/** Gespeichertes Wochen-Dokument säubern (fehlt → leerer Entwurf). */
export function normDoc(x, week) {
  const w = s((x && x.week) || week);
  const keys = new Set(weekDays(w));
  const days = {}, src = {};
  const xd = x && x.days && typeof x.days === "object" ? x.days : {};
  const xs = x && x.src && typeof x.src === "object" ? x.src : {};
  for (const k of keys) {
    if (typeof xd[k] === "string") days[k] = xd[k].slice(0, TEXT_MAX);
    if (["auto", "claude", "edit"].includes(xs[k])) src[k] = xs[k];
  }
  return {
    id: w, week: w, days, src,
    status: x && x.status === "abgegeben" ? "abgegeben" : "entwurf",
    submittedAt: x && Number(x.submittedAt) > 0 ? Number(x.submittedAt) : null,
    updated: x && Number(x.updated) > 0 ? Number(x.updated) : null,
    saved: !!x,
  };
}

/** Texte zusammenführen: gespeicherter Text gewinnt, sonst der automatische Entwurf. */
export function mergeTexts(doc, draft) {
  const out = {};
  for (const k of Object.keys(draft)) out[k] = typeof doc.days[k] === "string" ? doc.days[k] : draft[k];
  return out;
}

/* ---------- Für Claude (nur Struktur, keine Fotos) ---------- */

/** Kompakte, strukturierte Zusammenfassung als Text für den Server-Modus "bericht". */
export function summaryForAi(summary, { style = "neutral", trade = "", year = 0 } = {}) {
  const lines = [
    `Woche: KW ${summary.kw}/${summary.year} (${fmtKey(summary.from)} – ${fmtKey(summary.to)})`,
    `Form: ${style === "ich" ? "Ich-Form" : "neutral (ohne „ich“)"}`,
    trade ? `Lehrberuf: ${trade}` : null,
    year ? `Lehrjahr: ${year}.` : null,
    `Wochensumme: ${hm(summary.totals.min)} h`,
    "",
  ].filter((x) => x !== null);
  for (const d of summary.days) {
    lines.push(`### ${d.key} (${d.wd} ${fmtKey(d.key, false)})`);
    const t = TYPE_META[d.type] || TYPE_META.frei;
    lines.push(`Art: ${d.worked && d.school ? "Arbeit + Berufsschule" : t.l}${d.holiday ? ` (${d.holiday})` : ""}${d.schoolLabel && d.schoolLabel !== "Berufsschule" ? ` (${d.schoolLabel})` : ""} · ${hm(d.min)} h`);
    if (d.sites.length) lines.push(`Baustellen: ${d.sites.map((x) => x.min ? `${x.name} (${hm(x.min)} h)` : x.name).join(", ")}`);
    if (d.segments.length && d.worked) lines.push(`Abschnitte: ${d.segments.map((x) => `${x.activity} ${hm(x.min)} h`).join(", ")}`);
    if (d.notes.length) lines.push(`Notizen: ${d.notes.join(" | ")}`);
    if (d.log.length) lines.push(`Tagebuch: ${d.log.map((x) => x.text).join(" | ")}`);
    if (d.material.length) lines.push(`Verbaut: ${d.material.map((x) => x.line).join(", ")}`);
    if (d.photos.count) lines.push(`Fotos: ${d.photos.count}${d.photos.notes.length ? ` (Notizen: ${d.photos.notes.join(" | ")})` : ""}`);
    if (d.people.length) lines.push(`Mit: ${d.people.join(", ")}`);
    if (d.empty) lines.push("(keine Daten)");
  }
  return lines.join("\n");
}

/**
 * Antwort von Claude („### 2026-11-02 …“ + Text) in Tagestexte zerlegen.
 * Nur Tage dieser Woche; unbekannte/fehlende bleiben weg. → { key: text }
 */
export function parseAiDays(reply, week) {
  const keys = new Set(weekDays(week));
  const out = {};
  let cur = null;
  const flush = (buf) => { if (cur && keys.has(cur)) out[cur] = buf.join("\n").trim().slice(0, TEXT_MAX); };
  let buf = [];
  for (const raw of String(reply || "").split(/\r?\n/)) {
    const m = /^\s*(?:#{1,4}\s*)?\**\s*(\d{4}-\d{2}-\d{2})\b[^\n]*?(?:[:\-–]\s*(.*))?$/.exec(raw);
    if (m) {
      flush(buf);
      cur = m[1];
      buf = [];
      const rest = s(m[2]).replace(/^\(.*?\)\s*[:\-–]?\s*/, "").replace(/\*+$/, "");
      if (rest && !/^\(?\w{2} \d{2}\.\d{2}\.?\)?$/.test(rest)) buf.push(rest);
      continue;
    }
    if (cur) buf.push(raw.replace(/^\s*[-*•]\s+/, "– ").trimEnd());
  }
  flush(buf);
  for (const k of Object.keys(out)) if (/^\(?keine daten\)?\.?$/i.test(out[k]) || /^[–-]$/.test(out[k])) out[k] = "";
  return out;
}

/* ---------- Export ---------- */

/** Text zum Kopieren (Berichtsheft-Stil). head = { name, trade, company, year } */
export function reportText(summary, texts, head = {}, { status = "entwurf", notes = "" } = {}) {
  const lines = [
    `Ausbildungsnachweis – KW ${summary.kw} (${fmtKey(summary.from)} – ${fmtKey(summary.to)})`,
    s(head.name) ? `Name: ${s(head.name)}` : null,
    s(head.trade) ? `Lehrberuf: ${s(head.trade)}` : null,
    s(head.company) ? `Lehrbetrieb: ${s(head.company)}` : null,
    head.year ? `Lehrjahr: ${head.year}.` : null,
    "",
  ].filter((x) => x !== null);
  for (const d of summary.days) {
    const t = s(texts && texts[d.key]);
    if (!t && d.empty) continue;
    lines.push(`${d.wdLong}, ${fmtKey(d.key)}${d.min > 0 ? ` (${hm(d.min)} h)` : ""}:`);
    lines.push(t || "–", "");
  }
  lines.push(`Wochensumme: ${hm(summary.totals.min)} h`);
  if (s(notes)) lines.push("", "Ergänzungen:", s(notes));
  if (status === "abgegeben") lines.push("", "Status: abgegeben ✅");
  return lines.join("\n");
}

/* ---------- Dashboard-Tipp ---------- */

/** Freitag ab 12 Uhr (oder Sa/So), Woche hat Arbeitstage und ist noch nicht abgegeben → Tipp zeigen. */
export function wantsFridayTip(now, { submitted = false, workedDays = 0 } = {}) {
  const d = new Date(now instanceof Date ? now.getTime() : Number(now));
  const wd = d.getDay();
  if (submitted || workedDays <= 0) return false;
  return (wd === 5 && d.getHours() >= 12) || wd === 6;
}
