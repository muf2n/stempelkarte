// Test-Hilfen: In-Memory-Firestore-Emulation (REST v1), Google-Token-/Identity-Toolkit-Attrappen,
// lokal erzeugter RSA-Schlüssel, Aufruf des Worker-fetch-Handlers.
import { encodeFields, decodeFields } from "../src/firestore.js";
import { handle } from "../src/worker.js";
import { clearCaches } from "../src/google.js";
import { viennaToTs } from "../src/time.js";

export const PROJECT = "stempelkarte-40682";
export const UID = "uid_florian_123";
export const EMAIL = "lippa.florian@gmail.com";
export const TOKEN = "test-token-0123456789abcdef0123456789abcdef";

function b64(buf) { return Buffer.from(buf).toString("base64"); }

/** RSA-Schlüsselpaar + Dienstkonto-JSON (PKCS#8 PEM) für Tests. */
export async function makeAccount() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const pk = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64(pk).match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
  const account = {
    type: "service_account", project_id: PROJECT, private_key_id: "kid123", private_key: pem,
    client_email: "firebase-adminsdk-test@stempelkarte-40682.iam.gserviceaccount.com", client_id: "1",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  return { account, publicKey: kp.publicKey, json: JSON.stringify(account) };
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Firestore-Emulation + Google-Endpunkte als fetch-Ersatz. */
export class FakeGoogle {
  constructor({ publicKey, uid = UID, email = EMAIL, lookupStatus = 200 }) {
    this.publicKey = publicKey;
    this.uid = uid;
    this.email = email;
    this.lookupStatus = lookupStatus;
    this.docs = new Map(); // relPath → {fields, createTime, updateTime}
    this.clock = 0;
    this.tokens = new Set();
    this.tokenCalls = 0;
    this.lookupCalls = 0;
    this.txs = new Map();
    this.commits = [];
    this.requests = [];
    this.failNextCommitWithAbort = 0;
    this.fetch = this.fetch.bind(this);
  }

  stamp() { this.clock++; return new Date(Date.UTC(2026, 0, 1) + this.clock).toISOString().replace("Z", "000Z"); }
  root() { return `projects/${PROJECT}/databases/(default)/documents`; }

  set(path, obj) {
    const t = this.stamp();
    const prev = this.docs.get(path);
    this.docs.set(path, { fields: encodeFields(obj), createTime: prev ? prev.createTime : t, updateTime: t });
  }
  get(path) { const d = this.docs.get(path); return d ? decodeFields(d.fields) : null; }
  list(coll) {
    const out = [];
    for (const [p, d] of this.docs) {
      const parent = p.slice(0, p.lastIndexOf("/"));
      if (parent === coll) out.push({ id: p.split("/").pop(), ...decodeFields(d.fields) });
    }
    return out;
  }
  raw(path) { return this.docs.get(path); }

  docJson(path) {
    const d = this.docs.get(path);
    return { name: `${this.root()}/${path}`, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime };
  }

  async fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const body = init.body;
    this.requests.push({ method, url: url.toString() });
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

    if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
      this.tokenCalls++;
      const p = new URLSearchParams(body);
      if (p.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer") return reply(400, { error: "unsupported_grant_type" });
      const [h, c, sig] = String(p.get("assertion")).split(".");
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", this.publicKey, b64urlDecode(sig), new TextEncoder().encode(`${h}.${c}`));
      if (!ok) return reply(400, { error: "invalid_grant" });
      const claims = JSON.parse(b64urlDecode(c).toString());
      if (claims.aud !== "https://oauth2.googleapis.com/token" || !/datastore/.test(claims.scope)) return reply(400, { error: "invalid_scope" });
      const tok = "ya29.fake-" + this.tokenCalls;
      this.tokens.add(tok);
      return reply(200, { access_token: tok, expires_in: 3599, token_type: "Bearer" });
    }

    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || "";
    const bearer = auth.replace(/^Bearer\s+/i, "");
    if (!this.tokens.has(bearer)) return reply(401, { error: { code: 401, status: "UNAUTHENTICATED", message: "no" } });

    if (url.origin === "https://identitytoolkit.googleapis.com") {
      this.lookupCalls++;
      if (this.lookupStatus !== 200) return reply(this.lookupStatus, { error: { status: "PERMISSION_DENIED" } });
      const req = JSON.parse(body);
      const users = (req.email || []).includes(this.email) ? [{ localId: this.uid, email: this.email }] : [];
      return reply(200, users.length ? { kind: "x", users } : { kind: "x" });
    }

    if (url.origin !== "https://firestore.googleapis.com") return reply(404, { error: { status: "NOT_FOUND" } });
    const prefix = `/v1/${this.root()}`;
    let rel = decodeURIComponent(url.pathname).slice(prefix.length).replace(/^\//, "");
    let op = null;
    const ci = rel.lastIndexOf(":");
    if (ci >= 0 && !rel.slice(ci).includes("/")) { op = rel.slice(ci + 1); rel = rel.slice(0, ci); }

    if (method === "GET") {
      const segs = rel.split("/").filter(Boolean);
      const tx = url.searchParams.get("transaction");
      if (segs.length % 2 === 0) {
        const d = this.docs.get(rel);
        if (tx) { const t = this.txs.get(tx); if (!t) return reply(400, { error: { status: "INVALID_ARGUMENT" } }); t.reads.set(rel, d ? d.updateTime : null); }
        if (!d) return reply(404, { error: { code: 404, status: "NOT_FOUND", message: "Document not found" } });
        return reply(200, this.docJson(rel));
      }
      // Sammlung auflisten
      const showMissing = url.searchParams.get("showMissing") === "true";
      const mask = url.searchParams.getAll("mask.fieldPaths");
      const names = new Set();
      for (const p of this.docs.keys()) {
        if (p.startsWith(rel + "/")) {
          const rest = p.slice(rel.length + 1).split("/");
          if (rest.length === 1 || showMissing) names.add(rest[0]);
        }
      }
      const sorted = [...names].sort();
      const size = Number(url.searchParams.get("pageSize")) || 100;
      const off = Number(url.searchParams.get("pageToken") || 0);
      const page = sorted.slice(off, off + size);
      const documents = page.map((id) => {
        const path = `${rel}/${id}`;
        if (!this.docs.has(path)) return { name: `${this.root()}/${path}` };
        const j = this.docJson(path);
        if (mask.length) { const f = {}; for (const k of mask) if (j.fields[k]) f[k] = j.fields[k]; j.fields = f; }
        return j;
      });
      const res = {};
      if (documents.length) res.documents = documents;
      if (off + size < sorted.length) res.nextPageToken = String(off + size);
      return reply(200, res);
    }

    const req = body ? JSON.parse(body) : {};
    if (op === "beginTransaction") {
      const id = Buffer.from("tx" + (this.txs.size + 1) + "+/=").toString("base64");
      this.txs.set(id, { reads: new Map(), done: false });
      return reply(200, { transaction: id });
    }
    if (op === "rollback") { const t = this.txs.get(req.transaction); if (t) t.done = true; return reply(200, {}); }
    if (op === "runQuery") return reply(200, this.runQuery(rel, req.structuredQuery));
    if (op === "commit") return this.commit(req, reply);
    return reply(400, { error: { status: "INVALID_ARGUMENT", message: "op " + op } });
  }

  runQuery(parent, q) {
    const coll = q.from[0].collectionId;
    const base = `${parent}/${coll}`;
    let rows = [];
    for (const [p] of this.docs) if (p.slice(0, p.lastIndexOf("/")) === base) rows.push(p);
    const val = (v) => ("integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "stringValue" in v ? v.stringValue : "booleanValue" in v ? v.booleanValue : null);
    const test = (f, fields) => {
      if (f.compositeFilter) return f.compositeFilter.filters.every((x) => test(x, fields));
      const ff = f.fieldFilter;
      const fv = fields[ff.field.fieldPath];
      if (!fv) return false;
      const a = val(fv), b = val(ff.value);
      if (typeof a !== typeof b) return false;
      switch (ff.op) {
        case "GREATER_THAN_OR_EQUAL": return a >= b;
        case "GREATER_THAN": return a > b;
        case "LESS_THAN": return a < b;
        case "LESS_THAN_OR_EQUAL": return a <= b;
        case "EQUAL": return a === b;
        default: throw new Error("op " + ff.op);
      }
    };
    if (q.where) rows = rows.filter((p) => test(q.where, this.docs.get(p).fields));
    if (q.orderBy) {
      const f = q.orderBy[0].field.fieldPath;
      rows.sort((x, y) => val(this.docs.get(x).fields[f]) - val(this.docs.get(y).fields[f]));
    }
    const readTime = new Date().toISOString();
    if (!rows.length) return [{ readTime }];
    return rows.map((p) => ({ document: this.docJson(p), readTime }));
  }

  commit(req, reply) {
    if (this.failNextCommitWithAbort > 0) {
      this.failNextCommitWithAbort--;
      return reply(409, { error: { code: 409, status: "ABORTED", message: "Transaction lock timeout" } });
    }
    if (req.transaction) {
      const t = this.txs.get(req.transaction);
      if (!t || t.done) return reply(400, { error: { status: "INVALID_ARGUMENT", message: "tx" } });
      for (const [p, ut] of t.reads) {
        const d = this.docs.get(p);
        if ((d ? d.updateTime : null) !== ut) return reply(409, { error: { code: 409, status: "ABORTED", message: "conflict" } });
      }
      t.done = true;
    }
    // Vorbedingungen prüfen (atomar: erst alle prüfen, dann schreiben)
    const relOf = (w) => (w.delete || w.update.name).slice(this.root().length + 1);
    for (const w of req.writes) {
      const rel = relOf(w);
      const d = this.docs.get(rel);
      const cd = w.currentDocument;
      if (cd && cd.exists === true && !d) return reply(404, { error: { code: 404, status: "NOT_FOUND", message: "no doc" } });
      if (cd && cd.exists === false && d) return reply(409, { error: { code: 409, status: "ALREADY_EXISTS" } });
      if (cd && cd.updateTime && (!d || d.updateTime !== cd.updateTime)) return reply(400, { error: { code: 400, status: "FAILED_PRECONDITION" } });
    }
    const results = [];
    for (const w of req.writes) {
      const rel = relOf(w);
      if (w.delete) { this.docs.delete(rel); results.push({ updateTime: this.stamp() }); continue; }
      const prev = this.docs.get(rel);
      let fields;
      if (w.updateMask) {
        fields = { ...(prev ? prev.fields : {}) };
        for (const fp of w.updateMask.fieldPaths) {
          const k = fp.replace(/^`|`$/g, "");
          if (k in w.update.fields) fields[k] = w.update.fields[k]; else delete fields[k];
        }
      } else fields = w.update.fields;
      const t = this.stamp();
      this.docs.set(rel, { fields, createTime: prev ? prev.createTime : t, updateTime: t });
      results.push({ updateTime: t });
    }
    this.commits.push(req);
    return reply(200, { writeResults: results, commitTime: this.stamp() });
  }
}

/** Testumgebung mit Worker-Handler. */
export async function setup(opts = {}) {
  clearCaches();
  const acc = opts.acc || (await makeAccount());
  const g = new FakeGoogle({ publicKey: acc.publicKey, ...opts.google });
  const env = { FIREBASE_SERVICE_ACCOUNT: acc.json, STEMPEL_TOKEN: TOKEN, FIREBASE_PROJECT_ID: PROJECT, STEMPEL_EMAIL: EMAIL, ...(opts.env || {}) };
  let now = opts.now ?? Date.UTC(2026, 10, 4, 9, 0); // Mi 04.11.2026 10:00 Wien
  const logs = [];
  const call = async (body, { headers = {}, query = "", method = "POST", path = "/mcp" } = {}) => {
    const req = new Request(`https://stempelkarte-mcp.example.workers.dev${path}${query}`, {
      method,
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}`, ...headers },
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    return handle(req, env, { fetchImpl: g.fetch, now: () => now, log: (n) => logs.push(n) });
  };
  let nextId = 1;
  const rpc = async (method, params) => {
    const res = await call({ jsonrpc: "2.0", id: nextId++, method, params });
    return res.json();
  };
  const tool = async (name, args = {}) => {
    const r = await rpc("tools/call", { name, arguments: args });
    if (r.error) throw new Error("RPC-Fehler: " + JSON.stringify(r.error));
    return { text: r.result.content[0].text, isError: !!r.result.isError };
  };
  const base = `users/${UID}`;
  return {
    g, env, acc, call, rpc, tool, logs, base,
    setNow: (t) => { now = t; }, getNow: () => now,
  };
}

/** Wiener Ortszeit → ms (Testhilfe; Gegenprobe mit Date in TZ=Europe/Vienna in tools.test.js). */
export function vt(y, m, d, hh = 0, mm = 0) {
  return viennaToTs(y, m, d, hh, mm);
}
