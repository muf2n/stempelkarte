// Update 9 – „Claude darf (fast) alles ändern, wenn erlaubt“: zusätzliche Schreib-Werkzeuge.
// Jede Änderung schreibt in denselben Formen wie die Web-App und antwortet mit einer kurzen deutschen Bestätigung.
// Nie: Fotos/Dokumente löschen (nur über loeschen_vorschlagen), Tresor, Bank-Verbindung, Nachrichten senden.
import {
  dayKey, keyToTs, addDays, fmtKey, fmtKeyWd, clock, hm, eur, isKey, fmtTime, weekKey, isoWeek, diffDays, WD,
} from "./time.js";
import { UserError, clean, newId, alltagId, normTodo, netMin, creditMin, kindLabel, cleanPeople } from "./logic.js";
import { SRC, WR, s, need, dateArg, timeArg, boolArg, numArg, resolvePlace, pick, short, pad2, placeName, idArg } from "./util.js";
import { best, score, norm } from "./match.js";
import { expandTodo, parseRRule, describeRule, applyEdit, finalizeEvent, normCalendars, toMin, hhmm } from "./cal.js";
import { repeatRule, weekStart, bdayArg, moneyCats, catName, matStatus, resolveSubject } from "./tools.js";
import * as TR from "./trip.js";
import * as UW from "./unterwegs.js";
import * as MAT from "./material.js";
import * as G from "./gallery.js";
import * as MC from "./moneycore.js";
import { photoIndex, monthTrips } from "./read.js";
import { parseAmount, round2 } from "./money.js";

const noId = (o) => { const { id: _i, ...r } = o; return r; };

/* ===================== Planer bearbeiten ===================== */

const SCOPE = { alle: "all", nur_diese: "one", ab_diesem: "following" };
const KIND = { termin: "termin", aufgabe: "todo", geburtstag: "geburtstag" };

function remindersArg(args) {
  if (Array.isArray(args.erinnerungen)) {
    const list = args.erinnerungen.map((x) => Math.round(Number(x)));
    if (list.some((x) => !Number.isFinite(x) || x < 0 || x > 40320)) throw new UserError("erinnerungen: Minuten vorher, 0 bis 40320.");
    return list;
  }
  if (args.erinnern === false) return [];
  if (args.erinnern === true || args.erinnern_min != null) {
    const m = args.erinnern_min == null ? 30 : Math.round(Number(args.erinnern_min));
    if (!(m >= 0 && m <= 40320)) throw new UserError("erinnern_min: Minuten vorher, 0 bis 40320.");
    return [m];
  }
  return undefined;
}

function evText(n) {
  const bits = [n.date ? fmtKeyWd(n.date) : "ohne Datum"];
  if (n.allDay) bits.push("ganztägig");
  else if (n.time) bits.push(`${n.time}${n.endTime ? "–" + n.endTime : ""}`);
  if (isKey(n.endDate) && n.endDate > n.date) bits.push(`bis ${fmtKeyWd(n.endDate)}`);
  if (s(n.location)) bits.push(s(n.location));
  if (n.rrule) bits.push(describeRule(n.rrule, n.date));
  const rem = Array.isArray(n.reminders) ? n.reminders : n.remind ? [n.remindMin] : [];
  if (rem.length) bits.push(`Erinnerung ${rem.join(", ")} min vorher`);
  if (n.countdown) bits.push("Countdown");
  return bits.join(" · ");
}

const TOOL_PLANER_BEARBEITEN = {
  name: "planer_bearbeiten",
  title: "Termin/Aufgabe ändern",
  description: "Ändert einen vorhandenen Termin, eine Aufgabe oder einen Geburtstag im Planer: verschieben (datum/uhrzeit/bis), Titel, Ort, Notiz, ganztägig, Wiederholung (\"keine\" entfernt sie), Erinnerungen, Kalender, Countdown. Angabe über id (aus planer_lesen/todos_lesen) oder titel (unscharf). Bei Serienterminen und Zeit-Änderungen VORHER den Nutzer fragen: nur diesen Termin (umfang nur_diese + instanz_datum), ab diesem (ab_diesem + instanz_datum) oder die ganze Serie (alle). Löscht nie etwas.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "ID des Eintrags" },
      titel: { type: "string", description: "Titel bzw. Teil davon (wenn keine id)" },
      art: { type: "string", enum: ["termin", "aufgabe", "geburtstag"], description: "Nur suchen unter …" },
      umfang: { type: "string", enum: ["alle", "nur_diese", "ab_diesem"], description: "Nur bei Serienterminen" },
      instanz_datum: { type: "string", description: "Bei Serien: ursprüngliches Datum der Wiederholung, die geändert wird" },
      neuer_titel: { type: "string" },
      datum: { type: "string", description: "Neues Datum (Termin/Aufgabe) bzw. Geburtsdatum TT.MM.(JJJJ)" },
      uhrzeit: { type: "string", description: "Neue Uhrzeit HH:MM (Dauer bleibt gleich)" },
      bis: { type: "string", description: "Neue Endzeit HH:MM" },
      ende_datum: { type: "string", description: "Letzter Tag bei mehrtägigen Terminen" },
      ganztags: { type: "boolean" },
      ort: { type: "string" },
      notiz: { type: "string", description: "Neue Notiz (ersetzt die alte)" },
      wiederholung: { type: "string", description: "keine, täglich, werktags, wöchentlich, alle 2 wochen, monatlich, jährlich oder RRULE" },
      wiederholen_bis: { type: "string" },
      anzahl: { type: "number" },
      erinnerungen: { type: "array", items: { type: "number" }, description: "Minuten vorher, z. B. [10, 1440]; [] = keine" },
      erinnern: { type: "boolean", description: "Erinnerung an/aus" },
      erinnern_min: { type: "number" },
      kalender: { type: "string", description: "Kalender, z. B. Privat, Arbeit" },
      countdown: { type: "boolean", description: "Countdown oben im Planer an/aus" },
    },
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const all = (await d.todos()).filter((t) => t.kind !== "einsatz");
    const pool = s(args.art) ? all.filter((t) => t.kind === KIND[s(args.art)]) : all;
    const t = pick(pool, { id: args.id, name: args.titel }, (x) => x.title, "Planer-Eintrag");
    const writes = [];
    if (t.kind === "geburtstag" || t.kind === "todo") {
      const n = { ...t };
      if (s(args.neuer_titel)) n.title = s(args.neuer_titel).slice(0, 140);
      if (args.notiz != null) n.note = s(args.notiz);
      if (t.kind === "geburtstag") {
        if (s(args.datum)) Object.assign(n, bdayArg(args.datum));
        if (s(args.uhrzeit)) n.time = fmtTime(timeArg(args.uhrzeit, "Uhrzeit"));
        if (args.erinnern != null) n.remind = !!args.erinnern;
      } else {
        if (s(args.datum)) n.date = dateArg(args.datum, today);
        if (s(args.uhrzeit)) n.time = fmtTime(timeArg(args.uhrzeit, "Uhrzeit"));
        const rem = remindersArg(args);
        if (rem !== undefined) { n.remind = rem.length > 0; if (rem.length) n.remindMin = rem[0]; }
        if (!(n.date && n.time)) n.remind = false;
        if (args.countdown != null) { if (args.countdown && !n.date) throw new UserError("Ein Countdown braucht ein Datum."); n.countdown = !!args.countdown; }
      }
      writes.push(d.fs.setWrite(d.p(`todos/${t.id}`), clean(noId(n)), { exists: true }));
      await d.commit(writes);
      d.invalidate("todos");
      if (t.kind === "geburtstag") return `Geburtstag geändert: ${n.title} am ${n.bday ? `${n.bday.slice(3)}.${n.bday.slice(0, 2)}.` : "?"}${n.byear ? n.byear : ""}${n.remind ? `, Erinnerung um ${n.time || "09:00"}` : ""}.`;
      return `Aufgabe geändert: „${n.title}“ – ${n.date ? `fällig ${fmtKeyWd(n.date)}${n.time ? " " + n.time : ""}` : "ohne Datum"}${n.remind ? `, Erinnerung ${n.remindMin} min vorher` : ""}${n.countdown ? ", Countdown" : ""}.`;
    }
    // Termin
    const series = !!parseRRule(t.rrule);
    let scope = series ? SCOPE[s(args.umfang)] || null : null;
    const timing = ["datum", "uhrzeit", "bis", "ende_datum"].some((k) => s(args[k])) || args.ganztags != null;
    if (series && !scope && (timing || s(args.instanz_datum))) {
      throw new UserError(`„${t.title}“ ist ein Serientermin (${describeRule(t.rrule, t.date)}). Bitte zuerst den Nutzer fragen: nur diesen einen Termin, ab diesem oder die ganze Serie? Dann umfang = nur_diese | ab_diesem | alle (bei nur_diese/ab_diesem mit instanz_datum).`);
    }
    if (series && !scope) scope = "all";
    let instKey = null;
    if (series && s(args.instanz_datum)) {
      instKey = dateArg(args.instanz_datum, today, "instanz_datum");
      if (!expandTodo(t, instKey, instKey).some((i) => i.key === instKey)) throw new UserError(`Am ${fmtKey(instKey)} gibt es keine Wiederholung von „${t.title}“.`);
    } else if (series && scope !== "all") throw new UserError("Für nur_diese/ab_diesem bitte instanz_datum (Datum der betroffenen Wiederholung) angeben.");
    const inst = instKey ? expandTodo(t, instKey, instKey).find((i) => i.key === instKey) : null;
    const cur = inst
      ? { date: inst.date, time: inst.time, endDate: inst.endDate, endTime: inst.endTime === "24:00" ? "23:59" : inst.endTime, allDay: inst.allDay }
      : { date: t.date, time: t.time, endDate: isKey(t.endDate) ? t.endDate : t.date, endTime: t.endTime || null, allDay: !!t.allDay || !t.time };
    const ch = {};
    const said = [];
    if (s(args.neuer_titel)) { ch.title = s(args.neuer_titel).slice(0, 140); said.push(`Titel → „${ch.title}“`); }
    if (args.notiz != null) { ch.note = s(args.notiz); said.push("Notiz geändert"); }
    if (args.ort != null) { ch.location = s(args.ort).slice(0, 200); said.push(ch.location ? `Ort → ${ch.location}` : "Ort entfernt"); }
    if (timing) {
      let { date, time, endDate, endTime, allDay } = cur;
      const span = diffDays(date, endDate || date);
      if (args.ganztags === true) { allDay = true; time = null; endTime = null; }
      if (s(args.datum)) { date = dateArg(args.datum, today); endDate = addDays(date, span); }
      if (s(args.uhrzeit)) {
        const nt = fmtTime(timeArg(args.uhrzeit, "Uhrzeit"));
        const dur = time && endTime && span === 0 ? toMin(endTime) - toMin(time) : 60;
        time = nt; allDay = false;
        const e = toMin(nt) + (dur > 0 ? dur : 60);
        endTime = hhmm(Math.min(e, 1439));
      }
      if (args.ganztags === false && !time) throw new UserError("Ohne ganztägig braucht der Termin eine uhrzeit.");
      if (args.ganztags === false) allDay = false;
      if (s(args.ende_datum)) { endDate = dateArg(args.ende_datum, today, "ende_datum"); if (endDate < date) throw new UserError("ende_datum liegt vor dem Datum."); }
      if (s(args.bis)) {
        if (!time) throw new UserError("„bis“ (Endzeit) geht nur mit Uhrzeit.");
        endTime = fmtTime(timeArg(args.bis, "bis"));
        if ((endDate || date) <= date && endTime <= time) throw new UserError("Die Endzeit liegt vor der Uhrzeit.");
      }
      Object.assign(ch, { date, time: allDay ? null : time, endDate: endDate && endDate > date ? endDate : date, endTime: allDay ? null : endTime, allDay });
      said.push(`Zeit → ${evText({ ...ch, rrule: null, reminders: [] })}`);
    }
    const rem = remindersArg(args);
    const seriesOnly = [];
    if (rem !== undefined) { ch.reminders = rem; said.push(rem.length ? `Erinnerungen → ${rem.join(", ")} min vorher` : "Erinnerungen aus"); seriesOnly.push("Erinnerungen"); }
    if (args.countdown != null) { ch.countdown = !!args.countdown; said.push(`Countdown ${ch.countdown ? "an" : "aus"}`); seriesOnly.push("Countdown"); }
    if (s(args.kalender)) {
      const cals = normCalendars((await d.settings()).calendars).filter((c) => c.kind === "user");
      const m = best(args.kalender, cals, (c) => c.name);
      const c = cals.find((x) => x.id === s(args.kalender)) || (m && !m.ambiguous ? m.item : null);
      if (!c) throw new UserError(`Kalender „${s(args.kalender)}“ nicht gefunden. Vorhanden: ${cals.map((x) => x.name).join(", ")}.`);
      ch.calendarId = c.id; said.push(`Kalender → ${c.name}`); seriesOnly.push("Kalender");
    }
    if (s(args.wiederholung)) {
      const rr = repeatRule(args, ch.date || t.date, today);
      ch.rrule = rr; said.push(rr ? `Wiederholung → ${describeRule(rr, ch.date || t.date)}` : "Wiederholung entfernt"); seriesOnly.push("Wiederholung");
    }
    if (!said.length) throw new UserError("Was soll geändert werden? (z. B. datum, uhrzeit, neuer_titel, ort, erinnerungen …)");
    if (scope === "one" && seriesOnly.length) throw new UserError(`${seriesOnly.join(", ")} gelten für die ganze Serie – dafür umfang „alle“ verwenden.`);
    let res;
    if (series) res = applyEdit({ ...t }, instKey || t.date, ch, scope);
    else res = { save: [{ ...t, ...ch }], create: [], remove: [] };
    const fin = (n) => { const f = finalizeEvent(n); if (f.endDate == null) delete f.endDate; if (!f.allDay && !(f.date && f.time)) { f.remind = false; f.reminders = []; } return f; };
    const saved = [];
    for (const n of res.save) { const f = fin(n); writes.push(d.fs.setWrite(d.p(`todos/${n.id || t.id}`), clean(noId(f)))); saved.push(f); }
    for (const n of res.create) {
      const id = newId("t", d.now + saved.length);
      const f = fin(normTodo({ ...n, src: n.src || SRC }, id, d.now));
      writes.push(d.fs.setWrite(d.p(`todos/${id}`), clean(noId(f)))); saved.push(f);
    }
    for (const id of res.remove) writes.push(d.fs.deleteWrite(d.p(`todos/${id}`))); // nur beim Teilen einer Serie (ersetzt durch neuen Teil)
    await d.commit(writes);
    d.invalidate("todos");
    const where = scope === "one" ? ` (nur am ${fmtKey(instKey)})` : scope === "following" ? ` (ab ${fmtKey(instKey)})` : series ? " (ganze Serie)" : "";
    const after = scope === "one" ? (saved[0].overrides || {})[instKey] : saved[saved.length - 1];
    return `Termin „${(after && after.title) || t.title}“ geändert${where}: ${said.join(" · ")}.\nJetzt: ${evText(scope === "one" ? { ...after, rrule: null, reminders: saved[0].reminders } : after)}`;
  },
};

/* ===================== Arbeitszeit-Eintrag bearbeiten ===================== */

const TOOL_EINTRAG_BEARBEITEN = {
  name: "eintrag_bearbeiten",
  title: "Eintrag ändern",
  description: "Ändert einen abgeschlossenen Arbeitszeit-Eintrag (oder Urlaub/Krank/Zeitausgleich): Beginn, Ende, Pause, Ort, Notiz (ersetzen oder anhängen), Personen bzw. bei Abwesenheit die Gutschrift. Angabe über id (aus eintraege_lesen) oder datum, wenn an dem Tag nur ein Eintrag ist. Die LAUFENDE Schicht wird hier nie geändert – dafür einstempeln/ausstempeln/pause/abschnitt_wechseln.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "ID des Eintrags" },
      datum: { type: "string", description: "Tag des Eintrags (wenn keine id)" },
      beginn: { type: "string", description: "Neuer Beginn HH:MM" },
      ende: { type: "string", description: "Neues Ende HH:MM (vor Beginn = nächster Tag)" },
      pause_min: { type: "number", description: "Pause in Minuten" },
      ort: { type: "string", description: "Neuer Arbeitsort (gespeicherte Orte werden unscharf gefunden)" },
      notiz: { type: "string", description: "Notiz/Tätigkeit" },
      notiz_anhaengen: { type: "boolean", description: "true = an die bisherige Notiz anhängen statt ersetzen" },
      personen: { type: "array", items: { type: "string" } },
      gutschrift_h: { type: "number", description: "Nur Urlaub/Krank/Zeitausgleich/Schule: Gutschrift in Stunden" },
    },
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    let id = idArg(args.id, "Eintrags-ID"), data;
    if (id) {
      const doc = await d.fs.get(d.p(`entries/${id}`));
      if (!doc) throw new UserError(`Keinen Eintrag mit der ID ${id} gefunden.`);
      data = doc.data;
    } else {
      const day = dateArg(need(args.datum, "Bitte id oder datum angeben."), today);
      const list = (await d.entriesRange(keyToTs(day), keyToTs(addDays(day, 1)))).filter((e) => Number.isFinite(e.start));
      const st = await d.state();
      if (!list.length) throw new UserError(`Am ${fmtKeyWd(day)} gibt es keinen abgeschlossenen Eintrag.${st.running && dayKey(st.running.start) === day ? " Die laufende Schicht kann ich hier nicht ändern." : ""}`);
      if (list.length > 1) throw new UserError(`Am ${fmtKeyWd(day)} gibt es ${list.length} Einträge – bitte mit id angeben: ${list.map((e) => `${e.kind && e.kind !== "work" ? kindLabel(e.kind) : `${clock(e.start)}–${clock(e.end)}`} (ID ${e.id})`).join(", ")}.`);
      ({ id, ...data } = list[0]);
    }
    const e = { ...data };
    const kind = e.kind || "work";
    const said = [];
    if (kind !== "work") {
      for (const k of ["beginn", "ende", "pause_min", "ort", "personen"]) if (args[k] != null && s(args[k]) !== "") throw new UserError(`Bei ${kindLabel(kind)} gibt es kein Feld „${k}“ – nur Notiz und gutschrift_h.`);
      if (args.gutschrift_h != null) {
        const v = numArg(args.gutschrift_h);
        if (!(v >= 0 && v <= 24)) throw new UserError("gutschrift_h muss zwischen 0 und 24 Stunden liegen.");
        said.push(`Gutschrift ${hm(creditMin(e))} → ${hm(Math.round(v * 60))} h`);
        e.creditMin = Math.round(v * 60);
      }
    } else {
      if (args.gutschrift_h != null) throw new UserError("gutschrift_h gibt es nur bei Urlaub/Krank/Zeitausgleich/Schule.");
      const day = dayKey(e.start);
      let start = e.start, end = e.end;
      if (s(args.beginn)) { const b = timeArg(args.beginn, "Beginn"); start = keyToTs(day, b.h, b.mi); }
      if (s(args.ende)) { const x = timeArg(args.ende, "Ende"); end = keyToTs(day, x.h, x.mi); if (end <= start) end = keyToTs(addDays(day, 1), x.h, x.mi); }
      if (end <= start) throw new UserError(`Das Ende (${clock(end)}) muss nach dem Beginn (${clock(start)}) liegen.`);
      if (end > d.now + 5 * 60000) throw new UserError("Das Ende liegt in der Zukunft.");
      if (start !== e.start) said.push(`Beginn ${clock(e.start)} → ${clock(start)}`);
      if (end !== e.end) said.push(`Ende ${clock(e.end)} → ${clock(end)}`);
      if (start !== e.start || end !== e.end) {
        const segs = Array.isArray(e.segments) ? e.segments.filter((x) => x && Number.isFinite(x.start)).map((x) => ({ ...x })) : [];
        if (segs.length) {
          const withEnd = segs.map((x, i) => ({ ...x, _end: Number.isFinite(x.end) ? x.end : segs[i + 1] ? segs[i + 1].start : e.end }));
          let keep = withEnd.filter((x) => x.start < end && x._end > start);
          if (!keep.length) keep = [withEnd[0]];
          keep[0].start = start;
          const last = keep[keep.length - 1];
          if (Number.isFinite(last.end) || Number.isFinite(segs[segs.length - 1].end)) last.end = end;
          for (const x of keep) { if (Number.isFinite(x.end) && x.end > end) x.end = end; delete x._end; }
          if (keep.length !== segs.length) said.push(`${segs.length - keep.length} Abschnitt(e) außerhalb der neuen Zeit entfernt`);
          e.segments = keep;
        }
        e.start = start; e.end = end;
      }
      if (args.pause_min != null) {
        const p = Math.round(Number(args.pause_min));
        if (!(p >= 0)) throw new UserError("Die Pause muss 0 oder mehr Minuten sein.");
        said.push(`Pause ${Math.round(Number(e.pauseMin) || 0)} → ${p} min`);
        e.pauseMin = p;
      }
      if ((Number(e.pauseMin) || 0) >= Math.round((e.end - e.start) / 60000) && !e.privateTrip) throw new UserError("Die Pause ist so lang wie die ganze Arbeitszeit.");
      if (s(args.ort)) {
        const places = await d.places();
        const pl = resolvePlace(args.ort, places);
        const oldId = e.placeId || null, oldName = s(e.place);
        if (Array.isArray(e.segments)) {
          e.segments = e.segments.map((x) => (x && !TR.isDriving(x) && ((oldId && x.placeId === oldId) || (!x.placeId && s(x.place) === oldName)) ? { ...x, placeId: pl.placeId, place: pl.place } : x));
        }
        e.placeId = pl.placeId; e.place = pl.place;
        said.push(`Ort ${oldName || "–"} → ${pl.place}${pl.info}`);
      }
      if (Array.isArray(args.personen)) { e.people = cleanPeople(args.personen); said.push(`Personen → ${e.people.join(", ") || "keine"}`); }
    }
    if (args.notiz != null) {
      const add = s(args.notiz);
      e.note = args.notiz_anhaengen === true ? [s(e.note), add].filter(Boolean).join(" · ") : add;
      said.push(args.notiz_anhaengen === true ? "Notiz ergänzt" : "Notiz ersetzt");
    }
    if (!said.length) throw new UserError("Was soll geändert werden? (beginn, ende, pause_min, ort, notiz, personen, gutschrift_h)");
    await d.commit([d.fs.setWrite(d.p(`entries/${id}`), clean(e), { exists: true })]);
    d.invalidate("entries:true", "entries:false");
    const now = kind === "work"
      ? `${clock(e.start)}–${clock(e.end)} · Pause ${Math.round(Number(e.pauseMin) || 0)} min · netto ${hm(netMin(e))} h${e.place ? ` · ${e.place}` : ""}`
      : `${kindLabel(kind)} · Gutschrift ${hm(creditMin(e))} h`;
    return `Eintrag am ${fmtKeyWd(dayKey(e.start))} geändert: ${said.join(" · ")}.\nJetzt: ${now}${s(e.note) ? ` · Notiz: ${short(e.note, 100)}` : ""}\n(ID ${id})`;
  },
};

/* ===================== Fahrt bearbeiten ===================== */

const TOOL_FAHRT = {
  name: "fahrt_bearbeiten",
  title: "Fahrt ändern",
  description: "Ändert eine Fahrt im Fahrtenbuch (Abschnitt „Autofahren“): Zweck, beruflich/privat, Fahrzeug, km (manuell; leer = wieder berechnen). Angabe über fahrt (Kennung aus fahrtenbuch_lesen, z. B. \"e1#0\") oder datum + uhrzeit (Abfahrt).",
  inputSchema: {
    type: "object",
    properties: {
      fahrt: { type: "string", description: "Kennung aus fahrtenbuch_lesen, z. B. \"e1#0\"" },
      datum: { type: "string" },
      uhrzeit: { type: "string", description: "Abfahrt HH:MM (mit datum)" },
      zweck: { type: "string", description: "z. B. Baustelle, Material holen, Kunde, Büro, Berufsschule; leer = Vorschlag" },
      privat: { type: "boolean", description: "true = Privatfahrt, false = beruflich" },
      fahrzeug: { type: "string", description: "Name/Kennzeichen des Fahrzeugs oder \"standard\"" },
      km: { type: ["number", "string", "null"], description: "Gefahrene km (manuell); null/leer = wieder automatisch" },
    },
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    let entryId, raw;
    if (s(args.fahrt)) {
      const m = /^([^#\s]+)#(\d+)$/.exec(s(args.fahrt));
      if (!m) throw new UserError("fahrt bitte genau wie in fahrtenbuch_lesen angeben (z. B. \"e1#0\").");
      entryId = idArg(m[1], "Fahrt-Kennung"); raw = Number(m[2]);
    } else {
      const day = dateArg(need(args.datum, "Bitte fahrt oder datum + uhrzeit angeben."), today);
      const t0 = timeArg(need(args.uhrzeit, "Bitte auch die Abfahrtszeit (uhrzeit) angeben."), "uhrzeit");
      const { trips } = await monthTrips(d, day.slice(0, 7));
      const want = keyToTs(day, t0.h, t0.mi);
      const cand = trips.filter((t) => dayKey(t.start) === day).sort((a, b) => Math.abs(a.start - want) - Math.abs(b.start - want));
      if (!cand.length || Math.abs(cand[0].start - want) > 20 * 60000) throw new UserError(`Am ${fmtKeyWd(day)} um ${fmtTime(t0)} finde ich keine Fahrt.${cand.length ? ` Fahrten: ${cand.map((t) => clock(t.start)).join(", ")}.` : ""}`);
      entryId = cand[0].entry.id; raw = cand[0].rawIndex;
    }
    const doc = await d.fs.get(d.p(`entries/${entryId}`));
    if (!doc) throw new UserError("Diese Fahrt gibt es nicht (mehr).");
    const e = doc.data;
    const seg = Array.isArray(e.segments) ? e.segments[raw] : null;
    if (!seg || !TR.isDriving(seg)) throw new UserError("Unter dieser Kennung ist keine Fahrt („Autofahren“).");
    const settings = await d.settings();
    const patch = {}, said = [];
    if (args.zweck != null) { const z = s(args.zweck).slice(0, 60); patch.purpose = z || null; said.push(z ? `Zweck → ${z}` : "Zweck zurückgesetzt"); }
    if (args.privat != null) { patch.private = args.privat === true ? true : null; said.push(args.privat ? "privat" : "beruflich"); }
    if (args.fahrzeug != null) {
      const q = s(args.fahrzeug);
      if (!q || /^standard|^keins?$/i.test(q)) { patch.vehicleId = null; said.push("Fahrzeug → Standard"); }
      else {
        const vs = TR.readVehicles(settings);
        if (!vs.length) throw new UserError("Es sind keine Fahrzeuge angelegt (Fahrtenbuch → Fahrzeuge in der App).");
        const v = vs.find((x) => x.id === q || norm(x.plate) === norm(q)) || pick(vs, { name: q }, (x) => `${x.name} ${x.plate}`, "Fahrzeug", 50);
        patch.vehicleId = v.id; said.push(`Fahrzeug → ${TR.vehicleLabel(v)}`);
      }
    }
    if (args.km !== undefined) {
      const v = numArg(args.km);
      if (v == null) { patch.km = null; said.push("km wieder automatisch"); }
      else { if (!(v >= 0 && v <= 3000)) throw new UserError("km bitte zwischen 0 und 3000."); patch.km = Math.round(v * 10) / 10; said.push(`km → ${TR.fmtKmD(patch.km)}`); }
    }
    if (!said.length) throw new UserError("Was soll geändert werden? (zweck, privat, fahrzeug, km)");
    const segs = TR.patchSegment(e, raw, patch);
    const next = { ...e, segments: segs };
    if (e.tripOnly && "private" in patch && segs.length === 1) {
      const priv = patch.private === true;
      next.privateTrip = priv;
      next.pauseMin = priv ? Math.max(0, Math.round((e.end - e.start) / 60000)) : 0;
    }
    await d.commit([d.fs.setWrite(d.p(`entries/${entryId}`), clean(next), { exists: true })]);
    d.invalidate("entries:true", "entries:false");
    return `Fahrt ${fmtKeyWd(dayKey(seg.start))} ${clock(seg.start)} geändert: ${said.join(" · ")}.`;
  },
};

/* ===================== Unterwegs ===================== */

async function findPackList(d, q) {
  const [lists, trips] = await Promise.all([d.alltag("travel_packing"), d.alltag("travel_trips")]);
  const real = lists.filter((l) => l && l.id && l.kind !== "template");
  if (!real.length) return { list: null, trips };
  if (!s(q)) {
    if (real.length === 1) return { list: real[0], trips };
    throw new UserError(`Welche Packliste? Vorhanden: ${real.map((l) => `„${l.title}“`).join(", ")}.`);
  }
  const name = (l) => { const t = trips.find((x) => x.id === l.tripId); return `${l.title || ""} ${t ? `${t.title || ""} ${t.dest || ""}` : ""}`; };
  return { list: pick(real, { name: q }, name, "Packliste", 50), trips };
}

const TOOL_UNTERWEGS_W = {
  name: "unterwegs_eintragen",
  title: "Unterwegs eintragen",
  description: "Schreibt in den Bereich Unterwegs – aktion: reise_anlegen (titel/ziel, von, bis, budget, optional vorlage für eine Packliste), packliste_hinzufuegen (gegenstaende in liste, optional kategorie), packliste_abhaken (gegenstaende oder alle; erledigt=false hakt wieder ab), parkplatz_merken (adresse und/oder lat/lng, ebene, platz, parkschein_bis HH:MM, notiz), tanken (liter, betrag, km_stand, datum, tankstelle, voll, in_geld_buchen) oder adresse_speichern (name, adresse, telefon, kategorie, notiz, favorit). Löscht nichts.",
  inputSchema: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["reise_anlegen", "packliste_hinzufuegen", "packliste_abhaken", "parkplatz_merken", "tanken", "adresse_speichern"] },
      titel: { type: "string", description: "Reise: Titel" },
      ziel: { type: "string", description: "Reise: Reiseziel" },
      von: { type: "string", description: "Reise: erster Tag" },
      bis: { type: "string", description: "Reise: letzter Tag" },
      budget: { type: ["number", "string"], description: "Reise: Budget in Euro" },
      vorlage: { type: "string", enum: UW.TEMPLATE_KEYS, description: "Reise: Packliste aus dieser Vorlage anlegen" },
      liste: { type: "string", description: "Packliste (Listen- oder Reisename)" },
      gegenstaende: { type: "array", items: { type: "string" }, description: "Packliste: Gegenstände" },
      kategorie: { type: "string", description: "Packliste: Kategorie (z. B. Kleidung, Technik) bzw. Adresse: familie, freunde, arbeit, baustelle, arzt, werkstatt, schule, amt, einkauf, sonstiges" },
      erledigt: { type: "boolean", description: "Packliste abhaken: true = gepackt (Standard), false = wieder offen" },
      alle: { type: "boolean", description: "Packliste abhaken: alle Gegenstände" },
      adresse: { type: "string", description: "Parkplatz/Adresse: Adresse" },
      lat: { type: "number" }, lng: { type: "number" },
      ebene: { type: "string" }, platz: { type: "string" },
      parkschein_bis: { type: "string", description: "HH:MM" },
      datum: { type: "string", description: "Tanken: Datum (Standard heute)" },
      liter: { type: ["number", "string"] }, betrag: { type: ["number", "string"], description: "Tanken: Betrag in Euro" },
      km_stand: { type: ["number", "string"], description: "Tanken: Kilometerstand" },
      tankstelle: { type: "string" }, voll: { type: "boolean", description: "Tanken: voll getankt (Standard ja)" },
      in_geld_buchen: { type: "boolean", description: "Tanken: auch als Ausgabe „Auto & Tanken“ in Geld buchen" },
      name: { type: "string", description: "Adresse: Name, z. B. \"Dr. Huber (Zahnarzt)\"" },
      telefon: { type: "string" }, notiz: { type: "string" }, favorit: { type: "boolean" },
    },
    required: ["aktion"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const a = s(args.aktion);
    if (a === "reise_anlegen") {
      const title = s(args.titel) || s(args.ziel);
      if (!title) throw new UserError("Bitte titel oder ziel angeben.");
      const from = dateArg(args.von, today, "von") || "";
      const to = dateArg(args.bis, today, "bis") || from;
      if (from && to && to < from) throw new UserError("„bis“ liegt vor „von“.");
      const b = args.budget == null || s(args.budget) === "" ? "" : parseAmount(args.budget);
      if (b !== "" && !(b >= 0)) throw new UserError("Das Budget ist ungültig.");
      const id = alltagId(d.now);
      const trip = { id, title, dest: s(args.ziel), from, to, budget: b === "" ? "" : round2(b), emoji: "🧳", plan: [], expenses: [], notes: "", docs: "", created: d.now, updated: d.now, src: SRC };
      const writes = [d.fs.setWrite(d.p(`a_travel_trips/${id}`), trip)];
      let extra = "";
      if (s(args.vorlage)) {
        const meta = UW.templateMeta(s(args.vorlage));
        const lid = alltagId(d.now + 1);
        writes.push(d.fs.setWrite(d.p(`a_travel_packing/${lid}`), { id: lid, kind: "trip", tripId: id, cats: UW.templateCats(s(args.vorlage)), title: `${meta.title} – ${title}`, emoji: meta.emoji, created: d.now, updated: d.now, src: SRC }));
        extra = ` · Packliste „${meta.title}“ mit ${meta.count} Gegenständen angelegt`;
      }
      await d.commit(writes);
      return `Reise angelegt: 🧳 ${title}${from ? ` · ${UW.dateRange(trip)} (${UW.tripStatus(trip, today).label})` : " · ohne Datum"}${trip.budget !== "" ? ` · Budget ${eur(trip.budget)}` : ""}${extra}.`;
    }
    if (a === "packliste_hinzufuegen" || a === "packliste_abhaken") {
      const items = (Array.isArray(args.gegenstaende) ? args.gegenstaende : []).map((x) => s(x)).filter(Boolean);
      let { list } = await findPackList(d, args.liste);
      if (a === "packliste_hinzufuegen") {
        if (!items.length) throw new UserError("Bitte gegenstaende angeben.");
        const writes = [];
        let made = "";
        if (!list) {
          const id = alltagId(d.now);
          list = { id, kind: "trip", tripId: null, title: s(args.liste) || "Packliste", emoji: "🧳", cats: [], created: d.now, src: SRC };
          made = ` (neue Packliste „${list.title}“)`;
        }
        const cats = (list.cats || []).map((c) => ({ ...c, items: [...(c.items || [])] }));
        let cat = null;
        if (s(args.kategorie)) {
          cat = cats.find((c) => score(args.kategorie, c.name) >= 70 || c.key === norm(args.kategorie));
          if (!cat) {
            const info = UW.PACK_CATS.find((c) => score(args.kategorie, c.name) >= 70 || c.key === norm(args.kategorie));
            cat = UW.newCat(info ? info.key : "sonstiges", info ? null : s(args.kategorie).slice(0, 30));
            cats.push(cat);
          }
        } else cat = cats.find((c) => c.key === "sonstiges") || cats[cats.length - 1] || (cats.push(UW.newCat("sonstiges")), cats[cats.length - 1]);
        const have = new Set(cats.flatMap((c) => (c.items || []).map((i) => norm(i.name))));
        const added = [], dup = [];
        for (const n of items) { if (have.has(norm(n))) { dup.push(n); continue; } cat.items.push(UW.newItem(n.slice(0, 60))); have.add(norm(n)); added.push(n); }
        const next = { ...list, cats, updated: d.now };
        writes.push(d.fs.setWrite(d.p(`a_travel_packing/${list.id}`), next));
        await d.commit(writes);
        const p = UW.packProgress(next);
        return `${added.length ? `Auf die Packliste „${next.title}“${made} gesetzt (${cat.emoji || ""} ${cat.name}): ${added.join(", ")}` : "Nichts Neues hinzugefügt"}${dup.length ? ` · schon drauf: ${dup.join(", ")}` : ""}. Stand ${p.done}/${p.total} gepackt.`;
      }
      if (!list) throw new UserError("Es gibt noch keine Packliste.");
      const done = args.erledigt !== false;
      const hit = [], miss = [];
      const cats = (list.cats || []).map((c) => ({ ...c, items: (c.items || []).map((i) => ({ ...i })) }));
      const flat = cats.flatMap((c) => c.items);
      if (args.alle === true) for (const i of flat) { if (i.done !== done) { i.done = done; hit.push(i.name); } }
      else {
        if (!items.length) throw new UserError("Bitte gegenstaende angeben (oder alle: true).");
        for (const n of items) {
          const m = best(n, flat, (i) => i.name, 70);
          if (!m) { miss.push(n); continue; }
          m.item.done = done; hit.push(m.item.name);
        }
      }
      if (!hit.length) throw new UserError(`Nichts abgehakt${miss.length ? ` – nicht auf der Liste: ${miss.join(", ")}` : ""}.`);
      const next = { ...list, cats, updated: d.now };
      await d.commit([d.fs.setWrite(d.p(`a_travel_packing/${list.id}`), next)]);
      const p = UW.packProgress(next);
      return `${done ? "Gepackt ☑" : "Wieder offen ☐"}: ${hit.slice(0, 20).join(", ")}${hit.length > 20 ? ` … (+${hit.length - 20})` : ""}${miss.length ? ` · nicht gefunden: ${miss.join(", ")}` : ""}. Packliste „${next.title}“: ${p.done}/${p.total} (${p.pct} %).`;
    }
    if (a === "parkplatz_merken") {
      const addr = s(args.adresse);
      const lat = Number(args.lat), lng = Number(args.lng);
      const ll = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
      if (!addr && !ll) throw new UserError("Bitte adresse (oder lat/lng) angeben – den Standort des Handys kann ich nicht abfragen.");
      let until = null;
      if (s(args.parkschein_bis)) {
        const t = timeArg(args.parkschein_bis, "parkschein_bis");
        until = keyToTs(today, t.h, t.mi);
        if (until <= d.now) throw new UserError("Die Parkschein-Zeit liegt in der Vergangenheit.");
      }
      const old = (await d.alltag("travel_parking")).filter((x) => x && x.active);
      const id = alltagId(d.now);
      const rec = { id, lat: ll ? lat : null, lng: ll ? lng : null, acc: 0, addr: addr.slice(0, 200), ts: d.now, note: s(args.notiz).slice(0, 200), level: s(args.ebene).slice(0, 20), spot: s(args.platz).slice(0, 20), until, timerStart: until ? d.now : null, remindMin: 10, active: true, created: d.now, updated: d.now, src: SRC };
      await d.commit([...old.map((o) => d.fs.patchWrite(d.p(`a_travel_parking/${o.id}`), { active: false, updated: d.now })), d.fs.setWrite(d.p(`a_travel_parking/${id}`), clean(rec))]);
      return `Parkplatz gemerkt: ${addr || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}${rec.level ? ` · Ebene ${rec.level}` : ""}${rec.spot ? ` · Platz ${rec.spot}` : ""}${until ? ` · Parkschein bis ${clock(until)} (Erinnerung 10 min vorher)` : ""} 🅿️`;
    }
    if (a === "tanken") {
      const liters = numArg(args.liter), total = numArg(args.betrag), km = numArg(args.km_stand);
      if (!(liters > 0 && liters < 500)) throw new UserError("Bitte die getankten Liter angeben (z. B. 42,5).");
      if (!(total > 0 && total < 2000)) throw new UserError("Bitte den Betrag in Euro angeben.");
      if (!(km > 0 && km < 3000000)) throw new UserError("Bitte den Kilometerstand angeben (nötig für den Verbrauch).");
      const date = dateArg(args.datum, today) || today;
      const id = alltagId(d.now);
      const booked = args.in_geld_buchen === true;
      const item = { id, date, liters: Math.round(liters * 100) / 100, total: round2(total), km: Math.round(km), station: s(args.tankstelle).slice(0, 40), full: args.voll !== false, booked, created: d.now, updated: d.now, src: SRC };
      const writes = [d.fs.setWrite(d.p(`a_travel_fuel/${id}`), item)];
      if (booked) {
        const cats = await d.alltag("money_cats").catch(() => []);
        if (cats.length && !cats.some((c) => c.id === "auto")) writes.push(d.fs.setWrite(d.p("a_money_cats/auto"), { id: "auto", name: "Auto & Tanken", emoji: "⛽", color: "#0ea5e9", type: "out", order: 2, created: d.now, updated: d.now }));
        const tid = "uw_fuel_" + id;
        writes.push(d.fs.setWrite(d.p(`a_money_tx/${tid}`), { id: tid, date, amount: item.total, type: "out", category: "auto", note: `Tanken${item.station ? " " + item.station : ""} (${String(item.liters).replace(".", ",")} l)`, src: "unterwegs", created: d.now, updated: d.now }));
      }
      await d.commit(writes);
      d.invalidate("a_travel_fuel");
      const fs = UW.fuelStats(await d.alltag("travel_fuel"));
      const row = fs.rows.get(id);
      return `Tanken eingetragen: ${fmtKey(date)} · ${String(item.liters).replace(".", ",")} l · ${eur(item.total)} (${(item.total / item.liters).toFixed(3).replace(".", ",")} €/l) · km-Stand ${item.km}${item.full ? " · voll" : ""}${row ? ` · Verbrauch seit letzter Volltankung ${row.l100.toFixed(1).replace(".", ",")} l/100 km` : ""}${booked ? " · auch in Geld gebucht" : ""}.`;
    }
    if (a === "adresse_speichern") {
      const name = need(args.name, "Bitte einen Namen angeben.").slice(0, 60);
      const places = await d.alltag("travel_places");
      const ex = places.find((p) => norm(p.name) === norm(name));
      const cat = s(args.kategorie) ? (UW.PLACE_CATS.find((c) => c.key === norm(args.kategorie) || score(args.kategorie, c.name) >= 70) || UW.placeCat("sonstiges")).key : (ex && ex.cat) || "sonstiges";
      const id = ex ? ex.id : alltagId(d.now);
      const rec = {
        ...(ex || { created: d.now, src: SRC }), id, name, cat,
        address: args.adresse != null ? s(args.adresse).slice(0, 200) : (ex && ex.address) || "",
        phone: args.telefon != null ? s(args.telefon).slice(0, 30) : (ex && ex.phone) || "",
        notes: args.notiz != null ? s(args.notiz).slice(0, 300) : (ex && ex.notes) || "",
        fav: args.favorit != null ? !!args.favorit : !!(ex && ex.fav), updated: d.now,
      };
      await d.commit([d.fs.setWrite(d.p(`a_travel_places/${id}`), rec)]);
      const c = UW.placeCat(cat);
      return `Adresse ${ex ? "aktualisiert" : "gespeichert"}: ${name} (${c.emoji} ${c.name})${rec.address ? ` · ${rec.address}` : ""}${rec.phone ? ` · Tel. ${rec.phone}` : ""}.`;
    }
    throw new UserError("Unbekannte aktion.");
  },
};

/* ===================== Material-Status ===================== */

const TOOL_MATERIAL_STATUS = {
  name: "material_status",
  title: "Material-Status ändern",
  description: "Setzt den Status von vorhandenem Material (Bereich Material): brauche → besorgt → baustelle (liegt vor Ort) → verbaut. Angabe über id oder name (unscharf, optional ort zum Eingrenzen). Bei „verbaut“ zählt heute als Verbautag.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string", description: "Material, z. B. \"Schuko\"" },
      ort: { type: "string", description: "Baustelle zum Eingrenzen" },
      status: { type: "string", description: "brauche, besorgt, baustelle (vor Ort) oder verbaut" },
    },
    required: ["status"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const status = matStatus(args.status, "");
    if (!status) throw new UserError("Bitte einen status angeben.");
    const [all, places] = await Promise.all([d.alltag("material_items"), d.places()]);
    let pool = all.filter((x) => x && s(x.name));
    if (!s(args.id)) pool = pool.filter((x) => x.status !== status && (status === "verbaut" || x.status !== "verbaut"));
    if (s(args.ort)) {
      const pl = resolvePlace(args.ort, places);
      pool = pool.filter((x) => (pl.placeId && x.placeId === pl.placeId) || score(args.ort, x.place) >= 60);
    }
    const it = pick(pool, { id: args.id, name: args.name }, (x) => `${x.name}`, "Material", 55);
    const patch = { status, doneAt: status === "verbaut" ? d.now : null, dayKey: status === "verbaut" ? today : it.dayKey || today, updated: d.now };
    await d.commit([d.fs.patchWrite(d.p(`a_material_items/${it.id}`), patch, { exists: true })]);
    d.invalidate("a_material_items");
    const LBL = { brauche: "brauche", besorgt: "besorgt", baustelle: "auf der Baustelle", verbaut: "verbaut" };
    return `Material ${MAT.lineText(it)}${s(it.place) ? ` (${s(it.place)})` : ""}: ${LBL[it.status] || it.status || "?"} → ${LBL[status]}.`;
  },
};

/* ===================== Geld: Budget, Sparziel, Einzahlung, Teilen ===================== */

/* Update 9 – Sparziele: Spar-Erinnerung setzen (goal.reminder {on, amount, mode, day}) */
async function goalReminderWrite(d, args, m, goals, name) {
  if (!m) throw new UserError(`Kein Sparziel passt zu „${name}“.${goals.length ? ` Vorhanden: ${goals.map((g) => g.name).join(", ")}.` : ""}`);
  const g = m.item;
  const old = MC.goalReminder(g);
  if (args.aus === true) {
    await d.commit([d.fs.patchWrite(d.p(`a_money_goals/${g.id}`), { reminder: { ...old, on: false }, updated: d.now }, { exists: true })]);
    return `Spar-Erinnerung für „${g.name}“ ausgeschaltet.`;
  }
  const v = args.betrag != null ? parseAmount(args.betrag) : old.amount;
  if (!(v > 0) || v > 100000) throw new UserError("Bitte einen betrag pro Monat angeben (z. B. 50).");
  const mode = s(args.modus) === "tag" ? "day" : s(args.modus) === "zahltag" ? "payday" : old.mode;
  const day = mode === "day" ? Math.min(31, Math.max(1, Math.round(Number(args.tag ?? old.day) || 1))) : null;
  if (mode === "day" && args.tag == null && !(g.reminder && g.reminder.mode === "day")) throw new UserError("Für modus tag bitte den tag im Monat angeben (1–31).");
  const reminder = { on: true, amount: round2(v), mode, day };
  await d.commit([d.fs.patchWrite(d.p(`a_money_goals/${g.id}`), { reminder, updated: d.now }, { exists: true })]);
  return `Spar-Erinnerung für „${g.name}“: ${eur(reminder.amount)} pro Monat, ${mode === "day" ? `am ${day}. um 09:00` : "am Zahltag (sobald Lohn/Lehrlingsentschädigung eingeht)"} – per Push und als Hinweis in Geld › Übersicht.${MC.goalLinked(g) ? " Das Ziel ist ein echtes Konto: überweisen in der BAWAG-App." : ""}`;
}

const TOOL_GELD_W = {
  name: "geld_eintragen",
  title: "Budget/Sparziel/Teilen",
  description: "Schreibt im Geld-Bereich – aktion: budget (Monatsbudget gesamt oder für eine kategorie, betrag 0 = kein Limit), sparziel (anlegen/ändern: name, ziel_betrag, bis, emoji), einzahlung (in ein Sparziel einzahlen; negativer betrag = entnehmen; nicht bei Zielen mit echtem Bankkonto), erinnerung (Spar-Erinnerung eines Sparziels: name, betrag pro Monat, modus zahltag = sobald Lohn/Lehrlingsentschädigung eingeht oder tag = fixer Tag im Monat um 09:00; aus: true schaltet ab) oder teilen (Ausgabe in einer Teilen-Gruppe: gruppe, beschreibung, betrag, bezahlt_von, fuer; neue Gruppe mit personen). Buchungen selbst: ausgabe_eintragen. Kein Geld wird wirklich überwiesen.",
  inputSchema: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["budget", "sparziel", "einzahlung", "erinnerung", "teilen"] },
      modus: { type: "string", enum: ["zahltag", "tag"], description: "Erinnerung: zahltag (Standard) oder tag" },
      tag: { type: "integer", minimum: 1, maximum: 31, description: "Erinnerung mit modus tag: Tag im Monat" },
      aus: { type: "boolean", description: "Erinnerung: true = ausschalten" },
      kategorie: { type: "string", description: "Budget: Kategorie oder \"gesamt\" (Standard)" },
      betrag: { type: ["number", "string"], description: "Euro" },
      name: { type: "string", description: "Sparziel-Name" },
      ziel_betrag: { type: ["number", "string"], description: "Sparziel: Zielbetrag" },
      bis: { type: "string", description: "Sparziel: Zieldatum" },
      emoji: { type: "string" },
      gruppe: { type: "string", description: "Teilen: Gruppenname, z. B. \"WG\" oder \"Urlaub Kroatien\"" },
      personen: { type: "array", items: { type: "string" }, description: "Teilen: Personen einer NEUEN Gruppe (ohne dich)" },
      beschreibung: { type: "string", description: "Teilen: wofür" },
      bezahlt_von: { type: "string", description: "Teilen: wer bezahlt hat (Standard ich)" },
      fuer: { type: "array", items: { type: "string" }, description: "Teilen: für wen (Standard alle), \"ich\" = du" },
      datum: { type: "string" },
    },
    required: ["aktion"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const a = s(args.aktion);
    const amt = () => { const v = parseAmount(args.betrag); if (!(v >= 0) || v > 1000000) throw new UserError("Bitte einen gültigen betrag angeben."); return round2(v); };
    if (a === "budget") {
      const q = s(args.kategorie);
      let id = "total", label = "Gesamt";
      if (q && !/^(gesamt|total|alle?s?|monat)$/i.test(q)) {
        const cats = [...(await moneyCats(d)).values()].filter((c) => c.type !== "in");
        const c = cats.find((x) => x.id === q.toLowerCase()) || pick(cats, { name: q }, (x) => x.name, "Kategorie", 55);
        id = c.id; label = catName(await moneyCats(d), c.id);
      }
      const v = amt();
      const cur = (await d.alltag("money_budget")).find((b) => b.id === id);
      await d.commit([d.fs.setWrite(d.p(`a_money_budget/${id}`), { ...(cur || { created: d.now }), id, amount: v, updated: d.now })]);
      return v > 0 ? `Budget ${label}: ${cur && Number(cur.amount) > 0 ? `${eur(cur.amount)} → ` : ""}${eur(v)} pro Monat.` : `Budget ${label} entfernt (kein Limit mehr).`;
    }
    if (a === "sparziel" || a === "einzahlung" || a === "erinnerung") {
      const goals = await d.alltag("money_goals");
      const name = need(args.name, "Bitte den Namen des Sparziels angeben.");
      const m = goals.length ? best(name, goals, (g) => g.name, 70) : null;
      if (a === "erinnerung") return goalReminderWrite(d, args, m, goals, name); // Update 9 – Sparziele
      if (a === "einzahlung") {
        if (!m) throw new UserError(`Kein Sparziel passt zu „${name}“.${goals.length ? ` Vorhanden: ${goals.map((g) => g.name).join(", ")}.` : ""}`);
        const v = parseAmount(String(args.betrag ?? "").replace(/^-/, ""));
        if (!(v > 0)) throw new UserError("Bitte einen betrag angeben (negativ = entnehmen).");
        const sign = /^\s*-/.test(String(args.betrag)) || Number(args.betrag) < 0 ? -1 : 1;
        const g = m.item;
        if (MC.goalLinked(g)) throw new UserError(`„${g.name}“ ist mit einem echten Bankkonto verbunden – der Stand kommt von der Bank. Geld überweisen geht in der BAWAG-App (z. B. Dauerauftrag aufs Sparkonto).`);
        const saved = round2(Math.max(0, (Number(g.saved) || 0) + sign * v));
        await d.commit([d.fs.patchWrite(d.p(`a_money_goals/${g.id}`), { saved, updated: d.now }, { exists: true })]);
        const tg = Number(g.target) || 0;
        return `${sign > 0 ? "Eingezahlt" : "Entnommen"}: ${eur(v)} – „${g.name}“ jetzt ${eur(saved)}${tg ? ` von ${eur(tg)} (${Math.min(100, Math.round(saved / tg * 100))} %)` : ""}${sign > 0 && tg && saved >= tg ? " 🎉 Ziel erreicht!" : ""}.`;
      }
      const g = m && m.score >= 90 ? m.item : null;
      const rec = { ...(g || { saved: 0, emoji: "🎯", created: d.now, src: SRC }), name: g ? g.name : name.slice(0, 40), updated: d.now };
      if (args.ziel_betrag != null) { const v = parseAmount(args.ziel_betrag); if (!(v > 0)) throw new UserError("ziel_betrag muss größer 0 sein."); rec.target = round2(v); }
      else if (!g) throw new UserError("Für ein neues Sparziel bitte ziel_betrag angeben.");
      if (s(args.bis)) rec.date = dateArg(args.bis, today, "bis");
      if (s(args.emoji)) rec.emoji = s(args.emoji).slice(0, 8);
      const id = g ? g.id : alltagId(d.now);
      await d.commit([d.fs.setWrite(d.p(`a_money_goals/${id}`), { ...rec, id })]);
      const pm = MC.goalPerMonth(rec, today);
      return `Sparziel ${g ? "geändert" : "angelegt"}: ${rec.emoji || ""} ${rec.name} – ${eur(rec.saved || 0)} von ${eur(rec.target)}${isKey(rec.date) ? ` bis ${fmtKey(rec.date)}` : ""}${pm.perMonth ? ` (noch ${eur(pm.perMonth)} pro Monat)` : ""}.`;
    }
    if (a === "teilen") {
      const groups = await d.alltag("money_split");
      const gname = need(args.gruppe, "Bitte die Gruppe angeben.");
      const m = groups.length ? best(gname, groups, (g) => g.name, 60) : null;
      let g = m ? m.item : null, made = "";
      if (!g) {
        const ppl = (Array.isArray(args.personen) ? args.personen : []).map((x) => s(x)).filter(Boolean);
        if (!ppl.length) throw new UserError(`Keine Gruppe passt zu „${gname}“.${groups.length ? ` Vorhanden: ${groups.map((x) => x.name).join(", ")}.` : ""} Für eine neue Gruppe bitte personen angeben.`);
        g = { id: alltagId(d.now), name: gname.slice(0, 40), people: [{ id: MC.ME, name: "Ich" }, ...ppl.map((n, i) => ({ id: "p" + (d.now + i).toString(36) + Math.random().toString(36).slice(2, 5), name: n.slice(0, 24) }))], expenses: [], created: d.now, src: SRC };
        made = ` (neue Gruppe mit ${ppl.join(", ")})`;
      }
      const people = g.people || [];
      const who = (q) => {
        const v = s(q);
        if (!v || /^(ich|mir|mich|me|du|selbst)$/i.test(v)) return MC.ME;
        const p = pick(people.filter((x) => x.id !== MC.ME), { name: v }, (x) => x.name, "Person", 60);
        return p.id;
      };
      const v = amt();
      if (!(v > 0)) throw new UserError("Bitte einen betrag größer 0 angeben.");
      const paidBy = who(args.bezahlt_von);
      const fors = Array.isArray(args.fuer) && args.fuer.length ? [...new Set(args.fuer.map(who))] : [];
      const exp = { id: "e" + d.now.toString(36) + Math.random().toString(36).slice(2, 5), desc: s(args.beschreibung).slice(0, 60), amount: v, date: dateArg(args.datum, today) || today, paidBy, forIds: fors.length === people.length ? [] : fors };
      const next = { ...g, expenses: [...(g.expenses || []), exp], updated: d.now };
      await d.commit([d.fs.setWrite(d.p(`a_money_split/${g.id}`), next)]);
      const st = MC.settle(next);
      const n = exp.forIds.length || people.length;
      return `Ausgabe in „${next.name}“${made} eingetragen: ${exp.desc || "Ausgabe"} ${eur(v)}, bezahlt von ${MC.personName(next, paidBy)}, geteilt durch ${n} (${eur(v / n)} pro Person).\nStand: ${st.length ? st.map((t) => MC.settleSentence(next, t).replace(/\u00a0/g, " ")).join("; ") : "alles ausgeglichen"}.`;
    }
    throw new UserError("Unbekannte aktion.");
  },
};

/* ===================== Schule ===================== */

const PERIODS = [null, ["08:00", "08:50"], ["08:50", "09:40"], ["09:55", "10:45"], ["10:45", "11:35"], ["11:45", "12:35"], ["12:35", "13:25"],
  ["13:45", "14:35"], ["14:35", "15:25"], ["15:35", "16:25"], ["16:25", "17:15"], ["17:20", "18:10"], ["18:10", "19:00"]];
const GRADE_KINDS = [["Schularbeit", 2], ["Test", 1], ["Mitarbeit", 1], ["Mündlich", 1], ["Referat", 1], ["Hausübung", 0.5], ["Zeugnis", 1]];
const WD_IN = { mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6, so: 0, sonntag: 0 };
const WD_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

const TOOL_SCHULE_W = {
  name: "schule_eintragen",
  title: "Schule eintragen",
  description: "Schreibt im Schul-Bereich – aktion: note (fach, note 1–5, art z. B. Schularbeit/Test/Mitarbeit, gewicht, datum, notiz), stunde (Stundenplan-Stunde anlegen oder mit id ändern: wochentag, stunde, stunden, fach, von/bis, raum, lehrer, woche A/B) oder projekt_schritt (projekt + schritt abhaken bzw. erledigt=false; mit neuer_schritt einen Schritt hinzufügen). Hausaufgaben/Prüfungen: hausaufgabe_anlegen/pruefung_anlegen.",
  inputSchema: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["note", "stunde", "projekt_schritt"] },
      fach: { type: "string" },
      note: { type: "number", description: "1 = Sehr gut … 5 = Nicht genügend" },
      art: { type: "string", description: "Note: Schularbeit, Test, Mitarbeit, Mündlich, Referat, Hausübung, Zeugnis" },
      gewicht: { type: "number", description: "Note: Gewichtung (Standard je nach Art)" },
      datum: { type: "string" },
      notiz: { type: "string" },
      id: { type: "string", description: "Stunde: ID einer vorhandenen Stunde (aus schule_lesen bereich stundenplan)" },
      wochentag: { type: ["string", "number"], description: "Stunde: Mo–Fr bzw. 1–5" },
      stunde: { type: "number", description: "Stunde: erste Unterrichtsstunde (1–12)" },
      stunden: { type: "number", description: "Stunde: Anzahl Stunden hintereinander (Standard 1)" },
      von: { type: "string", description: "Stunde: Beginn HH:MM (Standard aus Stundenraster)" },
      bis: { type: "string", description: "Stunde: Ende HH:MM" },
      raum: { type: "string" }, lehrer: { type: "string" },
      woche: { type: "string", enum: ["", "A", "B"], description: "Stunde: nur in A- bzw. B-Woche" },
      projekt: { type: "string", description: "Projekt-Name oder -ID" },
      schritt: { type: "string", description: "Schritt-Text oder Schritt-ID" },
      erledigt: { type: "boolean", description: "Standard true" },
      neuer_schritt: { type: "string", description: "Neuen Schritt zum Projekt hinzufügen" },
    },
    required: ["aktion"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const a = s(args.aktion);
    if (a === "note") {
      const subject = await resolveSubject(d, need(args.fach, "Bitte das Fach angeben."));
      const n = Number(args.note);
      if (!(Number.isInteger(n) && n >= 1 && n <= 5)) throw new UserError("note muss 1, 2, 3, 4 oder 5 sein.");
      const km = s(args.art) ? best(args.art, GRADE_KINDS, (x) => x[0], 55) : null;
      const kind = km ? km.item[0] : s(args.art) || "Test";
      const weight = args.gewicht != null ? Number(args.gewicht) : (GRADE_KINDS.find(([k]) => k === kind) || [0, 1])[1];
      if (!(weight > 0 && weight <= 5)) throw new UserError("gewicht muss größer 0 und höchstens 5 sein.");
      const id = alltagId(d.now);
      const date = dateArg(args.datum, today) || today;
      await d.commit([d.fs.setWrite(d.p(`a_school_grades/${id}`), { id, subject, grade: n, kind, weight, date, note: s(args.notiz), examId: null, created: d.now, updated: d.now, src: SRC })]);
      d.invalidate("a_school_grades");
      const list = (await d.alltag("school_grades")).filter((g) => s(g.subject).toLowerCase() === subject.toLowerCase() && Number(g.grade) >= 1);
      let sm = 0, w = 0;
      for (const g of list) { const gw = Number(g.weight) > 0 ? Number(g.weight) : 1; sm += Number(g.grade) * gw; w += gw; }
      return `Note eingetragen: ${subject} ${n} (${kind}${weight !== 1 ? `, ×${String(weight).replace(".", ",")}` : ""}) am ${fmtKey(date)}. Schnitt ${subject} jetzt ${w ? (sm / w).toFixed(2).replace(".", ",") : "–"}.`;
    }
    if (a === "stunde") {
      const tt = await d.alltag("school_timetable");
      const ex = s(args.id) ? tt.find((x) => x.id === s(args.id)) : null;
      if (s(args.id) && !ex) throw new UserError(`Keine Stunde mit der ID ${s(args.id)}.`);
      const base = ex || {};
      let wd = base.weekday;
      if (args.wochentag != null && s(args.wochentag) !== "") {
        wd = typeof args.wochentag === "number" ? args.wochentag : WD_IN[norm(args.wochentag)] ?? Number(args.wochentag);
        if (!(Number.isInteger(wd) && wd >= 0 && wd <= 6)) throw new UserError("wochentag: Mo, Di, Mi, Do, Fr (oder 1–5).");
      }
      if (wd == null) throw new UserError("Bitte den wochentag angeben.");
      const period = args.stunde != null ? Math.round(Number(args.stunde)) : Number(base.period);
      if (!(period >= 1 && period <= 12)) throw new UserError("stunde muss 1–12 sein.");
      const periods = args.stunden != null ? Math.max(1, Math.min(12, Math.round(Number(args.stunden)))) : Math.max(1, Number(base.periods) || 1);
      const subject = s(args.fach) ? await resolveSubject(d, args.fach) : s(base.subject);
      if (!subject) throw new UserError("Bitte das fach angeben.");
      const last = Math.min(12, period + periods - 1);
      const from = s(args.von) ? fmtTime(timeArg(args.von, "von")) : (args.stunde != null || !base.from ? PERIODS[period][0] : base.from);
      const to = s(args.bis) ? fmtTime(timeArg(args.bis, "bis")) : (args.stunde != null || args.stunden != null || !base.to ? PERIODS[last][1] : base.to);
      const id = ex ? ex.id : alltagId(d.now);
      const rec = { ...base, id, subject, weekday: wd, period, periods, from, to, room: args.raum != null ? s(args.raum) : s(base.room), teacher: args.lehrer != null ? s(args.lehrer) : s(base.teacher), color: base.color || "", week: args.woche != null ? s(args.woche) : base.week || "", updated: d.now, created: base.created || d.now, ...(ex ? {} : { src: SRC }) };
      const clash = tt.find((x) => x.id !== id && Number(x.weekday) === wd && (!x.week || !rec.week || x.week === rec.week) && x.period < period + periods && period < x.period + Math.max(1, Number(x.periods) || 1));
      await d.commit([d.fs.setWrite(d.p(`a_school_timetable/${id}`), rec)]);
      return `Stundenplan ${ex ? "geändert" : "ergänzt"}: ${WD_NAMES[wd]} ${periods > 1 ? `${period}.–${last}.` : `${period}.`} Stunde (${from}–${to}) ${subject}${rec.room ? ` · Raum ${rec.room}` : ""}${rec.teacher ? ` · ${rec.teacher}` : ""}${rec.week ? ` · nur ${rec.week}-Woche` : ""}.${clash ? ` Achtung: überschneidet sich mit ${clash.subject}.` : ""}`;
    }
    if (a === "projekt_schritt") {
      const pj = await d.alltag("school_projects");
      if (!pj.length) throw new UserError("Es gibt keine Projekte.");
      const p = pj.find((x) => x.id === s(args.projekt)) || pick(pj, { name: need(args.projekt, "Bitte das projekt angeben.") }, (x) => x.title, "Projekt", 55);
      const steps = (Array.isArray(p.steps) ? p.steps : []).map((x) => ({ ...x }));
      let msg;
      if (s(args.neuer_schritt)) {
        const st = { id: alltagId(d.now), text: s(args.neuer_schritt).slice(0, 120), done: false };
        steps.push(st); msg = `Schritt hinzugefügt: ☐ ${st.text}`;
      } else {
        const st = steps.find((x) => x.id === s(args.schritt)) || pick(steps, { name: need(args.schritt, "Bitte den schritt angeben (oder neuer_schritt).") }, (x) => x.text, "Schritt", 55);
        const done = args.erledigt !== false;
        if (!!st.done === done) return `„${st.text}“ ist schon ${done ? "erledigt" : "offen"}.`;
        st.done = done; msg = `${done ? "Erledigt ☑" : "Wieder offen ☐"}: ${st.text}`;
      }
      await d.commit([d.fs.patchWrite(d.p(`a_school_projects/${p.id}`), { steps, updated: d.now }, { exists: true })]);
      return `${msg} – Projekt „${p.title}“: ${steps.filter((x) => x.done).length}/${steps.length} Schritte.`;
    }
    throw new UserError("Unbekannte aktion.");
  },
};

/* ===================== Berichtsheft-Notiz ===================== */

const TOOL_BERICHT = {
  name: "berichtsheft_notiz",
  title: "Berichtsheft-Notiz",
  description: "Speichert die Ergänzung zu einer Berichtsheft-Woche (Feld „Ergänzungen zur Woche“ im Berichtsheft der App). woche wie bei wochen_zusammenfassung (leer = diese, \"letzte\", \"KW 45\", Datum). modus ersetzen oder anhaengen (Standard: anhängen, wenn schon etwas drinsteht). Zum Lesen: wochen_zusammenfassung.",
  inputSchema: {
    type: "object",
    properties: {
      woche: { type: "string" },
      text: { type: "string", description: "Text der Ergänzung, z. B. was in der Woche gelernt wurde" },
      modus: { type: "string", enum: ["ersetzen", "anhaengen"] },
    },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const today = dayKey(d.now);
    const text = need(args.text, "Bitte einen Text angeben (Notizen löschen geht nur in der App).").slice(0, 2000);
    const ws = weekStart(args.woche, today);
    const wk = weekKey(ws);
    const settings = await d.settings();
    const raw = settings.apprentice && typeof settings.apprentice === "object" ? settings.apprentice : {};
    const notes = raw.notes && typeof raw.notes === "object" ? { ...raw.notes } : {};
    const old = s(notes[wk]);
    const mode = s(args.modus) || (old ? "anhaengen" : "ersetzen");
    notes[wk] = mode === "anhaengen" && old ? `${old}\n${text}` : text;
    await d.commit([d.fs.patchWrite(d.p("meta/settings"), { apprentice: { ...raw, notes } })]);
    d.invalidate("settings");
    return `Berichtsheft KW ${isoWeek(ws).week} (${fmtKey(ws)} – ${fmtKey(addDays(ws, 6))}): Ergänzung ${old ? (mode === "anhaengen" ? "ergänzt" : "ersetzt") : "gespeichert"}.\n„${short(notes[wk], 300)}“`;
  },
};

/* ===================== Galerie ===================== */

const TOOL_GALERIE_W = {
  name: "galerie_bearbeiten",
  title: "Galerie bearbeiten",
  description: "Ändert Text-Angaben in der Galerie – aktion: album_umbenennen (album, neuer_name), album_kategorie (album in eine Kategorie wie Baustellen/Berufsschule/Privat verschieben; \"keine\" = ohne Kategorie) oder foto_notiz (foto_id aus galerie_lesen, notiz). Fotos werden nie gelöscht oder geöffnet; ein Album löschen (Fotos bleiben) geht nur über loeschen_vorschlagen mit was=album. Die Kategorie für NEUE Fotos: einstellung_aendern bereich galerie.",
  inputSchema: {
    type: "object",
    properties: {
      aktion: { type: "string", enum: ["album_umbenennen", "album_kategorie", "foto_notiz"] },
      album: { type: "string", description: "Albumname (unscharf) oder Album-ID" },
      neuer_name: { type: "string" },
      kategorie: { type: "string", description: "Kategorie-Name oder \"keine\"" },
      foto_id: { type: "string" },
      notiz: { type: "string", description: "Notiz zum Foto (leer = Notiz entfernen)" },
    },
    required: ["aktion"],
    additionalProperties: false,
  },
  annotations: WR,
  async run(args, d) {
    const a = s(args.aktion);
    if (a === "foto_notiz") {
      const id = idArg(need(args.foto_id, "Bitte foto_id angeben (aus galerie_lesen)."), "Foto-ID");
      const idx = await photoIndex(d);
      const it = idx.find((x) => x.id === id);
      if (!it) throw new UserError(`Kein Foto mit der ID ${id} gefunden.`);
      const note = s(args.notiz).slice(0, 500);
      // Foto UND Index ändern (wie photos.updatePhoto) – nur das Feld note, Bilddaten werden nicht gelesen.
      await d.commit([d.fs.patchWrite(d.p(`photos/${id}`), { note }, { exists: true }), d.fs.patchWrite(d.p(`a_photo_index/${id}`), { note }, { exists: true })]);
      return note ? `Notiz zum Foto vom ${it.ts ? fmtKey(dayKey(it.ts)) : "?"} gespeichert: „${short(note, 120)}“.` : "Notiz zum Foto entfernt.";
    }
    const albums = (await d.alltag("photo_albums")).map(G.normAlbum).filter(Boolean);
    if (!albums.length) throw new UserError("Es gibt noch keine Alben.");
    const al = albums.find((x) => x.id === s(args.album)) || pick(albums, { name: need(args.album, "Bitte das album angeben.") }, (x) => x.name, "Album", 55);
    if (a === "album_umbenennen") {
      const name = need(args.neuer_name, "Bitte neuer_name angeben.").slice(0, 60);
      await d.commit([d.fs.patchWrite(d.p(`a_photo_albums/${al.id}`), { name, updated: d.now }, { exists: true })]);
      return `Album umbenannt: „${al.name}“ → „${name}“.`;
    }
    if (a === "album_kategorie") {
      const q = need(args.kategorie, "Bitte die kategorie angeben (oder \"keine\").");
      const folders = G.sortFolders((await d.alltag("photo_folders")).map(G.normFolder).filter(Boolean));
      let f = null;
      if (!/^(keine|ohne|-)$/i.test(q)) f = folders.find((x) => x.id === q) || pick(folders, { name: q }, (x) => x.name, "Kategorie", 55);
      await d.commit([d.fs.patchWrite(d.p(`a_photo_albums/${al.id}`), { folderId: f ? f.id : null, updated: d.now }, { exists: true })]);
      return `Album „${al.name}“ ${f ? `liegt jetzt in ${f.emoji} ${f.name}` : "hat jetzt keine Kategorie"}.`;
    }
    throw new UserError("Unbekannte aktion.");
  },
};

export const WRITE_TOOLS = [TOOL_PLANER_BEARBEITEN, TOOL_EINTRAG_BEARBEITEN, TOOL_FAHRT, TOOL_UNTERWEGS_W, TOOL_MATERIAL_STATUS, TOOL_GELD_W, TOOL_SCHULE_W, TOOL_BERICHT, TOOL_GALERIE_W];
