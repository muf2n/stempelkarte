import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/tycoon-core.js";

const NOW = 1_800_000_000_000;
test("Start, Kaufen, Puffer, Einspeisen", () => {
  let s = T.newState(NOW);
  assert.equal(s.worlds.length, 5);
  s.worlds[0].money = 0; assert.equal(T.buyGen(s, "hamster"), null); // kein Geld
  s.worlds[0].money = 100;
  s = T.buyGen(s, "hamster", 2);
  assert.equal(s.worlds[0].gens.hamster.lvl, 2);
  assert.ok(Math.abs(s.worlds[0].money - (100 - 5 - 5 * 1.15)) < 1e-9);
  s = T.tick(s, 100, { now: NOW + 100e3 });
  assert.equal(s.worlds[0].gens.hamster.buf, 1 * 10); // 2 × 0,5 €/s, Puffer 10 s
  const before = s.worlds[0].money;
  const r = T.collect(s, "hamster");
  assert.equal(r.got, 10); assert.equal(r.s.worlds[0].money, before + 10); assert.equal(r.s.taps, 1);
});

test("Elektriker + Leitung begrenzt, Offline mit Akku", () => {
  let s = T.newState(NOW);
  s.worlds[0].money = 1e6;
  s = T.buyGen(s, "hamster", 50); s = T.hire(s, "hamster");
  const r = T.rates(s, 0);
  assert.equal(r.raw, 0.5 * 50 * 8); // Meilensteine 10/25/50 → ×8
  assert.ok(r.capped); assert.equal(r.auto, T.gridCap(0, 0));
  const off = T.offline({ ...s, last: NOW }, NOW + 10 * 3600e3);
  assert.equal(off.used, 4 * 3600); // Akku 4 h
  assert.ok(Math.abs(off.earned - T.gridCap(0, 0) * 4 * 3600) < 1e-6);
});

test("Welten freischalten, Blitz, Truhe, Erfolge, Meisterbrief, Laden", () => {
  let s = T.newState(NOW);
  assert.equal(T.tryUnlock(s), null);
  s.worlds[0].total = 1e6; s.allTime = 4e6;
  s = T.tryUnlock(s);
  assert.equal(s.unlocked, 1); assert.equal(s.cur, 1); assert.ok(s.worlds[1].money > 0);
  const b = T.blitz(s, { now: NOW }, () => 0); // Turbo
  assert.equal(b.kind, "turbo"); assert.equal(T.mult(b.s, { now: NOW + 1000 }), 7);
  const c = T.chest(s, "2026-11-15", "2026-11-14");
  assert.equal(c.fuses, 3); assert.equal(T.chest(c.s, "2026-11-15", "2026-11-14"), null);
  const c2 = T.chest(c.s, "2026-11-16", "2026-11-15"); assert.equal(c2.streak, 2);
  const a = T.checkAch(s); assert.ok(a.fresh.some((x) => x.id === "w2"));
  assert.equal(T.prestigeGain(s), 2);
  const p = T.prestige(s, NOW);
  assert.equal(p.stars, 2); assert.equal(p.unlocked, 0); assert.equal(p.worlds[0].money, T.START_MONEY);
  assert.ok(Math.abs(T.mult(p, { now: NOW }) - 1.2) < 1e-9);
  const back = T.norm(JSON.parse(JSON.stringify(s)), NOW);
  assert.equal(back.unlocked, 1); assert.equal(back.worlds[0].total, 1e6);
  assert.equal(T.fmt(1234567), "1,23 Mio."); assert.equal(T.fmt(12.34), "12");
});

test("Kette Leitung/Umspannwerk, Vorarbeiter, Booster-Rucksack", () => {
  let s = T.newState(NOW);
  s.worlds[0].money = 1e9;
  s = T.buyGen(s, "hamster", 50); s = T.hire(s, "hamster");
  for (let i = 0; i < 5; i++) s = T.buyGrid(s);
  let r = T.rates(s, 0, { now: NOW });
  assert.equal(r.neck, "umsp"); assert.equal(r.auto, T.umspCap(0, 0)); // Leitung ausgebaut → Umspannwerk bremst
  s = T.abil(s, NOW);
  assert.equal(T.rates(s, 0, { now: NOW + 1000 }).k, 3); assert.equal(T.abil(s, NOW + 60e3), null); // Abklingzeit
  assert.equal(T.rates(s, 0, { now: NOW + 200e3 }).k, 1);
  s = { ...s, inv: { x5: 1 } };
  const u = T.useInv(s, "x5", { now: NOW });
  assert.equal(u.s.inv.x5, undefined); assert.equal(T.mult(u.s, { now: NOW + 1000 }), 5);
  assert.equal(T.useInv(u.s, "x5"), null);
});

test("Expedition: Start, Belohnung fest, Abholen, Fundstück-Effekt, Beschleunigen, Plätze", () => {
  let s = T.newState(NOW); s.fuses = 100;
  s = T.startTour(s, "unbekannt", NOW, () => 0.123);
  assert.equal(T.startTour(s, "bach", NOW), null); // nur 1 Platz
  assert.equal(T.claimTour(s, 0, { now: NOW + 1000 }), null); // noch unterwegs
  const l1 = T.tourLoot(s, s.exp[0]), l2 = T.tourLoot(s, s.exp[0]);
  assert.deepEqual(l1, l2); assert.ok(l1.relic); assert.equal(l1.boosts.length, 3);
  const c = T.claimTour(s, 0, { now: NOW + 13 * 3600e3 });
  assert.equal(c.s.exp.length, 0); assert.equal(c.s.tours, 1); assert.equal(c.s.relics[l1.relic], 1);
  const r = T.RELICS.find((x) => x.id === "lampe");
  assert.ok(Math.abs(T.mult({ ...c.s, relics: { lampe: 2 } }, { now: NOW }) - (1 + 2 * r.v)) < 1e-9);
  let t = T.startTour(c.s, "berg", NOW);
  const cost = T.rushCost(t.exp[0], NOW); assert.equal(cost, 6);
  t = T.rushTour(t, 0, NOW); assert.ok(T.claimTour(t, 0, { now: NOW }));
  const sl = T.buySlot({ ...c.s, fuses: 40 }); assert.equal(sl.slots, 2); assert.equal(sl.fuses, 0);
});

test("Glücksrad: 1× gratis, dann 5 🔩", () => {
  let s = T.newState(NOW); s.fuses = 6;
  const a = T.spin(s, "2026-11-15", { now: NOW }, () => 0.01); // 1. Feld: 3 🔩
  assert.equal(a.free, true); assert.equal(a.s.fuses, 9); assert.equal(a.s.wheelDay, "2026-11-15");
  const b = T.spin(a.s, "2026-11-15", { now: NOW }, () => 0.01);
  assert.equal(b.free, false); assert.equal(b.s.fuses, 9 - 5 + 3);
  assert.equal(T.spin({ ...b.s, fuses: 2 }, "2026-11-15"), null);
  assert.equal(T.norm(JSON.parse(JSON.stringify(b.s))).wheelDay, "2026-11-15");
});

test("Event alle 3 Wochen, eine Woche lang, eigene Wirtschaft + Belohnungen", () => {
  const D = 864e5, e0 = T.EV_EPOCH;
  const a = T.eventInfo(e0 + 2 * D), b = T.eventInfo(e0 + 8 * D), c = T.eventInfo(e0 + 22 * D);
  assert.equal(a.active, true); assert.equal(b.active, false); assert.equal(b.nextStart, e0 + 21 * D); assert.equal(c.active, true);
  assert.notEqual(a.theme.id, c.theme.id);
  const now = e0 + 2 * D;
  let s = T.newState(now);
  const ev = T.evOf(s, now); assert.equal(ev.money, 15);
  const id = ev.theme.gens[0].id;
  s = T.evBuy(s, id, 1, now); assert.equal(T.evOf(s, now).gens[id].lvl, 1);
  s.ev.money = 1e6; s = T.evHire(s, id, now);
  s = T.tick(s, 100, { now: now + 100e3 });
  assert.ok(T.evOf(s, now + 100e3).total > 0);
  s.ev.total = 2e5; const r = T.evClaim(s, now);
  assert.equal(r.s.fuses, 5 + 10); assert.equal(r.s.inv.x3, 1); assert.equal(T.evClaim(r.s, now), null);
  assert.equal(T.evOf(r.s, e0 + 8 * D), null); // vorbei
  assert.equal(T.norm(JSON.parse(JSON.stringify(r.s)), now).ev.claimed.length, 2);
});
