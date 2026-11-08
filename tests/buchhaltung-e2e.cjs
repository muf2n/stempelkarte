// Playwright-Test für Alltag › 💼 Buchhaltung (Update 10, optionales Modul) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9541 &   then   node tests/buchhaltung-e2e.cjs [screenshot-dir]
// Optional (aus → einschalten), Einrichtung (Firma, UID, IBAN, Nicht-Kleinunternehmer), Ausgabe mit USt, Belegscanner (/chat gestubbt,
// erst nach Okay gespeichert), Rechnung (neuer Kunde → Kontakte) → Pflichtangaben-Check → Abschließen (2026-001) → Druck-Layout →
// bezahlt → Einnahmen je USt-Satz, Entwurf löschen verbraucht keine Nummer, Storno (eigene Nummer, Original storniert),
// Auswertung (Summen, Zahllast), CSV-Export (BOM, Inhalte), Belege-Liste, Suche, Geld-Sperre schützt die Buchhaltung, 390/1440 hell/dunkel.
const { harness } = require("./akten-harness.cjs");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:9541/";
const OUT = process.argv[2] || require("os").tmpdir();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP48OEZSYhhVMOohuGrAQB8wcYfSGPYxQAAAABJRU5ErkJggg==", "base64");

(async () => {
  const H = await harness(BASE, OUT);
  const { ok, A, sheet, errors } = H;
  const chatBodies = [];
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date();
  const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const Y = d.getFullYear();
  const page = await H.newPage();
  await page.context().addInitScript(() => { window.__skAiTest = { token: "test", url: location.origin }; });
  await page.route("**/chat", async (route) => {
    chatBodies.push(JSON.parse(route.request().postData() || "{}"));
    const dt = new Date(); const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "```json\n" + JSON.stringify({ datum: k, betrag_brutto: "23,90", ust_satz: 10, haendler: "Bürobedarf Muster", kategorie_vorschlag: "buero" }) + "\n```", actions: [] }) });
  });
  await H.boot(page, {});
  const settings = () => page.evaluate(() => (JSON.parse(localStorage.getItem("sk-a-buch_settings") || "[]")[0] || null));
  const INV = () => A(page, "buch_rechnungen");
  const BEL = () => A(page, "buch_belege");
  const go = (h) => page.evaluate((h) => { location.hash = h; }, h);

  /* ---------- optional: standardmäßig aus ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector(".al-tile");
  ok(!(await page.$('.al-tile[data-id="buchhaltung"]')), "Kachel fehlt, solange das Modul aus ist (optional)");
  await go("#alltag/buchhaltung");
  await page.waitForSelector(".al-off");
  ok((await page.textContent(".al-off")).includes("Optionaler Bereich"), "Optionaler Bereich – Einschalten-Knopf");
  await page.click("[data-al-on]");
  await page.waitForSelector(".bu .bu-tabs");
  ok(true, "eingeschaltet → Buchhaltung offen (Geld-Sperre nicht eingerichtet)");
  ok((await page.textContent(".bu")).includes("ersetzt keine Steuerberatung"), "Hinweis „ersetzt keine Steuerberatung“");
  ok(await page.isVisible(".bu-setup-cta"), "Übersicht: „Firma einrichten“");
  await H.shot(page, "buch-home-empty-390-light.png");

  /* ---------- Einrichtung ---------- */
  await page.click('.bu-tab[data-tab="setup"]');
  await page.waitForSelector("#bu-s-firm");
  ok((await page.isChecked("#bu-s-ku")) && (await page.isChecked("#bu-s-lock")), "Standard: Kleinunternehmer an, Geld-Sperre-Schutz an");
  await page.fill("#bu-s-firm", "Muster Handwerk e.U.");
  await page.fill("#bu-s-addr", "Musterweg 1\n8010 Graz");
  await page.fill("#bu-s-uid", "ATU12345678");
  await page.fill("#bu-s-mail", "office@example.com");
  await page.uncheck("#bu-s-ku");
  await page.fill("#bu-s-iban", "AT61 1904 3002 3457 3202");
  await page.waitForSelector(".bu-ibanmsg:text('Prüfziffer')");
  ok(true, "falsche IBAN-Prüfziffer wird angezeigt");
  await page.fill("#bu-s-iban", "AT61 1904 3002 3457 3201");
  ok((await page.textContent(".bu-ibanmsg")) === "", "gültige IBAN ok");
  await page.fill("#bu-s-fmt", "{JJJJ}");
  ok((await page.textContent(".bu-nextno")).includes("ungültig"), "Nummern-Format ohne {NNN} → ungültig");
  await page.fill("#bu-s-fmt", "{JJJJ}-{NNN}");
  ok((await page.textContent(".bu-nextno")) === `${Y}-001`, "Vorschau nächste Nummer");
  await H.shot(page, "buch-setup-390-light.png");
  await page.click(".bu-setup [data-save]");
  await page.waitForSelector(".bu-quick");
  let st = await settings();
  ok(st && st.firm === "Muster Handwerk e.U." && st.uid === "ATU12345678" && st.iban === "AT611904300234573201" && st.kleinunternehmer === false && st.setupDone && st.lockWithMoney === true, "Einstellungen gespeichert (IBAN ohne Leerzeichen)");

  /* ---------- Ausgabe mit USt ---------- */
  await page.click('.bu-quick [data-bu="new-out"]');
  await page.waitForSelector("#bu-b-gross");
  await page.fill("#bu-b-gross", "59,99");
  await page.selectOption("#bu-b-cat", "material");
  await page.fill("#bu-b-partner", "Elektro Großhandel");
  ok((await page.textContent(".bu-calc")) === "Netto 49,99 € + 20 % Vorsteuer 10,00 €", "Netto/Vorsteuer live berechnet");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  let bel = await BEL();
  ok(bel.length === 1 && bel[0].gross === 5999 && bel[0].rate === 20 && bel[0].type === "out" && bel[0].date === TODAY && bel[0].cat === "material", "Ausgabe gespeichert (Cent, Satz, Zahlungsdatum heute)");

  /* ---------- Belegscanner ---------- */
  await page.click('.bu-quick [data-bu="new-out"]');
  await page.waitForSelector("#bu-b-file", { state: "attached" });
  await page.setInputFiles("#bu-b-file", { name: "bon.png", mimeType: "image/png", buffer: PNG });
  await page.waitForSelector(`${sheet} [data-scan]:not([disabled])`);
  ok((await page.textContent(".bu-vault")).includes("Tresor-Passwort"), "ohne Tresor: Hinweis, wie das Foto verschlüsselt abgelegt wird");
  await page.click(`${sheet} [data-scan]`);
  await page.waitForSelector(".bu-scan-msg:has-text('bitte prüfen')");
  ok(chatBodies.length === 1 && chatBodies[0].mode === "lehrer" && chatBodies[0].image && chatBodies[0].image.type === "image/jpeg" && !chatBodies[0].image.data.startsWith("data:") && /betrag_brutto/.test(chatBodies[0].messages[0].content), "/chat: lehrer + Bild (base64) + JSON-Vorgabe");
  ok((await page.inputValue("#bu-b-gross")) === "23,90" && (await page.inputValue("#bu-b-rate")) === "10" && (await page.inputValue("#bu-b-partner")) === "Bürobedarf Muster" && (await page.inputValue("#bu-b-cat")) === "buero", "Felder ausgefüllt");
  ok(await page.$eval("#bu-b-gross", (e) => e.classList.contains("bu-ai")), "ausgelesene Felder markiert");
  ok((await BEL()).length === 1, "noch nichts gespeichert (erst nach Bestätigen)");
  await H.shot(page, "buch-scan-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(300);
  bel = await BEL();
  ok(bel.length === 2 && bel.some((b) => b.gross === 2390 && b.rate === 10 && b.partner === "Bürobedarf Muster"), "gescannter Beleg nach Bestätigen gespeichert");

  /* ---------- Rechnung: Entwurf ---------- */
  await page.click('.bu-quick [data-bu="new-inv"]');
  await page.waitForSelector("#bu-i-name");
  await page.fill("#bu-i-name", "Muster Kunde GmbH");
  await page.fill("#bu-i-addr", "Kundenstraße 5\n8020 Graz");
  await page.fill(".bu-item [data-f=qty]", "2");
  await page.fill(".bu-item [data-f=unit]", "Std");
  await page.fill(".bu-item [data-f=text]", "Montage Steckdosen");
  await page.fill(".bu-item [data-f=price]", "50");
  await page.click(`${sheet} [data-additem]`);
  await page.fill(".bu-item:last-child [data-f=text]", "Fachbuch");
  await page.fill(".bu-item:last-child [data-f=price]", "19,99");
  await page.selectOption(".bu-item:last-child [data-f=rate]", "10");
  ok((await page.textContent(".bu-itot")).includes("Brutto 141,99 €"), "Summe live: 100 + 20 % und 19,99 + 10 % = 141,99 € brutto");
  await H.shot(page, "buch-invoice-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".bu-det");
  let inv = await INV();
  ok(inv.length === 1 && inv[0].status === "entwurf" && !inv[0].number && inv[0].items.length === 2 && inv[0].items[1].price === 1999, "Entwurf ohne Nummer gespeichert");
  const kt = await A(page, "kontakte");
  ok(kt.length === 1 && kt[0].name === "Muster Kunde GmbH" && inv[0].customer.contactId === kt[0].id, "Kunde in 👤 Kontakte angelegt + verknüpft");
  ok(await page.isVisible(".bu-p-wm"), "Vorschau mit Wasserzeichen ENTWURF");

  /* ---------- Pflichtangaben-Check + Abschließen ---------- */
  await page.click('[data-bu="inv-final"]');
  await page.waitForSelector(".bu-check");
  ok((await page.textContent(".bu-check")).includes("Alle Pflichtangaben sind da"), "Check: alles da");
  ok((await page.textContent(`${sheet} [data-go]`)).includes(`${Y}-001`), "Abschließen zeigt die nächste Nummer");
  await H.shot(page, "buch-check-390-light.png");
  await page.click(`${sheet} [data-go]`);
  await page.waitForSelector(".bu-st-offen");
  inv = await INV();
  ok(inv[0].number === `${Y}-001` && inv[0].status === "offen" && inv[0].ku === false && inv[0].seller.iban === "AT611904300234573201" && inv[0].dueDate, "abgeschlossen: Nummer, offen, Firmendaten eingefroren, Fälligkeit");
  ok((await settings()).counters[String(Y)] === 1, "Zähler fürs Jahr = 1");
  ok(!(await page.$('[data-bu="inv-edit"]')) && !(await page.$('[data-bu="inv-del"]')), "abgeschlossen: kein Bearbeiten/Löschen mehr");
  await H.shot(page, "buch-invoice-detail-390-light.png");

  /* ---------- Druck-Layout ---------- */
  await page.click('[data-bu="inv-print"]');
  await page.waitForSelector("#bu-print-root .bu-paper");
  const paper = await page.textContent("#bu-print-root .bu-paper");
  for (const t of [`Rechnung ${Y}-001`, "Muster Handwerk e.U.", "UID: ATU12345678", "Muster Kunde GmbH", "Kundenstraße 5", "Montage Steckdosen", "zzgl. 20 % USt", "20,00 €", "zzgl. 10 % USt", "2,00 €", "141,99 €", "AT61 1904 3002 3457 3201", "Leistungsdatum", "Rechnungsdatum ist gleich Liefer- bzw. Leistungsdatum"]) ok(paper.includes(t), "Rechnung enthält: " + t);
  ok(!paper.includes("Kleinunternehmerregelung"), "kein Kleinunternehmer-Hinweis (USt-pflichtig)");
  await H.shot(page, "buch-print-overlay-390-light.png");
  await page.emulateMedia({ media: "print" });
  const pr = await page.evaluate(() => ({ app: getComputedStyle(document.querySelector("#app") || document.body.firstElementChild).display, bar: getComputedStyle(document.querySelector("#bu-print-root .rp-bar")).display,
    acts: getComputedStyle(document.querySelector("#bu-print-root .rp-actions")).display, paper: getComputedStyle(document.querySelector("#bu-print-root .bu-paper")).display, bg: getComputedStyle(document.querySelector("#bu-print-root .bu-paper")).backgroundColor }));
  ok(pr.bar === "none" && pr.acts === "none" && pr.paper !== "none" && pr.bg === "rgb(255, 255, 255)", "Druck: nur das Papier (Leiste/Knöpfe aus, weißer Hintergrund)");
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.screenshot({ path: require("path").join(OUT, "buch-invoice-print-A4.png"), fullPage: true });
  await page.pdf({ path: require("path").join(OUT, "buch-invoice.pdf"), format: "A4" }).catch(() => {});
  await page.emulateMedia({ media: "screen" });
  await page.setViewportSize({ width: 390, height: 844 });
  const dl = page.waitForEvent("download");
  await page.click('#bu-print-root [data-p="file"]');
  const html = fs.readFileSync(await (await dl).path(), "utf8");
  ok(html.startsWith("<!doctype html>") && html.includes(`Rechnung ${Y}-001`) && !/<script/i.test(html), "Herunterladen: eigenständige HTML-Datei ohne Skripte");
  await page.click('#bu-print-root [data-p="close"]');
  await page.waitForTimeout(200);
  ok(!(await page.$("#bu-print-root")), "Druck-Ansicht geschlossen");

  /* ---------- bezahlt → Einnahmen ---------- */
  await page.click('[data-bu="inv-paid"]');
  await page.waitForSelector("#bu-p-date");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".bu-st-bezahlt");
  inv = await INV();
  bel = await BEL();
  const ins = bel.filter((b) => b.invoiceId === inv[0].id);
  ok(inv[0].status === "bezahlt" && inv[0].paidOn === TODAY, "Rechnung bezahlt");
  ok(ins.length === 2 && ins.some((b) => b.gross === 12000 && b.rate === 20) && ins.some((b) => b.gross === 2199 && b.rate === 10) && ins.every((b) => b.type === "in" && b.cat === "erloese"), "Einnahmen automatisch gebucht (je USt-Satz)");

  /* ---------- Entwurf löschen verbraucht keine Nummer; Storno ---------- */
  const mkInv = async (name, price) => {
    await go("#alltag/buchhaltung/rechnungen");
    await page.waitForSelector('.bu-tools [data-bu="new-inv"]');
    await page.click('.bu-tools [data-bu="new-inv"]');
    await page.waitForSelector("#bu-i-name");
    await page.selectOption("#bu-i-kt", { label: "Muster Kunde GmbH" });
    ok((await page.inputValue("#bu-i-addr")).includes("Kundenstraße 5"), "Kunde aus Kontakte übernimmt die Anschrift");
    await page.fill(".bu-item [data-f=text]", name);
    await page.fill(".bu-item [data-f=price]", price);
    await page.click(`${sheet} [data-save]`);
    await page.waitForSelector(".bu-det");
  };
  await mkInv("Wird gelöscht", "10");
  await page.click('[data-bu="inv-del"]');
  await page.click('[data-bu="inv-del"]');
  await page.waitForSelector(".bu-tools");
  ok((await INV()).length === 1, "Entwurf gelöscht");
  await mkInv("Fehlerhafte Rechnung", "100");
  await page.click('[data-bu="inv-final"]');
  await page.waitForSelector(`${sheet} [data-go]`);
  ok((await page.textContent(`${sheet} [data-go]`)).includes(`${Y}-002`), "gelöschter Entwurf hat keine Nummer verbraucht → 002");
  await page.click(`${sheet} [data-go]`);
  await page.waitForSelector(".bu-st-offen");
  await page.click('[data-bu="inv-storno"]');
  await page.waitForSelector(`${sheet} .bu-dangerbtn`);
  ok((await page.textContent(sheet)).includes(`Stornorechnung ${Y}-003`), "Storno kündigt eigene Nummer an");
  await page.click(`${sheet} .bu-dangerbtn`);
  await page.waitForSelector(".bu-st-storno");
  inv = await INV();
  const orig = inv.find((i) => i.number === `${Y}-002`), sto = inv.find((i) => i.number === `${Y}-003`);
  ok(orig && orig.status === "storniert" && sto && sto.kind === "storno" && sto.refId === orig.id && orig.stornoId === sto.id && sto.items[0].qty === -1, "Storno: Original storniert, Stornorechnung mit negativer Menge + Verweis");
  ok((await page.textContent(".bu-paper")).includes(`Storno zu`) && (await page.textContent(".bu-paper")).includes("−120,00 €"), "Stornorechnung zeigt Bezug + negativen Betrag");
  ok(inv.length === 3 && new Set(inv.map((i) => i.number)).size === 3, "3 Nummern, keine doppelt");
  await H.shot(page, "buch-storno-390-light.png");
  await go("#alltag/buchhaltung/rechnungen");
  await page.waitForSelector(".bu-list");
  await H.shot(page, "buch-invoices-390-light.png");

  /* ---------- Auswertung ---------- */
  await page.click('.bu-tab[data-tab="auswertung"]');
  await page.waitForSelector(".bu-report");
  const tot = await page.textContent(".bu-rr.tot");
  // Einnahmen netto 100,00 + 19,99 = 119,99 · Ausgaben netto 49,99 + 21,73 = 71,72 · Gewinn 48,27 · USt 22,00 · VSt 10,00 + 2,17 = 12,17 · Zahllast 9,83
  for (const t of ["119,99 €", "71,72 €", "48,27 €", "22,00 €", "12,17 €", "9,83 €"]) ok(tot.includes(t), "Jahressumme enthält " + t);
  ok((await page.textContent(".bu-body")).includes("Orientierung für die UVA"), "Zahllast als Orientierung beschriftet");
  ok(await H.noOverflow(page), "390: kein waagrechtes Scrollen (Auswertung)");
  await H.shot(page, "buch-report-390-light.png");

  /* ---------- Export ---------- */
  await page.click('.bu-tab[data-tab="export"]');
  await page.waitForSelector('[data-bu="exp-belege"]');
  const grab = async (sel) => { const p = page.waitForEvent("download"); await page.click(sel); const x = await p; return { name: x.suggestedFilename(), text: fs.readFileSync(await x.path(), "utf8") }; };
  const c1 = await grab('[data-bu="exp-belege"]');
  ok(c1.name === `Buchhaltung-${Y}-Buchungen.csv` && c1.text.startsWith("﻿Datum (Zahlung);Art;Kategorie;Partner"), "Buchungen-CSV: Name, BOM, Semikolon");
  const rows = c1.text.slice(1).trim().split("\r\n");
  ok(rows.length === 5, "Kopf + 4 Buchungen");
  ok(c1.text.includes("Ausgabe;Material;Elektro Großhandel;;59,99;20;49,99;10,00;Überweisung;;;31.12." + (Y + 7)), "Ausgabe-Zeile mit Netto/USt + Aufbewahrungsfrist");
  ok(c1.text.includes(`Einnahme;Erlöse (Verkauf/Leistung);Muster Kunde GmbH;Rechnung ${Y}-001 (20 %);120,00;20;100,00;20,00;Überweisung;${Y}-001`), "Einnahme-Zeile verweist auf die Rechnung");
  const c2 = await grab('[data-bu="exp-inv"]');
  ok(c2.text.includes(`${Y}-001;Rechnung;`) && c2.text.includes(`${Y}-003;Stornorechnung;`) && c2.text.includes(";-100,00;-20,00;-120,00;Stornorechnung;") && c2.text.includes(`;${Y}-002\r\n`), "Rechnungen-CSV inkl. Storno (negativ, Bezug)");
  const c3 = await grab('[data-bu="exp-list"]');
  ok(c3.text.includes("Beleg fehlt") && c3.text.includes(`Ausgangsrechnung (Nr. ${Y}-001)`), "Belege-Liste: fehlende Belege + Ausgangsrechnungen");
  const p4 = page.waitForEvent("download"); await page.click('[data-bu="exp-xlsx"]'); const x4 = await p4;
  const xb = fs.readFileSync(await x4.path());
  ok(x4.suggestedFilename() === `Buchhaltung-${Y}.xlsx` && xb[0] === 0x50 && xb[1] === 0x4b, "Excel-Datei (ZIP) erstellt");
  await page.click('[data-bu="year-pdf"]');
  await page.waitForSelector("#bu-print-root .bu-year-p");
  ok((await page.textContent("#bu-print-root")).includes(`Jahres-Zusammenfassung ${Y}`) && (await page.textContent("#bu-print-root")).includes("ersetzt keine Steuerberatung"), "Jahres-PDF-Ansicht");
  await H.shot(page, "buch-year-pdf-390-light.png");
  await page.click('#bu-print-root [data-p="close"]');

  /* ---------- Gut zu wissen ---------- */
  await page.click('.bu-tab[data-tab="info"]');
  await page.waitForSelector(".bu-info");
  const info = await page.textContent(".bu-body");
  ok(info.includes("Stand: 08.11.2026") && info.includes("55.000") && info.includes("400 €") && info.includes("7 Jahre") && info.includes("1.000 €") && info.includes("4,9 %"), "Gut zu wissen: Stand + Kennzahlen");
  const links = await page.$$eval(".bu-info a", (l) => l.map((a) => [a.href, a.target, a.rel]));
  ok(links.length === 11 && links.every(([h, t, r]) => /^https:\/\/www\.(usp\.gv\.at|wko\.at)\//.test(h) && t === "_blank" && r.includes("noopener")), "Quellen-Links (offiziell, neuer Tab)");
  await H.shot(page, "buch-info-390-light.png");

  /* ---------- Suche ---------- */
  await page.click("#btn-search");
  await page.waitForSelector("#srch-q", { state: "visible" });
  await page.fill("#srch-q", "Muster Kunde");
  await page.waitForTimeout(400);
  ok(await page.$('.srch-group[data-group="buchhaltung"]'), "globale Suche findet Rechnungen (Gruppe Buchhaltung)");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150); await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  /* ---------- Geld-Sperre schützt die Buchhaltung ---------- */
  await page.evaluate(async () => {
    const L = await import("/js/alltag/money-lock-core.js");
    localStorage.setItem("sk-money-lock", JSON.stringify({ enabled: true, pin: await L.hashPin("4711", 2000), bannerDismissed: true }));
  });
  await page.goto(BASE + "#alltag/buchhaltung");
  await page.reload();
  await page.waitForSelector(".ml-lock");
  ok((await page.textContent(".ml-lock")).includes("Buchhaltung ist gesperrt") && !(await page.$(".bu")), "gesperrt: Sperrbildschirm, keine Buchhaltung im DOM");
  ok(!(await page.evaluate(() => document.body.innerText.includes("Muster Kunde"))), "gesperrt: keine Kunden/Beträge sichtbar");
  await H.shot(page, "buch-locked-390-light.png");
  await page.click("#btn-search");
  await page.waitForSelector("#srch-q", { state: "visible" });
  await page.fill("#srch-q", "Muster Kunde");
  await page.waitForTimeout(400);
  ok(!(await page.$('.srch-group[data-group="buchhaltung"]')), "gesperrt: Suche zeigt keine Rechnungen");
  await page.fill("#srch-q", "Rechnung");
  await page.waitForTimeout(300);
  ok((await page.textContent("#srch-body")).includes("Buchhaltung gesperrt"), "gesperrt: Suche bietet „Buchhaltung gesperrt – entsperren“");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150); await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  for (const k of "4711") await page.click(`.ml-keys [data-k="${k}"]`);
  await page.waitForSelector(".bu .bu-tabs");
  ok(true, "PIN entsperrt die Buchhaltung");
  await page.click('.bu-tab[data-tab="setup"]');
  await page.waitForSelector("#bu-s-lock");
  await page.uncheck("#bu-s-lock");
  await page.click(".bu-setup [data-save]");
  await page.waitForTimeout(400);
  ok((await settings()).lockWithMoney === false, "„Mit Geld-Sperre schützen“ aus gespeichert");
  await page.waitForSelector(".bu .bu-tabs");
  await page.evaluate(async () => { (await import("/js/alltag/money-lock-state.js")).lock("Test"); }); // Geld wieder sperren
  await page.waitForTimeout(300);
  ok(!(await page.$(".ml-lock")), "ohne Schutz: Buchhaltung offen, obwohl Geld gesperrt ist");
  await go("#alltag/geld");
  await page.waitForSelector(".ml-lock");
  ok(true, "Geld selbst bleibt gesperrt");

  /* ---------- Layout: 390 dunkel, 1440 hell/dunkel ---------- */
  for (const [scheme, w, h] of [["dark", 390, 844], ["light", 1440, 900], ["dark", 1440, 900]]) {
    const p = await H.newPage(scheme, w, h);
    await p.goto(BASE);
    await p.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
    await p.evaluate(() => localStorage.removeItem("sk-money-lock"));
    await p.goto(BASE + "#alltag/buchhaltung");
    await p.reload();
    if (await p.isVisible("#btn-local")) { await p.click("#btn-local"); await p.waitForTimeout(300); }
    await p.waitForSelector(".bu .bu-kpis");
    ok(await H.noOverflow(p), `${w} ${scheme}: Übersicht ohne waagrechtes Scrollen`);
    await H.shot(p, `buch-home-${w}-${scheme}.png`);
    await p.evaluate((id) => { location.hash = "#alltag/buchhaltung/rechnung/" + id; }, orig.id);
    await p.waitForSelector(".bu-paper");
    ok(await H.noOverflow(p), `${w} ${scheme}: Rechnung ohne waagrechtes Scrollen`);
    await H.shot(p, `buch-invoice-${w}-${scheme}.png`);
    await p.evaluate(() => { location.hash = "#alltag/buchhaltung/auswertung"; });
    await p.waitForSelector(".bu-report");
    await H.shot(p, `buch-report-${w}-${scheme}.png`);
    if (w === 1440) {
      await p.evaluate(() => { location.hash = "#alltag/buchhaltung/belege"; });
      await p.waitForSelector(".bu-month");
      await H.shot(p, `buch-belege-${w}-${scheme}.png`);
      await p.evaluate(() => { location.hash = "#alltag/buchhaltung/rechnungen"; });
      await p.waitForSelector('.bu-tools [data-bu="new-inv"]');
      await H.shot(p, `buch-invoices-${w}-${scheme}.png`);
      await p.click('.bu-tools [data-bu="new-inv"]');
      await p.waitForSelector(".bu-item");
      await H.shot(p, `buch-invoice-form-${w}-${scheme}.png`);
    }
    await p.context().close();
  }

  ok(errors.length === 0, "keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await H.browser.close();
  console.log("Buchhaltung-E2E: alles grün ✅");
})().catch((e) => { console.error(e); process.exit(1); });
