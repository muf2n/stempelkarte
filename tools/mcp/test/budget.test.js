// Update 9 – Budget-Warnungen: Werkzeug „leisten_pruefen“ (Ja / Knapp / Nein, Abos, Kontostand, Sparziel).
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";

const NOW = vt(2026, 11, 19, 10, 0); // Do 19.11.2026 → noch 12 Tage im Monat

async function seeded() {
  const t = await setup({ now: NOW });
  const b = t.base;
  t.g.set(`${b}/a_money_budget/essengehen`, { id: "essengehen", amount: 100 });
  t.g.set(`${b}/a_money_tx/t1`, { id: "t1", date: "2026-11-03", amount: 62, type: "out", category: "essengehen", note: "Döner" });
  t.g.set(`${b}/a_money_tx/t2`, { id: "t2", date: "2026-11-10", amount: 900, type: "in", category: "einkommen", note: "Lehrlingsentschädigung" });
  return t;
}

test("leisten_pruefen: Ja / Knapp / Nein im Kategorie-Budget, Kategorie aus der Notiz", async () => {
  const t = await seeded();
  let r = await t.tool("leisten_pruefen", { betrag: 12, notiz: "Pizza" });
  assert.ok(!r.isError, r.text);
  assert.match(r.text, /^✅ Ja – danach noch 26 € im Budget Essen gehen/);
  assert.match(r.text, /Kategorie: 🍔 Essen gehen \(aus der Notiz erkannt\)/);
  assert.match(r.text, /eingetragen wurde nichts/);
  r = await t.tool("leisten_pruefen", { betrag: "35", kategorie: "Essen gehen" });
  assert.match(r.text, /^⚠️ Knapp – danach nur noch 3 € im Budget Essen gehen/);
  r = await t.tool("leisten_pruefen", { betrag: 52, notiz: "Restaurant" });
  assert.match(r.text, /^🛑 Nein – damit wärst du 14 € über dem Budget Essen gehen \(noch 12 Tage im Monat\)/);
  assert.match(r.text, /BAWAG-App \(Karten → Limits\)/);
  assert.equal(t.g.list(`${t.base}/a_money_tx`).length, 2, "nichts gebucht");
  r = await t.tool("leisten_pruefen", { betrag: 0 });
  assert.ok(r.isError);
});

test("leisten_pruefen: Handy um 300 € – Kontostand, Abos bis Monatsende, Sparziel", async () => {
  const t = await seeded();
  const b = t.base;
  t.g.set(`${b}/meta/bank`, { linked: true, aspsp: "BAWAG", balance: { amount: 320, currency: "EUR", at: NOW } });
  t.g.set(`${b}/a_money_subs/s1`, { id: "s1", name: "Spotify", amount: 30, interval: "month", next: "2026-11-25", category: "abos" });
  let r = await t.tool("leisten_pruefen", { betrag: 300, notiz: "Handy" });
  assert.match(r.text, /^🛑 Nein – dein Konto wäre danach mit 10 € im Minus/);
  assert.match(r.text, /Konto: 320,00 € − 30 € Abos bis Monatsende → danach −10,00 €/);
  t.g.set(`${b}/meta/bank`, { linked: true, aspsp: "BAWAG", balance: { amount: 700, currency: "EUR", at: NOW } });
  t.g.set(`${b}/a_money_goals/g1`, { id: "g1", name: "Moped", emoji: "🏍️", target: 2000, saved: 0, date: "2027-03-31" });
  r = await t.tool("leisten_pruefen", { betrag: 300, notiz: "Handy" });
  assert.match(r.text, /^⚠️ Knapp/);
  assert.match(r.text, /Dein Sparziel 🏍️ Moped bekäme diesen Monat dann weniger/);
  r = await t.tool("leisten_pruefen", { betrag: 50, notiz: "Handy" });
  assert.match(r.text, /^✅ Ja – am Konto bleiben danach 620,00 €/);
});
