// Playwright-Test für Alltag › 📦 Inventar (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9413 &   then   node tests/inventar-e2e.cjs [screenshot-dir]
// Leer, Anlegen (Kategorie, Raum, Kaufpreis, Garantie-Schnellwahl aus Kaufdatum, Foto), Detail-Route, Garantie-Abzeichen,
// Ansicht „Räume“ mit Gesamtwert, Raum-Filter, Suche (Seriennummer), QR-Sticker + Druckbogen, Rechnung verknüpfen (📎 → Dokumente),
// Benachrichtigung „Garantie läuft ab“, globale Suche, Deep-Link nach Neuladen, Löschen, 1440 hell/dunkel.
const { harness, inDays, shiftMonths } = require("./akten-harness.cjs");
const BASE = process.env.BASE || "http://localhost:9413/";
const OUT = process.argv[2] || require("os").tmpdir();
const zlib = require("zlib");
function png() { // 8×8 einfarbig
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(25 * 8); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = y * 25 + 1 + x * 3; raw[o] = 30; raw[o + 1] = 160; raw[o + 2] = 90; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const H = await harness(BASE, OUT);
  const { ok, A, sheet } = H;
  const page = await H.newPage();
  await H.boot(page);

  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="inventar"]');
  await page.click('.al-tile[data-id="inventar"]');
  await page.waitForSelector(".inv .ak-empty");
  ok((await page.textContent(".inv .ak-empty")).includes("noch leer"), "Leeres Inventar mit Hinweis");

  /* ---------- Anlegen ---------- */
  await page.click('.inv [data-inv="new"]');
  await page.waitForSelector("#inv-f-name");
  await page.click(`${sheet} [data-cat="haushalt"]`);
  await page.fill("#inv-f-name", "Waschmaschine");
  await page.fill("#inv-f-brand", "Testmarke WM-1");
  await page.fill("#inv-f-sn", "qx-998877");
  await page.fill("#inv-f-room", "Bad");
  await page.fill("#inv-f-shop", "Elektro Muster");
  await page.fill("#inv-f-price", "649");
  const bought = shiftMonths(inDays(15), -24);
  await page.click(`${sheet} [data-wm="24"]`);
  ok((await page.inputValue("#inv-f-wu")) === "", "Garantie-Schnellwahl braucht zuerst das Kaufdatum");
  await page.fill("#inv-f-bought", bought);
  await page.click(`${sheet} [data-wm="24"]`);
  const wu = await page.inputValue("#inv-f-wu");
  ok(wu && wu > inDays(10) && wu <= inDays(15), "Garantie bis = Kaufdatum + 2 Jahre − 1 Tag (" + wu + ")");
  await page.setInputFiles("#inv-f-photo", { name: "wm.png", mimeType: "image/png", buffer: png() });
  await page.waitForSelector(`${sheet} .inv-photo-prev img`);
  await H.shot(page, "inventar-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".inv .ak-det");
  let items = await A(page, "inventar");
  ok(items.length === 1 && items[0].serial === "QX-998877" && items[0].price === 649 && items[0].room === "Bad" && items[0].cat === "haushalt" && items[0].warrantyUntil === wu, "Gespeichert (SN groß, Preis, Raum, Kategorie, Garantie)");
  ok(items[0].photoId === "inv_" + items[0].id, "Foto in der Bildablage");
  const id1 = items[0].id;
  ok((await page.evaluate(() => location.hash)) === "#alltag/inventar/" + id1, "Detail-Route");
  ok((await page.textContent(".ak-hero")).includes("Garantie endet in"), "Garantie-Abzeichen „endet in … Tagen“");
  await page.waitForSelector(".ak-hero-ph img");
  ok((await page.textContent(".inv-docs")).includes("Rechnung & Dokumente"), "Bereich 🧾 Rechnung & Dokumente");
  await H.shot(page, "inventar-detail-390-light.png");

  /* ---------- zweites Ding ---------- */
  await page.click('[data-inv="back"]');
  await page.waitForSelector(".inv .ak-list");
  await page.click('.inv [data-inv="new"]');
  await page.waitForSelector("#inv-f-name");
  await page.fill("#inv-f-name", "Laptop");
  await page.fill("#inv-f-room", "Büro");
  await page.fill("#inv-f-price", "1.199,90");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".inv .ak-det");
  items = await A(page, "inventar");
  ok(items.find((x) => x.name === "Laptop").price === 1199.9, "Betrag mit Tausenderpunkt verstanden");
  await page.click('[data-inv="back"]');
  await page.waitForSelector(".inv .ak-list");
  ok((await page.textContent(".inv-sum")).includes("1.848,90"), "Gesamtwert 1.848,90 €");
  await page.click('[data-view="raeume"]');
  await page.waitForSelector(".inv-rooms-l");
  const rooms = await page.$$eval(".inv-room b", (b) => b.map((x) => x.textContent));
  ok(rooms.join(",") === "Büro,Bad", "Räume nach Wert sortiert");
  await H.shot(page, "inventar-rooms-390-light.png");
  await page.click('.inv-room[data-room="Bad"]');
  ok((await page.$$(".inv .ak-list .ak-card")).length === 1, "Raum antippen → gefilterte Liste");
  await page.click('.inv-rooms [data-room=""]');
  await page.fill("#inv-q", "QX998877");
  await page.waitForTimeout(100);
  ok((await page.$$(".inv .ak-card")).length === 1, "Suche nach Seriennummer (auch ohne Bindestrich)");
  await page.fill("#inv-q", "");

  /* ---------- QR + Druckbogen ---------- */
  await page.goto(BASE + "#alltag/inventar/" + id1);
  await page.waitForSelector('[data-inv="qr"]');
  await page.click('[data-inv="qr"]');
  await page.waitForSelector(`${sheet} .wz-qr-box svg`);
  ok((await page.textContent(`${sheet} .wz-qr-url`)).endsWith("#alltag/inventar/" + id1), "QR-Sticker mit Link zur Detailseite");
  await page.click(`${sheet} [data-q="print"]`);
  await page.waitForSelector("#wz-print-root .wz-st");
  ok((await page.textContent("#wz-print-root .wz-pr-n")) === "1 von 2 ausgewählt", "Druckbogen: nur dieser Sticker ausgewählt");
  await H.shot(page, "inventar-print-390-light.png");
  await page.emulateMedia({ media: "print" });
  ok(await page.$eval("#wz-print-root", (e) => getComputedStyle(e).display !== "none") && await page.$eval(".app, #app, body > header", (e) => getComputedStyle(e).display === "none").catch(() => true), "Druckansicht zeigt nur den Bogen");
  await page.emulateMedia({ media: "screen" });
  await page.click('#wz-print-root [data-p="close"]');
  await page.waitForTimeout(200);
  ok(!(await page.$("#wz-print-root")), "Druckbogen geschlossen");

  /* ---------- Rechnung verknüpfen ---------- */
  await page.click(".inv-docs .ak-linked-h a");
  await page.waitForSelector(`${sheet} [data-pre]`);
  ok((await page.textContent(sheet)).includes("Waschmaschine"), "„＋ Dokument“ → Dokumente mit Vorbelegung Inventar");
  await page.setInputFiles(`${sheet} input[data-pre][accept^="application"]`, { name: "Rechnung.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await page.waitForSelector("#dk-f-title");
  ok((await page.textContent(`${sheet} .ak-linklist`)).includes("Waschmaschine"), "Verknüpfung vorausgefüllt");
  await page.selectOption("#dk-f-folder", "rechnungen");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".dk .ak-det");
  await page.goto(BASE + "#alltag/inventar/" + id1);
  await page.waitForSelector(".inv-docs .ak-linked-i");
  ok((await page.textContent(".inv-docs")).includes("Rechnung"), "Rechnung erscheint auf der Inventar-Seite");

  /* ---------- Benachrichtigung + Suche + Deep-Link ---------- */
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.waitForTimeout(300);
  ok((await page.textContent("#nt-body")).includes("Waschmaschine") && (await page.textContent("#nt-body")).includes("Garantie endet"), "Benachrichtigung „Garantie endet …“");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.click("#btn-search");
  await page.fill("#srch-q", "Elektro Muster");
  await page.waitForSelector('.srch-group[data-group="inventar"]');
  ok((await page.textContent('.srch-group[data-group="inventar"]')).includes("Waschmaschine"), "Globale Suche findet Inventar (Händler)");
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForSelector(".inv .ak-det");
  ok((await page.textContent(".ak-hero h2")) === "Waschmaschine", "Deep-Link nach Neuladen (QR-Scan)");

  /* ---------- Löschen ---------- */
  await page.click('[data-inv="del"]');
  await page.click('[data-inv="del"]');
  await page.waitForFunction(() => location.hash === "#alltag/inventar");
  ok((await A(page, "inventar")).length === 1, "Gelöscht");

  /* ---------- Desktop + dunkel ---------- */
  const seed = [{ id: "i1", name: "Waschmaschine", cat: "haushalt", room: "Bad", brand: "Testmarke WM-1", serial: "QX-998877", price: 649, boughtOn: bought, warrantyUntil: wu },
    { id: "i2", name: "Laptop", cat: "elektronik", room: "Büro", price: 1199.9, warrantyUntil: inDays(300) }, { id: "i3", name: "Sofa", cat: "moebel", room: "Wohnzimmer", price: 900, warrantyUntil: inDays(-30) }];
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    const p = await H.newPage(scheme, w, h);
    await H.boot(p, { alltag: { inventar: seed } });
    await p.goto(BASE + "#alltag/inventar");
    await p.waitForSelector(".inv .ak-list");
    await H.shot(p, `inventar-list-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Liste ohne waagrechtes Scrollen (${w} ${scheme})`);
    await p.goto(BASE + "#alltag/inventar/i1");
    await p.waitForSelector(".inv .ak-det");
    await H.shot(p, `inventar-detail-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await p.context().close();
  }
  ok(H.errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (H.errors.length ? ":\n" + H.errors.join("\n") : ""));
  await H.browser.close();
  console.log("\nAlle Inventar-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
