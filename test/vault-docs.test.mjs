// node --test test/vault-docs.test.mjs
// Tresor-Dokumente: Datei-Verschlüsselung in Stücken, Manipulation, Reihenfolge, Vorschaubild, Ablauf, Erinnerungen.
import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../js/alltag/vault-crypto.js";
import * as C from "../js/alltag/vault-core.js";
import * as D from "../js/alltag/vault-docs-core.js";

const ITER = 1000;
const PW = "Reisepass Tresor Test 2026!";
const flip = (b64) => { const a = V.unb64(b64); a[a.length >> 1] ^= 1; return V.b64(a); };
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

test("Datei 3 MB: verschlüsseln → Stücke ≤ 700 kB → entschlüsseln", async () => {
  const { key } = await V.createVault(PW, { iter: ITER });
  const data = V.randomBytes(3 * 1024 * 1024);
  const id = V.newFileId();
  assert.match(id, /^[0-9a-f]{32}$/);
  const chunks = await V.encryptFile(key, id, data);
  assert.equal(chunks.length, Math.ceil(data.length / V.CHUNK_BYTES));
  assert.equal(chunks.length, 6);
  const ivs = new Set();
  chunks.forEach((c, n) => {
    assert.deepEqual(Object.keys(c).sort(), ["ct", "id", "iv", "n", "total"]);
    assert.equal(c.id, `${id}_${n}`);
    assert.equal(c.n, n);
    assert.equal(c.total, 6);
    assert.ok(c.ct.length <= 700 * 1024, "Stück zu groß: " + c.ct.length);
    assert.equal(V.unb64(c.iv).length, 12);
    ivs.add(c.iv);
  });
  assert.equal(ivs.size, 6, "jedes Stück eigener IV");
  const back = await V.decryptFile(key, id, chunks, 6);
  assert.ok(eq(back, data), "Rundreise");
  // Firestore-Dokument mit allen Feldern bleibt deutlich unter 1 MiB
  assert.ok(JSON.stringify(chunks[0]).length < 1024 * 1024 - 2048);
  // gleiche Datei erneut → anderer Chiffretext
  const again = await V.encryptFile(key, id, data);
  assert.notEqual(again[0].ct, chunks[0].ct);
  assert.ok(V.storedSize(chunks) > data.length);
});

test("leere und kleine Datei", async () => {
  const { key } = await V.createVault(PW, { iter: ITER });
  const id = V.newFileId();
  const c0 = await V.encryptFile(key, id, new Uint8Array(0));
  assert.equal(c0.length, 1);
  assert.equal((await V.decryptFile(key, id, c0)).length, 0);
  const small = new TextEncoder().encode("%PDF-1.4 MARKER-PDF-42");
  const c1 = await V.encryptFile(key, id, small);
  assert.ok(!JSON.stringify(c1).includes("MARKER"));
  assert.equal(new TextDecoder().decode(await V.decryptFile(key, id, c1)), "%PDF-1.4 MARKER-PDF-42");
});

test("falscher Schlüssel schlägt fehl", async () => {
  const a = await V.createVault(PW, { iter: ITER });
  const b = await V.createVault(PW, { iter: ITER });
  const id = V.newFileId();
  const chunks = await V.encryptFile(a.key, id, V.randomBytes(700000));
  await assert.rejects(V.decryptFile(b.key, id, chunks), (e) => e instanceof V.VaultError && e.code === "tampered");
});

test("verändertes Stück schlägt fehl (ct, iv, fremde Datei-ID)", async () => {
  const { key } = await V.createVault(PW, { iter: ITER });
  const id = V.newFileId();
  const chunks = await V.encryptFile(key, id, V.randomBytes(1200000));
  const bad = chunks.map((c) => ({ ...c }));
  bad[1].ct = flip(bad[1].ct);
  await assert.rejects(V.decryptFile(key, id, bad), { code: "tampered" });
  const bad2 = chunks.map((c) => ({ ...c }));
  bad2[2].iv = flip(bad2[2].iv);
  await assert.rejects(V.decryptFile(key, id, bad2), { code: "tampered" });
  // Stücke einer anderen Datei unter dieser ID
  const other = V.newFileId();
  const renamed = chunks.map((c) => ({ ...c, id: `${other}_${c.n}` }));
  await assert.rejects(V.decryptFile(key, other, renamed), { code: "tampered" });
});

test("Reihenfolge: vertauschte, fehlende, doppelte Stücke werden erkannt", async () => {
  const { key } = await V.createVault(PW, { iter: ITER });
  const id = V.newFileId();
  const data = V.randomBytes(1600000);
  const chunks = await V.encryptFile(key, id, data);
  assert.equal(chunks.length, 4);
  // Liste in anderer Reihenfolge geliefert (z. B. aus IndexedDB/Firestore) → wird nach n sortiert
  assert.ok(eq(await V.decryptFile(key, id, [...chunks].reverse(), 4), data));
  // Inhalte von Stück 0 und 1 vertauscht (n bleibt) → AAD passt nicht
  const sw = chunks.map((c) => ({ ...c }));
  [sw[0].iv, sw[0].ct, sw[1].iv, sw[1].ct] = [sw[1].iv, sw[1].ct, sw[0].iv, sw[0].ct];
  await assert.rejects(V.decryptFile(key, id, sw), { code: "tampered" });
  // n umnummeriert
  const ren = chunks.map((c) => ({ ...c }));
  ren[0] = { ...ren[0], n: 1, id: `${id}_1` }; ren[1] = { ...ren[1], n: 0, id: `${id}_0` };
  await assert.rejects(V.decryptFile(key, id, ren), { code: "tampered" });
  // fehlendes Stück / abgeschnitten
  await assert.rejects(V.decryptFile(key, id, chunks.slice(0, 3)), { code: "tampered" });
  await assert.rejects(V.decryptFile(key, id, chunks.slice(0, 3).map((c) => ({ ...c, total: 3 })), 3), { code: "tampered" });
  // doppelt
  await assert.rejects(V.decryptFile(key, id, [chunks[0], chunks[0], chunks[2], chunks[3]]), { code: "tampered" });
  await assert.rejects(V.decryptFile(key, id, []), { code: "tampered" });
});

test("Vorschaubild: 400 px, ein Stück, eigene ID", async () => {
  assert.deepEqual(D.fitSize(4000, 3000, D.THUMB_SIDE), { w: 400, h: 300 });
  assert.deepEqual(D.fitSize(1500, 2600, D.IMG_MAX_SIDE), { w: 1154, h: 2000 });
  assert.deepEqual(D.fitSize(300, 200, D.IMG_MAX_SIDE), { w: 300, h: 200 }, "nie vergrößern");
  assert.equal(D.IMG_MAX_SIDE, 2000);
  assert.equal(D.IMG_QUALITY, 0.85);
  const { key } = await V.createVault(PW, { iter: ITER });
  const thumb = V.randomBytes(38000); // typische Größe eines 400-px-JPEGs
  const tid = V.newFileId();
  const tc = await V.encryptFile(key, tid, thumb);
  assert.equal(tc.length, 1);
  assert.ok(eq(await V.decryptFile(key, tid, tc, 1), thumb));
  // Vorschaubild kann nicht als Hauptdatei untergeschoben werden
  const fid = V.newFileId();
  await assert.rejects(V.decryptFile(key, fid, tc.map((c) => ({ ...c, id: `${fid}_0` }))), { code: "tampered" });
});

test("Eintrag „Dokument“: alles im verschlüsselten ct, nur bekannte Felder", async () => {
  const e = C.normEntry({
    type: "doc", title: "Mein Pass", kind: "reisepass", number: " P1234567 ", issued: "2021-03-12", expires: "2031-03-12",
    authority: "BH Graz", note: "x", remind: true, remId: "abcdef0123456789abcd", evil: "<script>",
    files: [{ id: "0123456789abcdef0123456789abcdef", name: "vorne.jpg", mime: "image/jpeg", size: 1000, chunks: 1, enc: 1400, side: "front", thumb: "fedcba9876543210fedcba9876543210", thumbEnc: 300, data: "nope" },
      { id: "../bad", name: "x" }],
  });
  assert.equal(e.type, "doc");
  assert.equal(e.number, "P1234567");
  assert.equal(e.files.length, 1);
  assert.equal(e.files[0].data, undefined);
  assert.equal(e.evil, undefined);
  assert.equal(e.remind, true);
  assert.equal(C.normEntry({ type: "doc", kind: "zzz" }).kind, "sonstiges");
  assert.equal(C.normEntry({ type: "doc", kind: "ecard" }).title, "e-card");
  assert.equal(C.normEntry({ type: "doc", remind: true }).remind, false, "ohne Ablaufdatum keine Erinnerung");
  assert.equal(C.normEntry({ type: "doc", expires: "2031-13-45" }).expires, "");
  assert.ok(!C.subtitle(e).includes("P1234567"), "Nummer nie im Untertitel");
  assert.ok(C.matches(e, "reisepass graz"));
  const { key } = await V.createVault(PW, { iter: ITER });
  const rec = await V.encryptItem(key, "d1", e);
  for (const v of ["Mein Pass", "P1234567", "BH Graz", "vorne.jpg", "reisepass"]) assert.ok(!JSON.stringify(rec).includes(v));
  assert.deepEqual(C.normEntry(await V.decryptItem(key, rec)), e);
  assert.ok(C.toBitwardenCsv([{ data: e }]).includes("Nummer: P1234567"));
});

test("Ablauf-Abzeichen", () => {
  const T = "2026-11-05";
  assert.deepEqual(D.expiryInfo("", T).state, "none");
  assert.deepEqual(D.expiryInfo("2027-03-12", T), { state: "soon", label: "läuft ab in 4 Monaten", days: 127 });
  assert.equal(D.expiryInfo("2027-05-05", T).state, "soon", "genau 6 Monate = gelb");
  assert.equal(D.expiryInfo("2027-05-06", T).state, "ok");
  assert.equal(D.expiryInfo("2031-03-12", T).label, "gültig bis 12.03.2031");
  assert.equal(D.expiryInfo("2027-12-05", T).label, "läuft ab in 13 Monaten");
  assert.equal(D.expiryInfo("2026-11-05", T).label, "läuft heute ab");
  assert.equal(D.expiryInfo("2026-11-06", T).label, "läuft morgen ab");
  assert.equal(D.expiryInfo("2026-11-25", T).label, "läuft ab in 20 Tagen");
  assert.equal(D.expiryInfo("2026-12-05", T).label, "läuft ab in 1 Monat");
  const ex = D.expiryInfo("2026-08-01", T);
  assert.equal(ex.state, "expired");
  assert.equal(ex.label, "abgelaufen seit 3 Monaten");
  assert.equal(D.expiryInfo("2026-11-04", T).label, "seit gestern abgelaufen");
  assert.equal(D.expiryInfo("2026-10-20", T).label, "abgelaufen seit 16 Tagen");
  assert.equal(D.addMonths("2031-05-31", -3), "2031-02-28");
  assert.equal(D.addMonths("2032-05-31", -3), "2032-02-29");
  assert.equal(D.addMonths("2031-01-15", -1), "2030-12-15");
});

test("Erinnerungen: nur Art + Datum, 3 und 1 Monat vorher, Abgleich", () => {
  const T = "2026-11-05";
  const doc = C.normEntry({ type: "doc", title: "Geheimer Titel", number: "P999", kind: "reisepass", expires: "2031-03-12", remind: true, remId: "aaaabbbbccccdddd0000" });
  assert.equal(D.reminderNotice("reisepass", "2031-03-12"), "Für die Erinnerung wird nur ‚Reisepass läuft ab am 12.03.2031‘ unverschlüsselt als Termin gespeichert – keine Nummer, kein Bild.");
  const plan = D.reminderPlan(doc, T);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((t) => [t.id, t.date]), [["vr_aaaabbbbccccdddd0000_3", "2030-12-12"], ["vr_aaaabbbbccccdddd0000_1", "2031-02-12"]]);
  assert.equal(plan[0].title, "Reisepass erneuern – läuft am 12.03.2031 ab");
  assert.equal(plan[0].kind, "todo");
  assert.equal(plan[0].remind, true);
  const txt = JSON.stringify(plan);
  assert.ok(!txt.includes("Geheimer") && !txt.includes("P999"), "kein Titel, keine Nummer");
  // bald ablaufend: beide Termine wären vorbei → einer, heute
  const soon = D.reminderPlan({ ...doc, expires: "2026-11-20" }, T);
  assert.deepEqual(soon.map((t) => t.date), [T]);
  assert.equal(D.reminderPlan({ ...doc, remind: false }, T).length, 0);
  assert.equal(D.reminderPlan({ ...doc, remId: "" }, T).length, 0);
  // Abgleich
  let r = D.reminderDiff(doc, "", [], T);
  assert.equal(r.save.length, 2);
  assert.equal(r.remove.length, 0);
  const existing = r.save.map((t) => ({ ...t, done: true }));
  r = D.reminderDiff(doc, doc.remId, existing, T);
  assert.equal(r.save.length, 0, "unverändert → nichts schreiben (erledigt bleibt)");
  r = D.reminderDiff({ ...doc, expires: "2032-03-12" }, doc.remId, existing, T);
  assert.equal(r.save.length, 2);
  assert.ok(r.save.every((t) => t.done === false));
  r = D.reminderDiff({ ...doc, remind: false }, doc.remId, existing, T);
  assert.deepEqual(r.remove.sort(), ["vr_aaaabbbbccccdddd0000_1", "vr_aaaabbbbccccdddd0000_3"]);
  r = D.reminderDiff({ ...doc, expires: "2026-11-20" }, doc.remId, existing, T);
  assert.deepEqual(r.remove, ["vr_aaaabbbbccccdddd0000_1"]);
});

test("Speicher-Summe", () => {
  const recs = [{ iv: "a".repeat(16), ct: "b".repeat(1000) }];
  const ents = [{ data: { type: "doc", files: [{ enc: 5000, thumbEnc: 300 }, { enc: 100, thumbEnc: 0 }] } }, { data: { type: "login" } }];
  assert.equal(D.usedBytes(recs, ents), 16 + 1000 + 80 + 5400);
  assert.equal(D.fmtSize(3.4 * 1024 * 1024), "3,4 MB");
  assert.equal(D.fmtSize(2048), "2 kB");
});
