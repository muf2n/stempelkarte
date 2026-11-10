// node --test test/life-spiel-core.test.mjs
// Update 12 – Life Analytics / Digital Twin (life-core) und Spielwelt (spiel-core).
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/life-core.js";
import * as G from "../js/spiel-core.js";

const T = (d, h, mi = 0) => new Date(2026, 10, d, h, mi).getTime();
const inp = {
  entries: [{ id: "e1", start: T(9, 7), end: T(9, 16), pauseMin: 30 }, { id: "e2", start: T(10, 7), end: T(10, 15, 30), pauseMin: 30 }, { id: "u", kind: "urlaub", start: T(3, 0), end: T(3, 23) }],
  todos: [{ kind: "todo", done: true, doneAt: T(10, 9) }, { kind: "todo", done: true, doneAt: T(10, 10) }, { kind: "termin", done: true, doneAt: T(10, 11) }],
  freizeit: [{ cat: "sport", start: T(10, 18), end: T(10, 18, 45) }, { cat: "zuhause", start: T(8, 10), end: T(8, 11) }],
  haushalt: [{ history: [{ day: "2026-11-10" }, { day: "2026-11-02" }] }],
  habits: [{ title: "Laufen", log: { "2026-11-10": 1 } }, { title: "Lesen", log: { "2026-11-09": 1 } }],
  learn: [{ id: "lap", xp: { "2026-11-10": 30, "2026-11-01": 10 } }, { id: "me", xp: { "2026-11-10": 999 } }],
  lists: [{ type: "film", status: "fertig", doneAt: T(7, 21) }],
  trips: [{ id: "t", from: "2026-08-01", to: "2026-08-03" }],
  money: [{ type: "in", amount: 1000, date: "2026-11-05" }, { type: "out", amount: -250, date: "2026-11-06" }],
};

test("activities sammelt alle Bereiche richtig", () => {
  const a = L.activities(inp);
  const k = (kind) => a.filter((x) => x.kind === kind);
  assert.equal(k("arbeitstag").length, 2, "Urlaub zählt nicht als Arbeitstag");
  assert.equal(k("arbeitstag")[0].min, 510);
  assert.equal(k("aufgabe").length, 2, "Termine zählen nicht als Aufgabe");
  assert.equal(k("sport")[0].min, 45);
  assert.equal(a.find((x) => x.kind === "gewohnheit" && x.day === "2026-11-10").area, "sport", "Laufen → Sport");
  assert.equal(k("lern-xp").length, 2, "Dokument 'me' wird ignoriert");
  assert.equal(k("reisetag").length, 3);
});

test("range, byArea, Vergleich, Twin, Geld", () => {
  assert.deepEqual(L.range("week", "2026-11-10"), { from: "2026-11-09", to: "2026-11-15", label: "09.11. – 15.11." });
  assert.equal(L.range("month", "2026-11-10", -1).from, "2026-10-01");
  assert.equal(L.range("year", "2026-11-10").to, "2026-12-31");
  const a = L.activities(inp);
  const w = L.byArea(a, "2026-11-09", "2026-11-15");
  assert.equal(w.arbeit.days, 2); assert.equal(w.lernen.n, 30); assert.equal(w.sport.min, 45);
  const cmp = L.compareAreas(a, L.range("week", "2026-11-10"), L.range("week", "2026-11-10", -1));
  assert.equal(cmp.find((x) => x.id === "arbeit").delta, 2);
  const tw = L.twin(a, "2026-11-10", ["arbeit", "lernen"]);
  assert.deepEqual(tw.map((x) => x.id), ["arbeit", "lernen"], "nur freigegebene Bereiche");
  assert.equal(tw[0].score, Math.round((2 / 18) * 100));
  assert.deepEqual(L.money(inp, "2026-11-01", "2026-11-30"), { income: 1000, expense: 250, saved: 750, rate: 75 });
  assert.equal(L.money({ ...inp, moneyLocked: true }, "2026-11-01", "2026-11-30"), null, "Geld-Sperre respektiert");
  assert.equal(L.monthly(a, "2026-11-10", 12).length, 12);
  const y = L.yearReview(inp, 2026);
  assert.equal(y.workDays, 2); assert.equal(y.films, 1); assert.equal(y.travelDays, 3);
  assert.match(L.csv(a), /^"Datum";"Bereich"/);
});

test("Spielwelt: XP, Level, Quests, Erfolge, Münzen", () => {
  const a = L.activities(inp);
  assert.equal(G.levelOf(0).level, 1);
  assert.equal(G.levelOf(100).level, 2);
  assert.equal(G.levelOf(299).level, 2);
  assert.equal(G.levelOf(300).level, 3);
  const xp = G.totalXp(a);
  assert.ok(xp > 50, String(xp));
  const q = G.quests(a, "2026-11-10", {});
  assert.equal(q.daily.length, 3); assert.equal(q.weekly.length, 3);
  const again = G.quests(a, "2026-11-10", {});
  assert.deepEqual(q.daily.map((x) => x.id), again.daily.map((x) => x.id), "deterministisch je Tag");
  const auf = G.quests(a, "2026-11-10", {}, G.DAILY.filter((x) => x.id !== "d-aufgabe").map((x) => x.id)).daily;
  assert.deepEqual(auf.map((x) => x.id), ["d-aufgabe"]);
  assert.ok(auf[0].done, "2 Aufgaben heute erledigt");
  const st = G.stats(a);
  const ach = G.achievements(st, { secret: { tipp7: 1 } });
  assert.ok(ach.find((x) => x.id === "start").got);
  assert.ok(ach.find((x) => x.id === "tipp7").got);
  const me = { claimed: { [`2026-11-10:d-aufgabe`]: true, [`2026-11-09:w-sport`]: true } };
  const have = G.coins(q, ach, me);
  assert.equal(have, 10 + 30 + ach.filter((x) => x.got).length * 25);
  const r = G.buy(me, G.SHOP.find((x) => x.id === "hat-helm"), have);
  assert.ok(r.ok); assert.equal(r.me.wear.hat, "hat-helm");
  assert.equal(G.buy(r.me, G.SHOP[0], 999).ok, false, "nicht doppelt kaufen");
  assert.equal(G.buy({}, G.SHOP.find((x) => x.id === "hat-krone"), 10).ok, false);
});

test("Haustier wird nie traurig, Saison, Ohm-Blitz, Rad, Aufräumen", () => {
  assert.equal(G.petMood([], "2026-11-10", {}).e, "😴");
  assert.equal(G.petMood([], "2026-11-10", { pet: { fedDay: "2026-11-10" } }).e, "🙂");
  assert.equal(G.season("2026-12-05").id, "advent");
  assert.equal(G.season("2026-04-03").id, "ostern", "Ostern 2026 = 5. April");
  assert.equal(G.season("2026-11-10"), null);
  const t = G.ohmTask(() => 0);
  assert.equal(t.q, "R = 10 Ω, I = 0,1 A → U = ?");
  assert.ok(G.ohmCheck(t, "1"));
  const sp = G.spin(4, () => 0.6);
  assert.equal(sp.index, 2);
  const me = G.normMe({ claimed: { "2026-01-01:d-a": true, "2026-11-10:w-b": true }, spent: 0 });
  const p = G.pruneClaimed(me, "2026-11-10");
  assert.deepEqual(Object.keys(p.claimed), ["2026-11-10:w-b"]);
  assert.equal(G.coins(null, [], p), G.coins(null, [], me), "Guthaben bleibt beim Aufräumen gleich");
  assert.equal(G.world(3, { lernen: 0 }).find((z) => z.id === "bibliothek").open, true);
  assert.equal(G.world(3, {}).find((z) => z.id === "hafen").open, false);
});
