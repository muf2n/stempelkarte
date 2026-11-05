// node --test test/money-lock.test.mjs
// Geld-Sperre: PIN-Hash, DER→raw, WebAuthn-Assertion (lokal erzeugter ES256-Schlüssel, synthetische Daten), Ablauf.
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/alltag/money-lock-core.js";

const subtle = globalThis.crypto.subtle;
const RP = "localhost";
const ORIGIN = "http://localhost:8868";

test("PIN: Hash/Prüfen, nur Salt+Hash gespeichert", async () => {
  const rec = await L.hashPin("4711", 1000);
  assert.deepEqual(Object.keys(rec).sort(), ["hash", "iter", "len", "salt"]);
  assert.equal(rec.len, 4);
  assert.ok(!JSON.stringify(rec).includes("4711"));
  assert.equal(await L.verifyPin("4711", rec), true);
  assert.equal(await L.verifyPin("4712", rec), false);
  assert.equal(await L.verifyPin("47110", rec), false);
  const rec2 = await L.hashPin("4711", 1000);
  assert.notEqual(rec2.salt, rec.salt, "Salt zufällig");
  assert.notEqual(rec2.hash, rec.hash);
  await assert.rejects(() => L.hashPin("123"), /4 bis 8/);
  await assert.rejects(() => L.hashPin("123456789"), /4 bis 8/);
  await assert.rejects(() => L.hashPin("12a4"), /4 bis 8/);
  assert.equal(await L.verifyPin("4711", null), false);
});

test("PIN: Standard 200.000 Runden", async () => {
  assert.equal(L.PIN_ITER, 200000);
  const rec = await L.hashPin("12345678");
  assert.equal(rec.iter, 200000);
  assert.equal(await L.verifyPin("12345678", rec), true);
});

test("Wartezeit nach Fehlversuchen", () => {
  assert.deepEqual([1, 2, 3, 4].map(L.failDelay), [0, 0, 0, 0]);
  assert.equal(L.failDelay(5), 5);
  assert.equal(L.failDelay(6), 10);
  assert.equal(L.failDelay(7), 20);
  assert.equal(L.failDelay(30), 300);
});

test("DER → raw r||s (mit Vorzeichen-Nullen, kurze Zahlen)", () => {
  const r = new Uint8Array(32).fill(0x81); // höchstes Bit → DER braucht 0x00 davor
  const s = new Uint8Array(32); s[31] = 7; s[30] = 1; // kurze Zahl → links mit Nullen auffüllen
  const raw = L.concat(r, s);
  const der = L.rawToDer(raw);
  assert.equal(der[0], 0x30);
  assert.equal(der[3], 33, "r mit Vorzeichen-Null");
  assert.deepEqual(L.derToRaw(der), raw);
  // handgebautes Beispiel
  const hand = new Uint8Array([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x01, 0x02]);
  const out = L.derToRaw(hand);
  assert.equal(out.length, 64);
  assert.equal(out[31], 0x80);
  assert.equal(out[62], 0x01);
  assert.equal(out[63], 0x02);
  assert.throws(() => L.derToRaw(new Uint8Array([0x31, 0])), /DER/);
  assert.throws(() => L.derToRaw(L.concat(der, new Uint8Array([0]))), /DER/);
});

async function makeKey() {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await subtle.exportKey("spki", kp.publicKey));
  return { kp, cred: { id: "abc", publicKey: L.b64(spki), alg: L.ALG_ES256, counter: 0 } };
}

async function assertion(kp, { challenge, origin = ORIGIN, rpId = RP, flags = 0x05, counter = 1, type = "webauthn.get" }) {
  const authData = L.concat(await L.sha256(rpId), new Uint8Array([flags, counter >>> 24, (counter >> 16) & 255, (counter >> 8) & 255, counter & 255]));
  const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type, challenge: L.b64url(challenge), origin, crossOrigin: false }));
  const sigRaw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, L.concat(authData, await L.sha256(clientDataJSON))));
  return { authenticatorData: authData.buffer, clientDataJSON: clientDataJSON.buffer, signature: L.rawToDer(sigRaw).buffer };
}

test("WebAuthn: gültige ES256-Assertion wird akzeptiert, Zähler übernommen", async () => {
  const { kp, cred } = await makeKey();
  const challenge = L.randomBytes(32);
  const a = await assertion(kp, { challenge, counter: 3 });
  const r = await L.verifyAssertion(cred, a, { challenge, origin: ORIGIN, rpId: RP });
  assert.deepEqual(r, { ok: true, counter: 3 });
});

test("WebAuthn: Zähler 0 bei beiden ist erlaubt (viele Plattform-Authentifikatoren)", async () => {
  const { kp, cred } = await makeKey();
  const challenge = L.randomBytes(32);
  const r = await L.verifyAssertion(cred, await assertion(kp, { challenge, counter: 0 }), { challenge, origin: ORIGIN, rpId: RP });
  assert.equal(r.ok, true);
});

test("WebAuthn: Fehlerfälle werden abgelehnt", async () => {
  const { kp, cred } = await makeKey();
  const challenge = L.randomBytes(32);
  const exp = { challenge, origin: ORIGIN, rpId: RP };
  const bad = async (o, reason, c = cred) => {
    const r = await L.verifyAssertion(c, await assertion(kp, { challenge, ...o }), exp);
    assert.deepEqual(r, { ok: false, reason }, reason);
  };
  await bad({ challenge: L.randomBytes(32) }, "challenge");
  await bad({ origin: "https://evil.example" }, "origin");
  await bad({ rpId: "evil.example" }, "rpId");
  await bad({ flags: 0x04 }, "up");
  await bad({ flags: 0x01 }, "uv");
  await bad({ type: "webauthn.create" }, "type");
  await bad({ counter: 5 }, "counter", { ...cred, counter: 5 });
  await bad({ counter: 4 }, "counter", { ...cred, counter: 5 });
  // falscher Schlüssel
  const other = await makeKey();
  await bad({}, "signature", other.cred);
  // manipulierte Signatur
  const a = await assertion(kp, { challenge });
  const sig = new Uint8Array(a.signature.slice(0));
  sig[sig.length - 1] ^= 1;
  assert.equal((await L.verifyAssertion(cred, { ...a, signature: sig }, exp)).reason, "signature");
  // manipulierte authenticatorData (Zähler geändert) → Signatur passt nicht
  const ad = new Uint8Array(a.authenticatorData.slice(0));
  ad[36] = 9;
  assert.equal((await L.verifyAssertion(cred, { ...a, authenticatorData: ad }, exp)).reason, "signature");
});

test("WebAuthn: RS256 wird auch geprüft", async () => {
  const kp = await subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const cred = { id: "r", publicKey: L.b64(new Uint8Array(await subtle.exportKey("spki", kp.publicKey))), alg: L.ALG_RS256, counter: 0 };
  const challenge = L.randomBytes(32);
  const authData = L.concat(await L.sha256(RP), new Uint8Array([0x05, 0, 0, 0, 1]));
  const cdj = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: L.b64url(challenge), origin: ORIGIN }));
  const sig = await subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, L.concat(authData, await L.sha256(cdj)));
  assert.equal((await L.verifyAssertion(cred, { authenticatorData: authData, clientDataJSON: cdj, signature: sig }, { challenge, origin: ORIGIN, rpId: RP })).ok, true);
});

test("Registrierung: clientData von create prüfen", () => {
  const challenge = L.randomBytes(32);
  const cd = (o) => new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: L.b64url(challenge), origin: ORIGIN, ...o }));
  assert.equal(L.checkCreateClientData(cd({}), { challenge, origin: ORIGIN }), true);
  assert.equal(L.checkCreateClientData(cd({ type: "webauthn.get" }), { challenge, origin: ORIGIN }), false);
  assert.equal(L.checkCreateClientData(cd({ origin: "https://x" }), { challenge, origin: ORIGIN }), false);
});

test("base64url Hin und zurück", () => {
  const a = L.randomBytes(77);
  assert.deepEqual(L.unb64url(L.b64url(a)), a);
  assert.ok(!/[+/=]/.test(L.b64url(a)));
});

test("Ablauf: Sitzung, Aktivität, Hintergrund", () => {
  const t0 = 1_000_000;
  const ms = L.autoLockMs({ autoLockMin: 5 });
  assert.equal(ms, 300000);
  assert.equal(L.autoLockMs({ autoLockMin: 7 }), 300000, "ungültig → Standard 5 Min.");
  assert.equal(L.autoLockMs({ autoLockMin: 1 }), 60000);
  const s = { ident: "cloud:u1", until: t0 + ms };
  assert.equal(L.sessionValid(s, "cloud:u1", t0), true);
  assert.equal(L.sessionValid(s, "cloud:u2", t0), false, "anderer Nutzer");
  assert.equal(L.sessionValid(s, "cloud:u1", t0 + ms), false, "abgelaufen");
  assert.equal(L.sessionValid(null, "cloud:u1", t0), false);
  // Aktivität schiebt nach vorne
  const s2 = L.touch(s, "cloud:u1", ms, t0 + 200000);
  assert.equal(s2.until, t0 + 200000 + ms);
  assert.equal(L.touch(s, "cloud:u1", ms, t0 + ms + 1), null, "abgelaufen bleibt gesperrt");
  // Hintergrund: höchstens 60 s
  const h = L.onHidden(s2, "cloud:u1", L.HIDDEN_MS, t0 + 210000);
  assert.equal(h.until, t0 + 210000 + 60000);
  assert.equal(h.hiddenAt, t0 + 210000);
  assert.equal(L.sessionValid(h, "cloud:u1", t0 + 210000 + 59000), true, "kurz weg → noch offen");
  assert.equal(L.sessionValid(h, "cloud:u1", t0 + 210000 + 61000), false, "> 60 s weg → gesperrt");
  // Hintergrund kürzt nie über das Inaktivitäts-Ende hinaus
  const near = { ident: "local", until: t0 + 10000 };
  assert.equal(L.onHidden(near, "local", 60000, t0).until, t0 + 10000);
});

test("Konfiguration: Standardwerte, Sperre nur mit PIN aktiv", () => {
  const d = L.normalizeCfg(null);
  assert.equal(d.enabled, false);
  assert.equal(d.autoLockMin, 5);
  assert.equal(d.maskElsewhere, false);
  assert.deepEqual(d.creds, []);
  assert.equal(L.normalizeCfg({ enabled: true }).enabled, false, "ohne PIN nie gesperrt");
  const c = L.normalizeCfg({ enabled: true, pin: { salt: "a", hash: "b", iter: 1000, len: 4 }, creds: [{ id: "x", publicKey: "y" }, { id: "" }], autoLockMin: 15 });
  assert.equal(c.enabled, true);
  assert.equal(c.creds.length, 1);
  assert.equal(c.creds[0].alg, L.ALG_ES256);
  assert.equal(c.autoLockMin, 15);
});
