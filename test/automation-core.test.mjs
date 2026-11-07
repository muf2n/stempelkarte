// node --test test/automation-core.test.mjs – ⚡ Automationszentrum: Regeln, Bedingungen, jeder Auslöser, Duplikat-Schutz, Tageslimit.
import test from "node:test";
import assert from "node:assert/strict";
import * as A from "../js/automation-core.js";

// Freitag, 06.11.2026, 15:00 Ortszeit
const NOW = new Date(2026, 10, 6, 15, 0).getTime();
const at = (d, h = 8, m = 0, mo = 10) => new Date(2026, mo, d, h, m).getTime();
const ENABLED = at(1, 0); // Regeln seit 01.11. aktiv

const rule = (trigger, actions = [{ type: "hint", text: "Hallo {name}" }], extra = {}) => ({ id: "r1", name: "Test", enabled: true, enabledAt: ENABLED, trigger, actions, ...extra });
const S = (extra = {}) => ({ now: NOW, running: null, entries: [], todos: [], places: [{ id: "p1", name: "Baustelle Nord" }, { id: "p2", name: "Firma" }], privat: false, moneyLocked: false, cols: {}, ...extra });
const run = (r, st, hist) => A.plan([r], st, hist || { seen: new Set(), today: new Map() });

test("normRule: Standardwerte, unbekannte Typen fliegen raus, Aktion passt zum Auslöser", () => {
  const r = A.normRule({ trigger: { type: "nope" }, actions: [{ type: "einkauf" }, { type: "hint", text: "x" }, { type: "boom" }], conds: [{ type: "weekday", days: [] }, { type: "time", from: "25:00" }] });
  assert.equal(r.trigger.type, "clock_in");
  assert.deepEqual(r.actions.map((a) => a.type), ["hint"]); // einkauf nur mit „Material fehlt“
  assert.deepEqual(r.conds, [{ type: "time", from: "06:00", to: "18:00" }]);
  assert.equal(r.maxPerDay, A.DEFAULT_MAX_PER_DAY);
  assert.equal(r.enabled, true);
  assert.equal(A.normRule({ trigger: { type: "material" }, actions: [{ type: "einkauf" }] }).actions.length, 1);
  assert.equal(A.normRule({ maxPerDay: 999 }).maxPerDay, A.MAX_PER_DAY_LIMIT);
});

test("validateRule meldet fehlende Aktionen/Texte", () => {
  assert.ok(A.validateRule({ trigger: { type: "clock_in" }, actions: [] }).length);
  assert.ok(A.validateRule({ trigger: { type: "clock_in" }, actions: [{ type: "hint", text: "" }] }).length);
  assert.ok(A.validateRule({ trigger: { type: "clock_in" }, actions: [{ type: "mode", mode: "privat" }], conds: [{ type: "place", placeId: "" }] }).length);
  assert.deepEqual(A.validateRule({ trigger: { type: "clock_in" }, actions: [{ type: "mode", mode: "privat" }] }), []);
});

test("Auslöser Arbeitsbeginn: nur frisch und nur nach dem Einschalten", () => {
  const r = rule({ type: "clock_in" });
  assert.equal(run(r, S({ running: { start: NOW - 3600e3, placeId: "p1" } })).length, 1);
  assert.equal(run(r, S({ running: { start: NOW - 5 * 3600e3 } })).length, 0, "zu lange her");
  assert.equal(run({ ...r, enabledAt: NOW - 600e3 }, S({ running: { start: NOW - 3600e3 } })).length, 0, "vor dem Einschalten");
  const [x] = run(r, S({ running: { start: NOW - 60e3, placeId: "p1" } }));
  assert.equal(x.data.place, "Baustelle Nord");
});

test("Auslöser Arbeitsende: letzte Schicht mit Ende, nicht während eingestempelt", () => {
  const r = rule({ type: "clock_out" });
  const entries = [{ id: "e1", start: at(6, 7), end: at(6, 14, 30) }, { id: "e0", start: at(5, 7), end: at(5, 15) }];
  const out = run(r, S({ entries }));
  assert.equal(out.length, 1);
  assert.equal(out[0].occ, "out:e1");
  assert.equal(run(r, S({ entries, running: { start: NOW - 60e3 } })).length, 0);
  assert.equal(run(r, S({ entries: [{ id: "u", kind: "urlaub", start: at(6, 7), end: at(6, 14) }] })).length, 0, "Urlaub ist keine Schicht");
});

test("Auslöser Baustelle erkannt: jeder Ort oder ein bestimmter, auch über Segmente", () => {
  const running = { start: NOW - 7200e3, placeId: "p2", segments: [{ start: NOW - 7200e3, placeId: "p2" }, { start: NOW - 600e3, placeId: "p1", place: "Baustelle Nord" }] };
  assert.equal(run(rule({ type: "site" }), S({ running })).length, 2);
  const only = run(rule({ type: "site", placeId: "p1" }), S({ running }));
  assert.equal(only.length, 1);
  assert.equal(only[0].data.placeId, "p1");
  assert.equal(run(rule({ type: "site" }), S({ running: { start: NOW - 60e3 } })).length, 0, "ohne Ort kein Anlass");
});

test("Auslöser Termin in X Minuten/Stunden", () => {
  const todos = [{ id: "t1", kind: "termin", title: "Kundentermin", date: "2026-11-06", time: "15:20" }, { id: "t2", kind: "termin", title: "Später", date: "2026-11-06", time: "18:00" }];
  const m = run(rule({ type: "termin", amount: 30, unit: "min" }), S({ todos }));
  assert.deepEqual(m.map((x) => x.data.name), ["Kundentermin"]);
  const h = run(rule({ type: "termin", amount: 4, unit: "h" }), S({ todos }));
  assert.equal(h.length, 2);
  assert.equal(run(rule({ type: "termin", amount: 10, unit: "min" }), S({ todos })).length, 0);
});

test("Auslöser Aufgabe überfällig (nur offene, 14 Tage)", () => {
  const todos = [
    { id: "a", kind: "todo", title: "Rechnung", date: "2026-11-05" },
    { id: "b", kind: "todo", title: "Erledigt", date: "2026-11-04", done: true },
    { id: "c", kind: "todo", title: "Heute", date: "2026-11-06" },
    { id: "d", kind: "todo", title: "Uralt", date: "2026-09-01" },
  ];
  const out = A.plan([rule({ type: "overdue" }, undefined, { maxPerDay: 10 })], S({ todos }));
  assert.deepEqual(out.map((x) => x.data.name), ["Rechnung"]);
});

test("Auslöser Material fehlt + Aktion Einkaufsliste", () => {
  const r = rule({ type: "material" }, [{ type: "einkauf" }], { maxPerDay: 10 });
  const cols = { material_items: [
    { id: "m1", name: "NYM-J 3x1,5", qty: 50, unit: "m", status: "brauche", updated: at(6, 9), placeId: "p1" },
    { id: "m2", name: "Dose", status: "verbaut", updated: at(6, 9) },
    { id: "m3", name: "Alt", status: "brauche", updated: at(20, 9, 0, 9) },
  ] };
  const out = run(r, S({ cols }));
  assert.equal(out.length, 1);
  const fx = A.effects(out[0], { now: NOW });
  assert.equal(fx[0].kind, "einkauf");
  assert.equal(fx[0].item.listId, "baustelle");
  assert.equal(fx[0].item.name, "NYM-J 3x1,5");
  assert.equal(fx[0].item.note, "🏗️ Baustelle Nord");
});

test("Auslöser Budget: respektiert die Geld-Sperre, Texte ohne Beträge", () => {
  const cols = { money_budget: [{ id: "total", amount: 100 }], money_tx: [{ id: "x", date: "2026-11-03", amount: 95, type: "out", category: "essen" }], money_cats: [] };
  const r = rule({ type: "budget", level: "warn" }, [{ type: "hint", text: "{name} wird knapp" }]);
  const out = run(r, S({ cols }));
  assert.equal(out.length, 1);
  const fx = A.effects(out[0], { now: NOW });
  assert.equal(fx[0].hint.title, "Gesamtbudget wird knapp");
  assert.ok(!/\d+[,.]?\d*\s*€|95|100/.test(JSON.stringify(fx)), "keine Beträge");
  assert.equal(run(r, S({ cols, moneyLocked: true })).length, 0);
  assert.equal(run(rule({ type: "budget", level: "limit" }), S({ cols })).length, 0, "noch nicht aufgebraucht");
});

test("Auslöser Monatsende/-anfang", () => {
  const end = rule({ type: "month_end", days: 0, time: "16:00" });
  assert.equal(run(end, S({ now: at(30, 15) })).length, 0, "vor 16 Uhr");
  assert.equal(run(end, S({ now: at(30, 16, 5) })).length, 1);
  assert.equal(run(end, S({ now: at(29, 17) })).length, 0);
  assert.equal(run(rule({ type: "month_end", days: 2, time: "08:00" }), S({ now: at(28, 9) })).length, 1);
  const st = rule({ type: "month_start", time: "08:00" }, undefined, { enabledAt: at(1, 0) });
  assert.equal(run(st, S({ now: at(1, 9) })).length, 1);
  assert.equal(run(st, S({ now: at(2, 9) })).length, 0);
});

test("Auslöser Wochentag + Uhrzeit (nicht nachträglich am Einschalt-Tag)", () => {
  const r = rule({ type: "weekly", days: [5], time: "12:00" });
  assert.equal(run(r, S()).length, 1); // Freitag 15:00
  assert.equal(run(r, S({ now: at(6, 11) })).length, 0);
  assert.equal(run(r, S({ now: at(5, 13) })).length, 0, "Donnerstag");
  assert.equal(run({ ...r, enabledAt: at(6, 14) }, S()).length, 0, "erst nach 12:00 eingeschaltet");
});

test("Auslöser Prüfung in N Tagen", () => {
  const cols = { school_exams: [{ id: "x1", kind: "Schularbeit", subject: "Mathe", date: "2026-11-12" }, { id: "x2", subject: "Deutsch", date: "2026-11-30" }, { id: "x3", subject: "Alt", date: "2026-11-01" }] };
  const out = run(rule({ type: "exam", days: 7 }, [{ type: "learn", to: "schule" }]), S({ cols }));
  assert.deepEqual(out.map((x) => x.data.name), ["Schularbeit Mathe"]);
  const fx = A.effects(out[0], { now: NOW });
  assert.equal(fx[0].hint.target, "#alltag/schule");
  assert.match(fx[0].hint.title, /Mathe/);
});

test("Auslöser Urlaub beginnt (Urlaubsblock über das Wochenende, Reisen)", () => {
  const entries = [at(9), at(10), at(13), at(16)].map((t, i) => ({ id: "u" + i, kind: "urlaub", start: t, end: t + 8 * 3600e3 }));
  // 9.–10. (Mo/Di), 13. (Fr), 16. (Mo nach Wochenende → gleicher Block wie 13.)
  const starts = A.vacationStarts(entries, [{ id: "tr", title: "Split", from: "2026-11-07" }]);
  assert.deepEqual(starts.map((x) => x.date), ["2026-11-09", "2026-11-13", "2026-11-07"]);
  const out = A.plan([rule({ type: "vacation", days: 1 }, undefined, { maxPerDay: 5 })], S({ entries, cols: { travel_trips: [{ id: "tr", title: "Split", from: "2026-11-07" }] } }));
  assert.deepEqual(out.map((x) => x.data.name), ["Split"]);
  assert.equal(A.plan([rule({ type: "vacation", days: 3 }, undefined, { maxPerDay: 5 })], S({ entries })).length, 1);
});

test("Bedingungen: Wochentag, Uhrzeit-Fenster (auch über Mitternacht), Ort, Modus", () => {
  const running = { start: NOW - 60e3, placeId: "p1" };
  const base = (conds) => run(rule({ type: "clock_in" }, undefined, { conds }), S({ running }));
  assert.equal(base([{ type: "weekday", days: [5] }]).length, 1);
  assert.equal(base([{ type: "weekday", days: [1, 2] }]).length, 0);
  assert.equal(base([{ type: "time", from: "14:00", to: "16:00" }]).length, 1);
  assert.equal(base([{ type: "time", from: "16:00", to: "18:00" }]).length, 0);
  assert.equal(A.condOk({ type: "time", from: "22:00", to: "06:00" }, { now: at(6, 23) }), true);
  assert.equal(A.condOk({ type: "time", from: "22:00", to: "06:00" }, { now: at(6, 12) }), false);
  assert.equal(base([{ type: "place", placeId: "p1" }]).length, 1);
  assert.equal(base([{ type: "place", placeId: "p2" }]).length, 0);
  assert.equal(base([{ type: "mode", mode: "arbeit" }]).length, 1);
  assert.equal(run(rule({ type: "weekly", days: [5], time: "12:00" }, undefined, { conds: [{ type: "mode", mode: "privat" }] }), S({ privat: true })).length, 1);
});

test("Duplikat-Schutz: gleicher Anlass läuft nie zweimal (Verlauf + gemerkte Schlüssel)", () => {
  const r = rule({ type: "clock_in" });
  const st = S({ running: { start: NOW - 60e3 } });
  const [x] = run(r, st);
  const log = [{ id: A.logDocId(x.key), ruleId: "r1", key: x.key, ts: NOW, ok: true }];
  assert.equal(run(r, st, A.buildHistory(log, [r], NOW)).length, 0);
  const r2 = { ...r, ...A.afterRun(r, x.key, NOW) };
  assert.equal(run(r2, st, A.buildHistory([], [r2], NOW)).length, 0, "auch wenn der Verlauf gekürzt wurde");
  assert.equal(A.logDocId(x.key), A.logDocId(x.key), "feste ID");
  assert.notEqual(A.logDocId("a|1"), A.logDocId("a|2"));
  assert.match(A.logDocId(x.key), /^al_[a-z0-9]+$/);
});

test("Tageslimit (maxPerDay) zählt heutige Läufe", () => {
  const todos = ["a", "b", "c", "d"].map((id) => ({ id, kind: "todo", title: id, date: "2026-11-05" }));
  const r = rule({ type: "overdue" }, undefined, { maxPerDay: 2 });
  assert.equal(run(r, S({ todos })).length, 2);
  const log = [{ id: "x", ruleId: "r1", key: "r1|other", ts: NOW - 3600e3 }];
  assert.equal(run(r, S({ todos }), A.buildHistory(log, [r], NOW)).length, 1);
  const yesterday = [{ id: "x", ruleId: "r1", key: "r1|other", ts: NOW - 86400e3 }];
  assert.equal(run(r, S({ todos }), A.buildHistory(yesterday, [r], NOW)).length, 2);
});

test("Ausgeschaltete Regeln laufen nie", () => {
  assert.equal(run(rule({ type: "clock_in" }, undefined, { enabled: false }), S({ running: { start: NOW - 60e3 } })).length, 0);
});

test("effects: Aufgabe mit fester ID, Modus, Berichte, Seite vorschlagen", () => {
  const r = A.normRule(rule({ type: "site" }, [{ type: "task", text: "Fotos auf {ort} machen", when: "tomorrow" }, { type: "mode", mode: "arbeit" }, { type: "report", kind: "month" }, { type: "open", target: "auto" }]));
  const fx = A.effects({ rule: r, key: "r1|site:p1:1", data: { placeId: "p1", place: "Baustelle Nord" } }, { now: NOW, siteHashOf: (id) => "#orte/baustelle/" + id });
  assert.equal(fx[0].kind, "task");
  assert.equal(fx[0].todo.title, "Fotos auf Baustelle Nord machen");
  assert.equal(fx[0].todo.date, "2026-11-07");
  assert.match(fx[0].todo.id, /^au_/);
  assert.deepEqual(fx[1], { kind: "mode", privat: false });
  assert.equal(fx[2].hint.target, "jump:month-panel");
  assert.equal(fx[3].hint.target, "#orte/baustelle/p1");
  assert.equal(fx[3].hint.title, "Baustelle Nord öffnen?");
});

test("renderText, Texte, Vorlagen, Kopie, Verlauf kürzen, Mitteilungen", () => {
  assert.equal(A.renderText("Hallo {name} auf {ort}!", { name: "Max" }), "Hallo Max auf!");
  assert.equal(A.triggerText({ type: "weekly", days: [1, 2, 3, 4, 5], time: "07:00" }), "Mo–Fr um 07:00");
  assert.equal(A.triggerText(A.normRule({ trigger: { type: "site", placeId: "p1" } }).trigger, [{ id: "p1", name: "Nord" }]), "Du stempelst bei „Nord“ ein");
  assert.ok(A.TEMPLATES.length >= 4 && A.TEMPLATES.length <= 6);
  for (const t of A.TEMPLATES) {
    const r = A.fromTemplate(t.tpl, NOW);
    assert.deepEqual(A.validateRule(r), [], t.tpl);
    assert.equal(r.enabled, true);
    assert.equal(r.enabledAt, NOW);
  }
  const d = A.duplicateRule({ ...rule({ type: "clock_in" }), seen: ["x"], runs: 4 }, NOW);
  assert.equal(d.id, ""); assert.equal(d.enabled, false); assert.deepEqual(d.seen, []); assert.match(d.name, /Kopie/);
  const logs = Array.from({ length: 105 }, (_, i) => ({ id: "l" + i, ts: i }));
  assert.deepEqual(A.pruneLog(logs).sort(), ["l0", "l1", "l2", "l3", "l4"].sort());
  const items = A.notifyItems([{ id: "l1", ts: NOW - 3600e3, hints: [{ emoji: "📒", title: "Wochenbericht", sub: "x", target: "weekreport" }] }, { id: "old", ts: NOW - 5 * 86400e3, hints: [{ title: "alt" }] }], NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "auto:l1:0");
  assert.equal(items[0].kind, "automation");
  assert.deepEqual(A.neededCollections([rule({ type: "material" }, [{ type: "einkauf" }]), rule({ type: "budget" })]).sort(), ["einkauf", "material_items", "money_budget", "money_cats", "money_tx"]);
});
