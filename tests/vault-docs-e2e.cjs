// Playwright-Test für Tresor › Dokumente (Reisepass mit Fotos + PDF), lokaler Modus.
//   cd <worktree> && python3 -m http.server 8872 &   then   node tests/vault-docs-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Prüft u. a., dass localStorage, IndexedDB und Cache Storage KEINEN Klartext
// (Titel, Nummer, Marker im JPEG-Kommentar und im PDF-Text, Bild-Bytes) enthalten.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const PORT = 8872;
const BASE = `http://localhost:${PORT}/`;
const OUT = process.argv[2] || require("os").tmpdir();

const MASTER = "Kaktus Laterne Wolke 77";
const TITLE = "Reisepass MARKER-TITLE-3141";
const NUMBER = "MARKERNUM9876";
const IMG_MARK = "MARKER-IMG-COMMENT-7731";
const PDF_MARK = "MARKER-PDF-TEXT-5519";
const AUTH = "BH Testdorf MARKERAUTH-404";

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const TODAY = key(new Date());
// wie vault-docs-core.addMonths (Tag am Monatsende gekappt)
const addMK = (k, n, extraDays = 0) => {
  const [y, m, d] = k.split("-").map(Number);
  const t = y * 12 + m - 1 + n, ny = Math.floor(t / 12), nm = t - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(ny, nm, Math.min(d, last) + extraDays));
  return dt.toISOString().slice(0, 10);
};

function pdfFixture(text) {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let s = "%PDF-1.4\n";
  const off = [];
  objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", acceptDownloads: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE.slice(0, -1) });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => { window.__tresorTest = { iter: 2000 }; });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = true) => { await page.waitForTimeout(400); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const sheetClose = async () => { await page.click(".sheet:last-child .close"); await page.waitForTimeout(120); };
  const todos = () => page.evaluate(async () => (await import("/js/store.js")).get().todos.filter((t) => t.id.startsWith("vr_")));

  // Alles, was im Browser dauerhaft gespeichert ist (localStorage, sessionStorage, IndexedDB, Cache Storage)
  const storageDump = () => page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.push(k, localStorage.getItem(k)); }
    out.push(JSON.stringify(sessionStorage));
    const ser = async (v) => {
      if (v instanceof Blob) return await v.text();
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return new TextDecoder("latin1").decode(v);
      return JSON.stringify(v);
    };
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    let chunks = 0;
    for (const { name } of dbs) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const st of db.objectStoreNames) {
        const all = await new Promise((res) => { const r = db.transaction(st).objectStore(st).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
        if (name === "stempelkarte-vault") chunks += all.length;
        for (const v of all) out.push(await ser(v));
      }
      db.close();
    }
    let cached = 0;
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const req of await c.keys()) { cached++; out.push(req.url); const r = await c.match(req); if (r) out.push(await r.text()); }
    }
    return { text: out.join("\n"), chunks, cached, dbs: dbs.map((d) => d.name) };
  });
  // Klartext auch in base64-Form suchen (alle 3 Ausrichtungen)
  const b64Forms = (buf) => [0, 1, 2].map((o) => buf.subarray(o, o + Math.floor((buf.length - o) / 3) * 3).toString("base64")).filter((s) => s.length >= 16);
  const leaksIn = (dump, needles) => needles.filter((n) => {
    const b = Buffer.isBuffer(n) ? n : Buffer.from(n, "utf8");
    return (!Buffer.isBuffer(n) && dump.includes(n)) || b64Forms(b).some((f) => dump.includes(f));
  });

  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);

  // Testbilder im Browser erzeugen: große JPEGs mit Marker im JPEG-Kommentar (COM-Segment)
  const mkJpeg = (w, h, label) => page.evaluate(async ({ w, h, label, mark }) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#c7d2fe"); gr.addColorStop(1, "#fde68a");
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1e3a8a"; g.font = `bold ${Math.round(h / 9)}px sans-serif`; g.fillText("REPUBLIK ÖSTERREICH", w * 0.06, h * 0.18);
    g.font = `${Math.round(h / 14)}px sans-serif`; g.fillText(label, w * 0.06, h * 0.34);
    g.fillStyle = "#94a3b8"; g.fillRect(w * 0.06, h * 0.45, w * 0.26, h * 0.42);
    for (let i = 0; i < 6; i++) { g.fillStyle = "#334155"; g.fillRect(w * 0.38, h * (0.48 + i * 0.07), w * (0.3 + (i % 3) * 0.1), h * 0.025); }
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
    const b = new Uint8Array(await blob.arrayBuffer());
    const m = new TextEncoder().encode(mark);
    const seg = new Uint8Array(4 + m.length); seg[0] = 0xFF; seg[1] = 0xFE; seg[2] = (m.length + 2) >> 8; seg[3] = (m.length + 2) & 255; seg.set(m, 4);
    const out = new Uint8Array(b.length + seg.length); out.set(b.subarray(0, 2)); out.set(seg, 2); out.set(b.subarray(2), 2 + seg.length);
    let s = ""; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, label, mark: IMG_MARK }).then((s) => Buffer.from(s, "base64"));
  const front = await mkJpeg(3000, 2100, "REISEPASS · Vorderseite");
  const back = await mkJpeg(2400, 1700, "Rückseite · Unterschrift");
  const pdf = pdfFixture(PDF_MARK);
  ok(front.includes(Buffer.from(IMG_MARK)) && pdf.includes(Buffer.from(PDF_MARK)), `Fixtures: JPEG ${Math.round(front.length / 1024)} kB mit Kommentar-Marker, PDF mit Text-Marker`);

  /* ---------- Tresor anlegen ---------- */
  await page.evaluate(() => { location.hash = "#alltag/tresor"; });
  await page.waitForSelector(".tr-setup");
  await page.fill("#tr-new", MASTER);
  await page.fill("#tr-new2", MASTER);
  await page.check("#tr-paper");
  await page.click("[data-tr=create]");
  await page.waitForSelector(".tr-empty", { timeout: 10000 });
  ok(await page.isVisible('.tr-empty [data-tr="newdoc"]'), "Leerer Tresor bietet „Dokument“ an");

  /* ---------- Reisepass anlegen ---------- */
  await page.click("[data-tr=new]");
  await page.click('.tr-types [data-type="doc"]');
  await page.waitForSelector(".vd-form");
  ok(await page.$$eval(".vd-kinds [data-kind]", (b) => b.map((x) => x.textContent.trim()).join("|")) === "🛂 Reisepass|🪪 Personalausweis|🚗 Führerschein|🔧 Lehrlingsausweis|🏥 e-card|🎓 Schülerausweis|🛡️ Versicherung|📜 Zeugnis|✍️ Vertrag|📄 Sonstiges", "Alle 10 Dokument-Arten");
  ok(await page.inputValue("#vd-title") === "Reisepass", "Titel übernimmt die Art");
  const cam = await page.$("#vd-cam");
  ok(await cam.getAttribute("accept") === "image/*" && await cam.getAttribute("capture") === "environment", "Kamera-Knopf: accept=image/* capture=environment");
  ok((await page.textContent(".vd-hint")).includes("Dokument flach hinlegen, gutes Licht"), "Hinweis „Dokument flach hinlegen, gutes Licht“");
  ok(await page.isDisabled("#vd-remind") && !(await page.isChecked("#vd-remind")), "Erinnerung ohne Ablaufdatum aus");
  // zu großes PDF
  await page.setInputFiles("#vd-pick", { name: "riesig.pdf", mimeType: "application/pdf", buffer: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5.5 * 1024 * 1024, 32)]) });
  await page.waitForSelector(".vd-ferr:not([hidden])");
  ok((await page.textContent(".vd-ferr")).includes("höchstens 5 MB"), "PDF > 5 MB wird abgelehnt");
  await page.setInputFiles("#vd-pick", [
    { name: "pass-vorne.jpg", mimeType: "image/jpeg", buffer: front },
    { name: "pass-hinten.jpg", mimeType: "image/jpeg", buffer: back },
    { name: "pass-scan.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);
  await page.waitForFunction(() => document.querySelectorAll(".vd-etile").length === 3, null, { timeout: 15000 });
  ok(true, "2 Fotos + 1 PDF im Formular");
  ok(await page.$eval('[data-side="0"]', (s) => s.value) === "front" && await page.$eval('[data-side="1"]', (s) => s.value) === "back", "Fotos automatisch Vorder-/Rückseite");
  ok((await page.$$eval(".vd-etile img[src^='blob:']", (a) => a.length)) === 2, "Vorschau der Fotos (nur im Speicher)");
  await page.fill("#vd-title", TITLE);
  await page.fill("#vd-number", NUMBER);
  const issued = addMK(TODAY, -116);
  const expires = addMK(TODAY, 4, 7);
  await page.fill("#vd-issued", issued);
  await page.fill("#vd-expires", expires);
  await page.dispatchEvent("#vd-expires", "change");
  ok(await page.isChecked("#vd-remind"), "„Erinnern vor Ablauf“ mit Ablaufdatum standardmäßig an");
  const notice = await page.textContent("#vd-remnote");
  ok(notice === `Für die Erinnerung wird nur ‚Reisepass läuft ab am ${fmt(expires)}‘ unverschlüsselt als Termin gespeichert – keine Nummer, kein Bild.`, "Hinweis zur unverschlüsselten Erinnerung: " + notice);
  await page.fill("#vd-authority", AUTH);
  await page.fill("#vd-note", "Notiz MARKER-NOTE-2718");
  await shot("docs-editor-390-light.png", false);
  await page.click(".vd-editor [data-save]");
  await page.waitForSelector(".vd-form", { state: "detached", timeout: 15000 });
  ok(true, "Reisepass gespeichert");

  /* ---------- Erinnerung im Planer ---------- */
  let ts = await todos();
  ok(ts.length === 2 && ts.every((t) => t.title === `Reisepass erneuern – läuft am ${fmt(expires)} ab` && t.kind === "todo" && t.remind && t.time === "09:00"), "2 Planer-Aufgaben „Reisepass erneuern – läuft am … ab“");
  ok(ts.map((t) => t.date).sort().join() === [addMK(expires, -3), addMK(expires, -1)].join(), "Fällig 3 und 1 Monat vor Ablauf: " + ts.map((t) => t.date).join(", "));
  ok(!JSON.stringify(ts).includes("MARKER") && !JSON.stringify(ts).includes(NUMBER), "Aufgaben enthalten keinen Titel und keine Nummer");

  /* ---------- Liste, Abzeichen, Suche ---------- */
  ok((await page.textContent(".tr-item .vd-badge.soon")) === "läuft ab in 4 Monaten", "Zeile in „Alle“: gelbes Abzeichen „läuft ab in 4 Monaten“");
  await page.click('.tr-chips [data-f="t:doc"]');
  await page.waitForSelector(".vd-card");
  ok((await page.textContent(".vd-card b")) === TITLE, "Filter „Dokumente“ zeigt die Karte");
  const badge = await page.$eval(".vd-card .vd-badge", (b) => [b.className, b.textContent, getComputedStyle(b).color]);
  ok(badge[0].includes("soon") && badge[1] === "läuft ab in 4 Monaten", "Karte: gelbes Abzeichen „läuft ab in 4 Monaten“ (" + badge[2] + ")");
  await page.waitForSelector(".vd-card img[src^='blob:']", { timeout: 5000 });
  ok(true, "Verschlüsseltes Vorschaubild entschlüsselt und angezeigt");

  // zweites Dokument: abgelaufen → rot
  await page.click('[data-tr="newdoc"]');
  await page.waitForSelector(".vd-form");
  await page.click('[data-kind="fuehrerschein"]');
  ok(await page.inputValue("#vd-title") === "Führerschein", "Titel folgt der Art");
  const past = addMK(TODAY, -2);
  await page.fill("#vd-expires", past);
  await page.dispatchEvent("#vd-expires", "change");
  await page.click(".vd-editor [data-save]");
  await page.waitForSelector(".vd-form", { state: "detached" });
  await page.waitForSelector(".vd-card .vd-badge.expired");
  ok((await page.textContent(".vd-card .vd-badge.expired")).startsWith("abgelaufen seit"), "Abgelaufen → rotes Abzeichen: " + await page.textContent(".vd-card .vd-badge.expired"));
  ts = await todos();
  ok(ts.length === 3 && ts.some((t) => t.title.startsWith("Führerschein erneuern – abgelaufen am") && t.date === TODAY), "Abgelaufenes Dokument: eine Erinnerung für heute");
  await page.fill("#tr-q", "reisepass");
  await page.waitForTimeout(120);
  ok((await page.$$(".vd-card")).length === 1, "Suche „reisepass“ findet 1 Dokument");
  await page.fill("#tr-q", "testdorf");
  await page.waitForTimeout(120);
  ok((await page.$$(".vd-card")).length === 1, "Suche über ausstellende Behörde");
  await page.fill("#tr-q", NUMBER);
  await page.waitForTimeout(120);
  ok((await page.$$(".vd-card")).length === 0, "Suche durchsucht nicht die Nummer");
  await page.fill("#tr-q", "");
  await page.waitForTimeout(150);
  await page.$eval(".tr-chips", (e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2600); // Toast abwarten
  await shot("docs-list-390-light.png", false);

  /* ---------- Kein Klartext im Gerätespeicher ---------- */
  let dump = await storageDump();
  ok(dump.chunks >= 5, `IndexedDB „stempelkarte-vault“: ${dump.chunks} verschlüsselte Stücke (Fotos, Vorschaubilder, PDF)`);
  ok(dump.cached > 0, `Cache Storage geprüft (${dump.cached} Einträge)`);
  const needles = [TITLE, "MARKER-TITLE", NUMBER, IMG_MARK, PDF_MARK, AUTH, "MARKER-NOTE", "pass-vorne", "pass-scan"];
  let leaks = leaksIn(dump.text, needles);
  ok(leaks.length === 0, "localStorage/IndexedDB/Cache: kein Titel, keine Nummer, kein JPEG-Kommentar, kein PDF-Text" + (leaks.length ? " → " + leaks : ""));
  ok(!dump.text.includes("blob:"), "Keine Blob-URLs gespeichert");
  // Original-Bild-Bytes (Ausschnitte) nirgends
  leaks = leaksIn(dump.text, [front.subarray(4000, 4060), front.subarray(front.length - 300, front.length - 240), pdf.subarray(0, 60)]);
  ok(leaks.length === 0, "Original-Bild-/PDF-Bytes nicht im Speicher");

  /* ---------- Ansehen + Vollbild ---------- */
  await page.click(`.vd-card:has-text("${TITLE}")`);
  await page.waitForSelector(".vd-detail .vd-tiles");
  ok((await page.$$(".vd-detail .vd-tile")).length === 3, "Detail: 3 Dateien");
  ok(!(await page.textContent(".vd-detail")).includes(NUMBER), "Nummer zuerst verborgen");
  await page.click('.vd-detail [data-reveal="number"]');
  ok((await page.textContent('.vd-detail .tr-secret')) === NUMBER, "Auge zeigt die Nummer");
  ok((await page.textContent(".vd-remline")).includes("Erinnerung im Planer"), "Detail zeigt Erinnerung");
  await page.waitForSelector(".vd-detail .vd-tile img[src^='blob:']");
  await shot("docs-detail-390-light.png", false);
  await page.click('.vd-detail [data-file="0"]');
  await page.waitForSelector(".vd-viewer .vd-stage img:not([hidden])", { timeout: 8000 });
  const nat = await page.$eval(".vd-viewer img", (i) => [i.naturalWidth, i.naturalHeight, i.src]);
  ok(nat[0] === 2000 && nat[1] === 1400, `Foto verkleinert auf längste Seite 2000 px (${nat[0]}×${nat[1]})`);
  ok(nat[2].startsWith("blob:"), "Vollbild aus Blob-URL (nur im Speicher)");
  const imgBytes = Buffer.from(await page.evaluate(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }, nat[2]), "base64");
  ok(imgBytes[0] === 0xFF && imgBytes[1] === 0xD8 && !imgBytes.includes(Buffer.from(IMG_MARK)), `Entschlüsselt: JPEG (${Math.round(imgBytes.length / 1024)} kB), Metadaten entfernt`);
  dump = await storageDump();
  leaks = leaksIn(dump.text, [imgBytes.subarray(2000, 2060), imgBytes.subarray(imgBytes.length >> 1, (imgBytes.length >> 1) + 60)]);
  ok(leaks.length === 0, "Entschlüsselte Bild-Bytes nicht in localStorage/IndexedDB/Cache");
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(100);
  ok(/scale\((?!1\))[\d.]+\)/.test(await page.$eval(".vd-viewer img", (i) => i.style.transform)), "Zoom per Mausrad/Pinch (CSS-Transform): " + await page.$eval(".vd-viewer img", (i) => i.style.transform));
  // Pinch mit zwei Fingern (Pointer-Events)
  await page.$eval(".vd-stage", (st) => {
    const ev = (type, id, x, y) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
    ev("pointerdown", 11, 150, 400); ev("pointerdown", 12, 240, 400);
    ev("pointermove", 11, 100, 400); ev("pointermove", 12, 290, 400);
    ev("pointerup", 11, 100, 400); ev("pointerup", 12, 290, 400);
  });
  ok(true, "Pinch-Geste ohne Fehler");
  await page.dblclick(".vd-stage");
  await page.dblclick(".vd-stage");
  await page.click('.vd-viewer [data-v="next"]');
  await page.waitForFunction(() => /Rückseite · 2\/2/.test(document.querySelector(".vd-vtitle small").textContent));
  await page.waitForSelector(".vd-viewer .vd-stage img:not([hidden])");
  ok(true, "Weiter zur Rückseite (2/2)");
  await shot("docs-viewer-390.png", false);

  /* ---------- Teilen/Speichern mit Warnung ---------- */
  await page.click('.vd-viewer [data-v="share"]');
  await page.waitForSelector(".vd-share");
  ok((await page.textContent(".vd-share")).includes("Achtung: Die Datei ist dann unverschlüsselt auf dem Gerät"), "Teilen: Warnung „Achtung: Die Datei ist dann unverschlüsselt auf dem Gerät“");
  await shot("docs-share-390-light.png", false);
  let downloaded = false;
  const onDl = () => { downloaded = true; };
  page.on("download", onDl);
  await page.click(".vd-share [data-no]");
  await page.waitForTimeout(300);
  page.off("download", onDl);
  ok(!downloaded && !(await page.$(".vd-share")), "Abbrechen: nichts geteilt/gespeichert");
  await page.click('.vd-viewer [data-v="share"]');
  await page.waitForSelector(".vd-share");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click(".vd-share [data-yes]")]);
  const dlPath = path.join(OUT, "docs-share-test.jpg");
  await dl.saveAs(dlPath);
  const dlBytes = fs.readFileSync(dlPath);
  ok(dlBytes[0] === 0xFF && dlBytes[1] === 0xD8 && dl.suggestedFilename().endsWith(".jpg"), `Bestätigt: Fallback-Download (${dl.suggestedFilename()}, ${Math.round(dlBytes.length / 1024)} kB)`);
  fs.unlinkSync(dlPath);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".vd-viewer", { state: "detached" });

  /* ---------- PDF öffnen (Blob-URL) ---------- */
  // a) Gerät ohne PDF-Betrachter (Handy-Chrome, App, headless): über Teilen/Speichern mit Warnung
  ok(await page.evaluate(() => navigator.pdfViewerEnabled) === false, "Headless: kein eingebauter PDF-Betrachter");
  await page.click('.vd-detail [data-file="2"]');
  await page.waitForSelector(".vd-share");
  ok((await page.textContent(".vd-share")).includes("kann PDFs nicht direkt anzeigen") && (await page.textContent(".vd-share")).includes("unverschlüsselt"), "Ohne PDF-Betrachter: Warnung statt stillem Download");
  const [dlp] = await Promise.all([page.waitForEvent("download"), page.click(".vd-share [data-yes]")]);
  const p1 = path.join(OUT, "docs-pdf-share.pdf");
  await dlp.saveAs(p1);
  ok(fs.readFileSync(p1, "latin1").includes(PDF_MARK) && dlp.suggestedFilename() === "pass-scan.pdf", "PDF nach Bestätigung gespeichert und richtig entschlüsselt");
  fs.unlinkSync(p1);
  // b) Gerät mit PDF-Betrachter (PC): öffnet in neuem Fenster per Blob-URL
  await page.evaluate(() => Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", { configurable: true, get: () => true }));
  // (headless lädt die Blob-URL trotzdem als Download, weil es keinen echten Betrachter gibt)
  let pop = null;
  const res = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PDF-Fenster öffnet nicht")), 10000);
    ctx.once("page", (pg) => {
      pop = pg;
      pg.on("download", (d) => { clearTimeout(to); resolve({ url: d.url(), dl: d }); });
      pg.on("framenavigated", (f) => { if (f === pg.mainFrame() && f.url().startsWith("blob:")) { clearTimeout(to); resolve({ url: f.url() }); } });
    });
    page.click('.vd-detail [data-file="2"]').catch(reject);
  });
  const pdfUrl = res.url;
  ok(pdfUrl.startsWith("blob:http://localhost"), "PDF öffnet in einer Blob-URL" + (res.dl ? " (headless: als Download)" : "") + ": " + pdfUrl.slice(0, 40));
  let pdfText;
  if (res.dl) { const p2 = path.join(OUT, "docs-open-test.pdf"); await res.dl.saveAs(p2); pdfText = fs.readFileSync(p2, "latin1"); fs.unlinkSync(p2); }
  else pdfText = await page.evaluate(async (u) => { try { return await (await fetch(u)).text(); } catch (e) { return "ERR " + e.message; } }, pdfUrl);
  ok(pdfText.includes(PDF_MARK), "PDF richtig entschlüsselt (Text-Marker enthalten)");
  if (pop) await pop.close().catch(() => {});
  await sheetClose();

  /* ---------- Sperren / Entsperren ---------- */
  const thumbUrl = await page.$eval(".vd-card img[src^='blob:']", (i) => i.src);
  await page.click("[data-tr=lock]");
  await page.waitForSelector(".tr-lock");
  const html = await page.content();
  ok(![TITLE, NUMBER, AUTH, "läuft ab in"].some((v) => html.includes(v)), "Gesperrt: kein Klartext im DOM");
  const revoked = await page.evaluate(async (u) => { try { await fetch(u); return false; } catch { return true; } }, thumbUrl);
  ok(revoked, "Gesperrt: Blob-URLs der Vorschaubilder widerrufen");
  await shot("docs-locked-390-light.png");
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  await page.click('.tr-chips [data-f="t:doc"]');
  await page.waitForSelector(".vd-card img[src^='blob:']", { timeout: 5000 });
  ok((await page.$$(".vd-card")).length === 2, "Entsperrt: beide Dokumente mit Vorschaubild");
  await page.click(`.vd-card:has-text("${TITLE}")`);
  await page.click('.vd-detail [data-file="1"]');
  await page.waitForSelector(".vd-viewer .vd-stage img:not([hidden])", { timeout: 8000 });
  ok((await page.textContent(".vd-vtitle small")).startsWith("Rückseite"), "Nach Entsperren: Vollbild öffnet");
  await page.click('.vd-viewer [data-v="close"]');
  await sheetClose();

  /* ---------- Einstellungen: Speicher ---------- */
  await page.click("[data-tr=settings]");
  const usage = await page.textContent(".tr-usage");
  const usedN = Number(await page.getAttribute(".tr-usage", "data-usage"));
  ok(usage.includes("Belegter Speicher (verschlüsselt)") && usedN > front.length / 3 && /MB|kB/.test(usage), "Einstellungen: belegter verschlüsselter Speicher " + usage.match(/\d[\d,]* [kM]B/)[0]);
  await shot("docs-settings-390-light.png", false);
  await sheetClose();

  /* ---------- Screenshots dunkel ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(200);
  await page.$eval(".tr-chips", (e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(2600); // Toast abwarten
  await shot("docs-list-390-dark.png", false);
  await page.click(`.vd-card:has-text("${TITLE}")`);
  await page.waitForSelector(".vd-detail .vd-tile img[src^='blob:']");
  await shot("docs-detail-390-dark.png", false);
  await page.click(".vd-detail [data-edit]");
  await page.waitForSelector(".vd-form");
  await page.waitForTimeout(300);
  await shot("docs-editor-390-dark.png", false);

  /* ---------- Erinnerung ausschalten → Aufgaben weg ---------- */
  await page.uncheck("#vd-remind");
  await page.click(".vd-editor [data-save]");
  await page.waitForSelector(".vd-form", { state: "detached" });
  ts = await todos();
  ok(ts.length === 1 && ts[0].title.startsWith("Führerschein"), "Erinnerung ausgeschaltet → beide Reisepass-Aufgaben entfernt");
  ok((await page.$$(".vd-detail")).length === 0, "Editor geschlossen");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await shot("docs-list-1440.png", false);
  await page.setViewportSize({ width: 390, height: 844 });

  /* ---------- Löschen: Dateien + Erinnerung weg ---------- */
  const before = (await storageDump()).chunks;
  await page.click('.vd-card:has-text("Führerschein")');
  await page.click(".vd-detail [data-del]");
  await page.click(".vd-detail [data-del]");
  await page.waitForTimeout(400);
  ok((await todos()).length === 0, "Dokument gelöscht → Erinnerung entfernt");
  await page.click(`.vd-card:has-text("${TITLE}")`);
  await page.click(".vd-detail [data-del]");
  await page.click(".vd-detail [data-del]");
  await page.waitForTimeout(500);
  const after = await storageDump();
  ok(before >= 5 && after.chunks === 0, `Dokument gelöscht → verschlüsselte Stücke entfernt (${before} → ${after.chunks})`);
  ok((await page.textContent(".tr-main")).includes("Noch keine"), "Leere Liste");

  const real = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  console.log("Konsolenfehler:", real.length ? real : "keine");
  await browser.close();
  if (real.length) process.exit(1);
  console.log("ALLE TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
