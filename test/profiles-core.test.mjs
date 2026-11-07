// node --test test/profiles-core.test.mjs – Update 10 F: Profile (Dashboard + Mitteilungen + Privat-Modus) und Module ein/aus.
import test from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/profiles-core.js";
import * as D from "../js/dashboard-core.js";
import * as N from "../js/notify-core.js";
import { MODULES } from "../js/alltag/modules.js";

const mode = (privat) => ({ privat, since: 1, until: null, source: "manual" });

test("Vorgaben: nur bekannte Widgets und Mitteilungs-Kategorien, alle Module bekannt", () => {
  const mods = MODULES.map((m) => m.id);
  for (const p of P.PROFILES.filter((x) => x.dashboard)) {
    for (const id of [...p.dashboard.order, ...p.dashboard.hidden]) assert.ok(D.IDS.includes(id), `${p.id}: Widget ${id}`);
    for (const c of p.mute) assert.ok(N.CAT_IDS.includes(c), `${p.id}: Kategorie ${c}`);
  }
  for (const [m, cats] of Object.entries(P.MODULE_NOTIFY)) { assert.ok(mods.includes(m), m); cats.forEach((c) => assert.ok(N.CAT_IDS.includes(c), c)); }
  for (const [w, ms] of Object.entries(P.WIDGET_MODULES)) { assert.ok(D.IDS.includes(w), w); ms.forEach((m) => assert.ok(mods.includes(m), m)); }
  for (const m of Object.values(P.SEARCH_MODULE)) assert.ok(mods.includes(m), m);
  assert.ok(mods.includes("elektro"), "Elektro-Tools als Modul");
});

test("Profil wechseln: eigener Stand wird gesichert, Vorgabe angewandt, Privat-Modus, zurück zu Standard", () => {
  const s0 = { dashboard: { order: ["tip", "agenda"], hidden: ["money"], auto: false }, notify: { off: ["backup"] } };
  const p1 = P.switchProfile(s0, "arbeit", { modeFn: mode });
  assert.equal(p1.profiles.active, "arbeit");
  assert.deepEqual(p1.profiles.slots.standard, { dashboard: { order: ["tip", "agenda"], hidden: ["money"], auto: false }, notifyOff: ["backup"] });
  assert.equal(p1.dashboard.order[0], "site");
  assert.ok(p1.dashboard.hidden.includes("money"));
  assert.ok(p1.notify.off.includes("haushalt"));
  assert.deepEqual(p1.mode, mode(false), "Arbeit-Profil → Arbeit-Modus");
  // Im Profil anpassen, dann zu Privat
  const s1 = { ...s0, ...p1, dashboard: { ...p1.dashboard, hidden: [...p1.dashboard.hidden, "tip"] } };
  const p2 = P.switchProfile(s1, "privat", { modeFn: mode });
  assert.ok(p2.profiles.slots.arbeit.dashboard.hidden.includes("tip"), "Anpassung im Profil gemerkt");
  assert.deepEqual(p2.mode, mode(true));
  assert.ok(p2.notify.off.includes("arbeitszeit"));
  // zurück zu Standard → eigener Stand, Privat endet
  const s2 = { ...s1, ...p2 };
  const p3 = P.switchProfile(s2, "standard", { modeFn: mode });
  assert.deepEqual(p3.dashboard, s0.dashboard);
  assert.deepEqual(p3.notify.off, ["backup"]);
  assert.deepEqual(p3.mode, mode(false), "Privat-Profil verlassen → Privat aus");
  // zurück zu Arbeit → gemerkter Stand
  const p4 = P.switchProfile({ ...s2, ...p3 }, "arbeit", { modeFn: mode });
  assert.ok(p4.dashboard.hidden.includes("tip"));
  // Schule hat kein Privat-Flag → Modus bleibt
  assert.equal("mode" in P.switchProfile(s0, "schule", { modeFn: mode }), false);
  // unbekanntes Profil → Standard
  assert.equal(P.switchProfile(s0, "quatsch").profiles.active, "standard");
  // dashboard-core versteht das Ergebnis
  assert.deepEqual(D.arrange(p1.dashboard, "day").slice(0, 3), ["site", "weather", "agenda"]);
});

test("Profil zurücksetzen: Slot = null (Firestore-merge), aktives Profil bekommt Vorgabe", () => {
  const s = { profiles: { active: "fokus", slots: { fokus: { dashboard: { order: ["tip"], hidden: [], auto: false }, notifyOff: [] } } } };
  const r = P.resetProfile(s, "fokus");
  assert.equal(r.profiles.slots.fokus, null);
  assert.deepEqual(r.dashboard.order, ["agenda", "tip"]);
  assert.ok(r.notify.off.includes("geld"));
  assert.equal(P.readProfiles({ profiles: r.profiles }).slots.fokus, undefined);
});

test("Module ein/aus: Mitteilungen, Widgets (erst wenn alle Module aus), Suche", () => {
  let s = {};
  s = { modules: P.toggleModule(s, "geld", false) };
  s = { modules: P.toggleModule(s, "werkzeug", false) };
  assert.deepEqual(s.modules, { off: ["geld", "werkzeug"] });
  assert.ok(P.mutedByModules(s).has("geld"));
  assert.deepEqual([...P.hiddenWidgetsByModules(s)], ["money"], "faellig bleibt, solange Fahrzeuge an sind");
  s = { modules: P.toggleModule(s, "fahrzeuge", false) };
  assert.ok(P.hiddenWidgetsByModules(s).has("faellig"));
  assert.equal(P.searchAllowed(s, { t: "geld" }), false);
  assert.equal(P.searchAllowed(s, { t: "hash", hash: "#alltag/werkzeug/abc" }), false);
  assert.equal(P.searchAllowed(s, { t: "todo" }), true);
  s = { modules: P.toggleModule(s, "geld", true) };
  assert.equal(P.moduleOn(s, "geld"), true);
  // notify-core: effectiveOff ohne die eigenen Einstellungen zu verändern
  const st = { modules: { off: ["schule"] }, notify: { off: ["backup"] } };
  assert.deepEqual([...N.readPrefs(st).off], ["backup"]);
  assert.deepEqual([...N.effectiveOff(st)].sort(), ["backup", "schule"]);
  const items = N.collect({ now: new Date(2026, 10, 9, 15).getTime(), settings: st, todos: [], cols: { school_exams: [{ id: "x", kind: "Test", subject: "Mathe", date: "2026-11-10" }], school_tasks: [] }, loaded: { school_exams: true, school_tasks: true } });
  assert.equal(items.some((i) => i.kind === "schule"), false, "Schul-Mitteilungen weg, wenn Modul aus");
});
