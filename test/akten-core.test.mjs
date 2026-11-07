// node --test test/akten-core.test.mjs – Update 10 E: 📜 Verträge (Kündigungsfristen), 📦 Inventar (Garantie), 📁 Dokumente (Ablauf),
// 👤 Kontakte und 💶 Finanz-Planung (Monatsende, Jahreskosten, Simulation, Wunschliste). Nur erfundene Testdaten.
import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../js/alltag/vertraege-core.js";
import * as I from "../js/alltag/inventar-core.js";
import * as D from "../js/alltag/dokumente-core.js";
import * as K from "../js/alltag/kontakte-core.js";
import * as F from "../js/alltag/finanz-core.js";

const T = "2026-11-07";

/* ---------- Verträge ---------- */

test("Vertrag mit Mindestlaufzeit: Ende, Kündigungsfrist, noch nicht verlängert", () => {
  const c = { id: "c1", name: "Handy", start: "2025-03-15", minMonths: 24, noticeText: "1 Monat" };
  const st = V.termStatus(c, T);
  assert.equal(st.state, "laeuft");
  assert.equal(st.end, "2027-03-14");
  assert.equal(st.deadline, "2027-02-14");
  assert.equal(st.renewed, 0);
});

test("Automatische Verlängerung: Frist verpasst → nächste Periode (12 Monate)", () => {
  const c = { id: "c2", name: "Strom", start: "2024-01-01", minMonths: 12, noticeText: "3 Monate", autoRenew: true };
  // Ende 31.12.2024 → 31.12.2025 → 31.12.2026; Frist für 31.12.2026 = 30.09.2026 (vorbei) → 31.12.2027, Frist 30.09.2027
  const st = V.termStatus(c, T);
  assert.equal(st.end, "2027-12-31");
  assert.equal(st.deadline, "2027-09-30");
  assert.equal(st.renewed, 3);
  // Kurz vor der Frist: 2026-09-20 → Ende 31.12.2026, Frist 30.09.2026 in 10 Tagen
  const st2 = V.termStatus(c, "2026-09-20");
  assert.equal(st2.end, "2026-12-31");
  assert.equal(st2.daysToDeadline, 10);
});

test("Kündigungsfrist in Tagen hat Vorrang, monatliche Verlängerung", () => {
  const c = { id: "c3", name: "Fitness", start: "2026-01-10", minMonths: 6, renewMonths: 1, noticeDays: 14 };
  // erstes Ende 09.07.2026, dann monatlich: … 09.11.2026 Frist 26.10. (vorbei) → 09.12.2026, Frist 25.11.2026
  const st = V.termStatus(c, T);
  assert.equal(st.end, "2026-12-09");
  assert.equal(st.deadline, "2026-11-25");
});

test("Ohne Verlängerung, gekündigt, beendet, unbefristet", () => {
  assert.equal(V.termStatus({ name: "Leasing", start: "2024-12-01", minMonths: 24, autoRenew: false }, T).noRenew, true);
  assert.equal(V.termStatus({ name: "Alt", end: "2026-01-31", autoRenew: false }, T).state, "beendet");
  const g = V.termStatus({ name: "Gek", start: "2025-01-01", minMonths: 24, cancelledOn: "2026-10-01" }, T);
  assert.equal(g.state, "gekuendigt");
  assert.equal(g.end, "2026-12-31");
  const u = V.termStatus({ name: "Miete", noticeText: "3 Monate zum Monatsende" }, T);
  assert.equal(u.state, "unbefristet");
  assert.equal(u.canEndOn, "2027-02-28");
});

test("Preisänderungen, Monats-/Jahreskosten, Summen ohne Abo-Doppelzählung", () => {
  const c = { id: "c4", name: "Internet", start: "2025-01-01", amount: 30, interval: "month", prices: [{ from: "2026-04-01", amount: 34.9, note: "Indexanpassung" }, { from: "2027-01-01", amount: 39 }] };
  assert.equal(V.priceAt(c, T), 34.9);
  assert.equal(V.contractYearly(c, T), 418.8);
  const h = V.priceHistory(c);
  assert.deepEqual(h.map((x) => x.diff), [0, 4.9, 4.1]);
  const tot = V.contractTotals([c, { id: "c5", name: "Haushalt", amount: 120, interval: "year" }, { id: "c6", name: "Netflix", amount: 15, subId: "s1" }], T);
  assert.equal(tot.n, 2);
  assert.equal(tot.month, 44.9);
});

test("Fällige Verträge (Frist, Ende) und Abo-Abgleich", () => {
  const list = [
    { id: "a", name: "Handy", start: "2024-12-20", minMonths: 24, noticeText: "1 Monat" }, // Ende 19.12.2026, Frist 19.11.2026 → 12 Tage
    { id: "b", name: "Leasing", start: "2024-12-01", minMonths: 24, autoRenew: false }, // Ende 30.11.2026 → 23 Tage
    { id: "c", name: "Strom", start: "2026-01-01", minMonths: 24, noticeText: "1 Monat" },
    { id: "d", name: "Aus", start: "2024-12-20", minMonths: 24, noticeText: "1 Monat", remind: false },
  ];
  const due = V.dueContracts(list, T);
  assert.deepEqual(due.map((x) => [x.id, x.kind, x.days]), [["a", "frist", 12], ["b", "ende", 23]]);
  assert.match(due[0].text, /Kündigungsfrist in 12 Tagen \(19\.11\.2026\)/);
  const sub = V.matchSub({ name: "Handyvertrag", provider: "Magenta" }, [{ id: "s1", name: "Spotify" }, { id: "s2", name: "Magenta Mobil" }]);
  assert.equal(sub && sub.id, "s2");
  assert.deepEqual(V.fillFromSub(V.normContract({ name: "x" }), { name: "Magenta Mobil", amount: 25, interval: "month", noticeText: "1 Monat" }), { amount: 25, interval: "month", noticeText: "1 Monat", provider: "Magenta Mobil" });
  assert.equal(V.routeId("#alltag/vertraege/ab%20c"), "ab c");
});

/* ---------- Inventar ---------- */

test("Garantie: aus Kaufdatum, Status, fällige, Werte je Raum", () => {
  assert.equal(I.warrantyFrom("2024-11-20", 24), "2026-11-19");
  const items = [
    { id: "i1", name: "Waschmaschine", room: "Bad", price: 649, boughtOn: "2024-11-20", warrantyUntil: "2026-11-19", cat: "haushalt" },
    { id: "i2", name: "Laptop", room: "Büro", price: 1199.9, warrantyUntil: "2027-06-01" },
    { id: "i3", name: "Sofa", room: "Wohnzimmer", price: 900, warrantyUntil: "2025-01-01" },
    { id: "i4", name: "Föhn", room: "Bad", price: 39.5 },
  ];
  assert.equal(I.warrantyStatus(items[0], T).state, "bald");
  assert.equal(I.warrantyStatus(items[0], T).label, "Garantie endet in 12 Tagen");
  assert.equal(I.warrantyStatus(items[2], T).state, "ab");
  assert.equal(I.warrantyStatus(items[3], T).state, "none");
  assert.deepEqual(I.dueWarranties(items, T).map((x) => x.id), ["i1"]);
  assert.deepEqual(I.totalsByRoom(items), [{ room: "Büro", n: 1, value: 1199.9 }, { room: "Wohnzimmer", n: 1, value: 900 }, { room: "Bad", n: 2, value: 688.5 }]);
  assert.equal(I.totalValue(items), 2788.4);
  assert.deepEqual(I.filterItems(items, { room: "Bad" }, T).map((x) => x.id), ["i4", "i1"]);
  assert.deepEqual(I.filterItems(items, { view: "garantie" }, T).map((x) => x.id), ["i2", "i1"]);
  assert.equal(I.routeId(I.itemHash("x_1")), "x_1");
});

/* ---------- Dokumente ---------- */

test("Dokumente: Ablauf, Ordner, Tags, Filter, Verknüpfungen, OCR aufräumen, Stücke", () => {
  const docs = [
    { id: "d1", title: "Reisepass", folder: "sonstiges", expires: "2026-11-20", tags: ["Ausweis", "#wichtig"], date: "2020-01-01" },
    { id: "d2", title: "Rechnung Laptop", folder: "rechnungen", tags: "garantie, Laptop", links: [{ k: "inventar", id: "i2" }, { k: "foo", id: "x" }], fav: true, date: "2026-06-01", ocr: "Seriennummer ABC123" },
    { id: "d3", title: "Führerschein", folder: "Auto & Co", expires: "2026-11-03", date: "2019-01-01" },
    { id: "d4", title: "Alt", expires: "2026-01-01" },
  ];
  assert.deepEqual(D.dueDocs(docs, T).map((x) => [x.id, x.state, x.days]), [["d3", "ab", -4], ["d1", "bald", 13]]);
  const n2 = D.normDoc(docs[1]);
  assert.deepEqual(n2.tags, ["garantie", "Laptop"]);
  assert.deepEqual(n2.links, [{ k: "inventar", id: "i2" }]);
  assert.deepEqual(D.normDoc(docs[0]).tags, ["Ausweis", "wichtig"]);
  const fc = D.folderCounts(docs);
  assert.equal(fc.find((f) => f.id === "sonstiges").n, 2);
  assert.equal(fc[fc.length - 1].id, "Auto & Co");
  assert.equal(fc[fc.length - 1].own, true);
  assert.deepEqual(D.filterDocs(docs, { q: "abc123" }).map((d) => d.id), ["d2"]);
  assert.deepEqual(D.filterDocs(docs, {}).map((d) => d.id)[0], "d2"); // Favorit zuerst
  assert.deepEqual(D.filterDocs(docs, { view: "ablauf" }, T).map((d) => d.id).sort(), ["d1", "d3", "d4"]);
  assert.deepEqual(D.linkedTo(docs, "inventar", "i2").map((d) => d.id), ["d2"]);
  assert.equal(D.cleanOcr("```\nHallo Welt\n```"), "Hallo Welt");
  assert.equal(D.cleanOcr("(Kein lesbarer Text)"), "");
  assert.deepEqual(D.splitChunks("abcdefg", 3), ["abc", "def", "g"]);
  assert.equal(D.fmtSize(10 * 1024 * 1024), "10,0 MB");
});

/* ---------- Kontakte ---------- */

test("Kontakte: tel:/mailto:, Baustellen-Kunde, Verlauf, Suche", () => {
  assert.equal(K.telHref("+43 (660) 123 45-67"), "tel:+436601234567");
  assert.equal(K.telHref("ab"), "");
  assert.equal(K.mailHref("max@example.com"), "mailto:max@example.com");
  assert.equal(K.mailHref("kein mail"), "");
  const cs = [
    { id: "k1", name: "Muster GmbH", type: "firma", placeIds: ["p1"], calls: [{ id: "n1", date: "2026-11-02", text: "Angebot besprochen" }], jobs: [{ id: "j1", title: "Zählerkasten tauschen", date: "2026-10-20", status: "laeuft" }] },
    { id: "k2", name: "Erika Beispiel", type: "privat", phone: "0660 1234567" },
  ];
  assert.equal(K.customerOfPlace({ id: "p1" }, cs).id, "k1");
  assert.equal(K.customerOfPlace({ id: "p1", customerId: "k2" }, cs).id, "k2");
  assert.equal(K.customerOfPlace({ id: "p9" }, cs), null);
  const c = K.normContact(cs[0]);
  const h = K.history(c, { entries: [{ placeId: "p1", start: new Date(2026, 10, 5, 8).getTime() }, { placeId: "p1", start: new Date(2026, 10, 5, 13).getTime() }], places: [{ id: "p1", name: "Baustelle Muster" }], docs: [{ title: "Angebot", date: "2026-10-01" }] });
  assert.deepEqual(h.map((x) => x.kind), ["work", "call", "job", "doc"]);
  assert.equal(K.openJobs(c).length, 1);
  assert.deepEqual(K.filterContacts(cs, { q: "06601234567" }).map((x) => x.id), ["k2"]);
  assert.deepEqual(K.filterContacts(cs, { type: "firma" }).map((x) => x.id), ["k1"]);
});

/* ---------- Finanz-Planung ---------- */

const txs = [
  { id: "t1", date: "2026-08-01", type: "in", amount: 900 },
  { id: "t2", date: "2026-09-01", type: "in", amount: 1000 },
  { id: "t3", date: "2026-10-01", type: "in", amount: 1100 },
  { id: "t4", date: "2026-11-02", type: "in", amount: 400 },
  { id: "t5", date: "2026-11-03", type: "out", amount: 120, category: "essen" },
  { id: "sub_s1_20261105", date: "2026-11-05", type: "out", amount: 10, category: "abos" },
];
const subs = [{ id: "s1", name: "Musik", amount: 10, interval: "month", next: "2026-11-05" }, { id: "s2", name: "Cloud", amount: 3, interval: "month", next: "2026-11-20" }, { id: "s3", name: "Jahresabo", amount: 60, interval: "year", next: "2027-02-01" }];
const contracts = [{ id: "c1", name: "Handy", amount: 20, interval: "month", start: "2026-01-01", minMonths: 24 }, { id: "c2", name: "Musik-Vertrag", amount: 10, subId: "s1" }];

test("Monatsende: Schnitt-Einkommen, Ausgaben, offene Abos, Verträge, geplante Wünsche", () => {
  const r = F.monthEnd({ today: T, txs, subs, contracts, wishes: [{ id: "w1", name: "Kopfhörer", price: 80, saved: 30, plan: "2026-11" }] });
  assert.equal(r.incomeAvg, 1000);
  assert.equal(r.income, 1000);
  assert.equal(r.incomeSource, "schnitt");
  assert.equal(r.spent, 130);
  assert.deepEqual(r.subsList.map((x) => x.name), ["Cloud"]); // Musik schon gebucht
  assert.equal(r.contracts, 20);
  assert.equal(r.planned, 50);
  assert.equal(r.rest, 1000 - 130 - 3 - 20 - 50);
  assert.equal(F.restLevel(r), "gut");
  const fixed = F.monthEnd({ today: T, txs, subs, contracts, income: 300 });
  assert.equal(fixed.income, 400); // nie weniger als schon eingegangen
});

test("Jahreskosten und Simulation (mit „Kann ich mir das leisten?“)", () => {
  const y = F.yearlyFixed({ subs, contracts, today: T });
  assert.deepEqual(y.rows.map((r) => r.name), ["Handy", "Musik", "Jahresabo", "Cloud"]);
  assert.equal(y.year, 240 + 120 + 60 + 36);
  assert.equal(y.vertraege, 240);
  const sim = F.simulate({ today: T, txs, subs, contracts, amount: 900, budgets: [{ id: "total", amount: 600 }], hourly: 12.5 });
  assert.equal(sim.after.rest, sim.before.rest - 900);
  assert.equal(sim.level, "minus");
  assert.equal(sim.afford.verdict, "nein");
  assert.equal(sim.hours, 72);
});

test("Wunschliste: Sparziel-Verknüpfung, Fortschritt, Sortierung", () => {
  const goals = [{ id: "g1", name: "Fahrrad", saved: 250, target: 500 }];
  const ws = F.sortWishes([
    { id: "w1", name: "Fahrrad", price: 500, prio: 2, goalId: "g1" },
    { id: "w2", name: "Spiel", price: 60, prio: 3, saved: 60 },
    { id: "w3", name: "Bohrer", price: 150, prio: 1 },
    { id: "w4", name: "Alt", price: 10, done: true, prio: 1 },
  ], goals);
  assert.deepEqual(ws.map((w) => w.id), ["w3", "w1", "w2", "w4"]);
  assert.equal(ws[1].saved, 250);
  assert.deepEqual(F.wishProgress(ws[1]), { left: 250, pct: 50, ready: false });
  assert.equal(F.wishProgress(ws[2]).ready, true);
  assert.deepEqual(F.goalFromWish(ws[0]), { name: "Bohrer", target: 150, saved: 0, emoji: "🎁", date: "" });
});

/* ---------- Benachrichtigungen ---------- */
import * as N from "../js/notify-core.js";

test("Benachrichtigungen: Dokumente-Ablauf, Kündigungsfrist, Garantie (abschaltbar, ohne Beträge)", () => {
  const now = new Date(2026, 10, 7, 10).getTime();
  const cols = {
    dokumente: [{ id: "d1", title: "Reisepass", expires: "2026-11-20" }],
    vertraege: [{ id: "c1", name: "Handy", start: "2024-12-20", minMonths: 24, noticeText: "1 Monat", amount: 25 }],
    inventar: [{ id: "i1", name: "Waschmaschine", warrantyUntil: "2026-11-19", price: 649 }],
  };
  const loaded = { dokumente: true, vertraege: true, inventar: true };
  const items = N.collect({ now, cols, loaded, settings: {} });
  const by = (k) => items.filter((x) => x.kind === k);
  assert.equal(by("dokumente")[0].target, "#alltag/dokumente/d1");
  assert.match(by("dokumente")[0].sub, /Läuft am .* ab|Läuft in 13 Tagen ab/);
  assert.equal(by("vertraege")[0].target, "#alltag/vertraege/c1");
  assert.match(by("vertraege")[0].sub, /Kündigungsfrist endet/);
  assert.equal(by("garantie")[0].target, "#alltag/inventar/i1");
  assert.ok(!JSON.stringify(items).includes("649") && !JSON.stringify(items).includes("25 €"));
  assert.deepEqual(N.NEEDS.vertraege, ["vertraege"]);
  const off = N.collect({ now, cols, loaded, settings: { notify: { off: ["vertraege", "garantie", "dokumente"] } } });
  assert.equal(off.filter((x) => ["vertraege", "garantie", "dokumente"].includes(x.kind)).length, 0);
});

test("Monatsende stolpert nicht über Wünsche mit Sparziel", () => {
  const r = F.monthEnd({ today: T, txs: [], subs: [], contracts: [], wishes: [{ id: "w1", name: "X", price: 50, goalId: "g1", plan: "2026-11" }, { id: "w2", name: "Y", price: 10, plan: "2026-11" }] });
  assert.equal(r.planned, 60);
});
