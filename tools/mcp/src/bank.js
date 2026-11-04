// Bankverbindung über Enable Banking (PSD2-Kontoinformationsdienst, „Restricted Mode“: nur die im
// Control Panel verknüpften eigenen Konten). Endpunkte /bank/start|finish|sync|status|unlink + Cron-Abgleich.
// Doku: https://enablebanking.com/docs/api/reference/  ·  FAQ: https://enablebanking.com/docs/faq/
//
// Gespeichert wird:
//   users/{uid}/meta/bank          {linked, session_id, aspsp, valid_until, accounts:[{uid, iban_last4, name, currency, balance}],
//                                   linkedAt, lastSync, lastError, balance, renewTodo, rateLimitedAt}
//   users/{uid}/meta/bank_pending  {stateHash, aspsp, valid_until, exp, used}
//   users/{uid}/meta/bank_seen     {ids:[…]} – schon einmal importierte bk_-IDs (gelöschte nicht neu anlegen)
//   users/{uid}/a_money_tx/bk_…    Buchungen (Form wie js/alltag/money.js + src:"bank", bankRef, counterparty)
// Nie die volle IBAN, nie Schlüssel/Tokens protokollieren.
import { loadAccount, getAccessToken, resolveUid, DEFAULT_PROJECT, DEFAULT_EMAIL, b64url } from "./google.js";
import { Firestore } from "./firestore.js";
import { verifyIdToken, corsHeaders, allowedOrigin } from "./chat.js";
import { suggestCategory, DEFAULT_CATS, round2 } from "./money.js";
import { normTodo, clean } from "./logic.js";
import { dayKey, addDays, isKey, DAY } from "./time.js";

export const EB_BASE = "https://api.enablebanking.com";
export const DEFAULT_REDIRECT = "https://muf2n.github.io/stempelkarte/bank-callback.html";
export const DEFAULT_ASPSP = "BAWAG";
export const MAX_CONSENT_S = 180 * 86400;
export const PENDING_MS = 15 * 60 * 1000;
export const RATE_PAUSE_MS = 6 * 3600 * 1000; // laut FAQ: nach ASPSP_RATE_LIMIT_EXCEEDED ~6 h warten
export const FIRST_DAYS = 90;
export const OVERLAP_DAYS = 3;
const MAX_PAGES = 60;
const MAX_SEEN = 4000;
const MATCH_DAYS = 5;

/* ---------- Fehler ---------- */

export class EbError extends Error {
  constructor(status, code, message) { super(message || code || `Enable Banking ${status}`); this.status = status; this.code = code || ""; }
}
class HttpError extends Error {
  constructor(status, msg, extra = {}) { super(msg); this.status = status; this.extra = extra; }
}

/** Deutsche Fehlermeldung zu einem Enable-Banking-Fehler (kurz, ohne Interna). */
export function ebMessage(e) {
  const c = String((e && e.code) || "");
  if (c === "EXPIRED_SESSION" || c === "SESSION_DOES_NOT_EXIST" || c === "CLOSED_SESSION" || c === "REVOKED_SESSION") return "Die Bankverbindung ist abgelaufen oder wurde beendet – bitte neu mit BAWAG verbinden.";
  if (c === "ASPSP_RATE_LIMIT_EXCEEDED" || (e && e.status === 429)) return "Die Bank erlaubt nur wenige automatische Abrufe pro Tag. Der nächste Versuch kommt in ein paar Stunden von selbst.";
  if (c === "ASPSP_ERROR" || c === "ASPSP_TIMEOUT" || (e && e.status >= 500)) return "Die Bank ist gerade nicht erreichbar. Bitte später nochmal probieren.";
  if (e && e.status === 401) return "Enable Banking hat den Zugang abgelehnt (App-ID oder Schlüssel falsch?).";
  if (e && e.status === 403) return "Enable Banking verweigert den Zugriff – ist das Konto im Control Panel verknüpft?";
  return "Abruf bei der Bank fehlgeschlagen" + (c ? ` (${c})` : e && e.status ? ` (${e.status})` : "") + ".";
}
const isExpired = (e) => e instanceof EbError && (["EXPIRED_SESSION", "SESSION_DOES_NOT_EXIST", "CLOSED_SESSION", "REVOKED_SESSION"].includes(e.code) || (e.status === 401 && /SESSION/.test(e.code)));
const isRate = (e) => e instanceof EbError && (e.code === "ASPSP_RATE_LIMIT_EXCEEDED" || e.status === 429);

/* ---------- Schlüssel & JWT ---------- */

function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function derLen(n) {
  if (n < 0x80) return [n];
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return [0x80 | b.length, ...b];
}
function der(tag, body) { return new Uint8Array([tag, ...derLen(body.length), ...body]); }
const concat = (...a) => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

/** PKCS#1 (RSAPrivateKey) in PKCS#8 (PrivateKeyInfo) einpacken – WebCrypto kann nur PKCS#8 importieren. */
export function pkcs1ToPkcs8(pkcs1) {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algId = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]); // rsaEncryption, NULL
  return der(0x30, concat(version, algId, der(0x04, pkcs1)));
}

/**
 * PEM aus dem Secret lesen (tolerant: „\n“ als Text, CRLF, fehlende Umbrüche, Anführungszeichen).
 * → {der: Uint8Array (PKCS#8), format: "pkcs8"|"pkcs1"}
 */
export function parsePrivateKey(raw) {
  let t = String(raw || "").replace(/\\n/g, "\n").replace(/\r/g, "").replace(/[‐-―−]/g, "-").trim().replace(/^["']|["']$/g, "");
  if (!t) throw new HttpError(503, "Die Bankverbindung ist noch nicht eingerichtet (ENABLEBANKING_KEY fehlt).");
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(t);
  const kind = m ? m[1] : "";
  const body = (m ? m[2] : t).replace(/[^A-Za-z0-9+/=]/g, "");
  if (kind === "ENCRYPTED PRIVATE KEY") throw new HttpError(503, "ENABLEBANKING_KEY ist verschlüsselt – bitte den unverschlüsselten .pem-Schlüssel eintragen.");
  let bytes;
  try { bytes = b64ToBytes(body); } catch { throw new HttpError(503, "ENABLEBANKING_KEY ist kein gültiger PEM-Schlüssel."); }
  if (kind === "RSA PRIVATE KEY") return { der: pkcs1ToPkcs8(bytes), format: "pkcs1" };
  return { der: bytes, format: "pkcs8" };
}

const keyCache = new Map();
async function importEbKey(raw) {
  const k = String(raw || "");
  const ck = k.length + "|" + k.slice(-40);
  if (keyCache.has(ck)) return keyCache.get(ck);
  const { der: d, format } = parsePrivateKey(k);
  let key;
  try {
    key = await crypto.subtle.importKey("pkcs8", d, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    if (format === "pkcs8") {
      // Vielleicht doch PKCS#1 ohne passende Kopfzeile
      try { key = await crypto.subtle.importKey("pkcs8", pkcs1ToPkcs8(d), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); } catch { /* unten */ }
    }
    if (!key) throw new HttpError(503, "ENABLEBANKING_KEY ist kein gültiger RSA-Schlüssel.");
  }
  keyCache.set(ck, key);
  return key;
}
export function clearBankCaches() { keyCache.clear(); }

/** JWT für Enable Banking: RS256, kid = Application-ID, iss/aud fest, Laufzeit 1 h (≤ 24 h erlaubt). */
export async function ebJwt(env, now) {
  const appId = String(env.ENABLEBANKING_APP_ID || "").trim();
  if (!appId) throw new HttpError(503, "Die Bankverbindung ist noch nicht eingerichtet (ENABLEBANKING_APP_ID fehlt).");
  const key = await importEbKey(env.ENABLEBANKING_KEY);
  const iat = Math.floor(now / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: appId };
  const claims = { iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

/* ---------- Enable-Banking-Client ---------- */

export class EnableBanking {
  constructor({ env, fetchImpl, now, psu = null }) {
    this.env = env;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.now = now;
    this.psu = psu; // PSU-Header nur bei Abrufen, die der Nutzer selbst auslöst (FAQ: Hintergrund ohne PSU-Header)
    this.base = String(env.ENABLEBANKING_BASE || EB_BASE).replace(/\/+$/, "");
    this.jwt = null;
  }

  async req(method, path, body, { psu = false } = {}) {
    this.jwt ||= await ebJwt(this.env, this.now);
    const headers = { authorization: `Bearer ${this.jwt}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (psu && this.psu) Object.assign(headers, this.psu);
    let res;
    try {
      res = await this.fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new EbError(0, "NETWORK", "Enable Banking nicht erreichbar");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      // UNSICHER: Form der ErrorResponse nur aus Beispielen/FAQ abgeleitet ({code, message, error, detail});
      // der Fehlercode (z. B. ASPSP_RATE_LIMIT_EXCEEDED) steht bei Enable Banking in „error“.
      const code = data && typeof data === "object" ? String(data.error || (typeof data.code === "string" ? data.code : "") || "") : "";
      throw new EbError(res.status, code, (data && data.message) || `Enable Banking ${res.status}`);
    }
    return data || {};
  }

  aspsps(country = "AT") { return this.req("GET", `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`); }
  auth(body) { return this.req("POST", "/auth", body); }
  session(code) { return this.req("POST", "/sessions", { code }); }
  deleteSession(id) { return this.req("DELETE", `/sessions/${encodeURIComponent(id)}`); }
  balances(uid) { return this.req("GET", `/accounts/${encodeURIComponent(uid)}/balances`, undefined, { psu: true }); }
  transactions(uid, q) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q || {})) if (v) p.set(k, v);
    return this.req("GET", `/accounts/${encodeURIComponent(uid)}/transactions?${p}`, undefined, { psu: true });
  }

  /** Alle Buchungen ab dateFrom (continuation_key folgen, auch bei leeren Seiten laut FAQ). */
  async allTransactions(uid, dateFrom) {
    const out = [];
    let key = "";
    const seenKeys = new Set();
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await this.transactions(uid, { date_from: dateFrom, continuation_key: key });
      for (const t of page.transactions || []) out.push(t);
      key = page.continuation_key || "";
      if (!key || seenKeys.has(key)) break;
      seenKeys.add(key);
    }
    return out;
  }
}

/* ---------- reine Hilfen (Buchungen) ---------- */

export async function sha256Hex(s) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s)));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v) => (v == null ? "" : String(v)).trim();
const oneLine = (s) => str(s).replace(/\s+/g, " ");

export function txText(t) {
  const ri = Array.isArray(t.remittance_information) ? t.remittance_information : t.remittance_information ? [t.remittance_information] : [];
  return oneLine(ri.join(" "));
}

/** Gegenpartei: bei Ausgaben der Empfänger (creditor), bei Eingängen der Zahler (debtor). */
export function counterpartyOf(t) {
  const out = t.credit_debit_indicator !== "CRDT";
  const a = out ? t.creditor : t.debtor;
  return oneLine(a && a.name);
}

export function ibanLast4(acc) {
  const iban = str(acc && acc.account_id && acc.account_id.iban) || str(acc && acc.all_account_ids && acc.all_account_ids[0] && acc.all_account_ids[0].identification);
  const clean = iban.replace(/\s+/g, "");
  return clean.length >= 4 ? clean.slice(-4) : "";
}

/** Rohbuchung → Felder oder null (nicht gebucht / unbrauchbar). */
export async function normalizeTx(t, accKey) {
  if (!t || (t.status && t.status !== "BOOK")) return null;
  const amtRaw = t.transaction_amount && t.transaction_amount.amount;
  let amount = Number(String(amtRaw ?? "").replace(",", "."));
  if (!Number.isFinite(amount) || amount === 0) return null;
  let type = t.credit_debit_indicator === "CRDT" ? "in" : t.credit_debit_indicator === "DBIT" ? "out" : amount < 0 ? "out" : "in";
  amount = round2(Math.abs(amount));
  const date = [t.booking_date, t.value_date, t.transaction_date].find(isKey);
  if (!date) return null;
  const text = txText(t);
  const counterparty = counterpartyOf(t);
  const ref = str(t.entry_reference) || str(t.transaction_id);
  const key = ref ? `${accKey}|${ref}` : `${accKey}|${date}|${type}|${amount.toFixed(2)}|${counterparty}|${text}`;
  const id = "bk_" + (await sha256Hex(key)).slice(0, 24);
  const note = (counterparty || text || (type === "in" ? "Gutschrift" : "Abbuchung")).slice(0, 80);
  return { id, date, amount, type, note, counterparty, text: text.slice(0, 300), bankRef: ref || null, currency: str(t.transaction_amount && t.transaction_amount.currency) || "EUR" };
}

/** Kategorien (Standard + eigene money_cats) → Map id → {type}. */
export function catPool(userCats) {
  const map = new Map(DEFAULT_CATS.map((c) => [c.id, c]));
  for (const c of userCats || []) {
    if (!c || !c.id) continue;
    if (c.deleted) { map.delete(c.id); continue; }
    map.set(c.id, { ...map.get(c.id), ...c });
  }
  return map;
}

export function categorize(n, rules, pool) {
  const ids = new Set([...pool.values()].filter((c) => (c.type === "in" ? "in" : "out") === n.type).map((c) => c.id));
  const s = suggestCategory(`${n.counterparty} ${n.text}`, rules, ids);
  if (s) return s.cat;
  return n.type === "in" ? (pool.has("sonstein") ? "sonstein" : "sonstiges") : "sonstiges";
}

/** Hat der Nutzer das Dokument geändert? (db.js setzt bei jedem Speichern updated = Date.now()) */
export const userEdited = (doc) => !!doc && doc.bankSync != null && Number(doc.updated) !== Number(doc.bankSync);

const daysDiff = (a, b) => Math.round((Date.UTC(...a.split("-").map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...b.split("-").map((x, i) => (i === 1 ? x - 1 : +x)))) / DAY);

/** Balance auswählen (verfügbar vor gebucht). */
export function pickBalance(list) {
  const order = ["ITAV", "CLAV", "XPCD", "ITBD", "CLBD", "OPAV", "OTHR", "PRCD", "INFO"];
  const arr = (list || []).filter((b) => b && b.balance_amount && Number.isFinite(Number(b.balance_amount.amount)));
  arr.sort((a, b) => {
    const ia = order.indexOf(a.balance_type), ib = order.indexOf(b.balance_type);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const b = arr[0];
  if (!b) return null;
  return { amount: round2(Number(b.balance_amount.amount)), currency: b.balance_amount.currency || "EUR", type: b.balance_type || "", date: b.reference_date || null };
}

export function daysLeft(validUntil, now) {
  const t = Date.parse(validUntil || "");
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now) / DAY);
}

/* ---------- Kontext (Firestore + UID) ---------- */

function makeFs(env, fetchImpl, now) {
  let acc;
  try { acc = loadAccount(env.FIREBASE_SERVICE_ACCOUNT); } catch { throw new HttpError(503, "Der Server ist noch nicht eingerichtet (Dienstkonto fehlt)."); }
  const projectId = String(env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
  const getToken = () => getAccessToken(acc, fetchImpl, now);
  return { fs: new Firestore({ projectId, getToken, fetchImpl }), projectId, getToken };
}

class Bank {
  constructor({ env, fetchImpl, now, fs, uid, psu = null }) {
    this.env = env; this.fetch = fetchImpl; this.now = now; this.fs = fs; this.uid = uid;
    this.eb = new EnableBanking({ env, fetchImpl, now, psu });
  }
  p(sub) { return `users/${this.uid}/${sub}`; }
  async meta() { const d = await this.fs.get(this.p("meta/bank")); return d ? d.data : null; }
  async patchMeta(partial) { await this.fs.commit([this.fs.patchWrite(this.p("meta/bank"), clean(partial))]); }

  async findAspsp(wanted) {
    const res = await this.eb.aspsps("AT");
    const list = Array.isArray(res.aspsps) ? res.aspsps : [];
    const w = str(wanted || DEFAULT_ASPSP).toLowerCase();
    const hit = list.find((a) => str(a.name).toLowerCase() === w) ||
      list.find((a) => str(a.name).toLowerCase().startsWith(w) && !/easybank/i.test(a.name)) ||
      list.find((a) => str(a.name).toLowerCase().includes(w));
    if (!hit) {
      throw new HttpError(404, `„${wanted || DEFAULT_ASPSP}“ wurde bei Enable Banking (Österreich) nicht gefunden.`, { aspsps: list.map((a) => a.name).slice(0, 80) });
    }
    return hit;
  }

  async start(body) {
    const aspsp = await this.findAspsp(body && body.aspsp);
    const maxS = Math.min(MAX_CONSENT_S, Number(aspsp.maximum_consent_validity) > 0 ? Number(aspsp.maximum_consent_validity) : MAX_CONSENT_S);
    const validUntil = new Date(this.now + (maxS - 600) * 1000).toISOString();
    const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const redirect = str(this.env.BANK_REDIRECT_URL) || DEFAULT_REDIRECT;
    await this.fs.commit([this.fs.setWrite(this.p("meta/bank_pending"), {
      stateHash: await sha256Hex(state), aspsp: { name: aspsp.name, country: aspsp.country || "AT" },
      valid_until: validUntil, exp: this.now + PENDING_MS, created: this.now, used: false,
    })]);
    const res = await this.eb.auth({
      access: { valid_until: validUntil },
      aspsp: { name: aspsp.name, country: aspsp.country || "AT" },
      state, redirect_url: redirect, psu_type: "personal", language: "de",
    });
    if (!res.url) throw new EbError(502, "NO_URL", "Keine Anmelde-Adresse erhalten");
    return { url: res.url, aspsp: aspsp.name, valid_until: validUntil };
  }

  async finish({ code, state }) {
    if (!str(code) || !str(state)) throw new HttpError(400, "code und state fehlen.");
    const pd = await this.fs.get(this.p("meta/bank_pending"));
    const pend = pd && pd.data;
    if (!pend || pend.used) throw new HttpError(400, "Kein offener Verbindungsversuch – bitte in der App neu starten.");
    if (!(Number(pend.exp) > this.now)) throw new HttpError(400, "Der Verbindungsversuch ist abgelaufen (15 Minuten) – bitte neu starten.");
    if (!(await safeEqualHex(await sha256Hex(state), pend.stateHash))) throw new HttpError(400, "Ungültiger Rückruf (state passt nicht) – bitte neu starten.");
    await this.fs.commit([this.fs.patchWrite(this.p("meta/bank_pending"), { used: true })]);
    const s = await this.eb.session(str(code));
    const accounts = (s.accounts || []).filter((a) => a && a.uid).map((a) => ({
      uid: a.uid, iban_last4: ibanLast4(a), name: str(a.name || a.product || "Konto").slice(0, 60), currency: str(a.currency) || "EUR",
    }));
    const old = await this.meta();
    if (old && old.session_id && old.session_id !== s.session_id) {
      try { await this.eb.deleteSession(old.session_id); } catch { /* alte Sitzung egal */ }
    }
    const validUntil = (s.access && s.access.valid_until) || pend.valid_until;
    const meta = {
      linked: true, session_id: s.session_id, aspsp: (s.aspsp && s.aspsp.name) || pend.aspsp.name,
      valid_until: validUntil, accounts, linkedAt: this.now, lastSync: null, lastError: null,
      balance: null, rateLimitedAt: null, expired: false, renewTodo: (old && old.renewTodo) || null,
    };
    await this.fs.commit([this.fs.setWrite(this.p("meta/bank"), clean(meta))]);
    if (!accounts.length) {
      await this.patchMeta({ lastError: { code: "NO_ACCOUNTS", msg: "Die Bank hat kein Konto freigegeben. Im Restricted Mode liefert Enable Banking nur Konten, die im Control Panel mit der App verknüpft sind.", at: this.now } });
      return { ok: true, warn: "Kein Konto freigegeben – ist das BAWAG-Konto im Enable-Banking-Control-Panel verknüpft?", status: await this.status() };
    }
    const r = await this.sync({ days: FIRST_DAYS });
    return { ok: true, ...r, status: await this.status() };
  }

  /** Abgleich. days → feste Tage zurück (Erstabgleich), sonst ab lastSync − 3 Tage. */
  async sync({ days = null, cron = false } = {}) {
    const meta = await this.meta();
    if (!meta || !meta.linked || !meta.session_id) return { skipped: "not_linked" };
    if (cron && meta.expired) return { skipped: "expired" };
    if (cron && meta.rateLimitedAt && this.now - Number(meta.rateLimitedAt) < RATE_PAUSE_MS) return { skipped: "rate_limited" };
    const today = dayKey(this.now);
    let from;
    if (days) from = addDays(today, -days);
    else if (meta.lastSync) from = addDays(dayKey(Number(meta.lastSync)), -OVERLAP_DAYS);
    else from = addDays(today, -FIRST_DAYS);

    const raw = [];
    const accounts = (meta.accounts || []).map((a) => ({ ...a }));
    let err = null;
    try {
      for (const a of accounts) {
        const accKey = a.iban_last4 || a.name || "konto";
        const list = await this.eb.allTransactions(a.uid, from);
        for (const t of list) raw.push({ t, accKey, acc: a });
        try {
          const b = await this.eb.balances(a.uid);
          const bal = pickBalance(b.balances);
          if (bal) a.balance = { ...bal, at: this.now };
        } catch (e) { if (isExpired(e) || isRate(e)) throw e; /* Saldo optional */ }
      }
    } catch (e) {
      err = e;
    }

    if (err && !raw.length) {
      const partial = { lastError: { code: (err instanceof EbError && err.code) || "ERROR", msg: ebMessage(err), at: this.now } };
      if (isExpired(err)) partial.expired = true;
      if (isRate(err)) partial.rateLimitedAt = this.now;
      await this.patchMeta(partial);
      await this.renewalTodo({ ...meta, ...partial });
      if (!(err instanceof EbError)) throw err;
      return { error: partial.lastError, imported: 0 };
    }

    const res = await this.upsert(raw, from);
    const eurBal = accounts.filter((a) => a.balance && a.balance.currency === "EUR");
    const balance = eurBal.length ? { amount: round2(eurBal.reduce((s, a) => s + a.balance.amount, 0)), currency: "EUR", at: this.now } : meta.balance || null;
    const partial = {
      accounts, balance, lastSync: err ? meta.lastSync || null : this.now,
      lastError: err ? { code: (err instanceof EbError && err.code) || "ERROR", msg: ebMessage(err), at: this.now } : null,
      lastImport: { at: this.now, ...res }, expired: err ? isExpired(err) : false,
      ...(err && isRate(err) ? { rateLimitedAt: this.now } : { rateLimitedAt: null }),
    };
    await this.patchMeta(partial);
    await this.renewalTodo({ ...meta, ...partial });
    return { imported: res.created, updated: res.updated, linked: res.linked, skipped: res.skipped, ...(err ? { error: partial.lastError } : {}) };
  }

  async upsert(raw, from) {
    const [txDocs, rulesDocs, catDocs, seenDoc] = await Promise.all([
      this.fs.runQuery(`users/${this.uid}`, {
        from: [{ collectionId: "a_money_tx" }],
        where: { fieldFilter: { field: { fieldPath: "date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: addDays(from, -MATCH_DAYS - 2) } } },
      }),
      this.fs.list(this.p("a_money_rules")).catch(() => []),
      this.fs.list(this.p("a_money_cats")).catch(() => []),
      this.fs.get(this.p("meta/bank_seen")),
    ]);
    const existing = new Map(txDocs.map((d) => [d.id, { ...d.data, id: d.id }]));
    const rules = rulesDocs.map((d) => d.data);
    const pool = catPool(catDocs.map((d) => ({ ...d.data, id: d.id })));
    const seen = new Set((seenDoc && Array.isArray(seenDoc.data.ids) ? seenDoc.data.ids : []));
    const seenBefore = new Set(seen);
    // Kandidaten zum Zusammenführen: von Hand/aus Abo gebuchte Einträge ohne Bankbezug
    const manual = [...existing.values()].filter((t) => t.src !== "bank" && !t.bankId && !String(t.id).startsWith("bk_"));
    const usedManual = new Set();

    const writes = [];
    let created = 0, updated = 0, linked = 0, skipped = 0;
    const done = new Set();
    for (const { t, accKey } of raw) {
      const n = await normalizeTx(t, accKey);
      if (!n || done.has(n.id)) continue;
      done.add(n.id);
      const cur = existing.get(n.id);
      if (!cur) {
        if (seenBefore.has(n.id)) { skipped++; continue; } // schon einmal importiert und vom Nutzer gelöscht/zusammengeführt
        const m = manual.find((x) => !usedManual.has(x.id) && x.type === n.type && Math.abs((Number(x.amount) || 0) - n.amount) < 0.005 && isKey(x.date) && Math.abs(daysDiff(n.date, x.date)) <= MATCH_DAYS);
        seen.add(n.id);
        if (m) {
          usedManual.add(m.id);
          writes.push(this.fs.patchWrite(this.p(`a_money_tx/${m.id}`), { bankId: n.id, bankRef: n.bankRef, counterparty: n.counterparty }, { exists: true }));
          linked++;
          continue;
        }
        const category = categorize(n, rules, pool);
        writes.push(this.fs.setWrite(this.p(`a_money_tx/${n.id}`), clean({
          id: n.id, date: n.date, amount: n.amount, type: n.type, category, note: n.note,
          src: "bank", bankRef: n.bankRef, counterparty: n.counterparty, bankText: n.text,
          ...(n.currency !== "EUR" ? { currency: n.currency } : {}),
          created: this.now, updated: this.now, bankSync: this.now,
        })));
        created++;
        continue;
      }
      seen.add(n.id);
      if (cur.src !== "bank" || userEdited(cur)) { skipped++; continue; } // nie überschreiben, was der Nutzer geändert hat
      const category = categorize(n, rules, pool);
      const want = { date: n.date, amount: n.amount, type: n.type, category, note: n.note, counterparty: n.counterparty, bankText: n.text, bankRef: n.bankRef };
      const changed = Object.keys(want).some((k) => (cur[k] ?? null) !== (want[k] ?? null));
      if (!changed) continue;
      writes.push(this.fs.patchWrite(this.p(`a_money_tx/${n.id}`), clean({ ...want, updated: this.now, bankSync: this.now })));
      updated++;
    }
    if (seen.size !== seenBefore.size) {
      const ids = [...seen].slice(-MAX_SEEN);
      writes.push(this.fs.setWrite(this.p("meta/bank_seen"), { ids, updated: this.now }));
    }
    for (let i = 0; i < writes.length; i += 200) await this.fs.commit(writes.slice(i, i + 200));
    return { created, updated, linked, skipped };
  }

  /** Aufgabe „Bankverbindung erneuern“ einmal pro Zustimmung, wenn < 7 Tage übrig (oder abgelaufen). */
  async renewalTodo(meta) {
    if (!meta || !meta.linked || !meta.valid_until) return false;
    const left = daysLeft(meta.valid_until, this.now);
    if (!(left != null && left < 7) && !meta.expired) return false;
    const id = "bank_renew_" + String(meta.valid_until).slice(0, 10);
    if (meta.renewTodo === id) return false;
    const until = isKey(String(meta.valid_until).slice(0, 10)) ? String(meta.valid_until).slice(0, 10).split("-").reverse().join(".") : "";
    const full = normTodo({
      title: "Bankverbindung erneuern", kind: "todo", date: dayKey(this.now), time: null, remind: false, remindMin: 30,
      done: false, doneAt: null, createdAt: this.now, src: "bank",
      note: `${meta.expired ? "Die Verbindung zu BAWAG ist abgelaufen" : `Die Verbindung zu BAWAG läuft am ${until} ab`}. In der App: Alltag › Geld › Übersicht › Bankkonto → „Mit BAWAG verbinden“ (Login auf der BAWAG-Seite).`,
    }, id, this.now);
    const { id: _i, ...data } = full;
    await this.fs.commit([
      this.fs.setWrite(this.p(`todos/${id}`), clean(data)),
      this.fs.patchWrite(this.p("meta/bank"), { renewTodo: id }),
    ]);
    return true;
  }

  async status() {
    const m = await this.meta();
    if (!m || !m.linked) return { linked: false, lastError: (m && m.lastError) || null };
    return {
      linked: true, aspsp: m.aspsp || DEFAULT_ASPSP, valid_until: m.valid_until || null,
      daysLeft: daysLeft(m.valid_until, this.now), expired: !!m.expired || (daysLeft(m.valid_until, this.now) ?? 1) < 0,
      accounts: (m.accounts || []).map((a) => ({ iban_last4: a.iban_last4 || "", name: a.name || "", currency: a.currency || "EUR", balance: a.balance || null })),
      lastSync: m.lastSync || null, balance: m.balance || null, lastError: m.lastError || null, linkedAt: m.linkedAt || null,
      lastImport: m.lastImport || null,
    };
  }

  async unlink() {
    const m = await this.meta();
    if (m && m.session_id) {
      try { await this.eb.deleteSession(m.session_id); } catch { /* trotzdem lokal trennen */ }
    }
    await this.fs.commit([this.fs.setWrite(this.p("meta/bank"), { linked: false, unlinkedAt: this.now, renewTodo: (m && m.renewTodo) || null })]);
    return { ok: true, linked: false };
  }
}

async function safeEqualHex(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/* ---------- HTTP ---------- */

function bankCors(origin) {
  const h = corsHeaders(origin);
  if (h["access-control-allow-origin"]) h["access-control-allow-methods"] = "GET, POST, OPTIONS";
  return h;
}

export async function handleBank(request, env, { fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const origin = request.headers.get("origin");
  const cors = bankCors(origin);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });
  if (request.method === "OPTIONS") return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: cors });
  if (origin && !allowedOrigin(origin)) return json(403, { error: "Herkunft nicht erlaubt." });
  const route = path.slice("/bank/".length);
  const methods = { start: "POST", finish: "POST", sync: "POST", status: "GET", unlink: "POST" };
  if (!methods[route]) return json(404, { error: "Nicht gefunden." });
  if (request.method !== methods[route]) return json(405, { error: `Nur ${methods[route]} ist erlaubt.` });

  try {
    const { fs, projectId, getToken } = makeFs(env, fetchImpl, now);
    let body = {};
    if (request.method === "POST") {
      const t = await request.text();
      if (t.length > 20000) return json(413, { error: "Anfrage zu groß." });
      try { body = t ? JSON.parse(t) : {}; } catch { return json(400, { error: "JSON konnte nicht gelesen werden." }); }
      if (!body || typeof body !== "object") body = {};
    }
    const m = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") || "").trim());
    let uid = null;
    if (m) {
      try {
        uid = (await verifyIdToken(m[1].trim(), { projectId, email: env.STEMPEL_EMAIL || DEFAULT_EMAIL, fetchImpl, now })).uid;
      } catch {
        return json(401, { error: "Anmeldung ungültig oder abgelaufen – bitte neu laden." });
      }
    } else if (route === "finish") {
      // Rückruf ohne Anmeldung (z. B. im Handy-Browser außerhalb der App): Der zufällige state aus
      // /bank/start ist hier der Nachweis. Die App hat genau einen Nutzer → UID wie beim MCP-Server.
      // UNSICHER: bewusste Lockerung für den Custom-Tab-Fall der Android-App.
      try { uid = await resolveUid({ env, projectId, getToken, fetchImpl, fs }); } catch { return json(401, { error: "Bitte anmelden." }); }
    } else {
      return json(401, { error: "Bitte anmelden." });
    }
    const psu = route === "sync" || route === "finish" ? psuHeaders(request) : null;
    const bank = new Bank({ env, fetchImpl, now, fs, uid, psu });
    if (route !== "status" && route !== "unlink") await ebJwt(env, now); // Einrichtung früh prüfen
    let out;
    if (route === "start") out = await bank.start(body);
    else if (route === "finish") out = await bank.finish(body);
    else if (route === "sync") { const r = await bank.sync({}); out = { ...r, status: await bank.status() }; }
    else if (route === "status") out = await bank.status();
    else out = await bank.unlink();
    return json(200, out);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, ...e.extra });
    if (e instanceof EbError) return json(e.status === 429 ? 429 : 502, { error: ebMessage(e), code: e.code || null });
    return json(500, { error: "Interner Fehler – bitte später nochmal versuchen." });
  }
}

/** PSU-Header (nur bei Abrufen, die der Nutzer gerade selbst auslöst). */
function psuHeaders(request) {
  const h = {};
  const ip = request.headers.get("cf-connecting-ip");
  const ua = request.headers.get("user-agent");
  if (ip) h["psu-ip-address"] = ip;
  if (ua) h["psu-user-agent"] = ua.slice(0, 300);
  return Object.keys(h).length ? h : null;
}

/* ---------- Cron ---------- */

/** Geplanter Abgleich (wrangler.toml [triggers]). Einziger Nutzer per resolveUid. */
export async function runBankCron(env, { fetchImpl = (...a) => fetch(...a), now = Date.now() } = {}) {
  if (!String(env.ENABLEBANKING_APP_ID || "").trim() || !String(env.ENABLEBANKING_KEY || "").trim()) return { skipped: "not_configured" };
  const { fs, projectId, getToken } = makeFs(env, fetchImpl, now);
  const uid = await resolveUid({ env, projectId, getToken, fetchImpl, fs });
  const bank = new Bank({ env, fetchImpl, now, fs, uid, psu: null });
  try {
    return await bank.sync({ cron: true });
  } catch (e) {
    try { await bank.patchMeta({ lastError: { code: "ERROR", msg: e instanceof HttpError ? e.message : "Automatischer Abgleich fehlgeschlagen.", at: now } }); } catch { /* egal */ }
    return { error: e instanceof HttpError ? e.message : "Fehler" };
  }
}

export { Bank };
