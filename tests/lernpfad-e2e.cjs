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
    const types = [], oks = [];
    let n = 0, usedCalc = false;
    for (let guard = 0; guard < 60; guard++) {
      if (await page.$(".lp-end, .lp-out")) break;
      const ex = await curEx(page);
      const useCalc = calcOnce && !usedCalc && ex.type === "num";
      if (useCalc) usedCalc = true;
      const r = await answer(page, { wrong: wrongAt.includes(n), calc: useCalc });
      types.push(r.type);
      if (!r.skipped) oks.push(r.ok);
      if (shots && n === 0) { await shots.exercise(); }
      if (!r.skipped) {
        if (shots && wrongAt.includes(n)) await shots.feedback();
        if (r.ok === wrongAt.includes(n)) throw new Error(`Übung ${n} (${r.type}) Ergebnis ${r.ok} unerwartet`);
        await page.click(".lp-cont");
      }
      n++;
    }
    return { types, oks, usedCalc };
  }

  /** 🔋 erwartete Energie nach einer Folge von Antworten (richtig −1, falsch −2, alle 5 in Folge +2, nie über 25, kein Bonus bei 0) */
  function expectEnergy(start, oks) {
    let n = start, combo = 0;
    for (const good of oks) {
      n = Math.max(0, n - (good ? 1 : 2));
      combo = good ? combo + 1 : 0;
      if (good && n > 0 && combo % 5 === 0) n = Math.min(25, n + 2);
    }
    return n;
  }
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const chip = async (page) => (await page.textContent(".lp-energy")).replace(/\s/g, "");
  const chipTitle = (page) => page.getAttribute(".lp-energy", "title");
  const pctOf = (n) => Math.round((n / 25) * 100);
  const pen = async (page) => (await page.textContent(".lp-penergy")).replace(/\s/g, "");
  const setMe = (page, patch) => page.evaluate((pt) => {
    const a = JSON.parse(localStorage.getItem("sk-a-learn_progress") || "[]");
    let m = a.find((d) => d.id === "me"); if (!m) { m = { id: "me" }; a.push(m); }
    Object.assign(m, pt);
    localStorage.setItem("sk-a-learn_progress", JSON.stringify(a));
  }, patch);

  /* ================= 🇯🇵 Japanisch – hell, 390 ================= */
  let { ctx, page } = await newPage("light");
  await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(await page.getAttribute('.jp-tab[data-tab="pfad"]', "aria-selected") === "true", "Japanisch: 🛤️ Lernpfad ist der erste Reiter und Standard");
  ok((await page.$$(".jp-tab")).length === 10, "alle bisherigen Reiter bleiben (10 inkl. Lernpfad, 🏋️ Üben und Grammatik)");
  ok(await page.getAttribute(".jp-tab:nth-child(2)", "data-tab") === "ueben", "🏋️ Üben direkt neben dem Lernpfad");
  ok(await page.isHidden(".jp-head"), "klassische Kopfzeile im Lernpfad ausgeblendet (eigene Kopfzeile)");
  ok(await page.evaluate(() => !!document.getElementById("lp-css")), "Lernpfad-CSS geladen");
  const unitHead = await page.textContent(".lp-unit .lp-uhead");
  ok(/Einheit 1/.test(unitHead) && /Hiragana Grundreihe/.test(unitHead), "Einheit 1 · Hiragana Grundreihe");
  ok((await page.$$(".lp-unit")).length >= 18, "Einheiten: Hiragana, Katakana, Wortschatz");
  ok(await page.$(".lp-node.is-current") && await page.$(".lp-start"), "erster Knoten aktuell mit START");
  ok((await page.$$(".lp-node.is-locked")).length > 10, "weitere Knoten gesperrt 🔒");
  ok(await page.$(".lp-node.lp-n-chest") && await page.$(".lp-node.lp-n-check"), "Schatzkiste 🎁 und Prüfung 🏁 im Pfad");
  ok((await chip(page)).startsWith("🔋100%") && /25\/25/.test(await chip(page)) && /voll/.test(await chipTitle(page)), "🔋 100 % Energie (klein 25/25, voll)");
  ok(await page.isVisible(".lp-banner") && /HIRAGANA · EINHEIT 1/.test(await page.textContent(".lp-banner")) && await page.isVisible('.lp-banner [data-lp="guide"]'), "Banner: „HIRAGANA · EINHEIT 1“ + 📒 Guide");
  ok(await page.$(".lp-flag") && /🇯🇵/.test(await page.textContent(".lp-top")), "Kopfzeile kompakt: 🇯🇵 🔥 💎 🔋 %");
  ok(!(await page.$(".lp-hearts, .lp-phearts")) && !/❤️|Herz/.test(await page.textContent(".lp")), "keine Herzen mehr im Lernpfad");
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
  ok(await page.isVisible(".lp-penergy .lp-ebar") && (await pen(page)).startsWith("🔋100%") && /25\/25/.test(await pen(page)), "Player oben: 🔋 100 % mit Balken und 25/25");
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
  const en1 = expectEnergy(25, jpRes.oks);
  ok(!me.hearts && me.energy && me.energy.n === en1, `Energie: ${jpRes.oks.length} Antworten, 1 Fehler (−2), Combo-Bonus → 🔋 ${me.energy && me.energy.n} (erwartet ${en1})`);
  ok(en1 === 25 - jpRes.oks.length - 1 + 2 * Math.floor((jpRes.oks.length - 1) / 5), "falsch kostet 2, alle 5 richtigen in Folge +2");
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
  ok((await chip(page)).startsWith(`🔋${pctOf(en1)}%`) && (await chip(page)).endsWith(`${en1}/25`) && /\+1 in (30|29) min/.test(await chipTitle(page)), `Kopfzeile: 🔋 ${pctOf(en1)} % (${en1}/25), „+1 in 30 min“ im Tooltip`);
  // ⭐ geschaffte Lektion → „Nochmal üben (gratis)“
  await page.click('[data-node="jp-hira-b1-1"]');
  ok(/NOCHMAL ÜBEN \(GRATIS\)/.test(await page.textContent(".lp-pop")), "geschaffte Lektion bietet „Nochmal üben (gratis)“");
  await page.click('.lp-pop [data-lp="redo"]');
  await page.waitForSelector(".lp-player .lp-ex");
  ok(/gratis/.test(await page.textContent(".lp-penergy")) && await page.isVisible(".lp-score"), "Wiederholen als Üben: gratis, mit Punktestand");
  const redo = await playToEnd(page);
  await page.waitForSelector(".lp-end");
  ok(redo.oks.length === 10 && (await lpDoc(page, "me")).energy.n === en1, "10 Fragen geübt – Energie unverändert");
  await page.click('[data-p="done"]');
  // 📒 Guide
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.lp-banner [data-lp="guide"]');
  await page.waitForSelector(".lp-guide .lp-gkana");
  ok((await page.$$(".lp-gkana span")).length >= 5 && /Lektionen/.test(await page.textContent(".lp-guide")), "📒 Guide: Zeichen der Einheit + Lektionen");
  await shot(page, "lp-jp-guide-390-light.png");
  await page.keyboard.press("Escape");
  ok(!(await page.$(".lp-guide")), "Guide schließt mit Esc");

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

  // 🔋 Energie leer mitten in der Lektion → freundlicher Hinweis (Funki) + Üben/Auffüllen/Später
  await setMe(page, { energy: { n: 5, at: Date.now(), day: todayKey() } });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok((await chip(page)).startsWith("🔋20%"), "Kopfzeile: 🔋 20 % (5/25)");
  await page.click(".lp-node.is-current");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  ok(true, "mit 5 🔋 lässt sich eine Lektion starten");
  await answer(page, { wrong: true });
  ok((await pen(page)).startsWith("🔋12%"), "falsche Antwort kostet 2 🔋 (5 → 3 = 12 %)");
  await page.click(".lp-cont");
  await answer(page, { wrong: true });
  await page.click(".lp-cont");
  ok(!(await page.$(".lp-out")), "mit 1 🔋 geht die Lektion weiter (Schwelle nur beim Start)");
  await answer(page, { wrong: true });
  ok((await pen(page)).startsWith("🔋0%"), "Energie aufgebraucht (0 %)");
  await page.click(".lp-cont");
  await page.waitForSelector(".lp-out");
  const outTxt = await page.textContent(".lp-out");
  ok(/Keine Energie mehr/.test(outTxt) && await page.$(".lp-out .lp-mascot-calm"), "0 🔋 → „Keine Energie mehr“ mit Funki");
  ok(/Üben \(gratis, lädt Energie\)/.test(outTxt) && /Auffüllen · 300 💎/.test(outTxt) && /Später weiter/.test(outTxt), "Knöpfe: 🏋️ Üben (gratis) · 🔋 Auffüllen 300 💎 · Später weiter");
  ok(/Jetzt auffüllen \(gratis\) · 1× täglich/.test(outTxt) && /Energie-Modus/.test(outTxt), "„🔋 Jetzt auffüllen (gratis) · 1× täglich“ + Tipp Energie-Modus");
  await shot(page, "lp-jp-energy-out-390-light.png");
  await page.click('.lp-out [data-p="practice"]');
  await page.waitForSelector(".lp-player .lp-ex");
  ok(/gratis/.test(await page.textContent(".lp-penergy")), "Üben kostet keine Energie (gratis)");
  await shot(page, "lp-jp-practice-390-light.png");
  const pr = await playToEnd(page, { wrongAt: [1] });
  await page.waitForSelector(".lp-end");
  const gain = Math.min(5, pr.oks.filter(Boolean).length);
  ok(/Fein geübt/.test(await page.textContent(".lp-end")) && new RegExp(`🔋 \\+${gain} Energie`).test(await page.textContent(".lp-end")), `Üben fertig: 🔋 +${gain}`);
  await page.click('[data-p="done"]');
  me = await lpDoc(page, "me");
  ok(me.energy.n === gain && gain === 5, "Üben lädt +1 je richtiger Antwort, höchstens +5 (0 → 5)");
  // Start-Schwelle + Auffüllen mit 💎
  await setMe(page, { gems: 320, energy: { n: 3, at: Date.now(), day: todayKey() } });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  ok(/\+1 in/.test(await chipTitle(page)) && await page.$(".lp-energy.low") && (await chip(page)).startsWith("🔋12%"), "unter 5 🔋: Chip markiert (12 %) + „+1 in … min“");
  await page.click(".lp-node.is-current");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-out");
  ok(/Zu wenig Energie/.test(await page.textContent(".lp-out")) && /mindestens 5/.test(await page.textContent(".lp-out")), "Start erst ab 5 🔋 → „Zu wenig Energie“");
  await page.click('.lp-out [data-p="buy"]');
  await page.waitForSelector(".lp-player", { state: "detached" });
  me = await lpDoc(page, "me");
  ok(me.energy.n === 25 && me.gems === 20, "🔋 Auffüllen: 300 💎 → voll");
  ok((await chip(page)).startsWith("🔋100%"), "Kopfzeile wieder 🔋 100 %");
  // 🌅 Neuer Tag → gratis voll
  await setMe(page, { energy: { n: 2, at: Date.now() - 3600e3, day: "2026-01-01" } });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.waitForTimeout(300);
  me = await lpDoc(page, "me");
  ok((await chip(page)).startsWith("🔋100%") && me.energy.n === 25 && me.energy.day === todayKey(), "erster Besuch an einem neuen Tag: Energie gratis voll");
  ok(/Neuer Tag/.test(await page.evaluate(() => document.body.innerText)), "Hinweis „🌅 Neuer Tag – Energie wieder voll“");
  // 🔋 Energie-Modus + „Jetzt auffüllen (gratis)“ (1× täglich im Modus Normal)
  await setMe(page, { energy: { n: 3, at: Date.now(), day: todayKey() }, freeRefillDay: null });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.click('[data-lp="side"]');
  await page.waitForSelector(".lp-side .lp-emode");
  ok((await page.$$(".lp-modebtn")).length === 3 && await page.getAttribute('.lp-modebtn[data-mode="normal"]', "aria-checked") === "true", "📊: 🔋 Energie-Modus Normal / Entspannt / Unbegrenzt (Standard Normal)");
  await page.click(".lp-faq summary");
  const faq = await page.textContent(".lp-faq");
  ok(/Verliert man wirklich Energie/.test(faq) && /Entspannt/.test(faq) && /Unbegrenzt/.test(faq) && /nie Energie/.test(faq), "❓ „Verliert man wirklich Energie?“ erklärt die Modi");
  ok(/1× täglich gratis auffüllen/.test(await page.textContent('[data-lp="free-refill"]')) && !(await page.isDisabled('[data-lp="free-refill"]')), "„🔋 Jetzt auffüllen (gratis)“ – 1× täglich");
  await page.evaluate(() => document.querySelector(".lp-emode").scrollIntoView({ block: "start" }));
  await shot(page, "lp-jp-energy-mode-390-light.png");
  await page.click('[data-lp="free-refill"]');
  await page.waitForTimeout(250);
  me = await lpDoc(page, "me");
  ok(me.energy.n === 25 && me.freeRefillDay === todayKey(), "gratis aufgefüllt (3 → 25), Tag gemerkt");
  await setMe(page, { energy: { n: 3, at: Date.now(), day: todayKey() } });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.click('[data-lp="side"]');
  ok(await page.isDisabled('[data-lp="free-refill"]') && /heute schon genutzt/.test(await page.textContent('[data-lp="free-refill"]')), "Normal: zweites Gratis-Auffüllen am selben Tag gesperrt");
  await page.click('.lp-node.is-current');
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-out");
  ok(!(await page.$('.lp-out [data-p="free"]')), "„Keine Energie“: kein Gratis-Knopf mehr (heute schon genutzt)");
  await page.click('.lp-out [data-p="close"]');
  // ♾️ Unbegrenzt
  if (!(await page.isVisible('.lp-modebtn[data-mode="unbegrenzt"]'))) await page.click('[data-lp="side"]');
  await page.click('.lp-modebtn[data-mode="unbegrenzt"]');
  await page.waitForTimeout(250);
  ok((await chip(page)) === "🔋∞" && (await lpDoc(page, "me")).energyMode === "unbegrenzt", "Unbegrenzt: Chip zeigt 🔋 ∞");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "lp-jp-header-unlimited-390-light.png");
  if (!(await page.$('.lp-pop [data-lp="start"]'))) await page.click(".lp-node.is-current");
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-player .lp-ex");
  ok(/∞/.test(await page.textContent(".lp-penergy")), "mit 3 🔋 startet die Lektion trotzdem (∞)");
  for (let k = 0; k < 4; k++) { await answer(page, { wrong: k % 2 === 0 }); await page.click(".lp-cont"); }
  ok(!(await page.$(".lp-out")) && (await lpDoc(page, "me")).energy.n === 3, "Unbegrenzt: Antworten & Fehler kosten nichts, nie „Keine Energie“");
  await page.keyboard.press("Escape");
  if (!(await page.isVisible('.lp-modebtn[data-mode="normal"]'))) await page.click('[data-lp="side"]');
  await page.click('.lp-modebtn[data-mode="entspannt"]');
  await page.waitForTimeout(200);
  ok(!(await page.isDisabled('[data-lp="free-refill"]')) && /jederzeit/.test(await page.textContent('[data-lp="free-refill"]')), "Entspannt: Gratis-Auffüllen jederzeit");
  await page.click('.lp-modebtn[data-mode="normal"]');
  await page.waitForTimeout(200);
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
  ok((await page.$$(".lap-tab")).length === 7, "alle bisherigen LAP-Reiter bleiben (7 inkl. Lernpfad und 🏋️ Üben)");
  await page.click('.lap-yearbar [data-year="1"]');
  await page.waitForTimeout(200);
  const lu = await page.textContent(".lp-unit .lp-uhead");
  ok(/Einheit 1/.test(lu) && /Grundlagen/.test(lu), "1. Lehrjahr: Einheit 1 · Grundlagen");
  ok((await page.$$(".lp-seg")).length === 1, "nur das gewählte Lehrjahr");
  ok((await page.$$('.lp-node[aria-label*="Rechnen"]')).length >= 1, "Rechen-Lektionen eingeflochten");
  await page.click('.lp-goalbtn[data-goal="leicht"]');
  await page.waitForTimeout(150);
  // Ganz neu (noch nichts gelernt/falsch): „Üben“ darf nie ins Leere laufen – wärmt mit der aktuellen Lektion auf
  await page.click('.lp-practice [data-lp="practice"]');
  await page.waitForSelector(".lp-player .lp-ex", { timeout: 4000 });
  ok(/gratis/.test(await page.textContent(".lp-penergy")), "Neu-Start: „Üben“ öffnet trotzdem (Aufwärmen, gratis)");
  await page.click('.lp-player [data-p="quit"]');
  await page.waitForTimeout(250);
  if (await page.$(".lp-player")) { const q = await page.$('.lp-player [data-p="quit-yes"], .lp-player [data-p="leave"]'); if (q) await q.click(); }
  await page.waitForSelector(".lp-player", { state: "detached", timeout: 4000 }).catch(() => {});
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
  ok(lap.nodes["lap-y1-grund-1-1"] && me.energy.n === expectEnergy(25, lapRes.oks), `LAP-Lektion geschafft, 🔋 ${me.energy.n} (${lapRes.oks.length} Antworten, 1 Fehler)`);
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
      localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 420, freezes: 0, frozen: {}, ach: {}, ok: 0, lessons: 0, perfect: 0 }]));
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
  await page.evaluate(() => { localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "ernst", gems: 0, hearts: { n: 0, at: Date.now() }, ach: {} }])); });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  ok((await chip(page)).startsWith("🔋100%"), "Umstieg: alte ❤️ Herzen (0) → 🔋 100 % Energie");
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
  await page.click('[data-p="done"]');
  ok(!(await lpDoc(page, "me")).hearts, "Umstieg: hearts-Feld ist weg");
  await setMe(page, { energy: { n: 0, at: Date.now() - 10 * 60e3, day: todayKey() } });
  await page.reload();
  await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  ok(/\+1 in (20|21) min/.test(await chipTitle(page)) && (await chip(page)).startsWith("🔋0%"), "🔋 0 % · „+1 in 20 min“ im Tooltip");
  await shot(page, "lp-jp-path-low-390-dark.png");
  await page.click('[data-node="jp-w0-2"]');
  await page.click('.lp-pop [data-lp="start"]');
  await page.waitForSelector(".lp-out");
  await shot(page, "lp-jp-energy-out-390-dark.png");
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
      localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 0, ach: { first: 1 } }, { id: "jp", nodes, xp: {} }]));
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
    localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 420, energy: { n: 8, at: Date.now(), day: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() }, freezes: 0, frozen: {}, ach: { first: 1 }, ok: 12, lessons: 1 }]));
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
  ok(await page.isDisabled('[data-lp="buy-energy"]') && /300 💎/.test(await page.textContent('[data-lp="buy-energy"]')), "🔋 Energie auffüllen braucht 300 💎 (220 reichen nicht)");
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

  /* ================= 🏋️ Üben-Reiter (JP hell, LAP dunkel): gesperrte Einheit, 10 Fragen, keine Energie, Fehler nochmal ================= */
  for (const [scheme, modName, tabCls] of [["light", "japanisch", "jp"], ["dark", "lap", "lap"]]) {
    ({ ctx, page } = await newPage(scheme));
    await page.evaluate(() => { localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 0, energy: { n: 7, at: Date.now(), day: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() }, ach: { first: 1 } }])); });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate((m) => { location.hash = "#alltag/" + m; }, modName);
    await page.waitForSelector(`.${tabCls}-tab[data-tab="ueben"]`, { timeout: 8000 });
    await page.click(`.${tabCls}-tab[data-tab="ueben"]`);
    await page.waitForSelector(".lp-train .lp-srcs");
    ok(await page.isHidden(`.${tabCls}-head`) && await page.isVisible(".lp-train .lp-top"), `${modName}: 🏋️ Üben-Reiter mit eigener Kopfzeile`);
    ok((await page.$$(".lp-srcbtn")).length === 5 && (await page.$$(".lp-lenbtn")).length === 4, "Quellen: Alles · Einheit · Thema · Meine Fehler · Zufall – Länge 10 / 20 / 50 / ∞");
    await page.click('[data-tr-src="topic"]');
    ok((await page.$$(".lp-tchip")).length >= 5, "Themen-Auswahl");
    await page.click('[data-tr-src="unit"]');
    const lockedN = (await page.$$(".lp-uitem.is-locked")).length;
    ok(lockedN >= 3 && /0 %/.test(await page.textContent(".lp-uitem.is-locked")), `Einheiten-Liste inkl. gesperrter (${lockedN}) mit Fortschritt in %`);
    const lockedId = await page.evaluate(() => [...document.querySelectorAll(".lp-uitem.is-locked")][2].dataset.trUnit);
    await page.click(`[data-tr-unit="${lockedId}"]`);
    await page.click('[data-tr-len="10"]');
    ok(await page.getAttribute(`[data-tr-unit="${lockedId}"]`, "aria-checked") === "true", "gesperrte Einheit gewählt");
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, `lp-${tabCls}-ueben-tab-390-${scheme}.png`);
    await page.evaluate(() => document.querySelector(".lp-trgo").scrollIntoView({ block: "end" }));
    await shot(page, `lp-${tabCls}-ueben-tab-units-390-${scheme}.png`);
    const before = await lpDoc(page, "me");
    await page.click('[data-tr="go"]');
    await page.waitForSelector(".lp-player .lp-ex");
    ok(/gratis/.test(await page.textContent(".lp-penergy")) && /0\/10/.test(await page.textContent(".lp-score")), "Player im Übe-Modus: gratis, Punktestand 0/10");
    const res = await playToEnd(page, { wrongAt: [1, 4], shots: { exercise: async () => {}, feedback: async () => {} } });
    await page.waitForSelector(".lp-end");
    ok(res.oks.length === 10, `10 Fragen beantwortet (${res.types.join(",")})`);
    const endT = await page.textContent(".lp-end");
    ok(/8 von 10/.test(endT) && /80 %/.test(endT) && /Keine Energie verbraucht/.test(endT), "Ergebnis: 8 von 10 · 80 % · keine Energie");
    await shot(page, `lp-${tabCls}-ueben-end-390-${scheme}.png`);
    let after = await lpDoc(page, "me");
    ok(after.energy.n === before.energy.n && after.train && after.train.xp === 8, `Energie unverändert (${after.energy.n}), +8 Übe-XP`);
    const modDoc = await lpDoc(page, tabCls);
    ok(modDoc && Object.keys(modDoc.nodes || {}).length === 0 && Object.values(modDoc.xp)[0] === 8, "kein Pfad-Fortschritt, XP zählen fürs Tagesziel");
    const srs = await page.evaluate((k) => JSON.parse(localStorage.getItem(`sk-a-${k}_cards`) || "[]"), tabCls);
    ok(srs.length >= 3 && srs.some((c) => c.lapses >= 1), "Ergebnisse landen im SRS (Lernkarten profitieren)");
    ok(/Fehler nochmal üben \(2\)/.test(await page.textContent(".lp-retry")), "„🔁 Fehler nochmal üben (2)“");
    await page.click(".lp-retry");
    await page.waitForSelector(".lp-player .lp-ex");
    if (scheme === "light") await shot(page, `lp-${tabCls}-ueben-player-390-${scheme}.png`);
    const rr = await playToEnd(page);
    await page.waitForSelector(".lp-end");
    ok(rr.oks.length === 2 && /2 von 2/.test(await page.textContent(".lp-end")) && !(await page.$(".lp-retry")), "Fehler nochmal: genau die 2 falschen, jetzt alles richtig");
    await page.click('[data-p="done"]');
    await page.waitForSelector(".lp-player", { state: "detached" });
    ok(await page.isVisible(".lp-train .lp-srcs"), "FERTIG → zurück zum Üben-Reiter");
    // ∞ endlos (bis „Fertig“)
    await page.click('[data-tr-src="all"]');
    await page.click('[data-tr-len="0"]');
    await page.click('[data-tr="go"]');
    await page.waitForSelector(".lp-player .lp-ex");
    if (scheme === "dark") await shot(page, `lp-${tabCls}-ueben-player-390-${scheme}.png`);
    for (let k = 0; k < 13; k++) { await answer(page); await page.click(".lp-cont"); }
    ok(await page.$(".lp-player .lp-ex") && /13 · ∞/.test(await page.textContent(".lp-score")), "endlos: nach 13 Fragen geht's weiter (∞)");
    await page.click('.lp-stop[data-p="quit"]');
    await page.waitForSelector(".lp-end");
    ok(/13 von 13/.test(await page.textContent(".lp-end")), "„Fertig“ beendet und zeigt das Ergebnis");
    await page.click('[data-p="done"]');
    after = await lpDoc(page, "me");
    ok(after.energy.n === before.energy.n && after.train.xp === 8 + 2 + 13, "endlos: weiterhin keine Energie, XP +1 je richtig");
    await ctx.close();
  }

  /* ================= Neuer Pfad-Look: Screenshots 390 hell/dunkel + 1440, Banner wechselt beim Scrollen ================= */
  for (const [scheme, w, h, modName] of [["light", 390, 844, "japanisch"], ["dark", 390, 844, "japanisch"], ["dark", 390, 844, "lap"], ["light", 1440, 900, "lap"]]) {
    ({ ctx, page } = await newPage(scheme, { width: w, height: h }));
    await page.evaluate(() => { localStorage.setItem("sk-a-learn_progress", JSON.stringify([{ id: "me", goal: "normal", gems: 85, energy: { n: 19, at: Date.now(), day: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() }, ach: { first: 1 } }, { id: "jp", nodes: { "jp-hira-b1-1": { c: 2, n: 2, at: 1 }, "jp-hira-b1-2": { c: 1, n: 1, at: 1 } }, xp: {} }])); });
    await page.reload(); await page.waitForTimeout(300);
    await page.evaluate((m) => { location.hash = "#alltag/" + m; }, modName);
    await page.waitForSelector(".lp-path .lp-node", { timeout: 8000 });
    await page.waitForFunction(() => { const l = document.getElementById("lp-css"); return l && l.sheet; });
    await page.waitForTimeout(700);
    ok((await chip(page)).startsWith("🔋76%") && /19\/25/.test(await chip(page)), `${modName} ${w} ${scheme}: Kopfzeile 🔋 76 % (19/25)`);
    ok(await page.$(".lp-nring") && await page.$(".lp-art .lp-mascot") && await page.$(".lp-stars"), "aktueller Knoten mit Fortschrittsring, Funki-Deko, Sternchen");
    await shot(page, `lp-${modName}-path-new-${w}-${scheme}.png`);
    const b1 = await page.getAttribute(".lp-banner", "data-unit");
    await page.evaluate(() => { const u = document.querySelectorAll(".lp-unit")[3]; window.scrollTo(0, u.getBoundingClientRect().top + window.scrollY - 120); });
    await page.waitForTimeout(500);
    const b2 = await page.getAttribute(".lp-banner", "data-unit");
    ok(b1 !== b2 && await page.evaluate(() => { const r = document.querySelector(".lp-banner").getBoundingClientRect(); return r.top >= 0 && r.top < 130; }), `Banner bleibt oben kleben und wechselt die Einheit (${b1} → ${b2})`);
    await shot(page, `lp-${modName}-path-new-scrolled-${w}-${scheme}.png`);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `kein waagrechtes Scrollen (${sw}px)`);
    await ctx.close();
  }

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
