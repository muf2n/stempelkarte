// Cloudflare Worker: Remote-MCP-Server („Claude-Connector“) für die Stempelkarte.
// Endpunkte: POST /mcp (Streamable HTTP, JSON-Antworten; Zugang nur mit STEMPEL_TOKEN)
// und POST /chat (In-App-Assistent, Firebase-ID-Token, siehe chat.js).
// /mcp:
// (Header „Authorization: Bearer …“ oder ?key=…). Protokolliert wird nur der Werkzeugname.
import { handleBody, SERVER_INFO } from "./mcp.js";
import { loadAccount, getAccessToken, resolveUid, DEFAULT_PROJECT } from "./google.js";
import { Firestore } from "./firestore.js";
import { Data } from "./data.js";
import { handleChat } from "./chat.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, accept, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function json(status, body, extra = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body == null ? {} : { "content-type": "application/json; charset=utf-8" }), "cache-control": "no-store", ...CORS, ...extra },
  });
}
function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra } });
}

/** Vergleich in konstanter Zeit (über SHA-256, damit auch die Länge nichts verrät). */
export async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function authorized(request, url, env) {
  const expected = String(env.STEMPEL_TOKEN || "").trim();
  if (expected.length < 16) return false; // ohne (ausreichend langes) Token kein Zugang
  const h = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  // UNSICHER: ?key= ist der Weg für claude.ai ohne „Request headers“ (Beta) – setzt voraus, dass Claude die
  // Query der Connector-URL bei jedem Aufruf mitschickt (laut Doku/Erfahrung ja, offline nicht prüfbar).
  const given = m ? m[1].trim() : (url.searchParams.get("key") || "").trim();
  if (!given) return false;
  return safeEqual(given, expected);
}

class SetupError extends Error {
  constructor(msg) { super(msg); this.expose = true; }
}

/** Data-Objekt für eine Anfrage (Google-Token und UID werden zwischengespeichert). */
export function makeDataFactory(env, fetchImpl = (...a) => fetch(...a), nowFn = () => Date.now()) {
  return async () => {
    let acc;
    try { acc = loadAccount(env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { throw new SetupError(e.message); }
    const projectId = String(env.FIREBASE_PROJECT_ID || acc.project_id || DEFAULT_PROJECT);
    const getToken = async () => {
      try { return await getAccessToken(acc, fetchImpl, nowFn()); } catch (e) { throw new SetupError(e.message); }
    };
    const fs = new Firestore({ projectId, getToken, fetchImpl });
    let uid;
    try { uid = await resolveUid({ env, projectId, getToken, fetchImpl, fs }); } catch (e) { throw e.expose ? e : new SetupError(e.message); }
    return new Data(fs, uid, nowFn());
  };
}

export async function handle(request, env, { fetchImpl, now, log = (n) => console.log("tool:", n) } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/chat") return handleChat(request, env, { fetchImpl, now: (now || (() => Date.now()))() });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/") {
    return text(200, `${SERVER_INFO.title} – MCP-Server läuft. Endpunkt: /mcp\n`);
  }
  if (path.startsWith("/.well-known/")) return text(404, "Nicht gefunden.\n"); // keine OAuth-Erkennung

  if (path !== "/mcp") return text(404, "Nicht gefunden.\n");

  if (request.method !== "POST") {
    return text(405, "Nur POST ist erlaubt (kein SSE-Stream).\n", { allow: "POST, OPTIONS" });
  }
  if (!(await authorized(request, url, env))) {
    return json(401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Nicht autorisiert." } }, { "www-authenticate": 'Bearer realm="stempelkarte"' });
  }
  const ct = request.headers.get("content-type") || "";
  if (ct && !/application\/json/i.test(ct)) {
    return json(415, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Content-Type muss application/json sein." } });
  }
  const body = await request.text();
  if (body.length > 1_000_000) return json(413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Anfrage zu groß." } });

  const factory = makeDataFactory(env, fetchImpl, now || (() => Date.now()));
  let dataP = null;
  const getData = () => (dataP ||= factory());
  const res = await handleBody(body, { getData, log });
  return json(res.status, res.body);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return json(500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Interner Fehler." } });
    }
  },
};
