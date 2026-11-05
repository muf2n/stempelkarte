// Bankverbindung (Enable Banking): Attrappe der API (JWT-Prüfung, aspsps, auth, sessions, Buchungen mit
// continuation_key, Salden, Fehler) + In-Memory-Firestore aus helpers.js.
import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import { makeAccount, FakeGoogle, PROJECT, UID, EMAIL, vt } from "./helpers.js";
import worker, { handle } from "../src/worker.js";
import { clearCaches } from "../src/google.js";
import { clearJwks, JWKS_URL } from "../src/chat.js";
import { EB_BASE, DEFAULT_REDIRECT, clearBankCaches, parsePrivateKey, normalizeTx, runBankCron, sha256Hex } from "../src/bank.js";
import { BUILTIN_RULES as WORKER_RULES, suggestCategory as workerSuggest } from "../src/money.js";
import { BUILTIN_RULES as WEB_RULES, suggestCategory as webSuggest } from "../../../js/alltag/money-core.js";

const NOW = vt(2026, 11, 5, 10, 0);
const ORIGIN = "https://muf2n.github.io";
const APP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const b64u = (x) => Buffer.from(typeof x === "string" ? x : new Uint8Array(x)).toString("base64url");
const pemOf = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END ${label}-----\n`;

async function rsa() {
  return crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
}

async function idToken(kp, now = NOW, over = {}) {
  const t = Math.floor(now / 1000);
  const claims = { iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, auth_time: t - 100, sub: UID, iat: t - 60, exp: t + 3000, email: EMAIL, email_verified: true, ...over };
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

const tx = (o) => ({
  status: "BOOK", credit_debit_indicator: "DBIT", booking_date: "2026-11-03", value_date: "2026-11-03",
  transaction_amount: { currency: "EUR", amount: "12.40" }, remittance_information: [], ...o,
});

/** Enable-Banking-Attrappe. */
class FakeEB {
  constructor(publicKey) {
    this.publicKey = publicKey;
    this.calls = [];
    this.pages = { "acc-1": [[tx({ entry_reference: "E1", creditor: { name: "BILLA DANKT 1234" }, remittance_information: ["POS 12.40 EUR"] })]] };
    this.balances = { "acc-1": [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "1500.00" } }, { balance_type: "ITAV", balance_amount: { currency: "EUR", amount: "1234.56" } }] };
    this.fail = null; // {path: RegExp, status, error}
    this.maxConsent = 15552000;
    this.aspspList = null;
    this.sessionAccounts = [{ uid: "acc-1", account_id: { iban: "AT611904300234573201" }, name: "Konto Florian", currency: "EUR" }];
    this.deleted = [];
  }
  async verify(auth) {
    const tok = String(auth || "").replace(/^Bearer /, "");
    const [h, c, s] = tok.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url"));
    const claims = JSON.parse(Buffer.from(c, "base64url"));
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", this.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`));
    assert.ok(ok, "JWT-Signatur");
    assert.equal(header.alg, "RS256");
    assert.equal(header.kid, APP_ID);
    assert.equal(claims.iss, "enablebanking.com");
    assert.equal(claims.aud, "api.enablebanking.com");
    assert.ok(claims.exp - claims.iat <= 86400 && claims.exp > claims.iat);
  }
  async fetch(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    this.calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: init.headers });
    await this.verify(init.headers.authorization);
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (this.fail && this.fail.path.test(u.pathname) && (!this.fail.times || this.fail.times-- > 0)) {
      return reply(this.fail.status, { code: this.fail.status, message: "Fehler", error: this.fail.error });
    }
    if (u.pathname === "/aspsps") {
      assert.equal(u.searchParams.get("country"), "AT");
      return reply(200, { aspsps: this.aspspList || [
        { name: "Erste Bank und Sparkassen", country: "AT", maximum_consent_validity: 15552000 },
        { name: "easybank", country: "AT", maximum_consent_validity: 15552000 },
        { name: "BAWAG", country: "AT", maximum_consent_validity: this.maxConsent, psu_types: ["personal", "business"] },
      ] });
    }
    if (u.pathname === "/auth" && method === "POST") {
      this.lastAuth = body;
      return reply(200, { url: "https://enablebanking.example/auth?x=1", authorization_id: "auth-1" });
    }
    if (u.pathname === "/sessions" && method === "POST") {
      assert.equal(body.code, "CODE-1");
      return reply(200, { session_id: "sess-1", accounts: this.sessionAccounts, aspsp: { name: "BAWAG", country: "AT" }, psu_type: "personal", access: { valid_until: this.lastAuth.access.valid_until } });
    }
    let m;
    if ((m = /^\/sessions\/(.+)$/.exec(u.pathname)) && method === "DELETE") { this.deleted.push(m[1]); return reply(200, { message: "OK" }); }
    if ((m = /^\/accounts\/([^/]+)\/balances$/.exec(u.pathname))) return reply(200, { balances: this.balances[m[1]] || [] });
    if ((m = /^\/accounts\/([^/]+)\/transactions$/.exec(u.pathname))) {
      const pages = this.pages[m[1]] || [[]];
      const i = Number(u.searchParams.get("continuation_key") || 0);
      const res = { transactions: pages[i] || [] };
      if (i + 1 < pages.length) res.continuation_key = String(i + 1);
      return reply(200, res);
    }
    return reply(404, { error: "NOT_FOUND" });
  }
}

async function setup({ env = {}, keyFormat = "pkcs8" } = {}) {
  clearCaches(); clearJwks(); clearBankCaches();
  const acc = await makeAccount();
  const g = new FakeGoogle({ publicKey: acc.publicKey });
  const fb = await rsa();
  const fbJwk = await crypto.subtle.exportKey("jwk", fb.publicKey);
  const ebKp = await rsa();
  const der = await crypto.subtle.exportKey("pkcs8", ebKp.privateKey);
  let pem = pemOf(der, "PRIVATE KEY");
  if (keyFormat === "pkcs1") pem = createPrivateKey(pem).export({ type: "pkcs1", format: "pem" });
  const eb = new FakeEB(ebKp.publicKey);
  const fetchImpl = async (url, init = {}) => {
    const s = String(url);
    if (s === JWKS_URL) return new Response(JSON.stringify({ keys: [{ ...fbJwk, kid: "k1", alg: "RS256" }] }), { headers: { "cache-control": "max-age=3600" } });
    if (s.startsWith(EB_BASE)) return eb.fetch(s, init);
    return g.fetch(url, init);
  };
  const fullEnv = { FIREBASE_SERVICE_ACCOUNT: acc.json, FIREBASE_PROJECT_ID: PROJECT, STEMPEL_EMAIL: EMAIL, ENABLEBANKING_APP_ID: APP_ID, ENABLEBANKING_KEY: pem, ...env };
  let now = NOW;
  const req = async (path, { body, method = "POST", token, origin = ORIGIN, headers = {} } = {}) => {
    const h = { "content-type": "application/json", ...headers };
    if (origin) h.origin = origin;
    if (token !== null) h.authorization = `Bearer ${token ?? (await idToken(fb, now))}`;
    const r = new Request(`https://stempelkarte-mcp.example.workers.dev${path}`, { method, headers: h, body: method === "POST" ? JSON.stringify(body || {}) : undefined });
    const res = await handle(r, fullEnv, { fetchImpl, now: () => now });
    return { status: res.status, headers: res.headers, data: res.status === 204 ? null : await res.json() };
  };
  const base = `users/${UID}`;
  /** start → finish wie im echten Ablauf */
  const link = async () => {
    const s = await req("/bank/start", { body: {} });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    return req("/bank/finish", { body: { code: "CODE-1", state: eb.lastAuth.state } });
  };
  return { g, eb, req, link, base, env: fullEnv, fetchImpl, setNow: (t) => { now = t; }, getNow: () => now, fb };
}

test("Kategorie-Regeln im Worker sind identisch mit js/alltag/money-core.js", () => {
  assert.deepEqual(WORKER_RULES, WEB_RULES);
  for (const n of ["BILLA DANKT", "OMV 1234 Wien", "Netflix.com", "Lehrlingsentschädigung Oktober", "Sparkasse Überweisung"]) {
    assert.deepEqual(workerSuggest(n, [{ keyword: "huber", cat: "werkzeug" }]), webSuggest(n, [{ keyword: "huber", cat: "werkzeug" }]));
  }
});

test("PEM: PKCS#8 und PKCS#1 werden gelesen", async () => {
  const kp = await rsa();
  const der = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const p8 = pemOf(der, "PRIVATE KEY");
  const p1 = createPrivateKey(p8).export({ type: "pkcs1", format: "pem" });
  assert.equal(parsePrivateKey(p8).format, "pkcs8");
  const r1 = parsePrivateKey(p1.replace(/\n/g, "\\n")); // als einzeiliges Secret mit „\n“
  assert.equal(r1.format, "pkcs1");
  assert.deepEqual(Buffer.from(r1.der), Buffer.from(der)); // PKCS#1 → PKCS#8 ergibt dasselbe DER wie WebCrypto
});

test("start: BAWAG gesucht, /auth mit valid_until ≤ 180 Tage, state gespeichert, redirect_url", async () => {
  const t = await setup();
  t.eb.maxConsent = 90 * 86400; // Bank erlaubt nur 90 Tage → daran halten
  const r = await t.req("/bank/start", { body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.data.url, "https://enablebanking.example/auth?x=1");
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  const a = t.eb.lastAuth;
  assert.deepEqual(a.aspsp, { name: "BAWAG", country: "AT" });
  assert.equal(a.psu_type, "personal");
  assert.equal(a.redirect_url, DEFAULT_REDIRECT);
  const vu = Date.parse(a.access.valid_until);
  assert.ok(vu <= NOW + 90 * 86400e3 && vu > NOW + 89 * 86400e3);
  assert.ok(a.state.length >= 40);
  const pend = t.g.get(`${t.base}/meta/bank_pending`);
  assert.equal(pend.stateHash, await sha256Hex(a.state));
  assert.equal(pend.exp, NOW + 15 * 60e3);
  assert.ok(!JSON.stringify(pend).includes(a.state), "state nur als Hash gespeichert");

  t.eb.maxConsent = 400 * 86400; // mehr als 180 → 180
  await t.req("/bank/start", { body: {} });
  assert.ok(Date.parse(t.eb.lastAuth.access.valid_until) <= NOW + 180 * 86400e3);
});

test("start: eigene Rückruf-Adresse, unbekannte Bank → 404 mit Liste", async () => {
  const t = await setup({ env: { BANK_REDIRECT_URL: "http://localhost:8848/bank-callback.html" } });
  await t.req("/bank/start", { body: {} });
  assert.equal(t.eb.lastAuth.redirect_url, "http://localhost:8848/bank-callback.html");
  const r = await t.req("/bank/start", { body: { aspsp: "Gibtsnicht Bank" } });
  assert.equal(r.status, 404);
  assert.ok(r.data.aspsps.includes("BAWAG"));
});

test("finish: state prüfen, Sitzung speichern (ohne volle IBAN), erster Abgleich 90 Tage", async () => {
  const t = await setup();
  await t.req("/bank/start", { body: {} });
  const bad = await t.req("/bank/finish", { body: { code: "CODE-1", state: "falsch" } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /state/);
  const r = await t.req("/bank/finish", { body: { code: "CODE-1", state: t.eb.lastAuth.state } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ok, true);
  assert.equal(r.data.imported, 1);
  const meta = t.g.get(`${t.base}/meta/bank`);
  assert.equal(meta.session_id, "sess-1");
  assert.equal(meta.aspsp, "BAWAG");
  assert.deepEqual(meta.accounts.map((a) => [a.uid, a.iban_last4, a.name, a.currency]), [["acc-1", "3201", "Konto Florian", "EUR"]]);
  assert.ok(!JSON.stringify(t.g.docs.get(`${t.base}/meta/bank`)).includes("AT6119043"), "keine volle IBAN");
  assert.equal(meta.balance.amount, 1234.56); // ITAV vor CLBD
  assert.equal(meta.lastSync, NOW);
  const txCall = t.eb.calls.find((c) => /transactions/.test(c.path));
  assert.equal(txCall.query.date_from, "2026-08-07"); // 90 Tage zurück
  // state ist verbraucht
  const again = await t.req("/bank/finish", { body: { code: "CODE-1", state: t.eb.lastAuth.state } });
  assert.equal(again.status, 400);
  // Status
  const st = await t.req("/bank/status", { method: "GET" });
  assert.equal(st.status, 200);
  assert.equal(st.data.linked, true);
  assert.equal(st.data.daysLeft, 179);
  assert.equal(st.data.balance.amount, 1234.56);
  assert.equal(st.data.accounts[0].iban_last4, "3201");
  assert.ok(!("session_id" in st.data));
});

test("finish: abgelaufener Versuch (> 15 min) wird abgelehnt", async () => {
  const t = await setup();
  await t.req("/bank/start", { body: {} });
  t.setNow(NOW + 16 * 60e3);
  const r = await t.req("/bank/finish", { body: { code: "CODE-1", state: t.eb.lastAuth.state } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /abgelaufen/);
});

test("finish ohne ID-Token (Handy-Browser): state genügt, UID über E-Mail", async () => {
  const t = await setup();
  await t.req("/bank/start", { body: {} });
  const r = await t.req("/bank/finish", { body: { code: "CODE-1", state: t.eb.lastAuth.state }, token: null });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(t.g.get(`${t.base}/meta/bank`).session_id, "sess-1");
  // L2: ohne Anmeldung keine Salden, Konten oder Verläufe in der Antwort
  assert.deepEqual(r.data, { ok: true });
  // andere Routen brauchen weiter die Anmeldung
  assert.equal((await t.req("/bank/sync", { token: null })).status, 401);
  assert.equal((await t.req("/bank/status", { method: "GET", token: null })).status, 401);
  assert.equal((await t.req("/bank/status", { method: "GET", token: "x.y.z" })).status, 401);
});

test("finish: keine Konten freigegeben (Restricted Mode) → verständlicher Hinweis", async () => {
  const t = await setup();
  t.eb.sessionAccounts = [];
  const r = await t.link();
  assert.equal(r.status, 200);
  assert.match(r.data.warn, /Control-Panel/);
  assert.equal(r.data.status.lastError.code, "NO_ACCOUNTS");
});

test("Buchungen: continuation_key, nur BOOK, Kategorien (Regeln + gelernt), Felder wie money_tx", async () => {
  const t = await setup();
  t.g.set(`${t.base}/a_money_rules/r_huber`, { keyword: "huber", cat: "werkzeug" });
  t.eb.pages["acc-1"] = [
    [tx({ entry_reference: "E1", creditor: { name: "BILLA DANKT 1234" }, remittance_information: ["POS 12.40 EUR"] }),
      tx({ entry_reference: "P1", status: "PDNG", creditor: { name: "OMV" } })],
    [], // leere Seite mit continuation_key (FAQ: weiter folgen)
    [tx({ transaction_id: "T2", credit_debit_indicator: "CRDT", transaction_amount: { currency: "EUR", amount: "850.00" }, debtor: { name: "Elektro Muster GmbH" }, remittance_information: ["Lehrlingsentschädigung 10/2026"], booking_date: "2026-10-30" }),
      tx({ entry_reference: "E3", creditor: { name: "Huber Elektrogroßhandel" }, transaction_amount: { currency: "EUR", amount: "-45.90" }, booking_date: "2026-11-01" }),
      tx({ creditor: { name: "Unbekannt KG" }, transaction_amount: { currency: "EUR", amount: "5" }, booking_date: "2026-11-02" })],
  ];
  const r = await t.link();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(t.eb.calls.filter((c) => /transactions/.test(c.path)).length, 3);
  const list = t.g.list(`${t.base}/a_money_tx`).sort((a, b) => a.date.localeCompare(b.date));
  assert.equal(list.length, 4, "PDNG nicht übernommen");
  const by = Object.fromEntries(list.map((x) => [x.note, x]));
  assert.equal(by["BILLA DANKT 1234"].category, "essen");
  assert.equal(by["BILLA DANKT 1234"].type, "out");
  assert.equal(by["BILLA DANKT 1234"].amount, 12.4);
  assert.equal(by["BILLA DANKT 1234"].src, "bank");
  assert.equal(by["BILLA DANKT 1234"].bankRef, "E1");
  assert.equal(by["BILLA DANKT 1234"].counterparty, "BILLA DANKT 1234");
  assert.match(by["BILLA DANKT 1234"].id, /^bk_[0-9a-f]{24}$/);
  assert.equal(by["Elektro Muster GmbH"].type, "in");
  assert.equal(by["Elektro Muster GmbH"].category, "einkommen");
  assert.equal(by["Elektro Muster GmbH"].bankRef, "T2");
  assert.equal(by["Huber Elektrogroßhandel"].category, "werkzeug"); // gelernte Regel
  assert.equal(by["Huber Elektrogroßhandel"].amount, 45.9);
  assert.equal(by["Unbekannt KG"].category, "sonstiges");
  assert.equal(by["Unbekannt KG"].bankRef, null);
  for (const x of list) {
    for (const k of ["id", "date", "amount", "type", "category", "note", "created", "updated"]) assert.ok(k in x, k);
    assert.equal(x.updated, x.bankSync);
  }
});

test("Dedupe, Bearbeitungs-Schutz, gelöschte bleiben weg, Zusammenführen mit Abo-Buchung", async () => {
  const t = await setup();
  // Abo-Buchung aus der App (money.js catchUpSubs) – gleiche Zahlung kommt von der Bank 2 Tage später
  t.g.set(`${t.base}/a_money_tx/sub_netflix_2026-11-01`, { id: "sub_netflix_2026-11-01", date: "2026-11-01", amount: 13.99, type: "out", category: "abos", note: "Netflix", recurringId: "netflix", created: 1, updated: 1 });
  t.eb.pages["acc-1"] = [[
    tx({ entry_reference: "E1", creditor: { name: "BILLA DANKT 1234" } }),
    tx({ entry_reference: "E2", creditor: { name: "SPAR 5555" }, transaction_amount: { currency: "EUR", amount: "7.10" } }),
    tx({ entry_reference: "N1", creditor: { name: "NETFLIX.COM" }, transaction_amount: { currency: "EUR", amount: "13.99" }, booking_date: "2026-11-03" }),
  ]];
  await t.link();
  let list = t.g.list(`${t.base}/a_money_tx`);
  assert.equal(list.length, 3, "Netflix zusammengeführt statt doppelt");
  const nf = t.g.get(`${t.base}/a_money_tx/sub_netflix_2026-11-01`);
  assert.equal(nf.bankRef, "N1");
  assert.ok(nf.bankId.startsWith("bk_"));
  assert.equal(nf.updated, 1, "Abo-Buchung sonst unverändert");

  const billa = list.find((x) => x.note === "BILLA DANKT 1234");
  const spar = list.find((x) => x.note === "SPAR 5555");
  // Nutzer ändert Billa (db.js put → updated neu) und löscht Spar
  t.g.set(`${t.base}/a_money_tx/${billa.id}`, { ...billa, category: "freizeit", note: "Party-Einkauf", updated: NOW + 1000 });
  t.g.docs.delete(`${t.base}/a_money_tx/${spar.id}`);

  // zweiter Abgleich am nächsten Tag: gleiche Buchungen nochmal (Überlappung) + Bank ändert Text
  t.setNow(NOW + 86400e3);
  t.eb.pages["acc-1"] = [[
    tx({ entry_reference: "E1", creditor: { name: "BILLA DANKT 9999" } }),
    tx({ entry_reference: "E2", creditor: { name: "SPAR 5555" }, transaction_amount: { currency: "EUR", amount: "7.10" } }),
    tx({ entry_reference: "N1", creditor: { name: "NETFLIX.COM" }, transaction_amount: { currency: "EUR", amount: "13.99" }, booking_date: "2026-11-03" }),
    tx({ entry_reference: "E4", creditor: { name: "OMV 4711" }, transaction_amount: { currency: "EUR", amount: "40.00" }, booking_date: "2026-11-05" }),
  ]];
  const r = await t.req("/bank/sync");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.imported, 1);
  const txCall = t.eb.calls.filter((c) => /transactions/.test(c.path)).pop();
  assert.equal(txCall.query.date_from, "2026-11-02", "ab lastSync − 3 Tage");
  assert.equal(txCall.headers["psu-user-agent"], undefined);
  list = t.g.list(`${t.base}/a_money_tx`);
  assert.equal(list.length, 3, "Billa + Abo-Netflix + OMV neu; Spar nicht wieder angelegt, Netflix nicht doppelt");
  const b2 = t.g.get(`${t.base}/a_money_tx/${billa.id}`);
  assert.equal(b2.category, "freizeit");
  assert.equal(b2.note, "Party-Einkauf");
  assert.equal(list.find((x) => x.note === "OMV 4711").category, "auto");
});

test("unveränderte Bankbuchungen werden bei neuen Regeln nachkategorisiert, sonst kein Schreiben", async () => {
  const t = await setup();
  t.eb.pages["acc-1"] = [[tx({ entry_reference: "X1", creditor: { name: "Kebabhaus Ali" } })]];
  await t.link();
  const id = t.g.list(`${t.base}/a_money_tx`)[0].id;
  assert.equal(t.g.get(`${t.base}/a_money_tx/${id}`).category, "essengehen");
  const commits = t.g.commits.length;
  t.setNow(NOW + 3600e3);
  await t.req("/bank/sync");
  const txWrites = t.g.commits.slice(commits).flatMap((c) => c.writes).filter((w) => w.update.name.includes("a_money_tx"));
  assert.equal(txWrites.length, 0, "nichts geändert → nichts geschrieben");
  t.g.set(`${t.base}/a_money_rules/r_ali`, { keyword: "kebabhaus ali", cat: "freizeit" });
  await t.req("/bank/sync");
  assert.equal(t.g.get(`${t.base}/a_money_tx/${id}`).category, "freizeit");
});

test("Fehler: ASPSP_RATE_LIMIT_EXCEEDED und EXPIRED_SESSION werden sauber gemeldet", async () => {
  const t = await setup();
  await t.link();
  t.setNow(NOW + 3600e3);
  t.eb.fail = { path: /transactions/, status: 429, error: "ASPSP_RATE_LIMIT_EXCEEDED" };
  const r = await t.req("/bank/sync");
  assert.equal(r.status, 200);
  assert.match(r.data.error.msg, /wenige automatische Abrufe/);
  let meta = t.g.get(`${t.base}/meta/bank`);
  assert.equal(meta.rateLimitedAt, NOW + 3600e3);
  assert.equal(meta.lastSync, NOW, "lastSync bleibt");
  // Cron pausiert 6 h nach Rate-Limit
  const calls = t.eb.calls.length;
  const c1 = await runBankCron(t.env, { fetchImpl: t.fetchImpl, now: NOW + 2 * 3600e3 });
  assert.equal(c1.skipped, "rate_limited");
  assert.equal(t.eb.calls.length, calls);

  t.eb.fail = { path: /transactions/, status: 401, error: "EXPIRED_SESSION" };
  t.setNow(NOW + 8 * 3600e3);
  const r2 = await t.req("/bank/sync");
  assert.equal(r2.status, 200);
  assert.match(r2.data.error.msg, /abgelaufen/);
  meta = t.g.get(`${t.base}/meta/bank`);
  assert.equal(meta.expired, true);
  assert.equal(r2.data.status.expired, true);
  // abgelaufen → Aufgabe zum Erneuern, Cron überspringt
  const todos = t.g.list(`${t.base}/todos`);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].title, "Bankverbindung erneuern");
  assert.equal((await runBankCron(t.env, { fetchImpl: t.fetchImpl, now: NOW + 9 * 3600e3 })).skipped, "expired");
});

test("Fehler bei /auth (Bank down) → 502 mit deutscher Meldung; ohne Secrets → 503", async () => {
  const t = await setup();
  t.eb.fail = { path: /^\/auth$/, status: 500, error: "ASPSP_ERROR" };
  const r = await t.req("/bank/start", { body: {} });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /nicht erreichbar/);
  const t2 = await setup({ env: { ENABLEBANKING_APP_ID: "" } });
  const r2 = await t2.req("/bank/start", { body: {} });
  assert.equal(r2.status, 503);
  assert.match(r2.data.error, /ENABLEBANKING_APP_ID/);
});

test("PKCS#1-Schlüssel funktioniert genauso", async () => {
  const t = await setup({ keyFormat: "pkcs1" });
  assert.match(t.env.ENABLEBANKING_KEY, /BEGIN RSA PRIVATE KEY/);
  const r = await t.link();
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test("Erneuerungs-Aufgabe genau einmal, wenn < 7 Tage übrig", async () => {
  const t = await setup();
  await t.link();
  const meta = t.g.get(`${t.base}/meta/bank`);
  t.setNow(Date.parse(meta.valid_until) - 10 * 86400e3);
  await t.req("/bank/sync");
  assert.equal(t.g.list(`${t.base}/todos`).length, 0);
  t.setNow(Date.parse(meta.valid_until) - 6 * 86400e3);
  await t.req("/bank/sync");
  await t.req("/bank/sync");
  const todos = t.g.list(`${t.base}/todos`);
  assert.equal(todos.length, 1);
  const td = todos[0];
  assert.equal(td.title, "Bankverbindung erneuern");
  assert.equal(td.kind, "todo");
  assert.equal(td.done, false);
  assert.equal(typeof td.createdAt, "number");
  assert.match(td.note, /läuft am \d\d\.\d\d\.\d{4} ab/);
  const st = await t.req("/bank/status", { method: "GET" });
  assert.equal(st.data.daysLeft, 6);
});

test("Cron: scheduled() holt neue Buchungen ab lastSync − 3 Tage ohne PSU-Header", async () => {
  const t = await setup();
  await t.link();
  t.eb.pages["acc-1"] = [[tx({ entry_reference: "C1", creditor: { name: "Hofer" }, booking_date: "2026-11-05" })]];
  const later = NOW + 6 * 3600e3;
  const r = await runBankCron(t.env, { fetchImpl: t.fetchImpl, now: later });
  assert.equal(r.imported, 1);
  const call = t.eb.calls.filter((c) => /transactions/.test(c.path)).pop();
  assert.equal(call.query.date_from, "2026-11-02");
  assert.equal(call.headers["psu-ip-address"], undefined);
  assert.equal(t.g.get(`${t.base}/meta/bank`).lastSync, later);
  // ohne Verbindung / ohne Secrets: nichts tun
  assert.equal((await runBankCron({ ...t.env, ENABLEBANKING_KEY: "" }, { fetchImpl: t.fetchImpl, now: later })).skipped, "not_configured");
  // Export für Cloudflare vorhanden
  assert.equal(typeof worker.scheduled, "function");
});

test("sync mit PSU-Headern, unlink löscht Sitzung bei Enable Banking, Buchungen bleiben", async () => {
  const t = await setup();
  await t.link();
  await t.req("/bank/sync", { headers: { "user-agent": "Mozilla/5.0 Test", "cf-connecting-ip": "203.0.113.5" } });
  const call = t.eb.calls.filter((c) => /transactions/.test(c.path)).pop();
  assert.equal(call.headers["psu-ip-address"], "203.0.113.5");
  assert.equal(call.headers["psu-user-agent"], "Mozilla/5.0 Test");
  const r = await t.req("/bank/unlink");
  assert.equal(r.status, 200);
  assert.deepEqual(t.eb.deleted, ["sess-1"]);
  const st = await t.req("/bank/status", { method: "GET" });
  assert.equal(st.data.linked, false);
  assert.equal(t.g.list(`${t.base}/a_money_tx`).length, 1);
  assert.equal((await t.req("/bank/sync")).data.skipped, "not_linked");
});

test("CORS: Preflight, fremde Herkunft, falsche Methode", async () => {
  const t = await setup();
  const pre = await t.req("/bank/status", { method: "OPTIONS", token: null });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-methods"), /GET/);
  assert.equal((await t.req("/bank/status", { method: "GET", origin: "https://evil.example" })).status, 403);
  assert.equal((await t.req("/bank/status", { body: {} })).status, 405);
  assert.equal((await t.req("/bank/xyz", { body: {} })).status, 404);
});

test("normalizeTx: Datum-Fallback, Betrag mit Vorzeichen, gleiche Daten → gleiche ID", async () => {
  const a = await normalizeTx(tx({ booking_date: null, value_date: "2026-10-01", transaction_amount: { amount: "-3.5", currency: "EUR" }, credit_debit_indicator: undefined, remittance_information: ["Kaffee"] }), "3201");
  assert.equal(a.date, "2026-10-01");
  assert.equal(a.type, "out");
  assert.equal(a.amount, 3.5);
  assert.equal(a.note, "Kaffee");
  const b = await normalizeTx(tx({ booking_date: null, value_date: "2026-10-01", transaction_amount: { amount: "-3.5", currency: "EUR" }, credit_debit_indicator: undefined, remittance_information: ["Kaffee"] }), "3201");
  assert.equal(a.id, b.id);
  assert.equal(await normalizeTx(tx({ status: "PDNG" }), "x"), null);
});

/* ---------- Update 9 – Sparziele: mehrere Konten, Salden je Konto, Verlauf ---------- */
import { addHistoryPoint, backfillHistory, mainAccountUid, matchAccount, HISTORY_POINTS } from "../src/bank.js";

const SPAR = { uid: "acc-2", account_id: { iban: "AT021400012345678901" }, name: "Online Sparen", product: "Sparkonto", currency: "EUR", identification_hash: "h-spar" };
const GIRO = { uid: "acc-1", account_id: { iban: "AT611904300234573201" }, name: "Konto Florian", currency: "EUR", identification_hash: "h-giro" };

test("zwei Konten: balances je Konto, balance = Hauptkonto (Giro), Verlauf aus Buchungen rekonstruiert", async () => {
  const t = await setup();
  t.eb.sessionAccounts = [SPAR, GIRO]; // Reihenfolge der Bank egal – Hauptkonto ist das Nicht-Sparkonto
  t.eb.balances["acc-2"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "600.00" }, reference_date: "2026-11-05" }];
  t.eb.pages["acc-2"] = [[
    tx({ entry_reference: "S1", credit_debit_indicator: "CRDT", transaction_amount: { currency: "EUR", amount: "100.00" }, booking_date: "2026-10-01", debtor: { name: "Florian" }, remittance_information: ["Dauerauftrag Sparen"] }),
    tx({ entry_reference: "S2", credit_debit_indicator: "CRDT", transaction_amount: { currency: "EUR", amount: "100.00" }, booking_date: "2026-11-01", debtor: { name: "Florian" }, remittance_information: ["Dauerauftrag Sparen"] }),
  ]];
  const r = await t.link();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const meta = t.g.get(`${t.base}/meta/bank`);
  assert.equal(meta.accounts.length, 2);
  assert.deepEqual(meta.accounts.map((a) => [a.uid, a.iban_last4, a.name, a.hash]), [["acc-2", "8901", "Online Sparen", "h-spar"], ["acc-1", "3201", "Konto Florian", "h-giro"]]);
  assert.equal(meta.accounts[0].product, "Sparkonto");
  assert.equal(meta.mainUid, "acc-1");
  assert.equal(meta.balance.amount, 1234.56, "balance = Hauptkonto, nicht die Summe");
  assert.equal(meta.balances["acc-1"].amount, 1234.56);
  assert.deepEqual({ ...meta.balances["acc-2"], at: 0 }, { amount: 600, currency: "EUR", date: "2026-11-05", at: 0 });
  const h = meta.balanceHistory["acc-2"];
  assert.equal(h.length, 91, "90 Tage zurück + heute");
  assert.deepEqual(h[h.length - 1], { d: "2026-11-05", a: 600 });
  assert.equal(h.find((p) => p.d === "2026-10-31").a, 500);
  assert.equal(h.find((p) => p.d === "2026-11-01").a, 600);
  assert.equal(h.find((p) => p.d === "2026-09-30").a, 400);
  // Status liefert alles für die App (uid, Salden, Verlauf), aber keine Sitzung
  const st = await t.req("/bank/status", { method: "GET" });
  assert.equal(st.data.accounts.length, 2);
  assert.equal(st.data.accounts.find((a) => a.main).uid, "acc-1");
  assert.equal(st.data.balances["acc-2"].amount, 600);
  assert.equal(st.data.balanceHistory["acc-2"].length, 91);
  assert.ok(!JSON.stringify(st.data).includes("AT0214"), "keine volle IBAN");
  // Buchungen beider Konten importiert
  assert.equal(t.g.list(`${t.base}/a_money_tx`).length, 3);
});

test("Cron ergänzt einen Tagespunkt je Konto (gleicher Tag wird ersetzt)", async () => {
  const t = await setup();
  t.eb.sessionAccounts = [GIRO, SPAR];
  t.eb.balances["acc-2"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "600.00" } }];
  await t.link();
  t.eb.balances["acc-2"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "650.00" } }];
  await runBankCron(t.env, { fetchImpl: t.fetchImpl, now: NOW + 3 * 3600e3 });
  let h = t.g.get(`${t.base}/meta/bank`).balanceHistory["acc-2"];
  assert.deepEqual(h[h.length - 1], { d: "2026-11-05", a: 650 });
  const n = h.length;
  t.eb.balances["acc-2"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "700.00" } }];
  await runBankCron(t.env, { fetchImpl: t.fetchImpl, now: NOW + 86400e3 });
  h = t.g.get(`${t.base}/meta/bank`).balanceHistory["acc-2"];
  assert.equal(h.length, n + 1);
  assert.deepEqual(h.slice(-2), [{ d: "2026-11-05", a: 650 }, { d: "2026-11-06", a: 700 }]);
  assert.equal(t.g.get(`${t.base}/meta/bank`).balances["acc-2"].amount, 700);
});

test("Fehler bei einem Konto hält das andere nicht auf", async () => {
  const t = await setup();
  t.eb.sessionAccounts = [GIRO, SPAR];
  t.eb.fail = { path: /acc-2\/transactions/, status: 500, error: "ASPSP_ERROR" };
  t.eb.balances["acc-2"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "600.00" } }];
  const r = await t.link();
  assert.equal(r.status, 200);
  const meta = t.g.get(`${t.base}/meta/bank`);
  assert.equal(t.g.list(`${t.base}/a_money_tx`).length, 1, "Giro-Buchung trotzdem da");
  assert.equal(meta.balances["acc-1"].amount, 1234.56);
  assert.equal(meta.lastError.code, "ASPSP_ERROR");
});

test("Neu verbinden mit zusätzlichem Sparkonto: neue uids, Verlauf über identification_hash übernommen", async () => {
  const t = await setup();
  t.eb.sessionAccounts = [GIRO];
  await t.link();
  const h1 = t.g.get(`${t.base}/meta/bank`).balanceHistory["acc-1"];
  assert.ok(h1.length > 2);
  // später: Sparkonto im Control Panel verknüpft und „Mit BAWAG verbinden“ erneut – Bank vergibt neue uids
  t.setNow(NOW + 2 * 86400e3);
  t.eb.sessionAccounts = [{ ...GIRO, uid: "acc-1b" }, { ...SPAR, uid: "acc-2b" }];
  t.eb.balances["acc-1b"] = t.eb.balances["acc-1"];
  t.eb.balances["acc-2b"] = [{ balance_type: "CLBD", balance_amount: { currency: "EUR", amount: "300.00" } }];
  const r = await t.link();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const meta = t.g.get(`${t.base}/meta/bank`);
  assert.deepEqual(meta.accounts.map((a) => a.uid), ["acc-1b", "acc-2b"]);
  assert.equal(meta.mainUid, "acc-1b");
  assert.ok(!("acc-1" in meta.balanceHistory), "alte uid weg");
  const h = meta.balanceHistory["acc-1b"];
  assert.ok(h.length >= h1.length, "Verlauf übernommen");
  assert.equal(h[0].d, h1[0].d);
  assert.equal(meta.balances["acc-2b"].amount, 300);
  const st = await t.req("/bank/status", { method: "GET" });
  assert.deepEqual(st.data.accounts.map((a) => `${a.name} ••${a.iban_last4}`), ["Konto Florian ••3201", "Online Sparen ••8901"]);
});

test("Verlauf-Hilfen: addHistoryPoint, backfillHistory, mainAccountUid, matchAccount", () => {
  let h = [];
  for (let i = 0; i < 130; i++) h = addHistoryPoint(h, `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`, i);
  assert.equal(h.length, HISTORY_POINTS);
  assert.equal(h[h.length - 1].a, 129);
  assert.deepEqual(addHistoryPoint([{ d: "2026-11-02", a: 1 }, { d: "2026-11-01", a: 0 }], "2026-11-02", 5), [{ d: "2026-11-01", a: 0 }, { d: "2026-11-02", a: 5 }]);
  const b = backfillHistory(100, [{ date: "2026-11-03", type: "in", amount: 50 }, { date: "2026-11-02", type: "out", amount: 10 }], "2026-11-01", "2026-11-04");
  assert.deepEqual(b, [{ d: "2026-11-01", a: 60 }, { d: "2026-11-02", a: 50 }, { d: "2026-11-03", a: 100 }, { d: "2026-11-04", a: 100 }]);
  assert.equal(mainAccountUid([{ uid: "s", name: "Sparkonto" }, { uid: "g", name: "Girokonto" }]), "g");
  assert.equal(mainAccountUid([{ uid: "s", name: "Sparkonto" }, { uid: "g", name: "Girokonto" }], "s"), "s");
  assert.equal(mainAccountUid([{ uid: "s", name: "Sparkonto" }]), "s");
  assert.equal(matchAccount({ uid: "x", hash: "h" }, [{ uid: "y", hash: "h" }]).uid, "y");
  assert.equal(matchAccount({ uid: "x", iban_last4: "1234" }, [{ uid: "z", iban_last4: "1234" }]).uid, "z");
  assert.equal(matchAccount({ uid: "x" }, [{ uid: "z" }]), null);
});

test("L3/M6: gleichzeitige finish mit demselben state → nur einer; kaputter state ohne Firestore-Zugriff", async () => {
  const t = await setup();
  await t.req("/bank/start", { body: {} });
  const st = t.eb.lastAuth.state;
  const [a, b] = await Promise.all([
    t.req("/bank/finish", { body: { code: "CODE-1", state: st } }),
    t.req("/bank/finish", { body: { code: "CODE-1", state: st } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  assert.ok(t.g.commits.some((c) => c.writes.some((w) => w.update && /bank_pending$/.test(w.update.name) && w.currentDocument && w.currentDocument.updateTime)), "Vorbedingung updateTime");
  const n0 = t.g.requests.length;
  const bad = await t.req("/bank/finish", { body: { code: "CODE-1", state: "x".repeat(44) }, token: null });
  assert.equal(bad.status, 400);
  assert.equal(t.g.requests.length, n0, "kein Firestore-/Google-Zugriff");
});
