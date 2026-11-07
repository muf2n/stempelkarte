// node --test test/werkzeug-core.test.mjs
// Werkzeug-Register: Intervalle/Fälligkeit, Ausgabe/Rückgabe, Defekt, Standort, Filter, QR-Adresse/Scan, dueTools.
import test from "node:test";
import assert from "node:assert/strict";
import * as W from "../js/alltag/werkzeug-core.js";

const NOW = new Date(2026, 10, 7, 12).getTime(); // 07.11.2026
const T = "2026-11-07";

test("addMonths kürzt aufs Monatsende, daysBetween ganze Tage", () => {
  assert.equal(W.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(W.addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(W.addMonths("2026-11-15", 12), "2027-11-15");
  assert.equal(W.addMonths("2026-03-10", -3), "2025-12-10");
  assert.equal(W.addMonths("kaputt", 1), null);
  assert.equal(W.daysBetween("2026-03-28", "2026-03-30"), 2); // über die Zeitumstellung
  assert.equal(W.daysBetween("2026-11-07", "2026-11-01"), -6);
});

test("normTool: Standardwerte, unbekannte Kategorie → Sonstiges, Intervall begrenzt", () => {
  const t = W.normTool({ id: "a", name: " Duspol ", cat: "xyz", checkMonths: "500", loc: { kind: "mond" } });
  assert.equal(t.name, "Duspol");
  assert.equal(t.cat, "sonst");
  assert.equal(t.checkMonths, 0);
  assert.equal(t.loc.kind, "firma");
  assert.deepEqual(t.history, []);
  assert.equal(W.catById("mess").e, "📟");
});

test("checkStatus: keins, Datum fehlt, ok, bald, überfällig, manueller Termin", () => {
  assert.equal(W.checkStatus({ name: "Hammer" }, T).state, "none");
  assert.equal(W.checkStatus({ checkMonths: 12 }, T).state, "nie");
  const ok = W.checkStatus({ checkMonths: 12, lastCheck: "2026-05-01" }, T);
  assert.equal(ok.state, "ok"); assert.equal(ok.due, "2027-05-01");
  const soon = W.checkStatus({ checkMonths: 12, lastCheck: "2025-11-20" }, T);
  assert.equal(soon.state, "bald"); assert.equal(soon.days, 13); assert.match(soon.label, /in 13 Tagen/);
  const over = W.checkStatus({ checkMonths: 6, lastCheck: "2026-04-01" }, T);
  assert.equal(over.state, "ueber"); assert.match(over.label, /seit 37 Tagen überfällig/);
  assert.equal(W.checkStatus({ checkMonths: 12, lastCheck: "2020-01-01", nextCheck: "2026-11-07" }, T).label, "heute fällig");
});

test("Ausgabe/Rückgabe, Defekt, Prüfung → Verlauf", () => {
  let t = W.normTool({ id: "t1", name: "Akkuschrauber" });
  assert.throws(() => W.lend(t, " "), /An wen/);
  t = W.lend(t, "Max Muster", 1000, "für Baustelle");
  assert.equal(t.holder, "Max Muster");
  assert.equal(W.toolState(t).id, "aus");
  t = W.giveBack(t, 2000);
  assert.equal(t.holder, "");
  assert.deepEqual(t.history.map((h) => [h.op, h.who]), [["aus", "Max Muster"], ["rueck", "Max Muster"]]);
  t = W.reportDefect(t, "Akku lädt nicht", 3000);
  assert.equal(W.toolState(t).id, "defekt");
  assert.equal(t.defectNote, "Akku lädt nicht");
  t = W.repaired(t, 4000);
  assert.equal(t.defect, false);
  t = W.markChecked({ ...t, checkMonths: 12, nextCheck: "2026-01-01" }, "2026-11-01", 5000);
  assert.equal(t.nextCheck, null);
  assert.equal(W.nextDue(t), "2027-11-01");
  assert.equal(W.histText(t.history.at(-1)), "✅ Geprüft am 01.11.2026");
  assert.throws(() => W.markChecked(t, "gestern"), /Prüfdatum/);
});

test("locLabel: Firma, Auto, Baustelle, woanders", () => {
  const places = [{ id: "p1", name: "Baustelle Muster" }];
  const vehicles = [{ id: "v1", name: "Caddy", plate: "XX-123AB" }];
  assert.equal(W.locLabel({ loc: { kind: "firma" } }), "🏢 Firma / Lager");
  assert.equal(W.locLabel({ loc: { kind: "firma", text: "Regal 3" } }), "🏢 Firma / Lager · Regal 3");
  assert.equal(W.locLabel({ loc: { kind: "auto", vehicleId: "v1" } }, places, vehicles), "🚐 Caddy (XX-123AB)");
  assert.equal(W.locLabel({ loc: { kind: "baustelle", placeId: "p1" } }, places, vehicles), "🏗️ Baustelle Muster");
  assert.equal(W.locLabel({ loc: { kind: "sonst", text: "Keller" } }), "📦 Keller");
});

test("filterTools/counts: Ansichten, Suche ohne Akzente, Sortierung defekt > überfällig", () => {
  const tools = [
    { id: "a", name: "Zange", cat: "hand" },
    { id: "b", name: "Leiter 3 m", cat: "leiter", checkMonths: 12, lastCheck: "2025-10-01" },
    { id: "c", name: "Prüfgerät", brand: "Testmarke X1", cat: "mess", checkMonths: 12, lastCheck: "2025-11-20" },
    { id: "d", name: "Flex", cat: "akku", holder: "Anna", defect: true },
    { id: "", name: "ohne id" },
  ];
  assert.deepEqual(W.filterTools(tools, {}, T).map((t) => t.id), ["d", "b", "c", "a"]);
  assert.deepEqual(W.filterTools(tools, { view: "faellig" }, T).map((t) => t.id), ["b", "c"]);
  assert.deepEqual(W.filterTools(tools, { view: "aus" }, T).map((t) => t.id), ["d"]);
  assert.deepEqual(W.filterTools(tools, { q: "prufgerat x1" }, T).map((t) => t.id), ["c"]);
  assert.deepEqual(W.filterTools(tools, { cat: "hand" }, T).map((t) => t.id), ["a"]);
  assert.deepEqual(W.counts(tools, T), { alle: 4, faellig: 2, aus: 1, defekt: 1 });
});

test("dueTools: nur bald/überfällig, überfällige zuerst, mit Hash", () => {
  const d = W.dueTools([
    { id: "c", name: "Prüfgerät", cat: "mess", checkMonths: 12, lastCheck: "2025-11-20" },
    { id: "b", name: "Leiter", cat: "leiter", checkMonths: 12, lastCheck: "2025-10-01" },
    { id: "x", name: "Ok", cat: "mess", checkMonths: 12, lastCheck: "2026-10-01" },
    { id: "n", name: "Nie", cat: "mess", checkMonths: 12 },
  ], NOW);
  assert.deepEqual(d.map((x) => [x.id, x.state]), [["b", "ueber"], ["c", "bald"]]);
  assert.equal(d[0].hash, "#alltag/werkzeug/b");
  assert.match(d[1].text, /📟 Prüfgerät: Kalibrierung in 13 Tagen fällig/);
});

test("QR-Adresse, Scan-Text und Route", () => {
  assert.equal(W.toolUrl("https://example.test/app/?x=1#heute", "ab12"), "https://example.test/app/#alltag/werkzeug/ab12");
  assert.equal(W.parseToolRef("https://example.test/app/#alltag/werkzeug/ab12"), "ab12");
  assert.equal(W.parseToolRef("mr4x9k2abc"), "mr4x9k2abc");
  assert.equal(W.parseToolRef("Hallo Welt!"), null);
  assert.equal(W.parseToolRef(""), null);
  assert.equal(W.routeId("#alltag/werkzeug"), "");
  assert.equal(W.routeId("#alltag/werkzeug/ab12"), "ab12");
  assert.equal(W.routeId("#alltag/geld"), null);
});
