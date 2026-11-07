// Update 10 – automatisches Wochen-Backup (src/backup.js): Inhalt ohne Tresor/Bilder/Server-Dokumente,
// gzip-Teile ≤ 900 KB, nur die letzten 4, Cron-Zuordnung, wenige Unteranfragen.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setup, UID } from "./helpers.js";
import { runBackupCron, runBackup, rangeQueries, excludedRanges, BACKUP_CRON, viennaDate } from "../src/backup.js";
import { Firestore } from "../src/firestore.js";
import * as B from "../../../js/backup-core.js";
import worker from "../src/worker.js";

const NOW = Date.UTC(2026, 10, 8, 2, 15); // So 08.11.2026 03:15 Wien

function seed(g, base) {
  g.set(`${base}/entries/e1`, { start: 1, end: 2, kind: "work" });
  g.set(`${base}/todos/t1`, { title: "Zahnarzt", kind: "termin", date: "2026-11-10" });
  g.set(`${base}/days/2026-11-06`, { note: "x" });
  g.set(`${base}/places/p1`, { name: "Firma" });
  g.set(`${base}/a_money_tx/m1`, { amount: 12.5, id: "m1", updated: 5 });
  g.set(`${base}/a_school_exams/x1`, { subject: "Mathe", date: "2026-11-12", id: "x1" });
  g.set(`${base}/a_photo_index/ph1`, { id: "ph1", thumb: "data:image/jpeg;base64,AAAA", dayKey: "2026-11-01" });
  g.set(`${base}/a_zzz_neu/z1`, { id: "z1", ok: true });
  // NIE im Backup:
  g.set(`${base}/a_vault_items/v1`, { ct: "GEHEIM" });
  g.set(`${base}/a_vault_meta/main`, { salt: "GEHEIM" });
  g.set(`${base}/a_vault_files/f1`, { ct: "GEHEIM" });
  g.set(`${base}/vaultx/v2`, { ct: "GEHEIM" });
  g.set(`${base}/photos/ph1`, { data: "data:image/jpeg;base64,GROSS" });
  g.set(`${base}/a_school_files/s1`, { data: "BYTES" });
  g.set(`${base}/a_doc_files/d1_0`, { id: "d1_0", data: "BYTES" }); // Update 10 E – Dokument-Inhalte
  g.set(`${base}/a_travel_images/i1`, { data: "BYTES" });
  g.set(`${base}/meta/settings`, { weeklyTarget: 38.5 });
  g.set(`${base}/meta/gmail_server`, { enc: "GEHEIM" });
  g.set(`${base}/meta/bank`, { session: "GEHEIM" });
  g.set(`${base}/meta/push`, { token: "GEHEIM" });
  g.set(`${base}/a_money_tx/m1/sub/deep`, { x: 1 });
  g.set(`users/anderer/entries/e9`, { start: 9 });
}

async function readBack(t, date) {
  const meta = t.g.get(`${t.base}/backups/${date}`);
  const chunks = [];
  for (let i = 0; i < meta.chunks; i++) chunks.push(t.g.get(`${t.base}/backups/${B.chunkId(date, i)}`).data);
  return { meta, backup: await B.unpackSnapshot(meta, chunks) };
}

test("Bereiche: ausgeschlossene Sammlungen sortiert, 9 Abfragen (Update 10 E: + a_doc_files)", () => {
  const ex = excludedRanges().map((r) => r.from);
  assert.deepEqual(ex, [...ex].sort());
  assert.ok(ex.includes("a_vault") && ex.includes("photos") && ex.includes("meta") && ex.includes("backups"));
  const qs = rangeQueries("projects/p/databases/(default)/documents", "U");
  assert.equal(qs.length, 9);
  assert.ok(qs.every((q) => q.from[0].allDescendants && !q.from[0].collectionId));
});

test("Cron-Backup: alles außer Tresor/Bildern/Server-Dokumenten, gzip, Meta zuletzt", async () => {
  const t = await setup();
  seed(t.g, t.base);
  const before = t.g.requests.length;
  const r = await runBackupCron(t.env, { fetchImpl: t.g.fetch, now: NOW });
  assert.equal(r.date, "2026-11-08");
  assert.ok(r.chunks >= 1);
  const reqs = t.g.requests.length - before;
  assert.ok(reqs <= 20, "wenige Unteranfragen: " + reqs);
  const { meta, backup } = await readBack(t, r.date);
  assert.equal(meta.kind, "meta");
  assert.equal(meta.gz, true);
  const v = B.validateBackup(backup);
  const c = v.backup.collections;
  assert.equal(c.entries.length, 1);
  assert.equal(c.todos[0].title, "Zahnarzt");
  assert.equal(c.days[0].id, "2026-11-06");
  assert.equal(c.a_money_tx[0].amount, 12.5);
  assert.equal(c.a_school_exams.length, 1);
  assert.equal(c.a_zzz_neu.length, 1, "neue Alltag-Sammlungen kommen automatisch mit");
  assert.equal(c.a_photo_index[0].thumb, undefined, "keine Vorschaubilder");
  assert.equal(c.a_photo_index[0].dayKey, "2026-11-01");
  assert.equal(v.backup.meta.settings.weeklyTarget, 38.5);
  const txt = JSON.stringify(backup);
  assert.ok(!txt.includes("GEHEIM") && !txt.includes("BYTES") && !txt.includes("GROSS"), "kein Tresor, keine Bilder, keine Server-Dokumente");
  assert.ok(!txt.includes("e9"), "nur der eigene Nutzer");
  assert.ok(!Object.keys(c).some((n) => n.includes("vault") || n === "photos"));
  // Meta-Dokument wird als letztes geschrieben
  const last = t.g.commits ? t.g.commits[t.g.commits.length - 1] : null;
  if (last && last.writes) assert.match(JSON.stringify(last.writes[last.writes.length - 1]), new RegExp(`backups/${r.date}"`));
});

test("Teile ≤ 900 KB, nur die letzten 4 bleiben, höchstens 1× pro Woche", async () => {
  const t = await setup();
  seed(t.g, t.base);
  // viel Inhalt, schlecht komprimierbar
  const noise = () => Buffer.from(crypto.getRandomValues(new Uint8Array(3000))).toString("base64");
  for (let i = 0; i < 400; i++) t.g.set(`${t.base}/a_lap_own/c${i}`, { id: "c" + i, text: noise() });
  const fs = new Firestore({ projectId: "stempelkarte-40682", getToken: async () => [...t.g.tokens][0], fetchImpl: t.g.fetch });
  // Token besorgen
  await runBackupCron(t.env, { fetchImpl: t.g.fetch, now: NOW - 40 * 86400000 });
  const first = await readBack(t, viennaDate(NOW - 40 * 86400000));
  assert.ok(first.meta.chunks >= 2, "großes Backup in mehrere Teile: " + first.meta.chunks);
  for (let i = 0; i < first.meta.chunks; i++) assert.ok(t.g.get(`${t.base}/backups/${B.chunkId(first.meta.date, i)}`).data.length <= B.CHUNK_CHARS);
  assert.equal(first.backup.collections.a_lap_own.length, 400);
  // zu früh → übersprungen
  assert.equal((await runBackup(fs, UID, { now: NOW - 38 * 86400000 })).skipped, "recent");
  for (const d of [33, 26, 19, 12, 5]) await runBackup(fs, UID, { now: NOW - d * 86400000 });
  const metas = t.g.list(`${t.base}/backups`).filter((x) => x.kind === "meta").map((x) => x.date).sort();
  assert.equal(metas.length, 4);
  assert.equal(metas[0], viennaDate(NOW - 26 * 86400000));
  const chunkDates = new Set(t.g.list(`${t.base}/backups`).filter((x) => x.kind === "chunk").map((x) => x.date));
  assert.deepEqual([...chunkDates].sort(), metas, "Teile alter Backups mit gelöscht");
});

test("scheduled(): Backup-Cron startet nur das Backup; wrangler.toml passt", async () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.ok(toml.includes(`"${BACKUP_CRON}"`), "Cron in wrangler.toml");
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try { await worker.scheduled({ cron: BACKUP_CRON }, { FIREBASE_SERVICE_ACCOUNT: "" }, null); } finally { console.log = orig; }
  assert.ok(logs.some((l) => l.startsWith("backup-cron:")));
  assert.ok(!logs.some((l) => l.startsWith("bank-cron:") || l.startsWith("gmail-cron:")));
});

test("firestore.rules: Backups nur lesen/löschen", () => {
  const rules = readFileSync(new URL("../../../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /allow create, update: if eigen\(uid\) && !serverDok\(coll, docId\) && coll != 'backups';/);
  assert.match(rules, /allow delete: if eigen\(uid\) && !serverDok\(coll, docId\);/);
});
