// Playwright-Test für Geld › 🧮 Planen (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9415 &   then   node tests/finanz-sim-e2e.cjs [screenshot-dir]
// „Was bleibt am Monatsende?“ (= reine Logik finanz-core), eigene Einnahmen, Simulation „Wie wirkt sich eine Ausgabe aus?“
// mit „Kann ich mir das leisten?“, Jahreskosten (Abos + Verträge, Abo-Verträge nicht doppelt), Wunschliste (Priorität, angespart,
// diesen Monat geplant → Monatsende, Sparziel anlegen, gekauft), FAB, Suche, Geld-Sperre, 1440 hell/dunkel.
const path = require("path");
const { harness, key, shiftMonths } = require("./akten-harness.cjs");
const BASE = process.env.BASE || "http://localhost:9415/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const FP = await import(path.join(__dirname, "../js/alltag/finanz-core.js"));
  const M = await import(path.join(__dirname, "../js/alltag/money-core.js"));
  const H = await harness(BASE, OUT);
  const { ok, A, sheet } = H;
  const today = key(new Date());
  const mk = today.slice(0, 7);
  const first = mk + "-01";
  const txs = [
    { id: "t1", date: shiftMonths(first, -3), type: "in", amount: 900, category: "lohn" },
    { id: "t2", date: shiftMonths(first, -2), type: "in", amount: 1000, category: "lohn" },
    { id: "t3", date: shiftMonths(first, -1), type: "in", amount: 1100, category: "lohn" },
    { id: "t4", date: first, type: "out", amount: 120, category: "essen", note: "Billa" },
  ];
  const far = shiftMonths(today, 6);
  const subs = [{ id: "s1", name: "Musik", amount: 10, interval: "month", next: far, category: "abos" }, { id: "s2", name: "Cloud", amount: 36, interval: "year", next: far, category: "abos" }];
  const contracts = [{ id: "c1", name: "Handy", kind: "handy", amount: 20, interval: "month", start: "2026-01-01", minMonths: 24 }, { id: "c2", name: "Musik-Vertrag", subId: "s1", amount: 0 }];
  const alltag = { money_tx: txs, money_subs: subs, vertraege: contracts, money_budget: [{ id: "total", amount: 600 }] };
  const page = await H.newPage();
  await H.boot(page, { alltag });

  await page.goto(BASE + "#alltag/geld?tab=planen");
  await page.waitForSelector(".fp-me .fp-big-n");
  ok(await page.$('.mn-tab[data-tab="planen"][aria-selected="true"]'), "Neuer Reiter „Planen“ im Geld-Bereich");
  const r = FP.monthEnd({ today, txs, subs, contracts, wishes: [] });
  ok((await page.textContent(".fp-big-n")) === M.eur(r.rest), "Monatsende = reine Logik: " + M.eur(r.rest));
  ok((await page.textContent(".fp-lines")).includes("Schnitt der letzten Monate") && (await page.textContent(".fp-lines")).includes("Verträge (pro Monat)"), "Zeilen: Einnahmen (Schnitt), Verträge");
  ok(!(await page.textContent(".fp-lines")).includes("Musik-Vertrag"), "Abo-Vertrag zählt nicht doppelt");
  await H.shot(page, "finanz-plan-390-light.png");

  /* ---------- eigene Einnahmen ---------- */
  await page.click(".fp-inc summary");
  await page.fill("#fp-income", "1500");
  await page.locator("#fp-income").blur();
  await page.waitForTimeout(250);
  ok((await page.textContent(".fp-big-n")) === M.eur(FP.monthEnd({ today, txs, subs, contracts, income: 1500 }).rest), "Eigene Einnahmen fließen ein");
  await page.click(".fp-inc summary").catch(() => {});
  await page.fill("#fp-income", "");
  await page.locator("#fp-income").blur();
  await page.waitForTimeout(250);

  /* ---------- Simulation ---------- */
  await page.fill("#fp-note", "Neue Kopfhörer");
  await page.fill("#fp-amt", "700");
  await page.waitForSelector(".fp-sim-res");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "fp-amt"), "Tippen behält den Fokus (nur Ergebnis neu)");
  const sim = FP.simulate({ today, txs, subs, contracts, amount: 700, note: "Neue Kopfhörer", budgets: [{ id: "total", amount: 600 }] });
  ok((await page.textContent(".fp-ba")).includes(M.eur(sim.after.rest)), "Vorher/Nachher-Rest");
  ok((await page.textContent(".fp-sim-res .mn-af-head")).startsWith("🛑 Nein"), "„Kann ich mir das leisten?“ sagt Nein (Gesamtbudget)");
  await H.shot(page, "finanz-sim-390-light.png");

  /* ---------- Wunschliste ---------- */
  await page.click('[data-fp="wishfromsim"]');
  await page.waitForSelector("#fp-w-name");
  ok((await page.inputValue("#fp-w-name")) === "Neue Kopfhörer" && (await page.inputValue("#fp-w-price")) === "700", "Wunsch aus der Simulation vorbelegt");
  await page.fill("#fp-w-price", "120");
  await page.click(`${sheet} [data-prio="1"]`);
  await page.fill("#fp-w-saved", "40");
  await page.check("#fp-w-plan");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".fp-wi");
  let ws = await A(page, "money_wishes");
  ok(ws.length === 1 && ws[0].prio === 1 && ws[0].saved === 40 && ws[0].plan === mk, "Wunsch gespeichert (Priorität, angespart, diesen Monat)");
  ok((await page.textContent(".fp-wl")).includes("noch 80,00"), "Fortschritt: noch 80 €");
  ok((await page.textContent(".fp-lines")).includes("Geplante Wünsche"), "Geplanter Wunsch zählt beim Monatsende");
  ok((await page.textContent(".fp-big-n")) === M.eur(FP.monthEnd({ today, txs, subs, contracts, wishes: ws }).rest), "Monatsende minus 80 €");
  // per FAB
  await page.click(".mn-fab");
  await page.waitForSelector("#fp-w-name");
  await page.fill("#fp-w-name", "Akku-Schrauber");
  await page.fill("#fp-w-price", "149");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(250);
  ws = await A(page, "money_wishes");
  ok(ws.length === 2, "Wunsch über den ＋-Knopf");
  // Sparziel anlegen
  const w2 = ws.find((w) => w.name === "Akku-Schrauber");
  await page.click(`[data-fp="editwish"][data-id="${w2.id}"]`);
  await page.waitForSelector(`${sheet} [data-togoal]`);
  await page.click(`${sheet} [data-togoal]`);
  await page.waitForTimeout(300);
  const goals = await A(page, "money_goals");
  ws = await A(page, "money_wishes");
  ok(goals.length === 1 && goals[0].target === 149 && goals[0].emoji === "🎁" && ws.find((w) => w.id === w2.id).goalId === goals[0].id, "Sparziel aus dem Wunsch angelegt + verknüpft");
  await page.waitForTimeout(150);
  ok((await page.textContent(".fp-wl")).includes("🎯 Akku-Schrauber"), "Wunsch zeigt das Sparziel");
  // gekauft
  await page.click(`[data-fp="editwish"][data-id="${ws[0].id}"]`);
  await page.waitForSelector(`${sheet} [data-done]`);
  await page.click(`${sheet} [data-done]`);
  await page.waitForTimeout(250);
  ok((await A(page, "money_wishes")).find((w) => w.id === ws[0].id).done === true, "Als gekauft markiert");
  ok(!(await page.textContent(".fp-lines")).includes("Geplante Wünsche"), "Gekaufter Wunsch zählt nicht mehr");

  /* ---------- Jahreskosten ---------- */
  const y = FP.yearlyFixed({ subs, contracts, today });
  ok((await page.textContent(".fp-year")).includes(M.eur(y.year)) && (await page.$$(".fp-yl li")).length === 3, "Jahreskosten: 3 Posten, Summe " + M.eur(y.year));

  /* ---------- Suche ---------- */
  await page.click("#btn-search");
  await page.fill("#srch-q", "Akku-Schrauber");
  await page.waitForSelector('.srch-group[data-group="geld"]');
  ok((await page.textContent('.srch-group[data-group="geld"]')).includes("Wunsch"), "Globale Suche findet den Wunsch");
  await page.keyboard.press("Escape");

  /* ---------- Geld-Sperre ---------- */
  const lp = await H.newPage();
  await H.boot(lp, { alltag, extra: { "sk-money-lock": { enabled: true, pin: { salt: "c2FsdA", hash: "aGFzaA", iter: 1000, len: 4 } } } });
  await lp.goto(BASE + "#alltag/geld?tab=planen");
  await lp.waitForTimeout(800);
  ok(!(await lp.$(".fp")) && (await lp.$(".ml-pad, .ml-lockscreen, [class*='ml-']")), "Geld gesperrt → Planen nicht sichtbar");
  await lp.context().close();

  /* ---------- Desktop + dunkel ---------- */
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    const p = await H.newPage(scheme, w, h);
    await H.boot(p, { alltag: { ...alltag, money_wishes: [{ id: "w1", name: "Neue Kopfhörer", price: 120, prio: 1, saved: 40, plan: mk }, { id: "w2", name: "Fahrrad", price: 600, prio: 2, saved: 250 }] } });
    await p.goto(BASE + "#alltag/geld?tab=planen");
    await p.waitForSelector(".fp-me");
    await p.fill("#fp-amt", "45");
    await p.waitForSelector(".fp-sim-res");
    await H.shot(p, `finanz-plan-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await p.context().close();
  }
  ok(H.errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (H.errors.length ? ":\n" + H.errors.join("\n") : ""));
  await H.browser.close();
  console.log("\nAlle Finanz-Planungs-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
