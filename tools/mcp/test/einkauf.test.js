// Update 10 – Werkzeuge „einkauf_lesen“ und „einkauf_hinzufuegen“: Listen, Kategorien, Mengen zusammenzählen, Material fehlt, neue Liste.
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";

const NOW = vt(2026, 11, 7, 10, 0);

async function seeded() {
  const t = await setup({ now: NOW });
  const b = t.base;
  t.g.set(`${b}/a_einkauf/i1`, { id: "i1", listId: "privat", name: "Milch", qty: 2, unit: "l", cat: "lebensmittel", done: false, created: 1 });
  t.g.set(`${b}/a_einkauf/i2`, { id: "i2", listId: "privat", name: "Brot", cat: "lebensmittel", done: true, doneAt: 5 });
  t.g.set(`${b}/a_einkauf/i3`, { id: "i3", listId: "baustelle", name: "Isolierband", cat: "baumarkt", done: false });
  t.g.set(`${b}/a_einkauf_lists/history`, { id: "history", kind: "history", names: { milch: { name: "Milch", cat: "lebensmittel", unit: "l", count: 3, last: 1 } } });
  t.g.set(`${b}/a_material_items/m1`, { id: "m1", name: "FI-Schalter", qty: 1, unit: "Stk", status: "brauche", place: "Baustelle Muster", dayKey: "2026-11-06" });
  t.g.set(`${b}/a_material_items/m2`, { id: "m2", name: "NYM-J 3×1,5", qty: 25, unit: "m", status: "verbaut", dayKey: "2026-11-06" });
  return t;
}

test("einkauf_lesen: alle Listen nach Kategorie, Erledigtes nur auf Wunsch, Material fehlt dabei", async () => {
  const t = await seeded();
  const r = await t.tool("einkauf_lesen", {});
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /🏠 Privat \(ID privat\) – 1 offen, 1 erledigt\n  🥕 Lebensmittel:\n  - 2 l Milch \(ID i1\)/);
  assert.match(r.text, /🏗️ Baustelle \(ID baustelle\) – 1 offen\n  🔌 Baumarkt\/Elektro:\n  - Isolierband/);
  assert.doesNotMatch(r.text, /Brot/);
  assert.match(r.text, /🧰 Material fehlt \(aus dem Material-Bereich\) – 1 offen\n  - 1 Stk FI-Schalter · Baustelle Muster \(Material-ID m1\)/);
  assert.doesNotMatch(r.text, /NYM/);
  const r2 = await t.tool("einkauf_lesen", { liste: "priv", erledigte: true });
  assert.match(r2.text, /✅ Erledigt:\n  - Brot/);
  assert.doesNotMatch(r2.text, /Isolierband|FI-Schalter/);
  const r3 = await t.tool("einkauf_lesen", { liste: "Material" });
  assert.match(r3.text, /^🧰 Material fehlt/);
  assert.equal((await t.tool("einkauf_lesen", { liste: "Gibtsnicht" })).isError, true);
});

test("einkauf_hinzufuegen: Text zerlegen, Kategorie raten, Menge zusammenzählen, Verlauf", async () => {
  const t = await seeded();
  const r = await t.tool("einkauf_hinzufuegen", { artikel: "1 l Milch, 2 kg Äpfel, Zahnpasta" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Auf „Privat“ geschrieben: 🥕 2 kg Äpfel, 🧴 Zahnpasta\. Stand schon drauf: 3 l Milch\./);
  assert.equal(t.g.list(`${t.base}/a_einkauf`).length, 5, "3 alte + Äpfel + Zahnpasta (Milch nicht doppelt)");
  const milk = t.g.get(`${t.base}/a_einkauf/i1`);
  assert.equal(milk.qty, 3);
  const hist = t.g.get(`${t.base}/a_einkauf_lists/history`);
  assert.equal(hist.names.milch.count, 4);
  assert.equal(hist.names.zahnpasta.cat, "drogerie");
});

test("einkauf_hinzufuegen: andere Liste, neue Liste, feste Kategorie, Fehler", async () => {
  const t = await seeded();
  let r = await t.tool("einkauf_hinzufuegen", { artikel: ["Kabelbinder"], liste: "baust" });
  assert.match(r.text, /Auf „Baustelle“ geschrieben: 🔌 Kabelbinder\./);
  r = await t.tool("einkauf_hinzufuegen", { artikel: ["Luftballons", "Chips"], liste: "Party", kategorie: "sonstiges" });
  assert.match(r.text, /Neue Liste „Party“ angelegt\. Auf „Party“ geschrieben: 📦 Luftballons, 📦 Chips\./);
  const lists = t.g.list(`${t.base}/a_einkauf_lists`);
  assert.equal(lists.length, 2, "history + Party");
  assert.equal((await t.tool("einkauf_hinzufuegen", { artikel: [] })).isError, true);
  assert.equal((await t.tool("einkauf_hinzufuegen", { artikel: "x", kategorie: "Weltraum" })).isError, true);
  assert.match((await t.tool("einkauf_hinzufuegen", { artikel: "Dose", liste: "Material" })).text, /material_anlegen/);
});
