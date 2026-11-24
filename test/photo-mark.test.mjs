import { test } from "node:test";
import assert from "node:assert/strict";
import { rectFrom } from "../js/alltag/photo-mark.js";

test("Markier-Rahmen: Richtung egal, aufs Bild begrenzt, zu klein = nichts", () => {
  assert.deepEqual(rectFrom({ x: 300, y: 400 }, { x: 100, y: 100 }, 1000, 800), { x: 100, y: 100, w: 200, h: 300 });
  assert.deepEqual(rectFrom({ x: -50, y: 700 }, { x: 200, y: 900 }, 1000, 800), { x: 0, y: 700, w: 200, h: 100 });
  assert.equal(rectFrom({ x: 10, y: 10 }, { x: 20, y: 20 }, 1000, 800), null);
});
