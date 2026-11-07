// Playwright-Test für Alltag › 🇯🇵 Japanisch (lokaler Modus).
//   cd <worktree> && python3 -m http.server 8937 &   then   node tests/japanisch-e2e.cjs [screenshot-dir]
// speechSynthesis / SpeechRecognition werden in addInitScript durch steuerbare Attrappen ersetzt,
// /chat per page.route gestubbt (Test-Haken window.__skAiTest aus ai-client.js, nur localhost).
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8937/";
const OUT = process.argv[2] || require("os").tmpdir();

function fakes(opts) {
  window.__skAiTest = { token: "test" };
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  if (opts.sr) {
    const sr = (window.__sr = { instances: [] });
    class FakeSR {
      constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this.running = false; sr.instances.push(this); }
      start() { this.running = true; setTimeout(() => this.onstart && this.onstart(), 5); }
      stop() { if (this.running) setTimeout(() => this._end(), 5); }
      abort() { this.stop(); }
      _end() { if (!this.running) return; this.running = false; this.onend && this.onend(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    sr.cur = () => sr.instances.filter((i) => i.running).pop();
    sr.say = (alts) => {
      const r = sr.cur(); if (!r) return false;
      const interim = [{ transcript: alts[0].slice(0, 1) }]; interim.isFinal = false;
      r.onresult && r.onresult({ resultIndex: 0, results: [interim] });
      const fin = alts.map((t) => ({ transcript: t, confidence: 0.9 })); fin.isFinal = true;
      r.onresult && r.onresult({ resultIndex: 0, results: [fin] });
      return true;
    };
    sr.silence = () => { const r = sr.cur(); if (!r) return false; r.onerror && r.onerror({ error: "no-speech" }); r._end(); return true; };
  } else {
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  }
  const VOICES = opts.ja
    ? [{ name: "Google Deutsch", lang: "de-DE" }, { name: "Google 日本語", lang: "ja-JP" }]
    : [{ name: "Google Deutsch", lang: "de-DE" }];
  const tts = (window.__tts = { spoken: [] });
  const ls = {};
  const ss = {
    speaking: false, pending: false, paused: false,
    getVoices() { return VOICES; },
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    speak(u) { tts.spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice && u.voice.name }); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend({}); }, 30); },
    cancel() { this.speaking = false; },
    pause() {}, resume() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ""; this.rate = 1; this.pitch = 1; this.voice = null; } };
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const chatBodies = [];

  async function newPage(scheme, { width = 390, height = 844, sr = true, ja = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 800 });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(fakes, { sr, ja });
    // Update 10: Standard-Reiter ist jetzt 🛤️ Lernpfad (eigener Test tests/lernpfad-e2e.cjs) – hier wie bisher starten
    await ctx.addInitScript(() => { try { if (!localStorage.getItem("sk-jp-tab")) localStorage.setItem("sk-jp-tab", "kana"); } catch { /* egal */ } });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      await new Promise((r) => setTimeout(r, 120));
      const reply = body.image
        ? "Sehr schön! Dein **あ** ist gut erkennbar 👍\n- Der Bogen unten darf runder sein"
        : "こんにちは (konnichiwa)! Ich bin dein Sensei 🙂\n- **わたしは** (watashi wa) = ich";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply, actions: [], usage: { usd: 0.02, capUsd: 3 } }) });
    });
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    return { ctx, page };
  }
  const shot = async (page, name, full = false) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(OUT, name), fullPage: full }); };
  const tab = async (page, id) => { await page.click(`.jp-tab[data-tab="${id}"]`); await page.waitForTimeout(120); };
  const lsJson = (page, k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), k);
  const head = (page) => page.textContent(".jp-head");

  /* ================= hell, 390, mit Sprache ================= */
  let { ctx, page } = await newPage("light");
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="japanisch"]', { timeout: 8000 });
  ok(true, "Kachel „Japanisch“ auf der Alltag-Seite");
  await page.click('.al-tile[data-id="japanisch"]');
  await page.waitForSelector(".jp-head .jp-stat", { timeout: 8000 });
  ok(/#alltag\/japanisch$/.test(page.url()), "Route #alltag/japanisch");
  ok(await page.evaluate(() => !!document.getElementById("jp-css")), "Modul-CSS geladen");
  ok((await page.$$(".jp-tab")).length === 9, "9 Bereiche als Reiter (inkl. 🛤️ Lernpfad und 📐 Grammatik)");
  ok(await page.isHidden(".jp-voicehint"), "japanische Stimme vorhanden → kein Hinweis");

  // ---- Kana ----
  await tab(page, "kana");
  const cells = await page.$$eval(".jp-kcell[data-say]", (b) => b.map((x) => [x.dataset.say, x.querySelector("small").textContent]));
  ok(cells.length === 104, `Hiragana-Tabelle mit Dakuten und Yōon (${cells.length} Zeichen)`);
  const R = Object.fromEntries(cells);
  await page.click('.jp-kcell[data-say="あ"]');
  await page.waitForTimeout(80);
  let last = await page.evaluate(() => window.__tts.spoken.at(-1));
  ok(last && last.text === "あ" && last.lang === "ja-JP" && last.voice === "Google 日本語", "Antippen liest あ mit japanischer Stimme vor");
  await page.click('.jp-seg button[data-v="kata"]');
  ok(await page.isVisible('.jp-kcell[data-say="ア"]') && await page.isVisible('.jp-kcell[data-say="キャ"]'), "Katakana-Tabelle (ア, キャ)");
  for (const [k, r] of await page.$$eval(".jp-kcell[data-say]", (b) => b.map((x) => [x.dataset.say, x.querySelector("small").textContent]))) R[k] = r;
  await shot(page, "jp-kana-390-light.png");

  await page.click('[data-k="setup"]');
  await page.click('[data-k="norows"]');
  ok(await page.isDisabled('[data-k="start"]'), "ohne Reihen kein Start");
  await page.click('.chip[data-row="a"]'); await page.click('.chip[data-row="k"]');
  await page.click('[data-o="script"][data-v="hira"]');
  await page.click('[data-o="dir"][data-v="k2r"]');
  await page.click('[data-o="count"][data-v="10"]');
  ok((await page.textContent('[data-k="start"]')).includes("10 Zeichen"), "Auswahl: あ- und か-Reihe = 10 Zeichen");
  await page.click('[data-k="start"]');
  // erste Frage absichtlich falsch
  let prompt = (await page.textContent(".jp-qkana")).trim();
  const wrong = await page.$$eval(".jp-opt", (b, ans) => b.map((x) => x.dataset.ans).find((a) => a !== ans), R[prompt]);
  ok(Object.keys(R).includes(prompt) && (await page.$$(".jp-opt")).length === 4, `Quizfrage ${prompt} mit 4 Optionen`);
  await page.click(`.jp-opt[data-ans="${wrong}"]`);
  ok((await page.textContent(".jp-fb")).includes("❌") && await page.isVisible(".jp-opt.right"), "Falsch → ❌ + richtige Lösung markiert");
  await page.waitForTimeout(800);
  let cards = await lsJson(page, "sk-a-jp_cards");
  const missed = cards.find((c) => c.kind === "kana" && c.kana === prompt);
  ok(missed && missed.lapses === 1 && missed.reps === 0, "Fehler landet im SRS (jp_cards, lapses 1)");
  for (let i = 1; i < 10; i++) {
    await page.click('[data-k="next"]');
    prompt = (await page.textContent(".jp-qkana")).trim();
    await page.click(`.jp-opt[data-ans="${R[prompt]}"]`);
    ok(i > 1 || (await page.textContent(".jp-fb")).includes("✅"), "Richtig → ✅");
  }
  await page.click('[data-k="next"]');
  ok((await page.textContent(".jp-score")).trim() === "9/10", "Ergebnis 9/10");
  ok(await page.isVisible('[data-k="retry"]'), "„Fehler nochmal“ angeboten");
  ok((await head(page)).includes("🎯 10/20"), "Kopfzeile: 10/20 Übungen heute");
  ok((await head(page)).includes("🔥 1"), "Serie 🔥 1");
  // Tippen-Modus
  await page.click('[data-k="setup"]');
  await page.click('[data-o="dir"][data-v="k2rt"]');
  await page.click('[data-k="start"]');
  prompt = (await page.textContent(".jp-qkana")).trim();
  await page.fill(".jp-typein", R[prompt].toUpperCase());
  await page.press(".jp-typein", "Enter");
  ok((await page.textContent(".jp-fb")).includes("✅"), "Romaji tippen (Groß-/Kleinschreibung egal)");
  await page.click('[data-k="quit"]');
  // romaji → kana
  await page.click('[data-k="setup"]');
  await page.click('[data-o="dir"][data-v="r2k"]');
  await page.click('[data-k="start"]');
  const roma = (await page.textContent(".jp-qroma")).trim();
  const want = Object.keys(R).find((k) => R[k] === roma && /[぀-ゟ]/.test(k) && k.length === 1);
  await page.click(`.jp-opt[data-ans="${want}"]`);
  ok((await page.textContent(".jp-fb")).includes("✅"), `Romaji → Kana (${roma} → ${want})`);
  await page.click('[data-k="quit"]');
  await page.click('[data-k="table"]').catch(() => {});

  // ---- Vokabeln ----
  await tab(page, "vokabeln");
  ok((await page.textContent(".jp-hero")).includes("Heute fällig"), "„Heute fällig“ sichtbar");
  const fresh = Number(await page.textContent(".jp-duebig.soft b"));
  ok(fresh === 10, "10 neue Wörter pro Tag (Standard)");
  await shot(page, "jp-vocab-390-light.png");
  await page.click('[data-k="start"]');
  for (let i = 0; i < 3; i++) {
    await page.click('[data-k="flip"]');
    ok(await page.isVisible(".jp-grades") && (await page.$$(".jp-grade")).length === 4, `Karte ${i + 1} umgedreht, 4 Bewertungen`);
    if (i === 0) {
      ok((await page.textContent('.jp-grade[data-q="4"] small')).includes("1 Tag"), "Vorschau: Gut → 1 Tag");
      await shot(page, "jp-flash-390-light.png");
    }
    await page.click('.jp-grade[data-q="4"]');
  }
  // Nochmal → kommt wieder
  await page.click('[data-k="flip"]');
  await page.click('.jp-grade[data-q="1"]');
  const total = await page.textContent(".jp-flash .jp-muted");
  ok(/\/11/.test(total), "„Nochmal“ hängt die Karte hinten an (11 statt 10)");
  await page.click('[data-k="home"]');
  await page.waitForTimeout(800);
  cards = await lsJson(page, "sk-a-jp_cards");
  const v = cards.filter((c) => c.kind === "vocab");
  ok(v.length === 4 && v.filter((c) => c.reps === 1 && c.interval === 1).length === 3, "3 Wörter gelernt (Intervall 1 Tag), 1 Wort zurückgesetzt");
  ok((await head(page)).includes("🃏 3"), "Kopfzeile: 3 Wörter gelernt");
  ok(Number(await page.textContent(".jp-duebig b")) === 1, "Das „Nochmal“-Wort ist heute fällig");
  const stats = await lsJson(page, "sk-a-jp_stats");
  ok(stats && stats[0] && stats[0].days && Object.values(stats[0].days)[0].fresh === 4, "jp_stats zählt neue Wörter");
  // Tagesziel ändern
  await page.click('[data-goal="30"]');
  ok((await head(page)).includes("/30"), "Tagesziel 30 übernommen");
  // eigenes Wort
  await page.click('[data-k="add"]');
  await page.fill('.jp-addform [name="kana"]', "かなづち");
  await page.fill('.jp-addform [name="de"]', "Fäustel");
  await page.click('.jp-addform button[type="submit"]');
  await page.waitForTimeout(300);
  await page.click('[data-k="list"]');
  await page.fill(".jp-search", "fäustel");
  await page.waitForTimeout(100);
  const li = await page.textContent(".jp-list");
  ok(li.includes("かなづち") && li.includes("kanazuchi"), "Eigenes Wort gespeichert, Romaji automatisch (kanazuchi)");
  await page.click('.jp-li [data-del]'); await page.click('.jp-li [data-del]');
  await page.waitForTimeout(300);
  ok(!(await page.textContent(".jp-list")).includes("かなづち"), "Eigenes Wort gelöscht (2 Tipps)");
  await page.click('[data-k="home"]');

  // ---- Hören ----
  await tab(page, "hoeren");
  await page.click('[data-what="wort"]');
  await page.click('[data-how="waehlen"]');
  await page.waitForTimeout(400);
  let said = await page.evaluate(() => window.__tts.spoken.at(-1).text);
  const de = await page.evaluate(async (s) => { const m = await import("/js/alltag/jp-data.js"); const x = m.VOCAB.find((v) => (v.kanji || v.kana) === s); return x && x.de; }, said);
  ok(!!de, `Hören spielt automatisch ein Wort ab (${said})`);
  ok((await page.$$(".jp-opts-de .jp-opt")).length === 4, "4 Bedeutungen zur Auswahl");
  await page.click(`.jp-opt[data-ans="${de.replace(/"/g, '\\"')}"]`);
  ok((await page.textContent(".jp-fb")).includes("✅"), "richtige Bedeutung → ✅");
  await shot(page, "jp-listen-390-light.png");
  await page.$eval('[data-k="rate"]', (el) => { el.value = "0.6"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForTimeout(100);
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).rate)) === 0.6, "Tempo-Regler: 0,6×");
  await page.click('[data-k="slow"]');
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).rate)) === 0.55, "🐢 Langsam");
  await page.click('[data-how="tippen"]');
  await page.waitForTimeout(400);
  said = await page.evaluate(() => window.__tts.spoken.at(-1).text);
  const ro = await page.evaluate(async (s) => { const m = await import("/js/alltag/jp-data.js"); const x = m.VOCAB.find((v) => (v.kanji || v.kana) === s); return x && x.romaji; }, said);
  await page.fill(".jp-typein", ro.replace(/ō/g, "ou"));
  await page.press(".jp-typein", "Enter");
  ok((await page.textContent(".jp-fb")).includes("Richtig") || (await page.textContent(".jp-fb")).includes("Fast"), `Gehörtes als Romaji tippen (${ro})`);
  await page.click('[data-k="next"]');
  await page.waitForTimeout(350);
  await page.fill(".jp-typein", "xyzxyz");
  await page.press(".jp-typein", "Enter");
  ok((await page.textContent(".jp-fb")).includes("❌"), "falsch getippt → ❌ mit Auflösung");

  // ---- Sprechen ----
  await tab(page, "sprechen");
  await page.click('.jp-speak [data-what="wort"]');
  const target = (await page.textContent(".jp-target .jp-cardkana")).trim();
  ok(await page.isVisible(".jp-mic"), "Mikro-Knopf (Spracherkennung vorhanden)");
  await page.click('[data-k="play"]');
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).text)) === target, "🔊 Vorsprechen");
  await page.click(".jp-mic");
  await page.waitForSelector(".jp-listening");
  const lang = await page.evaluate(() => window.__sr.cur().lang);
  ok(lang === "ja-JP", "Erkennung mit lang ja-JP");
  await shot(page, "jp-speak-listen-390-light.png");
  await page.evaluate((t) => window.__sr.say(["ぜんぜんちがう", t + "。"]), target);
  await page.waitForSelector(".jp-fb");
  ok((await page.textContent(".jp-fb")).includes("Perfekt"), "richtige Alternative erkannt → ✅ Perfekt");
  await page.click(".jp-mic");
  await page.waitForSelector(".jp-listening");
  await page.evaluate(() => window.__sr.say(["ぜんぜんちがうことば"]));
  await page.waitForSelector(".jp-fb.no");
  const fbt = await page.textContent(".jp-fb");
  ok(fbt.includes("Noch nicht") && fbt.includes("ぜんぜんちがうことば"), "falsch → nochmal probieren + „Verstanden: …“");
  await page.click(".jp-mic");
  await page.waitForSelector(".jp-listening");
  await page.evaluate(() => window.__sr.silence());
  await page.waitForSelector(".jp-fb.no");
  ok((await page.textContent(".jp-fb")).includes("nix gehört"), "Stille → freundlicher Hinweis");
  await shot(page, "jp-speak-390-light.png");

  // ---- Schreiben ----
  await tab(page, "schreiben");
  ok(await page.isDisabled('[data-k="ai"]'), "Claude-Prüfung erst nach dem Zeichnen");
  const box = await page.$eval(".jp-canvas", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
  ok(box.w > 250 && box.w <= 380, `Schreibfeld ${Math.round(box.w)} px`);
  await page.mouse.move(box.x + box.w * 0.3, box.y + box.w * 0.3);
  await page.mouse.down();
  for (let i = 0; i <= 10; i++) await page.mouse.move(box.x + box.w * (0.3 + i * 0.04), box.y + box.w * (0.3 + i * 0.03));
  await page.mouse.up();
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.w * 0.2);
  await page.mouse.down(); await page.mouse.move(box.x + box.w * 0.5, box.y + box.w * 0.8, { steps: 8 }); await page.mouse.up();
  ok(!(await page.isDisabled('[data-k="undo"]')), "Striche gezeichnet → Zurück/Löschen aktiv");
  const n0 = chatBodies.length;
  await page.click('[data-k="ai"]');
  await page.waitForSelector(".jp-ai:not(.busy)", { timeout: 5000 });
  const wb = chatBodies[n0];
  ok(wb && wb.mode === "sensei" && wb.image && wb.image.type === "image/jpeg" && /^[A-Za-z0-9+/]+=*$/.test(wb.image.data) && wb.image.data.length > 1000, "📷 an Claude: JPEG-Base64 ohne Präfix, Modus sensei");
  ok(wb.messages.length === 1 && /„あ“/.test(wb.messages[0].content), "Anfrage nennt das Zeichen");
  ok((await page.textContent(".jp-ai")).includes("gut erkennbar") && (await page.textContent(".jp-ai")).includes("3 $"), "Feedback + Monatsverbrauch angezeigt");
  await shot(page, "jp-write-390-light.png");
  await page.click('[data-k="reveal"]');
  await page.click('[data-k="good"]');
  ok((await page.textContent(".jp-wlabel")).includes("i"), "Passt → nächstes Zeichen (い)");
  await page.click('[data-o="guide"][data-v="0"]');
  ok(!(await page.textContent(".jp-wlabel")).includes("い"), "Frei-Modus versteckt das Zeichen (nur Romaji)");

  // ---- Lesen ----
  await tab(page, "lesen");
  ok((await page.$$(".jp-rtile")).length >= 8, "Lesetexte nach Stufen");
  await page.click('.jp-rtile[data-open="r2"]');
  ok(await page.isVisible("ruby rt"), "Furigana über Kanji");
  ok(await page.isVisible(".jp-lro") && !(await page.isVisible(".jp-lde")), "Romaji an, Deutsch aus (Standard)");
  await page.click('[data-tg="de"]'); await page.click('[data-tg="furi"]');
  ok(await page.isVisible(".jp-lde") && !(await page.isVisible("ruby rt")), "Schalter Deutsch/Furigana");
  await page.click('[data-tg="furi"]');
  await page.click('.jp-line[data-line="2"]');
  await page.waitForTimeout(60);
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).text)) === "オーストリア人です。", "Satz antippen → vorlesen");
  await shot(page, "jp-read-390-light.png");
  await page.click('[data-k="done"]');
  // weitere Texte werden nachgeladen
  await page.waitForSelector('.jp-rtile[data-open="r30"]', { timeout: 5000 });
  ok((await page.$$(".jp-rtile")).length === 30, "30 Lesetexte (r11–r30 nachgeladen)");
  await page.click('.jp-rtile[data-open="r22"]');
  ok((await page.$$(".jp-line")).length === 6 && await page.isVisible("ruby rt"), "neuer Text mit Furigana");
  await page.click('[data-k="back"]');

  // ---- 📐 Grammatik ----
  await tab(page, "grammatik");
  await page.waitForSelector(".jp-glist .jp-rtile", { timeout: 5000 });
  ok((await page.$$(".jp-glist .jp-rtile")).length === 20, "Grammatik-Reiter: 20 Lektionen");
  await shot(page, "jp-grammar-list-390-light.png");
  await page.click('.jp-rtile[data-open="wo"]');
  ok(/を/.test(await page.textContent(".jp-gtitle")) && (await page.$$(".jp-gtable tr")).length >= 3, "Lektion „を“: Erklärung + Tabelle");
  await page.click('.jp-line[data-ex="0"]');
  await page.waitForTimeout(60);
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).text)) === "パンをたべます。", "Beispiel antippen → vorlesen (Kana)");
  await page.click('.jp-gquiz [data-k="quiz"]');
  for (let k = 0; k < 8; k++) {
    if (await page.$('.jp-gquiz [data-k="back"]')) break;
    const ex = await page.evaluate(async (i) => { const m = await import("/js/alltag/jp-data-grammar.js"); return m.GRAMMAR.find((g) => g.id === "wo").ex[i]; }, k);
    if (ex.t === "build") {
      const bank = await page.$$eval(".jp-gbank .jp-gtile", (b) => b.map((x) => x.textContent));
      const words = ex.src.split(/\s+/).filter((w) => w !== "/" && w !== "。");
      const used = new Set();
      for (const w of words) { const i = bank.findIndex((t, j) => t === w && !used.has(j)); used.add(i); await page.click(`.jp-gbank [data-b="${i}"]`); }
      if (k === 3) await shot(page, "jp-grammar-build-390-light.png");
    } else {
      const opts = await page.$$eval(".jp-gopt", (b) => b.map((x) => x.textContent));
      await page.click(`.jp-gopt[data-o="${opts.indexOf(ex.a)}"]`);
    }
    await page.click('.jp-gquiz [data-k="check"]');
    ok(await page.isVisible(".jp-gfb.ok"), `Mini-Quiz Aufgabe ${k + 1} (${ex.t}) richtig`);
    if (k === 0) await shot(page, "jp-grammar-lesson-390-light.png");
    await page.click('.jp-gquiz [data-k="next"]');
  }
  ok(/5 von 5 richtig/.test(await page.textContent(".jp-gquiz")), "Mini-Quiz: 5 von 5");
  await page.click('.jp-gquiz [data-k="back"]');
  ok(/1 \/ 20 geschafft/.test(await page.textContent(".jp-ghero")), "Lektion als geschafft gemerkt");

  // ---- Sensei ----
  await tab(page, "sensei");
  ok(await page.isVisible(".jp-starters"), "Sensei: Startvorschläge");
  const n1 = chatBodies.length;
  await page.click('.jp-starters .chip[data-start="0"]');
  await page.waitForSelector(".jp-msg.from-ai .jp-say-ai", { timeout: 5000 });
  const sb = chatBodies[n1];
  ok(sb.mode === "sensei" && sb.messages.length === 1 && sb.messages[0].role === "user" && !sb.image, "Chat an /chat mit mode sensei");
  ok((await page.textContent(".jp-usage")).includes("3 $"), "Monatsverbrauch angezeigt");
  await page.click(".jp-say-ai");
  ok((await page.evaluate(() => window.__tts.spoken.at(-1).text)).includes("こんにちは"), "🔊 liest nur das Japanische vor");
  await page.fill(".jp-chatin", "Wie sag ich danke?");
  await page.press(".jp-chatin", "Enter");
  await page.waitForFunction(() => document.querySelectorAll(".jp-msg.from-ai .jp-say-ai").length === 2);
  ok(chatBodies.at(-1).messages.length === 3, "Verlauf wird mitgeschickt");
  const hist = await lsJson(page, "sk-jp-sensei");
  ok(hist.length === 4, "eigener Verlauf in localStorage");
  await shot(page, "jp-sensei-390-light.png");
  // Verlauf + Reiter bleiben nach Neuladen
  await page.reload();
  await page.waitForTimeout(400);
  if (await page.isVisible("#btn-local")) await page.click("#btn-local");
  await page.evaluate(() => { location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".jp-msg.from-ai", { timeout: 8000 });
  ok((await page.$$(".jp-msg")).length === 4, "Nach Neuladen: Sensei-Reiter + Verlauf da");
  ok((await head(page)).includes("🃏 3"), "Fortschritt bleibt gespeichert");
  const csp1 = await page.evaluate(() => window.__csp);
  ok(!csp1.length, "keine CSP-Verletzungen");
  await ctx.close();

  /* ================= dunkel, 390, ohne Spracherkennung / ohne ja-Stimme ================= */
  ({ ctx, page } = await newPage("dark", { sr: false, ja: false }));
  await page.evaluate(() => { localStorage.setItem("sk-jp-tab", "kana"); location.hash = "#alltag/japanisch"; });
  await page.waitForSelector(".jp-head .jp-stat", { timeout: 8000 });
  await page.waitForSelector(".jp-voicehint:not([hidden])", { timeout: 4000 });
  ok((await page.textContent(".jp-voicehint")).includes("Japanisch"), "ohne ja-Stimme: freundlicher Hinweis");
  await shot(page, "jp-kana-390-dark.png");
  await page.click(".jp-voicehint .jp-x");
  ok(await page.isHidden(".jp-voicehint") && (await page.evaluate(() => localStorage.getItem("sk-jp-voicehint"))) === "novoice", "Hinweis ausblendbar (gemerkt)");
  await tab(page, "sprechen");
  ok(!(await page.isVisible(".jp-mic")) && await page.isVisible(".jp-hint"), "ohne Spracherkennung: kein Mikro, Hinweis + Selbst-Check");
  await page.click('[data-k="self"]');
  ok((await head(page)).includes("🎯 1/"), "Selbst-Check zählt");
  await shot(page, "jp-speak-390-dark.png");
  await tab(page, "vokabeln");
  await page.click('[data-k="start"]'); await page.click('[data-k="flip"]');
  await shot(page, "jp-flash-390-dark.png");
  await tab(page, "schreiben");
  await shot(page, "jp-write-390-dark.png");
  await tab(page, "lesen");
  await page.click('.jp-rtile[data-open="r6"]');
  await shot(page, "jp-read-390-dark.png");
  await tab(page, "sensei");
  await shot(page, "jp-sensei-390-dark.png");
  await tab(page, "grammatik");
  await page.waitForSelector(".jp-glist .jp-rtile", { timeout: 5000 });
  await page.click('.jp-rtile[data-open="iadj"]');
  await page.click('.jp-gquiz [data-k="quiz"]');
  await page.click('.jp-gopt[data-o="0"]');
  await page.click('.jp-gquiz [data-k="check"]');
  await shot(page, "jp-grammar-quiz-390-dark.png", true);
  ok(await page.isVisible(".jp-gfb"), "dunkel: Grammatik-Quiz mit Rückmeldung");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, `kein waagrechtes Scrollen (${sw})`);
  await ctx.close();

  /* ================= 1440 hell + dunkel ================= */
  for (const scheme of ["light", "dark"]) {
    ({ ctx, page } = await newPage(scheme, { width: 1440, height: 900 }));
    await page.evaluate(() => { localStorage.setItem("sk-jp-tab", "kana"); location.hash = "#alltag/japanisch"; });
    await page.waitForSelector(".jp-head .jp-stat", { timeout: 8000 });
    await shot(page, `jp-kana-1440-${scheme}.png`);
    await tab(page, "hoeren");
    await shot(page, `jp-listen-1440-${scheme}.png`);
    await tab(page, "grammatik");
    await page.waitForSelector(".jp-glist .jp-rtile", { timeout: 5000 });
    await page.click('.jp-rtile[data-open="te"]');
    await shot(page, `jp-grammar-1440-${scheme}.png`, true);
    await ctx.close();
  }

  await browser.close();
  const bad = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  ok(!bad.length, "keine Konsolenfehler" + (bad.length ? ": " + bad.join(" | ") : ""));
  console.log("\nAlles grün ✅");
})().catch((e) => { console.error(e); process.exit(1); });
