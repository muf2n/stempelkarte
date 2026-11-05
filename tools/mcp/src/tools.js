// Werkzeuge (MCP-Tools) der Stempelkarte – Beschreibungen und Ausgaben auf Deutsch (Österreich).
import {
  dayKey, keyToTs, addDays, mondayOf, isoWeek, isoWeekMonday, weekKey, wdOf, diffDays, parseKey,
  clock, fmtKey, fmtKeyWd, fmtDateTime, hm, signedH, eur, dec, isKey,
  parseDate, parseTime, fmtTime, parseMonth, shiftMonth, monthLabel, WD,
} from "./time.js";
import {
  UserError, clean, newId, alltagId, normTodo, netMin, creditMin, kindLabel, holidayName,
  dailyTargetMin, baseTargetMin, schoolLabel, readSchool, activitiesOf, DEFAULT_ACTIVITY,
  pauseMsNow, netMs, segmentsOf, cleanPeople, clockIn, togglePause, addSegment, clockOut,
  balanceNumbers, weekData, einsatzFor, einsatzCovers, buildWeek, readApprentice, apprenticeYear,
  defaultCreditMin, absenceRangeDays, creditByDay,
} from "./logic.js";
import { best, norm, score } from "./match.js";
import { expandTodo, nextInstance, describeRule, parseRRule, formatRRule, normCalendars, finalizeEvent } from "./cal.js"; // Update 9 – Kalender
import { DEFAULT_CATS, suggestCategory, parseAmount, budgetLevel, upcoming, monthlyCost, round2, INTERVALS } from "./money.js";

const SRC = "claude";
const ABS_KINDS = ["urlaub", "krank", "zeitausgleich", "schule", "feiertag"];
const GRADE_NAMES = { 1: "Sehr gut", 2: "Gut", 3: "Befriedigend", 4: "Genügend", 5: "Nicht genügend" };
const EXAM_KINDS = ["Schularbeit", "Test", "Prüfung", "Mündlich", "Referat", "Lehrabschlussprüfung"];

/* ---------- kleine Hilfen ---------- */

const s = (v) => (v == null ? "" : String(v).trim());
const pad2 = (n) => String(n).padStart(2, "0");
function need(v, msg) { if (!s(v)) throw new UserError(msg); return s(v); }

function dateArg(v, today, label = "Datum") {
  if (v == null || s(v) === "") return null;
  const k = parseDate(v, today);
  if (!k) throw new UserError(`${label} „${s(v)}“ verstehe ich nicht. Bitte als TT.MM.JJJJ (z. B. ${fmtKey(today)}) oder „heute“/„gestern“ angeben.`);
  return k;
}
function timeArg(v, label) {
  const t = parseTime(v);
  if (!t) throw new UserError(`${label} „${s(v)}“ verstehe ich nicht. Bitte als HH:MM (24 h, z. B. 07:30) angeben.`);
  return t;
}

function placeName(x) { return s(x && (x.place || (x.inLoc && x.inLoc.addr) || (x.loc && x.loc.addr))); }
function lastSeg(r) { const sg = segmentsOf(r); return sg[sg.length - 1] || null; }

function matchPlace(q, places) {
  const m = best(q, places.filter((p) => p && p.name), (p) => p.name);
  return m;
}

/** Ort-Eingabe → {placeId, place, info}. Kein Treffer → freier Text (wie App: placeId null). */
function resolvePlace(q, places) {
  const txt = s(q);
  if (!txt) return { placeId: null, place: "", info: "" };
  const m = matchPlace(txt, places);
  if (m) {
    let info = norm(m.item.name) === norm(txt) ? "" : ` (gespeicherter Ort „${m.item.name}“ zu „${txt}“ gefunden)`;
    if (m.ambiguous && m.second) info += ` – Achtung, „${m.second.name}“ passt ähnlich gut`;
    return { placeId: m.item.id, place: String(m.item.name), info };
  }
  return { placeId: null, place: txt, info: ` (kein gespeicherter Ort passt zu „${txt}“ – als freier Text übernommen)` };
}

function resolveActivity(q, settings) {
  const list = activitiesOf(settings);
  const txt = s(q);
  if (!txt) return list.includes(DEFAULT_ACTIVITY) ? DEFAULT_ACTIVITY : list[0];
  const m = best(txt, list, (x) => x, 60);
  return m ? m.item : txt;
}

function segText(sg, nowOrEnd) {
  const end = Number.isFinite(sg.end) ? sg.end : null;
  const from = placeName(sg), to = s(sg.endPlace || (sg.endLoc && sg.endLoc.addr));
  const where = from && to && to !== from ? ` (${from} → ${to})` : from ? ` (${from})` : "";
  const dur = end != null ? ` ${hm((end - sg.start) / 60000)} h` : nowOrEnd ? ` seit ${hm((nowOrEnd - sg.start) / 60000)} h` : "";
  return `${clock(sg.start)}–${end != null ? clock(end) : ""} ${sg.activity || DEFAULT_ACTIVITY}${where}${dur ? "," + dur : ""}`;
}

function endClock(e) {
  const plus = dayKey(e.end) !== dayKey(e.start) ? " (+1 Tag)" : "";
  return clock(e.end) + plus;
}

function entryLines(e) {
  const out = [];
  if (e.kind && e.kind !== "work") {
    out.push(`- ${kindLabel(e.kind)} · Gutschrift ${hm(creditMin(e))} h`);
  } else {
    const pl = placeName(e);
    out.push(`- ${clock(e.start)}–${endClock(e)} · netto ${hm(netMin(e))} h · Pause ${Math.round(Number(e.pauseMin) || 0)} min${pl ? ` · Ort: ${pl}` : ""}`);
    const segs = Array.isArray(e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)) : [];
    if (segs.length > 1 || (segs.length === 1 && (segs[0].activity || DEFAULT_ACTIVITY) !== DEFAULT_ACTIVITY)) {
      out.push(`  Abschnitte: ${segs.map((x) => segText(x)).join("; ")}`);
    }
  }
  if (Array.isArray(e.people) && e.people.length) out.push(`  Personen: ${e.people.join(", ")}`);
  if (s(e.note)) out.push(`  Notiz: ${s(e.note)}`);
  out.push(`  (ID ${e.id}${e.src === SRC ? ", von Claude eingetragen" : ""})`);
  return out;
}

function balanceLine(b) {
  const parts = [`Überstundenkonto: ${signedH(b.total)}`];
  const extra = [];
  if (b.start) extra.push(`seit ${fmtKey(b.start)}`);
  if (b.offset) extra.push(`inkl. Startsaldo ${signedH(b.offset)}`);
  if (extra.length) parts[0] += ` (${extra.join(", ")})`;
  parts.push(`diese Woche ${signedH(b.week)}`, `diesen Monat ${signedH(b.month)}`);
  return parts.join(" · ") + "\n(Das Soll von heute zählt erst ab morgen.)";
}

function runningLines(r, now) {
  const out = [];
  const sg = segmentsOf(r);
  const cur = sg[sg.length - 1];
  const pl = placeName(cur) || placeName(r);
  out.push(`Eingestempelt seit ${clock(r.start)}${dayKey(r.start) !== dayKey(now) ? ` (${fmtKey(dayKey(r.start))})` : ""} – bisher ${hm(netMs(r, now) / 60000)} h netto${pl ? ` · Ort: ${pl}` : ""}`);
  out.push(`Aktueller Abschnitt: ${cur.activity || DEFAULT_ACTIVITY} seit ${clock(cur.start)}`);
  if (sg.length > 1) out.push(`Abschnitte: ${sg.map((x, i) => `${clock(x.start)}${i + 1 < sg.length ? "–" + clock(sg[i + 1].start) : "–jetzt"} ${x.activity || DEFAULT_ACTIVITY}`).join("; ")}`);
  const pm = Math.round(pauseMsNow(r, now) / 60000);
  if (r.pauseStart != null) out.push(`Pause: läuft seit ${clock(r.pauseStart)} (Pausen gesamt bisher ${pm} min)`);
  else out.push(pm > 0 ? `Pause: keine laufend, bisher ${pm} min` : "Pause: noch keine");
  if (Array.isArray(r.people) && r.people.length) out.push(`Personen: ${r.people.join(", ")}`);
  if (s(r.note)) out.push(`Notiz: ${s(r.note)}`);
  if (r.pauseStart == null && netMs(r, now) > 6 * 3600000 && pm < 30) out.push("Hinweis: Schon über 6 Stunden ohne 30 Minuten Pause.");
  return out;
}

function dayInfo(k, settings, todos) {
  const out = [];
  const hol = settings.holidays !== false ? holidayName(k) : null;
  if (hol) out.push(`Feiertag: ${hol}`);
  const sch = schoolLabel(k, settings);
  if (sch) out.push(sch === "Berufsschule" ? "Berufsschule" : `Berufsschule (${sch})`);
  const ez = todos ? einsatzFor(k, todos) : null;
  if (ez) out.push(`Einsatz: ${ez.place || ez.title}${ez.people && ez.people.length ? ` mit ${ez.people.join(", ")}` : ""}`);
  return out;
}

/** Datumsbereich von/bis (Standard: diese Woche bis heute), höchstens maxDays. */
function rangeArgs(args, today, { defFrom, defTo, maxDays = 366 }) {
  let from = dateArg(args.von, today, "„von“") || defFrom;
  let to = dateArg(args.bis, today, "„bis“") || (args.von && !args.bis ? from : defTo);
  if (to < from) [from, to] = [to, from];
  if (diffDays(from, to) + 1 > maxDays) throw new UserError(`Der Zeitraum ist zu lang (höchstens ${maxDays} Tage).`);
  return { from, to };
}

/* ---------- Werkzeuge ---------- */

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const TOOLS = [];
function tool(def) { TOOLS.push(def); }

/* ===== Stempeluhr ===== */

tool({
  name: "status_heute",
  title: "Status heute",
  description: "Zeigt den aktuellen Stand der Stempeluhr: eingestempelt ja/nein, seit wann, Ort, aktueller Abschnitt (Tätigkeit), Pause, heutige Stunden, diese Woche Ist/Soll und den Stand des Überstundenkontos (gleiche Berechnung wie die Übersicht der App). Auch Feiertag, Berufsschule und Einsatzplan für heute.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: RO,
  async run(_args, d) {
    const now = d.now, today = dayKey(now);
    const [st, settings, entries, todos] = await Promise.all([d.state(), d.settings(), d.entriesAll({ light: true }), d.todos().catch(() => [])]);
    const r = st.running;
    const out = [`Stand ${fmtKeyWd(today)}, ${clock(now)} Uhr`];
    const info = dayInfo(today, settings, todos);
    if (info.length) out.push("Heute: " + info.join(" · "));
    out.push("");
    if (r) out.push(...runningLines(r, now));
    else out.push("Nicht eingestempelt.");
    out.push("");
    const todayMin = creditByDay(entries, r, now).get(today) || 0;
    const tgt = dailyTargetMin(today, settings);
    out.push(`Heute gutgeschrieben: ${hm(todayMin)} h${tgt > 0 ? ` von ${hm(tgt)} h Tagessoll (${Math.round(Math.min(100, todayMin / tgt * 100))} %)` : " (heute kein Soll)"}`);
    const w = weekData(settings, entries, r, now, 0);
    out.push(`Diese Woche: ${hm(w.total)} h von ${hm(w.targetMin)} h Soll (${signedH(w.total - w.targetMin)})`);
    out.push(balanceLine(balanceNumbers(settings, entries, r, now)));
    return out.join("\n");
  },
});

tool({
  name: "eintraege_lesen",
  title: "Arbeitszeiten lesen",
  description: "Listet die Arbeitszeit-Einträge in einem Zeitraum: Beginn/Ende, Pause, Netto-Stunden, Ort, Abschnitte (z. B. Autofahren/Arbeiten), Personen und Notizen sowie Urlaub/Krank/Zeitausgleich/Schule mit Gutschrift. Ohne Angabe: diese Woche bis heute.",
  inputSchema: {
    type: "object",
    properties: {
      von: { type: "string", description: "Erster Tag, z. B. \"01.11.2026\", \"2026-11-01\", \"gestern\", \"Montag\"" },
      bis: { type: "string", description: "Letzter Tag (inklusive). Fehlt er, gilt nur der von-Tag." },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const { from, to } = rangeArgs(args, today, { defFrom: mondayOf(today), defTo: today });
    const [list, st] = await Promise.all([d.entriesRange(keyToTs(from), keyToTs(addDays(to, 1))), d.state()]);
    const head = from === to ? `Einträge am ${fmtKeyWd(from)}` : `Einträge ${fmtKey(from)} – ${fmtKey(to)}`;
    const out = [head];
    const byDay = new Map();
    for (const e of list) {
      if (!Number.isFinite(e.start)) continue;
      const k = dayKey(e.start);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
    let total = 0, net = 0;
    for (const [k, es] of [...byDay.entries()].sort()) {
      const sum = es.reduce((a, e) => a + creditMin(e), 0);
      total += sum;
      net += es.reduce((a, e) => a + (!e.kind || e.kind === "work" ? netMin(e) : 0), 0);
      out.push("", `${fmtKeyWd(k)} – ${hm(sum)} h`);
      for (const e of es) out.push(...entryLines(e));
    }
    const r = st.running;
    if (r && dayKey(r.start) >= from && dayKey(r.start) <= to) {
      out.push("", `Laufende Schicht (noch nicht abgeschlossen): seit ${fmtDateTime(r.start)}, bisher ${hm(netMs(r, d.now) / 60000)} h netto`);
    }
    if (!byDay.size) out.push("", "In diesem Zeitraum gibt es keine abgeschlossenen Einträge.");
    else out.push("", `Summe: ${hm(total)} h gutgeschrieben (davon Arbeitszeit netto ${hm(net)} h) an ${byDay.size} ${byDay.size === 1 ? "Tag" : "Tagen"}.`);
    return out.join("\n");
  },
});

tool({
  name: "wochen_zusammenfassung",
  title: "Wochenbericht (Berichtsheft)",
  description: "Fasst eine Arbeitswoche (Mo–So) für das Berichtsheft/den Ausbildungsnachweis zusammen – genau wie die Berichtsheft-Ansicht der App: je Tag Tätigkeiten (aus Notizen und Abschnitten), Orte, Personen, Feiertag/Berufsschule/Urlaub/Krank und Stunden, dazu Wochensumme, Kopfdaten (Name, Lehrberuf, Lehrbetrieb, Lehrjahr) und gespeicherte Ergänzungen. Ideal als Grundlage, um einen Berichtsheft-Text zu formulieren.",
  inputSchema: {
    type: "object",
    properties: {
      woche: { type: "string", description: "Welche Woche: leer = diese Woche, \"letzte\", \"KW 45\", \"2026-W45\", \"-2\" (vor 2 Wochen) oder ein Datum in der Woche (TT.MM.JJJJ)." },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const w = s(args.woche).toLowerCase();
    let ws = mondayOf(today);
    let m;
    if (!w || /^(diese|aktuell|jetzt)/.test(w)) { /* diese Woche */ }
    else if (/^(letzte|vorige|vergangene)/.test(w)) ws = addDays(ws, -7);
    else if (/^(nächste|naechste|kommende)/.test(w)) ws = addDays(ws, 7);
    else if ((m = /^([+-]\d{1,2})$/.exec(w))) ws = addDays(ws, 7 * Number(m[1]));
    else if ((m = /^(\d{4})-?w(\d{1,2})$/.exec(w))) ws = isoWeekMonday(+m[1], +m[2]);
    else if ((m = /^kw\s*(\d{1,2})(?:\s*[/.]?\s*(\d{4}))?$/.exec(w)) || (m = /^(\d{1,2})$/.exec(w))) {
      const wk = +m[1];
      if (wk < 1 || wk > 53) throw new UserError("Kalenderwoche muss zwischen 1 und 53 liegen.");
      const yr = m[2] ? +m[2] : isoWeek(today).year;
      ws = isoWeekMonday(yr, wk);
    } else {
      const k = dateArg(args.woche, today, "Woche");
      ws = mondayOf(k);
    }
    const we = addDays(ws, 6);
    const [settings, entries] = await Promise.all([d.settings(), d.entriesRange(keyToTs(ws), keyToTs(addDays(we, 1)))]);
    const rows = buildWeek(settings, entries, ws);
    const ap = readApprentice(settings);
    const { week } = isoWeek(ws);
    const lj = apprenticeYear(ap, ws) || apprenticeYear(ap, we);
    const out = [`Berichtsheft – KW ${week} · ${fmtKey(ws)} – ${fmtKey(we)}`];
    const headBits = [];
    if (ap.name) headBits.push(`Name: ${ap.name}`);
    if (ap.trade) headBits.push(`Lehrberuf: ${ap.trade}`);
    if (ap.company) headBits.push(`Lehrbetrieb: ${ap.company}`);
    if (lj) headBits.push(`${lj}. Lehrjahr`);
    out.push(headBits.length ? headBits.join(" · ") : "(Kopfdaten wie Name/Lehrberuf/Lehrbetrieb sind in der App unter Übersicht → Lehrling noch nicht eingetragen.)");
    let sum = 0, noNote = 0;
    for (const r of rows) {
      sum += r.min;
      if (r.noNote) noNote++;
      if (r.empty) { out.push("", `${fmtKeyWd(r.key)} – nichts eingetragen`); continue; }
      out.push("", `${fmtKeyWd(r.key)} – ${hm(r.min)} h`);
      if (r.tags.length) out.push(`  ${r.tags.map((t) => t.text).join(" · ")}`);
      if (r.acts.length) out.push(`  Tätigkeiten: ${r.acts.join("; ")}`);
      if (r.places.length) out.push(`  Orte: ${r.places.join(", ")}`);
      if (r.people.length) out.push(`  Mit: ${r.people.join(", ")}`);
    }
    out.push("", `Wochensumme: ${hm(sum)} h`);
    const note = ap.notes[weekKey(ws)];
    if (s(note)) out.push(`Ergänzungen zur Woche: ${s(note)}`);
    if (noNote) out.push(`Hinweis: An ${noNote} ${noNote === 1 ? "Tag" : "Tagen"} fehlt eine Notiz zur Tätigkeit – dort steht nur „Arbeiten“ bzw. der Abschnittsname.`);
    return out.join("\n");
  },
});

tool({
  name: "einstempeln",
  title: "Einstempeln",
  description: "Startet eine neue Schicht (wie der Einstempeln-Knopf der App). Der Ort wird unscharf mit den gespeicherten Orten abgeglichen (z. B. \"huber\" → \"Baustelle Huber\"); ohne Ort wird – wie in der App – der Ort aus dem Einsatzplan von heute genommen. Optional Tätigkeit des ersten Abschnitts (Standard \"Arbeiten\"), Notiz, Personen und eine frühere Beginnzeit von heute.",
  inputSchema: {
    type: "object",
    properties: {
      ort: { type: "string", description: "Name des Arbeitsorts (gespeicherter Ort oder freier Text)" },
      notiz: { type: "string", description: "Notiz zur Schicht, z. B. was gemacht wird" },
      taetigkeit: { type: "string", description: "Tätigkeit des ersten Abschnitts, z. B. \"Autofahren\" oder \"Arbeiten\"" },
      personen: { type: "array", items: { type: "string" }, description: "Mit wem (Namen)" },
      beginn: { type: "string", description: "Optional: tatsächlicher Beginn heute (HH:MM), falls schon früher angefangen" },
    },
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const now = d.now, today = dayKey(now);
    const [places, settings, todos] = await Promise.all([d.places(), d.settings(), d.todos().catch(() => [])]);
    let pl = resolvePlace(args.ort, places);
    const ez = einsatzFor(today, todos);
    let people = Array.isArray(args.personen) ? args.personen : null;
    if (!s(args.ort) && ez && ez.placeId && places.some((p) => p.id === ez.placeId)) {
      const p = places.find((x) => x.id === ez.placeId);
      pl = { placeId: p.id, place: p.name, info: " (aus dem Einsatzplan von heute)" };
    }
    if (!people) people = ez ? ez.people || [] : [];
    const activity = resolveActivity(args.taetigkeit, settings);
    let start = null;
    if (s(args.beginn)) {
      const t = timeArg(args.beginn, "Beginn");
      start = keyToTs(today, t.h, t.mi);
      if (start > now) throw new UserError(`Der Beginn ${fmtTime(t)} liegt in der Zukunft.`);
    }
    const res = await d.mutateRunning((cur, n) => {
      if (cur) throw new UserError(`Du bist schon eingestempelt (seit ${clock(cur.start)}${placeName(cur) ? `, ${placeName(cur)}` : ""}).`);
      let r = clockIn(cur, { placeId: pl.placeId, place: pl.place, note: s(args.notiz), people, inLoc: null, activity }, n);
      // wie today.js bei geplanten Schichten: Beginn auf die frühere Zeit zurücksetzen
      if (start != null && start < r.start) r = { ...r, start, segments: [{ ...r.segments[0], start }, ...r.segments.slice(1)] };
      return { running: r };
    });
    const r = res.running;
    const out = [`Eingestempelt um ${clock(r.start)} Uhr.`];
    out.push(`Ort: ${r.place || "ohne Ort"}${pl.info}`);
    out.push(`Tätigkeit: ${r.segments[0].activity}`);
    if (r.people.length) out.push(`Personen: ${r.people.join(", ")}`);
    if (r.note) out.push(`Notiz: ${r.note}`);
    if (ez && s(args.ort) && ez.placeId && ez.placeId !== r.placeId) out.push(`Hinweis: Laut Einsatzplan wärst du heute bei ${ez.place || ez.title}.`);
    return out.join("\n");
  },
});

tool({
  name: "ausstempeln",
  title: "Ausstempeln",
  description: "Beendet die laufende Schicht und speichert den Arbeitszeit-Eintrag (genau wie die App: erst wird die laufende Schicht beendet, dann der Eintrag mit allen Abschnitten gespeichert). Eine laufende Pause wird bis zum Ende mitgezählt. Optional Notiz (wird an die Schicht-Notiz angehängt) und eine frühere Endzeit von heute.",
  inputSchema: {
    type: "object",
    properties: {
      notiz: { type: "string", description: "Notiz, was gemacht wurde (wird angehängt)" },
      ende: { type: "string", description: "Optional: tatsächliches Ende (HH:MM), wenn schon früher aufgehört" },
    },
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const now = d.now;
    let end = null;
    if (s(args.ende)) {
      const t = timeArg(args.ende, "Ende");
      end = keyToTs(dayKey(now), t.h, t.mi);
      if (end > now) throw new UserError(`Das Ende ${fmtTime(t)} liegt in der Zukunft.`);
    }
    const res = await d.mutateRunning((cur, n) => {
      if (!cur) throw new UserError("Du bist gerade nicht eingestempelt.");
      if (end != null && end <= cur.start) throw new UserError(`Das Ende muss nach dem Beginn (${clock(cur.start)}) liegen.`);
      const extra = s(args.notiz);
      const r = extra ? { ...cur, note: [s(cur.note), extra].filter(Boolean).join(" · ") } : cur;
      const id = newId("e", n);
      const entry = clockOut(r, { end }, n, id);
      const { id: _x, ...data } = entry;
      // Reihenfolge wie timer.clockOut: zuerst running = null (meta/state, vorne in writes), dann der Eintrag
      return { running: null, writes: [d.fs.setWrite(d.p(`entries/${id}`), clean(data))], entry };
    });
    const e = res.entry;
    const [settings, entries] = await Promise.all([d.settings(), d.entriesAll({ light: true })]);
    const all = entries.some((x) => x.id === e.id) ? entries : [...entries, e];
    const out = [`Ausgestempelt um ${clock(e.end)} Uhr.`];
    out.push(`Schicht ${clock(e.start)}–${endClock(e)} · Pause ${e.pauseMin} min · netto ${hm(netMin(e))} h${e.place ? ` · Ort: ${e.place}` : ""}`);
    if (e.segments.length > 1) out.push(`Abschnitte: ${e.segments.map((x) => segText(x)).join("; ")}`);
    if (e.note) out.push(`Notiz: ${e.note}`);
    const today = dayKey(now);
    out.push(`Heute gesamt: ${hm(creditByDay(all, null, now).get(today) || 0)} h`);
    out.push(balanceLine(balanceNumbers(settings, all, null, now)));
    return out.join("\n");
  },
});

tool({
  name: "pause",
  title: "Pause starten/beenden",
  description: "Startet oder beendet die Pause der laufenden Schicht (wie der Pause-Knopf). aktion \"start\" = Pause beginnen, \"ende\" = weiterarbeiten.",
  inputSchema: {
    type: "object",
    properties: { aktion: { type: "string", enum: ["start", "ende"], description: "\"start\" oder \"ende\"" } },
    required: ["aktion"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const a = s(args.aktion).toLowerCase();
    if (a !== "start" && a !== "ende") throw new UserError("aktion muss \"start\" oder \"ende\" sein.");
    const res = await d.mutateRunning((cur, n) => {
      if (!cur) throw new UserError("Du bist gerade nicht eingestempelt – Pause geht nur während einer Schicht.");
      const paused = cur.pauseStart != null;
      if (a === "start" && paused) return { unchanged: true, msg: `Die Pause läuft bereits seit ${clock(cur.pauseStart)} Uhr.` };
      if (a === "ende" && !paused) return { unchanged: true, msg: "Gerade läuft keine Pause." };
      return { running: togglePause(cur, Math.max(n, Number(cur.start) || 0)) };
    });
    if (res.unchanged) return res.msg;
    const r = res.running;
    if (a === "start") return `Pause gestartet um ${clock(r.pauseStart)} Uhr.`;
    const last = Math.round((d.now - res.before.pauseStart) / 60000);
    return `Pause beendet um ${clock(d.now)} Uhr (diese Pause ${last} min, Pausen gesamt ${Math.round(r.pauseMs / 60000)} min). Weiter geht's!`;
  },
});

tool({
  name: "abschnitt_wechseln",
  title: "Tätigkeit wechseln",
  description: "Beginnt in der laufenden Schicht einen neuen Abschnitt mit einer anderen Tätigkeit, z. B. \"Autofahren\" → \"Arbeiten\" (wie die Tätigkeits-Chips der App). Gültige Tätigkeiten sind die in der App eingestellten (Standard: Arbeiten, Autofahren, Material holen, Büro). Optional Ort des neuen Abschnitts.",
  inputSchema: {
    type: "object",
    properties: {
      taetigkeit: { type: "string", description: "Neue Tätigkeit, z. B. \"Arbeiten\", \"Autofahren\", \"Material holen\", \"Büro\"" },
      ort: { type: "string", description: "Optional: Ort, an dem der neue Abschnitt beginnt" },
    },
    required: ["taetigkeit"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    need(args.taetigkeit, "Bitte eine Tätigkeit angeben.");
    const [settings, places] = await Promise.all([d.settings(), s(args.ort) ? d.places() : []]);
    const activity = resolveActivity(args.taetigkeit, settings);
    const pl = resolvePlace(args.ort, places);
    const res = await d.mutateRunning((cur, n) => {
      if (!cur) throw new UserError("Du bist gerade nicht eingestempelt.");
      const last = lastSeg(cur);
      if (last && last.activity === activity && !pl.place) return { unchanged: true, msg: `Du bist schon bei „${activity}“ (seit ${clock(last.start)} Uhr).` };
      const { running, seg } = addSegment(cur, { activity, placeId: pl.placeId, place: pl.place, loc: null }, n);
      return { running, seg };
    });
    if (res.unchanged) return res.msg;
    const known = activitiesOf(settings).includes(activity);
    const prev = segmentsOf(res.before);
    const p = prev[prev.length - 1];
    return [
      `Neuer Abschnitt „${activity}“ seit ${clock(res.seg.start)} Uhr${res.seg.place ? ` · Ort: ${res.seg.place}${pl.info}` : ""}.`,
      p ? `Vorher: ${p.activity || DEFAULT_ACTIVITY} ${clock(p.start)}–${clock(res.seg.start)}.` : "",
      known ? "" : `Hinweis: „${activity}“ ist keine in der App eingestellte Tätigkeit (${activitiesOf(settings).join(", ")}) – wurde trotzdem so übernommen.`,
    ].filter(Boolean).join("\n");
  },
});

tool({
  name: "eintrag_nachtragen",
  title: "Eintrag nachtragen",
  description: "Trägt eine vergessene Arbeitszeit oder eine Abwesenheit nach (wie „Arbeitszeit nachtragen“ bzw. „Urlaub/Krank/Zeitausgleich eintragen“ in der App). art \"work\" (Standard) braucht beginn und ende; Ende vor Beginn = über Mitternacht. Bei urlaub/krank/zeitausgleich/schule wird die Gutschrift wie in der App automatisch berechnet (Tagessoll; Zeitausgleich = 0 h, verbraucht also Überstunden); mit \"bis\" werden mehrere Tage eingetragen (nur Arbeitstage, ohne Feiertage/Schultage).",
  inputSchema: {
    type: "object",
    properties: {
      datum: { type: "string", description: "Tag, z. B. \"03.11.2026\" oder \"gestern\"" },
      beginn: { type: "string", description: "Beginn HH:MM (nur bei art work)" },
      ende: { type: "string", description: "Ende HH:MM (nur bei art work)" },
      pause_min: { type: "number", description: "Pause in Minuten (Standard 0)" },
      ort: { type: "string", description: "Arbeitsort (wird mit gespeicherten Orten abgeglichen)" },
      notiz: { type: "string", description: "Notiz/Tätigkeit" },
      personen: { type: "array", items: { type: "string" } },
      art: { type: "string", enum: ["work", "urlaub", "krank", "zeitausgleich", "schule"], description: "Eintragsart, Standard work" },
      bis: { type: "string", description: "Nur Abwesenheit: letzter Tag eines Zeitraums" },
      gutschrift_h: { type: "number", description: "Nur Abwesenheit: Gutschrift in Stunden statt automatisch" },
    },
    required: ["datum"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const now = d.now, today = dayKey(now);
    const kind = s(args.art).toLowerCase() || "work";
    if (kind !== "work" && !ABS_KINDS.includes(kind)) throw new UserError("art muss work, urlaub, krank, zeitausgleich oder schule sein.");
    const day = dateArg(need(args.datum, "Bitte ein Datum angeben."), today);
    const settings = await d.settings();
    if (kind === "work") {
      const b = timeArg(need(args.beginn, "Für Arbeitszeit bitte beginn (HH:MM) angeben."), "Beginn");
      const e = timeArg(need(args.ende, "Für Arbeitszeit bitte ende (HH:MM) angeben."), "Ende");
      const pauseMin = args.pause_min == null || args.pause_min === "" ? 0 : Math.round(Number(String(args.pause_min).replace(",", ".")));
      if (!Number.isFinite(pauseMin) || pauseMin < 0) throw new UserError("Die Pause muss 0 oder mehr Minuten sein.");
      const start = keyToTs(day, b.h, b.mi);
      let end = keyToTs(day, e.h, e.mi);
      const overnight = end < start;
      if (overnight) end = keyToTs(addDays(day, 1), e.h, e.mi);
      const durMin = Math.round((end - start) / 60000);
      if (durMin > 0 ? pauseMin >= durMin : pauseMin > 0) throw new UserError(`Die Pause (${pauseMin} min) ist länger als die Arbeitszeit (${hm(durMin)} h).`);
      if (end > now + 5 * 60000) throw new UserError("Das Ende liegt in der Zukunft – nachtragen geht nur für vergangene Zeiten. Zum Starten bitte einstempeln.");
      const [places, existing, st] = await Promise.all([d.places(), d.entriesRange(keyToTs(addDays(day, -1)), keyToTs(addDays(day, 2))), d.state()]);
      const pl = resolvePlace(args.ort, places);
      const data = {
        kind: "work", start, end, pauseMin,
        placeId: pl.placeId, place: pl.place,
        note: s(args.notiz), people: cleanPeople(args.personen),
        inLoc: null, outLoc: null, src: SRC,
      };
      const id = newId("e", now);
      await d.commit([d.fs.setWrite(d.p(`entries/${id}`), clean(data))]);
      const overlaps = existing.filter((x) => (!x.kind || x.kind === "work") && x.start < end && x.end > start);
      const r = st.running;
      const out = [`Eingetragen: ${fmtKeyWd(day)}, ${clock(start)}–${clock(end)}${overnight ? " (bis nächsten Tag)" : ""} · Pause ${pauseMin} min · netto ${hm(netMin(data))} h${data.place ? ` · Ort: ${data.place}${pl.info}` : ""}.`];
      if (data.note) out.push(`Notiz: ${data.note}`);
      if (overlaps.length) out.push(`Achtung: überschneidet sich mit ${overlaps.map((x) => `${clock(x.start)}–${clock(x.end)}`).join(", ")} am selben Tag – bitte in der App prüfen.`);
      if (r && r.start < end && start < now) out.push(`Achtung: überschneidet sich mit der laufenden Schicht (seit ${clock(r.start)}).`);
      out.push(`(ID ${id})`);
      return out.join("\n");
    }
    // Abwesenheit
    let days = [day];
    if (s(args.bis)) {
      const to = dateArg(args.bis, today, "„bis“");
      if (to < day) throw new UserError("„bis“ liegt vor dem Datum.");
      if (diffDays(day, to) > 366) throw new UserError("Bitte höchstens ein Jahr auf einmal eintragen.");
      days = absenceRangeDays(day, to, settings);
      if (!days.length) throw new UserError("In diesem Zeitraum gibt es keine Arbeitstage.");
    }
    let manual = null;
    if (args.gutschrift_h != null && args.gutschrift_h !== "") {
      const v = Number(String(args.gutschrift_h).replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || v > 24) throw new UserError("gutschrift_h muss zwischen 0 und 24 Stunden liegen.");
      manual = Math.round(v * 60);
    }
    // Wie entries.js: Zeitraum → Nenn-Tagessoll (ohne Schul-Abzug), einzelner Tag → Tagessoll des Tages
    const nominal = (() => { const wd = Array.isArray(settings.workDays) ? settings.workDays : [1, 2, 3, 4, 5]; const w = Number(settings.weeklyTarget ?? 38.5); return wd.length && w > 0 ? (w * 60) / wd.length : 0; })();
    const writes = [];
    const made = [];
    for (const k of days) {
      const cm = manual != null ? manual : Math.round(days.length > 1 && kind !== "zeitausgleich" ? nominal : defaultCreditMin(kind, k, settings));
      const ts = keyToTs(k);
      const id = newId("e", now + made.length);
      const data = { kind, start: ts, end: ts, pauseMin: 0, creditMin: cm, placeId: null, place: "", note: s(args.notiz), inLoc: null, outLoc: null, src: SRC };
      writes.push(d.fs.setWrite(d.p(`entries/${id}`), data));
      made.push({ k, cm });
    }
    await d.commit(writes);
    const out = [days.length > 1
      ? `${days.length} Tage ${kindLabel(kind)} eingetragen (${fmtKey(days[0])} – ${fmtKey(days[days.length - 1])}):`
      : `${kindLabel(kind)} eingetragen: ${fmtKeyWd(day)} · Gutschrift ${hm(made[0].cm)} h.`];
    if (days.length > 1) out.push(...made.map((x) => `- ${fmtKeyWd(x.k)}: Gutschrift ${hm(x.cm)} h`));
    if (kind === "zeitausgleich" && manual == null) out.push("Zeitausgleich verbraucht Überstunden (Gutschrift 0 h, das Tagessoll wird vom Konto abgezogen).");
    const k0 = days[0];
    if (days.length === 1 && baseTargetMin(k0, settings) === 0) out.push("Hinweis: An diesem Tag gibt es kein Soll (Wochenende/Feiertag/arbeitsfrei).");
    return out.join("\n");
  },
});

/* ===== Orte ===== */

tool({
  name: "orte_lesen",
  title: "Orte lesen",
  description: "Listet die gespeicherten Arbeitsorte (Baustellen, Firma, Berufsschule …) mit Adresse und Radius.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: RO,
  async run(_a, d) {
    const places = await d.places();
    if (!places.length) return "Es sind noch keine Orte gespeichert. Orte legst du in der App unter „Orte“ an.";
    const out = [`${places.length} gespeicherte ${places.length === 1 ? "Ort" : "Orte"}:`];
    for (const p of places) {
      const bits = [];
      if (s(p.addr)) bits.push(s(p.addr));
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) bits.push(`Radius ${Math.round(Number(p.radius) || 150)} m`);
      else bits.push("ohne Koordinaten");
      out.push(`- ${s(p.name) || "(ohne Namen)"}${bits.length ? ` – ${bits.join(" · ")}` : ""}`);
    }
    return out.join("\n");
  },
});

/* ===== Planer: Aufgaben, Termine, Einsätze ===== */

function todoLine(t, today) {
  const bits = [];
  if (t.kind === "termin") bits.push("Termin");
  if (t.date) {
    const late = !t.done && t.date < today;
    bits.push(`${fmtKeyWd(t.date)}${t.time ? " " + t.time : ""}${late ? " (überfällig)" : t.date === today ? " (heute)" : ""}`);
  } else bits.push("ohne Datum");
  if (t.kind === "termin" && parseRRule(t.rrule)) {
    const n = nextInstance(t, today);
    bits.push(`${describeRule(t.rrule, t.date)}${n ? ` – nächster ${fmtKeyWd(n.date)}${n.time ? " " + n.time : ""}` : " – beendet"}`);
  }
  if (s(t.location)) bits.push(`Ort: ${s(t.location)}`);
  if (Array.isArray(t.reminders) && t.reminders.length > 1 && t.date && t.time) bits.push(`Erinnerungen ${t.reminders.join(", ")} min vorher`);
  else if (t.remind && t.date && t.time) bits.push(`Erinnerung ${t.remindMin} min vorher`);
  const note = s(t.note) ? `\n  Notiz: ${s(t.note)}` : "";
  return `- [${t.done ? "x" : " "}] ${t.title || "(ohne Titel)"} – ${bits.join(" · ")}${t.done && t.doneAt ? ` · erledigt ${fmtDateTime(t.doneAt)}` : ""}${note}\n  (ID ${t.id})`;
}

function einsatzLine(e) {
  const to = e.dateTo && e.dateTo > e.date ? ` – ${fmtKeyWd(e.dateTo)}` : "";
  return `- ${fmtKeyWd(e.date)}${to}: ${e.place || e.title}${e.people && e.people.length ? ` · mit ${e.people.join(", ")}` : ""}${s(e.note) ? ` · ${s(e.note)}` : ""} (ID ${e.id})`;
}

function sortTodos(a, b) {
  const da = a.done ? 1 : 0, db = b.done ? 1 : 0;
  if (da !== db) return da - db;
  const ka = a.date ? `${a.date} ${a.time || "99:99"}` : "~";
  const kb = b.date ? `${b.date} ${b.time || "99:99"}` : "~";
  if (ka !== kb) return ka < kb ? -1 : 1;
  return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
}

tool({
  name: "todos_lesen",
  title: "Aufgaben & Termine lesen",
  description: "Listet Aufgaben und Termine aus dem Planer (offen: überfällig, heute, demnächst, ohne Datum) sowie kommende Einsätze (Einsatzplan).",
  inputSchema: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["offen", "erledigt", "alle"], description: "Standard: offen" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const f = s(args.filter).toLowerCase() || "offen";
    const all = (await d.todos()).sort(sortTodos);
    const tasks = all.filter((t) => t.kind !== "einsatz" && t.kind !== "geburtstag");
    const ez = all.filter((t) => t.kind === "einsatz" && (t.dateTo && t.dateTo > t.date ? t.dateTo : t.date) >= today);
    if (!tasks.length && !ez.length) return "Im Planer ist noch nichts eingetragen.";
    const out = [];
    if (f === "erledigt" || f === "alle") {
      const done = tasks.filter((t) => t.done).sort((a, b) => (Number(b.doneAt) || 0) - (Number(a.doneAt) || 0)).slice(0, 30);
      if (f === "erledigt") {
        out.push(done.length ? "Zuletzt erledigt:" : "Noch nichts erledigt.");
        out.push(...done.map((t) => todoLine(t, today)));
        return out.join("\n");
      }
      if (done.length) out.push("Zuletzt erledigt (max. 30):", ...done.map((t) => todoLine(t, today)), "");
    }
    const open = tasks.filter((t) => !t.done).map((t) => {
      if (t.kind !== "termin" || !parseRRule(t.rrule)) return t;
      const n = nextInstance(t, today);
      return n ? { ...t, date: n.date, time: n.time } : null;
    }).filter(Boolean);
    const groups = [
      ["Überfällig", open.filter((t) => t.date && t.date < today)],
      ["Heute", open.filter((t) => t.date === today)],
      ["Demnächst", open.filter((t) => t.date && t.date > today)],
      ["Ohne Datum", open.filter((t) => !t.date)],
    ];
    if (!open.length) out.push("Keine offenen Aufgaben oder Termine.");
    for (const [label, list] of groups) if (list.length) out.push(`${label}:`, ...list.map((t) => todoLine(t, today)), "");
    if (ez.length) out.push("Kommende Einsätze:", ...ez.sort((a, b) => (a.date < b.date ? -1 : 1)).map(einsatzLine));
    return out.join("\n").trim();
  },
});

const REPEAT_WORDS = [
  [/^(nie|keine?|einmalig)$/, null], [/^t(ä|ae)glich$/, "FREQ=DAILY"], [/^werkt(ä|ae)g(lich)?|^werktags$|mo.?-.?fr/, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
  [/^(alle|jede)\s*2\s*wochen|^zweiw(ö|oe)chentlich$/, "W2"], [/^w(ö|oe)chentlich$/, "W"], [/^monatlich$/, "M"], [/^j(ä|ae)hrlich$/, "FREQ=YEARLY"],
];
const RD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Update 9 – Kalender: Zusatzfelder für Termine (Ende, ganztägig, Ort, Wiederholung, mehrere Erinnerungen, Kalender). */
async function eventArgs(d, args, base, today) {
  const t = { ...base };
  const wd = RD[wdOf(t.date)];
  if (args.ganztags === true) { t.allDay = true; t.time = null; }
  if (s(args.ende_datum)) {
    const ed = dateArg(args.ende_datum, today, "ende_datum");
    if (ed < t.date) throw new UserError("ende_datum liegt vor dem Datum.");
    if (ed > t.date) t.endDate = ed;
  }
  if (s(args.bis)) {
    if (!t.time) throw new UserError("„bis“ (Endzeit) geht nur mit Uhrzeit.");
    const et = fmtTime(timeArg(args.bis, "bis"));
    if (!t.endDate && et <= t.time) throw new UserError("Die Endzeit liegt vor der Uhrzeit.");
    t.endTime = et;
  }
  if (s(args.ort)) t.location = s(args.ort).slice(0, 200);
  if (s(args.wiederholung)) {
    const w = s(args.wiederholung).toLowerCase();
    let rr;
    if (/^(rrule:)?freq=/i.test(w)) rr = parseRRule(w.toUpperCase()) ? formatRRule(w.toUpperCase()) : null;
    else {
      const hit = REPEAT_WORDS.find(([re]) => re.test(w));
      if (!hit) throw new UserError("wiederholung: täglich, werktags, wöchentlich, alle 2 wochen, monatlich, jährlich oder eine RRULE (FREQ=…).");
      rr = hit[1] === "W" ? `FREQ=WEEKLY;BYDAY=${wd}` : hit[1] === "W2" ? `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}` : hit[1] === "M" ? `FREQ=MONTHLY;BYMONTHDAY=${Number(t.date.slice(8))}` : hit[1];
    }
    if (rr) {
      const r = parseRRule(rr);
      if (s(args.wiederholen_bis)) { r.until = dateArg(args.wiederholen_bis, today, "wiederholen_bis"); r.count = null; }
      else if (args.anzahl != null) { const n = Math.round(Number(args.anzahl)); if (!(n >= 1 && n <= 999)) throw new UserError("anzahl muss 1–999 sein."); r.count = n; r.until = null; }
      t.rrule = formatRRule(r);
    }
  }
  if (Array.isArray(args.erinnerungen)) {
    const list = args.erinnerungen.map((x) => Math.round(Number(x)));
    if (list.some((x) => !Number.isFinite(x) || x < 0 || x > 40320)) throw new UserError("erinnerungen: Minuten vorher, 0 bis 40320.");
    t.reminders = list;
  }
  if (s(args.kalender)) {
    const cals = normCalendars((await d.settings()).calendars).filter((c) => c.kind === "user");
    const m = best(args.kalender, cals, (c) => c.name) || null;
    const c = cals.find((x) => x.id === s(args.kalender)) || (m && !m.ambiguous ? m.item : null);
    if (!c) throw new UserError(`Kalender „${s(args.kalender)}“ nicht gefunden. Vorhanden: ${cals.map((x) => x.name).join(", ")}.`);
    t.calendarId = c.id;
  }
  const extended = ["allDay", "endDate", "endTime", "location", "rrule", "reminders", "calendarId"].some((k) => t[k] !== undefined);
  if (!extended) return t;
  const f = finalizeEvent({ ...t, reminders: t.reminders || (t.remind ? [t.remindMin] : []) });
  if (f.endDate == null) delete f.endDate;
  if (f.rrule == null) delete f.rrule;
  if (f.allDay && !f.reminders.length && args.erinnern == null) { f.remind = false; }
  if (!f.allDay && !(f.date && f.time)) { f.remind = false; f.reminders = []; }
  return f;
}

function remindArgs(args, date, time, defaultOn) {
  const rm = args.erinnern_min == null ? 30 : Math.round(Number(args.erinnern_min));
  if (!Number.isFinite(rm) || rm < 0) throw new UserError("erinnern_min muss 0 oder mehr Minuten sein.");
  const want = args.erinnern == null ? defaultOn : !!args.erinnern;
  return { remind: !!(want && date && time), remindMin: rm };
}

async function createTodo(d, kind, args) {
  const today = dayKey(d.now);
  const title = need(args.titel, "Bitte einen Titel angeben.").slice(0, 140);
  const date = dateArg(kind === "termin" ? args.datum : (args.faellig ?? args.datum), today, kind === "termin" ? "Datum" : "Fälligkeit");
  if (kind === "termin" && !date) throw new UserError("Ein Termin braucht ein Datum.");
  const time = s(args.uhrzeit) ? fmtTime(timeArg(args.uhrzeit, "Uhrzeit")) : null;
  const { remind, remindMin } = remindArgs(args, date, time, !!time);
  const id = newId("t", d.now);
  let base = {
    title, kind, date, time: date ? time : null, remind, remindMin,
    note: s(args.notiz), done: false, doneAt: null, createdAt: d.now, src: SRC,
  };
  if (kind === "termin") base = await eventArgs(d, args, base, today);
  const full = normTodo(base, id, d.now);
  const { id: _i, ...data } = full;
  await d.commit([d.fs.setWrite(d.p(`todos/${id}`), clean(data))]);
  return full;
}

tool({
  name: "todo_anlegen",
  title: "Aufgabe anlegen",
  description: "Legt eine Aufgabe im Planer an (wie „Neu im Planer → Aufgabe“). Mit Fälligkeitsdatum und Uhrzeit wird standardmäßig eine Push-Erinnerung (30 min vorher) eingestellt.",
  inputSchema: {
    type: "object",
    properties: {
      titel: { type: "string", description: "Was ist zu tun?" },
      faellig: { type: "string", description: "Fälligkeitsdatum (optional), z. B. \"morgen\", \"10.11.2026\"" },
      uhrzeit: { type: "string", description: "Uhrzeit HH:MM (optional)" },
      notiz: { type: "string" },
      erinnern: { type: "boolean", description: "Push-Erinnerung (nur mit Datum und Uhrzeit)" },
      erinnern_min: { type: "number", description: "Minuten vorher (Standard 30)" },
    },
    required: ["titel"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const t = await createTodo(d, "todo", args);
    return `Aufgabe angelegt: „${t.title}“${t.date ? ` – fällig ${fmtKeyWd(t.date)}${t.time ? " " + t.time : ""}` : " (ohne Datum)"}${t.remind ? `, Erinnerung ${t.remindMin} min vorher` : ""}.\n(ID ${t.id})`;
  },
});

tool({
  name: "termin_anlegen",
  title: "Termin anlegen",
  description: "Legt einen Termin im Planer an (wie „Neu im Planer → Termin“). Mit Uhrzeit wird standardmäßig eine Push-Erinnerung (30 min vorher) eingestellt.",
  inputSchema: {
    type: "object",
    properties: {
      titel: { type: "string" },
      datum: { type: "string", description: "Datum, z. B. \"12.11.2026\"" },
      uhrzeit: { type: "string", description: "Uhrzeit HH:MM (optional)" },
      bis: { type: "string", description: "Endzeit HH:MM (optional, Standard 1 Stunde)" },
      ende_datum: { type: "string", description: "Letzter Tag bei mehrtägigen Terminen (optional)" },
      ganztags: { type: "boolean", description: "Ganztägiger Termin" },
      ort: { type: "string", description: "Ort/Adresse (optional)" },
      wiederholung: { type: "string", description: "täglich, werktags, wöchentlich, alle 2 wochen, monatlich, jährlich oder RRULE (z. B. FREQ=MONTHLY;BYDAY=2TU)" },
      wiederholen_bis: { type: "string", description: "Letzter Tag der Wiederholung (optional)" },
      anzahl: { type: "number", description: "Anzahl der Wiederholungen (statt wiederholen_bis)" },
      kalender: { type: "string", description: "Kalender, z. B. Privat, Arbeit, Berufsschule (Standard Privat)" },
      notiz: { type: "string" },
      erinnern: { type: "boolean" },
      erinnern_min: { type: "number", description: "Minuten vorher (Standard 30)" },
      erinnerungen: { type: "array", items: { type: "number" }, description: "Mehrere Erinnerungen in Minuten vorher, z. B. [10, 60, 1440]" },
    },
    required: ["titel", "datum"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const t = await createTodo(d, "termin", args);
    const rem = Array.isArray(t.reminders) && t.reminders.length > 1 ? `, Erinnerungen ${t.reminders.join(", ")} min vorher` : t.remind ? `, Erinnerung ${t.remindMin} min vorher` : "";
    const extra = [
      t.endDate ? `bis ${fmtKeyWd(t.endDate)}${t.endTime ? " " + t.endTime : ""}` : t.endTime ? `bis ${t.endTime}` : "",
      t.allDay ? "ganztägig" : "", t.location ? `Ort: ${t.location}` : "", t.rrule ? describeRule(t.rrule, t.date) : "",
    ].filter(Boolean).join(" · ");
    return `Termin angelegt: „${t.title}“ am ${fmtKeyWd(t.date)}${t.time ? ` um ${t.time}` : ""}${rem}${extra ? ` · ${extra}` : ""}.\n(ID ${t.id})`;
  },
});

tool({
  name: "einsatz_anlegen",
  title: "Einsatz planen",
  description: "Trägt einen Einsatz in den Einsatzplan ein: wo (und mit wem) du an einem Tag bzw. von–bis arbeitest – wie „Wo bist du am …?“ im Planer der App. Die App schlägt diesen Ort dann beim Einstempeln vor.",
  inputSchema: {
    type: "object",
    properties: {
      ort: { type: "string", description: "Baustelle/Ort (wird mit gespeicherten Orten abgeglichen)" },
      datum: { type: "string", description: "Erster Tag" },
      bis: { type: "string", description: "Optional: letzter Tag (inklusive)" },
      personen: { type: "array", items: { type: "string" }, description: "Mit wem" },
      notiz: { type: "string" },
    },
    required: ["ort", "datum"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    need(args.ort, "Bitte einen Ort angeben.");
    const date = dateArg(need(args.datum, "Bitte ein Datum angeben."), today);
    const to = dateArg(args.bis, today, "„bis“");
    if (to && to < date) throw new UserError("„bis“ liegt vor dem Datum.");
    const [places, settings] = await Promise.all([d.places(), d.settings()]);
    const pl = resolvePlace(args.ort, places);
    const sortPeople = (list) => [...new Set((list || []).map((p) => String(p || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
    const people = sortPeople(Array.isArray(args.personen) ? args.personen : []);
    const id = newId("t", d.now);
    const full = normTodo({
      kind: "einsatz", title: pl.place, date, dateTo: to && to > date ? to : null, time: null,
      placeId: pl.placeId, place: pl.place, people, note: s(args.notiz),
      remind: false, done: false, doneAt: null, createdAt: d.now, src: SRC,
    }, id, d.now);
    const { id: _i, ...data } = full;
    const writes = [d.fs.setWrite(d.p(`todos/${id}`), clean(data))];
    const cur = Array.isArray(settings.people) ? settings.people : [];
    const merged = sortPeople([...cur, ...people]);
    if (merged.length !== sortPeople(cur).length) writes.push(d.fs.patchWrite(d.p("meta/settings"), { people: merged }));
    await d.commit(writes);
    return `Einsatz geplant: ${fmtKeyWd(date)}${full.dateTo ? ` – ${fmtKeyWd(full.dateTo)}` : ""} · ${pl.place}${pl.info}${people.length ? ` · mit ${people.join(", ")}` : ""}.\n(ID ${id})`;
  },
});

tool({
  name: "todo_erledigt",
  title: "Aufgabe abhaken",
  description: "Hakt eine Aufgabe oder einen Termin als erledigt ab (oder mit erledigt=false wieder als offen). Angabe über die ID oder unscharf über den Titel.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "ID der Aufgabe (aus todos_lesen)" },
      titel: { type: "string", description: "Titel bzw. Teil davon" },
      erledigt: { type: "boolean", description: "Standard true" },
    },
    additionalProperties: false,
  },
  annotations: { ...WR, idempotentHint: true },
  async run(args, d) {
    const done = args.erledigt == null ? true : !!args.erledigt;
    const todos = (await d.todos()).filter((t) => t.kind !== "einsatz" && t.kind !== "geburtstag");
    let t = null;
    if (s(args.id)) {
      t = todos.find((x) => x.id === s(args.id));
      if (!t) throw new UserError(`Keine Aufgabe mit der ID ${s(args.id)} gefunden.`);
    } else {
      need(args.titel, "Bitte id oder titel angeben.");
      const pool = todos.filter((x) => x.done !== done);
      const m = best(args.titel, pool, (x) => x.title);
      if (!m) throw new UserError(`Keine ${done ? "offene" : "erledigte"} Aufgabe passt zu „${s(args.titel)}“.`);
      if (m.ambiguous) throw new UserError(`„${s(args.titel)}“ passt auf mehrere Aufgaben: „${m.item.title}“ und „${m.second.title}“. Bitte genauer angeben oder die ID nehmen.`);
      t = m.item;
    }
    if (t.done === done) return `„${t.title}“ ist schon ${done ? "erledigt" : "offen"}.`;
    await d.commit([d.fs.patchWrite(d.p(`todos/${t.id}`), { done, doneAt: done ? d.now : null }, { exists: true })]);
    return done ? `Erledigt: „${t.title}“ ✓` : `Wieder offen: „${t.title}“.`;
  },
});

tool({
  name: "planer_lesen",
  title: "Planer lesen",
  description: "Zeigt den Planer Tag für Tag: Termine, Aufgaben mit Datum, Einsätze (Einsatzplan), Berufsschultage und Feiertage im Zeitraum; dazu offene Aufgaben ohne Datum. Ohne Angabe: heute + 6 Tage.",
  inputSchema: {
    type: "object",
    properties: {
      von: { type: "string", description: "Erster Tag (Standard heute)" },
      bis: { type: "string", description: "Letzter Tag (Standard von + 6 Tage)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const from0 = dateArg(args.von, today, "„von“") || today;
    const { from, to } = rangeArgs({ von: from0, bis: args.bis || addDays(from0, 6) }, today, { defFrom: today, defTo: addDays(today, 6), maxDays: 92 });
    const [todos, settings] = await Promise.all([d.todos(), d.settings()]);
    const out = [`Planer ${fmtKey(from)} – ${fmtKey(to)}`];
    // Update 9 – Kalender: Termine mit Wiederholung/mehrtägig aufklappen, Geburtstage jährlich
    const byDay = new Map();
    for (const t of todos) {
      if (t.kind !== "termin") continue;
      for (const i of expandTodo(t, from, to)) {
        for (let k = i.date < from ? from : i.date; k <= i.lastDay && k <= to; k = addDays(k, 1)) {
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k).push(i);
        }
      }
    }
    const bdays = [];
    for (const t of todos) {
      const m = t.kind === "geburtstag" && /^(\d{1,2})-(\d{1,2})$/.exec(s(t.bday));
      if (!m) continue;
      for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) bdays.push({ title: t.title, date: `${y}-${pad2(m[1])}-${pad2(m[2])}` });
    }
    let any = false;
    for (let k = from; k <= to; k = addDays(k, 1)) {
      const bits = [];
      const hol = settings.holidays !== false ? holidayName(k) : null;
      if (hol) bits.push(`  Feiertag: ${hol}`);
      const sch = schoolLabel(k, settings);
      if (sch) bits.push(`  ${sch === "Berufsschule" ? "Berufsschule" : "Berufsschule – " + sch}`);
      const ez = einsatzFor(k, todos);
      if (ez) bits.push(`  Einsatz: ${ez.place || ez.title}${ez.people && ez.people.length ? ` mit ${ez.people.join(", ")}` : ""}${s(ez.note) ? ` (${s(ez.note)})` : ""}`);
      for (const b of bdays) if (b.date === k) bits.push(`  🎂 Geburtstag: ${b.title}`);
      const items = todos.filter((t) => t.kind !== "einsatz" && t.kind !== "termin" && t.kind !== "geburtstag" && t.date === k).sort(sortTodos);
      const evs = (byDay.get(k) || []).map((i) => ({ i, sk: i.allDay || i.date < k ? "" : i.time }));
      const lines = [
        ...evs.map(({ i, sk }) => [sk || "", `  ${i.done ? "[x]" : "[ ]"} ${i.allDay ? "ganztägig " : i.date < k ? "(Fortsetzung) " : i.time + " "}Termin: ${i.title}` +
          `${i.endDate > i.date ? ` (${fmtKey(i.date)} – ${fmtKey(i.endDate)})` : !i.allDay ? `–${i.endTime}` : ""}${i.recurring ? " (Serie)" : ""}${s(i.location) ? ` · ${s(i.location)}` : ""}${s(i.note) ? ` – ${s(i.note)}` : ""}`]),
        ...items.map((t) => [t.time || "99", `  ${t.done ? "[x]" : "[ ]"} ${t.time ? t.time + " " : ""}${t.title}${s(t.note) ? ` – ${s(t.note)}` : ""}`]),
      ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      for (const [, l] of lines) bits.push(l);
      if (bits.length) { any = true; out.push("", `${fmtKeyWd(k)}${k === today ? " (heute)" : ""}`, ...bits); }
    }
    if (!any) out.push("", "In diesem Zeitraum steht nichts im Planer.");
    const undated = todos.filter((t) => t.kind !== "einsatz" && t.kind !== "geburtstag" && !t.done && !t.date);
    if (undated.length) out.push("", "Offen ohne Datum:", ...undated.sort(sortTodos).map((t) => `  [ ] ${t.title}`));
    const late = todos.filter((t) => t.kind !== "einsatz" && t.kind !== "geburtstag" && !t.done && t.date && (t.kind !== "termin" || !parseRRule(t.rrule)) && (t.endDate && t.endDate > t.date ? t.endDate : t.date) < from);
    if (late.length) out.push("", `Überfällig (vor ${fmtKey(from)}):`, ...late.sort(sortTodos).map((t) => `  [ ] ${fmtKey(t.date)} ${t.title}`));
    return out.join("\n");
  },
});

/* ===== Geld ===== */

async function moneyCats(d) {
  const cats = (await d.alltag("money_cats")).filter((c) => c && c.id && !c.deleted);
  const map = new Map(DEFAULT_CATS.map((c) => [c.id, c]));
  for (const c of cats) map.set(c.id, { ...map.get(c.id), ...c });
  return map;
}
const catName = (map, id) => { const c = map.get(id); return c ? `${c.emoji ? c.emoji + " " : ""}${c.name}` : id || "Sonstiges"; };

tool({
  name: "geld_lesen",
  title: "Geld-Übersicht",
  description: "Geld-Bereich der App (Alltag → Geld): Einnahmen, Ausgaben und Saldo eines Monats, Ausgaben je Kategorie, Budget-Stand (Warnung ab 80 %), kommende Abo-Zahlungen und Sparziele. Ohne Angabe: aktueller Monat.",
  inputSchema: {
    type: "object",
    properties: { monat: { type: "string", description: "z. B. \"2026-11\", \"11.2026\", \"Oktober\", \"letzter\"" } },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const mk = parseMonth(args.monat, today);
    if (!mk) throw new UserError(`Monat „${s(args.monat)}“ verstehe ich nicht (z. B. "2026-11" oder "Oktober").`);
    const [txs, budget, subs, goals, cats] = await Promise.all([
      d.alltag("money_tx"), d.alltag("money_budget"), d.alltag("money_subs"), d.alltag("money_goals"), moneyCats(d),
    ]);
    if (!txs.length && !budget.length && !subs.length && !goals.length) {
      return "Im Bereich Geld ist noch nichts eingetragen. Du kannst mit „ausgabe_eintragen“ gleich die erste Buchung anlegen.";
    }
    const list = txs.filter((t) => String(t.date || "").slice(0, 7) === mk);
    let inc = 0, outSum = 0;
    for (const t of list) { const a = Number(t.amount) || 0; if (t.type === "in") inc += a; else outSum += a; }
    const out = [`Geld – ${monthLabel(mk)}`, `Einnahmen ${eur(inc)} · Ausgaben ${eur(outSum)} · Saldo ${eur(inc - outSum, { sign: true })} (${list.length} ${list.length === 1 ? "Buchung" : "Buchungen"})`];
    const by = new Map();
    for (const t of list) if (t.type !== "in") { const c = t.category || "sonstiges"; by.set(c, (by.get(c) || 0) + (Number(t.amount) || 0)); }
    if (by.size) {
      out.push("", "Ausgaben nach Kategorie:");
      for (const [c, v] of [...by.entries()].sort((a, b) => b[1] - a[1])) out.push(`- ${catName(cats, c)}: ${eur(v)}${outSum > 0 ? ` (${Math.round(v / outSum * 100)} %)` : ""}`);
    } else if (!list.length) out.push("", "In diesem Monat gibt es noch keine Buchungen.");
    const bmap = new Map(budget.map((b) => [b.id, Number(b.amount) || 0]));
    const brow = [];
    if (bmap.get("total") > 0) brow.push(["Gesamt", outSum, bmap.get("total")]);
    for (const [id, lim] of bmap) if (id !== "total" && lim > 0) brow.push([catName(cats, id), by.get(id) || 0, lim]);
    if (brow.length) {
      out.push("", "Budget:");
      for (const [n, sp, lim] of brow) {
        const lv = budgetLevel(sp, lim);
        const flag = lv.level === "over" ? " – ÜBERSCHRITTEN" : lv.level === "warn" ? " – Achtung, fast aufgebraucht" : "";
        out.push(`- ${n}: ${eur(sp)} von ${eur(lim)} (${Math.round(lv.ratio * 100)} %, übrig ${eur(Math.max(0, lim - sp))})${flag}`);
      }
    }
    const act = subs.filter((x) => x && !x.paused);
    if (act.length) {
      const up = upcoming(act, today, 31);
      const monthly = act.reduce((a, x) => a + monthlyCost(x), 0);
      out.push("", `Abos & Fixkosten: ${act.length} aktiv, zusammen ca. ${eur(monthly)} pro Monat (${eur(monthly * 12)} pro Jahr).`);
      if (up.length) out.push("Nächste Zahlungen (31 Tage):", ...up.slice(0, 12).map((u) => `- ${fmtKeyWd(u.date)}: ${u.sub.name || "Abo"} ${eur(u.sub.amount)} (${INTERVALS[u.sub.interval] || "monatlich"})`));
    }
    if (goals.length) {
      out.push("", "Sparziele:");
      for (const g of goals) {
        const tg = Number(g.target) || 0, sv = Number(g.saved) || 0;
        out.push(`- ${g.emoji ? g.emoji + " " : ""}${g.name || "Ziel"}: ${eur(sv)} von ${eur(tg)}${tg > 0 ? ` (${Math.min(100, Math.round(sv / tg * 100))} %)` : ""}${isKey(g.date) ? ` bis ${fmtKey(g.date)}` : ""}`);
      }
    }
    return out.join("\n");
  },
});

tool({
  name: "ausgabe_eintragen",
  title: "Buchung eintragen",
  description: "Trägt eine Ausgabe (oder mit typ \"einnahme\" eine Einnahme) im Geld-Bereich ein. Ohne Kategorie wird sie wie in der App aus der Notiz erraten (z. B. Billa → Essen & Einkauf, OMV → Auto & Tanken, Lehrlingsentschädigung → Einkommen).",
  inputSchema: {
    type: "object",
    properties: {
      betrag: { type: ["number", "string"], description: "Betrag in Euro, positiv, z. B. 12.5 oder \"12,50\"" },
      kategorie: { type: "string", description: "Kategorie-Name oder -ID, z. B. \"Essen gehen\", \"auto\"" },
      notiz: { type: "string", description: "Wofür, z. B. \"Billa Jause\"" },
      datum: { type: "string", description: "Standard heute" },
      typ: { type: "string", enum: ["ausgabe", "einnahme"], description: "Standard ausgabe" },
    },
    required: ["betrag"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const amount = parseAmount(args.betrag);
    if (!(amount > 0)) throw new UserError("Bitte einen positiven Betrag angeben (z. B. 12,50).");
    if (amount > 1000000) throw new UserError("Der Betrag ist unrealistisch hoch.");
    const tv = s(args.typ).toLowerCase();
    const type = /^(ein|in|einnahme)/.test(tv) ? "in" : "out";
    const date = dateArg(args.datum, today) || today;
    const note = s(args.notiz);
    const [cats, rules] = await Promise.all([moneyCats(d), d.alltag("money_rules").catch(() => [])]);
    const pool = [...cats.values()].filter((c) => (c.type === "in" ? "in" : "out") === type);
    let cat = null, how = "";
    if (s(args.kategorie)) {
      const byId = pool.find((c) => c.id === s(args.kategorie).toLowerCase());
      const m = byId ? { item: byId } : best(args.kategorie, pool, (c) => c.name, 55);
      if (m) cat = m.item.id;
      else how = ` (Kategorie „${s(args.kategorie)}“ gibt es nicht – ${type === "in" ? "Sonstige Einnahmen" : "Sonstiges"} genommen)`;
    }
    if (!cat && !how) {
      const sug = suggestCategory(note, rules, new Set(pool.map((c) => c.id)));
      if (sug) { cat = sug.cat; how = ` (automatisch erkannt über „${sug.keyword.trim()}“)`; }
    }
    if (!cat) cat = type === "in" ? "sonstein" : "sonstiges";
    const id = alltagId(d.now);
    const data = { date, amount: round2(amount), type, category: cat, note, id, updated: d.now, created: d.now, src: SRC };
    await d.commit([d.fs.setWrite(d.p(`a_money_tx/${id}`), data)]);
    return `${type === "in" ? "Einnahme" : "Ausgabe"} gebucht: ${eur(amount)} am ${fmtKey(date)} · ${catName(cats, cat)}${how}${note ? ` · „${note}“` : ""}.`;
  },
});

/* ===== Schule ===== */

function countdown(today, k) {
  const n = diffDays(today, k);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === 2) return "übermorgen";
  if (n > 0) return `noch ${n} Tage`;
  return n === -1 ? "seit gestern" : `seit ${-n} Tagen`;
}
function avgOf(list) {
  let sum = 0, w = 0;
  for (const g of list) {
    const n = Number(g.grade), gw = Number(g.weight) > 0 ? Number(g.weight) : 1;
    if (n >= 1 && n <= 5) { sum += n * gw; w += gw; }
  }
  return w ? sum / w : null;
}
const prioLabel = (p) => (p === "high" ? "wichtig" : p === "low" ? "niedrig" : "");

async function schoolSubjects(d) {
  const lists = await Promise.all(["timetable", "tasks", "exams", "grades"].map((n) => d.alltag("school_" + n).catch(() => [])));
  const seen = new Map();
  for (const l of lists) for (const x of l) { const v = s(x.subject); if (v) seen.set(v.toLowerCase(), v); }
  return [...seen.values()];
}
async function resolveSubject(d, q) {
  const v = s(q);
  if (!v) return "";
  const subs = await schoolSubjects(d);
  const m = best(v, subs, (x) => x, 70);
  return m ? m.item : v;
}

tool({
  name: "schule_lesen",
  title: "Schule & Lernen",
  description: "Schul-Bereich der App (Alltag → Schule & Lernen): kommende Prüfungen/Schularbeiten mit Countdown und Lernfortschritt, offene Hausaufgaben (überfällig/heute/demnächst), Notenschnitt je Fach und gesamt (österreichische Noten 1–5, gewichtet) sowie die nächsten Berufsschultage.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: RO,
  async run(_a, d) {
    const today = dayKey(d.now);
    const [exams, tasks, grades, settings] = await Promise.all([
      d.alltag("school_exams"), d.alltag("school_tasks"), d.alltag("school_grades"), d.settings(),
    ]);
    const out = ["Schule & Lernen"];
    const sc = readSchool(settings);
    if (sc) {
      const next = [];
      for (let k = today, i = 0; i < 60 && next.length < 4; k = addDays(k, 1), i++) { const l = schoolLabel(k, settings); if (l) next.push(`${fmtKeyWd(k)}${l !== "Berufsschule" ? ` (${l})` : ""}`); }
      if (next.length) out.push(`Nächste Berufsschultage: ${next.join(", ")}`);
    }
    if (!exams.length && !tasks.length && !grades.length) {
      out.push("", "Im Bereich Schule sind noch keine Prüfungen, Aufgaben oder Noten eingetragen. Mit „pruefung_anlegen“ oder „hausaufgabe_anlegen“ kannst du gleich etwas anlegen.");
      return out.join("\n");
    }
    const up = exams.filter((e) => isKey(e.date) && e.date >= today).sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? -1 : 1));
    out.push("", up.length ? "Kommende Prüfungen:" : "Keine kommenden Prüfungen eingetragen.");
    for (const e of up) {
      const topics = String(e.topics || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
      out.push(`- ${fmtKeyWd(e.date)}${e.time ? " " + e.time : ""} (${countdown(today, e.date)}): ${e.kind || "Prüfung"} ${e.subject || ""}`.trimEnd() + `${Number(e.progress) ? ` · gelernt ${Math.round(Number(e.progress))} %` : ""}`);
      if (topics.length) out.push(`  Stoff: ${topics.join("; ")}`);
    }
    const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1);
    out.push("", open.length ? "Offene Hausaufgaben:" : "Keine offenen Hausaufgaben.");
    for (const t of open) {
      const when = t.due ? `${fmtKeyWd(t.due)} – ${t.due < today ? "überfällig " + countdown(today, t.due) : countdown(today, t.due)}` : "ohne Termin";
      const pr = prioLabel(t.prio);
      out.push(`- ${t.subject ? t.subject + ": " : ""}${t.title || "Aufgabe"} (${when}${pr ? ", " + pr : ""})${s(t.note) ? ` – ${s(t.note)}` : ""}`);
    }
    if (grades.length) {
      const by = new Map();
      for (const g of grades) { const k = s(g.subject) || "Ohne Fach"; if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
      const rows = [...by.entries()].map(([sub, l]) => ({ sub, avg: avgOf(l), n: l.length })).sort((a, b) => a.sub.localeCompare(b.sub, "de"));
      const avgs = rows.map((r) => r.avg).filter((x) => x != null);
      const overall = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
      out.push("", `Notenschnitt gesamt: ${overall == null ? "–" : `${dec(overall)} (${GRADE_NAMES[Math.round(overall)]})`} aus ${grades.length} ${grades.length === 1 ? "Note" : "Noten"}`);
      for (const r of rows) out.push(`- ${r.sub}: Ø ${r.avg == null ? "–" : dec(r.avg)} (${r.n} ${r.n === 1 ? "Note" : "Noten"})`);
    } else out.push("", "Noch keine Noten eingetragen.");
    return out.join("\n");
  },
});

tool({
  name: "hausaufgabe_anlegen",
  title: "Hausaufgabe anlegen",
  description: "Legt eine Hausaufgabe/Abgabe im Schul-Bereich an (Fach, Titel, fällig, Priorität).",
  inputSchema: {
    type: "object",
    properties: {
      titel: { type: "string" },
      fach: { type: "string", description: "z. B. \"Elektrotechnik\", \"Deutsch\"" },
      faellig: { type: "string", description: "Abgabedatum (Standard: morgen)" },
      prioritaet: { type: "string", enum: ["niedrig", "normal", "hoch"] },
      notiz: { type: "string" },
    },
    required: ["titel"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const title = need(args.titel, "Bitte einen Titel angeben.");
    const due = dateArg(args.faellig, today, "Fälligkeit") || addDays(today, 1);
    const p = s(args.prioritaet).toLowerCase();
    const prio = p.startsWith("hoch") || p === "wichtig" || p === "high" ? "high" : p.startsWith("niedr") || p === "low" ? "low" : "normal";
    const subject = await resolveSubject(d, args.fach);
    const id = alltagId(d.now);
    const data = { done: false, title, prio, subject, due, note: s(args.notiz), id, updated: d.now, created: d.now, src: SRC };
    await d.commit([d.fs.setWrite(d.p(`a_school_tasks/${id}`), data)]);
    return `Hausaufgabe angelegt: ${subject ? subject + " – " : ""}„${title}“, fällig ${fmtKeyWd(due)} (${countdown(today, due)})${prio !== "normal" ? `, Priorität ${prioLabel(prio)}` : ""}.`;
  },
});

tool({
  name: "pruefung_anlegen",
  title: "Prüfung anlegen",
  description: "Trägt eine Prüfung, Schularbeit, einen Test o. Ä. im Schul-Bereich ein (Fach, Art, Datum, optional Uhrzeit und Stoff – ein Thema pro Zeile oder durch Strichpunkt getrennt).",
  inputSchema: {
    type: "object",
    properties: {
      fach: { type: "string" },
      datum: { type: "string" },
      art: { type: "string", description: "Schularbeit (Standard), Test, Prüfung, Mündlich, Referat, Lehrabschlussprüfung" },
      uhrzeit: { type: "string", description: "HH:MM (optional)" },
      stoff: { type: "string", description: "Themen, z. B. \"Ohmsches Gesetz; Kirchhoff\"" },
    },
    required: ["fach", "datum"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    need(args.fach, "Bitte ein Fach angeben.");
    const date = dateArg(need(args.datum, "Bitte ein Datum angeben."), today);
    const km = s(args.art) ? best(args.art, EXAM_KINDS, (x) => x, 55) : null;
    const kind = km ? km.item : /^lap$/i.test(s(args.art)) ? "Lehrabschlussprüfung" : "Schularbeit";
    const time = s(args.uhrzeit) ? fmtTime(timeArg(args.uhrzeit, "Uhrzeit")) : "";
    const topics = String(args.stoff || "").split(/\s*[;\n]\s*/).map((x) => x.trim()).filter(Boolean).join("\n");
    const subject = await resolveSubject(d, args.fach);
    const id = alltagId(d.now);
    const data = { progress: 0, subject, kind, date, time, topics, id, updated: d.now, created: d.now, src: SRC };
    await d.commit([d.fs.setWrite(d.p(`a_school_exams/${id}`), data)]);
    return `${kind} eingetragen: ${subject} am ${fmtKeyWd(date)}${time ? ` um ${time}` : ""} (${countdown(today, date)})${topics ? `\nStoff: ${topics.split("\n").join("; ")}` : ""}.\nTipp: In der App kannst du daraus einen Lernplan erstellen lassen.`;
  },
});

export function toolList() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export function findTool(name) { return TOOLS.find((t) => t.name === name) || null; }

export { UserError, score, WD, parseKey, wdOf, shiftMonth };
