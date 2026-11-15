import { test } from "node:test";
import assert from "node:assert/strict";

test("Coach: scheinbar gedeckte Figur – Zurückschlagen scheitert an einer Gabel", async () => {
  const C = await import("../js/alltag/schach-coach.js");
  const start = "1r2kbnr/1ppqp1pp/4b3/pN2pp2/1nPP4/1P1B1N2/P4PPP/R1BQK2R w KQk - 0 10";
  const r = C.explain({ start, moves: ["e1g1", "b4d3"], ev: [80, -240, -240], best: ["f3e5", "b4d3"], an: { moves: [{ cls: "blund" }, { cls: "best" }] }, k: 0, who: (s) => (s === "w" ? "Du" : "Bot") });
  const t = r.lines.join(" ");
  assert.match(t, /Qxd3\*\* geht nicht/); assert.match(t, /Gabel/); assert.match(t, /diese Gabel gar nicht gegeben/);
  assert.doesNotMatch(t, /König in Sicherheit/);
});
