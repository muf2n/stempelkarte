// node --test test/dashboard-core.test.mjs
// Smart Dashboard (Heute): Einstellungen, Kontext, Reihenfolge, Verschieben/Ausblenden, Tipps.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/dashboard-core.js";

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// 2026-11-09 = Montag, 2026-11-07 = Samstag
const MON_10 = at(2026, 11, 9, 10);
const MON_19 = at(2026, 11, 9, 19);
const SAT_11 = at(2026, 11, 7, 11);

test("readDashboard: Standardwerte, unbekannte/doppelte Ids raus, fehlende hinten", () => {
  const a = D.readDashboard({});
  assert.deepEqual(a.order, D.DEFAULT_ORDER);
  assert.deepEqual(a.hidden, []);
  assert.equal(a.auto, true);
  const b = D.readDashboard({ dashboard: { order: ["sync", "xx", "sync", "money"], hidden: ["tip", "nope"], auto: false } });
  assert.equal(b.order[0], "sync");
  assert.equal(b.order[1], "money");
  assert.equal(b.order.length, D.IDS.length);
  assert.deepEqual(b.hidden, ["tip"]);
  assert.equal(b.auto, false);
  assert.deepEqual(D.dashboardForSave({ order: ["tip"] }).order[0], "tip");
});

test("detectContext: eingestempelt → Arbeit", () => {
  assert.equal(D.detectContext({ now: MON_10, running: true }), "work");
  assert.equal(D.detectContext({ now: SAT_11, running: true, schoolTomorrow: true }), "work");
});

test("detectContext: Abend vor Schultag → Schule, Schulvormittag → Schule", () => {
  assert.equal(D.detectContext({ now: MON_19, schoolTomorrow: true }), "school");
  assert.equal(D.detectContext({ now: MON_10, schoolTomorrow: true }), "day");
  assert.equal(D.detectContext({ now: MON_10, schoolToday: true }), "school");
});

test("detectContext: Feierabend, Wochenende, Feiertag → privat; Arbeitstag vormittags → day", () => {
  assert.equal(D.detectContext({ now: MON_19 }), "private");
  assert.equal(D.detectContext({ now: SAT_11 }), "private");
  assert.equal(D.detectContext({ now: MON_10, holidayToday: true }), "private");
  assert.equal(D.detectContext({ now: MON_10 }), "day");
  assert.equal(D.detectContext({ now: SAT_11, workDays: [1, 2, 3, 4, 5, 6] }), "day");
});

test("arrange: Kontext-Reihenfolge bei auto, eigene Reihenfolge sonst, ausgeblendete und fehlende raus", () => {
  assert.equal(D.arrange({}, "work")[0], "site");
  assert.equal(D.arrange({}, "school")[0], "school");
  assert.equal(D.arrange({}, "private")[0], "agenda");
  const own = { order: ["sync", "tip"], auto: false, hidden: ["tip"] };
  assert.equal(D.arrange(own, "work")[0], "sync");
  assert.ok(!D.arrange(own, "work").includes("tip"));
  assert.ok(!D.arrange({ hidden: ["site"] }, "work").includes("site"));
  assert.deepEqual(D.arrange({}, "work", ["tip", "sync"]), ["tip", "sync"]);
  for (const k of Object.keys(D.CONTEXT_ORDER)) assert.deepEqual([...D.CONTEXT_ORDER[k]].sort(), [...D.IDS].sort(), k);
});

test("moveWidget/toggleHidden", () => {
  const o = D.moveWidget(D.DEFAULT_ORDER, "agenda", -1);
  assert.deepEqual(o.slice(0, 2), ["agenda", "balance"]);
  assert.deepEqual(D.moveWidget(o, "agenda", -1).slice(0, 2), ["agenda", "balance"]); // ganz oben bleibt oben
  const last = D.DEFAULT_ORDER[D.DEFAULT_ORDER.length - 1];
  assert.equal(D.moveWidget(D.DEFAULT_ORDER, last, 1).at(-1), last);
  assert.deepEqual(D.toggleHidden([], "tip", true), ["tip"]);
  assert.deepEqual(D.toggleHidden(["tip", "sync"], "tip", false), ["sync"]);
  assert.deepEqual(D.toggleHidden([], "nix", true), []);
});

test("pickTips: Pause, Schule morgen, Geburtstag, offline – keine erfundenen Tipps", () => {
  const H = 3600000;
  const run = { start: MON_10 - 5 * H, pauseMs: 0, pauseStart: null };
  assert.equal(D.pickTips({ now: MON_10, running: run, netMs: 5.2 * H })[0].id, "pause");
  assert.match(D.pickTips({ now: MON_10, running: run, netMs: 5.2 * H })[0].text, /Seit 5 h keine Pause/);
  assert.equal(D.pickTips({ now: MON_10, running: { ...run, pauseMs: 1800000 }, netMs: 5.2 * H }).length, 0);
  assert.equal(D.pickTips({ now: MON_10, running: { ...run, pauseStart: MON_10 }, netMs: 6 * H }).length, 0);
  assert.match(D.pickTips({ now: MON_19, schoolTomorrow: "Berufsschule" })[0].text, /Morgen Berufsschule 🎒|Morgen Berufsschule/);
  assert.equal(D.pickTips({ now: MON_10, schoolTomorrow: "Berufsschule" }).length, 0); // vormittags noch nicht
  assert.equal(D.pickTips({ now: MON_10, birthdayToday: "Oma" })[0].id, "bday");
  assert.equal(D.pickTips({ now: MON_10, offline: true })[0].id, "offline");
  assert.equal(D.pickTips({ now: MON_10 }).length, 0);
  assert.equal(D.pickTips({ now: SAT_11, weekend: true })[0].id, "weekend");
  assert.equal(D.pickTips({ now: MON_10, balanceMin: 45 * 60 })[0].id, "plus");
  assert.equal(D.pickTips({ now: MON_10, examSoon: { title: "Test Mathe", days: 1 } })[0].text, "Test Mathe ist morgen – kurz wiederholen lohnt sich.");
  assert.equal(D.pickTips({ now: MON_19, offline: true, birthdayToday: "A", schoolTomorrow: "Berufsschule" }, 2).length, 2);
});
