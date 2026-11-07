// Cloudflare Worker: Remote-MCP-Server („Claude-Connector“) für die Stempelkarte.
// Endpunkte: POST /mcp (Streamable HTTP, JSON-Antworten; Zugang nur mit STEMPEL_TOKEN)
// und POST /chat (In-App-Assistent, Firebase-ID-Token, siehe chat.js),
// GET /ics (iCal-Abo über den Server, siehe ics.js), /bank/* (Bankverbindung über Enable Banking, siehe bank.js),
// /gmail/* (Gmail dauerhaft, nur lesen, siehe gmail.js) und scheduled() für Bank-Abgleich und täglichen Gmail-Abo-Scan.
// /mcp:
// (Header „Authorization: Bearer …“ oder ?key=…). Protokolliert wird nur der Werkzeugname.
import { handleBody, SERVER_INFO } from "./mcp.js";
import { loadAccount, getAccessToken, resolveUid, DEFAULT_PROJECT } from "./google.js";
import { Firestore } from "./firestore.js";
import { Data } from "./data.js";
import { handleChat } from "./chat.js";
import { handleBank, runBankCron } from "./bank.js";
import { handleIcs } from "./ics.js";
import { handleGmail, runGmailCron, GMAIL_CRON } from "./gmail.js";
import { runBackupCron, BACKUP_CRON } from "./backup.js";
import { rateOk, rateTake, retryAfter } from "./ratelimit.js";

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
    const d = new Data(fs, uid, nowFn());
    d.env = env; d.fetchImpl = fetchImpl; // für mails_suchen/mail_lesen (Gmail-Secrets, eigener Zugriffstoken)
    return d;
  };
}

/** 429 mit Retry-After (M6). CORS wie bei der jeweiligen Route ist hier egal – der Browser zeigt ohnehin einen Fehler. */
function tooMany(scope) {
  return new Response(JSON.stringify({ error: "Zu viele Anfragen – bitte kurz warten." }), {
    status: 429, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(retryAfter(scope)), ...CORS },
  });
}

export async function handle(request, env, { fetchImpl, now, ctx = null, log = (n) => console.log("tool:", n) } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const t0 = (now || (() => Date.now()))();

  // M6: Endpunkte, die ohne Anmeldung Firestore/Google anfragen, pro IP bremsen (Preflights zählen nicht)
  if (request.method !== "OPTIONS") {
    if (path === "/gmail/callback" && !rateTake("gmail-callback", request, t0)) return tooMany("gmail-callback");
    if (path === "/bank/finish" && !rateTake("bank-finish", request, t0)) return tooMany("bank-finish");
    if (path === "/ics" && !rateTake("ics", request, t0)) return tooMany("ics");
  }

  if (path === "/chat") return handleChat(request, env, { fetchImpl, now: (now || (() => Date.now()))() });
  if (path === "/ics") return handleIcs(request, env, { fetchImpl, now: (now || (() => Date.now()))() });
  if (path.startsWith("/bank/")) return handleBank(request, env, { fetchImpl, now: (now || (() => Date.now()))() });
  if (path.startsWith("/gmail/")) return handleGmail(request, env, { fetchImpl, now: (now || (() => Date.now()))(), ctx });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/") {
    return text(200, `${SERVER_INFO.title} – MCP-Server läuft. Endpunkt: /mcp\n`);
  }
  if (path.startsWith("/.well-known/")) return text(404, "Nicht gefunden.\n"); // keine OAuth-Erkennung

  if (path !== "/mcp") return text(404, "Nicht gefunden.\n");

  if (request.method !== "POST") {
    return text(405, "Nur POST ist erlaubt (kein SSE-Stream).\n", { allow: "POST, OPTIONS" });
  }
  if (!rateOk("mcp-auth", request, t0)) return tooMany("mcp-auth");
  if (!(await authorized(request, url, env))) {
    rateTake("mcp-auth", request, t0); // nur Fehlversuche zählen
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
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, { ctx });
    } catch {
      return json(500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Interner Fehler." } });
    }
  },
  // Cron (wrangler.toml [triggers]): Bankbuchungen abholen, 1× täglich Gmail nach Abo-Mails durchsuchen, sonntags Backup.
  // Nur Ergebnis-Art protokollieren, keine Inhalte.
  async scheduled(event, env, ctx) {
    const cron = event && event.cron;
    const jobs = [];
    if (cron === BACKUP_CRON) { // Update 10 – wöchentliches Backup (eigener Lauf → eigenes Unteranfragen-Budget)
      jobs.push(runBackupCron(env).then((r) => console.log("backup-cron:", r && (r.skipped || (r.error ? "error" : "ok")))).catch(() => console.log("backup-cron: error")));
    } else if (cron !== GMAIL_CRON) {
      jobs.push(runBankCron(env).then((r) => console.log("bank-cron:", r && (r.skipped || (r.error ? "error" : "ok")))).catch(() => console.log("bank-cron: error")));
    }
    if (!cron || cron === GMAIL_CRON) {
      jobs.push(runGmailCron(env).then((r) => console.log("gmail-cron:", r && (r.skipped || (r.error ? "error" : "ok")))).catch(() => console.log("gmail-cron: error")));
    }
    const p = Promise.all(jobs);
    if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  },
};
