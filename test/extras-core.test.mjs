// node --test test/extras-core.test.mjs
// Update 12 – Haustiere, Kleiderschrank, Gruppen, Wohnen.
import test from "node:test";
import assert from "node:assert/strict";
import * as X from "../js/alltag/extras-core.js";
import { balances, settle } from "../js/alltag/money-core.js";

const T = "2026-11-10";

test("Haustiere: Alter, Fälligkeiten, Kosten", () => {
  assert.equal(X.ageText("2023-05-20", T), "3 Jahre, 5 Mon.");
  assert.equal(X.ageText("2026-08-01", T), "3 Monate");
  const p = { id: "p", name: "Bello", art: "hund", care: [{ title: "Krallen", every: 30, last: "2026-10-01" }, { title: "Baden", every: 60, last: "2026-11-01" }],
    vacc: [{ name: "Tollwut", next: "2026-11-20" }], meds: [{ name: "Antibiotikum", dose: "1 Tbl.", from: "2026-11-08", until: "2026-11-14", times: ["08:00"] }],
    vet: [{ date: "2026-11-12", reason: "Kontrolle", cost: 45 }, { date: "2026-03-01", cost: 80 }], costs: [{ date: "2026-02-01", what: "Futter", amount: 30.5 }, { date: "2025-12-01", amount: 9 }] };
  const d = X.petDue([p], T);
  assert.deepEqual(d.map((x) => x.kind), ["pflege", "medikament", "tierarzt", "impfung"]);
  assert.equal(d[0].text, "Krallen");
  assert.deepEqual(X.petCosts(p, 2026), { vet: 125, other: 30.5, total: 155.5 });
  assert.equal(X.normPet({ art: "xyz" }).emoji, "🐾");
  assert.equal(X.normPet({ photo: "javascript:alert(1)" }).photo, "");
});

test("Kleiderschrank: Vorschlag nach Wetter, Packliste, Statistik", () => {
  const clothes = [
    { id: "t", cat: "oberteil", warmth: 1, seasons: ["sommer"] }, { id: "s", cat: "kurz", warmth: 1 },
    { id: "p", cat: "pulli", warmth: 3, seasons: ["winter", "herbst"], worn: ["2026-11-01"] }, { id: "j", cat: "jacke", warmth: 3 }, { id: "h", cat: "hose", warmth: 2 },
  ];
  const outfits = [{ id: "sommer", items: ["t", "s"] }, { id: "winter", items: ["p", "j", "h"] }];
  assert.equal(X.suggestOutfits(outfits, clothes, { temp: 4, rain: true, today: T })[0].outfit.id, "winter");
  assert.equal(X.suggestOutfits(outfits, clothes, { temp: 27, today: "2026-07-10" })[0].outfit.id, "sommer");
  assert.equal(X.warmthFor(null), null);
  const pk = X.packFor(clothes, 6, "herbst");
  assert.equal(pk.find((x) => x.cat === "oberteil").want, 6);
  assert.equal(pk.find((x) => x.cat === "oberteil").items.length, 0, "Sommer-Shirt passt nicht in den Herbst");
  assert.ok(!pk.some((x) => x.cat === "kurz"));
  const st = X.wardrobeStats(clothes, T);
  assert.equal(st.total, 5); assert.equal(st.unused.length, 4);
});

test("Gruppen: Kosten mit Geld-Logik aufteilen, Termine, Challenge", () => {
  const g = X.normGroup({ id: "g", name: "WG", people: [{ id: "a", name: "Anna" }, { id: "b", name: "Ben" }, { id: "me", name: "hack" }],
    expenses: [{ what: "Pizza", amount: 30, paidBy: "me", forIds: [] }, { what: "Bier", amount: 12, paidBy: "a", forIds: ["a", "b"] }, { amount: 5, paidBy: "zzz" }],
    events: [{ title: "Grillen", date: "2026-11-15", time: "18:00" }, { title: "Alt", date: "2026-10-01" }],
    challenge: { title: "Laufen", goal: 50, unit: "km", progress: { me: 20, a: 35, x: 99 } } });
  assert.equal(g.people.length, 2, "ME wird nicht doppelt geführt");
  assert.equal(g.expenses.length, 2, "Fremde Zahler fliegen raus");
  const grp = { people: [{ id: "me" }, ...g.people], expenses: g.expenses };
  assert.equal(balances(grp).get("me"), 20);
  assert.deepEqual(settle(grp), [{ from: "b", to: "me", amount: 16 }, { from: "a", to: "me", amount: 4 }]);
  assert.deepEqual(X.upcomingEvents([g], T).map((e) => e.title), ["Grillen"]);
  assert.deepEqual(X.challengeRanking(g).map((x) => [x.id, x.pct]), [["a", 70], ["me", 40], ["b", 0]]);
});

test("Wohnen: Umzug, Kosten, Zähler, Verleih, Wo liegt was", () => {
  const st = X.moveSteps({ date: "2026-12-01", done: { s0: true }, own: [{ id: "o1", text: "Katze zur Oma", days: -1 }] }, T);
  assert.equal(st[0].done, true);
  assert.equal(st.find((x) => /Meldezettel/.test(x.text)).date, "2026-12-04");
  assert.ok(st.find((x) => x.id === "o1"));
  assert.ok(st.find((x) => /Umzugshelfer/.test(x.text)).late, "60 Tage vorher ist schon vorbei");
  const c = X.costSummary([{ id: "1", name: "Miete", amount: 600 }, { id: "2", name: "Strom", amount: 150, every: 3 }, { id: "3", name: "GIS", amount: 0 }]);
  assert.equal(c.monthly, 650); assert.equal(c.yearly, 7800);
  assert.deepEqual(X.usage([{ date: "2026-01-01", value: 1000 }, { date: "2026-01-31", value: 1090 }]), [{ from: "2026-01-01", to: "2026-01-31", diff: 90, perDay: 3 }]);
  assert.deepEqual(X.lendDue([{ id: "l", what: "Bohrmaschine", due: "2026-11-11" }, { id: "m", what: "Buch", due: "2026-11-11", back: "2026-11-09" }], T).map((l) => l.id), ["l"]);
  assert.deepEqual(X.findPlace([{ id: "a", what: "Reisepass", where: "Schreibtisch, 2. Lade" }, { id: "b", what: "Ersatzschlüssel", where: "Keller" }], "pass").map((p) => p.id), ["a"]);
});
