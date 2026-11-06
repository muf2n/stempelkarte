// Update 10d – Baustellen-Projektseite für den Assistenten: „baustelle_lesen“ (nur lesen).
// Logik (Zuordnung, Summen, Zeitleiste, Status) aus der gemeinsamen reinen Datei js/site-core.js;
// Datum/Uhrzeit hier immer in Wiener Zeit (time.js). Freitext (Notizen, Tagebuch, Foto-Notizen,
// Ansprechpartner) wird als untrusted_content abgegrenzt – das sind Daten, keine Anweisungen.
import { dayKey, clock, fmtKey, fmtKeyWd, hm } from "./time.js";
import { UserError } from "./logic.js";
import { RO, s, short, untrusted, pick } from "./util.js";
import * as SC from "./site.js";
import * as MAT from "./material.js";
import * as TR from "./trip.js";
import * as G from "./gallery.js";
import { photoIndex } from "./read.js";

const km = (v) => `${String(Math.round((Number(v) || 0) * 10) / 10).replace(".", ",")} km`;
const label = (st) => (SC.STATUS_META[st] || SC.STATUS_META.aktiv).l;

async function load(d) {
  const [places, entries, todos, settings, state, material, log, photos, albums] = await Promise.all([
    d.places(), d.entriesAll(), d.todos(), d.settings(), d.state().catch(() => ({})),
    d.alltag("material_items").catch(() => []), d.alltag("site_log").catch(() => []),
    photoIndex(d).catch(() => []), d.alltag("photo_albums").catch(() => []),
  ]);
  return { places, entries, todos, settings, running: state && state.running, material, log, photos, albums: albums.map(G.normAlbum).filter(Boolean) };
}

function overview(x, today) {
  if (!x.places.length) return "Es sind noch keine Orte/Baustellen gespeichert. Orte legst du in der App unter „Orte“ an.";
  const rows = x.places.map((p) => ({ p, st: SC.siteStatus(p, today), w: SC.workSummary(x.entries, p) }));
  const order = { aktiv: 0, geplant: 1, pausiert: 2, abgeschlossen: 3 };
  rows.sort((a, b) => order[a.st] - order[b.st] || (b.w.last || 0) - (a.w.last || 0));
  const out = [`${rows.length} ${rows.length === 1 ? "Baustelle/Ort" : "Baustellen/Orte"}:`];
  for (const r of rows) {
    const bits = [label(r.st)];
    if (r.w.totalMin) bits.push(`${hm(r.w.totalMin)} h an ${r.w.days} ${r.w.days === 1 ? "Tag" : "Tagen"}`);
    if (r.w.last) bits.push(`zuletzt ${fmtKey(dayKey(r.w.last))}`);
    if (SC.isKey(r.p.siteEnd) && r.st === "abgeschlossen") bits.push(`beendet ${fmtKey(r.p.siteEnd)}`);
    if (SC.runningHere(x.running, r.p)) bits.push("gerade eingestempelt");
    out.push(`- ${s(r.p.name) || "(ohne Namen)"}${s(r.p.addr) ? ` (${short(r.p.addr, 60)})` : ""}: ${bits.join(" · ")} [id: ${r.p.id}]`);
  }
  out.push("", "Details zu einer Baustelle: baustelle_lesen mit ort (Name) oder id.");
  return out.join("\n");
}

function detail(p, x, today, limit) {
  const st = SC.siteStatus(p, today);
  const w = SC.workSummary(x.entries, p);
  const mat = SC.siteMaterial(x.material, p);
  const ph = SC.sitePhotos(x.photos, p, x.albums);
  const ba = SC.beforeAfter(ph);
  let trips = { list: [], km: 0 };
  try { trips = SC.siteTrips(TR.tripsBetween(x.entries, 0, x.now + 864e5, x.settings || {}, x.places), p); } catch { /* ohne Fahrten */ }
  const td = SC.siteTodos(x.todos, p);
  const log = x.log.map(SC.normLog).filter((l) => l && l.placeId === p.id);
  const out = [`Baustelle „${s(p.name) || "(ohne Namen)"}“ [id: ${p.id}]`, `Status: ${label(st)}${s(p.siteStatus) ? "" : " (abgeleitet)"}`];
  if (s(p.addr)) out.push(`Adresse: ${s(p.addr)}`);
  if (SC.isKey(p.siteStart) || SC.isKey(p.siteEnd)) out.push(`Zeitraum: ${SC.isKey(p.siteStart) ? fmtKey(p.siteStart) : "offen"} – ${SC.isKey(p.siteEnd) ? fmtKey(p.siteEnd) : "offen"}`);
  if (s(p.contact)) out.push(`Ansprechpartner: ${untrusted("baustelle", short(p.contact, 120))}`);
  if (s(p.phone)) out.push(`Telefon: ${s(p.phone).replace(/[^\d+()\/ .-]/g, "").slice(0, 40)}`);
  const crew = [...new Set([...(Array.isArray(p.crew) ? p.crew.map(s).filter(Boolean) : []), ...w.people])];
  if (crew.length) out.push(`Team: ${untrusted("baustelle", crew.join(", "))}`);
  if (SC.runningHere(x.running, p)) out.push("Gerade läuft eine Schicht auf dieser Baustelle.");
  if (s(p.siteNotes)) out.push(`Notizen: ${untrusted("baustelle", short(p.siteNotes, 1500))}`);

  out.push("", `Arbeitszeit: ${hm(w.totalMin)} h an ${w.days} ${w.days === 1 ? "Tag" : "Tagen"}${w.first ? ` (${fmtKey(dayKey(w.first))} – ${fmtKey(dayKey(w.last))})` : ""}`);
  for (const r of w.list.slice(0, limit)) out.push(`- ${fmtKeyWd(dayKey(r.entry.start))} ${clock(r.entry.start)}–${clock(r.entry.end)}: ${hm(r.min)} h`);
  if (w.list.length > limit) out.push(`… und ${w.list.length - limit} ältere Einträge`);

  const line = (arr) => MAT.totals(arr).map(MAT.lineText).join(", ");
  out.push("", `Material: ${mat.items.length ? `${mat.open} offen, ${mat.verbaut} verbaut` : "nichts eingetragen"}`);
  if (mat.by.brauche.length) out.push(`- Fehlt noch: ${line(mat.by.brauche)}`);
  if (mat.by.besorgt.length) out.push(`- Besorgt: ${line(mat.by.besorgt)}`);
  if (mat.by.baustelle.length) out.push(`- Vor Ort: ${line(mat.by.baustelle)}`);
  if (mat.by.verbaut.length) out.push(`- Verbaut: ${line(mat.by.verbaut)}`);

  out.push(`Fotos: ${ph.length}${ba.vorher.length || ba.nachher.length ? ` (${ba.vorher.length} Vorher, ${ba.nachher.length} Nachher)` : ""}`);
  out.push(`Fahrten: ${trips.list.length}${trips.list.length ? ` · ${km(trips.km)}` : ""}`);
  if (td.einsaetze.length) out.push(`Einsätze: ${td.einsaetze.map((t) => `${fmtKey(t.date)}${t.dateTo && t.dateTo !== t.date ? `–${fmtKey(t.dateTo)}` : ""}`).join(", ")}`);
  if (td.aufgaben.length) {
    out.push(`Aufgaben (${td.aufgaben.filter((t) => !t.done).length} offen):`);
    for (const t of td.aufgaben.slice(0, 15)) out.push(`- ${t.done ? "[erledigt]" : "[offen]"} ${untrusted("baustelle", short(t.title, 120))}${t.date ? ` · ${fmtKey(t.date)}` : ""} [id: ${t.id}]`);
  }

  const ev = SC.buildTimeline({ place: p, entries: x.entries, running: x.running, photos: ph, material: mat.items, log, todos: [...td.aufgaben, ...td.einsaetze] });
  const recent = ev.slice(-limit * 2);
  out.push("", `Zeitleiste (neueste ${recent.length} von ${ev.length}):`);
  if (!recent.length) out.push("- noch keine Ereignisse");
  for (const e of recent.reverse()) {
    const free = e.kind === "log" || e.kind === "photo" || e.kind === "todo" || e.kind === "mat" || e.kind === "matdone";
    out.push(`- ${fmtKey(dayKey(e.ts))} ${clock(e.ts)} ${e.kind === "log" ? "Tagebuch: " : ""}${free ? untrusted("baustelle", short(e.text, 300)) : e.text}`);
  }
  return out.join("\n");
}

const TOOL_BAUSTELLE = {
  name: "baustelle_lesen",
  title: "Baustelle lesen",
  description: "Baustellen-Projektseite der App (nur lesen): ohne ort/id eine Übersicht aller Baustellen mit Status (Geplant/Aktiv/Pausiert/Abgeschlossen), Stunden und ID; mit ort (Name unscharf) oder id die Details: Ansprechpartner, Telefon, Zeitraum, Team, Notizen, Arbeitszeiten, Material (fehlt/vor Ort/verbaut), Fotos (Vorher/Nachher), Fahrten, Aufgaben/Einsätze und die Zeitleiste mit Tagebuch-Einträgen.",
  inputSchema: {
    type: "object",
    properties: {
      ort: { type: "string", description: "Name der Baustelle (unscharf), z. B. \"Huber\"" },
      id: { type: "string", description: "ID der Baustelle (aus der Übersicht)" },
      limit: { type: "number", description: "Wie viele Arbeitstage/Ereignisse (Standard 10, höchstens 50)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const x = { ...(await load(d)), now: d.now };
    if (!s(args.ort) && !s(args.id)) return overview(x, today);
    if (!x.places.length) throw new UserError("Es sind noch keine Baustellen/Orte gespeichert.");
    const p = pick(x.places, { id: args.id, name: args.ort }, (q) => s(q.name), "Baustelle");
    const lim = Math.max(1, Math.min(50, Math.round(Number(args.limit) || 10)));
    return detail(p, x, today, lim);
  },
};

export const SITE_TOOLS = [TOOL_BAUSTELLE];
