// Playwright-Test „Abos“: Katalog-Vorschlag, Mindestlaufzeit mit Frist, Testzeitraum, gekündigt → keine Buchung
// nach dem Ende, Planer-Erinnerung genau einmal, „Kündigen ↗“ öffnet den Link, Screenshots hell/dunkel.
//   cd <worktree> && python3 -m http.server 8866 &   then   node tests/abos-e2e.cjs [screenshot-dir]
const { chromium } = require("playwright");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8866/";
const OUT = process.argv[2] || require("os").tmpdir();

const DAY = 86400e3;
const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => key(new Date(Date.now() + n * DAY));
const fmt = (k) => `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const endOfNextMonth = () => { const d = new Date(); return key(new Date(d.getFullYear(), d.getMonth() + 2, 0, 12)); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const blocked = new Set();
  const ok = (cond, msg) => { if (!cond) throw new Error("FEHLER: " + msg); console.log("✓ " + msg); };

  async function newPage(opts) {
    const ctx = await browser.newContext(opts);
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
      blocked.add(u.hostname);
      return route.abort();
    });
    await ctx.addInitScript(() => {
      window.__opened = [];
      window.open = (u) => { window.__opened.push(String(u)); return null; };
    });
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    return { ctx, page };
  }
  const subs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_subs") || "[]"));
  const txs = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sk-a-money_tx") || "[]"));
  const aboTodos = async (page) => {
    await page.waitForTimeout(900); // lokaler Speicher schreibt entprellt
    return page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem("stempelkarte.local.v1") || "{}");
      const list = Array.isArray(d.todos) ? d.todos : Object.values(d.todos || {});
      return list.filter((t) => String(t.id || "").startsWith("abo_"));
    });
  };
  const sheet = (page) => page.locator(".sheet").last();

  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await page.goto(BASE);
  await page.click("#btn-local");
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.setItem("stempelkarte.money.tab", "abos"));
  await page.goto(BASE + "#alltag/geld");
  await page.waitForSelector(".mn-page[data-tab=abos]");
  ok(await page.isVisible("text=Noch keine Abos"), "Leerer Zustand");

  /* 1) Netflix → Katalog füllt Kündigungslink */
  await page.click(".mn-fab");
  await page.fill("#mn-s-name", "Netflix");
  const url = await page.inputValue("#ab-url");
  ok(url === "https://www.netflix.com/cancelplan", "Netflix: Kündigungslink vorausgefüllt (" + url + ")");
  ok((await page.inputValue("#ab-what")).length > 3 && (await page.inputValue("#ab-howf")).includes("cancelplan"), "Netflix: Beschreibung + Anleitung vorausgefüllt");
  ok(await page.isVisible(".ab-cat-hint >> text=Netflix"), "Hinweis „Netflix erkannt“");
  // Namenswechsel ersetzt automatisch Gefülltes
  await page.fill("#mn-s-name", "Spotify");
  ok((await page.inputValue("#ab-url")).includes("spotify.com"), "Anderer Treffer ersetzt Katalog-Felder");
  await page.fill("#mn-s-name", "Netflix");
  await page.fill("#mn-s-amt", "13,99");
  await page.fill("#mn-s-next", plus(10));
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(300);
  let nf = (await subs(page)).find((s) => s.name === "Netflix");
  ok(nf && nf.cancelUrl === "https://www.netflix.com/cancelplan" && nf.catalogKey === "netflix" && nf.contractType === "monatlich kündbar", "Netflix gespeichert mit cancelUrl/catalogKey");
  const nfCard = page.locator(".ab-card", { hasText: "Netflix" });
  ok((await nfCard.locator(".ab-status").textContent()).includes(`nächste Abbuchung am ${fmt(plus(10))} – jederzeit kündbar bis ${fmt(plus(9))}`), "Netflix-Status „jederzeit kündbar bis …“");

  /* 2) „Kündigen ↗“ öffnet den Link */
  await nfCard.locator(".ab-cancel").click();
  let opened = await page.evaluate(() => window.__opened.slice());
  ok(opened.length === 1 && opened[0] === "https://www.netflix.com/cancelplan", "„Kündigen ↗“ öffnet netflix.com/cancelplan in neuem Tab");

  /* 3) Mindestlaufzeit mit Frist */
  const termEnd = endOfNextMonth();
  await page.click(".mn-fab");
  await page.fill("#mn-s-name", "A1");
  await page.fill("#mn-s-amt", "25");
  await page.fill("#mn-s-next", plus(3));
  ok(await page.getAttribute('[data-ct="Mindestlaufzeit"]', "aria-checked") === "true", "A1: Vertragsart Mindestlaufzeit aus dem Katalog");
  await page.fill("#ab-min", termEnd);
  await page.fill("#ab-notice", "1 Monat zum Monatsende");
  await page.fill("#ab-acc", "flo@example.com");
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(400);
  const a1 = (await subs(page)).find((s) => s.name === "A1");
  ok(a1 && a1.minTermEnd === termEnd && a1.noticeText === "1 Monat zum Monatsende" && a1.autoRenew === true, "A1 gespeichert (Mindestlaufzeit, Frist, Auto-Verlängerung)");
  const deadline = (() => { const [y, m] = termEnd.split("-").map(Number); return key(new Date(y, m - 1, 0, 12)); })(); // Ende des Vormonats
  const a1Status = await page.locator(".ab-card", { hasText: "A1" }).locator(".ab-status").textContent();
  ok(a1Status.includes(`Vertrag bis ${fmt(termEnd)}`) && a1Status.includes(`spätestens kündigen bis ${fmt(deadline)}`), "A1-Status: Vertrag bis … · spätestens kündigen bis " + fmt(deadline));
  ok(await page.isVisible(".ab-mini.warn >> text=A1"), "„Kündigungsfristen bald“ zeigt A1");

  /* 4) Testzeitraum */
  await page.click(".mn-fab");
  await page.fill("#mn-s-name", "Disney+");
  await page.fill("#mn-s-amt", "9,99");
  await page.click('[data-ct="Testzeitraum"]');
  ok(await page.isVisible("#ab-trial") && !(await page.isVisible("#ab-min")), "Testzeitraum-Feld sichtbar, Mindestlaufzeit verborgen");
  await page.fill("#ab-trial", plus(5));
  await page.fill("#mn-s-next", plus(6));
  await page.click(".sheet [data-save]");
  await page.waitForTimeout(400);
  const dpStatus = await page.locator(".ab-card", { hasText: "Disney+" }).locator(".ab-status").textContent();
  ok(dpStatus.includes("Testzeitraum endet in 5 Tagen"), "Disney+: „Testzeitraum endet in 5 Tagen“");
  ok(await page.isVisible(".ab-mini.trial >> text=Disney+"), "„Testzeiträume“ zeigt Disney+");
  const heroMonth = await page.textContent(".ab-hero");
  ok(heroMonth.includes("38,99"), "Summe pro Monat ohne laufenden Testzeitraum (13,99 + 25)");

  /* 5) Erinnerungen genau einmal */
  let todos = await aboTodos(page);
  const dTitle = `Disney+ kündigen bis ${fmt(plus(4)).slice(0, 6)}`;
  const aTitle = `A1 kündigen bis ${fmt(deadline).slice(0, 6)}`;
  const daysToA1 = Math.round((new Date(deadline + "T12:00") - new Date(plus(0) + "T12:00")) / DAY);
  ok(todos.some((t) => t.title === dTitle && t.date === plus(1) && t.remind === true && t.kind === "todo"), "Planer-Erinnerung „" + dTitle + "“ (3 Tage vorher, frühestens heute)");
  if (daysToA1 <= 31) ok(todos.some((t) => t.title === aTitle), "Planer-Erinnerung „" + aTitle + "“");
  const n1 = todos.length;
  // Neu laden und Tab wechseln → keine doppelten Erinnerungen
  await page.reload();
  await page.waitForSelector(".mn-page[data-tab=abos]");
  await page.click('.mn-tab[data-tab="uebersicht"]');
  await page.click('.mn-tab[data-tab="abos"]');
  todos = await aboTodos(page);
  ok(todos.length === n1, `Erinnerungen nur einmal (${todos.length})`);
  // Erledigt/gelöscht + neu laden → kommt nicht wieder (remindedFor)
  ok((await subs(page)).filter((s) => s.remindedFor).length === n1, "remindedFor am Abo gemerkt");

  /* 6) Detail-Blatt + Als gekündigt markieren */
  await page.locator(".ab-card", { hasText: "Netflix" }).locator(".ab-main").click();
  await page.waitForSelector(".ab-detail .ab-d-head");
  ok(await page.isVisible(".ab-how textarea"), "Detail: „So kündigst du“-Box");
  ok((await page.textContent(".ab-detail")).includes("netflix.com/cancelplan"), "Detail: Kündigungslink sichtbar");
  await page.fill("#ab-how", "1. cancelplan öffnen\n2. Kündigen\n3. Fertig");
  await page.click("[data-ab=savehow]");
  await page.waitForTimeout(300);
  ok(((await subs(page)).find((s) => s.name === "Netflix") || {}).cancelHow.includes("3. Fertig"), "„So kündigst du“ bearbeitet und gespeichert");
  await page.click("[data-ab=markcancel]");
  ok(await page.inputValue("#ab-c-end") === plus(9), "Vorschlag „läuft aus am“ = Tag vor der nächsten Abbuchung");
  await page.click(".sheet:last-of-type [data-save]");
  await page.waitForTimeout(400);
  nf = (await subs(page)).find((s) => s.name === "Netflix");
  ok(nf.cancelledOn === plus(0) && nf.ended === plus(9) && nf.paused === false, "Netflix: cancelledOn + ended gesetzt");
  ok((await page.textContent(".ab-detail .ab-d-status")).includes(`gekündigt am ${fmt(plus(0))}, läuft aus am ${fmt(plus(9))}`), "Status „gekündigt am …, läuft aus am …“");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  /* 7) Gekündigt → nach dem Ende keine automatische Buchung */
  await page.evaluate(([n70, n50, n35]) => {
    const list = JSON.parse(localStorage.getItem("sk-a-money_subs") || "[]");
    const t = Date.now();
    list.push({ id: "s_sp", name: "Spotify", amount: 10.99, interval: "month", next: n70, day: Number(n70.slice(8)), category: "abos", cancelledOn: n50, ended: n35, created: t, updated: t });
    localStorage.setItem("sk-a-money_subs", JSON.stringify(list));
  }, [plus(-70), plus(-50), plus(-45)]);
  await page.reload();
  await page.waitForSelector(".mn-page[data-tab=abos]");
  await page.waitForTimeout(600);
  const spTx = (await txs(page)).filter((t) => t.recurringId === "s_sp");
  ok(spTx.length === 1 && spTx[0].date === plus(-70), `Gekündigtes Abo: nur Buchung vor dem Ende (${spTx.map((t) => t.date).join(", ")})`);
  ok((await page.locator(".ab-card", { hasText: "Spotify" }).locator(".ab-status").textContent()).includes("ausgelaufen am"), "Spotify: „ausgelaufen am …“");
  // Netflix (Ende in der Zukunft) noch in den Summen, ausgelaufenes Spotify nicht
  ok((await page.textContent(".ab-hero")).includes("38,99"), "Summen ohne ausgelaufenes Abo");

  /* 8) Screenshots */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, "abos-390-light.png"), fullPage: true });
  await page.locator(".ab-card", { hasText: "A1" }).locator(".ab-main").click();
  await page.waitForSelector(".ab-detail .ab-d-head");
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "abos-detail-390-light.png") });
  // Kündigen im Detail-Blatt
  await page.evaluate(() => { window.__opened = []; });
  await page.click(".ab-detail [data-ab=cancel]");
  opened = await page.evaluate(() => window.__opened.slice());
  ok(opened[0] === "https://www.a1.net/kuendigen", "Detail „Kündigen ↗“ öffnet a1.net/kuendigen");
  await page.keyboard.press("Escape");
  await page.click(".mn-fab");
  await page.fill("#mn-s-name", "FitInn");
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, "abos-form-390-light.png") });
  await page.keyboard.press("Escape");

  const state = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  for (const [scheme, vp, name] of [["dark", { width: 390, height: 844 }, "abos-390-dark"], ["light", { width: 1440, height: 900 }, "abos-1440-light"], ["dark", { width: 1440, height: 900 }, "abos-1440-dark"]]) {
    const p = await newPage({ viewport: vp, colorScheme: scheme });
    await p.page.goto(BASE);
    await p.page.evaluate((st) => { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); }, state);
    await p.page.goto(BASE + "#alltag/geld");
    await p.page.reload();
    await p.page.waitForSelector(".ab-card", { timeout: 8000 }).catch(async () => { await p.page.click("#btn-local").catch(() => {}); await p.page.goto(BASE + "#alltag/geld"); await p.page.waitForSelector(".ab-card"); });
    await p.page.waitForTimeout(300);
    await p.page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
    if (name === "abos-390-dark") {
      await p.page.locator(".ab-card", { hasText: "A1" }).locator(".ab-main").click();
      await p.page.waitForSelector(".ab-detail .ab-d-head");
      await p.page.waitForTimeout(300);
      await p.page.screenshot({ path: path.join(OUT, "abos-detail-390-dark.png") });
    }
    const todosAfter = await aboTodos(p.page);
    ok(todosAfter.length === n1, `${name}: weiterhin keine doppelten Erinnerungen`);
    await p.ctx.close();
  }

  // abgefangene fremde Domains (Schriften, Firebase-SDK) erzeugen „Failed to load resource“ – das sind keine App-Fehler
  const real = errors.filter((e) => !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource/.test(e));
  console.log("Abgefangene fremde Anfragen:", [...blocked].join(", ") || "keine");
  ok(real.length === 0, "Keine Konsolenfehler" + (real.length ? ": " + real.join(" | ") : ""));
  await ctx.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
