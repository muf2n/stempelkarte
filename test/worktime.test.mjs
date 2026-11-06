// Update 10c – Arbeitszeit-Pro: Prognose, Was-wäre-wenn, Änderungsprotokoll, Monatsabschluss, Konten,
// vergessene Stempelungen, Pausenhinweis, Soll je Wochentag (util/logic/decide gleich) und .xlsx/CSV-Export.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import * as WT from "../js/worktime-core.js";
import * as U from "../js/util.js";
import * as L from "../tools/mcp/src/logic.js";
import { dailyTargetMinVienna, decide, pauseAfterMin as decPauseAfter } from "../tools/reminders/decide.mjs";
import { buildXlsx, crc32, zipStore } from "../js/xlsx.js";
import { entriesCSV, entriesXlsxRows } from "../js/export.js";

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const work = (y, m, d, h1, m1, h2, m2, pause = 30, extra = {}) => ({ id: `e${y}${m}${d}${h1}`, kind: "work", start: at(y, m, d, h1, m1), end: at(y, m, d, h2, m2), pauseMin: pause, ...extra });
const S = { weeklyTarget: 40, workDays: [1, 2, 3, 4, 5], holidays: true, balanceStart: "2026-11-02" };

test("Soll je Wochentag: eigener Wert, Rest gleichmäßig, 0 h, ungültig ignoriert", () => {
  const s = { ...S, dayHours: { 5: 6 } };
  assert.equal(U.weekdayTargetMin(5, s), 360);
  assert.equal(U.weekdayTargetMin(1, s), (40 * 60 - 360) / 4);
  assert.equal(U.weekdayTargetMin(6, s), 0, "Samstag kein Arbeitstag");
  assert.equal(U.dailyTargetMin(at(2026, 11, 6), s), 360, "Fr 06.11.");
  assert.equal(U.dailyTargetMin(at(2026, 11, 9), s), 510);
  assert.equal(U.weekdayTargetMin(1, { ...S, dayHours: { 1: 0 } }), 0);
  assert.equal(U.weekdayTargetMin(2, { ...S, dayHours: { 1: "x", 2: 30 } }), 480, "ungültige Werte → gleichmäßig");
  assert.equal(U.weekdayTargetMin(1, { ...S, dayHours: { 1: null } }), 480, "null = wieder gleichmäßig");
  // alle Tage eigen → Wochensumme = Summe der Werte
  const all = { ...S, dayHours: { 1: 9, 2: 9, 3: 9, 4: 9, 5: 4 } };
  assert.equal([1, 2, 3, 4, 5].reduce((a, d) => a + U.weekdayTargetMin(d, all), 0), 40 * 60);
  // Feiertag bleibt 0 (Mariä Empfängnis Di 08.12.2026)
  assert.equal(U.dailyTargetMin(at(2026, 12, 8), s), 0);
});

test("Soll je Wochentag: App (util), Server (logic) und Push (decide) stimmen überein", () => {
  const vars = [{}, S, { ...S, dayHours: { 5: 6 } }, { ...S, workDays: [1, 2, 3, 4], dayHours: { 1: 10, 4: "" } },
    { ...S, dayHours: { 3: 0 }, school: { days: [2], blocks: [{ from: "2026-11-16", to: "2026-11-20" }] } }];
  for (let d = new Date(2026, 9, 20); d < new Date(2027, 0, 10); d.setDate(d.getDate() + 1)) {
    const k = U.dayKey(d);
    const v = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), wd: d.getDay(), key: k };
    for (const s of vars) {
      const want = U.dailyTargetMin(d.getTime(), s);
      assert.equal(L.dailyTargetMin(k, s), want, `logic ${k}`);
      assert.equal(dailyTargetMinVienna(s, v), want, `decide ${k}`);
    }
  }
});

test("Prognose: Woche/Monat Soll-Ist und Kontostand am Monatsende", () => {
  const now = at(2026, 11, 4, 12, 0); // Mi
  const entries = [work(2026, 11, 2, 7, 0, 16, 0), work(2026, 11, 3, 7, 0, 15, 30), work(2026, 11, 4, 7, 0, 11, 0, 0)];
  const f = WT.forecast({ entries, settings: S, now });
  // Mo 8:30 net, Di 8:00, Mi 4:00 (heute) → Ist 20:30
  assert.equal(f.week.ist, 8.5 * 60 + 8 * 60 + 4 * 60);
  assert.equal(f.week.soll, 40 * 60);
  assert.equal(f.week.open, 40 * 60 - f.week.ist);
  assert.equal(f.balance, 30 + 240, "Mo +30, Di ±0, heute nur Gutschrift (Soll erst ab morgen)");
  // Rest des Monats nach Soll → Kontostand bleibt +0:30
  assert.equal(f.endOfMonth.balance, 30);
  assert.equal(f.endOfMonth.key, "2026-11-30");
  // Urlaub in der Zukunft mit voller Gutschrift ändert nichts; Zeitausgleich (0 h) zieht das Tagessoll ab
  const za = { id: "za", kind: "zeitausgleich", start: at(2026, 11, 20), end: at(2026, 11, 20), creditMin: 0 };
  const ur = { id: "ur", kind: "urlaub", start: at(2026, 11, 19), end: at(2026, 11, 19), creditMin: 480 };
  const f2 = WT.forecast({ entries: [...entries, za, ur], settings: S, now });
  assert.equal(f2.endOfMonth.balance, 30 - 480);
  assert.equal(f2.endOfMonth.workDays, f.endOfMonth.workDays - 2);
  // laufende Schicht zählt wie in der Übersicht
  const f3 = WT.forecast({ entries: entries.slice(0, 2), settings: S, running: { start: at(2026, 11, 4, 7, 0) }, runningNetMin: 300, now });
  assert.equal(f3.week.ist, 8.5 * 60 + 8 * 60 + 300);
});

test("Prognose stimmt mit dem Überstundenkonto des Servers (logic.balanceNumbers) überein", () => {
  const now = at(2026, 11, 18, 9, 0);
  const entries = [work(2026, 11, 2, 7, 0, 16, 0), work(2026, 11, 3, 7, 0, 18, 0, 45), work(2026, 11, 10, 6, 0, 12, 0, 0),
    { id: "k", kind: "krank", start: at(2026, 11, 11), end: at(2026, 11, 11), creditMin: 480 }];
  for (const s of [S, { ...S, balanceOffsetMin: -125, dayHours: { 5: 5 } }, { ...S, balanceStart: null }]) {
    const f = WT.forecast({ entries, settings: s, now });
    assert.equal(Math.round(f.balance), Math.round(L.balanceNumbers(s, entries, null, now).total));
    assert.equal(Math.round(f.month.soFar), Math.round(L.balanceNumbers(s, entries, null, now).month));
  }
});

test("Was-wäre-wenn: jeden Freitag +30 Min bis 31.12.", () => {
  const now = at(2026, 11, 6, 8, 0); // Fr
  const input = { entries: [work(2026, 11, 2, 7, 0, 15, 30)], settings: S, now };
  const r = WT.whatIf(input, { weekdays: [5], deltaMin: 30, until: "2026-12-31" });
  // Fridays 06.11.–31.12.2026: 6,13,20,27 Nov, 4,11,18,25(Christtag!) Dez → 7 Arbeits-Freitage
  assert.equal(r.days, 7);
  assert.equal(r.diff, 7 * 30);
  assert.equal(r.result - r.base, 210);
  assert.match(WT.whatIfLabel({ weekdays: [5], deltaMin: 30, until: "2026-12-31" }), /jeden Fr \+0:30 h bis 31\.12\.2026/);
  assert.ok(WT.whatIf(input, { until: "2026-01-01" }).error);
  assert.ok(WT.whatIf(input, { until: "x" }).error);
  const all = WT.whatIf(input, { weekdays: [], deltaMin: -15, until: "2026-11-13" });
  assert.equal(all.days, 6, "Fr 06. + Mo–Fr 09.–13.");
  assert.equal(all.diff, -90);
});

test("Änderungsprotokoll: Felder alt → neu, Grund, Obergrenze 30, keine Leer-Einträge", () => {
  const prev = work(2026, 11, 3, 7, 0, 15, 30, 30, { note: "Montage", place: "Firma" });
  const next = { ...prev, start: at(2026, 11, 3, 7, 30), pauseMin: 45, note: "Montage Küche" };
  const ch = WT.diffEntry(prev, next);
  assert.deepEqual(ch.map((c) => c.field), ["start", "pauseMin", "note"]);
  const h = WT.withHistory(next, { by: "manuell", op: "edit", prev, at: 1000, reason: "  Ausstempeln vergessen " });
  assert.deepEqual(h.history, [{ at: 1000, by: "manuell", op: "edit", changes: ch, reason: "Ausstempeln vergessen" }]);
  assert.equal(WT.fmtChange(ch[0]), "Beginn 07:00 → 07:30");
  assert.equal(WT.fmtChange(ch[1]), "Pause 30 min → 45 min");
  // ohne Änderung und ohne Grund → kein neuer Eintrag
  assert.equal(WT.withHistory(h, { op: "edit", prev: h }).history.length, 1);
  // Obergrenze
  let e = { ...prev, history: [] };
  for (let i = 0; i < 40; i++) e = WT.withHistory({ ...e, pauseMin: i }, { by: "gps", op: "edit", prev: e, at: i });
  assert.equal(e.history.length, WT.HISTORY_CAP);
  assert.equal(e.history[0].at, 10);
  // unbekannte Herkunft → manuell; neu/gelöscht
  assert.equal(WT.withHistory(prev, { by: "hacker", op: "neu" }).history[0].by, "manuell");
  const rows = WT.historyRows(WT.withHistory(h, { op: "delete", by: "assistent", prev: h, at: 2000 }));
  assert.equal(rows[0].text, "gelöscht");
  assert.match(rows[0].by, /Assistent/);
  assert.match(rows[1].text, /Beginn 07:00 → 07:30 · Pause/);
  assert.equal(rows[1].reason, "Ausstempeln vergessen");
  // people + Art
  assert.deepEqual(WT.diffEntry({ people: ["Max"] }, { people: ["Max", "Sepp"] }), [{ field: "people", from: "Max", to: "Max, Sepp" }]);
  assert.deepEqual(WT.diffEntry({ kind: undefined }, { kind: "work" }), []);
});

test("GPS-Schutz: vorhandene Einträge werden nie überschrieben", () => {
  const now = at(2026, 11, 6, 7, 40);
  const manual = work(2026, 11, 6, 6, 0, 7, 20, 0);
  let g = WT.guardAutoStart([manual], at(2026, 11, 6, 7, 0), now);
  assert.equal(g.ok, true);
  assert.equal(g.start, manual.end, "Beginn hinter den Eintrag verschoben");
  assert.equal(g.reason, "verschoben");
  g = WT.guardAutoStart([work(2026, 11, 6, 7, 0, 15, 30)], at(2026, 11, 6, 7, 0), now);
  assert.equal(g.ok, false);
  assert.equal(g.reason, "laeuft");
  g = WT.guardAutoStart([{ id: "u", kind: "urlaub", start: at(2026, 11, 6), end: at(2026, 11, 6), creditMin: 480 }], at(2026, 11, 6, 7, 0), now);
  assert.equal(g.ok, false);
  assert.equal(g.reason, "abwesend");
  assert.deepEqual(WT.guardAutoStart([work(2026, 11, 5, 7, 0, 15, 30)], at(2026, 11, 6, 7, 0), now), { ok: true, start: at(2026, 11, 6, 7, 0), conflict: null, reason: "" });
});

test("Monatsabschluss: Summen, schließen, wieder öffnen", () => {
  const entries = [work(2026, 10, 1, 7, 0, 16, 0), { id: "u", kind: "urlaub", start: at(2026, 10, 2), end: at(2026, 10, 2), creditMin: 480 }];
  const t = WT.monthTotals({ entries, settings: S }, "2026-10");
  assert.equal(t.ist, 510 + 480);
  // Oktober 2026: 22 Werktage, Nationalfeiertag 26.10. (Mo) → 21 × 8 h
  assert.equal(t.soll, 21 * 480);
  assert.equal(t.workDays, 1);
  assert.equal(t.urlaub, 1);
  const cm = WT.closeMonth({}, "2026-10", t, 5, -123.4);
  assert.deepEqual(cm, { "2026-10": { at: 5, totals: t, balance: -123 } });
  assert.equal(WT.isClosedMonth({ closedMonths: cm }, at(2026, 10, 15)), true);
  assert.equal(WT.isClosedMonth({ closedMonths: cm }, "2026-11"), false);
  const re = WT.reopenMonth({ closedMonths: cm }, "2026-10");
  assert.deepEqual(re, { "2026-10": null });
  assert.equal(WT.isClosedMonth({ closedMonths: re }, "2026-10"), false);
  assert.equal(WT.monthLabel("2026-10"), "Oktober 2026");
  // Kontostand am Monatsende = Saldo bis inkl. letztem Tag
  const s2 = { ...S, balanceStart: "2026-10-01" };
  assert.equal(WT.balanceAtMonthEnd({ entries, settings: s2 }, "2026-10"), 510 + 480 - 21 * 480);
});

test("Konten + vergessene Stempelungen", () => {
  assert.deepEqual(WT.hourAccounts(-90.4), { plus: 0, minus: 90 });
  assert.deepEqual(WT.hourAccounts(125), { plus: 125, minus: 0 });
  const now = at(2026, 11, 6, 9, 0); // Fr
  const entries = [work(2026, 11, 2, 7, 0, 15, 30), work(2026, 11, 3, 6, 0, 19, 30, 30), { id: "o", kind: "work", start: at(2026, 11, 4, 7, 0), end: null, pauseMin: 0 }];
  const gaps = WT.missingStamps({ entries, settings: S, now, days: 10 });
  const by = Object.fromEntries(gaps.map((g) => [g.key + ":" + g.type, g]));
  assert.ok(by["2026-11-05:leer"], "Do ohne Eintrag");
  assert.ok(by["2026-11-03:lang"], "13,5 h Schicht");
  assert.ok(by["2026-11-04:offen"], "ohne Ende");
  assert.ok(!gaps.some((g) => g.key === "2026-11-06"), "heute zählt nicht");
  assert.ok(!gaps.some((g) => g.key < "2026-11-02"), "vor Kontobeginn nicht");
  assert.equal(gaps[0].key, "2026-11-05", "neueste zuerst");
  const ign = WT.missingStamps({ entries, settings: { ...S, worktime: { ignoreGaps: ["2026-11-05", entries[1].id] } }, now, days: 10 });
  assert.ok(!ign.some((g) => g.key === "2026-11-05" || g.type === "lang"));
  const run = WT.missingStamps({ entries: [], settings: { ...S, balanceStart: "2026-11-06" }, running: { start: at(2026, 11, 5, 18, 0) }, now });
  assert.deepEqual(run.map((g) => g.type), ["laeuft"]);
  // Feiertag (Allerheiligen So) / Wochenende → keine Lücke
  assert.ok(!WT.missingStamps({ entries: [], settings: { ...S, balanceStart: "2026-10-31" }, now: at(2026, 11, 2, 9) }).length);
  assert.deepEqual(WT.readWorktime({}), { leaveLabel: "Urlaub", gapDays: 21, ignoreGaps: [] });
});

test("Pause: Hinweis mit AZG-Vorbehalt, Erinnerungszeit gleich in App und Push", () => {
  assert.equal(WT.pauseHint(6 * 60, 0), "", "genau 6 h → kein Hinweis");
  assert.match(WT.pauseHint(7 * 60, 15), /AZG.*Kollektivvertrag/);
  assert.equal(WT.pauseHint(8 * 60, 30), "");
  for (const v of [undefined, 100, 300, 600, 700, "330"]) assert.equal(WT.pauseAfterMin({ pauseAfterMin: v }), decPauseAfter({ pauseAfterMin: v }));
  assert.equal(WT.pauseAfterMin({ pauseAfterMin: 300 }), 300);
  // Push: nach 5 h statt 6 h, mit vorsichtigem Text
  const now = Date.UTC(2026, 10, 6, 12, 30); // 13:30 Wien
  const running = { start: Date.UTC(2026, 10, 6, 7, 0), pauseMs: 0, pauseStart: null };
  const s = { pauseAfterMin: 300, reminders: { pause: { enabled: true }, end: { enabled: false }, start: { enabled: false } } };
  const out = decide(now, s, running, [], {});
  const p = out.find((x) => x.type === "pause");
  assert.ok(p, "Pausen-Push nach 5 h");
  assert.match(p.body, /prüf deinen Kollektivvertrag/);
  assert.ok(!decide(now, { ...s, pauseAfterMin: 360 }, running, [], {}).some((x) => x.type === "pause"), "5,5 h < 6 h");
  // Start-Erinnerung entfällt an einem Arbeitstag mit eigenem Soll 0 h
  const mon = Date.UTC(2026, 10, 9, 7, 0); // Mo 08:00 Wien
  const rs = { reminders: { start: { enabled: true, time: "07:30" } } };
  assert.ok(decide(mon, rs, null, [], {}).some((x) => x.type === "start"));
  assert.ok(!decide(mon, { ...rs, dayHours: { 1: 0 } }, null, [], {}).some((x) => x.type === "start"));
});

/* ---------- Export ---------- */

function unzip(buf) {
  const files = {};
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true);
    const nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 30, p + 30 + nl));
    const data = buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    assert.equal(method, 0);
    assert.equal(crc32(data), crc, `CRC ${name}`);
    files[name] = new TextDecoder().decode(method ? inflateRawSync(data) : data);
    p += 30 + nl + xl + size;
  }
  assert.equal(dv.getUint32(p, true), 0x02014b50, "Zentralverzeichnis folgt");
  return files;
}

test("xlsx: gültiges ZIP mit CRC32, Zahlen als Zahlen, Text escaped", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  const z = zipStore([{ name: "a.txt", data: "hallo" }]);
  assert.deepEqual(unzip(z), { "a.txt": "hallo" });
  const x = buildXlsx([{ name: "Arbeit/Zeit", rows: [["Datum", "Netto"], ["01.11.", 7.5], ["<b>&\"", null]], widths: [10, 8] }]);
  const f = unzip(x);
  assert.ok(f["[Content_Types].xml"].includes("/xl/worksheets/sheet1.xml"));
  assert.ok(f["xl/workbook.xml"].includes('name="Arbeit Zeit"'));
  const sh = f["xl/worksheets/sheet1.xml"];
  assert.ok(sh.includes('<c r="B2"><v>7.5</v></c>'));
  assert.ok(sh.includes("&lt;b&gt;&amp;&quot;"));
  assert.ok(sh.includes('<c r="A1" t="inlineStr" s="1">'), "Kopfzeile fett");
  assert.ok(!sh.includes('r="B3"'), "leere Zelle ausgelassen");
});

test("CSV/xlsx-Zeilen: Semikolon + BOM, Zahlenspalten numerisch", () => {
  const entries = [work(2026, 11, 2, 7, 0, 15, 30, 30, { place: "Baustelle; Huber", note: 'sagt "hallo"' })];
  const csv = entriesCSV(entries, {});
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('"Baustelle; Huber"'));
  assert.ok(csv.includes('"sagt ""hallo"""'));
  assert.ok(csv.split("\r\n")[1].includes(";8,00;"));
  const rows = entriesXlsxRows(entries, {});
  assert.equal(rows[1][5], 30);
  assert.equal(rows[1][6], 8);
  assert.equal(rows[0][6], "Netto (h)");
  assert.equal(rows[2][0], "Summe");
  assert.equal(rows[2][6], 8);
});
