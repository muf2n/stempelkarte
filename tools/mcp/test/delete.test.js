// Sicheres Löschen: loeschen_vorschlagen → loeschen_bestaetigen → Papierkorb (a_trash) → rueckgaengig.
process.env.TZ = "Europe/Vienna";
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";
import { rangeOf, resolveWas } from "../src/delete.js";
import { restoreDoc, groupBatches } from "../src/trash.js";

const NOW = vt(2026, 11, 4, 10, 0); // Mi 04.11.2026 10:00
const codeOf = (text) => { const m = /bestaetigungs_code: ([A-Z0-9]{6})/.exec(text); assert.ok(m, "Code in: " + text); return m[1]; };

async function seeded() {
  const t = await setup({ now: NOW });
  const b = t.base;
  t.g.set(`${b}/meta/settings`, { weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5], school: { days: [4], blocks: [{ id: "b1", from: "2026-12-01", to: "2026-12-11", label: "Block" }] } });
  t.g.set(`${b}/meta/state`, { running: null, rev: 1 });
  t.g.set(`${b}/todos/t1`, { kind: "termin", title: "Weihnachtsfeier Firma", date: "2026-12-18", time: "18:00", done: false, createdAt: 1 });
  t.g.set(`${b}/todos/t2`, { kind: "termin", title: "Zahnarzt", date: "2026-12-03", time: "08:00", location: "Dr. Huber", done: false, createdAt: 2 });
  t.g.set(`${b}/todos/t3`, { kind: "termin", title: "Zahnarzt Kontrolle", date: "2027-01-15", time: "09:00", done: false, createdAt: 3 });
  t.g.set(`${b}/todos/t4`, { kind: "todo", title: "Kabel bestellen", date: null, done: false, createdAt: 4 });
  t.g.set(`${b}/todos/s1`, { kind: "termin", title: "Fußballtraining", date: "2026-11-02", time: "18:00", rrule: "FREQ=WEEKLY;BYDAY=MO", done: false, createdAt: 5 });
  t.g.set(`${b}/a_vault_items/v1`, { id: "v1", title: "Bank", enc: "xxx" });
  t.g.set(`${b}/a_money_tx/m1`, { id: "m1", date: "2026-11-02", amount: 12.5, type: "out", category: "essen", note: "Billa Jause" });
  t.g.set(`${b}/a_money_tx/m2`, { id: "m2", date: "2026-11-03", amount: 40, type: "out", category: "auto", note: "OMV tanken" });
  return t;
}

test("Hilfen: Zeiträume auf Österreichisch, verbotene Arten", () => {
  const today = "2026-11-04";
  assert.deepEqual(rangeOf("im Dezember", today), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(rangeOf("am 24.12.", today), { from: "2026-12-24", to: "2026-12-24" });
  assert.deepEqual(rangeOf("nächste Woche", today), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(rangeOf("diese Woche", today), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(rangeOf("2026-11-20", today), { from: "2026-11-20", to: "2026-11-20" });
  assert.deepEqual(rangeOf("Februar 2027", today), { from: "2027-02-01", to: "2027-02-28" });
  assert.equal(rangeOf("", today), null);
  assert.throws(() => rangeOf("irgendwann bald", today), /verstehe ich nicht/);
  assert.deepEqual(resolveWas("Urlaub"), { type: "eintrag", art: "urlaub" });
  assert.deepEqual(resolveWas("Termine"), { type: "termin", art: null });
  assert.throws(() => resolveWas("Passwörter"), /Tresor/);
  assert.throws(() => resolveWas("Fotos"), /Fotos kann ich nicht/);
  assert.throws(() => resolveWas("Einstellungen"), /Einstellungen kann ich nicht/);
  assert.throws(() => resolveWas("laufende Schicht"), /ausstempeln/);
});

test("Vorschlag → Bestätigung: Liste, Code, Papierkorb-Kopie, Vorschlag wird verbraucht", async () => {
  const t = await seeded();
  const b = t.base;
  // Serie im Dezember → erst nachfragen (kein Code)
  let r = await t.tool("loeschen_vorschlagen", { was: "termin", von: "im Dezember" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Serientermine gefunden/);
  assert.match(r.text, /Außerdem passen 2 weitere Elemente/);
  assert.ok(!/bestaetigungs_code/.test(r.text));
  r = await t.tool("loeschen_vorschlagen", { was: "termin", von: "im Dezember", serie: "ganz" });
  assert.match(r.text, /3 Elemente zum Löschen \(noch NICHT gelöscht\)/);
  assert.match(r.text, /1\. ab Mo, 02\.11\.2026 · Termin-Serie \(ganz\) · „Fußballtraining“/);
  assert.match(r.text, /2\. Do, 03\.12\.2026 08:00 · Termin · „Zahnarzt“/);
  assert.match(r.text, /3\. Fr, 18\.12\.2026 18:00 · Termin · „Weihnachtsfeier Firma“/);
  assert.match(r.text, /Soll ich diese 3 löschen\?/);
  assert.ok(t.g.get(`${b}/todos/t1`), "noch nichts gelöscht");
  r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "zahnarzt" });
  assert.match(r.text, /2 Elemente/);
  assert.match(r.text, /Zahnarzt Kontrolle/);
  const code = codeOf(r.text);
  const pend = t.g.get(`${b}/meta/ai_pending_delete`);
  assert.equal(pend.code, code);
  assert.equal(pend.expires, NOW + 600000);
  assert.deepEqual(pend.ops.map((o) => o.path).sort(), ["todos/t2", "todos/t3"]);
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: code.toLowerCase() });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Gelöscht: 2 Elemente/);
  assert.match(r.text, /Papierkorb/);
  assert.equal(t.g.get(`${b}/todos/t2`), null);
  assert.equal(t.g.get(`${b}/todos/t3`), null);
  assert.ok(t.g.get(`${b}/todos/t1`), "Weihnachtsfeier bleibt");
  assert.equal(t.g.get(`${b}/meta/ai_pending_delete`), null, "Vorschlag verbraucht");
  const trash = t.g.list(`${b}/a_trash`);
  assert.equal(trash.length, 2);
  const z = trash.find((x) => x.path === "todos/t2");
  assert.equal(z.by, "claude");
  assert.equal(z.deletedAt, NOW);
  assert.equal(z.op, "delete");
  assert.equal(z.data.title, "Zahnarzt");
  assert.equal(z.data.location, "Dr. Huber");
  assert.ok(z.batchId && trash.every((x) => x.batchId === z.batchId));
  // derselbe Code ein zweites Mal → kein Vorschlag mehr
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: code });
  assert.equal(r.isError, true);
  assert.match(r.text, /keinen offenen Löschvorschlag/);
});

test("Bestätigung: ohne Vorschlag, falscher Code, abgelaufener Code", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: "ABCDEF" });
  assert.equal(r.isError, true);
  assert.match(r.text, /keinen offenen Löschvorschlag/);
  r = await t.tool("loeschen_vorschlagen", { was: "ausgabe", suche: "Billa" });
  const code = codeOf(r.text);
  assert.match(r.text, /Ausgabe 12,50 €/);
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ" });
  assert.equal(r.isError, true);
  assert.match(r.text, /passt nicht/);
  assert.ok(t.g.get(`${b}/a_money_tx/m1`), "falscher Code löscht nichts");
  t.setNow(NOW + 11 * 60000);
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: code });
  assert.equal(r.isError, true);
  assert.match(r.text, /abgelaufen/);
  assert.ok(t.g.get(`${b}/a_money_tx/m1`), "abgelaufener Code löscht nichts");
  assert.equal(t.g.get(`${b}/meta/ai_pending_delete`), null, "abgelaufener Vorschlag wird verworfen");
  assert.equal(t.g.list(`${b}/a_trash`).length, 0);
});

test("rueckgaengig: letzte Löschung bzw. bestimmter Stapel wiederherstellen", async () => {
  const t = await seeded();
  const b = t.base;
  const before = t.g.get(`${b}/a_money_tx/m2`);
  let r = await t.tool("loeschen_vorschlagen", { was: "ausgabe", suche: "Billa" });
  await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  t.setNow(NOW + 60000);
  r = await t.tool("loeschen_vorschlagen", { was: "buchung", suche: "OMV" });
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  const firstBatch = t.g.list(`${b}/a_trash`).find((x) => x.path === "a_money_tx/m1").batchId;
  assert.equal(t.g.get(`${b}/a_money_tx/m1`), null);
  assert.equal(t.g.get(`${b}/a_money_tx/m2`), null);
  r = await t.tool("rueckgaengig", {});
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Wiederhergestellt: 1 Element/);
  assert.match(r.text, /OMV/);
  assert.deepEqual(t.g.get(`${b}/a_money_tx/m2`), before, "unverändert zurück");
  assert.equal(t.g.get(`${b}/a_money_tx/m1`), null, "ältere Löschung bleibt gelöscht");
  r = await t.tool("rueckgaengig", { batch: "gibtsnicht" });
  assert.equal(r.isError, true);
  r = await t.tool("rueckgaengig", { batch: firstBatch });
  assert.match(r.text, /Billa/);
  assert.ok(t.g.get(`${b}/a_money_tx/m1`));
  assert.equal(t.g.list(`${b}/a_trash`).length, 0, "Papierkorb leer");
  r = await t.tool("rueckgaengig", {});
  assert.match(r.text, /liegt nichts/);
});

test("Papierkorb: älter als 30 Tage wird beim nächsten Zugriff entfernt", async () => {
  const t = await seeded();
  const b = t.base;
  t.g.set(`${b}/a_trash/old-0`, { path: "todos/x", data: { title: "alt" }, op: "delete", deletedAt: NOW - 31 * 86400000, by: "claude", batchId: "old" });
  t.g.set(`${b}/a_trash/new-0`, { path: "todos/y", data: { kind: "todo", title: "neu" }, op: "delete", deletedAt: NOW - 2 * 86400000, by: "claude", batchId: "new" });
  const r = await t.tool("rueckgaengig", {});
  assert.match(r.text, /Wiederhergestellt: 1 Element/);
  assert.equal(t.g.get(`${b}/a_trash/old-0`), null, "abgelaufen → weg");
  assert.equal(t.g.get(`${b}/todos/x`), null, "abgelaufenes wird nicht wiederhergestellt");
  assert.equal(t.g.get(`${b}/todos/y`).title, "neu");
});

test("Serientermin: erst nachfragen, dann nur am Datum (EXDATE wie cal-core) oder ganze Serie; rueckgaengig entfernt die Ausnahme", async () => {
  const t = await seeded();
  const b = t.base;
  let r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "Fußball", von: "07.12.2026" });
  assert.equal(r.isError, false);
  assert.match(r.text, /Serientermine gefunden – noch nichts vorgemerkt/);
  assert.match(r.text, /Ganze Serie löschen oder nur am Datum/);
  assert.match(r.text, /07\.12\.2026/);
  assert.ok(!/bestaetigungs_code/.test(r.text), "ohne Entscheidung kein Code");
  assert.equal(t.g.get(`${b}/meta/ai_pending_delete`), null);
  r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "Fußball", von: "07.12.2026", serie: "nur_datum" });
  assert.match(r.text, /1\. Mo, 07\.12\.2026 18:00 · Termin \(nur diese Wiederholung\) · „Fußballtraining“/);
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.match(r.text, /Gelöscht: 1 Element/);
  let s1 = t.g.get(`${b}/todos/s1`);
  assert.deepEqual(s1.exdates, ["2026-12-07"]);
  assert.equal(s1.rrule, "FREQ=WEEKLY;BYDAY=MO");
  assert.equal(s1.title, "Fußballtraining");
  const tr = t.g.list(`${b}/a_trash`)[0];
  assert.equal(tr.op, "exdate");
  assert.equal(tr.date, "2026-12-07");
  // planer_lesen zeigt den 07.12. nicht mehr, den 14.12. schon
  r = await t.tool("planer_lesen", { von: "07.12.2026", bis: "14.12.2026" });
  assert.ok(!/Mo, 07\.12\.2026[^\n]*\n[^\n]*Fußball/.test(r.text));
  assert.match(r.text, /Mo, 14\.12\.2026[\s\S]*Fußballtraining/);
  // zweite Ausnahme dazu, dann die letzte Löschung rückgängig → nur 14.12. wieder da
  t.setNow(NOW + 1000);
  r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "Fußball", von: "14.12.2026", serie: "nur_datum" });
  await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.deepEqual(t.g.get(`${b}/todos/s1`).exdates, ["2026-12-07", "2026-12-14"]);
  r = await t.tool("rueckgaengig", {});
  assert.match(r.text, /Wiederhergestellt: 1 Element/);
  s1 = t.g.get(`${b}/todos/s1`);
  assert.deepEqual(s1.exdates, ["2026-12-07"], "nur die letzte Ausnahme ist zurück");
  // ganze Serie
  r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "Fußball", serie: "ganz" });
  assert.match(r.text, /Termin-Serie \(ganz\) · „Fußballtraining“/);
  await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.equal(t.g.get(`${b}/todos/s1`), null);
  r = await t.tool("loeschen_vorschlagen", { was: "termin", suche: "Fußball", von: "07.12.2026", serie: "nur_datum" });
  assert.match(r.text, /Nichts Passendes/);
});

test("Einträge: Schul-Einträge außerhalb der Schulblöcke, laufende Schicht nie", async () => {
  const t = await seeded();
  const b = t.base;
  // Do = wöchentlicher Schultag; 01.–11.12. Block
  t.g.set(`${b}/entries/s_in_block`, { kind: "schule", start: vt(2026, 12, 2), end: vt(2026, 12, 2), pauseMin: 0, creditMin: 462 });
  t.g.set(`${b}/entries/s_thu`, { kind: "schule", start: vt(2026, 11, 5), end: vt(2026, 11, 5), pauseMin: 0, creditMin: 462 });
  t.g.set(`${b}/entries/s_out1`, { kind: "schule", start: vt(2026, 11, 16), end: vt(2026, 11, 16), pauseMin: 0, creditMin: 462 });
  t.g.set(`${b}/entries/s_out2`, { kind: "schule", start: vt(2026, 12, 14), end: vt(2026, 12, 14), pauseMin: 0, creditMin: 462, note: "falsch" });
  t.g.set(`${b}/entries/w1`, { kind: "work", start: vt(2026, 11, 16, 7), end: vt(2026, 11, 16, 15), pauseMin: 30, place: "Baustelle Huber", note: "Kabel" });
  let r = await t.tool("loeschen_vorschlagen", { was: "eintrag", nur_ausserhalb_schulblock: true });
  assert.match(r.text, /2 Elemente/);
  assert.match(r.text, /1\. Mo, 16\.11\.2026 · Schule/);
  assert.match(r.text, /2\. Mo, 14\.12\.2026 · Schule · „falsch“/);
  assert.ok(!/Arbeit/.test(r.text));
  await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  assert.equal(t.g.get(`${b}/entries/s_out1`), null);
  assert.equal(t.g.get(`${b}/entries/s_out2`), null);
  assert.ok(t.g.get(`${b}/entries/s_in_block`) && t.g.get(`${b}/entries/s_thu`) && t.g.get(`${b}/entries/w1`));
  r = await t.tool("loeschen_vorschlagen", { was: "termin", nur_ausserhalb_schulblock: true });
  assert.equal(r.isError, true);
  // laufende Schicht: nicht in der Liste, Hinweis
  t.g.set(`${b}/meta/state`, { running: { start: vt(2026, 11, 4, 7), segments: [{ start: vt(2026, 11, 4, 7), activity: "Arbeiten" }], pauseMs: 0, pauseStart: null }, rev: 5 });
  r = await t.tool("loeschen_vorschlagen", { was: "eintrag", von: "heute" });
  assert.equal(r.isError, true);
  assert.match(r.text, /laufende Schicht \(seit 07:00 Uhr\)[^\n]*ausstempeln/);
  r = await t.tool("loeschen_vorschlagen", { was: "eintrag", suche: "Kabel" });
  assert.match(r.text, /Mo, 16\.11\.2026 · Arbeit 07:00–15:00 · Baustelle Huber · „Kabel“/);
  assert.match(r.text, /laufende Schicht/);
  assert.equal(t.g.get(`${b}/meta/ai_pending_delete`).ops.length, 1);
});

test("Verboten/zu ungenau: Tresor, Fotos, Einstellungen, alles; Bestätigung löscht nur erlaubte Pfade", async () => {
  const t = await seeded();
  const b = t.base;
  for (const was of ["passwort", "Tresor", "foto", "Galerie", "einstellungen"]) {
    const r = await t.tool("loeschen_vorschlagen", { was, suche: "Bank" });
    assert.equal(r.isError, true, was);
    assert.match(r.text, /kann ich nicht/);
  }
  let r = await t.tool("loeschen_vorschlagen", { was: "termin" });
  assert.equal(r.isError, true);
  assert.match(r.text, /zu ungenau/);
  r = await t.tool("loeschen_vorschlagen", { was: "zeugs", suche: "x" });
  assert.match(r.text, /Möglich: termin/);
  // manipulierter Vorschlag mit Tresor-/Einstellungs-Pfad → wird ignoriert
  t.g.set(`${b}/meta/ai_pending_delete`, { code: "ABCDEF", created: NOW, expires: NOW + 60000, count: 3, ops: [
    { op: "delete", path: "a_vault_items/v1" }, { op: "delete", path: "../meta/settings" }, { op: "delete", path: "meta/settings" },
  ] });
  r = await t.tool("loeschen_bestaetigen", { bestaetigungs_code: "ABCDEF" });
  assert.match(r.text, /Nichts gelöscht/);
  assert.ok(t.g.get(`${b}/a_vault_items/v1`));
  assert.ok(t.g.get(`${b}/meta/settings`));
  // zu viele
  for (let i = 0; i < 201; i++) t.g.set(`${b}/a_money_tx/x${i}`, { id: `x${i}`, date: "2026-10-10", amount: 1, type: "out", note: "Kaugummi" });
  r = await t.tool("loeschen_vorschlagen", { was: "ausgabe", von: "10.10.2026" });
  assert.equal(r.isError, true);
  assert.match(r.text, /201 Elemente – höchstens 200/);
});

test("Packliste (einzelne Gegenstände), Orte (Hinweis), Material – löschen und wiederherstellen", async () => {
  const t = await seeded();
  const b = t.base;
  t.g.set(`${b}/a_travel_packing/l1`, { id: "l1", kind: "trip", title: "Kroatien", cats: [{ id: "c1", name: "Bad", items: [{ id: "i1", name: "Sonnencreme", qty: 1, done: false }, { id: "i2", name: "Handtuch", qty: 2, done: false }] }] });
  t.g.set(`${b}/places/p1`, { name: "Baustelle Huber", addr: "Hauptstraße 1" });
  t.g.set(`${b}/a_material_items/mt1`, { id: "mt1", name: "NYM-J 3×1,5", qty: 25, unit: "m", status: "verbaut", place: "Baustelle Huber", dayKey: "2026-11-02" });
  let r = await t.tool("loeschen_vorschlagen", { was: "packliste", suche: "Sonnencreme", liste: "kroatien" });
  assert.match(r.text, /Packliste „Kroatien“ · Sonnencreme/);
  await t.tool("loeschen_bestaetigen", { bestaetigungs_code: codeOf(r.text) });
  let l = t.g.get(`${b}/a_travel_packing/l1`);
  assert.deepEqual(l.cats[0].items.map((x) => x.id), ["i2"]);
  // Nutzer hakt danach etwas ab → rueckgaengig behält das
  l.cats[0].items[0].done = true;
  t.g.set(`${b}/a_travel_packing/l1`, l);
  await t.tool("rueckgaengig", {});
  l = t.g.get(`${b}/a_travel_packing/l1`);
  assert.deepEqual(l.cats[0].items.map((x) => [x.id, x.done]), [["i1", false], ["i2", true]]);
  r = await t.tool("loeschen_vorschlagen", { was: "orte", suche: "huber" });
  assert.match(r.text, /Ort · „Baustelle Huber“ · Hauptstraße 1/);
  assert.match(r.text, /behalten den Ortsnamen als Text/);
  r = await t.tool("loeschen_vorschlagen", { was: "material", von: "02.11.2026" });
  assert.match(r.text, /Mo, 02\.11\.2026 · Material · 25 m NYM-J 3×1,5 · Baustelle Huber/);
});

test("trash-core: restoreDoc und groupBatches", () => {
  assert.deepEqual(restoreDoc({ path: "todos/a", op: "delete", data: { title: "x" } }, null), { data: { title: "x" } });
  assert.ok(restoreDoc({ path: "todos/a", op: "delete", data: { title: "x" } }, { title: "neu" }).skip);
  assert.ok(restoreDoc({ path: "a_vault_items/v", op: "delete", data: {} }, null).skip, "Tresor nie");
  assert.deepEqual(restoreDoc({ path: "todos/s", op: "exdate", date: "2026-12-07", data: { rrule: "X" } }, { rrule: "X", exdates: ["2026-12-07"] }).data, { rrule: "X", exdates: [] });
  const g = groupBatches([{ batchId: "a", deletedAt: 1, label: "x" }, { batchId: "b", deletedAt: 5 }, { batchId: "a", deletedAt: 2 }]);
  assert.deepEqual(g.map((x) => [x.batchId, x.items.length, x.deletedAt]), [["b", 1, 5], ["a", 2, 2]]);
});
