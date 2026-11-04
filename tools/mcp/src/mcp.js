// MCP über JSON-RPC 2.0 (Streamable-HTTP-Transport, nur JSON-Antworten, ohne SSE, zustandslos).
import { toolList, findTool, UserError } from "./tools.js";

export const SERVER_INFO = { name: "stempelkarte-mcp", title: "Stempelkarte", version: "1.0.0" };
export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST = SUPPORTED_VERSIONS[0];

const INSTRUCTIONS =
  "Stempelkarte: Arbeitszeit-, Planer-, Geld- und Schul-App eines Elektriker-Lehrlings in Österreich. " +
  "Zeiten sind Wiener Ortszeit (24 h), Datumsangaben TT.MM.JJJJ. Antworte dem Nutzer auf Deutsch. " +
  "Vor dem Ein-/Ausstempeln bei Unklarheit status_heute aufrufen. Löschen ist über diesen Connector nicht möglich.";

export const ERR = { PARSE: -32700, INVALID_REQUEST: -32600, METHOD: -32601, PARAMS: -32602, INTERNAL: -32603 };

function rpcError(id, code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: "2.0", id: id ?? null, error: e };
}
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const validId = (id) => typeof id === "string" || (typeof id === "number" && Number.isFinite(id));

/** Einfache Prüfung der Argumente gegen das inputSchema (Pflichtfelder, Grundtypen, enum). */
export function checkArgs(schema, args) {
  if (!isObj(args)) return "Argumente müssen ein Objekt sein.";
  const props = schema.properties || {};
  for (const r of schema.required || []) {
    if (args[r] === undefined || args[r] === null || args[r] === "") return `Pflichtfeld „${r}“ fehlt.`;
  }
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) {
      if (schema.additionalProperties === false) return `Unbekanntes Feld „${k}“.`;
      continue;
    }
    if (v === null || v === undefined) continue;
    const types = Array.isArray(p.type) ? p.type : p.type ? [p.type] : [];
    const t = Array.isArray(v) ? "array" : typeof v;
    const okType = !types.length || types.some((x) => x === t || (x === "integer" && t === "number" && Number.isInteger(v)));
    if (!okType) return `Feld „${k}“ hat den falschen Typ (erwartet ${types.join("/")}).`;
    if (p.enum && !p.enum.includes(v)) return `Feld „${k}“ muss einer dieser Werte sein: ${p.enum.join(", ")}.`;
    if (t === "array" && p.items && p.items.type && v.some((x) => typeof x !== p.items.type)) return `Feld „${k}“ darf nur ${p.items.type}-Werte enthalten.`;
  }
  return null;
}

/**
 * Eine JSON-RPC-Nachricht verarbeiten. → Antwortobjekt oder null (Benachrichtigung/Antwort).
 * getData: async () => Data (lazy – Google wird nur für tools/call kontaktiert).
 */
export async function handleMessage(msg, { getData, log = () => {} }) {
  if (!isObj(msg) || msg.jsonrpc !== "2.0") return rpcError(isObj(msg) && validId(msg.id) ? msg.id : null, ERR.INVALID_REQUEST, "Ungültige JSON-RPC-Anfrage.");
  const hasId = "id" in msg && msg.id !== null;
  if (typeof msg.method !== "string") {
    // Antworten des Clients (result/error) auf Server-Anfragen – wir stellen keine, also ignorieren
    if (("result" in msg || "error" in msg) && hasId) return null;
    return rpcError(validId(msg.id) ? msg.id : null, ERR.INVALID_REQUEST, "Feld „method“ fehlt.");
  }
  if (hasId && !validId(msg.id)) return rpcError(null, ERR.INVALID_REQUEST, "Ungültige id.");
  const isNotification = !("id" in msg);
  const id = msg.id;
  const params = msg.params;
  if (params !== undefined && !isObj(params) && !Array.isArray(params)) {
    return isNotification ? null : rpcError(id, ERR.INVALID_REQUEST, "params muss Objekt oder Array sein.");
  }

  if (isNotification) return null; // notifications/initialized, notifications/cancelled … – nichts zu tun

  switch (msg.method) {
    case "initialize": {
      const want = params && typeof params.protocolVersion === "string" ? params.protocolVersion : null;
      const protocolVersion = want && SUPPORTED_VERSIONS.includes(want) ? want : LATEST;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: toolList() });
    case "tools/call": {
      if (!isObj(params) || typeof params.name !== "string") return rpcError(id, ERR.PARAMS, "params.name fehlt.");
      const t = findTool(params.name);
      if (!t) return rpcError(id, ERR.PARAMS, `Unbekanntes Werkzeug: ${params.name}`);
      const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
      const bad = checkArgs(t.inputSchema, args);
      if (bad) return rpcResult(id, { content: [{ type: "text", text: `Ungültige Eingabe: ${bad}` }], isError: true });
      log(t.name);
      try {
        const d = await getData();
        const text = await t.run(args, d);
        return rpcResult(id, { content: [{ type: "text", text: String(text) }] });
      } catch (e) {
        if (e instanceof UserError) return rpcResult(id, { content: [{ type: "text", text: e.message }], isError: true });
        const safe = e && e.expose ? e.message : `Interner Fehler beim Zugriff auf die Stempelkarte${e && e.status ? ` (${e.status})` : ""}${e && e.public ? ": " + e.public : ""}. Bitte später nochmal versuchen.`;
        return rpcResult(id, { content: [{ type: "text", text: safe }], isError: true });
      }
    }
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    case "logging/setLevel":
      return rpcResult(id, {});
    default:
      return rpcError(id, ERR.METHOD, `Methode nicht gefunden: ${msg.method}`);
  }
}

/** Rohen Body verarbeiten → {status, body|null}. */
export async function handleBody(text, ctx) {
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    return { status: 400, body: rpcError(null, ERR.PARSE, "JSON konnte nicht gelesen werden.") };
  }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: rpcError(null, ERR.INVALID_REQUEST, "Leerer Batch.") };
    const out = [];
    for (const m of parsed) {
      const r = await handleMessage(m, ctx);
      if (r) out.push(r);
    }
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }
  const r = await handleMessage(parsed, ctx);
  return r ? { status: 200, body: r } : { status: 202, body: null };
}
