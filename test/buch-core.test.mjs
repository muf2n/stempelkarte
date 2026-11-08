// Update 10 – 💼 Buchhaltung: reine Logik (Cent-Rundung, USt, Nummernkreis, E/A-Summen, Zahllast, Kleinunternehmer-Grenze, Export, Scan).
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../js/alltag/buch-core.js";
import { RULES, rule, INFO, RULES_CHECKED } from "../js/alltag/buch-rules.js";

let n = 0;
const nid = () => "id" + ++n;

test("Regeln: jede Zahl hat Quelle + Prüfdatum, Werte wie geprüft", () => {
  for (const [k, r] of Object.entries(RULES)) {
    assert.match(r.source, /^https:\/\/www\.(usp\.gv\.at|wko\.at|bmf\.gv\.at)\//, k + " Quelle offiziell");
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/, k + " Prüfdatum");
    assert.ok(r.text.length > 10, k + " Text");
  }
  assert.equal(rule("kuLimit"), 55000);
  assert.equal(rule("kuTolerancePct"), 10);
  assert.deepEqual(rule("vatRates"), [20, 13, 10, 4.9, 0]);
  assert.equal(rule("smallInvoice"), 400);
  assert.equal(rule("keepYears"), 7);
  assert.equal(rule("gwgLimit"), 1000);
  assert.equal(INFO.length, 11);
  assert.equal(RULES_CHECKED, "2026-11-08");
});

test("toCents: österreichische Schreibweise, nie Float-Fehler, kaufmännisch gerundet", () => {
  assert.equal(B.toCents("1.234,56"), 123456);
  assert.equal(B.toCents("12,5"), 1250);
  assert.equal(B.toCents("12.50"), 1250);
  assert.equal(B.toCents("1.234"), 123400);
  assert.equal(B.toCents("€ 7,05"), 705);
  assert.equal(B.toCents(12.345), 1235);
  assert.equal(B.toCents(0.1 + 0.2), 30);
  assert.equal(B.toCents(1.005), 101);
  assert.equal(B.toCents("12,3449"), 1234);
  assert.equal(B.toCents("0,005"), 1);
  assert.equal(B.toCents("-3"), -300);
  assert.equal(B.toCents("−2,50"), -250);
  assert.ok(Number.isNaN(B.toCents("")));
  assert.ok(Number.isNaN(B.toCents("abc")));
  assert.ok(Number.isNaN(B.toCents("1,2,3")));
  assert.equal(B.eur(123456), "1.234,56 €");
  assert.equal(B.eur(-5), "−0,05 €");
  assert.equal(B.eur(0), "0,00 €");
  assert.equal(B.plain(-123456), "-1234,56");
  assert.equal(B.plain(7), "0,07");
});

test("roundDiv: Hälfte weg von 0, symmetrisch", () => {
  assert.equal(B.roundDiv(5, 2), 3);
  assert.equal(B.roundDiv(-5, 2), -3);
  assert.equal(B.roundDiv(4, 3), 1);
  assert.equal(B.roundDiv(-4, 3), -1);
  assert.equal(B.roundDiv(0, 7), 0);
});

test("USt aus Brutto: Netto gerundet, USt = Rest (Summe stimmt immer)", () => {
  assert.deepEqual(B.splitGross(12000, 20), { gross: 12000, net: 10000, vat: 2000 });
  assert.deepEqual(B.splitGross(3, 20), { gross: 3, net: 3, vat: 0 }); // 2,5 → 3
  assert.deepEqual(B.splitGross(-3, 20), { gross: -3, net: -3, vat: 0 });
  assert.deepEqual(B.splitGross(10000, 4.9), { gross: 10000, net: 9533, vat: 467 });
  assert.deepEqual(B.splitGross(11, 10), { gross: 11, net: 10, vat: 1 });
  assert.deepEqual(B.splitGross(1999, 13), { gross: 1999, net: 1769, vat: 230 });
  assert.deepEqual(B.splitGross(500, 0), { gross: 500, net: 500, vat: 0 });
  for (let g = -500; g <= 3000; g += 7) for (const r of [20, 13, 10, 4.9, 0]) {
    const x = B.splitGross(g, r);
    assert.equal(x.net + x.vat, g);
    assert.ok(Math.abs(x.net * (1 + r / 100) - g) <= 0.5 + r / 200 + 1e-9, `Netto plausibel ${g}@${r}`);
    assert.deepEqual(B.splitGross(-g, r), { gross: -g || 0, net: -x.net || 0, vat: -x.vat || 0 }, "symmetrisch");
  }
});

test("USt auf Netto + Zeilenbeträge", () => {
  assert.equal(B.vatOfNet(1769, 13), 230);
  assert.equal(B.vatOfNet(25, 20), 5);
  assert.equal(B.vatOfNet(5, 10), 1); // 0,5 → 1
  assert.equal(B.vatOfNet(-5, 10), -1);
  assert.equal(B.vatOfNet(4, 10), 0);
  assert.equal(B.vatOfNet(1000, 4.9), 49);
  assert.deepEqual(B.fromNet(10000, 20), { net: 10000, vat: 2000, gross: 12000 });
  assert.equal(B.lineNet(1.5, 333), 500); // 499,5 → 500
  assert.equal(B.lineNet(3, 3333), 9999);
  assert.equal(B.lineNet("0,333", 100), 33);
  assert.equal(B.lineNet(-1.5, 333), -500);
  assert.equal(B.normRate("4,9 %"), 4.9);
  assert.equal(B.normRate(120), null);
  assert.equal(B.fmtRate(4.9), "4,9 %");
});

const ITEMS = [{ qty: 2, unit: "Std", text: "Arbeitszeit", price: 5000, rate: 20 }, { qty: 1, text: "Buch", price: 1999, rate: 10 }, { qty: 3, text: "Kleinmaterial", price: 333, rate: 20 }];

test("Rechnungssummen: USt je Satz auf die Netto-Summe; Kleinunternehmer ohne USt", () => {
  const t = B.invoiceTotals({ items: ITEMS, ku: false });
  assert.deepEqual(t.lines.map((l) => l.net), [10000, 1999, 999]);
  assert.deepEqual(t.groups, [{ rate: 20, net: 10999, vat: 2200, gross: 13199 }, { rate: 10, net: 1999, vat: 200, gross: 2199 }]);
  assert.equal(t.net, 12998); assert.equal(t.vat, 2400); assert.equal(t.gross, 15398);
  const k = B.invoiceTotals({ items: ITEMS, ku: true });
  assert.equal(k.ku, true); assert.equal(k.vat, 0); assert.equal(k.gross, 12998); assert.equal(k.groups.length, 1);
  const draft = B.invoiceTotals({ items: ITEMS }, { kleinunternehmer: false });
  assert.equal(draft.vat, 2400, "Entwurf folgt der Einstellung");
});

test("Nummernkreis: fortlaufend je Jahr, ohne Lücke, nie wiederverwendet", () => {
  const st = { numFormat: "{JJJJ}-{NNN}", counters: {} };
  assert.deepEqual(B.nextNumber(st, [], 2026), { number: "2026-001", seq: 1, key: "2026" });
  const inv = [{ number: "2026-003", seq: 3, numKey: "2026" }, { number: "2025-009", seq: 9, numKey: "2025" }];
  assert.equal(B.nextNumber(st, inv, 2026).number, "2026-004");
  assert.equal(B.nextNumber({ ...st, counters: { 2026: 5 } }, inv, 2026).number, "2026-006", "Zähler zählt, auch wenn Rechnung fehlt (nie wiederverwenden)");
  assert.equal(B.nextNumber(st, inv, 2027).number, "2027-001");
  assert.equal(B.nextNumber(st, [{ number: "2026-012" }], 2026).number, "2026-013", "alte Nummer ohne seq wird gelesen");
  assert.equal(B.formatNumber("R{JJ}/{NNNN}", 2026, 7), "R26/0007");
  assert.equal(B.formatNumber("{JJJJ}-{NNN}", 2026, 1234), "2026-1234");
  assert.equal(B.counterKey("RE-{NNNN}", 2026), "all");
  assert.equal(B.nextNumber({ numFormat: "RE-{NNNN}", counters: { all: 41 } }, [], 2027).number, "RE-0042", "ohne Jahr: durchgehend");
  assert.equal(B.parseSeq("2026-007", "{JJJJ}-{NNN}", 2026), 7);
  assert.equal(B.parseSeq("2025-007", "{JJJJ}-{NNN}", 2026), 0);
  assert.equal(B.parseSeq("R26/0011", "R{JJ}/{NNNN}", 2026), 11);
  assert.ok(B.validFormat("{JJJJ}-{NNN}"));
  assert.ok(!B.validFormat("{JJJJ}"));
  assert.ok(!B.validFormat("{N}-{NN}"));
  assert.ok(!B.validFormat("<b>{N}"));
  assert.equal(B.normSettings({ numFormat: "kaputt" }).numFormat, B.DEFAULT_FORMAT);
  assert.deepEqual(B.numberAudit([{ numKey: "2026", seq: 1 }, { numKey: "2026", seq: 4 }, { numKey: "2026", seq: 4 }, { numKey: "2025", seq: 2 }], "2026"), { gaps: [2, 3], dups: [4] });
});

const SET = { firm: "Muster Handwerk", address: "Musterweg 1, 8010 Graz", uid: "ATU12345678", iban: "AT61 1904 3002 3457 3201", kleinunternehmer: false, numFormat: "{JJJJ}-{NNN}", counters: {} };

test("Pflichtangaben-Prüfung: Fehler blockieren, Hinweise warnen; Kleinbetragsrechnung", () => {
  const empty = B.checkInvoice({}, {});
  assert.ok(empty.errors.some((e) => /Firmenname/.test(e)) && empty.errors.some((e) => /Position/.test(e)) && empty.errors.some((e) => /Leistungsdatum/.test(e)) && empty.errors.some((e) => /Rechnungsdatum/.test(e)));
  const good = { date: "2026-11-08", serviceFrom: "2026-11-05", items: ITEMS, customer: { name: "Kunde GmbH", address: "Weg 2, 8020 Graz" } };
  const r = B.checkInvoice(good, SET);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  const noAddr = B.checkInvoice({ ...good, items: [{ qty: 10, text: "Montage", price: 10000, rate: 20 }], customer: { name: "Kunde" } }, SET);
  assert.ok(noAddr.errors.some((e) => /Anschrift des Empfängers/.test(e)));
  const small = B.checkInvoice({ ...good, items: [{ qty: 1, text: "Kleinkram", price: 1000, rate: 20 }], customer: {} }, SET);
  assert.ok(small.small && small.errors.length === 0 && small.warnings.some((w) => /Kleinbetragsrechnung/.test(w)));
  const big = B.checkInvoice({ ...good, items: [{ qty: 100, text: "Anlage", price: 10000, rate: 20 }] }, SET);
  assert.ok(big.warnings.some((w) => /10\.000/.test(w)));
  const goodBig = { ...good, items: [{ qty: 10, text: "Montage", price: 10000, rate: 20 }] };
  const noUid = B.checkInvoice(goodBig, { ...SET, uid: "" });
  assert.ok(noUid.warnings.some((w) => /UID-Nummer fehlt/.test(w)));
  const ku = B.checkInvoice(goodBig, { ...SET, uid: "", kleinunternehmer: true });
  assert.ok(!ku.warnings.some((w) => /UID-Nummer fehlt/.test(w)), "Kleinunternehmer brauchen keine UID");
  assert.ok(B.checkInvoice({ ...good, serviceFrom: "2026-11-05", serviceTo: "2026-11-01" }, SET).errors.some((e) => /„bis“/.test(e)));
  assert.ok(B.checkInvoice(good, { ...SET, iban: "AT61 1904 3002 3457 3202" }).warnings.some((w) => /IBAN/.test(w)));
});

test("IBAN + UID prüfen", () => {
  assert.ok(B.ibanOk("AT61 1904 3002 3457 3201"));
  assert.ok(!B.ibanOk("AT61 1904 3002 3457 3202"));
  assert.ok(B.ibanOk(""));
  assert.equal(B.fmtIban("AT611904300234573201"), "AT61 1904 3002 3457 3201");
  assert.ok(B.uidOk("ATU12345678"));
  assert.ok(!B.uidOk("ATU1234"));
  assert.ok(B.uidOk("DE123456789"));
});

test("Abschließen → Nummer, Fälligkeit, eingefrorene Firmendaten; bezahlt → Einnahmen je Satz; Storno → eigene Nummer, exakt negativ", () => {
  const draft = { id: "r1", status: "entwurf", date: "2026-11-08", serviceFrom: "2026-11-05", dueDays: 14, items: ITEMS, customer: { name: "Kunde GmbH", address: "Weg 2" } };
  const f = B.finalize(draft, SET, [], "2026-11-08");
  assert.equal(f.invoice.number, "2026-001");
  assert.equal(f.invoice.status, "offen");
  assert.equal(f.invoice.dueDate, "2026-11-22");
  assert.equal(f.invoice.ku, false);
  assert.equal(f.invoice.seller.firm, "Muster Handwerk");
  assert.deepEqual(f.counters, { 2026: 1 });
  assert.throws(() => B.finalize(f.invoice, SET, [], "2026-11-08"));
  assert.equal(B.invoiceStatus(f.invoice, "2026-11-22"), "offen");
  assert.equal(B.invoiceStatus(f.invoice, "2026-11-23"), "ueberfaellig");
  // Kleinunternehmer-Status bleibt eingefroren, auch wenn die Einstellung später wechselt
  assert.equal(B.invoiceTotals(f.invoice, { kleinunternehmer: true }).vat, 2400);

  const bk = B.paidBookings(f.invoice, SET, { date: "2026-12-01", pay: "bank", newId: nid });
  assert.equal(bk.length, 2);
  assert.deepEqual(bk.map((b) => [b.type, b.gross, b.rate, b.invoiceId, b.cat]), [["in", 13199, 20, "r1", "erloese"], ["in", 2199, 10, "r1", "erloese"]]);
  const sm = B.sums(bk, { ku: false });
  assert.equal(sm.inGross, 15398); assert.equal(sm.inVat, 2400, "USt der Belege = USt der Rechnung");

  const st2 = { ...SET, counters: f.counters };
  const all = [f.invoice];
  const so = B.stornoOf(f.invoice, st2, all, "2026-11-10", nid);
  assert.equal(so.storno.number, "2026-002");
  assert.equal(so.storno.kind, "storno");
  assert.equal(so.storno.refNumber, "2026-001");
  assert.equal(so.orig.status, "storniert");
  assert.equal(so.orig.stornoId, so.storno.id);
  const t1 = B.invoiceTotals(f.invoice), t2 = B.invoiceTotals(so.storno);
  assert.deepEqual([t2.net, t2.vat, t2.gross], [-t1.net, -t1.vat, -t1.gross]);
  assert.equal(B.invoiceStatus(so.storno, "2026-12-31"), "storno");
  assert.throws(() => B.stornoOf(so.orig, st2, all, "2026-11-10", nid), /nicht storniert/);
  assert.throws(() => B.stornoOf(so.storno, st2, all, "2026-11-10", nid));
  assert.throws(() => B.stornoOf(draft, st2, all, "2026-11-10", nid));
});

const BELEGE = [
  { id: "b1", type: "in", date: "2026-01-15", gross: 12000, rate: 20, cat: "erloese" },
  { id: "b2", type: "out", date: "2026-02-03", gross: 6000, rate: 20, cat: "material" },
  { id: "b3", type: "out", date: "2026-08-20", gross: 1100, rate: 10, cat: "buero" },
  { id: "b4", type: "in", date: "2025-12-31", gross: 99900, rate: 20, cat: "erloese" },
  { id: "b5", type: "in", date: "", gross: 500, rate: 20 },
];

test("E/A-Summen (Zahlungsdatum!) + Zahllast; Kleinunternehmer im Bruttosystem", () => {
  const y = B.periodRange(2026, "year");
  const r = B.sums(BELEGE, { ku: false, ...y });
  assert.equal(r.income, 10000); assert.equal(r.expense, 6000); assert.equal(r.profit, 4000);
  assert.equal(r.inVat, 2000); assert.equal(r.outVat, 1100); assert.equal(r.zahllast, 900);
  assert.equal(r.count, 3, "ohne Datum und anderes Jahr zählt nicht");
  const k = B.sums(BELEGE, { ku: true, ...y });
  assert.equal(k.income, 12000); assert.equal(k.expense, 7100); assert.equal(k.profit, 4900); assert.equal(k.zahllast, 0);
  const rep = B.report(BELEGE, 2026, { by: "quarter" });
  assert.equal(rep.rows.length, 4);
  assert.deepEqual(rep.rows.map((x) => x.zahllast), [1000, 0, -100, 0]);
  assert.deepEqual(rep.rows.map((x) => x.label), ["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2026"]);
  assert.equal(rep.total.profit, 4000);
  const mon = B.report(BELEGE, 2026, { by: "month" });
  assert.equal(mon.rows.length, 12);
  assert.equal(mon.rows[1].expense, 5000);
  assert.equal(mon.rows[1].label, "Februar 2026");
  assert.deepEqual(B.periodRange(2028, "month", 2), { from: "2028-02-01", to: "2028-02-29", label: "Februar 2028" });
  assert.deepEqual(B.periodRange(2026, "quarter", 4), { from: "2026-10-01", to: "2026-12-31", label: "Q4 2026" });
  const cats = B.byCategory(BELEGE, 2026);
  assert.equal(cats[0].cat, "erloese");
  const rows = B.summaryRows(rep);
  assert.equal(rows[0].length, 7); assert.equal(rows.at(-1)[0], "Summe 2026"); assert.equal(rows.at(-1)[6], "9,00");
  assert.equal(B.summaryRows(B.report(BELEGE, 2026, { ku: true, by: "quarter" }))[0].length, 4, "Kleinunternehmer: keine USt-Spalten");
});

test("Kleinunternehmer-Grenze: 55.000 € brutto, Toleranz bis 60.500 €", () => {
  const mk = (euro) => [{ type: "in", date: "2026-03-01", gross: euro * 100, rate: 0 }];
  assert.equal(B.kuProgress(mk(10000), [], 2026).state, "ok");
  assert.equal(B.kuProgress(mk(50000), [], 2026).state, "near");
  assert.equal(B.kuProgress(mk(50000), [], 2026).pct, 90.9);
  assert.equal(B.kuProgress(mk(55000), [], 2026).state, "near", "genau an der Grenze: noch drin");
  assert.equal(B.kuProgress(mk(56000), [], 2026).state, "tolerance");
  assert.equal(B.kuProgress(mk(60500), [], 2026).state, "tolerance");
  assert.equal(B.kuProgress(mk(60501), [], 2026).state, "over");
  assert.equal(B.kuProgress([], [], 2026).tolLimit, 6050000);
  const open = [{ kind: "rechnung", status: "offen", date: "2026-05-01", number: "2026-001", ku: true, items: [{ qty: 1, text: "x", price: 5000000 }] }];
  assert.equal(B.kuProgress(mk(1000), open, 2026).sum, 5100000, "offene Rechnungen des Jahres zählen mit");
  assert.equal(B.kuProgress(mk(1000), [{ ...open[0], status: "bezahlt" }], 2026).sum, 100000, "bezahlte stecken schon in den Einnahmen");
});

test("GWG-Hinweis, Aufbewahrung, fällige Rechnungen", () => {
  assert.equal(B.gwgWarn({ type: "out", cat: "gwg", gross: 120000, rate: 20 }), "");
  assert.match(B.gwgWarn({ type: "out", cat: "gwg", gross: 120100, rate: 20 }), /AfA/);
  assert.match(B.gwgWarn({ type: "out", cat: "gwg", gross: 110000, rate: 20 }, true), /brutto/, "Kleinunternehmer: brutto zählt");
  assert.equal(B.keepUntil("2026-03-01"), "31.12.2033");
  const list = [
    { id: "a", kind: "rechnung", status: "offen", number: "2026-001", dueDate: "2026-11-01", items: [{ qty: 1, price: 100, text: "x" }], customer: { name: "A" } },
    { id: "b", kind: "rechnung", status: "offen", number: "2026-002", dueDate: "2026-11-10", items: [], customer: { name: "B" } },
    { id: "c", kind: "rechnung", status: "bezahlt", number: "2026-003", dueDate: "2026-11-01" },
    { id: "d", kind: "storno", status: "offen", number: "2026-004", dueDate: "2026-11-01" },
  ];
  const due = B.dueInvoices(list, "2026-11-08");
  assert.deepEqual(due.map((d) => [d.id, d.overdue, d.soon, d.days]), [["a", true, false, -7], ["b", false, true, 2]]);
  assert.equal(due[0].hash, "#alltag/buchhaltung/rechnung/a");
});

test("CSV: ; + BOM + CRLF, Formel-Schutz, Belege-Liste mit Dokument-Referenzen", () => {
  const c = B.belegeCSV([...BELEGE, { id: "x", type: "out", date: "2026-04-01", gross: 250, rate: 20, partner: "=HYPERLINK(1)", note: "a;b \"c\"", cat: "buero", docIds: ["d1"] }], { ku: false, year: 2026 });
  assert.ok(c.startsWith("﻿Datum (Zahlung);Art;Kategorie"));
  assert.ok(c.endsWith("\r\n"));
  const lines = c.slice(1).trim().split("\r\n");
  assert.equal(lines.length, 5, "Kopf + 4 Belege aus 2026");
  assert.equal(lines[1], "15.01.2026;Einnahme;Erlöse (Verkauf/Leistung);;;120,00;20;100,00;20,00;Überweisung;;;31.12.2033");
  assert.ok(c.includes("'=HYPERLINK(1)"), "Formel-Schutz");
  assert.ok(c.includes('"a;b ""c"""'), "Quoting");
  assert.ok(c.includes(";4,9;") === false);
  const inv = [{ id: "r1", kind: "rechnung", status: "offen", number: "2026-001", date: "2026-11-08", dueDate: "2026-11-22", ku: false, items: ITEMS, customer: { name: "Kunde; GmbH" } }];
  const ic = B.invoicesCSV(inv, { today: "2026-11-30" });
  assert.ok(ic.includes('2026-001;Rechnung;08.11.2026;;;"Kunde; GmbH";;129,98;24,00;153,98;Überfällig;22.11.2026;;'));
  const bl = B.belegListCSV([{ id: "b1", type: "out", date: "2026-02-01", gross: 100, docIds: [] }, { id: "b2", type: "in", date: "2026-02-02", gross: 100, invoiceId: "r1" }, { id: "b3", type: "out", date: "2026-02-03", gross: 100, docIds: ["doc9"] }],
    { invoices: inv, docRefs: (b) => b.docIds.map((d) => "Dokument " + d) });
  assert.ok(bl.includes("Beleg fehlt") && bl.includes("Ausgangsrechnung (Nr. 2026-001)") && bl.includes("Dokument doc9;abgelegt"));
});

test("Belegscanner: striktes JSON prüfen, Unsinn verwerfen", () => {
  const r = B.parseScan('Hier:\n```json\n{"datum":"03.11.2026","betrag_brutto":"23,90","ust_satz":20,"haendler":"Baumarkt Muster","kategorie_vorschlag":"material"}\n```');
  assert.deepEqual(r, { date: "2026-11-03", gross: 2390, rate: 20, partner: "Baumarkt Muster", cat: "material" });
  assert.deepEqual(B.parseScan('{"datum":"2026-11-03","betrag_brutto":12.3,"ust_satz":4.9,"haendler":"Bäcker","kategorie_vorschlag":"Büro"}'), { date: "2026-11-03", gross: 1230, rate: 4.9, partner: "Bäcker", cat: "buero" });
  assert.deepEqual(B.parseScan('{"datum":"31.02.2026","betrag_brutto":-5,"ust_satz":7,"haendler":null,"kategorie_vorschlag":"rakete"}'), { date: "", gross: null, rate: null, partner: "", cat: "" });
  assert.equal(B.parseScan("keine Ahnung"), null);
  assert.equal(B.parseScan("{kaputt"), null);
  assert.match(B.SCAN_PROMPT, /betrag_brutto/);
});

test("Normalisieren + Routen", () => {
  const st = B.normSettings({});
  assert.equal(st.kleinunternehmer, true); assert.equal(st.lockWithMoney, true); assert.equal(st.dueDays, 14); assert.equal(st.numFormat, "{JJJJ}-{NNN}");
  assert.equal(B.normSettings({ logo: "data:image/svg+xml;base64,AAA" }).logo, "", "kein SVG-Logo");
  assert.equal(B.normSettings({ lockWithMoney: false }).lockWithMoney, false);
  const b = B.normBeleg({ type: "in", cat: "material", gross: 12.5, rate: "13" });
  assert.equal(b.cat, "erloese", "Kategorie passt zur Art"); assert.equal(b.gross, 0, "nur Cent-Integer"); assert.equal(b.rate, 13);
  assert.deepEqual(B.route("#alltag/buchhaltung/rechnung/r%201"), { tab: "rechnung", id: "r 1" });
  assert.deepEqual(B.route("#alltag/buchhaltung"), { tab: "", id: "" });
  assert.deepEqual(B.route("#alltag/buchhaltung/auswertung?x=1"), { tab: "auswertung", id: "" });
  assert.equal(B.belegHash("a b"), "#alltag/buchhaltung/beleg/a%20b");
});
