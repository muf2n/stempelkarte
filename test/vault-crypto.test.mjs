// node --test test/vault-crypto.test.mjs
// Krypto des Passwort-Tresors mit WebCrypto aus Node 22 (globalThis.crypto). Wenige PBKDF2-Runden für Tempo.
import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../js/alltag/vault-crypto.js";
import * as C from "../js/alltag/vault-core.js";

const ITER = 1000;
const PW = "Korrekt Pferd Batterie 9!";
const ENTRY = { type: "login", title: "Billa Konto", user: "max@example.at", password: "S3hr-geheim!42", url: "billa.at", note: "Notiz äöü €" };

const flip = (b64) => { const a = V.unb64(b64); a[a.length - 1] ^= 1; return V.b64(a); };

test("base64 Hin und zurück (auch große Daten)", () => {
  const a = V.randomBytes(100000);
  assert.deepEqual(V.unb64(V.b64(a)), a);
  assert.throws(() => V.unb64("nicht base64!"), { code: "format" });
});

test("Tresor anlegen: Meta-Format, keine Klartext-Felder", async () => {
  const { meta, key } = await V.createVault(PW, { iter: ITER });
  assert.equal(meta.v, 1);
  assert.equal(meta.kdf, "PBKDF2-SHA256");
  assert.equal(meta.iter, ITER);
  assert.equal(V.unb64(meta.salt).length, 16);
  assert.equal(V.unb64(meta.wrapIv).length, 12);
  assert.equal(V.unb64(meta.wrappedKey).length, 32 + 16);
  assert.ok(meta.verifier.iv && meta.verifier.ct);
  assert.equal(key.extractable, false);
  assert.deepEqual([...key.usages].sort(), ["decrypt", "encrypt"]);
  assert.ok(!JSON.stringify(meta).includes(PW));
});

test("Standard-Rundenzahl ist 600.000", () => {
  assert.equal(V.ITER, 600000);
});

test("Rundreise: verschlüsseln → entsperren → entschlüsseln", async () => {
  const { meta, key } = await V.createVault(PW, { iter: ITER });
  const rec = await V.encryptItem(key, "abc123", ENTRY);
  assert.deepEqual(Object.keys(rec).sort(), ["ct", "id", "iv"]);
  const raw = JSON.stringify(rec);
  for (const v of [ENTRY.title, ENTRY.user, ENTRY.password, "billa"]) assert.ok(!raw.includes(v), "Klartext im Chiffrat: " + v);
  const key2 = await V.unlockVault(PW, meta);
  assert.deepEqual(await V.decryptItem(key2, rec), ENTRY);
  // gleiche Daten → anderer IV/Chiffretext
  const rec2 = await V.encryptItem(key, "abc123", ENTRY);
  assert.notEqual(rec2.iv, rec.iv);
  assert.notEqual(rec2.ct, rec.ct);
});

test("Falsches Passwort wird abgelehnt", async () => {
  const { meta } = await V.createVault(PW, { iter: ITER });
  await assert.rejects(V.unlockVault("falsch-falsch-falsch", meta), (e) => e instanceof V.VaultError && e.code === "wrong-password");
  await assert.rejects(V.unlockVault(PW + " ", meta), { code: "wrong-password" });
  await assert.rejects(V.unlockVault("", meta), { code: "wrong-password" });
});

test("Unicode-Passwort wird normalisiert (NFC/NFD gleich)", async () => {
  const nfc = "Grüße aus Österreich 2026";
  const { meta } = await V.createVault(nfc, { iter: ITER });
  await V.unlockVault(nfc.normalize("NFD"), meta);
});

test("Passwort ändern: Einträge bleiben lesbar, altes Passwort ungültig", async () => {
  const { meta, key } = await V.createVault(PW, { iter: ITER });
  const recs = await Promise.all([1, 2, 3].map((i) => V.encryptItem(key, "id" + i, { ...ENTRY, title: "Eintrag " + i })));
  const NEU = "Ganz neues Passwort 2027?";
  const meta2 = await V.changePassword(meta, PW, NEU, { iter: ITER });
  assert.notEqual(meta2.salt, meta.salt);
  assert.notEqual(meta2.wrappedKey, meta.wrappedKey);
  assert.deepEqual(meta2.verifier, meta.verifier);
  await assert.rejects(V.unlockVault(PW, meta2), { code: "wrong-password" });
  const k2 = await V.unlockVault(NEU, meta2);
  for (let i = 0; i < 3; i++) assert.equal((await V.decryptItem(k2, recs[i])).title, "Eintrag " + (i + 1));
  await assert.rejects(V.changePassword(meta, "falsch-falsch", NEU, { iter: ITER }), { code: "wrong-password" });
});

test("Manipulation wird erkannt (Chiffretext, IV, ID-Tausch, Meta, Prüfwert)", async () => {
  const { meta, key } = await V.createVault(PW, { iter: ITER });
  const a = await V.encryptItem(key, "a", { ...ENTRY, title: "A" });
  const b = await V.encryptItem(key, "b", { ...ENTRY, title: "B" });
  await assert.rejects(V.decryptItem(key, { ...a, ct: flip(a.ct) }), { code: "tampered" });
  await assert.rejects(V.decryptItem(key, { ...a, iv: flip(a.iv) }), { code: "tampered" });
  // Chiffrat von b unter ID a (Vertauschen) → AAD passt nicht
  await assert.rejects(V.decryptItem(key, { id: "a", iv: b.iv, ct: b.ct }), { code: "tampered" });
  // eingepackter Schlüssel verändert → wie falsches Passwort (kann nicht unterschieden werden)
  await assert.rejects(V.unlockVault(PW, { ...meta, wrappedKey: flip(meta.wrappedKey) }), { code: "wrong-password" });
  await assert.rejects(V.unlockVault(PW, { ...meta, salt: flip(meta.salt) }), { code: "wrong-password" });
  // Prüfwert verändert
  await assert.rejects(V.unlockVault(PW, { ...meta, verifier: { ...meta.verifier, ct: flip(meta.verifier.ct) } }), { code: "tampered" });
  // fremder Schlüssel
  const other = await V.createVault(PW, { iter: ITER });
  await assert.rejects(V.decryptItem(other.key, a), { code: "tampered" });
  // kaputtes Format
  await assert.rejects(V.unlockVault(PW, { ...meta, v: 2 }), { code: "format" });
  await assert.rejects(V.decryptItem(key, { id: "a", iv: "AAAA", ct: a.ct }), { code: "tampered" });
});

test("Sicherung: exportieren → importieren (auch nach Passwortwechsel)", async () => {
  const { meta, key } = await V.createVault(PW, { iter: ITER });
  const recs = [];
  for (const t of C.TYPE_IDS) recs.push({ ...(await V.encryptItem(key, "x_" + t, C.normEntry({ type: t, title: "T " + t, password: "pw-" + t }))), created: 1, updated: 2 });
  const backup = V.makeBackup({ ...meta, id: "main", updated: 5 }, recs, new Date("2026-11-05T10:00:00Z"));
  assert.equal(backup.format, "stempelkarte-tresor");
  assert.equal(backup.meta.id, undefined);
  const text = JSON.stringify(backup);
  assert.ok(!text.includes("pw-login") && !text.includes("T login"));
  const opened = await V.openBackup(text, PW);
  assert.equal(opened.entries.length, C.TYPE_IDS.length);
  assert.equal(opened.failed, 0);
  assert.equal(opened.entries.find((e) => e.id === "x_wifi").data.password, "pw-wifi");
  assert.equal(opened.entries[0].created, 1);
  await assert.rejects(V.openBackup(text, "falsches-passwort"), { code: "wrong-password" });
  // Import in einen anderen Tresor: neu verschlüsseln mit dessen Schlüssel
  const other = await V.createVault("Anderes Passwort 123!", { iter: ITER });
  const re = await V.encryptItem(other.key, opened.entries[0].id, opened.entries[0].data);
  assert.equal((await V.decryptItem(other.key, re)).title, opened.entries[0].data.title);
  // beschädigter Eintrag wird gezählt, nicht verschluckt
  const bad = JSON.parse(text);
  bad.items[0].ct = flip(bad.items[0].ct);
  const o2 = await V.openBackup(bad, PW);
  assert.equal(o2.failed, 1);
  // keine Sicherung
  assert.throws(() => V.parseBackup("{}"), { code: "format" });
  assert.throws(() => V.parseBackup("kein json"), { code: "format" });
  assert.throws(() => V.parseBackup({ ...backup, items: [{ id: 1 }] }), { code: "format" });
});

/* ---------- vault-core ---------- */

test("Stärke-Schätzung", () => {
  assert.equal(C.strength("").score, 0);
  assert.ok(C.strength("123456").score <= 1);
  assert.ok(C.strength("passwort").score <= 1);
  assert.ok(C.strength("P4ssw0rt2024").bits < 40, "Wort + Jahr");
  assert.ok(C.strength("aaaaaaaaaaaaaaaa").score === 0);
  assert.ok(C.strength("abcdefghijkl").score <= 1);
  assert.ok(C.strength("qwertzuiop12").score <= 1);
  assert.ok(C.strength("Tk9#vLq2!xRm").score >= 3);
  assert.ok(C.strength("korrekt pferd batterie heftklammer").score >= 3);
  assert.equal(C.masterProblem("kurz"), "Mindestens 10 Zeichen.");
  assert.ok(C.masterProblem("passwort123"));
  assert.ok(C.masterProblem("Gut-Lang-Passwort-77", "anders"));
  assert.equal(C.masterProblem("Gut-Lang-Passwort-77", "Gut-Lang-Passwort-77"), "");
});

test("Generator: Länge, Zeichensätze, aussprechbar", () => {
  for (const length of [8, 16, 40]) {
    const p = C.generate({ length, lower: true, upper: true, digits: true, symbols: true });
    assert.equal(p.length, length);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/); assert.match(p, /[^A-Za-z0-9]/);
  }
  assert.equal(C.generate({ length: 3 }).length, 8);
  assert.equal(C.generate({ length: 99 }).length, 40);
  assert.match(C.generate({ length: 20, lower: false, upper: false, digits: true, symbols: false }), /^[2-9]{20}$/);
  assert.doesNotMatch(C.generate({ length: 40 }), /[lIO01]/);
  const pr = C.generate({ length: 14, pronounceable: true, upper: true, digits: true });
  assert.equal(pr.length, 14);
  assert.match(pr, /[A-Z]/); assert.match(pr, /\d\d$/);
  assert.match(pr.slice(0, 4), /^[a-zA-Z]{4}$/);
  const many = new Set(Array.from({ length: 200 }, () => C.generate({ length: 12 })));
  assert.equal(many.size, 200);
});

test("Sicherheits-Check: schwach + mehrfach", () => {
  const e = (id, type, password) => ({ id, data: C.normEntry({ type, title: id, password, pin: password }) });
  const r = C.securityCheck([e("a", "login", "123456"), e("b", "login", "Tk9#vLq2!xRm"), e("c", "wifi", "Tk9#vLq2!xRm"), e("d", "pin", "1234"), e("n", "note", "")]);
  assert.deepEqual(r.weak, ["a"]);
  assert.deepEqual(r.reused.sort(), ["b", "c"]);
  assert.equal(r.checked, 3);
});

test("WLAN-QR-Text, CSV, URL, Suche", () => {
  assert.equal(C.wifiQrText({ ssid: "Mein;WLAN", password: 'ge"heim', enc: "WPA" }), 'WIFI:T:WPA;S:Mein\\;WLAN;P:ge\\"heim;;');
  assert.equal(C.wifiQrText({ ssid: "Gast", enc: "nopass", hidden: true }), "WIFI:T:nopass;S:Gast;H:true;;");
  const csv = C.toBitwardenCsv([
    { data: C.normEntry({ type: "login", title: "A, B", user: "u", password: 'p"w', url: "x.at", fav: true, category: "Privat" }) },
    { data: C.normEntry({ type: "pin", title: "SIM", pin: "1234", puk: "5678" }) },
  ]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp");
  assert.equal(lines[1], 'Privat,1,login,"A, B",,,,x.at,u,"p""w",');
  assert.ok(csv.includes("PIN: 1234\nPUK: 5678"));
  assert.equal(C.safeUrl("javascript:alert(1)"), "");
  assert.equal(C.safeUrl("billa.at"), "https://billa.at/");
  assert.equal(C.hostOf("https://www.billa.at/login"), "billa.at");
  assert.ok(C.matches(C.normEntry({ type: "login", title: "Billa", user: "max" }), "bil MAX"));
  assert.ok(!C.matches(C.normEntry({ type: "login", title: "Billa", password: "geheimwort" }), "geheimwort"), "Suche nicht über Passwörter");
  assert.equal(C.failDelay(4), 0);
  assert.equal(C.failDelay(5), 5);
  assert.equal(C.failDelay(7), 20);
  assert.equal(C.failDelay(30), 300);
});
