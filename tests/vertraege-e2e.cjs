// Playwright-Test für Alltag › 📜 Verträge (Update 10 E) im lokalen Modus.
//   cd <worktree> && python3 -m http.server 9412 &   then   node tests/vertraege-e2e.cjs [screenshot-dir]
// Leer + Abo-Hinweis („als Vertrag verwalten“), Anlegen mit Laufzeit/Frist (Status = reine Logik), Ansicht „Frist bald“, Preisänderung
// mit Verlauf, als gekündigt markieren/zurücknehmen, Abo verknüpfen statt kopieren (Kosten nicht doppelt), Abgleich im Formular,
// Benachrichtigung, globale Suche, 📎 Dokumente, Löschen, 1440 hell/dunkel.
const path = require("path");
const { harness, inDays, shiftMonths } = require("./akten-harness.cjs");
const BASE = process.env.BASE || "http://localhost:9412/";
const OUT = process.argv[2] || require("os").tmpdir();

(async () => {
  const V = await import(path.join(__dirname, "../js/alltag/vertraege-core.js"));
  const H = await harness(BASE, OUT);
  const { ok, A, sheet } = H;
  const page = await H.newPage();
  const sub = { id: "s1", name: "Magenta Mobil", amount: 25, interval: "month", next: inDays(5), contractType: "Mindestlaufzeit", minTermEnd: inDays(200), noticeText: "1 Monat", category: "abos" };
  await H.boot(page, { alltag: { money_subs: [sub] } });

  await page.goto(BASE + "#alltag");
  await page.waitForSelector('.al-tile[data-id="vertraege"]');
  await page.click('.al-tile[data-id="vertraege"]');
  await page.waitForSelector(".vt .ak-empty");
  ok((await page.textContent(".vt .ak-empty")).includes("Noch keine Verträge"), "Leerer Zustand");
  ok((await page.textContent(".vt-subhint")).includes("Magenta Mobil"), "Hinweis: Abo mit Mindestlaufzeit → als Vertrag verwalten");
  await H.shot(page, "vertraege-empty-390-light.png");

  /* ---------- Anlegen ---------- */
  await page.click('.vt [data-vt="new"]');
  await page.waitForSelector("#vt-f-name");
  await page.click(`${sheet} [data-kind="strom"]`);
  await page.fill("#vt-f-name", "Strom Wohnung");
  await page.fill("#vt-f-prov", "Musterstrom");
  await page.fill("#vt-f-cno", "K-12345");
  await page.fill("#vt-f-amt", "59,90");
  const start = shiftMonths(inDays(21), -11);
  await page.fill("#vt-f-start", start);
  await page.fill("#vt-f-min", "12");
  await page.fill("#vt-f-notice", "1 Monat");
  await H.shot(page, "vertraege-form-390-light.png");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".vt .ak-det");
  let list = await A(page, "vertraege");
  ok(list.length === 1 && list[0].kind === "strom" && list[0].amount === 59.9 && list[0].minMonths === 12 && list[0].noticeText === "1 Monat" && list[0].autoRenew === true, "Vertrag gespeichert (Art, Betrag, Mindestlaufzeit, Frist, Verlängerung)");
  const c1 = list[0];
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  ok((await page.textContent(".vt-status")) === V.statusLine(c1, today), "Statuszeile = reine Logik: " + V.statusLine(c1, today));
  const st = V.termStatus(c1, today);
  ok(st.daysToDeadline >= 0 && st.daysToDeadline <= 30, "Kündigungsfrist in " + st.daysToDeadline + " Tagen");
  ok((await page.textContent(".ak-det")).includes("718,80"), "Kosten pro Jahr (12 × 59,90 €)");
  ok((await page.textContent(".ak-det")).includes("📎 Dokumente"), "📎 Dokumente-Bereich auf der Vertragsseite");
  await H.shot(page, "vertraege-detail-390-light.png");

  /* ---------- Preisänderung ---------- */
  await page.click('[data-vt="price"]');
  await page.waitForSelector("#vt-p-amt");
  await page.fill("#vt-p-amt", "64,50");
  await page.fill("#vt-p-note", "Indexanpassung");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".vt-prices");
  ok((await page.textContent(".vt-prices")).includes("+4,60") && (await page.textContent(".vt-prices")).includes("Indexanpassung"), "Preisverlauf mit Differenz und Grund");
  ok((await page.textContent(".ak-det")).includes("774,00"), "Neuer Jahrespreis");

  /* ---------- gekündigt ---------- */
  await page.click('[data-vt="cancel"]');
  await page.waitForSelector("#vt-c-end");
  ok((await page.inputValue("#vt-c-end")) === st.end, "Vorschlag „läuft bis“ = Laufzeitende");
  await page.click(`${sheet} [data-save]`);
  await page.waitForTimeout(250);
  ok((await page.textContent(".vt-status")).startsWith("✉️ Gekündigt"), "Als gekündigt markiert");
  await page.click('[data-vt="uncancel"]');
  await page.waitForTimeout(250);
  ok((await page.textContent(".vt-status")).includes("Kündigen bis"), "Kündigung zurückgenommen");

  /* ---------- Liste + Ansicht „Frist bald“ ---------- */
  await page.click('[data-vt="back"]');
  await page.waitForSelector(".vt .ak-list");
  await page.click('[data-view="frist"]');
  ok((await page.$$(".vt .ak-card")).length === 1 && (await page.$(".vt .ak-card.is-warn")), "Ansicht „Frist bald“ zeigt den Vertrag");

  /* ---------- Abo verknüpfen statt kopieren ---------- */
  await page.click('.vt-subhint [data-vt="fromsub"]');
  await page.waitForSelector("#vt-f-name");
  ok((await page.inputValue("#vt-f-name")) === "Magenta Mobil" && (await page.textContent(`${sheet} .vt-subm`)).includes("Verknüpft mit dem Abo"), "Formular aus Abo vorbelegt + verknüpft");
  ok(await page.$eval(`${sheet} .vt-amount`, (e) => e.hidden), "Betrag ausgeblendet (zählt beim Abo)");
  await page.click(`${sheet} [data-kind="handy"]`);
  await page.fill("#vt-f-start", shiftMonths(inDays(200), -24));
  await page.fill("#vt-f-min", "24");
  await page.click(`${sheet} [data-save]`);
  await page.waitForSelector(".vt .ak-det");
  list = await A(page, "vertraege");
  const c2 = list.find((x) => x.subId === "s1");
  ok(c2 && c2.kind === "handy" && c2.noticeText === "1 Monat" && !c2.amount, "Vertrag mit Abo verknüpft (Frist übernommen, kein doppelter Betrag)");
  ok((await page.textContent(".ak-det")).includes("kommt aus dem Abo"), "Kosten-Hinweis: kommt aus dem Abo");
  ok((await A(page, "money_subs")).length === 1, "Abo bleibt wie es ist (nicht kopiert)");
  await page.click('[data-vt="back"]');
  await page.click('[data-view="laufend"]');
  await page.waitForSelector(".vt .ak-list");
  ok(!(await page.textContent(".vt-subhint")), "Abo-Hinweis verschwindet nach dem Verknüpfen");
  ok((await page.textContent(".vt-sum")).includes("64,50") && (await page.textContent(".vt-sum")).includes("+ Abos"), "Summe nur ohne Abo-Verträge (+ Abos)");

  /* ---------- Abgleich beim Tippen ---------- */
  await page.evaluate(() => { const l = JSON.parse(localStorage.getItem("sk-a-money_subs")); l.push({ id: "s2", name: "FitGym Premium", amount: 30, interval: "month", next: "2030-01-01" }); localStorage.setItem("sk-a-money_subs", JSON.stringify(l)); window.dispatchEvent(new StorageEvent("storage", { key: "sk-a-money_subs" })); });
  await page.waitForTimeout(200);
  await page.click('.vt [data-vt="new"]');
  await page.waitForSelector("#vt-f-name");
  await page.fill("#vt-f-prov", "FitGym");
  await page.waitForSelector(`${sheet} [data-sub="s2"]`);
  ok((await page.textContent(`${sheet} .vt-subm`)).includes("FitGym Premium"), "Gleicher Anbieter wie ein Abo → Vorschlag „Als Vertrag verwalten“");
  await page.click(`${sheet} .close`);

  /* ---------- Benachrichtigung + Suche ---------- */
  await page.click("#btn-notify");
  await page.waitForSelector("#notify-layer .nt-panel", { state: "visible" });
  await page.waitForTimeout(300);
  ok((await page.textContent("#nt-body")).includes("Strom Wohnung") && (await page.textContent("#nt-body")).includes("Kündigungsfrist endet"), "Benachrichtigung „Kündigungsfrist endet …“");
  ok(!(await page.textContent("#nt-body")).includes("64,50"), "Ohne Beträge in der Benachrichtigung");
  await page.click("#nt-body [data-nt]");
  await page.waitForFunction((id) => location.hash === "#alltag/vertraege/" + id, c1.id);
  ok(true, "Benachrichtigung öffnet den Vertrag");
  await page.click("#btn-search");
  await page.fill("#srch-q", "Musterstrom");
  await page.waitForSelector('.srch-group[data-group="vertraege"]');
  ok((await page.textContent('.srch-group[data-group="vertraege"]')).includes("Strom Wohnung"), "Globale Suche findet den Vertrag");
  await page.keyboard.press("Escape");

  /* ---------- Löschen ---------- */
  await page.goto(BASE + "#alltag/vertraege/" + c2.id);
  await page.waitForSelector('[data-vt="del"]');
  await page.click('[data-vt="del"]');
  await page.click('[data-vt="del"]');
  await page.waitForFunction(() => location.hash === "#alltag/vertraege");
  ok((await A(page, "vertraege")).length === 1, "Vertrag gelöscht");

  /* ---------- Desktop + dunkel ---------- */
  for (const [scheme, w, h] of [["dark", 1440, 900], ["light", 1440, 900], ["dark", 390, 844]]) {
    const p = await H.newPage(scheme, w, h);
    await H.boot(p, { alltag: { money_subs: [sub], vertraege: [{ ...c1, prices: [{ from: today, amount: 64.5, note: "Indexanpassung" }] }, { id: "c3", name: "Haushaltsversicherung", kind: "versicherung", provider: "Muster Versicherung", amount: 180, interval: "year", start: "2024-03-01", minMonths: 36, noticeText: "3 Monate" }] } });
    await p.goto(BASE + "#alltag/vertraege");
    await p.waitForSelector(".vt .ak-list");
    await H.shot(p, `vertraege-list-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Liste ohne waagrechtes Scrollen (${w} ${scheme})`);
    await p.goto(BASE + "#alltag/vertraege/" + c1.id);
    await p.waitForSelector(".vt .ak-det");
    await H.shot(p, `vertraege-detail-${w}-${scheme}.png`);
    ok(await H.noOverflow(p), `Kein waagrechtes Scrollen (${w} ${scheme})`);
    await p.context().close();
  }
  ok(H.errors.length === 0, "Keine Konsolenfehler/CSP-Verstöße" + (H.errors.length ? ":\n" + H.errors.join("\n") : ""));
  await H.browser.close();
  console.log("\nAlle Verträge-Tests bestanden ✓");
})().catch((e) => { console.error(e); process.exit(1); });
