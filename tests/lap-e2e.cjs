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
  let photoCalls = 0;
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
      if (body.image) {
        photoCalls++;
        const reply = photoCalls === 1
          ? "Gerne! 📚\n```json\n" + JSON.stringify({ cards: [
              { q: "Wie heißt der grün-gelbe Leiter?", options: ["Neutralleiter", "Schutzleiter (PE)", "Außenleiter", "PEN-Leiter in blau"], correct: 1, e: "Grün-gelb ist nur für PE.", topic: "leit", year: 1 },
              { front: "Was schützt ein LS-Schalter?", back: "Die Leitung vor Überlast und Kurzschluss", topic: "schutz" },
              { q: "Wofür steht RCD?", a: "Fehlerstrom-Schutzeinrichtung", topic: "schutz", year: 2 },
              { q: "", a: "kaputt" },
            ] }) + "\n```"
          : "Tut mir leid, das Foto ist leider zu unscharf.";
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply, actions: [], usage: { usd: 0.02, capUsd: 3 } }) });
        return;
      }
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
  ok((await page.$$(".lap-tab")).length === 5, "5 Bereiche als Reiter (inkl. 📷 Eigene)");
  ok(await page.getAttribute('.lap-yearbar [data-year="0"]', "aria-pressed") === "true", "Lehrjahr-Auswahl da, Standard „Alle“");
  let h = await head(page);
  ok(/🔥 0/.test(h) && /0\/\d{3}/.test(h) && /📝 –/.test(h), "Kopfzeile: Serie 0, 0 Karten gelernt, noch keine Prüfung");
  ok(await page.isHidden(".lap-weak"), "noch keine Schwächen");

  // ---- Lernkarten ----
  await tab(page, "karten");
  ok((await page.$$(".lap-topic")).length === 10, "10 Themen");
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
  const ip44 = (await page.$$(".lap-item")).length;
  ok(ip44 >= 2 && ip44 <= 4, `Suche „IP44“ findet ${ip44} Karten`);
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
  // 🧮 Taschenrechner
  await page.click('[data-k="next"]');
  ok(await page.isVisible(".lap-calcbox > summary") && !(await page.isVisible(".lap-keys")), "Taschenrechner zugeklappt da");
  await page.click(".lap-calcbox > summary");
  ok(await page.isVisible(".lap-keys"), "Taschenrechner aufgeklappt");
  for (const k of ["2", "3", "0", "÷", "4", "6"]) await page.click(`.lap-key[data-ck="${k}"]`);
  ok((await page.textContent(".lap-calc-res")).trim() === "= 5", "230 ÷ 46 = 5");
  await page.click('.lap-key[data-ck="clear"]');
  for (const k of ["√", "3", "×", "4", "0", "0", "×", "1", "0", "×", "0", ",", "8", "5"]) await page.click(`.lap-key[data-ck="${k}"]`);
  ok(/5\.?888,97/.test(await page.textContent(".lap-calc-res")), `√3 · 400 · 10 · 0,85 (${(await page.textContent(".lap-calc-res")).trim()})`);
  await page.click('.lap-key[data-ck="eq"]');
  ok(/^5888,97/.test(await page.inputValue(".lap-calc-expr")), "„=“ übernimmt das Ergebnis in die Rechnung (ohne Tausenderpunkt)");
  await page.click('[data-ck="take"]');
  ok(/^5888,97/.test(await page.inputValue(".lap-ans")), "📥 Ergebnis übernehmen → Antwortfeld");
  await page.fill(".lap-calc-expr", "2^3+1");
  ok((await page.textContent(".lap-calc-res")).trim() === "= 9", "Tippen geht auch (2^3+1 = 9)");
  await shot(page, "lap-calcpanel-390-light.png");
  await page.click(".lap-ansform button[type=submit]");
  ok(await page.isVisible(".lap-calcbox") && !(await page.$('[data-ck="take"]')), "nach dem Prüfen: Rechner ohne Übernehmen");

  // ---- Prüfung ----
  await tab(page, "pruefung");
  ok(/Noch keine Versuche/.test(await page.textContent(".lap-page")), "Noch kein Verlauf");
  await shot(page, "lap-exam-home-390-light.png");
  await page.click('[data-k="start"]');
  ok((await page.$$(".lap-qdot")).length === 20 && (await page.$$(".lap-opt")).length === 4, "Prüfung: 20 Fragen, je 4 Antworten");
  ok(/29:5\d|30:00/.test(await page.textContent(".lap-time")), "Timer läuft ab 30:00");
  const run = await lsJson(page, "sk-lap-exam-run");
  ok(run && run.qs.length === 20 && new Set(run.qs.map((q) => q.topic)).size === 10, "alle 10 Themen gemischt");
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
  await page.click('[data-k="all"]'); // wieder alle Themen

  // ---- 🎓 Lehrjahre ----
  const data = async () => page.evaluate(async () => { const m = await import("/js/alltag/lap-data.js"); const c = await import("/js/alltag/lap-core.js"); return { years: Object.fromEntries(m.CARDS.map((x) => [x.id, x.year])), num: m.CARDS.filter((x) => c.isNumericQuestion(x)).map((x) => x.id) }; });
  const D = await data();
  await page.click('.lap-yearbar [data-year="1"]');
  await page.waitForTimeout(800);
  ok(await page.getAttribute('.lap-yearbar [data-year="1"]', "aria-pressed") === "true", "1. Lehrjahr gewählt");
  ok(/1\. Lj\./.test(await page.textContent(".lap-hero")), "Lernkarten zeigen „1. Lj.“");
  ok(await page.isVisible('.lap-topic.empty[data-topic="motor"]') && !(await page.$('.lap-topic.empty[data-topic="grund"]')), "Motoren im 1. Lj. leer, Grundlagen voll");
  let st = await lsJson(page, "sk-a-lap_stats");
  ok(st[0].year === 1, "Lehrjahr pro Nutzer gespeichert (lap_stats.year)");
  await page.click('[data-k="list"]');
  const listIds = await page.$$eval(".lap-item .lap-ai", (els) => els.map((e) => e.dataset.aikey.slice(2)));
  ok(listIds.length > 100 && listIds.every((id) => D.years[id] === 1), `Kartenliste nur 1. Lj. (${listIds.length})`);
  await page.click('[data-k="home"]');
  await page.click('[data-k="start"]');
  const fid = await page.evaluate(() => document.querySelector(".lap-front .lap-q") && document.querySelector(".lap-flash"));
  ok(fid !== null, "Lernrunde im 1. Lj. startet");
  await page.click('[data-k="home"]');
  await tab(page, "rechnen");
  const chips = await page.$$eval(".lap-chips [data-pt]", (els) => els.map((e) => e.dataset.pt));
  ok(chips.includes("ohm") && !chips.includes("du1") && !chips.includes("pac"), "Rechnen: nur Aufgaben fürs 1. Lj.");
  await page.click('.lap-yearbar [data-year="3"]');
  await page.waitForTimeout(200);
  const chips3 = await page.$$eval(".lap-chips [data-pt]", (els) => els.map((e) => e.dataset.pt));
  ok(chips3.join() === "mix,du1,du3,p3", `Rechnen 3. Lj.: Spannungsfall + Drehstrom (${chips3.join()})`);
  ok(/Spannungsfall|Drehstrom/.test(await page.textContent(".lap-prob .lap-pill")), "Aufgabe passt zum 3. Lj.");
  await page.click('.lap-yearbar [data-year="2"]');
  await tab(page, "pruefung");
  ok(/bis zum 2\. Lehrjahr/.test(await page.textContent(".lap-examhero")), "Prüfung: „bis zum 2. Lehrjahr“");
  await page.click('[data-k="start"]');
  const run2 = await lsJson(page, "sk-lap-exam-run");
  ok(run2.qs.every((q) => D.years[q.id] <= 2) && run2.qs.some((q) => D.years[q.id] === 2), "Prüfung mischt 2. Lj. und darunter");
  const numIdx = run2.qs.findIndex((q) => D.num.includes(q.id));
  const txtIdx = run2.qs.findIndex((q) => !D.num.includes(q.id));
  if (numIdx >= 0) {
    await page.click(`.lap-qdot[data-go="${numIdx}"]`);
    ok(await page.isVisible(".lap-exam .lap-calcbox") && !(await page.$('.lap-exam [data-ck="take"]')), "Rechenfrage in der Prüfung: 🧮 Rechner (ohne Übernehmen)");
    await page.click(".lap-exam .lap-calcbox > summary");
    await page.click('.lap-key[data-ck="7"]');
    ok(await page.isVisible(".lap-exam .lap-keys"), "Rechner in der Prüfung bedienbar");
    await shot(page, "lap-exam-calc-390-light.png");
  } else console.log("ℹ️ keine Rechenfrage in dieser Prüfung gezogen");
  await page.click(`.lap-qdot[data-go="${txtIdx}"]`);
  ok(!(await page.$(".lap-exam .lap-calcbox")), "Textfrage ohne Rechner");
  await page.evaluate(() => localStorage.removeItem("sk-lap-exam-run"));
  await page.reload();
  await page.waitForSelector(".lap-head .lap-stat", { timeout: 8000 });
  await page.click('.lap-yearbar [data-year="0"]');

  // ---- 📷 Eigene Karten: Aus Foto lernen ----
  await tab(page, "eigene");
  ok(/Aus Foto lernen/.test(await page.textContent(".lap-photohero")) && /Noch keine eigenen Karten/.test(await page.textContent(".lap-page")), "Eigene: Foto-Import + leere Liste");
  await page.click('[data-iy="2"]');
  await shot(page, "lap-own-390-light.png");
  await page.setInputFiles(".lap-photo-in", { name: "arbeitsblatt.png", mimeType: "image/png", buffer: PNG });
  await page.waitForSelector(".lap-busy .lap-typing", { timeout: 3000 });
  ok(await page.isVisible(".lap-preview"), "Foto-Vorschau, während Claude liest");
  await page.waitForSelector(".lap-owned", { timeout: 6000 });
  const pb = chatBodies.at(-1);
  ok(pb.mode === "lehrer" && pb.image && pb.image.type === "image/jpeg" && !/^data:/.test(pb.image.data) && /^[A-Za-z0-9+/]+=*$/.test(pb.image.data), "Foto als JPEG (base64 ohne Präfix) im Modus „lehrer“");
  ok(/^LERNKARTEN AUS FOTO \(JSON\)/.test(pb.messages[0].content) && /2\. Lehrjahr/.test(pb.messages[0].content) && /nichts erfinden/.test(pb.messages[0].content), "Auftrag: JSON, nur Sichtbares, gewähltes Lehrjahr");
  ok((await page.$$(".lap-owned")).length === 3, "3 Karten zur Durchsicht (kaputte weggelassen)");
  ok(/1 unklare Karte/.test(await page.textContent(".lap-page")), "Hinweis auf weggelassene Karte");
  ok(await page.inputValue('[data-i="0"][data-f="a"]') === "Schutzleiter (PE)" && await page.inputValue('[data-i="0"][data-f="x0"]') === "Neutralleiter", "MC: richtige Antwort + 3 falsche erkannt");
  ok(await page.inputValue('[data-i="1"][data-f="year"]') === "2" && await page.inputValue('[data-i="1"][data-f="topic"]') === "schutz", "ohne Jahres-Schätzung → gewähltes 2. Lj.");
  await shot(page, "lap-own-review-390-light.png", true);
  // bearbeiten + löschen + Fehler
  await page.fill('[data-i="0"][data-f="q"]', "Wie heißt der grün-gelbe Leiter in der Installation?");
  await page.click('[data-k="drop"][data-i="2"]');
  ok((await page.$$(".lap-owned")).length === 2 && /Übernehmen \(2\)/.test(await page.textContent('[data-k="save"]')), "Karte entfernt → 2 übrig");
  await page.fill('[data-i="1"][data-f="x0"]', "Nur den FI");
  await page.click('[data-k="save"]');
  ok(await page.isVisible(".lap-owned.bad") && /genau 3 falsche/.test(await page.textContent(".lap-owned.bad")), "Unvollständige Falschantworten werden angemeckert");
  await page.fill('[data-i="1"][data-f="x0"]', "");
  await page.click('[data-k="save"]');
  await page.waitForSelector(".lap-ownrow", { timeout: 3000 });
  await page.waitForTimeout(300);
  let own = await lsJson(page, "sk-a-lap_own");
  ok(own.length === 2 && own.every((c) => c.source === "foto") && own.some((c) => /in der Installation/.test(c.q) && c.x.length === 3 && c.topic === "leit" && c.year === 1) && own.some((c) => c.x.length === 0 && c.year === 2), "✅ Übernehmen speichert 2 eigene Karten (lap_own, source foto)");
  ok(/2 Karten sind jetzt/.test(await page.textContent(".lap-photohero")), "Erfolgsmeldung");
  h = await head(page);
  ok(/\/529/.test(h.replace(/\s/g, "")), "Kopfzeile zählt eigene Karten mit (529)");
  await shot(page, "lap-own-list-390-light.png", true);
  // bearbeiten
  const lsId = own.find((c) => c.x.length === 0).id;
  await page.click(`[data-k="edit"][data-id="${lsId}"]`);
  await page.fill('[data-i="0"][data-f="a"]', "Die Leitung vor Überlast und Kurzschluss 🔌");
  await page.click('[data-k="save"]');
  await page.waitForTimeout(300);
  own = await lsJson(page, "sk-a-lap_own");
  ok(own.find((c) => c.id === lsId).a.includes("🔌") && own.length === 2, "✏️ Bearbeiten speichert in derselben Karte");
  // in den Lernkarten sichtbar
  await tab(page, "karten");
  await page.click('[data-k="list"]');
  await page.fill(".lap-search", "grün-gelbe Leiter in der Installation");
  await page.waitForTimeout(300);
  ok((await page.$$(".lap-item")).length === 1 && /eigene/.test(await page.textContent(".lap-item")), "eigene Karte in den Lernkarten (mit Kennzeichnung)");
  await page.click('[data-k="home"]');
  // löschen
  await tab(page, "eigene");
  await page.click(`[data-k="del"][data-id="${lsId}"]`);
  ok(/Wirklich/.test(await page.textContent(`[data-k="del"][data-id="${lsId}"]`)), "Löschen fragt nach");
  await page.click(`[data-k="del"][data-id="${lsId}"]`);
  await page.waitForTimeout(300);
  own = await lsJson(page, "sk-a-lap_own");
  ok(own.length === 1 && (await page.$$(".lap-ownrow")).length === 1, "🗑️ Karte gelöscht");
  // Fehlerfall: Claude liefert kein JSON
  await page.setInputFiles(".lap-photo-in", { name: "unscharf.png", mimeType: "image/png", buffer: PNG });
  await page.waitForSelector(".lap-photohero .lap-fb.no", { timeout: 6000 });
  ok(/JSON|schärferen Foto/.test(await page.textContent(".lap-photohero .lap-fb.no")), "Kein JSON → freundliche Meldung");
  // selbst schreiben
  await page.click('[data-k="new"]');
  await page.click('[data-k="save"]');
  ok(/Frage fehlt/.test(await page.textContent(".lap-owned.bad")), "leere Karte → Hinweis");
  await page.fill('[data-i="0"][data-f="q"]', "Wie viele Sicherheitsregeln gibt es?");
  await page.fill('[data-i="0"][data-f="a"]', "5");
  await page.selectOption('[data-i="0"][data-f="topic"]', "sich");
  await page.click('[data-k="save"]');
  await page.waitForTimeout(300);
  own = await lsJson(page, "sk-a-lap_own");
  ok(own.length === 2 && own.some((c) => c.source === "hand" && c.topic === "sich" && c.id.startsWith("sich-u")), "✍️ selbst geschriebene Karte gespeichert");
  await tab(page, "karten");

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
  await tab(page, "rechnen");
  await page.click('[data-k="next"]');
  await page.click(".lap-calcbox > summary");
  await page.click('.lap-key[data-ck="9"]');
  await shot(page, "lap-calcpanel-390-dark.png");
  await tab(page, "eigene");
  await page.click('[data-k="new"]');
  await shot(page, "lap-own-edit-390-dark.png", true);
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
    await tab(page, "rechnen");
    await page.click(".lap-calcbox > summary");
    await shot(page, `lap-calc-1440-${scheme}.png`);
    await tab(page, "eigene");
    await shot(page, `lap-own-1440-${scheme}.png`);
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
