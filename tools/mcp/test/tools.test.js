// Alle Werkzeuge mit Testdaten; Gegenprobe der Berechnungen mit dem echten Web-App-Code
// (util.js, views/overview.js, views/report.js) in der Zeitzone Europe/Vienna.
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";
import * as L from "../src/logic.js";
import * as T from "../src/time.js";

const util = await import(new URL("../../../js/util.js", import.meta.url).href);
const timerJs = await import(new URL("../../../js/timer.js", import.meta.url).href);
const overview = await import(new URL("../../../js/views/overview.js", import.meta.url).href);
const report = await import(new URL("../../../js/views/report.js", import.meta.url).href).catch(() => null);

const NOW = vt(2026, 11, 4, 10, 0); // Mi 04.11.2026 10:00
const SETTINGS = {
  weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5], balanceStart: "2026-10-26", balanceOffsetMin: 120,
  school: { days: [4], blocks: [{ id: "b1", from: "2026-12-01", to: "2026-12-11", label: "Blockschule 2" }] },
  apprentice: { name: "Florian Lippa", trade: "Elektrotechnik", company: "Elektro Maier", start: "2025-09-01", years: 3.5, notes: { "2026-W45": "Schutzmaßnahmen gelernt" } },
  people: ["Max"],
};
const ENTRIES = {
  e1: { kind: "work", start: vt(2026, 10, 27, 7, 0), end: vt(2026, 10, 27, 16, 0), pauseMin: 30, placeId: "p1", place: "Baustelle Huber", note: "Kabel ziehen", people: [], inLoc: null, outLoc: null,
    segments: [
      { start: vt(2026, 10, 27, 7, 0), end: vt(2026, 10, 27, 7, 30), activity: "Autofahren", placeId: "p2", place: "Firma Elektro Maier", loc: null, endLoc: null, endPlace: "Baustelle Huber" },
      { start: vt(2026, 10, 27, 7, 30), end: vt(2026, 10, 27, 16, 0), activity: "Arbeiten", placeId: "p1", place: "Baustelle Huber", loc: null, endLoc: null, endPlace: "" },
    ] },
  e2: { kind: "urlaub", start: vt(2026, 10, 28), end: vt(2026, 10, 28), pauseMin: 0, creditMin: 462, placeId: null, place: "", note: "" },
  e3: { kind: "krank", start: vt(2026, 10, 30), end: vt(2026, 10, 30), pauseMin: 0, creditMin: 462, placeId: null, place: "", note: "Grippe" },
  e4: { start: vt(2026, 11, 2, 7, 0), end: vt(2026, 11, 2, 15, 30), pauseMin: 30, placeId: "p1", place: "Baustelle Huber", note: "Verteiler montiert", people: ["Max"] },
  e5: { kind: "zeitausgleich", start: vt(2026, 11, 3), end: vt(2026, 11, 3), pauseMin: 0, creditMin: 0, placeId: null, place: "", note: "" },
};
const RUNNING = { start: vt(2026, 11, 4, 7, 0), segments: [{ start: vt(2026, 11, 4, 7, 0), activity: "Arbeiten", placeId: "p1", place: "Baustelle Huber", loc: null }], placeId: "p1", place: "Baustelle Huber", note: "", people: [], pauseStart: null, pauseMs: 0, inLoc: null };

async function seeded({ running = RUNNING } = {}) {
  const t = await setup({ now: NOW });
  const b = t.base;
  t.g.set(`${b}/meta/settings`, SETTINGS);
  t.g.set(`${b}/meta/state`, { running, rev: NOW - 1000 });
  t.g.set(`${b}/places/p1`, { name: "Baustelle Huber", addr: "Hauptstraße 1, Linz", lat: 48.3, lng: 14.28, radius: 150 });
  t.g.set(`${b}/places/p2`, { name: "Firma Elektro Maier", addr: "Industriezeile 5", lat: 48.31, lng: 14.3, radius: 200 });
  for (const [id, e] of Object.entries(ENTRIES)) t.g.set(`${b}/entries/${id}`, e);
  return t;
}

/* ---------- Gegenproben mit der Web-App ---------- */

test("vt() = lokale Date-Zeit in Wien", () => {
  assert.equal(vt(2026, 10, 27, 7, 0), new Date(2026, 9, 27, 7, 0).getTime());
  assert.equal(vt(2026, 7, 1, 7, 0), new Date(2026, 6, 1, 7, 0).getTime());
});

test("Feiertage, Tagessoll, Schultage und dayKey stimmen mit util.js überein (2025–2028)", () => {
  for (let y = 2025; y <= 2028; y++) {
    assert.deepEqual([...L.holidaysOf(y).entries()].sort(), [...util.atHolidays(y).entries()].sort(), `Feiertage ${y}`);
  }
  const variants = [SETTINGS, {}, { ...SETTINGS, holidays: false, workDays: [1, 2, 3, 4], weeklyTarget: 40 }];
  for (let k = "2025-12-20"; k <= "2027-01-10"; k = T.addDays(k, 1)) {
    const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
    for (const s of variants) {
      assert.equal(L.dailyTargetMin(k, s), util.dailyTargetMin(d.getTime(), s), `Soll ${k}`);
      assert.equal(L.schoolLabel(k, s), util.schoolLabel(d.getTime(), s), `Schule ${k}`);
      assert.equal(L.schoolCreditMin(k, s), util.schoolCreditMin(d.getTime(), s));
    }
  }
  // Tagesgrenzen inkl. Sommer-/Winterzeit-Umstellung
  for (let ts = Date.UTC(2026, 2, 28); ts < Date.UTC(2026, 2, 30); ts += 15 * 60000) assert.equal(T.dayKey(ts), util.dayKey(ts));
  for (let ts = Date.UTC(2026, 9, 24); ts < Date.UTC(2026, 9, 26); ts += 15 * 60000) {
    assert.equal(T.dayKey(ts), util.dayKey(ts));
    assert.equal(T.clock(ts), util.clock(ts));
  }
  assert.equal(T.keyToTs("2026-03-29", 12, 0), new Date(2026, 2, 29, 12, 0).getTime());
  assert.equal(T.keyToTs("2026-10-25", 3, 30), new Date(2026, 9, 25, 3, 30).getTime());
  assert.equal(T.mondayOf("2026-11-04"), util.dayKey(util.startOfWeek(NOW)));
});

test("Überstundenkonto identisch zur Übersicht (views/overview.js renderBalanceCard)", () => {
  const entries = Object.entries(ENTRIES).map(([id, e]) => ({ ...e, id }));
  for (const [run, now] of [[RUNNING, NOW], [null, NOW], [RUNNING, vt(2026, 11, 8, 20, 0)], [null, vt(2026, 12, 3, 9, 0)]]) {
    for (const settings of [SETTINGS, { ...SETTINGS, balanceStart: null, balanceOffsetMin: 0 }]) {
      const RealDate = globalThis.Date;
      globalThis.Date = class extends RealDate {
        constructor(...a) { super(...(a.length ? a : [now])); }
        static now() { return now; }
      };
      const el = { innerHTML: "", querySelector: () => null };
      try {
        overview.renderBalanceCard(el, { ready: true, entries, settings: L.mergeSettings(settings), running: run, todos: [] }, { util, timer: timerJs });
      } finally { globalThis.Date = RealDate; }
      const html = el.innerHTML;
      const saldo = /rb-saldo[^>]*>([^<]+)</.exec(html)[1];
      const kv = [...html.matchAll(/<b class="(?:plus|minus)">([^<]+)<\/b>/g)].map((m) => m[1]);
      const b = L.balanceNumbers(L.mergeSettings(settings), entries, run, now);
      assert.equal(T.signedH(b.total), saldo);
      assert.deepEqual([T.signedH(b.week), T.signedH(b.month)], kv);
    }
  }
});

test("Berichtsheft-Woche identisch zu views/report.js buildWeek", { skip: !report }, () => {
  const entries = Object.entries(ENTRIES).map(([id, e]) => ({ ...e, id }));
  for (const ws of ["2026-10-26", "2026-11-02"]) {
    const mine = L.buildWeek(L.mergeSettings(SETTINGS), entries, ws);
    const [y, m, d] = ws.split("-").map(Number);
    const theirs = report.buildWeek({ settings: L.mergeSettings(SETTINGS), entries }, new Date(y, m - 1, d));
    assert.deepEqual(mine.map((r) => ({ ...r })), theirs.map(({ date, wd, ...r }) => r));
  }
});

/* ---------- Werkzeuge ---------- */

test("status_heute: eingestempelt, Woche, Überstundenkonto", async () => {
  const t = await seeded();
  const r = await t.tool("status_heute");
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Stand Mi, 04\.11\.2026, 10:00 Uhr/);
  assert.match(r.text, /Eingestempelt seit 07:00 – bisher 3:00 h netto · Ort: Baustelle Huber/);
  assert.match(r.text, /Aktueller Abschnitt: Arbeiten seit 07:00/);
  assert.match(r.text, /Pause: noch keine/);
  assert.match(r.text, /Heute gutgeschrieben: 3:00 h von 7:42 h Tagessoll/);
  // Woche: Mo 8:00 + Di ZA 0 + heute 3:00 = 11:00; Soll Mo–Mi,Fr 4×7:42 = 30:48 (Do = Schule)
  assert.match(r.text, /Diese Woche: 11:00 h von 30:48 h Soll \(−19:48 h\)/);
  assert.match(r.text, /Überstundenkonto: [+−]\d+:\d\d h \(seit 26\.10\.2026, inkl\. Startsaldo \+2:00 h\)/);
});

test("status_heute ohne Daten: freundlich, nicht eingestempelt", async () => {
  const t = await setup({ now: NOW });
  const r = await t.tool("status_heute");
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Nicht eingestempelt/);
  assert.match(r.text, /Überstundenkonto: \+0:00 h/);
});

test("eintraege_lesen: Zeitraum mit Abschnitten, Abwesenheiten, laufender Schicht", async () => {
  const t = await seeded();
  let r = await t.tool("eintraege_lesen", { von: "26.10.2026", bis: "2026-11-04" });
  assert.match(r.text, /Einträge 26\.10\.2026 – 04\.11\.2026/);
  assert.match(r.text, /Di, 27\.10\.2026 – 8:30 h/);
  assert.match(r.text, /07:00–16:00 · netto 8:30 h · Pause 30 min · Ort: Baustelle Huber/);
  assert.match(r.text, /Abschnitte: 07:00–07:30 Autofahren \(Firma Elektro Maier → Baustelle Huber\), 0:30 h; 07:30–16:00 Arbeiten/);
  assert.match(r.text, /Urlaub · Gutschrift 7:42 h/);
  assert.match(r.text, /Notiz: Grippe/);
  assert.match(r.text, /Personen: Max/);
  assert.match(r.text, /Laufende Schicht/);
  r = await t.tool("eintraege_lesen", { von: "gestern" });
  assert.match(r.text, /Einträge am Di, 03\.11\.2026/);
  assert.match(r.text, /Zeitausgleich/);
  r = await t.tool("eintraege_lesen", { von: "01.01.2026", bis: "02.01.2026" });
  assert.match(r.text, /keine abgeschlossenen Einträge/);
  r = await t.tool("eintraege_lesen", { von: "32.13.2026" });
  assert.ok(r.isError);
});

test("wochen_zusammenfassung: Berichtsheft-Daten", async () => {
  const t = await seeded();
  let r = await t.tool("wochen_zusammenfassung", { woche: "letzte" });
  assert.match(r.text, /KW 44 · 26\.10\.2026 – 01\.11\.2026/);
  assert.match(r.text, /Name: Florian Lippa · Lehrberuf: Elektrotechnik · Lehrbetrieb: Elektro Maier · 2\. Lehrjahr/);
  assert.match(r.text, /Mo, 26\.10\.2026 – 0:00 h\n  Feiertag: Nationalfeiertag/);
  assert.match(r.text, /Tätigkeiten: Kabel ziehen; Autofahren/);
  assert.match(r.text, /Orte: Firma Elektro Maier, Baustelle Huber/);
  assert.match(r.text, /Do, 29\.10\.2026 – 7:42 h\n  Berufsschule/);
  assert.match(r.text, /Fr, 30\.10\.2026 – 7:42 h\n  Krank/);
  r = await t.tool("wochen_zusammenfassung", { woche: "KW 45" });
  assert.match(r.text, /KW 45 · 02\.11\.2026/);
  assert.match(r.text, /Ergänzungen zur Woche: Schutzmaßnahmen gelernt/);
  assert.match(r.text, /Mit: Max/);
  const r2 = await t.tool("wochen_zusammenfassung", {});
  assert.equal(r2.text.split("\n")[0], r.text.split("\n")[0]);
  const r3 = await t.tool("wochen_zusammenfassung", { woche: "28.10.2026" });
  assert.match(r3.text, /KW 44/);
  const r4 = await t.tool("wochen_zusammenfassung", { woche: "2026-W01" });
  assert.match(r4.text, /KW 1 · 29\.12\.2025 – 04\.01\.2026/);
});

test("eintrag_nachtragen: Arbeit (Pause, Ort, über Mitternacht), Urlaub-Zeitraum, Zeitausgleich", async () => {
  const t = await seeded({ running: null });
  let r = await t.tool("eintrag_nachtragen", { datum: "03.11.2026", beginn: "6:30", ende: "11:00", pause_min: 15, ort: "maier", notiz: "Lager" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Di, 03\.11\.2026, 06:30–11:00 · Pause 15 min · netto 4:15 h · Ort: Firma Elektro Maier/);
  const docs = t.g.list(`${t.base}/entries`).filter((e) => e.src === "claude");
  assert.equal(docs.length, 1);
  const e = docs[0];
  assert.match(e.id, /^e[0-9a-z]{17}$/);
  assert.deepEqual({ ...e, id: undefined }, {
    id: undefined, kind: "work", start: vt(2026, 11, 3, 6, 30), end: vt(2026, 11, 3, 11, 0), pauseMin: 15,
    placeId: "p2", place: "Firma Elektro Maier", note: "Lager", people: [], inLoc: null, outLoc: null, src: "claude",
  });
  assert.equal(util.netMin(e), 255);
  r = await t.tool("eintrag_nachtragen", { datum: "01.11.2026", beginn: "22:00", ende: "02:00" });
  assert.match(r.text, /bis nächsten Tag/);
  assert.match(r.text, /netto 4:00 h/);
  r = await t.tool("eintrag_nachtragen", { datum: "02.11.2026", beginn: "14:00", ende: "16:00" });
  assert.match(r.text, /überschneidet sich mit 07:00–15:30/);
  r = await t.tool("eintrag_nachtragen", { datum: "heute", beginn: "08:00", ende: "17:00" });
  assert.ok(r.isError);
  r = await t.tool("eintrag_nachtragen", { datum: "heute", beginn: "08:00", ende: "09:00", pause_min: 90 });
  assert.match(r.text, /länger als die Arbeitszeit/);
  r = await t.tool("eintrag_nachtragen", { datum: "heute" });
  assert.match(r.text, /beginn/);

  // Urlaub 23.11.–27.11. (Do = Schultag → ausgelassen)
  r = await t.tool("eintrag_nachtragen", { datum: "23.11.2026", bis: "27.11.2026", art: "urlaub" });
  assert.match(r.text, /4 Tage Urlaub eingetragen/);
  const ur = t.g.list(`${t.base}/entries`).filter((x) => x.kind === "urlaub" && x.src === "claude").sort((a, b) => a.start - b.start);
  assert.deepEqual(ur.map((x) => T.dayKey(x.start)), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-27"]);
  assert.ok(ur.every((x) => x.creditMin === 462 && x.start === x.end && x.pauseMin === 0));
  assert.equal(ur[0].start, new Date(2026, 10, 23).getTime(), "00:00 Wiener Zeit wie entries.js");
  r = await t.tool("eintrag_nachtragen", { datum: "06.11.2026", art: "zeitausgleich" });
  assert.match(r.text, /Gutschrift 0:00 h/);
  assert.match(r.text, /verbraucht Überstunden/);
  r = await t.tool("eintrag_nachtragen", { datum: "12.11.2026", art: "schule" });
  assert.match(r.text, /Gutschrift 7:42 h/);
  r = await t.tool("eintrag_nachtragen", { datum: "13.11.2026", art: "krank", gutschrift_h: 4 });
  assert.match(r.text, /Gutschrift 4:00 h/);
});

test("orte_lesen", async () => {
  const t = await seeded();
  const r = await t.tool("orte_lesen");
  assert.match(r.text, /2 gespeicherte Orte/);
  assert.match(r.text, /- Baustelle Huber – Hauptstraße 1, Linz · Radius 150 m/);
  const e = await setup();
  assert.match((await e.tool("orte_lesen")).text, /noch keine Orte/);
});

test("Planer: todo/termin/einsatz anlegen, lesen, abhaken (Formen wie store.normTodo)", async () => {
  const t = await seeded();
  let r = await t.tool("todos_lesen");
  assert.match(r.text, /noch nichts eingetragen/);
  r = await t.tool("todo_anlegen", { titel: "Werkzeug zurückbringen", faellig: "morgen", uhrzeit: "7" });
  assert.match(r.text, /fällig Do, 05\.11\.2026 07:00, Erinnerung 30 min vorher/);
  r = await t.tool("todo_anlegen", { titel: "Bohrer kaufen" });
  r = await t.tool("termin_anlegen", { titel: "Zahnarzt", datum: "10.11.2026", uhrzeit: "14:30", erinnern_min: 60 });
  assert.match(r.text, /Termin angelegt: „Zahnarzt“ am Di, 10\.11\.2026 um 14:30, Erinnerung 60 min vorher/);
  r = await t.tool("termin_anlegen", { titel: "Ohne Datum" });
  assert.ok(r.isError);
  r = await t.tool("einsatz_anlegen", { ort: "huber", datum: "09.11.2026", bis: "13.11.2026", personen: ["Sepp", "Max"] });
  assert.match(r.text, /Einsatz geplant: Mo, 09\.11\.2026 – Fr, 13\.11\.2026 · Baustelle Huber \(gespeicherter Ort „Baustelle Huber“ zu „huber“ gefunden\) · mit Max, Sepp/);
  const todos = t.g.list(`${t.base}/todos`);
  assert.equal(todos.length, 4);
  for (const d of todos) {
    assert.match(d.id, /^t[0-9a-z]{17}$/);
    const n = L.normTodo(d, d.id);
    assert.deepEqual({ ...n, id: d.id }, { ...d }, "Dokument ist bereits normalisiert");
    assert.equal(d.src, "claude");
    assert.ok(!("id" in t.g.get(`${t.base}/todos/${d.id}`)), "id nicht im Dokument (wie saveTodo)");
  }
  const ez = todos.find((x) => x.kind === "einsatz");
  assert.deepEqual({ ...ez, id: 0, createdAt: 0 }, { id: 0, createdAt: 0, kind: "einsatz", title: "Baustelle Huber", date: "2026-11-09", dateTo: "2026-11-13", time: null, placeId: "p1", place: "Baustelle Huber", people: ["Max", "Sepp"], note: "", remind: false, remindMin: 30, done: false, doneAt: null, src: "claude" });
  assert.deepEqual(t.g.get(`${t.base}/meta/settings`).people, ["Max", "Sepp"]);
  assert.equal(t.g.get(`${t.base}/meta/settings`).weeklyTarget, 38.5, "settings nur zusammengeführt");
  const tz = todos.find((x) => x.title === "Zahnarzt");
  assert.deepEqual([tz.kind, tz.date, tz.time, tz.remind, tz.remindMin], ["termin", "2026-11-10", "14:30", true, 60]);
  const bk = todos.find((x) => x.title === "Bohrer kaufen");
  assert.deepEqual([bk.kind, bk.date, bk.time, bk.remind], ["todo", null, null, false]);

  r = await t.tool("todos_lesen");
  assert.match(r.text, /Demnächst:\n- \[ \] Werkzeug zurückbringen/);
  assert.match(r.text, /Ohne Datum:\n- \[ \] Bohrer kaufen/);
  assert.match(r.text, /Kommende Einsätze:\n- Mo, 09\.11\.2026 – Fr, 13\.11\.2026: Baustelle Huber · mit Max, Sepp/);

  r = await t.tool("todo_erledigt", { titel: "werkzeug" });
  assert.match(r.text, /Erledigt: „Werkzeug zurückbringen“/);
  const w = todos.find((x) => x.title === "Werkzeug zurückbringen");
  const after = t.g.get(`${t.base}/todos/${w.id}`);
  assert.equal(after.done, true);
  assert.equal(after.doneAt, NOW);
  assert.equal(after.title, "Werkzeug zurückbringen", "übrige Felder bleiben");
  r = await t.tool("todo_erledigt", { id: w.id });
  assert.match(r.text, /schon erledigt/);
  r = await t.tool("todo_erledigt", { titel: "Fliegen fangen" });
  assert.ok(r.isError);
  r = await t.tool("todo_erledigt", { id: w.id, erledigt: false });
  assert.match(r.text, /Wieder offen/);
  r = await t.tool("todos_lesen", { filter: "erledigt" });
  assert.match(r.text, /Noch nichts erledigt/);

  r = await t.tool("planer_lesen", { von: "heute", bis: "13.11.2026" });
  assert.match(r.text, /Do, 05\.11\.2026\n  Berufsschule\n  \[ \] 07:00 Werkzeug zurückbringen/);
  assert.match(r.text, /Mo, 09\.11\.2026\n  Einsatz: Baustelle Huber mit Max, Sepp/);
  assert.match(r.text, /Di, 10\.11\.2026\n  Einsatz: Baustelle Huber mit Max, Sepp\n  \[ \] 14:30 Termin: Zahnarzt/);
  assert.match(r.text, /Offen ohne Datum:\n  \[ \] Bohrer kaufen/);
  r = await t.tool("planer_lesen", { von: "01.12.2026", bis: "02.12.2026" });
  assert.match(r.text, /Berufsschule – Blockschule 2/);
  r = await t.tool("planer_lesen", { von: "24.12.2026", bis: "26.12.2026" });
  assert.match(r.text, /Feiertag: Christtag/);
});

test("Geld: leer, Buchungen mit Auto-Kategorie, Budget, Abos, Sparziel", async () => {
  const t = await seeded();
  let r = await t.tool("geld_lesen");
  assert.match(r.text, /noch nichts eingetragen/);
  r = await t.tool("ausgabe_eintragen", { betrag: "12,50", notiz: "Billa Jause" });
  assert.match(r.text, /Ausgabe gebucht: 12,50 € am 04\.11\.2026 · 🛒 Essen & Einkauf \(automatisch erkannt über „billa“\)/);
  r = await t.tool("ausgabe_eintragen", { betrag: 45, notiz: "Tanken", kategorie: "auto" });
  r = await t.tool("ausgabe_eintragen", { betrag: 850, notiz: "Lehrlingsentschädigung", typ: "einnahme" });
  assert.match(r.text, /Einnahme gebucht: 850,00 €.*Einkommen/);
  r = await t.tool("ausgabe_eintragen", { betrag: 1234.5, kategorie: "Essen gehen", datum: "01.10.2026" });
  r = await t.tool("ausgabe_eintragen", { betrag: -3 });
  assert.ok(r.isError);
  const tx = t.g.list(`${t.base}/a_money_tx`);
  assert.equal(tx.length, 4);
  for (const x of tx) {
    assert.equal(x.id, x.id && t.g.get(`${t.base}/a_money_tx/${x.id}`).id, "id auch im Dokument (wie alltag/db.js put)");
    assert.ok(x.created && x.updated && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.amount > 0 && ["in", "out"].includes(x.type));
  }
  t.g.set(`${t.base}/a_money_budget/total`, { id: "total", amount: 60 });
  t.g.set(`${t.base}/a_money_budget/essen`, { id: "essen", amount: 100 });
  t.g.set(`${t.base}/a_money_subs/s1`, { id: "s1", name: "Spotify", amount: 6.99, interval: "month", next: "2026-11-15", category: "abos" });
  t.g.set(`${t.base}/a_money_goals/g1`, { id: "g1", name: "Führerschein", target: 1800, saved: 450, date: "2027-06-01", emoji: "🚗" });
  r = await t.tool("geld_lesen", {});
  assert.match(r.text, /Geld – November 2026/);
  assert.match(r.text, /Einnahmen 850,00 € · Ausgaben 57,50 € · Saldo \+792,50 €/);
  assert.match(r.text, /- ⛽ Auto & Tanken: 45,00 € \(78 %\)/);
  assert.match(r.text, /- Gesamt: 57,50 € von 60,00 € \(96 %, übrig 2,50 €\) – Achtung/);
  assert.match(r.text, /Fr|So, 15\.11\.2026: Spotify 6,99 €/);
  assert.match(r.text, /Führerschein: 450,00 € von 1\.800,00 € \(25 %\) bis 01\.06\.2027/);
  r = await t.tool("geld_lesen", { monat: "Oktober" });
  assert.match(r.text, /Ausgaben 1\.234,50 €/);
  assert.match(r.text, /Essen gehen/);
});

test("Abos: abos_lesen mit Laufzeit, Fristen, Kündigungslink; abo_bearbeiten sicher", async () => {
  const t = await seeded();
  let r = await t.tool("abos_lesen");
  assert.match(r.text, /noch keine Abos/);
  const b = t.base;
  t.g.set(`${b}/a_money_subs/n1`, { id: "n1", name: "Netflix", amount: 13.99, interval: "month", next: "2026-11-15", day: 15, category: "abos" });
  t.g.set(`${b}/a_money_subs/a1`, { id: "a1", name: "A1 Handy", amount: 25, interval: "month", next: "2026-11-20", day: 20, category: "handy", contractType: "Mindestlaufzeit", minTermEnd: "2026-12-31", noticeText: "1 Monat zum Monatsende", autoRenew: true, cancelUrl: "https://www.a1.net/kuendigen", account: "flo@example.com" });
  t.g.set(`${b}/a_money_subs/d1`, { id: "d1", name: "Disney+", amount: 9.99, interval: "month", next: "2026-11-11", contractType: "Testzeitraum", trialEnd: "2026-11-10" });
  t.g.set(`${b}/a_money_subs/x1`, { id: "x1", name: "Alt-Abo", amount: 5, interval: "month", next: "2026-09-01", cancelledOn: "2026-08-01", ended: "2026-08-31" });
  r = await t.tool("abos_lesen");
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /Abos – Stand 04\.11\.2026/);
  assert.match(r.text, /2 aktiv · zusammen 38,99\s€ pro Monat/);
  assert.match(r.text, /Kündigungsfristen bald:\n- A1 Handy: spätestens bis Mo, 30\.11\.2026 kündigen \(Vertrag bis 31\.12\.2026\)/);
  assert.match(r.text, /Testzeiträume:\n- Disney\+: endet Di, 10\.11\.2026 – in 6 Tagen/);
  assert.match(r.text, /Wie lange noch: Vertrag bis 31\.12\.2026 \(noch 1 Monat\) · spätestens kündigen bis 30\.11\.2026/);
  assert.match(r.text, /Kündigungslink: https:\/\/www\.a1\.net\/kuendigen/);
  assert.match(r.text, /Konto\/Login: flo@example\.com/);
  // Netflix ohne Link → Vorschlag aus dem Katalog
  assert.match(r.text, /Netflix[\s\S]*Kündigungslink \(Vorschlag aus dem Katalog, noch nicht eingetragen\): https:\/\/www\.netflix\.com\/cancelplan/);
  assert.doesNotMatch(r.text, /Alt-Abo/);
  assert.match(r.text, /1 beendetes Abo ausgeblendet/);
  r = await t.tool("abos_lesen", { name: "netflx" });
  assert.match(r.text, /^Abo – Stand/);
  assert.match(r.text, /läuft monatlich, nächste Abbuchung am 15\.11\.2026 – jederzeit kündbar bis 14\.11\.2026/);

  // Bearbeiten
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { cancelUrl: "https://www.netflix.com/cancelplan", so_kuendigen: "1. cancelplan öffnen\n2. Kündigen", was: "Streaming Standard" } });
  assert.match(r.text, /Abo „Netflix“ geändert: cancelUrl → https:\/\/www\.netflix\.com\/cancelplan; Anleitung „So kündigst du“ aktualisiert; what → Streaming Standard/);
  let n1 = t.g.get(`${b}/a_money_subs/n1`);
  assert.equal(n1.cancelUrl, "https://www.netflix.com/cancelplan");
  assert.equal(n1.cancelHow, "1. cancelplan öffnen\n2. Kündigen");
  assert.equal(n1.amount, 13.99, "andere Felder bleiben");
  // gekündigt ohne Ende → Ende berechnet (Tag vor der nächsten Abbuchung)
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { gekuendigt_am: "04.11.2026" } });
  assert.match(r.text, /Jetzt: gekündigt am 04\.11\.2026, läuft aus am 14\.11\.2026/);
  n1 = t.g.get(`${b}/a_money_subs/n1`);
  assert.equal(n1.ended, "2026-11-14");
  // Fehler: unbekanntes Feld, Passwort, kaputter Link, unbekanntes Abo
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { loeschen: true } });
  assert.ok(r.isError); assert.match(r.text, /gibt es nicht/);
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { passwort: "geheim" } });
  assert.ok(r.isError); assert.match(r.text, /Passwort-Tresor/);
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { account: "flo / Passwort: 1234" } });
  assert.ok(r.isError);
  r = await t.tool("abo_bearbeiten", { name: "Netflix", felder: { cancelUrl: "netflix.com" } });
  assert.ok(r.isError); assert.match(r.text, /https:\/\//);
  r = await t.tool("abo_bearbeiten", { name: "Spotify", felder: { what: "x" } });
  assert.ok(r.isError); assert.match(r.text, /Kein Abo passt/);
  r = await t.tool("abo_bearbeiten", { name: "A1", felder: { vertragsart: "monatlich", kuendigungsfrist_tage: 30, betrag: "27,50", intervall: "jährlich" } });
  const a1 = t.g.get(`${b}/a_money_subs/a1`);
  assert.equal(a1.contractType, "monatlich kündbar");
  assert.equal(a1.noticeDays, 30);
  assert.equal(a1.amount, 27.5);
  assert.equal(a1.interval, "year");
  assert.equal(t.g.list(`${b}/a_money_subs`).length, 4, "nichts gelöscht");
  // geld_lesen verweist auf abos_lesen und zählt Ausgelaufenes nicht
  r = await t.tool("geld_lesen");
  assert.match(r.text, /abos_lesen/);
});

test("Schule: leer, Hausaufgabe/Prüfung anlegen, Noten-Schnitt", async () => {
  const t = await seeded();
  let r = await t.tool("schule_lesen");
  assert.match(r.text, /Nächste Berufsschultage: Do, 05\.11\.2026/);
  assert.match(r.text, /noch keine Prüfungen/);
  t.g.set(`${t.base}/a_school_grades/g1`, { id: "g1", subject: "Elektrotechnik", grade: 2, weight: 2, kind: "Schularbeit", date: "2026-10-10" });
  t.g.set(`${t.base}/a_school_grades/g2`, { id: "g2", subject: "Elektrotechnik", grade: 1, weight: 1, kind: "Test", date: "2026-10-20" });
  t.g.set(`${t.base}/a_school_grades/g3`, { id: "g3", subject: "Deutsch", grade: 3, weight: 1, kind: "Test", date: "2026-10-20" });
  r = await t.tool("hausaufgabe_anlegen", { titel: "Schaltplan zeichnen", fach: "elektrotechnik", faellig: "06.11.2026", prioritaet: "hoch" });
  assert.match(r.text, /Elektrotechnik – „Schaltplan zeichnen“, fällig Fr, 06\.11\.2026 \(übermorgen\), Priorität wichtig/);
  r = await t.tool("pruefung_anlegen", { fach: "Elektrotechnik", datum: "18.11.2026", art: "test", stoff: "Ohmsches Gesetz; Kirchhoff" });
  assert.match(r.text, /Test eingetragen: Elektrotechnik am Mi, 18\.11\.2026 \(noch 14 Tage\)/);
  const task = t.g.list(`${t.base}/a_school_tasks`)[0];
  assert.deepEqual({ ...task, id: 0, created: 0, updated: 0 }, { id: 0, created: 0, updated: 0, done: false, title: "Schaltplan zeichnen", prio: "high", subject: "Elektrotechnik", due: "2026-11-06", note: "", src: "claude" });
  const ex = t.g.list(`${t.base}/a_school_exams`)[0];
  assert.equal(ex.topics, "Ohmsches Gesetz\nKirchhoff");
  assert.equal(ex.kind, "Test");
  assert.equal(ex.progress, 0);
  r = await t.tool("schule_lesen");
  assert.match(r.text, /- Mi, 18\.11\.2026 \(noch 14 Tage\): Test Elektrotechnik\n  Stoff: Ohmsches Gesetz; Kirchhoff/);
  assert.match(r.text, /- Elektrotechnik: Schaltplan zeichnen \(Fr, 06\.11\.2026 – übermorgen, wichtig\)/);
  // Schnitt ET = (2·2+1·1)/3 = 1,67; Deutsch 3; gesamt (1,67+3)/2 = 2,33
  assert.match(r.text, /Notenschnitt gesamt: 2,33 \(Gut\) aus 3 Noten/);
  assert.match(r.text, /- Elektrotechnik: Ø 1,67 \(2 Noten\)/);
});

test("Material: anlegen (Katalog + Ort unscharf, eingestempelt → aktueller Ort) und lesen", async () => {
  const t = await seeded();
  let r = await t.tool("material_lesen");
  assert.match(r.text, /noch nichts eingetragen/);
  r = await t.tool("material_anlegen", { name: "nym 3x1,5", menge: "25", status: "verbaut" });
  assert.match(r.text, /Als verbaut eingetragen: 25 m NYM-J 3×1,5 \(Katalog: „NYM-J 3×1,5“ zu „nym 3x1,5“\) · Baustelle: Baustelle Huber \(aktueller Arbeitsort\) · 04\.11\.2026/);
  r = await t.tool("material_anlegen", { name: "Schuko", menge: 2, status: "verbaut" });
  assert.match(r.text, /2× Schuko-Steckdose/);
  r = await t.tool("material_anlegen", { name: "Wago 413", menge: 1, einheit: "Pkg", ort: "Firma" });
  assert.match(r.text, /Auf die Einkaufsliste gesetzt: 1 Pkg Wago 221-413 \(Katalog: „Wago 221-413“ zu „Wago 413“\) · Baustelle: Firma Elektro Maier \(gespeicherter Ort/);
  r = await t.tool("material_anlegen", { name: "Spezialdübel XY", ort: "Teststraße 15" });
  assert.match(r.text, /1× Spezialdübel XY \(nicht im Katalog – als eigener Name übernommen\) · Baustelle: Teststraße 15 \(kein gespeicherter Ort/);
  r = await t.tool("material_anlegen", { name: "Schuko", menge: 0 });
  assert.ok(r.isError);
  r = await t.tool("material_anlegen", { name: "Schuko", einheit: "Fass" });
  assert.ok(r.isError);
  const items = t.g.list(`${t.base}/a_material_items`);
  assert.equal(items.length, 4);
  const nym = items.find((x) => x.name === "NYM-J 3×1,5");
  assert.deepEqual({ qty: nym.qty, unit: nym.unit, status: nym.status, placeId: nym.placeId, place: nym.place, dayKey: nym.dayKey, catalogId: nym.catalogId, photoId: nym.photoId, entryId: nym.entryId },
    { qty: 25, unit: "m", status: "verbaut", placeId: "p1", place: "Baustelle Huber", dayKey: "2026-11-04", catalogId: "nym-j-3x1-5", photoId: null, entryId: null });
  assert.ok(nym.doneAt && nym.created && nym.updated && nym.id);
  assert.equal(t.g.get(`${t.base}/a_material_catalog/b_nym-j-3x1-5`).count, 1);
  // zweites Mal verbaut am selben Tag → Summe
  await t.tool("material_anlegen", { name: "NYM-J 3×1,5", menge: 10, status: "verbaut", ort: "huber" });
  r = await t.tool("material_lesen", {});
  assert.match(r.text, /Noch zu besorgen \(2\):\n- Firma Elektro Maier: 1 Pkg Wago 221-413\n- Teststraße 15: 1× Spezialdübel XY/);
  assert.match(r.text, /- Mi, 04\.11\.2026 · Baustelle Huber: 35 m NYM-J 3×1,5, 2× Schuko-Steckdose/);
  r = await t.tool("material_lesen", { status: "verbaut", ort: "Huber", von: "01.11.2026", bis: "heute" });
  assert.match(r.text, /Verbaut \(01\.11\.2026 – 04\.11\.2026\)/);
  assert.doesNotMatch(r.text, /Wago/);
  r = await t.tool("material_lesen", { status: "verbaut", von: "01.10.2026", bis: "05.10.2026" });
  assert.match(r.text, /nichts eingetragen/);
});

test("Material: Status „baustelle“ (vor Ort) mit Synonymen anlegen und lesen", async () => {
  const t = await seeded();
  let r = await t.tool("material_anlegen", { name: "Kleinverteiler", status: "baustelle", ort: "Firma" });
  assert.match(r.text, /^Als „auf der Baustelle“ eingetragen \(vor Ort, noch nicht verbaut\): 1× Kleinverteiler · Baustelle: Firma Elektro Maier/);
  for (const [name, status] of [["nym 5x2,5", "vor Ort"], ["Schuko", "auf der Baustelle"], ["Wago 413", "geliefert"], ["Rauchmelder", "liegt bereit"], ["Dübel 6", "Vor-Ort"]]) {
    r = await t.tool("material_anlegen", { name, status, ort: "Firma" });
    assert.ok(!r.isError, `${status}: ${r.text}`);
    assert.match(r.text, /auf der Baustelle/);
  }
  r = await t.tool("material_anlegen", { name: "Taster", status: "besorgt", ort: "Firma" });
  assert.match(r.text, /^Als besorgt eingetragen: 1× Taster/);
  r = await t.tool("material_anlegen", { name: "Taster", status: "irgendwo" });
  assert.ok(r.isError);
  assert.match(r.text, /„baustelle“/);
  const items = t.g.list(`${t.base}/a_material_items`);
  assert.equal(items.filter((x) => x.status === "baustelle").length, 6);
  assert.ok(items.every((x) => x.doneAt == null));
  r = await t.tool("material_lesen", { status: "vor ort" });
  assert.match(r.text, /^Auf der Baustelle, noch nicht verbaut \(6\):\n- Firma Elektro Maier: /);
  assert.match(r.text, /1× Kleinverteiler/);
  assert.doesNotMatch(r.text, /Taster|Noch zu besorgen|Verbaut/);
  r = await t.tool("material_lesen", { status: "offen" });
  assert.match(r.text, /Besorgt, noch nicht auf der Baustelle \(1\):\n- Firma Elektro Maier: 1× Taster/);
  assert.match(r.text, /Auf der Baustelle, noch nicht verbaut \(6\)/);
  r = await t.tool("material_lesen", { status: "baustelle", ort: "huber" });
  assert.match(r.text, /kein Material/);
  r = await t.tool("material_lesen", { status: "quatsch" });
  assert.ok(r.isError);
  const def = (await t.rpc("tools/list")).result.tools.find((x) => x.name === "material_anlegen");
  assert.match(def.description, /baustelle/);
  assert.equal(def.inputSchema.properties.status.enum, undefined); // Synonyme wie „vor ort“ dürfen nicht an einer enum-Prüfung scheitern
});

test("Formatierung: Euro, Datum, Zeiten", () => {
  assert.equal(T.eur(1234.56), "1.234,56 €");
  assert.equal(T.eur(-5), "−5,00 €");
  assert.equal(T.eur(1000000), "1.000.000,00 €");
  assert.equal(T.fmtKey("2026-11-04"), "04.11.2026");
  assert.equal(T.parseDate("4.11.", "2026-11-04"), "2026-11-04");
  assert.equal(T.parseDate("04.11.26", "2026-01-01"), "2026-11-04");
  assert.equal(T.parseDate("31.02.2026", "2026-01-01"), null);
  assert.equal(T.parseDate("montag", "2026-11-04"), "2026-11-02");
  assert.equal(T.parseDate("nächsten Montag", "2026-11-04"), "2026-11-09");
  assert.deepEqual(T.parseTime("7.30"), { h: 7, mi: 30 });
  assert.deepEqual(T.parseTime("0730"), { h: 7, mi: 30 });
  assert.deepEqual(T.parseTime("16 Uhr"), { h: 16, mi: 0 });
  assert.equal(T.parseTime("25:00"), null);
  assert.equal(T.parseMonth("Jänner 2027", "2026-11-04"), "2027-01");
  assert.equal(T.parseMonth("letzter", "2026-01-04"), "2025-12");
});

test("Update 9 – Kalender: termin_anlegen mit Wiederholung, Ort, Endzeit, mehreren Erinnerungen; planer_lesen klappt Serien auf", async () => {
  const t = await seeded();
  let r = await t.tool("termin_anlegen", { titel: "Fußballtraining", datum: "02.11.2026", uhrzeit: "18:30", bis: "20:00", ort: "Sportplatz Wels",
    wiederholung: "wöchentlich", wiederholen_bis: "30.11.2026", erinnerungen: [15, 120], kalender: "privat" });
  assert.match(r.text, /Termin angelegt: „Fußballtraining“ am Mo, 02\.11\.2026 um 18:30, Erinnerungen 15, 120 min vorher · bis 20:00 · Ort: Sportplatz Wels · Wöchentlich am Montag, bis 30\.11\.2026/);
  r = await t.tool("termin_anlegen", { titel: "Urlaub", datum: "05.11.2026", ende_datum: "07.11.2026", ganztags: true });
  assert.match(r.text, /ganztägig/);
  r = await t.tool("termin_anlegen", { titel: "X", datum: "05.11.2026", wiederholung: "stündlich" });
  assert.ok(r.isError);
  r = await t.tool("termin_anlegen", { titel: "X", datum: "05.11.2026", kalender: "Gibtsnicht" });
  assert.ok(r.isError);
  const docs = t.g.list(`${t.base}/todos`);
  const ft = docs.find((x) => x.title === "Fußballtraining");
  assert.deepEqual([ft.rrule, ft.endTime, ft.location, ft.reminders, ft.remind, ft.remindMin, ft.calendarId],
    ["FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130", "20:00", "Sportplatz Wels", [15, 120], true, 15, "privat"]);
  for (const x of docs) assert.deepEqual({ ...L.normTodo(x, x.id), id: x.id }, { ...x }, "Dokument ist normalisiert");
  t.g.set(`${t.base}/todos/bd1`, { kind: "geburtstag", title: "Oma", bday: "11-10", byear: 1950, time: "09:00", remind: true, remindDays: 1, date: null, done: false, createdAt: 1 });
  r = await t.tool("planer_lesen", { von: "04.11.2026", bis: "17.11.2026" });
  assert.match(r.text, /Do, 05\.11\.2026\n  Berufsschule\n  \[ \] ganztägig Termin: Urlaub \(05\.11\.2026 – 07\.11\.2026\)/);
  assert.match(r.text, /Fr, 06\.11\.2026\n  \[ \] ganztägig Termin: Urlaub/);
  assert.match(r.text, /Mo, 09\.11\.2026\n  \[ \] 18:30 Termin: Fußballtraining–20:00 \(Serie\) · Sportplatz Wels/);
  assert.match(r.text, /Mo, 16\.11\.2026\n  \[ \] 18:30 Termin: Fußballtraining/);
  assert.match(r.text, /Di, 10\.11\.2026\n  🎂 Geburtstag: Oma/);
  assert.ok(!/Offen ohne Datum:[\s\S]*Oma/.test(r.text), "Geburtstag nicht unter „ohne Datum“");
  r = await t.tool("todos_lesen");
  assert.match(r.text, /Fußballtraining – Termin · Mo, 09\.11\.2026 18:30 · Wöchentlich am Montag, bis 30\.11\.2026 – nächster Mo, 09\.11\.2026 18:30 · Ort: Sportplatz Wels · Erinnerungen 15, 120 min vorher/);
});
