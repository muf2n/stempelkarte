// Playwright-Test für die Geld-Sperre (Alltag › Geld), lokaler Modus, mit virtuellem Authentifikator (CDP WebAuthn).
//   cd <worktree> && python3 -m http.server 8868 &   then   node tests/money-lock-e2e.cjs [screenshot-dir]
// Test-Haken window.__moneyLockTest (nur localhost): autoLockMs, hiddenMs, reauth.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8868/";
const OUT = process.argv[2] || require("os").tmpdir();
const PIN = "2580", PIN2 = "135790";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await ctx.addInitScript(() => { window.__moneyLockTest = window.__moneyLockTest || {}; });
  const watch = (p) => {
    p.on("console", (msg) => { if (msg.type() === "error" && !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
    p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  };
  const page = await ctx.newPage();
  watch(page);
  // virtueller Fingerabdruck-Sensor
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const shot = async (name, p = page) => { await p.waitForTimeout(400); return p.screenshot({ path: path.join(OUT, name), fullPage: false }); };
  const hook = (o) => page.evaluate((o) => Object.assign(window.__moneyLockTest, o), o);
  const typePin = async (pin, root = "") => { for (const d of pin) await page.click(`${root} .ml-keys [data-k="${d}"]`); };
  const cfg = () => page.evaluate(() => JSON.parse(localStorage.getItem("sk-money-lock") || "null"));
  const locked = () => page.evaluate(() => !!document.querySelector(".ml-lock") && !document.querySelector(".mn"));
  const unlockedGeld = async () => { await page.waitForSelector(".mn .mn-tabs", { timeout: 5000 }); return !document.querySelector; };

  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()), "virtueller Plattform-Authentifikator verfügbar");

  /* ---------- Standard: aus, Banner ---------- */
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector(".mn .mn-tabs");
  ok(await page.isVisible(".ml-banner"), "Standard aus: Geld offen, Banner „Geld mit Fingerabdruck/PIN schützen“");
  ok((await page.textContent(".ml-banner")).includes("Geld mit Fingerabdruck/PIN schützen"), "Banner-Text");
  ok(await page.isVisible('.ml-tools [data-ml-t="settings"]'), "Zahnrad in der Geld-Kopfzeile");
  await shot("ml-banner-390-light.png");

  /* ---------- PIN einrichten ---------- */
  await page.click('.ml-banner [data-ml-t="setup"]');
  await page.waitForSelector(".sheet .ml-pad");
  await typePin("12", ".sheet");
  ok(await page.isDisabled(".sheet .ml-ok"), "Weiter erst ab 4 Ziffern");
  await page.click('.sheet [data-k="del"]'); await page.click('.sheet [data-k="del"]');
  await typePin(PIN, ".sheet");
  await shot("ml-setup-390-light.png");
  await page.click(".sheet .ml-ok");
  await page.waitForSelector('.sheet .ml-h:text("PIN wiederholen")');
  await typePin("2581", ".sheet");
  await page.waitForSelector('.sheet .ml-err:text("stimmen nicht")');
  ok(true, "falsche Wiederholung abgelehnt");
  await typePin(PIN, ".sheet"); await page.click(".sheet .ml-ok");
  await page.waitForSelector('.sheet .ml-h:text("PIN wiederholen")');
  await typePin(PIN, ".sheet");
  await page.waitForSelector(".sheet .ml-bioask");
  ok(true, "nach der PIN wird Fingerabdruck angeboten");
  await shot("ml-bioask-390-light.png");
  await page.click('.sheet [data-b="skip"]');
  await page.waitForTimeout(200);
  let c = await cfg();
  ok(c && c.enabled === true && c.pin && c.pin.salt && c.pin.hash && c.pin.iter === 200000, "gespeichert: enabled + {salt, hash}, 200.000 Runden");
  ok(!JSON.stringify(c).includes(PIN), "PIN selbst nirgends gespeichert");
  ok(await page.isVisible(".mn .mn-tabs") && !(await page.isVisible(".ml-banner")), "nach Einrichten offen, Banner weg");

  /* ---------- Sperren + Entsperren ---------- */
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock");
  ok(await locked(), "Sperren-Knopf → Sperrbildschirm, Geld-Inhalt entfernt");
  ok(!(await page.evaluate(() => document.body.innerText.includes("Einnahmen"))), "keine Geld-Beträge/Inhalte sichtbar");
  ok(!(await page.isVisible(".ml-lock .ml-key-bio")), "ohne Fingerabdruck kein Fingerabdruck-Knopf");
  await shot("ml-lock-390-light.png");
  await typePin("1111");
  await page.waitForSelector('.ml-lock .ml-err:text("Falsche PIN")');
  ok(true, "falsche PIN abgelehnt");
  await typePin(PIN);
  await page.waitForSelector(".mn .mn-tabs");
  ok(true, "richtige PIN entsperrt");

  /* ---------- Tab-Wechsel innerhalb der Zeit → kein neues Fragen ---------- */
  await page.evaluate(() => { location.hash = "#alltag/schule"; });
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector(".mn .mn-tabs");
  ok(!(await page.isVisible(".ml-lock")), "Bereichswechsel innerhalb der Zeit: bleibt entsperrt");
  const sess = await page.evaluate(() => JSON.parse(sessionStorage.getItem("sk-money-lock-sess")));
  ok(sess && sess.ident === "local" && sess.until > Date.now(), "Entsperrung in sessionStorage mit Ablaufzeit");

  /* ---------- Wartezeit nach 5 Fehlversuchen ---------- */
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock");
  for (let i = 0; i < 5; i++) { await typePin("0000"); await page.waitForTimeout(450); }
  await page.waitForSelector('.ml-lock .ml-err:text("warten")');
  ok(await page.isDisabled('.ml-lock [data-k="5"]'), "nach 5 falschen PINs: Ziffern gesperrt + Wartezeit");
  await shot("ml-wait-390-light.png");
  const f = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-money-lock-fails")));
  ok(f.n === 5 && f.until - Date.now() > 2000, "Wartezeit 5 s gespeichert (überlebt Neuladen)");
  await page.reload();
  await page.waitForSelector(".ml-lock");
  ok(await page.isDisabled('.ml-lock [data-k="5"]'), "nach Neuladen weiterhin Wartezeit");
  await page.waitForFunction(() => !document.querySelector('.ml-lock [data-k="5"]').disabled, null, { timeout: 8000 });
  await typePin("0000");
  await page.waitForSelector('.ml-lock .ml-err:text("10 s warten")');
  ok(true, "6. Fehlversuch → längere Wartezeit (10 s)");
  await page.evaluate(() => localStorage.setItem("sk-money-lock-fails", JSON.stringify({ n: 6, until: Date.now() })));
  await page.waitForFunction(() => !document.querySelector('.ml-lock [data-k="5"]').disabled, null, { timeout: 3000 });
  await typePin(PIN);
  await page.waitForSelector(".mn .mn-tabs");
  ok(!(await page.evaluate(() => localStorage.getItem("sk-money-lock-fails"))), "Erfolg setzt Fehlversuche zurück");

  /* ---------- Deep-Link #alltag/geld (neuer Tab = neue Sitzung) ---------- */
  const p2 = await ctx.newPage();
  watch(p2);
  await p2.goto(BASE + "#alltag/geld");
  await p2.waitForSelector(".ml-lock", { timeout: 8000 });
  ok(!(await p2.$(".mn")), "Deep-Link #alltag/geld zeigt die Sperre");
  await p2.goto(BASE + "#alltag/geld?tab=abos");
  await p2.waitForSelector(".ml-lock", { timeout: 8000 });
  ok(true, "Deep-Link #alltag/geld?… ebenfalls gesperrt");
  // andere Bereiche + Assistent unberührt
  await p2.evaluate(() => { location.hash = "#alltag/schule"; });
  await p2.waitForSelector(".al-body > :not(.al-loading)", { timeout: 8000 });
  ok(!(await p2.$(".ml-lock")) && !(await p2.$(".ml-tools button")), "Schule: keine Sperre");
  await p2.evaluate(() => { location.hash = "#alltag/claude"; });
  await p2.waitForSelector(".ai .ai-log", { state: "attached", timeout: 8000 });
  await p2.waitForTimeout(500);
  ok(!(await p2.$(".ml-lock")), "Claude-Assistent öffnet trotz gesperrtem Geld");
  await shot("ml-assistant-while-locked-390.png", p2);
  for (const id of ["unterwegs", "material", "tresor"]) {
    await p2.evaluate((id) => { location.hash = "#alltag/" + id; }, id);
    await p2.waitForTimeout(700);
    ok(!(await p2.$(".ml-lock")) && !!(await p2.$(".al-body > :not(.al-loading)")), `Bereich „${id}“ unberührt`);
  }
  await p2.close();

  /* ---------- Fingerabdruck einrichten + entsperren ---------- */
  await page.click('.ml-tools [data-ml-t="settings"]');
  await page.waitForSelector(".sheet .ml-set");
  ok((await page.textContent(".sheet .ml-set")).includes("Der Claude-Assistent kann weiterhin deine Geld-Daten lesen."), "Hinweis zum Claude-Assistenten in den Einstellungen");
  await page.click('.sheet [data-ml="bio-add"]');
  await page.waitForSelector('.sheet [data-ml="bio-del"]', { timeout: 8000 });
  c = await cfg();
  ok(c.creds.length === 1 && c.creds[0].publicKey && c.creds[0].alg === -7 && c.creds[0].id, "Fingerabdruck registriert: credentialId, SPKI, alg ES256, Zähler gespeichert");
  await shot("ml-settings-390-light.png");
  await page.click(".sheet .close");
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock .ml-key-bio");
  ok(true, "Sperrbildschirm zeigt Fingerabdruck");
  await shot("ml-lock-bio-390-light.png");
  const before = (await cfg()).creds[0].counter;
  await page.click(".ml-lock .ml-biobtn");
  await page.waitForSelector(".mn .mn-tabs", { timeout: 8000 });
  await page.waitForTimeout(300);
  const after = (await cfg()).creds[0].counter;
  ok(after > before, `mit virtuellem Fingerabdruck entsperrt, Zähler ${before} → ${after}`);
  // Nutzer bricht ab / Gerät lehnt ab → PIN bleibt
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock .ml-key-bio");
  await page.click(".ml-lock .ml-biobtn");
  await page.waitForTimeout(1200);
  ok(await locked(), "Fingerabdruck nicht bestätigt (UV fehlt) → bleibt gesperrt");
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
  await typePin(PIN);
  await page.waitForSelector(".mn .mn-tabs");
  ok(true, "PIN als Ersatz funktioniert");

  /* ---------- Auto-Sperre ---------- */
  await hook({ autoLockMs: 1500 });
  await page.mouse.click(5, 300);
  await page.waitForTimeout(400);
  ok(!(await locked()), "noch offen kurz nach Aktivität");
  await page.waitForSelector(".ml-lock", { timeout: 4000 });
  ok((await page.textContent(".ml-lock")).includes("Automatisch gesperrt"), "Auto-Sperre nach Inaktivität (Test-Zeit)");
  await hook({ autoLockMs: 0 });
  await typePin(PIN);
  await page.waitForSelector(".mn .mn-tabs");
  // offenes Blatt wird beim Sperren geschlossen
  await hook({ autoLockMs: 1200 });
  await page.click(".mn-fab");
  await page.waitForSelector(".sheet");
  await page.waitForSelector(".ml-lock", { timeout: 4000 });
  ok(!(await page.$(".sheet")), "Auto-Sperre schließt offene Geld-Blätter");
  await hook({ autoLockMs: 0, hiddenMs: 800 });
  await typePin(PIN);
  await page.waitForSelector(".mn .mn-tabs");
  // App im Hintergrund > hiddenMs
  const setVis = (v) => page.evaluate((v) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v }); document.dispatchEvent(new Event("visibilitychange")); }, v);
  await setVis("hidden"); await page.waitForTimeout(300); await setVis("visible");
  await page.waitForTimeout(300);
  ok(!(await locked()), "kurz im Hintergrund → bleibt offen");
  await setVis("hidden"); await page.waitForTimeout(1300); await setVis("visible");
  await page.waitForSelector(".ml-lock", { timeout: 3000 });
  ok((await page.textContent(".ml-lock")).includes("Hintergrund"), "länger im Hintergrund → gesperrt");
  await page.evaluate(() => { delete document.visibilityState; });
  await hook({ hiddenMs: 0 });

  /* ---------- PIN vergessen (Google neu anmelden – Test-Haken) ---------- */
  await hook({ reauth: undefined });
  await page.evaluate(() => { window.__moneyLockTest.reauth = async () => { window.__reauthCalled = true; return true; }; });
  await page.click('.ml-lock [data-ml-foot="forgot"]');
  await page.click('.sheet [data-b="google"]');
  await page.waitForSelector('.sheet .ml-h:text("PIN festlegen")');
  ok(await page.evaluate(() => window.__reauthCalled === true), "PIN vergessen → Google-Bestätigung verlangt");
  await typePin(PIN2, ".sheet"); await page.click(".sheet .ml-ok");
  await page.waitForSelector('.sheet .ml-h:text("PIN wiederholen")');
  await typePin(PIN2, ".sheet");
  await page.waitForSelector(".mn .mn-tabs");
  await page.waitForTimeout(300);
  ok(!(await page.$(".sheet")) && (await cfg()).pin.len === 6, "neue 6-stellige PIN gesetzt, Geld offen");
  await page.evaluate(() => { window.__moneyLockTest.reauth = async () => false; });
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock");
  await typePin(PIN);
  await page.waitForSelector('.ml-lock .ml-err:text("Falsche PIN")');
  ok(true, "alte PIN gilt nicht mehr");
  await typePin(PIN2);
  await page.waitForSelector(".mn .mn-tabs");
  ok(true, "neue PIN entsperrt");

  /* ---------- Beträge in anderen Bereichen ausblenden ---------- */
  await page.click('.ml-tools [data-ml-t="settings"]');
  await page.waitForSelector(".sheet #ml-mask");
  await page.check(".sheet #ml-mask");
  await page.waitForTimeout(200);
  ok((await cfg()).maskElsewhere === true, "„Beträge ausblenden“ gespeichert");
  await page.click(".sheet .close");
  ok(!(await page.evaluate(() => document.documentElement.classList.contains("mm-mask"))), "entsperrt: nichts ausgeblendet");
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock");
  ok(await page.evaluate(() => document.documentElement.classList.contains("mm-mask")), "gesperrt: html.mm-mask aktiv");
  await page.evaluate(() => { location.hash = "#uebersicht"; });
  await page.waitForTimeout(600);
  const masked = await page.evaluate(() => { const e = document.querySelector('[data-tg="tg"]'); return e ? getComputedStyle(e, "::after").content + "|" + getComputedStyle(e).visibility : "none"; });
  ok(masked === "none" || masked.startsWith('"•••"|hidden'), "Taggeld in der Übersicht als „•••“ (" + masked + ")");
  await shot("ml-overview-masked-390-light.png");

  /* ---------- dunkel ---------- */
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => { location.hash = "#alltag/geld"; });
  await page.waitForSelector(".ml-lock");
  await shot("ml-lock-bio-390-dark.png");
  await typePin("1"); await page.waitForTimeout(100);
  await shot("ml-lock-typing-390-dark.png");
  await page.click('.ml-lock [data-k="del"]');
  await typePin(PIN2);
  await page.waitForSelector(".mn .mn-tabs");
  await page.click('.ml-tools [data-ml-t="settings"]');
  await page.waitForSelector(".sheet .ml-set");
  await shot("ml-settings-390-dark.png");

  /* ---------- Ausschalten nur mit Bestätigung ---------- */
  await page.click(".sheet #ml-on");
  await page.waitForSelector('.sheet .ml-h:text("Zur Bestätigung")');
  await shot("ml-verify-390-dark.png");
  await page.click(".sheet:last-child .close");
  await page.waitForTimeout(200);
  ok((await cfg()).enabled === true && (await page.isChecked(".sheet #ml-on")), "Abbrechen → bleibt eingeschaltet");
  await page.click(".sheet #ml-on");
  await page.waitForSelector('.sheet .ml-h:text("Zur Bestätigung")');
  await typePin(PIN2, ".sheet:last-child");
  await page.waitForTimeout(400);
  ok((await cfg()).enabled === false, "mit PIN bestätigt → ausgeschaltet");
  await page.click(".sheet .close");
  await page.reload();
  await page.waitForSelector(".mn .mn-tabs");
  ok(!(await page.$(".ml-lock")) && !(await page.$(".ml-banner")), "aus: kein Sperrbildschirm, kein Banner mehr (einmalig)");
  ok(!(await page.evaluate(() => document.documentElement.classList.contains("mm-mask"))), "aus: nichts ausgeblendet");

  // Desktop-Ansicht
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.click('.ml-tools [data-ml-t="settings"]');
  await page.click(".sheet #ml-on");
  await page.waitForTimeout(300);
  await page.click(".sheet .close");
  await page.click('.ml-tools [data-ml-t="lock"]');
  await page.waitForSelector(".ml-lock");
  await shot("ml-lock-1440-dark.png");

  ok(errors.length === 0, "Keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
