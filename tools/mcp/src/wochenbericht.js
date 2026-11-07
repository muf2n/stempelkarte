// Update 10 – Werkzeug „wochenbericht_lesen“ (nur lesen): strukturierte Wochen-Zusammenfassung wie im
// ✨ Wochenbericht der App (Baustellen, Abschnitte, Notizen, Tagebuch, verbautes Material, Foto-Notizen,
// Berufsschule/Urlaub/Krank) plus die gespeicherten Berichtsheft-Texte je Tag und der Status (Entwurf/abgegeben).
// Logik aus der gemeinsamen reinen Datei js/weekreport-core.js; Datum immer in Wiener Zeit (time.js).
// Freitext (Notizen, Tagebuch, Foto-Notizen, gespeicherte Texte) wird als untrusted_content abgegrenzt.
import { dayKey, keyToTs, addDays, fmtKey, fmtDateTime, hm, weekKey } from "./time.js";
import { buildWeek, readApprentice, apprenticeYear } from "./logic.js";
import { RO, s, short, untrusted } from "./util.js";
import { photoIndex } from "./read.js";
import { weekStart } from "./tools.js";
import * as WR from "./weekreport.js";

const u = (t, n = 300) => untrusted("berichtsheft", short(t, n));

const TOOL_WOCHENBERICHT = {
  name: "wochenbericht_lesen",
  title: "Wochenbericht lesen",
  description: "Automatischer Wochenbericht fürs Berichtsheft (nur lesen): je Tag Art (Arbeit/Berufsschule/Urlaub/Krank/Feiertag), Stunden, Baustellen mit Stunden, Abschnitte (z. B. Arbeiten/Autofahren), Notizen, Baustellen-Tagebuch, verbautes Material und Foto-Anzahl/-Notizen – dazu die in der App gespeicherten Berichtsheft-Texte je Tag und ob die Woche schon abgegeben ist. Ändern geht nur in der App (Berichtsheft → ✨ Wochenbericht).",
  inputSchema: {
    type: "object",
    properties: {
      woche: { type: "string", description: "Welche Woche: leer = diese Woche, \"letzte\", \"KW 45\", \"2026-W45\", \"-2\" oder ein Datum in der Woche (TT.MM.JJJJ)." },
    },
    additionalProperties: false,
  },
  annotations: RO,
  async run(args, d) {
    const ws = weekStart(args.woche, dayKey(d.now));
    const we = addDays(ws, 6);
    const wk = weekKey(ws);
    const [settings, entries, places, siteLog, material, photos, doc] = await Promise.all([
      d.settings(), d.entriesRange(keyToTs(ws), keyToTs(addDays(we, 1))), d.places().catch(() => []),
      d.alltag("site_log").catch(() => []), d.alltag("material_items").catch(() => []), photoIndex(d).catch(() => []),
      d.doc(`a_${WR.COLLECTION}/${wk}`).catch(() => null),
    ]);
    const rows = buildWeek(settings, entries, ws);
    const sum = WR.buildWeekReport({ week: wk, rows, entries, dayKeyOf: dayKey, places, siteLog, material, photos });
    const saved = WR.normDoc(doc, wk);
    const ap = readApprentice(settings);
    const lj = apprenticeYear(ap, ws) || apprenticeYear(ap, we);
    const t = sum.totals;
    const out = [`Wochenbericht KW ${sum.kw}/${sum.year} · ${fmtKey(ws)} – ${fmtKey(we)}`];
    out.push(`Status: ${saved.status === "abgegeben" ? `✅ abgegeben${saved.submittedAt ? ` am ${fmtDateTime(saved.submittedAt)}` : ""}` : saved.saved ? "Entwurf (gespeichert)" : "noch nicht gespeichert"}${lj ? ` · ${lj}. Lehrjahr` : ""}`);
    const bits = [`${hm(t.min)} h`, `${t.workDays} Arbeitstag${t.workDays === 1 ? "" : "e"}`];
    if (t.schoolDays) bits.push(`${t.schoolDays}× Berufsschule`);
    if (t.leaveDays) bits.push(`${t.leaveDays}× Urlaub`);
    if (t.sickDays) bits.push(`${t.sickDays}× Krank`);
    if (t.zaDays) bits.push(`${t.zaDays}× Zeitausgleich`);
    if (t.driveMin) bits.push(`${hm(t.driveMin)} h Fahrzeit`);
    if (t.photos) bits.push(`${t.photos} ${t.photos === 1 ? "Foto" : "Fotos"}`);
    out.push(`Woche: ${bits.join(" · ")}`);
    if (sum.sites.length) out.push(`Baustellen: ${sum.sites.map((x) => `${x.name} (${hm(x.min)} h an ${x.days} ${x.days === 1 ? "Tag" : "Tagen"})`).join(", ")}`);
    for (const day of sum.days) {
      const meta = WR.TYPE_META[day.type] || WR.TYPE_META.frei;
      out.push("", `${day.wd}, ${fmtKey(day.key)} – ${day.worked && day.school ? "Arbeit + Berufsschule" : meta.l}${day.holiday ? ` (${day.holiday})` : ""} · ${hm(day.min)} h`);
      if (day.sites.length) out.push(`  Baustellen: ${day.sites.map((x) => x.min ? `${x.name} ${hm(x.min)} h` : x.name).join(", ")}`);
      if (day.worked && day.segments.length) out.push(`  Abschnitte: ${day.segments.map((x) => `${x.activity} ${hm(x.min)} h`).join(", ")}`);
      if (day.notes.length) out.push(`  Notizen: ${u(day.notes.join(" | "))}`);
      if (day.log.length) out.push(`  Tagebuch: ${u(day.log.map((x) => x.text).join(" | "))}`);
      if (day.material.length) out.push(`  Verbaut: ${day.material.map((x) => x.line).join(", ")}`);
      if (day.photos.count) out.push(`  Fotos: ${day.photos.count}${day.photos.notes.length ? ` (${u(day.photos.notes.join(" | "), 200)})` : ""}`);
      if (day.people.length) out.push(`  Mit: ${day.people.join(", ")}`);
      const txt = saved.days[day.key];
      if (s(txt)) out.push(`  Berichtsheft-Text${saved.src[day.key] === "claude" ? " (mit Claude formuliert)" : ""}: ${u(txt, 600)}`);
    }
    const note = ap.notes[wk];
    if (s(note)) out.push("", `Ergänzungen zur Woche: ${u(note, 600)}`);
    if (!saved.saved) out.push("", "Hinweis: Für diese Woche ist noch kein Berichtsheft-Text gespeichert – in der App unter Berichtsheft → ✨ Wochenbericht erstellen.");
    return out.join("\n");
  },
};

export const WEEKREPORT_TOOLS = [TOOL_WOCHENBERICHT];
