// GET /ics: Firebase-ID-Token, Feed-Adresse nur aus Firestore, Größen-/Zeitlimit, Zwischenspeicher, CORS.
import test from "node:test";
import assert from "node:assert/strict";
import { makeAccount, FakeGoogle, PROJECT, UID, EMAIL, vt } from "./helpers.js";
import { handle } from "../src/worker.js";
import { clearCaches } from "../src/google.js";
import { clearJwks, JWKS_URL } from "../src/chat.js";
import { clearIcsCache, feedUrlOk, fetchFeed, ICS_CACHE_MS } from "../src/ics.js";

const NOW = vt(2026, 11, 5, 10, 0);
const ORIGIN = "https://muf2n.github.io";
const GURL = "https://calendar.google.com/calendar/ical/lippa.florian%40gmail.com/private-abc123/basic.ics";
const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x@google.com\r\nDTSTART:20261110T090000Z\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const b64u = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");

async function idToken(kp, over = {}) {
  const t = Math.floor(NOW / 1000);
  const claims = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 100, sub: UID, iat: t - 60, exp: t + 3000, email: EMAIL, email_verified: true, ...over };
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

async function setupIcs({ feeds = [{ id: "f1", name: "Google", color: "pfau", url: GURL, visible: true }], feed = () => new Response(ICS, { headers: { "content-type": "text/calendar" } }) } = {}) {
  clearCaches(); clearJwks(); clearIcsCache();
  const acc = await makeAccount();
  const g = new FakeGoogle({ publicKey: acc.publicKey });
  if (feeds) g.set(`users/${UID}/meta/ical_feeds`, { feeds });
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const feedCalls = [];
  let now = NOW;
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === JWKS_URL) return new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] }), { headers: { "cache-control": "max-age=3600" } });
    if (/googleapis\.com/.test(u)) return g.fetch(url, init);
    feedCalls.push({ url: u, init });
    return feed(u, init);
  };
  const env = { FIREBASE_SERVICE_ACCOUNT: acc.json, FIREBASE_PROJECT_ID: PROJECT, STEMPEL_EMAIL: EMAIL, STEMPEL_TOKEN: "x".repeat(32) };
  const get = async (query, { token, origin = ORIGIN, method = "GET" } = {}) => {
    const headers = {};
    if (origin) headers.origin = origin;
    if (token !== null) headers.authorization = `Bearer ${token ?? (await idToken(kp))}`;
    return handle(new Request(`https://stempelkarte-mcp.example.workers.dev/ics${query}`, { method, headers }), env, { fetchImpl, now: () => now });
  };
  return { g, kp, get, feedCalls, setNow: (t) => { now = t; } };
}

test("feedUrlOk: nur https, Google-iCal oder .ics, keine IPs/localhost", () => {
  assert.equal(feedUrlOk(GURL), true);
  assert.equal(feedUrlOk("https://outlook.office365.com/owa/calendar/abc/def/calendar.ics"), true);
  assert.equal(feedUrlOk("https://schule.example.at/termine.ICS"), true);
  assert.equal(feedUrlOk("http://calendar.google.com/calendar/ical/x/private-y/basic.ics"), false);
  assert.equal(feedUrlOk("https://calendar.google.com/foo"), false);
  assert.equal(feedUrlOk("https://example.com/kalender"), false);
  assert.equal(feedUrlOk("https://127.0.0.1/a.ics"), false);
  assert.equal(feedUrlOk("https://localhost/a.ics"), false);
  assert.equal(feedUrlOk("https://user:pw@example.com/a.ics"), false);
  assert.equal(feedUrlOk("https://example.com:8443/a.ics"), false);
  assert.equal(feedUrlOk("webcal://example.com/a.ics"), false);
});

test("GET /ics: liefert text/calendar, Adresse aus Firestore, CORS", async () => {
  const t = await setupIcs();
  const res = await t.get("?id=f1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^text\/calendar/);
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(res.headers.get("access-control-expose-headers"), /x-ics-fetched-at/);
  assert.equal(res.headers.get("x-ics-fetched-at"), String(NOW));
  assert.equal(await res.text(), ICS);
  assert.equal(t.feedCalls.length, 1);
  assert.equal(t.feedCalls[0].url, GURL);
  assert.equal(t.feedCalls[0].init.redirect, "manual");
  assert.ok(t.feedCalls[0].init.signal, "Zeitlimit über AbortSignal");
});

test("GET /ics: Zwischenspeicher 10 Min. je uid+feed, fresh=1 erst nach 1 Min.", async () => {
  const t = await setupIcs();
  assert.equal((await t.get("?id=f1")).status, 200);
  const r2 = await t.get("?id=f1");
  assert.equal(r2.headers.get("x-ics-cache"), "hit");
  assert.equal(t.feedCalls.length, 1);
  const r3 = await t.get("?id=f1&fresh=1");
  assert.equal(r3.headers.get("x-ics-cache"), "hit", "fresh innerhalb 1 Min. → Cache");
  t.setNow(NOW + 2 * 60000);
  await t.get("?id=f1&fresh=1");
  assert.equal(t.feedCalls.length, 2);
  t.setNow(NOW + 2 * 60000 + ICS_CACHE_MS - 1000);
  await t.get("?id=f1");
  assert.equal(t.feedCalls.length, 2);
  t.setNow(NOW + 2 * 60000 + ICS_CACHE_MS + 1000);
  await t.get("?id=f1");
  assert.equal(t.feedCalls.length, 3);
});

test("GET /ics: ohne/mit falschem Token 401, fremde Herkunft 403, OPTIONS", async () => {
  const t = await setupIcs();
  assert.equal((await t.get("?id=f1", { token: null })).status, 401);
  assert.equal((await t.get("?id=f1", { token: "a.b.c" })).status, 401);
  assert.equal((await t.get("?id=f1", { token: await idToken(t.kp, { email: "fremd@example.com" }) })).status, 401);
  assert.equal((await t.get("?id=f1", { origin: "https://evil.example" })).status, 403);
  const pre = await t.get("?id=f1", { method: "OPTIONS", token: null });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods"), /GET/);
  assert.equal((await t.get("?id=f1", { method: "OPTIONS", token: null, origin: "https://evil.example" })).status, 403);
  assert.equal(t.feedCalls.length, 0);
});

test("GET /ics: kein offener Proxy – url in der Anfrage wird ignoriert, unbekannte id 404", async () => {
  const t = await setupIcs();
  const r = await t.get("?id=nix&url=" + encodeURIComponent("https://evil.example/x.ics"));
  assert.equal(r.status, 404);
  assert.equal((await t.get("?id=../../x")).status, 400);
  assert.equal((await t.get("")).status, 400);
  const ok = await t.get("?id=f1&url=" + encodeURIComponent("https://evil.example/x.ics"));
  assert.equal(ok.status, 200);
  assert.deepEqual(t.feedCalls.map((c) => c.url), [GURL]);
});

test("GET /ics: gespeicherte unerlaubte Adresse → 422, ohne Abruf", async () => {
  const t = await setupIcs({ feeds: [{ id: "f1", url: "http://intern.example/x" }] });
  assert.equal((await t.get("?id=f1")).status, 422);
  assert.equal(t.feedCalls.length, 0);
});

test("GET /ics: Weiterleitung wird geprüft (nicht auf http/IP)", async () => {
  const t = await setupIcs({ feed: () => new Response(null, { status: 302, headers: { location: "http://10.0.0.1/a.ics" } }) });
  const r = await t.get("?id=f1");
  assert.equal(r.status, 422);
  assert.equal(t.feedCalls.length, 1);
  const t2 = await setupIcs({ feed: (u) => (u === GURL ? new Response(null, { status: 301, headers: { location: "https://calendar.google.com/calendar/ical/x/private-y/basic.ics" } }) : new Response(ICS)) });
  assert.equal((await t2.get("?id=f1")).status, 200);
  assert.equal(t2.feedCalls.length, 2);
});

test("GET /ics: Fehler vom Kalender → verständliche Meldung", async () => {
  const t = await setupIcs({ feed: () => new Response("nope", { status: 404 }) });
  const r = await t.get("?id=f1");
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /Link noch gültig/);
  const t2 = await setupIcs({ feed: () => new Response("<html>kein Kalender</html>") });
  assert.equal((await t2.get("?id=f1")).status, 422);
  const t3 = await setupIcs({ feed: () => { throw new TypeError("network"); } });
  assert.equal((await t3.get("?id=f1")).status, 502);
});

test("GET /ics: mehr als 2 MB → 413 (Content-Length und beim Lesen)", async () => {
  const big = "BEGIN:VCALENDAR\r\n" + "X".repeat(2 * 1024 * 1024 + 10);
  const t = await setupIcs({ feed: () => new Response(big, { headers: { "content-length": String(big.length) } }) });
  assert.equal((await t.get("?id=f1")).status, 413);
  // ohne Content-Length: gestreamt
  const t2 = await setupIcs({
    feed: () => new Response(new ReadableStream({
      start(c) { const chunk = new TextEncoder().encode("BEGIN:VCALENDAR\r\n" + "Y".repeat(512 * 1024)); for (let i = 0; i < 5; i++) c.enqueue(chunk); c.close(); },
    })),
  });
  const r = await t2.get("?id=f1");
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /2 MB/);
});

test("fetchFeed: Zeitlimit → 504-Fehler", async () => {
  const slow = (u, init) => new Promise((_, rej) => { init.signal.addEventListener("abort", () => rej(new DOMException("abgebrochen", "AbortError"))); });
  await assert.rejects(fetchFeed(GURL, slow, { timeoutMs: 30 }), (e) => e.status === 504 && /10 s/.test(e.message));
});

test("GET /ics: kein Feed-Dokument → 404; nur POST ist falsch → 405", async () => {
  const t = await setupIcs({ feeds: null });
  assert.equal((await t.get("?id=f1")).status, 404);
  assert.equal((await t.get("?id=f1", { method: "POST" })).status, 405);
});
