// Stempel-Ablauf über MCP muss dieselben Firestore-Dokumente ergeben wie js/timer.js der Web-App.
import test from "node:test";
import assert from "node:assert/strict";
import { setup, vt } from "./helpers.js";

// Web-App-Store im lokalen Modus (localStorage-Attrappe) – echter timer.js-Code.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const store = await import(new URL("../../../js/store.js", import.meta.url).href);
const timer = await import(new URL("../../../js/timer.js", import.meta.url).href);

const realNow = Date.now;
async function at(ts, fn) {
  Date.now = () => ts;
  try { return await fn(); } finally { Date.now = realNow; }
}
const noId = ({ id, ...rest }) => rest;
const noSrc = ({ src, ...rest }) => rest;

async function seedPlaces(t) {
  t.g.set(`${t.base}/places/p1`, { name: "Baustelle Huber", addr: "Hauptstraße 1, 4020 Linz", lat: 48.3, lng: 14.28, radius: 150 });
  t.g.set(`${t.base}/places/p2`, { name: "Firma Elektro Maier", addr: "Industriezeile 5", lat: 48.31, lng: 14.3, radius: 200 });
  t.g.set(`${t.base}/meta/settings`, { weeklyTarget: 38.5, workDays: [1, 2, 3, 4, 5] });
}

test("Einstempeln → Abschnitt → Pause → Ausstempeln: identisch zu timer.js", async () => {
  mem.clear();
  store.startLocal();
  const t = await setup();
  await seedPlaces(t);
  const T0 = vt(2026, 11, 4, 6, 58), T1 = vt(2026, 11, 4, 7, 31), T2 = vt(2026, 11, 4, 12, 0), T3 = vt(2026, 11, 4, 12, 33), T4 = vt(2026, 11, 4, 15, 30);
  const state = () => t.g.get(`${t.base}/meta/state`);

  // 1) Einstempeln (Ort unscharf: „huber“)
  t.setNow(T0);
  let r = await t.tool("einstempeln", { ort: "huber", taetigkeit: "autofahren" });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Eingestempelt um 06:58/);
  assert.match(r.text, /Baustelle Huber/);
  await at(T0, () => timer.clockIn({ placeId: "p1", place: "Baustelle Huber", activity: "Autofahren" }));
  assert.deepEqual(state().running, store.get().running);
  assert.equal(state().rev, T0);

  // nochmal einstempeln → Fehler, nichts geschrieben
  const before = JSON.stringify(t.g.raw(`${t.base}/meta/state`));
  r = await t.tool("einstempeln", {});
  assert.equal(r.isError, true);
  assert.match(r.text, /schon eingestempelt/);
  assert.equal(JSON.stringify(t.g.raw(`${t.base}/meta/state`)), before);

  // 2) Tätigkeit wechseln
  t.setNow(T1);
  r = await t.tool("abschnitt_wechseln", { taetigkeit: "arbeiten" });
  assert.match(r.text, /Neuer Abschnitt „Arbeiten“ seit 07:31/);
  await at(T1, () => timer.addSegment({ activity: "Arbeiten" }));
  assert.deepEqual(state().running, store.get().running);
  r = await t.tool("abschnitt_wechseln", { taetigkeit: "Arbeiten" });
  assert.match(r.text, /schon bei „Arbeiten“/);

  // 3) Pause start/ende
  t.setNow(T2);
  r = await t.tool("pause", { aktion: "start" });
  assert.match(r.text, /Pause gestartet um 12:00/);
  await at(T2, () => timer.togglePause());
  assert.deepEqual(state().running, store.get().running);
  r = await t.tool("pause", { aktion: "start" });
  assert.match(r.text, /läuft bereits seit 12:00/);
  r = await t.tool("status_heute");
  assert.match(r.text, /Pause: läuft seit 12:00/);
  t.setNow(T3);
  r = await t.tool("pause", { aktion: "ende" });
  assert.match(r.text, /diese Pause 33 min/);
  await at(T3, () => timer.togglePause());
  assert.deepEqual(state().running, store.get().running);
  assert.equal(state().rev, T3);

  // 4) Ausstempeln
  t.setNow(T4);
  r = await t.tool("ausstempeln", {});
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Ausgestempelt um 15:30/);
  assert.match(r.text, /Pause 33 min/);
  const webEntry = await at(T4, () => timer.clockOut());
  assert.deepEqual(state(), { running: null, rev: T4 });
  const ents = t.g.list(`${t.base}/entries`);
  assert.equal(ents.length, 1);
  assert.match(ents[0].id, /^e[0-9a-z]{9}[0-9a-z]{8}$/);
  assert.deepEqual(noId(ents[0]), noId(webEntry));
  const localEntry = store.get().entries[0];
  assert.deepEqual(noId(ents[0]), noId(localEntry));
  assert.equal(ents[0].segments.length, 2);
  assert.equal(ents[0].segments[1].end, T4);
  assert.equal(ents[0].pauseMin, 33);

  // Reihenfolge wie timer.clockOut: zuerst running=null, dann Eintrag – in EINER Transaktion
  const last = t.g.commits[t.g.commits.length - 1];
  assert.ok(last.transaction);
  assert.match(last.writes[0].update.name, /meta\/state$/);
  assert.match(last.writes[1].update.name, /\/entries\/e/);
  assert.ok(!("updateMask" in last.writes[0]), "state wird komplett ersetzt wie setDoc");

  r = await t.tool("ausstempeln", {});
  assert.equal(r.isError, true);
  assert.match(r.text, /nicht eingestempelt/);
  store.stop();
});

test("rev-Regel: rev = max(jetzt, alter rev + 1) auch bei rev aus der Zukunft", async () => {
  const t = await setup();
  await seedPlaces(t);
  const T = vt(2026, 11, 4, 8, 0);
  t.g.set(`${t.base}/meta/state`, { running: null, rev: T + 5000 });
  t.setNow(T);
  await t.tool("einstempeln", { ort: "Firma" });
  assert.equal(t.g.get(`${t.base}/meta/state`).rev, T + 5001);
  assert.equal(t.g.get(`${t.base}/meta/state`).running.place, "Firma Elektro Maier");
});

test("Transaktionskonflikt (ABORTED) wird wiederholt", async () => {
  const t = await setup();
  t.setNow(vt(2026, 11, 4, 8, 0));
  t.g.failNextCommitWithAbort = 2;
  const r = await t.tool("einstempeln", {});
  assert.equal(r.isError, false, r.text);
  assert.ok(t.g.get(`${t.base}/meta/state`).running);
});

test("Konflikt durch parallele Änderung: veralteter Lesestand wird nicht überschrieben", async () => {
  const t = await setup();
  t.setNow(vt(2026, 11, 4, 8, 0));
  await t.tool("einstempeln", {});
  // Zwischen Lesen und Commit ändert die App den Stand → Emulator meldet ABORTED → neuer Versuch liest neu
  const origFetch = t.g.fetch;
  let injected = false;
  t.g.fetch = async (url, init) => {
    if (!injected && String(url).includes(":commit")) {
      injected = true;
      const cur = t.g.get(`${t.base}/meta/state`);
      t.g.set(`${t.base}/meta/state`, { running: { ...cur.running, note: "von der App" }, rev: cur.rev + 1 });
    }
    return origFetch(url, init);
  };
  const r = await t.tool("pause", { aktion: "start" });
  assert.equal(r.isError, false, r.text);
  assert.ok(injected);
  const st = t.g.get(`${t.base}/meta/state`);
  assert.ok(st.running.pauseStart != null);
  assert.equal(st.running.note, "von der App", "Änderung der App bleibt erhalten");
  const aborted = t.g.txs.size;
  assert.ok(aborted >= 3, "zweite Transaktion wurde begonnen");
});

test("Einstempeln ohne Ort nimmt Ort und Personen aus dem Einsatzplan; Beginn zurückdatieren", async () => {
  const t = await setup();
  await seedPlaces(t);
  t.g.set(`${t.base}/todos/tez`, { kind: "einsatz", title: "Baustelle Huber", date: "2026-11-02", dateTo: "2026-11-06", placeId: "p1", place: "Baustelle Huber", people: ["Max", "Sepp"], createdAt: 1 });
  t.setNow(vt(2026, 11, 4, 7, 40));
  const r = await t.tool("einstempeln", { beginn: "7:15", notiz: "Verteiler setzen" });
  assert.match(r.text, /Eingestempelt um 07:15/);
  assert.match(r.text, /Einsatzplan/);
  const run = t.g.get(`${t.base}/meta/state`).running;
  assert.equal(run.placeId, "p1");
  assert.deepEqual(run.people, ["Max", "Sepp"]);
  assert.equal(run.start, vt(2026, 11, 4, 7, 15));
  assert.equal(run.segments[0].start, run.start);
  assert.equal(run.note, "Verteiler setzen");
  const r2 = await t.tool("ausstempeln", { notiz: "fertig", ende: "07:35" });
  assert.match(r2.text, /07:15–07:35/);
  const e = t.g.list(`${t.base}/entries`)[0];
  assert.equal(e.note, "Verteiler setzen · fertig");
  assert.equal(e.end, vt(2026, 11, 4, 7, 35));
});

test("Unbekannter Ort wird freier Text; Zeiten in der Zukunft werden abgelehnt", async () => {
  const t = await setup();
  await seedPlaces(t);
  t.setNow(vt(2026, 11, 4, 7, 0));
  let r = await t.tool("einstempeln", { ort: "Schwimmbad Wels", beginn: "08:00" });
  assert.ok(r.isError);
  assert.match(r.text, /Zukunft/);
  r = await t.tool("einstempeln", { ort: "Schwimmbad Wels" });
  assert.match(r.text, /kein gespeicherter Ort/);
  const run = t.g.get(`${t.base}/meta/state`).running;
  assert.equal(run.placeId, null);
  assert.equal(run.place, "Schwimmbad Wels");
  r = await t.tool("pause", { aktion: "ende" });
  assert.match(r.text, /keine Pause/);
});
