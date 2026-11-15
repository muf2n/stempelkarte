import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/alltag/steuer-core.js";

test("Tarif 2025/2026", () => {
  assert.equal(S.tarif(2025, 13000), 0);
  assert.equal(S.tarif(2025, 21617), Math.round((21617 - 13308) * 0.2 * 100) / 100);
  assert.equal(S.tarif(2026, 30000), Math.round(((21992 - 13539) * 0.2 + (30000 - 21992) * 0.3) * 100) / 100);
});
test("Pendlerpauschale + Pendlereuro mit Tagen je Monat", () => {
  assert.equal(S.ppMonth(25, false), 58); assert.equal(S.ppMonth(10, false), 0); assert.equal(S.ppMonth(10, true), 31); assert.equal(S.ppMonth(65, true), 306);
  const days = [20, 20, 20, 20, 20, 20, 0, 9, 5, 20, 20, 20]; // Juli Berufsschule
  const p = S.pendler(2026, 25, true, days);
  assert.equal(p.pp, 9 * 123 + 82 + 41); // 9 volle Monate, Aug 2/3, Sep 1/3, Juli 0
  assert.equal(p.pe, 125); // 6 € × 25 km × 10/12
  const ent = [{ start: new Date(2026, 0, 5, 7).getTime(), kind: "work" }, { start: new Date(2026, 0, 5, 14).getTime(), kind: "work" }, { start: new Date(2026, 0, 6).getTime(), kind: "schule" }, { start: new Date(2026, 1, 2).getTime(), kind: "urlaub" }];
  assert.deepEqual(S.pendelDays(ent, 2026).slice(0, 2), [1, 1]);
});
test("Schätzung: Lehrling ohne Lohnsteuer bekommt SV-Rückerstattung", () => {
  const r = S.estimate({ year: 2025, kz245: 11000, sv: 1600, lst: 0, pp: 0, pe: 0, wk: 50 });
  assert.equal(r.tax, 0); assert.equal(r.refundSV, 880); assert.equal(r.gut, 880);
  const r2 = S.estimate({ year: 2026, kz245: 30000, sv: 5000, lst: 3200, pp: 1476, pe: 150, wk: 400 });
  assert.ok(r2.tax > 0 && r2.gut > 0); assert.equal(r2.wkBonus, 268);
  const tx = [{ id: "a", type: "out", date: "2025-03-01", category: "werkzeug", amount: 49.9, note: "Abisolierzange" }, { id: "b", type: "out", date: "2025-03-01", category: "essen", amount: 9 }];
  assert.deepEqual(S.wkFromMoney(tx, 2025).map((x) => [x.kz, x.amt]), [[719, 49.9]]);
});
test("Zahleneingabe", () => { assert.equal(S.num("1.234,56"), 1234.56); assert.equal(S.num("49.9"), 49.9); assert.equal(S.num("12 500 €"), 12500); assert.equal(S.num(7), 7); });
