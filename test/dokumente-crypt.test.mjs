// node --test test/dokumente-crypt.test.mjs
// 🔒 Verschlüsselte Dokumente: Hin und zurück, falscher Schlüssel, gesperrte Form, Umstellung (wiederholbar, nie Datenverlust).
import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../js/alltag/vault-crypto.js";
import * as E from "../js/alltag/dokumente-crypt.js";
import * as D from "../js/alltag/dokumente-core.js";

V._setMinIterForTests(1000);
const PW = "Korrekt Pferd Batterie 9!";
const DOC = { id: "d1", title: "Garantie Waschmaschine", folder: "garantie", tags: ["Küche"], fav: true, type: "image/jpeg", size: 1234, name: "Garantie.jpg",
  thumb: "data:image/jpeg;base64,AAAA", date: "2026-10-01", expires: "2026-11-20", remindDays: 30, links: [{ k: "place", id: "p1" }],
  ocr: "Seriennummer QX-998877", notes: "Original im Ordner Küche", created: 100, updated: 200 };
const keys = async () => ({ a: (await V.createVault(PW, { iter: 1000 })).key, b: (await V.createVault(PW, { iter: 1000 })).key });

test("versiegeln → nur erlaubte Felder im Klartext, entschlüsseln liefert alles zurück", async () => {
  const { a } = await keys();
  const rec = await E.sealDoc(a, DOC, { fileId: "f".repeat(32), chunks: 2 });
  const plainKeys = Object.keys(rec).filter((k) => !["iv", "ct"].includes(k));
  assert.ok(plainKeys.every((k) => E.PLAIN_KEYS.includes(k)), plainKeys.join(","));
  const json = JSON.stringify(rec);
  for (const s of ["Garantie", "Küche", "QX-998877", "Original", "p1", "image/jpeg", "2026-10-01"]) assert.ok(!json.includes(s), s);
  assert.equal(rec.enc, 1);
  assert.equal(rec.expires, "2026-11-20");
  const back = await E.openDoc(a, rec);
  assert.deepEqual(E.secretOf(back), E.secretOf(DOC));
  assert.equal(back.fileId, "f".repeat(32));
  assert.equal(back.chunks, 2);
});

test("eigener Ordner-Name bleibt verschlüsselt", async () => {
  const { a } = await keys();
  const rec = await E.sealDoc(a, { ...DOC, folder: "Scheidung" });
  assert.equal(rec.folder, "eigen");
  assert.ok(!JSON.stringify(rec).includes("Scheidung"));
  assert.equal((await E.openDoc(a, rec)).folder, "Scheidung");
});

test("falscher Schlüssel / vertauschte ID → tampered", async () => {
  const { a, b } = await keys();
  const rec = await E.sealDoc(a, DOC);
  await assert.rejects(E.openDoc(b, rec), { code: "tampered" });
  await assert.rejects(E.openDoc(a, { ...rec, id: "d2" }), { code: "tampered" });
  // Tresor-Eintrag mit gleicher ID lässt sich nicht als Dokument öffnen (eigene AAD)
  const item = await V.encryptItem(a, "d1", { title: "x" });
  await assert.rejects(E.openDoc(a, { ...rec, iv: item.iv, ct: item.ct }), { code: "tampered" });
});

test("gesperrte Form: nur Ordner/Ablauf/Größe, Benachrichtigung ohne Titel", async () => {
  const { a } = await keys();
  const rec = await E.sealDoc(a, DOC);
  const L = E.lockedShape(rec);
  assert.deepEqual(Object.keys(L).sort(), ["created", "enc", "expires", "folder", "id", "locked", "remind", "remindDays", "size", "updated"]);
  assert.ok(!JSON.stringify(E.lockedShape(DOC)).includes("Garantie Waschmaschine"), "auch Klartext-Altbestand ohne Titel");
  const due = D.dueDocs([rec], "2026-11-07");
  assert.equal(due.length, 1);
  assert.equal(due[0].title, "Ein Dokument läuft bald ab – entsperren zum Ansehen");
  assert.equal(due[0].text, "📄 Ein Dokument läuft bald ab – entsperren zum Ansehen");
  assert.equal(D.dueDocs([{ ...rec, expires: "2026-11-05" }], "2026-11-07")[0].title, D.LOCKED_DUE.ab);
  assert.equal(D.dueDocs([DOC], "2026-11-07")[0].title, "Garantie Waschmaschine", "Klartext-Altbestand unverändert");
});

// Speicher-Attrappe für die Umstellung
function fakeIO({ failPutAfter = Infinity, breakEnc = false } = {}) {
  const st = { col: new Map(), plain: new Map(), enc: new Map(), puts: 0 };
  let n = 0;
  const io = {
    getPlain: async (id, k) => { const p = []; for (let i = 0; i < k; i++) { const x = st.plain.get(`${id}_${i}`); if (x == null) return null; p.push(x); } return p.join(""); },
    putEnc: async (chunks) => { for (const c of chunks) st.enc.set(c.id, breakEnc ? { ...c, ct: c.ct.slice(0, -4) + "AAAA" } : c); },
    getEnc: async (f, k) => Array.from({ length: k }, (_, i) => st.enc.get(`${f}_${i}`)),
    delEnc: async (f, k) => { for (let i = 0; i < k; i++) st.enc.delete(`${f}_${i}`); },
    delPlain: async (id, k) => { for (let i = 0; i < k; i++) st.plain.delete(`${id}_${i}`); },
    put: async (rec) => { if (++st.puts > failPutAfter) throw new Error("Absturz"); st.col.set(rec.id, JSON.parse(JSON.stringify(rec))); },
    newFileId: () => `file${String(++n).padStart(8, "0")}`,
  };
  return { st, io };
}
const BYTES = new Uint8Array(3000).map((_, i) => (i * 7) & 255);
const seed = (st, id = "d1") => {
  const b64 = Buffer.from(BYTES).toString("base64");
  const parts = D.splitChunks(b64, 1500);
  parts.forEach((p, i) => st.plain.set(`${id}_${i}`, p));
  st.col.set(id, { ...DOC, id, chunks: parts.length });
  return parts.length;
};

test("Umstellung: verschlüsselt, geprüft, Klartext weg – und wiederholbar", async () => {
  const { a } = await keys();
  const { st, io } = fakeIO();
  seed(st);
  assert.equal(await E.migrateOne(a, st.col.get("d1"), io), "migrated");
  const rec = st.col.get("d1");
  assert.ok(E.isEnc(rec) && !rec.oldChunks && !("title" in rec) && !("ocr" in rec));
  assert.equal(st.plain.size, 0, "Klartext-Stücke gelöscht");
  const back = await E.openDoc(a, rec);
  assert.deepEqual(E.secretOf(back), E.secretOf(DOC));
  assert.deepEqual(await V.decryptFile(a, rec.fileId, await io.getEnc(rec.fileId, rec.chunks), rec.chunks), BYTES);
  // zweiter Lauf: nichts mehr zu tun
  assert.equal(await E.migrateOne(a, st.col.get("d1"), io), "skip");
  assert.equal(st.enc.size, rec.chunks);
});

test("Umstellung: Absturz nach dem Ersetzen → nächster Lauf räumt Klartext-Reste weg", async () => {
  const { a } = await keys();
  const { st, io } = fakeIO();
  const n = seed(st);
  io.delPlain = async () => { throw new Error("offline"); };
  await assert.rejects(E.migrateOne(a, st.col.get("d1"), io));
  const mid = st.col.get("d1");
  assert.ok(E.isEnc(mid) && mid.oldChunks === n, "verschlüsselte Fassung + Merker oldChunks");
  assert.equal(st.plain.size, n, "Original noch da");
  const { io: io2 } = fakeIO(); Object.assign(io2, { put: io.put, getEnc: io.getEnc });
  io2.delPlain = async (id, k) => { for (let i = 0; i < k; i++) st.plain.delete(`${id}_${i}`); };
  assert.equal(await E.migrateOne(a, mid, io2), "cleaned");
  assert.equal(st.plain.size, 0);
  assert.ok(!("oldChunks" in st.col.get("d1")));
  assert.deepEqual(E.secretOf(await E.openDoc(a, st.col.get("d1"))), E.secretOf(DOC));
});

test("Umstellung: Prüfung schlägt fehl / Datei fehlt / Absturz vor dem Ersetzen → Original bleibt", async () => {
  const { a } = await keys();
  let f = fakeIO({ breakEnc: true });
  seed(f.st);
  await assert.rejects(E.migrateOne(a, f.st.col.get("d1"), f.io), /Original bleibt/);
  assert.ok(!E.isEnc(f.st.col.get("d1")) && f.st.plain.size > 0 && f.st.enc.size === 0, "nichts verloren, keine Reste");
  f = fakeIO();
  f.st.col.set("d1", { ...DOC, chunks: 2 });
  assert.equal(await E.migrateOne(a, f.st.col.get("d1"), f.io), "missing");
  assert.equal(f.st.col.get("d1").title, DOC.title);
  f = fakeIO({ failPutAfter: 0 });
  seed(f.st);
  await assert.rejects(E.migrateOne(a, f.st.col.get("d1"), f.io), /Absturz/);
  assert.equal(f.st.col.get("d1").title, DOC.title);
  assert.ok(f.st.plain.size > 0);
  // ohne Datei (chunks 0) → nur Angaben
  f = fakeIO();
  f.st.col.set("d2", { ...DOC, id: "d2", chunks: 0 });
  assert.equal(await E.migrateOne(a, f.st.col.get("d2"), f.io), "migrated");
  assert.ok(E.isEnc(f.st.col.get("d2")));
  await assert.rejects(E.migrateOne(null, f.st.col.get("d2"), f.io), { code: "locked" });
});
