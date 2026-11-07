// Playwright-Test für Alltag › 👤 Kunden & Kontakte (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9414 &   then   node tests/kontakte-e2e.cjs [screenshot-dir]
// Leer, Anlegen (Art, Ansprechpartner, tel:/mailto:-Links, keine Sendung), Baustelle verknüpfen (setzt customerId am Ort),
// Gesprächsnotiz (datiert), Auftrag mit Baustelle, Verlauf (inkl. Arbeitstag aus Einträgen), Art-Filter, Suche (Telefon ohne Leerzeichen),
// Baustellen-Projektseite zeigt den Kunden, globale Suche, Verknüpfung lösen, Löschen, 1440 hell/dunkel.
const { harness } = require("./akten-harness.cjs");
const BASE = process.env.BASE || "http://localhost:9414/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const H = await harness(BASE, OUT);
  const { ok, A, sheet } = H;
  const page = await H.newPage();
  const day = new Date(); day.setDate(day.getDate() - 2); day.setHours(8, 0, 0, 0);
  const store = { places: [{ id: "p1", name: "Baustelle Muster", addr: "Musterweg 1", lat: 47, lng: 15, radius: 150 }, { id: "p2", name: "Halle Beispiel", addr: "Beispielgasse 2", lat: 47.1, lng: 15.1, radius: 150 }],
    entries: [{ id: "e1", kind: "work", start: day.getTime(), end: day.getTime() + 8 * 3600e3, pauseMin: 30, placeId: "p1", place: "Baustelle Muster" }] };
  await H.boot(page, { store });

  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="kontakte"]');
  await page.click('.al-tile[data-id="kontakte"]');
  await page.waitForSelector(".kt .ak-empty");
  ok((await page.textContent(".kt .ak-empty")).includes("Noch keine Kontakte"), "Leerer Zustand");

  /* ---------- Anlegen ---------- */
  await page.click('.kt [data-kt="new"]');
  await page.waitForSelector("#kt-f-name");
  await page.click(`${sheet} [data-ty="firma"]`);
  await page.fill("#kt-f-name", "Muster Bau GmbH");
  await page.fill("#kt-f-person", "Max Muster");
  await page.fill("#kt-f-phone", "+43 660 123 45 67");
  await page.fill("#kt-f-mail", "office@example.com");
  await page.fill("#kt-f-addr", "Musterweg 1\n8010 Graz");
  await page.fill("#kt-f-notes", "Lieber vormittags anrufen");
  await H.shot(page, "kontakte-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".kt .ak-det");
  let list = await A(page, "kontakte");
  ok(list.length === 1 && list[0].type === "firma" && list[0].person === "Max Muster", "Kontakt gespeichert");
  const id1 = list[0].id;
  ok((await page.getAttribute('.ak-hero-acts a[href^="tel:"]', "href")) === "tel:+436601234567", "Anrufen = tel:-Link (nur Ziffern)");
  ok((await page.getAttribute('.ak-hero-acts a[href^="mailto:"]', "href")) === "mailto:office@example.com", "E-Mail = mailto:-Link");

  /* ---------- Baustelle verknüpfen ---------- */
  await page.click('[data-kt="addplace"]');
  await page.waitForSelector(`${sheet} [data-pid="p1"]`);
  await page.click(`${sheet} [data-pid="p1"]`);
  await page.waitForTimeout(300);
  ok((await A(page, "kontakte"))[0].placeIds.join() === "p1", "Baustelle verknüpft");
  const pl = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).places.find((p) => p.id === "p1"));
  ok(pl.customerId === id1, "customerId am Ort gesetzt");

  /* ---------- Gesprächsnotiz + Auftrag ---------- */
  await page.click('[data-kt="call"]');
  await page.waitForSelector("#kt-c-text");
  await page.fill("#kt-c-text", "Termin Do 8 Uhr fix, Steckdosen im Bad zusätzlich");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".kt-calls li");
  ok((await page.textContent(".kt-calls")).includes("Steckdosen im Bad"), "Gesprächsnotiz im Reiter „Gespräche“");
  await page.click('[data-tab="auftraege"]');
  await page.click('[data-kt="job"]');
  await page.waitForSelector("#kt-j-title");
  ok((await page.inputValue("#kt-j-pl")) === "p1", "Auftrag schlägt die verknüpfte Baustelle vor");
  await page.fill("#kt-j-title", "Zählerkasten tauschen");
  await page.selectOption("#kt-j-st", "laeuft");
  await page.selectOption("#kt-j-pl", "p2");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".kt-job");
  list = await A(page, "kontakte");
  ok(list[0].jobs.length === 1 && list[0].jobs[0].status === "laeuft" && list[0].placeIds.join() === "p1,p2", "Auftrag gespeichert, zweite Baustelle automatisch verknüpft");
  await page.click('[data-tab="verlauf"]');
  const hist = await page.textContent(".kt-hist");
  ok(hist.includes("Gearbeitet: Baustelle Muster") && hist.includes("Auftrag: Zählerkasten") && hist.includes("Steckdosen"), "Verlauf: Arbeitstag, Auftrag, Gespräch");
  await H.shot(page, "kontakte-detail-390-light.png");

  /* ---------- Liste, Filter, Suche ---------- */
  await page.click('[data-kt="back"]');
  await page.waitForSelector(".kt .ak-list");
  await page.click('.kt [data-kt="new"]');
  await page.waitForSelector("#kt-f-name");
  await page.click(`${sheet} [data-ty="privat"]`);
  await page.fill("#kt-f-name", "Erika Beispiel");
  await page.fill("#kt-f-phone", "0664 999 88 77");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".kt .ak-det");
  await page.click('[data-kt="back"]');
  await page.waitForSelector(".kt .ak-list");
  ok((await page.$$(".kt .ak-card")).length === 2, "Zwei Kontakte");
  ok((await page.textContent(".kt .ak-list")).includes("1 Auftrag offen"), "Offene Aufträge als Abzeichen");
  await page.click('.kt-types [data-type="privat"]');
  ok((await page.$$(".kt .ak-card")).length === 1, "Filter nach Art");
  await page.click('.kt-types [data-type=""]');
  await page.fill("#kt-q", "06649998877");
  await page.waitForTimeout(100);
  ok((await page.$$(".kt .ak-card")).length === 1 && (await page.textContent(".kt .ak-card")).includes("Erika"), "Suche nach Telefonnummer ohne Leerzeichen");
  await page.fill("#kt-q", "");
  await H.shot(page, "kontakte-list-390-light.png");

  /* ---------- Projektseite zeigt den Kunden ---------- */
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#st-customer .st-cust");
  ok((await page.textContent("#st-customer")).includes("Muster Bau GmbH") && (await page.getAttribute("#st-customer a.btn", "href")) === "tel:+436601234567", "Baustellenseite: Kunde mit Anrufen-Knopf");
  await H.shot(page, "kontakte-site-390-light.png");
  await page.click("#st-customer .st-cust");
  await page.waitForFunction((id) => location.hash === "#alltag/kontakte/" + id, id1);
  ok(true, "Kunde antippen → Kontaktseite");

  /* ---------- globale Suche ---------- */
  await page.click("#btn-search");
  await page.fill("#srch-q", "Zählerkasten");
  await page.waitForSelector('.srch-group[data-group="kontakte"]');
  ok((await page.textContent('.srch-group[data-group="kontakte"]')).includes("Muster Bau"), "Globale Suche findet den Kontakt über den Auftrag");
  await page.click('.srch-group[data-group="kontakte"] .srch-it, .srch-group[data-group="kontakte"] button');
  await page.waitForSelector("#search-layer", { state: "hidden" });

  /* ---------- Verknüpfung lösen + löschen ---------- */
  await page.waitForSelector('[data-kt="rmplace"][data-id="p1"]');
  await page.click('[data-kt="rmplace"][data-id="p1"]');
  await page.waitForTimeout(400);
  const pl2 = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).places.find((p) => p.id === "p1"));
  ok(!pl2.customerId && (await A(page, "kontakte")).find((c) => c.id === id1).placeIds.join() === "p2", "Verknüpfung gelöst (auch customerId am Ort)");
  await page.click('[data-kt="del"]');
  await page.click('[data-kt="del"]');
  await page.waitForFunction(() => location.hash === "#alltag/kontakte");
  await page.waitForTimeout(300);
  ok((await A(page, "kontakte")).length === 1, "Kontakt gelöscht");
  const pl3 = await page.evaluate(() => JSON.parse(localStorage.getItem("stempelkarte.local.v1")).places.find((p) => p.id === "p2"));
  ok(!pl3.customerId, "customerId beim Löschen entfernt");

  /* ---------- Desktop + dunkel ---------- */
  const seed = [{ id: "k1", name: "Muster Bau GmbH", type: "firma", person: "Max Muster", phone: "+43 660 1234567", email: "office@example.com", address: "Musterweg 1", placeIds: ["p1"],
    calls: [{ id: "n1", date: "2026-11-02", text: "Angebot besprochen" }], jobs: [{ id: "j1", title: "Zählerkasten tauschen", date: "2026-10-20", status: "laeuft" }] }, { id: "k2", name: "Erika Beispiel", type: "privat" }];
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    const p = await H.newPage(scheme, w, h);
    await H.boot(p, { store, alltag: { kontakte: seed } });
    await p.goto(BASE + "#alltag/kontakte");
    await p.waitForSelector(".kt .ak-list");
    await H.shot(p, `kontakte-list-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Liste ohne waagrechtes Scrollen (${w} ${scheme})`);
    await p.goto(BASE + "#alltag/kontakte/k1");
    await p.waitForSelector(".kt .ak-det");
    await H.shot(p, `kontakte-detail-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await p.context().close();
  }
  ok(H.errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (H.errors.length ? ":\n" + H.errors.join("\n") : ""));
  await H.browser.close();
  console.log("\nAlle Kontakte-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
