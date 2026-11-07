// Update 10 F – POST /auth/revoke („Überall abmelden“): ID-Token-Prüfung, Besitzer-Check, Identity-Toolkit accounts:update mit validSince.
import test from "node:test";
import assert from "node:assert/strict";
import { makeAccount, FakeGoogle, PROJECT, UID, EMAIL, vt } from "./helpers.js";
import { handle } from "../src/worker.js";
import { clearCaches } from "../src/google.js";
import { clearJwks, JWKS_URL } from "../src/chat.js";
import { IDTK } from "../src/auth.js";
import { clearRateLimits } from "../src/ratelimit.js";

const NOW = vt(2026, 11, 8, 9, 0);
const ORIGIN = "https://muf2n.github.io";
const b64u = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");

async function rsa() {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  return { kp, jwk: await crypto.subtle.exportKey("jwk", kp.publicKey) };
}
async function idToken(key, over = {}) {
  const t = Math.floor(NOW / 1000);
  const claims = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 100, sub: UID, iat: t - 60, exp: t + 3000, email: EMAIL, email_verified: true, ...over };
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

async function setup({ updateStatus = 200 } = {}) {
  clearCaches(); clearJwks(); clearRateLimits();
  const acc = await makeAccount();
  const g = new FakeGoogle({ publicKey: acc.publicKey });
  const fb = await rsa();
  const updates = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === JWKS_URL) return new Response(JSON.stringify({ keys: [{ ...fb.jwk, kid: "k1", alg: "RS256", use: "sig" }] }));
    if (u === `${IDTK}/projects/${PROJECT}/accounts:update`) {
      const bearer = String(init.headers.authorization || "").replace(/^Bearer\s+/, "");
      updates.push({ ok: g.tokens.has(bearer), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(updateStatus === 200 ? { localId: UID } : { error: { status: "PERMISSION_DENIED" } }), { status: updateStatus });
    }
    return g.fetch(url, init);
  };
  const env = { FIREBASE_SERVICE_ACCOUNT: acc.json, STEMPEL_TOKEN: "x".repeat(32), FIREBASE_PROJECT_ID: PROJECT, STEMPEL_EMAIL: EMAIL };
  const post = async ({ token, origin = ORIGIN, method = "POST", path = "/auth/revoke", ip = null } = {}) => {
    const headers = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    if (ip) headers["cf-connecting-ip"] = ip;
    if (token !== null) headers.authorization = `Bearer ${token ?? (await idToken(fb))}`;
    return handle(new Request("https://stempelkarte-mcp.example.workers.dev" + path, { method, headers, body: method === "POST" ? "{}" : undefined }), env, { fetchImpl, now: () => NOW, log: () => {} });
  };
  return { post, updates, fb };
}

test("/auth/revoke: Besitzer → accounts:update mit validSince = jetzt (Sekunden), CORS", async () => {
  const t = await setup();
  const res = await t.post();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  const out = await res.json();
  assert.equal(out.ok, true);
  assert.equal(out.validSince, Math.floor(NOW / 1000));
  assert.equal(t.updates.length, 1);
  assert.equal(t.updates[0].ok, true, "mit Dienstkonto-Zugriffstoken");
  assert.deepEqual(t.updates[0].body, { localId: UID, validSince: String(Math.floor(NOW / 1000)) });
});

test("/auth/revoke: ohne/ungültiges Token, fremde E-Mail, fremde Herkunft, GET → abgelehnt, kein Google-Aufruf", async () => {
  const t = await setup();
  assert.equal((await t.post({ token: null })).status, 401);
  assert.equal((await t.post({ token: "a.b.c" })).status, 401);
  assert.equal((await t.post({ token: await idToken(t.fb, { email: "fremd@example.com" }) })).status, 401);
  assert.equal((await t.post({ token: await idToken(t.fb, { email_verified: false }) })).status, 401);
  assert.equal((await t.post({ token: await idToken(t.fb, { exp: Math.floor(NOW / 1000) - 10 }) })).status, 401);
  assert.equal((await t.post({ origin: "https://evil.example" })).status, 403);
  assert.equal((await t.post({ method: "GET" })).status, 405);
  assert.equal((await t.post({ path: "/auth/other" })).status, 404);
  assert.equal(t.updates.length, 0);
  const pre = await t.post({ method: "OPTIONS" });
  assert.equal(pre.status, 204);
});

test("/auth/revoke: Google-Fehler → 502 ohne Details; Ratenbegrenzung pro IP", async () => {
  const t = await setup({ updateStatus: 403 });
  const res = await t.post();
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /nicht geklappt/);
  const t2 = await setup();
  let last = 0;
  for (let i = 0; i < 7; i++) last = (await t2.post({ ip: "203.0.113.9" })).status;
  assert.equal(last, 429);
});
