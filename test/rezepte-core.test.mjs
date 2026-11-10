// node --test test/rezepte-core.test.mjs
// Update 12 – Rezepte & Essensplan: Zutaten parsen, Portionen, Koch-Timer, Import, Vorschläge aus dem Vorrat, Einkaufsliste.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../js/alltag/rezepte-core.js";

test("parseIngredient", () => {
  assert.deepEqual(R.parseIngredient("200 g Mehl"), { name: "Mehl", qty: 200, unit: "g" });
  assert.deepEqual(R.parseIngredient("- 2 EL Olivenöl"), { name: "Olivenöl", qty: 2, unit: "EL" });
  assert.deepEqual(R.parseIngredient("1/2 TL Salz"), { name: "Salz", qty: 0.5, unit: "TL" });
  assert.deepEqual(R.parseIngredient("½ Zwiebel"), { name: "Zwiebel", qty: 0.5, unit: "" });
  assert.deepEqual(R.parseIngredient("3 große Eier"), { name: "große Eier", qty: 3, unit: "" });
  assert.deepEqual(R.parseIngredient("500g Faschiertes"), { name: "Faschiertes", qty: 500, unit: "g" });
  assert.deepEqual(R.parseIngredient("Pfeffer"), { name: "Pfeffer", qty: null, unit: "" });
});

test("Portionen umrechnen und hübsch anzeigen", () => {
  assert.equal(R.scaleQty(200, 2, 3), 300);
  assert.equal(R.scaleQty(1, 4, 2), 0.5);
  assert.equal(R.fmtQty(0.5), "½");
  assert.equal(R.fmtQty(1.25), "1¼");
  assert.equal(R.fmtQty(2.4), "2,4");
  assert.equal(R.ingText({ name: "Eier", qty: 3, unit: "" }, 2, 4), "6 Eier");
});

test("Koch-Timer aus Schritten", () => {
  assert.deepEqual(R.stepTimers("Nudeln 10 Minuten kochen, dann 1 Std. ziehen lassen").map((t) => t.sec), [600, 3600]);
  assert.deepEqual(R.stepTimers("8-10 min backen").map((t) => t.sec), [600]);
  assert.deepEqual(R.stepTimers("Gut umrühren"), []);
  assert.equal(R.fmtTimer(3725), "1:02:05");
});

test("Rezept aus Text importieren", () => {
  const r = R.parseRecipeText("Spaghetti Bolognese\nFür 4 Portionen\n30 min\nZutaten\n500 g Spaghetti\n400 g Faschiertes\n1 Zwiebel\nZubereitung\n1. Zwiebel anbraten\n2. Faschiertes 10 Minuten mitbraten");
  assert.equal(r.title, "Spaghetti Bolognese");
  assert.equal(r.servings, 4);
  assert.equal(r.minutes, 30);
  assert.equal(r.ingredients.length, 3);
  assert.deepEqual(r.steps, ["Zwiebel anbraten", "Faschiertes 10 Minuten mitbraten"]);
});

const recipes = [
  { id: "r1", title: "Spaghetti", servings: 2, ingredients: ["250 g Spaghetti", "1 Dose Tomaten", "Salz", "1 Zwiebel"], rating: 4 },
  { id: "r2", title: "Rührei", servings: 1, ingredients: ["3 Eier", "Butter", "Salz"], diet: "vegetarisch", allergens: ["C", "G"] },
];

test("Vorschläge aus dem Vorrat", () => {
  const stock = [{ name: "Spaghetti", qty: 1 }, { name: "Tomaten (Dose)", qty: 2 }, { name: "Eier", qty: 0 }];
  const sg = R.suggestFromStock(recipes, stock);
  assert.equal(sg[0].recipe.id, "r1");
  assert.deepEqual(sg[0].missing, ["Zwiebel"]);
  assert.ok(!sg.some((x) => x.recipe.id === "r2"), "Eier leer → Rührei nicht vorgeschlagen");
});

test("Einkaufsliste aus dem Essensplan, Vorrat wird abgezogen", () => {
  const days = [
    { id: "2026-11-16", meals: { mittag: { recipeId: "r1", servings: 4 } } },
    { id: "2026-11-17", meals: { abend: { recipeId: "r1" }, fruehstueck: { recipeId: "r2" } } },
    { id: "2026-11-30", meals: { mittag: { recipeId: "r1" } } },
  ];
  const list = R.shoppingFromPlan(days, recipes, "2026-11-16", "2026-11-22", [{ name: "Spaghetti", qty: 250, unit: "g" }]);
  const sp = list.find((x) => x.name === "Spaghetti");
  assert.equal(sp.qty, 500, "750 g gebraucht − 250 g im Vorrat");
  assert.equal(list.find((x) => x.name === "Zwiebel").qty, 3);
  assert.ok(!list.some((x) => x.name === "Salz"), "Basics nicht auf die Liste");
  assert.equal(list.find((x) => x.name === "Eier").qty, 3);
});

test("Filter: Allergene, Ernährung, Suche", () => {
  assert.deepEqual(R.filterRecipes(recipes, { noAllergens: ["C"] }).map((r) => r.id), ["r1"]);
  assert.deepEqual(R.filterRecipes(recipes, { diet: "vegetarisch" }).map((r) => r.id), ["r2"]);
  assert.deepEqual(R.filterRecipes(recipes, { q: "zwiebel" }).map((r) => r.id), ["r1"]);
  assert.equal(R.normRecipe({ source: "javascript:x" }).source, "");
  assert.equal(R.mondayOf("2026-11-12"), "2026-11-09");
});
