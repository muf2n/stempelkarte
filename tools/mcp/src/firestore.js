// Minimaler Firestore-REST-Client (v1) für Workers: nur fetch, kein SDK.
// Wertekonvertierung wie js/lock-core.js (gleiche Regeln, damit die App dieselben Typen sieht),
// ergänzt um timestamp/geoPoint/bytes/reference als unverändert durchgereichte {__fs: …}-Werte.

/* ---------- Wertekonvertierung ---------- */

export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { nullValue: null };
    if (Number.isInteger(v) && Number.isSafeInteger(v) && !Object.is(v, -0)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (typeof v === "bigint") return { integerValue: v.toString() };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) {
    const values = [];
    for (const x of v) if (x !== undefined) values.push(encodeValue(x));
    return { arrayValue: values.length ? { values } : {} };
  }
  if (typeof v === "object") {
    if (v.__fs && typeof v.__fs === "object") return v.__fs;
    return { mapValue: { fields: encodeFields(v) } };
  }
  return { nullValue: null };
}

export function encodeFields(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    if (obj[k] === undefined) continue;
    out[k] = encodeValue(obj[k]);
  }
  return out;
}

export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return String(v.stringValue);
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  return { __fs: v }; // timestampValue, geoPointValue, bytesValue, referenceValue …
}

export function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = decodeValue(fields[k]);
  return out;
}

/* ---------- Client ---------- */

export class FirestoreError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Firestore {
  constructor({ projectId, getToken, fetchImpl }) {
    this.projectId = projectId;
    this.getToken = getToken;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.root = `projects/${projectId}/databases/(default)/documents`;
    this.base = `https://firestore.googleapis.com/v1/${this.root}`;
  }

  name(path) { return `${this.root}/${path}`; }

  async req(method, url, body) {
    const token = await this.getToken();
    const res = await this.fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const err = data && (Array.isArray(data) ? data[0]?.error : data.error);
      throw new FirestoreError(res.status, err?.status || String(res.status), `Firestore ${res.status} ${err?.status || ""}`.trim());
    }
    return data;
  }

  static toDoc(raw) {
    if (!raw || !raw.name) return null;
    const id = raw.name.split("/").pop();
    return { id, name: raw.name, data: decodeFields(raw.fields || {}), updateTime: raw.updateTime || null };
  }

  /** Dokument lesen; null, wenn es nicht existiert. */
  async get(path, { transaction } = {}) {
    let url = `${this.base}/${path}`;
    if (transaction) url += `?transaction=${encodeURIComponent(transaction)}`;
    try {
      return Firestore.toDoc(await this.req("GET", url));
    } catch (e) {
      if (e instanceof FirestoreError && e.status === 404) return null;
      throw e;
    }
  }

  /** Alle Dokumente einer Sammlung (seitenweise). mask = Feldliste (optional). */
  async list(collPath, { mask = null, pageSize = 300, showMissing = false, max = 20000 } = {}) {
    const out = [];
    let token = "";
    for (let i = 0; i < 200; i++) {
      const q = new URLSearchParams({ pageSize: String(pageSize) });
      if (token) q.set("pageToken", token);
      if (showMissing) q.set("showMissing", "true");
      if (mask) for (const f of mask) q.append("mask.fieldPaths", f);
      let data;
      try {
        data = await this.req("GET", `${this.base}/${collPath}?${q}`);
      } catch (e) {
        if (e instanceof FirestoreError && e.status === 404) return out;
        throw e;
      }
      for (const d of (data && data.documents) || []) out.push(Firestore.toDoc(d));
      token = data && data.nextPageToken;
      if (!token || out.length >= max) break;
    }
    return out;
  }

  /** structuredQuery unter parentPath (z. B. "users/UID"). */
  async runQuery(parentPath, structuredQuery, { transaction } = {}) {
    const body = { structuredQuery };
    if (transaction) body.transaction = transaction;
    const data = await this.req("POST", `${this.base}/${parentPath}:runQuery`, body);
    return (Array.isArray(data) ? data : []).filter((r) => r && r.document).map((r) => Firestore.toDoc(r.document));
  }

  async beginTransaction() {
    const data = await this.req("POST", `${this.base}:beginTransaction`, { options: { readWrite: {} } });
    return data.transaction;
  }

  async rollback(transaction) {
    try { await this.req("POST", `${this.base}:rollback`, { transaction }); } catch { /* egal */ }
  }

  async commit(writes, transaction) {
    const body = { writes };
    if (transaction) body.transaction = transaction;
    return this.req("POST", `${this.base}:commit`, body);
  }

  /* ---- Schreib-Bausteine für commit ---- */

  /** Dokument komplett ersetzen (wie setDoc ohne merge). */
  setWrite(path, data, precondition = null) {
    const w = { update: { name: this.name(path), fields: encodeFields(data) } };
    if (precondition) w.currentDocument = precondition;
    return w;
  }

  /** Dokument löschen (wie deleteDoc). */
  deleteWrite(path) {
    return { delete: this.name(path) };
  }

  /** Nur bestimmte Felder ändern (wie setDoc mit merge bzw. updateDoc). */
  patchWrite(path, partial, precondition = null) {
    const w = {
      update: { name: this.name(path), fields: encodeFields(partial) },
      updateMask: { fieldPaths: Object.keys(partial).map(fieldPath) },
    };
    if (precondition) w.currentDocument = precondition;
    return w;
  }
}

/** Feldname → Firestore-Feldpfad (Sonderzeichen in Backticks). */
export function fieldPath(k) {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : "`" + String(k).replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}
