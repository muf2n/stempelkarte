// Playwright-Test für Alltag › 📁 Dokumente (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9411 &   then   node tests/dokumente-e2e.cjs [screenshot-dir]
// Kachel + Route, leerer Zustand, Foto hochladen (verkleinert, Vorschau), Ordner/Tags/Ablauf/Verknüpfung (Baustelle),
// PDF mit eigenem Ordner, Favorit, Ansichten (Favoriten/Läuft ab), Suche, „🤖 Text erkennen“ (/chat gestubbt, erst nach Okay),
// Öffnen (Blob-Tab), Teilen/Download, Bearbeiten, verknüpfte Liste auf der Baustellen-Projektseite, „＋ Dokument“ mit Vorbelegung,
// Benachrichtigung „läuft ab“, globale Suche (auch im erkannten Text), Löschen (Datei weg), Desktop 1440 hell/dunkel.
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:9411/";
const OUT = process.argv[2] || require("os").tmpdir();
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };

// kleines PNG (24×16, bunt) erzeugen – ohne Abhängigkeiten
function png(w = 24, h = 16) {
  const zlib = require("zlib");
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 10; raw[o + 1] = y * 15; raw[o + 2] = 200; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const chatBodies = [];
  async function newPage(scheme, width, height) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800, acceptDownloads: true });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(() => { window.__skAiTest = { token: "test", url: location.origin }; });
    const page = await ctx.newPage();
    page.on("console", (msg) => {
      const t = msg.text();
      if (/Content Security Policy|Refused to/.test(t)) errors.push("CSP: " + t);
      else if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(t)) errors.push(t);
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).hostname === "localhost" && !/\/chat$/.test(r.url())) errors.push(r.status() + " " + r.url()); });
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "```\nRECHNUNG Nr. 4711\nWaschmaschine Testmarke WM-1\nSeriennummer QX-998877\n```", actions: [], usage: null }) });
    });
    return page;
  }
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  let page = await newPage("light", 390, 844);
  const shot = async (name, p = page) => { await p.waitForTimeout(350); return p.screenshot({ path: path.join(OUT, name), fullPage: true }); };
  const A = (n, p = page) => p.evaluate((n) => JSON.parse(localStorage.getItem("sk-a-" + n) || "[]"), n);
  const sheet = ".sheet:last-child";
  const boot = async (p, extra = null) => {
    await p.goto(BASE);
    await p.evaluate((extra) => {
      localStorage.clear();
      if (extra) for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem("stempelkarte.local.v1", JSON.stringify({ entries: [], places: [{ id: "p1", name: "Baustelle Muster", addr: "Musterweg 1", lat: 47, lng: 15, radius: 150 }],
        todos: [{ id: "t1", kind: "todo", title: "Garantie einlösen", date: "", done: false }], days: {}, running: null, rev: Date.now(), settings: { weeklyTarget: 38.5 } }));
    }, extra);
    await p.reload();
    await p.click("#btn-local");
    await p.waitForTimeout(300);
  };
  await boot(page);

  /* ---------- Kachel + leer ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="dokumente"]');
  ok((await page.textContent('.al-tile[data-id="dokumente"]')).includes("Dokumente"), "Kachel „📁 Dokumente“");
  await page.click('.al-tile[data-id="dokumente"]');
  await page.waitForSelector(".dk .ak-empty");
  ok((await page.textContent(".dk .ak-empty")).includes("Noch keine Dokumente"), "Leerer Zustand mit Hinweis");
  ok((await page.textContent(".dk .ak-foot")).includes("nicht verschlüsselt"), "Hinweis: nicht verschlüsselt → Tresor");
  ok(await page.$eval('[data-dk-file="cam"]', (i) => i.getAttribute("capture") === "environment" && i.accept === "image/*"), "Foto-Knopf öffnet die Kamera (capture)");
  await shot("dokumente-empty-390-light.png");

  /* ---------- Foto hochladen ---------- */
  await page.setInputFiles('[data-dk-file="file"]', { name: "Garantieschein.png", mimeType: "image/png", buffer: png() });
  await page.waitForSelector("#dk-f-title");
  ok((await page.inputValue("#dk-f-title")) === "Garantieschein", "Titel aus dem Dateinamen");
  await page.fill("#dk-f-title", "Garantie Waschmaschine");
  await page.selectOption("#dk-f-folder", "garantie");
  await page.fill("#dk-f-tags", "Küche, #Garantie, küche");
  const exp = inDays(10);
  await page.fill("#dk-f-exp", exp);
  await page.selectOption("#dk-f-lk", "place");
  await page.click(`${sheet} [data-addlink]`);
  ok((await page.textContent(`${sheet} .ak-linklist`)).includes("Baustelle Muster"), "Verknüpfung zur Baustelle im Formular");
  await page.selectOption("#dk-f-lk", "todo");
  await page.click(`${sheet} [data-addlink]`);
  await shot("dokumente-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".dk .ak-det");
  let docs = await A("dokumente");
  const docs0 = docs[0];
  ok(docs.length === 1 && docs[0].type === "image/jpeg" && docs[0].folder === "garantie" && docs[0].expires === exp && docs[0].chunks === 1, "Gespeichert als JPEG (verkleinert) mit Ordner, Ablauf, Stückzahl");
  ok(JSON.stringify(docs[0].tags) === JSON.stringify(["Küche", "Garantie"]), "Tags bereinigt (ohne #, ohne Doppelte)");
  ok(docs[0].links.length === 2 && docs[0].links[0].k === "place" && docs[0].links[1].k === "todo", "Verknüpfungen gespeichert (Baustelle, Aufgabe)");
  ok(docs[0].thumb.startsWith("data:image/jpeg"), "Vorschaubild");
  const id1 = docs[0].id;
  ok((await page.evaluate(() => location.hash)) === "#alltag/dokumente/" + id1, "Detail-Route");
  await page.waitForSelector("#dk-prev img:not(.is-thumb)");
  ok(await page.$eval("#dk-prev img", (i) => i.src.startsWith("data:image/jpeg;base64,")), "Vorschau aus der Ablage (IndexedDB)");
  ok((await page.textContent(".ak-hero")).includes("läuft in 10 Tagen ab"), "Ablauf-Abzeichen");
  ok((await page.textContent(".ak-det")).includes("Baustelle Muster") && (await page.textContent(".ak-det")).includes("Garantie einlösen"), "Verknüpfungs-Chips");
  await shot("dokumente-detail-390-light.png");

  /* ---------- 🤖 Text erkennen ---------- */
  await page.click('[data-dk="ocr"]');
  await page.waitForSelector("#dk-ocr-in");
  ok(chatBodies.length === 1 && chatBodies[0].mode === "lehrer" && chatBodies[0].image && chatBodies[0].image.type === "image/jpeg" && !chatBodies[0].image.data.startsWith("data:"), "/chat mit Bild (lehrer, base64 ohne Kopf)");
  ok((await page.inputValue("#dk-ocr-in")).startsWith("RECHNUNG Nr. 4711"), "Erkannter Text ohne Markdown-Zaun");
  ok(!(await A("dokumente"))[0].ocr, "Noch nicht gespeichert – erst nach Okay");
  await shot("dokumente-ocr-390-light.png");
  await page.click('[data-dk="ocrok"]');
  await page.waitForTimeout(250);
  ok((await A("dokumente"))[0].ocr.includes("QX-998877"), "Text nach Bestätigung gespeichert");
  await page.waitForSelector(".dk-ocr");

  /* ---------- Großansicht + Teilen ---------- */
  await page.click('[data-dk="view"]');
  await page.waitForSelector(`${sheet} .ak-photo-big img`);
  ok(true, "Großansicht des Fotos");
  await page.click(`${sheet} .close`);

  /* ---------- PDF mit eigenem Ordner ---------- */
  await page.click('[data-dk="back"]');
  await page.waitForSelector(".dk .ak-list");
  await page.setInputFiles('[data-dk-file="file"]', { name: "Rechnung-Handy.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.waitForSelector("#dk-f-title");
  await page.selectOption("#dk-f-folder", "__neu");
  ok(await page.isVisible("#dk-f-own"), "Eigener Ordner: Eingabefeld erscheint");
  await page.fill("#dk-f-own", "Auto");
  await page.check("#dk-f-fav");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".dk .ak-det");
  docs = await A("dokumente");
  const pdf = docs.find((d) => d.type === "application/pdf");
  ok(pdf && pdf.folder === "Auto" && pdf.fav === true && pdf.size === PDF.length, "PDF gespeichert (eigener Ordner, Favorit, Originalgröße)");
  ok(!(await page.$('[data-dk="ocr"]')), "Kein „Text erkennen“ bei PDFs");
  // window.open beobachten (headless Chromium lädt PDF-Blobs sonst als Download statt als Tab)
  await page.evaluate(() => { window.__opened = []; const o = window.open; window.open = (u, t) => { window.__opened.push(String(u)); return { closed: false }; }; window.__restoreOpen = () => { window.open = o; }; });
  await page.click('[data-dk="view"]');
  await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: 4000 }).catch(() => {});
  const opened = await page.evaluate(() => { window.__restoreOpen(); return window.__opened; });
  ok(opened.length === 1 && opened[0].startsWith("blob:"), "PDF öffnet als Blob-URL in neuem Tab (Desktop/Browser)");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }).catch(() => null), page.click('[data-dk="share"]')]);
  ok(dl && dl.suggestedFilename() === "Rechnung-Handy.pdf", "Teilen/Speichern → Download mit Dateinamen (ohne Web-Share)");

  /* ---------- Liste: Ordner, Favoriten, Ablauf, Suche ---------- */
  await page.click('[data-dk="back"]');
  await page.waitForSelector(".dk .ak-list");
  ok((await page.$$(".dk .ak-card")).length === 2, "Zwei Dokumente in der Liste");
  ok((await page.textContent(".dk .ak-card")).includes("Rechnung-Handy"), "Favorit steht oben");
  ok(await page.$('.dk-folders [data-folder="Auto"]'), "Eigener Ordner als Chip");
  await page.click('.dk-folders [data-folder="garantie"]');
  ok((await page.$$(".dk .ak-card")).length === 1, "Ordner-Filter");
  await page.click('.dk-folders [data-folder=""]');
  await page.click('[data-view="ablauf"]');
  ok((await page.$$(".dk .ak-card")).length === 1 && (await page.textContent(".dk .ak-card")).includes("Waschmaschine"), "Ansicht „Läuft ab“");
  await page.click('[data-view="fav"]');
  ok((await page.$$(".dk .ak-card")).length === 1 && (await page.textContent(".dk .ak-card")).includes("Rechnung"), "Ansicht „Favoriten“");
  await page.click('[data-view="alle"]');
  await page.fill("#dk-q", "qx-998877");
  await page.waitForTimeout(100);
  ok((await page.$$(".dk .ak-card")).length === 1, "Suche findet auch im erkannten Text");
  await page.fill("#dk-q", "");
  await page.click('.dk-tags [data-tag="Küche"]');
  ok((await page.$$(".dk .ak-card")).length === 1, "Tag-Filter");
  await page.click('.dk-tags [data-tag="Küche"]');
  await shot("dokumente-list-390-light.png");

  /* ---------- Bearbeiten ---------- */
  await page.click(`.dk .ak-card[data-id="${id1}"]`);
  await page.waitForSelector('[data-dk="edit"]');
  await page.click('[data-dk="edit"]');
  await page.waitForSelector("#dk-f-title");
  await page.fill("#dk-f-notes", "Original im Ordner Küche");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(250);
  ok((await A("dokumente")).find((d) => d.id === id1).notes === "Original im Ordner Küche", "Bearbeiten speichert");

  /* ---------- Baustellen-Projektseite: 📎 Dokumente + „＋ Dokument“ mit Vorbelegung ---------- */
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#site-root .st-docs");
  ok((await page.textContent("#site-root .st-docs")).includes("Garantie Waschmaschine"), "Projektseite zeigt verknüpfte Dokumente");
  await page.click("#site-root .st-docs .ak-linked-h a");
  await page.waitForSelector(`${sheet} [data-exlink]`);
  ok((await page.evaluate(() => location.hash)) === "#alltag/dokumente", "„＋ Dokument“ öffnet Dokumente (Hash bereinigt)");
  ok((await page.textContent(sheet)).includes("Baustelle Muster"), "Blatt mit Vorbelegung (Baustelle)");
  await page.selectOption("#dk-ex", pdf.id);
  await page.click(`${sheet} [data-exlink]`);
  await page.waitForTimeout(250);
  ok((await A("dokumente")).find((d) => d.id === pdf.id).links.some((l) => l.k === "place" && l.id === "p1"), "Vorhandenes Dokument verknüpft");

  /* ---------- Benachrichtigung + globale Suche ---------- */
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.waitForTimeout(300);
  ok((await page.textContent("#nt-body")).includes("Garantie Waschmaschine"), "Benachrichtigung „läuft ab“");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click("#btn-search");
  await page.fill("#srch-q", "QX-998877");
  await page.waitForSelector('.srch-group[data-group="dokumente"]');
  ok((await page.textContent('.srch-group[data-group="dokumente"]')).includes("Garantie Waschmaschine"), "Globale Suche findet das Dokument (auch über OCR-Text)");
  await page.click('.srch-group[data-group="dokumente"] [data-key], .srch-group[data-group="dokumente"] button, .srch-group[data-group="dokumente"] a');
  await page.waitForFunction((id) => location.hash === "#alltag/dokumente/" + id, id1);
  ok(true, "Treffer öffnet das Dokument");

  /* ---------- Löschen ---------- */
  await page.waitForSelector('[data-dk="del"]');
  await page.click('[data-dk="del"]');
  await page.click('[data-dk="del"]');
  await page.waitForFunction(() => location.hash === "#alltag/dokumente");
  await page.waitForTimeout(300);
  docs = await A("dokumente");
  ok(docs.length === 1, "Dokument gelöscht (zweimal tippen)");
  const left = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("stempelkarte-docs", 1); r.onsuccess = () => { const q = r.result.transaction("chunks").objectStore("chunks").getAllKeys(); q.onsuccess = () => res(q.result); }; }));
  ok(left.length === 1 && left[0].startsWith(pdf.id), "Datei-Stücke mit gelöscht");

  /* ---------- Desktop + dunkel ---------- */
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    const p = await newPage(scheme, w, h);
    await boot(p, { "sk-a-dokumente": [{ ...pdf, links: [{ k: "place", id: "p1" }, { k: "todo", id: "t1" }], tags: ["Handy", "Rechnung"], expires: inDays(-2) }, { ...docs0, id: "dimg" }] });
    await p.goto(BASE + "#alltag/dokumente");
    await p.waitForSelector(".dk .ak-list");
    await shot(`dokumente-list-${w}-${scheme}.png`, p);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Liste ohne waagrechtes Scrollen (${w} ${scheme})`);
    await p.goto(BASE + "#alltag/dokumente/" + pdf.id);
    await p.waitForSelector(".dk .ak-det");
    await shot(`dokumente-detail-${w}-${scheme}.png`, p);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!over, `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await p.context().close();
  }

  ok(errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await browser.close();
  console.log("\nAlle Dokumente-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
