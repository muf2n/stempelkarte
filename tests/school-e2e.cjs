// Playwright-Test „Schule & Lernen“: Fächer-Karten, Fach-Detail, Lernplaner-Kalender, KI-Plan (gestubbtes /chat),
// Übernehmen, Rückfall auf den automatischen Plan, Smoke-Test Claude-Assistent.
//   cd <worktree> && python3 -m http.server 8854 &   then   node tests/school-e2e.cjs [screenshot-dir]
// Fremde Domains werden abgefangen. Test-Haken window.__skAiTest (nur localhost) ersetzt die Firebase-Anmeldung.
const { chromium } = require("playwright");
const path = require("path");
const BASE = "http://localhost:8854/";
const HARNESS = BASE + "tests/school-harness.html";
const OUT = process.argv[2] || require("os").tmpdir();

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return key(d); };
const T = day(0);

const SEED = {
  timetable: [
    { id: "l1", weekday: 1, period: 1, periods: 2, from: "08:00", to: "09:40", subject: "Elektrotechnik", room: "E 204", color: "#f59e0b" },
    { id: "l2", weekday: 1, period: 3, periods: 1, from: "09:55", to: "10:45", subject: "Angewandte Mathematik", room: "M 1", color: "#5b7cfa" },
    { id: "l3", weekday: 3, period: 1, periods: 2, from: "08:00", to: "09:40", subject: "Englisch", color: "#14b8a6" },
    { id: "l4", weekday: 3, period: 3, periods: 2, from: "09:55", to: "11:35", subject: "Werkstätte", color: "#ec4899" },
  ],
  tasks: [
    { id: "t1", subject: "Elektrotechnik", title: "Übungsblatt Ohmsches Gesetz", due: day(1), done: false, prio: "high" },
    { id: "t2", subject: "Elektrotechnik", title: "Schaltplan zeichnen", due: day(3), done: true, doneAt: 1 },
    { id: "t3", subject: "Elektrotechnik", title: "Formelsammlung ergänzen", due: day(6), done: false },
    { id: "t4", subject: "Angewandte Mathematik", title: "Seite 42 Nr. 1–5", due: day(2), done: false },
    { id: "t5", subject: "Englisch", title: "Vocabulary Unit 4", due: day(0), done: true, doneAt: 2 },
  ],
  exams: [
    { id: "e1", subject: "Elektrotechnik", kind: "Schularbeit", date: day(4), topics: "Ohmsches Gesetz\nReihenschaltung\nParallelschaltung\nLeistung", progress: 0 },
    { id: "e2", subject: "Angewandte Mathematik", kind: "Test", date: day(9), topics: "Bruchrechnen\nGleichungen", progress: 0 },
  ],
  grades: [
    { id: "g1", subject: "Elektrotechnik", grade: 2, weight: 2, kind: "Schularbeit", date: day(-20) },
    { id: "g2", subject: "Elektrotechnik", grade: 1, weight: 1, kind: "Mitarbeit", date: day(-10) },
    { id: "g3", subject: "Englisch", grade: 3, weight: 1, kind: "Test", date: day(-5) },
  ],
  plan: [
    { id: "p1", subject: "Elektrotechnik", examId: "e1", date: day(0), title: "Ohmsches Gesetz", minutes: 30, order: 0, done: true },
    { id: "p2", subject: "Elektrotechnik", examId: "e1", date: day(1), title: "Reihenschaltung", minutes: 30, order: 1, done: false },
  ],
  sessions: [{ id: "s1", subject: "Elektrotechnik", start: Date.now() - 86400000, end: Date.now() - 86400000 + 1500000, minutes: 25, date: day(-1) }],
  docs: [{ id: "d1", subject: "Elektrotechnik", title: "Formelsammlung ET", date: day(-3), size: 120000, type: "application/pdf", created: 5 }],
  meta: [],
};

const AI_REPLY = `Gerne! Hier ist dein Plan:
\`\`\`json
[
  {"date":"${day(1)}","subject":"elektrotechnik","topic":"Parallelschaltung üben","minutes":30},
  {"date":"${day(2)}","subject":"Elektrotechnik","topic":"Leistung und Arbeit","minutes":40},
  {"date":"${day(3)}","subject":"Elektrotechnik","topic":"Wiederholung Schularbeit","minutes":45},
  {"date":"${day(5)}","subject":"Angewandte Mathematik","topic":"Bruchrechnen","minutes":30},
  {"date":"${day(30)}","subject":"Englisch","topic":"zu weit weg","minutes":30},
  {"date":"kaputt","subject":"Englisch","topic":"ungültig"},
]
\`\`\`
Viel Erfolg!`;

let failures = 0;
const ok = (c, msg) => { if (c) console.log("  ✓ " + msg); else { failures++; console.log("  ✗ " + msg); } };

async function newPage(browser, { scheme = "light", viewport = { width: 390, height: 844 }, hook = true, chat = "ok" } = {}, errors) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme });
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  const chatReqs = [];
  await ctx.route("**/chat", async (route) => {
    const req = route.request();
    chatReqs.push({ body: JSON.parse(req.postData() || "{}"), auth: req.headers()["authorization"] });
    if (chat === "fail") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Claude ist gerade nicht erreichbar." }) });
    const body = chatReqs[chatReqs.length - 1].body;
    const last = body.messages[body.messages.length - 1].content;
    const reply = /Lernplaner/.test(last) ? AI_REPLY : "Hallo **Welt**\n- Punkt eins";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply, actions: [], usage: { usd: 0.12, capUsd: 5 } }) });
  });
  await ctx.addInitScript(({ seed, hook }) => {
    if (hook) window.__skAiTest = { token: "test-token", url: location.origin };
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      for (const [n, items] of Object.entries(seed)) localStorage.setItem("sk-a-school_" + n, JSON.stringify(items));
      localStorage.setItem("sk-school-tab", "heute");
    }
  }, { seed: SEED, hook });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(HARNESS);
  await page.waitForFunction(() => window.__schoolMounted);
  await page.waitForSelector(".ss-tabs");
  return { ctx, page, chatReqs };
}

const tab = (page, id) => page.click(`.ss-tabs [data-tab="${id}"]`);
const shot = async (page, name) => { await page.waitForTimeout(500); return page.screenshot({ path: path.join(OUT, name), fullPage: true }); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  console.log("Fächer + Detail (390, hell)");
  {
    const { ctx, page } = await newPage(browser, {}, errors);
    const first = await page.$eval(".ss-tabs [data-tab]", (b) => b.dataset.tab);
    ok(first === "faecher", "Fächer ist erster Reiter");
    await tab(page, "faecher");
    await page.waitForSelector(".ss-fach");
    const cards = await page.$$eval(".ss-faecher .ss-fach", (l) => l.map((b) => ({ n: b.querySelector(".ss-fach-n").textContent, t: b.textContent, e: b.querySelector(".ss-fach-emo").textContent.trim() })));
    ok(cards.length === 4, `4 Fach-Karten (${cards.map((c) => c.n).join(", ")})`);
    const et = cards.find((c) => c.n === "Elektrotechnik");
    ok(et && et.e === "⚡", "Elektrotechnik hat ⚡");
    ok(et && /1\/3\s*Aufgaben erledigt/.test(et.t), "ET: 1/3 Aufgaben erledigt");
    ok(et && /Schularbeit · noch 4 Tage/.test(et.t), "ET: Countdown Schularbeit");
    ok(et && /Ø 1,67/.test(et.t), "ET: Notenschnitt 1,67");
    ok(et && /40 %/.test(et.t), "ET: Fortschritt 40 % (2 von 5)");
    ok(cards.find((c) => c.n === "Angewandte Mathematik").e === "📐", "Mathe hat 📐");
    ok(cards.find((c) => c.n === "Englisch").e === "🇬🇧" && cards.find((c) => c.n === "Werkstätte").e === "🛠️", "Englisch 🇬🇧, Werkstätte 🛠️");
    const ov = await page.$eval(".ss-overall", (e) => e.textContent.replace(/\s+/g, " "));
    ok(/4\s*Fächer/.test(ov) && /5\s*Aufgaben gesamt/.test(ov) && /2\s*erledigt/.test(ov), "Gesamtfortschritt: 4 Fächer · 5 Aufgaben · 2 erledigt");
    await shot(page, "faecher-390-light.png");

    await page.click('[data-sopen="Elektrotechnik"]');
    await page.waitForSelector(".ss-fach-hero");
    const det = await page.$eval(".ss-body", (e) => e.textContent.replace(/\s+/g, " "));
    ok(/Übungsblatt Ohmsches Gesetz/.test(det) && /Formelsammlung ergänzen/.test(det) && !/Seite 42/.test(det), "Detail: nur ET-Aufgaben");
    ok(/Leistung/.test(det) && /Schularbeit/.test(det), "Detail: Prüfung mit Stoff");
    ok(await page.$$eval(".ss-grades [data-gedit]", (l) => l.length) === 2, "Detail: 2 Noten");
    ok(/Reihenschaltung/.test(det), "Detail: Lerneinheit");
    ok(/E 204/.test(det) && /2 Stunden pro Woche/.test(det), "Detail: Stundenplan (2 Std./Woche)");
    ok(/Formelsammlung ET/.test(det), "Detail: Dokument");
    ok(/25 min/.test(det), "Detail: Lernzeit");
    await shot(page, "fach-detail-390-light.png");
    // Symbol ändern
    await page.click("[data-semoji]");
    await page.waitForSelector(".ss-emojis");
    await page.click('.ss-emojis [data-emo="💡"]');
    await page.click("#em-save");
    await page.waitForFunction(() => document.querySelector(".ss-fach-hero .ss-fach-emo")?.textContent.includes("💡"));
    ok(true, "Symbol auf 💡 geändert");
    // Aufgabe abhaken im Detail
    await page.click('[data-tdone="t1"]');
    await page.waitForFunction(() => document.querySelector('[data-tdone="t1"]')?.getAttribute("aria-checked") === "true");
    ok(true, "Aufgabe im Detail abgehakt");
    await page.click("[data-sback]");
    await page.waitForSelector(".ss-faecher");
    const et2 = await page.$eval('[data-sopen="Elektrotechnik"]', (b) => b.textContent);
    ok(/2\/3/.test(et2) && et2.includes("💡"), "Karte aktualisiert (2/3, 💡)");
    await ctx.close();
  }

  console.log("Planer + KI-Plan (390, hell)");
  {
    const { ctx, page, chatReqs } = await newPage(browser, {}, errors);
    await tab(page, "planer");
    await page.waitForSelector(".ss-cal");
    const nDays = await page.$$eval(".ss-cal-d", (l) => l.length);
    ok(nDays >= 28 && nDays <= 31, `Monatskalender mit ${nDays} Tagen`);
    const todayCell = await page.$(`.ss-cal-d[data-cday="${T}"]`);
    ok(todayCell && (await todayCell.getAttribute("class")).includes("sel"), "Heute ausgewählt");
    if (day(4).slice(0, 7) === T.slice(0, 7)) {
      ok(await page.$(`.ss-cal-d[data-cday="${day(4)}"] i.ex`), "Punkt für Prüfung");
      ok(await page.$(`.ss-cal-d[data-cday="${day(1)}"] i.tk`) && await page.$(`.ss-cal-d[data-cday="${day(1)}"] i.pl`), "Punkte für Aufgabe + Lerneinheit");
      await page.click(`.ss-cal-d[data-cday="${day(1)}"]`);
      await page.waitForFunction((k) => document.querySelector(`.ss-cal-d[data-cday="${k}"]`)?.classList.contains("sel"), day(1));
      const list = await page.$eval(".ss-calday", (e) => e.textContent);
      ok(/Morgen/.test(list) && /Übungsblatt Ohmsches Gesetz/.test(list) && /Reihenschaltung/.test(list), "Tagesliste für morgen");
    }
    await page.click('[data-cm="1"]'); await page.click('[data-cm="-1"]');
    ok(true, "Monat vor/zurück");
    await page.click(`.ss-cal-d[data-cday="${T}"]`).catch(() => {});
    await shot(page, "planer-390-light.png");

    await page.click("#pl-ai");
    await page.waitForSelector(".ss-pv");
    ok(chatReqs.length === 1, "/chat einmal aufgerufen");
    const prompt = chatReqs[0].body.messages[0].content;
    ok(chatReqs[0].auth === "Bearer test-token", "Authorization-Header gesetzt");
    ok(/NUR mit einem JSON-Array/.test(prompt) && /"pruefungen":\[/.test(prompt) && /Parallelschaltung/.test(prompt) && /"aufgaben":\[/.test(prompt), "Prompt deutsch mit Prüfungen, Stoff, Aufgaben (JSON)");
    const units = await page.$$eval("[data-pvi]", (l) => l.length);
    ok(units === 4, `Vorschau: 4 gültige Einheiten (ungültige/zu weite verworfen) – ${units}`);
    const pvTxt = await page.$eval(".ss-pv", (e) => e.textContent);
    ok(/Elektrotechnik/.test(pvTxt) && !/elektrotechnik ·/.test(pvTxt), "Fachname normalisiert");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "ki-vorschau-390-light.png") });
    await page.uncheck('[data-pvi="3"]');
    ok(/Übernehmen \(3\)/.test(await page.textContent("#pv-go")), "Häkchen entfernen → Übernehmen (3)");
    await page.click("#pv-go");
    await page.waitForFunction(() => !document.querySelector(".ss-pv"));
    const plan = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-school_plan")));
    const ai = plan.filter((p) => p.source === "ai");
    ok(ai.length === 3, "3 KI-Einheiten in school_plan");
    ok(ai.every((p) => p.title && p.date && p.minutes && p.done === false && "examId" in p && "order" in p), "Form wie school_plan (title, date, minutes, order, examId, done)");
    ok(ai.filter((p) => p.subject === "Elektrotechnik").every((p) => p.examId === "e1"), "ET-Einheiten der Schularbeit zugeordnet");
    ok(plan.length === 5, "Bestehende Einheiten bleiben");
    // zweites Mal: ersetzen
    await page.click("#pl-ai");
    await page.waitForSelector("#pv-repl");
    await page.click("#pv-go");
    await page.waitForFunction(() => !document.querySelector(".ss-pv"));
    const plan2 = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-school_plan")));
    ok(plan2.filter((p) => p.source === "ai").length === 4 && plan2.length === 6, "Erneut planen ersetzt alte KI-Einheiten (keine Duplikate)");
    // Lernen-Tab und Prüfungen funktionieren weiter
    for (const t of ["heute", "stundenplan", "aufgaben", "pruefungen", "noten", "lernen", "projekte", "dokumente"]) {
      await tab(page, t);
      await page.waitForTimeout(80);
      const txt = await page.$eval(".ss-body", (e) => e.textContent);
      if (/Fehler beim Anzeigen/.test(txt)) ok(false, "Reiter " + t);
    }
    ok(true, "Alle bestehenden Reiter zeigen an");
    await ctx.close();
  }

  console.log("Rückfall: lokal ohne Server / Serverfehler");
  {
    const { ctx, page, chatReqs } = await newPage(browser, { hook: false }, errors);
    await tab(page, "planer");
    await page.click("#pl-ai");
    await page.waitForSelector(".ss-pv");
    ok(chatReqs.length === 0, "Lokal: kein /chat-Aufruf");
    const note = await page.$eval(".ss-pv-note", (e) => e.textContent);
    ok(/lokaler Modus/.test(note) && /automatische Plan/.test(note) && /1 Prüfung hat schon einen Plan/.test(note), "Freundlicher Hinweis + automatischer Plan");
    const n = await page.$$eval("[data-pvi]", (l) => l.length);
    ok(n >= 2, `Automatischer Plan für Mathe-Test: ${n} Einheiten`);
    await page.click("#pv-go");
    await page.waitForFunction(() => !document.querySelector(".ss-pv"));
    const plan = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-school_plan")));
    ok(plan.filter((p) => p.source === "auto" && p.examId === "e2").length === n, "Automatische Einheiten übernommen (examId e2)");
    await ctx.close();
  }
  {
    const { ctx, page, chatReqs } = await newPage(browser, { chat: "fail" }, errors);
    await tab(page, "planer");
    await page.click("#pl-ai");
    await page.waitForSelector(".ss-pv");
    const note = await page.$eval(".ss-pv-note", (e) => e.textContent);
    ok(chatReqs.length === 1 && /nicht erreichbar/.test(note) && /automatische Plan/.test(note), "Serverfehler 502 → Rückfall mit Hinweis");
    await ctx.close();
  }

  console.log("Claude-Assistent Smoke-Test");
  {
    const { ctx, page, chatReqs } = await newPage(browser, {}, errors);
    await page.evaluate(async () => {
      const m = await import("/js/alltag/assistant.js");
      const ui = await import("/js/ui.js");
      const div = document.createElement("div"); div.id = "ai-test"; document.querySelector("main").appendChild(div);
      window.__aiOff = m.mount(div, { toast: ui.toast });
    });
    await page.waitForSelector("#ai-test .ai-form:not([hidden])");
    await page.fill("#ai-test .ai-in", "Hallo Claude");
    await page.click("#ai-test .ai-send");
    await page.waitForSelector("#ai-test .ai-msg.bot b");
    const bot = await page.$eval("#ai-test .ai-msg.bot", (e) => e.innerHTML);
    ok(/<b>Welt<\/b>/.test(bot) && /<li>Punkt eins<\/li>/.test(bot), "Antwort mit Markdown angezeigt");
    ok(chatReqs[0].body.messages[0].content === "Hallo Claude" && chatReqs[0].auth === "Bearer test-token", "Assistent schickt Verlauf über askClaude");
    ok(/0,12 \$ von 5 \$/.test(await page.textContent("#ai-test .ai-usage")), "Kosten-Anzeige");
    await page.evaluate(() => window.__aiOff());
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage(browser, { hook: false }, errors);
    await page.evaluate(async () => {
      const m = await import("/js/alltag/assistant.js");
      const div = document.createElement("div"); div.id = "ai-test"; document.querySelector("main").appendChild(div);
      m.mount(div, {});
    });
    const t = await page.textContent("#ai-test .ai-log");
    ok(/lokalen Modus/.test(t) && await page.$eval("#ai-test .ai-form", (f) => f.hidden), "Assistent lokal: Hinweis, kein Formular");
    await ctx.close();
  }

  console.log("Screenshots dunkel + Desktop");
  for (const [scheme, vp, sfx] of [["dark", { width: 390, height: 844 }, "390-dark"], ["light", { width: 1440, height: 900 }, "1440-light"], ["dark", { width: 1440, height: 900 }, "1440-dark"]]) {
    const { ctx, page } = await newPage(browser, { scheme, viewport: vp }, errors);
    await tab(page, "faecher"); await page.waitForSelector(".ss-fach");
    await shot(page, `faecher-${sfx}.png`);
    await page.click('[data-sopen="Elektrotechnik"]'); await page.waitForSelector(".ss-fach-hero");
    await shot(page, `fach-detail-${sfx}.png`);
    await tab(page, "planer"); await page.waitForSelector(".ss-cal");
    await shot(page, `planer-${sfx}.png`);
    await page.click("#pl-ai"); await page.waitForSelector(".ss-pv"); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `ki-vorschau-${sfx}.png`) });
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ow <= 0, `${sfx}: kein horizontales Scrollen`);
    await ctx.close();
  }

  const errs = errors.filter((e) => !/ERR_FAILED|net::|status of 502/.test(e)); // 502 = absichtlicher Stub-Fehler
  ok(!errs.length, "Keine Konsolenfehler" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close();
  console.log(failures ? `\n${failures} FEHLER` : "\nAlles grün");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
