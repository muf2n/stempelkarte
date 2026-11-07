import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../js/freizeit-core.js";

const H = 3600e3;
test("Start: bekannte und eigene Aktivität", () => {
  assert.equal(F.startItem("rad", 1000).label, "Radfahren");
  assert.equal(F.startItem("rad", 1000).cat, "sport");
  assert.equal(F.startItem("eigen", 1, { label: "  Auto putzen ", cat: "zuhause" }).label, "Auto putzen");
  assert.equal(F.startItem("eigen", 1, { label: "Klettern", cat: "sport" }).emoji, "💪");
  assert.equal(F.startItem("eigen", 1, { label: "   " }), null);
});
test("laufende Aktivität und Dauer", () => {
  const items = [{ id: "a", start: 0, end: H }, { id: "b", start: 2 * H, end: null }];
  assert.equal(F.running(items).id, "b");
  assert.equal(F.durMs(items[1], 2.5 * H), 0.5 * H);
  assert.equal(F.running([{ start: 1, end: 2 }]), null);
});
test("Wochen-Zusammenfassung trennt Sport/Zuhause und summiert km", () => {
  const now = new Date(2026, 10, 7, 12).getTime();
  const ws = F.weekStart(now);
  assert.equal(new Date(ws).getDay(), 1);
  const items = [
    { kind: "rad", label: "Radfahren", emoji: "🚴", cat: "sport", start: ws + H, end: ws + 2 * H, km: 20.5 },
    { kind: "rad", label: "Radfahren", emoji: "🚴", cat: "sport", start: ws + 3 * H, end: ws + 3.5 * H, km: 8 },
    { kind: "aufraeumen", label: "Aufräumen", emoji: "🧹", cat: "zuhause", start: ws + 5 * H, end: ws + 5.25 * H },
    { kind: "laufen", label: "Laufen", emoji: "🏃", cat: "sport", start: ws - H, end: ws - 0.5 * H }, // Vorwoche
  ];
  const s = F.summary(items, ws, now);
  assert.equal(s.cats.sport, 1.5 * H);
  assert.equal(s.cats.zuhause, 0.25 * H);
  assert.equal(s.km, 28.5);
  assert.equal(s.list[0].label, "Radfahren");
  assert.equal(s.list[0].n, 2);
});
test("Formatierung und km-Eingabe", () => {
  assert.equal(F.fmtDur(42 * 60e3), "42 Min");
  assert.equal(F.fmtDur(65 * 60e3), "1:05 h");
  assert.equal(F.fmtClock(3723e3), "1:02:03");
  assert.equal(F.parseKm("12,5"), 12.5);
  assert.equal(F.parseKm("abc"), null);
  assert.equal(F.parseKm("-3"), null);
});
