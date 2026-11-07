// Playwright-Test für Alltag › 📁 Dokumente (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9411 &   then   node tests/dokumente-e2e.cjs [screenshot-dir]
// Kachel + Route, leerer Zustand, Foto hochladen (verkleinert, Vorschau), Ordner/Tags/Ablauf/Verknüpfung (Baustelle),
// PDF mit eigenem Ordner, Favorit, Ansichten (Favoriten/Läuft ab), Suche, „🤖 Text erkennen“ (/chat gestubbt, erst nach Okay),
// Öffnen (Blob-Tab), Teilen/Download, Bearbeiten, verknüpfte Liste auf der Baustellen-Projektseite, „＋ Dokument“ mit Vorbelegung,
// Benachrichtigung „läuft ab“, globale Suche (auch im erkannten Text), Löschen (Datei weg), Desktop 1440 hell/dunkel.
// 🔒 Update 10: Tresor-Passwort einrichten (aus Dokumente heraus), Umstellung eines alten Klartext-Dokuments, Sperren →
// kein Titel/Text/Datei-Byte (auch nicht base64) in localStorage/IndexedDB/Cache, Object-URLs widerrufen, gesperrte Ansicht,
// Benachrichtigung ohne Titel, Suche/Baustelle nur entsperrt, falsches Passwort, Auto-Sperre.
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
    await ctx.addInitScript(() => { window.__skAiTest = { token: "test", url: location.origin }; window.__tresorTest = { iter: 2000 }; });
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

  const MASTER = "Sonnenblume-Kaffee-42!";
  const OLD_MARK = "ALTVERTRAG-ZK7731";
  const OLD_PDF = Buffer.from(`%PDF-1.4\n% ${OLD_MARK} Mietvertrag Altbau Hauptstrasse\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  const storageDump = (p = page) => p.evaluate(async () => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.push(k, localStorage.getItem(k)); }
    out.push(JSON.stringify(sessionStorage));
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const { name } of dbs) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const st of db.objectStoreNames) {
        const all = await new Promise((res) => { const r = db.transaction(st).objectStore(st).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
        for (const v of all) out.push(v instanceof Blob ? await v.text() : JSON.stringify(v));
      }
      db.close();
    }
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const req of await c.keys()) { out.push(req.url); const r = await c.match(req); if (r && !/\.(png|jpg|webp|woff2?)$/.test(req.url)) out.push(await r.text()); }
    }
    return out.join("\n");
  });
  const b64Forms = (buf) => [0, 1, 2].map((o) => buf.subarray(o, o + Math.floor((buf.length - o) / 3) * 3).toString("base64")).filter((x) => x.length >= 16);
  const leaksIn = (dump, needles) => needles.filter((n) => {
    const b = Buffer.isBuffer(n) ? n : Buffer.from(n, "utf8");
    return (!Buffer.isBuffer(n) && dump.includes(n)) || b64Forms(b).some((f) => dump.includes(f));
  }).map((n) => (Buffer.isBuffer(n) ? `<${n.length} Bytes>` : n));
  const idbKeys = (p = page) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("stempelkarte-docs", 1); r.onupgradeneeded = () => r.result.createObjectStore("chunks", { keyPath: "id" }); r.onsuccess = () => { const q = r.result.transaction("chunks").objectStore("chunks").getAllKeys(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));

  /* ---------- Altbestand: Klartext-Dokument (vor Update 10) ---------- */
  const OLD = { id: "old1", title: "Mietvertrag Altbau", folder: "vertraege", tags: ["Wohnungsakte"], type: "application/pdf", size: OLD_PDF.length, name: "Mietvertrag.pdf", chunks: 1, date: inDays(-400), expires: inDays(5), remind: true, remindDays: 30, links: [{ k: "place", id: "p1" }], ocr: "", notes: "Kaution 3 Monatsmieten", created: 1, updated: 1 };
  await boot(page, { "sk-a-dokumente": [OLD] });
  await page.evaluate((b64) => new Promise((res, rej) => {
    const r = indexedDB.open("stempelkarte-docs", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("chunks", { keyPath: "id" });
    r.onsuccess = () => { const tx = r.result.transaction("chunks", "readwrite"); tx.objectStore("chunks").put({ id: "old1_0", n: 0, total: 1, data: b64 }); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
  }), OLD_PDF.toString("base64"));

  /* ---------- Kachel + kein Tresor ---------- */
  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="dokumente"]');
  ok((await page.textContent('.al-tile[data-id="dokumente"]')).includes("Dokumente"), "Kachel „📁 Dokumente“");
  await page.click('.al-tile[data-id="dokumente"]');
  await page.waitForSelector(".dk .dk-setup");
  ok((await page.textContent(".dk .dk-setup")).includes("Tresor-Passwort einrichten"), "Ohne Tresor: „🔒 Tresor-Passwort einrichten“");
  ok(await page.isHidden('label:has([data-dk-file="file"])'), "Ohne Tresor: kein Hochladen (neue Dokumente brauchen das Passwort)");
  ok((await page.textContent(".dk .ak-list")).includes("Mietvertrag Altbau"), "Alter Klartext-Bestand bleibt bis zur Umstellung sichtbar");
  await shot("dokumente-setup-390-light.png");

  /* ---------- Tresor einrichten → zurück → Umstellung ---------- */
  await page.click('[data-dk="setup"]');
  await page.waitForSelector(".tr-setup");
  await page.fill("#tr-new", MASTER);
  await page.fill("#tr-new2", MASTER);
  await page.check("#tr-paper");
  await page.click("[data-tr=create]");
  await page.waitForFunction(() => location.hash === "#alltag/dokumente", null, { timeout: 15000 });
  ok(true, "Nach dem Einrichten zurück zu Dokumente");
  await page.waitForSelector(".dk .dk-bar", { timeout: 10000 });
  await page.waitForFunction(() => { const a = JSON.parse(localStorage.getItem("sk-a-dokumente") || "[]"); return a.length === 1 && a[0].enc === 1 && !a[0].oldChunks; }, null, { timeout: 15000 });
  let raw = await A("dokumente");
  ok(!("title" in raw[0]) && !("notes" in raw[0]) && !("links" in raw[0]) && raw[0].folder === "vertraege" && raw[0].expires === OLD.expires && raw[0].fileId, "Altes Dokument umgestellt: nur Ordner/Ablauf/Größe im Klartext");
  let keys = await idbKeys();
  ok(!keys.includes("old1_0") && keys.some((k) => k.startsWith(raw[0].fileId + "_")), "Klartext-Datei gelöscht, verschlüsselte Stücke da");
  await page.waitForSelector(".dk .ak-list");
  ok((await page.textContent(".dk .ak-list")).includes("Mietvertrag Altbau"), "Entsperrt: umgestelltes Dokument lesbar");
  ok(await page.isVisible('label:has([data-dk-file="file"])'), "Entsperrt: Hochladen möglich");

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
  raw = await A("dokumente");
  const r1 = raw.find((d) => d.id !== "old1");
  ok(raw.length === 2 && r1.enc === 1 && r1.folder === "garantie" && r1.expires === exp && r1.chunks === 1 && r1.iv && r1.ct, "Gespeichert verschlüsselt (Ordner, Ablauf, Stückzahl im Klartext)");
  ok(!JSON.stringify(r1).includes("Garantie Waschmaschine") && !JSON.stringify(r1).includes("Küche") && !("thumb" in r1) && !("type" in r1), "Titel, Tags, Vorschau, Typ verschlüsselt");
  const id1 = r1.id;
  ok((await page.evaluate(() => location.hash)) === "#alltag/dokumente/" + id1, "Detail-Route");
  await page.waitForSelector("#dk-prev img[src^='blob:']");
  const prevSrc = await page.$eval("#dk-prev img", (i) => i.src);
  ok(prevSrc.startsWith("blob:"), "Vorschau entschlüsselt als Object-URL (nur im Speicher)");
  ok((await page.textContent(".ak-hero")).includes("läuft in 10 Tagen ab"), "Ablauf-Abzeichen");
  ok((await page.textContent(".ak-det")).includes("Baustelle Muster") && (await page.textContent(".ak-det")).includes("Garantie einlösen"), "Verknüpfungs-Chips");
  const D_tags = await page.textContent(".ak-tagrow");
  ok(D_tags.includes("#Küche") && D_tags.includes("#Garantie") && !D_tags.includes("#küche"), "Tags bereinigt (ohne #, ohne Doppelte)");
  await shot("dokumente-detail-390-light.png");

  /* ---------- 🤖 Text erkennen ---------- */
  await page.click('[data-dk="ocr"]');
  await page.waitForSelector("#dk-ocr-in");
  ok(chatBodies.length === 1 && chatBodies[0].mode === "lehrer" && chatBodies[0].image && chatBodies[0].image.type === "image/jpeg" && !chatBodies[0].image.data.startsWith("data:"), "/chat mit Bild (lehrer, base64 ohne Kopf) – nur entsperrt");
  ok((await page.inputValue("#dk-ocr-in")).startsWith("RECHNUNG Nr. 4711"), "Erkannter Text ohne Markdown-Zaun");
  await shot("dokumente-ocr-390-light.png");
  const ctBefore = (await A("dokumente")).find((d) => d.id === id1).ct;
  await page.click('[data-dk="ocrok"]');
  await page.waitForSelector(".dk-ocr");
  raw = await A("dokumente");
  ok(raw.find((d) => d.id === id1).ct !== ctBefore && !JSON.stringify(raw).includes("QX-998877"), "Erkannter Text verschlüsselt gespeichert");

  /* ---------- Großansicht ---------- */
  await page.click('[data-dk="view"]');
  await page.waitForSelector(`${sheet} .ak-photo-big img[src^='blob:']`);
  ok(true, "Großansicht des Fotos (Object-URL)");
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
  raw = await A("dokumente");
  const pdf = raw.find((d) => d.id !== id1 && d.id !== "old1");
  ok(pdf && pdf.folder === "eigen" && pdf.size === PDF.length && !JSON.stringify(pdf).includes("Auto"), "PDF gespeichert (eigener Ordner-Name verschlüsselt, Originalgröße)");
  ok(!(await page.$('[data-dk="ocr"]')), "Kein „Text erkennen“ bei PDFs");
  await page.evaluate(() => { window.__opened = []; const o = window.open; window.open = (u) => { window.__opened.push(String(u)); return { closed: false }; }; window.__restoreOpen = () => { window.open = o; }; });
  await page.click('[data-dk="view"]');
  await page.waitForFunction(() => window.__opened.length > 0, null, { timeout: 4000 }).catch(() => {});
  const opened = await page.evaluate(() => { window.__restoreOpen(); return window.__opened; });
  ok(opened.length === 1 && opened[0].startsWith("blob:"), "PDF öffnet als Blob-URL in neuem Tab");
  const pdfBytes = Buffer.from(await page.evaluate(async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); return btoa(String.fromCharCode(...b)); }, opened[0]), "base64");
  ok(pdfBytes.equals(PDF), "Entschlüsselte PDF-Bytes stimmen");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 4000 }).catch(() => null), page.click('[data-dk="share"]')]);
  ok(dl && dl.suggestedFilename() === "Rechnung-Handy.pdf", "Teilen/Speichern → Download mit Dateinamen");

  /* ---------- Liste: Ordner, Favoriten, Ablauf, Suche ---------- */
  await page.click('[data-dk="back"]');
  await page.waitForSelector(".dk .ak-list");
  ok((await page.$$(".dk .ak-card")).length === 3, "Drei Dokumente in der Liste");
  ok((await page.textContent(".dk .ak-card")).includes("Rechnung-Handy"), "Favorit steht oben");
  ok(await page.$('.dk-folders [data-folder="Auto"]'), "Eigener Ordner als Chip (entsperrt mit Namen)");
  await page.click('.dk-folders [data-folder="garantie"]');
  ok((await page.$$(".dk .ak-card")).length === 1, "Ordner-Filter");
  await page.click('.dk-folders [data-folder=""]');
  await page.click('[data-view="ablauf"]');
  ok((await page.$$(".dk .ak-card")).length === 2, "Ansicht „Läuft ab“");
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
  await page.waitForTimeout(300);
  ok((await page.textContent(".ak-det")).includes("Original im Ordner Küche") && !JSON.stringify(await A("dokumente")).includes("Original im Ordner"), "Bearbeiten speichert (verschlüsselt)");

  /* ---------- Baustellen-Projektseite (entsperrt) ---------- */
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#site-root .st-docs");
  ok((await page.textContent("#site-root .st-docs")).includes("Garantie Waschmaschine") && (await page.textContent("#site-root .st-docs")).includes("Mietvertrag Altbau"), "Projektseite zeigt verknüpfte Dokumente (entsperrt)");
  await page.click("#site-root .st-docs .ak-linked-h a");
  await page.waitForSelector(`${sheet} [data-exlink]`);
  ok((await page.evaluate(() => location.hash)) === "#alltag/dokumente", "„＋ Dokument“ öffnet Dokumente (Hash bereinigt)");
  await page.selectOption("#dk-ex", pdf.id);
  await page.click(`${sheet} [data-exlink]`);
  await page.waitForTimeout(300);
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#site-root .st-docs");
  await page.waitForFunction(() => document.querySelector("#site-root .st-docs").textContent.includes("Rechnung-Handy"));
  ok(true, "Vorhandenes Dokument verknüpft");

  /* ---------- Globale Suche (entsperrt) ---------- */
  await page.goto(BASE + "#alltag/dokumente");
  await page.waitForSelector(".dk .ak-list");
  await page.click("#btn-search");
  await page.fill("#srch-q", "QX-998877");
  await page.waitForSelector('.srch-group[data-group="dokumente"]');
  ok((await page.textContent('.srch-group[data-group="dokumente"]')).includes("Garantie Waschmaschine"), "Globale Suche findet das Dokument (auch über OCR-Text)");
  await page.click('.srch-group[data-group="dokumente"] [data-key], .srch-group[data-group="dokumente"] button, .srch-group[data-group="dokumente"] a');
  await page.waitForFunction((id) => location.hash === "#alltag/dokumente/" + id, id1);
  await page.waitForSelector("#dk-prev img[src^='blob:']");
  const prevSrc2 = await page.$eval("#dk-prev img", (i) => i.src);

  /* ---------- 🔒 Sperren: nichts Lesbares mehr ---------- */
  await page.click('[data-dk="lock"]');
  await page.waitForSelector(".dk .dk-lock");
  const vis = await page.textContent(".dk");
  ok(!/Garantie Waschmaschine|Mietvertrag|Rechnung-Handy|Küche|Auto/.test(vis), "Gesperrt: keine Titel/Tags/Ordner-Namen im Bildschirm");
  ok(vis.includes("3 Dokumente") && (await page.$('.dk-lfold [data-lfold="garantie"]')) && vis.includes("laufen bald ab"), "Gesperrt: Ordner + Anzahl + Ablauf-Abzeichen");
  ok(!(await page.$(".sheet")) && !(await page.$("#dk-prev")), "Gesperrt: Vorschau/Blätter geschlossen");
  const revoked = await page.evaluate(async (us) => { const r = []; for (const u of us) { try { await fetch(u); r.push(false); } catch { r.push(true); } } return r; }, [prevSrc, prevSrc2, opened[0]]);
  ok(revoked.every(Boolean), "Object-URLs beim Sperren widerrufen");
  await page.evaluate(() => localStorage.removeItem("sk-search-recent")); // eigene Suchbegriffe (Verlauf der Suche) – nicht Teil der Dokumente
  const dump = await storageDump();
  const leaks = leaksIn(dump, ["Garantie Waschmaschine", "Mietvertrag Altbau", "Rechnung-Handy", "QX-998877", "RECHNUNG Nr. 4711", "Original im Ordner Küche", "Kaution 3 Monatsmieten", "Wohnungsakte", OLD_MARK, OLD_PDF, PDF.subarray(0, 40), png().subarray(0, 40)]);
  ok(leaks.length === 0, "localStorage/IndexedDB/Cache: kein Titel, kein Text, keine Datei-Bytes (auch nicht base64)" + (leaks.length ? " → " + leaks.join(", ") : ""));
  await shot("dokumente-locked-390-light.png");

  /* ---------- Gesperrt: Benachrichtigung ohne Titel, keine Suche, Baustelle mit Hinweis ---------- */
  await page.goto(BASE + "#alltag/dokumente");
  await page.waitForSelector(".dk .dk-lock");
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.waitForTimeout(300);
  const nt = await page.textContent("#nt-body");
  ok(nt.includes("Ein Dokument läuft bald ab – entsperren zum Ansehen") && !nt.includes("Garantie Waschmaschine") && !nt.includes("Mietvertrag"), "Benachrichtigung „läuft ab“ ohne Titel");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click("#btn-search");
  await page.fill("#srch-q", "Garantie Waschmaschine");
  await page.waitForTimeout(600);
  ok(!(await page.$('.srch-group[data-group="dokumente"]')), "Globale Suche findet gesperrt nichts");
  await page.keyboard.press("Escape");
  await page.goto(BASE + "#orte/baustelle/p1");
  await page.waitForSelector("#site-root .st-docs .ak-linked-lock");
  ok(!(await page.textContent("#site-root .st-docs")).includes("Garantie"), "Baustelle: 🔒-Hinweis statt Titel");

  /* ---------- Entsperren in Dokumente (falsch, dann richtig) ---------- */
  await page.click("#site-root .ak-linked-lock a");
  await page.waitForSelector("#dk-pw");
  await page.fill("#dk-pw", "falsch-falsch-falsch");
  await page.click("[data-dk-unlock]");
  await page.waitForSelector(".dk-err:not([hidden])");
  ok((await page.textContent(".dk-err")).includes("Falsches Passwort"), "Falsches Passwort wird abgelehnt");
  await page.fill("#dk-pw", MASTER);
  await page.click("[data-dk-unlock]");
  await page.waitForSelector(".dk .ak-list");
  ok((await page.textContent(".dk .ak-list")).includes("Garantie Waschmaschine"), "Mit Tresor-Passwort entsperrt");

  /* ---------- Auto-Sperre ---------- */
  await page.evaluate(() => { window.__tresorTest.autoLockMs = 1200; });
  await page.click(`.dk .ak-card[data-id="${id1}"]`); // Aktivität → Timer neu
  await page.waitForSelector(".dk .dk-lock", { timeout: 6000 });
  ok((await page.textContent(".dk .dk-lock")).includes("Automatisch gesperrt"), "Auto-Sperre wie im Tresor");
  await page.evaluate(() => { delete window.__tresorTest.autoLockMs; });
  await page.fill("#dk-pw", MASTER);
  await page.click("[data-dk-unlock]");
  await page.waitForSelector(".dk .ak-det");
  ok(true, "Nach dem Entsperren wieder im Dokument (Route bleibt)");

  /* ---------- Löschen ---------- */
  const fileId1 = (await A("dokumente")).find((d) => d.id === id1).fileId;
  await page.click('[data-dk="del"]');
  await page.click('[data-dk="del"]');
  await page.waitForFunction(() => location.hash === "#alltag/dokumente");
  await page.waitForTimeout(300);
  ok((await A("dokumente")).length === 2, "Dokument gelöscht (zweimal tippen)");
  keys = await idbKeys();
  ok(!keys.some((k) => k.startsWith(fileId1)), "Verschlüsselte Datei-Stücke mit gelöscht");

  /* ---------- Desktop + dunkel ---------- */
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(BASE + "#alltag/dokumente");
    await page.waitForSelector(".dk .ak-list");
    await shot(`dokumente-list-${w}-${scheme}.png`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Liste ohne waagrechtes Scrollen (${w} ${scheme})`);
    await page.goto(BASE + "#alltag/dokumente/" + pdf.id);
    await page.waitForSelector(".dk .ak-det");
    await shot(`dokumente-detail-${w}-${scheme}.png`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await page.click('[data-dk="lock"]');
    await page.waitForSelector(".dk .dk-lock");
    await shot(`dokumente-locked-${w}-${scheme}.png`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Gesperrt ohne waagrechtes Scrollen (${w} ${scheme})`);
    await page.fill("#dk-pw", MASTER);
    await page.click("[data-dk-unlock]");
    await page.waitForSelector(".dk .ak-det");
  }

  ok(errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (errors.length ? ":\n" + errors.join("\n") : ""));
  await browser.close();
  console.log("\nAlle Dokumente-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
