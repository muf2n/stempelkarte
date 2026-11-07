// Playwright-Test für den 🛤️ Lernpfad (Japanisch + LAP, „wie Duolingo“) – lokaler Modus.
//   cd <worktree> && python3 -m http.server 8995 &   then   node tests/lernpfad-e2e.cjs [screenshot-dir]
// speechSynthesis wird durch eine Attrappe ersetzt, SpeechRecognition entfernt (→ keine Sprech-Übungen).
// Test-Haken window.__skLpTest (nur localhost) liefert die aktuelle Übung, damit der Test sie lösen kann.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8995/";
const OUT = process.argv[2] || require("os").tmpdir();

function fakes() {
  window.__skLpTest = {};
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  const tts = (window.__tts = { spoken: [] });
  const ss = {
    speaking: false, pending: false, paused: false,
    getVoices() { return [{ name: "Google 日本語", lang: "ja-JP" }]; },
    addEventListener() {}, removeEventListener() {},
    speak(u) { tts.spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); setTimeout(() => u.onend && u.onend({}), 20); },
    cancel() {}, pause() {}, resume() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ""; this.rate = 1; this.voice = null; } };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function newPage(scheme, { width = 390, height = 844 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(fakes);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error" && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const lp = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-learn_progress") || "[]"));
  const lpDoc = async (page, id) => (await lp(page)).find((d) => d.id === id) || null;
  const curEx = (page) => page.evaluate(() => window.__skLpTest.ex);
  const clickData = (page, attr, val) => page.evaluate(([a, v]) => { const b = [...document.querySelectorAll(".lp-player button")].find((x) => x.dataset[a] === v && !x.disabled); if (!b) throw new Error("kein Knopf " + a + "=" + v); b.click(); }, [attr, val]);

  /** Aktuelle Übung beantworten (richtig oder absichtlich falsch). → { type, ok } */
  async function answer(page, { wrong = false, calc = false } = {}) {
    const ex = await curEx(page);
    switch (ex.type) {
      case "mc": {
        const i = wrong ? ex.options.findIndex((o) => o !== ex.answer) : ex.options.indexOf(ex.answer);
        await page.click(`.lp-opt[data-opt="${i}"]`);
        await page.click(".lp-check");
        break;
      }
      case "tf": await page.click(`.lp-opt[data-tf="${ex.answer !== wrong ? 1 : 0}"]`); await page.click(".lp-check"); break;
      case "tiles": {
        if (wrong) { await page.click('[data-tile="0"]'); if (ex.tiles[0] === ex.answer) await page.click('[data-tile="1"]'); }
        else { const used = new Set(); for (const c of ex.words || [...ex.answer]) { const i = ex.tiles.findIndex((t, k) => t === c && !used.has(k)); used.add(i); await page.click(`[data-tile="${i}"]`); } }
        await page.click(".lp-check");
        break;
      }
      case "match": {
        if (wrong) { await clickData(page, "ml", ex.pairs[0].l); await clickData(page, "mr", ex.pairs[1].r); await page.waitForTimeout(60); }
        for (const p of ex.pairs) { await clickData(page, "ml", p.l); await clickData(page, "mr", p.r); }
        break;
      }
      case "type": await page.fill(".lp-typein", wrong ? "xyzq" : ex.answer); await page.press(".lp-typein", "Enter"); break;
      case "num": {
        const val = wrong ? ex.answer * 3 + 7 : ex.answer;
        if (calc) {
          await page.click(".lp-player .lap-calcbox > summary");
          await page.fill(".lp-player .lap-calc-expr", String(Number(val.toPrecision(10))).replace(".", ","));
          await page.click('.lp-player [data-ck="take"]');
          await page.waitForTimeout(80);
        } else await page.fill(".lp-numin", String(Number(val.toPrecision(10))).replace(".", ","));
        await page.click(".lp-check");
        break;
      }
      case "speak": await page.click('[data-p="skip"]'); return { type: ex.type, ok: true, skipped: true };
      default: throw new Error("unbekannte Übung " + ex.type);
    }
    await page.waitForSelector(".lp-sheet", { timeout: 3000 });
    const good = await page.evaluate(() => document.querySelector(".lp-sheet").classList.contains("ok"));
    return { type: ex.type, ok: good, ex };
  }
  /** Lektion bis zum Ende spielen. → Liste der Übungsarten */
  async function playToEnd(page, { wrongAt = [], calcOnce = false, shots = null } = {}) {
    const types = [];
    let n = 0, usedCalc = false;
    for (let guard = 0; guard < 60; guard++) {
      if (await page.$(".lp-end, .lp-out")) break;
      const ex = await curEx(page);
      const useCalc = calcOnce && !usedCalc && ex.type === "num";
      if (useCalc) usedCalc = true;
      const r = await answer(page, { wrong: wrongAt.includes(n), calc: useCalc });
      types.push(r.type);
      if (shots && n === 0) { await shots.exercise(); }
      if (!r.skipped) {
        if (shots && wrongAt.includes(n)) await shots.feedback();
        if (r.ok === wrongAt.includes(n)) throw new Error(`Übung ${n} (${r.type}) Ergebnis ${r.ok} unerwartet`);
        await page.click(".lp-cont");
      }
      n++;
    }
    return { types, usedCalc };
  }

  /* ================= 🇯🇵 Japanisch – hell, 390 ================= */
  let { ctx, page } = await newPage("light");
  await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(await page.getAttribute('.jp-tab[data-tab="pfad"]', "aria-selected") === "true", "Japanisch: 🛤️ Lernpfad ist der erste Reiter und Standard");
  ok((await page.$$(".jp-tab")).length === 9, "alle bisherigen Reiter bleiben (9 inkl. Lernpfad und Grammatik)");
  ok(await page.isHidden(".jp-head"), "klassische Kopfzeile im Lernpfad ausgeblendet (eigene Kopfzeile)");
  ok(await page.evaluate(() => !!document.getElementById("lp-css")), "Lernpfad-CSS geladen");
  const unitHead = await page.textContent(".lp-unit .lp-uhead");
  ok(/Einheit 1/.test(unitHead) && /Hiragana Grundreihe/.test(unitHead), "Einheit 1 · Hiragana Grundreihe");
  ok((await page.$$(".lp-unit")).length >= 18, "Einheiten: Hiragana, Katakana, Wortschatz");
  ok(await page.$(".lp-node.is-current") && await page.$(".lp-start"), "erster Knoten aktuell mit START");
  ok((await page.$$(".lp-node.is-locked")).length > 10, "weitere Knoten gesperrt 🔒");
  ok(await page.$(".lp-node.lp-n-chest") && await page.$(".lp-node.lp-n-check"), "Schatzkiste 🎁 und Prüfung 🏁 im Pfad");
  ok(/❤️5/.test((await page.textContent(".lp-hearts")).replace(/\s/g, "")), "5 Herzen");
  // Tagesziel einmal wählen
  ok(await page.isVisible(".lp-goalpick"), "Tagesziel-Auswahl beim ersten Mal");
  await page.click('.lp-goalbtn[data-goal="normal"]');
  await page.waitForTimeout(200);
  ok(!(await page.$(".lp-goalpick")) && /\/50/.test(await page.textContent(".lp-xp")), "Tagesziel Normal: 0/50 XP");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "lp-jp-path-390-light.png");

  // Lektion 1: あ-Reihe
  await page.click(".lp-node.is-current");
  ok(await page.isVisible(".lp-pop"), "Knoten antippen → Info-Karte");
  ok(/Lektion 1 von/.test(await page.textContent(".lp-pop")), "Info: Lektion 1 von …");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex", { timeout: 3000 });
  ok(await page.isVisible(".lp-prog") && await page.isVisible(".lp-check"), "Vollbild-Lektion mit Fortschrittsbalken und PRÜFEN");
  ok(await page.isDisabled(".lp-check"), "PRÜFEN erst nach einer Auswahl");
  let first = await curEx(page);
  ok(first.type === "mc" && first.mode === "k2r", "erste Übung: Kana → Romaji");
  const jpRes = await playToEnd(page, {
    wrongAt: [0],
    shots: {
      exercise: async () => {},
      feedback: async () => { await shot(page, "lp-jp-feedback-wrong-390-light.png"); },
    },
  });
  ok(jpRes.types.length >= 11, `Lektion mit ${jpRes.types.length} Übungen (inkl. Wiederholung des Fehlers)`);
  ok(jpRes.types.filter((t) => t === "mc").length >= 5 && jpRes.types.includes("type") && jpRes.types.includes("match"), "Übungsarten: Auswahl, Tippen, Paare");
  ok((await page.evaluate(() => window.__tts.spoken.filter((s) => s.lang === "ja-JP").length)) >= 1, "Hören-Übung liest auf Japanisch vor");
  await page.waitForSelector(".lp-end");
  const endTxt = await page.textContent(".lp-end");
  ok(/Lektion geschafft/.test(endTxt) && /\+1[0-9] *⚡|\+1[0-9]/.test(endTxt), "Endbildschirm: Lektion geschafft + XP");
  ok(/Genauigkeit/.test(endTxt) && /9[0-9] %|8[0-9] %/.test(endTxt), "Genauigkeit unter 100 % (ein Fehler)");
  ok(/1 Tag Serie/.test(endTxt), "🔥 Serie: 1 Tag");
  ok(/Erste Lektion/.test(endTxt), "Abzeichen „Erste Lektion“");
  ok(await page.$(".lp-end .lp-mascot-cheer"), "Funki jubelt");
  await shot(page, "lp-jp-end-390-light.png");
  await page.click('[data-p="done"]');
  await page.waitForTimeout(200);
  ok(!(await page.$(".lp-player")), "WEITER schließt die Lektion");
  let me = await lpDoc(page, "me");
  let jp = await lpDoc(page, "jp");
  ok(me.hearts.n === 4, "ein Fehler kostet ein Herz (4 ❤️)");
  ok(jp && Object.keys(jp.nodes).length === 1 && jp.nodes["jp-hira-b1-1"].c === 1, "Knoten 1 geschafft, Krone Stufe 1");
  const xp1 = Object.values(jp.xp)[0];
  ok(xp1 >= 10, `XP gespeichert (${xp1})`);
  ok(me.gems >= 1 && me.lessons === 1 && me.ach.first, "Edelsteine, Lektionenzahl, Abzeichen gespeichert");
  const cards = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-jp_cards") || "[]"));
  ok(cards.some((c) => c.kind === "kana" && c.lapses >= 1) && cards.filter((c) => c.kind === "kana").length >= 5, "Fehler & Kana landen im SRS (jp_cards)");
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-jp_stats") || "[]"));
  ok(st[0] && Object.values(st[0].days)[0].path >= 11, "klassische Statistik zählt die Lernpfad-Übungen");
  ok(await page.getAttribute('[data-node="jp-hira-b1-1"]', "class").then((c) => /is-done/.test(c)), "Knoten 1 ⭐ geschafft");
  ok(await page.getAttribute('[data-node="jp-hira-b1-2"]', "class").then((c) => /is-current/.test(c)), "nächster Knoten freigeschaltet (aktuell)");
  ok(/❤️4/.test((await page.textContent(".lp-hearts")).replace(/\s/g, "")) && /\+1 in/.test(await page.textContent(".lp-hearts")), "Kopfzeile: 4 Herzen, +1 in … min");

  // Reload → alles bleibt
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(/is-done/.test(await page.getAttribute('[data-node="jp-hira-b1-1"]', "class")) && /is-current/.test(await page.getAttribute('[data-node="jp-hira-b1-2"]', "class")), "nach Neuladen: Fortschritt bleibt");
  ok(/1/.test(await page.textContent(".lp-streak")), "🔥 Serie bleibt nach Neuladen");

  // Klassische Reiter funktionieren weiter
  await page.click('.jp-tab[data-tab="kana"]');
  await page.waitForTimeout(150);
  ok(await page.isVisible(".jp-head") && await page.isVisible(".jp-kcell"), "Kana-Reiter + Kopfzeile wie bisher");
  await page.click('.jp-tab[data-tab="pfad"]');
  await page.waitForSelector(".lp-path");

  // Herzen leer → freundlicher Hinweis + Üben
  await page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem("sk-a-learn_progress"));
    const m = a.find((d) => d.id === "me"); m.hearts = { n: 1, at: Date.now() };
    localStorage.setItem("sk-a-learn_progress", JSON.stringify(a));
  });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.click(".lp-node.is-current");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  await answer(page, { wrong: true });
  ok(/❤️0/.test((await page.textContent(".lp-phearts")).replace(/\s/g, "")), "letztes Herz verloren");
  await page.click(".lp-cont");
  await page.waitForSelector(".lp-out");
  ok(/Mach eine kurze Pause oder übe Fehler/.test(await page.textContent(".lp-out")), "0 Herzen → „Mach eine kurze Pause oder übe Fehler 💪“");
  await shot(page, "lp-jp-hearts-out-390-light.png");
  await page.click('.lp-out [data-p="practice"]');
  await page.waitForSelector(".lp-player .lp-ex");
  ok(/∞/.test(await page.textContent(".lp-phearts")), "Üben kostet keine Herzen (∞)");
  await playToEnd(page, { wrongAt: [1] });
  await page.waitForSelector(".lp-end");
  ok(/Fein geübt/.test(await page.textContent(".lp-end")) && /\+1 Herz/.test(await page.textContent(".lp-end")), "Üben fertig: ❤️ +1");
  await page.click('[data-p="done"]');
  me = await lpDoc(page, "me");
  ok(me.hearts.n === 1, "Herz durch Üben zurück (1 ❤️)");
  // App bleibt bedienbar
  await page.evaluate(() => { location.hash = "#heute"; });
  await page.waitForTimeout(300);
  ok(!(await page.$(".lp-player")) && !(await page.evaluate(() => document.documentElement.classList.contains("lp-lock"))), "Rest der App nie blockiert");
  await ctx.close();

  /* ================= 🎓 LAP – dunkel, 390 ================= */
  ({ ctx, page } = await newPage("dark"));
  await page.evaluate(() => { location.hash = "#alltag/lap"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(await page.getAttribute('.lap-tab[data-tab="pfad"]', "aria-selected") === "true", "LAP: 🛤️ Lernpfad ist Standard");
  ok((await page.$$(".lap-tab")).length === 6, "alle bisherigen LAP-Reiter bleiben (6 inkl. Lernpfad)");
  await page.click('.lap-yearbar [data-year="1"]');
  await page.waitForTimeout(200);
  const lu = await page.textContent(".lp-unit .lp-uhead");
  ok(/Einheit 1/.test(lu) && /Grundlagen/.test(lu), "1. Lehrjahr: Einheit 1 · Grundlagen");
  ok((await page.$$(".lp-seg")).length === 1, "nur das gewählte Lehrjahr");
  ok((await page.$$('.lp-node[aria-label*="Rechnen"]')).length >= 1, "Rechen-Lektionen eingeflochten");
  await page.click('.lp-goalbtn[data-goal="leicht"]');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "lp-lap-path-390-dark.png");
  await page.click(".lp-node.is-current");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  first = await curEx(page);
  ok(first.type === "mc" && first.kind === "card" && first.options.length === 4, "LAP-Karte als Auswahl (4 Antworten aus der Karte)");
  await shot(page, "lp-lap-exercise-390-dark.png");
  const lapRes = await playToEnd(page, { wrongAt: [2], shots: { exercise: async () => {}, feedback: async () => { await shot(page, "lp-lap-feedback-wrong-390-dark.png"); } } });
  ok(lapRes.types.includes("tf"), "Richtig/Falsch-Übung aus Kartenfakten");
  await page.waitForSelector(".lp-end");
  await shot(page, "lp-lap-end-390-dark.png");
  await page.click('[data-p="done"]');
  let lap = await lpDoc(page, "lap");
  me = await lpDoc(page, "me");
  ok(lap.nodes["lap-y1-grund-1-1"] && me.hearts.n === 4, "LAP-Lektion geschafft, ein Herz weniger");
  const lc = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-lap_cards") || "[]"));
  ok(lc.some((c) => c.lapses >= 1) && lc.length >= 6, "Fehler fließen ins LAP-SRS (Lernkarten-Reiter)");
  ok(/is-current/.test(await page.getAttribute('[data-node="lap-y1-grund-1-2"]', "class")), "nächste LAP-Lektion freigeschaltet");
  // Rechen-Lektion direkt über die Einheiten-Prüfung (Überspringen) – mit Rechner
  await page.click('[data-node="lap-y1-grund-1-p"]');
  ok(/ÜBERSPRINGEN/.test(await page.textContent(".lp-pop")), "Prüfung der aktuellen Einheit: Überspringen möglich");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  // Bis zur ersten Rechenaufgabe richtig antworten, Screenshot der Rechenaufgabe
  const chk = await playToEnd(page, { calcOnce: true, shots: null });
  ok(chk.types.includes("num") && chk.usedCalc, "Rechenaufgabe mit eingebautem Taschenrechner gelöst");
  await page.waitForSelector(".lp-end");
  ok(/übersprungen/.test(await page.textContent(".lp-end")), "Einheit übersprungen 🚀");
  await page.click('[data-p="done"]');
  lap = await lpDoc(page, "lap");
  const unitIds = Object.keys(lap.nodes).filter((k) => k.startsWith("lap-y1-grund-1-"));
  ok(unitIds.length >= 10, `ganze Einheit freigeschaltet (${unitIds.length} Knoten)`);
  ok(/is-current/.test(await page.getAttribute(".lp-unit:nth-of-type(2) .lp-node >> nth=0", "class").catch(() => "")) || await page.$('[data-node="lap-y1-grund-2-1"].is-current'), "Einheit 2 jetzt dran");
  // Reload → bleibt
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(await page.$('[data-node="lap-y1-grund-2-1"].is-current') && await page.$('[data-node="lap-y1-grund-1-p"].is-done'), "nach Neuladen: LAP-Fortschritt bleibt");
  // Lernkarten-Reiter wie bisher
  await page.click('.lap-tab[data-tab="karten"]');
  await page.waitForTimeout(150);
  ok(await page.isVisible(".lap-head") && (await page.$$(".lap-topic")).length === 10, "Lernkarten-Reiter wie bisher");
  await ctx.close();

  /* ================= Rechenaufgabe + Feedback als Screenshot (390 hell + dunkel) ================= */
  for (const scheme of ["light", "dark"]) {
    ({ ctx, page } = await newPage(scheme));
    await page.evaluate(() => {
      localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 420, hearts: { n: 5, at: 0 }, freezes: 0, frozen: {}, ach: {}, ok: 0, lessons: 0, perfect: 0 }]));
      localStorage.setItem("sk-a-lap_stats", JSON.stringify([{ id: "me", goal: 15, newPerDay: 10, year: 1, days: {} }]));
      });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/lap"; });
    await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
    // erste Rechen-Lektion (Knoten 3 der Einheit 1) ist noch gesperrt → per Prüfung testen wir oben; hier: Lektion öffnen und Rechenübung anzeigen
    await page.click('[data-node="lap-y1-grund-1-p"]');
    await page.click('.lp-pop [data-lp="start"]');
    await page.waitForSelector(".lp-player .lp-ex");
    for (let g = 0; g < 20; g++) { const ex = await curEx(page); if (ex.type === "num") break; await answer(page); await page.click(".lp-cont"); }
    await page.click(".lp-player .lap-calcbox > summary");
    await shot(page, `lp-lap-calc-390-${scheme}.png`);
    await answer(page, { wrong: true });
    await shot(page, `lp-lap-calc-feedback-390-${scheme}.png`);
    if (scheme === "dark") {
      await page.click(".lp-cont");
      await page.click('[data-p="quit"]');
      await page.waitForTimeout(150);
      ok(!(await page.$(".lp-player")), "✕ beendet die Lektion (mit Nachfrage)");
    }
    await ctx.close();
  }

  /* ================= Japanisch dunkel: Übung + Feedback + Ende ================= */
  ({ ctx, page } = await newPage("dark"));
  await page.evaluate(() => { localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "ernst", gems: 0, hearts: { n: 5, at: 0 }, ach: {} }])); });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "lp-jp-path-390-dark.png");
  // Wortschatz-Abschnitt ist eigener Abschnitt → frei
  await page.click('[data-node="jp-w0-1"]');
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  await shot(page, "lp-jp-exercise-390-dark.png");
  let tilesShot = false;
  const vres = await playToEnd(page, { wrongAt: [0], shots: { exercise: async () => {}, feedback: async () => { await shot(page, "lp-jp-feedback-390-dark.png"); } } });
  ok(vres.types.includes("tiles") && vres.types.includes("match"), "Wortschatz: Kacheln bauen + Paare");
  await page.waitForSelector(".lp-end");
  await shot(page, "lp-jp-end-390-dark.png");
  await ctx.close();
  void tilesShot;

  /* ================= 📐 Grammatik-Lektion im Pfad (390 hell + dunkel) ================= */
  for (const scheme of ["light", "dark"]) {
    ({ ctx, page } = await newPage(scheme));
    // Basis-Wörter (Begrüßung, Zahlen) als geschafft markieren → erste Grammatik-Einheit ist dran
    await page.evaluate(async () => {
      const P = await import("/js/alltag/path-core.js");
      const d = await import("/js/alltag/jp-data.js");
      const g = await import("/js/alltag/jp-data-grammar.js");
      const s = await import("/js/alltag/jp-data-sentences.js");
      const c = await import("/js/alltag/jp-core.js");
      const us = P.jpUnits({ groups: d.KANA_GROUPS, vocab: d.VOCAB, toKata: c.toKatakana, grammar: g.GRAMMAR, sentences: s.SENTENCES, order: g.PATH_ORDER });
      const nodes = {};
      for (const u of us) if (u.id === "jp-w0" || u.id === "jp-w1") for (const n of u.nodes) nodes[n.id] = { c: 1, n: 1, at: Date.now() };
      localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 0, hearts: { n: 5, at: 0 }, ach: { first: 1 } }, { id: "jp", nodes, xp: {} }]));
    });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
    await page.waitForSelector('[data-node="jp-g-desu-1"]', { timeout: 8000 });
    ok(/is-(current|open)/.test(await page.getAttribute('[data-node="jp-g-desu-1"]', "class")), `${scheme}: nach den Basis-Wörtern ist 📐 Grammatik „です“ frei`);
    ok(await page.$('[data-node="jp-w2-1"].is-locked') && await page.$('[data-node="jp-w2x-1"]') && await page.$('[data-node="jp-g-teiru-p"]'), "danach abwechselnd Wortschatz und Grammatik (alte IDs bleiben, Erweiterungen angehängt)");
    await page.evaluate(() => document.querySelector('[data-node="jp-g-desu-1"]').scrollIntoView({ block: "center" }));
    if (scheme === "light") await shot(page, "lp-jp-grammar-path-390-light.png");
    await page.click('[data-node="jp-g-desu-1"]');
    await page.click('.lp-pop [data-lp="start"]');
    await page.waitForSelector(".lp-player .lp-ex");
    ok(await page.isVisible(".lp-player details.lp-hint[open]"), "erste Übung zeigt die Regel 💡 (aufgeklappt)");
    await shot(page, `lp-jp-grammar-hint-390-${scheme}.png`);
    let sawGap = false, sawSentTiles = false;
    const gres = await playToEnd(page, {
      wrongAt: [5],
      shots: { exercise: async () => {}, feedback: async () => { await shot(page, `lp-jp-grammar-feedback-390-${scheme}.png`); } },
    });
    void sawGap; void sawSentTiles;
    ok(gres.types.includes("tiles") && gres.types.filter((t) => t === "mc").length >= 5, `Grammatik-Lektion: Lesen, Lücken & Satzbauen (${gres.types.join(",")})`);
    await page.waitForSelector(".lp-end");
    await page.click('[data-p="done"]');
    const jpg = await lpDoc(page, "jp");
    ok(jpg.nodes["jp-g-desu-1"] && /is-(current|open)/.test(await page.getAttribute('[data-node="jp-g-desu-2"]', "class")), "Grammatik-Lektion geschafft → „Üben“ freigeschaltet");
    const gcards = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-jp_cards") || "[]"));
    ok(!gcards.some((c) => /^g_|^t\d/.test(c.id)), "Grammatik/Sätze landen nicht im Vokabel-SRS");
    if (scheme === "dark") {
      // Satzbau-Übung als Screenshot
      await page.click('[data-node="jp-g-desu-2"]');
      await page.click('.lp-pop [data-lp="start"]');
      await page.waitForSelector(".lp-player .lp-ex");
      for (let k = 0; k < 20; k++) { const ex = await curEx(page); if (ex.type === "tiles" && ex.kind === "sent") break; await answer(page); await page.click(".lp-cont"); }
      const tx = await curEx(page);
      ok(tx.type === "tiles" && tx.words.length >= 2 && tx.tiles.length > tx.words.length, "Satz aus Wort-Kacheln bauen (mit Ablenkern)");
      await page.click('[data-tile="0"]');
      await shot(page, "lp-jp-grammar-tiles-390-dark.png");
      await page.keyboard.press("Escape");
    }
    await ctx.close();
  }

  /* ================= Desktop 1440: Seitenleiste, Laden, Kacheln-Übung ================= */
  ({ ctx, page } = await newPage("light", { width: 1440, height: 900 }));
  await page.evaluate(() => {
    localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 420, hearts: { n: 3, at: Date.now() }, freezes: 0, frozen: {}, ach: { first: 1 }, ok: 12, lessons: 1 }]));
    });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".lp-side .lp-week", { timeout: 8000 });
  await page.waitForFunction(() => { const l = document.getElementById("lp-css"); return l && l.sheet; }); // CSS wird nachgeladen
  await page.waitForTimeout(150);
  ok(await page.isVisible(".lp-side") && await page.isHidden(".lp-morebtn"), "Desktop: Seitenleiste rechts immer sichtbar");
  ok((await page.$$(".lp-week .lp-bar")).length === 7, "Wochen-XP als SVG (7 Balken)");
  ok((await page.$$(".lp-shelf .lp-badge")).length >= 10 && (await page.$$(".lp-shelf .lp-badge.got")).length === 1, "Abzeichen-Regal (1 verdient)");
  await page.click('[data-lp="buy-freeze"]');
  await page.waitForTimeout(200);
  me = await lpDoc(page, "me");
  ok(me.gems === 220 && me.freezes === 1, "🧊 Serien-Schutz für 200 💎 gekauft");
  ok(await page.isDisabled('[data-lp="buy-hearts"]'), "Herzen auffüllen braucht 350 💎");
  await shot(page, "lp-jp-path-1440-light.png");
  await page.click('[data-node="jp-w0-1"]');
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  for (let g = 0; g < 20; g++) { const ex = await curEx(page); if (ex.type === "tiles") break; await answer(page); await page.click(".lp-cont"); }
  const tex = await curEx(page);
  if (tex.type === "tiles") { await page.click('[data-tile="0"]'); await shot(page, "lp-jp-tiles-1440-light.png"); }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  ok(!(await page.$(".lp-player")), "Esc schließt die Lektion");
  await ctx.close();

  /* ================= Mobil: 📊 öffnet Fortschritt ================= */
  ({ ctx, page } = await newPage("light"));
  await page.evaluate(() => { location.hash = "#alltag/lap"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(await page.isHidden(".lp-side"), "Handy: Seitenleiste erst über 📊");
  await page.click('[data-lp="side"]');
  ok(await page.isVisible(".lp-side .lp-week"), "📊 zeigt Woche, Laden & Abzeichen");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `kein waagrechtes Scrollen (${sw}px)`);
  await ctx.close();

  const csp = errors.filter((e) => /Content Security Policy|CSP/i.test(e));
  ok(!csp.length, "keine CSP-Verstöße");
  ok(!errors.length, "keine Konsolenfehler" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log("Alles gut ✅");
})().catch((e) => { console.error(e); process.exit(1); });
