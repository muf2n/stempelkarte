// Playwright-Test für Alltag › 🎓 LAP Elektrotechnik (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8941 &   then   node tests/lap-e2e.cjs [screenshot-dir]
// /chat wird per page.route gestubbt (Test-Haken window.__skAiTest aus ai-client.js, nur localhost).
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8941/";
const OUT = process.argv[2] || require("os").tmpdir();

function fakes() {
  window.__skAiTest = { token: "test" };
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const chatBodies = [];

  async function newPage(scheme, { width = 390, height = 844 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(fakes);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      await new Promise((r) => setTimeout(r, 150));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        reply: "Gute Frage! ⚡ **Kurz gesagt:** Der FI vergleicht den Strom, der hinfließt, mit dem, der zurückkommt.\n- Fehlt etwas, fließt es woanders hin – z. B. über dich.\n- Denk an die 5 Sicherheitsregeln!",
        actions: [], usage: { usd: 0.01, capUsd: 3 } }) });
    });
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const tab = async (page, id) => { await page.click(`.lap-tab[data-tab="${id}"]`); await page.waitForTimeout(120); };
  const lsJson = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
  const head = (page) => page.textContent(".lap-head");

  /* ================= hell, 390 ================= */
  let { ctx, page } = await newPage("light");
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="lap"]', { timeout: 8000 });
  ok(true, "Kachel „LAP Elektrotechnik“ auf der Alltag-Seite");
  await page.click('.al-tile[data-id="lap"]');
  await page.waitForSelector(".lap-head .lap-stat", { timeout: 8000 });
  ok(/#alltag\/lap$/.test(page.url()), "Route #alltag/lap");
  ok(await page.evaluate(() => !!document.getElementById("lap-css")), "Modul-CSS geladen");
  ok((await page.$$(".lap-tab")).length === 4, "4 Bereiche als Reiter");
  let h = await head(page);
  ok(/🔥 0/.test(h) && /0\/\d{3}/.test(h) && /📝 –/.test(h), "Kopfzeile: Serie 0, 0 Karten gelernt, noch keine Prüfung");
  ok(await page.isHidden(".lap-weak"), "noch keine Schwächen");

  // ---- Lernkarten ----
  await tab(page, "karten");
  ok((await page.$$(".lap-topic")).length === 8, "8 Themen");
  ok(/Lernen \(10\)/.test(await page.textContent('[data-k="start"]')), "10 neue Karten für heute");
  await shot(page, "lap-cards-390-light.png");
  // nur Schutzmaßnahmen
  await page.click('[data-k="all"]');
  ok(await page.isDisabled('[data-k="start"]'), "ohne Themen kein Start");
  await page.click('.lap-topic[data-topic="schutz"]');
  await page.click('[data-k="start"]');
  ok(/Schutzmaßnahmen/.test(await page.textContent(".lap-front .lap-pill")), "Karte aus Schutzmaßnahmen");
  ok(!(await page.$(".lap-grade")), "Bewertung erst nach dem Umdrehen");
  await page.click('[data-k="flip"]');
  ok(await page.isVisible(".lap-a") && (await page.$$(".lap-grade")).length === 4, "Antwort + 4 Bewertungen");
  ok(/Berufsschule/.test(await page.textContent(".lap-back .lap-norm")), "Normhinweis bei Schutzmaßnahmen");
  await shot(page, "lap-flash-390-light.png");

  // KI-Erklärung
  await page.click(".lap-back [data-explain]");
  await page.waitForSelector(".lap-back .lap-typing", { timeout: 2000 });
  await page.waitForSelector(".lap-back .lap-ai-txt", { timeout: 4000 });
  const lastChat = chatBodies.at(-1);
  ok(lastChat && lastChat.mode === "lehrer" && /LAP-Lernfrage/.test(lastChat.messages[0].content) && /Richtige Antwort/.test(lastChat.messages[0].content), "„Erklär mir das“ fragt Claude im Modus „lehrer“");
  ok(/vergleicht den Strom/.test(await page.textContent(".lap-ai-txt")) && await page.isVisible(".lap-ai-txt b"), "Erklärung erscheint (mit Markdown)");
  ok(/5 Sicherheitsregeln/.test(await page.textContent(".lap-ai-safe")), "Sicherheits-Erinnerung unter der Erklärung");
  await shot(page, "lap-explain-390-light.png");

  // Bewertung: erste Karte „Nochmal“, Rest „Gut“
  const firstId = await page.evaluate(() => document.querySelector(".lap-ai").dataset.aikey.slice(2));
  await page.click('.lap-grade[data-q="1"]');
  let n = 0;
  while (await page.$('[data-k="flip"]')) { await page.click('[data-k="flip"]'); await page.click('.lap-grade[data-q="4"]'); n++; if (n > 15) break; }
  ok(await page.isVisible("text=Runde geschafft"), `Runde fertig (${n} weitere Karten, „Nochmal“-Karte kam wieder)`);
  await page.waitForTimeout(900);
  let cards = await lsJson(page, "sk-a-lap_cards");
  const first = cards.find((c) => c.id === firstId);
  ok(first && first.lapses === 1 && first.reps === 1, "„Nochmal“ → Fehler gespeichert, beim 2. Mal gewusst");
  ok(cards.filter((c) => c.id.startsWith("schutz-") && c.reps >= 1).length === 10, "10 Schutz-Karten gelernt (SRS in lap_cards)");
  h = await head(page);
  ok(/🔥 1/.test(h) && /10\/\d{3}/.test(h), "Kopfzeile: Serie 1, 10 Karten gelernt");
  const stats = await lsJson(page, "sk-a-lap_stats");
  const day = Object.values(stats[0].days)[0];
  ok(day.fresh === 10 && day.cards === 11 && day.n === 11, "Statistik: 10 neu, 11 Bewertungen");
  await page.click('[data-k="home"]');

  // Suche
  await page.click('[data-k="list"]');
  await page.fill(".lap-search", "IP44");
  await page.waitForTimeout(300);
  ok((await page.$$(".lap-item")).length === 2, "Suche „IP44“ findet 2 Karten");
  await page.click(".lap-item summary >> text=IP44 ungefähr");
  ok(/Spritzwasser/.test(await page.textContent(".lap-item[open] .lap-a")), "Karte aufklappen zeigt Antwort");
  await page.click('[data-k="home"]');
  await page.click('[data-k="all"]'); // alle Themen wieder an

  // ---- Formeln ----
  await tab(page, "formeln");
  const fcount = (await page.$$(".lap-formula")).length;
  ok(fcount >= 20, `Formelsammlung (${fcount} Formeln)`);
  await page.fill(".lap-search", "Spannungsfall");
  await page.waitForTimeout(300);
  ok((await page.$$(".lap-formula")).length === 2, "Suche „Spannungsfall“ → 1- und 3-phasig");
  ok(/Berufsschule/.test(await page.textContent(".lap-formula .lap-norm")), "Normhinweis beim Spannungsfall");
  await page.click('.lap-formula[data-fid="du1"] [data-open]');
  await page.fill('[data-calc="du1"] input[data-f="l"]', "20");
  await page.fill('[data-calc="du1"] input[data-f="I"]', "10");
  await page.fill('[data-calc="du1"] input[data-f="A"]', "1,5");
  let out = await page.textContent('[data-calc="du1"] .lap-calc-out');
  ok(/4,76 V/.test(out) && /2,07 %/.test(out), `Spannungsfall-Rechner: 4,76 V / 2,07 % (${out.trim()})`);
  await page.click('[data-calc="du1"] [data-mat="al"]');
  out = await page.textContent('[data-calc="du1"] .lap-calc-out');
  ok(/7,62 V/.test(out), "Aluminium (κ 35) → 7,62 V");
  await shot(page, "lap-formula-390-light.png");
  await page.fill(".lap-search", "");
  await page.waitForTimeout(300);
  await page.click('.lap-formula[data-fid="ohm"] [data-open]');
  await page.fill('[data-calc="ohm"] input[data-f="U"]', "230");
  out = await page.textContent('[data-calc="ohm"] .lap-calc-out');
  ok(/zwei Werte/.test(out), "Ohm-Rechner: Hinweis bei nur einem Wert");
  await page.fill('[data-calc="ohm"] input[data-f="R"]', "46");
  out = await page.textContent('[data-calc="ohm"] .lap-calc-out');
  ok(/Strom I/.test(out) && /5 A/.test(out), "Ohm-Rechner: 230 V / 46 Ω = 5 A");
  await page.click('.lap-formula[data-fid="work"] [data-open]');
  await page.fill('[data-calc="work"] input[data-f="P"]', "2000");
  await page.fill('[data-calc="work"] input[data-f="h"]', "3");
  out = await page.textContent('[data-calc="work"] .lap-calc-out');
  ok(/6 kWh/.test(out) && /1,8 €/.test(out.replace("1,80", "1,8")), "Energie-Rechner: 6 kWh, 1,80 €");

  // ---- Rechnen ----
  await tab(page, "rechnen");
  await page.click('.chip[data-pt="ohm"]');
  ok(await page.isVisible(".lap-prob .lap-q"), "Rechenaufgabe angezeigt");
  // Lösung aus der Aufgabe selbst ausrechnen (über die gleiche Logik wie im Unit-Test geht nicht → Lösung anzeigen, dann nächste richtig rechnen)
  await page.click('[data-k="show"]');
  ok((await page.$$(".lap-steps li")).length >= 4 && /Ergebnis/.test(await page.textContent(".lap-steps li:last-child")), "Lösungsweg Schritt für Schritt");
  await page.click('[data-k="next"]');
  const text = await page.textContent(".lap-prob .lap-q");
  const nums = [...text.matchAll(/(\d+(?:,\d+)?) (Ω|V|A)/g)].map((m) => [Number(m[1].replace(",", ".")), m[2]]);
  const v = Object.fromEntries(nums.map(([x, u]) => [u, x]));
  const ask = (await page.textContent(".lap-ansform .lap-field span")).trim().split(" ").pop();
  const ans = ask === "I" ? v.V / v["Ω"] : ask === "U" ? v["Ω"] * v.A : v.V / v.A;
  await page.fill(".lap-ans", String(Math.round(ans * 1000) / 1000).replace(".", ","));
  await page.click('.lap-ansform button[type="submit"]');
  ok(/Richtig/.test(await page.textContent(".lap-fb")), `Aufgabe richtig gelöst (${ask} = ${ans})`);
  await page.click('[data-k="next"]');
  await page.fill(".lap-ans", "99999");
  await page.click('.lap-ansform button[type="submit"]');
  ok(/Leider nicht/.test(await page.textContent(".lap-fb")), "falsche Antwort erkannt");
  await shot(page, "lap-calc-390-light.png");
  ok(/✅ 1 \/ 2/.test(await page.textContent(".lap-prob .lap-row")), "Zähler 1 / 2");

  // ---- Prüfung ----
  await tab(page, "pruefung");
  ok(/Noch keine Versuche/.test(await page.textContent(".lap-page")), "Noch kein Verlauf");
  await shot(page, "lap-exam-home-390-light.png");
  await page.click('[data-k="start"]');
  ok((await page.$$(".lap-qdot")).length === 20 && (await page.$$(".lap-opt")).length === 4, "Prüfung: 20 Fragen, je 4 Antworten");
  ok(/29:5\d|30:00/.test(await page.textContent(".lap-time")), "Timer läuft ab 30:00");
  const run = await lsJson(page, "sk-lap-exam-run");
  ok(run && run.qs.length === 20 && new Set(run.qs.map((q) => q.topic)).size === 8, "alle 8 Themen gemischt");
  // 14 richtig, 5 falsch, 1 offen
  for (let i = 0; i < 19; i++) {
    const q = run.qs[i];
    const idx = i < 14 ? q.options.indexOf(q.a) : q.options.findIndex((o) => o !== q.a);
    await page.click(`.lap-opt[data-opt="${idx}"]`);
    if (i < 19) await page.click('[data-k="nextq"]');
  }
  ok(/19\/20/.test(await page.textContent('[data-k="submit"]')), "19 von 20 beantwortet");
  await shot(page, "lap-exam-run-390-light.png");
  // Neu laden → Prüfung läuft weiter
  await page.reload();
  await page.waitForSelector(".lap-exam", { timeout: 8000 });
  ok(/19\/20/.test(await page.textContent('[data-k="submit"]')), "Prüfung übersteht Neuladen");
  await page.click('[data-k="submit"]');
  ok(/Wirklich abgeben\? 1 offen/.test(await page.textContent('[data-k="submit"]')), "Rückfrage bei offenen Fragen");
  await page.click('[data-k="submit"]');
  await page.waitForSelector(".lap-score", { timeout: 4000 });
  ok((await page.textContent(".lap-score")).trim() === "70 %", "Ergebnis 70 % (14/20)");
  ok((await page.$$(".lap-wrong")).length === 6, "6 Fehler zur Durchsicht (5 falsch + 1 offen)");
  ok(await page.isVisible("text=Nicht beantwortet"), "offene Frage markiert");
  await page.click(".lap-wrong [data-explain]");
  await page.waitForSelector(".lap-wrong .lap-ai-txt", { timeout: 4000 });
  ok(/Ich hatte geantwortet/.test(chatBodies.at(-1).messages[0].content) && chatBodies.at(-1).mode === "lehrer", "Erklärung zur falschen Antwort schickt meine Antwort mit");
  await shot(page, "lap-exam-result-390-light.png", true);
  await page.waitForTimeout(900);
  const exams = await lsJson(page, "sk-a-lap_exams");
  ok(exams && exams.length === 1 && exams[0].pct === 70 && exams[0].wrong.length === 6, "Versuch in lap_exams gespeichert");
  cards = await lsJson(page, "sk-a-lap_cards");
  const wrongIds = exams[0].wrong.map((w) => w.id);
  ok(wrongIds.every((id) => { const c = cards.find((x) => x.id === id); return c && c.reps === 0 && c.lapses >= 1 && c.ex === 1; }), "falsche Fragen kommen als „heute fällig“ in die Lernkarten");
  h = await head(page);
  ok(/📝70%/.test(h.replace(/\s/g, "")), "Kopfzeile zeigt letzte Prüfung 70 %");
  await page.click('[data-k="home"]');
  ok((await page.$$(".lap-histrow")).length === 1 && /70 %/.test(await page.textContent(".lap-histrow")), "Verlauf mit 1 Versuch");
  await page.click(".lap-histrow");
  ok(await page.isVisible(".lap-score"), "alter Versuch lässt sich ansehen");
  await page.click('[data-k="home"]');

  // Schwächen: Schutzmaßnahmen hatte einen Fehler → reicht noch nicht; künstlich mehr Fehler über SRS-Stand
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("sk-a-lap_cards"));
    for (const c of a) if (c.id.startsWith("mess-")) { c.seen = 3; c.lapses = 3; }
    a.push(...Array.from({ length: 4 }, (_, i) => ({ id: `mess-${String(20 + i)}`, seen: 2, lapses: 2, reps: 0, ef: 2, interval: 0, due: "2026-01-01" })));
    localStorage.setItem("sk-a-lap_cards", JSON.stringify(a));
  });
  await page.reload();
  await page.waitForSelector(".lap-head .lap-stat", { timeout: 8000 });
  ok(await page.isVisible(".lap-weak") && /Messtechnik/.test(await page.textContent(".lap-weak")), "Schwaches Thema „Messtechnik“ hervorgehoben");
  await page.click('.lap-weak [data-weak="mess"]');
  ok(await page.getAttribute('.lap-topic[data-topic="mess"]', "aria-pressed") === "true" && await page.getAttribute('.lap-topic[data-topic="grund"]', "aria-pressed") === "false", "Tipp aufs Thema → Lernkarten nur Messtechnik");
  ok(await page.isVisible('.lap-topic.weak[data-topic="mess"]'), "Thema-Kachel als „üben“ markiert");
  await shot(page, "lap-weak-390-light.png");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `kein waagrechtes Scrollen (${sw})`);
  const csp1 = await page.evaluate(() => window.__csp);
  ok(!csp1.length, "keine CSP-Verstöße" + (csp1.length ? ": " + csp1.join(", ") : ""));

  // Schule & Lernen verlinkt
  await page.evaluate(() => { localStorage.setItem("sk-school-tab", "lernen"); location.hash = "#alltag/schule"; });
  await page.waitForTimeout(600);
  const link = await page.$('a[href="#alltag/lap"]');
  if (link) {
    await link.click();
    await page.waitForSelector(".lap-head", { timeout: 6000 });
    ok(true, "Link aus Schule & Lernen öffnet die LAP");
  } else console.log("ℹ️ Schule-Link nicht im sichtbaren Reiter (übersprungen)");
  await ctx.close();

  /* ================= dunkel, 390, andere Akzentfarbe ================= */
  ({ ctx, page } = await newPage("dark"));
  await page.evaluate(() => { document.documentElement.dataset.accent = "gruen"; localStorage.setItem("sk-lap-tab", "karten"); location.hash = "#alltag/lap"; });
  await page.waitForSelector(".lap-head .lap-stat", { timeout: 8000 });
  await shot(page, "lap-cards-390-dark.png");
  await page.click('[data-k="start"]'); await page.click('[data-k="flip"]');
  await shot(page, "lap-flash-390-dark.png");
  await tab(page, "formeln");
  await page.click('.lap-formula[data-fid="du3"] [data-open]');
  await shot(page, "lap-formula-390-dark.png");
  await tab(page, "rechnen");
  await page.click('[data-k="show"]');
  await shot(page, "lap-calc-390-dark.png");
  await tab(page, "pruefung");
  await page.click('[data-k="start"]');
  await page.click('.lap-opt[data-opt="1"]');
  await shot(page, "lap-exam-390-dark.png");
  const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw2 <= 390, `dunkel: kein waagrechtes Scrollen (${sw2})`);
  await ctx.close();

  /* ================= 1440 hell + dunkel ================= */
  for (const scheme of ["light", "dark"]) {
    ({ ctx, page } = await newPage(scheme, { width: 1440, height: 900 }));
    await page.evaluate(() => { localStorage.setItem("sk-lap-tab", "karten"); location.hash = "#alltag/lap"; });
    await page.waitForSelector(".lap-head .lap-stat", { timeout: 8000 });
    await shot(page, `lap-cards-1440-${scheme}.png`);
    await tab(page, "formeln");
    await page.click('.lap-formula[data-fid="du1"] [data-open]');
    await shot(page, `lap-formula-1440-${scheme}.png`);
    await tab(page, "pruefung");
    await page.click('[data-k="start"]');
    await shot(page, `lap-exam-1440-${scheme}.png`);
    const csp = await page.evaluate(() => window.__csp);
    ok(!csp.length, `1440 ${scheme}: keine CSP-Verstöße`);
    await ctx.close();
  }

  await browser.close();
  const bad = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  ok(!bad.length, "keine Konsolenfehler" + (bad.length ? ": " + bad.join(" | ") : ""));
  console.log("\nAlles grün ✅");
})().catch((e) => { console.error(e); process.exit(1); });
