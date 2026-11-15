import test from "node:test";
import assert from "node:assert/strict";
import { lapPlan, daysBetween } from "../js/alltag/lap-plan-core.js";
const topics = [{ id: "a", name: "A", emoji: "⚡" }, { id: "b", name: "B", emoji: "🛡️" }];
const cards = Array.from({ length: 100 }, (_, i) => ({ id: "c" + i, topic: i < 50 ? "a" : "b" }));
test("Lernplan", () => {
  const states = new Map(cards.slice(0, 30).map((c, i) => [c.id, { reps: i < 10 ? 3 : 1, due: "2026-11-15" }]));
  const p = lapPlan({ examDate: "2027-01-14", today: "2026-11-15", cards, states, topics });
  assert.equal(daysBetween("2026-11-15", "2027-01-14"), 60);
  assert.equal(p.left, 60); assert.equal(p.unseen, 70); assert.equal(p.newPerDay, Math.ceil(70 / 53)); assert.equal(p.due, 30);
  assert.equal(p.phase, "lernen"); assert.equal(p.topics[0].id, "b"); assert.equal(p.topics[1].pct, 40); // (10 + 20·0,5)/50
  assert.equal(lapPlan({ examDate: "2026-11-20", today: "2026-11-15", cards, states, topics }).phase, "endspurt");
  assert.equal(lapPlan({ examDate: "", today: "2026-11-15", cards, states, topics }), null);
});
