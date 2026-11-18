import { test } from "node:test";
import assert from "node:assert/strict";
import * as M from "../js/alltag/mindmap-core.js";

const meas = (t) => ({ w: 20 + t.length * 7, h: 30 });

test("Mindmap: bearbeiten, Farben, Löschen ganzer Äste", () => {
  let m = M.newMap("Ohmsches Gesetz", "Elektrotechnik"), n = m.nodes, r;
  r = M.addChild(n, "root", "Spannung U"); n = r.nodes; const u = r.id;
  r = M.addChild(n, "root", "Strom I"); n = r.nodes; const i = r.id;
  r = M.addChild(n, u, "Volt"); n = r.nodes; const v = r.id;
  r = M.addSibling(n, v, "Messung parallel"); n = r.nodes;
  assert.equal(M.kids(n, u).length, 2); assert.equal(M.depthOf(n, v), 2);
  assert.equal(M.branchOf(n, v).id, u); assert.equal(M.colorOf(n, v), M.MM_COLORS[0]); assert.equal(M.colorOf(n, i), M.MM_COLORS[1]);
  n = M.setColor(n, u, "#123456"); assert.equal(M.colorOf(n, v), "#123456");
  n = M.setText(n, v, "  Volt   (V) "); assert.equal(M.nodeOf(n, v).t, "Volt (V)");
  assert.equal(M.setText(n, v, "   "), n, "leerer Text ändert nichts");
  assert.equal(M.removeNode(n, "root"), n, "Mitte bleibt");
  const n2 = M.removeNode(n, u); assert.equal(n2.length, 2);
  const n3 = M.moveSibling(n, i, -1); assert.equal(M.kids(n3, "root")[0].id, i);
  assert.match(M.outline(n), /^Ohmsches Gesetz\n  • Spannung U\n    • Volt \(V\)/);
});

test("Mindmap: Layout links/rechts ohne Überlappung, eingeklappt", () => {
  let n = M.newMap("Mitte").nodes, ids = [];
  for (let k = 0; k < 6; k++) { const r = M.addChild(n, "root", "Ast " + k); n = r.nodes; ids.push(r.id); for (let j = 0; j < 3; j++) n = M.addChild(n, r.id, `Blatt ${k}.${j}`).nodes; }
  const pos = M.layout(n, meas);
  assert.equal(pos.size, n.length);
  const sides = ids.map((id) => pos.get(id).side); assert.ok(sides.includes(1) && sides.includes(-1));
  const boxes = [...pos.values()];
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const A = boxes[a], B = boxes[b], ov = Math.abs(A.x - B.x) < (A.w + B.w) / 2 && Math.abs(A.y - B.y) < (A.h + B.h) / 2;
    assert.ok(!ov, "keine Überlappung");
  }
  const f = M.toggleFold(n, ids[0]); assert.equal(M.layout(f, meas).size, n.length - 3);
  assert.equal(M.addChild(f, ids[0]).nodes.find((x) => x.id === ids[0]).fold, false, "Hinzufügen klappt auf");
});

test("Mindmap: kaputte Daten und KI-Antwort", () => {
  const z = M.normalize({ nodes: [{ id: "a", p: "b", t: "x" }, { id: "b", p: "a", t: "y" }, { id: "r", p: null, t: "Mitte" }, { id: "c", p: "r", t: "ok", c: "javascript:1" }] });
  assert.deepEqual(z.nodes.map((x) => x.id), ["r", "c"]); assert.equal(z.nodes[1].c, undefined);
  const ai = M.fromAI('```json\n{"title":"Drehstrom","children":[{"t":"Leiter","children":["L1","L2",{"t":"L3"}]},"Sternschaltung",{"t":""}]}\n```');
  assert.equal(ai.title, "Drehstrom"); assert.equal(ai.nodes.length, 6);
  assert.equal(M.fromAI("kaputt"), null);
  assert.deepEqual(M.wrap("eins zwei drei vier", 40, (t) => t.length * 4), ["eins zwei", "drei vier"]);
});
