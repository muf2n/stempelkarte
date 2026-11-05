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
import * as MAT from "./material.js";
import { DELETE_TOOLS } from "./delete.js";
import * as PM from "./privat.js"; // Update 9 – Privat / Arbeit
import { vienna } from "./time.js";
import { DEFAULT_CATS, suggestCategory, parseAmount, budgetLevel, upcoming, monthlyCost, round2, INTERVALS } from "./money.js";
import * as AB from "./subs.js"; // Update 9 – Abos: „Wie lange noch“, Fristen, Katalog (gemeinsam mit der Web-App)
import * as MC from "./moneycore.js";
import { READ_TOOLS, schoolSection, moneyExtra } from "./read.js"; // Update 9 – Claude sieht (fast) alles
import { WRITE_TOOLS } from "./write.js"; // Update 9 – Claude darf (fast) alles ändern
import { SETTINGS_TOOLS } from "./settings.js"; // Update 9 – Einstellungen nur mit Bestätigung
import { GMAIL_TOOLS } from "./gmail.js"; // Gmail dauerhaft (nur lesen): mails_suchen, mail_lesen

const ABS_KINDS = ["urlaub", "krank", "zeitausgleich", "schule", "feiertag"];
const GRADE_NAMES = { 1: "Sehr gut", 2: "Gut", 3: "Befriedigend", 4: "Genügend", 5: "Nicht genügend" };
const EXAM_KINDS = ["Schularbeit", "Test", "Prüfung", "Mündlich", "Referat", "Lehrabschlussprüfung"];

import { SRC, RO, WR, s, pad2, need, dateArg, timeArg, boolArg, placeName, matchPlace, resolvePlace, countdown } from "./util.js";

function lastSeg(r) { const sg = segmentsOf(r); return sg[sg.length - 1] || null; }

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

/* ---------- Update 9: Privat / Arbeit ---------- */

function calOf(settings) {
  return (ts) => {
    const v = vienna(ts);
    return { key: v.key, wd: v.wd, min: v.hh * 60 + v.mm, holiday: settings.holidays !== false && !!holidayName(v.key) };
  };
}
function modeOf(settings, running, now) {
  return PM.effectiveMode(settings, now, { running, calOf: calOf(settings) });
}
function dayWord(ts, now) {
  const k = dayKey(ts), t = dayKey(now);
  if (k === t) return "";
  if (k === addDays(t, 1)) return "morgen";
  return fmtKeyWd(k);
}
function modeLine(settings, running, now) {
  return "Modus: " + PM.modeText(modeOf(settings, running, now), clock, (ts) => dayWord(ts, now));
}

/* ---------- Werkzeuge ---------- */


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
    out.push(modeLine(settings, r, now)); // Update 9 – Privat / Arbeit
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

/** Wochen-Angabe (leer, "letzte", "KW 45", "2026-W45", "-2", Datum) → Montag "YYYY-MM-DD". */
export function weekStart(arg, today) {
  const w = s(arg).toLowerCase();
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
    const k = dateArg(arg, today, "Woche");
    ws = mondayOf(k);
  }
  return ws;
}

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
    const ws = weekStart(args.woche, today);
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
  name: "modus_setzen",
  title: "Privat / Arbeit umschalten",
  description: "Schaltet zwischen Arbeit und Privat um (wie der Schalter „Arbeit | Privat“ in der App). Im Privat-Modus wird nicht automatisch eingestempelt, es kommen keine „Nicht eingestempelt“-Erinnerungen und Fahrten zählen als Privatfahrt (0 h). Optional „bis“: \"1h\" (1 Stunde), \"abend\" (heute 20:00), \"morgen\" (morgen früh zu Arbeitsbeginn), eine Uhrzeit HH:MM (heute bzw. morgen) – ohne „bis“ gilt Privat, bis wieder auf Arbeit geschaltet wird. Während einer laufenden Schicht wird nicht umgeschaltet (zuerst ausstempeln).",
  inputSchema: {
    type: "object",
    properties: {
      modus: { type: "string", enum: ["privat", "arbeit"], description: "\"privat\" oder \"arbeit\"" },
      bis: { type: "string", description: "Nur bei privat: \"1h\", \"abend\", \"morgen\" oder HH:MM" },
    },
    required: ["modus"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const now = d.now, today = dayKey(now);
    const want = s(args.modus).toLowerCase();
    if (want !== "privat" && want !== "arbeit") throw new UserError("„modus“ muss \"privat\" oder \"arbeit\" sein.");
    const [st, settings] = await Promise.all([d.state(), d.settings()]);
    const r = st.running;
    let until = null;
    if (want === "privat") {
      if (r) throw new UserError(`Du bist eingestempelt (seit ${clock(r.start)}). Bitte zuerst ausstempeln – ich stemple nie still aus.`);
      const b = s(args.bis).toLowerCase().replace(/\s+/g, "");
      if (b) {
        const ids = { "1h": "1h", "1std": "1h", "1stunde": "1h", abend: "abend", heuteabend: "abend", morgen: "morgen", morgenfrüh: "morgen", morgenfrueh: "morgen", aus: "aus" };
        const tsOf = (off, hh, mm) => keyToTs(addDays(today, off), hh, mm);
        if (ids[b]) {
          const u = PM.untilFor(ids[b], now, settings, tsOf);
          if (!u.ok) throw new UserError("„bis heute Abend“ geht jetzt nicht mehr – bitte eine Uhrzeit angeben.");
          until = u.until;
        } else {
          const t = timeArg(args.bis, "„bis“");
          until = keyToTs(today, t.h, t.mi);
          if (until <= now) until = keyToTs(addDays(today, 1), t.h, t.mi);
        }
      }
    } else if (args.bis != null && s(args.bis)) {
      throw new UserError("„bis“ gibt es nur für den Privat-Modus.");
    }
    const mode = PM.modeValue(want === "privat", now, until, "manual");
    await d.commit([d.fs.patchWrite(d.p("meta/settings"), { mode })]);
    d.invalidate("settings");
    const after = await d.settings();
    const out = [want === "privat"
      ? `Privat-Modus an${until ? ` bis ${dayWord(until, now) ? dayWord(until, now) + " " : ""}${clock(until)}` : " (bis du wieder auf Arbeit schaltest)"} – nichts zählt als Arbeit.`
      : "Arbeit-Modus an – Stempeln wieder wie gewohnt."];
    out.push(modeLine(after, r, now));
    if (want === "arbeit" && !r) out.push("Zum Einstempeln: „einstempeln“ verwenden.");
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
    // Update 9 – Einstempeln beendet ein selbst gewähltes Privat (wie in der App)
    const pm = PM.readMode(settings);
    if (pm && pm.privat && pm.source === "manual") {
      await d.commit([d.fs.patchWrite(d.p("meta/settings"), { mode: PM.modeValue(false, now, null, "manual") })]);
      d.invalidate("settings");
      out.push("Privat-Modus beendet.");
    }
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

export function sortTodos(a, b) {
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

/** Wiederholung (Wort oder RRULE, optional wiederholen_bis/anzahl) zum Starttag → RRULE-Text oder null („keine“). */
export function repeatRule(args, date, today) {
  const w = s(args.wiederholung).toLowerCase();
  const wd = RD[wdOf(date)];
  let rr;
  if (/^(rrule:)?freq=/i.test(w)) rr = parseRRule(w.toUpperCase()) ? formatRRule(w.toUpperCase()) : null;
  else {
    const hit = REPEAT_WORDS.find(([re]) => re.test(w));
    if (!hit) throw new UserError("wiederholung: täglich, werktags, wöchentlich, alle 2 wochen, monatlich, jährlich, keine oder eine RRULE (FREQ=…).");
    rr = hit[1] === "W" ? `FREQ=WEEKLY;BYDAY=${wd}` : hit[1] === "W2" ? `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}` : hit[1] === "M" ? `FREQ=MONTHLY;BYMONTHDAY=${Number(date.slice(8))}` : hit[1];
  }
  if (!rr) return null;
  const r = parseRRule(rr);
  if (s(args.wiederholen_bis)) { r.until = dateArg(args.wiederholen_bis, today, "wiederholen_bis"); r.count = null; }
  else if (args.anzahl != null) { const n = Math.round(Number(args.anzahl)); if (!(n >= 1 && n <= 999)) throw new UserError("anzahl muss 1–999 sein."); r.count = n; r.until = null; }
  return formatRRule(r);
}

/** Update 9 – Kalender: Zusatzfelder für Termine (Ende, ganztägig, Ort, Wiederholung, mehrere Erinnerungen, Kalender). */
export async function eventArgs(d, args, base, today) {
  const t = { ...base };
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
    const rr = repeatRule(args, t.date, today);
    if (rr) t.rrule = rr;
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
  if (args.countdown === true) { if (!date) throw new UserError("Ein Countdown braucht ein Datum."); base.countdown = true; }
  if (kind === "termin") base = await eventArgs(d, args, base, today);
  const full = normTodo(base, id, d.now);
  const { id: _i, ...data } = full;
  await d.commit([d.fs.setWrite(d.p(`todos/${id}`), clean(data))]);
  return full;
}

/** Geburtstag „TT.MM.“ oder „TT.MM.JJJJ“ → {bday:"MM-DD", byear|null}. */
export function bdayArg(v) {
  const m = /^(\d{1,2})\.\s?(\d{1,2})\.?\s?(\d{4})?$/.exec(s(v)) || /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s(v));
  if (!m) throw new UserError(`Geburtstag „${s(v)}“ verstehe ich nicht – bitte TT.MM. oder TT.MM.JJJJ (z. B. 24.03.2001).`);
  const iso = m[0].includes("-");
  const d = Number(iso ? m[3] : m[1]), mo = Number(m[2]), y = iso ? Number(m[1]) : m[3] ? Number(m[3]) : null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(2024, mo, 0)).getUTCDate())) throw new UserError("Dieses Datum gibt es nicht.");
  if (y != null && !(y > 1850 && y < 2200)) throw new UserError("Das Geburtsjahr ist ungültig.");
  return { bday: `${pad2(mo)}-${pad2(d)}`, byear: y };
}

tool({
  name: "todo_anlegen",
  title: "Aufgabe / Geburtstag anlegen",
  description: "Legt eine Aufgabe im Planer an (wie „Neu im Planer → Aufgabe“) – mit art \"geburtstag\" stattdessen einen Geburtstag (jährlich, datum = TT.MM. oder TT.MM.JJJJ). Mit Fälligkeitsdatum und Uhrzeit wird standardmäßig eine Push-Erinnerung (30 min vorher) eingestellt; countdown: true zeigt oben im Planer „noch X Tage“.",
  inputSchema: {
    type: "object",
    properties: {
      titel: { type: "string", description: "Was ist zu tun? Bei Geburtstag: Name der Person" },
      art: { type: "string", enum: ["aufgabe", "geburtstag"], description: "Standard aufgabe" },
      faellig: { type: "string", description: "Fälligkeitsdatum (optional), z. B. \"morgen\", \"10.11.2026\"" },
      datum: { type: "string", description: "Nur Geburtstag: TT.MM. oder TT.MM.JJJJ" },
      uhrzeit: { type: "string", description: "Uhrzeit HH:MM (optional)" },
      notiz: { type: "string" },
      erinnern: { type: "boolean", description: "Push-Erinnerung (Aufgabe: nur mit Datum und Uhrzeit; Geburtstag: am Tag um 09:00)" },
      erinnern_min: { type: "number", description: "Minuten vorher (Standard 30)" },
      countdown: { type: "boolean", description: "Countdown „noch X Tage“ oben im Planer (braucht Datum)" },
    },
    required: ["titel"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    if (s(args.art) === "geburtstag") {
      const title = need(args.titel, "Bitte den Namen angeben.").slice(0, 80);
      const b = bdayArg(need(args.datum || args.faellig, "Bitte das Geburtsdatum (TT.MM. oder TT.MM.JJJJ) angeben."));
      const id = newId("t", d.now);
      const rt = s(args.uhrzeit) ? fmtTime(timeArg(args.uhrzeit, "Uhrzeit")) : "09:00";
      const full = normTodo({ kind: "geburtstag", title, ...b, date: null, time: rt, remind: args.erinnern !== false, remindDays: 0, remindMin: 0, note: s(args.notiz), done: false, doneAt: null, createdAt: d.now, src: SRC }, id, d.now);
      const { id: _i, ...data } = full;
      await d.commit([d.fs.setWrite(d.p(`todos/${id}`), clean(data))]);
      return `Geburtstag gespeichert: ${title} am ${b.bday.slice(3)}.${b.bday.slice(0, 2)}.${b.byear ? b.byear : ""}${full.remind ? `, Erinnerung am Tag um ${rt}` : ""} 🎂\n(ID ${id})`;
    }
    const t = await createTodo(d, "todo", args);
    return `Aufgabe angelegt: „${t.title}“${t.date ? ` – fällig ${fmtKeyWd(t.date)}${t.time ? " " + t.time : ""}` : " (ohne Datum)"}${t.remind ? `, Erinnerung ${t.remindMin} min vorher` : ""}${t.countdown ? ", mit Countdown" : ""}.\n(ID ${t.id})`;
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
      countdown: { type: "boolean", description: "Countdown „noch X Tage“ oben im Planer anzeigen" },
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
    return `Termin angelegt: „${t.title}“ am ${fmtKeyWd(t.date)}${t.time ? ` um ${t.time}` : ""}${rem}${extra ? ` · ${extra}` : ""}${t.countdown ? " · mit Countdown" : ""}.\n(ID ${t.id})`;
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

/** Erinnerungen eines Termins kurz („ · 🔔 30 min, 1 Tag vorher“). */
function remText(t) {
  const list = Array.isArray(t && t.reminders) && t.reminders.length ? t.reminders : t && t.remind ? [t.remindMin] : [];
  if (!list.length) return "";
  const f = (m) => (m % 1440 === 0 && m ? `${m / 1440} ${m === 1440 ? "Tag" : "Tage"}` : m % 60 === 0 && m ? `${m / 60} h` : `${m} min`);
  return ` · 🔔 ${list.map(f).join(", ")} vorher`;
}

tool({
  name: "planer_lesen",
  title: "Planer lesen",
  description: "Kalender/Planer Tag für Tag: Termine (Serien aufgeklappt, mit Ausnahmen, Ort, Erinnerungen und ID), Aufgaben mit Datum, Geburtstage, Einsätze (Einsatzplan), Berufsschultage und Feiertage im Zeitraum; dazu offene Aufgaben ohne Datum und Überfälliges. Ohne Angabe: heute + 6 Tage (höchstens 92 Tage).",
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
      for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) bdays.push({ title: t.title, date: `${y}-${pad2(m[1])}-${pad2(m[2])}`, age: Number(t.byear) > 1850 ? y - Number(t.byear) : null });
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
      for (const b of bdays) if (b.date === k) bits.push(`  🎂 Geburtstag: ${b.title}${b.age ? ` (${b.age})` : ""}`);
      const items = todos.filter((t) => t.kind !== "einsatz" && t.kind !== "termin" && t.kind !== "geburtstag" && t.date === k).sort(sortTodos);
      const evs = (byDay.get(k) || []).map((i) => ({ i, sk: i.allDay || i.date < k ? "" : i.time }));
      const lines = [
        ...evs.map(({ i, sk }) => [sk || "", `  ${i.done ? "[x]" : "[ ]"} ${i.allDay ? "ganztägig " : i.date < k ? "(Fortsetzung) " : i.time + " "}Termin: ${i.title}` +
          `${i.endDate > i.date ? ` (${fmtKey(i.date)} – ${fmtKey(i.endDate)})` : !i.allDay ? `–${i.endTime}` : ""}${i.recurring ? " (Serie)" : ""}${s(i.location) ? ` · ${s(i.location)}` : ""}${s(i.note) ? ` – ${s(i.note)}` : ""}${remText(i.t)} (ID ${i.id}${i.recurring ? `, Wiederholung ${fmtKey(i.key)}` : ""})`]),
        ...items.map((t) => [t.time || "99", `  ${t.done ? "[x]" : "[ ]"} ${t.time ? t.time + " " : ""}${t.title}${s(t.note) ? ` – ${s(t.note)}` : ""}${t.countdown ? " ⏳" : ""} (ID ${t.id})`]),
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

export async function moneyCats(d) {
  const cats = (await d.alltag("money_cats")).filter((c) => c && c.id && !c.deleted);
  const map = new Map(DEFAULT_CATS.map((c) => [c.id, c]));
  for (const c of cats) map.set(c.id, { ...map.get(c.id), ...c });
  return map;
}
export const catName = (map, id) => { const c = map.get(id); return c ? `${c.emoji ? c.emoji + " " : ""}${c.name}` : id || "Sonstiges"; };

tool({
  name: "geld_lesen",
  title: "Geld-Übersicht",
  description: "Geld-Bereich der App (Alltag → Geld): Einnahmen, Ausgaben und Saldo eines Monats, Ausgaben je Kategorie, Budget-Stand (Warnung ab 80 %), kommende Abo-Zahlungen, Sparziele (mit „pro Monat nötig“), Teilen-Gruppen mit Salden („Max schuldet dir …“) und – falls verbunden – Kontostand der Bank. Mit buchungen: true auch die einzelnen Buchungen. Ohne Angabe: aktueller Monat.",
  inputSchema: {
    type: "object",
    properties: {
      monat: { type: "string", description: "z. B. \"2026-11\", \"11.2026\", \"Oktober\", \"letzter\"" },
      buchungen: { type: "boolean", description: "Auch die einzelnen Buchungen des Monats auflisten (höchstens 60)" },
    },
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
    const extra = await moneyExtra(d);
    if (!txs.length && !budget.length && !subs.length && !goals.length && !extra.length) {
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
    const act = subs.filter((x) => x && !x.paused && !(isKey(x.ended) && x.ended < today));
    if (act.length) {
      const up = upcoming(act, today, 31);
      const monthly = act.reduce((a, x) => a + monthlyCost(x), 0);
      out.push("", `Abos & Fixkosten: ${act.length} aktiv, zusammen ca. ${eur(monthly)} pro Monat (${eur(monthly * 12)} pro Jahr).`);
      if (up.length) out.push("Nächste Zahlungen (31 Tage):", ...up.slice(0, 12).map((u) => `- ${fmtKeyWd(u.date)}: ${u.sub.name || "Abo"} ${eur(u.sub.amount)} (${INTERVALS[u.sub.interval] || "monatlich"})`));
      out.push("(Laufzeiten, Kündigungsfristen und Kündigungslinks: abos_lesen)");
    }
    if (goals.length) {
      out.push("", "Sparziele:");
      for (const g of goals) {
        const tg = Number(g.target) || 0, sv = Number(g.saved) || 0;
        const pm = MC.goalPerMonth(g, today);
        out.push(`- ${g.emoji ? g.emoji + " " : ""}${g.name || "Ziel"}: ${eur(sv)} von ${eur(tg)}${tg > 0 ? ` (${Math.min(100, Math.round(sv / tg * 100))} %)` : ""}${isKey(g.date) ? ` bis ${fmtKey(g.date)}` : ""}${pm.done ? " – erreicht 🎉" : pm.perMonth ? ` – noch ${eur(pm.perMonth)} pro Monat nötig` : ""}`);
      }
    }
    out.push(...extra);
    if (args.buchungen === true && list.length) {
      out.push("", "Buchungen:");
      for (const x of [...list].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60)) out.push(`- ${fmtKey(x.date)} ${x.type === "in" ? "+" : "−"}${eur(Number(x.amount) || 0)} · ${catName(cats, x.category)}${s(x.note) ? ` · „${s(x.note).slice(0, 60)}“` : ""}${x.src === "bank" ? " · Bank" : ""} (ID ${x.id})`);
      if (list.length > 60) out.push(`… und ${list.length - 60} weitere`);
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

/* ===== Abos (Update 9) ===== */

const IV_ALIASES = { week: "week", woche: "week", wöchentlich: "week", woechentlich: "week", month: "month", monat: "month", monatlich: "month", quarter: "quarter", quartal: "quarter", vierteljährlich: "quarter", vierteljaehrlich: "quarter", year: "year", jahr: "year", jährlich: "year", jaehrlich: "year" };
// deutsche Feldnamen → Feld in money_subs
const AB_ALIASES = {
  was: "what", beschreibung: "what", betrag: "amount", preis: "amount", intervall: "interval", naechste_abbuchung: "next", "nächste_abbuchung": "next", naechste: "next",
  seit: "startDate", start: "startDate", vertragsart: "contractType", mindestlaufzeit_bis: "minTermEnd", vertragsende: "contractEnd", bezahlt_bis: "contractEnd",
  kuendigungsfrist: "noticeText", "kündigungsfrist": "noticeText", kuendigungsfrist_tage: "noticeDays", verlaengert_automatisch: "autoRenew", "verlängert_automatisch": "autoRenew",
  testzeitraum_bis: "trialEnd", kuendigungslink: "cancelUrl", "kündigungslink": "cancelUrl", verwalten_link: "manageUrl", so_kuendigen: "cancelHow", "so_kündigen": "cancelHow",
  gekuendigt_am: "cancelledOn", "gekündigt_am": "cancelledOn", laeuft_aus_am: "ended", "läuft_aus_am": "ended", konto: "account", login: "account",
  erinnerung: "remind", pausiert: "paused", kategorie: "category",
};
const AB_DATES = new Set(["next", "startDate", "minTermEnd", "contractEnd", "trialEnd", "cancelledOn", "ended"]);
const AB_BOOLS = new Set(["autoRenew", "remind", "paused"]);
const AB_URLS = new Set(["cancelUrl", "manageUrl"]);
const AB_TEXT = { name: 40, what: 120, noticeText: 80, cancelHow: 2000, account: 120 };

async function findSub(d, name) {
  const subs = (await d.alltag("money_subs")).filter((x) => x && x.id && !x.deleted);
  if (!subs.length) throw new UserError("Es sind noch keine Abos eingetragen (App → Alltag → Geld → Abos).");
  const m = best(name, subs, (x) => x.name || "", 55);
  if (!m) throw new UserError(`Kein Abo passt zu „${s(name)}“. Vorhanden: ${subs.map((x) => x.name).join(", ")}.`);
  if (m.ambiguous && m.score < 98) throw new UserError(`„${s(name)}“ ist nicht eindeutig: ${m.item.name} oder ${m.second.name}? Bitte genauer angeben.`);
  return { sub: m.item, subs };
}

tool({
  name: "abos_lesen",
  title: "Abos & Kündigungen",
  description: "Alle Abos und Fixkosten aus Alltag → Geld → Abos mit Details: was es ist, Preis (pro Monat/Jahr), Vertragsart, wie lange es noch läuft („Wie lange noch“), bis wann spätestens gekündigt werden muss, Testzeiträume, Kündigungslink, Verwalten-Link, Schritt-für-Schritt-Anleitung „So kündigst du“ und Login (nie Passwörter). Mit name nur ein Abo.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Optional: nur dieses Abo, z. B. \"Netflix\"" },
      alle: { type: "boolean", description: "Auch beendete/ausgelaufene Abos zeigen (Standard nein)" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    let subs = (await d.alltag("money_subs")).filter((x) => x && x.id && !x.deleted);
    if (!subs.length) return "Es sind noch keine Abos eingetragen. In der App: Alltag → Geld → Abos → +.";
    const one = s(args.name) ? (await findSub(d, args.name)).sub : null;
    const out = [];
    const withCat = (x) => {
      const lines = AB.describeSub(x, today);
      if (!x.cancelUrl) {
        const m = AB.matchCatalog(x.name);
        if (m) lines.push(`  Kündigungslink (Vorschlag aus dem Katalog, noch nicht eingetragen): ${m.entry.cancelUrl}`, `  So kündigst du (Katalog): ${m.entry.cancelHow.replace(/\s*\n\s*/g, " / ")}`);
      }
      return lines;
    };
    if (one) {
      out.push(`Abo – Stand ${fmtKey(today)}`, "", ...withCat(one));
      return out.join("\n");
    }
    const sum = AB.subsSummary(subs, today);
    out.push(`Abos – Stand ${fmtKey(today)}`, `${sum.active.length} aktiv · zusammen ${eur(sum.perMonth)} pro Monat (${eur(sum.perYear)} pro Jahr)`);
    if (sum.deadlines.length) out.push("", "Kündigungsfristen bald:", ...sum.deadlines.map((x) => `- ${x.sub.name}: spätestens bis ${fmtKeyWd(x.date)} kündigen (Vertrag bis ${fmtKey(x.end)})`));
    if (sum.trials.length) out.push("", "Testzeiträume:", ...sum.trials.map((x) => `- ${x.sub.name}: endet ${fmtKeyWd(x.date)} – ${x.days === 0 ? "heute" : x.days === 1 ? "morgen" : `in ${x.days} Tagen`}`));
    const rank = (x) => { const k = AB.subStatus(x, today).kind; return k === "ended" ? 2 : k === "paused" || k === "cancelled" ? 1 : 0; };
    const shown = subs.filter((x) => args.alle || AB.subStatus(x, today).kind !== "ended").sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), "de"));
    for (const x of shown) out.push("", ...withCat(x));
    const hidden = subs.length - shown.length;
    if (hidden) out.push("", `(${hidden} beendete${hidden === 1 ? "s Abo" : " Abos"} ausgeblendet – mit alle: true anzeigen)`);
    return out.join("\n");
  },
});

tool({
  name: "abo_bearbeiten",
  title: "Abo-Details ändern",
  description: "Ändert einzelne Felder eines vorhandenen Abos (Alltag → Geld → Abos) – z. B. Kündigungslink, Anleitung „So kündigst du“, Vertragsart, Mindestlaufzeit, Kündigungsfrist, Testzeitraum-Ende, Login oder „gekündigt am“. Löscht nie ein Abo. Felder leer lassen bzw. null = Wert entfernen. Passwörter werden nicht gespeichert (dafür gibt es den Passwort-Tresor).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name des Abos, z. B. \"Netflix\" (unscharf)" },
      felder: {
        type: "object",
        description: "Zu ändernde Felder (deutsche Namen wie kuendigungslink, so_kuendigen, gekuendigt_am gehen auch)",
        properties: {
          name: { type: "string", description: "Neuer Name" },
          what: { type: "string", description: "Was ist es, z. B. \"Musik-Streaming Premium Individual\"" },
          amount: { type: ["number", "string"], description: "Betrag in Euro pro Intervall" },
          interval: { type: "string", description: "monatlich | jährlich | vierteljährlich | wöchentlich" },
          next: { type: "string", description: "Nächste Abbuchung (TT.MM.JJJJ)" },
          startDate: { type: "string", description: "Seit wann (TT.MM.JJJJ)" },
          contractType: { type: "string", enum: AB.CONTRACT_TYPES, description: "Vertragsart" },
          minTermEnd: { type: ["string", "null"], description: "Ende der Mindestlaufzeit (TT.MM.JJJJ)" },
          contractEnd: { type: ["string", "null"], description: "Vertragsende / Prepaid bezahlt bis (TT.MM.JJJJ)" },
          noticeText: { type: "string", description: "Kündigungsfrist als Text, z. B. \"1 Monat zum Monatsende\"" },
          noticeDays: { type: ["number", "null"], description: "Kündigungsfrist in Tagen (hat Vorrang vor dem Text)" },
          autoRenew: { type: ["boolean", "string"], description: "Verlängert sich automatisch (ja/nein)" },
          trialEnd: { type: ["string", "null"], description: "Testzeitraum endet am (TT.MM.JJJJ)" },
          cancelUrl: { type: "string", description: "Offizieller Kündigungslink (https://…)" },
          manageUrl: { type: "string", description: "Link zur Abo-Verwaltung (https://…)" },
          cancelHow: { type: "string", description: "Schritt-für-Schritt-Anleitung zum Kündigen" },
          cancelledOn: { type: ["string", "null"], description: "Gekündigt am (TT.MM.JJJJ); ohne ended wird das Ende aus Frist/Vertrag berechnet" },
          ended: { type: ["string", "null"], description: "Läuft aus am = letzter Tag (danach keine automatische Buchung)" },
          account: { type: "string", description: "Login/E-Mail für das Abo (kein Passwort!)" },
          remind: { type: ["boolean", "string"], description: "Erinnerung im Planer vor Kündigungsfrist/Testende" },
          paused: { type: ["boolean", "string"], description: "Pausiert (wird nicht gebucht)" },
          category: { type: "string", description: "Kategorie, z. B. \"Abos\", \"Handy & Internet\"" },
        },
        additionalProperties: true,
      },
    },
    required: ["name", "felder"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    need(args.name, "Welches Abo? Bitte name angeben (z. B. \"Netflix\").");
    const f = args.felder && typeof args.felder === "object" && !Array.isArray(args.felder) ? args.felder : null;
    if (!f || !Object.keys(f).length) throw new UserError("Bitte in felder angeben, was geändert werden soll (z. B. {\"cancelUrl\": \"https://…\"}).");
    const { sub } = await findSub(d, args.name);
    const ch = {};
    for (const [k0, v] of Object.entries(f)) {
      const k = AB.EDIT_FIELDS.includes(k0) ? k0 : AB_ALIASES[String(k0).toLowerCase()];
      if (/pass|kennwort|pin\b|pwd/i.test(k0)) throw new UserError("Passwörter speichere ich hier nicht – dafür gibt es den Passwort-Tresor in der App (Alltag → Passwort-Tresor).");
      if (!k) throw new UserError(`Feld „${k0}“ gibt es nicht. Erlaubt: ${AB.EDIT_FIELDS.join(", ")}.`);
      const empty = v == null || s(v) === "";
      if (AB_DATES.has(k)) {
        if (empty) { if (k === "next") throw new UserError("Die nächste Abbuchung kann nicht leer sein."); ch[k] = null; }
        else ch[k] = dateArg(v, today, k);
        if (k === "next" && ch.next) ch.day = ch.next.slice(8, 10) * 1;
      } else if (AB_BOOLS.has(k)) {
        ch[k] = empty ? (k === "autoRenew" ? null : false) : boolArg(v, k);
      } else if (AB_URLS.has(k)) {
        if (!empty && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(s(v))) throw new UserError(`${k}: bitte einen vollständigen Link mit https:// angeben.`);
        ch[k] = empty ? "" : s(v);
      } else if (k === "amount") {
        const a = parseAmount(v);
        if (!(a > 0) || a > 100000) throw new UserError("Bitte einen positiven Betrag angeben (z. B. 9,99).");
        ch.amount = round2(a);
      } else if (k === "interval") {
        const iv = IV_ALIASES[s(v).toLowerCase()];
        if (!iv) throw new UserError("Intervall: monatlich, jährlich, vierteljährlich oder wöchentlich.");
        ch.interval = iv;
      } else if (k === "contractType") {
        const m = best(v, AB.CONTRACT_TYPES, (x) => x, 50);
        if (!m) throw new UserError(`Vertragsart: ${AB.CONTRACT_TYPES.join(", ")}.`);
        ch.contractType = m.item;
      } else if (k === "noticeDays") {
        if (empty) ch.noticeDays = null;
        else { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 400) throw new UserError("noticeDays: Anzahl Tage zwischen 0 und 400."); ch.noticeDays = Math.round(n); }
      } else if (k === "category") {
        const cats = [...(await moneyCats(d)).values()].filter((c) => c.type !== "in");
        const m = cats.find((c) => c.id === s(v).toLowerCase()) ? { item: cats.find((c) => c.id === s(v).toLowerCase()) } : best(v, cats, (c) => c.name, 55);
        if (!m) throw new UserError(`Kategorie „${s(v)}“ gibt es nicht.`);
        ch.category = m.item.id;
      } else {
        const t = empty ? "" : String(v).trim();
        if (k === "name" && !t) throw new UserError("Der Name darf nicht leer sein.");
        if (t.length > (AB_TEXT[k] || 200)) throw new UserError(`${k} ist zu lang (höchstens ${AB_TEXT[k] || 200} Zeichen).`);
        if (k === "account" && /passw|kennwort|pw\s*[:=]/i.test(t)) throw new UserError("Bitte nur den Login (z. B. E-Mail) eintragen – Passwörter gehören in den Passwort-Tresor.");
        ch[k] = t;
        if (k === "noticeText" && !("noticeDays" in f)) ch.noticeDays = null; // Text gilt
      }
    }
    // „gekündigt am“ ohne Ende → Ende aus Vertrag/Frist berechnen, Buchungen laufen bis dahin weiter
    if (ch.cancelledOn && !("ended" in ch)) {
      ch.ended = AB.cancelEndDate({ ...sub, ...ch }, ch.cancelledOn);
      if (sub.paused && !("paused" in ch)) ch.paused = false;
    }
    if ("cancelledOn" in ch && ch.cancelledOn === null && !("ended" in ch)) ch.ended = null;
    if (ch.ended && ch.cancelledOn && ch.ended < ch.cancelledOn) throw new UserError("Das Ende liegt vor dem Kündigungsdatum.");
    const keys = Object.keys(ch).filter((k) => k !== "day");
    const data = { ...ch, updated: d.now };
    await d.commit([d.fs.patchWrite(d.p(`a_money_subs/${sub.id}`), data, { exists: true })]);
    const merged = { ...sub, ...ch };
    const show = (k) => {
      const v = ch[k];
      if (v == null || v === "") return `${k} entfernt`;
      if (AB_DATES.has(k)) return `${k} → ${fmtKey(v)}`;
      if (AB_BOOLS.has(k)) return `${k} → ${v ? "ja" : "nein"}`;
      if (k === "amount") return `Betrag → ${eur(v)}`;
      if (k === "interval") return `Intervall → ${INTERVALS[v]}`;
      if (k === "cancelHow") return "Anleitung „So kündigst du“ aktualisiert";
      return `${k} → ${String(v).slice(0, 80)}`;
    };
    return `Abo „${merged.name}“ geändert: ${keys.map(show).join("; ")}.\nJetzt: ${AB.subStatus(merged, today).line}`;
  },
});

/* ===== Schule ===== */

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
export async function resolveSubject(d, q) {
  const v = s(q);
  if (!v) return "";
  const subs = await schoolSubjects(d);
  const m = best(v, subs, (x) => x, 70);
  return m ? m.item : v;
}

tool({
  name: "schule_lesen",
  title: "Schule & Lernen",
  description: "Schul-Bereich der App (Alltag → Schule & Lernen). bereich uebersicht (Standard): kommende Prüfungen mit Countdown und Lernfortschritt, offene Hausaufgaben, Notenschnitt je Fach (Noten 1–5, gewichtet), offene Projekte, nächste Berufsschultage. Weitere Bereiche: stundenplan (Stunden je Wochentag mit Raum/Lehrer/A-B-Woche und ID), noten (alle Noten mit Datum/Art/Gewicht und ID), projekte (Schritte ☐/☑ mit Schritt-ID), dokumente (nur Titel/Fach/Größe), lernplan (geplante Lerneinheiten und Lernzeit der letzten 14 Tage).",
  inputSchema: {
    type: "object",
    properties: { bereich: { type: "string", enum: ["uebersicht", "stundenplan", "noten", "projekte", "dokumente", "lernplan"], description: "Standard uebersicht" } },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    if (s(args.bereich) && s(args.bereich) !== "uebersicht") return schoolSection(d, s(args.bereich), args);
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
    const pj = (await d.alltag("school_projects").catch(() => [])).filter((p) => (p.steps || []).some((x) => x && !x.done) || !(p.steps || []).length);
    if (pj.length) out.push("", `Offene Projekte: ${pj.map((p) => `„${s(p.title)}“ (${(p.steps || []).filter((x) => x && x.done).length}/${(p.steps || []).length})`).join(", ")} – Details: bereich projekte`);
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

/* ===== Material (Alltag › Material) ===== */

// Schlüssel ohne Leerzeichen (norm → „auf der Baustelle“ = „aufderbaustelle“).
const MAT_STATUS = {
  brauche: "brauche", brauch: "brauche", kaufen: "brauche", besorgen: "brauche", offen: "brauche", fehlt: "brauche",
  besorgt: "besorgt", gekauft: "besorgt", geholt: "besorgt",
  baustelle: "baustelle", vorort: "baustelle", aufderbaustelle: "baustelle", aufbaustelle: "baustelle", geliefert: "baustelle", liegtbereit: "baustelle", bereit: "baustelle", liegtvorort: "baustelle",
  verbaut: "verbaut", eingebaut: "verbaut", montiert: "verbaut",
};
const MAT_STATUS_HELP = "„brauche“, „besorgt“, „baustelle“ (vor Ort/geliefert) oder „verbaut“";
export function matStatus(v, fallback) {
  const k = norm(v).replace(/ /g, "");
  if (!k) return fallback;
  if (MAT_STATUS[k]) return MAT_STATUS[k];
  throw new UserError(`Status „${s(v)}“ gibt es nicht – bitte ${MAT_STATUS_HELP}.`);
}
const MAT_DONE = { brauche: "Auf die Einkaufsliste gesetzt", besorgt: "Als besorgt eingetragen", baustelle: "Als „auf der Baustelle“ eingetragen (vor Ort, noch nicht verbaut)", verbaut: "Als verbaut eingetragen" };
function matUnit(v) {
  const t = s(v).toLowerCase().replace(/\.$/, "");
  if (!t) return null;
  const map = { stk: "Stk", stück: "Stk", stueck: "Stk", st: "Stk", m: "m", meter: "m", pkg: "Pkg", packung: "Pkg", pack: "Pkg", pck: "Pkg", rolle: "Rolle", rollen: "Rolle", kg: "kg", l: "l", liter: "l", satz: "Satz", set: "Satz" };
  if (map[t]) return map[t];
  throw new UserError(`Einheit „${s(v)}“ kenne ich nicht – möglich: ${MAT.UNITS.join(", ")}.`);
}

tool({
  name: "material_anlegen",
  title: "Material eintragen",
  description: "Trägt Material im Bereich „Material“ ein – auf die Einkaufsliste (status \"brauche\", Standard), als besorgt (\"besorgt\"), als schon auf der Baustelle (\"baustelle\": geliefert bzw. liegt vor Ort, noch nicht eingebaut; auch \"vor ort\", \"geliefert\", \"liegt bereit\") oder als heute verbaut (\"verbaut\"). Der Name wird mit dem Elektriker-Katalog abgeglichen (z. B. \"3x1,5\" → NYM-J 3×1,5, \"Schuko\" → Schuko-Steckdose), die Einheit kommt dann aus dem Katalog. Ohne Ort: eingestempelt → aktueller Arbeitsort.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Material, z. B. \"NYM 3x1,5\", \"Wago 221-413\", \"Schuko-Steckdose\"" },
      menge: { type: ["number", "string"], description: "Menge, Standard 1" },
      einheit: { type: "string", description: "Stk, m, Pkg, Rolle, kg, l, Satz (Standard aus dem Katalog)" },
      status: { type: "string", description: "brauche (Standard, Einkaufsliste) · besorgt · baustelle (auf der Baustelle/vor Ort/geliefert, noch nicht verbaut) · verbaut" },
      ort: { type: "string", description: "Baustelle/Ort, z. B. \"Huber\" (gespeicherte Orte werden unscharf gefunden)" },
      notiz: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const raw = need(args.name, "Bitte angeben, welches Material.");
    const qty = args.menge == null || s(args.menge) === "" ? 1 : MAT.cleanQty(args.menge);
    if (!qty) throw new UserError("Bitte eine Menge größer 0 angeben.");
    if (qty > 100000) throw new UserError("Die Menge ist unrealistisch hoch.");
    const status = matStatus(args.status, "brauche");
    const [places, st, userCat] = await Promise.all([d.places(), d.state(), d.alltag("material_catalog").catch(() => [])]);
    const cat = MAT.mergeCatalog(userCat);
    const m = MAT.bestCatalogMatch(raw, cat, 70);
    const name = m ? m.item.name : raw;
    const unit = matUnit(args.einheit) || (m ? m.item.unit : "Stk");
    let where;
    if (s(args.ort)) where = resolvePlace(args.ort, places);
    else if (st.running) {
      const sg = lastSeg(st.running) || {};
      const pid = sg.placeId || st.running.placeId || null;
      const p = pid ? places.find((x) => x.id === pid) : null;
      where = { placeId: p ? p.id : null, place: (p && p.name) || placeName(sg) || placeName(st.running), info: " (aktueller Arbeitsort)" };
    } else where = { placeId: null, place: "", info: "" };
    const id = alltagId(d.now);
    const doc = MAT.normItem({ id, name, qty, unit, status, placeId: where.placeId, place: where.place, dayKey: today, entryId: null, note: s(args.notiz), photoId: null, catalogId: m ? m.item.id : null, doneAt: status === "verbaut" ? d.now : null }, d.now);
    const data = { ...doc, created: d.now, updated: d.now, src: SRC };
    const writes = [d.fs.setWrite(d.p(`a_material_items/${id}`), data)];
    if (m) {
      const cur = userCat.find((x) => x.id === m.item.docId) || {};
      writes.push(d.fs.setWrite(d.p(`a_material_catalog/${m.item.docId}`), { ...cur, id: m.item.docId, own: !!m.item.own, ...(m.item.own ? { name: m.item.name, unit: m.item.unit, group: MAT.OWN_GROUP } : {}), fav: !!cur.fav, count: (Number(cur.count) || 0) + 1, lastUsed: d.now, created: cur.created || d.now, updated: d.now }));
    }
    await d.commit(writes);
    const hint = m && MAT.norm(m.item.name) !== MAT.norm(raw) ? ` (Katalog: „${m.item.name}“ zu „${raw}“)` : m ? "" : " (nicht im Katalog – als eigener Name übernommen)";
    return `${MAT_DONE[status]}: ${MAT.lineText(doc)}${hint}${doc.place ? ` · Baustelle: ${doc.place}${where.info}` : " · ohne Baustelle"} · ${fmtKey(today)}.`;
  },
});

tool({
  name: "material_lesen",
  title: "Material lesen",
  description: "Zeigt Material aus dem Bereich „Material“: Einkaufsliste (brauche/besorgt), was schon auf der Baustelle liegt (baustelle, noch nicht verbaut) und verbautes Material, gruppiert nach Baustelle mit Summen pro Material. Filter: status (brauche, besorgt, baustelle bzw. \"vor ort\", verbaut, offen = brauche+besorgt+baustelle, alle), ort, Zeitraum von/bis (für verbaut).",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "brauche, besorgt, baustelle (vor Ort), verbaut, offen (= brauche+besorgt+baustelle) oder alle. Standard: offen + verbaut der letzten 30 Tage" },
      ort: { type: "string" },
      von: { type: "string", description: "Datum TT.MM.JJJJ / heute / gestern" },
      bis: { type: "string" },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const today = dayKey(d.now);
    const [all, places] = await Promise.all([d.alltag("material_items"), d.places()]);
    const items = all.filter((x) => x && s(x.name));
    const raw = norm(args.status).replace(/ /g, "");
    const stv = raw === "offen" || raw === "alle" ? raw : matStatus(args.status, "");
    const from = dateArg(args.von, today, "von"), to = dateArg(args.bis, today, "bis");
    if (from && to && from > to) throw new UserError("„von“ liegt nach „bis“.");
    let list = items;
    if (s(args.ort)) {
      const m = matchPlace(args.ort, places);
      if (m) list = list.filter((x) => x.placeId === m.item.id || (!x.placeId && norm(x.place) === norm(m.item.name)));
      else list = list.filter((x) => score(args.ort, MAT.placeLabel(x, places)) >= 60);
    }
    const inRange = (x) => (!from || x.dayKey >= from) && (!to || x.dayKey <= to);
    const lo = from || (stv === "verbaut" || stv === "alle" ? null : addDays(today, -30));
    const verbaut = list.filter((x) => x.status === "verbaut" && (from || to ? inRange(x) : (!lo || x.dayKey >= lo)));
    const brauche = list.filter((x) => x.status === "brauche");
    const besorgt = list.filter((x) => x.status === "besorgt");
    const vorOrt = list.filter((x) => x.status === "baustelle");
    const want = (k) => !stv || stv === "alle" || stv === k || (stv === "offen" && MAT.OPEN_STATUSES.includes(k));
    const out = [];
    const section = (title, arr) => {
      if (!arr.length) return;
      out.push(`${title}:`);
      for (const g of MAT.byPlace(arr, places)) out.push(`- ${g.place}: ${MAT.totals(g.items).map(MAT.lineText).join(", ")}`);
    };
    if (want("brauche")) section(`Noch zu besorgen (${brauche.length})`, brauche);
    if (want("besorgt")) section(`Besorgt, noch nicht auf der Baustelle (${besorgt.length})`, besorgt);
    if (want("baustelle")) section(`Auf der Baustelle, noch nicht verbaut (${vorOrt.length})`, vorOrt);
    if (want("verbaut")) {
      const range = from || to ? `${from ? fmtKey(from) : "Anfang"} – ${to ? fmtKey(to) : "heute"}` : lo ? `seit ${fmtKey(lo)}` : "gesamt";
      if (verbaut.length) {
        out.push(`Verbaut (${range}):`);
        const days = [...new Set(verbaut.map((x) => x.dayKey))].sort().reverse().slice(0, 31);
        for (const k of days) for (const g of MAT.byPlace(verbaut.filter((x) => x.dayKey === k), places)) out.push(`- ${fmtKeyWd(k)} · ${g.place}: ${MAT.totals(g.items).map(MAT.lineText).join(", ")}`);
        out.push(`Summe verbaut: ${MAT.totals(verbaut).map(MAT.lineText).join(", ")}`);
      } else if (stv === "verbaut") out.push(`Verbaut (${range}): nichts eingetragen.`);
    }
    if (!out.length) return items.length ? "Für diese Auswahl gibt es kein Material." : "Im Bereich „Material“ ist noch nichts eingetragen.";
    return out.join("\n");
  },
});

/* ===== Update 9: weitere Lese-/Schreib-Werkzeuge, Einstellungen (zweistufig) ===== */
for (const t of [...READ_TOOLS, ...WRITE_TOOLS, ...SETTINGS_TOOLS]) tool(t);

/* ===== Gmail (nur lesen, nur auf Nachfrage) ===== */
for (const t of GMAIL_TOOLS) tool(t);

/* ===== Sicheres Löschen (Vorschlag → Bestätigung → Papierkorb) ===== */
for (const t of DELETE_TOOLS) tool(t);

export function toolList() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
}

export function findTool(name) { return TOOLS.find((t) => t.name === name) || null; }

export { UserError, score, WD, parseKey, wdOf, shiftMonth };
