// Update 9 – „Claude darf (fast) alles sehen“: zusätzliche Lese-Werkzeuge (Galerie, Unterwegs, Fahrtenbuch,
// Urlaub, Taggeld, Einstellungen, globale Suche) sowie Bereiche für schule_lesen/geld_lesen.
// Ausgaben kompakt und deutsch formatiert, mit Begrenzung/Seiten. NIE: Bilddaten (thumb/data), Tresor,
// geheime Adressen (iCal), Schlüssel/Tokens, Bank-Sitzungen.
import {
  dayKey, keyToTs, addDays, fmtKey, fmtKeyWd, fmtDateTime, clock, hm, signedH, eur, dec, isKey, parseMonth, shiftMonth,
  monthLabel, diffDays, mondayOf, wdOf, WD, isoWeek, weekKey, parseKey, vienna,
} from "./time.js";
import {
  UserError, creditMin, dailyTargetMin, schoolCreditMin, readSchool, readApprentice, apprenticeYear, activitiesOf, kindLabel,
  balanceNumbers, holidayName,
} from "./logic.js";
import { RO, s, pad2, short, paged, countdown, dateArg, txNote } from "./util.js";
import { best, norm, score } from "./match.js";
import * as TR from "./trip.js";
import * as UW from "./unterwegs.js";
import * as G from "./gallery.js";
import * as MC from "./moneycore.js";
import * as PM from "./privat.js";
import { normCalendars } from "./cal.js";

const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const fold = (v) => norm(v);

/** Felder des Foto-Index OHNE Vorschaubild – große Bilder (photos/…) werden nie geladen. */
export const PHOTO_INDEX_MASK = G.INDEX_FIELDS.filter((f) => f !== "thumb");
export const SCHOOL_DOC_MASK = ["title", "subject", "type", "size", "name", "date"];

export function photoIndex(d) { return d.listMasked("a_photo_index", PHOTO_INDEX_MASK); }

/** Geheime Adresse (iCal-Abo o. Ä.) nur als Host zeigen – nie Pfad oder Schlüssel. */
export function maskSecretUrl(url) {
  try { return `${new URL(String(url)).hostname}/… (Adresse verborgen)`; } catch { return "(Adresse verborgen)"; }
}

const monthRange = (mk) => { const [y, m] = mk.split("-").map(Number); const from = `${mk}-01`; const nx = shiftMonth(mk, 1); return { from, toEx: `${nx}-01`, y, m }; };
function monthArg(v, today) {
  const mk = parseMonth(v, today);
  if (!mk) throw new UserError(`Monat „${s(v)}“ verstehe ich nicht (z. B. "2026-11", "Oktober", "letzter").`);
  return mk;
}

/* ===================== Galerie ===================== */

async function galleryData(d) {
  const [albums, folders, items, settings] = await Promise.all([
    d.alltag("photo_albums").catch(() => []), d.alltag("photo_folders").catch(() => []), photoIndex(d).catch(() => []), d.settings(),
  ]);
  const al = albums.map(G.normAlbum).filter(Boolean);
  const fo = G.sortFolders(folders.map(G.normFolder).filter(Boolean));
  const list = items.filter((x) => x && x.id).map((x) => ({ ...x, ts: Number(x.ts) || 0 })).sort((a, b) => b.ts - a.ts);
  return { albums: al, folders: fo, items: list, settings, byId: new Map(al.map((a) => [a.id, a])), folderIds: new Set(fo.map((f) => f.id)) };
}

function photoLine(it, g) {
  const names = G.cleanIds(it.albumIds).map((id) => g.byId.get(id)).filter(Boolean).map((a) => a.name);
  const bits = [it.ts ? fmtDateTime(it.ts) : (isKey(it.dayKey) ? fmtKey(it.dayKey) : "ohne Datum")];
  if (names.length) bits.push(`Album: ${names.join(", ")}`);
  const where = s(it.place) || s(it.addr);
  if (where) bits.push(short(where, 60));
  return `- ${bits.join(" · ")}${s(it.note) ? ` · Notiz: „${short(it.note, 100)}“` : ""} (Foto-ID ${it.id})`;
}

const TOOL_GALERIE = {
  name: "galerie_lesen",
  title: "Galerie lesen",
  description: "Galerie der App (nur Text, nie Bilder): Kategorien (z. B. Baustellen, Berufsschule, Privat) mit Anzahl Alben/Fotos, Alben mit Fotoanzahl, Adresse und ID, die aktive Kategorie für neue Fotos und die neuesten Fotos mit Datum, Album, Adresse/Ort und Notiz. Mit album oder kategorie nur diese, mit suche nach Notiz/Adresse/Album filtern. Seitenweise über limit/seite.",
  inputSchema: {
    type: "object",
    properties: {
      album: { type: "string", description: "Nur Fotos dieses Albums (Name unscharf oder ID)" },
      kategorie: { type: "string", description: "Nur Alben/Fotos dieser Kategorie, z. B. \"Baustellen\"" },
      suche: { type: "string", description: "Fotos nach Notiz, Adresse, Ort oder Albumname filtern" },
      limit: { type: "number", description: "Fotos pro Seite (Standard 10, höchstens 100)" },
      seite: { type: "number", description: "Seite (Standard 1)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const g = await galleryData(d);
    if (!g.items.length && !g.albums.length) return "In der Galerie sind noch keine Fotos.";
    const out = [`Galerie – ${g.items.length} ${g.items.length === 1 ? "Foto" : "Fotos"} in ${g.albums.length} ${g.albums.length === 1 ? "Album" : "Alben"}`];
    const act = G.resolveActiveFolder({ folders: g.folders, gallery: g.settings.gallery || {}, ignorePlace: true });
    const af = act.id ? g.folders.find((f) => f.id === act.id) : null;
    out.push(`Neue Fotos gehen nach: ${af ? `${af.emoji} ${af.name}` : "keine Kategorie"}`);
    let albums = g.albums, items = g.items, folder = null;
    if (s(args.kategorie)) {
      const m = best(args.kategorie, g.folders, (f) => f.name, 55);
      if (!m) throw new UserError(`Keine Kategorie passt zu „${s(args.kategorie)}“. Vorhanden: ${g.folders.map((f) => f.name).join(", ") || "keine"}.`);
      folder = m.item;
      albums = G.albumsInFolder(g.albums, folder.id, g.folderIds);
      items = G.itemsOfFolder(g.items, folder.id, g.albums, g.folderIds);
    }
    if (s(args.album)) {
      const a = g.albums.find((x) => x.id === s(args.album)) || (best(args.album, albums, (x) => x.name, 55) || {}).item;
      if (!a) throw new UserError(`Kein Album passt zu „${s(args.album)}“.`);
      const list = G.itemsOfAlbum(g.items, a.id, g.byId).sort((x, y) => y.ts - x.ts);
      const f = g.folders.find((x) => x.id === a.folderId);
      out.push("", `Album „${a.name}“${f ? ` (Kategorie ${f.emoji} ${f.name})` : " (ohne Kategorie)"} – ${list.length} Fotos${a.addr ? ` · ${a.addr}` : ""} (Album-ID ${a.id})`);
      const p = paged(list, args, 10);
      out.push(...p.items.map((it) => photoLine(it, g)));
      if (p.more) out.push(`… weitere Fotos: seite ${p.page + 1}`);
      return out.join("\n");
    }
    if (!folder) {
      out.push("", "Kategorien:");
      for (const f of g.folders) {
        const st = G.folderStats(g.items, f.id, g.albums, g.folderIds, g.byId);
        out.push(`- ${f.emoji} ${f.name}: ${st.albums} Alben, ${st.count} Fotos${st.last ? `, zuletzt ${fmtKey(dayKey(st.last))}` : ""}`);
      }
      const none = G.folderStats(g.items, G.OHNE_KAT, g.albums, g.folderIds, g.byId);
      if (none.count || none.albums) out.push(`- Ohne Kategorie: ${none.albums} Alben, ${none.count} Fotos`);
    }
    const rows = albums.map((a) => ({ a, st: G.albumStats(g.items, a, g.byId) })).sort((x, y) => y.st.last - x.st.last);
    out.push("", `${folder ? `Alben in ${folder.emoji} ${folder.name}` : "Alben"} (${rows.length}):`);
    for (const { a, st } of rows.slice(0, 25)) {
      const f = !folder && g.folders.find((x) => x.id === a.folderId);
      out.push(`- ${a.emoji ? a.emoji + " " : ""}${a.name}: ${st.count} Fotos${st.last ? `, zuletzt ${fmtKey(dayKey(st.last))}` : ""}${f ? ` · ${f.name}` : ""}${a.addr ? ` · ${short(a.addr, 60)}` : ""} (Album-ID ${a.id})`);
    }
    if (rows.length > 25) out.push(`… und ${rows.length - 25} weitere Alben`);
    if (s(args.suche)) {
      const q = fold(args.suche);
      items = items.filter((it) => {
        const names = G.cleanIds(it.albumIds).map((id) => (g.byId.get(id) || {}).name).join(" ");
        return fold([it.note, it.addr, it.place, names].join(" ")).includes(q) || score(args.suche, it.note) >= 75;
      });
    }
    const p = paged(items, args, 10);
    out.push("", `${s(args.suche) ? `Fotos zu „${s(args.suche)}“` : "Neueste Fotos"} (${p.total}):`);
    out.push(...(p.items.length ? p.items.map((it) => photoLine(it, g)) : ["- keine"]));
    if (p.more) out.push(`… weitere Fotos: seite ${p.page + 1}`);
    return out.join("\n");
  },
};

/* ===================== Unterwegs ===================== */

async function uwData(d) {
  const [trips, packing, parking, fuel, places] = await Promise.all(["travel_trips", "travel_packing", "travel_parking", "travel_fuel", "travel_places"]
    .map((n) => d.alltag(n).catch(() => [])));
  return { trips, packing, parking, fuel, places };
}
const hasLL = (r) => r && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng)) && r.lat !== null && r.lng !== null;

function tripLine(t, today, packing) {
  const st = UW.tripStatus(t, today);
  const bits = [UW.dateRange(t) || "ohne Datum", st.label];
  const n = UW.nights(t);
  if (n) bits.push(`${n} ${n === 1 ? "Nacht" : "Nächte"}`);
  const sp = UW.spent(t);
  if (Number(t.budget) > 0) bits.push(`Budget ${eur(t.budget)}, ausgegeben ${eur(sp)}`);
  else if (sp) bits.push(`ausgegeben ${eur(sp)}`);
  const l = packing.find((x) => x.tripId === t.id);
  if (l) { const p = UW.packProgress(l); bits.push(`Packliste ${p.done}/${p.total} (${p.pct} %)`); }
  if ((t.plan || []).length) bits.push(`${t.plan.length} Programmpunkte`);
  return `- ${t.emoji ? t.emoji + " " : ""}${s(t.title) || s(t.dest) || "Reise"}${s(t.dest) && s(t.dest) !== s(t.title) ? ` (${s(t.dest)})` : ""}: ${bits.join(" · ")} (Reise-ID ${t.id})`;
}
function packLines(l, { onlyOpen = false } = {}) {
  const p = UW.packProgress(l);
  const out = [`Packliste „${s(l.title) || "Packliste"}“ – ${p.done}/${p.total} gepackt (${p.pct} %) (Listen-ID ${l.id})`];
  for (const c of l.cats || []) {
    const items = (c.items || []).filter((i) => i && (!onlyOpen || !i.done));
    if (!items.length) continue;
    out.push(`  ${c.emoji || "•"} ${c.name || "Sonstiges"}: ${items.map((i) => `${i.done ? "☑" : "☐"} ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ")}`);
  }
  return out;
}
function parkLines(rec, now) {
  const where = hasLL(rec) ? (s(rec.addr) || `${Number(rec.lat).toFixed(5)}, ${Number(rec.lng).toFixed(5)}${rec.acc ? ` (±${Math.round(rec.acc)} m)` : ""}`) : (s(rec.addr) || "ohne Ort");
  const bits = [`geparkt ${fmtDateTime(rec.ts)}`, where];
  if (s(rec.level)) bits.push(`Ebene ${s(rec.level)}`);
  if (s(rec.spot)) bits.push(`Platz ${s(rec.spot)}`);
  if (Number(rec.until) > 0) bits.push(Number(rec.until) > now ? `Parkschein bis ${clock(rec.until)} (noch ${Math.round((rec.until - now) / 60000)} min)` : `Parkschein abgelaufen seit ${clock(rec.until)}`);
  if (s(rec.note)) bits.push(`„${short(rec.note, 80)}“`);
  return bits.join(" · ");
}

const UW_BEREICHE = ["uebersicht", "reisen", "packliste", "parken", "tanken", "adressen"];
const TOOL_UNTERWEGS = {
  name: "unterwegs_lesen",
  title: "Unterwegs lesen",
  description: "Bereich Unterwegs der App: Reisen mit Countdown, Nächten, Budget und Packlisten-Fortschritt; Packlisten mit allen Gegenständen (☐/☑); letzter Parkplatz (Adresse/Koordinaten, Ebene, Parkschein); Tanken mit Verbrauch l/100 km, €/km und letzten Tankungen; gespeicherte Adressen (Arzt, Werkstatt, Familie …) mit Telefon. bereich wählt den Teil (Standard: uebersicht), suche filtert Adressen/Packlisten.",
  inputSchema: {
    type: "object",
    properties: {
      bereich: { type: "string", enum: UW_BEREICHE, description: "uebersicht (Standard), reisen, packliste, parken, tanken, adressen" },
      suche: { type: "string", description: "Adressen: Name/Kategorie/Telefon; Packliste: Listen- oder Reisename" },
      nur_offen: { type: "boolean", description: "Packliste: nur noch nicht gepackte Gegenstände" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const b = s(args.bereich) || "uebersicht";
    const u = await uwData(d);
    const out = [];
    const trips = UW.sortTrips(u.trips.filter((t) => t && t.id), today);
    const lists = u.packing.filter((l) => l && l.id && l.kind !== "template");
    const parking = [...u.parking].filter((x) => x && x.ts).sort((a, c) => c.ts - a.ts);
    const fills = u.fuel.filter((f) => f && isKey(f.date)).sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : (Number(c.km) || 0) - (Number(a.km) || 0)));
    if (b === "uebersicht") {
      out.push(`Unterwegs – Stand ${fmtKey(today)}`);
      const next = trips.find((t) => ["running", "today", "future"].includes(UW.tripStatus(t, today).kind));
      out.push(next ? `Nächste Reise: ${tripLine(next, today, u.packing).slice(2)}` : `Reisen: ${trips.length ? `${trips.length} gespeichert, keine geplant` : "keine"}`);
      const act = parking.find((x) => x.active);
      out.push(act ? `Auto: ${parkLines(act, d.now)}` : "Parkplatz: keiner gemerkt");
      const fs = UW.fuelStats(u.fuel);
      out.push(fills.length ? `Tanken: ${fills.length} Tankungen${fs.avgL100 != null ? ` · Ø ${dec(fs.avgL100, 1)} l/100 km · ${dec(fs.eurKm, 2)} €/km` : ""} · zuletzt ${fmtKey(fills[0].date)} ${eur(fills[0].total)}` : "Tanken: noch nichts eingetragen");
      out.push(`Adressen: ${u.places.length} gespeichert · Packlisten: ${lists.length}`);
      out.push("(Details: bereich reisen, packliste, parken, tanken oder adressen)");
      return out.join("\n");
    }
    if (b === "reisen") {
      if (!trips.length) return "Es sind noch keine Reisen angelegt (Unterwegs → Reisen).";
      const up = trips.filter((t) => UW.tripStatus(t, today).kind !== "past");
      const past = trips.filter((t) => UW.tripStatus(t, today).kind === "past");
      out.push(`Reisen (${trips.length}):`, ...up.map((t) => tripLine(t, today, u.packing)));
      if (past.length) out.push("Vergangen:", ...past.slice(0, 5).map((t) => tripLine(t, today, u.packing)), ...(past.length > 5 ? [`… und ${past.length - 5} ältere`] : []));
      for (const t of up.slice(0, 2)) {
        const plan = UW.planByDay(t).filter((x) => x.items.length);
        if (plan.length) out.push(`Programm „${s(t.title) || "Reise"}“: ${plan.map((x) => `${x.day ? fmtKey(x.day) : "ohne Tag"}: ${x.items.map((i) => `${i.time ? i.time + " " : ""}${s(i.place || i.note)}`).join(", ")}`).join(" | ")}`);
      }
      return out.join("\n");
    }
    if (b === "packliste") {
      if (!lists.length) return "Es gibt noch keine Packliste (Unterwegs → Packliste).";
      let sel = lists;
      if (s(args.suche)) {
        sel = lists.filter((l) => { const t = u.trips.find((x) => x.id === l.tripId); return score(args.suche, l.title) >= 60 || (t && (score(args.suche, t.title) >= 60 || score(args.suche, t.dest) >= 60)); });
        if (!sel.length) throw new UserError(`Keine Packliste passt zu „${s(args.suche)}“. Vorhanden: ${lists.map((l) => l.title).join(", ")}.`);
      }
      for (const l of sel.slice(0, 4)) { const t = u.trips.find((x) => x.id === l.tripId); out.push(...packLines(l, { onlyOpen: args.nur_offen === true }), ...(t ? [`  Reise: ${s(t.title)} ${UW.dateRange(t)}`] : []), ""); }
      if (sel.length > 4) out.push(`… und ${sel.length - 4} weitere Listen (mit suche eingrenzen)`);
      return out.join("\n").trim();
    }
    if (b === "parken") {
      if (!parking.length) return "Es ist kein Parkplatz gemerkt.";
      const act = parking.find((x) => x.active);
      out.push(act ? `Dein Auto: ${parkLines(act, d.now)}` : "Gerade ist kein Parkplatz aktiv (zuletzt weggefahren).");
      const hist = parking.filter((x) => !x.active).slice(0, 5);
      if (hist.length) out.push("Verlauf:", ...hist.map((x) => `- ${parkLines(x, d.now)}`));
      return out.join("\n");
    }
    if (b === "tanken") {
      if (!fills.length) return "Beim Tanken ist noch nichts eingetragen (Unterwegs → Tanken).";
      const fs = UW.fuelStats(u.fuel);
      out.push(`Tanken – ${fills.length} Tankungen`);
      if (fs.avgL100 != null) out.push(`Verbrauch Ø ${dec(fs.avgL100, 1)} l/100 km · Kosten ${dec(fs.eurKm, 2)} €/km (über ${Math.round(fs.km)} km zwischen Volltankungen)`);
      else out.push("Verbrauch: braucht mindestens zwei Volltankungen mit Kilometerstand.");
      const mk = today.slice(0, 7);
      const months = UW.fuelMonths(u.fuel, mk, 3);
      out.push(`Monate: ${months.map((m) => `${monthLabel(m.mk)} ${eur(m.sum)}`).join(" · ")}`);
      out.push("Letzte Tankungen:");
      for (const f of fills.slice(0, 8)) {
        const ppl = UW.pricePerL(f);
        const row = fs.rows.get(f.id);
        out.push(`- ${fmtKey(f.date)}: ${dec(f.liters, 2)} l · ${eur(f.total)}${ppl ? ` (${dec(ppl, 3)} €/l)` : ""} · km-Stand ${Math.round(Number(f.km) || 0)}${f.full ? " · voll" : ""}${s(f.station) ? ` · ${s(f.station)}` : ""}${row ? ` · ${dec(row.l100, 1)} l/100 km` : ""}`);
      }
      return out.join("\n");
    }
    // adressen
    if (!u.places.length) return "Es sind noch keine Adressen gespeichert (Unterwegs → Adressen).";
    const res = UW.searchPlaces(u.places, s(args.suche));
    if (!res.length) return `Keine Adresse passt zu „${s(args.suche)}“.`;
    out.push(`Adressen (${res.length}${s(args.suche) ? ` zu „${s(args.suche)}“` : ""}):`);
    for (const p of res.slice(0, 40)) {
      const c = UW.placeCat(p.cat);
      out.push(`- ${p.fav ? "★ " : ""}${s(p.name)} (${c.emoji} ${c.name})${s(p.address) ? ` · ${s(p.address)}` : ""}${s(p.phone) ? ` · Tel. ${s(p.phone)}` : ""}${s(p.notes) ? ` · ${short(p.notes, 80)}` : ""}`);
    }
    if (res.length > 40) out.push(`… und ${res.length - 40} weitere (mit suche eingrenzen)`);
    return out.join("\n");
  },
};

/* ===================== Fahrtenbuch & Taggeld ===================== */

const SRC_LABEL = { manual: "manuell", road: "Straße", est: "≈ Luftlinie" };

export async function monthTrips(d, mk) {
  const { from, toEx } = monthRange(mk);
  const [entries, settings, places] = await Promise.all([d.entriesRange(keyToTs(from), keyToTs(toEx)), d.settings(), d.places()]);
  const trips = TR.markReturns(TR.tripsBetween(entries, keyToTs(from), keyToTs(toEx), settings, places), dayKey);
  return { trips, settings, entries, places };
}
export const tripRef = (t) => t.key; // "<entryId>#<rawIndex>"

function tripText(t, settings, multiVeh) {
  const a = TR.fromLabel(t), b = TR.toLabel(t);
  const v = TR.tripVehicle(t, settings);
  const km = t.km == null ? "km unbekannt" : `${t.source === "est" ? "≈ " : ""}${TR.fmtKmD(t.km)} km (${SRC_LABEL[t.source] || "?"})`;
  const bits = [`${clock(t.start)}${Number.isFinite(t.end) ? "–" + clock(t.end) : ""}`, `${t.isReturn ? "↩ " : ""}${a.main} → ${b.main}`, km,
    t.private ? "privat" : `Zweck: ${t.purpose}${t.purposeSet ? "" : " (Vorschlag)"}`];
  if (v && multiVeh) bits.push(`Fahrzeug: ${v.name}`);
  else if (v && v.type === "privat") bits.push(`${v.name} (Privatauto)`);
  return `- ${bits.join(" · ")} (fahrt ${tripRef(t)})`;
}

const TOOL_FAHRTENBUCH = {
  name: "fahrtenbuch_lesen",
  title: "Fahrtenbuch lesen",
  description: "Fahrtenbuch eines Monats (aus den Abschnitten „Autofahren“): je Fahrt Uhrzeit, von → nach, km (manuell/Straße/Luftlinie), Zweck, beruflich/privat und Fahrzeug, dazu Monatssumme (beruflich/privat), Kilometergeld (Privatauto × Satz) und Fahrzeuge. Jede Fahrt hat eine Kennung „fahrt“ (z. B. e1#0) für fahrt_bearbeiten. Ohne Angabe: aktueller Monat.",
  inputSchema: {
    type: "object",
    properties: {
      monat: { type: "string", description: "z. B. \"2026-11\", \"Oktober\", \"letzter\"" },
      art: { type: "string", enum: ["alle", "beruflich", "privat"], description: "Standard alle" },
      suche: { type: "string", description: "Filter nach Ort/Adresse/Zweck" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const mk = monthArg(args.monat, today);
    const { trips: all, settings } = await monthTrips(d, mk);
    const tot = TR.totals(all, settings);
    const out = [`Fahrtenbuch – ${monthLabel(mk)}: ${tot.count} ${tot.count === 1 ? "Fahrt" : "Fahrten"}, ${tot.approx ? "≈ " : ""}${TR.fmtKmD(tot.km)} km`];
    if (tot.count) out.push(`beruflich ${TR.fmtKmD(tot.bizKm)} km (${tot.bizN}) · privat ${TR.fmtKmD(tot.privKm)} km (${tot.privN})${tot.unknownN ? ` · ${tot.unknownN} ohne km` : ""}`);
    if (tot.showKmgeld) out.push(`Kilometergeld: ${TR.fmtKmD(tot.kmgeldKm)} km × ${eur(tot.kmRate)} = ${eur(tot.kmgeld)}`);
    let list = TR.filterTrips(all, s(args.suche), settings);
    const art = s(args.art) || "alle";
    if (art === "beruflich") list = list.filter((t) => !t.private);
    if (art === "privat") list = list.filter((t) => t.private);
    const vs = TR.readVehicles(settings);
    if (!all.length) out.push("", "Keine Fahrten in diesem Monat. Fahrten entstehen aus Abschnitten „Autofahren“ beim Stempeln.");
    else if (!list.length) out.push("", "Keine Fahrt passt zu dieser Auswahl.");
    for (const gr of TR.groupByDay(list, dayKey)) {
      out.push("", `${fmtKeyWd(gr.key)} – ${gr.count} ${gr.count === 1 ? "Fahrt" : "Fahrten"}, ${gr.approx ? "≈ " : ""}${TR.fmtKmD(gr.km)} km`);
      for (const t of gr.trips) out.push(tripText(t, settings, vs.length > 1));
    }
    if (vs.length) {
      const def = TR.defaultVehicle(settings);
      out.push("", `Fahrzeuge: ${vs.map((v) => `${TR.vehicleLabel(v)} (${TR.VEHICLE_TYPES[v.type]}${def && def.id === v.id ? ", Standard" : ""})`).join("; ")}`);
    }
    return out.join("\n");
  },
};

const LEVEL_TXT = { none: "kein Taggeld", part: "teilweise", full: "volles Taggeld" };
const TOOL_TAGGELD = {
  name: "taggeld_lesen",
  title: "Taggeld lesen",
  description: "Taggeld (Diäten) eines Monats wie in der App: je Arbeitstag Abwesenheitsstunden außerhalb der Heim-Orte, Stufe (kein/teilweise/volles Taggeld, manuell oder automatisch) und Betrag, dazu Monatssumme, eingestellte Sätze und Kilometergeld. Hinweis: maßgeblich bleibt der Lohnzettel bzw. Kollektivvertrag. Ohne Angabe: aktueller Monat.",
  inputSchema: { type: "object", properties: { monat: { type: "string", description: "z. B. \"2026-11\", \"Oktober\", \"letzter\"" } }, additionalProperties: false },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const mk = monthArg(args.monat, today);
    const { from, toEx } = monthRange(mk);
    const [{ trips, settings, entries, places }, days] = await Promise.all([monthTrips(d, mk), d.days().catch(() => ({}))]);
    const a = TR.readAllowance(settings);
    const out = [`Taggeld – ${monthLabel(mk)}`];
    if (!a.enabled) out.push("Taggeld ist in der App ausgeschaltet (Einstellungen → Taggeld & Kilometer).");
    else {
      const map = TR.allowanceByDay({ entries, places, days, settings, dayKey }, keyToTs(from), keyToTs(toEx));
      const sum = TR.allowanceSummary(map);
      const rate = (v) => (v == null ? "Betrag nicht eingetragen" : eur(v));
      out.push(`Regel: ab ${dec(a.minHours, 1)} h weg = teilweise (${rate(a.ratePart)}), ab ${dec(a.fullHours, 1)} h = voll (${rate(a.rateFull)})`);
      out.push(`Summe: ${sum.part}× teilweise, ${sum.full}× voll = ${eur(sum.sum)}${sum.missingRate ? " (+ Tage ohne eingetragenen Betrag)" : ""}`);
      const rows = [...map.values()].sort((x, y) => (x.key < y.key ? -1 : 1));
      if (rows.length) out.push("", "Tage:", ...rows.map((r) => `- ${fmtKeyWd(r.key)}: ${dec(r.hours, 1)} h weg → ${LEVEL_TXT[r.level]}${r.manual ? " (manuell)" : ""}${r.level !== "none" ? ` · ${r.amount == null ? "ohne Betrag" : eur(r.amount)}` : ""}`));
      else out.push("Keine Arbeitstage in diesem Monat.");
    }
    const tot = TR.totals(trips, settings);
    if (tot.showKmgeld) out.push("", `Kilometergeld: ${TR.fmtKmD(tot.kmgeldKm)} km × ${eur(tot.kmRate)} = ${eur(tot.kmgeld)}`);
    out.push("(Keine Steuer-/Rechtsberatung – maßgeblich sind Lohnzettel und Kollektivvertrag.)");
    return out.join("\n");
  },
};

/* ===================== Urlaub & Krankenstand ===================== */

export function readLeave(settings) {
  const st = settings || {};
  const l = st.leave && typeof st.leave === "object" ? st.leave : {};
  const apVd = Number(st.apprentice && st.apprentice.vacationDays);
  let dpy = Number(l.daysPerYear);
  if (!Number.isFinite(dpy) || dpy < 0 || dpy > 60) dpy = Number.isFinite(apVd) && apVd >= 0 && apVd <= 60 ? apVd : 25;
  const ym = Math.trunc(Number(l.yearStartMonth));
  const co = Number(l.carryOver);
  return {
    daysPerYear: Math.round(dpy * 2) / 2,
    yearStartMonth: ym >= 1 && ym <= 12 ? ym : 1,
    carryOver: Number.isFinite(co) && co >= -60 && co <= 120 ? Math.round(co * 2) / 2 : 0,
  };
}
export function fmtDays(n) {
  const v = Math.round(n * 2) / 2;
  const a = Math.abs(v), whole = Math.floor(a), half = a - whole >= 0.5;
  return (v < 0 ? "−" : "") + (half ? (whole ? `${whole}½` : "½") : String(whole));
}
/** Wie views/leave.js kindDays (mit Tagesschlüsseln statt Date). */
function kindDays(entries, settings, kind, fk, tk) {
  const byDay = new Map(), all = new Map();
  for (const e of entries) {
    if (!e || !Number.isFinite(e.start)) continue;
    const k = dayKey(e.start);
    if (k < fk || k >= tk) continue;
    all.set(k, (all.get(k) || 0) + creditMin(e));
    if ((e.kind || "work") !== kind) continue;
    if (!byDay.has(k)) byDay.set(k, { key: k, credit: 0 });
    byDay.get(k).credit += creditMin(e);
  }
  const out = [...byDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const x of out) {
    const t = dailyTargetMin(x.key, settings) || schoolCreditMin(x.key, settings) || 0;
    x.value = kind === "urlaub" ? (t <= 0 ? 0 : x.credit > 0 && x.credit <= t / 2 + 1 ? 0.5 : 1) : 1;
    x.zaMin = kind === "zeitausgleich" ? Math.max(0, dailyTargetMin(x.key, settings) - (all.get(x.key) || 0)) : 0;
  }
  return out;
}
/** Tagesliste → zusammenhängende Bereiche „02.11.–06.11.“ (Wochenenden dazwischen überbrückt). */
function ranges(list) {
  const out = [];
  for (const x of list) {
    const last = out[out.length - 1];
    if (last && diffDays(last.to, x.key) <= 3 && [...Array(diffDays(last.to, x.key) - 1)].every((_, i) => [0, 6].includes(wdOf(addDays(last.to, i + 1))))) { last.to = x.key; last.n += x.value; }
    else out.push({ from: x.key, to: x.key, n: x.value });
  }
  return out.map((r) => (r.from === r.to ? fmtKey(r.from) : `${fmtKey(r.from)} – ${fmtKey(r.to)}`) + (r.n !== 1 && r.from !== r.to ? ` (${fmtDays(r.n)} T.)` : r.n === 0.5 ? " (½ T.)" : ""));
}

const TOOL_URLAUB = {
  name: "urlaub_lesen",
  title: "Urlaub & Krankenstand",
  description: "Urlaubskonto wie die Karte „Urlaub & Krankenstand“ der App: Anspruch im Urlaubsjahr (+ Rest Vorjahr), verbraucht bis heute, geplant (mit Datum), übrig; Krankenstandstage und Zeitausgleich (Tage und verbrauchte Stunden) im Kalenderjahr sowie der aktuelle Stand des Überstundenkontos.",
  inputSchema: { type: "object", properties: { jahr: { type: "number", description: "Kalenderjahr (Standard: aktuelles)" } }, additionalProperties: false },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const [settings, entries, st] = await Promise.all([d.settings(), d.entriesAll({ light: true }), d.state()]);
    const lv = readLeave(settings);
    const y = args.jahr ? Math.round(Number(args.jahr)) : parseKey(today).y;
    if (!(y >= 2000 && y <= 2100)) throw new UserError("jahr bitte als z. B. 2026 angeben.");
    const ref = y === parseKey(today).y ? today : `${y}-12-31`;
    const { y: ry, m: rm } = parseKey(ref);
    const ly0 = rm >= lv.yearStartMonth ? ry : ry - 1;
    const lyFrom = `${ly0}-${pad2(lv.yearStartMonth)}-01`, lyTo = `${ly0 + 1}-${pad2(lv.yearStartMonth)}-01`;
    const vac = kindDays(entries, settings, "urlaub", lyFrom, lyTo);
    const taken = vac.filter((x) => x.key <= today), planned = vac.filter((x) => x.key > today);
    const sum = (l) => l.reduce((a, x) => a + x.value, 0);
    const entitled = lv.daysPerYear + lv.carryOver;
    const left = entitled - sum(taken) - sum(planned);
    const label = lv.yearStartMonth === 1 ? `Urlaubsjahr ${ly0}` : `Urlaubsjahr ${pad2(lv.yearStartMonth)}/${ly0} – ${pad2(lv.yearStartMonth === 1 ? 12 : lv.yearStartMonth - 1)}/${ly0 + 1}`;
    const out = [`${label}: Anspruch ${fmtDays(lv.daysPerYear)} Tage${lv.carryOver ? ` + Rest Vorjahr ${fmtDays(lv.carryOver)}` : ""} = ${fmtDays(entitled)}`];
    out.push(`Verbraucht ${fmtDays(sum(taken))} · geplant ${fmtDays(sum(planned))} · übrig ${fmtDays(left)} ${Math.abs(left) === 1 ? "Tag" : "Tage"}${left < 0 ? " (Achtung: mehr als Anspruch)" : ""}`);
    if (taken.length) out.push(`Genommen: ${ranges(taken).join(", ")}`);
    if (planned.length) out.push(`Geplant: ${ranges(planned).join(", ")}`);
    const sick = kindDays(entries, settings, "krank", `${y}-01-01`, `${y + 1}-01-01`);
    out.push("", `Krankenstand ${y}: ${sick.length} ${sick.length === 1 ? "Tag" : "Tage"}${sick.length ? ` (${ranges(sick).join(", ")})` : ""}`);
    const za = kindDays(entries, settings, "zeitausgleich", `${y}-01-01`, `${y + 1}-01-01`);
    out.push(`Zeitausgleich ${y}: ${za.length} ${za.length === 1 ? "Tag" : "Tage"}, ${hm(za.reduce((a, x) => a + x.zaMin, 0))} h Überstunden verbraucht${za.length ? ` (${ranges(za).join(", ")})` : ""}`);
    const b = balanceNumbers(settings, entries, st.running, d.now);
    out.push(`Überstundenkonto jetzt: ${signedH(b.total)}`);
    return out.join("\n");
  },
};

/* ===================== Einstellungen ===================== */

export function readReminders(settings) {
  const r = (settings && settings.reminders) || {};
  const st = r.start || {}, en = r.end || {}, pa = r.pause || {};
  const h = Number(en.afterHours);
  return {
    enabled: r.enabled !== false,
    start: { enabled: st.enabled !== false, time: /^\d{1,2}:\d{2}$/.test(String(st.time || "")) ? String(st.time) : "07:30" },
    end: { enabled: en.enabled !== false, afterHours: Number.isFinite(h) && h > 0 ? h : 10 },
    pause: { enabled: pa.enabled === true },
  };
}
const daysText = (list) => (list && list.length ? [...list].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => WD[x]).join(", ") : "keine");
const yn = (v) => (v ? "an" : "aus");

export function settingsText(settings, extra = {}) {
  const today = extra.today;
  const out = [];
  const wd = Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4, 5];
  const wt = Number(settings.weeklyTarget ?? 38.5);
  out.push("Arbeitszeit:", `- Arbeitstage: ${daysText(wd)} · Wochenstunden ${dec(wt, 1)} h (Tagessoll ${wd.length ? hm((wt * 60) / wd.length) : "0:00"} h) · Feiertage ${settings.holidays === false ? "nicht berücksichtigt" : "frei"}`);
  if (isKey(settings.balanceStart)) out.push(`- Überstundenkonto ab ${fmtKey(settings.balanceStart)}${Number(settings.balanceOffsetMin) ? `, Startsaldo ${signedH(Number(settings.balanceOffsetMin))}` : ""}`);
  out.push(`- Tätigkeiten: ${activitiesOf(settings).join(", ")}`);
  const sc = readSchool(settings);
  out.push("Berufsschule:", `- Schultage: ${sc ? daysText(sc.days) : "keine"}`);
  if (sc && sc.blocks.length) out.push(...[...sc.blocks].sort((a, b) => (a.from < b.from ? -1 : 1)).map((b) => `- Block ${fmtKey(b.from)} – ${fmtKey(b.to)}${s(b.label) ? ` „${s(b.label)}“` : ""} (ID ${b.id || "?"})`));
  const ap = readApprentice(settings);
  const lj = today ? apprenticeYear(ap, today) : 0;
  out.push("Lehre:", `- ${ap.name || "Name fehlt"} · ${ap.trade || "Lehrberuf fehlt"} · ${ap.company || "Lehrbetrieb fehlt"} · Beginn ${ap.start ? fmtKey(ap.start) : "–"} · Dauer ${String(ap.years).replace(".5", "½")} Jahre${lj ? ` · jetzt ${lj}. Lehrjahr` : ""} · ${Object.keys(ap.notes).length} Berichtsheft-Notizen`);
  const lv = readLeave(settings);
  out.push("Urlaub:", `- Anspruch ${fmtDays(lv.daysPerYear)} Tage/Jahr · Urlaubsjahr ab Monat ${lv.yearStartMonth} · Rest Vorjahr ${fmtDays(lv.carryOver)}`);
  const rm = readReminders(settings);
  out.push("Erinnerungen:", `- Gesamt ${yn(rm.enabled)} · Einstempeln ${yn(rm.start.enabled)} um ${rm.start.time} · Ausstempeln ${yn(rm.end.enabled)} nach ${dec(rm.end.afterHours, 1)} h · Pause ${yn(rm.pause.enabled)}`);
  const ms = PM.readModeSchedule(settings);
  const md = PM.readMode(settings);
  out.push("Privat / Arbeit:", `- Zeitplan ${yn(ms.enabled)}${ms.enabled ? ` (Arbeit ${ms.from}–${ms.to} an Arbeitstagen, sonst privat)` : ` (${ms.from}–${ms.to})`} · Privatfahrten aufzeichnen ${yn(PM.recordPrivateTrips(settings))}${md && md.privat ? " · gerade Privat-Modus" : ""}`);
  const a = TR.readAllowance(settings);
  out.push("Taggeld & Kilometer:", `- Taggeld ${yn(a.enabled)} · teilweise ab ${dec(a.minHours, 1)} h ${a.ratePart == null ? "(ohne Betrag)" : eur(a.ratePart)} · voll ab ${dec(a.fullHours, 1)} h ${a.rateFull == null ? "(ohne Betrag)" : eur(a.rateFull)} · Kilometergeld ${eur(a.kmRate)}/km · eigenes Auto ${a.ownCar ? "ja" : "nein"} · Umwegfaktor ${dec(a.kmFactor, 2)} · Straßen-km ${yn(TR.readTripSettings(settings).roadKm)}`);
  const vs = TR.readVehicles(settings);
  if (vs.length) out.push(`- Fahrzeuge: ${vs.map((v) => TR.vehicleLabel(v) + ` (${TR.VEHICLE_TYPES[v.type]})`).join("; ")}`);
  const gal = settings.gallery || {};
  const folders = extra.folders || [];
  const act = G.resolveActiveFolder({ folders, gallery: gal, ignorePlace: true });
  const af = folders.find((f) => f.id === act.id);
  out.push("Galerie:", `- Automatisch einsortieren ${yn(gal.auto !== false)} · Radius ${G.cleanRadius(gal.radius, G.DEFAULT_RADIUS)} m · neue Fotos nach: ${af ? af.name : "keine Kategorie"}${folders.length ? ` (Kategorien: ${folders.map((f) => f.name).join(", ")})` : ""}`);
  const cals = normCalendars(settings.calendars);
  out.push("Kalender:", `- ${cals.map((c) => c.name).join(", ")}`);
  if (extra.feeds) out.push(`- iCal-Abos: ${extra.feeds.length ? extra.feeds.map((f) => `${s(f.name) || "Kalender"} (${f.visible === false ? "ausgeblendet" : "sichtbar"}, ${maskSecretUrl(f.url)})`).join("; ") : "keine"}`);
  if (extra.bank !== undefined) {
    const b = extra.bank;
    out.push("Bank:", `- ${b && b.linked ? `verbunden (${s(b.aspsp) || "Bank"}${b.valid_until ? `, Zugang gültig bis ${fmtKey(dayKey(Date.parse(b.valid_until)))}` : ""})` : "nicht verbunden"} – Verbinden/Trennen nur in der App`);
  }
  if (Array.isArray(settings.people) && settings.people.length) out.push("Personen:", `- ${settings.people.join(", ")}`);
  out.push("Nicht einsehbar (aus Sicherheitsgründen): Passwort-Tresor, App-Sperre/PIN, API-Schlüssel, Adressen der Kalender-Abos, Bank-Zugangsdaten, Google-Konto.");
  return out;
}

const TOOL_EINSTELLUNGEN = {
  name: "einstellungen_lesen",
  title: "Einstellungen lesen",
  description: "Zeigt die Einstellungen der App: Arbeitstage und Wochenstunden, Tätigkeiten, Berufsschultage und Schulblöcke (mit ID), Lehre (Name, Beruf, Betrieb, Beginn, Dauer), Urlaubsanspruch, Erinnerungen, Privat-Zeitplan, Taggeld-/Kilometersätze und Fahrzeuge, Galerie (aktive Kategorie), Kalender und iCal-Abos (Adresse verborgen) sowie ob die Bank verbunden ist. Geheimes (Tresor, PIN, Schlüssel, Feed-Adressen) wird nie angezeigt. Ändern: einstellung_aendern.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: RO,
  async run(_a, d) {
    const [settings, folders, feeds, bank] = await Promise.all([
      d.settings(), d.alltag("photo_folders").catch(() => []), d.doc("meta/ical_feeds").catch(() => null), d.doc("meta/bank").catch(() => null),
    ]);
    const fo = G.sortFolders(folders.map(G.normFolder).filter(Boolean));
    const fl = feeds && Array.isArray(feeds.feeds) ? feeds.feeds.filter((f) => f && f.id) : [];
    return ["Einstellungen", ...settingsText(settings, { today: dayKey(d.now), folders: fo, feeds: fl, bank })].join("\n");
  },
};

/* ===================== Schule: weitere Bereiche ===================== */

export async function schoolSection(d, bereich, args) {
  const today = dayKey(d.now);
  const meta = await d.alltag("school_meta").catch(() => []);
  const prefs = { abWeeks: false, abRef: null, ...(meta.find((x) => x.id === "prefs") || {}) };
  if (bereich === "stundenplan") {
    const tt = (await d.alltag("school_timetable")).filter((l) => l && s(l.subject));
    if (!tt.length) return "Der Stundenplan ist noch leer (Alltag → Schule → Stundenplan).";
    const out = ["Stundenplan"];
    if (prefs.abWeeks) {
      const ref = isKey(prefs.abRef) ? prefs.abRef : mondayOf(today);
      const w = Math.round(diffDays(mondayOf(ref), mondayOf(today)) / 7);
      out.push(`A/B-Wochen an – diese Woche ist ${((w % 2) + 2) % 2 === 0 ? "A" : "B"}-Woche`);
    }
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const l = tt.filter((x) => Number(x.weekday) === wd).sort((a, b) => (Number(a.period) || 0) - (Number(b.period) || 0));
      if (!l.length) continue;
      out.push(`${WD_LONG[wd]}:`);
      for (const x of l) {
        const p = Number(x.period) || 0, n = Math.max(1, Number(x.periods) || 1);
        out.push(`- ${p ? (n > 1 ? `${p}.–${p + n - 1}. Std` : `${p}. Std`) : ""}${s(x.from) ? ` ${s(x.from)}–${s(x.to)}` : ""} ${s(x.subject)}${s(x.room) ? ` · Raum ${s(x.room)}` : ""}${s(x.teacher) ? ` · ${s(x.teacher)}` : ""}${x.week ? ` · nur ${x.week}-Woche` : ""} (ID ${x.id})`.replace(/^- +/, "- "));
      }
    }
    return out.join("\n");
  }
  if (bereich === "noten") {
    const gr = (await d.alltag("school_grades")).filter((g) => Number(g.grade) >= 1 && Number(g.grade) <= 5);
    if (!gr.length) return "Noch keine Noten eingetragen.";
    const by = new Map();
    for (const g of gr) { const k = s(g.subject) || "Ohne Fach"; if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
    const out = ["Noten (1 = Sehr gut … 5 = Nicht genügend)"];
    for (const [sub, l] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0], "de"))) {
      let sm = 0, w = 0;
      for (const g of l) { const gw = Number(g.weight) > 0 ? Number(g.weight) : 1; sm += Number(g.grade) * gw; w += gw; }
      out.push(`${sub}: Ø ${dec(sm / w)}`);
      for (const g of l.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))) out.push(`- ${isKey(g.date) ? fmtKey(g.date) : "ohne Datum"}: ${g.grade}${s(g.kind) ? ` (${s(g.kind)})` : ""}${Number(g.weight) > 1 ? ` ×${g.weight}` : ""}${s(g.note) ? ` – ${short(g.note, 60)}` : ""} (ID ${g.id})`);
    }
    return out.join("\n");
  }
  if (bereich === "projekte") {
    const pj = await d.alltag("school_projects");
    if (!pj.length) return "Es sind keine Projekte angelegt (Alltag → Schule → Aufgaben → Projekte).";
    const out = ["Projekte"];
    for (const p of pj.sort((a, b) => String(a.due || "9").localeCompare(String(b.due || "9")))) {
      const st = Array.isArray(p.steps) ? p.steps : [];
      const done = st.filter((x) => x && x.done).length;
      out.push(`${s(p.subject) ? s(p.subject) + ": " : ""}„${s(p.title)}“ – ${done}/${st.length} Schritte${isKey(p.due) ? ` · fällig ${fmtKeyWd(p.due)} (${countdown(today, p.due)})` : ""} (Projekt-ID ${p.id})`);
      for (const x of st) if (x) out.push(`  ${x.done ? "☑" : "☐"} ${s(x.text)} (Schritt-ID ${x.id})`);
      if (s(p.note)) out.push(`  Notiz: ${short(p.note, 120)}`);
    }
    return out.join("\n");
  }
  if (bereich === "dokumente") {
    const docs = await d.listMasked("a_school_docs", SCHOOL_DOC_MASK);
    if (!docs.length) return "Es sind keine Schul-Dokumente gespeichert.";
    const out = [`Dokumente (${docs.length}) – nur Titel und Angaben, Dateiinhalte kann ich nicht öffnen:`];
    for (const x of docs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 50)) {
      out.push(`- ${s(x.title) || s(x.name) || "Dokument"}${s(x.subject) ? ` · ${s(x.subject)}` : ""}${s(x.type) ? ` · ${s(x.type).split("/").pop()}` : ""}${Number(x.size) ? ` · ${Math.round(Number(x.size) / 1024)} KB` : ""}${isKey(x.date) ? ` · ${fmtKey(x.date)}` : ""}`);
    }
    return out.join("\n");
  }
  // lernplan
  const [plan, sessions] = await Promise.all([d.alltag("school_plan").catch(() => []), d.alltag("school_sessions").catch(() => [])]);
  const out = ["Lernplan"];
  const up = plan.filter((p) => isKey(p.date) && p.date >= addDays(today, -1)).sort((a, b) => (a.date + (a.order || 0) < b.date + (b.order || 0) ? -1 : 1));
  if (!up.length) out.push("Keine geplanten Lerneinheiten.");
  for (const p of up.slice(0, 30)) out.push(`- ${p.done ? "☑" : "☐"} ${fmtKeyWd(p.date)}: ${s(p.subject) ? s(p.subject) + " – " : ""}${s(p.title)}${Number(p.minutes) ? ` (${p.minutes} min)` : ""}`);
  const since = addDays(today, -13);
  const recent = sessions.filter((x) => isKey(x.date) && x.date >= since);
  if (recent.length) {
    const by = new Map();
    for (const x of recent) { const k = s(x.subject) || "ohne Fach"; by.set(k, (by.get(k) || 0) + (Number(x.minutes) || 0)); }
    out.push("", `Gelernt in den letzten 14 Tagen: ${[...by.entries()].map(([k, m]) => `${k} ${hm(m)} h`).join(", ")}`);
  }
  return out.join("\n");
}

/* ===================== Geld: Teilen & Bank ===================== */

export async function moneyExtra(d) {
  const [split, bank] = await Promise.all([d.alltag("money_split").catch(() => []), d.doc("meta/bank").catch(() => null)]);
  const out = [];
  const groups = split.filter((g) => g && g.id).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (groups.length) {
    out.push("", "Teilen (Gruppen):");
    for (const g of groups.slice(0, 8)) {
      const exp = (g.expenses || []).filter((e) => e && e.kind !== "pay");
      const total = exp.reduce((a, e) => a + (Number(e.amount) || 0), 0);
      const st = MC.settle(g);
      out.push(`- ${s(g.name) || "Gruppe"} (${(g.people || []).map((p) => (p.id === MC.ME ? "ich" : p.name)).join(", ")}): Ausgaben ${eur(total)} · ${st.length ? st.map((t) => MC.settleSentence(g, t).replace(/\u00a0/g, " ")).join("; ") : "alles ausgeglichen"} (Gruppen-ID ${g.id})`);
    }
  }
  if (bank && bank.linked) {
    const accs = Array.isArray(bank.accounts) ? bank.accounts : [];
    const bal = bank.balance;
    const left = bank.valid_until ? Math.floor((Date.parse(bank.valid_until) - d.now) / 86400000) : null;
    const per = accs.length > 1 && bank.balances ? accs.map((a) => { const b = bank.balances[a.uid]; return `${s(a.name) || "Konto"} ••${s(a.iban_last4)}: ${b && Number.isFinite(Number(b.amount)) ? eur(b.amount) : "unbekannt"}`; }).join(" · ") : ""; // Update 9 – mehrere Konten
    out.push("", `Bankkonto (${s(bank.aspsp) || "Bank"}${accs.length ? ", " + accs.map((a) => `••${s(a.iban_last4)}`).join(", ") : ""}): ${bal && Number.isFinite(Number(bal.amount)) ? `Kontostand ${eur(bal.amount)}${bal.at ? ` (Stand ${fmtDateTime(bal.at)})` : ""}` : "Kontostand unbekannt"}${bank.lastSync ? ` · zuletzt abgeglichen ${fmtDateTime(bank.lastSync)}` : ""}${left != null ? ` · Zugang noch ${Math.max(0, left)} Tage gültig` : ""}`);
    if (per) out.push(`Konten: ${per}`);
  }
  return out;
}

/* ===================== Update 9 – Sparziele: echtes Konto, Erinnerung, Aufrunden ===================== */

/** Zeilen für geld_lesen: Sparziele (verbunden → echter Kontostand), Spar-Erinnerungen, Aufrunden dieser Woche. */
export async function savingsSection(d, goals, txs, today) {
  const [bank, settings] = await Promise.all([d.doc("meta/bank").catch(() => null), d.settings().catch(() => ({}))]);
  const bk = bank && bank.linked ? bank : null;
  const list = (goals || []).filter((g) => g && g.id);
  const out = [];
  if (list.length) {
    out.push("", "Sparziele:");
    for (const g of list) {
      const cur = MC.goalCurrent(g, list, bk);
      const tg = Number(g.target) || 0, sv = cur.amount;
      const pm = MC.goalPerMonth({ ...g, saved: sv }, today);
      let line = `- ${g.emoji ? g.emoji + " " : ""}${g.name || "Ziel"}: ${eur(sv)} von ${eur(tg)}${tg > 0 ? ` (${Math.min(100, Math.round(sv / tg * 100))} %)` : ""}${isKey(g.date) ? ` bis ${fmtKey(g.date)}` : ""}${pm.done ? " – erreicht 🎉" : pm.perMonth ? ` – noch ${eur(pm.perMonth)} pro Monat nötig` : ""}`;
      if (cur.linked) {
        const acc = cur.account;
        const name = acc ? `${s(acc.name) || "Konto"}${acc.iban_last4 ? ` ••${s(acc.iban_last4)}` : ""}` : `${s(g.bank.name) || "Konto"}${g.bank.last4 ? ` ••${s(g.bank.last4)}` : ""}`;
        if (cur.missing) line += ` · 🏦 verbunden mit ${name}, aber das Konto ist gerade nicht freigegeben`;
        else if (cur.unknown) line += ` · 🏦 echtes Konto ${name}, Kontostand noch unbekannt`;
        else {
          line += ` · 🏦 echter Kontostand ${name}${g.bank.mode === "fixed" ? ` (fester Anteil ${eur(g.bank.alloc || 0)} von ${eur(cur.balance.amount)})` : Number(g.bank.offset) > 0 ? ` (${eur(cur.balance.amount)} − Startbetrag ${eur(g.bank.offset)})` : ""}${cur.balance.at ? `, Stand ${fmtDateTime(cur.balance.at)}` : ""}`;
          if (g.bank.mode !== "fixed" && !pm.done && acc) {
            const f = MC.monthlyInflow((bk.balanceHistory || {})[acc.uid], today);
            if (f && f.perMonth > 0.5) line += ` · Ø ${eur(f.perMonth)} Zuwachs pro Monat (3 Monate) → ca. ${MC.monthsToGoal(pm.rest, f.perMonth)} Monate bis zum Ziel`;
          }
        }
        line += " · einzahlen nur per Überweisung in der BAWAG-App";
      }
      const r = MC.goalReminder(g);
      if (r.on && r.amount > 0) {
        const due = MC.reminderDue(g, today, { txs, goals: list, bank: bk });
        line += ` · 🔔 Erinnerung ${eur(r.amount)} ${r.mode === "day" ? `am ${r.day}. jedes Monats (09:00)` : "am Zahltag"}`;
        line += g.remindAck === String(today).slice(0, 7) ? " (diesen Monat erledigt)" : due ? ` (fällig seit ${fmtKey(due.date)})` : "";
      }
      out.push(line + ` (ID ${g.id})`);
    }
  }
  const ru = MC.roundupSettings(settings);
  if (ru.on) {
    const w = MC.roundUpWeek(txs, today, ru.step);
    const goal = list.find((g) => g.id === ru.goalId);
    const booked = ru.booked[w.from] || 0;
    out.push("", `Aufrunden (auf ${ru.step} €): Diese Woche (seit ${fmtKey(w.from)}) hättest du durch Aufrunden ${eur(w.total)} sparen können (${w.count} Ausgaben)${goal ? ` – Ziel „${goal.name}“` : ""}${booked > 0 ? `, davon ${eur(booked)} schon gebucht` : ""}${ru.push ? " · Push sonntags 18:00" : ""}.`);
  }
  return out;
}

/* ===================== Globale Suche ===================== */

function hitOf(q, fields) {
  const fq = fold(q);
  if (!fq) return 0;
  const hay = fold(fields.filter(Boolean).join(" "));
  if (hay.includes(fq)) return 100;
  const terms = fq.split(" ").filter((x) => x.length >= 2);
  if (terms.length > 1 && terms.every((t) => hay.includes(t))) return 90;
  let b = 0;
  for (const f of fields) if (s(f) && s(f).length <= 60) b = Math.max(b, score(q, f));
  return b >= 80 ? b : 0;
}

const TOOL_SUCHE = {
  name: "suche",
  title: "Überall suchen",
  description: "Globale Suche über die ganze App: Arbeitszeit-Einträge (Notiz/Ort), Planer (Termine, Aufgaben, Geburtstage, Einsätze), Orte, Material, Buchungen und Abos, Schule (Hausaufgaben, Prüfungen, Noten, Projekte, Dokument-Titel, Stundenplan), Unterwegs (Reisen, Adressen, Packlisten), Galerie (Alben, Foto-Notizen/Adressen) und Berichtsheft-Notizen. Liefert je Treffer Bereich, Datum, Text und ID. Der Passwort-Tresor wird nie durchsucht.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Suchbegriff, z. B. \"Huber\", \"FI-Schalter\", \"Zahnarzt\"" },
      limit: { type: "number", description: "Höchstens so viele Treffer (Standard 40)" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const q = s(args.text);
    if (fold(q).length < 2) throw new UserError("Bitte mindestens 2 Zeichen als Suchtext angeben.");
    if (/passw|tresor|kennw/i.test(q)) return "Den Passwort-Tresor kann ich nicht durchsuchen – er ist verschlüsselt und nur in der App mit deinem Master-Passwort lesbar.";
    const limit = Math.max(1, Math.min(100, Math.round(Number(args.limit) || 40)));
    const A = (n) => d.alltag(n).catch(() => []);
    const [entries, todos, places, mat, tx, subs, tasks, exams, grades, projects, docs, tt, trips, uwPlaces, packing, albums, photos, settings] = await Promise.all([
      d.entriesAll(), d.todos().catch(() => []), d.places(), A("material_items"), (d.moneyLocked ? Promise.resolve([]) : A("money_tx")), (d.moneyLocked ? Promise.resolve([]) : A("money_subs")), A("school_tasks"), A("school_exams"),
      A("school_grades"), A("school_projects"), d.listMasked("a_school_docs", SCHOOL_DOC_MASK).catch(() => []), A("school_timetable"), A("travel_trips"),
      A("travel_places"), A("travel_packing"), A("photo_albums"), photoIndex(d).catch(() => []), d.settings(),
    ]);
    const res = [];
    const add = (area, sc, sort, text, id) => { if (sc) res.push({ area, sc, sort: sort || "", text, id }); };
    const dk = (ts) => (Number.isFinite(Number(ts)) && Number(ts) > 0 ? dayKey(Number(ts)) : "");
    for (const e of entries) if (dk(e.start)) add("Arbeitszeit", hitOf(q, [e.note, e.place, ...(Array.isArray(e.people) ? e.people : []), ...(Array.isArray(e.segments) ? e.segments.map((x) => x && x.place) : [])]), dk(e.start),
      `${fmtKeyWd(dk(e.start))} · ${e.kind && e.kind !== "work" ? kindLabel(e.kind) : `${clock(e.start)}–${clock(e.end)}`}${s(e.place) ? " · " + s(e.place) : ""}${s(e.note) ? ` · „${short(e.note, 60)}“` : ""}`, e.id);
    for (const t of todos) add("Planer", hitOf(q, [t.title, t.note, t.location, t.place]), t.date || "",
      `${t.kind === "termin" ? "Termin" : t.kind === "einsatz" ? "Einsatz" : t.kind === "geburtstag" ? "Geburtstag" : "Aufgabe"} „${s(t.title) || s(t.place)}“${t.date ? ` · ${fmtKey(t.date)}${t.time ? " " + t.time : ""}` : ""}${t.done ? " · erledigt" : ""}`, t.id);
    for (const p of places) add("Orte", hitOf(q, [p.name, p.addr]), "", `${s(p.name)}${s(p.addr) ? " · " + s(p.addr) : ""}`, p.id);
    for (const m of mat) add("Material", hitOf(q, [m.name, m.note, m.place]), m.dayKey || "", `${s(m.qty) || 1} ${s(m.unit)} ${s(m.name)} · ${s(m.status)}${s(m.place) ? " · " + s(m.place) : ""}${isKey(m.dayKey) ? " · " + fmtKey(m.dayKey) : ""}`, m.id);
    for (const x of tx) add("Geld", hitOf(q, [x.note, x.counterparty]), x.date || "", `${x.type === "in" ? "Einnahme" : "Ausgabe"} ${eur(Number(x.amount) || 0)} · ${isKey(x.date) ? fmtKey(x.date) : ""}${s(x.note) ? ` · ${txNote(x, 60)}` : ""}`, x.id);
    for (const x of subs) add("Abos", hitOf(q, [x.name, x.what]), "", `${s(x.name)} ${eur(Number(x.amount) || 0)}`, x.id);
    for (const x of tasks) add("Schule", hitOf(q, [x.title, x.subject, x.note]), x.due || "", `Hausaufgabe ${s(x.subject) ? s(x.subject) + ": " : ""}„${s(x.title)}“${isKey(x.due) ? " · fällig " + fmtKey(x.due) : ""}${x.done ? " · erledigt" : ""}`, x.id);
    for (const x of exams) add("Schule", hitOf(q, [x.subject, x.kind, x.topics]), x.date || "", `${s(x.kind) || "Prüfung"} ${s(x.subject)}${isKey(x.date) ? " · " + fmtKey(x.date) : ""}`, x.id);
    for (const x of grades) add("Schule", hitOf(q, [x.subject, x.kind, x.note]), x.date || "", `Note ${s(x.grade)} ${s(x.subject)}${s(x.kind) ? " (" + s(x.kind) + ")" : ""}${isKey(x.date) ? " · " + fmtKey(x.date) : ""}`, x.id);
    for (const x of projects) add("Schule", hitOf(q, [x.title, x.subject, x.note, ...(x.steps || []).map((y) => y && y.text)]), x.due || "", `Projekt „${s(x.title)}“`, x.id);
    for (const x of docs) add("Schule", hitOf(q, [x.title, x.subject, x.name]), x.date || "", `Dokument „${s(x.title) || s(x.name)}“${s(x.subject) ? " · " + s(x.subject) : ""}`, x.id);
    for (const x of tt) add("Stundenplan", hitOf(q, [x.subject, x.room, x.teacher]), "", `${WD_LONG[Number(x.weekday)] || "?"} ${s(x.from)} ${s(x.subject)}${s(x.room) ? " · Raum " + s(x.room) : ""}${s(x.teacher) ? " · " + s(x.teacher) : ""}`, x.id);
    for (const x of trips) add("Reisen", hitOf(q, [x.title, x.dest, x.notes]), x.from || "", `${s(x.title) || s(x.dest)}${isKey(x.from) ? " · ab " + fmtKey(x.from) : ""}`, x.id);
    for (const x of uwPlaces) add("Adressen", hitOf(q, [x.name, x.address, x.phone, x.notes]), "", `${s(x.name)}${s(x.address) ? " · " + s(x.address) : ""}${s(x.phone) ? " · Tel. " + s(x.phone) : ""}`, x.id);
    for (const l of packing) for (const c of l.cats || []) for (const it of c.items || []) if (it) add("Packliste", hitOf(q, [it.name]), "", `${it.done ? "☑" : "☐"} ${s(it.name)} · Liste „${s(l.title)}“`, it.id);
    for (const a of albums) add("Galerie", hitOf(q, [a.name, a.addr]), "", `Album „${s(a.name)}“${s(a.addr) ? " · " + s(a.addr) : ""}`, a.id);
    for (const p of photos) add("Galerie", hitOf(q, [p.note, p.addr, p.place]), p.dayKey || "", `Foto ${p.ts ? fmtDateTime(p.ts) : ""}${s(p.place) || s(p.addr) ? " · " + short(s(p.place) || s(p.addr), 50) : ""}${s(p.note) ? ` · „${short(p.note, 60)}“` : ""}`, p.id);
    const notes = readApprentice(settings).notes;
    for (const [wk, txt] of Object.entries(notes)) add("Berichtsheft", hitOf(q, [txt]), wk, `${wk.replace("-W", " KW ")}: „${short(txt, 80)}“`, wk);
    if (!res.length) return `Nichts gefunden zu „${q}“. (Der Passwort-Tresor wird nie durchsucht.)`;
    res.sort((a, b) => b.sc - a.sc || (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
    const shown = res.slice(0, limit);
    const out = [`${res.length} ${res.length === 1 ? "Treffer" : "Treffer"} zu „${q}“${res.length > limit ? ` (die besten ${limit})` : ""}:`];
    const areas = [...new Set(shown.map((r) => r.area))];
    for (const a of areas) {
      out.push("", `${a}:`);
      for (const r of shown.filter((x) => x.area === a)) out.push(`- ${r.text} (ID ${r.id})`);
    }
    return out.join("\n");
  },
};

export const READ_TOOLS = [TOOL_GALERIE, TOOL_UNTERWEGS, TOOL_FAHRTENBUCH, TOOL_TAGGELD, TOOL_URLAUB, TOOL_EINSTELLUNGEN, TOOL_SUCHE];
export { weekKey, isoWeek, vienna, holidayName, dateArg };
