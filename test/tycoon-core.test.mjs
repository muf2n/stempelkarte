import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../js/tycoon-core.js";

const NOW = 1_800_000_000_000;
test("Kreislauf von Hand: Stollen → Wagen → Lift → Umspannwerk → Transporter → Börse", () => {
  let s = T.newState(NOW);
  assert.equal(s.worlds.length, 5);
  s.worlds[0].money = 0; assert.equal(T.buyGen(s, "hamster"), null); // kein Geld
  s.worlds[0].money = 100;
  s = T.buyGen(s, "hamster", 2);
  assert.equal(s.worlds[0].gens.hamster.lvl, 2);
  s = T.tick(s, 100, { now: NOW + 100e3 });
  assert.equal(s.worlds[0].gens.hamster.buf, 0); // ohne Elektriker kein Abbau
  let r = T.collect(s, "hamster", NOW); // eine Runde Abbau: 2 × 0,5 €/s × 8 s
  assert.equal(r.got, 8); s = r.s; assert.equal(s.worlds[0].gens.hamster.buf, 8);
  assert.equal(T.collect(s, "hamster", NOW + 1000).got, 0); // Abklingzeit
  const m0 = s.worlds[0].money;
  r = T.liftTap(s, NOW); s = r.s; assert.equal(r.got, 8); assert.equal(s.worlds[0].surf, 8); assert.equal(s.worlds[0].money, m0); // noch kein Geld
  r = T.transTap(s, NOW); s = r.s; assert.equal(r.got, 8); assert.equal(s.worlds[0].money, m0 + 8); assert.equal(s.worlds[0].surf, 0);
  const all = T.collectAll(s, NOW + 20e3); assert.equal(all.got, 8); // „Alles“ macht die ganze Kette
});

test("Manager: alles automatisch, begrenzt durch Leitung; Offline mit Akku", () => {
  let s = T.newState(NOW);
  s.worlds[0].money = 1e6;
  s = T.buyGen(s, "hamster", 50); s = T.hire(s, "hamster");
  assert.equal(T.rates(s, 0).auto, 0); assert.equal(T.rates(s, 0).neck, "liftmgr"); // ohne Liftwart kein Fluss
  s = T.hireLift(s); s = T.hireTrans(s);
  const r = T.rates(s, 0);
  assert.equal(r.raw, 0.5 * 50 * 8); // Meilensteine 10/25/50 → ×8
  assert.ok(r.capped); assert.equal(r.auto, T.gridCap(0, 0));
  const off = T.offline({ ...s, last: NOW }, NOW + 10 * 3600e3);
  assert.equal(off.used, 4 * 3600); // Akku 4 h
  assert.ok(Math.abs(off.earned - T.gridCap(0, 0) * 4 * 3600) < 1e-6);
  assert.ok(off.s.worlds[0].gens.hamster.buf > 0); // Rest wartet im Wagen
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
  s = T.hireLift(s); s = T.hireTrans(s);
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

test("Kasse anderer Welten, Manager-Fähigkeit, Stationen in Mengen", () => {
  let s = T.newState(0);
  s.unlocked = 1; s.worlds[0].gens.hamster = { lvl: 10, mgr: true, buf: 0, cd: 0 }; s.worlds[0].liftMgr = true; s.worlds[0].transMgr = true; s.worlds[0].surf = 50;
  s.cur = 1; // woanders unterwegs → Welt 1 sammelt in der Kasse
  const m0 = s.worlds[0].money;
  s = T.tick(s, 10, { now: 0 });
  assert.equal(s.worlds[0].money, m0); assert.ok(s.worlds[0].idle > 0);
  const idle = s.worlds[0].idle, r = T.collectIdle(s);
  assert.ok(Math.abs(r.s.worlds[0].money - (m0 + idle)) < 1e-6 && r.s.worlds[0].idle === 0);
  s.fuses = 5; const r2 = T.collectIdle(s, 0, true); assert.ok(Math.abs(r2.got - idle * 2) < 1e-6 && r2.s.fuses === 2);
  assert.ok(T.goWorld(s, 0).worlds[0].money > m0, "Hinfahren holt die Kasse ab");
  // Fähigkeit nur mit Manager, danach Abklingzeit
  s.cur = 0;
  assert.equal(T.mabUse(s, "kurbel", 0), null);
  const a = T.mabUse(s, "hamster", 1000); assert.ok(a);
  assert.ok(Math.abs(T.rates(a, 0, { now: 2000 }).per.hamster / T.rates(s, 0, { now: 2000 }).per.hamster - T.MAB.m) < 1e-9);
  assert.equal(T.mabUse(a, "hamster", 5000), null);
  assert.ok(T.rates(T.mabUse(s, "lift", 0), 0, { now: 1 }).cap > T.rates(s, 0, { now: 1 }).cap);
  assert.ok(T.mgrInfo(s, 0, "lift").name && T.mgrInfo(s, 0, "trans").ab === "Liefern ×3");
  // Mehrere Stufen auf einmal = Summe der Einzelpreise
  const c3 = T.gridCost(0, 2, 3), sum = T.gridCost(0, 2) + T.gridCost(0, 3) + T.gridCost(0, 4);
  assert.ok(Math.abs(c3 - sum) / sum < 1e-9);
  s.worlds[0].money = sum; assert.equal(T.stMaxBuy(0, "lift", 2, sum), 3);
  s.worlds[0].grid = 2; assert.equal(T.buyGrid(s, 3).worlds[0].grid, 5);
  assert.ok(T.shaftStats(s, 0, "hamster", 30).workers === 2 && T.stationStats(0, "trans", 15).trucks === 2);
});
