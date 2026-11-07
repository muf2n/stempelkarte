// node --test test/backup.test.mjs – Backup-Format, strenge Prüfung, Zusammenführen/Ersetzen, Verschlüsselung, Teile.
import test from "node:test";
import assert from "node:assert/strict";
import * as B from "../js/backup-core.js";

B._setMinIterForTests(1000);
const NOW = Date.UTC(2026, 10, 7, 12);

const sample = () => B.buildBackup({
  created: NOW,
  collections: {
    entries: [{ id: "e1", start: 1, end: 2 }, { id: "e1", start: 9 }],
    todos: [{ id: "t1", title: "Zahnarzt", createdAt: 10 }],
    days: [{ id: "2026-11-06", note: "x" }],
    a_money_tx: [{ id: "m1", amount: 5, updated: 100 }],
    a_photo_index: [{ id: "p1", thumb: "data:image/jpeg;base64,AAA", dayKey: "2026-11-01" }],
    a_vault_items: [{ id: "v1", ct: "geheim" }],
    a_school_files: [{ id: "f1", data: "bytes" }],
    photos: [{ id: "x", data: "bytes" }],
  },
  meta: { settings: { weeklyTarget: 38.5, when: new Date(5) }, gmail_server: { enc: "x" } },
});

test("Sammlungen: erlaubt/ausgeschlossen", () => {
  for (const n of ["entries", "todos", "days", "places", "a_money_tx", "a_neu_modul"]) assert.ok(B.allowedCollection(n), n);
  for (const n of ["a_vault_items", "a_vault_meta", "a_vault_files", "vault", "photos", "a_school_files", "a_travel_images", "backups", "meta", "../x", "A_X", "irgendwas"]) assert.ok(!B.allowedCollection(n), n);
  const k = B.knownCollections(["fahrzeuge", "vault_x"]);
  assert.ok(k.includes("a_fahrzeuge") && k.includes("a_berichtsheft") && k.includes("entries"));
  assert.ok(!k.some((n) => n.includes("vault")));
});

test("buildBackup: ohne Tresor/Bilder/Server-Doks, ohne Vorschaubilder, Duplikate raus, Zeiten als ms", () => {
  const b = sample();
  assert.equal(b.format, B.FORMAT);
  assert.deepEqual(Object.keys(b.collections).sort(), ["a_money_tx", "a_photo_index", "days", "entries", "todos"]);
  assert.equal(b.collections.entries.length, 1);
  assert.equal(b.collections.a_photo_index[0].thumb, undefined);
  assert.deepEqual(Object.keys(b.meta), ["settings"]);
  assert.equal(b.meta.settings.when, 5);
  assert.equal(b.counts.entries, 1);
  assert.ok(!JSON.stringify(b).includes("geheim"));
});

test("sanitize: Firestore-Timestamp, REST-Werte, undefined", () => {
  assert.equal(B.sanitize({ toMillis: () => 42 }), 42);
  assert.equal(B.sanitize({ __fs: { timestampValue: "2026-01-01T00:00:00Z" } }), Date.UTC(2026, 0, 1));
  assert.equal(B.sanitize({ __fs: { bytesValue: "AA" } }), undefined);
  assert.deepEqual(B.sanitize({ a: undefined, b: [1, undefined, NaN], c: new Uint8Array(2) }), { b: [1, null] });
});

test("validateBackup: streng, Tresor wird ignoriert, Fehler mit Code", () => {
  const raw = JSON.parse(JSON.stringify(sample()));
  raw.collections.a_vault_items = [{ id: "v", ct: "geheim" }];
  raw.collections.komisch = [{ id: "k" }];
  raw.meta.bank = { s: 1 };
  const r = B.validateBackup(raw);
  assert.ok(r.vaultSkipped);
  assert.ok(r.ignored.includes("komisch") && r.ignored.includes("a_vault_items") && r.ignored.includes("meta/bank"));
  assert.ok(!("a_vault_items" in r.backup.collections));
  const bad = (mut, code) => { const x = JSON.parse(JSON.stringify(sample())); mut(x); assert.throws(() => B.validateBackup(x), (e) => e instanceof B.BackupError && e.code === code); };
  bad((x) => { x.format = "nope"; }, "format");
  bad((x) => { x.v = 2; }, "version");
  bad((x) => { x.created = "gestern"; }, "format");
  bad((x) => { x.collections.entries = {}; }, "format");
  bad((x) => { x.collections.entries = [{ start: 1 }]; }, "format");
  bad((x) => { x.collections.entries = [{ id: "a/b" }]; }, "format");
  bad((x) => { x.collections.entries = ["x"]; }, "format");
  bad((x) => { x.meta = []; }, "format");
  assert.throws(() => B.validateBackup(null), { code: "format" });
  assert.throws(() => B.validateBackup({ format: B.ENC_FORMAT }), { code: "format" });
});

test("sectionCounts / totalDocs", () => {
  const s = B.sectionCounts(sample());
  const by = Object.fromEntries(s.map((x) => [x.key, x.n]));
  assert.equal(by.eintraege, 2);
  assert.equal(by.planer, 1);
  assert.equal(by.geld, 1);
  assert.equal(by.galerie, 1);
  assert.equal(by.einstellungen, 1);
  assert.equal(B.totalDocs(sample()), 5);
});

test("planRestore: Zusammenführen – fehlt → neu, neuer gewinnt, nichts gelöscht, Einstellungen ergänzt", () => {
  const backup = B.buildBackup({ created: NOW, collections: {
    todos: [{ id: "t1", title: "neu", updated: 200 }, { id: "t2", title: "fehlt", createdAt: 1 }, { id: "t3", title: "alt", updated: 1 }],
    a_photo_index: [{ id: "p1", note: "x" }],
  }, meta: { settings: { weeklyTarget: 20, accent: "gruen" } } });
  const current = { collections: { todos: [{ id: "t1", title: "x", updated: 100 }, { id: "t3", title: "aktueller", updated: 50 }, { id: "t9", title: "bleibt" }], a_photo_index: [] }, meta: { settings: { weeklyTarget: 38.5 } } };
  const p = B.planRestore(current, backup, "merge");
  assert.deepEqual(p.stats, { add: 2, update: 1, keep: 1, del: 0 });
  assert.deepEqual(p.writes.map((w) => w.id).sort(), ["p1", "t1", "t2"]);
  assert.equal(p.writes.find((w) => w.id === "p1").merge, true, "Foto-Index nur ergänzen");
  assert.equal(p.writes[0].data.id, undefined, "id nicht in den Daten");
  assert.deepEqual(p.deletes, []);
  assert.deepEqual(p.meta, [{ id: "settings", data: { accent: "gruen" }, merge: true }]);
});

test("planRestore: Ersetzen – alles schreiben, Fehlendes löschen (Foto-Index nie), Einstellungen komplett", () => {
  const backup = B.buildBackup({ created: NOW, collections: { todos: [{ id: "t1", title: "alt", updated: 1 }], a_photo_index: [], entries: [] }, meta: { settings: { weeklyTarget: 20 } } });
  const current = { collections: { todos: [{ id: "t1", updated: 999 }, { id: "t9" }], a_photo_index: [{ id: "p1" }], entries: [{ id: "e1" }], a_money_tx: [{ id: "m1" }] }, meta: { settings: { weeklyTarget: 38.5 } } };
  const p = B.planRestore(current, backup, "replace");
  assert.deepEqual(p.writes.map((w) => w.id), ["t1"]);
  assert.deepEqual(p.deletes.map((d) => d.coll + "/" + d.id).sort(), ["entries/e1", "todos/t9"]);
  assert.ok(!p.deletes.some((d) => d.coll === "a_money_tx"), "Sammlungen, die nicht im Backup sind, bleiben unberührt");
  assert.deepEqual(p.meta, [{ id: "settings", data: { weeklyTarget: 20 }, merge: false }]);
});

test("Verschlüsselung: Hin und zurück, falsches Passwort, Manipulation, zu wenige Runden", async () => {
  const text = JSON.stringify(sample());
  const enc = await B.encryptBackup(text, "Sicheres Passwort 1", { iter: 2000 });
  assert.equal(enc.format, B.ENC_FORMAT);
  assert.ok(!JSON.stringify(enc).includes("Zahnarzt"));
  assert.equal(await B.decryptBackup(enc, "Sicheres Passwort 1"), text);
  await assert.rejects(B.decryptBackup(enc, "falsch!!"), { code: "wrong-password" });
  const t = { ...enc, ct: enc.ct.slice(0, -4) + (enc.ct.endsWith("AAA=") ? "BBB=" : "AAA=") };
  await assert.rejects(B.decryptBackup(t, "Sicheres Passwort 1"), (e) => e.code === "wrong-password" || e.code === "format");
  await assert.rejects(B.decryptBackup({ ...enc, iter: 500 }, "Sicheres Passwort 1"), { code: "weak-kdf" });
  await assert.rejects(B.encryptBackup(text, "kurz"), { code: "wrong-password" });
  assert.ok(B.ITER >= 310000 && B.MIN_ITER >= 310000);
  assert.equal(B.parseFile(JSON.stringify(enc)).encrypted, true);
  assert.equal(B.parseFile(text).encrypted, false);
  assert.throws(() => B.parseFile("kein json"), { code: "format" });
  assert.throws(() => B.parseFile("{}"), { code: "format" });
});

test("Server-Snapshot: packen/entpacken, Teile, Aufbewahrung", async () => {
  const b = sample();
  const { meta, chunks } = await B.packSnapshot(b, { date: "2026-11-08", chunkChars: 50 });
  assert.equal(meta.kind, "meta");
  assert.equal(meta.chunks, chunks.length);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 50));
  assert.deepEqual(await B.unpackSnapshot(meta, chunks), JSON.parse(JSON.stringify(b)));
  await assert.rejects(B.unpackSnapshot(meta, chunks.slice(1)), { code: "format" });
  assert.equal(B.chunkId("2026-11-08", 2), "2026-11-08_c2");
  assert.deepEqual(B.retention(["2026-10-04", "2026-11-01", "2026-10-11", "2026-10-18", "2026-10-25", "x"]), { keep: ["2026-11-01", "2026-10-25", "2026-10-18", "2026-10-11"], drop: ["2026-10-04"] });
});

test("Kleinkram: Dateiname, „vor X Tagen“, Erinnerung", () => {
  assert.match(B.fileName(NOW, false), /^stempelkarte-backup-2026-11-07-\d{4}\.json$/);
  assert.match(B.fileName(NOW, true), /\.skbackup$/);
  const d = new Date(2026, 10, 7, 10).getTime();
  assert.equal(B.agoText(0, d), "noch nie");
  assert.equal(B.agoText(d - 3600e3, d), "heute");
  assert.equal(B.agoText(d - 86400e3, d), "gestern");
  assert.equal(B.agoText(d - 5 * 86400e3, d), "vor 5 Tagen");
  assert.equal(B.lastBackupAt({ backup: { lastManual: 5 } }, [{ created: 9 }, { created: 3 }]), 9);
  assert.equal(B.needsReminder(0, d), true);
  assert.equal(B.needsReminder(d - 13 * 86400e3, d), false);
  assert.equal(B.needsReminder(d - 15 * 86400e3, d), true);
  assert.equal(B.sizeText(2048), "2 KB");
});
