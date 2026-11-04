// Playwright-Test für den Passwort-Tresor (Alltag › Passwort-Tresor), lokaler Modus.
//   cd <worktree> && python3 -m http.server 8849 &   then   node tests/vault-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Test-Haken window.__tresorTest (nur localhost): autoLockMs, hiddenMs, clipMs.
// Optional: JSQR=<pfad zu jsqr> prüft zusätzlich, dass der WLAN-QR-Code lesbar ist.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = "http://localhost:8849/";
const OUT = process.argv[2] || require("os").tmpdir();

const MASTER = "Kaktus Laterne Wolke 77";
const MASTER2 = "Brezel Gitarre Mond 2028!";
const SECRETS = {
  loginTitle: "Testbank Login",
  user: "max.tester@example.at",
  password: "Geheim-Testpasswort-4711!",
  pinTitle: "SIM A1 Testkarte",
  pin: "4321",
  puk: "87654321",
  ssid: "Zuhause-WLAN-XYZ",
  wifiPw: "WlanPasswort-Sehr-Geheim-99",
  noteTitle: "Geheime Notiz Omega",
  noteText: "Fahrradschloss Zahlencode 9182",
  cardTitle: "e-card Testperson",
  holder: "Maximilian Testperson",
  number: "9876 5432 1098",
};

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
  await ctx.addInitScript(() => { window.__tresorTest = { clipMs: 1500 }; });
  const page = await ctx.newPage();
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, full = true) => { await page.waitForTimeout(450); return page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const hook = (o) => page.evaluate((o) => Object.assign(window.__tresorTest, o), o);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const sheetClose = async () => { await page.click(".sheet .close"); await page.waitForTimeout(100); };
  const lsDump = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o) + JSON.stringify(sessionStorage); });

  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="tresor"]');
  ok((await page.textContent('.al-tile[data-id="tresor"]')).includes("Passwort-Tresor"), "Kachel „Passwort-Tresor“ auf der Alltag-Seite");
  await page.waitForTimeout(500);
  await shot("tresor-tiles-390.png");
  await page.click('.al-tile[data-id="tresor"]');
  await page.waitForSelector(".tr-setup");

  /* ---------- Einrichten ---------- */
  ok((await page.textContent(".tr-setup")).includes("Wenn du das Master-Passwort vergisst, sind alle Einträge verloren – niemand kann sie wiederherstellen. Schreib es auf Papier und bewahr es sicher auf."), "Warnhinweis beim Einrichten");
  await page.fill("#tr-new", "kurz");
  await page.click("[data-tr=create]");
  ok((await page.textContent(".tr-setup .tr-err")).includes("Mindestens 10 Zeichen"), "zu kurzes Master-Passwort abgelehnt");
  await page.fill("#tr-new", "passwort1234");
  await page.fill("#tr-new2", "passwort1234");
  await page.click("[data-tr=create]");
  ok((await page.textContent(".tr-setup .tr-err")).includes("Zu leicht"), "leicht zu erratendes Master-Passwort abgelehnt");
  ok(await page.getAttribute("#tr-new-m", "data-score") === "0", "Stärke-Anzeige: sehr schwach");
  await page.fill("#tr-new", MASTER);
  await page.fill("#tr-new2", MASTER + "x");
  await page.click("[data-tr=create]");
  ok((await page.textContent(".tr-setup .tr-err")).includes("stimmen nicht"), "Bestätigung muss übereinstimmen");
  await page.fill("#tr-new2", MASTER);
  await page.click("[data-tr=create]");
  ok((await page.textContent(".tr-setup .tr-err")).includes("notiert"), "Papier-Häkchen verlangt");
  ok(Number(await page.getAttribute("#tr-new-m", "data-score")) >= 3, "Stärke-Anzeige: stark");
  await shot("tresor-setup-390-light.png");
  await page.check("#tr-paper");
  await page.click("[data-tr=create]");
  await page.waitForSelector(".tr-empty", { timeout: 10000 });
  ok(true, "Tresor angelegt, leere Liste");
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-vault_meta"))[0]);
  ok(meta.v === 1 && meta.kdf === "PBKDF2-SHA256" && meta.iter === 600000 && meta.salt && meta.wrappedKey && meta.wrapIv && meta.verifier, "Meta-Dokument im richtigen Format (600.000 Runden)");

  /* ---------- Einträge anlegen ---------- */
  async function add(type, fill) {
    await page.click("[data-tr=new]");
    await page.waitForSelector(".tr-form");
    await page.click(`.tr-types [data-type="${type}"]`);
    await fill();
    await page.click(".sheet [data-save]");
    await page.waitForSelector(".tr-form", { state: "detached" });
  }
  await add("login", async () => {
    await page.fill("#tf-title", SECRETS.loginTitle);
    await page.fill("#tf-user", SECRETS.user);
    await page.fill("#tf-password", SECRETS.password);
    await page.fill("#tf-url", "testbank.example");
    await page.fill("#tf-cat", "Bank & Geld");
    await page.check("#tf-fav");
  });
  await add("pin", async () => {
    await page.fill("#tf-title", SECRETS.pinTitle);
    await page.fill("#tf-pin", SECRETS.pin);
    await page.fill("#tf-puk", SECRETS.puk);
    await page.fill("#tf-cat", "Handy");
  });
  await add("wifi", async () => {
    await page.fill("#tf-ssid", SECRETS.ssid);
    ok(await page.inputValue("#tf-title") === SECRETS.ssid, "WLAN-Titel übernimmt SSID");
    await page.fill("#tf-password", SECRETS.wifiPw);
    await page.selectOption("#tf-enc", "WPA");
    await page.fill("#tf-cat", "Zuhause");
  });
  await add("note", async () => {
    await page.fill("#tf-title", SECRETS.noteTitle);
    await page.fill("#tf-note", SECRETS.noteText);
  });
  await add("card", async () => {
    ok((await page.textContent(".tr-form")).includes("Keine vollständigen Kartennummern/CVV speichern empfohlen"), "Hinweis bei Karte/Ausweis");
    await page.fill("#tf-title", SECRETS.cardTitle);
    await page.fill("#tf-holder", SECRETS.holder);
    await page.fill("#tf-number", SECRETS.number);
  });
  await add("login", async () => { await page.fill("#tf-title", "Forum Alt"); await page.fill("#tf-password", "123456"); });
  await add("login", async () => { await page.fill("#tf-title", "Forum Neu"); await page.fill("#tf-password", "123456"); });
  await page.waitForTimeout(200);
  const titles = await page.$$eval(".tr-item-t b", (els) => els.map((e) => e.textContent.trim()));
  ok(titles.length === 7, "7 Einträge in der Liste: " + titles.join(" | "));
  ok(titles[0] === SECRETS.loginTitle, "Favorit steht oben");
  const kpis = await page.$$eval(".tr-kpi b", (els) => els.map((e) => e.textContent));
  ok(kpis[0] === "2" && kpis[1] === "2", "Sicherheits-Check: 2 schwach, 2 mehrfach");
  ok((await page.$$(".tr-flag")).length === 4, "Warn-Markierungen in der Liste");

  /* ---------- Kein Klartext gespeichert ---------- */
  const dump = await lsDump();
  ok(dump.includes("sk-a-vault_items") && dump.includes("sk-a-vault_meta"), "Tresor-Sammlungen in localStorage");
  const leaks = [...Object.values(SECRETS), MASTER, "Forum Alt", "Bank & Geld", "Handy", "testbank"].filter((v) => dump.includes(v) || dump.includes(JSON.stringify(v).slice(1, -1)));
  ok(leaks.length === 0, "localStorage/sessionStorage enthalten keinen Klartext (Titel, Passwörter, Notiz, SSID …)" + (leaks.length ? ": " + leaks : ""));
  const items = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-vault_items")));
  ok(items.every((r) => Object.keys(r).sort().join() === "created,ct,id,iv,updated"), "Einträge nur {id, iv, ct, created, updated}");

  /* ---------- Suche, Filter ---------- */
  await page.fill("#tr-q", "omega");
  await page.waitForTimeout(100);
  ok((await page.$$(".tr-item")).length === 1, "Suche „omega“ findet die Notiz");
  await page.fill("#tr-q", SECRETS.password);
  await page.waitForTimeout(100);
  ok((await page.$$(".tr-item")).length === 0, "Suche durchsucht keine Passwörter");
  await page.fill("#tr-q", "");
  await page.click('.tr-chips [data-f="t:wifi"]');
  ok((await page.$$(".tr-item")).length === 1, "Filter WLAN");
  await page.click('.tr-chips [data-f="all"]');
  await page.click('.tr-kpi[data-f="weak"]');
  ok((await page.$$(".tr-item")).length === 2, "Filter „schwach“ aus dem Sicherheits-Check");
  await page.click('.tr-chips [data-f="all"]');
  await shot("tresor-list-390-light.png");

  /* ---------- Ansehen, Auge, Kopieren ---------- */
  await page.click(`.tr-item-main:has-text("${SECRETS.loginTitle}")`);
  await page.waitForSelector(".tr-fields");
  ok(!(await page.textContent(".sheet")).includes(SECRETS.password), "Passwort zuerst verborgen");
  await page.click('.sheet [data-reveal="password"]');
  ok((await page.textContent('.tr-secret[data-k="password"]')) === SECRETS.password, "Auge zeigt Passwort");
  await shot("tresor-detail-390-light.png", false);
  await page.click('.sheet [data-reveal="password"]');
  ok(!(await page.textContent(".sheet")).includes(SECRETS.password), "Auge verbirgt Passwort wieder");
  await page.click('.sheet [data-copy="password"]');
  await page.waitForTimeout(150);
  ok(await clipboard() === SECRETS.password, "Passwort in die Zwischenablage kopiert");
  await page.waitForTimeout(1800);
  ok(await clipboard() === "", "Zwischenablage nach Ablauf geleert");
  await page.click('.sheet [data-copy="user"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => navigator.clipboard.writeText("etwas anderes"));
  await page.waitForTimeout(1800);
  ok(await clipboard() === "etwas anderes", "Fremder Inhalt in der Zwischenablage bleibt erhalten");
  await sheetClose();
  await page.click(`.tr-quick[aria-label^="PIN von"]`);
  await page.waitForTimeout(150);
  ok(await clipboard() === SECRETS.pin, "Schnell-Kopieren aus der Liste (PIN)");

  /* ---------- WLAN-QR ---------- */
  await page.click(`.tr-item-main:has-text("${SECRETS.ssid}")`);
  await page.click(".sheet [data-qr]");
  await page.waitForSelector(".tr-qr svg");
  const svg = await page.innerHTML(".tr-qr");
  ok(/<path d="M/.test(svg), "WLAN-QR-Code wird gezeichnet");
  if (process.env.JSQR) {
    const jsQR = require(process.env.JSQR);
    const vb = +svg.match(/viewBox="0 0 (\d+)/)[1];
    const sc = 6, n = vb * sc;
    const px = new Uint8ClampedArray(n * n * 4).fill(255);
    for (const m of svg.match(/d="([^"]+)"/)[1].matchAll(/M(\d+) (\d+)/g)) {
      const x = +m[1], y = +m[2];
      for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = ((y * sc + dy) * n + x * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
    }
    const r = jsQR(px, n, n);
    ok(r && r.data === `WIFI:T:WPA;S:${SECRETS.ssid};P:${SECRETS.wifiPw};;`, "QR-Code lesbar (jsQR): " + (r && r.data));
  }
  await shot("tresor-wifi-qr-390-light.png", false);
  await sheetClose();

  /* ---------- Generator ---------- */
  await page.click(".tr-side [data-tr=generator]");
  await page.waitForSelector("#tr-gen-pw");
  await page.fill("#tr-gen-range", "32");
  await page.dispatchEvent("#tr-gen-range", "input");
  let gen = await page.textContent("#tr-gen-pw");
  ok(gen.length === 32 && /[A-Z]/.test(gen) && /[a-z]/.test(gen) && /\d/.test(gen), "Generator: 32 Zeichen, gemischt");
  await page.check('[data-o="pronounceable"]');
  gen = await page.textContent("#tr-gen-pw");
  ok(gen.length === 32 && /^[a-zA-Z]{3}/.test(gen), "Generator: aussprechbar → " + gen);
  await page.uncheck('[data-o="pronounceable"]');
  await page.uncheck('[data-o="symbols"]');
  gen = await page.textContent("#tr-gen-pw");
  ok(/^[A-Za-z0-9]{32}$/.test(gen), "Generator: ohne Sonderzeichen");
  await page.click("[data-gcopy]");
  await page.waitForTimeout(100);
  ok(await clipboard() === gen, "Generator: Kopieren");
  await shot("tresor-generator-390-light.png", false);
  await sheetClose();
  // Übernehmen im Formular
  await page.click('.tr-item-main:has-text("Forum Neu")');
  await page.click(".sheet [data-edit]");
  await page.waitForSelector("#tf-password");
  await page.click('[data-gen="tf-password"]');
  await page.waitForSelector("[data-use]");
  const g2 = await page.textContent("#tr-gen-pw");
  await page.click("[data-use]");
  ok(await page.inputValue("#tf-password") === g2, "Generator: „Übernehmen“ setzt das Passwort im Formular");
  await page.click(".sheet [data-save]");
  await page.waitForSelector(".tr-form", { state: "detached" });
  await page.waitForTimeout(150);
  ok((await page.$$eval(".tr-kpi b", (els) => els.map((e) => e.textContent))).join() === "1,0", "Sicherheits-Check aktualisiert (1 schwach, 0 mehrfach)");

  /* ---------- Sperren / Entsperren / falsches Passwort ---------- */
  await page.click("[data-tr=lock]");
  await page.waitForSelector(".tr-lock");
  ok((await page.textContent(".tr-lock h3")) === "Tresor gesperrt", "Sperr-Karte „Tresor gesperrt“");
  const html = await page.content();
  ok(![SECRETS.loginTitle, SECRETS.password, SECRETS.ssid, SECRETS.noteText].some((v) => html.includes(v)), "Nach dem Sperren kein Klartext mehr im DOM");
  await shot("tresor-locked-390-light.png");
  await page.fill("#tr-master", "falsches Passwort 123");
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-lock .tr-err:not([hidden])");
  ok((await page.textContent(".tr-lock .tr-err")).includes("Falsches Passwort"), "Falsches Passwort wird abgelehnt");
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  ok((await page.$$(".tr-item")).length === 7, "Entsperrt – alle Einträge wieder da");

  /* ---------- Auto-Sperre (Inaktivität) ---------- */
  await hook({ autoLockMs: 1200 });
  await page.waitForSelector(".tr-lock", { timeout: 4000 });
  ok((await page.textContent(".tr-reason")).includes("Automatisch gesperrt"), "Auto-Sperre nach Inaktivität");
  await hook({ autoLockMs: 0 });

  // Bremse nach 5 Fehlversuchen
  for (let i = 0; i < 5; i++) {
    await page.fill("#tr-master", "falsch-" + i + "-passwort");
    await page.click("[data-tr=unlock]");
    await page.waitForFunction((n) => document.querySelector(".tr-err") && document.querySelector(".tr-err").textContent && !document.querySelector("[data-tr=unlock]").hasAttribute("aria-busy"), i);
  }
  await page.waitForTimeout(100);
  ok(await page.isDisabled("[data-tr=unlock]") && /warten/.test(await page.textContent("[data-tr=unlock]")), "Nach 5 Fehlversuchen: Wartezeit");
  ok((await page.textContent(".tr-err")).includes("5 Fehlversuche"), "Fehlversuche werden gezählt");
  ok(await page.evaluate(() => JSON.parse(sessionStorage.getItem("sk-tresor-fails")).n) === 5, "Fehlversuche in sessionStorage");
  await page.waitForFunction(() => !document.querySelector("[data-tr=unlock]").disabled, null, { timeout: 8000 });
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  ok(await page.evaluate(() => sessionStorage.getItem("sk-tresor-fails")) === null, "Nach Erfolg: Zähler zurückgesetzt");

  // Hintergrund (visibilitychange) → Sperre
  await hook({ hiddenMs: 500 });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForSelector(".tr-lock", { timeout: 2000 });
  ok((await page.textContent(".tr-reason")).includes("Hintergrund"), "Sperre, wenn die App im Hintergrund war");
  await hook({ hiddenMs: 0 });

  // Verlassen des Moduls → Sperre
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  await page.click(`.tr-item-main:has-text("${SECRETS.loginTitle}")`);
  await page.waitForSelector(".tr-fields");
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector(".al-grid");
  ok(!(await page.$(".sheet")), "Offene Blätter beim Verlassen geschlossen");
  await page.evaluate(() => { location.hash = "#alltag/tresor"; });
  await page.waitForSelector(".tr-lock");
  ok(true, "Nach Verlassen und Zurückkommen gesperrt");

  /* ---------- Master-Passwort ändern ---------- */
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  const ctBefore = await page.evaluate(() => localStorage.getItem("sk-a-vault_items"));
  await page.click("[data-tr=settings]");
  await page.click('.sheet [data-a="pw"]');
  await page.fill("#tc-old", "nicht das richtige");
  await page.fill("#tc-new", MASTER2);
  await page.fill("#tc-new2", MASTER2);
  await page.click(".sheet [data-go]");
  await page.waitForSelector(".sheet .tr-err:not([hidden])");
  ok((await page.textContent(".sheet .tr-err")).includes("falsch"), "Passwort ändern: falsches aktuelles Passwort abgelehnt");
  await page.waitForFunction(() => !document.querySelector(".sheet [data-go]").disabled);
  await page.fill("#tc-old", MASTER);
  await page.click(".sheet [data-go]");
  await page.waitForSelector("#tc-old", { state: "detached", timeout: 10000 });
  ok(await page.evaluate(() => localStorage.getItem("sk-a-vault_items")) === ctBefore, "Passwort ändern: Einträge unverändert (nur Schlüssel neu eingepackt)");
  await page.click("[data-tr=lock]");
  await page.fill("#tr-master", MASTER);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-lock .tr-err:not([hidden])");
  ok(true, "Altes Master-Passwort gilt nicht mehr");
  await page.fill("#tr-master", MASTER2);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  ok((await page.$$(".tr-item")).length === 7, "Neues Master-Passwort entsperrt alle Einträge");

  /* ---------- Sicherung exportieren ---------- */
  await page.click("[data-tr=settings]");
  await shot("tresor-settings-390-light.png", false);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('.sheet [data-a="export"]')]);
  const backupPath = path.join(OUT, "tresor-backup-test.json");
  await dl.saveAs(backupPath);
  const backupText = fs.readFileSync(backupPath, "utf8");
  const backup = JSON.parse(backupText);
  ok(backup.format === "stempelkarte-tresor" && backup.items.length === 7 && /^tresor-sicherung-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), "Verschlüsselte Sicherung heruntergeladen (" + dl.suggestedFilename() + ")");
  ok(!Object.values(SECRETS).some((v) => backupText.includes(v)), "Sicherung enthält keinen Klartext");
  await sheetClose();

  /* ---------- Klartext-CSV (nur mit Master-Passwort) ---------- */
  await page.click("[data-tr=settings]");
  await page.click('.sheet [data-a="csv"]');
  ok((await page.textContent(".sheet")).includes("unverschlüsselt"), "CSV: deutliche Warnung");
  await page.fill("#tx-pw", MASTER2);
  await page.click(".sheet [data-go]");
  ok((await page.textContent(".sheet .tr-err")).includes("bestätige"), "CSV: Häkchen verlangt");
  await page.check("#tx-ok");
  await page.fill("#tx-pw", "falsch-falsch");
  await page.click(".sheet [data-go]");
  await page.waitForFunction(() => /Falsches/.test(document.querySelector(".sheet .tr-err").textContent));
  ok(true, "CSV: falsches Master-Passwort abgelehnt");
  await page.fill("#tx-pw", MASTER2);
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click(".sheet [data-go]")]);
  const csvPath = path.join(OUT, "tresor-test.csv");
  await dl2.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, "utf8");
  ok(csv.startsWith("folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp") && csv.includes(SECRETS.password) && csv.includes("PIN: " + SECRETS.pin), "CSV im Bitwarden-Format");
  fs.unlinkSync(csvPath);

  /* ---------- Tresor löschen + Sicherung wiederherstellen ---------- */
  await page.click("[data-tr=lock]");
  await page.click("[data-tr=forgot]");
  await page.click(".sheet [data-del]");
  await page.click(".sheet [data-del]");
  await page.waitForSelector(".tr-setup");
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-vault_items") || "[]").length) === 0, "Tresor gelöscht");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-tr=import]")]);
  await chooser.setFiles(backupPath);
  await page.waitForSelector("#ti-pw");
  await page.fill("#ti-pw", MASTER);
  await page.click(".sheet [data-go]");
  await page.waitForSelector(".sheet .tr-err:not([hidden])");
  ok((await page.textContent(".sheet .tr-err")).includes("Falsches Passwort"), "Import: falsches Passwort der Sicherung abgelehnt");
  await page.fill("#ti-pw", MASTER2);
  await page.click(".sheet [data-go]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  ok((await page.$$(".tr-item")).length === 7, "Sicherung wiederhergestellt – 7 Einträge");
  // Import in bestehenden Tresor: nichts doppelt
  await page.click("[data-tr=settings]");
  const [ch2] = await Promise.all([page.waitForEvent("filechooser"), page.click('.sheet [data-a="import"]')]);
  await ch2.setFiles(backupPath);
  await page.fill("#ti-pw", MASTER2);
  await page.click(".sheet [data-go]");
  await page.waitForSelector("#ti-pw", { state: "detached" });
  ok((await page.$$(".tr-item")).length === 7, "Import in bestehenden Tresor: keine Doppelten");
  fs.unlinkSync(backupPath);
  const dump2 = await lsDump();
  ok(![...Object.values(SECRETS), MASTER, MASTER2].some((v) => dump2.includes(v)), "Am Ende: localStorage weiterhin ohne Klartext");

  /* ---------- Screenshots ---------- */
  await shot("tresor-list-390-light.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await shot("tresor-list-390-dark.png");
  await page.click(`.tr-item-main:has-text("${SECRETS.ssid}")`);
  await page.click(".sheet [data-qr]");
  await shot("tresor-wifi-390-dark.png", false);
  await sheetClose();
  await page.click("[data-tr=lock]");
  await shot("tresor-locked-390-dark.png");
  await page.fill("#tr-master", MASTER2);
  await page.click("[data-tr=unlock]");
  await page.waitForSelector(".tr-item", { timeout: 10000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  await shot("tresor-list-1440.png", false);
  await page.click(`.tr-item-main:has-text("${SECRETS.loginTitle}")`);
  await shot("tresor-detail-1440.png", false);
  await sheetClose();
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("tresor-list-1440-dark.png", false);

  const real = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  console.log("Konsolenfehler:", real.length ? real : "keine");
  await browser.close();
  if (real.length) process.exit(1);
  console.log("ALLE TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
