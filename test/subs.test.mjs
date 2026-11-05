// node --test test/subs.test.mjs
// Abos: Vertragsart, „Wie lange noch“, Kündigungsfristen (Monatsende, Schaltjahr), Erinnerungen, Katalog.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/alltag/subs-core.js";
import * as K from "../js/alltag/subs-catalog.js";
import * as M from "../js/alltag/money-core.js";

const TODAY = "2026-11-05";

/* ---------- Datum ---------- */

test("addMonths: Monatsende wird gekürzt, Schaltjahre", () => {
  assert.equal(C.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(C.addMonths("2028-01-31", 1), "2028-02-29"); // Schaltjahr
  assert.equal(C.addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(C.addMonths("2024-03-31", -1), "2024-02-29");
  assert.equal(C.addMonths("2026-11-30", 1), "2026-12-30");
  assert.equal(C.addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(C.addMonths("2027-01-15", -2), "2026-11-15");
  assert.equal(C.addMonths("2028-02-29", 12), "2029-02-28");
});

test("endOfMonth / isMonthEnd / monthsBetween", () => {
  assert.equal(C.endOfMonth("2026-02-10"), "2026-02-28");
  assert.equal(C.endOfMonth("2028-02-10"), "2028-02-29");
  assert.equal(C.endOfMonth("2026-12-01"), "2026-12-31");
  assert.ok(C.isMonthEnd("2026-11-30"));
  assert.ok(!C.isMonthEnd("2026-11-29"));
  assert.equal(C.monthsBetween("2026-11-05", "2027-12-31"), 13);
  assert.equal(C.monthsBetween("2026-11-05", "2026-12-04"), 0);
  assert.equal(C.monthsBetween("2026-11-05", "2026-12-05"), 1);
  assert.equal(C.monthsBetween("2026-01-31", "2026-02-28"), 1); // Monatsende → Monatsende
  assert.equal(C.monthsBetween("2027-01-01", "2026-01-01"), 0);
});

test("österreichisches Datumsformat", () => {
  assert.equal(M.fmtDate("2026-11-30"), "30.11.2026");
  assert.equal(C.fmtShort("2026-11-30"), "30.11.");
  assert.equal(C.inDays(TODAY, "2026-11-06"), "morgen");
  assert.equal(C.inDays(TODAY, "2026-11-10"), "in 5 Tagen");
  assert.equal(C.inDays(TODAY, TODAY), "heute");
});

/* ---------- Kündigungsfrist ---------- */

test("parseNotice: Text und Tage", () => {
  assert.deepEqual(C.parseNotice({ noticeText: "1 Monat zum Monatsende" }), { days: 0, months: 1, toMonthEnd: true, text: "1 Monat zum Monatsende" });
  assert.equal(C.parseNotice({ noticeText: "3 Monate" }).months, 3);
  assert.equal(C.parseNotice({ noticeText: "drei Monate vor Ablauf" }).months, 3);
  assert.equal(C.parseNotice({ noticeText: "einen Monat" }).months, 1);
  assert.equal(C.parseNotice({ noticeText: "14 Tage" }).days, 14);
  assert.equal(C.parseNotice({ noticeText: "4 Wochen" }).days, 28);
  assert.equal(C.parseNotice({ noticeDays: 30, noticeText: "irgendwas" }).days, 30);
  assert.equal(C.parseNotice({ noticeText: "meist 1 Monat (Vertrag prüfen)" }).months, 1);
  assert.equal(C.parseNotice({}), null);
  assert.equal(C.parseNotice({ noticeText: "laut Vertrag" }), null);
});

test("cancelDeadline: Monatsende-Regeln und Schaltjahr", () => {
  const mEnd = { months: 1, days: 0, toMonthEnd: true };
  assert.equal(C.cancelDeadline("2026-12-31", mEnd), "2026-11-30");
  assert.equal(C.cancelDeadline("2027-03-31", mEnd), "2027-02-28");
  assert.equal(C.cancelDeadline("2028-03-31", mEnd), "2028-02-29"); // Schaltjahr
  assert.equal(C.cancelDeadline("2027-04-30", mEnd), "2027-03-31"); // Monatsende bleibt Monatsende
  assert.equal(C.cancelDeadline("2027-06-15", { months: 3, days: 0 }), "2027-03-15");
  assert.equal(C.cancelDeadline("2026-12-31", { months: 2, days: 0, toMonthEnd: true }), "2026-10-31"); // ÖAMTC: 31. Oktober
  assert.equal(C.cancelDeadline("2026-12-01", { months: 0, days: 14 }), "2026-11-17");
  assert.equal(C.cancelDeadline("2026-12-01", null), "2026-12-01");
});

test("earliestEnd: Kündigung heute mit Frist", () => {
  const n = { months: 1, days: 0, toMonthEnd: true };
  assert.equal(C.earliestEnd("2026-11-05", n), "2026-12-31");
  assert.equal(C.earliestEnd("2026-11-30", n), "2026-12-31");
  assert.equal(C.earliestEnd("2026-12-01", n), "2027-01-31");
  assert.equal(C.earliestEnd("2028-01-31", { months: 1, days: 0, toMonthEnd: false }), "2028-02-29");
  assert.equal(C.earliestEnd("2026-11-05", { months: 0, days: 14, toMonthEnd: false }), "2026-11-19");
});

/* ---------- Vertragsart & Status ---------- */

const netflix = { id: "n1", name: "Netflix", amount: 13.99, interval: "month", next: "2026-11-15", day: 15 };

test("contractTypeOf: alte Abos ohne Feld", () => {
  assert.equal(C.contractTypeOf(netflix), "monatlich kündbar");
  assert.equal(C.contractTypeOf({ trialEnd: "2026-11-10" }), "Testzeitraum");
  assert.equal(C.contractTypeOf({ minTermEnd: "2027-01-01" }), "Mindestlaufzeit");
  assert.equal(C.contractTypeOf({ contractType: "Prepaid", minTermEnd: "2027-01-01" }), "Prepaid");
});

test("Status monatlich kündbar: nächste Abbuchung, jederzeit kündbar bis", () => {
  const st = C.subStatus(netflix, TODAY);
  assert.equal(st.kind, "monthly");
  assert.equal(st.line, "läuft monatlich, nächste Abbuchung am 15.11.2026 – jederzeit kündbar bis 14.11.2026");
  assert.equal(st.next, "2026-11-15");
  // alter Termin in der Vergangenheit → rollt weiter
  assert.equal(C.subStatus({ ...netflix, next: "2026-09-15" }, TODAY).next, "2026-11-15");
  // jährlich
  assert.match(C.subStatus({ ...netflix, interval: "year", next: "2027-03-01" }, TODAY).line, /^läuft jährlich, nächste Abbuchung am 01\.03\.2027/);
  // mit Frist
  assert.match(C.subStatus({ ...netflix, noticeText: "1 Monat zum Monatsende" }, TODAY).line, /kündbar mit 1 Monat zum Monatsende \(frühestens zum 31\.12\.2026\)/);
});

test("Status Mindestlaufzeit: Vertrag bis, noch N Monate, spätestens kündigen bis", () => {
  const a1 = { id: "a", name: "A1", amount: 25, interval: "month", next: "2026-11-20", contractType: "Mindestlaufzeit", minTermEnd: "2027-12-31", noticeText: "1 Monat zum Monatsende", autoRenew: true };
  const st = C.subStatus(a1, TODAY);
  assert.equal(st.kind, "term");
  assert.equal(st.line, "Vertrag bis 31.12.2027 (noch 13 Monate) · spätestens kündigen bis 30.11.2027");
  assert.equal(st.deadline, "2027-11-30");
  assert.equal(st.urgent, false);
  // knapp vor der Frist
  const near = C.subStatus({ ...a1, minTermEnd: "2026-12-31" }, TODAY);
  assert.equal(near.line, "Vertrag bis 31.12.2026 (noch 1 Monat) · spätestens kündigen bis 30.11.2026");
  assert.equal(near.daysToDeadline, 25);
  // Frist verpasst → Hinweis
  const late = C.subStatus({ ...a1, minTermEnd: "2026-11-20" }, TODAY);
  assert.match(late.line, /Vertrag bis 20\.11\.2026 \(noch 15 Tage\) · Kündigungsfrist dafür vorbei \(20\.10\.2026\) – verlängert sich/);
  assert.equal(late.deadline, null);
});

test("termEnd: nach Ablauf mit Auto-Verlängerung weiterrollen", () => {
  const gym = { interval: "month", minTermEnd: "2026-06-30", autoRenew: true };
  assert.equal(C.termEnd(gym, TODAY), "2026-11-30");
  const yearly = { interval: "year", minTermEnd: "2025-12-31", autoRenew: true };
  assert.equal(C.termEnd(yearly, TODAY), "2026-12-31");
  assert.equal(C.termEnd({ ...yearly, autoRenew: false }, TODAY), "2025-12-31");
  // Schaltjahr-Monatsende
  assert.equal(C.termEnd({ interval: "year", minTermEnd: "2024-02-29", autoRenew: true }, "2025-01-10"), "2025-02-28");
});

test("Status Testzeitraum: endet in N Tagen", () => {
  const t = { id: "t", name: "Disney+", amount: 9.99, interval: "month", next: "2026-11-11", contractType: "Testzeitraum", trialEnd: "2026-11-10" };
  const st = C.subStatus(t, TODAY);
  assert.equal(st.kind, "trial");
  assert.equal(st.line, "Testzeitraum endet in 5 Tagen (10.11.2026) – danach 9,99 € monatlich");
  assert.equal(st.deadline, "2026-11-09");
  assert.equal(C.subStatus({ ...t, trialEnd: "2026-11-06" }, TODAY).line.startsWith("Testzeitraum endet morgen"), true);
  assert.equal(C.subStatus({ ...t, trialEnd: TODAY }, TODAY).line.startsWith("Testzeitraum endet heute"), true);
  // vorbei → normales Abo
  assert.equal(C.subStatus({ ...t, trialEnd: "2026-10-01", next: "2026-11-11" }, TODAY).kind, "monthly");
});

test("Status gekündigt / beendet / pausiert / Prepaid", () => {
  const c = C.subStatus({ ...netflix, cancelledOn: "2026-11-05", ended: "2026-11-14" }, TODAY);
  assert.equal(c.kind, "cancelled");
  assert.equal(c.line, "gekündigt am 05.11.2026, läuft aus am 14.11.2026");
  const e = C.subStatus({ ...netflix, cancelledOn: "2026-09-01", ended: "2026-09-30" }, TODAY);
  assert.equal(e.kind, "ended");
  assert.equal(e.line, "gekündigt am 01.09.2026, ausgelaufen am 30.09.2026");
  // altes Gmail-Ende (paused + ended)
  assert.equal(C.subStatus({ ...netflix, paused: true, ended: "2026-10-01" }, TODAY).line, "beendet am 01.10.2026");
  assert.equal(C.subStatus({ ...netflix, paused: true }, TODAY).kind, "paused");
  const pp = C.subStatus({ name: "HoT", amount: 50, interval: "year", contractType: "Prepaid", contractEnd: "2027-03-31", next: "2027-04-01", autoRenew: false }, TODAY);
  assert.equal(pp.line, "Prepaid – bezahlt bis 31.03.2027 (noch 4 Monate), keine automatische Verlängerung");
});

test("cancelEndDate: Vorschlag für „läuft aus am“", () => {
  assert.equal(C.cancelEndDate(netflix, TODAY), "2026-11-14");
  assert.equal(C.cancelEndDate({ ...netflix, noticeText: "1 Monat zum Monatsende" }, TODAY), "2026-12-31");
  const term = { interval: "month", next: "2026-11-20", contractType: "Mindestlaufzeit", minTermEnd: "2026-12-31", noticeText: "1 Monat zum Monatsende", autoRenew: true };
  assert.equal(C.cancelEndDate(term, TODAY), "2026-12-31");
  // Frist verpasst → nächste Periode
  assert.equal(C.cancelEndDate(term, "2026-12-05"), "2027-01-31");
  const trial = { interval: "month", next: "2026-11-10", contractType: "Testzeitraum", trialEnd: "2026-11-10" };
  assert.equal(C.cancelEndDate(trial, TODAY), "2026-11-09"); // nie über die erste Abbuchung hinaus
  assert.equal(C.cancelEndDate({ ...trial, next: "2026-11-11" }, TODAY), "2026-11-10");
});

test("Gekündigt: automatische Buchung endet nach dem letzten Tag", () => {
  const sub = { ...netflix, next: "2026-10-15", cancelledOn: "2026-11-01", ended: "2026-12-14" };
  const { txs, next } = M.dueBookings(sub, "2027-02-01", new Set());
  assert.deepEqual(txs.map((t) => t.date), ["2026-10-15", "2026-11-15"]); // 15.12. liegt nach dem Ende
  assert.equal(next, "2026-12-15");
  assert.equal(M.upcoming([sub], TODAY, 60).length, 1);
  assert.equal(C.nextCharge(sub, "2026-11-20"), null);
});

test("subsSummary: Summen ohne laufende Testzeiträume, Fristen bald", () => {
  const subs = [
    netflix,
    { id: "y", name: "M365", amount: 99, interval: "year", next: "2027-03-01" },
    { id: "a", name: "A1", amount: 25, interval: "month", next: "2026-11-20", contractType: "Mindestlaufzeit", minTermEnd: "2026-12-31", noticeText: "1 Monat zum Monatsende" },
    { id: "t", name: "Disney+", amount: 9.99, interval: "month", next: "2026-11-11", contractType: "Testzeitraum", trialEnd: "2026-11-10" },
    { id: "x", name: "Alt", amount: 5, interval: "month", next: "2026-11-11", paused: true },
    { id: "z", name: "Weg", amount: 7, interval: "month", next: "2026-11-11", cancelledOn: "2026-09-01", ended: "2026-09-30" },
  ];
  const s = C.subsSummary(subs, TODAY);
  assert.equal(s.perMonth, M.round2(13.99 + 8.25 + 25));
  assert.equal(s.perYear, M.round2(13.99 * 12 + 99 + 25 * 12));
  assert.deepEqual(s.deadlines.map((d) => [d.sub.id, d.date]), [["a", "2026-11-30"]]);
  assert.deepEqual(s.trials.map((d) => [d.sub.id, d.date, d.days]), [["t", "2026-11-10", 5]]);
});

/* ---------- Erinnerungen ---------- */

test("reminderFor: 3 Tage vor der Frist, einmal pro Frist", () => {
  const a1 = { id: "a1x", name: "Netflix", amount: 25, interval: "month", next: "2026-11-20", contractType: "Mindestlaufzeit", minTermEnd: "2026-12-31", noticeText: "1 Monat zum Monatsende", cancelUrl: "https://www.netflix.com/cancelplan" };
  const r = C.reminderFor(a1, TODAY);
  assert.equal(r.title, "Netflix kündigen bis 30.11.");
  assert.equal(r.date, "2026-11-27");
  assert.equal(r.deadline, "2026-11-30");
  assert.equal(r.id, "abo_a1x_20261130");
  assert.match(r.note, /https:\/\/www\.netflix\.com\/cancelplan/);
  assert.equal(C.reminderFor({ ...a1, remindedFor: "2026-11-30" }, TODAY), null);
  assert.equal(C.reminderFor({ ...a1, remind: false }, TODAY), null);
  assert.equal(C.reminderFor({ ...a1, cancelledOn: TODAY, ended: "2026-12-31" }, TODAY), null);
  // zu weit weg
  assert.equal(C.reminderFor({ ...a1, minTermEnd: "2027-12-31" }, TODAY), null);
  // Testzeitraum: Frist = Tag vor Ende, Erinnerung frühestens heute
  const tr = C.reminderFor({ id: "t", name: "Disney+", amount: 9.99, interval: "month", next: "2026-11-08", trialEnd: "2026-11-07" }, TODAY);
  assert.equal(tr.deadline, "2026-11-06");
  assert.equal(tr.date, TODAY);
  assert.equal(tr.title, "Disney+ kündigen bis 06.11.");
  // monatlich kündbar → keine Erinnerung (sonst jeden Monat)
  assert.equal(C.reminderFor(netflix, TODAY), null);
});

/* ---------- Katalog ---------- */

test("Katalog: alle geforderten Dienste mit offiziellem https-Link und Schritten", () => {
  const want = ["netflix", "spotify", "disney", "youtube", "prime", "audible", "apple", "icloud", "applemusic", "googleplay", "googleone", "m365", "gamepass", "psplus", "nintendo", "dazn", "wow", "crunchyroll", "twitch", "nitro", "snapchat", "chatgpt", "claude", "duolingo", "tinder", "mcfit", "fitinn", "cleverfit", "a1", "magenta", "drei", "hot", "spusu", "yesss", "oeamtc"];
  for (const k of want) {
    const e = K.catalogByKey(k);
    assert.ok(e, k);
    assert.match(e.cancelUrl, /^https:\/\//, k);
    assert.ok(e.cancelHow.length > 40, k);
    assert.ok(e.what && M.INTERVALS[e.interval], k);
    assert.ok(e.verified === true || e.verified === "suche", k);
    assert.ok(!/resubs|volders|subtracker|kuendigen\.de|aboalarm/i.test(e.cancelUrl + (e.manageUrl || "")), "keine Drittanbieter: " + k);
  }
  // Telekom: Frist nur als „meist“
  for (const k of ["a1", "magenta", "drei", "hot", "spusu"]) assert.match(K.catalogByKey(k).cancelHow + K.catalogByKey(k).noticeText, /meist/, k);
});

test("matchCatalog: unscharf, kurze Kürzel nur als ganzes Wort", () => {
  const m = (n) => (K.matchCatalog(n) || { entry: { key: null } }).entry.key;
  assert.equal(m("Netflix"), "netflix");
  assert.equal(m("netflix standard"), "netflix");
  assert.equal(m("Spotfiy"), "spotify");
  assert.equal(m("Disney Plus"), "disney");
  assert.equal(m("Disney+"), "disney");
  assert.equal(m("YouTube Premium Family"), "youtube");
  assert.equal(m("Apple Music"), "applemusic");
  assert.equal(m("iCloud+ 50 GB"), "icloud");
  assert.equal(m("Handy A1"), "a1");
  assert.equal(m("ÖAMTC Mitgliedschaft"), "oeamtc");
  assert.equal(m("Clever Fit"), "cleverfit");
  assert.equal(m("Xbox Game Pass Ultimate"), "gamepass");
  assert.equal(m("Claude Pro"), "claude");
  assert.equal(m("Miete"), null);
  assert.equal(m("Fahrschule"), null);
  assert.equal(m("Hotel"), null); // „hot“ nur als ganzes Wort
  assert.equal(m(""), null);
});

test("catalogFill: nur leere Felder, Intervall nur auf Wunsch", () => {
  const e = K.catalogByKey("netflix");
  const f = K.catalogFill({ name: "Netflix", interval: "year", what: "Mein Text" }, e);
  assert.equal(f.what, undefined);
  assert.equal(f.cancelUrl, "https://www.netflix.com/cancelplan");
  assert.equal(f.interval, undefined);
  assert.equal(f.catalogKey, "netflix");
  assert.equal(K.catalogFill({}, K.catalogByKey("m365"), { interval: true }).interval, "year");
  assert.equal(K.catalogFill({}, K.catalogByKey("fitinn"), { interval: true }).contractType, "Mindestlaufzeit");
  assert.deepEqual(K.catalogFill({}, null), {});
});

test("describeSub: Text für Claude mit Link und Frist", () => {
  const lines = C.describeSub({ ...netflix, what: "Streaming", cancelUrl: "https://www.netflix.com/cancelplan", account: "flo@example.com", cancelHow: "1. A\n2. B" }, TODAY).join("\n");
  assert.match(lines, /^Netflix – Streaming/);
  assert.match(lines, /Preis: 13,99 € monatlich/);
  assert.match(lines, /Wie lange noch: läuft monatlich, nächste Abbuchung am 15\.11\.2026/);
  assert.match(lines, /Kündigungslink: https:\/\/www\.netflix\.com\/cancelplan/);
  assert.match(lines, /Konto\/Login: flo@example\.com \(Passwort steht ggf\. im Passwort-Tresor/);
  assert.match(lines, /So kündigst du: 1\. A \/ 2\. B/);
});
