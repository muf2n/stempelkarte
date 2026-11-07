// node --test test/app-wishes-core.test.mjs – 💡 App-Wünsche (reine Logik)
import test from "node:test";
import assert from "node:assert/strict";
import * as W from "../js/alltag/app-wishes-core.js";
import { ALLTAG } from "../js/backup-core.js";

test("normWish: Standardwerte und Aufräumen", () => {
  assert.deepEqual(W.normWish({ id: "a", text: "  Mehr   Farben ", prio: "x", status: "y", source: "z", created: 5 }),
    { id: "a", text: "Mehr Farben", area: "", prio: "normal", status: "offen", created: 5, updated: 5, source: "app" });
  assert.equal(W.normWish({ prio: "wichtig", status: "umgesetzt", source: "assistent" }).source, "assistent");
});

test("validate + isDuplicate", () => {
  assert.equal(W.validate({ text: " " }).ok, false);
  assert.equal(W.validate({ text: "x".repeat(501) }).ok, false);
  assert.equal(W.validate({ text: "Dunkelmodus für den Planer", area: "Planer" }).wish.area, "Planer");
  const list = [{ id: "1", text: "Dunkelmodus für den Planer", status: "offen" }, { id: "2", text: "Export", status: "umgesetzt" }];
  assert.equal(W.isDuplicate(list, "dunkelmodus  für den planer"), true);
  assert.equal(W.isDuplicate(list, "Export"), false, "erledigte zählen nicht");
});

test("sortWishes, counts, copyText", () => {
  const list = [
    { id: "1", text: "Alt", created: 1 },
    { id: "2", text: "Neu", created: 3, area: "Geld" },
    { id: "3", text: "Dringend", prio: "wichtig", created: 2 },
    { id: "4", text: "Fertig", status: "umgesetzt", created: 4 },
    { id: "5", text: "", created: 5 },
  ];
  assert.deepEqual(W.sortWishes(list).map((w) => w.id), ["3", "2", "1"]);
  assert.deepEqual(W.sortWishes(list, "alle").map((w) => w.id), ["3", "2", "1", "4"]);
  assert.deepEqual(W.counts(list), { offen: 3, umgesetzt: 1, verworfen: 0, alle: 4 });
  assert.equal(W.copyText(list), "Offene App-Wünsche für die Stempelkarte (3):\n\n1. [WICHTIG] Dringend\n2. [Geld] Neu\n3. Alt");
  assert.equal(W.copyText([]), "");
});

test("Backup sichert app_wishes", () => { assert.ok(ALLTAG.includes("app_wishes")); });
