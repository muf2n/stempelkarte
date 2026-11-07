// node --test test/notify-core.test.mjs – Benachrichtigungszentrale: Sammeln aus echten Quellen, Geld-Sperre, Zustand.
import test from "node:test";
import assert from "node:assert/strict";
import * as N from "../js/notify-core.js";

// Freitag, 06.11.2026, 15:00 Ortszeit
const NOW = new Date(2026, 10, 6, 15, 0).getTime();
const at = (d, h = 8, m = 0) => new Date(2026, 10, d, h, m).getTime();
const ALL = { money_subs: true, money_budget: true, money_tx: true, money_cats: true, school_exams: true, school_tasks: true, material_items: true, berichtsheft: true };

function base(extra = {}) {
  return {
    now: NOW,
    settings: { weeklyTarget: 38.5, balanceStart: "2026-11-02" },
    todos: [
      { id: "t1", kind: "todo", title: "Rechnung zahlen", date: "2026-11-04", done: false },
      { id: "t2", kind: "todo", title: "Werkzeug zurückgeben", date: "2026-11-06", time: "17:00" },
      { id: "t3", kind: "todo", title: "Erledigt", date: "2026-11-05", done: true },
      { id: "t4", kind: "todo", title: "Später", date: "2026-11-20" },
      { id: "vr_abc_3", kind: "todo", title: "Reisepass läuft bald ab", date: "2026-11-06" },
      { id: "c1", kind: "termin", title: "Zahnarzt", date: "2026-11-07", time: "09:30" },
      { id: "c2", kind: "termin", title: "Vorbei", date: "2026-11-06", time: "08:00" },
      { id: "c3", kind: "termin", title: "Training", date: "2026-10-01", time: "18:00", rrule: "FREQ=WEEKLY;BYDAY=FR" },
      { id: "b1", kind: "geburtstag", title: "Oma", bday: "11-07", byear: 1950 },
      { id: "b2", kind: "geburtstag", title: "Weit weg", bday: "12-24" },
    ],
    entries: [
      { id: "e1", kind: "work", start: at(2, 7), end: at(2, 16) },
      { id: "e2", kind: "work", start: at(3, 7), end: at(3, 16) },
      { id: "e3", kind: "work", start: at(5, 7) },
    ],
    running: null,
    cols: {
      money_budget: [{ id: "total", amount: 100 }],
      money_tx: [{ id: "x1", type: "out", amount: 95, date: "2026-11-03", category: "essen" }],
      money_cats: [],
      money_subs: [
        { id: "s1", name: "Handyvertrag", amount: 20, interval: "month", startDate: "2025-11-15", contractType: "Mindestlaufzeit", minTermEnd: "2026-11-14", noticeDays: 3 },
        { id: "s2", name: "Streaming", amount: 9.99, interval: "month", startDate: "2026-01-07", next: "2026-11-07" },
      ],
      school_exams: [{ id: "x1", kind: "Schularbeit", subject: "Mathe", date: "2026-11-09" }, { id: "x2", subject: "Alt", date: "2026-10-01" }],
      school_tasks: [{ id: "h1", subject: "Deutsch", title: "Aufsatz", due: "2026-11-05" }, { id: "h2", title: "Fertig", due: "2026-11-06", done: true }],
      material_items: [{ id: "m1", name: "Kabel NYM 3x1,5", status: "brauche" }, { id: "m2", name: "Dose", status: "verbaut" }],
      berichtsheft: [],
    },
    loaded: ALL,
    moneyLocked: false,
    lastBackupAt: 0,
    hasData: true,
    ...extra,
  };
}

const ids = (list) => list.map((i) => i.id);
const byKind = (list, k) => list.filter((i) => i.kind === k);

test("sammelt aus allen Quellen mit stabilen IDs und Zielen", () => {
  const list = N.collect(base());
  const k = (x) => byKind(list, x);
  assert.deepEqual(ids(k("aufgaben")).sort(), ["todo:t1:2026-11-04", "todo:t2:2026-11-06"]);
  assert.equal(k("aufgaben").find((i) => i.id.startsWith("todo:t1")).prio, 3, "überfällig = dringend");
  assert.equal(k("aufgaben")[0].target.startsWith("todo:"), true);
  assert.deepEqual(ids(k("dokumente")), ["todo:vr_abc_3:2026-11-06"]);
  const ter = k("termine").map((i) => i.title).sort();
  assert.deepEqual(ter, ["Training", "Zahnarzt"], "Serien-Termin heute + Termin morgen, vorbei fällt weg");
  assert.equal(k("geburtstage").length, 1);
  assert.match(k("geburtstage")[0].title, /Oma hat morgen Geburtstag/);
  assert.equal(k("geburtstage")[0].sub, "wird 76");
  assert.ok(k("geld").some((i) => i.id === "budget:total:2026-11:1" && /95\s€ von 100\s€/.test(i.sub)));
  assert.ok(k("schule").some((i) => i.id === "exam:x1:2026-11-09" && /Schularbeit Mathe in 3 Tagen/.test(i.title)));
  assert.ok(k("schule").some((i) => i.id === "hw:h1:2026-11-05" && i.prio === 3));
  assert.equal(k("schule").length, 2);
  assert.equal(k("material").length, 1);
  assert.match(k("material")[0].sub, /Kabel/);
  assert.ok(k("arbeitszeit").some((i) => i.id === "stamp:offen:e3"), "Schicht ohne Ende");
  assert.ok(k("arbeitszeit").some((i) => i.id.startsWith("stamp:leer:") && i.id.includes("2026-11-04")), "Mittwoch ohne Eintrag");
  assert.deepEqual(ids(k("bericht")), ["wr:2026-W45"]);
  assert.equal(k("backup")[0].target, "settings:backup");
  for (const i of list) for (const f of ["id", "kind", "title", "when", "prio", "target"]) assert.ok(i[f] !== undefined && i[f] !== "", `${i.id}.${f}`);
  // sortiert: Priorität absteigend
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].prio >= list[i].prio);
});

test("Geld-Sperre: keine Beträge", () => {
  const list = N.collect(base({ moneyLocked: true }));
  const txt = JSON.stringify(byKind(list, "geld"));
  assert.ok(!/€/.test(txt), txt);
  assert.match(txt, /gesperrt/);
  const open = JSON.stringify(byKind(N.collect(base()), "geld"));
  assert.match(open, /€/);
});

test("Abo: Kündigungsfrist und Abbuchung, Duplikat mit Planer-Erinnerung vermieden", () => {
  const list = N.collect(base());
  const abo = list.filter((i) => i.id.startsWith("abo:s1:"));
  assert.equal(abo.length, 1);
  assert.match(abo[0].title, /Handyvertrag: Kündigungsfrist/);
  assert.ok(list.some((i) => i.id.startsWith("abocharge:s2:")), "Streaming wird bald abgebucht");
  const deadline = abo[0].id.split(":")[2];
  const withTodo = base();
  withTodo.todos.push({ id: `abo_s1_${deadline.replace(/-/g, "")}`, kind: "todo", src: "abo", title: "Handyvertrag kündigen", date: "2026-11-25" });
  assert.ok(!N.collect(withTodo).some((i) => i.id.startsWith("abo:s1:")));
});

test("Kategorien abschaltbar, nicht geladene Sammlungen liefern nichts", () => {
  const off = N.collect(base({ settings: { ...base().settings, notify: { off: ["termine", "geld", "backup", "quatsch"] } } }));
  assert.ok(!off.some((i) => ["termine", "geld", "backup"].includes(i.kind)));
  assert.deepEqual([...N.readPrefs({ notify: { off: ["geld", "x"] } }).off], ["geld"]);
  assert.deepEqual(N.prefsForSave(new Set(["backup", "aufgaben"])), { off: ["aufgaben", "backup"] });
  const nl = N.collect(base({ loaded: {} }));
  assert.ok(!nl.some((i) => ["schule", "material", "bericht"].includes(i.kind) || i.id.startsWith("budget")));
});

test("Backup-Erinnerung nur ohne Backup in 14 Tagen und nur mit Daten; laufende Schicht > 12 h", () => {
  assert.ok(!N.collect(base({ lastBackupAt: NOW - 3 * 86400000 })).some((i) => i.kind === "backup"));
  assert.ok(N.collect(base({ lastBackupAt: NOW - 20 * 86400000 })).some((i) => i.kind === "backup" && /20 Tage/.test(i.sub)));
  assert.ok(!N.collect(base({ hasData: false })).some((i) => i.kind === "backup"));
  const r = N.collect(base({ running: { start: NOW - 13 * 3600e3 } }));
  assert.ok(r.some((i) => i.id.startsWith("stamp:laeuft:") && i.prio === 3));
  // ohne Einträge keine Lücken-Hinweise
  assert.ok(!N.collect(base({ entries: [] })).some((i) => i.kind === "arbeitszeit"));
});

test("Wochenbericht: abgegeben → kein Hinweis; Montag → kein Hinweis", () => {
  assert.ok(!N.collect(base({ cols: { ...base().cols, berichtsheft: [{ id: "2026-W45", status: "abgegeben" }] } })).some((i) => i.kind === "bericht"));
  assert.ok(!N.collect(base({ now: new Date(2026, 10, 2, 15).getTime() })).some((i) => i.kind === "bericht"));
});

test("Gelesen / weggewischt / aufräumen", () => {
  const items = N.collect(base());
  let st = N.emptyState();
  assert.equal(N.unreadCount(items, st), items.length);
  st = N.markRead(st, [items[0].id], NOW);
  assert.equal(N.unreadCount(items, st), items.length - 1);
  st = N.dismiss(st, items[1].id, NOW);
  assert.equal(N.view(items, st).length, items.length - 1);
  assert.ok(!N.view(items, st).some((i) => i.id === items[1].id));
  st = N.markRead(st, items.map((i) => i.id), NOW);
  assert.equal(N.unreadCount(items, st), 0);
  st.read["alt:1"] = NOW - 90 * 86400000;
  st = N.prune(st, items, NOW);
  assert.ok(!("alt:1" in st.read) && items[0].id in st.read);
  assert.deepEqual(N.normState({ read: { a: "x", b: 5 }, dismissed: [] }), { read: { b: 5 }, dismissed: {} });
});

test("Werkzeug- und Fahrzeug-Fälligkeiten erscheinen (und sind abschaltbar)", async () => {
  const N = await import("../js/notify-core.js");
  const now = new Date(2026, 10, 7, 12).getTime();
  const base = { now, todos: [], cols: { werkzeug: [{ id: "t1", name: "Multimeter", cat: "mess", nextCheck: "2026-11-01" }], fahrzeug_info: [{ id: "v1", pickerl: { month: "2026-09" } }], travel_fuel: [] }, loaded: { werkzeug: true, fahrzeug_info: true, travel_fuel: true } };
  const r = N.collect({ ...base, settings: { vehicles: [{ id: "v1", name: "Golf" }] } });
  const w = r.find((x) => x.kind === "werkzeug"), f = r.find((x) => x.kind === "fahrzeug");
  assert.ok(w && w.target === "#alltag/werkzeug/t1" && /Multimeter/.test(w.title));
  assert.ok(f && /Pickerl/.test(f.title) && f.target.startsWith("#alltag/fahrzeuge"));
  const off = N.collect({ ...base, settings: { vehicles: [{ id: "v1", name: "Golf" }], notify: { off: ["werkzeug", "fahrzeug"] } } });
  assert.ok(!off.some((x) => x.kind === "werkzeug" || x.kind === "fahrzeug"));
});

test("Update 10 C: Haushalt (überfällig/heute/Wartung bald) und Gewohnheiten (Serie in Gefahr ab 18 Uhr)", () => {
  const now = new Date(2026, 10, 7, 19, 0).getTime(); // Sa 07.11.2026, 19:00
  const cols = {
    haushalt: [
      { id: "a", title: "Bad putzen", room: "Bad", unit: "w", n: 1, last: "2026-10-28" },
      { id: "b", title: "Staubsaugen", unit: "w", n: 1, last: "2026-11-06" },
      { id: "c", kind: "wartung", title: "Rauchmelder testen", unit: "m", n: 1, last: "2026-10-10" },
    ],
    habits: [{ id: "h1", title: "Lesen", emoji: "📖", log: { "2026-11-05": 1, "2026-11-06": 1 } }],
  };
  const loaded = { haushalt: true, habits: true };
  const r = N.collect({ now, todos: [], cols, loaded });
  const hh = r.filter((x) => x.kind === "haushalt");
  assert.deepEqual(hh.map((x) => x.id).sort(), ["hh:a:2026-11-04", "hh:c:2026-11-10"]);
  const a = hh.find((x) => x.id.startsWith("hh:a"));
  assert.equal(a.prio, 2);
  assert.equal(a.target, "#alltag/haushalt");
  assert.match(a.title, /Bad putzen \(Bad\)/);
  const hb = r.find((x) => x.kind === "gewohnheiten");
  assert.ok(hb && /Lesen/.test(hb.title) && hb.target === "#alltag/routinen");
  assert.ok(!N.collect({ now: new Date(2026, 10, 7, 9).getTime(), todos: [], cols, loaded }).some((x) => x.kind === "gewohnheiten"));
  assert.ok(N.CAT_IDS.includes("haushalt") && N.CAT_IDS.includes("gewohnheiten"));
  assert.deepEqual(N.NEEDS.haushalt, ["haushalt"]);
  const off = N.collect({ now, todos: [], cols, loaded, settings: { notify: { off: ["haushalt", "gewohnheiten"] } } });
  assert.ok(!off.some((x) => x.kind === "haushalt" || x.kind === "gewohnheiten"));
});
