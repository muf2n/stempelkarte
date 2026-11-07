// Playwright-Test für den Sprachmodus des Claude-Assistenten (Alltag › Claude-Assistent), lokaler Modus.
//   cd <worktree> && python3 -m http.server 8851 &   then   node tests/voice-e2e.cjs [screenshot-dir]
// Test-Haken (nur localhost): window.__skAiTest (ai-client.js) umgeht die Sperre im lokalen Modus, /chat wird per page.route gestubbt;
// window.__aiTest verkürzt die Wartezeiten des Sprachmodus.
// speechSynthesis und webkitSpeechRecognition werden in addInitScript durch steuerbare Attrappen ersetzt.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8851/";
const OUT = process.argv[2] || require("os").tmpdir();

function fakes() {
  window.__skAiTest = { token: "test" };
  window.__aiTest = { gapMs: 40, earlyMs: 400, wakeWaitMs: 300, wakeBackoffMs: 120 };
  // ---- Spracherkennung ----
  const sr = (window.__sr = { instances: [], overlap: 0, earlyEnd: 0 });
  class FakeSR {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = ""; this.running = false; sr.instances.push(this); }
    start() {
      if (this.running) throw new Error("InvalidStateError");
      if (sr.instances.some((i) => i !== this && i.running)) sr.overlap++;
      if (window.speechSynthesis.speaking) window.__tts.overlap++;
      this.running = true; this.startedAt = Date.now();
      setTimeout(() => this.running && this.onstart && this.onstart(), 10);
      if (!this.continuous && sr.earlyEnd > 0) { sr.earlyEnd--; this.early = true; setTimeout(() => this._end(), 30); }
    }
    stop() { if (this.running) setTimeout(() => this._end(), 10); }
    abort() { if (this.running) setTimeout(() => { this.onerror && this.onerror({ error: "aborted" }); this._end(); }, 5); }
    _end() { if (!this.running) return; this.running = false; this.onend && this.onend(); }
    _result(text, final) {
      const r = [{ transcript: text, confidence: 0.9 }]; r.isFinal = final;
      this.onresult && this.onresult({ resultIndex: 0, results: [r] });
    }
  }
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechRecognition = FakeSR;
  sr.conv = () => sr.instances.filter((i) => i.running && !i.continuous).pop();
  sr.wake = () => sr.instances.filter((i) => i.running && i.continuous).pop();
  sr.say = (text) => { const r = sr.conv(); if (!r) return false; r._result(text.slice(0, 5), false); r._result(text, true); return true; };
  sr.silence = () => { const r = sr.conv(); if (!r) return false; r.onerror && r.onerror({ error: "no-speech" }); r._end(); return true; };
  sr.wakeSay = (text, final) => { const r = sr.wake(); if (!r) return false; r._result(text, final); return true; };

  // ---- Sprachausgabe ----
  const VOICES = [
    { name: "Samantha", lang: "en-US", voiceURI: "Samantha", localService: true },
    { name: "Microsoft Hedda", lang: "de-DE", voiceURI: "Hedda", localService: true },
    { name: "Google Deutsch", lang: "de-DE", voiceURI: "Google Deutsch", localService: false },
    { name: "Microsoft Katja Online (Natural) - German (Germany)", lang: "de-DE", voiceURI: "Katja", localService: false },
  ];
  const tts = (window.__tts = { spoken: [], hold: false, cur: null, cancels: 0, overlap: 0, dur: 80, ready: false });
  const ls = {};
  const ss = {
    speaking: false, pending: false, paused: false,
    getVoices() { return tts.ready ? VOICES : []; },
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    speak(u) {
      if (sr.instances.some((i) => i.running)) tts.overlap++;
      tts.spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate, pitch: u.pitch, lang: u.lang });
      this.speaking = true; tts.cur = u;
      setTimeout(() => u.onstart && u.onstart({}), 5);
      if (!tts.hold) setTimeout(() => tts.finish(u), tts.dur);
    },
    cancel() { const u = tts.cur; tts.cur = null; this.speaking = false; tts.cancels++; if (u) u.onerror && u.onerror({ error: "interrupted" }); },
    pause() {}, resume() {},
  };
  tts.finish = (u = tts.cur) => { if (u && tts.cur === u) { tts.cur = null; ss.speaking = false; u.onend && u.onend({}); } };
  setTimeout(() => { tts.ready = true; (ls.voiceschanged || []).forEach((f) => f()); }, 300);
  Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ""; this.rate = 1; this.pitch = 1; this.voice = null; } };
  // Sichtbarkeit steuerbar
  window.__vis = "visible";
  Object.defineProperty(Document.prototype, "visibilityState", { get() { return window.__vis; }, configurable: true });
}

function noSpeech() {
  window.__skAiTest = { token: "test" };
  delete window.webkitSpeechRecognition; delete window.SpeechRecognition;
  Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true });
  window.SpeechSynthesisUtterance = undefined;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };
  const chatBodies = [];
  let chatDelay = 150;
  let holdChat = null;

  async function newPage(scheme, init = fakes) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true });
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      return route.abort();
    });
    await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await page.route("**/chat", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      chatBodies.push(body);
      const q = body.messages[body.messages.length - 1].content;
      if (holdChat) await holdChat;
      await new Promise((r) => setTimeout(r, chatDelay));
      let reply = `Antwort auf: ${q}`;
      if (/Überstunden/.test(q)) reply = "Du hast **4:30 h** Überstunden.\n- Montag: 1:00 h\n- Dienstag: 12,50 €";
      if (/spät/.test(q)) reply = "Es ist 14:05 Uhr.";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply, actions: [], usage: { usd: 0.01, capUsd: 3 } }) });
    });
    await page.goto(BASE);
    await page.click("#btn-local");
    await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = "#alltag/claude"; });
    await page.waitForSelector(".ai-voicebar", { timeout: 8000 });
    return { ctx, page };
  }
  const st = (page) => page.evaluate(() => { const v = document.querySelector(".vc"); return v ? v.dataset.state : "none"; });
  const waitState = (page, s, timeout = 4000) => page.waitForFunction((s) => { const v = document.querySelector(".vc"); return (v ? v.dataset.state : "none") === s; }, s, { timeout });
  const waitTalking = (page) => page.waitForFunction(() => !!window.__tts.cur, null, { timeout: 4000 });
  const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name) }); };

  /* ================= hell ================= */
  let { ctx, page } = await newPage("light");
  ok(await page.isVisible(".ai-talk"), "Knopf „Sprechen“ sichtbar (lokaler Modus mit Test-Haken)");
  ok(!(await page.isVisible(".ai-wake")), "Weckwort-Anzeige anfangs aus");
  ok(await page.evaluate(() => window.__sr.instances.length === 0), "kein Mikrofon ohne Tipp");
  await shot(page, "voice-chat-390-light.png");

  // --- Gesprächsschleife ---
  await page.click(".ai-talk");
  await waitState(page, "listen");
  const inst = await page.evaluate(() => { const r = window.__sr.conv(); return { lang: r.lang, cont: r.continuous, interim: r.interimResults }; });
  ok(inst.lang === "de-AT" && !inst.cont && inst.interim, "Erkennung: de-AT, eine Äußerung, Zwischenergebnisse");
  ok((await page.textContent(".vc-status")).includes("Hört zu"), "Status „Hört zu …“");
  await shot(page, "voice-listen-390-light.png");

  holdChat = new Promise((r) => (page.__release = r));
  await page.evaluate(() => window.__sr.say("Wie viele Überstunden hab ich?"));
  await waitState(page, "think");
  ok((await page.textContent(".vc-status")).includes("Denkt nach"), "Status „Denkt nach …“");
  ok((await page.textContent(".vc-you")).includes("Wie viele Überstunden hab ich?"), "Live-Mitschrift sichtbar");
  ok(await page.evaluate(() => !window.__sr.instances.some((i) => i.running)), "Mikrofon während des Denkens zu");
  await shot(page, "voice-think-390-light.png");
  await page.evaluate(() => { window.__tts.hold = true; });
  page.__release(); holdChat = null;
  await waitState(page, "speak");
  await waitTalking(page);
  const b0 = chatBodies[chatBodies.length - 1];
  ok(b0.mode === "voice" && b0.short === true, "/chat bekommt mode:\"voice\" und short:true");
  const sp = await page.evaluate(() => window.__tts.spoken.slice(-3));
  const said = sp.map((x) => x.text).join(" ");
  ok(said.includes("Du hast 4 Stunden 30 Minuten Überstunden.") && said.includes("Montag: 1 Stunde.") && said.includes("12 Euro 50") && !/[*\-]\s/.test(said), "vorgelesen ohne Markdown, Zahlen ausgeschrieben: " + said);
  ok(sp[0].voice && sp[0].voice.includes("Natural") && sp[0].lang === "de-DE", "beste deutsche Stimme (natürlich) automatisch gewählt");
  ok((await page.textContent(".vc-bot")).includes("4 Stunden 30 Minuten"), "Antworttext sichtbar");
  ok((await page.textContent(".vc-status")).includes("Spricht"), "Status „Spricht …“");
  ok(await page.evaluate(() => !window.__sr.conv()), "kein Zuhören während des Sprechens");
  await shot(page, "voice-speak-390-light.png");
  const nBefore = await page.evaluate(() => window.__sr.instances.length);
  await page.evaluate(() => { window.__tts.hold = false; window.__tts.finish(); });
  await waitState(page, "listen");
  ok(await page.evaluate((n) => window.__sr.instances.length > n && !!window.__sr.conv(), nBefore), "nach dem Vorlesen automatisch wieder zuhören");
  ok((await page.textContent(".ai-log")).includes("Wie viele Überstunden hab ich?"), "Gespräch landet auch im Chat-Verlauf");

  // --- Barge-in ---
  await page.evaluate(() => { window.__tts.hold = true; });
  await page.evaluate(() => window.__sr.say("Was ist ein Fehlerstromschutzschalter?"));
  await waitState(page, "speak");
  await waitTalking(page);
  const c0 = await page.evaluate(() => window.__tts.cancels);
  await page.click(".vc-orb");
  await waitState(page, "listen");
  ok(await page.evaluate((c) => window.__tts.cancels > c && !window.speechSynthesis.speaking, c0), "Barge-in: Tippen beim Sprechen bricht ab …");
  ok(await page.evaluate(() => !!window.__sr.conv()), "… und hört sofort wieder zu");
  await page.evaluate(() => { window.__tts.hold = false; });

  // --- „onend“ zu früh (Chrome Android) ---
  await page.evaluate(() => { window.__sr.earlyEnd = 2; window.__sr.conv().abort(); });
  // Abbruch von außen (ohne Ergebnis, sofort) = wie zu frühes onend → still neu starten
  await page.waitForTimeout(900);
  ok(await st(page) === "listen" && await page.evaluate(() => !!window.__sr.conv()), "zu frühes onend → still neu gestartet, weiter im Zuhören");
  await page.evaluate(() => window.__sr.say("Wie spät ist es?"));
  await waitState(page, "speak");
  await waitState(page, "listen");
  ok(await page.evaluate(() => window.__tts.spoken.some((x) => x.text === "Es ist 14 Uhr 5.")), "Uhrzeit gut vorlesbar („14 Uhr 5“)");

  // --- Stoppwort ---
  await page.evaluate(() => window.__sr.say("Danke!"));
  await waitState(page, "none");
  ok(await page.evaluate(() => window.__tts.spoken.slice(-1)[0].text === "Gern. Bis später!"), "„Danke“ beendet mit kurzer Verabschiedung");
  ok(await page.evaluate(() => !window.__sr.instances.some((i) => i.running)), "Mikrofon nach dem Ende aus");
  const nChats = chatBodies.length;

  // --- 2 stille Runden ---
  await page.click(".ai-talk");
  await waitState(page, "listen");
  await page.evaluate(() => window.__sr.silence());
  await page.waitForTimeout(300);
  ok(await st(page) === "listen", "1 stille Runde → hört weiter zu");
  await page.evaluate(() => window.__sr.silence());
  await waitState(page, "none");
  ok(chatBodies.length === nChats, "2 stille Runden → Gespräch beendet, nichts gesendet");

  // --- Tippen beim Zuhören beendet; ✕ beendet ---
  await page.click(".ai-talk");
  await waitState(page, "listen");
  await page.click(".vc-orb");
  await waitState(page, "none");
  ok(true, "Tippen auf den Orb beim Zuhören beendet");
  await page.click(".ai-talk");
  await waitState(page, "listen");
  await page.click(".vc-x");
  await waitState(page, "none");
  ok(true, "✕ beendet");
  ok(await page.evaluate(() => window.__sr.overlap === 0 && window.__tts.overlap === 0), "Erkennung und Ausgabe haben sich nie überlappt");

  // --- Einstellungen ---
  await page.click(".ai-vset");
  await page.waitForSelector(".sheet .vs");
  await page.waitForFunction(() => document.querySelectorAll(".vs-voice option").length > 1);
  const opts = await page.$$eval(".vs-voice option", (o) => o.map((x) => x.textContent));
  ok(opts.length === 4 && !opts.some((x) => /Samantha/.test(x)) && /Natural/.test(opts[1]) && /Google Deutsch/.test(opts[2]), "Stimmenliste: nur Deutsch, natürliche/Google zuerst (nach voiceschanged): " + opts.slice(1).join(" | "));
  await shot(page, "voice-settings-390-light.png");
  await page.selectOption(".vs-voice", "Google Deutsch");
  await page.$eval(".vs-rate", (el) => { el.value = "1.3"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval(".vs-pitch", (el) => { el.value = "0.8"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  ok((await page.textContent('.vs-val[data-for="rate"]')) === "1,3×", "Tempo-Anzeige 1,3×");
  await page.click(".vs-try");
  await page.waitForTimeout(400);
  const probe = await page.evaluate(() => window.__tts.spoken.filter((x) => x.text.includes("So klinge ich")).pop());
  ok(probe && probe.voice === "Google Deutsch" && probe.rate === 1.3 && probe.pitch === 0.8 && probe.text.includes("4 Stunden 30 Minuten") && probe.text.includes("12 Euro 50"), "Probe hören mit gewählter Stimme/Tempo/Tonhöhe");
  await page.click(".vs-read");
  await page.click(".vs-short");
  ok((await page.textContent(".vs-wnote")).includes("nur, solange") && (await page.textContent(".vs-wnote")).includes("nativen App"), "ehrlicher Hinweis zum Weckwort");
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => ({ ls: JSON.parse(localStorage.getItem("stempelkarte.ai.voice")), st: JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}") }));
  ok(saved.ls.voiceURI === "Google Deutsch" && saved.ls.rate === 1.3 && saved.ls.pitch === 0.8 && saved.ls.readAloud === true && saved.ls.short === false, "Einstellungen in localStorage");
  const sv = saved.st.settings && saved.st.settings.ai && saved.st.settings.ai.voice;
  ok(sv && sv.voiceURI === "Google Deutsch" && sv.readAloud === true && sv.short === false, "Einstellungen in settings.ai.voice (store.saveSettings)");
  await page.click(".sheet .close");

  // Vorlesen im normalen Chat
  const nSp = await page.evaluate(() => window.__tts.spoken.length);
  await page.fill(".ai-in", "Wie viele Überstunden diese Woche?");
  await page.click(".ai-send");
  await page.waitForFunction((n) => window.__tts.spoken.length > n, nSp, { timeout: 4000 });
  ok(await page.evaluate(() => window.__tts.spoken.slice(-3).map((x) => x.text).join(" ").includes("4 Stunden 30 Minuten")), "„Antworten immer vorlesen“ liest auch im Chat vor");
  ok(!("mode" in chatBodies[chatBodies.length - 1]), "normaler Chat sendet kein mode");
  await page.waitForTimeout(400);

  // Gesprächsmodus mit short:false
  await page.click(".ai-talk");
  await waitState(page, "listen");
  await page.evaluate(() => window.__sr.say("Wie spät ist es?"));
  await waitState(page, "speak");
  ok(chatBodies[chatBodies.length - 1].short === false, "„Kurze Antworten“ aus → short:false");
  await page.click(".vc-x");

  // --- Weckwort ---
  await page.click(".ai-vset");
  await page.waitForSelector(".vs-wake");
  await page.click(".vs-wake"); // Tipp = Nutzer-Geste → erst jetzt Mikrofon
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const w = window.__sr.wake(); return w && w.lang === "de-AT" && w.continuous; }), "„Hey Claude“: dauerhafte Erkennung (de-AT) nach dem Schalter");
  await page.click(".sheet .close");
  await page.waitForSelector(".ai-wake:not([hidden])");
  ok((await page.textContent(".ai-wake")).includes("Hört auf „Hey Claude“"), "Anzeige „Hört auf „Hey Claude““");
  ok((await page.getAttribute(".ai-wake", "title")).includes("native"), "Tooltip erklärt die Grenzen");
  await shot(page, "voice-wake-390-light.png");
  // ohne Weckwort passiert nichts
  await page.evaluate(() => window.__sr.wakeSay("ich hab heute Claude gefragt", true));
  await page.waitForTimeout(500);
  ok(await st(page) === "none", "Satz ohne Weckwort wird ignoriert");
  // Neustart nach onend
  const wn = await page.evaluate(() => window.__sr.instances.length);
  await page.evaluate(() => window.__sr.wake()._end());
  await page.waitForFunction((n) => window.__sr.instances.length > n && !!window.__sr.wake(), wn, { timeout: 3000 });
  ok(true, "Weckwort-Erkennung startet nach onend neu");
  // Weckwort mit Frage (unscharf: „hey cloud“)
  const nb = chatBodies.length;
  await page.evaluate(() => window.__sr.wakeSay("hey cloud wie spät ist es", true));
  await page.waitForFunction(() => !!document.querySelector(".vc"), null, { timeout: 4000 });
  await page.waitForTimeout(600);
  ok(chatBodies.length > nb && chatBodies[chatBodies.length - 1].messages.slice(-1)[0].content === "Wie spät ist es" && chatBodies[chatBodies.length - 1].mode === "voice", "„hey cloud …“ startet den Gesprächsmodus mit dem Rest als Frage");
  ok(await page.evaluate(() => !window.__sr.wake()), "Weckwort-Erkennung pausiert im Gespräch");
  await waitState(page, "listen");
  await page.evaluate(() => window.__sr.say("Tschüss"));
  await waitState(page, "none");
  await page.waitForFunction(() => !!window.__sr.wake(), null, { timeout: 3000 });
  ok(true, "nach dem Gespräch hört das Weckwort wieder zu");
  // Zwischenergebnis „hallo claude“ ohne Rest → Gespräch hört zu
  await page.evaluate(() => window.__sr.wakeSay("Hallo Claude", false));
  await waitState(page, "listen");
  ok(true, "„Hallo Claude“ (Zwischenergebnis) → Gespräch startet und hört zu");
  await page.click(".vc-x");
  await page.waitForFunction(() => !!window.__sr.wake(), null, { timeout: 3000 });
  // Seite versteckt → aus, sichtbar → wieder an
  await page.evaluate(() => { window.__vis = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !window.__sr.wake() && document.querySelector(".ai-wake").hidden), "versteckt → Weckwort-Erkennung aus");
  await page.evaluate(() => { window.__vis = "visible"; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => !!window.__sr.wake(), null, { timeout: 3000 });
  ok(true, "wieder sichtbar → Weckwort-Erkennung an");

  // --- Foto an Claude ---
  {
    const zlib = require("zlib");
    const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
    const W = 600, H = 400, raw = Buffer.alloc((W * 3 + 1) * H, 0x7f);
    for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    const n0 = chatBodies.length;
    await page.setInputFiles(".ai-file", { name: "zettel.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector(".ai-att:not([hidden])");
    ok(true, "Foto angehängt → Vorschau sichtbar");
    await page.fill(".ai-in", "Was steht auf dem Zettel?");
    await page.click(".ai-send");
    for (let i = 0; i < 50 && chatBodies.length <= n0; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(400);
    const bi = chatBodies[chatBodies.length - 1];
    ok(bi.image && bi.image.type === "image/jpeg" && /^[A-Za-z0-9+/]+=*$/.test(bi.image.data) && bi.image.data.length < 900000, "/chat bekommt das verkleinerte Foto (JPEG, base64)");
    ok(bi.messages.slice(-1)[0].content === "Was steht auf dem Zettel?", "Frage zum Foto mitgeschickt");
    ok(await page.isHidden(".ai-att") && await page.isVisible(".ai-msg.me .ai-thumb"), "Vorschau weg, Mini-Foto im Verlauf");
    const hist = await page.evaluate(() => Object.keys(localStorage).filter((k) => /ai/i.test(k)).map((k) => localStorage.getItem(k).length));
    ok(Math.max(0, ...hist) < 60000, "Verlauf speichert nur ein Mini-Bild");
    await page.fill(".ai-in", "Danke");
    await page.click(".ai-send");
    await page.waitForTimeout(600);
    ok(!chatBodies[chatBodies.length - 1].image, "Nächste Frage ohne Foto");
  }

  // --- eigener Name „Jarvis“ ---
  ok(chatBodies[chatBodies.length - 1].assistantName === "Claude", "/chat bekommt assistantName (Standard „Claude“)");
  await page.click(".ai-vset");
  await page.waitForSelector(".vs-name");
  await page.fill(".vs-name", "Jarvis");
  await page.waitForTimeout(700);
  ok((await page.textContent(".vs-wlabel")).includes("„Hey Jarvis“"), "Schalter-Beschriftung nutzt den Namen");
  await page.click(".sheet .close");
  ok(await page.getAttribute(".ai-in", "placeholder") === "Frag Jarvis …", "Platzhalter „Frag Jarvis …“");
  ok((await page.textContent(".al-title")).includes("Jarvis"), "Kopfzeile zeigt den Namen");
  ok((await page.textContent(".ai-talk")).includes("Mit Jarvis sprechen") && (await page.textContent(".ai-wake")).includes("„Hey Jarvis“"), "Orb-Knopf und Weckwort-Anzeige mit Namen");
  const nm = await page.evaluate(() => ({ ls: localStorage.getItem("stempelkarte.ai.name"), st: (JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}").settings || {}).ai }));
  ok(nm.ls === "Jarvis" && nm.st && nm.st.name === "Jarvis" && nm.st.voice && nm.st.voice.voiceURI === "Google Deutsch", "Name in localStorage und settings.ai.name (Stimme bleibt erhalten)");
  await shot(page, "voice-name-390-light.png");
  const nj = chatBodies.length;
  await page.evaluate(() => window.__sr.wakeSay("hey claude wie spät", true));
  await page.waitForTimeout(600);
  ok(await st(page) === "none" && chatBodies.length === nj, "„Hey Claude“ reagiert nicht mehr");
  await page.evaluate(() => window.__sr.wakeSay("hey jarvis wie spät ist es", true));
  await page.waitForFunction(() => !!document.querySelector(".vc"), null, { timeout: 4000 });
  await page.waitForTimeout(600);
  const bj = chatBodies[chatBodies.length - 1];
  ok(bj.assistantName === "Jarvis" && bj.mode === "voice" && bj.messages.slice(-1)[0].content === "Wie spät ist es", "„Hey Jarvis …“ startet das Gespräch, /chat bekommt assistantName „Jarvis“");
  ok((await page.textContent(".vc-title")).includes("Jarvis"), "Gesprächs-Ansicht mit Namen");
  await waitState(page, "listen");
  await page.evaluate(() => window.__sr.say("Danke Jarvis"));
  await waitState(page, "none");
  ok(true, "„Danke Jarvis“ beendet");
  await page.evaluate(() => { location.hash = "#alltag"; });
  await page.waitForSelector('.al-tile[data-id="claude"]');
  const tile = await page.textContent('.al-tile[data-id="claude"]');
  ok(tile.includes("Claude-Assistent") && tile.includes("Jarvis"), "Kachel: Titel bleibt, Untertitel zeigt den Namen");
  await page.evaluate(() => { location.hash = "#alltag/claude"; });
  await page.waitForSelector(".ai-voicebar");

  // Neu laden: Einstellungen bleiben, Weckwort startet (Erlaubnis schon erteilt)
  await page.reload();
  await page.waitForTimeout(400);
  if (!(await page.$(".ai-voicebar"))) { await page.click("#btn-local").catch(() => {}); await page.evaluate(() => { location.hash = "#alltag/claude"; }); }
  await page.waitForSelector(".ai-voicebar");
  await page.waitForFunction(() => !!window.__sr.wake(), null, { timeout: 3000 });
  ok(true, "nach Neuladen startet „Hey Claude“ wieder (Erlaubnis bereits per Tipp erteilt)");
  await page.click(".ai-vset");
  await page.waitForFunction(() => document.querySelectorAll(".vs-voice option").length > 1);
  ok(await page.$eval(".vs-voice", (s) => s.value) === "Google Deutsch" && await page.$eval(".vs-rate", (s) => s.value) === "1.3"
    && await page.isChecked(".vs-read") && !(await page.isChecked(".vs-short")) && await page.isChecked(".vs-wake")
    && await page.$eval(".vs-name", (s) => s.value) === "Jarvis", "Einstellungen (inkl. Name) nach Neuladen erhalten");
  await ctx.close();

  // Erstes Mal: Weckwort gespeichert, aber noch nie per Tipp erlaubt → kein Mikrofon
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c2.route("**/*", (r) => { const u = new URL(r.request().url()); return u.hostname === "localhost" ? r.continue() : r.abort(); });
    await c2.addInitScript(fakes);
    await c2.addInitScript(() => { try { localStorage.setItem("stempelkarte.ai.voice", JSON.stringify({ wake: true, wakeGranted: false })); } catch {} });
    const p2 = await c2.newPage();
    p2.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p2.goto(BASE); await p2.click("#btn-local"); await p2.waitForTimeout(300);
    await p2.evaluate(() => { location.hash = "#alltag/claude"; });
    await p2.waitForSelector(".ai-voicebar"); await p2.waitForTimeout(500);
    ok(await p2.evaluate(() => window.__sr.instances.length === 0), "Weckwort startet ohne erste Nutzer-Geste nicht von selbst");
    await c2.close();
  }

  // Nicht unterstützt
  {
    const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c3.route("**/*", (r) => { const u = new URL(r.request().url()); return u.hostname === "localhost" ? r.continue() : r.abort(); });
    await c3.addInitScript(noSpeech);
    const p3 = await c3.newPage();
    p3.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p3.goto(BASE); await p3.click("#btn-local"); await p3.waitForTimeout(300);
    await p3.evaluate(() => { location.hash = "#alltag/claude"; });
    await p3.waitForSelector(".ai-voicebar"); await p3.waitForTimeout(300);
    ok(!(await p3.isVisible(".ai-talk")) && !(await p3.isVisible(".ai-vset")) && (await p3.textContent(".ai-vnote")).includes("gehen in diesem Browser nicht"), "ohne Sprach-APIs: freundlicher Hinweis, Funktionen ausgeblendet");
    ok(!(await p3.isVisible(".ai-mic")), "Diktier-Mikro ebenfalls aus");
    await p3.screenshot({ path: path.join(OUT, "voice-unsupported-390-light.png") });
    await c3.close();
  }
  // Lokaler Modus ohne Test-Haken: Assistent bleibt gesperrt, keine Sprachleiste
  {
    const c4 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c4.route("**/*", (r) => { const u = new URL(r.request().url()); return u.hostname === "localhost" ? r.continue() : r.abort(); });
    const p4 = await c4.newPage();
    p4.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    await p4.goto(BASE); await p4.click("#btn-local"); await p4.waitForTimeout(300);
    await p4.evaluate(() => { location.hash = "#alltag/claude"; });
    await p4.waitForSelector(".ai-empty"); await p4.waitForTimeout(200);
    ok((await p4.textContent(".ai-empty")).includes("lokalen Modus") && !(await p4.isVisible(".ai-voicebar")), "ohne Test-Haken: lokaler Modus wie bisher gesperrt");
    await c4.close();
  }

  /* ================= dunkel ================= */
  ({ ctx, page } = await newPage("dark"));
  await shot(page, "voice-chat-390-dark.png");
  await page.click(".ai-talk");
  await waitState(page, "listen");
  await shot(page, "voice-listen-390-dark.png");
  await page.evaluate(() => { window.__tts.hold = true; });
  await page.evaluate(() => window.__sr.say("Wie viele Überstunden hab ich?"));
  await waitState(page, "speak");
  await waitTalking(page);
  await shot(page, "voice-speak-390-dark.png");
  await page.click(".vc-x");
  await page.evaluate(() => { window.__tts.hold = false; });
  await page.click(".ai-vset");
  await page.waitForFunction(() => document.querySelectorAll(".vs-voice option").length > 1);
  await shot(page, "voice-settings-390-dark.png");
  await ctx.close();

  await browser.close();
  const bad = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  ok(bad.length === 0, "keine Konsolenfehler" + (bad.length ? ": " + bad.join(" | ") : ""));
  console.log("ALLE TESTS OK");
})().catch((e) => { console.error(e); process.exit(1); });
