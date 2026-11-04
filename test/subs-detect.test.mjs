// node --test test/subs-detect.test.mjs
// Synthetische Beispiel-Mails (selbst geschrieben), deutsch und englisch.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../js/alltag/subs-detect.js";

const TODAY = "2026-11-04";
let n = 0;
const mail = (from, subject, text, date = "2026-10-28T10:00:00Z") => ({ id: "m" + (++n), from, subject, text, date: Date.parse(date) });
const det = (m) => D.detectSub(m, { today: TODAY });

/* ---------- Hilfsfunktionen ---------- */

test("parseNum: österreichische und englische Formate", () => {
  assert.equal(D.parseNum("9,99"), 9.99);
  assert.equal(D.parseNum("9.99"), 9.99);
  assert.equal(D.parseNum("1.234,56"), 1234.56);
  assert.equal(D.parseNum("1,234.56"), 1234.56);
  assert.equal(D.parseNum("12"), 12);
  assert.equal(D.parseNum("1.299"), 1299);
});

test("findAmounts: 9,99 € / € 9,99 / EUR 9.99 / 9,99 EUR", () => {
  const vals = D.findAmounts("a 9,99 € b € 8,49 c EUR 7.99 d 6,99 EUR e 5,- €").map((a) => a.value);
  assert.deepEqual(vals, [9.99, 8.49, 7.99, 6.99, 5]);
});

test("pickAmount ignoriert MwSt und nimmt Gesamtbetrag", () => {
  const t = "Zwischensumme 9,16 €\nMwSt. (20 %) 1,83 €\nGesamtbetrag 10,99 €";
  assert.equal(D.pickAmount(t).value, 10.99);
});

test("parseInterval: monatlich / jährlich / wöchentlich", () => {
  assert.equal(D.parseInterval("12,99 € pro Monat"), "month");
  assert.equal(D.parseInterval("4,99 €/Mon."), "month");
  assert.equal(D.parseInterval("billed annually"), "year");
  assert.equal(D.parseInterval("jährlich 69,99 €"), "year");
  assert.equal(D.parseInterval("2,99 € wöchentlich"), "week");
  assert.equal(D.parseInterval("$4.99 per week"), "week");
  assert.equal(D.parseInterval("mtl. 15 €"), "month");
});

test("findDates: verschiedene Datumsformate", () => {
  const k = (t) => D.findDates(t, "2026-10-28").map((d) => d.key);
  assert.deepEqual(k("am 12.11.2026"), ["2026-11-12"]);
  assert.deepEqual(k("am 12. November 2026"), ["2026-11-12"]);
  assert.deepEqual(k("on November 12, 2026"), ["2026-11-12"]);
  assert.deepEqual(k("on 12 Nov 2026"), ["2026-11-12"]);
  assert.deepEqual(k("bis 03.01."), ["2027-01-03"]);
  assert.deepEqual(k("2026-12-01"), ["2026-12-01"]);
  assert.deepEqual(k("am 5. Jänner"), ["2027-01-05"]);
});

test("mailFromGmail: base64url, text/plain bevorzugt, HTML-Fallback", () => {
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64url");
  const msg = {
    id: "abc", internalDate: String(Date.parse("2026-10-01T08:00:00Z")),
    payload: {
      mimeType: "multipart/alternative",
      headers: [{ name: "Subject", value: "Dein Beleg" }, { name: "From", value: "Spotify <no-reply@spotify.com>" }],
      parts: [
        { mimeType: "text/html", body: { data: b64("<p>HTML&nbsp;10,99&euro;</p>") } },
        { mimeType: "text/plain", body: { data: b64("Premium Individual 10,99 € / Monat – Grüße") } },
      ],
    },
  };
  const m = D.mailFromGmail(msg);
  assert.equal(m.id, "abc");
  assert.equal(m.subject, "Dein Beleg");
  assert.match(m.text, /Premium Individual 10,99 € \/ Monat – Grüße/);
  const onlyHtml = { ...msg, payload: { ...msg.payload, parts: [msg.payload.parts[0]] } };
  assert.equal(D.mailFromGmail(onlyHtml).text, "HTML 10,99€");
  assert.equal(D.htmlToText("<style>x{}</style><table><tr><td>Netflix</td><td>12,99&nbsp;&euro;</td></tr></table>"), "Netflix 12,99 €");
});

/* ---------- Beispiel-Mails (≥ 25) ---------- */

test("01 Spotify Beleg (de)", () => {
  const d = det(mail("Spotify <no-reply@spotify.com>", "Dein Spotify-Beleg",
    "Danke für deine Zahlung!\nPremium Individual\nZeitraum: 12.10.2026 – 11.11.2026\nGesamt: 10,99 €\nDein Abo wird automatisch verlängert. Nächste Zahlung am 12.11.2026.", "2026-10-12T07:00:00Z"));
  assert.equal(d.service, "Spotify");
  assert.equal(d.amount, 10.99);
  assert.equal(d.interval, "month");
  assert.equal(d.nextDate, "2026-11-12");
  assert.equal(d.kind, "renewal");
  assert.ok(d.confidence >= 0.7);
});

test("02 Netflix Preisänderung (de)", () => {
  const d = det(mail("Netflix <info@mailer.netflix.com>", "Eine Aktualisierung zu deinem Abo",
    "Hallo,\nwir passen den Preis deines Standard-Abos an. Ab dem 15.12.2026 kostet dein Abo nicht mehr 13,99 €, sondern von 13,99 € auf 15,99 € pro Monat.\nDein Netflix-Team"));
  assert.equal(d.service, "Netflix");
  assert.equal(d.kind, "price_change");
  assert.equal(d.amount, 15.99);
  assert.equal(d.oldAmount, 13.99);
  assert.equal(d.nextDate, "2026-12-15");
});

test("03 Disney+ Testzeitraum (de)", () => {
  const d = det(mail("Disney+ <disneyplus@mail.disneyplus.com>", "Willkommen bei Disney+",
    "Dein kostenloser Testzeitraum hat begonnen. Dein Testzeitraum endet am 20.11.2026. Danach kostet Disney+ Standard 9,99 € monatlich, sofern du nicht vorher kündigst."));
  assert.equal(d.service, "Disney+");
  assert.equal(d.kind, "trial");
  assert.equal(d.nextDate, "2026-11-20");
  assert.equal(d.amount, 9.99);
});

test("04 YouTube Premium Kündigung (de)", () => {
  const d = det(mail("YouTube <noreply-purchases@youtube.com>", "Deine YouTube Premium-Mitgliedschaft wurde gekündigt",
    "Deine Mitgliedschaft wurde gekündigt. Du hast noch bis zum 30.11.2026 Zugriff auf YouTube Premium."));
  assert.equal(d.service, "YouTube Premium");
  assert.equal(d.kind, "cancel");
  assert.equal(d.nextDate, "2026-11-30");
});

test("05 Google Play Abo für App (de)", () => {
  const d = det(mail("Google Play <googleplay-noreply@google.com>", "Ihr Abo bei Google Play",
    "Ihr Abo für Komfort Wetter Pro bei Google Play wurde verlängert.\nPreis: 2,49 €/Monat\nNächste Zahlung: 3. Dezember 2026\nBestellnummer GPA.3345-1122"));
  assert.equal(d.service, "Komfort Wetter Pro");
  assert.equal(d.via, "Google Play");
  assert.equal(d.amount, 2.49);
  assert.equal(d.nextDate, "2026-12-03");
  assert.equal(d.key, "gp:komfortwetterpro");
});

test("06 Google Play mit bekanntem Dienst (Duolingo, jährlich)", () => {
  const d = det(mail("Google Play <googleplay-noreply@google.com>", "Ihr Abo für Super Duolingo",
    "Vielen Dank. Ihr Abo für Super Duolingo bei Google Play ist jetzt aktiv.\n59,99 €/Jahr\nVerlängert sich automatisch am 28.10.2027.", "2026-10-28T10:00:00Z"));
  assert.equal(d.service, "Duolingo Super");
  assert.equal(d.interval, "year");
  assert.equal(d.amount, 59.99);
  assert.equal(d.kind, "new");
  assert.equal(d.nextDate, "2027-10-28");
});

test("07 Apple iCloud+ Rechnung (de)", () => {
  const d = det(mail("Apple <no_reply@email.apple.com>", "Deine Rechnung von Apple",
    "APPLE-ACCOUNT\niCloud+ mit 50 GB Speicher (Monatlich)\nVerlängert sich am 15.11.2026\n0,99 €\nGesamt 0,99 €", "2026-10-15T10:00:00Z"));
  assert.equal(d.service, "iCloud+");
  assert.equal(d.amount, 0.99);
  assert.equal(d.interval, "month");
  assert.equal(d.nextDate, "2026-11-15");
});

test("08 Apple App Store ohne bekannten Dienst", () => {
  const d = det(mail("Apple <no_reply@email.apple.com>", "Your receipt from Apple",
    "Receipt\nFocusFlow Timer – Pro (Monthly)\nRenews November 22, 2026\n€ 3,99\nTotal € 3,99", "2026-10-22T10:00:00Z"));
  assert.equal(d.service, "Apple (App Store)");
  assert.equal(d.amount, 3.99);
  assert.equal(d.nextDate, "2026-11-22");
});

test("09 Amazon Prime Verlängerung (de)", () => {
  const d = det(mail("Amazon.de <prime@amazon.de>", "Ihre Prime-Mitgliedschaft wurde verlängert",
    "Vielen Dank, dass Sie Prime-Mitglied sind. Ihre Mitgliedschaft wurde zum Preis von 89,90 € jährlich verlängert. Die nächste Verlängerung erfolgt am 02.10.2027.", "2026-10-02T10:00:00Z"));
  assert.equal(d.service, "Amazon Prime");
  assert.equal(d.amount, 89.9);
  assert.equal(d.interval, "year");
  assert.equal(d.nextDate, "2027-10-02");
});

test("10 Normale Amazon-Bestellung ist kein Abo", () => {
  const d = det(mail("Amazon.de <bestellbestaetigung@amazon.de>", "Ihre Amazon.de Bestellung von \"USB-C Kabel\"",
    "Vielen Dank für Ihre Bestellung. Bestellnummer 302-1234567. Gesamtbetrag: 12,99 €. Voraussichtliche Lieferung: Donnerstag, 30.10."));
  assert.equal(d, null);
});

test("11 Audible (de)", () => {
  const d = det(mail("Audible <noreply@audible.de>", "Ihre Audible-Mitgliedschaft – Zahlungsbestätigung",
    "Ihre monatliche Zahlung für das Audible Abo in Höhe von 9,95 € ist eingegangen. Ihr neues Guthaben steht bereit."));
  assert.equal(d.service, "Audible");
  assert.equal(d.amount, 9.95);
  assert.equal(d.interval, "month");
  assert.equal(d.kind, "renewal");
  assert.equal(d.nextDate, "2026-11-28");
});

test("12 DAZN jährlich (en)", () => {
  const d = det(mail("DAZN <no-reply@dazn.com>", "Your DAZN subscription receipt",
    "Thanks for your payment.\nDAZN Annual Plan – paid in full\nAmount charged: EUR 299.99\nYour plan renews on 28 October 2027."));
  assert.equal(d.service, "DAZN");
  assert.equal(d.amount, 299.99);
  assert.equal(d.interval, "year");
  assert.equal(d.nextDate, "2027-10-28");
});

test("13 WOW (Sky) Ticket (de)", () => {
  const d = det(mail("WOW <service@wowtv.at>", "Dein WOW Abo: Bestätigung",
    "Danke für dein Abo! WOW Filme & Serien – 9,99 € monatlich, monatlich kündbar. Nächste Abbuchung: 28.11.2026"));
  assert.equal(d.service, "Sky / WOW");
  assert.equal(d.amount, 9.99);
  assert.equal(d.nextDate, "2026-11-28");
});

test("14 Xbox Game Pass Verlängerung (en)", () => {
  const d = det(mail("Microsoft <microsoft-noreply@microsoft.com>", "Your Xbox Game Pass Ultimate subscription has renewed",
    "Your subscription renewed successfully.\nXbox Game Pass Ultimate\n€17.99/month\nNext billing date: 11/27/2026"));
  assert.equal(d.service, "Xbox Game Pass");
  assert.equal(d.amount, 17.99);
  assert.equal(d.nextDate, "2026-11-27");
});

test("15 PlayStation Plus jährlich (de)", () => {
  const d = det(mail("PlayStation <reply@txn-email.playstation.com>", "Danke für deinen Kauf",
    "PlayStation Plus Essential: 12-monatiges Abonnement\nPreis: 71,99 €\nDein Abonnement verlängert sich automatisch am 28.10.2027."));
  assert.equal(d.service, "PlayStation Plus");
  assert.equal(d.interval, "year");
  assert.equal(d.amount, 71.99);
});

test("16 Microsoft 365 Kündigung (de)", () => {
  const d = det(mail("Microsoft <account-security-noreply@accountprotection.microsoft.com>", "Ihr Microsoft 365 Single-Abonnement wird nicht verlängert",
    "Die automatische Verlängerung wurde deaktiviert. Ihr Abonnement läuft am 14.01.2027 ab."));
  assert.equal(d.service, "Microsoft 365");
  assert.equal(d.kind, "cancel");
  assert.equal(d.nextDate, "2027-01-14");
});

test("17 ChatGPT Plus Receipt (en, USD)", () => {
  const d = det(mail("OpenAI <noreply@tm.openai.com>", "Your ChatGPT Plus subscription receipt",
    "Receipt #2231-9981\nChatGPT Plus Subscription  Oct 20 – Nov 20, 2026\nSubtotal $20.00\nTax $0.00\nTotal $20.00\nAmount paid $20.00", "2026-10-20T10:00:00Z"));
  assert.equal(d.service, "ChatGPT Plus");
  assert.equal(d.amount, 20);
  assert.equal(d.currency, "USD");
  assert.equal(d.nextDate, "2026-11-20");
});

test("18 Claude Pro (en, EUR, VAT)", () => {
  const d = det(mail("Anthropic <invoice+statements@mail.anthropic.com>", "Your receipt from Anthropic, PBC",
    "Claude Pro\nMonthly subscription\nSubtotal €15.00\nVAT (20%) €3.00\nTotal €18.00\nNext payment on December 1, 2026", "2026-11-01T10:00:00Z"));
  assert.equal(d.service, "Claude Pro");
  assert.equal(d.amount, 18);
  assert.equal(d.nextDate, "2026-12-01");
});

test("19 Crunchyroll Free Trial (en)", () => {
  const d = det(mail("Crunchyroll <hello@info.crunchyroll.com>", "Your free trial is ending soon",
    "Heads up! Your free trial ends on November 9, 2026. After that, you'll be charged €6.99/month for Fan membership."));
  assert.equal(d.service, "Crunchyroll");
  assert.equal(d.kind, "trial");
  assert.equal(d.nextDate, "2026-11-09");
  assert.equal(d.amount, 6.99);
});

test("20 Twitch Sub (de)", () => {
  const d = det(mail("Twitch <no-reply@twitch.tv>", "Danke für dein Abo!",
    "Du hast elektrikerlive abonniert. Stufe 1 – 3,99 € pro Monat. Dein Abo verlängert sich am 28.11.2026."));
  assert.equal(d.service, "Twitch");
  assert.equal(d.kind, "new");
  assert.equal(d.amount, 3.99);
});

test("21 Discord Nitro (en)", () => {
  const d = det(mail("Discord <noreply@discord.com>", "Your Discord Nitro receipt",
    "Thanks for subscribing to Nitro!\nNitro Monthly – €9.99\nYour subscription will renew on Nov 28, 2026."));
  assert.equal(d.service, "Discord Nitro");
  assert.equal(d.amount, 9.99);
  assert.equal(d.nextDate, "2026-11-28");
});

test("22 McFit Mitgliedschaft (de)", () => {
  const d = det(mail("McFit <service@mcfit.com>", "Willkommen bei McFit – deine Mitgliedschaft",
    "Deine Mitgliedschaft ist aktiviert. Beitrag: 29,90 € monatlich. Die erste Abbuchung erfolgt per Lastschrift am 01.11.2026."));
  assert.equal(d.service, "McFit");
  assert.equal(d.category, "freizeit");
  assert.equal(d.amount, 29.9);
  assert.equal(d.interval, "month");
  assert.equal(d.nextDate, "2026-12-01", "01.11. liegt vor heute → auf den nächsten Monat weitergeschoben");
});

test("23 Handyrechnung Magenta (de)", () => {
  const d = det(mail("Magenta Telekom <rechnung@magenta.at>", "Ihre Magenta Rechnung Oktober 2026",
    "Ihre Rechnung ist da.\nRechnungsbetrag: 15,00 €\nDer Betrag wird am 10.11.2026 von Ihrem Konto abgebucht.\nTarif: Mobile S, Grundgebühr monatlich"));
  assert.equal(d.service, "Magenta");
  assert.equal(d.category, "handy");
  assert.equal(d.amount, 15);
});

test("24 spusu Rechnung (de)", () => {
  const d = det(mail("spusu <rechnung@spusu.at>", "Deine spusu Rechnung",
    "Hallo! Deine Rechnung für den Tarif spusu 20 beträgt € 7,90. Die Abbuchung erfolgt am 05.11.2026."));
  assert.equal(d.service, "spusu");
  assert.equal(d.amount, 7.9);
  assert.equal(d.nextDate, "2026-11-05");
});

test("25 PayPal automatische Zahlung → Händler", () => {
  const d = det(mail("PayPal <service@paypal.at>", "Sie haben eine automatische Zahlung an Lernhelden GmbH eingerichtet",
    "Automatische Zahlungen an Lernhelden GmbH eingerichtet.\nBetrag: 12,00 EUR monatlich\nHändler: Lernhelden GmbH"));
  assert.equal(d.service, "Lernhelden GmbH");
  assert.equal(d.via, "PayPal");
  assert.equal(d.amount, 12);
  assert.equal(d.interval, "month");
});

test("26 Normale PayPal-Zahlung ist kein Abo", () => {
  const d = det(mail("PayPal <service@paypal.at>", "Beleg für Ihre Zahlung an Willhaben-Verkäufer",
    "Sie haben 25,00 € an Max Mustermann gesendet. Transaktionscode 7AB12345."));
  assert.equal(d, null);
});

test("27 Werbung ist kein Testzeitraum", () => {
  const d = det(mail("Spotify <no-reply@spotify.com>", "3 Monate Premium gratis testen!",
    "Nur bis 30.11.2026: Hol dir 3 Monate Premium gratis. Danach 10,99 € pro Monat. Jederzeit kündbar."));
  assert.equal(d, null);
});

test("28 Snapchat+ über Google Play (en)", () => {
  const d = det(mail("Google Play <googleplay-noreply@google.com>", "Your Google Play Order Receipt",
    "Thank you. You've subscribed to Snapchat+ from Snap Inc on Google Play.\nSnapchat+ (Snapchat)\n€4.49/week\nNext payment: Nov 4, 2026"));
  assert.equal(d.service, "Snapchat+");
  assert.equal(d.interval, "week");
  assert.equal(d.amount, 4.49);
  assert.equal(d.nextDate, "2026-11-04");
});

test("29 Tinder Gold Kündigung (en)", () => {
  const d = det(mail("Tinder <no-reply@gotinder.com>", "Your Tinder Gold subscription has been cancelled",
    "We're sorry to see you go. Your Tinder Gold benefits remain active until November 18, 2026."));
  assert.equal(d.service, "Tinder");
  assert.equal(d.kind, "cancel");
  assert.equal(d.nextDate, "2026-11-18");
});

test("30 Generisch: unbekannter Dienst mit Abo + Betrag + Intervall", () => {
  const d = det(mail("Elektro-Wissen <billing@elektrowissen.at>", "Dein Abonnement wurde verlängert",
    "Danke! Dein Abonnement „Elektro-Wissen Premium“ wurde verlängert. Betrag: 4,50 € monatlich."));
  assert.equal(d.service, "Elektro-Wissen");
  assert.equal(d.known, undefined);
  assert.equal(d.amount, 4.5);
  assert.equal(d.kind, "renewal");
});

test("31 Generisch ohne Betrag wird verworfen", () => {
  assert.equal(det(mail("Newsletter <news@shop.at>", "Neues im Abo-Shop", "Schau dir unsere neuen Produkte an!")), null);
});

test("32 FitInn Preiserhöhung mit „statt“", () => {
  const d = det(mail("FitInn <info@fitinn.at>", "Preisanpassung deiner Mitgliedschaft",
    "Ab 01.01.2027 beträgt dein Beitrag 24,90 € statt 22,90 € pro Monat."));
  assert.equal(d.service, "FitInn");
  assert.equal(d.kind, "price_change");
  assert.equal(d.amount, 24.9);
  assert.equal(d.oldAmount, 22.9);
  assert.equal(d.nextDate, "2027-01-01");
});

/* ---------- Dedup + Abgleich ---------- */

test("detectAll: pro Dienst nur die neueste Mail", () => {
  const a = mail("Spotify <no-reply@spotify.com>", "Dein Beleg", "Premium Individual 10,99 € pro Monat. Abo verlängert.", "2026-09-12T07:00:00Z");
  const b = mail("Spotify <no-reply@spotify.com>", "Dein Beleg", "Premium Individual 11,99 € pro Monat. Abo verlängert.", "2026-10-12T07:00:00Z");
  const c = mail("Netflix <info@mailer.netflix.com>", "Deine Zahlung", "Dein Abo: 13,99 € pro Monat wurde abgebucht.", "2026-10-01T07:00:00Z");
  const list = D.detectAll([a, b, c], { today: TODAY });
  assert.equal(list.length, 2);
  const sp = list.find((x) => x.key === "spotify");
  assert.equal(sp.amount, 11.99);
  assert.equal(sp.mailId, b.id);
});

test("planActions: neu, Preis geändert, gekündigt, Test, ignoriert", () => {
  const dets = D.detectAll([
    mail("Spotify <no-reply@spotify.com>", "Dein Beleg", "Premium 12,99 € pro Monat. Abo verlängert.", "2026-10-12T07:00:00Z"),
    mail("Netflix <info@mailer.netflix.com>", "Dein Abo wurde gekündigt", "Dein Netflix-Abo wurde gekündigt. Zugriff bis 20.11.2026.", "2026-10-20T07:00:00Z"),
    mail("Disney+ <disneyplus@mail.disneyplus.com>", "Testzeitraum", "Dein Testzeitraum endet am 20.11.2026. Danach 9,99 € monatlich.", "2026-10-30T07:00:00Z"),
    mail("DAZN <no-reply@dazn.com>", "DAZN receipt", "Your DAZN subscription: €34.99/month charged.", "2026-10-25T07:00:00Z"),
    mail("Audible <noreply@audible.de>", "Zahlungsbestätigung", "Audible Abo 9,95 € monatlich bezahlt.", "2026-10-25T07:00:00Z"),
  ], { today: TODAY });
  const subs = [
    { id: "s1", name: "Spotify Premium", amount: 10.99, interval: "month", next: "2026-11-12" },
    { id: "s2", name: "Netflix", amount: 13.99, interval: "month", next: "2026-11-20" },
    { id: "s3", name: "Audible", amount: 9.95, interval: "month", next: "2026-11-25" },
  ];
  const dazn = dets.find((d) => d.key === "dazn");
  const acts = D.planActions(dets, subs, new Set([D.handledKey(dazn)]), TODAY);
  const types = Object.fromEntries(acts.map((a) => [a.det.key, a.type]));
  assert.deepEqual(types, { spotify: "price", netflix: "cancel", disney: "trial" });
  assert.equal(acts.find((a) => a.type === "price").sub.id, "s1");
  // Beendetes Netflix → keine erneute Kündigungs-Frage
  const acts2 = D.planActions(dets, [{ ...subs[1], paused: true, ended: "2026-10-20" }], new Set(), TODAY);
  assert.ok(!acts2.some((a) => a.det.key === "netflix"));
});

test("subFromDet + trialRemindDate", () => {
  const d = det(mail("Spotify <no-reply@spotify.com>", "Dein Beleg", "Premium 10,99 € pro Monat. Nächste Zahlung am 12.11.2026.", "2026-10-12T07:00:00Z"));
  const s = D.subFromDet(d, TODAY);
  assert.deepEqual({ name: s.name, amount: s.amount, interval: s.interval, next: s.next, day: s.day, category: s.category }, { name: "Spotify", amount: 10.99, interval: "month", next: "2026-11-12", day: 12, category: "abos" });
  assert.deepEqual(s.gmail, { key: "spotify", mailId: d.mailId });
  assert.equal(D.trialRemindDate("2026-11-20", TODAY), "2026-11-18");
  assert.equal(D.trialRemindDate("2026-11-05", TODAY), TODAY);
});
